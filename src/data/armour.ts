/**
 * ARMOUR, AND THE DAMAGE THAT IGNORES IT.
 *
 * `data/modded.ts` answers "how much does this hit for". This file answers the
 * question that actually decides a Warframe build: how much of that hit ARRIVES,
 * and what fraction of the weapon's real damage never goes through armour at all.
 *
 * WHY THIS EXISTS
 * ---------------
 * The optimiser's first objective (Q1) scores damage per second to unarmoured
 * health. That is not merely narrow at the top of the game, it is MISLEADING:
 * at the armour cap a direct hit lands at a tenth of its value while a bleed
 * proc lands at full value, so a ranking blind to bleed is ranking the wrong
 * weapon. Everything here exists to let Q2 see that.
 *
 * EVERY NUMBER IS CITED, AND THE UNCERTAIN ONES ARE MARKED
 * -------------------------------------------------------
 * The source is `docs/research/armour-and-status.md`, which carries the wiki
 * pages each rule came from and whether two independent pages agreed. `RULES`
 * below labels each one exact / approx / assumed, the same discipline
 * `data/modded.ts` uses, and `UNKNOWN` names what this module does NOT resolve
 * so the strip can print its own ignorance rather than implying there is none.
 *
 * THIS IS THE UPDATE 36 CURVE (Jade Shadows, 2024-06-18). The armour rework
 * capped armour at 2,700, floored it at 200, stopped Steel Path multiplying it,
 * and replaced the old reduction curve with a square root specifically "to
 * increase the effectiveness of Partial Armor Stripping". Anything written
 * before June 2024 - most build calculators, nearly every guide - is on the
 * previous Update 27.2 arithmetic and will disagree with this file. 300 armour
 * used to cost half your damage. It now costs 30 %.
 */

import type { Verdict } from './modded';

/**
 * How each rule below was arrived at.
 *
 * `exact` - stated as a formula on the wiki, and confirmed on a second page.
 * `approx` - the wiki's own numbers only reconcile under one reading, and that
 *            reading is used; the alternative is named in the comment.
 * `assumed` - a value nothing states, chosen and labelled so it can be found.
 */
export const RULES: Readonly<Record<string, Verdict>> = {
  /** `DR = 0.9 * sqrt(netArmour / 2700)`; Armor page and Damage/Calculation agree. */
  enemyReduction: 'exact',
  /** Above the cap the curve falls back to `a / (a + 300)`. Armor page. */
  overCapReduction: 'exact',
  /** 2,700 cap and 200 floor, from the Update 36 patch note on the Armor page. */
  armourBounds: 'exact',
  /** `MBD = base * (1 + base damage bonuses) * (1 + faction)`; elements and physicals excluded. */
  moddedBaseDamage: 'exact',
  /** Slash 0.35, Heat 0.5, Toxin 0.5 of MBD; each from its own status page. */
  dotCoefficients: 'exact',
  /** 1 s delay, 1 s interval, 6 s duration, so six ticks. */
  dotTiming: 'exact',
  /** Bleed ignores armour and hits shields; toxin the reverse; true bypasses both. */
  bypass: 'exact',
  /** Slash scales with NO damage mods at all - not elemental, not physical, not slash. */
  bleedTakesNoElement: 'exact',
  /** Heat and toxin ticks scale by their OWN element bonus, off the whole MBD. */
  elementScalesItsOwnDot: 'exact',
  /** 26 % then +6 % a stack to 80 % at ten. Flat, not compounding - see `corrosiveStrip`. */
  corrosiveStrip: 'approx',
  /** Heat strips up to 50 %; the ramp's timing is not modelled, only its ceiling. */
  heatStripCeiling: 'approx',
  /** Two strips combine multiplicatively on the remaining armour. */
  stripsCombine: 'exact',
  /** Viral x2 at one stack, +0.25 each, x4.25 at ten (a +325 % bonus). Health only. */
  viral: 'exact',
  /** A type's proc share is its share of damage; physicals carry no extra weight since U27.2. */
  procWeights: 'exact',
  /** Hunter Munitions: 30 % on a CRITICAL hit, primaries only, an ordinary bleed. */
  hunterMunitions: 'exact',
  /** No stack cap on bleed, ignite or poison. Absence of a stated cap, not a stated absence. */
  noDotStackCap: 'approx',
  /** `N = rate x lifetime` for the live stack count. Little's Law; no distribution assumed. */
  steadyStateStacks: 'exact',
  /** Heat's live share is `1 - exp(-rate x 6)`: a Poisson lower bound on a periodic reality. */
  heatStripUptime: 'assumed',
};

