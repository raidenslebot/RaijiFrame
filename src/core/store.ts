/**
 * App state.
 *
 * The background controller owns the connection to GEP and writes here; the
 * visible windows read. State is deliberately small - the raw inventory blob is
 * kept once and everything else is derived from it on demand, so a new panel
 * never needs its own copy of the account.
 */

import { create } from 'zustand';
import type { RawInventory, GepStatus, HighlightedItem } from './gep';
import {
  accountKeyCount,
  emptyAcquireStats,
  isPlausibleAccount,
  mergeInventory,
  type AcquireStats,
} from './acquire.ts';
import { ow } from './ow.ts';

export interface AccountState {
  username: string | null;
  /** Raw GEP inventory dump. The single source of truth about the account. */
  inventory: RawInventory | null;
  /** When the inventory last actually changed (not when it was last pushed). */
  inventoryAt: number | null;
  /** Item currently hovered in-game. Drives live pricing. */
  highlighted: HighlightedItem | null;
  gep: GepStatus;
  gameRunning: boolean;
  /**
   * Nodes cleared during this session, observed live in EE.log.
   *
   * GEP's inventory dump only refreshes when the game decides to push one, so a
   * node cleared a minute ago may not be in it yet. These are unioned with the
   * inventory's own record, which lets progress show the instant it happens
   * without asking the game for anything extra.
   */
  liveClears: string[];
  /**
   * When the persisted account snapshot was captured. Null means the game has
   * genuinely never been seen. The app works fully from this with the game
   * closed; it needs the game to ACQUIRE data, never to use it.
   */
  capturedAt: number | null;
  /*
   * WHEN THE GAME LAST ANSWERED A READ, changed or not.
   *
   * `inventoryAt` is stamped on a real difference only - a byte-identical
   * payload is dropped in `gep.ingest` before it ever reaches this store, which
   * is what keeps a repeated read cheap. So "when did we last hear from the
   * game" had no answer here at all, and the automod panel, which needs exactly
   * that to know whether the loadout on screen is the one it holds, waited out
   * its whole settle window on every ordinary visit and then told the player it
   * could not re-read the loadout.
   */
  answeredAt: number | null;
  /** True once rehydration finished, so panels tell "loading" apart from
   *  "genuinely nothing stored". */
  hydrated: boolean;
  /**
   * What the reads have done to the account we hold. Diagnostics only - nothing
   * player-facing is derived from it - but `dropped` above zero is the signal
   * that the game handed us something that was not an account.
   */
  acquire: AcquireStats;
  /**
   * The display name the held account belongs to.
   *
   * Two Warframe accounts on one PC - an alt, a housemate, a family share - push
   * through the same GEP connection, and without this the second one's reads
   * were merged into the first one's account. That produced a blend belonging to
   * nobody: account B's rank beside account A's lich, focus and intrinsics, and
   * persisted, with no code path that could ever separate them again.
   */
  accountOwner: string | null;
  /** Advances after a committed snapshot so mounted comparisons reload. */
  snapshotRevision: number;

  setUsername: (name: string) => void;
  /** Report whether the last write to disk landed. Diagnostics, and the Shell. */
  setDurable: (durable: boolean | null) => void;
  /**
   * Fold a read into the account. Returns the account as it now stands, or null
   * if the read was not an account at all - the caller persists what comes back,
   * never the raw payload, so the snapshot on disk only ever gets more complete.
   */
  setInventory: (inv: RawInventory, owner?: string | null) => RawInventory | null;
  setHighlighted: (item: HighlightedItem | null) => void;
  setGep: (status: GepStatus) => void;
  setGameRunning: (running: boolean) => void;
  addLiveClear: (node: string) => void;
  setAnswered: (at: number | null) => void;
  hydrate: (inv: RawInventory | null, username: string | null, capturedAt: number | null) => void;
}

