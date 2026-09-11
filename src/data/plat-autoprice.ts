/**
 * The panel prices itself.
 *
 * WHAT THIS REPLACES, AND WHY IT HAD TO GO
 * ────────────────────────────────────────
 * Opening the platinum panel used to tell you almost nothing. Six separate
 * buttons - "Price every route", "Price the top 24", "Build today's plan",
 * "Find the cheapest ducats", "Price the top 24 shown", "Does it pay?" - each
 * had to be found and pressed, each took the better part of a minute, and until
 * you had pressed all of them the panel was a set of empty instruments.
 *
 * That is a tool you OPERATE. It should be a tool that ANSWERS.
 *
 * THE OBJECTION THOSE BUTTONS EXISTED FOR, AND WHY IT DOES NOT HOLD
 * ────────────────────────────────────────────────────────────────
 * They were gates against hammering a service run by volunteers. The gate was
 * in the wrong place, because the app already has two real ones:
 *
 *   the BUCKET   `GentleReader(4, 1)` - four in hand, one a second, shared by
 *                every market call the app makes
 *   the TTL      `POLICY.market` is 300 000 ms, and a cached quote is returned
 *                without a request at all
 *
 * So an automatic pass costs at most one round of requests every five minutes
 * per player, whatever they click. The button was not protecting the service;
 * it was protecting nothing and costing the panel its entire purpose.
 *
 * ORDER IS THE DESIGN
 * ───────────────────
 * The pass is sequenced by what the reader sees first, not by what is cheapest
 * to fetch. The plan at the top of the page needs the player's own holdings, so
 * those go first and the headline answer assembles within a few seconds. Route
 * representatives follow, filling the rates into the list below the fold by the
 * time anyone scrolls to it. Nothing waits on anything it does not need.
 *
 * The panel recommends one way to make platinum per KIND of way there is, and
 * two of those kinds - what standing buys, and what the relics already in your
 * inventory are worth - carried no prices at all. They come third and fourth
 * because they sit deepest down the page, and because unlike the first two they
 * are bounded by what this particular player has: an account with no syndicate
 * ranks and no relics never pays for them.
 *
 * EVERY STAGE PUBLISHES AS IT LANDS
 * ─────────────────────────────────
 * Results are handed back stage by stage rather than at the end, so the page
 * fills in progressively instead of sitting blank and then flashing complete.
 * A pass that fails half way leaves the half that succeeded on screen.
 *
 * Each stage publishes ONLY the prices it fetched. Nothing here accumulates a
 * running book, because the panel already holds one and merging in two places
 * is how the two copies drift apart: the stage that fetched a slug is the only
 * thing that knows it is fresh, and the panel is the only thing that knows what
 * is already on screen.
 */

import type { Holding, Relic } from './plat-value.ts';
import { holdingsOf, priceHoldings, slugsForRelic } from './plat-value.ts';
import type { Offering } from './standing-value.ts';
import { tradeableOfferings } from './standing-value.ts';
import type { DucatDb } from './ducats.ts';
import type { MarketCatalog, Price } from './market.ts';
import { priceMany } from './market.ts';
import { representativeSlugs } from './plat-throughput.ts';

/**
 * How far into the player's own stock to price.
 *
 * A shortlist rather than a sample: the stock is already ranked by exact Ducat
 * worth before a single request goes out, so these are the twenty-four items
 * most likely to be worth listing. Everything past it keeps a null price, which
 * the panel prints as "outside the fetch budget" and never as a zero.
 */
const STOCK_CAP = 24;

/**
 * The route stage has no ceiling of its own. It prices ONE representative per
 * route, and the route table is a fixed list written into this app rather than
 * anything a player can grow, so the list is already its own bound. It is named
 * here so the four budgets read side by side, and so it follows on its own if a
 * route is ever added.
 */
const ROUTE_CAP = representativeSlugs().length;

/**
 * How many things standing can buy to price.
 *
 * Around 861 syndicate offerings join to a tradeable item. Pricing all of them
 * would be most of an hour of requests for a table nobody scrolls to the end
 * of, and the panel needs exactly one recommendation with a real number under
 * it. Twenty-four is a SLICE of what the player can reach, not the top of it -
 * the ranking is what these prices are for - so an offering left unpriced means
 * "not quoted yet", never "not worth your standing".
 */
const STANDING_CAP = 24;

/**
 * How many reward slugs to price across the relics the player already holds.
 *
 * Thirty rather than twenty-four because a relic is not one item: six rewards
 * each, and rewards repeat heavily between relics of a tier, so thirty slugs
 * usually value a dozen relics outright. A player sitting on hundreds sees the
 * ones the budget reached carrying a platinum figure and the rest carrying
 * their Ducat floor, which is exact, free and already in memory.
 */
