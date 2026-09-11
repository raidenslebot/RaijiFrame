/**
 * THE PUBLISH DECISION, MOVED SOMEWHERE A GATE CAN REACH IT.
 *
 * An adversarial review found twelve defects in one session's work and every
 * gate here missed all of them. The worst was not subtle: the ladder - the
 * feature the session was built around - was DEAD on all six categories it had
 * just been extended to cover, publishing zero rungs with `ladderEnd:
 * 'complete'`, which the overlay reads as "nothing left to do".
 *
 * The reason every gate missed it is worth more than the bug. The gates drive
 * the optimiser exhaustively - beam search, ceilings, ladders, routes, forty-odd
 * checks - and not one of them could drive the CONTROLLER, because
 * `app/background.ts` imports Overwolf and no gate can import that. So the
 * algorithm was verified to death and the wiring not at all, and the wiring is
 * where it was broken: a clear condition testing `session.slot === null`, which
 * is always true for a learned arsenal row.
 *
 * This file is the answer. Everything the controller DECIDES lives here, pure,
 * with no Overwolf and no module state; `background.ts` keeps only what it must
 * - the timers, the windows, the catalogues and the account. A gate can now
 * drive the decision that was wrong.
 */
import type { Category } from './build.ts';
import type { AutomodState, LadderEnd, Session } from './automod-session.ts';
import type { Rung } from './optimise.ts';
import { categoryOpen, type LearnedSlots } from './slot-learning.ts';

/** What the controller should do with the ladder it is holding. */
export type LadderAction =
  /** Nothing is open that can have one: drop the rungs and stop any pump. */
  | { kind: 'reset' }
  /** A build is open and the rungs in hand belong to it: this one. */
  | { kind: 'keep'; category: Category };

export interface PublishInputs {
  session: Session;
  learned: LearnedSlots;
  /*
   * WHAT THE PLAYER'S OWN MODDING SAID ABOUT A SCREEN THE LOG DID NOT NAME.
   *
   * Null on every screen the app can already read. Set only on a visit with no
   * `upgradeSlot` line at all, from the compatibility class of a mod that can
   * only go on one arsenal row - see `categoryFromPlacement`. It dies with the
   * visit; nothing writes it to `learned`, because there is no index to key it
   * under.
   */
  observed?: Category | null;
}

/**
 * What becomes of the ladder, and - when it is kept - which category it is for.
 *
 * ONE answer, not two that have to agree. They were one bug: the ladder was
 * cleared whenever `session.slot` was null, and a learned row's slot is ALWAYS
 * null - the reducer clamps anything outside 0-3 and keeps the raw index in
 * `unreadSlot` - while the build still resolved, so the strip showed a plan
 * with no staircase under it. Returning the category as a separate field would
 * have left the caller re-testing it for null, which is the same second
 * spelling that let the two drift; a reset has no category at all.
 */
export function publishDecision(input: PublishInputs): LadderAction {
  /*
   * THE OBSERVATION IS A LAST RESORT AND THE ORDER SAYS SO. `categoryOpen`
   * answers from what the LOG said - the slot it named, or the index this
   * account has already taught the app. Only when both are silent does the mod
   * the player just placed get to speak, and it can only ever turn a null into
   * an answer, never change one.
   */
  const category =
    categoryOpen({
      slot: input.session.slot,
      unreadSlot: input.session.unreadSlot,
      learned: input.learned,
    }) ?? (input.observed ?? null);
  const open = input.session.phase !== 'idle' && category !== null;
  return open ? { kind: 'keep', category } : { kind: 'reset' };
}

/**
 * Is the overlay worth showing?
 *
 * A plan, or at least one edit to reflect. Neither is "the screen is open":
 * a screen the app cannot read anything about is a blank panel, and the strip
 * is unobtrusive by not appearing.
 */
export function hasSomethingToSay(state: Pick<AutomodState, 'plan' | 'session'>): boolean {
  return state.plan !== null || state.session.edits.length > 0;
}

/**
 * DID A MODDING SCREEN JUST OPEN? The one moment the account must be re-read.
 *
 * A loadout change is not a mission, so the game's own "inventory written"
 * marker never fires for it, and the equipped item the app resolves is whatever
 * the last read said. Opening the upgrade screen is the moment that matters -
 * and the moment right after the player was in the arsenal changing it.
 *
 * IT MUST NOT BE "the phase left idle". The game emits a trailing `HudVis 1`
 * about 200 ms AFTER the screen closes, and the reducer turns that into
 * `visible`. Driven over 697,130 lines of this machine's own log there are 16
 * idle-to-non-idle transitions and 15 are that phantom - so a refresh keyed to
 * it fires as the player LEAVES, and every real open but the first arrives from
 * a non-idle phase and is skipped. `openedAt` is set by the reducer only on an
 * open the log actually narrates.
 */
export function opensAScreen(before: Pick<Session, 'openedAt'>, after: Pick<Session, 'openedAt'>): boolean {
  return after.openedAt !== null && after.openedAt !== before.openedAt;
}