/**
 * What this module does not know, in the player's words.
 *
 * A build optimiser that reports no uncertainty is lying, and the strip already
 * prints an "assumed" count - this is what feeds it. Every entry is a value the
 * research pass looked for and could not confirm on any page.
 */
export const UNKNOWN: readonly string[] = [
  'whether Hunter Munitions rolls once a shot or once a pellet',
  'whether a damage-over-time tick inherits the applying hit its critical tier',
  'whether bleed, ignite or poison have any stack cap at all',
  'whether Void damage bypasses armour',
  'what heat strip a continuously firing weapon holds',
  'whether the faction vulnerability applies to a damage-over-time tick',
  'whether the 200 armour floor applies to a unit whose base armour is zero, or only to units that have armour',
  'whether the 2,700 clamp is applied BEFORE or AFTER a status strip - the pages say the clamp is on the initial level-scaled value and that strip may go under the 200 floor, but never state the order when the unclamped figure would exceed 2,700. This module strips the CLAMPED value, which is the conservative reading',
  'how long a damage-attenuation window lasts on the thirteen special enemies that have one - the wiki carries an UpdateMe saying its own attenuation stats may be stale and the page needs a rewrite. NOT a gap in this objective: see ATTENUATION below',
];

/**
 * DAMAGE ATTENUATION IS OUT OF SCOPE, WHICH IS DIFFERENT FROM UNMODELLED.
 *
 * This module used to name "the general damage-attenuation formula" as an open
 * question, and the phrasing implied a hole in the level-9999 objective. Checked
 * against the source rather than inherited from a comment: the wiki's section is
 * titled **"Special Enemies and Damage Attenuation"**, and its subsections are
 *
 *   Archon · Condrix · Eidolons · Guardian Eximus · Hyekkas and Hyekka Masters
 *   Juggernaut (Behemoth) · Kuva Thralls · Lephantis / Hemocyte · Orphix
 *   Prosecutors · Sentients / Shadow Stalker · Raknoids · Treasurer
 *
 * Thirteen named units, every one a boss or a special. There is no attenuation
 * on the general enemy population, so there is no "general formula" to be
 * missing - the phrase was describing something that does not exist.
 *
 * Q2's target is an ordinary armoured mob at level 9999. Attenuation is a
 * different question about a different set of enemies, and it would need its own
 * objective with its own per-unit constants. What genuinely remains unknown is
 * how long an attenuation window lasts, and that is unknown to the wiki too:
 * the page opens with `{{UpdateMe|Unclear if new or old Damage Attenuation
 * stats, unclear how long it lasts. The whole page needs a check and rewrite.}}`
 *
 * Verified 2026-09-09 against wiki.warframe.com/w/Damage_Reduction, read through
 * the wiki's own api.php from a browser - Cloudflare returns a challenge to
 * plain HTTP clients.
 */
export const ATTENUATION = {
  appliesTo: 'special enemies only',
  namedUnits: 13,
  section: 'Special Enemies and Damage Attenuation',
  /*
   * THE HOST IS WRITTEN WITHOUT ITS PROTOCOL ON PURPOSE.
   *
   * `check-acquisition.ts` treats every `https://` literal under `src/` as a
   * host the app fetches and demands it be in the manifest's CORS allowance -
   * and it fired on this line. The gate is blunt and is right to be: a URL
   * literal in `src/` is one edit away from being a `fetch`, and this app must
   * never reach the wiki at runtime. The page is vendored, the provenance with
   * its full URL lives in the JSON beside the data, and this is a citation.
   */
  source: 'wiki.warframe.com/w/Damage_Reduction',
  verified: '2026-09-09',
  /** No attenuation applies to the ordinary population Q2 is aimed at. */
  appliesToOrdinaryMobs: false,
} as const;

