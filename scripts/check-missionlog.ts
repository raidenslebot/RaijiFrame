/**
 * Self-check for the mission history recorder and the inventory diff.
 *
 * The log lines are the real shapes from a live capture; the inventories are
 * hand-built minimal `RawAccount`s, because the point of every assertion here is
 * arithmetic on a delta, not schema coverage.
 *
 * The assertions that matter most are the ones about what must NOT be counted:
 * a snapshot taken before the engine flushed the run's items, a loss reported as
 * loot, and an unattributed run sitting in a drop-rate denominator.
 *
 * Run: node scripts/check-missionlog.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MissionTracker, parseLine } from '../src/core/eelog.ts';
import type { LogEvent, MissionRun } from '../src/core/eelog.ts';
import type { RawAccount } from '../src/data/account.ts';
import type { NodeEntry } from '../src/data/vendor/types.ts';
import {
  CREDITS,
  ENDO,
  MissionRecorder,
  attributeLoot,
  affinityGained,
  bestNodesFor,
  byPlanet,
  diffInventory,
  dropRates,
  overall,
  toRecord,
  nodeIndex,
  type MissionRecord,
} from '../src/data/missionlog.ts';

const FERRITE = '/Lotus/Types/Items/MiscItems/Ferrite';
const CELL = '/Lotus/Types/Items/MiscItems/OrokinCell';
const SERRATION = '/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod';
const BRATON = '/Lotus/Weapons/Tenno/Rifle/Braton';
const BOLTOR = '/Lotus/Weapons/Tenno/Rifle/Boltor';

const NODES: NodeEntry[] = [
  {
    id: 'SolNode167',
    name: 'Oestrus',
    planet: 'Eris',
    type: 'Infested Salvage',
    enemy: 'Infested',
    minLevel: 30,
    maxLevel: 40,
    next: [],
    prev: [],
  },
];

const BEFORE: RawAccount = {
  RegularCredits: 1000,
  PremiumCredits: 20,
  FusionPoints: 500,
  MiscItems: [{ ItemType: FERRITE, ItemCount: 100 }],
  Recipes: [{ ItemType: '/Lotus/Types/Recipes/Weapons/BratonBlueprint', ItemCount: 1 }],
  RawUpgrades: [{ ItemType: SERRATION, ItemCount: 2 }],
  Suits: [{ ItemId: { $oid: 'suit1' }, ItemType: '/Lotus/Powersuits/Excalibur/Excalibur', XP: 100 }],
  LongGuns: [{ ItemId: { $oid: 'gun1' }, ItemType: BRATON, XP: 0 }],
};

const AFTER: RawAccount = {
  RegularCredits: 4200,
  PremiumCredits: 20,
  FusionPoints: 500,
  // Deliberately split across two rows: DE has been seen to fragment a stack.
  MiscItems: [
    { ItemType: FERRITE, ItemCount: 300 },
    { ItemType: FERRITE, ItemCount: 50 },
    { ItemType: CELL, ItemCount: 2 },
  ],
  Recipes: [{ ItemType: '/Lotus/Types/Recipes/Weapons/BratonBlueprint', ItemCount: 1 }],
  RawUpgrades: [{ ItemType: SERRATION, ItemCount: 3 }],
  Suits: [{ ItemId: { $oid: 'suit1' }, ItemType: '/Lotus/Powersuits/Excalibur/Excalibur', XP: 5100 }],
  LongGuns: [
    { ItemId: { $oid: 'gun1' }, ItemType: BRATON, XP: 3000 },
    { ItemId: { $oid: 'gun2' }, ItemType: BOLTOR, XP: 2000 },
  ],
};

function diffFindsEveryCategory() {
  const loot = diffInventory(BEFORE, AFTER);
  const got = Object.fromEntries(loot.map((l) => [l.itemType, l.count]));
  assert.equal(got[FERRITE], 250, 'split stacks must be summed, not read as the first row');
  assert.equal(got[CELL], 2, 'an item absent from `before` is a full gain');
  assert.equal(got[SERRATION], 1, 'stacked rank-0 mods diff by count');
  assert.equal(got[BOLTOR], 1, 'a new arsenal instance is loot');
  assert.equal(got[CREDITS], 3200);
  assert.equal(got[ENDO], undefined, 'an unchanged currency is not loot');
  assert.equal(got['/Lotus/Types/Recipes/Weapons/BratonBlueprint'], undefined, 'unchanged blueprints are not loot');

  const cell = loot.find((l) => l.itemType === CELL);
  assert.equal(cell?.name, 'Orokin Cell', 'names come from the path, camelCase split');
  assert.equal(cell?.category, 'resource');
}

function diffNeverReportsLosses() {
  // Spent 40 Ferrite and sold the Braton. Neither is loot; neither may appear.
  const spent: RawAccount = {
    ...BEFORE,
    MiscItems: [{ ItemType: FERRITE, ItemCount: 60 }],
    LongGuns: [],
  };
  const loot = diffInventory(BEFORE, spent);
  assert.deepEqual(loot, [], 'a run that only consumed things has no loot');
}

function diffSkipsCategoriesMissingFromBefore() {
  // A truncated GEP dump with no RawUpgrades at all must not report the player's
  // entire mod collection as this run's drop.
  const truncated: RawAccount = { ...BEFORE, RawUpgrades: undefined };
  const loot = diffInventory(truncated, AFTER);
  assert.equal(
    loot.some((l) => l.category === 'mod'),
    false,
    'an absent category is unknown, not zero',
  );
  assert.equal(
    loot.some((l) => l.itemType === FERRITE),
    true,
    'the other categories must still diff normally',
  );
}

function affinityIsPerInstance() {
  // 5000 on the frame, 3000 on the owned rifle, 2000 on the one earned mid-run.
  assert.equal(affinityGained(BEFORE, AFTER), 10_000);
  assert.equal(affinityGained(null, AFTER), null, 'a missing snapshot is unknown affinity, not zero');
}

/** A full mission, in the order and at the timestamps a live log emits it. */
const LOADING = [
  '53.899 Sys [Info]: Server ready for load [Heap: 1/2 Footprint: 3 Handles: 4], sessionPlayers=3',
  '53.903 Script [Info]: ThemedSquadOverlay.lua: Mission name: Oestrus (Eris)',
  '53.905 Script [Info]: ThemedSquadOverlay.lua: Host loading {"difficulty":1,"name":"SolNode167"} with MissionInfo: ',
  '56.109 Sys [Info]: Wall time: 2.2s (time waiting to start: 0.77s)',
  '56.238 Sys [Info]: Loading game rules: LotusInfestedSalvageGameRules',
  '56.374 Net [Info]: GameRulesImpl::StartedSessionHostCallback: success: 1',
  '56.910 Net [Info]: GameRulesImpl - changing state from SS_WAITING_FOR_PLAYERS to SS_STARTED',
  '56.911 Game [Info]: OnStateStarted, mission type=MT_PURIFY',
];

