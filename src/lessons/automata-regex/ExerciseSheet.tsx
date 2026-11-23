/**
 * "Build this": the graded sheet of exercises from `exercises.ts`.
 *
 * Pick an exercise, read its story, build the machine on paper or in the
 * builder, write the pattern — and check the pattern here if you like. A wrong
 * pattern gets the shortest string it gets wrong, as everywhere in this lesson.
 *
 * The answer is never shown by default. "Show me" reveals it two ways: the
 * pattern, and the smallest machine for it, which is COMPUTED from the pattern
 * (Thompson → subset construction → minimisation), so picture and pattern can
 * never disagree.
 *
 * No score and no rung: this sheet is practice. The list carries no sigils: the
 * stars are the one thing worth seeing at a glance, and they are there.
 *
 * On a phone the list is a single select with Prev / Next, so picking an exercise
 * never pushes the exercise itself off the screen.
 */
import { useMemo, useState } from 'react';
import { parseRegex } from '../../lib/automata/regexParse';
import { regexToNFA } from '../../lib/automata/thompson';
import { equivalent } from '../../lib/automata/equivalence';
import { minimalStateCount, minimize } from '../../lib/automata/minimize';
import { accepts } from '../../lib/automata/simulate';
import { forDisplay } from '../../lib/automata/layout';
import { AutomatonCanvas } from '../../components/AutomatonCanvas';
import { Button, Panel, Verdict } from '../../components/ui';
import { PatternInput, type PaletteSymbol } from '../../components/PatternInput';
import { BUILD_EXERCISES, type BuildExercise } from './exercises';

const STARS = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
const show = (s: string) => (s === '' ? 'ε' : s);

/** The theory regex's symbols, offered next to the alphabet. */
const OPERATORS: PaletteSymbol[] = [
  { label: '( )', insert: '()', caret: 1, gloss: 'group a piece' },
  { label: '|', insert: '|', gloss: 'or: either side' },
  { label: '*', insert: '*', gloss: 'any number of the thing before, including none' },
  { label: '+', insert: '+', gloss: 'one or more of the thing before' },
  { label: '?', insert: '?', gloss: 'the thing before is optional' },
  { label: 'ε', insert: 'ε', gloss: 'the empty string' },
];

function Answer({ ex }: { ex: BuildExercise }) {
  const { machine, complete } = useMemo(() => {
    const p = parseRegex(ex.regex);
    if (!p.ok) return { machine: null, complete: 0 };
    const nfa = regexToNFA(p.node);
    return { machine: forDisplay(minimize(nfa)), complete: minimalStateCount(nfa) };
  }, [ex.regex]);

  return (
    <details className="group mt-4 rounded-xl border border-ink-700 bg-ink-900/40 px-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink-300">
        <span className="inline-block transition group-open:rotate-90" aria-hidden>
          ▸
        </span>
        Show me the answer
      </summary>
      <div className="mt-3">
        <p className="text-xs uppercase tracking-wide text-ink-500">As a pattern</p>
        <p className="math mt-1 break-all text-xl text-ink-100">{ex.regex}</p>
        {machine && (
          <>
            <p className="mt-4 text-xs uppercase tracking-wide text-ink-500">
              As the smallest machine — {complete} state{complete === 1 ? '' : 's'}
              {complete > machine.states.length && `, ${machine.states.length} drawn`}
            </p>
            <div className="mt-2">
              <AutomatonCanvas automaton={machine} readOnly height={300} />
            </div>
            <p className="mt-1 text-xs text-ink-600">
              Computed from the pattern, not drawn by hand.
              {complete > machine.states.length &&
                ' The one state not drawn is the trap: every missing arrow goes there, and it rejects forever. It is left out to keep the picture clean.'}
            </p>
          </>
        )}
        {ex.note && <p className="mt-3 text-sm leading-relaxed text-ink-200">{ex.note}</p>}
      </div>
      <div className="pb-3" />
    </details>
  );
}

