/**
 * Regular expressions — tokenizer, parser, renderer, simplifier.
 *
 * This is the *teaching* regex of formal-language theory: union, concatenation
 * and star (with `+` and `?` as sugar), plus the two constants ε and ∅. No
 * escapes, no classes, no backreferences — the entire point of the lesson is
 * that this tiny language is exactly as expressive as a finite automaton, and
 * every feature we add beyond it is a lie about that claim.
 *
 * Three commitments, because this code grades children:
 *
 * 1. **The alphabet is open.** Any character that is not one of the eight
 *    metacharacters `( ) | * + ? ε ∅` is a literal symbol, so {a,b}, {0,1} and
 *    emoji all work with zero configuration. The price is that a symbol can
 *    never *be* a metacharacter: there is no escape hatch, by design.
 *
 * 2. **Empty source parses to ε**, not to an error (see `parseRegex`). Every
 *    *other* empty production — `()`, `a|`, `a||b` — is an error, because there
 *    the learner plainly meant to write something and we should say where.
 *
 * 3. **Every simplification is sound.** A rewrite that changes the language is
 *    the worst bug this file could have: an un-pretty regex costs a par point,
 *    a wrong one teaches wrong mathematics. Identities that were not *certain*
 *    were left out. The two families of rewrites that do most of the work
 *    (`concatReps` / `unionReps`) carry their proof in a comment.
 */

import { EPSILON, type ParseResult, type RegexNode, type Sym } from './types';

// ---------------------------------------------------------------------------
// Surface syntax
// ---------------------------------------------------------------------------

/** The glyph for the empty language. (ε's glyph is `EPSILON`, from the shared types.) */
const EMPTY_SET = '∅';

const LPAREN = '(';
const RPAREN = ')';
const ALT = '|';
const STAR = '*';
const PLUS = '+';
const OPT = '?';

/**
 * Binding strength, loosest to tightest. Used by both the grammar (implicitly)
 * and the renderer (explicitly), so the two can never drift apart.
 */
const PREC_UNION = 1;
const PREC_CONCAT = 2;
const PREC_POSTFIX = 3;
const PREC_ATOM = 4;

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type TokKind =
  | typeof LPAREN
  | typeof RPAREN
  | typeof ALT
  | typeof STAR
  | typeof PLUS
  | typeof OPT
  | 'eps'
  | 'empty'
  | 'lit'
  | 'eof';

interface Tok {
  kind: TokKind;
  /** The source text of the token. For 'lit' this is the symbol itself. */
  text: string;
  /**
   * Offset of the token in the *source string*, in UTF-16 code units — i.e. a
   * valid `String.prototype.slice` index, which is what a text caret needs.
   * Astral literals (emoji) are one token but advance the offset by two.
   */
  at: number;
}

/**
 * Split the source into tokens, dropping whitespace.
 *
 * Iteration is by code point, not code unit, so an emoji is a single literal
 * symbol rather than two broken halves. `\s` here covers NBSP and the other
 * exotic spaces, which matters: children paste regexes out of chat apps.
 */
function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = String.fromCodePoint(src.codePointAt(i) as number);
    if (!/\s/u.test(ch)) toks.push({ kind: kindOf(ch), text: ch, at: i });
    i += ch.length;
  }
  toks.push({ kind: 'eof', text: '', at: src.length });
  return toks;
}

/**
 * The eight metacharacters, and nothing else. This table IS the "open alphabet"
 * rule: a character absent from it is a literal symbol, whatever it is.
 */
const METACHAR_KINDS: ReadonlyMap<string, TokKind> = new Map<string, TokKind>([
  [LPAREN, LPAREN],
  [RPAREN, RPAREN],
  [ALT, ALT],
  [STAR, STAR],
  [PLUS, PLUS],
  [OPT, OPT],
  [EPSILON, 'eps'],
  [EMPTY_SET, 'empty'],
]);

const kindOf = (ch: string): TokKind => METACHAR_KINDS.get(ch) ?? 'lit';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/*
 * Grammar (left-associative for both binary operators):
 *
 *   union   := concat ('|' concat)*
 *   concat  := postfix+
 *   postfix := atom ('*' | '+' | '?')*
 *   atom    := literal | 'ε' | '∅' | '(' union ')'
 */