// ---------------------------------------------------------------------------
// Armour
// ---------------------------------------------------------------------------

/**
 * The Update 36 bounds. Armour cannot scale past the cap; the floor is what an
 * enemy with a low base is raised to. Both from the patch note on the Armor page.
 */
export const ARMOUR_CAP = 2700;
export const ARMOUR_FLOOR = 200;

/**
 * THE LEVEL CURVE - the ninth function, and the one that was never written.
 *
 * `armour-and-status.md` A5 lists nine things Q2 needs; eight of them are in
 * this file and this was the missing one, so the optimiser has always scored
 * against a bare constant with no way to ask what a LEVEL means. The formulas
 * below are that document's A5a-A5e, all marked EXACT there except the blend.
 *
 *   q  = level - baseLevel        the unit's own spawn level, not 1
 *   f1 = 1 + 0.005 * q^1.75       the low curve
 *   f2 = 1 + 0.4   * q^0.75       the high curve
 *   blended by smoothstep over q in 70..80, then floored at 200 and capped
 *   at 2,700.
 *
 * WHAT IT SETTLES, and it is the whole reason a level-9999 objective is
 * tractable at all: at q = 9998 the multiplier is about 400.9, so a unit with
 * 100 base armour reaches roughly 40,090 - and the cap takes it to 2,700. EVERY
 * unit at that level sits exactly at the cap, at exactly 90 % reduction. The
 * armour target for level 9999 is therefore not an estimate and not a choice,
 * it is 2,700 by proof, and the only thing that can move it is a STRIP.
 *
 * The floor is applied to the INITIAL value only, which is why it lives here
 * and not in `netArmour`: a strip is allowed to take an enemy below 200.
 */
export function armourAtLevel(input: { baseArmour: number; baseLevel: number; level: number; steelPath?: boolean }): number {
  const base = Math.max(0, input.baseArmour);
  /*
   * Steel Path adds levels and, since Update 36, NOTHING else to armour - the
   * old armour multiplier was removed. So it enters here as +100 levels and
   * nowhere else; A5f carries the Archwing and Duviri variants, which a caller
   * that knows the mission type can pass as a level of its own instead.
   */
  const level = input.level + (input.steelPath === true ? STEEL_PATH_LEVELS : 0);
  const q = Math.max(0, level - input.baseLevel);
  if (q === 0) return clampArmour(base);

  const f1 = 1 + 0.005 * q ** 1.75;
  const f2 = 1 + 0.4 * q ** 0.75;
  /*
   * Smoothstep, not a linear ramp. The wiki gives `t` and `s` verbatim and does
   * not print the lerp; `f1 + s * (f2 - f1)` is the only reading under which
   * `s` means anything, and it reproduces the worked table to three figures -
   * level 80 lands on 11.596 against the document's 11.596. That agreement is
   * what the gate asserts, so if the reading is ever shown to be wrong the
   * table and the code fail together rather than drifting apart.
   */
  const t = Math.min(1, Math.max(0, (q - 70) / 10));
  const s = t * t * (3 - 2 * t);
  return clampArmour(base * (f1 + s * (f2 - f1)));
}

/** Steel Path's level bonus on ordinary missions. A5f. */
export const STEEL_PATH_LEVELS = 100;

/**
 * The floor and the cap, applied to an INITIAL armour value only.
 *
 * A UNIT WITH NO ARMOUR IS NOT RAISED TO 200. A5e reads "initial armour below
 * 200 is raised to 200" and says nothing about zero, and the literal reading
 * would hand every unarmoured Corpus unit 200 armour and a quarter of its
 * damage taken away. Zero is treated as unarmoured and the question is named in
 * `UNKNOWN` rather than decided quietly; the floor applies to units that have
 * armour to floor.
 */
function clampArmour(armour: number): number {
  if (armour <= 0) return 0;
  return Math.min(ARMOUR_CAP, Math.max(ARMOUR_FLOOR, armour));
}

