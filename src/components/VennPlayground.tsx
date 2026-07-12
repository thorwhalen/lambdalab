/**
 * A three-circle Venn diagram you can shade by clicking.
 *
 * The trick that makes this exactly gradable: a 3-set Venn has 8 regions, one
 * per subset S ⊆ {A,B,C} (including the outside, S = ∅). Build a model whose
 * domain is those 8 regions, where the region-element for S belongs to exactly
 * the sets in S. Then `evalSet(expr, model)` returns precisely the regions the
 * expression denotes — an 8-bit signature.
 *
 * Two set expressions over {A,B,C} denote the same regions **iff they are equal
 * in the free Boolean algebra on three generators** — that is, iff they are
 * genuinely equal as sets, for every possible A, B, C. So unlike the formula
 * game (which relies on the small-scope hypothesis) the grading here is not a
 * heuristic at all. It is exact, and it is exact for a reason worth telling a
 * child: *the picture really does contain all the information.*
 *
 * Hit-testing is done in maths, not in SVG: a click is inside circle X iff it is
 * within r of X's centre, so the region is read straight off the three distances.
 */
import { useCallback, useMemo } from 'react';
import type { Model, SetExpr } from '../lib/logic/types';
import { evalSet } from '../lib/logic/evaluate';

const SETS = ['A', 'B', 'C'] as const;
export type VennSet = (typeof SETS)[number];

const W = 340;
const H = 300;
const R = 82;
const D = 48; // how far each circle's centre sits from the middle

const CENTRES: Record<VennSet, { x: number; y: number }> = {
  A: { x: W / 2, y: H / 2 - D },
  B: { x: W / 2 - D * 0.87, y: H / 2 + D * 0.5 },
  C: { x: W / 2 + D * 0.87, y: H / 2 + D * 0.5 },
};

const COLOR: Record<VennSet, string> = {
  A: 'var(--color-lam-500)',
  B: 'var(--color-mach-500)',
  C: 'var(--color-info-500)',
};

/** A region is the subset of {A,B,C} you are inside. Encoded as a 3-bit mask. */
export type RegionMask = number; // bit 0 = A, 1 = B, 2 = C
/** A shading is the set of shaded regions: an 8-bit mask over RegionMask values. */
export type Shading = number;

const BIT: Record<VennSet, number> = { A: 1, B: 2, C: 4 };

export const ALL_REGIONS: RegionMask[] = [0, 1, 2, 3, 4, 5, 6, 7];

/** The element name we give the region-blob for mask m. Stable and readable. */
const regionElement = (m: RegionMask): string =>
  SETS.filter((s) => m & BIT[s]).join('') || 'out';

/**
 * The model whose domain is the eight regions. This is the whole idea: an
 * abstract 3-set Venn diagram, made concrete enough to compute with.
 */
export const VENN_MODEL: Model = {
  domain: ALL_REGIONS.map(regionElement),
  sets: {
    A: ALL_REGIONS.filter((m) => m & BIT.A).map(regionElement),
    B: ALL_REGIONS.filter((m) => m & BIT.B).map(regionElement),
    C: ALL_REGIONS.filter((m) => m & BIT.C).map(regionElement),
  },
  relations: {},
  constants: {},
};

/** The regions a set expression denotes, as an 8-bit shading. Exact. */
export function shadingOf(expr: SetExpr): Shading {
  const members = evalSet(expr, VENN_MODEL);
  let out = 0;
  for (const m of ALL_REGIONS) {
    if (members.has(regionElement(m))) out |= 1 << m;
  }
  return out;
}

/** Two expressions denote the same set — for *every* A, B, C — iff this holds. */
export const sameRegions = (a: SetExpr, b: SetExpr): boolean => shadingOf(a) === shadingOf(b);

// --- rendering --------------------------------------------------------------

function regionAt(x: number, y: number): RegionMask {
  let m = 0;
  for (const s of SETS) {
    const c = CENTRES[s];
    if (Math.hypot(x - c.x, y - c.y) <= R) m |= BIT[s];
  }
  return m;
}

