/**
 * English readings of formulas.
 *
 * `gloss` turns a `Formula` into a sentence a child can read aloud. It feeds the
 * hint panel and the "which formula says this?" direction, where the English is
 * the *question* — so a gloss that is merely plausible is worse than useless. The
 * governing rule, and the reason this module is as blunt as it is:
 *
 *   **NO TWO NON-EQUIVALENT FORMULAS MAY SHARE A GLOSS.**
 *
 * If they did, a distractor generator could offer the learner two options that
 * read identically, one marked right and one marked wrong. So fluency is spent
 * only where it costs nothing. Everything else falls back to a literal,
 * fully-bracketed reading that is stilted on purpose.
 *
 * HOW THE RULE IS UPHELD
 *
 * The literal reading is an injective serialisation of the AST: every compound is
 * parenthesised (the outermost pair is dropped, since nothing follows it), every
 * quantifier states its variable and marks its body with ':'. Distinct trees
 * therefore give distinct strings. The idioms sit on top, and each one matches a
 * single tree shape and reads its parts back out, so it is injective too.
 *
 * That leaves exactly two places where distinct trees are deliberately allowed to
 * collide — and both collapse LOGICALLY EQUIVALENT formulas, which the rule
 * permits (it forbids collisions between formulas that *differ*):
 *
 *   ¬∃x (A(x) ∧ B(x))   and   ∀x (A(x) → ¬B(x))    both read "no A is B"
 *   A ⊆ B               and   ∀x (A(x) → B(x))     both read "every A is B"
 *
 * The second is not an accident either: `x ∈ A` and `A(x)` are the same fact (see
 * types.ts), so ⊆ and the universally-quantified conditional are the same claim,
 * and the lesson wants that identification made, not hidden.
 *
 * The one precondition a caller can violate is a `nouns` map that sends two
 * different sets to the same word. That would break injectivity at the leaves and
 * silently poison every gloss above them, so it throws.
 *
 * WHAT IS DELIBERATELY NOT FIXED
 *
 * A set name in predicate position reads as an adjective: "every dog is red". When
 * the predicate is really a noun this comes out stilted — "every cat is dog". That
 * is accepted. Distinguishing nouns from adjectives needs information the `nouns`
 * contract does not carry, and a guess that is wrong half the time buys fluency
 * with correctness. Stilted is the specified price.
 */

import type { Formula, SetExpr, Signature, Term } from './types';

/** Nice words for a set, so `Dog` can read as "dog"/"dogs". Keyed by set name. */
export type Nouns = Record<string, { singular: string; plural: string }>;

// ---------------------------------------------------------------------------
// Fixed vocabulary
// ---------------------------------------------------------------------------

/**
 * Multi-word by necessity, not taste. Set names are identifiers, so they can never
 * collide with a phrase containing a space — which is what keeps `x ∈ 𝕌` from
 * reading the same as `x ∈ Everything` for a set someone actually named
 * `Everything`. A one-word "everything" here would silently break injectivity.
 */
const THE_UNIVERSE = 'the universe';
const THE_EMPTY_SET = 'the empty set';

const ALWAYS_TRUE = 'always true';
const ALWAYS_FALSE = 'always false';

/** The unquantified individual in the literal reading: "for every thing x". */
const THING = 'thing';

/** Orthography only: the article never distinguishes two words, so a rough rule is safe. */
const VOWELS = 'aeiouAEIOU';

// ---------------------------------------------------------------------------
// Naming: set name -> word
// ---------------------------------------------------------------------------

interface Naming {
  /** Predicate/subject position: "every dog", "x is a dog". */
  singular: (setName: string) => string;
  /** Collection position: "x is in (dogs or cats)". */
  plural: (setName: string) => string;
}

function _naming(nouns: Nouns): Naming {
  return {
    singular: (s) => nouns[s]?.singular ?? s,
    plural: (s) => nouns[s]?.plural ?? s,
  };
}

function _article(word: string): string {
  return VOWELS.includes(word.charAt(0)) ? 'an' : 'a';
}

