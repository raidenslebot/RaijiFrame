/*
 * ARM THE ONE MEASUREMENT THE SLOT LAYER IS WAITING ON.
 *
 * `src/data/slot-solve.ts` can turn a build dump into mod -> slot INDEX, and it
 * is gated. What it has never seen is a dump from a grid with mixed polarities:
 * the only one on this machine is all-universal and solves to nothing, by
 * construction.
 *
 * The dump is emitted by the game itself at `close pod`, after a modding
 * session that changed the build - four unstamped lines that must be correlated
 * because only the first carries a timestamp:
 *
 *   Sys [Info]: Slots: AP_UNIVERSAL|AP_ATTACK|...        eleven, in index order
 *   Initial Capacity: 15|FistCmbThreeMeleeTree+4
 *   Modded Capacity: 19|WeaponMeleeRangeIncMod-7|...     adjusted drains
 *   Final Mod Drain: 12
 *
 * So this tails the live log and writes every dump it sees to a fixture, with
 * the solve already run over it. Leave it running, open Upgrades on a Forma'd
 * weapon, move a mod and save; the file appears with the answer in it.
 *
 * PRIVACY. It captures four line shapes and nothing else - polarity names,
 * capacities, catalogue paths and integers. No line it writes can carry a
 * player name; `eelog.ts`'s allowlist is the same rule and this is narrower
 * still. It never reads the account.
 */
import { closeSync, existsSync, openSync, readSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const LOG = join(process.env.LOCALAPPDATA ?? '', 'Warframe', 'EE.log');
const OUT = join(process.cwd(), 'dumps.jsonl');

if (!existsSync(LOG)) {
  console.error(`no EE.log at ${LOG}`);
  process.exit(1);
}

/** The four lines, in the order the game emits them. */
const SLOTS = /Sys \[Info\]: Slots: ((?:AP_[A-Z]+\|)+)/;
const INITIAL = /^Initial Capacity: (\d+)\|?(.*)$/;
const MODDED = /^Modded Capacity: (\d+)\|(.*)$/;
const FINAL = /^Final Mod Drain: (-?\d+)$/;

let offset = statSync(LOG).size;
let pending = null;
let seen = 0;

console.log(`watching ${LOG} from byte ${offset}`);
console.log('open Upgrades on a Forma\'d weapon, move a mod, and save.');
console.log(`dumps land in ${OUT}\n`);

function line(text) {
  const slots = SLOTS.exec(text);
  if (slots) {
    pending = { slots: slots[1].split('|').filter(Boolean), initial: null, stance: null, capacity: null, mods: [], finalDrain: null };
    return;
  }
  if (!pending) return;
  const ini = INITIAL.exec(text.trim());
  if (ini) {
    pending.initial = Number(ini[1]);
    pending.stance = ini[2] || null;
    return;
  }
  const mod = MODDED.exec(text.trim());
  if (mod) {
    pending.capacity = Number(mod[1]);
    pending.mods = mod[2]
      .split('|')
      .filter(Boolean)
      .map((entry) => {
        const cut = entry.lastIndexOf('-');
        return cut < 0 ? { mod: entry, drain: null } : { mod: entry.slice(0, cut), drain: Number(entry.slice(cut + 1)) };
      });
    return;
  }
  const fin = FINAL.exec(text.trim());
  if (fin && pending.mods.length > 0) {
    pending.finalDrain = Number(fin[1]);
    const distinct = new Set(pending.slots.slice(0, 8));
    const record = {
      at: new Date().toISOString(),
      ...pending,
      gridSlots: pending.slots.slice(0, 8),
      distinctGridPolarities: distinct.size,
      /*
       * The verdict this whole file exists for. A grid whose eight slots carry
       * one or two distinct polarities cannot be solved by drain arithmetic at
       * all - see the table in `check-slot-solve`. Saying so on capture stops a
       * useless dump being mistaken for the missing one.
       */
      solvable: distinct.size >= 4 ? 'likely' : distinct.size >= 3 ? 'partial' : 'no - too few distinct polarities',
    };
    appendFileSync(OUT, `${JSON.stringify(record)}\n`, 'utf8');
    seen++;
    console.log(`dump ${seen}: ${record.mods.length} mods, grid [${record.gridSlots.join(' ')}], ${String(distinct.size)} distinct -> ${record.solvable}`);
    pending = null;
  }
}

let carry = '';
setInterval(() => {
  let size;
  try {
    size = statSync(LOG).size;
  } catch {
    return;
  }
  if (size < offset) offset = 0; // the game rotated the log
  if (size === offset) return;
  /*
   * READ ONLY THE NEW BYTES. The first version did
   * `readFileSync(LOG).subarray(offset, size)`, which pulls the WHOLE file into
   * memory to look at its tail - and this log was 33 MB and growing ten a
   * minute while the game ran, so it was reading a third of a gigabyte a
   * second to find four lines. A positional read costs the bytes that actually
   * arrived.
   */
  const fd = openSync(LOG, 'r');
  const buf = Buffer.allocUnsafe(size - offset);
  let read = 0;
  try {
    read = readSync(fd, buf, 0, buf.length, offset);
  } finally {
    closeSync(fd);
  }
  offset += read;
  const text = carry + buf.subarray(0, read).toString('utf8');
  const lines = text.split('\n');
  carry = lines.pop() ?? '';
  for (const l of lines) line(l);
}, 1000);

if (!existsSync(OUT)) writeFileSync(OUT, '', 'utf8');