/**
 * WHICH RUNGS THE PANEL MAY SHOW, and what to say when there are none.
 *
 * The staircase belongs to a PLAN, not to a session. The plan is memoised, so
 * reopening an unchanged item returns the same object from the cache - and the
 * ladder is started inside that cache's producer, which a hit never runs. A
 * close that threw the rungs away therefore threw them away for good.
 *
 * Identity is what makes this safe: same plan, same staircase. Anything else
 * gets an empty ladder that says 'working', because "no rungs yet" is not
 * "there is nothing left to do" - the panel prints AT THE CEILING on the
 * second of those, and it did, over builds with six Forma still to spend.
 */
export function ladderToShow(
  plan: unknown,
  ladderPlan: unknown,
  held: { rungs: Rung[]; end: LadderEnd },
): { rungs: Rung[]; end: LadderEnd } {
  const mine = plan !== null && plan === ladderPlan;
  return mine ? { rungs: held.rungs, end: held.end } : { rungs: [], end: 'working' };
}

/**
 * IS THE LOADOUT WE HOLD STILL THE ONE THE PLAYER IS WEARING?
 *
 * WHAT `changedAt` IS, AND WHAT IT IS NOT. It is the moment the app last had a
 * reason to doubt the loadout - which is a SCREEN OPENING, not a log line
 * claiming the arsenal saved something.
 *
 * The first version keyed this to `OnSaveLoadOutCompleteCommon` arriving with no
 * screen open, on the reasoning that a save outside the modding screen must be
 * an equip. Driven over a real session that is false: the line fires 7 ms before
 * the arsenal screen itself closes, on a visit where the player equipped nothing
 * at all - it is the arsenal's unconditional write on exit. So it marked the
 * loadout stale every time the player left the arsenal, the panel then carried
 * "the loadout could not be re-read" for ever (nothing clears it, because an
 * unchanged read is deduped before the store sees it), and the session parked at
 * `saved`, which made the detector deaf to any equip that followed.
 *
 * The open is the honest trigger: it is the only moment the answer matters, it
 * happens a few times an hour, and it cannot be a false positive.
 *
 * The item is resolved from the account's loadout presets, and the account is a
 * SNAPSHOT. Swap weapons in the arsenal and open Upgrades, and the snapshot is
 * one weapon out of date - which the player saw twice, in both directions:
 * BROKEN WAR titled over an unranked Ankyros, then ANKYROS titled over Broken
 * War, each with a full plan under it for the wrong thing.
 *
 * Asking for a fresh read is not the same as having one, and the read is
 * asynchronous. So the app tracks the moment it learned the loadout changed -
 * `LoadOutRedux.lua: OnSaveLoadOutCompleteCommon` arriving while NO modding
 * screen is open, which is the arsenal equipping something - and refuses to
 * name or plan an item until a read lands that is newer than that.
 *
 * It is deliberately narrow. A save INSIDE the modding screen is the same log
 * line and is not this: the item has not changed, only its mods, and blanking
 * the panel after every save would take the edit trail with it. And with
 * nothing dirty - the ordinary case, no swap - this is `true` and costs the
 * player nothing.
 */
export function loadoutIsSettled(input: { changedAt: number | null; readAt: number | null; now?: number; waitMs?: number }): boolean {
  if (input.changedAt === null) return true;
  if (input.readAt !== null && input.readAt >= input.changedAt) return true;
  /*
   * AND IT GIVES UP, out loud, rather than staying blank for ever.
   *
   * The read it is waiting for can simply never arrive: GEP reads the game's
   * memory, the loadout may not be committed there yet, and `ingest` drops a
   * byte-identical payload BEFORE the store sees it - so a refusal and a
   * "nothing changed" look the same from here. Measured on the live app after a
   * restart, `inventoryAt` was null with a full account loaded from disk, for
   * exactly that reason.
   *
   * Silence is the right answer for a second or two, and the wrong answer for a
   * minute: a panel that never comes back is a broken overlay, not a careful
   * one. After the wait the app says what it knows and names the doubt - see
   * `STALE_LOADOUT` in the controller, which reaches the player as a caveat.
   */
  const now = input.now ?? Date.now();
  return now - input.changedAt >= (input.waitMs ?? SETTLE_WAIT_MS);
}

/**
 * How long the panel stays silent after the player changes what they are
 * wearing, waiting for a read that says so.
 *
 * Long enough for the urgent refresh and its retry to land - measured, a GEP
 * read answers in well under a second - and short enough that the player
 * notices a pause rather than an outage.
 */
export const SETTLE_WAIT_MS = 4_000;

/**
 * WHAT TO DO WHEN A SCREEN OPENS, as one decision a gate can drive.
 *
 * The controller has to answer three things at once and they are the same
 * question: ask the game for a fresh account, wait before naming anything, and
 * say so if the wait ran out. Splitting them is how the refresh came to fire on
 * the close while the naming rule read a different signal.
 */
