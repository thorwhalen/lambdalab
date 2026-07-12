/**
 * Adversarial property-based tests for the logic engine.
 *
 * The unit suites next door test the engine against examples its authors thought
 * of. This one is written from the opposite posture: assume the engine is subtly
 * wrong, and go looking. Everything here is either (a) a property that must hold
 * for EVERY formula, checked over a randomly generated corpus, or (b) a claim the
 * modules make in prose, pinned as an executable assertion.
 *
 * Three rules keep this file honest:
 *
 *  1. **The oracle is independent.** `refEval` below is a second, complete
 *     implementation of Tarskian semantics written over boolean ARRAYS (a
 *     membership vector per set, an adjacency matrix per relation) rather than
 *     `Set`s, with its own term denotation and its own model enumeration. If both
 *     implementations share a bug, they share it by coincidence, not by
 *     construction. Where a property could be checked either against the engine or
 *     against the oracle, it is checked against the oracle.
 *
 *  2. **Randomness is seeded and self-contained.** `Math.random` and `Date.now`
 *     are unavailable, and would be the wrong thing anyway: a fuzz failure nobody
 *     can reproduce is a rumour. `makeRng` is a mulberry32 — pure, 32-bit, and
 *     identical on every platform. Every generator takes it explicitly, so a
 *     failing case is reproduced by re-running with the same seed.
 *
 *  3. **A counterexample must actually counter.** Anywhere the engine hands back a
 *     separating model, the test re-evaluates BOTH formulas in it — with the
 *     independent oracle — and asserts they genuinely differ there. A grader that
 *     says "wrong, look at this world" and shows a world that proves nothing is a
 *     worse bug than one that just says "wrong".
 *
 * Domains start at size 1 throughout: the empty domain is not a model of anything
 * in classical first-order logic, and the engine is right to refuse it.
 */

import { describe, expect, it } from 'vitest';

import { gloss } from './english';
import { isTautology, logicEquivalent, satisfiable } from './equivalence';
import { evaluate, freeVars } from './evaluate';
import { DOMAIN_NAMES, enumerateModels, modelCount } from './models';
import { parseFormula, renderFormula, renderSet, tokenizeLogic } from './parse';
import type { Formula, Model, SetExpr, Signature, Term } from './types';

// ---------------------------------------------------------------------------
// The little world every fuzz case is drawn from
// ---------------------------------------------------------------------------

/** Two sets, one binary relation, one constant, two variables. The task's alphabet. */
const SET_NAMES = ['A', 'B'] as const;
const REL_NAME = 'R';
const CONST_NAME = 'c';
const VAR_NAMES = ['x', 'y'] as const;

const SIG: Signature = { sets: [...SET_NAMES], relations: [REL_NAME], constants: [CONST_NAME] };

/**
 * The same world minus the relation. A relation costs 2^(n²) interpretations, so
 * exhaustive oracle checks that want domain size 3 use this one and stay cheap;
 * relation-bearing properties run at size 2, which is already enough to separate
 * ∀∃ from ∃∀.
 */
const SIG_NO_REL: Signature = { sets: [...SET_NAMES], relations: [], constants: [CONST_NAME] };

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32
// ---------------------------------------------------------------------------

type Rng = () => number;

const MULBERRY_STEP = 0x6d2b79f5;
const TWO_POW_32 = 4294967296;

/** Pure, seeded, platform-identical. A fuzz failure must be reproducible from its seed alone. */
function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + MULBERRY_STEP) >>> 0;
    let z = Math.imul(state ^ (state >>> 15), 1 | state);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / TWO_POW_32;
  };
}

/** `% n` is belt-and-braces: rng() is in [0,1), so floor can never reach n. */
const below = (rng: Rng, n: number): number => Math.floor(rng() * n) % n;

function pick<T>(rng: Rng, xs: readonly T[]): T {
  return xs[below(rng, xs.length)];
}

// ---------------------------------------------------------------------------
// Random formula generation
//
// `scope` is the list of variables a term may legally mention. Start it empty and
// every formula produced is a SENTENCE (a term can then only be the constant, and
// a variable enters scope only by being bound); start it with x and y and the
// generator produces open formulas, which is what the parse/render round trip
// wants — free variables are the cheapest way to reach every atom shape.
// ---------------------------------------------------------------------------

interface GenOpts {
  /** Whether R(_, _) may appear. Off for the cheap relation-free oracle checks. */
  readonly withRelation: boolean;
}

function genTerm(rng: Rng, scope: readonly string[]): Term {
  const choices: Term[] = scope.map((name) => ({ kind: 'var', name }));
  choices.push({ kind: 'const', name: CONST_NAME });
  return pick(rng, choices);
}

const extend = (scope: readonly string[], v: string): string[] =>
  scope.includes(v) ? [...scope] : [...scope, v];

function genSet(rng: Rng, depth: number, scope: readonly string[], opts: GenOpts): SetExpr {
  const leaves: Array<() => SetExpr> = [
    () => ({ kind: 'set', name: SET_NAMES[0] }),
    () => ({ kind: 'set', name: SET_NAMES[1] }),
    () => ({ kind: 'universe' }),
    () => ({ kind: 'emptyset' }),
  ];
  if (depth <= 0) return pick(rng, leaves)();

  const compounds: Array<() => SetExpr> = [
    () => ({
      kind: 'union',
      left: genSet(rng, depth - 1, scope, opts),
      right: genSet(rng, depth - 1, scope, opts),
    }),
    () => ({
      kind: 'inter',
      left: genSet(rng, depth - 1, scope, opts),
      right: genSet(rng, depth - 1, scope, opts),
    }),
    () => ({
      kind: 'diff',
      left: genSet(rng, depth - 1, scope, opts),
      right: genSet(rng, depth - 1, scope, opts),
    }),
    () => ({ kind: 'compl', inner: genSet(rng, depth - 1, scope, opts) }),
    () => {
      // A set-builder may reuse a name already in scope — shadowing is exactly the
      // kind of thing that breaks a naive substitution, so we want it in the corpus.
      const varName = pick(rng, VAR_NAMES);
      return {
        kind: 'builder',
        varName,
        body: genFormula(rng, depth - 1, extend(scope, varName), opts),
      };
    },
  ];
  return pick(rng, [...leaves, ...compounds])();
}

function genFormula(rng: Rng, depth: number, scope: readonly string[], opts: GenOpts): Formula {
  const atoms: Array<() => Formula> = [
    () => ({ kind: 'true' }),
    () => ({ kind: 'false' }),
    () => ({ kind: 'member', term: genTerm(rng, scope), set: genSet(rng, 0, scope, opts) }),
    () => ({ kind: 'eq', left: genTerm(rng, scope), right: genTerm(rng, scope) }),
    () => ({ kind: 'subset', left: genSet(rng, 0, scope, opts), right: genSet(rng, 0, scope, opts) }),
    () => ({ kind: 'seteq', left: genSet(rng, 0, scope, opts), right: genSet(rng, 0, scope, opts) }),
  ];
  if (opts.withRelation) {
    atoms.push(() => ({
      kind: 'rel',
      name: REL_NAME,
      left: genTerm(rng, scope),
      right: genTerm(rng, scope),
    }));
  }
  if (depth <= 0) return pick(rng, atoms)();

  const quantify = (kind: 'forall' | 'exists' | 'existsUnique'): Formula => {
    const varName = pick(rng, VAR_NAMES);
    return { kind, varName, body: genFormula(rng, depth - 1, extend(scope, varName), opts) };
  };

  const compounds: Array<() => Formula> = [
    () => ({ kind: 'not', inner: genFormula(rng, depth - 1, scope, opts) }),
    () => ({
      kind: 'and',
      left: genFormula(rng, depth - 1, scope, opts),
      right: genFormula(rng, depth - 1, scope, opts),
    }),
    () => ({
      kind: 'or',
      left: genFormula(rng, depth - 1, scope, opts),
      right: genFormula(rng, depth - 1, scope, opts),
    }),
    () => ({
      kind: 'implies',
      left: genFormula(rng, depth - 1, scope, opts),
      right: genFormula(rng, depth - 1, scope, opts),
    }),
    () => ({
      kind: 'iff',
      left: genFormula(rng, depth - 1, scope, opts),
      right: genFormula(rng, depth - 1, scope, opts),
    }),
    () => quantify('forall'),
    () => quantify('exists'),
    () => quantify('existsUnique'),
    // Deep set expressions in the three slots that can hold one.
    () => ({
      kind: 'member',
      term: genTerm(rng, scope),
      set: genSet(rng, depth - 1, scope, opts),
    }),
    () => ({
      kind: 'subset',
      left: genSet(rng, depth - 1, scope, opts),
      right: genSet(rng, depth - 1, scope, opts),
    }),
    () => ({
      kind: 'seteq',
      left: genSet(rng, depth - 1, scope, opts),
      right: genSet(rng, depth - 1, scope, opts),
    }),
  ];
  return pick(rng, [...atoms, ...compounds])();
}

