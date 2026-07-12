/**
 * Tests for subset construction and the boolean closure operations.
 *
 * The method throughout is an **oracle**: the language of a constructed machine is
 * compared, string by string over the whole ball of radius `MAX_LEN`, against the
 * language computed directly from the inputs with `accepts`. A hand-picked example
 * only catches the bug you already thought of; the ball catches the one you didn't.
 *
 * The cases that earn their keep here are the ones that quietly produce a machine
 * for the *wrong language* rather than a crash: complementing a machine that
 * rejects by getting stuck, a product of machines with different alphabets, a
 * symbol declared but never drawn, an ε-cycle, and two distinct subsets whose
 * pretty names collide.
 */

import { describe, expect, it } from 'vitest';
import { EPSILON, type Automaton, type Sym } from './types';
import { accepts, alphabetOf, determinismReport } from './simulate';
import { complement, complete, product, toDFA, type BooleanOp } from './subset';

// ---------------------------------------------------------------------------
// Oracles
// ---------------------------------------------------------------------------

/** Long enough to run past every fixture's state count; short enough to stay instant. */
const MAX_LEN = 5;

/** Every string over `alphabet` up to `maxLen`, shortest first, then lexicographic. */
const ball = (alphabet: Sym[], maxLen = MAX_LEN): string[] => {
  const sorted = [...alphabet].sort();
  const out = [''];
  let frontier = [''];
  for (let n = 0; n < maxLen; n++) {
    frontier = frontier.flatMap((s) => sorted.map((c) => s + c));
    out.push(...frontier);
  }
  return out;
};

/** The strings in the ball on which two machines disagree. Empty === same language. */
const disagreements = (x: Automaton, y: Automaton, alphabet: Sym[]): string[] =>
  ball(alphabet).filter((s) => accepts(x, s) !== accepts(y, s));

/** The strings on which `m` disagrees with a predicate we computed by hand. */
const misclassified = (m: Automaton, alphabet: Sym[], oracle: (s: string) => boolean): string[] =>
  ball(alphabet).filter((s) => accepts(m, s) !== oracle(s));

const language = (m: Automaton, alphabet: Sym[]): string[] =>
  ball(alphabet).filter((s) => accepts(m, s));

const union = (x: Sym[], y: Sym[]): Sym[] => [...new Set([...x, ...y])].sort();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The textbook NFA for (a|b)*abb — genuinely nondeterministic. */
const endsInABB: Automaton = {
  states: ['q0', 'q1', 'q2', 'q3'],
  alphabet: ['a', 'b'],
  transitions: [
    { from: 'q0', on: 'a', to: 'q0' },
    { from: 'q0', on: 'b', to: 'q0' },
    { from: 'q0', on: 'a', to: 'q1' },
    { from: 'q1', on: 'b', to: 'q2' },
    { from: 'q2', on: 'b', to: 'q3' },
  ],
  start: 'q0',
  accepting: ['q3'],
};

/** Even number of 'a's. A total DFA already — `complete` must not touch it. */
const evenAs: Automaton = {
  states: ['e', 'o'],
  alphabet: ['a', 'b'],
  transitions: [
    { from: 'e', on: 'a', to: 'o' },
    { from: 'e', on: 'b', to: 'e' },
    { from: 'o', on: 'a', to: 'e' },
    { from: 'o', on: 'b', to: 'o' },
  ],
  start: 'e',
  accepting: ['e'],
};

/**
 * a* — but a *partial* machine: there is no 'b'-move at all, so it rejects every
 * string containing a 'b' by dying. This is the fixture that catches the classic
 * complement bug: flip the accepting set without completing first and the
 * complement accepts nothing.
 */
const onlyAs: Automaton = {
  states: ['q0'],
  alphabet: ['a', 'b'],
  transitions: [{ from: 'q0', on: 'a', to: 'q0' }],
  start: 'q0',
  accepting: ['q0'],
};

