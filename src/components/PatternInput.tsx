/**
 * A pattern box with a symbol palette, built for a thumb.
 *
 * Tapping a palette symbol inserts it AT THE CURSOR (not at the end), so a
 * learner on a tablet can tap `[ ]` and then fill it: paired symbols put the
 * caret between the brackets, or wrap a selection in them. ⌫ deletes before the
 * cursor, or the selection.
 * The tapped symbol's meaning is shown under the palette, because a tooltip
 * never appears under a finger.
 *
 * The caret is restored without calling `focus()`, so a tap on the palette does
 * not pop up the on-screen keyboard.
 */
import { useLayoutEffect, useRef, useState } from 'react';

export interface PaletteSymbol {
  /** What the button shows. */
  label: string;
  /** What it inserts. */
  insert: string;
  /** Where the caret goes, counted from the start of the insert. Defaults to its end. */
  caret?: number;
  /** One line on what it means, shown once tapped. */
  gloss: string;
}

export function PatternInput({
  value,
  onChange,
  palette,
  placeholder,
  ariaLabel,
  onEnter,
  inputClassName = '',
}: {
  value: string;
  onChange: (v: string) => void;
  palette: PaletteSymbol[];
  placeholder?: string;
  ariaLabel: string;
  onEnter?: () => void;
  inputClassName?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const caretAfter = useRef<number | null>(null);
  const [gloss, setGloss] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && caretAfter.current !== null) {
      el.setSelectionRange(caretAfter.current, caretAfter.current);
      caretAfter.current = null;
    }
  }, [value]);

  const selection = (): [number, number] => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    return [start, end];
  };

  const insert = (sym: PaletteSymbol) => {
    const [start, end] = selection();
    if (start < end && sym.caret !== undefined) {
      // A pair around a selection wraps it: select "ha", tap ( ), get "(ha)".
      const open = sym.insert.slice(0, sym.caret);
      const close = sym.insert.slice(sym.caret);
      const inner = value.slice(start, end);
      caretAfter.current = start + open.length + inner.length + close.length;
      onChange(value.slice(0, start) + open + inner + close + value.slice(end));
    } else {
      caretAfter.current = start + (sym.caret ?? sym.insert.length);
      onChange(value.slice(0, start) + sym.insert + value.slice(end));
    }
    setGloss(`${sym.label}  ${sym.gloss}`);
  };

  const backspace = () => {
    const [start, end] = selection();
    if (start !== end) {
      caretAfter.current = start;
      onChange(value.slice(0, start) + value.slice(end));
    } else if (start > 0) {
      caretAfter.current = start - 1;
      onChange(value.slice(0, start - 1) + value.slice(start));
    }
  };

  return (
    <div>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) onEnter();
        }}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        aria-label={ariaLabel}
        className={`w-full rounded-xl border border-ink-600 bg-ink-950 px-4 py-3 text-ink-100 outline-none
          placeholder:text-ink-600 focus:border-mach-500 ${inputClassName}`}
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {palette.map((sym) => (
          <button key={sym.label} type="button" title={sym.gloss} className="tile !min-w-9 !py-1 font-mono" onClick={() => insert(sym)}>
            {sym.label}
          </button>
        ))}
        <button type="button" aria-label="delete" className="tile !min-w-9 !py-1 !text-sm" onClick={backspace} disabled={!value}>
          ⌫
        </button>
      </div>
      {gloss && <p className="mt-1.5 font-mono text-xs text-ink-400">{gloss}</p>}
    </div>
  );
}
