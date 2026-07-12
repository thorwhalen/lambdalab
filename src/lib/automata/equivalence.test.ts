/**
 * Tests for machine equivalence and the shortest counterexample.
 *
 * The load-bearing idea here is the **oracle**: `bruteForce` recomputes the minimal
 * counterexample independently — by running the simulator over `sampleStrings` in
 * length-then-lex order and taking the first disagreement — and every inequivalence
 * assertion is cross-checked against it. `equivalent` reaches its answer through the
 * subset construction and a product BFS; the oracle reaches it by exhaustive brute
 * force. They share only `accepts`. Agreement between two such different routes is
 * evidence; a hand-written expected value would only be evidence that the author and
 * the implementation made the same mistake.
 *
 * That oracle is then pointed at ~1500 random machine pairs (seeded, so a failure is
 * reproducible), sized so that the theory guarantees the brute-force bound is not the
 * thing that passes the test — see `RANDOM_MAX_STATES`.
 */

import { describe, expect, it } from 'vitest';
import { EPSILON, type Automaton, type Sym } from './types';
import { accepts, alphabetOf } from './simulate';
import { acceptsLanguage, equivalent, sampleStrings, shortestAccepted } from './equivalence';

// ---------------------------------------------------------------------------
// The oracle
// ---------------------------------------------------------------------------

const unionAlphabet = (a: Automaton, b: Automaton): Sym[] =>
  [...new Set([...alphabetOf(a), ...alphabetOf(b)])].sort();

/**
 * The minimal counterexample, computed the dumb way: walk every string over the union
 * alphabet in length-then-lex order and return the first the two machines disagree on.
 *
 * Correct by construction *given* `sampleStrings` is correctly ordered — which is why
 * that ordering is itself tested below, against hand-written expectations.
 */
const bruteForce = (a: Automaton, b: Automaton, maxLen: number): string | null => {
  for (const s of sampleStrings(unionAlphabet(a, b), maxLen)) {
    if (accepts(a, s) !== accepts(b, s)) return s;
  }
  return null;
};

/**
 * How deep the oracle must look before "found nothing" means "there is nothing".
 *
 * **Moore's bound.** Put the two completed DFAs side by side as one machine with N
 * states. Partition refinement starts with 2 blocks (accepting / not) and every round
 * that changes anything splits at least one block, so it converges within N - 2 rounds;
 * a pair first separated at round k is distinguished by a string of length exactly k.
 * Hence: if two machines differ at all, they differ on a string of length ≤ N - 2.
 *
 * So the bound is a SUM, not a product — n + m, not n·m. That matters: it is what lets
 * an exhaustive oracle be cheap enough to run thousands of times, and it is the reason
 * "the oracle found no counterexample" is a proof of equivalence here rather than a
 * search that ran out of patience.
 *
 * `oracleDepth` computes it from the two machines (+1 each for a trap that widening to
 * the union alphabet may add, +2 of slack because a loose bound costs only speed while
 * a tight-but-wrong one would silently weaken every equality assertion in the file).
 */
const oracleDepth = (a: Automaton, b: Automaton): number =>
  a.states.length + b.states.length + 2 + 2;

/**
 * Assert `equivalent(a, b)` agrees with the oracle: same verdict, same counterexample,
 * and a counterexample that really is misclassified in the direction reported.
 */
const expectAgreesWithOracle = (a: Automaton, b: Automaton, maxLen?: number): void => {
  const verdict = equivalent(a, b);
  const oracle = bruteForce(a, b, maxLen ?? oracleDepth(a, b));

  if (oracle === null) {
    expect(verdict).toEqual({ equal: true });
    return;
  }

  expect(verdict.equal).toBe(false);
  if (verdict.equal) return; // narrowing; unreachable given the assertion above

  // Not just "some disagreeing string" — the SAME one the exhaustive length-then-lex
  // walk found first. That is the minimality claim, checked rather than asserted.
  expect(verdict.counterexample).toBe(oracle);

  // And the witness must actually witness: exactly one machine accepts it, and
  // `acceptedBy` names that one.
  const inA = accepts(a, verdict.counterexample);
  const inB = accepts(b, verdict.counterexample);
  expect(inA).not.toBe(inB);
  expect(verdict.acceptedBy).toBe(inA ? 'a' : 'b');
};

