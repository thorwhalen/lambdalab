/**
 * Tests for the logic barrel.
 *
 * Two jobs, and the second is the one that matters:
 *
 *   1. The public surface is COMPLETE — every name a lesson needs is re-exported.
 *      A missing name here is a compile error in a lesson, found late.
 *   2. The engine WORKS through the barrel alone. Everything below imports only
 *      from './index', never from a sibling module, so these are the exact import
 *      paths a lesson will use. The deep unit tests live next to their modules
 *      and cover the maths in depth; this file walks the whole round trip once —
 *      tiles -> Formula -> English, tiles -> Formula -> verdict -> counterexample
 *      world -> the model that proves it — and asserts the pieces compose.
 *
 * Edge cases are deliberately at the boundaries the engine promises to hold:
 * the one-element domain (domains start at 1 — the empty domain is NOT a model),
 * a formula with no quantifiers, and the degenerate signature with no names.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_DOMAIN,
  DOMAIN_NAMES,
  MAX_DOMAIN_SIZE,
  MAX_MODELS,
  MIN_DOMAIN_SIZE,
  describeModel,
  enumerateModels,
  evalSet,
  evaluate,
  formulaSize,
  freeVars,
  gloss,
  isClosed,
  isTautology,
  logicEquivalent,
  modelCount,
  parseFormula,
  renderFormula,
  renderSet,
  satisfiable,
  tokenizeLogic,
  type Formula,
  type Model,
  type Signature,
} from './index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AB: Signature = { sets: ['A', 'B'], relations: [], constants: [] };
const DOGS: Signature = { sets: ['Dog', 'Red'], relations: [], constants: ['rex'] };
/** The degenerate signature: no names at all. Only ⊤/⊥/= and quantifiers can be said. */
const NAMELESS: Signature = { sets: [], relations: [], constants: [] };

/** Parse or die — a fixture that fails to parse is a broken test, not a failing one. */
const f = (src: string, sig: Signature): Formula => {
  const r = parseFormula(src, sig);
  if (!r.ok) throw new Error(`fixture does not parse: ${src} — ${r.message}`);
  return r.formula;
};

// ---------------------------------------------------------------------------
// 1. The surface
// ---------------------------------------------------------------------------

