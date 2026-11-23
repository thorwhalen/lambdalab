/**
 * The practical regex — but only the part every flavor agrees on.
 *
 * The automata engine's regex (`../automata/regexParse.ts`) is the regex of the
 * THEORY: union, concatenation, star. The regex people type into a search box
 * has more: `[abc]`, `.`, `+`, `{2,3}`, anchors. Those extras come in flavors
 * (POSIX, JavaScript, Python, Java, PCRE, Go…), and the flavors disagree at the
 * edges — `\d`, `\b`, lookaround, backreferences, lazy quantifiers, named
 * groups, what a backslash means inside brackets. They AGREE on a core:
 *
 *     literals   .   [abc]   [a-z]   [^abc]   *  +  ?   {n} {n,} {n,m}   |   ( )   ^  $
 *     and  \  before a special character (outside brackets), to mean that character
 *
 * on printable ASCII, with counts up to 255 (POSIX's floor). `checkCore` accepts
 * exactly that and refuses everything else with a message naming what was used
 * and why it is not here. Because of that, a lesson built on it can honestly say
 * "regular expression" with no qualifier.
 *
 * It also reports WHICH special symbols a pattern used (`symbols`). The pattern
 * golf game is built on that: each puzzle teaches the one symbol its shortest
 * solution needs. `^` is reported twice over, on purpose — `^` the anchor (start
 * of the word) and `[^` the negation (none of these) are two different symbols
 * that happen to share a key.
 *
 * MATCHING IS OURS, NOT THE HOST'S. The pattern is parsed to a tree and run as a
 * Thompson NFA — the construction this lesson teaches — simulated a set of
 * states at a time. Two reasons, both learned the hard way:
 *   - JavaScript's `RegExp` backtracks, and `((a|a)*)*z` froze the tab for 17
 *     seconds on one word. A set-of-states simulation is linear in the word, for
 *     every pattern (the Russ Cox essay on the lesson's shelf is about exactly this).
 *   - Which part of a word "the match" is differs by flavor: JavaScript takes the
 *     leftmost alternative (`a|ab` on "ab" finds "a"), POSIX the leftmost-LONGEST
 *     ("ab"). Whether a word matches is the same either way; what we highlight is
 *     POSIX's, the longest match at the leftmost place, which is what `grep -o` shows.
 *
 * And nothing here leaves the regular languages. Every core pattern is a
 * shorthand for a theory regex (`[abc]` is `(a|b|c)`, `x+` is `xx*`, `x{2,3}` is
 * `xxx?`), and a search for `r` anywhere in a word is the theory pattern `Σ*rΣ*`.
 * The one popular extra that WOULD leave them — the backreference, `(a*)b\1` — is
 * exactly what this module refuses, and the lesson's level 8 explains why.
 */

/** A special symbol of the core. Letters and escaped characters are not symbols. */
export type CoreSymbol =
  | '.'
  | '|'
  | '[]'
  | '[a-z]'
  | '[^]'
  | '^'
  | '$'
  | '?'
  | '+'
  | '*'
  | '()'
  | '{}'
  | '\\';

/** Every core symbol, with the one-line meaning the UI shows for it. */
export const CORE_SYMBOLS: ReadonlyArray<{ symbol: CoreSymbol; gloss: string }> = [
  { symbol: '|', gloss: 'or: either side' },
  { symbol: '.', gloss: 'any one character' },
  { symbol: '[]', gloss: 'one character from the list, like [aeiou]' },
  { symbol: '^', gloss: 'outside brackets: the start of the word' },
  { symbol: '$', gloss: 'the end of the word' },
  { symbol: '?', gloss: 'the thing before is optional (zero or one)' },
  { symbol: '+', gloss: 'one or more of the thing before' },
  { symbol: '*', gloss: 'zero or more of the thing before' },
  { symbol: '()', gloss: 'group a piece, so a symbol after it applies to the whole group' },
  { symbol: '{}', gloss: 'an exact count: x{3}, x{2,4}, x{2,}' },
  { symbol: '[a-z]', gloss: 'a range inside brackets: [a-e] is [abcde]' },
  { symbol: '[^]', gloss: 'inside brackets, first: NONE of these. A different ^!' },
  { symbol: '\\', gloss: 'escape: \\. means a real dot, not "any character"' },
];

