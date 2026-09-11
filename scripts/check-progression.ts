/**
 * Self-check for progression derivation and the recommender.
 *
 * The rules that matter here: cleared content never gets recommended again, and
 * a missing canonical dataset yields `null` totals rather than a made-up
 * denominator.
 *
 * Run: node scripts/check-progression.ts
 */
import assert from 'node:assert/strict';
import { derive, pct, recommend, type Action } from '../src/data/progression.ts';
import type { RawInventory } from '../src/core/gep.ts';

const inv: RawInventory = {
  PlayerLevel: 12,
  XPInfo: [
    { ItemType: '/Lotus/Powersuits/Excalibur', XP: 1_600_000 },
    { ItemType: '/Lotus/Weapons/Braton', XP: 450_000 },
  ],
  QuestKeys: [
    { ItemType: '/Lotus/Types/Keys/VorsPrize', Completed: true },
    { ItemType: '/Lotus/Types/Keys/OnceAwake', Completed: true },
    { ItemType: '/Lotus/Types/Keys/TheArchwing', Completed: false },
  ],
  Missions: [
    { Tag: 'SolNode1', Completes: 4 },
    { Tag: 'SolNode2', Completes: 1 },
    { Tag: 'SolNode3', Completes: 0 },
  ],
  Suits: [{ ItemType: 'a' }, { ItemType: 'b' }],
  LongGuns: [{ ItemType: 'c' }],
  Pistols: [],
  Melee: [{ ItemType: 'd' }],
};

function derivation() {
  const p = derive(inv);
  assert.equal(p.masteryRank, 12);
  assert.equal(p.masteryXp, 2_050_000);
  assert.equal(p.quests.have, 2, 'only Completed quests count');
  // Without a catalog there is no population to count the cleared tags against,
  // so the COUNT is unknown - but the SET is still exact, and that is what every
  // graph walk and the chart paint actually use.
  assert.equal(p.nodes.have, null, 'a count with no catalog is a guess, not a measurement');
  assert.equal(p.clearedNodes.size, 2, 'a node with 0 completes is not cleared');
  assert.equal(
    derive(inv, { nodeCount: 3, nodeIds: new Set(['SolNode1', 'SolNode2', 'SolNode3']) }).nodes.have,
    2,
    'with the catalog supplied the count is the intersection',
  );
}

function honestDenominator() {
  const bare = derive(inv);
  assert.equal(bare.quests.total, null, 'no dataset must mean no total, not a guess');
  assert.equal(pct(bare.quests), null, 'no total must mean no percentage');

  const withCanon = derive(inv, { questCount: 8, nodeCount: 10 });
  assert.equal(withCanon.quests.total, 8);
  assert.equal(pct(withCanon.quests), 25);
}

function emptyAccount() {
  const p = derive(null);
  // No account is not "zero quests completed". That distinction is the whole
  // reason every figure in this app is nullable.
  assert.equal(p.quests.have, null, 'an unread account was reported as having done nothing');
  assert.equal(p.nodes.have, null, 'an unread account was reported as having cleared nothing');
  assert.equal(p.masteryRank, null);
  assert.equal(p.completedQuests.size, 0);
}

const actions: Action[] = [
  { id: '/Lotus/Types/Keys/VorsPrize', kind: 'quest', title: "Vor's Prize", because: 'intro' },
  { id: '/Lotus/Types/Keys/TheArchwing', kind: 'quest', title: 'The Archwing', because: 'unlocks archwing', unlocks: 3 },
  { id: 'SolNode1', kind: 'node', title: 'Node one', because: 'already cleared' },
  { id: 'SolNode3', kind: 'node', title: 'Node three', because: 'uncleared' },
  { id: 'SolNode9', kind: 'junction', title: 'Venus Junction', because: 'gates Venus', requires: ['/Lotus/Types/Keys/TheArchwing'] },
];

