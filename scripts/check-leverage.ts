/**
 * The guidance engine, checked against the real datasets.
 *
 * Every number here was measured off `src/data/vendor/*.json` before the engine
 * was written, so these are not a snapshot of whatever the code happens to do -
 * they are the independently-derived facts the code has to reproduce. Two of
 * them exist specifically to catch failure modes that hang the UI thread or
 * silently fabricate, and neither is visible in a screenshot.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCatalog } from '../src/data/catalog.ts';
import { buildGraph, solve } from '../src/data/leverage.ts';
import type { AccountPicture } from '../src/data/progression.ts';
import { NOTHING_OBSERVED, observe } from '../src/data/plat-throughput.ts';
import type { MissionRecord } from '../src/data/missionlog.ts';

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

const graph = buildGraph(catalog);

/** A never-played account. The engine's primary state, not a degraded one. */
const EMPTY: AccountPicture = {
  masteryRank: null,
  masteryXp: null,
  quests: { have: 0, total: null },
  nodes: { have: 0, total: null },
  completedQuests: new Set<string>(),
  clearedNodes: new Set<string>(),
};

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

/* 1 ------------------------------------------------- the graph is the graph */
check('every node and quest is a vertex', () => {
  assert.equal(graph.vertices.length, catalog.nodeById.size + catalog.questByKey.size);
  assert.ok(graph.vertices.length > 350, `only ${String(graph.vertices.length)} vertices`);
});

check('AND and OR are separate relations, and OR is the larger', () => {
  const andEdges = graph.and.reduce((n, a) => n + a.length, 0);
  const orEdges = graph.or.reduce((n, a) => n + a.length, 0);
  assert.ok(andEdges > 50, `only ${String(andEdges)} AND edges`);
  assert.ok(orEdges > andEdges, 'OR should dominate: star-chart predecessors outnumber hard prerequisites');
});

/* 2 ------------------------------ the fixpoint terminates (the `>>> 0` trap) */
check('dominator fixpoint converges instead of hanging', () => {
  const t0 = Date.now();
  const solved = solve(graph, catalog, EMPTY, 'everything');
  const ms = Date.now() - t0;
  assert.ok(solved.band.size === graph.vertices.length, 'every vertex banded');
  // Unmasked `1 << 31` never settles and runs to the 300-pass cap; masked, a
  // whole solve including the five-step plan is comfortably sub-second.
  assert.ok(ms < 8000, `solve took ${String(ms)}ms - suspect a non-terminating fixpoint`);
});

/* 3 ----------------------------------------- dominance actually discriminates */
check('dominance separates the graph rather than tying everything', () => {
  const solved = solve(graph, catalog, EMPTY, 'everything');
  const counts = [...solved.domCount.values()];
  const top = Math.max(...counts);
  assert.ok(top > 100, `top vertex dominates only ${String(top)} - the graph is not being traversed`);
  const nonZero = counts.filter((c) => c > 0).length;
  assert.ok(nonZero > 0 && nonZero < counts.length, 'some vertices dominate, most do not');
});

/* 4 ------------------------------- the goal profile changes the answer */
check('different goals produce different plans', () => {
  const plans = new Map<string, string>();
  for (const g of ['everything', 'starchart', 'mastery', 'story', 'collection'] as const) {
    plans.set(g, solve(graph, catalog, EMPTY, g).plan.join('>'));
  }
  const distinct = new Set(plans.values());
  assert.ok(
    distinct.size > 1,
    `all goals produced the same plan - the picker is decorative again:\n${[...plans].map(([k, v]) => `${k}: ${v}`).join('\n')}`,
  );
});

/* 5 ------------------------------- unrecorded mastery is never counted as zero */
check('the known mastery pool is 27,569 over 182 payers, junctions counted once', () => {
  let payers = 0;
  let pool = 0;
  for (const v of graph.vertices) {
    if (v.mastery == null) continue;
    payers++;
    pool += v.mastery;
  }
  assert.equal(payers, 182, `expected 182 nodes with a recorded payout, got ${String(payers)}`);
  assert.equal(pool, 27_569, `expected 27,569 recorded mastery, got ${String(pool)}`);
});

