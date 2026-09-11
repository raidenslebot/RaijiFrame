/**
 * What things are actually worth, and what an hour of a given farm returns.
 *
 * THIS IS THE ARITHMETIC THE PANEL REFUSED TO DO
 * ─────────────────────────────────────────────
 * It was refused on the grounds that inventing a platinum figure is forbidden.
 * That was the right rule and the wrong conclusion: nothing here is invented.
 * Every number below is a product of two measured quantities:
 *
 *   the CHANCE   from WFCD's warframe-items, which republishes DE's own drop
 *                tables - per relic, per refinement state, per reward
 *   the PRICE    from warframe.market's CLOSED trades - what buyers and sellers
 *                actually settled on, with the day's volume beside it
 *   the DUCATS   from DE's own `primeSellingPrice`, which is not an estimate at
 *                all but the exact figure the relay kiosk pays
 *
 * WHY THE SOURCE MOVED TO WFCD
 * ────────────────────────────
 * The drop tables were previously read from drops.warframestat.us, whose rows
 * name each reward only by its DISPLAY NAME. Joining that to a price meant
 * lower-casing "Akstiletto Prime Barrel" and hoping the market's own name
 * matched character for character - a join that fails silently, drops the
 * reward, and quietly reports an expected value that is too low.
 *
 * WFCD's Relics.json carries, on every reward, DE's `uniqueName` AND the
 * warframe.market slug. Both joins become exact lookups instead of string
 * guesses, and the same `uniqueName` is the key the Ducat table uses, so one
 * source now feeds all three numbers.
 *
 * Expected value per relic is then the plain sum of chance x price over its
 * rewards. That is a real statistic about a real distribution, and it is the
 * single most useful number a Warframe farming tool can produce, because the
 * difference between the best and worst relic of a tier is enormous and no
 * player can hold the table in their head.
 *
 * WHAT IS STILL NOT INVENTED
 * ──────────────────────────
 * Run duration. How long YOUR squad takes to clear a fissure is not a published
 * statistic and it varies by frame, tier and mission, so it is never guessed: it
 * is a number the player sets, and the per-hour figure is explicitly a function
 * of their own input. A rate presented without saying whose minutes it assumes
 * would be a fabrication wearing a decimal point.
 */

import { GentleReader, httpLoader, POLICY } from '../core/gentle.ts';
import type { DucatDb } from './ducats.ts';
import type { MarketCatalog, Price } from './market.ts';
import { priceMany } from './market.ts';

const WFCD = 'https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json';

/** Its own reader: drop tables are large and change on patches, not minutes. */
const drops = new GentleReader(2, 0.5);

export type Refinement = 'Intact' | 'Exceptional' | 'Flawless' | 'Radiant';

export interface RelicReward {
  item: string;
  rarity: string;
  /** Percent, as published. */
  chance: number;
  /** DE's own path. The exact key for both the Ducat table and the account. */
  itemType: string;
  /**
   * The warframe.market slug, straight from the source rather than guessed
   * from the name. Null for the handful of rewards nobody can trade - Forma,
   * the Requiem mods, Kuva - and null is the honest answer for those.
   */
  slug: string | null;
}

export interface Relic {
  tier: string;
  name: string;
  state: Refinement;
  rewards: RelicReward[];
  /** DE's path for the relic itself. */
  itemType: string;
  /** Out of the drop tables: it can still be traded, never farmed. */
  vaulted: boolean;
}

export interface RelicDb {
  all: readonly Relic[];
  failed: boolean;
}

const REFINEMENTS: readonly Refinement[] = ['Intact', 'Exceptional', 'Flawless', 'Radiant'];

/**
 * WFCD names a row "Axi A1 Radiant": tier first, refinement last.
 *
 * A few rows end in "Relic" instead - the Requiem base rows, which have no
 * refinement ladder. They are read as Intact rather than dropped, because they
 * are genuinely openable relics and silently losing them would leave a tier
 * that looks smaller than it is.
 */
function splitName(name: string): { tier: string; short: string; state: Refinement } | null {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const tier = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  const state = REFINEMENTS.find((r) => r === last);
  // Drop the tier from the short name: the UI prints tier and name together,
  // and leaving it in rendered every row as "Axi Axi A1".
  const short = parts.slice(1, state ? parts.length - 1 : parts.length).join(' ');
  return { tier, short, state: state ?? 'Intact' };
}

