/**
 * Durable account snapshot.
 *
 * THE BUG THIS FIXES
 * ──────────────────
 * The app treated GEP as its only source of truth, so the instant Warframe closed
 * every panel reverted to "Warframe is not running" and the account vanished.
 * That is backwards: planning a session is something you do BEFORE launching the
 * game, and it is the single most valuable thing this app does.
 *
 * The game is how data is ACQUIRED. It is not a precondition for using it.
 *
 * So the last account push is written to disk and rehydrated on boot. Once the
 * game has run even once, RaijiFrame is fully functional forever after with the
 * game closed — it simply reports how old the data is, and refreshes silently the
 * next time the game is up.
 *
 * This is the same lesson EE.log taught: the log is truncated on every launch, so
 * anything not persisted is lost. Persist or lose it.
 *
 * WHY INDEXEDDB
 * ─────────────
 * The inventory payload is ~16 KB now but grows with the account and holds every
 * owned item. localStorage is a 5 MB synchronous store shared with everything
 * else, and a synchronous write of that size on the main thread would jank an
 * overlay compositing over a game. IndexedDB is async and roomy.
 */

import type { RawAccount } from '../data/account';
import { isPlausibleAccount } from './acquire.ts';

const DB_NAME = 'raijiframe';
const DB_VERSION = 1;
const STORE = 'snapshot';
const KEY = 'account';
/**
 * The read BEFORE the current one, kept so the app can say what changed.
 *
 * `UI-SPEC.md:1308` asks for delta highlighting and makes the argument for it:
 * "The game cannot do this; it has no memory of your last login." Neither did
 * this - one key, overwritten on every push, so the only account the app had
 * ever seen was the newest one and "what moved since last time" had nothing to
 * subtract from.
 *
 * Keeping one generation back is the whole cost, and it is paid only when the
 * account actually differs (see `put`), so a session that pushes the same
 * inventory forty times does not roll the history forty times and lose it.
 */
const PREV_KEY = 'account.previous';

/*
 * WHEN THE PREVIOUS GENERATION IS ALLOWED TO MOVE.
 *
 * The delta this feeds answers "what changed while you were away", so
 * "previous" has to mean the account as it stood when the player last put the
 * game down. It was implemented as "roll whenever the account differs", which
 * reads like the same thing and is not: `gep.ingest` already drops every
 * byte-identical payload before routing, so an account that reaches this file
 * has ALWAYS changed, and the guard below was true on essentially every push.
 * "Previous" therefore meant a few seconds ago - each push rolling away the
 * generation the player was about to be shown - and `ui/useDelta.ts` said in
 * as many words that it could not move while the app was open.
 *
 * So the roll is driven by the two moments that actually begin a session: this
 * process starting (the snapshot on disk is then, by definition, from the last
 * time the player played) and the game launching. Between them the previous
 * generation is held still, which is the whole point of keeping one.
 */
let rollDue = true;

/** The player is starting a session; the account on disk is where they left off. */
export function rollGenerationOnNextSave(): void {
  rollDue = true;
}

export interface AccountSnapshot {
  account: RawAccount;
  /** When the game last pushed this. ms since epoch. */
  capturedAt: number;
  /** Display name at capture time, for the UI to greet correctly offline. */
  username: string | null;
  /** Bumped when the shape changes, so a stale snapshot can be discarded. */
  version: number;
}

const SCHEMA_VERSION = 1;

/**
 * IndexedDB can be unavailable: private windows, disabled site data, or a
 * hardened Overwolf profile. Every call degrades to null rather than throwing,
 * because a storage failure must never take a panel down - it only means the app
 * is back to needing the game running.
 */
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // A blocked upgrade would hang forever otherwise.
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * The newest snapshot waiting to be written, and whether a write is in flight.
 *
 * Every accepted read used to open a connection, write, and close it. Two pushes
 * arriving close together - which is exactly what happens when a mission ends
 * and the log-driven refresh lands on top of the game's own push - put two
 * transactions in the air at once against separate connections, with no ordering
 * guarantee between them. The older one could land last, so the file on disk
 * went backwards.
 *
 * Now a write in flight parks the newest snapshot instead; it is written when
 * the current one finishes. Nothing is delayed on an idle path, so there is no
 * window in which a closing app loses the last read.
 */
let writing = false;
let queued: AccountSnapshot | null = null;

