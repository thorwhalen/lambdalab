/**
 * Say the same thing as a machine — but in one line.
 *
 * The learner writes a regular expression for the same target languages they
 * built machines for. Same grading, same counterexamples: their regex is turned
 * into a machine (Thompson) and checked for equivalence against the target, and
 * a mismatch produces the shortest string they get wrong.
 *
 * The regex here is the regex of the THEORY — union, concatenation, star, and
 * nothing else (plus + and ? as honest abbreviations). No backreferences, no
 * lookahead, no \d. That is not a simplification for children's benefit: those
 * extras are precisely the features that take you *outside* the regular
 * languages, and the whole lesson is about where that boundary is. A child who
 * learns this regex has learned the real thing; the extra syntax in a programming
 * language is a separate, lesser story.
 */
import { useEffect, useMemo, useState } from 'react';
import { parseRegex, regexSize, renderRegex, simplifyRegex } from '../../lib/automata/regexParse';
import { regexToNFA } from '../../lib/automata/thompson';
import { equivalent } from '../../lib/automata/equivalence';
import { accepts } from '../../lib/automata/simulate';
import { AutomatonCanvas } from '../../components/AutomatonCanvas';
import { Button, Panel, Verdict } from '../../components/ui';
import { Leaderboard, NicknameGate, useLeaderboard } from '../../components/Leaderboard';
import { NO_SOLVES, checkAdvance, useProgress } from '../../core/progress';
import {
  LADDER,
  LANGUAGE_PUZZLES,
  MAX_LEVEL,
  REGEX_BOARD,
  REGEX_PAR,
  boardTotal,
  solveLevel,
} from './content';

const LESSON_ID = 'automata-regex';

/** Shorter regexes score higher — golf, with a par you can actually reach. */
const BASE_PER_LEVEL = 110;
const OVER_PAR_COST = 25;
const FLOOR_FRACTION = 0.4;

function scoreFor(level: number, size: number, par: number): number {
  const base = BASE_PER_LEVEL * level;
  const penalty = Math.max(0, size - par) * OVER_PAR_COST;
  return Math.round(Math.max(base * FLOOR_FRACTION, base - penalty));
}

