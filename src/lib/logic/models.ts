/**
 * Model enumeration: every little universe you can build over a signature.
 *
 * Grading in this lesson is by exhaustive model checking (see `equivalence.ts`),
 * so this module is the ground the whole logic engine stands on: it must produce
 * *every* interpretation over a domain, *exactly once*, in an order that is fixed
 * for all time.
 *
 * ## Why the order is part of the contract
 *
 * When a learner's formula disagrees with the reference, we show them the first
 * model in this enumeration on which the two differ. That model is the feedback.
 * Two consequences follow, and both are requirements, not preferences:
 *
 *   1. **Stable.** The same signature and domain size must yield the identical
 *      sequence on every run, in every browser. So we never iterate a `Record`'s
 *      insertion order — signature names are sorted, and elements are visited in
 *      domain-index order.
 *   2. **Simple first.** A counterexample world with two things and one dog beats
 *      one with three things and five relationships; the learner has to be able to
 *      look at it and go "oh". So each coordinate's subsets are visited in
 *      increasing popcount, then increasing bitmask value: the empty set first,
 *      then the singletons, then the pairs.
 *
 * ## The enumeration order, precisely
 *
 * A model is a point in the product of independent *coordinates*, listed in this
 * order (each group internally sorted by name):
 *
 *     [ one per set ] ++ [ one per relation ] ++ [ one per constant ]
 *
 * We walk that product like an odometer whose **last coordinate turns fastest**
 * (so constants tick over first, then relations, then sets — i.e. lexicographic
 * order on the coordinate-value indices). Each coordinate's own values are
 * ordered simplest-first:
 *
 *   - a set over domain `[a,b,c]` is a 3-bit mask (bit i == domain[i] is a member),
 *     visited in popcount-then-value order:
 *     `{} {a} {b} {c} {a,b} {a,c} {b,c} {a,b,c}`
 *   - a relation is an n²-bit mask over the pairs in **row-major** order
 *     (bit `i*n + j` == the pair `(domain[i], domain[j])`), same popcount-then-value walk;
 *   - a constant simply runs through the domain in index order, so it names `a` first.
 *
 * Note this is a *per-coordinate* simplicity order composed lexicographically, not
 * a global sort by total size: with two sets, `A={} B={a,b}` is reached before
 * `A={a} B={}`. That is deliberate (it is the order the spec asks for, it is cheap,
 * and it needs no global state) — but it means "first" means "first in this walk",
 * not "provably minimal in every metric". The domains are searched 1, 2, 3… by the
 * caller, so the dominant simplicity axis — how many things exist at all — is handled
 * there.
 *
 * ## Memory
 *
 * `enumerateModels` is a generator and never materialises the model list; the only
 * table it builds is the per-bit-width mask order (2^bits small ints, shared across
 * coordinates of the same width and memoised). Each yielded `Model` is freshly
 * allocated and owned by the caller — counterexamples get kept and inspected, so
 * nothing mutable may be reused across yields.
 */

import type { Model, Signature } from './types';

// ---------------------------------------------------------------------------
// The domain
// ---------------------------------------------------------------------------

/**
 * Element names, in order. `domainSize` n means the domain is the first n of these.
 *
 * Frozen: every model's `domain` is a *copy* of a prefix of this, and a mutation
 * here would silently rewrite every universe in the app.
 */
export const DOMAIN_NAMES: readonly string[] = Object.freeze(['a', 'b', 'c', 'd']);

/** Standard first-order logic requires a non-empty domain. Hence 1, not 0. */
export const MIN_DOMAIN_SIZE = 1;

/** How many things a universe may contain. SSOT: however many names we have. */
export const MAX_DOMAIN_SIZE = DOMAIN_NAMES.length;

/**
 * Widest subset table we will ever build (`2^bits` entries). A binary relation over
 * the largest domain already needs `4*4 = 16` bits, i.e. 65 536 subsets *per relation*.
 * This is a tripwire, not a tuning knob: growing `DOMAIN_NAMES` past 4 would make the
 * table explode (n=5 → 2^25) and calls for a different enumeration strategy entirely.
 */
const MAX_SUBSET_BITS = MAX_DOMAIN_SIZE * MAX_DOMAIN_SIZE;

// ---------------------------------------------------------------------------
// Rendering constants (describeModel)
// ---------------------------------------------------------------------------

/** Between the little sentences of a model description. Two spaces reads as a beat. */
const SENTENCE_GAP = '  ';

/** Between members of a set, or between pairs of a relation. */
const ITEM_SEP = ', ';

// ---------------------------------------------------------------------------
// Signature normalisation
// ---------------------------------------------------------------------------

/** A signature with its name lists sorted and de-duplicated. The only form we enumerate. */
interface NormalizedSignature {
  sets: string[];
  relations: string[];
  constants: string[];
}

