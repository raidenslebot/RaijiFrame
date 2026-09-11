/**
 * Self-check for the modding-screen session machine.
 *
 * WHAT THIS FILE IS ACTUALLY FOR
 * ──────────────────────────────
 * The machine's job is to say what it saw and nothing more. Its failure modes
 * are all inventions: an open counted twice because the arsenal path logs it
 * twice, a slot attached to the wrong visit, a close that conjures an open, a
 * placement-then-removal that reads as a placement. None of these throw. So
 * every check here feeds a REAL line sequence - the same fixtures the parser is
 * gated on - and asserts the shape of the session that comes out.
 *
 * Run: node scripts/check-automod.ts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parseLine, type LogEvent } from '../src/core/eelog.ts';
import { IDLE, fold, netEdits, step, type Session, type UpgradeSlot } from '../src/data/automod-session.ts';
import { CARD, GRID, GRID_SLOTS_SHOWN, MEASURED_AT, asideBox, fullBox, slotBox, type Box } from '../src/data/automod-place.ts';
import { resolveIn } from '../src/data/build.ts';
import { categoryForModClass, categoryOpen, learnSlot, lessonFrom, loadLearnedSlots } from '../src/data/slot-learning.ts';
import type { RawAccount } from '../src/data/account.ts';

let checks = 0;
let failures = 0;

function ok(label: string, fn: () => void): void {
  checks++;
  try {
    fn();
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${label}\n        ${(err as Error).message.split('\n')[0]}`);
  }
}

/** Real line shapes. Timestamps arranged so the machine's windows are exercised. */
const L = {
  hoverSlot: '5957.760 Script [Info]: LoadOutRedux.lua: _T.upgradeItemSlot (RefreshStatList): \t3',
  pressSlot: '5958.259 Script [Info]: LoadOutRedux.lua: _T.upgradeItemSlot (_Mod): \t3',
  goTo: '5958.275 Script [Info]: LoadOutRedux.lua: Background::GoToScreen(screenName=UpgradeCards)',
  created: '5958.295 Sys [Info]: Created /Lotus/Interface/DiegeticUpgradeCards.swf',
  visible: '5958.812 Script [Info]: DiegeticUpgradeCards.lua: DBG: HudVis 1',
  place: '5990.101 Script [Info]: DiegeticUpgradeCards.lua: mod: True Steel - installed: true (/Lotus/Upgrades/Mods/Melee/WeaponCritChanceMod)',
  lift: '5990.102 Script [Info]: DiegeticUpgradeCards.lua: mod: True Steel - installed: false (/Lotus/Upgrades/Mods/Melee/WeaponCritChanceMod)',
  placeOther: '5991.000 Script [Info]: DiegeticUpgradeCards.lua: mod: Organ Shatter - installed: true (/Lotus/Upgrades/Mods/Melee/WeaponCritDamageMod)',
  fusion: 'Endo <FUSION_POINTS>15,330\rCredits <CREDITS>740,439',
  saved: '6020.864 Script [Info]: LoadOutRedux.lua: OnSaveLoadOutCompleteCommon',
  slots:
    '6695.781 Sys [Info]: Slots: AP_UNIVERSAL|AP_UNIVERSAL|AP_UNIVERSAL|AP_ATTACK|AP_UNIVERSAL|AP_UNIVERSAL|AP_TACTIC|AP_ATTACK|AP_ATTACK|AP_UNIVERSAL|AP_UNIVERSAL|',
  capacity: 'Initial Capacity: 30|IronPhoenixMeleeTree+4',
  mods: 'Modded Capacity: 34|WeaponMeleeStatusChanceSPMod-11|WeaponMeleeDamageModExpert-7\r',
  drain: 'Final Mod Drain: 4',
  closed: '6700.500 Script [Info]: DiegeticUpgradeCards.lua: Background::GoToPreviousScreen(skipScreens=nil)',
  // The other entry path: no slot line, no GoToScreen, HudVis 2.
  createdLater: '7234.809 Sys [Info]: Created /Lotus/Interface/DiegeticUpgradeCards.swf',
  visibleLater: '7235.400 Script [Info]: DiegeticUpgradeCards.lua: DBG: HudVis 2',
  // A slot press long before an open: must not attach.
  staleSlot: '7200.000 Script [Info]: LoadOutRedux.lua: _T.upgradeItemSlot (_Mod): \t1',
};

function events(...lines: string[]): LogEvent[] {
  const out: LogEvent[] = [];
  for (const l of lines) {
    const e = parseLine(l);
    if (e) out.push(e);
  }
  return out;
}

console.log('\nthe arsenal path');

ok('press, two open lines, visible: ONE open with the slot attached', () => {
  const s = fold(events(L.hoverSlot, L.pressSlot, L.goTo, L.created, L.visible));
  assert.equal(s.phase, 'visible');
  assert.equal(s.slot, 3);
  assert.equal(s.openedAt, 5958.275, 'the first open line is the open');
  assert.equal(s.seenWithoutOpen, false);
});

ok('hovering a slot is not pressing it', () => {
  const s = fold(events(L.hoverSlot, L.goTo, L.created));
  assert.equal(s.slot, null, 'RefreshStatList attached as the slot');
});

ok('the second open line twenty milliseconds later does not reset the session', () => {
  const opened = fold(events(L.pressSlot, L.goTo));
  const pending = { slot: null, slotAt: null, unrecognised: null };
  const again = step(opened, events(L.created)[0]!, pending);
  assert.equal(again, opened, 'a repeat open within a second must return the same object');
});

console.log('\nthe other path');

ok('an open with no slot line is a session with slot null, not an error', () => {
  const s = fold(events(L.createdLater, L.visibleLater));
  assert.equal(s.phase, 'visible');
  assert.equal(s.slot, null);
  assert.equal(s.seenWithoutOpen, false);
});

ok('a slot pressed long before an open does not attach to it', () => {
  const s = fold(events(L.staleSlot, L.createdLater));
  assert.equal(s.slot, null, 'a 34-second-old press was attached');
});

console.log('\nediting');

ok('placements accumulate in order, and a place-then-lift nets to nothing', () => {
  const s = fold(events(L.pressSlot, L.created, L.visible, L.place, L.lift, L.placeOther));
  assert.equal(s.phase, 'editing');
  assert.equal(s.edits.length, 3);
  const net = netEdits(s.edits);
  assert.deepEqual(net.placed, ['/Lotus/Upgrades/Mods/Melee/WeaponCritDamageMod']);
  assert.deepEqual(net.lifted, ['/Lotus/Upgrades/Mods/Melee/WeaponCritChanceMod']);
});

