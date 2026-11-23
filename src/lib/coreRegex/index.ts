/**
 * The practical regex — but only the part every flavor agrees on.
 *
 * The automata engine's regex (`../automata/regexParse.ts`) is the regex of the
 * THEORY: union, concatenation, star. The regex people type into a search box
 * has more: `[abc]`, `.`, `+`, `{2,3}`, anchors. Those extras come in flavors
 * (POSIX, JavaScript, Python, Java, PCRE, Go…), and the flavors disagree at the
 * edges — `\d`, `\b`, lookaround, backreferences, lazy quantifiers, named
 * groups. They AGREE on a core:
 *
 *     literals   .   [abc]   [a-z]   [^abc]   *  +  ?   {n} {n,} {n,m}   |   ( )   ^  $
 *     and  \  before a special character, to mean that character itself
 *
 * `checkCore` accepts exactly that core and refuses everything else with a
 * message naming what was used and why it is not here. Because of that, a lesson
 * built on it can honestly say "regular expression" with no qualifier.
 *
 * It also reports WHICH special symbols a pattern used (`symbols`). The pattern
 * golf game is built on that: each puzzle teaches the one symbol its shortest
 * solution needs, and a test proves every solution uses only symbols the learner
 * has met. `^` is reported twice over, on purpose — `^` the anchor (start of
 * the word) and `[^` the negation (none of these) are two different symbols that
 * happen to share a key.
 *
 * Matching itself is delegated to the host's `RegExp`, but only after the check
 * has passed: on this core, every flavor answers "does this word contain a
 * match?" the same way, so the answer is not JavaScript's opinion.
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

export type CoreCheck =
  | {
      ok: true;
      /** The special symbols the pattern uses. */
      symbols: Set<CoreSymbol>;
      /** Compiled for matching. Safe to use: the source passed the core check. */
      regex: RegExp;
    }
  | {
      ok: false;
      /** Specific and actionable: what is wrong, and what to write instead. */
      message: string;
      /** Index in the source where the problem is. */
      at: number;
    };

/** Characters that mean something outside brackets. */
const SPECIAL = new Set(['.', '[', ']', '(', ')', '*', '+', '?', '{', '}', '|', '^', '$', '\\']);
/** Characters that may follow a backslash inside or outside brackets. */
const ESCAPABLE = new Set([...SPECIAL, '-', '/']);

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

class CoreError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
  }
}

/**
 * Check that `src` is a pattern in the core every flavor shares.
 *
 * Grammar (recursive descent, so errors point at the exact place):
 *
 *     alt    := seq ('|' seq)*            no empty side: POSIX does not allow one
 *     seq    := piece+
 *     piece  := atom quant?               one quantifier only: `a*?` is lazy, `a*+` possessive
 *     atom   := literal | '\' special | '.' | class | '(' alt ')' | '^' | '$'
 *     class  := '[' '^'? item+ ']'        item := char | char '-' char
 *     quant  := '*' | '+' | '?' | '{' n (',' m?)? '}'
 */
