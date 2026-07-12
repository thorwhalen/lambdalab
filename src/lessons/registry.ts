/**
 * The course map.
 *
 * Every module in the curriculum lives here, whether it is built yet or not:
 * a course you can see the shape of is a course you can want. `status: 'planned'`
 * modules render as ghosts on the map — visible, unclickable, honest.
 *
 * The dependency edges (`prerequisites`) are real: the map is drawn from them,
 * and they are the argument for the ordering. Where the order is arbitrary we
 * say so rather than inventing a dependency to justify it.
 */
import type { ComponentType } from 'react';
import type { Lesson } from '../core/types';
import { setLogicLesson, SetLogicPage } from './set-logic';
import { automataLesson, AutomataPage } from './automata-regex';

export interface Unit {
  id: string;
  title: string;
  tagline: string;
  /** Tailwind colour family; see src/styles.css @theme. */
  accent: 'lam' | 'mach' | 'crypt' | 'info' | 'hard';
}

export const UNITS: Unit[] = [
  {
    id: 'foundations',
    title: 'Foundations',
    tagline: 'The language mathematics is written in — and how to read it out loud.',
    accent: 'lam',
  },
  {
    id: 'machines',
    title: 'Machines',
    tagline: 'What is a computer, really? Build the simplest ones and find their edges.',
    accent: 'mach',
  },
  {
    id: 'secrets',
    title: 'Secrets',
    tagline: 'Prove you know something without saying what it is.',
    accent: 'crypt',
  },
  {
    id: 'information',
    title: 'Information',
    tagline: 'How much is a message worth, and how little can you get away with sending?',
    accent: 'info',
  },
  {
    id: 'limits',
    title: 'Limits',
    tagline: 'Things no computer can ever do. Not slow — impossible.',
    accent: 'hard',
  },
];

