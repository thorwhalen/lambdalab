/**
 * The lesson page template.
 *
 * Every lesson has the same skeleton, and the order is the argument:
 *
 *   1. A HOOK — a question you want the answer to, before any notation exists.
 *   2. The LADDER — visible on the left, always. You can see where you are.
 *   3. The ACTIVITIES — the substance. You do things; you are not read to.
 *   4. The SHELF — the best of everyone else's material, once you have your
 *      own handle on the idea. (Videos come *after* play, deliberately: a video
 *      watched before you have a question is entertainment, not learning.)
 *
 * A lesson component supplies the hook and the activities; the shell does the
 * rest, so no lesson has to reinvent progress tracking or the resource list.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Lesson } from '../core/types';
import { useProgress } from '../core/progress';
import { LevelLadder } from './LevelLadder';
import { ResourceShelf } from './ResourceShelf';
import { Button } from './ui';

export interface LessonShellProps {
  lesson: Lesson;
  /** The opening provocation. Shown above everything, always visible. */
  hook: ReactNode;
  /**
   * Rendered with the rung the learner is currently *looking at*. Activities
   * filter their own content by this number — that is the whole disclosure
   * mechanism, and keeping it in one prop keeps every lesson honest.
   */
  children: (ctx: { level: number; reached: number }) => ReactNode;
  /** How many puzzles the learner has solved at a given rung. */
  solvedAt: (level: number) => number;
}

export function LessonShell({ lesson, hook, children, solvedAt }: LessonShellProps) {
  const reached = useProgress((s) => s.lessons[lesson.id]?.levelReached ?? 1);
  const resetLesson = useProgress((s) => s.resetLesson);
  const [viewing, setViewing] = useState<number | null>(null);

  // Default to the frontier: the newest thing you unlocked is the thing you
  // came back for. But if you deliberately click an earlier rung, stay there.
  const level = viewing ?? reached;

  return (
    <div>
      <nav className="mb-6 text-sm">
        <Link to="/" className="text-ink-500 transition hover:text-ink-300">
          ← Course
        </Link>
      </nav>

      <header className="mb-10 max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-ink-100 sm:text-4xl">
          {lesson.title}
        </h1>
        <p className="mt-1.5 text-lg text-ink-400">{lesson.subtitle}</p>
      </header>

      <div className="mb-12 max-w-3xl">{hook}</div>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <aside className="lg:sticky lg:top-20 lg:w-72 lg:shrink-0">
          <div className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
              Your ladder
            </h2>
            <LevelLadder
              levels={lesson.ladder}
              reached={reached}
              current={level}
              onSelect={setViewing}
              solvedAt={solvedAt}
            />
            <div className="mt-4 border-t border-ink-700 pt-3">
              <Button
                variant="danger"
                className="w-full !py-1.5 !text-xs"
                onClick={() => {
                  if (confirm(`Reset all your progress in "${lesson.title}"? This cannot be undone.`)) {
                    resetLesson(lesson.id);
                    setViewing(1);
                  }
                }}
              >
                Reset this lesson
              </Button>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">{children({ level, reached })}</div>
      </div>

      {lesson.resources.length > 0 && (
        <section className="mt-20">
          <div className="mb-6 max-w-3xl">
            <h2 className="text-2xl font-bold tracking-tight text-ink-100">
              The rest of the internet
            </h2>
            <p className="mt-1 text-ink-400">
              Every one of these was watched, played or read before it earned a place here. They
              are ordered by what they are <em>for</em>, not by what they are.
            </p>
          </div>
          <ResourceShelf resources={lesson.resources} />
        </section>
      )}
    </div>
  );
}

/** A titled block of an activity. Purely cosmetic; keeps lesson files tidy. */
export function Activity({
  title,
  subtitle,
  children,
  aside,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="mb-12">
      <div className="mb-4">
        <h2 className="text-2xl font-bold tracking-tight text-ink-100">{title}</h2>
        {subtitle && <p className="mt-1 text-ink-400">{subtitle}</p>}
      </div>
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">{children}</div>
        {aside && <div className="xl:w-72 xl:shrink-0">{aside}</div>}
      </div>
    </section>
  );
}
