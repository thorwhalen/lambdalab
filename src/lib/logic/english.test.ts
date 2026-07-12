/**
 * Tests for the English glosser.
 *
 * Two kinds of assertion, and the second is the one that matters:
 *
 *  1. A table of formulas -> exact expected glosses. Pins the idioms, the fallbacks,
 *     and the order-sensitive shapes.
 *
 *  2. The injectivity property, checked MECHANICALLY rather than by inspection: for
 *     every pair in that table that shares a gloss, the two formulas must be
 *     logically equivalent. The oracle is exhaustive model checking (every model over
 *     domains 1..3, every assignment of the free variables), built here out of
 *     `enumerateModels` and `evaluate` — equivalence.ts does not exist yet, and this
 *     test must not wait for it.
 *
 * Formulas are written in surface syntax and parsed, because a table of hand-built
 * ASTs is a table nobody can read, and the sugar (`Dog(x)`, `∉`, `≠`) is exactly what
 * the glosser has to cope with.
 */

import { describe, expect, it } from 'vitest';
import { gloss } from './english';
import type { Nouns } from './english';
import { parseFormula } from './parse';
import { evaluate, freeVars } from './evaluate';
import { enumerateModels, modelCount } from './models';
import type { Assignment, Formula, Signature, Term } from './types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SIG: Signature = {
  sets: ['Dog', 'Red', 'Cat'],
  relations: ['Likes'],
  constants: ['rex'],
};

const NOUNS: Nouns = {
  Dog: { singular: 'dog', plural: 'dogs' },
  Red: { singular: 'red', plural: 'reds' },
  Cat: { singular: 'cat', plural: 'cats' },
};

/** Domains 1..3: the small-scope budget the whole engine works in. */
const MAX_DOMAIN = 3;

/** A pathological pair would enumerate forever; fail loudly instead of hanging. */
const MAX_MODELS = 2_000_000;

function parse(src: string, sig: Signature = SIG): Formula {
  const r = parseFormula(src, sig);
  if (!r.ok) throw new Error(`test fixture does not parse: ${src}\n  -> ${r.message}`);
  return r.formula;
}

const say = (src: string, nouns: Nouns = NOUNS): string => gloss(parse(src), SIG, nouns);

// ---------------------------------------------------------------------------
// Equivalence oracle
// ---------------------------------------------------------------------------

function _symbolsOfTerm(t: Term, sig: { constants: Set<string> }): void {
  if (t.kind === 'const') sig.constants.add(t.name);
}

function _symbolsOfSet(s: import('./types').SetExpr, acc: Acc): void {
  switch (s.kind) {
    case 'set':
      acc.sets.add(s.name);
      return;
    case 'union':
    case 'inter':
    case 'diff':
      _symbolsOfSet(s.left, acc);
      _symbolsOfSet(s.right, acc);
      return;
    case 'compl':
      _symbolsOfSet(s.inner, acc);
      return;
    case 'builder':
      _symbolsOfFormula(s.body, acc);
      return;
    case 'universe':
    case 'emptyset':
      return;
  }
}

interface Acc {
  sets: Set<string>;
  relations: Set<string>;
  constants: Set<string>;
}

function _symbolsOfFormula(f: Formula, acc: Acc): void {
  switch (f.kind) {
    case 'member':
      _symbolsOfTerm(f.term, acc);
      _symbolsOfSet(f.set, acc);
      return;
    case 'subset':
    case 'seteq':
      _symbolsOfSet(f.left, acc);
      _symbolsOfSet(f.right, acc);
      return;
    case 'eq':
      _symbolsOfTerm(f.left, acc);
      _symbolsOfTerm(f.right, acc);
      return;
    case 'rel':
      acc.relations.add(f.name);
      _symbolsOfTerm(f.left, acc);
      _symbolsOfTerm(f.right, acc);
      return;
    case 'not':
      _symbolsOfFormula(f.inner, acc);
      return;
    case 'and':
    case 'or':
    case 'implies':
    case 'iff':
      _symbolsOfFormula(f.left, acc);
      _symbolsOfFormula(f.right, acc);
      return;
    case 'forall':
    case 'exists':
    case 'existsUnique':
      _symbolsOfFormula(f.body, acc);
      return;
    case 'true':
    case 'false':
      return;
  }
}

