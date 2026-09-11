/**
 * Worldstate.
 *
 * Reads the parsed worldstate from api.warframestat.us through the gentle layer,
 * which means the whole panel shares one read on a 120s floor no matter how many
 * components ask for it or how often the user reopens the overlay.
 *
 * The endpoint is CORS-open and serves a weak ETag, so a revalidation that finds
 * nothing new costs a 304 and no body.
 */

import { gentle, httpLoader, POLICY } from '../core/gentle';

/*
 * Same shape as `market.ts`: direct in Overwolf under the manifest allowance,
 * proxied on localhost where a browser has no such grant. Without this branch
 * the request is a plain cross-origin fetch that the browser refuses, and the
 * refusal is silent - the panel simply renders as though the world had nothing
 * in it.
 */
const DEV = typeof location !== 'undefined' && /^https?:/.test(location.protocol) && location.hostname === 'localhost';
const ENDPOINT = DEV ? '/__ws/pc' : 'https://api.warframestat.us/pc';

/** A day/night style cycle on an open world. */
export interface Cycle {
  id: string;
  expiry: string;
  state: string;
  timeLeft?: string;
}

export interface Fissure {
  id: string;
  node: string;
  missionType: string;
  enemy: string;
  tier: string;
  tierNum: number;
  expiry: string;
  isStorm?: boolean;
  isHard?: boolean;
  active?: boolean;
}

export interface VoidTrader {
  character: string;
  location: string;
  activation: string;
  expiry: string;
  active?: boolean;
}

export interface Worldstate {
  timestamp: string;
  cetusCycle?: Cycle;
  vallisCycle?: Cycle;
  cambionCycle?: Cycle;
  zarimanCycle?: Cycle;
  earthCycle?: Cycle;
  /**
   * Duviri's mood cycle, and the CIRCUIT's current selection.
   *
   * `choices` was declared as `unknown[]` and never read, which is how a step
   * asking "which frames and weapons does the rotation give me this week" ended
   * up filed as unanswerable. It arrives populated: two groups keyed
   * `EXC_NORMAL` and `EXC_HARD`, the first naming warframes and the second the
   * Incarnon Genesis weapons.
   *
   * The object's `expiry` belongs to the MOOD, which turns over every two
   * hours; the selection inside it does not. So nothing here may present the
   * choices as expiring when the cycle does.
   */
  duviriCycle?: Cycle & {
    choices?: Array<{ category?: string; categoryKey?: string; choices?: string[] }>;
  };
  fissures?: Fissure[];
  voidTrader?: VoidTrader;
  sortie?: { boss?: string; faction?: string; expiry: string; variants?: Array<{ missionType: string; modifier: string; node: string }> };
  archonHunt?: { boss?: string; faction?: string; expiry: string; missions?: Array<{ type: string; node: string }> };
  /**
   * Nightwave, and the acts currently available.
   *
   * These are WORLDSTATE, not account state - which is why they are worth
   * modelling. The daily panel can only say whether YOU have finished an act
   * once an inventory arrives, but which acts are running, what each one asks
   * for and what it pays are public and knowable with the game closed. The feed
   * carried all of it and nothing read it.
   */
  nightwave?: {
    expiry?: string;
    activeChallenges?: NightwaveAct[];
  };
  /**
   * Varzia, who runs Prime Resurgence.
   *
   * Most of her `inventory` arrives de-camel-cased into mangled identifiers -
   * "M P V Banshee Prime Single Pack", "All New1h S G", "T1 Void Projection
   * Banshee Mirage Vault A Bronze" - and none of that is fit to print.
   *
   * The WARFRAME rows are the exception, and they are the whole question the
   * Prime Resurgence route asks. A prime frame's identifier is two plain words,
   * so `BansheePrime` de-camel-cases to "Banshee Prime" and is simply correct.
   * They are told apart by their PATH, `/Lotus/StoreItems/Powersuits/...`,
   * because "the name contains Prime" would also catch the mangled Sentinel row
   * "Prime Helios Power Suit" - checked against the live feed, not assumed.
   *
   * So the inventory is carried with both fields, and the reader decides which
   * rows it is willing to name. Carrying it is not the same as printing it.
   */
  vaultTrader?: {
    character?: string;
    location?: string;
    activation?: string;
    expiry?: string;
    inventory?: Array<{ uniqueName?: string; item?: string }>;
  };
  /** A live in-game event, e.g. a tactical alert. */
  events?: Array<{ id: string; description?: string; node?: string; faction?: string; expiry?: string }>;
  /** Darvo's daily discount. */
  dailyDeals?: Array<{
    id: string;
    item?: string;
    originalPrice?: number;
    salePrice?: number;
    discount?: number;
    total?: number;
    sold?: number;
    expiry?: string;
  }>;
  /** Faction wars in progress. Completed ones are still sent; they are dropped. */
  invasions?: Invasion[];
  /** Teshin's rotating Steel Path offer. `remaining` is pre-formatted by the API. */
  steelPath?: {
    currentReward?: { name?: string; cost?: number };
    expiry?: string;
    remaining?: string;
  };
}

/**
 * A faction war over a node.
 *
 * `completion` is the only genuine two-sided measurement in the whole feed - a
 * percentage of the way from one faction holding the node to the other - which
 * is why this is worth drawing rather than listing. Both sides' rewards are
 * carried, and the node is a real place the star chart knows about.
 */
export interface Invasion {
  id: string;
  /** "Titan (Saturn)" - the same display form the fissures use. */
  node: string;
  desc?: string;
  /** 0..100, from the attacker's side. */
  completion?: number;
  completed?: boolean;
  vsInfestation?: boolean;
  attacker?: InvasionSide;
  defender?: InvasionSide;
}

export interface InvasionSide {
  faction?: string;
  reward?: { countedItems?: Array<{ count?: number; type?: string }>; credits?: number };
}

export interface NightwaveAct {
  id: string;
  title?: string;
  desc?: string;
  /** Standing the act pays. */
  reputation?: number;
  isDaily?: boolean;
  isElite?: boolean;
  expiry?: string;
}

/** Fetch the worldstate. Repeated calls inside the policy window cost nothing. */
export async function readWorldstate() {
  return gentle.read<Worldstate>(
    'worldstate.pc',
    POLICY.worldstate,
    httpLoader(ENDPOINT),
    (body) => JSON.parse(body) as Worldstate,
  );
}

/**
 * Milliseconds until an ISO timestamp, floored at zero.
 *
 * The API also ships a pre-rendered `timeLeft` string, but it is only accurate at
 * the moment of the read - after that it is stale by however long the value has
 * been cached. Computing from `expiry` keeps the countdown honest between reads,
 * which is the whole reason the cache can be as long as it is.
 *
 * `now` is passed in rather than read here so components stay pure during render;
 * the clock lives in state and ticks from an effect.
 */
export function msUntil(iso: string | undefined, now: number): number {
  if (!iso) return 0;
  return Math.max(0, new Date(iso).getTime() - now);
}

/** Compact duration, e.g. "2h 14m" or "48s". */
export function humanDuration(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