const RELIC_CAP = 30;

/**
 * The offerings worth spending requests on.
 *
 * An offering the player's rank cannot reach yet is dropped, because a price on
 * it answers a question they cannot act on today. An offering whose rank is
 * UNKNOWN is kept: the account may not have been read, and treating silence as
 * a refusal would empty this stage for everyone whose syndicate standing has
 * not loaded.
 */
function reachableSlugs(
  offerings: readonly Offering[],
  catalog: MarketCatalog,
  ranks: ReadonlyMap<string, number> | null,
): string[] {
  if (offerings.length === 0) return [];
  const slugs = new Set<string>();
  for (const offering of tradeableOfferings(offerings, catalog, ranks)) {
    if (offering.reachable === false) continue;
    slugs.add(offering.slug);
  }
  return [...slugs].slice(0, STANDING_CAP);
}

/**
 * The reward slugs behind the relics this account actually has.
 *
 * Relics live in `MiscItems` under DE's own path, which is the same string
 * WFCD publishes as the relic's `uniqueName`, so the join is an exact match
 * rather than a name comparison. The same relic appears once per refinement
 * state in the table and every state names the same rewards, so the set
 * collapses those four rows into one round of requests.
 *
 * Pricing rewards the player cannot open is the thing this avoids: the full
 * relic table is thousands of slugs, and all but a handful belong to relics
 * sitting in somebody else's inventory.
 */
function ownedRelicSlugs(account: Record<string, unknown> | null, relics: readonly Relic[]): string[] {
  if (!account || relics.length === 0) return [];
  const misc = account['MiscItems'];
  if (!Array.isArray(misc)) return [];

  const owned = new Set<string>();
  for (const row of misc) {
    if (row === null || typeof row !== 'object') continue;
    const type = (row as Record<string, unknown>)['ItemType'];
    if (typeof type === 'string') owned.add(type);
  }
  if (owned.size === 0) return [];

  const slugs = new Set<string>();
  for (const relic of relics) {
    if (!owned.has(relic.itemType)) continue;
    for (const slug of slugsForRelic(relic)) slugs.add(slug);
  }
  return [...slugs].slice(0, RELIC_CAP);
}

export interface AutoProgress {
  /** What is being priced, in the player's words. Null when finished. */
  stage: string | null;
  /** Requests issued so far in this pass. */
  done: number;
  /** Requests this pass will issue in total. */
  total: number;
  /**
   * Stages that threw. Zero on a healthy pass.
   *
   * WHY THIS IS NOT A DETAIL. Every stage below catches its own failure and
   * carries on, which is right - a market outage should leave the panel showing
   * what it already knew rather than blanking. But the failure then reached
   * nobody, so the panel could not tell "the quotes are still coming" from "the
   * quotes are never coming", and said the first in both cases: with the market
   * unreachable the screen read "The quotes are arriving now; this fills itself
   * in", which is a promise about the future that the failure has already
   * broken. Counting them is what lets the copy stop lying.
   */
  failedStages: number;
}

export interface AutoResult {
  holdings?: readonly Holding[];
  book?: ReadonlyMap<string, Price>;
}

export interface AutoHandlers {
  onProgress: (p: AutoProgress) => void;
  onResult: (r: AutoResult) => void;
}

/**
 * Run one prioritised pass.
 *
 * Returns a function that abandons it. Abandoning does not cancel requests
 * already in flight - nothing here can - it stops their results being
 * published, which is the part that matters when a panel unmounts.
 *
 * The last three arguments are optional because the two stages they feed are
 * the two the panel can genuinely do without: the syndicate export and the
 * relic table load separately and may not have arrived when the panel opens.
 * Absent, those stages do not run, cost nothing, and are not counted - which is
 * the same shape as a player who has no relics.
 */
