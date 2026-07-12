import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="max-w-xl">
      <p className="math mb-4 text-5xl text-ink-700">∅</p>
      <h1 className="text-2xl font-bold text-ink-100">Nothing here</h1>
      <p className="mt-2 text-ink-400">
        The empty set. It has no elements, and neither does this page.
      </p>
      <Link to="/" className="mt-4 inline-block text-lam-400 hover:underline">
        ← Back to the course
      </Link>
    </div>
  );
}
