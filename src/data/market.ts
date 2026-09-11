/**
 * warframe.market — real prices, from the real market.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The panel refused to show platinum values on the grounds that inventing one
 * is forbidden. That was right about invention and wrong about the conclusion:
 * the rule forbids MAKING UP a price, never FETCHING one. `api.warframe.market`
 * has been in the manifest's fetch allowance from the start and `POLICY.market`
 * was written for it. Not going to get the data was a boundary that was never
 * there.
 *
 * WHAT IT GIVES, AND WHY IT IS TRUSTWORTHY
 * ────────────────────────────────────────
 *   /v2/items       3,840 tradable items. Crucially each carries `gameRef`, the
 *                   `/Lotus/...` path - so the market catalog joins DIRECTLY to
 *                   the account's own ItemType. This is the trade catalog the
 *                   mastery catalog could never be: 1,395 mods, 772 relics, 744
 *                   prime items, 230 assembled sets.
 *   /v2/orders/item/<slug>
 *                   LIVE listings: who is selling right now, at what price,
 *                   and whether they are in the game this minute. Statistics
 *                   say what a thing SOLD for; orders say what you can
 *                   actually buy it for and from whom. A median is a
 *                   valuation and an order is a trade.
 *
 *                   v1's orders endpoint answers 403 Deprecated - verified
 *                   against the live API, not assumed - so this is v2 only.
 *
 *   /v1/.../statistics
 *                   Ninety days of CLOSED trades per item: volume, median,
 *                   weighted average, min and max, per day. Closed trades are
 *                   what people actually paid, not what someone is asking, and
 *                   `volume` is measured liquidity rather than a guess about it.
 *
 * BEING A GOOD CITIZEN
 * ────────────────────
 * warframe.market documents a 3-per-second ceiling. This reader runs its own
 * token bucket at well under that, and every read goes through the gentle layer
 * (cache, TTL, single-flight, conditional revalidation). The item catalog is
 * fetched once a day; a price is fetched only for an item somebody actually
 * opened, and then cached. There is no loop over hundreds of items anywhere in
 * this file, and there must never be one: pricing a whole inventory eagerly
 * would be thousands of requests against a volunteer-run service.
 */

import { GentleReader, httpLoader, POLICY } from '../core/gentle.ts';

/*
 * In Overwolf these are reached directly: the manifest's externally_connectable
 * list doubles as the CORS allowance and already carries api.warframe.market.
 * A browser on localhost has no such grant, so the Vite dev server proxies the
 * same paths under /__wfm (see vite.config.ts). Same code, same shapes, and
 * development stops being the one place the data does not arrive.
 */
const DEV = typeof location !== 'undefined' && /^https?:/.test(location.protocol) && location.hostname === 'localhost';
const BASE = DEV ? '/__wfm' : 'https://api.warframe.market';
const V2 = `${BASE}/v2`;
const V1 = `${BASE}/v1`;

/**
 * A dedicated reader, so market traffic cannot be starved by - or starve - the
 * static dataset reads. One token a second, against a documented ceiling of
 * three: deliberately slower than allowed.
 */
/*
 * BACK TO ONE A SECOND, ON EVIDENCE RATHER THAN ON THE DOCUMENTED CEILING.
 *
 * This was raised to two because warframe.market publishes a 3/s limit and the
 * opening pass over 68 routes took 68 seconds at one. The published number
 * turned out not to be the operative one: at two a second the API answered
 * with a run of 429s, which is worse than slow - a refused request returns
 * nothing at all, and the panel that was merely slow became a panel with no
 * prices in it.
 *
 * The original author's note said "deliberately slower than allowed", and the
 * measurement says they were right to be. One a second, and the opening wait
 * is a real cost that is paid honestly rather than a limit tested against a
 * volunteer-run service.
 */
/*
 * SHARED across windows. Both `ingame.html` and `desktop.html` mount the same
 * panel registry, so both can open the Platinum panel; without a shared bucket
 * each holds its own and the pair reads at two a second - the exact rate the
 * note above records as producing a run of 429s.
 */
const market = new GentleReader(4, 1, 'warframe.market');

/**
 * Live orders go stale in minutes; closed-trade statistics do not.
 *
 * `POLICY.market` caches for five minutes with a sixty-second floor, which is
 * right for a ninety-day median and wrong for "is this person online now". A
 * listing can vanish the moment somebody buys it, so this reads more often -
 * and still nowhere near the documented ceiling, because orders are fetched
 * for ONE item at a time, only when somebody opens it. There is no bulk path
 * and there must never be one.
 */
