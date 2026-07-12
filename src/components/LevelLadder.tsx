/**
 * The concept ladder — progressive disclosure made visible.
 *
 * Why show the locked rungs at all, rather than hiding them? Because a ladder
 * you can see the top of is motivating, and because knowing that "quantifiers"
 * are coming is not the same as being shown them. What is hidden is the *content*
 * (the symbols, the puzzles); what is shown is the *shape of the journey*.
 */
import type { Level } from '../core/types';

export function LevelLadder({
  levels,
  reached,
  current,
  onSelect,
  solvedAt,
}: {
  levels: Level[];
  reached: number;
  /** The rung the learner is looking at right now (may be below `reached`). */
  current: number;
  onSelect: (n: number) => void;
  /** How many puzzles solved at each level, for the progress pips. */
  solvedAt: (level: number) => number;
}) {
  return (
    <ol className="flex flex-col gap-1.5">
      {levels.map((lvl) => {
        const unlocked = lvl.n <= reached;
        const active = lvl.n === current;
        const solved = solvedAt(lvl.n);
        const done = solved >= lvl.toAdvance;

        return (
          <li key={lvl.n}>
            <button
              disabled={!unlocked}
              onClick={() => onSelect(lvl.n)}
              className={`group flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition
                ${active ? 'border-lam-500/60 bg-lam-500/10' : 'border-transparent hover:border-ink-600 hover:bg-ink-800/60'}
                ${unlocked ? 'cursor-pointer' : 'cursor-not-allowed opacity-45'}`}
            >
              <span
                className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-semibold
                  ${done ? 'border-[var(--color-good)]/50 bg-[var(--color-good)]/15 text-[var(--color-good)]' : active ? 'border-lam-500/60 bg-lam-500/20 text-lam-400' : 'border-ink-600 text-ink-400'}`}
              >
                {unlocked ? (done ? '✓' : lvl.n) : '🔒'}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`text-sm font-medium ${active ? 'text-ink-100' : 'text-ink-300'}`}>
                    {lvl.name}
                  </span>
                  {unlocked && (
                    <span className="shrink-0 font-mono text-[11px] text-ink-500">
                      {solved}/{lvl.toAdvance}
                    </span>
                  )}
                </span>

                {unlocked ? (
                  <>
                    <span className="mt-0.5 block text-xs leading-snug text-ink-400">{lvl.goal}</span>
                    {active && lvl.unlocks.length > 0 && (
                      <span className="mt-2 flex flex-wrap gap-1">
                        {lvl.unlocks.map((u) => (
                          <span
                            key={u}
                            className="math rounded border border-ink-600 bg-ink-900 px-1.5 py-0.5 text-xs text-ink-200"
                          >
                            {u}
                          </span>
                        ))}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="mt-0.5 block text-xs italic text-ink-500">
                    Solve {levels[lvl.n - 2]?.toAdvance ?? 3} at level {lvl.n - 1} to unlock
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
