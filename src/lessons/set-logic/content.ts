/**
 * Sets & Logic — the ladder, the tile palette, and the puzzle bank.
 *
 * THE CENTRAL DESIGN DECISION, and the reason this lesson can teach the thing it
 * is trying to teach:
 *
 *   **Every distractor is authored as a wrong FORMULA, never as wrong English.**
 *
 * A distractor is a formalisation a learner might plausibly reach — `∀x (Dog(x) ∧
 * Red(x))` when they meant "every dog is red". We store the formula; its English
 * reading is what we *show*. Two things fall out for free:
 *
 *   1. When a learner picks a wrong option, we run the engine's model checker
 *      between their choice and the reference and hand them the tiny world in
 *      which the two come apart. "In this world, every dog IS red. But your
 *      sentence says everything is a dog — and look, `b` isn't." That is a
 *      *proof* that they were wrong, not an assertion.
 *   2. A test can assert mechanically that no distractor is accidentally
 *      equivalent to the answer. (`content.test.ts` does exactly that, for all
 *      of them, on every run. Authoring logic puzzles by hand without that check
 *      is how wrong mathematics gets taught to children.)
 *
 * The `trap` field names the misconception each puzzle exercises, so the ladder
 * can be read as a catalogue of the ways people go wrong — which is, more or
 * less, what learning logic consists of.
 */
import type { Level, PuzzleBase } from '../../core/types';
import type { Signature, Tile } from '../../lib/logic/types';

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

export const LADDER: Level[] = [
  {
    n: 1,
    name: 'Things and sets',
    goal: 'Say that a thing belongs to a collection.',
    unlocks: ['∈', '∉'],
    toAdvance: 3,
  },
  {
    n: 2,
    name: 'And, or, not',
    goal: 'Combine facts, and deny them.',
    unlocks: ['∧', '∨', '¬', '( )'],
    toAdvance: 3,
  },
  {
    n: 3,
    name: 'Building new sets',
    goal: 'Make new collections out of old ones — and notice you now have two ways to say the same thing.',
    unlocks: ['∩', '∪', 'ᶜ', '∖', '∅', '𝕌'],
    toAdvance: 4,
  },
  {
    n: 4,
    name: 'If… then',
    goal: 'Say "every A is a B" — and meet the single most common mistake in all of logic.',
    unlocks: ['→', '↔', '⊆'],
    toAdvance: 4,
  },
  {
    n: 5,
    name: 'For all, there exists',
    goal: 'Talk about every thing, or some thing, without naming any of them.',
    unlocks: ['∀', '∃', 'x', 'y'],
    toAdvance: 4,
  },
  {
    n: 6,
    name: 'The two patterns',
    goal: '∀ goes with →. ∃ goes with ∧. Get this the wrong way round and you say something wild.',
    unlocks: ['=', '≠'],
    toAdvance: 4,
  },
  {
    n: 7,
    name: 'Order matters',
    goal: 'Relations between things — and why ∀x∃y and ∃y∀x are not the same sentence at all.',
    unlocks: ['relations', 'nested ∀∃'],
    toAdvance: 4,
  },
  {
    n: 8,
    name: 'Exactly one',
    goal: 'Uniqueness, and writing a set by describing it rather than listing it.',
    unlocks: ['∃!', '{ x | … }'],
    toAdvance: 3,
  },
];

export const MAX_LEVEL = LADDER.length;

// ---------------------------------------------------------------------------
// The palette
// ---------------------------------------------------------------------------

/**
 * Structural tiles — the ones that are the same in every puzzle. Set and
 * relation names are puzzle-specific and get added by `paletteFor` below, so a
 * puzzle about dogs offers a `Dog` tile and a puzzle about numbers does not.
 */
