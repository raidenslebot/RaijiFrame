/**
 * Background controller.
 *
 * The only place in the app that talks to GEP, per Overwolf's own guidance and
 * because a single owner is what makes the "one read per session" guarantee
 * enforceable. Visible windows read state from here via `getMainWindow()`.
 *
 * Responsibilities, and nothing else:
 *   - follow Warframe's process lifecycle
 *   - connect/disconnect GEP alongside it
 *   - tail EE.log for live mission completions
 *   - own the Ctrl+K toggle
 *   - hold the store the visible windows read
 */

import { gep, type RawInventory } from '../core/gep';
import { tailEeLog } from '../core/eelog';
import { MissionRecorder, deltaInventory, type MissionRecord } from '../data/missionlog';
import { appendMission, appendLedger } from '../data/history-store';
import { diffAccount, ledgerFromEvent, ledgerFromItems } from '../data/ledger';
import { loadCatalog } from '../data/datasets';
import { stepsToPlanet, type Catalog } from '../data/catalog';
import { memoLast } from '../core/memo';
import { learnSlot, lessonFrom, loadLearnedSlots, type LearnedSlots } from '../data/slot-learning';
import { hasSomethingToSay, ladderToShow, openPolicy, opensAScreen, publishDecision, SETTLE_WAIT_MS } from '../data/automod-publish';
import { resolveIn } from '../data/build';
import { loadSnapshot, rollGenerationOnNextSave, saveSnapshot } from '../core/snapshot';
import type { RawAccount } from '../data/account';
import { useAccount } from '../core/store';
import {
  WINDOW,
  TOGGLE_HOTKEY,
  AUTOMOD_HOTKEY,
  toggleWindow,
  restoreWindow,
  hideWindow,
  closeWindow,
  placeWindow,
  setInputPassThrough,
  getWindowState,
  gameArea,
  watchGame,
  onHotkeyPressed,
  type GameSnapshot,
} from '../core/ow';
import { IDLE, NO_PURSE, step, type AutomodState, type Session } from '../data/automod-session';
import { fullBox } from '../data/automod-place';
import { purseOf } from '../data/fusion';
import { loadItemDb, type ItemDb } from '../data/itemdb';
import { loadModDb, type ModDb } from '../data/moddb';
import { ladder as ladderSteps, ownedRanks, plan as planBuild, questionFor, slotPlanFor, uncountedAttacks, type Plan, type PlanInput, type Rung } from '../data/optimise';
import type { LadderEnd, PendingSlot } from '../data/automod-session';

// Publish the store on the controller's window object so `backgroundStore()` in
// the visible windows can reach the same instance instead of forking state.
(window as unknown as { codexStore: typeof useAccount }).codexStore = useAccount;

const store = useAccount.getState();

gep.on('status', store.setGep);
/**
 * What is currently on disk, so a write is only issued when it would change
 * something. `saveSnapshot` opens and closes an IndexedDB connection per call,
 * and the username handler below would otherwise re-persist the same bytes.
 */
let persistedUsername: string | null = null;

function persist(account: RawInventory, username: string | null): void {
  persistedUsername = username;
  // gep.ts still exposes the older RawInventory shape; account.ts is the
  // superset the rest of the app uses. The payload is identical at runtime, so
  // this is a declaration-level widening, not a data conversion.
  //
  // The result is not discarded: a storage failure is the difference between
  // "yesterday's data" and "no data" on the next launch, and it used to be
  // invisible - every panel correct, the header reporting a freshness that had
  // never reached disk, and the loss discovered only on the next start.
  void saveSnapshot(account as unknown as RawAccount, username).then((ok) => {
    useAccount.getState().setDurable(ok);
    if (!ok) console.warn('[acquire] the account could not be written to disk');
  });
}

/**
 * The ledger's one account-side seam.
 *
 * `setInventory` is where the previous account and the newly merged one exist
 * side by side for the last time — a moment later the previous one is
 * unreachable, and `core/snapshot.ts` keeps exactly one generation behind that.
 * Everything the account has ever held used to end here.
 *
 * Reads BOTH sides itself rather than asking the store to report them, so
 * `core/store.ts` stays free of storage: the same two values are already public
 * on the state.
 */
function recordAccountChange(
  before: RawAccount | null,
  after: RawAccount,
  account: string,
  switchedFrom: string | null,
): void {
  const at = Date.now();
  /*
   * A read that arrives after a different player logged in must not be diffed
   * against the previous player's account: every counter would report the
   * difference between two people as one person's activity. The store already
   * refuses to MERGE across the switch; the ledger has to refuse to SUBTRACT
   * across it, and say that it did rather than leaving an unexplained gap.
   */
  const events =
    switchedFrom === null
      ? [
          ...diffAccount(before, after, at, account),
          ...ledgerFromItems(deltaInventory(before, after), at, account),
        ]
      : [{ account, at, kind: 'system' as const, name: 'account-switched', from: switchedFrom, to: account, by: null }];

  void appendLedger(events);
}

gep.on('inventory', (inv) => {
  // Captured BEFORE the merge, because the merge is what destroys it.
  const previous = useAccount.getState().inventory as RawAccount | null;
  const owner = useAccount.getState().accountOwner;
  // The store folds the read into the account and hands back the result. What
  // gets persisted is THAT, never the raw payload: a thin or malformed read used
  // to overwrite a complete snapshot on disk, which is how one bad moment in a
  // session became permanent. A read the store rejected returns null and is
  // never written.
  const account = useAccount.getState().setInventory(inv);
  if (!account) {
    console.warn('[acquire] dropped a read carrying no account keys');
    return;
  }
  const named = useAccount.getState().username;
  // Same test `setInventory` makes internally to decide whether to merge.
  const switched = named !== null && owner !== null && named !== owner;
  recordAccountChange(
    previous,
    account as unknown as RawAccount,
    named ?? owner ?? '',
    switched ? owner : null,
  );
  persist(account, useAccount.getState().username);
  // The `after` side of a run's loot diff, and the latch for the next run's
  // `before`. Feeding the MERGED account rather than the raw push keeps the diff
  // over the same object the panels show.
  keep(recorder?.observeInventory(account as unknown as RawAccount) ?? null);
  /*
   * AND THE LOADOUT IS SETTLED AGAIN. This read is newer than the swap that
   * marked it stale, so the panel may name what it resolves - see
   * `loadoutIsSettled`. Clearing it here rather than comparing timestamps at
   * every publish keeps one fact in one place.
   */
  // The panel is published from the `answered` handler below, which fires for
  // every read that carried an account - this one included. Publishing here as
  // well is what made a changed read publish twice.
});

/*
 * The display name arrives on its own GEP key and can land AFTER the inventory
 * push that wrote the snapshot. The stored username then stayed null until the
 * next inventory change - which, for a player parked in a relay, can be the rest
 * of the session - so the app greeted them by no name at all next launch. This
 * closes that window without adding a write on every push.
 */
gep.on('username', (name) => {
  useAccount.getState().setUsername(name);
  const held = useAccount.getState().inventory;
  if (held && persistedUsername !== name) persist(held, name);
});

// Rehydrate before the game is anywhere near running - this is what makes
// RaijiFrame useful for PLANNING a session rather than only during one.
void loadSnapshot().then((snap) => {
  persistedUsername = snap?.username ?? null;
  const stored = (snap?.account ?? null) as unknown as RawInventory | null;
  useAccount.getState().hydrate(stored, snap?.username ?? null, snap?.capturedAt ?? null);

  /*
   * A push can beat the disk read. When it does, the store now holds the union
   * of the two - but the union existed only in memory: the pushed account had
   * already been written over the stored one, and nothing wrote the recovered
   * version back. The next launch then hydrated from the thinner copy, which is
   * the whole "forgets everything" complaint arriving by a second route.
   *
   * Reference comparison, so the common case (no push yet, nothing recovered)
   * writes nothing at all.
   */
  const held = useAccount.getState().inventory;
  if (held && held !== stored) persist(held, useAccount.getState().username);
});
/*
 * THE GAME ANSWERED WITH AN ACCOUNT - THE ONE SIGNAL THE PANEL WAITS ON.
 *
 * It fires for a read that changed something and for a read that changed
 * nothing alike, which is the point: an unchanged account is dropped as
 * byte-identical before the store ever sees it, so `inventory` never fires on
 * the ordinary visit and nothing else would tell the panel its wait was over.
 *
 * It used to publish only while the deadline timer was still pending, as a
 * guard against publishing twice. That guard cost more than it saved: the timer
 * nulls itself when it fires, so an answer arriving even slightly late - a cold
 * provider, a loading screen - published nothing at all and left "the loadout
 * could not be re-read" on screen for the rest of the visit, and a real visit
 * was measured at 88 seconds with no further arsenal line to shake it loose.
 * The `inventory` handler no longer publishes, so there is nothing to be twice.
 */
gep.on('answered', (at) => {
  store.setAnswered(at);
  if (settleTimer !== null) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  // The account has landed, so the item is nameable and the plan exists. This
  // is the commonest way a plan first appears, and it used to publish it to a
  // window that was never put up. See `publishAndShow`.
  if (session.phase !== 'idle') publishAndShow();
});
gep.on('highlighted', store.setHighlighted);
gep.on('chat', (line) => {
  // Chat is a firehose. Nothing consumes it yet, so it is deliberately dropped
  // here rather than buffered into memory that no panel reads.
  void line;
});

