/**
 * The armour curve and the damage-over-time procs, checked against the numbers
 * the wiki prints rather than against themselves.
 *
 * WHY EVERY ONE OF THESE MATTERS
 * ------------------------------
 * These formulas decide what the app tells a player to put on their weapon. A
 * wrong constant here does not throw, does not look wrong, and does not produce
 * a number anybody can eyeball - it just quietly ranks the wrong build first,
 * forever. The two checkpoints that carry the most weight are 300 armour giving
 * exactly 30 % and 675 giving exactly 45 %: together they pin the 0.9 and the
 * square root, and no other pair of constants passes both.
 *
 * The second-most valuable check is the one that proves the ENEMY curve is not
 * the TENNO curve. They are different formulas that meet at exactly two points -
 * zero, and the 2,700 cap, which is what makes the over-cap fallback continuous
 * - and disagree everywhere between. Every build calculator written before June
 * 2024 uses the old one.
 *
 * Run: node scripts/check-armour.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARMOUR_CAP, ARMOUR_FLOOR, ATTENUATION, BLEED_COEFFICIENT, DOT_TICKS, HUNTER_MUNITIONS, RULES, STEEL_PATH_LEVELS, UNKNOWN, armourAtLevel, bleedTick, combinedStrip, corrosiveStrip, enemyDamageMultiplier, enemyDamageReduction, heatStripCeiling, igniteTick, landsAt, mitigatedBy, moddedBaseDamage, netArmour, poisonTick, procTotal, procTypeWeights, viralMultiplier } from '../src/data/armour.ts';

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
/** Four decimal places, which is the precision the research table is stated to. */
const near = (a: number, b: number, msg: string) => {
  assert.ok(Math.abs(a - b) < 5e-5, `${msg}: got ${a.toFixed(6)}, wanted ${b.toFixed(6)}`);
};

console.log('the armour curve');

ok('the two clean checkpoints are EXACT, which pins the 0.9 and the square root together', () => {
  // 0.9 * sqrt(300/2700) = 0.9 * (1/3) = 0.30 exactly.
  assert.equal(Math.round(enemyDamageReduction(300) * 1e10) / 1e10, 0.3);
  // 0.9 * sqrt(675/2700) = 0.9 * 0.5 = 0.45 exactly.
  assert.equal(Math.round(enemyDamageReduction(675) * 1e10) / 1e10, 0.45);
  // and the cap is exactly 90 %, which is what makes 2700 the cap
  assert.equal(Math.round(enemyDamageReduction(ARMOUR_CAP) * 1e10) / 1e10, 0.9);
});

ok('the whole worked table from the research reproduces, all eleven rows', () => {
  const TABLE: ReadonlyArray<[number, number]> = [
    [0, 0],
    [100, 0.173205],
    [200, 0.244949],
    [300, 0.3],
    [500, 0.387298],
    [675, 0.45],
    [900, 0.519615],
    [1000, 0.547723],
    [1350, 0.636396],
    [2000, 0.774597],
    [2700, 0.9],
  ];
  assert.equal(TABLE.length, 11);
  for (const [armour, dr] of TABLE) near(enemyDamageReduction(armour), dr, `${String(armour)} armour`);
  // the multiplier is the complement, and at the cap it is exactly a tenth
  near(enemyDamageMultiplier(2700), 0.1, 'multiplier at the cap');
});

