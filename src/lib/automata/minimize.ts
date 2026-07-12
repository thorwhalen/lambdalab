/**
 * DFA minimisation — the smallest machine for a language, and the par score.
 *
 * The algorithm is **Moore's**: start from the two-block partition
 * {accepting, non-accepting} and repeatedly refine it by each state's *signature*
 * — the block it currently sits in, plus the block each of its moves lands in —
 * until the partition stops splitting. The stable partition is exactly the
 * Myhill–Nerode equivalence, and its blocks are the states of the minimal machine.
 *
 * Moore, not Hopcroft, deliberately. Hopcroft is O(n log n) against Moore's O(n²·|Σ|),
 * but the machines a child draws have a handful of states, and Hopcroft's
 * "process the smaller half" bookkeeping is the classic place to introduce a subtle
 * bug. This code grades children; a wrong answer costs more than a slow one.
 *
 * The pipeline order in `minimize` is load-bearing, and every step earns its place:
 *
 * - **Determinise first.** Moore's refinement reasons about δ as a *function*.
 *   Nondeterminism and ε-moves make it a relation, and the notion of "the block my
 *   move lands in" evaporates.
 *
 * - **Complete before refining.** A partial DFA rejects a string in two different
 *   ways — by ending outside the accepting set, or by dying mid-word. If the trap is
 *   left implicit then "no move on b" and "a move on b into a dead state" look like
 *   different behaviours to the refinement, so two states that reject exactly the
 *   same strings survive as two states. The machine still has the right language; it
 *   is just not minimal, and the par score shown to the child is then wrong.
 *
 * - **Remove unreachable states before refining, not after.** An unreachable state
 *   that is inequivalent to every reachable one forms a block of its own and lands in
 *   the output — a state the language does not need. (After completion, so that a
 *   trap reachable *only* from an unreachable state goes with it.)
 *
 * Two conventions the rest of the app depends on:
 *
 * - **`minimize` drops the trap; `minimalStateCount` counts it.** These disagree on
 *   purpose. A human-facing minimal DFA does not draw a dead state — a textbook
 *   diagram of "exactly the string ab" has three circles and simply omits the moves
 *   that fail — so `minimize` deletes the trap and leaves those transitions missing.
 *   But "how many states does this language *need*?" is a Myhill–Nerode question, and
 *   Myhill–Nerode counts equivalence classes of Σ*, one of which is "the dead words".
 *   So `minimalStateCount` reports the **complete-DFA** count, the number a textbook
 *   would give: 3 for "contains ab" (no dead words — every prefix can still be
 *   extended into the language), 4 for "exactly ab" (three live classes plus the dead
 *   one). Par scores must match the textbook, so the par score is the complete count.
 *
 * - **Names are content-determined.** A merged state is named by joining its members'
 *   original names, sorted: "q0|q3". Two runs on the same input therefore produce
 *   byte-identical machines — the UI diffs on state names.
 *
 * Ordering is by UTF-16 code unit throughout, never `localeCompare` (see
 * `simulate.ts`): generated names must not vary with the host's ICU build.
 */

import { EPSILON, type Automaton, type StateId, type Sym, type Transition } from './types';
import { alphabetOf, determinismReport, reachableStates } from './simulate';
import { complete, toDFA } from './subset';

// ---------------------------------------------------------------------------
// Notation
// ---------------------------------------------------------------------------

/** Joins the members of a merged state: {q0, q3} is drawn "q0|q3". */
const MERGE_SEP = '|';

/** Appended when a preferred name is already taken: "q0|q3", then "q0|q3#2", … */
const DISAMBIGUATOR = '#';

/** First suffix tried by `freshName`. The unsuffixed name is conceptually "#1". */
const FIRST_ALTERNATIVE = 2;

/**
 * A machine always has at least its start state, so a minimal DFA can never be
 * emptied. This is the guard that keeps the empty language representable: its
 * minimal machine *is* a lone trap, and there is nothing to drop.
 */
const MIN_STATES = 1;

// ---------------------------------------------------------------------------
// Ordering and naming
// ---------------------------------------------------------------------------

/** Total order on ids and symbols: raw UTF-16 code units. See the module docstring. */
const byCodeUnit = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

const sortedUnique = (xs: Iterable<string>): string[] => [...new Set(xs)].sort(byCodeUnit);

/** Deduplicate, keeping first occurrence. Preserves a caller's declared order. */
const uniqueInOrder = <T>(xs: Iterable<T>): T[] => [...new Set(xs)];

/** A name derived from `base` that is not in `taken`. Deterministic. */
const freshName = (base: StateId, taken: ReadonlySet<StateId>): StateId => {
  let name = base;
  let n = FIRST_ALTERNATIVE;
  while (taken.has(name)) name = `${base}${DISAMBIGUATOR}${n++}`;
  return name;
};

