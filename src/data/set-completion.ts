/**
 * Sets you are one or two parts away from, and whether closing the gap pays.
 *
 * WHY NOT A GLOBAL ARBITRAGE RANKING
 * ──────────────────────────────────
 * The obvious version of this feature ranks all 238 sets on the market by
 * "sell price minus the sum of its parts". It cannot be built. Pricing one set
 * costs one request per part plus one for the set - about five - and at the
 * courtesy rate this app holds itself to that is 209 sets x 5 x 2 seconds, or
 * thirty-five minutes, by which time the first quote is long stale. A ranking
 * assembled that way would not describe any single moment.
 *
 * So the question is turned round. Instead of "which of every set is the best
 * arbitrage", it asks "of the sets YOU are already most of the way to, which is
 * worth finishing" - which needs a handful of requests, uses the inventory the
 * app already holds, and is the decision a player actually faces when they look
 * at a pile of parts.
 *
 * WHAT THE NUMBERS SAY, MEASURED
 * ──────────────────────────────
 * Sampled from live closed trades while this was written:
 *
 *   Hydroid Prime   set 93p   parts 77p   +16p over 5 trades   3.2p / trade
 *   Nikana Prime    set 67p   parts 58.5p  +8.5p over 4 trades  2.1p / trade
 *   Frost Prime     set 78p   parts 72p    +6p over 5 trades    1.2p / trade
 *
 * Those figures are for buying EVERY part and reselling - one to three platinum
 * a trade, barely worth the cap. That is not what this file computes.
 *
 * Completing a set you already hold most of is a different trade entirely,
 * because the expensive parts are already yours and the only cost is the gap.
 * Measured live on a three-of-four Hydroid Prime: 38p in, 93p out, over two
 * trades - 27.5p a trade, ten times the full-assembly figure.
 *
 * The one thing the margin does NOT carry: the parts already held could have
 * been sold separately, so the true gain is this margin minus what they would
 * have fetched alone. Completing usually still wins, because a set sells above
 * the sum of its parts and costs fewer trades to move - but it is a comparison,
 * not free money, and the panel says so.
 */

import type { MarketCatalog, Price } from './market.ts';
import { priceMany } from './market.ts';

export interface SetGap {
  /** The set's market slug, e.g. `hydroid_prime_set`. */
  setSlug: string;
  name: string;
  /** Every part slug the catalogue could identify for this set. */
  parts: readonly string[];
  /** Parts the account already holds. */
  held: readonly string[];
  /** Parts still to buy. */
  missing: readonly string[];
}

/**
 * Which sets the account is closest to completing.
 *
 * A set's parts are identified by slug stem, which is how warframe.market names
 * them: every `hydroid_prime_*` that is not `_set` is a part of `hydroid_prime`.
 * Measured over the live catalogue, 209 of 238 sets resolve at least three parts
 * this way; the rest are single-item "sets" or oddly named and are skipped
 * rather than guessed at.
 */
export function setGaps(
  ownedSlugs: ReadonlySet<string>,
  catalog: MarketCatalog,
  maxMissing = 2,
): SetGap[] {
  if (catalog.failed) return [];

  const stems = new Map<string, string[]>();
  for (const item of catalog.all) {
    if (item.slug.endsWith('_set')) stems.set(item.slug.slice(0, -'_set'.length), []);
  }
  for (const item of catalog.all) {
    if (item.slug.endsWith('_set')) continue;
    for (const stem of stems.keys()) {
      if (item.slug.startsWith(`${stem}_`)) {
        stems.get(stem)?.push(item.slug);
        break;
      }
    }
  }

  const out: SetGap[] = [];
  for (const [stem, parts] of stems) {
    // Fewer than three identified parts means the join failed, not that the set
    // is small. Reporting a two-part "set" would invent a cheap completion.
    if (parts.length < 3) continue;
    const held = parts.filter((p) => ownedSlugs.has(p));
    const missing = parts.filter((p) => !ownedSlugs.has(p));
    // Nothing held is not a "gap", it is the whole set; and nothing missing is
    // already done.
    if (held.length === 0 || missing.length === 0) continue;
    if (missing.length > maxMissing) continue;
    out.push({
      setSlug: `${stem}_set`,
      name: catalog.bySlug.get(`${stem}_set`)?.name ?? stem,
      parts,
      held,
      missing,
    });
  }

  // Closest first: fewest parts to buy, then most already invested.
  return out.sort((a, b) => a.missing.length - b.missing.length || b.held.length - a.held.length);
}