ok('a fusion cost is kept with the session it was quoted in', () => {
  const s = fold(events(L.pressSlot, L.created, L.fusion));
  assert.deepEqual(s.fusions, [{ endo: 15330, credits: 740439 }]);
});

console.log('\nsaving and the dump');

ok('save then the four dump lines assemble into one build', () => {
  const s = fold(events(L.pressSlot, L.created, L.visible, L.place, L.saved, L.slots, L.capacity, L.mods, L.drain));
  assert.equal(s.phase, 'saved');
  assert.ok(s.dump);
  assert.equal(s.dump?.polarities.length, 11);
  assert.equal(s.dump?.initial, 30);
  assert.equal(s.dump?.stance, 'IronPhoenixMeleeTree');
  assert.equal(s.dump?.stanceBonus, 4);
  assert.equal(s.dump?.capacity, 34);
  assert.deepEqual(s.dump?.mods.map((m) => m.drain), [11, 7]);
});

ok('the next open clears the edits and the dump', () => {
  const s = fold(events(L.pressSlot, L.created, L.place, L.saved, L.slots, L.capacity, L.mods, L.closed, L.createdLater));
  assert.equal(s.phase, 'opened');
  assert.deepEqual(s.edits, []);
  assert.equal(s.dump, null);
  assert.equal(s.slot, null, 'the previous visit\'s slot leaked into the next');
});

console.log('\nthe tail joins late');

ok('a close with no open stays idle and says it saw one', () => {
  const s = fold(events(L.closed));
  assert.equal(s.phase, 'idle');
  assert.equal(s.seenWithoutOpen, true);
});

ok('visible before any open reports visible, not a fabricated open', () => {
  const s = fold(events(L.visible));
  assert.equal(s.phase, 'visible');
  assert.equal(s.openedAt, null, 'an open time was invented');
  assert.equal(s.seenWithoutOpen, true);
});

ok('a placement with no open is recorded and flagged, never dropped', () => {
  const s = fold(events(L.place));
  assert.equal(s.phase, 'editing');
  assert.equal(s.edits.length, 1);
  assert.equal(s.seenWithoutOpen, true);
});

ok('events that are not the arsenal\'s return the identical session object', () => {
  const pending = { slot: null, slotAt: null, unrecognised: null };
  const e = parseLine('164.957 Script [Info]: EndOfMatch.lua: Mission Succeeded');
  assert.ok(e);
  const s: Session = { ...IDLE, phase: 'visible' };
  assert.equal(step(s, e, pending), s);
});

console.log('\nwhere the overlay puts itself');

/**
 * What the game draws AROUND its mod grid, measured on the same 1680 x 1050
 * capture. Nothing the overlay positions may touch any of it.
 *
 * The two right-hand mod CARDS used to be in this list, back when the overlay
 * was a strip that had to keep out of the grid's way. They are deliberately not
 * here now: the grid is the thing the overlay draws ON, so a slot box reaching
 * a game card is the design working rather than a collision. What would be a
 * real defect is a slot box reaching one of these four, which would mean the
 * grid had drifted off the cards entirely - and that is what is asserted.
 */
const OCCUPIED: ReadonlyArray<Box & { what: string }> = [
  { what: 'arcane slot', left: 1425, top: 225, width: 110, height: 105 },
  { what: 'COMBOS button', left: 1218, top: 238, width: 197, height: 22 },
  { what: 'tray, from its top rule', left: 0, top: 600, width: 1680, height: 450 },
  { what: 'stats column', left: 85, top: 150, width: 370, height: 440 },
];

/**
 * And the two right-hand cards of the game's own grid, kept as a POSITIVE
 * check: slots 3 and 7 must land on them. Measured off the capture the same
 * way. This is the assertion that would catch the grid drifting, which an
 * "avoids everything" test no longer can.
 */
const GAME_CARDS: ReadonlyArray<Box & { what: string; slot: number }> = [
  { what: 'Gladiator Rush card', slot: 3, left: 1170, top: 345, width: 195, height: 110 },
  { what: 'Melee Prowess card', slot: 7, left: 1170, top: 460, width: 195, height: 110 },
];

function intersects(a: Box, b: Box): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

/*
 * THE OVERLAY COVERS THE SCREEN NOW, so "does the box avoid the game's own
 * rectangles" is no longer the question - the answer is no, deliberately.
 *
 * The load-bearing claim of the new shape is instead that the eight slot
 * rectangles land ON the game's own eight mod slots, because the whole design
 * rests on the perfect build being drawn where the player's build already is.
 * These were measured off the capture and then verified by drawing them back
 * over it, and this is what stops them drifting.
 */
ok('the window covers the game area exactly, and an unreported area is empty not negative', () => {
  assert.deepEqual(fullBox(MEASURED_AT), { left: 0, top: 0, width: 1680, height: 1050 });
  assert.deepEqual(fullBox({ width: 0, height: 0 }), { left: 0, top: 0, width: 0, height: 0 });
});

ok('the eight slot boxes are the grid measured off the capture', () => {
  assert.equal(GRID_SLOTS_SHOWN, 8);
  const first = slotBox(0, MEASURED_AT);
  // Rounded, because a 201-wide card centred on an integer lands on a half pixel
  // and the box is in whole screen pixels.
  assert.deepEqual(first, {
    left: Math.round(GRID.firstCentreX - CARD.width / 2),
    top: Math.round(GRID.firstCentreY - CARD.height / 2),
    width: CARD.width,
    height: CARD.height,
  });
  // The pitch, read off the boxes rather than restated: column 1 is one step
  // right of column 0, and row 1 is one step below it.
  assert.equal(slotBox(1, MEASURED_AT).left - first.left, GRID.pitchX);
  assert.equal(slotBox(4, MEASURED_AT).top - first.top, GRID.pitchY);
  // Four across then wrap, not eight across.
  assert.equal(slotBox(3, MEASURED_AT).top, first.top);
  assert.equal(slotBox(4, MEASURED_AT).left, first.left);
  // And the whole grid stays inside the screen it was measured on.
  for (let i = 0; i < GRID_SLOTS_SHOWN; i++) {
    const b = slotBox(i, MEASURED_AT);
    assert.ok(b.left >= 0 && b.top >= 0, `slot ${String(i)} started off-screen`);
    assert.ok(b.left + b.width <= MEASURED_AT.width && b.top + b.height <= MEASURED_AT.height, `slot ${String(i)} left the screen`);
  }
});

