/**
 * The optimiser: which mods, at which ranks, in which slots.
 *
 * THE QUESTION IS PART OF THE ANSWER. A build is "best" only against a stated
 * objective, so every result carries the question it answered and the rules
 * it leaned on. The first objective is the one the game's own stat column
 * makes checkable:
 *
 *   Q1  Sustained damage per second to unarmoured health, over many shots,
 *       no status effects, no headshots, no faction bonus, no conditional
 *       effects - the weapon as the Arsenal prints it, fired until empty and
 *       reloaded, forever.
 *
 * Everything that Q1 does not score is COUNTED and named on the result
 * (`unscored`): a mod with only a conditional or status effect is never
 * chosen by Q1, and the strip says so rather than pretending it was weighed.
 *
 * THREE RUNS over the same search:
 *   Now    - the mods the account owns, at the ranks it owns them
 *   Ideal  - every eligible mod in the catalogue at its max rank
 *   Next   - the Ideal mods the account lacks or under-ranks, ordered by what
 *            each would add to Now: the acquisition list
 *
 * THE SEARCH is a beam over adding one mod at a time (width `BEAM`), with
 * conflicts (one variant per family, one per path), capacity checked after a
 * greedy polarity assignment, and a rank-down pass when a strong set does not
 * fit. Exhaustive over 8 of ~40 is 76 million; the beam is a few thousand
 * evaluations. A tiny-catalogue gate compares it with exhaustive enumeration.
 *
 * ASSUMED rules are listed in `ASSUMPTIONS` and copied onto every result:
 * eligibility classes not stated by the catalogue, greedy polarity
 * assignment, the melee objective without combo or stance multipliers.
 */

import type { ItemDbEntry } from './itemdb.ts';
import type { ModRow } from './moddb.ts';
import type { Effect } from './modstats.ts';
import type { RawAccount } from './account.ts';
import { oidOf } from './account.ts';
import { rankFromFingerprint } from './build.ts';
import { rankCost, type RankCost } from './fusion.ts';
import { routeTo, type Route } from './acquire.ts';
import { universal } from './factions.ts';
import { formaPlan, type FormaPlan } from './forma.ts';
import { survivability } from './survive.ts';
import {
  ARMOUR_CAP,
  armourAtLevel,
  CORROSIVE_DURATION_S,
  CORROSIVE_MAX_STACKS,
  VIRAL_DURATION_S,
  VIRAL_MAX_STACKS,
  bleedTick,
  combinedStrip,
  corrosiveStrip,
  heatStrip,
  igniteTick,
  landsAt,
  liveStatusTypes,
  liveStacks,
  moddedBaseDamage,
  netArmour,
  poisonTick,
  procTotal,
  procTypeWeights,
  viralMultiplier,
} from './armour.ts';
import {
  procsPerShot,
  averageCritMultiplier,
  capacity as capacityOf,
  combineElements,
  drainAtRank,
  magazineSize,
  moddedStat,
  physicalDamage,
  quantise32,
  reloadTime,
  slotDrain,
  sustainedDps,
  type Element,
  type Polarity,
} from './modded.ts';

/**
 * THE BEAM WIDTH, AND IT IS AT THE KNEE OF ITS OWN CURVE - measured, not chosen.
 *
 * A plan costs 0.8-1.4 s and the beam is nearly all of it: `score` is flat in
 * the number of mods (1.98 us at zero, 2.20 at eight, so the accumulation loop
 * is not the cost) and a plan makes on the order of 450,000 calls. The obvious
 * saving is a narrower beam, so it was measured across four real subjects at
 * five widths - and it is not available:
 *
 *          Braton ideal   Hek ideal   Skiajati ideal   plan ms
 *    25          938.49    7,752.86         2,360.85       166
 *    50          938.49   40,498.33         2,360.85       246
 *   100        2,656.04   46,320.48         4,896.83       441
 *   200        3,414.01   46,320.48         4,896.83       732
 *   400        3,414.01   46,320.48         4,896.83     1,414
 *   800        3,414.01   46,320.48         4,896.83     2,568
 *
 * Halving it to 100 costs the Braton 22 % of its build and quartering it costs
 * 72 %; the Hek loses 83 % at 25. And 400 and 800 return answers BYTE-IDENTICAL
 * to 200 - same ideal, same ceiling, same mods at the same ranks on all four -
 * for two and three and a half times the work.
 *
 * So 200 is the smallest width that has converged, and the second under this
 * comment is what a narrower one buys: a faster wrong answer. The time is the
 * price of the answer, not waste in it. Anyone tempted to trim this should
 * re-run the sweep rather than the intuition.
 */
export const BEAM = 200;
/**
 * The eight slots a mod grid holds, exported because the gate's exhaustive
 * enumeration has to obey the same limit the beam does - an enumeration allowed
 * nine mods is not comparing like with like.
 */
export const GRID_SLOTS = 8;

/*
 * THE GRID SIZE IS AN ASSUMPTION, AND IT ONLY BECAME ONE RECENTLY.
 *
 * Eight was a fact about the four arsenal rows this app was born reading. It is
 * a claim about the six categories added since - companion, companion weapon,
 * archwing, arch-gun, arch-melee, Necramech - and nothing this app can read
 * says what their grids actually hold. The catalogue carries no slot count at
 * all, and the account is worse than silent: `Configs[n].Upgrades` is
 * normalised by the game's own client to eleven entries for every item alike,
 * so its length says nothing about any of them.
 *
 * So it is stated rather than hidden. A plan for a thing that holds more than
 * eight is a plan for eight of them - understated, never overstated, because
 * the search never places a mod the grid was not given room for.
 */
export const GRID_ASSUMPTION = `the mod grid is planned as ${String(GRID_SLOTS)} slots for every moddable thing: no source this app has states the true count - the catalogue carries none, and the account normalises its slot array to eleven entries for every item alike - so a companion, an archwing or a Necramech that holds more is planned for ${String(GRID_SLOTS)} of them`;
/** Over-capacity sets per depth that get the rank-down treatment, strongest first. */
const RANK_DOWN_TRIES = 40;

/*
 * THE ASSUMED RULES, AND WHY THERE ARE TWO LISTS.
 *
 * There was one list, copied onto every result, and the moment Q3 existed four
 * of its seven entries became false: a Warframe has no Rifle eligibility class,
 * no melee attack speed, no Charge trigger, and no melee damage figure to be
 * half of. A plan for Ash was carrying "melee damage per second is HALF the
 * figure the game prints" - a true statement about weapons, attached to
 * something that has never held a weapon.
 *
 * Nothing renders these today, which is exactly why it was worth fixing now:
 * a false claim nobody reads is a false claim that gets believed the first time
 * somebody reads it.
 */
export const ASSUMPTIONS: readonly string[] = [
  'eligibility: a Rifle-class weapon takes Rifle, PRIMARY and Assault Rifle mods; a Launcher takes Rifle and PRIMARY only; Bow and Sniper add their own class (the catalogue does not state this; the wiki does for Rifle/Bow/Sniper, Assault Rifle and Launcher are assumed)',
  'polarity assignment is greedy (largest drain to the matching slot first), not an exact matching',
  'melee is scored per hit x attack speed with no combo and no heavy-attack multiplier; the stance itself carries no stats at all (all 63 in the catalogue have zero effects) and the capacity it adds IS counted, from the log own dump',
  'a Charge trigger is scored as if fire rate scaled linearly; the export carries no charge time',
  'mods whose effects Q1 does not score are never chosen and are counted as unscored',
  GRID_ASSUMPTION,
  /*
   * THE GRID HAS ELEVEN SLOTS AND THIS FILLS EIGHT, and the reason is the
   * OBJECTIVE rather than the data.
   *
   * A previous version of this note said the app "cannot tell" whether the
   * exilus slot is unlocked. That was wrong, and wrong in the way this codebase
   * is most prone to: a limitation asserted instead of checked. `data/build.ts`
   * has resolved it all along - `hasFeature(instance, UTILITY_SLOT)` on the
   * account's own item record, right beside the catalyst bit it already uses
   * for capacity, and the arcane slots next to that.
   *
   * The real reason is duller and firmer, and it is now MEASURED rather than
   * asserted - which matters, because the assertion was written when Q1 was the
   * only question and it stopped being true when Q2 arrived.
   *
   * Across all 116 utility mods in the catalogue, scored by the same rule the
   * search uses:
   *
   *   Q1  one hit, and it is Vile Precision at MINUS 36 % fire rate - a mod the
   *       search would never choose, so the slot stays empty anyway
   *   Q2  two, the other being Bhisaj-Bal at +90 % status - a Paris Prime
   *       augment, so it is one mod on one weapon in the entire game
   *   Q3  none at all; the 43 Warframe utility mods are parkour, sprint and
   *       aim glide, and none of them touches health, shields or armour
   *
   * So the slot is worth exactly zero everywhere except one bow under one
   * question, and building a ninth slot with its own capacity rules to hold one
   * mod would be machinery nobody could justify. `check-optimise` re-derives
   * those three counts from the catalogue, so the day an objective values
   * something utility - a status question, an ammo-economy question - the gate
   * fails and says the slot is now worth filling. The data to fill it is
   * already resolved and waiting.
   */
  'the exilus slot is left empty: of the 116 utility mods in the game, exactly one scores anything positive under the question being asked (Bhisaj-Bal, +90 % status, and only on Paris Prime under Q2), so every other candidate for the slot is worth exactly zero',
  /*
   * MEASURED AGAINST THE GAME, AND HALF.
   *
   * `scripts/measure-against-game.ts` compares this arithmetic with the numbers
   * the game printed on the player's own Upgrades panel for a real eight-mod
   * build. Critical chance lands EXACTLY, critical damage to the digit the game
   * rounds away, status exactly - so the mod arithmetic is right. Damage lands
   * at exactly half, uniformly, ratio 2.00003 across every damage type once the
   * app's own quantisation is taken out of the comparison - ON THAT BUILD. A
   * second panel on the same weapon, with a build the app models completely,
   * lands within 0.32 %, so the halving is not a property of melee.
   *
   * The factor is not explained. `docs/research/melee-base-damage.md` rules out
   * a stale catalogue (187 is confirmed in DE's own export, and six weapons
   * agree), a second damage mod, the combo multiplier, the stance and a
   * melee-wide rework. Three of the weapon's eleven slots have never been read
   * and the log's own dump is a different build, so they cannot be.
   *
   * NO CORRECTION IS APPLIED, on one weapon and an unexplained constant.
   *
   * WHAT IT DOES AND DOES NOT AFFECT, which is the reason the app is still
   * useful: a UNIFORM scale changes no ordering. Every candidate build is
   * multiplied by the same number, so the ideal build, the ranking of next
   * steps, and Now-against-Ideal as a ratio are all exactly what they would be
   * without it. Only the ABSOLUTE figures - the printed damage per second and
   * the printed gain - are affected, and only for melee, and only by this
   * factor. That claim is asserted by `check-optimise`.
   */
  'melee damage per second is HALF the figure the game prints, uniformly and for reasons unknown; rankings are unaffected because the factor is a uniform scale, but the absolute number is not the game\u2019s',
];

/**
 * What a WARFRAME plan assumes. Shorter than the weapon list because effective
 * health is a smaller claim: nothing in it is measured against a moving target.
 */
export const FRAME_ASSUMPTIONS: readonly string[] = [
  'eligibility: a Warframe takes WARFRAME mods and the augments that carry its own name (the catalogue states both)',
  'polarity assignment is greedy (largest drain to the matching slot first), not an exact matching',
  GRID_ASSUMPTION,
  /*
   * The honest boundary of this objective, and it is a wide one. Ability
   * Strength, Duration, Range and Efficiency are the other half of a real frame
   * build and they are NOT comparable to survival on one axis; `survive.ts`
   * carries the reasoning. They are counted as unscored rather than guessed at.
   */
  'only health, shields and armour are scored: ability strength, duration, range and efficiency are counted as unscored, because no exchange rate between them and survival exists that the player stated',
  'effective health is health x (1 + armour/300) + shields - the Tenno armour curve, which is not the enemy one',
  /*
   * THE AURA IS FILLED; THE EXILUS IS NOT, and the difference is whether the
   * objective values anything the slot accepts.
   *
   * This note used to say both were left empty "because effective health scores
   * none of the mods they accept". That was true of the exilus and false of the
   * aura, and the cost of the mistake was two whole effects: an aura's drain is
   * NEGATIVE, so it hands the eight grid slots more capacity, and Physique adds
   * twenty per cent maximum health - which is the exact thing being maximised.
   * On Ash it was worth 3,340 effective health against 4,049.
   */
  'the aura slot is filled and its capacity counted: an aura drain is negative, so it adds to what the eight slots may spend',
  'the exilus slot is left empty: none of the 43 Warframe utility mods affects health, shields or armour - they are parkour, sprint and aim glide - so every candidate for the slot is worth exactly zero',
  'which polarity the aura slot carries is not in the log, so it is treated as unpolarised and its capacity is not doubled - a matching polarity would give MORE room than this plans for, never less',
  'shields are counted at face value: recharge rate, gate delay and Overguard are not modelled, so a shield-tanking build is understated against a health one',
];

/** The rules a result assumes, which depend on what is being modded. */
/**
 * THE ATTACKS THIS WEAPON HAS THAT THE FIGURE DOES NOT COUNT.
 *
 * `itemdb.ts` parses six melee fields this module reads none of -
 * `comboDuration`, `followThrough`, `windUp`, `slamAttack`, `slideAttack` and
 * `heavyAttackDamage` - so a melee figure is the normal attack chain and
 * nothing else. That is a defensible objective: a slam build, a heavy build and
 * a follow-through build are play-style CHOICES, and which one a player is
 * making is not on the account.
 *
 * What is not defensible is saying nothing. `ASSUMPTIONS` does carry "no combo
 * and no heavy-attack multiplier", but that list is deliberately never shown -
 * only ITEM-SPECIFIC unknowns earn the panel's room, because a rifle plan
 * reciting a melee caveat is noise crowding out the ones that apply.
 *
 * WHICH attacks a weapon has IS item-specific, and it comes from the catalogue
 * rather than from a guess: a weapon with no `heavyAttackDamage` row has no
 * heavy attack to leave out. Measured across the real exports, 223 of 269 melee
 * weapons produce a line here and 0 of 195 primaries do.
 *
 * WHY THE HEAVY ATTACK IS NAMED RATHER THAN SCORED, which is the interesting
 * half. Its damage IS published as an absolute - `heavyAttackDamage` is the
 * weapon's total times a ratio whose median is exactly 5 and whose range is
 * 1 to 18 - and `windUp` is a charge time, median 0.70 s. Dividing one by the
 * other looks like a heavy-attack DPS with no assumption in it at all.
 *
 * It is not one, and the wiki says so in as many words. `Melee`, under Wind Up:
 * "Weapons have varying Wind-up times between activating a heavy attack and the
 * actual attack being performed... Increasing melee attack speed does not
 * reduce the wind-up time; rather, it reduces THE INTERVAL BETWEEN HEAVY
 * ATTACKS." So wind-up is the charge alone, a separate inter-attack interval
 * exists, and nothing publishes a value for it.
 *
 * Divide by wind-up anyway and the Skiajati reads 875 / 0.5 = 1,750 a second
 * against a normal chain of about 175 - every melee build in the game becomes a
 * heavy build at ten times the damage, on a term with a missing denominator.
 * This module has a rule for exactly that shape
 * (`pin-a-formula-by-its-boundaries`): with no ground truth, a formula that
 * would reorder every ranking does not ship. The chain figure has been measured
 * against the game to 0.32 %; the heavy has never been measured at all.
 *
 * WHAT IS EXACT IS THE DAMAGE. The same page gives the multiplier per weapon
 * class and confirms "Heavy attacks can be performed without a combo counter",
 * so at combo 1x a heavy is exactly the modded hit times that ratio - which is
 * why the line below carries the number instead of just the noun.
 *
 * So the honest treatment is to name it, which is what this does.
 *
 * Returns an empty array when there is nothing to say, so a caller can push
 * without a length check and a gun says nothing at all.
 */
