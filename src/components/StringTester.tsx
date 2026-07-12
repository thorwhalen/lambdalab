/**
 * Run strings through a machine and watch what happens.
 *
 * Two halves:
 *  - the LEDGER: the puzzle's should-accept / should-reject strings, each with a
 *    live tick or cross. This is the learner's dashboard — they watch crosses
 *    turn into ticks as they fix the machine, which is the tight feedback loop
 *    the whole activity runs on.
 *  - the STEPPER: pick any string and walk the machine through it one symbol at
 *    a time, seeing the set of states it could be in. For an NFA this is the
 *    moment nondeterminism stops being a word and starts being a picture: the
 *    machine is in *several places at once*.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Automaton, StateId } from '../lib/automata/types';
import { accepts, trace } from '../lib/automata/simulate';

export function StringLedger({
  automaton,
  accept,
  reject,
  className = '',
  onPick,
}: {
  automaton: Automaton;
  accept: string[];
  reject: string[];
  className?: string;
  /** Click a string to load it into the stepper. */
  onPick?: (s: string) => void;
}) {
  const rows = useMemo(
    () => [
      ...accept.map((s) => ({ s, want: true })),
      ...reject.map((s) => ({ s, want: false })),
    ],
    [accept, reject],
  );

  return (
    <div className={className}>
      <div className="mb-2 flex items-baseline justify-between">
        <h4 className="text-sm font-semibold text-ink-200">Test strings</h4>
        <span className="font-mono text-[11px] text-ink-500">
          {rows.filter((r) => accepts(automaton, r.s) === r.want).length}/{rows.length} right
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {rows.map(({ s, want }) => {
          const got = accepts(automaton, s);
          const right = got === want;
          return (
            <li key={`${want}-${s}`}>
              <button
                onClick={() => onPick?.(s)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm transition
                  ${onPick ? 'hover:bg-ink-800' : 'cursor-default'}`}
              >
                <span
                  className={`w-4 shrink-0 text-center ${right ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}`}
                >
                  {right ? '✓' : '✗'}
                </span>
                <span className="font-mono text-ink-200">{s === '' ? 'ε' : s}</span>
                <span className="ml-auto font-mono text-[11px] text-ink-500">
                  {want ? 'accept' : 'reject'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function StringStepper({
  automaton,
  input,
  onInputChange,
  onActiveChange,
  alphabet,
}: {
  automaton: Automaton;
  input: string;
  onInputChange: (s: string) => void;
  /** Lifted so the canvas can highlight the current state set. */
  onActiveChange: (states: StateId[]) => void;
  alphabet: string[];
}) {
  const [pos, setPos] = useState(0);
  const t = useMemo(() => trace(automaton, input), [automaton, input]);

  // Clamp when the input or the machine changes underneath us.
  const maxPos = t.steps.length - 1;
  const clamped = Math.min(pos, Math.max(0, maxPos));

  useEffect(() => {
    onActiveChange(t.steps[clamped]?.states ?? []);
  }, [t, clamped, onActiveChange]);

  useEffect(() => {
    setPos(0);
  }, [input]);

  const done = clamped === maxPos && !t.stuckAt;

  return (
    <div className="panel p-4">
      <h4 className="mb-2 text-sm font-semibold text-ink-200">Walk a string through</h4>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {alphabet.map((c) => (
          <button key={c} className="tile !min-w-9 !py-1" onClick={() => onInputChange(input + c)}>
            {c}
          </button>
        ))}
        <button
          className="tile !min-w-9 !py-1 !text-sm"
          onClick={() => onInputChange(input.slice(0, -1))}
          disabled={!input}
        >
          ⌫
        </button>
        <button className="tile !min-w-9 !py-1 !text-sm" onClick={() => onInputChange('')}>
          clr
        </button>
      </div>

      {/* The tape. The symbol about to be eaten is highlighted. */}
      <div className="mb-3 flex min-h-11 flex-wrap items-center gap-1 rounded-lg border border-ink-700 bg-ink-950 p-2">
        {input === '' ? (
          <span className="math px-2 text-lg text-ink-500">ε</span>
        ) : (
          [...input].map((c, i) => (
            <span
              key={i}
              className={`flex size-8 items-center justify-center rounded border font-mono text-sm transition
                ${
                  i < clamped
                    ? 'border-ink-700 bg-ink-800 text-ink-500'
                    : i === clamped
                      ? 'border-lam-400 bg-lam-500/25 text-ink-100'
                      : 'border-ink-700 text-ink-300'
                }`}
            >
              {c}
            </span>
          ))
        )}
      </div>

      <div className="mb-3 flex items-center gap-2">
        <button
          className="tile !min-w-9 !py-1 !text-sm"
          onClick={() => setPos((p) => Math.max(0, p - 1))}
          disabled={clamped === 0}
        >
          ◀
        </button>
        <button
          className="tile !min-w-9 !py-1 !text-sm"
          onClick={() => setPos((p) => Math.min(maxPos, p + 1))}
          disabled={clamped >= maxPos}
        >
          ▶
        </button>
        <span className="font-mono text-xs text-ink-500">
          step {clamped}/{maxPos}
        </span>
      </div>

      <div className="rounded-lg border border-ink-700 bg-ink-900 p-2.5 text-sm">
        <span className="text-ink-500">Could be in: </span>
        {t.steps[clamped]?.states.length ? (
          <span className="font-mono text-ink-100">
            {'{'}
            {t.steps[clamped].states.join(', ')}
            {'}'}
          </span>
        ) : (
          <span className="font-mono text-[var(--color-bad)]">{'{ }'} — stuck, nowhere to go</span>
        )}
        {done && (
          <span
            className={`ml-2 font-semibold ${t.accepted ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}`}
          >
            → {t.accepted ? 'ACCEPT' : 'REJECT'}
          </span>
        )}
      </div>
    </div>
  );
}