check('171 reachable nodes have no recorded payout and contribute null, not zero', () => {
  const nodes = graph.vertices.filter((v) => v.kind === 'node');
  const unrecorded = nodes.filter((v) => v.mastery == null).length;
  /*
   * 171, not the 173 zeros in the raw file.
   *
   * nodes.json carries 355 rows under 353 distinct ids: DE reuses
   * `ToggleBootLevel` (Drifter's Camp / The Orbiter) and `SolNode236` (The
   * Duviri Experience / Isleweaver). `buildCatalog` keys by id, so the second
   * of each pair silently replaces the first and two rows never reach the app.
   * That is known and asserted harmless in validate-datasets.ts:48 - both
   * duplicates carry no edges - and both read 0 mastery, so the 182 payers are
   * unaffected. This asserts what the GRAPH sees, which is what the engine
   * ranks; if the vendor file is ever regenerated without the reuse, this is
   * the check that will say so.
   */
  assert.equal(unrecorded, 171, `expected 171 unrecorded, got ${String(unrecorded)}`);
  const solved = solve(graph, catalog, EMPTY, 'mastery');
  // A row we cannot value must not be scored as if it were worth nothing.
  const anyNull = [...solved.gate.values()].some((g) => g === null);
  assert.ok(anyNull, 'no null gate values under Mastery - unrecorded payouts are being counted as 0');
});

/* 6 -------------------------- band 1 does not lie to a brand-new account */
/* ----------------------------------------------------------- the cost of a path */

/**
 * A log in which this player runs Captures in four minutes and Survivals in
 * twenty. Nothing else is timed, and no quest ever is, because a quest is not
 * one mission.
 */
function timed(): ReturnType<typeof observe> {
  const run = (name: string, minutes: number): MissionRecord =>
    ({ missionTypeName: name, durationMs: minutes * 60_000, endedAt: 0, outcome: 'success' }) as unknown as MissionRecord;
  return observe([
    ...Array.from({ length: 4 }, () => run('Capture', 4)),
    ...Array.from({ length: 4 }, () => run('Survival', 20)),
  ]);
}

check('with no mission log, the plan is exactly what it was', () => {
  /*
   * THE REGRESSION LINE. Every caller that predates the timing argument gets
   * the count-based cost it always had - a fresh account's plan must not move
   * because the solver learned to read a log it does not have.
   */
  const before = solve(graph, catalog, EMPTY, 'everything');
  const explicit = solve(graph, catalog, EMPTY, 'everything', NOTHING_OBSERVED);
  assert.equal(before.costUnit, 'objectives', 'no log, so the count is the honest unit');
  assert.deepEqual(before.plan, explicit.plan, 'the default and the explicit empty log must agree');
  for (const [id, c] of before.cost) {
    const pre = before.prereqs.get(id) ?? 0;
    if (c === null) continue;
    assert.equal(c, pre + 1, `${id}: in objectives, cost is prerequisites plus the row itself, as it always was`);
    assert.equal(before.costAtLeast.get(id), false, 'a count is never a floor');
  }
});

/**
 * Advance a fresh account's frontier `steps` times by clearing every open node
 * and finishing every open quest - the walk a new player actually takes.
 *
 * WHY THE FIXTURE IS NOT SIMPLY `EMPTY`: measured, a fresh account has exactly
 * ONE open node - the first Exterminate, with 335 behind it - and the early
 * chart is close to a chain, so band 1 never holds two nodes worth the same.
 * "Quicker wins at equal value" cannot happen on Earth. Four steps in, Spy and
 * Mobile Defense are both open with nothing before them, which is the shape
 * the property needs.
 */
function advanced(steps: number): AccountPicture {
  const clearedNodes = new Set<string>();
  const completedQuests = new Set<string>();
  for (let i = 0; i < steps; i++) {
    const pic: AccountPicture = { ...EMPTY, masteryRank: 5, clearedNodes, completedQuests };
    const s = solve(graph, catalog, pic, 'starchart');
    for (const v of graph.vertices) {
      if (s.band.get(v.id) !== 1) continue;
      if (v.kind === 'node') clearedNodes.add(v.id);
      else completedQuests.add(v.id);
    }
  }
  return { ...EMPTY, masteryRank: 5, clearedNodes, completedQuests };
}

