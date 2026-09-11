/**
 * THE OVERLAY IS THE GAME'S COLOUR, OR IT IS NOT THE GAME.
 *
 * WHAT THIS GATE IS FOR
 * ─────────────────────
 * `automod.css` has said "COLOUR IS SAMPLED, NOT CHOSEN" for a long time and it
 * was true - every accent in it was read off the player's own 1680 x 1050
 * capture of the Upgrades screen. The overlay still did not look like the game.
 *
 * The reason was WHICH pixels. The old pass sampled PEAKS: the brightest pixel
 * on a mod card, a solid run of the gold scroll rail. A peak is a real colour,
 * but the game spends peaks on hairlines and specular edges, a fraction of a
 * per cent of the screen. Fill a heading with one and you paint, at large area,
 * a colour the game only ever shows one pixel wide.
 *
 * `src/ui/game-palette.ts` replaces the peaks with the DISTRIBUTION - every
 * pixel of the capture bucketed by hue, plus fifteen text regions sampled at
 * the 99th percentile of their glyph cores - and this file is what stops the
 * distribution from drifting back into a peak.
 *
 * THE DEFECT IT EXISTS TO CATCH, stated exactly
 * ─────────────────────────────────────────────
 * The overlay's body ink was `oklch(0.94 0.004 250)`. The game's is
 * `oklch(0.925 0.05 91)`. That is 160 degrees of hue at a twelfth of the
 * chroma: a COOL near-neutral where the game is warm brass. On a screen 54 %
 * covered in violet ground, a cool white reads as foreign and a warm one reads
 * as native, and no amount of layout work covers it.
 *
 * WHAT THIS GATE DELIBERATELY DOES NOT CLAIM
 * ──────────────────────────────────────────
 * The bright-budget rule below - the overlay may spend no more of its own area
 * above a luminance than the game spends of its own - is a real invariant and a
 * future pass can break it. It did NOT diagnose anything: measured on a render
 * of the OLD overlay over the capture, it sat at 0.03 % above luminance 192
 * against the game's 1.59 %, fifty times under budget. Type is mostly
 * antialiasing and the column is mostly empty. Recorded here because a gate
 * that quietly takes credit for a fix it did not make is worse than no gate.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BRASS, BRIGHT_BUDGET, ENERGY, GROUND, INK, SOURCE, css, inBand, type Lch } from '../src/ui/game-palette.ts';

let checks = 0;
let failures = 0;
function ok(label: string, fn: () => void): void {
  checks++;
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${label}\n        ${(err as Error).message.split('\n')[0]}`);
  }
}

const CSS = readFileSync(new URL('../src/styles/automod.css', import.meta.url), 'utf8');
/** Comments carry the OLD values on purpose, as the record of what was wrong. */
const LIVE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

interface Found {
  readonly raw: string;
  readonly c: Lch;
}
function literals(text: string): Found[] {
  const out: Found[] = [];
  const re = /oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    out.push({ raw: m[0], c: { L: Number(m[1]), C: Number(m[2]), h: Number(m[3]) } });
  }
  return out;
}

/** The token a declaration defines, so a failure names the token and not a number. */
function tokenOf(name: string): Lch | null {
  const m = new RegExp(`--${name}:\\s*oklch\\(\\s*([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)`).exec(LIVE);
  return m === null ? null : { L: Number(m[1]), C: Number(m[2]), h: Number(m[3]) };
}

console.log('\nthe measurement itself');

ok('the palette module still says what the capture said', () => {
  /*
   * The bands are the measurement. If somebody edits them to make a colour
   * pass, the colour did not come into band - the band moved - so the numbers
   * are pinned here against the capture they were read from.
   */
  assert.equal(SOURCE.capture, '__lab-bg.webp');
  assert.ok(SOURCE.pixelsSampled >= 400_000, `only ${String(SOURCE.pixelsSampled)} pixels were sampled`);
  assert.ok(SOURCE.textRegions >= 15, `only ${String(SOURCE.textRegions)} text regions`);

  // One hue family for all three ink levels, which is the whole finding.
  for (const [name, ink] of Object.entries(INK)) {
    assert.ok(Math.abs(ink.h - 91) <= 3, `INK.${name} is at hue ${String(ink.h)}, not the game's brass ~91`);
  }
  assert.ok(INK.bright.L > INK.quiet.L && INK.quiet.L > INK.off.L, 'the three ink levels are not ordered');
  // The four "quiet" samples measured within 0.008 of each other; anything
  // claiming to be that level has to sit where they did.
  assert.ok(Math.abs(INK.quiet.L - 0.744) < 0.01, `INK.quiet moved to ${String(INK.quiet.L)}`);
  assert.ok(INK.bright.C >= 0.04 && INK.bright.C <= 0.063, `INK.bright chroma ${String(INK.bright.C)} is outside the measured 0.04-0.063`);

  // A fill takes the median; a hairline takes the p90. Collapsing them is what went wrong.
  assert.ok(BRASS.mid.L < BRASS.peak.L && BRASS.mid.C < BRASS.peak.C, 'the brass band has no fill/edge separation left');
  assert.ok(ENERGY.mid.C < 0.08, `energy is meant to be the RARER signal, at ${String(ENERGY.mid.C)} chroma`);
  // The ground is violet, not grey. This is the one people "correct" away.
  assert.ok(GROUND.mid.C >= 0.012 && GROUND.mid.h > 260 && GROUND.mid.h < 300, `the ground stopped being violet: ${css(GROUND.mid)}`);
});

