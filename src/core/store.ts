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

  setUsername: (name: string) => void;
  /** Report whether the last write to disk landed. Diagnostics, and the Shell. */
  setDurable: (durable: boolean) => void;
  /**
   * Fold a read into the account. Returns the account as it now stands, or null
   * if the read was not an account at all - the caller persists what comes back,
   * never the raw payload, so the snapshot on disk only ever gets more complete.
   */
  setInventory: (inv: RawInventory) => RawInventory | null;
  setHighlighted: (item: HighlightedItem | null) => void;
  setGep: (status: GepStatus) => void;
  setGameRunning: (running: boolean) => void;
  addLiveClear: (node: string) => void;
  setAnswered: (at: number | null) => void;
  hydrate: (inv: RawInventory | null, username: string | null, capturedAt: number | null) => void;
}

export const useAccount = create<AccountState>((set, get) => ({
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

  setUsername: (username) => set({ username }),
  setDurable: (durable) => set((s) => ({ acquire: { ...s.acquire, durable } })),
  /*
   * A read is evidence, not a replacement. See core/acquire.ts for why: a memory
   * read taken mid-load can be well-formed and nearly empty, and replacing the
   * account with it - then persisting that - is how the app used to forget
   * everything the player had.
   */
  setInventory: (pushed) => {
    const s = get();
    if (!isPlausibleAccount(pushed)) {
      set({ acquire: { ...s.acquire, dropped: s.acquire.dropped + 1 } });
      return null;
    }
    /*
     * Whose account is this? A read that arrives after a different player has
     * logged in must REPLACE what we hold, never merge into it. The username is
     * the only identity GEP offers, and EE.log's `Logged in <name>` gives the
     * same string earlier - the switch is usually known before the first read.
     *
     * Nothing is destroyed on the name change itself, only when a real read for
     * the new player arrives: a spurious name event costs nothing.
     */
    const switched = s.username !== null && s.accountOwner !== null && s.username !== s.accountOwner;
    const base = switched ? null : s.inventory;
    const merged = mergeInventory(base, pushed);
    const partial = base !== null && accountKeyCount(pushed) < accountKeyCount(base) ? 1 : 0;
    const acquire: AcquireStats = {
      ...s.acquire,
      accepted: s.acquire.accepted + 1,
      partial: s.acquire.partial + partial,
      switched: s.acquire.switched + (switched ? 1 : 0),
      redundant: s.acquire.redundant + (merged === s.inventory ? 1 : 0),
    };
    const owner = s.username ?? s.accountOwner;
    // `capturedAt` moves either way: the account was confirmed current even when
    // nothing in it changed. `inventoryAt` and a re-render happen only on a real
    // change, which is what keeps a repeated identical push cheap.
    if (merged === s.inventory) {
      set({ capturedAt: Date.now(), acquire, accountOwner: owner });
      return merged;
    }
    set({ inventory: merged, inventoryAt: Date.now(), capturedAt: Date.now(), acquire, accountOwner: owner });
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
       * The stored account belongs to whoever was playing when it was written,
       * and if a different player is live now it is not theirs to merge into.
       *
       * The two unknowns are NOT symmetric, which is why only one of them is
       * forgiven here. An unknown LIVE owner is the ordinary startup case - no
       * login line seen yet - and it corrects itself: `accountOwner` becomes the
       * stored name, so the first push for a different player trips `switched`
       * in `setInventory` and replaces the lot. An unknown STORED owner while
       * the live player is known has no such correction: the merge would take
       * the LIVE name as its owner, `switched` could then never fire, and two
       * accounts would stay blended for the rest of the session with every
       * figure and every recommendation drawn from the mixture.
       */
      const sameOwner = stored !== null && (s.username === null || username === s.username);
      const next = stored === null || !sameOwner ? s.inventory : s.inventory ? mergeInventory(stored, s.inventory) : stored;
      return {
        inventory: next,
        username: s.username ?? username,
        capturedAt: s.capturedAt ?? capturedAt,
        accountOwner: s.accountOwner ?? (sameOwner ? username : s.username),
        hydrated: true,
      };
    }),
}));

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
