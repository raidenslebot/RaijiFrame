/**
 * Overwolf Game Events Provider (GEP) client for Warframe.
 *
 * Warframe's provider is thin but carries one enormous prize: `match_info.inventory`,
 * a serialized dump of the account's items. That is what makes an account-wide
 * progression engine possible without ever asking for the user's credentials.
 *
 * GEP reads the game's memory, so the gentleness rule applies with full force:
 *
 *   - GEP is PUSH. `onInfoUpdates2` delivers changes on its own schedule.
 *   - `getInfo()` is called EXACTLY ONCE per game session, to seed initial state.
 *     There is no polling loop anywhere in this file, and `getInfo` is guarded so
 *     a future caller cannot quietly reintroduce one.
 *   - Every payload is content-hashed. An update carrying bytes we already have
 *     is dropped here and never reaches the store or the UI.
 */

import { ow } from './ow.ts';
import { isPlausibleAccount } from './acquire.ts';

/** The complete Warframe feature set. Verified against dev.overwolf.com. */
export const WARFRAME_FEATURES = ['gep_internal', 'game_info', 'match_info', 'chat'] as const;

/**
 * Raw account inventory as GEP serializes it.
 *
 * `Missions` and `PlayerLevel` were verified against a live response from DE's
 * public profile endpoint (2026-08-31): `Missions` entries carry exactly
 * `{Completes, Tier, Tag, RewardsCooldownTime}`, and `PlayerLevel` is the
 * mastery rank integer. `XPInfo` and `QuestKeys` are absent from that public
 * endpoint and come only from GEP, so their shapes remain unconfirmed against
 * live data — treat every field on them as optional.
 */
export interface RawInventory {
  /** Mastery rank, as an integer. */
  PlayerLevel?: number;
  XPInfo?: Array<{ ItemType: string; XP: number }>;
  /**
   * Completed content, keyed by tag. Verified: the array contains ONLY entries
   * the account has completed at least once, so presence alone implies a clear.
   *
   * Tags are not all star-chart nodes. Observed shapes: `SolNode###` (the star
   * chart), `<From>To<To>Junction`, `ClanNode###`, `SettlementNode###`,
   * `EventNode###`, `CrewBattleNode###` (Railjack), hub nodes, and raid keys.
   */
  Missions?: Array<{ Tag: string; Completes?: number; Tier?: number; RewardsCooldownTime?: unknown }>;
  /** Quest progress. `Completed` is the completionism signal. */
  QuestKeys?: Array<{ ItemType: string; Completed?: boolean; unlock?: boolean; Progress?: unknown[] }>;
  NodeIntrosCompleted?: string[];
  Suits?: Array<{ ItemType: string; XP?: number }>;
  LongGuns?: Array<{ ItemType: string; XP?: number }>;
  Pistols?: Array<{ ItemType: string; XP?: number }>;
  Melee?: Array<{ ItemType: string; XP?: number }>;
  [key: string]: unknown;
}

export interface HighlightedItem {
  name: string;
  riven_details?: unknown[];
}

export interface GepEvents {
  /** Fires only when the inventory bytes actually changed. */
  inventory: (inv: RawInventory) => void;
  username: (name: string) => void;
  /** The item the player is currently hovering in-game. Powers live pricing. */
  highlighted: (item: HighlightedItem) => void;
  chat: (line: string) => void;
  /** GEP connection state, for the status indicator in the UI. */
  status: (state: GepStatus) => void;
  /**
   * The game answered a read, at this wall time - whether or not anything in
   * the answer differed. `inventory` fires only on a difference, and an account
   * that has not changed is the ordinary outcome of a read, so nothing else
   * here can say "we asked, and we are current".
   */
  answered: (at: number) => void;
}

export type GepStatus = 'idle' | 'connecting' | 'connected' | 'failed';

/** Warframe's info bag, as GEP delivers it through `onInfoUpdates2`. */
export interface WarframeInfo extends overwolf.games.events.InfoUpdate2 {
  gep_internal?: { version_info?: string };
  game_info?: { username?: string };
  match_info?: { inventory?: unknown; highlighted?: unknown };
}

type InfoBag = Record<string, Record<string, unknown> | undefined>;

type Listener<K extends keyof GepEvents> = GepEvents[K];

