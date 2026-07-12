/**
 * Tests for the grader.
 *
 * The governing rule here: it is not enough that a wrong answer be marked wrong.
 * The *counterexample world we hand back must actually separate the two
 * formulas* — a cross with a world that doesn't demonstrate anything is worse
 * than no cross at all. So every not-equal case below re-evaluates BOTH formulas
 * in the returned model and asserts they genuinely differ there, and that the
 * reported truth values are the real ones (`expectSeparates`).
 *
 * The known limit of the small-scope hypothesis is not hidden from the suite —
 * it is pinned by tests (see "the small-scope hypothesis, executably"), so that
 * if anyone ever changes the default scope, they are told exactly which promise
 * they changed.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_DOMAIN,
  MAX_MODELS,
  isTautology,
  logicEquivalent,
  satisfiable,
} from './equivalence';
import { evaluate } from './evaluate';
import { parseFormula } from './parse';
import type { Formula, LogicEquivalence, Model, Signature } from './types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sig = (sets: string[] = [], relations: string[] = [], constants: string[] = []): Signature => ({
  sets,
  relations,
  constants,
});

/** Parse or die: a test formula that doesn't parse is a broken test, not a failing assertion. */
function f(src: string, s: Signature): Formula {
  const result = parseFormula(src, s);
  if (!result.ok) throw new Error(`test formula did not parse: ${src} — ${result.message}`);
  return result.formula;
}

const AB = sig(['A', 'B']);
const NAMELESS = sig();

/**
 * Assert a verdict is "not equal" AND that its world does the job it was handed
 * back to do. This is the assertion the whole module exists to satisfy.
 */
function expectSeparates(
  verdict: LogicEquivalence,
  theirs: Formula,
  reference: Formula,
): Model {
  expect(verdict.equal).toBe(false);
  if (verdict.equal) throw new Error('unreachable: guarded above');

  const theirsHolds = evaluate(theirs, verdict.model);
  const referenceHolds = evaluate(reference, verdict.model);

  // The world really does tell them apart...
  expect(theirsHolds).not.toBe(referenceHolds);
  // ...and the verdict reports the truth values that world actually has.
  expect(theirsHolds).toBe(verdict.theirs);
  expect(referenceHolds).toBe(verdict.reference);

  return verdict.model;
}

// ---------------------------------------------------------------------------
// The six the brief names
// ---------------------------------------------------------------------------

