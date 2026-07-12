/**
 * Tests for the regex tokenizer, parser, renderer and simplifier.
 *
 * The centrepiece is `oracleMatches`: a naive, deliberately stupid AST matcher
 * that returns the set of possible remainders after matching a node against a
 * string. It is an *independent oracle* — it shares no code with the simplifier
 * (and none with the automata engine, on purpose: checking a rewriter against a
 * compiler that might share its bugs proves nothing). Every simplification is
 * validated by comparing the accepted set of the original and the simplified
 * regex over every string up to a bounded length.
 *
 * The other property worth its weight: `renderRegex` must round-trip through
 * `parseRegex` *structurally*, and every parenthesis it emits must be
 * load-bearing. Both are checked exhaustively over a generated AST corpus.
 */

import { describe, expect, it } from 'vitest';
import type { RegexNode } from './types';
import {
  parseRegex,
  regexAlphabet,
  regexSize,
  renderRegex,
  simplifyRegex,
} from './regexParse';

// ---------------------------------------------------------------------------
// The independent oracle
// ---------------------------------------------------------------------------

/**
 * Every remainder of `s` reachable by matching a prefix of it against `n`.
 * `n` matches `s` exactly when '' is among them.
 */
function rests(n: RegexNode, s: string): Set<string> {
  switch (n.kind) {
    case 'empty':
      return new Set();
    case 'epsilon':
      return new Set([s]);
    case 'literal':
      return s.startsWith(n.sym) ? new Set([s.slice(n.sym.length)]) : new Set();
    case 'concat': {
      const out = new Set<string>();
      for (const mid of rests(n.left, s)) for (const end of rests(n.right, mid)) out.add(end);
      return out;
    }
    case 'union':
      return new Set([...rests(n.left, s), ...rests(n.right, s)]);
    case 'optional':
      return new Set([s, ...rests(n.inner, s)]);
    case 'plus': {
      const out = new Set<string>();
      for (const mid of rests(n.inner, s)) {
        out.add(mid);
        // Recurse only when the body actually consumed something. A body that
        // matched ε leaves the remainder at `s`, which is already in `out`, and
        // iterating it again can only reproduce this very computation — so the
        // guard loses no remainders and makes `(a?)*` terminate.
        if (mid.length < s.length) for (const end of rests(n, mid)) out.add(end);
      }
      return out;
    }
    case 'star':
      return new Set([s, ...rests({ kind: 'plus', inner: n.inner }, s)]);
  }
}

const oracleMatches = (n: RegexNode, s: string): boolean => rests(n, s).has('');

/** Literals of a node — computed here, not imported, so the oracle stays independent. */
function oracleLiterals(n: RegexNode): string[] {
  switch (n.kind) {
    case 'literal':
      return [n.sym];
    case 'star':
    case 'plus':
    case 'optional':
      return oracleLiterals(n.inner);
    case 'concat':
    case 'union':
      return [...oracleLiterals(n.left), ...oracleLiterals(n.right)];
    default:
      return [];
  }
}

/** Every string over `alphabet` of length ≤ maxLen, shortest first. */
function allStrings(alphabet: string[], maxLen: number): string[] {
  let level = [''];
  const out = [''];
  for (let len = 1; len <= maxLen; len++) {
    level = level.flatMap((s) => alphabet.map((ch) => s + ch));
    out.push(...level);
  }
  return out;
}

/** The whole point: same language, over a bounded but exhaustive probe set. */
function expectSameLanguage(a: RegexNode, b: RegexNode, maxLen: number, label: string): void {
  const alphabet = [...new Set([...oracleLiterals(a), ...oracleLiterals(b)])].sort();
  // A regex with no literals still has to agree about ε and about foreign symbols.
  const probe = alphabet.length > 0 ? alphabet : ['a'];
  for (const s of allStrings(probe, maxLen)) {
    expect(
      oracleMatches(b, s),
      `${label}: '${renderRegex(a)}' and '${renderRegex(b)}' disagree on '${s || 'ε'}'`,
    ).toBe(oracleMatches(a, s));
  }
}

// ---------------------------------------------------------------------------
// AST builders + a generated corpus
// ---------------------------------------------------------------------------