/** Stops the EE.log tail; set while the game is running. */
let stopLogTail: (() => void) | null = null;

/*
 * THE MODDING SCREEN.
 *
 * The same tail that names a finished mission also narrates the Upgrades
 * screen (`core/eelog.ts`, the arsenal events). `data/automod-session.ts` folds
 * those into one Session; this is its only consumer. The `automod` window is
 * opened when the screen is DRAWN (`HudVis`), never on the open line - the
 * game paints the cards half a second after it - placed in the column the
 * screen leaves empty (`data/automod-place.ts`), hidden when the screen
 * closes, and CLOSED a while after that so a page nobody can see costs
 * nothing: Overwolf does not document what a hidden window's timers do.
 */
let session: Session = IDLE;
const pending: PendingSlot = { slot: null, slotAt: null, unrecognised: null };
const sessionListeners = new Set<() => void>();
/** The game's client area in logical px; null until Overwolf reports it. */
let area: { width: number; height: number } | null = null;
/**
 * ONE LINE PER THING THAT HAPPENS TO THE OVERLAY.
 *
 * Overwolf writes an app's console to
 * `%LOCALAPPDATA%/Overwolf/Log/Apps/RaijiFrame/background.html.log`, and until
 * now this controller wrote almost nothing there: one warning at startup and
 * then silence. So a session in which the overlay worked perfectly and one in
 * which it never ran at all produced identical logs - which is precisely why
 * "has this ever worked in the game" had no answer for the whole of its
 * development, and why every claim about it had to be hedged.
 *
 * These are RARE events: a screen opened, a plan computed, a window shown. A
 * modding session produces a handful of lines, not a stream.
 *
 * PRIVACY, the same rule the log tail itself obeys: never a raw EE.log line and
 * never the player's name. What goes here is the app's OWN state - a phase, a
 * slot number, an item name, a count - and nothing that arrived as text from
 * the game.
 */
function trace(what: string, detail?: Record<string, string | number | boolean | null>): void {
  const tail = detail
    ? ' ' +
      Object.entries(detail)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' ')
    : '';
  console.log(`[automod] ${what}${tail}`);
}

let stripShown = false;
let stripCloseTimer: ReturnType<typeof setTimeout> | null = null;
const STRIP_CLOSE_AFTER_MS = 5 * 60_000;
/*
 * THE WATCHDOG, and why it exists.
 *
 * The strip was shown on any non-idle phase and hidden only on the transition
 * INTO idle - which assumes the log always narrates the screen closing. It does
 * not. Alt-tab, a crash, or an app that started while the screen was already
 * open all leave the phase parked on `visible` or `saved` with no close line
 * ever arriving, and the overlay then sits on the player's screen forever. That
 * is exactly what happened: a strip stuck reading ITEM UNKNOWN / SAVED with the
 * game long past that screen, and no way to be rid of it.
 *
 * So the shown state expires. Every arsenal line the log emits is proof the
 * screen is still there and pushes the deadline out; silence past it means the
 * player has moved on, whatever the last line claimed. This hides rather than
 * mutes, so the next line that arrives brings the strip straight back.
 */
/**
 * HOW MANY TIMES THE OVERLAY HAS BEEN TAKEN DOWN.
 *
 * `showStrip` is asynchronous - `placeWindow` alone is two round-trips to
 * Overwolf - and anything that hides the overlay during one of those awaits has
 * its answer thrown away unless the resumed function can tell that it happened.
 *
 * It used to tell by reading `stripMuted`, because every route out set it. That
 * stopped being true when Ctrl+K was changed to hide WITHOUT muting (so opening
 * the companion panel no longer kills a live overlay), and the re-check quietly
 * stopped covering the case it was written for: press the key inside the place
 * window and the overlay comes straight back, which is the exact complaint the
 * comment there describes from the mute era.
 *
 * A counter is the fix that does not depend on WHY it was hidden. `hideStrip`
 * bumps it; `showStrip` captures it before each await and abandons the show if
 * it moved. Any future route out is covered without remembering to add a flag.
 */
let stripGeneration = 0;
let stripWatchdog: ReturnType<typeof setTimeout> | null = null;
const STRIP_SILENCE_MS = 90_000;
/**
 * WHEN THE LOG LAST PROVED THE MODDING SCREEN IS STILL THERE.
 *
 * The watchdog above used to be the only record of this, and a timer cannot be
 * read - so every question of the form "is this overlay LIVE or STUCK" had to
 * be answered by whether the timer happened to be armed, which is false for
 * every moment the strip is down for a reason other than the screen closing.
 *
 * That is the distinction the panic key's comment claims to make and could not.
 * A timestamp can be read at any moment by anything, including a route that
 * wants to bring a live strip BACK, and it survives the strip being hidden.
 */
let stripLiveAt = 0;
/**
 * The player said no. Ctrl+Shift+M (or Ctrl+K, the key everyone reaches for
 * when something is in the way) sets this, and nothing shows the strip again
 * until the same key clears it. It survives every screen open in the session.
 */
let stripMuted = false;

/*
 * The build behind the screen: the account's loadout resolved for the slot
 * (`data/build.ts`), named through the item catalogue. The catalogue is
 * fetched once, lazily, the first time the screen is seen - a megabyte the
 * controller did not need until now and does not load for players who never
 * open the modding screen while the app runs.
 */
let itemDb: ItemDb | null = null;
let modDb: ModDb | null = null;
let cataloguesLoading = false;
/**
 * Planet -> the star chart's node ids on it. Null until the chart is fetched.
 * This is the other half of "WHEN you might get certain mods": without it the
 * overlay tells an account that has never left Earth to go and farm Deimos.
 */
let planetNodes: ReadonlyMap<string, string[]> | null = null;
/** The whole chart, kept for the unlock walk. Null until it is fetched. */
let starChart: Catalog | null = null;

/**
 * HAS THIS ACCOUNT SET FOOT ON THAT PLANET.
 *
 * Deliberately the weakest true claim rather than the strongest guess. A single
 * cleared node on a planet means the player has been there and can go back, so
 * the farm is a thing they can do tonight. The reverse - no cleared node - means
 * the planet is not open to them YET, which is exactly the word the overlay uses.
 *
 * Three cases return `null`, and null is rendered as silence rather than as a
 * warning: the chart has not loaded, the account's missions have never been
 * read, or the planet is not one the chart knows. Telling somebody they cannot
 * reach a place on the strength of an unread inventory would be worse than
 * saying nothing at all.
 */
function canReachPlanet(planet: string): boolean | null {
  if (!planetNodes) return null;
  const ids = planetNodes.get(planet);
  if (!ids || ids.length === 0) return null;
  const account = useAccount.getState().inventory as RawAccount | null;
  const missions = account?.Missions;
  if (!Array.isArray(missions)) return null;
  const cleared = new Set<string>();
  for (const m of missions) if (m?.Tag && (m.Completes ?? 0) > 0) cleared.add(m.Tag);
  // An account with no clears on record is unread, not stuck on Earth.
  if (cleared.size === 0) return null;
  return ids.some((id) => cleared.has(id));
}
/**
 * WHAT OPENS A PLANET, AND WHAT TO PLAY FIRST.
 *
 * `canReachPlanet` says whether a farm is available; this says what to do about
 * it when it is not. Between them they are the whole of "WHEN you might get
 * certain mods" that this app can honestly answer: not a date, which nothing
 * here could predict, but the prerequisite - how many nodes away the planet is
 * and which one is next.
 *
 * Null wherever the answer would be a guess: no chart, no clears on record (an
 * unread account is not an account stuck on Earth), or no path the chart knows.
 */
function unlockPath(planet: string): { nodes: number; node: string; nodeName: string } | null {
  if (!starChart) return null;
  const account = useAccount.getState().inventory as RawAccount | null;
  const missions = account?.Missions;
  if (!Array.isArray(missions)) return null;
  const cleared = new Set<string>();
  for (const m of missions) if (m?.Tag && (m.Completes ?? 0) > 0) cleared.add(m.Tag);
  const step = stepsToPlanet(starChart, cleared, planet);
  return step ? { nodes: step.nodes, node: step.next.id, nodeName: step.next.name ?? step.next.id } : null;
}

/** One immutable snapshot per change, so the strip's external-store read is stable between changes. */
let automodState: AutomodState = { session, build: null, plan: null, planAssumed: [], purse: NO_PURSE, ladder: [], ladderEnd: 'complete' };

/**
 * Both catalogues, once, the first time the screen is seen. The mod catalogue
 * is 5.7 MB on the wire and a few MB parsed; `loadModDb` rejects rather than
 * returning an empty catalogue, because an empty one would read as "no mods
 * exist". Either failure leaves the strip without a plan and says so.
 */
function ensureCatalogues(): void {
  if ((itemDb && modDb) || cataloguesLoading) return;
  cataloguesLoading = true;
  void Promise.all([
    itemDb ? Promise.resolve(itemDb) : loadItemDb(),
    modDb ? Promise.resolve(modDb) : loadModDb(),
  ])
    .then(([items, mods]) => {
      itemDb = items;
      modDb = mods;
      trace('catalogues ready', { items: items.byType.size, mods: mods.byPath.size });
      publishAutomod();
      /*
       * AND SHOW IT. The catalogue takes seconds to land, so the screen opens,
       * `showStrip` finds no plan yet and correctly declines - and before this
       * line nothing ever asked again. The plan then sat published and unseen
       * until the player placed a mod, which is precisely the thing the plan
       * exists to tell them not to guess at.
       */
      if (session.phase !== 'idle' && session.phase !== 'opened') void showStrip();
    })
    .catch((err: unknown) => {
      trace('catalogues FAILED - the overlay cannot plan without them');
      console.warn('[automod] a catalogue could not be loaded', err);
    })
    .finally(() => {
      cataloguesLoading = false;
    });
}