function put(db: IDBDatabase, snapshot: AccountSnapshot): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);

      /*
       * ROLL THE CURRENT READ BACK ONE GENERATION, AT THE START OF A SESSION.
       * ————————————————
       * `rollDue` is what decides, and the note beside it says why a
       * difference-based test cannot: everything that arrives here differs.
       *
       * `sameAccount` still has a job, just a smaller one than it was given -
       * it stops the FIRST save of a session from rolling a generation that is
       * identical to the one replacing it, which would leave the player with a
       * delta of nothing rather than the delta they came back for. `capturedAt`
       * is deliberately outside that comparison: it differs on every push by
       * construction, so including it would make the test vacuous.
       *
       * Both writes ride the same transaction, so there is no window where the
       * previous generation has been dropped and the new one has not landed.
       */
      const existing = store.get(KEY);
      existing.onsuccess = () => {
        const prior = existing.result as AccountSnapshot | undefined;
        if (rollDue && prior !== undefined && !sameAccount(prior, snapshot)) {
          rollDue = false;
          store.put(prior, PREV_KEY);
        }
        store.put(snapshot, KEY);
      };
      // If the read fails the write must still happen: losing the delta is a
      // missing nicety, losing the snapshot is the app forgetting everything.
      existing.onerror = () => store.put(snapshot, KEY);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

/**
 * Are these two reads the same account state?
 *
 * A structural comparison over the serialised account, which is what IndexedDB
 * is about to store anyway. `capturedAt` and `version` are excluded: the first
 * differs on every push by definition and the second is about the schema, not
 * the player.
 */
function sameAccount(a: AccountSnapshot, b: AccountSnapshot): boolean {
  if (a.username !== b.username) return false;
  try {
    return JSON.stringify(a.account) === JSON.stringify(b.account);
  } catch {
    // A cyclic or unserialisable account cannot be compared; treat it as
    // changed, which costs a roll rather than losing one.
    return false;
  }
}

/** Persist the latest account push. Failure is non-fatal and silent by design. */
export async function saveSnapshot(account: RawAccount, username: string | null): Promise<boolean> {
  const snapshot: AccountSnapshot = {
    account,
    capturedAt: Date.now(),
    username,
    version: SCHEMA_VERSION,
  };

  if (writing) {
    // Supersede whatever was waiting: only the newest account is worth writing.
    queued = snapshot;
    return true;
  }

  writing = true;
  let next: AccountSnapshot | null = snapshot;
  let ok = false;
  try {
    while (next) {
      const db = await openDb();
      if (!db) return false;
      ok = await put(db, next);
      next = queued;
      queued = null;
    }
  } finally {
    writing = false;
  }
  return ok;
}

/** Rehydrate on boot. Null means the game has genuinely never been seen. */
export async function loadSnapshot(): Promise<AccountSnapshot | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => {
        db.close();
        const snap = req.result as AccountSnapshot | undefined;
        /*
         * A stored account is kept across a version bump.
         *
         * This used to discard it, on the reasoning that "it would be replaced
         * by a fresh push within seconds of the game starting". That is the one
         * assumption this whole app is built to reject: the game is how data is
         * ACQUIRED, not a precondition for using it. Shipping a build with a
         * bumped version therefore wiped every user's account and left the app
         * useless until they next launched Warframe - the app forgetting
         * everything, caused by us rather than by a bad read.
         *
         * `version` is OUR wrapper's, not the payload's: `account` is the blob
         * DE's own client produced and its shape is not ours to invalidate. So
         * the test is whether it still looks like an account, which is the same
         * gate every live read passes through.
         */
        if (!snap || !isPlausibleAccount(snap.account)) return resolve(null);
        resolve(snap);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

/**
 * The read before the current one, or null when there has only ever been one.
 *
 * Null is the honest answer for a first capture and must stay distinguishable
 * from "nothing changed": a figure with no previous reading is not a figure
 * that held steady, and marking it as unchanged would be a claim about a
 * session that never happened.
 */
export async function loadPrevious(): Promise<AccountSnapshot | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(PREV_KEY);
      req.onsuccess = () => {
        db.close();
        const snap = req.result as AccountSnapshot | undefined;
        resolve(snap !== undefined && snap.version === SCHEMA_VERSION ? snap : null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

export async function clearSnapshot(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.objectStore(STORE).delete(PREV_KEY);
    tx.oncomplete = () => db.close();
  } catch {
    /* nothing to clean up */
  }
}

/**
 * How stale the data is, phrased for a human.
 *
 * Deliberately coarse. The player does not need "2h 14m 09s"; they need to know
 * whether to trust it, and precision would imply a freshness the data does not
 * have.
 */
export function describeAge(capturedAt: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - capturedAt) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
