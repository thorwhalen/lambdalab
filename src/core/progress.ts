/**
 * Learner progress — the progressive-disclosure state machine.
 *
 * Everything lives in localStorage. There are no accounts, so "who you are" is
 * a nickname you can change at will, and "what you've unlocked" is a per-lesson
 * integer: `levelReached`. Every activity and every prose section asks the same
 * question — "is my level <= levelReached?" — and shows itself only if so.
 *
 * The one rule that makes this feel good rather than gatey: a rung opens as soon
 * as you have solved `toAdvance` puzzles at the current rung. You are never
 * blocked on a *specific* puzzle, only on *enough* of them. A child stuck on the
 * one puzzle they hate can still move on.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LessonProgress, Progress, PuzzleRecord } from './types';

const STORAGE_KEY = 'lambdalab.progress.v1';

/**
 * A stable empty map for "this lesson has no solves yet".
 *
 * Selectors MUST return this rather than a fresh `{}`. zustand v5 compares
 * snapshots by reference, so `useProgress((s) => s.lessons[id]?.solved ?? {})`
 * hands back a new object on every render, the store concludes the state changed,
 * and the component re-renders forever. Frozen so a caller cannot mutate the
 * shared instance and quietly poison every other lesson.
 */
export const NO_SOLVES: Readonly<Record<string, PuzzleRecord>> = Object.freeze({});

const emptyLesson = (): LessonProgress => ({
  levelReached: 1,
  solved: {},
  seen: [],
});

/**
 * Put `before` (the progress a reset removed) back under `now` (the progress made since).
 * The Undo of a reset may come long after it (its toast stays until closed), so it must
 * not take away what was done in between: a puzzle solved on both sides keeps the better
 * score, the first solve time and every attempt; a lesson keeps its higher rung and every
 * section seen.
 */
export function mergeLessons(
  before: Progress['lessons'],
  now: Progress['lessons'],
): Progress['lessons'] {
  const out: Progress['lessons'] = { ...before };
  for (const [id, cur] of Object.entries(now)) {
    const old = before[id];
    if (!old) {
      out[id] = cur;
      continue;
    }
    const solved: Record<string, PuzzleRecord> = { ...old.solved };
    for (const [pid, rec] of Object.entries(cur.solved)) {
      const prev = old.solved[pid];
      solved[pid] = prev
        ? {
            best: Math.max(prev.best, rec.best),
            attempts: prev.attempts + rec.attempts,
            solvedAt: Math.min(prev.solvedAt, rec.solvedAt),
          }
        : rec;
    }
    out[id] = {
      levelReached: Math.max(old.levelReached, cur.levelReached),
      solved,
      seen: [...new Set([...old.seen, ...cur.seen])],
    };
  }
  return out;
}

interface ProgressStore extends Progress {
  setNickname: (name: string) => void;
  lesson: (lessonId: string) => LessonProgress;
  /**
   * Record a solve. Returns whether this was the learner's first solve of this
   * puzzle (the caller uses it to decide whether to celebrate).
   */
  recordSolve: (lessonId: string, puzzleId: string, score: number) => boolean;
  recordAttempt: (lessonId: string, puzzleId: string) => void;
  /**
   * Count of solved puzzles at a given level, per the puzzle->level map supplied.
   * `sameAs` maps a solve key to what it is a solve OF, so two activities solving
   * the same puzzle count once (default: every key is its own puzzle).
   */
  solvedAtLevel: (
    lessonId: string,
    levelOf: (puzzleId: string) => number,
    level: number,
    sameAs?: (puzzleId: string) => string,
  ) => number;
  /** Unlock the next rung. Idempotent; never goes backwards. */
  advanceTo: (lessonId: string, level: number) => void;
  markSeen: (lessonId: string, sectionId: string) => void;
  resetLesson: (lessonId: string) => void;
  resetAll: () => void;
  /** Put lessons back exactly as they were. */
  restoreLessons: (lessons: Progress['lessons']) => void;
  /** The Undo of a reset: bring back what it removed, keeping progress made since (`mergeLessons`). */
  undoReset: (before: Progress['lessons']) => void;
}

