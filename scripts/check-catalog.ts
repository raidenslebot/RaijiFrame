/**
 * Self-check for the completionism engine.
 *
 * Uses a hand-built fixture graph rather than the vendored datasets, so these
 * rules are asserted independently of whatever the current data happens to say.
 *
 * The rules that matter: the frontier never includes locked or cleared content,
 * leverage counts only what is still outstanding, and a quest whose completion
 * cannot be verified is never recommended.
 *
 * Run: node scripts/check-catalog.ts
 */
import assert from 'node:assert/strict';
import { buildCatalog, buildActions, frontier, nodeLeverage, questLeverage, questDone, questKey, routeTo } from '../src/data/catalog.ts';
import { derive, recommend } from '../src/data/progression.ts';
import type { NodeEntry, QuestEntry, JunctionEntry } from '../src/data/vendor/types.ts';
import type { RawInventory } from '../src/core/gep.ts';

/*  Fixture star chart — a chain with a branch:
 *
 *      A ──> B ──> C ──> D
 *            └───> E
 *      X (isolated entry point, no predecessors)
 */
const nodes: NodeEntry[] = [
  { id: 'A', name: 'Alpha', planet: 'Earth', type: 'Capture', minLevel: 1, maxLevel: 3, next: ['B'], prev: [] },
  { id: 'B', name: 'Bravo', planet: 'Earth', type: 'Defense', minLevel: 3, maxLevel: 6, next: ['C', 'E'], prev: ['A'] },
  { id: 'C', name: 'Charlie', planet: 'Venus', type: 'Rescue', minLevel: 6, maxLevel: 9, next: ['D'], prev: ['B'] },
  { id: 'D', name: 'Delta', planet: 'Venus', type: 'Survival', minLevel: 9, maxLevel: 12, next: [], prev: ['C'] },
  { id: 'E', name: 'Echo', planet: 'Venus', type: 'Spy', minLevel: 6, maxLevel: 9, next: [], prev: ['B'] },
  { id: 'X', name: 'Xray', planet: 'Earth', type: 'Exterminate', minLevel: 1, maxLevel: 3, next: [], prev: [] },

  /*  The real data's planet entry points are asymmetric: a gateway declares
   *  `next` into a planet, but the entered node's `prev` names an intra-planet
   *  node instead of the gateway. Reproduced here because reading `prev` alone
   *  stranded 132 real nodes.
   *
   *      GATE ──next──> P1 ──> P2        (P1.prev = [] — it does NOT name GATE)
   */
  { id: 'GATE', name: 'Gateway', planet: 'Earth', type: 'Assault', minLevel: 1, maxLevel: 3, next: ['P1'], prev: ['A'] },
  { id: 'P1', name: 'Pluto one', planet: 'Pluto', type: 'Capture', minLevel: 30, maxLevel: 35, next: ['P2'], prev: [] },
  { id: 'P2', name: 'Pluto two', planet: 'Pluto', type: 'Defense', minLevel: 32, maxLevel: 37, next: [], prev: ['P1'] },
];

/*  Fixture quests: Q1 gates Q2, which gates Q3. Q4 is untrackable (no id). */
const quests: QuestEntry[] = [
  { id: '/Lotus/Types/Keys/Q1', name: 'First Steps', order: 1, requires: [], planet: 'Earth', mainline: true },
  { id: '/Lotus/Types/Keys/Q2', name: 'Second Wind', order: 2, requires: ['/Lotus/Types/Keys/Q1'], mainline: true },
  { id: '/Lotus/Types/Keys/Q3', name: 'Third Rail', order: 3, requires: ['Second Wind'], mainline: true }, // by NAME
  { id: null, name: 'Mystery Quest', order: 4, requires: [] },
  // A side quest with a gate nothing in the account data can confirm.
  { id: '/Lotus/Types/Keys/Q5', name: 'Side Errand', order: 5, requires: [], requiresNote: 'Mastery Rank 5' },
  // A later mainline entry, to prove the spine is followed in order.
  { id: '/Lotus/Types/Keys/Q6', name: 'Far Future', order: 20, requires: [], mainline: true },
];