export function VennPlayground({
  shading,
  onToggleRegion,
  /** A second shading drawn as an outline — the target, when we are marking. */
  target,
  labels = { A: 'A', B: 'B', C: 'C' },
  className = '',
}: {
  shading: Shading;
  onToggleRegion?: (m: RegionMask) => void;
  target?: Shading;
  labels?: Record<VennSet, string>;
  className?: string;
}) {
  const interactive = !!onToggleRegion;

  const onClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!onToggleRegion) return;
      const rect = e.currentTarget.getBoundingClientRect();
      // The SVG is scaled to its box; map the click back into viewBox units.
      const x = ((e.clientX - rect.left) / rect.width) * W;
      const y = ((e.clientY - rect.top) / rect.height) * H;
      onToggleRegion(regionAt(x, y));
    },
    [onToggleRegion],
  );

  const masks = useMemo(
    () =>
      ALL_REGIONS.map((m) => {
        const inside = SETS.filter((s) => m & BIT[s]);
        const outside = SETS.filter((s) => !(m & BIT[s]));
        return { m, inside, outside };
      }),
    [],
  );

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={`w-full rounded-xl border border-ink-700 bg-ink-950 ${interactive ? 'cursor-pointer' : ''} ${className}`}
      onClick={onClick}
    >
      <defs>
        {/* One mask per region: white everywhere, black over the circles you must
            be OUTSIDE of. Combined with nested clips for the circles you must be
            INSIDE of, this carves out exactly one region. */}
        {masks.map(({ m, outside }) => (
          <mask key={`mask-${m}`} id={`vmask-${m}`}>
            <rect width={W} height={H} fill="white" />
            {outside.map((s) => (
              <circle key={s} cx={CENTRES[s].x} cy={CENTRES[s].y} r={R} fill="black" />
            ))}
          </mask>
        ))}
        {SETS.map((s) => (
          <clipPath key={`clip-${s}`} id={`vclip-${s}`}>
            <circle cx={CENTRES[s].x} cy={CENTRES[s].y} r={R} />
          </clipPath>
        ))}
      </defs>

      {/* Shaded regions. */}
      {masks.map(({ m, inside }) => {
        const isShaded = (shading >> m) & 1;
        const isTarget = target !== undefined && ((target >> m) & 1) === 1;
        if (!isShaded && !isTarget) return null;

        // Nest a clip per circle we must be inside; the mask removes the rest.
        let node = (
          <rect
            width={W}
            height={H}
            fill={isShaded ? 'var(--color-lam-500)' : 'transparent'}
            fillOpacity={isShaded ? 0.42 : 0}
            stroke={isTarget && !isShaded ? 'var(--color-good)' : 'none'}
            strokeWidth={0}
          />
        );
        for (const s of inside) {
          node = <g clipPath={`url(#vclip-${s})`}>{node}</g>;
        }
        return (
          <g key={`region-${m}`} mask={`url(#vmask-${m})`}>
            {node}
          </g>
        );
      })}

      {/* Circle outlines on top. */}
      {SETS.map((s) => (
        <circle
          key={s}
          cx={CENTRES[s].x}
          cy={CENTRES[s].y}
          r={R}
          fill="none"
          stroke={COLOR[s]}
          strokeWidth={2}
        />
      ))}

      {/* Set names, pushed out from the middle so they never sit in an overlap. */}
      <text x={CENTRES.A.x} y={CENTRES.A.y - R - 8} textAnchor="middle" className="math" fontSize={17} fill={COLOR.A}>
        {labels.A}
      </text>
      <text x={CENTRES.B.x - R + 4} y={CENTRES.B.y + R + 18} textAnchor="middle" className="math" fontSize={17} fill={COLOR.B}>
        {labels.B}
      </text>
      <text x={CENTRES.C.x + R - 4} y={CENTRES.C.y + R + 18} textAnchor="middle" className="math" fontSize={17} fill={COLOR.C}>
        {labels.C}
      </text>

      {/* The universe box — so the outside region is visibly *part of* the picture. */}
      <rect
        x={4}
        y={4}
        width={W - 8}
        height={H - 8}
        fill="none"
        stroke="var(--color-ink-700)"
        strokeWidth={1.5}
        rx={8}
      />
      <text x={14} y={20} className="math" fontSize={13} fill="var(--color-ink-600)">
        𝕌
      </text>
    </svg>
  );
}