/*
 * THE PLAN runs here, not in a Worker - AND THE FIGURE THAT JUSTIFIED THAT HAD
 * DOUBLED WITHOUT ANYONE RE-READING IT.
 *
 * This said "one search at 81 ms and a whole plan at 293-621 ms", and concluded
 * that blocking the controller for "a fraction of a second" was the cheaper
 * trade. Re-measured today with `npm run bench` on the real catalogue (1,516
 * mods, 80 rifle candidates):
 *
 *     62.8 ms   one search, Q2
 *    564.2 ms   plan, weapon Q2, everything owned
 *  1,114.0 ms   plan, weapon Q2, HALF owned  <- the realistic account shape
 *    952.8 ms   plan, frame Q3, half owned
 *
 * The search got faster; the plan is now a FULL SECOND on the shape a real
 * account has, not a fraction of one. The argument above is therefore weaker
 * than it reads, and the reason it still stands is not the number: it is that
 * `showStrip` no longer waits behind this, because `publishAndShow` puts the
 * window up on the same publish and the memo below means only the first publish
 * of a visit pays at all (measured: eight publishes, 13,832 ms recomputed
 * against 1,691 ms memoised).
 *
 * If this figure grows again, the conclusion flips and the search belongs off
 * the controller. A comment carrying a stale measurement is how a decision
 * outlives the evidence for it - so re-run `npm run bench` before trusting the
 * numbers above, and rewrite them here when they move.
 *
 * ONCE PER OPEN IS WHAT THIS SAID AND NOT WHAT IT DID.
 * ----------------------------------------------------
 * `publishAutomod` calls this, and it fires on every session change - every mod
 * placed, every screen event, every hud line - and again on every inventory
 * push while the screen is open. So the half-second landed on the player each
 * time they touched a card, which is exactly the unresponsive overlay the brief
 * refuses, and the note above said otherwise for as long as it existed.
 *
 * The plan is a pure function of five things, and only those five: the item,
 * the account, the capacity, the grid, and the question. The purse is NOT among
 * them - it is read separately on every publish, which is what a fusion needs -
 * and neither is the edit list, because placing a mod does not change what the
 * best build is, only how much of it is already done. So the answer is cached
 * on exactly those five and the recompute happens when one of them moves.
 *
 * The account is keyed by IDENTITY, which is sound because `mergeInventory`
 * returns the same object when a push changed nothing; see `core/memo.ts`.
 */
const planCache = memoLast<{ plan: AutomodState['plan']; assumed: string[] }>();

function planFor(build: NonNullable<AutomodState['build']>): { plan: AutomodState['plan']; assumed: string[] } {
  if (!itemDb || !modDb || !build.itemType || build.unknown !== null) return { plan: null, assumed: [] };
  const item = itemDb.byType.get(build.itemType);
  if (!item) return { plan: null, assumed: ['the item is not in the catalogue'] };
  const account = useAccount.getState().inventory as RawAccount | null;
  const assumed: string[] = [];
  // The game's own dump names the base capacity at save; before a save the account's lifetime rank stands in, and says so.
  const rank = build.rankCurrent ?? session.dump?.initial ?? build.rankLifetime;
  if (build.rankCurrent === null && session.dump?.initial === undefined) assumed.push('current rank taken from lifetime affinity (Forma resets it; the next save will correct this)');
  /*
   * WHAT THE FIGURE LEAVES OUT ABOUT THIS WEAPON, derived from its own
   * catalogue row rather than recited. `uncountedAttacks` carries the reasoning;
   * it returns nothing at all for a gun, so no rifle plan wears a melee caveat.
   */
  assumed.push(...uncountedAttacks(item));

  // Which of the account's eleven polarity slots are the eight grid slots is not on the wiki; the lowest eight are taken, and this says so.
  let grid: string[] | null = null;
  if (build.polarities) {
    grid = [];
    let beyond = false;
    for (const p of build.polarities) {
      if (p.slot < 8) grid.push(p.value);
      else beyond = true;
    }
    if (beyond) assumed.push('slot indices 8-10 read as stance/exilus/arcane, not grid');
  }
  const slots = slotPlanFor({
    rank,
    maxRank: item.maxRank,
    masteryRank: account?.PlayerLevel ?? 0,
    catalyst: build.catalyst,
    stanceBonus: session.dump?.stanceBonus ?? null,
    gridPolarities: grid,
  });
  /*
   * THE QUESTION IS CHOSEN BY WHAT IS BEING MODDED, and the app decides rather
   * than offering a menu. A Warframe has no damage figure to maximise, so the
   * question is how much it can take; anything else is a weapon and the question
   * is damage. The overlay always prints which one it answered.
   *
   * This mattered more than it looked: replaying the player's own log showed
   * four of ten modding-screen visits were the Warframe slot, and before Q3 the
   * overlay resolved the frame and then had nothing to say on every one of them.
   *
   * A WEAPON IS ASKED Q2, NOT Q1, AND THAT WAS WRONG FOR A LONG TIME.
   * -----------------------------------------------------------------
   * Q1 is damage per second against UNARMOURED health. It is the honest floor -
   * everything it counts is exact - and it describes almost nothing a player
   * ever shoots. Grineer have armour, Corrupted have armour, and level scaling
   * makes it the dominant term long before the content this account plays.
   *
   * Q2 was written for that, gated by `check-armour`'s nineteen checks, and
   * then never selected by anything. It was dead code in production while the
   * overlay answered the easier question on every weapon in the game, which is
   * the opposite of "the absolute best version of the weapon".
   *
   * It is not a rewording of the same answer. Measured on this account's
   * catalogue, the ideal build differs on three of four weapons, and on the
   * player's own Broken War five of six mods change: Q1 wants critical damage,
   * Q2 wants status and slash - because bleed bypasses armour entirely, which
   * is precisely why real melee builds are built that way and paper ones are
   * not. Q2's answers look like builds people actually run.
   *
   * The cost is honesty about the target. Q2 names one - 2,700 armour, the
   * game's own cap - and the overlay prints that beside the figure ("dps ·
   * 2,700 armour") rather than letting a number stand for every enemy. Q1 stays
   * exactly as it is and is still what `check-optimise` measures the beam
   * against, because an exact objective is the only fair yardstick for that.
   */
  /*
   * A WARFRAME WAS NOT THE ONLY THING THAT GETS SHOT AT. `questionFor` decides
   * from the item's own type, and it says Q3 for a Sentinel, a Kavat, a Kubrow
   * and an Archwing too - all four carry the same three export fields Q3 reads.
   * The test used to be written here as a string comparison against 'Warframe',
   * which is exactly the shape that never grows.
   */
  const question = questionFor(item);

  /*
   * `assumed` is in the key as well as in the value. It is derived from the
   * same inputs, but it is derived HERE rather than by the search, so leaving
   * it out would let a changed assumption be served with the old wording.
   *
   * `modDb` is in the key because the catalogue arrives asynchronously: the
   * first plan of a session can be computed against a catalogue that has since
   * been replaced, and nothing else in the key would notice.
   */
  // Captured, not re-read: `modDb` is module state and the closure below runs
  // after this function returns, so narrowing it here is the only thing that
  // makes the catalogue in the key and the catalogue in the search the same one.
  const mods = modDb;
  /*
   * THE STAR CHART IS IN THE KEY, AND IT WAS NOT.
   *
   * `planBuild` is handed `canReach` and `unlockPath`, and both close over
   * module state that arrives asynchronously: `starChart`, assigned when
   * `loadCatalog()` resolves. Open the modding screen before that lands and
   * every route's `reachable` is null, nothing is ever blocked, and the
   * star-chart rung cannot be produced - and NOTHING invalidated the entry
   * afterwards, because item, mods, account, capacity, grid, question and
   * assumed were all unchanged. The reachability-blind plan was then served for
   * the rest of the visit.
   *
   * `memo.ts` states the rule this broke in as many words: every value the
   * result depends on has to be in the key. `mods` had exactly this hazard and
   * is keyed with a republish when it lands; the chart needed the same.
   */
  const key = [item, mods, starChart, account, slots.plan.capacity, slots.plan.grid.join('|'), question, assumed.join('|')];
  /*
   * A COUNTER, BECAUSE THE KEY CANNOT BE A TOKEN.
   *
   * This built a string from the cache key - and `item`, `mods` and `account`,
   * the three parts that actually distinguish one plan from another, are
   * objects and stringified to ''. Two different plans with the same capacity,
   * grid and question produced IDENTICAL tokens, which is routine: any
   * inventory push while the screen is open changes the account object, misses
   * the memo, and starts a second ladder whose token matches the first. Both
   * generators then appended to one shared array with independent step
   * counters, and whichever finished first declared the other complete.
   *
   * A monotonic counter cannot collide, which is the only property a generation
   * token needs.
   */
  const token = `ladder-${String(++ladderGeneration)}`;
  return planCache.get(key, () => {
    const t0 = performance.now();
    const result = planBuild({
      item,
      catalogue: [...mods.byPath.values()],
      owned: ownedRanks(account),
      slots: slots.plan,
      question,
      canReach: canReachPlanet,
      unlockPath,
    });
    trace('planned', {
      item: item.name,
      question,
      ms: Math.round(performance.now() - t0),
      hits: planCache.hits,
      misses: planCache.misses,
    });
    /*
     * The ladder is started here rather than by the caller, because HERE is the
     * only place that knows the plan was actually recomputed. `planCache.get`
     * hides that from everyone above it, which is the point of it - and a
     * ladder restarted on every publish would undo the whole saving.
     */
    startLadder({ item, catalogue: [...mods.byPath.values()], owned: ownedRanks(account), slots: slots.plan, question, canReach: canReachPlanet, unlockPath }, result, token);
    return { plan: result, assumed: [...assumed, ...slots.assumed] };
  });
}

