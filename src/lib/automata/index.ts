/**
 * The finite-automata engine: public surface.
 *
 * This is a teaching engine for the regular languages. Every function here is a
 * pure function of plain data — an `Automaton` is a record, not an object with
 * methods — so the UI can replay, scrub, diff and animate anything the engine
 * produces, and the grader can hand a child not just a verdict but the *evidence*
 * for it. Nothing throws on a malformed machine: a child is editing it live.
 *
 * THE ROUND TRIP (this is what the lesson is for)
 *
 * Kleene's theorem, made clickable — every regex is a machine, and every machine
 * is a regex:
 *
 *     regex text ──parseRegex──▶ RegexNode ──regexToNFA──▶ ε-NFA   (Thompson)
 *          ▲                                                 │
 *          │                                            toDFA│     (subset construction)
 *   renderRegex                                              ▼
 *          │                                                DFA
 *          │                                                 │
 *          └──automatonToRegex────── minimal DFA ◀──minimize─┘     (Moore)
 *                (state elimination)
 *
 * Both directions ship a `*Steps` twin — `regexToNFASteps`, `automatonToRegexSteps`
 * — which returns the same construction one frame at a time, with a caption. The
 * animation is not a nicety bolted on afterwards; it is why those functions exist.
 * Going *round* the loop should land you back where you started, and `equivalent`
 * is how a test (or a child) checks that it did.
 *
 * GRADING, AND WHY THE WITNESS MATTERS
 *
 * `equivalent(theirs, reference)` never merely says "wrong". When two machines
 * differ it returns the SHORTEST string they disagree on (ties broken
 * lexicographically), because "wrong" teaches nothing and "your machine accepts
 * 'aab', but it shouldn't" teaches. That guarantee is why the whole engine is
 * pedantic about two things a casual implementation gets away with: comparisons
 * happen over the UNION alphabet (else a learner who forgot the letter 'b' gets
 * congratulated), and every DFA we hand back is TOTAL, with an explicit trap
 * state (else complementing it silently computes the wrong language).
 *
 * Determinism is a correctness property here, not a preference: generated state
 * names ("{q0,q2}", "q0|q3") are stable across runs and machines, because the UI
 * diffs frames on them. Every collection is sorted by UTF-16 code unit, never by
 * `localeCompare`, whose collation depends on the host's ICU build.
 *
 * WHAT LIVES WHERE
 *   types.ts       Automaton, Transition, Trace, RegexNode, verdicts. Fixed contract.
 *   simulate.ts    Run a machine: accepts, trace, ε-closure, determinism report.
 *   regexParse.ts  Regex text <-> RegexNode, plus simplify/size/alphabet.
 *   thompson.ts    RegexNode -> ε-NFA, with the animation frames. (Kleene, ->)
 *   subset.ts      ε-NFA -> total DFA; complement, product, the boolean closure.
 *   minimize.ts    Moore's refinement: the smallest machine, and the par score.
 *   equivalence.ts Do two machines agree? If not, the shortest string they don't.
 *   toRegex.ts     Automaton -> RegexNode by state elimination. (Kleene, <-)
 *
 * ONE TRAP FOR CALLERS, stated here because it looks like a bug and is not:
 * `minimalStateCount(a)` and `minimize(a).states.length` DISAGREE, on purpose.
 * The former counts Myhill–Nerode classes of Σ*, which includes the dead-word
 * class — the textbook number, and the right par score. The latter omits the trap,
 * because a diagram should not draw one. "Exactly ab" scores 4 but draws 3.
 */

// --- The contract: machines, runs, regexes, verdicts -------------------------

export { EPSILON } from './types';
export type {
  Automaton,
  DeterminismReport,
  Epsilon,
  Equivalence,
  ParseResult,
  RegexNode,
  StateId,
  StateLayout,
  Sym,
  Trace,
  TraceStep,
  Transition,
} from './types';

// --- Running a machine --------------------------------------------------------

export {
  accepts,
  alphabetOf,
  determinismReport,
  epsilonClosure,
  reachableStates,
  step,
  trace,
} from './simulate';

// --- Regexes: text <-> AST ----------------------------------------------------

export { parseRegex, regexAlphabet, regexSize, renderRegex, simplifyRegex } from './regexParse';

// --- Kleene, forwards: regex -> machine (Thompson's construction) --------------

export type { ThompsonStep } from './thompson';
export { regexToNFA, regexToNFASteps } from './thompson';

// --- Determinising, and the boolean closure ------------------------------------

export type { BooleanOp } from './subset';
export { complement, complete, product, toDFA } from './subset';

// --- The smallest machine, and the par score ------------------------------------

export { minimalStateCount, minimize, removeUnreachable } from './minimize';

// --- Grading: do two machines agree, and if not, on what? ------------------------

export { acceptsLanguage, equivalent, sampleStrings, shortestAccepted } from './equivalence';

// --- Kleene, backwards: machine -> regex (state elimination) ----------------------

export type { EliminationStep } from './toRegex';
export { automatonToRegex, automatonToRegexSteps } from './toRegex';
