/**
 * Account acquisition: what counts as a real read, and how reads accumulate.
 *
 * THE BUG THIS FIXES
 * ──────────────────
 * Nothing stood between GEP and the durable store. `gep.on('inventory')` called
 * `setInventory(inv)`, which REPLACED the account wholesale, and the same object
 * was written straight to IndexedDB. So the pipeline had exactly one failure
 * mode, and it was catastrophic:
 *
 *   GEP reads the game's MEMORY. A read taken while the game is still populating
 *   its structures - during login, a loading screen, or a host migration - can
 *   return an object that is well-formed JSON and almost empty. That payload
 *   passed `typeof inv === 'object'`, replaced a complete 16 KB account with
 *   three keys, and was persisted over the good snapshot. Every panel then
 *   reported the account as nearly empty, and it stayed that way with the game
 *   closed, because the snapshot on disk was now the bad one.
 *
 * That is the "forgets everything" the user reported, and it needed no unusual
 * conditions - only one unlucky read at any point in a session.
 *
 * THE RULE
 * ────────
 * A read is EVIDENCE, not a replacement. Reads accumulate:
 *
 *   - A payload carrying no recognisable account key at all is not an account.
 *     It is dropped and never reaches the store or the disk.
 *   - A key the new read carries wins, always - including when its value is an
 *     empty array. An empty `PendingRecipes` is a fact about the account (the
 *     foundry is idle) and must overwrite a stale non-empty one.
 *   - A key the new read OMITS is kept from what we already hold. Absence in a
 *     memory read is not evidence of absence in the account - EXCEPT for the
 *     handful of keys DE is documented to omit rather than empty, listed in
 *     `CLEARED_WHEN_ABSENT`. A vanquished lich has to be able to go away.
 *   - A read that arrives after a different player has logged in REPLACES what
 *     we hold; the store owns that gate, since identity is not in the payload.
 *
 * When GEP behaves - and the documented behaviour is a complete dump every time
 * (docs/DATA-SOURCES.md §2a) - the merge is a no-op and costs nothing. When it
 * does not, the account survives. That asymmetry is the whole point.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ──────────────────────────────────
 * It never invents a value. A key nobody has ever sent stays absent, and the
 * panels go on reporting it as unread rather than as zero. Merging carries
 * FORWARD what the game actually said; it does not fill anything in.
 */

import type { RawInventory } from './gep.ts';

/**
 * Keys that identify the blob as an account dump.
 *
 * This is the set the app's own derivation modules read (`src/data/*.ts`), not a
 * guess at the schema - `src/data/account.ts` declares some 400 fields, most of
 * which no real payload carries. A truncated or early memory read typically has
 * none of these; a real account has many.
 */
export const ACCOUNT_KEYS: readonly string[] = [
  'Affiliations',
  'DailyAffiliation',
  'DailyFocus',
  'FocusUpgrades',
  'FocusXP',
  'LongGuns',
  'Melee',
  'MiscItems',
  'Missions',
  'Nemesis',
  'PendingRecipes',
  'Pistols',
  'PlayerLevel',
  'PlayerSkills',
  'PremiumCredits',
  'QuestKeys',
  'RawUpgrades',
  'Recipes',
  'RegularCredits',
  'Suits',
  'Upgrades',
  'XPInfo',
];

/**
 * Keys DE OMITS rather than sends empty, so absence is a fact, not a gap.
 *
 * `inventory-schema.md:593` - `Nemesis`: "The currently active lich/sister.
 * Absent when none." `inventory-schema.md:693` - `Founder`: "Absent = not a
 * Founder." Carrying these forward is not conservative, it is wrong: a player
 * who vanquished their lich would go on being told they have one, on disk,
 * forever, with no way to clear it short of wiping the database.
 *
 * Everything NOT on this list is genuinely ambiguous when absent, and absence
 * there means "this read did not say", which is the case for carrying forward.
 */
export const CLEARED_WHEN_ABSENT: readonly string[] = ['Nemesis', 'Founder'];

const KEYSET: ReadonlySet<string> = new Set(ACCOUNT_KEYS);
const CLEARSET: ReadonlySet<string> = new Set(CLEARED_WHEN_ABSENT);

/** How many recognised account keys a payload actually carries. */
export function accountKeyCount(value: unknown): number {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 0;
  let n = 0;
  for (const key of Object.keys(value)) if (KEYSET.has(key)) n++;
  return n;
}

/**
 * Is this worth accepting at all?
 *
 * One recognised key is the floor, not a quality bar. A single-key read is
 * still real information and merging it loses nothing; the floor exists only to
 * reject `{}`, `null`, an array, and the string a failed JSON parse leaves
 * behind.
 */
export function isPlausibleAccount(value: unknown): value is RawInventory {
  return accountKeyCount(value) > 0;
}

/**
 * Recognised keys outside the clear-when-absent set.
 *
 * This is what decides whether a read is COMPLETE enough for its omissions to
 * mean something. Counting all recognised keys cannot work: `Nemesis` is itself
 * one of them, so the post-vanquish read - the exact payload the deletion rule
 * exists for - always carries one fewer key than what we hold and would never
 * qualify.
 */
function stableKeyCount(value: RawInventory): number {
  let n = 0;
  for (const key of Object.keys(value)) if (KEYSET.has(key) && !CLEARSET.has(key)) n++;
  return n;
}

/**
 * Fold a new read into what we already hold.
 *
 * Returns `prev` itself when the read changes nothing, so a caller can compare
 * by reference and skip a re-render and a disk write. Order matters: `next`
 * last, so every key it carries wins.
 *
 * A read that is at least as complete as what we hold is trusted about what it
 * OMITS, but only for the keys DE is documented to omit rather than empty. A
 * thin read is trusted about nothing it fails to mention.
 */
export function mergeInventory(prev: RawInventory | null, next: RawInventory): RawInventory {
  if (!prev) return next;
  const merged: RawInventory = { ...prev, ...next };
  if (stableKeyCount(next) >= stableKeyCount(prev)) {
    for (const key of CLEARED_WHEN_ABSENT) {
      if (!(key in next) && key in merged) delete merged[key];
    }
  }
  // Reference equality when nothing moved: cheap, and it is what lets the store
  // drop a redundant push instead of re-deriving every panel.
  const prevKeys = Object.keys(prev);
  if (prevKeys.length === Object.keys(merged).length) {
    let same = true;
    for (const key of prevKeys) {
      if (prev[key] !== merged[key]) {
        same = false;
        break;
      }
    }
    if (same) return prev;
  }
  return merged;
}

/**
 * What a read did to the account we hold, for the diagnostics HUD.
 *
 * `dropped` is the one that matters: a non-zero count means the game handed us
 * something that was not an account, which under the old code would have wiped
 * the store.
 */
export interface AcquireStats {
  accepted: number;
  dropped: number;
  /** Reads that carried fewer recognised keys than what we already held. */
  partial: number;
  /** Reads whose every key we already had, byte-for-byte. */
  redundant: number;
  /** Reads that belonged to a different player, so replaced rather than merged. */
  switched: number;
  /**
   * Did the last write to disk land? Null before the first attempt.
   *
   * The account is the one thing here that cannot be re-acquired without
   * launching the game, so a silent storage failure is the difference between
   * "old data" and "no data" on the next launch. The Shell says so when this is
   * false rather than reporting a freshness the disk does not have.
   */
  durable: boolean | null;
}

export function emptyAcquireStats(): AcquireStats {
  return { accepted: 0, dropped: 0, partial: 0, redundant: 0, switched: 0, durable: null };
}