ok('the ENEMY curve is not the TENNO curve - the mistake that would pass every other check', () => {
  const tenno = (a: number) => a / (a + 300);
  // 300 armour: half your damage as a Warframe, thirty per cent as an enemy.
  near(tenno(300), 0.5, 'the Tenno value at 300');
  near(enemyDamageReduction(300), 0.3, 'the enemy value at 300');
  assert.notEqual(Math.round(enemyDamageReduction(300) * 1e6), Math.round(tenno(300) * 1e6));
  /*
   * They agree at exactly two points, and the second one is not a coincidence:
   * at 2,700 the enemy curve is 0.9 x sqrt(1) = 0.9 and the Tenno curve is
   * 2700 / 3000 = 0.9. The cap is precisely where the two formulas meet, which
   * is what makes the over-cap fallback CONTINUOUS rather than a step. This
   * check originally asserted they differ at 2,700 and was wrong to.
   */
  assert.equal(enemyDamageReduction(0), tenno(0));
  near(enemyDamageReduction(ARMOUR_CAP), tenno(ARMOUR_CAP), 'the curves meet exactly at the cap');
  for (const a of [100, 200, 300, 675, 1000, 2699]) {
    assert.notEqual(Math.round(enemyDamageReduction(a) * 1e6), Math.round(tenno(a) * 1e6), `they must differ at ${String(a)}`);
  }
  // Continuity at the join, which is the practical consequence.
  near(enemyDamageReduction(2700), enemyDamageReduction(2700.0001), 'no step at the join');
});

ok('above the cap the curve changes to the other form, and the two disagree there', () => {
  const a = 5400;
  near(enemyDamageReduction(a), a / (a + 300), 'over-cap falls back');
  // If the sqrt branch had been used it would have exceeded 90 %, which is the
  // tell that the branch is missing.
  assert.ok(0.9 * Math.sqrt(a / ARMOUR_CAP) > 0.9);
  assert.ok(enemyDamageReduction(a) > 0.9, 'over-cap armour still reduces more than the cap');
});

ok('negative armour is not negative reduction', () => {
  assert.equal(enemyDamageReduction(-500), 0);
  assert.equal(enemyDamageMultiplier(-500), 1);
});

ok('the Update 36 bounds are the stated ones', () => {
  assert.equal(ARMOUR_CAP, 2700);
  assert.equal(ARMOUR_FLOOR, 200);
});

console.log('\nwhat ignores armour');

ok('bleed ignores armour and hits shields; poison is the exact reverse', () => {
  assert.deepEqual(mitigatedBy('bleed'), { armour: false, shields: true });
  assert.deepEqual(mitigatedBy('poison'), { armour: true, shields: false });
  assert.deepEqual(mitigatedBy('true'), { armour: false, shields: false });
  assert.deepEqual(mitigatedBy('ignite'), { armour: true, shields: true });
  assert.deepEqual(mitigatedBy('direct'), { armour: true, shields: true });
});

ok('at the cap a bleed lands whole while everything else lands at a tenth - a factor of ten', () => {
  assert.equal(landsAt('bleed', ARMOUR_CAP), 1);
  assert.equal(landsAt('true', ARMOUR_CAP), 1);
  near(landsAt('direct', ARMOUR_CAP), 0.1, 'a direct hit at the cap');
  near(landsAt('ignite', ARMOUR_CAP), 0.1, 'an ignite at the cap');
  near(landsAt('poison', ARMOUR_CAP), 0.1, 'a poison at the cap');
  // The whole reason Q2 exists, stated as a ratio.
  near(landsAt('bleed', ARMOUR_CAP) / landsAt('direct', ARMOUR_CAP), 10, 'bleed against direct at the cap');
});

console.log('\nthe damage-over-time procs');

ok('the modded base excludes elemental and physical mods, which is the most mis-stated rule here', () => {
  // 100 base, a 165 % base-damage mod, no faction.
  assert.equal(moddedBaseDamage({ base: 100, baseDamageBonus: 1.65 }), 265);
  // Faction multiplies on top of it.
  assert.equal(moddedBaseDamage({ base: 100, baseDamageBonus: 1.65, faction: 0.3 }), 344.5);
  // And nothing else does: there is no parameter for an element here at all,
  // so a caller cannot accidentally raise the base a bleed is taken from.
  assert.equal(moddedBaseDamage({ base: 100 }), 100);
});

