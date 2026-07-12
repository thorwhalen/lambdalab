/**
 * Tests for Thompson's construction.
 *
 * The heart of this file is a differential test against an INDEPENDENT oracle: a
 * direct recursive matcher over the regex AST (`matchesAst`), written without a
 * single line borrowed from the construction it checks. For every regex in the
 * corpus we compare `accepts(regexToNFA(r), s)` with `matchesAst(r, s)` on EVERY
 * string up to length 6 over the relevant alphabet. A construction that is
 * subtly wrong — a missing bypass edge, a loop that lets you re-enter a fragment
 * halfway — cannot survive that; a hand-picked example list easily could.
 *
 * The oracle is the semantics of the regex (⋃ of match positions), so agreement
 * means the machine's language *is* the regex's language, which is precisely the
 * theorem this module is asked to implement.
 *
 * The rest of the file pins down what the animation and the editor rely on: the
 * fragment invariant, post-order, monotone growth of the fragments, stable state
 * names across runs, and a layout with no two states on top of each other.
 */

import { describe, expect, it } from 'vitest';
import { EPSILON, type Automaton, type RegexNode, type StateId } from './types';
import { parseRegex, regexAlphabet, regexSize, renderRegex } from './regexParse';
import { accepts, alphabetOf } from './simulate';
import { regexToNFA, regexToNFASteps } from './thompson';

// ---------------------------------------------------------------------------
// The oracle: a direct matcher over the AST. Independent of thompson.ts.
// ---------------------------------------------------------------------------

/**
 * All positions `s` could be scanned *to* by matching `n` starting at `i`.
 *
 * A set, not a boolean, because concatenation must try every split — the greedy
 * "match left, then right" reading is the classic wrong answer here.
 */
function endsOf(n: RegexNode, s: string, i: number): Set<number> {
  switch (n.kind) {
    case 'empty':
      return new Set();
    case 'epsilon':
      return new Set([i]);
    case 'literal':
      return s[i] === n.sym ? new Set([i + 1]) : new Set();
    case 'concat': {
      const out = new Set<number>();
      for (const j of endsOf(n.left, s, i)) for (const k of endsOf(n.right, s, j)) out.add(k);
      return out;
    }
    case 'union':
      return new Set([...endsOf(n.left, s, i), ...endsOf(n.right, s, i)]);
    case 'star': {
      // Reachability closure over repetitions. The `has` guard both terminates
      // the walk and makes a nullable inner (e.g. (a?)*) harmless.
      const out = new Set([i]);
      const work = [i];
      while (work.length > 0) {
        const j = work.pop() as number;
        for (const k of endsOf(n.inner, s, j)) {
          if (!out.has(k)) {
            out.add(k);
            work.push(k);
          }
        }
      }
      return out;
    }
    case 'plus':
      // r+ = r · r*, by definition. Reuse the two cases above rather than
      // reimplementing the loop (a second loop is a second chance to be wrong).
      return endsOf({ kind: 'concat', left: n.inner, right: { kind: 'star', inner: n.inner } }, s, i);
    case 'optional':
      return new Set([...endsOf(n.inner, s, i), i]);
  }
}

const matchesAst = (n: RegexNode, s: string): boolean => endsOf(n, s, 0).has(s.length);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const parse = (src: string): RegexNode => {
  const r = parseRegex(src);
  if (!r.ok) throw new Error(`corpus regex ${JSON.stringify(src)} does not parse: ${r.message}`);
  return r.node;
};

/** Every string over `alphabet` of length <= maxLen, shortest first. Includes ''. */
const allStrings = (alphabet: string[], maxLen: number): string[] => {
  let frontier = [''];
  const out = [''];
  for (let n = 0; n < maxLen; n++) {
    frontier = frontier.flatMap((s) => alphabet.map((c) => s + c));
    out.push(...frontier);
  }
  return out;
};

const MAX_LEN = 6;

/**
 * Test over the regex's own symbols UNIONED with {a, b}: a machine that wrongly
 * accepts a symbol its regex never mentions (or, for ∅ and ε, accepts anything
 * at all) is exactly the bug an "own alphabet only" sweep would miss.
 */