/**
 * Exported for `check-relic-universe.ts`, on the same grounds `itemdb.ts`
 * exports its parsers: the gate cannot call `loadRelics` because the lazy
 * `gentle` import is unresolvable under Node by design, so it fetches the table
 * itself and needs the real parse rather than a second copy of it.
 */
export function parseRelics(body: string): Relic[] {
  const raw: unknown = JSON.parse(body);
  if (!Array.isArray(raw)) return [];
  const out: Relic[] = [];
  for (const row of raw) {
    const r = row as Record<string, unknown>;
    const name = typeof r['name'] === 'string' ? r['name'] : null;
    const itemType = typeof r['uniqueName'] === 'string' ? r['uniqueName'] : null;
    if (name === null || itemType === null) continue;
    const split = splitName(name);
    if (!split) continue;

    const rewards: RelicReward[] = [];
    for (const rw of Array.isArray(r['rewards']) ? r['rewards'] : []) {
      const w = rw as Record<string, unknown>;
      const item = (w['item'] ?? {}) as Record<string, unknown>;
      const label = typeof item['name'] === 'string' ? item['name'] : null;
      const type = typeof item['uniqueName'] === 'string' ? item['uniqueName'] : null;
      const chance = typeof w['chance'] === 'number' ? w['chance'] : null;
      if (label === null || type === null || chance === null) continue;
      const mk = (item['warframeMarket'] ?? null) as Record<string, unknown> | null;
      const slug = mk && typeof mk['urlName'] === 'string' ? mk['urlName'] : null;
      rewards.push({
        item: label,
        rarity: typeof w['rarity'] === 'string' ? w['rarity'] : 'Unknown',
        chance,
        itemType: type,
        slug,
      });
    }
    if (rewards.length === 0) continue;
    out.push({
      tier: split.tier,
      name: split.short,
      state: split.state,
      rewards,
      itemType,
      vaulted: r['vaulted'] === true,
    });
  }
  return out;
}

export async function loadRelics(): Promise<RelicDb> {
  try {
    const res = await drops.read('wfcd.relics', POLICY.staticData, httpLoader(`${WFCD}/Relics.json`), parseRelics);
    const all = res.value ?? [];
    return { all, failed: all.length === 0 };
  } catch (err) {
    // A failed table means the value is UNKNOWN, never zero.
    console.warn('[relics] drop table unavailable', err);
    return { all: [], failed: true };
  }
}

/* ------------------------------------------------------------- valuation */

export interface ValuedReward extends RelicReward {
  /** Null when the market has no closed trades for it. */
  price: Price | null;
  /** chance x price, in platinum. Null when unpriced. */
  expected: number | null;
  /** Exact Ducats the kiosk pays. Null when it is not a prime part. */
  ducats: number | null;
  /** chance x ducats. Null on the same terms. */
  expectedDucats: number | null;
}

export interface RelicValue {
  relic: Relic;
  rewards: ValuedReward[];
  /** Sum of chance x price over every PRICED reward. */
  expected: number;
  /** How much of the table we could price, 0..1. The honesty term. */
  coverage: number;
  /** Trades a day, summed over the priced rewards: how fast this converts. */
  volume: number;
  /**
   * Sum of chance x Ducats. EXACT, and available with no network at all.
   *
   * This is the floor under every relic: whatever drops, if nobody wants to buy
   * it, the kiosk still pays this. It is the number that decides whether a
   * relic is worth cracking at all, and unlike the platinum figure it does not
   * move, does not depend on demand, and cannot be stale.
   */
  expectedDucats: number;
  /** How much of the table has a Ducat value, 0..1. */
  ducatCoverage: number;
}

/**
 * What one crack of this relic returns on average.
 *
 * `coverage` matters as much as `expected`: a relic whose rare drop could not be
 * priced has an expected value that is too LOW, and the panel says so rather
 * than presenting a partial sum as a whole one.
 */