/*
 * THE STAIRCASE, BUILT BETWEEN TIMEOUTS.
 *
 * `ladder` yields a rung when it commits one and null after each trial search,
 * and the nulls are what make this possible: the controller gets the turn back
 * about every 82 ms instead of being held for the second-and-a-bit a whole
 * ladder takes. The log tail, the watchdog and the strip's own placement all
 * live on this page and all of them would have waited for it.
 *
 * `ladderFor` is the generation guard. A new plan supersedes the ladder being
 * built for the old one, and without a token the old generator would keep
 * publishing rungs for a weapon the player has already put away - the same
 * class of bug as `stripGeneration`, and it fails just as quietly.
 */
/*
 * WHAT THE ARSENAL'S OTHER ROWS ARE, LEARNED FROM THE PLAYER'S OWN MODDING.
 *
 * Loaded once at start from what previous sessions worked out. See
 * `data/slot-learning.ts` for why this is a deduction rather than a guess: a
 * mod cannot be installed on a thing it is not compatible with, so the class of
 * the first mod placed on an unknown screen IS the class of the item.
 */
let learned: LearnedSlots = loadLearnedSlots(typeof localStorage === 'undefined' ? null : localStorage);

/*
 * WHEN THE CURRENT SCREEN OPENED, in wall time, or null when none has. The
 * account is a snapshot; this is the moment the app started doubting it. See
 * `openPolicy` - it is what stops the panel titling BROKEN WAR over an Ankyros.
 */
let openedAtWall: number | null = null;
/*
 * What the panel says when it named an item from a loadout it could not confirm.
 * It is an ITEM-SPECIFIC assumption - what could not be read about THIS open -
 * which is what earns a line in the column; the optimiser's standing rules do
 * not.
 */
const STALE_LOADOUT = 'the loadout could not be re-read for this screen, so this is the item the last read knew about';
/** The deadline for the read an open asks for; see `openPolicy`. */
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let ladderFor: string | null = null;
/** Monotonic, so two ladders can never share a generation token. */
let ladderGeneration = 0;
let ladderRungs: Rung[] = [];
let ladderEnd: LadderEnd = 'complete';
/*
 * THE PLAN THE RUNGS BELONG TO, and the reason it is an identity rather than a
 * flag.
 *
 * Closing the screen used to wipe the rungs. That looks right and is not: the
 * plan is MEMOISED, so reopening the same item on an unchanged account returns
 * the very same `Plan` object from the cache - a HIT - and `startLadder` runs
 * only inside the cache's producer. The staircase was therefore gone for good,
 * and the panel published `ladder: []` with `ladderEnd: 'complete'`, which it
 * reads as "nothing left to do": on a build with no mod steps left it printed
 * AT THE CEILING over a weapon with six Forma of work in front of it.
 *
 * So the rungs are not thrown away on a close. They are published only when the
 * plan on screen is the plan they were built for, which is a fact about the two
 * objects rather than about the session, and cannot go stale.
 */
let ladderPlan: Plan | null = null;

/*
 * HOW FAR AHEAD IS WORTH KNOWING.
 *
 * A ladder that runs to its own end is up to nine seconds of searching on the
 * real catalogue, and past the first handful of rungs it is describing a
 * weapon several Forma into the future. Six is what the overlay can say
 * something useful about - one instruction and the shape of what follows.
 *
 * THE SECOND HALF OF THIS SENTENCE USED TO CLAIM IT "keeps the controller's
 * total under a second and a half", AND THAT WAS WRONG BY A FACTOR OF TWO AND A
 * HALF. Measured: six rungs is 59 yields at about 63 ms a slice, 3,730 ms in
 * total. The horizon is still six, for the reason above - what the overlay can
 * usefully SAY - and not because of a budget it never met.
 *
 * What makes 3.7 seconds acceptable is the slicing and the yield, not the
 * total: the controller gets the turn back every 63 ms throughout, and since
 * `showInFlight` the pump stands aside entirely while the overlay is coming up,
 * so none of it is in front of the thing the player is waiting for.
 *
 * It is a horizon, not a claim: `ladderEnd` says which of the two ends this
 * was, so the overlay never presents a truncated ladder as a finished one.
 */
const LADDER_HORIZON = 6;

function startLadder(input: PlanInput, built: Plan, token: string): void {
  ladderFor = token;
  ladderPlan = built;
  ladderRungs = [];
  ladderEnd = 'working';
  const steps = ladderSteps(input, built);

  const pump = (): void => {
    if (ladderFor !== token) return; // superseded; this ladder is for a build nobody is looking at
    /*
     * The overlay is coming up. Give it the turn - see `showInFlight`. This
     * yields the whole slice rather than shortening it, because a slice's
     * ceiling is one search and a search cannot be interrupted part-way.
     */
    if (showInFlight()) {
      setTimeout(pump, 0);
      return;
    }
    const t0 = performance.now();
    let published = false;
    /*
     * Work in slices rather than one rung at a time: a rung is several searches
     * and yielding after each one keeps the slice short, while the 50 ms budget
     * keeps the number of timeouts down. Neither number is load-bearing - the
     * ceiling on a slice is one search, about 82 ms, whatever the budget says.
     */
    while (performance.now() - t0 < 50) {
      const out = steps.next();
      if (out.done) {
        ladderEnd = 'complete';
        published = true;
        break;
      }
      if (out.value !== null) {
        ladderRungs = [...ladderRungs, out.value];
        published = true;
        if (ladderRungs.length >= LADDER_HORIZON) {
          // `return` on the generator, not just an abandoned reference: it is
          // suspended inside its own loop and this is what lets it finish.
          steps.return(undefined);
          ladderEnd = 'horizon';
          break;
        }
      }
    }
    if (published) publishAutomod();
    if (ladderEnd === 'working') setTimeout(pump, 0);
    else trace('ladder', { rungs: ladderRungs.length, forma: ladderRungs.filter((r) => r.kind === 'forma').length, end: ladderEnd });
  };
  setTimeout(pump, 0);
}

