/**
 * Self-check for the mastery engine.
 *
 * Every expected number here is quoted from docs/research/mastery-math.md - the
 * rank table (§1.2), the affinity table (§4.1) and the Forma cumulative table
 * (§4.2) - so this file is the tripwire on the research, not just on the code.
 *
 * The one that matters most is `formaTrap`: the naive `sqrt(XP / 500)` reading of a
 * 5-Forma Kuva weapon returns rank 86, and if that ever comes back this check fails.
 *
 * Run: node scripts/check-mastery.ts
 */
import assert from 'node:assert/strict';
import {
  honestCompletion,
  lifetimeAffinityForRank,
  masteryForType,
  masteryFromAccount,
  masteryOpportunities,
  masteryTotals,
  normaliseItemType,
  ownedTypes,
  rankForXp,
  rankName,
  weaponRank,
  frameRank,
  xpForRank,
  type MasteryDb,
  type MasteryEntry,
} from '../src/data/mastery.ts';
import type { RawInventory } from '../src/core/gep.ts';

const BRATON = '/Lotus/Weapons/Tenno/Rifle/Braton';
const KUVA = '/Lotus/Weapons/Grineer/KuvaLich/Primary/KuvaBramma';
const EXCAL = '/Lotus/Powersuits/Excalibur/Excalibur';
const VOIDRIG = '/Lotus/Powersuits/EntratiMech/NechroTech';
const EXALTED = '/Lotus/Weapons/Tenno/Melee/PrismaticMelee/ExaltedBlade';

const entries: Array<[string, MasteryEntry]> = [
  [BRATON, { name: 'Braton', category: 'primaries', isFrame: false, grantsMastery: true }],
  [KUVA, { name: 'Kuva Bramma', category: 'primaries', isFrame: false, grantsMastery: true, maxLevelCap: 40 }],
  [EXCAL, { name: 'Excalibur', category: 'frames', isFrame: true, grantsMastery: true }],
  // §2.2 - DE publishes no maxLevelCap for warframes, so the catalog hardcodes 40.
  [VOIDRIG, { name: 'Voidrig', category: 'necramech', isFrame: true, grantsMastery: true, maxLevelCap: 40 }],
  // §2.3 - SpecialItems pay nothing (Venari and Venari Prime excepted).
  [EXALTED, { name: 'Exalted Blade', category: 'melee', isFrame: false, grantsMastery: false }],
];

const db: MasteryDb = {
  items: new Map(entries),
  // §2.5 - real values, deliberately non-uniform.
  nodes: new Map([['SolNode27', 24], ['SolNode132', 163]]),
  junctions: new Set(['EarthToVenusJunction']),
};

const acc: RawInventory = {
  PlayerLevel: 12,
  XPInfo: [
    { ItemType: BRATON, XP: 450_000 },
    { ItemType: EXCAL, XP: 900_000 },
    { ItemType: KUVA, XP: 3_710_000 },
    { ItemType: EXALTED, XP: 900_000 },
    { ItemType: '/Lotus/Weapons/NotInTheCatalog', XP: 450_000 },
  ],
  Missions: [
    { Tag: 'SolNode27', Completes: 3 },
    { Tag: 'SolNode132', Completes: 1, Tier: 1 },
    { Tag: 'EarthToVenusJunction', Completes: 1 },
    { Tag: 'SolNodeNotWorthAnything', Completes: 9 },
  ],
  LongGuns: [{ ItemType: BRATON }],
  Suits: [{ ItemType: EXCAL }],
};