check('two open nodes cost what the log says they cost, not one each', () => {
  /*
   * THE DEFECT, STATED EXACTLY. `cost` was `costOf(...).size + 1`, which priced
   * every objective at one: a four-minute Spy and a twenty-minute Mobile Defense
   * with nothing before either were the same size, and `score` divided value
   * by that. With the player's own minutes the two costs are 4 and 20, and the
   * rate is value per hour of THEIR play - a figure the count could never have
   * expressed however it was weighted, and one their evening can contradict.
   *
   * Asserted as arithmetic rather than as a rank, because on this graph the two
   * dominate different slices and so never tie on value; the ratio is the
   * whole claim, and it is checked to the number.
   */
  const run = (name: string, minutes: number): MissionRecord =>
    ({ missionTypeName: name, durationMs: minutes * 60_000, endedAt: 0, outcome: 'success' }) as unknown as MissionRecord;
  const obs = observe([
    ...Array.from({ length: 4 }, () => run('Spy', 4)),
    ...Array.from({ length: 4 }, () => run('Mobile Defense', 20)),
  ]);
  const pic = advanced(4);
  const solved = solve(graph, catalog, pic, 'starchart', obs);
  assert.equal(solved.costUnit, 'minutes', 'a starchart goal with timed payers is rated in minutes');
  assert.match(solved.scoreUnit, /an hour$/, 'and the rate says so');

  const open = (type: string) =>
    graph.vertices.find((v) => v.kind === 'node' && v.missionType === type && solved.band.get(v.id) === 1);
  const spy = open('Spy');
  const md = open('Mobile Defense');
  assert.ok(spy && md, 'the fixture did not open a Spy and a Mobile Defense together, so this proves nothing');
  assert.equal(solved.prereqs.get(spy.id), 0, 'the Spy must have nothing before it, or the arithmetic below is not exact');
  assert.equal(solved.prereqs.get(md.id), 0, 'and likewise the Mobile Defense');

  assert.equal(solved.cost.get(spy.id), 4, `${spy.title}: four minutes of Spy, from the log`);
  assert.equal(solved.cost.get(md.id), 20, `${md.title}: twenty minutes of Mobile Defense, from the log`);
  assert.equal(solved.costAtLeast.get(spy.id), false, 'a path made only of timed nodes is a firm figure');
  assert.equal(solved.costAtLeast.get(md.id), false);

  const gs = solved.gate.get(spy.id);
  const gm = solved.gate.get(md.id);
  assert.ok(gs != null && gm != null);
  assert.equal(solved.score.get(spy.id), (gs / 4) * 60, 'score is value per HOUR: gate over minutes, times sixty');
  assert.equal(solved.score.get(md.id), (gm / 20) * 60);

  /*
   * THE CONTROL: the same two nodes, the same picture, no log. The count prices
   * them identically - which is the thing being fixed, so the fixture has to
   * be able to show it. Without this, a solver that ignored the log entirely
   * could still pass everything above by accident of the gate values.
   */
  const blind = solve(graph, catalog, pic, 'starchart');
  assert.equal(blind.costUnit, 'objectives');
  assert.equal(blind.cost.get(spy.id), 1);
  assert.equal(blind.cost.get(md.id), 1, 'without a log, the count still calls them the same size - that is what the log corrects');
});

