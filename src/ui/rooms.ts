import { VOID_PALETTE, type Palette } from './Backdrop';

/**
 * A ROOM PER PANEL.
 *
 * WHY
 * ───
 * Thirteen panels shared one identical backdrop, so every screen in the app was
 * the same dark teal field with different rows on it. That is the real reason it
 * read as one long list rather than as an application: nothing told you where
 * you were except the text.
 *
 * Warframe never does this. Its star chart is cold and enormous, Cetus is a
 * sunlit market, the Necralisk is red and organic, the Foundry is a lit forge.
 * You know which screen you are on before you read a single word.
 *
 * So the field takes on the character of whatever it is behind. The shader is
 * unchanged — this is seven colours and a light position per panel, cross-faded
 * over ~0.6s when you switch. One system, thirteen places.
 *
 * HOW THE COLOURS WERE CHOSEN
 * ───────────────────────────
 * Each is anchored to something the panel is actually ABOUT, not picked to be
 * pretty:
 *
 *   - the star chart keeps the sampled teal, because that is the real thing
 *   - mastery and progression are lit gold, the game's colour for rank and Orokin
 *   - the nemesis field is hostile red, lit from low and behind
 *   - focus is Void violet; the operator's whole visual language is void energy
 *   - the foundry is a forge: warm, close, lit from below
 *   - resources and collection are cold storage, lit flat and blue
 *   - worldstate and daily run cooler and dimmer, because they are clocks
 *
 * Every palette keeps the same STRUCTURE — a dark ground, a body, a lit rim, a
 * second hue in the folds, a crest — so they are recognisably one field wearing
 * different light, not thirteen unrelated wallpapers.
 */

/** Shorthand so the table below reads as colour, not as syntax. */
const room = (
  deep: [number, number, number],
  body: [number, number, number],
  rim: [number, number, number],
  cold: [number, number, number],
  crest: [number, number, number],
  warm: [number, number, number],
  light: [number, number],
): Palette => ({ deep, body, rim, cold, crest, warm, light });

