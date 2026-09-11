/**
 * The relic table is priced through its REWARDS, and this checks the premise.
 *
 * WHAT THE PANEL USED TO DO
 * ─────────────────────────
 * `priceRelic` answers for one relic on a click, so the relic list could never
 * show a number - ranking it would have meant pricing 3,089 rows. The list
 * therefore showed a name and the words "6 rewards", which is one fact per row
 * repeated a hundred and fifty times.
 *
 * THE INVERSION
 * ─────────────
 * Those 3,089 rows are 772 distinct relics standing on only ~591 distinct
 * tradeable reward items. Pricing the REWARD set prices every relic at once,
 * and `gentle` persists it, so it is paid for once rather than per click.
 *
 * This gate exists because that ratio is the entire argument. If DE ever
 * restructured the tables so that rewards were as numerous as relics, the
 * inversion would stop being worth anything and the panel would be walking a
 * long list for no gain - silently, because nothing would break. So the ratio
 * is asserted against the live table rather than trusted.
 *
 * OFFLINE IS A SKIP, like every other live gate here.
 *
 * Run: node scripts/check-relic-universe.ts
 */
import assert from 'node:assert/strict';
import { parseRelics, rewardUniverse, valueAll, type Relic } from '../src/data/plat-value.ts';
import type { Price } from '../src/data/market.ts';

const TABLE = 'https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/Relics.json';

let relics: Relic[];
try {
  const res = await fetch(TABLE);
  if (!res.ok) throw new Error(`the drop table responded ${String(res.status)}`);
  relics = parseRelics(await res.text());
  assert.ok(relics.length > 500, `the table parsed to only ${String(relics.length)} relics`);
} catch (err) {
  console.log(`  SKIP  drop table unreachable (${err instanceof Error ? err.message : String(err)})`);
  process.exit(0);
}

const universe = rewardUniverse(relics);

/* ---------------------------------------------------------------- the ratio */

assert.ok(universe.length > 100, `the reward universe collapsed to ${String(universe.length)} - the parse is wrong`);
assert.ok(
  universe.length * 3 < relics.length,
  `the reward set (${String(universe.length)}) is no longer much smaller than the relic set ` +
    `(${String(relics.length)}), so pricing rewards instead of relics has stopped paying. ` +
    'Re-examine whether the universe walk is worth doing at all.',
);
console.log(
  `  ok    ${String(universe.length)} distinct rewards stand behind ${String(relics.length)} relic rows ` +
    `(${String(Math.round((10 * relics.length) / universe.length) / 10)}x)`,
);

/* -------------------------------------------------------------- the ordering */

assert.equal(new Set(universe).size, universe.length, 'a slug is asked for twice');

// Descending by the expectation each request unblocks, which is what makes a
// half-finished pass useful rather than arbitrary.
const mass = new Map<string, number>();
for (const relic of relics) {
  for (const r of relic.rewards) {
    if (r.slug === null) continue;
    mass.set(r.slug, (mass.get(r.slug) ?? 0) + r.chance / 100);
  }
}
let previous = Infinity;
for (const slug of universe) {
  const m = mass.get(slug) ?? 0;
  assert.ok(m <= previous + 1e-9, `${slug} carries more mass than the slug before it - the order is not descending`);
  previous = m;
}
console.log('  ok    ordered by the expectation each request unblocks, descending');

// Deterministic, so an interrupted pass resumes onto the same requests.
assert.deepEqual(rewardUniverse(relics), universe, 'the walk order is not stable between calls');
console.log('  ok    the order is stable, so a resumed pass re-asks the same things');

/* ------------------------------------------------------- coverage, in numbers */

const total = [...mass.values()].reduce((a, b) => a + b, 0);
const at = (n: number): number => {
  let m = 0;
  for (let i = 0; i < n && i < universe.length; i++) m += mass.get(universe[i] ?? '') ?? 0;
  return Math.round((1000 * m) / total) / 10;
};
const [a50, a100, a200] = [at(50), at(100), at(200)];
assert.ok(a50 > 20, `fifty requests resolve only ${String(a50)}% of expectation - the list is useless for too long`);
console.log(`  ok    50 requests resolve ${String(a50)}% of all expectation · 100 → ${String(a100)}% · 200 → ${String(a200)}%`);

/* --------------------------------------------------- absent is not zero, still */

/*
 * The rule this whole app is built on, applied to the new path: valuing every
 * relic against an EMPTY price map must produce zero coverage and no invented
 * platinum - not a list of relics worth 0p, which would read as a measurement.
 */
const unpriced = valueAll(relics, new Map<string, Price>(), null);
assert.equal(unpriced.length, relics.length, 'valuing everything dropped relics');
assert.ok(
  unpriced.every((v) => v.expected === 0 && v.coverage === 0),
  'an unpriced relic reported a platinum expectation it could not have measured',
);
console.log('  ok    with nothing priced, every relic reports 0 coverage rather than a value');

/*
 * And with a PARTIAL map the coverage has to be partial too - this is the term
 * that lets a half-finished pass be shown honestly instead of as a whole answer.
 */
const partial = new Map<string, Price>();
const one = universe[0];
assert.ok(one !== undefined);
partial.set(one, { slug: one, history: [], median: 10, weighted: 10, volume: 5, min: 9, max: 11, trend: 10, at: '' });
const some = valueAll(relics, partial, null);
const touched = some.filter((v) => v.coverage > 0);
assert.ok(touched.length > 0, 'pricing the top slug moved no relic at all');
assert.ok(
  touched.every((v) => v.coverage < 1),
  'one priced reward reported a fully covered relic',
);
console.log(
  `  ok    one priced reward moves ${String(touched.length)} relics, none of them to full coverage`,
);

console.log('\nthe reward universe is smaller than the relic table, and says how much of it it knows');