check('a quest is never given minutes, and a path through one is a floor', () => {
  /*
   * A quest is many missions of unknown count and length. The overall median is
   * a per-mission figure, so lending it to a quest would not be a bound in
   * either direction - it would be a guess wearing the log's clothes. A quest
   * contributes nothing and flags the path; alone, it cannot be rated in
   * minutes at all, and its row says why.
   */
  const solved = solve(graph, catalog, EMPTY, 'everything', timed());
  assert.equal(solved.costUnit, 'minutes');
  let quests = 0;
  let bare = 0;
  for (const v of graph.vertices) {
    if (v.kind !== 'quest' || solved.band.get(v.id) === 3 || solved.band.get(v.id) === 4) continue;
    quests++;
    /*
     * ALWAYS A FLOOR: the quest itself contributes no minutes, so whatever the
     * path costs, the true figure is more than that.
     */
    assert.equal(solved.costAtLeast.get(v.id), true, `${v.title}: a path through a quest is never a firm figure`);
    /*
     * NULL ONLY WHEN THE QUEST STANDS ALONE. A quest behind timed nodes carries
     * their minutes as its floor - "at least the nodes before it" - which is
     * true and useful. The first draft of this check demanded null for every
     * quest and failed on Howl of the Kubrow, which sits behind a node the log
     * had timed. The assertion was wrong; the solver was not.
     */
    if ((solved.prereqs.get(v.id) ?? 0) === 0) {
      bare++;
      assert.equal(solved.cost.get(v.id), null, `${v.title}: a quest with nothing before it has no minutes to borrow, and must say so`);
      assert.match(solved.reason.get(v.id) ?? '', /cannot time/, `${v.title}: and the row must say why it is unrated`);
    }
  }
  assert.ok(quests > 0, 'the fixture found no rateable quest, so this proves nothing');
  assert.ok(bare > 0, 'the fixture found no prerequisite-free quest, so the null case was never tested');

  /*
   * A timed log with open nodes must still produce a plan. The first draft
   * went on to demand that the plan opened with a FIRM row - and failed,
   * correctly: at a fresh account band 1 is one untimed Exterminate, a floor,
   * and there is nothing firm to prefer. That preference is asserted where it
   * can actually be exercised, in the advanced fixture below.
   */
  assert.ok(solved.plan.length > 0, 'a timed log with open nodes must still produce a plan');
});

/** Clear only the open NODES for up to `cap` rounds; never finish a quest. */
function nodesOnly(cap: number): AccountPicture {
  const clearedNodes = new Set<string>();
  const completedQuests = new Set<string>();
  for (let i = 0; i < cap; i++) {
    const pic: AccountPicture = { ...EMPTY, masteryRank: 5, clearedNodes, completedQuests };
    const s = solve(graph, catalog, pic, 'everything');
    const openNodes = graph.vertices.filter((v) => v.kind === 'node' && s.band.get(v.id) === 1);
    if (openNodes.length === 0) break;
    for (const v of openNodes) clearedNodes.add(v.id);
  }
  return { ...EMPTY, masteryRank: 5, clearedNodes, completedQuests };
}

check('a mission log never empties the plan, and a quest still enters it', () => {
  /*
   * THE REVIEW'S SEVERITY-ONE FINDING, MEASURED. In minutes mode a quest has
   * no cost, so no score, and the plan loop skipped it. With every open node
   * on the near side of a quest cleared and no quest done - the exact state a
   * player reaches after an evening on Earth - band 1 held six quests and the
   * plan was EMPTY, on the tab whose one job is to name the next move, because
   * the player had a mission log. Objectives mode on the same account said
   * "Awakening" with five steps behind it.
   */
  const pic = nodesOnly(40);
  const solved = solve(graph, catalog, pic, 'everything', timed());
  const open = graph.vertices.filter((v) => solved.band.get(v.id) === 1 && (solved.gate.get(v.id) ?? 0) > 0);
  assert.ok(open.length > 0, 'the fixture opened nothing, so this proves nothing');
  const openNodes = open.filter((v) => v.kind === 'node');
  assert.equal(openNodes.length, 0, `${String(openNodes.length)} nodes still open - the fixture must leave only quests, or the empty case is untested`);
  assert.equal(solved.costUnit, 'minutes', 'the log must put the solve in minutes, or the null-cost path is never taken');

  assert.ok(solved.plan.length > 0, 'a player with a mission log was handed an empty plan');
  const quests = solved.plan.filter((id) => graph.vertices[graph.index.get(id) ?? -1]?.kind === 'quest');
  assert.ok(quests.length > 0, 'no quest entered the plan, so the unrated path is untested');

  // Unrated rows enter by what they open, largest first, and print no minutes.
  const gates = solved.plan.map((id) => solved.gate.get(id) ?? 0);
  assert.deepEqual(gates, [...gates].sort((a, b) => b - a), 'unrated rows must be ordered by what they open');
  for (const id of quests) assert.equal(solved.cost.get(id), null, `${id}: a quest in the plan must not acquire minutes`);

  /*
   * AND RATED ROWS STILL GO FIRST when both exist: we know what a node pays
   * and we do not know what a quest costs, and that is the honest order
   * between a rate and a non-rate.
   */
  const mixed = solve(graph, catalog, advanced(3), 'everything', timed());
  const scores = mixed.plan.map((id) => mixed.score.get(id));
  const firstNull = scores.findIndex((x) => x == null);
  if (firstNull >= 0) assert.ok(scores.slice(firstNull).every((x) => x == null), 'once the plan reaches an unrated row, no rated row may follow');
});