/** Equivalent, cross-checked both ways round, and confirmed by the exhaustive oracle. */
const expectEquivalent = (a: Automaton, b: Automaton): void => {
  expect(equivalent(a, b)).toEqual({ equal: true });
  expect(equivalent(b, a)).toEqual({ equal: true });
  expectAgreesWithOracle(a, b);
  expectAgreesWithOracle(b, a);
};

// ---------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------

const AB: Sym[] = ['a', 'b'];

/** Even number of a's, over {a,b}. Two states — the minimal machine. */
const evenAs2: Automaton = {
  states: ['even', 'odd'],
  alphabet: AB,
  transitions: [
    { from: 'even', on: 'a', to: 'odd' },
    { from: 'even', on: 'b', to: 'even' },
    { from: 'odd', on: 'a', to: 'even' },
    { from: 'odd', on: 'b', to: 'odd' },
  ],
  start: 'even',
  accepting: ['even'],
};

/**
 * Even number of a's again — but tracking the parity of the b's too, and then ignoring
 * it. Four states, none of them mergeable with a state of `evenAs2` by name. Same
 * language, structurally unrelated machine: the equivalence check must see through that.
 */
const evenAs4: Automaton = {
  states: ['e0', 'e1', 'o0', 'o1'],
  alphabet: AB,
  transitions: [
    { from: 'e0', on: 'a', to: 'o0' },
    { from: 'e0', on: 'b', to: 'e1' },
    { from: 'e1', on: 'a', to: 'o1' },
    { from: 'e1', on: 'b', to: 'e0' },
    { from: 'o0', on: 'a', to: 'e0' },
    { from: 'o0', on: 'b', to: 'o1' },
    { from: 'o1', on: 'a', to: 'e1' },
    { from: 'o1', on: 'b', to: 'o0' },
  ],
  start: 'e0',
  accepting: ['e0', 'e1'],
};

/** Even number of a's, a third time: an ε-NFA, so the ε-closure path is exercised too. */
const evenAsEpsilonNfa: Automaton = {
  states: ['s', 'even', 'odd'],
  alphabet: AB,
  transitions: [
    { from: 's', on: EPSILON, to: 'even' },
    { from: 'even', on: 'a', to: 'odd' },
    { from: 'even', on: 'b', to: 'even' },
    { from: 'odd', on: 'a', to: 'even' },
    { from: 'odd', on: 'b', to: 'odd' },
  ],
  start: 's',
  accepting: ['even'],
};

/** Ends with "ab". NFA: guess when the final 'ab' begins. */
const endsWithAb: Automaton = {
  states: ['q0', 'q1', 'q2'],
  alphabet: AB,
  transitions: [
    { from: 'q0', on: 'a', to: 'q0' },
    { from: 'q0', on: 'b', to: 'q0' },
    { from: 'q0', on: 'a', to: 'q1' },
    { from: 'q1', on: 'b', to: 'q2' },
  ],
  start: 'q0',
  accepting: ['q2'],
};

/** Contains "ab" anywhere. Same shape as `endsWithAb` plus a sink loop — the classic
 * confusion, and the reason the counterexample has to be exactly right. */
const containsAb: Automaton = {
  states: ['q0', 'q1', 'q2'],
  alphabet: AB,
  transitions: [
    { from: 'q0', on: 'a', to: 'q0' },
    { from: 'q0', on: 'b', to: 'q0' },
    { from: 'q0', on: 'a', to: 'q1' },
    { from: 'q1', on: 'b', to: 'q2' },
    { from: 'q2', on: 'a', to: 'q2' },
    { from: 'q2', on: 'b', to: 'q2' },
  ],
  start: 'q0',
  accepting: ['q2'],
};

/** a*, declared over {a} ONLY. The machine that has never heard of 'b'. */
const aStarOverA: Automaton = {
  states: ['s'],
  alphabet: ['a'],
  transitions: [{ from: 's', on: 'a', to: 's' }],
  start: 's',
  accepting: ['s'],
};

/** a*, declared over {a,b} — with the trap on 'b' spelled out. */
const aStarOverAb: Automaton = {
  states: ['s', 'dead'],
  alphabet: AB,
  transitions: [
    { from: 's', on: 'a', to: 's' },
    { from: 's', on: 'b', to: 'dead' },
    { from: 'dead', on: 'a', to: 'dead' },
    { from: 'dead', on: 'b', to: 'dead' },
  ],
  start: 's',
  accepting: ['s'],
};

