/**
 * Mission history — every run the player completes, with what it dropped.
 *
 * Two independent signals, and neither one alone is enough:
 *
 *   EE.log  → WHEN and WHERE. Mission start, node id, mission type, squad size,
 *             outcome, timing. Live, ordered, and free.
 *   GEP     → WHAT. Full account inventory snapshots. The difference between the
 *             snapshot before a run and the one after it is the exact set of
 *             items gained, with quantities.
 *
 * WHY THE DIFF AND NOT THE LOG'S REWARD TEXT
 * ------------------------------------------
 * Because there is no reward text. `docs/research/eelog-mining.md` §4 grepped a
 * live log exhaustively: `GiveMissionRewards` carries a single boolean
 * (`success=true`) and nothing else. `MISSION_REWARD`, `NotifyTagMultiple`,
 * `DropTable`, `ResourceDrop`, `ItemPickup`, credit and relic award lines are all
 * *absent*. The only per-mission reward number the engine logs at all is
 * syndicate standing (§4.1).
 *
 * So inventory diffing is not "more reliable than parsing reward text" — it is
 * the only option, and it happens to also be ground truth: the inventory *is* the
 * account, not a description of it. It counts stacked resources exactly, it
 * catches everything the end-of-match screen only draws as an icon, and it cannot
 * drift out of sync with a game update that renames a reward string.
 *
 * The log's job is to say *when* to take the two snapshots so the delta is
 * attributable rather than approximate (§4.2):
 *
 *   1. latch `before` when gameplay starts — as late as possible, so the window
 *      is the mission and nothing else;
 *   2. wait for `EndOfMatch.lua: DbUpdateComplete` (`inventoryDurable`), NOT
 *      `CommitInventoryChangesToDB`, which is ~240 ms earlier with the write
 *      still in flight;
 *   3. take the next snapshot as `after`.
 *
 * The known ceiling: the diff is window-scoped, so anything else that mutates the
 * inventory inside the mission bracket (a foundry claim, a trade, the daily
 * tribute) lands in the same delta. A mission bracket is a couple of minutes, so
 * the window is about as tight as it can be made without a per-item event
 * stream, which the game does not give us.
 *
 * PRIVACY: nothing here touches a raw log line. Everything arrives as an already
 * parsed `LogEvent` from `src/core/eelog.ts`, which is an allowlist parser by
 * design. Never widen this module to take raw text.
 *
 * Pure functions throughout except `MissionRecorder`, which is a thin state
 * machine over `MissionTracker`. Persistence is deliberately somebody else's
 * problem.
 */

// The `.ts` on the value import is deliberate: it is the only runtime import in
// this module, and spelling it out lets `scripts/check-missionlog.ts` run under
// plain `node` without a resolver hook. Type-only imports are erased, so they
// keep the extensionless house style.
import type { LogEvent, MissionRun, SyndicateXp } from '../core/eelog';
import type { Equipment, RawAccount, TypeCount } from './account';
import { EQUIPMENT_KEYS, oidOf } from './account.ts';
import type { NodeEntry } from './vendor/types';

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

export type LootCategory = 'resource' | 'blueprint' | 'mod' | 'equipment' | 'currency';

/** One thing gained during a run. `count` is always positive — see `diffInventory`. */
export interface LootEntry {
  /** `/Lotus/...` uniqueName, or one of the `CREDITS`/`PLATINUM`/`ENDO` pseudo-types. */
  itemType: string;
  /** Best-effort display name derived from the path. No catalog lookup, no network. */
  name: string;
  count: number;
  category: LootCategory;
}

/** Credits, platinum and Endo are scalars on the account, so they get synthetic ids. */
export const CREDITS = '@credits';
export const PLATINUM = '@platinum';
export const ENDO = '@endo';

export type MissionOutcome = 'success' | 'failure' | 'abandoned';

/** One completed (or abandoned) run. */
export interface MissionRecord {
  /** Stable enough to key a list and to dedupe a replay. Not a database id. */
  id: string;