const lit = (sym: string): RegexNode => ({ kind: 'literal', sym });
const eps: RegexNode = { kind: 'epsilon' };
const nul: RegexNode = { kind: 'empty' };
const cat = (left: RegexNode, right: RegexNode): RegexNode => ({ kind: 'concat', left, right });
const alt = (left: RegexNode, right: RegexNode): RegexNode => ({ kind: 'union', left, right });
const star = (inner: RegexNode): RegexNode => ({ kind: 'star', inner });
const plus = (inner: RegexNode): RegexNode => ({ kind: 'plus', inner });
const opt = (inner: RegexNode): RegexNode => ({ kind: 'optional', inner });

const parsed = (src: string): RegexNode => {
  const r = parseRegex(src);
  if (!r.ok) throw new Error(`fixture '${src}' failed to parse: ${r.message}`);
  return r.node;
};

const grow = (pool: RegexNode[]): RegexNode[] => [
  ...pool.flatMap((n) => [star(n), plus(n), opt(n)]),
  ...pool.flatMap((l) => pool.flatMap((r) => [cat(l, r), alt(l, r)])),
];

const LEAVES: RegexNode[] = [lit('a'), lit('b'), eps, nul];
const DEPTH1 = [...LEAVES, ...grow(LEAVES)];
/** ~4.8k ASTs: every shape of depth ≤ 2 over {a, b, ε, ∅}. */
const CORPUS = [...DEPTH1, ...grow(DEPTH1)];

// ---------------------------------------------------------------------------

describe('parseRegex — atoms and the empty source', () => {
  it('parses an empty source as ε (a blank answer is a wrong answer, not a syntax error)', () => {
    expect(parsed('')).toEqual(eps);
  });

  it('ignores whitespace, so a whitespace-only source is also ε', () => {
    expect(parsed('   \n\t ')).toEqual(eps);
    expect(parsed(' a  b ')).toEqual(cat(lit('a'), lit('b')));
  });

  it('parses the two constants', () => {
    expect(parsed('ε')).toEqual(eps);
    expect(parsed('∅')).toEqual(nul);
  });

  it("treats 'E' and 'e' as ordinary literals — only 'ε' is epsilon", () => {
    expect(parsed('E')).toEqual(lit('E'));
    expect(parsed('e')).toEqual(lit('e'));
  });

  it('treats any non-metacharacter as a literal, including astral glyphs', () => {
    expect(parsed('🐈|🐕')).toEqual(alt(lit('🐈'), lit('🐕')));
    expect(regexAlphabet(parsed('🐈🐕*'))).toEqual(['🐈', '🐕']);
  });
});

describe('parseRegex — precedence and associativity', () => {
  it('binds postfix tighter than concat, and concat tighter than union', () => {
    expect(parsed('ab*')).toEqual(cat(lit('a'), star(lit('b'))));
    expect(parsed('ab|c')).toEqual(alt(cat(lit('a'), lit('b')), lit('c')));
    expect(parsed('(ab)*')).toEqual(star(cat(lit('a'), lit('b'))));
    expect(parsed('a(b|c)')).toEqual(cat(lit('a'), alt(lit('b'), lit('c'))));
  });

  it('is left-associative in both binary operators', () => {
    expect(parsed('abc')).toEqual(cat(cat(lit('a'), lit('b')), lit('c')));
    expect(parsed('a|b|c')).toEqual(alt(alt(lit('a'), lit('b')), lit('c')));
  });

  it('stacks postfix operators left to right', () => {
    expect(parsed('a**')).toEqual(star(star(lit('a'))));
    expect(parsed('a*+')).toEqual(plus(star(lit('a'))));
    expect(parsed('a?*')).toEqual(star(opt(lit('a'))));
  });

  it('drops redundant groups — the AST has no notion of a parenthesis', () => {
    expect(parsed('((a))')).toEqual(lit('a'));
    expect(parsed('(a)(b)')).toEqual(parsed('ab'));
  });
});