/** FNV-1a, matching gentle.ts. Only answers "did these bytes change". */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * WHAT A REFRESH ACTUALLY CAME BACK WITH.
 *
 * Three outcomes, and the old code could only see two of them. It asked "how
 * many updates did we ROUTE?" and cleared the one-minute floor whenever the
 * answer was zero - but `ingest` skips a byte-identical payload BEFORE it counts
 * anything, and an unchanged inventory is the ordinary result of a refresh. So
 * the floor this class documents as unconditional was cleared by the common
 * case, and held only when the data had changed, which is the case where it does
 * not matter.
 *
 * `seen` counts every entry the bag carried, deduped or not.
 *
 *   nothing    the game handed us no entries at all - a failed or empty read,
 *              which must NOT consume the window
 *   unchanged  it answered, and nothing had moved - that IS an answer, and
 *              asking again a second later gets the same one
 *   new        something changed
 */
/**
 * WHAT BECAME OF THE INVENTORY KEY in one bag - and the inventory is the only
 * key any of this speaks for.
 *
 * Counting keys in general could not answer it. `route` returns true for
 * `gep_internal` and for anything Overwolf adds later, so a bag carrying only
 * the provider's own version block read as a successful account read: it marked
 * the seed done, which kills the retry that exists for "a player who opened the
 * app and stood in their orbiter saw nothing at all", and it stamped
 * `answeredAt`, which is the panel's licence to name a weapon. That is the
 * photographed failure - BROKEN WAR over an Ankyros - with its one safety net
 * switched off BY the read that failed.
 *
 * And the other direction: `highlighted` is refused whenever nothing is hovered,
 * which is the ordinary state, and `ingest` deliberately does not record the
 * hash of a refusal - so counting refusals in general meant one un-hovered
 * frame permanently cleared the one-minute floor and, worse, stopped
 * `answeredAt` moving ever again. Every modding screen after that waited its
 * full window and printed "the loadout could not be re-read", caused by a key
 * that has nothing to do with the loadout.
 */
export type InventoryRead = 'absent' | 'same' | 'fresh' | 'unusable';

export function refreshOutcome(inventory: InventoryRead): 'nothing' | 'unchanged' | 'new' {
  /*
   * A REJECTED PAYLOAD IS A FAILED READ, NOT AN UNCHANGED ONE, and reading
   * only `seen` and `routed` could not tell those apart.
   *
   * GEP reads the game's memory live, so a read taken mid-write hands back
   * truncated JSON; `coerce` returns the raw string and `route` refuses it.
   * That entry still counted in `seen`, so the call read as "nothing changed",
   * consumed the whole one-minute window, and left the panel on numbers the
   * app had just failed to replace - with the hash deliberately NOT recorded
   * so an immediate retry would have worked. The floor then blocked the retry.
   *
   * `nothing` means nothing USABLE came back, which is the question the caller
   * is actually asking: may this call consume the window?
   */
  if (inventory === 'absent' || inventory === 'unusable') return 'nothing';
  return inventory === 'same' ? 'unchanged' : 'new';
}

/**
 * THE ACCOUNT ARRIVES INSIDE A SECOND JSON STRING, and reading only the first
 * one is why the overlay has been planning against a snapshot off disk.
 *
 * MEASURED, on the live app over the running game, by asking the provider
 * directly: `match_info.inventory` is a 247,972-character string that parses to
 *
 *     { "InventoryJson": "<the whole account, as another JSON string>",
 *       "MissionRewards": [] }
 *
 * Neither of those two keys is an account key, so `isPlausibleAccount` counted
 * zero and every single read was refused - `gep: connected`, `accepted: 0`,
 * with the provider holding a quarter of a megabyte of account nobody unpacked.
 * The 150 keys inside it are the real thing: `RawUpgrades`, `Upgrades`,
 * `CurrentLoadOutIds`, `LoadOutPresets`, `FusionPoints`, `RegularCredits`, the
 * weapon and frame lists - everything the optimiser runs on.
 *
 * The flat shape is still accepted, because that is what the snapshot on disk
 * is and what an older provider evidently sent. A truncated inner string
 * returns null, which `route` refuses and `refreshOutcome` calls `unusable` -
 * so the floor opens and the read is asked for again, which is exactly what a
 * half-written memory read deserves.
 */
export function unwrapInventory(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const nested = (value as { InventoryJson?: unknown }).InventoryJson;
  if (typeof nested !== 'string') return value;
  try {
    return JSON.parse(nested);
  } catch {
    return null;
  }
}

