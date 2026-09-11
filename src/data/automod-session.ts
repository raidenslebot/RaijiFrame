/**
 * The modding screen, as a state machine over log events.
 *
 * `core/eelog.ts` parses eleven arsenal event types out of the game's own Lua
 * narration of the Upgrades screen. This module is the consumer those events
 * did not have: it folds them into ONE object — is the screen open, is it
 * drawn yet, which slot was pressed, what has been placed or lifted since it
 * opened, what did the game say the build was when it was saved.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE RULES, each one a measured fact about the log rather than a preference.
 *
 * 1. A repeat open within a second is the same open. The arsenal path logs
 *    `GoToScreen(screenName=UpgradeCards)` and, twenty milliseconds later,
 *    `Created /Lotus/Interface/DiegeticUpgradeCards.swf`; the other entry path
 *    logs only the second. Treating both as opens would double every visit that
 *    came through the arsenal and none that did not.
 *
 * 2. The tail can start anywhere. A close with no open, a placement with no
 *    screen, a visibility line first — all of these arrive when the app is
 *    launched with the game already on the modding screen. None of them may
 *    invent an open, and none may throw. The machine reports what it saw.
 *
 * 3. The slot is known on the arsenal path only. `_T.upgradeItemSlot (_Mod)`
 *    fires when Upgrade is pressed in the arsenal — three of five visits in the
 *    first capture. The Mods-segment path never logs it. `slot: null` is
 *    therefore a first-class state that the overlay must draw, not a defect
 *    the resolver may paper over with a guess.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PRIVACY. Every field here is a slot number, a screen state, a catalogue path
 * or a number the game printed. Nothing that reaches this module can carry a
 * name; the parser's own gate holds that line.
 */

import type { LogEvent } from '../core/eelog.ts';
import type { ResolvedBuild } from './build.ts';
import type { Plan, Rung } from './optimise.ts';

/** Why the staircase stopped growing. See `AutomodState.ladderEnd`. */
export type LadderEnd = 'working' | 'complete' | 'horizon';
import type { Purse } from './fusion.ts';

/**
 * What the background controller publishes for the strip: the session the
 * log narrates, the build the account resolves for its slot - with the
 * item's display name from the catalogue when the catalogue has loaded - and
 * the optimiser's plan for it once both catalogues are in.
 * `build` is null while idle or while the slot is unknown; a resolved build
 * whose ladder stopped short says where (`unknown`), it is not null. `plan`
 * is null until it has been computed; `planAssumed` names what the slot
 * plan had to assume (rank, catalyst, polarities) and is empty when nothing.
 */
export interface AutomodState {
  session: Session;
  build: (ResolvedBuild & { name: string | null }) | null;
  plan: Plan | null;
  planAssumed: string[];
  /*
   * THE STAIRCASE, WHICH ARRIVES AFTER THE PLAN AND NOT WITH IT.
   *
   * Each rung costs a search per remaining candidate, so a full ladder runs to
   * nine seconds on the real catalogue - measured by `scripts/bench-ladder.ts`.
   * Publishing it with the plan would put all of that on the front of every
   * screen open, so it is computed rung by rung and published as it grows: the
   * first instruction is on screen while the rest is still being found.
   */
  ladder: Rung[];
  /*
   * WHY THE LADDER STOPPED, WHICH IS THREE ANSWERS AND NOT A BOOLEAN.
   *
   * 'working'  still climbing; a short ladder here means "so far", not "in all".
   * 'complete' it converged: the last rung IS the ceiling and there is no more.
   * 'horizon'  it was stopped at the controller's own limit, so more exists.
   *
   * A boolean collapsed the first and third into "not done" and the overlay
   * then said "so far" about a ladder nothing was still computing - which is a
   * promise of more that would never arrive.
   */
  ladderEnd: LadderEnd;
  /*
   * What the account can actually SPEND. Every step of the plan carries its own
   * Endo and credit price; pairing that with these two balances is the whole
   * difference between "rank this mod" and "rank this mod, and you can".
   * Both are null until an inventory has been read - absent is not zero, and an
   * unread account is never reported broke.
   */
  purse: Purse;
}

