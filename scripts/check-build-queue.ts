/**
 * Two things you can build, that you cannot build together.
 *
 * WHAT THIS GUARDS
 * ────────────────
 * `checkBuildable` reports on one blueprint against the whole inventory. Run it
 * twice and you get two independent verdicts, each correct, which together
 * imply something false: that both can be started. They share a stock. Holding
 * four Orokin Cells satisfies a recipe needing four, and satisfies a second
 * recipe needing four, and does not satisfy both.
 *
 * That is the entire reason `build-queue.ts` exists, so it is the first thing
 * asserted here. The `contested` flag is deliberately narrower than "short":
 * short is ordinary, and contested means the shortfall was CREATED by the
 * combination - every claimant would have been fine alone. A flag that fired on
 * any shared-and-short row would be restating arithmetic the player can already
 * see; this one reports something no per-build check can.
 *
 * The rest of the file guards the ways a pool can lie:
 *
 *   - pooling on a display NAME instead of an item path, which would add Ash's
 *     Chassis to Ash Prime's (187 of 324 component names are shared);
 *   - pooling an unreadable ingredient as zero;
 *   - forgetting that credits pool too - four builds at 25,000 is 100,000;
 *   - promising a subset it cannot actually deliver.
 *
 * The fixtures are hand-built structures in the app's own types. They are not
 * game data and nothing here reaches a screen.
 *
 * Run: node scripts/check-build-queue.ts
 */

import assert from 'node:assert/strict';
import { queueOf } from '../src/data/build-queue.ts';
import type { Buildable } from '../src/data/buildable.ts';
import type { RawAccount } from '../src/data/account.ts';

const CELL = '/Lotus/Types/Items/MiscItems/OrokinCell';
const PLATE = '/Lotus/Types/Items/MiscItems/AlloyPlate';

function build(name: string, parts: Array<[string | null, string, number]>, credits = 0): Buildable {
  return {
    itemType: `/Lotus/Types/Recipes/${name.replace(/\s+/g, '')}Blueprint`,
    product: name,
    verdict: 'short',
    needs: [],
    shortCount: 0,
    unreadCount: 0,
    closeness: null,
    buildTimeSec: null,
    credits: credits === 0 ? null : credits,
    parts: parts.map(([itemType, pname, want]) => ({ itemType, name: pname, want })),
  };
}

const acct = (misc: Array<[string, number]>, credits = 1_000_000): RawAccount =>
  ({
    MiscItems: misc.map(([ItemType, ItemCount]) => ({ ItemType, ItemCount })),
    Recipes: [],
    RegularCredits: credits,
  }) as unknown as RawAccount;

/* ---------------------------------------- 1. the finding this exists for */

{
  // Each wants 4 cells. The account holds 4. Each ALONE is satisfied.
  const a = build('Alpha', [[CELL, 'Orokin Cell', 4]]);
  const b = build('Beta', [[CELL, 'Orokin Cell', 4]]);
  const acc = acct([[CELL, 4]]);

  const alone = queueOf([a], acc);
  assert.equal(alone.verdict, 'all', 'one of them alone is affordable');
  assert.equal(queueOf([b], acc).verdict, 'all', 'and so is the other, alone');

  const both = queueOf([a, b], acc);
  assert.equal(both.verdict, 'short', 'together they are not');

  const cells = both.needs.find((n) => n.itemType === CELL);
  assert.ok(cells !== undefined);
  assert.equal(cells.need, 8, 'the pool sums the claims');
  assert.equal(cells.have, 4);
  assert.equal(cells.claims.length, 2, 'and names both claimants');
  assert.equal(
    cells.contested,
    true,
    'CONTESTED: shared, short, and every claimant would have been satisfied alone',
  );

  assert.deepEqual(both.contested, [cells], 'the finding is surfaced on its own');
  assert.equal(both.affordable.length, 1, 'exactly one of them can actually be started');
  assert.equal(both.blocked.length, 1, 'and the other is reported blocked, not silently dropped');
}

/* ------------------------------- 2. short-but-not-contested is different */

