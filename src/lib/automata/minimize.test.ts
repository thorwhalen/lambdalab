/**
 * Tests for DFA minimisation.
 *
 * The load-bearing property is not "the output is small" but "the output has the same
 * language, and is as small as the maths allows". So the workhorse assertion here is
 * exhaustive: for every string up to length 6 over Σ, the original and the minimised
 * machine must agree — and when they don't, the failure names the offending string.
 *
 * Every trap the pipeline is built to avoid gets a machine of its own, hand-checked:
 * refine-before-pruning, refine-before-completing, the trap that must be dropped, the
 * trap that must NOT be dropped, and the naming that must not depend on iteration order.
 */

import { describe, expect, it } from 'vitest';
import { accepts, alphabetOf } from './simulate';
import { minimalStateCount, minimize, removeUnreachable } from './minimize';
import type { Automaton, Sym, Transition } from './types';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** Long enough to separate every state of every machine here (all have < 6 states). */
const EXHAUSTIVE_LEN = 6;

const AB: Sym[] = ['a', 'b'];

/** Terse edge notation: 'q0 -a-> q1'. */
const edges = (spec: string): Transition[] =>
  spec
    .trim()
    .split('\n')
    .map((line) => {
      const m = line.trim().match(/^(\S+)\s+-(\S+)->\s+(\S+)$/);
      if (!m) throw new Error(`bad edge spec: ${line}`);
      return { from: m[1], on: m[2], to: m[3] };
    });

/** Every string over `alphabet` of length <= maxLen, shortest first, including ''. */
const allStrings = (alphabet: readonly Sym[], maxLen: number): string[] => {
  const syms = [...alphabet].sort();
  const out: string[] = [''];
  let frontier: string[] = [''];
  for (let n = 1; n <= maxLen; n++) {
    const next: string[] = [];
    for (const s of frontier) for (const c of syms) next.push(s + c);
    out.push(...next);
    frontier = next;
  }
  return out;
};

/**
 * The shortest string the two machines disagree on, or null. Returned rather than
 * asserted so a failure reads "expected null, got 'aab'" — the counterexample itself.
 */
const disagreement = (
  a: Automaton,
  b: Automaton,
  alphabet: readonly Sym[],
  maxLen = EXHAUSTIVE_LEN,
): string | null => {
  for (const s of allStrings(alphabet, maxLen)) {
    if (accepts(a, s) !== accepts(b, s)) return s;
  }
  return null;
};

/** The strings up to length `maxLen` a machine accepts — the language, concretely. */
const languageOf = (a: Automaton, alphabet: readonly Sym[], maxLen = EXHAUSTIVE_LEN): string[] =>
  allStrings(alphabet, maxLen).filter((s) => accepts(a, s));

// ---------------------------------------------------------------------------
// The machines, each hand-checked
// ---------------------------------------------------------------------------

/** L = Σ* a b Σ* — "contains ab". Already minimal, and needs NO trap: 3 states. */
const containsAB: Automaton = {
  states: ['q0', 'q1', 'q2'],
  alphabet: AB,
  transitions: edges(`
    q0 -a-> q1
    q0 -b-> q0
    q1 -a-> q1
    q1 -b-> q2
    q2 -a-> q2
    q2 -b-> q2
  `),
  start: 'q0',
  accepting: ['q2'],
};

/** L = {ab}. A *partial* DFA: the failing moves are simply absent. Needs a trap: 4. */
const exactlyAB: Automaton = {
  states: ['s0', 's1', 's2'],
  alphabet: AB,
  transitions: edges(`
    s0 -a-> s1
    s1 -b-> s2
  `),
  start: 's0',
  accepting: ['s2'],
};

/**
 * L = {aa, ba}. q1 and q2 are equivalent — but only once the machine is COMPLETED:
 * q1 has no b-move at all while q2 goes to the dead state d on b, and "missing" and
 * "dead" are the same behaviour. Refine without completing and they stay apart.
 */
const missingVsDead: Automaton = {
  states: ['q0', 'q1', 'q2', 'qf', 'd'],
  alphabet: AB,
  transitions: edges(`
    q0 -a-> q1
    q0 -b-> q2
    q1 -a-> qf
    q2 -a-> qf
    q2 -b-> d
    qf -a-> d
    qf -b-> d
    d -a-> d
    d -b-> d
  `),
  start: 'q0',
  accepting: ['qf'],
};