/** Which arsenal slot the Upgrades screen was opened for. Null off the arsenal path. */
export type UpgradeSlot = 0 | 1 | 2 | 3;

/**
 * The caller's one-slot memory, which the slot line fills before the screen
 * that consumes it exists.
 *
 * `unrecognised` holds an index the log carried and this app has no meaning
 * for - see the note in `step`. It is the only record that such a screen was
 * ever opened, so it is deliberately a number rather than a boolean.
 */
export interface PendingSlot {
  slot: UpgradeSlot | null;
  slotAt: number | null;
  unrecognised: number | null;
}

export const SLOT_CATEGORY: Record<UpgradeSlot, 'warframe' | 'primary' | 'secondary' | 'melee'> = {
  0: 'warframe',
  1: 'primary',
  2: 'secondary',
  3: 'melee',
};

export type Phase = 'idle' | 'opened' | 'visible' | 'editing' | 'saved';

export interface Edit {
  at: number | null;
  name: string;
  itemType: string;
  installed: boolean;
}

/** What the game printed about the build at save time. Null until it prints. */
export interface BuildDump {
  polarities: string[];
  initial: number | null;
  stance: string | null;
  stanceBonus: number | null;
  capacity: number | null;
  mods: Array<{ mod: string; drain: number }>;
}

export interface Session {
  phase: Phase;
  /** Log-time (seconds since process start) of the open, for dedupe. Null when idle. */
  openedAt: number | null;
  slot: UpgradeSlot | null;
  /*
   * THE SCREEN THIS APP CANNOT READ, NAMED RATHER THAN LEFT BLANK.
   *
   * `slot` is null for two completely different reasons and the overlay had one
   * word for both. Either the open came through the Mods segment, which emits
   * no slot line at all, or it came through the arsenal on a row this app has
   * no meaning for - a companion, an archwing, a necramech. In the second case
   * the log DID say which, and the number was thrown away, so the overlay stood
   * there saying "item unknown" with nothing further while knowing perfectly
   * well that it had been handed a screen outside the four it reads.
   *
   * Null means the first case. A number means the second, and it is the index
   * the log carried - which is also the measurement that would let these
   * screens be supported at all.
   */
  unreadSlot: number | null;
  /** Every placement or removal since the open, in order. Cleared on the next open. */
  edits: Edit[];
  /** The last save's dump, assembled from its four lines. Survives until the next open. */
  dump: BuildDump | null;
  /** Ranking costs quoted while open, in order. */
  fusions: Array<{ endo: number; credits: number }>;
  /** A close, save or edit arrived with no open on record. Reported, never repaired. */
  seenWithoutOpen: boolean;
  /*
   * WHEN THE LAST CLOSE WAS, in the log's own uptime seconds, and it exists for
   * one reason: the game emits a trailing `HudVis 1` about 200 ms AFTER
   * `GoToPreviousScreen`. Driven over 697,130 lines of a real log, 15 of the 16
   * idle-to-non-idle transitions in the whole file are that artefact.
   *
   * Without this the reducer reads the phantom as a screen becoming visible with
   * no open on record - which is the shape of a genuinely late join - and hands
   * the panel `seenWithoutOpen: true` for a screen the app watched from the
   * start. One mod placed on that session and it says "Joined late: this is
   * everything since the tail started" to a player it has been following all
   * along.
   */
  closedAt: number | null;
}

/** No account read, so no balance. Used wherever a state is built from nothing. */
export const NO_PURSE: Purse = { endo: null, credits: null };

export const IDLE: Session = {
  phase: 'idle',
  openedAt: null,
  slot: null,
  unreadSlot: null,
  edits: [],
  dump: null,
  fusions: [],
  seenWithoutOpen: false,
  closedAt: null,
};

/*
 * How close two open lines must be to count as one open.
 *
 * The arsenal path logs both: `Background::GoToScreen(screenName=UpgradeCards)`
 * and then the universal `Created .../DiegeticUpgradeCards.swf`. Measured over
 * this machine's whole EE.log, the gap between them is 271 ms and 288 ms - two
 * pairs, which is every pair in the file. A second is generous for that and far
 * under any second visit a player could make.
 */
