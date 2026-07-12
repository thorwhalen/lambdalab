/**
 * The small shared vocabulary of the interface.
 *
 * Deliberately tiny: a panel, a button, a badge, a callout. Anything that only
 * one lesson needs belongs to that lesson, not here.
 */
import type { ReactNode } from 'react';

export function Panel({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'aside';
}) {
  return <Tag className={`panel p-5 ${className}`}>{children}</Tag>;
}

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'good';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-lam-500 hover:bg-lam-400 text-white border-lam-400/40 shadow-[0_2px_18px_-4px_var(--color-lam-500)]',
  ghost: 'bg-ink-800 hover:bg-ink-700 text-ink-200 border-ink-600',
  danger: 'bg-ink-800 hover:bg-ink-700 text-[var(--color-bad)] border-ink-600',
  good: 'bg-[var(--color-good)]/15 hover:bg-[var(--color-good)]/25 text-[var(--color-good)] border-[var(--color-good)]/40',
};

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  className = '',
  title,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  className?: string;
  title?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-4 py-2 text-sm font-medium transition
        disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_STYLES[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'ink' }: { children: ReactNode; tone?: 'ink' | 'good' | 'bad' | 'lam' }) {
  const tones = {
    ink: 'bg-ink-800 text-ink-300 border-ink-600',
    good: 'bg-[var(--color-good)]/12 text-[var(--color-good)] border-[var(--color-good)]/35',
    bad: 'bg-[var(--color-bad)]/12 text-[var(--color-bad)] border-[var(--color-bad)]/35',
    lam: 'bg-lam-500/15 text-lam-400 border-lam-500/40',
  } as const;
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/**
 * Feedback after an answer. The `wrong` variant never just says "wrong" — it
 * takes children, and those children are always the *evidence*: the string the
 * machine got wrong, the little world where the sentence is false.
 */
export function Verdict({
  ok,
  title,
  children,
}: {
  ok: boolean;
  title: string;
  children?: ReactNode;
}) {
  const c = ok
    ? 'border-[var(--color-good)]/40 bg-[var(--color-good)]/8'
    : 'border-[var(--color-bad)]/40 bg-[var(--color-bad)]/8';
  return (
    <div className={`rounded-xl border p-4 ${c}`} role="status" aria-live="polite">
      <div className={`mb-1 font-semibold ${ok ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}`}>
        {ok ? '✓ ' : '✗ '}
        {title}
      </div>
      {children && <div className="text-sm text-ink-300">{children}</div>}
    </div>
  );
}

/** An aside for the "wait, really?" moments. Used sparingly or it stops working. */
export function Aha({ children }: { children: ReactNode }) {
  return (
    <div className="my-4 rounded-xl border border-info-500/35 bg-info-500/8 p-4 text-sm text-ink-200">
      <span className="mr-2 font-semibold text-info-400">Wait —</span>
      {children}
    </div>
  );
}
