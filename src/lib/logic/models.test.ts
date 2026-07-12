/**
 * Tests for model enumeration.
 *
 * The three things that must hold, and that everything downstream leans on:
 *
 *   1. COMPLETENESS + NO DUPLICATES — the enumeration is exactly the set of
 *      interpretations, each once. Checked by counting *distinct* models and
 *      comparing with `modelCount`, and (on small cases) against a powerset built
 *      independently of the implementation.
 *   2. ORDER — fixed, documented, simplest-first. Pinned by exact sequences, not
 *      by re-deriving the implementation's own rule.
 *   3. STABILITY — same input, byte-identical output, whatever order the caller
 *      happened to list the signature names in.
 */

import { describe, expect, it } from 'vitest';
import { DOMAIN_NAMES, MAX_DOMAIN_SIZE, describeModel, enumerateModels, modelCount } from './models';
import type { Model, Signature } from './types';

// --- helpers ---------------------------------------------------------------

const sig = (parts: Partial<Signature> = {}): Signature => ({
  sets: [],
  relations: [],
  constants: [],
  ...parts,
});

/**
 * Canonical string for a model, computed WITHOUT assuming the implementation's key
 * insertion order (a test must not lean on the thing it is checking).
 */
const canonical = (m: Model): string => {
  const sets = Object.keys(m.sets)
    .sort()
    .map((k) => `${k}:[${[...m.sets[k]].join(',')}]`);
  const rels = Object.keys(m.relations)
    .sort()
    .map((k) => `${k}:[${m.relations[k].map(([x, y]) => `${x}${y}`).join(',')}]`);
  const consts = Object.keys(m.constants)
    .sort()
    .map((k) => `${k}=${m.constants[k]}`);
  return `<${m.domain.join('')}|${sets.join(' ')}|${rels.join(' ')}|${consts.join(' ')}>`;
};

/** Every subset of `xs`, built independently of models.ts (order irrelevant here). */
const powerset = <T>(xs: readonly T[]): T[][] =>
  xs.reduce<T[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]]);

/** Signatures exercised across every structural property below. */
const CASES: Array<{ name: string; s: Signature }> = [
  { name: 'empty signature', s: sig() },
  { name: 'one set', s: sig({ sets: ['Dog'] }) },
  { name: 'two sets', s: sig({ sets: ['Dog', 'Red'] }) },
  { name: 'one relation', s: sig({ relations: ['Likes'] }) },
  { name: 'one constant', s: sig({ constants: ['rex'] }) },
  { name: 'two constants', s: sig({ constants: ['rex', 'fido'] }) },
  { name: 'set + relation + constant', s: sig({ sets: ['Dog'], relations: ['Likes'], constants: ['rex'] }) },
  { name: 'two sets + relation', s: sig({ sets: ['Dog', 'Red'], relations: ['Likes'] }) },
];

const SIZES = [1, 2, 3];

// --- the domain ------------------------------------------------------------

describe('DOMAIN_NAMES', () => {
  it('is the four element names, in order', () => {
    expect([...DOMAIN_NAMES]).toEqual(['a', 'b', 'c', 'd']);
    expect(MAX_DOMAIN_SIZE).toBe(4);
  });

  it('is frozen — a mutation here would rewrite every universe in the app', () => {
    expect(Object.isFrozen(DOMAIN_NAMES)).toBe(true);
  });
});

// --- modelCount ------------------------------------------------------------

describe('modelCount', () => {
  it('matches the closed form 2^(n·|sets|) · 2^(n²·|rels|) · n^|consts|', () => {
    expect(modelCount(sig(), 1)).toBe(1); // the empty product: one bare universe
    expect(modelCount(sig(), 3)).toBe(1);
    expect(modelCount(sig({ sets: ['A'] }), 1)).toBe(2); // {} and {a}
    expect(modelCount(sig({ sets: ['A'] }), 3)).toBe(8);
    expect(modelCount(sig({ sets: ['A', 'B'] }), 3)).toBe(64);
    expect(modelCount(sig({ relations: ['R'] }), 2)).toBe(16); // 2^(2²)
    expect(modelCount(sig({ relations: ['R'] }), 3)).toBe(512); // 2^(3²)
    expect(modelCount(sig({ constants: ['k'] }), 3)).toBe(3);
    expect(modelCount(sig({ constants: ['j', 'k'] }), 3)).toBe(9);
    expect(modelCount(sig({ sets: ['A'], relations: ['R'], constants: ['k'] }), 2)).toBe(4 * 16 * 2);
  });

  it('counts duplicate names once — a Model can only hold one key per name', () => {
    expect(modelCount(sig({ sets: ['A', 'A'] }), 2)).toBe(modelCount(sig({ sets: ['A'] }), 2));
  });

  it('is a budget guard: a hopeless signature is reported as hopeless, not thrown', () => {
    // 4 things, 2 relations => 2^32 models. equivalence.ts must be able to *ask* this.
    expect(modelCount(sig({ relations: ['R', 'S'] }), 4)).toBe(2 ** 32);
  });
});