check('the working adds up on a row that actually has prerequisites', () => {
  /*
   * A band-1 row provably has none (every AND is done and the route is one
   * hop), so the plan's "sum" was always one link and the check below it
   * could not fail on drift. `costLinks` now covers every vertex; this sums a
   * row that has something to sum.
   */
  const solved = solve(graph, catalog, advanced(4), 'starchart', timed());
  const row = graph.vertices.find((v) => (solved.prereqs.get(v.id) ?? 0) > 0 && solved.cost.get(v.id) != null && solved.band.get(v.id) !== 3);
  assert.ok(row, 'no row with prerequisites and a cost, so a real sum was never tested');
  const links = solved.costLinks.get(row.id);
  assert.ok(links);
  assert.ok(links.length >= 2, `${row.title}: ${String(links.length)} link(s) - not a sum`);
  assert.equal(links.length, (solved.prereqs.get(row.id) ?? 0) + 1);
  const summed = links.reduce((n, l) => n + (l.value ?? 0), 0);
  assert.equal(Math.round(summed * 10) / 10, Math.round((solved.cost.get(row.id) ?? 0) * 10) / 10, `${row.title}: links sum to ${String(summed)}, cost says ${String(solved.cost.get(row.id))}`);
});

check('a stand-in says it is one, and claims no bound the log cannot give', () => {
  const run = (name: string, minutes: number): MissionRecord =>
    ({ missionTypeName: name, durationMs: minutes * 60_000, endedAt: 0, outcome: 'success' }) as unknown as MissionRecord;
  const solved = solve(graph, catalog, EMPTY, 'starchart', observe(Array.from({ length: 4 }, () => run('Rescue', 1))));
  const head = solved.plan[0];
  assert.ok(head);
  const links = solved.costLinks.get(head) ?? [];
  const standIn = links.find((l) => l.from === 'assumed');
  assert.ok(standIn, 'E Prime is an Exterminate and only Rescue is timed, so its link must be a stand-in');
  assert.ok(!/errs long|errs short|at most|at least/i.test(standIn.note), `the note claims a bound the log cannot give: "${standIn.note}"`);
  assert.match(standIn.note, /faster or slower/, 'the note must say the log does not know which way it errs');
  assert.ok(!/\b1 minutes\b/.test(standIn.note), 'one minute, singular');
  assert.match(standIn.note, /Rescue/, 'and name the type that stood in');
});