/**
 * Only the symbols the two formulas actually mention. Adding a symbol neither one
 * names cannot change whether they agree, so this is sound — and it keeps the model
 * count small enough that the whole 1..3 sweep is exhaustive AND fast.
 */
function _sharedSignature(f: Formula, g: Formula): Signature {
  const acc: Acc = { sets: new Set(), relations: new Set(), constants: new Set() };
  _symbolsOfFormula(f, acc);
  _symbolsOfFormula(g, acc);
  return {
    sets: [...acc.sets].sort(),
    relations: [...acc.relations].sort(),
    constants: [...acc.constants].sort(),
  };
}

/** Every mapping of `vars` into `domain`. Open formulas need this; sentences get [{}]. */
function _assignments(vars: readonly string[], domain: readonly string[]): Assignment[] {
  let out: Assignment[] = [{}];
  for (const v of vars) {
    const next: Assignment[] = [];
    for (const env of out) for (const d of domain) next.push({ ...env, [v]: d });
    out = next;
  }
  return out;
}

/**
 * Do `f` and `g` have the same truth value in EVERY model over domains 1..MAX_DOMAIN,
 * under every assignment of their free variables?
 *
 * This is the small-scope hypothesis, not a decision procedure — but for the shapes in
 * this table it is exact, and it is a far stronger check than a hand-written list of
 * "these two are the same".
 */