  // --- where ---------------------------------------------------------------
  /** `SolNode###` or a junction tag. Joins to the vendored star chart. */
  node: string | null;
  name: string | null;
  planet: string | null;
  /** DE's `MT_*` code. */
  missionType: string | null;
  /**
   * The chart's readable type ("Exterminate", "Free Roam"). A different
   * vocabulary from `missionType` above, so its own field.
   *
   * The example here used to read `Extermination`, which is not a word the
   * chart uses - and nine route timings were written against that spelling, so
   * none of them ever matched a run. An example in a comment is a claim about
   * the data like any other, and `check-plat.ts` now checks these ones.
   *
   * CONVENTION, because that check has to tell them apart: a mission type in
   * DOUBLE QUOTES is asserted to be real. A string being discussed rather than
   * claimed - a wrong spelling, a historical name - goes in backticks.
   */
  missionTypeName: string | null;
  /** Enemy faction, from the chart. The log never says. */
  faction: string | null;
  minLevel: number | null;
  maxLevel: number | null;
  /** Location the engine reported at load. Empty for places that have none (a dojo). */
  location: string | null;

  // --- when ----------------------------------------------------------------
  /** Epoch ms. Null when the log was joined after the mission had already begun. */
  startedAt: number | null;
  /**
   * Epoch ms, never null: the record is built the instant the run closes, so a
   * plain `Date.now()` stands in whenever the log's own timestamp anchor is
   * missing. Every consumer sorts and buckets on this, and a nullable "when"
   * would push a guard into all of them to save a value we always have.
   */
  endedAt: number;
  /** Gameplay time: start → outcome, excluding the end-of-match screen. */
  durationMs: number | null;
  /** Level load time in seconds. NOT mission time — the values are 2-4 s. */
  loadSeconds: number | null;

  // --- how it went ---------------------------------------------------------
  outcome: MissionOutcome;
  /** Null means unknown: there is no explicit "you are a client" line to match. */
  host: boolean | null;
  squadSize: number | null;
  /** Engine scaling factor from the host-loading line. 1 is normal; 0.375 occurs. */
  difficulty: number;
  /**
   * Null = unknown, always, for now. No line for hard mode has been confirmed in
   * a capture yet (research §9); the field exists so the day one is, nothing
   * downstream has to change shape.
   */
  steelPath: boolean | null;
  /** How many players were in the extraction trigger, of how many reported. */
  extraction: { inTrigger: number; total: number } | null;
  syndicateXp: SyndicateXp | null;
  /** True when the record is missing its start — joined mid-stream, or a crash. */
  partial: boolean;

  // --- what -----------------------------------------------------------------
  loot: LootEntry[];
  /** Total affinity earned across every equipped item, from the snapshot diff. */
  affinity: number | null;
  /**
   * False means "loot unknown", NOT "no loot". A run whose post-mission snapshot
   * never arrived must be excluded from drop-rate denominators, or it reads as a
   * confirmed zero and quietly halves every rate on the node.
   */
  lootAttributed: boolean;
}

// ---------------------------------------------------------------------------
// Star-chart join
// ---------------------------------------------------------------------------

/**
 * Index the vendored nodes by id.
 *
 * Two ids are shared by two entries each in the source data ("ToggleBootLevel",
 * "SolNode236" — see `nodes.json` sourceNote), so keying must tolerate a
 * collision. First entry wins; both members of each colliding pair are edgeless
 * non-missions, so the choice is immaterial.
 */
export function nodeIndex(nodes: Iterable<NodeEntry>): ReadonlyMap<string, NodeEntry> {
  const map = new Map<string, NodeEntry>();
  for (const n of nodes) if (n?.id && !map.has(n.id)) map.set(n.id, n);
  return map;
}

/**
 * Turn an assembled run into a record, joined to the star chart.
 *
 * The log's own name and planet win over the chart's — they are what the player
 * just saw on screen. The chart is the only source for faction and level range.
 */
export function toRecord(
  run: MissionRun,
  nodes: ReadonlyMap<string, NodeEntry>,
  now: number = Date.now(),
): MissionRecord {
  const chart = run.node == null ? undefined : nodes.get(run.node);
  const durationMs = run.durationSeconds == null ? null : Math.round(run.durationSeconds * 1000);
  // The log's anchor is more precise, but this runs microseconds after the run
  // ended, so the clock is a sound fallback rather than an invented value.
  const endedAt = run.endedAtMs ?? now;
  const startedAt = run.endedAtMs == null || durationMs == null ? null : run.endedAtMs - durationMs;

  return {
    id: `${run.node ?? 'unknown'}@${startedAt ?? endedAt}`,
    node: run.node,
    name: run.name ?? chart?.name ?? null,
    planet: run.planet ?? chart?.planet ?? null,
    missionType: run.missionType,
    missionTypeName: chart?.type ?? null,
    faction: chart?.enemy ?? null,
    minLevel: chart?.minLevel ?? null,
    maxLevel: chart?.maxLevel ?? null,
    location: run.location,
    startedAt,
    endedAt,
    durationMs,
    loadSeconds: run.loadSeconds,
    outcome: run.aborted ? 'abandoned' : run.success ? 'success' : 'failure',
    host: run.isHost,
    squadSize: run.squadSize,
    difficulty: run.difficulty,
    steelPath: null,
    extraction: run.extraction,
    syndicateXp: run.syndicateXp,
    partial: startedAt == null,
    loot: [],
    affinity: null,
    lootAttributed: false,
  };
}

