/**
 * The puzzle bank, checked by machine.
 *
 * Hand-authoring first-order logic puzzles is exactly as error-prone as it
 * sounds, and the failure mode — teaching a child a formula that does not mean
 * what we said it means — is the worst one available to us. So every puzzle is
 * verified on every test run:
 *
 *   1. The reference formula parses under its own signature.
 *   2. Every distractor parses.
 *   3. **No distractor is equivalent to the reference.** A multiple-choice with
 *      two right answers is not a hard question, it is a broken one. (This check
 *      already caught one: `¬(P ∧ Q)` versus `¬P ∨ ¬Q` in the De Morgan puzzle.)
 *   4. No two distractors are equivalent to *each other* — same reason.
 *   5. The reference is not a tautology or a contradiction (with the deliberate
 *      exception of the puzzles that are *about* those, which opt out).
 *   6. Every tile a solution needs is actually in the palette at that level —
 *      otherwise the puzzle is unsolvable and only playtesting would find it.
 */
import { describe, expect, it } from 'vitest';
import { parseFormula } from '../../lib/logic/parse';
import { logicEquivalent } from '../../lib/logic/equivalence';
import { tokenizeLogic } from '../../lib/logic/parse';
import { TRANSLATE_PUZZLES, paletteFor } from './content';
import type { Formula, Signature } from '../../lib/logic/types';

/** Puzzles whose answer is *meant* to be always-true or always-false. */
const ALLOWED_TRIVIAL = new Set(['t3-empty']);

function mustParse(src: string, sig: Signature, what: string): Formula {
  const r = parseFormula(src, sig);
  if (!r.ok) throw new Error(`${what} failed to parse: ${src}\n  → ${r.message}`);
  return r.formula;
}

describe('set-logic puzzle bank', () => {
  it('has puzzles at every level of the ladder', () => {
    const levels = new Set(TRANSLATE_PUZZLES.map((p) => p.level));
    for (let n = 1; n <= 8; n++) {
      expect(levels.has(n), `no puzzles at level ${n}`).toBe(true);
    }
  });

  it('has unique ids', () => {
    const ids = TRANSLATE_PUZZLES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const p of TRANSLATE_PUZZLES) {
    describe(`${p.id} — "${p.prompt}"`, () => {
      it('reference formula parses', () => {
        expect(() => mustParse(p.formal, p.sig, 'reference')).not.toThrow();
      });

      it('has at least two distractors', () => {
        expect(p.distractors.length).toBeGreaterThanOrEqual(2);
      });

      it('every distractor parses', () => {
        for (const d of p.distractors) {
          expect(() => mustParse(d.formal, p.sig, `distractor "${d.english}"`)).not.toThrow();
        }
      });

      it('NO distractor is equivalent to the reference', () => {
        const ref = mustParse(p.formal, p.sig, 'reference');
        for (const d of p.distractors) {
          const alt = mustParse(d.formal, p.sig, 'distractor');
          const eq = logicEquivalent(alt, ref, p.sig);
          expect(
            eq.equal,
            `distractor "${d.formal}" is LOGICALLY EQUIVALENT to the answer "${p.formal}" — ` +
              `the puzzle has two right answers`,
          ).toBe(false);
        }
      });

      it('no two distractors are equivalent to each other', () => {
        for (let i = 0; i < p.distractors.length; i++) {
          for (let j = i + 1; j < p.distractors.length; j++) {
            const a = mustParse(p.distractors[i].formal, p.sig, 'distractor');
            const b = mustParse(p.distractors[j].formal, p.sig, 'distractor');
            const eq = logicEquivalent(a, b, p.sig);
            expect(
              eq.equal,
              `distractors ${i} and ${j} are equivalent: "${p.distractors[i].formal}" ≡ "${p.distractors[j].formal}"`,
            ).toBe(false);
          }
        }
      });

      it('the answer says something (is neither always-true nor always-false)', () => {
        if (ALLOWED_TRIVIAL.has(p.id)) return;
        const ref = mustParse(p.formal, p.sig, 'reference');
        const alwaysTrue = mustParse('¬ ( ∅ = ∅ )', { sets: [], relations: [], constants: [] }, 'x');
        // Cheaper and clearer than building ⊤/⊥: a formula that says something
        // must disagree with BOTH the always-true and the always-false formula.
        void alwaysTrue;
        const T: Formula = { kind: 'true' };
        const F: Formula = { kind: 'false' };
        expect(logicEquivalent(ref, T, p.sig).equal, `${p.id} is a tautology`).toBe(false);
        expect(logicEquivalent(ref, F, p.sig).equal, `${p.id} is a contradiction`).toBe(false);
      });

      it('every token in the answer is available in the palette at this level', () => {
        const palette = paletteFor(p.sig, p.level);
        const available = new Set(palette.map((t) => t.token));
        for (const tok of tokenizeLogic(p.formal)) {
          expect(
            available.has(tok),
            `token "${tok}" is needed by ${p.id} (level ${p.level}) but is not in the palette until later`,
          ).toBe(true);
        }
      });
    });
  }
});
