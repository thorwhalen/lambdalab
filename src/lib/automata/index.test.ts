/**
 * Tests for the automata barrel.
 *
 * Two jobs, and the second is the one that matters:
 *
 *   1. The public surface is COMPLETE — every name a lesson needs is re-exported.
 *   2. The engine WORKS through the barrel alone. Everything below imports only
 *      from './index', so these are the exact import paths a lesson uses. The deep
 *      unit tests live next to their modules; this file closes the loop those
 *      modules only cover in halves — it walks the ENTIRE Kleene round trip
 *      (regex -> NFA -> DFA -> minimal DFA -> regex -> NFA) and asserts the
 *      language survives every leg. That composite property is exactly what no
 *      single module can test about itself, and it is the claim the lesson makes.
 *
 * Edge cases are the ones that break naive engines: the empty language ∅, ε, the
 * single-state machine, the trap, and unreachable states.
 */

import { describe, expect, it } from 'vitest';
import {
  EPSILON,
  accepts,
  acceptsLanguage,
  alphabetOf,
  automatonToRegex,
  automatonToRegexSteps,
  complement,
  complete,
  determinismReport,
  epsilonClosure,
  equivalent,
  minimalStateCount,
  minimize,
  parseRegex,
  product,
  reachableStates,
  regexAlphabet,
  regexSize,
  regexToNFA,
  regexToNFASteps,
  removeUnreachable,
  renderRegex,
  sampleStrings,
  shortestAccepted,
  simplifyRegex,
  step,
  toDFA,
  trace,
  type Automaton,
  type RegexNode,
} from './index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Parse or die — a fixture that fails to parse is a broken test, not a failing one. */
const re = (src: string): RegexNode => {
  const r = parseRegex(src);
  if (!r.ok) throw new Error(`fixture does not parse: ${src} — ${r.message}`);
  return r.node;
};

/** The machine for a regex, the way every lesson builds one. */
const machine = (src: string): Automaton => regexToNFA(re(src));

/**
 * A representative corpus. Chosen to include the shapes that break naive engines:
 * the two constants, a star over a union, a language whose minimal DFA needs a
 * trap ('ab' exactly), and one that needs none ('contains ab').
 */
const CORPUS: readonly string[] = [
  '∅',
  'ε',
  'a',
  'ab',
  'a|b',
  'a*',
  'a+',
  'a?',
  '(a|b)*',
  '(a|b)*ab',
  '(a|b)*ab(a|b)*',
  'a*b*',
  '(ab)*',
  'a(a|b)*b',
  'ε|a',
];

// ---------------------------------------------------------------------------
// 1. The surface
// ---------------------------------------------------------------------------

describe('public surface', () => {
  it('re-exports every function the lessons need', () => {
    const surface = {
      accepts,
      trace,
      step,
      epsilonClosure,
      determinismReport,
      reachableStates,
      alphabetOf,
      parseRegex,
      renderRegex,
      simplifyRegex,
      regexSize,
      regexAlphabet,
      regexToNFA,
      regexToNFASteps,
      toDFA,
      complete,
      complement,
      product,
      minimize,
      minimalStateCount,
      removeUnreachable,
      equivalent,
      acceptsLanguage,
      shortestAccepted,
      sampleStrings,
      automatonToRegex,
      automatonToRegexSteps,
    };
    for (const [name, fn] of Object.entries(surface).sort(([x], [y]) => (x < y ? -1 : 1))) {
      expect(typeof fn, `${name} should be re-exported as a function`).toBe('function');
    }
  });

  it('re-exports EPSILON, and it is not a member of any alphabet', () => {
    expect(EPSILON).toBe('ε');
    expect(regexAlphabet(re('a|b'))).not.toContain(EPSILON);
  });
});

// ---------------------------------------------------------------------------
// 2. THE ROUND TRIP — Kleene's theorem, both directions, end to end
// ---------------------------------------------------------------------------

