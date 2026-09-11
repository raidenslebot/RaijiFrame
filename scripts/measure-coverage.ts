/**
 * WHAT THE OPTIMISER CANNOT SEE.
 *
 * The brief is "take into account literally every single mod". Q1 scores nine
 * stat keys plus the elements, so every other effect a mod carries is invisible
 * to it - and the strip's honest "N unscored" line reports that per build
 * without ever saying how big the hole is across the catalogue.
 *
 * This is a MEASUREMENT, not a gate: it prints the mods eligible for a given
 * weapon that Q1 can weigh nothing on, grouped by the stat that would have to
 * be modelled to reach them, so the next objective is chosen by size of gap
 * rather than by guess. It exits 0 always; nothing here is a pass/fail claim.
 *
 * Run: node scripts/measure-coverage.ts [exportPath]
 */
import { loadItemDb } from '../src/data/itemdb.ts';
import { loadModDb } from '../src/data/moddb.ts';
import { eligibleSlots } from '../src/data/optimise.ts';

const WEAPONS = [
  '/Lotus/Weapons/Tenno/Rifle/Rifle', // Braton, the reference rifle
  '/Lotus/Weapons/Tenno/Melee/Swords/BrokenWarSword/BrokenWarSword', // the player's own melee
];

/** The stat keys Q1 reads today; kept in step with optimise.ts by eye, not by import. */
const SCORED = new Set([
  'damage',
  'multishot',
  'critical chance',
  'critical damage',
  'fire rate',
  'attack speed',
  'reload speed',
  'magazine capacity',
  'melee damage',
]);

const items = await loadItemDb();
const mods = await loadModDb();

/*
 * FIRST, THE CATALOGUE-WIDE HOLE: mods the app holds with NO parsed effect at
 * all. That is not a modelling choice like "Q1 does not weigh punch through" -
 * it is data loss. A mod with zero effects cannot be scored, cannot be
 * explained, and cannot even be described back to the player when the strip
 * says they are missing it.
 */
const empty = [...mods.byPath.values()].filter((m) => m.effects.length === 0);
console.log(`catalogue: ${String(mods.byPath.size)} mods  ·  ${String(empty.length)} with no parsed effect at all`);
const bySlot = new Map<string, number>();
for (const m of empty) bySlot.set(m.slot ?? '(no slot)', (bySlot.get(m.slot ?? '(no slot)') ?? 0) + 1);
for (const [slot, n] of [...bySlot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`   ${String(n).padStart(4)}  ${slot}`);
}
console.log(`   e.g. ${empty.slice(0, 8).map((m) => m.name).join(', ')}`);

for (const path of WEAPONS) {
  const item = items.byType.get(path);
  if (!item) {
    console.log(`\n${path}\n  not in the item catalogue; skipped`);
    continue;
  }
  const slots = eligibleSlots(item);
  const eligible = [...mods.byPath.values()].filter((m) => m.slot !== null && slots.has(m.slot));

  let weighable = 0;
  const blind = new Map<string, string[]>();
  for (const row of eligible) {
    const top = row.effects.filter((e) => e.rank === row.fusionLimit);
    const canSee = top.some(
      (e) => e.conditions.length === 0 && e.target === 'self' && e.value !== null && (SCORED.has(e.stat) || e.damageType !== undefined),
    );
    if (canSee) {
      weighable++;
      continue;
    }
    // What would have to be modelled to reach this mod at all?
    const reason = top.length === 0 ? '(no effect at max rank)' : top.map((e) => (e.conditions.length > 0 ? `conditional: ${e.stat}` : e.stat)).sort()[0]!;
    const list = blind.get(reason) ?? [];
    list.push(row.name);
    blind.set(reason, list);
  }

  const ranked = [...blind.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log(`\n${item.name ?? path}`);
  console.log(`  eligible ${String(eligible.length)}  ·  Q1 can weigh ${String(weighable)}  ·  invisible ${String(eligible.length - weighable)}`);
  for (const [reason, names] of ranked.slice(0, 14)) {
    console.log(`   ${String(names.length).padStart(3)}  ${reason}  e.g. ${names.slice(0, 3).join(', ')}`);
  }
  if (ranked.length > 14) console.log(`   ...and ${String(ranked.length - 14)} more reasons`);
}