function agree(f: Formula, g: Formula): boolean {
  const sig = _sharedSignature(f, g);
  const vars = [...new Set([...freeVars(f), ...freeVars(g)])].sort();

  for (let n = 1; n <= MAX_DOMAIN; n++) {
    const budget = modelCount(sig, n) * n ** vars.length;
    if (budget > MAX_MODELS) throw new Error(`equivalence oracle budget blown: ${budget}`);

    for (const m of enumerateModels(sig, n)) {
      for (const env of _assignments(vars, m.domain)) {
        if (evaluate(f, m, env) !== evaluate(g, m, env)) return false;
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** Every row is glossed WITH `NOUNS`; the bare-name behaviour is pinned separately. */
const TABLE: ReadonlyArray<readonly [src: string, expected: string]> = [
  // -- the canonical idioms -------------------------------------------------
  ['∀ x ( Dog(x) → Red(x) )', 'every dog is red'],
  ['∃ x ( Dog(x) ∧ Red(x) )', 'some dog is red'],
  ['¬ ∃ x ( Dog(x) ∧ Red(x) )', 'no dog is red'],
  ['∀ x ( Dog(x) → ¬ Red(x) )', 'no dog is red'], // ≡ the row above. Intended collision.
  ['∃ x ( Dog(x) ∧ ¬ Red(x) )', 'some dog is not red'],
  ['∃! x ( Dog(x) )', 'there is exactly one dog'],
  ['∀ x ∃ y Likes(x, y)', 'every thing Likes at least one thing'],
  ['∃ y ∀ x Likes(x, y)', 'there is a thing that every thing Likes'],
  ['Dog ⊆ Red', 'every dog is red'], // ≡ row 1. Intended collision.

  // the ∉ tile builds ¬(x ∈ B), so these must hit the same idioms
  ['∀ x ( Dog(x) → x ∉ Red )', 'no dog is red'],
  ['∃ x ( Cat(x) ∧ x ∉ Red )', 'some cat is not red'],

  // other set pairs, to prove the idioms read their parts back out
  ['∀ x ( Cat(x) → Red(x) )', 'every cat is red'],
  ['∃ x ( Red(x) ∧ Cat(x) )', 'some red is cat'], // stilted: a noun in the adjective slot
  ['¬ ∃ x ( Cat(x) ∧ Dog(x) )', 'no cat is dog'],

  // -- fallbacks: the shapes the idioms must NOT swallow ---------------------
  //
  // Note "x is a red". The membership template takes an article unconditionally,
  // because telling a noun (`Dog`) from an adjective (`Red`) needs information the
  // `nouns` contract does not carry — and a guess that is wrong half the time would
  // buy fluency with correctness. The idiom slot is bare ("every dog is red") because
  // there the article is wrong for BOTH parts of speech. Stilted, uniform, injective.
  ['∀ x ( Dog(x) ∧ Red(x) )', 'for every thing x: (x is a dog and x is a red)'],
  ['∀ x ( Dog(x) ∨ Red(x) )', 'for every thing x: (x is a dog or x is a red)'],
  ['∃ x ( Dog(x) → Red(x) )', 'there is a thing x such that: (if x is a dog then x is a red)'],
  ['∀ x ( Dog(x) ↔ Red(x) )', 'for every thing x: (x is a dog if and only if x is a red)'],
  [
    '∃! x ( Dog(x) ∧ Red(x) )',
    'there is exactly one thing x such that: (x is a dog and x is a red)',
  ],
  ['¬ ∀ x ( Dog(x) → Red(x) )', 'it is not the case that every dog is red'],

  // -- argument order: the classic trap -------------------------------------
  ['∀ x ∃ y Likes(y, x)', 'for every thing x: (there is a thing y such that: y Likes x)'],
  ['∃ y ∀ x Likes(y, x)', 'there is a thing y such that: (for every thing x: y Likes x)'],
  ['∃ x ∀ y Likes(x, y)', 'there is a thing x such that: (for every thing y: x Likes y)'],
  // shadowing: the outer ∀ binds nothing, so the ∀∃ idiom must refuse it
  ['∀ x ∃ x Likes(x, x)', 'for every thing x: (there is a thing x such that: x Likes x)'],

  // -- atoms, constants, no quantifiers at all ------------------------------
  ['Dog(rex)', 'rex is a dog'],
  ['rex ∉ Dog', 'rex is not a dog'],
  ['Likes(rex, rex)', 'rex Likes rex'],
  ['⊤', 'always true'],
  ['⊥', 'always false'],
  ['∀ x ( x = rex )', 'for every thing x: x is the same thing as rex'],
  ['∀ x ( x ≠ rex )', 'for every thing x: x is not the same thing as rex'],

  // -- set expressions -------------------------------------------------------
  ['rex ∈ Dog ∩ Red', 'rex is in (dogs and reds)'],
  ['rex ∈ Dog ∪ Red', 'rex is in (dogs or reds)'],
  ['rex ∈ Dog ∖ Red', 'rex is in (dogs except reds)'],
  ['rex ∈ Dogᶜ', 'rex is in (everything except dogs)'],
  ['rex ∈ ∅', 'rex is in the empty set'],
  ['rex ∈ 𝕌', 'rex is in the universe'],
  ['rex ∉ Dog ∪ Cat', 'rex is not in (dogs or cats)'],
  ['Dog = Red', 'dogs and reds contain exactly the same things'],
  ['Dog ≠ Red', 'dogs and reds do not contain exactly the same things'],
  ['Dog ∪ Red ⊆ Cat', 'everything in (dogs or reds) is also in cats'],
  ['∀ x ( x ∈ { y | Dog(y) } )', 'for every thing x: x is in the things y such that (y is a dog)'],
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gloss — the table', () => {
  it.each(TABLE)('%s', (src, expected) => {
    expect(say(src)).toBe(expected);
  });

  it('covers at least 25 formulas', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(25);
  });
});

describe('gloss — no two NON-EQUIVALENT formulas share a gloss', () => {
  // The whole module exists to make this true. Checked against a real oracle, so a
  // future idiom that quietly conflates two shapes fails here rather than in a lesson.
  const rows = TABLE.map(([src]) => ({ src, f: parse(src), g: say(src) }));

  const byGloss = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = byGloss.get(row.g);
    if (bucket) bucket.push(row);
    else byGloss.set(row.g, [row]);
  }
  const collisions = [...byGloss.entries()].filter(([, bucket]) => bucket.length > 1);

  it.each(collisions)('"%s" is claimed by formulas that are all equivalent', (_g, bucket) => {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]!;
        const b = bucket[j]!;
        expect(
          agree(a.f, b.f),
          `"${a.src}" and "${b.src}" gloss the same but are NOT equivalent`,
        ).toBe(true);
      }
    }
  });

  it('finds exactly the two intended collisions', () => {
    // Not a correctness requirement — a tripwire. If a change adds a collision, this
    // fails and forces someone to prove the new one is equivalence-preserving.
    expect(collisions.map(([g]) => g).sort()).toEqual([
      'every dog is red', // ∀x(Dog→Red) and Dog ⊆ Red
      'no dog is red', // ¬∃x(Dog∧Red), ∀x(Dog→¬Red), ∀x(Dog→x∉Red)
    ]);
  });

  it('the oracle actually separates things (it is not vacuously true)', () => {
    expect(agree(parse('∀ x ( Dog(x) → Red(x) )'), parse('∀ x ( Dog(x) ∧ Red(x) )'))).toBe(false);
    expect(agree(parse('∀ x ∃ y Likes(x, y)'), parse('∃ y ∀ x Likes(x, y)'))).toBe(false);
  });
});

