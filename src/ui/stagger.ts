import type { CSSProperties } from 'react';

/**
 * The entrance cascade, sized to the list it is running on.
 *
 * `docs/research/ui-motion.md:206` states the rule and gives the formula:
 *
 * > "`staggerChildren: 0.035` over a 14-row list is 490ms of cascade … Cap the
 * > total: `stagger = min(0.035, 0.30 / n)`. **Compute it, do not hardcode it.**"
 *
 * `theme.css` hardcoded 26ms a row instead, which is right for a short list and
 * wrong the moment one is long: the eighteenth row started at 442ms, half again
 * past the 300ms a cascade may take before it stops reading as one gesture and
 * starts reading as a slow menu.
 *
 * WHY A HELPER RATHER THAN THE EXPRESSION AT EACH LIST
 * ────────────────────────────────────────────────────
 * There are eight `.rf-staged` lists. Eight copies of `Math.min(35, 300 / n)`
 * is eight places for the cap to drift apart, which is the same defect as the
 * three copies of DE's equipment-array list this codebase just finished
 * collapsing. One function, one number, one place to change it.
 *
 * Spread the result onto the element that carries `.rf-staged`:
 *
 *     <ul className="rf-staged …" style={staggerFor(rows.length)}>
 *
 * A list that does not call this keeps the 26ms default, so nothing that exists
 * today changes until it opts in.
 */
export function staggerFor(rows: number): CSSProperties {
  /*
   * 35ms is the spec's per-row figure and 300ms its total; below about nine
   * rows the per-row cap binds and the cascade is simply shorter, which is
   * correct - a three-row list does not need to take a third of a second.
   *
   * A one-row or empty list gets the per-row figure and never uses it. Guarding
   * `n` at 1 keeps the division defined rather than returning Infinity, which
   * would serialise as an invalid custom property and be silently dropped -
   * leaving the default in place, which is the failure mode that looks like
   * nothing happened.
   */
  const ms = Math.min(35, 300 / Math.max(rows, 1));
  // Rounded to a tenth: the browser will not resolve finer, and an unrounded
  // float here produces a different string on every render, which defeats the
  // style-object identity check and re-applies the property needlessly.
  return { '--rf-stagger': `${String(Math.round(ms * 10) / 10)}ms` } as CSSProperties;
}
