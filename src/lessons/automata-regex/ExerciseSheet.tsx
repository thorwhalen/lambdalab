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
 * No score and no rung: this sheet is practice.
 */
import { useMemo, useState } from 'react';
import { parseRegex } from '../../lib/automata/regexParse';
import { regexToNFA } from '../../lib/automata/thompson';
import { equivalent } from '../../lib/automata/equivalence';
import { minimize } from '../../lib/automata/minimize';
import { forDisplay } from '../../lib/automata/layout';
import { AutomatonCanvas } from '../../components/AutomatonCanvas';
import { Button, Panel, Verdict } from '../../components/ui';
import { BUILD_EXERCISES, type BuildExercise } from './exercises';

const STARS = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
const show = (s: string) => (s === '' ? 'ε' : s);

/** The theory regex's symbols, offered as buttons next to the alphabet. */
const OPERATORS = ['(', ')', '|', '*', '+', '?', 'ε'];

function Answer({ ex }: { ex: BuildExercise }) {
  const machine = useMemo(() => {
    const p = parseRegex(ex.regex);
    return p.ok ? forDisplay(minimize(regexToNFA(p.node))) : null;
  }, [ex.regex]);

  return (
    <details className="mt-4 rounded-xl border border-ink-700 bg-ink-900/40 p-3">
      <summary className="cursor-pointer text-sm font-medium text-ink-300">Show me the answer</summary>
      <div className="mt-3">
        <p className="text-xs uppercase tracking-wide text-ink-500">As a pattern</p>
        <p className="math mt-1 break-all text-xl text-ink-100">{ex.regex}</p>
        {machine && (
          <>
            <p className="mt-4 text-xs uppercase tracking-wide text-ink-500">
              As the smallest machine — {machine.states.length} state{machine.states.length === 1 ? '' : 's'}
            </p>
            <div className="mt-2">
              <AutomatonCanvas automaton={machine} readOnly height={300} />
            </div>
            <p className="mt-1 text-xs text-ink-600">
              Computed from the pattern, not drawn by hand. Any arrow that is missing goes to a trap state
              that rejects forever; it is left out to keep the picture clean.
            </p>
          </>
        )}
        {ex.note && <p className="mt-3 text-sm leading-relaxed text-ink-200">{ex.note}</p>}
      </div>
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
        <span className="shrink-0 text-sm text-mach-400" aria-label={`${ex.stars} of 5 stars`}>
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
        <div>
          <span className="text-[var(--color-good)]">yes:</span>{' '}
          <span className="font-mono text-ink-300">{ex.accept.map(show).join('  ')}</span>
        </div>
        <div>
          <span className="text-[var(--color-bad)]">no:</span>{' '}
          <span className="font-mono text-ink-300">{ex.reject.map(show).join('  ')}</span>
        </div>
      </div>

      <div className="mt-4">
        <input
          value={src}
          onChange={(e) => {
            setSrc(e.target.value);
            setVerdict(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && src.trim() && check()}
          placeholder="your pattern (optional)"
          spellCheck={false}
          autoCapitalize="off"
          aria-label="Your pattern"
          className="math w-full rounded-xl border border-ink-600 bg-ink-950 px-4 py-2.5 text-lg text-ink-100
            outline-none placeholder:text-ink-600 focus:border-mach-500"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[...ex.alphabet, ...OPERATORS].map((s) => (
            <button
              key={s}
              className="tile !min-w-9 !py-1"
              onClick={() => {
                setSrc((v) => v + s);
                setVerdict(null);
              }}
            >
              {s}
            </button>
          ))}
          <Button onClick={check} disabled={!src.trim()} className="ml-auto">
            Check
          </Button>
        </div>
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
  const [id, setId] = useState(BUILD_EXERCISES[0].id);
  const ex = BUILD_EXERCISES.find((x) => x.id === id) ?? BUILD_EXERCISES[0];

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <nav className="flex flex-col gap-1 lg:w-64 lg:shrink-0" aria-label="Exercises">
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
      </div>
    </div>
  );
}