function Exercise({ ex }: { ex: BuildExercise }) {
  const [src, setSrc] = useState('');
  const [verdict, setVerdict] = useState<
    null | { ok: true } | { ok: false; message: string } | { ok: false; counterexample: string; weAccept: boolean }
  >(null);

  const target = useMemo(() => {
    const p = parseRegex(ex.regex);
    return p.ok ? regexToNFA(p.node) : null;
  }, [ex.regex]);

  // Live: once the pattern parses, every example ticks over, as in RegexLab.
  const live = useMemo(() => {
    if (!src.trim()) return null;
    const p = parseRegex(src);
    return p.ok ? regexToNFA(p.node) : null;
  }, [src]);
  const mark = (s: string, want: boolean) =>
    live ? (accepts(live, s) === want ? ' ✓' : ' ✗') : '';

  const check = () => {
    const p = parseRegex(src);
    if (!p.ok) return setVerdict({ ok: false, message: p.message });
    if (!target) return;
    const eq = equivalent(regexToNFA(p.node), target);
    setVerdict(eq.equal ? { ok: true } : { ok: false, counterexample: eq.counterexample, weAccept: eq.acceptedBy === 'a' });
  };

  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <p className="text-lg text-ink-100">{ex.title}</p>
        <span role="img" className="shrink-0 text-sm text-mach-400" aria-label={`${ex.stars} of 5 stars`}>
          {STARS(ex.stars)}
        </span>
      </div>
      <p className="mt-2 leading-relaxed text-ink-200">{ex.story}</p>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-400">
        {ex.alphabet.map((c) => (
          <span key={c}>
            <code className="font-mono text-ink-100">{c}</code> = {ex.legend[c]}
          </span>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        {([
          ['yes', ex.accept, true],
          ['no', ex.reject, false],
        ] as const).map(([word, list, want]) => (
          <div key={word}>
            <span className={want ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}>{word}:</span>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono">
              {list.map((s) => {
                const m = mark(s, want);
                return (
                  <li
                    key={s}
                    className={m === ' ✓' ? 'text-[var(--color-good)]' : m === ' ✗' ? 'text-[var(--color-bad)]' : 'text-ink-300'}
                  >
                    {show(s)}
                    {m}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <PatternInput
          value={src}
          onChange={(v) => {
            setSrc(v);
            setVerdict(null);
          }}
          palette={[...ex.alphabet.map((c) => ({ label: c, insert: c, gloss: ex.legend[c] ?? '' })), ...OPERATORS]}
          placeholder="your pattern (optional)"
          ariaLabel="Your pattern"
          onEnter={() => src.trim() && check()}
          inputClassName="math text-lg"
        />
        <Button onClick={check} disabled={!src.trim()} className="mt-2">
          Check
        </Button>
      </div>

      {verdict && verdict.ok && (
        <div className="mt-3">
          <Verdict ok title="Exactly the right language." />
        </div>
      )}
      {verdict && !verdict.ok && 'message' in verdict && (
        <div className="mt-3">
          <Verdict ok={false} title="That is not a well-formed pattern">
            {verdict.message}
          </Verdict>
        </div>
      )}
      {verdict && !verdict.ok && 'counterexample' in verdict && (
        <div className="mt-3">
          <Verdict ok={false} title="Not quite — here is the proof">
            Your pattern <b>{verdict.weAccept ? 'matches' : 'does not match'}</b>{' '}
            <code className="rounded bg-ink-950 px-1.5 py-0.5 font-mono text-ink-100">
              {verdict.counterexample === '' ? 'ε (the empty string)' : verdict.counterexample}
            </code>
            , and it should{verdict.weAccept ? ' not' : ''}. That is the shortest string you get wrong.
          </Verdict>
        </div>
      )}

      <Answer ex={ex} />
    </Panel>
  );
}

export function ExerciseSheet() {
  const [id, setId] = useState(BUILD_EXERCISES[0]!.id);
  const at = Math.max(0, BUILD_EXERCISES.findIndex((x) => x.id === id));
  const ex = BUILD_EXERCISES[at]!;
  const step = (d: number) => setId(BUILD_EXERCISES[(at + d + BUILD_EXERCISES.length) % BUILD_EXERCISES.length]!.id);

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      {/* Phone: one select, so the exercise stays on screen. */}
      <div className="flex items-center gap-2 lg:hidden">
        <label className="sr-only" htmlFor="exercise-pick">
          Exercise
        </label>
        <select
          id="exercise-pick"
          value={id}
          onChange={(e) => setId(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-950 px-3 text-base text-ink-100"
        >
          {BUILD_EXERCISES.map((x) => (
            <option key={x.id} value={x.id}>
              {'★'.repeat(x.stars)} {x.title}
            </option>
          ))}
        </select>
      </div>
      {/* Wide screens: the list beside the exercise. */}
      <nav className="hidden flex-col gap-1 lg:flex lg:w-64 lg:shrink-0" aria-label="Exercises">
        {BUILD_EXERCISES.map((x) => (
          <button
            key={x.id}
            onClick={() => setId(x.id)}
            aria-current={x.id === id}
            className={`flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left text-sm transition
              ${x.id === id ? 'border-mach-500 bg-mach-500/12 text-ink-100' : 'border-ink-700 text-ink-300'}`}
          >
            <span>{x.title}</span>
            <span className="shrink-0 text-xs text-mach-400">{'★'.repeat(x.stars)}</span>
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        {/* key: a fresh Exercise (empty input, closed answer) for each pick. */}
        <Exercise key={ex.id} ex={ex} />
        <div className="mt-3 flex justify-between">
          <Button onClick={() => step(-1)}>‹ Previous</Button>
          <Button onClick={() => step(1)}>Next ›</Button>
        </div>
      </div>
    </div>
  );
}
