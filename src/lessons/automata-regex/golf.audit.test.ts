/**
 * The deep golf audit, run on demand before a bank change lands:
 *
 *     GOLF_AUDIT=5 npx vitest run golf.audit      (GOLF_ONLY=g-cat for one puzzle)
 *
 * For every puzzle, two exhaustive searches up to GOLF_AUDIT characters:
 *   1. par is honest: nothing shorter than par sorts the lists, with the symbols met so far;
 *   2. the station's symbol is needed: without it, nothing as short as par does.
 * Skipped unless GOLF_AUDIT is set, because depth 6 takes minutes. `golf.test.ts`
 * runs the same searches at depth 3 every time.
 */
import { describe, expect, it } from 'vitest';
import { GOLF_PUZZLES, GOLF_STATIONS, golfPar, symbolsMetBy } from './golf';
import { shortestSolutions } from './golfSearch';

const DEPTH = Number(process.env['GOLF_AUDIT'] ?? 0);
const ONLY = process.env['GOLF_ONLY'];

describe.skipIf(!DEPTH)(`golf audit to depth ${DEPTH}`, () => {
  for (const p of GOLF_PUZZLES.filter((q) => !ONLY || q.id === ONLY)) {
    const par = golfPar(p);
    const met = symbolsMetBy(p.station);
    const fresh = GOLF_STATIONS[p.station]!.symbol;

    it(`${p.id}: nothing beats par ${par}`, () => {
      const r = shortestSolutions(p, met, Math.min(par - 1, DEPTH));
      expect(r.length, `beaten by ${JSON.stringify(r.examples)}`).toBeNull();
    }, 3_600_000);

    if (fresh) {
      it(`${p.id}: needs ${fresh} to reach par`, () => {
        const without = new Set([...met].filter((s) => s !== fresh));
        const r = shortestSolutions(p, without, Math.min(par, DEPTH));
        expect(r.length, `reached without ${fresh}: ${JSON.stringify(r.examples)}`).toBeNull();
      }, 3_600_000);
    }
  }
});
