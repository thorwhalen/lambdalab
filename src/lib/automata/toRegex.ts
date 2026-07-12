/**
 * State elimination — a machine becomes a regular expression.
 *
 * This is the other half of Kleene's theorem (Thompson's construction, in
 * `thompson.ts`, is the first half), and together they close the loop the whole
 * lesson turns on: every machine is a regex, every regex is a machine. So this
 * code, like Thompson's, is written to be *watched*: `automatonToRegexSteps`
 * hands the UI one frame per ripped-out state, with the running answer.
 *
 * THE WORKING GRAPH (a GNFA)
 * --------------------------
 * We do not eliminate states on the `Automaton` itself. We build a *generalised*
 * NFA: the same states, but each arrow is labelled with a whole **regex** rather
 * than a single symbol, and between any ordered pair of states there is at most
 * ONE arrow (parallel edges are folded together with `|` on the way in). That
 * single-arrow invariant is what makes the elimination rule a one-liner instead
 * of a case analysis.
 *
 * NORMALISATION, AND WHY IT IS UNCONDITIONAL
 * -----------------------------------------
 * Before eliminating anything we add a FRESH start state (an ε-arrow to the old
 * start) and a FRESH single accepting state (an ε-arrow from each old accepting
 * state). The fresh start therefore has no incoming arrow and the fresh accept
 * has no outgoing one, which is precisely what lets the elimination rule below
 * assume that the two survivors never need to be rewired *through* themselves.
 *
 * We do this even when the machine already "looks fine". A start state that is
 * itself accepting, or that has an arrow back into it, silently breaks the naive
 * rule — and the whole point of a fixed normalisation is that nobody has to
 * notice. Uniformity beats cleverness; the cost is two states nobody sees.
 *
 * ELIMINATION ORDER
 * -----------------
 * Order does not change the language, but it changes the *size* of the answer by
 * orders of magnitude: ripping out a hub with 4 ways in and 4 ways out creates 16
 * new arrows, each carrying a copy of the hub's label. So we greedily remove the
 * state that creates fewest new arrows — the one minimising in-degree × out-degree
 * (self-loops excluded from both counts, since a self-loop is not a way in or a
 * way out, it is a factor on the arrow we build). Ties break by state name, in
 * code-unit order, so two runs eliminate in the same order and produce the same
 * regex. This is a heuristic, not an optimum: choosing the true best order is not
 * something we need, and a child watching the animation needs "always rip out the
 * simplest-looking state next", which is exactly what this does.
 *
 * DETERMINISM
 * -----------
 * Every iteration in this file is over a sorted key array. The UI diffs frames on
 * state names and on the rendered regex, so a stable answer is a correctness
 * property, not a nicety.
 */

import {
  EPSILON,
  type Automaton,
  type RegexNode,
  type StateId,
  type Transition,
} from './types';
import { renderRegex, simplifyRegex } from './regexParse';
import { alphabetOf, reachableStates } from './simulate';

/**
 * One frame of the animation.
 *
 * NOTE on `before`: it is the working GNFA *as it stood before this removal*,
 * squeezed into the `Automaton` contract so the existing canvas can draw it.
 * Each transition's `on` is therefore a **rendered regex** (`ab*`, `ε`, `∅`),
 * not a single alphabet symbol. It is for drawing only — do not simulate it.
 * `before.start` is the fresh start and `before.accepting` is the fresh accept.
 */
