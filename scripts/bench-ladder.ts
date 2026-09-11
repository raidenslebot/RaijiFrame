/*
 * What does the STAGED ladder cost, and what does it say?
 *
 * `plan.next` measures each missing ideal mod's gain from Now, independently -
 * right for the first step and wrong for every step after it, with no order.
 * `ladder` re-asks after each commitment, which is quadratic in the rungs. This
 * measures whether that is affordable, and prints both orders so the difference
 * between them is a fact rather than an argument.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parseModsJson } from '../src/data/moddb.ts';
import { parseWfcd } from '../src/data/itemdb.ts';
import { ladder, plan, slotPlanFor, type Rung } from '../src/data/optimise.ts';

const C = new URL('../node_modules/.cache/wfcd/', import.meta.url);
const g = (n: string) => (existsSync(new URL(n, C)) ? readFileSync(new URL(n, C), 'utf8') : null);
const mods = g('Mods.json');
const primary = g('Primary.json');
const frames = g('Warframes.json');
if (!mods || !primary || !frames) {
  console.log('SKIP: no cached exports');
} else {
  const catalogue = [...parseModsJson(mods).byPath.values()];
  const braton = parseWfcd('Primary', primary).find((w) => w.uniqueName === '/Lotus/Weapons/Tenno/Rifle/Rifle')!;
  const frame = parseWfcd('Warframes', frames).find((w) => w.name === 'Excalibur')!;
  assert.ok(braton && frame);

  const run = (label: string, item: typeof braton, question: 'Q2' | 'Q3', every: number) => {
    const owned = new Map<string, number>();
    let i = 0;
    for (const r of catalogue) if (i++ % every === 0) owned.set(r.uniqueName, Math.max(0, (r.fusionLimit ?? r.ranks - 1) - 2));
    const { plan: slots } = slotPlanFor({ rank: 30, maxRank: 30, masteryRank: 20, catalyst: true, stanceBonus: null, gridPolarities: [] });

    const t0 = performance.now();
    const built = plan({ item, catalogue, owned, slots, question });
    const planMs = performance.now() - t0;

    const t1 = performance.now();
    const rungs: Rung[] = [];
    let searches = 0;
    /*
     * TIME TO THE FIRST INSTRUCTION, which is the number that decides whether
     * the overlay feels slow. The total is background work spread across
     * timeouts and nothing waits on it; what the player waits for is the one
     * line the panel shows, and until it lands the fallback is already on
     * screen naming the easiest missing mod.
     */
    let firstRungMs = 0;
    const HORIZON = 6; // the controller's own limit; see LADDER_HORIZON
    for (const r of ladder({ item, catalogue, owned, slots, question }, built)) {
      if (r === null) searches++;
      else {
        if (rungs.length === 0) firstRungMs = performance.now() - t1;
        rungs.push(r);
        if (rungs.length >= HORIZON) break;
      }
    }
    const ladderMs = performance.now() - t1;

    console.log(`\n${label}   now ${built.now.score.value.toFixed(0)}  ->  ideal ${built.ideal.score.value.toFixed(0)}`);
    console.log(`  plan ${planMs.toFixed(0)} ms, first instruction +${firstRungMs.toFixed(0)} ms, whole ladder ${ladderMs.toFixed(0)} ms over ${String(searches)} searches`);
    console.log(`  next[]  ${built.next.map((n) => `${n.name} +${n.gain.toFixed(0)}`).join(' | ') || '(none)'}`);
    for (const r of rungs) {
      const what =
        r.kind === 'forma'
          ? `Forma -> ${r.polarity}`
          : r.kind === 'unlock'
            ? `UNLOCK ${r.planet} via ${r.nodeName} (${String(r.nodes)} nodes)`
            : `${r.name} ${r.fromRank === null ? '(get)' : `${String(r.fromRank)}->${String(r.toRank)}`}`;
      console.log(`  ${String(r.step).padStart(2)}. ${what.padEnd(38)} +${r.gain.toFixed(0).padStart(5)}  =${r.value.toFixed(0).padStart(6)}`);
    }
    const last = rungs.at(-1);
    const end = last ? last.value : built.now.score.value;
    console.log(
      `  ends at ${end.toFixed(0)}   grid-ideal ${built.ideal.score.value.toFixed(0)}   ceiling ${built.ceiling.score.value.toFixed(0)}   ${end >= built.ceiling.score.value - 1e-6 ? 'REACHED' : `${(built.ceiling.score.value - end).toFixed(0)} still to climb past the horizon`}`,
    );
  };

  run('Braton Q2, half the catalogue owned', braton, 'Q2', 2);
  run('Braton Q2, a tenth owned', braton, 'Q2', 10);
  run('Excalibur Q3, half owned', frame, 'Q3', 2);
}
