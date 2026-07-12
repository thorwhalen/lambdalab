/**
 * Finite Automata & Regular Expressions — the ladder and the language bank.
 *
 * A puzzle is a LANGUAGE: an alphabet, a plain-English description, and a
 * reference regular expression that defines it exactly. Everything else the game
 * needs is *derived*, not authored:
 *
 *   - the target machine        ← Thompson's construction on the reference regex
 *   - "is the learner right?"   ← equivalence against that machine
 *   - "why are they wrong?"     ← the shortest string the two disagree on
 *   - the par score             ← minimalStateCount of the reference
 *   - the test strings          ← authored, but *checked* against the reference
 *
 * That is the whole reason the engine exists. Authoring an automaton puzzle by
 * hand means authoring a machine, a regex, a state count and two lists of strings
 * and keeping all five consistent — which nobody can do reliably for thirty
 * puzzles. Authoring a regex and deriving the rest means the only thing that can
 * be wrong is the English, and `content.test.ts` checks even that as far as it
 * can (every accept string matches the reference; every reject string doesn't).
 */
import type { Level, PuzzleBase } from '../../core/types';

export const LADDER: Level[] = [
  {
    n: 1,
    name: 'States and arrows',
    goal: 'Build a machine that reads a string and says yes or no.',
    unlocks: ['states', 'transitions', 'start', 'accepting'],
    toAdvance: 3,
  },
  {
    n: 2,
    name: 'Remembering',
    goal: 'A machine has no memory except which state it is in. Make that enough.',
    unlocks: ['counting with states', 'the trap state'],
    toAdvance: 3,
  },
  {
    n: 3,
    name: 'Patterns in writing',
    goal: 'Say the same thing as a machine, but in one line of symbols.',
    unlocks: ['regex: a b', '|', '*'],
    toAdvance: 4,
  },
  {
    n: 4,
    name: 'More regex',
    goal: 'Shorthands that make patterns readable.',
    unlocks: ['+', '?', 'ε', '∅'],
    toAdvance: 4,
  },
  {
    n: 5,
    name: 'Two places at once',
    goal: 'Let the machine guess. Nondeterminism costs nothing and buys a lot.',
    unlocks: ['NFA', 'ε-moves'],
    toAdvance: 3,
  },
  {
    n: 6,
    name: 'Machine → pattern',
    goal: 'Rip states out one at a time until only the pattern is left.',
    unlocks: ['state elimination'],
    toAdvance: 3,
  },
  {
    n: 7,
    name: 'Pattern → machine',
    goal: 'Build a machine from a pattern, piece by piece. Then squash it down to the smallest one that works.',
    unlocks: ["Thompson's construction", 'subset construction', 'minimisation'],
    toAdvance: 3,
  },
  {
    n: 8,
    name: 'The wall',
    goal: 'Find a language no finite machine can ever recognise — and understand exactly why.',
    unlocks: ['the pumping intuition'],
    toAdvance: 1,
  },
];

export const MAX_LEVEL = LADDER.length;

export interface LanguagePuzzle extends PuzzleBase {
  alphabet: string[];
  /** The definition of the language. Everything else is derived from this. */
  regex: string;
  /** Strings the machine must accept. Verified against `regex` by the test. */
  accept: string[];
  /** Strings it must reject. Also verified. */
  reject: string[];
  /**
   * Set when the language is NOT regular — the puzzle exists to be *impossible*,
   * and the lesson's payoff is the learner discovering that for themselves. Such
   * a puzzle has no reference regex that works; `regex` then holds the best
   * finite approximation and the UI never grades against it.
   */
  impossible?: boolean;
  /** Why this one is instructive. Shown after a solve. */
  note?: string;
}

const AB = ['a', 'b'];
const BIN = ['0', '1'];

/**
 * The bank. Levels 1-2 are DFA-building; 3-4 add regex; 5 nondeterminism;
 * 6-7 conversion both ways; 8 is the wall.
 */