/**
 * A syntax error in flight. Thrown, not returned, so the recursive-descent
 * functions can stay a plain grammar transcription. It is *branded* rather than
 * an `Error` subclass so that a genuine runtime bug in this module can never be
 * mistaken for a learner's typo — `parseRegex` rethrows anything unbranded.
 */
const SYNTAX_FAILURE = Symbol('regexParse.syntaxFailure');
interface SyntaxFailure {
  [SYNTAX_FAILURE]: true;
  message: string;
  at: number;
}

function fail(message: string, at: number): never {
  const failure: SyntaxFailure = { [SYNTAX_FAILURE]: true, message, at };
  throw failure;
}

function isSyntaxFailure(e: unknown): e is SyntaxFailure {
  return typeof e === 'object' && e !== null && SYNTAX_FAILURE in e;
}

/** The parser's only mutable state. A plain record — a class would buy nothing. */
interface Cursor {
  toks: Tok[];
  i: number;
}

const peek = (c: Cursor): Tok => c.toks[c.i];
const prev = (c: Cursor): Tok | undefined => (c.i > 0 ? c.toks[c.i - 1] : undefined);
const advance = (c: Cursor): Tok => c.toks[c.i++];

const startsAtom = (t: Tok): boolean =>
  t.kind === 'lit' || t.kind === 'eps' || t.kind === 'empty' || t.kind === LPAREN;

function parseUnion(c: Cursor): RegexNode {
  let node = parseConcat(c);
  while (peek(c).kind === ALT) {
    advance(c);
    node = { kind: 'union', left: node, right: parseConcat(c) };
  }
  return node;
}

function parseConcat(c: Cursor): RegexNode {
  if (!startsAtom(peek(c))) failMissingOperand(c);
  let node = parsePostfix(c);
  while (startsAtom(peek(c))) node = { kind: 'concat', left: node, right: parsePostfix(c) };
  return node;
}

function parsePostfix(c: Cursor): RegexNode {
  let node = parseAtom(c);
  // Postfix operators stack left to right, so `a*+` is (a*)+ and `a**` is (a*)*.
  for (;;) {
    switch (peek(c).kind) {
      case STAR:
        advance(c);
        node = { kind: 'star', inner: node };
        break;
      case PLUS:
        advance(c);
        node = { kind: 'plus', inner: node };
        break;
      case OPT:
        advance(c);
        node = { kind: 'optional', inner: node };
        break;
      default:
        return node;
    }
  }
}

function parseAtom(c: Cursor): RegexNode {
  const t = advance(c);
  switch (t.kind) {
    case 'lit':
      return { kind: 'literal', sym: t.text };
    case 'eps':
      return { kind: 'epsilon' };
    case 'empty':
      return { kind: 'empty' };
    case LPAREN: {
      const inner = parseUnion(c);
      // Point at the '(' rather than at the end of input: the unclosed bracket is
      // what the learner has to fix, and in a long regex the end tells them nothing.
      if (peek(c).kind !== RPAREN) fail(`This '(' is never closed — add a ')'.`, t.at);
      advance(c);
      return inner;
    }
    default:
      // Unreachable: parseConcat only calls in here when `startsAtom` holds.
      return fail(`Expected a symbol here.`, t.at);
  }
}

/**
 * Diagnose an operand that isn't there. Every branch of the grammar that can be
 * empty funnels through here, so all four "you left something out" errors get a
 * message that names what is missing and an offset pointing at the hole.
 */
function failMissingOperand(c: Cursor): never {
  const here = peek(c);
  const before = prev(c);

  // Order matters: the *most specific* reading of the hole wins. `(|a)` is a
  // missing alternative, not an empty group, even though a '(' sits behind it.
  if (here.kind === STAR || here.kind === PLUS || here.kind === OPT) {
    fail(`There is nothing before '${here.text}' to repeat.`, here.at);
  }
  if (before?.kind === LPAREN && here.kind === 'eof') {
    fail(`This '(' is never closed — add a ')'.`, before.at);
  }
  if (before?.kind === ALT) {
    fail(`Nothing after the '|' — an alternative needs something on both sides.`, here.at);
  }
  if (here.kind === ALT) {
    fail(`Nothing before the '|' — an alternative needs something on both sides.`, here.at);
  }
  if (before?.kind === LPAREN) {
    fail(`Empty group '()' — put something inside it, or write 'ε' for the empty string.`, here.at);
  }
  if (here.kind === RPAREN) {
    fail(`Unmatched ')' — there is no '(' for it to close.`, here.at);
  }
  // eof, no opener, no '|': only reachable from a source with no tokens at all,
  // which `parseRegex` has already answered with ε.
  fail(`Expected a symbol here.`, here.at);
}

