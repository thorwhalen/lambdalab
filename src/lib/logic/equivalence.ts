/**
 * Grading by exhaustive model checking: is the learner's sentence the same
 * sentence as the reference one?
 *
 * This is the most user-visible function in the codebase. It decides whether a
 * child sees a tick or a cross, and when it says "cross" it must hand back the
 * *world* that proves it — a tiny universe the child can look at and go "oh".
 *
 * ## THE SMALL-SCOPE HYPOTHESIS (read this before you trust a `true`)
 *
 * `logicEquivalent` is NOT a decision procedure for first-order logical
 * equivalence. It cannot be: that problem is undecidable, and no amount of
 * cleverness here will change that. What it does is check every interpretation
 * over every domain of size 1..`maxDomain` (default 3) and report "equal" when
 * the two formulas never once disagree.
 *
 * That is the *small-scope hypothesis*: if two formulas a child can build out of
 * a small tile palette differ at all, they almost always already differ in a
 * world with three things in it. In practice, for this application, it is right
 * — and it is the only option on the table.
 *
 * The KNOWN LIMIT, stated plainly so nobody rediscovers it in front of a class:
 * **a formula whose only counterexamples need 4 or more elements is wrongly
 * marked correct.** Such formulas exist (they are exactly what "there are at
 * most 3 things" style sentences are made of), and a determined 12-year-old can
 * write one. They are vanishingly rare among the answers to a well-posed puzzle.
 *
 * Mitigation, for puzzle authors:
 *   - A puzzle with NO binary relations is cheap to check at `maxDomain: 4` —
 *     a relation is the only thing that costs 2^(n²) rather than 2^n, so without
 *     one you can buy a whole extra element of scope for almost nothing. Do it.
 *   - With relations, `MAX_MODELS` will stop you, which is the intended answer:
 *     shrink the signature rather than widen the scope.
 *
 * ## Why the counterexample is the SIMPLEST one
 *
 * We search domains small-first (1, then 2, then 3), and within a domain we take
 * models in `enumerateModels`' fixed simple-first order (empty sets before
 * singletons before pairs). The first disagreement we find is therefore the
 * simplest separating world, and that is the whole point of the exercise — a
 * counterexample with two things and one dog teaches; one with four things and
 * five relationships just bewilders.
 *
 * "Simplest" means *first in that walk*, which is the smallest domain, then
 * per-coordinate-simplest composed lexicographically (see `models.ts` — it makes
 * the same caveat). It is not a global minimum under every conceivable metric,
 * and it does not need to be.
 *
 * ## Preconditions are loud, because the alternative is a lie
 *
 * Both formulas must be SENTENCES (no free variables) and may only name things
 * the signature declares. Violations throw. In particular a learner who forgets
 * a quantifier — `Dog(x) → Red(x)`, a very common and very teachable mistake —
 * produces an open formula, which has no truth value in a model at all and so
 * cannot be graded equal *or* unequal. `LogicEquivalence` has nowhere to say
 * that, so we throw with a message the UI can show, and the caller is expected
 * to catch it and turn it into a hint. Silently universally-closing it would be
 * grading a formula the child did not write.
 */

import type { Formula, LogicEquivalence, Model, SetExpr, Signature, Term } from './types';
import { evaluate, freeVars } from './evaluate';
import { MAX_DOMAIN_SIZE, MIN_DOMAIN_SIZE, enumerateModels, modelCount } from './models';

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/**
 * How far the search looks by default. Three is the sweet spot: it is enough to
 * separate every distinction the lessons actually teach (∀∃ vs ∃∀ already needs
 * 2), and it keeps a relation-bearing puzzle down to a few hundred models.
 */
export const DEFAULT_MAX_DOMAIN = 3;

/**
 * The most models one grading call may visit, summed over every domain size it
 * searches. This is a LATENCY budget, not a memory one: models are streamed, but
 * a child pressing "check" must get an answer in well under a second, and two
 * `evaluate` calls per model puts 200k comfortably inside that.
 *
 * It is a tripwire, not a tuning knob. Blowing it means the signature is too big
 * for exhaustive checking, and the fix is to restrict the signature (or the
 * scope), never to raise the number.
 */