/**
 * Repair a record read back from storage, so every key this interface declares
 * is actually present on the object.
 *
 * WHY THIS EXISTS, AND WHY THE TYPE SYSTEM CANNOT REPLACE IT
 * ─────────────────────────────────────────────────────────
 * `MissionRecord` grows. Every field below was added in some build, and the
 * runs a player stored before that build do not carry it — IndexedDB hands back
 * the object it was given, with the key simply ABSENT, not null. So a field
 * declared `number | null` arrives as `undefined`, `=== null` misses it, and
 * `.something` on it throws.
 *
 * That is not hypothetical. `syndicateXp` was added after this file shipped,
 * two consumers guarded it with `=== null`, and reading a real history from
 * disk rendered a blank page. Nothing caught it: every fixture in every gate
 * CONSTRUCTED the field, so the whole suite was testing a shape that storage
 * never produces. TypeScript cannot help here at all — `StoredMission` is an
 * assertion about bytes on a disk written by a program that no longer exists.
 *
 * The second entry point is worse: `importJson` takes a file the user picked,
 * validates two keys, and spreads the rest. A hand-trimmed export is a
 * MissionRecord as far as the compiler is concerned.
 *
 * One repair at the read boundary beats a guard in every consumer, and it means
 * a field added below is handled by editing this function in the same commit
 * rather than by finding every reader of it later.
 *
 * ABSENT IS FILLED WITH THE FIELD'S OWN ABSENT VALUE, NEVER WITH A GUESS. Every
 * nullable field becomes `null`, which is what it means when unmeasured. `loot`
 * becomes the documented unknown pair — an empty list with `lootAttributed`
 * false, which reads as "we do not know what dropped", not "nothing dropped".
 *
 * THREE FIELDS CANNOT BE REPAIRED, because the interface gives them no absent
 * state to fall back to:
 *  - `endedAt` and `outcome` are written unconditionally by every version of
 *    `toRecord` that has ever run, so a row lacking either is corrupt rather
 *    than old. Such a row is DROPPED (null return) — it has no place on a
 *    timeline and could not be counted as a success or a failure anyway.
 *  - `difficulty` falls back to 1 because that is already this codebase's own
 *    default for it (`eelog.ts` closes a run with `?? 1`), so it is a value the
 *    program has always written rather than one invented here.
 *  - `partial` defaults TRUE, the cautious direction: a record old enough to be
 *    missing fields is exactly one whose completeness we cannot vouch for.
 */
export function hydrateRecord(row: unknown): MissionRecord | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;

  if (typeof r['endedAt'] !== 'number' || !Number.isFinite(r['endedAt'])) return null;
  const outcome = r['outcome'];
  if (outcome !== 'success' && outcome !== 'failure' && outcome !== 'abandoned') return null;

  // `??` and not `||`, throughout: a measured 0 duration, 0 squad, `false` host
  // or empty-string name is a reading, and must survive the repair intact.
  const opt = <T,>(key: string): T | null => (r[key] ?? null) as T | null;

  return {
    id: typeof r['id'] === 'string' ? r['id'] : '',
    node: opt<string>('node'),
    name: opt<string>('name'),
    planet: opt<string>('planet'),
    missionType: opt<string>('missionType'),
    missionTypeName: opt<string>('missionTypeName'),
    faction: opt<string>('faction'),
    minLevel: opt<number>('minLevel'),
    maxLevel: opt<number>('maxLevel'),
    location: opt<string>('location'),
    startedAt: opt<number>('startedAt'),
    endedAt: r['endedAt'],
    durationMs: opt<number>('durationMs'),
    loadSeconds: opt<number>('loadSeconds'),
    outcome,
    host: opt<boolean>('host'),
    squadSize: opt<number>('squadSize'),
    difficulty: typeof r['difficulty'] === 'number' ? r['difficulty'] : 1,
    steelPath: opt<boolean>('steelPath'),
    extraction: opt<MissionRecord['extraction']>('extraction'),
    syndicateXp: opt<SyndicateXp>('syndicateXp'),
    partial: typeof r['partial'] === 'boolean' ? r['partial'] : true,
    loot: Array.isArray(r['loot']) ? (r['loot'] as LootEntry[]) : [],
    affinity: opt<number>('affinity'),
    // A row whose loot array did not survive has unknown loot, not zero loot.
    lootAttributed: r['lootAttributed'] === true && Array.isArray(r['loot']),
  };
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

