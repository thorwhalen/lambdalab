/**
 * Tarskian semantics: what a formula MEANS in one concrete little universe.
 *
 * This is the bottom of the logic engine. `equivalence.ts` grades by calling
 * `evaluate` across every model of a signature, so every subtlety here is
 * multiplied by thousands of models and lands, eventually, in a child's face as
 * "you got it wrong". Two commitments follow from that:
 *
 *   1. **Nothing is silently false.** A variable with no binding, a set the
 *      model never defines, a constant pointing outside the domain — these are
 *      *bugs in the caller*, not falsehoods about the world. They throw, loudly
 *      and by name. The one thing worse than a red X is a red X for the wrong
 *      reason.
 *   2. **Output is canonical.** `evalSet` builds its result by scanning the
 *      domain in sorted order, so the iteration order of a returned Set depends
 *      only on the element names — never on how a lesson author happened to type
 *      the membership table, nor on the shape of the expression that produced
 *      it. `Aᶜ ∩ B` and `B ∖ A` return Sets that iterate identically. The UI
 *      diffs on this.
 *
 * A set and a unary predicate are the same thing here (see `types.ts`): `x ∈ Dogs`
 * and `Dogs(x)` are one AST node, so `evalSet` and `evaluate` are mutually
 * recursive — a set-builder body is a formula, and a formula's atoms are sets.
 */

import type { Assignment, Formula, Model, SetExpr, Term } from './types';

/**
 * Classical first-order logic quantifies over a NON-EMPTY domain. Allowing size
 * 0 would make `∃x ⊤` false and `∀x ⊥` true, which is a coherent logic but not
 * the one we are teaching. Domains start at 1.
 */
const MIN_DOMAIN_SIZE = 1;

/** ∃! is defined as "the witness set has exactly this many elements". */
const UNIQUE_WITNESS_COUNT = 1;

// ---------------------------------------------------------------------------
// Guards
//
// `env`, `m.sets`, `m.relations` and `m.constants` are plain records, so a
// variable or set named `constructor` / `toString` would resolve to something
// off Object.prototype under a bare `env[name]` lookup. Every lookup in this
// module goes through `_own`, which is why.
// ---------------------------------------------------------------------------

function _own<T>(record: Record<string, T>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function _sortedKeys<T>(record: Record<string, T>): string[] {
  return Object.keys(record).sort();
}

/** For error messages: "(model defines: Cat, Dog)" — sorted, so it reads the same every run. */
function _known<T>(record: Record<string, T>): string {
  const names = _sortedKeys(record);
  return names.length === 0 ? 'none' : names.join(', ');
}

/**
 * The domain, validated and put in canonical order. Called once per public
 * entry point and then threaded down the recursion, so the checks are paid once
 * per `evaluate` call rather than once per AST node.
 *
 * Duplicates are fatal rather than deduplicated: a domain of ['a','a'] would
 * make ∃! count two witnesses for one element, and a grader that miscounts is
 * worse than a grader that stops.
 */
function _canonicalDomain(m: Model): string[] {
  if (m.domain.length < MIN_DOMAIN_SIZE) {
    throw new Error(
      `Model has an empty domain. First-order logic needs at least ${MIN_DOMAIN_SIZE} element ` +
        `(an empty domain would make '∃x ⊤' false and '∀x ⊥' true).`,
    );
  }
  const sorted = [...m.domain].sort();
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === sorted[i - 1]) {
      throw new Error(
        `Model domain contains a duplicate element '${sorted[i]}': [${m.domain.join(', ')}].`,
      );
    }
  }
  return sorted;
}

function _assertInDomain(element: string, domain: readonly string[], where: string): void {
  if (!domain.includes(element)) {
    throw new Error(
      `${where} names '${element}', which is not in the model's domain [${domain.join(', ')}].`,
    );
  }
}

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

/** Resolve a term to the domain element it denotes under `env`. */
function _denote(t: Term, m: Model, domain: readonly string[], env: Assignment): string {
  if (t.kind === 'var') {
    if (!_own(env, t.name)) {
      const bound = _sortedKeys(env);
      throw new Error(
        `Unbound variable '${t.name}': it is free in the formula but has no binding ` +
          `(bound here: ${bound.length === 0 ? 'none' : bound.join(', ')}). ` +
          `Quantify it, or pass it in the assignment.`,
      );
    }
    const element = env[t.name];
    _assertInDomain(element, domain, `Assignment binds variable '${t.name}' to an element that`);
    return element;
  }
  if (!_own(m.constants, t.name)) {
    throw new Error(
      `Unknown constant '${t.name}': the model gives it no value (model defines: ${_known(m.constants)}).`,
    );
  }
  const element = m.constants[t.name];
  _assertInDomain(element, domain, `Constant '${t.name}'`);
  return element;
}

// ---------------------------------------------------------------------------
// Set expressions
// ---------------------------------------------------------------------------

/**
 * Build a subset of the domain from a membership test, scanning in canonical
 * order. Every Set this module hands out is built here — that is what makes
 * iteration order a function of the elements alone.
 */