/** Where a match was found in a word: its start, and how many characters it covers. */
export interface Span {
  index: number;
  length: number;
}

export type CoreCheck =
  | {
      ok: true;
      /** The special symbols the pattern uses. */
      symbols: Set<CoreSymbol>;
      /** The leftmost-longest match in a word, or null. Linear time, whatever the pattern. */
      find: (word: string) => Span | null;
      /** Does the pattern match anywhere in the word? */
      test: (word: string) => boolean;
    }
  | {
      ok: false;
      /** Specific and actionable: what is wrong, and what to write instead. */
      message: string;
      /** Index in the source where the problem is. */
      at: number;
      /**
       * The pattern is unfinished rather than wrong: something is still open at the
       * end ("[ab", "(a", a trailing "\\"). A UI may show this quietly while the
       * learner is still typing.
       */
      incomplete: boolean;
    };

/** The largest count every flavor accepts (POSIX's RE_DUP_MAX floor). */
export const MAX_COUNT = 255;
/** A pattern whose machine has more states than this is refused as too big to run. */
const MAX_STATES = 1000;
/** Deeper nesting than this is refused rather than risking the parser's stack. */
const MAX_DEPTH = 30;

/** Characters that mean something outside brackets. */
const SPECIAL = new Set(['.', '[', ']', '(', ')', '*', '+', '?', '{', '}', '|', '^', '$', '\\']);
/** Characters that may follow a backslash outside brackets: only the special ones (POSIX leaves \\- and \\/ undefined). */
const ESCAPABLE = SPECIAL;

/** Why a backslash-letter is refused, by letter. Unlisted letters get a generic message. */
const SHORTHANDS: Record<string, string> = {
  d: '\\d (a digit) is a shorthand that some flavors have and others do not. Write [0-9] instead.',
  D: '\\D (not a digit) is flavor-specific. Write [^0-9] instead.',
  w: '\\w (a word character) means different things in different flavors. Write [a-z] instead.',
  W: '\\W is flavor-specific. Write [^a-z] instead.',
  s: '\\s (a space) is flavor-specific, and these words have no spaces anyway.',
  S: '\\S is flavor-specific.',
  b: '\\b (a word boundary) is flavor-specific. Here every string is one word: use ^ and $.',
  B: '\\B is flavor-specific.',
};

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

type Node =
  | { t: 'char'; test: (c: string) => boolean }
  | { t: 'bol' }
  | { t: 'eol' }
  | { t: 'cat'; items: Node[] }
  | { t: 'alt'; options: Node[] }
  | { t: 'rep'; node: Node; min: number; max: number };

class CoreError extends Error {
  constructor(
    message: string,
    readonly at: number,
    readonly incomplete = false,
  ) {
    super(message);
  }
}

/**
 * Parse `src` as a pattern of the core every flavor shares.
 *
 *     alt    := seq ('|' seq)*            no empty side: POSIX does not allow one
 *     seq    := piece+
 *     piece  := atom quant?               one quantifier only: `a*?` is lazy, `a*+` possessive
 *     atom   := literal | '\' special | '.' | class | '(' alt ')' | '^' | '$'
 *     class  := '[' '^'? item+ ']'        item := char | char '-' char; no backslash inside
 *     quant  := '*' | '+' | '?' | '{' n (',' m?)? '}'     n, m <= 255
 */
