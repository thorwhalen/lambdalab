/**
 * Leaderboards, designed not to demoralise.
 *
 * The research on points/badges/leaderboards is blunt: a global ranking you
 * cannot win is a reason to stop playing. So three deliberate choices —
 *
 *  1. **Par, not rank.** Every board ships a par score (the author's). "Beat par"
 *     is a goal you can actually reach, and it is the headline.
 *  2. **Your personal best is always shown**, even when you are nowhere near the
 *     top. Improving on yourself is the loop we actually want.
 *  3. **Small N.** These boards hold a handful of siblings and cousins, not the
 *     internet. That is a feature.
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchBoard, personalBest, submitScore, type BoardMode } from '../core/leaderboard';
import type { BoardId, ScoreEntry } from '../core/types';
import { useProgress } from '../core/progress';
import { Button } from './ui';

export function useLeaderboard(board: BoardId) {
  const nickname = useProgress((s) => s.nickname);
  const [entries, setEntries] = useState<ScoreEntry[]>([]);
  const [mode, setMode] = useState<BoardMode>('local');
  const [best, setBest] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetchBoard(board);
    setEntries(res.board.entries);
    setMode(res.mode);
    setBest(personalBest(board, nickname));
  }, [board, nickname]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = useCallback(
    async (score: number, detail?: Record<string, number | string>) => {
      if (!nickname) return;
      const res = await submitScore({ board, nickname, score, detail });
      setEntries(res.board.entries);
      setMode(res.mode);
      setBest(personalBest(board, nickname));
    },
    [board, nickname],
  );

  return { entries, mode, best, submit, refresh };
}

/** Prompts for a nickname the first time a score is about to be recorded. */
export function NicknameGate() {
  const { nickname, setNickname } = useProgress();
  const [draft, setDraft] = useState('');

  if (nickname) return null;

  return (
    <div className="rounded-xl border border-ink-600 bg-ink-900/70 p-4">
      <p className="mb-2 text-sm text-ink-300">
        Pick a name for the leaderboard. Any name — it is not an account, and it never leaves
        this browser unless you post a score.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) setNickname(draft);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={16}
          placeholder="e.g. Ada"
          className="flex-1 rounded-lg border border-ink-600 bg-ink-950 px-3 py-2 text-sm text-ink-100
            outline-none placeholder:text-ink-600 focus:border-lam-500"
        />
        <Button type="submit" variant="primary">
          Use this name
        </Button>
      </form>
    </div>
  );
}

export function Leaderboard({
  board,
  par,
  metric,
  entries,
  mode,
  best,
}: {
  board: BoardId;
  /** The author's score. The thing to beat. */
  par?: number;
  /** How to render `detail` on a row, e.g. (d) => `${d.states} states`. */
  metric?: (detail: Record<string, number | string>) => string;
  entries: ScoreEntry[];
  mode: BoardMode;
  best: number | null;
}) {
  const nickname = useProgress((s) => s.nickname);
  const beatsPar = par !== undefined && best !== null && best >= par;

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-ink-100">Leaderboard</h3>
        <span className="font-mono text-[11px] text-ink-500" title={board}>
          {mode === 'shared' ? 'shared' : 'this browser only'}
        </span>
      </div>

      {par !== undefined && (
        <div
          className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
            beatsPar
              ? 'border-[var(--color-good)]/40 bg-[var(--color-good)]/10 text-[var(--color-good)]'
              : 'border-ink-600 bg-ink-900 text-ink-300'
          }`}
        >
          <span className="font-semibold">Par: {par}</span>
          <span className="ml-2 text-ink-500">
            {beatsPar ? '— you beat it. Show-off.' : "— the author's score. Beat it."}
          </span>
        </div>
      )}

      {best !== null && (
        <p className="mb-3 text-sm text-ink-400">
          Your best: <span className="font-mono font-semibold text-ink-100">{best}</span>
        </p>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-ink-500">Nobody has posted a score yet. Go first.</p>
      ) : (
        <ol className="flex flex-col gap-0.5">
          {entries.map((e) => (
            <li
              key={e.nickname}
              className={`flex items-baseline gap-3 rounded-lg px-2 py-1.5 text-sm ${
                e.nickname === nickname ? 'bg-lam-500/10 text-ink-100' : 'text-ink-300'
              }`}
            >
              <span className="w-5 shrink-0 text-right font-mono text-xs text-ink-500">{e.rank}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{e.nickname}</span>
              {metric && e.detail && (
                <span className="shrink-0 font-mono text-[11px] text-ink-500">{metric(e.detail)}</span>
              )}
              <span className="shrink-0 font-mono font-semibold">{e.score}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