ok('a bleed takes NO element bonus, while an ignite and a poison take their own', () => {
  const moddedBase = 1000;
  assert.equal(bleedTick({ moddedBase }), 350);
  /*
   * A 90 % heat mod does nothing at all to a bleed, asserted as BEHAVIOUR and
   * not merely as a type. `bleedTick`'s signature omits `elementBonus`, so a
   * sabotage that made it scale by one was invisible to this gate: no legal
   * caller could pass the field, so nothing could observe the defect. A future
   * widening of that signature would have made the bug live and silent. So the
   * field is forced in past the type and the answer must not move.
   */
  assert.equal(bleedTick({ moddedBase }), BLEED_COEFFICIENT * moddedBase);
  const sneaked = { moddedBase, elementBonus: 0.9 } as Parameters<typeof bleedTick>[0];
  assert.equal(bleedTick(sneaked), 350, 'a bleed must ignore an element bonus even when handed one');
  // The ignite is half the WHOLE modded base times the heat bonus, not half the
  // heat portion of the hit.
  assert.equal(igniteTick({ moddedBase, elementBonus: 0.9 }), 950);
  assert.equal(poisonTick({ moddedBase, elementBonus: 0.9 }), 950);
  // With no element mods the two are simply half.
  assert.equal(igniteTick({ moddedBase }), 500);
  assert.equal(poisonTick({ moddedBase }), 500);
});

ok('faction and status damage multiply the tick, and faction is the known double dip', () => {
  const moddedBase = moddedBaseDamage({ base: 1000, faction: 0.3 });
  assert.equal(moddedBase, 1300);
  // Faction appears again in the tick: 0.35 * 1300 * 1.3.
  assert.equal(bleedTick({ moddedBase, faction: 0.3 }), 0.35 * 1300 * 1.3);
  assert.equal(bleedTick({ moddedBase: 1000, statusDamageBonus: 0.5 }), 525);
});

ok('a proc is six ticks, so its whole life is six times one', () => {
  assert.equal(DOT_TICKS, 6);
  assert.equal(procTotal(bleedTick({ moddedBase: 1000 })), 2100);
});

console.log('\nstripping armour');

ok('corrosive is 26 per cent then six a stack, reaching exactly the 80 the wiki prints', () => {
  assert.equal(corrosiveStrip(0), 0);
  assert.equal(Math.round(corrosiveStrip(1) * 100) / 100, 0.26);
  assert.equal(Math.round(corrosiveStrip(2) * 100) / 100, 0.32);
  assert.equal(Math.round(corrosiveStrip(10) * 100) / 100, 0.8);
  // Past ten it does not keep climbing.
  assert.equal(Math.round(corrosiveStrip(25) * 100) / 100, 0.8);
  // THE DISCRIMINATOR: compounding would give 57.6 % at ten, not 80 %. Only the
  // flat reading reproduces the wiki's own figure, which is why flat is used.
  let compounding = 0;
  for (let i = 0; i < 10; i++) compounding = compounding + (1 - compounding) * (i === 0 ? 0.26 : 0.06);
  assert.ok(Math.abs(compounding - 0.8) > 0.2, 'the compounding reading should be far from 80 %');
  assert.equal(Math.round(compounding * 1000) / 1000, 0.576);
});

ok('heat exposes its ceiling only, because the ramp is not modelled', () => {
  assert.equal(heatStripCeiling(), 0.5);
});

ok('two strips multiply on what is left, and the worked example reproduces exactly', () => {
  // 80 % corrosive and 50 % heat leave a tenth of the armour: 90 % combined.
  near(combinedStrip(0.8, 0.5), 0.9, 'the combined strip');
  const left = netArmour(ARMOUR_CAP, combinedStrip(0.8, 0.5));
  near(left, 270, 'armour left at the cap after a 90 % strip');
  // Which takes 90 % reduction down to 28.46 %.
  near(enemyDamageReduction(left), 0.284605, 'reduction after the strip');
  // A 7.15x gain in what arrives - the number the Update 36 rework was for.
  near(enemyDamageMultiplier(left) / enemyDamageMultiplier(ARMOUR_CAP), 7.153966, 'the damage gain');
  // One strip alone is much less: 80 % corrosive on its own leaves 540.
  near(netArmour(ARMOUR_CAP, 0.8), 540, 'corrosive alone');
});