describe('parseRegex — errors carry a message and an offset', () => {
  const err = (src: string) => {
    const r = parseRegex(src);
    if (r.ok) throw new Error(`expected '${src}' to fail, but it parsed`);
    return r;
  };

  it('rejects a postfix operator with nothing to repeat', () => {
    expect(err('*ab')).toMatchObject({ at: 0 });
    expect(err('*ab').message).toMatch(/nothing before '\*'/i);
    expect(err('a|*b')).toMatchObject({ at: 2 });
    expect(err('(+a)')).toMatchObject({ at: 1 });
    expect(err('?')).toMatchObject({ at: 0 });
  });

  it('rejects unbalanced parentheses, pointing at the bracket that is wrong', () => {
    expect(err('(a')).toMatchObject({ at: 0 });
    expect(err('(a').message).toMatch(/never closed/i);
    expect(err('((a)')).toMatchObject({ at: 0 });
    expect(err('a(b|c')).toMatchObject({ at: 1 });
    expect(err('(')).toMatchObject({ at: 0 });
    expect(err('a)')).toMatchObject({ at: 1 });
    expect(err('a)').message).toMatch(/unmatched/i);
    expect(err(')')).toMatchObject({ at: 0 });
    expect(err('(a))')).toMatchObject({ at: 3 });
  });

  it('rejects an empty alternation branch, pointing at the hole', () => {
    expect(err('a||b')).toMatchObject({ at: 2 });
    expect(err('a||b').message).toMatch(/nothing after the '\|'/i);
    expect(err('|a')).toMatchObject({ at: 0 });
    expect(err('|a').message).toMatch(/nothing before the '\|'/i);
    expect(err('(|a)')).toMatchObject({ at: 1 });
    expect(err('(|a)').message).toMatch(/nothing before the '\|'/i);
    expect(err('(a|)')).toMatchObject({ at: 3 });
  });

  it("rejects a dangling '|' at the end of input", () => {
    expect(err('a|')).toMatchObject({ at: 2 });
    expect(err('a|').message).toMatch(/nothing after the '\|'/i);
  });

  it("rejects an empty group and points at 'ε' as the fix", () => {
    expect(err('()')).toMatchObject({ at: 1 });
    expect(err('()').message).toMatch(/ε/);
    expect(err('a()b')).toMatchObject({ at: 2 });
  });

  it('reports offsets in code units, so a caret lands correctly after an emoji', () => {
    // '🐈' occupies two code units; the stray ')' is therefore at index 2.
    expect(err('🐈)')).toMatchObject({ at: 2 });
  });
});

describe('renderRegex — minimal parentheses', () => {
  it('parenthesises only what precedence requires', () => {
    expect(renderRegex(cat(lit('a'), star(lit('b'))))).toBe('ab*');
    expect(renderRegex(star(cat(lit('a'), lit('b'))))).toBe('(ab)*');
    expect(renderRegex(cat(alt(lit('a'), lit('b')), lit('c')))).toBe('(a|b)c');
    expect(renderRegex(alt(cat(lit('a'), lit('b')), lit('c')))).toBe('ab|c');
    expect(renderRegex(star(star(lit('a'))))).toBe('a**');
    expect(renderRegex(opt(alt(lit('a'), lit('b'))))).toBe('(a|b)?');
    expect(renderRegex(nul)).toBe('∅');
    expect(renderRegex(eps)).toBe('ε');
  });

  it('parenthesises a right-nested spine, because the parser associates left', () => {
    expect(renderRegex(alt(alt(lit('a'), lit('b')), lit('c')))).toBe('a|b|c');
    expect(renderRegex(alt(lit('a'), alt(lit('b'), lit('c'))))).toBe('a|(b|c)');
    expect(renderRegex(cat(cat(lit('a'), lit('b')), lit('c')))).toBe('abc');
    expect(renderRegex(cat(lit('a'), cat(lit('b'), lit('c'))))).toBe('a(bc)');
  });

  it('round-trips every AST in the corpus, structurally', () => {
    for (const node of CORPUS) {
      const src = renderRegex(node);
      const back = parseRegex(src);
      expect(back.ok, `'${src}' failed to re-parse`).toBe(true);
      if (back.ok) expect(back.node, `'${src}' re-parsed to a different tree`).toEqual(node);
    }
  });

  it('emits no parenthesis that is not load-bearing', () => {
    // Minimality, checked rather than asserted: delete any single matched pair
    // and the string must stop meaning what it meant.
    for (const node of CORPUS) {
      const src = renderRegex(node);
      for (let i = 0; i < src.length; i++) {
        if (src[i] !== '(') continue;
        let depth = 0;
        let close = -1;
        for (let j = i; j < src.length; j++) {
          if (src[j] === '(') depth++;
          else if (src[j] === ')' && --depth === 0) {
            close = j;
            break;
          }
        }
        expect(close, `unbalanced render: '${src}'`).toBeGreaterThan(i);
        const stripped = src.slice(0, i) + src.slice(i + 1, close) + src.slice(close + 1);
        const reparsed = parseRegex(stripped);
        expect(
          reparsed.ok && JSON.stringify(reparsed.node) === JSON.stringify(node),
          `the parens in '${src}' at ${i}..${close} are redundant`,
        ).toBe(false);
      }
    }
  });
});

