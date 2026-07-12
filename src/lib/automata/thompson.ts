/**
 * Thompson's construction — a regex becomes an ε-NFA, one gadget at a time.
 *
 * This is the constructive half of Kleene's theorem, and it is the moment the
 * lesson has been building to: *every* regex is a machine. So the code is
 * written to be watched, not just run — `regexToNFASteps` hands the UI the same
 * fragments, in the same order, that a person would draw on a whiteboard.
 *
 * THE FRAGMENT INVARIANT (everything here rests on it)
 * ---------------------------------------------------
 * Every fragment we build has:
 *
 *   1. exactly ONE start state and exactly ONE accepting state, which are
 *      distinct; and
 *   2. NO transition leaving the accepting state, and no transition entering
 *      the start state — *within the fragment*.
 *
 * Consequence: a fragment's only interface to the outside world is that pair of
 * states, so a bigger gadget can wire fragments together by their ends without
 * ever reasoning about their insides. That is why the composition rules below
 * are four lines each instead of a case analysis, and why they are obviously
 * correct. Each gadget preserves the invariant for the fragment it returns —
 * note that e.g. `concat` gives `accept_r` an outgoing ε-edge, but `accept_r` is
 * *not* the accepting state of the composed fragment, so the invariant holds.
 *
 * WHAT WE DO NOT DO
 * -----------------
 * We do not simplify the regex first. The learner wrote `a**`; the animation
 * must show the machine for `a**`, warts and all — the redundancy is often the
 * teachable moment. Callers who want the tidy machine can `simplifyRegex` first.
 *
 * DETERMINISM
 * -----------
 * State ids come from one counter threaded through the recursion, and children
 * are always built before their parent's fresh states, so the same AST always
 * yields byte-identical output (state names, ordering, geometry). The UI diffs
 * on state names between animation frames, so this is a correctness property,
 * not a nicety: every array we emit is explicitly sorted.
 */

import {
  EPSILON,
  type Automaton,
  type RegexNode,
  type StateId,
  type StateLayout,
  type Transition,
} from './types';
import { regexAlphabet, renderRegex } from './regexParse';