export function uncountedAttacks(item: Pick<ItemDbEntry, 'heavyAttackDamage' | 'slamAttack' | 'slideAttack' | 'followThrough' | 'comboDuration' | 'totalDamage'>): string[] {
  const parts: string[] = [];
  if (item.heavyAttackDamage !== undefined) {
    /*
     * HOW MUCH IS OUTSIDE THE FIGURE, not merely that something is.
     *
     * The wiki gives the heavy multiplier per WEAPON CLASS - Heavy Blade 6x,
     * Fist 5x, Dagger 5x - and the export carries it per weapon as an absolute,
     * so the ratio is exact and needs nothing assumed: Gram Prime 300 -> 1,800
     * is the table's 6x for a Heavy Blade, the Skiajati's 175 -> 875 its 5x.
     *
     * The DAMAGE is what is exact. The RATE is not, which is why this is a
     * caveat and not a term - see the note above.
     */
    const ratio = item.totalDamage !== undefined && item.totalDamage > 0 ? item.heavyAttackDamage / item.totalDamage : null;
    parts.push(ratio === null ? 'heavy attacks' : `heavy attacks (${ratio % 1 === 0 ? String(ratio) : ratio.toFixed(1)}x a normal hit)`);
  }
  if (item.slamAttack !== undefined) parts.push('slams');
  if (item.slideAttack !== undefined) parts.push('slide attacks');
  if (item.followThrough !== undefined) parts.push('follow-through past the first target');
  /*
   * THE COMBO MULTIPLIER IS NOT ON THIS LIST, and the first version of it was.
   *
   * Listing combo as "not counted" implies the figure is understated by it, and
   * `docs/research/melee-base-damage.md` section C settles that it is not:
   * "the combo multiplier does not multiply normal-attack damage; combo count
   * is SPENT on heavy attacks. It is x1 on this screen regardless." - marked
   * REFUTED against the wiki's Melee_Combo page while chasing a factor of two
   * that turned out to be something else entirely.
   *
   * So a normal-attack figure with no combo term is not missing one. Combo
   * reaches the player's damage only through the heavy attack, which this list
   * already names. `comboDuration` stays parsed and unread for the same reason
   * `windUp` does - see the heavy-attack note below.
   */
  if (parts.length === 0) return [];
  const last = parts[parts.length - 1]!;
  const head = parts.slice(0, -1).join(', ');
  return [`the figure counts the normal attack chain only: ${head.length > 0 ? `${head} and ${last}` : last} are not in it`];
}

export function assumptionsFor(question: Question): readonly string[] {
  return question === 'Q3' ? FRAME_ASSUMPTIONS : ASSUMPTIONS;
}

/** Damage-type names as the export's damagePerShot orders them (see itemdb.ts). */
/*
 * DAMAGE_ORDER IS AN INDEX, and the vector build used to treat it as a list of
 * names. `damagePerShot` arrives indexed by this order, so a string-keyed Map
 * of amounts was a detour around an array that already existed - one Map
 * allocation, a closure per call for a twenty-entry `forEach`, and a Set for
 * the consumed types, on a function that runs about 450,000 times per plan.
 *
 * The two lookups below turn a type name into that index once at module load.
 */
const DAMAGE_ORDER = ['impact', 'puncture', 'slash', 'heat', 'cold', 'electricity', 'toxin', 'blast', 'radiation', 'gas', 'magnetic', 'viral', 'corrosive', 'void', 'tau', 'cinematic', 'shielddrain', 'healthdrain', 'energydrain', 'true'] as const;

/** `type` -> its position in `DAMAGE_ORDER`, so the vector build can use arrays. */
const DAMAGE_INDEX: Readonly<Record<string, number>> = Object.fromEntries(DAMAGE_ORDER.map((t, i) => [t, i]));
/** Reused across calls: `score` is synchronous and never re-entered. */
const AMOUNTS = new Float64Array(DAMAGE_ORDER.length);
const CONSUMED = new Uint8Array(DAMAGE_ORDER.length);
const PRIMARY_ELEMENTS: readonly Element[] = ['heat', 'cold', 'electricity', 'toxin'];

/*
 * THE QUESTIONS THIS OPTIMISER CAN ANSWER.
 *
 * Q1 - sustained damage per second to UNARMOURED health, no status, no
 *      headshots, no faction, no conditional effects. It is the honest floor:
 *      everything it counts is exact, and it counts very little.
 *
 * Q2 - sustained damage per second against ARMOURED health at the game's own
 *      armour cap, counting the damage-over-time procs. It exists because Q1
 *      is not merely narrow but MISLEADING at the top of the game: bleed
 *      ignores armour outright, so at 2,700 armour a slash proc lands at full
 *      value while every direct hit lands at a tenth of it. A ranking that
 *      cannot see that is not a ranking of what the weapon does.
 *
 * Q3 - EFFECTIVE HEALTH, for a Warframe. A frame has no damage number to
 *      maximise, and until this existed the overlay identified the frame and
 *      then said nothing at all. Replaying the player's own log found that FOUR
 *      of their ten modding-screen visits were the Warframe slot: 40 % of the
 *      modding this account does, unserved, and nothing in the project could
 *      see it until the log was read.
 *
 * None is "the" answer and the overlay always names which one it gave.
 */
export type Question = 'Q1' | 'Q2' | 'Q3';

/**
 * Item types whose question is SURVIVAL rather than damage.
 *
 * A Warframe was the only one for a long time, and the reason the others were
 * not here is that nobody had looked: a Sentinel, a Kavat, a Kubrow and an
 * Archwing all carry `health`, `shield` and `armor` in the same export fields a
 * Warframe does, and `survivability` reads exactly those three. Q3 needs no
 * change at all to answer for them - only to be asked.
 */
export const SURVIVAL_TYPES: ReadonlySet<string> = new Set(['Warframe', 'Sentinel', 'Pets', 'Archwing']);

/** Which question this item is asked. Damage unless it is a thing that gets shot at. */
export function questionFor(item: Pick<ItemDbEntry, 'type'>): Question {
  return SURVIVAL_TYPES.has(item.type ?? '') ? 'Q3' : 'Q2';
}
export const QUESTION_TEXT: Record<Question, string> = {
  Q1: 'sustained damage per second to unarmoured health: no status, no headshots, no faction, no conditional effects',
  Q2: 'sustained damage per second against 2,700 armour, counting bleed, ignite and poison: no armour stripping, no headshots, no faction, no conditional effects. The mod arithmetic feeding it is exact against the game; how the terms compose has no panel to check against, so it is pinned by its boundaries instead - bleed bypasses armour and ignite does not, in a ratio of exactly 7',
  Q3: 'effective health: health multiplied by armour on the Tenno curve, plus shields; ability strength, duration, range and efficiency are not scored and are counted as unscored',
};

/** The level the brief names, and the level this objective is aimed at. */
export const Q2_TARGET_LEVEL = 9999;

/**
 * The lowest base armour that still reaches the cap by level 9999.
 *
 * Derived rather than chosen: `armourAtLevel` is solved for the smallest
 * integer base whose 9999 value clamps. Seven does; six does not. Every
 * armoured unit DE ships is far above it - a Grineer Lancer starts at 100 - so
 * the cap is the honest target for the whole armoured half of the game, and
 * this constant is what says so rather than an assertion in a comment.
 */
export const CAP_REACHING_BASE_ARMOUR = (() => {
  for (let base = 1; base <= 64; base++) {
    if (armourAtLevel({ baseArmour: base, baseLevel: 1, level: Q2_TARGET_LEVEL }) >= ARMOUR_CAP) return base;
  }
  return ARMOUR_CAP;
})();

/**
 * THE TARGET Q2 ANSWERS AGAINST - now COMPUTED at level 9999 rather than stated.
 *
 * Nothing in this app knows an enemy: there is no armour, health, level or unit
 * table anywhere in `src/data`, and DE publishes none either - all sixteen
 * PublicExport files were fetched and enumerated and there is no enemy export
 * (`docs/DATA-SOURCES.md`). So Q2 still cannot say "a level 150 Bombard" and
 * mean it.
 *
 * What it CAN do is state the target as the ARITHMETIC that produces it. This
 * used to read `= ARMOUR_CAP` with a paragraph explaining that level scaling
 * cannot exceed the cap; the explanation was right and nothing checked it.
 * `armourAtLevel` carries the Update 36 curve - `f1 = 1 + 0.005 q^1.75`,
 * `f2 = 1 + 0.4 q^0.75`, smoothstepped over q in [70, 80], clamped to
 * [200, 2700] - so the target is now that curve evaluated at 9999 for a unit
 * that is armoured at all. It comes out at the cap, which is the point: the
 * claim is now a computation that would fail if the curve or the cap moved.
 *
 * It is also where the question matters most. At the cap a direct hit lands at
 * a tenth and a bleed lands whole, so this is precisely the case a ranking that
 * cannot see bleed gets wrong - which is what Q1 does. The overlay prints the
 * target beside the figure; a damage number without the target it was computed
 * against is not a measurement.
 *
 * WHAT THIS STILL DOES NOT MODEL, named rather than absorbed: a target's
 * SHIELDS, and damage attenuation. Toxin bypasses shields the way slash
 * bypasses armour, so a shielded target reverses which of the two a build wants
 * - and shields are a separate pool rather than a percentage, which is a
 * different kind of arithmetic from anything here. Attenuation is in
 * `armour.ts`'s `UNKNOWN` because the wiki carries an UpdateMe on the section
 * and publishes only per-enemy constants. Neither is guessed at.
 */
export const Q2_TARGET_ARMOUR = armourAtLevel({
  baseArmour: CAP_REACHING_BASE_ARMOUR,
  baseLevel: 1,
  level: Q2_TARGET_LEVEL,
});

export interface Candidate {
  row: ModRow;
  /** The rank this run may use: owned rank for Now, fusionLimit for Ideal. */
  rank: number;
  polarity: Polarity;
  drain: number;
  /** `family(row)`, computed once: the conflict check runs on every expansion. */
  family?: string;
  /**
   * The candidate's index in the pool, assigned by `search`. It exists only to
   * make the duplicate-set check cheap: the key used to be every mod's path,
   * sorted and joined - eight strings of about forty-five characters, built for
   * every one of the ~190,000 expansions a search makes and thrown away for the
   * ninety-odd per cent that were duplicates. Sorted small integers say the same
   * thing about the same sets.
   */
  id?: number;
}

export interface Placed {
  path: string;
  name: string;
  rank: number;
  maxRank: number;
  polarity: Polarity;
  slotPolarity: Polarity;
  drain: number;
  /*
   * WHAT THE OVERLAY NEEDS TO DRAW THIS AS A CARD.
   *
   * The overlay lays the ideal build out on the game's own eight mod slots, so
   * every placed mod has to become a real card: rarity is the frame's colour,
   * and the rank the account already holds is what separates "you have this,
   * done" from "you have it, rank it" from "you do not have it at all". Without
   * those two the grid can only print names, which is what the strip did.
   */
  rarity: string | null;
  /** The rank the account holds; null when it holds none. Filled by `plan`, not by `search`. */
  ownedRank: number | null;
  /*
   * HOW TO GET IT, for a mod the account does not have.
   *
   * "You are missing this" is where the advice used to stop. The route turns it
   * into something to do tonight - a place and roughly how many runs - or says
   * plainly that it does not drop and has to be traded for, or that nobody
   * knows. Null for a mod the account already holds, where the question does
   * not arise.
   */
  route: Route | null;
}

export interface Scored {
  /** The objective's value; DPS for Q1. */
  value: number;
  perShot: number;
  pellets: number;
  critChance: number | null;
  critDamage: number | null;
  fireRate: number | null;
  magazine: number | null;
  reload: number | null;
  /** Damage by type after combination, in resolution order. */
  damage: Array<{ type: string; amount: number }>;
  /*
   * WHETHER THIS FIGURE HAS BEEN CHECKED AGAINST THE GAME, and what came of it.
   *
   * null when nothing is known either way, which is the honest state for every
   * weapon class nobody has compared. A string when there IS something to say -
   * and right now there is exactly one thing: melee comes out at half what the
   * game prints (`scripts/measure-against-game.ts`), uniformly and for reasons
   * `docs/research/melee-base-damage.md` could not settle.
   *
   * The overlay renders it with the game's own marker - the small diamond the
   * Upgrades panel puts after Slam Attack and Status - because printing a
   * number you know disagrees with the game, unmarked, is the one thing this
   * app must not do.
   */
  figureNote: string | null;
  /*
   * THE WORST MATCHUP THIS BUILD HAS, and the target it is worst against.
   *
   * Q2 multiplies its whole figure by this, so it is already inside the number
   * - but the number alone says nothing a player can act on. The matchup does:
   * "0.76 against Infested Deimos" names the element to trade, and it is the
   * one thing on the panel nobody could work out for themselves. It comes from
   * a minimum over 29 targets, the game's own 15 factions and 14 health layers,
   * recomputed on every placement.
   *
   * Null under Q1 and Q3, which do not ask the question.
   */
  weakest: { against: string; factor: number } | null;
}

export interface BuildResult {
  question: Question;
  placed: Placed[];
  /**
   * The Warframe aura, which is a ninth slot and not one of the eight. Null for
   * every weapon, and for a frame whose best answer takes no aura. Its `drain`
   * is negative: it is what the aura ADDS to the capacity the eight spend.
   */
  aura: Placed | null;
  /** After the aura's contribution, which is why a frame's capacity can exceed 60. */
  capacity: number;
  drain: number;
  fits: boolean;
  score: Scored;
  /** Effects on the placed mods that Q1 did not weigh. */
  unscored: number;
  assumptions: readonly string[];
}