const probeAlphabet = (n: RegexNode): string[] =>
  [...new Set([...regexAlphabet(n), 'a', 'b'])].sort();

/** The mandated corpus, plus the cases that have historically broken this gadget. */
const CORPUS = [
  // --- mandated ---
  '∅',
  'ε',
  'a',
  'a*',
  '(ab)*',
  'a|b',
  '(a|b)*abb',
  'a+',
  'a?',
  'a**',
  '(a|ε)*',
  '∅*',
  '∅|a',
  // --- degenerate / absorbing ---
  '', // parses to ε
  '∅a', // ∅ on the left kills the concatenation
  'a∅',
  '∅+',
  '∅?',
  'ε*',
  'ε+',
  'a|∅|b',
  '(∅|ε)*',
  // --- stacked postfix, where a missing bypass or loop edge shows up ---
  '(a*)*',
  '(a+)*',
  '(a*)+',
  '(a+)+',
  '(a?)+',
  '(a+)?',
  '(a?)*',
  '((a*)*)*',
  // --- interaction of the operators ---
  'aa*',
  'a*a',
  'a*b*',
  '(a*b)*',
  '(a|b)*',
  '(a|b)+',
  'ab|ba',
  'a?b+',
  'a(b|ε)a',
  '(ab|a)*b',
  '((a|b)(a|b))*',
  '(a|ε)b?',
  'a|bc', // a third symbol: 'c' must be readable, and must not leak elsewhere
  '(ab|c)*',
] as const;

// ---------------------------------------------------------------------------
// The differential test — this is the one that matters
// ---------------------------------------------------------------------------

describe('regexToNFA agrees with a direct AST matcher', () => {
  for (const src of CORPUS) {
    it(`${JSON.stringify(src)} — every string up to length ${MAX_LEN}`, () => {
      const node = parse(src);
      const nfa = regexToNFA(node);

      const disagreements = allStrings(probeAlphabet(node), MAX_LEN)
        .filter((s) => accepts(nfa, s) !== matchesAst(node, s))
        .map((s) => ({ s, machine: accepts(nfa, s), oracle: matchesAst(node, s) }));

      expect(disagreements).toEqual([]);
    });
  }
});

describe('the corpus actually exercises both answers', () => {
  // A vacuous differential test (everything rejected by both) would pass. Guard
  // against a corpus that has quietly stopped testing anything.
  it('every regex except the ∅-languages accepts something', () => {
    const acceptsNothing = CORPUS.filter((src) => {
      const node = parse(src);
      const nfa = regexToNFA(node);
      return !allStrings(probeAlphabet(node), MAX_LEN).some((s) => accepts(nfa, s));
    });
    expect(acceptsNothing).toEqual(['∅', '∅a', 'a∅', '∅+']);
  });

  it('only the universal language accepts everything', () => {
    const acceptsEverything = CORPUS.filter((src) => {
      const node = parse(src);
      const nfa = regexToNFA(node);
      return allStrings(probeAlphabet(node), MAX_LEN).every((s) => accepts(nfa, s));
    });
    // (a|b)* is Σ* over its own alphabet, so of course it accepts the lot; any
    // OTHER regex turning up here would mean the machine had sprung a leak.
    expect(acceptsEverything).toEqual(['(a|b)*']);
  });
});

// ---------------------------------------------------------------------------
// The fragment invariant
// ---------------------------------------------------------------------------

const outgoing = (a: Automaton, s: StateId) => a.transitions.filter((t) => t.from === s);
const incoming = (a: Automaton, s: StateId) => a.transitions.filter((t) => t.to === s);

const expectFragment = (a: Automaton): void => {
  expect(a.accepting).toHaveLength(1);
  const accept = a.accepting[0];
  expect(a.start).not.toEqual(accept);
  expect(a.states).toContain(a.start);
  expect(a.states).toContain(accept);
  // The invariant the composition rules lean on.
  expect(outgoing(a, accept)).toEqual([]);
  expect(incoming(a, a.start)).toEqual([]);
};

