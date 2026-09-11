/**
 * Self-check for the mission history store.
 *
 * Node has no IndexedDB, so importing the module here lands it in exactly the
 * degraded path a private-mode browser produces — which makes this a real test
 * of the fallback rather than a mock of it. The IndexedDB path shares every
 * predicate, sort and roll-up with the memory path by construction (`walk` seeks
 * with an index, `pred` decides what matches), so what holds here holds there.
 *
 * Run: node scripts/check-history-store.ts
 */
import assert from 'node:assert/strict';
import type { MissionRecord } from '../src/data/missionlog.ts';
import { attributeLoot, toRecord, nodeIndex, hydrateRecord } from '../src/data/missionlog.ts';
import type { MissionRun } from '../src/core/eelog.ts';
import type { RawAccount } from '../src/data/account.ts';
import {
  appendMission,
  recentMissions,
  missionsInRange,
  missionsForNode,
  allTimeTotals,
  exportJson,
  importJson,
  clearHistory,
  historyCount,
  historyStatus,
} from '../src/data/history-store.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

/**
 * Records are built loosely and cast: missionlog owns MissionRecord's shape, and
 * this file tests the store's behaviour, not that shape. If a field name here
 * drifts the store still passes, which is the point of the structural reads.
 */
function run(over: Record<string, unknown>): MissionRecord {
  return {
    node: 'SolNode1',
    name: 'Test',
    planet: 'Earth',
    missionType: 'MT_EXTERMINATION',
    outcome: 'success',
    durationSeconds: 100,
    endedAt: T0,
    loot: {},
    ...over,
  } as unknown as MissionRecord;
}

async function seed(): Promise<void> {
  await clearHistory();
  await appendMission(run({ endedAt: T0, node: 'SolNode1', missionType: 'MT_EXTERMINATION' }));
  await appendMission(
    run({ endedAt: T0 + DAY, node: 'SolNode2', missionType: 'MT_SURVIVAL', outcome: 'failure', durationSeconds: 50 }),
  );
  await appendMission(run({ endedAt: T0 + 2 * DAY, node: 'SolNode1', missionType: 'MT_SURVIVAL' }));
  // A run whose node line never arrived. IndexedDB leaves it out of the node
  // index; the memory path must agree rather than matching everything.
  await appendMission(run({ endedAt: T0 + 3 * DAY, node: null }));
}

async function degradesInsteadOfThrowing() {
  await clearHistory();
  const stored = await appendMission(run({}));
  assert.ok(stored.id, 'every stored record gets an id');
  const s = historyStatus();
  assert.equal(s.durable, false, 'no IndexedDB must flip the durable flag, not throw');
  assert.equal(s.reason, 'indexeddb-unavailable');
  assert.equal(s.pending, 1, 'the session record must be visible as pending, never lost');
}

async function recentIsNewestFirstAndCapped() {
  await seed();
  const all = await recentMissions();
  assert.equal(all.length, 4);
  assert.deepEqual(
    all.map((m) => m.endedAt),
    [T0 + 3 * DAY, T0 + 2 * DAY, T0 + DAY, T0],
  );
  const two = await recentMissions(2);
  assert.equal(two.length, 2, 'the limit must apply after the merge, not before');
  assert.equal(two[0]?.endedAt, T0 + 3 * DAY);
  assert.equal(await historyCount(), 4);
}

async function rangeIsHalfOpen() {
  await seed();
  const rows = await missionsInRange(T0, T0 + 2 * DAY);
  assert.deepEqual(
    rows.map((m) => m.endedAt),
    [T0 + DAY, T0],
    'the upper bound is exclusive so adjacent ranges cannot double-count a run',
  );
  assert.equal((await missionsInRange(T0 + 9 * DAY, T0 + 10 * DAY)).length, 0);
}

async function nodeQuerySkipsUnknownNodes() {
  await seed();
  const rows = await missionsForNode('SolNode1');
  assert.equal(rows.length, 2);
  assert.ok(
    rows.every((m) => m.node === 'SolNode1'),
    'a run with a null node must not fall into another node’s history',
  );
  assert.equal(rows[0]?.endedAt, T0 + 2 * DAY, 'newest first');
}

async function totalsRollUpBothLootShapes() {
  await clearHistory();
  // The two shapes an inventory diff plausibly produces: a quantity map, and a
  // list of entries. The roll-up must handle whichever missionlog settles on.
  await appendMission(run({ endedAt: T0, loot: { Ferrite: 300, Nitain: 1 } }));
  await appendMission(
    run({
      endedAt: T0 + DAY,
      outcome: 'failure',
      durationSeconds: 50,
      node: 'SolNode2',
      loot: [{ itemType: 'Ferrite', count: 200 }, { itemType: 'Neurodes' }],
    }),
  );

  const t = await allTimeTotals();
  assert.equal(t.missions, 2);
  assert.equal(t.successes, 1, 'a failed run is not a success');
  assert.equal(t.durationSeconds, 150);
  assert.equal(t.firstAt, T0);
  assert.equal(t.lastAt, T0 + DAY);
  assert.equal(t.byNode['SolNode1'], 1);
  assert.equal(t.byMissionType['MT_EXTERMINATION'], 2);
  assert.equal(t.loot['Ferrite'], 500, 'quantities must sum across both loot shapes');
  assert.equal(t.loot['Nitain'], 1);
  assert.equal(t.loot['Neurodes'], 1, 'an entry with no count is one item');
}