const WITH_REL: GenOpts = { withRelation: true };
const NO_REL: GenOpts = { withRelation: false };

/** A closed formula: only bound variables and the constant can appear in a term. */
const genSentence = (rng: Rng, depth: number, opts: GenOpts): Formula =>
  genFormula(rng, depth, [], opts);

/** An open formula: x and y are free, which reaches atom shapes a sentence rarely does. */
const genOpen = (rng: Rng, depth: number, opts: GenOpts): Formula =>
  genFormula(rng, depth, VAR_NAMES, opts);

// ---------------------------------------------------------------------------
// The independent oracle
//
// A second semantics, deliberately built out of different materials: a set is a
// boolean vector indexed by domain position, a relation is a boolean matrix, a
// term denotes an INDEX rather than a name. Nothing here imports from evaluate.ts,
// and nothing here uses `Set`. If it agrees with `evaluate` on tens of thousands of
// (formula, model) pairs, the agreement means something.
// ---------------------------------------------------------------------------

interface World {
  /** Sorted, so the oracle and the engine agree on which element is which. */
  readonly elems: string[];
  readonly index: Record<string, number>;
  /** setName -> membership vector, one boolean per domain position. */
  readonly sets: Record<string, boolean[]>;
  /** relName -> adjacency matrix, rel[i][j] == the pair (elems[i], elems[j]). */
  readonly rels: Record<string, boolean[][]>;
  /** constName -> the domain INDEX it names. */
  readonly consts: Record<string, number>;
}

