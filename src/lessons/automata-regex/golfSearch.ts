/**
 * Exhaustive search for short golf solutions: does par hold, and does a puzzle
 * really need its station's symbol? Up to a length only: the search is
 * exponential, so a par longer than the audited depth is a claim checked that far
 * and no further.
 *
 * Golf rewards shortcuts, so a hand-authored par is a claim, and the first bank
 * got it wrong on half its holes (`r.y` beat `gr[ae]y`, `y$` beat `ly$`). This
 * enumerates every pattern up to a length, over the letters of the puzzle's
 * words and the syntax of the symbols allowed, and returns the shortest that
 * sorts both lists.
 *
 * Exponential, so it is used two ways: `golf.test.ts` runs it shallow on every
 * puzzle (cheap, catches the obvious), and `golf.audit.test.ts` runs it deep on
 * demand (`GOLF_AUDIT=6 npx vitest run golf.audit`) before a bank change lands.
 */
import { checkCore, type CoreSymbol } from '../../lib/coreRegex';
import type { GolfPuzzle } from './golf';

/** The characters that spell each symbol. Digits and a comma come with counts. */
const SYNTAX: Record<CoreSymbol, string[]> = {
  '|': ['|'],
  '.': ['.'],
  '[]': ['[', ']'],
  '[^]': ['[', '^', ']'],
  '^': ['^'],
  $: ['$'],
  '?': ['?'],
  '+': ['+'],
  '*': ['*'],
  '()': ['(', ')'],
  '{}': ['{', '}', ',', '1', '2', '3', '4', '5', '6', '7', '8'],
  '[a-z]': ['-'],
  '\\': [],
};

const QUANT = new Set(['*', '+', '?', '{']);

/** Prefixes no suffix can repair: prune them so the search stays tractable. */
function deadPrefix(s: string): boolean {
  const last = s[s.length - 1]!;
  const prev = s[s.length - 2];
  if (s.length === 1 && (QUANT.has(last) || last === '|' || last === ')' || last === ']' || last === '}')) return true;
  if (prev !== undefined && QUANT.has(prev) && QUANT.has(last)) return true;
  if ((prev === '|' || prev === '(') && (last === '|' || last === ')' || QUANT.has(last))) return true;
  if ((prev === '^' || prev === '$') && QUANT.has(last)) return true;
  return false;
}

export interface SearchResult {
  /** Length of the shortest solutions found, or null if none up to `maxLen`. */
  length: number | null;
  /** Up to a handful of them. */
  examples: string[];
}

/**
 * The shortest patterns, up to `maxLen` characters, that use only `allowed`
 * symbols and sort the puzzle's lists.
 */
export function shortestSolutions(p: GolfPuzzle, allowed: Set<CoreSymbol>, maxLen: number): SearchResult {
  const letters = [...new Set([...p.match, ...p.reject].join(''))].sort();
  const syntax = [...new Set([...allowed].flatMap((s) => SYNTAX[s]))];
  const alphabet = [...new Set([...letters, ...syntax])];
  let best = Infinity;
  const examples: string[] = [];

  const consider = (s: string) => {
    const r = checkCore(s);
    if (!r.ok || ![...r.symbols].every((x) => allowed.has(x))) return;
    if (!p.match.every((w) => r.test(w)) || p.reject.some((w) => r.test(w))) return;
    if (s.length < best) {
      best = s.length;
      examples.length = 0;
    }
    if (examples.length < 6) examples.push(s);
  };

  // Iterative deepening: the first depth with a solution is the answer.
  for (let len = 1; len <= maxLen && best === Infinity; len++) {
    const rec = (s: string) => {
      if (s.length === len) return consider(s);
      for (const c of alphabet) {
        const next = s + c;
        if (!deadPrefix(next)) rec(next);
      }
    };
    rec('');
  }
  return { length: best === Infinity ? null : best, examples };
}