function parse(src: string): { node: Node; symbols: Set<CoreSymbol> } {
  const symbols = new Set<CoreSymbol>();
  let i = 0;
  let depth = 0;

  const peek = () => src[i];
  const fail = (message: string, at = i, incomplete = false): never => {
    throw new CoreError(message, at, incomplete);
  };

  function alt(): Node {
    const options = [seq()];
    while (peek() === '|') {
      symbols.add('|');
      i++;
      options.push(seq());
    }
    return options.length === 1 ? options[0]! : { t: 'alt', options };
  }

  function seq(): Node {
    const start = i;
    const items: Node[] = [];
    while (i < src.length && peek() !== '|' && !(peek() === ')' && depth > 0)) items.push(piece());
    if (i === start) {
      if (src.length === 0) fail('Write a pattern first.', 0, true);
      if (i === src.length) fail(depth > 0 && src[i - 1] === '(' ? 'This ( is not closed yet. Add a ).' : 'Nothing after this | yet: put something there.', i, true);
      fail('One side of | (or the inside of a group) is empty. Not every flavor allows that: put something there.');
    }
    return items.length === 1 ? items[0]! : { t: 'cat', items };
  }

  function piece(): Node {
    const isAnchor = peek() === '^' || peek() === '$';
    const node = atom();
    if (i < src.length && '*+?{'.includes(peek()!)) {
      if (isAnchor) fail(`There is nothing to repeat: ${src[i - 1]} is a position, not a character.`);
      const rep = quant(node);
      if (i < src.length && '*+?{'.includes(peek()!)) {
        const two = src.slice(i - 1, i + 1);
        fail(
          two.endsWith('?') || two.endsWith('+')
            ? `"${two}" is a lazy or possessive quantifier, which only some flavors have. Use one repeat symbol per piece.`
            : 'Two repeat symbols in a row. Group the piece with ( ) if you mean to repeat a repetition.',
        );
      }
      return rep;
    }
    return node;
  }

  function atom(): Node {
    const c = peek()!;
    if (c === '(') {
      if (src[i + 1] === '?') {
        fail('(?…) groups (lookaround, non-capturing and named groups) are flavor-specific. Use a plain ( ).');
      }
      symbols.add('()');
      const open = i;
      i++;
      depth++;
      if (depth > MAX_DEPTH) fail(`Groups nested more than ${MAX_DEPTH} deep are too many to run here.`, open);
      const inner = alt();
      depth--;
      if (peek() !== ')') fail('This ( is not closed yet. Add a ).', open, true);
      i++;
      return inner;
    }
    if (c === ')') fail('This ) closes nothing. Remove it, or add the ( it belongs to.');
    if (c === '[') return charClass();
    if (c === ']') fail('This ] closes nothing. Write \\] for a real ].');
    if (c === '*' || c === '+' || c === '?') fail(`There is nothing before this ${c} for it to repeat.`);
    if (c === '{') fail('There is nothing before this { for it to count. Write \\{ for a real {.');
    if (c === '}') fail('This } closes nothing. Write \\} for a real }.');
    if (c === '.') {
      symbols.add('.');
      i++;
      return { t: 'char', test: () => true };
    }
    if (c === '^') {
      symbols.add('^');
      i++;
      return { t: 'bol' };
    }
    if (c === '$') {
      symbols.add('$');
      i++;
      return { t: 'eol' };
    }
    if (c === '\\') return escape();
    literalCheck(c);
    i++;
    return { t: 'char', test: (x) => x === c };
  }

  /** Only printable ASCII: beyond it, flavors split on what "one character" is. */
  function literalCheck(c: string): void {
    const code = c.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) {
      fail(`"${c}" is outside plain ASCII, where flavors disagree on what one character is. Use plain letters, digits and punctuation.`);
    }
  }

  function escape(): Node {
    const next = src[i + 1];
    if (next === undefined) fail('A \\ at the very end escapes nothing yet.', i, true);
    if (ESCAPABLE.has(next!)) {
      symbols.add('\\');
      i += 2;
      return { t: 'char', test: (x) => x === next };
    }
    if (/[0-9]/.test(next!)) {
      fail(
        `\\${next} is a backreference ("the same text a group matched"). It is flavor-specific, and it is not even regular: (a*)b\\1 describes a language no finite machine can recognise.`,
      );
    }
    return fail(SHORTHANDS[next!] ?? `\\${next} means different things in different flavors. Write the character itself.`);
  }

  function charClass(): Node {
    const open = i;
    i++; // [
    let negate = false;
    if (peek() === '^') {
      negate = true;
      symbols.add('[^]');
      i++;
    } else {
      symbols.add('[]');
    }
    const ranges: Array<[string, string]> = [];
    let prevWasRange = false;
    while (i < src.length && peek() !== ']') {
      if (prevWasRange && peek() === '-' && src[i + 1] !== ']' && src[i + 1] !== undefined) {
        fail('A dash right after a range is read differently by different flavors. Put a - first or last.');
      }
      const lo = classChar();
      if (peek() === '-' && src[i + 1] !== undefined && src[i + 1] !== ']') {
        if (prevWasRange) fail('A dash right after a range is read differently by different flavors. Put a - first or last.');
        const dash = i;
        i++;
        if (peek() === '-') fail('A range cannot end in a dash. Put a - first or last in the brackets.');
        const hi = classChar();
        if (lo > hi) fail(`The range ${lo}-${hi} runs backwards. Write ${hi}-${lo}.`, dash);
        symbols.add('[a-z]');
        ranges.push([lo, hi]);
        prevWasRange = true;
      } else {
        ranges.push([lo, lo]);
        prevWasRange = false;
      }
    }
    if (peek() !== ']') fail('This [ is not closed yet. Add a ].', open, true);
    if (ranges.length === 0) fail('Empty brackets match nothing at all. Put at least one character inside.', open);
    i++; // ]
    const inSet = (x: string) => ranges.some(([a, b]) => x >= a && x <= b);
    return { t: 'char', test: negate ? (x) => !inSet(x) : inSet };
  }

  /** One character inside brackets. Backslash and doubled &, |, ~ mean different things per flavor. */
  function classChar(): string {
    const c = peek()!;
    if (c === '[') fail('A [ inside brackets is flavor-specific ([:alpha:] and friends).');
    if (c === '\\') {
      fail('Inside brackets a backslash is a plain character in some flavors and an escape in others. Leave it out: inside [ ], . * + ? $ are already plain.');
    }
    if ((c === '&' || c === '|' || c === '~') && src[i + 1] === c) {
      fail(`"${c}${c}" inside brackets is set arithmetic in some flavors. Write the characters once.`);
    }
    literalCheck(c);
    i++;
    return c;
  }

  function quant(node: Node): Node {
    const c = peek()!;
    if (c !== '{') {
      symbols.add(c as CoreSymbol);
      i++;
      return c === '*'
        ? { t: 'rep', node, min: 0, max: Infinity }
        : c === '+'
          ? { t: 'rep', node, min: 1, max: Infinity }
          : { t: 'rep', node, min: 0, max: 1 };
    }
    const open = i;
    const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
    if (!m) {
      if (/^\{\d*(,\d*)?$/.test(src.slice(i))) fail('This count is not closed yet. Add a }.', open, true);
      fail('A count is written {3}, {2,4} or {2,}. Write \\{ for a real {.', open);
    }
    const lo = Number(m![1]);
    const hi = m![2] === undefined ? lo : m![3] ? Number(m![3]) : Infinity;
    if (lo > MAX_COUNT || (hi !== Infinity && hi > MAX_COUNT)) {
      fail(`Counts above ${MAX_COUNT} are refused by some flavors. Use a smaller count.`, open);
    }
    if (hi < lo) fail(`The count {${lo},${hi}} runs backwards.`, open);
    symbols.add('{}');
    i += m![0].length;
    return { t: 'rep', node, min: lo, max: hi };
  }

  const node = alt();
  if (i < src.length) fail('This ) closes nothing. Remove it, or add the ( it belongs to.');
  return { node, symbols };
}

