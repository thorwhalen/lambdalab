/**
 * Tests for state elimination.
 *
 * The load-bearing test is the ROUND TRIP: for a corpus of hand-built machines,
 * `regexToNFA(automatonToRegex(m))` must accept exactly the language of `m`. It
 * is the only test that can catch a *sound-looking* elimination bug — a rule that
 * drops a self-loop, or forgets the fresh-start normalisation — because such bugs
 * still produce a plausible regex, just for the wrong language.
 *
 * Equality of languages is checked THREE independent ways, because a round trip
 * that leans on a single possibly-buggy oracle proves nothing — and `equivalent`
 * is a sibling module written in parallel with this one:
 *
 *   1. `equivalent(m, m2).equal` — the engine's own grader.
 *   2. EXACTLY, by emptiness of the symmetric-difference product (`sameLanguage`).
 *   3. EMPIRICALLY, by running both machines on every string up to length 5 over
 *      the union alphabet (`agreeOnSamples`).
 *
 * If 1 ever disagrees with 2 or 3, one of the two modules is wrong and this file
 * goes red either way — which is the point of not collapsing them into one check.
 */

import { describe, expect, it } from 'vitest';
import { EPSILON, type Automaton, type Sym } from './types';
import { accepts, alphabetOf, reachableStates } from './simulate';
import { product } from './subset';
import { equivalent } from './equivalence';
import { regexToNFA } from './thompson';
import { renderRegex, simplifyRegex } from './regexParse';
import { automatonToRegex, automatonToRegexSteps } from './toRegex';

// ---------------------------------------------------------------------------
// Oracles
// ---------------------------------------------------------------------------

/** Exact: L(a) = L(b) iff the symmetric-difference machine can reach no accepting state. */
const sameLanguage = (a: Automaton, b: Automaton): boolean => {
  const xor = product(a, b, 'xor');
  const reach = reachableStates(xor);
  return !xor.accepting.some((s) => reach.has(s));
};

/** Every string over `alphabet` of length ≤ maxLen, shortest first. Includes ''. */
const sampleStrings = (alphabet: Sym[], maxLen: number): string[] => {
  let level = [''];
  const out = [''];
  for (let n = 0; n < maxLen; n++) {
    level = level.flatMap((s) => alphabet.map((c) => s + c));
    out.push(...level);
  }
  return out;
};

/** How deep the empirical cross-check goes. Enough to expose an off-by-one loop. */
const SAMPLE_DEPTH = 5;

const agreeOnSamples = (a: Automaton, b: Automaton): string[] => {
  const alphabet = [...new Set([...alphabetOf(a), ...alphabetOf(b)])].sort();
  return sampleStrings(alphabet, SAMPLE_DEPTH).filter((s) => accepts(a, s) !== accepts(b, s));
};

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

interface Case {
  name: string;
  m: Automaton;
  /** Sanity anchors, checked independently of the round trip. */
  accept: string[];
  reject: string[];
}