export const useProgress = create<ProgressStore>()(
  persist(
    (set, get) => ({
      nickname: null,
      lessons: {},

      setNickname: (name) => set({ nickname: name.trim().slice(0, 16) || null }),

      lesson: (lessonId) => get().lessons[lessonId] ?? emptyLesson(),

      recordSolve: (lessonId, puzzleId, score) => {
        const lesson = get().lesson(lessonId);
        const prior = lesson.solved[puzzleId];
        const isFirst = prior === undefined;
        const solved = {
          ...lesson.solved,
          [puzzleId]: {
            best: Math.max(score, prior?.best ?? 0),
            attempts: (prior?.attempts ?? 0) + 1,
            solvedAt: prior?.solvedAt ?? Date.now(),
          },
        };
        set((s) => ({
          lessons: { ...s.lessons, [lessonId]: { ...lesson, solved } },
        }));
        return isFirst;
      },

      recordAttempt: (lessonId, puzzleId) => {
        const lesson = get().lesson(lessonId);
        const prior = lesson.solved[puzzleId];
        // Only *solved* puzzles are stored, so an attempt on an unsolved puzzle
        // has nowhere to go — and that is fine. We count attempts to compute the
        // first-try bonus, which only matters once you actually solve it.
        if (!prior) return;
        set((s) => ({
          lessons: {
            ...s.lessons,
            [lessonId]: {
              ...lesson,
              solved: { ...lesson.solved, [puzzleId]: { ...prior, attempts: prior.attempts + 1 } },
            },
          },
        }));
      },

      solvedAtLevel: (lessonId, levelOf, level, sameAs = (id) => id) => {
        const lesson = get().lesson(lessonId);
        return new Set(Object.keys(lesson.solved).filter((id) => levelOf(id) === level).map(sameAs)).size;
      },

      advanceTo: (lessonId, level) => {
        const lesson = get().lesson(lessonId);
        if (level <= lesson.levelReached) return;
        set((s) => ({
          lessons: { ...s.lessons, [lessonId]: { ...lesson, levelReached: level } },
        }));
      },

      markSeen: (lessonId, sectionId) => {
        const lesson = get().lesson(lessonId);
        if (lesson.seen.includes(sectionId)) return;
        set((s) => ({
          lessons: {
            ...s.lessons,
            [lessonId]: { ...lesson, seen: [...lesson.seen, sectionId] },
          },
        }));
      },

      resetLesson: (lessonId) =>
        set((s) => ({ lessons: { ...s.lessons, [lessonId]: emptyLesson() } })),

      resetAll: () => set({ lessons: {} }),
      restoreLessons: (lessons) => set({ lessons }),
      undoReset: (before) => set((s) => ({ lessons: mergeLessons(before, s.lessons) })),
    }),
    { name: STORAGE_KEY },
  ),
);

/**
 * The advancement check, in one place so every activity behaves identically.
 * Call it after a solve; it opens the next rung when the quota is met and
 * returns the level that was newly unlocked (or null).
 */
export function checkAdvance(
  lessonId: string,
  currentLevel: number,
  toAdvance: number,
  levelOf: (puzzleId: string) => number,
  maxLevel: number,
  sameAs?: (puzzleId: string) => string,
): number | null {
  const store = useProgress.getState();
  const solved = store.solvedAtLevel(lessonId, levelOf, currentLevel, sameAs);
  const reached = store.lesson(lessonId).levelReached;
  if (solved >= toAdvance && reached === currentLevel && currentLevel < maxLevel) {
    store.advanceTo(lessonId, currentLevel + 1);
    return currentLevel + 1;
  }
  return null;
}
