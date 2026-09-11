/**
 * The account ledger — an append-only record of what changed, and when.
 *
 * The app already SEES almost everything: `core/eelog.ts` parses seventeen kinds
 * of log event, GEP pushes a full account on every inventory-affecting action,
 * and `missionlog` compares two snapshots per run. What it KEEPS is a fraction
 * of that. Four surveys of this tree found forty-two measurements taken and
 * discarded, and they all fail the same way — the value is reduced on the way in
 * and the reduction is the only thing stored:
 *
 *   - `core/store.ts` merges each push into the account and keeps the result.
 *     `core/snapshot.ts` keeps that plus ONE previous generation. Every earlier
 *     value of every field the account has ever held is gone.
 *   - `missionlog.diffInventory` reports `gained > 0`, so a run's spends — the
 *     forma, the relic, the ciphers, the revives — are computed and dropped.
 *   - the log parser's `gameRules`, `squad`, `squadCount`, `waitingSeconds` and
 *     every intermediate session-state transition are parsed, then read by
 *     nothing.
 *
 * So this module is not a new data source. It is the decision to stop
 * aggregating on the way in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A LEDGER EVENT IS — a CHANGE, not a state.
 *
 * A value seen for the first time did not change, and is not recorded here: the
 * account's opening state is what `core/snapshot.ts` is for. Recording first
 * sightings would re-baseline several thousand mastery rows on every app start,
 * which is noise that would bury the real history inside a week.
 *
 * The consequence is worth stating plainly, because it is the same three-state
 * rule the rest of this codebase runs on: an item absent from the ledger was
 * never OBSERVED to change. That is not the same as "did not change", and it is
 * not zero. A ledger read against a window the app was closed for reports
 * silence, not stillness.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PRIVACY. Nothing here may come from a raw EE.log line — the same rule
 * `history-store.ts` states, and it binds harder in a file whose whole purpose
 * is to keep more. Every value written is a NUMBER, or a string drawn from the
 * allowlisted parsed fields the log parser already exposes (a node tag, a
 * mission type, an outcome). `scripts/check-ledger.ts` asserts it: the watch
 * table below is the only way an account field reaches storage, and the gate
 * reads that table rather than a list typed beside it.
 */

import type { LogEvent } from '../core/eelog.ts';
import type { Affiliation, Mission, RawAccount, SlotBin, TypeXp } from './account.ts';
import {
  DAILY_AFFILIATION_KEYS,
  EQUIPMENT_KEYS,
  SLOT_KEYS,
  allEquipment,
  mongoMillis,
  oidOf,
} from './account.ts';

/**
 * The coarse bucket, so a reader can ask for one kind without knowing every
 * name. `name` is the series; `kind` is what sort of thing the series is.
 */
export type LedgerKind =
  /** An allowlisted numeric account field moved. `name` is the series. */
  | 'counter'
  /** An item's count went up inside a mission window. */
  | 'gain'
  /** An item's count went down — the half `diffInventory` discards. */
  | 'spend'
  /** Login, session-state transition, session end. */
  | 'session'
  /** A mission bracket event, at its own timestamp rather than the run's. */
  | 'mission'
  /** Squad size or composition. Names only ever with `captureSquadNames`. */
  | 'squad'
  /** The ledger's own facts: an account switch, a degraded write. */
  | 'system'
  /** The arsenal: a modding screen opened, a mod placed, a build saved, a fusion paid for. */
  | 'arsenal';

/** Every kind, as a value — `history-store.ts` validates imported rows against it. */
export const LEDGER_KINDS: readonly LedgerKind[] = [
  'counter',
  'gain',
  'spend',
  'session',
  'mission',
  'squad',
  'system',
  'arsenal',
];

export interface LedgerEvent {
  /**
   * Assigned by IndexedDB on write and attached on read. Monotone, so two
   * events in the same millisecond still have an order.
   */
  seq?: number;
  /**
   * Whose account. Empty string when the player has not been named yet — never
   * null, because an index cannot key on null and these rows would vanish from
   * every account-scoped query.
   */
  account: string;
  at: number;
  kind: LedgerKind;
  /** The series: `platinum`, `standing:CetusSyndicate`, `mastery-xp:/Lotus/…`. */
  name: string;
  from: number | string | null;
  to: number | string | null;
  /** `to - from` where both are numbers. Null otherwise — never a coerced 0. */
  by: number | null;
}

// ── the watch table ──────────────────────────────────────────────────────────