/**
 * A `nouns` map that sends two sets to one word makes the whole module lie: two
 * non-equivalent formulas would gloss identically and the grader would have no way
 * to tell. It is a puzzle-authoring bug and there is no sane way to render around
 * it, so it fails loudly and names both culprits.
 *
 * The two word-spaces are checked independently — singular and plural never appear
 * in the same slot, so `sheep`/`sheep` across the two is harmless.
 */
function _assertDistinctWords(sig: Signature, naming: Naming): void {
  for (const form of ['singular', 'plural'] as const) {
    const claimedBy = new Map<string, string>();
    // Sorted, so the error message is the same on every run.
    for (const setName of [...sig.sets].sort()) {
      const word = naming[form](setName);
      const owner = claimedBy.get(word);
      if (owner !== undefined) {
        throw new Error(
          `gloss: the sets ${owner} and ${setName} both read as "${word}" (${form}). ` +
            `Two sets that read the same make two different formulas say the same ` +
            `English, so this is refused. Give them different words in \`nouns\`.`,
        );
      }
      claimedBy.set(word, setName);
    }
  }
}

// ---------------------------------------------------------------------------
// Set expressions
// ---------------------------------------------------------------------------

/**
 * A set expression as a *collection* — the thing after "is in". Compounds always
 * bracket themselves: without that, `x ∈ A ∪ B` glossed as "x is in dogs or cats"
 * could not be told apart from `x ∈ A ∨ x ∈ B` glossed at the formula level.
 */
function _glossSet(s: SetExpr, n: Naming): string {
  switch (s.kind) {
    case 'set':
      return n.plural(s.name);
    case 'universe':
      return THE_UNIVERSE;
    case 'emptyset':
      return THE_EMPTY_SET;
    case 'union':
      return `(${_glossSet(s.left, n)} or ${_glossSet(s.right, n)})`;
    case 'inter':
      return `(${_glossSet(s.left, n)} and ${_glossSet(s.right, n)})`;
    case 'diff':
      return `(${_glossSet(s.left, n)} except ${_glossSet(s.right, n)})`;
    case 'compl':
      return `(everything except ${_glossSet(s.inner, n)})`;
    case 'builder':
      // The body is bracketed even when it is an atom: a set-builder can sit inside
      // a union, and "the things x such that x is a dog or cats" would be a lie.
      return `the things ${s.varName} such that (${_gloss(s.body, n, true)})`;
  }
}

/** `t ∈ S` and `t ∉ S`. Named sets read as a category; compounds read as a collection. */
function _member(term: Term, s: SetExpr, n: Naming, negated: boolean): string {
  const be = negated ? 'is not' : 'is';
  if (s.kind === 'set') {
    const word = n.singular(s.name);
    return `${term.name} ${be} ${_article(word)} ${word}`;
  }
  return `${term.name} ${be} in ${_glossSet(s, n)}`;
}

// ---------------------------------------------------------------------------
// Idioms
// ---------------------------------------------------------------------------

/** Is `t` the variable this quantifier bound? A constant that happens to share the name is not. */
function _isBound(t: Term, varName: string): boolean {
  return t.kind === 'var' && t.name === varName;
}

/**
 * `x ∈ A` with `x` the bound variable and `A` a bare *name* — the shape every noun
 * idiom is about. Returns the set name, or null.
 *
 * Compound sets are refused on purpose: "every (dog or cat) is red" would need the
 * collection reading inside a category slot, and the literal fallback says it
 * correctly already.
 */
function _atomOn(f: Formula, varName: string): string | null {
  if (f.kind !== 'member' || !_isBound(f.term, varName)) return null;
  return f.set.kind === 'set' ? f.set.name : null;
}

/** `¬(x ∈ A)` — which is exactly what the `∉` tile builds. */
function _negAtomOn(f: Formula, varName: string): string | null {
  return f.kind === 'not' ? _atomOn(f.inner, varName) : null;
}

