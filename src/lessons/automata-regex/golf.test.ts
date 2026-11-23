/**
 * The golf bank, checked by machine.
 *
 *   1. Every solution is a core pattern (no flavor-specific syntax slipped in).
 *   2. Every solution finds a match in every left-hand word and in no right-hand word.
 *   3. Every puzzle has a solution that uses only symbols met by its station, AND
 *      uses that station's new symbol — so the path never asks for a symbol early,
 *      and every station's puzzles really exercise its symbol.
 *   4. Every station has at least two puzzles, so each symbol lands before the next.
 *   5. Par is honest and the new symbol is needed, to 3 characters (deeper: golf.audit.test.ts).
 *   6. The lists are not degenerate: the left list is non-empty, and the right list
 *      is non-empty (otherwise "." or "" would win every hole).
 */
import { describe, expect, it } from 'vitest';
import { checkCore } from '../../lib/coreRegex';
import { GOLF_PUZZLES, GOLF_STATIONS, golfPar, symbolsMetBy } from './golf';
import { shortestSolutions } from './golfSearch';

const SHALLOW = 3;

describe('pattern golf bank', () => {
  it('has unique ids', () => {
    const ids = GOLF_PUZZLES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('introduces each symbol once', () => {
    const syms = GOLF_STATIONS.map((s) => s.symbol).filter(Boolean);
    expect(new Set(syms).size).toBe(syms.length);
  });

  it('gives every station at least two puzzles', () => {
    GOLF_STATIONS.forEach((s, n) => {
      const count = GOLF_PUZZLES.filter((p) => p.station === n).length;
      expect(count, `station "${s.title}" has ${count} puzzle(s)`).toBeGreaterThanOrEqual(2);
    });
  });

  for (const p of GOLF_PUZZLES) {
    describe(`${p.id} — ${p.title}`, () => {
      it('has both lists and a station that exists', () => {
        expect(p.match.length).toBeGreaterThan(0);
        expect(p.reject.length).toBeGreaterThan(0);
        expect(GOLF_STATIONS[p.station]).toBeDefined();
        expect(new Set([...p.match, ...p.reject]).size).toBe(p.match.length + p.reject.length);
      });

      for (const sol of p.solutions) {
        it(`solution ${sol} is core and sorts every word correctly`, () => {
          const r = checkCore(sol);
          expect(r.ok, r.ok ? '' : r.message).toBe(true);
          if (!r.ok) return;
          for (const w of p.match) expect(r.test(w), `${sol} misses "${w}"`).toBe(true);
          for (const w of p.reject) expect(r.test(w), `${sol} wrongly finds "${w}"`).toBe(false);
        });
      }

      it("is solvable with the symbols met so far, using the station's new one", () => {
        const met = symbolsMetBy(p.station);
        const fresh = GOLF_STATIONS[p.station].symbol;
        const fits = p.solutions.some((sol) => {
          const r = checkCore(sol);
          if (!r.ok) return false;
          const used = [...r.symbols];
          return used.every((s) => met.has(s)) && (fresh === null || r.symbols.has(fresh));
        });
        expect(fits, `no solution of ${p.id} stays within ${[...met].join(' ')} and uses ${fresh}`).toBe(true);
      });

      it('cannot be beaten, or reached without its new symbol, by a pattern of 3 characters or fewer', () => {
        // Golf rewards shortcuts, so par is a claim. The full search is golf.audit.test.ts;
        // this shallow pass runs every time and caught "at" beating "cat".
        const par = golfPar(p);
        const met = symbolsMetBy(p.station);
        const beaten = shortestSolutions(p, met, Math.min(par - 1, SHALLOW));
        expect(beaten.length, `beaten by ${JSON.stringify(beaten.examples)}`).toBeNull();
        const fresh = GOLF_STATIONS[p.station]!.symbol;
        if (fresh) {
          const without = shortestSolutions(p, new Set([...met].filter((s) => s !== fresh)), Math.min(par, SHALLOW));
          expect(without.length, `reached without ${fresh}: ${JSON.stringify(without.examples)}`).toBeNull();
        }
      });

      it('has a par', () => {
        expect(golfPar(p)).toBeGreaterThan(0);
      });
    });
  }
});
