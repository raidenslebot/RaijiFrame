/*
 * How long does the optimiser actually take?
 *
 * Every design decision about a staged ladder turns on the cost of ONE search:
 * a greedy ladder is quadratic in the number of steps, so the difference
 * between 5 ms and 120 ms is the difference between a feature and the laggy
 * overlay the brief refuses. This measures rather than assumes.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parseModsJson } from '../src/data/moddb.ts';
import { parseWfcd } from '../src/data/itemdb.ts';
import { plan, search, slotPlanFor, type Candidate } from '../src/data/optimise.ts';

const CACHE = new URL('../node_modules/.cache/wfcd/', import.meta.url);
const read = (n: string) => (existsSync(new URL(n, CACHE)) ? readFileSync(new URL(n, CACHE), 'utf8') : null);
const mods = read('Mods.json');
const primary = read('Primary.json');
const frames = read('Warframes.json');
if (!mods || !primary || !frames) {
  console.log('SKIP: no cached exports');
  process.exitCode = 0;
} else {
  const db = parseModsJson(mods);
  const catalogue = [...db.byPath.values()];
  const braton = parseWfcd('Primary', primary).find((w) => w.uniqueName === '/Lotus/Weapons/Tenno/Rifle/Rifle')!;
  const frame = parseWfcd('Warframes', frames).find((w) => w.name === 'Excalibur')!;
  assert.ok(braton && frame);

  const everything = new Map<string, number>();
  for (const r of catalogue) everything.set(r.uniqueName, r.fusionLimit ?? Math.max(0, r.ranks - 1));
  // Half the catalogue owned, which is the shape an account actually has.
  const half = new Map<string, number>();
  let i = 0;
  for (const [k, v] of everything) if (i++ % 2 === 0) half.set(k, Math.max(0, v - 2));

  const { plan: slots } = slotPlanFor({ rank: 30, maxRank: 30, masteryRank: 20, catalyst: true, stanceBonus: null, gridPolarities: [] });

  const time = (label: string, fn: () => void, runs = 5) => {
    fn(); // warm
    const t0 = performance.now();
    for (let n = 0; n < runs; n++) fn();
    const each = (performance.now() - t0) / runs;
    console.log(`  ${each.toFixed(1).padStart(7)} ms  ${label}`);
    return each;
  };

  const slotsOk = new Set(['Rifle', 'PRIMARY']);
  const pool: Candidate[] = [];
  for (const r of catalogue) {
    if (r.slot === null || !slotsOk.has(r.slot) || r.ranks <= 0 || r.isAura || r.isFlawed) continue;
    pool.push({ row: r, rank: r.fusionLimit ?? r.ranks - 1, id: pool.length } as unknown as Candidate);
  }
  console.log(`\npool: ${String(pool.length)} rifle candidates, catalogue ${String(catalogue.length)}`);

  time(`one search  (Q2, ${String(pool.length)} candidates)`, () => void search('Q2', braton, pool, slots));
  time('plan  weapon Q2  (everything owned)', () => void plan({ item: braton, catalogue, owned: everything, slots, question: 'Q2' }));
  time('plan  weapon Q2  (half owned)', () => void plan({ item: braton, catalogue, owned: half, slots, question: 'Q2' }));
  time('plan  frame  Q3  (half owned)', () => void plan({ item: frame, catalogue, owned: half, slots, question: 'Q3' }), 3);
}

/*
 * WHAT A MODDING VISIT COSTS.
 *
 * `publishAutomod` runs on every session change, and `check-strip-life` counts
 * seven of the fourteen arsenal lines as state changes - plus one per mod the
 * player places, and one per inventory push while the screen is open. Only the
 * build dump moves anything the plan depends on; placing a card does not.
 */
if (typeof globalThis !== 'undefined') {
  const { existsSync: ex, readFileSync: rf } = await import('node:fs');
  const { memoLast } = await import('../src/core/memo.ts');
  const C = new URL('../node_modules/.cache/wfcd/', import.meta.url);
  const g = (n: string) => (ex(new URL(n, C)) ? rf(new URL(n, C), 'utf8') : null);
  const m = g('Mods.json');
  const p = g('Primary.json');
  if (m && p) {
    const { parseModsJson } = await import('../src/data/moddb.ts');
    const { parseWfcd } = await import('../src/data/itemdb.ts');
    const { plan: mkPlan, slotPlanFor: mkSlots } = await import('../src/data/optimise.ts');
    const cat = [...parseModsJson(m).byPath.values()];
    const w = parseWfcd('Primary', p).find((x) => x.uniqueName === '/Lotus/Weapons/Tenno/Rifle/Rifle')!;
    const own = new Map<string, number>();
    let k = 0;
    for (const r of cat) if (k++ % 2 === 0) own.set(r.uniqueName, Math.max(0, (r.fusionLimit ?? r.ranks - 1) - 2));
    const { plan: sl } = mkSlots({ rank: 30, maxRank: 30, masteryRank: 20, catalyst: true, stanceBonus: null, gridPolarities: [] });
    const acct = {};
    const PUBLISHES = 8; // one open, six cards placed, one save

    let t = performance.now();
    for (let n = 0; n < PUBLISHES; n++) void mkPlan({ item: w, catalogue: cat, owned: own, slots: sl, question: 'Q2' });
    const before = performance.now() - t;

    const memo = memoLast<unknown>();
    t = performance.now();
    for (let n = 0; n < PUBLISHES; n++) {
      const key = [w, cat, acct, sl.capacity, sl.grid.join('|'), 'Q2', ''];
      memo.get(key, () => mkPlan({ item: w, catalogue: cat, owned: own, slots: sl, question: 'Q2' }));
    }
    const after = performance.now() - t;

    console.log(`\na visit with ${String(PUBLISHES)} publishes and no change to the plan's inputs`);
    console.log(`  ${before.toFixed(0).padStart(7)} ms  recomputed every publish`);
    console.log(`  ${after.toFixed(0).padStart(7)} ms  computed once (${String(memo.misses)} miss, ${String(memo.hits)} hits)`);
  }
}