check('the working under "how long" adds up to the figure, and names what stands behind it', () => {
  /*
   * THE SECOND AND THIRD "HOW?" ON THE LANDING TAB. The fifth quality
   * measurement found NOW's reachable nesting stopped at one level while the
   * engine had already computed, then discarded, both things a reader would
   * ask for next: each path member's minutes with its provenance, and the
   * members of the set that "369 objectives sit behind it" counts. Both are
   * now on `Solved` for the plan's rows, and this pins them to the figures
   * they explain - the drills must be the sums un-summed, never a second
   * calculation that can drift from the heading.
   */
  const run = (name: string, minutes: number): MissionRecord =>
    ({ missionTypeName: name, durationMs: minutes * 60_000, endedAt: 0, outcome: 'success' }) as unknown as MissionRecord;
  const obs = observe([
    ...Array.from({ length: 4 }, () => run('Spy', 4)),
    ...Array.from({ length: 4 }, () => run('Mobile Defense', 20)),
  ]);
  const solved = solve(graph, catalog, advanced(4), 'starchart', obs);
  assert.equal(solved.costUnit, 'minutes');
  assert.ok(solved.plan.length > 0, 'no plan, nothing to drill');

  for (const id of solved.plan) {
    const links = solved.costLinks.get(id);
    assert.ok(links, `${id}: a plan row must carry its working`);
    assert.equal(links.length, (solved.prereqs.get(id) ?? 0) + 1, `${id}: one link per path member, ending on the row itself`);
    const last = links[links.length - 1];
    assert.ok(last, 'a path has at least its own row');
    const v = graph.vertices[graph.index.get(id) ?? -1];
    assert.equal(last.label, v?.title, `${id}: the last link is the row itself`);

    // THE SUM IS THE FIGURE. Not approximately - to the tenth the heading prints.
    const summed = links.reduce((n, l) => n + (l.value ?? 0), 0);
    const cost = solved.cost.get(id);
    if (cost === null || cost === undefined) {
      assert.ok(links.every((l) => l.value === null), `${id}: a null cost means no link had minutes`);
    } else {
      assert.equal(Math.round(summed * 10) / 10, Math.round(cost * 10) / 10, `${id}: the links sum to ${String(summed)} but the heading says ${String(cost)}`);
    }
    // A flag on the total is a flag on some link, and vice versa.
    const anyFlag = links.some((l) => l.value === null || l.from === 'assumed');
    assert.equal(solved.costAtLeast.get(id), anyFlag, `${id}: the total's flag must come from its links`);
    // Every link says where it came from, in the chain's own vocabulary.
    for (const l of links) {
      assert.ok(['measured', 'published', 'yours', 'assumed', 'unknown'].includes(l.from), `${id}: "${l.label}" has no provenance`);
      assert.ok(l.id.length > 0, `${id}: "${l.label}" must know which vertex it is - two junctions share a title`);
      // A stand-in must SAY it is one, in its provenance, not only in its prose.
      if (/Assumed as slow/.test(l.note)) assert.equal(l.from, 'assumed', `${id}: "${l.label}" is a stand-in wearing the word measured`);
      assert.ok(l.note.length > 30, `${id}: "${l.label}" must claim a sentence a player could contradict`);
      if (l.value === null) assert.equal(l.from, 'unknown', 'a link with no minutes is unknown, not measured at nothing');
    }

    // WHAT STANDS BEHIND IT is exactly the set the heading counted.
    const behind = solved.behind.get(id);
    assert.ok(behind, `${id}: a plan row must name what it opens`);
    const named = behind.reduce((n, g) => n + g.ids.length, 0);
    assert.equal(named, solved.domCount.get(id), `${id}: ${String(named)} named behind it, but domCount says ${String(solved.domCount.get(id))}`);
    for (const g of behind) assert.ok(g.ids.length > 0, 'an empty planet group is a group that should not exist');
    const sizes = behind.map((g) => g.ids.length);
    assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a), 'largest group first, so the eye lands on the planet that matters');
    for (const g of behind) for (const vid of g.ids) assert.notEqual(vid, id, 'a row does not stand behind itself');
  }

  /*
   * A QUEST ON A PATH IS A NULL LINK, and the same quest under the OBJECTIVES
   * unit is a published "1" - the vocabulary changes with the unit and must
   * say so, never print minutes for a thing the log cannot time.
   */
  const blind = solve(graph, catalog, advanced(4), 'everything');
  assert.equal(blind.costUnit, 'objectives');
  for (const id of blind.plan) {
    for (const l of blind.costLinks.get(id) ?? []) {
      assert.equal(l.value, 1, 'in objectives every member counts one');
      assert.equal(l.from, 'published', 'and a count is a rule, not a measurement');
      assert.equal(l.unit, 'objectives');
    }
  }
});

