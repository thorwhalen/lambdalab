/**
 * Build a formula by clicking tiles.
 *
 * Why tiles and not a text box? Three reasons, and they all matter:
 *
 *  1. **The palette IS the progressive disclosure.** Level 1 ships five tiles.
 *     There is no ∀ on screen, so there is no ∀ to be frightened of. A text box
 *     would have to *explain* what you may not type; a palette simply doesn't
 *     offer it.
 *  2. **No typos, ever.** A child who cannot find ∈ on a keyboard is not learning
 *     anything about sets by hunting for it. Every wrong answer here is a wrong
 *     *thought*, which is the only kind worth having feedback on.
 *  3. **Every tile carries its own gloss.** Hover ∀ and it says "for all". The
 *     notation stays connected to the words it stands for, which is exactly the
 *     link the lesson is trying to build.
 */
import { useMemo, useState } from 'react';
import type { Tile } from '../lib/logic/types';

const KIND_ORDER: Array<{ kind: Tile['kind']; label: string }> = [
  { kind: 'quantifier', label: 'Quantifiers' },
  { kind: 'set', label: 'Sets' },
  { kind: 'relation', label: 'Relations' },
  { kind: 'var', label: 'Things' },
  { kind: 'const', label: 'Names' },
  { kind: 'op', label: 'Operators' },
  { kind: 'paren', label: 'Brackets' },
];

export function TilePalette({
  tiles,
  level,
  onPick,
  /** Tiles that arrived at exactly this level get a little arrival animation. */
  freshLevel,
}: {
  tiles: Tile[];
  level: number;
  onPick: (tile: Tile) => void;
  freshLevel?: number;
}) {
  const available = useMemo(() => tiles.filter((t) => t.level <= level), [tiles, level]);

  return (
    <div className="flex flex-col gap-3">
      {KIND_ORDER.map(({ kind, label }) => {
        const group = available.filter((t) => t.kind === kind);
        if (group.length === 0) return null;
        return (
          <div key={kind}>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-600">
              {label}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.map((t) => (
                <button
                  key={t.id}
                  className="tile"
                  title={t.gloss}
                  data-fresh={t.level === freshLevel ? 'true' : undefined}
                  onClick={() => onPick(t)}
                >
                  {t.glyph}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The formula under construction. Click a token to delete it and everything after. */
export function FormulaStrip({
  tokens,
  onTruncate,
  placeholder = 'Click tiles below to build your sentence…',
}: {
  tokens: string[];
  onTruncate: (n: number) => void;
  placeholder?: string;
}) {
  return (
    <div
      className="flex min-h-[4.5rem] flex-wrap items-center gap-1 rounded-xl border border-ink-600
        bg-ink-950 px-3 py-3"
    >
      {tokens.length === 0 ? (
        <span className="text-sm italic text-ink-600">{placeholder}</span>
      ) : (
        tokens.map((tok, i) => (
          <button
            key={`${tok}-${i}`}
            onClick={() => onTruncate(i)}
            title="Delete this and everything after it"
            className="math rounded px-1.5 py-0.5 text-xl text-ink-100 transition
              hover:bg-[var(--color-bad)]/20 hover:text-[var(--color-bad)]"
          >
            {tok}
          </button>
        ))
      )}
    </div>
  );
}

/** Holds the token list. Lessons drive grading; this only owns the editing. */
export function useFormulaTokens() {
  const [tokens, setTokens] = useState<string[]>([]);
  return {
    tokens,
    push: (t: string) => setTokens((prev) => [...prev, t]),
    backspace: () => setTokens((prev) => prev.slice(0, -1)),
    truncate: (n: number) => setTokens((prev) => prev.slice(0, n)),
    clear: () => setTokens([]),
    set: setTokens,
  };
}
