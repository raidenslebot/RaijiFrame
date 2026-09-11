/**
 * HOW FAR FROM "EVERY POSSIBLE COMBINATION" IS THE BEAM?
 *
 * The brief asks for "every single possible mod combination ... including every
 * single possible combination in the entire game". The optimiser does not
 * enumerate them, and cannot: choosing 8 mods from the Braton's 105 eligible
 * rows is 3.5e11 sets before ranks are considered, and each set has to be
 * assigned to polarised slots and scored. It runs a beam instead.
 *
 * So the honest question is not "does it enumerate" - it does not - but "does
 * the beam ever return a worse build than enumeration would". That is
 * MEASURABLE on pools small enough to enumerate, and this measures it: for a
 * range of pool sizes it runs both and reports the gap.
 *
 * It is a MEASUREMENT, not a gate. It exits 0 whatever it finds and prints the
 * numbers; `check-optimise.ts` holds the pass/fail version on one small pool.
 * The point of this file is to say how large "small" can get before the beam
 * starts losing, which is the only evidence that the shipped search is sound at
 * the size it actually runs at.
 *
 * HOW FAR OFF IS EXHAUSTIVE ON A REAL CASE? MEASURED, 2026-09-08.
 * --------------------------------------------------------------
 * The smallest real search the app performs is Ash under Q3: of 122 eligible
 * mods only 25 score, collapsing to 21 families. That looks enumerable -
 * C(21,8) is 203,490 - and it is not, for a reason worth writing down.
 *
 * At MAX RANK ONLY, a depth-first enumeration over those 21 families with a
 * capacity bound visits 159,837 nodes in 298 ms and returns 3,936.70 effective
 * health. The beam returns 4,049.47. The beam BEATS the enumeration, because
 * the enumeration cannot express what the beam's rank-down pass found: Steel
 * Fiber at rank 8 rather than 10, which frees the two points that let a sixth
 * mod fit. So a max-rank enumeration is not an upper bound at all - it is a
 * lower bound over a strictly smaller space, and the rank-down pass is worth
 * +112.77 effective health, +2.9 %, on this build.
 *
 * RANK-COMPLETE, every rank of every scoring mod is its own candidate: 195
 * candidates over 21 families. That enumeration visited 40,000,000 nodes in
 * 80 seconds without finishing, its best still at 2,918. On the app's SMALLEST
 * real case.
 *
 * So "every possible combination" is not available, and now with a number
 * attached rather than an assertion: not for a weapon, and not even for the
 * narrowest objective on the narrowest item. What is available is what this
 * file measures - the beam matching enumeration wherever enumeration can
 * finish - plus the knowledge that the rank-down pass is doing real work the
 * enumeration cannot even represent.
 *
 * Run: node scripts/measure-beam.ts
 */
import { loadItemDb } from '../src/data/itemdb.ts';
import { loadModDb } from '../src/data/moddb.ts';
import { assign, eligibleSlots, family, score, search, type Candidate } from '../src/data/optimise.ts';
import { drainAtRank } from '../src/data/modded.ts';

const BRATON = '/Lotus/Weapons/Tenno/Rifle/Rifle';
/** 2^20 masks is a million sets; past that the enumeration is the slow half, not the beam. */
const SIZES = [8, 10, 12, 14, 16, 18, 20];
/** Deliberately tight, so the search must actually choose rather than take everything. */
const CAPACITIES = [30, 60];

const items = await loadItemDb();
const mods = await loadModDb();
const item = items.byType.get(BRATON);
if (!item) {
  console.log('the Braton is not in the catalogue; nothing to measure');
  process.exitCode = 0;
} else {
  const slots = eligibleSlots(item);
  const eligible = [...mods.byPath.values()].filter((m) => m.slot !== null && slots.has(m.slot) && m.ranks > 0 && !m.isAura);

  /* Rank every eligible mod by what it is worth ALONE, so the pools below are
   * the mods a search would actually be choosing between rather than an
   * arbitrary slice of the catalogue. */
  const solo = eligible
    .map((row) => {
      const rank = row.fusionLimit ?? row.ranks - 1;
      const c: Candidate = { row, rank, polarity: 'none', drain: drainAtRank(row.baseDrain ?? 0, rank) };
      return { c, value: score(item, [{ row, rank }]).score.value };
    })
    .filter((x) => Number.isFinite(x.value))
    .sort((a, b) => b.value - a.value);

  console.log(`Braton: ${String(eligible.length)} eligible mods, ${String(solo.length)} scoreable`);
  console.log('\n  pool  cap   beam        exhaustive  gap      sets        beam ms  full ms');

  for (const cap of CAPACITIES) {
    for (const n of SIZES) {
      const pool = solo.slice(0, n).map((x) => x.c);
      if (pool.length < n) continue;
      const grid = { grid: [] as never[], capacity: cap };

      const t0 = performance.now();
      const beam = search('Q1', item, pool, grid);
      const beamMs = performance.now() - t0;

      const t1 = performance.now();
      let best = 0;
      const total = 1 << pool.length;
      for (let mask = 0; mask < total; mask++) {
        const set: Candidate[] = [];
        for (let i = 0; i < pool.length; i++) if (mask & (1 << i)) set.push(pool[i]!);
        if (set.length > 8) continue; // the grid holds eight
        /*
         * THE FAMILY RULE, and leaving it out is what made the first run of
         * this measurement lie.
         *
         * The game forbids two mods of one family on the same item - Serration
         * and Primed Serration cannot both be installed - and the beam obeys
         * that. The enumeration did not, so it was free to build sets no player
         * can build, and it "beat" the beam by 0.44 % with an illegal build.
         * A benchmark that is allowed to cheat measures nothing.
         */
        const fam = new Set(set.map((c) => family(c.row)));
        if (fam.size !== set.length) continue;
        if (assign(set, grid.grid).drain > cap) continue;
        const v = score(item, set.map((c) => ({ row: c.row, rank: c.rank }))).score.value;
        if (v > best) best = v;
      }
      const fullMs = performance.now() - t1;

      /* The beam may BEAT enumeration, because it is also allowed to rank a mod
       * down to make it fit and enumeration here is at max rank only. A
       * negative gap is that, not a bug. */
      const gap = best > 0 ? (beam.score.value - best) / best : 0;
      console.log(
        `  ${String(n).padStart(4)}  ${String(cap).padStart(3)}   ` +
          `${beam.score.value.toFixed(1).padStart(10)}  ${best.toFixed(1).padStart(10)}  ` +
          `${(gap * 100).toFixed(3).padStart(7)}%  ${total.toLocaleString('en-US').padStart(10)}  ` +
          `${beamMs.toFixed(0).padStart(7)}  ${fullMs.toFixed(0).padStart(7)}`,
      );
    }
  }
  console.log('\na negative gap means the beam BEAT enumeration, which it can: it may rank a mod down to fit.');
}
