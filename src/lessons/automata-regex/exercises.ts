/**
 * "Build this": a graded sheet of machine-and-pattern exercises, from a lamp
 * switch to languages that look like counting and are not.
 *
 * Each exercise is a little story with an alphabet whose letters MEAN something
 * (t = flick the switch, w = wait), and one authored fact: the reference regex,
 * in the lesson's own theory syntax. As everywhere in this lesson, the rest is
 * derived — the answer's machine is `minimize(toDFA(regexToNFA(regex)))`, drawn
 * by the canvas, so the picture is provably the machine for the pattern, and a
 * learner's own pattern is graded by `equivalent` with the shortest string they
 * get wrong. `exercises.test.ts` checks every regex against its examples.
 *
 * The sheet is practice, not a gate: no score, no rung. Stars say how hard, and
 * the order is the order of difficulty, so the spectrum has no cliff.
 */
export interface BuildExercise {
  id: string;
  /** 1 (warm-up) to 5 (fiendish). The list is sorted by this. */
  stars: 1 | 2 | 3 | 4 | 5;
  title: string;
  /** The puzzle, as a story. Never a dry formal statement. */
  story: string;
  /** What each letter of the alphabet stands for in the story. */
  legend: Record<string, string>;
  alphabet: string[];
  /** The answer. Everything else about it is derived. */
  regex: string;
  /** Strings in the language. Checked against `regex`. */
  accept: string[];
  /** Strings out of it. Checked too. */
  reject: string[];
  /** Shown with the answer: what makes this one interesting. */
  note?: string;
}