/** ε-NFA for a?b — the ε-move is real, not decoration. */
const optionalAThenB: Automaton = {
  states: ['s', 'm', 'f'],
  alphabet: ['a', 'b'],
  transitions: [
    { from: 's', on: 'a', to: 'm' },
    { from: 's', on: EPSILON, to: 'm' },
    { from: 'm', on: 'b', to: 'f' },
  ],
  start: 's',
  accepting: ['f'],
};

/** ε-cycle q0→q1→q0, plus an unreachable island. Nothing may diverge or leak. */
const epsilonCycleWithIsland: Automaton = {
  states: ['q0', 'q1', 'q2', 'island'],
  alphabet: ['a'],
  transitions: [
    { from: 'q0', on: EPSILON, to: 'q1' },
    { from: 'q1', on: EPSILON, to: 'q0' },
    { from: 'q1', on: 'a', to: 'q2' },
    { from: 'island', on: 'a', to: 'island' },
  ],
  start: 'q0',
  accepting: ['q2', 'island'],
};

/** ∅ — the empty language. No transitions, nothing accepting. */
const emptyLanguage: Automaton = {
  states: ['q0'],
  alphabet: ['a', 'b'],
  transitions: [],
  start: 'q0',
  accepting: [],
};

/** Σ* — everything. */
const everything: Automaton = {
  states: ['q0'],
  alphabet: ['a', 'b'],
  transitions: [
    { from: 'q0', on: 'a', to: 'q0' },
    { from: 'q0', on: 'b', to: 'q0' },
  ],
  start: 'q0',
  accepting: ['q0'],
};

/** {ε} over the *empty* alphabet: a single state, no symbols to read at all. */
const justEpsilon: Automaton = {
  states: ['q0'],
  alphabet: [],
  transitions: [],
  start: 'q0',
  accepting: ['q0'],
};

/** Σ = {a}, but the machine only reads 'a'. Used with a {b}-machine to test unions of Σ. */
const oddAs: Automaton = {
  states: ['e', 'o'],
  alphabet: ['a'],
  transitions: [
    { from: 'e', on: 'a', to: 'o' },
    { from: 'o', on: 'a', to: 'e' },
  ],
  start: 'e',
  accepting: ['o'],
};

/** Σ = {b}: exactly one 'b'. Disjoint alphabet from `oddAs`. */
const oneB: Automaton = {
  states: ['p0', 'p1'],
  alphabet: ['b'],
  transitions: [{ from: 'p0', on: 'b', to: 'p1' }],
  start: 'p0',
  accepting: ['p1'],
};

/** 'c' is declared but never drawn. A machine that ignores it computes the wrong Σ*. */
const declaredButUndrawn: Automaton = {
  states: ['q0', 'q1'],
  alphabet: ['a', 'c'],
  transitions: [{ from: 'q0', on: 'a', to: 'q1' }],
  start: 'q0',
  accepting: ['q1'],
};

const nfaFixtures: Array<[string, Automaton]> = [
  ['endsInABB', endsInABB],
  ['evenAs', evenAs],
  ['onlyAs', onlyAs],
  ['optionalAThenB', optionalAThenB],
  ['epsilonCycleWithIsland', epsilonCycleWithIsland],
  ['emptyLanguage', emptyLanguage],
  ['everything', everything],
  ['justEpsilon', justEpsilon],
  ['oddAs', oddAs],
  ['oneB', oneB],
  ['declaredButUndrawn', declaredButUndrawn],
];

// ---------------------------------------------------------------------------
// toDFA
// ---------------------------------------------------------------------------