export function valueRelic(relic: Relic, prices: ReadonlyMap<string, Price>, ducats: DucatDb | null): RelicValue {
  let expected = 0;
  let priced = 0;
  let volume = 0;
  let expectedDucats = 0;
  let ducatChance = 0;

  const rewards: ValuedReward[] = relic.rewards.map((r) => {
    const price = r.slug ? (prices.get(r.slug) ?? null) : null;
    // The median of closed trades, not an asking price: what it actually sold for.
    const value = price ? (r.chance / 100) * price.median : null;
    if (value !== null && price) {
      expected += value;
      priced += r.chance;
      volume += price.volume;
    }

    const duc = ducats ? (ducats.byItemType.get(r.itemType) ?? null) : null;
    const ducValue = duc === null ? null : (r.chance / 100) * duc;
    if (ducValue !== null) {
      expectedDucats += ducValue;
      ducatChance += r.chance;
    }

    return { ...r, price, expected: value, ducats: duc, expectedDucats: ducValue };
  });

  const total = relic.rewards.reduce((n, r) => n + r.chance, 0);
  return {
    relic,
    rewards,
    expected: Math.round(expected * 100) / 100,
    coverage: total > 0 ? priced / total : 0,
    volume,
    expectedDucats: Math.round(expectedDucats * 100) / 100,
    ducatCoverage: total > 0 ? ducatChance / total : 0,
  };
}

/**
 * Value a relic with NO network at all.
 *
 * The Ducat half of the answer is exact and already in memory, so it is shown
 * the instant a relic is opened rather than after a round of market requests.
 * The platinum half arrives later and replaces this; until it does, every price
 * here is honestly null rather than a placeholder zero.
 */
export function valueRelicOffline(relic: Relic, ducats: DucatDb | null): RelicValue {
  return valueRelic(relic, new Map(), ducats);
}

/** Every reward in a relic, as market slugs, for a bounded price fetch. */
export function slugsForRelic(relic: Relic): string[] {
  const out: string[] = [];
  for (const r of relic.rewards) if (r.slug) out.push(r.slug);
  return [...new Set(out)];
}

/** Price one relic's rewards and value it. Bounded: a relic has about six. */
export async function priceRelic(relic: Relic, ducats: DucatDb | null): Promise<RelicValue> {
  const prices = await priceMany(slugsForRelic(relic), 12);
  return valueRelic(relic, prices, ducats);
}

/* ------------------------------------------------- the whole table at once */

/**
 * PRICING THE REWARDS PRICES EVERY RELIC, AND THE OTHER DIRECTION IS HOPELESS.
 * ————————————————————————————
 * `priceRelic` above answers for ONE relic, on a click, and that is the only
 * shape the relic panel ever had. It is why the list could show nothing but a
 * name and the words "6 rewards": ranking the list would have meant pricing
 * every relic, and there are 3,089 of them.
 *
 * Measured against the live drop table rather than assumed: those 3,089 rows
 * are 772 distinct relics, and behind all of them stand only **595 distinct
 * reward items**, 591 of which the market lists. The median reward appears in
 * 24 different relic rows; Forma Blueprint appears in 2,184. So the work was
 * being done in the most expensive possible direction - the reward set is
 * roughly a quarter the size of the relic set, and pricing it once prices
 * everything, permanently, because `gentle` persists what it reads.
 *
 * WHICH ONE TO ASK FOR FIRST, AND AN HONEST NOTE ON HOW MUCH THAT BUYS
 * ————————————————————————————
 * 591 requests at one a second is ten minutes, so the order matters: the list
 * has to become useful long before the pass finishes. It does. Measured over
 * the live table, the first 50 requests resolve 36% of all the expected value
 * in every relic, 100 resolve 49% and 200 resolve 70% - so the ranking is worth
 * reading after a minute and substantially settled after three.
 *
 * The order here is by expected-value MASS: summing `chance/100` for a slug
 * across every relic it appears in is exactly the expectation one request
 * unblocks, which is the quantity `valueRelic` is already built out of.
 *
 * IT BEATS SORTING BY POPULARITY BY ALMOST NOTHING, and saying so is the point.
 * Measured head to head: 36.2% against 35.8% at fifty requests, 49.4% against
 * 48.3% at a hundred, 69.8% against 68.2% at two hundred. Drop chance and
 * appearance count turn out to be nearly collinear in DE's table, so the clever
 * ordering wins between half a point and one and a half. It is kept because it
 * is principled and costs nothing to compute, NOT because it is the reason this
 * works - the reason this works is pricing 591 things instead of 3,089.
 *
 * `coverage` on each `RelicValue` then does the honest half: a relic is ranked
 * on what has been priced so far and SAYS how much of its table that is, so a
 * partially-priced list is useful immediately and never pretends to be whole.
 */
