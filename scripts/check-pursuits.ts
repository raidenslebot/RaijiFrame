/**
 * Self-check for the pursuit board.
 *
 * Two things are being defended here, and both are behavioural promises the UI
 * makes to the player rather than implementation details:
 *
 *   1. THE GOAL ACTUALLY CHANGES THE ADVICE. If picking "Mastery Rank" produced
 *      the same ordering as "Star Chart", the selector would be decoration. The
 *      checks assert that each profile lifts its own domain to the top.
 *
 *   2. UNMEASURED IS NOT ZERO. `makeProgressFor` must return null — never 0 —
 *      for anything the account cannot substantiate, and a pursuit whose source
 *      field is missing must stay ON the board rather than being dropped.
 *      Dropping it would quietly redefine "complete"; drawing it at 0% would be
 *      a false claim. This is the project's no-fabricated-data rule expressed as
 *      an executable assertion.
 *
 * Run: node scripts/check-pursuits.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GOALS,
  PURSUITS,
  groupByTier,
  rankPursuits,
  type Domain,
  type GoalProfile,
} from '../src/data/pursuits.ts';
import { makeProgressFor } from '../src/data/pursuit-progress.ts';
import type { AccountPicture } from '../src/data/progression.ts';
import type { RawInventory } from '../src/core/gep.ts';

let checks = 0;
const ok = (cond: unknown, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};
const eq = <T>(a: T, b: T, msg: string) => {
  assert.deepStrictEqual(a, b, msg);
  checks++;
};

const goal = (id: string): GoalProfile => {
  const g = GOALS.find((x) => x.id === id);
  assert.ok(g, `goal ${id} must exist`);
  return g;
};

/* ---------------------------------------------------------------- the board */

ok(PURSUITS.length >= 55, `the board should be exhaustive, got ${PURSUITS.length}`);

{
  const ids = PURSUITS.map((p) => p.id);
  eq(new Set(ids).size, ids.length, 'pursuit ids must be unique');
}

{
  // Every domain in the taxonomy must actually be used; an unused domain means
  // a whole area of the game silently has no entries.
  const used = new Set<Domain>(PURSUITS.map((p) => p.domain));
  const declared: Domain[] = [
    'narrative', 'starchart', 'mastery', 'collection', 'mods', 'relics', 'arcanes',
    'operator', 'railjack', 'syndicate', 'nemesis', 'events', 'routine', 'economy',
    'codex', 'endgame',
  ];
  for (const d of declared) ok(used.has(d), `domain "${d}" has no pursuits`);
}

/* ------------------------------------------------- ranking responds to goals */

// Nothing measured: every pursuit is equally untouched, so ordering is decided
// purely by weight x goal multiplier x cadence. That is the cleanest way to
// prove the goal profile is what is doing the work.
/*
 * THE FLAG AND THE COMPUTATION MUST AGREE, AND THEY HAD DRIFTED BOTH WAYS.
 * ───────────────────────────────────────────────────────────────────────
 * `Pursuit.measurable` documents itself as "False until the account data
 * genuinely exposes this", and `rankPursuits` reads it as a veto:
 * `p.measurable ? progressFor(p) : null`. So a pursuit with a working progress
 * case and `measurable: false` has its answer computed and thrown away.
 *
 * That is what had happened to `nodes.steel`. `makeProgressFor` counts
 * Missions entries carrying a Steel Path `Tier` - schema-verified, with the
 * same denominator as the normal chart - and the flag discarded the result, so
 * a player who had cleared half the Steel Path was told it was not measured
 * and the completion wheel counted one fewer measurable pursuit than it had.
 *
 * Twelve had drifted the other way: `measurable: true` with nothing computing
 * them. Harmless in the wheel, which counts `progress != null` rather than the
 * flag - but the field is a claim about the account data, and twelve of them
 * were false.
 *
 * This reads the switch itself rather than a list typed here, because a list
 * typed here is the same drift one file over.
 */
