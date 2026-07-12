/**
 * Tests for the logic tokenizer, parser and renderer.
 *
 * The load-bearing groups here are QUANTIFIER SCOPE and ROUND TRIP. Everything
 * else is hygiene; those two are the maths. If a future change makes
 * `∀x Dog(x) ∧ Red(x)` mean anything other than `∀x (Dog(x) ∧ Red(x))`, or makes
 * `parse(render(f)) ≠ f` for any f, the engine is silently teaching a falsehood
 * and these tests are the only thing standing in the way.
 */

import { describe, expect, it } from 'vitest';
import type { Formula, SetExpr, Signature, Term } from './types';
import { formulaSize, parseFormula, renderFormula, renderSet, tokenizeLogic } from './parse';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SIG: Signature = {
  sets: ['Dog', 'Red', 'Cat', 'A', 'B', 'C', 'P', 'Q'],
  relations: ['Likes', 'R'],
  constants: ['rex', 'fido'],
};

/** Parse or blow up loudly — for the many tests where a parse failure is the bug. */
function parse(src: string | string[], sig: Signature = SIG): Formula {
  const r = parseFormula(src, sig);
  if (!r.ok) throw new Error(`expected a parse, got: ${r.message}`);
  return r.formula;
}

/** The failure branch, for the tests that are *about* failure. */
function parseErr(src: string, sig: Signature = SIG): { message: string; at?: number } {
  const r = parseFormula(src, sig);
  if (r.ok) throw new Error(`expected a parse error, got: ${renderFormula(r.formula)}`);
  return { message: r.message, at: r.at };
}

const v = (name: string): Term => ({ kind: 'var', name });
const k = (name: string): Term => ({ kind: 'const', name });
const set = (name: string): SetExpr => ({ kind: 'set', name });
const mem = (term: Term, s: SetExpr): Formula => ({ kind: 'member', term, set: s });
const inSet = (x: string, s: string): Formula => mem(v(x), set(s));

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