/**
 * Sorted, duplicate-free copy of `names`.
 *
 * Sorting is by UTF-16 code unit (the default), NOT `localeCompare` — a
 * locale-dependent order would make the enumeration differ between users, and the
 * enumeration order is observable (it picks the counterexample the learner sees).
 *
 * De-duplication is load-bearing rather than defensive: a `Model` stores each set
 * under a single `Record` key, so a signature listing `Dog` twice cannot describe
 * two independent coordinates — and `modelCount` must agree with what we actually yield.
 */
function _sortedUnique(names: readonly string[]): string[] {
  return [...new Set(names)].sort();
}

function _normalizeSignature(sig: Signature): NormalizedSignature {
  return {
    sets: _sortedUnique(sig.sets),
    relations: _sortedUnique(sig.relations),
    constants: _sortedUnique(sig.constants),
  };
}

/** Throws unless `n` is a usable domain size. Errors say what to do about it. */
function _assertDomainSize(n: number): void {
  if (!Number.isInteger(n)) {
    throw new Error(`domainSize must be a whole number, got ${n}.`);
  }
  if (n < MIN_DOMAIN_SIZE) {
    throw new Error(
      `domainSize must be at least ${MIN_DOMAIN_SIZE}: first-order logic requires a non-empty domain (got ${n}).`,
    );
  }
  if (n > MAX_DOMAIN_SIZE) {
    throw new Error(
      `domainSize ${n} exceeds MAX_DOMAIN_SIZE (${MAX_DOMAIN_SIZE}): only ${MAX_DOMAIN_SIZE} element names are defined in DOMAIN_NAMES.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Subset order: the simplicity walk
// ---------------------------------------------------------------------------

/** Population count — how many members the subset encoded by `mask` has. */
function _popcount(mask: number): number {
  let count = 0;
  for (let m = mask; m !== 0; m &= m - 1) count += 1;
  return count;
}

/**
 * Memoised per bit-width: at most a handful of widths are ever asked for
 * (set widths 1..4, relation widths 1, 4, 9, 16), and the table is pure in `bits`.
 */
const _maskOrderCache = new Map<number, readonly number[]>();

/**
 * All `2^bits` masks, simplest first: increasing popcount, then increasing value.
 *
 * This is the single place the "simple models come first" promise is kept.
 */
function _maskOrder(bits: number): readonly number[] {
  const cached = _maskOrderCache.get(bits);
  if (cached !== undefined) return cached;

  if (bits > MAX_SUBSET_BITS) {
    throw new Error(
      `Refusing to build a subset table of 2^${bits} entries (limit 2^${MAX_SUBSET_BITS}). ` +
        `DOMAIN_NAMES has grown beyond what exhaustive enumeration can carry; the enumeration ` +
        `strategy needs rethinking, not a bigger constant.`,
    );
  }

  const order = Array.from({ length: 2 ** bits }, (_unused, mask) => mask);
  order.sort((x, y) => _popcount(x) - _popcount(y) || x - y);
  Object.freeze(order);
  _maskOrderCache.set(bits, order);
  return order;
}

/** Decode a set mask: bit i is set iff `domain[i]` is a member. Result is in domain order. */
function _decodeSubset(mask: number, domain: readonly string[]): string[] {
  return domain.filter((_element, i) => (mask >>> i) & 1);
}

/**
 * Decode a relation mask. Bit `i*n + j` (row-major) is the ordered pair
 * `(domain[i], domain[j])`; pairs come out in that same bit order, so the listing
 * is lexicographic in (i, j).
 */
function _decodePairs(mask: number, domain: readonly string[]): Array<[string, string]> {
  const n = domain.length;
  const pairs: Array<[string, string]> = [];
  for (let bit = 0; bit < n * n; bit += 1) {
    if ((mask >>> bit) & 1) {
      pairs.push([domain[Math.floor(bit / n)], domain[bit % n]]);
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// The odometer
// ---------------------------------------------------------------------------

/**
 * One axis of the product. `size` is how many values it takes; `write` stamps its
 * `digit`-th value into a model under construction.
 */
interface Coordinate {
  readonly size: number;
  readonly write: (model: Model, digit: number) => void;
}

/**
 * The coordinates, in odometer order: sets, then relations, then constants — each
 * group sorted by name. Writing them in this order also fixes the key insertion
 * order of the model's `Record`s, which makes `JSON.stringify(model)` canonical.
 */
function _coordinates(sig: NormalizedSignature, domain: readonly string[]): Coordinate[] {
  const n = domain.length;
  const coords: Coordinate[] = [];

  for (const name of sig.sets) {
    const order = _maskOrder(n);
    coords.push({
      size: order.length,
      write: (model, digit) => {
        model.sets[name] = _decodeSubset(order[digit], domain);
      },
    });
  }

  for (const name of sig.relations) {
    const order = _maskOrder(n * n);
    coords.push({
      size: order.length,
      write: (model, digit) => {
        model.relations[name] = _decodePairs(order[digit], domain);
      },
    });
  }

  for (const name of sig.constants) {
    coords.push({
      size: n,
      write: (model, digit) => {
        model.constants[name] = domain[digit];
      },
    });
  }

  return coords;
}

function* _walk(sig: NormalizedSignature, domain: readonly string[]): Generator<Model> {
  const coords = _coordinates(sig, domain);
  const digits = new Array<number>(coords.length).fill(0);

  for (;;) {
    // A fresh model per yield: callers hold on to counterexamples, so no mutable
    // state may be shared between two universes.
    const model: Model = { domain: [...domain], sets: {}, relations: {}, constants: {} };
    for (let k = 0; k < coords.length; k += 1) coords[k].write(model, digits[k]);
    yield model;

    // Tick the odometer, least significant (last) coordinate first.
    let k = coords.length - 1;
    while (k >= 0) {
      digits[k] += 1;
      if (digits[k] < coords[k].size) break;
      digits[k] = 0; // carry into the next-more-significant coordinate
      k -= 1;
    }
    // Carried off the front: every combination has been visited. (An empty signature
    // has no digits at all, so it lands here after its single, unique model.)
    if (k < 0) return;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Every interpretation of `sig` over the domain `DOMAIN_NAMES.slice(0, domainSize)`,
 * simplest first, in the fixed order documented at the top of this module.
 *
 * Precondition: `MIN_DOMAIN_SIZE <= domainSize <= MAX_DOMAIN_SIZE` — checked eagerly,
 * so a bad call throws at the call site rather than at the first `.next()`.
 *
 * Duplicate names in `sig` are collapsed; the count is `modelCount(sig, domainSize)`.
 */
export function enumerateModels(sig: Signature, domainSize: number): Generator<Model> {
  _assertDomainSize(domainSize);
  return _walk(_normalizeSignature(sig), DOMAIN_NAMES.slice(0, domainSize));
}

/**
 * How many models `enumerateModels(sig, domainSize)` would yield — in closed form,
 * without enumerating. This is the budget guard the equivalence checker trusts to
 * decide whether a search is affordable *before* starting it.
 *
 *     2^(n·|sets|) · 2^(n²·|relations|) · n^|constants|
 *
 * Exact while the result stays under `Number.MAX_SAFE_INTEGER`; beyond that it is a
 * float that overshoots any sane budget, which is all a guard needs it to do.
 *
 * Precondition: `MIN_DOMAIN_SIZE <= domainSize <= MAX_DOMAIN_SIZE`.
 */
export function modelCount(sig: Signature, domainSize: number): number {
  _assertDomainSize(domainSize);
  const { sets, relations, constants } = _normalizeSignature(sig);
  const n = domainSize;
  return 2 ** (n * sets.length) * 2 ** (n * n * relations.length) * n ** constants.length;
}

/** `{a, b}` — the members, or `{}` when there are none. */
function _braces(items: readonly string[]): string {
  return `{${items.join(ITEM_SEP)}}`;
}

/** Keys in sorted order. Never trust `Record` insertion order for anything the user sees. */
function _sortedKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).sort();
}

/**
 * A model as a few short readable sentences, for the counterexample panel:
 *
 *     There are 2 things: a, b.  Dog = {a}.  Red = {}.  Likes = {(a,b)}.
 *
 * Sets, then relations, then constants; each group in sorted name order, so the same
 * model always reads the same way regardless of how its `Record`s were built.
 */
export function describeModel(m: Model): string {
  const size = m.domain.length;
  const parts: string[] = [];

  // Guarded rather than assumed: enumerateModels never produces an empty domain, but
  // describeModel renders whatever it is handed (e.g. a model built by the UI).
  parts.push(
    size === 0
      ? 'There are no things.'
      : size === 1
        ? `There is 1 thing: ${m.domain[0]}.`
        : `There are ${size} things: ${m.domain.join(ITEM_SEP)}.`,
  );

  for (const name of _sortedKeys(m.sets)) {
    parts.push(`${name} = ${_braces(m.sets[name])}.`);
  }
  for (const name of _sortedKeys(m.relations)) {
    const pairs = m.relations[name].map(([x, y]) => `(${x},${y})`);
    parts.push(`${name} = ${_braces(pairs)}.`);
  }
  for (const name of _sortedKeys(m.constants)) {
    parts.push(`${name} = ${m.constants[name]}.`);
  }

  return parts.join(SENTENCE_GAP);
}