export interface NextStep {
  path: string;
  name: string;
  /** null when the account owns none of it; otherwise the rank it owns. */
  ownedRank: number | null;
  targetRank: number;
  /** Q1 value of Now with this one change, minus Now. */
  gain: number;
  /*
   * THE CARD'S ANATOMY. The overlay draws a recommendation as the game draws a
   * mod - a crowned card with a rarity-coloured frame, a drain chip carrying
   * the number and the polarity glyph, and a row of rank pips - so the step
   * carries what that card needs. Writing the name as a line of text throws
   * the game's entire vocabulary away, which is what the first version did.
   */
  rarity: string | null;
  polarity: Polarity;
  /** Drain at `targetRank`, before any polarity adjustment. */
  drain: number;
  /** `fusionLimit`: how many pips the card has in total. */
  maxRank: number;
  /*
   * WHAT IT COSTS TO DO THIS.
   *
   * "Take Sacrificial Steel from 5 to 10" is not advice until it says 15,360
   * Endo and 741,888 credits, because the account may hold 800 Endo and the
   * whole recommendation then belongs to a different evening. The curve is in
   * `data/fusion.ts` and is checked against nine prices the client itself
   * printed into EE.log.
   *
   * null when the catalogue has no rarity for the row, because an unknown cost
   * must stay unknown - this is the number that decides whether the app tells
   * somebody they can afford something. Affordability is NOT computed here: the
   * optimiser never reads the account's balances, so the cost stays a property
   * of the mod and the controller pairs it with the purse.
   */
  cost: RankCost | null;
}

/**
 * ONE RUNG OF THE STAIRCASE FROM NOW TO IDEAL.
 *
 * `next` answers "what is the single best thing to do", and it answers it
 * correctly - each gain is measured from Now with that one change. What it
 * cannot answer is "and then what", because every entry in it is measured
 * against the same Now: do the top one and every other number in the list is
 * about a build that no longer exists. Sorting them better does not fix that;
 * they are answers to a question that stops being asked after the first step.
 *
 * A rung is the fix. The ladder is built by committing the best step, then
 * asking again against the build that step produced, so the second rung is
 * measured against the first rung's build and the fifth against the fourth's.
 * `value` is what the build scores once this rung is done and `gain` is over the
 * rung before it, which makes the whole sequence readable as one arc rather than
 * five competing claims.
 *
 * FORMA IS A RUNG TOO, and it has to be, or the ladder stops early and lies
 * about why. Capacity is what binds once the cheap mods are in: the next mod
 * physically does not fit, so its gain measures zero, so it sorts last, and a
 * list of mods would present the most important remaining mod as the least
 * urgent. When no mod alone can improve the build, the binding constraint is
 * the grid, and the honest instruction is which polarity to Forma next.
 */
export type Rung =
  | {
      step: number;
      kind: 'mod' | 'aura';
      path: string;
      name: string;
      rarity: string | null;
      polarity: Polarity;
      /** The rank the account holds, or null when it holds none of it. */
      fromRank: number | null;
      toRank: number;
      drain: number;
      maxRank: number;
      cost: RankCost | null;
      route: Route | null;
      value: number;
      gain: number;
    }
  | {
      step: number;
      kind: 'forma';
      polarity: Polarity;
      value: number;
      gain: number;
      /*
       * True when this Forma buys nothing on its own and is here because the
       * rung after it needs the slot. Said rather than hidden: "Forma, +0" with
       * no explanation reads as a mistake, and a player who has modded anything
       * knows perfectly well that polarising comes before the mod that uses it.
       */
      groundwork: boolean;
    }
  /*
   * A STEP ON THE STAR CHART RATHER THAN IN THE ARSENAL.
   *
   * The brief asks the overlay to take into account WHEN the player might get a
   * mod. The honest form of that is not a date - nothing here can predict one -
   * but a prerequisite: every remaining step drops on a planet the account has
   * not opened, and the chart knows exactly how far away that is and which node
   * opens it.
   *
   * Without this the ladder simply stops when nothing reachable is left, and
   * "nothing further to do" is the one thing that is definitely not true: there
   * is plenty to do, it is just not on this screen.
   */
  | { step: number; kind: 'unlock'; planet: string; nodes: number; node: string; nodeName: string; value: number; gain: 0 };

