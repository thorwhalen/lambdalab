/**
 * "Shade what it means."
 *
 * A set expression is shown; the learner clicks regions of a three-circle Venn
 * until the shading matches. Then the direction flips: a shading is shown and
 * they build the expression from tiles.
 *
 * The grading is EXACT here, not a heuristic — two expressions over three sets
 * shade the same regions if and only if they are equal as sets, for every
 * possible A, B and C. (The eight regions are the atoms of the free Boolean
 * algebra on three generators; matching on all eight is matching everywhere.)
 * Which is a fact worth telling a child directly: *the picture contains all the
 * information there is.* That is not true of most pictures in mathematics, and it
 * is exactly why Venn diagrams earned their place.
 */
import { useCallback, useMemo, useState } from 'react';
import type { SetExpr, Signature } from '../../lib/logic/types';
import { parseFormula, renderSet } from '../../lib/logic/parse';
import { Button, Panel, Verdict } from '../../components/ui';
import { TilePalette, FormulaStrip, useFormulaTokens } from '../../components/FormulaBuilder';
import { VennPlayground, shadingOf, type Shading } from '../../components/VennPlayground';
import { Leaderboard, NicknameGate, useLeaderboard } from '../../components/Leaderboard';
import { NO_SOLVES, useProgress } from '../../core/progress';
import { VENN_BOARD, VENN_PAR, paletteFor } from './content';

const LESSON_ID = 'set-logic';
const SIG: Signature = { sets: ['A', 'B', 'C'], relations: [], constants: [] };

/**
 * A set expression is not a Formula, and `parseFormula` only parses formulas —
 * so we smuggle the expression in as the right-hand side of a membership claim
 * and pull the set back out. Cheap, and it means there is exactly one parser to
 * keep correct rather than two.
 */
function parseSetExpr(tokens: string[]): { ok: true; expr: SetExpr } | { ok: false; message: string } {
  const r = parseFormula(['x', '∈', ...tokens], SIG);
  if (!r.ok) return { ok: false, message: r.message };
  if (r.formula.kind !== 'member') return { ok: false, message: 'That is not a set.' };
  return { ok: true, expr: r.formula.set };
}

interface VennPuzzle {
  id: string;
  level: number;
  /** The expression, as a token list (so it renders in the same notation as the tiles). */
  expr: string;
  prompt: string;
  note?: string;
}