export const LANGUAGE_PUZZLES: LanguagePuzzle[] = [
  // --- Level 1: your first machines ---------------------------------------
  {
    id: 'a1-only-a',
    level: 1,
    prompt: 'Accept exactly the one-letter string "a", and nothing else.',
    alphabet: AB,
    regex: 'a',
    accept: ['a'],
    reject: ['', 'b', 'aa', 'ab', 'ba', 'aaa'],
    hint: "Remember: the empty string ε has to be REJECTED too. Is your start state accepting? It shouldn't be.",
  },
  {
    id: 'a1-starts-a',
    level: 1,
    prompt: 'Accept every string that starts with an "a".',
    alphabet: AB,
    regex: 'a(a|b)*',
    accept: ['a', 'aa', 'ab', 'abb', 'aba', 'abbbba'],
    reject: ['', 'b', 'ba', 'bb', 'bab'],
  },
  {
    id: 'a1-ends-b',
    level: 1,
    prompt: 'Accept every string that ends with a "b".',
    alphabet: AB,
    regex: '(a|b)*b',
    accept: ['b', 'ab', 'bb', 'aab', 'abab', 'bbb'],
    reject: ['', 'a', 'ba', 'aba', 'bba'],
    hint: 'You cannot see the future. So do not try to decide "is this the last letter?" — instead, remember what the LAST letter was, and be ready to stop at any moment.',
  },
  {
    id: 'a1-empty-only',
    level: 1,
    prompt: 'Accept only the empty string — nothing else at all.',
    alphabet: AB,
    regex: 'ε',
    accept: [''],
    reject: ['a', 'b', 'aa', 'ab'],
    note: 'The empty string is a string. It just happens to have no letters in it. A machine that accepts it is one whose start state is accepting.',
  },
  {
    id: 'a1-nothing',
    level: 1,
    prompt: 'Accept nothing at all. Not even the empty string.',
    alphabet: AB,
    regex: '∅',
    accept: [],
    reject: ['', 'a', 'b', 'ab', 'ba'],
    note: 'The empty LANGUAGE (∅) and the language containing only the empty STRING ({ε}) are different things — and telling them apart is the first sign you are thinking clearly about this.',
  },

  // --- Level 2: using states as memory -------------------------------------
  {
    id: 'a2-contains-ab',
    level: 2,
    prompt: 'Accept every string containing "ab" somewhere inside it.',
    alphabet: AB,
    regex: '(a|b)*ab(a|b)*',
    accept: ['ab', 'aab', 'abb', 'bab', 'aabb', 'babab'],
    reject: ['', 'a', 'b', 'ba', 'aa', 'bb', 'bbaa'],
    hint: 'Three states is enough: "seen nothing useful", "just saw an a", "found it — nothing can go wrong now".',
  },
  {
    id: 'a2-even-a',
    level: 2,
    prompt: 'Accept strings with an EVEN number of "a"s. (Zero counts as even.)',
    alphabet: AB,
    regex: '(b*ab*ab*)*',
    accept: ['', 'b', 'aa', 'aba', 'bbb', 'aabb', 'baab'],
    reject: ['a', 'ab', 'ba', 'aaa', 'abb'],
    hint: 'You do not need to count the a\'s. You only need to remember ONE bit: is the count so far odd or even?',
    note: 'This is the first real "aha": a machine with two states can keep track of a number that grows forever — as long as all it needs to know is the number mod 2.',
  },
  {
    id: 'a2-exactly-one-b',
    level: 2,
    prompt: 'Accept strings containing exactly one "b".',
    alphabet: AB,
    regex: 'a*ba*',
    accept: ['b', 'ab', 'ba', 'aba', 'aab', 'baa'],
    reject: ['', 'a', 'bb', 'abb', 'bab', 'aa'],
  },
  {
    id: 'a2-at-least-two-a',
    level: 2,
    prompt: 'Accept strings with at least two "a"s.',
    alphabet: AB,
    regex: 'b*ab*a(a|b)*',
    accept: ['aa', 'aba', 'baab', 'aaa', 'abba'],
    reject: ['', 'a', 'b', 'ab', 'ba', 'bbb'],
    hint: 'Count 0, 1, "2 or more". Once you are at "2 or more" you can never go back — that state is a happy trap.',
  },
  {
    id: 'a2-no-two-b',
    level: 2,
    prompt: 'Accept strings with no two "b"s next to each other.',
    alphabet: AB,
    regex: '(a|ba)*(b|ε)',
    accept: ['', 'a', 'b', 'ab', 'ba', 'aba', 'abab', 'aab'],
    reject: ['bb', 'abb', 'bba', 'abba', 'babb'],
    hint: 'Remember whether the last letter you read was a b. If it was, another b is fatal.',
  },
  {
    id: 'a2-len-div-3',
    level: 2,
    prompt: 'Accept strings whose LENGTH is a multiple of 3. (Zero is a multiple of 3.)',
    alphabet: AB,
    regex: '((a|b)(a|b)(a|b))*',
    accept: ['', 'aaa', 'abb', 'bbb', 'aaaaaa', 'ababab'],
    reject: ['a', 'ab', 'aaaa', 'abbbb'],
    note: 'Three states in a ring. The machine is a clock.',
  },

  // --- Level 3: first regexes ----------------------------------------------
  {
    id: 'a3-a-then-bs',
    level: 3,
    prompt: 'One "a", then any number of "b"s (including none).',
    alphabet: AB,
    regex: 'ab*',
    accept: ['a', 'ab', 'abb', 'abbb'],
    reject: ['', 'b', 'ba', 'aab', 'aba'],
  },
  {
    id: 'a3-any',
    level: 3,
    prompt: 'Accept absolutely every string over {a, b}, including the empty one.',
    alphabet: AB,
    regex: '(a|b)*',
    accept: ['', 'a', 'b', 'ab', 'bbaa'],
    reject: [],
    note: 'A one-state machine — accepting, with both letters looping back to itself. The simplest possible "yes".',
  },
  {
    id: 'a3-ab-repeated',
    level: 3,
    prompt: '"ab" repeated any number of times: "", "ab", "abab", "ababab", …',
    alphabet: AB,
    regex: '(ab)*',
    accept: ['', 'ab', 'abab', 'ababab'],
    reject: ['a', 'b', 'ba', 'aba', 'abb', 'abba'],
    hint: 'Careful: (ab)* is not the same as a*b*. Which strings tell them apart?',
  },
  {
    id: 'a3-as-then-bs',
    level: 3,
    prompt: 'Any number of "a"s followed by any number of "b"s. (Either count may be zero.)',
    alphabet: AB,
    regex: 'a*b*',
    accept: ['', 'a', 'b', 'aa', 'ab', 'aabbb', 'bb'],
    reject: ['ba', 'aba', 'bab', 'abab'],
    note: 'Compare with (ab)*. Same letters, wildly different languages.',
  },
  {
    id: 'a3-contains-aa-or-bb',
    level: 3,
    prompt: 'Accept strings containing "aa" or containing "bb" (or both).',
    alphabet: AB,
    regex: '(a|b)*(aa|bb)(a|b)*',
    accept: ['aa', 'bb', 'aab', 'abb', 'baab', 'aabb'],
    reject: ['', 'a', 'b', 'ab', 'ba', 'abab', 'baba'],
  },

  // --- Level 4: +, ?, ε ----------------------------------------------------
  {
    id: 'a4-one-or-more-a',
    level: 4,
    prompt: 'One or more "a"s, and nothing else.',
    alphabet: AB,
    regex: 'a+',
    accept: ['a', 'aa', 'aaa'],
    reject: ['', 'b', 'ab', 'ba'],
    hint: 'r+ means "r, at least once". It is exactly r·r*.',
  },
  {
    id: 'a4-optional-a',
    level: 4,
    prompt: 'An optional "a", then a "b". So: "b" or "ab".',
    alphabet: AB,
    regex: 'a?b',
    accept: ['b', 'ab'],
    reject: ['', 'a', 'aab', 'ba', 'bb'],
  },
  {
    id: 'a4-starts-ends-same',
    level: 4,
    prompt: 'Strings of length ≥ 1 that start and end with the SAME letter.',
    alphabet: AB,
    regex: 'a(a|b)*a|b(a|b)*b|a|b',
    accept: ['a', 'b', 'aa', 'bb', 'aba', 'bab', 'abba', 'baab'],
    reject: ['', 'ab', 'ba', 'abb', 'baa'],
    hint: 'A single letter starts and ends with itself. Do not forget those two.',
  },
  {
    id: 'a4-third-from-end-a',
    level: 4,
    prompt: 'Strings whose THIRD-FROM-LAST letter is an "a".',
    alphabet: AB,
    regex: '(a|b)*a(a|b)(a|b)',
    accept: ['aaa', 'aab', 'abb', 'aba', 'baaa', 'bbabb'],
    reject: ['', 'a', 'ab', 'aa', 'bab', 'bbb', 'bba'],
    note: 'This one is famously easy as an NFA (just guess when the a arrives) and famously annoying as a DFA — the smallest DFA needs 8 states, because it must remember the last three letters. Nondeterminism is not just convenient; it is exponentially convenient.',
  },
  {
    id: 'a4-binary-div-3',
    level: 4,
    prompt: 'Binary numbers (read left to right, most significant bit first) that are divisible by 3. Include "0". Leading zeros are allowed.',
    alphabet: BIN,
    regex: '(0|1(01*0)*1)+',
    accept: ['0', '11', '110', '1001', '00', '000', '0011', '1100'],
    reject: ['1', '10', '100', '101', '111', '1000'],
    hint: 'Three states: "remainder 0", "remainder 1", "remainder 2". Reading a bit b turns remainder r into (2r + b) mod 3. Draw that.',
    note: 'A finite machine, with three states and no arithmetic in it anywhere, doing division. This is the moment a lot of people fall in love with automata.',
  },

  // --- Level 5: nondeterminism ---------------------------------------------
  {
    id: 'a5-ends-ab-nfa',
    level: 5,
    prompt: 'Accept strings ending in "ab" — and do it with an NFA (you may use ε-moves and let a state have two arrows on the same letter).',
    alphabet: AB,
    regex: '(a|b)*ab',
    accept: ['ab', 'aab', 'bab', 'abab', 'bbab'],
    reject: ['', 'a', 'b', 'ba', 'aba', 'abb'],
    note: 'An NFA may "guess" that the ab it is looking at is the final one. If the guess can be right, the machine accepts. Guessing is free.',
  },
  {
    id: 'a5-contains-abc-or-ba',
    level: 5,
    prompt: 'Accept strings that contain "aba" or contain "bb".',
    alphabet: AB,
    regex: '(a|b)*(aba|bb)(a|b)*',
    accept: ['aba', 'bb', 'aabab', 'abb', 'babab', 'bbb'],
    reject: ['', 'a', 'b', 'ab', 'ba', 'aab', 'abab'],
    hint: 'With an NFA you can just build one machine for each pattern and let a free ε-move at the start choose between them.',
  },
  {
    id: 'a5-second-letter-b',
    level: 5,
    prompt: 'Strings of length ≥ 2 whose second letter is "b".',
    alphabet: AB,
    regex: '(a|b)b(a|b)*',
    accept: ['ab', 'bb', 'aba', 'bba', 'abab'],
    reject: ['', 'a', 'b', 'aa', 'ba', 'aab'],
  },

  // --- Level 6: machine → regex --------------------------------------------
  {
    id: 'a6-even-a-even-b',
    level: 6,
    prompt: 'Strings with an even number of "a"s AND an even number of "b"s.',
    alphabet: AB,
    regex: '(aa|bb|(ab|ba)(aa|bb)*(ab|ba))*',
    accept: ['', 'aa', 'bb', 'aabb', 'abab', 'abba', 'baab', 'aaaa'],
    reject: ['a', 'b', 'ab', 'ba', 'aab', 'abb', 'aaa'],
    note: 'Four states in a square — the machine is tracking two independent bits at once. The regex for it is ugly, and that is the point: some languages are far easier to say as a machine than as a pattern. Both are always possible; neither is always pleasant.',
  },
  {
    id: 'a6-odd-a',
    level: 6,
    prompt: 'Strings with an ODD number of "a"s.',
    alphabet: AB,
    regex: 'b*ab*(ab*ab*)*',
    accept: ['a', 'ab', 'ba', 'aaa', 'bab', 'aaab'],
    reject: ['', 'b', 'aa', 'bb', 'abab', 'aabb'],
  },
  {
    id: 'a6-not-contains-ab',
    level: 6,
    prompt: 'Strings that do NOT contain "ab" anywhere.',
    alphabet: AB,
    regex: 'b*a*',
    accept: ['', 'a', 'b', 'aa', 'bb', 'ba', 'bba', 'baa'],
    reject: ['ab', 'aab', 'abb', 'bab', 'abab'],
    hint: 'Build the machine for "contains ab" first, then swap which states are accepting. (Careful — you must fill in every missing arrow before you flip, or the trick breaks.)',
    note: 'Every string with no "ab" in it is some b\'s followed by some a\'s. Once you write an a, you can never write a b again.',
  },

  // --- Level 7: regex → machine, and minimising ----------------------------
  {
    id: 'a7-abstar-or-ba',
    level: 7,
    prompt: 'Build a machine for (ab)*ba — then shrink it to the smallest machine that still works.',
    alphabet: AB,
    regex: '(ab)*ba',
    accept: ['ba', 'abba', 'ababba'],
    reject: ['', 'a', 'b', 'ab', 'aba', 'abab', 'bab'],
  },
  {
    id: 'a7-a-or-bb-star',
    level: 7,
    prompt: 'Build a machine for (a|bb)*.',
    alphabet: AB,
    regex: '(a|bb)*',
    accept: ['', 'a', 'bb', 'abb', 'bba', 'aabb', 'bbbb'],
    reject: ['b', 'ab', 'ba', 'bbb', 'abbb'],
  },
  {
    id: 'a7-contains-aba',
    level: 7,
    prompt: 'Strings containing "aba". Build it from the regex, then minimise.',
    alphabet: AB,
    regex: '(a|b)*aba(a|b)*',
    accept: ['aba', 'aaba', 'abab', 'babab', 'ababa'],
    reject: ['', 'a', 'ab', 'ba', 'abb', 'baab', 'aabb'],
    note: "Thompson's construction will give you a machine full of ε-moves and far too many states. Determinise it, minimise it, and watch it collapse to four. Same language, a quarter of the machine.",
  },

  // --- Level 8: the wall ---------------------------------------------------
  {
    id: 'a8-anbn',
    level: 8,
    prompt: 'Accept exactly the strings aⁿbⁿ — some number of a\'s followed by the SAME number of b\'s. ("", "ab", "aabb", "aaabbb", …) Go on. Try.',
    alphabet: AB,
    // The best a finite machine can do: get the first few right and then lie.
    // The UI never grades against this — the puzzle is about failing informatively.
    regex: 'ε|ab|aabb|aaabbb|aaaabbbb',
    accept: ['', 'ab', 'aabb', 'aaabbb'],
    reject: ['a', 'b', 'ba', 'aab', 'abb', 'aabbb', 'aaabb'],
    impossible: true,
    note: 'You cannot do it, and the reason is beautiful. Your machine has some number of states — call it N. Feed it N+1 a\'s. By the pigeonhole principle it must visit some state twice, so it cannot tell two different a-counts apart. Whatever number of b\'s it then accepts, it will accept for BOTH counts. A finite machine cannot count arbitrarily high, because "arbitrarily high" needs infinitely many memories and it has only finitely many states. This is the pumping lemma, and you just proved it.',
  },
];

export const BUILD_BOARD = 'automata-regex.build';
export const REGEX_BOARD = 'automata-regex.regex';
export const CONVERT_BOARD = 'automata-regex.convert';

export const BUILD_PAR = 2600;
export const REGEX_PAR = 2400;
export const CONVERT_PAR = 1500;

export const puzzleLevel = (id: string): number =>
  LANGUAGE_PUZZLES.find((p) => p.id === id)?.level ?? 0;
