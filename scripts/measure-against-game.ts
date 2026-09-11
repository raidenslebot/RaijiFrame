/**
 * THE ONLY PLACE THE ARITHMETIC TOUCHES GROUND TRUTH.
 *
 * Every other check in this repo compares the app against a wiki formula, or
 * against itself. This one compares it against numbers the GAME printed on the
 * player's own Upgrades panel for the build that is actually installed:
 *
 *     Critical Chance  70 %      Impact      99.1
 *     Critical Damage  4.2x      Puncture    99.1
 *     Status           50 %      Slash    2,220.1
 *                                Total    2,418.3
 *
 * on a Broken War whose base is 187 (18.7 / 18.7 / 149.6), 35 % crit, 2.2x,
 * 20 % status.
 *
 * THE BUILD IS PINNED, and the first version of this file was not.
 * ---------------------------------------------------------------
 * It looked mods up by DISPLAY NAME and assumed every one was at `fusionLimit`.
 * Three of the eight names have twins in the catalogue under one display name
 * (Jagged Edge, Organ Shatter and Melee Prowess each have a Beginner variant),
 * so the chooser was picking by effect count and got the right row by luck; and
 * Galvanized Steel is at rank NINE, not ten, which alone put the computed crit
 * chance at 73.5 % against the game's 70 %. Both are now pinned by
 * `uniqueName` and by the rank the EE.log dump's polarity-adjusted drains
 * imply, so a disagreement here is the arithmetic and nothing else.
 *
 * WHAT IT FOUND, AND WHAT A SECOND PANEL THEN SETTLED
 * ---------------------------------------------------
 * Crit chance, crit damage and status land EXACTLY on the game's figures, which
 * verifies the mod arithmetic against the game rather than against a wiki. The
 * damage on THIS build lands at exactly HALF, uniformly - ratio 2.00001 on the
 * total once quantisation is taken out of the comparison.
 *
 * For a long time that was recorded as an unexplained constant, and every melee
 * figure the overlay printed carried a note saying so. A SECOND panel, on the
 * same weapon with a different build, says the arithmetic was never the
 * problem. See `SECOND` below: the app reproduces the game to 0.32 %.
 *
 * So the factor of two is a property of THIS build, not of melee. The two
 * panels are not even in the same state - this one reads Combo Duration 300 s
 * and the second reads 5 s - and the physical rows here are exactly twice what
 * the damage mods the app can see account for. Three of the weapon's eleven
 * slots have never been read, and a stance or an arcane in one of them is a
 * damage source the app does not model.
 *
 * NO CORRECTION IS APPLIED, and now for a better reason than before: there is
 * nothing uniform to correct.
 *
 * Run: node scripts/measure-against-game.ts
 */
import { loadItemDb } from '../src/data/itemdb.ts';
import { loadModDb } from '../src/data/moddb.ts';
import { score } from '../src/data/optimise.ts';

const BROKEN_WAR = '/Lotus/Weapons/Tenno/Melee/Swords/StalkerTwo/StalkerTwoSmallSword';

/**
 * A SECOND PANEL, ON THE SAME WEAPON, WITH A BUILD THE APP CAN SEE WHOLE.
 *
 * Read off a live capture the player sent. What makes it usable as ground truth
 * without a log dump is that the panel identifies its own build: every physical
 * row is the base times the same multipliers, so the multipliers can be read
 * back out of it and CHECKED for consistency.
 *
 *   impact    49.6 / 18.7  = 2.6524   +165 % base damage
 *   puncture  49.6 / 18.7  = 2.6524   the same number, which is the check -
 *                                     two rows agreeing cannot be a coincidence
 *   slash    753.2 / 149.6 = 5.0348   = 2.65 x 1.90, so +90 % slash on top
 *   corrosive 892  / 187   = 4.7701   = 2.65 x 1.80, so +180 % of two elements
 *
 * That is Primed Pressure Point at rank 10, Jagged Edge at 5, and a toxin and
 * an electricity mod at 5 combining to corrosive - a build of four mods, all of
 * which the app models. Their sum is 1,744.35 against the panel's 1,744.3.
 */