check('an untimed node is priced at your slowest pace, not your usual one', () => {
  /*
   * THE CHECK THAT REPLACED A WRONG RULE. This slot held "the plan takes a
   * firm figure before a floor", and a sabotage that deleted the preference
   * passed it - at the fixture's frontier the firm row already led on score,
   * so the rule was never exercised. Building a fixture where it WOULD bite
   * (only Rescue timed, at a minute, leaving Spy a flagged row worth 19,140 an
   * hour beside Rescue's firm 60) showed the rule choosing the 60. That is a
   * worse plan, not a safer one.
   *
   * So the stand-in for an untimed type is now pessimistic - the slowest type
   * this player has measured - and the plan compares scores directly. This
   * check pins the stand-in to the number: with Rescue at 1 minute and Capture
   * at 30, an untimed Spy costs 30, not the 15.5 the overall median would say.
   */
  const run = (name: string, minutes: number): MissionRecord =>
    ({ missionTypeName: name, durationMs: minutes * 60_000, endedAt: 0, outcome: 'success' }) as unknown as MissionRecord;
  const pic = advanced(4);
  const spy = graph.vertices.find((v) => v.kind === 'node' && v.missionType === 'Spy' && solve(graph, catalog, pic, 'starchart').band.get(v.id) === 1);
  assert.ok(spy, 'the fixture did not open a Spy, so this proves nothing');

  const rescueOnly = solve(graph, catalog, pic, 'starchart', observe(Array.from({ length: 4 }, () => run('Rescue', 1))));
  assert.equal(rescueOnly.costUnit, 'minutes');
  assert.equal(rescueOnly.costAtLeast.get(spy.id), true, 'Spy is untimed, so its figure is flagged');
  assert.equal(rescueOnly.cost.get(spy.id), 1, 'with one type timed, the slowest pace IS that type');

  const withSlowCapture = solve(
    graph,
    catalog,
    pic,
    'starchart',
    observe([...Array.from({ length: 4 }, () => run('Rescue', 1)), ...Array.from({ length: 4 }, () => run('Capture', 30))]),
  );
  assert.equal(
    withSlowCapture.cost.get(spy.id),
    30,
    'an untimed Spy is assumed as slow as the slowest thing measured - 30 - never the median of everything, which is 15.5',
  );

  /*
   * And because the flagged figure is already the cautious one, the plan may
   * open with it when it genuinely leads: Spy dominates hundreds of nodes and
   * Rescue one, so even at Rescue's pace Spy is the better hour. A rule that
   * refused this was refusing the arithmetic.
   */
  assert.equal(rescueOnly.plan[0], spy.id, 'the plan must take the flagged row when its pessimistic rate still leads');
});

check('a fresh account is not told locked content is available', () => {
  const solved = solve(graph, catalog, EMPTY, 'everything');
  const available = [...solved.band].filter(([, b]) => b === 1).map(([id]) => id);
  const titles = new Set(
    available.map((id) => graph.vertices[graph.index.get(id) ?? -1]?.title ?? '').map((t) => t.toLowerCase()),
  );
  for (const forbidden of ['kuva lich confrontation', 'sister of parvos confrontation', 'bifrost echo']) {
    assert.ok(!titles.has(forbidden), `"${forbidden}" reported as available to a never-played account`);
  }
  assert.ok(available.length > 0, 'nothing is available at all - the entry rule is too strict');
});

check('unevaluable gates are reported, not guessed', () => {
  const solved = solve(graph, catalog, EMPTY, 'everything');
  const notRankable = [...solved.band].filter(([, b]) => b === 3);
  assert.ok(notRankable.length > 0, 'nothing is not-rankable - hard gates are being silently ignored');
  for (const [id] of notRankable.slice(0, 50)) {
    assert.ok(solved.reason.get(id) != null, `band-3 row ${id} carries no reason`);
  }
});

check('an advisory is a gate nobody checked, never a stage direction', () => {
  const adv = (title: string): string | null => {
    const v = graph.vertices.find((x) => x.title === title);
    assert.ok(v, `${title} is a vertex`);
    return v.advisory;
  };
  assert.equal(adv('Awakening'), null, '"First Login" is how the quest starts, not a gate');
  assert.equal(adv('Sands of Inaros'), null, 'a Mastery Rank clause is checked by mrGate, so nothing is left unchecked');
  assert.equal(adv('Mask of the Revenant'), 'Observer rank with The Quills', 'a syndicate rank is a gate the account could contradict');
  assert.equal(adv('The Limbo Theorem'), 'Obtain an Archwing', 'a possession is a gate the account could contradict');
});

console.log(failures === 0 ? '\nall leverage rules hold' : `\n${String(failures)} leverage rule(s) broken`);
if (failures > 0) process.exit(1);
