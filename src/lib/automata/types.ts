/**
 * Types for the finite-automata engine.
 *
 * One `Automaton` type covers DFAs and NFAs (with ε-moves): a DFA is just an
 * automaton that happens to be deterministic and total. Keeping a single type
 * means the simulator, the equivalence checker and the UI never need to know
 * which flavour they hold — `determinismReport` tells them when it matters.
 */

/** A single symbol of the alphabet. Always exactly one character. */
export type Sym = string;

/** The ε (empty-string) move. Not a member of any alphabet. */
export const EPSILON = 'ε' as const;
export type Epsilon = typeof EPSILON;

export type StateId = string;

export interface Transition {
  from: StateId;
  /** An alphabet symbol, or EPSILON for a free move. */
  on: Sym | Epsilon;
  to: StateId;
}

/** Layout is carried alongside the maths so the editor can round-trip a machine. */
export interface StateLayout {
  x: number;
  y: number;
}

export interface Automaton {
  states: StateId[];
  alphabet: Sym[];
  transitions: Transition[];
  start: StateId;
  accepting: StateId[];
  /** Optional editor geometry, keyed by state id. Ignored by all the maths. */
  layout?: Record<string, StateLayout>;
}

/** Why a machine is (or isn't) a DFA — used to nudge the learner, not to scold. */
export interface DeterminismReport {
  isDeterministic: boolean;
  /** True when every (state, symbol) pair has exactly one target. */
  isTotal: boolean;
  hasEpsilon: boolean;
  /** (state, symbol) pairs with more than one target. */
  nondeterministic: Array<{ state: StateId; on: Sym; targets: StateId[] }>;
  /** (state, symbol) pairs with no target at all. */
  missing: Array<{ state: StateId; on: Sym }>;
}

/** One step of a run, for the animation. */
export interface TraceStep {
  /** Index into the input string; `pos === input.length` is the final rest. */
  pos: number;
  /** The set of states the machine could be in after consuming input[0..pos). */
  states: StateId[];
  /** The symbol consumed to reach this step (undefined for the initial step). */
  consumed?: Sym;
}

export interface Trace {
  input: string;
  steps: TraceStep[];
  accepted: boolean;
  /** Set when the run died: no state survives from here on. */
  stuckAt?: number;
}

/**
 * The result of comparing two machines. When they differ we always produce the
 * *shortest* string they disagree on — that counterexample is the feedback.
 */
export type Equivalence =
  | { equal: true }
  | {
      equal: false;
      /** Shortest string on which the two machines disagree (ties: lexicographic). */
      counterexample: string;
      /** Which machine accepts it. */
      acceptedBy: 'a' | 'b';
    };

// ---------------------------------------------------------------------------
// Regular expressions
// ---------------------------------------------------------------------------

/**
 * Regex AST. Deliberately a *teaching* regex — no backreferences, no lookaround,
 * no character classes beyond what we choose to sugar. This is the regular
 * language of the theory, which is exactly the point of the lesson.
 */
export type RegexNode =
  /** ∅ — matches nothing at all. */
  | { kind: 'empty' }
  /** ε — matches only the empty string. */
  | { kind: 'epsilon' }
  | { kind: 'literal'; sym: Sym }
  | { kind: 'concat'; left: RegexNode; right: RegexNode }
  | { kind: 'union'; left: RegexNode; right: RegexNode }
  | { kind: 'star'; inner: RegexNode }
  | { kind: 'plus'; inner: RegexNode }
  | { kind: 'optional'; inner: RegexNode };

export type ParseResult =
  | { ok: true; node: RegexNode }
  | { ok: false; message: string; at?: number };