function rankTable() {
  // §1.2, spot-checked across the whole shape of the curve.
  assert.equal(xpForRank(0), 0);
  assert.equal(xpForRank(1), 2_500);
  assert.equal(xpForRank(16), 640_000);
  assert.equal(xpForRank(30), 2_250_000);
  assert.equal(xpForRank(31), 2_397_500, 'LR1');
  assert.equal(xpForRank(36), 3_135_000, 'LR6');
  // §1.3 - the curve is continuous at 30; both steps are 147,500.
  assert.equal(xpForRank(30) - xpForRank(29), xpForRank(31) - xpForRank(30));

  assert.equal(rankForXp(0), 0);
  assert.equal(rankForXp(2_249_999), 29);
  assert.equal(rankForXp(2_250_000), 30);
  // §1.4 - total mastery in the game lands on LR6 with 81,362 short of LR7.
  assert.equal(rankForXp(3_201_138), 36);
  assert.equal(xpForRank(37) - 3_201_138, 81_362);
  assert.equal(rankName(30), 'True Master');
  assert.equal(rankName(36), 'Legendary 6');
}

function noLegendaryCap() {
  // §1.4 - the wiki module has no clamp, and neither may we. A hardcoded LR10 would
  // be wrong the moment DE ships more content.
  assert.equal(rankForXp(xpForRank(40)), 40);
  assert.ok(rankForXp(10_000_000) > 40, 'rank must keep climbing past LR10');
}

function affinityCurves() {
  // §4.1 anchors.
  assert.equal(weaponRank(450_000), 30);
  assert.equal(frameRank(900_000), 30);
  assert.equal(weaponRank(449_999), 29);
  assert.equal(frameRank(112_500), 10, 'a frame at a weapon rank-15 total is only rank 10');
  assert.equal(lifetimeAffinityForRank(30, false), 450_000);
  assert.equal(lifetimeAffinityForRank(30, true), 900_000);
}

function formaTrap() {
  // §4.2 - the single biggest correctness hazard. Naive sqrt(3,710,000 / 500) = 86.
  assert.equal(Math.floor(Math.sqrt(3_710_000 / 500)), 86, 'the wrong answer, for the record');
  assert.equal(weaponRank(3_710_000, 40), 40);
  assert.equal(weaponRank(3_710_000), 30, 'a cap-30 item can never read above 30');

  // Every published cumulative total, both parities, weapons and Necramechs (§4.2).
  const weapon: Array<[number, number]> = [
    [30, 450_000], [31, 930_500], [32, 962_000], [33, 1_506_500], [34, 1_540_000],
    [35, 2_152_500], [36, 2_188_000], [37, 2_872_500], [38, 2_910_000], [39, 3_670_500],
    [40, 3_710_000],
  ];
  for (const [rank, total] of weapon) {
    assert.equal(lifetimeAffinityForRank(rank, false), total, `weapon lifetime affinity at ${rank}`);
    assert.equal(lifetimeAffinityForRank(rank, true), total * 2, `mech lifetime affinity at ${rank}`);
    assert.equal(weaponRank(total, 40), rank, `weapon rank from lifetime affinity ${total}`);
    assert.equal(frameRank(total * 2, 40), rank, `mech rank from lifetime affinity ${total * 2}`);
  }

  // Mid-cycle: 962,000 is exactly rank 32, and one affinity short is still rank 32
  // (the item is rank 0 of its next Forma cycle, but mastery is paid on the peak).
  assert.equal(weaponRank(962_001, 40), 32);
}

function masteryRates() {
  // §2.1 / §2.2 - rank x perRank is correct for rank-40 items too; no bonus on top.
  const at = (type: string, xp: number) => {
    const entry = db.items.get(type);
    if (!entry) throw new Error(`fixture missing ${type}`);
    return masteryForType(entry, xp);
  };
  assert.equal(at(BRATON, 450_000), 3_000);
  assert.equal(at(EXCAL, 900_000), 6_000);
  assert.equal(at(KUVA, 3_710_000), 4_000);
  assert.equal(at(VOIDRIG, 7_420_000), 8_000, 'Necramech is 8,000, not 6,000 + a bonus');
  // §2.3 - an exalted weapon can be rank 30 and still pay nothing.
  assert.equal(at(EXALTED, 900_000), 0);
}

