/**
 * Curated third-party material for Sets & Logic.
 *
 * The bar: would a bright, easily-bored 11-year-old actually be glad they clicked
 * it? Free and no-login unless the thing is so good it earns the exception.
 *
 * This list is maintained from `docs/research/set-theory.md` and
 * `docs/research/logic.md`, which record what was considered and — more usefully
 * — what was rejected and why.
 */
import type { Resource } from '../../core/types';

export const RESOURCES: Resource[] = [
  // --- hooks ---------------------------------------------------------------
  {
    title: 'The Banach–Tarski Paradox',
    url: 'https://www.youtube.com/watch?v=s86-Z-CbaHA',
    kind: 'video',
    role: 'hook',
    creator: 'Vsauce',
    durationMin: 24,
    cost: 'free',
    why: 'Long, and worth every minute. Cut one ball into pieces, reassemble it into two balls of the same size. It is a real theorem, and the reason it works is set theory. Watch the first ten minutes if nothing else — the "hyperwebster" section is the best explanation of infinity ever put on film.',
    concepts: ['infinite sets', 'countability'],
  },
  {
    title: "Hilbert's Infinite Hotel",
    url: 'https://www.youtube.com/watch?v=Uj3_KqkI9Zo',
    kind: 'video',
    role: 'hook',
    creator: 'TED-Ed (Jeff Dekofsky)',
    durationMin: 6,
    cost: 'free',
    why: 'A hotel with infinitely many rooms, all full, and a new guest arrives. Six minutes that make "infinity" into something you can argue about rather than something you nod at.',
    concepts: ['countable infinity', 'bijection'],
  },

  // --- core ----------------------------------------------------------------
  {
    title: 'Set Theory (full playlist)',
    url: 'https://www.youtube.com/playlist?list=PLDDGPdw7e6Ag1EIznZ-m-qXu4XX3A0cIz',
    kind: 'video-series',
    role: 'core',
    creator: 'Dr. Trefor Bazett',
    cost: 'free',
    why: 'Short, clear, notation-first videos on unions, intersections, complements and set-builder notation. Pick the two or three you need rather than watching the lot.',
    concepts: ['union', 'intersection', 'complement', 'set-builder'],
  },
  {
    title: 'Introduction to Propositional Logic',
    url: 'https://www.youtube.com/watch?v=itYkC-jJRB4',
    kind: 'video',
    role: 'core',
    creator: 'Dr. Trefor Bazett',
    durationMin: 9,
    cost: 'free',
    why: 'Truth tables, connectives, and why "or" in mathematics is not the "or" in "tea or coffee".',
    concepts: ['propositional logic', 'truth tables'],
  },
  {
    title: 'forall x: Calgary — an open logic textbook',
    url: 'https://forallx.openlogicproject.org/',
    kind: 'book',
    role: 'core',
    creator: 'Open Logic Project',
    cost: 'free',
    why: "The standard free logic textbook. Chapters 5-6 (symbolisation in sentential logic) and 13-15 (quantifiers) are exactly this lesson, done properly, with hundreds of exercises. Aimed at first-year undergraduates, so it is a stretch — but it is a stretch in the right direction, and the exercises are gold.",
    concepts: ['symbolisation', 'quantifiers', 'proof'],
  },

  // --- play ----------------------------------------------------------------
  {
    title: 'Carnap',
    url: 'https://carnap.io/',
    kind: 'tool',
    role: 'play',
    cost: 'free',
    why: 'A free, in-browser proof checker and translation exerciser. It marks your symbolisations and your natural-deduction proofs line by line. The closest thing on the internet to the game on this page, and it goes much further than we do.',
    concepts: ['symbolisation', 'natural deduction'],
  },
  {
    title: 'SET — the daily puzzle',
    url: 'https://www.setgame.com/set/puzzle',
    kind: 'game',
    role: 'play',
    cost: 'free',
    why: 'The card game SET is a pure exercise in "for all" and "there exists" wearing a disguise: a set is three cards where, for every feature, the three are all-same or all-different. Play the daily puzzle; then try to say the rule in symbols.',
    concepts: ['quantifiers', 'combinatorics'],
  },
  {
    title: 'Knights and Knaves puzzles',
    url: 'https://philosophy.hku.hk/think/logic/knights.php',
    kind: 'game',
    role: 'play',
    cost: 'free',
    why: "Smullyan's island where knights always tell the truth and knaves always lie. The purest possible workout for propositional logic, and genuinely addictive.",
    concepts: ['propositional logic', 'deduction'],
  },
  {
    title: 'Baba Is You',
    url: 'https://hempuli.com/baba/',
    kind: 'game',
    role: 'play',
    cost: 'paid',
    why: 'A puzzle game where the rules of the game are objects on the level, and you win by rewriting them. It is not marketed as a logic game and it is the best one ever made. Worth the money.',
    concepts: ['rules as objects', 'formal systems'],
  },

  // --- practice ------------------------------------------------------------
  {
    title: 'Brilliant — Logic',
    url: 'https://brilliant.org/courses/logic-deduction/',
    kind: 'course',
    role: 'practice',
    cost: 'freemium',
    why: 'Well-made interactive logic puzzles with a gentle difficulty curve. The free tier gives you enough to see whether it clicks.',
    concepts: ['deduction', 'logic puzzles'],
  },
  {
    title: 'Logic grid puzzles',
    url: 'https://www.brainzilla.com/logic/logic-grid/',
    kind: 'exercise-bank',
    role: 'practice',
    cost: 'free',
    why: 'The classic "the person in the red house owns the fish" puzzles. Every one is a constraint-satisfaction problem, and solving them by hand is exactly the reasoning a SAT solver does mechanically.',
    concepts: ['constraint satisfaction', 'deduction'],
  },

  // --- stretch -------------------------------------------------------------
  {
    title: "Cantor's Infinities",
    url: 'https://www.youtube.com/watch?v=elvOZm0d4H0',
    kind: 'video',
    role: 'stretch',
    creator: 'Numberphile / Zoe Griffiths',
    durationMin: 8,
    cost: 'free',
    why: 'Some infinities are bigger than others, and the diagonal argument that proves it is short enough to follow completely and strange enough to keep you up at night.',
    concepts: ['diagonalisation', 'uncountability'],
  },
  {
    title: "Russell's Paradox",
    url: 'https://www.youtube.com/watch?v=xauCQpnbNAM',
    kind: 'video',
    role: 'stretch',
    creator: 'Up and Atom',
    durationMin: 9,
    cost: 'free',
    why: 'Does the set of all sets that do not contain themselves contain itself? Either answer is wrong. This single question broke mathematics for a decade, and it is a question a twelve-year-old can fully understand.',
    concepts: ['self-reference', 'paradox', 'axioms'],
  },
  {
    title: 'Mathigon — Polypad & courses',
    url: 'https://mathigon.org/',
    kind: 'interactive',
    role: 'reference',
    cost: 'free',
    why: 'The best interactive mathematics textbook on the internet, and an obvious model for what this site wants to be when it grows up. Their logic and set-theory material is excellent.',
    concepts: ['everything'],
  },
];