/**
 * One entry per account field worth a time series.
 *
 * A `scalar` is a single number on the account. A `keyed` collection produces
 * one series per entry — `standing:CetusSyndicate`, `slots:SuitBin` — which is
 * how thirteen entries here cover several thousand individual series.
 *
 * These are functions rather than string paths on purpose: a path interpreter
 * would need its own parser, its own escaping and its own tests to do what the
 * type checker already does for free here. Every reader must tolerate an absent
 * key — the account arrives partial constantly.
 */
export type Watch =
  | { name: string; kind: 'scalar'; read: (a: RawAccount) => number | undefined }
  | { name: string; kind: 'keyed'; read: (a: RawAccount) => Map<string, number> }
  /**
   * A collection whose LENGTH is the measurement. Twenty-odd fields on the
   * account are opaque arrays of ids — alerts completed, cosmetics owned, liches
   * resolved — where the entries carry nothing worth a series and the count
   * carries everything. Without this kind each would need a bespoke `scalar`
   * closure that all say `?.length`.
   */
  | { name: string; kind: 'count'; read: (a: RawAccount) => number | undefined };

/**
 * NUMBERS THAT ARE NOT MEASUREMENTS, and must never be watched.
 *
 * `account.ts` says three times that these exceed `Number.MAX_SAFE_INTEGER` and
 * are already corrupted by the time `JSON.parse` has finished with them. A watch
 * on one would emit a change every time the same value was re-read differently
 * — fabricated history, indistinguishable from the real kind, in a store whose
 * entire value is that it can be trusted about the past.
 *
 * `scripts/check-ledger.ts` asserts no watch accessor names any of these.
 */
export const NEVER_WATCH = [
  'RewardSeed',
  'NemesisFingerprint',
  'DuviriInfo.Seed',
  '.fp',
  'Seed',
] as const;

/** `{ItemType, ItemCount}[]`, the shape a dozen account arrays share. */
function typeCounts(rows: ReadonlyArray<{ ItemType?: string; ItemCount?: number }> | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows ?? []) {
    if (r.ItemType && typeof r.ItemCount === 'number') out.set(r.ItemType, r.ItemCount);
  }
  return out;
}

/** One series per row, keyed by whatever `id` pulls out of it. */
function keyed<T>(
  rows: readonly T[] | undefined,
  id: (row: T) => string | null | undefined,
  num: (row: T) => number | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows ?? []) {
    const k = id(r);
    const v = num(r);
    if (k && typeof v === 'number' && Number.isFinite(v)) out.set(k, v);
  }
  return out;
}

/** Read an arbitrary account key through the interface's index signature. */
function at(a: RawAccount, key: string): unknown {
  return (a as unknown as Record<string, unknown>)[key];
}

function byTag(rows: Mission[] | undefined, pick: (m: Mission) => number | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows ?? []) {
    const v = pick(row);
    if (row.Tag && typeof v === 'number') out.set(row.Tag, v);
  }
  return out;
}

/**
 * The complete list of account fields that reach storage. Adding a row here is
 * the ONLY way to record a new one, which is what makes the privacy rule
 * checkable rather than a convention.
 */