console.log('\nthe overlay wears it');

ok('every ink level in the CSS is the measured one, to the third decimal', () => {
  /*
   * NAMED ONCE. The module holds the numbers and CSS cannot import a module, so
   * the values are written out - and this is what makes that safe. A drift in
   * either direction fails, and the message says which side moved.
   */
  const pairs: Array<[string, Lch]> = [
    ['am-ink', INK.bright],
    ['am-ink-quiet', INK.quiet],
    ['am-ink-off', INK.off],
    ['am-gold', BRASS.mid],
    ['am-gold-edge', BRASS.peak],
    ['am-pip', ENERGY.mid],
    ['am-pip-edge', ENERGY.peak],
  ];
  for (const [name, want] of pairs) {
    const got = tokenOf(name);
    assert.ok(got, `--${name} is not defined in automod.css`);
    assert.ok(
      Math.abs(got.L - want.L) < 0.0006 && Math.abs(got.C - want.C) < 0.0006 && Math.abs(got.h - want.h) < 0.6,
      `--${name} is ${css(got)} where the capture measured ${css(want)}`,
    );
  }
});

ok('THE REGRESSION: no cool near-neutral ink, which is what the overlay shipped', () => {
  /*
   * The specific defect, gated at the shape it actually took. Any token light
   * enough to be text (L > 0.45) must be either in the brass family or in the
   * energy family - the game has no third hue for type - and must carry real
   * chroma. `oklch(0.94 0.004 250)` fails on both counts, which is the point.
   *
   * The frame materials are exempt BY NAME and with a reason: bronze, silver
   * and steel are what a mod card's frame is made of, a different sample family
   * from the screen's type, and they are the card's own material rather than
   * the overlay's voice.
   */
  const EXEMPT = new Set(['am-rarity-common', 'am-rarity-uncommon', 'am-rarity-prime', 'am-plate-lit', 'am-plate-bar']);
  const decl = /--([a-z0-9-]+):\s*oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/g;
  const wrong: string[] = [];
  for (let m = decl.exec(LIVE); m !== null; m = decl.exec(LIVE)) {
    const name = m[1]!;
    const c: Lch = { L: Number(m[2]), C: Number(m[3]), h: Number(m[4]) };
    if (c.L <= 0.45 || EXEMPT.has(name)) continue;
    /*
     * THE INK LEVELS ARE THEIR OWN BAND, and the first version of this rule did
     * not know that - it checked every light token against BRASS and failed
     * `--am-ink-off`, which is the game's own measured `oklch(0.496 0.013 90)`.
     * Chroma falls off as a colour gets dim; that is how colour works, not a
     * defect. What must hold at every level is the HUE, and the near-neutral
     * prohibition belongs where a cool white actually reads as foreign: on type
     * bright enough to carry a page, not on the dimmest caveat on the panel.
     */
    const isInk = Object.values(INK).some((i) => Math.abs(c.L - i.L) < 0.01 && Math.abs(c.h - i.h) < 3);
    const brass = inBand(c, BRASS.floor, BRASS.peak);
    const energy = inBand(c, ENERGY.mid, ENERGY.peak);
    // The shortfall red is the one deliberate third hue, and it is the game's own.
    const red = c.h >= 15 && c.h <= 45 && c.C >= 0.078 && c.C <= 0.157;
    if (!isInk && !brass && !energy && !red) wrong.push(`--${name}: ${css(c)}`);
    if (c.L > 0.6 && c.C < 0.01) wrong.push(`--${name}: ${css(c)} is a near-neutral at reading brightness; the game's type is warm at every level`);
  }
  assert.deepEqual(wrong, [], `these paint type in a hue the game does not use:\n        ${wrong.join('\n        ')}`);
});

ok('TWO HUES, and no global signal colour smuggling in a third', () => {
  /*
   * The panel is one warm brass at three lightnesses plus a rare energy cyan.
   * Three separate global tokens had put a fourth and fifth hue on it and each
   * was found by looking at a render rather than by any rule: the Forma line in
   * `--color-signal-rare` (hue 300, chroma 0.16), the price shortfall in
   * `--color-signal-bad` (hue 27 at 2.2x any red the game draws), and a placed
   * edit in `--color-signal-good` (hue 152, and there is no green text anywhere
   * on the Upgrades screen).
   *
   * They are app-wide tokens tuned for the desktop panels, which are not
   * pretending to be the game. This is the rule that stops the next one.
   */
  const smuggled = [...LIVE.matchAll(/var\(--color-signal-[a-z]+\)/g)].map((m) => m[0]);
  assert.deepEqual(smuggled, [], `a global signal colour is painting the overlay: ${smuggled.join(', ')}`);

  // And the overlay's own accents are the two the game uses, plus its one red.
  const hues = new Set<number>();
  const decl = /--am-[a-z-]+:\s*oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/g;
  for (let m = decl.exec(LIVE); m !== null; m = decl.exec(LIVE)) {
    if (Number(m[2]) < 0.03) continue; // a near-neutral carries no hue to speak of
    hues.add(Math.round(Number(m[3]) / 30) * 30);
  }
  assert.ok(hues.size <= 4, `the panel now carries ${String(hues.size)} hue families: ${[...hues].sort((a, b) => a - b).join(', ')}`);
});

