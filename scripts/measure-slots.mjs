/*
 * WHICH ARSENAL INDICES THIS ACCOUNT HAS EMITTED, AND WHAT THEY TURNED OUT TO BE.
 *
 * The one integer the overlay could not learn from its own capture: whether a
 * companion, archwing or necramech screen emits a fifth `upgradeItemSlot`
 * index, and which. `docs/research/eelog-upgrade-screen.md` observed 0 and 3
 * and inferred 1 and 2; everything past that was written down as unknown in
 * both directions. It is not unknown - it is in the player's own log, which is
 * on this machine, and this reads it.
 *
 * It answers the second question the same way the app does at runtime: a mod
 * cannot be installed on a thing it is not compatible with, so the catalogue
 * class of a mod placed on a screen IS the class of the item being modded. The
 * runtime path is `data/slot-learning.ts`; this is the offline twin, so the
 * answer can be had without waiting for the next companion to be modded.
 *
 * PRIVACY. Nothing is written to disk and no raw line is printed, returned or
 * kept. Three patterns are matched, each capturing a bare integer or a
 * `/Lotus/...` catalogue path; none of them is one of the lines that carry a
 * display name, and `BuildLoadOut`/`SendLoadOut` are never touched.
 */
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseModsJson } from '../src/data/moddb.ts';

const HOME = (process.env.LOCALAPPDATA ?? `${process.env.USERPROFILE ?? ''}/AppData/Local`).split('\\').join('/');
const LOG = `${HOME}/Warframe/EE.log`;

const CACHE = new URL('../node_modules/.cache/wfcd/Mods.json', import.meta.url);
const mods = existsSync(CACHE) ? parseModsJson(readFileSync(CACHE, 'utf8')) : null;

