/**
 * WOULD THE OVERLAY HAVE OPENED? Replayed against the player's real EE.log.
 *
 * "It opens when selecting anything that is moddable" is the first line of the
 * brief, and the only way to see it happen is to be at the machine when it
 * does. This is the next best thing and it is not a small thing: the game has
 * already written every modding session the player has had into EE.log, and
 * this feeds those real events through the SAME reducer the live controller
 * runs and reports what the overlay would have done.
 *
 * It is a MEASUREMENT, not a gate. It reads the live log if there is one and
 * says so if there is not.
 *
 * PRIVACY. This is the rule that matters most in this file. It never prints,
 * stores or matches a raw line. `parseLine` is the same allowlisting parser the
 * app uses - the two lines that carry the player's name are not among the
 * patterns it recognises - and what comes out here are counts, phases, slot
 * numbers and the app's own verdicts.
 *
 * Run: node scripts/measure-live-log.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLine } from '../src/core/eelog.ts';
import { IDLE, SLOT_CATEGORY, step, type Session , type PendingSlot } from '../src/data/automod-session.ts';

const LOG = join(process.env.LOCALAPPDATA ?? '', 'Warframe', 'EE.log');

if (!existsSync(LOG)) {
  console.log(`no EE.log at ${LOG} - nothing to replay`);
} else {
  const text = readFileSync(LOG, 'latin1');
  const lines = text.split(/\r?\n/);

  /*
   * The same pending-slot latch the controller keeps: a slot press arrives up to
   * two seconds BEFORE the open it belongs to, so the reducer needs somewhere to
   * hold it. Replaying without it would mis-attribute every session's slot.
   */
  const pending: PendingSlot = { slot: null, slotAt: null, unrecognised: null, lastInterface: null, lastInterfaceAt: null };
  let session: Session = IDLE;

  interface Visit {
    slot: number | null;
    category: string | null;
    /*
     * WHY THE SLOT IS UNKNOWN, which is two different things and used to print
     * as one dash. Either the open came through the Mods segment, which emits
     * no slot line at all, or it came through the arsenal on a row this app has
     * no meaning for. The second is the whole of what stands between the
     * overlay and companions, archwings and necramechs, and this account's log
     * contains one.
     */
    unreadSlot: number | null;
    /** The compatibility class of the first mod touched, which names the row. */
    learned: string | null;
    edits: number;
    fusions: number;
    sawDump: boolean;
    joinedLate: boolean;
    reachedSaved: boolean;
    closed: boolean;
  }
  const visits: Visit[] = [];
  let open: Visit | null = null;
  let arsenalEvents = 0;
  const byType = new Map<string, number>();

  for (const line of lines) {
    const e = parseLine(line);
    if (!e) continue;
    byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    const before = session.phase;
    const next = step(session, e, pending);
    if (next === session) continue;
    arsenalEvents++;
    session = next;

    if (before === 'idle' && session.phase !== 'idle') {
      open = {
        slot: session.slot,
        category: session.slot === null ? null : SLOT_CATEGORY[session.slot],
        unreadSlot: session.unreadSlot,
        learned: null,
        edits: 0,
        fusions: 0,
        sawDump: false,
        joinedLate: session.seenWithoutOpen,
        reachedSaved: false,
        closed: false,
      };
    }
    if (open) {
      open.edits = session.edits.length;
      open.fusions = session.fusions.length;
      open.sawDump ||= session.dump !== null;
      open.reachedSaved ||= session.phase === 'saved';
      if (session.slot !== null && open.slot === null) {
        open.slot = session.slot;
        open.category = SLOT_CATEGORY[session.slot];
      }
      if (open.unreadSlot === null && session.unreadSlot !== null) open.unreadSlot = session.unreadSlot;
      /*
       * WHAT THIS VISIT WOULD HAVE TAUGHT. A mod cannot be installed on a thing
       * it is not compatible with, and the card screen's duplicate warning is
       * filtered to the item, so either names the row's class. Reported here
       * without a catalogue to resolve the path against: the PATH itself is
       * what the controller looks up, so printing its shape is enough to see
       * whether a lesson was available at all.
       */
      if (open.learned === null && (e.type === 'modInstalled' || e.type === 'modOwned')) open.learned = e.itemType;
      if (session.phase === 'idle') {
        open.closed = true;
        visits.push(open);
        open = null;
      }
    }
  }
  if (open) visits.push(open);

  console.log(`EE.log: ${String(lines.length)} lines, ${String(arsenalEvents)} of them moved the modding state machine\n`);
  console.log('parsed event types:');
  for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${t}`);

  console.log(`\n${String(visits.length)} modding-screen visit(s) recorded:\n`);
  console.log('   slot  category   edits  fusions  dump  late  saved  closed   the overlay would have');
  for (const v of visits) {
    /*
     * `hasSomethingToSay` in the controller: a plan, or at least one edit. A
     * plan needs the account and the catalogues, which a replay does not have -
     * so this reports the EDIT half honestly and says the other half is
     * untestable here rather than assuming it.
     */
    const would =
      v.unreadSlot !== null
        ? `NOT READ - arsenal row ${String(v.unreadSlot)}`
        : v.slot === null
          ? 'no slot line at all (Mods segment)'
          : v.edits > 0
            ? 'SHOWN (edits to reflect)'
            : 'shown only if a plan resolved';
    console.log(
      `  ${String(v.slot ?? '-').padStart(5)}  ${(v.category ?? '-').padEnd(9)}  ${String(v.edits).padStart(5)}  ${String(v.fusions).padStart(7)}  ` +
        `${(v.sawDump ? 'yes' : ' - ').padStart(4)}  ${(v.joinedLate ? 'yes' : ' - ').padStart(4)}  ${(v.reachedSaved ? 'yes' : ' - ').padStart(5)}  ` +
        `${(v.closed ? 'yes' : 'NO').padStart(6)}   ${would}`,
    );
  }

  /*
   * THE ROWS THIS APP CANNOT READ, AND WHETHER THEY WOULD HAVE TAUGHT IT.
   *
   * Four arsenal indices have a known meaning; a fifth appearing is the whole
   * of what stands between this overlay and companions, archwings and
   * necramechs. The app learns from the first mod touched on such a screen -
   * placed OR flagged as a duplicate - so a visit that touched nothing teaches
   * nothing, and this says which happened rather than assuming.
   */
  const unread = visits.filter((v) => v.unreadSlot !== null);
  if (unread.length > 0) {
    console.log(`\n${String(unread.length)} visit(s) landed on an arsenal row this app does not read:`);
    for (const v of unread) {
      console.log(
        `  row ${String(v.unreadSlot)}: ${v.learned === null ? 'nothing was touched, so nothing could be learned from it' : `would have learned from ${v.learned}`}`,
      );
    }
    console.log('  Until one is learned the overlay says "another slot" rather than going blank.');
  } else {
    console.log('\nEvery visit landed on one of the four arsenal rows this app reads.');
  }

  const unclosed = visits.filter((v) => !v.closed).length;
  if (unclosed > 0) {
    console.log(
      `\n${String(unclosed)} visit(s) never saw a close line. That is exactly the case the 90 s silence` +
        '\nwatchdog exists for - without it the overlay would still be on screen from the last one.',
    );
  }
}