/**
 * L = Σ*. The unreachable state `u` is equivalent to nothing (it is non-accepting) and
 * is not a trap (its a-move escapes), so refining before pruning leaves it in the
 * output as a second state — and no later step would remove it.
 */
const unreachableSurvivor: Automaton = {
  states: ['q0', 'u'],
  alphabet: AB,
  transitions: edges(`
    q0 -a-> q0
    q0 -b-> q0
    u -a-> q0
    u -b-> u
  `),
  start: 'q0',
  accepting: ['q0'],
};

/** L = ∅. The minimal machine IS a lone trap; there is nothing to drop. */
const emptyLanguage: Automaton = {
  states: ['q0'],
  alphabet: AB,
  transitions: [],
  start: 'q0',
  accepting: [],
};

/** L = Σ*. One accepting state. */
const allStringsMachine: Automaton = {
  states: ['q0'],
  alphabet: AB,
  transitions: edges(`
    q0 -a-> q0
    q0 -b-> q0
  `),
  start: 'q0',
  accepting: ['q0'],
};

/** L = {ε} over Σ = {a}. Two classes (ε, and everything else), one of them dead. */
const justEpsilon: Automaton = {
  states: ['q0'],
  alphabet: ['a'],
  transitions: [],
  start: 'q0',
  accepting: ['q0'],
};

/** L = Σ* a b — "ends with ab". Nondeterministic on 'a' from n0. */
const endsWithAB_NFA: Automaton = {
  states: ['n0', 'n1', 'n2'],
  alphabet: AB,
  transitions: edges(`
    n0 -a-> n0
    n0 -b-> n0
    n0 -a-> n1
    n1 -b-> n2
  `),
  start: 'n0',
  accepting: ['n2'],
};

/** The same language via an ε-move — determinisation must handle the free move. */
const endsWithAB_epsilonNFA: Automaton = {
  states: ['e0', 'e1', 'e2', 'e3'],
  alphabet: AB,
  transitions: edges(`
    e0 -a-> e0
    e0 -b-> e0
    e0 -ε-> e1
    e1 -a-> e2
    e2 -b-> e3
  `),
  start: 'e0',
  accepting: ['e3'],
};

/**
 * The same language again, as a redundant 5-state DFA: p3 duplicates p0 and p4
 * duplicates p1. Minimising must merge them — and name the merges "p0|p3", "p1|p4".
 */
const endsWithAB_redundantDFA: Automaton = {
  states: ['p0', 'p1', 'p2', 'p3', 'p4'],
  alphabet: AB,
  transitions: edges(`
    p0 -a-> p1
    p0 -b-> p3
    p1 -a-> p4
    p1 -b-> p2
    p2 -a-> p1
    p2 -b-> p0
    p3 -a-> p1
    p3 -b-> p0
    p4 -a-> p1
    p4 -b-> p2
  `),
  start: 'p0',
  accepting: ['p2'],
};

/** Every machine above, for the properties that must hold of all of them. */
const ALL: Array<{ name: string; m: Automaton }> = [
  { name: 'containsAB', m: containsAB },
  { name: 'exactlyAB', m: exactlyAB },
  { name: 'missingVsDead', m: missingVsDead },
  { name: 'unreachableSurvivor', m: unreachableSurvivor },
  { name: 'emptyLanguage', m: emptyLanguage },
  { name: 'allStringsMachine', m: allStringsMachine },
  { name: 'justEpsilon', m: justEpsilon },
  { name: 'endsWithAB_NFA', m: endsWithAB_NFA },
  { name: 'endsWithAB_epsilonNFA', m: endsWithAB_epsilonNFA },
  { name: 'endsWithAB_redundantDFA', m: endsWithAB_redundantDFA },
];

// ---------------------------------------------------------------------------
// removeUnreachable
// ---------------------------------------------------------------------------