describe('toDFA', () => {
  it.each(nfaFixtures)('preserves the language of %s on every string up to length 5', (_, nfa) => {
    const { dfa } = toDFA(nfa);
    expect(disagreements(nfa, dfa, alphabetOf(nfa))).toEqual([]);
  });

  it.each(nfaFixtures)('yields a total, deterministic machine for %s', (_, nfa) => {
    const { dfa } = toDFA(nfa);
    const report = determinismReport(dfa);
    expect(report.hasEpsilon).toBe(false);
    expect(report.nondeterministic).toEqual([]);
    expect(report.missing).toEqual([]);
    expect(report.isDeterministic).toBe(true);
    expect(report.isTotal).toBe(true);
  });

  it.each(nfaFixtures)('is reproducible for %s: two runs agree exactly', (_, nfa) => {
    // The UI diffs on state names. Insertion order must never leak into them.
    expect(toDFA(nfa)).toEqual(toDFA(nfa));
  });

  it('names states after the sorted subset they stand for', () => {
    const { dfa, mapping } = toDFA(endsInABB);
    expect(dfa.start).toBe('{q0}');
    expect(dfa.states).toContain('{q0,q1}');
    expect(mapping['{q0,q1}']).toEqual(['q0', 'q1']);
    // Discovery is breadth-first from the start subset, so the start comes first.
    expect(dfa.states[0]).toBe(dfa.start);
  });

  it('is insensitive to the order the NFA lists its states and transitions in', () => {
    const shuffled: Automaton = {
      ...endsInABB,
      states: [...endsInABB.states].reverse(),
      transitions: [...endsInABB.transitions].reverse(),
    };
    expect(toDFA(shuffled)).toEqual(toDFA(endsInABB));
  });

  it('maps every DFA state, and only reachable subsets exist', () => {
    const { dfa, mapping } = toDFA(epsilonCycleWithIsland);
    expect(Object.keys(mapping).sort()).toEqual([...dfa.states].sort());
    // 'island' is accepting but unreachable: it must appear in no subset at all,
    // or the DFA would accept strings the NFA rejects.
    expect(Object.values(mapping).flat()).not.toContain('island');
  });

  it('accepts a subset exactly when it contains an accepting NFA state', () => {
    const { dfa, mapping } = toDFA(endsInABB);
    const accepting = new Set(dfa.accepting);
    for (const state of dfa.states) {
      const containsAccept = mapping[state].some((s) => endsInABB.accepting.includes(s));
      expect(accepting.has(state)).toBe(containsAccept);
    }
  });

  it('adds the ∅ trap when — and only when — the empty subset is reachable', () => {
    // `onlyAs` has no 'b'-move, so reading 'b' lands the NFA nowhere.
    expect(toDFA(onlyAs).dfa.states).toContain('∅');
    expect(toDFA(onlyAs).mapping['∅']).toEqual([]);
    // `evenAs` is already total: there is nowhere for a trap to come from.
    expect(toDFA(evenAs).dfa.states).not.toContain('∅');
  });

  it('gives the trap a self-loop on every symbol', () => {
    const { dfa } = toDFA(onlyAs);
    const fromTrap = dfa.transitions.filter((t) => t.from === '∅');
    expect(fromTrap.map((t) => t.on).sort()).toEqual(['a', 'b']);
    expect(fromTrap.every((t) => t.to === '∅')).toBe(true);
    expect(dfa.accepting).not.toContain('∅');
  });

  it('honours a symbol that is declared but never drawn', () => {
    // Σ = {a, c}. Only 'a' has an edge, so 'c' must lead to the trap — not be
    // ignored. Getting this wrong makes the *complement* accept the wrong strings.
    const { dfa } = toDFA(declaredButUndrawn);
    expect(dfa.alphabet).toEqual(['a', 'c']);
    expect(dfa.states).toContain('∅');
    expect(misclassified(dfa, ['a', 'c'], (s) => s === 'a')).toEqual([]);
  });

  it('handles the empty alphabet: one state, no transitions', () => {
    const { dfa, mapping } = toDFA(justEpsilon);
    expect(dfa.states).toEqual(['{q0}']);
    expect(dfa.transitions).toEqual([]);
    expect(dfa.accepting).toEqual(['{q0}']);
    expect(mapping).toEqual({ '{q0}': ['q0'] });
    // Σ* = {ε} when Σ = ∅. Totality is vacuous, and there is no trap to add.
    expect(determinismReport(dfa).isTotal).toBe(true);
  });

  it('collapses an ε-cycle without diverging', () => {
    const { dfa, mapping } = toDFA(epsilonCycleWithIsland);
    expect(mapping[dfa.start]).toEqual(['q0', 'q1']);
    expect(misclassified(dfa, ['a'], (s) => s === 'a')).toEqual([]);
  });

  it('keeps two subsets apart even when their pretty names collide', () => {
    // The state named 'a,b' and the subset {'a','b'} both *print* as "{a,b}".
    // If identity were keyed on the name they would fuse — and since 'a' accepts
    // while 'a,b' does not, the machine would then accept 'y'. It must not.
    const nameClash: Automaton = {
      states: ['p', 'a', 'b', 'a,b'],
      alphabet: ['x', 'y'],
      transitions: [
        { from: 'p', on: 'x', to: 'a' },
        { from: 'p', on: 'x', to: 'b' },
        { from: 'p', on: 'y', to: 'a,b' },
      ],
      start: 'p',
      accepting: ['a'],
    };

    const { dfa, mapping } = toDFA(nameClash);
    expect(new Set(dfa.states).size).toBe(dfa.states.length);

    const byMembers = Object.entries(mapping);
    const twoStates = byMembers.find(([, m]) => m.length === 2 && m[0] === 'a' && m[1] === 'b');
    const oneState = byMembers.find(([, m]) => m.length === 1 && m[0] === 'a,b');
    expect(twoStates).toBeDefined();
    expect(oneState).toBeDefined();
    expect(twoStates?.[0]).not.toBe(oneState?.[0]);

    expect(misclassified(dfa, ['x', 'y'], (s) => s === 'x')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// complete
// ---------------------------------------------------------------------------

describe('complete', () => {
  it('returns an already-total machine unchanged, and does not rename it', () => {
    // Identity, not merely deep-equality: the editor's layout hangs off these names.
    expect(complete(evenAs)).toBe(evenAs);
  });

  it('adds exactly one trap and preserves the language', () => {
    const completed = complete(onlyAs);
    expect(completed.states).toEqual(['q0', '∅']);
    expect(determinismReport(completed).isTotal).toBe(true);
    expect(disagreements(onlyAs, completed, ['a', 'b'])).toEqual([]);
    expect(completed.accepting).toEqual(['q0']);
  });

  it('is idempotent', () => {
    const once = complete(onlyAs);
    expect(complete(once)).toBe(once);
  });

  it('honours a caller-supplied trap name', () => {
    const completed = complete(onlyAs, 'dead');
    expect(completed.states).toContain('dead');
    expect(completed.states).not.toContain('∅');
    expect(disagreements(onlyAs, completed, ['a', 'b'])).toEqual([]);
  });

  it('does not fuse the trap into an existing state of the same name', () => {
    // A machine that already owns a state called '∅' (a learner may well draw one).
    // Reusing that name would reroute every missing move into a state with its own
    // meaning — quietly changing the language.
    const owns: Automaton = {
      states: ['q0', '∅'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'q0', on: 'a', to: '∅' },
        { from: '∅', on: 'a', to: '∅' },
        { from: '∅', on: 'b', to: '∅' },
      ],
      start: 'q0',
      accepting: ['∅'],
    };
    const completed = complete(owns);
    expect(completed.states).toEqual(['q0', '∅', '∅#2']);
    expect(completed.accepting).toEqual(['∅']);
    // L(owns) = a·(a|b)* — the real trap must not become accepting.
    expect(misclassified(completed, ['a', 'b'], (s) => s.startsWith('a'))).toEqual([]);
  });

  it('completes a machine that never declared the start state', () => {
    const forgot: Automaton = {
      states: [],
      alphabet: ['a'],
      transitions: [],
      start: 'q0',
      accepting: ['q0'],
    };
    const completed = complete(forgot);
    expect(completed.states).toEqual(['q0', '∅']);
    expect(determinismReport(completed).isTotal).toBe(true);
    expect(language(completed, ['a'])).toEqual(['']);
  });

  it('preserves editor geometry', () => {
    const laidOut: Automaton = { ...onlyAs, layout: { q0: { x: 10, y: 20 } } };
    expect(complete(laidOut).layout).toEqual({ q0: { x: 10, y: 20 } });
  });

  it('leaves an ε-NFA nondeterministic — completing is not determinising', () => {
    const completed = complete(optionalAThenB);
    expect(determinismReport(completed).isTotal).toBe(true);
    expect(determinismReport(completed).hasEpsilon).toBe(true);
    expect(disagreements(optionalAThenB, completed, ['a', 'b'])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// complement
// ---------------------------------------------------------------------------

describe('complement', () => {
  it.each(nfaFixtures)('accepts exactly what %s rejects', (_, nfa) => {
    const alphabet = alphabetOf(nfa);
    const flipped = complement(nfa);
    expect(misclassified(flipped, alphabet, (s) => !accepts(nfa, s))).toEqual([]);
  });

  it('completes before flipping: a machine that rejects by getting STUCK', () => {
    // `onlyAs` is a*, drawn with no 'b'-move at all. Its complement must accept
    // every string containing a 'b'. Flip the accepting set without completing
    // first and the flipped machine has *no* accepting state — it accepts nothing.
    // This single assertion is the whole reason `complete` exists.
    const notOnlyAs = complement(onlyAs);
    expect(accepts(notOnlyAs, 'b')).toBe(true);
    expect(accepts(notOnlyAs, 'ab')).toBe(true);
    expect(accepts(notOnlyAs, 'aaab')).toBe(true);
    expect(accepts(notOnlyAs, '')).toBe(false);
    expect(accepts(notOnlyAs, 'aaa')).toBe(false);
    expect(notOnlyAs.accepting.length).toBeGreaterThan(0);
    expect(language(notOnlyAs, ['a', 'b'])).toEqual(
      ball(['a', 'b']).filter((s) => s.includes('b')),
    );
  });

  it('is an involution on the language', () => {
    for (const [, nfa] of nfaFixtures) {
      expect(disagreements(nfa, complement(complement(nfa)), alphabetOf(nfa))).toEqual([]);
    }
  });

  it('turns the empty language into Σ* and back', () => {
    expect(language(complement(emptyLanguage), ['a', 'b'])).toEqual(ball(['a', 'b']));
    expect(language(complement(everything), ['a', 'b'])).toEqual([]);
  });

  it('complements over the empty alphabet: {ε} becomes ∅', () => {
    // Σ* = {ε}, so the complement of {ε} is the empty language, not "everything".
    const flipped = complement(justEpsilon);
    expect(accepts(flipped, '')).toBe(false);
    expect(flipped.accepting).toEqual([]);
  });

  it('complements over the DECLARED alphabet, not just the drawn one', () => {
    // L = {a} over Σ = {a, c}. The complement must accept 'c', 'ac', 'ca', … —
    // a machine that only knew about the symbols it had edges for would reject them.
    const flipped = complement(declaredButUndrawn);
    expect(accepts(flipped, 'c')).toBe(true);
    expect(accepts(flipped, 'ac')).toBe(true);
    expect(accepts(flipped, 'a')).toBe(false);
    expect(accepts(flipped, '')).toBe(true);
  });

  it('yields a total DFA (so it can be complemented again)', () => {
    const report = determinismReport(complement(endsInABB));
    expect(report.isDeterministic).toBe(true);
    expect(report.isTotal).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// product
// ---------------------------------------------------------------------------

const OPS: BooleanOp[] = ['and', 'or', 'xor', 'minus'];

const ORACLE: Record<BooleanOp, (a: boolean, b: boolean) => boolean> = {
  and: (x, y) => x && y,
  or: (x, y) => x || y,
  xor: (x, y) => x !== y,
  minus: (x, y) => x && !y,
};

/** Pairs chosen to cross every axis: NFA×DFA, ε-moves, disjoint Σ, ∅, Σ*, empty Σ. */
const pairs: Array<[string, Automaton, Automaton]> = [
  ['endsInABB × evenAs', endsInABB, evenAs],
  ['evenAs × endsInABB', evenAs, endsInABB],
  ['onlyAs × evenAs', onlyAs, evenAs],
  ['optionalAThenB × endsInABB', optionalAThenB, endsInABB],
  ['oddAs × oneB (disjoint alphabets)', oddAs, oneB],
  ['oneB × oddAs (disjoint alphabets)', oneB, oddAs],
  ['emptyLanguage × endsInABB', emptyLanguage, endsInABB],
  ['everything × endsInABB', everything, endsInABB],
  ['justEpsilon × justEpsilon (empty alphabet)', justEpsilon, justEpsilon],
  ['declaredButUndrawn × oddAs', declaredButUndrawn, oddAs],
  ['epsilonCycleWithIsland × oddAs', epsilonCycleWithIsland, oddAs],
  // ε-moves AND a widening alphabet at once: the operand must be determinised
  // *over the union* Σ = {a,b,c}, not over its own {a,b} and patched up after.
  ['optionalAThenB × declaredButUndrawn (ε + widening)', optionalAThenB, declaredButUndrawn],
];

describe('product', () => {
  for (const op of OPS) {
    it.each(pairs)(`'${op}' matches the brute-force oracle on %s`, (_, a, b) => {
      const alphabet = union(alphabetOf(a), alphabetOf(b));
      const combined = product(a, b, op);
      const wrong = ball(alphabet).filter(
        (s) => accepts(combined, s) !== ORACLE[op](accepts(a, s), accepts(b, s)),
      );
      expect(wrong).toEqual([]);
    });
  }

  it.each(pairs)('yields a total DFA over the union alphabet for %s', (_, a, b) => {
    const alphabet = union(alphabetOf(a), alphabetOf(b));
    const combined = product(a, b, 'and');
    expect(combined.alphabet).toEqual(alphabet);
    const report = determinismReport(combined);
    expect(report.isDeterministic).toBe(true);
    expect(report.isTotal).toBe(true);
  });

  it.each(pairs)('is reproducible for %s', (_, a, b) => {
    expect(product(a, b, 'xor')).toEqual(product(a, b, 'xor'));
  });

  it('names product states "(p,q)", keeping the operands\' own names when it can', () => {
    // Both operands are already deterministic, so they are only completed, not
    // renamed: the learner sees their own state names inside the pair.
    const combined = product(evenAs, oddAs, 'and');
    expect(combined.start).toBe('(e,e)');
    expect(combined.states[0]).toBe(combined.start);
    expect(combined.states.every((s) => /^\(.+,.+\)$/.test(s))).toBe(true);
  });

  it('determinises a nondeterministic operand before pairing', () => {
    const combined = product(endsInABB, evenAs, 'and');
    // The left component is now a *subset* of the NFA's states.
    expect(combined.start).toBe('({q0},e)');
  });

  it('xor of a machine with itself is the empty language', () => {
    for (const [, m] of nfaFixtures) {
      expect(language(product(m, m, 'xor'), alphabetOf(m))).toEqual([]);
    }
  });

  it('a minus a is the empty language; a and a, a or a are a', () => {
    for (const [, m] of nfaFixtures) {
      const alphabet = alphabetOf(m);
      expect(language(product(m, m, 'minus'), alphabet)).toEqual([]);
      expect(disagreements(product(m, m, 'and'), m, alphabet)).toEqual([]);
      expect(disagreements(product(m, m, 'or'), m, alphabet)).toEqual([]);
    }
  });

  it('minus is not symmetric', () => {
    // a − b vs b − a. Sanity: the ops are not accidentally all the same table entry.
    const ab = language(product(evenAs, endsInABB, 'minus'), ['a', 'b']);
    const ba = language(product(endsInABB, evenAs, 'minus'), ['a', 'b']);
    expect(ab).not.toEqual(ba);
  });

  it('widens each operand to the union alphabet before totalising', () => {
    // oddAs knows only 'a'; oneB knows only 'b'. Over Σ = {a, b} each must REJECT
    // any string using the other's symbol — so their intersection is empty, and
    // their union is exactly (odd number of a's, no b) ∪ (exactly one b, no a).
    const both = product(oddAs, oneB, 'and');
    expect(both.alphabet).toEqual(['a', 'b']);
    expect(language(both, ['a', 'b'])).toEqual([]);

    const either = product(oddAs, oneB, 'or');
    expect(language(either, ['a', 'b'])).toEqual(
      ball(['a', 'b']).filter((s) => {
        const onlyA = /^a+$/.test(s) && s.length % 2 === 1;
        const onlyOneB = s === 'b';
        return onlyA || onlyOneB;
      }),
    );
  });

  it('handles two machines over the empty alphabet', () => {
    const combined = product(justEpsilon, justEpsilon, 'and');
    expect(combined.alphabet).toEqual([]);
    expect(combined.transitions).toEqual([]);
    expect(combined.states).toEqual(['(q0,q0)']);
    expect(accepts(combined, '')).toBe(true);
    expect(accepts(product(justEpsilon, justEpsilon, 'xor'), '')).toBe(false);
  });

  it('builds only reachable pairs', () => {
    // evenAs (2 states) × oddAs completed over {a,b} (3 states: e, o, ∅) has 6 pairs
    // in the full grid, but the parities move in lockstep on 'a', so far fewer are
    // reachable. Building the whole grid would hand the UI a screen of ghosts.
    const combined = product(evenAs, oddAs, 'and');
    expect(combined.states.length).toBeLessThan(6);
  });

  it('agrees with complement + product on De Morgan', () => {
    // ¬(a ∧ b) = ¬a ∨ ¬b — a property that fails loudly if completion is skipped
    // anywhere in the chain, since ¬ is only sound on a total machine.
    const alphabet = union(alphabetOf(onlyAs), alphabetOf(endsInABB));
    const lhs = complement(product(onlyAs, endsInABB, 'and'));
    const rhs = product(complement(onlyAs), complement(endsInABB), 'or');
    expect(disagreements(lhs, rhs, alphabet)).toEqual([]);
  });

  it('agrees with the set identity a − b = a ∧ ¬b (same alphabet)', () => {
    const alphabet = union(alphabetOf(endsInABB), alphabetOf(evenAs));
    const minus = product(endsInABB, evenAs, 'minus');
    const andNot = product(endsInABB, complement(evenAs), 'and');
    expect(disagreements(minus, andNot, alphabet)).toEqual([]);
  });

  it('a − b = a ∧ ¬b needs ¬b taken over the SAME Σ — widen b first', () => {
    // A real trap, and worth pinning rather than hiding. `complement` is relative
    // to the alphabet of the machine it is handed (there is nowhere else for it to
    // get one), so `complement(oddAs)` complements within {a}*, not within {a,b}*.
    // `product` widens its operands to the union alphabet internally; a caller who
    // complements *before* handing the machine over must widen it themselves.
    const alphabet = union(alphabetOf(endsInABB), alphabetOf(oddAs));
    const minus = product(endsInABB, oddAs, 'minus');

    // Wrong: ¬ over {a} alone. 'abb' ∈ a − b, but oddAs's complement never saw a 'b'.
    const naive = product(endsInABB, complement(oddAs), 'and');
    expect(accepts(minus, 'abb')).toBe(true);
    expect(accepts(naive, 'abb')).toBe(false);

    // Right: widen oddAs to Σ = {a, b}, *then* complement.
    const widened = complement({ ...oddAs, alphabet });
    expect(disagreements(minus, product(endsInABB, widened, 'and'), alphabet)).toEqual([]);
  });

  it('agrees with the set identity a xor b = (a − b) ∨ (b − a)', () => {
    const alphabet = union(alphabetOf(endsInABB), alphabetOf(evenAs));
    const xor = product(endsInABB, evenAs, 'xor');
    const viaMinus = product(
      product(endsInABB, evenAs, 'minus'),
      product(evenAs, endsInABB, 'minus'),
      'or',
    );
    expect(disagreements(xor, viaMinus, alphabet)).toEqual([]);
  });
});