function publishAutomod(): void {
  let build: AutomodState['build'] = null;
  let plan: AutomodState['plan'] = null;
  let planAssumed: string[] = [];
  /*
   * BOTH ANSWERS FROM ONE DECISION, and that decision lives in
   * `data/automod-publish.ts` where a gate can drive it.
   *
   * They were one bug: the ladder was cleared whenever `session.slot` was null,
   * and a learned arsenal row's slot is ALWAYS null - the reducer clamps
   * anything outside 0-3 and keeps the raw index in `unreadSlot`. So every
   * publish wiped the staircase on exactly the six categories it had just been
   * extended to cover, and every gate passed, because none of them could import
   * this file to find out.
   */
  const ladderAction = publishDecision({ session, learned });
  /*
   * NOTHING IS NAMED FROM A SNAPSHOT THE PLAYER HAS ALREADY MOVED PAST.
   *
   * The refresh asked for on the open is asynchronous, so resolving immediately
   * publishes the previous weapon with a whole plan under it. Better a beat of
   * silence - the read is urgent and lands in about a second - than a confident
   * wrong answer on the player's screen.
   */
  /*
   * TWO WAYS A READ CAN LAND, and only one of them moves `inventoryAt`.
   *
   * The store stamps `inventoryAt` on a real CHANGE - a repeated identical push
   * is dropped cheaply and deliberately - so an open onto an account that has
   * not changed since the last read never saw its answer arrive. That is the
   * ordinary case, and it spent the full settle window and then printed a
   * caveat saying the loadout could not be re-read. It had been.
   *
   * `gep.answeredAt` is the other half: the game answered, and said nothing was
   * different. The later of the two is when the app last knew where it stood.
   */
  const account = useAccount.getState();
  const policy = openPolicy({ opened: false, openedAtWall, changedAt: account.inventoryAt, answeredAt: account.answeredAt });
  const settled = policy.nameable;
  /*
   * SETTLED BY TIMEOUT IS NOT SETTLED BY A READ, and the difference belongs on
   * the panel. This is the case where the app waited for a fresh loadout, never
   * got one, and is naming the item from a snapshot it knows may be a swap out
   * of date.
   */
  const staleLoadout = policy.stale;
  /*
   * TWO TERMS, ONE NAME. A screen has to be open AND the loadout we hold has to
   * still be the one the player is wearing. Spelling that conjunction twice is
   * how the build and the ladder came to disagree the first time, so it is
   * spelled once and used by name.
   */
  const nameable = ladderAction.kind === 'keep' && settled;
  /*
   * RESOLVED BY CATEGORY, NOT BY SLOT INDEX.
   *
   * This used to require `session.slot !== null` - one of the four indices this
   * app was born knowing - so a companion or archwing screen produced no build
   * at all even after the app had worked out what that screen was. `openCategory`
   * answers for both cases: a known index, or an index a previous mod placement
   * taught it the meaning of - and the build resolves on the SAME answer the
   * ladder is kept on, which the kept action carries. Two spellings of one
   * condition is how those two came to disagree.
   */
  if (nameable) {
    const resolved = resolveIn(useAccount.getState().inventory as RawAccount | null, ladderAction.category);
    build = { ...resolved, name: resolved.itemType ? (itemDb?.byType.get(resolved.itemType)?.name ?? null) : null };
    const planned = planFor(build);
    plan = planned.plan;
    planAssumed = staleLoadout ? [...planned.assumed, STALE_LOADOUT] : planned.assumed;
  }
  /*
   * The purse is read on EVERY publish, not once: Endo and credits move while
   * the player is on this screen - a fusion spends them, and the mod they just
   * ranked is exactly the case where the next recommendation's affordability
   * has changed underneath the strip.
   */
  const purse = purseOf(useAccount.getState().inventory as { RegularCredits?: number; FusionPoints?: number } | null);
  /*
   * THE RUNGS ARE PUBLISHED ONLY FOR THE PLAN THEY WERE BUILT FOR.
   *
   * Identity, not a flag: `planCache` returns the SAME `Plan` object on a hit,
   * so a reopen of an unchanged item still matches and the staircase is there
   * instantly; a different item, a changed account or a new grid produces a
   * different object, which misses the cache, which starts a ladder of its own.
   * Anything else on screen gets an empty ladder that says 'working' rather than
   * 'complete' - because "no rungs yet" is not "there is nothing left to do",
   * and the panel prints AT THE CEILING on the second of those.
   */
  const showing = ladderToShow(plan, ladderPlan, { rungs: ladderRungs, end: ladderEnd });
  automodState = { session, build, plan, planAssumed, purse, ladder: showing.rungs, ladderEnd: showing.end };
  if (session.phase !== 'idle') {
    trace('plan', {
      item: build?.name ?? 'unnamed',
      /*
       * "none" USED TO MEAN TWO THINGS. `build?.unknown ?? 'none'` printed the
       * same word for a build that resolved perfectly and for no build at all,
       * and the live trace read `item=unnamed unknown=none` on a screen the app
       * had not identified - which parses as success. The rung it stopped at, or
       * the fact that it never started.
       */
      unknown: build ? (build.unknown ?? 'none') : 'no build',
      now: plan ? Math.round(plan.now.score.value) : null,
      ideal: plan ? Math.round(plan.ideal.score.value) : null,
      steps: plan?.next.length ?? 0,
      forma: plan?.forma.count ?? 0,
      endo: purse.endo,
    });
  }
  for (const fn of sessionListeners) fn();
}

// Published like `codexStore`: the strip window reads it through getMainWindow().
(
  window as unknown as {
    automodFeed: { get: () => AutomodState; subscribe: (fn: () => void) => () => void; mute: () => void };
  }
).automodFeed = {
  get: () => automodState,
  subscribe: (fn) => {
    sessionListeners.add(fn);
    return () => sessionListeners.delete(fn);
  },
  /** The overlay's own close control, which is the same mute the hotkey sets. */
  mute: () => {
    stripMuted = true;
    hideStrip();
  },
};

/*
 * IS THERE ANYTHING TO SAY?
 *
 * An overlay that takes a column of the player's screen to report that it does
 * not know what the item is, or that nothing has changed yet, is not an overlay
 * - it is something in the way. The strip appears when it has an ANSWER: a plan
 * to show, or edits to reflect back. Every other state is silence, and the
 * desktop window is where a player goes to find out why.
 */
// The rule itself lives in `data/automod-publish.ts`, where a gate can drive
// it; this is the module-state read that feeds it.
const somethingToSay = (): boolean => hasSomethingToSay(automodState);

/**
 * PUBLISH AND SHOW, TOGETHER, EVERY TIME.
 *
 * THE BUG THIS EXISTS TO END, and it is the whole of "the overlay took forever
 * to appear". There were four callers of `showStrip` - the catalogue load, an
 * arsenal SESSION-STATE CHANGE, and the two hotkeys - and not one of them was
 * on the path where the plan actually becomes available.
 *
 * The ordinary open goes: the log names the slot, the app asks GEP for the
 * account and refuses to name the item until it answers, `showStrip` fires on
 * the HudVis line five hundred milliseconds later, finds no plan yet and
 * correctly declines. Then GEP answers, the plan appears - and the two handlers
 * that learn about it, `gep.on('answered')` and the settle deadline, each
 * published the new state to a window nobody had put on the screen. Every
 * arsenal line after that folds to the same session object and returns early,
 * so nothing ever asked again.
 *
 * The overlay therefore appeared when the player next PLACED A MOD, which is an
 * unbounded wait and is exactly the reported symptom: it took forever, and then
 * it was there. Every other cost in this path - the catalogue fetch, the second
 * of beam search, five Overwolf round trips - is bounded and adds to under two
 * seconds. This one had no bound at all.
 *
 * So the two are one call. A publish is the app learning something; if what it
 * learned is worth showing, `showStrip` is the function that decides that, and
 * it already refuses on every ground it should (muted, nothing to say, no area
 * yet, superseded). Making them separate is what let one exist without the
 * other, and the fix that does not depend on remembering is not to add two more
 * call sites but to leave one way to do it.
 */
function publishAndShow(): void {
  publishAutomod();
  // 'opened' is the slot press with nothing read yet; the strip has no answer
  // for it and `showStrip` would only refuse. Same guard as the arsenal path.
  if (session.phase !== 'idle' && session.phase !== 'opened') void showStrip();
}

/**
 * WHILE THE OVERLAY IS ON ITS WAY UP, NOTHING ELSE GETS THE TURN.
 *
 * The ladder runs in 50 ms slices between timeouts, which is what stops a
 * second and a half of beam search from freezing this page. But `showStrip`'s
 * Overwolf calls come back as tasks too, so every round trip it makes queues
 * BEHIND whatever slice is running - and the ladder is at its busiest at
 * exactly the moment the overlay is trying to appear, because both are started
 * by the same publish. Measured, a slice runs about 63 ms and the show needs
 * two round trips, so the ladder was adding roughly an eighth of a second to
 * the one thing the player is waiting for.
 *
 * The staircase is worth nothing until the panel is on screen to show it on, so
 * the pump stands aside. `since` bounds it: an Overwolf call that never calls
 * back must not be able to stop the ladder for the rest of the session.
 */
const SHOW_GRACE_MS = 2_000;
let showingSince: number | null = null;
/** True while a show is in flight, and not for longer than one could plausibly take. */
const showInFlight = (): boolean => showingSince !== null && Date.now() - showingSince < SHOW_GRACE_MS;

async function showStrip(): Promise<void> {
  // Not a no-op: a strip already up whose plan has gone must come DOWN, or the
  // player is left looking at an overlay that has nothing left to tell them.
  if (stripMuted || !somethingToSay()) {
    if (stripShown) trace('taking it down', { muted: stripMuted, hasAnythingToSay: somethingToSay() });
    hideStrip();
    return;
  }
  /*
   * NO AREA, NO SHOW. The manifest declares the overlay 1440 x 900, and
   * `placeWindow` is what makes it the game's client area instead - so a show
   * that runs before Overwolf has reported the dimensions restores a window at
   * 1440 x 900 over whatever resolution the game is actually running. The page
   * inside then computes its scale from that, and every mark lands on the wrong
   * card.
   *
   * It is a narrow window - `watchGame` queries an already-running game at
   * registration - but the log tail and the game feed are independent, so an
   * arsenal line can arrive first on a fast start.
   *
   * Returning is right rather than showing unplaced: arsenal lines arrive
   * continuously while the screen is open, so the next one shows it correctly,
   * and a moment of nothing beats a grid drawn in the wrong place.
   */
  if (!area) {
    trace('not showing yet: the game has not reported its size');
    return;
  }
  if (stripCloseTimer) {
    clearTimeout(stripCloseTimer);
    stripCloseTimer = null;
  }
  // The generation this show belongs to. Anything that takes the overlay down
  // from here on makes this show stale, whatever its reason was.
  const generation = stripGeneration;
  /*
   * THE AWAITED PART IS WRAPPED, NOT SPLIT INTO A SECOND FUNCTION.
   *
   * It was split, so that one `finally` could cover both round trips - and two
   * gates in `check-strip-life.ts` read `showStrip`'s body by matching from its
   * signature to the first closing brace, to assert that the area guard comes
   * before the placement and that the generation is re-checked after BOTH
   * awaits. Moving the awaits into a second function left both of them reading
   * a body with no awaits in it, so one passed on an empty claim and the other
   * reported the opposite of the truth. A refactor that makes a gate stop
   * looking at the thing it names is worse than the duplication it removed.
   */
  showingSince = Date.now();
  try {
    // Size before show, so the first paint is already in the column.
    await placeWindow(WINDOW.automod, fullBox(area)).catch((err: unknown) => console.warn('[automod] place', err));
    /*
     * RE-CHECK AFTER THE AWAIT. `placeWindow` is two round-trips to Overwolf, and
     * a player who presses the hide key inside that window had their answer
     * thrown away: the mute was set, `hideStrip` ran against a flag this function
     * had not raised yet, and then this line put the strip up anyway. Pressing
     * the key again UNMUTES, so the overlay took three presses to dismiss and
     * taught the player the key was broken. The same window swallowed the panic
     * key and a game exit.
     */
    /*
     * SUPERSEDED IS NOT THE SAME AS MUTED. The generation check covers every way
     * out - the panic key, the close control, the watchdog, a game exit - and the
     * mute check below covers the one that also has to STAY down.
     */
    if (generation !== stripGeneration) {
      trace('the show was superseded while placing the window');
      return;
    }
    if (stripMuted || !somethingToSay()) {
      hideStrip();
      return;
    }
    armWatchdog(false);
    if (!stripShown) {
      trace('showing', { area: area ? `${String(area.width)}x${String(area.height)}` : 'unknown' });
      stripShown = true;
      // A failed restore must not leave the flag raised: the next panic key reads
      // it, mutes, and the feature is silently dead for the rest of the session.
      await restoreWindow(WINDOW.automod).catch((err: unknown) => {
        stripShown = false;
        console.warn('[automod] restore', err);
      });
      /*
       * AND AGAIN AFTER THE RESTORE, which is the longer of the two awaits: a key
       * pressed while the window is coming up would otherwise leave it up, with
       * `stripShown` true and the player's answer discarded.
       */
      if (generation !== stripGeneration) {
        trace('the show was superseded while restoring the window');
        stripShown = false;
        void hideWindow(WINDOW.automod);
        return;
      }
      // After the restore, not before: the style applies to a window that exists.
      // The manifest declares it as well; this is the belt to that pair of braces.
      if (stripShown) void setInputPassThrough(WINDOW.automod);
    }
  } finally {
    showingSince = null;
  }
}

