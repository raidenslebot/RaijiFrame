/**
 * Durable mission history.
 *
 * A mission log is only worth keeping if it survives a restart and keeps
 * accumulating for months — tens of thousands of runs. localStorage is the wrong
 * tool for that (5 MB, synchronous, string-only), so records live in IndexedDB
 * with indexes on the three fields every query filters by.
 *
 * No wrapper library: the surface actually needed here is open / add / cursor /
 * count / clear, which is about forty lines of promise plumbing. A dependency
 * would be larger than the code it replaces.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEGRADED MODE — the reason this file is more than a thin wrapper.
 *
 * The browser can refuse IndexedDB outright (private windows, blocked storage)
 * or refuse a single write (quota). Either way the session's missions must not
 * vanish and nothing here may throw into the caller: on failure records go to an
 * in-memory array, `historyStatus().durable` flips to false, and reads keep
 * serving both stores merged. The UI surfaces the flag so the user knows the run
 * they just finished is not on disk yet.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PRIVACY: nothing here comes from a raw EE.log line. `missionlog` builds
 * MissionRecord from the allowlisted events in `core/eelog.ts`; this module only
 * stores what it is handed. Never add a "raw line" field.
 */

import { hydrateRecord, type MissionRecord } from './missionlog.ts';
import { LEDGER_KINDS, type LedgerEvent, type LedgerKind } from './ledger.ts';

const DB_NAME = 'raijiframe-history';
const STORE = 'missions';
/**
 * The account ledger — see `ledger.ts` for what an event is and why first
 * sightings are not among them. A second store rather than a second database:
 * one migration, one degraded-mode path, and a wipe that cannot half-succeed.
 */
const LEDGER = 'ledger';

/**
 * Bump when the schema changes, and add a matching `if (oldVersion < n)` block
 * to `migrate`. Migrations are additive by rule — never delete and recreate the
 * store, because that silently throws away months of the user's history.
 */
export const DB_VERSION = 2;

/** A record as stored: whatever missionlog produced, plus our primary key. */
export type StoredMission = Omit<MissionRecord, 'id'> & { id: string };

export interface HistoryStatus {
  /** False once anything has fallen back to memory. Surface this in the UI. */
  durable: boolean;
  /** Machine-readable cause, for a tooltip. Null while healthy. */
  reason: string | null;
  /** Records held only in memory — lost on reload. */
  pending: number;
  /** Ledger events held only in memory — lost on reload. */
  pendingLedger: number;
}

export interface HistoryTotals {
  missions: number;
  successes: number;
  /** Summed gameplay time across records that report one. */
  durationSeconds: number;
  firstAt: number | null;
  lastAt: number | null;
  byMissionType: Record<string, number>;
  byNode: Record<string, number>;
  /** Item id → total quantity gained, rolled up from every record's loot. */
  loot: Record<string, number>;
}

export interface HistoryExport {
  format: 'raijiframe-mission-history';
  version: number;
  exportedAt: number;
  missions: StoredMission[];
  /**
   * Absent in a file written before the ledger existed. An importer must read
   * that as "this backup does not carry one", never as an empty ledger — the
   * distinction is the difference between restoring a user's history and
   * quietly telling them they have none.
   */
  ledger?: LedgerEvent[];
}

export interface ImportResult {
  imported: number;
  /** Ledger events restored. Zero for a backup written before they existed. */
  importedLedger: number;
  /** Already present (same id), or not shaped like a mission. */
  skipped: number;
  error: string | null;
}

// ── degraded-mode state ──────────────────────────────────────────────────────

const memory: StoredMission[] = [];
/**
 * Ledger events that could not reach disk. Same contract as `memory` above: a
 * private window or a quota refusal must not make the ledger silently stop
 * recording while the UI goes on implying it did.
 */
const memoryLedger: LedgerEvent[] = [];
let durable = true;
let reason: string | null = null;

function degrade(why: string, err?: unknown): null {
  if (durable) console.warn(`[history] falling back to memory: ${why}`, err ?? '');
  durable = false;
  reason = why;
  return null;
}