/**
 * How long to wait for the post-mission inventory snapshot before closing the
 * record with `lootAttributed: false`.
 *
 * GEP pushes when the game decides to, not when we ask, so this is generous
 * against the ~240 ms the engine itself needs.
 */
const LOOT_GRACE_MS = 30_000;

/**
 * How long after the outcome a snapshot must be taken to count as the `after`
 * side when the engine never said `DbUpdateComplete` — an abort, or a log joined
 * mid-run.
 *
 * The engine's own gap between the outcome and the durable write is ~240 ms, and
 * GEP does push periodic dumps, so a snapshot landing inside that gap would be
 * pre-loot and would report the run as having dropped nothing.
 */
const DURABLE_SETTLE_MS = 2_000;

/** Gameplay has begun — the moment to latch the `before` snapshot. */
function isMissionStart(e: LogEvent): boolean {
  return e.type === 'missionType' || (e.type === 'sessionState' && e.to === 'SS_STARTED');
}

/**
 * Assembles mission records and owns the snapshot latching that makes loot
 * attribution correct.
 *
 * It wires straight onto `tailEeLog`, whose three signals map one-to-one:
 *
 *   onEvent  → `observeEvent(event)`      every parsed log event, in order
 *   onRun    → `observeRun(run)`          an assembled run
 *   GEP      → `observeInventory(inv,at)` every inventory that actually changed
 *
 * Any of the three may return a finished record.
 *
 * The run itself is assembled by `MissionTracker` in `core/eelog.ts`, which
 * already owns the log state machine: it opens on the first mission line,
 * accumulates, and closes on the outcome — or, with no outcome, on
 * `SS_ENDING`/`sessionEnd`, since the log contains no abort line whatsoever
 * (research §2.3). Running a second copy of that machine here would be two
 * things to keep in step; this class adds only what the tracker cannot know: the
 * star chart, and the two inventory snapshots that bracket the run.
 *
 * Robustness, and where each case is actually handled:
 *
 *   - abandoned with no outcome → `MissionTracker` infers it structurally and
 *     emits `aborted: true`; the record closes as `abandoned`.
 *   - host migration mid-mission → produces no parsed events at all, so the run
 *     simply continues. This is deliberate: `FinalizeHostMigration` fires on
 *     every level init with a zero agent count and is not a migration signal
 *     (research §2.3). Losing the host outright tears the session down, which
 *     arrives as the abort path above.
 *   - two missions in quick succession → a second run finishing while the first
 *     is still waiting for its snapshot flushes the first, unattributed, rather
 *     than mixing the two windows.
 *   - joined mid-stream → the run has no `SS_STARTED`, so it has no start time
 *     and no `before` snapshot; the record closes `partial: true` and
 *     `lootAttributed: false`, which keeps it out of every rate denominator.
 */
export class MissionRecorder {
  private readonly nodes: ReadonlyMap<string, NodeEntry>;
  private readonly now: () => number;

  /** Snapshot latched when gameplay started. The `before` side of the diff. */
  private before: RawAccount | null = null;
  private latched = false;
  private latest: RawAccount | null = null;
  private latestAt = 0;
  /** When the engine said the run's inventory changes were durable server-side. */
  private durableAt: number | null = null;
  /**
   * A closed run still waiting for its `after` snapshot, carrying its own
   * `before` — the next mission can start latching a new one before this record
   * has closed, and the two must not be the same slot.
   */
  private awaiting: { rec: MissionRecord; before: RawAccount | null } | null = null;

  /** `now` is injectable so the grace timeout is testable without a real clock. */
  constructor(nodes: Iterable<NodeEntry> = [], now: () => number = Date.now) {
    this.nodes = nodeIndex(nodes);
    this.now = now;
  }

  /** The run currently waiting on its post-mission snapshot, if any. */
  get pending(): MissionRecord | null {
    return this.awaiting?.rec ?? null;
  }

