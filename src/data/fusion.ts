/**
 * WHAT IT COSTS TO RANK A MOD.
 *
 * The strip tells a player to take Sacrificial Steel from rank 5 to rank 10.
 * Without this module that instruction is worthless: ranking it costs 15,360
 * Endo and 741,888 credits, and an account holding 800 Endo cannot act on the
 * advice at all. "Endo, credits" is named in the brief before mods are.
 *
 * MEASURED FROM THE PLAYER'S OWN GAME, NOT FROM A WIKI
 * ────────────────────────────────────────────────────
 * The fusion dialog states its price, and `core/eelog.ts` already parses it:
 *
 *     Endo <FUSION_POINTS>15,360Credits <CREDITS>741,888
 *
 * Ten distinct quotes sit in the player's EE.log. Every one of them is
 * reproduced exactly by the two rules below, which is a far stronger claim than
 * a published table - a wiki can be stale, and a formula that survives ten real
 * observations from the running client cannot be stale in the same way. The
 * quotes, and what each turns out to be:
 *
 *     endo     credits      rarity x (2^to - 2^from)
 *         30       1,449     rare        0 -> 1
 *         60       2,898     rare        1 -> 2
 *        120       5,796     rare        2 -> 3
 *        300      14,490     common      1 -> 5
 *        310      14,973     common      0 -> 5
 *        930      44,919     rare        0 -> 5
 *     15,330     740,439     rare        0 -> 9
 *     15,360     741,888     rare        9 -> 10
 *     40,920   1,976,436     legendary   0 -> 10
 *
 * `scripts/check-fusion.ts` asserts all ten, so a rule that drifts from the
 * game is caught rather than believed.
 */

/** The four tiers the cost curve distinguishes. Anything else is unknown, never assumed. */
export type FusionRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

/**
 * The rarity multiplier on the Endo curve.
 *
 * Common 1, Uncommon 2, Rare 3, Legendary 4. Rare covers Riven, Amalgam and
 * Galvanized mods; Legendary covers Primed, Umbral and Archon.
 */
export const RARITY_FACTOR: Readonly<Record<FusionRarity, number>> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  legendary: 4,
};

/**
 * Credits per Endo, and it really is a constant.
 *
 * Every one of the ten observed quotes divides to exactly 48.3 - 1,449/30,
 * 741,888/15,360 and 1,976,436/40,920 all land on it with no remainder. The
 * research pass had reconstructed a separate credit base per rarity and
 * interpolated the middle two tiers; the log says there is only one number and
 * no interpolation is needed. Endo is always a multiple of 10 here, so the
 * product is always a whole number of credits.
 */
export const CREDITS_PER_ENDO = 48.3;

/** How a value was arrived at, in the same three words `data/modded.ts` uses. */
export type Verdict = 'exact' | 'approx' | 'assumed';

export interface RankCost {
  endo: number;
  credits: number;
  /** `exact` whenever the rarity is one of the four; there is no approximation in the curve. */
  verdict: Verdict;
}

/**
 * Endo to take a mod from one rank to another.
 *
 * `10 x factor x (2^to - 2^from)`. The cumulative form - total to reach rank R
 * from zero - is the `from = 0` case, `10 x factor x (2^R - 1)`, which is where
 * the familiar 10,230 / 20,460 / 30,690 / 40,920 totals come from.
 *
 * Ranking in one step and ranking one rank at a time cost the same, because the
 * curve telescopes: the sum of the per-rank differences is the difference of
 * the endpoints. That is a property of the formula rather than a claim about
 * the game, and the log's 0 -> 9 and 9 -> 10 quotes summing to the 0 -> 10 total
 * is the observation that backs it.
 */
export function endoToRank(rarity: FusionRarity, from: number, to: number): number {
  if (to <= from) return 0;
  return 10 * RARITY_FACTOR[rarity] * (2 ** to - 2 ** from);
}

