/**
 * The quest projection must not build the same thing twice.
 *
 * The 13 junctions are rows in nodes.json under the same ids the junction
 * dataset uses. Before an account is captured that is invisible: no junction is
 * on the frontier, so the node pass never touches them. Clear Earth and
 * EarthToVenusJunction enters the frontier - and the board grew a second row
 * with the same id, a mission node beside the junction, which React reported
 * as duplicate keys on every render with an account present.
 *
 * So this runs the projection WITH a cleared-Earth picture and asserts every
 * row id is unique and every junction is a junction. It is a synthetic account
 * built from real node ids inside a check script; nothing here ships.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCatalog, frontier } from '../src/data/catalog.ts';
import { derive } from '../src/data/progression.ts';
import { buildQuests, questTaskDone } from '../src/data/quests.ts';
import { makeProgressFor, questSplit } from '../src/data/pursuit-progress.ts';
import { PURSUITS } from '../src/data/pursuits.ts';
import type { RawInventory } from '../src/core/gep.ts';

const root = join(import.meta.dirname, '..', 'src', 'data', 'vendor');
const read = (f: string): unknown => JSON.parse(readFileSync(join(root, f), 'utf8'));
const nodesFile = read('nodes.json') as { nodes: unknown[] };
const questsFile = read('quests.json') as { quests: unknown[] };
const junctionsFile = read('junctions.json') as unknown;
const catalog = buildCatalog(
  nodesFile.nodes as never,
  questsFile.quests as never,
  (Array.isArray(junctionsFile) ? junctionsFile : (junctionsFile as { junctions: unknown[] }).junctions) as never,
);

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log('  ok   ', name);
  } catch (err) {
    failures++;
    console.log('  FAIL ', name, '\n         ', (err as Error).message.split('\n')[0]);
  }
}

const junctionIds = new Set(catalog.junctions.map((j) => j.id));
// Every Earth MISSION cleared - not the junctions, which are Earth rows too.
// Clearing those would take them off the frontier and the test would prove nothing.
const earth = [...catalog.nodeById.values()]
  .filter((n) => n.planet === 'Earth' && !junctionIds.has(n.id))
  .map((n) => n.id);
assert.ok(earth.length > 5, 'Earth has nodes');

/*
 * `QuestKeys: []` IS THE POINT, NOT NOISE.
 * ————————————————————————————————————————————
 * These checks describe an account that HAS been read and has finished no
 * quests. The fixture used to carry `Missions` alone, which is a different
 * account entirely - one whose quest list was never read at all - and the two
 * were indistinguishable only because `questDone` answered `false` to both.
 *
 * It no longer does, and the distinction is the whole point: an empty array is
 * an answer ("none"), an absent key is not ("we never asked"). `derive` reads
 * exactly that - `questsRead = Array.isArray(inv.QuestKeys)` - so this one line
 * is what makes "blocked" below a fact about the account rather than about our
 * own missing data. The unread case is asserted separately, at the bottom.
 */
const inv = { Missions: earth.map((Tag) => ({ Tag, Completes: 1 })), QuestKeys: [] } as unknown as RawInventory;
const picture = derive(inv, {}, []);
const front = new Set(frontier(catalog, picture).map((n) => n.id));

const junctionsOnFrontier = [...front].filter((id) => junctionIds.has(id));

check('the cleared-Earth picture actually puts junctions on the frontier', () => {
  assert.ok(junctionsOnFrontier.length > 0, 'no junction reached the frontier - the test is not exercising the bug');
});

const rows = buildQuests({ catalog, picture, frontier: front, progressFor: () => null });

