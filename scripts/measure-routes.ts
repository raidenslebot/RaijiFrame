/*
 * HOW OFTEN THE APP CANNOT SAY WHERE A MOD COMES FROM.
 *
 * The live overlay told the player "Primed Fury - source unknown" as its NEXT
 * instruction. "Get this mod" with no idea where is half an instruction, and
 * half the brief is "what mods to get next, what you are missing". So: measure
 * it. Every mod in the catalogue, routed the way the overlay routes it, counted
 * by what the player would be told - and then the same count restricted to the
 * mods that actually matter, the ones a maxed build reaches for.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseModsJson } from '../src/data/moddb.ts';
import { routeTo } from '../src/data/acquire.ts';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'wfcd', 'Mods.json');
if (!fs.existsSync(CACHE)) {
  console.log('no cached Mods.json; run a gate first');
  process.exit(0);
}

const rows = [...parseModsJson(fs.readFileSync(CACHE, 'utf8')).byPath.values()];
const byKind = new Map<string, number>();
const unknown: Array<{ name: string; rarity: string; tradable: unknown; sources: number }> = [];
for (const r of rows) {
  const route = routeTo(r);
  byKind.set(route.kind, (byKind.get(route.kind) ?? 0) + 1);
  if (route.kind === 'unknown') unknown.push({ name: r.displayName, rarity: String(r.rarity), tradable: r.tradable, sources: r.sources });
}

console.log(`${String(rows.length)} mods in the catalogue`);
for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${kind}  ${(100 * n / rows.length).toFixed(1)}%`);
}

/*
 * The ones that matter: a mod nobody would ever fit is not a gap. Legendary and
 * rare mods are what a finished build is made of, and a Primed anything is the
 * case the player hit.
 */
const notable = unknown.filter((u) => /^(Primed|Umbral|Galvanized|Sacrificial|Amalgam)/.test(u.name) || u.rarity.toLowerCase() === 'legendary');
console.log(`\n${String(unknown.length)} with no route at all; ${String(notable.length)} of those are Primed/Umbral/Galvanized/Sacrificial/Amalgam or Legendary`);
for (const u of notable.slice(0, 25)) console.log(`  ${u.name}  (${u.rarity}, tradable=${String(u.tradable)}, sources=${String(u.sources)})`);