/** End of match. The run is only assembled at teardown, five lines later. */
const ENDING = [
  '164.957 Script [Info]: EndOfMatch.lua: Mission Succeeded',
  '164.960 Script [Info]: EndOfMatch.lua: SomePlayer - IsInTrigger=true',
  '164.961 Sys [Info]: SyndicateXP base for mission: 289',
  '164.961 Sys [Info]: SyndicateXP post checkpoint amount: 289',
  '164.961 Game [Info]: CommitInventoryChangesToDB',
  '165.201 Script [Info]: EndOfMatch.lua: DbUpdateComplete',
  '167.504 Net [Info]: GameRulesImpl - changing state from SS_STARTED to SS_ENDING',
];

const SESSION = [...LOADING, ...ENDING];

/**
 * Drives a recorder on a fake clock anchored so that t=53.899 s is `t0`.
 *
 * `line` reproduces `tailEeLog`'s wiring exactly — onEvent, then the tracker,
 * then onRun — because the order of those three is load-bearing.
 */
function session(t0 = 1_000_000) {
  let clock = t0;
  const rec = new MissionRecorder(NODES, () => clock);
  const tracker = new MissionTracker(() => clock);
  return {
    rec,
    at: (t: number) => {
      clock = t0 + Math.round((t - 53.899) * 1000);
      return clock;
    },
    line: (l: string): MissionRecord | null => {
      const e = parseLine(l)!;
      const stale = rec.observeEvent(e);
      const run = tracker.push(e);
      return (run ? rec.observeRun(run) : null) ?? stale;
    },
  };
}