// --- completeness, distinctness, well-formedness ----------------------------

describe('enumerateModels', () => {
  for (const { name, s } of CASES) {
    for (const n of SIZES) {
      it(`yields exactly modelCount distinct, well-formed models: ${name}, n=${n}`, () => {
        const domain = DOMAIN_NAMES.slice(0, n);
        const seen = new Set<string>();
        let yielded = 0;

        for (const m of enumerateModels(s, n)) {
          yielded += 1;
          seen.add(canonical(m));

          expect(m.domain).toEqual(domain);
          expect(Object.keys(m.sets).sort()).toEqual([...new Set(s.sets)].sort());
          expect(Object.keys(m.relations).sort()).toEqual([...new Set(s.relations)].sort());
          expect(Object.keys(m.constants).sort()).toEqual([...new Set(s.constants)].sort());

          for (const members of Object.values(m.sets)) {
            expect(new Set(members).size).toBe(members.length); // no repeats
            expect(members.every((e) => domain.includes(e))).toBe(true);
            // members listed in domain order
            expect(members).toEqual(domain.filter((e) => members.includes(e)));
          }
          for (const pairs of Object.values(m.relations)) {
            expect(pairs.every(([x, y]) => domain.includes(x) && domain.includes(y))).toBe(true);
            expect(new Set(pairs.map(([x, y]) => `${x}${y}`)).size).toBe(pairs.length);
          }
          for (const e of Object.values(m.constants)) {
            expect(domain).toContain(e);
          }
        }

        const expected = modelCount(s, n);
        expect(yielded).toBe(expected); // completeness (given no duplicates)
        expect(seen.size).toBe(expected); // ...and no duplicates
      });
    }
  }

  it('the empty signature has exactly one model — the bare universe', () => {
    const models = [...enumerateModels(sig(), 2)];
    expect(models).toEqual([{ domain: ['a', 'b'], sets: {}, relations: {}, constants: {} }]);
  });

  it('a one-set signature enumerates the powerset of the domain, exactly', () => {
    const n = 3;
    const domain = DOMAIN_NAMES.slice(0, n);
    const expected = new Set(
      powerset(domain).map((s) => domain.filter((e) => s.includes(e)).join(',')),
    );
    const got = new Set([...enumerateModels(sig({ sets: ['A'] }), n)].map((m) => m.sets.A.join(',')));
    expect(got).toEqual(expected);
    expect(got.size).toBe(2 ** n);
  });

  it('a one-relation signature enumerates every subset of domain×domain, exactly', () => {
    const n = 2;
    const domain = DOMAIN_NAMES.slice(0, n);
    const allPairs = domain.flatMap((x) => domain.map((y) => `${x}${y}`));
    const expected = new Set(
      powerset(allPairs).map((s) => allPairs.filter((p) => s.includes(p)).join(',')),
    );
    const got = new Set(
      [...enumerateModels(sig({ relations: ['R'] }), n)].map((m) =>
        m.relations.R.map(([x, y]) => `${x}${y}`).join(','),
      ),
    );
    expect(got).toEqual(expected);
    expect(got.size).toBe(2 ** (n * n));
  });

  it('handles the largest affordable relation table (n=4 → 2^16 subsets)', () => {
    let count = 0;
    for (const _m of enumerateModels(sig({ relations: ['R'] }), 4)) count += 1;
    expect(count).toBe(modelCount(sig({ relations: ['R'] }), 4));
    expect(count).toBe(65536);
  });

  it('yields fresh models — mutating one must not corrupt the others', () => {
    const models = [...enumerateModels(sig({ sets: ['A'] }), 2)];
    models[0].sets.A.push('ZZZ');
    models[0].domain.push('ZZZ');
    expect(models[1].sets.A).toEqual(['a']);
    expect(models[1].domain).toEqual(['a', 'b']);
    expect(models[0]).not.toBe(models[1]);
  });
});

