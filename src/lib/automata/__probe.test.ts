/** Scratch probe of the "open alphabet" claims. Deleted after use. */
import { describe, it } from 'vitest';
import {
  accepts,
  alphabetOf,
  automatonToRegex,
  parseRegex,
  regexToNFA,
  renderRegex,
  type Automaton,
} from './index';

describe('probe', () => {
  it('open alphabet claims', () => {
    // A: emoji literal — regexParse's docstring says emoji work with zero config.
    const p = parseRegex('😀');
    console.log('A parse 😀 ->', JSON.stringify(p));
    if (p.ok) {
      const m = regexToNFA(p.node);
      console.log('A alphabetOf:', JSON.stringify(alphabetOf(m)));
      console.log('A accepts("😀"):', accepts(m, '😀'), '<-- should be true');
    }

    // B: whitespace as a symbol.
    const w = parseRegex('a b');
    console.log('B parse "a b" ->', w.ok ? renderRegex(w.node) : w.message);
    const wsMachine: Automaton = {
      states: ['q0', 'q1'],
      alphabet: [' '],
      transitions: [{ from: 'q0', on: ' ', to: 'q1' }],
      start: 'q0',
      accepting: ['q1'],
    };
    const wsText = renderRegex(automatonToRegex(wsMachine));
    console.log('B machine over Σ={space} -> regex', JSON.stringify(wsText));
    const wsBack = parseRegex(wsText);
    console.log('B reparse ->', wsBack.ok ? JSON.stringify(wsBack.node) : wsBack.message);

    // C: metacharacter as a symbol (Σ={'+'} — an arithmetic-token lesson).
    const meta: Automaton = {
      states: ['q0', 'q1'],
      alphabet: ['+'],
      transitions: [{ from: 'q0', on: '+', to: 'q1' }],
      start: 'q0',
      accepting: ['q1'],
    };
    const mText = renderRegex(automatonToRegex(meta));
    console.log('C machine over Σ={+} -> regex', JSON.stringify(mText));
    const mBack = parseRegex(mText);
    console.log('C reparse ->', mBack.ok ? JSON.stringify(mBack.node) : 'ERROR: ' + mBack.message);
    console.log('C accepts("+") original:', accepts(meta, '+'));
    if (mBack.ok) console.log('C accepts("+") round-tripped:', accepts(regexToNFA(mBack.node), '+'));
  });
});