export interface EliminationStep {
  removed: StateId;
  before: Automaton;
  explain: string;
  /** The answer so far: R(freshStart, freshAccept), rendered. `∅` while there is none yet. */
  regexSoFar: string;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Names for the two states normalisation adds. Read by children, so: English. */
const FRESH_START = 'START';
const FRESH_ACCEPT = 'ACCEPT';

/** Suffix used to dodge a collision with a state the learner already named START. */
const DISAMBIGUATOR = "'";

/** Raw code-unit order. Never `localeCompare`: its collation is host-dependent. */
const byCodeUnit = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

const sortedUnique = (xs: Iterable<string>): string[] => [...new Set(xs)].sort(byCodeUnit);

/** A name not in `taken`, grown by appending `'` until it is free. Always terminates. */
const freshName = (base: string, taken: ReadonlySet<StateId>): StateId => {
  let name = base;
  while (taken.has(name)) name += DISAMBIGUATOR;
  return name;
};

// ---------------------------------------------------------------------------
// The working graph
// ---------------------------------------------------------------------------

/**
 * from -> to -> the single regex on that arrow. An absent entry is ∅ (no arrow),
 * which is *not* the same as an arrow labelled ε — hence a missing key rather
 * than a stored `{kind:'empty'}` node anywhere in here.
 */
type Gnfa = Map<StateId, Map<StateId, RegexNode>>;

const NODE_EMPTY: RegexNode = { kind: 'empty' };

const edgeOf = (g: Gnfa, from: StateId, to: StateId): RegexNode | undefined =>
  g.get(from)?.get(to);

/** Union `label` into the arrow from → to, folding parallel edges. Simplifies as it goes. */
const addEdge = (g: Gnfa, from: StateId, to: StateId, label: RegexNode): void => {
  let row = g.get(from);
  if (!row) {
    row = new Map<StateId, RegexNode>();
    g.set(from, row);
  }
  const existing = row.get(to);
  row.set(
    to,
    existing === undefined
      ? simplifyRegex(label)
      : simplifyRegex({ kind: 'union', left: existing, right: label }),
  );
};

/** Drop `q` and every arrow that touches it. */
const dropState = (g: Gnfa, q: StateId): void => {
  g.delete(q);
  for (const row of g.values()) row.delete(q);
};

/** The label a transition contributes: ε-moves are the ε regex, everything else a literal. */
const labelOfTransition = (t: Transition): RegexNode =>
  t.on === EPSILON ? { kind: 'epsilon' } : { kind: 'literal', sym: t.on };

/**
 * Canonical order on transitions.
 *
 * Parallel edges are folded with `|`, and `|` is *not* commutative in the answer
 * we print: folding in list order would make a machine whose edges were typed in
 * a different order come out as `(b|a)*` instead of `(a|b)*`. Same language, but
 * the UI diffs on the rendered string, so it must not move. Sorting the edges
 * before folding is the whole fix.
 */
const byTransition = (x: Transition, y: Transition): number =>
  byCodeUnit(x.from, y.from) || byCodeUnit(x.on, y.on) || byCodeUnit(x.to, y.to);

/** Concatenate in order, skipping absent factors; `simplifyRegex` folds the ε/∅ cases. */
const concatOf = (parts: ReadonlyArray<RegexNode | undefined>): RegexNode => {
  const factors = parts.filter((p): p is RegexNode => p !== undefined);
  if (factors.length === 0) return { kind: 'epsilon' };
  return simplifyRegex(factors.reduce((left, right) => ({ kind: 'concat', left, right })));
};

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

interface Working {
  g: Gnfa;
  /** Live states, always sorted: the two fresh ones plus the surviving originals. */
  states: StateId[];
  start: StateId;
  accept: StateId;
  /** Carried only so the animation frames can reuse the machine's Σ and geometry. */
  source: Automaton;
}

/**
 * Build the normalised GNFA: fresh start, fresh single accept, one folded arrow
 * per ordered pair.
 *
 * Two prunings, both language-preserving and both about the *size* of the answer
 * rather than its truth:
 *
 * - States unreachable from the start are dropped. They cannot lie on any path
 *   from the fresh start to the fresh accept, so no arrow they carry can ever
 *   reach R(START, ACCEPT) — but eliminating them would still churn out arrows
 *   and, worse, animation frames about states the child cannot even see.
 * - Transitions naming a state outside Q are not transitions at all (same rule as
 *   the simulator: δ ⊆ Q × (Σ ∪ {ε}) × Q, and the textbook is the SSOT). Q here is
 *   `states ∪ {start}`, so a machine that forgot to list its start state is repaired.
 */
function normalize(a: Automaton): Working {
  const q = new Set(sortedUnique([...a.states, a.start]));
  const live = new Set([...reachableStates(a)].filter((s) => q.has(s)));

  const names = new Set(q);
  const start = freshName(FRESH_START, names);
  names.add(start);
  const accept = freshName(FRESH_ACCEPT, names);

  const g: Gnfa = new Map();
  for (const t of [...a.transitions].sort(byTransition)) {
    if (!live.has(t.from) || !live.has(t.to)) continue;
    addEdge(g, t.from, t.to, labelOfTransition(t));
  }

  addEdge(g, start, a.start, { kind: 'epsilon' });
  for (const f of sortedUnique(a.accepting)) {
    // An accepting state the machine cannot reach accepts nothing; skipping it is
    // what keeps `∅` falling out of the empty-language cases all by itself.
    if (live.has(f)) addEdge(g, f, accept, { kind: 'epsilon' });
  }

  return {
    g,
    states: [start, accept, ...live].sort(byCodeUnit),
    start,
    accept,
    source: a,
  };
}

// ---------------------------------------------------------------------------
// Elimination
// ---------------------------------------------------------------------------

/** States we may rip out: everything except the two the normalisation added. */
const eliminable = (w: Working): StateId[] =>
  w.states.filter((s) => s !== w.start && s !== w.accept);

/** Arrows into `q` from someone else, sorted. Self-loops excluded — they are not a way in. */
const predecessorsOf = (w: Working, q: StateId): StateId[] =>
  w.states.filter((p) => p !== q && edgeOf(w.g, p, q) !== undefined);

/** Arrows out of `q` to someone else, sorted. Self-loops excluded — they are not a way out. */
const successorsOf = (w: Working, q: StateId): StateId[] =>
  w.states.filter((r) => r !== q && edgeOf(w.g, q, r) !== undefined);

/**
 * The next state to rip out: fewest new arrows created, i.e. min in×out (self-loops
 * excluded), ties broken by name. Returns undefined when only the fresh pair is left.
 *
 * `w.states` is sorted, so scanning it and keeping a *strict* improvement gives the
 * code-unit-smallest name among the minima — the tie-break, for free.
 */
function pickVictim(w: Working): StateId | undefined {
  let best: StateId | undefined;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const q of eliminable(w)) {
    const cost = predecessorsOf(w, q).length * successorsOf(w, q).length;
    if (cost < bestCost) {
      best = q;
      bestCost = cost;
    }
  }
  return best;
}