/** Own-property test. A set named `constructor` must not resolve off Object.prototype. */
const owns = (r: Record<string, unknown>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(r, k);

function toWorld(m: Model): World {
  const elems = [...m.domain].sort();
  if (elems.length === 0) throw new Error('oracle: empty domain');

  const index: Record<string, number> = Object.create(null);
  elems.forEach((e, i) => {
    index[e] = i;
  });

  const at = (e: string, where: string): number => {
    if (!owns(index, e)) throw new Error(`oracle: ${where} names '${e}', not in the domain`);
    return index[e];
  };

  const sets: Record<string, boolean[]> = Object.create(null);
  for (const name of Object.keys(m.sets).sort()) {
    const vec = elems.map(() => false);
    for (const e of m.sets[name]) vec[at(e, `set ${name}`)] = true;
    sets[name] = vec;
  }

  const rels: Record<string, boolean[][]> = Object.create(null);
  for (const name of Object.keys(m.relations).sort()) {
    const mat = elems.map(() => elems.map(() => false));
    for (const [a, b] of m.relations[name]) {
      mat[at(a, `relation ${name}`)][at(b, `relation ${name}`)] = true;
    }
    rels[name] = mat;
  }

  const consts: Record<string, number> = Object.create(null);
  for (const name of Object.keys(m.constants).sort()) {
    consts[name] = at(m.constants[name], `constant ${name}`);
  }

  return { elems, index, sets, rels, consts };
}

/** Variable -> domain index. Distinct from the engine's Assignment (which maps to names). */
type IdxEnv = Record<string, number>;

function refDenote(t: Term, w: World, env: IdxEnv): number {
  if (t.kind === 'var') {
    if (!owns(env, t.name)) throw new Error(`oracle: unbound variable '${t.name}'`);
    return env[t.name];
  }
  if (!owns(w.consts, t.name)) throw new Error(`oracle: unknown constant '${t.name}'`);
  return w.consts[t.name];
}

function refSet(s: SetExpr, w: World, env: IdxEnv): boolean[] {
  const n = w.elems.length;
  switch (s.kind) {
    case 'set': {
      if (!owns(w.sets, s.name)) throw new Error(`oracle: unknown set '${s.name}'`);
      return w.sets[s.name];
    }
    case 'universe':
      return new Array<boolean>(n).fill(true);
    case 'emptyset':
      return new Array<boolean>(n).fill(false);
    case 'union': {
      const l = refSet(s.left, w, env);
      const r = refSet(s.right, w, env);
      return l.map((v, i) => v || r[i]);
    }
    case 'inter': {
      const l = refSet(s.left, w, env);
      const r = refSet(s.right, w, env);
      return l.map((v, i) => v && r[i]);
    }
    case 'diff': {
      const l = refSet(s.left, w, env);
      const r = refSet(s.right, w, env);
      return l.map((v, i) => v && !r[i]);
    }
    case 'compl':
      return refSet(s.inner, w, env).map((v) => !v);
    case 'builder': {
      const out: boolean[] = [];
      for (let i = 0; i < n; i += 1) {
        out.push(refEval(s.body, w, { ...env, [s.varName]: i }));
      }
      return out;
    }
  }
}

function refEval(f: Formula, w: World, env: IdxEnv): boolean {
  const n = w.elems.length;
  switch (f.kind) {
    case 'true':
      return true;
    case 'false':
      return false;
    case 'member':
      return refSet(f.set, w, env)[refDenote(f.term, w, env)];
    case 'eq':
      return refDenote(f.left, w, env) === refDenote(f.right, w, env);
    case 'rel': {
      if (!owns(w.rels, f.name)) throw new Error(`oracle: unknown relation '${f.name}'`);
      return w.rels[f.name][refDenote(f.left, w, env)][refDenote(f.right, w, env)];
    }
    case 'subset': {
      const l = refSet(f.left, w, env);
      const r = refSet(f.right, w, env);
      return l.every((v, i) => !v || r[i]);
    }
    case 'seteq': {
      const l = refSet(f.left, w, env);
      const r = refSet(f.right, w, env);
      return l.every((v, i) => v === r[i]);
    }
    case 'not':
      return !refEval(f.inner, w, env);
    case 'and':
      return refEval(f.left, w, env) && refEval(f.right, w, env);
    case 'or':
      return refEval(f.left, w, env) || refEval(f.right, w, env);
    case 'implies':
      return !refEval(f.left, w, env) || refEval(f.right, w, env);
    case 'iff':
      return refEval(f.left, w, env) === refEval(f.right, w, env);
    case 'forall': {
      for (let i = 0; i < n; i += 1) {
        if (!refEval(f.body, w, { ...env, [f.varName]: i })) return false;
      }
      return true;
    }
    case 'exists': {
      for (let i = 0; i < n; i += 1) {
        if (refEval(f.body, w, { ...env, [f.varName]: i })) return true;
      }
      return false;
    }
    case 'existsUnique': {
      let witnesses = 0;
      for (let i = 0; i < n; i += 1) {
        if (refEval(f.body, w, { ...env, [f.varName]: i })) witnesses += 1;
      }
      return witnesses === 1;
    }
  }
}

// ---------------------------------------------------------------------------
// The independent model enumeration
//
// Same product space as `models.ts`, reached a different way: masks are visited in
// plain numeric order (not popcount order), which is enough that a bug in the
// engine's ordering machinery cannot hide by being replicated here. Only the SET of
// models is ever compared, never the order.
// ---------------------------------------------------------------------------

function* refModels(sig: Signature, n: number): Generator<Model> {
  const domain = DOMAIN_NAMES.slice(0, n);
  const sets = [...new Set(sig.sets)].sort();
  const rels = [...new Set(sig.relations)].sort();
  const consts = [...new Set(sig.constants)].sort();

  const sizes = [
    ...sets.map(() => 2 ** n),
    ...rels.map(() => 2 ** (n * n)),
    ...consts.map(() => n),
  ];
  const digits = sizes.map(() => 0);

  for (;;) {
    const m: Model = { domain: [...domain], sets: {}, relations: {}, constants: {} };
    let k = 0;
    for (const name of sets) {
      const mask = digits[k];
      m.sets[name] = domain.filter((_e, i) => ((mask >>> i) & 1) === 1);
      k += 1;
    }
    for (const name of rels) {
      const mask = digits[k];
      const pairs: Array<[string, string]> = [];
      for (let bit = 0; bit < n * n; bit += 1) {
        if (((mask >>> bit) & 1) === 1) pairs.push([domain[Math.floor(bit / n)], domain[bit % n]]);
      }
      m.relations[name] = pairs;
      k += 1;
    }
    for (const name of consts) {
      m.constants[name] = domain[digits[k]];
      k += 1;
    }
    yield m;

    let j = sizes.length - 1;
    while (j >= 0) {
      digits[j] += 1;
      if (digits[j] < sizes[j]) break;
      digits[j] = 0;
      j -= 1;
    }
    if (j < 0) return;
  }
}

/** Every world of size 1..maxN over `sig`, pre-compiled. Built once, reused across formulas. */
function allWorlds(sig: Signature, maxN: number): World[] {
  const out: World[] = [];
  for (let n = 1; n <= maxN; n += 1) {
    for (const m of refModels(sig, n)) out.push(toWorld(m));
  }
  return out;
}

/** The formula's truth value in every world, as a bitstring. Equal strings == equivalent (to maxN). */
function truthVector(f: Formula, worlds: readonly World[]): string {
  return worlds.map((w) => (refEval(f, w, {}) ? '1' : '0')).join('');
}

/** Smallest domain size at which some model separates the two, or null if none up to maxN. */
function minSeparatingSize(a: Formula, b: Formula, sig: Signature, maxN: number): number | null {
  for (let n = 1; n <= maxN; n += 1) {
    for (const m of refModels(sig, n)) {
      const w = toWorld(m);
      if (refEval(a, w, {}) !== refEval(b, w, {})) return n;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/** Parse or die. A test fixture that does not parse is a broken test, not a failing assertion. */
function P(src: string, sig: Signature = SIG): Formula {
  const r = parseFormula(src, sig);
  if (!r.ok) throw new Error(`fixture does not parse: ${src} — ${r.message}`);
  return r.formula;
}

// ---------------------------------------------------------------------------
// 1. Parse / render round trip
// ---------------------------------------------------------------------------

describe('parse ∘ render = id (the contract parse.ts states in its docstring)', () => {
  const ROUND_TRIP_CASES = 4000;
  const MAX_DEPTH = 4;

  it('round-trips every randomly generated formula, structurally', () => {
    const rng = makeRng(0xc0ffee);
    const failures: string[] = [];

    for (let i = 0; i < ROUND_TRIP_CASES; i += 1) {
      const depth = 1 + below(rng, MAX_DEPTH);
      const f = below(rng, 2) === 0 ? genOpen(rng, depth, WITH_REL) : genSentence(rng, depth, WITH_REL);
      const text = renderFormula(f);
      const back = parseFormula(text, SIG);

      if (!back.ok) {
        failures.push(`case ${i}: rendered "${text}" does not re-parse — ${back.message}\n  from ${JSON.stringify(f)}`);
        continue;
      }
      if (JSON.stringify(back.formula) !== JSON.stringify(f)) {
        failures.push(
          `case ${i}: "${text}" re-parses to a DIFFERENT tree\n  wrote:  ${JSON.stringify(f)}\n  read:   ${JSON.stringify(back.formula)}`,
        );
      }
    }

    expect(failures.slice(0, 5).join('\n---\n')).toBe('');
    expect(failures).toHaveLength(0);
  });

  it('render is idempotent through the parser (the printed form is a fixed point)', () => {
    const rng = makeRng(0x5eed);
    for (let i = 0; i < 1500; i += 1) {
      const f = genOpen(rng, 1 + below(rng, MAX_DEPTH), WITH_REL);
      const once = renderFormula(f);
      const back = parseFormula(once, SIG);
      expect(back.ok, `did not re-parse: ${once}`).toBe(true);
      if (!back.ok) continue;
      expect(renderFormula(back.formula), `not a fixed point: ${once}`).toBe(once);
    }
  });

  it('rendering is deterministic — two runs, byte-identical output', () => {
    const a = makeRng(7);
    const b = makeRng(7);
    for (let i = 0; i < 500; i += 1) {
      expect(renderFormula(genSentence(a, 3, WITH_REL))).toBe(
        renderFormula(genSentence(b, 3, WITH_REL)),
      );
    }
  });

  it('round-trips through a TILE ARRAY too (the door the UI actually uses)', () => {
    // The learner never types: the palette emits one token per tile. `parseFormula`
    // promises a string and a tile array reach the same parser, so the round trip has
    // to hold through the array door as well.
    const rng = makeRng(0x71133);
    for (let i = 0; i < 1500; i += 1) {
      const f = genOpen(rng, 1 + below(rng, 4), WITH_REL);
      const tiles = tokenizeLogic(renderFormula(f));
      const back = parseFormula(tiles, SIG);
      expect(back.ok, `tiles [${tiles.join(' ')}] did not parse`).toBe(true);
      if (!back.ok) continue;
      expect(back.formula).toEqual(f);
    }
  });

  it('renderSet round-trips: c ∈ renderSet(s) reads back the same set expression', () => {
    const rng = makeRng(0x5e75);
    for (let i = 0; i < 2000; i += 1) {
      const s = genSet(rng, 1 + below(rng, 4), [], WITH_REL);
      const text = `c ∈ ${renderSet(s)}`;
      const back = parseFormula(text, SIG);
      expect(back.ok, `${text} did not parse`).toBe(true);
      if (!back.ok) continue;
      expect(back.formula).toEqual({ kind: 'member', term: { kind: 'const', name: 'c' }, set: s });
    }
  });

  it('parseFormula is TOTAL: arbitrary token soup returns a verdict, never an exception', () => {
    // The contract in parse.ts says it never throws. A learner who has half-built a
    // formula is *constantly* in an unparseable state, so an exception here is a
    // crashed lesson, not a caught error.
    const ALPHABET = [
      '∀', '∃', '∃!', '¬', '∧', '∨', '→', '↔', '∈', '∉', '∪', '∩', '∖', 'ᶜ',
      '⊆', '=', '≠', '∅', '𝕌', '⊤', '⊥', '(', ')', '{', '}', '|', ',',
      'A', 'B', 'R', 'c', 'x', 'y', 'Zzz', '!', '?', '@',
    ];
    const rng = makeRng(0x50a9);
    for (let i = 0; i < 4000; i += 1) {
      const len = 1 + below(rng, 14);
      const tokens = Array.from({ length: len }, () => pick(rng, ALPHABET));
      const src = tokens.join(' ');

      const r = parseFormula(src, SIG);
      expect(typeof r.ok, `threw or returned junk on: ${src}`).toBe('boolean');
      if (r.ok) {
        // Anything that parses must render, and the render must re-parse to the same tree.
        const again = parseFormula(renderFormula(r.formula), SIG);
        expect(again.ok, `parsed "${src}" but its own rendering does not re-parse`).toBe(true);
        if (again.ok) expect(again.formula).toEqual(r.formula);
      } else {
        // `at` is a TOKEN index, so it must address a real token (or the end).
        const n = tokenizeLogic(src).length;
        expect(r.message.length, `empty error message on: ${src}`).toBeGreaterThan(0);
        if (r.at !== undefined) {
          expect(r.at, `at=${r.at} out of range for ${n} tokens: ${src}`).toBeGreaterThanOrEqual(0);
          expect(r.at, `at=${r.at} out of range for ${n} tokens: ${src}`).toBeLessThanOrEqual(n);
        }
      }
    }
  });

  it('an empty formula is a message, not a crash', () => {
    expect(parseFormula('', SIG).ok).toBe(false);
    expect(parseFormula([], SIG).ok).toBe(false);
    expect(parseFormula('   ', SIG).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Precedence is exactly what the docstring claims
// ---------------------------------------------------------------------------

describe('precedence and scope are what we claim they are', () => {
  const same = (a: string, b: string): void => {
    expect(P(a), `${a}  vs  ${b}`).toEqual(P(b));
  };
  const differ = (a: string, b: string): void => {
    expect(P(a), `${a}  vs  ${b}`).not.toEqual(P(b));
  };

  it('quantifier scope is MAXIMAL: ∀x A(x) ∧ B(x) ≡ ∀x (A(x) ∧ B(x))', () => {
    same('∀x A(x) ∧ B(x)', '∀x (A(x) ∧ B(x))');
    differ('∀x A(x) ∧ B(x)', '(∀x A(x)) ∧ B(c)');
  });

  it('a quantifier swallows even the loosest connectives', () => {
    same('∀x A(x) → B(x)', '∀x (A(x) → B(x))');
    same('∀x A(x) ↔ B(x)', '∀x (A(x) ↔ B(x))');
    same('∃x A(x) ∨ B(x)', '∃x (A(x) ∨ B(x))');
  });

  it('→ is right-associative: p → q → r is p → (q → r)', () => {
    same('A(c) → B(c) → R(c, c)', 'A(c) → (B(c) → R(c, c))');
    differ('A(c) → B(c) → R(c, c)', '(A(c) → B(c)) → R(c, c)');
  });

  it('∧ and ∨ and ↔ are left-associative', () => {
    same('A(c) ∧ B(c) ∧ R(c, c)', '(A(c) ∧ B(c)) ∧ R(c, c)');
    same('A(c) ∨ B(c) ∨ R(c, c)', '(A(c) ∨ B(c)) ∨ R(c, c)');
    same('A(c) ↔ B(c) ↔ R(c, c)', '(A(c) ↔ B(c)) ↔ R(c, c)');
  });

  it('¬ takes only the next unary: ¬A(x) ∧ B(x) is (¬A(x)) ∧ B(x)', () => {
    same('¬A(x) ∧ B(x)', '(¬A(x)) ∧ B(x)');
    differ('¬A(x) ∧ B(x)', '¬(A(x) ∧ B(x))');
  });

  it('but ¬ before a quantifier gets the whole quantifier', () => {
    same('¬∀x A(x)', '¬(∀x A(x))');
    // ...and the quantifier still swallows everything to its right, even under ¬.
    same('¬∀x A(x) ∧ B(x)', '¬(∀x (A(x) ∧ B(x)))');
  });

  it('the connective ladder: ↔ < → < ∨ < ∧ < ¬', () => {
    same('A(c) ∧ B(c) ∨ R(c, c)', '(A(c) ∧ B(c)) ∨ R(c, c)');
    same('A(c) ∨ B(c) → R(c, c)', '(A(c) ∨ B(c)) → R(c, c)');
    same('A(c) → B(c) ↔ R(c, c)', '(A(c) → B(c)) ↔ R(c, c)');
    same('¬A(c) ∨ B(c)', '(¬A(c)) ∨ B(c)');
  });

  it('∀x∃y R(x,y) is NOT ∃y∀x R(x,y) — the order of quantifiers is the whole lesson', () => {
    differ('∀x∃y R(x, y)', '∃y∀x R(x, y)');
    // And they really are different claims, not just different trees.
    expect(logicEquivalent(P('∀x∃y R(x, y)'), P('∃y∀x R(x, y)'), SIG).equal).toBe(false);
  });

  it('set operators: ᶜ > ∩ > (∪ ≈ ∖), and ∪/∖ associate left', () => {
    same('c ∈ A ∪ B ∩ A', 'c ∈ A ∪ (B ∩ A)');
    same('c ∈ Aᶜ ∩ B', 'c ∈ (Aᶜ) ∩ B');
    same('c ∈ A ∪ B ∖ A', 'c ∈ (A ∪ B) ∖ A');
    same('c ∈ A ∖ B ∪ A', 'c ∈ (A ∖ B) ∪ A');
    // ᶜ binds tighter than ∪, so the complement lands on B alone.
    same('c ∈ A ∪ Bᶜ', 'c ∈ A ∪ (Bᶜ)');
  });

  it('∉ and ≠ are sugar for ¬(∈) and ¬(=), and are the ONLY way those trees print', () => {
    expect(P('x ∉ A')).toEqual(P('¬(x ∈ A)'));
    expect(P('x ≠ c')).toEqual(P('¬(x = c)'));
    expect(P('A ≠ B')).toEqual(P('¬(A = B)'));
    expect(renderFormula(P('¬(x ∈ A)'))).toBe('x ∉ A');
    expect(renderFormula(P('¬(x = c)'))).toBe('x ≠ c');
  });

  it('Dog(x) is sugar for x ∈ Dog — one node, not two', () => {
    expect(P('A(x)')).toEqual(P('x ∈ A'));
    expect(renderFormula(P('A(x)'))).toBe('x ∈ A');
  });
});

// ---------------------------------------------------------------------------
// 3. evaluate agrees with the independent oracle
// ---------------------------------------------------------------------------

describe('evaluate agrees with an independent brute-force semantics', () => {
  /** A random world. Not drawn from enumerateModels — an independent shape of input. */
  function genModel(rng: Rng, sig: Signature): Model {
    const n = 1 + below(rng, DOMAIN_NAMES.length);
    const domain = DOMAIN_NAMES.slice(0, n);
    const m: Model = { domain: [...domain], sets: {}, relations: {}, constants: {} };
    for (const s of sig.sets) m.sets[s] = domain.filter(() => below(rng, 2) === 1);
    for (const r of sig.relations) {
      const pairs: Array<[string, string]> = [];
      for (const a of domain) for (const b of domain) if (below(rng, 2) === 1) pairs.push([a, b]);
      m.relations[r] = pairs;
    }
    for (const k of sig.constants) m.constants[k] = pick(rng, domain);
    return m;
  }

  it('agrees on random (sentence, random model) pairs', () => {
    const rng = makeRng(0xdecaf);
    let checked = 0;
    for (let i = 0; i < 3000; i += 1) {
      const f = genSentence(rng, 1 + below(rng, 4), WITH_REL);
      const m = genModel(rng, SIG);
      const engine = evaluate(f, m);
      const oracle = refEval(f, toWorld(m), {});
      expect(engine, `disagreement on ${renderFormula(f)} in ${JSON.stringify(m)}`).toBe(oracle);
      checked += 1;
    }
    expect(checked).toBe(3000);
  });

  it('agrees on random (open formula, model, assignment) triples', () => {
    const rng = makeRng(0xfeed);
    for (let i = 0; i < 2000; i += 1) {
      const f = genOpen(rng, 1 + below(rng, 4), WITH_REL);
      const m = genModel(rng, SIG);
      const w = toWorld(m);

      // Bind every free variable — the precondition evaluate documents.
      const env: Record<string, string> = {};
      const idxEnv: IdxEnv = {};
      for (const v of VAR_NAMES) {
        const j = below(rng, w.elems.length);
        env[v] = w.elems[j];
        idxEnv[v] = j;
      }

      expect(evaluate(f, m, env), `disagreement on ${renderFormula(f)}`).toBe(refEval(f, w, idxEnv));
    }
  });

  it('agrees across the whole enumerated model space (no sampling, relation-free)', () => {
    const rng = makeRng(0x1234);
    const worlds = allWorlds(SIG_NO_REL, 3);
    const models: Model[] = [];
    for (let n = 1; n <= 3; n += 1) for (const m of enumerateModels(SIG_NO_REL, n)) models.push(m);
    expect(models).toHaveLength(worlds.length);

    for (let i = 0; i < 40; i += 1) {
      const f = genSentence(rng, 3, NO_REL);
      for (let k = 0; k < models.length; k += 1) {
        expect(evaluate(f, models[k]), `${renderFormula(f)} @ model ${k}`).toBe(
          refEval(f, toWorld(models[k]), {}),
        );
      }
    }
  });

  it('single-element domain: ∀ and ∃ and ∃! all collapse to the body', () => {
    const one: Model = { domain: ['a'], sets: { A: ['a'], B: [] }, relations: { R: [] }, constants: { c: 'a' } };
    expect(evaluate(P('∀x A(x)'), one)).toBe(true);
    expect(evaluate(P('∃x A(x)'), one)).toBe(true);
    expect(evaluate(P('∃!x A(x)'), one)).toBe(true);
    expect(evaluate(P('∀x B(x)'), one)).toBe(false);
    expect(evaluate(P('∃x B(x)'), one)).toBe(false);
    expect(evaluate(P('∃!x B(x)'), one)).toBe(false);
  });

  it('the empty set and the empty language: vacuous truth is TRUE, not false', () => {
    const noA: Model = { domain: ['a', 'b'], sets: { A: [], B: [] }, relations: { R: [] }, constants: { c: 'a' } };
    expect(evaluate(P('∀x (A(x) → B(x))'), noA)).toBe(true);
    expect(evaluate(P('∃x (A(x) ∧ B(x))'), noA)).toBe(false);
    expect(evaluate(P('∅ ⊆ A'), noA)).toBe(true);
    expect(evaluate(P('A ⊆ A'), noA)).toBe(true);
    expect(evaluate(P('c ∈ ∅'), noA)).toBe(false);
    expect(evaluate(P('c ∈ 𝕌'), noA)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Known logical equivalences
// ---------------------------------------------------------------------------

describe('logicEquivalent reports the classic equivalences as EQUAL', () => {
  /** p, q, r as closed propositional atoms: facts about the one named individual. */
  const equiv = (a: string, b: string, sig: Signature = SIG, maxDomain = 3): void => {
    const v = logicEquivalent(P(a, sig), P(b, sig), sig, { maxDomain });
    expect(
      v.equal,
      v.equal ? '' : `"${a}" ≢ "${b}" — engine claims they differ in ${JSON.stringify(v.model)}`,
    ).toBe(true);
  };

  it('De Morgan, propositional', () => {
    equiv('¬(A(c) ∧ B(c))', '¬A(c) ∨ ¬B(c)');
    equiv('¬(A(c) ∨ B(c))', '¬A(c) ∧ ¬B(c)');
  });

  it('De Morgan, quantifier', () => {
    equiv('¬∀x A(x)', '∃x ¬A(x)');
    equiv('¬∃x A(x)', '∀x ¬A(x)');
    equiv('¬∀x (A(x) → B(x))', '∃x (A(x) ∧ ¬B(x))');
  });

  it('contraposition', () => {
    equiv('A(c) → B(c)', '¬B(c) → ¬A(c)');
    equiv('∀x (A(x) → B(x))', '∀x (¬B(x) → ¬A(x))');
  });

  it('material implication and double negation', () => {
    equiv('A(c) → B(c)', '¬A(c) ∨ B(c)');
    equiv('¬¬A(c)', 'A(c)');
    equiv('A(c) ↔ B(c)', '(A(c) → B(c)) ∧ (B(c) → A(c))');
  });

  it('A ⊆ B ≡ ∀x (x ∈ A → x ∈ B) — the identification the whole lesson rests on', () => {
    equiv('A ⊆ B', '∀x (x ∈ A → x ∈ B)');
    equiv('A ⊆ B', '∀x (A(x) → B(x))');
    equiv('A = B', '∀x (x ∈ A ↔ x ∈ B)');
    equiv('A = B', 'A ⊆ B ∧ B ⊆ A');
  });

  it('De Morgan for sets, as ∀x formulas and as set equations', () => {
    equiv('∀x (x ∈ (A ∪ B)ᶜ ↔ x ∈ Aᶜ ∩ Bᶜ)', '⊤');
    equiv('∀x (x ∈ (A ∩ B)ᶜ ↔ x ∈ Aᶜ ∪ Bᶜ)', '⊤');
    equiv('∀x (x ∈ (A ∪ B)ᶜ)', '∀x (x ∈ Aᶜ ∩ Bᶜ)');
    expect(isTautology(P('(A ∪ B)ᶜ = Aᶜ ∩ Bᶜ'), SIG)).toBe(true);
    expect(isTautology(P('(A ∩ B)ᶜ = Aᶜ ∪ Bᶜ'), SIG)).toBe(true);
    expect(isTautology(P('A ∖ B = A ∩ Bᶜ'), SIG)).toBe(true);
  });

  it('distribution', () => {
    equiv('A(c) ∧ (B(c) ∨ R(c, c))', '(A(c) ∧ B(c)) ∨ (A(c) ∧ R(c, c))');
    equiv('A(c) ∨ (B(c) ∧ R(c, c))', '(A(c) ∨ B(c)) ∧ (A(c) ∨ R(c, c))');
    equiv('∀x (A(x) ∧ B(x))', '∀x A(x) ∧ ∀y B(y)');
    equiv('∃x (A(x) ∨ B(x))', '∃x A(x) ∨ ∃y B(y)');
  });

  it('∃!x φ ≡ ∃x (φ ∧ ∀y (φ[y/x] → y = x))', () => {
    equiv('∃!x A(x)', '∃x (A(x) ∧ ∀y (A(y) → y = x))');
    equiv('∃!x (A(x) ∧ B(x))', '∃x (A(x) ∧ B(x) ∧ ∀y (A(y) ∧ B(y) → y = x))');
    equiv('∃!x A(x)', '∃x A(x) ∧ ∀x ∀y (A(x) ∧ A(y) → x = y)');
  });

  it('set-builder is the predicate it is built from', () => {
    equiv('∀x (x ∈ {y | A(y)} ↔ A(x))', '⊤');
    equiv('{x | A(x) ∧ B(x)} = A ∩ B', '⊤');
  });

  it('every equivalence above also holds under the independent oracle', () => {
    const pairs: Array<[string, string]> = [
      ['¬(A(c) ∧ B(c))', '¬A(c) ∨ ¬B(c)'],
      ['¬∀x A(x)', '∃x ¬A(x)'],
      ['¬∃x A(x)', '∀x ¬A(x)'],
      ['A(c) → B(c)', '¬B(c) → ¬A(c)'],
      ['A ⊆ B', '∀x (A(x) → B(x))'],
      ['∀x (x ∈ (A ∪ B)ᶜ ↔ x ∈ Aᶜ ∩ Bᶜ)', '⊤'],
      ['∃!x A(x)', '∃x (A(x) ∧ ∀y (A(y) → y = x))'],
    ];
    const worlds = allWorlds(SIG, 2);
    for (const [a, b] of pairs) {
      expect(truthVector(P(a), worlds), `${a} vs ${b}`).toBe(truthVector(P(b), worlds));
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Known NON-equivalences, and the counterexample must actually counter
// ---------------------------------------------------------------------------

/** The classic trap list. Each pair is a mistake a bright 12-year-old actually makes. */
const TRAPS: ReadonlyArray<readonly [string, string, string]> = [
  ['∀x (A(x) → B(x))', '∀x (A(x) ∧ B(x))', 'every A is B  vs  everything is both'],
  ['∃x (A(x) ∧ B(x))', '∃x (A(x) → B(x))', 'some A is B  vs  vacuous existential'],
  ['∀x ∃y R(x, y)', '∃y ∀x R(x, y)', 'quantifier order'],
  ['¬∀x A(x)', '∀x ¬A(x)', 'not-all  vs  all-not'],
  ['A ⊆ B', 'B ⊆ A', 'subset is not symmetric'],
  ['∃!x A(x)', '∃x A(x)', 'exactly one  vs  at least one'],
  ['∀x (A(x) → B(x))', '∀x (B(x) → A(x))', 'converse'],
  ['¬∃x (A(x) ∧ B(x))', '∃x ¬(A(x) ∧ B(x))', 'no A is B  vs  something is not both'],
  ['A(c) → B(c)', 'B(c) → A(c)', 'converse, propositional'],
  ['A = B', 'A ⊆ B', 'equality is not one-way inclusion'],
];

describe('non-equivalences are caught, and the world handed back really separates them', () => {
  for (const [a, b, why] of TRAPS) {
    it(`${why}: "${a}" ≢ "${b}"`, () => {
      const v = logicEquivalent(P(a), P(b), SIG);
      expect(v.equal, `engine wrongly marked these EQUAL`).toBe(false);
      if (v.equal) return;

      const fa = P(a);
      const fb = P(b);
      const w = toWorld(v.model);

      // The reported truth values must be the real ones — checked with the ORACLE,
      // not with the same evaluate() that produced them.
      expect(refEval(fa, w, {}), `reported theirs=${v.theirs} is not what the world says`).toBe(v.theirs);
      expect(refEval(fb, w, {}), `reported reference=${v.reference} is not what the world says`).toBe(
        v.reference,
      );
      // ...and they must actually differ there. A counterexample that doesn't counter
      // is the worst bug this module could have.
      expect(v.theirs).not.toBe(v.reference);
      expect(refEval(fa, w, {})).not.toBe(refEval(fb, w, {}));

      // The engine's own evaluate must agree with the oracle in that world too.
      expect(evaluate(fa, v.model)).toBe(refEval(fa, w, {}));
      expect(evaluate(fb, v.model)).toBe(refEval(fb, w, {}));

      // The model must be well-formed: non-empty domain, no duplicates, every
      // interpretation inside the domain.
      expect(v.model.domain.length).toBeGreaterThanOrEqual(1);
      expect(new Set(v.model.domain).size).toBe(v.model.domain.length);
      for (const members of Object.values(v.model.sets)) {
        for (const e of members) expect(v.model.domain).toContain(e);
      }
    });
  }

  it('the verdict is symmetric (swapping the arguments swaps only the labels)', () => {
    for (const [a, b] of TRAPS) {
      const ab = logicEquivalent(P(a), P(b), SIG);
      const ba = logicEquivalent(P(b), P(a), SIG);
      expect(ab.equal).toBe(ba.equal);
      if (ab.equal || ba.equal) continue;
      expect(JSON.stringify(ba.model)).toBe(JSON.stringify(ab.model));
      expect(ba.theirs).toBe(ab.reference);
      expect(ba.reference).toBe(ab.theirs);
    }
  });

  it('is reflexive on random sentences: a formula is always itself', () => {
    const rng = makeRng(0xabcd);
    for (let i = 0; i < 60; i += 1) {
      const f = genSentence(rng, 3, NO_REL);
      expect(logicEquivalent(f, f, SIG_NO_REL).equal, renderFormula(f)).toBe(true);
    }
  });

  it('verdict matches brute force on random sentence PAIRS (relation-free, full scope 3)', () => {
    const rng = makeRng(0x11ce);
    const worlds = allWorlds(SIG_NO_REL, 3);
    for (let i = 0; i < 200; i += 1) {
      const a = genSentence(rng, 3, NO_REL);
      const b = genSentence(rng, 3, NO_REL);
      const bruteEqual = truthVector(a, worlds) === truthVector(b, worlds);
      const v = logicEquivalent(a, b, SIG_NO_REL, { maxDomain: 3 });

      expect(v.equal, `${renderFormula(a)}  vs  ${renderFormula(b)}`).toBe(bruteEqual);
      if (v.equal) continue;

      const w = toWorld(v.model);
      expect(refEval(a, w, {})).toBe(v.theirs);
      expect(refEval(b, w, {})).toBe(v.reference);
      expect(v.theirs).not.toBe(v.reference);
    }
  });

  it('verdict matches brute force on random sentence pairs WITH the relation (scope 2)', () => {
    const rng = makeRng(0x22ce);
    const worlds = allWorlds(SIG, 2);
    for (let i = 0; i < 80; i += 1) {
      const a = genSentence(rng, 3, WITH_REL);
      const b = genSentence(rng, 3, WITH_REL);
      const bruteEqual = truthVector(a, worlds) === truthVector(b, worlds);
      const v = logicEquivalent(a, b, SIG, { maxDomain: 2 });
      expect(v.equal, `${renderFormula(a)}  vs  ${renderFormula(b)}`).toBe(bruteEqual);
      if (v.equal) continue;
      const w = toWorld(v.model);
      expect(refEval(a, w, {})).toBe(v.theirs);
      expect(refEval(b, w, {})).toBe(v.reference);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. The counterexample is the SMALLEST one
// ---------------------------------------------------------------------------

describe('the counterexample world is minimal (no smaller domain separates them)', () => {
  it('every trap pair: the returned domain size is the brute-force minimum', () => {
    for (const [a, b, why] of TRAPS) {
      const v = logicEquivalent(P(a), P(b), SIG);
      expect(v.equal).toBe(false);
      if (v.equal) continue;

      const got = v.model.domain.length;
      const want = minSeparatingSize(P(a), P(b), SIG, 3);
      expect(want, `${why}: brute force found no separating model at all`).not.toBeNull();
      expect(got, `${why}: engine returned a domain of ${got}, but ${want} suffices`).toBe(want);
    }
  });

  it('random non-equivalent pairs: the returned domain size is the brute-force minimum', () => {
    const rng = makeRng(0x33aa);
    const worlds = allWorlds(SIG_NO_REL, 3);
    let checkedNonEqual = 0;

    for (let i = 0; i < 200 && checkedNonEqual < 60; i += 1) {
      const a = genSentence(rng, 3, NO_REL);
      const b = genSentence(rng, 3, NO_REL);
      if (truthVector(a, worlds) === truthVector(b, worlds)) continue;

      const v = logicEquivalent(a, b, SIG_NO_REL, { maxDomain: 3 });
      expect(v.equal).toBe(false);
      if (v.equal) continue;

      const want = minSeparatingSize(a, b, SIG_NO_REL, 3);
      expect(v.model.domain.length, `${renderFormula(a)} vs ${renderFormula(b)}`).toBe(want);
      checkedNonEqual += 1;
    }
    expect(checkedNonEqual).toBeGreaterThan(20);
  });

  it('a pair that only separates at size 2 is not handed a size-1 world', () => {
    // ∀x∃y R vs ∃y∀x R agree in every one-element world (there is only one thing to
    // point at), so the smallest honest counterexample has two things in it.
    const v = logicEquivalent(P('∀x ∃y R(x, y)'), P('∃y ∀x R(x, y)'), SIG);
    expect(v.equal).toBe(false);
    if (v.equal) return;
    expect(v.model.domain.length).toBe(2);
    expect(minSeparatingSize(P('∀x ∃y R(x, y)'), P('∃y ∀x R(x, y)'), SIG, 3)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 7. modelCount agrees with enumeration
// ---------------------------------------------------------------------------

describe('modelCount is the number of models actually enumerated', () => {
  const SIGNATURES: ReadonlyArray<readonly [string, Signature, number]> = [
    ['empty signature', { sets: [], relations: [], constants: [] }, 4],
    ['one set', { sets: ['A'], relations: [], constants: [] }, 4],
    ['two sets', { sets: ['A', 'B'], relations: [], constants: [] }, 3],
    ['one relation', { sets: [], relations: ['R'], constants: [] }, 3],
    ['one constant', { sets: [], relations: [], constants: ['c'] }, 4],
    ['one set + one constant', { sets: ['A'], relations: [], constants: ['c'] }, 3],
    ['set + relation + constant', { sets: ['A'], relations: ['R'], constants: ['c'] }, 2],
    ['duplicate names collapse', { sets: ['A', 'A'], relations: [], constants: ['c', 'c'] }, 3],
  ];

  for (const [label, sig, maxN] of SIGNATURES) {
    it(`${label}: count == enumeration, and every model is distinct`, () => {
      for (let n = 1; n <= maxN; n += 1) {
        const yielded = [...enumerateModels(sig, n)];
        expect(yielded.length, `${label} @ n=${n}`).toBe(modelCount(sig, n));

        // Enumerating the same model twice would silently halve the search's coverage.
        const seen = new Set(yielded.map((m) => JSON.stringify(m)));
        expect(seen.size, `${label} @ n=${n}: duplicate models yielded`).toBe(yielded.length);

        // ...and it must be the SAME set of models the independent enumeration finds.
        const mine = new Set([...refModels(sig, n)].map((m) => JSON.stringify(m)));
        expect(mine.size).toBe(seen.size);
        for (const key of mine) expect(seen.has(key), `missing model ${key}`).toBe(true);
      }
    });
  }

  it('the closed form is 2^(n·|sets|) · 2^(n²·|rels|) · n^|consts|', () => {
    const sig: Signature = { sets: ['A', 'B'], relations: ['R'], constants: ['c'] };
    expect(modelCount(sig, 1)).toBe(2 ** 2 * 2 ** 1 * 1);
    expect(modelCount(sig, 2)).toBe(2 ** 4 * 2 ** 4 * 2);
    expect(modelCount(sig, 3)).toBe(2 ** 6 * 2 ** 9 * 3);
  });

  it('domain size 0 is refused — the empty domain is not a model', () => {
    expect(() => modelCount({ sets: [], relations: [], constants: [] }, 0)).toThrow(/non-empty|at least/i);
    expect(() => [...enumerateModels({ sets: ['A'], relations: [], constants: [] }, 0)]).toThrow();
  });

  it('the enumeration really is simplest-first (empty sets before singletons)', () => {
    const first = [...enumerateModels({ sets: ['A'], relations: [], constants: [] }, 2)];
    expect(first.map((m) => m.sets.A)).toEqual([[], ['a'], ['b'], ['a', 'b']]);
  });
});

// ---------------------------------------------------------------------------
// 8. evaluate throws rather than lying
// ---------------------------------------------------------------------------

describe('evaluate throws on a broken call — it never silently returns false', () => {
  const full: Model = {
    domain: ['a', 'b'],
    sets: { A: ['a'], B: [] },
    relations: { R: [['a', 'b']] },
    constants: { c: 'a' },
  };

  it('an unbound variable throws (and does not evaluate to false)', () => {
    const f: Formula = { kind: 'member', term: { kind: 'var', name: 'x' }, set: { kind: 'set', name: 'A' } };
    expect(freeVars(f)).toEqual(new Set(['x']));
    expect(() => evaluate(f, full)).toThrow(/Unbound variable 'x'/);
    // The trap: `x ∈ A` with x unbound is not "false", and ¬(x ∈ A) is not "true".
    expect(() => evaluate({ kind: 'not', inner: f }, full)).toThrow(/Unbound variable/);
  });

  it('a variable free only in a set-builder body still throws', () => {
    const f = P('c ∈ {y | R(x, y)}');
    expect(freeVars(f)).toEqual(new Set(['x']));
    expect(() => evaluate(f, full)).toThrow(/Unbound variable 'x'/);
  });

  it('a partially-bound formula throws for the variable that is missing', () => {
    const f = P('∀x R(x, y)');
    expect(freeVars(f)).toEqual(new Set(['y']));
    expect(() => evaluate(f, full)).toThrow(/Unbound variable 'y'/);
    // Bind it and the formula has a truth value again — the one the oracle computes.
    const w = toWorld(full);
    for (const [i, e] of w.elems.entries()) {
      expect(evaluate(f, full, { y: e })).toBe(refEval(f, w, { y: i }));
    }
  });

  it('a set the model never defines throws (an undefined set is not an empty set)', () => {
    const noB: Model = { domain: ['a'], sets: { A: ['a'] }, relations: {}, constants: {} };
    expect(() => evaluate(P('∀x B(x)'), noB)).toThrow(/Unknown set 'B'/);
    // The dangerous reading: "B is empty, so ∀x B(x) is false, so ¬∀x B(x) is true."
    expect(() => evaluate(P('∃x B(x)'), noB)).toThrow(/Unknown set 'B'/);
    expect(() => evaluate(P('B ⊆ A'), noB)).toThrow(/Unknown set 'B'/);
  });

  it('an undefined relation or constant throws', () => {
    const noR: Model = { domain: ['a'], sets: { A: [] }, relations: {}, constants: {} };
    expect(() => evaluate(P('∃x R(x, x)'), noR)).toThrow(/Unknown relation 'R'/);
    expect(() => evaluate(P('c ∈ A'), noR)).toThrow(/Unknown constant 'c'/);
  });

  it('an interpretation that points outside the domain throws', () => {
    const alien: Model = { domain: ['a'], sets: { A: ['z'] }, relations: {}, constants: {} };
    expect(() => evaluate(P('∀x A(x)'), alien)).toThrow(/not in the model's domain/);

    const alienConst: Model = { domain: ['a'], sets: { A: [] }, relations: {}, constants: { c: 'z' } };
    expect(() => evaluate(P('c ∈ A'), alienConst)).toThrow(/not in the model's domain/);

    expect(() => evaluate(P('∀x A(x)'), full, { x: 'z' })).not.toThrow(); // x is rebound by ∀
    const openA: Formula = { kind: 'member', term: { kind: 'var', name: 'x' }, set: { kind: 'set', name: 'A' } };
    expect(() => evaluate(openA, full, { x: 'z' })).toThrow(/not in the model's domain/);
  });

  it('an empty domain throws — first-order logic has no empty models', () => {
    const empty: Model = { domain: [], sets: { A: [] }, relations: {}, constants: {} };
    expect(() => evaluate(P('∀x A(x)'), empty)).toThrow(/empty domain/i);
    expect(() => evaluate({ kind: 'true' }, empty)).toThrow(/empty domain/i);
  });

  it('a duplicated domain element throws (∃! would miscount)', () => {
    const dup: Model = { domain: ['a', 'a'], sets: { A: ['a'] }, relations: {}, constants: {} };
    expect(() => evaluate(P('∃!x A(x)'), dup)).toThrow(/duplicate/i);
  });

  it('the oracle throws on exactly the same broken calls (so the property is the engine\'s, not luck)', () => {
    const f: Formula = { kind: 'member', term: { kind: 'var', name: 'x' }, set: { kind: 'set', name: 'A' } };
    expect(() => refEval(f, toWorld(full), {})).toThrow(/unbound/i);
    const noB: Model = { domain: ['a'], sets: { A: ['a'] }, relations: {}, constants: {} };
    expect(() => refEval(P('∀x B(x)'), toWorld(noB), {})).toThrow(/unknown set/i);
  });
});

// ---------------------------------------------------------------------------
// 9. gloss never collides
// ---------------------------------------------------------------------------

describe('gloss: no two NON-equivalent formulas share an English reading', () => {
  /**
   * Group a corpus by gloss string, then assert every group is a set of LOGICALLY
   * EQUIVALENT formulas. Equivalence is decided by the independent oracle over every
   * world of size 1..maxN, so a collision reported here is a collision between
   * formulas the engine itself would grade differently — which is the bug that lets a
   * distractor generator offer two identical-reading options, one right, one wrong.
   */
  function assertNoCollisions(corpus: readonly Formula[], sig: Signature, maxN: number): void {
    const worlds = allWorlds(sig, maxN);
    const byGloss = new Map<string, Array<{ f: Formula; truth: string }>>();

    for (const f of corpus) {
      const key = gloss(f, sig);
      const entry = { f, truth: truthVector(f, worlds) };
      const group = byGloss.get(key);
      if (group === undefined) byGloss.set(key, [entry]);
      else group.push(entry);
    }

    const collisions: string[] = [];
    for (const [key, group] of [...byGloss.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          if (group[i].truth !== group[j].truth) {
            collisions.push(
              `"${key}"\n    <- ${renderFormula(group[i].f)}\n    <- ${renderFormula(group[j].f)}\n` +
                `    (these are NOT equivalent: they differ in some world of size <= ${maxN})`,
            );
          }
        }
      }
    }

    expect(collisions.slice(0, 5).join('\n---\n')).toBe('');
    expect(collisions).toHaveLength(0);
  }

  it('the hand-picked trap corpus glosses injectively', () => {
    const corpus = [
      '∀x (A(x) → B(x))',
      '∀x (A(x) ∧ B(x))',
      '∀x (B(x) → A(x))',
      '∀x (A(x) → ¬B(x))',
      '∀x (A(x) ↔ B(x))',
      '∃x (A(x) ∧ B(x))',
      '∃x (A(x) → B(x))',
      '∃x (A(x) ∧ ¬B(x))',
      '∃x (B(x) ∧ ¬A(x))',
      '¬∃x (A(x) ∧ B(x))',
      '¬∃x (B(x) ∧ A(x))',
      '¬∀x A(x)',
      '∀x ¬A(x)',
      '∃x ¬A(x)',
      '∃!x A(x)',
      '∃!x B(x)',
      '∃x A(x)',
      '∀x A(x)',
      'A ⊆ B',
      'B ⊆ A',
      'A = B',
      'A ≠ B',
      'c ∈ A',
      'c ∉ A',
      'c ∈ A ∪ B',
      'c ∈ A ∩ B',
      'c ∈ A ∖ B',
      'c ∈ Aᶜ',
      'c ∈ (A ∪ B)ᶜ',
      'A(c) ∧ B(c)',
      'A(c) ∨ B(c)',
      'A(c) → B(c)',
      'B(c) → A(c)',
      'A(c) ↔ B(c)',
      '¬(A(c) ∧ B(c))',
      'R(c, c)',
      '∀x ∃y R(x, y)',
      '∃y ∀x R(x, y)',
      '∀x ∀y R(x, y)',
      '∃x ∃y R(x, y)',
      '∀x R(x, x)',
      '∅ ⊆ A',
      'A ⊆ 𝕌',
      '⊤',
      '⊥',
      'c = c',
      '∀x (x ∈ {y | A(y)} → B(x))',
    ].map((s) => P(s));

    assertNoCollisions(corpus, SIG, 2);
  });

  it('a random corpus of 250 sentences glosses injectively (relation-free, scope 3)', () => {
    const rng = makeRng(0x9911);
    const corpus: Formula[] = [];
    for (let i = 0; i < 250; i += 1) corpus.push(genSentence(rng, 2 + below(rng, 2), NO_REL));
    assertNoCollisions(corpus, SIG_NO_REL, 3);
  });

  it('a random corpus of 150 sentences with the relation glosses injectively (scope 2)', () => {
    const rng = makeRng(0x8822);
    const corpus: Formula[] = [];
    for (let i = 0; i < 150; i += 1) corpus.push(genSentence(rng, 2 + below(rng, 2), WITH_REL));
    assertNoCollisions(corpus, SIG, 2);
  });

  it('the two documented collisions are between EQUIVALENT formulas, as claimed', () => {
    expect(gloss(P('A ⊆ B'), SIG)).toBe(gloss(P('∀x (A(x) → B(x))'), SIG));
    expect(logicEquivalent(P('A ⊆ B'), P('∀x (A(x) → B(x))'), SIG).equal).toBe(true);

    expect(gloss(P('¬∃x (A(x) ∧ B(x))'), SIG)).toBe(gloss(P('∀x (A(x) → ¬B(x))'), SIG));
    expect(logicEquivalent(P('¬∃x (A(x) ∧ B(x))'), P('∀x (A(x) → ¬B(x))'), SIG).equal).toBe(true);
  });

  it('gloss is deterministic and total over the random corpus', () => {
    const rng = makeRng(0x7733);
    for (let i = 0; i < 300; i += 1) {
      const f = genSentence(rng, 3, WITH_REL);
      const once = gloss(f, SIG);
      expect(typeof once).toBe('string');
      expect(once.length).toBeGreaterThan(0);
      expect(gloss(f, SIG)).toBe(once);
    }
  });
});

// ---------------------------------------------------------------------------
// Generator self-check — a fuzz suite that fuzzes the wrong thing proves nothing
// ---------------------------------------------------------------------------

describe('the generators produce what they claim to', () => {
  it('genSentence produces closed formulas', () => {
    const rng = makeRng(0x4242);
    for (let i = 0; i < 500; i += 1) {
      const f = genSentence(rng, 1 + below(rng, 4), WITH_REL);
      expect(freeVars(f).size, `not closed: ${renderFormula(f)}`).toBe(0);
    }
  });

  it('genOpen reaches free variables', () => {
    const rng = makeRng(0x2424);
    let withFree = 0;
    for (let i = 0; i < 200; i += 1) {
      if (freeVars(genOpen(rng, 2, WITH_REL)).size > 0) withFree += 1;
    }
    expect(withFree).toBeGreaterThan(50);
  });

  it('the corpus reaches every AST node kind', () => {
    const rng = makeRng(0x1357);
    const kinds = new Set<string>();
    const walk = (f: Formula): void => {
      kinds.add(f.kind);
      switch (f.kind) {
        case 'not':
          walk(f.inner);
          return;
        case 'and':
        case 'or':
        case 'implies':
        case 'iff':
          walk(f.left);
          walk(f.right);
          return;
        case 'forall':
        case 'exists':
        case 'existsUnique':
          walk(f.body);
          return;
        case 'member':
          walkSet(f.set);
          return;
        case 'subset':
        case 'seteq':
          walkSet(f.left);
          walkSet(f.right);
          return;
        default:
          return;
      }
    };
    const walkSet = (s: SetExpr): void => {
      kinds.add(`set:${s.kind}`);
      switch (s.kind) {
        case 'union':
        case 'inter':
        case 'diff':
          walkSet(s.left);
          walkSet(s.right);
          return;
        case 'compl':
          walkSet(s.inner);
          return;
        case 'builder':
          walk(s.body);
          return;
        default:
          return;
      }
    };

    for (let i = 0; i < 2000; i += 1) walk(genOpen(rng, 4, WITH_REL));

    for (const k of [
      'member', 'subset', 'seteq', 'eq', 'rel', 'not', 'and', 'or', 'implies', 'iff',
      'forall', 'exists', 'existsUnique', 'true', 'false',
      'set:set', 'set:union', 'set:inter', 'set:diff', 'set:compl', 'set:universe',
      'set:emptyset', 'set:builder',
    ]) {
      expect(kinds.has(k), `generator never produced ${k}`).toBe(true);
    }
  });
});
