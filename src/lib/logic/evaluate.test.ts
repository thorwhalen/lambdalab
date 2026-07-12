/**
 * Tests for the Tarskian evaluator.
 *
 * These test the MATHEMATICS, not the plumbing. Each block is something a
 * learner can get wrong (or be surprised by) and that the engine must therefore
 * get exactly right: vacuous truth, the ∃-with-→ surprise, De Morgan, quantifier
 * order, shadowing, and the empty/singleton edges.
 *
 * ASTs are hand-built rather than parsed — evaluate.ts must be correct
 * independently of parse.ts, and a hand-built AST is precisely the case in which
 * the "unbound variable" and "unknown set" errors have to fire.
 */

import { describe, expect, it } from 'vitest';
import { evalSet, evaluate, freeVars, isClosed } from './evaluate';
import type { Formula, Model, SetExpr, Term } from './types';

// --- AST constructors (terse, so the tests read like logic) -----------------

const v = (name: string): Term => ({ kind: 'var', name });
const k = (name: string): Term => ({ kind: 'const', name });

const S = (name: string): SetExpr => ({ kind: 'set', name });
const UNIV: SetExpr = { kind: 'universe' };
const EMPTY: SetExpr = { kind: 'emptyset' };
const cup = (left: SetExpr, right: SetExpr): SetExpr => ({ kind: 'union', left, right });
const cap = (left: SetExpr, right: SetExpr): SetExpr => ({ kind: 'inter', left, right });
const minus = (left: SetExpr, right: SetExpr): SetExpr => ({ kind: 'diff', left, right });
const compl = (inner: SetExpr): SetExpr => ({ kind: 'compl', inner });
const build = (varName: string, body: Formula): SetExpr => ({ kind: 'builder', varName, body });

const mem = (term: Term, set: SetExpr): Formula => ({ kind: 'member', term, set });
/** Dog(x) is sugar for x ∈ Dog — same node, per types.ts. */
const P = (setName: string, term: Term): Formula => mem(term, S(setName));
const sub = (left: SetExpr, right: SetExpr): Formula => ({ kind: 'subset', left, right });
const seteq = (left: SetExpr, right: SetExpr): Formula => ({ kind: 'seteq', left, right });
const eq = (left: Term, right: Term): Formula => ({ kind: 'eq', left, right });
const R = (name: string, left: Term, right: Term): Formula => ({ kind: 'rel', name, left, right });
const not = (inner: Formula): Formula => ({ kind: 'not', inner });
const and = (left: Formula, right: Formula): Formula => ({ kind: 'and', left, right });
const or = (left: Formula, right: Formula): Formula => ({ kind: 'or', left, right });
const imp = (left: Formula, right: Formula): Formula => ({ kind: 'implies', left, right });
const iff = (left: Formula, right: Formula): Formula => ({ kind: 'iff', left, right });
const all = (varName: string, body: Formula): Formula => ({ kind: 'forall', varName, body });
const ex = (varName: string, body: Formula): Formula => ({ kind: 'exists', varName, body });
const exu = (varName: string, body: Formula): Formula => ({ kind: 'existsUnique', varName, body });
const TRUE: Formula = { kind: 'true' };
const FALSE: Formula = { kind: 'false' };

const model = (
  domain: string[],
  sets: Record<string, string[]> = {},
  relations: Record<string, Array<[string, string]>> = {},
  constants: Record<string, string> = {},
): Model => ({ domain, sets, relations, constants });

/** Sets are compared as sorted arrays: order is part of the contract. */
const els = (s: Set<string>): string[] => [...s];

// ---------------------------------------------------------------------------