/**
 * The fraction of a hit an ENEMY's armour removes.
 *
 * `0.9 * sqrt(netArmour / 2700)` up to the cap, which is why the cap is exactly
 * 90 %. Above it - reachable only by non-scaling sources, never by level - the
 * curve falls back to `a / (a + 300)`.
 *
 * DO NOT USE THIS FOR A PLAYER. The Tenno formula is `a / (a + 300)` at every
 * value, a different curve entirely: 300 armour is 50 % for a Warframe and 30 %
 * for an enemy. Confusing the two is the single easiest mistake here and the
 * gate asserts against it directly.
 */
export function enemyDamageReduction(netArmour: number): number {
  const a = Math.max(0, netArmour);
  if (a > ARMOUR_CAP) return a / (a + 300);
  return 0.9 * Math.sqrt(a / ARMOUR_CAP);
}

/** What survives armour: `1 - reduction`. At the cap this is exactly 0.1. */
export function enemyDamageMultiplier(netArmour: number): number {
  return 1 - enemyDamageReduction(netArmour);
}

// ---------------------------------------------------------------------------
// What bypasses what
// ---------------------------------------------------------------------------

export type ProcKind = 'bleed' | 'ignite' | 'poison' | 'true' | 'direct';

/**
 * THE LOAD-BEARING FACT OF THE WHOLE OBJECTIVE.
 *
 * One wiki sentence carries the entire split, and both halves were confirmed on
 * a second page: toxin bypasses shields but not armour; slash bypasses armour
 * but not shields. Since Update 36 a bleed also damages shields over time,
 * which is why `shields` is true for it.
 *
 * At the armour cap this is a factor of ten. A bleed proc arrives whole while
 * everything around it arrives at a tenth, so a weapon's slash share is worth
 * more than almost any mod choice - and the first objective could not see it.
 */
export function mitigatedBy(kind: ProcKind): { armour: boolean; shields: boolean } {
  switch (kind) {
    case 'bleed':
      return { armour: false, shields: true };
    case 'poison':
      return { armour: true, shields: false };
    case 'true':
      return { armour: false, shields: false };
    case 'ignite':
    case 'direct':
      return { armour: true, shields: true };
  }
}

/** The multiplier this kind of damage actually lands at, against health behind armour. */
export function landsAt(kind: ProcKind, netArmour: number): number {
  return mitigatedBy(kind).armour ? enemyDamageMultiplier(netArmour) : 1;
}

// ---------------------------------------------------------------------------
// The damage-over-time procs
// ---------------------------------------------------------------------------

/** One second before the first tick, one second between them, six seconds long. */
export const DOT_DELAY_S = 1;
export const DOT_INTERVAL_S = 1;
export const DOT_DURATION_S = 6;
export const DOT_TICKS = 6;

/** The coefficients, each stated on its own status page. */
export const BLEED_COEFFICIENT = 0.35;
export const IGNITE_COEFFICIENT = 0.5;
export const POISON_COEFFICIENT = 0.5;

/**
 * "A fraction of WHAT", which is the detail nearly every secondary source gets
 * wrong.
 *
 * `Modded Base Damage = Base * (1 + base damage bonuses) * (1 + faction)`.
 *
 * BASE DAMAGE BONUSES ONLY - Serration, Pressure Point, Hornet Strike. Elemental
 * mods are NOT in it and neither are physical ones: a 90 % heat mod does not
 * raise the base a bleed is taken from, and Buzz Kill does not raise a bleed at
 * all. The overview table's "35 % of the base damage" is shorthand; the
 * per-status pages are the authority and they state this form identically.
 *
 * Faction appears here AND again in the tick, which is the known double-dip.
 */
export function moddedBaseDamage(input: { base: number; baseDamageBonus?: number; faction?: number }): number {
  return input.base * (1 + (input.baseDamageBonus ?? 0)) * (1 + (input.faction ?? 0));
}