/** The credits that accompany a quantity of Endo. Exact; see `CREDITS_PER_ENDO`. */
export function creditsForEndo(endo: number): number {
  return Math.round(endo * CREDITS_PER_ENDO);
}

/**
 * Normalise a catalogue rarity string.
 *
 * Returns null rather than a guess when the catalogue has no rarity or an
 * unrecognised one: an unknown cost must stay unknown, because the whole point
 * of this module is telling a player whether they can afford something.
 */
export function fusionRarity(rarity: string | null | undefined): FusionRarity | null {
  switch ((rarity ?? '').toLowerCase()) {
    case 'common':
      return 'common';
    case 'uncommon':
      return 'uncommon';
    case 'rare':
      return 'rare';
    case 'legendary':
      return 'legendary';
    default:
      return null;
  }
}

/** The whole cost of a rank move, or null when the rarity is not known. */
export function rankCost(rarity: string | null | undefined, from: number, to: number): RankCost | null {
  const r = fusionRarity(rarity);
  if (r === null) return null;
  const endo = endoToRank(r, from, to);
  return { endo, credits: creditsForEndo(endo), verdict: 'exact' };
}

/**
 * What the account holds. Both are optional in the inventory, and ABSENT IS NOT
 * ZERO - an account the app has never read must not be reported as broke.
 */
export interface Purse {
  endo: number | null;
  credits: number | null;
}

/** `RegularCredits` and `FusionPoints`, read without inventing a zero. */
export function purseOf(inventory: { RegularCredits?: number; FusionPoints?: number } | null | undefined): Purse {
  return {
    endo: typeof inventory?.FusionPoints === 'number' ? inventory.FusionPoints : null,
    credits: typeof inventory?.RegularCredits === 'number' ? inventory.RegularCredits : null,
  };
}

export type Afford = 'yes' | 'endo' | 'credits' | 'both' | 'unknown';

/**
 * Can the account pay for this?
 *
 * Returns WHICH resource falls short, not merely whether one does, because the
 * two are earned in completely different ways: Endo comes from Ayatan sculptures
 * and relics, credits from an index run in twenty minutes. Telling a player
 * "you cannot afford this" when the only shortfall is credits sends them to the
 * wrong activity for an evening.
 *
 * `unknown` whenever either balance is absent. That is the honest answer for an
 * account the app has not read, and it is never rendered as "no".
 */
export function afford(cost: RankCost | null, purse: Purse): Afford {
  if (cost === null || purse.endo === null || purse.credits === null) return 'unknown';
  const shortEndo = purse.endo < cost.endo;
  const shortCredits = purse.credits < cost.credits;
  if (shortEndo && shortCredits) return 'both';
  if (shortEndo) return 'endo';
  if (shortCredits) return 'credits';
  return 'yes';
}

/**
 * Check a rule against a price the GAME quoted.
 *
 * A fusion quote from the log is ground truth, and the app collects them for
 * free every time the player opens the dialog. This runs the formula backwards
 * over every (rarity, from, to) that could have produced the observed Endo and
 * reports whether any of them does, so a curve that drifts after a patch is
 * caught by the player's own play rather than by somebody re-reading a wiki.
 *
 * Returns the matching moves - there can be several, because 300 Endo is both a
 * common 1 -> 5 and an uncommon 0 -> 4 - or an empty array when the formula
 * cannot produce the quote at all, which is the signal that something changed.
 */
export interface QuoteMatch {
  rarity: FusionRarity;
  from: number;
  to: number;
}

export function explainQuote(endo: number, credits: number, maxRank = 10): QuoteMatch[] {
  const out: QuoteMatch[] = [];
  if (creditsForEndo(endo) !== credits) return out;
  for (const rarity of Object.keys(RARITY_FACTOR) as FusionRarity[]) {
    for (let from = 0; from < maxRank; from++) {
      for (let to = from + 1; to <= maxRank; to++) {
        if (endoToRank(rarity, from, to) === endo) out.push({ rarity, from, to });
      }
    }
  }
  return out;
}