const junctions: JunctionEntry[] = [
  {
    // Reachable: Earth has cleared nodes, and its quest task (Q1) is done.
    id: 'EarthToVenusJunction',
    name: 'Venus Junction',
    from: 'Earth',
    to: 'Venus',
    unlocksPlanet: 'Venus',
    tasks: [
      { text: 'Complete First Steps', kind: 'quest', ref: 'First Steps' },
      { text: 'Kill the Jackal', kind: 'mission', ref: 'Fossa' },
    ],
  },
  {
    // Unreachable: nothing on Venus is cleared yet.
    id: 'VenusToMarsJunction',
    name: 'Mars Junction',
    from: 'Venus',
    to: 'Mars',
    unlocksPlanet: 'Mars',
    tasks: [{ text: 'Do a thing', kind: 'other', ref: null }],
  },
  {
    // Reachable, but gated behind a quest the account has not finished.
    id: 'EarthToLuaJunction',
    name: 'Lua Junction',
    from: 'Earth',
    to: 'Lua',
    unlocksPlanet: 'Lua',
    tasks: [{ text: 'Complete Second Wind', kind: 'quest', ref: 'Second Wind' }],
  },
];

const catalog = buildCatalog(nodes, quests, junctions);

/** An account that has cleared A and B, and finished Q1. */
const inv: RawInventory = {
  PlayerLevel: 5,
  Missions: [
    { Tag: 'A', Completes: 3 },
    { Tag: 'B', Completes: 1 },
  ],
  QuestKeys: [{ ItemType: '/Lotus/Types/Keys/Q1', Completed: true }],
};
const picture = derive(inv);

function frontierIsExact() {
  const ids = frontier(catalog, picture).map((n) => n.id).sort();
  // C and E are reachable (B cleared). X has no prereqs so it's always available.
  // GATE is reachable because A is cleared. A and B are done, D is behind C, and
  // P1/P2 sit behind GATE.
  assert.deepEqual(ids, ['C', 'E', 'GATE', 'X'], 'frontier must be exactly the reachable-and-uncleared set');
}

function asymmetricEntryPointsAreReachable() {
  // P1's `prev` is empty and never names GATE - only GATE's `next` links them.
  // Before the merged index, this made P1 a false root: offered immediately on a
  // fresh account, and the whole planet behind it mis-ranked.
  const fresh = derive({});
  const freshIds = frontier(catalog, fresh).map((n) => n.id);
  assert.ok(!freshIds.includes('P1'), 'a node behind a one-directional gate must not look like a starting point');

  // Clearing GATE opens it, via the `next` edge alone.
  const opened = derive({ Missions: [{ Tag: 'A', Completes: 1 }, { Tag: 'GATE', Completes: 1 }] });
  const openedIds = frontier(catalog, opened).map((n) => n.id);
  assert.ok(openedIds.includes('P1'), 'clearing the gate must open the planet behind it');
  assert.ok(!openedIds.includes('P2'), 'but only the first node, not the whole planet');
}

function leverageCrossesAsymmetricEdges() {
  const fresh = derive({});
  // GATE opens P1 and P2, reached through the `next` relation.
  assert.equal(nodeLeverage('GATE', catalog, fresh), 2, 'leverage must follow one-directional gate edges');
}

function frontierExcludesLocked() {
  const ids = frontier(catalog, picture).map((n) => n.id);
  assert.ok(!ids.includes('D'), 'a node behind an uncleared node must not be offered');
}

function frontierExcludesCleared() {
  const ids = frontier(catalog, picture).map((n) => n.id);
  assert.ok(!ids.includes('A') && !ids.includes('B'), 'cleared nodes must never reappear');
}

function nodeLeverageCountsDownstream() {
  // From C: D is downstream and uncleared.
  assert.equal(nodeLeverage('C', catalog, picture), 1);
  // From B: C, D, E are downstream, all uncleared.
  assert.equal(nodeLeverage('B', catalog, picture), 3);
  // E is a leaf.
  assert.equal(nodeLeverage('E', catalog, picture), 0);
}

function leverageIgnoresClearedWork() {
  // With C already cleared, B's leverage drops - clearing a path to content you
  // have finished is not leverage.
  const done = derive({ ...inv, Missions: [...(inv.Missions ?? []), { Tag: 'C', Completes: 1 }] });
  assert.equal(nodeLeverage('B', catalog, done), 2, 'already-cleared downstream nodes must not count');
}