describe('logicEquivalent — the classic confusions', () => {
  it('(a) ∀x(A(x)→B(x)) is NOT ∀x(A(x)∧B(x)), and the counterexample is the vacuous world', () => {
    const theirs = f('∀ x ( A(x) → B(x) )', AB);
    const reference = f('∀ x ( A(x) ∧ B(x) )', AB);

    const verdict = logicEquivalent(theirs, reference, AB);
    const model = expectSeparates(verdict, theirs, reference);

    // The simplest world of all: one thing, in neither set. "All dogs are red" is
    // vacuously TRUE when there are no dogs — which is exactly the lesson.
    expect(model.domain).toEqual(['a']);
    expect(model.sets).toEqual({ A: [], B: [] });
    expect(verdict).toMatchObject({ equal: false, theirs: true, reference: false });
  });

  it('(b) ∃x(A(x)∧B(x)) is NOT ∃x(A(x)→B(x))', () => {
    const theirs = f('∃ x ( A(x) ∧ B(x) )', AB);
    const reference = f('∃ x ( A(x) → B(x) )', AB);

    const verdict = logicEquivalent(theirs, reference, AB);
    const model = expectSeparates(verdict, theirs, reference);

    // In the empty world, "something is an A and a B" is false, but "something is
    // an A-implies-B" is TRUE (vacuously, of the non-A thing). The ∃/→ trap.
    expect(model.domain).toEqual(['a']);
    expect(model.sets).toEqual({ A: [], B: [] });
    expect(verdict).toMatchObject({ equal: false, theirs: false, reference: true });
  });

  it('(c) ¬∀x A(x) IS ∃x ¬A(x) — De Morgan for quantifiers', () => {
    const a = sig(['A']);
    expect(logicEquivalent(f('¬ ∀ x A(x)', a), f('∃ x ¬ A(x)', a), a)).toEqual({ equal: true });
  });

  it('(c′) …and its dual: ¬∃x A(x) IS ∀x ¬A(x)', () => {
    const a = sig(['A']);
    expect(logicEquivalent(f('¬ ∃ x A(x)', a), f('∀ x ¬ A(x)', a), a)).toEqual({ equal: true });
  });

  it('(d) De Morgan for sets: ∀x(x ∈ (A∪B)ᶜ) IS ∀x(x ∈ Aᶜ∩Bᶜ)', () => {
    const theirs = f('∀ x ( x ∈ (A ∪ B)ᶜ )', AB);
    const reference = f('∀ x ( x ∈ Aᶜ ∩ Bᶜ )', AB);
    expect(logicEquivalent(theirs, reference, AB)).toEqual({ equal: true });
  });

  it('(d′) …as a set equation, (A∪B)ᶜ = Aᶜ∩Bᶜ is a law (equivalent to ⊤)', () => {
    expect(logicEquivalent(f('(A ∪ B)ᶜ = Aᶜ ∩ Bᶜ', AB), f('⊤', AB), AB)).toEqual({ equal: true });
  });

  it('(d″) …but the student mangling (A∪B)ᶜ = Aᶜ∪Bᶜ is NOT — and we show them why', () => {
    const theirs = f('(A ∪ B)ᶜ = Aᶜ ∪ Bᶜ', AB);
    const reference = f('⊤', AB);

    const model = expectSeparates(logicEquivalent(theirs, reference, AB), theirs, reference);

    // Needs a thing that is in exactly one of A and B: then it is outside A∪B is
    // false for it, yet it IS outside one of them. One thing suffices.
    expect(model.domain).toEqual(['a']);
    expect(model.sets).toEqual({ A: [], B: ['a'] });
  });

  it('(e) ∀x∃y R(x,y) is NOT ∃y∀x R(x,y) — and it takes two things to see it', () => {
    const r = sig([], ['R']);
    const theirs = f('∀ x ∃ y R(x, y)', r);
    const reference = f('∃ y ∀ x R(x, y)', r);

    const verdict = logicEquivalent(theirs, reference, r);
    const model = expectSeparates(verdict, theirs, reference);

    // One thing is not enough: with a single element the two collapse. The search
    // must escalate to a 2-element world to find the "everyone likes someone, but
    // nobody is liked by everyone" configuration.
    expect(model.domain).toHaveLength(2);
    // ∃y∀x is the STRONGER claim, so it is the one that fails here.
    expect(verdict).toMatchObject({ equal: false, theirs: true, reference: false });
  });

  it('(e′) the valid direction (∃y∀x R) → (∀x∃y R) is a tautology — WHEN PARENTHESISED', () => {
    const r = sig([], ['R']);
    expect(isTautology(f('( ∃ y ∀ x R(x, y) ) → ( ∀ x ∃ y R(x, y) )', r), r)).toBe(true);
  });

  it('(e″) …and WITHOUT the parens it is not, because a quantifier swallows the arrow', () => {
    // A quantifier's body runs as far right as it can, so this reads
    //   ∃y ∀x ( R(x,y) → ∀x ∃y R(x,y) )
    // — NOT an implication between two sentences. That is the standard convention
    // and a classic source of confusion, so it is pinned here: the grader must be
    // grading the formula the notation actually denotes, not the one we meant.
    const r = sig([], ['R']);
    const greedy = f('∃ y ∀ x R(x, y) → ∀ x ∃ y R(x, y)', r);

    // Top node is the quantifier, not the arrow. This is the whole claim.
    expect(greedy.kind).toBe('exists');

    // And that formula is genuinely NOT valid: take R = {(b,a), (b,b)}. Then `a`
    // points at nothing (so the consequent ∀x∃y R is false), yet every element is
    // pointed at by `b` (so no y is left un-pointed-at, and the antecedent fails too).
    expect(isTautology(greedy, r)).toBe(false);
  });

  it('(f) A ⊆ B IS ∀x(x ∈ A → x ∈ B) — the definition of subset', () => {
    expect(
      logicEquivalent(f('A ⊆ B', AB), f('∀ x ( x ∈ A → x ∈ B )', AB), AB),
    ).toEqual({ equal: true });
  });

  it('(f′) …but A ⊆ B is NOT ∀x(x ∈ A ∧ x ∈ B)', () => {
    const theirs = f('A ⊆ B', AB);
    const reference = f('∀ x ( x ∈ A ∧ x ∈ B )', AB);
    expectSeparates(logicEquivalent(theirs, reference, AB), theirs, reference);
  });
});

// ---------------------------------------------------------------------------
// The counterexample is the product; hold it to a high standard.
// ---------------------------------------------------------------------------

