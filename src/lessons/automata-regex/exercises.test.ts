/**
 * The "build this" sheet, checked by machine, the same way `content.test.ts`
 * checks the puzzle bank: the regex parses, the examples are right and pin the
 * language down, the legend explains every letter — plus the ordering the sheet
 * promises (stars never go down, every star level is present).
 */
import { describe, expect, it } from 'vitest';
import { parseRegex, regexAlphabet } from '../../lib/automata/regexParse';
import { regexToNFA } from '../../lib/automata/thompson';
import { accepts } from '../../lib/automata/simulate';
import { equivalent } from '../../lib/automata/equivalence';
import { minimalStateCount } from '../../lib/automata/minimize';
import type { Automaton } from '../../lib/automata/types';
import { BUILD_EXERCISES } from './exercises';

const machineFor = (regex: string): Automaton => {
  const p = parseRegex(regex);
  if (!p.ok) throw new Error(`reference regex failed to parse: ${regex} → ${p.message}`);
  return regexToNFA(p.node);
};

const loop = (alphabet: string[], accepting: boolean): Automaton => ({
  states: ['q'],
  alphabet,
  transitions: alphabet.map((c) => ({ from: 'q', on: c, to: 'q' })),
  start: 'q',
  accepting: accepting ? ['q'] : [],
});

describe('build-this exercise sheet', () => {
  it('has unique ids', () => {
    const ids = BUILD_EXERCISES.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is ordered by difficulty and spans warm-up to fiendish', () => {
    const stars = BUILD_EXERCISES.map((x) => x.stars);
    expect([...stars].sort((a, b) => a - b)).toEqual(stars);
    for (const s of [1, 2, 3, 4, 5]) expect(stars, `no ${s}-star exercise`).toContain(s);
  });

  for (const x of BUILD_EXERCISES) {
    describe(`${x.id} — ${x.title}`, () => {
      it('regex parses and uses only the alphabet', () => {
        const p = parseRegex(x.regex);
        expect(p.ok).toBe(true);
        if (p.ok) for (const c of regexAlphabet(p.node)) expect(x.alphabet).toContain(c);
      });

      it('legend explains every letter, and every example is over the alphabet', () => {
        expect(Object.keys(x.legend).sort()).toEqual([...x.alphabet].sort());
        for (const s of [...x.accept, ...x.reject]) for (const c of s) expect(x.alphabet).toContain(c);
      });

      it('accept examples are in the language, reject examples are not', () => {
        const m = machineFor(x.regex);
        for (const s of x.accept) expect(accepts(m, s), `"${s || 'ε'}" should be accepted by ${x.regex}`).toBe(true);
        for (const s of x.reject) expect(accepts(m, s), `"${s || 'ε'}" should be rejected by ${x.regex}`).toBe(false);
      });

      it('examples pin the language down', () => {
        const ref = machineFor(x.regex);
        const passes = (m: Automaton) => x.accept.every((s) => accepts(m, s)) && x.reject.every((s) => !accepts(m, s));
        for (const degenerate of [loop(x.alphabet, true), loop(x.alphabet, false)]) {
          if (!equivalent(ref, degenerate).equal) expect(passes(degenerate)).toBe(false);
        }
      });

      it('its machine is drawable', () => {
        const n = minimalStateCount(machineFor(x.regex));
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThanOrEqual(12);
      });
    });
  }
});