{
  // Nobody could build this alone; the shortfall is not caused by sharing.
  const a = build('Alpha', [[CELL, 'Orokin Cell', 10]]);
  const b = build('Beta', [[CELL, 'Orokin Cell', 10]]);
  const q = queueOf([a, b], acct([[CELL, 3]]));
  const cells = q.needs.find((n) => n.itemType === CELL);
  assert.equal(cells?.met, false, 'still short');
  assert.equal(
    cells?.contested,
    false,
    'but NOT contested - neither could be built alone, so the combination created nothing',
  );
  assert.equal(q.affordable.length, 0);
  assert.equal(q.blocked.length, 2);
}

/* ------------------------------------- 3. the pool keys on path, not name */

{
  /*
   * Two ingredients with the SAME display name and DIFFERENT paths. A pool
   * keyed on the name would report one row needing 6; they are different
   * things and must stay apart.
   */
  const a = build('Alpha', [[CELL, 'Component', 3]]);
  const b = build('Beta', [[PLATE, 'Component', 3]]);
  const q = queueOf([a, b], acct([[CELL, 3], [PLATE, 3]]));
  const rows = q.needs.filter((n) => n.what === 'Component');
  assert.equal(rows.length, 2, 'same name, different paths, two rows');
  assert.ok(rows.every((r) => r.need === 3), 'and neither absorbed the other');
  assert.equal(q.verdict, 'all');
}

/* ------------------------------- 4. an unreadable ingredient is not zero */

{
  const a = build('Alpha', [[null, 'Mystery', 2]]);
  const q = queueOf([a], acct([]));
  const row = q.needs.find((n) => n.what === 'Mystery');
  assert.equal(row?.have, null, 'ABSENT IS NOT ZERO');
  assert.equal(row?.met, null);
  assert.ok((row?.unknown ?? '').length > 0, 'and it says why it cannot be read');
  assert.equal(q.verdict, 'unverifiable', 'a queue holding one is never "all"');
  assert.ok(q.affordable.length === 0, 'and it is never promised as affordable');
}

/* ---------------------------------------- 5. an unread account knows nothing */

{
  const q = queueOf([build('Alpha', [[CELL, 'Orokin Cell', 1]])], null);
  assert.equal(q.verdict, 'unverifiable');
  assert.ok(
    q.needs.every((n) => n.have === null && n.met === null),
    'every stock is unknown, not zero',
  );
  assert.ok(
    q.needs.every((n) => n.need !== null && n.need > 0),
    'the COST is still stated - that is a fact about the recipe, not about the player',
  );
  assert.equal(q.affordable.length, 0, 'nothing is promised');
}

/* --------------------------------------------------- 6. credits pool too */

{
  const four = [1, 2, 3, 4].map((i) => build(`Frame ${String(i)}`, [[CELL, 'Orokin Cell', 1]], 25_000));
  const q = queueOf(four, acct([[CELL, 99]], 60_000));
  const credits = q.needs.find((n) => n.what === 'Credits');
  assert.equal(credits?.need, 100_000, 'four builds at 25,000 is 100,000, not 25,000');
  assert.equal(credits?.have, 60_000);
  assert.equal(credits?.met, false);
  assert.equal(q.affordable.length, 2, 'only what the credits actually cover');
}

/* -------------------------------------- 7. the subset it promises is real */

{
  const a = build('Alpha', [[CELL, 'Orokin Cell', 3]]);
  const b = build('Beta', [[CELL, 'Orokin Cell', 3]]);
  const c = build('Gamma', [[CELL, 'Orokin Cell', 3]]);
  const q = queueOf([a, b, c], acct([[CELL, 7]]));
  assert.equal(q.affordable.length, 2, 'seven cells buys two of three');
  assert.equal(q.blocked.length, 1);
  assert.equal(
    q.affordable.length + q.blocked.length,
    3,
    'every build is accounted for as either affordable or blocked, never dropped',
  );
}

/* ------------------------------------------------------------ 8. empty */

assert.equal(queueOf([], acct([])).verdict, 'empty', 'an empty queue says so rather than claiming "all"');

console.log('  ok    two builds each affordable alone can be short together, and it is reported');
console.log('  ok    contested is narrower than short: the combination has to have caused it');
console.log('  ok    the pool keys on item path, so two ingredients sharing a name stay apart');
console.log('  ok    an unreadable ingredient and an unread account stay unknown, never zero');
console.log('  ok    credits pool across the queue, and the affordable subset is really affordable');
console.log('\nthe queue accounts for what its builds take from each other\n');
