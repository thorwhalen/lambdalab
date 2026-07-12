/**
 * Subset construction and the boolean closure operations.
 *
 * This is where nondeterminism is *paid off*. `toDFA` turns "the machine could be
 * in any of these states" into a single state of a new machine, and once a
 * language is carried by a total DFA the boolean operations become structural:
 * complement is a flip of the accepting set, intersection is a cross-product.
 *
 * Three invariants everything downstream leans on:
 *
 * - **Every DFA we hand back is TOTAL.** Every state has exactly one move on every
 *   symbol of Σ, with an explicit trap wherever the NFA had nowhere to go. This is
 *   not tidiness. A *partial* machine rejects a string in two different ways — by
 *   ending outside the accepting set, or by dying mid-word — and flipping the
 *   accepting set only reverses the first. Complementing a partial machine is THE
 *   classic bug; totality makes it impossible rather than merely tested-for.
 *
 * - **Names are a display concern; identity is not.** A DFA state *is* a set of NFA
 *   states and a product state *is* a pair of states. We key identity off a
 *   canonical encoding of that set/pair and assign the pretty name ("{q0,q2}",
 *   "(p,q)") afterwards — because the pretty forms are not injective: an NFA state
 *   named 'a,b' and the two-state subset {'a','b'} both print as "{a,b}". Naming
 *   first would silently merge two distinct states, i.e. change the language the
 *   child is being graded on.
 *
 * - **Σ is the *declared* alphabet unioned with the used one** (`alphabetOf`). A
 *   symbol the learner declared but never drew an edge for still needs a move —
 *   otherwise complement and product are computed over the wrong Σ*, which is the
 *   quiet way to get a right-looking machine for the wrong language.
 *
 * Ordering is by UTF-16 code unit throughout, never `localeCompare` (see
 * `simulate.ts`): generated state names must not vary with the host's ICU build.
 */

import { EPSILON, type Automaton, type StateId, type Sym, type Transition } from './types';
import { alphabetOf, determinismReport, epsilonClosure, step } from './simulate';

// ---------------------------------------------------------------------------
// Notation — the names the UI will show, in one place
// ---------------------------------------------------------------------------

/** The trap: the state that stands for "the NFA could be in no state at all". */
const TRAP_NAME = '∅';

const SUBSET_OPEN = '{';
const SUBSET_CLOSE = '}';
const SUBSET_SEP = ',';

const PAIR_OPEN = '(';
const PAIR_CLOSE = ')';
const PAIR_SEP = ',';

/** Appended when a preferred name is already taken: "{a,b}", then "{a,b}#2", … */
const DISAMBIGUATOR = '#';

/** First suffix tried by `freshName`. The unsuffixed name is conceptually "#1". */
const FIRST_ALTERNATIVE = 2;

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
 * Collisions are pathological (they need a state id containing the separator) but
 * a collision would *merge* two states, so we cannot merely hope they don't happen.
 * `preferred` is consumed in order, and every caller's order is content-determined,
 * so which state gets the clean name is reproducible.
 */
const uniqueNames = (preferred: readonly string[]): StateId[] => {
  const taken = new Set<StateId>();
  return preferred.map((base) => {
    const name = freshName(base, taken);
    taken.add(name);
    return name;
  });
};

/** "{q0,q2}", or "∅" for the empty subset. `members` must be sorted. */
const subsetName = (members: readonly StateId[]): string =>
  members.length === 0
    ? TRAP_NAME
    : `${SUBSET_OPEN}${members.join(SUBSET_SEP)}${SUBSET_CLOSE}`;

const pairName = (p: StateId, q: StateId): string =>
  `${PAIR_OPEN}${p}${PAIR_SEP}${q}${PAIR_CLOSE}`;

/**
 * Injective identity for a subset or a pair — JSON, never the display name.
 *
 * The whole point: `subsetName(['a,b']) === subsetName(['a','b'])`, so keying a
 * subset by its display name would fuse two different sets of NFA states.
 */
