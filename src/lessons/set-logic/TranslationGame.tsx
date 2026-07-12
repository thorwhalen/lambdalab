/**
 * The translation game — both directions.
 *
 * READ IT:  here is a formula. What does it say? (multiple choice)
 * WRITE IT: here is a sentence. Build the formula. (click the tiles)
 *
 * The two directions are not the same skill, and a learner who can do one and
 * not the other has not learned the notation — they have learned to pattern-match
 * it. So the game insists on both, and a level is not cleared by doing only the
 * easy direction.
 *
 * When you are wrong, you get a WORLD. Not a red cross — a world: three blobs,
 * some of them dogs, some of them red, drawn on screen, in which the sentence you
 * gave and the sentence you were asked for have different truth values. That
 * little picture is the entire pedagogical bet of this lesson.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Formula, Model } from '../../lib/logic/types';
import { parseFormula, renderFormula } from '../../lib/logic/parse';
import { logicEquivalent } from '../../lib/logic/equivalence';
import { evaluate } from '../../lib/logic/evaluate';
import { NO_SOLVES, checkAdvance, useProgress } from '../../core/progress';
import { Button, Panel, Verdict } from '../../components/ui';
import { FormulaStrip, TilePalette, useFormulaTokens } from '../../components/FormulaBuilder';
import { LittleWorld } from '../../components/LittleWorld';
import { Leaderboard, NicknameGate, useLeaderboard } from '../../components/Leaderboard';
import {
  LADDER,
  MAX_LEVEL,
  TRANSLATE_BOARD,
  TRANSLATE_PAR,
  TRANSLATE_PUZZLES,
  paletteFor,
  puzzleLevel,
  type Distractor,
  type TranslatePuzzle,
} from './content';

const LESSON_ID = 'set-logic';

// --- scoring ----------------------------------------------------------------

/**
 * Points for solving a puzzle. Deeper rungs are worth more; getting it first go
 * is worth more than grinding it out; a hint costs you. Nothing here is subtle —
 * the learner should be able to predict their own score, or the number is noise.
 */
const BASE_PER_LEVEL = 100;
const FIRST_TRY_BONUS = 50;
const HINT_COST = 30;
const MIN_SCORE = 20;

function scoreFor(level: number, attempts: number, usedHint: boolean): number {
  const base = BASE_PER_LEVEL * level;
  const firstTry = attempts === 1 ? FIRST_TRY_BONUS : 0;
  const penalty = (usedHint ? HINT_COST : 0) + (attempts - 1) * 20;
  return Math.max(MIN_SCORE, base + firstTry - penalty);
}

/** A stable shuffle, so the options don't jump around between renders. */
function shuffled<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- the counterexample panel — the whole point -----------------------------

function CounterWorld({
  model,
  puzzle,
  theirs,
  theirFormula,
  because,
}: {
  model: Model;
  puzzle: TranslatePuzzle;
  /** Truth value of the learner's sentence in this world. */
  theirs: boolean;
  theirFormula: Formula;
  because?: string;
}) {
  const nouns = Object.fromEntries(
    Object.entries(puzzle.nouns ?? {}).map(([k, v]) => [k, v.plural]),
  );
  const refFormula = parseFormula(puzzle.formal, puzzle.sig);
  const refValue = refFormula.ok ? evaluate(refFormula.formula, model) : !theirs;

  return (
    <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900/60 p-4">
      <p className="mb-3 text-sm text-ink-300">
        Here is a world. Look at it, and check both sentences against it yourself.
      </p>

      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <LittleWorld model={model} labels={nouns} className="md:w-1/2" />

        <div className="flex flex-1 flex-col gap-2 text-sm">
          <div className="rounded-lg border border-[var(--color-bad)]/40 bg-[var(--color-bad)]/8 p-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-bad)]">
              What you said
            </div>
            <div className="math text-lg text-ink-100">{renderFormula(theirFormula)}</div>
            <div className="mt-1 font-mono text-xs text-ink-400">
              in this world: <b className={theirs ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}>{theirs ? 'TRUE' : 'FALSE'}</b>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--color-good)]/40 bg-[var(--color-good)]/8 p-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-good)]">
              What you were asked for
            </div>
            <div className="text-ink-200">“{puzzle.english}”</div>
            <div className="mt-1 font-mono text-xs text-ink-400">
              in this world: <b className={refValue ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}>{refValue ? 'TRUE' : 'FALSE'}</b>
            </div>
          </div>

          <p className="text-ink-400">
            The two sentences disagree here. So they are not the same sentence — however
            similar they look.
          </p>
          {because && <p className="text-ink-300">{because}</p>}
        </div>
      </div>
    </div>
  );
}

// --- the game ---------------------------------------------------------------

type Mode = 'read' | 'write';

interface Wrong {
  model: Model;
  theirs: boolean;
  theirFormula: Formula;
  because?: string;
}

