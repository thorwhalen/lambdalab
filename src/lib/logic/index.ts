/**
 * The set-theory-and-logic engine: public surface.
 *
 * This is a teaching engine for first-order logic over finite models, built on
 * one identification that the lesson exists to make: **a set and a unary
 * predicate are the same thing.** `x ∈ Dogs` and `Dogs(x)` are not two notations
 * to be learned separately and related later — they are one AST node, resolved
 * at parse time. Everything downstream inherits that: `evalSet` and `evaluate`
 * are mutually recursive, `A ⊆ B` and `∀x (A(x) → B(x))` gloss to the same
 * English, and a child who learns to read one notation has learned both.
 *
 * The round trip this engine supports:
 *
 *     tiles ──parseFormula──▶ Formula ──renderFormula──▶ tiles/text
 *                               │  ╲
 *                       evaluate│   ╲gloss
 *                               ▼    ╲
 *     Signature ─enumerateModels─▶ Model ─▶ true/false      English
 *                               │
 *                logicEquivalent │ (vs. the reference formula)
 *                               ▼
 *                   LogicEquivalence: equal, or the SIMPLEST world that separates them
 *
 * The learner clicks tiles, never types, so their input is always a token
 * sequence we can parse. Grading is by *exhaustive model checking*: we enumerate
 * every interpretation over every domain of size 1..maxDomain and compare their
 * sentence with the reference one. When the two ever disagree, the disagreeing
 * model IS the feedback — a concrete tiny universe in which the learner's
 * sentence says the wrong thing, which the UI can draw. That is why the model
 * enumeration order is a hard contract (simplest worlds first) rather than an
 * implementation detail: the first separating model is the one the child sees.
 *
 * The one thing a caller must know before trusting an `equal: true`: this is the
 * SMALL-SCOPE HYPOTHESIS, not a decision procedure (FO equivalence is
 * undecidable). Two formulas that first differ only in a world of 4+ elements
 * are wrongly reported equal. See `equivalence.ts` for the limit stated plainly
 * and the mitigations available to puzzle authors.
 *
 * WHAT LIVES WHERE
 *   types.ts       Formula/SetExpr/Term AST, Signature, Model, Tile, verdicts. Fixed contract.
 *   parse.ts       tiles/text -> Formula, and Formula -> text. Two halves of one contract.
 *   evaluate.ts    Tarskian semantics: what a formula MEANS in one model. Throws on caller bugs.
 *   models.ts      Enumerate every little universe over a signature, simplest first.
 *   equivalence.ts Grading: model-check a learner's formula against the reference.
 *   english.ts     Formula -> a sentence a child can read aloud. Injective on purpose.
 *
 * Domains start at size 1: classical first-order logic quantifies over a
 * NON-EMPTY domain, and the empty domain would make `∃x ⊤` false and `∀x ⊥`
 * true — a coherent logic, but not the one we are teaching.
 */

// --- Syntax, models, verdicts (the fixed contract) --------------------------

export type {
  Assignment,
  Formula,
  LogicEquivalence,
  LogicParseResult,
  Model,
  SetExpr,
  Signature,
  Term,
  Tile,
  TileKind,
} from './types';

// --- Reading and writing formulas -------------------------------------------

export { formulaSize, parseFormula, renderFormula, renderSet, tokenizeLogic } from './parse';

// --- Semantics: the meaning of a formula in one world -----------------------

export { evalSet, evaluate, freeVars, isClosed } from './evaluate';

// --- Model enumeration: every world over a signature ------------------------

export {
  DOMAIN_NAMES,
  MAX_DOMAIN_SIZE,
  MIN_DOMAIN_SIZE,
  describeModel,
  enumerateModels,
  modelCount,
} from './models';

// --- Grading: is the learner's sentence the reference sentence? --------------

export {
  DEFAULT_MAX_DOMAIN,
  MAX_MODELS,
  isTautology,
  logicEquivalent,
  satisfiable,
} from './equivalence';

// --- English readings --------------------------------------------------------

export type { Nouns } from './english';
export { gloss } from './english';