export function historyStatus(): HistoryStatus {
  return { durable, reason, pending: memory.length, pendingLedger: memoryLedger.length };
}

// ── the IndexedDB wrapper ────────────────────────────────────────────────────

type IndexName = 'endedAt' | 'node' | 'missionType';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function migrate(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    const store = db.createObjectStore(STORE, { keyPath: 'id' });
    // Without these, every stats query is a full scan of the entire history.
    store.createIndex('endedAt', 'endedAt');
    store.createIndex('node', 'node');
    store.createIndex('missionType', 'missionType');
  }
  if (oldVersion < 2) {
    /*
     * Out-of-line auto-incrementing keys: a ledger event has no natural id, and
     * the sequence number is exactly the tiebreak wanted when two events share
     * a millisecond. The key is attached as `seq` when a row is read.
     */
    const store = db.createObjectStore(LEDGER, { autoIncrement: true });
    store.createIndex('at', 'at');
    store.createIndex('kind', 'kind');
    store.createIndex('name', 'name');
    store.createIndex('account', 'account');
  }
  // Future: `if (oldVersion < 3) { ... }`. Add, never recreate.
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(degrade('indexeddb-unavailable'));

    let req: IDBOpenDBRequest;
    try {
      // Some browsers throw synchronously here (private mode) rather than firing
      // an error event, so the call itself has to be guarded.
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      return resolve(degrade('open-threw', err));
    }

    // An open blocked by another window holding the old version fires nothing at
    // all. Without this timeout `appendMission` would await forever and the run
    // would land in neither store — the one failure mode worse than degrading.
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve(degrade('open-timeout'));
    }, 3000);

    req.onupgradeneeded = (e) => migrate(req.result, e.oldVersion);
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      if (settled) return db.close(); // already gave up; do not leak the handle
      // A later window upgrading the schema must not be blocked by this handle.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => {
      clearTimeout(timer);
      if (!settled) resolve(degrade('open-failed', req.error));
    };
  });

  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('request failed'));
  });
}

/** Build a key range, or null where IDBKeyRange does not exist (node, tests). */
function keyRange(build: (r: typeof IDBKeyRange) => IDBKeyRange): IDBKeyRange | null {
  return typeof IDBKeyRange === 'undefined' ? null : build(IDBKeyRange);
}

/**
 * Walk an index, newest first where the index allows it.
 *
 * `pred` is the authority on what matches; `range` only makes the walk cheap.
 * Keeping correctness in the predicate is what lets the identical query run
 * against the in-memory fallback, where there is no index to seek.
 */