// ---------------------------------------------------------------------------
// The machine: Thompson's construction, simulated a set of states at a time
// ---------------------------------------------------------------------------

type State =
  | { k: 'char'; test: (c: string) => boolean; out: number }
  | { k: 'split'; a: number; b: number }
  | { k: 'bol'; out: number }
  | { k: 'eol'; out: number }
  | { k: 'match' };

/** Build the NFA; returns its states and start. Counted repeats are unrolled (hence MAX_STATES). */
function compile(root: Node): { states: State[]; start: number } {
  const states: State[] = [];
  const add = (s: State): number => {
    if (states.length >= MAX_STATES) throw new CoreError('This pattern is too big to run here. Use smaller counts.', 0);
    states.push(s);
    return states.length - 1;
  };

  /** Compile `n` so that it continues to `next`; returns its entry state. */
  function build(n: Node, next: number): number {
    switch (n.t) {
      case 'char':
        return add({ k: 'char', test: n.test, out: next });
      case 'bol':
        return add({ k: 'bol', out: next });
      case 'eol':
        return add({ k: 'eol', out: next });
      case 'cat':
        return n.items.reduceRight((after, item) => build(item, after), next);
      case 'alt': {
        const entries = n.options.map((o) => build(o, next));
        return entries.reduceRight((rest, e) => add({ k: 'split', a: e, b: rest }));
      }
      case 'rep': {
        let after = next;
        if (n.max === Infinity) {
          // x* : a loop back to a split.
          const loop = add({ k: 'split', a: -1, b: next });
          const body = build(n.node, loop);
          (states[loop] as { a: number }).a = body;
          after = loop;
        } else {
          for (let k = n.min; k < n.max; k++) {
            const opt = add({ k: 'split', a: -1, b: next });
            // Take this copy and go on to the optional ones after it, or skip to the end.
            (states[opt] as { a: number }).a = build(n.node, after);
            after = opt;
          }
        }
        for (let k = 0; k < n.min; k++) after = build(n.node, after);
        return after;
      }
    }
  }

  const match = add({ k: 'match' });
  const start = build(root, match);
  return { states, start };
}