describe('gloss — the pair that must never read alike', () => {
  // Called out explicitly in the spec: the single most common student error is reading
  // ∀x(A→B) as ∀x(A∧B), and a glosser that blurred them would teach the error.
  const implication = '∀ x ( Dog(x) → Red(x) )';
  const conjunction = '∀ x ( Dog(x) ∧ Red(x) )';

  it('with nouns', () => {
    expect(say(implication)).toBe('every dog is red');
    expect(say(conjunction)).toBe('for every thing x: (x is a dog and x is a red)');
    expect(say(implication)).not.toBe(say(conjunction));
  });

  it('without nouns', () => {
    expect(say(implication, {})).toBe('every Dog is Red');
    expect(say(conjunction, {})).toBe('for every thing x: (x is a Dog and x is a Red)');
    expect(say(implication, {})).not.toBe(say(conjunction, {}));
  });

  it('and they really are different formulas', () => {
    expect(agree(parse(implication), parse(conjunction))).toBe(false);
  });
});

describe('gloss — without nouns, the set name is the word', () => {
  it.each([
    ['∃ x ( Dog(x) ∧ Red(x) )', 'some Dog is Red'],
    ['¬ ∃ x ( Dog(x) ∧ Red(x) )', 'no Dog is Red'],
    ['∃! x ( Dog(x) )', 'there is exactly one Dog'],
    ['Dog(rex)', 'rex is a Dog'],
    ['rex ∈ Dog ∩ Red', 'rex is in (Dog and Red)'],
  ])('%s', (src, expected) => {
    expect(say(src, {})).toBe(expected);
  });
});

describe('gloss — articles', () => {
  // Orthography only. It can never merge two words, so it cannot affect correctness.
  const sig: Signature = { sets: ['Animal', 'Dog'], relations: [], constants: ['rex'] };
  it('uses "an" before a vowel', () => {
    expect(gloss(parse('Animal(rex)', sig), sig, {})).toBe('rex is an Animal');
    expect(gloss(parse('Animal(rex)', sig), sig, { Animal: { singular: 'animal', plural: 'animals' } })).toBe(
      'rex is an animal',
    );
  });
  it('uses "a" otherwise', () => {
    expect(gloss(parse('Dog(rex)', sig), sig, {})).toBe('rex is a Dog');
  });
});

describe('gloss — idioms refuse shapes they do not exactly match', () => {
  // Each of these is one step away from an idiom, and each step changes the meaning.
  it.each([
    // compound set in a noun slot: no "every (dog or cat) is red"
    [
      '∀ x ( x ∈ Dog ∪ Cat → Red(x) )',
      'for every thing x: (if x is in (dogs or cats) then x is a red)',
    ],
    // the antecedent is negated
    [
      '∀ x ( ¬ Dog(x) → Red(x) )',
      'for every thing x: (if x is not a dog then x is a red)',
    ],
    // a constant, not the bound variable
    ['∀ x ( Dog(rex) → Red(rex) )', 'for every thing x: (if rex is a dog then rex is a red)'],
    // a different variable in the consequent
    [
      '∀ x ( Dog(x) → Red(y) )',
      'for every thing x: (if x is a dog then y is a red)',
    ],
    // ∃! over a compound body is not "there is exactly one A"
    [
      '∃! x ( Dog(x) ∨ Cat(x) )',
      'there is exactly one thing x such that: (x is a dog or x is a cat)',
    ],
  ])('%s', (src, expected) => {
    expect(say(src)).toBe(expected);
  });
});

