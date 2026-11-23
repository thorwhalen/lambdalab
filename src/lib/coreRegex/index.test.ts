/**
 * The core-flavor check: accepts the shared core, refuses the rest with a reason,
 * and reports exactly the symbols a pattern used.
 */
import { describe, expect, it } from 'vitest';
import { checkCore, type CoreSymbol } from './index';

const symbolsOf = (src: string): CoreSymbol[] => {
  const r = checkCore(src);
  if (!r.ok) throw new Error(`${src}: ${r.message}`);
  return [...r.symbols].sort();
};

describe('checkCore accepts the core', () => {
  it.each<[string, CoreSymbol[]]>([
    ['cat', []],
    ['cat|dog', ['|']],
    ['c.t', ['.']],
    ['b[aeu]t', ['[]']],
    ['^un', ['^']],
    ['ly$', ['$']],
    ['colou?r', ['?']],
    ['zo+m', ['+']],
    ['^hm*$', ['$', '*', '^']],
    ['^(ha)+$', ['$', '()', '+', '^']],
    ['.{8}', ['.', '{}']],
    ['x{2,}', ['{}']],
    ['x{2,4}', ['{}']],
    ['[0-9]', ['[]', '[a-z]']],
    ['q[^u]', ['[^]']],
    ['^[^aeiou]+$', ['$', '+', '[^]', '^']],
    ['a\\.b', ['\\']],
    ['[a^]', ['[]']], // ^ not first inside brackets is a literal
    ['[-a]', ['[]']], // a leading - is a literal, not a range
    ['[a-]', ['[]']],
  ])('%s uses %j', (src, want) => {
    expect(symbolsOf(src)).toEqual([...want].sort());
  });

  it('keeps the two meanings of ^ apart', () => {
    expect(symbolsOf('^[^a]')).toEqual(['[^]', '^'].sort());
  });
});

describe('checkCore refuses what is not core, and says why', () => {
  it.each<[string, RegExp]>([
    ['', /Write a pattern/],
    ['a|', /Nothing after/],
    ['|a', /empty/],
    ['()', /empty/],
    ['\\d', /\[0-9\]/],
    ['\\w+', /\[a-z\]/],
    ['\\bcat', /\^ and \$/],
    ['(a*)b\\1', /not even regular/],
    ['(?=a)', /flavor-specific/],
    ['(?:ab)', /flavor-specific/],
    ['a*?', /lazy or possessive/],
    ['a++', /lazy or possessive/],
    ['a**', /Two repeat symbols/],
    ['*a', /nothing before/],
    ['^*', /position/],
    ['(ab', /not closed/],
    ['ab)', /closes nothing/],
    ['[ab', /not closed/],
    ['[]', /not closed|Empty/],
    ['[z-a]', /backwards/],
    ['a{3,2}', /backwards/],
    ['a{x}', /count is written/],
    ['{3}', /nothing before/],
    ['[[:alpha:]]', /flavor-specific/],
    ['a\\', /escapes nothing/],
    ['[\\]]', /backslash/],
    ['[a-c-e]', /dash right after a range/],
    ['[a--b]', /cannot end in a dash/],
    ['a{1001}', /above 255/],
    ['[a&&b]', /set arithmetic/],
    ['é', /ASCII/],
    [')', /closes nothing/],
    [')a', /closes nothing/],
  ])('%s', (src, why) => {
    const r = checkCore(src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(why);
  });
});

describe('matching is search: a match anywhere in the word counts', () => {
  const find = (src: string, word: string) => {
    const r = checkCore(src);
    if (!r.ok) throw new Error(r.message);
    return r.find(word);
  };

  it('finds cat inside concatenate, and says where', () => {
    expect(find('cat', 'concatenate')).toEqual({ index: 3, length: 3 });
    expect(find('cat', 'dog')).toBeNull();
  });

  it('anchors pin the match to the ends', () => {
    expect(find('^go$', 'go')).toEqual({ index: 0, length: 2 });
    expect(find('^go$', 'ago')).toBeNull();
    expect(find('a$', 'banana')).toEqual({ index: 5, length: 1 });
  });

  it('a* matches every word, with an empty match at the start', () => {
    expect(find('a*', 'xyz')).toEqual({ index: 0, length: 0 });
  });

  it('highlights the leftmost-LONGEST match, as POSIX and grep -o do, not the first alternative', () => {
    expect(find('a|ab', 'ab')).toEqual({ index: 0, length: 2 });
    expect(find('o+', 'zooom')).toEqual({ index: 1, length: 3 });
  });

  it('counts, ranges and negated classes', () => {
    expect(find('^.{5}$', 'apple')).toEqual({ index: 0, length: 5 });
    expect(find('^.{5}$', 'pear')).toBeNull();
    expect(find('x{2,3}', 'axxxxb')).toEqual({ index: 1, length: 3 });
    expect(find('x{2,}', 'axxxxb')).toEqual({ index: 1, length: 4 });
    expect(find('[0-9]+', 'catch22')).toEqual({ index: 5, length: 2 });
    expect(find('q[^u]', 'queen')).toBeNull();
    expect(find('q[^u]', 'iraqi')).toEqual({ index: 3, length: 2 });
  });
});

describe('the matcher is linear: no pattern freezes the page', () => {
  it.each(['((a|a)*)*z', '((.*)*)*z', '(a*)*b', '.*.*.*.*.*.*.*.*z', '(x+x+)+y'])('%s on a long word', (src) => {
    const r = checkCore(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t0 = performance.now();
    for (const w of ['a'.repeat(30), 'x'.repeat(30), 'abcdefghijklmnopqrstuvwxyzabcd']) r.test(w);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('agrees with JavaScript on WHETHER a word matches (random patterns)', () => {
  // A seeded generator of small core patterns; JS RegExp is the oracle for test()
  // only, where every flavor agrees on this core.
  let seed = 12345;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const atom = (d: number): string => {
    const k = rnd(d > 2 ? 4 : 7);
    if (k === 0) return 'ab'[rnd(2)]!;
    if (k === 1) return '.';
    if (k === 2) return ['[ab]', '[^a]', '[a-c]'][rnd(3)]!;
    if (k === 3) return 'abc'[rnd(3)]!;
    if (k === 4) return `(${expr(d + 1)})`;
    if (k === 5) return `(${expr(d + 1)}|${expr(d + 1)})`;
    return 'c';
  };
  const piece = (d: number) => atom(d) + ['', '', '*', '+', '?', '{2}', '{1,2}'][rnd(7)]!;
  const expr = (d: number): string => Array.from({ length: 1 + rnd(3) }, () => piece(d)).join('');
  const words = ['', 'a', 'b', 'ab', 'ba', 'abc', 'cab', 'aab', 'bba', 'abab', 'cabbac', 'ccc'];

  it('on 600 patterns × 12 words', () => {
    let checked = 0;
    for (let n = 0; n < 600; n++) {
      const src = (rnd(4) === 0 ? '^' : '') + expr(0) + (rnd(4) === 0 ? '$' : '');
      const r = checkCore(src);
      if (!r.ok) continue;
      const js = new RegExp(src);
      for (const w of words) {
        expect(r.test(w), `${src} on "${w}"`).toBe(js.test(w));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });
});

describe('an unfinished pattern is told apart from a wrong one', () => {
  it.each(['[ab', '(a', '(', 'a\\', 'a|', 'a{2'])('%s is incomplete', (src) => {
    const r = checkCore(src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.incomplete).toBe(true);
  });
  it.each(['a**', '\\d', '[z-a]', ')'])('%s is wrong', (src) => {
    const r = checkCore(src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.incomplete).toBe(false);
  });
});