describe('removeUnreachable', () => {
  it('keeps a single-state machine whole', () => {
    const r = removeUnreachable(allStringsMachine);
    expect(r.states).toEqual(['q0']);
    expect(r.start).toBe('q0');
    expect(r.accepting).toEqual(['q0']);
  });

  it('drops an unreachable state and every edge touching it', () => {
    const r = removeUnreachable(unreachableSurvivor);
    expect(r.states).toEqual(['q0']);
    expect(r.transitions.map((t) => t.from)).not.toContain('u');
    expect(r.transitions.map((t) => t.to)).not.toContain('u');
  });

  it('keeps a state reachable only through an ε-move', () => {
    const r = removeUnreachable(endsWithAB_epsilonNFA);
    expect(r.states).toEqual(['e0', 'e1', 'e2', 'e3']);
  });

  it('drops a state unreachable from the start even when it can reach the start', () => {
    // Reachability is FROM the start, not TO it. `u` points into the machine but nothing
    // points at `u` — a common way to get this backwards.
    const r = removeUnreachable({
      states: ['q0', 'u'],
      alphabet: AB,
      transitions: edges(`
        q0 -a-> q0
        u -a-> q0
      `),
      start: 'q0',
      accepting: ['q0'],
    });
    expect(r.states).toEqual(['q0']);
  });

  it('drops dangling transitions (edges naming a state outside Q)', () => {
    const r = removeUnreachable({
      states: ['q0'],
      alphabet: ['a'],
      transitions: edges(`
        q0 -a-> q0
        q0 -a-> ghost
      `),
      start: 'q0',
      accepting: [],
    });
    expect(r.transitions).toEqual([{ from: 'q0', on: 'a', to: 'q0' }]);
  });

  it('preserves Σ even when the surviving states never use a symbol', () => {
    // Σ belongs to the language, not to the states that happened to survive: narrowing
    // it here would silently change what `complement` means downstream.
    const r = removeUnreachable({
      states: ['q0', 'u'],
      alphabet: ['a', 'b', 'c'],
      transitions: edges(`
        q0 -a-> q0
        u -b-> u
      `),
      start: 'q0',
      accepting: ['q0'],
    });
    expect(r.states).toEqual(['q0']);
    expect(r.alphabet).toEqual(['a', 'b', 'c']);
  });

  it('repairs a machine whose start state is not listed in `states`', () => {
    const r = removeUnreachable({
      states: [],
      alphabet: ['a'],
      transitions: [],
      start: 'q0',
      accepting: ['q0'],
    });
    expect(r.states).toEqual(['q0']);
  });

  it('keeps the layout of survivors and forgets the rest', () => {
    const r = removeUnreachable({
      ...unreachableSurvivor,
      layout: { q0: { x: 1, y: 2 }, u: { x: 3, y: 4 } },
    });
    expect(r.layout).toEqual({ q0: { x: 1, y: 2 } });
  });

  it('leaves the language unchanged', () => {
    for (const { name, m } of ALL) {
      expect([name, disagreement(m, removeUnreachable(m), alphabetOf(m))]).toEqual([name, null]);
    }
  });
});

// ---------------------------------------------------------------------------
// The four traps
// ---------------------------------------------------------------------------

describe('minimize — trap 1: unreachable states must go before refining', () => {
  it('does not let an unreachable state survive as its own class', () => {
    // Refining first would put `u` (non-accepting) in a block of its own, and `u` is not
    // a dead state, so nothing later would remove it: the answer would be 2, not 1.
    const m = minimize(unreachableSurvivor);
    expect(m.states).toEqual(['q0']);
    expect(minimalStateCount(unreachableSurvivor)).toBe(1);
  });

  it('discards a trap that only an unreachable state could reach', () => {
    // Completing adds a trap because `u` has no moves — but the trap is reachable only
    // from `u`, so pruning after completing must take both away.
    const withDeadCorner: Automaton = {
      states: ['q0', 'u'],
      alphabet: AB,
      transitions: edges(`
        q0 -a-> q0
        q0 -b-> q0
      `),
      start: 'q0',
      accepting: ['q0'],
    };
    expect(minimize(withDeadCorner).states).toEqual(['q0']);
    expect(minimalStateCount(withDeadCorner)).toBe(1);
  });
});