/**
 * The store's other fixtures are loose on purpose, which is exactly how a field
 * rename in `missionlog` could go unnoticed here. This one feeds a record built
 * by the real producer, so the two modules cannot drift apart silently.
 */
async function rollsUpARealMissionRecord() {
  await clearHistory();
  const chart = nodeIndex([]);
  const base: MissionRun = {
    node: 'SolNode167',
    name: 'Oestrus',
    planet: 'Eris',
    missionType: 'MT_PURIFY',
    difficulty: 1,
    success: true,
    aborted: false,
    location: null,
    gameRules: null,
    squadSize: 1,
    isHost: true,
    extraction: null,
    durationSeconds: 120,
    loadSeconds: null,
    endedAtMs: T0,
    syndicateXp: null,
    squad: null,
  };
  const FERRITE = '/Lotus/Types/Items/MiscItems/Ferrite';
  const before: RawAccount = { MiscItems: [{ ItemType: FERRITE, ItemCount: 100 }] };
  const after: RawAccount = { MiscItems: [{ ItemType: FERRITE, ItemCount: 350 }] };

  await appendMission(attributeLoot(toRecord(base, chart), before, after));
  await appendMission(toRecord({ ...base, aborted: true, success: false, endedAtMs: T0 + DAY }, chart));

  const t = await allTimeTotals();
  assert.equal(t.missions, 2);
  assert.equal(t.successes, 1, 'MissionRecord reports `outcome`, not a `success` boolean');
  assert.equal(t.durationSeconds, 240, 'durationMs must be read as milliseconds');
  assert.equal(
    t.loot[FERRITE],
    250,
    'loot must roll up under the canonical itemType, not the display name — missionlog keys on itemType',
  );
  assert.equal(t.loot['Ferrite'], undefined, 'the display name must not become a second key for the same item');
  assert.equal(t.byNode['SolNode167'], 2);
}

async function exportRoundTripsAndDeduplicates() {
  await seed();
  const json = await exportJson();
  await clearHistory();
  assert.equal(await historyCount(), 0);

  const first = await importJson(json);
  assert.equal(first.error, null);
  assert.equal(first.imported, 4);
  assert.equal((await recentMissions())[0]?.endedAt, T0 + 3 * DAY, 'a restore must come back in order');

  // Ids survive the round trip precisely so a second import is a no-op rather
  // than a doubled history.
  const again = await importJson(json);
  assert.equal(again.imported, 0);
  assert.equal(again.skipped, 4);
  assert.equal(await historyCount(), 4);
}

async function importRejectsRubbish() {
  await clearHistory();
  assert.equal((await importJson('not json')).error, 'not valid JSON');
  assert.match((await importJson('{"missions":[]}')).error ?? '', /not a RaijiFrame/);

  /*
   * A well-formed envelope with junk rows: keep the good one, drop the rest.
   *
   * The good row now needs an OUTCOME as well as a timestamp. Both are written
   * unconditionally by every version of `toRecord` that has ever run, so a row
   * without one did not come from this app - and neither is repairable: a run
   * with no timestamp has no place on a timeline, and one with no outcome
   * cannot be counted as a success or a failure without inventing the answer.
   * Everything else absent is filled in rather than refused; see
   * `absentFieldsAreRepairedNotTrusted`.
   */
  const mixed = JSON.stringify({
    format: 'raijiframe-mission-history',
    version: 1,
    exportedAt: Date.now(),
    missions: [
      null,
      42,
      { node: 'SolNode1' },
      { endedAt: T0, node: 'SolNode1' },
      { endedAt: T0 + DAY, node: 'SolNode1', outcome: 'success' },
    ],
  });
  const res = await importJson(mixed);
  assert.equal(res.imported, 1, 'exactly the one placeable, decided row');
  assert.equal(await historyCount(), 1);
  /*
   * AND THE FOUR REFUSALS ARE REPORTED. They used to be filtered out before the
   * counters existed, so a file that was three-quarters rubbish came back
   * reading "1 imported, 0 skipped" - which says the file was whole.
   */
  assert.equal(res.skipped, 4, 'every refused row must appear in the count, or the import lies about itself');
}


/*
 * THE FIELD THAT IS NOT THERE.
 * ————————————————————————————
 * Every fixture above BUILDS a record, so every fixture has every key. Real
 * stored history does not: a run saved before a field existed comes back with
 * that key ABSENT, which is `undefined` and not `null`, and this is not a
 * theoretical shape - `syndicateXp` was added, two readers guarded it with
 * `=== null`, and loading a real history rendered a blank page while 501 checks,
 * the typecheck, the lint and the build all passed.
 *
 * So this check does the one thing no other fixture here can do: it DELETES
 * keys. Nothing below constructs a record; every case starts from a complete
 * one and removes something, which is exactly how the disk produces them.
 */