/** (a|b)* — everything, over {a,b}. */
const everythingOverAb: Automaton = {
  states: ['s'],
  alphabet: AB,
  transitions: [
    { from: 's', on: 'a', to: 's' },
    { from: 's', on: 'b', to: 's' },
  ],
  start: 's',
  accepting: ['s'],
};

/** aa* — at least one 'a'. Differs from `aStarOverA` on ε and nothing else. */
const aPlusOverA: Automaton = {
  states: ['s', 't'],
  alphabet: ['a'],
  transitions: [
    { from: 's', on: 'a', to: 't' },
    { from: 't', on: 'a', to: 't' },
  ],
  start: 's',
  accepting: ['t'],
};

/** ∅ — no accepting states at all. */
const noAccepting: Automaton = {
  states: ['q'],
  alphabet: AB,
  transitions: [],
  start: 'q',
  accepting: [],
};

/** ∅ again, the roundabout way: plenty of structure, still nothing accepting. */
const noAcceptingBusy: Automaton = {
  states: ['p', 'r'],
  alphabet: AB,
  transitions: [
    { from: 'p', on: 'a', to: 'r' },
    { from: 'r', on: 'b', to: 'p' },
    { from: 'p', on: 'b', to: 'p' },
  ],
  start: 'p',
  accepting: [],
};

/** ∅ a third way: an accepting state that no string can reach. */
const unreachableAccepting: Automaton = {
  states: ['p', 'island'],
  alphabet: AB,
  transitions: [
    { from: 'p', on: 'a', to: 'p' },
    { from: 'p', on: 'b', to: 'p' },
    { from: 'island', on: 'a', to: 'island' },
  ],
  start: 'p',
  accepting: ['island'],
};

// ---------------------------------------------------------------------------
// equivalent — the cases the lesson actually leans on
// ---------------------------------------------------------------------------