/**
 * One unique display name per preferred name, positionally.
 *
 * Collisions need a state id containing MERGE_SEP — an original state literally named
 * "a|b" alongside a merged class {a, b}. Pathological, but a collision would *fuse*
 * two inequivalent states, i.e. change the language the child is graded on, so it
 * cannot merely be hoped away. `preferred` is consumed in order and that order is
 * content-determined, so which class keeps the clean name is reproducible.
 */
const uniqueNames = (preferred: readonly string[]): StateId[] => {
  const taken = new Set<StateId>();
  return preferred.map((base) => {
    const name = freshName(base, taken);
    taken.add(name);
    return name;
  });
};

/** Injective identity for a list of ids — JSON, never a display name. */
const keyOf = (parts: readonly (string | number)[]): string => JSON.stringify(parts);

// ---------------------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------------------

/**
 * The machine with every state the start state cannot reach deleted, along with
 * their edges.
 *
 * Works on ε-NFAs as well as DFAs: reachability follows ε-moves. Transitions naming a
 * state outside Q are dropped too — such an edge is not a member of δ (see
 * `simulate.ts`), and after this it is not in the data either.
 *
 * Σ is **preserved in full**, even when the surviving states no longer use every
 * symbol: the alphabet belongs to the language, not to the states that happened to
 * survive, and silently narrowing it would change what `complement` means.
 *
 * Language-preserving: a state you cannot reach cannot contribute a run.
 */
export function removeUnreachable(a: Automaton): Automaton {
  const live = reachableStates(a);

  // Q = declared states ∪ {start}: the start state is a state by definition, so a
  // machine that forgot to list it is repaired rather than mangled.
  const states = uniqueInOrder([...a.states, a.start]).filter((s) => live.has(s));

  const pruned: Automaton = {
    states,
    alphabet: alphabetOf(a),
    transitions: a.transitions.filter((t) => live.has(t.from) && live.has(t.to)),
    start: a.start,
    accepting: a.accepting.filter((s) => live.has(s)),
  };

  // Geometry is not maths, but throwing it away would scramble the editor. Surviving
  // states keep their names, so their positions are still meaningful.
  if (a.layout) {
    const layout: NonNullable<Automaton['layout']> = {};
    for (const s of states) {
      const at = a.layout[s];
      if (at) layout[s] = at;
    }
    pruned.layout = layout;
  }

  return pruned;
}

// ---------------------------------------------------------------------------
// δ as a function — only legal once the machine is a total DFA
// ---------------------------------------------------------------------------

/** δ: from -> symbol -> the single target. */
type Delta = Map<StateId, Map<Sym, StateId>>;

const totalDelta = (m: Automaton): Delta => {
  const q = new Set([...m.states, m.start]);
  const delta: Delta = new Map();

  for (const t of m.transitions) {
    // ε cannot occur (the machine has been determinised) and a dangling edge is not a
    // member of δ — both are dropped rather than trusted. See `simulate.ts`.
    if (t.on === EPSILON || !q.has(t.from) || !q.has(t.to)) continue;

    let bySym = delta.get(t.from);
    if (!bySym) {
      bySym = new Map<Sym, StateId>();
      delta.set(t.from, bySym);
    }
    const current = bySym.get(t.on);
    // There is only ever one target here. Should a bug upstream produce two, take the
    // code-unit-smallest: a wrong answer must at least be a reproducible one.
    if (current === undefined || byCodeUnit(t.to, current) < 0) bySym.set(t.on, t.to);
  }

  return delta;
};

const moveOf = (delta: Delta, from: StateId, on: Sym): StateId => {
  const to = delta.get(from)?.get(on);
  // Unreachable: `complete` guarantees a move on every symbol of Σ from every state.
  // Firing means that invariant broke — an engine bug, not bad input, so it must be
  // loud rather than quietly mis-grading a child.
  if (to === undefined) throw new Error(`minimize: no '${on}' move from '${from}' — not total`);
  return to;
};

// ---------------------------------------------------------------------------
// Moore's algorithm — partition refinement to the Myhill–Nerode classes
// ---------------------------------------------------------------------------

/**
 * A partition of Q. Canonical: each block sorted, blocks sorted by their contents, so
 * a block's *index* is a function of the partition alone and never of iteration order.
 */
type Blocks = StateId[][];

const canonicalBlocks = (groups: Iterable<Iterable<StateId>>): Blocks =>
  [...groups]
    .map((g) => sortedUnique(g))
    .filter((b) => b.length > 0)
    .sort((x, y) => byCodeUnit(keyOf(x), keyOf(y)));