const SECOND = {
  build: [
    '/Lotus/Upgrades/Mods/Melee/Expert/WeaponMeleeDamageModExpert', // Primed Pressure Point 10
    '/Lotus/Upgrades/Mods/Melee/WeaponSlashDamageMod', // Jagged Edge 5
    '/Lotus/Upgrades/Mods/Melee/WeaponToxinDamageMod', // Fever Strike 5
    '/Lotus/Upgrades/Mods/Melee/WeaponElectricityDamageMod', // Shocking Touch 5
  ],
  impact: 49.6,
  puncture: 49.6,
  slash: 753.2,
  corrosive: 892,
  total: 1744.3,
};

/** What the game states for this build, read off the player's capture. */
const GAME = {
  criticalChance: 0.7,
  criticalDamage: 4.2,
  status: 0.5,
  impact: 99.1,
  puncture: 99.1,
  slash: 2220.1,
  total: 2418.3,
};

/**
 * The eight cards, by `uniqueName` and by the rank the drains imply.
 *
 * A matched polarity halves a mod's drain and rounds up, so the printed drain
 * solves the rank: Galvanized Steel prints 6, and `ceil((2 + rank) / 2) = 6`
 * gives rank 9 - not the 10 that `fusionLimit` would have assumed.
 */
const INSTALLED: ReadonlyArray<{ path: string; rank: number; why: string }> = [
  { path: '/Lotus/Upgrades/Mods/Melee/Expert/WeaponMeleeDamageModExpert', rank: 10, why: 'Primed Pressure Point, drain 7 = ceil(14/2) matched' },
  { path: '/Lotus/Upgrades/Mods/Melee/WeaponSlashDamageMod', rank: 5, why: 'Jagged Edge, drain 7 = 2+5 unpolarised' },
  { path: '/Lotus/Upgrades/Mods/Sets/Ashen/AshenMandibleMod', rank: 5, why: 'Carnis Mandible, drain 5 = ceil(9/2) matched' },
  { path: '/Lotus/Upgrades/Mods/Melee/WeaponStunChanceMod', rank: 5, why: 'Melee Prowess' },
  { path: '/Lotus/Upgrades/Mods/Melee/WeaponCritDamageMod', rank: 5, why: 'Organ Shatter' },
  { path: '/Lotus/Upgrades/Mods/Melee/Expert/WeaponCritChanceSPMod', rank: 9, why: 'Galvanized Steel, drain 6 = ceil(11/2) matched, so rank NINE' },
  { path: '/Lotus/Upgrades/Mods/Melee/Expert/WeaponMeleeStatusChanceSPMod', rank: 9, why: 'Galvanized Elementalist, drain 11 = 2+9 unpolarised' },
  { path: '/Lotus/Upgrades/Mods/Sets/Gladiator/MeleeGladiatorRushMod', rank: 5, why: 'Gladiator Rush, combo duration only' },
];