function breakdownFromAccount() {
  const m = masteryFromAccount(acc, db);
  assert.equal(m.breakdown.primaries, 7_000, 'Braton 3,000 + Kuva Bramma 4,000');
  assert.equal(m.breakdown.frames, 6_000);
  assert.equal(m.breakdown.melee, 0, 'the exalted weapon contributes nothing');
  // §2.5 - Steel Path counts a node twice; a node not in the table pays nothing.
  assert.equal(m.breakdown.nodes, 24 + 163 * 2);
  assert.equal(m.breakdown.junctions, 1_000);
  assert.equal(m.breakdown.intrinsics, null, 'intrinsic ranks are not in verified data');
  assert.equal(m.xp, 7_000 + 6_000 + 24 + 326 + 1_000);
  // The GAME's rank wins. Our XP sum is an estimate built from what the catalog
  // says items are worth, and on a real account it read MR 7 while the game said
  // MR 4 - it cannot see what DE has actually banked. So `rank` is the reported
  // one and the derived value is demoted to `estimatedRank`.
  assert.equal(m.estimatedRank, rankForXp(m.xp), 'the derived rank is still computed');
  assert.equal(m.rank, 12, 'but the game-reported rank is what the app displays');
  // The SIZE, not merely the fact. `rankDiverges` was a boolean nothing read,
  // while the panels printed a number they computed themselves and got wrong -
  // so the gate said "the divergence is surfaced" about a screen that showed
  // nothing. A value assertion is the only kind that could have caught that.
  assert.equal(m.rankGap, 12 - rankForXp(m.xp), 'the gap is reported minus estimated, and it is not zero');
  assert.notEqual(m.rankGap, 0, 'a zero gap here would make every divergence notice unreachable');
  assert.deepEqual(m.unknownTypes, ['/Lotus/Weapons/NotInTheCatalog']);
  assert.equal(m.reportedRank, 12, 'the game-reported rank is kept as a cross-check');

  const withIntrinsics = masteryFromAccount(acc, db, {
    railjackIntrinsicRanks: 50,
    drifterIntrinsicRanks: 40,
  });
  assert.equal(withIntrinsics.breakdown.intrinsics, 135_000, '90 ranks x 1,500 (§2.5)');
}

function honestGaps() {
  // No XPInfo: every equipment line must be null, not 0.
  const m = masteryFromAccount({ Missions: acc.Missions }, db);
  assert.equal(m.fromLedger, false);
  assert.equal(m.breakdown.primaries, null);
  assert.equal(m.breakdown.nodes, 24 + 163 * 2, 'missions still count without a ledger');

  // No catalog: no denominator, and therefore no percentage.
  const empty: MasteryDb = { items: new Map() };
  const totals = masteryTotals(empty);
  assert.equal(totals.available, null);
  const c = honestCompletion(masteryFromAccount(acc, empty), empty);
  assert.equal(c.ofAvailable.pct, null, 'a missing catalog must not produce a percentage');
}

function threeNumbers() {
  const founders: MasteryDb = {
    items: new Map([
      ...entries,
      ['/Lotus/Powersuits/Excalibur/ExcaliburPrime', { category: 'frames', isFrame: true, grantsMastery: true, obtainable: false }],
    ]),
    nodes: db.nodes,
    junctions: db.junctions,
  };
  const c = honestCompletion(masteryFromAccount(acc, founders), founders);
  const t = masteryTotals(founders);
  assert.ok(t.available != null && t.obtainable != null);
  assert.equal(t.available - t.obtainable, 6_000, 'only the unobtainable item leaves the denominator');
  const { pct: movable } = c.ofObtainable;
  const { pct: absolute } = c.ofAvailable;
  assert.ok(movable != null && absolute != null);
  assert.ok(movable > absolute, 'the movable number must be the larger one');
  // Progress is null by design when our XP model disagrees with the game's own
  // PlayerLevel; the span identity only has to hold when it is present.
  if (c.toNextRank.xpIntoRank != null && c.toNextRank.xpToNextRank != null) {
    assert.equal(
      c.toNextRank.xpIntoRank + c.toNextRank.xpToNextRank,
      xpForRank(c.toNextRank.next) - xpForRank(c.toNextRank.rank),
    );
  }
}

