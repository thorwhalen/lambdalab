/**
 * Tests for the ε-NFA/DFA simulator.
 *
 * These test the *mathematics*, not the plumbing: ε-cycles, ε-self-loops,
 * unreachable states, the empty alphabet, symbols outside the alphabet, the
 * empty string, an accepting start state, a machine with no accepting states,
 * and the malformed machines a child's half-built drawing will hand us.
 *
 * Where a property should hold for *every* string (e.g. "trace and accepts never
 * disagree"), we check it exhaustively over a small string space rather than on
 * a hand-picked example — the point is to catch the case we didn't think of.
 */

import { describe, expect, it } from 'vitest';
import { EPSILON, type Automaton, type StateId, type Sym } from './types';
import {
  accepts,
  alphabetOf,
  determinismReport,
  epsilonClosure,
  reachableStates,
  step,
  trace,
} from './simulate';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const nfa = (a: Automaton): Automaton => a;

/** Every string over `alphabet` of length <= maxLen, shortest first. */
const allStrings = (alphabet: Sym[], maxLen: number): string[] => {
  let frontier = [''];
  const out = [''];
  for (let n = 0; n < maxLen; n++) {
    frontier = frontier.flatMap((s) => alphabet.map((c) => s + c));
    out.push(...frontier);
  }
  return out;
};

const asSorted = (s: Set<StateId>): StateId[] => [...s].sort();

/** ε-cycle: q0 -ε-> q1 -ε-> q2 -ε-> q0. Only q2 can read 'a', landing in q3 (accept). */
const epsilonCycle = nfa({
  states: ['q0', 'q1', 'q2', 'q3'],
  alphabet: ['a'],
  transitions: [
    { from: 'q0', on: EPSILON, to: 'q1' },
    { from: 'q1', on: EPSILON, to: 'q2' },
    { from: 'q2', on: EPSILON, to: 'q0' },
    { from: 'q2', on: 'a', to: 'q3' },
  ],
  start: 'q0',
  accepting: ['q3'],
});

/** The classic textbook NFA for (a|b)*abb. */
const endsInABB = nfa({
  states: ['s0', 's1', 's2', 's3'],
  alphabet: ['a', 'b'],
  transitions: [
    { from: 's0', on: 'a', to: 's0' },
    { from: 's0', on: 'b', to: 's0' },
    { from: 's0', on: 'a', to: 's1' },
    { from: 's1', on: 'b', to: 's2' },
    { from: 's2', on: 'b', to: 's3' },
  ],
  start: 's0',
  accepting: ['s3'],
});

/** Total DFA: an even number of 0s. Start state is accepting (0 is even). */
const evenZeros = nfa({
  states: ['even', 'odd'],
  alphabet: ['0', '1'],
  transitions: [
    { from: 'even', on: '0', to: 'odd' },
    { from: 'even', on: '1', to: 'even' },
    { from: 'odd', on: '0', to: 'even' },
    { from: 'odd', on: '1', to: 'odd' },
  ],
  start: 'even',
  accepting: ['even'],
});

// ---------------------------------------------------------------------------
// epsilonClosure
// ---------------------------------------------------------------------------