describe('evalSet', () => {
  const m = model(['a', 'b', 'c'], { A: ['a', 'b'], B: ['b', 'c'], Nil: [], All: ['a', 'b', 'c'] });

  it('reads a named set, the universe and the empty set', () => {
    expect(els(evalSet(S('A'), m))).toEqual(['a', 'b']);
    expect(els(evalSet(UNIV, m))).toEqual(['a', 'b', 'c']);
    expect(els(evalSet(EMPTY, m))).toEqual([]);
    expect(els(evalSet(S('Nil'), m))).toEqual([]);
  });

  it('computes union, intersection and difference', () => {
    expect(els(evalSet(cup(S('A'), S('B')), m))).toEqual(['a', 'b', 'c']);
    expect(els(evalSet(cap(S('A'), S('B')), m))).toEqual(['b']);
    expect(els(evalSet(minus(S('A'), S('B')), m))).toEqual(['a']);
    expect(els(evalSet(minus(S('B'), S('A')), m))).toEqual(['c']); // ∖ is not symmetric
  });

  it('takes the complement relative to the DOMAIN, not some absolute universe', () => {
    expect(els(evalSet(compl(S('A')), m))).toEqual(['c']);
    expect(els(evalSet(compl(S('All')), m))).toEqual([]);
    expect(els(evalSet(compl(S('Nil')), m))).toEqual(['a', 'b', 'c']);
    expect(els(evalSet(compl(compl(S('A'))), m))).toEqual(['a', 'b']); // involution
    expect(els(evalSet(compl(EMPTY), m))).toEqual(['a', 'b', 'c']);
    expect(els(evalSet(compl(UNIV), m))).toEqual([]);
  });

  it('nests set expressions', () => {
    // (A ∪ B) ∖ (A ∩ B) — symmetric difference, the classic composite.
    expect(els(evalSet(minus(cup(S('A'), S('B')), cap(S('A'), S('B'))), m))).toEqual(['a', 'c']);
    // (Aᶜ ∪ Bᶜ)ᶜ  ==  A ∩ B
    expect(els(evalSet(compl(cup(compl(S('A')), compl(S('B')))), m))).toEqual(['b']);
  });

  it('satisfies De Morgan on this model', () => {
    expect(els(evalSet(compl(cup(S('A'), S('B'))), m))).toEqual(
      els(evalSet(cap(compl(S('A')), compl(S('B'))), m)),
    );
    expect(els(evalSet(compl(cap(S('A'), S('B'))), m))).toEqual(
      els(evalSet(cup(compl(S('A')), compl(S('B'))), m)),
    );
    // ...and the second one is non-trivially {a, c}, not an accident of both being empty.
    expect(els(evalSet(cup(compl(S('A')), compl(S('B'))), m))).toEqual(['a', 'c']);
  });

  it('rewrites A ∖ B as A ∩ Bᶜ', () => {
    expect(els(evalSet(minus(S('A'), S('B')), m))).toEqual(
      els(evalSet(cap(S('A'), compl(S('B'))), m)),
    );
  });

  describe('set-builder', () => {
    it('binds its variable over the domain', () => {
      // {x | A(x) ∧ B(x)}  ==  A ∩ B
      expect(els(evalSet(build('x', and(P('A', v('x')), P('B', v('x')))), m))).toEqual(['b']);
      expect(els(evalSet(build('x', TRUE), m))).toEqual(['a', 'b', 'c']);
      expect(els(evalSet(build('x', FALSE), m))).toEqual([]);
    });

    it('can reference the OUTER assignment', () => {
      // {y | Likes(x, y)} — the set of things x likes. Depends on x.
      const likes = model(['a', 'b', 'c'], {}, { Likes: [['a', 'b'], ['a', 'c'], ['b', 'a']] });
      const likedBy = (x: string) => els(evalSet(build('y', R('Likes', v('x'), v('y'))), likes, { x }));
      expect(likedBy('a')).toEqual(['b', 'c']);
      expect(likedBy('b')).toEqual(['a']);
      expect(likedBy('c')).toEqual([]);
    });

    it("shadows an outer binding of the same name", () => {
      // In {x | A(x)} the inner x is the builder's, so the outer x = 'c' is irrelevant.
      expect(els(evalSet(build('x', P('A', v('x'))), m, { x: 'c' }))).toEqual(['a', 'b']);
    });

    it('composes with other set operations', () => {
      const evens = build('x', P('A', v('x')));
      expect(els(evalSet(compl(evens), m))).toEqual(['c']);
      expect(els(evalSet(cap(evens, S('B')), m))).toEqual(['b']);
    });
  });

  it('returns sets in canonical (sorted) order however the model was written', () => {
    // Two runs must produce identical output; so must two spellings of one set.
    const scrambled = model(['c', 'a', 'b'], { A: ['c', 'a'], B: ['a'] });
    expect(els(evalSet(S('A'), scrambled))).toEqual(['a', 'c']);
    expect(els(evalSet(UNIV, scrambled))).toEqual(['a', 'b', 'c']);
    // Aᶜ ∩ B and B ∖ A denote the same set and must ITERATE the same way.
    expect(els(evalSet(cap(compl(S('A')), S('B')), scrambled))).toEqual(
      els(evalSet(minus(S('B'), S('A')), scrambled)),
    );
  });
});

