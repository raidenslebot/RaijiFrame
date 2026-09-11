/**
 * The player's platinum position, and what they hold that can be sold.
 *
 * WHAT THIS IS AND IS NOT
 * ───────────────────────
 * This module answers only what the ACCOUNT can prove:
 *
 *   - how much platinum is held, and how much of it can actually be traded away,
 *   - how many trades are left today,
 *   - the ducat, Aya and Regal Aya position,
 *   - how many Rivens are held and how many slots remain,
 *   - and, joined against the item catalog's own `tradable` flag, every thing in
 *     the account that another player could buy.
 *
 * It does NOT price anything. A price comes from warframe.market and nowhere
 * else, and inventing one - or carrying a "typical" number in the source - is
 * exactly the fabricated data the house rules forbid. An unpriced row says so.
 *
 * THE ONE DISTINCTION THAT MATTERS
 * ────────────────────────────────
 * `PremiumCredits` is all the platinum. `PremiumCreditsFree` is the part that
 * came from starter grants and gifts, which can be SPENT but never TRADED away.
 * A trading panel that shows the first number is showing the wrong one, so both
 * are carried and the tradable remainder is what leads.
 */

import type { RawAccount } from './account';
import { DUCATS_ITEM_TYPE, RIVEN_PREFIX, mongoMillis } from './account.ts';

/* --------------------------------------------------------------- reading */

const bag = (acc: RawAccount): Record<string, unknown> => acc as unknown as Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);
const at = (v: unknown, key: string): unknown =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined;

export interface PlatPosition {
  /** Everything in the wallet. */
  held: number | null;
  /** The part that can be traded away: `held` minus the starter/gift portion. */
  tradable: number | null;
  /** Starter and gift platinum. Spendable, never tradable. */
  untradable: number | null;
  /** Trades left today. Resets to mastery rank, +2 for Founders. */
  tradesLeft: number | null;
  tradesCap: number | null;
  ducats: number | null;
  aya: number | null;
  regalAya: number | null;
  /** Rivens the account holds. */
  rivensHeld: number | null;
  /**
   * Free riven slots. The bin counts REMAINING slots, not capacity - the same
   * misread `subsystems.ts` documents for every other bin.
   */
  rivenSlotsFree: number | null;
}

/**
 * Has this read outlived the reset it names?
 *
 * `NextRefill` is the account’s own statement of when its daily counters roll
 * over. Once it is behind us, every daily counter in the read is from before
 * the reset and none of them is a fact about today.
 */
function staleAcrossReset(a: Record<string, unknown>, nowMs: number): boolean {
  const refill = mongoMillis(a['NextRefill'] as never);
  return refill !== null && refill <= nowMs;
}

/** Read the platinum position. Every field is null when the account does not say. */
export function platPosition(acc: RawAccount | null, now?: number): PlatPosition {
  const empty: PlatPosition = {
    held: null,
    tradable: null,
    untradable: null,
    tradesLeft: null,
    tradesCap: null,
    ducats: null,
    aya: null,
    regalAya: null,
    rivensHeld: null,
    rivenSlotsFree: null,
  };
  if (!acc) return empty;

  const a = bag(acc);
  const held = num(a['PremiumCredits']);
  const free = num(a['PremiumCreditsFree']);
  const mr = num(a['PlayerLevel']);

  // Ducats hide behind a historical name; `PrimeBucks` is Ducats, not Aya.
  let ducats: number | null = null;
  let aya: number | null = null;
  const misc = arr(a['MiscItems']);
  if (misc) {
    ducats = 0;
    for (const row of misc) {
      const type = at(row, 'ItemType');
      const count = num(at(row, 'ItemCount')) ?? 0;
      if (type === DUCATS_ITEM_TYPE) ducats += count;
      if (typeof type === 'string' && type.endsWith('/SchismKey')) aya = (aya ?? 0) + count;
    }
  }

  const upgrades = arr(a['Upgrades']);
  const rivensHeld =
    upgrades === null
      ? null
      : upgrades.filter((u) => {
          const type = at(u, 'ItemType');
          return typeof type === 'string' && type.startsWith(RIVEN_PREFIX);
        }).length;

  return {
    held,
    tradable: held === null || free === null ? null : Math.max(0, held - free),
    untradable: free,
    /*
     * Null once the read predates its own reset, not the stale number.
     *
     * The SAME bug as `dailyState` had, in a second place: `TradesRemaining` is
     * a daily counter and this app is built to keep working with the game
     * closed, so past 00:00 UTC the stored value describes a day that is over.
     * The account’s own `NextRefill` is its claim about when that happens; once
     * that instant has passed, what is left today is genuinely unknown.
     */
    tradesLeft: staleAcrossReset(a, now ?? Date.now()) ? null : num(a['TradesRemaining']),
    // Founders get +2. `Founder` is absent on everyone else, which is a fact,
    // not a gap - see acquire.ts CLEARED_WHEN_ABSENT.
    tradesCap: mr === null ? null : mr + (num(a['Founder']) === null ? 0 : 2),
    ducats,
    aya,
    regalAya: num(a['PrimeTokens']),
    rivensHeld,
    rivenSlotsFree: num(at(a['RandomModBin'], 'Slots')),
  };
}