describe('epsilonClosure', () => {
  it('is reflexive: a state with no ε-moves closes to itself', () => {
    expect(asSorted(epsilonClosure(evenZeros, ['even']))).toEqual(['even']);
  });

  it('is transitive, not just one hop', () => {
    const chain = nfa({
      states: ['a', 'b', 'c', 'd'],
      alphabet: ['x'],
      transitions: [
        { from: 'a', on: EPSILON, to: 'b' },
        { from: 'b', on: EPSILON, to: 'c' },
        { from: 'c', on: EPSILON, to: 'd' },
      ],
      start: 'a',
      accepting: ['d'],
    });
    expect(asSorted(epsilonClosure(chain, ['a']))).toEqual(['a', 'b', 'c', 'd']);
    // ...and it does not run backwards.
    expect(asSorted(epsilonClosure(chain, ['c']))).toEqual(['c', 'd']);
  });

  it('terminates on an ε-cycle and returns the whole cycle', () => {
    expect(asSorted(epsilonClosure(epsilonCycle, ['q0']))).toEqual(['q0', 'q1', 'q2']);
    // Entering the cycle anywhere gives the same set: a cycle has one closure.
    expect(asSorted(epsilonClosure(epsilonCycle, ['q2']))).toEqual(['q0', 'q1', 'q2']);
  });

  it('terminates on an ε-self-loop', () => {
    const selfLoop = nfa({
      states: ['q'],
      alphabet: [],
      transitions: [{ from: 'q', on: EPSILON, to: 'q' }],
      start: 'q',
      accepting: ['q'],
    });
    expect(asSorted(epsilonClosure(selfLoop, ['q']))).toEqual(['q']);
  });

  it('closes a set of seeds, not just one state', () => {
    expect(asSorted(epsilonClosure(epsilonCycle, ['q1', 'q3']))).toEqual([
      'q0',
      'q1',
      'q2',
      'q3',
    ]);
  });

  it('is the empty set for no seeds', () => {
    expect(epsilonClosure(epsilonCycle, []).size).toBe(0);
  });

  it('ignores seeds that are not states of the machine', () => {
    expect(asSorted(epsilonClosure(evenZeros, ['nope']))).toEqual([]);
  });

  it('does not follow ordinary symbol transitions', () => {
    expect(asSorted(epsilonClosure(endsInABB, ['s0']))).toEqual(['s0']);
  });

  it('iterates in sorted order, so derived state names are stable', () => {
    // Targets deliberately listed in reverse order; iteration must not leak that.
    const scrambled = nfa({
      states: ['a', 'b', 'c'],
      alphabet: [],
      transitions: [
        { from: 'a', on: EPSILON, to: 'c' },
        { from: 'a', on: EPSILON, to: 'b' },
      ],
      start: 'a',
      accepting: [],
    });
    expect([...epsilonClosure(scrambled, ['a'])]).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// step
// ---------------------------------------------------------------------------

describe('step', () => {
  it('applies the ε-closure to the result', () => {
    const m = nfa({
      states: ['p', 'q', 'r'],
      alphabet: ['a'],
      transitions: [
        { from: 'p', on: 'a', to: 'q' },
        { from: 'q', on: EPSILON, to: 'r' },
      ],
      start: 'p',
      accepting: ['r'],
    });
    expect(asSorted(step(m, ['p'], 'a'))).toEqual(['q', 'r']);
  });

  it('closes the incoming set too, so a raw (unclosed) set still steps correctly', () => {
    // q0 cannot read 'a' itself; only q2, reachable from q0 by ε, can.
    expect(asSorted(step(epsilonCycle, ['q0'], 'a'))).toEqual(['q3']);
  });

  it('takes the union over all states in the set', () => {
    expect(asSorted(step(endsInABB, ['s0', 's1'], 'b'))).toEqual(['s0', 's2']);
  });

  it('yields the empty set for a symbol outside the alphabet', () => {
    expect(step(evenZeros, ['even'], 'z').size).toBe(0);
  });

  it('yields the empty set for EPSILON: ε is a free move, never a consumed symbol', () => {
    // Were this to follow ε-edges, an input containing the character 'ε' would
    // silently ride the machine's free moves.
    expect(step(epsilonCycle, ['q0'], EPSILON).size).toBe(0);
  });

  it('yields the empty set from the empty set', () => {
    expect(step(endsInABB, [], 'a').size).toBe(0);
  });

  it('iterates in sorted order', () => {
    expect([...step(endsInABB, ['s0'], 'a')]).toEqual(['s0', 's1']);
  });
});

// ---------------------------------------------------------------------------
// accepts
// ---------------------------------------------------------------------------

describe('accepts', () => {
  it('accepts the empty string when the start state is accepting', () => {
    expect(accepts(evenZeros, '')).toBe(true);
  });

  it('rejects the empty string when the start state is not accepting', () => {
    expect(accepts(endsInABB, '')).toBe(false);
  });

  it('accepts the empty string when an ε-move reaches an accepting state', () => {
    const m = nfa({
      states: ['p', 'q'],
      alphabet: ['a'],
      transitions: [{ from: 'p', on: EPSILON, to: 'q' }],
      start: 'p',
      accepting: ['q'],
    });
    expect(accepts(m, '')).toBe(true);
  });

  it('decides the textbook NFA (a|b)*abb correctly', () => {
    for (const s of allStrings(['a', 'b'], 6)) {
      expect(accepts(endsInABB, s)).toBe(s.endsWith('abb'));
    }
  });

  it('decides the even-zeros DFA correctly', () => {
    for (const s of allStrings(['0', '1'], 6)) {
      const zeros = [...s].filter((c) => c === '0').length;
      expect(accepts(evenZeros, s)).toBe(zeros % 2 === 0);
    }
  });

  it('crosses an ε-cycle to accept', () => {
    expect(accepts(epsilonCycle, 'a')).toBe(true);
    expect(accepts(epsilonCycle, '')).toBe(false);
    expect(accepts(epsilonCycle, 'aa')).toBe(false); // q3 has no outgoing edge
  });

  it('rejects (does not throw) on a symbol outside the alphabet', () => {
    expect(() => accepts(evenZeros, '01x01')).not.toThrow();
    expect(accepts(evenZeros, '01x01')).toBe(false);
    // Even when the prefix and suffix are individually fine.
    expect(accepts(evenZeros, 'x')).toBe(false);
  });

  it('never lets a literal "ε" in the input ride the machine\'s ε-moves', () => {
    // epsilonCycle accepts 'a'. The string 'ε' must be rejected outright, and
    // 'εa' too: ε is not a symbol, so the string is not over the alphabet.
    expect(accepts(epsilonCycle, EPSILON)).toBe(false);
    expect(accepts(epsilonCycle, EPSILON + 'a')).toBe(false);
  });

  it('rejects everything when there are no accepting states', () => {
    const noAccept = nfa({ ...endsInABB, accepting: [] });
    for (const s of allStrings(['a', 'b'], 4)) expect(accepts(noAccept, s)).toBe(false);
  });

  it('handles the empty alphabet: only the empty string can be accepted', () => {
    const lonely = nfa({
      states: ['q'],
      alphabet: [],
      transitions: [],
      start: 'q',
      accepting: ['q'],
    });
    expect(accepts(lonely, '')).toBe(true);
    expect(accepts(lonely, 'a')).toBe(false);
  });

  it('handles a single-state machine with a self-loop (Σ*)', () => {
    const sigmaStar = nfa({
      states: ['q'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'q', on: 'a', to: 'q' },
        { from: 'q', on: 'b', to: 'q' },
      ],
      start: 'q',
      accepting: ['q'],
    });
    for (const s of allStrings(['a', 'b'], 5)) expect(accepts(sigmaStar, s)).toBe(true);
  });

  it('accepts nothing at all when the machine is empty of accepting states and edges', () => {
    const dead = nfa({
      states: ['q'],
      alphabet: ['a'],
      transitions: [],
      start: 'q',
      accepting: [],
    });
    expect(accepts(dead, '')).toBe(false);
    expect(accepts(dead, 'a')).toBe(false);
  });

  it('is unaffected by duplicate transitions', () => {
    const dup = nfa({
      ...evenZeros,
      transitions: [...evenZeros.transitions, ...evenZeros.transitions],
    });
    for (const s of allStrings(['0', '1'], 5)) {
      expect(accepts(dup, s)).toBe(accepts(evenZeros, s));
    }
  });

  it('ignores an edge pointing at a state that does not exist', () => {
    // δ ⊆ Q × (Σ ∪ {ε}) × Q — a phantom target is not a transition.
    const phantom = nfa({
      states: ['q'],
      alphabet: ['a'],
      transitions: [{ from: 'q', on: 'a', to: 'ghost' }],
      start: 'q',
      accepting: ['q'],
    });
    expect(accepts(phantom, '')).toBe(true);
    expect(accepts(phantom, 'a')).toBe(false);
  });

  it('treats an unlisted start state as a state anyway', () => {
    const forgot = nfa({
      states: [],
      alphabet: ['a'],
      transitions: [],
      start: 'q0',
      accepting: ['q0'],
    });
    expect(accepts(forgot, '')).toBe(true);
    expect(accepts(forgot, 'a')).toBe(false);
  });

  it('is not fooled by an accepting state that is unreachable', () => {
    const unreachableAccept = nfa({
      states: ['q0', 'island'],
      alphabet: ['a'],
      transitions: [{ from: 'island', on: 'a', to: 'island' }],
      start: 'q0',
      accepting: ['island'],
    });
    for (const s of allStrings(['a'], 4)) expect(accepts(unreachableAccept, s)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// trace
// ---------------------------------------------------------------------------

describe('trace', () => {
  it('starts at pos 0 with the ε-closure of {start} and no consumed symbol', () => {
    const t = trace(epsilonCycle, 'a');
    expect(t.steps[0].pos).toBe(0);
    expect(t.steps[0].states).toEqual(['q0', 'q1', 'q2']);
    expect(t.steps[0].consumed).toBeUndefined();
    expect('consumed' in t.steps[0]).toBe(false);
  });

  it('produces one step per symbol, each recording what it consumed', () => {
    const t = trace(evenZeros, '010');
    expect(t.steps.map((s) => s.pos)).toEqual([0, 1, 2, 3]);
    expect(t.steps.map((s) => s.consumed)).toEqual([undefined, '0', '1', '0']);
    expect(t.steps.map((s) => s.states)).toEqual([['even'], ['odd'], ['odd'], ['even']]);
    expect(t.accepted).toBe(true);
    expect(t.stuckAt).toBeUndefined();
  });

  it('has exactly one step for the empty string', () => {
    const t = trace(evenZeros, '');
    expect(t.steps).toHaveLength(1);
    expect(t.steps[0]).toEqual({ pos: 0, states: ['even'] });
    expect(t.accepted).toBe(true);
    expect(t.input).toBe('');
  });

  it('tracks a set of states through the NFA', () => {
    const t = trace(endsInABB, 'aab');
    expect(t.steps.map((s) => s.states)).toEqual([
      ['s0'],
      ['s0', 's1'],
      ['s0', 's1'],
      ['s0', 's2'],
    ]);
    expect(t.accepted).toBe(false);
  });

  it('stops at the symbol it cannot read and records stuckAt', () => {
    const t = trace(evenZeros, '0x1');
    // Consumed '0' fine; 'x' (index 1) kills it, so nothing survives at pos 2... but
    // stuckAt is the first pos with no states, which is index-of-killer + 1 = 2.
    expect(t.steps.map((s) => s.pos)).toEqual([0, 1]);
    expect(t.stuckAt).toBe(2);
    expect(t.accepted).toBe(false);
    // The offending symbol is the one just before the stuck position.
    expect(t.input[t.stuckAt! - 1]).toBe('x');
  });

  it('can get stuck on the very first symbol (stuckAt is never 0)', () => {
    const t = trace(evenZeros, 'zzz');
    expect(t.steps).toHaveLength(1);
    expect(t.steps[0].pos).toBe(0);
    expect(t.stuckAt).toBe(1);
  });

  it('gets stuck when the machine runs out of edges, not just out of alphabet', () => {
    // epsilonCycle: q3 is a sink with no outgoing edges.
    const t = trace(epsilonCycle, 'aa');
    expect(t.steps.map((s) => s.states)).toEqual([['q0', 'q1', 'q2'], ['q3']]);
    expect(t.stuckAt).toBe(2);
    expect(t.accepted).toBe(false);
  });

  it('never emits an empty state set', () => {
    for (const s of allStrings(['a', 'b', 'z'], 4)) {
      for (const traceStep of trace(endsInABB, s).steps) {
        expect(traceStep.states.length).toBeGreaterThan(0);
      }
    }
  });

  it('omits stuckAt entirely when the run completes', () => {
    expect('stuckAt' in trace(evenZeros, '0101')).toBe(false);
  });

  it('sets stuckAt === steps.length whenever the run dies', () => {
    for (const s of allStrings(['a', 'b', 'z'], 4)) {
      const t = trace(endsInABB, s);
      if (t.stuckAt !== undefined) expect(t.stuckAt).toBe(t.steps.length);
    }
  });

  it('agrees with accepts on every string, always', () => {
    for (const m of [endsInABB, evenZeros, epsilonCycle]) {
      for (const s of allStrings(['a', 'b', '0', '1'], 4)) {
        expect(trace(m, s).accepted).toBe(accepts(m, s));
      }
    }
  });

  it('keeps pos an index into the input string, so the last pos is input.length', () => {
    for (const s of allStrings(['a', 'b'], 5)) {
      const t = trace(endsInABB, s);
      const last = t.steps[t.steps.length - 1];
      if (t.stuckAt === undefined) expect(last.pos).toBe(s.length);
      t.steps.forEach((stp, i) => {
        expect(stp.pos).toBe(i);
        if (i > 0) expect(stp.consumed).toBe(s[i - 1]);
      });
    }
  });

  it('echoes the input back verbatim', () => {
    expect(trace(endsInABB, 'abba').input).toBe('abba');
  });
});

// ---------------------------------------------------------------------------
// determinismReport
// ---------------------------------------------------------------------------

describe('determinismReport', () => {
  it('calls a total DFA deterministic and total', () => {
    expect(determinismReport(evenZeros)).toEqual({
      isDeterministic: true,
      isTotal: true,
      hasEpsilon: false,
      nondeterministic: [],
      missing: [],
    });
  });

  it('flags a (state, symbol) with more than one target', () => {
    const r = determinismReport(endsInABB);
    expect(r.isDeterministic).toBe(false);
    expect(r.nondeterministic).toEqual([{ state: 's0', on: 'a', targets: ['s0', 's1'] }]);
  });

  it('flags missing transitions without calling the machine nondeterministic', () => {
    // A partial DFA: deterministic, but not total.
    const partial = nfa({
      states: ['p', 'q'],
      alphabet: ['a', 'b'],
      transitions: [{ from: 'p', on: 'a', to: 'q' }],
      start: 'p',
      accepting: ['q'],
    });
    const r = determinismReport(partial);
    expect(r.isDeterministic).toBe(true);
    expect(r.isTotal).toBe(false);
    expect(r.missing).toEqual([
      { state: 'p', on: 'b' },
      { state: 'q', on: 'a' },
      { state: 'q', on: 'b' },
    ]);
  });

  it('treats duplicate transitions as one: same target twice is not a choice', () => {
    const dup = nfa({
      states: ['p', 'q'],
      alphabet: ['a'],
      transitions: [
        { from: 'p', on: 'a', to: 'q' },
        { from: 'p', on: 'a', to: 'q' },
        { from: 'q', on: 'a', to: 'q' },
      ],
      start: 'p',
      accepting: ['q'],
    });
    const r = determinismReport(dup);
    expect(r.nondeterministic).toEqual([]);
    expect(r.isDeterministic).toBe(true);
    expect(r.isTotal).toBe(true);
  });

  it('reports hasEpsilon for any ε-edge, even a harmless self-loop', () => {
    const harmless = nfa({
      ...evenZeros,
      transitions: [...evenZeros.transitions, { from: 'even', on: EPSILON, to: 'even' }],
    });
    const r = determinismReport(harmless);
    expect(r.hasEpsilon).toBe(true);
    // An ε-edge alone disqualifies a DFA, by definition — even this no-op one.
    expect(r.isDeterministic).toBe(false);
    expect(r.isTotal).toBe(true);
    expect(r.nondeterministic).toEqual([]);
  });

  it('does not count ε as a symbol needing a transition', () => {
    const withEps = nfa({
      states: ['p', 'q'],
      alphabet: ['a'],
      transitions: [
        { from: 'p', on: EPSILON, to: 'q' },
        { from: 'p', on: 'a', to: 'p' },
        { from: 'q', on: 'a', to: 'q' },
      ],
      start: 'p',
      accepting: ['q'],
    });
    const r = determinismReport(withEps);
    expect(r.missing).toEqual([]); // no `{state, on: 'ε'}` entries
    expect(r.isTotal).toBe(true);
    expect(r.hasEpsilon).toBe(true);
  });

  it('is vacuously total and deterministic over the empty alphabet', () => {
    const lonely = nfa({
      states: ['q'],
      alphabet: [],
      transitions: [],
      start: 'q',
      accepting: ['q'],
    });
    expect(determinismReport(lonely)).toEqual({
      isDeterministic: true,
      isTotal: true,
      hasEpsilon: false,
      nondeterministic: [],
      missing: [],
    });
  });

  it('reports over Q and Σ in sorted order, stably', () => {
    const jumbled = nfa({
      states: ['z', 'a', 'm'],
      alphabet: ['1', '0'],
      transitions: [],
      start: 'm',
      accepting: [],
    });
    expect(determinismReport(jumbled).missing).toEqual([
      { state: 'a', on: '0' },
      { state: 'a', on: '1' },
      { state: 'm', on: '0' },
      { state: 'm', on: '1' },
      { state: 'z', on: '0' },
      { state: 'z', on: '1' },
    ]);
  });

  it('sorts the targets of a nondeterministic choice', () => {
    const m = nfa({
      states: ['p', 'x', 'b', 'a'],
      alphabet: ['c'],
      transitions: [
        { from: 'p', on: 'c', to: 'x' },
        { from: 'p', on: 'c', to: 'a' },
        { from: 'p', on: 'c', to: 'b' },
      ],
      start: 'p',
      accepting: [],
    });
    expect(determinismReport(m).nondeterministic[0].targets).toEqual(['a', 'b', 'x']);
  });

  it('sees an edge on an undeclared symbol rather than hiding it', () => {
    const stray = nfa({
      states: ['p'],
      alphabet: ['a'],
      transitions: [
        { from: 'p', on: 'a', to: 'p' },
        { from: 'p', on: 'q', to: 'p' }, // 'q' was never declared
      ],
      start: 'p',
      accepting: ['p'],
    });
    const r = determinismReport(stray);
    expect(alphabetOf(stray)).toEqual(['a', 'q']);
    expect(r.isTotal).toBe(true);
    expect(r.isDeterministic).toBe(true);
  });

  it('flags a (state, symbol) whose only edge pointed at a phantom state', () => {
    const phantom = nfa({
      states: ['p'],
      alphabet: ['a'],
      transitions: [{ from: 'p', on: 'a', to: 'ghost' }],
      start: 'p',
      accepting: ['p'],
    });
    expect(determinismReport(phantom).missing).toEqual([{ state: 'p', on: 'a' }]);
  });
});

// ---------------------------------------------------------------------------
// reachableStates
// ---------------------------------------------------------------------------

describe('reachableStates', () => {
  it('always contains the start state, even with no transitions at all', () => {
    const lonely = nfa({
      states: ['q', 'other'],
      alphabet: [],
      transitions: [],
      start: 'q',
      accepting: [],
    });
    expect(asSorted(reachableStates(lonely))).toEqual(['q']);
  });

  it('excludes an unreachable island, however busy it is', () => {
    const withIsland = nfa({
      states: ['even', 'odd', 'island', 'islet'],
      alphabet: ['0', '1'],
      transitions: [
        ...evenZeros.transitions,
        { from: 'island', on: '0', to: 'islet' },
        { from: 'islet', on: '1', to: 'even' }, // an edge *into* the machine does not save it
      ],
      start: 'even',
      accepting: ['even'],
    });
    expect(asSorted(reachableStates(withIsland))).toEqual(['even', 'odd']);
  });

  it('follows ε-edges: reachability does not care about the label', () => {
    expect(asSorted(reachableStates(epsilonCycle))).toEqual(['q0', 'q1', 'q2', 'q3']);
  });

  it('terminates on cycles', () => {
    expect(asSorted(reachableStates(endsInABB))).toEqual(['s0', 's1', 's2', 's3']);
  });

  it('ignores edges to phantom states', () => {
    const phantom = nfa({
      states: ['p'],
      alphabet: ['a'],
      transitions: [{ from: 'p', on: 'a', to: 'ghost' }],
      start: 'p',
      accepting: [],
    });
    expect(asSorted(reachableStates(phantom))).toEqual(['p']);
  });

  it('iterates in sorted order', () => {
    const m = nfa({
      states: ['m', 'z', 'a'],
      alphabet: ['x'],
      transitions: [
        { from: 'm', on: 'x', to: 'z' },
        { from: 'z', on: 'x', to: 'a' },
      ],
      start: 'm',
      accepting: [],
    });
    expect([...reachableStates(m)]).toEqual(['a', 'm', 'z']);
  });
});

// ---------------------------------------------------------------------------
// alphabetOf
// ---------------------------------------------------------------------------

describe('alphabetOf', () => {
  it('is sorted and unique', () => {
    const m = nfa({
      states: ['q'],
      alphabet: ['b', 'a', 'b'],
      transitions: [],
      start: 'q',
      accepting: [],
    });
    expect(alphabetOf(m)).toEqual(['a', 'b']);
  });

  it('excludes EPSILON, whether declared or merely used', () => {
    const m = nfa({
      states: ['p', 'q'],
      alphabet: ['a', EPSILON], // a malformed declaration; ε is in no alphabet
      transitions: [{ from: 'p', on: EPSILON, to: 'q' }],
      start: 'p',
      accepting: ['q'],
    });
    expect(alphabetOf(m)).toEqual(['a']);
  });

  it('includes a symbol used by a transition but never declared', () => {
    const m = nfa({
      states: ['p'],
      alphabet: ['a'],
      transitions: [{ from: 'p', on: 'z', to: 'p' }],
      start: 'p',
      accepting: [],
    });
    expect(alphabetOf(m)).toEqual(['a', 'z']);
  });

  it('is empty for a machine with no symbols', () => {
    const lonely = nfa({
      states: ['q'],
      alphabet: [],
      transitions: [],
      start: 'q',
      accepting: ['q'],
    });
    expect(alphabetOf(lonely)).toEqual([]);
  });

  it('sorts by code unit, not by locale', () => {
    // A locale-aware collator would order these case-insensitively ('a' < 'B');
    // code-unit order puts all uppercase first. We need the machine-independent one.
    const m = nfa({
      states: ['q'],
      alphabet: ['a', 'B', 'A', 'b'],
      transitions: [],
      start: 'q',
      accepting: [],
    });
    expect(alphabetOf(m)).toEqual(['A', 'B', 'a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// Purity & determinism of the whole module
// ---------------------------------------------------------------------------

describe('purity', () => {
  it('does not mutate the automaton it is given', () => {
    const before = JSON.stringify(endsInABB);
    accepts(endsInABB, 'aabb');
    trace(endsInABB, 'abb');
    determinismReport(endsInABB);
    reachableStates(endsInABB);
    alphabetOf(endsInABB);
    epsilonClosure(endsInABB, ['s0']);
    step(endsInABB, ['s0'], 'a');
    expect(JSON.stringify(endsInABB)).toBe(before);
  });

  it('produces byte-identical output on repeated runs', () => {
    // Transitions listed in a deliberately awkward order: nothing observable may
    // depend on it, or the UI's diff of generated state names will flicker.
    const scrambled = nfa({
      ...endsInABB,
      states: ['s3', 's0', 's2', 's1'],
      transitions: [...endsInABB.transitions].reverse(),
    });
    const once = JSON.stringify({
      t: trace(scrambled, 'aabb'),
      d: determinismReport(scrambled),
      r: [...reachableStates(scrambled)],
      a: alphabetOf(scrambled),
      c: [...epsilonClosure(scrambled, ['s0', 's1'])],
    });
    const twice = JSON.stringify({
      t: trace(endsInABB, 'aabb'),
      d: determinismReport(endsInABB),
      r: [...reachableStates(endsInABB)],
      a: alphabetOf(endsInABB),
      c: [...epsilonClosure(endsInABB, ['s1', 's0'])],
    });
    expect(once).toBe(twice);
  });
});