export const WATCHES: Watch[] = [
  { name: 'credits', kind: 'scalar', read: (a) => a.RegularCredits },
  { name: 'platinum', kind: 'scalar', read: (a) => a.PremiumCredits },
  { name: 'platinum-free', kind: 'scalar', read: (a) => a.PremiumCreditsFree },
  { name: 'mastery-rank', kind: 'scalar', read: (a) => a.PlayerLevel },
  { name: 'daily-focus', kind: 'scalar', read: (a) => a.DailyFocus },
  { name: 'trades-remaining', kind: 'scalar', read: (a) => a.TradesRemaining },
  { name: 'rivens-unveiled', kind: 'scalar', read: (a) => a.RandomUpgradesIdentified },
  { name: 'duviri-completions', kind: 'scalar', read: (a) => a.DuviriInfo?.NumCompletions },
  {
    name: 'standing',
    kind: 'keyed',
    read: (a) => {
      const out = new Map<string, number>();
      for (const row of (a.Affiliations ?? []) as Affiliation[]) {
        if (row.Tag && typeof row.Standing === 'number') out.set(row.Tag, row.Standing);
      }
      return out;
    },
  },
  {
    name: 'focus',
    kind: 'keyed',
    read: (a) => {
      const out = new Map<string, number>();
      for (const [school, xp] of Object.entries(a.FocusXP ?? {})) {
        if (typeof xp === 'number') out.set(school, xp);
      }
      return out;
    },
  },
  {
    name: 'slots',
    kind: 'keyed',
    read: (a) => {
      const out = new Map<string, number>();
      for (const key of SLOT_KEYS) {
        // `Slots` is remaining FREE slots, not capacity (account.ts:260).
        const bin = (a as Partial<Record<string, SlotBin>>)[key];
        if (typeof bin?.Slots === 'number') out.set(key, bin.Slots);
      }
      return out;
    },
  },
  {
    // How many times each node was run — not merely whether it was ever cleared,
    // which is all the star chart reads today.
    name: 'node-completes',
    kind: 'keyed',
    read: (a) => byTag(a.Missions, (m) => m.Completes),
  },
  {
    // The real mastery ledger: per-item XP. The highest-volume watch here, and
    // the one that makes "what did this run actually level" answerable.
    name: 'mastery-xp',
    kind: 'keyed',
    read: (a) => {
      const out = new Map<string, number>();
      for (const row of (a.XPInfo ?? []) as TypeXp[]) {
        if (row.ItemType && typeof row.XP === 'number') out.set(row.ItemType, row.XP);
      }
      return out;
    },
  },

  // -- currencies beyond the two obvious ones ---------------------------------
  { name: 'endo', kind: 'scalar', read: (a) => a.FusionPoints },
  { name: 'dirac', kind: 'scalar', read: (a) => a.CrewShipFusionPoints },
  { name: 'regal-aya', kind: 'scalar', read: (a) => a.PrimeTokens },
  { name: 'bounty-score', kind: 'scalar', read: (a) => a.BountyScore },
  { name: 'handler-points', kind: 'scalar', read: (a) => a.HandlerPoints },

  /*
   * THE DAILY POOLS. Fourteen numbers that drain as you play and jump back at
   * 00:00 UTC, which makes them the closest thing the account has to a record of
   * one day's effort. They were invisible to the first table because RawAccount
   * inherits them through `Partial<Record<DailyAffiliationKey, number>>` instead
   * of naming them in its own body.
   */
  {
    name: 'daily-standing',
    kind: 'keyed',
    read: (a) => keyed(DAILY_AFFILIATION_KEYS, (k) => k, (k) => at(a, k) as number | undefined),
  },
  { name: 'daily-gifts', kind: 'scalar', read: (a) => a.GiftsRemaining },
  { name: 'found-today', kind: 'keyed', read: (a) => typeCounts(a.FoundToday) },
  { name: 'simaris-daily-scans', kind: 'scalar', read: (a) => a.LibraryActiveDailyTaskInfo?.Scans },
  { name: 'netracells-used', kind: 'scalar', read: (a) => a.EntratiVaultCountLastPeriod },

  // -- stock: every `{ItemType, ItemCount}` array the account carries ---------
  /*
   * `missionlog.diffInventory` already diffs MiscItems and Recipes, but only
   * inside a mission bracket. Continuous here, which is what catches a trade, a
   * foundry claim and a market purchase - none of which happen inside a mission
   * and none of which anything has ever recorded.
   */
  { name: 'resource', kind: 'keyed', read: (a) => typeCounts(a.MiscItems) },
  { name: 'blueprint', kind: 'keyed', read: (a) => typeCounts(a.Recipes) },
  { name: 'consumable', kind: 'keyed', read: (a) => typeCounts(a.Consumables) },
  { name: 'level-key', kind: 'keyed', read: (a) => typeCounts(a.LevelKeys) },
  { name: 'ship-decoration', kind: 'keyed', read: (a) => typeCounts(a.ShipDecorations) },
  { name: 'email-item', kind: 'keyed', read: (a) => typeCounts(a.EmailItems) },
  { name: 'railjack-ammo', kind: 'keyed', read: (a) => typeCounts(a.CrewShipAmmo) },
  { name: 'railjack-salvage', kind: 'keyed', read: (a) => typeCounts(a.CrewShipRawSalvage) },
  { name: 'mod-stack', kind: 'keyed', read: (a) => typeCounts(a.RawUpgrades) },
  {
    /*
     * The OTHER half of a mod collection. `RawUpgrades` above is the rank-0
     * stack count; `Upgrades` is every individually-tracked copy - ranked mods,
     * arcanes, rivens - which the stack count never sees. Counted per ItemType
     * rather than per instance so the series is 'how many Serrations do I have'
     * rather than several thousand one-sample series keyed by object id.
     */
    name: 'mod-owned',
    kind: 'keyed',
    read: (a) => {
      const out = new Map<string, number>();
      for (const u of a.Upgrades ?? []) {
        if (u.ItemType) out.set(u.ItemType, (out.get(u.ItemType) ?? 0) + 1);
      }
      return out;
    },
  },
  { name: 'ayatan-sockets', kind: 'keyed', read: (a) => keyed(a.FusionTreasures, (t) => t.ItemType, (t) => t.Sockets) },

  // -- boosters ---------------------------------------------------------------
  {
    /*
     * `ExpiryDate` is UNIX SECONDS here - not a MongoDate and not milliseconds;
     * `account.ts` says so at the field. Converted on the way in so every
     * timestamp in this store shares one unit. A series that mixes seconds and
     * milliseconds is a thousand-fold error waiting for whoever plots it.
     */
    name: 'booster-expires',
    kind: 'keyed',
    read: (a) =>
      keyed(a.Boosters, (b) => b.ItemType, (b) => (typeof b.ExpiryDate === 'number' ? b.ExpiryDate * 1000 : undefined)),
  },
  { name: 'booster-uses', kind: 'keyed', read: (a) => keyed(a.Boosters, (b) => b.ItemType, (b) => b.UsesRemaining) },

  // -- progression ------------------------------------------------------------
  {
    name: 'syndicate-rank',
    kind: 'keyed',
    read: (a) => keyed(a.Affiliations as Affiliation[] | undefined, (r) => r.Tag, (r) => r.Title),
  },
  {
    name: 'node-cooldown',
    kind: 'keyed',
    read: (a) => keyed(a.Missions as Mission[] | undefined, (m) => m.Tag, (m) => mongoMillis(m.RewardsCooldownTime)),
  },
  {
    name: 'quest-stage',
    kind: 'keyed',
    read: (a) => keyed(a.QuestKeys, (q) => q.ItemType, (q) => q.Progress?.reduce((n, p) => n + (p.c ?? 0), 0)),
  },
  { name: 'challenge', kind: 'keyed', read: (a) => keyed(a.ChallengeProgress, (c) => c.Name, (c) => c.Progress) },
  {
    name: 'intrinsics',
    kind: 'keyed',
    read: (a) =>
      keyed(
        Object.entries(a.PlayerSkills ?? {}),
        ([k]) => k,
        ([, v]) => (typeof v === 'number' ? v : undefined),
      ),
  },
  { name: 'focus-capacity', kind: 'scalar', read: (a) => a.FocusCapacity },
  { name: 'focus-node', kind: 'keyed', read: (a) => keyed(a.FocusUpgrades, (f) => f.ItemType, (f) => f.Level) },
  { name: 'incarnon', kind: 'keyed', read: (a) => keyed(a.EvolutionProgress, (e) => e.ItemType, (e) => e.Progress) },
  {
    name: 'fragment-scans',
    kind: 'keyed',
    read: (a) => keyed(a.LoreFragmentScans, (f) => f.ItemType, (f) => f.Progress),
  },
  {
    name: 'simaris-scans',
    kind: 'keyed',
    read: (a) => keyed(a.LibraryPersonalProgress, (p) => p.TargetType, (p) => p.Scans),
  },
  {
    name: 'collectible',
    kind: 'keyed',
    read: (a) => keyed(a.CollectibleSeries, (c) => c.CollectibleType, (c) => c.Count),
  },
  { name: 'event-score', kind: 'keyed', read: (a) => keyed(a.PersonalGoalProgress, (g) => g.Tag, (g) => g.Count) },
  { name: 'event-best', kind: 'keyed', read: (a) => keyed(a.PersonalGoalProgress, (g) => g.Tag, (g) => g.Best) },
  {
    name: 'weekly-runs',
    kind: 'keyed',
    read: (a) => keyed(a.PeriodicMissionCompletions, (p) => p.tag, (p) => p.count),
  },
  { name: 'circuit-xp', kind: 'keyed', read: (a) => keyed(a.EndlessXP, (e) => e.Category, (e) => e.Earn) },
  {
    name: 'descent-floor',
    kind: 'keyed',
    read: (a) => keyed(a.DescentRewards, (d) => d.Category, (d) => d.FloorClaimed),
  },
  { name: 'mr-test-unlocks', kind: 'scalar', read: (a) => mongoMillis(a.TrainingDate) ?? undefined },

  // -- duplicate protection, which nothing has ever been able to explain ------
  /*
   * The server's own pity weight per reward tag. A player asking "why do I keep
   * getting the same sortie reward" has never had an answer; this is the number
   * that decides it, and watching it turns the question into a chart.
   */
  { name: 'sortie-pity', kind: 'keyed', read: (a) => keyed(a.SortieRewardAttenuation, (e) => e.Tag, (e) => e.Atten) },
  {
    name: 'vendor-pity',
    kind: 'keyed',
    read: (a) => keyed(a.SpecialItemRewardAttenuation, (e) => e.Tag, (e) => e.Atten),
  },

  // -- the Helminth, the lich, the crew ---------------------------------------
  { name: 'helminth-xp', kind: 'scalar', read: (a) => a.InfestedFoundry?.XP },
  { name: 'helminth-slots', kind: 'scalar', read: (a) => a.InfestedFoundry?.Slots },
  { name: 'helminth-invigorations', kind: 'scalar', read: (a) => a.InfestedFoundry?.InvigorationsApplied },
  { name: 'helminth-subsumed', kind: 'count', read: (a) => a.InfestedFoundry?.ConsumedSuits?.length },
  {
    name: 'helminth-secretion',
    kind: 'keyed',
    read: (a) => keyed(a.InfestedFoundry?.Resources, (r) => r.ItemType, (r) => r.Count),
  },
  { name: 'lich-thralls-killed', kind: 'scalar', read: (a) => a.Nemesis?.HenchmenKilled },
  { name: 'lich-hints', kind: 'scalar', read: (a) => a.Nemesis?.HintProgress },
  { name: 'lich-missions', kind: 'scalar', read: (a) => a.Nemesis?.MissionCount },
  { name: 'lich-rank', kind: 'scalar', read: (a) => a.Nemesis?.Rank },
  { name: 'lich-influence', kind: 'keyed', read: (a) => keyed(a.Nemesis?.InfNodes, (n) => n.Node, (n) => n.Influence) },
  { name: 'liches-resolved', kind: 'count', read: (a) => a.NemesisHistory?.length },
  { name: 'crew-affinity', kind: 'keyed', read: (a) => keyed(a.CrewMembers, (c) => oidOf(c.ItemId), (c) => c.XP) },

  // -- the foundry and the arsenal -------------------------------------------
  { name: 'foundry-queue', kind: 'count', read: (a) => a.PendingRecipes?.length },
  {
    name: 'research-credits-left',
    kind: 'keyed',
    read: (a) => keyed(a.PersonalTechProjects, (p) => p.ItemType, (p) => p.ReqCredits),
  },
  {
    // Owned, not mastered: a sold frame vanishes here and keeps its `XPInfo` row
    // forever, which is exactly why both are worth having.
    name: 'owned',
    kind: 'keyed',
    read: (a) => keyed(EQUIPMENT_KEYS, (k) => k, (k) => (at(a, k) as unknown[] | undefined)?.length),
  },
  {
    name: 'slots-extra',
    kind: 'keyed',
    read: (a) => keyed(SLOT_KEYS, (k) => k, (k) => (at(a, k) as SlotBin | undefined)?.Extra),
  },
  {
    /*
     * Forma applied per instance. Monotone, so a change here is always a real
     * act of investment.
     *
     * Its sibling `Equipment.XP` is deliberately NOT watched. That figure RESETS
     * TO ZERO on every Forma, so a watch would emit a large negative on the exact
     * occasion the player invested most, and anyone summing the series would read
     * it as affinity lost rather than spent. Mastery is already answered by
     * `mastery-xp`, which never resets.
     */
    name: 'forma',
    kind: 'keyed',
    read: (a) => keyed(allEquipment(a), (e) => oidOf(e.item.ItemId), (e) => e.item.Polarized),
  },

  // -- lifetime counts, where the length IS the number ------------------------
  { name: 'nodes-cleared', kind: 'count', read: (a) => a.Missions?.length },
  { name: 'alerts-done', kind: 'count', read: (a) => a.CompletedAlerts?.length },
  { name: 'sorties-done', kind: 'count', read: (a) => a.CompletedSorties?.length },
  { name: 'syndicate-missions', kind: 'count', read: (a) => a.CompletedSyndicates?.length },
  { name: 'login-milestones', kind: 'count', read: (a) => a.LoginMilestoneRewards?.length },
  { name: 'nightwave-acts', kind: 'count', read: (a) => a.SeasonChallengeHistory?.length },
  { name: 'cosmetics', kind: 'count', read: (a) => a.FlavourItems?.length },
  { name: 'weapon-skins', kind: 'count', read: (a) => a.WeaponSkins?.length },
  { name: 'death-marks', kind: 'count', read: (a) => a.DeathMarks?.length },
  { name: 'pending-trades', kind: 'count', read: (a) => a.PendingTrades?.length },
  { name: 'wishlist', kind: 'count', read: (a) => a.Wishlist?.length },
  { name: 'kubrow-eggs', kind: 'count', read: (a) => a.KubrowPetEggs?.length },
];

