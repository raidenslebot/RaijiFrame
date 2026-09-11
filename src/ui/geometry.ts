/**
 * The cut edges and plates every panel wears, named once.
 *
 * WHY A MODULE OF EIGHT STRINGS
 * ─────────────────────────────
 * An inventory across fourteen panels found the chamfer polygon declared as a
 * literal in twenty-four files (three sizes), the plate backgrounds in
 * thirteen, the gold rim pair in two and the hairline rule in ten - every one
 * a copy, none answering to a token. Two consequences followed. The app's
 * working chamfer, 10px, was in no scale at all. And the spec's stroke-bearing
 * frame (UI-SPEC §2.0, "blocks every visual primitive") would have had to land
 * in twenty-four places, which is why it never landed anywhere.
 *
 * These are `var()` references, not values. The values live in `theme.css`
 * beside the cut scale, verbatim from the literals they replace, so pointing a
 * file here changes no pixel - measured by hashing the computed clip-path and
 * background of every plated element before and after. `check-ui-tokens.ts`
 * refuses the literals from now on.
 *
 * `as CHAMFER` at the import site is deliberate where a file used a different
 * size: the identifier every call site already uses keeps working, and the
 * diff is one line.
 */

/** The 10px cut most of the app wears. See `--cut-base` for why it is its own step. */
export const CHAMFER = 'var(--chamfer)';
/** 8px - the tighter cut on a disclosure and the route detail. */
export const CHAMFER_SM = 'var(--chamfer-sm)';
/** 14px - the deeper cut on a hero plate. */
export const CHAMFER_MD = 'var(--chamfer-md)';

/** The flat translucent lift a row sits on. */
export const PLATE_LIFT = 'var(--plate-lift)';
/** The cool structural ground of the economic panels. */
export const PLATE_COOL = 'var(--plate-cool)';
/** The lit gold rim and its fill - the one warm surface, spent on the player's own panels. */
export const GOLD_RIM = 'var(--plate-gold-rim)';
export const GOLD_FILL = 'var(--plate-gold-fill)';
/*
 * The hairline rule (`--rule-hairline`) has no export on purpose. Its ten
 * sites used the gradient inside a longer background string, so they were
 * repointed to the token in place; an exported constant nobody imported was
 * one more name for the same thing, and the audit said so.
 */