/**
 * Parse a regex source string.
 *
 * An empty (or whitespace-only) source is **ε** — the regex matching exactly the
 * empty string — and not an error. A blank answer box is then a wrong answer the
 * grader can explain ("your regex matches only the empty string") rather than a
 * red squiggle, which is the pedagogy we want.
 *
 * Offsets in the failure case are UTF-16 code-unit indices into `src`.
 */
export function parseRegex(src: string): ParseResult {
  const toks = tokenize(src);
  if (toks.length === 1) return { ok: true, node: { kind: 'epsilon' } };

  const c: Cursor = { toks, i: 0 };
  try {
    const node = parseUnion(c);
    const rest = peek(c);
    if (rest.kind !== 'eof') {
      // The grammar consumes everything except a ')' that never had an opener.
      fail(
        rest.kind === RPAREN
          ? `Unmatched ')' — there is no '(' for it to close.`
          : `Unexpected '${rest.text}'.`,
        rest.at,
      );
    }
    return { ok: true, node };
  } catch (e) {
    if (isSyntaxFailure(e)) return { ok: false, message: e.message, at: e.at };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function precOf(n: RegexNode): number {
  switch (n.kind) {
    case 'union':
      return PREC_UNION;
    case 'concat':
      return PREC_CONCAT;
    case 'star':
    case 'plus':
    case 'optional':
      return PREC_POSTFIX;
    default:
      return PREC_ATOM;
  }
}

/** Wrap only when the child binds more loosely than its position allows. */
function renderAt(n: RegexNode, minPrec: number): string {
  const body = render(n);
  return precOf(n) < minPrec ? `${LPAREN}${body}${RPAREN}` : body;
}

function render(n: RegexNode): string {
  switch (n.kind) {
    case 'empty':
      return EMPTY_SET;
    case 'epsilon':
      return EPSILON;
    case 'literal':
      return n.sym;
    // Both binary operators parse left-associatively, so a right child of the
    // *same* operator must be parenthesised — `a|(b|c)` — or the tree shape is
    // lost on the round-trip. Requiring the right child to bind at least as
    // tightly as the next level up expresses exactly that, and nothing more.
    case 'union':
      return renderAt(n.left, PREC_UNION) + ALT + renderAt(n.right, PREC_CONCAT);
    case 'concat':
      return renderAt(n.left, PREC_CONCAT) + renderAt(n.right, PREC_POSTFIX);
    case 'star':
      return renderAt(n.inner, PREC_POSTFIX) + STAR;
    case 'plus':
      return renderAt(n.inner, PREC_POSTFIX) + PLUS;
    case 'optional':
      return renderAt(n.inner, PREC_POSTFIX) + OPT;
  }
}

/**
 * Render an AST with minimal parentheses.
 *
 * Guarantee: `parseRegex(renderRegex(n))` returns a node structurally equal to
 * `n`, and every parenthesis emitted is load-bearing (removing any one pair
 * either breaks the parse or changes the tree).
 *
 * Precondition: literal symbols are not metacharacters. The surface syntax has
 * no escape, so a hand-built `{kind:'literal', sym:'|'}` cannot round-trip —
 * nothing the parser produces can ever violate this.
 */
export function renderRegex(node: RegexNode): string {
  return render(node);
}

// ---------------------------------------------------------------------------
// Structural identity
// ---------------------------------------------------------------------------

/**
 * A canonical, injective serialisation of a node — the identity used by every
 * rewrite below ("is this the same `r` as that one?").
 *
 * Arrays, not objects: array serialisation is positional, so the key cannot
 * depend on property insertion order, and JSON escaping keeps it injective even
 * when a literal symbol is a quote or a bracket.
 */
function canon(n: RegexNode): unknown[] {
  switch (n.kind) {
    case 'empty':
      return ['0'];
    case 'epsilon':
      return ['e'];
    case 'literal':
      return ['l', n.sym];
    case 'concat':
      return ['.', canon(n.left), canon(n.right)];
    case 'union':
      return ['|', canon(n.left), canon(n.right)];
    case 'star':
      return ['*', canon(n.inner)];
    case 'plus':
      return ['+', canon(n.inner)];
    case 'optional':
      return ['?', canon(n.inner)];
  }
}

const keyOf = (n: RegexNode): string => JSON.stringify(canon(n));

const sameNode = (a: RegexNode, b: RegexNode): boolean => keyOf(a) === keyOf(b);

/** True iff the language contains ε. Decides when a `| ε` alternative is redundant. */
function nullable(n: RegexNode): boolean {
  switch (n.kind) {
    case 'empty':
    case 'literal':
      return false;
    case 'epsilon':
    case 'star':
    case 'optional':
      return true;
    case 'plus':
      return nullable(n.inner);
    case 'concat':
      return nullable(n.left) && nullable(n.right);
    case 'union':
      return nullable(n.left) || nullable(n.right);
  }
}

// ---------------------------------------------------------------------------
// Simplification
// ---------------------------------------------------------------------------

const NODE_EPSILON: RegexNode = Object.freeze({ kind: 'epsilon' as const });
const NODE_EMPTY: RegexNode = Object.freeze({ kind: 'empty' as const });

/**
 * A node read as "some number of copies of a base", where the copy-count ranges
 * over a *contiguous* interval. Our four postfix forms are exactly four
 * intervals:
 *
 *     r   = [1,1]     r?  = [0,1]     r+  = [1,∞)     r*  = [0,∞)
 *
 * Writing L_I(r) = ⋃_{i∈I} r^i, every rewrite in `concatReps` and `unionReps`
 * is an instance of one of two facts about languages:
 *
 *     L_I(r) · L_J(r) = L_{I+J}(r)      (sumset; contiguous + contiguous is contiguous)
 *     L_I(r) ∪ L_J(r) = L_{I∪J}(r)
 *
 * which is why they are safe, and why they subsume the whole mandated list of
 * concat/union identities (r·r* = r+, r*·r* = r*, r|r = r, …) without a pile of
 * one-off pattern matches that would each need their own proof.
 */
const UNBOUNDED = Number.POSITIVE_INFINITY;

interface Rep {
  base: RegexNode;
  /** 0 or 1. */
  min: number;
  /** 1 or UNBOUNDED. */
  max: number;
}

function asRep(n: RegexNode): Rep {
  switch (n.kind) {
    case 'star':
      return { base: n.inner, min: 0, max: UNBOUNDED };
    case 'plus':
      return { base: n.inner, min: 1, max: UNBOUNDED };
    case 'optional':
      return { base: n.inner, min: 0, max: 1 };
    default:
      return { base: n, min: 1, max: 1 };
  }
}

/** Precondition: `r` is one of the four spellable intervals. */
function fromRep(r: Rep): RegexNode {
  if (r.min === 0 && r.max === UNBOUNDED) return mkStar(r.base);
  if (r.min === 1 && r.max === UNBOUNDED) return mkPlus(r.base);
  if (r.min === 0 && r.max === 1) return mkOpt(r.base);
  return r.base;
}

/**
 * Concatenate two reps over the same base, or return null when the result is
 * not spellable. Both maxima are ≥ 1, so the sum is 2 (unspellable: `r·r`,
 * `r?·r?`) or ∞; and the sum of the minima must stay ≤ 1. Anything outside the
 * four intervals — [2,2], [0,2], [1,2], [2,∞) — is left exactly as written
 * rather than mangled into something with a different language.
 */
function concatReps(a: Rep, b: Rep): RegexNode | null {
  const min = a.min + b.min;
  const max = a.max + b.max;
  if (min > 1 || max !== UNBOUNDED) return null;
  return fromRep({ base: a.base, min, max });
}

/**
 * Union two reps over the same base. Always spellable: all four intervals
 * contain 1, so their union is contiguous, and its endpoints are min/max of the
 * endpoints — which are again one of the four.
 */
const unionReps = (a: Rep, b: Rep): Rep => ({
  base: a.base,
  min: Math.min(a.min, b.min),
  max: Math.max(a.max, b.max),
});

/*
 * Smart constructors for the postfix operators. Between them they cover the
 * complete 3×3 table of postfix-of-postfix, plus the constants. Each line is an
 * identity of languages; the non-obvious ones:
 *
 *   (r?)+ = (ε|r)+ = (ε|r)(ε|r)* = (ε|r)r* = r* | r·r* = r* | r+ = r*
 *   (r+)? = ε | r+ = r*
 *   ∅?    = ε | ∅ = ε
 */

function mkStar(inner: RegexNode): RegexNode {
  switch (inner.kind) {
    case 'empty': // ∅* = ε (zero copies is still a match)
    case 'epsilon': // ε* = ε
      return NODE_EPSILON;
    case 'star': // (r*)* = r*
      return inner;
    case 'plus': // (r+)* = r*
    case 'optional': // (r?)* = r*
      return { kind: 'star', inner: inner.inner };
    default:
      return { kind: 'star', inner };
  }
}

function mkPlus(inner: RegexNode): RegexNode {
  switch (inner.kind) {
    case 'empty': // ∅+ = ∅·∅* = ∅
      return NODE_EMPTY;
    case 'epsilon': // ε+ = ε
      return NODE_EPSILON;
    case 'star': // (r*)+ = r*
    case 'plus': // (r+)+ = r+
      return inner;
    case 'optional': // (r?)+ = r*
      return { kind: 'star', inner: inner.inner };
    default:
      return { kind: 'plus', inner };
  }
}

function mkOpt(inner: RegexNode): RegexNode {
  switch (inner.kind) {
    case 'empty': // ∅? = ε
    case 'epsilon': // ε? = ε
      return NODE_EPSILON;
    case 'star': // (r*)? = r*
    case 'optional': // (r?)? = r?
      return inner;
    case 'plus': // (r+)? = r*
      return { kind: 'star', inner: inner.inner };
    default:
      return { kind: 'optional', inner };
  }
}

function flatten(n: RegexNode, kind: 'concat' | 'union'): RegexNode[] {
  if (n.kind !== kind) return [n];
  return [...flatten(n.left, kind), ...flatten(n.right, kind)];
}

/** Rebuild the left-associative spine the parser would have produced. */
function foldLeft(parts: RegexNode[], kind: 'concat' | 'union'): RegexNode {
  return parts.reduce((left, right) => ({ kind, left, right }));
}

/**
 * r·ε = ε·r = r ; r·∅ = ∅·r = ∅ ; then the rep merges on adjacent factors.
 *
 * Working on the flattened spine (rather than pattern-matching a binary node)
 * is what makes the merges associativity-blind: `a·(a*·b)` reduces to `a+·b`
 * even though no sub-node of it is literally `r·r*`.
 */
function simplifyConcat(parts: RegexNode[]): RegexNode {
  if (parts.some((p) => p.kind === 'empty')) return NODE_EMPTY;
  const factors = parts.filter((p) => p.kind !== 'epsilon');
  if (factors.length === 0) return NODE_EPSILON;

  const acc: RegexNode[] = [];
  for (const factor of factors) {
    // Widened back to RegexNode on purpose: `factors` is narrowed to "not ε" by
    // the filter above, but a merge may legitimately produce any node at all.
    let next: RegexNode = factor;
    // A merge can expose a further merge (a·a*·a* → a+·a* → a+), so keep folding
    // the new factor into the tail for as long as the tail accepts it.
    while (acc.length > 0) {
      const lastRep = asRep(acc[acc.length - 1]);
      const nextRep = asRep(next);
      if (!sameNode(lastRep.base, nextRep.base)) break;
      const merged = concatReps(lastRep, nextRep);
      if (merged === null) break;
      acc.pop();
      next = merged;
    }
    acc.push(next);
  }
  return foldLeft(acc, 'concat');
}

/**
 * r|∅ = ∅|r = r ; r|r = r ; r|ε = r? ; and the rep merges on same-base terms
 * (a|a* = a*, a?|a+ = a*, …).
 *
 * ε is handled apart from the rep machinery because it is r^0 for *every* r: it
 * merges with the whole rest of the alternation at once, which is what makes
 * `a|b|ε` collapse to `(a|b)?` instead of dragging an ε term along. And when
 * some other alternative already matches ε, the ε is simply dropped — `ε|a*` is
 * `a*`, not `(a*)?`.
 */
function simplifyUnion(parts: RegexNode[]): RegexNode {
  const alts = parts.filter((p) => p.kind !== 'empty');
  if (alts.length === 0) return NODE_EMPTY;

  const hasEpsilon = alts.some((p) => p.kind === 'epsilon');
  const rest = alts.filter((p) => p.kind !== 'epsilon');
  if (rest.length === 0) return NODE_EPSILON;

  // Group by base, in first-occurrence order: deterministic, and it never
  // reorders the learner's alternatives on them.
  const groups: Array<{ key: string; rep: Rep }> = [];
  for (const term of rest) {
    const rep = asRep(term);
    const key = keyOf(rep.base);
    const found = groups.find((g) => g.key === key);
    if (found) found.rep = unionReps(found.rep, rep);
    else groups.push({ key, rep });
  }

  const merged = groups.map((g) => fromRep(g.rep));
  const union = foldLeft(merged, 'union');
  if (hasEpsilon && !merged.some(nullable)) return mkOpt(union);
  return union;
}

/** One bottom-up rewriting pass. Every rule it applies preserves the language. */
function normalize(n: RegexNode): RegexNode {
  switch (n.kind) {
    case 'empty':
    case 'epsilon':
    case 'literal':
      return n;
    case 'star':
      return mkStar(normalize(n.inner));
    case 'plus':
      return mkPlus(normalize(n.inner));
    case 'optional':
      return mkOpt(normalize(n.inner));
    case 'concat':
    case 'union': {
      // Re-flatten after normalising: a child can *become* a spine of the same
      // operator (`ab|ab` normalises to the concat `ab`), and those factors must
      // join the merge too.
      const parts = flatten(n, n.kind)
        .map(normalize)
        .flatMap((p) => flatten(p, n.kind));
      return n.kind === 'concat' ? simplifyConcat(parts) : simplifyUnion(parts);
    }
  }
}

/**
 * Rewriting passes are size-non-increasing, so a fixpoint is reached almost
 * immediately (one or two passes in practice). The cap exists only so that a
 * future rule which happens to oscillate degrades to "ugly output" instead of
 * "the lesson page hangs" — bailing out early is always *sound*, just not maximal.
 */
const MAX_SIMPLIFY_PASSES = 32;

/**
 * Rewrite a regex to an equivalent, smaller one — same language, fewer nodes.
 *
 * Guarantee: the result denotes exactly the same language as the input. The
 * output is also in a normal form: left-associated spines, no ∅ except a bare
 * `∅`, no ε except a bare `ε` or inside a form that needs it.
 */
export function simplifyRegex(node: RegexNode): RegexNode {
  let current = node;
  let key = keyOf(current);
  for (let pass = 0; pass < MAX_SIMPLIFY_PASSES; pass++) {
    const next = normalize(current);
    const nextKey = keyOf(next);
    if (nextKey === key) return current;
    current = next;
    key = nextKey;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------

/**
 * Number of nodes in the AST. This is the metric behind "solve it in ≤ N", so
 * it counts *structure*, not characters: parentheses and the sugar `+` / `?`
 * must not change a learner's score.
 */
export function regexSize(node: RegexNode): number {
  switch (node.kind) {
    case 'empty':
    case 'epsilon':
    case 'literal':
      return 1;
    case 'star':
    case 'plus':
    case 'optional':
      return 1 + regexSize(node.inner);
    case 'concat':
    case 'union':
      return 1 + regexSize(node.left) + regexSize(node.right);
  }
}

/**
 * The symbols actually mentioned by the regex — sorted, unique, and never
 * containing ε or ∅ (neither is an alphabet symbol).
 *
 * Note this is the regex's *own* alphabet: `a*` over the alphabet {a,b} reports
 * only ['a']. Callers that need the ambient alphabet must pass it in themselves.
 */
export function regexAlphabet(node: RegexNode): Sym[] {
  const syms = new Set<Sym>();
  const walk = (n: RegexNode): void => {
    switch (n.kind) {
      case 'literal':
        syms.add(n.sym);
        return;
      case 'star':
      case 'plus':
      case 'optional':
        walk(n.inner);
        return;
      case 'concat':
      case 'union':
        walk(n.left);
        walk(n.right);
        return;
      default:
        return;
    }
  };
  walk(node);
  return [...syms].sort();
}
