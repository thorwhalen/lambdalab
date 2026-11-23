/**
 * Pattern golf — match every word on the left, none on the right.
 *
 * A different shape from RegexLab, on purpose. RegexLab is the regex of the
 * theory, graded against a whole language. This is the regex people type into a
 * search box, graded the way regex golf is: by two lists of real words, and by
 * how short the pattern is.
 *
 * Two things make it teach rather than merely test:
 *   - the PATH: one new symbol per station (`golf.ts`), each puzzle solvable with
 *     the symbols met so far, the palette showing exactly those, and an
 *     exhaustive search (`golfSearch.ts`) proving par is honest and the new
 *     symbol is needed;
 *   - the EVIDENCE: every word shows, live, whether the pattern found something
 *     in it and WHERE (the matched part is highlighted), so "it found cat inside
 *     concatenate" is visible, not explained.
 *
 * Stations are progressive disclosure, not gates: every station can be opened at
 * any time. Station chips and puzzles carry no sigils beyond the symbol itself:
 * the symbol IS the station's picture.
 */
import { useMemo, useState } from 'react';
import { CORE_SYMBOLS, checkCore, type CoreSymbol } from '../../lib/coreRegex';
import { Button, Panel, Verdict } from '../../components/ui';
import { PatternInput, type PaletteSymbol } from '../../components/PatternInput';
import { Leaderboard, NicknameGate, useLeaderboard } from '../../components/Leaderboard';
import { NO_SOLVES, useProgress } from '../../core/progress';
import { boardTotal } from './content';
import { GOLF_BOARD, GOLF_PAR, GOLF_PUZZLES, GOLF_STATIONS, golfPar, symbolsMetBy } from './golf';

const LESSON_ID = 'automata-regex';
const solveKey = (id: string) => `golf-${id}`;

/** At or under par earns full points; each character over par costs a little, down to a floor. */
const BASE = 100;
const PER_STATION = 20;
const OVER_PAR_COST = 15;
const FLOOR_FRACTION = 0.4;

function golfScore(station: number, length: number, par: number): number {
  const base = BASE + PER_STATION * station;
  return Math.round(Math.max(base * FLOOR_FRACTION, base - Math.max(0, length - par) * OVER_PAR_COST));
}

/** What a palette button inserts for a symbol; brackets come as a pair with the caret inside. */
const SPELLING: Record<CoreSymbol, { insert: string; caret?: number }> = {
  '|': { insert: '|' },
  '.': { insert: '.' },
  '[]': { insert: '[]', caret: 1 },
  '[^]': { insert: '[^]', caret: 2 },
  '^': { insert: '^' },
  $: { insert: '$' },
  '?': { insert: '?' },
  '+': { insert: '+' },
  '*': { insert: '*' },
  '()': { insert: '()', caret: 1 },
  '{}': { insert: '{}', caret: 1 },
  '[a-z]': { insert: '-' },
  '\\': { insert: '\\' },
};

const paletteFor = (symbols: CoreSymbol[]): PaletteSymbol[] =>
  symbols.map((s) => ({
    label: s,
    ...SPELLING[s],
    gloss: CORE_SYMBOLS.find((c) => c.symbol === s)?.gloss ?? '',
  }));

type Finder = (word: string) => { index: number; length: number } | null;

function Word({ word, want, find }: { word: string; want: boolean; find: Finder | null }) {
  const m = find ? find(word) : null;
  const ok = find ? (m !== null) === want : null;
  const tone = ok === null ? 'text-ink-300' : ok ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]';
  return (
    <li className={`flex items-baseline gap-2 font-mono ${tone}`}>
      <span className="w-4 shrink-0 text-center" aria-hidden>
        {ok === null ? '·' : ok ? '✓' : '✗'}
      </span>
      <span className="text-ink-100">
        {m ? (
          <>
            {word.slice(0, m.index)}
            {m.length > 0 ? (
              <mark className="rounded bg-mach-500/35 px-0.5 text-ink-50">{word.slice(m.index, m.index + m.length)}</mark>
            ) : (
              <span className="text-mach-400">▏</span>
            )}
            {word.slice(m.index + m.length)}
          </>
        ) : (
          word
        )}
      </span>
    </li>
  );
}