describe('evaluate: atoms', () => {
  const m = model(
    ['a', 'b', 'c'],
    { Dog: ['a', 'b'], Red: ['b', 'c'] },
    { Likes: [['a', 'b'], ['b', 'b']] },
    { rex: 'a', fido: 'b' },
  );

  it('reads membership, in both spellings (x ∈ Dog and Dog(x))', () => {
    expect(evaluate(mem(k('rex'), S('Dog')), m)).toBe(true);
    expect(evaluate(P('Dog', k('rex')), m)).toBe(true);
    expect(evaluate(P('Red', k('rex')), m)).toBe(false);
    expect(evaluate(P('Dog', v('x')), m, { x: 'c' })).toBe(false);
  });

  it('reads a binary relation, respecting the order of the pair', () => {
    expect(evaluate(R('Likes', k('rex'), k('fido')), m)).toBe(true);
    expect(evaluate(R('Likes', k('fido'), k('rex')), m)).toBe(false); // not symmetric
    expect(evaluate(R('Likes', k('fido'), k('fido')), m)).toBe(true); // reflexive at b only
  });

  it('reads equality between individuals', () => {
    expect(evaluate(eq(k('rex'), k('rex')), m)).toBe(true);
    expect(evaluate(eq(k('rex'), k('fido')), m)).toBe(false);
    expect(evaluate(eq(v('x'), k('rex')), m, { x: 'a' })).toBe(true);
    expect(evaluate(eq(v('x'), v('y')), m, { x: 'a', y: 'b' })).toBe(false);
  });

  it('reads ⊆ and set equality', () => {
    expect(evaluate(sub(EMPTY, S('Dog')), m)).toBe(true); // ∅ ⊆ everything
    expect(evaluate(sub(S('Dog'), UNIV), m)).toBe(true);
    expect(evaluate(sub(S('Dog'), S('Dog')), m)).toBe(true); // ⊆ is not ⊊
    expect(evaluate(sub(S('Dog'), S('Red')), m)).toBe(false); // a is a Dog but not Red
    expect(evaluate(sub(cap(S('Dog'), S('Red')), S('Dog')), m)).toBe(true);

    expect(evaluate(seteq(S('Dog'), S('Dog')), m)).toBe(true);
    expect(evaluate(seteq(S('Dog'), S('Red')), m)).toBe(false);
    expect(evaluate(seteq(compl(UNIV), EMPTY), m)).toBe(true);
    expect(evaluate(seteq(cup(S('Dog'), compl(S('Dog'))), UNIV), m)).toBe(true);
  });

  it('has ⊤ and ⊥', () => {
    expect(evaluate(TRUE, m)).toBe(true);
    expect(evaluate(FALSE, m)).toBe(false);
  });
});