interface TickInput {
  moddedBase: number;
  /** The proc's own element bonus, as a fraction. Ignored for bleed - it has none. */
  elementBonus?: number;
  faction?: number;
  statusDamageBonus?: number;
  /** Crit and headshot, which a tick can carry. Left at 1 by default; see UNKNOWN. */
  additional?: number;
}

function tick(coefficient: number, elementScales: boolean, i: TickInput): number {
  const element = elementScales ? 1 + (i.elementBonus ?? 0) : 1;
  return coefficient * i.moddedBase * element * (1 + (i.faction ?? 0)) * (1 + (i.statusDamageBonus ?? 0)) * (i.additional ?? 1);
}

/**
 * One tick of a bleed. Scales with NOTHING beyond the modded base: not
 * elemental mods, not physical mods, not even a slash mod. That is why it is
 * stated separately from the other two rather than sharing their signature.
 */
export function bleedTick(i: Omit<TickInput, 'elementBonus'>): number {
  return tick(BLEED_COEFFICIENT, false, i);
}

/**
 * One tick of an ignite. Half of the WHOLE modded base times the heat bonus -
 * not half of the heat portion of the hit. A weapon with no innate heat and one
 * 90 % heat mod ignites for `0.5 * MBD * 1.9` off its entire base damage, which
 * is why heat is strong and why this is the second-most mis-stated number here.
 */
export function igniteTick(i: TickInput): number {
  return tick(IGNITE_COEFFICIENT, true, i);
}

/** One tick of a poison. Same shape as ignite, scaled by the toxin bonus. */
export function poisonTick(i: TickInput): number {
  return tick(POISON_COEFFICIENT, true, i);
}

/** Everything one proc deals over its life: six ticks, no ramp, no falloff. */
export function procTotal(perTick: number): number {
  return perTick * DOT_TICKS;
}

// ---------------------------------------------------------------------------
// The procs that change armour or damage
// ---------------------------------------------------------------------------

export const CORROSIVE_FIRST = 0.26;
export const CORROSIVE_PER_STACK = 0.06;
export const CORROSIVE_MAX_STACKS = 10;
export const CORROSIVE_MAX_STRIP = 0.8;
/** Each stack lives 8 s on its own timer; an eleventh replaces the oldest. D-table, EXACT. */
export const CORROSIVE_DURATION_S = 8;

/**
 * The fraction of armour a corrosive stack count removes.
 *
 * 26 % for the first stack and 6 % for each after it, to 80 % at ten stacks.
 *
 * FLAT, NOT COMPOUNDING - and this is now SETTLED rather than assumed, so it
 * has come out of `UNKNOWN`. Three independent confirmations, all from
 * wiki.warframe.com/w/Damage/Corrosive_Damage and its linked pages:
 *
 *   1. The stated endpoints only work linearly. `0.20 + 0.06 x 1` is 26 % and
 *      `0.20 + 0.06 x 10` is 80 %, which are the two figures the page prints.
 *      Per-stack compounding gives 57.6 % at ten, which it does not.
 *   2. The page's own formula is one additive bracket, not a product over
 *      stacks: `(1 - 50%) x [1 - (20% + 6% x stacks)] x (1 - 18% x projections)`.
 *   3. THE ARCHON SHARD CASE IS IMPOSSIBLE UNDER COMPOUNDING. An Emerald shard
 *      raises the cap to 14 stacks and the page states that "applying 14 stacks
 *      can fully remove all armor". `0.20 + 0.06 x 14` is 104 %; a product of
 *      per-stack factors can never reach zero.
 *
 * The word that caused the confusion is "multiplicative", which on these pages
 * means multiplicative BETWEEN SOURCES - heat against corrosive against
 * Corrosive Projection, as `combinedStrip` does - and never per stack within
 * corrosive itself.
 *
 * The one immaterial difference left: the wiki writes the series as
 * `20% + 6% x n` where this writes `26% + 6% x (n - 1)`. Identical for every
 * n >= 1, and n = 0 is handled above, so no caller can tell. This module does
 * NOT claim an innate 20 % exists without a first proc.
 */
