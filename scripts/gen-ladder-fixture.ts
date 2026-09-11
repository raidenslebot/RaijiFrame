/*
 * The artboard's ladder fixture, produced by the app rather than written.
 *
 * `composite.html` composites the strip over a real capture and its rule is
 * that every figure on it is the app's own output. This runs `plan` and
 * `ladder` on exactly the account the frame demo describes - Ash, Q3, three of
 * the six mods owned with one under-ranked - and prints the JSON to paste.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseModsJson } from '../src/data/moddb.ts';
import { parseWfcd } from '../src/data/itemdb.ts';
import { ladder, plan, slotPlanFor, type Rung } from '../src/data/optimise.ts';

const C = new URL('../node_modules/.cache/wfcd/', import.meta.url);
const g = (n: string) => (existsSync(new URL(n, C)) ? readFileSync(new URL(n, C), 'utf8') : null);
const mods = g('Mods.json');
const frames = g('Warframes.json');
if (!mods || !frames) {
  console.log('SKIP: no cached exports');
} else {
  const catalogue = [...parseModsJson(mods).byPath.values()];
  const ash = parseWfcd('Warframes', frames).find((w) => w.name === 'Ash')!;
  // Exactly what the frame demo says the account holds.
  const owned = new Map<string, number>([
    ['/Lotus/Upgrades/Mods/Warframe/Expert/VigorModExpert', 10],
    ['/Lotus/Upgrades/Mods/Sets/Ashen/AshenCarapaceMod', 5],
    ['/Lotus/Upgrades/Mods/Sets/Femur/FemurCarapaceMod', 3],
  ]);
  const { plan: slots } = slotPlanFor({ rank: 30, maxRank: 30, masteryRank: 20, catalyst: true, stanceBonus: null, gridPolarities: [] });
  const built = plan({ item: ash, catalogue, owned, slots, question: 'Q3' });
  const rungs: Rung[] = [];
  for (const r of ladder({ item: ash, catalogue, owned, slots, question: 'Q3' }, built)) {
    if (r !== null) rungs.push(r);
    if (rungs.length >= 6) break; // LADDER_HORIZON
  }
  console.log(`now ${built.now.score.value} ideal ${built.ideal.score.value} ceiling ${built.ceiling.score.value}`);
  console.log(`ceiling drain ${String(built.ceiling.drain)}/${String(built.ceiling.capacity)}`);
  console.log(JSON.stringify(rungs, null, 1));
}