const PROGRESS_SRC = readFileSync(new URL('../src/data/pursuit-progress.ts', import.meta.url), 'utf8');
{
  const lines = PROGRESS_SRC.split('\n');
  const from = lines.findIndex((l) => l.includes('export function makeProgressFor'));
  const to = lines.findIndex((l, i) => i > from && l.trim() === 'default:');
  ok(from >= 0 && to > from, 'could not find the progress switch - this check is measuring nothing');
  const cases = new Set([...lines.slice(from, to).join('\n').matchAll(/case '([a-z.]+)':/g)].map((m) => m[1]));
  ok(cases.size > 15, `only ${String(cases.size)} progress cases found - the bounds are wrong`);

  const discarded = PURSUITS.filter((p) => !p.measurable && cases.has(p.id)).map((p) => p.id);
  const claimed = PURSUITS.filter((p) => p.measurable && !cases.has(p.id)).map((p) => p.id);
  eq(
    discarded,
    [] as string[],
    `computed and thrown away - these have a progress case but measurable:false, so rankPursuits never asks:\n  ${discarded.join('\n  ')}`,
  );
  eq(
    claimed,
    [] as string[],
    `claims the account exposes it, but nothing computes it:\n  ${claimed.join('\n  ')}`,
  );
}

const nothingMeasured = () => null;

{
  const everything = rankPursuits(goal('everything'), nothingMeasured);
  eq(everything.length, PURSUITS.length, 'ranking must never drop a pursuit');
}

{
  // Each profile must surface its own domain. Checked over the top slice rather
  // than the single top item, because several domains legitimately tie near the
  // top and pinning an exact winner would make this a change-detector test.
  const expectations: Array<[string, Domain[]]> = [
    ['mastery', ['mastery', 'collection']],
    ['starchart', ['starchart', 'narrative', 'endgame']],
    ['story', ['narrative']],
    ['collection', ['collection', 'mods', 'relics']],
    ['endgame', ['endgame', 'operator']],
  ];

  for (const [id, domains] of expectations) {
    const top = rankPursuits(goal(id), nothingMeasured).slice(0, 6);
    ok(
      top.some((p) => domains.includes(p.domain)),
      `goal "${id}" should surface ${domains.join('/')} in its top 6, got ${top.map((p) => p.domain).join(',')}`,
    );
  }
}

{
  // The selector must produce genuinely different boards, not a reshuffle of the
  // same first few. If these two agree on the top 10, the weights are inert.
  const a = rankPursuits(goal('mastery'), nothingMeasured).slice(0, 10).map((p) => p.id);
  const b = rankPursuits(goal('story'), nothingMeasured).slice(0, 10).map((p) => p.id);
  const shared = a.filter((id) => b.includes(id)).length;
  ok(shared < 8, `mastery and story boards are too similar (${shared}/10 shared)`);
}

{
  // Finished work must sink below unfinished work of the same weight, or the
  // board would keep recommending things that are already done.
  const g = goal('everything');
  const allDone = rankPursuits(g, () => 1);
  const allOpen = rankPursuits(g, () => 0);
  const doneScore = allDone.find((p) => p.id === 'nodes.normal')!.score;
  const openScore = allOpen.find((p) => p.id === 'nodes.normal')!.score;
  ok(openScore > doneScore, 'an unfinished pursuit must outrank the same one finished');
}

/* ----------------------------------------------------------------- tiering  */

{
  const grouped = groupByTier(rankPursuits(goal('everything'), nothingMeasured));
  const total = grouped.now.length + grouped.high.length + grouped.steady.length + grouped.longterm.length;
  eq(total, PURSUITS.length, 'tiering must partition the board without loss');

  // Daily and weekly work is time-boxed; it belongs in an urgent tier or the
  // player misses a reset. Nothing repeating should sink to "long term".
  for (const p of [...grouped.steady, ...grouped.longterm]) {
    ok(
      p.cadence !== 'daily' && p.cadence !== 'weekly',
      `${p.id} is ${p.cadence} but was tiered as ${p.tier}`,
    );
  }
}

