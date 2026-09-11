/**
 * A SET OF CHOICES, AS REAL BUTTONS.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Five of the panels in this app render a list they have already bucketed —
 * open / unconfirmed / spent, Kuva / Tenet / Coda, in reach / at the ceiling —
 * and then offer no way to ask for one bucket. The buckets were computed, drawn
 * as headings or as tally cards, and the reader's only tool for narrowing them
 * was the scroll wheel. Measured before this landed: NemesisPanel carried two
 * click handlers in 1,151 lines and IntrinsicsPanel one in 685.
 *
 * The fix is a control, and it has to be a REAL one. Every previous attempt in
 * this codebase at "a thing you can click" was a `<div onClick>`: not reachable
 * by keyboard, not announced as pressed, no focus ring. So this is a `<button>`
 * carrying `aria-pressed`, grouped under a label a screen reader can read, and
 * wearing `mo-focusable` so the focus ring blooms where it lands.
 *
 * MOTION, AND WHY NONE OF IT CAN STRAND
 * ─────────────────────────────────────
 * `mo-field` opts the button into the document-level pointer tracker, which is
 * what feeds the sheen — no per-button React handler, which matters because
 * these sit above lists of several hundred rows. `mo-lift` and `mo-sheen` are
 * hover-driven and therefore exempt from the frozen-timeline rule. `mo-in-up`
 * is time-based and animates transform only, so a stopped document timeline
 * leaves a control twelve pixels low and completely usable.
 *
 * The PRESSED state is not animated at all. It is a background and a colour
 * applied directly, because a control whose selected state arrives by
 * transition is a control that reports the wrong choice on a frozen timeline.
 */

import type { CSSProperties } from 'react';

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  /**
   * A count beside the label. `null` and `undefined` both print nothing —
   * an absent count is never rendered as a zero, because "we did not measure
   * this bucket" and "this bucket is empty" are different claims and only one
   * of them is a fact about the player.
   */
  badge?: number | null;
  /** What choosing this does. Sits on the title, so it costs no layout. */
  hint?: string;
}

export interface SegmentedProps<T extends string> {
  /** Labels the group for a screen reader. Never rendered visually. */
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (id: T) => void;
  /** The ink of the pressed state. Defaults to the panel gold. */
  accent?: string;
  className?: string;
}

/** Cut, never rounded — the same chamfer every control in the app wears. */
const CHIP = 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)';

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  accent = 'var(--color-orokin-300)',
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`mo-stagger flex flex-wrap items-center gap-[3px]${className === undefined ? '' : ` ${className}`}`}
    >
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            title={o.hint}
            onClick={() => {
              onChange(o.id);
            }}
            className="rf-clipped mo-field mo-lift mo-sheen mo-focusable mo-in-up flex cursor-pointer items-baseline gap-1.5 px-3 py-[5px] text-[length:var(--text-nano)] font-semibold tracking-[0.18em] uppercase"
            style={
              {
                '--i': i,
                clipPath: CHIP,
                color: on ? accent : 'var(--text-muted)',
                background: on
                  ? `color-mix(in oklab, ${accent} 18%, transparent)`
                  : 'oklch(1 0 0 / 0.04)',
                boxShadow: on ? `inset 0 0 0 1px color-mix(in oklab, ${accent} 45%, transparent)` : undefined,
              } as CSSProperties
            }
          >
            {o.label}
            {typeof o.badge === 'number' && (
              <span className="numeric" style={{ color: on ? accent : 'var(--text-faint)' }}>
                {o.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