export const MAX_MODELS = 200_000;

// ---------------------------------------------------------------------------
// Which names does a formula actually use?
//
// A puzzle's signature is the whole world it could talk about; a given formula
// usually talks about a corner of it. Enumerating interpretations of a set that
// neither formula mentions doubles the work and cannot possibly change the
// verdict, so we scope the signature down to the UNION of the names occurring in
// the two formulas before enumerating. (The union — not the reference's names.
// A learner formula naming a set the reference ignores must still be given every
// interpretation of that set, or we would miss the world that separates them.)
// ---------------------------------------------------------------------------

interface UsedNames {
  sets: Set<string>;
  relations: Set<string>;
  constants: Set<string>;
}

function _collectTerm(t: Term, used: UsedNames): void {
  if (t.kind === 'const') used.constants.add(t.name);
}

function _collectSet(s: SetExpr, used: UsedNames): void {
  switch (s.kind) {
    case 'set':
      used.sets.add(s.name);
      return;
    case 'universe':
    case 'emptyset':
      return;
    case 'union':
    case 'inter':
    case 'diff':
      _collectSet(s.left, used);
      _collectSet(s.right, used);
      return;
    case 'compl':
      _collectSet(s.inner, used);
      return;
    case 'builder':
      // A set-builder body is a formula, and it can name anything a formula can.
      _collectFormula(s.body, used);
      return;
    default: {
      const unreachable: never = s;
      throw new Error(`Unhandled set expression: ${JSON.stringify(unreachable)}`);
    }
  }
}

function _collectFormula(f: Formula, used: UsedNames): void {
  switch (f.kind) {
    case 'true':
    case 'false':
      return;
    case 'member':
      _collectTerm(f.term, used);
      _collectSet(f.set, used);
      return;
    case 'eq':
      _collectTerm(f.left, used);
      _collectTerm(f.right, used);
      return;
    case 'rel':
      used.relations.add(f.name);
      _collectTerm(f.left, used);
      _collectTerm(f.right, used);
      return;
    case 'subset':
    case 'seteq':
      _collectSet(f.left, used);
      _collectSet(f.right, used);
      return;
    case 'not':
      _collectFormula(f.inner, used);
      return;
    case 'and':
    case 'or':
    case 'implies':
    case 'iff':
      _collectFormula(f.left, used);
      _collectFormula(f.right, used);
      return;
    case 'forall':
    case 'exists':
    case 'existsUnique':
      _collectFormula(f.body, used);
      return;
    default: {
      const unreachable: never = f;
      throw new Error(`Unhandled formula: ${JSON.stringify(unreachable)}`);
    }
  }
}

/** Sorted, so the scoped signature — and hence the enumeration — is identical on every run. */
function _sorted(names: ReadonlySet<string>): string[] {
  return [...names].sort();
}

/**
 * The names `formulas` actually mention, checked against what `sig` declares.
 *
 * A name a formula uses but the signature never declares is a *puzzle-authoring
 * bug*, not an empty set: `evaluate` would throw on it deep inside the
 * enumeration, and worse, quietly inventing a coordinate for it would let a
 * typo'd reference formula ('Redd' for 'Red') be graded against thousands of
 * models and come back with a confident, meaningless verdict. So we catch it
 * here, by name, before any work is done.
 *
 * The parser cannot produce such a formula (it classifies undeclared identifiers
 * as variables), so this fires only for hand-built ASTs — which is exactly when
 * an author wants to hear about it.
 */
