/**
 * Build a machine that accepts exactly the right strings.
 *
 * The grading is the interesting part, and it is *not* "does it pass the test
 * strings". Passing the visible tests is easy and teaches nothing: a machine that
 * memorises the six examples would sail through. Instead we check the learner's
 * machine against the target LANGUAGE — full equivalence, over infinitely many
 * strings — and when it differs we hand back **the shortest string they get
 * wrong**.
 *
 * That single feature is what makes the activity work. "Your machine accepts
 * `bab`, and it shouldn't" is a sentence a child can act on immediately: they can
 * step `bab` through their own machine and watch exactly where it goes astray.
 * A red cross would have told them nothing.
 *
 * Scoring rewards SMALL machines. The par is the true minimal state count, so
 * "beat par" is impossible by definition — you can only tie it — which is
 * precisely the right target: the reward is discovering that the elegant machine
 * exists, not out-grinding a stranger.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Automaton, StateId } from '../../lib/automata/types';
import { parseRegex } from '../../lib/automata/regexParse';
import { regexToNFA } from '../../lib/automata/thompson';
import { minimize } from '../../lib/automata/minimize';
import { equivalent } from '../../lib/automata/equivalence';
import { determinismReport } from '../../lib/automata/simulate';
import { AutomatonCanvas } from '../../components/AutomatonCanvas';
import { StringLedger, StringStepper } from '../../components/StringTester';
import { Button, Panel, Verdict } from '../../components/ui';
import { Leaderboard, NicknameGate, useLeaderboard } from '../../components/Leaderboard';
import { NO_SOLVES, checkAdvance, useProgress } from '../../core/progress';
import {
  BUILD_BOARD,
  BUILD_PAR,
  LADDER,
  LANGUAGE_PUZZLES,
  MAX_LEVEL,
  boardTotal,
  solveLevel,
  type LanguagePuzzle,
} from './content';

const LESSON_ID = 'automata-regex';

/** A machine with nothing in it, ready to be built on. */
const blank = (alphabet: string[]): Automaton => ({
  states: [],
  alphabet,
  transitions: [],
  start: '',
  accepting: [],
  layout: {},
});

/**
 * Points. Correctness is most of it; elegance is the rest.
 *
 * Using more states than the minimum costs you, but never below a floor — a
 * clumsy machine that WORKS is a real achievement and the score should say so.
 */
const BASE_PER_LEVEL = 120;
const EXTRA_STATE_COST = 40;
const FLOOR_FRACTION = 0.4;

function scoreFor(level: number, states: number, par: number): number {
  const base = BASE_PER_LEVEL * level;
  const penalty = Math.max(0, states - par) * EXTRA_STATE_COST;
  return Math.round(Math.max(base * FLOOR_FRACTION, base - penalty));
}

interface Wrong {
  counterexample: string;
  /** True when the LEARNER's machine accepts it (and shouldn't). */
  weAccept: boolean;
}