/**
 * One pass over the word, a set of states at a time (Pike's VM): each live state
 * remembers the earliest position its thread started at. That gives the
 * leftmost-longest match in O(word × states), and `test` stops at the first accept.
 */
function makeRunner(states: State[], start: number): { find: (w: string) => Span | null; test: (w: string) => boolean } {
  const run = (word: string, firstOnly: boolean): Span | null => {
    const n = word.length;
    // state -> earliest start; a state already present keeps its (earlier) start.
    const closure = (set: Map<number, number>, s: number, pos: number, from: number) => {
      if (set.has(s)) return;
      set.set(s, from);
      const st = states[s]!;
      if (st.k === 'split') {
        closure(set, st.a, pos, from);
        closure(set, st.b, pos, from);
      } else if (st.k === 'bol' && pos === 0) closure(set, st.out, pos, from);
      else if (st.k === 'eol' && pos === n) closure(set, st.out, pos, from);
    };
    let threads = new Map<number, number>();
    let best: Span | null = null;
    for (let pos = 0; pos <= n; pos++) {
      if (best === null) closure(threads, start, pos, pos);
      for (const [s, from] of threads) {
        if (states[s]!.k !== 'match') continue;
        if (best === null || from < best.index || (from === best.index && pos - from > best.length)) {
          best = { index: from, length: pos - from };
          if (firstOnly) return best;
        }
      }
      if (best !== null) for (const [s, from] of threads) if (from > best.index) threads.delete(s);
      if (pos === n || (best !== null && threads.size === 0)) break;
      const next = new Map<number, number>();
      // Earliest starts first, so a state reached twice keeps the leftmost thread.
      for (const [s, from] of [...threads].sort((x, y) => x[1] - y[1])) {
        const st = states[s]!;
        if (st.k === 'char' && st.test(word[pos]!)) closure(next, st.out, pos + 1, from);
      }
      threads = next;
    }
    return best;
  };
  return { find: (w) => run(w, false), test: (w) => run(w, true) !== null };
}

/**
 * Check that `src` is a pattern in the core every flavor shares, and if it is,
 * hand back a matcher for it.
 */
export function checkCore(src: string): CoreCheck {
  try {
    const { node, symbols } = parse(src);
    const { states, start } = compile(node);
    const { find, test } = makeRunner(states, start);
    return { ok: true, symbols, find, test };
  } catch (e) {
    if (e instanceof CoreError) return { ok: false, message: e.message, at: e.at, incomplete: e.incomplete };
    throw e;
  }
}