export interface Plan {
  now: BuildResult;
  /** The best build on the grid the account ACTUALLY HAS. This is what the overlay lays out on the slots. */
  ideal: BuildResult;
  /*
   * WHAT THIS ITEM CAN EVER BE, which is not the same question and was never
   * asked.
   *
   * `ideal` is searched against the account's own grid, so it is capped by the
   * polarities that grid happens to carry - and it always fits, by
   * construction. That made the whole plan silent about the half of the brief
   * that asks what to do to push a build PAST what the player is currently
   * capable of, because on the app's own terms they were already at the top.
   *
   * The ceiling is the same search on a grid where every slot matches the mod
   * in it. One pass on eight universal slots gets there for everything but
   * Umbra - a universal slot halves any other polarity's drain - and a second
   * pass on the first pass's own polarities picks up the Umbra mods a universal
   * slot charges full price for. Two searches, no iteration to tune.
   *
   * `ceiling.score.value >= ideal.score.value` always: the ceiling's grid is
   * strictly more generous, so it can only place a build at least as good.
   */
  ceiling: BuildResult;
  next: NextStep[];
  /*
   * WHAT THE IDEAL BUILD WOULD COST IN FORMA, which is the "future proofing"
   * half of the question the brief asks.
   *
   * Every mod wants a slot of its own polarity; the account's grid supplies
   * some; the deficit is the Forma count, exactly and minimally. It says how
   * many and to which polarities - never which physical slot, because the grid's
   * index order is a named unknown and a per-slot instruction would be a guess
   * wearing the clothes of a fact.
   */
  forma: FormaPlan;
  candidates: { eligible: number; scored: number; owned: number };
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/** Which catalogue `slot` (compatName) values a weapon of this export `type` accepts. */
export function eligibleSlots(item: Pick<ItemDbEntry, 'type' | 'name' | 'productCategory'>): Set<string> {
  const out = new Set<string>();
  if (item.name) out.add(item.name); // per-weapon augments carry the weapon's name
  /*
   * A Warframe takes WARFRAME mods, plus the augments that carry its own name -
   * which the line above already handles, because a frame augment is keyed the
   * same way a weapon augment is.
   */
  /*
   * A NECRAMECH IS TYPED 'Warframe' AND TAKES NONE OF A WARFRAME'S MODS.
   *
   * Voidrig and Bonewidow live in `Warframes.json` with `type: 'Warframe'` and
   * `productCategory: 'MechSuits'`. So this line handed a mech the 142
   * `WARFRAME` mods - Vitality, Steel Fiber, Redirection, every one of which it
   * cannot equip - and would have built a confident, complete, entirely
   * unusable plan for it. That is worse than not covering mechs at all, and it
   * was live before this branch existed.
   *
   * Their own 28 mods are compatName `Necramech`, and three of them - Necramech
   * Vitality, Necramech Steel Fiber, Necramech Redirection - give health, armor
   * and shield capacity, which is Q3's stat set. The mech carries health 1880 /
   * shield 430 / armor 480 (Bonewidow) in the same export fields Q3 reads, so
   * the question was already right; only the pool was wrong.
   */
  const mech = item.productCategory === 'MechSuits';
  if (item.type === 'Warframe') out.add(mech ? 'Necramech' : 'WARFRAME');
  const t = item.type ?? '';
  switch (t) {
    case 'Rifle':
      ['Rifle', 'PRIMARY', 'Assault Rifle'].forEach((s) => out.add(s));
      break;
    case 'Launcher':
      ['Rifle', 'PRIMARY'].forEach((s) => out.add(s));
      break;
    case 'Bow':
      ['Rifle', 'PRIMARY', 'Bow'].forEach((s) => out.add(s));
      break;
    case 'Sniper':
      ['Rifle', 'PRIMARY', 'Sniper'].forEach((s) => out.add(s));
      break;
    case 'Shotgun':
      ['Shotgun', 'PRIMARY'].forEach((s) => out.add(s));
      break;
    case 'Pistol':
    case 'Dual Pistols':
    case 'Throwing':
      out.add('Pistol');
      break;
    case 'Melee':
      out.add('Melee');
      break;

    /*
     * ── THE OTHER MODDABLE THINGS ────────────────────────────────────────
     *
     * Four slots were covered because four were all the arsenal's top row
     * shows, and the rest was written off as needing a scoring question that
     * did not exist. Measured against the real exports, that was wrong twice:
     *
     *   Sentinels carry health 560 / shield 250 / armour 80, Kavats 310/270/300
     *   and Archwings 650/220/195 - the exact three fields `survivability`
     *   reads - and their `COMPANION` and `Archwing` mods give health, shield
     *   capacity and armor, which is exactly Q3's stat set.
     *
     *   Arch-Guns carry damagePerShot, multishot, criticalChance,
     *   criticalMultiplier, procChance, fireRate, magazineSize and reloadTime -
     *   field for field what a Braton carries - and `Archgun` mods give fire
     *   rate, multishot, status chance and elements. That is Q2 unchanged.
     *
     * So nothing here is a new objective. What was missing was this switch
     * knowing the compatibility names, which the catalogue has always carried:
     * `Archgun` 38 rows, `COMPANION` 26, `Archmelee` 20, `Archwing` 12,
     * `ROBOTIC` 11, `BEAST` 10, `Sentinel` 7.
     *
     * WHAT IS DELIBERATELY NOT HERE, and each for its own measured reason.
     *
     * K-Drive's 23 mods give k-drive speed, grind magnetism, trick score and
     * jump height. Parazon's 40 give hacking chance and parkour speed. Not one
     * of either is scored by any question here, and a build ranked by an
     * objective that cannot see the mods is worse than no build.
     *
     * The operator/amp `ANY` set (20) is refused for a subtler reason worth
     * writing down: it DOES carry weapon stats - amp critical chance, amp
     * multishot, amp fire rate, amp status chance - but under amp-specific
     * names that Q2's stat set does not contain, and the amps themselves are
     * not in `ITEM_CATEGORIES` at all. Both would have to change together.
     *
     * `Companion Weapon` is refused because the seven `Sentinel` mods mix the
     * sentinel's own behaviour with its weapon's, and which belong to which is
     * not settled by the export.
     */
    case 'Sentinel':
      ['Sentinel', 'COMPANION', 'ROBOTIC'].forEach((x) => out.add(x));
      break;
    /*
     * `Warframe` is the mech's own type, handled above; this case exists for
     * the day the export gives them one of their own, so a rename cannot
     * silently drop them back into the WARFRAME pool.
     */
    case 'Necramech':
      out.add('Necramech');
      break;
    case 'Pets': {
      /*
       * `Pets` IS FOUR DIFFERENT ANIMALS, AND THEY DO NOT SHARE A MOD POOL.
       *
       * Verified against `Pets.json`: Lambeo/Oloro/Para/Nychus Moa and
       * Bhaira/Dorma/Hec Hound all carry `type: 'Pets'` alongside the Kavats
       * and Kubrows. This handed every one of them the ten `BEAST` mods -
       * Fetch, Scavenge, Hunter Command, beast-only - and never once offered
       * the eight `Moa` or nine `Hound` mods that exist in the catalogue. A moa
       * was being planned with a kubrow's build.
       *
       * `COMPANION` is the only class all four share. The rest is decided by
       * the item's own name, which is data rather than a guess - and the
       * Vulpaphylas and Predasites are Kubrow-mod users the first version of
       * this regex missed entirely.
       */
      out.add('COMPANION');
      const name = item.name ?? '';
      if (/\bmoa\b/i.test(name)) out.add('Moa');
      else if (/hound/i.test(name)) out.add('Hound');
      else {
        // Beasts: kavats, kubrows, predasites, vulpaphylas.
        out.add('BEAST');
        if (/kavat/i.test(name)) out.add('Kavat');
        if (/kubrow|helminth charger|predasite|vulpaphyla/i.test(name)) out.add('Kubrow');
      }
      break;
    }
    case 'Archwing':
      out.add('Archwing');
      break;
    case 'Arch-Gun':
      out.add('Archgun');
      break;
    case 'Arch-Melee':
      out.add('Archmelee');
      break;
    default:
      break;
  }
  return out;
}

/*
 * FLAWED MODS ARE NEVER AN ANSWER, and the overlay shipped telling the player
 * to farm one for a thousand runs.
 *
 * A Flawed mod is the tutorial handout: a strictly weaker version of a real mod
 * with a lower maximum rank and a lower drain. The lower drain is why the search
 * kept choosing them - at a binding capacity a weaker mod that costs four points
 * beats a stronger one that costs seven, and the arithmetic is right. What came
 * out of it was not: "Flawed Jagged Edge - Scrofa Crewman, about 1000 runs", an
 * instruction to grind a thousand missions for a mod the game gives away in the
 * first hour and that every account already has.
 *
 * They are excluded from the pool entirely rather than penalised. There is no
 * account and no capacity at which acquiring one is the right next move, and the
 * only honest use of the word "ideal" excludes them.
 *
 * `moddb` already flags them - `isFlawed`, from the `Beginner` path segment.
 * The first version of this fix tested the NAME for a "Flawed " prefix and
 * caught nothing at all, because the export does not carry the prefix: it is
 * `displayName` that the catalogue builds. Nothing threw; the build simply
 * still had Flawed Steel Fiber in it.
 */
/** Variants of one mod cannot share a build: Primed/Flawed/Galvanized/Amalgam/Umbral/Sacrificial/Archon X are the X family. */
export function family(row: Pick<ModRow, 'name'>): string {
  return row.name.replace(/^(Primed|Flawed|Galvanized|Amalgam|Umbral|Sacrificial|Archon|Arcane) /, '').toLowerCase();
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/*
 * The stat keys each question reads. Anything else on a mod is unscored, and
 * the strip prints that count - so this set is also a claim about what the
 * answer does NOT account for.
 *
 * It is per question and not global for a reason that is easy to get wrong: if
 * Q2's status keys were simply added to one shared set, Q1 would start counting
 * status mods as "scored" while still ignoring them in its value. Its unscored
 * count would fall, its answer would not change, and the strip would report
 * more confidence than the arithmetic had earned.
 */
const SCORED_BY_QUESTION: Readonly<Record<Question, ReadonlySet<string>>> = {
  Q1: new Set(['damage', 'multishot', 'critical chance', 'critical damage', 'fire rate', 'attack speed', 'reload speed', 'magazine capacity', 'melee damage']),
  Q2: new Set([
    'damage',
    'multishot',
    'critical chance',
    'critical damage',
    'fire rate',
    'attack speed',
    'reload speed',
    'magazine capacity',
    'melee damage',
    // Q2's whole reason for existing: a proc has to be landed before it ticks.
    'status chance',
  ]),
  /*
   * Q3 reads three keys and no more. Ability Strength, Duration, Range and
   * Efficiency are deliberately absent: they are the other half of a real
   * Warframe build and they are NOT comparable to survival on one axis. More
   * Range is not worth n points of health, and any exchange rate between them
   * would be this app inventing a preference the player never stated. They fall
   * through to `unscored`, which the overlay prints.
   */
  /*
   * THE NAMES ARE THE CATALOGUE'S, AND TWO OF THEM WERE GUESSED.
   *
   * This set was written as `health, shield, armor, armour` from what the stats
   * are called in English. Listing what the parser actually emits across every
   * Warframe and aura mod says otherwise, and the guess cost two whole classes
   * of mod:
   *
   *   health           add_pct  self   84 rows   scored
   *   armor            add_pct  self   62 rows   scored
   *   shield capacity  add_pct  self   55 rows   SCORED NOTHING - "shield" matches no row
   *   maximum health   add_pct  squad   6 rows   SCORED NOTHING - the auras
   *   armor            add_pct  squad   6 rows   SCORED NOTHING - the auras
   *
   * So every shield mod in the game - Redirection included - was worth exactly
   * zero to an objective whose whole job is how much a frame can take. `shield`
   * and `armour` are kept only because they cost nothing and a rename upstream
   * would otherwise be silent; `check-optimise` asserts the real names.
   *
   * `max shield capacity` (multiply, 4 rows) is deliberately NOT here. Its op
   * is a multiplication, not a percentage added to a bucket, and adding its
   * value to `shieldPct` would be wrong by a factor nobody would notice. It
   * stays unscored, and the overlay prints the count.
   */
  Q3: new Set(['health', 'maximum health', 'shield capacity', 'armor', 'shield', 'armour']),
};

/**
 * Memoised per (row, rank, question): the beam evaluates the same mod at the
 * same rank tens of thousands of times per search, and the first version
 * re-walked the row's effects on every evaluation - 39 s for the gate's fifteen
 * searches.
 *
 * THE KEY IS A NUMBER, and it used to be `${question}:${rank}`. A template
 * literal ALLOCATES A STRING on every call, hit or miss, and this is one of the
 * hottest functions in the app - a CPU profile of a single Skiajati plan put
 * 57 ms in `scoredEffects` itself, on a cache that never misses after the first
 * few hundred calls. The work was the key, not the lookup.
 *
 * `rank * 4 + questionIndex` is unique because there are three questions and
 * rank is a non-negative integer, and it costs nothing.
 */
const QUESTION_INDEX: Record<Question, number> = { Q1: 0, Q2: 1, Q3: 2 };
const SCORED_CACHE = new WeakMap<ModRow, Map<number, { used: Effect[]; statusScaled: Effect[]; unscored: number }>>();

/**
 * The one scaling basis that is a property of the BUILD rather than of the
 * fight. Matched loosely because the catalogue's wording varies in case and in
 * whether it says "affecting the target"; every variant means the same thing.
 */
const PER_STATUS_TYPE = /status type/i;

export function scoredEffects(row: ModRow, rank: number, question: Question): { used: Effect[]; statusScaled: Effect[]; unscored: number } {
  let byRank = SCORED_CACHE.get(row);
  if (!byRank) {
    byRank = new Map();
    SCORED_CACHE.set(row, byRank);
  }
  // The key carries the QUESTION as well as the rank. Keyed on rank alone, the
  // first question to evaluate a row would have decided what every later
  // question could see on it - a cache that silently answers the wrong question.
  const key = rank * 4 + QUESTION_INDEX[question];
  const hit = byRank.get(key);
  if (hit) return hit;
  const used: Effect[] = [];
  /** Effects whose magnitude is `value x (status types live on the target)`. */
  const statusScaled: Effect[] = [];
  let unscored = 0;
  for (const e of row.effects) {
    if (e.rank !== rank) continue;
    /*
     * A SQUAD EFFECT INCLUDES THE PLAYER. Auras read as `squad` - "Squad gains
     * +20% Maximum Health" - and requiring `self` meant every aura in the game
     * scored zero, on the one item type that has an aura slot. Enemy and
     * companion targets are still excluded, which is what keeps Corrosive
     * Projection's "Enemies lose -18% Armor" out of the player's armour bucket.
     */
    /*
     * A SCALING BASIS IS A CONDITION, and this check used to miss it entirely.
     *
     * `modstats.ts` parses "+80% Melee Damage per Status Type affecting the
     * target" correctly - the magnitude into `value`, the "per X" into
     * `scalingBasis` - and this line only ever looked at `conditions`. So an
     * effect whose value depends on something the app cannot measure arrived
     * with an empty condition list and was scored AT FACE VALUE.
     *
     * Measured across the catalogue: five mods, seven effect-question pairs.
     * They are not obscure ones. Condition Overload (+80 % melee damage per
     * status type) and Cull The Weak (+60 %) were being credited as flat damage
     * mods under Q1 and Q2; Weeping Wounds (+40 % status per combo multiplier)
     * under Q2; Pack Leader and Primed Pack Leader (+100 and +183 health per
     * hit) under Q3. Condition Overload at a flat +80 % beats almost anything
     * in the ranking, which is exactly what it was doing.
     *
     * THIS SAID ALL THREE BASES WERE UNDERIVABLE AND IT WAS WRONG ABOUT ONE.
     *
     * The combo multiplier and hits landed are genuinely facts about a fight in
     * progress: they depend on how somebody plays, and scoring them would mean
     * inventing a playstyle. STATUS TYPES ON THE TARGET ARE NOT. They are a
     * function of the build's own proc rate and its own damage composition -
     * both of which this very function's caller already computes, to derive the
     * corrosive strip and the viral multiplier. The app had the number and
     * refused to use it because a comment said it could not.
     *
     * This is the third time this project has shipped a false "the app cannot
     * know that", and the cost here was the largest of the three: "Status Type
     * affecting the target" is the biggest scaling basis in the catalogue - 45
     * effects - and it is led by CONDITION OVERLOAD, which is the mod a real
     * level-9999 melee build is built around. Scored at nothing, it was never
     * recommended, so the optimiser's answer was the best build in a game where
     * Condition Overload does not exist. 85 mods were worth nothing at all.
     *
     * So it gets its own bucket rather than being folded into `used`: `used` is
     * applied per mod and this has to be multiplied by a count only the whole
     * BUILD knows. Everything else still goes to `unscored`, which the panel
     * says out loud - a number the app cannot compute is named, never invented.
     */
    const scales = e.scalingBasis !== undefined;
    const unconditional = e.conditions.length === 0 && !scales && (e.target === 'self' || e.target === 'squad');
    const elemental = e.op === 'add_pct' && e.damageType !== undefined && DAMAGE_ORDER.includes(e.damageType.toLowerCase() as (typeof DAMAGE_ORDER)[number]);
    const scorable = e.value !== null && (SCORED_BY_QUESTION[question].has(e.stat) || elemental);
    const perStatus =
      e.conditions.length === 0 &&
      (e.target === 'self' || e.target === 'squad') &&
      e.scalingBasis !== undefined &&
      PER_STATUS_TYPE.test(e.scalingBasis);
    if (unconditional && scorable) used.push(e);
    else if (perStatus && scorable) statusScaled.push(e);
    else unscored++;
  }
  const out = { used, statusScaled, unscored };
  byRank.set(key, out);
  return out;
}

export function score(item: ItemDbEntry, mods: ReadonlyArray<{ row: ModRow; rank: number }>, question: Question = 'Q1'): { score: Scored; unscored: number } {
  const base = item.damagePerShot ?? null;
  const baseTotal = base ? base.reduce((a, b) => a + b, 0) : (item.totalDamage ?? 0);
  let damagePct = 0;
  let multishotPct = 0;
  let ccPct = 0;
  let cdPct = 0;
  let ratePct = 0;
  let reloadPct = 0;
  let magPct = 0;
  /** Q2 only; Q1 never puts a status mod in `used`, so this stays zero there. */
  let statusPct = 0;
  /**
   * Per cent of damage PER STATUS TYPE live on the target - Condition Overload
   * and the 44 other effects that scale on the same basis. Summed here and
   * multiplied by the count below, once the build's own proc rate is known.
   */
  let statusScaledPct = 0;
  /** Q3 only, and zero under every other question for the same reason. */
  let healthPct = 0;
  let shieldPct = 0;
  let armourPct = 0;
  const physical: Record<'impact' | 'puncture' | 'slash', number> = { impact: 0, puncture: 0, slash: 0 };
  const elementOrder: Element[] = [];
  const elementPct = new Map<Element, number>();
  let unscored = 0;

  for (const m of mods) {
    const s = scoredEffects(m.row, m.rank, question);
    for (const e of s.statusScaled) if (e.value !== null) statusScaledPct += e.value;
    unscored += s.unscored;
    for (const e of s.used) {
      const v = e.value ?? 0;
      const dt = e.damageType?.toLowerCase();
      if (dt === 'impact' || dt === 'puncture' || dt === 'slash') physical[dt] += v;
      else if (dt && (PRIMARY_ELEMENTS as readonly string[]).includes(dt)) {
        const el = dt as Element;
        if (!elementPct.has(el)) elementOrder.push(el);
        elementPct.set(el, (elementPct.get(el) ?? 0) + v);
      } else if (dt) unscored++; // a combined-element mod (blast, radiation…): not modelled by Q1
      else if (e.stat === 'damage' || e.stat === 'melee damage') damagePct += v;
      else if (e.stat === 'multishot') multishotPct += v;
      else if (e.stat === 'critical chance') ccPct += v;
      else if (e.stat === 'critical damage') cdPct += v;
      else if (e.stat === 'fire rate' || e.stat === 'attack speed') ratePct += v;
      else if (e.stat === 'reload speed') reloadPct += v;
      else if (e.stat === 'magazine capacity') magPct += v;
      else if (e.stat === 'status chance') statusPct += v;
      else if (e.stat === 'health' || e.stat === 'maximum health') healthPct += v;
      else if (e.stat === 'shield' || e.stat === 'shield capacity') shieldPct += v;
      else if (e.stat === 'armor' || e.stat === 'armour') armourPct += v;
    }
  }

  // Damage vector: physical scaled by its own mods, quantised; elements added on base, quantised.
  /*
   * THE VECTOR, ON ARRAYS. Identical arithmetic to the Map version it replaces -
   * `check-optimise` holds it against exhaustive enumeration and against the
   * exact strip, viral and faction figures - with the allocations removed:
   * `AMOUNTS` and `CONSUMED` are module scratch, the twenty-entry walk is an
   * indexed loop rather than a `forEach` closure, and `innate` is filled in the
   * same pass instead of by a second `filter`.
   */
  /*
   * AMOUNTS MUST BE CLEARED and CONSUMED NEED NOT BE, which was worth finding
   * out rather than assuming.
   *
   * Leaving `AMOUNTS` dirty fails the suite immediately - damage accumulates
   * across every call and the Ideal build stops being the ideal. Leaving
   * `CONSUMED` dirty changes nothing at all, on any fixture or any sabotage:
   * only PRIMARY_ELEMENTS are ever marked, and a primary element that has any
   * damage is always emitted by the combination loop itself - paired or single
   * - so the second loop never had a chance to drop it. The flag is belt and
   * braces over an invariant that already holds.
   *
   * It stays because the invariant lives in `combineElements`, in another
   * module, and a `fill` on twenty bytes costs nothing. But it is not load
   * bearing and the comment says so, because a defence described as essential
   * is one nobody dares re-examine.
   */
  AMOUNTS.fill(0);
  CONSUMED.fill(0);
  if (base) {
    for (let i = 0; i < DAMAGE_ORDER.length; i++) {
      const v = base[i] ?? 0;
      if (v <= 0) continue;
      const type = DAMAGE_ORDER[i]!;
      AMOUNTS[i] = (AMOUNTS[i] ?? 0) + (type === 'impact' || type === 'puncture' || type === 'slash' ? physicalDamage(v, baseTotal, physical[type]) : quantise32(v, baseTotal));
    }
  }
  /*
   * INNATE IS READ BEFORE THE MODS ARE ADDED, and this comment used to claim
   * that was load-bearing. It is not, and the claim was tested rather than
   * trusted: moving the read after the mod elements changes NO output, because
   * `combineElements` dedupes by first occurrence - an element a mod added is
   * already in `modOrder`, so listing it as innate too places nothing new.
   *
   * The order is kept because it is what the rule MEANS - an element the weapon
   * has is innate, one a mod put there is not - and because the dedupe is a
   * property of a different module that could change. It is correctness by
   * intent, not by consequence, and saying so is the difference between a
   * comment that is true and one that sounds load-bearing.
   */
  const innate: Element[] = [];
  for (const el of PRIMARY_ELEMENTS) {
    const idx = DAMAGE_INDEX[el];
    if (idx !== undefined && (AMOUNTS[idx] ?? 0) > 0) innate.push(el);
  }
  for (const [el, pct] of elementPct) {
    const idx = DAMAGE_INDEX[el];
    if (idx === undefined) continue;
    AMOUNTS[idx] = (AMOUNTS[idx] ?? 0) + quantise32(baseTotal * (pct / 100), baseTotal);
  }
  // Combine primary elements in placement order; innate ones last unless a mod put them earlier.
  const combined = combineElements(elementOrder, innate);
  const damage: Array<{ type: string; amount: number }> = [];
  const factor = 1 + damagePct / 100;
  for (const c of combined) {
    let amount = 0;
    for (const el of c.from) {
      const idx = DAMAGE_INDEX[el];
      if (idx === undefined) continue;
      amount += AMOUNTS[idx] ?? 0;
      CONSUMED[idx] = 1;
    }
    if (amount > 0) damage.push({ type: c.type, amount: amount * factor });
  }
  for (let i = 0; i < DAMAGE_ORDER.length; i++) {
    const amount = AMOUNTS[i] ?? 0;
    if (CONSUMED[i] === 0 && amount > 0) damage.push({ type: DAMAGE_ORDER[i]!, amount: amount * factor });
  }
  // `let`, because a per-status bonus below rescales it; see there for why one
  // pass is exact.
  let perShot = damage.reduce((n, d) => n + d.amount, 0);

  const pellets = (item.multishot ?? 1) * (1 + multishotPct / 100);
  const cc = item.criticalChance === undefined ? null : item.criticalChance * (1 + ccPct / 100);
  const cd = item.criticalMultiplier === undefined ? null : item.criticalMultiplier * (1 + cdPct / 100);
  const crit = cc !== null && cd !== null ? averageCritMultiplier(cc, cd) : 1;
  /*
   * A FIRE RATE OF ZERO IS AN ABSENT FIELD, NOT A RATE OF ZERO, and reading it
   * as a rate scored a real weapon at exactly nothing.
   *
   * The Lanka is a charge sniper. Both catalogues - WFCD's re-publication and
   * DE's own `ExportWeapons` - carry `fireRate: 0` for it and no charge time at
   * all, because a charge weapon's rate is a function of its charge and DE
   * publishes no field for that. It is the only equippable primary in either
   * feed with a zero rate, so it never showed up as a class of problem: it
   * showed up as one weapon quietly scoring 0.0 on every question, with every
   * mod worth the same nothing, and a plan built on that.
   *
   * A zero is a claim - "this weapon does no damage" - and it is false. Absence
   * is the truth, so the rate becomes null and the figure becomes PER SHOT
   * rather than per second, which is the largest honest thing that can be said
   * without a rate. The consequences are stated rather than hidden: `unscored`
   * counts the rate, the figure carries a note saying it is per shot, and a
   * fire-rate mod is genuinely worth nothing here because nothing in either
   * catalogue says what it would multiply.
   */
  const rate = moddedStat(item.fireRate ? item.fireRate : null, ratePct);
  const magazine = magazineSize(item.magazineSize ?? null, magPct);
  const reload = reloadTime(item.reloadTime ?? null, reloadPct);
  // Q3 asks about survival and never touches a rate, so an absent one costs it nothing.
  if (rate === null && question !== 'Q3') unscored++;

  /*
   * THE PER-STATUS BONUS, APPLIED HERE BECAUSE HERE IS WHERE IT CAN BE.
   *
   * Condition Overload reads "+80% Melee Damage per Status Type affecting the
   * target" and the optimiser scored it at zero, so it never recommended the
   * mod a real level-9999 melee build is built around. The count is not a fact
   * about the fight: it follows from this build's own proc rate and its own
   * damage composition, both of which are already computed a few lines below to
   * derive the corrosive strip and the viral multiplier.
   *
   * THERE IS NO CIRCULARITY, and that is worth stating because it looks like
   * there should be. The bonus raises `damagePct`, which scales every amount in
   * `damage` by a common factor. The count depends on the proc RATE and the
   * proc COMPOSITION: the rate is `procChance x (1 + statusPct/100)` times the
   * shots per second, and the composition is the SHARES of `damage`, which a
   * common factor leaves unchanged. `duty` is `direct / burst`, and both scale
   * linearly with the same factor, so it cancels - `sustainedDps` is
   * `burst x shots/(rate x reload + shots)`, and that multiplier holds no
   * damage term at all. So the count is the same before and after, and one pass
   * is exact rather than an approximation of a fixed point.
   *
   * Q2 ONLY. Q1 is defined as the floor with no status modelled at all, and
   * crediting a status-scaled mod there would break the one property that makes
   * Q1 worth having.
   */
  if (question === 'Q2' && statusScaledPct > 0 && perShot > 0) {
    const dutyNow = magazine !== null && reload !== null && rate !== null && rate > 0 ? sustainedDps({ burstDps: 1, effectiveFireRate: rate, magazine, reload }) : 1;
    const shotsPerSecondNow = rate === null ? 1 : rate * dutyNow;
    const chanceNow = item.procChance === undefined ? null : item.procChance * (1 + statusPct / 100);
    const perSecondNow = chanceNow !== null && shotsPerSecondNow > 0 ? procsPerShot(pellets, chanceNow) * shotsPerSecondNow : 0;
    const types = liveStatusTypes({ procsPerSecond: perSecondNow, shares: procTypeWeights(damage) });
    if (types > 0) {
      /*
       * A DAMAGE PER CENT IS ADDITIVE WITH THE OTHERS, which is why this
       * rescales rather than multiplying at the end: `1 + (damagePct + bonus)/100`
       * is not `(1 + damagePct/100) x (1 + bonus/100)`, and the game adds.
       */
      const before = 1 + damagePct / 100;
      damagePct += statusScaledPct * types;
      const after = 1 + damagePct / 100;
      const rescale = before > 0 ? after / before : 1;
      for (const d of damage) d.amount *= rescale;
      perShot *= rescale;
    }
  }

  const burst = perShot * pellets * crit * (rate ?? 1);
  const direct = magazine !== null && reload !== null && rate !== null && rate > 0 ? sustainedDps({ burstDps: burst, effectiveFireRate: rate, magazine, reload }) : burst;

  /*
   * Q2: THE SAME BUILD, AGAINST ARMOUR, COUNTING WHAT BLEEDS.
   *
   * Two terms, and the second is the whole reason the question exists:
   *
   *   direct - every hit, through the armour, so a tenth of itself at the cap.
   *   procs  - bleed, ignite and poison. A BLEED IGNORES ARMOUR ENTIRELY, so it
   *            arrives whole while the hit that caused it arrives at a tenth.
   *            On a slash-heavy weapon the procs are most of the real damage
   *            and Q1 could not see a single point of it.
   *
   * The proc types are read from the damage vector AFTER elements combine,
   * which is the correct place: a build that folds heat into radiation has no
   * heat left to ignite with, and the vector already says so.
   *
   * A tick is taken from the MODDED BASE - base damage bonuses only, no
   * elemental and no physical mods - which is `armour.ts`'s `moddedBaseDamage`
   * and the single most mis-stated quantity in the domain.
   *
   * ARMOUR STRIPPING AND VIRAL ARE MODELLED, and this used to say they were not.
   * Both are DERIVED from the build's own numbers - never assumed, never a
   * setting: the proc rate the weapon really sustains, the share of its damage
   * vector that is corrosive, heat or viral, and how long each of those statuses
   * lives. `armour.ts`'s `liveStacks` turns those three into a stack count by
   * Little's Law. A corrosive build therefore strips because its own vector says
   * it strips, and a build with no corrosive in it strips nothing.
   *
   * The swing is the reason it cannot be left out. At the cap a fully stripped
   * target takes 7.15x what an unstripped one takes, and that multiple lands on
   * the DIRECT term only - so a model without stripping does not merely
   * understate every build by a constant, it systematically prefers the slash
   * weapon over the corrosive one. The old ranking was wrong, not just low.
   *
   * Still not modelled, and named rather than guessed: crit on a tick, forced
   * procs, gas, and where the heat ramp sits at a given instant. Each is in
   * `armour.ts`'s `UNKNOWN` or has no input in the catalogue, and each would
   * only ever RAISE this figure - so Q2 is a floor against armour, in the same
   * way Q1 is a floor against health.
   */
  let value = direct;
  /** Q2 only: the worst of the 29 targets, so the overlay can name it. */
  let weakest: Scored['weakest'] = null;
  /*
   * Q3 answers a completely different question and shares none of the damage
   * arithmetic above, so it takes the value over outright rather than adjusting
   * it. `survive.ts` carries the reason armour multiplies rather than adds.
   */
  if (question === 'Q3') {
    const s3 = survivability({
      health: item.health ?? 0,
      shield: item.shield ?? 0,
      armour: item.armor ?? 0,
      healthPct,
      shieldPct,
      armourPct,
    });
    return {
      score: { value: s3.effectiveHealth, perShot, pellets, critChance: cc, critDamage: cd, fireRate: rate, magazine, reload, damage, figureNote: null, weakest: null },
      unscored,
    };
  }
  if (question === 'Q2') {
    // The share of the time the weapon is actually firing: a proc rate has to
    // pay for the reload exactly as the direct damage does.
    const duty = burst > 0 ? direct / burst : 1;
    // With no rate the whole figure is per shot, so the proc count is per shot too.
    const shotsPerSecond = rate === null ? 1 : rate * duty;
    const chance = item.procChance === undefined ? null : item.procChance * (1 + statusPct / 100);
    /*
     * THE SHARES, FROM THE ONE DEFINITION.
     *
     * This was rewritten as five accumulators in a single pass to avoid the Map
     * allocation, on the reasoning that `score` runs about 450,000 times per
     * plan and this block is 40 % of it (Q2 2.00 us against Q1 1.20). Measured,
     * it bought NOTHING - 2.00 us to 2.03, which is noise - so it was reverted.
     * An optimisation that does not optimise is just a second copy of a rule
     * waiting to drift from the first, and this repo has been bitten by exactly
     * that. The Map is not where the time goes.
     */
    const weights = procTypeWeights(damage);
    const share = (type: string) => weights.get(type) ?? 0;
    const perSecond = chance !== null && shotsPerSecond > 0 ? procsPerShot(pellets, chance) * shotsPerSecond : 0;

    /*
     * THE ARMOUR THE TARGET ACTUALLY HAS WHILE THIS WEAPON IS FIRING AT IT.
     *
     * Corrosive strips per stack and heat strips on a timer, so they take
     * different instruments; both counts come from this build's own proc rate
     * times this build's own share of that damage type. The two strips combine
     * on what is LEFT, which is why 80 % and 50 % make 90 % rather than 130 %.
     */
    /*
     * A STACK COUNT NEEDS A RATE, so a weapon whose rate the catalogue does not
     * carry strips nothing rather than stripping from a per-shot count read as
     * though it were per second. `perSecond` is procs per SHOT in that case and
     * a stack count taken from it would be a different quantity wearing the
     * same name - the exact shape of mistake this module keeps finding.
     */
    const strip = rate === null ? 0 : combinedStrip(
      corrosiveStrip(liveStacks(perSecond * share('corrosive'), CORROSIVE_DURATION_S, CORROSIVE_MAX_STACKS)),
      heatStrip(perSecond * share('heat')),
    );
    const net = netArmour(Q2_TARGET_ARMOUR, strip);
    /*
     * Viral multiplies damage to HEALTH, and it reaches a damage-over-time tick
     * as well as a direct hit - which is settled, sourced, and the reason it is
     * one factor over the whole figure rather than a term inside it. Bleed's
     * armour bypass and viral's health multiplier COMPOUND; they do not compete.
     */
    const viral = rate === null ? 1 : viralMultiplier(liveStacks(perSecond * share('viral'), VIRAL_DURATION_S, VIRAL_MAX_STACKS));
    let procDps = 0;
    if (perSecond > 0) {
      const moddedBase = moddedBaseDamage({ base: baseTotal, baseDamageBonus: damagePct / 100 });
      const heatBonus = (elementPct.get('heat') ?? 0) / 100;
      const toxinBonus = (elementPct.get('toxin') ?? 0) / 100;
      // `landsAt` carries the bypass rule, so the bleed line reads the same as
      // the other two and still arrives whole. That is the entire point.
      procDps += perSecond * share('slash') * procTotal(bleedTick({ moddedBase })) * landsAt('bleed', net);
      procDps += perSecond * share('heat') * procTotal(igniteTick({ moddedBase, elementBonus: heatBonus })) * landsAt('ignite', net);
      procDps += perSecond * share('toxin') * procTotal(poisonTick({ moddedBase, elementBonus: toxinBonus })) * landsAt('poison', net);
    } else if (chance === null) {
      // A weapon whose status chance the catalogue does not carry gets no proc
      // term rather than an invented one, and says so through `unscored`.
      unscored++;
    }
    /*
     * UNIVERSAL CAPABILITY, AND IT IS THE WORST FACTION RATHER THAN THE BEST.
     *
     * Everything above this line answers "how much damage against 2,700 armour"
     * and nothing in it knows WHO is wearing the armour. The game does: a 16 x
     * 15 grid of vulnerabilities and resistances, x1.5 and x0.5, and it lands
     * squarely on the two things this objective now rewards -
     *
     *     viral      x0.5 against Infested Deimos and The Murmur
     *     corrosive  x0.5 against Sentient
     *
     * - so the harder Q2 pushed a build toward the strip and the multiplier,
     * the more confidently it recommended something halved against two or three
     * of the factions a level-9999 player actually meets. It could not see that
     * because nothing in this repo carried the table until now.
     *
     * The build is scored against its WEAKEST matchup, which is what "universal"
     * means: a build devastating against Grineer and halved against the Murmur
     * is a Grineer build, and an average would hide that behind the good half.
     * A vulnerability cannot raise this figure, which looks wrong and is not -
     * being strong somewhere is a bonus, being weak somewhere is a capability
     * gap, and only the second is a fact about universality.
     */
    const faction = universal(damage);
    weakest = { against: faction.worstFaction, factor: faction.worst };
    value = (direct * landsAt('direct', net) + procDps) * viral * faction.worst;
  }

  /*
   * THIS NOTE SAID SOMETHING FALSE FOR A LONG TIME, and it said it on every
   * melee figure the overlay printed.
   *
   * It read "measured against the game and exactly half". That was one build,
   * on one capture, and it was recorded as a property of melee. A SECOND panel
   * on the same weapon - four mods, all of which the app models, and its own
   * multipliers readable out of the panel's physical rows and mutually
   * consistent - puts the app within 0.32 % of the game. The arithmetic was
   * never halved. `scripts/measure-against-game.ts` carries both panels.
   *
   * THE THREE SLOTS THE APP DOES NOT SCORE, each measured rather than confessed:
   *
   *   STANCE   All 63 stance mods in the catalogue carry ZERO effects - no
   *            damage, no crit, no status, no attack speed. Their drain is
   *            negative, so their only quantitative contribution is capacity,
   *            and the app already reads that from the log's own dump
   *            (`stanceBonus`) and adds it. There is nothing left to model.
   *   EXILUS   Worth zero under every question this app asks, except Bhisaj-Bal
   *            on Paris Prime under Q2. Derived by `check-optimise`.
   *   ARCANE   Absent from `Mods.json`, which for a while was recorded as the
   *            one real gap - "a fetch, not a limit". The fetch was done.
   *            `docs/research/arcanes-and-the-eleventh-slot.md` has the
   *            numbers: of 172 arcanes, ZERO contribute an unconditional effect
   *            any of the three questions score. Every one that looked like it
   *            did carries an explicit trigger ("On Transference Out:",
   *            "On shotgun kill within 5m:"), and all twelve melee arcanes are
   *            conditional by inspection. Loading the export would change no
   *            build, no ordering and no figure.
   *
   * So none of the three moves a figure this app prints. What remains unexplained
   * is one captured build that disagreed by a factor of two, against a second
   * that matches to 0.32 %, and the marker says exactly that.
   *
   * Every other class is unchecked rather than correct, which is why the note is
   * null there and not a reassurance.
   */
  const meleeNote = 'one captured build disagreed with the game by a factor of two and the cause was never identified; a second build, with every mod visible to the app, matches to 0.32 per cent. The three unscored slots are not the reason: all 63 stances carry no stats, and no arcane in the game has an unconditional effect this question scores';
  const rateNote = 'this figure is PER SHOT, not per second: neither catalogue carries a fire rate for this weapon, and a charge weapon has no published charge time to derive one from. Every mod is still ranked correctly against every other, but a fire-rate mod is worth nothing here because nothing says what it would multiply';
  const figureNote = rate === null ? rateNote : item.type === 'Melee' ? meleeNote : null;

  return {
    score: { value, perShot, pellets, critChance: cc, critDamage: cd, fireRate: rate, magazine, reload, damage, figureNote, weakest },
    unscored,
  };
}

// ---------------------------------------------------------------------------
// Capacity and slots
// ---------------------------------------------------------------------------

export interface SlotPlan {
  /** Grid slot polarities as the account reports them, resolved to the arithmetic's words. */
  grid: Polarity[];
  capacity: number;
}

/** Greedy: biggest drain first into a matching slot, then a universal one, then an unpolarised one, then a mismatch. */
/**
 * WHAT A SET COSTS, without building the answer.
 *
 * `assign` below returns the same total AND a `Placed[]` - eight objects of ten
 * fields each - and the search threw every one of them away: it needed the
 * number and nothing else. It ran about 160,000 times per search, so the
 * discarded objects were most of the wait. Measured on Ash: a search went from
 * 408 ms to the figure in `search`'s own note.
 *
 * The greedy assignment here is the same one, line for line, and
 * `check-optimise` asserts the two agree - a second copy of a rule is exactly
 * how the two drift apart.
 */
export function drainOf(candidates: ReadonlyArray<Candidate>, grid: readonly Polarity[]): number {
  const free = FREE_SCRATCH;
  free.length = 0;
  for (const p of grid) free.push(p);
  while (free.length < GRID_SLOTS) free.push('none');
  const order = ORDER_SCRATCH;
  order.length = 0;
  for (const c of candidates) order.push(c);
  order.sort(byDrainDesc);
  let total = 0;
  for (const c of order) {
    let i = free.indexOf(c.polarity);
    if (i === -1 && c.polarity !== 'umbra') i = free.indexOf('universal');
    if (i === -1) i = free.indexOf('none');
    if (i === -1) i = free.length > 0 ? 0 : -1;
    const slot = i === -1 ? 'none' : (free.splice(i, 1)[0] as Polarity);
    total += slotDrain(c.drain, slot, c.polarity);
  }
  return total;
}

/*
 * Two arrays reused across every call. `drainOf` runs often enough that
 * allocating a fresh pair each time was measurable, and it is single-threaded
 * and never re-entered - the sort and the splices all finish before it returns.
 */
const FREE_SCRATCH: Polarity[] = [];
const ORDER_SCRATCH: Candidate[] = [];
const byDrainDesc = (a: Candidate, b: Candidate): number => b.drain - a.drain;

export function assign(candidates: ReadonlyArray<Candidate>, grid: readonly Polarity[]): { placed: Placed[]; drain: number } {
  const free = [...grid];
  while (free.length < GRID_SLOTS) free.push('none');
  const order = [...candidates].sort((a, b) => b.drain - a.drain);
  const placed: Placed[] = [];
  let total = 0;
  for (const c of order) {
    const pick = (pred: (p: Polarity) => boolean) => {
      const i = free.findIndex(pred);
      return i === -1 ? null : (free.splice(i, 1)[0] as Polarity);
    };
    const slot = pick((p) => p === c.polarity) ?? pick((p) => p === 'universal' && c.polarity !== 'umbra') ?? pick((p) => p === 'none') ?? pick(() => true) ?? 'none';
    const drain = slotDrain(c.drain, slot, c.polarity);
    total += drain;
    placed.push({ path: c.row.uniqueName, name: c.row.displayName, rank: c.rank, maxRank: c.row.fusionLimit ?? c.rank, polarity: c.polarity, slotPolarity: slot, drain, rarity: c.row.rarity, ownedRank: null, route: null });
  }
  return { placed, drain: total };
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/** The highest rank the account owns of each mod path. Unranked stacks are rank 0. */
export function ownedRanks(acc: RawAccount | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!acc) return out;
  for (const u of acc.RawUpgrades ?? []) if (u.ItemType && !out.has(u.ItemType)) out.set(u.ItemType, 0);
  for (const u of acc.Upgrades ?? []) {
    if (!u.ItemType || !oidOf(u.ItemId)) continue;
    const r = rankFromFingerprint(u.UpgradeFingerprint) ?? 0;
    out.set(u.ItemType, Math.max(out.get(u.ItemType) ?? 0, r));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

const KNOWN_POLARITIES: readonly Polarity[] = ['madurai', 'naramon', 'vazarin', 'zenurik', 'unairu', 'penjaga', 'umbra', 'universal'];

function toPolarity(p: string | null): Polarity {
  const v = (p ?? '').toLowerCase() as Polarity;
  return KNOWN_POLARITIES.includes(v) ? v : 'none';
}

/**
 * The aura, in the same shape the grid mods are reported in, so the overlay has
 * one type to render. `slotPolarity` is 'none' because which polarity the aura
 * slot carries is not in the log - the same named unknown as the grid's.
 */
function auraPlaced(c: Candidate): Placed {
  return {
    path: c.row.uniqueName,
    name: c.row.displayName,
    rank: c.rank,
    maxRank: c.row.fusionLimit ?? Math.max(0, c.row.ranks - 1),
    polarity: c.polarity,
    slotPolarity: 'none',
    drain: c.drain,
    rarity: c.row.rarity,
    ownedRank: null,
    route: null,
  };
}

function candidateAt(row: ModRow, rank: number): Candidate {
  return { row, rank, polarity: toPolarity(row.polarity), drain: drainAtRank(row.baseDrain ?? 0, rank), family: family(row) };
}

const familyOf = (c: Candidate): string => c.family ?? (c.family = family(c.row));

interface State {
  set: Candidate[];
  value: number;
  drain: number;
  fits: boolean;
  /** The set's pool indices, kept sorted, so the duplicate check is a short numeric join. */
  ids: number[];
}

/*
 * The family conflict, checked by scanning rather than by a Set.
 *
 * Every evaluated state used to build `new Set(set.map(familyOf))` - a Set and
 * eight strings, for each of ~160,000 states, to answer a question about at
 * most eight items. A linear scan over eight is faster than allocating the
 * structure that would make the scan unnecessary.
 */
function conflicts(set: readonly Candidate[], fam: string): boolean {
  for (const x of set) if (familyOf(x) === fam) return true;
  return false;
}

export function search(
  question: Question,
  item: ItemDbEntry,
  pool: ReadonlyArray<Candidate>,
  slots: SlotPlan,
  /**
   * THE AURA, which is not one of the eight and does not compete for them.
   *
   * A Warframe's aura sits in its own slot and its drain is NEGATIVE: it ADDS
   * capacity instead of spending it. Physique at rank 5 is -7, so it hands the
   * grid seven more points AND gives +20 % maximum health - both of which this
   * optimiser ignored entirely until now, on the one item type where the slot
   * exists. That is not a rounding error: seven points is most of another mod.
   *
   * It is passed in rather than searched over here because it changes the
   * capacity every grid decision is made against; `plan` runs this once per
   * aura worth considering and keeps the best whole answer.
   */
  aura: Candidate | null = null,
): BuildResult {
  // Negative drain, so subtracting it is what makes the grid bigger.
  const capacity = slots.capacity - (aura ? Math.min(0, aura.drain) : 0);
  // The pool's own order is the identity used by the duplicate check below.
  for (let i = 0; i < pool.length; i++) pool[i]!.id = i;
  /*
   * `score` takes `{ row, rank }` and a Candidate already has both, so the set
   * goes in as it stands. It used to be re-mapped into fresh objects on every
   * evaluation - about 160,000 arrays of eight objects per search, all of them
   * garbage before the next line.
   */
  const evaluate = (set: Candidate[], ids: number[]): State => {
    const drain = drainOf(set, slots.grid);
    const s = score(item, aura ? [...set, aura] : set, question);
    return { set, ids, value: s.score.value, drain, fits: drain <= capacity };
  };
  const empty = evaluate([], []);
  let beam: State[] = [empty];
  let best: State = empty;
  for (let depth = 0; depth < GRID_SLOTS; depth++) {
    const fitting: State[] = [];
    const over: State[] = [];
    const seen = new Set<string>();
    for (const state of beam) {
      for (const c of pool) {
        if (conflicts(state.set, familyOf(c))) continue;
        /*
         * The duplicate check BEFORE the allocation, which is the point of the
         * numeric ids: a set of eight is reached up to forty thousand ways, and
         * the old code built an array and a long sorted string for every one of
         * them before finding out it had seen it already.
         */
        const id = c.id ?? 0;
        const ids = insertSorted(state.ids, id);
        const key = ids.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        const s = evaluate([...state.set, c], ids);
        (s.fits ? fitting : over).push(s);
      }
    }
    if (fitting.length === 0 && over.length === 0) break;
    /*
     * Ranking down is the expensive move (it re-evaluates the set once per
     * mod per point shed), so it is spent only on the strongest over-capacity
     * sets. The first version ranked down every one of them and the gate's
     * fifteen searches took 39 s.
     */
    over.sort((a, b) => b.value - a.value);
    const rescued = over.slice(0, RANK_DOWN_TRIES).map((s) => rankDown(s, evaluate));
    const next = [...fitting, ...rescued.filter((s) => s.fits)];
    if (next.length === 0) break;
    next.sort((a, b) => b.value - a.value);
    beam = next.slice(0, BEAM);
    for (const s of beam) if (s.fits && s.value > best.value) best = s;
  }
  const { placed, drain } = assign(best.set, slots.grid);
  const scoredSet = aura ? [...best.set, aura] : best.set;
  const s = score(item, scoredSet.map((c) => ({ row: c.row, rank: c.rank })), question);
  return {
    question,
    placed,
    aura: aura ? auraPlaced(aura) : null,
    capacity,
    drain,
    fits: drain <= capacity,
    score: s.score,
    unscored: s.unscored,
    assumptions: assumptionsFor(question),
  };
}

/** Lower the ranks of the mods that lose the least value per drain point until the set fits. */
/** A copy of `ids` with `id` inserted in order. Eight elements at most, so a linear scan wins. */
function insertSorted(ids: readonly number[], id: number): number[] {
  const out: number[] = [];
  let placedIt = false;
  for (const x of ids) {
    if (!placedIt && id < x) {
      out.push(id);
      placedIt = true;
    }
    out.push(x);
  }
  if (!placedIt) out.push(id);
  return out;
}

function rankDown(state: State, evaluate: (set: Candidate[], ids: number[]) => State): State {
  let current = state;
  for (let guard = 0; guard < 60 && !current.fits; guard++) {
    let bestNext: State | null = null;
    for (let i = 0; i < current.set.length; i++) {
      const c = current.set[i]!;
      if (c.rank === 0) continue;
      const lowered = [...current.set];
      // Same row, lower rank - so it keeps the pool identity the duplicate check uses.
      lowered[i] = { ...candidateAt(c.row, c.rank - 1), id: c.id };
      const s = evaluate(lowered, current.ids);
      const lossPerDrain = (current.value - s.value) / Math.max(1, current.drain - s.drain);
      if (!bestNext || lossPerDrain < (current.value - bestNext.value) / Math.max(1, current.drain - bestNext.drain)) bestNext = s;
    }
    if (!bestNext) break;
    current = bestNext;
  }
  return current;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export interface PlanInput {
  item: ItemDbEntry;
  catalogue: ReadonlyArray<ModRow>;
  owned: ReadonlyMap<string, number>;
  slots: SlotPlan;
  question?: Question;
  /**
   * "Has this account set foot on that planet", supplied by the controller,
   * which is the only layer holding both the star chart and the account.
   * Omitted, every farm's reachability stays `null` - unknown, never `false`.
   */
  canReach?: (planet: string) => boolean | null;
  /**
   * How far the star chart is from opening a planet, and what to play first.
   * Supplied by the controller, the only layer holding both the chart and the
   * account. Omitted, the ladder stops where it used to.
   */
  unlockPath?: (planet: string) => { nodes: number; node: string; nodeName: string } | null;
}

/**
 * The pools, shared by `plan` and `ladder`.
 *
 * Split out because the ladder has to build candidates the same way the search
 * does, and `candidateAt` fills in three fields - polarity, drain and family -
 * that a hand-written object would omit. A prototype that missed `drain` turned
 * every score into NaN and produced a confident ladder of nonsense, which is
 * exactly the failure a shared constructor removes.
 */
interface Prepared {
  eligible: ModRow[];
  scoredRows: ModRow[];
  idealPool: Candidate[];
  nowPool: Candidate[];
  byPath: Map<string, ModRow>;
  /** `null` is "no aura", which is the right answer for every weapon. */
  auraPool: Array<Candidate | null>;
  /**
   * Auras the account holds BELOW max rank, at the rank it holds. The grid mods
   * have always been built at `min(owned, max)`; the aura was built at max and
   * filtered on presence, so an unranked Physique scored as a rank-5 one.
   */
  ownedAura: Map<string, Candidate>;
}

function prepare(input: PlanInput): Prepared {
  const question = input.question ?? 'Q1';
  const slotsOk = eligibleSlots(input.item);
  const eligible = input.catalogue.filter((r) => r.slot !== null && slotsOk.has(r.slot) && r.ranks > 0 && !r.isAura && !r.isFlawed);
  /*
   * A ROW WITH ONLY A STATUS-SCALED EFFECT IS STILL A CANDIDATE, and leaving it
   * out is why Condition Overload was never recommended even after its effect
   * started being scored.
   *
   * This read `used.length > 0` and Condition Overload's `used` is EMPTY - its
   * one effect is "+80% melee damage per Status Type affecting the target",
   * which lives in `statusScaled` because its magnitude depends on the whole
   * build rather than on the mod. So the search did not fail to pick it; the
   * mod was never in the pool the search chooses from. Measured on a Kronen
   * Prime with everything owned: the ideal build scored 6,547, and swapping its
   * Molten Impact for Condition Overload scores 7,935 - a mod the optimiser
   * could not see worth a fifth of the answer.
   */
  const scoredRows = eligible.filter((r) =>
    r.effects.some((e) => {
      const se = scoredEffects(r, e.rank, question);
      return se.used.length > 0 || se.statusScaled.length > 0;
    }),
  );

  const idealPool: Candidate[] = [];
  const nowPool: Candidate[] = [];
  /** Auras the account holds BELOW max rank, at the rank it actually holds. */
  const ownedAura = new Map<string, Candidate>();
  const byPath = new Map<string, ModRow>();
  for (const r of scoredRows) {
    const max = r.fusionLimit ?? r.ranks - 1;
    byPath.set(r.uniqueName, r);
    idealPool.push(candidateAt(r, max));
    const owned = input.owned.get(r.uniqueName);
    if (owned !== undefined) nowPool.push(candidateAt(r, Math.min(owned, max)));
  }

  /*
   * THE AURA SLOT, and why it is searched separately.
   *
   * `eligible` above drops auras deliberately - an aura cannot go in one of the
   * eight - and until now that was the end of it, so the optimiser was blind to
   * a whole slot on every Warframe. It matters twice over: a Physique at rank 5
   * hands the grid SEVEN more points of capacity (its drain is negative) and
   * adds 20 % maximum health, which is exactly what Q3 scores.
   *
   * Which aura is best is not separable from which eight mods are best, because
   * it changes the capacity they are chosen against. So the whole search is run
   * once per aura worth considering and the best complete answer wins.
   *
   * WORTH CONSIDERING is a short list on purpose. Thirty-six auras times a
   * 120 ms search is fifteen seconds on a screen open, which would be exactly
   * the laggy overlay the brief refuses. Two kinds can win: one the question
   * SCORES, and - among the rest, which differ only in the capacity they hand
   * over - the one that hands over the most. Every other non-scoring aura is
   * dominated by that one and cannot be the answer.
   */
  /*
   * A NECRAMECH IS TYPED 'Warframe' AND HAS NO AURA SLOT.
   *
   * The same trap the mod pool above was fixed for, still open one line later:
   * Voidrig and Bonewidow are `type: 'Warframe'` with
   * `productCategory: 'MechSuits'`, so this handed them all 36 Warframe auras -
   * a slot they do not have, negative drain inflating their capacity, and
   * `maximum health` auras inflating the very figure Q3 reports.
   */
  const takesAura = input.item.type === 'Warframe' && input.item.productCategory !== 'MechSuits';
  const auraRows = takesAura ? input.catalogue.filter((r) => r.isAura && !r.isFlawed && r.ranks > 0) : [];
  const auraPool: Array<Candidate | null> = [null];
  /*
   * AT THE RANK THE ACCOUNT HOLDS, not at the rank the card can reach.
   *
   * The eight grid mods have always been built with `Math.min(owned, max)`; the
   * aura was built at max and then filtered on `owned.has` - PRESENCE, not
   * rank. An account holding an unranked Physique was scored with a rank-5
   * Physique: seven points of capacity it does not have and twenty per cent
   * maximum health it does not have, on the one item type where an aura exists.
   * Every figure downstream inherited it, and the rank-up rung that should have
   * followed then measured a gain of nothing, because the plan had already
   * spent it.
   */
  let biggest: Candidate | null = null;
  for (const r of auraRows) {
    const max = r.fusionLimit ?? r.ranks - 1;
    const c = candidateAt(r, max);
    // Same rule for the aura pool: an aura whose only effect scales on status
    // types is still an aura worth considering.
    if (r.effects.some((e) => {
      const se = scoredEffects(r, e.rank, question);
      return se.used.length > 0 || se.statusScaled.length > 0;
    })) auraPool.push(c);
    else if (!biggest || c.drain < biggest.drain) biggest = c;
    byPath.set(r.uniqueName, r);
    const held = input.owned.get(r.uniqueName);
    if (held !== undefined && held < max) ownedAura.set(r.uniqueName, candidateAt(r, held));
  }
  if (biggest) auraPool.push(biggest);

  return { eligible, scoredRows, idealPool, nowPool, byPath, auraPool, ownedAura };
}

/**
 * THE PLAN, COMPUTED BETWEEN YIELDS.
 *
 * WHAT WAS MEASURED. A plan on a half-owned account is 1,135 ms and it ran
 * synchronously on the background page's controller. Instrumented with a
 * `setInterval(…, 0)` running alongside it, **zero timer ticks fired for the
 * whole 1,135 ms** - the log tail's callbacks, the strip's watchdog and the two
 * Overwolf round trips that put the overlay on screen were all stalled behind
 * it, every time a screen opened.
 *
 * WHAT THE SHAPE OF THAT SECOND IS, because it decides whether slicing helps at
 * all: **10 searches, 1,133 ms between them, longest single search 206 ms.** A
 * generator can only hand the thread back BETWEEN searches, so this converts a
 * 1,135 ms freeze into ten stalls of at most 206 ms - and the controller gets
 * the turn back nine times in the middle of work it used to be locked out of.
 *
 * It is the same shape `ladder` below already uses, for the same reason, and
 * measured at the same order of magnitude per slice.
 *
 * `plan` IS KEPT AND IS EXACTLY THIS, DRAINED. Every gate in the suite and
 * every offline caller goes through it, and a generator that yields `null`
 * between searches computes precisely what the straight-line version computed,
 * in the same order - so the synchronous answer cannot drift from the sliced
 * one, because there is only one body.
 */
export function* planSteps(input: PlanInput): Generator<null, Plan, void> {
  const question = input.question ?? 'Q1';
  const { eligible, scoredRows, idealPool, nowPool, byPath, auraPool, ownedAura } = prepare(input);

  function* bestOver(pool: Candidate[]): Generator<null, BuildResult, void> {
    let out: BuildResult | null = null;
    for (const a of auraPool) {
      // An aura the account does not own cannot be part of what it can build
      // TODAY - and one it owns unranked is worth what it is worth unranked.
      if (a && pool !== idealPool && !input.owned.has(a.row.uniqueName)) continue;
      const at = a && pool !== idealPool ? (ownedAura.get(a.row.uniqueName) ?? a) : a;
      const r = search(question, input.item, pool, input.slots, at);
      yield null;
      if (!out || r.score.value > out.score.value) out = r;
    }
    if (out) return out;
    const bare = search(question, input.item, pool, input.slots);
    yield null;
    return bare;
  };
  const now = yield* bestOver(nowPool);
  const ideal = yield* bestOver(idealPool);

  /*
   * THE CEILING, in two passes and no more.
   *
   * Pass one gives every slot a universal polarity, which halves the drain of
   * every mod that is not Umbra - so it is the best build reachable by
   * polarising, for all but one case. Pass two re-searches on the winning
   * build's OWN polarities, which is where an Umbra mod finally gets a slot
   * that halves it; it only ever runs once, on the winner, because running it
   * per aura would double the cost of the plan to refine an answer the first
   * pass has already all but settled.
   *
   * The better of the two is taken rather than the second, because pass two's
   * grid is derived from pass one's build: if that build wanted no Umbra slot,
   * the two grids are equivalent and the search may land either side of a tie.
   */
  const universalGrid: Polarity[] = Array.from({ length: GRID_SLOTS }, () => 'universal');
  let ceiling: BuildResult | null = null;
  let ceilingAura: Candidate | null = null;
  for (const a of auraPool) {
    const r = search(question, input.item, idealPool, { ...input.slots, grid: universalGrid }, a);
    yield null;
    if (!ceiling || r.score.value > ceiling.score.value) {
      ceiling = r;
      ceilingAura = a;
    }
  }
  if (ceiling) {
    const refined = search(question, input.item, idealPool, { ...input.slots, grid: ceiling.placed.map((p) => p.polarity) }, ceilingAura);
    yield null;
    if (refined.score.value > ceiling.score.value) ceiling = refined;
  }
  /*
   * THE CEILING CANNOT BE BELOW THE BUILD THE GRID ALREADY ALLOWS.
   *
   * Every consumer treats that as an invariant - the ladder aims at it, the
   * meter divides by it, and "at the ceiling" is `now >= ceiling` - and the two
   * passes above do not guarantee it. A universal slot refuses to halve an
   * UMBRA mod (`slotDrain`), while a real Umbra slot halves it, so an account
   * whose grid carries Umbra polarities can be more generous than the
   * "everything is universal" grid the first pass searches. Measured on a
   * Skiajati at capacity 50: ideal 3,377 against a ceiling of 3,231, which
   * printed "at the ceiling - nothing in the game raises this build further"
   * beside a mod grid showing the better build the player had not assembled.
   *
   * Taking the better of the two is the whole fix, and it is not a fudge: the
   * ceiling is defined as the best build reachable by polarising, and a grid
   * the account ALREADY has is one of the grids it can reach.
   */
  ceiling = ceiling === null || ideal.score.value > ceiling.score.value ? ideal : ceiling;
  /*
   * The owned rank is joined here rather than inside `search`, because `search`
   * has no idea what the account holds - it optimises over a pool of candidates
   * and nothing else. Keeping it that way is what lets the same function answer
   * both "the best you can build" and "the best that exists".
   */
  const joinOwned = (p: Placed): Placed => {
    const ownedRank = input.owned.get(p.path) ?? null;
    const row = byPath.get(p.path);
    // Only a mod the account LACKS needs a route; asking how to get something
    // already in the inventory is noise, and computing it is wasted work.
    return { ...p, ownedRank, route: ownedRank === null && row ? routeTo(row, input.canReach) : null };
  };
  /*
   * ONE join, used by both. The aura's join was added as a second copy of these
   * three lines, and the copy is how the aura would have quietly kept its old
   * unreachable-blind route when this grew a third argument.
   */
  const withOwned = (r: BuildResult): BuildResult => ({ ...r, aura: r.aura ? joinOwned(r.aura) : null, placed: r.placed.map(joinOwned) });

  // Next: for each Ideal mod the account lacks or under-ranks, the gain of adding it (at its target rank) to Now's pool.
  const next: NextStep[] = [];
  for (const p of ideal.placed) {
    const ownedRank = input.owned.get(p.path) ?? null;
    if (ownedRank !== null && ownedRank >= p.rank) continue;
    const row = byPath.get(p.path);
    if (!row) continue;
    const pool = [...nowPool.filter((c) => c.row.uniqueName !== p.path), candidateAt(row, p.rank)];
    /*
     * AND THIS LOOP IS MOST OF THE FREEZE, which the first pass at slicing
     * missed entirely. It searches ONCE PER MISSING MOD - up to eight more
     * searches after the four the aura and ceiling passes make - and none of
     * them handed the thread back. The gate that pairs every search in here
     * with a yield is what found it; counting yields would not have, and the
     * first version of that gate did exactly that and caught nothing.
     *
     * The comment sits ABOVE the call rather than between it and the yield,
     * because the gate reads a window after the search and a paragraph in that
     * window pushes the yield out of it. The explanation belongs to the loop
     * anyway; the yield belongs to the search.
     */
    const withIt = search(question, input.item, pool, input.slots);
    yield null;
    next.push({
      path: p.path,
      name: p.name,
      ownedRank,
      targetRank: p.rank,
      gain: withIt.score.value - now.score.value,
      rarity: row.rarity,
      polarity: toPolarity(row.polarity),
      drain: drainAtRank(row.baseDrain ?? 0, p.rank),
      maxRank: row.fusionLimit ?? p.rank,
      // From the rank the account HAS, not from zero: a mod already at 5 is
      // half paid for, and costing it from scratch would overstate every step.
      cost: rankCost(row.rarity, ownedRank ?? 0, p.rank),
    });
  }
  next.sort((a, b) => b.gain - a.gain);

  /*
   * Against the account's OWN grid, not against an empty one: the question is
   * what this player has left to do, and a slot they already polarised is not
   * work. `slots.grid` is what the log's build dump reported.
   */
  const forma = formaPlan(
    ideal.placed.map((p) => p.polarity),
    input.slots.grid,
  );
  return { now: withOwned(now), ideal: withOwned(ideal), ceiling: withOwned(ceiling), next, forma, candidates: { eligible: eligible.length, scored: scoredRows.length, owned: nowPool.length } };
}

/**
 * The plan, computed in one go.
 *
 * ONE BODY, TWO WAYS TO RUN IT. Every gate in this suite, the bench, and every
 * offline caller uses this; the controller drives `planSteps` directly so it
 * can hand the thread back between searches. They cannot disagree, because
 * there is nothing here to disagree with - a generator that yields `null`
 * between searches computes exactly what the straight-line version computed, in
 * the same order, and this drains it without looking at the yields.
 */
export function plan(input: PlanInput): Plan {
  const steps = planSteps(input);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * THE STAIRCASE FROM NOW TO IDEAL, ONE INSTRUCTION AT A TIME.
 *
 * Yields a `Rung` each time it commits a step, and `null` every time it has
 * finished one trial search without committing anything. The nulls are the
 * whole reason this is a generator: a rung costs one search per remaining
 * candidate - 82 ms each, measured by `scripts/bench-ladder.ts` - so a full
 * ladder is a second or more of solid work, and doing it in one call would
 * block the controller exactly the way recomputing the plan on every publish
 * used to. The caller drains this between timeouts and publishes as it goes,
 * so the first rung is on screen while the fifth is still being found.
 *
 * WHY GREEDY, AND WHAT THAT DOES AND DOES NOT CLAIM.
 *
 * The end point is not in question: acquiring every mod the ideal build wants
 * reaches the ideal build, in any order. What the order decides is how much of
 * that value arrives early, and the greedy choice - the best single step, then
 * ask again - is the one that matches how the advice is used. It is not proven
 * optimal over all orderings, and this does not say it is: the value on each
 * rung is the real value of that build, computed by the same search everything
 * else here uses, so every number shown is true even where the sequence is not
 * provably the best possible sequence.
 *
 * The `route` and `cost` on each rung are what make it an instruction rather
 * than a label: where to get the mod and what ranking it will cost in Endo and
 * credits, from the rank the account already holds rather than from zero.
 */
/**
 * THE GRID AFTER ONE FORMA, or null when that Forma would change nothing.
 *
 * The slot to spend it on is the first unpolarised one, and when there is none
 * the first slot whose polarity the target build does NOT want - re-polarising
 * is exactly what a Forma does to a full grid.
 *
 * Returning null is the part that matters. This used to write to
 * `grid[grid.length - 1]` whenever no unpolarised slot was left, so on a fully
 * polarised grid every Forma overwrote the same slot with the same polarity:
 * the deficit never moved, the same polarity came back, and the ladder emitted
 * groundwork rungs until its own runaway bound stopped it. Measured on a real
 * Braton with eight Naramon slots, twenty consecutive "Forma madurai +0" rungs
 * and a ladder that stopped at 635 of its own 1,283 ceiling while reporting
 * itself complete. The comment above it said this could not loop.
 */
function gridAfterForma(grid: readonly Polarity[], polarity: Polarity, wanted: readonly Polarity[]): Polarity[] | null {
  const next = [...grid];
  while (next.length < GRID_SLOTS) next.push('none');

  const empty = next.indexOf('none');
  if (empty !== -1) {
    next[empty] = polarity;
    return next;
  }

  /*
   * A full grid. Spend it on a slot the build has no use for - counted, because
   * two Madurai mods justify keeping two Madurai slots.
   */
  const need = new Map<Polarity, number>();
  for (const p of wanted) if (p !== 'none') need.set(p, (need.get(p) ?? 0) + 1);
  const spare = new Map<Polarity, number>();
  for (const p of next) spare.set(p, (spare.get(p) ?? 0) + 1);
  for (const [p, have] of spare) spare.set(p, have - (need.get(p) ?? 0));

  for (let i = 0; i < next.length; i++) {
    const at = next[i]!;
    if (at === polarity) continue; // re-polarising to what it already is buys nothing
    if ((spare.get(at) ?? 0) > 0) {
      next[i] = polarity;
      return next;
    }
  }
  // Every slot is one the build wants. There is no Forma left to spend here.
  return null;
}

/** One planet standing between the account and the rest of a build. */
export interface Wall {
  planet: string;
  nodes: number;
  node: string;
  nodeName: string;
}

/**
 * THE ONE TO OPEN FIRST: fewest nodes away, not the one behind the best mod.
 *
 * The question a stuck ladder answers is what to do tonight, so distance
 * decides. Exported and pure for the same reason `preferable` is: a version
 * that takes the LAST wall instead of the nearest still produces a valid-looking
 * rung, and every assertion about the rung's shape passes while the player is
 * sent seven nodes away when two would have done. The catalogue does not
 * reliably put two planets behind a wall for one weapon, so this cannot be
 * cornered from the outside - it has to be driven directly.
 *
 * Ties keep the first seen, which is stable rather than arbitrary: the walls
 * arrive in the order the build wants the mods.
 */
export function nearestWall(walls: readonly Wall[]): Wall | null {
  let best: Wall | null = null;
  for (const w of walls) if (best === null || w.nodes < best.nodes) best = w;
  return best;
}

/**
 * Is `a` a better next step than `b`?
 *
 * Exported and pure because it is the whole of the ladder's judgement about
 * REACHABILITY, and a sabotage proved it cannot be checked any other way: a
 * comparator that keeps the FIRST blocked candidate instead of the best one
 * still converges on the ceiling, so every end-point assertion passes while the
 * order among out-of-reach steps is quietly wrong.
 *
 * Two rules, in order. An unblocked step beats a blocked one whatever the
 * figures say - an instruction the player cannot follow is not one. Otherwise
 * the higher value wins, blocked or not, so the deferred steps stay properly
 * ordered among themselves.
 */
export function preferable(a: { value: number; blocked: boolean }, b: { value: number; blocked: boolean }): boolean {
  return a.blocked === b.blocked ? a.value > b.value : !a.blocked;
}
/**
 * One thing the ladder could do next, with what the build would score after it.
 *
 * `blocked` is the half that is not about value at all: a mod that only drops
 * on a planet this account has not reached cannot be done tonight, whatever it
 * would be worth. See where it is used for why that outranks the figure.
 */
type Choice =
  | { kind: 'mod' | 'aura'; path: string; rank: number; value: number; blocked: boolean }
  | { kind: 'forma'; polarity: Polarity; grid: Polarity[]; value: number; blocked: false };

export function* ladder(input: PlanInput, built: Plan): Generator<Rung | null, void, void> {
  const question = input.question ?? 'Q1';
  const { nowPool, byPath } = prepare(input);

  /*
   * The working state: the pool of mods available, the aura in hand, and the
   * grid. All three move as the ladder climbs - a Forma rung changes the grid,
   * which is what lets a mod that did not fit become the next best step.
   */
  let pool = [...nowPool];
  const nowAura = built.now.aura ? (byPath.get(built.now.aura.path) ?? null) : null;
  let auraCandidate = nowAura ? candidateAt(nowAura, built.now.aura?.rank ?? 0) : null;
  /*
   * PADDED TO EIGHT, AND THAT IS NOT A TIDY-UP.
   *
   * `slots.grid` carries only what the account reported, so an item nobody has
   * polarised arrives as an EMPTY array - the unpolarised slots are implicit,
   * and `drainOf` pads them itself. A Forma rung writes into this array, and on
   * an empty one `grid[grid.length - 1] = p` sets the property "-1" and leaves
   * the length at zero: every Forma trial searched an unchanged grid, measured
   * a gain of nothing, and was correctly discarded. The ladder then stopped at
   * the grid's own ceiling while reporting that nothing more could be done,
   * which is the exact opposite of what it is for.
   */
  const grid0 = [...input.slots.grid];
  while (grid0.length < GRID_SLOTS) grid0.push('none');
  let grid = grid0;
  let value = built.now.score.value;
  let step = 0;

  /*
   * THE TARGET IS THE CEILING, NOT THE GRID'S IDEAL.
   *
   * `ideal` is what fits the grid the account has, so a ladder aimed at it can
   * never need a Forma - it is achievable by definition, and the Forma branch
   * below would be a case that cannot arise. The brief asks for the other
   * question outright: what to do to push the build past what the player is
   * currently capable of. That target is the ceiling, and the way past the grid
   * is the Forma rungs.
   */
  const target = built.ceiling;

  /*
   * BOTH BUILDS ARE WANTED, and taking only the ceiling's was a real regression.
   *
   * The ceiling is searched on a fully polarised grid, so it can prefer a
   * different mod set entirely - a high-drain mod that is only affordable when
   * its slot halves it. Aim the ladder at that set alone and the mods `ideal`
   * wants are never offered, so the ladder cannot even reach the build the
   * player could assemble today: measured, it ended at 365 against an ideal of
   * 396 while reporting there was nothing left to do.
   *
   * The union is the honest candidate set. Which of the two a mod belongs to
   * does not need recording - the search decides what is worth placing at every
   * rung, and a mod that stops being worth it simply never wins one.
   */
  const wanted = new Map<string, { rank: number; kind: 'mod' | 'aura' }>();
  const want = (path: string, rank: number, kind: 'mod' | 'aura'): void => {
    const owned = input.owned.get(path);
    if (owned !== undefined && owned >= rank) return;
    const already = wanted.get(path);
    // The higher rank wins: the two builds can want the same mod at different
    // ranks, and the lower one is a step on the way to the higher one anyway.
    if (!already || rank > already.rank) wanted.set(path, { rank, kind });
  };
  for (const b of [built.ideal, target]) {
    for (const p of b.placed) want(p.path, p.rank, 'mod');
    if (b.aura) want(b.aura.path, b.aura.rank, 'aura');
  }

  /*
   * A HARD STOP, WHICH IS NOT THE HORIZON.
   *
   * This is the runaway guard: every mod the two builds want, plus a Forma for
   * each grid slot twice over - once to polarise it and once to change its
   * mind - is more rungs than can exist, so reaching it is a bug rather than a
   * long ladder. It used to be `wanted + GRID_SLOTS + 1`, which a real Braton
   * hit at rung 17 and was cut off 95 short of its own ceiling while the
   * overlay would have said there was nothing left to do.
   *
   * How many rungs are WORTH computing is the caller's decision, not this
   * one's: each costs several searches and only the consumer knows how many it
   * is going to show. `background.ts` stops drawing from this at its own
   * horizon, which is what keeps the cost proportional to what is on screen.
   */
  const maxRungs = wanted.size + GRID_SLOTS * 2 + 2;

  while (step < maxRungs) {
    const slots: SlotPlan = { ...input.slots, grid };

    /*
     * EVERY OPTION IS A CANDIDATE, INCLUDING THE FORMA.
     *
     * Forma used to be a fallback taken when no mod gained anything, and that
     * was wrong twice over. It emitted a rung whether or not the Forma itself
     * bought anything - a real run produced eleven consecutive "Forma madurai
     * +0" - and it could not be chosen while any mod still gained, even when
     * polarising was plainly the better move. Both disappear when it competes
     * on the same terms as everything else: one trial, one value, best wins.
     *
     * The polarities worth trying are the ones the target build is SHORT of,
     * which `formaPlan` has already worked out and ordered by deficit. Trying
     * the eight polarities in the game instead would spend six searches a rung
     * on slots nothing wants.
     */
    const deficit = formaPlan(
      target.placed.map((p) => p.polarity),
      grid,
    );
    /*
     * Two polarities a rung, not eight. `formaPlan` orders them by deficit, so
     * the first two are the ones the target build is shortest of; trying every
     * polarity in the game would spend six more searches a rung - 82 ms each,
     * on a ladder that is already the most expensive thing the controller does
     * - to consider slots nothing in the build wants.
     */
    const formaTries = deficit.to.slice(0, 2).map((t) => t.polarity);

    /*
     * Collected and then reduced, rather than folded into a `best` as they are
     * produced. A closure writing to an outer `let` defeats TypeScript's
     * narrowing completely - it reads the variable as never-assigned and every
     * field access on the winner becomes an error on `never` - and the array is
     * at most sixteen entries a rung.
     */
    const trials: Choice[] = [];

    for (const [path, want] of wanted) {
      const row = byPath.get(path);
      if (!row) {
        wanted.delete(path);
        continue;
      }
      const c = candidateAt(row, want.rank);
      const trial = want.kind === 'aura' ? pool : [...pool.filter((x) => x.row.uniqueName !== path), c];
      const withIt = search(question, input.item, trial, slots, want.kind === 'aura' ? c : auraCandidate);
      /*
       * Only a mod the account LACKS can be out of reach; a rank-up is Endo.
       * `reachable === false` is a measured no - the route names a planet and
       * the account has not been there. `null` is unknown and is NOT blocked:
       * refusing to recommend something because nobody could work out where it
       * comes from would be the app's own ignorance charged to the player.
       */
      const route = input.owned.get(path) === undefined ? routeTo(row, input.canReach) : null;
      const blocked = route?.kind === 'farm' && route.reachable === false;
      trials.push({ kind: want.kind, path, rank: want.rank, value: withIt.score.value, blocked });
      yield null; // one search done; let the caller breathe
    }

    for (const polarity of formaTries) {
      /*
       * The first unpolarised slot, or the last slot when every one already
       * carries a polarity - re-polarising is what a real Forma does to a full
       * grid. WHICH physical slot is a named unknown: the grid's index order is
       * not something the log reports, so this changes the multiset the search
       * is given and never claims a position.
       */
      const next = gridAfterForma(grid, polarity, target.placed.map((p) => p.polarity));
      if (next === null) continue; // this Forma would change nothing
      const withIt = search(question, input.item, pool, { ...input.slots, grid: next }, auraCandidate);
      trials.push({ kind: 'forma', polarity, grid: next, value: withIt.score.value, blocked: false });
      yield null;
    }

    /*
     * NOTHING THAT GAINS NOTHING IS EVER RECOMMENDED - except the one case
     * below, which is named rather than smuggled in.
     */
    /*
     * WHAT THE PLAYER CAN ACTUALLY DO OUTRANKS WHAT IS WORTH MOST.
     *
     * The overlay gives ONE instruction, and an instruction that cannot be
     * followed is not one. Measured on an early account - Earth, Venus,
     * Mercury, mastery 4 - the ladder's first rung was Serration from Ceres:
     * the single line the whole overlay exists to deliver, naming a planet the
     * player cannot reach. The `Missing` list this replaced never did that; it
     * sorted by `routeRank`, which puts an unreachable farm behind every
     * reachable one, and the ladder threw that away.
     *
     * This is not a trade-off between value and effort - there is no exchange
     * rate here and inventing one would be a fabricated number. It is that a
     * blocked step is not a step yet. Blocked candidates stay ON the ladder and
     * win the moment nothing reachable gains, so nothing is hidden: what
     * changes is only which one is called next.
     */
    let chosen: Choice | null = null;
    for (const t of trials) if (chosen === null || preferable(t, chosen)) chosen = t;

    /*
     * EVERYTHING LEFT IS SOMEWHERE THE PLAYER CANNOT GO.
     *
     * `preferable` defers a blocked step rather than dropping it, so the ladder
     * arrives here honestly: nothing actionable gains, and what remains is
     * behind a planet the account has not opened. Stopping would report
     * "nothing further to do" when the truth is that the next thing to do is on
     * the star chart. The rung says which planet, how far, and which node to
     * play, and carries a gain of ZERO - clearing a node raises no figure by
     * itself. It is the step that makes the next step possible.
     *
     * The NEAREST planet wins, not the one behind the best mod: the question
     * this answers is what to do tonight.
     */
    /*
     * `chosen.blocked` is a FAST PATH, not the test. What decides is the wall
     * collection below, which keeps only routes measured unreachable - so
     * deleting this condition changes nothing observable, and a sabotage
     * confirmed it. It is here because the loop walks every wanted mod and
     * calls `routeTo` on each, and there is no reason to do that when the best
     * step was something the player can already do.
     */
    if (chosen !== null && chosen.blocked && input.unlockPath) {
      const walls: Wall[] = [];
      for (const [path] of wanted) {
        const row = byPath.get(path);
        const route = row ? routeTo(row, input.canReach) : null;
        if (route?.kind !== 'farm' || route.reachable !== false || route.planet === null) continue;
        const way = input.unlockPath(route.planet);
        if (way) walls.push({ planet: route.planet, ...way });
      }
      const nearest = nearestWall(walls);
      if (nearest !== null) {
        step++;
        yield { step, kind: 'unlock', planet: nearest.planet, nodes: nearest.nodes, node: nearest.node, nodeName: nearest.nodeName, value, gain: 0 };
        break;
      }
    }

    /*
     * GROUNDWORK: THE STEP THAT PAYS OFF ONLY AFTER THE NEXT ONE.
     *
     * Greedy looks one step ahead, and a Forma is routinely worth nothing until
     * the mod it makes room for is in hand - while that mod is worth nothing
     * until the Forma is spent. Neither gains alone, so a ladder that insists
     * on a gain stops dead: measured, it ended at 1,188 against a ceiling of
     * 1,283 and left a mod the ceiling wants unmentioned, while reporting that
     * there was nothing further to do.
     *
     * That is not a limitation to state in a footnote, it is how Forma works,
     * and the player already knows it. So when nothing gains and the grid is
     * still short of what the ceiling wants, the next instruction is the Forma
     * with the largest deficit - `formaPlan` has already ordered them - and its
     * gain is reported as what it really is, which may be nothing yet.
     *
     * It cannot loop: every groundwork rung polarises one more slot, so the
     * deficit strictly decreases and the ladder either starts gaining again or
     * runs out of slots to prepare.
     */
    let groundwork = false;
    if (chosen === null || chosen.value <= value + 1e-9) {
      const laying = deficit.to[0]?.polarity;
      if (laying === undefined || wanted.size === 0) break;
      const next = gridAfterForma(grid, laying, target.placed.map((p) => p.polarity));
      // Nothing left to polarise usefully: groundwork that changes no slot is
      // the loop this whole helper exists to end.
      if (next === null) break;
      const after = search(question, input.item, pool, { ...input.slots, grid: next }, auraCandidate);
      yield null;
      chosen = { kind: 'forma', polarity: laying, grid: next, value: Math.max(after.score.value, value), blocked: false };
      groundwork = true;
    }

    step++;
    if (chosen.kind === 'forma') {
      grid = chosen.grid;
      const gain = chosen.value - value;
      value = chosen.value;
      yield { step, kind: 'forma', polarity: chosen.polarity, value: chosen.value, gain, groundwork };
      continue;
    }

    const row = byPath.get(chosen.path);
    /* c8 ignore next */
    if (!row) break;
    const c = candidateAt(row, chosen.rank);
    if (chosen.kind === 'aura') {
      auraCandidate = c;
    } else {
      pool = [...pool.filter((x) => x.row.uniqueName !== chosen.path), c];
    }
    const fromRank = input.owned.get(chosen.path) ?? null;
    const rung: Rung = {
      step,
      kind: chosen.kind,
      path: chosen.path,
      name: row.displayName,
      rarity: row.rarity,
      polarity: toPolarity(row.polarity),
      fromRank,
      toRank: chosen.rank,
      drain: drainAtRank(row.baseDrain ?? 0, chosen.rank),
      maxRank: row.fusionLimit ?? chosen.rank,
      cost: rankCost(row.rarity, fromRank ?? 0, chosen.rank),
      // Only a mod the account LACKS needs a route; a rank-up is not a hunt.
      route: fromRank === null ? routeTo(row, input.canReach) : null,
      value: chosen.value,
      gain: chosen.value - value,
    };
    value = chosen.value;
    wanted.delete(chosen.path);
    yield rung;
  }
}

/** Capacity and grid polarities from what the account and the catalogue say; unknowns fall to the safest reading and are named. */
export function slotPlanFor(input: {
  rank: number | null;
  maxRank: number;
  masteryRank: number;
  catalyst: boolean | null;
  stanceBonus: number | null;
  gridPolarities: readonly string[] | null;
}): { plan: SlotPlan; assumed: string[] } {
  const assumed: string[] = [];
  const rank = input.rank ?? 0;
  if (input.rank === null) assumed.push('item rank unknown: capacity computed at rank 0');
  const catalyst = input.catalyst ?? false;
  if (input.catalyst === null) assumed.push('catalyst unknown: capacity computed without one');
  const cap = capacityOf({ rank, maxRank: input.maxRank, masteryRank: input.masteryRank, catalyst }) + (input.stanceBonus ?? 0);
  const grid = (input.gridPolarities ?? []).map(toPolarity);
  if (input.gridPolarities === null) assumed.push('slot polarities unknown: every slot treated as unpolarised');
  return { plan: { grid, capacity: cap }, assumed };
}