ok('the grid lands ON the game cards and touches nothing else the screen draws', () => {
  for (let i = 0; i < GRID_SLOTS_SHOWN; i++) {
    const b = slotBox(i, MEASURED_AT);
    for (const r of OCCUPIED) assert.equal(intersects(b, r), false, `slot ${String(i)} would cover the ${r.what}`);
  }
  /*
   * The positive half, and the one that actually pins the measurement: the two
   * game cards whose rectangles were read off the capture must be covered by
   * the slots that correspond to them, and covered SUBSTANTIALLY - a one-pixel
   * clip would satisfy `intersects` while the grid sat a card's width away.
   */
  for (const card of GAME_CARDS) {
    const b = slotBox(card.slot, MEASURED_AT);
    assert.equal(intersects(b, card), true, `slot ${String(card.slot)} missed the ${card.what}`);
    const overlapX = Math.min(b.left + b.width, card.left + card.width) - Math.max(b.left, card.left);
    const overlapY = Math.min(b.top + b.height, card.top + card.height) - Math.max(b.top, card.top);
    const share = (overlapX * overlapY) / (card.width * card.height);
    assert.ok(share > 0.85, `slot ${String(card.slot)} covers only ${(share * 100).toFixed(1)} % of the ${card.what}`);
  }
});

ok('the overlap test itself sees an overlap', () => {
  assert.equal(intersects({ left: 0, top: 0, width: 10, height: 10 }, { left: 9, top: 9, width: 10, height: 10 }), true);
  assert.equal(intersects({ left: 0, top: 0, width: 10, height: 10 }, { left: 10, top: 0, width: 10, height: 10 }), false);
});

ok('the aside still sits in the empty column and covers nothing', () => {
  assert.deepEqual(asideBox(MEASURED_AT), { left: 1372, top: 335, width: 300, height: 263 });
  const box = asideBox(MEASURED_AT);
  for (const r of OCCUPIED) assert.equal(intersects(box, r), false, `the aside would cover the ${r.what}`);
  // And it never overlaps the grid it sits beside.
  for (let i = 0; i < GRID_SLOTS_SHOWN; i++) {
    assert.equal(intersects(box, slotBox(i, MEASURED_AT)), false, `the aside would cover slot ${String(i)}`);
  }
});

ok('the grid follows the screen centre, not its left edge', () => {
  /*
   * The game centres the grid, so an offset measured from the left would drift
   * on any other aspect. At 2560 x 1440 the grid must scale with HEIGHT and
   * stay centred: slot 0 sits the same distance left of centre, scaled.
   */
  const wide = { width: 2560, height: 1440 };
  const scale = wide.height / MEASURED_AT.height;
  const b = slotBox(0, wide);
  const centreOffset = GRID.firstCentreX - MEASURED_AT.width / 2;
  assert.equal(Math.round(b.left + b.width / 2), Math.round(wide.width / 2 + centreOffset * scale));
  assert.equal(b.width, Math.round(CARD.width * scale), 'the card did not scale with the screen');
  for (let i = 0; i < GRID_SLOTS_SHOWN; i++) {
    const w = slotBox(i, wide);
    assert.ok(w.left >= 0 && w.left + w.width <= wide.width, `slot ${String(i)} left a 16:9 screen`);
  }
  const a = asideBox(wide);
  assert.ok(a.left + a.width <= wide.width && a.top + a.height <= wide.height, 'the aside left the screen');
});

ok("the aside is the GAME's column at every aspect ratio, not whatever is left of the screen", () => {
  /*
   * A DEFECT THAT ONLY EXISTS OFF 16:10, WHICH IS WHY IT SURVIVED.
   *
   * The width was `area.width - 8 - left` - everything from the column's start
   * to the right edge of the screen. At 1680 x 1050 that is exactly 300,
   * because 1680 is the width it was measured at. It looked right, and was
   * wrong everywhere else:
   *
   *   1920 x 1080  16:9        405 px
   *   2560 x 1080  21:9        725 px
   *   3440 x 1440  21:9        982 px
   *   5120 x 1440  32:9      1,822 px
   *
   * A line of type eighteen hundred pixels wide is not a column, and every
   * measurement the overlay makes against this box - how many missing mods fit,
   * how many assumptions - was being made against a box that had the right size
   * on exactly one monitor.
   *
   * The grid was never wrong: it anchors to the screen's CENTRE and scales by
   * height, which is how the game scales its own interface. The gap from the
   * last card to this column stays 7-10 px from 4:3 to 32:9, measured, and that
   * agreement is what says the two are placed by the same rule.
   */
  const DESIGN = MEASURED_AT.width - 8 - 1372;
  for (const [w, h] of [
    [1680, 1050],
    [1920, 1080],
    [2560, 1080],
    [3440, 1440],
    [5120, 1440],
    [1280, 720],
  ] as const) {
    const area = { width: w, height: h };
    const scale = h / MEASURED_AT.height;
    const aside = asideBox(area);
    const want = Math.round(DESIGN * scale);
    assert.equal(aside.width, want, `${String(w)}x${String(h)}: the column is ${String(aside.width)} px, not the game's ${String(want)}`);
    assert.ok(aside.left + aside.width <= w, `${String(w)}x${String(h)}: the column runs ${String(aside.left + aside.width - w)} px off the screen`);

    // The grid and the column must agree: the last card ends just before it starts.
    const last = slotBox(3, area);
    const gap = aside.left - (last.left + last.width);
    assert.ok(gap >= 0 && gap <= 16 * scale, `${String(w)}x${String(h)}: the gap from the grid to the column is ${String(Math.round(gap))} px`);
  }

  /*
   * A screen too narrow for the full column takes what there is rather than
   * running off the edge. 1280 x 960 is that case: the column wants 274 px and
   * 146 are left.
   */
  const narrow = asideBox({ width: 1280, height: 960 });
  assert.ok(narrow.width > 0 && narrow.left + narrow.width <= 1280, 'the narrow case runs off the screen');
  assert.ok(narrow.width < Math.round(DESIGN * (960 / MEASURED_AT.height)), 'the narrow case was not clamped, so the clamp is untested');
});

