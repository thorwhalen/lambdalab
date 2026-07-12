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

interface ProgressStore extends Progress {
  setNickname: (name: string) => void;
  lesson: (lessonId: string) => LessonProgress;
  /**
   * Record a solve. Returns whether this was the learner's first solve of this
   * puzzle (the caller uses it to decide whether to celebrate).
   */
  recordSolve: (lessonId: string, puzzleId: string, score: number) => boolean;
  recordAttempt: (lessonId: string, puzzleId: string) => void;
  /** Count of solved puzzles at a given level, per the puzzle->level map supplied. */
  solvedAtLevel: (lessonId: string, levelOf: (puzzleId: string) => number, level: number) => number;
  /** Unlock the next rung. Idempotent; never goes backwards. */
  advanceTo: (lessonId: string, level: number) => void;
  markSeen: (lessonId: string, sectionId: string) => void;
  resetLesson: (lessonId: string) => void;
  resetAll: () => void;
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

      solvedAtLevel: (lessonId, levelOf, level) => {
        const lesson = get().lesson(lessonId);
        return Object.keys(lesson.solved).filter((id) => levelOf(id) === level).length;
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
): number | null {
  const store = useProgress.getState();
  const solved = store.solvedAtLevel(lessonId, levelOf, currentLevel);
  const reached = store.lesson(lessonId).levelReached;
  if (solved >= toAdvance && reached === currentLevel && currentLevel < maxLevel) {
    store.advanceTo(lessonId, currentLevel + 1);
    return currentLevel + 1;
  }
  return null;
}
