/**
 * The course map.
 *
 * Every module is on it, including the ones that don't exist yet. A learner
 * should be able to see, in one screen, the whole territory — and that the road
 * ends somewhere worth going (Gödel, at the top of the mountain).
 */
import { Link } from 'react-router-dom';
import { LESSONS, UNITS, lessonsInUnit, type LessonEntry } from '../lessons/registry';
import { useProgress } from '../core/progress';

const ACCENT_RING: Record<string, string> = {
  lam: 'hover:border-lam-500/60 hover:shadow-[0_0_40px_-12px_var(--color-lam-500)]',
  mach: 'hover:border-mach-500/60 hover:shadow-[0_0_40px_-12px_var(--color-mach-500)]',
  crypt: 'hover:border-crypt-500/60 hover:shadow-[0_0_40px_-12px_var(--color-crypt-500)]',
  info: 'hover:border-info-500/60 hover:shadow-[0_0_40px_-12px_var(--color-info-500)]',
  hard: 'hover:border-hard-500/60 hover:shadow-[0_0_40px_-12px_var(--color-hard-500)]',
};

const ACCENT_TEXT: Record<string, string> = {
  lam: 'text-lam-400',
  mach: 'text-mach-400',
  crypt: 'text-crypt-400',
  info: 'text-info-400',
  hard: 'text-hard-400',
};

function LessonCard({ entry, accent }: { entry: LessonEntry; accent: string }) {
  const { meta } = entry;
  const progress = useProgress((s) => s.lessons[meta.id]);
  const ready = meta.status === 'ready';
  const solvedCount = progress ? Object.keys(progress.solved).length : 0;

  const inner = (
    <>
      <div className="mb-2 flex items-start justify-between gap-3">
        <span className={`math text-2xl leading-none ${ACCENT_TEXT[accent]}`}>{meta.glyph}</span>
        {ready ? (
          progress && progress.levelReached > 1 ? (
            <span className="font-mono text-[11px] text-ink-500">
              level {progress.levelReached} · {solvedCount} solved
            </span>
          ) : (
            <span className={`text-[11px] font-medium ${ACCENT_TEXT[accent]}`}>ready</span>
          )
        ) : (
          <span className="text-[11px] text-ink-600">coming soon</span>
        )}
      </div>
      <h3 className="font-semibold text-ink-100">{meta.title}</h3>
      <p className="mt-0.5 text-sm text-ink-400">{meta.subtitle}</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-500">{meta.blurb}</p>
    </>
  );

  const base = 'block rounded-2xl border p-5 transition';

  return ready ? (
    <Link
      to={`/lesson/${meta.id}`}
      className={`${base} border-ink-700 bg-ink-850/70 ${ACCENT_RING[accent]}`}
    >
      {inner}
    </Link>
  ) : (
    <div className={`${base} cursor-not-allowed border-ink-800 bg-ink-900/40 opacity-55`}>
      {inner}
    </div>
  );
}

export function Home() {
  const readyCount = LESSONS.filter((l) => l.meta.status === 'ready').length;

  return (
    <div>
      <section className="mb-16 max-w-3xl">
        <h1 className="text-4xl font-bold tracking-tight text-ink-100 sm:text-5xl">
          The theory of computation,
          <br />
          <span className="text-lam-400">for curious minds.</span>
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-300">
          What can a machine work out, and what can it never work out — not slowly, but{' '}
          <em>never</em>? These are the deepest questions in computer science, and they are
          reachable. You need no programming and no calculus. You need to be willing to play.
        </p>
        <p className="mt-4 text-ink-400">
          Every lesson gives you things to push, drag, break and rebuild — plus the best videos,
          games and explanations we could find anywhere on the internet. Nothing here is
          watch-only.
        </p>
        <p className="mt-6 font-mono text-sm text-ink-600">
          {readyCount} of {LESSONS.length} modules built · more landing regularly
        </p>
      </section>

      <div className="flex flex-col gap-14">
        {UNITS.map((unit) => {
          const lessons = lessonsInUnit(unit.id);
          if (lessons.length === 0) return null;
          return (
            <section key={unit.id}>
              <div className="mb-5 flex items-baseline gap-3">
                <h2 className={`text-2xl font-bold tracking-tight ${ACCENT_TEXT[unit.accent]}`}>
                  {unit.title}
                </h2>
                <p className="text-sm text-ink-500">{unit.tagline}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {lessons.map((entry) => (
                  <LessonCard key={entry.meta.id} entry={entry} accent={unit.accent} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
