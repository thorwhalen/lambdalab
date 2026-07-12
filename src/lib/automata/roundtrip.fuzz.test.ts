/**
 * Property-based ADVERSARIAL tests for the automata engine.
 *
 * The unit tests next to each module check the cases their author thought of.
 * This file exists to check the cases nobody thought of: it generates thousands
 * of random regexes and random ε-NFAs from a SEEDED generator and asserts the
 * laws the engine claims — Kleene's theorem in both directions, soundness of
 * every rewrite, and the shortest-counterexample guarantee that the grader's
 * feedback rests on.
 *
 * TWO RULES THIS FILE LIVES BY
 *
 * 1. **Seeded, never `Math.random`.** A fuzz failure that cannot be reproduced is
 *    a rumour, not a bug report. The generator is a 32-bit xorshift with a
 *    hardcoded seed, so a red run here is red on every machine, for ever. (Every
 *    property also prints the failing case, so shrinking by hand is possible.)
 *
 * 2. **The oracle is INDEPENDENT.** For "does this regex match this string?" we
 *    use `matchesAst` below — a direct, obviously-correct backtracking matcher on
 *    the AST, written from the denotational definition of a regular expression
 *    and importing *nothing* from the engine. Using the engine to check the engine
 *    would make a self-consistent wrong engine look right, which is precisely the
 *    failure mode that ships subtly wrong mathematics to a child.
 *
 * The languages are compared by brute force over Σ^≤MAX_TEST_LEN. That is not a
 * proof of equality, but for machines this small it is overwhelming evidence:
 * two inequivalent DFAs built from these generators disagree on a string far
 * shorter than that bound (Myhill–Nerode: they disagree at a length below the
 * product's reachable state count).
 */

import { describe, expect, it } from 'vitest';
import {
  EPSILON,
  accepts,
  alphabetOf,
  automatonToRegex,
  automatonToRegexSteps,
  complement,
  determinismReport,
  equivalent,
  minimalStateCount,
  minimize,
  parseRegex,
  product,
  reachableStates,
  regexSize,
  regexToNFA,
  regexToNFASteps,
  renderRegex,
  sampleStrings,
  shortestAccepted,
  simplifyRegex,
  toDFA,
  trace,
  type Automaton,
  type BooleanOp,
  type RegexNode,
  type StateId,
  type Sym,
  type Transition,
} from './index';

// ---------------------------------------------------------------------------
// Knobs. Every number in this file has a name.
// ---------------------------------------------------------------------------

/** Hardcoded: reproducibility is the whole point. Any nonzero 32-bit value works. */
const SEED = 0x5eed1234;

/** Cases per property. Enough that a one-in-a-thousand shape shows up. */
const CASES = 400;

/** Strings up to this length decide "same language". |Σ|^(n+1) — keep it small. */
const MAX_TEST_LEN = 7;

/** Regex generator: nesting depth. 4 already reaches ~30-node trees. */
const MAX_REGEX_DEPTH = 4;

/** Random ε-NFA: state count is drawn from [1, MAX_NFA_STATES]. */
const MAX_NFA_STATES = 6;

/** Random ε-NFA: transition count is drawn from [0, MAX_NFA_EDGES]. */
const MAX_NFA_EDGES = 10;

/** The alphabets we fuzz over. Two letters is the lesson's; three is the bar raised. */
const ALPHABET_2: Sym[] = ['a', 'b'];
const ALPHABET_3: Sym[] = ['a', 'b', 'c'];

/** Σ^≤7 over 3 letters is 3280 strings — fine; over 4 it would be 21845. */
const MAX_TEST_LEN_BIG_ALPHABET = 6;

// ---------------------------------------------------------------------------
// The generator: xorshift32, seeded
// ---------------------------------------------------------------------------

/**
 * xorshift32. Chosen over an LCG because an LCG's low bits are famously
 * non-random and `next() % k` is exactly a low-bit query — which is how a fuzz
 * suite quietly stops exploring half its space.
 */
interface Rng {
  s: number;
}

const XORSHIFT_A = 13;
const XORSHIFT_B = 17;
const XORSHIFT_C = 5;
const U32 = 0x100000000;

const rngOf = (seed: number): Rng => ({ s: seed >>> 0 || 1 });

function next(r: Rng): number {
  let x = r.s;
  x ^= x << XORSHIFT_A;
  x >>>= 0;
  x ^= x >>> XORSHIFT_B;
  x ^= x << XORSHIFT_C;
  x >>>= 0;
  r.s = x;
  return x;
}

/** Uniform in [0, n). Precondition: n >= 1. */
const below = (r: Rng, n: number): number => Math.floor((next(r) / U32) * n);

/** Uniform in [lo, hi], inclusive. Precondition: lo <= hi. */
const between = (r: Rng, lo: number, hi: number): number => lo + below(r, hi - lo + 1);

const pick = <T>(r: Rng, xs: readonly T[]): T => xs[below(r, xs.length)];

/** True with probability `p`. */
const chance = (r: Rng, p: number): boolean => next(r) / U32 < p;

// ---------------------------------------------------------------------------
// THE ORACLE — a direct AST matcher, engine-free
// ---------------------------------------------------------------------------

/**
 * The set of positions in `s` that `n` can consume up to, starting at `i`.
 *
 * This is the denotational definition transcribed: L(r) is a set of words, and
 * "r matches s[i..j)" is `j ∈ ends(r, s, i)`. Nondeterminism is kept as a *set*
 * rather than resolved by backtracking, so there is no ordering subtlety and no
 * exponential blowup, and — crucially — nothing here has ever heard of an
 * automaton. It is the independent witness the whole suite is checked against.
 *
 * `star` is a least fixpoint over positions (bounded by |s| + 1, so it
 * terminates), which is exactly what makes a nullable body safe: `(a?)*` adds
 * nothing new after the first round and the loop stops.
 */
function ends(n: RegexNode, s: string, i: number): Set<number> {
  switch (n.kind) {
    case 'empty':
      return new Set();
    case 'epsilon':
      return new Set([i]);
    case 'literal':
      return s[i] === n.sym ? new Set([i + 1]) : new Set();
    case 'concat': {
      const out = new Set<number>();
      for (const j of ends(n.left, s, i)) for (const k of ends(n.right, s, j)) out.add(k);
      return out;
    }
    case 'union':
      return new Set([...ends(n.left, s, i), ...ends(n.right, s, i)]);
    case 'optional':
      return new Set([i, ...ends(n.inner, s, i)]);
    case 'star':
      return starEnds(n.inner, s, i);
    case 'plus': {
      // r+ = r · r*  — no special-casing, so `plus` cannot drift from the others.
      const out = new Set<number>();
      for (const j of ends(n.inner, s, i)) for (const k of starEnds(n.inner, s, j)) out.add(k);
      return out;
    }
  }
}

/** Least fixpoint of "apply `inner` any number of times", seeded with zero applications. */
function starEnds(inner: RegexNode, s: string, i: number): Set<number> {
  const reached = new Set<number>([i]);
  const work: number[] = [i];
  while (work.length > 0) {
    const j = work.pop() as number;
    for (const k of ends(inner, s, j)) {
      if (!reached.has(k)) {
        reached.add(k);
        work.push(k);
      }
    }
  }
  return reached;
}

/** Ground truth: does the regex `n` match the whole of `s`? Uses no engine code. */
const matchesAst = (n: RegexNode, s: string): boolean => ends(n, s, 0).has(s.length);