async function absentFieldsAreRepairedNotTrusted(): Promise<void> {
  const full = run({ endedAt: T0, node: 'SolNode1' }) as unknown as Record<string, unknown>;

  // The crash, reproduced at the boundary. `syndicateXp` was never in `run()`'s
  // literal, so this row is already missing it the way the disk is.
  const repaired = hydrateRecord(full);
  assert.ok(repaired, 'a complete-enough row must survive the repair');
  assert.ok('syndicateXp' in repaired, 'the key must EXIST, not merely read as null');
  assert.equal(repaired.syndicateXp, null, 'and it must be null, which is what unmeasured means');
  assert.equal(repaired.durationMs, null, 'an absent duration is unmeasured, never a zero');
  assert.equal(repaired.affinity, null);
  assert.equal(repaired.steelPath, null);

  /*
   * EVERY declared key present, checked against the interface rather than
   * against a list retyped here - a list would drift the moment a field is
   * added, which is the failure this whole function exists to prevent. The
   * reference is a record `toRecord` built, so the keys come from the source of
   * truth.
   */
  const reference = toRecord(
    { node: 'SolNode1', endedAtMs: T0, durationSeconds: 60 } as unknown as MissionRun,
    nodeIndex([]),
    T0,
  );
  for (const key of Object.keys(reference)) {
    assert.ok(key in repaired, `the repair dropped "${key}", so a reader of it still gets undefined`);
  }

  /*
   * A MEASURED ZERO IS NOT AN ABSENT FIELD, and the difference is the whole
   * discipline. `??` keeps them apart; `||` would flatten a 0-second run, a
   * solo squad of 0 and a client's `host: false` into "we never looked".
   */
  const zeros = hydrateRecord({ ...full, durationMs: 0, squadSize: 0, host: false, affinity: 0 });
  assert.ok(zeros);
  assert.equal(zeros.durationMs, 0, 'a zero duration was MEASURED as zero');
  assert.equal(zeros.squadSize, 0);
  assert.equal(zeros.host, false, 'false is a reading; null is the absence of one');
  assert.equal(zeros.affinity, 0);

  // Unknown loot must never read as an empty haul that was confirmed empty.
  const noLoot = hydrateRecord({ ...full, loot: undefined, lootAttributed: true });
  assert.ok(noLoot);
  assert.deepEqual(noLoot.loot, []);
  assert.equal(noLoot.lootAttributed, false, 'a lost loot array is unknown loot, not an attributed empty one');

  // Two fields the interface gives no absent state, so a row without them is
  // corrupt rather than old, and belongs nowhere near a rate or a timeline.
  assert.equal(hydrateRecord({ ...full, endedAt: undefined }), null, 'no timestamp, no place on a timeline');
  assert.equal(hydrateRecord({ ...full, outcome: undefined }), null, 'no outcome is not a success');
  assert.equal(hydrateRecord({ ...full, outcome: 'went well' }), null, 'and neither is a word off the union');
  assert.equal(hydrateRecord(null), null);
  assert.equal(hydrateRecord('a mission, honest'), null);

  /*
   * AND THE SAME REPAIR ON THE PATH A USER CAN REACH. `importJson` takes a file
   * the user picked; it used to check two keys and spread the rest, so a
   * hand-trimmed export entered the database as a record the program believed
   * was complete. Import one that is missing nearly everything and read it back
   * out through the ordinary query.
   */
  await clearHistory();
  const thin = { id: 'thin-1', endedAt: T0, outcome: 'success' };
  const res = await importJson(
    JSON.stringify({ format: 'raijiframe-mission-history', version: 1, exportedAt: T0, missions: [thin] }),
  );
  assert.equal(res.error, null);
  assert.equal(res.imported, 1, 'a sparse but placeable row is worth keeping');

  const [back] = await recentMissions(10);
  assert.ok(back, 'the imported row must come back');
  for (const key of Object.keys(reference)) {
    assert.ok(key in back, `"${key}" reached a consumer as an absent key, which is the crash`);
  }
  assert.equal(back.durationMs, null);
  assert.equal(back.node, null, 'and an absent node is unknown, not the empty string');
}

const checks = [
  degradesInsteadOfThrowing,
  recentIsNewestFirstAndCapped,
  rangeIsHalfOpen,
  nodeQuerySkipsUnknownNodes,
  totalsRollUpBothLootShapes,
  rollsUpARealMissionRecord,
  exportRoundTripsAndDeduplicates,
  importRejectsRubbish,
  absentFieldsAreRepairedNotTrusted,
];

let failed = 0;
for (const c of checks) {
  try {
    await c();
    console.log(`  ok    ${c.name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${c.name}\n        ${(err as Error).message}`);
  }
}
await clearHistory();
console.log(failed ? `\n${failed} check(s) failed` : '\nall mission history store rules hold');
// Set the code rather than calling process.exit(): exiting immediately can race
// stdout flushing on Windows and print a libuv assertion after the report.
process.exitCode = failed ? 1 : 0;
