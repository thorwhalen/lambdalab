/**
 * Simulating finite automata — the ε-NFA/DFA engine every lesson runs on.
 *
 * One simulator serves both flavours. We always carry a *set* of current states;
 * the DFA case is simply the one where that set never holds more than one member.
 * Everything here is a pure function of an `Automaton`, so the UI can replay,
 * scrub and diff a run freely, and the grader can trust that `accepts` and
 * `trace().accepted` can never drift apart (they share one core loop).
 *
 * Three invariants the rest of the engine leans on:
 *
 * - **Deterministic output.** Every collection we return is ordered by one fixed
 *   code-unit comparator. Never `localeCompare`: its collation depends on the
 *   host's ICU build, so it would make state names machine-dependent. Even the
 *   `Set`s iterate in sorted order, so a caller that names a subset-construction
 *   state by joining a closure gets the same name on every run. The UI diffs on
 *   those names.
 *
 * - **δ ⊆ Q × (Σ ∪ {ε}) × Q.** An edge naming a state outside `Q` is not a
 *   transition — it is malformed data, and the textbook definition is the SSOT.
 *   `Q` is `states ∪ {start}`: the start state is a state *by definition*, so a
 *   machine that forgot to list it is repaired rather than rejected.
 *
 * - **Nothing throws.** A malformed machine, or an input symbol outside the
 *   alphabet, yields rejection — never an exception. This code runs inside a
 *   live animation while a child edits the machine underneath it.
 */

import {
  EPSILON,
  type Automaton,
  type DeterminismReport,
  type StateId,
  type Sym,
  type Trace,
  type TraceStep,
} from './types';

// ---------------------------------------------------------------------------
// Ordering — the single source of determinism
// ---------------------------------------------------------------------------

/**
 * Total order on state ids and symbols: raw UTF-16 code-unit order.
 *
 * Deliberately NOT `String.prototype.localeCompare`, which is locale- and
 * ICU-dependent and would make generated names differ across machines.
 */
const byCodeUnit = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

const sortedUnique = (xs: Iterable<string>): string[] => [...new Set(xs)].sort(byCodeUnit);

/**
 * A `Set` whose *iteration order* is sorted.
 *
 * JS `Set`s iterate in insertion order, which would leak the order transitions
 * happen to be listed in into anything derived from a returned set (subset
 * construction names its states after these sets). Sorting on the way out makes
 * that whole class of bug impossible rather than merely unlikely.
 */
const sortedSet = (xs: Iterable<StateId>): Set<StateId> => new Set(sortedUnique(xs));

// ---------------------------------------------------------------------------
// The transition index
// ---------------------------------------------------------------------------

/**
 * `delta` collapses duplicate transitions: the same (from, on, to) listed twice
 * is one edge, so it can never masquerade as nondeterminism.
 */
interface Index {
  /** Q — the states that actually exist. */
  q: Set<StateId>;
  /** from -> symbol (or ε) -> distinct targets. */
  delta: Map<StateId, Map<Sym, Set<StateId>>>;
}

/** Q = declared states ∪ {start}, deduplicated. */
const statesOf = (a: Automaton): StateId[] => sortedUnique([...a.states, a.start]);

const buildIndex = (a: Automaton): Index => {
  const q = new Set(statesOf(a));
  const delta = new Map<StateId, Map<Sym, Set<StateId>>>();

  for (const t of a.transitions) {
    // An edge touching a state outside Q is not an element of δ. See module docstring.
    if (!q.has(t.from) || !q.has(t.to)) continue;

    let bySym = delta.get(t.from);
    if (!bySym) {
      bySym = new Map<Sym, Set<StateId>>();
      delta.set(t.from, bySym);
    }
    let targets = bySym.get(t.on);
    if (!targets) {
      targets = new Set<StateId>();
      bySym.set(t.on, targets);
    }
    targets.add(t.to);
  }

  return { q, delta };
};

const targetsOf = (ix: Index, from: StateId, on: Sym): Iterable<StateId> =>
  ix.delta.get(from)?.get(on) ?? [];