export const STRUCTURAL_TILES: Tile[] = [
  { id: 'in', kind: 'op', glyph: '∈', gloss: 'is in / is a', token: '∈', level: 1 },
  { id: 'notin', kind: 'op', glyph: '∉', gloss: 'is not in / is not a', token: '∉', level: 1 },

  { id: 'and', kind: 'op', glyph: '∧', gloss: 'and — both are true', token: '∧', level: 2 },
  { id: 'or', kind: 'op', glyph: '∨', gloss: 'or — at least one is true', token: '∨', level: 2 },
  { id: 'not', kind: 'op', glyph: '¬', gloss: 'not — it is false that…', token: '¬', level: 2 },
  { id: 'lpar', kind: 'paren', glyph: '(', gloss: 'open bracket', token: '(', level: 2 },
  { id: 'rpar', kind: 'paren', glyph: ')', gloss: 'close bracket', token: ')', level: 2 },

  { id: 'inter', kind: 'op', glyph: '∩', gloss: 'intersection — the things in BOTH', token: '∩', level: 3 },
  { id: 'union', kind: 'op', glyph: '∪', gloss: 'union — the things in EITHER', token: '∪', level: 3 },
  { id: 'compl', kind: 'op', glyph: 'ᶜ', gloss: 'complement — everything NOT in it', token: 'ᶜ', level: 3 },
  { id: 'diff', kind: 'op', glyph: '∖', gloss: 'minus — in the first but not the second', token: '∖', level: 3 },
  { id: 'empty', kind: 'op', glyph: '∅', gloss: 'the empty set — nothing is in it', token: '∅', level: 3 },
  { id: 'univ', kind: 'op', glyph: '𝕌', gloss: 'the universe — everything there is', token: '𝕌', level: 3 },

  { id: 'implies', kind: 'op', glyph: '→', gloss: 'if … then …', token: '→', level: 4 },
  { id: 'iff', kind: 'op', glyph: '↔', gloss: 'if and only if — both directions', token: '↔', level: 4 },
  { id: 'subset', kind: 'op', glyph: '⊆', gloss: 'is a subset of — every one of these is one of those', token: '⊆', level: 4 },

  { id: 'forall', kind: 'quantifier', glyph: '∀', gloss: 'for every thing…', token: '∀', level: 5 },
  { id: 'exists', kind: 'quantifier', glyph: '∃', gloss: 'there is at least one thing…', token: '∃', level: 5 },
  { id: 'x', kind: 'var', glyph: 'x', gloss: 'a thing (any thing)', token: 'x', level: 5 },
  { id: 'y', kind: 'var', glyph: 'y', gloss: 'another thing', token: 'y', level: 5 },

  { id: 'eq', kind: 'op', glyph: '=', gloss: 'is the very same thing as', token: '=', level: 6 },
  { id: 'neq', kind: 'op', glyph: '≠', gloss: 'is not the same thing as', token: '≠', level: 6 },

  { id: 'exists1', kind: 'quantifier', glyph: '∃!', gloss: 'there is exactly one thing…', token: '∃!', level: 8 },
  { id: 'lbrace', kind: 'paren', glyph: '{', gloss: 'open a set-builder', token: '{', level: 8 },
  { id: 'bar', kind: 'paren', glyph: '|', gloss: 'such that', token: '|', level: 8 },
  { id: 'rbrace', kind: 'paren', glyph: '}', gloss: 'close the set-builder', token: '}', level: 8 },
];

/** Structural tiles up to `level`, plus this puzzle's own set/relation/constant names. */
export function paletteFor(sig: Signature, level: number): Tile[] {
  const named: Tile[] = [
    ...sig.sets.map((s) => ({
      id: `set-${s}`,
      kind: 'set' as const,
      glyph: s,
      gloss: `the set of ${s} things`,
      token: s,
      level: 1,
    })),
    ...sig.relations.map((r) => ({
      id: `rel-${r}`,
      kind: 'relation' as const,
      glyph: r,
      gloss: `the relation ${r}`,
      token: r,
      level: 7,
    })),
    ...sig.constants.map((c) => ({
      id: `const-${c}`,
      kind: 'const' as const,
      glyph: c,
      gloss: `a particular thing called ${c}`,
      token: c,
      level: 1,
    })),
    // A relation needs its own brackets and comma; they arrive with relations.
    { id: 'comma', kind: 'paren' as const, glyph: ',', gloss: 'and then', token: ',', level: 7 },
  ];
  return [...STRUCTURAL_TILES, ...named].filter((t) => t.level <= level);
}

// ---------------------------------------------------------------------------
// Puzzles
// ---------------------------------------------------------------------------

export interface Distractor {
  /** A formalisation a learner might plausibly reach. Wrong, but not stupid. */
  formal: string;
  /** Its honest English reading — this is what the learner sees as an option. */
  english: string;
  /** Why someone lands here. Shown *after* they have seen the counter-world. */
  because: string;
}

export interface TranslatePuzzle extends PuzzleBase {
  sig: Signature;
  /** Pretty words for the set names, so glosses read like English. */
  nouns?: Record<string, { singular: string; plural: string }>;
  /** The reference formalisation. Parsed with `sig`. */
  formal: string;
  /** The English sentence. Both directions of the game use it. */
  english: string;
  /** Wrong formalisations. Never fewer than two, or the multiple choice is a coin toss. */
  distractors: Distractor[];
  /** The misconception this puzzle exists to provoke, if any. */
  trap?: string;
}