function neverRepeats() {
  const p = derive(inv);
  const out = recommend(actions, p);
  const ids = out.map((a) => a.id);

  assert.ok(!ids.includes('/Lotus/Types/Keys/VorsPrize'), 'a completed quest must never be recommended');
  assert.ok(!ids.includes('SolNode1'), 'an already-cleared node must never be recommended');
  assert.ok(ids.includes('SolNode3'), 'an uncleared node is still fair game');
}

function aDriftedKeyPathStillCountsAsDone() {
  /*
   * THE MISMATCH THAT MADE THE BOARD LIE IN BOTH DIRECTIONS.
   * ————————————————————————————————————————————
   * GEP and the export do not always agree on a quest's exact key path. The
   * account below has finished Vor's Prize, recorded under a longer path than
   * the catalog's id - the same quest, spelled differently.
   *
   * `recommend` used a raw `completedQuests.has(id)`, which misses that, and it
   * asks the question twice for opposite purposes. So one mismatch produced two
   * failures at once: the finished quest came back as a recommendation, and the
   * junction it unlocks stayed hidden as blocked. Both are asserted here
   * because fixing only the one you happened to notice leaves the other.
   */
  const drifted = derive({
    ...inv,
    // BOTH paths drift, and that is the point. With the prerequisite spelled
    // exactly, the second assertion below passes with or without the fix - it
    // would sit there looking like coverage and testing nothing.
    QuestKeys: [
      { ItemType: '/Lotus/Types/Keys/Quests/VorsPrize', Completed: true },
      { ItemType: '/Lotus/Types/Keys/Quests/TheArchwing', Completed: true },
    ],
  });
  const ids = recommend(actions, drifted).map((a) => a.id);

  assert.ok(
    !ids.includes('/Lotus/Types/Keys/VorsPrize'),
    'a quest completed under a drifted key path must not be recommended again',
  );
  assert.ok(
    ids.includes('SolNode9'),
    'and a prerequisite satisfied under a drifted key path must not read as a blocker',
  );
}

function respectsPrerequisites() {
  const p = derive(inv);
  const ids = recommend(actions, p).map((a) => a.id);
  assert.ok(!ids.includes('SolNode9'), 'an action gated behind an unfinished quest must be withheld');

  // Once the gating quest is done, the junction becomes available...
  const after = derive({
    ...inv,
    QuestKeys: (inv.QuestKeys ?? []).map((q) => ({ ...q, Completed: true })),
  });
  const afterIds = recommend(actions, after).map((a) => a.id);
  assert.ok(afterIds.includes('SolNode9'), 'clearing the prerequisite must unblock the action');
  // ...and the quest that unblocked it is now itself excluded as done.
  assert.ok(!afterIds.includes('/Lotus/Types/Keys/TheArchwing'));
}

function prefersUnlockingWork() {
  const p = derive(inv);
  const top = recommend(actions, p)[0];
  assert.equal(top?.id, '/Lotus/Types/Keys/TheArchwing', 'the action that opens the most content must rank first');
}

function liveClearsCountImmediately() {
  // A node cleared moments ago is in EE.log but not yet in the inventory dump.
  // It must still count, or the panel would keep recommending what you just did.
  const before = derive(inv);
  assert.ok(!before.clearedNodes.has('SolNode3'), 'not cleared according to the dump');

  // The counter needs the catalog: without it there is no population to count
  // against, and a raw size would be a numerator from a different set than any
  // denominator we could pair it with.
  const chart = { nodeCount: 3, nodeIds: new Set(['SolNode1', 'SolNode2', 'SolNode3']) };
  const countedBefore = derive(inv, chart).nodes.have;
  const after = derive(inv, chart, ['SolNode3']);
  assert.ok(after.clearedNodes.has('SolNode3'), 'a live clear must count immediately');
  assert.ok(countedBefore !== null && after.nodes.have !== null, 'a supplied catalog must yield a count');
  assert.equal(after.nodes.have, countedBefore + 1, 'and must move the counter');
  assert.equal(before.nodes.have, null, 'without the catalog the count is unknown, not a guess');

  const ids = recommend(actions, after).map((a) => a.id);
  assert.ok(!ids.includes('SolNode3'), 'and must stop it being recommended again');
}