/**
 * Σ as the machine actually uses it: the declared alphabet plus every symbol any
 * real transition fires on, minus ε.
 *
 * We take the union rather than trusting `a.alphabet` alone so that a symbol the
 * machine can actually read is never invisible to `determinismReport` — a stray
 * edge on an undeclared symbol should show up as a mess, not vanish.
 */
const symbolsFrom = (a: Automaton, ix: Index): Sym[] => {
  const syms = new Set<Sym>(a.alphabet);
  for (const bySym of ix.delta.values()) {
    for (const on of bySym.keys()) syms.add(on);
  }
  syms.delete(EPSILON); // ε is never a member of an alphabet.
  return [...syms].sort(byCodeUnit);
};

// ---------------------------------------------------------------------------
// Closure and stepping
// ---------------------------------------------------------------------------

/**
 * Transitive closure under ε-moves, by worklist.
 *
 * Terminates on ε-cycles because a state is enqueued only on first sighting, so
 * every state is expanded at most once.
 */
const closureFrom = (ix: Index, seeds: Iterable<StateId>): Set<StateId> => {
  const seen = new Set<StateId>();
  const work: StateId[] = [];

  for (const s of seeds) {
    if (ix.q.has(s) && !seen.has(s)) {
      seen.add(s);
      work.push(s);
    }
  }

  while (work.length > 0) {
    // Pop order is irrelevant: a closure is a fixpoint, and we sort on the way out.
    const s = work.pop() as StateId;
    for (const t of targetsOf(ix, s, EPSILON)) {
      if (!seen.has(t)) {
        seen.add(t);
        work.push(t);
      }
    }
  }

  return sortedSet(seen);
};

/**
 * δ̂(S, sym) — the ε-NFA set-transition: close, move, close.
 *
 * We close the *incoming* set as well as the result. For a set that is already
 * ε-closed (everything this module produces) that is a no-op, so it costs
 * nothing and it makes `step` correct for a caller who hands us a raw set.
 */
const stepFrom = (ix: Index, states: Iterable<StateId>, sym: Sym): Set<StateId> => {
  // ε is not a member of any alphabet, so it cannot be *consumed*. Without this
  // guard an input string containing the literal character 'ε' would ride the
  // machine's free moves — the string would be silently mis-graded.
  if (sym === EPSILON) return new Set<StateId>();

  const moved = new Set<StateId>();
  for (const s of closureFrom(ix, states)) {
    for (const t of targetsOf(ix, s, sym)) moved.add(t);
  }
  return closureFrom(ix, moved);
};

// ---------------------------------------------------------------------------
// Running an input — the one core loop behind `accepts` and `trace`
// ---------------------------------------------------------------------------

interface Run {
  steps: TraceStep[];
  /** First `pos` at which no state survives. Absent when the run completed. */
  stuckAt?: number;
}

const runInput = (a: Automaton, input: string): Run => {
  const ix = buildIndex(a);

  // The start state is always in Q, so this is never empty: a run can only die
  // by *consuming* something, hence `stuckAt` is always >= 1.
  const steps: TraceStep[] = [{ pos: 0, states: [...closureFrom(ix, [a.start])] }];
  let current = new Set(steps[0].states);

  // Index by UTF-16 code unit, not code point: `TraceStep.pos` is documented as
  // an index into the input *string*, and `Sym` is exactly one character.
  for (let i = 0; i < input.length; i++) {
    const sym = input[i];
    const next = stepFrom(ix, current, sym);
    if (next.size === 0) return { steps, stuckAt: i + 1 };
    steps.push({ pos: i + 1, states: [...next], consumed: sym });
    current = next;
  }

  return { steps };
};