const CREATURES: Signature = { sets: ['Dog', 'Red'], relations: [], constants: [] };
const CREATURES_NOUNS = {
  Dog: { singular: 'a dog', plural: 'dogs' },
  Red: { singular: 'red', plural: 'red things' },
};

const REX: Signature = { sets: ['Dog', 'Red'], relations: [], constants: ['rex'] };
const THREE: Signature = { sets: ['A', 'B', 'C'], relations: [], constants: [] };
const FRIENDS: Signature = { sets: ['Kid'], relations: ['Likes'], constants: ['sam'] };
const PETS: Signature = { sets: ['Cat', 'Fluffy'], relations: [], constants: ['mo'] };

/**
 * The bank. Ordered by level; `content.test.ts` verifies every one of them
 * parses, and that no distractor is secretly equivalent to its answer.
 */
export const TRANSLATE_PUZZLES: TranslatePuzzle[] = [
  // --- Level 1: membership ------------------------------------------------
  {
    id: 't1-rex-dog',
    level: 1,
    prompt: 'Rex is a dog.',
    english: 'Rex is a dog.',
    formal: 'rex ∈ Dog',
    sig: REX,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: 'rex ∉ Dog', english: 'Rex is not a dog.', because: '∉ is the crossed-out ∈ — it says the opposite.' },
      { formal: 'rex ∈ Red', english: 'Rex is red.', because: 'That is a different set.' },
    ],
  },
  {
    id: 't1-rex-notred',
    level: 1,
    prompt: 'Rex is not red.',
    english: 'Rex is not red.',
    formal: 'rex ∉ Red',
    sig: REX,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: 'rex ∈ Red', english: 'Rex is red.', because: 'You dropped the "not".' },
      { formal: 'rex ∉ Dog', english: 'Rex is not a dog.', because: 'Right shape, wrong set.' },
    ],
  },
  {
    id: 't1-mo-cat',
    level: 1,
    prompt: 'Mo is a cat.',
    english: 'Mo is a cat.',
    formal: 'mo ∈ Cat',
    sig: PETS,
    distractors: [
      { formal: 'mo ∉ Cat', english: 'Mo is not a cat.', because: 'The bar through ∈ means "not".' },
      { formal: 'mo ∈ Fluffy', english: 'Mo is fluffy.', because: 'Wrong set.' },
    ],
  },
  {
    id: 't1-mo-notfluffy',
    level: 1,
    prompt: 'Mo is not fluffy.',
    english: 'Mo is not fluffy.',
    formal: 'mo ∉ Fluffy',
    sig: PETS,
    distractors: [
      { formal: 'mo ∈ Fluffy', english: 'Mo is fluffy.', because: 'The "not" vanished.' },
      { formal: 'mo ∉ Cat', english: 'Mo is not a cat.', because: 'Wrong set.' },
    ],
  },

  // --- Level 2: connectives ------------------------------------------------
  {
    id: 't2-rex-dog-and-red',
    level: 2,
    prompt: 'Rex is a red dog.',
    english: 'Rex is a dog and Rex is red.',
    formal: 'rex ∈ Dog ∧ rex ∈ Red',
    sig: REX,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: 'rex ∈ Dog ∨ rex ∈ Red', english: 'Rex is a dog, or Rex is red (or both).', because: '"A red dog" claims BOTH things at once. ∨ only claims at least one.' },
      { formal: 'rex ∈ Dog ∧ rex ∉ Red', english: 'Rex is a dog and Rex is not red.', because: 'A stray negation.' },
    ],
    trap: 'and-vs-or',
  },
  {
    id: 't2-rex-either',
    level: 2,
    prompt: 'Rex is a dog, or Rex is red — possibly both.',
    english: 'Rex is a dog or Rex is red.',
    formal: 'rex ∈ Dog ∨ rex ∈ Red',
    sig: REX,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: 'rex ∈ Dog ∧ rex ∈ Red', english: 'Rex is a dog and Rex is red.', because: '∧ demands both. The sentence only demands one.' },
      { formal: '¬ ( rex ∈ Dog ∧ rex ∈ Red )', english: 'It is not the case that Rex is both a dog and red.', because: 'That rules out the "both" case, which the sentence explicitly allows.' },
    ],
    trap: 'inclusive-or',
  },
  {
    id: 't2-not-both',
    level: 2,
    prompt: 'Rex is not both a dog and red.',
    english: 'It is not the case that Rex is a dog and Rex is red.',
    formal: '¬ ( rex ∈ Dog ∧ rex ∈ Red )',
    sig: REX,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: 'rex ∉ Dog ∧ rex ∉ Red', english: 'Rex is not a dog and Rex is not red.', because: 'This is the classic De Morgan slip. "Not both" still allows Rex to be one of the two. "Neither" does not.' },
      { formal: 'rex ∉ Dog', english: 'Rex is not a dog.', because: '"Not both" does not tell you WHICH one fails — only that they do not both hold.' },
    ],
    trap: 'de-morgan',
    hint: 'The "not" applies to the whole sentence, not to each half. (And once you have it: ¬(P ∧ Q) turns out to equal ¬P ∨ ¬Q. Check it in a few little worlds.)',
  },
  {
    id: 't2-neither',
    level: 2,
    prompt: 'Rex is neither a dog nor red.',
    english: 'Rex is not a dog and Rex is not red.',
    formal: 'rex ∉ Dog ∧ rex ∉ Red',
    sig: REX,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: '¬ ( rex ∈ Dog ∧ rex ∈ Red )', english: 'It is not the case that Rex is both a dog and red.', because: '"Neither" is much stronger: it rules out both individually.' },
      { formal: 'rex ∉ Dog ∨ rex ∉ Red', english: 'Rex is not a dog, or Rex is not red.', because: '"Nor" means BOTH denials hold, not just one.' },
    ],
    trap: 'neither-nor',
  },

  // --- Level 3: set operations --------------------------------------------
  {
    id: 't3-inter',
    level: 3,
    prompt: 'Rex is in both A and B. (Say it with ∩ — a single set.)',
    english: 'Rex is in the intersection of A and B.',
    formal: 'rex ∈ ( A ∩ B )',
    sig: THREE,
    distractors: [
      { formal: 'rex ∈ ( A ∪ B )', english: 'Rex is in A or in B.', because: '∪ is "either". ∩ is "both".' },
      { formal: 'rex ∈ ( A ∖ B )', english: 'Rex is in A but not in B.', because: '∖ takes B away.' },
    ],
    hint: 'x ∈ A ∩ B says exactly the same thing as x ∈ A ∧ x ∈ B. Two spellings, one fact.',
  },
  {
    id: 't3-diff',
    level: 3,
    prompt: 'Rex is in A but not in B.',
    english: 'Rex is in A minus B.',
    formal: 'rex ∈ ( A ∖ B )',
    sig: THREE,
    distractors: [
      { formal: 'rex ∈ ( A ∩ B )', english: 'Rex is in both A and B.', because: 'That is the opposite about B.' },
      { formal: 'rex ∈ ( B ∖ A )', english: 'Rex is in B but not in A.', because: 'Order matters for ∖ — unlike ∩ and ∪.' },
    ],
    trap: 'difference-is-not-symmetric',
  },
  {
    id: 't3-compl',
    level: 3,
    prompt: 'Rex is not in A.  (Say it with a complement.)',
    english: 'Rex is in the complement of A.',
    formal: 'rex ∈ Aᶜ',
    sig: THREE,
    distractors: [
      { formal: 'rex ∈ A', english: 'Rex is in A.', because: 'The little c means "everything outside".' },
      { formal: 'rex ∈ ( A ∖ B )', english: 'Rex is in A but not B.', because: 'That still puts Rex inside A.' },
    ],
    hint: 'x ∈ Aᶜ and x ∉ A say the same thing.',
  },
  {
    id: 't3-demorgan-sets',
    level: 3,
    prompt: 'Rex is outside A and outside B.  (Use a complement of a union.)',
    english: 'Rex is in the complement of (A union B).',
    formal: 'rex ∈ ( A ∪ B )ᶜ',
    sig: THREE,
    distractors: [
      { formal: 'rex ∈ ( A ∩ B )ᶜ', english: 'Rex is not in both A and B.', because: 'De Morgan again, in set clothing: (A∪B)ᶜ = Aᶜ∩Bᶜ, but (A∩B)ᶜ = Aᶜ∪Bᶜ — a much weaker claim.' },
      { formal: 'rex ∈ ( Aᶜ ∪ Bᶜ )', english: 'Rex is outside A, or outside B.', because: 'Same slip: "outside both" is an ∩ of complements, not a ∪.' },
    ],
    trap: 'de-morgan-sets',
  },
  {
    id: 't3-empty',
    level: 3,
    prompt: 'Rex is in the empty set. (It is false, of course — but how do you write it?)',
    english: 'Rex is in the empty set.',
    formal: 'rex ∈ ∅',
    sig: THREE,
    distractors: [
      { formal: 'rex ∈ 𝕌', english: 'Rex is in the universe.', because: '𝕌 holds everything; ∅ holds nothing. They are opposites.' },
      { formal: 'rex ∉ ∅', english: 'Rex is not in the empty set.', because: 'This one is always TRUE — nothing is in ∅. We asked for the always-false one.' },
    ],
  },

  // --- Level 4: implication — THE trap -------------------------------------
  {
    id: 't4-subset',
    level: 4,
    prompt: 'Every dog is red.  (Say it with ⊆.)',
    english: 'The set of dogs is a subset of the set of red things.',
    formal: 'Dog ⊆ Red',
    sig: CREATURES,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: 'Red ⊆ Dog', english: 'Every red thing is a dog.', because: 'Backwards. "Every dog is red" leaves room for red buses; "every red thing is a dog" does not.' },
      { formal: 'Dog = Red', english: 'The dogs are exactly the red things.', because: 'Too strong — it claims both directions at once.' },
    ],
    trap: 'subset-direction',
  },
  {
    id: 't4-if-then',
    level: 4,
    prompt: 'If Rex is a dog, then Rex is red.',
    english: 'If Rex is a dog then Rex is red.',
    formal: 'rex ∈ Dog → rex ∈ Red',
    sig: REX,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: 'rex ∈ Dog ∧ rex ∈ Red', english: 'Rex is a dog and Rex is red.', because: '→ does not claim Rex IS a dog. It only says what follows IF he is. The whole sentence is true if Rex turns out to be a cat.' },
      { formal: 'rex ∈ Red → rex ∈ Dog', english: 'If Rex is red then Rex is a dog.', because: 'The arrow got turned around. These are genuinely different claims.' },
    ],
    trap: 'implies-vs-and',
    hint: 'An "if…then" makes no promise at all when the "if" part is false.',
  },
  {
    id: 't4-converse',
    level: 4,
    prompt: 'Rex is red only if Rex is a dog.',
    english: 'If Rex is red then Rex is a dog.',
    formal: 'rex ∈ Red → rex ∈ Dog',
    sig: REX,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: 'rex ∈ Dog → rex ∈ Red', english: 'If Rex is a dog then Rex is red.', because: '"P only if Q" means P → Q, not Q → P. English is being sneaky here; the "only" flips it.' },
      { formal: 'rex ∈ Red ↔ rex ∈ Dog', english: 'Rex is red if and only if Rex is a dog.', because: '"only if" is one direction. "if and only if" is both.' },
    ],
    trap: 'only-if',
    hint: '"Only if" is one of the meanest phrases in English. "You may go out only if you finish your homework" — what does that promise, and what does it not?',
  },
  {
    id: 't4-iff',
    level: 4,
    prompt: 'Rex is red if and only if Rex is a dog.',
    english: 'Rex is red exactly when Rex is a dog.',
    formal: 'rex ∈ Red ↔ rex ∈ Dog',
    sig: REX,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: 'rex ∈ Red → rex ∈ Dog', english: 'If Rex is red then Rex is a dog.', because: 'Only half of it. ↔ is two arrows.' },
      { formal: 'rex ∈ Red ∧ rex ∈ Dog', english: 'Rex is red and Rex is a dog.', because: '↔ does not say either one is true — only that they stand or fall together.' },
    ],
  },
  {
    id: 't4-contrapositive',
    level: 4,
    prompt: 'If Rex is not red, then Rex is not a dog.',
    english: 'If Rex is not red then Rex is not a dog.',
    formal: 'rex ∉ Red → rex ∉ Dog',
    sig: REX,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: 'rex ∉ Dog → rex ∉ Red', english: 'If Rex is not a dog then Rex is not red.', because: 'Negating both sides is fine — but you must ALSO flip the arrow. Negate-and-flip is the contrapositive, and it is equivalent to the original. Negate-without-flipping is the inverse, and it is not.' },
      { formal: 'rex ∈ Red → rex ∈ Dog', english: 'If Rex is red then Rex is a dog.', because: 'That is the converse of the negation — a different claim again.' },
    ],
    trap: 'contrapositive',
    hint: 'Try to find a world where "if not red then not a dog" is true but "if a dog then red" is false. You will not manage it — they are the same sentence in disguise.',
  },

  // --- Level 5: quantifiers ------------------------------------------------
  {
    id: 't5-everything-dog',
    level: 5,
    prompt: 'Everything is a dog.',
    english: 'Every thing is a dog.',
    formal: '∀ x ( x ∈ Dog )',
    sig: CREATURES,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: '∃ x ( x ∈ Dog )', english: 'Some thing is a dog.', because: '∃ only asks for one. ∀ asks for all of them.' },
      { formal: '∀ x ( x ∉ Dog )', english: 'No thing is a dog.', because: 'The exact opposite.' },
    ],
  },
  {
    id: 't5-something-red',
    level: 5,
    prompt: 'Something is red.',
    english: 'There is at least one red thing.',
    formal: '∃ x ( x ∈ Red )',
    sig: CREATURES,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: '∀ x ( x ∈ Red )', english: 'Every thing is red.', because: '"Something" is a much smaller claim than "everything".' },
      { formal: '∃ x ( x ∉ Red )', english: 'Something is not red.', because: 'A world can easily have both — and neither implies the other.' },
    ],
  },
  {
    id: 't5-nothing-red',
    level: 5,
    prompt: 'Nothing is red.',
    english: 'There is no red thing.',
    formal: '¬ ∃ x ( x ∈ Red )',
    sig: CREATURES,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: '∃ x ( x ∉ Red )', english: 'Something is not red.', because: 'A world with one red apple and one blue one makes this true and "nothing is red" false. Moving the ¬ across the ∃ is not free — it flips the quantifier too.' },
      { formal: '¬ ∀ x ( x ∈ Red )', english: 'Not everything is red.', because: 'Same slip. ¬∀ is "not all"; ¬∃ is "none". Those are very different.' },
    ],
    trap: 'negating-quantifiers',
    hint: '¬∃x P(x) is the same as ∀x ¬P(x). The ¬ can cross the quantifier, but the quantifier flips as it does.',
  },
  {
    id: 't5-not-everything',
    level: 5,
    prompt: 'Not everything is red.',
    english: 'Not every thing is red.',
    formal: '¬ ∀ x ( x ∈ Red )',
    sig: CREATURES,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: '¬ ∃ x ( x ∈ Red )', english: 'Nothing is red.', because: '"Not all" is a whisper. "None" is a shout.' },
      { formal: '∀ x ( x ∉ Red )', english: 'Every thing is not red.', because: 'Same shout, said differently.' },
    ],
    trap: 'negating-quantifiers',
  },

  // --- Level 6: the two patterns — the heart of the lesson ----------------
  {
    id: 't6-every-dog-red',
    level: 6,
    prompt: 'Every dog is red.',
    english: 'Every dog is red.',
    formal: '∀ x ( x ∈ Dog → x ∈ Red )',
    sig: CREATURES,
    nouns: CREATURES_NOUNS,
    distractors: [
      {
        formal: '∀ x ( x ∈ Dog ∧ x ∈ Red )',
        english: 'Every thing is a dog, and every thing is red.',
        because:
          'This is THE mistake. With ∧ you are no longer talking about dogs — you are claiming that absolutely everything in the world is a red dog. The word "every" in English quietly means "for every thing, IF it is a dog THEN…".',
      },
      {
        formal: '∃ x ( x ∈ Dog → x ∈ Red )',
        english: 'There is something which, if it is a dog, is red.',
        because: 'Almost meaningless — it is true the moment a single non-dog exists anywhere.',
      },
    ],
    trap: 'forall-with-and',
    hint: 'Say it out loud the long way: "for every thing x, IF x is a dog, THEN x is red." Which symbol is the "if…then"?',
  },
  {
    id: 't6-some-dog-red',
    level: 6,
    prompt: 'Some dog is red.',
    english: 'There is a dog that is red.',
    formal: '∃ x ( x ∈ Dog ∧ x ∈ Red )',
    sig: CREATURES,
    nouns: CREATURES_NOUNS,
    distractors: [
      {
        formal: '∃ x ( x ∈ Dog → x ∈ Red )',
        english: 'There is something which, if it is a dog, is red.',
        because:
          'The mirror-image mistake. This is true in a world containing nothing but one blue bus — because the bus is not a dog, so "if it is a dog…" is vacuously true of it. It claims almost nothing.',
      },
      {
        formal: '∀ x ( x ∈ Dog ∧ x ∈ Red )',
        english: 'Every thing is a dog and is red.',
        because: 'Wildly too strong.',
      },
    ],
    trap: 'exists-with-implies',
    hint: '∀ pairs with →. ∃ pairs with ∧. Swap them and you say something either enormous or empty.',
  },
  {
    id: 't6-no-dog-red',
    level: 6,
    prompt: 'No dog is red.',
    english: 'There is no dog that is red.',
    formal: '¬ ∃ x ( x ∈ Dog ∧ x ∈ Red )',
    sig: CREATURES,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: '∃ x ( x ∈ Dog ∧ x ∉ Red )', english: 'Some dog is not red.', because: '"No dog is red" bans ALL red dogs. "Some dog is not red" only reports one non-red dog — there could be a red one too.' },
      { formal: '¬ ∀ x ( x ∈ Dog → x ∈ Red )', english: 'Not every dog is red.', because: 'Again: "none" versus "not all".' },
    ],
    trap: 'none-vs-not-all',
  },
  {
    id: 't6-some-dog-not-red',
    level: 6,
    prompt: 'Some dog is not red.',
    english: 'There is a dog that is not red.',
    formal: '∃ x ( x ∈ Dog ∧ x ∉ Red )',
    sig: CREATURES,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: '¬ ∃ x ( x ∈ Dog ∧ x ∈ Red )', english: 'No dog is red.', because: 'Far stronger than what was asked.' },
      { formal: '∃ x ( x ∈ Dog → x ∉ Red )', english: 'There is something which, if it is a dog, is not red.', because: 'The vacuous-truth trap again — a single non-dog makes it true.' },
    ],
    trap: 'exists-with-implies',
  },
  {
    id: 't6-subset-unrolled',
    level: 6,
    prompt: 'Every A is a B — but write it with a quantifier instead of ⊆.',
    english: 'For every thing, if it is in A then it is in B.',
    formal: '∀ x ( x ∈ A → x ∈ B )',
    sig: THREE,
    distractors: [
      { formal: '∀ x ( x ∈ A ∧ x ∈ B )', english: 'Every thing is in A and in B.', because: 'The ∀/∧ trap, one more time. It never stops being tempting.' },
      { formal: '∀ x ( x ∈ B → x ∈ A )', english: 'For every thing, if it is in B then it is in A.', because: 'That is B ⊆ A — the other way round.' },
    ],
    hint: 'This is literally what A ⊆ B *means*. The subset symbol is an abbreviation for this sentence.',
  },

  // --- Level 7: relations and quantifier order ----------------------------
  {
    id: 't7-everyone-likes-someone',
    level: 7,
    prompt: 'Everyone likes someone.',
    english: 'For every kid, there is some kid that they like.',
    formal: '∀ x ( x ∈ Kid → ∃ y ( y ∈ Kid ∧ Likes ( x , y ) ) )',
    sig: FRIENDS,
    distractors: [
      {
        formal: '∃ y ( y ∈ Kid ∧ ∀ x ( x ∈ Kid → Likes ( x , y ) ) )',
        english: 'There is one particular kid whom everybody likes.',
        because:
          'Swapping ∀ and ∃ changes everything. "Everyone likes someone" lets each kid pick their own favourite. "There is someone everyone likes" demands a single universally-adored kid. The first does not give you the second.',
      },
      {
        formal: '∀ x ( x ∈ Kid → ∀ y ( y ∈ Kid → Likes ( x , y ) ) )',
        english: 'Every kid likes every kid.',
        because: 'Much too strong — that is everyone liking everyone.',
      },
    ],
    trap: 'quantifier-order',
    hint: 'Order matters. Read it left to right, like a game: first *anyone* is chosen, then *you* get to pick who they like.',
  },
  {
    id: 't7-someone-liked-by-all',
    level: 7,
    prompt: 'There is someone whom everybody likes.',
    english: 'There is a kid that every kid likes.',
    formal: '∃ y ( y ∈ Kid ∧ ∀ x ( x ∈ Kid → Likes ( x , y ) ) )',
    sig: FRIENDS,
    distractors: [
      {
        formal: '∀ x ( x ∈ Kid → ∃ y ( y ∈ Kid ∧ Likes ( x , y ) ) )',
        english: 'Every kid likes at least one kid.',
        because: 'The other order. Each kid may like a different person, so there need be no universally-liked kid at all.',
      },
      {
        formal: '∃ y ( y ∈ Kid ∧ ∃ x ( x ∈ Kid ∧ Likes ( x , y ) ) )',
        english: 'Some kid is liked by some kid.',
        because: 'Far weaker — one single friendship makes this true.',
      },
    ],
    trap: 'quantifier-order',
  },
  {
    id: 't7-sam-likes-everyone',
    level: 7,
    prompt: 'Sam likes every kid.',
    english: 'Sam likes every kid.',
    formal: '∀ y ( y ∈ Kid → Likes ( sam , y ) )',
    sig: FRIENDS,
    distractors: [
      { formal: '∀ y ( y ∈ Kid → Likes ( y , sam ) )', english: 'Every kid likes Sam.', because: 'The arguments got swapped. Likes(sam, y) and Likes(y, sam) are different facts — liking is not automatically mutual.' },
      { formal: '∃ y ( y ∈ Kid ∧ Likes ( sam , y ) )', english: 'Sam likes some kid.', because: 'Only one, not all.' },
    ],
    trap: 'argument-order',
  },
  {
    id: 't7-nobody-likes-themselves',
    level: 7,
    prompt: 'No kid likes themselves.',
    english: 'There is no kid who likes themselves.',
    formal: '¬ ∃ x ( x ∈ Kid ∧ Likes ( x , x ) )',
    sig: FRIENDS,
    distractors: [
      { formal: '∃ x ( x ∈ Kid ∧ ¬ Likes ( x , x ) )', english: 'Some kid does not like themselves.', because: '"None" versus "at least one not" — the distinction that will not go away.' },
      { formal: '¬ ∀ x ( x ∈ Kid → Likes ( x , x ) )', english: 'Not every kid likes themselves.', because: 'Same distinction.' },
    ],
    trap: 'none-vs-not-all',
  },

  // --- Level 8: uniqueness -------------------------------------------------
  {
    id: 't8-exactly-one-dog',
    level: 8,
    prompt: 'There is exactly one dog.',
    english: 'There is exactly one dog.',
    formal: '∃! x ( x ∈ Dog )',
    sig: CREATURES,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: '∃ x ( x ∈ Dog )', english: 'There is at least one dog.', because: '∃ permits a hundred dogs. ∃! permits exactly one.' },
      { formal: '∀ x ( x ∈ Dog )', english: 'Every thing is a dog.', because: 'Neither "at least one" nor "exactly one" — it is "all".' },
    ],
  },
  {
    id: 't8-exactly-one-red-dog',
    level: 8,
    prompt: 'There is exactly one red dog.',
    english: 'There is exactly one thing that is both a dog and red.',
    formal: '∃! x ( x ∈ Dog ∧ x ∈ Red )',
    sig: CREATURES,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: '∃! x ( x ∈ Dog ) ∧ ∃! x ( x ∈ Red )', english: 'There is exactly one dog, and exactly one red thing.', because: 'Two separate uniqueness claims — and it does not even say the dog is the red one.' },
      { formal: '∃! x ( x ∈ Dog → x ∈ Red )', english: 'There is exactly one thing which, if it is a dog, is red.', because: 'The ∃/→ trap, wearing a new hat.' },
    ],
    trap: 'exists-with-implies',
  },
  {
    id: 't8-unroll-unique',
    level: 8,
    prompt: 'There is exactly one dog — but write it WITHOUT ∃!, using ∃, ∀ and =.',
    english: 'There is a dog, and any dog is that same dog.',
    formal: '∃ x ( x ∈ Dog ∧ ∀ y ( y ∈ Dog → y = x ) )',
    sig: CREATURES,
    nouns: CREATURES_NOUNS,
    distractors: [
      { formal: '∃ x ( x ∈ Dog ∧ ∀ y ( y ∈ Dog ∧ y = x ) )', english: 'There is a dog such that every thing is a dog and is that dog.', because: 'The ∀/∧ trap inside the uniqueness clause.' },
      { formal: '∃ x ( x ∈ Dog ) ∧ ∀ y ( y ∈ Dog → y ≠ x )', english: 'There is a dog, and no dog is x.', because: 'x has escaped its quantifier — and the claim now contradicts itself.' },
    ],
    hint: '"Exactly one" = "at least one" AND "at most one". The ∀y part is the "at most one".',
  },
];

/** The board this lesson's translation game posts to. */
export const TRANSLATE_BOARD = 'set-logic.translate';
export const VENN_BOARD = 'set-logic.venn';

/** The author's scores. Beatable, but you will have to work. */
export const TRANSLATE_PAR = 3200;
export const VENN_PAR = 1400;

export const puzzleLevel = (id: string): number =>
  TRANSLATE_PUZZLES.find((p) => p.id === id)?.level ?? 0;
