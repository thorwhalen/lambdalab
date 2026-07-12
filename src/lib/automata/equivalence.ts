/**
 * Machine equivalence — and, when two machines differ, the SHORTEST string they
 * disagree on.
 *
 * The counterexample is the whole point. "Wrong" teaches nothing; "your machine
 * accepts 'aab', but it shouldn't" teaches. So this module is built around one
 * guarantee: when we say two machines differ, we hand back the *smallest* witness,
 * ties broken lexicographically by the union alphabet's sort order — the same string
 * on every run, so a lesson's feedback is reproducible and the UI can diff on it.
 *
 * Two traps this module exists to avoid:
 *
 * - **Comparing over the wrong Σ.** A machine over {a} and a machine over {a,b} must
 *   be compared over {a,b}. Otherwise 'b' is invisible, and a learner's machine that
 *   simply forgot the letter 'b' gets congratulated. `product` widens both operands to
 *   the union alphabet, determinises and completes them before combining — which is
 *   exactly the fix, and the reason the construction is delegated to it rather than
 *   re-derived here. There is then no Σ left for this module to get wrong.
 *
 * - **Finding *a* counterexample rather than *the* counterexample.** Any search finds
 *   a disagreeing string; a depth-first one finds a long one, and a different one
 *   whenever the transition list is reordered. We breadth-first search by increasing
 *   length, expanding symbols in sorted order, so the first disagreement discovered is
 *   minimal under (length, then lexicographic) — see `shortestAcceptedOf` for why that
 *   minimality falls out of the queue discipline rather than being hoped for.
 *
 * Completeness is free, and worth stating: two inequivalent machines always disagree on
 * a string shorter than the number of reachable states of their product, so an
 * exhaustive BFS of that (finite) product needs no depth limit and can never report
 * `equal` on machines that actually differ. `equivalent` is a decision procedure, not a
 * search that gave up.
 *
 * Ordering is by UTF-16 code unit throughout, never `localeCompare` (see `simulate.ts`):
 * which counterexample a child is shown must not depend on the host's ICU build.
 */

import { EPSILON, type Automaton, type Equivalence, type StateId, type Sym } from './types';
import { accepts, alphabetOf } from './simulate';
import { product, toDFA } from './subset';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * How far `shortestAccepted` looks before giving up.
 *
 * A DFA with n states, if its language is non-empty, accepts something of length < n,
 * so this is really a guard against pathological subset blow-up rather than a real
 * limit on lesson machines — which are small by construction.
 */
const DEFAULT_SHORTEST_LIMIT = 20;

/** The BFS root has no parent. */
const NO_PARENT = -1;

/** ε is a string, and it has length 0. A *negative* budget admits nothing at all. */
const MIN_LENGTH = 0;

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/** Total order on symbols and ids: raw UTF-16 code units. See the module docstring. */
const byCodeUnit = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

const sortedUnique = (xs: Iterable<string>): string[] => [...new Set(xs)].sort(byCodeUnit);

// ---------------------------------------------------------------------------
// The core search
// ---------------------------------------------------------------------------

/**
 * δ as a lookup: from -> symbol -> to.
 *
 * A *missing* entry means "no move", which the search below reads as "the run dies
 * here" — so this stays correct on a partial machine, and never throws. Should a caller
 * hand us a nondeterministic machine despite the precondition, the code-unit-smallest
 * target wins: a wrong answer must at least be a reproducible one (`subset.ts` makes the
 * same choice, for the same reason).
 */
const deterministicDelta = (m: Automaton): Map<StateId, Map<Sym, StateId>> => {
  // Q = declared states ∪ {start}: the start state is a state by definition.
  const q = new Set<StateId>([...m.states, m.start]);
  const delta = new Map<StateId, Map<Sym, StateId>>();

  for (const t of m.transitions) {
    // ε is a free move, never a consumed symbol; and an edge naming a state outside Q
    // is not an element of δ — it is malformed data. Both are dropped, not trusted.
    if (t.on === EPSILON || !q.has(t.from) || !q.has(t.to)) continue;

    let bySym = delta.get(t.from);
    if (!bySym) {
      bySym = new Map<Sym, StateId>();
      delta.set(t.from, bySym);
    }
    const current = bySym.get(t.on);
    if (current === undefined || byCodeUnit(t.to, current) < 0) bySym.set(t.on, t.to);
  }

  return delta;
};