describe('minimize — trap 2: the machine must be completed before refining', () => {
  it('merges a state with a missing move into one whose move goes to a dead state', () => {
    const m = minimize(missingVsDead);
    // q1 (no b-move) and q2 (b-move into the dead state d) reject exactly the same
    // strings. Refining an incomplete machine cannot see that.
    expect(m.states).toContain('q1|q2');
    expect(m.states).toHaveLength(3);
    expect(minimalStateCount(missingVsDead)).toBe(4); // q0, q1|q2, qf, and the trap
  });

  it('still says the same language', () => {
    expect(languageOf(missingVsDead, AB)).toEqual(['aa', 'ba']);
    expect(languageOf(minimize(missingVsDead), AB)).toEqual(['aa', 'ba']);
  });
});

describe('minimize — trap 3: the trap is dropped for display, counted for par', () => {
  it('"contains ab" needs no trap: 3 states drawn, par 3', () => {
    expect(minimize(containsAB).states).toHaveLength(3);
    expect(minimalStateCount(containsAB)).toBe(3);
  });

  it('"exactly ab" needs a trap: 3 states drawn, par 4', () => {
    const m = minimize(exactlyAB);
    expect(m.states).toHaveLength(3);
    expect(minimalStateCount(exactlyAB)).toBe(4);
  });

  it('drops the trap by leaving its transitions MISSING, not by rerouting them', () => {
    const m = minimize(exactlyAB);
    const q = new Set(m.states);
    // No edge may point at a state that is no longer there…
    for (const t of m.transitions) expect(q.has(t.to)).toBe(true);
    // …and the machine is now genuinely partial: 3 states x 2 symbols would be 6 edges,
    // but only s0 -a-> and s1 -b-> survive.
    expect(m.transitions).toHaveLength(2);
  });

  it('the empty language keeps its lone rejecting state — there is nothing to drop', () => {
    const m = minimize(emptyLanguage);
    expect(m.states).toHaveLength(1);
    expect(m.accepting).toEqual([]);
    expect(minimalStateCount(emptyLanguage)).toBe(1);
    expect(languageOf(m, AB)).toEqual([]);
  });

  it('Σ* keeps its lone accepting state', () => {
    const m = minimize(allStringsMachine);
    expect(m.states).toHaveLength(1);
    expect(m.accepting).toEqual(m.states);
    expect(minimalStateCount(allStringsMachine)).toBe(1);
    expect(languageOf(m, AB)).toEqual(allStrings(AB, EXHAUSTIVE_LEN));
  });

  it('{ε} draws one accepting state but pars at two', () => {
    const m = minimize(justEpsilon);
    expect(m.states).toHaveLength(1);
    expect(m.accepting).toEqual(m.states);
    expect(m.transitions).toEqual([]); // the move on 'a' is gone with the trap
    expect(minimalStateCount(justEpsilon)).toBe(2);
    expect(languageOf(m, ['a'])).toEqual(['']);
  });

  it('an all-rejecting machine with many states collapses to one', () => {
    const nothingAccepts: Automaton = {
      states: ['x', 'y', 'z'],
      alphabet: AB,
      transitions: edges(`
        x -a-> y
        x -b-> z
        y -a-> z
        y -b-> x
        z -a-> x
        z -b-> y
      `),
      start: 'x',
      accepting: [],
    };
    expect(minimize(nothingAccepts).states).toHaveLength(1);
    expect(minimalStateCount(nothingAccepts)).toBe(1);
  });

  it('survives an empty alphabet (Σ = ∅, so the only strings are ε and nothing else)', () => {
    const noSymbols: Automaton = {
      states: ['q0'],
      alphabet: [],
      transitions: [],
      start: 'q0',
      accepting: ['q0'],
    };
    const m = minimize(noSymbols);
    expect(m.states).toHaveLength(1);
    expect(m.accepting).toEqual(['q0']);
    expect(minimalStateCount(noSymbols)).toBe(1);
    expect(accepts(m, '')).toBe(true);
  });
});