const CORPUS: Case[] = [
  {
    // The empty language: nowhere to accept. Must come out as ∅, not ε.
    name: 'empty language (no accepting state)',
    m: { states: ['q0'], alphabet: ['a'], transitions: [{ from: 'q0', on: 'a', to: 'q0' }], start: 'q0', accepting: [] },
    accept: [],
    reject: ['', 'a', 'aa'],
  },
  {
    // Empty again, but the accepting state exists — it just cannot be reached.
    name: 'empty language (accepting state unreachable)',
    m: { states: ['q0', 'q1'], alphabet: ['a'], transitions: [{ from: 'q1', on: 'a', to: 'q1' }], start: 'q0', accepting: ['q1'] },
    accept: [],
    reject: ['', 'a'],
  },
  {
    name: '{ε} — the single accepting state, no edges',
    m: { states: ['q0'], alphabet: ['a'], transitions: [], start: 'q0', accepting: ['q0'] },
    accept: [''],
    reject: ['a', 'aa'],
  },
  {
    name: '{ε} over the empty alphabet (single-state machine, Σ = ∅)',
    m: { states: ['q0'], alphabet: [], transitions: [], start: 'q0', accepting: ['q0'] },
    accept: [''],
    reject: ['a'],
  },
  {
    name: '{a} — one symbol, exactly',
    m: { states: ['q0', 'q1'], alphabet: ['a'], transitions: [{ from: 'q0', on: 'a', to: 'q1' }], start: 'q0', accepting: ['q1'] },
    accept: ['a'],
    reject: ['', 'aa'],
  },
  {
    name: 'a* — accepting start with a self-loop',
    m: { states: ['q0'], alphabet: ['a'], transitions: [{ from: 'q0', on: 'a', to: 'q0' }], start: 'q0', accepting: ['q0'] },
    accept: ['', 'a', 'aaaa'],
    reject: ['b'],
  },
  {
    name: '(a|b)* — one state, parallel edges',
    m: {
      states: ['q0'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'q0', on: 'a', to: 'q0' },
        { from: 'q0', on: 'b', to: 'q0' },
      ],
      start: 'q0',
      accepting: ['q0'],
    },
    accept: ['', 'abba'],
    reject: ['c'],
  },
  {
    // THE case the fresh-start normalisation exists for: the start state is
    // accepting AND has an arrow back into it. A naive elimination gets this wrong.
    name: '(ab)* — start is accepting and has incoming edges',
    m: {
      states: ['q0', 'q1'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'q0', on: 'a', to: 'q1' },
        { from: 'q1', on: 'b', to: 'q0' },
      ],
      start: 'q0',
      accepting: ['q0'],
    },
    accept: ['', 'ab', 'abab'],
    reject: ['a', 'ba', 'aba'],
  },
  {
    name: 'even number of a\'s (b free)',
    m: {
      states: ['even', 'odd'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'even', on: 'a', to: 'odd' },
        { from: 'odd', on: 'a', to: 'even' },
        { from: 'even', on: 'b', to: 'even' },
        { from: 'odd', on: 'b', to: 'odd' },
      ],
      start: 'even',
      accepting: ['even'],
    },
    accept: ['', 'bb', 'aa', 'abba', 'aab'],
    reject: ['a', 'ba', 'aaa'],
  },
  {
    name: 'ends in ab (NFA, nondeterministic self-loop)',
    m: {
      states: ['q0', 'q1', 'q2'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'q0', on: 'a', to: 'q0' },
        { from: 'q0', on: 'b', to: 'q0' },
        { from: 'q0', on: 'a', to: 'q1' },
        { from: 'q1', on: 'b', to: 'q2' },
      ],
      start: 'q0',
      accepting: ['q2'],
    },
    accept: ['ab', 'bab', 'aaab'],
    reject: ['', 'a', 'ba', 'abb'],
  },
  {
    name: 'contains aba (hub state: exercises the in×out heuristic)',
    m: {
      states: ['s', 'a1', 'ab', 'done'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 's', on: 'a', to: 's' },
        { from: 's', on: 'b', to: 's' },
        { from: 's', on: 'a', to: 'a1' },
        { from: 'a1', on: 'b', to: 'ab' },
        { from: 'ab', on: 'a', to: 'done' },
        { from: 'done', on: 'a', to: 'done' },
        { from: 'done', on: 'b', to: 'done' },
      ],
      start: 's',
      accepting: ['done'],
    },
    accept: ['aba', 'aabab', 'ababa'],
    reject: ['', 'ab', 'bb', 'aab'],
  },
  {
    name: 'ε-cycle (q0 ⇄ q1 by ε-moves)',
    m: {
      states: ['q0', 'q1'],
      alphabet: ['a'],
      transitions: [
        { from: 'q0', on: EPSILON, to: 'q1' },
        { from: 'q1', on: EPSILON, to: 'q0' },
        { from: 'q1', on: 'a', to: 'q1' },
      ],
      start: 'q0',
      accepting: ['q1'],
    },
    accept: ['', 'a', 'aaa'],
    reject: ['b'],
  },
  {
    name: 'ε-chain with a self-loop behind it (ε-moves are not free of consequence)',
    m: {
      states: ['q0', 'q1', 'q2'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'q0', on: EPSILON, to: 'q1' },
        { from: 'q1', on: 'a', to: 'q1' },
        { from: 'q1', on: EPSILON, to: 'q2' },
        { from: 'q2', on: 'b', to: 'q2' },
      ],
      start: 'q0',
      accepting: ['q2'],
    },
    accept: ['', 'a', 'ab', 'aabbb'],
    reject: ['ba', 'aba'],
  },
  {
    name: 'unreachable states (must not appear in the answer or the animation)',
    m: {
      states: ['q0', 'q1', 'ghost', 'ghost2'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'q0', on: 'a', to: 'q1' },
        { from: 'ghost', on: 'b', to: 'ghost2' },
        { from: 'ghost2', on: 'a', to: 'q0' },
        { from: 'ghost', on: 'a', to: 'ghost' },
      ],
      start: 'q0',
      accepting: ['q1', 'ghost'],
    },
    accept: ['a'],
    reject: ['', 'b', 'aa'],
  },
  {
    name: 'multiple accepting states (a|bb)',
    m: {
      states: ['s', 'x', 'b1', 'y'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 's', on: 'a', to: 'x' },
        { from: 's', on: 'b', to: 'b1' },
        { from: 'b1', on: 'b', to: 'y' },
      ],
      start: 's',
      accepting: ['x', 'y'],
    },
    accept: ['a', 'bb'],
    reject: ['', 'b', 'ab', 'bbb'],
  },
  {
    name: 'explicit trap state (a DFA that is already total)',
    m: {
      states: ['q0', 'q1', 'trap'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'q0', on: 'a', to: 'q1' },
        { from: 'q0', on: 'b', to: 'trap' },
        { from: 'q1', on: 'a', to: 'trap' },
        { from: 'q1', on: 'b', to: 'trap' },
        { from: 'trap', on: 'a', to: 'trap' },
        { from: 'trap', on: 'b', to: 'trap' },
      ],
      start: 'q0',
      accepting: ['q1'],
    },
    accept: ['a'],
    reject: ['', 'b', 'aa', 'ab'],
  },
  {
    name: 'binary multiples of 3 (3-state DFA, every state a hub)',
    m: {
      states: ['r0', 'r1', 'r2'],
      alphabet: ['0', '1'],
      transitions: [
        { from: 'r0', on: '0', to: 'r0' },
        { from: 'r0', on: '1', to: 'r1' },
        { from: 'r1', on: '0', to: 'r2' },
        { from: 'r1', on: '1', to: 'r0' },
        { from: 'r2', on: '0', to: 'r1' },
        { from: 'r2', on: '1', to: 'r2' },
      ],
      start: 'r0',
      accepting: ['r0'],
    },
    accept: ['', '0', '11', '110', '1001'],
    reject: ['1', '10', '100'],
  },
  {
    name: 'even 0s and even 1s (4-state product DFA)',
    m: {
      states: ['ee', 'eo', 'oe', 'oo'],
      alphabet: ['0', '1'],
      transitions: [
        { from: 'ee', on: '0', to: 'oe' },
        { from: 'ee', on: '1', to: 'eo' },
        { from: 'oe', on: '0', to: 'ee' },
        { from: 'oe', on: '1', to: 'oo' },
        { from: 'eo', on: '0', to: 'oo' },
        { from: 'eo', on: '1', to: 'ee' },
        { from: 'oo', on: '0', to: 'eo' },
        { from: 'oo', on: '1', to: 'oe' },
      ],
      start: 'ee',
      accepting: ['ee'],
    },
    accept: ['', '0011', '1100', '0101'],
    reject: ['0', '1', '01', '000'],
  },
  {
    name: 'second symbol from the end is a (NFA, exponential on determinisation)',
    m: {
      states: ['q0', 'q1', 'q2'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'q0', on: 'a', to: 'q0' },
        { from: 'q0', on: 'b', to: 'q0' },
        { from: 'q0', on: 'a', to: 'q1' },
        { from: 'q1', on: 'a', to: 'q2' },
        { from: 'q1', on: 'b', to: 'q2' },
      ],
      start: 'q0',
      accepting: ['q2'],
    },
    accept: ['aa', 'ab', 'baa', 'bab'],
    reject: ['', 'a', 'b', 'ba', 'bb'],
  },
  {
    name: 'duplicate transitions and a dead end (both must be harmless)',
    m: {
      states: ['q0', 'q1', 'dead'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'q0', on: 'a', to: 'q1' },
        { from: 'q0', on: 'a', to: 'q1' },
        { from: 'q0', on: 'b', to: 'dead' },
        { from: 'q1', on: 'a', to: 'q1' },
      ],
      start: 'q0',
      accepting: ['q1'],
    },
    accept: ['a', 'aa', 'aaa'],
    reject: ['', 'b', 'ba'],
  },
  {
    name: 'a symbol declared but never used, plus a state named like the fresh ones',
    m: {
      states: ['START', 'ACCEPT'],
      alphabet: ['a', 'b', 'z'],
      transitions: [
        { from: 'START', on: 'a', to: 'ACCEPT' },
        { from: 'ACCEPT', on: 'a', to: 'START' },
      ],
      start: 'START',
      accepting: ['ACCEPT'],
    },
    accept: ['a', 'aaa'],
    reject: ['', 'aa', 'z'],
  },
  {
    name: 'start state with a self-loop and an ε-move out (Thompson-shaped)',
    m: {
      states: ['s', 'm', 'f'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 's', on: 'a', to: 's' },
        { from: 's', on: EPSILON, to: 'm' },
        { from: 'm', on: 'b', to: 'f' },
        { from: 'f', on: EPSILON, to: 'm' },
      ],
      start: 's',
      accepting: ['f'],
    },
    accept: ['b', 'ab', 'abb', 'aabbb'],
    reject: ['', 'a', 'ba'],
  },
];