export function RegexLab({ level }: { level: number }) {
  const [index, setIndex] = useState(0);
  const [src, setSrc] = useState('');
  const [result, setResult] = useState<
    | null
    | { ok: true; score: number; size: number }
    | { ok: false; kind: 'parse'; message: string }
    | { ok: false; kind: 'language'; counterexample: string; weAccept: boolean }
  >(null);
  const [unlocked, setUnlocked] = useState<number | null>(null);

  const { recordSolve } = useProgress();
  const solvedMap = useProgress((s) => s.lessons[LESSON_ID]?.solved ?? NO_SOLVES);
  const board = useLeaderboard(REGEX_BOARD);

  const pool = useMemo(
    () => LANGUAGE_PUZZLES.filter((p) => p.level <= level && !p.impossible),
    [level],
  );
  const puzzle = pool[index % Math.max(1, pool.length)];

  const target = useMemo(() => {
    if (!puzzle) return null;
    const p = parseRegex(puzzle.regex);
    return p.ok ? regexToNFA(p.node) : null;
  }, [puzzle]);

  /** Par is the size of the reference regex, simplified. Ties are the goal. */
  const par = useMemo(() => {
    if (!puzzle) return 0;
    const p = parseRegex(puzzle.regex);
    return p.ok ? regexSize(simplifyRegex(p.node)) : 0;
  }, [puzzle]);

  // Live preview: parse as they type, build the machine, run the examples.
  const parsed = useMemo(() => (src.trim() ? parseRegex(src) : null), [src]);
  const preview = useMemo(
    () => (parsed?.ok ? regexToNFA(parsed.node) : null),
    [parsed],
  );

  useEffect(() => {
    setSrc('');
    setResult(null);
    setUnlocked(null);
  }, [puzzle]);

  if (!puzzle || !target) {
    return (
      <Panel>
        <p className="text-ink-400">No regex puzzles at this rung yet.</p>
      </Panel>
    );
  }

  const check = () => {
    const p = parseRegex(src);
    if (!p.ok) {
      setResult({ ok: false, kind: 'parse', message: p.message });
      return;
    }
    const mine = regexToNFA(p.node);
    const eq = equivalent(mine, target);
    if (!eq.equal) {
      setResult({
        ok: false,
        kind: 'language',
        counterexample: eq.counterexample,
        weAccept: eq.acceptedBy === 'a',
      });
      return;
    }
    const size = regexSize(simplifyRegex(p.node));
    const pts = scoreFor(puzzle.level, size, par);
    setResult({ ok: true, score: pts, size });
    recordSolve(LESSON_ID, `re-${puzzle.id}`, pts);

    const { total, solved } = boardTotal(solvedMap, `re-${puzzle.id}`, pts);
    void board.submit(total, { solved });

    const up = checkAdvance(LESSON_ID, puzzle.level, LADDER[puzzle.level - 1].toAdvance, solveLevel, MAX_LEVEL);
    if (up) setUnlocked(up);
  };

  // Symbols offered as buttons, gated by the ladder — same disclosure discipline
  // as the logic palette: you cannot use ? before it has been introduced.
  const SYMS: Array<{ s: string; gloss: string; from: number }> = [
    ...puzzle.alphabet.map((c) => ({ s: c, gloss: `the letter ${c}`, from: 1 })),
    { s: '(', gloss: 'group', from: 3 },
    { s: ')', gloss: 'group', from: 3 },
    { s: '|', gloss: 'or — either side', from: 3 },
    { s: '*', gloss: 'zero or more of the thing before', from: 3 },
    { s: '+', gloss: 'one or more', from: 4 },
    { s: '?', gloss: 'optional — zero or one', from: 4 },
    { s: 'ε', gloss: 'the empty string', from: 4 },
    { s: '∅', gloss: 'nothing at all — matches no string', from: 4 },
  ];

  return (
    <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
      <div className="min-w-0 flex-1">
        <Panel>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="mb-1 text-sm text-ink-500">Write a pattern that matches exactly:</p>
              <p className="text-lg text-ink-100">{puzzle.prompt}</p>
              <p className="mt-1 font-mono text-xs text-ink-500">
                par: <b className="text-ink-300">{par}</b> pieces
              </p>
            </div>
            <span className="shrink-0 font-mono text-xs text-ink-500">
              {index + 1}/{pool.length}
              {solvedMap[`re-${puzzle.id}`] && <span className="ml-2 text-[var(--color-good)]">✓</span>}
            </span>
          </div>

          <input
            value={src}
            onChange={(e) => {
              setSrc(e.target.value);
              setResult(null);
            }}
            placeholder="e.g.  (a|b)*ab"
            spellCheck={false}
            className="math w-full rounded-xl border border-ink-600 bg-ink-950 px-4 py-3 text-xl
              text-ink-100 outline-none placeholder:text-ink-600 focus:border-mach-500"
          />

          <div className="mt-2 flex flex-wrap gap-1.5">
            {SYMS.filter((x) => x.from <= level).map(({ s, gloss }) => (
              <button
                key={s}
                title={gloss}
                className="tile !min-w-9 !py-1"
                onClick={() => {
                  setSrc((v) => v + s);
                  setResult(null);
                }}
              >
                {s}
              </button>
            ))}
            <button
              className="tile !min-w-9 !py-1 !text-sm"
              onClick={() => setSrc((v) => v.slice(0, -1))}
              disabled={!src}
            >
              ⌫
            </button>
          </div>

          {/* Live feedback while typing — the examples tick over as the pattern
              gets closer. This is the whole "direct manipulation" bet. */}
          {parsed && !parsed.ok && src.trim() && (
            <p className="mt-3 text-sm text-[var(--color-bad)]">{parsed.message}</p>
          )}

          {preview && (
            <div className="mt-4">
              <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="text-ink-500">Live check:</span>
                {[...puzzle.accept.map((s) => ({ s, want: true })), ...puzzle.reject.map((s) => ({ s, want: false }))].map(
                  ({ s, want }) => {
                    const got = accepts(preview, s);
                    return (
                      <span
                        key={`${want}-${s}`}
                        className={`font-mono ${got === want ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}`}
                      >
                        {got === want ? '✓' : '✗'} {s === '' ? 'ε' : s}
                      </span>
                    );
                  },
                )}
              </div>
              {level >= 7 && (
                <details className="rounded-xl border border-ink-700 bg-ink-900/40 p-3">
                  <summary className="cursor-pointer text-sm text-ink-400">
                    Show the machine your pattern builds (Thompson's construction)
                  </summary>
                  <div className="mt-3">
                    <AutomatonCanvas automaton={preview} readOnly height={280} />
                    <p className="mt-2 text-xs text-ink-600">
                      Every piece of the pattern became a little machine, and they were glued
                      together with free ε-jumps. It is bigger than it needs to be — that is what
                      minimisation is for.
                    </p>
                  </div>
                </details>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={check} disabled={!src.trim()}>
              Check my pattern
            </Button>
            <Button onClick={() => setIndex((i) => (i + 1) % Math.max(1, pool.length))}>Skip</Button>
          </div>

          {result && !result.ok && result.kind === 'parse' && (
            <div className="mt-4">
              <Verdict ok={false} title="That is not a well-formed pattern">
                {result.message}
              </Verdict>
            </div>
          )}

          {result && !result.ok && result.kind === 'language' && (
            <div className="mt-4">
              <Verdict ok={false} title="Wrong language — and here is the proof">
                Your pattern{' '}
                <b>{result.weAccept ? 'matches' : 'does not match'}</b>{' '}
                <code className="rounded bg-ink-950 px-1.5 py-0.5 font-mono text-ink-100">
                  {result.counterexample === '' ? 'ε (the empty string)' : result.counterexample}
                </code>
                , and it should{' '}
                <b className="text-[var(--color-good)]">{result.weAccept ? 'not' : ''}</b>. That is
                the shortest string you get wrong.
              </Verdict>
            </div>
          )}

          {result && result.ok && (
            <div className="mt-4">
              <Verdict
                ok
                title={
                  result.size <= par
                    ? `Exactly right, and you matched par. +${result.score} points`
                    : `Right. +${result.score} points`
                }
              >
                {parsed?.ok && (
                  <p className="math mt-1 text-lg text-ink-100">{renderRegex(simplifyRegex(parsed.node))}</p>
                )}
                {result.size > par && (
                  <p className="mt-1 text-ink-400">
                    {result.size} pieces; par is {par}. There is a shorter way to say it.
                  </p>
                )}
                {puzzle.note && <p className="mt-2 text-ink-200">{puzzle.note}</p>}
              </Verdict>
              {unlocked && (
                <div className="mt-3 rounded-xl border border-mach-500/50 bg-mach-500/12 p-3 text-sm">
                  <b className="text-mach-400">Level {unlocked} reached</b> —{' '}
                  <span className="text-ink-300">{LADDER[unlocked - 1].goal}</span>
                </div>
              )}
              <Button
                variant="primary"
                className="mt-3"
                onClick={() => setIndex((i) => (i + 1) % Math.max(1, pool.length))}
              >
                Next →
              </Button>
            </div>
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-4 xl:w-72 xl:shrink-0">
        <Panel>
          <h4 className="mb-2 text-sm font-semibold text-ink-200">The whole language</h4>
          <ul className="flex flex-col gap-1.5 text-sm text-ink-300">
            <li>
              <code className="math text-ink-100">ab</code> — an <code>a</code> then a{' '}
              <code>b</code>
            </li>
            <li>
              <code className="math text-ink-100">a|b</code> — an <code>a</code> or a{' '}
              <code>b</code>
            </li>
            <li>
              <code className="math text-ink-100">a*</code> — any number of <code>a</code>s,{' '}
              <b>including none</b>
            </li>
            {level >= 4 && (
              <>
                <li>
                  <code className="math text-ink-100">a+</code> — one or more
                </li>
                <li>
                  <code className="math text-ink-100">a?</code> — none or one
                </li>
                <li>
                  <code className="math text-ink-100">ε</code> — the empty string
                </li>
                <li>
                  <code className="math text-ink-100">∅</code> — nothing at all
                </li>
              </>
            )}
          </ul>
          <p className="mt-3 border-t border-ink-700 pt-2 text-xs text-ink-600">
            That is genuinely all of it. Every regular language there is can be written with these,
            and nothing that <em>cannot</em> be written with these is regular.
          </p>
        </Panel>

        <NicknameGate />
        <Leaderboard
          board={REGEX_BOARD}
          par={REGEX_PAR}
          entries={board.entries}
          mode={board.mode}
          best={board.best}
          metric={(d) => `${d.solved} solved`}
        />
      </div>
    </div>
  );
}