/**
 * Push the silence deadline out. Called for every arsenal line, not only for shows.
 *
 * `fresh` is the difference between the LOG saying the screen is still there
 * and this app merely putting the window back up. A re-show inherits whatever
 * is left of the deadline; only a real arsenal line restarts it. Without that,
 * anything that re-shows the strip - the panic key, the companion panel closing
 * - would hand a screen the player left ninety more seconds of overlay, which
 * is precisely the stuck-strip bug the watchdog exists to end.
 */
function armWatchdog(fresh = true): void {
  if (fresh) stripLiveAt = Date.now();
  if (stripWatchdog) clearTimeout(stripWatchdog);
  const left = STRIP_SILENCE_MS - (Date.now() - stripLiveAt);
  if (left <= 0) {
    hideStrip();
    return;
  }
  stripWatchdog = setTimeout(() => {
    stripWatchdog = null;
    hideStrip();
  }, left);
}

/** Is the log still narrating the screen this strip is about? */
const stripIsLive = (): boolean => Date.now() - stripLiveAt < STRIP_SILENCE_MS;

function hideStrip(): void {
  if (stripWatchdog) {
    clearTimeout(stripWatchdog);
    stripWatchdog = null;
  }
  /*
   * NO EARLY RETURN ON `!stripShown`. That guard is what made the reported bug
   * unfixable: `stripShown` lives in this page, the OW window does not, and a
   * background page that restarts - a crash, an extension reload, auto-refresh
   * in development - comes up with the flag false while the overlay is still on
   * the player's screen. Every route out then died here: the hotkey tested the
   * same flag, the panic key tested it, and the strip's own close button called
   * this function. The window outlived the code that could reach it, which is
   * exactly what the player photographed - a strip running a page from an
   * older build with no key and no button able to touch it.
   *
   * Hiding a window that is already hidden costs one no-op OW call. Being
   * unable to hide one that is not is unfixable from inside the app.
   */
  if (stripShown) trace('hidden');
  // Before the flag, so a `showStrip` resuming from an await sees the bump even
  // if it reads the flag first.
  stripGeneration++;
  stripShown = false;
  /*
   * THE EXIT IS INSTANT, AND THAT IS A DECISION, NOT AN OVERSIGHT.
   *
   * The overlay arrives over about 700 ms - eight slots dealt on a 55 ms
   * stagger, the aside assembling behind them. It leaves in zero. An entrance
   * with no exit is the classic tell of animation added for its own sake, and
   * anybody reading the design creed will want to add one here.
   *
   * DO NOT. The exit is an Overwolf window hide, and CSS cannot animate a
   * window disappearing. Playing an exit means keeping the window VISIBLE while
   * it runs and hiding it on a timer afterwards - which puts a delay between
   * the decision to hide and the hiding, and that is the precise shape of the
   * bug the player photographed: a strip stuck on screen with every route out
   * dead. The `!stripShown` guard above was the same class of mistake and cost
   * an evening.
   *
   * The one place an exit would be felt is the 90-second watchdog firing while
   * the player is still reading, and the fix for that is the watchdog being fed
   * by every line the log narrates - which `observeArsenal` now does - not a
   * fade that also delays the panic key.
   *
   * What DOES animate is every change made while the window is up: a mod placed
   * turns a plate into a tick, and the tick is a new element, so its entrance
   * runs. That is the transition a player actually watches.
   */
  /*
   * AND IF THE HIDE IS REFUSED, TRY ONCE MORE.
   *
   * `hideWindow` used to discard its result. A refused hide leaves the overlay
   * on screen with `stripShown` already false - the precise state the player
   * photographed, and the state every route out then reads as "already gone".
   * One retry on the next tick covers the transient case; if that fails too,
   * the close below destroys the page, which is the stronger hammer and was
   * always going to run anyway.
   */
  void hideWindow(WINDOW.automod).then((hidden) => {
    if (!hidden) {
      trace('the hide was refused; trying once more');
      setTimeout(() => void hideWindow(WINDOW.automod), 0);
    }
  });
  stripCloseTimer = setTimeout(() => {
    stripCloseTimer = null;
    void closeWindow(WINDOW.automod);
  }, STRIP_CLOSE_AFTER_MS);
}