export function corrosiveStrip(stacks: number): number {
  const n = Math.max(0, Math.min(CORROSIVE_MAX_STACKS, Math.floor(stacks)));
  if (n === 0) return 0;
  return Math.min(CORROSIVE_MAX_STRIP, CORROSIVE_FIRST + CORROSIVE_PER_STACK * (n - 1));
}

/**
 * The most armour a heat proc removes: half of it.
 *
 * Only the CEILING is exposed. The real behaviour is a ramp - 15 / 30 / 40 / 50
 * per cent in half-second steps, reaching the maximum at two seconds, then
 * restoring in the same steps every 1.5 s once the procs stop - and a weapon's
 * position on that ramp depends on how continuously it is firing, which the
 * catalogue cannot tell us. Averaging the ramp into one number would produce a
 * value that is true at no moment of the fight, so the ramp is named in
 * `UNKNOWN` and the ceiling is what callers get.
 */
export const HEAT_MAX_STRIP = 0.5;
export function heatStripCeiling(): number {
  return HEAT_MAX_STRIP;
}

/**
 * The heat strip a weapon actually holds, derived from its own heat proc rate.
 *
 * `liveStacks` is the wrong instrument here and the difference matters: heat's
 * strip is a RAMP over time under heat status, not a per-stack quantity, so a
 * second heat proc strips nothing extra. What decides the strip is the share of
 * the fight during which a heat proc is live AT ALL.
 *
 * Under Poisson arrivals that share is exactly `1 - exp(-rate x duration)`, and
 * periodic arrivals - which is what a weapon firing at a fixed rate really
 * produces - keep status live MORE of the time than Poisson at the same rate.
 * So this is a lower bound on the uptime under either reading.
 *
 * Two more reasons it stays a floor rather than a guess. The ramp's own
 * position is not modelled, but it reaches the ceiling in 2 s of a 6 s proc, so
 * treating a live proc as a ceiling proc costs little; and the arriving-damage
 * curve is CONVEX in the strip, so scaling a strip by its uptime understates
 * the damage that arrives rather than overstating it (Jensen).
 *
 * Where the ramp sits at a given instant remains in `UNKNOWN`, unchanged.
 */
export function heatStrip(procsPerSecond: number): number {
  const live = 1 - Math.exp(-Math.max(0, procsPerSecond) * DOT_DURATION_S);
  return live * heatStripCeiling();
}

/**
 * Two strips on one enemy multiply on what is LEFT, not on the original.
 *
 * 80 % corrosive and 50 % heat leave `0.2 * 0.5` = a tenth, so 90 % combined -
 * and that takes an enemy at the armour cap from 90 % reduction to 28.46 %, a
 * 7.15x gain in what arrives. Partial stripping being worth nearly as much as
 * full stripping is the entire point of the Update 36 curve.
 */
export function combinedStrip(...strips: number[]): number {
  return 1 - strips.reduce((remaining, s) => remaining * (1 - Math.max(0, Math.min(1, s))), 1);
}

/** What is left of an enemy's armour after a strip. */
export function netArmour(baseArmour: number, strip = 0): number {
  return Math.max(0, baseArmour) * (1 - Math.max(0, Math.min(1, strip)));
}

/**
 * HOW MANY STACKS ARE LIVE AT ONCE, derived from the rate they arrive and how
 * long each one lasts. `N = rate x lifetime`, clamped to the cap.
 *
 * This is Little's Law and it is EXACT, not a heuristic: for ANY arrival
 * process whatever, the mean number in a system is the mean arrival rate times
 * the mean time each spends in it. Every stack here carries its own fixed
 * timer, so the time in the system is a constant and no assumption about how
 * the procs are distributed enters the arithmetic.
 *
 * The consequence is worth stating plainly, because it is why stripping belongs
 * in the objective at all: a weapon landing four corrosive procs a second holds
 * THIRTY-TWO of them in steady state. The cap binds, not the rate, for anything
 * with real status - so the ten-stack 80 % strip is not an aspiration, it is
 * what an ordinary status weapon sits at continuously.
 *
 * FLOORED, deliberately. A stack count is an integer, the strip functions floor
 * anyway, and taking the floor of the mean is the conservative reading of a
 * strip that jumps 26 % on its first stack. Q2 is a floor and stays one.
 *
 * NO CORRECTION IS NEEDED for the wiki's rule that a hit lands before its own
 * proc applies: arrivals in the window BEFORE now are precisely the stacks a
 * shot arriving now finds already standing.
 */