/** Play `lines`, advancing the fake clock to each line's own timestamp. */
function play(s: ReturnType<typeof session>, lines: readonly string[]): MissionRecord | null {
  let out: MissionRecord | null = null;
  for (const l of lines) {
    s.at(Number(l.split(' ')[0]));
    out = s.line(l) ?? out;
  }
  return out;
}

function recordsAFullMission() {
  const s = session();
  s.rec.observeInventory(BEFORE, s.at(50));

  const out = play(s, SESSION);
  assert.equal(out, null, 'nothing may close before the post-mission snapshot arrives');

  const done = s.rec.observeInventory(AFTER, s.at(168));
  assert.ok(done, 'the snapshot after DbUpdateComplete closes the record');

  assert.equal(done.node, 'SolNode167');
  assert.equal(done.name, 'Oestrus');
  assert.equal(done.planet, 'Eris');
  assert.equal(done.missionType, 'MT_PURIFY');
  assert.equal(done.outcome, 'success');
  assert.equal(done.host, true);
  assert.equal(done.squadSize, 3);
  assert.equal(done.partial, false);
  // Joined to the vendored star chart, which is the only source for these.
  assert.equal(done.faction, 'Infested');
  assert.equal(done.minLevel, 30);
  assert.equal(done.maxLevel, 40);
  assert.equal(done.missionTypeName, 'Infested Salvage');
  // SS_STARTED at 56.910 to the outcome at 164.957.
  assert.equal(done.durationMs, 108_047);
  assert.equal(done.endedAt! - done.startedAt!, 108_047);
  assert.equal(done.loadSeconds, 2.2);
  assert.equal(done.syndicateXp?.afterCheckpoint, 289);

  assert.equal(done.lootAttributed, true);
  assert.equal(done.affinity, 10_000);
  assert.equal(done.loot.find((l) => l.itemType === FERRITE)?.count, 250);
}

function ignoresASnapshotTakenBeforeTheWriteLands() {
  // GEP pushes on its own schedule. A dump landing in the 240 ms between the
  // outcome and DbUpdateComplete is pre-loot and would report an empty run.
  const s = session();
  s.rec.observeInventory(BEFORE, s.at(50));
  play(s, LOADING);
  play(s, ENDING.slice(0, 5)); // up to CommitInventoryChangesToDB, write in flight

  const early = s.rec.observeInventory(BEFORE, s.at(165.0));
  assert.equal(early, null, 'a snapshot inside the in-flight window must not close the record');

  play(s, ENDING.slice(5));
  const done = s.rec.observeInventory(AFTER, s.at(168));
  assert.equal(done?.loot.length, 5, 'the real post-write snapshot still attributes normally');
}

function abandonedRunClosesWithoutLoot() {
  // There is no "mission aborted" line anywhere in the log. Leaving SS_STARTED
  // with no end-of-match screen is the only signal there is.
  const s = session();
  s.rec.observeInventory(BEFORE, s.at(50));
  play(s, LOADING);
  s.at(120);
  s.line('120.000 Net [Info]: GameRulesImpl - changing state from SS_STARTED to SS_ENDING');

  assert.equal(s.rec.pending?.outcome, 'abandoned');
  const out = s.rec.flush();
  assert.equal(out?.lootAttributed, false, 'no post-mission snapshot means loot is unknown, not empty');
  assert.equal(out?.node, 'SolNode167', 'an abandoned run still knows where it was');
}