describe('tokenizeLogic', () => {
  it('splits ᶜ off the identifier it follows', () => {
    // The trap: ᶜ (U+1D9C) is a Unicode *letter*, so a \p{L} scan would swallow
    // it and invent a set called "Aᶜ".
    expect(tokenizeLogic('Aᶜ')).toEqual(['A', 'ᶜ']);
    expect(tokenizeLogic('Dogᶜ ∩ Catᶜ')).toEqual(['Dog', 'ᶜ', '∩', 'Cat', 'ᶜ']);
    expect(tokenizeLogic('Aᶜᶜ')).toEqual(['A', 'ᶜ', 'ᶜ']);
  });

  it('keeps 𝕌 whole (it is a surrogate pair, not a character)', () => {
    expect(tokenizeLogic('𝕌')).toEqual(['𝕌']);
    expect(tokenizeLogic('x ∈ 𝕌')).toEqual(['x', '∈', '𝕌']);
  });

  it('reads ∃! as one token, not ∃ followed by !', () => {
    expect(tokenizeLogic('∃!x')).toEqual(['∃!', 'x']);
    expect(tokenizeLogic('∃ x')).toEqual(['∃', 'x']);
  });

  it('does not need whitespace between tokens', () => {
    expect(tokenizeLogic('∀x(Dog(x)→Red(x))')).toEqual([
      '∀', 'x', '(', 'Dog', '(', 'x', ')', '→', 'Red', '(', 'x', ')', ')',
    ]);
  });

  it('reads identifiers as alphanumeric runs', () => {
    expect(tokenizeLogic('Dog Likes rex x2 _y')).toEqual(['Dog', 'Likes', 'rex', 'x2', '_y']);
  });

  it('normalises the ASCII spellings', () => {
    expect(tokenizeLogic('A \\ B')).toEqual(['A', '∖', 'B']);
    expect(tokenizeLogic('A \\\\ B')).toEqual(['A', '∖', 'B']);
    expect(tokenizeLogic('A -> B')).toEqual(['A', '→', 'B']);
    expect(tokenizeLogic('A <-> B')).toEqual(['A', '↔', 'B']);
    expect(tokenizeLogic('x != y')).toEqual(['x', '≠', 'y']);
  });

  it('is idempotent, which is what lets tile arrays and strings share a parser', () => {
    const srcs = [
      '∀x (Dog(x) → Red(x))',
      '{ x | x ∈ A ∪ Bᶜ } ⊆ C',
      '∃!y Likes(rex, y)',
      'A \\ B ⊆ 𝕌',
    ];
    for (const src of srcs) {
      const once = tokenizeLogic(src);
      expect(once.flatMap((t) => tokenizeLogic(t))).toEqual(once);
    }
  });

  it('emits an unknown character as its own token rather than failing', () => {
    // The tokenizer has no error channel; the parser does the blaming, by index.
    expect(tokenizeLogic('x ? y')).toEqual(['x', '?', 'y']);
  });

  it('reads the empty string as no tokens', () => {
    expect(tokenizeLogic('')).toEqual([]);
    expect(tokenizeLogic('   \n\t ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The sugar: Dog(x) IS x ∈ Dog
// ---------------------------------------------------------------------------

describe('predicate application is sugar for membership', () => {
  it('parses Dog(x) to a member node', () => {
    expect(parse('Dog(x)')).toEqual({
      kind: 'member',
      term: { kind: 'var', name: 'x' },
      set: { kind: 'set', name: 'Dog' },
    });
  });

  it('parses both spellings to the identical tree', () => {
    expect(parse('Dog(x)')).toEqual(parse('x ∈ Dog'));
    expect(parse('∀x (Dog(x) → Red(x))')).toEqual(parse('∀x (x ∈ Dog → x ∈ Red)'));
  });

  it('resolves a constant argument to a const term', () => {
    expect(parse('Dog(rex)')).toEqual(mem(k('rex'), set('Dog')));
    expect(parse('rex ∈ Dog')).toEqual(mem(k('rex'), set('Dog')));
  });

  it('parses Likes(x, y) to a rel node', () => {
    expect(parse('Likes(x, y)')).toEqual({
      kind: 'rel',
      name: 'Likes',
      left: { kind: 'var', name: 'x' },
      right: { kind: 'var', name: 'y' },
    });
  });

  it('parses x ∉ A as ¬(x ∈ A)', () => {
    expect(parse('x ∉ A')).toEqual({ kind: 'not', inner: inSet('x', 'A') });
    expect(parse('x ∉ A')).toEqual(parse('¬ (x ∈ A)'));
  });

  it('parses x ≠ y as ¬(x = y) and A ≠ B as ¬(A = B)', () => {
    expect(parse('x ≠ y')).toEqual({
      kind: 'not',
      inner: { kind: 'eq', left: v('x'), right: v('y') },
    });
    expect(parse('A ≠ B')).toEqual({
      kind: 'not',
      inner: { kind: 'seteq', left: set('A'), right: set('B') },
    });
  });

  it('uses the signature to tell = between individuals from = between sets', () => {
    expect(parse('x = rex')).toEqual({ kind: 'eq', left: v('x'), right: k('rex') });
    expect(parse('A = B')).toEqual({ kind: 'seteq', left: set('A'), right: set('B') });
  });

  it('treats any name the signature does not know as a variable', () => {
    expect(parse('zzz ∈ Dog')).toEqual(mem(v('zzz'), set('Dog')));
    // ...and the same name IS a constant in a signature that declares it.
    const sig: Signature = { sets: ['Dog'], relations: [], constants: ['zzz'] };
    expect(parse('zzz ∈ Dog', sig)).toEqual(mem(k('zzz'), set('Dog')));
  });
});

// ---------------------------------------------------------------------------
// Quantifier scope — the classic trap
// ---------------------------------------------------------------------------

describe('quantifier scope is maximal', () => {
  it('∀x Dog(x) ∧ Red(x) parses as ∀x (Dog(x) ∧ Red(x))', () => {
    expect(parse('∀x Dog(x) ∧ Red(x)')).toEqual(parse('∀x (Dog(x) ∧ Red(x))'));
  });

  it('extends the body over → and ↔ too', () => {
    expect(parse('∀x Dog(x) → Red(x)')).toEqual(parse('∀x (Dog(x) → Red(x))'));
    expect(parse('∃x Dog(x) ↔ Red(x)')).toEqual(parse('∃x (Dog(x) ↔ Red(x))'));
  });

  it('lets a quantifier on the right of ∧ swallow everything after it', () => {
    // A ∧ ∀x B ∨ C  is  A ∧ ∀x (B ∨ C) — the ∨ is inside the scope.
    expect(parse('Dog(rex) ∧ ∀x Dog(x) ∨ Red(x)')).toEqual(
      parse('Dog(rex) ∧ ∀x (Dog(x) ∨ Red(x))'),
    );
  });

  it('stops the body at a closing paren', () => {
    expect(parse('(∀x Dog(x)) ∧ Red(rex)')).toEqual({
      kind: 'and',
      left: { kind: 'forall', varName: 'x', body: inSet('x', 'Dog') },
      right: mem(k('rex'), set('Red')),
    });
  });

  it('¬∀x φ and ∃x ¬φ both parse, and differ', () => {
    const a = parse('¬∀x Dog(x)');
    const b = parse('∃x ¬Dog(x)');
    expect(a).toEqual({
      kind: 'not',
      inner: { kind: 'forall', varName: 'x', body: inSet('x', 'Dog') },
    });
    expect(b).toEqual({
      kind: 'exists',
      varName: 'x',
      body: { kind: 'not', inner: inSet('x', 'Dog') },
    });
    expect(a).not.toEqual(b);
  });

  it('scopes ¬ over the whole quantified formula, body and all', () => {
    // ¬ takes a unary argument; that argument is the quantifier, whose own body
    // then runs to the right edge. So the ∧ ends up INSIDE the ∀, under the ¬.
    expect(parse('¬∀x Dog(x) ∧ Red(x)')).toEqual(parse('¬(∀x (Dog(x) ∧ Red(x)))'));
  });

  it('∀x ∃y R(x,y) and ∃y ∀x R(x,y) are different formulas', () => {
    const ax = parse('∀x ∃y Likes(x, y)');
    const ya = parse('∃y ∀x Likes(x, y)');
    expect(ax).toEqual({
      kind: 'forall',
      varName: 'x',
      body: {
        kind: 'exists',
        varName: 'y',
        body: { kind: 'rel', name: 'Likes', left: v('x'), right: v('y') },
      },
    });
    expect(ax).not.toEqual(ya);
    expect(renderFormula(ax)).not.toBe(renderFormula(ya));
  });

  it('parses the two sentences the lesson is built on, and they are NOT the same', () => {
    const every = parse('∀ x ( Dog(x) → Red(x) )'); // every dog is red
    const some = parse('∃ x ( Dog(x) ∧ Red(x) )'); // some dog is red
    expect(every).toEqual({
      kind: 'forall',
      varName: 'x',
      body: { kind: 'implies', left: inSet('x', 'Dog'), right: inSet('x', 'Red') },
    });
    expect(some).toEqual({
      kind: 'exists',
      varName: 'x',
      body: { kind: 'and', left: inSet('x', 'Dog'), right: inSet('x', 'Red') },
    });
    expect(every).not.toEqual(some);
  });

  it('parses ∃! and keeps it distinct from ∃', () => {
    expect(parse('∃!x Dog(x)')).toEqual({
      kind: 'existsUnique',
      varName: 'x',
      body: inSet('x', 'Dog'),
    });
    expect(parse('∃!x Dog(x)')).not.toEqual(parse('∃x Dog(x)'));
  });

  it('nests quantifiers to depth', () => {
    expect(parse('∀x ∀y ∃z (Likes(x, z) ∧ Likes(y, z))')).toEqual({
      kind: 'forall',
      varName: 'x',
      body: {
        kind: 'forall',
        varName: 'y',
        body: {
          kind: 'exists',
          varName: 'z',
          body: {
            kind: 'and',
            left: { kind: 'rel', name: 'Likes', left: v('x'), right: v('z') },
            right: { kind: 'rel', name: 'Likes', left: v('y'), right: v('z') },
          },
        },
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Connective precedence & associativity
// ---------------------------------------------------------------------------

describe('connective precedence', () => {
  it('binds ∧ tighter than ∨', () => {
    expect(parse('Dog(x) ∨ Red(x) ∧ Cat(x)')).toEqual(parse('Dog(x) ∨ (Red(x) ∧ Cat(x))'));
    expect(parse('Dog(x) ∧ Red(x) ∨ Cat(x)')).toEqual(parse('(Dog(x) ∧ Red(x)) ∨ Cat(x)'));
  });

  it('binds ∨ tighter than →, and → tighter than ↔', () => {
    expect(parse('Dog(x) ∨ Red(x) → Cat(x)')).toEqual(parse('(Dog(x) ∨ Red(x)) → Cat(x)'));
    expect(parse('Dog(x) ↔ Red(x) → Cat(x)')).toEqual(parse('Dog(x) ↔ (Red(x) → Cat(x))'));
  });

  it('binds ¬ tighter than ∧', () => {
    expect(parse('¬Dog(x) ∧ Red(x)')).toEqual(parse('(¬Dog(x)) ∧ Red(x)'));
    expect(parse('¬Dog(x) ∧ Red(x)')).not.toEqual(parse('¬(Dog(x) ∧ Red(x))'));
  });

  it('associates → to the RIGHT', () => {
    expect(parse('Dog(x) → Red(x) → Cat(x)')).toEqual(parse('Dog(x) → (Red(x) → Cat(x))'));
    expect(parse('Dog(x) → Red(x) → Cat(x)')).not.toEqual(
      parse('(Dog(x) → Red(x)) → Cat(x)'),
    );
  });

  it('associates ∧, ∨ and ↔ to the LEFT', () => {
    expect(parse('Dog(x) ∧ Red(x) ∧ Cat(x)')).toEqual(parse('(Dog(x) ∧ Red(x)) ∧ Cat(x)'));
    expect(parse('Dog(x) ∨ Red(x) ∨ Cat(x)')).toEqual(parse('(Dog(x) ∨ Red(x)) ∨ Cat(x)'));
    expect(parse('Dog(x) ↔ Red(x) ↔ Cat(x)')).toEqual(parse('(Dog(x) ↔ Red(x)) ↔ Cat(x)'));
  });

  it('stacks ¬', () => {
    expect(parse('¬¬Dog(x)')).toEqual({
      kind: 'not',
      inner: { kind: 'not', inner: inSet('x', 'Dog') },
    });
  });

  it('parses ⊤ and ⊥', () => {
    expect(parse('⊤')).toEqual({ kind: 'true' });
    expect(parse('⊥ ∨ ⊤')).toEqual({
      kind: 'or',
      left: { kind: 'false' },
      right: { kind: 'true' },
    });
  });
});

// ---------------------------------------------------------------------------
// Set expressions
// ---------------------------------------------------------------------------

describe('set-expression precedence', () => {
  const setOf = (src: string): SetExpr => {
    const f = parse(`x ∈ ${src}`);
    if (f.kind !== 'member') throw new Error('expected a membership');
    return f.set;
  };

  it('binds ᶜ tightest', () => {
    expect(setOf('A ∩ Bᶜ')).toEqual({
      kind: 'inter',
      left: set('A'),
      right: { kind: 'compl', inner: set('B') },
    });
    expect(setOf('(A ∩ B)ᶜ')).toEqual({
      kind: 'compl',
      inner: { kind: 'inter', left: set('A'), right: set('B') },
    });
  });

  it('stacks ᶜ', () => {
    expect(setOf('Aᶜᶜ')).toEqual({
      kind: 'compl',
      inner: { kind: 'compl', inner: set('A') },
    });
  });

  it('binds ∩ tighter than ∪', () => {
    expect(setOf('A ∪ B ∩ C')).toEqual({
      kind: 'union',
      left: set('A'),
      right: { kind: 'inter', left: set('B'), right: set('C') },
    });
  });

  it('gives ∪ and ∖ the same level, associating left', () => {
    expect(setOf('A ∪ B ∖ C')).toEqual({
      kind: 'diff',
      left: { kind: 'union', left: set('A'), right: set('B') },
      right: set('C'),
    });
    expect(setOf('A ∖ B ∪ C')).toEqual({
      kind: 'union',
      left: { kind: 'diff', left: set('A'), right: set('B') },
      right: set('C'),
    });
  });

  it('accepts \\ for ∖', () => {
    expect(setOf('A \\ B')).toEqual(setOf('A ∖ B'));
  });

  it('parses ∅ and 𝕌', () => {
    expect(setOf('∅')).toEqual({ kind: 'emptyset' });
    expect(setOf('𝕌')).toEqual({ kind: 'universe' });
    expect(setOf('𝕌 ∖ Dog')).toEqual({
      kind: 'diff',
      left: { kind: 'universe' },
      right: set('Dog'),
    });
  });

  it('parses set relations, including under parentheses', () => {
    expect(parse('A ⊆ B')).toEqual({ kind: 'subset', left: set('A'), right: set('B') });
    expect(parse('(A ∪ B) ⊆ C')).toEqual({
      kind: 'subset',
      left: { kind: 'union', left: set('A'), right: set('B') },
      right: set('C'),
    });
    expect(parse('(A ∪ B)ᶜ = Aᶜ ∩ Bᶜ')).toEqual({
      kind: 'seteq',
      left: { kind: 'compl', inner: { kind: 'union', left: set('A'), right: set('B') } },
      right: {
        kind: 'inter',
        left: { kind: 'compl', inner: set('A') },
        right: { kind: 'compl', inner: set('B') },
      },
    });
  });

  it('does not confuse a parenthesised formula with a parenthesised set', () => {
    // Both start with '('. Only one of the two readings can be a formula.
    expect(parse('(x ∈ A) ∧ Red(x)')).toEqual({
      kind: 'and',
      left: inSet('x', 'A'),
      right: inSet('x', 'Red'),
    });
    expect(parse('(A ⊆ B) ∧ Red(x)')).toEqual({
      kind: 'and',
      left: { kind: 'subset', left: set('A'), right: set('B') },
      right: inSet('x', 'Red'),
    });
  });

  it('parses a set-builder', () => {
    expect(parse('{ x | Dog(x) ∧ Red(x) } ⊆ Cat')).toEqual({
      kind: 'subset',
      left: {
        kind: 'builder',
        varName: 'x',
        body: { kind: 'and', left: inSet('x', 'Dog'), right: inSet('x', 'Red') },
      },
      right: set('Cat'),
    });
  });

  it('parses a set-builder on the right of ∈, and lets it be complemented', () => {
    expect(parse('rex ∈ { y | Dog(y) }ᶜ')).toEqual(
      mem(k('rex'), {
        kind: 'compl',
        inner: { kind: 'builder', varName: 'y', body: inSet('y', 'Dog') },
      }),
    );
  });

  it('lets a set-builder body carry a quantifier (the body runs to the })', () => {
    expect(parse('{ x | ∃y Likes(x, y) } ⊆ Dog')).toEqual({
      kind: 'subset',
      left: {
        kind: 'builder',
        varName: 'x',
        body: {
          kind: 'exists',
          varName: 'y',
          body: { kind: 'rel', name: 'Likes', left: v('x'), right: v('y') },
        },
      },
      right: set('Dog'),
    });
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe('parse errors are helpful', () => {
  it('names the empty formula', () => {
    expect(parseErr('').message).toMatch(/nothing to read/i);
    expect(parseFormula([], SIG)).toEqual({
      ok: false,
      message: expect.any(String),
      at: 0,
    });
  });

  it('says "expected a set after ∈"', () => {
    expect(parseErr('x ∈').message).toMatch(/expected a set after ∈/i);
    expect(parseErr('x ∈ y').message).toMatch(/expected a set after ∈/i);
    expect(parseErr('x ∈ rex').message).toMatch(/expected a set after ∈/i);
  });

  it('says "unclosed ("', () => {
    expect(parseErr('( x ∈ A').message).toMatch(/unclosed \(/i);
    expect(parseErr('∀x (Dog(x) → Red(x)').message).toMatch(/unclosed \(/i);
  });

  it('reports an unmatched )', () => {
    expect(parseErr('Dog(x) )').message).toMatch(/unmatched '\)'/i);
  });

  it('reports a missing connective rather than silently stopping', () => {
    const e = parseErr('Dog(x) Red(x)');
    expect(e.message).toMatch(/did not expect/i);
    expect(e.at).toBe(4); // ['Dog','(','x',')','Red',...] — blame the 5th tile
  });

  it('explains an unknown name', () => {
    expect(parseErr('Wombat(x)').message).toMatch(/don't know the name 'Wombat'/i);
  });

  it('explains arity mistakes', () => {
    expect(parseErr('Likes(x)').message).toMatch(/relation between two things/i);
    expect(parseErr('Dog(x, y)').message).toMatch(/applies to one thing/i);
  });

  it('explains a set used where an individual belongs', () => {
    // A category error, not a missing-operator error — and the blame lands on the
    // set tile, which is the tile that has to move.
    const e = parseErr('Dog ∈ A');
    expect(e.message).toMatch(/'Dog' is a set, not an individual/i);
    expect(e.message).toMatch(/did you mean 'x ∈ Dog'/i);
    expect(e.at).toBe(0);
    expect(parseErr('Dog(x) ∧ A ∪ B ∉ C').message).toMatch(/'A ∪ B' is a set/i);
  });

  it('explains a quantifier over a name that is already taken', () => {
    expect(parseErr('∀Dog Red(rex)').message).toMatch(/already names a set/i);
    expect(parseErr('∃rex Red(rex)').message).toMatch(/already names a constant/i);
    expect(parseErr('∀ (Dog(x))').message).toMatch(/needs a variable/i);
  });

  it('explains a missing relation symbol after a term or a set', () => {
    expect(parseErr('x Dog').message).toMatch(/expected ∈, ∉, = or ≠/i);
    expect(parseErr('A ∪ B').message).toMatch(/expected ⊆, = or ≠/i);
  });

  it('explains a malformed set-builder', () => {
    expect(parseErr('{ x Dog(x) } ⊆ A').message).toMatch(/set-builder looks like/i);
    expect(parseErr('{ x | Dog(x) ⊆ A').message).toMatch(/unclosed \{/i);
  });

  it('blames an unknown symbol by token index', () => {
    const e = parseErr('Dog(x) ∧ ? ∧ Red(x)');
    expect(e.message).toMatch(/'\?'/);
    expect(e.at).toBe(5); // ['Dog','(','x',')','∧','?',...]
  });

  it('never throws, whatever it is handed', () => {
    const junk = ['', '(((', ')))', '∀', '∃!', '¬', '∧ ∧', '{ | }', 'x ∈ ∈ A', '→ Dog(x)'];
    for (const src of junk) {
      const r = parseFormula(src, SIG);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('renderFormula', () => {
  it('prints the membership spelling, never the predicate spelling', () => {
    expect(renderFormula(parse('Dog(x)'))).toBe('x ∈ Dog');
    expect(renderFormula(parse('∀x (Dog(x) → Red(x))'))).toBe('∀x (x ∈ Dog → x ∈ Red)');
  });

  it('parenthesises a quantifier body, so reading it needs no scope rule', () => {
    expect(renderFormula(parse('∀x Dog(x) ∧ Red(x)'))).toBe('∀x (x ∈ Dog ∧ x ∈ Red)');
    expect(renderFormula(parse('∃x (Dog(x) ∧ Red(x))'))).toBe('∃x (x ∈ Dog ∧ x ∈ Red)');
  });

  it('keeps a quantifier chain clean', () => {
    expect(renderFormula(parse('∀x ∃y Likes(x, y)'))).toBe('∀x ∃y Likes(x, y)');
    expect(renderFormula(parse('∃y ∀x Likes(x, y)'))).toBe('∃y ∀x Likes(x, y)');
  });

  it('prints ¬(x ∈ A) as x ∉ A and ¬(x = y) as x ≠ y', () => {
    expect(renderFormula(parse('¬(x ∈ A)'))).toBe('x ∉ A');
    expect(renderFormula(parse('¬(x = y)'))).toBe('x ≠ y');
    expect(renderFormula(parse('¬(A = B)'))).toBe('A ≠ B');
    // ...and a doubled negation of one keeps the parens it needs.
    expect(renderFormula(parse('¬¬(x ∈ A)'))).toBe('¬(x ∉ A)');
  });

  it('parenthesises a negated ⊆, which has no glyph of its own', () => {
    expect(renderFormula(parse('¬(A ⊆ B)'))).toBe('¬(A ⊆ B)');
  });

  it('omits parentheses precedence already implies', () => {
    expect(renderFormula(parse('(Dog(x) ∧ Red(x)) ∨ Cat(x)'))).toBe(
      'x ∈ Dog ∧ x ∈ Red ∨ x ∈ Cat',
    );
    expect(renderFormula(parse('Dog(x) → (Red(x) → Cat(x))'))).toBe(
      'x ∈ Dog → x ∈ Red → x ∈ Cat',
    );
  });

  it('adds the parentheses precedence does NOT imply', () => {
    expect(renderFormula(parse('Dog(x) ∧ (Red(x) ∨ Cat(x))'))).toBe(
      'x ∈ Dog ∧ (x ∈ Red ∨ x ∈ Cat)',
    );
    expect(renderFormula(parse('(Dog(x) → Red(x)) → Cat(x)'))).toBe(
      '(x ∈ Dog → x ∈ Red) → x ∈ Cat',
    );
    expect(renderFormula(parse('¬(Dog(x) ∧ Red(x))'))).toBe('¬(x ∈ Dog ∧ x ∈ Red)');
  });

  it('braces a quantifier that is NOT at the right edge, because its scope would run on', () => {
    // (A ∧ ∀x B) ∨ C — leaving the ∀ bare would let it swallow the ∨ C.
    const f: Formula = {
      kind: 'or',
      left: {
        kind: 'and',
        left: mem(k('rex'), set('Dog')),
        right: { kind: 'forall', varName: 'x', body: inSet('x', 'Red') },
      },
      right: mem(k('rex'), set('Cat')),
    };
    expect(renderFormula(f)).toBe('rex ∈ Dog ∧ (∀x (x ∈ Red)) ∨ rex ∈ Cat');
    expect(parse(renderFormula(f))).toEqual(f);
  });

  it('leaves a quantifier bare when it IS at the right edge', () => {
    const f: Formula = {
      kind: 'and',
      left: mem(k('rex'), set('Dog')),
      right: { kind: 'forall', varName: 'x', body: inSet('x', 'Red') },
    };
    expect(renderFormula(f)).toBe('rex ∈ Dog ∧ ∀x (x ∈ Red)');
    expect(parse(renderFormula(f))).toEqual(f);
  });

  it('renders ¬∀ and ∃¬ distinctly', () => {
    expect(renderFormula(parse('¬∀x Dog(x)'))).toBe('¬∀x (x ∈ Dog)');
    expect(renderFormula(parse('∃x ¬Dog(x)'))).toBe('∃x (x ∉ Dog)');
  });
});

describe('renderSet', () => {
  const setOf = (src: string): SetExpr => {
    const f = parse(`x ∈ ${src}`);
    if (f.kind !== 'member') throw new Error('expected a membership');
    return f.set;
  };
  const roundTrips = (src: string) => expect(renderSet(setOf(src))).toBe(src);

  it('omits parentheses precedence already implies', () => {
    roundTrips('A ∪ B ∩ Cᶜ');
    roundTrips('A ∪ B ∖ C');
    roundTrips('A ∩ B ∩ C');
    roundTrips('Aᶜᶜ');
  });

  it('adds the parentheses precedence does NOT imply', () => {
    expect(renderSet(setOf('(A ∪ B)ᶜ'))).toBe('(A ∪ B)ᶜ');
    expect(renderSet(setOf('A ∩ (B ∪ C)'))).toBe('A ∩ (B ∪ C)');
    expect(renderSet(setOf('A ∪ (B ∖ C)'))).toBe('A ∪ (B ∖ C)');
    expect(renderSet(setOf('A ∩ (B ∩ C)'))).toBe('A ∩ (B ∩ C)');
    expect(renderSet(setOf('(A ∪ B) ∩ C'))).toBe('(A ∪ B) ∩ C');
  });

  it('renders the constants and the builder', () => {
    expect(renderSet({ kind: 'emptyset' })).toBe('∅');
    expect(renderSet({ kind: 'universe' })).toBe('𝕌');
    expect(renderSet(setOf('{ y | Dog(y) }'))).toBe('{y | y ∈ Dog}');
  });
});

// ---------------------------------------------------------------------------
// Round trip — the contract between parser and renderer
// ---------------------------------------------------------------------------

describe('round trip: parse(render(f)) === f', () => {
  const all = (name: string): SetExpr => set(name);

  const CORPUS: ReadonlyArray<readonly [string, Formula]> = [
    ['truth', { kind: 'true' }],
    ['falsity', { kind: 'false' }],
    ['membership', inSet('x', 'Dog')],
    ['membership of a constant', mem(k('rex'), all('Dog'))],
    ['non-membership', { kind: 'not', inner: inSet('x', 'Dog') }],
    ['double negation of a membership', { kind: 'not', inner: { kind: 'not', inner: inSet('x', 'Dog') } }],
    ['equality', { kind: 'eq', left: v('x'), right: k('rex') }],
    ['inequality', { kind: 'not', inner: { kind: 'eq', left: v('x'), right: v('y') } }],
    ['relation', { kind: 'rel', name: 'Likes', left: k('rex'), right: v('y') }],
    ['negated relation', { kind: 'not', inner: { kind: 'rel', name: 'R', left: v('x'), right: v('x') } }],
    ['subset', { kind: 'subset', left: all('Dog'), right: all('Red') }],
    ['negated subset', { kind: 'not', inner: { kind: 'subset', left: all('Dog'), right: all('Red') } }],
    ['set equality', { kind: 'seteq', left: all('A'), right: all('B') }],
    ['set inequality', { kind: 'not', inner: { kind: 'seteq', left: all('A'), right: all('B') } }],
    [
      'de Morgan for sets',
      {
        kind: 'seteq',
        left: { kind: 'compl', inner: { kind: 'union', left: all('A'), right: all('B') } },
        right: {
          kind: 'inter',
          left: { kind: 'compl', inner: all('A') },
          right: { kind: 'compl', inner: all('B') },
        },
      },
    ],
    [
      'nested set ops',
      mem(v('x'), {
        kind: 'diff',
        left: { kind: 'union', left: all('A'), right: { kind: 'inter', left: all('B'), right: all('C') } },
        right: { kind: 'compl', inner: { kind: 'union', left: all('P'), right: all('Q') } },
      }),
    ],
    ['emptyset and universe', { kind: 'subset', left: { kind: 'emptyset' }, right: { kind: 'universe' } }],
    [
      'set-builder',
      {
        kind: 'subset',
        left: {
          kind: 'builder',
          varName: 'x',
          body: { kind: 'and', left: inSet('x', 'Dog'), right: inSet('x', 'Red') },
        },
        right: all('Cat'),
      },
    ],
    [
      'set-builder with a quantifier inside',
      mem(k('rex'), {
        kind: 'builder',
        varName: 'x',
        body: {
          kind: 'exists',
          varName: 'y',
          body: { kind: 'rel', name: 'Likes', left: v('x'), right: v('y') },
        },
      }),
    ],
    [
      'every dog is red',
      {
        kind: 'forall',
        varName: 'x',
        body: { kind: 'implies', left: inSet('x', 'Dog'), right: inSet('x', 'Red') },
      },
    ],
    [
      'some dog is red',
      {
        kind: 'exists',
        varName: 'x',
        body: { kind: 'and', left: inSet('x', 'Dog'), right: inSet('x', 'Red') },
      },
    ],
    [
      'exactly one dog',
      { kind: 'existsUnique', varName: 'x', body: inSet('x', 'Dog') },
    ],
    [
      '¬∀',
      { kind: 'not', inner: { kind: 'forall', varName: 'x', body: inSet('x', 'Dog') } },
    ],
    [
      '∃¬',
      { kind: 'exists', varName: 'x', body: { kind: 'not', inner: inSet('x', 'Dog') } },
    ],
    [
      '∀∃',
      {
        kind: 'forall',
        varName: 'x',
        body: {
          kind: 'exists',
          varName: 'y',
          body: { kind: 'rel', name: 'Likes', left: v('x'), right: v('y') },
        },
      },
    ],
    [
      '∃∀',
      {
        kind: 'exists',
        varName: 'y',
        body: {
          kind: 'forall',
          varName: 'x',
          body: { kind: 'rel', name: 'Likes', left: v('x'), right: v('y') },
        },
      },
    ],
    [
      'quantifier as a LEFT operand (must be braced)',
      {
        kind: 'and',
        left: { kind: 'forall', varName: 'x', body: inSet('x', 'Dog') },
        right: { kind: 'exists', varName: 'y', body: inSet('y', 'Red') },
      },
    ],
    [
      'quantifier buried mid-formula (must be braced)',
      {
        kind: 'or',
        left: {
          kind: 'and',
          left: mem(k('rex'), all('Dog')),
          right: { kind: 'forall', varName: 'x', body: inSet('x', 'Red') },
        },
        right: mem(k('fido'), all('Cat')),
      },
    ],
    [
      'left-nested implication',
      {
        kind: 'implies',
        left: { kind: 'implies', left: inSet('x', 'A'), right: inSet('x', 'B') },
        right: inSet('x', 'C'),
      },
    ],
    [
      'right-nested implication',
      {
        kind: 'implies',
        left: inSet('x', 'A'),
        right: { kind: 'implies', left: inSet('x', 'B'), right: inSet('x', 'C') },
      },
    ],
    [
      'right-nested disjunction (must be braced)',
      {
        kind: 'or',
        left: inSet('x', 'A'),
        right: { kind: 'or', left: inSet('x', 'B'), right: inSet('x', 'C') },
      },
    ],
    [
      'right-nested biconditional (must be braced)',
      {
        kind: 'iff',
        left: inSet('x', 'A'),
        right: { kind: 'iff', left: inSet('x', 'B'), right: inSet('x', 'C') },
      },
    ],
    [
      'mixed connectives',
      {
        kind: 'iff',
        left: { kind: 'and', left: inSet('x', 'A'), right: { kind: 'not', inner: inSet('x', 'B') } },
        right: {
          kind: 'implies',
          left: { kind: 'or', left: inSet('x', 'C'), right: { kind: 'true' } },
          right: { kind: 'not', inner: { kind: 'and', left: inSet('x', 'P'), right: inSet('x', 'Q') } },
        },
      },
    ],
    [
      'antisymmetry of ⊆ — deep quantifiers over set relations',
      {
        kind: 'forall',
        varName: 'x',
        body: {
          kind: 'iff',
          left: mem(v('x'), { kind: 'inter', left: all('A'), right: all('B') }),
          right: { kind: 'and', left: inSet('x', 'A'), right: inSet('x', 'B') },
        },
      },
    ],
    [
      'three deep quantifiers with a negation between them',
      {
        kind: 'forall',
        varName: 'x',
        body: {
          kind: 'not',
          inner: {
            kind: 'exists',
            varName: 'y',
            body: {
              kind: 'existsUnique',
              varName: 'z',
              body: {
                kind: 'implies',
                left: { kind: 'rel', name: 'Likes', left: v('x'), right: v('y') },
                right: { kind: 'not', inner: { kind: 'rel', name: 'R', left: v('y'), right: v('z') } },
              },
            },
          },
        },
      },
    ],
    [
      'quantifier under a negation under a conjunction',
      {
        kind: 'and',
        left: {
          kind: 'not',
          inner: { kind: 'forall', varName: 'x', body: inSet('x', 'Dog') },
        },
        right: mem(k('rex'), all('Red')),
      },
    ],
  ];

  it.each(CORPUS)('round-trips: %s', (_name, f) => {
    const src = renderFormula(f);
    const back = parseFormula(src, SIG);
    expect(back.ok, `render produced unparseable output: ${src}`).toBe(true);
    if (!back.ok) return;
    expect(back.formula, `render/parse disagreed on: ${src}`).toEqual(f);
  });

  it.each(CORPUS)('renders identically after a round trip: %s', (_name, f) => {
    const once = renderFormula(f);
    expect(renderFormula(parse(once))).toBe(once);
  });

  it('round-trips a formula given as a tile array', () => {
    const tiles = ['∀', 'x', '(', 'Dog', '(', 'x', ')', '→', 'Red', '(', 'x', ')', ')'];
    const f = parse(tiles);
    expect(renderFormula(f)).toBe('∀x (x ∈ Dog → x ∈ Red)');
    expect(parse(renderFormula(f))).toEqual(f);
  });

  it('is deterministic: the same formula renders identically every time', () => {
    for (const [, f] of CORPUS) {
      expect(renderFormula(f)).toBe(renderFormula(f));
    }
  });
});

// ---------------------------------------------------------------------------
// Round trip, exhaustively-ish
// ---------------------------------------------------------------------------

describe('round trip holds for formulas nobody thought of', () => {
  // The hand-built corpus above only covers the traps we anticipated. The
  // round-trip law is universal, so pit the renderer against a generator instead.
  // Seeded and therefore deterministic: a failure here is reproducible, and the
  // suite never goes red at random.
  const LCG_A = 1664525;
  const LCG_C = 1013904223;
  const LCG_M = 2 ** 32;
  const SEED = 20260712;
  const SAMPLES = 3000;
  const MAX_DEPTH = 5;

  let seed = SEED;
  const rnd = (n: number): number => {
    seed = (LCG_A * seed + LCG_C) % LCG_M;
    return Math.floor((seed / LCG_M) * n);
  };
  const pick = <X,>(xs: readonly X[]): X => xs[rnd(xs.length)] as X;

  // Variables never collide with a signature name — that is renderFormula's
  // documented precondition, and the tile palette enforces it for real learners.
  const VARS = ['x', 'y', 'z'] as const;
  const term = (): Term =>
    rnd(4) === 0 ? k(pick(SIG.constants)) : v(pick(VARS));

  const setExpr = (d: number): SetExpr => {
    const leaf = d <= 0 ? 0 : rnd(7);
    switch (leaf) {
      case 0:
        return pick([
          set(pick(SIG.sets)),
          { kind: 'emptyset' },
          { kind: 'universe' },
        ] as const);
      case 1:
        return { kind: 'union', left: setExpr(d - 1), right: setExpr(d - 1) };
      case 2:
        return { kind: 'inter', left: setExpr(d - 1), right: setExpr(d - 1) };
      case 3:
        return { kind: 'diff', left: setExpr(d - 1), right: setExpr(d - 1) };
      case 4:
        return { kind: 'compl', inner: setExpr(d - 1) };
      case 5:
        return { kind: 'builder', varName: pick(VARS), body: formula(d - 1) };
      default:
        return set(pick(SIG.sets));
    }
  };

  const formula = (d: number): Formula => {
    const leaf = d <= 0 ? rnd(5) : rnd(14);
    switch (leaf) {
      case 0:
        return { kind: 'member', term: term(), set: setExpr(Math.min(d, 2)) };
      case 1:
        return { kind: 'eq', left: term(), right: term() };
      case 2:
        return { kind: 'rel', name: pick(SIG.relations), left: term(), right: term() };
      case 3:
        return pick([{ kind: 'true' }, { kind: 'false' }] as const);
      case 4:
        return { kind: 'subset', left: setExpr(Math.min(d, 2)), right: setExpr(Math.min(d, 2)) };
      case 5:
        return { kind: 'seteq', left: setExpr(Math.min(d, 2)), right: setExpr(Math.min(d, 2)) };
      case 6:
        return { kind: 'not', inner: formula(d - 1) };
      case 7:
        return { kind: 'and', left: formula(d - 1), right: formula(d - 1) };
      case 8:
        return { kind: 'or', left: formula(d - 1), right: formula(d - 1) };
      case 9:
        return { kind: 'implies', left: formula(d - 1), right: formula(d - 1) };
      case 10:
        return { kind: 'iff', left: formula(d - 1), right: formula(d - 1) };
      case 11:
        return { kind: 'forall', varName: pick(VARS), body: formula(d - 1) };
      case 12:
        return { kind: 'exists', varName: pick(VARS), body: formula(d - 1) };
      default:
        return { kind: 'existsUnique', varName: pick(VARS), body: formula(d - 1) };
    }
  };

  /** Every node kind the generator is supposed to be able to reach. */
  const ALL_KINDS: ReadonlyArray<Formula['kind'] | SetExpr['kind']> = [
    'member', 'subset', 'seteq', 'eq', 'rel', 'not', 'and', 'or', 'implies', 'iff',
    'forall', 'exists', 'existsUnique', 'true', 'false',
    'set', 'union', 'inter', 'diff', 'compl', 'universe', 'emptyset', 'builder',
  ];

  const kindsIn = (f: Formula, seen: Set<string>): void => {
    seen.add(f.kind);
    switch (f.kind) {
      case 'member':
        setKindsIn(f.set, seen);
        break;
      case 'subset':
      case 'seteq':
        setKindsIn(f.left, seen);
        setKindsIn(f.right, seen);
        break;
      case 'not':
        kindsIn(f.inner, seen);
        break;
      case 'and':
      case 'or':
      case 'implies':
      case 'iff':
        kindsIn(f.left, seen);
        kindsIn(f.right, seen);
        break;
      case 'forall':
      case 'exists':
      case 'existsUnique':
        kindsIn(f.body, seen);
        break;
      default:
        break;
    }
  };

  const setKindsIn = (s: SetExpr, seen: Set<string>): void => {
    seen.add(s.kind);
    switch (s.kind) {
      case 'union':
      case 'inter':
      case 'diff':
        setKindsIn(s.left, seen);
        setKindsIn(s.right, seen);
        break;
      case 'compl':
        setKindsIn(s.inner, seen);
        break;
      case 'builder':
        kindsIn(s.body, seen);
        break;
      default:
        break;
    }
  };

  it(`round-trips ${SAMPLES} generated formulas`, () => {
    const seen = new Set<string>();

    for (let n = 0; n < SAMPLES; n += 1) {
      const f = formula(MAX_DEPTH);
      kindsIn(f, seen);
      const src = renderFormula(f);
      const back = parseFormula(src, SIG);
      expect(back.ok, `render produced unparseable output: ${src}`).toBe(true);
      if (!back.ok) return;
      expect(back.formula, `render/parse disagreed on: ${src}`).toEqual(f);
      // Rendering is a fixed point: the printed form is already canonical.
      expect(renderFormula(back.formula)).toBe(src);
    }

    // A generator that only ever emitted ⊤ would pass every assertion above. This
    // is the assertion that makes the fuzz mean something.
    const missed = ALL_KINDS.filter((kind) => !seen.has(kind));
    expect(missed, `the generator never produced: ${missed.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------

describe('formulaSize', () => {
  it('counts every node: formula, set and term', () => {
    expect(formulaSize({ kind: 'true' })).toBe(1);
    expect(formulaSize(inSet('x', 'Dog'))).toBe(3); // member + var + set
    expect(formulaSize({ kind: 'not', inner: inSet('x', 'Dog') })).toBe(4);
    expect(formulaSize(parse('∀x (Dog(x) → Red(x))'))).toBe(8); // ∀ + → + 3 + 3
    expect(formulaSize({ kind: 'rel', name: 'Likes', left: v('x'), right: v('y') })).toBe(3);
  });

  it('counts inside set expressions and set-builders', () => {
    expect(formulaSize(parse('x ∈ A ∪ B'))).toBe(5); // member + var + ∪ + A + B
    expect(formulaSize(parse('A ⊆ B'))).toBe(3);
    expect(formulaSize(parse('{ x | Dog(x) } ⊆ A'))).toBe(6); // ⊆ + builder + (member+var+set) + A
  });

  it('grows with the formula, so it can score "say it with fewer pieces"', () => {
    expect(formulaSize(parse('Dog(x)'))).toBeLessThan(formulaSize(parse('Dog(x) ∧ Red(x)')));
  });
});