function _scopeSignature(sig: Signature, formulas: readonly Formula[]): Signature {
  const used: UsedNames = { sets: new Set(), relations: new Set(), constants: new Set() };
  for (const f of formulas) _collectFormula(f, used);

  const declared = {
    sets: new Set(sig.sets),
    relations: new Set(sig.relations),
    constants: new Set(sig.constants),
  };

  const undeclared: string[] = [];
  for (const name of _sorted(used.sets)) {
    if (!declared.sets.has(name)) undeclared.push(`set '${name}'`);
  }
  for (const name of _sorted(used.relations)) {
    if (!declared.relations.has(name)) undeclared.push(`relation '${name}'`);
  }
  for (const name of _sorted(used.constants)) {
    if (!declared.constants.has(name)) undeclared.push(`constant '${name}'`);
  }
  if (undeclared.length > 0) {
    throw new Error(
      `Formula names something the signature does not declare: ${undeclared.join(', ')}. ` +
        `Add it to the signature (declared — sets: ${_listOrNone(sig.sets)}; ` +
        `relations: ${_listOrNone(sig.relations)}; constants: ${_listOrNone(sig.constants)}).`,
    );
  }

  return {
    sets: _sorted(used.sets),
    relations: _sorted(used.relations),
    constants: _sorted(used.constants),
  };
}

