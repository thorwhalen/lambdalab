/**
 * The shelf of curated third-party material.
 *
 * Grouped by ROLE, not by kind — because "what is this for" is the question a
 * learner actually has. A hook is a hook whether it is a 40-second short or a
 * card trick you do with a sibling.
 */
import type { Resource, ResourceKind, ResourceRole } from '../core/types';

const ROLE_ORDER: ResourceRole[] = ['hook', 'core', 'play', 'practice', 'stretch', 'reference'];

const ROLE_LABEL: Record<ResourceRole, { title: string; blurb: string }> = {
  hook: { title: 'Start here', blurb: 'Short things that make you want to know more.' },
  core: { title: 'The explanations', blurb: 'The clearest tellings of the idea we could find.' },
  play: { title: 'Go and play', blurb: 'Things you push, drag, break and rebuild.' },
  practice: { title: 'Practice', blurb: 'Exercises, problem sets, drills.' },
  stretch: { title: 'Deeper water', blurb: 'Harder than the lesson. Swim out when you feel like it.' },
  reference: { title: 'Reference', blurb: 'For when you want to look something up.' },
};

const KIND_GLYPH: Record<ResourceKind, string> = {
  video: '▶',
  short: '⚡',
  'video-series': '⏵⏵',
  interactive: '✧',
  game: '🎮',
  'exercise-bank': '✎',
  explorable: '◈',
  course: '🎓',
  book: '📖',
  tool: '🔧',
  'unplugged-activity': '✂',
  article: '¶',
};

function duration(min?: number): string | null {
  if (!min) return null;
  if (min < 1) return `${Math.round(min * 60)}s`;
  return `${Math.round(min)} min`;
}

function ResourceRow({ r }: { r: Resource }) {
  const d = duration(r.durationMin);
  return (
    <li>
      <a
        href={r.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex gap-3 rounded-xl border border-transparent px-3 py-2.5 transition hover:border-ink-600 hover:bg-ink-800/50"
      >
        <span className="mt-0.5 w-5 shrink-0 text-center text-sm text-ink-500" aria-hidden>
          {KIND_GLYPH[r.kind]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-ink-100 underline-offset-4 group-hover:underline">
              {r.title}
            </span>
            {r.creator && <span className="text-xs text-ink-500">{r.creator}</span>}
            {d && <span className="font-mono text-[11px] text-ink-500">{d}</span>}
            {r.cost !== 'free' && (
              <span className="rounded border border-info-500/35 px-1 text-[10px] text-info-400">
                {r.cost === 'paid' ? 'paid' : r.cost === 'freemium' ? 'freemium' : 'account'}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-sm leading-snug text-ink-400">{r.why}</span>
        </span>
        <span className="mt-1 shrink-0 text-ink-600 transition group-hover:text-lam-400" aria-hidden>
          ↗
        </span>
      </a>
    </li>
  );
}

export function ResourceShelf({ resources }: { resources: Resource[] }) {
  const byRole = ROLE_ORDER.map((role) => ({
    role,
    items: resources.filter((r) => r.role === role),
  })).filter((g) => g.items.length > 0);

  if (byRole.length === 0) return null;

  return (
    <div className="flex flex-col gap-8">
      {byRole.map(({ role, items }) => (
        <section key={role}>
          <h3 className="text-lg font-semibold text-ink-100">{ROLE_LABEL[role].title}</h3>
          <p className="mb-2 text-sm text-ink-500">{ROLE_LABEL[role].blurb}</p>
          <ul className="-mx-3 flex flex-col">
            {items.map((r) => (
              <ResourceRow key={r.url} r={r} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