describe('the counterexample world', () => {
  it('is the SIMPLEST separating world: smallest domain first', () => {
    // ∀x A(x) vs ⊤ differ already in a 1-element world (A = {}). A grader that
    // searched biggest-first would hand back a 3-element world for the same fact.
    const a = sig(['A']);
    const theirs = f('∀ x A(x)', a);
    const reference = f('⊤', a);

    const model = expectSeparates(logicEquivalent(theirs, reference, a), theirs, reference);
    expect(model.domain).toEqual(['a']);
    expect(model.sets).toEqual({ A: [] });
  });

  it('is deterministic: the same question twice gives the byte-identical world', () => {
    // The UI diffs on these. Two runs must not produce two different worlds.
    const theirs = f('∀ x ( A(x) → B(x) )', AB);
    const reference = f('∀ x ( A(x) ∧ B(x) )', AB);

    const first = logicEquivalent(theirs, reference, AB);
    const second = logicEquivalent(theirs, reference, AB);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('defines exactly the names the formulas use — no more, no less', () => {
    // The puzzle's world is big; this pair of formulas lives in a corner of it.
    // Enumerating the unused names would multiply the work for nothing, so the
    // returned world does not mention them either.
    const big = sig(['A', 'B', 'C', 'D'], ['R', 'S'], ['rex']);
    const theirs = f('∀ x A(x)', big);
    const reference = f('⊤', big);

    const model = expectSeparates(logicEquivalent(theirs, reference, big), theirs, reference);
    expect(Object.keys(model.sets)).toEqual(['A']);
    expect(model.relations).toEqual({});
    expect(model.constants).toEqual({});
  });

  it('scopes to the UNION of both formulas — a set only the LEARNER names is still enumerated', () => {
    // The trap: scoping to the reference's names alone. Here the reference names
    // nothing at all, and every world that separates them turns on B.
    const b = sig(['B']);
    const theirs = f('∀ x ( x ∈ B )', b);
    const reference = f('⊤', b);

    const model = expectSeparates(logicEquivalent(theirs, reference, b), theirs, reference);
    expect(Object.keys(model.sets)).toEqual(['B']);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edges', () => {
  it('handles formulas that name nothing at all (empty scoped signature)', () => {
    // One model per domain size, and it must still be found.
    expect(logicEquivalent(f('∀ x ( x = x )', NAMELESS), f('⊤', NAMELESS), NAMELESS)).toEqual({
      equal: true,
    });
  });

  it('handles the quantifier-free case (constants only, pure propositional logic)', () => {
    const s = sig(['A', 'B'], [], ['rex']);
    // De Morgan, propositional: ¬(p ∧ q) ≡ ¬p ∨ ¬q.
    expect(
      logicEquivalent(f('¬ ( rex ∈ A ∧ rex ∈ B )', s), f('rex ∉ A ∨ rex ∉ B', s), s),
    ).toEqual({ equal: true });
  });

  it('catches the quantifier-free student error ¬(p ∧ q) vs ¬p ∧ ¬q', () => {
    const s = sig(['A', 'B'], [], ['rex']);
    const theirs = f('¬ ( rex ∈ A ∧ rex ∈ B )', s);
    const reference = f('rex ∉ A ∧ rex ∉ B', s);
    expectSeparates(logicEquivalent(theirs, reference, s), theirs, reference);
  });

  it('⊥ is ⊥, and ⊥ is not ⊤', () => {
    expect(logicEquivalent(f('⊥', NAMELESS), f('⊥', NAMELESS), NAMELESS)).toEqual({ equal: true });

    const theirs = f('⊥', NAMELESS);
    const reference = f('⊤', NAMELESS);
    expectSeparates(logicEquivalent(theirs, reference, NAMELESS), theirs, reference);
  });

  it('distinguishes ∃! from ∃ (it takes two things)', () => {
    const a = sig(['A']);
    const theirs = f('∃! x A(x)', a);
    const reference = f('∃ x A(x)', a);

    const model = expectSeparates(logicEquivalent(theirs, reference, a), theirs, reference);
    // In a 1-thing world ∃ and ∃! coincide; the separating world needs two A's.
    expect(model.domain).toHaveLength(2);
    expect(model.sets.A).toEqual(['a', 'b']);
  });

  it('a formula is equivalent to itself, relations and all', () => {
    const r = sig(['A'], ['R'], ['rex']);
    const self = f('∀ x ( A(x) → R(x, rex) )', r);
    expect(logicEquivalent(self, self, r)).toEqual({ equal: true });
  });
});

// ---------------------------------------------------------------------------
// The small-scope hypothesis, executably. These tests PIN THE KNOWN LIMIT.
// ---------------------------------------------------------------------------

describe('the small-scope hypothesis', () => {
  it('at maxDomain 1, ∀x∃y R and ∃y∀x R are WRONGLY reported equal', () => {
    // This is not a bug — it is the documented limit, pinned so that it stays a
    // choice rather than an accident. Widen the scope and the truth appears.
    const r = sig([], ['R']);
    const theirs = f('∀ x ∃ y R(x, y)', r);
    const reference = f('∃ y ∀ x R(x, y)', r);

    expect(logicEquivalent(theirs, reference, r, { maxDomain: 1 })).toEqual({ equal: true });
    expect(logicEquivalent(theirs, reference, r, { maxDomain: 2 }).equal).toBe(false);
  });

  it('at maxDomain 1, "everything is the same thing" is WRONGLY a tautology', () => {
    expect(isTautology(f('∀ x ∀ y ( x = y )', NAMELESS), NAMELESS, 1)).toBe(true);
    expect(isTautology(f('∀ x ∀ y ( x = y )', NAMELESS), NAMELESS)).toBe(false);
  });

  it('the default scope is 3', () => {
    expect(DEFAULT_MAX_DOMAIN).toBe(3);
  });

  it('a relation-free puzzle can afford maxDomain 4 (the recommended upgrade)', () => {
    const many = sig(['A', 'B', 'C']);
    expect(
      logicEquivalent(f('¬ ∀ x ( A(x) ∧ B(x) )', many), f('∃ x ( ¬ A(x) ∨ ¬ B(x) )', many), many, {
        maxDomain: 4,
      }),
    ).toEqual({ equal: true });
  });
});

// ---------------------------------------------------------------------------
// Guards. Every one of these would otherwise be a silent wrong answer or a hang.
// ---------------------------------------------------------------------------

describe('guards', () => {
  it('refuses a search that would blow the model budget, and says how to fix it', () => {
    // Two binary relations over 3 things is 2^18 = 262 144 models — past budget.
    const rs = sig([], ['R', 'S']);
    const theirs = f('∀ x ∀ y ( R(x, y) → S(x, y) )', rs);
    const reference = f('∀ x ∀ y ( S(x, y) → R(x, y) )', rs);

    expect(() => logicEquivalent(theirs, reference, rs)).toThrow(/MAX_MODELS/);
    expect(() => logicEquivalent(theirs, reference, rs)).toThrow(/Shrink the signature/);
    // ...but it is affordable in smaller worlds, so the advice is actionable.
    expect(() => logicEquivalent(theirs, reference, rs, { maxDomain: 2 })).not.toThrow();
  });

  it('scoping is what keeps a big signature affordable', () => {
    // Declared: 4 sets and 2 relations — unscoped that is far past MAX_MODELS.
    // Used: one set. The guard must see the scoped world, not the declared one.
    const big = sig(['A', 'B', 'C', 'D'], ['R', 'S'], ['rex']);
    expect(() => logicEquivalent(f('∀ x A(x)', big), f('⊤', big), big)).not.toThrow();
  });

  it('MAX_MODELS is a real budget, not a formality', () => {
    expect(MAX_MODELS).toBeGreaterThan(0);
  });

  it('refuses maxDomain 0 — an empty search would mark EVERY answer correct', () => {
    // The most dangerous bug this module could have. It is a hard error, not a clamp.
    const a = sig(['A']);
    expect(() => logicEquivalent(f('∀ x A(x)', a), f('⊥', a), a, { maxDomain: 0 })).toThrow(
      /mark every answer correct/,
    );
  });

  it('refuses a maxDomain wider than the element names we have', () => {
    const a = sig(['A']);
    expect(() => logicEquivalent(f('∀ x A(x)', a), f('⊤', a), a, { maxDomain: 5 })).toThrow(
      /MAX_DOMAIN_SIZE/,
    );
  });

  it('refuses a non-integer maxDomain', () => {
    const a = sig(['A']);
    expect(() => logicEquivalent(f('∀ x A(x)', a), f('⊤', a), a, { maxDomain: 2.5 })).toThrow(
      /whole number/,
    );
  });

  it('refuses an OPEN formula, naming the loose variable — the forgotten-quantifier case', () => {
    // A child who writes `A(x) → B(x)` with no ∀ has written something that has no
    // truth value in a world at all. We cannot mark it right or wrong; we must say
    // what is missing. The UI is expected to catch this and show it as a hint.
    const openFormula = f('A(x) → B(x)', AB);
    const closed = f('∀ x ( A(x) → B(x) )', AB);

    expect(() => logicEquivalent(openFormula, closed, AB)).toThrow(/free variable/);
    expect(() => logicEquivalent(openFormula, closed, AB)).toThrow(/x/);
    expect(() => logicEquivalent(openFormula, closed, AB)).toThrow(/Your sentence/);
    // ...and it points the finger at the right formula when the REFERENCE is the broken one.
    expect(() => logicEquivalent(closed, openFormula, AB)).toThrow(/The reference sentence/);
  });

  it('refuses a formula naming something the signature never declared', () => {
    // Only reachable from a hand-built AST (the parser calls unknown identifiers
    // variables) — i.e. from a puzzle author's typo, which is exactly who needs telling.
    const typo: Formula = { kind: 'member', term: { kind: 'var', name: 'x' }, set: { kind: 'set', name: 'Redd' } };
    const reference = f('∀ x A(x)', sig(['A']));
    const closedTypo: Formula = { kind: 'forall', varName: 'x', body: typo };

    expect(() => logicEquivalent(closedTypo, reference, sig(['A']))).toThrow(/does not declare/);
    expect(() => logicEquivalent(closedTypo, reference, sig(['A']))).toThrow(/Redd/);
  });
});

// ---------------------------------------------------------------------------
// satisfiable / isTautology
// ---------------------------------------------------------------------------

describe('satisfiable', () => {
  it('finds the simplest world that makes a formula true', () => {
    const a = sig(['A']);
    const formula = f('∃ x A(x)', a);

    const model = satisfiable(formula, a);
    expect(model).not.toBeNull();
    // Not just "a model" — a model in which the formula is actually TRUE.
    expect(evaluate(formula, model as Model)).toBe(true);
    expect((model as Model).domain).toEqual(['a']);
    expect((model as Model).sets).toEqual({ A: ['a'] });
  });

  it('returns null for a contradiction', () => {
    const a = sig(['A']);
    expect(satisfiable(f('∃ x ( A(x) ∧ ¬ A(x) )', a), a)).toBeNull();
    expect(satisfiable(f('⊥', NAMELESS), NAMELESS)).toBeNull();
  });

  it('finds a world for a formula needing two things', () => {
    const a = sig(['A']);
    const formula = f('∃ x ∃ y ( ¬ ( x = y ) ∧ A(x) ∧ A(y) )', a);

    const model = satisfiable(formula, a);
    expect(model).not.toBeNull();
    expect(evaluate(formula, model as Model)).toBe(true);
    expect((model as Model).domain).toHaveLength(2);
  });

  it('inherits the guards', () => {
    const a = sig(['A']);
    expect(() => satisfiable(f('∀ x A(x)', a), a, 0)).toThrow(/mark every answer correct/);
  });
});

describe('isTautology', () => {
  it('accepts the law of excluded middle', () => {
    const a = sig(['A']);
    expect(isTautology(f('∀ x ( A(x) ∨ ¬ A(x) )', a), a)).toBe(true);
  });

  it('accepts ⊤ and rejects ⊥', () => {
    expect(isTautology(f('⊤', NAMELESS), NAMELESS)).toBe(true);
    expect(isTautology(f('⊥', NAMELESS), NAMELESS)).toBe(false);
  });

  it('rejects a merely-satisfiable formula', () => {
    const a = sig(['A']);
    expect(isTautology(f('∀ x A(x)', a), a)).toBe(false);
    // ...which is precisely the difference between the two functions.
    expect(satisfiable(f('∀ x A(x)', a), a)).not.toBeNull();
  });

  it('accepts A ∩ B ⊆ A and rejects A ⊆ A ∩ B', () => {
    expect(isTautology(f('A ∩ B ⊆ A', AB), AB)).toBe(true);
    expect(isTautology(f('A ⊆ A ∩ B', AB), AB)).toBe(false);
  });

  it('accepts ∅ ⊆ A and A ⊆ 𝕌', () => {
    const a = sig(['A']);
    expect(isTautology(f('∅ ⊆ A', a), a)).toBe(true);
    expect(isTautology(f('A ⊆ 𝕌', a), a)).toBe(true);
  });
});