const keyOf = (parts: readonly StateId[]): string => JSON.stringify(parts);

// ---------------------------------------------------------------------------
// The worklist — one deterministic explorer for both constructions
// ---------------------------------------------------------------------------

/**
 * Breadth-first exploration of a state space whose members are tuples of ids.
 *
 * Determinism: the seed and the successor function are functions of the input
 * machines' *content*, and symbols are consumed in sorted order, so discovery
 * order never leaks the order in which transitions happened to be listed. The
 * start state is always index 0, which is what puts it first in the UI.
 *
 * The `for` loop grows the array it iterates — that array *is* the FIFO queue.
 */
const explore = (
  seed: StateId[],
  alphabet: readonly Sym[],
  successor: (from: StateId[], sym: Sym) => StateId[],
): { nodes: StateId[][]; delta: Array<Map<Sym, number>> } => {
  const nodes: StateId[][] = [];
  const indexOfKey = new Map<string, number>();
  const delta: Array<Map<Sym, number>> = [];

  const discover = (node: StateId[]): number => {
    const key = keyOf(node);
    const seen = indexOfKey.get(key);
    if (seen !== undefined) return seen;
    const i = nodes.length;
    nodes.push(node);
    indexOfKey.set(key, i);
    return i;
  };

  discover(seed);
  for (let i = 0; i < nodes.length; i++) {
    const bySym = new Map<Sym, number>();
    for (const sym of alphabet) bySym.set(sym, discover(successor(nodes[i], sym)));
    // Pushed exactly once per i, in order, so `delta[i]` always describes `nodes[i]`.
    delta.push(bySym);
  }

  return { nodes, delta };
};

/** Edges of an explored space, emitted in (discovery order × sorted Σ) order. */
const edgesOf = (
  names: readonly StateId[],
  alphabet: readonly Sym[],
  delta: ReadonlyArray<Map<Sym, number>>,
): Transition[] => {
  const transitions: Transition[] = [];
  for (let i = 0; i < names.length; i++) {
    for (const sym of alphabet) {
      // Every symbol of Σ was written by `explore`, so this is always defined.
      const to = delta[i].get(sym) as number;
      transitions.push({ from: names[i], on: sym, to: names[to] });
    }
  }
  return transitions;
};

// ---------------------------------------------------------------------------
// Subset construction
// ---------------------------------------------------------------------------

/**
 * Determinise an ε-NFA by subset construction.
 *
 * The result is a **total** DFA over `alphabetOf(a)`: every state has exactly one
 * move on every symbol. The empty subset, if it is reachable, becomes an explicit
 * trap state named "∅" that loops to itself — that is what makes `complement`
 * a one-line flip and keeps it correct.
 *
 * Only *reachable* subsets are built (the powerset is 2^n and almost all of it is
 * unreachable rubbish). States are returned in breadth-first discovery order, so
 * the start state is first.
 *
 * `mapping` sends each DFA state to the sorted NFA states it stands for — the UI
 * shows "this state means: the NFA could be in q0 or q2". The trap maps to `[]`.
 */