ok('the overlay can never print NaN or a sideways eight, whatever reaches it', () => {
  /*
   * MEASURED ON THE RUNNING OVERLAY, not imagined: fed a degenerate score it
   * printed "SUSTAINED DPS NaN" and "ENDO NaN CR NaN" over the player's game,
   * and a negative figure gave the progress meter `scaleX(-0.06)` - a bar
   * growing the wrong way out of its own left edge.
   *
   * `Math.round(NaN).toLocaleString()` is the string "NaN" and
   * `Infinity.toLocaleString()` is a sideways eight, so the default rendering
   * of a broken number is a broken number on somebody's screen. The whole
   * doctrine of this app is that it never shows a figure it cannot stand
   * behind, and the honest rendering of one it does not have is the same em
   * dash it already uses for an unread purse.
   *
   * Zero is NOT the honest answer, and was the first fix: NaN is obviously
   * broken, while "0" is a claim - that the build does no damage at all -
   * stated in the same typeface as every figure the app means.
   *
   * This re-states the render boundary rather than importing it: `automod.tsx`
   * is a React module and importing it here would pull in the DOM.
   */
  const figure = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '\u2014');
  const src = readFileSync(new URL('../src/app/automod.tsx', import.meta.url), 'utf8');
  assert.ok(
    src.includes("const figure = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '\\u2014');"),
    'the render boundary changed; re-state it here before trusting anything below',
  );

  for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(figure(v), '\u2014', `${String(v)} reached the screen as a number`);
  }
  /*
   * AND THE COUNT-UP HAS TO HAND IT THROUGH. `Figure` is
   * `figure(useCountUp(value))`, and the hook interpolates toward a guarded
   * target - so without this line a NaN arrives at `figure` as 0 and the
   * overlay prints a confident "0" instead of the dash. That was the first fix
   * and it was the wrong one: zero is a claim, not an absence.
   */
  assert.ok(src.includes('if (!Number.isFinite(value)) return value;'), 'the count-up no longer hands a broken figure through, so it will render as 0');

  // And a real figure is unharmed, or the guard has eaten the feature.
  assert.equal(figure(5960), '5,960');
  assert.equal(figure(0), '0');
  assert.equal(figure(-500), '-500');

  /*
   * The meter is clamped at BOTH ends. The upper clamp was there; the lower was
   * not, and nothing upstream forbids a negative score.
   */
  const reach = (now: number, ideal: number): number => {
    const ratio = ideal > 0 ? now / ideal : 0;
    return Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  };
  assert.ok(src.includes('Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0'), 'the meter clamp changed; re-state it here');
  for (const [now, ideal] of [
    [-500, 8033],
    [Number.NaN, 8033],
    [5960, 0],
    [0, 0],
    [16066, 8033],
    [5960, 8033],
  ] as const) {
    const r = reach(now, ideal);
    assert.ok(r >= 0 && r <= 1, `reach(${String(now)}, ${String(ideal)}) is ${String(r)}, which is outside the bar`);
  }
});

