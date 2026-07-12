/**
 * Lesson 1 — Sets & Logic.
 *
 * The through-line: a set and a property are the same thing. "The dogs" and
 * "being a dog" are two names for one idea, and once you see that, set notation
 * and logical notation stop being two subjects and become one, with two spellings.
 * Every activity here is a translation of some kind — between English and symbols,
 * between symbols and pictures, between one spelling and the other.
 */
import { Aha, Panel } from '../../components/ui';
import { Activity, LessonShell } from '../../components/LessonShell';
import { NO_SOLVES, useProgress } from '../../core/progress';
import type { Lesson } from '../../core/types';
import { LADDER, puzzleLevel } from './content';
import { RESOURCES } from './resources';
import { TranslationGame } from './TranslationGame';
import { VennGame } from './VennGame';

export const setLogicLesson: Lesson = {
  id: 'set-logic',
  unit: 'foundations',
  title: 'Sets & Logic',
  subtitle: 'The language mathematics is actually written in',
  blurb:
    'Learn to read a sentence like ∀x (Dog(x) → Red(x)) as easily as you read this one — and to write your own. Along the way you will meet the single most common mistake in all of logic, and make it yourself at least once.',
  status: 'ready',
  prerequisites: [],
  glyph: '∀',
  ladder: LADDER,
  resources: RESOURCES,
};

function Hook() {
  return (
    <Panel>
      <p className="text-lg leading-relaxed text-ink-200">
        Here are two sentences. They differ by one symbol.
      </p>
      <div className="my-5 flex flex-col gap-3">
        <div className="formula rounded-xl border border-ink-700 bg-ink-950 px-5 py-3 text-ink-100">
          ∀x (x ∈ Dog <span className="text-lam-400">→</span> x ∈ Red)
        </div>
        <div className="formula rounded-xl border border-ink-700 bg-ink-950 px-5 py-3 text-ink-100">
          ∀x (x ∈ Dog <span className="text-[var(--color-bad)]">∧</span> x ∈ Red)
        </div>
      </div>
      <p className="leading-relaxed text-ink-300">
        The first says <b className="text-ink-100">“every dog is red”</b>. The second says{' '}
        <b className="text-ink-100">
          “absolutely everything in the universe is a red dog”
        </b>{' '}
        — including this website, your left shoe, and the number 7.
      </p>
      <Aha>
        one symbol, and the sentence goes from mildly false to insanely false. By the end of this
        lesson you will not only see why — you will have made the mistake yourself, watched a tiny
        universe prove you wrong, and stopped making it.
      </Aha>
    </Panel>
  );
}

export function SetLogicPage() {
  const solved = useProgress((s) => s.lessons['set-logic']?.solved ?? NO_SOLVES);
  const solvedAt = (level: number) =>
    Object.keys(solved).filter((id) => puzzleLevel(id) === level || vennLevelOf(id) === level).length;

  return (
    <LessonShell lesson={setLogicLesson} hook={<Hook />} solvedAt={solvedAt}>
      {({ level }) => (
        <>
          <Activity
            title="Translate"
            subtitle="Both directions. Read a formula and say what it means; read a sentence and build the formula."
          >
            <TranslationGame level={level} />
          </Activity>

          {level >= 3 && (
            <Activity
              title="The Venn workshop"
              subtitle="Shade what an expression means — then read a shading back into symbols."
            >
              <VennGame level={level} />
            </Activity>
          )}

          {level >= 3 && (
            <Panel className="mb-12">
              <h3 className="mb-2 text-lg font-semibold text-ink-100">Two spellings, one fact</h3>
              <p className="leading-relaxed text-ink-300">
                You now have two ways to say the same thing, and they are worth putting side by
                side, because the whole lesson lives in this table.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[30rem] text-left text-sm">
                  <thead className="text-ink-500">
                    <tr>
                      <th className="pb-2 pr-4 font-medium">Set language</th>
                      <th className="pb-2 pr-4 font-medium">Logic language</th>
                      <th className="pb-2 font-medium">In English</th>
                    </tr>
                  </thead>
                  <tbody className="text-ink-200">
                    {[
                      ['x ∈ A ∩ B', 'x ∈ A ∧ x ∈ B', 'x is in both'],
                      ['x ∈ A ∪ B', 'x ∈ A ∨ x ∈ B', 'x is in at least one'],
                      ['x ∈ Aᶜ', '¬ (x ∈ A)', 'x is not in A'],
                      ['x ∈ A ∖ B', 'x ∈ A ∧ ¬ (x ∈ B)', 'x is in A but not B'],
                      ['A ⊆ B', '∀x (x ∈ A → x ∈ B)', 'every A is a B'],
                      ['A ∩ B = ∅', '¬ ∃x (x ∈ A ∧ x ∈ B)', 'no A is a B'],
                    ].map(([s, l, e]) => (
                      <tr key={s} className="border-t border-ink-800">
                        <td className="math py-2 pr-4 text-base">{s}</td>
                        <td className="math py-2 pr-4 text-base">{l}</td>
                        <td className="py-2 text-ink-400">{e}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 leading-relaxed text-ink-400">
                Read the left column and the right column out loud. They say the same things. The
                set symbols are not a different subject from the logic symbols — they are an
                abbreviation for them. A set <em>is</em> a property; a property <em>is</em> a set.
              </p>
            </Panel>
          )}

          {level >= 6 && (
            <Panel className="mb-12">
              <h3 className="mb-2 text-lg font-semibold text-ink-100">The two patterns</h3>
              <p className="leading-relaxed text-ink-300">
                Almost everything you will ever write in this language is one of two shapes. Learn
                them and you are most of the way there.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-lam-500/40 bg-lam-500/8 p-4">
                  <div className="math mb-2 text-lg text-ink-100">∀x (A(x) → B(x))</div>
                  <p className="text-sm text-ink-300">
                    <b>∀ goes with →.</b> “Every A is a B.” The arrow is doing the work of the word
                    “every”: for each thing, <em>if</em> it is an A, <em>then</em> it is a B.
                  </p>
                </div>
                <div className="rounded-xl border border-mach-500/40 bg-mach-500/8 p-4">
                  <div className="math mb-2 text-lg text-ink-100">∃x (A(x) ∧ B(x))</div>
                  <p className="text-sm text-ink-300">
                    <b>∃ goes with ∧.</b> “Some A is a B.” Here you are pointing at an actual thing
                    and claiming two facts about it at once.
                  </p>
                </div>
              </div>
              <Aha>
                swap them and you say something either enormous (∀ with ∧: “everything is a red
                dog”) or nearly empty (∃ with →: true the moment a single non-dog exists anywhere in
                the universe). Neither is what you meant. This is the trap, and now you know it by
                name.
              </Aha>
            </Panel>
          )}
        </>
      )}
    </LessonShell>
  );
}

/** Venn puzzles carry their own ids; map them onto the ladder for the pip counts. */
function vennLevelOf(id: string): number {
  if (!id.startsWith('v-')) return 0;
  return ['v-exactly-one', 'v-symmdiff', 'v-nothing', 'v-everything'].includes(id) ? 4 : 3;
}