ok('viral is x2 at one stack and x4.25 at ten - the multiplier, not the bonus', () => {
  assert.equal(viralMultiplier(0), 1);
  assert.equal(viralMultiplier(1), 2);
  assert.equal(viralMultiplier(2), 2.25);
  /*
   * THE RESEARCH DOC CONTRADICTS ITSELF HERE and this is the resolution.
   *
   * It states the formula `2 + 0.25 x (stacks - 1)`, states the cap as
   * "+325 %", and then writes "10 stacks -> x3.25". The first two agree: a
   * +325 % BONUS is a x4.25 MULTIPLIER, and the formula gives 4.25. Only the
   * third statement disagrees, and it disagrees by confusing the bonus with the
   * multiplier - the commonest slip in this whole domain.
   *
   * Two of three, plus the formula itself, say 4.25. That is what is
   * implemented. If this ever "fails" again, check which of the two quantities
   * the new source is quoting before changing the code.
   */
  assert.equal(viralMultiplier(10), 4.25);
  assert.equal(viralMultiplier(10) - 1, 3.25, 'the BONUS at ten stacks is +325 %');
  assert.equal(viralMultiplier(40), 4.25);
});

console.log('\nwhich proc a hit causes');

ok('a type proc share is its damage share, with no physical bias since Update 27.2', () => {
  const w = procTypeWeights([
    { type: 'slash', amount: 25 },
    { type: 'impact', amount: 25 },
    { type: 'heat', amount: 50 },
  ]);
  near(w.get('slash') ?? 0, 0.25, 'slash share');
  near(w.get('impact') ?? 0, 0.25, 'impact share');
  near(w.get('heat') ?? 0, 0.5, 'heat share');
  // The removed bias, stated as the thing that must NOT happen: a physical type
  // with the same damage as an element must not out-weigh it.
  assert.equal(w.get('slash'), w.get('impact'));
  near((w.get('slash') ?? 0) / (w.get('heat') ?? 1), 0.5, 'slash must not be favoured over heat');
  // Weights sum to one, and a zero-damage type is absent rather than zero.
  near([...w.values()].reduce((a, b) => a + b, 0), 1, 'the weights sum');
  assert.equal(procTypeWeights([{ type: 'slash', amount: 0 }]).size, 0);
  assert.equal(procTypeWeights([]).size, 0);
});

ok('Hunter Munitions triggers on a CRIT, not on a status roll', () => {
  assert.equal(HUNTER_MUNITIONS.chanceAtMaxRank, 0.3);
  assert.equal(HUNTER_MUNITIONS.triggersOn, 'critical hit');
  assert.equal(HUNTER_MUNITIONS.slotsOn, 'primary');
  assert.equal(HUNTER_MUNITIONS.produces, 'bleed');
  // And what it produces is an ordinary bleed, not a special one.
  assert.equal(bleedTick({ moddedBase: 1000 }), 350);
});

console.log('\nwhat this module admits it does not know');