// ---------------------------------------------------------------------------
// The test that matters
// ---------------------------------------------------------------------------

describe('automatonToRegex — round trip through Thompson', () => {
  it.each(CORPUS)('$name', ({ m, accept, reject }) => {
    // First: the corpus itself is right (a mis-typed machine would make the round
    // trip pass while proving nothing).
    for (const s of accept) expect(accepts(m, s), `original should accept ${JSON.stringify(s)}`).toBe(true);
    for (const s of reject) expect(accepts(m, s), `original should reject ${JSON.stringify(s)}`).toBe(false);

    const r = automatonToRegex(m);
    const m2 = regexToNFA(r);

    expect(equivalent(m, m2), `regex ${renderRegex(r)}`).toEqual({ equal: true });
    expect(agreeOnSamples(m, m2), `regex ${renderRegex(r)} disagrees on`).toEqual([]);
    expect(sameLanguage(m, m2), `regex ${renderRegex(r)} is not the language of the machine`).toBe(true);

    // And the regex is already in simplified form — no caller should have to.
    expect(renderRegex(simplifyRegex(r))).toBe(renderRegex(r));
  });

  it('covers at least twenty machines', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// The two answers that are not a regex-shaped answer
// ---------------------------------------------------------------------------

describe('the empty language and the empty string are different answers', () => {
  it('gives ∅ when nothing is accepted', () => {
    const m = CORPUS[0].m;
    expect(automatonToRegex(m)).toEqual({ kind: 'empty' });
    expect(renderRegex(automatonToRegex(m))).toBe('∅');
  });

  it('gives ∅ when the accepting state cannot be reached', () => {
    expect(automatonToRegex(CORPUS[1].m)).toEqual({ kind: 'empty' });
  });

  it('gives ε — not ∅ — for the language {ε}', () => {
    expect(automatonToRegex(CORPUS[2].m)).toEqual({ kind: 'epsilon' });
  });

  it('gives ε for the single accepting state over an empty alphabet', () => {
    expect(automatonToRegex(CORPUS[3].m)).toEqual({ kind: 'epsilon' });
  });
});

// ---------------------------------------------------------------------------
// The answers a human would write by hand
// ---------------------------------------------------------------------------

describe('small machines come out looking like their textbook regex', () => {
  const rendered = (name: string): string => {
    const found = CORPUS.find((c) => c.name === name);
    if (!found) throw new Error(`no such case: ${name}`);
    return renderRegex(automatonToRegex(found.m));
  };

  it('a* stays a*', () => {
    expect(rendered('a* — accepting start with a self-loop')).toBe('a*');
  });

  it('{a} stays a', () => {
    expect(rendered('{a} — one symbol, exactly')).toBe('a');
  });

  it('(a|b)* is not a monstrosity', () => {
    expect(rendered('(a|b)* — one state, parallel edges')).toBe('(a|b)*');
  });

  it('(ab)* is not a monstrosity either — this is the normalisation working', () => {
    expect(rendered('(ab)* — start is accepting and has incoming edges')).toBe('(ab)*');
  });

  it('a|bb comes out as a union of two alternatives', () => {
    expect(rendered('multiple accepting states (a|bb)')).toBe('a|bb');
  });
});

// ---------------------------------------------------------------------------
// Determinism — the UI diffs on these strings
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('produces the identical regex on repeated runs', () => {
    for (const { m } of CORPUS) {
      expect(renderRegex(automatonToRegex(m))).toBe(renderRegex(automatonToRegex(m)));
    }
  });

  it('does not depend on the order the transitions happen to be listed in', () => {
    const { m } = CORPUS.find((c) => c.name === 'contains aba (hub state: exercises the in×out heuristic)')!;
    const shuffled: Automaton = {
      ...m,
      states: [...m.states].reverse(),
      transitions: [...m.transitions].reverse(),
    };
    expect(renderRegex(automatonToRegex(shuffled))).toBe(renderRegex(automatonToRegex(m)));
  });

  it('produces the identical elimination order on repeated runs', () => {
    for (const { m } of CORPUS) {
      const a = automatonToRegexSteps(m).map((s) => s.removed);
      const b = automatonToRegexSteps(m).map((s) => s.removed);
      expect(a).toEqual(b);
    }
  });
});

// ---------------------------------------------------------------------------
// The animation
// ---------------------------------------------------------------------------

describe('automatonToRegexSteps', () => {
  it('removes every reachable state exactly once, and nothing else', () => {
    for (const { m, name } of CORPUS) {
      const removed = automatonToRegexSteps(m).map((s) => s.removed);
      const expected = [...reachableStates(m)].sort();
      expect([...removed].sort(), name).toEqual(expected);
    }
  });

  it('never mentions an unreachable state', () => {
    const { m } = CORPUS.find((c) => c.name.startsWith('unreachable states'))!;
    const steps = automatonToRegexSteps(m);
    expect(steps.map((s) => s.removed)).toEqual(['q0', 'q1']);
    for (const step of steps) {
      expect(step.before.states).not.toContain('ghost');
      expect(step.explain).not.toContain('ghost');
    }
  });

  it('ends on exactly the regex automatonToRegex returns', () => {
    for (const { m, name } of CORPUS) {
      const steps = automatonToRegexSteps(m);
      const last = steps[steps.length - 1];
      expect(last.regexSoFar, name).toBe(renderRegex(automatonToRegex(m)));
    }
  });

  it('always has at least one step — the start state is always reachable', () => {
    for (const { m, name } of CORPUS) {
      expect(automatonToRegexSteps(m).length, name).toBeGreaterThanOrEqual(1);
    }
  });

  it('follows the min(in × out) heuristic, ties broken by name', () => {
    // s: 1 in (START) × 2 out (s, a1 — the self-loop is excluded) ... but `done`
    // has 1 in × 1 out (ACCEPT) = 1, and `a1`/`ab` have 1×1 = 1 too. So the first
    // victim is the smallest *name* among the cost-1 states: 'a1'.
    const { m } = CORPUS.find((c) => c.name.startsWith('contains aba'))!;
    expect(automatonToRegexSteps(m)[0].removed).toBe('a1');
  });

  it('describes a dead end as a dead end', () => {
    const { m } = CORPUS.find((c) => c.name.startsWith('duplicate transitions'))!;
    const dead = automatonToRegexSteps(m).find((s) => s.removed === 'dead');
    expect(dead?.explain).toContain('dead end');
  });

  it('explains a self-loop as going round the loop', () => {
    const { m } = CORPUS.find((c) => c.name === 'a* — accepting start with a self-loop')!;
    const [only] = automatonToRegexSteps(m);
    expect(only.explain).toContain('Rip out state q0');
    expect(only.explain).toContain('round its own loop');
    expect(only.regexSoFar).toBe('a*');
  });

  it('hands the UI a drawable graph whose start has no way in and whose accept has no way out', () => {
    for (const { m, name } of CORPUS) {
      for (const { before } of automatonToRegexSteps(m)) {
        const [accept] = before.accepting;
        expect(before.accepting.length, name).toBe(1);
        expect(before.states, name).toContain(before.start);
        expect(before.states, name).toContain(accept);
        expect(before.transitions.some((t) => t.to === before.start), name).toBe(false);
        expect(before.transitions.some((t) => t.from === accept), name).toBe(false);
        // At most one arrow per ordered pair: that is the GNFA invariant.
        const pairs = before.transitions.map((t) => `${t.from} ${t.to}`);
        expect(new Set(pairs).size, name).toBe(pairs.length);
      }
    }
  });

  it('shrinks the graph by exactly one state per frame', () => {
    const { m } = CORPUS.find((c) => c.name.startsWith('binary multiples of 3'))!;
    const steps = automatonToRegexSteps(m);
    const sizes = steps.map((s) => s.before.states.length);
    // 3 originals + fresh start + fresh accept, then one fewer each frame.
    expect(sizes).toEqual([5, 4, 3]);
  });

  it('renames the fresh states rather than colliding with the learner\'s', () => {
    const { m } = CORPUS.find((c) => c.name.startsWith('a symbol declared but never used'))!;
    const [first] = automatonToRegexSteps(m);
    expect(first.before.states).toContain('START');
    expect(first.before.states).toContain('ACCEPT');
    // The originals are still there, so the fresh pair must have been renamed.
    expect(first.before.start).toBe("START'");
    expect(first.before.accepting).toEqual(["ACCEPT'"]);
  });

  it('keeps geometry for the states that had it, and invents none', () => {
    const m: Automaton = {
      ...CORPUS[5].m,
      layout: { q0: { x: 10, y: 20 } },
    };
    const [first] = automatonToRegexSteps(m);
    expect(first.before.layout).toEqual({ q0: { x: 10, y: 20 } });
  });
});

// ---------------------------------------------------------------------------
// Fuzz — the corpus can only catch bugs someone already thought of
// ---------------------------------------------------------------------------

/**
 * A seeded generator, so a failure is reproducible and CI can never go red on a
 * Tuesday. (A plain `Math.random` fuzz that fails once and then passes forever is
 * worse than no fuzz at all.)
 */
const lcg = (seed: number): (() => number) => {
  // Numerical Recipes' LCG constants; any full-period pair would do.
  const A = 1664525;
  const C = 1013904223;
  const M = 2 ** 32;
  let s = seed >>> 0;
  return () => {
    s = (A * s + C) % M;
    return s / M;
  };
};

const FUZZ_MACHINES = 150;
const FUZZ_MAX_STATES = 5;
const FUZZ_ALPHABET: Sym[] = ['a', 'b'];
/** ~1 in 4 edges is an ε-move: enough to make ε-cycles and ε-chains common. */
const FUZZ_EPSILON_SHARE = 0.25;

/**
 * Each machine costs three subset constructions, so the fuzz is seconds, not
 * milliseconds — comfortably over vitest's 5s default. Stated explicitly rather
 * than left to luck: a suite that goes red when the CI box is busy is a suite
 * people learn to ignore.
 */
const FUZZ_TIMEOUT_MS = 60_000;

const randomMachine = (rnd: () => number): Automaton => {
  const n = 1 + Math.floor(rnd() * FUZZ_MAX_STATES);
  const states = Array.from({ length: n }, (_, i) => `q${i}`);
  const moves: Array<Sym | typeof EPSILON> = [...FUZZ_ALPHABET, EPSILON];

  const transitions = [];
  for (const from of states) {
    for (const to of states) {
      for (const on of moves) {
        const p = on === EPSILON ? FUZZ_EPSILON_SHARE : 0.3;
        if (rnd() < p) transitions.push({ from, on, to });
      }
    }
  }

  return {
    states,
    alphabet: FUZZ_ALPHABET,
    transitions,
    start: states[0],
    // Any subset of the states, the empty one included — an empty language is a
    // perfectly good machine and the one most likely to break a naive elimination.
    accepting: states.filter(() => rnd() < 0.4),
  };
};

describe('fuzz: the round trip holds for random machines', () => {
  it(`survives ${FUZZ_MACHINES} random ε-NFAs`, { timeout: FUZZ_TIMEOUT_MS }, () => {
    const rnd = lcg(20260712);
    for (let i = 0; i < FUZZ_MACHINES; i++) {
      const m = randomMachine(rnd);
      const r = automatonToRegex(m);
      const m2 = regexToNFA(r);
      const where = `machine #${i} -> ${renderRegex(r)}\n${JSON.stringify(m)}`;
      // `equivalent` reports the shortest string they disagree on — so when this
      // fails it hands the debugger the counterexample, not just a red X.
      expect(equivalent(m, m2), where).toEqual({ equal: true });
      expect(agreeOnSamples(m, m2), where).toEqual([]);
      expect(sameLanguage(m, m2), where).toBe(true);
    }
  });

  it('the animation agrees with the answer on every random machine', { timeout: FUZZ_TIMEOUT_MS }, () => {
    const rnd = lcg(1729);
    for (let i = 0; i < FUZZ_MACHINES; i++) {
      const m = randomMachine(rnd);
      const steps = automatonToRegexSteps(m);
      expect(steps[steps.length - 1].regexSoFar, `machine #${i}`).toBe(
        renderRegex(automatonToRegex(m)),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Robustness: nothing here may throw, whatever the editor hands us
// ---------------------------------------------------------------------------

describe('malformed input degrades, never throws', () => {
  it('ignores a transition naming a state that does not exist', () => {
    const m: Automaton = {
      states: ['q0'],
      alphabet: ['a'],
      transitions: [
        { from: 'q0', on: 'a', to: 'q0' },
        { from: 'q0', on: 'a', to: 'nowhere' },
      ],
      start: 'q0',
      accepting: ['q0'],
    };
    expect(renderRegex(automatonToRegex(m))).toBe('a*');
  });

  it('treats an unlisted start state as a state (Q = states ∪ {start})', () => {
    const m: Automaton = {
      states: [],
      alphabet: ['a'],
      transitions: [{ from: 'q0', on: 'a', to: 'q0' }],
      start: 'q0',
      accepting: ['q0'],
    };
    expect(renderRegex(automatonToRegex(m))).toBe('a*');
  });

  it('ignores an accepting state that is not a state at all', () => {
    const m: Automaton = {
      states: ['q0'],
      alphabet: ['a'],
      transitions: [],
      start: 'q0',
      accepting: ['ghost'],
    };
    expect(automatonToRegex(m)).toEqual({ kind: 'empty' });
  });
});