function questChainIsTransitive() {
  // Q1 gates Q2 which gates Q3 (declared by name, so name resolution must work).
  assert.equal(questLeverage(questKey(quests[0]!), catalog, picture), 2);
  assert.equal(questLeverage(questKey(quests[1]!), catalog, picture), 1);
  assert.equal(questLeverage(questKey(quests[2]!), catalog, picture), 0);
}

function questCompletionDetection() {
  assert.equal(questDone(quests[0]!, picture), true, 'a completed quest must read as done');
  assert.equal(questDone(quests[1]!, picture), false);
  assert.equal(questDone(quests[3]!, picture), null, 'an id-less quest is unverifiable, not unfinished');
}

function questTailFallback() {
  // GEP sometimes reports a different key path; the final segment still matches.
  const odd = derive({ QuestKeys: [{ ItemType: '/Lotus/Types/Keys/Chains/Q1', Completed: true }] });
  assert.equal(questDone(quests[0]!, odd), true, 'completion must survive a differing key path');
}

function untrackableIsNeverRecommended() {
  const titles = buildActions(catalog, picture).map((a) => a.title);
  assert.ok(
    !titles.includes('Mystery Quest'),
    'a quest whose completion cannot be verified must never be recommended - the risk of repeating it is the whole thing we are avoiding',
  );
  assert.deepEqual(catalog.untrackableQuests, ['Mystery Quest'], 'but it must be reported as untrackable');
}

function actionsExcludeFinishedWork() {
  const ids = buildActions(catalog, picture).map((a) => a.id);
  assert.ok(!ids.includes('/Lotus/Types/Keys/Q1'), 'a finished quest must not be an action');
  assert.ok(!ids.includes('A') && !ids.includes('B'), 'cleared nodes must not be actions');
}

function rankingPrefersLeverage() {
  const ranked = recommend(buildActions(catalog, picture), picture, 10);
  assert.ok(ranked.length > 0, 'there must be something to do');

  // Q2 is unblocked (Q1 done) and gates Q3, so it should lead.
  assert.equal(ranked[0]?.title, 'Second Wind', 'the unblocked quest with downstream leverage must rank first');

  // Q3 is still blocked behind Q2 and must be withheld entirely.
  assert.ok(!ranked.some((a) => a.title === 'Third Rail'), 'a quest behind an unfinished prerequisite must be withheld');

  // Among nodes, C (opens D) must outrank E (a leaf).
  const nodeRanks = ranked.filter((a) => a.kind === 'node').map((a) => a.title);
  const ci = nodeRanks.indexOf('Charlie');
  const ei = nodeRanks.indexOf('Echo');
  if (ci !== -1 && ei !== -1) assert.ok(ci < ei, 'a node that opens more must rank above a dead end');
}

function mainlineIsFollowedInOrder() {
  const fresh = derive({});
  const ranked = recommend(buildActions(catalog, fresh), fresh, 20);
  const quests = ranked.filter((a) => a.kind === 'quest').map((a) => a.title);

  // First Steps (order 1) must precede Far Future (order 20), even though both
  // are unblocked and Far Future has the same leverage.
  const first = quests.indexOf('First Steps');
  const far = quests.indexOf('Far Future');
  assert.ok(first !== -1 && far !== -1, 'both mainline quests should be offered');
  assert.ok(first < far, 'the mainline must be followed in order, earliest first');
}

function unverifiableGatesAreDemoted() {
  const fresh = derive({});
  const ranked = recommend(buildActions(catalog, fresh), fresh, 20);
  const titles = ranked.map((a) => a.title);
  const side = titles.indexOf('Side Errand');
  const main = titles.indexOf('First Steps');
  assert.ok(main !== -1, 'the mainline start must be offered');
  // A quest whose gate we cannot check must not outrank one we know is available.
  assert.ok(side === -1 || main < side, 'a quest with an unverifiable gate must rank below verified work');
}

function routeReachesTheTarget() {
  // A and B are cleared; D sits two steps past the frontier via C.
  const r = routeTo(catalog, picture, 'D');
  assert.deepEqual(r, ['B', 'C', 'D'], 'the route must start from cleared territory and end at the target');
}

function routeCrossesOneDirectionalGates() {
  // P2 is only reachable through GATE's `next` edge; a prev-only walk fails here.
  const opened = derive({ Missions: [{ Tag: 'A', Completes: 1 }] });
  const r = routeTo(catalog, opened, 'P2');
  assert.deepEqual(r, ['A', 'GATE', 'P1', 'P2'], 'the route must traverse one-directional gateway edges');
}