// --- the ordering guarantee -------------------------------------------------

describe('enumeration order', () => {
  it('the first model of a one-set signature has the set empty', () => {
    const first = enumerateModels(sig({ sets: ['Dog'] }), 2).next().value as Model;
    expect(first.sets.Dog).toEqual([]);
  });

  it('the first model has every set and relation empty, and every constant on "a"', () => {
    const s = sig({ sets: ['A', 'B'], relations: ['R'], constants: ['j', 'k'] });
    const first = enumerateModels(s, 3).next().value as Model;
    expect(first.sets).toEqual({ A: [], B: [] });
    expect(first.relations).toEqual({ R: [] });
    expect(first.constants).toEqual({ j: 'a', k: 'a' });
  });

  it('sets walk popcount-then-bitmask: {} {a} {b} {c} {a,b} {a,c} {b,c} {a,b,c}', () => {
    const seq = [...enumerateModels(sig({ sets: ['A'] }), 3)].map((m) => m.sets.A);
    expect(seq).toEqual([
      [],
      ['a'],
      ['b'],
      ['c'],
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
      ['a', 'b', 'c'],
    ]);
  });

  it('the size of a set never decreases as the enumeration proceeds (simplest first)', () => {
    for (const n of SIZES) {
      const sizes = [...enumerateModels(sig({ sets: ['A'] }), n)].map((m) => m.sets.A.length);
      expect(sizes).toEqual([...sizes].sort((x, y) => x - y));
      expect(sizes[0]).toBe(0);
      expect(sizes[sizes.length - 1]).toBe(n);
    }
  });

  it('relations walk row-major pairs, popcount-then-bitmask', () => {
    const seq = [...enumerateModels(sig({ relations: ['R'] }), 2)].map((m) =>
      m.relations.R.map(([x, y]) => `${x}${y}`).join(''),
    );
    // bit 0=(a,a) 1=(a,b) 2=(b,a) 3=(b,b); masks by popcount then value.
    expect(seq.slice(0, 11)).toEqual([
      '', // {}
      'aa',
      'ab',
      'ba',
      'bb', // singletons, in pair order
      'aaab', // mask 0b0011
      'aaba', // mask 0b0101
      'abba', // mask 0b0110
      'aabb', // mask 0b1001
      'abbb', // mask 0b1010
      'babb', // mask 0b1100
    ]);
    expect(seq[seq.length - 1]).toBe('aaabbabb'); // all four pairs
    expect(seq).toHaveLength(16);
  });

  it('constants run through the domain in order, and turn fastest (last coordinate)', () => {
    const seq = [...enumerateModels(sig({ sets: ['A'], constants: ['k'] }), 2)].map(
      (m) => `${m.sets.A.join('') || '-'}/${m.constants.k}`,
    );
    // The odometer's last digit is the constant: it ticks over before the set changes.
    expect(seq).toEqual(['-/a', '-/b', 'a/a', 'a/b', 'b/a', 'b/b', 'ab/a', 'ab/b']);
  });

  it('sets are more significant than relations, which are more significant than constants', () => {
    const s = sig({ sets: ['A'], relations: ['R'], constants: ['k'] });
    const seq = [...enumerateModels(s, 1)].map(
      (m) => `${m.sets.A.length}${m.relations.R.length}${m.constants.k}`,
    );
    // n=1: A ∈ {{},{a}} × R ∈ {{},{(a,a)}} × k ∈ {a}. Sets outermost.
    expect(seq).toEqual(['00a', '01a', '10a', '11a']);
  });
});

// --- stability --------------------------------------------------------------

