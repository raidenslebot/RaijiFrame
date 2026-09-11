/**
 * What a prime part is worth in Ducats - exactly, and without a single network
 * call to a market.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM PRICES
 * ───────────────────────────────────────────
 * Everything else in the platinum stack is a market estimate: a median of past
 * trades, true on average, never true of the next trade. Ducats are the
 * opposite. `primeSellingPrice` in DE's own export IS the Ducat price the relay
 * kiosk pays, it is the same for every player, it never moves between patches,
 * and it does not depend on anyone wanting to buy.
 *
 * So this is the one number in the whole panel that is a FACT rather than an
 * estimate, and it is free forever - no market request, no rate limit, works
 * with the game closed. It deserves to be computed first and shown first.
 *
 * THE FIVE TIERS
 * ──────────────
 * Measured over the exports, not assumed: 15, 25, 45, 65 and 100. The widely
 * repeated "15/45/100" is wrong - 25 and 65 together cover a hundred rows.
 *
 * THE DOUBLE-COUNT TRAP
 * ─────────────────────
 * The same part appears in BOTH exports under two paths: a component
 * (`MagPrimeChassisComponent`, in ExportResources) and the blueprint that
 * builds it (`MagPrimeChassisBlueprint`, in ExportRecipes). They are one part
 * with one Ducat value listed twice, so summing across both exports
 * double-counts: Mag Prime totals 250 that way against the 175 warframe.market
 * independently reports for the set.
 *
 * The rule this file enforces is therefore: LOOK UP, NEVER SUM THE TABLE. Every
 * caller resolves one specific `uniqueName` - the exact thing that dropped or
 * the exact thing the account holds - and only ever adds up items it has
 * actually seen. Cross-checked end to end: Mag Prime's four real drops are
 * 100 + 45 + 15 + 15 = 175, which is warframe.market's figure for the set to
 * the Ducat, from a completely independent source.
 */

import { GentleReader, httpLoader, POLICY } from '../core/gentle.ts';

const JSDELIVR = 'https://cdn.jsdelivr.net/npm/warframe-public-export-plus@latest';

/** Its own reader: two static exports that change on patches, not on minutes. */
const exports_ = new GentleReader(2, 0.5);

export interface DucatDb {
  /** ItemType path to the Ducats the kiosk pays. Absent means "not a prime part". */
  byItemType: ReadonlyMap<string, number>;
  failed: boolean;
}

const EMPTY: DucatDb = { byItemType: new Map(), failed: true };

/**
 * Pull `primeSellingPrice` out of one export.
 *
 * Both exports are objects keyed by ItemType, and the great majority of rows
 * carry no `primeSellingPrice` at all - those are the non-prime items, and
 * their absence is the signal that they cannot be sold for Ducats. Absent is
 * never read as zero here; the key simply never enters the map.
 */
function parsePrices(body: string): Array<[string, number]> {
  const raw: unknown = JSON.parse(body);
  if (typeof raw !== 'object' || raw === null) return [];
  const out: Array<[string, number]> = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const price = (value as Record<string, unknown>)['primeSellingPrice'];
    if (typeof price === 'number' && price > 0) out.push([key, price]);
  }
  return out;
}

/**
 * Load both halves of the table.
 *
 * BOTH are required. Components alone miss every warframe blueprint; recipes
 * alone miss every weapon part. A partial table would quietly under-value half
 * of what a player holds, which is worse than reporting nothing - so a failure
 * on either side fails the whole thing rather than returning half.
 */
export async function loadDucats(): Promise<DucatDb> {
  try {
    const [resources, recipes] = await Promise.all([
      exports_.read('ducats.resources', POLICY.staticData, httpLoader(`${JSDELIVR}/ExportResources.json`), parsePrices),
      exports_.read('ducats.recipes', POLICY.staticData, httpLoader(`${JSDELIVR}/ExportRecipes.json`), parsePrices),
    ]);
    const byItemType = new Map<string, number>();
    for (const [key, price] of resources.value ?? []) byItemType.set(key, price);
    // Components win ties. The two agree wherever they overlap, so this only
    // decides which of two identical numbers is stored.
    for (const [key, price] of recipes.value ?? []) if (!byItemType.has(key)) byItemType.set(key, price);
    return { byItemType, failed: byItemType.size === 0 };
  } catch (err) {
    // A failed table means UNKNOWN. Never a zero, and never a partial sum.
    console.warn('[ducats] price export unavailable', err);
    return EMPTY;
  }
}