// ---------------------------------------------------------------------------
// Random regexes
// ---------------------------------------------------------------------------

/**
 * A random AST over `alphabet`, of nesting depth ≤ `depth`.
 *
 * ∅ and ε are drawn deliberately often (a tenth each at the leaves): they are the
 * constants that break naive simplifiers and naive Thompson gadgets, so a
 * generator that hardly ever emits them is not adversarial, it is decorative.
 */
function randomRegex(r: Rng, alphabet: readonly Sym[], depth: number): RegexNode {
  const LEAF_EMPTY_P = 0.1;
  const LEAF_EPSILON_P = 0.1;

  if (depth <= 0) return randomLeaf(r, alphabet, LEAF_EMPTY_P, LEAF_EPSILON_P);

  // Weighted by shape, not uniformly by constructor: a tree that is half leaves
  // never exercises the deep rewrites, and one with no leaves never terminates.
  const roll = below(r, 10);
  if (roll < 2) return randomLeaf(r, alphabet, LEAF_EMPTY_P, LEAF_EPSILON_P);
  if (roll < 5) {
    return {
      kind: 'concat',
      left: randomRegex(r, alphabet, depth - 1),
      right: randomRegex(r, alphabet, depth - 1),
    };
  }
  if (roll < 7) {
    return {
      kind: 'union',
      left: randomRegex(r, alphabet, depth - 1),
      right: randomRegex(r, alphabet, depth - 1),
    };
  }
  const inner = randomRegex(r, alphabet, depth - 1);
  return { kind: pick(r, ['star', 'plus', 'optional'] as const), inner };
}

function randomLeaf(
  r: Rng,
  alphabet: readonly Sym[],
  emptyP: number,
  epsilonP: number,
): RegexNode {
  const roll = next(r) / U32;
  if (roll < emptyP) return { kind: 'empty' };
  if (roll < emptyP + epsilonP) return { kind: 'epsilon' };
  return { kind: 'literal', sym: pick(r, alphabet) };
}

// ---------------------------------------------------------------------------
// Random ε-NFAs
// ---------------------------------------------------------------------------

/**
 * A random ε-NFA over `alphabet`, drawn to hit the shapes that break engines:
 *
 * - 1 to MAX_NFA_STATES states (a single-state machine is a real machine);
 * - ε-edges, including self-loops and ε-cycles;
 * - sometimes NO accepting states (the empty language);
 * - sometimes an accepting state that is unreachable;
 * - sometimes a declared-but-unused symbol, and sometimes a deliberately
 *   *unreachable* state, because both are exactly what a child's half-built
 *   machine looks like.
 *
 * `alphabet` is always declared in full, so `alphabetOf` is the same for every
 * machine we generate — which is what makes it fair to compare two of them, and
 * to complement one, over a fixed Σ.
 */
function randomNfa(r: Rng, alphabet: readonly Sym[]): Automaton {
  const NO_ACCEPTING_P = 0.15;
  const ACCEPT_P = 0.35;
  const EPSILON_EDGE_P = 0.3;
  const UNREACHABLE_P = 0.25;

  const n = between(r, 1, MAX_NFA_STATES);
  const states: StateId[] = Array.from({ length: n }, (_, i) => `s${i}`);
  const start = states[0];

  // A state we promise never to wire an incoming edge to. Sometimes.
  const orphan = n > 1 && chance(r, UNREACHABLE_P) ? states[between(r, 1, n - 1)] : undefined;

  const transitions: Transition[] = [];
  const edges = below(r, MAX_NFA_EDGES + 1);
  for (let e = 0; e < edges; e++) {
    const from = pick(r, states);
    const to = pick(r, states);
    if (to === orphan) continue;
    // ε-edges land freely on any state, self-loops included, so ε-cycles arise on
    // their own — they are the shape that hangs a closure written as a naive DFS.
    const on = chance(r, EPSILON_EDGE_P) ? EPSILON : pick(r, alphabet);
    transitions.push({ from, on, to });
  }

  const accepting = chance(r, NO_ACCEPTING_P)
    ? []
    : states.filter(() => chance(r, ACCEPT_P));

  return { states, alphabet: [...alphabet], transitions, start, accepting };
}

// ---------------------------------------------------------------------------
// Comparing languages by brute force
// ---------------------------------------------------------------------------

/** The first string of Σ^≤len on which the two predicates differ, or null. */
function firstDisagreement(
  alphabet: readonly Sym[],
  len: number,
  f: (s: string) => boolean,
  g: (s: string) => boolean,
): string | null {
  for (const s of sampleStrings([...alphabet], len)) {
    if (f(s) !== g(s)) return s;
  }
  return null;
}

/** A one-line reproduction recipe, so a red run is a bug report and not a shrug. */
const show = (n: RegexNode): string => `${renderRegex(n)}   AST=${JSON.stringify(n)}`;

const showNfa = (a: Automaton): string => JSON.stringify(a);

// ---------------------------------------------------------------------------
// 1. Regex round trip: render then parse is the identity on ASTs
// ---------------------------------------------------------------------------

