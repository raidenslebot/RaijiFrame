/**
 * WHAT "THE BEST BUILD" MEANS FOR A WARFRAME.
 *
 * WHY THIS EXISTS, AND WHY IT EXISTS NOW
 * --------------------------------------
 * Replaying the player's own EE.log through the state machine
 * (`scripts/measure-live-log.ts`) found that FOUR of their ten modding-screen
 * visits were the Warframe slot. Both existing objectives score weapon damage
 * per second, so on 40 % of the modding this account actually does, the overlay
 * identified the frame and then had nothing whatever to say. That was the
 * largest gap in the product measured by use, and nothing in the project had a
 * way to notice it until the log was read.
 *
 * A frame has no damage number to maximise. What it has is survival, and there
 * is one honest scalar for that.
 *
 * EFFECTIVE HEALTH, AND WHY IT IS THE RIGHT SCALAR
 * ------------------------------------------------
 * Armour does not add health; it multiplies it. The Tenno reduction curve is
 * `armour / (armour + 300)`, so a hit that would take `d` takes
 * `d x 300 / (armour + 300)` instead - which is exactly the same as having
 * `1 + armour/300` times as much health. Shields sit outside that: armour does
 * not protect them.
 *
 *     EHP = health x (1 + armour / 300) + shields
 *
 * That is why Steel Fiber on a high-health frame is worth more than Vitality on
 * a high-armour one, and why the answer is not "stack whichever mod is biggest".
 * The multiplication is the whole point, and a ranking of individual mods cannot
 * see it.
 *
 * THE TENNO CURVE, NOT THE ENEMY ONE. `data/armour.ts` carries the enemy
 * formula and says loudly that the two are different: 300 armour is 50 % for a
 * Warframe and 30 % for an enemy. Using the wrong one here would be a quiet
 * 20-point error on every frame in the game.
 *
 * WHAT THIS DELIBERATELY DOES NOT SCORE
 * -------------------------------------
 * Ability Strength, Duration, Range and Efficiency. They are the other half of
 * a real Warframe build and they are not comparable to survival on one axis -
 * more Range is not worth "n points of health", and any exchange rate between
 * them would be this app inventing a preference the player never stated. They
 * are counted as unscored, the way every honest gap in this optimiser is, and
 * the overlay prints the count.
 */

/** The player's own armour curve. NOT the enemy's - see `armour.ts`. */
export const TENNO_ARMOUR_CONSTANT = 300;

/**
 * How much armour multiplies health.
 *
 * `1 + armour/300`, which is the algebraic twin of the reduction formula: a
 * frame with 300 armour takes half damage, which is the same as having twice
 * the health. Negative armour cannot reduce a frame below its bare health.
 */
export function armourMultiplier(armour: number): number {
  return 1 + Math.max(0, armour) / TENNO_ARMOUR_CONSTANT;
}

export interface Survivability {
  /** Health after armour, plus shields. The objective's value. */
  effectiveHealth: number;
  /** The parts, so the overlay can say WHY one build beats another. */
  health: number;
  shield: number;
  armour: number;
  /** What the armour is worth, as a multiple. 1 means the frame has none. */
  fromArmour: number;
}

/**
 * A frame's effective health, given its base numbers and the percentage each
 * mod bucket adds.
 *
 * Every bucket is additive within itself and multiplicative with the base, the
 * way every other percentage in this game works: two +100 % health mods give
 * x3, not x4.
 */
export function survivability(input: {
  health: number;
  shield: number;
  armour: number;
  healthPct?: number;
  shieldPct?: number;
  armourPct?: number;
}): Survivability {
  const health = Math.max(0, input.health) * (1 + (input.healthPct ?? 0) / 100);
  const shield = Math.max(0, input.shield) * (1 + (input.shieldPct ?? 0) / 100);
  const armour = Math.max(0, input.armour) * (1 + (input.armourPct ?? 0) / 100);
  const fromArmour = armourMultiplier(armour);
  return {
    effectiveHealth: health * fromArmour + shield,
    health,
    shield,
    armour,
    fromArmour,
  };
}