/** GEP hands values as JSON strings sometimes and objects other times. */
function coerce<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return value as unknown as T;
  }
}

export class GepClient {
  private listeners = new Map<keyof GepEvents, Set<(...a: never[]) => void>>();
  private hashes = new Map<string, string>();
  private connected = false;
  private seeded = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private seedTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private seedAttempts = 0;

  status: GepStatus = 'idle';

  /*
   * WHEN THE GAME LAST ANSWERED A READ, whether or not the answer differed.
   *
   * `inventoryAt` was standing in for this and cannot: the store moves it only
   * on a REAL change, and an account that has not changed is the ordinary
   * outcome of a refresh. So a modding screen opening onto an unchanged account
   * - the common case, by far - waited out its whole settle window and then
   * told the player "the loadout could not be re-read for this screen", every
   * single time. The read had landed and said nothing was different, which is
   * the answer the panel was waiting for.
   *
   * Set from the `getInfo` path only. A pushed update carries just the keys
   * that changed and may be about something else entirely; a `getInfo` is the
   * whole bag, so it is the one that speaks for the loadout.
   */
  answeredAt: number | null = null;

  /** How many GEP payloads were dropped as byte-identical. Shown in the debug HUD. */
  readonly stats = { updates: 0, deduped: 0, getInfoCalls: 0, refusedRefreshes: 0, failedReads: 0, featureAttempts: 0 };

  /** Hard floor between `refresh()` calls, whatever the caller does. */
  private static readonly REFRESH_FLOOR_MS = 60_000;
  private lastRefreshAt = 0;