describe('property: render ∘ parse round trip', () => {
  it('parseRegex(renderRegex(n)) is structurally n, for random n', () => {
    const r = rngOf(SEED);
    for (let i = 0; i < CASES; i++) {
      const node = randomRegex(r, ALPHABET_2, MAX_REGEX_DEPTH);
      const text = renderRegex(node);
      const parsed = parseRegex(text);
      expect(parsed.ok, `parse failed on rendered "${text}" from ${show(node)}`).toBe(true);
      if (parsed.ok) {
        expect(parsed.node, `round trip changed the tree: "${text}" from ${show(node)}`).toEqual(
          node,
        );
      }
    }
  });

  it('holds over a 3-letter alphabet and deeper trees too', () => {
    const r = rngOf(SEED ^ 0x1111);
    for (let i = 0; i < CASES; i++) {
      const node = randomRegex(r, ALPHABET_3, MAX_REGEX_DEPTH + 1);
      const parsed = parseRegex(renderRegex(node));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.node).toEqual(node);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. simplifyRegex is SOUND — checked against the independent AST matcher
// ---------------------------------------------------------------------------

describe('property: simplifyRegex preserves the language', () => {
  it('agrees with the original on every string of length ≤ 7', () => {
    const r = rngOf(SEED ^ 0x2222);
    for (let i = 0; i < CASES; i++) {
      const node = randomRegex(r, ALPHABET_2, MAX_REGEX_DEPTH);
      const simple = simplifyRegex(node);
      const bad = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => matchesAst(node, s),
        (s) => matchesAst(simple, s),
      );
      expect(
        bad,
        `simplify changed the language on "${bad}":\n  before: ${show(node)}\n  after:  ${show(simple)}`,
      ).toBeNull();
    }
  });

  it('is idempotent (a fixpoint really is a fixpoint)', () => {
    const r = rngOf(SEED ^ 0x3333);
    for (let i = 0; i < CASES; i++) {
      const node = randomRegex(r, ALPHABET_2, MAX_REGEX_DEPTH);
      const once = simplifyRegex(node);
      const twice = simplifyRegex(once);
      expect(twice, `simplify not idempotent on ${show(node)}`).toEqual(once);
    }
  });

  it('still preserves the language over a 3-letter alphabet', () => {
    const r = rngOf(SEED ^ 0x4444);
    for (let i = 0; i < CASES; i++) {
      const node = randomRegex(r, ALPHABET_3, MAX_REGEX_DEPTH);
      const simple = simplifyRegex(node);
      const bad = firstDisagreement(
        ALPHABET_3,
        MAX_TEST_LEN_BIG_ALPHABET,
        (s) => matchesAst(node, s),
        (s) => matchesAst(simple, s),
      );
      expect(bad, `simplify changed the language on "${bad}": ${show(node)} -> ${show(simple)}`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Thompson is faithful — the machine accepts exactly what the regex matches
// ---------------------------------------------------------------------------

describe('property: regexToNFA denotes the regex', () => {
  it('accepts exactly the strings the AST matcher matches', () => {
    const r = rngOf(SEED ^ 0x5555);
    for (let i = 0; i < CASES; i++) {
      const node = randomRegex(r, ALPHABET_2, MAX_REGEX_DEPTH);
      const nfa = regexToNFA(node);
      const bad = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => matchesAst(node, s),
        (s) => accepts(nfa, s),
      );
      expect(bad, `Thompson disagrees with the AST on "${bad}": ${show(node)}`).toBeNull();
    }
  });

  it('is faithful for the simplified regex too (same language, different tree)', () => {
    const r = rngOf(SEED ^ 0x6666);
    for (let i = 0; i < CASES; i++) {
      const node = randomRegex(r, ALPHABET_3, MAX_REGEX_DEPTH);
      const nfa = regexToNFA(simplifyRegex(node));
      const bad = firstDisagreement(
        ALPHABET_3,
        MAX_TEST_LEN_BIG_ALPHABET,
        (s) => matchesAst(node, s),
        (s) => accepts(nfa, s),
      );
      expect(bad, `Thompson∘simplify disagrees with the AST on "${bad}": ${show(node)}`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Subset construction: same language, and the result is a real DFA
// ---------------------------------------------------------------------------

describe('property: toDFA preserves the language and determinises', () => {
  it('agrees with the source ε-NFA on every string of length ≤ 7', () => {
    const r = rngOf(SEED ^ 0x7777);
    for (let i = 0; i < CASES; i++) {
      const nfa = randomNfa(r, ALPHABET_2);
      const { dfa } = toDFA(nfa);
      const bad = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => accepts(nfa, s),
        (s) => accepts(dfa, s),
      );
      expect(bad, `toDFA changed the language on "${bad}": ${showNfa(nfa)}`).toBeNull();
    }
  });

  it('returns a machine that is deterministic AND total', () => {
    const r = rngOf(SEED ^ 0x8888);
    for (let i = 0; i < CASES; i++) {
      const nfa = randomNfa(r, ALPHABET_2);
      const { dfa, mapping } = toDFA(nfa);
      const report = determinismReport(dfa);
      expect(report.isDeterministic, `not deterministic: ${showNfa(nfa)}`).toBe(true);
      expect(report.isTotal, `not total: ${showNfa(nfa)}`).toBe(true);
      expect(report.hasEpsilon).toBe(false);
      // Every DFA state must be explained to the child; the mapping is that explanation.
      for (const s of dfa.states) expect(mapping[s], `no mapping for ${s}`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Minimisation: same language, and canonical
// ---------------------------------------------------------------------------

describe('property: minimize preserves the language and is canonical', () => {
  it('agrees with the source machine on every string of length ≤ 7', () => {
    const r = rngOf(SEED ^ 0x9999);
    for (let i = 0; i < CASES; i++) {
      const nfa = randomNfa(r, ALPHABET_2);
      const small = minimize(nfa);
      const bad = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => accepts(nfa, s),
        (s) => accepts(small, s),
      );
      expect(bad, `minimize changed the language on "${bad}": ${showNfa(nfa)}`).toBeNull();
    }
  });

  it('gives equivalent machines the same state count (canonicity)', () => {
    const r = rngOf(SEED ^ 0xaaaa);
    let compared = 0;
    for (let i = 0; i < CASES; i++) {
      // Two machines for the SAME language, built by different routes: the regex as
      // written, and the regex after simplification. Same Σ (declared explicitly), so
      // the comparison is fair — minimality is relative to an alphabet.
      const node = randomRegex(r, ALPHABET_2, MAX_REGEX_DEPTH);
      const widen = (m: Automaton): Automaton => ({ ...m, alphabet: [...ALPHABET_2] });
      const one = minimize(widen(regexToNFA(node)));
      const two = minimize(widen(regexToNFA(simplifyRegex(node))));
      expect(
        one.states.length,
        `equivalent machines minimised to different sizes: ${show(node)}\n` +
          `  ${JSON.stringify(one.states)}\n  ${JSON.stringify(two.states)}`,
      ).toBe(two.states.length);
      compared++;
    }
    expect(compared).toBe(CASES);
  });

  it('is a fixpoint: minimising a minimal machine changes nothing', () => {
    const r = rngOf(SEED ^ 0xbbbb);
    for (let i = 0; i < CASES; i++) {
      const nfa = randomNfa(r, ALPHABET_2);
      const once = minimize(nfa);
      const twice = minimize(once);
      expect(twice.states.length, `minimize not idempotent in size: ${showNfa(nfa)}`).toBe(
        once.states.length,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 6. THE BIG ONE — the whole lesson, round tripped
// ---------------------------------------------------------------------------

describe('property: the full Kleene round trip', () => {
  it('regex → NFA → DFA → minimal → regex → parse → NFA is equivalent to the start', () => {
    const r = rngOf(SEED ^ 0xcccc);
    for (let i = 0; i < CASES; i++) {
      const node = randomRegex(r, ALPHABET_2, MAX_REGEX_DEPTH);

      const nfa = regexToNFA(node);
      const { dfa } = toDFA(nfa);
      const small = minimize(dfa);
      const back = automatonToRegex(small);
      const text = renderRegex(back);

      const reparsed = parseRegex(text);
      expect(reparsed.ok, `round-trip regex "${text}" does not parse; from ${show(node)}`).toBe(
        true,
      );
      if (!reparsed.ok) continue;

      const nfa2 = regexToNFA(reparsed.node);
      const verdict = equivalent(nfa, nfa2);
      expect(
        verdict.equal,
        `round trip changed the language.\n` +
          `  start:  ${show(node)}\n` +
          `  end:    ${text}\n` +
          `  witness: ${verdict.equal ? '' : `"${verdict.counterexample}" accepted by ${verdict.acceptedBy}`}`,
      ).toBe(true);

      // And, independently of `equivalent` (which is engine code checking engine
      // code): the AST matcher must agree with the final machine too.
      const bad = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => matchesAst(node, s),
        (s) => accepts(nfa2, s),
      );
      expect(
        bad,
        `round trip disagrees with the AST oracle on "${bad}": ${show(node)} -> ${text}`,
      ).toBeNull();
    }
  });

  it('survives the 3-letter alphabet', () => {
    const r = rngOf(SEED ^ 0xdddd);
    for (let i = 0; i < CASES; i++) {
      const node = randomRegex(r, ALPHABET_3, MAX_REGEX_DEPTH);
      const nfa = regexToNFA(node);
      const back = automatonToRegex(minimize(toDFA(nfa).dfa));
      const reparsed = parseRegex(renderRegex(back));
      expect(reparsed.ok).toBe(true);
      if (!reparsed.ok) continue;
      const nfa2 = regexToNFA(reparsed.node);
      const bad = firstDisagreement(
        ALPHABET_3,
        MAX_TEST_LEN_BIG_ALPHABET,
        (s) => matchesAst(node, s),
        (s) => accepts(nfa2, s),
      );
      expect(bad, `round trip broke on "${bad}": ${show(node)} -> ${renderRegex(back)}`).toBeNull();
    }
  });

  it('round trips a random ε-NFA (machine → regex → machine)', () => {
    const r = rngOf(SEED ^ 0xeeee);
    for (let i = 0; i < CASES; i++) {
      const nfa = randomNfa(r, ALPHABET_2);
      const back = automatonToRegex(nfa);
      const reparsed = parseRegex(renderRegex(back));
      expect(reparsed.ok, `machine → regex produced unparseable "${renderRegex(back)}"`).toBe(true);
      if (!reparsed.ok) continue;

      const rebuilt = regexToNFA(reparsed.node);
      const bad = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => accepts(nfa, s),
        (s) => accepts(rebuilt, s),
      );
      expect(
        bad,
        `state elimination changed the language on "${bad}":\n  ${showNfa(nfa)}\n  regex: ${renderRegex(back)}`,
      ).toBeNull();

      // The rendered regex is also the *denotation* claim: check it with the oracle.
      const badOracle = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => accepts(nfa, s),
        (s) => matchesAst(reparsed.node, s),
      );
      expect(
        badOracle,
        `the regex for this machine is wrong on "${badOracle}":\n  ${showNfa(nfa)}\n  regex: ${renderRegex(back)}`,
      ).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 7. The counterexample really is the shortest one
// ---------------------------------------------------------------------------

describe('property: equivalent() returns the shortest-lex counterexample', () => {
  it('matches a brute-force search over Σ^≤7', () => {
    const r = rngOf(SEED ^ 0xf0f0);
    let differing = 0;
    for (let i = 0; i < CASES; i++) {
      const a = randomNfa(r, ALPHABET_2);
      const b = randomNfa(r, ALPHABET_2);

      // sampleStrings is length-then-lex, so the FIRST disagreement it finds is the
      // shortest-lex one by construction — the same order `equivalent` promises.
      const truth = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => accepts(a, s),
        (s) => accepts(b, s),
      );

      const verdict = equivalent(a, b);

      if (truth === null) {
        // Brute force found nothing that short. `equivalent` is exact, so if it claims
        // a counterexample it must be LONGER than our window — never a shorter one it
        // hid from us, and never a string in the window.
        if (!verdict.equal) {
          expect(
            verdict.counterexample.length,
            `equivalent() found "${verdict.counterexample}" inside the brute-force window, ` +
              `but brute force says the machines agree there:\n  a=${showNfa(a)}\n  b=${showNfa(b)}`,
          ).toBeGreaterThan(MAX_TEST_LEN);
        }
        continue;
      }

      differing++;
      expect(
        verdict.equal,
        `machines differ on "${truth}" but equivalent() called them equal:\n  a=${showNfa(a)}\n  b=${showNfa(b)}`,
      ).toBe(false);
      if (verdict.equal) continue;

      expect(
        verdict.counterexample,
        `not the shortest counterexample:\n  a=${showNfa(a)}\n  b=${showNfa(b)}`,
      ).toBe(truth);
      expect(verdict.acceptedBy).toBe(accepts(a, truth) ? 'a' : 'b');
    }
    // A run in which nothing ever differed would be vacuously green — assert it bit.
    expect(differing).toBeGreaterThan(CASES / 4);
  });

  it('never reports a difference between a machine and itself', () => {
    const r = rngOf(SEED ^ 0x0f0f);
    for (let i = 0; i < CASES; i++) {
      const a = randomNfa(r, ALPHABET_2);
      expect(equivalent(a, a).equal, `a machine differs from itself: ${showNfa(a)}`).toBe(true);
      // …and from its own determinised, minimised self.
      expect(equivalent(a, minimize(a)).equal, `minimize changed it: ${showNfa(a)}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Complement — the flip-without-completing bug
// ---------------------------------------------------------------------------

describe('property: complement accepts exactly what the original rejects', () => {
  it('over the machine’s own Σ, for random ε-NFAs', () => {
    const r = rngOf(SEED ^ 0x1234);
    for (let i = 0; i < CASES; i++) {
      const nfa = randomNfa(r, ALPHABET_2);
      const not = complement(nfa);
      // Both machines declare Σ = {a,b}, so "everything else" is unambiguous here.
      expect(alphabetOf(nfa)).toEqual(ALPHABET_2);
      const bad = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => !accepts(nfa, s),
        (s) => accepts(not, s),
      );
      expect(bad, `complement is wrong on "${bad}": ${showNfa(nfa)}`).toBeNull();
    }
  });

  it('is an involution up to language', () => {
    const r = rngOf(SEED ^ 0x4321);
    for (let i = 0; i < CASES; i++) {
      const nfa = randomNfa(r, ALPHABET_2);
      const back = complement(complement(nfa));
      const bad = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => accepts(nfa, s),
        (s) => accepts(back, s),
      );
      expect(bad, `¬¬L ≠ L on "${bad}": ${showNfa(nfa)}`).toBeNull();
    }
  });

  it('complements a Thompson machine correctly (Σ may be a strict subset of {a,b})', () => {
    const r = rngOf(SEED ^ 0xabcd);
    for (let i = 0; i < CASES; i++) {
      const node = randomRegex(r, ALPHABET_2, MAX_REGEX_DEPTH);
      // Widen Σ explicitly: complement is relative to an alphabet, and a regex like
      // `a*` has Σ = {a}. Declaring {a,b} is the documented way to ask for the
      // complement within {a,b}* — and it must then REJECT nothing but what `a*` accepts.
      const nfa: Automaton = { ...regexToNFA(node), alphabet: [...ALPHABET_2] };
      const not = complement(nfa);
      const bad = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => !matchesAst(node, s),
        (s) => accepts(not, s),
      );
      expect(bad, `complement of ${show(node)} is wrong on "${bad}"`).toBeNull();
    }
  });
});

// ===========================================================================
// RAISING THE BAR
//
// Everything above passed on the first run, which is not evidence that the
// engine is right — it is evidence that the adversary was lazy. The properties
// below go after the places the engine's own docstrings admit are delicate:
//
//   * generated names ("{q0,q2}", "q0|q3", "∅", "START") colliding with names a
//     LEARNER chose — the modules all carry `freshName`/`uniqueNames` machinery
//     for this, and a collision would silently FUSE two inequivalent states;
//   * an empty alphabet (the regex ε, or a machine with only ε-moves);
//   * the boolean closure, where a partial machine gives a right-looking answer
//     for the wrong language;
//   * the par score, which a child is graded against;
//   * the animation contracts, which the lesson *is*.
// ===========================================================================

/**
 * State names chosen to collide with every name the engine generates.
 *
 * `{s0,s1}` is what subset construction calls the subset {s0, s1}; `s0|s1` is
 * what minimisation calls the merged block; `∅` is the trap; `START`/`ACCEPT`
 * are the two states state-elimination adds; `s0,s1` is the id whose *display*
 * form is indistinguishable from a two-element subset. If identity is ever keyed
 * off a display name anywhere, one of these fuses two states — and fusing two
 * inequivalent states changes the language a child is graded on.
 */
const HOSTILE_NAMES: readonly StateId[] = [
  's0',
  's1',
  's0,s1',
  '{s0,s1}',
  's0|s1',
  '∅',
  'START',
  'ACCEPT',
  '(s0,s1)',
  '#2',
];

/** As `randomNfa`, but every state id is drawn from `HOSTILE_NAMES`. */
function randomHostileNfa(r: Rng, alphabet: readonly Sym[]): Automaton {
  const ACCEPT_P = 0.35;
  const EPSILON_EDGE_P = 0.3;

  const n = between(r, 1, Math.min(MAX_NFA_STATES, HOSTILE_NAMES.length));
  // Sample WITHOUT replacement: duplicate ids would be a different (also worth
  // testing) hazard, and mixing the two would blur which one broke.
  const pool = [...HOSTILE_NAMES];
  const states: StateId[] = [];
  for (let i = 0; i < n; i++) states.push(...pool.splice(below(r, pool.length), 1));

  const transitions: Transition[] = [];
  const edges = below(r, MAX_NFA_EDGES + 1);
  for (let e = 0; e < edges; e++) {
    transitions.push({
      from: pick(r, states),
      on: chance(r, EPSILON_EDGE_P) ? EPSILON : pick(r, alphabet),
      to: pick(r, states),
    });
  }

  return {
    states,
    alphabet: [...alphabet],
    transitions,
    start: states[0],
    accepting: states.filter(() => chance(r, ACCEPT_P)),
  };
}

/**
 * A machine with structural rubbish in it — the state of a half-built machine in
 * the editor, which the engine promises to tolerate rather than throw on:
 * duplicate transitions, transitions naming states that do not exist, a start
 * state missing from `states`, a duplicated id, a duplicated accepting entry.
 */
function corrupt(r: Rng, a: Automaton): Automaton {
  const out: Automaton = {
    states: [...a.states],
    alphabet: [...a.alphabet],
    transitions: [...a.transitions],
    start: a.start,
    accepting: [...a.accepting],
  };
  if (chance(r, 0.5) && out.transitions.length > 0) {
    out.transitions.push(pick(r, out.transitions)); // exact duplicate edge
  }
  if (chance(r, 0.5)) {
    // Dangling edge: δ ⊆ Q × (Σ ∪ {ε}) × Q, so this is NOT a transition.
    out.transitions.push({ from: out.start, on: pick(r, out.alphabet), to: 'ghost' });
  }
  if (chance(r, 0.3)) out.states = out.states.filter((s) => s !== out.start); // start unlisted
  if (chance(r, 0.3) && out.states.length > 0) out.states.push(pick(r, out.states)); // dup id
  if (chance(r, 0.3) && out.accepting.length > 0) out.accepting.push(pick(r, out.accepting));
  return out;
}

/** The engine's own contract for a corrupt machine: the ghost edge is simply not in δ. */
const withoutGhosts = (a: Automaton): Automaton => {
  const q = new Set([...a.states, a.start]);
  return { ...a, transitions: a.transitions.filter((t) => q.has(t.from) && q.has(t.to)) };
};

// ---------------------------------------------------------------------------
// 9. Hostile state names must not fuse states
// ---------------------------------------------------------------------------

describe('property: generated names never collide with a learner’s names', () => {
  it('toDFA preserves the language when ids look like subsets', () => {
    const r = rngOf(SEED ^ 0x2468);
    for (let i = 0; i < CASES; i++) {
      const nfa = randomHostileNfa(r, ALPHABET_2);
      const { dfa } = toDFA(nfa);
      expect(new Set(dfa.states).size, `toDFA fused two states: ${showNfa(nfa)}`).toBe(
        dfa.states.length,
      );
      const bad = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => accepts(nfa, s),
        (s) => accepts(dfa, s),
      );
      expect(bad, `toDFA changed the language on "${bad}": ${showNfa(nfa)}`).toBeNull();
    }
  });

  it('minimize preserves the language when ids look like merged blocks', () => {
    const r = rngOf(SEED ^ 0x1357);
    for (let i = 0; i < CASES; i++) {
      const nfa = randomHostileNfa(r, ALPHABET_2);
      const small = minimize(nfa);
      expect(new Set(small.states).size).toBe(small.states.length);
      const bad = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => accepts(nfa, s),
        (s) => accepts(small, s),
      );
      expect(bad, `minimize changed the language on "${bad}": ${showNfa(nfa)}`).toBeNull();
    }
  });

  it('complement stays exact when a state is already called ∅', () => {
    const r = rngOf(SEED ^ 0x9753);
    for (let i = 0; i < CASES; i++) {
      const nfa = randomHostileNfa(r, ALPHABET_2);
      const not = complement(nfa);
      const bad = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => !accepts(nfa, s),
        (s) => accepts(not, s),
      );
      expect(bad, `complement wrong on "${bad}": ${showNfa(nfa)}`).toBeNull();
    }
  });

  it('state elimination survives states called START and ACCEPT', () => {
    const r = rngOf(SEED ^ 0x8642);
    for (let i = 0; i < CASES; i++) {
      const nfa = randomHostileNfa(r, ALPHABET_2);
      const back = automatonToRegex(nfa);
      const parsed = parseRegex(renderRegex(back));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      const bad = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => accepts(nfa, s),
        (s) => matchesAst(parsed.node, s),
      );
      expect(
        bad,
        `machine → regex is wrong on "${bad}":\n  ${showNfa(nfa)}\n  regex: ${renderRegex(back)}`,
      ).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Malformed machines: tolerated, and tolerated *consistently*
// ---------------------------------------------------------------------------

describe('property: a half-built machine is repaired, never mis-read', () => {
  /** Four full pipelines per case over Σ^≤7 — priced accordingly. */
  const MALFORMED_CASES = 120;

  it('every entry point agrees that a dangling edge is not a transition', () => {
    const r = rngOf(SEED ^ 0xbeef);
    for (let i = 0; i < MALFORMED_CASES; i++) {
      const clean = withoutGhosts(corrupt(r, randomNfa(r, ALPHABET_2)));
      const dirty = corrupt(r, clean);
      // The contract (simulate.ts): δ ⊆ Q × (Σ ∪ {ε}) × Q, Q = states ∪ {start}.
      // So the corrupted machine must denote EXACTLY the same language, and every
      // derived machine must too — otherwise the child's editor and the grader
      // disagree about what the child drew.
      const canonical = withoutGhosts(dirty);
      for (const [name, f] of [
        ['accepts', (m: Automaton, s: string) => accepts(m, s)],
        ['toDFA', (m: Automaton, s: string) => accepts(toDFA(m).dfa, s)],
        ['minimize', (m: Automaton, s: string) => accepts(minimize(m), s)],
        ['complement', (m: Automaton, s: string) => !accepts(complement(m), s)],
      ] as const) {
        const bad = firstDisagreement(
          ALPHABET_2,
          MAX_TEST_LEN,
          (s) => f(canonical, s),
          (s) => f(dirty, s),
        );
        expect(bad, `${name} read the rubbish differently on "${bad}": ${showNfa(dirty)}`).toBeNull();
      }
      expect(equivalent(dirty, canonical).equal).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 11. The empty alphabet — a machine that can read nothing at all
// ---------------------------------------------------------------------------

describe('property: Σ = ∅ is a language, not a crash', () => {
  it('the whole pipeline runs on machines with no symbols', () => {
    const r = rngOf(SEED ^ 0xfeed);
    const EMPTY_ALPHABET: Sym[] = [];
    for (let i = 0; i < CASES; i++) {
      // Only ε-edges are possible, so the language is ε or ∅ and nothing else.
      const n = between(r, 1, MAX_NFA_STATES);
      const states = Array.from({ length: n }, (_, k) => `e${k}`);
      const transitions: Transition[] = [];
      for (let e = 0, m = below(r, MAX_NFA_EDGES + 1); e < m; e++) {
        transitions.push({ from: pick(r, states), on: EPSILON, to: pick(r, states) });
      }
      const nfa: Automaton = {
        states,
        alphabet: EMPTY_ALPHABET,
        transitions,
        start: states[0],
        accepting: states.filter(() => chance(r, 0.4)),
      };

      const acceptsEmpty = accepts(nfa, '');
      expect(alphabetOf(nfa)).toEqual([]);

      const { dfa } = toDFA(nfa);
      expect(determinismReport(dfa).isTotal).toBe(true);
      expect(accepts(dfa, '')).toBe(acceptsEmpty);

      const small = minimize(nfa);
      expect(accepts(small, '')).toBe(acceptsEmpty);
      expect(small.states.length).toBe(1);

      const re = automatonToRegex(nfa);
      expect(re.kind, `Σ=∅ machine must be ε or ∅, got ${renderRegex(re)}`).toBe(
        acceptsEmpty ? 'epsilon' : 'empty',
      );

      const not = complement(nfa);
      expect(accepts(not, '')).toBe(!acceptsEmpty);
      expect(shortestAccepted(nfa)).toBe(acceptsEmpty ? '' : null);
    }
  });
});

// ---------------------------------------------------------------------------
// 12. The boolean closure
// ---------------------------------------------------------------------------

describe('property: product computes the boolean combination it claims', () => {
  const TRUTH: Record<BooleanOp, (x: boolean, y: boolean) => boolean> = {
    and: (x, y) => x && y,
    or: (x, y) => x || y,
    xor: (x, y) => x !== y,
    minus: (x, y) => x && !y,
  };
  const OPS: BooleanOp[] = ['and', 'or', 'xor', 'minus'];

  it('agrees with the truth table on every string of length ≤ 7', () => {
    const r = rngOf(SEED ^ 0xc0de);
    for (let i = 0; i < CASES; i++) {
      const a = randomNfa(r, ALPHABET_2);
      const b = randomNfa(r, ALPHABET_2);
      const op = pick(r, OPS);
      const combined = product(a, b, op);
      expect(determinismReport(combined).isTotal, `product not total: ${op}`).toBe(true);
      const bad = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => TRUTH[op](accepts(a, s), accepts(b, s)),
        (s) => accepts(combined, s),
      );
      expect(
        bad,
        `product('${op}') is wrong on "${bad}":\n  a=${showNfa(a)}\n  b=${showNfa(b)}`,
      ).toBeNull();
    }
  });

  it('is correct when the two machines have DIFFERENT alphabets', () => {
    const r = rngOf(SEED ^ 0xf00d);
    for (let i = 0; i < CASES; i++) {
      // Σ(a) = {a}, Σ(b) = {a,b}. Over the union {a,b}, a machine with no 'b'-move
      // must REJECT every string containing 'b' — which needs an explicit trap. A
      // partial machine here gives the right answer for `and` and the wrong one for
      // `or`, which is exactly the bug worth hunting.
      const a: Automaton = { ...randomNfa(r, ['a']), alphabet: ['a'] };
      const b = randomNfa(r, ALPHABET_2);
      const op = pick(r, OPS);
      const combined = product(a, b, op);
      expect(alphabetOf(combined)).toEqual(ALPHABET_2);
      const bad = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => TRUTH[op](accepts(a, s), accepts(b, s)),
        (s) => accepts(combined, s),
      );
      expect(
        bad,
        `product('${op}') over a widened Σ is wrong on "${bad}":\n  a=${showNfa(a)}\n  b=${showNfa(b)}`,
      ).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 13. The par score — the number a child is graded against
// ---------------------------------------------------------------------------

describe('property: minimalStateCount is the Myhill–Nerode count', () => {
  /**
   * A LOWER bound on the number of Myhill–Nerode classes, computed from the AST
   * oracle alone: two prefixes are in different classes as soon as one witnessed
   * suffix separates them. Restricting the witnesses to Σ^≤len can only MERGE
   * classes, never split them — so this can never exceed the true count, and any
   * machine reporting fewer classes than this has lost a state the language needs.
   */
  const observedClasses = (node: RegexNode, alphabet: readonly Sym[], len: number): number => {
    const prefixes = sampleStrings([...alphabet], len);
    const suffixes = sampleStrings([...alphabet], len);
    const signatures = new Set(
      prefixes.map((w) => suffixes.map((x) => (matchesAst(node, w + x) ? '1' : '0')).join('')),
    );
    return signatures.size;
  };

  const PAR_WINDOW = 4;
  const PAR_CASES = 150;

  it('is at least the class count the language demands, and never less', () => {
    const r = rngOf(SEED ^ 0x1a2b);
    for (let i = 0; i < PAR_CASES; i++) {
      const node = randomRegex(r, ALPHABET_2, MAX_REGEX_DEPTH);
      const nfa: Automaton = { ...regexToNFA(node), alphabet: [...ALPHABET_2] };
      const par = minimalStateCount(nfa);
      const floor = observedClasses(node, ALPHABET_2, PAR_WINDOW);
      expect(
        par,
        `par score ${par} is below the ${floor} classes Σ^≤${PAR_WINDOW} already separates: ${show(node)}`,
      ).toBeGreaterThanOrEqual(floor);
    }
  });

  it('equals minimize()’s size, plus one exactly when the trap was dropped', () => {
    const r = rngOf(SEED ^ 0x3c4d);
    let droppedTrap = 0;
    for (let i = 0; i < CASES; i++) {
      const nfa = randomNfa(r, ALPHABET_2);
      const par = minimalStateCount(nfa);
      const drawn = minimize(nfa).states.length;
      expect(par).toBeGreaterThanOrEqual(1);
      expect(
        drawn,
        `minimize() and minimalStateCount() differ by more than the trap: ${showNfa(nfa)}`,
      ).toBeGreaterThanOrEqual(par - 1);
      expect(drawn).toBeLessThanOrEqual(par);
      if (drawn === par - 1) droppedTrap++;
    }
    expect(droppedTrap, 'no machine in the whole run had a trap — the test is vacuous').toBeGreaterThan(0);
  });

  it('is the same number for two machines with the same language', () => {
    const r = rngOf(SEED ^ 0x5e6f);
    for (let i = 0; i < CASES; i++) {
      const node = randomRegex(r, ALPHABET_2, MAX_REGEX_DEPTH);
      const widen = (m: Automaton): Automaton => ({ ...m, alphabet: [...ALPHABET_2] });
      const one = minimalStateCount(widen(regexToNFA(node)));
      const two = minimalStateCount(widen(regexToNFA(simplifyRegex(node))));
      const three = minimalStateCount(widen(minimize(regexToNFA(node))));
      expect([one, two, three], `par score is not a function of the language: ${show(node)}`).toEqual([
        one,
        one,
        one,
      ]);
    }
  });
});

// ---------------------------------------------------------------------------
// 14. shortestAccepted
// ---------------------------------------------------------------------------

describe('property: shortestAccepted is the shortest, lexicographically first', () => {
  it('matches a brute-force scan of Σ^≤7', () => {
    const r = rngOf(SEED ^ 0x7a8b);
    for (let i = 0; i < CASES; i++) {
      const nfa = randomNfa(r, ALPHABET_2);
      const truth = sampleStrings(ALPHABET_2, MAX_TEST_LEN).find((s) => accepts(nfa, s));
      const got = shortestAccepted(nfa);
      if (truth === undefined) {
        // Nothing that short. A machine with ≤ 2^6 reachable DFA states that accepts
        // anything accepts something shorter than that, so a *longer* answer is still
        // legal here — but it may never be one inside the window we just scanned.
        if (got !== null) expect(got.length).toBeGreaterThan(MAX_TEST_LEN);
        continue;
      }
      expect(got, `shortestAccepted missed "${truth}": ${showNfa(nfa)}`).toBe(truth);
    }
  });
});

// ---------------------------------------------------------------------------
// 15. trace — the animation must not lie about the run
// ---------------------------------------------------------------------------

describe('property: trace agrees with accepts, and its steps line up', () => {
  it('honours every clause of its own docstring', () => {
    const r = rngOf(SEED ^ 0x9c0d);
    for (let i = 0; i < CASES; i++) {
      const nfa = randomNfa(r, ALPHABET_2);
      for (const input of sampleStrings(ALPHABET_2, 3)) {
        const t = trace(nfa, input);
        expect(t.accepted, `trace/accepts drifted on "${input}"`).toBe(accepts(nfa, input));
        expect(t.input).toBe(input);
        expect(t.steps[0].pos).toBe(0);
        expect(t.steps[0].consumed).toBeUndefined();

        t.steps.forEach((s, k) => {
          expect(s.pos).toBe(k);
          if (k > 0) expect(s.consumed).toBe(input[k - 1]);
          expect(s.states.length, 'a step with no live state must have ended the run').toBeGreaterThan(0);
          expect([...s.states].sort(), 'step states must come out sorted').toEqual(s.states);
        });

        if (t.stuckAt === undefined) {
          expect(t.steps.length).toBe(input.length + 1);
        } else {
          // stuckAt is the first pos at which nothing survives, so input[stuckAt-1]
          // is the symbol that killed the run — and it is always ≥ 1.
          expect(t.stuckAt).toBeGreaterThanOrEqual(1);
          expect(t.stuckAt).toBeLessThanOrEqual(input.length);
          expect(t.steps.length).toBe(t.stuckAt);
          expect(t.accepted).toBe(false);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 16. The animations — the lesson IS these frames
// ---------------------------------------------------------------------------

describe('property: the *Steps twins never drift from the answers', () => {
  it('regexToNFASteps: one frame per AST node, last frame IS the machine', () => {
    const r = rngOf(SEED ^ 0xa1b2);
    for (let i = 0; i < CASES; i++) {
      const node = randomRegex(r, ALPHABET_2, MAX_REGEX_DEPTH);
      const steps = regexToNFASteps(node);
      expect(steps.length, `frame count ≠ regexSize: ${show(node)}`).toBe(regexSize(node));
      expect(steps[steps.length - 1].fragment, `last frame ≠ regexToNFA: ${show(node)}`).toEqual(
        regexToNFA(node),
      );
      // Every fragment is a real machine for its own sub-regex — not just a picture.
      for (const s of steps) {
        const bad = firstDisagreement(
          ALPHABET_2,
          4,
          (w) => matchesAst(s.node, w),
          (w) => accepts(s.fragment, w),
        );
        expect(bad, `frame "${s.label}" is not the machine for its sub-regex (on "${bad}")`).toBeNull();
      }
    }
  });

  it('automatonToRegexSteps: one frame per reachable state, last answer IS the regex', () => {
    const r = rngOf(SEED ^ 0xc3d4);
    for (let i = 0; i < CASES; i++) {
      const nfa = randomNfa(r, ALPHABET_2);
      const steps = automatonToRegexSteps(nfa);
      expect(steps.length, `frame count ≠ reachable states: ${showNfa(nfa)}`).toBe(
        reachableStates(nfa).size,
      );
      expect(
        steps[steps.length - 1].regexSoFar,
        `the animation's final answer ≠ automatonToRegex: ${showNfa(nfa)}`,
      ).toBe(renderRegex(automatonToRegex(nfa)));
    }
  });
});

// ---------------------------------------------------------------------------
// 17. Deeper, wider, longer — the same laws with the knobs turned up
// ---------------------------------------------------------------------------

describe('property: the laws survive the knobs turned up', () => {
  const DEEP = 6;
  const DEEP_CASES = 120;

  it('render/parse and simplify hold on depth-6 trees over {a,b,c}', () => {
    const r = rngOf(SEED ^ 0xdeadbee);
    for (let i = 0; i < DEEP_CASES; i++) {
      const node = randomRegex(r, ALPHABET_3, DEEP);
      const parsed = parseRegex(renderRegex(node));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.node).toEqual(node);

      const simple = simplifyRegex(node);
      const bad = firstDisagreement(
        ALPHABET_3,
        5,
        (s) => matchesAst(node, s),
        (s) => matchesAst(simple, s),
      );
      expect(bad, `deep simplify broke on "${bad}": ${show(node)}`).toBeNull();
      // Simplification may never make a regex bigger — that is the promise the par
      // score is scored against.
      expect(regexSize(simple), `simplify grew the tree: ${show(node)}`).toBeLessThanOrEqual(
        regexSize(node),
      );
    }
  });

  it('the full round trip holds on depth-6 trees over {a,b,c}', () => {
    const r = rngOf(SEED ^ 0xfacade);
    for (let i = 0; i < DEEP_CASES; i++) {
      const node = randomRegex(r, ALPHABET_3, DEEP);
      const nfa: Automaton = { ...regexToNFA(node), alphabet: [...ALPHABET_3] };
      const back = automatonToRegex(minimize(toDFA(nfa).dfa));
      const parsed = parseRegex(renderRegex(back));
      expect(parsed.ok, `unparseable answer "${renderRegex(back)}" from ${show(node)}`).toBe(true);
      if (!parsed.ok) continue;
      const bad = firstDisagreement(
        ALPHABET_3,
        5,
        (s) => matchesAst(node, s),
        (s) => matchesAst(parsed.node, s),
      );
      expect(
        bad,
        `deep round trip broke on "${bad}":\n  in:  ${show(node)}\n  out: ${renderRegex(back)}`,
      ).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 18. equivalent(), pushed: hostile names, three letters, partial operands
// ---------------------------------------------------------------------------

describe('property: equivalent() holds up under the nastiest inputs', () => {
  it('finds the shortest-lex counterexample over a 3-letter alphabet', () => {
    // Three symbols is the sharper test of the LEX tie-break: with two, "shortest"
    // and "shortest-lex" coincide far too often for a bug to show.
    const r = rngOf(SEED ^ 0x3abc);
    let differing = 0;
    for (let i = 0; i < CASES; i++) {
      const a = randomNfa(r, ALPHABET_3);
      const b = randomNfa(r, ALPHABET_3);
      const truth = firstDisagreement(
        ALPHABET_3,
        5,
        (s) => accepts(a, s),
        (s) => accepts(b, s),
      );
      const verdict = equivalent(a, b);
      if (truth === null) continue;
      differing++;
      expect(verdict.equal).toBe(false);
      if (verdict.equal) continue;
      expect(
        verdict.counterexample,
        `not the shortest-lex counterexample over {a,b,c}:\n  a=${showNfa(a)}\n  b=${showNfa(b)}`,
      ).toBe(truth);
    }
    expect(differing).toBeGreaterThan(CASES / 4);
  });

  it('survives product state-name collisions ("(x,y,z)" is two different pairs)', () => {
    // pairName('s0', 's1,s2') and pairName('s0,s1', 's2') are BOTH "(s0,s1,s2)". If
    // the product keyed identity off that display name it would fuse two states —
    // and then confidently hand a child the wrong counterexample.
    const r = rngOf(SEED ^ 0x5def);
    for (let i = 0; i < CASES; i++) {
      const a = randomHostileNfa(r, ALPHABET_2);
      const b = randomHostileNfa(r, ALPHABET_2);
      const truth = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => accepts(a, s),
        (s) => accepts(b, s),
      );
      // `equivalent` throws by design if its own xor product and the simulator ever
      // disagree about a language. Reaching that throw IS the bug we are hunting.
      const verdict = equivalent(a, b);
      if (truth === null) {
        if (!verdict.equal) expect(verdict.counterexample.length).toBeGreaterThan(MAX_TEST_LEN);
        continue;
      }
      expect(verdict.equal, `missed a difference at "${truth}"`).toBe(false);
      if (!verdict.equal) expect(verdict.counterexample).toBe(truth);
    }
  });

  it('is exact when an operand is a *partial* machine (minimize drops the trap)', () => {
    // `minimize` returns a machine whose failing moves are simply ABSENT. Feeding
    // that back into product/complement is the everyday lesson flow, and a partial
    // machine is exactly what breaks a flip-the-accepting-set complement.
    const r = rngOf(SEED ^ 0x7bad);
    for (let i = 0; i < CASES; i++) {
      const nfa = randomNfa(r, ALPHABET_2);
      const partial = minimize(nfa);
      expect(equivalent(nfa, partial).equal, `minimize moved the language: ${showNfa(nfa)}`).toBe(
        true,
      );
      const not = complement(partial);
      const bad = firstDisagreement(
        ALPHABET_2,
        MAX_TEST_LEN,
        (s) => !accepts(nfa, s),
        (s) => accepts(not, s),
      );
      expect(bad, `complement of a partial machine is wrong on "${bad}": ${showNfa(nfa)}`).toBeNull();
    }
  });
});

// ===========================================================================
// KNOWN DEFECTS — found by this suite, NOT fixed here (that is the next phase).
//
// These are `it.fails`: vitest treats them as GREEN while the bug is present and
// turns them RED the moment somebody fixes it. That inversion is deliberate. Each
// body asserts the CORRECT behaviour, so the fix is finished when you delete the
// `.fails` and the test goes green on its own merits. Do not delete the test.
//
// All three are the same root cause wearing three hats: `Sym` is defined as "one
// character", the regex surface syntax has NO escape, and `regexParse.ts` claims
// an OPEN alphabet ("any character that is not one of the eight metacharacters is
// a literal symbol, whatever it is"). Those three claims are not simultaneously
// satisfiable, and the engine currently mis-grades rather than complains.
// ===========================================================================

describe('KNOWN DEFECTS (it.fails: green while broken, red once fixed)', () => {
  /**
   * DEFECT 1 — an astral symbol (emoji) can never be accepted by its own machine.
   *
   * `tokenize` iterates by CODE POINT, so '😀' is one literal, and `regexToNFA`
   * duly builds an edge on it; `alphabetOf` reports ['😀']. But `simulate.runInput`
   * indexes the input by UTF-16 CODE UNIT (`input[i]`), so it feeds the machine two
   * lone surrogates, and the edge on the 2-unit symbol never fires. The machine
   * rejects the one string its language contains.
   *
   * This is the worst failure mode the engine has: a child types the correct answer
   * and is told they are wrong, with a straight face. It is silent — nothing throws,
   * nothing warns — and it contradicts regexParse.ts's own docstring, which
   * advertises "{a,b}, {0,1} and emoji all work with zero configuration".
   *
   * MINIMAL REPRO: accepts(regexToNFA(parseRegex('😀').node), '😀') === false
   */
  it.fails('a machine for the regex 😀 accepts the string 😀', () => {
    const parsed = parseRegex('😀');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.node).toEqual({ kind: 'literal', sym: '😀' });
    const m = regexToNFA(parsed.node);
    expect(alphabetOf(m)).toEqual(['😀']);
    expect(accepts(m, '😀')).toBe(true); // <-- currently false
  });

  /**
   * DEFECT 2 — whitespace is a silent ninth metacharacter, and it eats a language.
   *
   * `tokenize` drops every `\s` character. So ' ' (a perfectly legal `Sym`) cannot
   * be written as a regex at all: a machine over Σ = {' '} whose language is {" "}
   * renders to the regex `" "`, which re-parses to **ε** — a different language.
   * The machine→regex→machine leg of Kleene's theorem, which is the lesson, is
   * therefore NOT the identity on this alphabet.
   *
   * It also silently rewrites what a child typed: `parseRegex('a b')` is `ab`.
   * Over Σ = {a, b, ' '} that is the wrong language, and the grader will not say so.
   *
   * MINIMAL REPRO: parseRegex(renderRegex({kind:'literal', sym:' '})).node
   *                === {kind:'epsilon'}   (should be the literal ' ')
   */
  it.fails('a literal space survives render → parse', () => {
    const space: RegexNode = { kind: 'literal', sym: ' ' };
    const parsed = parseRegex(renderRegex(space));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.node).toEqual(space); // <-- currently {kind:'epsilon'}
  });

  /**
   * DEFECT 3 — a machine over a metacharacter alphabet renders to a regex that does
   * not parse, so `automatonToRegex` has no inverse there.
   *
   * Σ = {'+'} is not exotic; it is the alphabet of an arithmetic-token lesson. The
   * machine accepting exactly "+" renders to the regex `+`, and `parseRegex('+')`
   * fails with "There is nothing before '+' to repeat." The ConvertLab would show a
   * child a machine, convert it, and hand back a broken regex.
   *
   * `renderRegex` DOES document this ("Precondition: literal symbols are not
   * metacharacters… there is no escape hatch, by design") — but `automatonToRegex`
   * inherits the precondition without stating it, and nothing in the engine enforces
   * or even detects it. An unrepresentable alphabet should be rejected loudly at the
   * door, not turned into a regex that silently fails to parse.
   *
   * MINIMAL REPRO: parseRegex(renderRegex({kind:'literal', sym:'+'})).ok === false
   */
  it.fails('a machine over Σ={+} round trips through its own regex', () => {
    const machine: Automaton = {
      states: ['q0', 'q1'],
      alphabet: ['+'],
      transitions: [{ from: 'q0', on: '+', to: 'q1' }],
      start: 'q0',
      accepting: ['q1'],
    };
    expect(accepts(machine, '+')).toBe(true);
    const text = renderRegex(automatonToRegex(machine));
    const parsed = parseRegex(text);
    expect(parsed.ok, `the regex for this machine does not parse: "${text}"`).toBe(true);
    if (!parsed.ok) return;
    expect(accepts(regexToNFA(parsed.node), '+')).toBe(true);
  });
});