describe('simplifyRegex — the mandated identities', () => {
  const simplifiedSrc = (src: string): string => renderRegex(simplifyRegex(parsed(src)));

  it.each([
    ['a|a', 'a'],
    ['a|∅', 'a'],
    ['∅|a', 'a'],
    ['aε', 'a'],
    ['εa', 'a'],
    ['a∅', '∅'],
    ['∅a', '∅'],
    ['∅*', 'ε'],
    ['ε*', 'ε'],
    ['(a*)*', 'a*'],
    ['(a*)+', 'a*'],
    ['(a+)*', 'a*'],
    ['(a|ε)*', 'a*'],
    ['(ε|a)*', 'a*'],
    ['a*a*', 'a*'],
    ['a|ε', 'a?'],
    ['(a?)*', 'a*'],
    ['aa*', 'a+'],
    ['a*a', 'a+'],
  ])('%s -> %s', (src, want) => {
    expect(simplifiedSrc(src)).toBe(want);
  });

  it('completes the postfix-of-postfix table', () => {
    expect(simplifiedSrc('(a+)+')).toBe('a+');
    expect(simplifiedSrc('(a?)+')).toBe('a*');
    expect(simplifiedSrc('(a*)?')).toBe('a*');
    expect(simplifiedSrc('(a+)?')).toBe('a*');
    expect(simplifiedSrc('(a?)?')).toBe('a?');
    expect(simplifiedSrc('∅+')).toBe('∅');
    expect(simplifiedSrc('∅?')).toBe('ε');
    expect(simplifiedSrc('ε+')).toBe('ε');
    expect(simplifiedSrc('ε?')).toBe('ε');
  });

  it('merges across associativity, not just on the literal shape of the node', () => {
    // a·(a*·b): no sub-node of this tree is literally `r·r*`.
    expect(renderRegex(simplifyRegex(cat(lit('a'), cat(star(lit('a')), lit('b')))))).toBe('a+b');
    expect(simplifiedSrc('aa*a*')).toBe('a+');
    expect(simplifiedSrc('a|b|a')).toBe('a|b');
    expect(simplifiedSrc('a|b|ε')).toBe('(a|b)?');
  });

  it('drops a redundant ε alternative rather than wrapping it in ?', () => {
    expect(simplifiedSrc('ε|a*')).toBe('a*');
    expect(simplifiedSrc('a*|ε')).toBe('a*');
    expect(simplifiedSrc('ε|a|b*')).toBe('a|b*');
    expect(simplifiedSrc('a+|ε')).toBe('a*');
  });

  it('merges same-base repetition families', () => {
    expect(simplifiedSrc('a|a*')).toBe('a*');
    expect(simplifiedSrc('a?|a+')).toBe('a*');
    expect(simplifiedSrc('a|a?')).toBe('a?');
    expect(simplifiedSrc('a|a+')).toBe('a+');
    expect(simplifiedSrc('(ab)|(ab)*')).toBe('(ab)*');
    expect(simplifiedSrc('a+a*')).toBe('a+');
    expect(simplifiedSrc('a*a+')).toBe('a+');
    expect(simplifiedSrc('a?a*')).toBe('a*');
  });

  it('leaves alone what is NOT an identity', () => {
    expect(simplifiedSrc('aa')).toBe('aa'); // NOT a
    expect(simplifiedSrc('a+a+')).toBe('a+a+'); // a{2,}, NOT a+
    expect(simplifiedSrc('a?a?')).toBe('a?a?'); // ≤2 a's, NOT a?
    expect(simplifiedSrc('a+a')).toBe('a+a'); // a{2,}
    expect(simplifiedSrc('a*b*')).toBe('a*b*'); // different bases
    expect(simplifiedSrc('a|b')).toBe('a|b');
    expect(simplifiedSrc('ba')).toBe('ba'); // no commutativity of concat
    expect(simplifiedSrc('b|a')).toBe('b|a'); // alternatives keep the author's order
    expect(simplifiedSrc('∅')).toBe('∅');
    expect(simplifiedSrc('ε')).toBe('ε');
    expect(simplifiedSrc('(a|b)*')).toBe('(a|b)*');
  });
});