export function liveStacks(procsPerSecond: number, lifetimeSeconds: number, cap: number): number {
  const n = Math.max(0, procsPerSecond) * Math.max(0, lifetimeSeconds);
  return Math.min(Math.max(0, cap), Math.floor(n));
}

export const VIRAL_FIRST = 2;
export const VIRAL_PER_STACK = 0.25;
export const VIRAL_MAX_STACKS = 10;
/** Each stack lives 6 s. Viral Damage page, EXACT. */
export const VIRAL_DURATION_S = 6;

/**
 * HOW LONG EACH STATUS STAYS ON THE TARGET, in seconds.
 *
 * Three of these were already constants here and were scattered across the
 * file; the rest come from the same wiki pages the strip model is built on.
 * They are gathered because the count below needs EVERY type's lifetime, not
 * just the three that strip or multiply.
 *
 * The four that carry no duration - impact, puncture and slash's own stagger
 * behaviours aside - are the ones whose whole effect is instantaneous or is a
 * stacking debuff whose duration the wiki states directly.
 */
export const STATUS_DURATION_S: Readonly<Record<string, number>> = {
  impact: 6,
  puncture: 6,
  slash: DOT_DURATION_S,
  heat: DOT_DURATION_S,
  cold: 6,
  electricity: DOT_DURATION_S,
  toxin: DOT_DURATION_S,
  blast: 6,
  radiation: 12,
  gas: DOT_DURATION_S,
  magnetic: 6,
  viral: VIRAL_DURATION_S,
  corrosive: CORROSIVE_DURATION_S,
  void: 6,
};

/**
 * HOW MANY DISTINCT STATUS TYPES ARE LIVE ON THE TARGET, expected.
 *
 * WHY THIS EXISTS. `scoredEffects` drops every effect carrying a
 * `scalingBasis`, and the single largest basis in the catalogue is "status type
 * affecting the target" - 45 effects across the mod pool, led by CONDITION
 * OVERLOAD, which is the mod a real level-9999 melee build is built around. The
 * optimiser scored it at nothing, so it never recommended it, so the answer it
 * gave was the best build in a game where Condition Overload does not exist.
 * 85 mods in the catalogue are scored as worth nothing at all for this reason.
 *
 * THE POINT IS THAT THIS NEEDS NO ASSUMPTION ABOUT THE PLAYER. Most dropped
 * conditions genuinely do - "on kill", "when aiming", "on bullet jump" depend
 * on how somebody fights, and scoring them would mean inventing a playstyle.
 * The number of status types on the target does not: it is a function of the
 * build's own proc rate and its own damage composition, both of which the
 * optimiser already computes to derive the corrosive strip and the viral
 * multiplier.
 *
 * THE MATH. Each status type t arrives as its own process at rate
 * `procsPerSecond x share(t)` and each instance lasts `STATUS_DURATION_S[t]`.
 * For a Poisson arrival process the chance that AT LEAST ONE instance of t is
 * live at a given moment is `1 - exp(-rate x lifetime)`, and the expected
 * number of DISTINCT types live is the sum of those probabilities over types -
 * exactly, by linearity of expectation, with no independence assumption needed
 * between types because expectation is linear regardless.
 *
 * IT IS A FLOOR, in the same direction and for the same reason `heatStrip` is:
 * a real weapon fires periodically rather than in a Poisson process, and a
 * periodic arrival keeps a status up MORE reliably than a random one of the
 * same rate. So a build is never credited with more types than it sustains.
 */
export function liveStatusTypes(input: { procsPerSecond: number; shares: ReadonlyMap<string, number> }): number {
  const rate = Math.max(0, input.procsPerSecond);
  if (rate === 0) return 0;
  let expected = 0;
  for (const [type, share] of input.shares) {
    const lifetime = STATUS_DURATION_S[type];
    if (lifetime === undefined || share <= 0) continue;
    expected += 1 - Math.exp(-rate * share * lifetime);
  }
  return expected;
}