export function toDFA(a: Automaton): { dfa: Automaton; mapping: Record<StateId, StateId[]> } {
  const alphabet = alphabetOf(a);
  const acceptingNfa = new Set(a.accepting);

  // `epsilonClosure` and `step` both return ε-closed, sorted sets, which is exactly
  // the canonical form a subset's identity and name are built from.
  const seed = [...epsilonClosure(a, [a.start])];
  const { nodes, delta } = explore(seed, alphabet, (from, sym) => [...step(a, from, sym)]);

  const names = uniqueNames(nodes.map(subsetName));

  const mapping: Record<StateId, StateId[]> = {};
  nodes.forEach((members, i) => {
    mapping[names[i]] = [...members];
  });

  const dfa: Automaton = {
    states: names,
    alphabet,
    transitions: edgesOf(names, alphabet, delta),
    start: names[0],
    // A subset accepts iff the NFA *could* have landed on an accepting state.
    accepting: names.filter((_, i) => nodes[i].some((s) => acceptingNfa.has(s))),
  };

  return { dfa, mapping };
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/**
 * Make every (state, symbol) pair have a move, by routing the missing ones to a
 * trap state that loops to itself and accepts nothing.
 *
 * If the machine is already total it is returned **unchanged** — the same object,
 * with the same state names and the same order: the editor's layout and the UI's
 * diff both depend on us not churning a machine we had nothing to add to.
 *
 * `trapName` is a *preferred* name: if the machine already has a state by that
 * name we suffix it ("∅#2") rather than fusing the trap into an existing state.
 *
 * Precondition: none. This does not determinise — ε-moves and nondeterminism are
 * left exactly as they are. Completing an NFA is meaningful and language-preserving;
 * it is just not enough for `complement`, which must determinise first.
 */
export function complete(dfa: Automaton, trapName: StateId = TRAP_NAME): Automaton {
  const report = determinismReport(dfa);
  if (report.isTotal) return dfa;

  const alphabet = alphabetOf(dfa);
  // Q = declared states ∪ {start}: the start state is a state by definition, and
  // `missing` is reported over that Q — so the trap edges we add below can only
  // land on states we actually declare.
  const q = uniqueInOrder([...dfa.states, dfa.start]);
  const trap = freshName(trapName, new Set(q));

  const completed: Automaton = {
    states: [...q, trap],
    alphabet,
    transitions: [
      ...dfa.transitions,
      // `missing` is enumerated over sorted Q × sorted Σ, so these are stable.
      ...report.missing.map(({ state, on }) => ({ from: state, on, to: trap })),
      ...alphabet.map((on) => ({ from: trap, on, to: trap })),
    ],
    start: dfa.start,
    accepting: [...dfa.accepting],
  };

  // Geometry is not maths, but throwing it away would scramble the editor.
  if (dfa.layout) completed.layout = dfa.layout;
  return completed;
}

// ---------------------------------------------------------------------------
// Complement
// ---------------------------------------------------------------------------

/**
 * The machine accepting exactly the strings `a` rejects.
 *
 * Determinise, complete, *then* flip. The order is the whole point: flipping the
 * accepting set of a machine that rejects by getting *stuck* leaves those strings
 * rejected (there is no run at all to re-label), so the complement would silently
 * lose them. `toDFA` already returns a total machine; `complete` here is the
 * assertion of that invariant, not a hopeful extra step.
 *
 * **Precondition — complement is relative to an alphabet.** "Everything else" is
 * only meaningful against a Σ, and the only Σ available is the machine's own:
 * `alphabetOf(a)` = what `a` declares, unioned with what it draws. So
 * `complement(m)` where Σ(m) = {a} is the complement within {a}*, and it will not
 * accept 'b'. A caller who wants the complement within a *wider* Σ must widen the
 * machine first — `complement({ ...m, alphabet: [...] })`. `product` does exactly
 * this to its operands; a caller who complements before calling `product` does not
 * get it for free. (Declaring a symbol is enough — no edge is needed.)
 */
export function complement(a: Automaton): Automaton {
  const total = complete(toDFA(a).dfa);
  const accepting = new Set(total.accepting);
  return {
    ...total,
    // Filtered over `states`, so the order is the DFA's discovery order.
    accepting: total.states.filter((s) => !accepting.has(s)),
  };
}

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------

/** The boolean combinations `product` can build. */
export type BooleanOp = 'and' | 'or' | 'xor' | 'minus';

/**
 * When is a pair (p, q) accepting, given whether each side accepts?
 *
 * A table rather than a switch: adding an operation must not mean touching the
 * construction, and every op is visibly a boolean function of two bits.
 */
const ACCEPTS_PAIR: Record<BooleanOp, (a: boolean, b: boolean) => boolean> = {
  and: (x, y) => x && y,
  or: (x, y) => x || y,
  xor: (x, y) => x !== y,
  minus: (x, y) => x && !y,
};

/**
 * A total DFA for `m` over exactly `alphabet`, which must contain Σ(m).
 *
 * Widening the *declared* alphabet before totalising is what makes a product of
 * machines with different alphabets correct: over the union alphabet a machine
 * with no 'b'-move must *reject* every string containing 'b', and that requires an
 * explicit trap on 'b' — a missing edge would work by accident here and betray us
 * the moment the result is complemented.
 *
 * A machine that is already deterministic keeps its own state names (only the trap
 * is new), so the common lesson case reads "(q0,p1)" rather than "({q0},{p1})".
 */
const asTotalDFA = (m: Automaton, alphabet: Sym[]): Automaton => {
  const widened: Automaton = { ...m, alphabet };
  return determinismReport(widened).isDeterministic ? complete(widened) : toDFA(widened).dfa;
};

/** δ of a machine `asTotalDFA` has already made deterministic: from -> sym -> to. */
const deterministicDelta = (m: Automaton): Map<StateId, Map<Sym, StateId>> => {
  const q = new Set([...m.states, m.start]);
  const delta = new Map<StateId, Map<Sym, StateId>>();

  for (const t of m.transitions) {
    // ε cannot occur (the machine is deterministic) and a dangling edge is not a
    // member of δ — both are dropped rather than trusted. See `simulate.ts`.
    if (t.on === EPSILON || !q.has(t.from) || !q.has(t.to)) continue;

    let bySym = delta.get(t.from);
    if (!bySym) {
      bySym = new Map<Sym, StateId>();
      delta.set(t.from, bySym);
    }
    const current = bySym.get(t.on);
    // There is only ever one target here. Should a bug upstream produce two, take
    // the code-unit-smallest: a wrong answer must at least be a reproducible one.
    if (current === undefined || byCodeUnit(t.to, current) < 0) bySym.set(t.on, t.to);
  }

  return delta;
};

const moveOf = (delta: Map<StateId, Map<Sym, StateId>>, from: StateId, on: Sym): StateId => {
  const to = delta.get(from)?.get(on);
  // Unreachable: `asTotalDFA` guarantees a move on every symbol of the union
  // alphabet from every state. Firing means that invariant broke — an engine bug,
  // not bad input, so it must be loud rather than quietly mis-grading a child.
  if (to === undefined) throw new Error(`product: no '${on}' move from '${from}' — not total`);
  return to;
};

/**
 * The cross-product machine of `a` and `b` under a boolean operation.
 *
 * Both sides are determinised and completed over the **union** of their alphabets
 * first, so the result is a total DFA over that union and every op is decided by
 * looking at one pair of states. Only reachable pairs are built; state names are
 * "(p,q)".
 *
 * `minus` is a − b: the strings `a` accepts and `b` does not.
 */
export function product(a: Automaton, b: Automaton, op: BooleanOp): Automaton {
  const alphabet = sortedUnique([...alphabetOf(a), ...alphabetOf(b)]);

  const da = asTotalDFA(a, alphabet);
  const db = asTotalDFA(b, alphabet);
  const deltaA = deterministicDelta(da);
  const deltaB = deterministicDelta(db);

  const isAccepting = ACCEPTS_PAIR[op];
  const acceptA = new Set(da.accepting);
  const acceptB = new Set(db.accepting);

  const { nodes, delta } = explore([da.start, db.start], alphabet, ([p, q], sym) => [
    moveOf(deltaA, p, sym),
    moveOf(deltaB, q, sym),
  ]);

  const names = uniqueNames(nodes.map(([p, q]) => pairName(p, q)));

  return {
    states: names,
    alphabet,
    transitions: edgesOf(names, alphabet, delta),
    start: names[0],
    accepting: names.filter((_, i) => isAccepting(acceptA.has(nodes[i][0]), acceptB.has(nodes[i][1]))),
  };
}
