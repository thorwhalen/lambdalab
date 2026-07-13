/**
 * The round trip: machine ⇄ pattern.
 *
 * Kleene's theorem says these two things — a machine with states and arrows, and
 * a one-line pattern — describe exactly the same class of languages. Not "almost
 * the same": *exactly*. That is a genuinely surprising theorem, and the only
 * honest way to believe it is to watch the conversion happen in both directions
 * and check that nothing was lost.
 *
 * So this activity does not ask the learner to *trust* the equivalence. It runs
 * it, step by step, on a machine they built themselves, and then verifies the
 * result against the original with the equivalence checker. If the theorem were
 * false, this page would say so.
 *
 * MACHINE → PATTERN: state elimination. Rip out one state at a time; every path
 * that went *through* it has to be spelled out on the arrows that survive. When
 * only the start and the finish are left, the label on the single remaining arrow
 * IS the regular expression.
 *
 * PATTERN → MACHINE: Thompson's construction, then subset construction, then
 * minimisation — watch a nine-state ε-spaghetti collapse into four honest states.
 */
import { useMemo, useState } from 'react';
import type { Automaton } from '../../lib/automata/types';
import { parseRegex, renderRegex, simplifyRegex } from '../../lib/automata/regexParse';
import { regexToNFA } from '../../lib/automata/thompson';
import { automatonToRegex, automatonToRegexSteps } from '../../lib/automata/toRegex';
import { toDFA } from '../../lib/automata/subset';
import { minimize } from '../../lib/automata/minimize';
import { equivalent } from '../../lib/automata/equivalence';
import { forDisplay } from '../../lib/automata/layout';
import { AutomatonCanvas } from '../../components/AutomatonCanvas';
import { Button, Panel, Verdict } from '../../components/ui';
import { LANGUAGE_PUZZLES } from './content';

type Dir = 'toRegex' | 'toMachine';

/** Machines worth converting: small enough to follow, interesting enough to bother. */
const SPECIMENS = LANGUAGE_PUZZLES.filter((p) =>
  ['a2-contains-ab', 'a2-even-a', 'a2-no-two-b', 'a3-ab-repeated', 'a2-len-div-3', 'a6-odd-a'].includes(p.id),
);

