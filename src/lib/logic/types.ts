/**
 * Types for the set-theory-and-logic engine.
 *
 * The central design choice: **a set and a unary predicate are the same thing.**
 * `x ∈ Dogs` and `Dogs(x)` denote the same fact, so one engine covers both the
 * set-theory notation and the predicate-logic notation, and the lesson can make
 * the identification explicit rather than teaching two disconnected languages.
 *
 * Grading is by *exhaustive model checking*: we enumerate every interpretation
 * over small domains and compare the learner's formula with the reference one.
 * When they differ, the differing model IS the feedback — a concrete tiny
 * universe in which the learner's sentence says the wrong thing.
 */

// ---------------------------------------------------------------------------
// Syntax
// ---------------------------------------------------------------------------

/** A variable bound by a quantifier, or a named constant of the domain. */
export type Term =
  | { kind: 'var'; name: string }
  | { kind: 'const'; name: string };

/**
 * A set expression denotes a subset of the domain. `SetAtom` names a unary
 * predicate — the identification above in code form.
 */
export type SetExpr =
  | { kind: 'set'; name: string }
  | { kind: 'union'; left: SetExpr; right: SetExpr }
  | { kind: 'inter'; left: SetExpr; right: SetExpr }
  | { kind: 'diff'; left: SetExpr; right: SetExpr }
  | { kind: 'compl'; inner: SetExpr }
  | { kind: 'universe' }
  | { kind: 'emptyset' }
  /** {x | φ(x)} — set-builder. Late-game notation. */
  | { kind: 'builder'; varName: string; body: Formula };

export type Formula =
  /** t ∈ S */
  | { kind: 'member'; term: Term; set: SetExpr }
  /** S ⊆ T */
  | { kind: 'subset'; left: SetExpr; right: SetExpr }
  /** S = T (as sets) */
  | { kind: 'seteq'; left: SetExpr; right: SetExpr }
  /** t = u (as individuals) */
  | { kind: 'eq'; left: Term; right: Term }
  /** R(t, u) — a binary relation, e.g. Likes(x, y) */
  | { kind: 'rel'; name: string; left: Term; right: Term }
  | { kind: 'not'; inner: Formula }
  | { kind: 'and'; left: Formula; right: Formula }
  | { kind: 'or'; left: Formula; right: Formula }
  | { kind: 'implies'; left: Formula; right: Formula }
  | { kind: 'iff'; left: Formula; right: Formula }
  | { kind: 'forall'; varName: string; body: Formula }
  | { kind: 'exists'; varName: string; body: Formula }
  /** ∃! — there is exactly one. */
  | { kind: 'existsUnique'; varName: string; body: Formula }
  | { kind: 'true' }
  | { kind: 'false' };

// ---------------------------------------------------------------------------
// Signature & models
// ---------------------------------------------------------------------------

/** What names exist in a puzzle's little world. */
export interface Signature {
  /** Unary predicates == sets. e.g. ['Dog', 'Red']. */
  sets: string[];
  /** Binary relations. e.g. ['Likes']. */
  relations: string[];
  /** Named individuals. e.g. ['rex']. */
  constants: string[];
}

/**
 * A concrete little universe. `domain` holds element names ('a', 'b', 'c' or,
 * for the UI, blob ids). Sets are membership tables; relations are edge sets.
 */
export interface Model {
  domain: string[];
  /** setName -> the elements in it. */
  sets: Record<string, string[]>;
  /** relationName -> the ordered pairs in it. */
  relations: Record<string, Array<[string, string]>>;
  /** constantName -> the element it names. */
  constants: Record<string, string>;
}

/** Variable bindings during evaluation. */
export type Assignment = Record<string, string>;

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * The verdict of comparing a learner's formula against the reference. When they
 * differ we hand back the *smallest* model that separates them, plus which way
 * round they disagree — enough for the UI to draw the counterexample world and
 * say "in this world, your sentence is true but it shouldn't be".
 */
export type LogicEquivalence =
  | { equal: true }
  | {
      equal: false;
      model: Model;
      /** Truth value of the learner's formula in that model. */
      theirs: boolean;
      /** Truth value of the reference formula in that model. */
      reference: boolean;
    };

// ---------------------------------------------------------------------------
// Tiles (the click-to-build palette)
// ---------------------------------------------------------------------------

/**
 * The learner builds formulas by clicking tiles, never by typing — which makes
 * the input auto-gradable, keeps the symbol set honest, and makes progressive
 * disclosure trivial: a level simply ships a smaller palette.
 */
export type TileKind =
  | 'set'
  | 'relation'
  | 'const'
  | 'var'
  | 'op'
  | 'paren'
  | 'quantifier';

export interface Tile {
  /** Unique within a palette. */
  id: string;
  kind: TileKind;
  /** What is printed on the tile, e.g. '∀' or 'Dog' or '∈'. */
  glyph: string;
  /** Hover text: what it means in English, e.g. 'for all'. */
  gloss: string;
  /** The token this tile emits into the formula being built. */
  token: string;
  /** Ladder rung at which this tile appears in the palette. */
  level: number;
}

export type LogicParseResult =
  | { ok: true; formula: Formula }
  | { ok: false; message: string; at?: number };
