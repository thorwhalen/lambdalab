/**
 * Tokenizer, parser and renderer for LambdaLab's set-theory + logic language.
 *
 * The learner builds sentences out of tiles, one token per tile, and we must be
 * able to (a) read them back into a `Formula`, and (b) print any `Formula` in a
 * form the learner will recognise. So `parseFormula` and `renderFormula` are two
 * halves of one contract: **parseFormula(renderFormula(f), sig) is structurally
 * equal to f** for any well-formed f. Every change to one is a change to both.
 *
 * Three conventions are load-bearing, and each is a classic place to teach —
 * or, done wrong, to *mis*-teach — a child:
 *
 * 1. QUANTIFIER SCOPE IS MAXIMAL. A quantifier's body runs as far right as it
 *    can: `∀x Dog(x) ∧ Red(x)` is `∀x (Dog(x) ∧ Red(x))`, not `(∀x Dog(x)) ∧ Red(x)`.
 *    This is the standard convention. It is also the single most common thing a
 *    learner gets wrong, so the *renderer* refuses to rely on it: it always puts
 *    the body in parentheses unless the body is self-delimiting (a relation
 *    application, ⊤/⊥) or another quantifier. Reading a rendered formula must
 *    never require knowing the scope rule; writing one may.
 *
 * 2. `Dog(x)` IS SUGAR FOR `x ∈ Dog`. A set and a unary predicate are the same
 *    thing (see types.ts), so the sugar is resolved at parse time — there is no
 *    'apply' node. The parser accepts both spellings; the renderer emits only the
 *    membership spelling, which is the one the lesson is trying to make habitual.
 *
 * 3. `∉` AND `≠` ARE SUGAR FOR `¬(∈)` AND `¬(=)`. The AST has no separate node
 *    for them, so the renderer prints `¬(x ∈ A)` back as `x ∉ A` — the standard
 *    mathematical spelling of that exact tree, and the only way those two glyphs
 *    can ever appear in rendered output. A learner who builds `¬ ( x ∈ A )` from
 *    tiles will therefore see `x ∉ A`. That is a true statement about their
 *    formula, not a lost tile.
 *
 * Precedence, loosest to tightest: quantifier < ↔ < → < ∨ < ∧ < ¬ < ∈ ∉ = ≠ ⊆ < atoms.
 * `→` is right-associative; `∧ ∨ ↔` are left-associative.
 * Set expressions: `ᶜ` (postfix) > `∩` > `∪` ≈ `∖` (left-associative).
 *
 * Error positions (`at`) are indices into the TOKEN stream, never into the source
 * string — the UI's unit of blame is a tile, and tiles are tokens. This is also
 * the only index that means the same thing whether `parseFormula` was handed a
 * string or an array of tile tokens.
 */

import type { Formula, LogicParseResult, SetExpr, Signature, Term } from './types';

// ---------------------------------------------------------------------------
// The alphabet — every symbol the language knows, named exactly once.
// ---------------------------------------------------------------------------

const T = {
  FORALL: '∀',
  EXISTS: '∃',
  EXISTS_UNIQUE: '∃!',
  NOT: '¬',
  AND: '∧',
  OR: '∨',
  IMPLIES: '→',
  IFF: '↔',
  IN: '∈',
  NOT_IN: '∉',
  UNION: '∪',
  INTER: '∩',
  DIFF: '∖',
  COMPL: 'ᶜ',
  SUBSET: '⊆',
  EQ: '=',
  NE: '≠',
  EMPTY: '∅',
  UNIVERSE: '𝕌',
  TRUE: '⊤',
  FALSE: '⊥',
  LPAREN: '(',
  RPAREN: ')',
  LBRACE: '{',
  RBRACE: '}',
  BAR: '|',
  COMMA: ',',
} as const;

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokens that span more than one code point, longest-first within a shared
 * prefix (`∃!` must beat `∃`, `<->` must beat `->`). Each maps to its canonical
 * spelling, so the parser downstream only ever sees the Unicode form.
 */
const MULTI_CODEPOINT_TOKENS: ReadonlyArray<readonly [string, string]> = [
  ['<->', T.IFF],
  ['∃!', T.EXISTS_UNIQUE],
  ['->', T.IMPLIES],
  ['!=', T.NE],
  // A doubled backslash is the LaTeX-ish spelling some keyboards produce; a lone
  // backslash is the plain ASCII one. Both mean set difference.
  ['\\\\', T.DIFF],
];