export const ROOMS: Record<string, Palette> = {
  /* Gold and lit from the upper left — rank, Orokin, the thing you are building
     toward. Warmer than anywhere else in the app. */
  /*
   * GOLD IS A LIGHT, NOT A GROUND.
   *
   * This palette had every one of its five field colours warm - deep, body,
   * rim, cold and crest all with R above G above B - so the whole frame was
   * tinted the same brown and the field read as sludge rather than as gas.
   * Rendered at full size it was the worst surface in the app, and it is the
   * app's FIRST screen.
   *
   * The star-chart palette that works does the opposite: its ground is close to
   * black and the colour arrives through the rim, the crest and the off-screen
   * light. Body there is 0.07-0.14; this one's was 0.098-0.052 and reading as
   * paint. So the ground goes back to near-neutral black, the second hue in the
   * folds goes cool to give the gold something to be gold AGAINST, and the
   * warmth stays where it belongs - in the crest and the light source.
   *
   * Still the warmest room in the app, still lit from the upper left, still
   * unmistakably not the star chart. Just no longer made of mud.
   */
  progression: room(
    [0.015, 0.014, 0.016],
    [0.040, 0.036, 0.036],
    [0.072, 0.060, 0.038],
    [0.042, 0.052, 0.078],
    [0.300, 0.246, 0.138],
    [0.245, 0.170, 0.072],
    [-0.55, 0.30],
  ),

  /* The real thing: the teal sampled from the player's own captures. */
  starchart: VOID_PALETTE,

  /* Mastery shares progression's gold but sits deeper and quieter — this is a
     ledger, not a call to action. */
  mastery: room(
    [0.024, 0.021, 0.015],
    [0.086, 0.072, 0.044],
    [0.158, 0.132, 0.080],
    [0.112, 0.086, 0.044],
    [0.230, 0.196, 0.128],
    [0.200, 0.145, 0.070],
    [-0.60, 0.18],
  ),

  /* Arsenal: a dark stage with a single hard light, the way the game presents a
     frame you are inspecting. Nearly monochrome so the gear carries the colour. */
  arsenal: room(
    [0.018, 0.020, 0.026],
    [0.060, 0.068, 0.086],
    [0.118, 0.132, 0.164],
    [0.070, 0.086, 0.130],
    [0.180, 0.198, 0.235],
    [0.140, 0.150, 0.180],
    [-0.70, 0.10],
  ),

  /* Collection and Resources are cold storage: flat blue, lit from high and far,
     nothing warm. A vault, not a workshop. */
  collection: room(
    [0.016, 0.022, 0.034],
    [0.050, 0.076, 0.118],
    [0.098, 0.140, 0.205],
    [0.062, 0.104, 0.190],
    [0.155, 0.205, 0.278],
    [0.100, 0.130, 0.190],
    [-0.35, 0.55],
  ),
  resources: room(
    [0.015, 0.021, 0.030],
    [0.046, 0.070, 0.104],
    [0.090, 0.130, 0.180],
    [0.058, 0.096, 0.168],
    [0.145, 0.190, 0.250],
    [0.095, 0.122, 0.170],
    [-0.30, 0.50],
  ),

  /* The Foundry is a forge — lit from BELOW, close and warm, with heat in the
     folds. The only palette whose light sits under the frame. */
  foundry: room(
    [0.030, 0.020, 0.014],
    [0.108, 0.062, 0.032],
    [0.196, 0.112, 0.056],
    [0.150, 0.070, 0.028],
    [0.278, 0.170, 0.092],
    [0.265, 0.140, 0.055],
    [0.10, -0.72],
  ),

  /* Focus and Intrinsics are Void energy: violet, cold, lit from directly behind
     so the field glows through rather than being lit across. */
  focus: room(
    [0.024, 0.019, 0.038],
    [0.078, 0.058, 0.130],
    [0.140, 0.108, 0.225],
    [0.098, 0.070, 0.200],
    [0.205, 0.170, 0.300],
    [0.150, 0.110, 0.240],
    [0.0, 0.0],
  ),
  intrinsics: room(
    [0.020, 0.020, 0.034],
    [0.062, 0.064, 0.118],
    [0.116, 0.120, 0.200],
    [0.078, 0.082, 0.180],
    [0.178, 0.182, 0.265],
    [0.120, 0.118, 0.205],
    [-0.45, -0.30],
  ),

  /* Syndicates: green, the standing colour, lit from the right — the only
     palette lit from that side, which makes the switch legible on its own. */
  syndicates: room(
    [0.017, 0.026, 0.021],
    [0.054, 0.098, 0.070],
    [0.100, 0.176, 0.126],
    [0.062, 0.140, 0.108],
    [0.160, 0.240, 0.185],
    [0.110, 0.170, 0.120],
    [0.62, 0.20],
  ),

  /* Nemesis: hostile. Red, lit low and behind, with the deepest ground in the
     app — a lich's territory should not feel like the rest of the ship. */
  nemesis: room(
    [0.030, 0.013, 0.012],
    [0.112, 0.036, 0.032],
    [0.198, 0.070, 0.060],
    [0.150, 0.040, 0.040],
    [0.270, 0.115, 0.098],
    [0.240, 0.075, 0.060],
    [0.30, -0.60],
  ),

  /* Daily and Worldstate are clocks: cool, even, and dimmer than anywhere else.
     Nothing here is a place you go, so nothing here competes. */
  daily: room(
    [0.016, 0.021, 0.028],
    [0.052, 0.070, 0.092],
    [0.098, 0.130, 0.166],
    [0.064, 0.094, 0.150],
    [0.152, 0.188, 0.228],
    [0.105, 0.125, 0.160],
    [-0.50, 0.42],
  ),
  worldstate: room(
    [0.015, 0.023, 0.026],
    [0.050, 0.082, 0.090],
    [0.096, 0.150, 0.158],
    [0.062, 0.110, 0.165],
    [0.150, 0.208, 0.212],
    [0.105, 0.140, 0.150],
    [-0.58, 0.34],
  ),
};

/** The room for a panel, falling back to the void. */
export function roomFor(panelId: string): Palette {
  return ROOMS[panelId] ?? VOID_PALETTE;
}