describe('gloss — nesting stays unambiguous', () => {
  it('brackets a quantifier that is not the last thing in its clause', () => {
    // Without the brackets, "for every thing x: x is a dog and rex is a cat" could be
    // read with the ∧ inside the ∀ — which is a different formula.
    expect(say('( ∀ x ( Dog(x) ) ) ∧ Cat(rex)')).toBe(
      '(for every thing x: x is a dog) and rex is a cat',
    );
  });

  it('brackets an idiom used as a conjunct', () => {
    expect(say('( ∀ x ( Dog(x) → Red(x) ) ) ∧ Cat(rex)')).toBe('every dog is red and rex is a cat');
  });

  it('nests negation and implication without losing the tree', () => {
    expect(say('¬ ( Dog(rex) ∧ Cat(rex) )')).toBe(
      'it is not the case that (rex is a dog and rex is a cat)',
    );
    expect(say('( Dog(rex) → Cat(rex) ) → Red(rex)')).toBe(
      'if (if rex is a dog then rex is a cat) then rex is a red',
    );
    // → is right-associative, so this is a DIFFERENT tree from the one above.
    expect(say('Dog(rex) → ( Cat(rex) → Red(rex) )')).toBe(
      'if rex is a dog then (if rex is a cat then rex is a red)',
    );
  });

  it('the relation idioms are whole-sentence only', () => {
    // Nested, "…every thing Likes" would garden-path into eating the next conjunct.
    expect(say('( ∃ y ∀ x Likes(x, y) ) ∧ Cat(rex)')).toBe(
      '(there is a thing y such that: (for every thing x: x Likes y)) and rex is a cat',
    );
  });
});

describe('gloss — set-builder', () => {
  it('brackets the body, so a following set operator cannot be read into it', () => {
    // The body's brackets close before the "or", so "or cats" belongs to the union and
    // cannot be mistaken for part of the condition. That is the whole reason the body
    // is bracketed even when it is a single atom.
    expect(say('rex ∈ { y | Dog(y) } ∪ Cat')).toBe(
      'rex is in (the things y such that (y is a dog) or cats)',
    );
  });

  it('handles a compound body', () => {
    expect(say('rex ∈ { y | Dog(y) ∧ Red(y) }')).toBe(
      'rex is in the things y such that (y is a dog and y is a red)',
    );
  });
});

describe('gloss — refuses a nouns map that merges two sets', () => {
  // The one caller error that would silently break the module's whole guarantee.
  it('throws, and names both sets', () => {
    const bad: Nouns = {
      Dog: { singular: 'pet', plural: 'pets' },
      Cat: { singular: 'pet', plural: 'pets' },
    };
    expect(() => gloss(parse('Dog(rex)'), SIG, bad)).toThrow(/Cat and Dog both read as "pet"/);
  });

  it('throws when a noun collides with an unmapped set name', () => {
    const bad: Nouns = { Cat: { singular: 'Dog', plural: 'Dogs' } };
    expect(() => gloss(parse('Dog(rex)'), SIG, bad)).toThrow(/both read as "Dog"/);
  });

  it('allows singular and plural to coincide (adjectives have no plural)', () => {
    const fine: Nouns = { Red: { singular: 'red', plural: 'red' } };
    expect(gloss(parse('∀ x ( Dog(x) → Red(x) )'), SIG, fine)).toBe('every Dog is red');
  });
});

describe('gloss — edge shapes', () => {
  it('a formula with no quantifiers', () => {
    expect(say('Dog(rex) ∧ ¬ Cat(rex)')).toBe('rex is a dog and rex is not a cat');
  });

  it('a single-symbol signature', () => {
    const sig: Signature = { sets: ['A'], relations: [], constants: [] };
    expect(gloss(parse('∀ x ( x ∈ A )', sig), sig, {})).toBe('for every thing x: x is an A');
  });

  it('an empty signature still glosses the constants ⊤ and ⊥', () => {
    const sig: Signature = { sets: [], relations: [], constants: [] };
    expect(gloss(parse('⊤ ∧ ⊥', sig), sig, {})).toBe('always true and always false');
  });

  it('an open formula glosses its free variable', () => {
    expect(say('Dog(x)')).toBe('x is a dog');
    expect(say('Likes(x, y)')).toBe('x Likes y');
  });

  it('is deterministic', () => {
    const f = parse('∀ x ( Dog(x) → Red(x) )');
    expect(gloss(f, SIG, NOUNS)).toBe(gloss(f, SIG, NOUNS));
  });
});