/** Ordered so each one is a small step past the last. */
const VENN_PUZZLES: VennPuzzle[] = [
  { id: 'v-a', level: 3, expr: 'A', prompt: 'A' },
  { id: 'v-inter', level: 3, expr: 'A ∩ B', prompt: 'A ∩ B' },
  { id: 'v-union', level: 3, expr: 'A ∪ B', prompt: 'A ∪ B' },
  { id: 'v-compl', level: 3, expr: 'Aᶜ', prompt: 'Aᶜ' },
  { id: 'v-diff', level: 3, expr: 'A ∖ B', prompt: 'A ∖ B' },
  {
    id: 'v-demorgan',
    level: 3,
    expr: '( A ∪ B )ᶜ',
    prompt: '(A ∪ B)ᶜ',
    note: 'Now shade Aᶜ ∩ Bᶜ and compare. They are the same picture — that is De Morgan\'s law, and you can SEE it.',
  },
  { id: 'v-demorgan2', level: 3, expr: 'Aᶜ ∩ Bᶜ', prompt: 'Aᶜ ∩ Bᶜ', note: 'Identical to (A ∪ B)ᶜ. Same regions, same set, always.' },
  { id: 'v-three-inter', level: 3, expr: 'A ∩ B ∩ C', prompt: 'A ∩ B ∩ C' },
  {
    id: 'v-distrib',
    level: 3,
    expr: 'A ∩ ( B ∪ C )',
    prompt: 'A ∩ (B ∪ C)',
    note: 'Compare with (A ∩ B) ∪ (A ∩ C). Same picture again — intersection distributes over union, exactly like × over +.',
  },
  { id: 'v-distrib2', level: 3, expr: '( A ∩ B ) ∪ ( A ∩ C )', prompt: '(A ∩ B) ∪ (A ∩ C)' },
  {
    id: 'v-only-a',
    level: 3,
    expr: 'A ∖ ( B ∪ C )',
    prompt: 'A ∖ (B ∪ C)  — "in A and nothing else"',
  },
  {
    id: 'v-exactly-one',
    level: 4,
    expr: '( A ∖ ( B ∪ C ) ) ∪ ( B ∖ ( A ∪ C ) ) ∪ ( C ∖ ( A ∪ B ) )',
    prompt: 'Exactly one of A, B, C — and nothing in two or three of them.',
    note: 'Three little crescents. Try to write it any shorter; you will find it is genuinely awkward, which is itself informative.',
  },
  {
    id: 'v-symmdiff',
    level: 4,
    expr: '( A ∪ B ) ∖ ( A ∩ B )',
    prompt: '(A ∪ B) ∖ (A ∩ B)  — "in one of them but not both"',
    note: 'This is the symmetric difference, and it is exclusive-or wearing a set-theory hat. You will meet it again in the circuits lesson as XOR.',
  },
  { id: 'v-nothing', level: 4, expr: 'A ∩ Aᶜ', prompt: 'A ∩ Aᶜ', note: 'Nothing at all. A thing cannot be both inside and outside A. That is ∅ — and shading zero regions is the right answer.' },
  { id: 'v-everything', level: 4, expr: 'A ∪ Aᶜ', prompt: 'A ∪ Aᶜ', note: 'Everything. Every thing is either in A or not in A, with no third option. Shade the whole box, outside region included.' },
];

type Dir = 'shade' | 'name';