export interface SetVerdict extends SetGap {
  /** What the assembled set sells for. Null when nothing has traded. */
  setPrice: Price | null;
  /** Median cost of each part still to buy. Null entries are unpriced. */
  costs: ReadonlyMap<string, Price | null>;
  /** Platinum to buy every missing part. Null when any of them is unpriced. */
  toBuy: number | null;
  /** Set price minus what the gap costs. Null when either side is unknown. */
  margin: number | null;
  /**
   * Trades the whole operation costs: one to buy each missing part, one to sell
   * the set. This is the number that actually binds - a daily cap of your
   * Mastery Rank is spent whether the margin is one platinum or fifty.
   */
  trades: number;
  /** Margin per trade spent. The only figure worth comparing across sets. */
  perTrade: number | null;
}

/**
 * HOW MANY OF THESE YOU CAN ACTUALLY FINISH TODAY.
 * ————————————————————————————————————————————
 * Each verdict is priced against the whole account, so a list of five sets can
 * show five green margins while your platinum covers two of them and your
 * trades cover one. Every row is correct and the list as a whole is not: the
 * sets compete, and nothing said so.
 *
 * This is the same gap the foundry's build queue closes for resources, applied
 * to the two budgets a completion actually spends - platinum to buy the missing
 * parts with, and trades, which are capped daily by Mastery Rank and are
 * usually the binding constraint.
 *
 * ORDERED BY `perTrade`, which this file already calls the only figure worth
 * comparing across sets, so nothing is invented to rank them. Greedy, and
 * therefore possibly a smaller set than the true optimum - the exact answer is
 * a knapsack and nobody asked for a solver. It is never WRONG about what it
 * reports: each set in `take` is checked against the budget left after the ones
 * before it.
 *
 * UNKNOWN BUDGETS CLAIM NOTHING. With platinum or trades unread the honest
 * answer is that the question cannot be settled, not that the answer is zero.
 */
export interface SetPlan {
  /** Sets you could finish, in the order the budgets were spent. */
  take: readonly string[];
  /** Sets the budgets cannot reach, and which budget ran out first. */
  blocked: ReadonlyArray<{ setSlug: string; ranOut: 'platinum' | 'trades' }>;
  /** Null when a budget is unread - the plan cannot be made, and says so. */
  settled: boolean;
}

export function planSets(
  verdicts: readonly SetVerdict[],
  platinum: number | null,
  tradesLeft: number | null,
): SetPlan {
  if (platinum === null || tradesLeft === null) return { take: [], blocked: [], settled: false };

  const usable = verdicts
    .filter((v) => v.toBuy !== null && v.perTrade !== null && v.margin !== null && v.margin > 0)
    .sort((a, b) => (b.perTrade ?? 0) - (a.perTrade ?? 0));

  let plat = platinum;
  let trades = tradesLeft;
  const take: string[] = [];
  const blocked: Array<{ setSlug: string; ranOut: 'platinum' | 'trades' }> = [];

  for (const v of usable) {
    const cost = v.toBuy ?? 0;
    if (cost > plat) {
      blocked.push({ setSlug: v.setSlug, ranOut: 'platinum' });
      continue;
    }
    if (v.trades > trades) {
      blocked.push({ setSlug: v.setSlug, ranOut: 'trades' });
      continue;
    }
    plat -= cost;
    trades -= v.trades;
    take.push(v.setSlug);
  }

  return { take, blocked, settled: true };
}

/**
 * Price one gap. Bounded: a set has at most a handful of missing parts.
 *
 * Deliberately refuses rather than estimating. If any missing part has no
 * closed trades, `toBuy` is null and so is the margin - a sum with a hole in it
 * is not a smaller sum, it is not a sum at all.
 */
export async function priceGap(gap: SetGap): Promise<SetVerdict> {
  const wanted = [gap.setSlug, ...gap.missing];
  const prices = await priceMany(wanted, wanted.length);

  const setPrice = prices.get(gap.setSlug) ?? null;
  const costs = new Map<string, Price | null>();
  let toBuy: number | null = 0;
  for (const slug of gap.missing) {
    const p = prices.get(slug) ?? null;
    costs.set(slug, p);
    if (p === null) toBuy = null;
    else if (toBuy !== null) toBuy += p.median;
  }

  const trades = gap.missing.length + 1;
  const margin = setPrice === null || toBuy === null ? null : Math.round((setPrice.median - toBuy) * 10) / 10;
  return {
    ...gap,
    setPrice,
    costs,
    toBuy,
    margin,
    trades,
    perTrade: margin === null ? null : Math.round((margin / trades) * 10) / 10,
  };
}