function observeArsenal(event: Parameters<typeof step>[1]): void {
  /*
   * PROOF OF LIFE COMES FIRST, before the identity check below.
   *
   * Six of the fourteen arsenal lines fold to the same session object - the
   * repeated open, the slot press, the HUD-visible line, an ownership line, a
   * drain line - and returning early on those meant the watchdog was fed only
   * by lines the PLAYER causes: placing a mod, a fusion quote, a save. A player
   * who put a mod in and then read the recommendation for ninety seconds had
   * the overlay vanish while they were still looking at it. The screen is still
   * open if the log is still narrating it, whatever the line says.
   */
  /*
   * The STAMP is unconditional and the TIMER is not. A strip that is down for a
   * reason of its own - the companion panel is up over it - still has a screen
   * behind it that the log is narrating, and something has to remember that or
   * the strip can never be brought back to it.
   */
  stripLiveAt = Date.now();
  if (stripShown) armWatchdog(false);
  const next = step(session, event, pending);
  /*
   * THE ARSENAL ROW THIS APP WAS NOT BORN KNOWING, ANSWERED BY THE PLAYER.
   *
   * A mod cannot be installed on an item it is not compatible with, so the
   * catalogue class of the first mod placed on an unrecognised screen IS the
   * class of the thing being modded. That turns the one genuinely unknown
   * integer - which arsenal row emits which index - from something nobody could
   * find out into something the player's own modding settles, once, for good.
   *
   * `session` rather than `next` is read for the screen, because `step` has
   * already folded the placement in and both carry the same open. Only an
   * UNAMBIGUOUS class is taken: an operator arcane says `ANY` and a per-frame
   * augment says `Ash`, and neither names an arsenal row.
   */
  /*
   * TWO SIGNALS, AND THE SECOND NEEDS THE PLAYER TO DO NOTHING.
   *
   * `modInstalled` is the immediate one: a mod cannot go on a thing it is not
   * compatible with, so a placement names the item's class outright. But a
   * player can open a companion's mods, look, and leave - and then nothing was
   * learned, which is exactly what happened the one time this account opened an
   * index past the four.
   *
   * `modOwned` is the duplicate-card warning the card screen emits, and the
   * project's own notes had it down as "state, not a change - NOT an on-open
   * dump". Measured against 548,446 lines of the real log that is wrong in the
   * respect that matters: 58 of them fired INSIDE an open, 375-454 lines after
   * it, and every single one was melee-compatible on a melee screen (`Melee`
   * x57, `Swords` x1). A screen listing every duplicate on the account would
   * have shown WARFRAME and Rifle classes too. It is filtered to the item being
   * modded, so it identifies it.
   *
   * So the screen teaches on a visit, and the placement teaches faster. Both go
   * through the same deduction.
   */
  let taught = false;
  if ((event.type === 'modInstalled' || event.type === 'modOwned') && modDb) {
    const lesson = lessonFrom({ unreadSlot: session.unreadSlot, compatName: modDb.byPath.get(event.itemType)?.slot });
    if (lesson) {
      const before = learned;
      learned = learnSlot(learned, lesson.index, lesson.category, typeof localStorage === 'undefined' ? null : localStorage);
      taught = learned !== before;
      if (taught) trace('learned what an arsenal slot is', { index: lesson.index, category: lesson.category, from: event.type });
    }
  }
  /*
   * THE ONE QUESTION THIS APP CANNOT ANSWER FROM ITS OWN CAPTURE, asked of the
   * player's real play instead.
   *
   * Four arsenal slots are handled; whether a companion, archwing or necramech
   * screen emits a fifth index has never been observed. This line is what makes
   * a single such visit settle it - and until it appears in somebody's trace,
   * "the overlay only covers four slots" is a measured limit rather than a
   * guess in either direction.
   */
  if (pending.unrecognised !== null) {
    trace('an upgrade slot this app does not recognise', { index: pending.unrecognised });
    pending.unrecognised = null;
  }
  /*
   * A LESSON IS A CHANGE, even when the session object is not.
   *
   * `step` returns the same object for `modOwned` - it is state, not a
   * transition - so this early return fired before `publishAutomod` and the
   * screen never heard about what had just been worked out. The whole point of
   * that signal is the player who opens a companion's mods, LOOKS, and leaves:
   * on that visit they saw nothing change, and the knowledge only paid off next
   * session. Now the plan is republished the moment the row is identified.
   */
  if (next === session) {
    if (taught) publishAutomod();
    return;
  }
  /*
   * THE ARSENAL EQUIPPING SOMETHING, which is the same log line as a modding
   * save and is told apart by there being no screen open. That is the moment
   * the account's loadout stops describing what the player is wearing - and
   * DE writes no inventory record for it, so the only way to catch up is to ask
   * GEP, now, rather than at the top of the next minute.
   */
  /*
   * THE ARSENAL'S EXIT SAVE IS NOT AN EQUIP, and treating it as one was worse
   * than not watching for equips at all.
   *
   * `OnSaveLoadOutCompleteCommon` fires 7 ms before the arsenal screen closes,
   * whether or not anything changed - measured on a real session where the
   * player equipped nothing. Marking the loadout stale there put a permanent
   * false caveat on the panel and parked the session at `saved`, which made the
   * detector deaf to the real thing.
   *
   * It is still worth a READ - the account may well have moved - but a gentle
   * one, behind the same one-minute floor as everything else. The moment that
   * actually matters, the screen opening, is handled below.
   */
  if (event.type === 'loadoutSaved' && session.phase === 'idle') gep.refresh('the arsenal wrote a loadout');
  const was = session.phase;
  const openedAtBefore = session.openedAt;
  session = next;
  if (was !== next.phase) trace('phase', { from: was, to: next.phase, slot: next.slot ?? 'none', edits: next.edits.length });
  /*
   * THE ACCOUNT IS RE-READ WHEN A MODDING SCREEN OPENS, and the reason is the
   * worst thing this overlay has done on screen.
   *
   * IT USED TO TEST `was === 'idle' && next.phase !== 'idle'`, AND THAT FIRED ON
   * THE CLOSE. The game emits a trailing `HudVis 1` about 200 ms AFTER
   * `GoToPreviousScreen`, and the reducer turns a `hudVisible` arriving at idle
   * into `phase: 'visible', seenWithoutOpen: true`. Driven over the whole of
   * this machine's EE.log - 697,130 lines - there are 16 idle-to-non-idle
   * transitions and 15 of them are that phantom. The session then sits at
   * visible/saved/editing for as long as the player keeps playing, so every
   * REAL open after the first arrives from a non-idle phase and was skipped.
   *
   * `openedAt` is the honest signal: the reducer sets it, and only ever sets
   * it, on a screen the log says was opened.
   *
   * Caught live: the player was modding an UNRANKED ANKYROS - 1 of 22 capacity,
   * one mod on it - and the strip said BROKEN WAR, 951 of 2,738, with plates
   * and ticks placed for a nine-mod build that was not there. Nothing was wrong
   * with the plan; the plan was for the melee the ACCOUNT said was equipped,
   * read eleven minutes earlier, before the player swapped weapons. Every mark
   * on the game's own cards was then in the wrong place, which is what an
   * overlay looks like when it is confidently out of date.
   *
   * A loadout change is not a mission, so `inventoryDurable` never fires for it
   * and the only other read is the once-per-session seed. Opening the upgrade
   * screen is the moment the equipped item matters, and it is the moment right
   * after the player was in the arsenal changing it - which is exactly the
   * "a fresh read returns something different" test `refresh` documents.
   *
   * It stays gentle: this is an EVENT, not a poll, it fires once per open
   * rather than per line, and `refresh` enforces its own one-minute floor
   * whatever this asks for.
   */
  if (opensAScreen({ openedAt: openedAtBefore }, next)) {
    /*
     * THE ONE MOMENT THE ANSWER MATTERS. The account is a snapshot and the
     * player may have changed what they are wearing since it was taken, so the
     * read is urgent - and until it lands, or the wait runs out, nothing is
     * named. `openPolicy` is that decision; this records when the wait started.
     */
    openedAtWall = Date.now();
    gep.refresh('a modding screen opened', true);
    /*
     * AND THE DEADLINE IS SCHEDULED, because nothing else would reach it. The
     * publish sites all need an event, and the event being waited for is
     * precisely the one that may never come: a read carrying nothing new is
     * dropped before the store sees it. Without this timer the panel stayed
     * blank for the whole visit - measured, a real visit ran 88 seconds with no
     * arsenal line at all after its first two.
     */
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      // The other way a plan first appears: GEP never answered and the app
      // gave up waiting, so the item is named from the log alone. Same
      // omission, same fix.
      if (session.phase !== 'idle') publishAndShow();
    }, SETTLE_WAIT_MS + 50);
  }
  if (next.phase !== 'idle') ensureCatalogues();
  if (next.phase === 'idle' && was !== 'idle') {
    publishAutomod();
    hideStrip();
  } else publishAndShow();
}

/**
 * THE GAME'S CLIENT AREA, TRACKED WITHOUT TRUSTING A FLAG TO TELL US.
 *
 * `area` is what every rectangle the overlay draws is computed from, and it was
 * refreshed only when Overwolf's `onGameInfoUpdated` set `resolutionChanged`.
 * That makes the overlay's geometry depend on one boolean being right about
 * every way a game window can change size - a windowed resize, a borderless
 * toggle, a monitor change, a DPI change - and if it is ever wrong the marks
 * sit on the wrong cards with nothing to say why.
 *
 * So this now runs on every change and decides for itself, by comparing the
 * dimensions. The cost of that is one comparison; the placement, which is two
 * round-trips to Overwolf, still only happens when the box actually moved, so
 * alt-tabbing does not cause any work at all.
 */
function observeGame(info: GameSnapshot): void {
  const next = gameArea(info);
  const moved = area?.width !== next?.width || area?.height !== next?.height;
  area = next;

  /*
   * IF THE LOGICAL SIZE IS MISSING, SAY SO. `gameArea` falls back to the
   * PHYSICAL width and height, which are equal to the logical ones only at
   * 100 % display scaling. At 125 % or 150 % - the default on most laptops -
   * the window would be placed at physical size while the page inside measures
   * CSS pixels, and the grid would be drawn at the wrong scale over the game's
   * cards with nothing anywhere saying why.
   *
   * It is not corrected here: the app cannot know which monitor the game is on,
   * and guessing a ratio from the background page's own would be worse than the
   * fallback. What it can do is stop being silent about it.
   *
   * Said once per change rather than once per update: this handler is now given
   * EVERY game-info update, because the flags saying which ones were resizes
   * were not reliable enough to filter on. A note repeated at that rate is not
   * a note, it is noise that hides the rest of the trace.
   */
  if (moved && (info.logicalWidth === undefined || info.logicalHeight === undefined)) {
    trace('the game reported no logical size; placement falls back to physical pixels and will be wrong if the display is scaled', {
      width: info.width ?? null,
      height: info.height ?? null,
    });
  }

  if (stripShown && area && moved) {
    trace('the game resized; following it', { area: `${String(area.width)}x${String(area.height)}` });
    void placeWindow(WINDOW.automod, fullBox(area));
  }
}

/*
 * MISSION HISTORY.
 *
 * `data/missionlog.ts` (791 lines) and `data/history-store.ts` (481 lines) are
 * complete, both are exercised by `npm run check` - and until now nothing in the
 * app imported either of them. The only thing done with a finished run was
 * `addLiveClear(run.node)`: a node id and a boolean. Every other field the
 * tracker assembles - what the mission was, how long it took, whether it
 * succeeded, the squad, the syndicate standing, and the loot the inventory diff
 * attributes to it - was constructed and dropped on the floor, and nothing was
 * ever written to the history database.
 *
 * That is the largest "not thorough enough" in the app: the data is destroyed at
 * the only moment it exists, so no later feature can recover it. The wiring is
 * the three calls missionlog.ts documents at its own class comment.
 *
 * The `before` snapshot is LATCHED FROM WHAT THE STORE ALREADY HOLDS, never a
 * fresh read: asking the game for a snapshot at mission start would be exactly
 * the memory poll gep.ts exists to prevent. The `after` side arrives on the push
 * that the existing `inventoryDurable` refresh produces.
 */
let recorder: MissionRecorder | null = null;

function keep(record: MissionRecord | null): void {
  if (!record) return;
  void appendMission(record).catch((err: unknown) => {
    console.warn('[history] a finished run could not be stored', err);
  });
}

// The star chart names the node a run happened on. It is fetched, so the
// recorder starts without it and is replaced once the catalog lands; a run
// recorded in that window still carries its node id, just not its name.
void loadCatalog().then((loaded) => {
  recorder = new MissionRecorder(loaded.catalog.nodeById.values());
  planetNodes = loaded.catalog.planetNodes;
  starChart = loaded.catalog;
  trace('star chart ready', { planets: planetNodes.size });
  /*
   * AND REPUBLISH. The chart is in the plan's cache key, so a plan computed
   * before it landed is now a miss rather than a stale hit - but only if
   * something asks again. A screen already open would otherwise keep the
   * reachability-blind plan until the player closed it.
   */
  if (session.phase !== 'idle') publishAutomod();
});