/** For error messages. Sorted, so a message reads the same on every run. */
function _listOrNone(names: readonly string[]): string {
  return names.length === 0 ? 'none' : [...names].sort().join(', ');
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * A `maxDomain` below `MIN_DOMAIN_SIZE` would make the search space EMPTY, and an
 * empty search finds no disagreement — so every pair of formulas would be graded
 * "equal". That is the single most dangerous failure this module could have (it
 * marks every wrong answer right), so it is a hard error rather than a clamp.
 */
function _assertDomainBound(maxDomain: number): void {
  if (!Number.isInteger(maxDomain)) {
    throw new Error(`maxDomain must be a whole number, got ${maxDomain}.`);
  }
  if (maxDomain < MIN_DOMAIN_SIZE) {
    throw new Error(
      `maxDomain must be at least ${MIN_DOMAIN_SIZE}, got ${maxDomain}: a search over no domains ` +
        `would find no disagreement and mark every answer correct.`,
    );
  }
  if (maxDomain > MAX_DOMAIN_SIZE) {
    throw new Error(
      `maxDomain ${maxDomain} exceeds MAX_DOMAIN_SIZE (${MAX_DOMAIN_SIZE}): only ` +
        `${MAX_DOMAIN_SIZE} element names exist. Model checking cannot go wider.`,
    );
  }
}

function _assertSentence(f: Formula, role: string): void {
  const free = freeVars(f);
  if (free.size > 0) {
    const names = [...free].join(', ');
    throw new Error(
      `${role} has ${free.size === 1 ? 'a free variable' : 'free variables'}: ${names}. ` +
        `Only a sentence (every variable bound by a quantifier) has a truth value in a world, ` +
        `so an open formula can be graded neither right nor wrong. Bind ${names} with ∀ or ∃.`,
    );
  }
}

/** Total models the search will visit — the quantity that actually governs how long it takes. */
function _searchSize(sig: Signature, maxDomain: number): number {
  let total = 0;
  for (let n = MIN_DOMAIN_SIZE; n <= maxDomain; n += 1) total += modelCount(sig, n);
  return total;
}

/**
 * Refuse a search that would not return promptly. Callers must be able to trust
 * that these functions come back fast; a UI that hangs on "check" is worse than
 * one that says it cannot check.
 */
function _assertAffordable(scoped: Signature, maxDomain: number): void {
  const total = _searchSize(scoped, maxDomain);
  if (total > MAX_MODELS) {
    throw new Error(
      `Refusing to check ${total.toLocaleString('en-US')} models (budget MAX_MODELS = ` +
        `${MAX_MODELS.toLocaleString('en-US')}). The formulas need ${scoped.sets.length} set(s), ` +
        `${scoped.relations.length} relation(s) and ${scoped.constants.length} constant(s) over ` +
        `domains up to ${maxDomain}. Shrink the signature (a binary relation costs 2^(n²) — by far ` +
        `the most expensive thing in it) or lower maxDomain.`,
    );
  }
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

/**
 * Every model the search visits, in order: smallest domain first, and within a
 * domain the `enumerateModels` simple-first order. The "simplest counterexample"
 * promise is exactly this generator's order — nothing else in this module sorts.
 */
function* _searchSpace(scoped: Signature, maxDomain: number): Generator<Model> {
  for (let n = MIN_DOMAIN_SIZE; n <= maxDomain; n += 1) {
    yield* enumerateModels(scoped, n);
  }
}

/** Shared prologue: validate, scope the signature, check the budget. */
function _prepare(formulas: readonly Formula[], roles: readonly string[], sig: Signature, maxDomain: number): Signature {
  _assertDomainBound(maxDomain);
  formulas.forEach((f, i) => _assertSentence(f, roles[i]));
  const scoped = _scopeSignature(sig, formulas);
  _assertAffordable(scoped, maxDomain);
  return scoped;
}

/** First model in the search order in which `f` evaluates to `wanted`, or null. */
function _findModel(
  f: Formula,
  sig: Signature,
  maxDomain: number,
  wanted: boolean,
  role: string,
): Model | null {
  const scoped = _prepare([f], [role], sig, maxDomain);
  for (const model of _searchSpace(scoped, maxDomain)) {
    if (evaluate(f, model) === wanted) return model;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Does the learner's formula say the same thing as the reference formula?
 *
 * Checks both formulas in every interpretation over every domain of size
 * 1..`maxDomain` and returns the FIRST world in which they disagree — which, by
 * the search order, is the simplest such world. If they never disagree, reports
 * equal.
 *
 * `equal: true` is a small-scope result, NOT a proof of logical equivalence:
 * see the module docstring. Formulas that only differ on domains larger than
 * `maxDomain` are wrongly reported equal.
 *
 * Precondition: both formulas are sentences (no free variables) and name only
 * things `sig` declares; `MIN_DOMAIN_SIZE <= maxDomain <= MAX_DOMAIN_SIZE`.
 * Violations throw, with a message fit to show a learner.
 *
 * Throws if the search would exceed `MAX_MODELS`, so it always returns promptly.
 */
export function logicEquivalent(
  theirs: Formula,
  reference: Formula,
  sig: Signature,
  opts: { maxDomain?: number } = {},
): LogicEquivalence {
  const maxDomain = opts.maxDomain ?? DEFAULT_MAX_DOMAIN;
  const scoped = _prepare(
    [theirs, reference],
    ['Your sentence', 'The reference sentence'],
    sig,
    maxDomain,
  );

  for (const model of _searchSpace(scoped, maxDomain)) {
    const theirsHolds = evaluate(theirs, model);
    const referenceHolds = evaluate(reference, model);
    if (theirsHolds !== referenceHolds) {
      return { equal: false, model, theirs: theirsHolds, reference: referenceHolds };
    }
  }
  return { equal: true };
}

/**
 * A world in which `f` is true, or null if there is none up to `maxDomain`.
 *
 * The model returned is the simplest one (smallest domain first). A null is a
 * small-scope result: `f` may still be satisfiable in a larger world.
 *
 * Precondition: as `logicEquivalent`.
 */
export function satisfiable(
  f: Formula,
  sig: Signature,
  maxDomain: number = DEFAULT_MAX_DOMAIN,
): Model | null {
  return _findModel(f, sig, maxDomain, true, 'The formula');
}

/**
 * Is `f` true in every world? Equivalently: is there no world that falsifies it?
 *
 * A `true` here is the small-scope hypothesis at its weakest — "valid in every
 * world of up to `maxDomain` things" is genuinely weaker than "valid", and the
 * gap is real (e.g. "there are at most 3 things" passes at maxDomain 3). Use it
 * for lesson checks, never as a proof.
 *
 * Precondition: as `logicEquivalent`.
 */
export function isTautology(
  f: Formula,
  sig: Signature,
  maxDomain: number = DEFAULT_MAX_DOMAIN,
): boolean {
  return _findModel(f, sig, maxDomain, false, 'The formula') === null;
}