/**
 * The multiplier viral puts on damage to HEALTH: `2 + 0.25 * (stacks - 1)`.
 *
 * x2 at one stack, a quarter more for each after, x4.25 at ten. It works
 * through armour - "yellow health" - which is why it competes with stripping
 * rather than duplicating it.
 *
 * FOUR POINT TWO FIVE, NOT THREE POINT TWO FIVE. The research doc states the
 * formula, states the cap as "+325 %", and then writes "10 stacks -> x3.25".
 * The formula and the +325 % agree with each other and with this code; the
 * third line confused the BONUS with the MULTIPLIER, which is the commonest
 * slip in the whole domain. +325 % is x4.25.
 *
 * IT REACHES A DAMAGE-OVER-TIME TICK, AND THAT IS NOW SETTLED. It used to be in
 * `UNKNOWN`, and the answer decides whether viral and slash compete or compound
 * - the single most consequential open question for a high-level objective.
 * wiki.warframe.com/w/Damage/Viral_Damage: the multiplier is evaluated per tick
 * against whether a viral proc is live AT THAT TICK, and is "not applied twice
 * to DoTs, unlike faction damage multipliers". Its worked example is a
 * 100-damage slash proc dealing 70 a second under viral and 35 without.
 *
 * So a scorer applies this to the direct term and to every proc term alike, and
 * bleed's armour-bypass and viral's health multiplier COMPOUND. Two caveats the
 * same page carries, both of which bound what a build can really hold: a hit
 * applies its own viral stack AFTER dealing its damage, so no shot benefits
 * from its own proc, and multishot pellets do not benefit from each other's.
 *
 * HEALTH ONLY. Not shields, not overguard - though it does work through armour
 * ("yellow health"), which is why it competes with stripping rather than
 * duplicating it.
 */
export function viralMultiplier(stacks: number): number {
  const n = Math.max(0, Math.min(VIRAL_MAX_STACKS, Math.floor(stacks)));
  if (n === 0) return 1;
  return VIRAL_FIRST + VIRAL_PER_STACK * (n - 1);
}

// ---------------------------------------------------------------------------
// Which proc a hit produces
// ---------------------------------------------------------------------------

/**
 * A damage type's share of the procs it will cause: its share of the damage.
 *
 * PHYSICAL TYPES CARRY NO EXTRA WEIGHT. Impact, puncture and slash were biased
 * four to one against the elements until Update 27.2 removed it, and every
 * guide written before March 2020 still says otherwise. A weapon that is a
 * quarter slash bleeds on a quarter of its procs, no more.
 *
 * Types with no damage are dropped rather than returned at zero, so a caller
 * iterating the result never has to filter.
 */
export function procTypeWeights(damageByType: ReadonlyArray<{ type: string; amount: number }>): Map<string, number> {
  const total = damageByType.reduce((n, d) => n + Math.max(0, d.amount), 0);
  const out = new Map<string, number>();
  if (total <= 0) return out;
  for (const d of damageByType) if (d.amount > 0) out.set(d.type, (out.get(d.type) ?? 0) + d.amount / total);
  return out;
}

/**
 * Hunter Munitions, the mod the app could not see at all until now.
 *
 * 30 % at max rank, on a CRITICAL HIT rather than on a status roll - so it is
 * independent of status chance and of the damage-type split, and it lands on
 * top of whatever procs the hit already caused. Primaries only. The bleed it
 * produces is an ordinary one, 0.35 of the modded base.
 *
 * Whether it rolls once per shot or once per pellet is NOT stated anywhere and
 * is in `UNKNOWN`; on a shotgun that is a factor of four, larger than any mod
 * choice this optimiser would make, so it is named rather than guessed.
 */
export const HUNTER_MUNITIONS = {
  chanceAtMaxRank: 0.3,
  triggersOn: 'critical hit' as const,
  slotsOn: 'primary' as const,
  produces: 'bleed' as const,
};
