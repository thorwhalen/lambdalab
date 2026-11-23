/**
 * Pattern golf: one pattern that finds a match in every word on the left and in
 * none on the right. Regex golf (regex.alf.nu), rebuilt to TEACH.
 *
 * The difference from golf-for-experts is the path. Each STATION introduces one
 * special symbol, and each of its puzzles is solvable with that symbol plus the
 * ones met before, so a learner never faces a puzzle that needs a symbol nobody
 * showed them. A puzzle that `[]` and `+` solve is a puzzle that teaches `[]` and
 * `+`.
 *
 * What is authored per puzzle: the two word lists and one or more short
 * solutions. What is DERIVED: each solution's symbol set (by `checkCore`, so it
 * cannot drift from the pattern) and the par (the shortest solution's length).
 * `golf.test.ts` proves that every solution matches every left word and no right
 * word, and that every puzzle has a solution using only the symbols met so far —
 * including its own station's new one.
 *
 * The patterns are the core every regex flavor shares (`lib/coreRegex`), so the
 * game can say "regular expression" with no qualifier.
 *
 * LAST AUDIT (`golf.audit.test.ts`, 2026-11-23): every puzzle to depth 5, and
 * g-grey and g-q-without-u to depth 6 — no pattern that short beats par, or
 * reaches it without the station's symbol. A par longer than the depth is a claim
 * checked that far. Re-run the audit before changing a list.
 */
import type { CoreSymbol } from '../../lib/coreRegex';

export interface GolfStation {
  /** The symbol this station introduces; `null` for the opening station (plain letters). */
  symbol: CoreSymbol | null;
  title: string;
  /** What the new symbol means, said once, plainly. Shown when the station opens. */
  intro: string;
}

export interface GolfPuzzle {
  id: string;
  /** Index into `GOLF_STATIONS`. */
  station: number;
  title: string;
  /** Every one of these must contain a match. */
  match: string[];
  /** None of these may contain a match. */
  reject: string[];
  /** Short solutions; the shortest sets par. The test checks every one. */
  solutions: string[];
  /** Shown after a solve: what this one was really about. */
  note?: string;
}

export const GOLF_STATIONS: GolfStation[] = [
  {
    symbol: null,
    title: 'Plain letters',
    intro:
      'A pattern of plain letters looks for those letters, in that order, ANYWHERE inside the word. "cat" is found in "concatenate". That is the whole rule of this game: a word is matched if the pattern turns up somewhere in it.',
  },
  { symbol: '|', title: 'Or: |', intro: 'cat|dog finds cat, or dog. Either side will do.' },
  { symbol: '.', title: 'Any character: .', intro: 'A dot stands for any one character. c.t finds cat, cot, cut — and c9t.' },
  {
    symbol: '[]',
    title: 'One of these: [ ]',
    intro: 'Square brackets hold a list, and match ONE character from it. b[aeu]t finds bat, bet and but, but not bit.',
  },
  {
    symbol: '^',
    title: 'The start: ^',
    intro: '^ pins the pattern to the start of the word. ^un finds "unfair" but not "fun". It matches a position, not a letter.',
  },
  { symbol: '$', title: 'The end: $', intro: '$ pins the pattern to the end of the word. ly$ finds "quickly" but not "lynx".' },
  { symbol: '?', title: 'Maybe: ?', intro: 'x? means "an x, or nothing". colou?r finds both color and colour.' },
  { symbol: '+', title: 'One or more: +', intro: 'x+ means "one x, or two, or more". zo+m finds zom, zoom and zoooooom.' },
  {
    symbol: '*',
    title: 'Any number, even none: *',
    intro: 'x* means "no x at all, or one, or more". Careful: a* on its own finds "nothing" in every word, so it matches everything.',
  },
  {
    symbol: '()',
    title: 'Groups: ( )',
    intro: 'Round brackets glue a piece together, so the next symbol applies to all of it. (ha)+ is ha, haha, hahaha.',
  },
  { symbol: '{}', title: 'Exact counts: { }', intro: 'x{3} is xxx. .{5} is any five characters. x{2,4} is two to four x\'s.' },
  { symbol: '[a-z]', title: 'Ranges: [a-z]', intro: 'Inside brackets, a dash makes a range: [a-e] is [abcde], and [0-9] is any digit.' },
  {
    symbol: '[^]',
    title: 'None of these: [^ ]',
    intro:
      'A ^ FIRST inside brackets flips the list: [^aeiou] is any character that is NOT a vowel. Same key as the start-of-word ^, completely different meaning. Where it sits tells you which one it is.',
  },
];

