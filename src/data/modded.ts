/**
 * The modding arithmetic: what a build does to an item's numbers.
 *
 * Every rule here is labelled with the verdict the wiki verification gave it
 * (`docs/research/modding-arithmetic.md`, 2026-09-07): EXACT when the wiki
 * states it, APPROX when a table or example implies it, ASSUMED when the wiki
 * contradicts itself or is silent and a choice had to be made. A caller that
 * shows a number derived from an ASSUMED rule shows the label with it; the
 * optimiser never lets an ASSUMED rule decide a build silently. `RULES` is the
 * one place the labels live, so a gate can assert that no rule is unlabelled.
 *
 * Pure functions over plain numbers. No catalogue, no account, no fetch: the
 * catalogue's job is to hand these the right inputs, and the gate's job is to
 * hold them to the wiki's own worked examples (Maim's 87.5, Hek's 525, the
 * 1.54 s reload, the 58.5 → 59 magazine, the 297.8202 bleed tick).
 *
 * Percentages are on the 100 scale as the game prints them (+165 means 165 %)
 * and are converted here, once. Absent inputs are `null` and propagate as
 * `null`: a stat the export did not carry is unknown, never zero.
 */

export type Verdict = 'exact' | 'approx' | 'assumed';

/** The verdict of every rule in this file, by the name of the function that applies it. */
export const RULES: Readonly<Record<string, Verdict>> = {
  capacity: 'exact',
  capacityLegendaryFloor: 'assumed', // whether the LR floor can exceed a rank-30 item's 30: NOT FOUND
  drainAtRank: 'exact',
  slotDrain: 'exact',
  slotDrainUniversalUmbra: 'exact',
  slotDrainUmbraMadurai: 'assumed', // Umbra <-> Madurai matching: NOT FOUND on the wiki
  auraBonus: 'exact', // matched (x2) and unpolarised (x1)
  auraBonusMismatched: 'assumed', // three contradictory wiki rules; 75 % half-up chosen
  moddedStat: 'exact',
  critChance: 'exact',
  critDamage: 'exact',
  critTierMultiplier: 'exact',
  averageCritMultiplier: 'exact',
  headshotCritMultiplier: 'exact',
  quantise32: 'exact',
  elementalDamage: 'exact',
  physicalDamage: 'exact',
  combineElements: 'exact', // pairs, order, innate-last
  combineElementsLeftover: 'approx', // a leftover single stays single: implied, never stated
  multishot: 'exact',
  fireRate: 'exact',
  chargeFireRate: 'exact',
  reloadTime: 'exact',
  magazineSize: 'exact',
  sustainedDps: 'exact',
  factionMultiplier: 'exact',
  statusChance: 'approx', // base x (1 + sum) is confirmed only through the Weeping Wounds formula
  procsPerShot: 'exact',
  comboMultiplier: 'exact',
  comboScaledBonus: 'exact',
  conditionOverload: 'approx', // two rules: additive on hitscan, multiplicative on projectile weapons
};

// ---------------------------------------------------------------------------
// A. Capacity and drain
// ---------------------------------------------------------------------------

/**
 * A1. `max(rank, 15 + floor(MR / 2) [+1 per Legendary Rank]) x (catalyst ? 2 : 1)`.
 * The mastery term is a FLOOR, never an addend. Whether the floor may exceed
 * a rank-30 item's 30 for Legendary players is NOT FOUND; `min(floor,
 * maxRank)` is the assumption, labelled.
 */
export function capacity(input: {
  rank: number;
  maxRank: number;
  masteryRank: number;
  legendaryRank?: number;
  catalyst: boolean;
}): number {
  const floor = 15 + Math.floor(input.masteryRank / 2) + (input.legendaryRank ?? 0);
  const base = Math.max(input.rank, Math.min(floor, input.maxRank));
  return base * (input.catalyst ? 2 : 1);
}

/** A2. Drain rises one per rank from the base drain. Auras and stances carry negative base drains. */
export function drainAtRank(baseDrain: number, rank: number): number {
  return baseDrain < 0 ? baseDrain - rank : baseDrain + rank;
}

export type Polarity =
  | 'madurai'
  | 'naramon'
  | 'vazarin'
  | 'zenurik'
  | 'unairu'
  | 'penjaga'
  | 'umbra'
  | 'universal'
  | 'none';

/**
 * A3 / A5. Matched: `ceil(d / 2)`. Mismatched: `d + roundHalfUp(d / 4)` (the
 * wiki's bracket list 2–5 → +1, 6–9 → +2, 10–13 → +3, 14–16 → +4 is the proof
 * of half-up). Unpolarised: `d`. A universal slot matches everything EXCEPT
 * Umbra, whose mods pay base drain there. Umbra against Madurai in either
 * direction is NOT FOUND and is treated as a plain mismatch, labelled.
 */
export function slotDrain(d: number, slot: Polarity, mod: Polarity): number {
  if (slot === 'none' || mod === 'none') return d;
  if (slot === 'universal') return mod === 'umbra' ? d : Math.ceil(d / 2);
  if (slot === mod) return Math.ceil(d / 2);
  return d + roundHalfUp(d / 4);
}