function liveClearsWorkBeforeAnyInventory() {
  // The log can report a clear before GEP has ever pushed an inventory.
  const p = derive(null, {}, ['SolNode9']);
  assert.ok(p.clearedNodes.has('SolNode9'), 'live clears must survive a null inventory');
}

const checks = [
  derivation,
  honestDenominator,
  emptyAccount,
  neverRepeats,
  aDriftedKeyPathStillCountsAsDone,
  respectsPrerequisites,
  prefersUnlockingWork,
  liveClearsCountImmediately,
  liveClearsWorkBeforeAnyInventory,
  clearedCountsOnlyNodesTheChartHas,
  anAbsentBucketIsUnknownNotZero,
];

function clearedCountsOnlyNodesTheChartHas() {
  /*
   * `Missions[]` is a WIDER population than the star chart. A real capture
   * (docs/DATA-SOURCES.md) carried 484 completed tags, of which only the SolNode
   * and junction ones are chart nodes - the rest are ClanNode, CrewBattleNode,
   * EventNode, SettlementNode, hub, Nightwave derelict and raid-key tags.
   * Counting all of them against the chart's own size printed "484/353 . 137%"
   * in the star chart headline, clamped the Progression board row to 100%, and
   * resolved the Steel Path gate as finished on a chart the player had not.
   */
  const wide = {
    Missions: [
      { Tag: 'SolNode1', Completes: 1 },
      { Tag: 'SolNode2', Completes: 1 },
      { Tag: 'ClanNode14', Completes: 3 },
      { Tag: 'CrewBattleNode7', Completes: 2 },
      { Tag: 'EventNode22', Completes: 1 },
      { Tag: '/Lotus/Types/Keys/RaidKey', Completes: 9 },
    ],
  } as unknown as RawInventory;
  const chart = { nodeCount: 3, nodeIds: new Set(['SolNode1', 'SolNode2', 'SolNode3']) };
  const picture = derive(wide, chart);

  assert.equal(picture.nodes.have, 2, 'tags that are not chart nodes were counted against the chart');
  assert.ok(
    picture.nodes.have !== null && picture.nodes.total !== null && picture.nodes.have <= picture.nodes.total,
    'the cleared count exceeded the number of nodes that exist',
  );
  // The SET stays whole: the frontier walk, routing and the chart paint all do
  // their own lookups and must still see every completed tag.
  assert.ok(picture.clearedNodes.has('ClanNode14'), 'the cleared set must not be filtered');
}

function anAbsentBucketIsUnknownNotZero() {
  // An absent array and an empty one are different facts, and only one of them
  // is about the player. "0% of the star chart" built out of our own missing
  // data is the one claim this project is not allowed to make.
  const chart = { nodeCount: 3, nodeIds: new Set(['SolNode1']), questCount: 5 };
  const absent = derive({ PlayerLevel: 4 } as unknown as RawInventory, chart);
  assert.equal(absent.nodes.have, null, 'an absent Missions array was reported as zero cleared');
  assert.equal(absent.quests.have, null, 'an absent QuestKeys array was reported as zero quests');
  assert.equal(pct(absent.nodes), null, 'a percentage was computed from an unread account');

  const empty = derive({ Missions: [], QuestKeys: [] } as unknown as RawInventory, chart);
  assert.equal(empty.nodes.have, 0, 'a genuinely empty list is a real zero');
  assert.equal(empty.quests.have, 0, 'a genuinely empty list is a real zero');
}

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
console.log(failed ? `\n${failed} check(s) failed` : '\nall progression rules hold');
// Set the code rather than calling process.exit(): exiting immediately can
// race stdout flushing on Windows and print a libuv assertion after the report.
process.exitCode = failed ? 1 : 0;