export function VennGame({ level }: { level: number }) {
  const [dir, setDir] = useState<Dir>('shade');
  const [index, setIndex] = useState(0);
  const [shading, setShading] = useState<Shading>(0);
  const [checked, setChecked] = useState<{ ok: boolean; message?: string } | null>(null);
  const tokens = useFormulaTokens();
  const { recordSolve } = useProgress();
  const solvedMap = useProgress((s) => s.lessons[LESSON_ID]?.solved ?? NO_SOLVES);
  const board = useLeaderboard(VENN_BOARD);

  const pool = useMemo(() => VENN_PUZZLES.filter((p) => p.level <= level), [level]);
  const puzzle = pool[index % Math.max(1, pool.length)];

  const target = useMemo<Shading>(() => {
    if (!puzzle) return 0;
    const r = parseSetExpr(puzzle.expr.split(/\s+/));
    return r.ok ? shadingOf(r.expr) : 0;
  }, [puzzle]);

  const reset = useCallback(() => {
    setShading(0);
    setChecked(null);
    tokens.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const next = () => {
    reset();
    setIndex((i) => (i + 1) % Math.max(1, pool.length));
  };

  const award = () => {
    if (!puzzle) return;
    const pts = 100 * puzzle.level;
    recordSolve(LESSON_ID, puzzle.id, pts);
    const bests = { ...solvedMap, [puzzle.id]: { best: pts, attempts: 1, solvedAt: Date.now() } };
    const total = Object.values(bests).reduce((s, r) => s + r.best, 0);
    void board.submit(total, { solved: Object.keys(bests).length });
  };

  if (!puzzle) {
    return (
      <Panel>
        <p className="text-ink-400">Reach level 3 to unlock the Venn workshop.</p>
      </Panel>
    );
  }

  const checkShade = () => {
    const ok = shading === target;
    setChecked({ ok });
    if (ok) award();
  };

  const checkName = () => {
    const r = parseSetExpr(tokens.tokens);
    if (!r.ok) {
      setChecked({ ok: false, message: r.message });
      return;
    }
    const ok = shadingOf(r.expr) === target;
    setChecked({
      ok,
      message: ok
        ? undefined
        : `Your ${renderSet(r.expr)} shades different regions. Look at which ones and work backwards.`,
    });
    if (ok) award();
  };

  return (
    <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
      <div className="min-w-0 flex-1">
        <Panel>
          <div className="mb-5 flex items-center gap-2">
            <div className="flex rounded-lg border border-ink-700 p-0.5">
              {(['shade', 'name'] as Dir[]).map((d) => (
                <button
                  key={d}
                  onClick={() => {
                    setDir(d);
                    reset();
                  }}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    dir === d ? 'bg-lam-500 text-white' : 'text-ink-400 hover:text-ink-100'
                  }`}
                >
                  {d === 'shade' ? 'Shade it' : 'Name it'}
                </button>
              ))}
            </div>
            <span className="ml-auto font-mono text-xs text-ink-500">
              {index + 1}/{pool.length}
              {solvedMap[puzzle.id] && <span className="ml-2 text-[var(--color-good)]">✓</span>}
            </span>
          </div>

          {dir === 'shade' ? (
            <>
              <p className="mb-2 text-sm text-ink-400">Click regions until the shading is exactly:</p>
              <div className="formula mb-4 rounded-xl border border-ink-700 bg-ink-950 px-5 py-3 text-ink-100">
                {puzzle.prompt}
              </div>
              <div className="flex flex-col items-start gap-4 sm:flex-row">
                <VennPlayground
                  shading={shading}
                  onToggleRegion={(m) => {
                    setShading((s) => s ^ (1 << m));
                    setChecked(null);
                  }}
                  className="sm:max-w-sm"
                />
                <div className="flex flex-col gap-2">
                  <Button variant="primary" onClick={checkShade}>
                    Check
                  </Button>
                  <Button onClick={() => setShading(0)}>Clear</Button>
                  <p className="max-w-48 text-xs text-ink-600">
                    Don't forget the region <em>outside</em> all three circles. It is part of the
                    universe too.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="mb-2 text-sm text-ink-400">Which set is shaded? Build it.</p>
              <div className="flex flex-col items-start gap-4 sm:flex-row">
                <VennPlayground shading={target} className="sm:max-w-sm" />
                <div className="min-w-0 flex-1">
                  <FormulaStrip
                    tokens={tokens.tokens}
                    onTruncate={tokens.truncate}
                    placeholder="Build a set expression…"
                  />
                  <div className="my-3 flex gap-2">
                    <Button variant="primary" onClick={checkName} disabled={!tokens.tokens.length}>
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
                    <TilePalette
                      // Set-expression tiles only: no connectives, no quantifiers,
                      // and only round brackets (the set-builder braces belong to
                      // the formula game, not here).
                      tiles={paletteFor(SIG, Math.max(3, level)).filter(
                        (t) =>
                          t.kind === 'set' ||
                          ['(', ')', '∩', '∪', 'ᶜ', '∖', '∅', '𝕌'].includes(t.token),
                      )}
                      level={Math.max(3, level)}
                      onPick={(t) => {
                        tokens.push(t.token);
                        setChecked(null);
                      }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-ink-600">
                    Any expression that shades the same regions counts — there is usually more than
                    one right answer, and finding a shorter one is its own reward.
                  </p>
                </div>
              </div>
            </>
          )}

          {checked && (
            <div className="mt-4">
              <Verdict ok={checked.ok} title={checked.ok ? 'Exactly right' : 'Not those regions'}>
                {checked.message}
                {checked.ok && puzzle.note && <p className="mt-2 text-ink-200">{puzzle.note}</p>}
              </Verdict>
              {checked.ok && (
                <Button variant="primary" className="mt-3" onClick={next}>
                  Next →
                </Button>
              )}
            </div>
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-4 xl:w-72 xl:shrink-0">
        <NicknameGate />
        <Leaderboard
          board={VENN_BOARD}
          par={VENN_PAR}
          entries={board.entries}
          mode={board.mode}
          best={board.best}
          metric={(d) => `${d.solved} solved`}
        />
      </div>
    </div>
  );
}