function secondMissionDoesNotStealTheFirstsLoot() {
  const s = session();
  s.rec.observeInventory(BEFORE, s.at(50));
  play(s, SESSION);

  // No snapshot arrives, and well inside the grace window the player launches
  // another run - so it is the next mission, not the timeout, that closes the
  // first. It closes at that mission's START rather than its end: that is the
  // last instant at which the newest snapshot is unambiguously the first run's,
  // and every moment after it the player is somewhere earning loot of their own.
  s.at(170);
  s.line(
    '170.000 Script [Info]: ThemedSquadOverlay.lua: Host loading {"difficulty":1,"name":"SolNode109"} with MissionInfo: ',
  );
  s.at(171);
  const flushed = s.line('171.000 Net [Info]: GameRulesImpl - changing state from SS_WAITING_FOR_PLAYERS to SS_STARTED');

  assert.equal(flushed?.node, 'SolNode167', 'the stale record closes when the next mission starts');
  assert.equal(flushed?.lootAttributed, false, 'and it closes unattributed rather than borrowing a later window');
  assert.equal(s.rec.pending?.node, undefined, 'the first run is still waiting after the next one began');

  s.at(180);
  s.line('180.000 Script [Info]: EndOfMatch.lua: Mission Succeeded');
  s.at(182);
  assert.equal(
    s.line('182.000 Net [Info]: GameRulesImpl - changing state from SS_STARTED to SS_ENDING'),
    null,
    'the first run was closed a second time when the second one ended',
  );
  assert.equal(s.rec.pending?.node, 'SolNode109', 'the second run is now the one waiting');

  // The second run's own snapshot must be diffed against ITS start, not the first's.
  const second = s.rec.observeInventory(AFTER, s.at(185));
  assert.equal(second?.node, 'SolNode109');
  assert.equal(second?.lootAttributed, true);
  assert.equal(second?.loot.find((l) => l.itemType === FERRITE)?.count, 250);
}

function joinedMidStreamIsMarkedPartial() {
  // The app started while a mission was already running: no SS_STARTED, so no
  // start time and no `before` snapshot.
  const s = session();
  s.at(164.957);
  const out = s.line('164.957 Script [Info]: EndOfMatch.lua: Mission Succeeded');
  assert.equal(out?.partial, true);
  assert.equal(out?.startedAt, null);
  assert.equal(out?.durationMs, null);
  assert.equal(out?.lootAttributed, false, 'with no `before` there is nothing to diff against');
}

function staleRecordsAreNotHeldForever() {
  const s = session();
  s.rec.observeInventory(BEFORE, s.at(50));
  play(s, SESSION);
  // 45 s later GEP still has not pushed. The record must close, not leak.
  s.at(210);
  const out = s.line('210.000 Sys [Info]: Loading game rules: AlternateLotusFrontEndGameRules');
  assert.equal(out?.node, 'SolNode167');
  assert.equal(out?.lootAttributed, false);
  assert.equal(s.rec.pending, null);
}

// --- aggregations ----------------------------------------------------------

const CHART = nodeIndex(NODES);

function run(node: string, seconds: number, endedAtMs: number): MissionRun {
  return {
    node,
    name: node === 'SolNode167' ? 'Oestrus' : 'Linea',
    planet: node === 'SolNode167' ? 'Eris' : 'Venus',
    missionType: 'MT_PURIFY',
    difficulty: 1,
    success: true,
    aborted: false,
    location: null,
    gameRules: null,
    squadSize: 1,
    isHost: true,
    extraction: null,
    durationSeconds: seconds,
    loadSeconds: null,
    endedAtMs,
    syndicateXp: null,
    squad: null,
  };
}

/** `n` copies of a run at `node`, the first `hits` of which dropped an Orokin Cell. */
function history(node: string, n: number, hits: number, seconds: number): MissionRecord[] {
  const out: MissionRecord[] = [];
  for (let i = 0; i < n; i++) {
    const after: RawAccount =
      i < hits
        ? { ...BEFORE, RegularCredits: 6000, MiscItems: [{ ItemType: FERRITE, ItemCount: 100 }, { ItemType: CELL, ItemCount: 1 }] }
        : { ...BEFORE, RegularCredits: 6000 };
    out.push(attributeLoot(toRecord(run(node, seconds, 2_000_000 + i * 600_000), CHART), BEFORE, after));
  }
  return out;
}