const SINGLE_CODEPOINT_ALIASES: Readonly<Record<string, string>> = {
  '\\': T.DIFF,
};

/**
 * Identifiers are ASCII alphanumeric runs. Deliberately NOT `\p{L}`: `ᶜ` (U+1D9C,
 * MODIFIER LETTER SMALL C) is a *letter* to Unicode, and would silently glue
 * itself onto the end of `A` — turning the complement `Aᶜ` into an unknown set
 * named "Aᶜ". This is the one tokenizer bug that would be nearly invisible.
 */
const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;
const IDENT_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const WHITESPACE = /\s/;

/** Code-point lengths, precomputed: `∃!` is 2 code points, `<->` is 3. */
const MULTI_LENGTHS: ReadonlyArray<number> = MULTI_CODEPOINT_TOKENS.map(([pattern]) =>
  Array.from(pattern).length,
);

/**
 * Split source text into canonical tokens.
 *
 * Never fails: an unrecognised code point becomes a token of its own, so the
 * parser can blame it by index with a message the learner can act on. Idempotent
 * on already-tokenized input, which is what lets `parseFormula` accept a tile
 * array and a string through the same door.
 */
export function tokenizeLogic(src: string): string[] {
  // Iterate code points, not UTF-16 units: `𝕌` (U+1D54C) is a surrogate pair and
  // charAt-style scanning would tear it in half.
  const cp = Array.from(src);
  const out: string[] = [];
  let i = 0;

  while (i < cp.length) {
    const ch = cp[i] as string;

    if (WHITESPACE.test(ch)) {
      i += 1;
      continue;
    }

    const multi = matchMultiCodepoint(cp, i);
    if (multi !== undefined) {
      out.push(multi.token);
      i += multi.length;
      continue;
    }

    const alias = SINGLE_CODEPOINT_ALIASES[ch];
    if (alias !== undefined) {
      out.push(alias);
      i += 1;
      continue;
    }

    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < cp.length && IDENT_CHAR.test(cp[j] as string)) j += 1;
      out.push(cp.slice(i, j).join(''));
      i = j;
      continue;
    }

    out.push(ch);
    i += 1;
  }

  return out;
}