const SAME_OPEN_SECONDS = 1;
/*
 * How long after a close its own trailing `HudVis 1` may still arrive. Measured
 * on the real log at 206 ms, every time; a second is generous for that and far
 * under any visit a player could make.
 */
const AFTER_CLOSE_SECONDS = 1;
/*
 * How far back a slot press still belongs to the open that follows it.
 *
 * MEASURED, over every card-screen open in this machine's EE.log: 286 ms to
 * 352 ms, median 303, across the 7 of 11 opens that had a press at all. The
 * comment here used to say "15-20 ms", which is wrong by an order of magnitude
 * and is the dangerous direction - anyone tightening this window to match it
 * would strip the slot from EVERY visit and leave the panel with no category at
 * all. Two seconds is generous against 352 ms and still far under any gap a
 * player could produce by pressing a row and then hesitating.
 *
 * (The same file carried the same kind of stale figure for `SAME_OPEN_SECONDS`
 * - "20 ms" against a real 271-288. Both came from a fixture rather than the
 * log. A number in a comment is worth its provenance or nothing.)
 */
const SLOT_LEADS_OPEN_SECONDS = 2;

/**
 * Fold one event into the session. Pure; returns the same object when the
 * event is not the arsenal's business, so a consumer can compare by identity.
 */
export function step(s: Session, e: LogEvent, pending: PendingSlot): Session {
  switch (e.type) {
    case 'upgradeSlot': {
      // Remembered outside the session: it precedes the open, and the open is
      // what creates the session. `pending` is the caller's one-slot memory.
      const slot = e.slot >= 0 && e.slot <= 3 ? (e.slot as UpgradeSlot) : null;
      pending.slot = slot;
      pending.slotAt = e.at;
      /*
       * AN INDEX THIS APP DOES NOT RECOGNISE IS EVIDENCE, NOT NOISE.
       *
       * Four slots are handled because four are all that were ever seen: the
       * capture in `docs/research/eelog-upgrade-screen.md` observed 0 and 3 and
       * INFERRED 1 and 2 from the arsenal's layout. Whether a companion, an
       * archwing or a necramech screen emits a fifth index is not something
       * anybody has looked at - and until now the answer was unreachable,
       * because an out-of-range index was clamped to null and thrown away, so
       * a player could open a companion's mods every day for a year and the app
       * would learn nothing from it.
       *
       * Clamping is still right: the app must not guess that slot 4 is a
       * sentinel. Keeping the number is what turns a permanent blind spot into
       * one visit's measurement, and the controller traces it by name.
       */
      pending.unrecognised = slot === null ? e.slot : null;
      return s;
    }

    case 'screen': {
      if (e.name !== 'UpgradeCards') return s;
      if (e.open) {
        if (s.phase !== 'idle' && s.openedAt !== null && e.at !== null && Math.abs(e.at - s.openedAt) <= SAME_OPEN_SECONDS) {
          return s; // the arsenal path's second open line
        }
        const slotIsFresh =
          pending.slotAt !== null && e.at !== null && e.at - pending.slotAt >= 0 && e.at - pending.slotAt <= SLOT_LEADS_OPEN_SECONDS;
        const slot = slotIsFresh ? pending.slot : null;
        // The unrecognised index belongs to this open only if the press was
        // fresh enough to belong to it at all - the same test the slot uses.
        const unreadSlot = slotIsFresh ? pending.unrecognised : null;
        pending.slot = null;
        pending.slotAt = null;
        pending.unrecognised = null;
        return { ...IDLE, phase: 'opened', openedAt: e.at, slot, unreadSlot };
      }
      // A close. With no open on record it is still a close, and it says so.
      return { ...s, phase: 'idle', openedAt: null, closedAt: e.at, seenWithoutOpen: s.phase === 'idle' ? true : s.seenWithoutOpen };
    }

    case 'hudVisible':
      if (e.screen !== 'UpgradeCards') return s;
      /*
       * THE TRAILING LINE OF A CLOSE IS NOT A SCREEN OPENING.
       *
       * Measured on the real log: `GoToPreviousScreen` at 6693.032 and this line
       * at 6693.238, 206 ms later, every time. A second is generous for that gap
       * and far under any real visit, so a `HudVis` this soon after a close is
       * the close finishing, and the session stays idle.
       */
      /*
       * AND THE WINDOW HAS A FLOOR, because the log's clock restarts.
       *
       * `e.at` is seconds since the game launched, so the first screen of a new
       * run is timestamped in the tens while `closedAt` still holds the six
       * thousand of the last one. Without the lower bound that difference is
       * hugely negative, passes `<= 1` for the whole session, and every
       * `HudVis` at idle is swallowed as somebody else's trailing line - the
       * overlay never comes up again until a close is seen in the new run.
       * `SLOT_LEADS_OPEN_SECONDS` has had this guard all along.
       */
      if (s.phase === 'idle' && s.closedAt !== null && e.at !== null && e.at - s.closedAt >= 0 && e.at - s.closedAt <= AFTER_CLOSE_SECONDS) {
        return s;
      }
      // Visible-before-open: the tail joined late. Report the screen as visible
      // with nothing else known rather than pretend it was never opened.
      if (s.phase === 'idle') return { ...IDLE, phase: 'visible', seenWithoutOpen: true, closedAt: s.closedAt };
      if (s.phase === 'opened') return { ...s, phase: 'visible' };
      return s;

    case 'modInstalled': {
      const edit: Edit = { at: e.at, name: e.name, itemType: e.itemType, installed: e.installed };
      if (s.phase === 'idle') return { ...IDLE, phase: 'editing', edits: [edit], seenWithoutOpen: true, closedAt: s.closedAt };
      return { ...s, phase: 'editing', edits: [...s.edits, edit] };
    }

    case 'fusionCost':
      if (s.phase === 'idle') return { ...IDLE, fusions: [{ endo: e.endo, credits: e.credits }], seenWithoutOpen: true, closedAt: s.closedAt };
      return { ...s, fusions: [...s.fusions, { endo: e.endo, credits: e.credits }] };

    case 'loadoutSaved':
      if (s.phase === 'idle') return { ...IDLE, phase: 'saved', seenWithoutOpen: true, closedAt: s.closedAt };
      return { ...s, phase: 'saved' };

    /*
     * The dump's four lines land within a millisecond, in order. Each one
     * fills its part; a consumer reads `dump` when `mods` is non-empty, which
     * is the third line and the one that carries the build.
     */
    case 'buildSlots':
      return { ...s, dump: { ...(s.dump ?? EMPTY_DUMP), polarities: e.polarities } };
    case 'buildCapacity':
      return { ...s, dump: { ...(s.dump ?? EMPTY_DUMP), initial: e.initial, stance: e.stance, stanceBonus: e.stanceBonus } };
    case 'buildMods':
      return { ...s, dump: { ...(s.dump ?? EMPTY_DUMP), capacity: e.capacity, mods: e.mods } };
    case 'buildDrain':
    case 'modOwned':
      return s;

    default:
      return s;
  }
}

const EMPTY_DUMP: BuildDump = { polarities: [], initial: null, stance: null, stanceBonus: null, capacity: null, mods: [] };

/**
 * The net effect of the edit stream: what is on the item now that was not at
 * the open, and what was lifted. A card placed then lifted cancels; the LAST
 * event for a path wins.
 */
export function netEdits(edits: readonly Edit[]): { placed: string[]; lifted: string[] } {
  const last = new Map<string, boolean>();
  for (const e of edits) last.set(e.itemType, e.installed);
  const placed: string[] = [];
  const lifted: string[] = [];
  for (const [path, installed] of last) (installed ? placed : lifted).push(path);
  return { placed, lifted };
}

/**
 * Drive a whole event sequence, keeping the one-slot memory the machine needs
 * between a slot press and the open it precedes. For replay and for gates.
 */
export function fold(events: Iterable<LogEvent>): Session {
  let s = IDLE;
  const pending: PendingSlot = { slot: null, slotAt: null, unrecognised: null };
  for (const e of events) s = step(s, e, pending);
  return s;
}
