/**
 * Leaderboard client.
 *
 * Degrades gracefully: if the backend is not there (running `npm run dev` with
 * no server, or the network is down), every call falls back to a localStorage
 * board so the learner still sees their personal bests. The UI shows which mode
 * it is in rather than pretending — a leaderboard that silently drops your score
 * is worse than no leaderboard.
 */

import type { Board, BoardId, ScoreEntry, ScoreSubmission } from './types';

const API_BASE = import.meta.env.DEV
  ? 'http://localhost:8000/api/lambdalab'
  : '/api/lambdalab';

const LOCAL_KEY = 'lambdalab.localboards.v1';
const TIMEOUT_MS = 4000;

export type BoardMode = 'shared' | 'local';

export interface BoardResult {
  board: Board;
  mode: BoardMode;
}

// --- local fallback ---------------------------------------------------------

type LocalStore = Record<BoardId, ScoreEntry[]>;

function readLocal(): LocalStore {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as LocalStore;
  } catch {
    return {};
  }
}

function writeLocal(store: LocalStore): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
  } catch {
    // Private-browsing quota. Losing a local leaderboard is not worth an error.
  }
}

function rank(entries: ScoreEntry[]): ScoreEntry[] {
  return [...entries]
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

function submitLocal(sub: ScoreSubmission): Board {
  const store = readLocal();
  const entries = store[sub.board] ?? [];
  const existing = entries.find((e) => e.nickname === sub.nickname);
  if (!existing) {
    entries.push({ ...sub, at: Date.now(), rank: 0 });
  } else if (sub.score > existing.score) {
    existing.score = sub.score;
    existing.detail = sub.detail;
    existing.at = Date.now();
  }
  const ranked = rank(entries);
  store[sub.board] = ranked;
  writeLocal(store);
  return { board: sub.board, entries: ranked };
}

function getLocal(board: BoardId): Board {
  return { board, entries: rank(readLocal()[board] ?? []) };
}

// --- network ----------------------------------------------------------------

async function withTimeout(input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBoard(board: BoardId, limit = 20): Promise<BoardResult> {
  try {
    const res = await withTimeout(`${API_BASE}/boards/${encodeURIComponent(board)}?limit=${limit}`);
    if (!res.ok) throw new Error(String(res.status));
    return { board: (await res.json()) as Board, mode: 'shared' };
  } catch {
    return { board: getLocal(board), mode: 'local' };
  }
}

export async function submitScore(sub: ScoreSubmission): Promise<BoardResult> {
  // Always record locally first: the personal best is the learner's, and it must
  // survive a flaky network.
  const local = submitLocal(sub);
  try {
    const res = await withTimeout(`${API_BASE}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
    if (!res.ok) throw new Error(String(res.status));
    return { board: (await res.json()) as Board, mode: 'shared' };
  } catch {
    return { board: local, mode: 'local' };
  }
}

/** The learner's own best on a board, from the local mirror. Instant, no network. */
export function personalBest(board: BoardId, nickname: string | null): number | null {
  if (!nickname) return null;
  const entry = (readLocal()[board] ?? []).find((e) => e.nickname === nickname);
  return entry?.score ?? null;
}
