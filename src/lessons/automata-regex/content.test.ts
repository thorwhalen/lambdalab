/**
 * The language bank, checked by machine.
 *
 * Every puzzle claims: this regex means this English, these strings are in the
 * language, these are not. Three of those four claims are machine-checkable, and
 * a wrong one would mean grading a child's correct machine as wrong. So:
 *
 *   1. Every reference regex parses.
 *   2. Every `accept` string is genuinely matched by the reference.
 *   3. Every `reject` string is genuinely NOT matched by the reference.
 *   4. The accept/reject lists actually PIN the language down — i.e. they are not
 *      so thin that a stupid machine passes them. (We check that no strictly
 *      simpler language — "accept everything", "accept nothing" — passes the same
 *      tests. A puzzle whose test strings are satisfied by "accept everything" is
 *      not a puzzle.)
 *   5. Every puzzle's alphabet covers every symbol in its regex and its strings.
 *
 * The `impossible: true` puzzle (aⁿbⁿ) is exempt from 2-4: its "regex" is a
 * deliberate finite lie, and the whole point is that no regex can be right.
 */
import { describe, expect, it } from 'vitest';
import { parseRegex } from '../../lib/automata/regexParse';
import { regexToNFA } from '../../lib/automata/thompson';
import { accepts } from '../../lib/automata/simulate';
import { minimalStateCount } from '../../lib/automata/minimize';
import { equivalent } from '../../lib/automata/equivalence';
import type { Automaton } from '../../lib/automata/types';
import { LANGUAGE_PUZZLES } from './content';

const machineFor = (regex: string): Automaton => {
  const p = parseRegex(regex);
  if (!p.ok) throw new Error(`reference regex failed to parse: ${regex} → ${p.message}`);
  return regexToNFA(p.node);
};

/** "Accepts everything over Σ" and "accepts nothing" — the two degenerate machines. */
const acceptAll = (alphabet: string[]): Automaton => ({
  states: ['q'],
  alphabet,
  transitions: alphabet.map((c) => ({ from: 'q', on: c, to: 'q' })),
  start: 'q',
  accepting: ['q'],
});
const acceptNone = (alphabet: string[]): Automaton => ({
  states: ['q'],
  alphabet,
  transitions: alphabet.map((c) => ({ from: 'q', on: c, to: 'q' })),
  start: 'q',
  accepting: [],
});

describe('automata language bank', () => {
  it('has unique ids and covers every level', () => {
    const ids = LANGUAGE_PUZZLES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const levels = new Set(LANGUAGE_PUZZLES.map((p) => p.level));
    for (let n = 1; n <= 8; n++) {
      expect(levels.has(n), `no puzzles at level ${n}`).toBe(true);
    }
  });

  for (const p of LANGUAGE_PUZZLES) {
    describe(`${p.id} — ${p.prompt.slice(0, 60)}`, () => {
      it('reference regex parses', () => {
        expect(() => machineFor(p.regex)).not.toThrow();
      });

      it('alphabet covers every symbol used', () => {
        const alpha = new Set(p.alphabet);
        for (const s of [...p.accept, ...p.reject]) {
          for (const c of s) {
            expect(alpha.has(c), `"${c}" in test string "${s}" is not in the alphabet`).toBe(true);
          }
        }
      });

      if (p.impossible) {
        it('is marked impossible and is therefore exempt from language checks', () => {
          expect(p.impossible).toBe(true);
          expect(p.note, 'an impossible puzzle must explain why').toBeTruthy();
        });
        return;
      }

      it('every ACCEPT string is really in the language', () => {
        const m = machineFor(p.regex);
        for (const s of p.accept) {
          expect(accepts(m, s), `"${s || 'ε'}" is listed as accepted but the regex ${p.regex} rejects it`).toBe(true);
        }
      });

      it('every REJECT string is really out of the language', () => {
        const m = machineFor(p.regex);
        for (const s of p.reject) {
          expect(accepts(m, s), `"${s || 'ε'}" is listed as rejected but the regex ${p.regex} accepts it`).toBe(false);
        }
      });

      it('the test strings actually pin the language down', () => {
        // A puzzle whose examples are also satisfied by "accept everything" (or
        // "accept nothing") has not told the learner enough to aim at.
        const passes = (m: Automaton) =>
          p.accept.every((s) => accepts(m, s)) && p.reject.every((s) => !accepts(m, s));

        const ref = machineFor(p.regex);
        const all = acceptAll(p.alphabet);
        const none = acceptNone(p.alphabet);

        if (!equivalent(ref, all).equal) {
          expect(passes(all), 'the "accept everything" machine passes these test strings').toBe(false);
        }
        if (!equivalent(ref, none).equal) {
          expect(passes(none), 'the "accept nothing" machine passes these test strings').toBe(false);
        }
      });

      it('has a computable par (minimal state count)', () => {
        const n = minimalStateCount(machineFor(p.regex));
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThan(40); // a puzzle needing 40 states is not a puzzle
      });
    });
  }
});

describe('solve keys: one activity per prefix', () => {
  it('counts builder and regex solves toward their rung, golf toward none', async () => {
    const { solveLevel } = await import('./content');
    expect(solveLevel('a2-even-a')).toBe(2);
    expect(solveLevel('re-a2-even-a')).toBe(2);
    expect(solveLevel('golf-g-cat')).toBe(0);
  });

  it('totals each board over its own solves only, never lowering a best', async () => {
    const { boardTotal } = await import('./content');
    const solved = { 'a1-only-a': { best: 100 }, 're-a1-only-a': { best: 50 }, 'golf-g-cat': { best: 120 } };
    expect(boardTotal(solved, 'golf-g-oo', 80)).toEqual({ total: 200, solved: 2 });
    expect(boardTotal(solved, 'golf-g-cat', 10)).toEqual({ total: 120, solved: 1 });
    expect(boardTotal(solved, 're-a2-even-a', 30)).toEqual({ total: 80, solved: 2 });
    expect(boardTotal(solved, 'a2-even-a', 1)).toEqual({ total: 101, solved: 2 });
  });
});
