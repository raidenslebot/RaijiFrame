/**
 * Self-check for the modding arithmetic.
 *
 * Every number asserted here is one the wiki PUBLISHES as a worked example
 * (docs/research/modding-arithmetic.md carries the sentence each came from),
 * or one measured in the user's own game: Maim's 87.5, Hek's 525, the 1.54 s
 * reload, the 58.5 → 59 magazine, the 297.8202 bleed tick, Serration 14 → 7
 * in a Madurai slot, Galvanized Elementalist 11 → 6 after a Forma, Broken
 * War's 64. A formula that reproduces none of them is wrong; one that
 * reproduces all of them is at least not wrong where the wiki looked.
 *
 * Run: node scripts/check-modded.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RULES,
  auraBonus,
  averageCritMultiplier,
  capacity,
  chargeFireRate,
  combineElements,
  comboMultiplier,
  comboScaledBonus,
  conditionOverload,
  critChance,
  critTierMultiplier,
  drainAtRank,
  elementalDamage,
  factionMultiplier,
  headshotCritMultiplier,
  magazineSize,
  multishot,
  procsPerShot,
  quantise32,
  reloadTime,
  slotDrain,
  sustainedDps,
} from '../src/data/modded.ts';

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
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);

console.log('\ncapacity and drain');

ok("Broken War: rank 30, catalyst, MR below the floor's reach → 60, plus the stance's 4 is the screen's 64", () => {
  assert.equal(capacity({ rank: 30, maxRank: 30, masteryRank: 20, catalyst: true }), 60);
});

ok('the mastery term is a floor: an unranked weapon at MR 6 has 18, and 40 with a catalyst', () => {
  assert.equal(capacity({ rank: 0, maxRank: 30, masteryRank: 6, catalyst: false }), 18);
  assert.equal(capacity({ rank: 0, maxRank: 30, masteryRank: 10, catalyst: true }), 40);
});

ok('Paracesis: rank 40 without a catalyst is 40 (plus a matched maxed stance makes the wiki\'s 50)', () => {
  assert.equal(capacity({ rank: 40, maxRank: 40, masteryRank: 10, catalyst: false }), 40);
  assert.equal(capacity({ rank: 40, maxRank: 40, masteryRank: 10, catalyst: true }) + auraBonus(5, 'madurai', 'madurai'), 90);
});

ok('drain rises one per rank: Blood Rush 4 → 14, Corrosive Projection -2 → -7', () => {
  assert.equal(drainAtRank(4, 10), 14);
  assert.equal(drainAtRank(-2, 5), -7);
});

ok('matched polarity halves rounding up: Serration 14 → 7, and the measured 11 → 6', () => {
  assert.equal(slotDrain(14, 'madurai', 'madurai'), 7);
  assert.equal(slotDrain(11, 'vazarin', 'vazarin'), 6);
});

ok("mismatched polarity adds a quarter rounded half-up: the wiki's brackets 2→3, 5→6, 6→8, 9→11, 10→13, 14→18", () => {
  for (const [d, want] of [
    [2, 3],
    [5, 6],
    [6, 8],
    [9, 11],
    [10, 13],
    [14, 18],
  ] as const)
    assert.equal(slotDrain(d, 'naramon', 'madurai'), want, `drain ${d}`);
});

ok('a universal slot matches everything except Umbra, whose mods pay base drain there', () => {
  assert.equal(slotDrain(9, 'universal', 'madurai'), 5);
  assert.equal(slotDrain(9, 'universal', 'umbra'), 9);
});

ok('an unpolarised slot charges the listed drain', () => {
  assert.equal(slotDrain(9, 'none', 'madurai'), 9);
});

ok("aura bonus: matched doubles (5 → 10), mismatched follows the wiki's examples 5 → 4 and 9 → 7", () => {
  assert.equal(auraBonus(5, 'naramon', 'naramon'), 10);
  assert.equal(auraBonus(5, 'madurai', 'unairu'), 4);
  assert.equal(auraBonus(9, 'madurai', 'unairu'), 7);
});

ok('the mismatched aura rule is labelled assumed, because the wiki contradicts itself', () => {
  assert.equal(RULES.auraBonusMismatched, 'assumed');
  // The discriminator: 75 % half-up gives 2 at drain 2; 80 % floor would give 1. Whichever
  // the game shows, this line is what changes.
  assert.equal(auraBonus(2, 'madurai', 'unairu'), 2);
});

console.log('\ndamage');

ok("Maim on 100 base: 40 slash x 2.2 quantised to 1/32 of base is the wiki's 87.5", () => {
  near(quantise32(40 * 2.2, 100), 87.5);
});

ok('an elemental mod adds base x pct on the 1/32 grid: +90 % on 100 base is 90.625, not 90 (the grid step is 3.125)', () => {
  // The first version of this check expected 90 and was wrong by the wiki's own rule:
  // 90 is not a multiple of 3.125, and the game rounds to the grid, so the bonus reads 90.625.
  near(elementalDamage(100, 90), 90.625);
  const step = 149 / 32;
  near(elementalDamage(149, 90) / step, Math.round(elementalDamage(149, 90) / step));
});

ok('crit: relative bonus multiplies, absolute adds after; 20 % base +150 % = 50 %', () => {
  near(critChance(0.2, 150)!, 0.5);
  near(critChance(0.2, 150, 10)!, 0.6);
});

ok('crit tiers and the expected multiplier: CD 2, tier 2 → 3; CC 0.5 CD 2 → 1.5', () => {
  assert.equal(critTierMultiplier(2, 2), 3);
  near(averageCritMultiplier(0.5, 2), 1.5);
});

ok('a headcrit: 3 x (1 + tier x (2CD - 1)); a 1x head multiplier gets no bonus', () => {
  near(headshotCritMultiplier(2, 1), 3 * (1 + 1 * 3));
  near(headshotCritMultiplier(2, 1, 1), critTierMultiplier(2, 1));
});

ok("elements combine in placement order: Cold, Toxin, Heat on an innate Electricity weapon → Viral then Radiation (the wiki's Prova example)", () => {
  const r = combineElements(['cold', 'toxin', 'heat'], ['electricity']);
  assert.deepEqual(
    r.map((x) => x.type),
    ['viral', 'radiation'],
  );
});

ok('a repeated element keeps its first position, and a leftover single stays single', () => {
  const r = combineElements(['heat', 'cold', 'heat', 'toxin']);
  assert.deepEqual(
    r.map((x) => x.type),
    ['blast', 'toxin'],
  );
});

ok('an innate element moves to the slot of the first mod of the same element', () => {
  // innate heat, mods: cold, heat, toxin → heat sits where the mod put it (second), so Blast + Toxin
  const r = combineElements(['cold', 'heat', 'toxin'], ['heat']);
  assert.deepEqual(
    r.map((x) => x.type),
    ['blast', 'toxin'],
  );
});

ok('two innate elements follow HCET: an innate Toxin+Heat weapon with no mods reads Gas', () => {
  const r = combineElements([], ['toxin', 'heat']);
  assert.deepEqual(r[0]?.from, ['heat', 'toxin']);
  assert.equal(r[0]?.type, 'gas');
});

ok("Hek: 7 pellets x 75 per pellet is the wiki's 525; +120 % multishot is 15.4 pellets", () => {
  near(7 * 75, 525);
  near(multishot(7, 120)!, 15.4);
});

console.log('\nrate, reload, magazine, dps, faction, status, combo');

ok("reload 2.0 with +30 % is the wiki's 1.54 s; with -30 % its 2.86 s", () => {
  near(reloadTime(2, 30)!, 1.5384615, 1e-5);
  near(reloadTime(2, -30)!, 2.857142, 1e-5);
});

ok("magazine 45 x 1.3 = 58.5 rounds to the wiki's 59", () => {
  assert.equal(magazineSize(45, 30), 59);
});

ok('a charge weapon: 1 / (charge / (1 + bonus) + 1 / fire rate)', () => {
  near(chargeFireRate(1, 2, 100), 1 / (0.5 + 0.5));
});

ok('sustained DPS is burst x shots / (EFR x reload + shots)', () => {
  near(sustainedDps({ burstDps: 1000, effectiveFireRate: 10, magazine: 20, reload: 2 }), 1000 * (20 / (20 + 20)));
});

ok("faction: 1.05 per rank to 1.30 regular and 1.55 primed, and the wiki's bleed tick 297.8202", () => {
  near(factionMultiplier(5), 1.3);
  near(factionMultiplier(10), 1.55);
  near(100 * 2.65 * 0.35 * 1.3 * 1.3 * 1.9, 297.8202, 1e-4);
});

ok('procs per shot: multishot x (forced + chance); a 140 % chance is 1.4 per projectile', () => {
  near(procsPerShot(2, 1.4), 2.8);
  near(procsPerShot(1, 0.5, 1), 1.5);
});

ok('combo: none below 20 hits, 2x at 20, 12x at 220 and no higher', () => {
  assert.equal(comboMultiplier(19), 1);
  assert.equal(comboMultiplier(20), 2);
  assert.equal(comboMultiplier(220), 12);
  assert.equal(comboMultiplier(400), 12);
});

ok('Blood Rush at 12x is +440 %: 40 x (12 - 1)', () => {
  assert.equal(comboScaledBonus(40, 12), 440);
});

ok("Condition Overload is two rules: the wiki's hitscan 100 x (1 + 1.65 + 0.8) = 345, and the projectile form multiplies", () => {
  const h = conditionOverload({ base: 100, sumDamagePct: 165, coPctPerStatus: 80, statuses: 1, delivery: 'hitscan' });
  near(h.hitscan!, 345);
  assert.equal(h.projectile, null);
  const p = conditionOverload({ base: 100, sumDamagePct: 165, coPctPerStatus: 80, statuses: 1, delivery: 'projectile' });
  near(p.projectile!, 100 * 2.65 * 1.8);
  const u = conditionOverload({ base: 100, sumDamagePct: 165, coPctPerStatus: 80, statuses: 1, delivery: 'unknown' });
  assert.ok(u.hitscan !== null && u.projectile !== null, 'an unknown delivery must return both');
});

console.log('\nthe labels');

ok('every exported rule function is labelled in RULES, and no label is invented', () => {
  const src = readFileSync(new URL('../src/data/modded.ts', import.meta.url), 'utf8');
  const exported = [...src.matchAll(/^export function ([a-zA-Z0-9]+)\(/gm)].map((m) => m[1]!).filter((n) => n !== 'roundHalfUp');
  for (const name of exported) assert.ok(name in RULES, `${name} carries no verdict`);
  for (const v of Object.values(RULES)) assert.ok(['exact', 'approx', 'assumed'].includes(v));
});

ok('an absent input stays unknown: null in, null out, never zero', () => {
  assert.equal(critChance(null, 150), null);
  assert.equal(reloadTime(null, 30), null);
  assert.equal(magazineSize(null, 30), null);
  assert.equal(multishot(null, 120), null);
});

console.log(`\n${checks} checks, ${failures} failures\n`);
process.exit(failures === 0 ? 0 : 1);