  on<K extends keyof GepEvents>(event: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn as (...a: never[]) => void);
    return () => void set.delete(fn as (...a: never[]) => void);
  }

  private emit<K extends keyof GepEvents>(event: K, ...args: Parameters<GepEvents[K]>): void {
    for (const fn of this.listeners.get(event) ?? []) (fn as (...a: unknown[]) => void)(...args);
  }

  private setStatus(s: GepStatus): void {
    this.status = s;
    this.emit('status', s);
  }

  /**
   * Attach to GEP. Safe to call repeatedly - listeners are removed before being
   * re-added, per Overwolf's own guidance, so a reconnect can't stack handlers.
   *
   * Per the docs this must only ever run in the background controller.
   */
  connect(): void {
    if (this.connected) return;
    this.setStatus('connecting');

    ow?.games.events.onInfoUpdates2.removeListener(this.onInfo);
    ow?.games.events.onInfoUpdates2.addListener(this.onInfo);
    ow?.games.events.onNewEvents.removeListener(this.onEvents);
    ow?.games.events.onNewEvents.addListener(this.onEvents);
    ow?.games.events.onError.removeListener(this.onError);
    ow?.games.events.onError.addListener(this.onError);

    this.attempts = 0;
    this.requestFeatures();
  }

  disconnect(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.seedTimer) clearTimeout(this.seedTimer);
    this.retryTimer = null;
    this.seedTimer = null;
    this.seedAttempts = 0;
    ow?.games.events.onInfoUpdates2.removeListener(this.onInfo);
    ow?.games.events.onNewEvents.removeListener(this.onEvents);
    ow?.games.events.onError.removeListener(this.onError);
    this.connected = false;
    this.seeded = false;
    this.lastRefreshAt = 0;
    // The clock belongs to a game that is no longer running. Leaving it set
    // made `npm run live` and the panels report "answered at 14:02" for a
    // game that had exited.
    this.answeredAt = null;
    this.hashes.clear();
    this.setStatus('idle');
  }

  /**
   * GEP is not ready the instant the game process appears, so the documented
   * pattern is a bounded retry. It stops the moment features are acknowledged,
   * and it asks Overwolf - never the game's memory - so it is not a data poll.
   *
   * WHY THE HORIZON IS LONGER THAN IT WAS
   * ────────────────────────────────────
   * It used to be 12 tries three seconds apart: give up after 36 seconds and
   * sit at `failed` for the rest of the session. Warframe's own load - launcher,
   * update check, shader compilation, login - routinely runs past that on a hard
   * disk, so the app declared failure while the game was still starting and then
   * never tried again. The player saw "not running" through an entire play
   * session and nothing in the app could recover it.
   *
   * Backoff instead: quick early tries for the common case, widening to a
   * fifteen-second ceiling, over a horizon that covers a slow cold start. The
   * process watcher tears this down the moment the game exits, so a game that
   * never finishes loading costs a handful of API calls, not a spin.
   */
  private static readonly FEATURE_ATTEMPTS = 24;
  private static readonly FEATURE_CEILING_MS = 15_000;

  private requestFeatures = (): void => {
    this.stats.featureAttempts++;
    ow?.games.events.setRequiredFeatures([...WARFRAME_FEATURES], (res) => {
      if (res?.success && (res.supportedFeatures?.length ?? 0) > 0) {
        this.connected = true;
        this.attempts = 0;
        this.setStatus('connected');
        this.seed();
        return;
      }
      if (++this.attempts >= GepClient.FEATURE_ATTEMPTS) {
        this.setStatus('failed');
        return;
      }
      // 2s, 3s, 4.5s, ... capped. Roughly three minutes across the attempts.
      const wait = Math.min(GepClient.FEATURE_CEILING_MS, 2_000 * 1.5 ** Math.min(this.attempts - 1, 8));
      this.retryTimer = setTimeout(this.requestFeatures, wait);
    });
  };

  /**
   * One-shot snapshot of everything GEP already knows, so the UI is populated
   * without waiting for the next change to be pushed.
   *
   * Deliberately guarded: this is the single call that could become a memory-read
   * poll if someone later "just refreshes" it on a timer. It runs once per session.
   */
  /**
   * Ask the game for a fresh snapshot, outside the once-per-session seed.
   *
   * WHY THIS EXISTS, AND WHY IT IS STILL GENTLE
   * ───────────────────────────────────────────
   * GEP only pushes `match_info.inventory` when the game decides the inventory
   * changed. That is usually right, but it means a player who has been standing
   * in a relay — or who opened the app after the last push — sees data that is
   * correct-but-old with nothing to tell them a refresh is due.
   *
   * This is NOT a poll and must never become one. It is called from a specific
   * observed EVENT: `EndOfMatch.lua: DbUpdateComplete` in EE.log, which is the
   * game telling us the server has finished writing the run's changes. That is
   * precisely the moment a new read returns something different, and it is the
   * moment eelog.ts was written to detect.
   *
   * The floor below is belt-and-braces: even if a future caller wires this to
   * something chattier, the game is asked at most once a minute.
   */
  refresh(reason: string, urgent = false): void {
    if (!this.connected) return;

    /*
     * URGENT IS FOR THE ONE MOMENT THE ANSWER IS WORTHLESS WITHOUT IT.
     *
     * A modding screen opening is the only caller that passes it, and the reason
     * is on the player's screen: they swapped weapons and opened Upgrades inside
     * the same minute, the floor refused the read, and the overlay confidently
     * titled the panel with the weapon they had just taken off. The floor is
     * there to stop a chatty caller polling the game; an event that happens a
     * few times an hour is not that, and it still cannot loop - the session only
     * opens a screen when the player does.
     */
    const now = Date.now();
    if (!urgent && now - this.lastRefreshAt < GepClient.REFRESH_FLOOR_MS) {
      this.stats.refusedRefreshes++;
      return;
    }
    this.lastRefreshAt = now;
    this.stats.getInfoCalls++;
    console.info(`[gep] refresh (${reason})`);
    ow?.games.events.getInfo((res) => {
      /*
       * "RETURNED NOTHING" MEANT `success: false` AND NOTHING ELSE, and the
       * comment below says what it was supposed to mean.
       *
       * `res.res` is truthy for `{}`, so a call that came back successfully
       * carrying nothing this client routes consumed the whole minute-long
       * refresh window - and the refresh exists precisely because a mission has
       * just ended and the numbers are stale. Counting what was actually
       * routed asks the question the comment already states.
       */
      /*
       * "RETURNED NOTHING" AND "NOTHING CHANGED" ARE NOT THE SAME READ, and
       * counting only what was ROUTED could not tell them apart.
       *
       * `ingest` skips a byte-identical payload before it counts anything, and
       * an unchanged inventory is the ORDINARY outcome of a refresh. So the
       * common case returned `routed === 0`, cleared `lastRefreshAt`, and the
       * one-minute floor this class documents as unconditional was gone -
       * leaving the game open to a read per event from any caller. The floor
       * only ever held in the case where it did not matter.
       *
       * `stats.updates` counts every entry the bag carried, deduped or not, so
       * its delta answers the question the old code was trying to ask: did the
       * game hand us anything at all?
       */
      const read = res?.success && res.res ? this.ingest(res.res as InfoBag) : { inventory: 'absent' as const };
      if (refreshOutcome(read.inventory) === 'nothing') {
        // A call that returned nothing must not consume the window. The floor
        // exists to protect the game from us, not to punish the player for a
        // failed read: the next mission that ends may ask again immediately.
        this.stats.failedReads++;
        this.lastRefreshAt = 0;
        return;
      }
      // Anything else is an answer: the game handed over the bag, and whether
      // it differed from what we hold is a separate question from whether it
      // came. See `answeredAt`.
      this.answer();
    });
  }

  /**
   * The game answered a read. Both `getInfo` paths go through here, because the
   * SEED is a read too - and leaving it out put the defect straight back on the
   * most common path there is.
   *
   * At startup the account is loaded from disk, the seed reads the same account
   * out of the game, and `mergeInventory` returns the object it was given - so
   * `inventoryAt` stays null, exactly as it does for any unchanged read.
   * Measured on the live app: a full account, 316 mod rows, and both clocks
   * null. Without this the first modding screen of every session waited out its
   * whole settle window and then told the player the loadout could not be
   * re-read.
   */
  private answer(): void {
    this.answeredAt = Date.now();
    this.emit('answered', this.answeredAt);
  }

  /**
   * One-shot snapshot of everything GEP already knows, so the UI is populated
   * without waiting for the next change to be pushed.
   *
   * WHY THIS RETRIES
   * ────────────────
   * `seeded` used to be set BEFORE the call came back, so a single `getInfo`
   * that returned `success: false` - which it does when the provider has
   * acknowledged the feature but has not finished its first memory read - meant
   * the app never seeded again for that session. From then on it showed data
   * only if the player happened to change something the game chose to push. A
   * player who opened the app and stood in their orbiter saw nothing at all,
   * with no error and nothing to retry.
   *
   * The retry stops on the first successful read and is bounded, so it cannot
   * become the memory poll this file exists to prevent.
   */
  private static readonly SEED_ATTEMPTS = 6;

  private seed(): void {
    if (this.seeded || !this.connected) return;
    this.seedAttempts++;
    this.stats.getInfoCalls++;
    ow?.games.events.getInfo((res) => {
      /*
       * SEEDED MEANS DATA ARRIVED, NOT THAT THE CALL RETURNED.
       *
       * `res.res` is truthy for `{}`, and GEP answers `success: true` with a
       * bag carrying nothing this client routes while the provider has
       * acknowledged the features but not finished its first memory read. The
       * old condition set `seeded` on that, which stops the retry FOREVER - and
       * the symptom is the one written two comments above: a player who opened
       * the app and stood in their orbiter saw nothing at all, with no error and
       * nothing to retry. The retry was added to fix exactly that and then
       * stopped itself on a success that delivered nothing.
       *
       * `ingest` now reports how many payloads it actually routed, so this can
       * ask the question it means.
       */
      const seeded = res?.success && res.res ? this.ingest(res.res as InfoBag).inventory : ('absent' as const);
      if (refreshOutcome(seeded) !== 'nothing') {
        this.seeded = true;
        this.lastRefreshAt = Date.now();
        this.answer();
        return;
      }
      this.stats.failedReads++;
      /*
       * IT DOES NOT GIVE UP WHILE THE GAME IS RUNNING, and giving up is not a
       * hypothetical - it was measured on the live app, from this exact code.
       *
       * The six attempts span 62 seconds. Overwolf's provider took longer than
       * that to finish its first memory read on the launch that was watched, so
       * the seed stopped, and NOTHING asks again: `refresh` needs a caller, and
       * its callers are a mission ending or a modding screen opening. The app
       * sat with `gep: connected` and `accepted: 0` - every number on screen
       * from the snapshot on disk, hours old, with no way back. Asked directly
       * at that moment, the provider returned a 247,972-character inventory: it
       * was ready and willing and nobody was asking.
       *
       * So the backoff caps at the refresh floor and keeps going. That is not a
       * poll of the game's memory: it is the same once-a-minute rate this class
       * already grants every caller, it runs only while the app has NEVER had
       * an account, and it stops dead the moment one arrives. An overlay with
       * no account cannot do its job at all, so the alternative to asking again
       * is not gentleness - it is being wrong quietly.
       */
      const backoff = Math.min(2_000 * 2 ** (this.seedAttempts - 1), GepClient.REFRESH_FLOOR_MS);
      if (this.seedAttempts === GepClient.SEED_ATTEMPTS) {
        console.warn('[gep] the provider has not produced an account yet; asking once a minute until it does');
      }
      this.seedTimer = setTimeout(() => this.seed(), backoff);
    });
  }

  private onInfo = (e: overwolf.games.events.InfoUpdates2Event<string, WarframeInfo>): void => {
    if (!e.info) return;
    /*
     * A PUSH IS A READ TOO, and this is now the single place a pushed account
     * announces itself. The controller's `inventory` handler used to publish
     * the panel as well, which meant a read that CHANGED something published
     * twice while a read that changed nothing had to be caught by a timer -
     * and a late answer, arriving after that timer had fired, published not at
     * all and left its caveat on screen for the rest of the visit.
     */
    if (refreshOutcome(this.ingest(e.info as InfoBag).inventory) !== 'nothing') this.answer();
  };

  private onEvents = (e: { events?: Array<{ name: string; data: string }> }): void => {
    for (const ev of e.events ?? []) {
      if (ev.name === 'chat' && ev.data) this.emit('chat', ev.data);
    }
  };

  private onError = (e: { reason?: string }): void => {
    console.warn('[gep] error', e?.reason);
    // Overwolf recovers on its own; reconnecting here would only add churn.
  };

  /**
   * Route a GEP info bag, dropping anything byte-identical to what we hold.
   *
   * Reports what became of it: how many payloads were delivered, and how many
   * arrived and were refused as unusable. A caller needs both to tell an empty
   * bag from an unchanged one from a bad read - see `refreshOutcome`.
   */
  private ingest(info: InfoBag): { routed: number; rejected: number; inventory: InventoryRead } {
    let routed = 0;
    let rejected = 0;
    let inventory: InventoryRead = 'absent';
    for (const [category, bag] of Object.entries(info)) {
      if (!bag || typeof bag !== 'object') continue;
      for (const [key, raw] of Object.entries(bag)) {
        this.stats.updates++;
        const fingerprint = typeof raw === 'string' ? raw : JSON.stringify(raw);
        const id = `${category}.${key}`;
        const fp = hash(fingerprint);
        if (this.hashes.get(id) === fp) {
          this.stats.deduped++;
          // The game handed over an account and it matched the one we hold.
          // That is an ANSWER, and it is the ordinary outcome of a read.
          if (key === 'inventory') inventory = 'same';
          continue;
        }
        // Recorded only once the payload has actually been delivered. A read
        // that fails to parse used to be hashed anyway, so an identical retry -
        // the likely shape of a transient bad read - was silently dropped as a
        // duplicate and the good value never arrived.
        const delivered = this.route(key, raw);
        if (delivered) {
          this.hashes.set(id, fp);
          routed++;
        } else {
          rejected++;
        }
        if (key === 'inventory') inventory = delivered ? 'fresh' : 'unusable';
      }
    }
    return { routed, rejected, inventory };
  }

  /** True when the payload was delivered; false when it was unusable. */
  private route(key: string, raw: unknown): boolean {
    switch (key) {
      case 'inventory': {
        const inv = unwrapInventory(coerce<RawInventory>(raw)) as RawInventory | null;
        /*
         * THE SAME TEST THE STORE MAKES, because two definitions of "an
         * account" is one too many.
         *
         * `coerce` hands back the raw string when the JSON is truncated, which
         * a mid-write memory read produces; and a well-formed `{}` carrying no
         * recognised key is the other shape of the same failure. The store has
         * always refused both (`setInventory` returns null). This used to
         * accept the second, emit it, and count it as delivered - so the
         * handler bailed out before it could clear the wait, while the read was
         * recorded as a confirmed account. `isPlausibleAccount` is that one
         * definition.
         */
        if (!isPlausibleAccount(inv)) {
          this.stats.failedReads++;
          return false;
        }
        this.emit('inventory', inv);
        return true;
      }
      case 'username': {
        if (typeof raw !== 'string' || !raw) return false;
        this.emit('username', raw);
        return true;
      }
      case 'highlighted': {
        const item = coerce<HighlightedItem>(raw);
        if (!item?.name) return false;
        this.emit('highlighted', item);
        return true;
      }
      default:
        return true; // gep_internal and anything Overwolf adds later
    }
  }
}

export const gep = new GepClient();
