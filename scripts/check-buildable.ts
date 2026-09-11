/**
 * Can-you-build-it: the join, and the three states it is allowed to report.
 *
 * WHY THIS IS A GATE AND NOT A GLANCE
 * ───────────────────────────────────
 * This is a join across three sources - the account's `Recipes`, the account's
 * `MiscItems`, and the catalog's `components` - and a join that silently
 * matches nothing looks exactly like a player who owns nothing. There is no
 * error, no exception, no blank region: every requirement simply reads zero,
 * every blueprint reads "short", and the panel is confidently wrong about the
 * one thing it exists to say.
 *
 * WHAT THE REAL CATALOG SAYS, MEASURED ONCE
 * ─────────────────────────────────────────
 * The obvious implementation joins on the component's NAME. Against the live
 * catalog that resolves 238 of the 647 blueprint paths a held recipe can carry
 * - 36.8 per cent - because DE files blueprints under internal codenames:
 * `BrawlerBlueprint` is Atlas, `PacifistBlueprint` is Baruuk, `PagemasterBlueprint`
 * is Dante, `AnimaAnimusBlueprint` is Equinox. The path join resolves 647 of
 * 647. Two thirds of a player's blueprints would have read "not in the
 * catalog", and nothing would have looked broken.
 *
 * The fixtures below are hand-built, so this runs offline and cannot break
 * when WFCD ships a change. The 647-of-647 figure above is the live number and
 * is recorded here rather than asserted, because asserting it would make this
 * gate need a network.
 *
 * Run: node scripts/check-buildable.ts
 */

import assert from 'node:assert/strict';
import { buildItemDb, type ItemDbEntry } from '../src/data/itemdb.ts';
import { checkBuildable, indexByComponent, sortBuildables, tally } from '../src/data/buildable.ts';
import type { RawAccount } from '../src/data/account.ts';

const CELL = '/Lotus/Types/Items/MiscItems/OrokinCell';
const AXE_BP = '/Lotus/Types/Recipes/Weapons/CodenameAxeBlueprint';
const AXE_HANDLE = '/Lotus/Types/Recipes/Weapons/CodenameAxeHandleComponent';

/**
 * A product whose blueprint is filed under a codename, exactly like Atlas. Its
 * display name is "Real Axe"; nothing in its recipe path says so.
 */
const AXE: ItemDbEntry = {
  uniqueName: '/Lotus/Weapons/Tenno/Melee/RealAxe',
  name: 'Real Axe',
  category: 'Melee',
  masteryReq: 0,
  masterable: true,
  maxRank: 30,
  buildTime: 43_200,
  buildPrice: 25_000,
  components: [
    { name: 'Blueprint', itemCount: 1, uniqueName: AXE_BP },
    { name: 'Handle', itemCount: 1, uniqueName: AXE_HANDLE },
    { name: 'Orokin Cell', itemCount: 4, uniqueName: CELL },
    // No uniqueName: the source omits it on a handful of rows, and the amount
    // held then CANNOT be looked up. It must not read as zero.
    { name: 'Mystery Ingredient', itemCount: 2 },
  ],
};

const db = buildItemDb({ Melee: [AXE] }, {}, []);
const idx = indexByComponent(db);

/* ------------------------------------------------- 1. the index resolves */

assert.equal(idx.get(AXE_BP)?.name, 'Real Axe', 'a blueprint path resolves to its product');
assert.equal(idx.get(AXE_HANDLE)?.name, 'Real Axe', 'so does a sub-component path');
assert.equal(
  db.byDisplayName.get('Codename Axe'),
  undefined,
  'and the name derived from that path resolves to nothing at all, which is the whole reason for the path join',
);

/* ------------------------------------- 2. an account holding nothing yet */

const bare = { Recipes: [{ ItemType: AXE_BP, ItemCount: 1 }], MiscItems: [], RegularCredits: 1_000 } as unknown as RawAccount;
const empty = checkBuildable(AXE_BP, bare, idx);

assert.equal(empty.product, 'Real Axe');
assert.equal(empty.verdict, 'short', 'nothing held and something readable is short');
assert.ok(
  !empty.needs.some((n) => n.what === 'Blueprint'),
  'the blueprint you are standing on is not listed as its own ingredient',
);