/**
 * The rule, and the only piece of mathematics in this file:
 *
 *     R(p, r) := R(p, r) | R(p, q) · R(q, q)* · R(q, r)
 *
 * for every predecessor p and successor r of q (p, r ≠ q), after which q and all
 * of its arrows go away. Every path through q is `in, loop any number of times,
 * out` — so the new label spells exactly the words the removed detour spelled, and
 * the old alternatives (`R(p, r)`) survive alongside it.
 *
 * With no self-loop the `R(q,q)*` factor is simply omitted (it would be ε).
 */
function eliminate(w: Working, q: StateId): void {
  const loop = edgeOf(w.g, q, q);
  const loopStar = loop === undefined ? undefined : simplifyRegex({ kind: 'star', inner: loop });
  const ins = predecessorsOf(w, q);
  const outs = successorsOf(w, q);

  // Snapshot before mutating: a rewrite of R(p, r) must not be visible to the
  // rewrite of the next pair, or we would be re-eliminating q through itself.
  const inLabels = new Map(ins.map((p) => [p, edgeOf(w.g, p, q) as RegexNode]));
  const outLabels = new Map(outs.map((r) => [r, edgeOf(w.g, q, r) as RegexNode]));

  for (const p of ins) {
    for (const r of outs) {
      addEdge(w.g, p, r, concatOf([inLabels.get(p), loopStar, outLabels.get(r)]));
    }
  }

  dropState(w.g, q);
  w.states = w.states.filter((s) => s !== q);
}

/** The answer as it stands: R(freshStart, freshAccept), or ∅ when there is no such arrow. */
const answerOf = (w: Working): RegexNode =>
  simplifyRegex(edgeOf(w.g, w.start, w.accept) ?? NODE_EMPTY);

// ---------------------------------------------------------------------------
// Frames for the animation
// ---------------------------------------------------------------------------