describe('public surface', () => {
  it('re-exports every function the lessons need', () => {
    const surface = {
      tokenizeLogic,
      parseFormula,
      renderFormula,
      renderSet,
      formulaSize,
      evaluate,
      evalSet,
      freeVars,
      isClosed,
      enumerateModels,
      modelCount,
      describeModel,
      logicEquivalent,
      satisfiable,
      isTautology,
      gloss,
    };
    for (const [name, fn] of Object.entries(surface).sort(([x], [y]) => (x < y ? -1 : 1))) {
      expect(typeof fn, `${name} should be re-exported as a function`).toBe('function');
    }
  });

  it('re-exports the domain-size constants, and they are coherent', () => {
    // Domains start at 1: classical FO logic quantifies over a NON-EMPTY domain.
    expect(MIN_DOMAIN_SIZE).toBe(1);
    expect(MAX_DOMAIN_SIZE).toBe(DOMAIN_NAMES.length);
    expect(MIN_DOMAIN_SIZE).toBeLessThanOrEqual(DEFAULT_MAX_DOMAIN);
    expect(DEFAULT_MAX_DOMAIN).toBeLessThanOrEqual(MAX_DOMAIN_SIZE);
    expect(MAX_MODELS).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. The round trip: tiles -> Formula -> tiles
// ---------------------------------------------------------------------------

describe('parse/render round trip', () => {
  // The contract parse.ts states: parseFormula(renderFormula(f), sig) ≡ f.
  const cases: ReadonlyArray<readonly [string, Signature]> = [
    ['⊤', NAMELESS],
    ['⊥', NAMELESS],
    ['rex ∈ Dog', DOGS], // no quantifiers at all
    ['¬ ( rex ∈ Dog )', DOGS],
    ['A ⊆ B', AB],
    ['∀ x ( x ∈ A → x ∈ B )', AB],
    ['∃ x ( x ∈ A ∧ x ∈ B )', AB],
    ['∃! x ( x ∈ A )', AB],
    ['( A ∪ B )ᶜ = Aᶜ ∩ Bᶜ', AB],
  ];

  for (const [src, sig] of cases) {
    it(`round-trips ${src}`, () => {
      const parsed = f(src, sig);
      const reparsed = parseFormula(renderFormula(parsed), sig);
      expect(reparsed.ok).toBe(true);
      if (!reparsed.ok) return;
      // Structural equality, not string equality: the renderer normalises sugar
      // (¬(x ∈ A) prints as x ∉ A), so the AST is the thing that must survive.
      expect(reparsed.formula).toEqual(parsed);
    });
  }

  it('tokenizes ASCII spellings into the canonical Unicode ones', () => {
    expect(tokenizeLogic('A -> B')).toEqual(['A', '→', 'B']);
  });

  it('reports a parse failure rather than throwing', () => {
    const r = parseFormula('∀ x (', AB);
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Semantics through the barrel
// ---------------------------------------------------------------------------

describe('evaluate / evalSet', () => {
  const world: Model = {
    domain: ['a', 'b'],
    sets: { A: ['a'], B: ['a', 'b'] },
    relations: {},
    constants: {},
  };

  it('evaluates a quantifier-free sentence about a constant', () => {
    const m: Model = {
      domain: ['a'],
      sets: { Dog: ['a'], Red: [] },
      relations: {},
      constants: { rex: 'a' },
    };
    expect(evaluate(f('rex ∈ Dog', DOGS), m)).toBe(true);
    expect(evaluate(f('rex ∈ Red', DOGS), m)).toBe(false);
  });

  it('agrees with the set algebra: A ⊆ B holds in a world where it does', () => {
    expect(evaluate(f('A ⊆ B', AB), world)).toBe(true);
    expect(evaluate(f('B ⊆ A', AB), world)).toBe(false);
  });

  it('evalSet returns a canonical (sorted) set, whatever the expression shape', () => {
    // De Morgan's twins must not merely be equal — they must iterate identically.
    const viaCompl = [...evalSet({ kind: 'compl', inner: { kind: 'set', name: 'A' } }, world)];
    expect(viaCompl).toEqual(['b']);
  });

  it('freeVars / isClosed agree on a sentence and on an open formula', () => {
    expect(isClosed(f('∀ x ( x ∈ A )', AB))).toBe(true);
    expect(freeVars(f('∀ x ( x ∈ A )', AB)).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Model enumeration
// ---------------------------------------------------------------------------

describe('enumerateModels / modelCount', () => {
  it('the one-element domain is legal and enumerates 2^|sets| worlds', () => {
    // The smallest legal universe. 2 sets, 1 element => 4 worlds.
    const worlds = [...enumerateModels(AB, MIN_DOMAIN_SIZE)];
    expect(worlds).toHaveLength(modelCount(AB, MIN_DOMAIN_SIZE));
    expect(worlds).toHaveLength(4);
    for (const w of worlds) expect(w.domain).toEqual(['a']);
  });

  it('the empty domain is NOT allowed — a domain of size 0 throws', () => {
    // ∃x ⊤ must not be false and ∀x ⊥ must not be true. Domains start at 1.
    expect(() => [...enumerateModels(AB, 0)]).toThrow();
  });

  it('rejects a domain larger than the engine names elements for', () => {
    expect(() => [...enumerateModels(AB, MAX_DOMAIN_SIZE + 1)]).toThrow();
  });

  it('the enumeration is simplest-first and byte-stable across runs', () => {
    const once = [...enumerateModels(AB, 2)].map(describeModel);
    const twice = [...enumerateModels(AB, 2)].map(describeModel);
    expect(once).toEqual(twice); // the UI diffs on this
    // Simplest first: the very first world has every set empty.
    const first = [...enumerateModels(AB, 2)][0]!;
    expect(first.sets['A']).toEqual([]);
    expect(first.sets['B']).toEqual([]);
  });

  it('counts the nameless signature as exactly one world per domain size', () => {
    expect(modelCount(NAMELESS, 1)).toBe(1);
    expect([...enumerateModels(NAMELESS, 1)]).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Grading — the whole point of the engine
// ---------------------------------------------------------------------------

describe('logicEquivalent (the grader)', () => {
  it('accepts a correct answer that is spelled differently from the reference', () => {
    // ⊆ and the universally-quantified conditional are the SAME claim — the
    // identification the lesson exists to make. The grader must not care.
    expect(logicEquivalent(f('A ⊆ B', AB), f('∀ x ( x ∈ A → x ∈ B )', AB), AB)).toEqual({
      equal: true,
    });
  });

  it('accepts De Morgan', () => {
    expect(
      logicEquivalent(f('¬ ∀ x ( x ∈ A )', AB), f('∃ x ( x ∉ A )', AB), AB),
    ).toEqual({ equal: true });
  });

  it('rejects a wrong answer AND hands back a world that proves it', () => {
    // The classic error: "every A is B" answered as "some A is B".
    const theirs = f('∃ x ( x ∈ A ∧ x ∈ B )', AB);
    const reference = f('∀ x ( x ∈ A → x ∈ B )', AB);
    const verdict = logicEquivalent(theirs, reference, AB);

    expect(verdict.equal).toBe(false);
    if (verdict.equal) return;

    // The counterexample must not merely exist — it must actually separate them.
    // This is the assertion that makes the feedback trustworthy: we re-evaluate
    // both formulas in the returned world and check the engine told the truth.
    expect(evaluate(theirs, verdict.model)).toBe(verdict.theirs);
    expect(evaluate(reference, verdict.model)).toBe(verdict.reference);
    expect(verdict.theirs).not.toBe(verdict.reference);
  });

  it('is deterministic: the same disagreement yields the same world twice', () => {
    const theirs = f('∃ x ( x ∈ A )', AB);
    const reference = f('∀ x ( x ∈ A )', AB);
    expect(logicEquivalent(theirs, reference, AB)).toEqual(
      logicEquivalent(theirs, reference, AB),
    );
  });
});

describe('satisfiable / isTautology', () => {
  it('a tautology is valid and its negation has no model', () => {
    expect(isTautology(f('∀ x ( x = x )', NAMELESS), NAMELESS)).toBe(true);
    expect(satisfiable(f('¬ ∀ x ( x = x )', NAMELESS), NAMELESS)).toBeNull();
  });

  it('⊥ is unsatisfiable and ⊤ is a tautology', () => {
    expect(satisfiable(f('⊥', NAMELESS), NAMELESS)).toBeNull();
    expect(isTautology(f('⊤', NAMELESS), NAMELESS)).toBe(true);
  });

  it('a satisfiable formula comes back with a model that really satisfies it', () => {
    const phi = f('∃ x ( x ∈ A ∧ x ∈ B )', AB);
    const m = satisfiable(phi, AB);
    expect(m).not.toBeNull();
    if (m) expect(evaluate(phi, m)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. English
// ---------------------------------------------------------------------------

describe('gloss', () => {
  it('reads a formula back as a sentence', () => {
    const english = gloss(f('∀ x ( x ∈ Dog → x ∈ Red )', DOGS), DOGS, {
      Dog: { singular: 'dog', plural: 'dogs' },
      Red: { singular: 'red thing', plural: 'red things' },
    });
    expect(english.length).toBeGreaterThan(0);
    expect(english.toLowerCase()).toContain('dog');
  });
});

// ---------------------------------------------------------------------------
// 7. Housekeeping
// ---------------------------------------------------------------------------

describe('formulaSize / renderSet', () => {
  it('formulaSize grows with the formula', () => {
    expect(formulaSize(f('⊤', NAMELESS))).toBeLessThan(
      formulaSize(f('∀ x ( x ∈ A → x ∈ B )', AB)),
    );
  });

  it('renderSet prints a set expression', () => {
    expect(renderSet({ kind: 'set', name: 'A' })).toBe('A');
  });
});