export function PatternGolf() {
  const solvedMap = useProgress((s) => s.lessons[LESSON_ID]?.solved ?? NO_SOLVES);
  const { recordSolve } = useProgress();
  const board = useLeaderboard(GOLF_BOARD);

  // Start at the first unsolved puzzle, so a returning learner lands where they left off.
  const [index, setIndex] = useState(() => {
    const first = GOLF_PUZZLES.findIndex((p) => !solvedMap[solveKey(p.id)]);
    return first < 0 ? 0 : first;
  });
  const [src, setSrc] = useState('');
  const [result, setResult] = useState<null | { score: number; length: number; par: number; src: string }>(null);

  const puzzle = GOLF_PUZZLES[index]!;
  const station = GOLF_STATIONS[puzzle.station]!;
  const par = golfPar(puzzle);
  const palette = useMemo(() => paletteFor([...symbolsMetBy(puzzle.station)]), [puzzle.station]);
  const firstOfStation = GOLF_PUZZLES.findIndex((p) => p.station === puzzle.station) === index;
  const solvedBefore = !!solvedMap[solveKey(puzzle.id)];

  const check = useMemo(() => (src ? checkCore(src) : null), [src]);
  const find = check?.ok ? check.find : null;
  const allRight = !!check?.ok && puzzle.match.every((w) => check.test(w)) && puzzle.reject.every((w) => !check.test(w));
  const emptyMatch = !!find && [...puzzle.match, ...puzzle.reject].some((w) => find(w)?.length === 0);

  const go = (i: number) => {
    setIndex(i);
    setSrc('');
    setResult(null);
  };
  const next = () => go((index + 1) % GOLF_PUZZLES.length);

  const submit = () => {
    if (!allRight || result?.src === src) return;
    const score = golfScore(puzzle.station, src.length, par);
    setResult({ score, length: src.length, par, src });
    recordSolve(LESSON_ID, solveKey(puzzle.id), score);
    const { total, solved } = boardTotal(solvedMap, solveKey(puzzle.id), score);
    void board.submit(total, { solved });
  };

  const solvedIn = (n: number) => GOLF_PUZZLES.filter((p) => p.station === n && solvedMap[solveKey(p.id)]).length;

  return (
    <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
      <div className="min-w-0 flex-1">
        {/* The path: every station visible and openable; ✓ when all its holes are done. */}
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Stations">
          {GOLF_STATIONS.map((s, n) => {
            const total = GOLF_PUZZLES.filter((p) => p.station === n).length;
            const here = n === puzzle.station;
            return (
              <button
                key={s.title}
                onClick={() => go(GOLF_PUZZLES.findIndex((p) => p.station === n))}
                aria-label={s.title}
                aria-current={here ? 'step' : undefined}
                className={`tile !text-sm ${here ? '!border-mach-500 !bg-mach-500/15' : '!text-ink-400'}`}
              >
                {s.symbol ?? 'abc'}
                {solvedIn(n) === total && <span className="ml-1 text-[var(--color-good)]">✓</span>}
              </button>
            );
          })}
        </div>

        <Panel>
          <div className={`mb-4 rounded-xl border p-3 text-sm ${firstOfStation ? 'border-mach-500/40 bg-mach-500/8 text-ink-200' : 'border-ink-700 text-ink-400'}`}>
            <b className="mr-1 font-mono text-mach-400">{station.symbol ?? 'abc'}</b>
            <span className="mr-1 font-semibold">{station.title}.</span>
            {station.intro}
          </div>

          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-lg text-ink-100">{puzzle.title}</p>
              <p className="mt-1 font-mono text-xs text-ink-500">
                par: <b className="text-ink-300">{par}</b> characters
              </p>
            </div>
            <span className="shrink-0 font-mono text-xs text-ink-500">
              {index + 1}/{GOLF_PUZZLES.length}
              {solvedBefore && <span className="ml-2 text-[var(--color-good)]">✓</span>}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 rounded-xl border border-ink-700 bg-ink-950/50 p-3">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-good)]">Match all of these</p>
              <ul className="flex flex-col gap-1">
                {puzzle.match.map((w) => (
                  <Word key={w} word={w} want find={find} />
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-bad)]">…and none of these</p>
              <ul className="flex flex-col gap-1">
                {puzzle.reject.map((w) => (
                  <Word key={w} word={w} want={false} find={find} />
                ))}
              </ul>
            </div>
          </div>
          {emptyMatch && (
            <p className="mt-2 text-xs text-ink-400">
              <span className="text-mach-400">▏</span> marks an empty match: the pattern found "nothing" there, and
              that counts as finding something. That is why <code>a*</code> on its own matches every word.
            </p>
          )}

          <div className="mt-4">
            <PatternInput
              value={src}
              onChange={(v) => {
                setSrc(v);
                setResult(null);
              }}
              palette={palette}
              placeholder="type a pattern"
              ariaLabel="Your pattern"
              onEnter={submit}
              inputClassName="font-mono text-xl"
            />
          </div>

          {check && !check.ok && (
            <p className={`mt-3 text-sm ${check.incomplete ? 'text-ink-400' : 'text-[var(--color-bad)]'}`} role="status">
              {check.message}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={submit} disabled={!allRight || result?.src === src}>
              {allRight ? 'Every word is right — submit' : find ? 'Not every word is right yet' : 'Submit'}
            </Button>
            <Button onClick={next}>{solvedBefore || result ? 'Next →' : 'Skip'}</Button>
          </div>

          {result && (
            <div className="mt-4">
              <Verdict ok title={result.length <= result.par ? `At par or better. +${result.score} points` : `Solved. +${result.score} points`}>
                {result.length > result.par && (
                  <p className="text-ink-400">
                    {result.length} characters; par is {result.par}. There is a shorter way.
                  </p>
                )}
                {puzzle.note && <p className="mt-1 text-ink-200">{puzzle.note}</p>}
              </Verdict>
            </div>
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-4 xl:w-80 xl:shrink-0">
        <Panel>
          <h4 className="mb-2 text-sm font-semibold text-ink-200">Which regex is this?</h4>
          <p className="text-sm leading-relaxed text-ink-300">
            Just "regular expression". Everything accepted here works the same in every common flavor —
            JavaScript, Python, Java, Go, PCRE, POSIX <code>grep -E</code>. Extras that only some flavors have
            (<code>\d</code>, <code>\b</code>, lookahead, backreferences) are refused, with a note saying what to
            write instead. Where flavors differ on WHICH part of a word is the match, the highlight shows the
            longest match at the leftmost place, as <code>grep -o</code> does.
          </p>
          <h4 className="mb-2 mt-4 text-sm font-semibold text-ink-200">And the regex of the theory?</h4>
          <p className="mb-2 text-sm text-ink-300">
            Every symbol here is a shorthand for the three you met in "Say it in one line":
          </p>
          <ul className="flex flex-col gap-1 font-mono text-sm text-ink-300">
            <li>[abc] = (a|b|c)</li>
            <li>x+ = xx*</li>
            <li>x? = (x|ε)</li>
            <li>x{'{2,3}'} = xxx?</li>
            <li>golf "r" = (any)* r (any)*</li>
            <li>^ and $ remove the (any)* on their side</li>
          </ul>
          <p className="mt-3 border-t border-ink-700 pt-2 text-xs text-ink-500">
            Backreferences are the one popular extra that is NOT a shorthand: <code>(a*)b\1</code> describes a
            language no finite machine can recognise. That is level 8's wall, from the other side. And the
            matching here is done the way the lesson teaches: your pattern becomes a machine, which reads each
            word once.
          </p>
        </Panel>

        <NicknameGate />
        <Leaderboard
          board={GOLF_BOARD}
          par={GOLF_PAR}
          entries={board.entries}
          mode={board.mode}
          best={board.best}
          metric={(d) => `${d.solved} holes`}
        />
      </div>
    </div>
  );
}
