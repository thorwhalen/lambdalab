/**
 * Lesson 2 — Finite Automata & Regular Expressions.
 *
 * The through-line: a machine with a finite number of states can do a startling
 * amount (divide by three! remember whether it has seen an even number of a's,
 * forever!) — and then, quite suddenly, it cannot. Finding the exact place where
 * it stops being able to is the point of the whole subject, and the last level of
 * this lesson walks the learner right up to that wall and lets them hit it.
 */
import { Aha, Panel } from '../../components/ui';
import { Activity, LessonShell } from '../../components/LessonShell';
import { useProgress } from '../../core/progress';
import type { Lesson } from '../../core/types';
import { LADDER, LANGUAGE_PUZZLES, puzzleLevel } from './content';
import { RESOURCES } from './resources';
import { MachineBuilder } from './MachineBuilder';
import { RegexLab } from './RegexLab';
import { ConvertLab } from './ConvertLab';

export const automataLesson: Lesson = {
  id: 'automata-regex',
  unit: 'machines',
  title: 'Automata & Regex',
  subtitle: 'The simplest machine that is still worth calling a machine',
  blurb:
    'Build a computer out of nothing but circles and arrows. Give it no memory at all beyond which circle it is standing in — and then discover that this is enough to divide by three, but not enough to count. Finding the exact boundary is the point.',
  status: 'ready',
  prerequisites: [],
  glyph: '→◎',
  ladder: LADDER,
  resources: RESOURCES,
};

function Hook() {
  return (
    <Panel>
      <p className="text-lg leading-relaxed text-ink-200">
        Here is a machine with three states. It reads a binary number, one digit at a time, left to
        right. When the number ends, it says <b className="text-mach-400">yes</b> if the number is
        divisible by 3, and <b>no</b> if it isn't.
      </p>
      <p className="mt-4 leading-relaxed text-ink-300">
        It has no arithmetic in it anywhere. It cannot add. It cannot even <em>remember the
        number</em> — the number might be a thousand digits long and the machine has three states,
        so it forgets almost everything it reads, immediately and forever.
      </p>
      <p className="mt-4 leading-relaxed text-ink-300">And yet it is never wrong.</p>
      <Aha>
        how much can a machine do if it can only remember which of a handful of boxes it is standing
        in? Far more than you would guess — and then, at a very precise point, nothing at all. You
        will build that divide-by-3 machine yourself at level 4. And at level 8 you will meet the
        wall.
      </Aha>
    </Panel>
  );
}

export function AutomataPage() {
  const solved = useProgress((s) => s.lessons['automata-regex']?.solved ?? {});

  // Regex solves are keyed `re-<id>`; both count toward the rung they belong to.
  const solvedAt = (level: number) =>
    Object.keys(solved).filter((id) => puzzleLevel(id.replace(/^re-/, '')) === level).length;

  const wall = LANGUAGE_PUZZLES.find((p) => p.impossible);

  return (
    <LessonShell lesson={automataLesson} hook={<Hook />} solvedAt={solvedAt}>
      {({ level }) => (
        <>
          <Activity
            title="Build the machine"
            subtitle="Drag out states, draw arrows, and make it accept exactly the right strings — no more and no fewer."
          >
            <MachineBuilder level={level} />
          </Activity>

          {level >= 3 && (
            <Activity
              title="Say it in one line"
              subtitle="The same languages, written as patterns instead of drawn as machines."
            >
              <RegexLab level={level} />
            </Activity>
          )}

          {level >= 6 && (
            <Activity
              title="The round trip"
              subtitle="Kleene's theorem, run rather than asserted: convert a machine into a pattern and back, and check that nothing was lost."
            >
              <ConvertLab />
            </Activity>
          )}

          {level >= 8 && wall && (
            <Activity title="The wall" subtitle="Now try something that cannot be done.">
              <Panel>
                <p className="text-lg text-ink-100">{wall.prompt}</p>
                <p className="mt-4 leading-relaxed text-ink-300">
                  Go on. Open the builder and try. Get it right for{' '}
                  <code className="font-mono text-ink-100">ab</code>. Then for{' '}
                  <code className="font-mono text-ink-100">aabb</code>. Then for{' '}
                  <code className="font-mono text-ink-100">aaabbb</code>. Notice what is happening to
                  your machine.
                </p>

                <details className="mt-5 rounded-xl border border-hard-500/40 bg-hard-500/8 p-4">
                  <summary className="cursor-pointer font-semibold text-hard-400">
                    Give up? Here is why you can't do it.
                  </summary>
                  <p className="mt-3 leading-relaxed text-ink-200">{wall.note}</p>
                  <p className="mt-3 leading-relaxed text-ink-300">
                    Take a moment with that. You have just proved that a whole infinite family of
                    machines — every finite automaton that could ever be built, of any size, by
                    anyone — all fail at the same simple task. Not "we haven't found one yet".{' '}
                    <b className="text-ink-100">There isn't one.</b>
                  </p>
                  <p className="mt-3 leading-relaxed text-ink-300">
                    This is the first genuine <em>impossibility</em> proof most people meet, and the
                    shape of the argument — assume it exists, count something, find two things forced
                    into the same box, derive a contradiction — is the same shape as the halting
                    problem, and as Gödel. Everything upstairs in this course is built out of this
                    move.
                  </p>
                  <p className="mt-3 text-ink-400">
                    What would you need to add to the machine to fix it? Something that can count
                    arbitrarily high. A stack, say — a pile of notes you can only read off the top.
                    That is the next lesson.
                  </p>
                </details>
              </Panel>
            </Activity>
          )}
        </>
      )}
    </LessonShell>
  );
}
