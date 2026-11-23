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
 *     the symbols met so far, the palette showing exactly those;
 *   - the EVIDENCE: every word shows, live, whether the pattern found something
 *     in it and WHERE (the matched part is highlighted), so "it found cat inside
 *     concatenate" is visible, not explained.
 *
 * Stations are progressive disclosure, not gates: every station can be opened at
 * any time; solving is what moves the "you are here" marker along.
 */
import { useMemo, useState } from 'react';
import { CORE_SYMBOLS, checkCore, firstMatch } from '../../lib/coreRegex';
import { Button, Panel, Verdict } from '../../components/ui';
import { Leaderboard, NicknameGate, useLeaderboard } from '../../components/Leaderboard';
import { NO_SOLVES, useProgress } from '../../core/progress';
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

const glossOf = (symbol: string) => CORE_SYMBOLS.find((s) => s.symbol === symbol)?.gloss ?? '';

/** What a palette button inserts for a symbol. Brackets come as a pair, ready to fill. */
const INSERT: Record<string, string> = { '[]': '[]', '[^]': '[^]', '()': '()', '{}': '{}', '[a-z]': '-' };

function Word({ word, want, regex }: { word: string; want: boolean; regex: RegExp | null }) {
  const m = regex ? firstMatch(regex, word) : null;
  const ok = regex ? (m !== null) === want : null;
  const tone =
    ok === null ? 'text-ink-300' : ok ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]';
  return (
    <li className={`flex items-baseline gap-2 font-mono ${tone}`}>
      <span className="w-4 shrink-0 text-center">{ok === null ? '·' : ok ? '✓' : '✗'}</span>
      <span className="text-ink-100">
        {m ? (
          <>
            {word.slice(0, m.index)}
            {m.length > 0 ? (
              <mark className="rounded bg-mach-500/35 px-0.5 text-ink-50">{word.slice(m.index, m.index + m.length)}</mark>
            ) : (
              <span className="text-mach-400" title="an empty match: the pattern found nothing, successfully">
                ▏
              </span>
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
  const [result, setResult] = useState<null | { score: number; length: number; par: number }>(null);

  const puzzle = GOLF_PUZZLES[index];
  const station = GOLF_STATIONS[puzzle.station];
  const par = golfPar(puzzle);
  const met = useMemo(() => [...symbolsMetBy(puzzle.station)], [puzzle.station]);
  const firstOfStation = GOLF_PUZZLES.findIndex((p) => p.station === puzzle.station) === index;

  const check = useMemo(() => (src ? checkCore(src) : null), [src]);
  const regex = check?.ok ? check.regex : null;
  const allRight =
    !!regex && puzzle.match.every((w) => regex.test(w)) && puzzle.reject.every((w) => !regex.test(w));

  const go = (i: number) => {
    setIndex(i);
    setSrc('');
    setResult(null);
  };

  const submit = () => {
    if (!allRight) return;
    const score = golfScore(puzzle.station, src.length, par);
    setResult({ score, length: src.length, par });
    recordSolve(LESSON_ID, solveKey(puzzle.id), score);
    const golfSolves = Object.entries({ ...solvedMap, [solveKey(puzzle.id)]: { best: score } }).filter(([k]) =>
      k.startsWith('golf-'),
    );
    const total = golfSolves.reduce((s, [, r]) => s + r.best, 0);
    void board.submit(total, { solved: golfSolves.length });
  };

  const solvedIn = (n: number) =>
    GOLF_PUZZLES.filter((p) => p.station === n && solvedMap[solveKey(p.id)]).length;

  return (
    <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
      <div className="min-w-0 flex-1">
        {/* The path: every station visible and openable; ✓ when all its holes are done. */}
        <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Stations">
          {GOLF_STATIONS.map((s, n) => {
            const total = GOLF_PUZZLES.filter((p) => p.station === n).length;
            const done = solvedIn(n);
            const here = n === puzzle.station;
            return (
              <button
                key={s.title}
                onClick={() => go(GOLF_PUZZLES.findIndex((p) => p.station === n))}
                title={s.title}
                className={`min-h-9 rounded-lg border px-2.5 py-1 font-mono text-sm transition
                  ${here ? 'border-mach-500 bg-mach-500/15 text-ink-100' : 'border-ink-600 text-ink-400'}`}
              >
                {s.symbol ?? 'abc'}
                {done === total && <span className="ml-1 text-[var(--color-good)]">✓</span>}
              </button>
            );
          })}
        </div>

        <Panel>
          {firstOfStation && (
            <div className="mb-4 rounded-xl border border-mach-500/40 bg-mach-500/8 p-3 text-sm text-ink-200">
              <b className="mr-1 font-mono text-mach-400">{station.symbol ?? 'abc'}</b> {station.intro}
            </div>
          )}

          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-lg text-ink-100">{puzzle.title}</p>
              <p className="mt-1 font-mono text-xs text-ink-500">
                par: <b className="text-ink-300">{par}</b> characters
              </p>
            </div>
            <span className="shrink-0 font-mono text-xs text-ink-500">
              {index + 1}/{GOLF_PUZZLES.length}
              {solvedMap[solveKey(puzzle.id)] && <span className="ml-2 text-[var(--color-good)]">✓</span>}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 rounded-xl border border-ink-700 bg-ink-950/50 p-3">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-good)]">Match all of these</p>
              <ul className="flex flex-col gap-1">
                {puzzle.match.map((w) => (
                  <Word key={w} word={w} want regex={regex} />
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-bad)]">…and none of these</p>
              <ul className="flex flex-col gap-1">
                {puzzle.reject.map((w) => (
                  <Word key={w} word={w} want={false} regex={regex} />
                ))}
              </ul>
            </div>
          </div>

          <input
            value={src}
            onChange={(e) => {
              setSrc(e.target.value);
              setResult(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="type a pattern"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Your pattern"
            className="mt-4 w-full rounded-xl border border-ink-600 bg-ink-950 px-4 py-3 font-mono text-xl
              text-ink-100 outline-none placeholder:text-ink-600 focus:border-mach-500"
          />

          <div className="mt-2 flex flex-wrap gap-1.5">
            {met.map((s) => (
              <button
                key={s}
                title={glossOf(s)}
                className="tile !min-w-9 !py-1 font-mono"
                onClick={() => {
                  setSrc((v) => v + (INSERT[s] ?? s));
                  setResult(null);
                }}
              >
                {s}
              </button>
            ))}
            <button className="tile !min-w-9 !py-1 !text-sm" onClick={() => setSrc((v) => v.slice(0, -1))} disabled={!src}>
              ⌫
            </button>
          </div>

          {check && !check.ok && (
            <p className="mt-3 text-sm text-[var(--color-bad)]" role="status">
              {check.message}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={submit} disabled={!allRight}>
              {allRight ? 'Every word is right — submit' : regex ? 'Not every word is right yet' : 'Submit'}
            </Button>
            <Button onClick={() => go((index + 1) % GOLF_PUZZLES.length)}>Skip</Button>
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
              <Button variant="primary" className="mt-3" onClick={() => go((index + 1) % GOLF_PUZZLES.length)}>
                Next →
              </Button>
            </div>
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-4 xl:w-80 xl:shrink-0">
        <Panel>
          <h4 className="mb-2 text-sm font-semibold text-ink-200">Which regex is this?</h4>
          <p className="text-sm leading-relaxed text-ink-300">
            Just "regular expression". Everything here works the same in every common flavor —
            JavaScript, Python, Java, Go, PCRE, POSIX <code>grep -E</code>. Extras that only some
            flavors have (<code>\d</code>, <code>\b</code>, lookahead, backreferences) are refused,
            with a note saying what to write instead.
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
            Backreferences are the one popular extra that is NOT a shorthand: <code>(a*)b\1</code>{' '}
            describes a language no finite machine can recognise. That is level 8's wall, from the
            other side.
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