/** Modules with no page yet. They exist on the map so the road ahead is visible. */
const PLANNED: Lesson[] = [
  {
    id: 'proof',
    unit: 'foundations',
    title: 'Proof',
    subtitle: 'Induction, contradiction, and the pigeonhole principle',
    blurb:
      'How do you become *certain*? Knock over an infinite line of dominoes. Prove something is impossible without checking every case. Show that two people in London have exactly the same number of hairs on their head — without meeting anyone.',
    status: 'planned',
    prerequisites: ['set-logic'],
    ladder: [],
    resources: [],
    glyph: '∴',
  },
  {
    id: 'counting',
    unit: 'foundations',
    title: 'Counting & Chance',
    subtitle: 'Combinatorics and probability',
    blurb:
      'Count things too numerous to count. Then discover that your intuition about chance is a liar, and meet the Monty Hall problem, the birthday paradox, and the reason casinos are rich.',
    status: 'planned',
    prerequisites: ['set-logic'],
    ladder: [],
    resources: [],
    glyph: 'ⁿCᵣ',
  },
  {
    id: 'formal-languages',
    unit: 'machines',
    title: 'Formal Languages',
    subtitle: 'Alphabets, strings, grammars and the Chomsky hierarchy',
    blurb:
      'A language is just a set of strings. Write down rules that generate infinitely many sentences — then discover that English, arithmetic and your favourite programming language are all built this way.',
    status: 'planned',
    prerequisites: ['set-logic'],
    ladder: [],
    resources: [],
    glyph: 'Σ*',
  },
  {
    id: 'pushdown',
    unit: 'machines',
    title: 'Stacks & Grammars',
    subtitle: 'Pushdown automata and context-free languages',
    blurb:
      'Give the machine a stack — a pile of notes it can only read from the top — and suddenly it can match brackets, parse arithmetic, and do things no finite automaton ever could.',
    status: 'planned',
    prerequisites: ['automata-regex', 'formal-languages'],
    ladder: [],
    resources: [],
    glyph: '⟨⟩',
  },
  {
    id: 'turing',
    unit: 'machines',
    title: 'Turing Machines',
    subtitle: 'The simplest thing that can compute anything',
    blurb:
      'A tape, a head, and a handful of rules. That is the whole machine — and it can run any program that has ever been written or ever will be. Build one. Then build one that runs other ones.',
    status: 'planned',
    prerequisites: ['pushdown'],
    ladder: [],
    resources: [],
    glyph: '⊢',
  },
  {
    id: 'lambda',
    unit: 'machines',
    title: 'Lambda Calculus',
    subtitle: 'Computation with nothing but functions',
    blurb:
      'No numbers. No loops. No if-statements. Nothing but functions that take functions and return functions — and yet it computes everything a Turing machine can. Build the number 3 out of pure verbs.',
    status: 'planned',
    prerequisites: ['turing'],
    ladder: [],
    resources: [],
    glyph: 'λ',
  },
  {
    id: 'number-theory',
    unit: 'secrets',
    title: 'Clock Arithmetic',
    subtitle: 'Primes, modular arithmetic and the Euclidean algorithm',
    blurb:
      'What time is it 100 hours from now? The maths of wrapping around is the maths that keeps your messages secret. Also: prime numbers, and why cicadas count in them.',
    status: 'planned',
    prerequisites: ['proof'],
    ladder: [],
    resources: [],
    glyph: 'mod',
  },
  {
    id: 'crypto',
    unit: 'secrets',
    title: 'Cryptography',
    subtitle: 'From Caesar to public keys',
    blurb:
      'Break a cipher with nothing but a letter-frequency chart. Then meet the astonishing trick that lets two people who have never met agree on a secret, in public, while you listen to every word.',
    status: 'planned',
    prerequisites: ['number-theory'],
    ladder: [],
    resources: [],
    glyph: '🔑',
  },
  {
    id: 'zkp',
    unit: 'secrets',
    title: 'Zero-Knowledge Proofs',
    subtitle: 'Prove you know a secret, without revealing it',
    blurb:
      "Convince someone you know where Waldo is — completely, beyond doubt — without telling them anything at all about where Waldo is. It sounds impossible. It isn't, and you'll do it.",
    status: 'planned',
    prerequisites: ['crypto', 'counting'],
    ladder: [],
    resources: [],
    glyph: '🤐',
  },
  {
    id: 'circuits',
    unit: 'information',
    title: 'Logic Circuits',
    subtitle: 'From true/false to a working adder',
    blurb:
      'The AND, OR and NOT you met in the logic lesson turn out to be *objects*. Wire them together and build a machine that adds. Everything in the device you are reading this on is made of these.',
    status: 'planned',
    prerequisites: ['set-logic'],
    ladder: [],
    resources: [],
    glyph: '⊕',
  },
  {
    id: 'information-theory',
    unit: 'information',
    title: 'Information & Compression',
    subtitle: 'Entropy, Huffman coding, and the limits of squeezing',
    blurb:
      'How much *information* is in a message? Shannon found the number. It tells you exactly how far a file can be compressed — and proves that a perfect compressor for everything cannot exist.',
    status: 'planned',
    prerequisites: ['counting'],
    ladder: [],
    resources: [],
    glyph: 'H',
  },
  {
    id: 'error-correction',
    unit: 'information',
    title: 'Error Correction',
    subtitle: 'Messages that repair themselves',
    blurb:
      'Send a message through a channel that flips bits at random — and have it arrive perfectly anyway. Also, a card trick that finds the one card someone flipped while you were out of the room.',
    status: 'planned',
    prerequisites: ['information-theory'],
    ladder: [],
    resources: [],
    glyph: '⊞',
  },
  {
    id: 'graphs',
    unit: 'information',
    title: 'Graphs',
    subtitle: 'Dots, lines, and almost every problem in computer science',
    blurb:
      "Can you walk every bridge in a city exactly once? Euler answered that in 1736 and accidentally invented the most useful idea in computing. Colour maps, find shortest paths, untangle knots.",
    status: 'planned',
    prerequisites: ['set-logic'],
    ladder: [],
    resources: [],
    glyph: '⋈',
  },
  {
    id: 'complexity',
    unit: 'limits',
    title: 'Hard Problems',
    subtitle: 'Big-O, NP-completeness, and the million-dollar question',
    blurb:
      'Some problems are easy to check but seem impossible to solve. Nobody knows whether that is really true — and there is a million dollars waiting for whoever finds out. This is P vs NP.',
    status: 'planned',
    prerequisites: ['graphs', 'turing'],
    ladder: [],
    resources: [],
    glyph: 'O(n)',
  },
  {
    id: 'halting',
    unit: 'limits',
    title: 'The Halting Problem',
    subtitle: 'A question no program can ever answer',
    blurb:
      'Write a program that reads any other program and says whether it will ever stop. Turing proved you cannot — and the proof is a beautiful, devious trick you will be able to follow completely.',
    status: 'planned',
    prerequisites: ['turing'],
    ladder: [],
    resources: [],
    glyph: '↯',
  },
  {
    id: 'godel',
    unit: 'limits',
    title: 'Gödel & Self-Reference',
    subtitle: 'This sentence is not provable',
    blurb:
      'Mathematics tried to prove itself complete and consistent. Gödel showed it can never be both. The proof is a sentence that talks about itself — the strangest loop there is.',
    status: 'planned',
    prerequisites: ['halting'],
    ladder: [],
    resources: [],
    glyph: '⌜⌝',
  },
];

export interface LessonEntry {
  meta: Lesson;
  Page?: ComponentType;
}

export const LESSONS: LessonEntry[] = [
  { meta: setLogicLesson, Page: SetLogicPage },
  { meta: automataLesson, Page: AutomataPage },
  ...PLANNED.map((meta) => ({ meta })),
];

export const lessonById = (id: string): LessonEntry | undefined =>
  LESSONS.find((l) => l.meta.id === id);

export const lessonsInUnit = (unitId: string): LessonEntry[] =>
  LESSONS.filter((l) => l.meta.unit === unitId);

export const unitById = (id: string): Unit | undefined => UNITS.find((u) => u.id === id);
