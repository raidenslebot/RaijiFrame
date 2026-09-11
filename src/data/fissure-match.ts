/**
 * A live fissure, checked against the relics that would actually open it.
 *
 * WHAT THE WORLDSTATE PANEL WAS MISSING
 * ────────────────────────────────────
 * A fissure is not a thing to do on its own. It is a door, and a relic is the
 * key: a Neo fissure is worth crossing the map for if you are holding eleven Neo
 * relics and is worth nothing at all if you are holding none. The panel listed
 * twelve doors and said nothing about keys, so every row looked equally
 * actionable and the one question a player brings to the list - "which of these
 * can I actually use" - was left for them to answer from memory.
 *
 * The join is exact rather than a name comparison. DE's `MiscItems` rows carry
 * the relic's own path in `ItemType`, and WFCD publishes that same string as the
 * relic's `uniqueName`, which `loadRelics` already reads into `Relic.itemType`.
 * So this maps the relic table's paths to their tiers once, then walks the
 * account's own inventory rows through that map. Nothing is guessed from a
 * printed name, and no second reader of the relic table exists: the caller hands
 * in whatever `loadRelics` gave it.
 *
 * WHY THE TABLE IS WALKED INTO A MAP AND NOT FILTERED
 * ──────────────────────────────────────────────────
 * The relic table lists every relic once per refinement - "Lith G1 Intact",
 * "Lith G1 Radiant" and the two between - and each of those four is its own item
 * with its own path: verified against the cached table, 196 Lith relics occupy
 * 788 distinct `uniqueName`s ending Bronze, Silver, Gold and Platinum, and not
 * one path is shared between two refinements.
 *
 * That is why the sum runs over the ACCOUNT's rows through a map, rather than
 * over the table filtered by the account. A fissure does not care how refined
 * the relic is, so the count a player wants is the total across all four - and
 * they arrive as four separate `MiscItems` rows, each of which the map resolves
 * to the same tier and adds once. Going the other way would mean scanning three
 * thousand table rows to find the twenty that matter, and would break the moment
 * DE shipped a relic the table happened to list twice.
 *
 * ABSENT IS NOT ZERO, AND THIS FILE EXISTS MOSTLY TO SAY SO
 * ────────────────────────────────────────────────────────
 * There are three separate ways for the count to be unknowable and none of them
 * is "you hold none": the relic table has not arrived, the account has never
 * been read, or the read arrived without the inventory bucket in it. All three
 * produce a null stock and a sentence saying what would settle it, in the same
 * `Need` vocabulary the platinum panel already uses for exactly this problem. A
 * zero on this screen is a measurement - the account was read, the bucket was
 * there, and no relic of that tier was in it - and it must never be reachable by
 * any other route.
 */

import type { Relic } from './plat-value.ts';
import type { Need } from './plat-picks.ts';

/**
 * Relics held, by tier, or the reason there is no number.
 *
 * `byTier` is null or complete. A partial map would be worse than none, because
 * a missing key in a present map reads as a measured zero.
 */
export interface RelicStock {
  /** Tier -> relics held, summed over every refinement. NULL MEANS UNREAD. */
  byTier: ReadonlyMap<string, number> | null;
  /** Set when `byTier` is null: what would settle it, in the player's words. */
  unknown: string | null;
}

/**
 * Count the relics this account holds, grouped by the tier a fissure asks for.
 *
 * `relics` is null while the table is still loading and empty when it failed;
 * both are unknown rather than zero, and they say different things because a
 * player can wait out the first and cannot wait out the second.
 */
export function relicStock(
  inventory: Readonly<Record<string, unknown>> | null,
  relics: readonly Relic[] | null,
): RelicStock {
  if (relics === null) {
    return { byTier: null, unknown: 'the relic table is still loading, so relics cannot be matched to a tier yet' };
  }
  if (relics.length === 0) {
    return { byTier: null, unknown: 'the relic table did not load, so relics cannot be matched to a tier' };
  }
  if (inventory === null) {
    return { byTier: null, unknown: 'your account has not been read, so the relics you hold are unknown' };
  }

  const misc = inventory['MiscItems'];
  if (!Array.isArray(misc)) {
    return { byTier: null, unknown: 'this account read did not carry your items, so the relics you hold are unknown' };
  }

  const tierOf = new Map<string, string>();
  for (const relic of relics) tierOf.set(relic.itemType, relic.tier);

  /*
   * Every tier the table knows about starts at a measured zero.
   *
   * Without this, a tier the player holds nothing of would be absent from the
   * map, and the reader could not tell "no Requiem relics" from "Requiem is not
   * a thing this table describes". Both are legitimate states and only one of
   * them is a fact about the account.
   */
  const byTier = new Map<string, number>();
  for (const tier of tierOf.values()) byTier.set(tier, 0);

  for (const row of misc) {
    if (row === null || typeof row !== 'object') continue;
    const held = row as Record<string, unknown>;
    const type = held['ItemType'];
    if (typeof type !== 'string') continue;
    const tier = tierOf.get(type);
    if (tier === undefined) continue;
    /*
     * A missing `ItemCount` is one, not none: the row only exists because the
     * account holds the item. This is the same reading the platinum panel's
     * inventory sum already applies to `MiscItems`.
     */
    const count = typeof held['ItemCount'] === 'number' && Number.isFinite(held['ItemCount']) ? held['ItemCount'] : 1;
    byTier.set(tier, (byTier.get(tier) ?? 0) + Math.max(0, Math.trunc(count)));
  }

  return { byTier, unknown: null };
}

/**
 * How many relics of one tier are held, as the app's own requirement shape.
 *
 * A fissure needs one relic to be worth entering, so `need` is 1 and `met` is
 * the answer to "can I use this door". `met` is null - not false - whenever the
 * stock is unknown, which is what keeps an unread account out of the "you cannot
 * do this" bucket it does not belong in.
 */
export function tierNeed(stock: RelicStock, tier: string): Need {
  const have = stock.byTier?.get(tier) ?? null;

  /*
   * A TIER THE RELIC TABLE HAS NEVER HEARD OF STILL OWES AN EXPLANATION.
   *
   * The live feed runs Omnia fissures, and "Omnia" is not a relic tier - no row
   * in the drop table carries it, so the stock map has no key for it even when
   * the account has been read perfectly. Left alone that produced the one shape
   * this file exists to prevent: a null with no sentence attached, printing the
   * word "unknown" while implying the account is the thing that is missing.
   *
   * It is not. The count is unknowable because the question does not apply, and
   * saying which of those two it is costs one line. What this deliberately does
   * NOT do is assert what an Omnia fissure accepts - that would be game
   * knowledge invented here rather than read from anything.
   */
  const why =
    stock.unknown ?? (stock.byTier === null ? null : `the relic table names no ${tier} relic, so there is no count to take`);

  return {
    what: `${tier} relics`,
    need: 1,
    have,
    unit: 'relics',
    met: have === null ? null : have >= 1,
    ...(have === null && why !== null ? { unknown: why } : {}),
  };
}

/**
 * The count as words, for a place too small to spell out a requirement.
 *
 * The three states get three different strings on purpose. "Unknown" is not a
 * quantity and must not be able to be mistaken for one, and "none held" is a
 * measurement that has to read as louder than a blank.
 */
export function stockLabel(have: number | null): string {
  if (have === null) return 'held: unknown';
  if (have === 0) return 'none held';
  return `${have.toLocaleString()} held`;
}