describe('simplifyRegex — soundness against the independent oracle', () => {
  const HAND_WRITTEN = [
    'a',
    'ε',
    '∅',
    'a|ε',
    'ε|a',
    'a|∅',
    '∅|a',
    'aε',
    'εa',
    'a∅b',
    '∅*',
    'ε*',
    '(a*)*',
    '(a|ε)*',
    '(a?)*',
    'aa*',
    'a*a',
    'a*a*',
    'a+a*',
    'a?a?',
    'a+a+',
    'aa',
    '(a|b)*',
    '(a|b)*abb',
    'a(a|b)*b',
    '(ab)*|ε',
    'a*b*a*',
    '(a|ε)(b|ε)',
    '(a*b*)*',
    '(a|b)*|ε',
    'ab|ab',
    'a(b|b)',
    '(a|a)(b|b)*',
    'aa*|ε',
    '(a*)+b',
    'a?|a+',
    '∅|∅',
    'ε|ε',
    '(a∅)|b',
    'a(bc|bd)',
    '((a|b)|c)*',
    'a|(b|c)',
    '(a|ε)*b(a|ε)*',
    'a**b++c??',
  ];

  const MAX_LEN = 6;

  it.each(HAND_WRITTEN)('%s simplifies to the same language', (src) => {
    const node = parsed(src);
    expectSameLanguage(node, simplifyRegex(node), MAX_LEN, src);
  });

  it('never invents a symbol that was not in the original', () => {
    for (const src of HAND_WRITTEN) {
      const node = parsed(src);
      const before = new Set(regexAlphabet(node));
      for (const sym of regexAlphabet(simplifyRegex(node))) {
        expect(before.has(sym), `'${src}' grew the symbol '${sym}'`).toBe(true);
      }
    }
  });

  it('preserves the language of every AST in the corpus', () => {
    // ~4.8k trees × every string up to length 4 over {a,b}. Length 4 is enough to
    // separate every distinction these shapes can express and keeps the suite fast.
    for (const node of CORPUS) {
      expectSameLanguage(node, simplifyRegex(node), 4, 'corpus');
    }
  });

  it('never grows a regex, and is a fixpoint', () => {
    for (const node of CORPUS) {
      const once = simplifyRegex(node);
      expect(regexSize(once), `'${renderRegex(node)}' grew`).toBeLessThanOrEqual(regexSize(node));
      expect(
        JSON.stringify(simplifyRegex(once)),
        `'${renderRegex(node)}' is not a fixpoint`,
      ).toBe(JSON.stringify(once));
    }
  });

  it('is deterministic: the same input yields byte-identical output', () => {
    for (const src of HAND_WRITTEN) {
      const a = renderRegex(simplifyRegex(parsed(src)));
      const b = renderRegex(simplifyRegex(parsed(src)));
      expect(a).toBe(b);
    }
  });
});

describe('regexSize', () => {
  it('counts AST nodes, not characters', () => {
    expect(regexSize(parsed('a'))).toBe(1);
    expect(regexSize(parsed('ε'))).toBe(1);
    expect(regexSize(parsed('∅'))).toBe(1);
    expect(regexSize(parsed('ab'))).toBe(3);
    expect(regexSize(parsed('a|b'))).toBe(3);
    expect(regexSize(parsed('a*'))).toBe(2);
    expect(regexSize(parsed('(ab)*'))).toBe(4);
    expect(regexSize(parsed('(a|b)*abb'))).toBe(10);
  });

  it('is blind to redundant parentheses (they must not cost a learner points)', () => {
    expect(regexSize(parsed('((a))'))).toBe(regexSize(parsed('a')));
    expect(regexSize(parsed('(a)(b)'))).toBe(regexSize(parsed('ab')));
  });
});

describe('regexAlphabet', () => {
  it('is sorted, unique, and excludes ε and ∅', () => {
    expect(regexAlphabet(parsed('b|a|b'))).toEqual(['a', 'b']);
    expect(regexAlphabet(parsed('(a|ε)(b|∅)c*'))).toEqual(['a', 'b', 'c']);
    expect(regexAlphabet(parsed('ε|∅'))).toEqual([]);
    expect(regexAlphabet(parsed(''))).toEqual([]);
    expect(regexAlphabet(parsed('1|0'))).toEqual(['0', '1']);
  });
});