function dropRatesUseAttributedRunsOnly() {
  const records = [...history('SolNode167', 4, 1, 120)];
  // One more run at the same node whose snapshot never arrived. Its loot is
  // unknown; counting it as a miss would report 1/5 instead of the true 1/4.
  records.push(toRecord(run('SolNode167', 120, 3_000_000), CHART));

  const rates = dropRates(records, 'SolNode167');
  const cell = rates.find((r) => r.itemType === CELL);
  assert.equal(cell?.rate, 0.25, 'the unattributed run must not sit in the denominator');
  assert.equal(cell?.runs, 1);
  assert.equal(cell?.perRun, 0.25);
}

function bestNodeIsRankedByYieldPerHour() {
  // Same 50% drop rate on both nodes, but one takes half as long per run.
  const slow = history('SolNode167', 4, 2, 600);
  const fast = history('SolNode109', 4, 2, 300);
  const spots = bestNodesFor([...slow, ...fast], CELL);
  assert.equal(spots.length, 2);
  assert.equal(spots[0]?.node, 'SolNode109', 'the faster node wins at equal drop rate');
  assert.equal(spots[0]?.rate, 0.5);
  // 2 cells over 4 runs of 300 s = 1200 s = 6 per hour.
  assert.equal(spots[0]?.perHour, 6);
  assert.equal(spots[1]?.perHour, 3);

  assert.deepEqual(bestNodesFor(slow, CELL, 5), [], 'the minRuns floor keeps flukes out of the table');
}

function totalsAndRates() {
  const records = history('SolNode167', 4, 2, 900);
  const all = overall(records);
  assert.equal(all.runs, 4);
  assert.equal(all.successes, 4);
  assert.equal(all.attributed, 4);
  assert.equal(all.credits, 4 * 5000);
  // 4 runs x 900 s = 1 hour exactly.
  assert.equal(all.creditsPerHour, 20_000);

  const planets = byPlanet(records);
  assert.equal(planets[0]?.key, 'Eris');
  assert.equal(planets[0]?.loot.find((l) => l.itemType === CELL)?.runs, 2, '`runs` counts runs, not stacks');
}

const checks = [
  diffFindsEveryCategory,
  diffNeverReportsLosses,
  diffSkipsCategoriesMissingFromBefore,
  affinityIsPerInstance,
  recordsAFullMission,
  ignoresASnapshotTakenBeforeTheWriteLands,
  abandonedRunClosesWithoutLoot,
  secondMissionDoesNotStealTheFirstsLoot,
  joinedMidStreamIsMarkedPartial,
  staleRecordsAreNotHeldForever,
  dropRatesUseAttributedRunsOnly,
  bestNodeIsRankedByYieldPerHour,
  totalsAndRates,
  theRecorderIsActuallyWired,
  aMissionStartClosesTheRunBeforeIt,
];