describe('stability (the UI diffs on these)', () => {
  it('two runs produce the identical sequence', () => {
    const s = sig({ sets: ['Dog', 'Red'], relations: ['Likes'], constants: ['rex'] });
    const run = () => [...enumerateModels(s, 2)].map(canonical);
    expect(run()).toEqual(run());
  });

  it('is independent of the order names appear in the signature', () => {
    const a = sig({ sets: ['Red', 'Dog'], relations: ['Likes'], constants: ['x', 'rex'] });
    const b = sig({ sets: ['Dog', 'Red'], relations: ['Likes'], constants: ['rex', 'x'] });
    expect([...enumerateModels(a, 2)].map(canonical)).toEqual(
      [...enumerateModels(b, 2)].map(canonical),
    );
  });

  it('builds Record keys in sorted order, so JSON.stringify is canonical', () => {
    const s = sig({ sets: ['Zebra', 'Ant'], relations: ['Zips', 'Ahead'], constants: ['z', 'a'] });
    const m = enumerateModels(s, 2).next().value as Model;
    expect(Object.keys(m.sets)).toEqual(['Ant', 'Zebra']);
    expect(Object.keys(m.relations)).toEqual(['Ahead', 'Zips']);
    expect(Object.keys(m.constants)).toEqual(['a', 'z']);
  });

  it('collapses duplicate names, and still yields modelCount models', () => {
    const s = sig({ sets: ['A', 'A'], constants: ['k', 'k'] });
    const models = [...enumerateModels(s, 2)];
    expect(models).toHaveLength(modelCount(s, 2));
    expect(Object.keys(models[0].sets)).toEqual(['A']);
  });
});

// --- preconditions ----------------------------------------------------------

describe('domain size preconditions', () => {
  // The empty domain is not allowed: first-order logic requires a non-empty domain.
  it.each([0, -1, 5, 2.5, NaN])('rejects domainSize %p, eagerly, in both functions', (n) => {
    expect(() => enumerateModels(sig({ sets: ['A'] }), n)).toThrow();
    expect(() => modelCount(sig({ sets: ['A'] }), n)).toThrow();
  });

  it('throws at the call site, not at the first next()', () => {
    // A generator that validates in its body would hand back a happy-looking object
    // and only blow up later, far from the mistake.
    expect(() => enumerateModels(sig(), 0)).toThrow(/at least 1/);
  });

  it('accepts every size in [1, MAX_DOMAIN_SIZE]', () => {
    for (let n = 1; n <= MAX_DOMAIN_SIZE; n += 1) {
      expect(enumerateModels(sig({ sets: ['A'] }), n).next().value).toBeTruthy();
    }
  });
});

// --- describeModel ----------------------------------------------------------

describe('describeModel', () => {
  it('reads like the counterexample panel spec', () => {
    const m: Model = {
      domain: ['a', 'b'],
      sets: { Dog: ['a'], Red: [] },
      relations: { Likes: [['a', 'b']] },
      constants: {},
    };
    expect(describeModel(m)).toBe('There are 2 things: a, b.  Dog = {a}.  Red = {}.  Likes = {(a,b)}.');
  });

  it('gets the grammar right for a one-thing universe', () => {
    const m = enumerateModels(sig({ sets: ['Dog'] }), 1).next().value as Model;
    expect(describeModel(m)).toBe('There is 1 thing: a.  Dog = {}.');
  });

  it('lists several members and pairs, and names constants', () => {
    const m: Model = {
      domain: ['a', 'b', 'c'],
      sets: { Dog: ['a', 'b', 'c'] },
      relations: {
        Likes: [
          ['a', 'b'],
          ['c', 'a'],
        ],
      },
      constants: { rex: 'b' },
    };
    expect(describeModel(m)).toBe(
      'There are 3 things: a, b, c.  Dog = {a, b, c}.  Likes = {(a,b), (c,a)}.  rex = b.',
    );
  });

  it('describes the bare universe', () => {
    expect(describeModel({ domain: ['a'], sets: {}, relations: {}, constants: {} })).toBe(
      'There is 1 thing: a.',
    );
  });

  it('sorts names, so the same model always reads the same way', () => {
    const built: Model = {
      domain: ['a'],
      sets: { Zebra: [], Ant: ['a'] },
      relations: {},
      constants: { z: 'a', a: 'a' },
    };
    expect(describeModel(built)).toBe('There is 1 thing: a.  Ant = {a}.  Zebra = {}.  a = a.  z = a.');
  });

  it('does not emit garbage for a domain-less model it did not produce', () => {
    expect(describeModel({ domain: [], sets: { A: [] }, relations: {}, constants: {} })).toBe(
      'There are no things.  A = {}.',
    );
  });
});