function _select(domain: readonly string[], holds: (element: string) => boolean): Set<string> {
  const out = new Set<string>();
  for (const element of domain) {
    if (holds(element)) out.add(element);
  }
  return out;
}

/** The extension of a *named* set (== a unary predicate) in the model. */
function _namedSet(name: string, m: Model, domain: readonly string[]): Set<string> {
  if (!_own(m.sets, name)) {
    throw new Error(
      `Unknown set '${name}': the model gives it no members (model defines: ${_known(m.sets)}). ` +
        `A set the model never mentions is a broken puzzle, not an empty set.`,
    );
  }
  const listed = m.sets[name];
  for (const element of listed) {
    _assertInDomain(element, domain, `Set '${name}' lists a member that`);
  }
  const members = new Set(listed);
  return _select(domain, (element) => members.has(element));
}

function _relationHolds(
  name: string,
  left: string,
  right: string,
  m: Model,
  domain: readonly string[],
): boolean {
  if (!_own(m.relations, name)) {
    throw new Error(
      `Unknown relation '${name}': the model gives it no pairs (model defines: ${_known(m.relations)}).`,
    );
  }
  let found = false;
  // Validate every pair, not just until a hit: a typo in a pair we happen not to
  // need is still a broken model, and it should be caught the first time it runs.
  for (const [a, b] of m.relations[name]) {
    _assertInDomain(a, domain, `Relation '${name}' has a pair whose first element`);
    _assertInDomain(b, domain, `Relation '${name}' has a pair whose second element`);
    if (a === left && b === right) found = true;
  }
  return found;
}

