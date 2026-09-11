/*
 * HOW A MODDING SCREEN ACTUALLY OPENS, COUNTED RATHER THAN REMEMBERED.
 *
 * Two constants in `data/automod-session.ts` are windows around the arsenal's
 * own timing, and both carried a figure that was wrong by an order of
 * magnitude - `SLOT_LEADS_OPEN_SECONDS` said "15-20 ms" against a real 286-352,
 * and `SAME_OPEN_SECONDS` said "20 ms" against a real 271-288. Both came from a
 * hand-made fixture rather than from the log, and nothing could tell. A number
 * in a comment is worth its provenance or nothing, so this is the provenance:
 * run it and the comments are re-derivable in a second.
 *
 * It also counts the gap the overlay cannot yet cover. `categoryOpen` needs a
 * slot index or a learned unread index; a visit that emits NEITHER has no
 * category, no build and no plan for its whole life - the panel shows, says
 * nothing and takes itself down. That share is the single biggest functional
 * hole left, and guessing at it ("roughly half") is how it stayed vague.
 *
 * PRIVACY. Nothing is written and no raw line is printed, returned or kept.
 * Two patterns are matched, each capturing a bare integer or nothing at all;
 * neither is one of the lines that carry a display name, and
 * `BuildLoadOut`/`SendLoadOut` are never touched.
 *
 *   node scripts/measure-open-paths.mjs      # or: npm run opens
 */
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

/* The app's own window, so this measures what the app actually allows. */
const SLOT_LEADS_OPEN_SECONDS = 2;

const LOG = `${process.env.LOCALAPPDATA ?? ''}\\Warframe\\EE.log`;
if (!existsSync(LOG)) {
  console.error(`no EE.log at ${LOG} - this reads the log on THIS machine, so it needs Warframe installed here`);
  process.exit(1);
}

const stamp = /^(\d+\.\d+)/;
let lastSlotAt = null;
let lastSlotIndex = null;
const visits = [];

const rl = createInterface({ input: createReadStream(LOG, 'latin1'), crlfDelay: Infinity });
for await (const line of rl) {
  const t = stamp.exec(line);
  const at = t ? Number(t[1]) : null;

  const slot = /_T\.upgradeItemSlot \(_Mod\): \t?(-?\d+)/.exec(line);
  if (slot && at !== null) {
    lastSlotAt = at;
    lastSlotIndex = Number(slot[1]);
    continue;
  }

  /*
   * The UNIVERSAL open. The arsenal path also logs `GoToScreen(…UpgradeCards)`
   * a few hundred ms earlier and the reducer dedupes the pair, so counting the
   * `Created` line counts visits rather than lines.
   */
  if (/Created \/Lotus\/Interface\/DiegeticUpgradeCards\.swf/.test(line) && at !== null) {
    const gap = lastSlotAt === null ? null : at - lastSlotAt;
    const fresh = gap !== null && gap >= 0 && gap <= SLOT_LEADS_OPEN_SECONDS;
    visits.push({ gapMs: fresh ? Math.round(gap * 1000) : null, index: fresh ? lastSlotIndex : null });
  }
}

const withSlot = visits.filter((v) => v.index !== null);
const known = withSlot.filter((v) => v.index >= 0 && v.index <= 3);
const unread = withSlot.filter((v) => v.index < 0 || v.index > 3);
const slotless = visits.length - withSlot.length;
const list = (rows) => [...new Set(rows.map((v) => v.index))].sort((a, b) => a - b).join(', ') || 'none';

console.log(`\ncard-screen opens in this log: ${String(visits.length)}\n`);
console.log(`  with a slot press inside ${String(SLOT_LEADS_OPEN_SECONDS)}s: ${String(withSlot.length)}`);
console.log(`    one of the four known rows:  ${String(known.length)}  (indices ${list(known)})`);
console.log(`    an index the app must learn: ${String(unread.length)}  (indices ${list(unread)})`);
console.log(`  WITH NO SLOT LINE AT ALL:      ${String(slotless)}`);

if (visits.length > 0) {
  const share = Math.round((slotless / visits.length) * 1000) / 10;
  console.log(`\n  ${String(share)} % of visits reach the panel with no category, no build and no plan.`);
  console.log('  Those are the Mods-segment entries: no slot press and no GoToScreen, only the universal open.');
}

const gaps = withSlot.map((v) => v.gapMs).sort((a, b) => a - b);
if (gaps.length > 0) {
  console.log(
    `\n  press-to-open gap: ${String(gaps[0])}-${String(gaps[gaps.length - 1])} ms (median ${String(gaps[gaps.length >> 1])}), n=${String(gaps.length)}`,
  );
  console.log(`  SLOT_LEADS_OPEN_SECONDS is ${String(SLOT_LEADS_OPEN_SECONDS)}s, which is ${String(Math.round((SLOT_LEADS_OPEN_SECONDS * 1000) / gaps[gaps.length - 1]))}x the widest gap seen.`);
} else {
  console.log('\n  no press was seen inside the window, so the gap has no measurement in this log.');
}