describe('minimize — trap 4: names are content-determined, never order-determined', () => {
  it('names a merged state from its members, sorted', () => {
    const m = minimize(endsWithAB_redundantDFA);
    expect(m.states.slice().sort()).toEqual(['p0|p3', 'p1|p4', 'p2']);
  });

  it('gives byte-identical output on two runs', () => {
    for (const { name, m } of ALL) {
      expect([name, minimize(m)]).toEqual([name, minimize(m)]);
    }
  });

  it('is unaffected by the order the states and transitions were listed in', () => {
    // The strongest form of the guarantee: shuffling the input data must not move a
    // single byte of the output, because the UI diffs on state names.
    for (const { name, m } of ALL) {
      const shuffled: Automaton = {
        ...m,
        states: [...m.states].reverse(),
        transitions: [...m.transitions].reverse(),
        accepting: [...m.accepting].reverse(),
      };
      expect([name, minimize(shuffled)]).toEqual([name, minimize(m)]);
    }
  });

  it('does not fuse a state literally named like a merge with the merge itself', () => {
    // Pathological, but a fusion would change the language: 'p0|p3' is a *state name*
    // here, and it must not be swallowed by the merge of p0 and p3.
    const collide: Automaton = {
      ...endsWithAB_redundantDFA,
      states: [...endsWithAB_redundantDFA.states, 'p0|p3'],
      transitions: [
        ...endsWithAB_redundantDFA.transitions,
        // Reachable, accepting, and distinguishable from everything else: after 'aa'
        // we are in p4, and 'aab' must still accept, so route the odd state elsewhere.
        { from: 'p2', on: 'a', to: 'p0|p3' },
        { from: 'p0|p3', on: 'a', to: 'p1' },
        { from: 'p0|p3', on: 'b', to: 'p0' },
      ],
      // p2 -a-> p0|p3 replaces p2 -a-> p1; drop the old edge to stay deterministic.
      accepting: ['p2'],
    };
    const deduped: Automaton = {
      ...collide,
      transitions: collide.transitions.filter(
        (t) => !(t.from === 'p2' && t.on === 'a' && t.to === 'p1'),
      ),
    };
    const m = minimize(deduped);
    // p0|p3 (the state) behaves exactly like p0/p3, so it merges INTO that class — the
    // point is only that the resulting names stay unique and the language survives.
    expect(new Set(m.states).size).toBe(m.states.length);
    expect(disagreement(deduped, m, AB)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The properties that must hold of every machine
// ---------------------------------------------------------------------------

describe('minimize — properties', () => {
  it('preserves the language on every string up to length 6', () => {
    for (const { name, m } of ALL) {
      expect([name, disagreement(m, minimize(m), alphabetOf(m))]).toEqual([name, null]);
    }
  });

  it('is idempotent — byte for byte, not merely in state count', () => {
    for (const { name, m } of ALL) {
      const once = minimize(m);
      expect([name, minimize(once)]).toEqual([name, once]);
      expect([name, minimize(once).states.length]).toEqual([name, once.states.length]);
    }
  });

  it('never grows a machine', () => {
    for (const { name, m } of ALL) {
      expect([name, minimize(m).states.length <= Math.max(m.states.length, 1)]).toEqual([
        name,
        true,
      ]);
    }
  });

  it('agrees with minimalStateCount up to the dropped trap', () => {
    for (const { name, m } of ALL) {
      const drawn = minimize(m).states.length;
      const par = minimalStateCount(m);
      expect([name, par - drawn]).toEqual([name, par === drawn ? 0 : 1]);
      expect([name, par >= drawn]).toEqual([name, true]);
    }
  });

  it('gives the same state count to different machines for the same language', () => {
    const sameLanguage = [endsWithAB_NFA, endsWithAB_epsilonNFA, endsWithAB_redundantDFA];

    // First: they really are the same language (otherwise the test below proves nothing).
    for (const m of sameLanguage.slice(1)) {
      expect(disagreement(endsWithAB_NFA, m, AB)).toBeNull();
    }

    const counts = sameLanguage.map((m) => minimize(m).states.length);
    const pars = sameLanguage.map((m) => minimalStateCount(m));
    expect(counts).toEqual([3, 3, 3]);
    expect(pars).toEqual([3, 3, 3]); // "ends with ab" has no dead words
  });

  it('determinises an ε-NFA rather than choking on the free move', () => {
    const m = minimize(endsWithAB_epsilonNFA);
    expect(m.transitions.every((t) => t.on !== 'ε')).toBe(true);
    expect(languageOf(m, AB, 3)).toEqual(['ab', 'aab', 'bab']);
  });

  it('leaves an already-minimal machine at the same size', () => {
    expect(minimize(containsAB).states).toHaveLength(3);
    expect(minimize(minimize(containsAB)).states).toHaveLength(3);
  });
});