/* --------------------------------------------- unmeasured is never zero ---- */

const emptyPicture: AccountPicture = {
  masteryRank: null,
  masteryXp: null,
  quests: { have: 0, total: null },
  nodes: { have: 0, total: null },
  completedQuests: new Set(),
  clearedNodes: new Set(),
};

{
  // No inventory at all: everything must be null, never 0.
  const measure = makeProgressFor(null, emptyPicture);
  for (const p of PURSUITS) {
    eq(measure(p), null, `${p.id} must be null with no inventory, not a number`);
  }
}

{
  // An inventory that genuinely lacks the source fields must also yield null —
  // "the field did not arrive" is not evidence of 0% progress.
  const bare: RawInventory = { PlayerLevel: 4 };
  const measure = makeProgressFor(bare, emptyPicture);
  for (const id of ['junctions', 'nodes.steel', 'railjack.intrinsics', 'railjack.drifter', 'economy.foundry']) {
    const p = PURSUITS.find((x) => x.id === id)!;
    eq(measure(p), null, `${id} must be null when its source field is absent`);
  }
}

{
  // With real fields present the measurement must be a real ratio.
  const inv: RawInventory = {
    PlayerLevel: 4,
    Missions: [
      { Tag: 'SolNode1', Completes: 1 },
      { Tag: 'EarthToVenusJunction', Completes: 1 },
      { Tag: 'VenusToMercuryJunction', Completes: 1 },
      { Tag: 'SolNode2', Completes: 1, Tier: 1 },
    ],
    PlayerSkills: { LPS_PILOTING: 10, LPS_GUNNERY: 0, LPS_ENGINEERING: 0, LPS_TACTICAL: 0, LPS_COMMAND: 0 },
    PendingRecipes: [],
  } as RawInventory;

  const picture: AccountPicture = { ...emptyPicture, nodes: { have: 2, total: 4 } };
  const measure = makeProgressFor(inv, picture, { junctions: 4 });

  eq(measure(PURSUITS.find((p) => p.id === 'junctions')!), 0.5, '2 of 4 junctions is 50%');
  eq(measure(PURSUITS.find((p) => p.id === 'nodes.normal')!), 0.5, '2 of 4 nodes is 50%');
  eq(measure(PURSUITS.find((p) => p.id === 'nodes.steel')!), 0.25, '1 Tier mission of 4 nodes is 25%');

  /*
   * AND THE BOARD RECEIVES IT.
   * ─────────────────────────
   * The assertion directly above passed for as long as the defect existed.
   * `makeProgressFor` computed 0.25 correctly every time; `rankPursuits` threw
   * it away, because `measurable: false` vetoes the call before it is made.
   * The function was covered and the flag that gates it was not, so a tested,
   * correct computation reached nobody.
   *
   * A measurement nothing consumes is not a measurement. This asserts the
   * value that arrives at the panel, which is the only one a player sees.
   */
  {
    const board = rankPursuits(goal('everything'), measure);
    const steel = board.find((p) => p.id === 'nodes.steel');
    ok(steel, 'nodes.steel must be on the board');
    eq(steel?.progress, 0.25, 'a Steel Path clear must reach the board, not stop at the flag');

    // The same journey for a pursuit that was already wired, so a regression in
    // the plumbing itself cannot hide behind the one row this defect touched.
    const normal = board.find((p) => p.id === 'nodes.normal');
    ok(normal, 'nodes.normal must be on the board');
    eq(normal?.progress, 0.5, 'and the ordinary chart still arrives');
  }
  // One tree maxed out of five, each capped at 10.
  eq(measure(PURSUITS.find((p) => p.id === 'railjack.intrinsics')!), 0.2, '10 of 50 intrinsics is 20%');
  eq(measure(PURSUITS.find((p) => p.id === 'economy.foundry')!), 1, 'an empty foundry queue is complete');
}