export function rewardUniverse(relics: readonly Relic[]): string[] {
  const mass = new Map<string, number>();
  for (const relic of relics) {
    for (const r of relic.rewards) {
      if (r.slug === null) continue;
      mass.set(r.slug, (mass.get(r.slug) ?? 0) + r.chance / 100);
    }
  }
  return [...mass.entries()]
    // Descending by unblocked expectation; slug as a tiebreak so a pass that is
    // interrupted and resumed asks for the same things in the same order.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([slug]) => slug);
}

/**
 * Value every relic from one shared price map. No network, no per-relic work.
 *
 * Sorted by expectation, but a relic whose table is less than half priced is
 * NOT promoted on a partial sum - `coverage` rides along so the caller can say
 * "38p, from four of six rewards" rather than quietly presenting a floor as an
 * answer. Sorting on the partial number without that caveat is how a relic
 * whose rare is unpriced ends up looking worthless.
 */
export function valueAll(
  relics: readonly Relic[],
  prices: ReadonlyMap<string, Price>,
  ducats: DucatDb | null,
): RelicValue[] {
  return relics
    .map((r) => valueRelic(r, prices, ducats))
    .sort((a, b) => b.expected - a.expected || b.coverage - a.coverage || a.relic.name.localeCompare(b.relic.name));
}

/**
 * Walk the reward universe, reporting after each price lands.
 *
 * `onProgress` fires per slug rather than per stage for the reason `priceMany`
 * documents: a counter that does not move while work is happening is the most
 * reliable way to make a working app look broken. Here it also carries the
 * price map, so the list can re-rank itself as coverage climbs instead of
 * sitting still for ten minutes and then jumping.
 */
export async function priceRewardUniverse(
  relics: readonly Relic[],
  onProgress?: (done: number, total: number, prices: ReadonlyMap<string, Price>) => void,
): Promise<Map<string, Price>> {
  const slugs = rewardUniverse(relics);
  /*
   * `so_far` comes from `priceMany`, and the obvious version of this line was a
   * real bug: closing over the `const prices = await priceMany(...)` binding
   * means the callback reads it while it is still in the temporal dead zone, so
   * the first progress report throws. TypeScript cannot see it, and it only
   * fires on a slow pass - which is every pass this function exists for.
   */
  return await priceMany(slugs, slugs.length, (done, total, so_far) => {
    onProgress?.(done, total, so_far);
  });
}

/* ------------------------------------------------------------ per hour */

export interface RateInput {
  /** Expected platinum from one run. */
  perRun: number;
  /** How many minutes a run takes. THE PLAYER'S NUMBER, never assumed. */
  minutesPerRun: number;
  /** Relics opened per run. Four in a full squad; one solo. */
  relicsPerRun: number;
}

/**
 * Platinum per hour.
 *
 * Deliberately a pure function of inputs the caller had to supply, so there is
 * nowhere for an assumed constant to hide. `minutesPerRun` comes from the
 * player: how fast a squad clears a fissure is not a published number, and
 * inventing one is what would turn this from arithmetic into a claim.
 */
export function perHour(input: RateInput): number | null {
  if (input.minutesPerRun <= 0 || input.relicsPerRun <= 0) return null;
  const runsPerHour = 60 / input.minutesPerRun;
  return Math.round(input.perRun * input.relicsPerRun * runsPerHour);
}

/* ------------------------------------------- what the player is holding */

export interface Holding {
  gameRef: string;
  name: string;
  slug: string;
  count: number;
  price: Price | null;
  /** count x median, in platinum. Null while unpriced. */
  worth: number | null;
  /** Ducats for ONE of them. Exact, free, and known before any request. */
  ducats: number | null;
  /** count x ducats. The free ranking key. */
  ducatWorth: number | null;
}

/**
 * How many trades a stack costs to sell.
 *
 * Six items per side per trade, and the daily cap is your Mastery Rank. This is
 * the constraint that actually binds a seller - not how much a thing is worth,
 * but how many of your limited daily trades it eats - and no third-party tool
 * surfaces it. A stack of 400 Cyan Stars is 67 trades: more than two days at
 * MR30, whatever it is worth.
 */
export function tradesFor(count: number): number {
  return Math.ceil(Math.max(0, count) / 6);
}

/**
 * Join what the account holds to the market catalog.
 *
 * NOT priced here: this returns the join, and the caller prices a bounded slice
 * of it. Pricing an entire inventory eagerly would be thousands of requests
 * against a service run by volunteers, which is the one thing the market reader
 * exists to prevent.
 */