function opportunities() {
  const list = masteryOpportunities(acc, db);
  const byType = new Map(list.map((o) => [o.itemType, o]));
  assert.equal(byType.has(BRATON), false, 'a maxed item is never suggested');
  assert.equal(byType.has(KUVA), false, 'a rank-40 item at 3,710,000 is finished');
  assert.equal(byType.has(EXALTED), false, 'items that pay no mastery are not opportunities');

  const mech = byType.get(VOIDRIG);
  assert.ok(mech, 'an unowned Necramech is an opportunity');
  assert.equal(mech.owned, false);
  assert.equal(mech.remaining, 8_000);
  assert.equal(mech.affinityRemaining, 7_420_000);
  assert.equal(mech.forma, 5);
  // §5.3 - the rank-40 grind is 6.2x worse per point than a normal 0-30 climb.
  assert.equal(Math.round(mech.affinityPerPoint), 928);

  // Sorted cheapest-per-point first, so a frame outranks a mech.
  const partial: RawInventory = { XPInfo: [{ ItemType: EXCAL, XP: 0 }] };
  const ranked = masteryOpportunities(partial, db);
  // 150 affinity/point beats 928, and on a tie the bigger prize leads.
  assert.equal(ranked[0]?.itemType, EXCAL);
  assert.equal(ranked[1]?.itemType, BRATON);
  assert.equal(ranked.at(-1)?.itemType, KUVA);

  /*
   * WHAT YOU ALREADY OWN LEADS, WHATEVER IT COSTS PER POINT.
   * ————————————————————————————————————————————
   * `affinityPerPoint` ties across roughly six hundred items - every plain
   * weapon costs the same 150 - so it decided almost nothing, and `owned` was
   * computed on every row and left out of the sort entirely. An unowned weapon
   * behind a lich grind therefore sorted level with one already in the arsenal,
   * on the grounds that both pay 150 a point: true of the affinity, and silent
   * about the evening.
   *
   * Here the account owns the Necramech, the single WORST thing on the list per
   * point at 928 against 150. It still leads, because owning a thing is not
   * worth some number of affinity-per-point that a cheap enough unowned item
   * could overcome - it is a different kind of task. The old key then orders
   * within each group, which is where it was always meaningful.
   */
  const holdsMech: RawInventory = {
    MechSuits: [{ ItemType: VOIDRIG }],
    XPInfo: [{ ItemType: EXCAL, XP: 0 }],
  } as unknown as RawInventory;
  const owned = masteryOpportunities(holdsMech, db);

  assert.equal(owned[0]?.itemType, VOIDRIG, 'the owned item leads even at 928 affinity a point');
  assert.equal(owned[0]?.owned, true);
  assert.ok(
    (owned[0]?.affinityPerPoint ?? 0) > (owned[1]?.affinityPerPoint ?? 0),
    'and it leads DESPITE being the more expensive per point, which is the whole rule',
  );
  assert.equal(owned[1]?.owned, false, 'everything unowned follows, in the old order');
}

function storeItemsNormaliser() {
  // item-catalog.md §4a - the account uses bare types, but a prefixed one showing up
  // on either side of the join must land on the same key, or the item silently
  // vanishes from the ledger and the account under-reports.
  assert.equal(normaliseItemType(`/Lotus/StoreItems${BRATON.slice('/Lotus'.length)}`), BRATON);
  assert.equal(normaliseItemType(BRATON), BRATON, 'a bare type must pass through untouched');
  assert.equal(
    normaliseItemType(normaliseItemType(`/Lotus/StoreItems${KUVA.slice('/Lotus'.length)}`)),
    KUVA,
    'idempotent - normalising twice must not eat a second path segment',
  );
  // Only the exact prefix is stripped; a type that merely mentions the word is not one.
  assert.equal(normaliseItemType('/Lotus/Types/StoreItems/Thing'), '/Lotus/Types/StoreItems/Thing');

  // The round trip that actually matters: a prefixed ledger entry and a prefixed
  // ownership entry must both join the bare-keyed catalog.
  const prefixed: RawInventory = {
    XPInfo: [{ ItemType: `/Lotus/StoreItems${BRATON.slice('/Lotus'.length)}`, XP: 450_000 }],
    LongGuns: [{ ItemType: `/Lotus/StoreItems${BRATON.slice('/Lotus'.length)}` }],
  };
  const m = masteryFromAccount(prefixed, db);
  assert.equal(m.breakdown.primaries, 3_000, 'a prefixed ledger entry must still be credited');
  assert.deepEqual(m.unknownTypes, [], 'and must not be reported as an unknown type');
  assert.ok(ownedTypes(prefixed).has(BRATON), 'ownership must normalise to the same key');
}