/**
 * A4. Aura and stance bonuses: matched doubles the bonus; unpolarised gives
 * the listed bonus; mismatched is a three-way CONFLICT on the wiki (25 % off
 * rounded mathematically / 20 % off / 80 % rounded down) whose published
 * examples (5 → 4, 9 → 7) satisfy every version. They diverge at bonus 1, 2
 * and 6. 75 % half-up is used, and `RULES.auraBonusMismatched` says so; an
 * unranked stance in a wrong-polarity slot settles it in-game.
 */
export function auraBonus(bonus: number, slot: Polarity, mod: Polarity): number {
  if (slot === 'none' || mod === 'none') return bonus;
  if (slot === mod || (slot === 'universal' && mod !== 'umbra')) return bonus * 2;
  return roundHalfUp(bonus * 0.75);
}

// ---------------------------------------------------------------------------
// B. Damage
// ---------------------------------------------------------------------------

/** B1. `base x (1 + sum of bonuses)`, bonuses on the 100 scale. */
export function moddedStat(base: number | null, sumPct: number): number | null {
  return base === null ? null : base * (1 + sumPct / 100);
}

/** B4. `base x (1 + relative) + absolute`; absolute bonuses are added AFTER the multiply. */
export function critChance(base: number | null, relPct: number, absPct = 0): number | null {
  return base === null ? null : base * (1 + relPct / 100) + absPct / 100;
}

export function critDamage(base: number | null, relPct: number): number | null {
  return base === null ? null : base * (1 + relPct / 100);
}

/** B4. `1 + tier x (CD - 1)`; tier 1 yellow, 2 orange, 3 red. */
export function critTierMultiplier(cd: number, tier: number): number {
  return 1 + tier * (cd - 1);
}

/** B4. Expected multiplier over many hits: `1 + CC x (CD - 1)`, CC as a fraction and allowed above 1. */
export function averageCritMultiplier(cc: number, cd: number): number {
  return 1 + cc * (cd - 1);
}

/**
 * B4. A crit on a head: `HM x (1 + tier x (2 x CD - 1))`, HM 3.0 almost
 * everywhere. No headcrit on Corpus humanoids and none on a weapon whose head
 * multiplier is 1 - callers pass `headMultiplier` 1 for those and get the
 * plain crit tier back.
 */
export function headshotCritMultiplier(cd: number, tier: number, headMultiplier = 3): number {
  if (headMultiplier === 1) return critTierMultiplier(cd, tier);
  return headMultiplier * (1 + tier * (2 * cd - 1));
}

/** B1/B2. Every damage type is rounded to the nearest 1/32 of the attack's base damage before further multipliers. */
export function quantise32(value: number, baseTotal: number): number {
  if (baseTotal <= 0) return value;
  const step = baseTotal / 32;
  return Math.round(value / step) * step;
}

/** B2. An elemental mod adds `baseTotal x pct` of that element, quantised to 1/32 of base. */
export function elementalDamage(baseTotal: number, pct: number): number {
  return quantise32(baseTotal * (pct / 100), baseTotal);
}

/** B2. A physical mod scales only its own type: `typeBase x (1 + pct)`, quantised. Absent physical stays absent. */
export function physicalDamage(typeBase: number, baseTotal: number, pct: number): number {
  return typeBase === 0 ? 0 : quantise32(typeBase * (1 + pct / 100), baseTotal);
}

export type Element = 'heat' | 'cold' | 'electricity' | 'toxin';
export type Combined = 'blast' | 'corrosive' | 'gas' | 'magnetic' | 'radiation' | 'viral';

const PAIRS: ReadonlyArray<[Element, Element, Combined]> = [
  ['cold', 'heat', 'blast'],
  ['electricity', 'toxin', 'corrosive'],
  ['heat', 'toxin', 'gas'],
  ['cold', 'electricity', 'magnetic'],
  ['heat', 'electricity', 'radiation'],
  ['cold', 'toxin', 'viral'],
];

function pairOf(a: Element, b: Element): Combined | null {
  for (const [x, y, c] of PAIRS) if ((a === x && b === y) || (a === y && b === x)) return c;
  return null;
}

/** Kuva / Tenet dual innates follow HCET order. */
const HCET: readonly Element[] = ['heat', 'cold', 'electricity', 'toxin'];

/**
 * B3. Elements combine in pairs in the order they are placed, top-left first.
 * The sub-rules the memo lacked, each from the Damage page:
 *   - a repeated element keeps the position of its FIRST occurrence;
 *   - innate elements come last, except that an innate element moves to the
 *     position of the first mod of the same element;
 *   - two innate elements are ordered HCET;
 *   - a leftover single element stays single (approx: implied, never stated).
 * Returns the resulting damage types in order, each with what it was made of.
 */
