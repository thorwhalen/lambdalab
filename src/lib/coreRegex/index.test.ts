/**
 * The core-flavor check: accepts the shared core, refuses the rest with a reason,
 * and reports exactly the symbols a pattern used.
 */
import { describe, expect, it } from 'vitest';
import { checkCore, firstMatch, type CoreSymbol } from './index';

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
    ['a|', /empty/],
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
    ['(ab', /never closed/],
    ['ab)', /closes nothing/],
    ['[ab', /never closed/],
    ['[]', /never closed|Empty/],
    ['[z-a]', /backwards/],
    ['a{3,2}', /backwards/],
    ['a{x}', /count is written/],
    ['{3}', /nothing before/],
    ['[[:alpha:]]', /flavor-specific/],
    ['a\\', /escapes nothing/],
  ])('%s', (src, why) => {
    const r = checkCore(src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(why);
  });
});

describe('matching is search: a match anywhere in the word counts', () => {
  const re = (src: string) => {
    const r = checkCore(src);
    if (!r.ok) throw new Error(r.message);
    return r.regex;
  };

  it('finds cat inside concatenate, and says where', () => {
    expect(firstMatch(re('cat'), 'concatenate')).toEqual({ index: 3, length: 3 });
    expect(firstMatch(re('cat'), 'dog')).toBeNull();
  });

  it('anchors pin the match to the ends', () => {
    expect(firstMatch(re('^go$'), 'go')).toEqual({ index: 0, length: 2 });
    expect(firstMatch(re('^go$'), 'ago')).toBeNull();
  });

  it('a* matches every word, with an empty match at the start', () => {
    expect(firstMatch(re('a*'), 'xyz')).toEqual({ index: 0, length: 0 });
  });
});
