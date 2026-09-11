/**
 * THE GAME'S OWN PALETTE, MEASURED OFF THE PLAYER'S OWN SCREEN.
 *
 * WHY THIS EXISTS, AND WHY THE PREVIOUS SAMPLING WAS WRONG
 * ────────────────────────────────────────────────────────
 * `automod.css` already said "COLOUR IS SAMPLED, NOT CHOSEN", and it was true:
 * every accent in it was read off the same 1680 x 1050 capture this module
 * measures. The overlay still did not look like the game, and the reason turns
 * out to be WHICH pixels were sampled.
 *
 * The old pass sampled PEAKS - the brightest pixel on a card, a solid run of
 * the gold scroll rail. A peak is a real colour, but the game spends peaks on
 * hairlines and specular edges, which are a fraction of a per cent of the
 * screen. Filling a whole heading with a peak value paints, at large area, a
 * colour the game only ever shows at one pixel wide. The overlay was not near
 * the game's palette and slightly off; it was at the game's palette's extreme,
 * everywhere at once.
 *
 * `docs/research/overlay-ui.md` records the earlier lesson - "match the range,
 * not the mean" - after a pass that averaged an asset and produced something
 * flat. Averaging was wrong and peak-sampling is wrong for the same reason:
 * both replace a distribution with one number. This module carries the
 * DISTRIBUTION.
 *
 * HOW THESE WERE OBTAINED
 * ───────────────────────
 * Every pixel of the capture converted to oklch and bucketed by hue family
 * (441,000 samples at a 2 px stride), plus fifteen named text regions sampled
 * at their 99th luminance percentile - the glyph CORE, since a glyph box is
 * mostly antialiasing and its mean understates it badly.
 *
 * THE TWO FINDINGS THAT CHANGE THE DESIGN
 * ───────────────────────────────────────
 * 1. THE GAME HAS ONE HUE. Its ink is not white and its gold is not a separate
 *    colour: title, section heads, stat values, tab labels, card names and the
 *    capacity rail are ALL hue 89-101 at chroma 0.04-0.063, separated only by
 *    lightness. Three levels, and they are astonishingly tight - the four
 *    "quiet" samples land within 0.008 of each other. The overlay's ink was
 *    `oklch(0.94 0.004 250)`: a COOL near-neutral, 160 degrees away at a
 *    twelfth of the chroma. On a screen 54 % covered in violet ground, a cool
 *    white reads as foreign and a warm one reads as native.
 *
 * 2. THE GAME IS DARK, AND SPENDS BRIGHTNESS LIKE MONEY. Median luminance over
 *    the whole screen is 24.4 of 255. Only 4.06 % is brighter than 128, 1.55 %
 *    brighter than 192, 0.96 % brighter than 224.
 *
 *    THIS WAS NOT WHAT WAS WRONG WITH THE OVERLAY, and the first draft of this
 *    comment said it was. The claim was that a column of bright type spends
 *    more of the bright budget in one box than the game spends across 1.76
 *    million pixels. Measured, on a render of the overlay over the capture with
 *    the column excluded from the game's own figures: the OLD overlay sat at
 *    0.03 % above luminance 192 against the game's 1.59 %, fifty times UNDER
 *    budget. Type is mostly antialiasing and the column is mostly empty.
 *
 *    The budget is kept because it is a real invariant and a future pass can
 *    break it - `check-game-palette.ts` measures it - but it diagnosed nothing.
 *    What was wrong was finding 1: the hue and the chroma, not the area.
 *
 * Red is not in this module because the game does not use it: 108 samples out
 * of 441,000, 0.02 % of the screen. A routine cost is not a warning and must
 * not be painted like one.
 *
 * PRIVACY: the capture is the player's own screen. It lives at the repo root,
 * never in `public/`, and never reaches a build. This module holds the numbers
 * it yielded, not the image.
 */

/** The capture every number here came from, and how much of it was read. */
export const SOURCE = {
  capture: '__lab-bg.webp',
  screen: 'Upgrades / Broken War, 1680 x 1050',
  pixelsSampled: 441_000,
  stride: 2,
  textRegions: 15,
  measuredBy: 'scratchpad measure-game-ui2.py and measure-type.py',
} as const;