function matchMultiCodepoint(
  cp: readonly string[],
  at: number,
): { token: string; length: number } | undefined {
  for (let k = 0; k < MULTI_CODEPOINT_TOKENS.length; k += 1) {
    const entry = MULTI_CODEPOINT_TOKENS[k] as readonly [string, string];
    const length = MULTI_LENGTHS[k] as number;
    if (cp.slice(at, at + length).join('') === entry[0]) {
      return { token: entry[1], length };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Parser — cursor and failure
// ---------------------------------------------------------------------------

interface Ctx {
  readonly tokens: readonly string[];
  /** Index of the next unread token. The one piece of mutable state. */
  i: number;
  readonly sets: ReadonlySet<string>;
  readonly relations: ReadonlySet<string>;
  readonly constants: ReadonlySet<string>;
}

/** Carries the token index of the blame, which the UI turns into a highlighted tile. */
class ParseError extends Error {
  readonly at: number;
  constructor(message: string, at: number) {
    super(message);
    this.name = 'ParseError';
    this.at = at;
  }
}

const peek = (c: Ctx): string | undefined => (c.i < c.tokens.length ? c.tokens[c.i] : undefined);

const advance = (c: Ctx): string | undefined => {
  const t = peek(c);
  if (t !== undefined) c.i += 1;
  return t;
};

const fail = (c: Ctx, message: string, at: number = c.i): never => {
  throw new ParseError(message, at);
};

/** How a token is named inside a message; end-of-input is not a token but must read as one. */
const shown = (t: string | undefined): string =>
  t === undefined ? 'the end of the formula' : `'${t}'`;

type Category = 'relation' | 'set' | 'constant' | 'variable';

/**
 * What an identifier means *in this puzzle*. Anything the signature does not
 * name is a variable — that is the rule that makes `∀x` work without declaring x.
 *
 * A name repeated across two categories is a malformed signature; rather than
 * throw at parse time (the learner cannot fix a signature), we resolve in a
 * fixed order — relation, then set, then constant — so the result is at least
 * deterministic and the puzzle author's bug is visible rather than flaky.
 */
const categoryOf = (c: Ctx, name: string): Category =>
  c.relations.has(name)
    ? 'relation'
    : c.sets.has(name)
      ? 'set'
      : c.constants.has(name)
        ? 'constant'
        : 'variable';

const isIdentifier = (t: string | undefined): boolean => t !== undefined && IDENT_TOKEN.test(t);

// ---------------------------------------------------------------------------
// Parser — entry point
// ---------------------------------------------------------------------------

/**
 * Read a formula from source text or from a tile array.
 *
 * A tile array is tokenized element-wise and flattened, so a palette that emits
 * one token per tile and a lesson author who writes a string reach the same
 * parser. Never throws: every failure comes back as `{ ok: false, message, at }`
 * with `at` a token index.
 */
export function parseFormula(input: string | string[], sig: Signature): LogicParseResult {
  const tokens = typeof input === 'string' ? tokenizeLogic(input) : input.flatMap((t) => tokenizeLogic(t));

  if (tokens.length === 0) {
    return { ok: false, message: 'Nothing to read yet — add some tiles.', at: 0 };
  }

  const c: Ctx = {
    tokens,
    i: 0,
    sets: new Set(sig.sets),
    relations: new Set(sig.relations),
    constants: new Set(sig.constants),
  };

  try {
    const formula = parseIff(c);
    const leftover = peek(c);
    if (leftover !== undefined) {
      fail(
        c,
        leftover === T.RPAREN
          ? "Unmatched ')' — there is no '(' for it to close."
          : `I did not expect ${shown(leftover)} here. Is a connective (∧, ∨, →) missing before it?`,
      );
    }
    return { ok: true, formula };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, message: e.message, at: e.at };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Parser — formulas, loosest binding first
// ---------------------------------------------------------------------------

/** ↔ : lowest precedence, left-associative. */
function parseIff(c: Ctx): Formula {
  let left = parseImplies(c);
  while (peek(c) === T.IFF) {
    advance(c);
    const right = parseImplies(c);
    left = { kind: 'iff', left, right };
  }
  return left;
}

/** → : right-associative, so `A → B → C` is `A → (B → C)`. */
function parseImplies(c: Ctx): Formula {
  const left = parseOr(c);
  if (peek(c) !== T.IMPLIES) return left;
  advance(c);
  const right = parseImplies(c);
  return { kind: 'implies', left, right };
}

function parseOr(c: Ctx): Formula {
  let left = parseAnd(c);
  while (peek(c) === T.OR) {
    advance(c);
    const right = parseAnd(c);
    left = { kind: 'or', left, right };
  }
  return left;
}

function parseAnd(c: Ctx): Formula {
  let left = parseUnary(c);
  while (peek(c) === T.AND) {
    advance(c);
    const right = parseUnary(c);
    left = { kind: 'and', left, right };
  }
  return left;
}

const QUANTIFIER_KIND: Readonly<Record<string, 'forall' | 'exists' | 'existsUnique'>> = {
  [T.FORALL]: 'forall',
  [T.EXISTS]: 'exists',
  [T.EXISTS_UNIQUE]: 'existsUnique',
};

/**
 * ¬ and the quantifiers. Both are prefix, but they differ in reach, and the
 * difference is the whole lesson:
 *   ¬ takes a UNARY argument   — `¬A ∧ B` is `(¬A) ∧ B`.
 *   ∀ takes the WHOLE REST     — `∀x A ∧ B` is `∀x (A ∧ B)`.
 * That is why the quantifier body recurses to `parseIff` (the loosest level)
 * while ¬ recurses to `parseUnary` (the tightest prefix level).
 */
function parseUnary(c: Ctx): Formula {
  const t = peek(c);

  if (t === T.NOT) {
    advance(c);
    return { kind: 'not', inner: parseUnary(c) };
  }

  if (t !== undefined && t in QUANTIFIER_KIND) {
    advance(c);
    const kind = QUANTIFIER_KIND[t] as 'forall' | 'exists' | 'existsUnique';
    const varName = parseBindingVar(c, t);
    const body = parseIff(c);
    return { kind, varName, body };
  }

  return parseAtomFormula(c);
}

/** The variable a quantifier or a set-builder binds. Must be a fresh name, not a signature name. */
function parseBindingVar(c: Ctx, binder: string): string {
  const t = peek(c);

  if (!isIdentifier(t)) {
    return fail(c, `${binder} needs a variable after it (like x, y or z), but I found ${shown(t)}.`);
  }

  const name = t as string;
  const category = categoryOf(c, name);
  if (category !== 'variable') {
    return fail(
      c,
      `${binder} needs a fresh variable (like x, y or z), but '${name}' already names a ${category} in this puzzle.`,
    );
  }

  advance(c);
  return name;
}

/**
 * An atomic formula, or a parenthesised one.
 *
 * The only genuine ambiguity in the language is a leading '(': it may open a
 * formula — `(x ∈ A) ∧ B` — or a set expression — `(A ∪ B) ⊆ C`. Sets are not
 * formulas, so at most one reading can succeed; we speculatively try the set
 * reading (which is the one that demands a set relation after it) and fall back.
 */
function parseAtomFormula(c: Ctx): Formula {
  const t = peek(c);

  if (t === undefined) {
    return fail(c, 'The formula stops early — something is missing at the end.');
  }

  if (t === T.TRUE) {
    advance(c);
    return { kind: 'true' };
  }

  if (t === T.FALSE) {
    advance(c);
    return { kind: 'false' };
  }

  if (t === T.LPAREN) {
    const saved = c.i;
    try {
      return parseSetRelation(c);
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      c.i = saved;
    }
    advance(c); // the '('
    const inner = parseIff(c);
    expectRParen(c);
    return inner;
  }

  // ∅, 𝕌 and { x | φ } can only be sets, so only a set relation can follow.
  if (t === T.EMPTY || t === T.UNIVERSE || t === T.LBRACE) {
    return parseSetRelation(c);
  }

  if (isIdentifier(t)) {
    const name = t;
    const category = categoryOf(c, name);
    const applied = c.tokens[c.i + 1] === T.LPAREN;

    if (applied) return parseApplication(c, name, category);

    if (category === 'set') return parseSetRelation(c);

    if (category === 'relation') {
      return fail(c, `'${name}' is a relation between two things — write ${name}(x, y).`);
    }

    return parseTermRelation(c);
  }

  return fail(c, `I did not expect ${shown(t)} at the start of a fact.`);
}

/** `Dog(x)` — sugar, resolved here into a membership. `Likes(x, y)` — a relation. */
function parseApplication(c: Ctx, name: string, category: Category): Formula {
  const nameAt = c.i;
  advance(c); // the name
  advance(c); // the '('

  if (category === 'variable') {
    return fail(
      c,
      `I don't know the name '${name}' — it is not a set or a relation in this puzzle.`,
      nameAt,
    );
  }

  if (category === 'constant') {
    return fail(
      c,
      `'${name}' names one particular thing, so it cannot be applied like ${name}(x).`,
      nameAt,
    );
  }

  if (category === 'set') {
    const term = parseTerm(c, `inside ${name}( )`);
    if (peek(c) === T.COMMA) {
      return fail(
        c,
        `'${name}' is a set, so it applies to one thing at a time: write ${name}(x), not ${name}(x, y).`,
      );
    }
    expectRParen(c);
    // The identification that the whole lesson rests on: Dog(x) IS x ∈ Dog.
    return { kind: 'member', term, set: { kind: 'set', name } };
  }

  const left = parseTerm(c, `inside ${name}( )`);
  if (peek(c) !== T.COMMA) {
    return fail(
      c,
      `'${name}' is a relation between two things — write ${name}(x, y), with a comma.`,
    );
  }
  advance(c);
  const right = parseTerm(c, `inside ${name}( )`);
  expectRParen(c);
  return { kind: 'rel', name, left, right };
}

/** A fact about an individual: `x ∈ A`, `x ∉ A`, `x = y`, `x ≠ y`. */
function parseTermRelation(c: Ctx): Formula {
  const term = parseTerm(c, 'at the start of a fact');
  const op = peek(c);

  if (op === T.IN || op === T.NOT_IN) {
    advance(c);
    const set = parseSetExpr(c, `after ${op}`);
    const member: Formula = { kind: 'member', term, set };
    return op === T.IN ? member : { kind: 'not', inner: member };
  }

  if (op === T.EQ || op === T.NE) {
    advance(c);
    const right = parseTerm(c, `after ${op}`);
    const eq: Formula = { kind: 'eq', left: term, right };
    return op === T.EQ ? eq : { kind: 'not', inner: eq };
  }

  return fail(
    c,
    `Expected ∈, ∉, = or ≠ after '${termName(term)}', but found ${shown(op)}.`,
  );
}

/** A fact about sets: `A ⊆ B`, `A = B`, `A ≠ B`. */
function parseSetRelation(c: Ctx): Formula {
  const startedAt = c.i;
  const left = parseSetExpr(c, 'at the start of a fact');
  const op = peek(c);

  if (op === T.IN || op === T.NOT_IN) {
    // `Dog ∈ A` — the category error, not a missing-operator error. A set is not
    // an individual, and saying so is far more use than "expected ⊆, = or ≠".
    const s = renderSet(left);
    return fail(
      c,
      `'${s}' is a set, not an individual thing, so it cannot go on the left of ${op}. Did you mean 'x ${op} ${s}'?`,
      startedAt,
    );
  }

  if (op === T.SUBSET) {
    advance(c);
    return { kind: 'subset', left, right: parseSetExpr(c, `after ${T.SUBSET}`) };
  }

  if (op === T.EQ || op === T.NE) {
    advance(c);
    const right = parseSetExpr(c, `after ${op}`);
    const eq: Formula = { kind: 'seteq', left, right };
    return op === T.EQ ? eq : { kind: 'not', inner: eq };
  }

  return fail(c, `Expected ⊆, = or ≠ after the set ${renderSet(left)}, but found ${shown(op)}.`);
}

// ---------------------------------------------------------------------------
// Parser — terms and set expressions
// ---------------------------------------------------------------------------

const termName = (t: Term): string => t.name;

function parseTerm(c: Ctx, where: string): Term {
  const t = peek(c);

  if (!isIdentifier(t)) {
    return fail(c, `Expected a name or a variable ${where}, but found ${shown(t)}.`);
  }

  const name = t as string;
  const category = categoryOf(c, name);

  if (category === 'set') {
    return fail(
      c,
      `'${name}' is a set, not an individual thing — did you mean 'x ∈ ${name}'?`,
    );
  }

  if (category === 'relation') {
    return fail(c, `'${name}' is a relation, not an individual thing — write ${name}(x, y).`);
  }

  advance(c);
  return category === 'constant' ? { kind: 'const', name } : { kind: 'var', name };
}

/** ∪ and ∖ share the loosest set level and associate left: `A ∪ B ∖ C` is `(A ∪ B) ∖ C`. */
function parseSetExpr(c: Ctx, where: string): SetExpr {
  let left = parseSetInter(c, where);
  for (;;) {
    const op = peek(c);
    if (op !== T.UNION && op !== T.DIFF) return left;
    advance(c);
    const right = parseSetInter(c, `after ${op}`);
    left = op === T.UNION ? { kind: 'union', left, right } : { kind: 'diff', left, right };
  }
}

function parseSetInter(c: Ctx, where: string): SetExpr {
  let left = parseSetComplement(c, where);
  while (peek(c) === T.INTER) {
    advance(c);
    const right = parseSetComplement(c, `after ${T.INTER}`);
    left = { kind: 'inter', left, right };
  }
  return left;
}

/** ᶜ is postfix and binds tightest; it may stack, so `Aᶜᶜ` is A complemented twice. */
function parseSetComplement(c: Ctx, where: string): SetExpr {
  let inner = parseSetPrimary(c, where);
  while (peek(c) === T.COMPL) {
    advance(c);
    inner = { kind: 'compl', inner };
  }
  return inner;
}

function parseSetPrimary(c: Ctx, where: string): SetExpr {
  const t = peek(c);

  if (t === T.EMPTY) {
    advance(c);
    return { kind: 'emptyset' };
  }

  if (t === T.UNIVERSE) {
    advance(c);
    return { kind: 'universe' };
  }

  if (t === T.LPAREN) {
    advance(c);
    const inner = parseSetExpr(c, 'inside ( )');
    expectRParen(c);
    return inner;
  }

  if (t === T.LBRACE) {
    advance(c);
    const varName = parseBindingVar(c, '{');
    if (peek(c) !== T.BAR) {
      return fail(
        c,
        `A set-builder looks like { ${varName} | ... }. Expected | after '${varName}', but found ${shown(peek(c))}.`,
      );
    }
    advance(c);
    const body = parseIff(c);
    if (peek(c) !== T.RBRACE) {
      return fail(c, `Unclosed { — expected } to finish the set-builder, but found ${shown(peek(c))}.`);
    }
    advance(c);
    return { kind: 'builder', varName, body };
  }

  if (isIdentifier(t)) {
    const name = t as string;
    const category = categoryOf(c, name);
    if (category === 'set') {
      advance(c);
      return { kind: 'set', name };
    }
    return fail(
      c,
      `Expected a set ${where}, but '${name}' is ${describeCategory(category)}, not a set.`,
    );
  }

  return fail(c, `Expected a set ${where}, but found ${shown(t)}.`);
}

const describeCategory = (category: Category): string =>
  category === 'constant'
    ? 'one particular thing'
    : category === 'relation'
      ? 'a relation'
      : 'a variable';

function expectRParen(c: Ctx): void {
  const t = peek(c);
  if (t !== T.RPAREN) {
    fail(
      c,
      t === undefined
        ? "Unclosed ( — the formula ends before its ')'."
        : `Unclosed ( — expected ')' but found ${shown(t)}.`,
    );
  }
  advance(c);
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Binding strengths, loosest to tightest. A child is parenthesised exactly when
 * its own strength is below the strength its slot demands — which is what makes
 * the output minimally parenthesised.
 *
 * PREC_QUANT is below everything because a quantifier swallows whatever follows
 * it; it therefore needs a second condition beyond precedence (see `isRightEdge`).
 * PREC_REL sits between ¬ and the atoms so that `¬(A ⊆ B)` keeps its parens (the
 * bare `¬A ⊆ B` would re-parse correctly but reads as nonsense) while
 * `x ∈ A ∧ y ∈ B` does not acquire any.
 */
const PREC_QUANT = 0;
const PREC_IFF = 1;
const PREC_IMPLIES = 2;
const PREC_OR = 3;
const PREC_AND = 4;
const PREC_REL = 5;
const PREC_NOT = 6;
const PREC_ATOM = 7;

const QUANT_GLYPH: Readonly<Record<'forall' | 'exists' | 'existsUnique', string>> = {
  forall: T.FORALL,
  exists: T.EXISTS,
  existsUnique: T.EXISTS_UNIQUE,
};

const isQuantifier = (f: Formula): boolean =>
  f.kind === 'forall' || f.kind === 'exists' || f.kind === 'existsUnique';

/** True when `¬f` will be printed with an infix glyph (∉, ≠) rather than a leading ¬. */
const negationIsInfix = (inner: Formula): boolean =>
  inner.kind === 'member' || inner.kind === 'eq' || inner.kind === 'seteq';

/**
 * The strength of the STRING we are about to print, which is not always the
 * strength of the node: `not(member)` prints as the infix `x ∉ A`, so it binds
 * like a relation, not like a ¬.
 */
function precOf(f: Formula): number {
  switch (f.kind) {
    case 'forall':
    case 'exists':
    case 'existsUnique':
      return PREC_QUANT;
    case 'iff':
      return PREC_IFF;
    case 'implies':
      return PREC_IMPLIES;
    case 'or':
      return PREC_OR;
    case 'and':
      return PREC_AND;
    case 'not':
      return negationIsInfix(f.inner) ? PREC_REL : PREC_NOT;
    case 'member':
    case 'eq':
    case 'seteq':
    case 'subset':
      return PREC_REL;
    case 'rel':
    case 'true':
    case 'false':
      return PREC_ATOM;
  }
}

/**
 * Print a formula with the fewest parentheses that still re-parse to it.
 *
 * PRECONDITION: no variable in `f` shares a name with anything in the signature
 * it will be re-parsed against. The surface has one spelling for a variable and
 * for a constant, so `{kind:'var', name:'rex'}` with `rex` a constant cannot
 * survive a round trip. Formulas built by the parser always satisfy this.
 */
export function renderFormula(f: Formula): string {
  return render(f, PREC_QUANT, true);
}

/**
 * `minPrec` is the strength the enclosing slot demands. `isRightEdge` says
 * whether nothing else will be printed after this node inside the current
 * parenthesised region — the only condition under which a bare quantifier is
 * safe, because a quantifier's scope runs to the edge. `A ∧ ∀x φ` is fine;
 * `(A ∧ ∀x φ) ∨ C` must brace the quantifier, because `∨ C` follows it.
 */
function render(f: Formula, minPrec: number, isRightEdge: boolean): string {
  switch (f.kind) {
    case 'true':
      return T.TRUE;
    case 'false':
      return T.FALSE;

    case 'member':
      return wrap(`${f.term.name} ${T.IN} ${renderSet(f.set)}`, PREC_REL, minPrec);
    case 'eq':
      return wrap(`${f.left.name} ${T.EQ} ${f.right.name}`, PREC_REL, minPrec);
    case 'seteq':
      return wrap(
        `${renderSet(f.left)} ${T.EQ} ${renderSet(f.right)}`,
        PREC_REL,
        minPrec,
      );
    case 'subset':
      return wrap(
        `${renderSet(f.left)} ${T.SUBSET} ${renderSet(f.right)}`,
        PREC_REL,
        minPrec,
      );
    case 'rel':
      return `${f.name}(${f.left.name}, ${f.right.name})`;

    case 'not':
      return renderNot(f.inner, minPrec, isRightEdge);

    case 'and':
      return renderBinary(f.left, f.right, T.AND, PREC_AND, 'left', minPrec, isRightEdge);
    case 'or':
      return renderBinary(f.left, f.right, T.OR, PREC_OR, 'left', minPrec, isRightEdge);
    case 'iff':
      return renderBinary(f.left, f.right, T.IFF, PREC_IFF, 'left', minPrec, isRightEdge);
    case 'implies':
      return renderBinary(f.left, f.right, T.IMPLIES, PREC_IMPLIES, 'right', minPrec, isRightEdge);

    case 'forall':
    case 'exists':
    case 'existsUnique': {
      const body = renderQuantifierBody(f.body);
      const s = `${QUANT_GLYPH[f.kind]}${f.varName} ${body}`;
      // Precedence cannot save a quantifier: only being last can.
      return isRightEdge ? s : `(${s})`;
    }
  }
}

const wrap = (s: string, prec: number, minPrec: number): string =>
  prec < minPrec ? `(${s})` : s;

function renderNot(inner: Formula, minPrec: number, isRightEdge: boolean): string {
  // ∉ and ≠ are the standard spellings of these exact trees. See the module docstring.
  if (inner.kind === 'member') {
    return wrap(`${inner.term.name} ${T.NOT_IN} ${renderSet(inner.set)}`, PREC_REL, minPrec);
  }
  if (inner.kind === 'eq') {
    return wrap(`${inner.left.name} ${T.NE} ${inner.right.name}`, PREC_REL, minPrec);
  }
  if (inner.kind === 'seteq') {
    return wrap(
      `${renderSet(inner.left)} ${T.NE} ${renderSet(inner.right)}`,
      PREC_REL,
      minPrec,
    );
  }

  const parenthesised = PREC_NOT < minPrec;
  const s = `${T.NOT}${render(inner, PREC_NOT, parenthesised ? true : isRightEdge)}`;
  return parenthesised ? `(${s})` : s;
}

function renderBinary(
  left: Formula,
  right: Formula,
  glyph: string,
  prec: number,
  assoc: 'left' | 'right',
  minPrec: number,
  isRightEdge: boolean,
): string {
  const parenthesised = prec < minPrec;
  // Decide the parens BEFORE rendering the children: if we are about to add a ')'
  // then the right child is no longer at the edge of the enclosing region — it is
  // at the edge of this new one, which is a *stronger* guarantee, not a weaker one.
  const rightEdgeForRight = parenthesised ? true : isRightEdge;
  const leftMin = assoc === 'left' ? prec : prec + 1;
  const rightMin = assoc === 'left' ? prec + 1 : prec;

  const ls = render(left, leftMin, false);
  const rs = render(right, rightMin, rightEdgeForRight);
  const s = `${ls} ${glyph} ${rs}`;
  return parenthesised ? `(${s})` : s;
}

/**
 * A quantifier's body is always parenthesised unless it is self-delimiting (an
 * atom like `Likes(x, y)`, `⊤`, `⊥`) or another quantifier (so chains stay
 * clean: `∀x ∃y Likes(x, y)`).
 *
 * This is deliberately MORE than minimal. Reading `∀x x ∈ Dog → x ∈ Red` correctly
 * requires already knowing the maximal-scope rule; reading `∀x (x ∈ Dog → x ∈ Red)`
 * does not. The renderer's audience is a learner who does not know the rule yet.
 */
function renderQuantifierBody(body: Formula): string {
  const bare = isQuantifier(body) || precOf(body) >= PREC_ATOM;
  const s = render(body, PREC_QUANT, true);
  return bare ? s : `(${s})`;
}

// ---------------------------------------------------------------------------
// Renderer — set expressions
// ---------------------------------------------------------------------------

const SET_PREC_UNION = 1; // ∪ and ∖ share this level
const SET_PREC_INTER = 2;
const SET_PREC_ATOM = 3; // names, ∅, 𝕌, {x | φ}, and anything complemented

/** Print a set expression with the fewest parentheses that still re-parse to it. */
export function renderSet(s: SetExpr): string {
  return renderSetAt(s, SET_PREC_UNION);
}

function renderSetAt(s: SetExpr, minPrec: number): string {
  switch (s.kind) {
    case 'set':
      return s.name;
    case 'universe':
      return T.UNIVERSE;
    case 'emptyset':
      return T.EMPTY;

    case 'builder':
      // Self-delimiting: the braces are their own parentheses.
      return `{${s.varName} ${T.BAR} ${render(s.body, PREC_QUANT, true)}}`;

    case 'compl':
      // ᶜ is postfix and tightest, so anything looser underneath needs bracing.
      return `${renderSetAt(s.inner, SET_PREC_ATOM)}${T.COMPL}`;

    case 'inter':
      return wrap(
        `${renderSetAt(s.left, SET_PREC_INTER)} ${T.INTER} ${renderSetAt(s.right, SET_PREC_INTER + 1)}`,
        SET_PREC_INTER,
        minPrec,
      );

    case 'union':
    case 'diff': {
      const glyph = s.kind === 'union' ? T.UNION : T.DIFF;
      return wrap(
        `${renderSetAt(s.left, SET_PREC_UNION)} ${glyph} ${renderSetAt(s.right, SET_PREC_UNION + 1)}`,
        SET_PREC_UNION,
        minPrec,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------

/**
 * Total number of AST nodes in a formula — formula nodes, the set expressions
 * hanging off them, and the terms. Used to score "say it with fewer pieces" and
 * to break ties between equivalent answers, so it must count everything the
 * learner had to place, not just the connectives.
 */
export function formulaSize(f: Formula): number {
  switch (f.kind) {
    case 'true':
    case 'false':
      return 1;
    case 'member':
      return 1 + 1 + setSize(f.set); // node + term + set
    case 'eq':
      return 1 + 2;
    case 'rel':
      return 1 + 2;
    case 'seteq':
    case 'subset':
      return 1 + setSize(f.left) + setSize(f.right);
    case 'not':
      return 1 + formulaSize(f.inner);
    case 'and':
    case 'or':
    case 'implies':
    case 'iff':
      return 1 + formulaSize(f.left) + formulaSize(f.right);
    case 'forall':
    case 'exists':
    case 'existsUnique':
      return 1 + formulaSize(f.body);
  }
}

function setSize(s: SetExpr): number {
  switch (s.kind) {
    case 'set':
    case 'universe':
    case 'emptyset':
      return 1;
    case 'compl':
      return 1 + setSize(s.inner);
    case 'union':
    case 'inter':
    case 'diff':
      return 1 + setSize(s.left) + setSize(s.right);
    case 'builder':
      return 1 + formulaSize(s.body);
  }
}