/**
 * The shortest string a *deterministic* machine accepts — lexicographically first among
 * the shortest — or null when there is none of length ≤ `maxLen`.
 *
 * Why the queue discipline yields (length, lex) minimality, rather than merely some
 * short string: states are discovered in non-decreasing order of the word that
 * discovered them. That holds for the root (ε), and every push preserves it — a state
 * dequeued with word `w` pushes `w·σ` for σ ascending, and appending to a
 * non-decreasing sequence of words keeps it non-decreasing (words of equal length
 * compare by their first difference, which the shared prefix `w` cannot disturb). So a
 * state's *first* discovery carries its minimal word, and the first accepting state
 * discovered carries the minimal accepted word overall: every accepted word runs
 * through some accepting state, whose own minimal word is no larger and is also
 * accepted.
 *
 * Preconditions: `m` is deterministic (at most one move per (state, symbol)). It need
 * NOT be total — a missing move is a run that dies, which is just rejection. `maxLen`
 * undefined means exhaustive, which is safe: the state space is finite and no state is
 * ever expanded twice.
 */
const shortestAcceptedOf = (m: Automaton, maxLen?: number): string | null => {
  // A fractional budget would let the last expansion overshoot it; floor it once, here.
  const budget = maxLen === undefined ? undefined : Math.floor(maxLen);
  if (budget !== undefined && budget < MIN_LENGTH) return null;

  const alphabet = alphabetOf(m); // sorted, unique, ε excluded
  const delta = deterministicDelta(m);
  const accepting = new Set(m.accepting);

  // Parallel arrays over discovery order. `order` doubles as the FIFO queue: the loop
  // below grows the array it is iterating (the same idiom as `explore` in `subset.ts`).
  // Parent pointers rather than a word per queue entry: reconstructing once at the end
  // costs O(depth) instead of carrying O(depth) of string per state discovered.
  const order: StateId[] = [m.start];
  const parent: number[] = [NO_PARENT];
  const via: Sym[] = ['']; // never read for the root; the walk stops at NO_PARENT
  const depth: number[] = [MIN_LENGTH];
  const seen = new Set<StateId>([m.start]);

  const wordAt = (i: number): string => {
    const syms: Sym[] = [];
    for (let k = i; parent[k] !== NO_PARENT; k = parent[k]) syms.push(via[k]);
    return syms.reverse().join('');
  };

  for (let i = 0; i < order.length; i++) {
    // Dequeue order IS discovery order, so the first hit here is the minimal word.
    if (accepting.has(order[i])) return wordAt(i);

    // At the budget we still *test* the state (its word is within length) but do not
    // extend past it.
    if (budget !== undefined && depth[i] >= budget) continue;

    const bySym = delta.get(order[i]);
    if (bySym === undefined) continue; // a state with no moves at all: a dead end

    for (const sym of alphabet) {
      const to = bySym.get(sym);
      // Missing move => the run dies. Already seen => it was discovered by a word no
      // larger than this one, so this path can never improve on it.
      if (to === undefined || seen.has(to)) continue;
      seen.add(to);
      order.push(to);
      parent.push(i);
      via.push(sym);
      depth.push(depth[i] + 1);
    }
  }

  return null;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Do two machines accept exactly the same language? If not, the shortest string they
 * disagree on, and which of them accepts it.
 *
 * Compared over the **union** of the two alphabets — a machine over {a} and one over
 * {a,b} are compared over {a,b}, so a learner who forgot a letter is caught. Ties among
 * shortest counterexamples are broken lexicographically in that union alphabet's sort
 * order (UTF-16 code units), so the answer is a function of the two machines alone.
 *
 * Exact, not best-effort: `equal: true` means no disagreeing string exists, at any
 * length. Preconditions: none — ε-moves, nondeterminism, partial machines, unreachable
 * states and disjoint alphabets are all handled.
 */
export function equivalent(a: Automaton, b: Automaton): Equivalence {
  // The xor product accepts exactly the symmetric difference of the two languages, over
  // the union alphabet, as a total DFA. So "a reachable accepting state of this product"
  // IS "a string the two machines disagree on", and the shortest word reaching one is
  // the counterexample. Its state space is finite, hence the un-budgeted search.
  const witness = shortestAcceptedOf(product(a, b, 'xor'));
  if (witness === null) return { equal: true };

  const inA = accepts(a, witness);
  const inB = accepts(b, witness);

  // The xor product asserts these two differ. If they agree, the determiniser and the
  // simulator disagree about what a machine's language IS — an engine bug that would
  // otherwise surface as confidently wrong feedback to a child ("your machine accepts
  // 'aab'" — when it doesn't). Fail loudly rather than mis-teach.
  if (inA === inB) {
    throw new Error(
      `equivalent: the xor product produced '${witness}', ` +
        `but both machines ${inA ? 'accept' : 'reject'} it`,
    );
  }

  return { equal: false, counterexample: witness, acceptedBy: inA ? 'a' : 'b' };
}

/**
 * Check a machine against an explicit list of strings it must accept and strings it must
 * reject. Used for quick per-puzzle grading, and to validate the puzzle library itself.
 *
 * `failures` is a pure filter of the inputs — no deduplication, no reordering: the
 * accept-list failures in the caller's order, then the reject-list failures in the
 * caller's order. Two consequences worth knowing when the input is a puzzle definition:
 * a string listed twice is reported twice, and a string listed in *both* lists always
 * fails, whatever the machine does — which is precisely the report a self-contradictory
 * puzzle deserves.
 */
export function acceptsLanguage(
  a: Automaton,
  accept: string[],
  reject: string[],
): { ok: boolean; failures: Array<{ s: string; expected: boolean }> } {
  const failures: Array<{ s: string; expected: boolean }> = [
    ...accept.filter((s) => !accepts(a, s)).map((s) => ({ s, expected: true })),
    ...reject.filter((s) => accepts(a, s)).map((s) => ({ s, expected: false })),
  ];
  return { ok: failures.length === 0, failures };
}

/**
 * The shortest string the machine accepts (lexicographically first among the shortest),
 * or null when the language is empty — or when nothing was found within `limit`.
 *
 * `limit` bounds the *length* searched. Note null is genuinely ambiguous between "empty
 * language" and "nothing that short": callers who need to distinguish them should raise
 * the limit (a machine whose reachable DFA has n states, if it accepts anything at all,
 * accepts something of length < n).
 *
 * Preconditions: none. The machine is determinised first — over an NFA, "shortest path
 * to an accepting state" is not the same question as "shortest accepted string" once
 * ε-moves are in play, and the lexicographic tie-break is only well-defined given the
 * unique run a DFA has on each string.
 */
export function shortestAccepted(
  a: Automaton,
  limit: number = DEFAULT_SHORTEST_LIMIT,
): string | null {
  return shortestAcceptedOf(toDFA(a).dfa, limit);
}

/**
 * Every string over `alphabet` of length ≤ `maxLen`, in length-then-lexicographic order,
 * INCLUDING the empty string. The alphabet is sorted and deduplicated first, and ε is
 * dropped from it (ε is not a member of any alphabet — see `types.ts`).
 *
 * The exhaustive ground truth for brute-force checks. `maxLen < 0` yields nothing at all
 * (not even ε); an empty alphabet yields exactly `['']`, since there are no words of
 * positive length over ∅.
 *
 * Precondition — **this is Σ^≤n and it grows like |Σ|^n**: (1 - |Σ|^(maxLen+1)) / (1 - |Σ|)
 * strings, so |Σ|=4, maxLen=15 is a billion of them. Intended for tests and small-alphabet
 * exhaustive checks. Never hand it a user-controlled `maxLen`.
 */
export function sampleStrings(alphabet: Sym[], maxLen: number): string[] {
  if (maxLen < MIN_LENGTH) return [];

  const syms = sortedUnique(alphabet).filter((s) => s !== EPSILON);

  // Σ^0 = {ε} for every alphabet, the empty one included.
  let level: string[] = [''];
  const out: string[] = [...level];

  for (let len = MIN_LENGTH + 1; len <= maxLen; len++) {
    // Σ^n in lexicographic order = each word of Σ^(n-1) in lexicographic order, extended
    // by each symbol in sorted order: same-length words compare by their first
    // difference, so the shared prefix dominates and appending preserves the order.
    level = level.flatMap((w) => syms.map((s) => w + s));
    if (level.length === 0) break; // Σ = ∅: no words of positive length exist
    out.push(...level);
  }

  return out;
}