export function TranslationGame({ level }: { level: number }) {
  const [mode, setMode] = useState<Mode>('read');
  const [index, setIndex] = useState(0);
  const [wrong, setWrong] = useState<Wrong | null>(null);
  /** In READ mode: the option the learner clicked, by its formula source. */
  const [chosen, setChosen] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [unlocked, setUnlocked] = useState<number | null>(null);

  const tokens = useFormulaTokens();
  const { recordSolve } = useProgress();
  const solvedMap = useProgress((s) => s.lessons[LESSON_ID]?.solved ?? NO_SOLVES);
  const board = useLeaderboard(TRANSLATE_BOARD);

  const pool = useMemo(() => TRANSLATE_PUZZLES.filter((p) => p.level === level), [level]);
  const puzzle = pool[index % Math.max(1, pool.length)];

  const reference = useMemo(
    () => (puzzle ? parseFormula(puzzle.formal, puzzle.sig) : null),
    [puzzle],
  );

  /** Options for READ mode: the true reading plus each distractor's reading. */
  const options = useMemo(() => {
    if (!puzzle) return [];
    const all: Array<{ english: string; formal: string; correct: boolean; because?: string }> = [
      { english: puzzle.english, formal: puzzle.formal, correct: true },
      ...puzzle.distractors.map((d: Distractor) => ({
        english: d.english,
        formal: d.formal,
        correct: false,
        because: d.because,
      })),
    ];
    return shuffled(all, puzzle.id + mode);
  }, [puzzle, mode]);

  const reset = useCallback(() => {
    setWrong(null);
    setChosen(null);
    setParseError(null);
    setSolved(false);
    setAttempts(0);
    setShowHint(false);
    setUnlocked(null);
    tokens.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const next = () => {
    reset();
    setIndex((i) => (i + 1) % Math.max(1, pool.length));
  };

  const succeed = useCallback(() => {
    if (!puzzle) return;
    const n = attempts + 1;
    setAttempts(n);
    setSolved(true);
    setWrong(null);
    setParseError(null);
    const pts = scoreFor(puzzle.level, n, showHint);
    recordSolve(LESSON_ID, puzzle.id, pts);

    // The board carries the SUM of the learner's bests — a cumulative measure of
    // how much of the lesson they have actually conquered, not a single lucky run.
    const bests = { ...solvedMap, [puzzle.id]: { best: pts, attempts: n, solvedAt: Date.now() } };
    const total = Object.values(bests).reduce((s, r) => s + r.best, 0);
    void board.submit(total, { solved: Object.keys(bests).length });

    const up = checkAdvance(LESSON_ID, puzzle.level, LADDER[puzzle.level - 1].toAdvance, puzzleLevel, MAX_LEVEL);
    if (up) setUnlocked(up);
  }, [puzzle, attempts, showHint, recordSolve, solvedMap, board]);

  const fail = useCallback(
    (theirFormula: Formula, because?: string) => {
      if (!puzzle || !reference?.ok) return;
      setAttempts((a) => a + 1);
      // Grade at the widest scope this signature can afford. A binary relation is
      // what makes a fourth element expensive (2^(n²) rather than 2^n), so a
      // relation-free puzzle gets the extra element nearly free — and a wider
      // scope means fewer near-miss answers slip through as "correct".
      const eq = logicEquivalent(theirFormula, reference.formula, puzzle.sig, {
        maxDomain: puzzle.sig.relations.length === 0 ? 4 : 3,
      });
      if (eq.equal) {
        // They wrote something *different-looking but logically the same*. That
        // is a correct answer, and calling it wrong would be a lie.
        succeed();
        return;
      }
      setWrong({ model: eq.model, theirs: eq.theirs, theirFormula, because });
    },
    [puzzle, reference, succeed],
  );

  if (!puzzle || !reference?.ok) {
    return (
      <Panel>
        <p className="text-ink-400">No puzzles at this level yet.</p>
      </Panel>
    );
  }

  const alreadySolved = !!solvedMap[puzzle.id];
  const palette = paletteFor(puzzle.sig, level);

  const check = () => {
    setParseError(null);
    const r = parseFormula(tokens.tokens, puzzle.sig);
    if (!r.ok) {
      setParseError(r.message);
      return;
    }
    fail(r.formula);
  };

  return (
    <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
      <div className="min-w-0 flex-1">
        <Panel>
          {/* Direction switch. */}
          <div className="mb-5 flex items-center gap-2">
            <div className="flex rounded-lg border border-ink-700 p-0.5">
              {(['read', 'write'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m);
                    reset();
                  }}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    mode === m ? 'bg-lam-500 text-white' : 'text-ink-400 hover:text-ink-100'
                  }`}
                >
                  {m === 'read' ? 'Read it' : 'Write it'}
                </button>
              ))}
            </div>
            <span className="ml-auto font-mono text-xs text-ink-500">
              {index + 1}/{pool.length} · level {level}
              {alreadySolved && <span className="ml-2 text-[var(--color-good)]">✓ solved</span>}
            </span>
          </div>

          {mode === 'read' ? (
            <>
              <p className="mb-2 text-sm text-ink-400">What does this say?</p>
              <div className="formula mb-5 rounded-xl border border-ink-700 bg-ink-950 px-5 py-4 text-ink-100">
                {renderFormula(reference.formula)}
              </div>

              <div className="flex flex-col gap-2">
                {options.map((o) => (
                  <button
                    key={o.formal}
                    disabled={solved}
                    onClick={() => {
                      const p = parseFormula(o.formal, puzzle.sig);
                      if (!p.ok) return;
                      setChosen(o.formal);
                      if (o.correct) succeed();
                      else fail(p.formula, o.because);
                    }}
                    className={`rounded-xl border px-4 py-3 text-left text-ink-200 transition
                      disabled:cursor-not-allowed
                      ${
                        solved && o.correct
                          ? 'border-[var(--color-good)]/60 bg-[var(--color-good)]/12'
                          : chosen === o.formal && wrong
                            ? 'border-[var(--color-bad)]/60 bg-[var(--color-bad)]/10'
                            : 'border-ink-700 hover:border-lam-500/60 hover:bg-ink-800/60'
                      }`}
                  >
                    {o.english}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="mb-2 text-sm text-ink-400">Write this in symbols:</p>
              <div className="mb-4 rounded-xl border border-ink-700 bg-ink-950 px-5 py-4 text-lg text-ink-100">
                “{puzzle.prompt}”
              </div>

              <FormulaStrip tokens={tokens.tokens} onTruncate={tokens.truncate} />

              <div className="my-3 flex gap-2">
                <Button variant="primary" onClick={check} disabled={tokens.tokens.length === 0 || solved}>
                  Check
                </Button>
                <Button onClick={tokens.backspace} disabled={!tokens.tokens.length}>
                  ⌫
                </Button>
                <Button onClick={tokens.clear} disabled={!tokens.tokens.length}>
                  Clear
                </Button>
              </div>

              <div className="rounded-xl border border-ink-700 bg-ink-900/50 p-3">
                <TilePalette tiles={palette} level={level} onPick={(t) => tokens.push(t.token)} freshLevel={level} />
              </div>
            </>
          )}

          {/* Feedback. */}
          {parseError && (
            <div className="mt-4">
              <Verdict ok={false} title="That is not a well-formed sentence yet">
                {parseError}
              </Verdict>
            </div>
          )}

          {wrong && (
            <div className="mt-4">
              <Verdict ok={false} title="Not quite — and here is the proof">
                Your sentence and the right one are not the same. Watch:
              </Verdict>
              <CounterWorld
                model={wrong.model}
                puzzle={puzzle}
                theirs={wrong.theirs}
                theirFormula={wrong.theirFormula}
                because={wrong.because}
              />
              <div className="mt-3 flex gap-2">
                <Button
                  onClick={() => {
                    setWrong(null);
                    setChosen(null);
                    if (mode === 'write') tokens.clear();
                  }}
                >
                  Try again
                </Button>
                {puzzle.hint && !showHint && (
                  <Button onClick={() => setShowHint(true)} title={`Costs ${HINT_COST} points`}>
                    Hint (−{HINT_COST})
                  </Button>
                )}
              </div>
            </div>
          )}

          {showHint && puzzle.hint && !solved && (
            <div className="mt-3 rounded-xl border border-info-500/35 bg-info-500/8 p-3 text-sm text-ink-200">
              {puzzle.hint}
            </div>
          )}

          {solved && (
            <div className="mt-4">
              <Verdict ok={true} title={`Yes. +${scoreFor(puzzle.level, attempts, showHint)} points`}>
                <div className="math mt-1 text-lg text-ink-100">{renderFormula(reference.formula)}</div>
                <div className="mt-1">“{puzzle.english}”</div>
                {puzzle.trap && (
                  <p className="mt-2 text-ink-400">
                    This one was about the <b className="text-ink-200">{puzzle.trap.replace(/-/g, ' ')}</b> trap.
                  </p>
                )}
                {puzzle.note && <p className="mt-2 text-ink-200">{puzzle.note}</p>}
              </Verdict>

              {unlocked && (
                <div className="mt-3 rounded-xl border border-lam-500/50 bg-lam-500/12 p-3 text-sm">
                  <b className="text-lam-400">Level {unlocked} unlocked</b> —{' '}
                  <span className="text-ink-300">{LADDER[unlocked - 1].goal}</span>
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <Button variant="primary" onClick={next}>
                  Next puzzle →
                </Button>
                <Button
                  onClick={() => {
                    reset();
                    setMode(mode === 'read' ? 'write' : 'read');
                  }}
                >
                  Now do it the other way round
                </Button>
              </div>
            </div>
          )}

          {!solved && !wrong && !parseError && (
            <div className="mt-4 flex gap-2">
              {puzzle.hint && !showHint && (
                <Button onClick={() => setShowHint(true)} title={`Costs ${HINT_COST} points`}>
                  Hint (−{HINT_COST})
                </Button>
              )}
              <Button onClick={next}>Skip</Button>
            </div>
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-4 xl:w-72 xl:shrink-0">
        <NicknameGate />
        <Leaderboard
          board={TRANSLATE_BOARD}
          par={TRANSLATE_PAR}
          entries={board.entries}
          mode={board.mode}
          best={board.best}
          metric={(d) => `${d.solved} solved`}
        />
      </div>
    </div>
  );
}