const handle = empty.needs.find((n) => n.what === 'Handle');
assert.ok(handle !== undefined, 'the sub-component is a requirement');
assert.equal(handle.have, 0, 'a READ account holding none of it really does hold zero');
assert.equal(handle.met, false);

const mystery = empty.needs.find((n) => n.what === 'Mystery Ingredient');
assert.ok(mystery !== undefined);
assert.equal(mystery.have, null, 'a component with no item path is UNREADABLE, never zero');
assert.equal(mystery.met, null);
assert.ok((mystery.unknown ?? '').length > 0, 'and it says why it cannot be read');

const credits = empty.needs.find((n) => n.what === 'Credits');
assert.ok(credits !== undefined, 'credits are a requirement like any other');
assert.equal(credits.need, 25_000);
assert.equal(credits.have, 1_000);
assert.equal(credits.met, false, 'holding every part and no credits is still short');

/* ----------------------------------------- 3. the account that has it all */

const stocked = {
  Recipes: [{ ItemType: AXE_BP, ItemCount: 1 }],
  MiscItems: [
    { ItemType: AXE_HANDLE, ItemCount: 1 },
    { ItemType: CELL, ItemCount: 9 },
  ],
  RegularCredits: 500_000,
} as unknown as RawAccount;
const full = checkBuildable(AXE_BP, stocked, idx);
assert.equal(full.verdict, 'unverifiable', 'one unreadable requirement forbids claiming "ready"');
assert.equal(full.shortCount, 0, 'and nothing is actually short');
assert.equal(full.unreadCount, 1, 'exactly the ingredient with no item path');

/*
 * The same account, against a product whose every component carries a path.
 * This is the only shape allowed to say "ready".
 */
const CLEAN_BP = '/Lotus/Types/Recipes/Weapons/CleanBlueprint';
const clean: ItemDbEntry = {
  ...AXE,
  uniqueName: '/Lotus/Weapons/Tenno/Melee/Clean',
  name: 'Clean Axe',
  components: [
    { name: 'Blueprint', itemCount: 1, uniqueName: CLEAN_BP },
    { name: 'Orokin Cell', itemCount: 4, uniqueName: CELL },
  ],
};
const idx2 = indexByComponent(buildItemDb({ Melee: [clean] }, {}, []));
const ready = checkBuildable(CLEAN_BP, stocked, idx2);
assert.equal(ready.verdict, 'ready', 'everything checked and everything met');
assert.equal(ready.unreadCount, 0);

/* -------------------------------- 4. the account nobody has read: unknown */

const unread = checkBuildable(AXE_BP, null, idx);
assert.equal(unread.verdict, 'unverifiable', 'an unread account is never "short"');
assert.ok(
  unread.needs.every((n) => n.have === null && n.met === null),
  'ABSENT IS NOT ZERO: every holding is unknown, and not one of them is a zero',
);
assert.ok(
  unread.needs.every((n) => (n.unknown ?? '').length > 0),
  'and every one of them says what would settle it',
);
assert.equal(unread.closeness, null, 'nothing readable means no ordering signal, not a zero score');

/* ------------------------------------------- 5. a recipe nothing can place */

const nowhere = checkBuildable('/Lotus/Types/Recipes/Nope/GhostBlueprint', stocked, idx);
assert.equal(nowhere.verdict, 'unplaced');
assert.equal(nowhere.product, null, 'it does not guess a name');
assert.equal(nowhere.needs.length, 0, 'and it does not invent requirements for it');

/* -------------------------------------------------- 6. the order and tally */

const sorted = sortBuildables([nowhere, empty, unread, ready]);
assert.deepEqual(
  sorted.map((b) => b.verdict),
  ['ready', 'short', 'unverifiable', 'unplaced'],
  'what you can start comes first, what cannot be placed comes last',
);

const t = tally(sorted);
assert.deepEqual(t, { ready: 1, short: 1, unverifiable: 1, unplaceable: 1 }, 'the heading counts what it says it counts');

console.log('  ok    a blueprint path resolves to its product where its derived name cannot');
console.log('  ok    an ingredient with no item path is unreadable, never zero');
console.log('  ok    an unread account reports unknown for every holding, never zero');
console.log('  ok    one unreadable requirement forbids claiming the build is ready');
console.log('  ok    credits are checked, and a recipe nothing can place invents nothing');
console.log('\nthe foundry checks what it holds against what it needs\n');