/**
 * The natural reading, or null when the shape does not match exactly.
 *
 * `top` is passed because the two relation idioms end in a transitive verb ("...that
 * every thing Likes"). As a whole sentence that is fine; as a conjunct, "(there is a
 * thing that every thing Likes and x is a dog)" garden-paths into reading `x` as the
 * object. So they fire only as a whole sentence, and nested occurrences take the
 * bracketed literal reading instead. The noun idioms end in a noun or adjective and
 * are safe anywhere.
 */
function _idiom(f: Formula, n: Naming, top: boolean): string | null {
  switch (f.kind) {
    // A ⊆ B is the same claim as ∀x (A(x) → B(x)), and reads the same. See the
    // module docstring: this collision is intended and it is sound.
    case 'subset':
      if (f.left.kind === 'set' && f.right.kind === 'set') {
        return `every ${n.singular(f.left.name)} is ${n.singular(f.right.name)}`;
      }
      return null;

    case 'not': {
      // ¬∃x (A(x) ∧ B(x))  ->  "no A is B"
      const q = f.inner;
      if (q.kind !== 'exists' || q.body.kind !== 'and') return null;
      const a = _atomOn(q.body.left, q.varName);
      const b = _atomOn(q.body.right, q.varName);
      if (a === null || b === null) return null;
      return `no ${n.singular(a)} is ${n.singular(b)}`;
    }

    case 'forall': {
      const body = f.body;
      if (body.kind === 'implies') {
        const a = _atomOn(body.left, f.varName);
        if (a === null) return null;
        // ∀x (A(x) → B(x))  ->  "every A is B"
        const b = _atomOn(body.right, f.varName);
        if (b !== null) return `every ${n.singular(a)} is ${n.singular(b)}`;
        // ∀x (A(x) → ¬B(x))  ->  "no A is B"
        const nb = _negAtomOn(body.right, f.varName);
        if (nb !== null) return `no ${n.singular(a)} is ${n.singular(nb)}`;
        return null;
      }
      // ∀x ∃y R(x, y)  ->  "every thing R's at least one thing"
      if (top && body.kind === 'exists') {
        const rel = _relOn(body.body, f.varName, body.varName);
        if (rel !== null) return `every ${THING} ${rel} at least one ${THING}`;
      }
      return null;
    }

    case 'exists': {
      const body = f.body;
      if (body.kind === 'and') {
        const a = _atomOn(body.left, f.varName);
        if (a === null) return null;
        // ∃x (A(x) ∧ B(x))  ->  "some A is B"
        const b = _atomOn(body.right, f.varName);
        if (b !== null) return `some ${n.singular(a)} is ${n.singular(b)}`;
        // ∃x (A(x) ∧ ¬B(x))  ->  "some A is not B"
        const nb = _negAtomOn(body.right, f.varName);
        if (nb !== null) return `some ${n.singular(a)} is not ${n.singular(nb)}`;
        return null;
      }
      // ∃y ∀x R(x, y)  ->  "there is a thing that every thing R's".
      // The subject of R is the INNER variable here and the outer one in the ∀∃ case
      // above; swap them and it is a different, stronger claim. Hence two matchers,
      // not one, and each pins both argument positions.
      if (top && body.kind === 'forall') {
        const rel = _relOn(body.body, body.varName, f.varName);
        if (rel !== null) return `there is a ${THING} that every ${THING} ${rel}`;
      }
      return null;
    }

    // ∃!x A(x)  ->  "there is exactly one A"
    case 'existsUnique': {
      const a = _atomOn(f.body, f.varName);
      return a === null ? null : `there is exactly one ${n.singular(a)}`;
    }

    default:
      return null;
  }
}

/**
 * `R(subject, object)` with those two variables in those two slots. Returns R's name.
 *
 * Requiring the two names to differ is not pedantry: under shadowing, `∀x ∃x R(x, x)`
 * satisfies every positional test while the outer quantifier is in fact vacuous, and
 * glossing it "every thing R's at least one thing" would be flatly false.
 */
function _relOn(f: Formula, subject: string, object: string): string | null {
  if (subject === object) return null;
  if (f.kind !== 'rel') return null;
  if (!_isBound(f.left, subject) || !_isBound(f.right, object)) return null;
  return f.name;
}