/** An oklch colour as three numbers, so a gate can compare rather than string-match. */
export interface Lch {
  readonly L: number;
  readonly C: number;
  readonly h: number;
}

export function css(c: Lch, alpha?: number): string {
  const a = alpha === undefined ? '' : ` / ${String(alpha)}`;
  return `oklch(${c.L.toFixed(3)} ${c.C.toFixed(3)} ${String(Math.round(c.h))}${a})`;
}

/**
 * THE THREE INK LEVELS, at the 99th percentile of their glyph cores.
 *
 *   bright  title, section heads, stat VALUES, the active tab, card names
 *           measured 0.921 0.924 0.923 0.925 0.926 0.950 0.926 -> 0.925
 *   quiet   stat LABELS, inactive tabs, button labels
 *           measured 0.744 0.737 0.745 0.745 -> 0.744, a spread of 0.008
 *   off     unavailable: "Requires Melee Arcane Adapter" -> 0.496
 *
 * The chroma is the average across those same samples and the hue is their
 * median. Warm, faintly brass, never neutral.
 */
export const INK = {
  bright: { L: 0.925, C: 0.05, h: 91 },
  quiet: { L: 0.744, C: 0.055, h: 91 },
  off: { L: 0.496, C: 0.013, h: 90 },
} as const satisfies Record<string, Lch>;

/**
 * The brass band, over every gold pixel on the screen (8,388 samples, 1.90 %).
 *
 * `mid` is the median and is what a FILL should use. `peak` is the p90 and
 * belongs on a hairline or a lit edge, which is the only place the game puts
 * it. The old `--am-gold` was `oklch(0.76 0.108 88)`: above the median in
 * lightness and at 1.9x its chroma, used as a fill.
 */
export const BRASS = {
  floor: { L: 0.394, C: 0.047, h: 91 },
  mid: { L: 0.675, C: 0.057, h: 91 },
  peak: { L: 0.912, C: 0.082, h: 91 },
} as const satisfies Record<string, Lch>;

/**
 * The energy cyan, over every cyan pixel (2,000 samples, 0.45 %). The game
 * reserves it for rank pips, the platinum and credit glyphs, and charged
 * states - a quarter as much screen as the brass, so it is the rarer signal
 * and must stay that way.
 */
export const ENERGY = {
  mid: { L: 0.609, C: 0.067, h: 237 },
  peak: { L: 0.853, C: 0.083, h: 237 },
} as const satisfies Record<string, Lch>;

/**
 * The ground: 54 % of the screen, and violet rather than neutral. The overlay's
 * plates were `oklch(0.19 0.008 270)` - half the chroma and slightly darker,
 * which is what makes a plate read as a grey box laid over a coloured room.
 */
export const GROUND = {
  deep: { L: 0.19, C: 0.014, h: 278 },
  mid: { L: 0.205, C: 0.017, h: 278 },
  raised: { L: 0.246, C: 0.019, h: 285 },
} as const satisfies Record<string, Lch>;

/**
 * THE BRIGHT BUDGET, as fractions of area. The game's own distribution.
 *
 * This is the number the design is built around, and it is the one an eye
 * cannot check. A region of the overlay may spend no MORE of its area above a
 * level than the game spends of its own - so at most 1.55 % of the overlay's
 * area may sit above luminance 192, which in a 300 x 230 column is about a
 * thousand pixels: one short line, and nothing else.
 */
export const BRIGHT_BUDGET = {
  medianLuma: 24.4,
  over128: 0.0406,
  over160: 0.0282,
  over192: 0.0155,
  over224: 0.0096,
} as const;

/** True when a colour sits inside a measured band, with a tolerance per axis. */
export function inBand(c: Lch, lo: Lch, hi: Lch, tol = { L: 0.02, C: 0.015, h: 12 }): boolean {
  const hueOk = Math.abs(((c.h - (lo.h + hi.h) / 2 + 540) % 360) - 180) <= tol.h;
  return c.L >= lo.L - tol.L && c.L <= hi.L + tol.L && c.C >= lo.C - tol.C && c.C <= hi.C + tol.C && hueOk;
}