ok('the panel names ONE destination, and every part of it reads the same number', () => {
  /*
   * FOUND BY LOOKING AT IT, WHICH IS WHY THIS EXISTS.
   *
   * The aside carried two destinations at once: a headline reading "2,055 to
   * 4,049" and, four lines below it, the ladder's "2,816 of 5,203", with
   * nothing to say why they disagreed. Both were correct - one was the best
   * build the account's CURRENT grid allows, the other what the item can ever
   * be - and a player reading the panel has no way to know that. The bar under
   * the headline was measured against a third reading of the same question.
   *
   * The class on that figure has said `am-ceiling` since the day it was
   * written, so the fix was to make the value match the name. The check is
   * cheap and the defect was invisible in a diff: three expressions in three
   * places, each defensible on its own.
   */
  const src = readFileSync(new URL('../src/app/automod.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\/.*/g, ' ');

  assert.ok(
    /<Figure value=\{plan\.ceiling\.score\.value\} className="am-ceiling"/.test(src),
    'the figure labelled am-ceiling is not the ceiling, so the panel states a destination the ladder disagrees with',
  );
  assert.ok(
    /const ratio = plan && plan\.ceiling\.score\.value > 0 \? plan\.now\.score\.value \/ plan\.ceiling\.score\.value/.test(src),
    'the meter is measured against something other than the figure printed beside it',
  );
  /*
   * The ladder's destination is drawn on the meter rather than written under
   * the instruction - the text version overflowed the column and flexbox paid
   * for it by crushing the aura line and the honesty footer. So the assertion
   * follows it there: the projection segment must be a fraction of the SAME
   * ceiling, or the bar would carry two scales in one 2 px strip and nothing
   * on screen could tell them apart.
   */
  assert.ok(
    /nextValue \/ plan\.ceiling\.score\.value/.test(src),
    "the meter's projection is not a fraction of the ceiling the headline names",
  );
  assert.ok(
    /<u style=\{\{ transform: `scaleX\(\$\{String\(nextReach\)\}\)` \}\} \/>/.test(src),
    'the meter no longer draws where the next step lands',
  );

  /*
   * AND NOTHING IS DRAWN ON THE GAME'S OWN CARDS, which is the opposite of what
   * this check used to demand.
   *
   * The overlay marked card `i` with `plan.ideal.placed[i]`, and the player's
   * screenshot is what showed the cost: the ideal's order is the beam's, not the
   * screen's, so every plate landed by coincidence - and it landed ON the game's
   * card name, 35 px of a 104 px card, measured. The account cannot rescue it
   * either: read live off the unranked Ankyros on that screen,
   * `Configs[0].Upgrades` holds Reach at index 6 and Primed Pressure Point at
   * index 7 while the GAME drew Primed Pressure Point first and Reach second.
   *
   * So the rule is now the plain one: the overlay does not draw on the grid at
   * all. If someone pins the array's order to the screen's - one capture and one
   * account read at the same instant - this can come back placed for real, and
   * this check is where to say so.
   */
  assert.ok(!/<ModGrid/.test(src), 'the overlay is marking the game\'s own cards again, and nothing in the app knows which card is which');
  assert.ok(!/am-peek/.test(src), 'the hover card is back without a grid to hover');
  assert.ok(!/all marked on the grid/.test(src), 'the panel still points at marks that are not drawn');
});

ok('every kind of thing on the account resolves, not only the four the arsenal shows', () => {
  /*
   * THE OTHER HALF OF COVERAGE, and it was a table rather than an algorithm.
   *
   * `resolveBuild` hardcoded two lookups per category - a preset key and one
   * equipment bin - for warframe, primary, secondary and melee. Everything else
   * the account carries was unreachable, not because the data is absent but
   * because nothing knew where to look. `inventory-schema.md` had already
   * recorded all three coordinates from DE's own sources: the preset GROUPS
   * (`ARCHWING`, `SENTINEL`, `MECH`), the config KEYS (`s` `l` `p` `m`), and
   * the equipment BINS, which DE's `productCategory` field names verbatim.
   *
   * The account below is built to that shape. Each category is driven end to
   * end and has to come back with the right item, because a table transcribed
   * from a document is exactly the thing that is wrong in one cell and silent
   * about it.
   */
  const id = (v: string) => ({ $oid: v });
  const equip = (oid: string, type: string) => ({
    ItemId: id(oid),
    ItemType: type,
    // 40,000 affinity, chosen so the two curves DIFFER and neither has hit the
    // cap: 100/rank puts a weapon at 20, 200/rank puts a vehicle at 14. At
    // 900,000 both sit at 30 and the check could not tell them apart.
    XP: 40_000,
    Polarized: 0,
    Polarity: [{ Slot: 0, Value: 'AP_ATTACK' as const }],
    Configs: [{ Upgrades: ['mod-1'] }],
  });

  /*
   * ONE ACTIVE PRESET PER GROUP, WITH A DIFFERENT ID EACH.
   *
   * The first version of this fixture gave every group the SAME id and a
   * one-element `CurrentLoadOutIds` - which is the assumption under test,
   * encoded in the test. `inventory-schema.md` §3 records the array as ordered
   * by DE's `eLoadoutIndex`: NORMAL 0, SENTINEL 1, ARCHWING 2, NORMAL_PVP 3,
   * LUNARO 4, OPERATOR 5, KDRIVE 6, DATAKNIFE 7, MECH 8. Distinct ids are what
   * make this prove that each category reads ITS OWN entry: with one shared id
   * every index would work, including the wrong one.
   *
   * The gaps are `undefined` on purpose - a real account's array is sparse in
   * the groups the player has never used, and index 8 has to be reachable past
   * them.
   */
  const ids: Array<{ $oid: string } | undefined> = [];
  ids[0] = id('loadout-normal');
  ids[1] = id('loadout-sentinel');
  ids[2] = id('loadout-archwing');
  ids[8] = id('loadout-mech');
  const acc = {
    CurrentLoadOutIds: ids,
    LoadOutPresets: {
      NORMAL: [{ ItemId: id('loadout-normal'), s: { ItemId: id('frame') }, l: { ItemId: id('rifle') }, p: { ItemId: id('pistol') }, m: { ItemId: id('sword') } }],
      ARCHWING: [{ ItemId: id('loadout-archwing'), s: { ItemId: id('wing') }, l: { ItemId: id('archgun') }, m: { ItemId: id('archmelee') } }],
      SENTINEL: [{ ItemId: id('loadout-sentinel'), s: { ItemId: id('kavat') }, l: { ItemId: id('sentgun') } }],
      MECH: [{ ItemId: id('loadout-mech'), s: { ItemId: id('mech') } }],
    },
    Suits: [equip('frame', '/Lotus/Powersuits/Excalibur/Excalibur')],
    LongGuns: [equip('rifle', '/Lotus/Weapons/Tenno/Rifle/Rifle')],
    Pistols: [equip('pistol', '/Lotus/Weapons/Tenno/Pistol/Pistol')],
    Melee: [equip('sword', '/Lotus/Weapons/Tenno/Melee/LongSword/LongSword')],
    SpaceSuits: [equip('wing', '/Lotus/Powersuits/Archwing/SupportJetPack/SupportJetPack')],
    SpaceGuns: [equip('archgun', '/Lotus/Weapons/Tenno/Archwing/Primary/LaunchGrenade/ArchCannon')],
    SpaceMelee: [equip('archmelee', '/Lotus/Weapons/Tenno/Archwing/Melee/Archsword/ArchSwordWeapon')],
    // A KAVAT, so the three-bin search has to look past the first bin.
    Sentinels: [equip('carrier', '/Lotus/Types/Sentinels/SentinelPowersuits/CarrierPowerSuit')],
    KubrowPets: [equip('kavat', '/Lotus/Types/Game/CatbrowPet/MirrorCatbrowPetPowerSuit')],
    SentinelWeapons: [equip('sentgun', '/Lotus/Types/Friendly/Pets/ZanukaPets/ZanukaPetMeleeWeaponPS')],
    MechSuits: [equip('mech', '/Lotus/Powersuits/EntratiMech/ThanoTech')],
    // `oidOf` reads `$oid`/`$id`, and the config's Upgrades array holds the
    // bare oid strings - the same two shapes a real account uses.
    Upgrades: [{ ItemId: id('mod-1'), ItemType: '/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod', UpgradeFingerprint: '{"lvl":5}' }],
  } as unknown as RawAccount;

  const WANT: Array<[Parameters<typeof resolveIn>[1], string]> = [
    ['warframe', '/Lotus/Powersuits/Excalibur/Excalibur'],
    ['primary', '/Lotus/Weapons/Tenno/Rifle/Rifle'],
    ['secondary', '/Lotus/Weapons/Tenno/Pistol/Pistol'],
    ['melee', '/Lotus/Weapons/Tenno/Melee/LongSword/LongSword'],
    ['archwing', '/Lotus/Powersuits/Archwing/SupportJetPack/SupportJetPack'],
    ['arch-gun', '/Lotus/Weapons/Tenno/Archwing/Primary/LaunchGrenade/ArchCannon'],
    ['arch-melee', '/Lotus/Weapons/Tenno/Archwing/Melee/Archsword/ArchSwordWeapon'],
    ['companion', '/Lotus/Types/Game/CatbrowPet/MirrorCatbrowPetPowerSuit'],
    ['companion-weapon', '/Lotus/Types/Friendly/Pets/ZanukaPets/ZanukaPetMeleeWeaponPS'],
    ['necramech', '/Lotus/Powersuits/EntratiMech/ThanoTech'],
  ];

  for (const [category, itemType] of WANT) {
    const r = resolveIn(acc, category);
    assert.equal(r.unknown, null, `${category} stopped at ${String(r.unknown)}: ${String(r.reason)}`);
    assert.equal(r.itemType, itemType, `${category} resolved to the wrong item`);
    assert.equal(r.category, category);
    assert.equal(r.installed?.length, 1, `${category} lost its installed mods`);
    assert.equal(r.installed?.[0]?.rank, 5, `${category} lost the installed mod's rank`);
  }

  /*
   * The rank curve. Frames, vehicles and companions are 200 affinity a rank and
   * weapons 100 - `mastery.ts` says so - and the old code tested
   * `category === 'warframe'`, which would have under-ranked every one of the
   * new classes by a factor the player would have felt as a wrong capacity.
   */
  const frameLike = resolveIn(acc, 'archwing').rankLifetime;
  const weaponLike = resolveIn(acc, 'arch-gun').rankLifetime;
  assert.ok(frameLike !== null && weaponLike !== null, 'a rank did not resolve');
  assert.ok(
    weaponLike > frameLike,
    `at the same 40,000 affinity a weapon should out-rank a vehicle (${String(weaponLike)} vs ${String(frameLike)}); the vehicle is being ranked on the weapon curve`,
  );

  // And a group the account does not carry says which group, not "no presets".
  const noMech = resolveIn({ ...acc, LoadOutPresets: { NORMAL: acc.LoadOutPresets?.NORMAL } } as RawAccount, 'necramech');
  assert.equal(noMech.unknown, 'presets');
  assert.ok(noMech.reason?.includes('MECH'), `the failure does not name the group it looked in: ${String(noMech.reason)}`);

  /*
   * THE INDEX IS READ, NOT ASSUMED. Every category used to read
   * `CurrentLoadOutIds[0]`, which is right for the four arsenal ones and wrong
   * for all six added since - the NORMAL id would be hunted inside the ARCHWING
   * array and never found. Swapping two entries has to break exactly the two
   * categories that read them.
   */
  const swapped = [...ids];
  swapped[1] = ids[2];
  swapped[2] = ids[1];
  const crossed = { ...acc, CurrentLoadOutIds: swapped } as unknown as RawAccount;
  assert.equal(resolveIn(crossed, 'archwing').unknown, 'presets', 'the archwing resolved from the companion group, so the index is not being read');
  assert.equal(resolveIn(crossed, 'companion').unknown, 'presets', 'the companion resolved from the archwing group');
  assert.equal(resolveIn(crossed, 'warframe').unknown, null, 'swapping entries 1 and 2 broke the NORMAL group, which reads entry 0');
  assert.equal(resolveIn(crossed, 'necramech').unknown, null, 'swapping entries 1 and 2 broke MECH, which reads entry 8');

  // And the slot can no longer disagree with the category: it comes FROM it.
  assert.equal(resolveIn(acc, 'melee').slot, 3);
  assert.equal(resolveIn(acc, 'archwing').slot, null, 'a category with no arsenal row was given one');
});

ok('the arsenal row this app was not born knowing is LEARNED from the first mod placed', () => {
  /*
   * THE ONE INTEGER, AND WHY IT NEED NOT STAY UNKNOWN.
   *
   * `_T.upgradeItemSlot (_Mod): N` is the only line that says which arsenal row
   * was opened, and four values have a known meaning: the capture behind
   * `eelog-upgrade-screen.md` saw 0 and 3 and inferred 1 and 2. Whether a
   * companion or an archwing emits a fifth index has never been observed, and
   * every other piece for those classes - question, eligibility, resolution -
   * is built and gated. That integer was the whole of the gap.
   *
   * Guessing it is not available: "the rows are probably in arsenal order" is
   * the kind of plausible reasoning this app refuses everywhere else, and being
   * wrong means planning a Kubrow against an Archwing's mods silently.
   *
   * But a mod CANNOT be installed on a thing it is not compatible with. So the
   * catalogue class of the first mod placed on an unknown screen is the class
   * of the item, by the game's own rules - a deduction, not an inference from
   * layout. The player's first companion modding session answers it for good.
   */
  for (const [compat, category] of [
    ['COMPANION', 'companion'],
    ['ROBOTIC', 'companion'],
    ['BEAST', 'companion'],
    ['Kavat', 'companion'],
    ['Archwing', 'archwing'],
    ['Archgun', 'arch-gun'],
    ['Archmelee', 'arch-melee'],
    ['Necramech', 'necramech'],
  ] as const) {
    assert.equal(categoryForModClass(compat), category, `a ${compat} mod no longer identifies its screen`);
  }

  /*
   * AND THE CLASSES THAT IDENTIFY NOTHING MUST STAY NULL. `ANY` is the operator
   * and amp set - it would fit anything, which is exactly why it says nothing
   * about which row is open. A per-warframe augment says the frame's own name.
   * Reaching for a category from either is the guess this exists to avoid.
   */
  for (const nothing of ['ANY', 'Ash', 'Parazon', 'K-Drive', 'Tome', '', null, undefined]) {
    assert.equal(categoryForModClass(nothing), null, `"${String(nothing)}" was taken as naming an arsenal row`);
  }

  // Learning, and the storage it survives in.
  const store = new Map<string, string>();
  const shim = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.deepEqual(loadLearnedSlots(shim), {}, 'a fresh install claims to know something');
  const once = learnSlot({}, 4, 'companion', shim);
  assert.equal(once['4'], 'companion');
  assert.deepEqual(loadLearnedSlots(shim), { '4': 'companion' }, 'what was learned did not survive the write');
  const twice = learnSlot(once, 5, 'archwing', shim);
  assert.deepEqual(loadLearnedSlots(shim), { '4': 'companion', '5': 'archwing' }, 'the second lesson replaced the first');
  assert.equal(learnSlot(twice, 4, 'companion', shim), twice, 're-learning the same thing made a new object, so every mod placed republishes');

  /*
   * A STORED VALUE OUTLIVES THE CODE THAT WROTE IT. A category this build no
   * longer has would reach the resolution table as `undefined`, so the loader
   * validates rather than trusting its own past output.
   */
  const junk = { getItem: () => '{"4":"kdrive","x":"companion","6":7,"7":"archwing"}' };
  assert.deepEqual(loadLearnedSlots(junk), { '7': 'archwing' }, 'the loader trusts whatever storage holds');
  /*
   * AND THE PROTOTYPE CHAIN. The check used `category in CATEGORY_NAMES`, and
   * `in` walks the prototype - so 'toString', 'constructor' and '__proto__' all
   * passed validation, reached `WHERE[category]` as undefined, and threw inside
   * `publishAutomod` on every publish for the rest of the session.
   */
  const proto = { getItem: () => '{"4":"toString","5":"constructor","6":"__proto__","7":"hasOwnProperty"}' };
  assert.deepEqual(loadLearnedSlots(proto), {}, 'a prototype key survived validation and will reach the resolution table as undefined');
  assert.deepEqual(loadLearnedSlots({ getItem: () => 'not json' }), {}, 'unreadable storage throws instead of yielding nothing');
  assert.deepEqual(loadLearnedSlots(null), {}, 'no storage at all throws');

  /*
   * And the controller has to USE it: resolve by category, learn on a mod
   * placement, and only while the screen is one it could not read.
   */
  /*
   * THE TWO DECISIONS, DRIVEN. Both used to live in the controller and be
   * asserted about by reading its source for a substring - a check that a
   * `false &&` in front of the matched text walks straight past, which is
   * exactly what a sabotage proved. They are pure functions now.
   */
  const known = { '4': 'companion' as const };
  assert.equal(categoryOpen({ slot: 3, unreadSlot: null, learned: {} }), 'melee', 'a known slot stopped resolving');
  assert.equal(categoryOpen({ slot: 0, unreadSlot: null, learned: known }), 'warframe', 'a known slot stopped resolving when something had been learned');
  /*
   * Both set at once cannot happen - `step` writes one or the other from the
   * same press - but the function accepts both, and which wins has to be
   * pinned: a known index is knowledge, and a learned one is a deduction from a
   * mod placement. Knowledge wins.
   */
  assert.equal(categoryOpen({ slot: 0, unreadSlot: 4, learned: known }), 'warframe', 'a learned index overrode a slot the app already knew');
  assert.equal(categoryOpen({ slot: null, unreadSlot: 4, learned: known }), 'companion', 'A LEARNED SCREEN STILL RESOLVES TO NOTHING');
  assert.equal(categoryOpen({ slot: null, unreadSlot: 5, learned: known }), null, 'an index nothing was ever learned about was resolved anyway');
  assert.equal(categoryOpen({ slot: null, unreadSlot: null, learned: known }), null, 'an open with no slot line at all was given a category');

  assert.deepEqual(lessonFrom({ unreadSlot: 4, compatName: 'COMPANION' }), { index: 4, category: 'companion' }, 'NOTHING IS LEARNED FROM A MOD PLACEMENT');
  assert.deepEqual(lessonFrom({ unreadSlot: 6, compatName: 'Archgun' }), { index: 6, category: 'arch-gun' });
  assert.equal(lessonFrom({ unreadSlot: null, compatName: 'COMPANION' }), null, 'a screen the app CAN read was treated as something to learn from');
  assert.equal(lessonFrom({ unreadSlot: 4, compatName: 'ANY' }), null, 'a mod that fits anything was taken as naming a row');
  /*
   * THE WEAPON CLASSES MUST NOT TEACH. A sentinel weapon takes ordinary weapon
   * mods - a Deconstructor takes `Melee`, a Sweeper `Shotgun`, a Laser Rifle
   * `Rifle` - so modding a companion's gun on an unread row would have taught
   * this app that the row is `primary`, permanently and persisted. Every later
   * visit would then resolve the player's Braton and plan it while they were
   * looking at a Deconstructor.
   */
  for (const weapon of ['Rifle', 'Shotgun', 'Pistol', 'Melee', 'Bow', 'Sniper', 'PRIMARY', 'Swords', 'WARFRAME']) {
    assert.equal(
      lessonFrom({ unreadSlot: 4, compatName: weapon }),
      null,
      `a ${weapon} mod taught the app what an unread row is, but a companion weapon takes those too`,
    );
  }
  // And the classes that DO name one row still teach, or nothing is learnable.
  for (const [cls, cat] of [['COMPANION', 'companion'], ['Archgun', 'arch-gun'], ['Necramech', 'necramech'], ['Hound', 'companion'], ['Moa', 'companion']] as const) {
    assert.deepEqual(lessonFrom({ unreadSlot: 9, compatName: cls }), { index: 9, category: cat }, `${cls} no longer names its row`);
  }
  assert.equal(lessonFrom({ unreadSlot: 4, compatName: undefined }), null, 'a mod missing from the catalogue taught something anyway');

  // And the controller has to route through them, or none of it runs.
  const bg = readFileSync(new URL('../src/app/background.ts', import.meta.url), 'utf8');
  /*
   * The question is ASKED in `data/automod-publish.ts`, which is where a gate
   * can drive it, and the controller reaches it through that. Splitting the
   * check the same way is what stops either half passing alone - a controller
   * that asks nothing, or a decision nobody consults.
   */
  const publish = readFileSync(new URL('../src/data/automod-publish.ts', import.meta.url), 'utf8');
  assert.ok(/categoryOpen\(\{/.test(publish), 'the publish decision no longer asks which category is open');
  for (const field of ['slot: input.session.slot', 'unreadSlot: input.session.unreadSlot', 'learned: input.learned']) {
    assert.ok(publish.includes(field), `the publish decision stopped handing categoryOpen its ${field}`);
  }
  assert.ok(/publishDecision\(\{ session, learned \}\)/.test(bg), 'the controller no longer asks for the publish decision');
  assert.ok(/lessonFrom\(\{ unreadSlot: session\.unreadSlot/.test(bg), 'the controller never asks what a placement taught');
  /*
   * BOTH SIGNALS, because one of them needs the player to do nothing.
   *
   * A placement teaches at once, but a player can open a companion's mods,
   * look, and leave - which is exactly what happened the one time this account
   * opened an index past the four. `modOwned` is the card screen's own
   * duplicate warning, and measured on 548,446 lines of real log it fires
   * INSIDE an open and is filtered to the item: 58 lines on a melee screen,
   * every one melee-compatible. Dropping it means a screen that is only looked
   * at is never learned.
   */
  assert.ok(
    /event\.type === 'modInstalled' \|\| event\.type === 'modOwned'/.test(bg),
    'the controller learns only from a placement again, so a screen the player merely looks at teaches nothing',
  );
});

ok('the worst matchup reaches the panel, and survives a plan that predates the field', () => {
  /*
   * TWO WAYS THIS LINE FAILS AND ONLY ONE IS VISIBLE.
   *
   * It renders `plan.now.score.weakest`, which the objective fills in - and any
   * plan built before that field existed carries `undefined`, not null. The
   * first guard tested `!== null`, which `undefined` passes, and the WHOLE
   * OVERLAY went blank: "Cannot read properties of undefined (reading
   * against)". Not a missing line - a blank panel over the game, found by
   * loading the artboard, whose fixtures were captured months before the field.
   *
   * That is the stored-record rule this repo already carries, in a new place: a
   * field added to a published type is absent on everything published before
   * it, so it is repaired where it is READ.
   */
  const src = readFileSync(new URL('../src/app/automod.tsx', import.meta.url), 'utf8');
  assert.ok(/score\.weakest \?\? null/.test(src), 'the matchup is read without a fallback, so a plan that predates the field blanks the panel');
  /*
   * THE ROW MOVED INTO THE LEDGER, so the literal `className="am-weakest"` is
   * gone: the matchup is one entry in the stat table now, and the table writes
   * its own class attribute from a `className` field. What this gate is FOR is
   * unchanged - that the worst matchup reaches the panel at all - so it is
   * matched on the field that carries it, which is the thing a deletion would
   * actually remove. The CSS assertion below still pins the ink.
   */
  assert.ok(/className: 'am-weakest'/.test(src), 'nothing renders the matchup, so the objective computes it for nobody');
  assert.ok(/label: 'weakest'/.test(src), 'the matchup row has lost its label, so the figure arrives with nothing saying what it is');
  /*
   * It is qualified by the same measured floor the card uses - it costs a row.
   * The guard moved with the row: it used to be an early `return null` inside
   * an IIFE in `Aside` and is now the value handed to `StateLedger`, which
   * drops a row whose value is null. Same floor, same effect on the column, one
   * fewer closure.
   */
  assert.ok(
    /cardWidth < CARD_MIN_PX \? null :/.test(src),
    'the matchup line ignores the space floor and can push the column over its box',
  );

  const css = readFileSync(new URL('../src/styles/automod.css', import.meta.url), 'utf8');
  assert.ok(/\.am-weakest \{[^}]*--am-ink-off/s.test(css), 'the matchup is not in the unactionable ink, so a fact reads as a step');
});

ok('the mod card is drawn at a size it can be read at, or it is not drawn', () => {
  /*
   * THE CARD IS THE INSTRUCTION AND IT HAS A LEGIBILITY FLOOR.
   *
   * `ModCard` traces a real card in a 201-unit box, so every mark on it scales
   * with the rendered width: the polarity glyph is 10 units, which is under
   * four pixels once the card is below about seventy. The card takes a third of
   * the column and the column follows the screen, so at 1366 x 768 and
   * 1280 x 720 it would render 72 and 68 px - a stamp, not a card, occupying
   * the room the name and the route need.
   *
   * So `CardInstruction` refuses to draw one under `CARD_MIN_PX` and gives the
   * sentence instead. That is the honest trade at the small resolutions: the
   * panel is 206 x 180 at 1280 x 720 and there is not room for both a legible
   * card and legible words.
   *
   * Both halves are gated because either alone passes while the other is gone:
   * the arithmetic here, and the guard's presence in the component. Deleting
   * the guard ships an unreadable stamp at two of the five resolutions and no
   * number in this file moves.
   */
  const src = readFileSync(new URL('../src/app/automod.tsx', import.meta.url), 'utf8');
  const min = /export const CARD_MIN_PX = (\d+);/.exec(src);
  const share = /export const CARD_SHARE = ([0-9.]+);/.exec(src);
  assert.ok(min && share, 'the card floor and share are no longer declared');
  const CARD_MIN = Number(min[1]);
  const SHARE = Number(share[1]);
  /*
   * BOTH BRANCHES, and the first version of this counted one.
   *
   * The instruction is rendered from two places - the ladder's rung and the
   * not-owned fallback - and each draws its own card. Asserting the guard
   * EXISTS passed while it was deleted from one of them, because the other
   * still had it. The count is what makes the check about coverage.
   */
  const guards = (src.match(/cardWidth < CARD_MIN_PX/g) ?? []).length;
  assert.ok(guards >= 2, `only ${String(guards)} of the two instruction branches check the card floor, so an unreadable card ships from the other`);
  // The CSS has to agree with the share the floor is computed from.
  const css = readFileSync(new URL('../src/styles/automod.css', import.meta.url), 'utf8');
  assert.ok(new RegExp('width: ' + String(Math.round(SHARE * 100)) + '%').test(css), `the card's CSS width is not ${String(Math.round(SHARE * 100))}%, so the floor is computed from the wrong number`);

  /*
   * And the decision, across every resolution the panel is measured at. The
   * card is drawn on the three where it is legible and refused on the two where
   * it is not - stated as a table so a change to `asideBox` shows up as a
   * changed verdict rather than as a silently smaller card.
   */
  const verdicts = ([[2560, 1440], [1680, 1050], [1600, 900], [1366, 768], [1280, 720]] as const).map(([width, height]) => {
    const w = asideBox({ width, height }).width * SHARE;
    return `${String(width)}x${String(height)} ${w >= CARD_MIN ? 'card' : 'words'}`;
  });
  assert.deepEqual(verdicts, ['2560x1440 card', '1680x1050 card', '1600x900 card', '1366x768 words', '1280x720 words'], verdicts.join(' | '));
});

ok('the architecture document states real numbers, not the ones that were true when it was written', () => {
  /*
   * DOCUMENTATION IS A CONSUMER OF THE BEHAVIOUR, and it goes stale exactly the
   * way a test fixture does - silently, because nothing type-checks prose.
   *
   * Found by reading it: `automod-architecture.md` still said "Q1 only" and
   * "the optimiser has no Warframe objective" long after Q2 became what every
   * weapon is asked and Q3 became what every frame is asked. Its table also
   * carried four gate sizes that had drifted - 18 against 21, 17 against 20,
   * 21 against 22, 6 against 8.
   *
   * The prose cannot be checked mechanically. The NUMBERS can, and a document
   * whose numbers are verified is one somebody has a reason to keep reading.
   * Every `check-name (n)` in that table is compared against the `ok(` calls in
   * the script it names.
   */
  const doc = readFileSync(new URL('../docs/research/automod-architecture.md', import.meta.url), 'utf8');
  const stated = [...doc.matchAll(/check-([a-z-]+)` \((\d+)\)/g)];
  assert.ok(stated.length >= 5, `only ${String(stated.length)} gate sizes stated; the table's shape has changed`);
  const wrong: string[] = [];
  for (const [, name, n] of stated) {
    const path = new URL(`./check-${String(name)}.ts`, import.meta.url);
    if (!existsSync(path)) {
      wrong.push(`check-${String(name)} is named in the table and does not exist`);
      continue;
    }
    const actual = (readFileSync(path, 'utf8').match(/^ok\(/gm) ?? []).length;
    if (String(actual) !== n) wrong.push(`check-${String(name)}: the document says ${String(n)}, the script has ${String(actual)}`);
  }
  assert.deepEqual(wrong, [], `the architecture document has drifted from the gates:\n        ${wrong.join('\n        ')}`);
});

console.log(`\n${checks} checks, ${failures} failures\n`);
process.exitCode = failures === 0 ? 0 : 1;