export const BUILD_EXERCISES: BuildExercise[] = [
  // --- ★ warm-ups --------------------------------------------------------------
  {
    id: 'x-lamp',
    stars: 1,
    title: 'The lamp',
    story:
      'A lamp starts OFF. Someone sits next to it flicking the switch (t) and sometimes just waiting (w). Accept the sequences that leave the lamp ON.',
    legend: { t: 'flick the switch', w: 'wait' },
    alphabet: ['t', 'w'],
    regex: 'w*t(w*tw*t)*w*',
    accept: ['t', 'wt', 'tw', 'ttt', 'wtwtwt'],
    reject: ['', 'w', 'tt', 'twt', 'wttw'],
    note: 'Two states, ON and OFF. The machine does not count the flicks; it only remembers whether the count is odd.',
  },
  {
    id: 'x-bouncer',
    stars: 1,
    title: 'The bouncer',
    story:
      'The bouncer lets you in only if you have clapped (c) an even number of times. Stamping your feet (s) does not count. Zero claps is even.',
    legend: { c: 'clap', s: 'stamp' },
    alphabet: ['c', 's'],
    regex: 's*(cs*cs*)*',
    accept: ['', 's', 'cc', 'csc', 'scsc'],
    reject: ['c', 'sc', 'ccc', 'cssss'],
  },
  {
    id: 'x-bus',
    stars: 1,
    title: 'Tap once',
    story:
      'On the bus you must tap your card (t) exactly once. Taking a step (s) is fine any number of times. Tap twice and you pay twice — reject that.',
    legend: { t: 'tap the card', s: 'take a step' },
    alphabet: ['s', 't'],
    regex: 's*ts*',
    accept: ['t', 'st', 'ts', 'ssts', 'stsss'],
    reject: ['', 's', 'tt', 'stst', 'sss'],
    note: 'The third state is a trap: once you have tapped twice, nothing you do afterwards can fix it.',
  },
  {
    id: 'x-binary-even',
    stars: 1,
    title: 'Even numbers in binary',
    story: 'Read a binary number. Accept it if it is even.',
    legend: { '0': 'the digit 0', '1': 'the digit 1' },
    alphabet: ['0', '1'],
    regex: '(0|1)*0',
    accept: ['0', '10', '110', '1000', '0010'],
    reject: ['', '1', '01', '111', '1001'],
    note: 'Even in decimal means "ends in 0, 2, 4, 6 or 8". In binary it is just "ends in 0". The machine only needs to remember the last digit.',
  },

  // --- ★★ ---------------------------------------------------------------------
  {
    id: 'x-traffic',
    stars: 2,
    title: 'A working traffic light',
    story:
      'A traffic light starts on green and goes green (g), yellow (y), red (r), green, yellow, red… Accept every sequence of colours a WORKING light could have shown so far.',
    legend: { g: 'green', y: 'yellow', r: 'red' },
    alphabet: ['g', 'y', 'r'],
    regex: '(gyr)*(g|gy)?',
    accept: ['', 'g', 'gy', 'gyr', 'gyrg', 'gyrgyr'],
    reject: ['y', 'r', 'gg', 'gr', 'gyy', 'gyrr'],
    note: 'Every state accepts here, except the trap: the light is fine until it does something wrong, and then it is broken forever.',
  },
  {
    id: 'x-pingpong',
    stars: 2,
    title: 'Ping-pong',
    story:
      'A rally: the ball hits the left side (l) or the right side (r) of the table. In a fair rally it never lands on the same side twice in a row. Accept the fair rallies.',
    legend: { l: 'lands on the left', r: 'lands on the right' },
    alphabet: ['l', 'r'],
    regex: 'r?(lr)*l?',
    accept: ['', 'l', 'r', 'lr', 'rl', 'lrl', 'rlrl'],
    reject: ['ll', 'rr', 'lrr', 'llr', 'rlrr'],
  },
  {
    id: 'x-questions',
    stars: 2,
    title: 'Every question answered',
    story:
      'In a quiz, every question (q) must be IMMEDIATELY followed by an answer (a). Extra answers are fine — people like to talk.',
    legend: { q: 'a question', a: 'an answer' },
    alphabet: ['q', 'a'],
    regex: '(a|qa)*',
    accept: ['', 'a', 'qa', 'qaa', 'aqa', 'qaqa'],
    reject: ['q', 'aq', 'qq', 'qqa', 'qaq'],
  },
  {
    id: 'x-safe',
    stars: 2,
    title: 'The safe',
    story:
      'A safe opens the moment the dial has been turned to c, then a, then b, in a row. Once open, it stays open whatever you do next. Accept the sequences that leave it open.',
    legend: { a: 'turn to a', b: 'turn to b', c: 'turn to c' },
    alphabet: ['a', 'b', 'c'],
    regex: '(a|b|c)*cab(a|b|c)*',
    accept: ['cab', 'ccab', 'cabb', 'acabc', 'cacab'],
    reject: ['', 'ca', 'cb', 'cba', 'acb', 'caab'],
    note: '"cacab" is the tricky one: after "ca" a c arrives, which is not b — but it IS the start of a new try. A careless machine goes back to the very beginning and misses it.',
  },
  {
    id: 'x-binary-four',
    stars: 2,
    title: 'Multiples of four',
    story: 'Read a binary number. Accept it if it is divisible by 4.',
    legend: { '0': 'the digit 0', '1': 'the digit 1' },
    alphabet: ['0', '1'],
    regex: '0|(0|1)*00',
    accept: ['0', '00', '100', '1100', '10000'],
    reject: ['', '1', '10', '110', '1010'],
    note: 'Like "ends in 00" in decimal for multiples of 100. The lone "0" needs its own case, because zero is divisible by everything.',
  },

  // --- ★★★ --------------------------------------------------------------------
  {
    id: 'x-tea',
    stars: 3,
    title: 'Tea for three',
    story:
      'Three friends share tea. Each pour (p) fills one cup; each biscuit (b) is irrelevant. Accept the afternoons where the number of pours is a multiple of three, so nobody is left out. Zero is a multiple of three.',
    legend: { p: 'pour a cup', b: 'eat a biscuit' },
    alphabet: ['p', 'b'],
    regex: 'b*(pb*pb*pb*)*',
    accept: ['', 'b', 'ppp', 'pbpbp', 'bpppb', 'pppppp'],
    reject: ['p', 'pp', 'ppb', 'pppp', 'bpbpb'],
    note: 'Three states in a ring, one for each remainder. The bouncer was the same idea with two.',
  },
  {
    id: 'x-tug-one',
    stars: 3,
    title: 'A gentle tug of war',
    story:
      'A rope starts at the centre line. Each pull moves it one step left (l) or right (r). The referee stops the game if it ever gets more than ONE step from the centre. Accept the games that end with the rope back on the centre line, never stopped.',
    legend: { l: 'pull left', r: 'pull right' },
    alphabet: ['l', 'r'],
    regex: '(lr|rl)*',
    accept: ['', 'lr', 'rl', 'lrrl', 'rllr'],
    reject: ['l', 'r', 'll', 'lrr', 'llrr'],
  },
  {
    id: 'x-two-switches',
    stars: 3,
    title: 'Two switches',
    story:
      'Two lamps, both OFF. Flicking switch a toggles the first lamp, switch b the second. Accept the sequences that leave both lamps OFF.',
    legend: { a: 'flick switch a', b: 'flick switch b' },
    alphabet: ['a', 'b'],
    regex: '(aa|bb|(ab|ba)(aa|bb)*(ab|ba))*',
    accept: ['', 'aa', 'bb', 'abab', 'abba', 'baab'],
    reject: ['a', 'b', 'ab', 'aab', 'abb', 'aaa'],
    note: 'Four states, one per combination of the two lamps: a neat square. The pattern for it is a mess. Some languages are easier to say as a machine.',
  },

  // --- ★★★★ -------------------------------------------------------------------
  {
    id: 'x-tug-two',
    stars: 4,
    title: 'A fiercer tug of war',
    story:
      'The same tug of war, but now the referee only stops the game if the rope gets more than TWO steps from the centre. Accept the games that end on the centre line, never stopped.',
    legend: { l: 'pull left', r: 'pull right' },
    alphabet: ['l', 'r'],
    regex: '(l(lr)*r|r(rl)*l)*',
    accept: ['', 'lr', 'llrr', 'lrlr', 'rrll', 'llrlrr'],
    reject: ['l', 'rr', 'lllrrr', 'llrrr', 'rrrlll'],
    note: 'Each extra step the referee allows costs the machine two more states; allow any number and it needs infinitely many — that is the wall at level 8. Every referee makes the game finite.',
  },
  {
    id: 'x-spy',
    stars: 4,
    title: "The spy's signal",
    story:
      'A spy blinks a lamp, short (a) or long (b). The message is "go" exactly when the THIRD-FROM-LAST blink was short. Accept the "go" messages.',
    legend: { a: 'a short blink', b: 'a long blink' },
    alphabet: ['a', 'b'],
    regex: '(a|b)*a(a|b)(a|b)',
    accept: ['aaa', 'abb', 'baba', 'bbabb', 'abaab'],
    reject: ['', 'a', 'ab', 'bab', 'bbb', 'abbb'],
    note: 'Easy to say, and the smallest machine needs 8 states, because it must remember the last three blinks: 2 × 2 × 2. Ask for the 4th from last and it needs 16.',
  },
  {
    id: 'x-even-no-bb',
    stars: 4,
    title: 'Hopscotch',
    story:
      'A hopscotch game: a hop (a) or a big jump (b). You must hop an even number of times, and you may never do two big jumps in a row. Accept the legal games.',
    legend: { a: 'hop', b: 'big jump' },
    alphabet: ['a', 'b'],
    regex: '((a|ba)(a|ba))*b?',
    accept: ['', 'b', 'aa', 'aab', 'baba', 'abab', 'baab'],
    reject: ['a', 'bb', 'ab', 'aabb', 'bab', 'aaa'],
    note: 'Two rules at once: the machine is the two little machines run side by side (that is the product construction). The pattern was found by the round trip from level 6 — then it turned out to be short.',
  },

  // --- ★★★★★ ------------------------------------------------------------------
  {
    id: 'x-ab-ba',
    stars: 5,
    title: 'Up and down',
    story:
      'A hiker writes a for every step uphill and b for every step downhill. Count how many times an uphill step is followed by a downhill one ("ab") and how many times the reverse ("ba"). Accept the walks where those two counts are EQUAL.',
    legend: { a: 'a step uphill', b: 'a step downhill' },
    alphabet: ['a', 'b'],
    regex: 'ε|a|b|a(a|b)*a|b(a|b)*b',
    accept: ['', 'a', 'b', 'aa', 'aba', 'abba', 'baab', 'bab'],
    reject: ['ab', 'ba', 'aab', 'abb', 'baa', 'abab'],
    note: 'It looks like counting, and counting is exactly what finite machines cannot do. But the counts can never differ by more than one: every switch from a to b must be undone before you switch again. So all that matters is whether the walk ends on the letter it started with. Five states.',
  },
  {
    id: 'x-wheel',
    stars: 5,
    title: 'The wheel',
    story:
      'A wheel has three positions. Turning it clockwise (a) moves it one position; anticlockwise (b) moves it one position back. Accept the sequences that leave it where it started.',
    legend: { a: 'turn clockwise', b: 'turn anticlockwise' },
    alphabet: ['a', 'b'],
    regex: '(ab|(b|aa)(ba)*(a|bb))*',
    accept: ['', 'ab', 'ba', 'aaa', 'bbb', 'aabb', 'abab', 'aaaaaa'],
    reject: ['a', 'b', 'aa', 'bb', 'aab', 'abb', 'aaab'],
    note: 'Three states and a perfectly symmetric machine. The pattern that state elimination gives for it is anything but symmetric. When a machine is this simple and its pattern this strange, believe the machine.',
  },
];