  /**
   * Feed one parsed log event. Returns a finished record when a stale one times
   * out, and when a new mission start closes the one before it.
   */
  observeEvent(e: LogEvent): MissionRecord | null {
    // Latch once per run: `OnStateStarted` and `SS_STARTED` both mean the same
    // thing and either may come first, so the first one wins.
    let closed: MissionRecord | null = null;
    if (!this.latched && isMissionStart(e)) {
      /*
       * A MISSION START IS THE END OF THE PREVIOUS RUN'S LOOT WINDOW.
       *
       * This is the last instant at which the newest snapshot is unambiguously
       * the EARLIER run's: a moment later the player is in a new mission and
       * anything that arrives can carry its pickups. Closing here is what keeps
       * two runs from sharing a snapshot, and it is strictly better than
       * waiting - the alternatives were a later snapshot closing the earlier
       * run with some of this run's loot in it, or the thirty-second grace
       * expiring and the earlier run's real loot being thrown away.
       *
       * `durableAt` is cleared FIRST, and the order is the whole point. It
       * belongs to the run that just ended and can sit well past that run's own
       * settle window on a slow write; clearing it drops the cutoff back to the
       * run's end plus the settle, which is what lets a snapshot that arrived
       * in between count for the run it actually belongs to.
       */
      this.durableAt = null;
      closed = this.flush();
      this.before = this.latest;
      this.latched = true;
    }

    // The write is durable; the next GEP dump will contain the run's items.
    if (e.type === 'inventoryDurable') this.durableAt = this.now();

    return closed ?? this.flushIfStale();
  }

  /** Feed an assembled run. Returns a record as soon as its loot is known. */
  observeRun(run: MissionRun): MissionRecord | null {
    /*
     * A previous run still awaiting a snapshot should already have been closed
     * at the mission start above, which is where its window really ends. This
     * is the belt to that braces: a run emitted with no start line in between -
     * a log that lost its `SS_STARTED` - still gets closed rather than dropped.
     */
    const out = this.flush();
    this.awaiting = { rec: toRecord(run, this.nodes, this.now()), before: this.before };
    this.before = null;
    this.latched = false;
    return out ?? this.close();
  }

  /**
   * A new inventory arrived. Returns the finished record if this snapshot is the
   * `after` side of a run that has already closed.
   *
   * The snapshot is only ever stored, never latched as `before` here — `before`
   * is taken at mission start and nowhere else, which is what keeps the
   * attribution window equal to the mission.
   */
  observeInventory(inv: RawAccount, atMs: number = this.now()): MissionRecord | null {
    this.latest = inv;
    this.latestAt = atMs;
    return this.close() ?? this.flushIfStale();
  }

  /** Close the pending record now, whether or not its loot could be attributed. */
  flush(): MissionRecord | null {
    const a = this.awaiting;
    if (!a) return null;
    this.awaiting = null;
    return this.usableSnapshot(a.rec) ? attributeLoot(a.rec, a.before, this.latest) : a.rec;
  }

  /** Close only when a usable `after` snapshot is actually in hand. */
  private close(): MissionRecord | null {
    const a = this.awaiting;
    if (!a) return null;
    // With no `before` there is nothing a later snapshot could be diffed
    // against, so waiting for one would only delay the record. This is the
    // joined-mid-stream case: the run began before the app was watching.
    if (a.before != null && !this.usableSnapshot(a.rec)) return null;
    return this.flush();
  }

  /**
   * Is the newest snapshot late enough to contain this run's loot?
   *
   * `durableAt` is preferred but sanity-checked against the run's own end: it is
   * an instance field, so a value left over from an earlier run would be too
   * early, and too early is exactly the failure that reports an empty run.
   */
  private usableSnapshot(rec: MissionRecord): boolean {
    if (this.latest == null) return false;
    const cutoff =
      this.durableAt != null && this.durableAt >= rec.endedAt
        ? this.durableAt
        : rec.endedAt + DURABLE_SETTLE_MS;
    return this.latestAt >= cutoff;
  }

  private flushIfStale(): MissionRecord | null {
    const end = this.awaiting?.rec.endedAt;
    return end !== undefined && this.now() - end > LOOT_GRACE_MS ? this.flush() : null;
  }
}

// ---------------------------------------------------------------------------
// Inventory diffing — the WHAT
// ---------------------------------------------------------------------------

/**
 * Every count that MOVED between two account snapshots, in either direction.
 *
 * Everything is compared as a count per ItemType, the arsenal arrays and the
 * individually-tracked `Upgrades` included. Comparing instance ids instead would
 * report "1 Braton gained" when the player sold one and earned another inside
 * the window; the net count is the honest answer and it costs less code.
 *
 * ABSENT IS NOT ZERO, and it has to be checked on both sides. A category missing
 * entirely from `before` would report the player's whole mod collection as this
 * run's loot; missing entirely from `after` would report it as this run's spend.
 * Both are the same truncated GEP dump, and both guards are needed the moment
 * losses are reported at all. An item missing from a category that IS present is
 * a genuine zero — a stack consumed to nothing really does leave `MiscItems`.
 */
