/** What this is, who it is for, and the principles it is built on. */
import { useProgress } from '../core/progress';
import { Button } from '../components/ui';

const PRINCIPLES: Array<{ title: string; body: string }> = [
  {
    title: 'Play before notation',
    body: 'You meet the idea by doing it. The symbol arrives afterwards, as a convenience — a shorthand for something you can already feel. Notation introduced before the idea it abbreviates is just a code to memorise.',
  },
  {
    title: 'A few things at a time',
    body: 'Every lesson has a ladder. Level 1 hands you a tiny palette — five symbols, two states. Nothing else is on screen. New pieces arrive only once the old ones are boring. Being overwhelmed is not a rite of passage; it is a design failure.',
  },
  {
    title: 'Wrong answers are the interesting ones',
    body: 'When you get something wrong, this site does not say "wrong". It shows you the evidence: the exact string your machine got wrong, or a tiny world in which your sentence says something you did not mean. That evidence is where the learning actually is.',
  },
  {
    title: 'Nothing is watch-only',
    body: 'There are wonderful videos out there and we link to plenty. But they come after you have played, because a video watched before you have a question is entertainment. The activities are the lesson.',
  },
  {
    title: 'Par, not rank',
    body: "Leaderboards are here, but the number that matters is par — the author's score — and your own personal best. A global ranking you cannot win is a reason to quit.",
  },
  {
    title: 'No condescension',
    body: 'The mathematics is real. The notation is standard. Nothing taught here has to be un-taught later. If an idea is genuinely hard we say so, and then we do it anyway.',
  },
];

export function About() {
  const { nickname, setNickname, resetAll } = useProgress();

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-bold tracking-tight text-ink-100">About LambdaLab</h1>

      <p className="mt-5 text-lg leading-relaxed text-ink-300">
        This site was built for two kids, aged 11 and 12, who kept asking questions that deserved
        real answers. It teaches the theory of computation — the mathematics that says what a
        machine can and cannot do — the way it should be taught: by handing you the thing and
        letting you turn it over.
      </p>

      <p className="mt-4 leading-relaxed text-ink-400">
        It is free, it has no accounts, and it collects nothing about you. Your progress lives in
        this browser. The only thing that ever reaches the server is a nickname and a score, and
        only if you post one to a leaderboard.
      </p>

      <h2 className="mt-12 text-2xl font-bold tracking-tight text-ink-100">
        How it is built
      </h2>
      <div className="mt-5 flex flex-col gap-5">
        {PRINCIPLES.map((p) => (
          <div key={p.title} className="rounded-xl border border-ink-700 bg-ink-850/50 p-4">
            <h3 className="font-semibold text-ink-100">{p.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-400">{p.body}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-12 text-2xl font-bold tracking-tight text-ink-100">Your data</h2>
      <div className="mt-4 panel p-5">
        <label className="block text-sm text-ink-400">
          Leaderboard name
          <input
            value={nickname ?? ''}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={16}
            placeholder="not set"
            className="mt-1.5 block w-full max-w-xs rounded-lg border border-ink-600 bg-ink-950 px-3 py-2
              text-ink-100 outline-none placeholder:text-ink-600 focus:border-lam-500"
          />
        </label>
        <div className="mt-5 border-t border-ink-700 pt-4">
          <Button
            variant="danger"
            onClick={() => {
              if (confirm('Erase all progress across every lesson? This cannot be undone.')) {
                resetAll();
              }
            }}
          >
            Erase all my progress
          </Button>
        </div>
      </div>

      <h2 className="mt-12 text-2xl font-bold tracking-tight text-ink-100">Credit where due</h2>
      <p className="mt-3 leading-relaxed text-ink-400">
        Every lesson ends with a shelf of other people's work — videos, games, explorables,
        problem sets. Those people did the hard part. Each one was watched, played or read before
        it earned its place, and each links straight to the original.
      </p>
    </div>
  );
}