export function createAccountStore() {
  return create<AccountState>((set, get) => ({
  username: null,
  inventory: null,
  inventoryAt: null,
  highlighted: null,
  gep: 'idle',
  gameRunning: false,
  liveClears: [],
  capturedAt: null,
  answeredAt: null,
  hydrated: false,
  acquire: emptyAcquireStats(),
  accountOwner: null,
  snapshotRevision: 0,

  setUsername: (username) => set((s) => {
    if (!username || (s.username === username && s.accountOwner === username)) return s;
    // Identity and its visible data change together. Keeping A's inventory
    // while displaying B's name made both advice and subsequent saves lie.
    const switched = s.accountOwner !== null && s.accountOwner !== username;
    const discard = s.inventory !== null && s.accountOwner !== username;
    return {
      username,
      accountOwner: username,
      ...(discard ? { inventory: null, inventoryAt: null, capturedAt: null } : {}),
      liveClears: [],
      highlighted: null,
      answeredAt: null,
      acquire: { ...s.acquire, durable: discard ? null : s.acquire.durable, switched: s.acquire.switched + Number(switched) },
    };
  }),
  setDurable: (durable) => set((s) => ({ acquire: { ...s.acquire, durable } })),
  /*
   * A read is evidence, not a replacement. See core/acquire.ts for why: a memory
   * read taken mid-load can be well-formed and nearly empty, and replacing the
   * account with it - then persisting that - is how the app used to forget
   * everything the player had.
   */
  setInventory: (pushed, suppliedOwner) => {
    const s = get();
    if (!isPlausibleAccount(pushed)) {
      set({ acquire: { ...s.acquire, dropped: s.acquire.dropped + 1 } });
      return null;
    }
    const owner = suppliedOwner === undefined ? s.username : suppliedOwner;
    const switched = s.accountOwner !== owner;
    const base = switched ? null : s.inventory;
    const merged = mergeInventory(base, pushed);
    const partial = base !== null && accountKeyCount(pushed) < accountKeyCount(base) ? 1 : 0;
    const acquire: AcquireStats = {
      ...s.acquire,
      accepted: s.acquire.accepted + 1,
      partial: s.acquire.partial + partial,
      switched: s.acquire.switched + (switched && s.accountOwner !== null ? 1 : 0),
      redundant: s.acquire.redundant + (merged === s.inventory ? 1 : 0),
    };
    // `capturedAt` moves either way: the account was confirmed current even when
    // nothing in it changed. `inventoryAt` and a re-render happen only on a real
    // change, which is what keeps a repeated identical push cheap.
    if (merged === s.inventory) {
      set({ capturedAt: Date.now(), acquire, accountOwner: owner });
      return merged;
    }
    set({
      inventory: merged, inventoryAt: Date.now(), capturedAt: Date.now(), acquire,
      accountOwner: owner, username: owner,
      ...(switched ? { liveClears: [], highlighted: null, answeredAt: null } : {}),
    });
    return merged;
  },
  setAnswered: (answeredAt) => set({ answeredAt }),
  setHighlighted: (highlighted) => set({ highlighted }),
  setGep: (gep) => set({ gep }),
  setGameRunning: (gameRunning) => set({ gameRunning }),
  addLiveClear: (node) =>
    set((s) => (s.liveClears.includes(node) ? s : { liveClears: [...s.liveClears, node] })),
  /*
   * The stored account is folded UNDER whatever a live push already delivered.
   * `s.inventory ?? inventory` used to discard the whole snapshot the moment a
   * push had landed first - so if that push was a thin one, the complete account
   * on disk was thrown away. Live keys still win; stored keys the push did not
   * carry are recovered rather than lost.
   */
  hydrate: (inventory, username, capturedAt) =>
    set((s) => {
      const stored = inventory && isPlausibleAccount(inventory) ? inventory : null;
      /*
       * WHOSE SNAPSHOT IS THIS, AND THE TWO UNKNOWNS ARE NOT SYMMETRIC.
       *
       * An unknown LIVE owner is the ordinary startup: no login line has been
       * seen yet, a thin GEP push may already have landed, and the snapshot on
       * disk is almost certainly the same player's. It is forgiven, and it
       * CORRECTS ITSELF - `accountOwner` becomes the stored name, so the first
       * read for a different player trips `switched` in `setInventory` and
       * replaces the lot, and `setUsername` now discards on the name change
       * before that even happens.
       *
       * An unknown STORED owner while the live player is known has no such
       * correction: the merge would take the LIVE name as its owner, `switched`
       * could then never fire, and two accounts would stay blended for the rest
       * of the session with every figure and every recommendation drawn from
       * the mixture. So that one is refused.
       *
       * THIS WAS TIGHTENED TO `s.inventory === null && s.username === null` and
       * that broke the first case, which is the common one. A thin live push
       * arriving before hydrate made `s.inventory` non-null, so the stored
       * account was DISCARDED - the app forgetting everything the player had,
       * which is the exact failure the note on `setInventory` above exists to
       * prevent. `check-acquisition.ts` names the race: "a thin live push lands
       * first, the snapshot resolves second."
       *
       * The predicate below keeps the refusal that tightening was reaching for
       * - a snapshot whose owner is unknown never merges into a known live
       * player - without taking the startup case with it.
       */
      const liveOwner = s.accountOwner ?? s.username;
      const sameOwner = stored !== null && (liveOwner === null || (username !== null && username === liveOwner));
      const next = stored === null || !sameOwner ? s.inventory : s.inventory ? mergeInventory(stored, s.inventory) : stored;
      return {
        inventory: next,
        username: sameOwner ? (s.username ?? username) : s.username,
        capturedAt: sameOwner ? (s.capturedAt ?? capturedAt) : s.capturedAt,
        accountOwner: sameOwner ? (s.accountOwner ?? username) : s.accountOwner,
        hydrated: true,
      };
    }),
  }));
}

export const useAccount = createAccountStore();

/** Every data field crosses windows; action closures remain local. */
export type AccountData = Pick<AccountState, {
  [K in keyof AccountState]: AccountState[K] extends (...args: never[]) => unknown ? never : K
}[keyof AccountState]>;

export function accountData(state: AccountState): AccountData {
  return Object.fromEntries(Object.entries(state).filter(([, value]) => typeof value !== 'function')) as AccountData;
}

/**
 * Read state from a window that is not the one running the store.
 *
 * Overwolf windows are separate browser contexts, so the background controller's
 * store is reached through `getMainWindow()`. Panels use this instead of holding
 * their own GEP connection - only the controller may talk to GEP.
 */
export function backgroundStore(): typeof useAccount | null {
  try {
    const main = ow?.windows.getMainWindow() as unknown as { codexStore?: typeof useAccount };
    return main?.codexStore ?? null;
  } catch {
    return null;
  }
}
