/**
 * What your standing is actually worth, across every syndicate in the game.
 *
 * THE CONVERSION NOBODY COMPUTES
 * ──────────────────────────────
 * Syndicate standing is the largest renewable currency in Warframe and almost
 * every faction will sell you something for it. The question that follows -
 * "given a fixed daily cap, which offering returns the most platinum per point
 * of standing?" - has an exact answer, and no tool gives it.
 *
 * It is exact because BOTH halves are real:
 *
 *   the COST     `standingCost` in DE's own `ExportSyndicates.json`, under each
 *                syndicate's `favours` list. A published constant, identical for
 *                every player, unchanged between patches.
 *   the RETURN   the median of warframe.market's closed trades for that item.
 *
 * Neither is invented, and their ratio - platinum per thousand standing - puts
 * every offering in the game on one comparable axis. Measured over the live
 * exports: 1,915 offerings across 39 syndicates, of which 861 join to a
 * tradeable market item. The rest are cosmetics, blueprints and consumables
 * bound to your account, and those are excluded rather than priced at zero.
 *
 * WHY THE RANKING IS BY STANDING AND NOT BY PRICE
 * ───────────────────────────────────────────────
 * Standing is the scarce thing. It is capped daily, the cap is set by Mastery
 * Rank, and it cannot be bought. Platinum price alone would rank a 40p item
 * costing 100,000 standing above a 15p item costing 5,000, which is exactly
 * backwards for anyone deciding what to spend today's cap on.
 *
 * WHAT IS REFUSED
 * ───────────────
 * An offering whose item has no closed trades gets `null`, not zero - it may be
 * valuable and simply illiquid. An offering the player's rank cannot reach is
 * marked, never hidden, because knowing what is two ranks away is the reason to
 * keep grinding one syndicate over another.
 */

import { GentleReader, httpLoader, POLICY } from '../core/gentle.ts';
import { normaliseItemType } from './itemdb.ts';
import type { MarketCatalog, Price } from './market.ts';

const JSDELIVR = 'https://cdn.jsdelivr.net/npm/warframe-public-export-plus@latest';

/** Its own reader: one static export that changes on patches. */
const exports_ = new GentleReader(2, 0.5);

export interface Offering {
  /** The syndicate key, e.g. `ZarimanSyndicate`. */
  syndicate: string;
  /** DE's own path for the thing being sold, normalised off `StoreItems`. */
  itemType: string;
  standingCost: number;
  creditsCost: number;
  /** Syndicate rank required. 0 means anyone at neutral can buy it. */
  requiredLevel: number;
}

export interface OfferingDb {
  all: readonly Offering[];
  failed: boolean;
}

