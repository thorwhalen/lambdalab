/**
 * Curated third-party material for Automata & Regex.
 *
 * Maintained from `docs/research/automata-regex.md`, which records what was
 * considered and rejected as well as what made it here.
 */
import type { Resource } from '../../core/types';

export const RESOURCES: Resource[] = [
  // --- hooks ---------------------------------------------------------------
  {
    title: 'Regular Languages: Deterministic Finite Automaton (DFA)',
    url: 'https://www.youtube.com/watch?v=PK3wL7DXuuw',
    kind: 'video',
    role: 'hook',
    creator: 'lydia',
    cost: 'free',
    why: 'The machine before the notation: what a DFA is, drawn and run on strings, with nothing assumed. Watch this one first — the rest of the shelf answers questions it puts in your head.',
    concepts: ['DFA', 'states', 'transitions', 'acceptance'],
  },
  {
    title: 'Regular Expressions (Regexp) Basics',
    url: 'https://www.youtube.com/watch?v=528Jc3q86F8',
    kind: 'video',
    role: 'hook',
    creator: 'Computerphile',
    durationMin: 12,
    cost: 'free',
    why: 'Why regexes exist and what they are really for, from someone who is visibly delighted by them.',
    concepts: ['regular expressions'],
  },

  // --- core ----------------------------------------------------------------
  {
    title: 'Finite State Machine (playlist)',
    url: 'https://www.youtube.com/playlist?list=PLBlnK6fEyqRgp46KUv4ZY69yXmpwKOIev',
    kind: 'video-series',
    role: 'core',
    creator: 'Neso Academy',
    cost: 'free',
    why: 'The standard undergraduate treatment, in short digestible pieces: DFA, NFA, ε-NFA, subset construction, minimisation. Dry but genuinely clear, and complete. Dip in for the topic you are stuck on rather than watching it all.',
    concepts: ['DFA', 'NFA', 'subset construction', 'minimisation'],
  },
  {
    title: "Kleene's Theorem — regular expressions and finite automata",
    url: 'https://www.youtube.com/watch?v=eaU8Ns5PS2c',
    kind: 'video',
    role: 'core',
    creator: 'Easy Theory',
    durationMin: 11,
    cost: 'free',
    why: 'The proof that machines and patterns describe exactly the same languages — the theorem this whole lesson is built around.',
    concepts: ["Kleene's theorem", 'state elimination'],
  },

  // --- play ----------------------------------------------------------------
  {
    title: 'Regex Crossword',
    url: 'https://regexcrossword.com/',
    kind: 'game',
    role: 'play',
    cost: 'free',
    why: 'A crossword where the clues are regular expressions and the answers must satisfy them in both directions at once. Starts gentle, becomes genuinely fiendish. The single best regex practice on the internet.',
    concepts: ['regular expressions'],
  },
  {
    title: 'Regex Golf',
    url: 'https://alf.nu/RegexGolf',
    kind: 'game',
    role: 'play',
    cost: 'free',
    why: 'Match every string in one list, none in the other, using the shortest possible pattern. This is exactly our RegexLab with a leaderboard and no mercy.',
    concepts: ['regular expressions', 'minimality'],
  },
  {
    title: 'Finite State Machine Designer',
    url: 'https://madebyevan.com/fsm/',
    kind: 'tool',
    role: 'play',
    creator: 'Evan Wallace',
    cost: 'free',
    why: 'The nicest little automaton drawing tool ever made — double-click for a state, drag for an arrow, and it exports LaTeX. Worth knowing about for when you want to draw a machine for someone else.',
    concepts: ['DFA', 'NFA'],
  },
  {
    title: 'regex101',
    url: 'https://regex101.com/',
    kind: 'tool',
    role: 'play',
    cost: 'free',
    why: 'The regex debugger every programmer actually uses. It explains, token by token, what your pattern is doing. Note that it speaks the *programming* dialect — with backreferences and lookahead, which take you outside the regular languages entirely. Worth understanding why.',
    concepts: ['regular expressions'],
  },
  {
    title: 'JFLAP',
    url: 'https://www.jflap.org/',
    kind: 'tool',
    role: 'play',
    cost: 'free',
    why: 'The classic desktop automata sandbox used in university courses everywhere. Build DFAs, NFAs, pushdown automata and Turing machines, and run every conversion algorithm step by step. It is a Java download and it looks like 2003, and it is still the most capable thing of its kind.',
    concepts: ['DFA', 'NFA', 'PDA', 'Turing machines'],
  },

  // --- practice ------------------------------------------------------------
  {
    title: 'Automata Tutor',
    url: 'https://automata-tutor.model.in.tum.de/',
    kind: 'exercise-bank',
    role: 'practice',
    cost: 'free-with-account',
    why: 'A university tool that sets automaton-design problems and grades them automatically — including telling you which strings your machine gets wrong. It does what our builder does, with a much larger problem bank.',
    concepts: ['DFA design', 'NFA', 'regex'],
  },
  {
    title: 'RegexLearn — step by step',
    url: 'https://regexlearn.com/learn',
    kind: 'exercise-bank',
    role: 'practice',
    cost: 'free',
    why: 'An interactive, incremental regex tutorial. Well-paced, and free.',
    concepts: ['regular expressions'],
  },

  // --- stretch -------------------------------------------------------------
  {
    title: 'The Pumping Lemma',
    url: 'https://www.youtube.com/watch?v=DoDh9Wh1H2c',
    kind: 'video',
    role: 'stretch',
    creator: 'Easy Theory',
    durationMin: 13,
    cost: 'free',
    why: 'The formal version of the argument you meet at level 8: the precise reason aⁿbⁿ is beyond any finite machine. Watch it *after* you have failed to build the machine yourself — it will land completely differently.',
    concepts: ['pumping lemma', 'non-regular languages'],
  },
  {
    title: 'Regular Expression Matching Can Be Simple And Fast',
    url: 'https://swtch.com/~rsc/regexp/regexp1.html',
    kind: 'article',
    role: 'stretch',
    creator: 'Russ Cox',
    cost: 'free',
    why: "The famous essay showing that the regex engines in Perl, Python and Java can take *longer than the age of the universe* on a pattern 30 characters long — while Thompson's 1968 construction (the one in this lesson) handles it instantly. Real, current, and a lovely reward for having learned the theory properly.",
    concepts: ["Thompson's construction", 'complexity'],
  },
  {
    title: 'Turing Complete',
    url: 'https://store.steampowered.com/app/1444480/Turing_Complete/',
    kind: 'game',
    role: 'stretch',
    cost: 'paid',
    why: 'Build a working CPU from NAND gates upward, then program it. Not automata theory exactly, but the same pleasure — machines made of nothing, doing everything. If the state-machine puzzles here landed, this is the next thing.',
    concepts: ['circuits', 'computation'],
  },
];