export function combineElements(
  modOrder: readonly Element[],
  innate: readonly Element[] = [],
): Array<{ type: Element | Combined; from: Element[] }> {
  const order: Element[] = [];
  const seen = new Set<Element>();
  const place = (e: Element) => {
    if (seen.has(e)) return;
    seen.add(e);
    order.push(e);
  };
  for (const e of modOrder) place(e);
  const innateSorted = [...innate].sort((a, b) => HCET.indexOf(a) - HCET.indexOf(b));
  for (const e of innateSorted) place(e);

  const out: Array<{ type: Element | Combined; from: Element[] }> = [];
  for (let i = 0; i < order.length; i += 2) {
    const a = order[i]!;
    const b = order[i + 1];
    const c = b === undefined ? null : pairOf(a, b);
    if (b !== undefined && c) out.push({ type: c, from: [a, b] });
    else {
      out.push({ type: a, from: [a] });
      if (b !== undefined) out.push({ type: b, from: [b] });
    }
  }
  return out;
}

/** B5. Total projectiles: `count x (1 + pct)`; the fractional part is a chance of one more. */
export function multishot(count: number | null, pct: number): number | null {
  return count === null ? null : count * (1 + pct / 100);
}

/** B6. Fire rate scales linearly regardless of trigger. */
export function fireRate(base: number | null, pct: number): number | null {
  return moddedStat(base, pct);
}

/** B6. Charge weapons: `1 / (chargeTime / (1 + pct) + 1 / fireRate)`. */
export function chargeFireRate(chargeTime: number, fr: number, pct: number): number {
  return 1 / (chargeTime / (1 + pct / 100) + 1 / fr);
}

/** B6. `reload / (1 + pct)`; a negative bonus (Tainted Mag) divides by `1 - x`, which is the same formula. */
export function reloadTime(base: number | null, pct: number): number | null {
  return base === null ? null : base / (1 + pct / 100);
}

/** B6. `round-half-up(mag x (1 + pct))`: 45 x 1.3 = 58.5 → 59. */
export function magazineSize(base: number | null, pct: number): number | null {
  return base === null ? null : roundHalfUp(base * (1 + pct / 100));
}

/**
 * B6. `burst x shots / (EFR x reload + shots)` where shots = magazine / ammo
 * per shot. Identical to the "proportion of time shooting" form.
 */
export function sustainedDps(input: { burstDps: number; effectiveFireRate: number; magazine: number; reload: number; ammoPerShot?: number }): number {
  const shots = input.magazine / (input.ammoPerShot ?? 1);
  return input.burstDps * (shots / (input.effectiveFireRate * input.reload + shots));
}

/** B7. `1 + 0.05 x (rank + 1)`: rank 5 regular → 1.30, rank 10 primed → 1.55. Additive between faction sources, multiplicative with everything else, and applied a second time to the DoT. */
export function factionMultiplier(rank: number): number {
  return 1 + 0.05 * (rank + 1);
}

/** B8. `base x (1 + pct)`, confirmed only through the Weeping Wounds formula (approx). */
export function statusChance(base: number | null, pct: number): number | null {
  return moddedStat(base, pct);
}

/** B8. `multishot x (forced + chance per projectile)`; a chance above 1 is a guaranteed proc plus a chance of another. */
export function procsPerShot(projectiles: number, chancePerProjectile: number, forced = 0): number {
  return projectiles * (forced + chancePerProjectile);
}

/** B9. 2x at 20 hits, +1 per 20, capped at 12x (220 hits). Below 20 there is no multiplier. */
export function comboMultiplier(hits: number): number {
  if (hits < 20) return 1;
  return Math.min(12, Math.floor(hits / 20) + 1);
}

/** B9. Blood Rush and Weeping Wounds scale by `(combo - 1)`: +40 % at 2x, +440 % at 12x. */
export function comboScaledBonus(pctPerStep: number, combo: number): number {
  return pctPerStep * (combo - 1);
}

export type Delivery = 'hitscan' | 'projectile' | 'unknown';

/**
 * B10. Condition Overload and the Galvanized damage mods are TWO rules:
 * additive with the base-damage mods on hitscan weapons, multiplicative on
 * projectile, homing, bouncing, punch-through and wave weapons. A weapon whose
 * delivery is unknown gets both, and the caller shows both. Never applied on
 * the hit that inflicts the new status - the caller's concern.
 */
export function conditionOverload(input: {
  base: number;
  sumDamagePct: number;
  coPctPerStatus: number;
  statuses: number;
  delivery: Delivery;
}): { hitscan: number | null; projectile: number | null } {
  const co = (input.coPctPerStatus / 100) * Math.min(16, input.statuses);
  const hitscan = input.base * (1 + input.sumDamagePct / 100 + co);
  const projectile = input.base * (1 + input.sumDamagePct / 100) * (1 + co);
  if (input.delivery === 'hitscan') return { hitscan, projectile: null };
  if (input.delivery === 'projectile') return { hitscan: null, projectile };
  return { hitscan, projectile };
}

// ---------------------------------------------------------------------------

/** "Rounded mathematically": .5 goes up. `Math.round` already does that for positive numbers; named so the intent is visible. */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}