function parseOfferings(body: string): Offering[] {
  const raw: unknown = JSON.parse(body);
  if (typeof raw !== 'object' || raw === null) return [];
  const out: Offering[] = [];

  for (const [syndicate, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const favours = (value as Record<string, unknown>)['favours'];
    if (!Array.isArray(favours)) continue;

    for (const row of favours) {
      if (typeof row !== 'object' || row === null) continue;
      const f = row as Record<string, unknown>;
      const store = f['storeItem'];
      const cost = f['standingCost'];
      // A zero-cost favour is a rank-up reward, not something you buy. Skipping
      // it keeps a division by zero out of the ranking entirely.
      if (typeof store !== 'string' || typeof cost !== 'number' || cost <= 0) continue;
      out.push({
        syndicate,
        itemType: normaliseItemType(store),
        standingCost: cost,
        creditsCost: typeof f['creditsCost'] === 'number' ? f['creditsCost'] : 0,
        requiredLevel: typeof f['requiredLevel'] === 'number' ? f['requiredLevel'] : 0,
      });
    }
  }
  return out;
}

export async function loadOfferings(): Promise<OfferingDb> {
  try {
    const res = await exports_.read(
      'syndicates.favours',
      POLICY.staticData,
      httpLoader(`${JSDELIVR}/ExportSyndicates.json`),
      parseOfferings,
    );
    const all = res.value ?? [];
    return { all, failed: all.length === 0 };
  } catch (err) {
    console.warn('[standing] syndicate export unavailable', err);
    return { all: [], failed: true };
  }
}

/* ------------------------------------------------------------- valuation */

export interface ValuedOffering extends Offering {
  name: string;
  slug: string;
  /** Null until priced, and null forever if nothing has traded in 90 days. */
  price: Price | null;
  /**
   * Platinum per THOUSAND standing. Null while unpriced.
   *
   * Per thousand rather than per point because a point is worth a hundredth of
   * a platinum and a table of 0.003s tells a reader nothing.
   */
  platPerK: number | null;
  /** True when the player's rank in that syndicate is high enough. */
  reachable: boolean | null;
}

/**
 * Join every offering to the market catalogue.
 *
 * Only offerings that resolve to a tradeable item survive. That filter is the
 * honest one: the 1,000-odd that drop out are cosmetics and blueprints bound to
 * the account, and including them at zero platinum would imply they were
 * considered and found worthless rather than being a different kind of thing.
 */
export function tradeableOfferings(
  offerings: readonly Offering[],
  catalog: MarketCatalog,
  ranks: ReadonlyMap<string, number> | null,
): ValuedOffering[] {
  if (catalog.failed) return [];
  const out: ValuedOffering[] = [];

  for (const o of offerings) {
    const item = catalog.byGameRef.get(o.itemType);
    if (!item) continue;
    const rank = ranks?.get(o.syndicate);
    out.push({
      ...o,
      name: item.name,
      slug: item.slug,
      price: null,
      platPerK: null,
      reachable: rank === undefined ? null : rank >= o.requiredLevel,
    });
  }
  return out;
}

/** Fold fetched prices in and compute the ratio. */
export function priceOfferings(
  offerings: readonly ValuedOffering[],
  prices: ReadonlyMap<string, Price>,
): ValuedOffering[] {
  return offerings.map((o) => {
    const price = prices.get(o.slug) ?? null;
    return {
      ...o,
      price,
      // Per thousand standing, rounded to something a human can compare.
      platPerK: price === null ? null : Math.round((price.median / o.standingCost) * 1000 * 100) / 100,
    };
  });
}

/**
 * The best use of standing, by the measure that matters.
 *
 * Unpriced offerings sort last rather than being dropped: "we have not quoted
 * this yet" and "this is a poor use of standing" are different statements and
 * the panel renders them differently.
 */
export function bestUseOfStanding(offerings: readonly ValuedOffering[]): ValuedOffering[] {
  return [...offerings].sort((a, b) => (b.platPerK ?? -1) - (a.platPerK ?? -1) || a.name.localeCompare(b.name));
}

/** Human labels for the syndicate keys DE ships. */
export const SYNDICATE_LABEL: Record<string, string> = {
  ArbitersSyndicate: 'Arbiters of Hexis',
  CephalonSudaSyndicate: 'Cephalon Suda',
  ConclaveSyndicate: 'Conclave',
  EntratiSyndicate: 'Entrati',
  EntratiLabSyndicate: 'Cavia',
  NecraloidSyndicate: 'Necraloid',
  NewLokaSyndicate: 'New Loka',
  PerrinSyndicate: 'Perrin Sequence',
  RedVeilSyndicate: 'Red Veil',
  SteelMeridianSyndicate: 'Steel Meridian',
  ZarimanSyndicate: 'The Holdfasts',
  HexSyndicate: 'The Hex',
  VentKidsSyndicate: 'Vent Kids',
  LibrarySyndicate: 'Cephalon Simaris',
  CetusSyndicate: 'Ostron',
  SolarisSyndicate: 'Solaris United',
  QuillsSyndicate: 'The Quills',
  VoxSyndicate: 'Vox Solaris',
  RadioLegionSyndicate: 'Nightwave',
};

export function syndicateLabel(key: string): string {
  return SYNDICATE_LABEL[key] ?? key.replace(/Syndicate$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
}
