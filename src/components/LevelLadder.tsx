/**
 * The concept ladder — progressive disclosure made visible.
 *
 * Disclosure here means *layering*, not gating. Every rung is reachable at any
 * time: clicking one is how you change what the activities show you. What a rung
 * discloses is the *content* (the symbols, the puzzles) appropriate to that
 * depth; it was never meant to withhold access until you had earned it. Locking
 * the ladder turned a map into a turnstile — a learner who already knows DFAs
 * should not have to grind level 1 to reach the pumping lemma.
 *
 * `reached` therefore no longer decides what you may open. It is a *marker*: how
 * far your own solving has carried you. Rungs past it are rendered a touch
 * dimmer — "ahead of you", not "closed to you" — and stay one click away.
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
  /** How far the learner's own solving has carried them. A marker, not a gate. */
  reached: number;
  /** The rung the learner is looking at right now (may be above or below `reached`). */
  current: number;
  onSelect: (n: number) => void;
  /** How many puzzles solved at each level, for the progress pips. */
  solvedAt: (level: number) => number;
}) {
  return (
    <ol className="flex flex-col gap-1.5">
      {levels.map((lvl) => {
        const active = lvl.n === current;
        const solved = solvedAt(lvl.n);
        const done = solved >= lvl.toAdvance;
        // Past your own frontier: shown, dimmed, and fully clickable.
        const ahead = lvl.n > reached;

        return (
          <li key={lvl.n}>
            <button
              onClick={() => onSelect(lvl.n)}
              className={`group flex w-full cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition
                ${active ? 'border-lam-500/60 bg-lam-500/10' : 'border-transparent hover:border-ink-600 hover:bg-ink-800/60'}
                ${ahead && !active ? 'opacity-70 hover:opacity-100' : ''}`}
            >
              <span
                className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-semibold
                  ${done ? 'border-[var(--color-good)]/50 bg-[var(--color-good)]/15 text-[var(--color-good)]' : active ? 'border-lam-500/60 bg-lam-500/20 text-lam-400' : 'border-ink-600 text-ink-400'}`}
              >
                {done ? '✓' : lvl.n}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`text-sm font-medium ${active ? 'text-ink-100' : 'text-ink-300'}`}>
                    {lvl.name}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-ink-500">
                    {solved}/{lvl.toAdvance}
                  </span>
                </span>

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
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