const ORDERS_POLICY = { ttlMs: 90_000, minIntervalMs: 30_000 } as const;

/**
 * Consecutive unreachable quotes that mean the market is down, not thin.
 *
 * Three, because one is a blip and two is a coincidence - and because the only
 * cost of being wrong is that a pass which would have thrown anyway throws
 * sooner, leaving the caller's previous state alone either way.
 */
const UNREACHABLE_STREAK = 3;

/** One live listing, as the market reports it. */
export interface Order {
  platinum: number;
  /** How many they hold. */
  quantity: number;
  /** Most sellers will trade one at a time; some insist on the lot. */
  perTrade: number;
  seller: string;
  /** `ingame` is the one that matters: they can trade this minute. */
  status: 'ingame' | 'online' | 'offline';
  reputation: number;
}

/*
 * NO PLATFORM AND NO CROSSPLAY FIELD, AND THE REASON IS WORTH KEEPING.
 *
 * Both were parsed and then read by nothing at all - dead weight that a type
 * checker cannot see, because an unused interface field is not an unused local.
 * The tempting fix was to start filtering on them, so deleting them meant
 * settling whether they carried anything first.
 *
 * They do not. `/v2/orders/item` answers for ONE platform, chosen by a request
 * header this app never sends, so every row already comes back `pc`: measured
 * across five items, 329 of 329 in-game sellers, with one single `crossplay:
 * false` between them. And the app runs inside Overwolf, which is Windows only,
 * so the endpoint's default platform is the player's platform by construction.
 * A filter on either field could only ever remove nothing.
 *
 * If this app is ever built for a console client, the fix is the request header
 * - not a filter here, which would be reading the answer to a question the
 * request already asked wrong.
 */

export interface OrderBook {
  slug: string;
  /** Visible sell orders, cheapest first. */
  sell: readonly Order[];
  /** Of those, the ones whose seller is in the game right now. */
  live: readonly Order[];
  /** Cheapest live price, which is the number a buyer can actually act on. */
  bestLive: number | null;
  /** Cheapest listed price at all, live or not. */
  bestListed: number | null;
}

/**
 * Who is selling this, right now.
 *
 * WHAT THIS ADDS THAT A MEDIAN CANNOT
 * ————————————————————————————————————————————
 * Every price in this app so far is a median of closed trades: a fair
 * valuation, and useless for actually trading. It cannot tell you the part is
 * listed by four people at 12p, that two of them are in the game this minute,
 * or that the cheapest seller wants you to take all six.
 *
 * Returns null when the request fails, and an EMPTY book when the item is
 * genuinely unlisted - the two are different facts and the caller must be able
 * to tell them apart.
 */
export async function ordersOf(slug: string): Promise<OrderBook | null> {
  try {
    const res = await market.read(
      `wfm.orders.${slug}`,
      ORDERS_POLICY,
      httpLoader(`${V2}/orders/item/${encodeURIComponent(slug)}`),
      (body: string): Order[] => {
        const raw: unknown = JSON.parse(body);
        const rows = (raw as { data?: unknown } | null)?.data;
        if (!Array.isArray(rows)) return [];
        const out: Order[] = [];
        for (const r of rows) {
          const o = r as Record<string, unknown> | null;
          if (o?.['type'] !== 'sell') continue;
          // An invisible order is one the seller has switched off. It is not a
          // listing and must not be counted as one.
          if (o['visible'] !== true) continue;
          const plat = o['platinum'];
          if (typeof plat !== 'number' || plat <= 0) continue;
          const user = o['user'] as Record<string, unknown> | null;
          const status = user?.['status'];
          out.push({
            platinum: plat,
            quantity: typeof o['quantity'] === 'number' ? o['quantity'] : 1,
            perTrade: typeof o['perTrade'] === 'number' ? o['perTrade'] : 1,
            seller: typeof user?.['ingameName'] === 'string' ? user['ingameName'] : '',
            status: status === 'ingame' || status === 'online' ? status : 'offline',
            reputation: typeof user?.['reputation'] === 'number' ? user['reputation'] : 0,
          });
        }
        out.sort((a, b) => a.platinum - b.platinum);
        return out;
      },
    );
    const sell = res.value;
    if (sell === undefined) return null;
    const live = sell.filter((o) => o.status === 'ingame');
    return {
      slug,
      sell,
      live,
      bestLive: live[0]?.platinum ?? null,
      bestListed: sell[0]?.platinum ?? null,
    };
  } catch (err) {
    // A failed request is UNKNOWN, never "nobody is selling this".
    console.warn('[market] orders unavailable', slug, err);
    return null;
  }
}