/** The working GNFA as a drawable `Automaton`. See the note on `EliminationStep.before`. */
function snapshot(w: Working): Automaton {
  const transitions: Transition[] = [];
  for (const from of w.states) {
    const row = w.g.get(from);
    if (!row) continue;
    for (const to of w.states) {
      const label = row.get(to);
      if (label !== undefined) transitions.push({ from, on: renderRegex(label), to });
    }
  }

  const layout = w.source.layout;
  const machine: Automaton = {
    states: [...w.states],
    alphabet: alphabetOf(w.source),
    transitions,
    start: w.start,
    accepting: [w.accept],
  };
  // Geometry for the surviving originals only: the two fresh states are the UI's
  // to place, and inventing coordinates for them here would be a layout decision
  // taken in the wrong module.
  if (layout) {
    const kept = Object.fromEntries(
      w.states.filter((s) => s in layout).map((s) => [s, layout[s]]),
    );
    if (Object.keys(kept).length > 0) machine.layout = kept;
  }
  return machine;
}

const listNames = (xs: StateId[]): string => xs.join(', ');

/**
 * The caption for one frame, in words a twelve-year-old reads once and gets.
 * Built from the state as it is *before* the removal — so it must be called first.
 */
function explainRemoval(w: Working, q: StateId): string {
  const ins = predecessorsOf(w, q);
  const outs = successorsOf(w, q);
  const loop = edgeOf(w.g, q, q);

  if (ins.length === 0 || outs.length === 0) {
    const why =
      ins.length === 0
        ? `Nothing arrives at ${q} any more`
        : `Nothing leaves ${q}, so every path into it is a dead end`;
    return `Rip out state ${q}. ${why} — no path can pass through it, so its arrows just vanish.`;
  }

  const loopPart = loop
    ? `, then go round its own loop (${renderRegex(loop)}) as many times as you like`
    : '';
  const rewired = ins.flatMap((p) =>
    outs.map((r) => {
      const label = concatOf([
        edgeOf(w.g, p, q),
        loop === undefined ? undefined : simplifyRegex({ kind: 'star', inner: loop }),
        edgeOf(w.g, q, r),
      ]);
      return `${p} → ${r} labelled ${renderRegex(label)}`;
    }),
  );

  return (
    `Rip out state ${q}. Any path that went in through ${listNames(ins)} and out to ` +
    `${listNames(outs)} must now be spelled out on a single arrow: whatever got you in${loopPart}, ` +
    `then whatever got you out. New arrows: ${rewired.join('; ')}.`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The regular expression for `a`'s language, by state elimination, simplified.
 *
 * `{kind:'empty'}` (∅) exactly when the machine accepts nothing at all — including
 * the machine with no accepting state, and the one whose accepting states cannot be
 * reached. The empty *string* language is `{kind:'epsilon'}`, which is a different
 * answer, and the lesson cares about the difference.
 *
 * Total: no automaton makes this throw. Malformed edges (naming a state that does
 * not exist) are ignored, exactly as the simulator ignores them.
 */
export function automatonToRegex(a: Automaton): RegexNode {
  const w = normalize(a);
  for (;;) {
    const q = pickVictim(w);
    if (q === undefined) break;
    eliminate(w, q);
  }
  return answerOf(w);
}

/**
 * One frame per ripped-out state, in the order the heuristic rips them.
 *
 * There is exactly one step per state reachable from the start (unreachable states
 * are pruned before the animation begins — they cannot lie on any accepting path).
 * `steps[i].before` is the graph *as it was* when `steps[i].removed` was chosen, and
 * the last step's `regexSoFar` is `renderRegex(automatonToRegex(a))` — the two entry
 * points share one implementation, so the animation cannot drift from the answer.
 *
 * A machine whose only state is its start state still yields one step (that state is
 * eliminable — only the two fresh states are not).
 */
export function automatonToRegexSteps(a: Automaton): EliminationStep[] {
  const w = normalize(a);
  const steps: EliminationStep[] = [];

  for (;;) {
    const q = pickVictim(w);
    if (q === undefined) break;
    // Order matters: both the caption and the snapshot describe the graph BEFORE
    // the removal, and `eliminate` mutates it.
    const explain = explainRemoval(w, q);
    const before = snapshot(w);
    eliminate(w, q);
    steps.push({ removed: q, before, explain, regexSoFar: renderRegex(answerOf(w)) });
  }

  return steps;
}