ok('the unknowns are named rather than filled in, and the verdicts are honest', () => {
  assert.equal(UNKNOWN.length, 9, 'the count of open questions moved without a reason being recorded');
  assert.ok(UNKNOWN.some((u) => u.includes('Hunter Munitions')), 'the per-pellet question is unresolved');

  /*
   * TWO QUESTIONS WERE ANSWERED, so they had to leave this list - a module that
   * keeps claiming ignorance it no longer has is as dishonest as one that
   * claims knowledge it never had.
   *
   *   CORROSIVE COMPOUNDS OR IS FLAT: flat, settled three ways, the decisive one
   *   being that an Emerald Archon Shard's 14 stacks "can fully remove all
   *   armor" and 0.20 + 0.06 x 14 = 104 % - a product of per-stack factors can
   *   never reach zero.
   *
   *   VIRAL ON A TICK: yes, evaluated per tick, so bleed's armour bypass and
   *   viral's health multiplier COMPOUND. That is the fact the whole
   *   level-9999 objective turns on.
   */
  assert.ok(!UNKNOWN.some((u) => u.includes('compounds per stack')), 'the corrosive question is settled and must not still be listed as open');
  assert.ok(!UNKNOWN.some((u) => u.includes('viral multiplies a bleed tick')), 'the viral-on-a-tick question is settled and must not still be listed as open');
  const src = readFileSync(new URL('../src/data/armour.ts', import.meta.url), 'utf8');
  assert.ok(/Archon Shard|ARCHON SHARD/i.test(src), 'the corrosive resolution is asserted with no evidence recorded beside it');
  assert.ok(/evaluated per tick/i.test(src), 'the viral-on-a-tick resolution is asserted with no evidence recorded beside it');

  /*
   * AND THE NEW QUESTIONS ARE NAMED. Resolving two while discovering two more
   * is the ordinary shape of this work; the count staying at nine is a
   * coincidence, not a target.
   */
  assert.ok(UNKNOWN.some((u) => u.includes('2,700 clamp')), 'the clamp-before-or-after-strip order is unrecorded, and it changes what stripping is worth');
  /*
   * ATTENUATION IS SCOPED, NOT UNKNOWN - and the distinction is the point.
   *
   * The old entry read "the general damage-attenuation formula" and implied a
   * hole in the level-9999 objective. There is no general formula: the wiki's
   * section is "Special Enemies and Damage Attenuation" and lists thirteen
   * named bosses and specials. Q2 aims at the ordinary population, which has
   * none. What is still open - how long a window lasts - is open to the wiki
   * too, which carries an UpdateMe saying so.
   */
  assert.equal(ATTENUATION.appliesToOrdinaryMobs, false, 'attenuation now applies to ordinary mobs, so Q2 has a real gap');
  assert.equal(ATTENUATION.namedUnits, 13);
  assert.ok(ATTENUATION.section.startsWith('Special Enemies'), 'the section is no longer scoped to special enemies');
  assert.ok(
    UNKNOWN.some((u) => u.includes('attenuation') && u.includes('special enemies')),
    'the attenuation entry no longer says which enemies it is about, which is the whole reason it is not a gap here',
  );
  assert.ok(
    UNKNOWN.some((u) => u.includes('200 armour floor')),
    'the zero-armour floor question is unrecorded, and it decides whether every unarmoured Corpus unit is handed 200 armour',
  );
  // A module whose every rule is "exact" has stopped distinguishing.
  const verdicts = Object.values(RULES);
  assert.equal(verdicts.filter((v) => v === 'approx').length, 3, 'three rules are approximations, not more and not fewer');
  assert.equal(RULES.corrosiveStrip, 'approx');
  assert.equal(RULES.heatStripCeiling, 'approx');
  assert.equal(RULES.enemyReduction, 'exact');
});