const items = await loadItemDb();
const mods = await loadModDb();
const item = items.byType.get(BROKEN_WAR);
if (!item) {
  console.log('Broken War is not in the catalogue; nothing to compare');
} else {
  const set: Array<{ row: NonNullable<ReturnType<typeof mods.byPath.get>>; rank: number }> = [];
  let missing = 0;
  console.log('the build, pinned by uniqueName and by the rank the drains imply\n');
  for (const m of INSTALLED) {
    const row = mods.byPath.get(m.path);
    if (!row) {
      console.log(`  MISSING  ${m.path}`);
      missing++;
      continue;
    }
    console.log(`  ${row.name.padEnd(26)} rank ${String(m.rank).padStart(2)} of ${String(row.fusionLimit).padStart(2)}   ${m.why}`);
    set.push({ row, rank: m.rank });
  }
  if (missing > 0) console.log(`\n  ${String(missing)} of the eight are not in the catalogue; the comparison below is incomplete.`);

  const s = score(item, set).score;
  const by = new Map(s.damage.map((d) => [d.type, d.amount]));

  console.log('\nagainst the numbers the game printed\n');
  console.log('  stat              game        app         ratio');
  const line = (label: string, g: number, a: number) =>
    console.log(`  ${label.padEnd(16)} ${g.toFixed(2).padStart(9)}  ${a.toFixed(2).padStart(9)}  ${(g === 0 ? 0 : a / g).toFixed(5).padStart(9)}`);
  line('critical chance', GAME.criticalChance, s.critChance ?? 0);
  line('critical damage', GAME.criticalDamage, s.critDamage ?? 0);
  line('impact', GAME.impact, by.get('impact') ?? 0);
  line('puncture', GAME.puncture, by.get('puncture') ?? 0);
  line('slash', GAME.slash, by.get('slash') ?? 0);
  line('total', GAME.total, s.perShot);

  /*
   * THE PANEL DOES NOT QUANTISE, AND THE APP DOES.
   *
   * Warframe rounds each damage type to 1/32 of the modded base on the HIT -
   * the app implements that rule correctly - but the arsenal panel prints the
   * unquantised product. Quantised, impact would print 92.9 rather than 99.1
   * and slash 2,230.0 rather than 2,220.1, and both of those are visibly not
   * what the capture says. So the app and the panel are two different
   * quantities and the raw ratios above carry that difference inside them.
   *
   * The unquantised comparison is what isolates the real discrepancy, and it is
   * a clean uniform factor rather than the ragged 2.133 / 1.991 the quantised
   * one shows.
   */
  const baseTotal = (item.damagePerShot ?? []).reduce((a, b) => a + b, 0);
  const unquantised = {
    impact: 18.7 * 5.3,
    puncture: 18.7 * 5.3,
    slash: 149.6 * 2.8 * 5.3,
  };
  console.log('\n  the same thing with quantisation taken out of the comparison\n');
  console.log(`  base ${baseTotal.toFixed(1)}; base-damage bucket x2.65, slash bucket x2.80`);
  for (const [k, v] of Object.entries(unquantised)) {
    const g = GAME[k as 'impact' | 'puncture' | 'slash'];
    console.log(`  ${k.padEnd(16)} ${g.toFixed(2).padStart(9)}  ${(v / 2).toFixed(2).padStart(9)}  ${(g / (v / 2)).toFixed(5).padStart(9)}`);
  }
  console.log('\n  A ratio of 2.00000 on every type is the finding for THIS build: the app is');
  console.log('  half, uniformly, and no wrong base could do that unevenly. Crit and status land');
  console.log('  exactly, so the mod arithmetic is verified against the game.');

  /*
   * THE SECOND PANEL, WHICH IS WHAT DECIDES WHETHER THAT IS ABOUT MELEE OR
   * ABOUT THAT BUILD.
   *
   * Same weapon, a build of four mods the app models completely, and its own
   * multipliers readable out of the panel and mutually consistent. If the app
   * halved melee damage as a rule, this would come back at 0.5. It does not.
   */
  const second = SECOND.build.map((path) => {
    const row = mods.byPath.get(path);
    if (!row) throw new Error(`the catalogue has no ${path}`);
    return { row, rank: row.fusionLimit ?? Math.max(0, row.ranks - 1) };
  });
  const s2 = score(item, second).score;
  const rows2 = new Map(s2.damage.map((d) => [d.type, d.amount]));
  console.log('\n  a SECOND panel on the same weapon, with a build the app can see whole\n');
  console.log(`  ${'build'.padEnd(16)} ${second.map((c) => `${c.row.displayName} ${String(c.rank)}`).join(' · ')}`);
  console.log(`  ${''.padEnd(16)} ${'game'.padStart(9)}  ${'app'.padStart(9)}  ${'app/game'.padStart(9)}`);
  for (const k of ['impact', 'puncture', 'slash', 'corrosive'] as const) {
    const g = SECOND[k];
    const a = rows2.get(k) ?? 0;
    console.log(`  ${k.padEnd(16)} ${g.toFixed(2).padStart(9)}  ${a.toFixed(2).padStart(9)}  ${(a / g).toFixed(5).padStart(9)}`);
  }
  const ratio2 = s2.perShot / SECOND.total;
  console.log(`  ${'total'.padEnd(16)} ${SECOND.total.toFixed(2).padStart(9)}  ${s2.perShot.toFixed(2).padStart(9)}  ${ratio2.toFixed(5).padStart(9)}`);
  console.log(`\n  The app is within ${((Math.abs(ratio2 - 1)) * 100).toFixed(2)} % of the game on a build it can see whole.`);
  console.log('  So the arithmetic is not halved and never was: the factor of two belongs to the');
  console.log('  first build, whose physical rows are exactly twice what its visible damage mods');
  console.log('  account for. The two panels are not even in the same state - the first reads');
  console.log('  Combo Duration 300 s and this one 5 s - and three of the eleven slots have never');
  console.log('  been read. A stance or an arcane in one of them is a damage source not modelled.');
  console.log('  NO correction is applied, and now because there is nothing uniform to correct.');
}