export function MachineBuilder({ level }: { level: number }) {
  const [index, setIndex] = useState(0);
  const [machine, setMachine] = useState<Automaton>(blank(['a', 'b']));
  const [active, setActive] = useState<StateId[]>([]);
  const [stepInput, setStepInput] = useState('');
  const [wrong, setWrong] = useState<Wrong | null>(null);
  const [solved, setSolved] = useState<number | null>(null);
  const [unlocked, setUnlocked] = useState<number | null>(null);
  const [showHint, setShowHint] = useState(false);

  const { recordSolve } = useProgress();
  const solvedMap = useProgress((s) => s.lessons[LESSON_ID]?.solved ?? NO_SOLVES);
  const board = useLeaderboard(BUILD_BOARD);

  // Levels 1-2 are pure DFA-building; from 5 the NFA puzzles join the pool.
  const pool = useMemo(
    () => LANGUAGE_PUZZLES.filter((p) => p.level === level && !p.impossible),
    [level],
  );
  const puzzle: LanguagePuzzle | undefined = pool[index % Math.max(1, pool.length)];

  const target = useMemo(() => {
    if (!puzzle) return null;
    const p = parseRegex(puzzle.regex);
    return p.ok ? regexToNFA(p.node) : null;
  }, [puzzle]);

  /**
   * Par is the number of states the learner must actually DRAW.
   *
   * `minimalStateCount` counts the trap state, because that is what "how many
   * states does this language need?" means in Myhill-Nerode terms. But nobody
   * draws a trap — a missing arrow *is* the trap — so quoting that number sets a
   * target the learner can never hit, and then beats them up for missing it.
   * `minimize()` drops the trap for display; that is the honest par.
   */
  const par = useMemo(() => (target ? minimize(target).states.length : 0), [target]);

  // A new puzzle means a fresh canvas.
  useEffect(() => {
    if (!puzzle) return;
    setMachine(blank(puzzle.alphabet));
    setWrong(null);
    setSolved(null);
    setUnlocked(null);
    setShowHint(false);
    setStepInput('');
  }, [puzzle]);

  const onActiveChange = useCallback((s: StateId[]) => setActive(s), []);

  if (!puzzle || !target) {
    return (
      <Panel>
        <p className="text-ink-400">No building puzzles at this level.</p>
      </Panel>
    );
  }

  const det = determinismReport(machine);
  const wantsDFA = level <= 4;

  const check = () => {
    if (machine.states.length === 0 || !machine.start) {
      setWrong(null);
      return;
    }
    const eq = equivalent(machine, target);
    if (eq.equal) {
      const pts = scoreFor(puzzle.level, machine.states.length, par);
      setSolved(pts);
      setWrong(null);
      recordSolve(LESSON_ID, puzzle.id, pts);

      const { total, solved } = boardTotal(solvedMap, puzzle.id, pts);
      void board.submit(total, { solved });

      const up = checkAdvance(LESSON_ID, puzzle.level, LADDER[puzzle.level - 1].toAdvance, solveLevel, MAX_LEVEL);
      if (up) setUnlocked(up);
    } else {
      setWrong({ counterexample: eq.counterexample, weAccept: eq.acceptedBy === 'a' });
      setSolved(null);
    }
  };

  return (
    <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
      <div className="min-w-0 flex-1">
        <Panel>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="mb-1 text-sm text-ink-500">Build a machine that accepts exactly:</p>
              <p className="text-lg text-ink-100">{puzzle.prompt}</p>
              <p className="mt-1 font-mono text-xs text-ink-500">
                alphabet: {'{'}
                {puzzle.alphabet.join(', ')}
                {'}'} · smallest possible machine: <b className="text-ink-300">{par} states</b>
              </p>
            </div>
            <span className="shrink-0 font-mono text-xs text-ink-500">
              {index + 1}/{pool.length}
              {solvedMap[puzzle.id] && <span className="ml-2 text-[var(--color-good)]">✓</span>}
            </span>
          </div>

          <AutomatonCanvas
            automaton={machine}
            onChange={setMachine}
            active={active}
            symbols={wantsDFA ? puzzle.alphabet : [...puzzle.alphabet, 'ε']}
            height={340}
          />

          {/* A gentle nudge, never a scolding. Nondeterminism is legal from level 5;
              before that it is almost always an accident, so we say so. */}
          {wantsDFA && machine.states.length > 0 && !det.isDeterministic && (
            <p className="mt-2 text-xs text-info-400">
              Heads up: this machine is nondeterministic — {det.nondeterministic.length > 0
                ? `state ${det.nondeterministic[0].state} has two arrows on "${det.nondeterministic[0].on}"`
                : 'it has ε-moves'}
              . That is allowed, and it still works — but at this level there is always a
              deterministic answer, and it is usually simpler.
            </p>
          )}
          {wantsDFA && det.missing.length > 0 && machine.states.length > 0 && (
            <p className="mt-1 text-xs text-ink-500">
              {det.missing.length} missing arrow{det.missing.length > 1 ? 's' : ''} (e.g. state{' '}
              {det.missing[0].state} has nowhere to go on "{det.missing[0].on}"). A missing arrow
              means the machine gets stuck and rejects — which is often exactly what you want.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={check} disabled={!machine.start}>
              Check my machine
            </Button>
            <Button onClick={() => setMachine(blank(puzzle.alphabet))}>Clear</Button>
            {puzzle.hint && !showHint && <Button onClick={() => setShowHint(true)}>Hint</Button>}
            <Button
              onClick={() => {
                setIndex((i) => (i + 1) % Math.max(1, pool.length));
              }}
            >
              Skip
            </Button>
          </div>

          {showHint && puzzle.hint && (
            <div className="mt-3 rounded-xl border border-info-500/35 bg-info-500/8 p-3 text-sm text-ink-200">
              {puzzle.hint}
            </div>
          )}

          {wrong && (
            <div className="mt-4">
              <Verdict ok={false} title="Close — but here is a string it gets wrong">
                <p>
                  Your machine{' '}
                  <b className={wrong.weAccept ? 'text-[var(--color-bad)]' : 'text-[var(--color-bad)]'}>
                    {wrong.weAccept ? 'accepts' : 'rejects'}
                  </b>{' '}
                  the string{' '}
                  <code className="rounded bg-ink-950 px-1.5 py-0.5 font-mono text-ink-100">
                    {wrong.counterexample === '' ? 'ε (the empty string)' : wrong.counterexample}
                  </code>
                  , and it should{' '}
                  <b className="text-[var(--color-good)]">{wrong.weAccept ? 'reject' : 'accept'}</b>{' '}
                  it.
                </p>
                <p className="mt-2 text-ink-400">
                  This is the <em>shortest</em> string you get wrong — there is nothing smaller to
                  worry about. Load it into the stepper and walk it through.
                </p>
                <Button className="mt-3" onClick={() => setStepInput(wrong.counterexample)}>
                  Step through “{wrong.counterexample || 'ε'}”
                </Button>
              </Verdict>
            </div>
          )}

          {solved !== null && (
            <div className="mt-4">
              <Verdict
                ok
                title={
                  machine.states.length === par
                    ? `Perfect — and you used the minimum ${par} states. +${solved} points`
                    : `Correct. +${solved} points`
                }
              >
                <p>
                  Your machine accepts exactly the right language — all of it, including the
                  infinitely many strings you never tested.
                </p>
                {machine.states.length > par && (
                  <p className="mt-1 text-ink-400">
                    You used {machine.states.length} states; it can be done in {par}. Worth a second
                    look — is there a state that is doing the same job as another?
                  </p>
                )}
                {puzzle.note && <p className="mt-2 text-ink-200">{puzzle.note}</p>}
              </Verdict>

              {unlocked && (
                <div className="mt-3 rounded-xl border border-mach-500/50 bg-mach-500/12 p-3 text-sm">
                  <b className="text-mach-400">Level {unlocked} reached</b> —{' '}
                  <span className="text-ink-300">{LADDER[unlocked - 1].goal}</span>
                </div>
              )}

              <Button
                variant="primary"
                className="mt-3"
                onClick={() => setIndex((i) => (i + 1) % Math.max(1, pool.length))}
              >
                Next puzzle →
              </Button>
            </div>
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-4 xl:w-72 xl:shrink-0">
        <Panel>
          <StringLedger
            automaton={machine}
            accept={puzzle.accept}
            reject={puzzle.reject}
            onPick={setStepInput}
          />
          <p className="mt-3 border-t border-ink-700 pt-2 text-xs text-ink-600">
            These are examples, not the whole language. Passing them all is necessary — it is not
            sufficient. “Check my machine” tests the real thing.
          </p>
        </Panel>

        <StringStepper
          automaton={machine}
          input={stepInput}
          onInputChange={setStepInput}
          onActiveChange={onActiveChange}
          alphabet={puzzle.alphabet}
        />

        <NicknameGate />
        <Leaderboard
          board={BUILD_BOARD}
          par={BUILD_PAR}
          entries={board.entries}
          mode={board.mode}
          best={board.best}
          metric={(d) => `${d.solved} built`}
        />
      </div>
    </div>
  );
}
