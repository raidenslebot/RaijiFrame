/**
 * Effective health, and the one mistake that would silently halve every frame.
 *
 * THE TENNO CURVE IS NOT THE ENEMY CURVE. `armour.ts` carries the enemy
 * formula - `0.9 * sqrt(a / 2700)` - and this file carries the player's,
 * `a / (a + 300)`. At 300 armour they read 30 % and 50 %, and using the wrong
 * one here would understate every Warframe build in the game by twenty points
 * without throwing, without looking wrong, and without any other check noticing.
 *
 * The second thing asserted is that armour MULTIPLIES rather than adds, which
 * is the whole reason this objective needs a search at all: if armour simply
 * added health, the best build would be whichever mods have the biggest numbers
 * and no optimiser would be required.
 *
 * Run: node scripts/check-survive.ts
 */
import assert from 'node:assert/strict';
import { armourMultiplier, survivability, TENNO_ARMOUR_CONSTANT } from '../src/data/survive.ts';
import { enemyDamageReduction } from '../src/data/armour.ts';

let checks = 0;
let failures = 0;
function ok(label: string, fn: () => void): void {
  checks++;
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${label}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}
const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: got ${a}, wanted ${b}`);

console.log('the player curve, which is not the enemy one');

ok('300 armour doubles a frame effective health, and reduces an ENEMY hit by only 30 per cent', () => {
  assert.equal(TENNO_ARMOUR_CONSTANT, 300);
  near(armourMultiplier(300), 2, 'a frame at 300 armour');
  // The same number on the enemy curve. Confusing the two is the failure.
  near(Math.round(enemyDamageReduction(300) * 1e6) / 1e6, 0.3, 'an enemy at 300 armour');
  // Stated as the thing that must NOT be true: the frame multiplier is not the
  // complement of the enemy reduction.
  assert.notEqual(armourMultiplier(300), 1 / (1 - enemyDamageReduction(300)));
});

ok('armour multiplies health rather than adding to it', () => {
  // 1000 health and 300 armour is 2000 effective, not 1300.
  const s = survivability({ health: 1000, shield: 0, armour: 300 });
  near(s.effectiveHealth, 2000, 'multiplied');
  assert.notEqual(s.effectiveHealth, 1300, 'armour was added instead of multiplied');
  near(s.fromArmour, 2, 'the multiplier is reported');
});

ok('shields sit OUTSIDE armour - the game does not protect them with it', () => {
  const s = survivability({ health: 1000, shield: 500, armour: 300 });
  near(s.effectiveHealth, 2500, '1000 x 2 + 500');
  // If shields were inside the multiplier this would read 3000.
  assert.notEqual(s.effectiveHealth, 3000, 'shields were multiplied by armour');
});

ok('no armour is a multiplier of exactly one, not of zero', () => {
  near(armourMultiplier(0), 1, 'bare');
  near(survivability({ health: 400, shield: 100, armour: 0 }).effectiveHealth, 500, 'health plus shields');
  // Negative armour cannot take a frame below its bare health.
  near(armourMultiplier(-500), 1, 'negative armour');
});

console.log('\nthe buckets');

ok('percentages are additive within a bucket and multiplicative with the base', () => {
  // Two +100 % health mods give x3, not x4.
  near(survivability({ health: 100, shield: 0, armour: 0, healthPct: 200 }).effectiveHealth, 300, 'x3');
  // Each bucket applies to its own stat and nothing else.
  const s = survivability({ health: 100, shield: 100, armour: 300, healthPct: 100, shieldPct: 50, armourPct: 100 });
  near(s.health, 200, 'health bucket');
  near(s.shield, 150, 'shield bucket');
  near(s.armour, 600, 'armour bucket');
  near(s.fromArmour, 3, '600 armour is x3');
  near(s.effectiveHealth, 200 * 3 + 150, 'composed');
});

ok('Ash, from the catalogue own numbers, comes out where the game says', () => {
  /*
   * 455 health, 270 shields, 105 armour - the values `Warframes.json` carries,
   * and the ones the catalogue now projects. 105 armour is a x1.35 multiplier,
   * so bare Ash is 455 x 1.35 + 270 = 884.25 effective health.
   */
  const s = survivability({ health: 455, shield: 270, armour: 105 });
  near(s.fromArmour, 1.35, 'Ash armour multiplier');
  near(s.effectiveHealth, 884.25, 'bare Ash');
});

ok('for effective health a health percentage ALWAYS beats the same armour percentage', () => {
  /*
   * THIS ASSERTION WAS WRITTEN BACKWARDS THE FIRST TIME, and the arithmetic is
   * worth stating because the intuition is so strong and so wrong.
   *
   * "Armour is multiplicative, so armour mods scale better" is the received
   * wisdom, and for effective health alone it is false. Tripling health triples
   * EHP exactly. Tripling armour multiplies it by (300 + 3a)/(300 + a), which
   * rises with the frame's base armour but APPROACHES three from below and
   * never reaches it. Measured: at 15 armour a +200 % health mod is worth 3.000x
   * and a +200 % armour mod 1.095x; at 1,200 armour the armour mod has climbed
   * only to 2.600x.
   *
   * The gap narrows as base armour rises - which is the real, smaller version of
   * the received wisdom - but it never closes.
   */
  const at = (armour: number, pct: 'healthPct' | 'armourPct') =>
    survivability({ health: 400, shield: 0, armour, [pct]: 200 }).effectiveHealth / survivability({ health: 400, shield: 0, armour }).effectiveHealth;

  for (const armour of [15, 300, 600, 1200]) {
    near(at(armour, 'healthPct'), 3, `health at ${String(armour)} armour is exactly x3`);
    assert.ok(at(armour, 'armourPct') < 3, `armour at ${String(armour)} must stay under x3`);
    assert.ok(at(armour, 'armourPct') < at(armour, 'healthPct'), `health must win at ${String(armour)} armour`);
  }
  // And the gap narrows monotonically, which is the grain of truth in the myth.
  assert.ok(at(15, 'armourPct') < at(300, 'armourPct'));
  assert.ok(at(300, 'armourPct') < at(1200, 'armourPct'));
});

console.log(`\n${String(checks)} checks, ${String(failures)} failures`);
// `process.exitCode`, not `process.exit()` - see the note in check-fusion.ts.
process.exitCode = failures === 0 ? 0 : 1;