export function deltaInventory(
  before: RawAccount | null | undefined,
  after: RawAccount | null | undefined,
): LootEntry[] {
  if (!before || !after) return [];

  const buckets: Array<[LootCategory, Map<string, number>, Map<string, number>]> = [
    ['resource', typeCounts(before.MiscItems), typeCounts(after.MiscItems)],
    ['blueprint', typeCounts(before.Recipes), typeCounts(after.Recipes)],
    ['mod', modCounts(before), modCounts(after)],
    ['equipment', equipmentCounts(before), equipmentCounts(after)],
    ['currency', currencies(before), currencies(after)],
  ];

  const out: LootEntry[] = [];
  for (const [category, b, a] of buckets) {
    if (b.size === 0 && a.size > 0) continue; // absent, not emptied
    if (a.size === 0 && b.size > 0) continue; // absent, not spent
    for (const itemType of new Set([...b.keys(), ...a.keys()])) {
      const delta = (a.get(itemType) ?? 0) - (b.get(itemType) ?? 0);
      if (delta !== 0) out.push({ itemType, name: displayName(itemType), count: delta, category });
    }
  }

  // Deterministic order, so two equal diffs compare equal in a test and the UI
  // does not reshuffle between renders.
  return out.sort((x, y) => x.category.localeCompare(y.category) || x.name.localeCompare(y.name));
}

/**
 * Items GAINED between two snapshots — a run's loot.
 *
 * A loot list containing `-3 Cipher` is noise, so the record keeps only the
 * positive half. The other half is not thrown away any more: `src/data/ledger.ts`
 * records it as `spend` events, which is how the forma, the relic and the
 * revives a run consumed stop being invisible.
 */
export function diffInventory(
  before: RawAccount | null | undefined,
  after: RawAccount | null | undefined,
): LootEntry[] {
  return deltaInventory(before, after).filter((e) => e.count > 0);
}

/**
 * Affinity earned across the whole loadout.
 *
 * Per-instance `XP`, not the `XPInfo` mastery ledger: that ledger stops counting
 * once an item is maxed, so a veteran's affinity-per-hour would read zero. Newly
 * acquired items count in full — a weapon picked up mid-run earned its affinity
 * in that run.
 */
export function affinityGained(
  before: RawAccount | null | undefined,
  after: RawAccount | null | undefined,
): number | null {
  if (!before || !after) return null;
  const b = xpByInstance(before);
  const a = xpByInstance(after);
  if (b.size === 0) return null; // absent, not zero
  let total = 0;
  for (const [id, xp] of a) {
    const gained = xp - (b.get(id) ?? 0);
    if (gained > 0) total += gained;
  }
  return total;
}

/**
 * Assign a snapshot diff to a record. Pure — returns a new record.
 *
 * `before` is the snapshot latched at mission start, `after` the first one taken
 * once `DbUpdateComplete` says the changes are durable. `MissionRecorder` does
 * that latching; this is exported separately so a stored history can be
 * re-attributed from stored snapshots without replaying the log.
 */
export function attributeLoot(
  record: MissionRecord,
  before: RawAccount | null | undefined,
  after: RawAccount | null | undefined,
): MissionRecord {
  if (!before || !after) return { ...record, loot: [], affinity: null, lootAttributed: false };
  return {
    ...record,
    loot: diffInventory(before, after),
    affinity: affinityGained(before, after),
    lootAttributed: true,
  };
}

/** Quantity of one item in a record's loot. */
export function lootCount(record: MissionRecord, itemType: string): number {
  let n = 0;
  for (const l of record.loot) if (l.itemType === itemType) n += l.count;
  return n;
}

// -- diff helpers -----------------------------------------------------------

/** Sums duplicates: DE has been seen to split a stack across two rows. */
function typeCounts(list: readonly TypeCount[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of list ?? []) {
    if (!e?.ItemType) continue;
    m.set(e.ItemType, (m.get(e.ItemType) ?? 0) + (e.ItemCount ?? 0));
  }
  return m;
}

/**
 * Rank-0 mods are stacked in `RawUpgrades`; ranked mods, rivens and arcanes are
 * individual instances in `Upgrades`. A mod lives in exactly one of the two, so
 * summing them cannot double-count.
 */