async function walk(
  index: IndexName,
  range: IDBKeyRange | null,
  pred: (m: StoredMission) => boolean,
  limit: number,
  onRow: (m: StoredMission) => void,
): Promise<void> {
  const db = await openDb();
  if (!db) return;

  // Everything below is synchronous on purpose: an IndexedDB transaction goes
  // inactive once control returns to the event loop, so no `await` may sit
  // between creating it and issuing the request.
  let tx: IDBTransaction;
  try {
    tx = db.transaction(STORE, 'readonly');
  } catch (err) {
    degrade('read-failed', err);
    return;
  }

  // Only the endedAt index is walked in time order, so only it can stop early;
  // a limit on any other index would cut the wrong records.
  const backwards = index === 'endedAt';
  const cap = backwards ? limit : 0;

  await new Promise<void>((resolve) => {
    const req = tx.objectStore(STORE).index(index).openCursor(range, backwards ? 'prev' : 'next');
    let n = 0;
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve();
      /*
       * REPAIRED BEFORE THE PREDICATE SEES IT. What comes off this cursor was
       * written by whichever build the player was running that week, so it is
       * missing every field added since - as an ABSENT KEY, which `=== null`
       * does not catch and `.foo` throws on. `hydrateRecord` fills each one
       * with its own documented absent value and drops a row too corrupt to
       * place on a timeline. This is the only place stored history enters the
       * program, so it is the only place that has to know.
       */
      const row = hydrateRecord(cur.value);
      if (row === null) {
        cur.continue();
        return;
      }
      if (pred(row)) {
        onRow(row);
        if (cap > 0 && ++n >= cap) return resolve();
      }
      cur.continue();
    };
    // A partial read beats no read: resolve with what we have rather than throw.
    req.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

async function query(
  index: IndexName,
  range: IDBKeyRange | null,
  pred: (m: StoredMission) => boolean,
  limit: number,
): Promise<StoredMission[]> {
  const rows: StoredMission[] = [];
  await walk(index, range, pred, limit, (m) => rows.push(m));
  // Anything written while degraded lives only here, and the user still expects
  // to see this session's runs in the list.
  for (const m of memory) if (pred(m)) rows.push(m);
  rows.sort((a, b) => b.endedAt - a.endedAt);
  return limit > 0 ? rows.slice(0, limit) : rows;
}

// ── public API ───────────────────────────────────────────────────────────────

let seq = 0;

/**
 * Ids are time-prefixed so an export sorts roughly chronologically, and carry a
 * counter plus randomness because two runs can end in the same millisecond and
 * `crypto.randomUUID` is unavailable outside a secure context.
 */
function newId(endedAt: number): string {
  return `${endedAt.toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Store one finished run. Never throws — on failure the record goes to memory. */
export async function appendMission(record: MissionRecord): Promise<StoredMission> {
  const stored: StoredMission = { ...record, id: newId(record.endedAt) };

  const db = await openDb();
  if (db) {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).add(stored);
      await txDone(tx);
      return stored;
    } catch (err) {
      // Quota exceeded, store missing, disk error — the run still happened.
      degrade('write-failed', err);
    }
  }
  memory.push(stored);
  return stored;
}

// ── the ledger ───────────────────────────────────────────────────────────────

/**
 * Append events. Never throws — on failure they go to memory, like a run does.
 *
 * Takes an ARRAY because that is what the callers have: one account push yields
 * every counter that moved together, and writing them in one transaction is
 * both faster and atomic, so a reader never sees half a moment.
 */
export async function appendLedger(events: LedgerEvent[]): Promise<number> {
  if (events.length === 0) return 0;

  const db = await openDb();
  if (db) {
    try {
      const tx = db.transaction(LEDGER, 'readwrite');
      const store = tx.objectStore(LEDGER);
      // `seq` is the key IndexedDB assigns; storing a copy of it inside the
      // value as well would let the two disagree after an import.
      for (const e of events) store.add(stripSeq(e));
      await txDone(tx);
      return events.length;
    } catch (err) {
      degrade('ledger-write-failed', err);
    }
  }
  memoryLedger.push(...events);
  return events.length;
}

function stripSeq(e: LedgerEvent): Omit<LedgerEvent, 'seq'> {
  const { seq: _seq, ...rest } = e;
  return rest;
}

export interface LedgerQuery {
  /** Inclusive lower bound on `at`. */
  from?: number;
  /** Exclusive upper bound on `at`, so consecutive windows never overlap. */
  to?: number;
  kind?: LedgerKind;
  /** Exact series name, or a `prefix:` to take a whole family. */
  name?: string;
  account?: string;
  /** 0 means every match. */
  limit?: number;
}

function matches(e: LedgerEvent, q: LedgerQuery): boolean {
  if (q.from !== undefined && e.at < q.from) return false;
  if (q.to !== undefined && e.at >= q.to) return false;
  if (q.kind !== undefined && e.kind !== q.kind) return false;
  if (q.account !== undefined && e.account !== q.account) return false;
  if (q.name !== undefined) {
    // `standing:` reads as "every syndicate"; `standing:CetusSyndicate` as one.
    const family = q.name.endsWith(':');
    if (family ? !e.name.startsWith(q.name) : e.name !== q.name) return false;
  }
  return true;
}

/**
 * Read the ledger, newest first.
 *
 * The `at` index only makes the walk cheap; `matches` is the authority, which
 * is what lets the identical query run against the in-memory fallback where
 * there is no index at all. Same division as `walk` above, for the same reason.
 */
export async function readLedger(q: LedgerQuery = {}): Promise<LedgerEvent[]> {
  const rows: LedgerEvent[] = [];
  const limit = q.limit ?? 0;

  const db = await openDb();
  if (db) {
    let tx: IDBTransaction | null = null;
    try {
      tx = db.transaction(LEDGER, 'readonly');
    } catch (err) {
      degrade('ledger-read-failed', err);
    }
    if (tx) {
      // No bound at all means no range: an open cursor is cheaper than a range
      // covering everything, and `Infinity` is not a key worth relying on.
      const from = q.from;
      const to = q.to;
      const range =
        from === undefined && to === undefined
          ? null
          : keyRange((R) =>
              from !== undefined && to !== undefined
                ? R.bound(from, to, false, true)
                : from !== undefined
                  ? R.lowerBound(from)
                  : R.upperBound(to as number, true),
            );
      const active = tx;
      await new Promise<void>((resolve) => {
        const req = active.objectStore(LEDGER).index('at').openCursor(range, 'prev');
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) return resolve();
          const row = { ...(cur.value as LedgerEvent), seq: Number(cur.primaryKey) };
          if (matches(row, q)) {
            rows.push(row);
            if (limit > 0 && rows.length >= limit) return resolve();
          }
          cur.continue();
        };
        // A partial read beats no read.
        req.onerror = () => resolve();
        active.onabort = () => resolve();
      });
    }
  }

  for (const e of memoryLedger) if (matches(e, q)) rows.push(e);
  rows.sort((a, b) => b.at - a.at || (b.seq ?? 0) - (a.seq ?? 0));
  return limit > 0 ? rows.slice(0, limit) : rows;
}

/**
 * How many events are on record, and the window they span.
 *
 * The span is what stops a reader treating silence as stillness: outside
 * [firstAt, lastAt] the app was not watching, which is a different fact from
 * nothing having happened. See the header of `ledger.ts`.
 */
export async function ledgerSpan(): Promise<{ count: number; firstAt: number | null; lastAt: number | null }> {
  const all = await readLedger();
  if (all.length === 0) return { count: 0, firstAt: null, lastAt: null };
  return { count: all.length, firstAt: all[all.length - 1]!.at, lastAt: all[0]!.at };
}

// ── mission queries ──────────────────────────────────────────────────────────

/** Most recent runs, newest first. */
export function recentMissions(limit = 50): Promise<StoredMission[]> {
  return query('endedAt', null, () => true, limit);
}

/** Runs that ended in [from, to). Half-open, so consecutive days never overlap. */
export function missionsInRange(from: number, to: number): Promise<StoredMission[]> {
  const range = keyRange((R) => R.bound(from, to, false, true));
  return query('endedAt', range, (m) => m.endedAt >= from && m.endedAt < to, 0);
}

/** Every run on one star chart node, newest first. */
export function missionsForNode(nodeId: string): Promise<StoredMission[]> {
  const range = keyRange((R) => R.only(nodeId));
  return query('node', range, (m) => m.node === nodeId, 0);
}

/** Total record count, without materialising the history. */
export async function historyCount(): Promise<number> {
  const db = await openDb();
  if (!db) return memory.length;
  try {
    const tx = db.transaction(STORE, 'readonly');
    return (await promisify(tx.objectStore(STORE).count())) + memory.length;
  } catch (err) {
    degrade('count-failed', err);
    return memory.length;
  }
}

/**
 * Fields beyond the indexed three are read structurally rather than by property
 * access. `missionlog` owns MissionRecord and will keep growing it; a roll-up
 * that hard-codes today's field names turns every such change into a build break
 * here. A field that is missing simply contributes nothing.
 *
 * ponytail: duck-typed roll-up. Replace with direct field reads once the
 * MissionRecord shape is frozen.
 */
function field(m: StoredMission, key: string): unknown {
  return (m as unknown as Record<string, unknown>)[key];
}

// `itemType` leads deliberately: a LootEntry carries BOTH `itemType` (the
// canonical `/Lotus/...` path) and `name` (a display string). Keying the roll-up
// by the display name would give this module a different key space from
// `missionlog`'s own aggregations, so the two could never be joined.
const NAME_KEYS = ['itemType', 'uniqueName', 'item', 'name', 'type', 'id'] as const;
const COUNT_KEYS = ['count', 'quantity', 'qty', 'delta', 'amount'] as const;

/** Accumulate one record's loot, accepting either `{id: n}` or `[{item, count}]`. */
function addLoot(into: Record<string, number>, loot: unknown): void {
  if (!loot || typeof loot !== 'object') return;

  if (Array.isArray(loot)) {
    for (const entry of loot as unknown[]) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const nameKey = NAME_KEYS.find((k) => typeof e[k] === 'string');
      if (!nameKey) continue;
      const countKey = COUNT_KEYS.find((k) => typeof e[k] === 'number');
      const name = e[nameKey] as string;
      into[name] = (into[name] ?? 0) + (countKey ? (e[countKey] as number) : 1);
    }
    return;
  }

  // A plain id → quantity map, which is what an inventory diff naturally is.
  for (const [k, v] of Object.entries(loot as Record<string, unknown>)) {
    if (typeof v === 'number') into[k] = (into[k] ?? 0) + v;
  }
}

/** One pass over the whole history. Cursored, so 20k records is not 20k objects held at once. */
export async function allTimeTotals(): Promise<HistoryTotals> {
  const totals: HistoryTotals = {
    missions: 0,
    successes: 0,
    durationSeconds: 0,
    firstAt: null,
    lastAt: null,
    byMissionType: {},
    byNode: {},
    loot: {},
  };

  const fold = (m: StoredMission): void => {
    totals.missions++;
    // `outcome`, not a `success` boolean: MissionRecord distinguishes a failure
    // from an abandoned run, and neither is a success.
    if (field(m, 'outcome') === 'success') totals.successes++;
    const secs = field(m, 'durationSeconds');
    const ms = field(m, 'durationMs');
    if (typeof secs === 'number') totals.durationSeconds += secs;
    else if (typeof ms === 'number') totals.durationSeconds += ms / 1000;
    if (totals.firstAt === null || m.endedAt < totals.firstAt) totals.firstAt = m.endedAt;
    if (totals.lastAt === null || m.endedAt > totals.lastAt) totals.lastAt = m.endedAt;
    if (m.missionType) totals.byMissionType[m.missionType] = (totals.byMissionType[m.missionType] ?? 0) + 1;
    if (m.node) totals.byNode[m.node] = (totals.byNode[m.node] ?? 0) + 1;
    addLoot(totals.loot, field(m, 'loot'));
  };

  await walk('endedAt', null, () => true, 0, fold);
  for (const m of memory) fold(m);
  return totals;
}

/**
 * The user owns this data. The output is exactly what `importJson` eats, ids
 * included, so a backup restores as the same history rather than a duplicate of
 * it.
 */
export async function exportJson(): Promise<string> {
  const missions = await query('endedAt', null, () => true, 0);
  const ledger = await readLedger();
  const payload: HistoryExport = {
    format: 'raijiframe-mission-history',
    version: DB_VERSION,
    exportedAt: Date.now(),
    missions,
    ledger,
  };
  return JSON.stringify(payload);
}

/**
 * A file the user picked is untrusted input: validate the envelope and every row.
 *
 * RETURNS THE DROP COUNT, because the rows this refuses used to disappear
 * without appearing anywhere in the result - `skipped` only ever counted ids
 * the database already held, so a file half of which was unusable reported the
 * same "0 skipped" as a clean one. A reader of that number would conclude the
 * import was whole.
 */
function readMissions(parsed: unknown): { rows: StoredMission[]; dropped: number } | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const env = parsed as Record<string, unknown>;
  if (env['format'] !== 'raijiframe-mission-history') return null;
  if (!Array.isArray(env['missions'])) return null;

  const out: StoredMission[] = [];
  let dropped = 0;
  for (const row of env['missions'] as unknown[]) {
    /*
     * This used to spread the row and assert `StoredMission` over it, having
     * checked exactly two keys - so a hand-trimmed file, or an export from a
     * build three fields ago, entered the database as a record the rest of the
     * program believes is complete. The same repair the cursor uses does the
     * validating: it drops a row with no usable timestamp or outcome, and
     * fills every other absent field with the value that means "unmeasured".
     */
    const rec = hydrateRecord(row);
    if (rec === null) {
      dropped++;
      continue;
    }
    out.push({ ...rec, id: rec.id === '' ? newId(rec.endedAt) : rec.id });
  }
  return { rows: out, dropped };
}

/**
 * Ledger rows out of an untrusted file.
 *
 * Validated field by field rather than cast: a row whose `at` is a string sorts
 * wrongly forever, and one whose `kind` is unknown would widen the union the
 * rest of the program switches on. Anything malformed is dropped rather than
 * repaired — unlike a mission, a ledger event has no partial form worth keeping.
 */
function readLedgerRows(parsed: unknown): LedgerEvent[] {
  const env = parsed as Record<string, unknown>;
  if (!Array.isArray(env['ledger'])) return [];

  const out: LedgerEvent[] = [];
  for (const raw of env['ledger'] as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const at = r['at'];
    const kind = r['kind'];
    const name = r['name'];
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;
    if (typeof kind !== 'string' || !LEDGER_KINDS.includes(kind as LedgerKind)) continue;
    if (typeof name !== 'string' || name === '') continue;
    out.push({
      account: typeof r['account'] === 'string' ? r['account'] : '',
      at,
      kind: kind as LedgerKind,
      name,
      from: scalarOrNull(r['from']),
      to: scalarOrNull(r['to']),
      by: typeof r['by'] === 'number' && Number.isFinite(r['by']) ? r['by'] : null,
    });
  }
  return out;
}

/** A ledger value is a number or an allowlisted string. Anything else is null. */
function scalarOrNull(v: unknown): number | string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') return v;
  return null;
}

/** Merge an export back in. Existing ids are skipped, so re-importing is a no-op. */
export async function importJson(json: string): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { imported: 0, importedLedger: 0, skipped: 0, error: 'not valid JSON' };
  }

  const file = readMissions(parsed);
  if (!file) return { imported: 0, importedLedger: 0, skipped: 0, error: 'not a RaijiFrame mission history export' };
  const missions = file.rows;
  const ledger = readLedgerRows(parsed);

  let imported = 0;
  // Rows the repair refused are skipped in the sense the caller cares about:
  // they were in the file and are not in the database.
  let skipped = file.dropped;

  const db = await openDb();
  if (db) {
    try {
      // One transaction for the whole file: a 20k-record import as 20k
      // transactions would take minutes and could half-apply.
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const m of missions) {
        const req = store.add(m);
        req.onsuccess = () => imported++;
        // add() on a duplicate id fails the request and would abort the whole
        // transaction; preventDefault keeps the rest of the import alive.
        req.onerror = (e) => {
          e.preventDefault();
          skipped++;
        };
      }
      await txDone(tx);
      // Separate transaction: a duplicate mission id must not roll back the
      // ledger, and the ledger's auto-increment keys cannot collide anyway.
      const importedLedger = await appendLedger(ledger);
      return { imported, importedLedger, skipped, error: null };
    } catch (err) {
      degrade('import-failed', err);
    }
  }

  const seen = new Set(memory.map((m) => m.id));
  for (const m of missions) {
    if (seen.has(m.id)) skipped++;
    else {
      memory.push(m);
      seen.add(m.id);
      imported++;
    }
  }
  const importedLedger = await appendLedger(ledger);
  return { imported, importedLedger, skipped, error: null };
}

/**
 * Wipe everything. Only ever called from an explicit user action.
 *
 * EVERY store, in ONE transaction. A wipe that clears the missions and leaves
 * the ledger is worse than no wipe at all: the user was told their data is gone
 * and a per-account record of what they did remains on disk.
 */
export async function clearHistory(): Promise<void> {
  memory.length = 0;
  memoryLedger.length = 0;
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction([STORE, LEDGER], 'readwrite');
    tx.objectStore(STORE).clear();
    tx.objectStore(LEDGER).clear();
    await txDone(tx);
  } catch (err) {
    degrade('clear-failed', err);
  }
}
