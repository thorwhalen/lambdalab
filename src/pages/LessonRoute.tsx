/** Resolves :id to a lesson page, or explains why there isn't one yet. */
import { Link, useParams } from 'react-router-dom';
import { lessonById } from '../lessons/registry';

export function LessonRoute() {
  const { id } = useParams<{ id: string }>();
  const entry = id ? lessonById(id) : undefined;

  if (!entry) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-ink-100">No such lesson</h1>
        <p className="mt-2 text-ink-400">
          There is no module called <code className="font-mono text-ink-200">{id}</code>.
        </p>
        <Link to="/" className="mt-4 inline-block text-lam-400 hover:underline">
          ← Back to the course
        </Link>
      </div>
    );
  }

  if (!entry.Page) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-ink-100">{entry.meta.title}</h1>
        <p className="mt-2 text-ink-400">{entry.meta.blurb}</p>
        <p className="mt-6 rounded-xl border border-ink-700 bg-ink-850/60 p-4 text-sm text-ink-400">
          This module is planned but not built yet. It is on the map because the map should be
          honest about where the road goes.
        </p>
        <Link to="/" className="mt-4 inline-block text-lam-400 hover:underline">
          ← Back to the course
        </Link>
      </div>
    );
  }

  const { Page } = entry;
  return <Page />;
}