describe('evaluate: connectives', () => {
  // A one-element domain is enough for a truth table; ⊤/⊥ supply the atoms.
  const m = model(['a']);
  const table: Array<[Formula, Formula]> = [
    [TRUE, TRUE],
    [TRUE, FALSE],
    [FALSE, TRUE],
    [FALSE, FALSE],
  ];
  const truths = (make: (p: Formula, q: Formula) => Formula): boolean[] =>
    table.map(([p, q]) => evaluate(make(p, q), m));

  it('¬', () => {
    expect(evaluate(not(TRUE), m)).toBe(false);
    expect(evaluate(not(FALSE), m)).toBe(true);
  });

  it('∧, ∨, ↔', () => {
    expect(truths(and)).toEqual([true, false, false, false]);
    expect(truths(or)).toEqual([true, true, true, false]);
    expect(truths(iff)).toEqual([true, false, false, true]);
  });

  it('→ is MATERIAL implication: only T→F is false', () => {
    expect(truths(imp)).toEqual([true, false, true, true]);
    // ...which is exactly ¬p ∨ q.
    expect(truths(imp)).toEqual(truths((p, q) => or(not(p), q)));
  });
});

describe('vacuous truth', () => {
  // A world with two things and no unicorns at all.
  const noUnicorns = model(['a', 'b'], { Unicorn: [], Pink: ['a'] });

  it('"every unicorn is pink" is TRUE when there are no unicorns', () => {
    // This is the FEATURE, not a bug: ∀x (U(x) → P(x)) is vacuously true.
    expect(evaluate(all('x', imp(P('Unicorn', v('x')), P('Pink', v('x')))), noUnicorns)).toBe(true);
    // And so is "every unicorn is NOT pink", simultaneously — the lesson's punchline.
    expect(evaluate(all('x', imp(P('Unicorn', v('x')), not(P('Pink', v('x'))))), noUnicorns)).toBe(
      true,
    );
  });

  it('"some unicorn is pink" is FALSE when there are no unicorns', () => {
    // ∧, unlike →, is not vacuously satisfied. This is why ∀ pairs with → and ∃ with ∧,
    // and why a gloss must never treat the two the same way.
    expect(evaluate(ex('x', and(P('Unicorn', v('x')), P('Pink', v('x')))), noUnicorns)).toBe(false);
  });

  it('THE CLASSIC SURPRISE: ∃x (U(x) → P(x)) is TRUE when there are no unicorns', () => {
    // Pick any x at all; it is not a unicorn, so U(x) is false, so U(x) → P(x) is
    // vacuously true, so a witness exists. The formula says "there is something
    // which, IF it is a unicorn, is pink" — a near-tautology, and almost never what
    // a learner means. The grader must call this out, so it must first evaluate it right.
    expect(evaluate(ex('x', imp(P('Unicorn', v('x')), P('Pink', v('x')))), noUnicorns)).toBe(true);

    // It is even true when nothing is pink either — the implication carries it alone.
    const nothingPink = model(['a', 'b'], { Unicorn: [], Pink: [] });
    expect(evaluate(ex('x', imp(P('Unicorn', v('x')), P('Pink', v('x')))), nothingPink)).toBe(true);
    // In fact ∃x(U(x) → P(x)) is false ONLY when everything is a non-pink unicorn.
    const allUnpinkUnicorns = model(['a', 'b'], { Unicorn: ['a', 'b'], Pink: [] });
    expect(evaluate(ex('x', imp(P('Unicorn', v('x')), P('Pink', v('x')))), allUnpinkUnicorns)).toBe(
      false,
    );
  });

  it('distinguishes ∀x(A(x) → B(x)) from ∀x(A(x) ∧ B(x))', () => {
    // "every dog is red" vs "everything is a red dog" — the single most common
    // student error, and they must not collapse.
    const m = model(['a', 'b'], { Dog: ['a'], Red: ['a'] });
    expect(evaluate(all('x', imp(P('Dog', v('x')), P('Red', v('x')))), m)).toBe(true);
    expect(evaluate(all('x', and(P('Dog', v('x')), P('Red', v('x')))), m)).toBe(false);
  });
});