export const GOLF_PUZZLES: GolfPuzzle[] = [
  // --- plain letters ---------------------------------------------------------
  {
    id: 'g-cat',
    station: 0,
    title: 'Where is the cat?',
    match: ['cat', 'concatenate', 'catalog', 'bobcat', 'scatter'],
    reject: ['dog', 'act', 'bat', 'hat', 'cot', 'cart'],
    solutions: ['cat'],
    note: 'The pattern does not have to be the whole word. It only has to be in there somewhere.',
  },
  {
    id: 'g-ing',
    station: 0,
    title: 'Doing things',
    match: ['sing', 'ring', 'thing', 'kingdom', 'singer'],
    reject: ['sin', 'grin', 'long', 'hang', 'sign'],
    solutions: ['ing'],
  },
  {
    id: 'g-oo',
    station: 0,
    title: 'Double o',
    match: ['moon', 'book', 'food', 'zoo', 'cooler'],
    reject: ['mon', 'bok', 'fold', 'zo', 'ozone'],
    solutions: ['oo'],
  },

  // --- | -------------------------------------------------------------------
  {
    id: 'g-pets',
    station: 1,
    title: 'Pets',
    match: ['cat', 'dog', 'catalog', 'dogma', 'hotdog'],
    reject: ['cow', 'bat', 'god', 'act', 'dig', 'cab', 'door', 'fog', 'scab'],
    solutions: ['cat|dog'],
  },
  {
    id: 'g-colours',
    station: 1,
    title: 'Red or blue',
    match: ['red', 'blue', 'bluebird', 'redwood', 'bored'],
    reject: ['green', 'rude', 'bleu', 'der', 'blur', 'bed', 'glue', 'true'],
    solutions: ['red|blue'],
    note: '"bored" has red hiding in it. The pattern does not care that it is not about colour.',
  },

  // --- . -------------------------------------------------------------------
  {
    id: 'g-c-t',
    station: 2,
    title: 'C, something, T',
    match: ['cat', 'cot', 'cut', 'cutlery', 'scotch'],
    reject: ['ct', 'cart', 'coat', 'act', 'tic'],
    solutions: ['c.t'],
  },
  {
    id: 'g-h-t',
    station: 2,
    title: 'Hat, hit, hot, hut',
    match: ['hat', 'hit', 'hot', 'hut', 'white'],
    reject: ['ht', 'heat', 'hurt', 'thaw', 'haste'],
    solutions: ['h.t'],
  },

  // --- [] ------------------------------------------------------------------
  {
    id: 'g-b-aeu-t',
    station: 3,
    title: 'Bat, bet, but — not bit',
    match: ['bat', 'bet', 'but', 'alphabet', 'debut'],
    reject: ['bit', 'bot', 'bt', 'beat', 'bout'],
    solutions: ['b[aeu]t', 'bat|bet|but'],
    note: 'bat|bet|but works too, and is 11 characters. b[aeu]t is 7. That is what brackets are for.',
  },
  {
    id: 'g-two-vowels',
    station: 3,
    title: 'Two vowels in a row',
    match: ['boat', 'rain', 'queen', 'idea', 'cool', 'fruit', 'radio', 'you'],
    reject: ['cat', 'dog', 'river', 'banana', 'lemon'],
    solutions: ['[aeiou][aeiou]'],
  },
  {
    id: 'g-grey',
    station: 3,
    title: 'Grey or gray',
    match: ['grey', 'gray', 'greyhound', 'grayscale'],
    reject: ['grew', 'gory', 'groan', 'gyre', 'pray', 'array', 'gruyere', 'key', 'monkey', 'grab', 'grass'],
    solutions: ['gr[ae]y'],
  },

  // --- ^ -------------------------------------------------------------------
  {
    id: 'g-un',
    station: 4,
    title: 'Undo',
    match: ['undo', 'unfair', 'until', 'unicorn'],
    reject: ['fun', 'bunny', 'run', 'sun', 'up', 'use', 'ugly', 'sound', 'ruin', 'lion'],
    solutions: ['^un'],
    note: 'Without the ^, "un" turns up in "fun" and "bunny" too.',
  },
  {
    id: 'g-starts-vowel',
    station: 4,
    title: 'Starts with a vowel',
    match: ['apple', 'egg', 'ice', 'owl', 'umbrella'],
    reject: ['banana', 'tree', 'cake', 'ski', 'crab', 'glue', 'slice', 'sigh', 'pole'],
    solutions: ['^[aeiou]'],
  },

  // --- $ -------------------------------------------------------------------
  {
    id: 'g-ly',
    station: 5,
    title: 'Ends in -ly',
    match: ['quickly', 'fly', 'only', 'lily'],
    reject: ['lyre', 'lynx', 'slyer', 'lye', 'sky', 'happy', 'cry'],
    solutions: ['ly$'],
  },
  {
    id: 'g-exactly-go',
    station: 5,
    title: 'Exactly "go"',
    match: ['go'],
    reject: ['going', 'ago', 'ego', 'got', 'gogo'],
    solutions: ['^go$'],
    note: '^ and $ together say "the whole word, nothing before, nothing after". That turns "is it in there?" into "is it exactly this?".',
  },
  {
    id: 'g-ends-vowel',
    station: 5,
    title: 'Ends with a vowel',
    match: ['pizza', 'tree', 'kiwi', 'potato', 'emu'],
    reject: ['cat', 'dog', 'sky', 'bread', 'plum', 'mint', 'tub', 'limb', 'tomb', 'hit'],
    solutions: ['[aeiou]$'],
  },

  // --- ? -------------------------------------------------------------------
  {
    id: 'g-colour',
    station: 6,
    title: 'Colour, both spellings',
    match: ['color', 'colour', 'colorful', 'watercolour'],
    reject: ['colr', 'collar', 'cooler', 'colouur', 'four', 'flour', 'hour', 'odour'],
    solutions: ['colou?r'],
  },
  {
    id: 'g-dogs',
    station: 6,
    title: 'One dog or many',
    match: ['dog', 'dogs'],
    reject: ['doggy', 'dogss', 'hotdog', 'do', 'dig'],
    solutions: ['^dogs?$'],
  },

  // --- + -------------------------------------------------------------------
  {
    id: 'g-zoom',
    station: 7,
    title: 'Zooooom',
    match: ['zom', 'zoom', 'zooooom', 'vroomzoom'],
    reject: ['zm', 'zoam', 'mooz', 'zooo', 'boom', 'room', 'zero'],
    solutions: ['zo+m'],
  },
  {
    id: 'g-haaa',
    station: 7,
    title: 'Haaaaa',
    match: ['ha', 'haa', 'haaaaa'],
    reject: ['h', 'hah', 'aha', 'haha'],
    solutions: ['^ha+$'],
  },

  // --- * -------------------------------------------------------------------
  {
    id: 'g-hmm',
    station: 8,
    title: 'Hmmmm',
    match: ['h', 'hm', 'hmm', 'hmmmm'],
    reject: ['mh', 'hmh', 'hh', 'hum'],
    solutions: ['^hm*$'],
    note: 'hm+ would miss the plain "h". * is + that also allows none.',
  },
  {
    id: 'g-goal',
    station: 8,
    title: 'Gooooal!',
    match: ['gal', 'goal', 'gooooal'],
    reject: ['gl', 'goa', 'goals', 'pal', 'girl', 'canal'],
    solutions: ['^go*al$'],
    note: '"gal" has no o at all, and o* is happy with that. go+al would miss it.',
  },

  // --- () ------------------------------------------------------------------
  {
    id: 'g-haha',
    station: 9,
    title: 'Hahahaha',
    match: ['ha', 'haha', 'hahaha'],
    reject: ['hah', 'haa', 'ahah', 'hhaa', 'aha', 'hhaha', 'haaha'],
    solutions: ['^(ha)+$'],
    note: 'Compare with ^ha+$ two stations ago. Without the group, + repeats only the a.',
  },
  {
    id: 'g-banana',
    station: 9,
    title: 'Bananananana',
    match: ['bana', 'banana', 'bananana', 'banananana'],
    reject: ['ban', 'banan', 'bnana', 'baanana', 'bananas', 'abana', 'bandana'],
    solutions: ['^ba(na)+$'],
    note: 'The group makes + repeat "na" as a pair. Without it, ^bana+$ would mean bana, banaa, banaaa…',
  },

  // --- {} ------------------------------------------------------------------
  {
    id: 'g-five',
    station: 10,
    title: 'Five letters exactly',
    match: ['apple', 'tiger', 'zebra', 'plant', 'house', 'cloud'],
    reject: ['cat', 'banana', 'pear', 'oranges', 'tigers', 'pea', 'lizard'],
    solutions: ['^.{5}$', '^.....$'],
  },
  {
    id: 'g-long',
    station: 10,
    title: 'Long words',
    match: ['elephant', 'dinosaur', 'butterfly', 'crocodile', 'kangaroo', 'flamingo'],
    reject: ['cat', 'tiger', 'giraffe', 'monkey', 'lizard', 'donkey', 'gorilla', 'lobster'],
    solutions: ['.{8}'],
    note: 'No ^ or $ needed. If any 8 characters in a row exist, the word has at least 8 letters.',
  },

  // --- [a-z] ---------------------------------------------------------------
  {
    id: 'g-digit',
    station: 11,
    title: 'Has a number in it',
    match: ['r2d2', '4ever', 'b52', 'catch22', 'agent007', 'route66', 'c3po'],
    reject: ['two', 'four', 'ten', 'nine', 'oven', 'route'],
    solutions: ['[0-9]'],
  },
  {
    id: 'g-a-to-e',
    station: 11,
    title: 'Only the letters a to e',
    match: ['bad', 'cab', 'dead', 'bead', 'ace'],
    reject: ['cat', 'bag', 'dog', 'face', 'bedz', 'and', 'bird'],
    solutions: ['^[a-e]+$'],
  },

  // --- [^] -----------------------------------------------------------------
  {
    id: 'g-no-vowels',
    station: 12,
    title: 'No a, e, i, o or u',
    match: ['rhythm', 'myth', 'gym', 'lynx', 'crypt', 'hymn', 'shh', 'brr', 'tsk', 'pfft'],
    reject: ['cat', 'tree', 'idea', 'quiz', 'onyx', 'lamp', 'plum', 'syrup', 'lyric', 'happy', 'pony'],
    solutions: ['^[^aeiou]+$'],
    note: 'Both ^s in one pattern: the first is "start of word", the second is "not". Read them by where they sit.',
  },
  {
    id: 'g-q-without-u',
    station: 12,
    title: 'Q without U',
    match: ['qi', 'qwerty', 'burqa', 'niqab', 'iraqi'],
    reject: ['queen', 'quiz', 'squid', 'aqua', 'quote', 'square', 'liquid', 'require'],
    solutions: ['q[^u]'],
  },
];

export const GOLF_BOARD = 'automata-regex.golf';
export const GOLF_PAR = 2000;

/** The symbols a learner has met by the time they reach `station` (inclusive). */
export function symbolsMetBy(station: number): Set<CoreSymbol> {
  return new Set(
    GOLF_STATIONS.slice(0, station + 1)
      .map((s) => s.symbol)
      .filter((s): s is CoreSymbol => s !== null),
  );
}

/** Par for a puzzle: the length of its shortest authored solution. */
export const golfPar = (p: GolfPuzzle): number => Math.min(...p.solutions.map((s) => s.length));