describe('equivalent', () => {
  it('sees through structure: three different machines for "even number of a\'s"', () => {
    // `expectEquivalent` also runs each pair the other way round — nothing in the
    // construction makes symmetry free (the product is built from a's states, then b's).
    expectEquivalent(evenAs2, evenAs4);
    expectEquivalent(evenAs2, evenAsEpsilonNfa);
    expectEquivalent(evenAs4, evenAsEpsilonNfa);
  });

  it('is reflexive, including on an NFA with ε-moves', () => {
    for (const m of [evenAs2, endsWithAb, containsAb, evenAsEpsilonNfa, noAccepting]) {
      expect(equivalent(m, m)).toEqual({ equal: true });
    }
  });

  it('"ends with ab" vs "contains ab": counterexample is "aba"', () => {
    // Shortest disagreement is length 3 ('ab' itself is accepted by both), and 'aba'
    // beats 'abb' lexicographically. Hand-written, then proved by the oracle below.
    expect(equivalent(endsWithAb, containsAb)).toEqual({
      equal: false,
      counterexample: 'aba',
      acceptedBy: 'b',
    });
    expectAgreesWithOracle(endsWithAb, containsAb);
  });

  it('reports acceptedBy from the machines\' side, not the argument order', () => {
    // Swap the operands: the same string, but now the FIRST machine is the one that
    // accepts it.
    expect(equivalent(containsAb, endsWithAb)).toEqual({
      equal: false,
      counterexample: 'aba',
      acceptedBy: 'a',
    });
    expectAgreesWithOracle(containsAb, endsWithAb);
  });

  // -- the alphabet trap ----------------------------------------------------

  it('compares over the UNION alphabet: a*-over-{a} differs from (a|b)*-over-{a,b}', () => {
    // Over {a} alone these two are indistinguishable — every a-string is accepted by
    // both. The disagreement lives entirely in the letter the first machine has never
    // heard of. A checker that used only the first machine's Σ would call these equal
    // and congratulate a learner who forgot half the alphabet.
    expect(equivalent(aStarOverA, everythingOverAb)).toEqual({
      equal: false,
      counterexample: 'b',
      acceptedBy: 'b',
    });
    expectAgreesWithOracle(aStarOverA, everythingOverAb);
    expectAgreesWithOracle(everythingOverAb, aStarOverA);
  });

  it('but does not invent a difference: a* over {a} == a* over {a,b} with an explicit trap', () => {
    // The mirror of the trap above, and the reason it cannot be "fixed" by simply
    // rejecting machines with unequal alphabets. A machine with no 'b'-move *rejects*
    // every string containing 'b' — which is exactly what the explicit trap does.
    expectEquivalent(aStarOverA, aStarOverAb);
  });

  it('handles a declared-but-unused symbol (Σ is declared ∪ drawn)', () => {
    // 'b' is declared and never drawn: the machine can still read it, and must reject
    // when it does. So this is a*, and equal to the {a}-only a*.
    const declaredB: Automaton = { ...aStarOverA, alphabet: AB };
    expect(equivalent(declaredB, aStarOverA)).toEqual({ equal: true });
    expect(equivalent(declaredB, everythingOverAb)).toEqual({
      equal: false,
      counterexample: 'b',
      acceptedBy: 'b',
    });
  });

  it('compares machines over entirely disjoint alphabets', () => {
    const bStarOverB: Automaton = {
      states: ['s'],
      alphabet: ['b'],
      transitions: [{ from: 's', on: 'b', to: 's' }],
      start: 's',
      accepting: ['s'],
    };
    // Both accept ε; they part company at length 1, and 'a' sorts before 'b'.
    expect(equivalent(aStarOverA, bStarOverB)).toEqual({
      equal: false,
      counterexample: 'a',
      acceptedBy: 'a',
    });
    expectAgreesWithOracle(aStarOverA, bStarOverB);
  });

  // -- the empty language ---------------------------------------------------

  it('the empty language, three ways: all equivalent', () => {
    expectEquivalent(noAccepting, noAcceptingBusy);
    expectEquivalent(noAccepting, unreachableAccepting);
    expectEquivalent(noAcceptingBusy, unreachableAccepting);
  });

  it('an unreachable accepting state does not make a language non-empty', () => {
    // The classic learner bug: they drew the accepting state but never connected it.
    // The machine is ∅, and the equivalence checker must say so rather than be fooled
    // by the presence of a state in `accepting`.
    expect(equivalent(unreachableAccepting, everythingOverAb)).toEqual({
      equal: false,
      counterexample: '',
      acceptedBy: 'b',
    });
    expectAgreesWithOracle(unreachableAccepting, everythingOverAb);
  });

  it('the empty language is not the language of the empty string', () => {
    const justEpsilon: Automaton = { ...noAccepting, accepting: ['q'] };
    expect(equivalent(noAccepting, justEpsilon)).toEqual({
      equal: false,
      counterexample: '',
      acceptedBy: 'b',
    });
  });

  // -- the empty-string counterexample --------------------------------------

  it('finds the EMPTY STRING as the counterexample (a* vs aa*)', () => {
    // These two agree on every non-empty string. The only witness is ε — and a search
    // that started at length 1, or that reconstructed the word without handling the
    // zero-length walk, would report `equal` here and be wrong in the most invisible
    // way available.
    expect(equivalent(aStarOverA, aPlusOverA)).toEqual({
      equal: false,
      counterexample: '',
      acceptedBy: 'a',
    });
    expectAgreesWithOracle(aStarOverA, aPlusOverA);
    expectAgreesWithOracle(aPlusOverA, aStarOverA);
  });

  // -- degenerate machines --------------------------------------------------

  it('single-state machines', () => {
    const oneAccepting: Automaton = {
      states: ['s'],
      alphabet: [],
      transitions: [],
      start: 's',
      accepting: ['s'],
    };
    const oneRejecting: Automaton = { ...oneAccepting, accepting: [] };

    expect(equivalent(oneAccepting, oneAccepting)).toEqual({ equal: true });
    expect(equivalent(oneRejecting, oneRejecting)).toEqual({ equal: true });
    // With an empty alphabet, ε is the ONLY string there is — so it is also the only
    // possible counterexample.
    expect(equivalent(oneAccepting, oneRejecting)).toEqual({
      equal: false,
      counterexample: '',
      acceptedBy: 'a',
    });
  });

  it('an empty-alphabet machine vs an {a,b} machine: Σ comes from the union', () => {
    const justEpsilonNoAlphabet: Automaton = {
      states: ['s'],
      alphabet: [],
      transitions: [],
      start: 's',
      accepting: ['s'],
    };
    // The union alphabet is {a,b}, so the second machine's extra strings are visible.
    expect(equivalent(justEpsilonNoAlphabet, everythingOverAb)).toEqual({
      equal: false,
      counterexample: 'a',
      acceptedBy: 'b',
    });
  });

  it('a machine whose start state is not listed in `states` (start is a state by definition)', () => {
    const sloppy: Automaton = { ...evenAs2, states: ['odd'] };
    expect(equivalent(sloppy, evenAs2)).toEqual({ equal: true });
  });

  it('tolerates dangling transitions and phantom accepting states', () => {
    // Malformed data must degrade to *rejection*, never to an exception: this code runs
    // while a child is mid-edit.
    const junk: Automaton = {
      ...evenAs2,
      transitions: [...evenAs2.transitions, { from: 'even', on: 'a', to: 'nowhere' }],
      accepting: ['even', 'ghost'],
    };
    expect(equivalent(junk, evenAs2)).toEqual({ equal: true });
  });

  // -- determinism of the output --------------------------------------------

  it('is deterministic: reordering transitions changes nothing', () => {
    const shuffled: Automaton = {
      ...containsAb,
      states: [...containsAb.states].reverse(),
      transitions: [...containsAb.transitions].reverse(),
    };
    expect(equivalent(endsWithAb, shuffled)).toEqual({
      equal: false,
      counterexample: 'aba',
      acceptedBy: 'b',
    });
    expect(equivalent(shuffled, containsAb)).toEqual({ equal: true });
  });

  it('breaks length ties lexicographically in the alphabet\'s sort order', () => {
    // Both machines accept ε. They differ on 'a' AND on 'b' (each of length 1), so the
    // tie-break is the only thing choosing between them — and it must choose 'a'.
    const acceptsBOnly: Automaton = {
      states: ['s', 'f'],
      alphabet: AB,
      transitions: [{ from: 's', on: 'b', to: 'f' }],
      start: 's',
      accepting: ['s', 'f'],
    };
    const acceptsAOnly: Automaton = {
      states: ['s', 'f'],
      alphabet: AB,
      transitions: [{ from: 's', on: 'a', to: 'f' }],
      start: 's',
      accepting: ['s', 'f'],
    };
    expect(equivalent(acceptsAOnly, acceptsBOnly)).toEqual({
      equal: false,
      counterexample: 'a',
      acceptedBy: 'a',
    });
    expectAgreesWithOracle(acceptsAOnly, acceptsBOnly);
  });

  it('finds a long counterexample when that is the shortest one', () => {
    // "multiple of 4 a's" vs "multiple of 2 a's" over {a}: they first disagree at 'aa'.
    // Then "multiple of 3" vs "multiple of 4": first disagreement is 'aaa'.
    const modA = (n: number): Automaton => ({
      states: Array.from({ length: n }, (_, i) => `r${i}`),
      alphabet: ['a'],
      transitions: Array.from({ length: n }, (_, i) => ({
        from: `r${i}`,
        on: 'a',
        to: `r${(i + 1) % n}`,
      })),
      start: 'r0',
      accepting: ['r0'],
    });

    // Both accept ε (0 is a multiple of everything), so the witness is never trivial —
    // the search has to walk out to the first multiple of one that is not a multiple of
    // the other. mod 4 vs mod 2 first part at 'aa'; mod 3 vs mod 4 at 'aaa'; mod 5 vs
    // mod 7 not until 'aaaaa'.
    expect(equivalent(modA(4), modA(2))).toEqual({
      equal: false,
      counterexample: 'aa',
      acceptedBy: 'b',
    });
    expect(equivalent(modA(3), modA(4))).toEqual({
      equal: false,
      counterexample: 'aaa',
      acceptedBy: 'a',
    });
    expect(equivalent(modA(5), modA(7))).toEqual({
      equal: false,
      counterexample: 'aaaaa',
      acceptedBy: 'a',
    });

    for (const [n, m] of [[4, 2], [3, 4], [5, 7], [6, 6], [2, 4]]) {
      expectAgreesWithOracle(modA(n), modA(m));
    }
    // Same modulus, different state names: equivalent.
    expectEquivalent(modA(6), modA(6));
  });
});