/*
 * WARFRAME.MARKET'S CATALOGUE IS THE AUTHORITY ON WHAT SELLS, NOT DE'S FLAG.
 * ─────────────────────────────────────────────
 * DE's item export carries a `tradable` boolean, and using it looks like the
 * obvious, principled choice - a dead `sellablesFrom` in `platinum.ts` did
 * exactly that, with a comment calling the flag "the authority".
 *
 * Measured against the live data, that flag would have been a disaster here:
 * 230 items the market lists are marked `tradable: false`, and they include
 * Ash Prime, Atlas Prime, Banshee Prime - every prime warframe. The flag
 * describes the assembled FRAME, which indeed cannot be traded, while what
 * players actually sell is the set, listed under the same game reference.
 *
 * So a platinum panel built on DE's flag would have silently dropped the single
 * most valuable category it exists to show. The market's own catalogue cannot
 * make that mistake: an item is in it precisely because somebody can list it.
 * `check-plat.ts` holds this choice in place.
 */
export function holdingsOf(
  account: Record<string, unknown> | null,
  catalog: MarketCatalog,
  ducats: DucatDb | null,
): Holding[] {
  if (!account || catalog.failed) return [];
  const out = new Map<string, Holding>();

  const add = (ref: unknown, count: number): void => {
    if (typeof ref !== 'string') return;
    const item = catalog.byGameRef.get(ref);
    if (!item) return;
    const prev = out.get(ref);
    if (prev) {
      prev.count += count;
      prev.ducatWorth = prev.ducats === null ? null : prev.ducats * prev.count;
      return;
    }
    const duc = ducats ? (ducats.byItemType.get(ref) ?? null) : null;
    out.set(ref, {
      gameRef: ref,
      name: item.name,
      slug: item.slug,
      count,
      price: null,
      worth: null,
      ducats: duc,
      ducatWorth: duc === null ? null : duc * count,
    });
  };

  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const at = (v: unknown, k: string): unknown => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined);
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 1);

  for (const key of ['MiscItems', 'Recipes', 'Upgrades', 'RawUpgrades']) {
    for (const row of arr(account[key])) add(at(row, 'ItemType'), num(at(row, 'ItemCount')));
  }
  for (const key of ['Suits', 'LongGuns', 'Pistols', 'Melee', 'SpecialItems', 'Sentinels', 'SentinelWeapons']) {
    for (const row of arr(account[key])) add(at(row, 'ItemType'), 1);
  }

  /*
   * Ranked by DUCAT value, not by count.
   *
   * This is the free, exact, complete ranking: it covers 100 per cent of the
   * stock with no network at all, because the kiosk price is a published
   * constant. Count alone ranked 180,000 Ferrite above a Prime blueprint.
   *
   * It is a PROXY for platinum, and deliberately a conservative one - ducats
   * correlate with rarity, and the shortlist it produces is what the bounded
   * price fetch then spends its requests on. Items with no ducat value sort
   * last rather than being dropped: they may still be worth plat, they simply
   * cannot be ranked for free.
   */
  return [...out.values()].sort(
    (a, b) => (b.ducatWorth ?? -1) - (a.ducatWorth ?? -1) || b.count - a.count || a.name.localeCompare(b.name),
  );
}

/**
 * Price a bounded shortlist of holdings.
 *
 * `cap` exists because pricing is one request per item and the whole app shares
 * one token bucket. Everything past the cap keeps `price: null`, which the panel
 * renders as "not priced - outside the fetch budget" rather than as a zero. A
 * sweep of a whole inventory is refused by design: at one request every two
 * seconds the first quote would be stale long before the last arrived, and a
 * total summed across them would be internally incoherent.
 */
export async function priceHoldings(
  holdings: readonly Holding[],
  cap = 24,
  /** Fired per quote, so a caller can show a counter that actually moves. */
  onEach?: (done: number, total: number) => void,
): Promise<Holding[]> {
  const shortlist = holdings.slice(0, cap);
  const prices = await priceMany(
    shortlist.map((h) => h.slug),
    cap,
    onEach,
  );
  return holdings.map((h) => {
    const price = prices.get(h.slug) ?? null;
    return { ...h, price, worth: price ? price.median * h.count : null };
  });
}