// ---------------------------------------------------------------------------
// Literal reading
// ---------------------------------------------------------------------------

/**
 * The fallback: unambiguous, injective, and stilted.
 *
 * `top` says nothing follows this node inside the enclosing bracket, so the brackets
 * a compound would otherwise print can be dropped. Only the root is `top`, which is
 * why the root of a conjunction reads "P and Q" while a nested one reads "(P and Q)".
 */
function _literal(f: Formula, n: Naming, top: boolean): string {
  const wrap = (s: string): string => (top ? s : `(${s})`);

  switch (f.kind) {
    case 'true':
      return ALWAYS_TRUE;
    case 'false':
      return ALWAYS_FALSE;

    case 'member':
      return _member(f.term, f.set, n, false);
    case 'eq':
      return `${f.left.name} is the same ${THING} as ${f.right.name}`;
    case 'rel':
      return `${f.left.name} ${f.name} ${f.right.name}`;
    case 'seteq':
      return `${_glossSet(f.left, n)} and ${_glossSet(f.right, n)} contain exactly the same things`;
    case 'subset':
      return `everything in ${_glossSet(f.left, n)} is also in ${_glossSet(f.right, n)}`;

    case 'not': {
      // ∉ and ≠ are the negations a learner already reads as one word; the rest need
      // the long form, because "x does not Likes y" is not English.
      const inner = f.inner;
      if (inner.kind === 'member') return _member(inner.term, inner.set, n, true);
      if (inner.kind === 'eq') {
        return `${inner.left.name} is not the same ${THING} as ${inner.right.name}`;
      }
      if (inner.kind === 'seteq') {
        return (
          `${_glossSet(inner.left, n)} and ${_glossSet(inner.right, n)} ` +
          `do not contain exactly the same things`
        );
      }
      return wrap(`it is not the case that ${_gloss(inner, n, false)}`);
    }

    case 'and':
      return wrap(`${_gloss(f.left, n, false)} and ${_gloss(f.right, n, false)}`);
    case 'or':
      return wrap(`${_gloss(f.left, n, false)} or ${_gloss(f.right, n, false)}`);
    case 'implies':
      return wrap(`if ${_gloss(f.left, n, false)} then ${_gloss(f.right, n, false)}`);
    case 'iff':
      return wrap(
        `${_gloss(f.left, n, false)} if and only if ${_gloss(f.right, n, false)}`,
      );

    // The ':' is what makes the scope readable without knowing the scope rule, and the
    // wrap is what makes it unambiguous: a nested quantifier is bracketed, so the "and"
    // in "(for every thing x: x is a dog) and P" can never be read as part of the body.
    case 'forall':
      return wrap(`for every ${THING} ${f.varName}: ${_gloss(f.body, n, false)}`);
    case 'exists':
      return wrap(`there is a ${THING} ${f.varName} such that: ${_gloss(f.body, n, false)}`);
    case 'existsUnique':
      return wrap(
        `there is exactly one ${THING} ${f.varName} such that: ${_gloss(f.body, n, false)}`,
      );
  }
}

function _gloss(f: Formula, n: Naming, top: boolean): string {
  return _idiom(f, n, top) ?? _literal(f, n, top);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * A stilted but unambiguously correct English reading of `f`.
 *
 * Canonical shapes get their natural reading ("every dog is red", "no dog is red",
 * "some dog is not red"); everything else gets a literal, bracketed one ("for every
 * thing x: (x is a dog and x is red)"). Two formulas that are not logically
 * equivalent never come out the same — see the module docstring for why, and for the
 * two intended collisions between formulas that *are* equivalent.
 *
 * Preconditions:
 *  - `nouns` must not give two of `sig`'s sets the same word (throws).
 *  - As `renderFormula`: no variable in `f` may share its name with a constant, since
 *    the surface — and English — spell the two the same way.
 */
export function gloss(f: Formula, sig: Signature, nouns: Nouns = {}): string {
  const naming = _naming(nouns);
  _assertDistinctWords(sig, naming);
  return _gloss(f, naming, true);
}