describe('De Morgan for quantifiers', () => {
  // ¬∀x φ ≡ ∃x ¬φ  and  ¬∃x φ ≡ ∀x ¬φ, checked where each side is non-trivial.
  const partial = model(['a', 'b', 'c'], { Red: ['a', 'b'] });
  const total = model(['a', 'b', 'c'], { Red: ['a', 'b', 'c'] });
  const none = model(['a', 'b', 'c'], { Red: [] });

  const red = (x: string) => P('Red', v(x));

  it('¬∀ ≡ ∃¬', () => {
    for (const m of [partial, total, none]) {
      expect(evaluate(not(all('x', red('x'))), m)).toBe(evaluate(ex('x', not(red('x'))), m));
    }
    expect(evaluate(not(all('x', red('x'))), partial)).toBe(true); // c is not red
    expect(evaluate(not(all('x', red('x'))), total)).toBe(false);
  });

  it('¬∃ ≡ ∀¬', () => {
    for (const m of [partial, total, none]) {
      expect(evaluate(not(ex('x', red('x'))), m)).toBe(evaluate(all('x', not(red('x'))), m));
    }
    expect(evaluate(not(ex('x', red('x'))), none)).toBe(true);
    expect(evaluate(not(ex('x', red('x'))), partial)).toBe(false);
  });
});

describe('quantifier order', () => {
  /**
   * "everybody likes somebody" (∀x∃y) vs "somebody is liked by everybody" (∃y∀x).
   * ∃y∀x ⊨ ∀x∃y but NOT conversely, and this model is the counterexample: a and b
   * like each other, so everyone likes someone, but nobody is universally liked.
   */
  const m = model(['a', 'b'], {}, { Likes: [['a', 'b'], ['b', 'a']] });
  const everyoneLikesSomeone = all('x', ex('y', R('Likes', v('x'), v('y'))));
  const someoneIsLikedByEveryone = ex('y', all('x', R('Likes', v('x'), v('y'))));

  it('∀x∃y and ∃y∀x differ — swapping quantifiers changes the meaning', () => {
    expect(evaluate(everyoneLikesSomeone, m)).toBe(true);
    expect(evaluate(someoneIsLikedByEveryone, m)).toBe(false);
  });

  it('∃y∀x implies ∀x∃y (the direction that DOES hold)', () => {
    // Add a universally-loved element and the strong form becomes true too.
    const loved = model(['a', 'b'], {}, { Likes: [['a', 'b'], ['b', 'b']] });
    expect(evaluate(someoneIsLikedByEveryone, loved)).toBe(true);
    expect(evaluate(everyoneLikesSomeone, loved)).toBe(true);
  });

  it('collapses on a one-element domain (which is why maxDomain must exceed 1)', () => {
    const solo = model(['a'], {}, { Likes: [['a', 'a']] });
    expect(evaluate(everyoneLikesSomeone, solo)).toBe(evaluate(someoneIsLikedByEveryone, solo));
    const lonely = model(['a'], {}, { Likes: [] });
    expect(evaluate(everyoneLikesSomeone, lonely)).toBe(evaluate(someoneIsLikedByEveryone, lonely));
  });
});

describe('quantifiers', () => {
  it('a nested quantifier of the same name shadows the outer one', () => {
    // ∀x ∃x A(x): the inner x rebinds, so the outer ∀ is vacuous — the whole thing
    // is just ∃x A(x).
    const m = model(['a', 'b'], { A: ['a'] });
    expect(evaluate(all('x', ex('x', P('A', v('x')))), m)).toBe(true);
    const emptyA = model(['a', 'b'], { A: [] });
    expect(evaluate(all('x', ex('x', P('A', v('x')))), emptyA)).toBe(false);
  });

  it('an outer assignment is shadowed by a quantifier binding the same variable', () => {
    const m = model(['a', 'b'], { A: ['a'] });
    // x = 'b' in env, but ∀x rebinds it, so the env value must not leak in.
    expect(evaluate(all('x', P('A', v('x'))), m, { x: 'b' })).toBe(false);
    expect(evaluate(ex('x', P('A', v('x'))), m, { x: 'b' })).toBe(true);
  });

  it('a quantifier body can still see free outer variables', () => {
    const m = model(['a', 'b'], {}, { Likes: [['a', 'b']] });
    expect(evaluate(ex('y', R('Likes', v('x'), v('y'))), m, { x: 'a' })).toBe(true);
    expect(evaluate(ex('y', R('Likes', v('x'), v('y'))), m, { x: 'b' })).toBe(false);
  });

  it('works on a single-element domain', () => {
    const m = model(['a'], { A: ['a'], Nil: [] });
    expect(evaluate(all('x', P('A', v('x'))), m)).toBe(true);
    expect(evaluate(ex('x', P('A', v('x'))), m)).toBe(true);
    expect(evaluate(all('x', P('Nil', v('x'))), m)).toBe(false);
    expect(evaluate(ex('x', P('Nil', v('x'))), m)).toBe(false);
    // Everything is identical to everything else when there is only one thing.
    expect(evaluate(all('x', all('y', eq(v('x'), v('y')))), m)).toBe(true);
  });
});