export function ConvertLab() {
  const [dir, setDir] = useState<Dir>('toRegex');
  const [pick, setPick] = useState(0);
  const [step, setStep] = useState(0);

  const puzzle = SPECIMENS[pick % SPECIMENS.length];

  /** The machine we eliminate from: the minimal DFA for the language. Small, so the
      elimination is followable, and canonical, so it is the same every time. */
  const machine = useMemo<Automaton | null>(() => {
    const p = parseRegex(puzzle.regex);
    if (!p.ok) return null;
    // `forDisplay` renames the states. It has to: the subset construction names a
    // state after the SET of NFA states it stands for, which is the whole point of
    // the algorithm and completely unreadable once minimisation has joined a few
    // of them with "|". A state called
    // {q0,q12,q14,q16,q17,q18,q19,q2,q3,q4,q5,q7,q8}|{q1,q6} teaches nobody
    // anything. The maths is untouched; only the labels change.
    return forDisplay(minimize(toDFA(regexToNFA(p.node)).dfa));
  }, [puzzle]);

  const steps = useMemo(() => (machine ? automatonToRegexSteps(machine) : []), [machine]);
  const finalRegex = useMemo(() => (machine ? automatonToRegex(machine) : null), [machine]);

  /** The proof: turn the derived regex back into a machine and compare. */
  const verified = useMemo(() => {
    if (!machine || !finalRegex) return null;
    return equivalent(machine, regexToNFA(finalRegex)).equal;
  }, [machine, finalRegex]);

  // --- pattern → machine side ---
  const built = useMemo(() => {
    const p = parseRegex(puzzle.regex);
    if (!p.ok) return null;
    const nfa = regexToNFA(p.node);
    const { dfa } = toDFA(nfa);
    const min = minimize(dfa);
    return { nfa: forDisplay(nfa), dfa: forDisplay(dfa), min: forDisplay(min) };
  }, [puzzle]);

  if (!machine || !built) return null;

  /**
   * The last frame.
   *
   * Each `EliminationStep` carries the graph as it was *before* that state was
   * ripped out, so after the final step there is no frame left to show — and the
   * picture would still be displaying the state we just said we removed. What
   * actually remains at the end is two states and one arrow, and the label on
   * that arrow IS the answer. So we draw exactly that. It is the punchline of the
   * whole activity and it deserves to be on screen, not just in a paragraph.
   */
  const finished: Automaton | null =
    finalRegex && {
      states: ['START', 'ACCEPT'],
      alphabet: [],
      transitions: [{ from: 'START', on: renderRegex(simplifyRegex(finalRegex)), to: 'ACCEPT' }],
      start: 'START',
      accepting: ['ACCEPT'],
      layout: { START: { x: 90, y: 140 }, ACCEPT: { x: 480, y: 140 } },
    };

  const shown =
    dir !== 'toRegex'
      ? null
      : step === 0
        ? machine
        : step >= steps.length
          ? (finished ?? machine)
          : (steps[step - 1]?.before ?? machine);

  return (
    <div>
      <Panel>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-ink-700 p-0.5">
            {(
              [
                ['toRegex', 'Machine → pattern'],
                ['toMachine', 'Pattern → machine'],
              ] as Array<[Dir, string]>
            ).map(([d, label]) => (
              <button
                key={d}
                onClick={() => {
                  setDir(d);
                  setStep(0);
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  dir === d ? 'bg-mach-500 text-ink-950' : 'text-ink-400 hover:text-ink-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            value={pick}
            onChange={(e) => {
              setPick(Number(e.target.value));
              setStep(0);
            }}
            className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-ink-200 outline-none"
          >
            {SPECIMENS.map((p, i) => (
              <option key={p.id} value={i}>
                {p.prompt.slice(0, 48)}
              </option>
            ))}
          </select>
        </div>

        {dir === 'toRegex' ? (
          <>
            <p className="mb-4 text-ink-300">
              Rip out one state at a time. Every path that used to go <em>through</em> that state
              must still be sayable — so it gets written onto the arrows that are left. Keep going
              until only the start and the finish remain, and read the answer off the last arrow.
            </p>

            <AutomatonCanvas automaton={shown!} readOnly height={320} />

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
                ◀ Back
              </Button>
              <Button
                variant="primary"
                onClick={() => setStep((s) => Math.min(steps.length, s + 1))}
                disabled={step >= steps.length}
              >
                {step === 0 ? 'Start ripping ▶' : 'Rip out the next state ▶'}
              </Button>
              <Button onClick={() => setStep(0)}>Reset</Button>
              <span className="font-mono text-xs text-ink-500">
                {step}/{steps.length} states removed
              </span>
            </div>

            {step > 0 && steps[step - 1] && (
              <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900/50 p-4">
                <p className="text-sm text-ink-200">
                  <b className="font-mono text-mach-400">Removed {steps[step - 1].removed}.</b>{' '}
                  {steps[step - 1].explain}
                </p>
                <p className="math mt-2 break-all text-lg text-ink-100">
                  {steps[step - 1].regexSoFar}
                </p>
              </div>
            )}

            {step >= steps.length && finalRegex && (
              <div className="mt-4">
                <Verdict ok title="Nothing left to rip out. That's the pattern.">
                  <div className="math my-2 break-all text-2xl text-ink-100">
                    {renderRegex(simplifyRegex(finalRegex))}
                  </div>
                  <p>
                    And here is the point: turn that pattern back into a machine with Thompson's
                    construction, and check it against the one we started with.{' '}
                    {verified ? (
                      <b className="text-[var(--color-good)]">
                        They accept exactly the same strings. Verified, just now, by the equivalence
                        checker — not asserted.
                      </b>
                    ) : (
                      <b className="text-[var(--color-bad)]">
                        They differ — which would mean this engine has a bug. Please tell someone.
                      </b>
                    )}
                  </p>
                  <p className="mt-2 text-ink-400">
                    That is Kleene's theorem. Machines and patterns are two notations for one idea.
                  </p>
                </Verdict>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="mb-4 text-ink-300">
              Go the other way. The pattern{' '}
              <code className="math rounded bg-ink-950 px-1.5 py-0.5 text-ink-100">
                {puzzle.regex}
              </code>{' '}
              becomes a machine in three moves — and watch the state count.
            </p>

            <div className="flex flex-col gap-5">
              {(
                [
                  [
                    "1. Thompson's construction",
                    built.nfa,
                    'Each piece of the pattern becomes a tiny machine; they are glued together with free ε-jumps. Correct, and comically wasteful.',
                  ],
                  [
                    '2. Subset construction',
                    built.dfa,
                    'Now make it deterministic. Each state of THIS machine is a *set* of states of the last one — "all the places the old machine could be at once". The ε-jumps vanish.',
                  ],
                  [
                    '3. Minimisation',
                    built.min,
                    'Finally, merge any two states that behave identically on every possible future input. What is left is the smallest machine that can recognise this language. There is exactly one, up to renaming.',
                  ],
                ] as Array<[string, Automaton, string]>
              ).map(([title, m, blurb]) => (
                <div key={title}>
                  <div className="mb-1.5 flex items-baseline gap-3">
                    <h4 className="font-semibold text-ink-100">{title}</h4>
                    <span className="font-mono text-xs text-ink-500">{m.states.length} states</span>
                  </div>
                  <p className="mb-2 text-sm text-ink-400">{blurb}</p>
                  <AutomatonCanvas automaton={m} readOnly height={260} />
                </div>
              ))}
            </div>

            <div className="mt-5">
              <Verdict ok title={`${built.nfa.states.length} states → ${built.min.states.length}`}>
                Same language throughout. Every one of those three machines accepts exactly the
                strings the pattern describes — the last one just does it without wasting anything.
              </Verdict>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