function modCounts(acc: RawAccount): Map<string, number> {
  const m = typeCounts(acc.RawUpgrades);
  for (const u of acc.Upgrades ?? []) {
    if (!u?.ItemType) continue;
    m.set(u.ItemType, (m.get(u.ItemType) ?? 0) + 1);
  }
  return m;
}

function equipmentCounts(acc: RawAccount): Map<string, number> {
  const m = new Map<string, number>();
  for (const key of EQUIPMENT_KEYS) {
    for (const item of (acc[key] as Equipment[] | undefined) ?? []) {
      if (!item?.ItemType) continue;
      m.set(item.ItemType, (m.get(item.ItemType) ?? 0) + 1);
    }
  }
  return m;
}

/**
 * Platinum is here for completeness, not because missions drop it — a non-zero
 * platinum delta means a purchase or a trade landed inside the attribution
 * window, which is exactly the kind of contamination worth being able to see.
 */
function currencies(acc: RawAccount): Map<string, number> {
  const m = new Map<string, number>();
  if (typeof acc.RegularCredits === 'number') m.set(CREDITS, acc.RegularCredits);
  if (typeof acc.PremiumCredits === 'number') m.set(PLATINUM, acc.PremiumCredits);
  if (typeof acc.FusionPoints === 'number') m.set(ENDO, acc.FusionPoints);
  return m;
}

function xpByInstance(acc: RawAccount): Map<string, number> {
  const m = new Map<string, number>();
  for (const key of EQUIPMENT_KEYS) {
    for (const item of (acc[key] as Equipment[] | undefined) ?? []) {
      const id = oidOf(item?.ItemId);
      if (id) m.set(id, item.XP ?? 0);
    }
  }
  return m;
}

const CURRENCY_NAMES: Readonly<Record<string, string>> = {
  [CREDITS]: 'Credits',
  [PLATINUM]: 'Platinum',
  [ENDO]: 'Endo',
};

/**
 * Display name from a uniqueName, with no catalog and no network.
 *
 * ponytail: last path segment, camelCase split. Wrong for the handful of items
 * whose internal name is historical (`PrimeBucks` is Ducats, `SchismKey` is
 * Aya). Join to `itemdb.ts` in the UI layer if exact names ever matter.
 */
function displayName(itemType: string): string {
  const known = CURRENCY_NAMES[itemType];
  if (known) return known;
  const last = itemType.split('/').pop() ?? itemType;
  return last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
}

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

export interface LootTotal {
  itemType: string;
  name: string;
  category: LootCategory;
  /** Total quantity gained. */
  count: number;
  /** Number of runs that yielded at least one. */
  runs: number;
}

export interface GroupStats {
  key: string;
  runs: number;
  successes: number;
  failures: number;
  abandoned: number;
  /** Runs with a usable inventory diff — the only honest drop-rate denominator. */
  attributed: number;
  /** Summed gameplay time of the runs that have one. */
  durationMs: number;
  credits: number;
  affinity: number;
  creditsPerHour: number | null;
  affinityPerHour: number | null;
  loot: LootTotal[];
}

/**
 * Group runs by any key. `byNode`, `byMissionType` and `byPlanet` are this with a
 * different selector.
 *
 * A record whose key is null is skipped rather than bucketed under "unknown", so
 * a mid-stream partial cannot dilute a real node's numbers.
 */
export function groupRuns(
  records: readonly MissionRecord[],
  keyOf: (r: MissionRecord) => string | null,
): GroupStats[] {
  const groups = new Map<string, MissionRecord[]>();
  for (const r of records) {
    const k = keyOf(r);
    if (k == null) continue;
    const bucket = groups.get(k);
    if (bucket) bucket.push(r);
    else groups.set(k, [r]);
  }
  return [...groups].map(([key, rs]) => statsFor(key, rs)).sort((a, b) => b.runs - a.runs);
}

export const byNode = (records: readonly MissionRecord[]): GroupStats[] => groupRuns(records, (r) => r.node);
export const byMissionType = (records: readonly MissionRecord[]): GroupStats[] =>
  groupRuns(records, (r) => r.missionType);
export const byPlanet = (records: readonly MissionRecord[]): GroupStats[] => groupRuns(records, (r) => r.planet);

/** Everything as one group — credits and affinity per hour across the whole history. */
export function overall(records: readonly MissionRecord[]): GroupStats {
  return statsFor('all', records);
}

export interface DropRate extends LootTotal {
  /** Fraction of attributed runs that yielded this item, 0..1. */
  rate: number;
  /** Average quantity per attributed run, counting the runs that yielded none. */
  perRun: number;
}