function emptyAndPartialAccounts() {
  // No inventory at all - GEP has not pushed one yet. Nothing may be invented, and
  // nothing may throw: this is the state the panel renders in for its first seconds.
  const none = masteryFromAccount(null, db);
  assert.equal(none.rank, 0);
  assert.equal(none.xp, 0);
  assert.equal(none.reportedRank, null);
  assert.equal(none.fromLedger, false);
  assert.equal(none.breakdown.frames, null, 'no data means null, never a zero to display');
  assert.equal(none.breakdown.nodes, null);
  assert.equal(none.xpToNextRank, xpForRank(1));
  assert.deepEqual(ownedTypes(null), new Set());

  // An inventory that exists but is empty is a DIFFERENT answer: we did look at the
  // missions and there genuinely are none, so the mission lines are 0, not null.
  const blank = masteryFromAccount({}, db);
  assert.equal(blank.breakdown.nodes, 0);
  assert.equal(blank.breakdown.junctions, 0);
  assert.equal(blank.breakdown.frames, null, 'but with no ledger the item lines stay null');

  // PlayerLevel without any ledger: the reported rank is kept and the derived rank
  // stays 0. That gap is the size of what the app cannot explain and must not be closed.
  const levelOnly = masteryFromAccount({ PlayerLevel: 16 }, db);
  assert.equal(levelOnly.reportedRank, 16);
  assert.equal(levelOnly.rank, 16, 'the game is authoritative even with no ledger');
  assert.equal(levelOnly.estimatedRank, 0, 'and the unexplained gap stays visible');
  assert.equal(levelOnly.rankGap, 16, 'the whole reported rank is unexplained, and that is the number shown');

  // Malformed rows are common in a memory-read dump; they must be skipped, not crash.
  const messy: RawInventory = {
    XPInfo: [{ ItemType: BRATON, XP: 450_000 }],
    Suits: [{ ItemType: EXCAL }],
    Sentinels: 'not an array',
    MechSuits: [null, {}, { ItemType: VOIDRIG }],
  };
  assert.deepEqual([...ownedTypes(messy)].sort(), [EXCAL, VOIDRIG].sort());
  assert.equal(masteryFromAccount(messy, db).breakdown.primaries, 3_000);

  // And an account with no catalog to join against reports everything as unknown
  // rather than crediting or dropping it.
  const noCatalog = masteryFromAccount(acc, { items: new Map() });
  assert.equal(noCatalog.xp, 0);
  assert.equal(noCatalog.unknownTypes.length, 5, 'every ledger entry is unexplained, and said to be');
}

const checks = [
  rankTable,
  noLegendaryCap,
  affinityCurves,
  formaTrap,
  masteryRates,
  breakdownFromAccount,
  honestGaps,
  threeNumbers,
  opportunities,
  storeItemsNormaliser,
  emptyAndPartialAccounts,
];

let failed = 0;
for (const c of checks) {
  try {
    c();
    console.log(`  ok    ${c.name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${c.name}\n        ${(err as Error).message}`);
  }
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall mastery rules hold');
// Set the code rather than calling process.exit(): exiting immediately can race
// stdout flushing on Windows and print a libuv assertion after the report.
process.exitCode = failed ? 1 : 0;