describe("Kleene's theorem: the whole loop preserves the language", () => {
  for (const src of CORPUS) {
    it(`round-trips ${src}`, () => {
      const start = machine(src);

      // Forwards: regex -> ε-NFA -> total DFA -> minimal DFA.
      const dfa = toDFA(start).dfa;
      const min = minimize(dfa);

      // Backwards: minimal DFA -> regex -> ε-NFA again.
      const backToRegex = automatonToRegex(min);
      const end = regexToNFA(backToRegex);

      // Every leg must preserve the language, and `equivalent` is the judge. If
      // any leg drifted, this reports the shortest string that proves it.
      expect(equivalent(start, dfa), `subset construction changed ${src}`).toEqual({ equal: true });
      expect(equivalent(start, min), `minimisation changed ${src}`).toEqual({ equal: true });
      expect(equivalent(start, end), `state elimination changed ${src}`).toEqual({ equal: true });
    });
  }

  it('the round trip is a fixed point: going round twice adds nothing', () => {
    const src = '(a|b)*ab';
    const once = minimize(toDFA(machine(src)).dfa);
    const twice = minimize(toDFA(regexToNFA(automatonToRegex(once))).dfa);
    expect(equivalent(once, twice)).toEqual({ equal: true });
    // Minimality is a property of the language, so the second trip cannot grow it.
    expect(twice.states.length).toBe(once.states.length);
  });

  it('simplifyRegex is sound — it never changes the language', () => {
    for (const src of CORPUS) {
      const raw = re(src);
      expect(
        equivalent(regexToNFA(raw), regexToNFA(simplifyRegex(raw))),
        `simplify changed the language of ${src}`,
      ).toEqual({ equal: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Grading — the verdict AND the witness
// ---------------------------------------------------------------------------

describe('equivalent (the grader)', () => {
  it('accepts a correct answer spelled differently from the reference', () => {
    expect(equivalent(machine('a*a*'), machine('a*'))).toEqual({ equal: true });
    expect(equivalent(machine('a+'), machine('aa*'))).toEqual({ equal: true });
  });

  it('rejects a wrong answer AND hands back the SHORTEST disagreeing string', () => {
    // The classic slip: 'a+' answered as 'a*'. They differ on exactly one string —
    // the empty one — and that must be the witness.
    const verdict = equivalent(machine('a*'), machine('a+'));
    expect(verdict.equal).toBe(false);
    if (verdict.equal) return;

    expect(verdict.counterexample).toBe('');
    // The witness must not merely exist — it must actually separate them, and the
    // engine must have named the right culprit. This is what makes feedback safe.
    expect(accepts(machine('a*'), verdict.counterexample)).toBe(true);
    expect(accepts(machine('a+'), verdict.counterexample)).toBe(false);
    expect(verdict.acceptedBy).toBe('a');
  });

  it('compares over the UNION alphabet — a forgotten letter is caught', () => {
    // 'a*' over {a} vs 'a*' over {a,b}: a learner who never drew a 'b' edge has
    // NOT built the same language, and the shortest proof of that is 'b'.
    const overA = machine('a*');
    const overAB: Automaton = { ...overA, alphabet: ['a', 'b'] };
    // Same language still (b is rejected by both), so this must be equal...
    expect(equivalent(overA, overAB)).toEqual({ equal: true });

    // ...but 'a*' and '(a|b)*' genuinely differ, and 'b' is the shortest witness.
    const verdict = equivalent(machine('a*'), machine('(a|b)*'));
    expect(verdict.equal).toBe(false);
    if (!verdict.equal) expect(verdict.counterexample).toBe('b');
  });

  it('is deterministic: the same disagreement yields the same witness twice', () => {
    expect(equivalent(machine('(a|b)*ab'), machine('(a|b)*ba'))).toEqual(
      equivalent(machine('(a|b)*ab'), machine('(a|b)*ba')),
    );
  });

  it('acceptsLanguage reports every failure, not just the first', () => {
    const m = machine('(a|b)*ab');
    expect(acceptsLanguage(m, ['ab', 'aab'], ['', 'ba'])).toEqual({ ok: true, failures: [] });

    const bad = acceptsLanguage(m, ['ba'], ['ab']);
    expect(bad.ok).toBe(false);
    expect(bad.failures).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 4. The edge cases that break naive engines
// ---------------------------------------------------------------------------

describe('the empty language ∅', () => {
  const m = machine('∅');

  it('accepts nothing at all — not even ε', () => {
    expect(accepts(m, '')).toBe(false);
    for (const s of sampleStrings(['a', 'b'], 3)) expect(accepts(m, s)).toBe(false);
  });

  it('has no shortest accepted string', () => {
    expect(shortestAccepted(m)).toBeNull();
  });

  it('minimises to a single rejecting state — the lone state is never dropped', () => {
    const min = minimize(m);
    expect(min.states).toHaveLength(1);
    expect(min.accepting).toHaveLength(0);
  });

  it('is not the same language as ε', () => {
    const verdict = equivalent(machine('∅'), machine('ε'));
    expect(verdict.equal).toBe(false);
    if (!verdict.equal) expect(verdict.counterexample).toBe('');
  });
});

describe('ε and the empty string', () => {
  it('ε accepts exactly the empty string', () => {
    const m = machine('ε');
    expect(accepts(m, '')).toBe(true);
    expect(accepts(m, 'a')).toBe(false);
    expect(shortestAccepted(m)).toBe('');
  });

  it('an accepting start state accepts ε — the ε-closure must see it', () => {
    const m = machine('a*');
    expect(accepts(m, '')).toBe(true);
    expect(epsilonClosure(m, [m.start]).size).toBeGreaterThan(0);
  });

  it('a trace of the empty string still has an initial rest step', () => {
    const t = trace(machine('a*'), '');
    expect(t.accepted).toBe(true);
    expect(t.steps.length).toBeGreaterThanOrEqual(1);
    expect(t.steps[0]!.pos).toBe(0);
    expect(t.steps[0]!.consumed).toBeUndefined();
  });
});

describe('the trap state, and the par score', () => {
  // The documented, deliberate disagreement between the two counts. If these two
  // ever agree, one of them has regressed.
  it('minimalStateCount counts the dead class; minimize does not draw it', () => {
    // "exactly ab" over {a,b}: three live Myhill-Nerode classes (ε, a, ab) plus the
    // dead one. The textbook number is 4; the diagram shows 3.
    const exactlyAB = machine('ab');
    expect(minimalStateCount(exactlyAB)).toBe(4);
    expect(minimize(exactlyAB).states).toHaveLength(3);
  });

  it('a language with no dead words scores the same either way', () => {
    // "contains ab" over {a,b}: no string is ever beyond saving, so there is no
    // dead class and no trap to omit.
    const containsAB = machine('(a|b)*ab(a|b)*');
    expect(minimalStateCount(containsAB)).toBe(3);
    expect(minimize(containsAB).states).toHaveLength(3);
  });

  it('complete() makes every (state, symbol) total, so complement is sound', () => {
    const dfa = toDFA(machine('ab')).dfa;
    const total = complete(dfa);
    const report = determinismReport(total);
    expect(report.isDeterministic).toBe(true);
    expect(report.isTotal).toBe(true);
    expect(report.missing).toHaveLength(0);

    // The payoff: complementing a machine that dies mid-word must still be right.
    // 'aab' is rejected by 'ab' by DYING, not by ending in a non-accepting state —
    // the exact string a partial complement gets wrong.
    const notAB = complement(machine('ab'));
    expect(accepts(machine('ab'), 'aab')).toBe(false);
    expect(accepts(notAB, 'aab')).toBe(true);
    expect(accepts(notAB, 'ab')).toBe(false);
  });

  it('complement is an involution on the language', () => {
    const m = machine('(a|b)*ab');
    expect(equivalent(complement(complement(m)), m)).toEqual({ equal: true });
  });
});

describe('unreachable states and the single-state machine', () => {
  it('removeUnreachable drops a state nothing can get to, and keeps the language', () => {
    const withOrphan: Automaton = {
      states: ['q0', 'q1', 'orphan'],
      alphabet: ['a'],
      transitions: [
        { from: 'q0', on: 'a', to: 'q1' },
        // 'orphan' loops to itself and accepts, but nothing ever reaches it.
        { from: 'orphan', on: 'a', to: 'orphan' },
      ],
      start: 'q0',
      accepting: ['q1', 'orphan'],
    };
    const pruned = removeUnreachable(withOrphan);
    expect(pruned.states).not.toContain('orphan');
    expect(reachableStates(withOrphan).has('orphan')).toBe(false);
    // Dropping it must not change what the machine does.
    expect(equivalent(withOrphan, pruned)).toEqual({ equal: true });
  });

  it('a single-state machine is handled: the one-state acceptor of Σ*', () => {
    const sigmaStar: Automaton = {
      states: ['q'],
      alphabet: ['a'],
      transitions: [{ from: 'q', on: 'a', to: 'q' }],
      start: 'q',
      accepting: ['q'],
    };
    expect(accepts(sigmaStar, '')).toBe(true);
    expect(accepts(sigmaStar, 'aaa')).toBe(true);
    expect(minimize(sigmaStar).states).toHaveLength(1);
    expect(equivalent(sigmaStar, machine('a*'))).toEqual({ equal: true });
  });
});

// ---------------------------------------------------------------------------
// 5. The boolean closure
// ---------------------------------------------------------------------------

describe('product — the boolean closure', () => {
  const evenAs = machine('(b*ab*ab*)*'); // an even number of a's
  const containsAB = machine('(a|b)*ab(a|b)*');

  it('and/or/minus/xor agree with the set operations, string by string', () => {
    const and = product(evenAs, containsAB, 'and');
    const or = product(evenAs, containsAB, 'or');
    const minus = product(evenAs, containsAB, 'minus');
    const xor = product(evenAs, containsAB, 'xor');

    for (const s of sampleStrings(['a', 'b'], 4)) {
      const inL = accepts(evenAs, s);
      const inR = accepts(containsAB, s);
      expect(accepts(and, s), `and on "${s}"`).toBe(inL && inR);
      expect(accepts(or, s), `or on "${s}"`).toBe(inL || inR);
      expect(accepts(minus, s), `minus on "${s}"`).toBe(inL && !inR);
      expect(accepts(xor, s), `xor on "${s}"`).toBe(inL !== inR);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. The animations (the *Steps twins)
// ---------------------------------------------------------------------------

describe('the animation frames', () => {
  it('regexToNFASteps ends on the machine regexToNFA returns', () => {
    const node = re('(a|b)*ab');
    const steps = regexToNFASteps(node);
    expect(steps.length).toBeGreaterThan(0);
    const last = steps[steps.length - 1]!;
    // The final frame IS the answer — otherwise the animation lies about its result.
    expect(last.fragment).toEqual(regexToNFA(node));
  });

  it('automatonToRegexSteps removes each state once and ends at the answer', () => {
    const m = minimize(toDFA(machine('(a|b)*ab')).dfa);
    const steps = automatonToRegexSteps(m);
    expect(steps.length).toBeGreaterThan(0);

    // Every original state is ripped out exactly once.
    const removed = steps.map((s) => s.removed);
    expect(new Set(removed).size).toBe(removed.length);
    for (const s of m.states) expect(removed).toContain(s);

    // And the language of the final regex is still the language of the machine.
    expect(equivalent(m, regexToNFA(automatonToRegex(m)))).toEqual({ equal: true });
  });

  it('is deterministic: the same machine yields byte-identical frames twice', () => {
    // The UI diffs frames on state names. Two runs must not disagree.
    const node = re('(a|b)*ab');
    expect(regexToNFASteps(node)).toEqual(regexToNFASteps(node));
    const m = minimize(toDFA(machine('a(a|b)*b')).dfa);
    expect(automatonToRegexSteps(m)).toEqual(automatonToRegexSteps(m));
    expect(toDFA(machine('(a|b)*ab')).dfa).toEqual(toDFA(machine('(a|b)*ab')).dfa);
  });
});

// ---------------------------------------------------------------------------
// 7. Small surface checks that would otherwise only be caught in the UI
// ---------------------------------------------------------------------------

describe('regex text round trip', () => {
  it('renderRegex output parses back to the same AST', () => {
    for (const src of CORPUS) {
      const node = re(src);
      const printed = renderRegex(node);
      const reparsed = parseRegex(printed);
      expect(reparsed.ok, `${printed} should parse`).toBe(true);
      if (reparsed.ok) expect(reparsed.node, `round trip of ${src} via ${printed}`).toEqual(node);
    }
  });

  it('reports a bad regex rather than throwing', () => {
    expect(parseRegex('(a|').ok).toBe(false);
  });

  it('regexSize grows with the expression', () => {
    expect(regexSize(re('a'))).toBeLessThan(regexSize(re('(a|b)*ab')));
  });
});

describe('step / alphabetOf', () => {
  it('step moves the state set across one symbol', () => {
    const m = machine('ab');
    const afterA = step(m, epsilonClosure(m, [m.start]), 'a');
    expect(afterA.size).toBeGreaterThan(0);
  });

  it('alphabetOf unions the declared alphabet with the used one', () => {
    const m: Automaton = {
      states: ['q0', 'q1'],
      alphabet: ['a', 'z'], // 'z' is declared but never drawn — it still counts
      transitions: [{ from: 'q0', on: 'b', to: 'q1' }], // 'b' is drawn but never declared
      start: 'q0',
      accepting: ['q1'],
    };
    expect(alphabetOf(m)).toEqual(['a', 'b', 'z']); // sorted, deduped
  });
});