describe('fragment invariant', () => {
  it('holds for the whole machine, for every regex in the corpus', () => {
    for (const src of CORPUS) expectFragment(regexToNFA(parse(src)));
  });

  it('holds for every intermediate fragment of every step', () => {
    for (const src of CORPUS) {
      for (const step of regexToNFASteps(parse(src))) expectFragment(step.fragment);
    }
  });

  it('every transition names states the fragment declares', () => {
    for (const src of CORPUS) {
      for (const { fragment } of regexToNFASteps(parse(src))) {
        const q = new Set(fragment.states);
        for (const t of fragment.transitions) {
          expect(q.has(t.from) && q.has(t.to)).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The gadgets, individually
// ---------------------------------------------------------------------------

describe('the gadgets', () => {
  it('∅ is two states and no transitions at all', () => {
    const a = regexToNFA(parse('∅'));
    expect(a.states).toEqual(['q0', 'q1']);
    expect(a.transitions).toEqual([]);
    expect(a.start).toBe('q0');
    expect(a.accepting).toEqual(['q1']);
    expect(a.alphabet).toEqual([]);
  });

  it('ε is one free jump', () => {
    const a = regexToNFA(parse('ε'));
    expect(a.transitions).toEqual([{ from: 'q0', on: EPSILON, to: 'q1' }]);
    expect(a.alphabet).toEqual([]);
    expect(accepts(a, '')).toBe(true);
    expect(accepts(a, 'a')).toBe(false);
  });

  it('a literal reads exactly one symbol', () => {
    const a = regexToNFA(parse('a'));
    expect(a.transitions).toEqual([{ from: 'q0', on: 'a', to: 'q1' }]);
    expect(a.alphabet).toEqual(['a']);
  });

  it('concat adds one ε-edge and no states', () => {
    const a = regexToNFA(parse('ab'));
    expect(a.states).toEqual(['q0', 'q1', 'q2', 'q3']);
    expect(a.start).toBe('q0');
    expect(a.accepting).toEqual(['q3']);
    expect(a.transitions).toContainEqual({ from: 'q1', on: EPSILON, to: 'q2' });
    expect(a.transitions.filter((t) => t.on === EPSILON)).toHaveLength(1);
  });

  it('union adds two states and four ε-edges', () => {
    const a = regexToNFA(parse('a|b'));
    expect(a.states).toEqual(['q0', 'q1', 'q2', 'q3', 'q4', 'q5']);
    expect(a.start).toBe('q4');
    expect(a.accepting).toEqual(['q5']);
    expect(a.transitions.filter((t) => t.on === EPSILON)).toEqual([
      { from: 'q1', on: EPSILON, to: 'q5' },
      { from: 'q3', on: EPSILON, to: 'q5' },
      { from: 'q4', on: EPSILON, to: 'q0' },
      { from: 'q4', on: EPSILON, to: 'q2' },
    ]);
  });

  /*
   * star = loop + bypass, plus = loop only, optional = bypass only. If these
   * three ever collapse into each other, the languages below separate them.
   */
  const epsEdges = (src: string) =>
    regexToNFA(parse(src))
      .transitions.filter((t) => t.on === EPSILON)
      .map((t) => `${t.from}->${t.to}`);

  it('star has both the loop and the bypass', () => {
    // inner a = q0 -a-> q1; fresh start q2, fresh accept q3.
    expect(epsEdges('a*').sort()).toEqual(['q1->q0', 'q1->q3', 'q2->q0', 'q2->q3'].sort());
  });

  it('plus has the loop but no bypass — so it cannot match the empty string', () => {
    expect(epsEdges('a+').sort()).toEqual(['q1->q0', 'q1->q3', 'q2->q0'].sort());
    const a = regexToNFA(parse('a+'));
    expect(accepts(a, '')).toBe(false);
    expect(accepts(a, 'a')).toBe(true);
    expect(accepts(a, 'aaaa')).toBe(true);
  });

  it('optional has the bypass but no loop — so it cannot repeat', () => {
    expect(epsEdges('a?').sort()).toEqual(['q1->q3', 'q2->q0', 'q2->q3'].sort());
    const a = regexToNFA(parse('a?'));
    expect(accepts(a, '')).toBe(true);
    expect(accepts(a, 'a')).toBe(true);
    expect(accepts(a, 'aa')).toBe(false);
  });

  it('∅* accepts only the empty string (zero copies of nothing is still a match)', () => {
    const a = regexToNFA(parse('∅*'));
    expect(accepts(a, '')).toBe(true);
    expect(accepts(a, 'a')).toBe(false);
  });

  it('∅+ accepts nothing at all', () => {
    const a = regexToNFA(parse('∅+'));
    for (const s of allStrings(['a', 'b'], 3)) expect(accepts(a, s)).toBe(false);
  });

  it('(a|ε)* is a*, and a** is a*', () => {
    const star = regexToNFA(parse('a*'));
    for (const src of ['(a|ε)*', 'a**', '(a?)*', '(a+)*']) {
      const a = regexToNFA(parse(src));
      for (const s of allStrings(['a', 'b'], 4)) expect([src, s, accepts(a, s)]).toEqual([src, s, accepts(star, s)]);
    }
  });
});

// ---------------------------------------------------------------------------
// Names, ordering, determinism
// ---------------------------------------------------------------------------

describe('state names', () => {
  it('are q0..q(n-1), unique, and sequential', () => {
    for (const src of CORPUS) {
      const a = regexToNFA(parse(src));
      expect(a.states).toEqual(a.states.map((_, i) => `q${i}`));
    }
  });

  it('Thompson uses at most 2 states per AST node', () => {
    for (const src of CORPUS) {
      const node = parse(src);
      expect(regexToNFA(node).states.length).toBeLessThanOrEqual(2 * regexSize(node));
    }
  });
});

describe('determinism of the output', () => {
  it('two runs on the same AST are byte-identical', () => {
    for (const src of CORPUS) {
      expect(JSON.stringify(regexToNFA(parse(src)))).toBe(JSON.stringify(regexToNFA(parse(src))));
      expect(JSON.stringify(regexToNFASteps(parse(src)))).toBe(
        JSON.stringify(regexToNFASteps(parse(src))),
      );
    }
  });

  it('transitions come out in a stable sorted order', () => {
    const a = regexToNFA(parse('(a|b)*abb'));
    const keys = a.transitions.map((t) => [Number(t.from.slice(1)), t.on, Number(t.to.slice(1))]);
    const sorted = [...keys].sort(
      (x, y) =>
        (x[0] as number) - (y[0] as number) ||
        (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0) ||
        (x[2] as number) - (y[2] as number),
    );
    expect(keys).toEqual(sorted);
  });

  it('the alphabet is the regex alphabet: sorted, unique, no ε', () => {
    for (const src of CORPUS) {
      const node = parse(src);
      const a = regexToNFA(node);
      expect(a.alphabet).toEqual(regexAlphabet(node));
      expect(a.alphabet).not.toContain(EPSILON);
      expect(alphabetOf(a)).toEqual(regexAlphabet(node)); // no stray edges on unknown symbols
    }
  });
});

// ---------------------------------------------------------------------------
// The animation contract
// ---------------------------------------------------------------------------

describe('regexToNFASteps', () => {
  it('emits exactly one step per AST node', () => {
    for (const src of CORPUS) {
      const node = parse(src);
      expect(regexToNFASteps(node)).toHaveLength(regexSize(node));
    }
  });

  it('is post-order: every child fragment appears before its parent', () => {
    for (const src of CORPUS) {
      const steps = regexToNFASteps(parse(src));
      const seen = new Set<RegexNode>();
      for (const { node } of steps) {
        const kids: RegexNode[] =
          node.kind === 'concat' || node.kind === 'union'
            ? [node.left, node.right]
            : node.kind === 'star' || node.kind === 'plus' || node.kind === 'optional'
              ? [node.inner]
              : [];
        for (const kid of kids) expect(seen.has(kid)).toBe(true);
        seen.add(node);
      }
    }
  });

  it('ends with the full machine', () => {
    for (const src of CORPUS) {
      const node = parse(src);
      const steps = regexToNFASteps(node);
      expect(steps[steps.length - 1].fragment).toEqual(regexToNFA(node));
      expect(steps[steps.length - 1].node).toBe(node);
    }
  });

  it('grows monotonically: each fragment is a sub-machine of the final one', () => {
    for (const src of CORPUS) {
      const node = parse(src);
      const full = regexToNFA(node);
      const allStates = new Set(full.states);
      const allEdges = new Set(full.transitions.map((t) => `${t.from}|${t.on}|${t.to}`));

      for (const { fragment } of regexToNFASteps(node)) {
        for (const s of fragment.states) expect(allStates.has(s)).toBe(true);
        for (const t of fragment.transitions) {
          expect(allEdges.has(`${t.from}|${t.on}|${t.to}`)).toBe(true);
        }
        // Same states, same places: the UI layers frames on top of each other.
        for (const s of fragment.states) expect(fragment.layout?.[s]).toEqual(full.layout?.[s]);
      }
    }
  });

  it('each fragment matches its own sub-regex', () => {
    // The real payload of post-order: every intermediate frame is itself a
    // correct machine for the sub-regex it is captioned with.
    for (const src of CORPUS) {
      for (const { node, fragment } of regexToNFASteps(parse(src))) {
        for (const s of allStrings(probeAlphabet(node), 4)) {
          expect([renderRegex(node), s, accepts(fragment, s)]).toEqual([
            renderRegex(node),
            s,
            matchesAst(node, s),
          ]);
        }
      }
    }
  });

  it('labels the fragment with its rendered sub-regex, and explains it in words', () => {
    const steps = regexToNFASteps(parse('a|b'));
    expect(steps.map((s) => s.label)).toEqual(['a', 'b', 'a|b']);
    for (const step of steps) {
      expect(step.explain.length).toBeGreaterThan(0);
      expect(step.explain).not.toContain('ε-transition'); // no jargon for a 12-year-old
    }
    expect(steps[2].explain).toContain('jump for free');
  });

  it('never mis-brackets a sub-regex inside an explanation', () => {
    // "a|b*" would be a lie about what the star gadget was applied to.
    const [, , , star] = regexToNFASteps(parse('(a|b)*'));
    expect(star.label).toBe('(a|b)*');
    expect(star.explain).toContain('a|b');
    expect(star.explain).not.toContain('a|b*');
  });
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

describe('layout', () => {
  it('positions every state, in the positive quadrant', () => {
    for (const src of CORPUS) {
      const a = regexToNFA(parse(src));
      for (const s of a.states) {
        const p = a.layout?.[s];
        expect(p).toBeDefined();
        expect(p?.x).toBeGreaterThanOrEqual(0);
        expect(p?.y).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('never stacks two states on the same spot', () => {
    for (const src of CORPUS) {
      const a = regexToNFA(parse(src));
      const spots = a.states.map((s) => `${a.layout?.[s].x},${a.layout?.[s].y}`);
      expect(new Set(spots).size).toBe(a.states.length);
    }
  });

  it('lays a union out with its two branches on different rows', () => {
    const a = regexToNFA(parse('a|b'));
    const y = (s: StateId) => a.layout?.[s].y as number;
    expect(y('q0')).not.toEqual(y('q2')); // the two branches
    expect(y('q0')).toEqual(y('q1'));
    expect(y('q4')).toEqual(y('q5')); // fresh start and finish share the centre line
  });

  it('lays a concatenation out left to right', () => {
    const a = regexToNFA(parse('abc'));
    const xs = a.states.map((s) => a.layout?.[s].x as number);
    expect(xs).toEqual([...xs].sort((p, q) => p - q));
    expect(new Set(a.states.map((s) => a.layout?.[s].y)).size).toBe(1); // one row
  });
});