// ---------------------------------------------------------------------------
// Randomised cross-check against the oracle
// ---------------------------------------------------------------------------

/**
 * Bound on random machine size. `oracleDepth` (Moore's bound, above) then makes the
 * exhaustive oracle affordable: a few hundred strings per pair, not a few hundred
 * thousand — so "the oracle found nothing" is a proof of equivalence and still runs
 * thousands of times in under a second.
 */
const RANDOM_MAX_STATES = 4;
const RANDOM_PAIRS = 300;

/** mulberry32 — a tiny seeded PRNG. Seeded so a failure is reproducible, not a ghost. */
const rng = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * A random total DFA. Deliberately NOT an NFA: subset construction would square the
 * state count, blowing past the length bound that makes the oracle sound (see above).
 * The NFA and ε-NFA paths are covered by the hand-written cases.
 */
const randomDfa = (next: () => number, alphabet: Sym[]): Automaton => {
  const n = 1 + Math.floor(next() * RANDOM_MAX_STATES);
  const states = Array.from({ length: n }, (_, i) => `q${i}`);
  const transitions = states.flatMap((from) =>
    alphabet.map((on) => ({ from, on, to: states[Math.floor(next() * n)] })),
  );
  return {
    states,
    alphabet,
    transitions,
    start: states[0],
    accepting: states.filter(() => next() < 0.5),
  };
};