/**
 * The player's own drop table for one node.
 *
 * The denominator is attributed runs only. An unattributed run's loot is
 * *unknown*, and counting it as a miss would understate every rate on the node.
 */
export function dropRates(records: readonly MissionRecord[], node: string): DropRate[] {
  const runs = records.filter((r) => r.node === node && r.lootAttributed);
  return mergeLoot(runs)
    .map((t) => ({ ...t, rate: t.runs / runs.length, perRun: t.count / runs.length }))
    .sort((a, b) => b.rate - a.rate || b.count - a.count);
}

export interface FarmSpot {
  node: string;
  name: string | null;
  planet: string | null;
  runs: number;
  /** Runs that yielded at least one. */
  drops: number;
  rate: number;
  perRun: number;
  /** Expected quantity per hour of actual mission time. Null without timings. */
  perHour: number | null;
}

/**
 * Where this player actually gets an item, ranked — computed from their own
 * history.
 *
 * This beats a global drop table because it already accounts for how fast *they*
 * clear the node, what their boosters were, and whether they bother to open the
 * containers. A published 11.06% table cannot tell you that.
 *
 * ponytail: raw observed rate with a `minRuns` floor, no confidence interval. A
 * one-of-one fluke is excluded by the floor rather than by shrinkage; swap in a
 * Wilson lower bound if the table starts recommending noise.
 */
export function bestNodesFor(records: readonly MissionRecord[], itemType: string, minRuns = 3): FarmSpot[] {
  const byNodeId = new Map<string, MissionRecord[]>();
  for (const r of records) {
    if (r.node == null || !r.lootAttributed) continue;
    const bucket = byNodeId.get(r.node);
    if (bucket) bucket.push(r);
    else byNodeId.set(r.node, [r]);
  }

  const spots: FarmSpot[] = [];
  for (const [node, rs] of byNodeId) {
    if (rs.length < minRuns) continue;
    let count = 0;
    let drops = 0;
    for (const r of rs) {
      const n = lootCount(r, itemType);
      count += n;
      if (n > 0) drops++;
    }
    if (drops === 0) continue;
    const ms = totalDuration(rs);
    spots.push({
      node,
      name: rs[0]?.name ?? null,
      planet: rs[0]?.planet ?? null,
      runs: rs.length,
      drops,
      rate: drops / rs.length,
      perRun: count / rs.length,
      perHour: perHour(count, ms),
    });
  }

  return spots.sort((a, b) => (b.perHour ?? 0) - (a.perHour ?? 0) || b.perRun - a.perRun);
}

// -- aggregation helpers ----------------------------------------------------

function statsFor(key: string, rs: readonly MissionRecord[]): GroupStats {
  let successes = 0;
  let failures = 0;
  let abandoned = 0;
  let attributed = 0;
  let credits = 0;
  let affinity = 0;
  for (const r of rs) {
    if (r.outcome === 'success') successes++;
    else if (r.outcome === 'failure') failures++;
    else abandoned++;
    if (r.lootAttributed) attributed++;
    credits += lootCount(r, CREDITS);
    affinity += r.affinity ?? 0;
  }
  const durationMs = totalDuration(rs);
  return {
    key,
    runs: rs.length,
    successes,
    failures,
    abandoned,
    attributed,
    durationMs,
    credits,
    affinity,
    creditsPerHour: perHour(credits, durationMs),
    affinityPerHour: perHour(affinity, durationMs),
    loot: mergeLoot(rs),
  };
}

/** Only runs with a measured duration — a null must not read as zero elapsed time. */
function totalDuration(rs: readonly MissionRecord[]): number {
  let ms = 0;
  for (const r of rs) if (r.durationMs != null && r.durationMs > 0) ms += r.durationMs;
  return ms;
}

function perHour(total: number, ms: number): number | null {
  return ms > 0 ? (total * 3_600_000) / ms : null;
}

function mergeLoot(rs: readonly MissionRecord[]): LootTotal[] {
  const totals = new Map<string, LootTotal>();
  for (const r of rs) {
    const seen = new Set<string>();
    for (const l of r.loot) {
      const t = totals.get(l.itemType);
      if (t) t.count += l.count;
      else totals.set(l.itemType, { ...l, runs: 0 });
      seen.add(l.itemType);
    }
    // Incremented once per run rather than once per entry, so `runs` stays a
    // count of runs even if a diff ever yields two rows for one ItemType.
    for (const itemType of seen) {
      const t = totals.get(itemType);
      if (t) t.runs++;
    }
  }
  return [...totals.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
