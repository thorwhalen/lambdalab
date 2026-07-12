/**
 * A model, drawn.
 *
 * This is the payoff of the whole logic engine. When a learner's formula is
 * wrong, we do not say "wrong" — we hand them a universe. Three blobs. This one
 * is a dog and is red; that one is a dog and is not. *Your* sentence is true
 * here. The sentence you were asked for is false here. Look at it.
 *
 * A counterexample you can see beats a correction you are told, every time.
 *
 * Rendering: blobs on a circle (so relation arrows between any two are always
 * drawable without crossing the blobs), set membership as coloured rings stacked
 * outward from each blob, relations as arrows.
 */
import type { Model } from '../lib/logic/types';

const R = 26;
const RING_GAP = 5;
const PAD = 62;

/** Set colours, in a fixed order so a set keeps its colour across worlds. */
const SET_COLORS = [
  'var(--color-lam-500)',
  'var(--color-mach-500)',
  'var(--color-info-500)',
  'var(--color-crypt-500)',
];

interface Pt {
  x: number;
  y: number;
}

/** Blobs on a circle. One blob sits centred; two sit side by side; 3+ ring. */
function layout(n: number, w: number, h: number): Pt[] {
  const cx = w / 2;
  const cy = h / 2;
  if (n === 1) return [{ x: cx, y: cy }];
  if (n === 2)
    return [
      { x: cx - w / 5, y: cy },
      { x: cx + w / 5, y: cy },
    ];
  const rad = Math.min(w, h) / 2 - PAD;
  return Array.from({ length: n }, (_, i) => {
    // Start at the top and go clockwise — reads like a clock, which is familiar.
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad };
  });
}

export function LittleWorld({
  model,
  /** Sets to draw. Defaults to every set in the model. */
  sets,
  width = 420,
  height = 260,
  /** Pretty names, e.g. { Dog: 'dog' }. Falls back to the set name. */
  labels = {},
  className = '',
}: {
  model: Model;
  sets?: string[];
  width?: number;
  height?: number;
  labels?: Record<string, string>;
  className?: string;
}) {
  const setNames = sets ?? Object.keys(model.sets).sort();
  const relNames = Object.keys(model.relations).sort();
  const pts = layout(model.domain.length, width, height);

  const colorOf = (s: string) => SET_COLORS[setNames.indexOf(s) % SET_COLORS.length];
  const constAt = (el: string) =>
    Object.entries(model.constants)
      .filter(([, v]) => v === el)
      .map(([k]) => k);

  return (
    <figure className={className}>
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        className="rounded-xl border border-ink-700 bg-ink-950"
      >
        {/* Relation arrows, under the blobs. */}
        {relNames.flatMap((rel) =>
          model.relations[rel].map(([from, to], i) => {
            const p = pts[model.domain.indexOf(from)];
            const q = pts[model.domain.indexOf(to)];
            if (!p || !q) return null;

            if (from === to) {
              // Self-relation: a little loop under the blob.
              return (
                <path
                  key={`${rel}-${i}`}
                  d={`M ${p.x - 9} ${p.y + R + 2} C ${p.x - 24} ${p.y + R + 26}, ${p.x + 24} ${p.y + R + 26}, ${p.x + 9} ${p.y + R + 2}`}
                  fill="none"
                  stroke="var(--color-ink-400)"
                  strokeWidth={1.6}
                  markerEnd="url(#lw-arrow)"
                />
              );
            }
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const len = Math.hypot(dx, dy) || 1;
            const off = R + 8;
            return (
              <line
                key={`${rel}-${i}`}
                x1={p.x + (dx / len) * off}
                y1={p.y + (dy / len) * off}
                x2={q.x - (dx / len) * off}
                y2={q.y - (dy / len) * off}
                stroke="var(--color-ink-400)"
                strokeWidth={1.6}
                markerEnd="url(#lw-arrow)"
              />
            );
          }),
        )}

        <defs>
          <marker id="lw-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="var(--color-ink-400)" />
          </marker>
        </defs>

        {/* Blobs, with one ring per set they belong to. */}
        {model.domain.map((el, i) => {
          const p = pts[i];
          const inSets = setNames.filter((s) => model.sets[s]?.includes(el));
          const names = constAt(el);
          return (
            <g key={el}>
              {inSets.map((s, k) => (
                <circle
                  key={s}
                  cx={p.x}
                  cy={p.y}
                  r={R + (k + 1) * RING_GAP}
                  fill="none"
                  stroke={colorOf(s)}
                  strokeWidth={3}
                  opacity={0.85}
                />
              ))}
              <circle cx={p.x} cy={p.y} r={R} fill="var(--color-ink-800)" stroke="var(--color-ink-600)" />
              <text
                x={p.x}
                y={p.y + 5}
                textAnchor="middle"
                fontSize={15}
                className="font-mono"
                fill="var(--color-ink-100)"
              >
                {el}
              </text>
              {names.length > 0 && (
                <text
                  x={p.x}
                  y={p.y + R + (inSets.length + 1) * RING_GAP + 13}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--color-ink-400)"
                  className="font-mono"
                >
                  {names.join(', ')}
                </text>
              )}
            </g>
          );
        })}

        {model.domain.length === 0 && (
          <text x="50%" y="50%" textAnchor="middle" fontSize={13} fill="var(--color-ink-600)">
            an empty world
          </text>
        )}
      </svg>

      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-400">
        {setNames.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span
              className="inline-block size-2.5 rounded-full ring-2"
              style={{ background: 'transparent', color: colorOf(s), boxShadow: `0 0 0 2px ${colorOf(s)}` }}
            />
            {labels[s] ?? s}
            <span className="font-mono text-ink-600">
              {model.sets[s]?.length ? `{${model.sets[s].join(', ')}}` : '{ }'}
            </span>
          </span>
        ))}
        {relNames.map((r) => (
          <span key={r} className="flex items-center gap-1.5">
            <span className="text-ink-500">→</span>
            {labels[r] ?? r}
            <span className="font-mono text-ink-600">
              {model.relations[r]?.length
                ? model.relations[r].map(([a, b]) => `${a}→${b}`).join(', ')
                : 'none'}
            </span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