watchGame({
  onStart: (info) => {
    /*
     * The whole chain starts here, and until this line existed the log could not
     * say whether it ever had. `watchGame` also queries an ALREADY-running game
     * at registration, which is the case that matters when the app reloads
     * mid-session - and was, until now, entirely unobserved.
     */
    trace('game up', { area: `${String(info.logicalWidth ?? info.width)}x${String(info.logicalHeight ?? info.height)}` });
    useAccount.getState().setGameRunning(true);
    /*
     * THE CATALOGUES START LOADING WHEN THE GAME DOES, not when the player is
     * already standing in front of the screen waiting for an answer.
     *
     * They were fetched on the first non-idle phase, so the first modding screen
     * of every session paid for 882 items and 1,516 mods before the panel could
     * say anything - "it took absolutely forever to load", in the player's
     * words, and their own trace shows `catalogues ready` arriving after the
     * open with a `now=null` plan published in front of it.
     *
     * This is not a new read: `gentle` serves both from the same cache with the
     * same policy, and doing it here only moves it to a moment when nobody is
     * waiting.
     */
    ensureCatalogues();
    observeGame(info);
    gep.connect();

    // EE.log names the node the moment a mission ends, well before GEP pushes a
    // refreshed inventory. Tailing it is how progress appears immediately without
    // asking the game for anything extra.
    stopLogTail?.();
    stopLogTail = tailEeLog(
      (run) => {
        if (run.success && run.node) useAccount.getState().addLiveClear(run.node);
        keep(recorder?.observeRun(run) ?? null);
      },
      {
        onLogin: (username) => useAccount.getState().setUsername(username),
        /*
         * The one place the app asks the game for anything beyond its
         * once-per-session seed.
         *
         * `DbUpdateComplete` is the game telling us the server has finished
         * writing a run's inventory changes — the exact moment a fresh read
         * returns something new. eelog.ts was built to detect this and nothing
         * was listening, which is why a session could go a long time showing
         * correct-but-old numbers.
         *
         * This is event-driven, not a poll: no timer, no interval, and `refresh`
         * enforces its own one-minute floor regardless.
         */
        onEvent: (event) => {
          /*
           * Seventeen event types are parsed and three are branched on below.
           * The ledger keeps all of them, each at its own moment rather than
           * folded into the run's summary — which is what makes matchmaking
           * wait, load-vs-waiting time and attribution latency answerable at
           * all. See `data/ledger.ts`.
           */
          void appendLedger(ledgerFromEvent(event, Date.now(), useAccount.getState().username ?? ''));
          if (event.type === 'inventoryDurable') gep.refresh('inventory durable');
          // Latches `before` at mission start and marks the durable write; see
          // the MissionRecorder comment above.
          keep(recorder?.observeEvent(event) ?? null);
          observeArsenal(event);
        },
      },
    );

    void restoreWindow(WINDOW.ingame);

    /*
     * A session is beginning, so what is on disk is where the player left off.
     * The next write rolls it back one generation and the delta the header
     * draws then means "while you were away" rather than "since the last push".
     */
    rollGenerationOnNextSave();
  },
  /*
   * EVERY change, not only the ones Overwolf labels a resolution change.
   * `observeGame` compares the dimensions itself and places only when they
   * actually moved, so this costs a comparison on a focus change and nothing
   * else - and the overlay's geometry stops depending on that flag being right
   * about every way a game window can change size.
   */
  onChange: (info) => {
    observeGame(info);
  },
  onStop: () => {
    trace('game gone');
    useAccount.getState().setGameRunning(false);
    // Nothing has answered since the game exited, and the panels print this
    // time. `gep.disconnect()` clears its own copy on the line below.
    useAccount.getState().setAnswered(null);
    gep.disconnect();
    stopLogTail?.();
    stopLogTail = null;
    session = IDLE;
    publishAutomod();
    hideStrip();
    // A run still waiting on its post-mission snapshot will never get one now.
    // Closing it unattributed keeps the mission itself, which is the honest
    // outcome; `flush` marks it as having no attributed loot.
    keep(recorder?.flush() ?? null);
    useAccount.getState().setHighlighted(null);
    void hideWindow(WINDOW.ingame);
  },
});

// Ctrl+K. The manifest scopes this hotkey to Warframe, so it can't collide with
// the user's bindings in other games.
onHotkeyPressed(TOGGLE_HOTKEY, () => {
  /*
   * THE PANEL DOES NOT TAKE THE MOUSE.
   *
   * It used to declare `focus_game_takeover: ReleaseOnHidden`, which hands the
   * app the cursor in any "mouse-less" game state and keeps it until the window
   * hides - so opening the panel mid-mission stopped the player turning. It now
   * declares `InputPassThrough` instead, and this re-asserts it on every open
   * for the same reason the strip does: a manifest flag that silently failed to
   * apply would look exactly like the bug.
   *
   * The trade, stated: during a mission the game keeps the cursor, so the panel
   * is readable but not clickable there. It is clickable everywhere the game
   * shows a cursor of its own, which is where a loadout companion is used.
   */
  void toggleWindow(WINDOW.ingame).then((panel) => {
    setInputPassThrough(WINDOW.ingame);
    /*
     * AND BACK AGAIN WHEN THE PANEL COMES DOWN.
     *
     * The comment below is right that a live overlay "comes straight back on
     * the next arsenal line" - and wrong that there is always a next line. The
     * log narrates what the PLAYER does: opening a slot, moving a mod, saving.
     * A player who opens the companion panel and closes it again without
     * touching the grid emits nothing at all, so nothing ever called
     * `showStrip`, and the overlay stayed gone for the rest of the visit. That
     * is the reported bug: pressed the key, it disappeared, it did not come
     * back. Pressing the key a second time could not fix it either, because by
     * then `stripShown` was false and the hide below was a no-op.
     *
     * So the key restores what it took. `stripIsLive` is the live-versus-stuck
     * test the comment below appeals to, made readable: a strip whose screen
     * the log stopped narrating ninety seconds ago is stuck and stays down,
     * which keeps the escape hatch the panic key was built for.
     */
    if (panel === 'hidden' && stripIsLive()) void showStrip();
  });
  /*
   * THE PANIC KEY DOES NOT MUTE, AND THAT DISTINCTION IS THE WHOLE POINT.
   *
   * This used to set `stripMuted = true` alongside the hide. Ctrl+K is the key
   * for the companion panel, so opening the panel WHILE MODDING killed the
   * modding overlay - and kept it dead until the player toggled again, which
   * they would have no reason to connect to the panel they just opened. Two
   * unrelated jobs on one key, and the quiet one destroyed the loud one's work.
   *
   * The escape hatch still has to exist: it dates from a strip stuck on screen
   * with every route out dead, and that is not a bug to re-open. But "stuck"
   * and "live" are distinguishable, and the app already knows the difference -
   * it is the same signal the 90-second watchdog runs on. A LIVE overlay is one
   * the log is still narrating, so it comes straight back on the next arsenal
   * line. A STUCK one has no log behind it, nothing to bring it back, and it
   * stays gone.
   *
   * So the key hides unconditionally and mutes nothing. Ctrl+Shift+M is the
   * strip's own key and is where deliberate muting lives.
   */
  if (stripShown) hideStrip();
});

/*
 * The strip's own key. Muting hides it now and keeps it hidden; unmuting brings
 * it straight back if the modding screen is still open, so the key reads as a
 * toggle rather than as a setting that needs a screen change to take effect.
 */
onHotkeyPressed(AUTOMOD_HOTKEY, () => {
  stripMuted = !stripMuted;
  if (stripMuted) {
    hideStrip();
    return;
  }
  if (session.phase !== 'idle' && session.phase !== 'opened') void showStrip();
  // Unmuting with no screen open, or with no answer yet, is not a failed key:
  // the strip appears by itself the moment there is something to say.
});

// Clicking the dock button, or a second launch while already running, opens the
// window appropriate to whether the game is up.
overwolf.extensions.onAppLaunchTriggered.addListener(() => {
  const running = useAccount.getState().gameRunning;
  void restoreWindow(running ? WINDOW.ingame : WINDOW.desktop);
});

/*
 * RECONCILE THE STRIP AGAINST REALITY, ONCE, AT STARTUP.
 *
 * This page's `stripShown` is a claim about a window this page does not own.
 * Overwolf windows outlive the background page that opened them - a crash, an
 * extension reload, auto-refresh during development - so a page that starts up
 * believing nothing is shown can be wrong about a window the player is looking
 * at right now. Nothing in the app has narrated the modding screen yet at this
 * point, so a strip that is up is stale by definition: take it down.
 *
 * The reported failure was one of these. It was running a page from an older
 * build, saying ITEM UNKNOWN over a screen the player had long left, and it had
 * outlived every control that could reach it.
 */
void getWindowState(WINDOW.automod).then((state) => {
  if (state !== null && state !== 'closed' && state !== 'hidden') hideStrip();
});

// Nothing is visible on a background-only launch, so open the desktop window
// unless we were started silently by the GameLaunch event.
overwolf.extensions.current.getManifest(() => {
  const origin = new URLSearchParams(location.search).get('source');
  if (origin !== 'gamelaunchevent') void restoreWindow(WINDOW.desktop);
});