describe('equivalent — randomised, against a brute-force oracle', () => {
  it(`agrees with brute force on ${RANDOM_PAIRS} random DFA pairs (same alphabet)`, () => {
    const next = rng(20260712);
    for (let i = 0; i < RANDOM_PAIRS; i++) {
      expectAgreesWithOracle(randomDfa(next, AB), randomDfa(next, AB));
    }
  });

  it(`agrees with brute force on ${RANDOM_PAIRS} random DFA pairs (MISMATCHED alphabets)`, () => {
    // The union-alphabet trap, hammered: one machine has never heard of 'b', the other
    // has. Checked both ways round, so `acceptedBy` is exercised in both directions.
    const next = rng(31415926);
    for (let i = 0; i < RANDOM_PAIRS; i++) {
      const a = randomDfa(next, ['a']);
      const b = randomDfa(next, AB);
      expectAgreesWithOracle(a, b);
      expectAgreesWithOracle(b, a);
    }
  });

  it('is an equivalence relation on random machines: reflexive, symmetric, transitive', () => {
    const next = rng(27182818);
    for (let i = 0; i < RANDOM_PAIRS; i++) {
      const a = randomDfa(next, AB);
      const b = randomDfa(next, AB);
      const c = randomDfa(next, AB);

      expect(equivalent(a, a)).toEqual({ equal: true });
      expect(equivalent(a, b).equal).toBe(equivalent(b, a).equal);
      // Transitivity is the property a subtly-wrong checker most often breaks, because
      // it cannot be faked by getting each pair individually plausible.
      if (equivalent(a, b).equal && equivalent(b, c).equal) {
        expect(equivalent(a, c)).toEqual({ equal: true });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// shortestAccepted
// ---------------------------------------------------------------------------

describe('shortestAccepted', () => {
  it('returns null for the empty language', () => {
    expect(shortestAccepted(noAccepting)).toBeNull();
    expect(shortestAccepted(noAcceptingBusy)).toBeNull();
  });

  it('returns null when the only accepting state is unreachable', () => {
    expect(shortestAccepted(unreachableAccepting)).toBeNull();
  });

  it('returns the EMPTY STRING when the start state accepts', () => {
    expect(shortestAccepted(evenAs2)).toBe('');
    expect(shortestAccepted(everythingOverAb)).toBe('');
    // And through an ε-move, which is where a naive "is start in accepting?" check fails.
    expect(shortestAccepted(evenAsEpsilonNfa)).toBe('');
  });

  it('finds the shortest word of a non-trivial language', () => {
    expect(shortestAccepted(endsWithAb)).toBe('ab');
    expect(shortestAccepted(containsAb)).toBe('ab');
    expect(shortestAccepted(aPlusOverA)).toBe('a');
  });

  it('breaks ties lexicographically among the shortest', () => {
    // Accepts exactly {'a', 'b'} — two words of length 1, and 'a' must win.
    const aOrB: Automaton = {
      states: ['s', 'f'],
      alphabet: AB,
      transitions: [
        { from: 's', on: 'a', to: 'f' },
        { from: 's', on: 'b', to: 'f' },
      ],
      start: 's',
      accepting: ['f'],
    };
    expect(shortestAccepted(aOrB)).toBe('a');
  });

  it('respects the limit, and finds the word once the limit allows it', () => {
    // Accepts exactly 'aaaaa' (five a's), nothing else.
    const fiveAs: Automaton = {
      states: ['s0', 's1', 's2', 's3', 's4', 's5'],
      alphabet: ['a'],
      transitions: [0, 1, 2, 3, 4].map((i) => ({ from: `s${i}`, on: 'a', to: `s${i + 1}` })),
      start: 's0',
      accepting: ['s5'],
    };
    expect(shortestAccepted(fiveAs, 4)).toBeNull();
    expect(shortestAccepted(fiveAs, 5)).toBe('aaaaa');
    expect(shortestAccepted(fiveAs)).toBe('aaaaa'); // default limit is generous
  });

  it('limit 0 admits only ε; a negative limit admits nothing at all', () => {
    expect(shortestAccepted(evenAs2, 0)).toBe(''); // ε is accepted, and |ε| = 0
    expect(shortestAccepted(endsWithAb, 0)).toBeNull(); // shortest is 'ab'
    expect(shortestAccepted(evenAs2, -1)).toBeNull(); // not even ε fits in a negative budget
  });

  it('agrees with brute force at EVERY limit, for every machine', () => {
    // Swept across limits rather than checked at one: `limit` is a boundary, and a
    // boundary tested at a single point is a boundary tested nowhere. At each L the
    // answer must be exactly the first string of length ≤ L that the machine accepts —
    // so an off-by-one in either direction is caught, for every L.
    const MAX_LIMIT = 8;
    for (const m of [
      evenAs2,
      evenAs4,
      evenAsEpsilonNfa,
      endsWithAb,
      containsAb,
      aStarOverA,
      aPlusOverA,
      noAccepting,
      noAcceptingBusy,
      unreachableAccepting,
      everythingOverAb,
    ]) {
      for (let limit = 0; limit <= MAX_LIMIT; limit++) {
        const expected = sampleStrings(alphabetOf(m), limit).find((s) => accepts(m, s)) ?? null;
        expect(shortestAccepted(m, limit)).toBe(expected);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// acceptsLanguage
// ---------------------------------------------------------------------------

describe('acceptsLanguage', () => {
  it('passes a machine that classifies every listed string correctly', () => {
    expect(acceptsLanguage(evenAs2, ['', 'aa', 'bb', 'aab'], ['a', 'ab', 'aaa'])).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('reports a string that should be accepted and is not', () => {
    expect(acceptsLanguage(endsWithAb, ['ab', 'aab', ''], [])).toEqual({
      ok: false,
      failures: [{ s: '', expected: true }],
    });
  });

  it('reports a string that should be rejected and is not', () => {
    expect(acceptsLanguage(containsAb, [], ['aba', 'ba'])).toEqual({
      ok: false,
      failures: [{ s: 'aba', expected: false }],
    });
  });

  it('reports accept-failures before reject-failures, each in the caller\'s order', () => {
    expect(acceptsLanguage(evenAs2, ['a', '', 'aaa'], ['bb', 'aa'])).toEqual({
      ok: false,
      failures: [
        { s: 'a', expected: true },
        { s: 'aaa', expected: true },
        { s: 'bb', expected: false },
        { s: 'aa', expected: false },
      ],
    });
  });

  it('handles the empty string in either list', () => {
    expect(acceptsLanguage(evenAs2, [''], []).ok).toBe(true);
    expect(acceptsLanguage(evenAs2, [], [''])).toEqual({
      ok: false,
      failures: [{ s: '', expected: false }],
    });
  });

  it('is vacuously ok on two empty lists — even for a nonsense machine', () => {
    expect(acceptsLanguage(noAccepting, [], [])).toEqual({ ok: true, failures: [] });
  });

  it('is a pure filter: a string in BOTH lists always fails', () => {
    // A self-contradictory puzzle. No machine can satisfy it, and the report says so
    // rather than quietly picking a side — this is how the puzzle library gets validated.
    expect(acceptsLanguage(evenAs2, ['aa'], ['aa'])).toEqual({
      ok: false,
      failures: [{ s: 'aa', expected: false }],
    });
    expect(acceptsLanguage(evenAs2, ['a'], ['a'])).toEqual({
      ok: false,
      failures: [{ s: 'a', expected: true }],
    });
  });

  it('rejects strings containing symbols outside the alphabet', () => {
    // A run that dies is a rejection, not an exception.
    expect(acceptsLanguage(evenAs2, ['zz'], [])).toEqual({
      ok: false,
      failures: [{ s: 'zz', expected: true }],
    });
    expect(acceptsLanguage(evenAs2, [], ['zz'])).toEqual({ ok: true, failures: [] });
  });

  it('agrees with `accepts` on every listed string, for every machine', () => {
    const strings = sampleStrings(AB, 4);
    for (const m of [evenAs2, endsWithAb, containsAb, evenAsEpsilonNfa]) {
      const shouldAccept = strings.filter((s) => accepts(m, s));
      const shouldReject = strings.filter((s) => !accepts(m, s));
      expect(acceptsLanguage(m, shouldAccept, shouldReject).ok).toBe(true);
      // Swap the lists and every single string must now be a failure.
      const swapped = acceptsLanguage(m, shouldReject, shouldAccept);
      expect(swapped.ok).toBe(false);
      expect(swapped.failures).toHaveLength(strings.length);
    }
  });
});

// ---------------------------------------------------------------------------
// sampleStrings — the oracle's own foundation, so it gets hand-written expectations
// ---------------------------------------------------------------------------

describe('sampleStrings', () => {
  it('includes the empty string and enumerates length-then-lexicographically', () => {
    expect(sampleStrings(['a', 'b'], 2)).toEqual(['', 'a', 'b', 'aa', 'ab', 'ba', 'bb']);
  });

  it('sorts the alphabet first — the caller\'s order is not the enumeration order', () => {
    expect(sampleStrings(['b', 'a'], 2)).toEqual(sampleStrings(['a', 'b'], 2));
  });

  it('deduplicates the alphabet', () => {
    expect(sampleStrings(['a', 'a', 'b', 'a'], 1)).toEqual(['', 'a', 'b']);
  });

  it('drops ε from the alphabet — ε is not a member of any alphabet', () => {
    // Otherwise the literal character 'ε' would appear inside generated strings and be
    // fed to the simulator as if it were a symbol.
    expect(sampleStrings([EPSILON, 'a'], 2)).toEqual(['', 'a', 'aa']);
  });

  it('maxLen 0 yields exactly the empty string', () => {
    expect(sampleStrings(['a', 'b'], 0)).toEqual(['']);
    expect(sampleStrings([], 0)).toEqual(['']);
  });

  it('an empty alphabet yields exactly the empty string, at any maxLen', () => {
    // Σ = ∅ has no words of positive length, but ε is a word over every alphabet.
    expect(sampleStrings([], 5)).toEqual(['']);
  });

  it('a negative maxLen yields nothing at all — not even ε', () => {
    expect(sampleStrings(['a'], -1)).toEqual([]);
  });

  it('yields exactly (|Σ|^(n+1) - 1)/(|Σ| - 1) strings, all distinct', () => {
    const alphabet = ['x', 'y', 'z'];
    const maxLen = 4;
    const out = sampleStrings(alphabet, maxLen);
    const expected = [0, 1, 2, 3, 4].reduce((sum, k) => sum + alphabet.length ** k, 0);
    expect(out).toHaveLength(expected); // 1 + 3 + 9 + 27 + 81 = 121
    expect(new Set(out).size).toBe(out.length);
  });

  it('is ordered: non-decreasing length, and lexicographic within a length', () => {
    const out = sampleStrings(['a', 'b', 'c'], 3);
    for (let i = 1; i < out.length; i++) {
      const prev = out[i - 1];
      const cur = out[i];
      expect(prev.length).toBeLessThanOrEqual(cur.length);
      if (prev.length === cur.length) expect(prev < cur).toBe(true);
    }
  });

  it('every string is over the alphabet, and every string over the alphabet is present', () => {
    const out = new Set(sampleStrings(['a', 'b'], 3));
    expect(out.has('aba')).toBe(true);
    expect(out.has('bbb')).toBe(true);
    expect(out.has('')).toBe(true);
    expect(out.has('abab')).toBe(false); // beyond maxLen
    expect(out.has('c')).toBe(false); // outside Σ
  });
});
