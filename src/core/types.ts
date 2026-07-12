/**
 * Core domain contracts for LambdaLab.
 *
 * This module is the SSOT: lessons, the progressive-disclosure ladder,
 * third-party resources, and the challenge/scoring model that the
 * leaderboards speak. Engines (`src/lib/*`) and UI (`src/components`,
 * `src/lessons`) both build against these types and nothing else.
 */

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

export type LessonStatus = 'ready' | 'draft' | 'planned';

/** One rung of a lesson's concept ladder. Progressive disclosure lives here. */
export interface Level {
  /** 1-based. `levelReached >= n` means the learner has unlocked this rung. */
  n: number;
  /** Short name shown on the ladder, e.g. "Quantifiers". */
  name: string;
  /** What the learner can *do* once this rung is cleared. One sentence. */
  goal: string;
  /** Exactly what is newly revealed here — symbols, machine features, rules. */
  unlocks: string[];
  /**
   * How many puzzles at this level must be solved before the next rung opens.
   * Kept small: the point is momentum, not grinding.
   */
  toAdvance: number;
}

export type ResourceKind =
  | 'video'
  | 'short'
  | 'video-series'
  | 'interactive'
  | 'game'
  | 'exercise-bank'
  | 'explorable'
  | 'course'
  | 'book'
  | 'tool'
  | 'unplugged-activity'
  | 'article';

/** Where a resource sits in the arc of a lesson. */
export type ResourceRole =
  | 'hook'
  | 'core'
  | 'play'
  | 'practice'
  | 'stretch'
  | 'reference';

export type ResourceCost = 'free' | 'free-with-account' | 'freemium' | 'paid';

/** A curated third-party resource. One row of a lesson's resource shelf. */
export interface Resource {
  title: string;
  url: string;
  kind: ResourceKind;
  role: ResourceRole;
  creator?: string;
  /** Minutes. Omit for non-timed resources. */
  durationMin?: number;
  cost: ResourceCost;
  /** One or two sentences: what it is, and why it earns a place here. */
  why: string;
  concepts?: string[];
}

/** A block of lesson prose/figures, gated behind a ladder level. */
export interface Section {
  id: string;
  title: string;
  /** Revealed once `levelReached >= level`. 0 = always visible. */
  level: number;
}

export interface Lesson {
  id: string;
  unit: string;
  title: string;
  /** One line, shown under the title. */
  subtitle: string;
  /** A paragraph for the course map card. */
  blurb: string;
  status: LessonStatus;
  /** Lesson ids that should come first. */
  prerequisites: string[];
  ladder: Level[];
  resources: Resource[];
  /** Emoji or short glyph for the course map. */
  glyph: string;
}

// ---------------------------------------------------------------------------
// Challenges, scoring, leaderboards
// ---------------------------------------------------------------------------

/**
 * A leaderboard key. Convention: `<lessonId>.<activityId>` — one board per
 * activity, not per puzzle (per-puzzle boards would be a graveyard of N=1).
 */
export type BoardId = string;

/**
 * A scored attempt. `score` is always "higher is better" so one leaderboard
 * implementation serves every activity; each activity converts its own natural
 * metric (states used, regex length, seconds, attempts) into points via a
 * documented formula and reports the raw metric in `detail` for display.
 */
export interface ScoreSubmission {
  board: BoardId;
  nickname: string;
  score: number;
  detail?: Record<string, number | string>;
}

export interface ScoreEntry extends ScoreSubmission {
  /** Server-assigned. Epoch millis. */
  at: number;
  rank: number;
}

export interface Board {
  board: BoardId;
  entries: ScoreEntry[];
  /**
   * The author's own score — the "beat the author" par. Motivating without the
   * demoralisation of a global ranking you can never touch.
   */
  par?: number;
}

// ---------------------------------------------------------------------------
// Progress (localStorage; no accounts)
// ---------------------------------------------------------------------------

export interface PuzzleRecord {
  /** Best score achieved on this puzzle. */
  best: number;
  attempts: number;
  /** Epoch millis of first solve. */
  solvedAt: number;
}

export interface LessonProgress {
  /** Highest ladder rung unlocked. Starts at 1. */
  levelReached: number;
  /** Keyed by puzzle id. Only *solved* puzzles are recorded. */
  solved: Record<string, PuzzleRecord>;
  /** Section ids the learner has expanded/read. */
  seen: string[];
}

export interface Progress {
  /** Display name used on leaderboards. Nickname only — never an identity. */
  nickname: string | null;
  lessons: Record<string, LessonProgress>;
}

// ---------------------------------------------------------------------------
// Activity contract
// ---------------------------------------------------------------------------

/**
 * Every puzzle in every activity carries at least this. Activities extend it
 * with their own payload (a target language, a sentence to translate, ...).
 */
export interface PuzzleBase {
  id: string;
  /** Ladder rung this puzzle belongs to. */
  level: number;
  /** The prompt, in plain language the learner reads. */
  prompt: string;
  /** Optional nudge, revealed on request (costs points). */
  hint?: string;
}

/** The verdict an activity's grader returns. */
export type Verdict<TWitness = unknown> =
  | { ok: true; score: number; detail?: Record<string, number | string> }
  | {
      ok: false;
      /** Human-readable, specific, and *informative*: never just "wrong". */
      message: string;
      /**
       * The concrete evidence of wrongness — a string the machine misclassifies,
       * a tiny universe where the sentence is false. This is the whole point.
       */
      witness?: TWitness;
    };