check('every board row has a unique id', () => {
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`);
  assert.deepEqual(dupes, [], `duplicate row ids: ${dupes.join(', ')}`);
});

check('a junction on the frontier is built once, as a junction', () => {
  for (const id of junctionsOnFrontier) {
    const hits = rows.filter((r) => r.id === id);
    assert.equal(hits.length, 1, `${id} built ${String(hits.length)} times`);
    assert.equal(hits[0]?.kind, 'junction', `${id} built as ${String(hits[0]?.kind)}`);
  }
});

check('a junction quest task ticks when the account holds the quest KEY, not its name', () => {
  // Every junction quest task names its quest in prose ("The Teacher"); the
  // account records `/Lotus/Types/Keys/...`. The task was compared to the key
  // list by name and never ticked on any account.
  const junction = catalog.junctions.find((j) => j.tasks.some((t) => t.kind === 'quest' && t.ref));
  assert.ok(junction, 'a junction with a quest task');
  const task = junction.tasks.find((t) => t.kind === 'quest' && t.ref)!;
  const key = catalog.questKeyByName.get(task.ref!.toLowerCase());
  const id = key ? catalog.questByKey.get(key)?.id : null;
  assert.ok(id, `${task.ref!} resolves to a quest id`);
  const done = derive({ ...inv, QuestKeys: [{ ItemType: id, Completed: true }] } as unknown as RawInventory, {}, []);
  const rowsDone = buildQuests({ catalog, picture: done, frontier: front, progressFor: () => null });
  const row = rowsDone.find((r) => r.id === junction.id);
  assert.ok(row, `${junction.id} is on the board`);
  const step = row.steps.find((s) => s.ref === task.ref);
  assert.equal(step?.done, true, `${task.ref!} step reads ${String(step?.done)} with its key completed`);
  const before = rows.find((r) => r.id === junction.id)?.steps.find((s) => s.ref === task.ref);
  assert.equal(before?.done, false, 'and false, not null, when the key is absent');
  assert.equal(questTaskDone(catalog, picture, 'No Such Quest'), null, 'a name the catalog cannot place is unknown, never unticked');
});

check('mainline and side quests are two fractions, not one number twice', () => {
  const split = questSplit(catalog, picture);
  assert.ok(split.questsMain && split.questsSide, 'both halves present');
  assert.ok(split.questsMain.total > 0 && split.questsSide.total > 0, 'both halves have measurable quests');
  const ids = [...catalog.questByKey.values()].filter((q) => q.id).length;
  assert.equal(split.questsMain.total + split.questsSide.total, ids, 'every quest with an id lands in exactly one half');
  // Finish one mainline quest: the mainline fraction moves, the side one does not.
  const main = [...catalog.questByKey.values()].find((q) => q.mainline === true && q.id);
  assert.ok(main?.id, 'a mainline quest with an id');
  const after = questSplit(catalog, derive({ ...inv, QuestKeys: [{ ItemType: main.id, Completed: true }] } as unknown as RawInventory, {}, []));
  assert.equal(after.questsMain?.have, split.questsMain.have + 1, 'mainline moved by one');
  assert.equal(after.questsSide?.have, split.questsSide.have, 'side did not move');
});

check('Railjack intrinsics are read from the LPS_ rank keys', () => {
  const measure = makeProgressFor(
    { ...inv, PlayerSkills: { LPS_PILOTING: 5, LPS_GUNNERY: 5, LPP_PILOTING: 999 } } as unknown as RawInventory,
    picture,
  );
  const railjack = PURSUITS.find((p) => p.id === 'railjack.intrinsics');
  assert.ok(railjack, 'a Railjack intrinsics pursuit exists');
  const v = measure(railjack);
  assert.ok(v !== null && v > 0 && v < 1, `Railjack intrinsics read ${String(v)} from LPS_ keys`);
});

check('no account still builds every row once', () => {
  const empty = derive(null, {}, []);
  const rowsEmpty = buildQuests({ catalog, picture: empty, frontier: new Set(frontier(catalog, empty).map((n) => n.id)), progressFor: () => null });
  const ids = rowsEmpty.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids without an account');
});

check('a pursuit behind a quest is blocked until the account holds that quest', () => {
  const sortie = rows.find((r) => r.id === 'routine.sortie');
  assert.ok(sortie, 'the sortie pursuit is on the board');
  assert.equal(sortie.state, 'blocked', 'sorties need The War Within, which this account has not finished');
  assert.equal(sortie.blockedBy[0]?.title, 'The War Within');
  const key = catalog.questKeyByName.get('the war within');
  const id = key ? catalog.questByKey.get(key)?.id : null;
  assert.ok(id, 'The War Within has a key');
  const after = buildQuests({
    catalog,
    picture: derive({ ...inv, QuestKeys: [{ ItemType: id, Completed: true }] } as unknown as RawInventory, {}, []),
    frontier: front,
    progressFor: () => null,
  }).find((r) => r.id === 'routine.sortie');
  assert.notEqual(after?.state, 'blocked', 'and opens once it is');
  // The chart gate needs both halves of the fraction from the catalog: the total,
  // and the ids, so the cleared count is restricted to nodes this chart actually
  // has. Supplying only the total leaves the count unknown and the gate silent.
  const counted = derive(inv, { nodeCount: catalog.nodeById.size, nodeIds: new Set(catalog.nodeById.keys()) }, []);
  const steel = buildQuests({ catalog, picture: counted, frontier: front, progressFor: () => null }).find((r) => r.id === 'nodes.steel');
  assert.equal(steel?.state, 'blocked', 'the Steel Path waits for the whole chart');
  assert.equal(steel?.blockedBy[0]?.title, 'every star chart node');
});

check('an unread quest list blocks nothing, and says so instead', () => {
  /*
   * THE CHECK THAT WAS MISSING, WHICH IS WHY THE BUG LASTED.
   * ————————————————————————————————————————————
   * `Missions` but no `QuestKeys`: the game answered about the star chart and
   * said nothing about quests. Every quest gate is therefore unknowable, and
   * the board used to render four pursuits as "blocked - Needs The War Within"
   * on the strength of nothing at all.
   *
   * Unknown is not blocked. The row goes to `unmeasured` and carries the gate
   * as a NOTE, which is the shape `pursuitsAsQuests` was already written for
   * and could never reach.
   */
  const unread = derive({ Missions: earth.map((Tag) => ({ Tag, Completes: 1 })) } as unknown as RawInventory, {}, []);
  assert.equal(unread.quests.have, null, 'the fixture must genuinely be an unread quest list');

  const row = buildQuests({
    catalog,
    picture: unread,
    frontier: new Set(frontier(catalog, unread).map((n) => n.id)),
    progressFor: () => null,
  }).find((r) => r.id === 'routine.sortie');

  assert.ok(row, 'the sortie pursuit is on the board');
  assert.notEqual(row.state, 'blocked', 'an unread account cannot be blocked by a quest nobody asked about');
  assert.equal(row.blockedBy.length, 0, 'and it must not name a blocker it never verified');
  assert.ok(
    row.notes.some((n) => n.includes('The War Within')),
    'the gate still has to be mentioned - as a note, not as a verdict',
  );
});

console.log(failures === 0 ? '\nall quest-id rules hold' : `\n${String(failures)} quest-id rule(s) broken`);
if (failures > 0) process.exit(1);
