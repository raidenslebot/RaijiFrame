/**
 * HOW MUCH OF THE MOD POOL DOES THE OPTIMISER REFUSE TO SCORE? Temporary.
 *
 * `scoredEffects` drops every effect that carries a condition or a
 * `scalingBasis`, and Q2's own wording says so: "no conditional effects". At
 * level 9999 those are the mods a real build is made of. This counts them, and
 * groups the bases so it is clear which are derivable from the build itself and
 * which genuinely depend on what the player does.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseModsJson } from '../src/data/moddb.ts';

const CACHE = new URL('../node_modules/.cache/wfcd/', import.meta.url);
const read = (n: string) => (existsSync(new URL(n, CACHE)) ? readFileSync(new URL(n, CACHE), 'utf8') : null);
const mods = read('Mods.json');

if (!mods) {
  console.log('no cached catalogue; run npm run bench once first');
} else {
  const db = parseModsJson(mods);
  const rows = [...db.byPath.values()];

  let withAny = 0;
  let onlyConditional = 0;
  const bases = new Map<string, number>();
  const conds = new Map<string, number>();
  const examples = new Map<string, string>();

  for (const r of rows) {
    const effects = r.effects ?? [];
    if (effects.length === 0) continue;
    let sawPlain = false;
    let sawGated = false;
    for (const e of effects) {
      const gated = (e.conditions?.length ?? 0) > 0 || e.scalingBasis !== undefined;
      if (gated) {
        sawGated = true;
        if (e.scalingBasis !== undefined) {
          const k = e.scalingBasis.toLowerCase().trim();
          bases.set(k, (bases.get(k) ?? 0) + 1);
          if (!examples.has(k)) examples.set(k, r.name);
        }
        for (const c of e.conditions ?? []) {
          const k = String(c).toLowerCase().trim().slice(0, 48);
          conds.set(k, (conds.get(k) ?? 0) + 1);
          if (!examples.has(k)) examples.set(k, r.name);
        }
      } else sawPlain = true;
    }
    if (sawGated) withAny++;
    if (sawGated && !sawPlain) onlyConditional++;
  }

  console.log(`\n  ${String(rows.length)} mods in the catalogue`);
  console.log(`  ${String(withAny)} carry at least one effect the optimiser drops`);
  console.log(`  ${String(onlyConditional)} are scored as WORTH NOTHING AT ALL - every effect they have is dropped`);

  const top = (m: Map<string, number>, label: string, n: number) => {
    console.log(`\n  ${label}`);
    for (const [k, c] of [...m].sort((a, b) => b[1] - a[1]).slice(0, n)) {
      console.log(`    ${String(c).padStart(4)}  ${k}    e.g. ${examples.get(k) ?? ''}`);
    }
  };
  top(bases, 'the "per X" bases, by how many effects scale on them:', 14);
  top(conds, 'the conditions, by how many effects they gate:', 14);
}