export interface OpenPolicy {
  /** Ask GEP now, past the one-minute floor. Only ever true on a genuine open. */
  refresh: boolean;
  /** May the panel name and plan the item it resolves? */
  nameable: boolean;
  /** It may - but only because the wait ran out, so the player is told. */
  stale: boolean;
}

export function openPolicy(input: {
  opened: boolean;
  openedAtWall: number | null;
  /** When the account last CHANGED - the store's `inventoryAt`. */
  changedAt: number | null;
  /** When the game last ANSWERED a read - `gep.answeredAt`. */
  answeredAt: number | null;
  now?: number;
  waitMs?: number;
}): OpenPolicy {
  /*
   * TWO CLOCKS, AND READING ONLY THE FIRST WAS A CAVEAT ON EVERY VISIT.
   *
   * The store stamps `inventoryAt` on a real CHANGE only - a byte-identical
   * payload is dropped before it ever gets there, deliberately, because that is
   * what keeps a repeated read cheap. But an account that has not changed is
   * the ORDINARY outcome of opening a modding screen, so the answer the panel
   * was waiting for never moved a clock it was watching: it sat silent for the
   * whole settle window and then printed "the loadout could not be re-read for
   * this screen" over a loadout that had just been confirmed.
   *
   * `answeredAt` is the other half - the game handed the bag over and nothing
   * in it differed. The later of the two is when the app last knew where it
   * stood, which is the question everything below asks.
   */
  const readAt =
    input.changedAt === null || input.answeredAt === null
      ? (input.changedAt ?? input.answeredAt)
      : Math.max(input.changedAt, input.answeredAt);
  const settled = loadoutIsSettled({ changedAt: input.openedAtWall, readAt, now: input.now, waitMs: input.waitMs });
  const confirmed = input.openedAtWall === null || (readAt !== null && readAt >= input.openedAtWall);
  return { refresh: input.opened, nameable: settled, stale: settled && !confirmed };
}

/**
 * WHICH ITEM THE PANEL IS TALKING ABOUT, as one string.
 *
 * The column's view toggle resets with the ITEM and not with the publish -
 * leaving it on 'build' across a screen change answers a question the player
 * asked about a different weapon, and resetting on every publish closes the
 * view under them while they are reading it. A visit is the unit: re-opening
 * the same weapon starts on the next thing to do, which is what the panel is
 * for.
 */
export function itemIdentity(openedAt: number | null, build: { instanceId?: string | null; itemType?: string | null } | null): string {
  return `${String(openedAt)}/${build?.instanceId ?? build?.itemType ?? ''}`;
}

/**
 * THE INSTRUCTION ADVANCES AS THE PLAYER FOLLOWS IT.
 *
 * MEASURED LIVE, and it is the thing a player would notice first: on four real
 * visits to a Grimoire the panel held `now=628 ideal=1451 steps=4` across
 * eleven consecutive publishes while the player placed eleven mods. The top
 * instruction never moved. Place the mod it asks for and it asks again.
 *
 * The plan is computed from `build.installed`, which is the ACCOUNT's saved
 * config, and the account does not change until the arsenal writes. But the log
 * narrates every placement as it happens - `modInstalled` carries the mod's FULL
 * path, so `netEdits` can say exactly which of the plan's steps the player has
 * already done, with no inference at all. Exact paths, no leaf ambiguity, no
 * rank guess.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not rescore the build: that needs
 * the RANK of the copy they placed, and a player can own the same mod at two
 * ranks with nothing in the log to say which one went on. A wrong `now` is a
 * wrong number on screen, which this app does not print. So the figures still
 * describe the saved build and the INSTRUCTION describes what is left.
 *
 * And a step is dropped on the path alone, even when the plan wanted a higher
 * rank than the copy they own. Placing it IS doing the thing that was asked;
 * ranking it up is a separate rung the ladder already carries. Refining that is
 * a later question, and it is written here so it is a decision rather than a
 * rediscovery.
 */
function pathOf(step: unknown): string | null {
  if (typeof step !== 'object' || step === null || !('path' in step)) return null;
  const path: unknown = (step as { path: unknown }).path;
  return typeof path === 'string' ? path : null;
}

export function stillToDo<T>(steps: readonly T[], placed: readonly string[]): T[] {
  if (placed.length === 0) return [...steps];
  const done = new Set(placed);
  /*
   * A RUNG WITH NO PATH SURVIVES, ALWAYS - and the type checker found that,
   * not a reader. `Rung`'s `forma` variant carries no `path` at all, and
   * neither does `unlock`. Those are not mod placements, so no placement can
   * satisfy them: dropping one because the player put a mod on would delete an
   * instruction they still have to follow.
   *
   * Hence the guarded read rather than a `path?: string` constraint - a union
   * member with no such property at all does not satisfy one, and widening the
   * constraint until it compiled would have hidden exactly the case above.
   */
  return steps.filter((s) => {
    const path = pathOf(s);
    return path === null || !done.has(path);
  });
}
