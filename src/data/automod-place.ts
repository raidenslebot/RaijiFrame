/**
 * WHERE THE OVERLAY GOES, which is: onto the game's own mod grid.
 *
 * THE SHAPE THIS FILE USED TO DESCRIBE, AND WHY IT WAS WRONG
 * ---------------------------------------------------------
 * The first version measured the one empty column on the Upgrades screen and
 * put a 300 x 263 strip in it. That was a mistake of emphasis: the brief asks
 * for a "full comprehensive and complete" overlay that is "extremely elaborate",
 * and a strip in a gutter is neither. Unobtrusive means it must not fight the
 * game or take its input - not that it must be small.
 *
 * WHAT IT DESCRIBES NOW
 * ---------------------
 * The window covers the game's whole client area and paints almost none of it.
 * What it draws, it draws ON THE GAME'S OWN SLOTS: the Upgrades screen lays the
 * installed build out as four columns by two rows of mod cards, and the perfect
 * build is shown in those same eight rectangles. A slot that is already correct
 * is left completely alone. So the overlay covers everything and obscures
 * nothing, and a player's eye goes straight to the slots that have to change.
 *
 * MEASURED, NOT DESIGNED
 * ----------------------
 * From the player's own 1680 x 1050 capture of `UPGRADES / BROKEN WAR [30]`,
 * read off a ruler-annotated crop and then verified by drawing the computed
 * rectangles back over the capture and looking at them:
 *
 *   card          201 x 104 including the base plate
 *   slot 0 centre (625, 396)
 *   pitch         213 across, 117 down
 *   grid          4 columns x 2 rows, so 8 slots
 *
 * The card size is the same 201 x 99 that `ui/ModCard.tsx` was traced to from a
 * tray card, which is the check that the two measurements agree.
 *
 * Everything is expressed as a fraction of the game's LOGICAL client area, so
 * Overwolf's DPI arithmetic applies once, in `placeWindow`. Measured at 16:10;
 * the grid scales with height and is centred, so the fractions below are
 * derived from the centre rather than from the left edge, which is what makes
 * them survive a different aspect ratio.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The capture every fraction below was taken from. A gate pins the grid at this size. */
export const MEASURED_AT = { width: 1680, height: 1050 } as const;

/** One mod card, in the capture's pixels. */
export const CARD = { width: 201, height: 104 } as const;

/** The grid, in the capture's pixels: the centre of slot 0 and the step between slots. */
export const GRID = {
  columns: 4,
  rows: 2,
  firstCentreX: 625,
  firstCentreY: 396,
  pitchX: 213,
  pitchY: 117,
} as const;

/**
 * The whole game client area. The window is transparent and takes no input, so
 * covering everything costs nothing and is what lets the content sit on the
 * game's own geometry instead of beside it.
 */
export function fullBox(area: { width: number; height: number }): Box {
  return { left: 0, top: 0, width: Math.max(0, area.width), height: Math.max(0, area.height) };
}

/**
 * Where slot `index` sits, in the CURRENT area's logical pixels.
 *
 * Anchored to the horizontal CENTRE of the screen rather than to its left edge:
 * the game centres the grid, so a wider screen moves it right by half the extra
 * width and an offset measured from the left would drift. Vertically the grid
 * is positioned as a fraction of height, which is how the game scales it.
 */
export function slotBox(index: number, area: { width: number; height: number }): Box {
  const col = index % GRID.columns;
  const row = Math.floor(index / GRID.columns);
  const scale = area.height / MEASURED_AT.height;
  const centreOffsetX = GRID.firstCentreX + GRID.pitchX * col - MEASURED_AT.width / 2;
  const cx = area.width / 2 + centreOffsetX * scale;
  const cy = (GRID.firstCentreY + GRID.pitchY * row) * scale;
  return {
    left: Math.round(cx - (CARD.width * scale) / 2),
    top: Math.round(cy - (CARD.height * scale) / 2),
    width: Math.round(CARD.width * scale),
    height: Math.round(CARD.height * scale),
  };
}

/** How many slots the grid shows. The eleventh index and the aura are a named unknown. */
export const GRID_SLOTS_SHOWN = GRID.columns * GRID.rows;

/**
 * The empty column to the right of the grid, which is where anything that is
 * NOT about a specific slot goes - the weapon's figure against its ceiling, and
 * the mods the account does not own at all, which have no slot to sit in yet.
 *
 * Measured the same way: a per-column activity scan of the capture reads 13-33
 * over the cards and 2.0-7.6 from x = 1372 rightward, which is the starfield
 * alone. The arcane slot sits above it and the tray's top rule below.
 */
/**
 * The column measured at 1680 x 1050: x 1372 to 1672, so 300 logical pixels
 * wide. It scales with the screen's HEIGHT like every other measurement here,
 * because that is how the game scales its own interface.
 */
const ASIDE_WIDTH = MEASURED_AT.width - 8 - 1372;

export function asideBox(area: { width: number; height: number }): Box {
  const scale = area.height / MEASURED_AT.height;
  const left = Math.round(area.width / 2 + (1372 - MEASURED_AT.width / 2) * scale);
  const top = Math.round(335 * scale);
  /*
   * THE WIDTH IS THE GAME'S COLUMN, NOT WHATEVER IS LEFT OF THE SCREEN.
   *
   * This was `area.width - 8 - left` - everything from the column's start to
   * the right edge. At 1680 x 1050 that is exactly 300, because 1680 is the
   * width it was measured at, so it looked right and stayed wrong. Every other
   * aspect ratio got a different column:
   *
   *   1920 x 1080  16:9        405 px
   *   2560 x 1080  21:9        725 px
   *   3440 x 1440  21:9        982 px
   *   5120 x 1440  32:9      1,822 px
   *
   * A line of type eighteen hundred pixels wide is not a column, and every
   * measurement the overlay makes against it - how many missing mods fit, how
   * many assumptions - was being made against a box that only had the right
   * size on one monitor.
   *
   * The grid was never wrong: it anchors to the screen's CENTRE and scales by
   * height, so it tracks the game at every ratio (the gap from the last card to
   * this column stays 7-10 px from 4:3 to 32:9). The aside now does the same.
   *
   * The `min` still applies: on a screen too narrow to hold the full column the
   * overlay takes what there is rather than running off the edge.
   */
  return {
    left,
    top,
    width: Math.max(0, Math.min(Math.round(ASIDE_WIDTH * scale), area.width - 8 - left)),
    height: Math.max(0, Math.round(598 * scale) - top),
  };
}