const hitsAccepting = (a: Automaton, states: Iterable<StateId>): boolean => {
  const accepting = new Set(a.accepting);
  for (const s of states) if (accepting.has(s)) return true;
  return false;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The ε-closure of `states`: every state reachable from them by ε-moves alone,
 * including the seeds themselves. Seeds outside Q are ignored. Safe on ε-cycles.
 */
export function epsilonClosure(a: Automaton, states: Iterable<StateId>): Set<StateId> {
  return closureFrom(buildIndex(a), states);
}

/**
 * The states reachable from `states` by consuming exactly one `sym`, ε-closed.
 *
 * Precondition-free: `states` need not be ε-closed, `sym` need not be in the
 * alphabet (an unknown symbol yields the empty set — that is what rejection is).
 * Passing EPSILON yields the empty set: ε is a free move, never a consumed symbol.
 */
export function step(a: Automaton, states: Iterable<StateId>, sym: Sym): Set<StateId> {
  return stepFrom(buildIndex(a), states, sym);
}

/** True when the machine has a run on `input` ending in an accepting state. */
export function accepts(a: Automaton, input: string): boolean {
  const { steps, stuckAt } = runInput(a, input);
  if (stuckAt !== undefined) return false;
  return hitsAccepting(a, steps[steps.length - 1].states);
}

/**
 * A full run, one step per input symbol, for the animation.
 *
 * Step 0 is the ε-closure of {start} at `pos` 0 with no `consumed`; step k has
 * `pos === k` and `consumed === input[k - 1]`. If the state set ever empties, the
 * run stops there and `stuckAt` holds the first `pos` at which nothing survives —
 * so `input[stuckAt - 1]` is the symbol that killed it, and `stuckAt` is always
 * at least 1 (the initial set always contains the start state).
 */
export function trace(a: Automaton, input: string): Trace {
  const { steps, stuckAt } = runInput(a, input);
  const accepted = stuckAt === undefined && hitsAccepting(a, steps[steps.length - 1].states);
  return stuckAt === undefined
    ? { input, steps, accepted }
    : { input, steps, accepted, stuckAt };
}

/**
 * Why a machine is (or isn't) a DFA.
 *
 * Reported over Q × Σ (see `alphabetOf`), both sorted, so the report is stable.
 * Note `isDeterministic` does not imply `isTotal`: a machine may be a partial
 * DFA, which is exactly the distinction the lesson wants to draw.
 */
export function determinismReport(a: Automaton): DeterminismReport {
  const ix = buildIndex(a);
  const alphabet = symbolsFrom(a, ix);

  let hasEpsilon = false;
  for (const bySym of ix.delta.values()) {
    if ((bySym.get(EPSILON)?.size ?? 0) > 0) {
      hasEpsilon = true;
      break;
    }
  }

  const nondeterministic: DeterminismReport['nondeterministic'] = [];
  const missing: DeterminismReport['missing'] = [];

  for (const state of statesOf(a)) {
    for (const on of alphabet) {
      const targets = ix.delta.get(state)?.get(on);
      const count = targets?.size ?? 0;
      if (count === 0) missing.push({ state, on });
      // >1 *distinct* target: duplicate edges collapsed when the index was built.
      else if (count > 1) {
        nondeterministic.push({ state, on, targets: sortedUnique(targets as Set<StateId>) });
      }
    }
  }

  return {
    isDeterministic: !hasEpsilon && nondeterministic.length === 0,
    isTotal: missing.length === 0,
    hasEpsilon,
    nondeterministic,
    missing,
  };
}

/**
 * Every state reachable from the start state along any transition, ε-moves
 * included. Always contains the start state.
 */
export function reachableStates(a: Automaton): Set<StateId> {
  const ix = buildIndex(a);
  const seen = new Set<StateId>([a.start]);
  const work: StateId[] = [a.start];

  while (work.length > 0) {
    const s = work.pop() as StateId;
    for (const targets of ix.delta.get(s)?.values() ?? []) {
      for (const t of targets) {
        if (!seen.has(t)) {
          seen.add(t);
          work.push(t);
        }
      }
    }
  }

  return sortedSet(seen);
}

/**
 * Σ: sorted, unique, ε excluded. The declared alphabet unioned with every symbol
 * a real transition fires on, so no readable symbol is invisible to the report.
 */
export function alphabetOf(a: Automaton): Sym[] {
  return symbolsFrom(a, buildIndex(a));
}