ok('armour by level reproduces the research table, and level 9999 is the cap by proof', () => {
  /*
   * THE NINTH FUNCTION. `armour-and-status.md` A5 lists nine things Q2 needs
   * and eight were written; this was the one that was not, so the optimiser
   * scored against a bare 2,700 with no way to ask what a LEVEL meant.
   *
   * The document carries a worked table for a 100-armour, base-level-1 unit.
   * That table is the oracle: it was computed independently of this code, from
   * the wiki's formulas, and if the smoothstep reading here is ever shown to be
   * wrong then the table and the code fail together instead of drifting.
   */
  const at = (level: number) => armourAtLevel({ baseArmour: 100, baseLevel: 1, level });

  // level -> the document's armour column, after its floor and cap.
  const TABLE: ReadonlyArray<readonly [number, number]> = [
    [20, 200], // 186 raised to the 200 floor
    [40, 404],
    [60, 728],
    [80, 1160], // inside the 70..80 smoothstep band
    [100, 1355],
    [150, 1806],
    [200, 2219],
    [300, 2700], // 2976 cut to the cap
  ];
  for (const [level, armour] of TABLE) {
    const got = at(level);
    assert.ok(
      Math.abs(got - armour) <= 1,
      `level ${String(level)}: the curve gives ${got.toFixed(1)} armour, the research table says ${String(armour)} - the code and the document disagree`,
    );
  }

  /*
   * AND THE ANSWER THE WHOLE LEVEL-9999 OBJECTIVE RESTS ON.
   *
   * At q = 9998 the multiplier is about 400.9, so even a 100-armour unit
   * computes to roughly 40,090 - two orders of magnitude past the cap. EVERY
   * unit at that level is at 2,700 and at exactly 90 % reduction, whatever it
   * started from. So the armour target for level 9999 is not an estimate and
   * not a preference: it is forced, and the only thing that can move it is a
   * strip. That is why stripping had to stop being unmodelled.
   */
  assert.equal(at(9999), ARMOUR_CAP, 'a level 9999 enemy is not at the armour cap, which the entire objective assumes');
  /*
   * "EVERY unit" WAS TOO STRONG, and this assertion caught it on the first run.
   * The multiplier at 9999 is about 400.9, so the cap is reached by any unit
   * with roughly 6.7 base armour or more - a 5-armour unit lands at 2,005 and
   * is genuinely below it. The claim that survives is the one that matters:
   * every ARMOURED unit worth the name is pinned to the cap, so the target is
   * forced rather than chosen.
   */
  assert.ok(armourAtLevel({ baseArmour: 7, baseLevel: 1, level: 9999 }) === ARMOUR_CAP, 'a 7-armour unit does not reach the cap at 9999');
  assert.ok(armourAtLevel({ baseArmour: 5, baseLevel: 1, level: 9999 }) < ARMOUR_CAP, 'the threshold claim is wrong: a 5-armour unit is being reported at the cap');
  /*
   * AND ZERO ARMOUR STAYS ZERO. A5e says "initial armour below 200 is raised to
   * 200" and is silent on zero; read literally it hands every unarmoured Corpus
   * unit 200 armour and takes a quarter of the damage off. `UNKNOWN` carries
   * the question.
   */
  assert.equal(armourAtLevel({ baseArmour: 0, baseLevel: 1, level: 9999 }), 0, 'an UNARMOURED unit is being given 200 armour by the floor');
  assert.equal(enemyDamageReduction(at(9999)), 0.9, 'the cap is not exactly 90 % reduction, so the "arriving tenth" the optimiser uses is wrong');

  /*
   * THE FLOOR IS ON THE INITIAL VALUE ONLY, which is why it lives in the level
   * curve and not in `netArmour`. A strip is allowed to take an enemy below
   * 200 - the Armor page says so explicitly - and a floor applied in the wrong
   * place would silently cancel most of what stripping is for.
   */
  assert.equal(at(1), ARMOUR_FLOOR, 'a unit at its own base level is not raised to the floor');
  /*
   * The first version of this used an 80 % strip on a capped enemy and proved
   * nothing: 2,700 x 0.2 is 540, which was never below the floor to begin with.
   * The floor is 200, so the case that actually tests it starts AT the floor.
   */
  assert.equal(netArmour(ARMOUR_FLOOR, 0.5), 100, 'THE FLOOR IS BEING APPLIED AFTER THE STRIP, which cancels most of what stripping buys');

  // Steel Path enters as levels and nothing else: U36 removed its armour multiplier.
  assert.equal(
    armourAtLevel({ baseArmour: 100, baseLevel: 1, level: 50, steelPath: true }),
    armourAtLevel({ baseArmour: 100, baseLevel: 1, level: 50 + STEEL_PATH_LEVELS }),
    'Steel Path is doing something to armour beyond adding levels, which Update 36 removed',
  );

  /*
   * AND `q` COUNTS FROM THE UNIT'S OWN BASE LEVEL, not from 1. A5c. Getting
   * this wrong inflates every heavy unit, because the units with the most
   * armour are exactly the ones that spawn at a high base level.
   */
  assert.ok(
    armourAtLevel({ baseArmour: 100, baseLevel: 60, level: 100 }) < armourAtLevel({ baseArmour: 100, baseLevel: 1, level: 100 }),
    'the curve counts from level 1 rather than from the unit\'s own base level',
  );
});

console.log(`\n${String(checks)} checks, ${String(failures)} failures`);
// `process.exitCode`, not `process.exit()` - see the note in check-fusion.ts:
// `process.exit` intermittently aborts these scripts on a libuv assertion here.
process.exitCode = failures === 0 ? 0 : 1;