function _evalSet(
  s: SetExpr,
  m: Model,
  domain: readonly string[],
  env: Assignment,
): Set<string> {
  switch (s.kind) {
    case 'set':
      return _namedSet(s.name, m, domain);
    case 'universe':
      return _select(domain, () => true);
    case 'emptyset':
      return new Set<string>();
    case 'union': {
      const left = _evalSet(s.left, m, domain, env);
      const right = _evalSet(s.right, m, domain, env);
      return _select(domain, (e) => left.has(e) || right.has(e));
    }
    case 'inter': {
      const left = _evalSet(s.left, m, domain, env);
      const right = _evalSet(s.right, m, domain, env);
      return _select(domain, (e) => left.has(e) && right.has(e));
    }
    case 'diff': {
      const left = _evalSet(s.left, m, domain, env);
      const right = _evalSet(s.right, m, domain, env);
      return _select(domain, (e) => left.has(e) && !right.has(e));
    }
    case 'compl': {
      // Complement is relative to the DOMAIN, never to some absolute universe:
      // Dogᶜ in a world of three dogs and a cat is the cat, not everything else
      // that has ever existed.
      const inner = _evalSet(s.inner, m, domain, env);
      return _select(domain, (e) => !inner.has(e));
    }
    case 'builder': {
      // {x | φ}. φ may mention variables bound OUTSIDE this expression, so `env`
      // is extended, not replaced — and `s.varName` shadows any outer binding of
      // the same name, which is exactly what the spread order below does.
      return _select(domain, (e) =>
        _evaluate(s.body, m, domain, { ...env, [s.varName]: e }),
      );
    }
    default: {
      const unreachable: never = s;
      throw new Error(`Unhandled set expression: ${JSON.stringify(unreachable)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Formulas
// ---------------------------------------------------------------------------

function _evaluate(f: Formula, m: Model, domain: readonly string[], env: Assignment): boolean {
  switch (f.kind) {
    case 'true':
      return true;
    case 'false':
      return false;
    case 'member':
      return _evalSet(f.set, m, domain, env).has(_denote(f.term, m, domain, env));
    case 'rel':
      return _relationHolds(
        f.name,
        _denote(f.left, m, domain, env),
        _denote(f.right, m, domain, env),
        m,
        domain,
      );
    case 'eq':
      return _denote(f.left, m, domain, env) === _denote(f.right, m, domain, env);
    case 'subset': {
      const left = _evalSet(f.left, m, domain, env);
      const right = _evalSet(f.right, m, domain, env);
      // ∅ ⊆ S for every S falls out of this with no special case, and so does
      // the fact that ⊆ is not ⊊ — S ⊆ S is true.
      return domain.every((e) => !left.has(e) || right.has(e));
    }
    case 'seteq': {
      const left = _evalSet(f.left, m, domain, env);
      const right = _evalSet(f.right, m, domain, env);
      // Extensionality: two sets are equal iff they agree on every element.
      // Compared pointwise over the domain rather than by size, so it cannot be
      // fooled by a set whose stored array has been miscounted.
      return domain.every((e) => left.has(e) === right.has(e));
    }
    case 'not':
      return !_evaluate(f.inner, m, domain, env);
    case 'and':
      return _evaluate(f.left, m, domain, env) && _evaluate(f.right, m, domain, env);
    case 'or':
      return _evaluate(f.left, m, domain, env) || _evaluate(f.right, m, domain, env);
    case 'implies':
      // MATERIAL implication: ¬p ∨ q. So "all unicorns are pink" is TRUE in a
      // world with no unicorns, and "if 2+2=5 then I am the Pope" is TRUE too.
      // This is not a wart to be papered over — the vacuous-truth lesson leans on
      // it, and the counterexample panel exists precisely to show a child the
      // empty-unicorn world in which their ∀x(A(x) → B(x)) is true for free.
      return !_evaluate(f.left, m, domain, env) || _evaluate(f.right, m, domain, env);
    case 'iff':
      return _evaluate(f.left, m, domain, env) === _evaluate(f.right, m, domain, env);
    case 'forall': {
      for (const e of domain) {
        if (!_evaluate(f.body, m, domain, { ...env, [f.varName]: e })) return false;
      }
      return true;
    }
    case 'exists': {
      for (const e of domain) {
        if (_evaluate(f.body, m, domain, { ...env, [f.varName]: e })) return true;
      }
      return false;
    }
    case 'existsUnique': {
      let witnesses = 0;
      for (const e of domain) {
        if (_evaluate(f.body, m, domain, { ...env, [f.varName]: e })) {
          witnesses += 1;
          if (witnesses > UNIQUE_WITNESS_COUNT) return false;
        }
      }
      return witnesses === UNIQUE_WITNESS_COUNT;
    }
    default: {
      const unreachable: never = f;
      throw new Error(`Unhandled formula: ${JSON.stringify(unreachable)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Free variables
// ---------------------------------------------------------------------------

function _bind(bound: ReadonlySet<string>, varName: string): Set<string> {
  const next = new Set(bound);
  next.add(varName);
  return next;
}

function _freeInTerm(t: Term, bound: ReadonlySet<string>, out: Set<string>): void {
  if (t.kind === 'var' && !bound.has(t.name)) out.add(t.name);
}

function _freeInSet(s: SetExpr, bound: ReadonlySet<string>, out: Set<string>): void {
  switch (s.kind) {
    case 'set':
    case 'universe':
    case 'emptyset':
      return;
    case 'union':
    case 'inter':
    case 'diff':
      _freeInSet(s.left, bound, out);
      _freeInSet(s.right, bound, out);
      return;
    case 'compl':
      _freeInSet(s.inner, bound, out);
      return;
    case 'builder':
      // A set expression can carry free variables, because {y | Likes(x, y)}
      // depends on x. Missing this would let `isClosed` bless a formula that
      // cannot actually be evaluated.
      _freeInFormula(s.body, _bind(bound, s.varName), out);
      return;
    default: {
      const unreachable: never = s;
      throw new Error(`Unhandled set expression: ${JSON.stringify(unreachable)}`);
    }
  }
}

function _freeInFormula(f: Formula, bound: ReadonlySet<string>, out: Set<string>): void {
  switch (f.kind) {
    case 'true':
    case 'false':
      return;
    case 'member':
      _freeInTerm(f.term, bound, out);
      _freeInSet(f.set, bound, out);
      return;
    case 'eq':
    case 'rel':
      _freeInTerm(f.left, bound, out);
      _freeInTerm(f.right, bound, out);
      return;
    case 'subset':
    case 'seteq':
      _freeInSet(f.left, bound, out);
      _freeInSet(f.right, bound, out);
      return;
    case 'not':
      _freeInFormula(f.inner, bound, out);
      return;
    case 'and':
    case 'or':
    case 'implies':
    case 'iff':
      _freeInFormula(f.left, bound, out);
      _freeInFormula(f.right, bound, out);
      return;
    case 'forall':
    case 'exists':
    case 'existsUnique':
      _freeInFormula(f.body, _bind(bound, f.varName), out);
      return;
    default: {
      const unreachable: never = f;
      throw new Error(`Unhandled formula: ${JSON.stringify(unreachable)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Is `f` true in the model `m`?
 *
 * Precondition: every free variable of `f` has a binding in `env` (see
 * `freeVars`), and every set/relation/constant `f` names is defined by `m`.
 * Violations throw — they are programming errors, not falsehoods.
 */
export function evaluate(f: Formula, m: Model, env: Assignment = {}): boolean {
  return _evaluate(f, m, _canonicalDomain(m), env);
}

/**
 * The extension of a set expression: which domain elements are in it.
 *
 * The returned Set iterates in sorted element order regardless of the model's
 * or the expression's shape, so two runs — and two equivalent expressions —
 * produce byte-identical output.
 *
 * Precondition: as `evaluate` (a builder body may have free variables, which
 * must be bound in `env`).
 */
export function evalSet(s: SetExpr, m: Model, env: Assignment = {}): Set<string> {
  return _evalSet(s, m, _canonicalDomain(m), env);
}

/**
 * The variables of `f` that are not bound by any enclosing quantifier or
 * set-builder. Iterates in sorted order.
 */
export function freeVars(f: Formula): Set<string> {
  const out = new Set<string>();
  _freeInFormula(f, new Set<string>(), out);
  return new Set([...out].sort());
}

/**
 * A sentence — a formula with no free variables — is the only kind of formula
 * that has a truth value in a model all by itself. Everything the grader
 * compares must be closed.
 */
export function isClosed(f: Formula): boolean {
  return freeVars(f).size === 0;
}