function theRecorderIsActuallyWired() {
  /*
   * This engine and `history-store` are 1,272 tested lines that, for their whole
   * life, nothing in the app imported. Every check in this file passed the
   * entire time, because they exercise the engine in isolation - so the suite
   * proved the recorder worked while the app was throwing every mission away at
   * the one moment the data existed.
   *
   * A unit test cannot notice that. This can: the background controller is the
   * only place a run can be observed, so it has to name the three entry points
   * the class documents and it has to store what they return.
   */
  const bg = readFileSync(join(import.meta.dirname, '..', 'src', 'app', 'background.ts'), 'utf8');
  const code = bg
    .split('\n')
    .filter((l) => !/^\s*(\*|\/\/)/.test(l))
    .join('\n');

  for (const call of ['observeRun', 'observeEvent', 'observeInventory']) {
    assert.ok(code.includes(call), `background.ts never calls ${call}: finished runs are being discarded`);
  }
  assert.ok(code.includes('appendMission'), 'background.ts never stores a record, so no history survives the session');
  assert.ok(
    /new MissionRecorder\(/.test(code),
    'background.ts holds no MissionRecorder, so nothing assembles a record at all',
  );
  // The `before` snapshot must come from what the store already holds. A fresh
  // getInfo at mission start would be the memory poll gep.ts exists to prevent.
  assert.ok(!/observeInventory\([^)]*getInfo/.test(code), 'the before snapshot must not trigger a read of the game');
}

/**
 * A MISSION START CLOSES THE RUN BEFORE IT, WITH THE SNAPSHOT IT HAS.
 *
 * A run waits for the inventory push that contains its loot. If the player
 * starts another mission first, that wait is over: from then on any push can
 * carry the NEW run's pickups, and the two outcomes available were both wrong -
 * a later push closing the earlier run with some of this run's loot in it, or
 * the thirty-second grace expiring and the earlier run's real loot being thrown
 * away entirely.
 *
 * The sequence below is what makes a run outlive its own end: `durableAt` is
 * set when the engine reports the write durable, and on a slow write it lands
 * well past the two-second settle - so a push that arrives in between is judged
 * "too early" and the run keeps waiting. That `durableAt` belongs to the run
 * that ended, which is why the start clears it before closing: the cutoff drops
 * back to the run's own end, and the push that was stranded counts for the run
 * it actually belongs to.
 */
function aMissionStartClosesTheRunBeforeIt() {
  const run = (endedAtMs: number, durationSeconds: number, node: string): MissionRun => ({
    node,
    name: null,
    planet: null,
    missionType: 'MT_EXTERMINATION',
    difficulty: 1,
    success: true,
    aborted: false,
    location: null,
    gameRules: null,
    squadSize: 1,
    isHost: true,
    extraction: null,
    durationSeconds,
    loadSeconds: 2,
    endedAtMs,
    syndicateXp: null,
    squad: null,
  });

  const started: LogEvent = { at: null, type: 'sessionState', from: 'SS_LOADING', to: 'SS_STARTED' };
  const durable: LogEvent = { at: null, type: 'inventoryDurable' };

  let clock = 1_000_000;
  const rec = new MissionRecorder(NODES, () => clock);

  rec.observeInventory(BEFORE, (clock = 1_000_000));
  rec.observeEvent(started); // the first run begins; BEFORE is latched

  // Its loot push lands 3 s after the outcome...
  rec.observeInventory(AFTER, (clock = 1_013_000));
  // ...but the engine only reports the write durable at 20 s, so that push is
  // judged too early and the run is left waiting.
  clock = 1_020_000;
  rec.observeEvent(durable);
  clock = 1_020_500;
  assert.equal(rec.observeRun(run(1_010_000, 10, 'SolNode167')), null, 'the first run closed before the case could arise');
  assert.ok(rec.pending, 'the first run is not waiting, so nothing here is being tested');

  // The player starts another mission. That is the end of the first run's
  // window, and the push in hand is unambiguously the first run's.
  clock = 1_021_000;
  const closed = rec.observeEvent(started);
  assert.ok(closed, 'A NEW MISSION STARTED AND THE PREVIOUS RUN WAS LEFT WAITING ON A WINDOW THAT HAS PASSED');
  assert.equal(closed.node, 'SolNode167');
  assert.equal(closed.lootAttributed, true, "the earlier run's own push was discarded rather than credited to it");
  assert.equal(closed.loot.find((l) => l.itemType === FERRITE)?.count, 250);
  assert.equal(rec.pending, null, 'the closed run is still pending, so it will be reported twice');

  // And the second run is latched against the snapshot that closed the first,
  // so the same items cannot be counted again.
  clock = 1_030_000;
  const second = rec.observeRun(run(1_030_000, 9, 'SolNode168'));
  assert.equal(second, null, 'the second run closed with no push of its own');
  clock = 1_035_000;
  const done = rec.observeInventory(AFTER, clock);
  assert.ok(done, 'the second run never closed');
  assert.equal(done.node, 'SolNode168');
  assert.deepEqual(done.loot, [], "the first run's loot was counted a second time against the second run");
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
console.log(failed ? `\n${failed} check(s) failed` : '\nall mission-history rules hold');
// Set the code rather than calling process.exit(): exiting immediately can race
// stdout flushing on Windows and print a libuv assertion after the report.
process.exitCode = failed ? 1 : 0;