const blockIndex = (blocks: Blocks): Map<StateId, number> => {
  const idOf = new Map<StateId, number>();
  blocks.forEach((block, i) => {
    for (const s of block) idOf.set(s, i);
  });
  return idOf;
};

const blockOf = (idOf: Map<StateId, number>, s: StateId): number => {
  const i = idOf.get(s);
  // Every state of Q is in exactly one block. Firing means the partition lost one.
  if (i === undefined) throw new Error(`minimize: state '${s}' is in no block`);
  return i;
};

/**
 * The two-block seed: accepting vs not. This is the only distinction that is a fact
 * about the *states* rather than about their futures; everything else is derived from
 * it, which is precisely why Moore's algorithm works.
 */
const initialPartition = (states: readonly StateId[], accepting: ReadonlySet<StateId>): Blocks =>
  canonicalBlocks([
    states.filter((s) => accepting.has(s)),
    states.filter((s) => !accepting.has(s)),
  ]);

/**
 * One refinement pass: group the states by (current block, block of each move).
 *
 * The current block is part of the signature, so the result always *refines* the
 * input — states already told apart can never be put back together.
 */
const refined = (
  blocks: Blocks,
  states: readonly StateId[],
  alphabet: readonly Sym[],
  delta: Delta,
): Blocks => {
  const idOf = blockIndex(blocks);
  const groups = new Map<string, StateId[]>();

  for (const s of states) {
    const signature = keyOf([
      blockOf(idOf, s),
      // Sorted Σ, so the signature is a function of the machine, not of edge order.
      ...alphabet.map((sym) => blockOf(idOf, moveOf(delta, s, sym))),
    ]);
    const group = groups.get(signature);
    if (group) group.push(s);
    else groups.set(signature, [s]);
  }

  return canonicalBlocks(groups.values());
};

/**
 * The Myhill–Nerode partition of a total, reachable DFA: refine to a fixpoint.
 *
 * Terminates because each pass either splits a block — strictly increasing the block
 * count, which is bounded by |Q| — or changes nothing.
 */
const mooreClasses = (
  states: readonly StateId[],
  alphabet: readonly Sym[],
  accepting: ReadonlySet<StateId>,
  delta: Delta,
): Blocks => {
  let blocks = initialPartition(states, accepting);
  for (;;) {
    const next = refined(blocks, states, alphabet, delta);
    // `next` refines `blocks`, so it has at least as many blocks; an equal count means
    // nothing split, and a refinement that splits nothing is the same partition. Both
    // are canonical, so this is a true fixpoint test and not a lucky coincidence.
    if (next.length === blocks.length) return next;
    blocks = next;
  }
};

// ---------------------------------------------------------------------------
// Rebuilding the quotient machine
// ---------------------------------------------------------------------------

/**
 * Any member of a stable block speaks for all of them: stability *means* that every
 * member's move on a given symbol lands in the same block.
 */
const representativeOf = (blocks: Blocks, b: number): StateId => blocks[b][0];

/** Sorted members joined: {q3, q0} is drawn "q0|q3"; a lone {q0} keeps its own name. */
const mergedName = (block: readonly StateId[]): string => block.join(MERGE_SEP);

const quotient = (
  blocks: Blocks,
  live: Automaton,
  alphabet: readonly Sym[],
  delta: Delta,
): Automaton => {
  const idOf = blockIndex(blocks);
  const accepting = new Set(live.accepting);

  // Breadth-first over the quotient, symbols in sorted order: the start state comes
  // out first (which is what the UI draws first) and the order can never leak the
  // order the transitions happened to be listed in.
  const order: number[] = [blockOf(idOf, live.start)];
  const seen = new Set<number>(order);
  for (let i = 0; i < order.length; i++) {
    for (const sym of alphabet) {
      const to = blockOf(idOf, moveOf(delta, representativeOf(blocks, order[i]), sym));
      if (!seen.has(to)) {
        seen.add(to);
        order.push(to);
      }
    }
  }

  // Every state of `live` is reachable, so every block holds a reachable state, so the
  // walk above must have found every block. Firing means reachability was not applied.
  if (order.length !== blocks.length) {
    throw new Error(`minimize: ${blocks.length - order.length} unreachable block(s) survived`);
  }

  const names = uniqueNames(order.map((b) => mergedName(blocks[b])));
  const nameOf = new Map<number, StateId>(order.map((b, i) => [b, names[i]]));

  const transitions: Transition[] = [];
  order.forEach((b, i) => {
    for (const sym of alphabet) {
      const to = blockOf(idOf, moveOf(delta, representativeOf(blocks, b), sym));
      transitions.push({ from: names[i], on: sym, to: nameOf.get(to) as StateId });
    }
  });

  return {
    states: names,
    alphabet: [...alphabet],
    transitions,
    start: names[0],
    // Accepting and non-accepting states are separated by the *initial* partition and
    // refinement only ever splits, so a block is never mixed: one member decides.
    accepting: order
      .filter((b) => accepting.has(representativeOf(blocks, b)))
      .map((b) => nameOf.get(b) as StateId),
  };
};