export interface MarketItem {
  /** warframe.market's own id, used in every other endpoint. */
  slug: string;
  name: string;
  /** The `/Lotus/...` path. This is what joins to the account. */
  gameRef: string | null;
  tags: string[];
}

export interface MarketCatalog {
  /** By `/Lotus/...` path, for joining to what the player owns. */
  byGameRef: ReadonlyMap<string, MarketItem>;
  /** By market slug, for pricing. */
  bySlug: ReadonlyMap<string, MarketItem>;
  all: readonly MarketItem[];
  failed: boolean;
}

const EMPTY: MarketCatalog = { byGameRef: new Map(), bySlug: new Map(), all: [], failed: true };

function parseCatalog(body: string): MarketItem[] {
  const raw: unknown = JSON.parse(body);
  const data = (raw as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const out: MarketItem[] = [];
  for (const row of data) {
    const r = row as Record<string, unknown>;
    const slug = typeof r['slug'] === 'string' ? r['slug'] : null;
    if (slug === null) continue;
    const i18n = r['i18n'] as Record<string, { name?: unknown }> | undefined;
    const name = typeof i18n?.['en']?.name === 'string' ? i18n['en'].name : slug;
    out.push({
      slug,
      name,
      gameRef: typeof r['gameRef'] === 'string' ? r['gameRef'] : null,
      tags: Array.isArray(r['tags']) ? (r['tags'] as unknown[]).filter((t): t is string => typeof t === 'string') : [],
    });
  }
  return out;
}

/** The tradable catalog. One fetch a day; it changes on patches, not on minutes. */
export async function loadMarketCatalog(): Promise<MarketCatalog> {
  try {
    const res = await market.read('wfm.items', POLICY.staticData, httpLoader(`${V2}/items`), parseCatalog);
    const all = res.value ?? [];
    if (all.length === 0) return EMPTY;
    const byGameRef = new Map<string, MarketItem>();
    const bySlug = new Map<string, MarketItem>();
    for (const item of all) {
      bySlug.set(item.slug, item);
      // First wins: a handful of rows share a gameRef (a set and its blueprint),
      // and the earlier row is the more specific one.
      if (item.gameRef !== null && !byGameRef.has(item.gameRef)) byGameRef.set(item.gameRef, item);
    }
    return { byGameRef, bySlug, all, failed: false };
  } catch (err) {
    // A failed catalog means prices are UNKNOWN, never zero.
    console.warn('[market] catalog unavailable', err);
    return EMPTY;
  }
}

/**
 * What an item actually trades for.
 *
 * Every field comes from CLOSED trades - what buyers and sellers settled on -
 * rather than from asking prices, which are aspirational and skew high.
 */
export interface Price {
  slug: string;
  /** Median of the most recent closed day. The number to quote. */
  median: number;
  /** Volume-weighted average of that day. */
  weighted: number;
  /** Trades that day. This is measured liquidity: a high number sells fast. */
  volume: number;
  min: number;
  max: number;
  /** Median across the trailing window, so a quiet day cannot mislead. */
  trend: number;
  /** When that day closed. */
  at: string;
  /**
   * EVERY DAY THE REQUEST ALREADY PAID FOR.
   * ————————————————————————————————————————————
   * The statistics endpoint answers with up to ninety daily closes, and this
   * parse reduced all of them to six scalars and dropped the rest. The history
   * was fetched, parsed, walked once to average a trend, and discarded - on
   * every item, every time.
   *
   * A median says what a thing is worth. Ninety days says whether it is
   * climbing, whether the last close was a fluke, and whether anybody trades it
   * at all in a normal week - none of which a single number can carry, and all
   * of which arrived in the same response.
   *
   * Oldest first, and only days that actually carry a median: a day with no
   * trades is absent from the series rather than plotted as a zero, because
   * zero is a price and "nobody traded" is not.
   */
  history: readonly PriceDay[];
}

/** One day's close, as the market reported it. */
export interface PriceDay {
  /** ISO datetime the day closed. */
  at: string;
  median: number;
  volume: number;
}

interface ClosedRow {
  datetime?: unknown;
  volume?: unknown;
  min_price?: unknown;
  max_price?: unknown;
  median?: unknown;
  wa_price?: unknown;
  moving_avg?: unknown;
}

/**
 * Exported for `check-plat.ts`, the same reason `itemdb.ts` exports its parsers:
 * the interesting behaviour is in the parse, and it is the half that can be
 * exercised without a network.
 */
export function parsePrice(slug: string) {
  return (body: string): Price | null => {
    const raw: unknown = JSON.parse(body);
    const payload = (raw as { payload?: { statistics_closed?: Record<string, unknown> } }).payload;
    const closed = payload?.statistics_closed;
    // Prefer the 48-hour series; fall back to the 90-day one for a thin item
    // that simply has not traded in two days.
    const series = [
      ...(Array.isArray(closed?.['48hours']) ? (closed['48hours'] as ClosedRow[]) : []),
      ...(Array.isArray(closed?.['90days']) ? (closed['90days'] as ClosedRow[]) : []),
    ];
    if (series.length === 0) return null;

    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

    /*
     * A ROW IS TAKEN WHOLE OR NOT AT ALL, WHICH IS WHY THIS IS NOT JUST `median`.
     * ————————————————————————————
     * The five figures below used to end `?? 0`, and four of those fallbacks were
     * reachable: a row carrying a median but no `min_price` produced a price
     * object reading 0p, which `plat-picks.ts` then printed beside the label
     * `from: 'measured'`. A zero nobody measured, presented as a measurement, in
     * the one app whose central rule is that those are different things.
     *
     * Measured before changing it: 983 closed rows across six items, and not one
     * was missing any of the five. The API sends them as a set, because they are
     * one aggregation - so a row short of one is a broken row, not a thin day.
     *
     * Requiring all five here makes the fabricated zero UNREACHABLE rather than
     * merely unlikely, and it costs nothing on real data. If no row in the series
     * is complete the whole quote is null, which every caller already reads as
     * "this is not priced" - the honest answer, and the one the file's own header
     * insists on everywhere else.
     */
    const complete = (r: ClosedRow | undefined): boolean =>
      r !== undefined &&
      num(r.median) !== null &&
      num(r.wa_price) !== null &&
      num(r.min_price) !== null &&
      num(r.max_price) !== null &&
      num(r.volume) !== null;

    // The most recent row that carries the whole set.
    let last: ClosedRow | null = null;
    for (let i = series.length - 1; i >= 0; i--) {
      if (complete(series[i])) {
        last = series[i] ?? null;
        break;
      }
    }
    if (!last) return null;

    const medians = series.map((r) => num(r.median)).filter((n): n is number => n !== null);
    const trend = medians.length > 0 ? medians.reduce((a, b) => a + b, 0) / medians.length : (num(last.median) ?? 0);

    /*
     * The series, kept. A day with no median is dropped rather than zeroed -
     * see the note on `history`. The 48-hour rows are prepended to the 90-day
     * ones above, so the same day can appear twice; the later entry wins,
     * because the 48-hour series is the finer-grained one.
     */
    const byDay = new Map<string, PriceDay>();
    for (const row of series) {
      const median = num(row.median);
      const at = typeof row.datetime === 'string' ? row.datetime : null;
      const volume = num(row.volume);
      // Same rule as the quote: a day missing its volume is dropped, not zeroed.
      // "Nothing traded" and "the row did not carry the field" are the two things
      // this file exists to keep apart, and they render identically as a 0.
      if (median === null || at === null || volume === null) continue;
      byDay.set(at.slice(0, 10), { at, median, volume });
    }
    const history = [...byDay.values()].sort((a, b) => a.at.localeCompare(b.at));

    return {
      slug,
      history,
      // Every one of these is non-null by `complete()` above; the `?? 0` that
      // used to stand here was the only way a zero could enter this object.
      median: num(last.median) ?? 0,
      weighted: num(last.wa_price) ?? 0,
      volume: num(last.volume) ?? 0,
      min: num(last.min_price) ?? 0,
      max: num(last.max_price) ?? 0,
      trend: Math.round(trend * 10) / 10,
      at: typeof last.datetime === 'string' ? last.datetime : '',
    };
  };
}

/**
 * Price one item.
 *
 * ON DEMAND ONLY. Called for something the player has actually opened, never in
 * a loop over an inventory: that would be thousands of requests at a service
 * run by volunteers.
 *
 * "NOBODY TRADED IT" AND "WE COULD NOT ASK" ARE DIFFERENT ANSWERS.
 * ───────────────────────────────────────────────────────────────
 * This used to return null for both, and every surface in the app renders that
 * null as "no recent trades" - a statement about the MARKET. So with the
 * network down, a rate limit hit, or CORS refusing in the packaged app, the
 * panel told the player that nothing they own has sold in ninety days. That is
 * the single most expensive lie this app can tell, it is indistinguishable from
 * the truth on screen, and it is exactly the absent-versus-zero rule this
 * project is built on, applied to a failure instead of a field.
 *
 * `priceOf` keeps its shape for the callers that only need the price, and
 * `quoteOf` below carries the distinction for the ones that report it.
 */
export type Quote =
  /** The market answered, and this is what it said. */
  | { kind: 'price'; price: Price }
  /** The market answered and had nothing: no closed trade in the window. */
  | { kind: 'none' }
  /** We never got an answer. Says nothing at all about the item. */
  | { kind: 'unreachable'; why: string };

export async function quoteOf(slug: string): Promise<Quote> {
  try {
    const res = await market.read(
      `wfm.price.${slug}`,
      POLICY.market,
      httpLoader(`${V1}/items/${slug}/statistics`),
      parsePrice(slug),
    );
    return res.value ? { kind: 'price', price: res.value } : { kind: 'none' };
  } catch (err) {
    return { kind: 'unreachable', why: err instanceof Error ? err.message : 'the request failed' };
  }
}

export async function priceOf(slug: string): Promise<Price | null> {
  const q = await quoteOf(slug);
  return q.kind === 'price' ? q.price : null;
}

/**
 * Price a small, bounded set - the rewards of one relic, say.
 *
 * The cap is the point. Six rewards is fine; a whole inventory is not, and the
 * limit is enforced here rather than trusted to every caller.
 */
export async function priceMany(
  slugs: readonly string[],
  cap = 12,
  /**
   * Called once per slug, as each one lands.
   *
   * Without it a caller can only report progress in whole stages, and a stage
   * of twenty-four sequential requests takes the better part of half a minute -
   * during which the panel's own progress line sat at "0 of 121" and then
   * jumped. A counter that does not move while work is happening is the single
   * most reliable way to make a working app look broken.
   */
  onEach?: (done: number, total: number, so_far: ReadonlyMap<string, Price>) => void,
): Promise<Map<string, Price>> {
  const out = new Map<string, Price>();
  const wanted = [...new Set(slugs)].slice(0, cap);
  // Sequential on purpose: the bucket would serialise them anyway, and this
  // keeps the request pattern obviously polite.
  let done = 0;
  let unreachable = 0;
  let streak = 0;
  for (const slug of wanted) {
    const q = await quoteOf(slug);
    if (q.kind === 'price') {
      out.set(slug, q.price);
      streak = 0;
    } else if (q.kind === 'unreachable') {
      unreachable += 1;
      streak += 1;
    } else {
      // A quote the market simply has none of. That is data, not an outage.
      streak = 0;
    }
    done += 1;
    // The map so far, not just the counter. A caller pricing a large set needs
    // to re-rank as coverage climbs; without it the only honest thing it can do
    // is sit still until the whole pass lands.
    onEach?.(done, wanted.length, out);

    /*
     * STOP ONCE THE ANSWER IS ALREADY KNOWN.
     * ————————————————————————————————————————————
     * The loop is paced by the shared one-a-second bucket, and a request that
     * never reaches the network spends a token exactly like one that does. So
     * with the market down this walked all 44 route slugs at a second each -
     * measured: sixteen progress reports in twenty-five seconds, fifteen items
     * in, every one failing instantly - while the panel told the player "the
     * quotes are arriving now". Minutes of throttled nothing, and an optimistic
     * sentence on top of it.
     *
     * Three consecutive unreachable results with NOTHING priced yet is not a
     * blip. The pass already throws when every item is unreachable; this is the
     * same verdict reached in three seconds instead of forty-four, and it costs
     * a volunteer-run service forty-one requests it was never going to answer.
     *
     * A single miss cannot trigger it, a success anywhere resets the streak,
     * and 'no quote for this item' is data rather than an outage - so a market
     * that is up but thin walks the whole list exactly as before.
     */
    if (streak >= UNREACHABLE_STREAK && out.size === 0 && done < wanted.length) {
      throw new Error(
        `the market could not be reached - ${String(streak)} requests in a row failed before anything was priced`,
      );
    }
  }
  /*
   * A pass where NOTHING could be reached is a failed pass, not a market with
   * nothing in it. Throwing here is what lets the callers - all of which
   * already have a try/catch that leaves the previous state alone - avoid
   * publishing an empty book that reads as "none of this trades".
   */
  if (unreachable === wanted.length && wanted.length > 0) {
    throw new Error(`the market could not be reached for any of ${String(wanted.length)} items`);
  }
  return out;
}

/** Diagnostics: how much traffic this reader has actually generated. */
export const marketStats = market.stats;