/** One frame of the animation: the fragment for `node`, and why it looks like that. */
export interface ThompsonStep {
  node: RegexNode;
  /** The sub-regex this fragment matches, rendered — the caption for the frame. */
  label: string;
  fragment: Automaton;
  explain: string;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const STATE_PREFIX = 'q';

/**
 * The construction's only mutable state. A counter, not a `Set` of used names:
 * ids must be *sequential* so that "q7" tells a reader when the state was born.
 */
interface Counter {
  next: number;
}

const freshState = (c: Counter): StateId => `${STATE_PREFIX}${c.next++}`;

/**
 * All ids in a machine we built are `q<n>`, so their numeric suffix is a total
 * order — and the one we want. Sorting the ids as *strings* would interleave
 * q10 between q1 and q2, which no child reading the picture would forgive.
 */
const stateIndex = (s: StateId): number => Number(s.slice(STATE_PREFIX.length));

const byStateIndex = (x: StateId, y: StateId): number => stateIndex(x) - stateIndex(y);

/** Raw code-unit order. Never `localeCompare`: its collation is host-dependent. */
const byCodeUnit = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

const byTransition = (x: Transition, y: Transition): number =>
  stateIndex(x.from) - stateIndex(y.from) ||
  byCodeUnit(x.on, y.on) ||
  stateIndex(x.to) - stateIndex(y.to);

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/*
 * A deliberately dumb layout: we place states on an integer grid during the
 * construction (where the tree structure is still in hand — a generic graph
 * layout pass would have to *rediscover* it) and scale to pixels at the end.
 *
 * Columns grow left-to-right with construction order; rows fan out for the two
 * branches of a union. The one property the tests actually pin down is that no
 * two states share a cell, which holds because every gadget places its children
 * in pairwise-disjoint regions and its own fresh states outside all of them.
 */

/** Rows of clearance between the two branches of a union, and the centre line. */
const BRANCH_GAP = 1;

/**
 * Rows to drop a repeated fragment below the centre line, leaving that line free
 * for the loop-back and bypass arcs to be drawn without crossing the machine.
 */
const REPEAT_DROP = 1;

const X_STEP = 90;
const Y_STEP = 70;
const MARGIN = 60;

interface Cell {
  col: number;
  row: number;
}

// ---------------------------------------------------------------------------
// The build tree
// ---------------------------------------------------------------------------

/**
 * A fragment under construction. It holds only what *this* gadget contributed;
 * the full state/transition set of a fragment is the union over its subtree
 * (see `postOrder`). Keeping the pieces separate rather than accumulating copies
 * is what lets a step's fragment and the final machine share state names by
 * construction instead of by careful bookkeeping.
 */
interface Built {
  node: RegexNode;
  start: StateId;
  accept: StateId;
  /** States this gadget introduced, in allocation order. */
  own: StateId[];
  /** Transitions this gadget introduced (may touch a child's start/accept). */
  wires: Transition[];
  children: Built[];
  /** Grid extent: columns spanned, rows above and below this fragment's centre line. */
  width: number;
  up: number;
  down: number;
}

/** Every cell of a fragment sits in `[col, col + width)`. Leaves need exactly two. */
const LEAF_WIDTH = 2;

const leaf = (node: RegexNode, start: StateId, accept: StateId, wires: Transition[]): Built => ({
  node,
  start,
  accept,
  own: [start, accept],
  wires,
  children: [],
  width: LEAF_WIDTH,
  up: 0,
  down: 0,
});

/**
 * Build the fragment for `node`, allocating fresh ids from `c`.
 *
 * Children are built *first*, so ids increase with post-order position and a
 * sub-fragment keeps the very same names in every later step. Preserves the
 * fragment invariant (see the module docstring).
 */
function build(node: RegexNode, c: Counter): Built {
  switch (node.kind) {
    // ∅: a start, a finish, and no way across. The one fragment with no wires.
    case 'empty':
      return leaf(node, freshState(c), freshState(c), []);

    case 'epsilon': {
      const start = freshState(c);
      const accept = freshState(c);
      return leaf(node, start, accept, [{ from: start, on: EPSILON, to: accept }]);
    }

    case 'literal': {
      const start = freshState(c);
      const accept = freshState(c);
      return leaf(node, start, accept, [{ from: start, on: node.sym, to: accept }]);
    }

    // No fresh states: the seam is a single ε-edge between the two ends we have.
    case 'concat': {
      const l = build(node.left, c);
      const r = build(node.right, c);
      return {
        node,
        start: l.start,
        accept: r.accept,
        own: [],
        wires: [{ from: l.accept, on: EPSILON, to: r.start }],
        children: [l, r],
        width: l.width + r.width,
        up: Math.max(l.up, r.up),
        down: Math.max(l.down, r.down),
      };
    }

    case 'union': {
      const l = build(node.left, c);
      const r = build(node.right, c);
      const start = freshState(c);
      const accept = freshState(c);
      return {
        node,
        start,
        accept,
        own: [start, accept],
        wires: [
          { from: start, on: EPSILON, to: l.start },
          { from: start, on: EPSILON, to: r.start },
          { from: l.accept, on: EPSILON, to: accept },
          { from: r.accept, on: EPSILON, to: accept },
        ],
        children: [l, r],
        // Two fresh columns (the new start and the new finish) flank the branches,
        // which are stacked, so the union is only as wide as its widest branch.
        width: Math.max(l.width, r.width) + 2,
        up: l.up + l.down + BRANCH_GAP,
        down: r.up + r.down + BRANCH_GAP,
      };
    }

    /*
     * The three repetition gadgets differ in exactly two ε-edges, so they are one
     * gadget with two switches — spelling them out separately would invite the
     * three to drift apart:
     *
     *   loop   (accept_r → start_r)  : "go round again"     — star, plus
     *   bypass (start    → accept)   : "skip it altogether" — star, optional
     *
     * Hence r* = loop + bypass, r+ = loop only (≥ 1 pass), r? = bypass only.
     */
    case 'star':
    case 'plus':
    case 'optional': {
      const inner = build(node.inner, c);
      const start = freshState(c);
      const accept = freshState(c);

      const wires: Transition[] = [
        { from: start, on: EPSILON, to: inner.start },
        { from: inner.accept, on: EPSILON, to: accept },
      ];
      if (node.kind !== 'optional') wires.push({ from: inner.accept, on: EPSILON, to: inner.start });
      if (node.kind !== 'plus') wires.push({ from: start, on: EPSILON, to: accept });

      return {
        node,
        start,
        accept,
        own: [start, accept],
        wires,
        children: [inner],
        width: inner.width + 2,
        up: Math.max(0, inner.up - REPEAT_DROP),
        down: REPEAT_DROP + inner.down,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/**
 * Assign a grid cell to every state of `b`, with `b`'s start at (col, row).
 *
 * Postcondition: distinct states get distinct cells, and every cell lies in the
 * column range [col, col + b.width) — which is what makes the disjointness
 * argument in the geometry note above go through.
 */
function place(b: Built, col: number, row: number, cells: Map<StateId, Cell>): void {
  const lastCol = col + b.width - 1;

  switch (b.node.kind) {
    case 'concat': {
      const [l, r] = b.children;
      place(l, col, row, cells);
      place(r, col + l.width, row, cells); // column ranges abut, never overlap
      return;
    }

    case 'union': {
      const [l, r] = b.children;
      cells.set(b.start, { col, row });
      cells.set(b.accept, { col: lastCol, row });
      // Branches are pushed clear of the centre line in opposite directions, so
      // they cannot collide with each other or with the two fresh states.
      place(l, col + 1, row - (l.down + BRANCH_GAP), cells);
      place(r, col + 1, row + (r.up + BRANCH_GAP), cells);
      return;
    }

    case 'star':
    case 'plus':
    case 'optional': {
      const [inner] = b.children;
      cells.set(b.start, { col, row });
      cells.set(b.accept, { col: lastCol, row });
      place(inner, col + 1, row + REPEAT_DROP, cells);
      return;
    }

    default: {
      // Leaf: start and finish, side by side.
      cells.set(b.start, { col, row });
      cells.set(b.accept, { col: lastCol, row });
    }
  }
}

/**
 * Grid → pixels, shifted so the whole machine sits in the positive quadrant.
 *
 * Keys are inserted in state order so that two runs serialise identically — a
 * `Record` remembers its insertion order, and the UI compares snapshots.
 */
function toLayout(cells: Map<StateId, Cell>): Record<StateId, StateLayout> {
  const all = [...cells.values()];
  const minCol = Math.min(...all.map((p) => p.col));
  const minRow = Math.min(...all.map((p) => p.row));

  const layout: Record<StateId, StateLayout> = {};
  for (const s of [...cells.keys()].sort(byStateIndex)) {
    const { col, row } = cells.get(s) as Cell;
    layout[s] = { x: MARGIN + (col - minCol) * X_STEP, y: MARGIN + (row - minRow) * Y_STEP };
  }
  return layout;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Leaves first, then their parent — the order the whiteboard drawing happens in. */
const postOrder = (b: Built): Built[] => [...b.children.flatMap(postOrder), b];

/**
 * The fragment rooted at `b`, as a standalone `Automaton`. `layout` is the whole
 * machine's geometry; we keep only the entries for this fragment's states, so a
 * step's states never move when later steps are drawn around them.
 */
function automatonOf(b: Built, layout: Record<StateId, StateLayout>): Automaton {
  const parts = postOrder(b);

  const states = parts.flatMap((p) => p.own).sort(byStateIndex);
  const transitions = parts.flatMap((p) => p.wires).sort(byTransition);

  const own: Record<StateId, StateLayout> = {};
  for (const s of states) own[s] = layout[s];

  return {
    states,
    // Σ is what the regex can *read*: ε and ∅ are not symbols, so ∅ and ε both
    // yield the empty alphabet. That is correct, not a degenerate case to patch.
    alphabet: regexAlphabet(b.node),
    transitions,
    start: b.start,
    accepting: [b.accept],
    layout: own,
  };
}

/** Plain English, for a reader who has never heard the word "epsilon". */
function explainOf(b: Built): string {
  const n = b.node;
  switch (n.kind) {
    case 'empty':
      return (
        '∅ is the language with no words in it at all. So the machine gets a start and a finish ' +
        'and no way to get from one to the other: nothing ever reaches the finish.'
      );
    case 'epsilon':
      return (
        'ε is the empty word — no letters at all. So the start can jump straight to the finish ' +
        'for free, without reading anything.'
      );
    case 'literal':
      return (
        `To match "${n.sym}", read a single ${n.sym} and move from the start to the finish. ` +
        'Any other letter gets stuck.'
      );
    case 'concat':
      return (
        `To match ${renderRegex(n.left)} and then ${renderRegex(n.right)}, glue the two machines ` +
        `end to end: when the ${renderRegex(n.left)} machine reaches its finish, it jumps for free ` +
        `into the start of the ${renderRegex(n.right)} machine.`
      );
    case 'union':
      return (
        `To match ${renderRegex(n.left)} or ${renderRegex(n.right)}, make a new start that can jump ` +
        'for free into either machine, and let both finishes jump for free to a new finish.'
      );
    // Render the *whole* node, never `renderRegex(inner) + '*'`: the inner regex
    // may need brackets, and "a|b*" is a different language from "(a|b)*".
    case 'star':
      return (
        `To match ${renderRegex(n.inner)} any number of times — including zero times — add a new ` +
        `start and a new finish. Jump for free into the ${renderRegex(n.inner)} machine; jump for ` +
        'free from its finish back to its start to go round again; and add a free shortcut from ' +
        'the new start straight to the new finish, for the zero-times case.'
      );
    case 'plus':
      return (
        `To match ${renderRegex(n.inner)} one or more times, do what ${renderRegex({ kind: 'star', inner: n.inner })} ` +
        'does but leave out the shortcut from the new start to the new finish. Now the only way ' +
        `through is to go round the ${renderRegex(n.inner)} machine at least once.`
      );
    case 'optional':
      return (
        `To match ${renderRegex(n.inner)} or nothing at all, add a new start and a new finish, and ` +
        'a free shortcut from the new start straight to the new finish — so the ' +
        `${renderRegex(n.inner)} machine can simply be skipped.`
      );
  }
}

/** Build once; both public functions are views of the same construction. */
function construct(node: RegexNode): { root: Built; layout: Record<StateId, StateLayout> } {
  const root = build(node, { next: 0 });
  const cells = new Map<StateId, Cell>();
  place(root, 0, 0, cells);
  return { root, layout: toLayout(cells) };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The ε-NFA for `node`, by Thompson's construction: one start state, exactly one
 * accepting state, and no transition out of it.
 *
 * The regex is used as written — nothing is simplified — and every state carries
 * a `layout` position, so the editor can render the machine with no layout pass.
 * Same AST in, same machine out, always.
 */
export function regexToNFA(node: RegexNode): Automaton {
  const { root, layout } = construct(node);
  return automatonOf(root, layout);
}

/**
 * Every sub-fragment of the construction, in post-order — leaves first, the
 * whole machine last — which is the order they are built and so the order the
 * animation should reveal them.
 *
 * There is exactly one step per AST node (`steps.length === regexSize(node)`),
 * the final step's `fragment` equals `regexToNFA(node)`, and every earlier
 * fragment is a literal sub-machine of it: same state names, same coordinates,
 * so frames can simply be layered.
 */
export function regexToNFASteps(node: RegexNode): ThompsonStep[] {
  const { root, layout } = construct(node);
  return postOrder(root).map((b) => ({
    node: b.node,
    label: renderRegex(b.node),
    fragment: automatonOf(b, layout),
    explain: explainOf(b),
  }));
}