function routeFromAFreshAccount() {
  // Nothing cleared: the route starts from an entry point rather than failing.
  const blank = derive({});
  const r = routeTo(catalog, blank, 'D');
  assert.ok(r.length > 0, 'a fresh account must still get a route');
  assert.equal(r[r.length - 1], 'D');
  assert.equal(r[0], 'A', 'and it must begin at an entry point');
}

function routeToClearedIsTrivial() {
  assert.deepEqual(routeTo(catalog, picture, 'A'), ['A'], 'an already-cleared target needs no journey');
}

function routeToNowhereIsEmpty() {
  assert.deepEqual(routeTo(catalog, picture, 'NOPE'), [], 'an unknown node yields no route');
}

function freshAccountGetsAStart() {
  // Nothing done at all: the entry points must still be offered.
  const blank = derive({});
  const ids = frontier(catalog, blank).map((n) => n.id).sort();
  assert.deepEqual(ids, ['A', 'X'], 'a brand-new account must be offered the entry points');
}

function junctionNeedsAReachableOrigin() {
  const ids = buildActions(catalog, picture).map((a) => a.id);
  assert.ok(
    ids.includes('EarthToVenusJunction'),
    'a junction whose origin planet has cleared nodes must be offered',
  );
  assert.ok(
    !ids.includes('VenusToMarsJunction'),
    'a junction on a planet the player has not reached must never be offered - this is the "go do the Sedna Junction" failure',
  );
}

function junctionQuestTasksBecomePrerequisites() {
  const actions = buildActions(catalog, picture);
  const lua = actions.find((a) => a.id === 'EarthToLuaJunction');
  assert.ok(lua, 'the junction should be generated');
  assert.deepEqual(lua.requires, ['/Lotus/Types/Keys/Q2'], 'a quest task must become a real prerequisite');

  // ...and the shared ranking filter must then withhold it.
  const ranked = recommend(actions, picture, 20).map((a) => a.id);
  assert.ok(!ranked.includes('EarthToLuaJunction'), 'a junction gated by an unfinished quest must be withheld');

  // Finishing that quest releases it.
  const after = derive({
    Missions: inv.Missions,
    QuestKeys: [
      { ItemType: '/Lotus/Types/Keys/Q1', Completed: true },
      { ItemType: '/Lotus/Types/Keys/Q2', Completed: true },
    ],
  });
  const afterIds = recommend(buildActions(catalog, after), after, 20).map((a) => a.id);
  assert.ok(afterIds.includes('EarthToLuaJunction'), 'completing the gating quest must release the junction');
}

function clearedJunctionNeverReturns() {
  const done = derive({
    ...inv,
    Missions: [...(inv.Missions ?? []), { Tag: 'EarthToVenusJunction', Completes: 1 }],
  });
  const ids = buildActions(catalog, done).map((a) => a.id);
  assert.ok(!ids.includes('EarthToVenusJunction'), 'a completed junction must never be recommended again');
}

const checks = [
  frontierIsExact,
  asymmetricEntryPointsAreReachable,
  leverageCrossesAsymmetricEdges,
  frontierExcludesLocked,
  frontierExcludesCleared,
  nodeLeverageCountsDownstream,
  leverageIgnoresClearedWork,
  questChainIsTransitive,
  questCompletionDetection,
  questTailFallback,
  untrackableIsNeverRecommended,
  actionsExcludeFinishedWork,
  rankingPrefersLeverage,
  freshAccountGetsAStart,
  routeReachesTheTarget,
  routeCrossesOneDirectionalGates,
  routeFromAFreshAccount,
  routeToClearedIsTrivial,
  routeToNowhereIsEmpty,
  mainlineIsFollowedInOrder,
  unverifiableGatesAreDemoted,
  junctionNeedsAReachableOrigin,
  junctionQuestTasksBecomePrerequisites,
  clearedJunctionNeverReturns,
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
console.log(failed ? `\n${failed} check(s) failed` : '\nall completionism rules hold');
// Set the code rather than calling process.exit(): exiting immediately can
// race stdout flushing on Windows and print a libuv assertion after the report.
process.exitCode = failed ? 1 : 0;