// ---------------------------------------------------------------------------
// The trap
// ---------------------------------------------------------------------------

/**
 * The dead state of a minimal complete DFA, if it has one: non-accepting, and every
 * move loops back to itself — so no string can ever escape it into an accept.
 *
 * At most one such state can exist in a *minimal* machine: any two of them would
 * reject exactly the same strings (all of them) and would already have been merged.
 */
const findTrap = (m: Automaton, delta: Delta): StateId | undefined => {
  const accepting = new Set(m.accepting);
  return m.states.find(
    (s) => !accepting.has(s) && m.alphabet.every((sym) => moveOf(delta, s, sym) === s),
  );
};

/**
 * Delete the trap and every edge touching it, leaving those moves *missing*.
 *
 * Language-preserving: a string that reached the trap could never accept, and after
 * this it gets stuck instead — which is also a rejection. What changes is the picture,
 * and the picture is the point (see the module docstring).
 */
const dropTrap = (m: Automaton, trap: StateId): Automaton => ({
  states: m.states.filter((s) => s !== trap),
  // Σ survives the trap: the language is still over the same alphabet, the machine has
  // simply stopped drawing what it does with the symbols it hates.
  alphabet: [...m.alphabet],
  transitions: m.transitions.filter((t) => t.from !== trap && t.to !== trap),
  start: m.start,
  // The trap is non-accepting by construction, so there is nothing to filter here.
  accepting: [...m.accepting],
});

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * The minimal **complete** DFA: unique up to state names, and the machine both public
 * entry points are derived from. The step order is argued in the module docstring.
 */
const minimalComplete = (a: Automaton): Automaton => {
  const deterministic = determinismReport(a).isDeterministic ? a : toDFA(a).dfa;
  const total = complete(deterministic);
  const live = removeUnreachable(total);

  const alphabet = alphabetOf(live);
  const delta = totalDelta(live);
  const states = sortedUnique([...live.states, live.start]);
  const blocks = mooreClasses(states, alphabet, new Set(live.accepting), delta);

  return quotient(blocks, live, alphabet, delta);
};

/**
 * The smallest machine for the same language, **as a human would draw it**.
 *
 * Determinises the input if it is not already a DFA (ε-moves and nondeterminism are
 * both fine), completes it, discards unreachable states, merges the states no string
 * can tell apart, and then deletes the trap — so the result is a *partial* DFA whose
 * failing moves are simply absent, exactly like a textbook diagram.
 *
 * Two exceptions, both of which are the whole machine rather than a dead corner of it:
 * the empty language ∅ minimises to a lone non-accepting state (there is nothing to
 * drop — that state *is* the machine), and Σ* minimises to a lone accepting state.
 *
 * Merged states are named from their sorted members ("q0|q3"), so two runs on the same
 * input produce identical output. Layout is *not* carried over: a merged state has no
 * position, and half a layout is worse than none.
 *
 * Precondition: none. Any `Automaton` is accepted.
 * Postcondition: `accepts(minimize(a), s) === accepts(a, s)` for every string s.
 */
export function minimize(dfa: Automaton): Automaton {
  const m = minimalComplete(dfa);
  const trap = findTrap(m, totalDelta(m));

  // A lone state is never dropped, however dead it looks — that case is the language ∅,
  // whose minimal machine is exactly one rejecting state.
  if (trap === undefined || m.states.length <= MIN_STATES) return m;
  return dropTrap(m, trap);
}

/**
 * How many states this language *needs* — the par score for "build it in N states".
 *
 * The **complete-DFA** count: the number of Myhill–Nerode classes of Σ*, which
 * includes the class of dead words when the language has any. This deliberately
 * differs from `minimize(a).states.length`, which omits the trap because a diagram
 * should not draw one. "Contains ab" over {a,b} scores 3 (no dead words); "exactly ab"
 * scores 4 (three live classes plus the dead one), which is what a textbook says.
 *
 * Precondition: none. NFAs are determinised first, so this is the minimal *DFA* size —
 * an NFA may well be smaller, which is a later lesson, not a bug here.
 */
export function minimalStateCount(a: Automaton): number {
  return minimalComplete(a).states.length;
}