{
  // A ratio can never exceed 1, even when our vendored total is stale and the
  // account has cleared more than the catalog knows about.
  // Tags must match the real `<From>To<To>Junction` shape — the index goes in
  // the middle, not on the end, or they stop being junction tags at all.
  const inv: RawInventory = {
    Missions: Array.from({ length: 40 }, (_, i) => ({ Tag: `P${i}ToQ${i}Junction`, Completes: 1 })),
  } as RawInventory;
  const measure = makeProgressFor(inv, emptyPicture, { junctions: 4 });
  eq(measure(PURSUITS.find((p) => p.id === 'junctions')!), 1, 'a stale total must clamp to 1, not overflow');
}

{
  // Mastery rank is deliberately unmeasured: DE raises the cap every few months
  // so any denominator we pick would be wrong. Guard against someone "fixing"
  // this by inventing a max rank.
  const measure = makeProgressFor({ PlayerLevel: 30 } as RawInventory, emptyPicture);
  eq(measure(PURSUITS.find((p) => p.id === 'mastery.rank')!), null, 'mastery.rank must stay unmeasured');
}

/*
 * AN UNMEASURED PURSUIT MUST NOT OUTRANK A MEASURED ONE THAT IS BARELY STARTED.
 * ————————————————————————————————————————————
 * The score carries a `remaining` term running 0.25 (finished) to 1.0
 * (untouched). An unmeasured pursuit used to be handed 1.0 - the single most
 * favourable value available - which is not neutrality, it is a claim that none
 * of it is done, made on no evidence.
 *
 * Twenty-eight of the fifty-five pursuits are `measurable: false`, so a player
 * who had finished this week's routines saw every one of them sitting in "Do
 * now" for ever. The midpoint is what "we do not know" is worth: it ranks on
 * weight, goal and cadence, which are the things that ARE known.
 */
{
  const goal: GoalProfile = GOALS.find((g) => g.id === 'everything') ?? GOALS[0]!;
  /*
   * A MEASURABLE pursuit, deliberately. `rankPursuits` reads
   * `p.measurable ? progressFor(p) : null`, so a pursuit declared unmeasurable
   * never consults the callback at all - the first version of this check used
   * one and compared a number against itself, passing or failing for reasons
   * that had nothing to do with the rule. The unknown branch is reached by a
   * MEASURABLE pursuit whose measurement came back null, which is also the real
   * case: a field the account did not carry.
   */
  const twin = PURSUITS.find((p) => p.measurable) ?? PURSUITS[0]!;

  // The same pursuit, scored as unmeasured against scored as 1% done. If the
  // unmeasured one wins, `remaining` is still asserting the maximum.
  const asUnknown = rankPursuits(goal, (p) => (p.id === twin.id ? null : 0.5));
  const asBarelyStarted = rankPursuits(goal, (p) => (p.id === twin.id ? 0.01 : 0.5));
  const u = asUnknown.find((r) => r.id === twin.id)!;
  const b = asBarelyStarted.find((r) => r.id === twin.id)!;

  assert.ok(
    u.score < b.score,
    `an unmeasured "${twin.id}" scored ${String(u.score)}, at or above the ${String(b.score)} of the same pursuit ` +
      'measured at 1% done - unmeasured is claiming maximum remaining work again',
  );
  checks++;

  // And it must not sink out of sight either: unknown outranks the same pursuit
  // known to be nearly finished. Neither extreme is a thing we may assert.
  const asNearlyDone = rankPursuits(goal, (p) => (p.id === twin.id ? 0.99 : 0.5));
  const d = asNearlyDone.find((r) => r.id === twin.id)!;
  assert.ok(u.score > d.score, 'an unmeasured pursuit must not be scored as though it were finished either');
  checks++;

  // `progress` still reaches the panel as null, so the UI keeps saying
  // "not measured" rather than printing a percentage the score implies.
  assert.equal(u.progress, null, 'the midpoint is a SCORING device and must never become a displayed progress');
  checks++;
}

console.log(`check-pursuits: ${checks} assertions passed`);