export function autoPrice(
  account: Record<string, unknown> | null,
  catalog: MarketCatalog | null,
  ducats: DucatDb | null,
  handlers: AutoHandlers,
  offerings?: readonly Offering[],
  ranks?: ReadonlyMap<string, number> | null,
  relics?: readonly Relic[],
): () => void {
  let alive = true;

  /*
   * Counted across every stage, because each one catches its own failure and
   * carries on. Without this the panel cannot tell "still arriving" from
   * "never arriving" and promises the first in both cases.
   */
  let failedStages = 0;
  void (async () => {
    if (!catalog || catalog.failed) {
      /*
       * A FAILED CATALOGUE IS THE FAILURE, not a pass with nothing to do.
       *
       * This is the dominant offline case - the catalogue is the first request
       * of the session, so when the market is unreachable NO stage ever runs
       * and the per-stage counters below stay at zero. Reporting zero here told
       * the panel the pass had simply finished with nothing to price, and the
       * refusals then blamed the player's account for an outage.
       *
       * Measured: with every market request blocked on a cleared cache, this
       * branch is the one that runs, and it reported `failedStages: 0`.
       */
      if (alive) handlers.onProgress({ failedStages: 1, stage: null, done: 0, total: 0 });
      return;
    }

    /*
     * All four stages, sized before anything is fetched so the progress line
     * can state a real total rather than counting up to an unknown.
     *
     * Sizing costs nothing here - every one of these is a join over data
     * already in memory - and doing it up front is what stops the total moving
     * under the reader. A number that grows while it is being counted towards
     * is worse than no number, because it reads as the pass going backwards.
     */
    const held = holdingsOf(account, catalog, ducats);
    const stockSlugs = held.slice(0, STOCK_CAP).length;
    const routeSlugs = representativeSlugs();
    const standingSlugs = reachableSlugs(offerings ?? [], catalog, ranks ?? null);
    const relicSlugs = ownedRelicSlugs(account, relics ?? []);
    const total = stockSlugs + routeSlugs.length + standingSlugs.length + relicSlugs.length;

    if (total === 0) {
      if (alive) handlers.onProgress({ failedStages, stage: null, done: 0, total: 0 });
      return;
    }

    let done = 0;

    /*
     * A counter that moves WHILE a stage runs, not one that jumps between them.
     *
     * Each stage is a sequence of requests paced at roughly one a second, so
     * reporting only at stage boundaries left the line reading "0 of 121" for
     * the better part of half a minute before it moved at all. Nothing was
     * wrong, and it looked exactly like something was.
     */
  const tick = (stage: string, base: number) => (n: number): void => {
      if (alive) handlers.onProgress({ failedStages, stage, done: base + n, total });
    };

    // ---- Stage one: what you hold, because the plan at the top needs it.
    if (stockSlugs > 0) {
      if (alive) handlers.onProgress({ failedStages, stage: 'Pricing what you hold', done, total });
      try {
        const priced = await priceHoldings(held, STOCK_CAP, tick('Pricing what you hold', done));
        if (!alive) return;
        handlers.onResult({ holdings: priced });
      } catch {
        // A failed stage leaves the panel showing what it already knew for free -
        // and now SAYS SO, rather than promising quotes that are not coming.
        failedStages += 1;
      }
      done += stockSlugs;
    }

    // ---- Stage two: one representative per route, for the rates in the list.
    if (routeSlugs.length > 0) {
      if (alive) handlers.onProgress({ failedStages, stage: 'Pricing the routes', done, total });
      try {
        const book = await priceMany(routeSlugs, ROUTE_CAP, tick('Pricing the routes', done));
        if (!alive) return;
        handlers.onResult({ book });
      } catch {
        /* same: partial is better than blank - and counted, so the copy knows */
        failedStages += 1;
      }
      done += routeSlugs.length;
    }

    /*
     * ---- Stage three: what standing buys.
     *
     * Standing is the largest renewable currency in the game and the only one
     * with a published cost per item, so the platinum-per-thousand-standing
     * ranking is exact arithmetic - but only once the platinum half exists.
     * Until this stage lands, that whole recommendation is a list of names.
     */
    if (standingSlugs.length > 0) {
      if (alive) handlers.onProgress({ failedStages, stage: 'Pricing what standing buys', done, total });
      try {
        const book = await priceMany(standingSlugs, standingSlugs.length, tick('Pricing what standing buys', done));
        if (!alive) return;
        handlers.onResult({ book });
      } catch {
        /* the standing card names the offerings and omits the rate */
        failedStages += 1;
      }
      done += standingSlugs.length;
    }

    /*
     * ---- Stage four: the relics already sitting in the inventory.
     *
     * Last because it is the only stage whose answer has a free floor: every
     * relic already shows its exact expected Ducats with no network at all, so
     * a pass that never reaches this one still leaves that section reading
     * correctly. What arrives here is the platinum half on top of it.
     */
    if (relicSlugs.length > 0) {
      if (alive) handlers.onProgress({ failedStages, stage: 'Pricing your relics', done, total });
      try {
        const book = await priceMany(relicSlugs, relicSlugs.length, tick('Pricing your relics', done));
        if (!alive) return;
        handlers.onResult({ book });
      } catch {
        /* the relics keep their Ducat value, which was never a request */
        failedStages += 1;
      }
      done += relicSlugs.length;
    }

    if (alive) handlers.onProgress({ failedStages, stage: null, done, total });
  })();

  return () => {
    alive = false;
  };
}
