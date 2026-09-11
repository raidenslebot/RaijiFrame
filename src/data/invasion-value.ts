/**
 * Which invasions are worth running, right now.
 *
 * A CORRECTION TO THIS PROJECT'S OWN NOTES
 * ────────────────────────────────────────
 * The throughput engine listed `invasion-rewards` as unmodellable, with the
 * reason "Invasion rewards rotate and no feed publishes the per-run yield".
 * That is wrong, and it was wrong when it was written: the worldstate feed
 * publishes the exact reward of every live invasion, and `worldstate.ts` in this
 * very repo has been parsing `attacker.reward.countedItems` the whole time. The
 * claim was made from a guess at the endpoint's shape rather than from the
 * parser sitting one file away.
 *
 * WHY A RATE STILL IS NOT THE ANSWER HERE
 * ───────────────────────────────────────
 * What cannot be modelled is a STANDING rate, and for a better reason than the
 * old note gave. Invasions rotate every few hours and most of them pay Forma,
 * which no player can sell. A platinum-per-hour for "invasions" in general
 * would be an average across a rotation the player will never actually meet.
 *
 * What IS answerable, and is the question anybody actually has: of the ones
 * running at this moment, which pay something a player will buy? That changes
 * through the day, so it is read live and never cached into a rate.
 *
 * THREE MISSIONS, ONE REWARD
 * ──────────────────────────
 * The feed's `requiredRuns` is faction-wide progress, not your share of it. The
 * per-player cost is three missions on one side, which is the figure used here
 * and stated on screen rather than folded silently into a total.
 */

import type { Invasion } from './worldstate.ts';
import type { MarketCatalog, Price } from './market.ts';
import { priceMany } from './market.ts';

/** Missions one player runs to claim one side's reward. */
export const RUNS_PER_REWARD = 3;

export interface InvasionOffer {
  node: string;
  /** Which side pays it, in the game's own words. */
  faction: string;
  /** The reward, as the feed names it. */
  item: string;
  count: number;
  slug: string;
  price: Price | null;
  /** Platinum for the whole reward, when priced. */
  worth: number | null;
}

/**
 * Every live invasion reward that a player could actually sell.
 *
 * Untradeable rewards - Forma above all, which is most of them - are dropped
 * rather than listed at zero. An invasion paying Forma is not a bad deal, it is
 * a different kind of thing, and putting it in a platinum list at 0p would
 * imply it had been weighed and found wanting.
 */
export function tradeableOffers(
  invasions: readonly Invasion[] | undefined,
  catalog: MarketCatalog | null,
): InvasionOffer[] {
  if (!invasions || !catalog || catalog.failed) return [];

  const byName = new Map<string, string>();
  for (const item of catalog.all) byName.set(item.name.toLowerCase(), item.slug);

  const out: InvasionOffer[] = [];
  for (const inv of invasions) {
    if (inv.completed === true) continue;
    for (const side of [inv.attacker, inv.defender]) {
      for (const reward of side?.reward?.countedItems ?? []) {
        const name = reward.type;
        if (typeof name !== 'string') continue;
        const slug = byName.get(name.toLowerCase());
        if (slug === undefined) continue;
        out.push({
          node: inv.node,
          faction: side?.faction ?? 'unknown',
          item: name,
          count: reward.count ?? 1,
          slug,
          price: null,
          worth: null,
        });
      }
    }
  }
  return out;
}

/** Price a bounded set of them. Six live invasions is a handful of requests. */
export async function priceOffers(offers: readonly InvasionOffer[], cap = 8): Promise<InvasionOffer[]> {
  const slugs = [...new Set(offers.map((o) => o.slug))].slice(0, cap);
  const prices = await priceMany(slugs, cap);
  return offers
    .map((o) => {
      const price = prices.get(o.slug) ?? null;
      return { ...o, price, worth: price ? price.median * o.count : null };
    })
    .sort((a, b) => (b.worth ?? -1) - (a.worth ?? -1));
}