if (!existsSync(LOG)) {
  console.log(`no EE.log at ${LOG}`);
} else {
  const opened = new Map();
  const hovered = new Map();
  /** Mod classes seen while each index was the last one opened. */
  const classesFor = new Map();
  /** Mod classes read off the build dump at close, per index. */
  const dumped = new Map();
  /*
   * `Multiple cards of type X with the same ID` - the duplicate-id warning. The
   * project's notes call it "state, not a change" and say it is not an on-open
   * dump. If that is wrong, it would be a far better teacher than a placement:
   * it needs the player to do nothing at all. Worth measuring rather than
   * trusting a note written from one capture.
   */
  const ownedFor = new Map();
  /** How far after an open the duplicate lines land, in lines. */
  const ownedGap = [];
  let sinceOpen = null;
  let current = null;
  /*
   * The dump belongs to the screen that just CLOSED, and arrives after it. A
   * first version tested `current`, which the close had already cleared, so
   * that whole branch could never fire and reported "no build dump followed
   * any open" - true of the code, not of the log.
   */
  let lastOpened = null;
  let lines = 0;

  const rl = createInterface({ input: createReadStream(LOG, { encoding: 'latin1' }), crlfDelay: Infinity });
  for await (const line of rl) {
    lines++;
    if (sinceOpen !== null) sinceOpen++;

    const press = /_T\.upgradeItemSlot \(_Mod\):\s+(\d+)/.exec(line);
    if (press) {
      current = Number(press[1]);
      lastOpened = current;
      sinceOpen = 0;
      opened.set(current, (opened.get(current) ?? 0) + 1);
      continue;
    }

    const hover = /_T\.upgradeItemSlot \(RefreshStatList\):\s+(\d+)/.exec(line);
    if (hover) {
      const n = Number(hover[1]);
      hovered.set(n, (hovered.get(n) ?? 0) + 1);
      continue;
    }

    // A mod placed or removed on whatever screen is open. Anchored on the
    // script so it can never match `BuildLoadOut for <player>`.
    const mod = /DiegeticUpgradeCards\.lua: mod: .+? - installed: (?:true|false) \((\/Lotus\/[^\s)]+)\)/.exec(line);
    if (mod && current !== null) {
      const compat = mods?.byPath.get(mod[1])?.slot ?? null;
      if (compat) {
        const seen = classesFor.get(current) ?? new Map();
        seen.set(compat, (seen.get(compat) ?? 0) + 1);
        classesFor.set(current, seen);
      }
      continue;
    }

    /*
     * THE BUILD DUMP, which is the other way to learn what a screen was.
     *
     * A visit that places no mod teaches nothing from placements - and the one
     * time this account opened index 6, nothing was placed. But the game states
     * the installed build outright at close: `Modded Capacity: 34|ModName-11|...`
     * names every mod already ON the item, and a mod already on it is proof of
     * compatibility exactly as a mod being placed is.
     */
    const dump = /^Modded Capacity: \d+\|(.+)$/.exec(line);
    if (dump && lastOpened !== null) {
      for (const part of dump[1].split('|')) {
        const m = /^([A-Za-z0-9_]+)-\d+$/.exec(part.trim());
        /*
         * `byName` COLLECTS rather than picks - one display name can belong to
         * several rows - so a class is taken only when every row that carries
         * the name agrees. Two mods sharing a name and disagreeing about what
         * they fit would name no arsenal row at all.
         */
        const rows = m ? (mods?.byName?.get(m[1]) ?? []) : [];
        const classes = new Set(rows.map((r) => r.slot).filter(Boolean));
        const compat = classes.size === 1 ? [...classes][0] : null;
        if (compat) {
          const seen = dumped.get(lastOpened) ?? new Map();
          seen.set(compat, (seen.get(compat) ?? 0) + 1);
          dumped.set(lastOpened, seen);
        }
      }
      continue;
    }

    const owned = /DiegeticUpgradeCards\.lua: Multiple cards of type (\/Lotus\/[^\s]+) with the same ID\./.exec(line);
    if (owned && current !== null) {
      const compat = mods?.byPath.get(owned[1])?.slot ?? null;
      if (compat) {
        const seen = ownedFor.get(current) ?? new Map();
        seen.set(compat, (seen.get(compat) ?? 0) + 1);
        ownedFor.set(current, seen);
        if (sinceOpen !== null) ownedGap.push(sinceOpen);
      }
      continue;
    }

    // The screen closed; a later mod line belongs to no index in particular.
    if (line.includes('Background::GoToPreviousScreen(')) {
      current = null;
      sinceOpen = null;
    }
  }

  const row = (m) =>
    [...m]
      .sort((a, b) => a[0] - b[0])
      .map(([k, n]) => `${k}x${n}`)
      .join('  ') || 'none';

  console.log(`${lines.toLocaleString('en-US')} lines read${mods ? '' : '  (no Mods.json cached: classes unavailable)'}`);
  console.log(`  opened  (_Mod)            ${row(opened)}`);
  console.log(`  hovered (RefreshStatList) ${row(hovered)}`);
  console.log('\n  what was modded on each index, by the compatibility class of the mods placed:');
  const indices = [...classesFor.keys()].sort((a, b) => a - b);
  if (indices.length === 0) console.log('    nothing was placed on any screen in this log');
  for (const i of indices) {
    console.log(`    ${i}: ${row(classesFor.get(i))}`);
  }
  console.log('\n  and by the duplicate-card warnings while each screen was open:');
  const ownedIndices = [...ownedFor.keys()].sort((a, b) => a - b);
  if (ownedIndices.length === 0) console.log('    none fired inside any open');
  for (const i of ownedIndices) console.log(`    ${i}: ${row(ownedFor.get(i))}`);
  if (ownedGap.length > 0) {
    ownedGap.sort((a, b) => a - b);
    console.log(`    they land ${ownedGap[0]}-${ownedGap[ownedGap.length - 1]} lines after the open (median ${ownedGap[ownedGap.length >> 1]})`);
  }

  console.log('\n  and by the classes of the mods ALREADY on it, from the build dump at close:');
  const dumpedIndices = [...dumped.keys()].sort((a, b) => a - b);
  if (dumpedIndices.length === 0) console.log('    no build dump followed any open in this log');
  for (const i of dumpedIndices) {
    console.log(`    ${i}: ${row(dumped.get(i))}`);
  }
}