describe('∃! (exactly one)', () => {
  const domain = ['a', 'b', 'c'];
  const witnesses = (members: string[]) => model(domain, { A: members });

  it('is false with no witness, true with one, false with two', () => {
    expect(evaluate(exu('x', P('A', v('x'))), witnesses([]))).toBe(false);
    expect(evaluate(exu('x', P('A', v('x'))), witnesses(['b']))).toBe(true);
    expect(evaluate(exu('x', P('A', v('x'))), witnesses(['a', 'c']))).toBe(false);
    expect(evaluate(exu('x', P('A', v('x'))), witnesses(['a', 'b', 'c']))).toBe(false);
  });

  it('agrees with its ∃/∀ definition: ∃x(φ ∧ ∀y(φ[y] → y = x))', () => {
    const spelledOut = ex(
      'x',
      and(P('A', v('x')), all('y', imp(P('A', v('y')), eq(v('y'), v('x'))))),
    );
    for (const members of [[], ['b'], ['a', 'c'], ['a', 'b', 'c']]) {
      const m = witnesses(members);
      expect(evaluate(exu('x', P('A', v('x'))), m)).toBe(evaluate(spelledOut, m));
    }
  });

  it('sees free outer variables in its body', () => {
    // "x likes exactly one thing"
    const m = model(['a', 'b', 'c'], {}, { Likes: [['a', 'b'], ['c', 'a'], ['c', 'b']] });
    const likesExactlyOne = exu('y', R('Likes', v('x'), v('y')));
    expect(evaluate(likesExactlyOne, m, { x: 'a' })).toBe(true);
    expect(evaluate(likesExactlyOne, m, { x: 'b' })).toBe(false); // likes nothing
    expect(evaluate(likesExactlyOne, m, { x: 'c' })).toBe(false); // likes two things
  });
});