// ── diffing an account ───────────────────────────────────────────────────────

/**
 * A value, or null if it is not one.
 *
 * Every watch reads a field DE typed and the game populated, and the two do not
 * always agree: a gate feeding an account of nulls and wrong types found a
 * scalar handing back the string `'900'`. Without this the string reaches the
 * comparison, `from !== to` is true against the previous number, and a change
 * gets recorded whose `by` is `NaN`. NaN in an append-only store is permanent.
 */
function numeric(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function change(account: string, at: number, name: string, from: number, to: number): LedgerEvent {
  return { account, at, kind: 'counter', name, from, to, by: to - from };
}

/**
 * Every allowlisted counter that moved between two accounts.
 *
 * A key present in `after` and absent from `before` is SKIPPED, not read as a
 * change from zero — that is the same "absent is not zero" rule the mission
 * repair enforces, and here it is also what stops an app start from re-emitting
 * the player's entire mastery table as if they had just earned it.
 *
 * `before === null` therefore yields nothing at all. That is correct: with no
 * prior observation there is no change to report, and the opening state is
 * already on disk as a snapshot.
 */
export function diffAccount(
  before: RawAccount | null | undefined,
  after: RawAccount | null | undefined,
  at: number,
  account: string,
): LedgerEvent[] {
  if (!before || !after) return [];

  const out: LedgerEvent[] = [];
  for (const watch of WATCHES) {
    /*
     * EXHAUSTIVE ON PURPOSE. The keyed path used to be the implicit `else`, so a
     * newly added kind did not fail to compile - it fell into the keyed branch
     * and threw at runtime, inside the inventory handler, taking the recording
     * of every other field down with it. Naming every kind means the compiler
     * catches the next one instead.
     *
     * A `count` reads one number exactly as a `scalar` does; the kinds differ so
     * a reader can tell "how many of these exist" from "how much of this I have".
     */
    if (watch.kind === 'scalar' || watch.kind === 'count') {
      const from = numeric(watch.read(before));
      const to = numeric(watch.read(after));
      if (from !== null && to !== null && from !== to) {
        out.push(change(account, at, watch.name, from, to));
      }
      continue;
    }
    if (watch.kind !== 'keyed') {
      // Unreachable while the union is fully handled above; `never` is what
      // makes that a compile error rather than a silent skip.
      const missed: never = watch;
      void missed;
      continue;
    }
    const b = watch.read(before);
    const a = watch.read(after);
    /*
     * TRUNCATION IS HANDLED BY THE LOOP'S SHAPE, not by a guard, and a guard
     * here would be dead code wearing a safety label.
     *
     * A collection absent from `before` cannot produce an event, because every
     * `b.get` below returns undefined and a first sighting is skipped. A
     * collection absent from `after` cannot either, because only `after`'s keys
     * are walked. `diffInventory` needs its two explicit guards precisely
     * because it walks the union and treats a missing key as a real zero — the
     * right reading for a consumed stack, the wrong one for a partial dump.
     */
    for (const [key, raw] of a) {
      const to = numeric(raw);
      const from = numeric(b.get(key));
      if (to !== null && from !== null && from !== to) {
        out.push(change(account, at, `${watch.name}:${key}`, from, to));
      }
    }
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

// ── the log ──────────────────────────────────────────────────────────────────

function note(
  account: string,
  at: number,
  kind: LedgerKind,
  name: string,
  to: number | string | null = null,
  from: number | string | null = null,
): LedgerEvent {
  const by = typeof from === 'number' && typeof to === 'number' ? to - from : null;
  return { account, at, kind, name, from, to, by };
}

/**
 * Every parsed log event, as ledger events.
 *
 * The parser recognises seventeen kinds and the mission recorder branches on
 * three; the rest survive only in aggregate, if at all — `loadTime` collapses to
 * one number of its two, `squadMember` to a count, and every session-state
 * transition between `SS_STARTED` and `SS_ENDING` to nothing. So this is a total
 * mapping on purpose: the `default` case exists to be empty, and every event
 * type above it is a measurement the app now keeps at its own timestamp instead
 * of at the run's.
 *
 * `at` is wall-clock, supplied by the caller. The log's own `e.at` is seconds
 * since the game process started, which is not comparable across launches and
 * is meaningless once the game is closed — the tail is live, so the moment the
 * line is read is the honest timestamp for it.
 *
 * PRIVACY: `squadMember.name` is a third party and arrives null unless the user
 * opted into `captureSquadNames`. Recording what the parser hands over is what
 * that opt-in has always promised and never delivered — the names were captured,
 * carried on the run, and dropped at the record boundary.
 */
export function ledgerFromEvent(e: LogEvent, at: number, account: string): LedgerEvent[] {
  const it = (kind: LedgerKind, name: string, to?: number | string | null, from?: number | string | null) => [
    note(account, at, kind, name, to ?? null, from ?? null),
  ];

  switch (e.type) {
    // The username itself is not a value here: it is the `account` every row
    // already carries, and writing it twice would only make it deletable once.
    case 'login':
      return it('session', 'login');
    case 'sessionEnd':
      return it('session', 'session-end');
    /*
     * The gap between SS_WAITING_FOR_PLAYERS and SS_STARTED is matchmaking wait
     * — distinct from the level-load time below, and previously unmeasurable
     * because only two of these transitions were ever read.
     */
    case 'sessionState':
      return it('session', 'session-state', e.to, e.from);
    case 'hostSession':
      return e.success ? it('session', 'host', 'host') : [];
    // The cheapest orbiter-vs-mission discriminator there is, per the parser's
    // own comment, and nothing has ever read it.
    case 'gameRules':
      return it('mission', 'game-rules', e.rules);
    case 'missionStart':
      return it('mission', 'mission-start', e.node);
    case 'missionInfo':
      return it('mission', 'mission-planet', e.planet);
    case 'missionType':
      return it('mission', 'mission-type', e.missionType);
    case 'missionLoad':
      return it('mission', 'mission-location', e.location);
    case 'missionEnd':
      return it('mission', 'mission-end', e.success ? 'success' : 'failure');
    /*
     * Two series, not one. `Wall time: 2.2s (time waiting to start: 0.77s)` is
     * the engine splitting a load into the part that was loading and the part
     * that was waiting to be allowed to; the second number was parsed and then
     * read by nothing, which left a player troubleshooting slow loads one merged
     * figure and no way to tell which half was the problem.
     */
    case 'loadTime':
      return [
        note(account, at, 'mission', 'load-seconds', e.seconds),
        note(account, at, 'mission', 'load-waiting-seconds', e.waitingSeconds),
      ];
    case 'extraction':
      return it('mission', 'extraction', e.inTrigger ? 'in' : 'out');
    case 'syndicateXp':
      return it('counter', `syndicate-xp:${e.stage}`, e.amount);
    case 'squadSize':
      return it('squad', 'squad-size', e.players);
    // `squadCount` is the parser's own second witness for squad size, and the
    // switch case that receives it reads only the name and throws it away.
    case 'squadMember':
      return e.name === null
        ? it('squad', 'squad-count', e.squadCount)
        : [
            note(account, at, 'squad', 'squad-count', e.squadCount),
            note(account, at, 'squad', 'squad-member', e.name),
          ];
    /*
     * The two halves of loot attribution. `inventoryCommitted` is the game
     * saying it is pushing a run's changes; `inventoryDurable` is the server
     * confirming they are written. The interval between them, and between
     * either and the snapshot that actually arrives, is the attribution latency
     * that `lootAttributed` collapses to a boolean.
     */
    case 'inventoryCommitted':
      return it('mission', 'inventory-committed');
    case 'inventoryDurable':
      return it('mission', 'inventory-durable');
    /*
     * The daily tribute. Recorded as a SYSTEM event rather than a gain, because
     * what it records is not a thing acquired - it is the fact that the
     * inventory moved for a reason that has nothing to do with the run. Loot is
     * a snapshot diff and a diff cannot tell where items came from; this is the
     * one line in the log that can.
     */
    case 'dailyTribute':
      return it('system', 'daily-tribute');
    /*
     * The engine's own answer to the question the app computes from a vendored
     * catalogue. A systematic gap between the two means the catalogue lists
     * items this account cannot actually reach, and nothing else can detect it.
     */
    case 'masteryProgress':
      return it('counter', 'mastery-percent', e.percent);
    case 'masteryXp':
      return it('counter', 'mastery-xp-items', e.xp);
    case 'missionXp':
      return it('counter', 'mastery-xp-missions', e.xp);
    /*
     * What was carried in, per gear slot. Its worth is telling a SPEND from a
     * SALE: four ciphers fewer after a Spy run is consumption, and the same four
     * fewer outside a mission is a trade. The item deltas alone cannot separate
     * those, and have always filed both as `spend`.
     */
    case 'loadoutConsumable':
      return it('mission', `carried:${e.itemType}`, e.count);
    // The finest timing the log offers: 24 a session, so where the time went
    // between pressing go and playing is answerable phase by phase.
    case 'connectionState':
      return it('session', `connection:${e.edge}`, e.state);
    // The engine saying it fabricated the extraction flags. Kept so a reader can
    // tell "nobody extracted" from "there was nothing to extract from".
    case 'noExtractionZone':
      return it('mission', 'no-extraction-zone');
    /*
     * ── the arsenal ─────────────────────────────────────────────────────────
     * The modding screen, narrated by the game. `screen:UpgradeCards open` and
     * `closed` bracket every visit; `upgrade-slot` says which of the four the
     * visit was for; `mod:<path>` is every card placed or lifted, so a build can
     * be replayed from the ledger without the account ever being re-read.
     */
    case 'screen':
      return it('arsenal', `screen:${e.name}`, e.open ? 'open' : 'closed');
    case 'upgradeSlot':
      return it('arsenal', 'upgrade-slot', e.slot);
    case 'modInstalled':
      return it('arsenal', `mod:${e.itemType}`, e.installed ? 'installed' : 'removed');
    /*
     * NOT RECORDED. A duplicate-id warning naming a mod type the player holds
     * several of. The first version of this comment called it "a dump emitted
     * on every open"; the live log says otherwise - all thirty lines share one
     * timestamp 203 s after an open, in one visit of three. Either way it is
     * state, not a change, and the ledger records changes.
     */
    case 'modOwned':
      return [];
    // Visibility is a fact about the screen, not about the account.
    case 'hudVisible':
      return [];
    /*
     * The build dump. Slot polarities and the full mod list are STATE, and the
     * per-slot detail belongs to the overlay's live consumer; the ledger keeps
     * the two numbers that change a build's story - its capacity and how many
     * mods it carries - so a later reader can see when a Forma or a reactor
     * changed what fitted.
     */
    case 'buildSlots':
      return [];
    case 'buildCapacity':
      return it('arsenal', 'build-capacity', e.initial + (e.stanceBonus ?? 0));
    case 'buildMods':
      return [
        note(account, at, 'arsenal', 'build-mods', e.mods.length),
        note(account, at, 'arsenal', 'build-drain', e.mods.reduce((n, m) => n + m.drain, 0)),
      ];
    case 'buildDrain':
      return [];
    case 'loadoutSaved':
      return it('arsenal', 'loadout-saved');
    // Two series, because a reader asking "what has ranking mods cost me" wants
    // each currency on its own axis, not a pair welded into one row.
    case 'fusionCost':
      return [
        note(account, at, 'arsenal', 'fusion-endo', e.endo),
        note(account, at, 'arsenal', 'fusion-credits', e.credits),
      ];
    default:
      return [];
  }
}

/**
 * Item counts that moved, as `gain` and `spend` events.
 *
 * Fed from the account push rather than from a mission, deliberately: the same
 * seam sees a foundry claim, a purchase, a mod installed and a relic cracked,
 * none of which happen inside a mission bracket and none of which any record
 * has ever held.
 *
 * THREE CATEGORIES ARE EXCLUDED, because the watch table now carries them and
 * carries them better - with the balances either side, and continuously rather
 * than only inside a mission bracket.
 *
 * It started as one. `diffInventory` synthesises `@credits`/`@platinum`/`@endo`
 * so a run's loot list can mention them, and recording those here as well gave
 * every plat change two rows. Widening the watch table to the whole account
 * reintroduced exactly that bug for resources and blueprints - a live push
 * emitted `resource:.../Forma -1` twice - which is the same defect found the
 * same way, by watching a real push rather than by reading the code.
 *
 * `equipment` stays: it counts arsenal arrays by ItemType, which is a finer
 * grain than the `owned` watch's per-array totals, so it is not the same fact.
 * `mod` does NOT - `mod-stack` and `mod-owned` between them cover both halves of
 * a mod collection, with balances.
 */
const COVERED_BY_WATCHES = new Set(['currency', 'resource', 'blueprint', 'mod']);

export function ledgerFromItems(
  deltas: Array<{ itemType: string; count: number; category: string }>,
  at: number,
  account: string,
): LedgerEvent[] {
  return deltas.flatMap((d) =>
    COVERED_BY_WATCHES.has(d.category)
      ? []
      : [{
          account,
          at,
          kind: d.count > 0 ? ('gain' as const) : ('spend' as const),
          name: `${d.category}:${d.itemType}`,
          /*
           * `by` and not `to`: the diff knows how much moved, not what the
           * stack now holds. Writing the delta into `to` would read as an
           * absolute count to anyone plotting the series, which is the exact
           * aggregation-on-the-way-in this file exists to stop.
           */
          from: null,
          to: null,
          by: d.count,
        }],
  );
}