export function checkCore(src: string): CoreCheck {
  const symbols = new Set<CoreSymbol>();
  let i = 0;

  const peek = () => src[i];
  const fail = (message: string, at = i): never => {
    throw new CoreError(message, at);
  };

  function alt(): void {
    seq();
    while (peek() === '|') {
      symbols.add('|');
      i++;
      seq();
    }
  }

  function seq(): void {
    const start = i;
    while (i < src.length && peek() !== '|' && peek() !== ')') piece();
    if (i === start) {
      fail(
        src.length === 0
          ? 'Write a pattern first.'
          : 'One side of | (or the inside of a group) is empty. Not every flavor allows that: put something there.',
      );
    }
  }

  function piece(): void {
    const isAnchor = peek() === '^' || peek() === '$';
    atom();
    if (i < src.length && '*+?{'.includes(peek())) {
      if (isAnchor) fail(`There is nothing to repeat: ${src[i - 1]} is a position, not a character.`);
      quant();
      if (i < src.length && '*+?{'.includes(peek())) {
        const two = src.slice(i - 1, i + 1);
        fail(
          two.endsWith('?') || two.endsWith('+')
            ? `"${two}" is a lazy or possessive quantifier, which only some flavors have. Use one repeat symbol per piece.`
            : 'Two repeat symbols in a row. Group the piece with ( ) if you mean to repeat a repetition.',
        );
      }
    }
  }

  function atom(): void {
    const c = peek();
    if (c === '(') {
      if (src[i + 1] === '?') {
        fail('(?…) groups (lookaround, non-capturing and named groups) are flavor-specific. Use a plain ( ).');
      }
      symbols.add('()');
      i++;
      alt();
      if (peek() !== ')') fail('This ( is never closed. Add a ).');
      i++;
      return;
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
      return;
    }
    if (c === '^' || c === '$') {
      symbols.add(c);
      i++;
      return;
    }
    if (c === '\\') return escape();
    i++; // a literal
  }

  function escape(): void {
    const next = src[i + 1];
    if (next === undefined) fail('A \\ at the very end escapes nothing.');
    if (ESCAPABLE.has(next)) {
      symbols.add('\\');
      i += 2;
      return;
    }
    if (/[0-9]/.test(next)) {
      fail(
        `\\${next} is a backreference ("the same text a group matched"). It is flavor-specific, and it is not even regular: (a*)b\\1 describes a language no finite machine can recognise.`,
      );
    }
    fail(SHORTHANDS[next] ?? `\\${next} means different things in different flavors. Write the character itself.`);
  }

  function charClass(): void {
    const open = i;
    i++; // [
    if (peek() === '^') {
      symbols.add('[^]');
      i++;
    } else {
      symbols.add('[]');
    }
    let items = 0;
    while (i < src.length && peek() !== ']') {
      const lo = classChar();
      if (peek() === '-' && src[i + 1] !== undefined && src[i + 1] !== ']') {
        const dash = i;
        i++;
        const hi = classChar();
        if (lo > hi) fail(`The range ${lo}-${hi} runs backwards. Write ${hi}-${lo}.`, dash);
        symbols.add('[a-z]');
      }
      items++;
    }
    if (peek() !== ']') fail('This [ is never closed. Add a ].', open);
    if (items === 0) fail('Empty brackets match nothing at all. Put at least one character inside.', open);
    i++; // ]
  }

  /** One character inside brackets, escapes resolved. */
  function classChar(): string {
    const c = peek();
    if (c === '[') fail('A [ inside brackets is flavor-specific ([:alpha:] and friends). Write \\[ for a real [.');
    if (c === '\\') {
      const next = src[i + 1];
      if (next === undefined) fail('A \\ at the very end escapes nothing.');
      if (!ESCAPABLE.has(next)) fail(SHORTHANDS[next] ?? `\\${next} is flavor-specific inside brackets.`);
      symbols.add('\\');
      i += 2;
      return next;
    }
    i++;
    return c;
  }

  function quant(): void {
    const c = peek();
    if (c !== '{') {
      symbols.add(c as CoreSymbol);
      i++;
      return;
    }
    const open = i;
    const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
    if (!m) fail('A count is written {3}, {2,4} or {2,}. Write \\{ for a real {.', open);
    const lo = Number(m![1]);
    const hi = m![3] ? Number(m![3]) : undefined;
    if (hi !== undefined && hi < lo) fail(`The count {${lo},${hi}} runs backwards.`, open);
    symbols.add('{}');
    i += m![0].length;
  }

  try {
    alt();
    if (i < src.length) fail('This ) closes nothing. Remove it, or add the ( it belongs to.');
  } catch (e) {
    if (e instanceof CoreError) return { ok: false, message: e.message, at: e.at };
    throw e;
  }
  return { ok: true, symbols, regex: new RegExp(src) };
}

/**
 * Where a pattern first matches inside a word, for highlighting.
 *
 * `null` when it does not match anywhere. A zero-length match (the pattern `a*`
 * finds "nothing" at position 0 of every word) is a real match with `length 0` —
 * and worth showing, because it is why `a*` alone matches everything.
 */
export function firstMatch(regex: RegExp, word: string): { index: number; length: number } | null {
  const m = regex.exec(word);
  return m ? { index: m.index, length: m[0].length } : null;
}
