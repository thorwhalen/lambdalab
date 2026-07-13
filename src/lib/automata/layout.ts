/**
 * Making a *derived* machine fit to look at.
 *
 * The algorithms in this engine are written for the mathematics, and they are
 * right to be: `toDFA` names a state after the set of NFA states it stands for
 * ("{q0,q2}") because that name is the whole idea of the subset construction, and
 * `minimize` joins merged names with "|" for the same reason. But a machine built
 * by composing them — determinise, then minimise, then eliminate — ends up with
 * states called `{q0,q12,q14,q16,q17,q18,q19,q2,q3,q4,q5,q7,q8}|{q1,q6}`, and no
 * layout at all, because nobody dragged them anywhere.
 *
 * Drawn as-is, that is a single illegible heap. So:
 *
 *   - `autoLayout` gives every state a position, by BFS layers from the start —
 *     which happens to be the right picture anyway, since a finite automaton is
 *     read left to right.
 *   - `relabel` renames states to q0, q1, … for display, in BFS order, so the
 *     names are short AND the numbering follows the reading order.
 *
 * Neither touches the language. They are presentation, and they live apart from
 * the maths on purpose.
 */
import type { Automaton, StateId } from './types';
import { EPSILON } from './types';

const MARGIN_X = 70;
const MARGIN_Y = 60;
const LAYER_W = 120;
const ROW_H = 90;

/** States in breadth-first order from the start, then any unreachable ones. */
function bfsOrder(a: Automaton): StateId[] {
  const seen = new Set<StateId>();
  const order: StateId[] = [];
  const queue: StateId[] = a.start && a.states.includes(a.start) ? [a.start] : [];
  if (queue.length) seen.add(a.start);

  while (queue.length) {
    const s = queue.shift()!;
    order.push(s);
    // Sort the successors so the layout is stable across runs — the UI diffs on
    // these positions, and a machine that reshuffles itself on every render is
    // unusable.
    const next = a.transitions
      .filter((t) => t.from === s)
      .map((t) => t.to)
      .sort();
    for (const t of next) {
      if (!seen.has(t)) {
        seen.add(t);
        queue.push(t);
      }
    }
  }

  for (const s of [...a.states].sort()) {
    if (!seen.has(s)) order.push(s);
  }
  return order;
}

/** BFS depth of each state; unreachable states get the deepest layer + 1. */
function layers(a: Automaton): Map<StateId, number> {
  const depth = new Map<StateId, number>();
  if (a.start && a.states.includes(a.start)) {
    depth.set(a.start, 0);
    const queue: StateId[] = [a.start];
    while (queue.length) {
      const s = queue.shift()!;
      const d = depth.get(s)!;
      for (const t of a.transitions.filter((t) => t.from === s)) {
        if (!depth.has(t.to)) {
          depth.set(t.to, d + 1);
          queue.push(t.to);
        }
      }
    }
  }
  const maxDepth = Math.max(-1, ...depth.values());
  for (const s of a.states) {
    if (!depth.has(s)) depth.set(s, maxDepth + 1);
  }
  return depth;
}

/**
 * Fill in a position for every state that hasn't got one.
 *
 * Existing positions are KEPT — a learner who has dragged their machine into a
 * shape they like must not have it rearranged under them just because they added
 * one more state.
 */
export function autoLayout(a: Automaton, width = 640): Automaton {
  const depth = layers(a);
  const byLayer = new Map<number, StateId[]>();
  for (const s of bfsOrder(a)) {
    const d = depth.get(s) ?? 0;
    byLayer.set(d, [...(byLayer.get(d) ?? []), s]);
  }

  const layerCount = Math.max(1, byLayer.size);
  // Squeeze the columns if the machine is wider than the canvas.
  const dx = Math.min(LAYER_W, Math.max(80, (width - 2 * MARGIN_X) / Math.max(1, layerCount - 1)));

  const layout: Record<string, { x: number; y: number }> = { ...a.layout };
  for (const [d, states] of byLayer) {
    states.forEach((s, i) => {
      if (layout[s]) return; // never move a state the learner placed
      layout[s] = {
        x: MARGIN_X + d * dx,
        y: MARGIN_Y + i * ROW_H,
      };
    });
  }
  return { ...a, layout };
}

/**
 * Rename states to q0, q1, … in BFS order, for display.
 *
 * Returns the renamed machine and the mapping back, so a caller can still say
 * "q3 here is {q0,q2} of the machine you started with" if it wants to.
 */
export function relabel(a: Automaton, prefix = 'q'): { automaton: Automaton; names: Record<string, StateId> } {
  const order = bfsOrder(a);
  const rename = new Map<StateId, StateId>();
  order.forEach((s, i) => rename.set(s, `${prefix}${i}`));
  const at = (s: StateId) => rename.get(s) ?? s;

  const names: Record<string, StateId> = {};
  for (const [orig, fresh] of rename) names[fresh] = orig;

  const layout: Record<string, { x: number; y: number }> = {};
  for (const [orig, fresh] of rename) {
    if (a.layout?.[orig]) layout[fresh] = a.layout[orig];
  }

  return {
    automaton: {
      states: order.map(at),
      alphabet: a.alphabet,
      transitions: a.transitions.map((t) => ({
        from: at(t.from),
        on: t.on,
        to: at(t.to),
      })),
      start: at(a.start),
      accepting: a.accepting.map(at),
      layout: Object.keys(layout).length ? layout : undefined,
    },
    names,
  };
}

/** Relabel then lay out — what every "here is a machine we computed for you" view wants. */
export function forDisplay(a: Automaton, width = 640): Automaton {
  return autoLayout(relabel(a).automaton, width);
}

/** True when a machine has any ε-move — used to caption the Thompson picture. */
export const hasEpsilon = (a: Automaton): boolean => a.transitions.some((t) => t.on === EPSILON);