ok('a fill takes the band median and a hairline takes its peak - never one token for both', () => {
  /*
   * `--am-gold` was doing both jobs, so every gold rail and every gold word on
   * the panel arrived at the same value - the peak - and there were six or
   * seven of them at once against the spec's "gold appears at most twice per
   * screen". Splitting the token is what lets the rails stay bright while the
   * words come down to the fill.
   */
  const fill = tokenOf('am-gold');
  const edge = tokenOf('am-gold-edge');
  assert.ok(fill && edge, 'the gold fill and edge are not both defined');
  assert.ok(edge.L - fill.L > 0.15, `the edge is only ${(edge.L - fill.L).toFixed(3)} lighter than the fill; they have collapsed back together`);

  // And the fill must actually be used as a fill: a `color:` somewhere.
  assert.ok(/color:\s*var\(--am-gold\)/.test(LIVE), '--am-gold is defined but never used to paint anything');
  assert.ok(/var\(--am-gold-edge\)/.test(LIVE), '--am-gold-edge is defined but nothing wears it');
});

ok('the third ink level is used, because it is what makes a caveat recede', () => {
  /*
   * The game has an ink for a thing that is not actionable - measured 0.496 off
   * "Requires Melee Arcane Adapter" - and the overlay had nothing at that
   * level: four lines of caveat arrived at the same weight as the instruction,
   * which is what made the column read as a form rather than as a thing to do.
   *
   * It also replaced two `opacity` dimmings, and that is the part worth
   * gating. An opacity multiplies against WHATEVER IS BEHIND, and behind this
   * overlay is the game's own art - so the same rule drew one colour over the
   * dark gutter and another over a lit mod card. A measured colour holds still.
   */
  assert.ok(tokenOf('am-ink-off'), '--am-ink-off is not defined');
  /*
   * A RATCHET, AND THREE WAS TOO LOOSE. Six elements wear this ink; a sabotage
   * that removed ONE passed the check at `>= 3`, which means half of them could
   * have gone back to instruction weight silently. The bound sits one below
   * what is really there, so a deliberate refactor of a single element still
   * passes and a drift back does not.
   */
  const uses = (LIVE.match(/var\(--am-ink-off\)/g) ?? []).length;
  assert.ok(uses >= 5, `only ${String(uses)} element(s) use the unactionable ink; the caveats are back at instruction weight`);

  // No opacity dimming on anything that carries text over the game's art.
  const dimmed: string[] = [];
  for (const block of LIVE.split('}')) {
    const sel = block.slice(0, block.indexOf('{')).trim();
    if (!sel.startsWith('.am-')) continue;
    const m = /opacity:\s*(0\.\d+)/.exec(block);
    if (m !== null && /color:|font-size|letter-spacing/.test(block)) dimmed.push(`${sel} { opacity: ${m[1]!} }`);
  }
  assert.deepEqual(dimmed, [], `text dimmed by opacity over the game's art rather than by a measured ink:\n        ${dimmed.join('\n        ')}`);
});

console.log('\nthe budget, kept as a guard rather than claimed as a diagnosis');

ok('the bright budget is recorded with the game\'s own measured shares', () => {
  assert.ok(BRIGHT_BUDGET.over192 > 0.01 && BRIGHT_BUDGET.over192 < 0.02, `over192 is ${String(BRIGHT_BUDGET.over192)}`);
  assert.ok(BRIGHT_BUDGET.over128 > BRIGHT_BUDGET.over160 && BRIGHT_BUDGET.over160 > BRIGHT_BUDGET.over192, 'the budget is not monotone');
  assert.ok(BRIGHT_BUDGET.medianLuma < 30, `the game is dark: median ${String(BRIGHT_BUDGET.medianLuma)}`);
  /*
   * The honest note, asserted so it cannot be quietly deleted: this measure did
   * not find the defect and must not be described as though it had.
   */
  const mod = readFileSync(new URL('../src/ui/game-palette.ts', import.meta.url), 'utf8');
  assert.ok(mod.includes('THIS WAS NOT WHAT WAS WRONG'), 'the correction about what the budget did NOT diagnose has been removed');
});

console.log('');
if (failures === 0) console.log(`the overlay is the game's colour  (${String(checks)} checks)`);
assert.equal(failures, 0, `${String(failures)} palette rule(s) broken`);