describe('errors (never a silent false)', () => {
  const m = model(['a', 'b'], { A: ['a'] }, { Likes: [] }, { rex: 'a' });

  it('throws, naming the variable, on an unbound variable', () => {
    expect(() => evaluate(P('A', v('x')), m)).toThrow(/Unbound variable 'x'/);
    // Free in the body of a quantifier that binds a DIFFERENT variable.
    expect(() => evaluate(all('y', R('Likes', v('x'), v('y'))), m)).toThrow(
      /Unbound variable 'x'/,
    );
    // Free inside a set-builder body.
    expect(() => evaluate(mem(k('rex'), build('y', R('Likes', v('x'), v('y')))), m)).toThrow(
      /Unbound variable 'x'/,
    );
  });

  it('is not fooled by variable names that collide with Object.prototype', () => {
    // A bare `env[name]` lookup would resolve 'constructor' to Object's constructor.
    expect(() => evaluate(P('A', v('constructor')), m)).toThrow(/Unbound variable 'constructor'/);
    expect(() => evaluate(P('toString', v('x')), m, { x: 'a' })).toThrow(/Unknown set 'toString'/);
  });

  it('throws, naming it, on a set/relation/constant the model does not define', () => {
    expect(() => evaluate(P('Cat', k('rex')), m)).toThrow(/Unknown set 'Cat'/);
    expect(() => evaluate(R('Hates', k('rex'), k('rex')), m)).toThrow(/Unknown relation 'Hates'/);
    expect(() => evaluate(P('A', k('fido')), m)).toThrow(/Unknown constant 'fido'/);
    // The message lists what the model DOES define, so the puzzle author can see the typo.
    expect(() => evaluate(P('Cat', k('rex')), m)).toThrow(/model defines: A/);
  });

  it('rejects an empty domain', () => {
    expect(() => evaluate(TRUE, model([]))).toThrow(/empty domain/);
    expect(() => evalSet(UNIV, model([]))).toThrow(/empty domain/);
  });

  it('rejects a domain with duplicate elements (∃! would miscount)', () => {
    expect(() => evaluate(TRUE, model(['a', 'a']))).toThrow(/duplicate element 'a'/);
  });

  it('rejects a model whose set, relation, constant or assignment escapes the domain', () => {
    expect(() => evaluate(P('A', k('rex')), model(['a'], { A: ['a', 'zz'] }, {}, { rex: 'a' }))).toThrow(
      /not in the model's domain/,
    );
    expect(() =>
      evaluate(R('Likes', k('rex'), k('rex')), model(['a'], {}, { Likes: [['a', 'zz']] }, { rex: 'a' })),
    ).toThrow(/not in the model's domain/);
    expect(() => evaluate(P('A', k('rex')), model(['a'], { A: [] }, {}, { rex: 'zz' }))).toThrow(
      /not in the model's domain/,
    );
    expect(() => evaluate(P('A', v('x')), model(['a'], { A: [] }), { x: 'zz' })).toThrow(
      /not in the model's domain/,
    );
  });
});

describe('freeVars / isClosed', () => {
  it('finds nothing in a sentence', () => {
    const f = all('x', imp(P('Dog', v('x')), P('Red', v('x'))));
    expect([...freeVars(f)]).toEqual([]);
    expect(isClosed(f)).toBe(true);
    expect(isClosed(TRUE)).toBe(true);
    expect(isClosed(eq(k('rex'), k('fido')))).toBe(true); // constants are not variables
  });

  it('finds a variable left free by a quantifier over another name', () => {
    const f = and(P('A', v('x')), ex('y', R('Likes', v('x'), v('y'))));
    expect([...freeVars(f)]).toEqual(['x']);
    expect(isClosed(f)).toBe(false);
  });

  it('returns variables in sorted order (not discovery order)', () => {
    const f = and(R('Likes', v('z'), v('y')), P('A', v('x')));
    expect([...freeVars(f)]).toEqual(['x', 'y', 'z']);
  });

  it('treats a shadowed variable as bound', () => {
    expect([...freeVars(all('x', ex('x', P('A', v('x')))))]).toEqual([]);
  });

  it('looks inside set expressions — a builder body can carry free variables', () => {
    // x ∈ {y | Likes(x, y)}: the builder binds y, but x is free (twice over).
    const f = mem(v('x'), build('y', R('Likes', v('x'), v('y'))));
    expect([...freeVars(f)]).toEqual(['x']);
    expect(isClosed(f)).toBe(false);
    // Quantify it and it closes.
    expect(isClosed(all('x', f))).toBe(true);
  });

  it('handles a builder that shadows the term beside it', () => {
    // x ∈ {x | A(x)} — the TERM x is free; the builder's x is a different, bound x.
    const f = mem(v('x'), build('x', P('A', v('x'))));
    expect([...freeVars(f)]).toEqual(['x']);
  });

  it('looks inside ⊆ and = between set expressions', () => {
    const f = sub(build('y', R('Likes', v('x'), v('y'))), S('A'));
    expect([...freeVars(f)]).toEqual(['x']);
    expect([...freeVars(seteq(compl(build('y', P('A', v('y')))), S('B')))]).toEqual([]);
  });

  it('agrees with evaluate: a closed formula never needs an assignment', () => {
    const m = model(['a', 'b'], { A: ['a'] }, { Likes: [['a', 'b']] });
    const closed = all('x', ex('y', or(P('A', v('x')), R('Likes', v('y'), v('x')))));
    expect(isClosed(closed)).toBe(true);
    expect(() => evaluate(closed, m)).not.toThrow();
  });
});
