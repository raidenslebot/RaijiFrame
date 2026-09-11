/**
 * The platinum ranker's rules.
 *
 * The danger with a ranking engine is that it always produces an answer, and a
 * confident wrong order is indistinguishable from a right one until someone
 * checks. So the properties that make this ranking trustworthy are asserted:
 * it never invents a platinum figure, it never promotes a route the account
 * cannot reach, the preferences actually change the order, and every route that
 * moved can say which terms moved it.
 *
 * Run: node scripts/check-plat.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCatalog } from '../src/data/catalog.ts';
import { derive } from '../src/data/progression.ts';
import { platPosition } from '../src/data/platinum.ts';
import { PLAT_ROUTES, routeState, FAMILY_LABEL, type LiveSignal } from '../src/data/plat-routes.ts';
import { DEFAULT_PREFS, bestNow, powerLevel, rankRoutes, suggestPower } from '../src/data/plat-rank.ts';
import { owns, ownsFrame } from '../src/data/plat-capability.ts';
import { KEY_MODS, modState, readiness } from '../src/data/plat-mods.ts';
import { holdingsOf, tradesFor, valueRelic, type Holding, type Relic } from '../src/data/plat-value.ts';
import NODES from '../src/data/vendor/nodes.json' with { type: 'json' };
import type { ItemDb } from '../src/data/itemdb.ts';
import { intrinsics, syndicateRank } from '../src/data/plat-capability.ts';
import { tradeableOffers } from '../src/data/invasion-value.ts';
import { MODELS as THROUGHPUT_MODELS } from '../src/data/plat-throughput.ts';
import { ROUTE_GUIDE, guideFor, stepText } from '../src/data/plat-guide.ts';
import { planToday } from '../src/data/plat-plan.ts';
import type { SetVerdict } from '../src/data/set-completion.ts';
import { parsePrice, type MarketCatalog, type MarketItem } from '../src/data/market.ts';
import {
  DEFAULT_PREFERENCE,
  MODELS,
  MODEL_GAPS,
  NOTHING_OBSERVED,
  chainFor,
  evaluate,
  observe,
  rateAll,
  standingCap,
  standingPerHour,
  type Rate,
} from '../src/data/plat-throughput.ts';
import type { MissionRecord } from '../src/data/missionlog.ts';
import { gearFactor, liquidityFactor, soloFactor, tradeFactor } from '../src/data/plat-expect.ts';
import { dropLink } from '../src/data/plat-throughput.ts';
import { bestUseOfStanding, priceOfferings, tradeableOfferings, type Offering } from '../src/data/standing-value.ts';
import type { DucatDb } from '../src/data/ducats.ts';
import type { RawAccount } from '../src/data/account.ts';
import type { RawInventory } from '../src/core/gep.ts';

const root = join(import.meta.dirname, '..', 'src', 'data', 'vendor');
const read = (f: string): unknown => JSON.parse(readFileSync(join(root, f), 'utf8'));
const catalog = buildCatalog(
  (read('nodes.json') as { nodes: unknown[] }).nodes as never,
  (read('quests.json') as { quests: unknown[] }).quests as never,
  (() => {
    const j = read('junctions.json') as unknown;
    return (Array.isArray(j) ? j : (j as { junctions: unknown[] }).junctions) as never;
  })(),
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

const NO_LIVE: ReadonlySet<LiveSignal> = new Set();
const emptyPicture = derive(null, {}, []);
const emptyPos = platPosition(null);

/* ------------------------------------------------------------ the catalogue */

check('the route list is coherent and has no duplicate ids', () => {
  const ids = PLAT_ROUTES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate route id');
  assert.ok(PLAT_ROUTES.length >= 30, `only ${String(PLAT_ROUTES.length)} routes; the brief was every way in the game`);
  for (const r of PLAT_ROUTES) {
    assert.ok(r.name.length > 0 && r.how.length > 20, `${r.id} has no real description`);
    assert.ok(r.sells.length > 0, `${r.id} does not say what it sells`);
    assert.ok(r.where.length > 0, `${r.id} does not say where`);
    assert.ok(FAMILY_LABEL[r.family] !== undefined, `${r.id} has an unlabelled family`);
  }
});

check('NO ROUTE CARRIES AN INVENTED PLATINUM FIGURE', () => {
  /*
   * The rule this whole panel rests on. A price, a yield or a plat-per-hour
   * would make the ranking look authoritative and be worthless, because none of
   * them can be sourced without a market feed. Numbers describing DURATION or
   * COUNT are fine; a number next to "platinum" is not.
   */
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'data', 'plat-routes.ts'), 'utf8');
  const offenders: string[] = [];
  // "200 platinum", "50p", "~30 plat", "100-200 plat"
  for (const m of source.matchAll(/\d[\d,\s–-]*\s*(platinum|plat\b|\bp\b)/gi)) offenders.push(m[0]);
  assert.deepEqual(offenders, [], `platinum figures found in the route data: ${offenders.join(', ')}`);

  for (const r of PLAT_ROUTES) {
    const text = `${r.how} ${r.sells} ${r.alsoNeeds ?? ''}`;
    assert.ok(!/\d+\s*(platinum|plat\b)/i.test(text), `${r.id} quotes a platinum figure`);
  }
});

check('every gate names a quest the catalog can actually resolve', () => {
  // A gate the catalog cannot place would silently degrade every account to
  // "unconfirmed" for that route, which looks like caution and is really a typo.
  const unresolved: string[] = [];
  for (const r of PLAT_ROUTES) {
    if (r.gate === null) continue;
    const key = catalog.questKeyByName.get(r.gate.toLowerCase());
    if (!key) unresolved.push(`${r.id} → ${r.gate}`);
  }
  assert.deepEqual(unresolved, [], `gates naming a quest the catalog does not have: ${unresolved.join(', ')}`);
});

/* ------------------------------------------------------------------ gating */

check('a fresh account can never be told a gated route is open', () => {
  for (const r of PLAT_ROUTES) {
    const state = routeState(r, catalog, emptyPicture);
    /*
     * A route measured to pay nothing reports that instead of its gate, on
     * purpose: naming the gate would imply unlocking it was worth doing. The
     * property this check exists to protect - that a gated route never reads
     * `open` on a fresh account - still holds, because `pays-nothing` is not
     * `open` either.
     */
    if (r.paysNothing !== undefined) {
      assert.equal(state.status, 'pays-nothing', `${r.id} should report the measurement`);
    } else if (r.gate === null) {
      assert.equal(state.status, 'open', `${r.id} has no gate and should be open`);
    } else {
      assert.notEqual(state.status, 'open', `${r.id} is gated behind ${r.gate} but reads open on a fresh account`);
      assert.ok(state.reason.includes(r.gate), `${r.id} does not name what it needs`);
    }
  }
});

check('finishing the gating quest opens the route, and only that route', () => {
  const key = catalog.questKeyByName.get('the war within');
  const id = key ? catalog.questByKey.get(key)?.id : null;
  assert.ok(id, 'The War Within resolves');
  const after = derive({ QuestKeys: [{ ItemType: id, Completed: true }] } as unknown as RawInventory, {}, []);

  const sortie = PLAT_ROUTES.find((r) => r.id === 'riven-sortie');
  assert.ok(sortie);
  assert.equal(routeState(sortie, catalog, after).status, 'open', 'sorties should open with The War Within');

  /*
   * Archon Hunts used to assert 'blocked' here. They now assert 'pays-nothing',
   * because the measurement outranks the gate: their whole drop table is three
   * Archon Shards and no shard is tradeable. Telling a player it is "locked"
   * would imply unlocking it was worth doing.
   */
  const archon = PLAT_ROUTES.find((r) => r.id === 'riven-archon');
  assert.ok(archon);
  assert.equal(routeState(archon, catalog, after).status, 'pays-nothing', 'Archon Hunts pay no tradeable thing');
});

/* ------------------------------------------------- measured, not asserted */

/*
 * These lock down findings that were MEASURED against the live catalogues, so
 * that a future edit cannot quietly reintroduce advice that was checked and
 * found false. Each comment records what was counted and when.
 */
/*
 * A HARD REQUIREMENT CANNOT BE OUTVOTED, BECAUSE IT IS NOT IN THE VOTE.
 * ————————————————————————————————————————————
 * Not owning the gear a route needs used to score −14, under a comment calling
 * it "decisive" and saying that "putting a route you cannot start at the top of
 * a list headed 'best use of your next hour' is the most useless thing this
 * panel could do".
 *
 * It was not decisive. It was one term in a sum with more than fourteen points
 * of positives available to it — the measured-rate term alone reaches 18 at a
 * maxed slider, before live-window, liquidity, big-ticket, low-friction, ducat,
 * capital and session-fit. So a player with no Necramech could be sent to
 * Isolation Vaults by arithmetic, past a comment forbidding exactly that.
 *
 * The fix is an ordering rather than a weight, and this checks the property a
 * weight can never give: with EVERY slider at maximum, no route the account
 * provably cannot do outranks one it can.
 */
check('a route you provably cannot do never outranks one you can', () => {
  /*
   * Every gear bin PRESENT and EMPTY. Present matters: `owns` returns null for
   * an absent array, which is "unread" and correctly scores only −2. An empty
   * array is a measurement — the account was read and holds none — and that is
   * the case this rule is about.
   */
  const noGear = {
    OperatorAmps: [],
    MechSuits: [],
    CrewShips: [],
    SpaceSuits: [],
    KubrowPets: [],
    Hoverboards: [],
    Suits: [],
    Missions: [],
  } as unknown as Parameters<typeof rankRoutes>[5];

  // Every positive term at its maximum, which is the whole point: if the
  // ordering holds here it holds everywhere below here.
  const maxed = {
    ...DEFAULT_PREFS,
    includeLocked: true,
    wantHighRate: 3,
    wantLiveNow: 3,
    wantLiquid: 3,
    wantBigTicket: 3,
    wantLowFriction: 3,
  };

  const ranked = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, maxed, noGear);

  const blocked = ranked.filter((r) => r.cannot !== null);
  const doable = ranked.filter((r) => r.cannot === null);
  assert.ok(blocked.length > 0, 'the fixture produced no blocked route, so this check proves nothing');
  assert.ok(doable.length > 0, 'the fixture produced no doable route, so this check proves nothing');

  const firstBlocked = ranked.findIndex((r) => r.cannot !== null);
  const lastDoable = ranked.map((r) => r.cannot === null).lastIndexOf(true);
  assert.ok(
    firstBlocked > lastDoable,
    `"${ranked[firstBlocked]?.state.route.name ?? '?'}" needs gear this account does not own and still ranked ` +
      `above "${ranked[lastDoable]?.state.route.name ?? '?'}", which it can do`,
  );

  /*
   * And the single headline suggestion — the one line this panel exists to
   * produce — must be a route the player can actually start. `status` only
   * covers the QUEST gate, so it said yes to gear-blocked routes.
   */
  const best = bestNow(ranked);
  assert.ok(best, 'a ranking with doable routes must produce a best');
  assert.equal(best.cannot, null, `bestNow chose "${best.state.route.name}", which the account cannot equip for`);
});

check('a route that pays nothing tradeable carries its evidence and is never ranked', () => {
  const worthless = PLAT_ROUTES.filter((r) => r.paysNothing !== undefined);
  assert.ok(worthless.length >= 4, `expected the measured-worthless routes to be carried, found ${String(worthless.length)}`);

  for (const r of worthless) {
    assert.ok((r.paysNothing ?? '').length > 40, `${r.id} is marked worthless with no evidence`);
    assert.equal(r.sells, 'Nothing tradeable', `${r.id} still claims to sell something`);
  }

  // Not ranked at ANY preference, including the one that shows locked routes.
  for (const prefs of [DEFAULT_PREFS, { ...DEFAULT_PREFS, includeLocked: true }]) {
    const ranked = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, prefs, null);
    for (const r of worthless) {
      assert.ok(!ranked.some((x) => x.state.route.id === r.id), `${r.id} pays nothing and still entered the ranking`);
    }
  }
});

check('the routes measured against the market are the ones marked worthless', () => {
  // Measured 2026-09-02 against warframe.market's 3,840 items and DE's drop
  // tables: 0 ephemera, 0 Holokeys, 0 Tenet weapons, 0 Archon Shards are
  // tradeable, and the Circuit's own table is adapters and resources only.
  for (const id of ['ephemera', 'holokeys', 'riven-archon', 'riven-circuit']) {
    const route = PLAT_ROUTES.find((r) => r.id === id);
    assert.ok(route, `${id} should still exist - it is carried, not deleted`);
    assert.ok(route.paysNothing !== undefined, `${id} was measured to pay nothing and must say so`);
  }
});

check('fishing and mining state the direction that actually sells', () => {
  /*
   * Measured: whole fish 16/16 on the market, fish parts 0/10; cut gems 9/12,
   * raw gems 1/18. The route this replaced had it exactly backwards and would
   * have told a player to cut a fish, which destroys the trade.
   */
  const fish = PLAT_ROUTES.find((r) => r.id === 'fish-whole');
  assert.ok(fish, 'the whole-fish route should exist');
  assert.match(fish.how, /whole/i, 'the fish route must say to keep them whole');
  assert.ok(!/cut/i.test(fish.sells), 'the fish route must not sell cut parts');

  const gems = PLAT_ROUTES.find((r) => r.id === 'gems-cut');
  assert.ok(gems, 'the cut-gem route should exist');
  assert.match(gems.sells, /cut/i, 'the gem route must sell CUT gems');

  assert.ok(!PLAT_ROUTES.some((r) => r.id === 'fish-gems'), 'the old inverted fish/gem route is still present');
});

check('Duviri rivens are attributed to Endless on Hard, not to the Circuit', () => {
  // Measured: the Circuit's three rotations pay adapters and seven resources.
  // Rivens are in Duviri/Endless Tier 6+ (Hard) at 11.9 / 8.5 / 8.5 / 1.2 / 1.2.
  const endless = PLAT_ROUTES.find((r) => r.id === 'riven-duviri-endless');
  assert.ok(endless, 'the Duviri Endless route should exist');
  assert.match(endless.sells, /riven/i, 'the Endless route is the one that pays Rivens');
  assert.ok(endless.paysNothing === undefined, 'Duviri Endless does pay a tradeable thing');
});

check('locked routes are hidden by default and shown on request', () => {
  /*
   * A LOCKED ROUTE NEEDS AN ACCOUNT THAT ACTUALLY SAID "NO".
   * ————————————————————————————————————————————
   * This used `emptyPicture` - `derive(null, ...)`, no account at all - and
   * still expected `blocked`, which meant the fixture was proving the feature
   * with a verdict the app had invented. `QuestKeys: []` is the smallest
   * account that has genuinely been read and genuinely holds no quests, so the
   * gate is unfinished as a FACT and the route is locked for a real reason.
   */
  const readPicture = derive({ QuestKeys: [] } as unknown as RawInventory, {}, []);
  const hidden = rankRoutes(catalog, readPicture, emptyPos, NO_LIVE, DEFAULT_PREFS, null);
  assert.ok(!hidden.some((r) => r.state.status === 'blocked'), 'a blocked route leaked into the default view');
  const shown = rankRoutes(catalog, readPicture, emptyPos, NO_LIVE, { ...DEFAULT_PREFS, includeLocked: true }, null);
  assert.ok(shown.length > hidden.length, 'showing locked routes did not add any');
  assert.ok(shown.some((r) => r.state.status === 'blocked'), 'no blocked route appeared');
});

check('with no account read, a gated route is unknown rather than blocked', () => {
  /*
   * The other half of the pair above, and the one that was missing. With
   * nothing read, "Needs The Duviri Paradox first" is a claim about the player
   * built out of our own absent data. `routeState` already had the honest
   * branch - status `unknown`, "whether you finished it cannot be confirmed" -
   * and `questDone` could never reach it.
   */
  const gated = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, { ...DEFAULT_PREFS, includeLocked: true }, null);
  assert.ok(!gated.some((r) => r.state.status === 'blocked'), 'an unread account cannot have a verified blocker');
  assert.ok(gated.some((r) => r.state.status === 'unknown'), 'a gated route must be reported as unconfirmed');
});

/* ------------------------------------------------------------- ducat value */

/*
 * The Ducat half of a relic's value is the only figure in the platinum stack
 * that is EXACT, so it is the one place a silent arithmetic slip would be least
 * likely to be noticed and most damaging - it looks authoritative by
 * construction. These assert the arithmetic against a hand-computed answer and
 * pin the two traps that were found while building it.
 */

const MAG_CHASSIS = '/Lotus/Types/Recipes/WarframeRecipes/MagPrimeChassisComponent';
const MAG_BP = '/Lotus/Types/Recipes/WarframeRecipes/MagPrimeBlueprint';
const FORMA = '/Lotus/Types/Recipes/Components/FormaBlueprint';

const ducatFixture: DucatDb = {
  // The five real tiers, measured over DE's exports: 15/25/45/65/100.
  byItemType: new Map([
    [MAG_CHASSIS, 45],
    [MAG_BP, 100],
  ]),
  failed: false,
};

const relicFixture: Relic = {
  tier: 'Axi',
  name: 'T1',
  state: 'Radiant',
  itemType: '/Lotus/Types/Game/Projections/TestPlatinum',
  vaulted: false,
  rewards: [
    { item: 'Mag Prime Chassis', rarity: 'Uncommon', chance: 20, itemType: MAG_CHASSIS, slug: 'mag_prime_chassis' },
    { item: 'Mag Prime Blueprint', rarity: 'Rare', chance: 10, itemType: MAG_BP, slug: 'mag_prime_blueprint' },
    // Forma is the honest hole: it drops from relics and sells for no Ducats.
    { item: 'Forma Blueprint', rarity: 'Common', chance: 70, itemType: FORMA, slug: null },
  ],
};

check('expected ducats is chance x price, summed, and nothing else', () => {
  const v = valueRelic(relicFixture, new Map(), ducatFixture);
  // 0.20 x 45 = 9, 0.10 x 100 = 10, Forma contributes nothing.
  assert.equal(v.expectedDucats, 19, 'the ducat expectation is not the plain sum');
  assert.equal(v.ducatCoverage, 0.3, 'coverage must be the share of the table that HAS a ducat value');
});

check('a reward with no ducat value reports null, never zero', () => {
  const v = valueRelic(relicFixture, new Map(), ducatFixture);
  const forma = v.rewards.find((r) => r.item === 'Forma Blueprint');
  assert.ok(forma);
  assert.equal(forma.ducats, null, 'Forma sells for no ducats, which is null and not 0');
  assert.equal(forma.expectedDucats, null, 'an absent price cannot produce an expectation');
});

check('with no ducat table at all, every ducat figure is absent rather than zero', () => {
  const v = valueRelic(relicFixture, new Map(), null);
  assert.equal(v.expectedDucats, 0, 'the sum of nothing is 0');
  assert.equal(v.ducatCoverage, 0, 'and coverage must say that nothing was covered');
  for (const r of v.rewards) {
    assert.equal(r.ducats, null, `${r.item} invented a ducat value with no table loaded`);
  }
});

check('an unpriced reward never contributes platinum, and coverage says so', () => {
  const v = valueRelic(relicFixture, new Map(), ducatFixture);
  assert.equal(v.expected, 0, 'no prices were supplied, so no platinum can be expected');
  assert.equal(v.coverage, 0, 'coverage must report that none of the table was priced');
});

/* -------------------------------------------------------- what you hold */

const CHASSIS = '/Lotus/Types/Recipes/WarframeRecipes/MagPrimeChassisComponent';
const CHEAP = '/Lotus/Types/Items/MiscItems/Ferrite';

const marketFixture: MarketCatalog = (() => {
  const mk = (slug: string, name: string, gameRef: string): MarketItem =>
    ({ slug, name, gameRef }) as unknown as MarketItem;
  const a = mk('mag_prime_chassis', 'Mag Prime Chassis', CHASSIS);
  const b = mk('ferrite', 'Ferrite', CHEAP);
  return {
    byGameRef: new Map([
      [CHASSIS, a],
      [CHEAP, b],
    ]),
    bySlug: new Map([
      ['mag_prime_chassis', a],
      ['ferrite', b],
    ]),
    all: [a, b],
    failed: false,
  };
})();

check('a stack is costed in trades, six items at a time', () => {
  // Six per side, per trade. The boundaries are the whole point.
  assert.equal(tradesFor(0), 0);
  assert.equal(tradesFor(1), 1);
  assert.equal(tradesFor(6), 1);
  assert.equal(tradesFor(7), 2);
  assert.equal(tradesFor(400), 67, '400 stars is 67 trades - more than two days at MR30');
});

check('holdings rank by ducat value, not by how many you happen to have', () => {
  /*
   * The regression this pins: ranking by COUNT put 180,000 Ferrite above a
   * Prime part, which is exactly backwards and was the original behaviour.
   */
  const account = {
    MiscItems: [
      { ItemType: CHEAP, ItemCount: 180_000 },
      { ItemType: CHASSIS, ItemCount: 2 },
    ],
  };
  const ducatTable = { byItemType: new Map([[CHASSIS, 45]]), failed: false };
  const held = holdingsOf(account, marketFixture, ducatTable);

  assert.equal(held.length, 2);
  assert.equal(held[0]?.name, 'Mag Prime Chassis', 'the valuable item must rank first despite the tiny count');
  assert.equal(held[0]?.ducatWorth, 90, '2 x 45 ducats');
  assert.equal(held[1]?.ducats, null, 'Ferrite has no ducat value, which is null and not 0');
  assert.equal(held[1]?.ducatWorth, null);
});

check('holdings never invent a platinum figure before anything is priced', () => {
  const account = { MiscItems: [{ ItemType: CHASSIS, ItemCount: 3 }] };
  const held = holdingsOf(account, marketFixture, { byItemType: new Map([[CHASSIS, 45]]), failed: false });
  assert.equal(held[0]?.price, null, 'nothing was fetched, so there is no price');
  assert.equal(held[0]?.worth, null, 'and no worth - absent, never zero');
});

check('an unread account yields no holdings at all, rather than an empty purse', () => {
  assert.deepEqual(holdingsOf(null, marketFixture, null), [], 'null account must not fabricate a zero-value stock');
});

/* ---------------------------------------------------------- the throughput */

/*
 * The engine's whole value is that it MEASURES rather than asks, and REFUSES
 * rather than estimates. These pin both: timings must come from the player's own
 * runs, and one unknown link must stop the chain and name itself.
 */

const NO_BOOK = new Map();

/** A recorded run, with only the fields the engine reads. */
const run = (missionTypeName: string | null, minutes: number): MissionRecord =>
  ({ missionTypeName, durationMs: minutes * 60_000, endedAt: 0 }) as unknown as MissionRecord;

/*
 * A RUN THAT FAILED IS NOT HOW LONG THE ROUTE TAKES.
 * ————————————————————————————————————————————
 * `observe` filtered on `durationMs > 0` alone and never read `outcome`, which
 * `MissionRecord` has carried since it was written. A Survival abandoned at
 * four minutes therefore entered the median as a four-minute run: shorter
 * minutes-per-run, higher runs-per-hour, higher platinum-per-hour — for an
 * attempt that paid nothing.
 *
 * The bias runs one way and lands hardest on the accounts it hurts most, since
 * failing and aborting is what an under-geared player does. The engine was
 * telling exactly those players that the content they cannot finish is the most
 * profitable thing available to them.
 */
/*
 * THE DAILY STANDING CAP IS IN THE LOG AND WAS READ BY NOTHING.
 * ————————————————————————————————————————————
 * `SyndicateXp.afterCheckpoint` is documented in `eelog.ts` as: "Below
 * `afterMultiplier` means the player has hit their daily standing cap." It is
 * parsed, typed and carried on every `MissionRecord` - and no consumer existed,
 * so the standing card went on telling players to go and earn standing they
 * could not earn again until the reset.
 *
 * The third state is the one worth checking. "No run since the reset earned any
 * standing" is not "you have room left"; it is a question nobody asked.
 */
check('the daily standing cap is read from the runs, and unknown when unasked', () => {
  const xpRun = (endedAt: number, afterMultiplier: number, afterCheckpoint: number): MissionRecord =>
    ({ endedAt, syndicateXp: { base: afterMultiplier, afterMultiplier, afterCheckpoint } }) as unknown as MissionRecord;

  const RESET = 1000;

  // Clipped: the checkpoint paid less than the multiplier earned.
  const capped = standingCap([xpRun(1100, 3000, 3000), xpRun(1200, 3000, 900)], RESET);
  assert.equal(capped.hit, true);
  assert.equal(capped.runs, 2, 'both earning runs are the evidence');
  assert.equal(capped.at, 1200, 'and it names when the cap first bit');

  // Earning freely.
  assert.deepEqual(standingCap([xpRun(1100, 3000, 3000)], RESET), { hit: false, runs: 1, at: null });

  /*
   * UNKNOWN, NOT "ROOM LEFT". A run that earned nothing says nothing about the
   * cap - the player may have been running content that pays no standing at
   * all - and neither does a run from before the reset.
   */
  assert.equal(standingCap([xpRun(1100, 0, 0)], RESET).hit, null, 'a run that earned nothing is not evidence');

  /*
   * A RECORD WITH NO `syndicateXp` KEY AT ALL, WHICH CRASHED THE APP.
   * ————————————————————————————————————————————
   * The field is typed `SyndicateXp | null` and was guarded with `=== null`.
   * Records come back from IndexedDB, and one stored before the field existed
   * has no such key: that reads `undefined`, passes a strict null check, and
   * the next line dereferences it. The overlay rendered a blank page.
   *
   * Every fixture here CONSTRUCTED the field, so none of them could catch it.
   * These two do — one absent, one explicitly undefined — and they are the
   * shape real stored data actually takes.
   */
  const noField = { endedAt: 1100, durationMs: 600_000 } as unknown as MissionRecord;
  const undef = { endedAt: 1100, durationMs: 600_000, syndicateXp: undefined } as unknown as MissionRecord;
  assert.equal(standingCap([noField, undef], RESET).hit, null, 'a record with no standing field must not crash');
  assert.equal(standingPerHour([noField, undef]), null, 'and neither must the rate');
  assert.equal(
    observe([noField, undef]).reliability,
    null,
    'nor the observation pass that walks the same records',
  );
  assert.equal(standingCap([xpRun(900, 3000, 900)], RESET).hit, null, 'a run from before the reset is not today');
  assert.equal(standingCap([], RESET).hit, null, 'and an empty log answers nothing');
});

/*
 * A RATE FROM TWO RUNS IS NOT A RATE, AND THE SAMPLE SAYS SO ITSELF.
 * ————————————————————————————————————————————
 * `runs` was carried on every timing and used only in prose. The ranking read
 * `minutes` alone, so a route run twice - fast, once, on a good night - sat at
 * the top of the table with "from 2 runs" underneath it in grey.
 *
 * `slowest` is the honest upper end of the same median, taken from the order
 * statistics of the sample itself. It assumes nothing about the shape of the
 * distribution, which matters because mission times have a hard floor and a
 * long tail; and it needs no prior, so the only chosen number is the
 * confidence level.
 */
check('a timing carries the band its own sample supports', () => {
  const timed = (name: string, minutes: readonly number[]): MissionRecord[] =>
    minutes.map((m) => ({ missionTypeName: name, durationMs: m * 60_000, endedAt: 0 }) as unknown as MissionRecord);

  // Under three runs cannot bound a median at all. Null is the answer, and it
  // must not be confused with a band that happens to be tight.
  for (const n of [1, 2]) {
    const t = observe(timed('Capture', Array.from({ length: n }, () => 5))).byType.get('Capture');
    assert.ok(t);
    assert.equal(t.runs, n);
    assert.equal(t.slowest, null, `${String(n)} run(s) cannot bound a median`);
  }

  /*
   * THE EVIDENCE SETS THE WIDTH. Same spread of times, more runs: the band
   * closes in on the median rather than staying at the extremes.
   */
  const spread = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const few = observe(timed('Survival', spread.slice(0, 4))).byType.get('Survival');
  const many = observe(timed('Survival', spread)).byType.get('Survival');
  assert.ok(few && many);
  assert.ok(few.slowest !== null && many.slowest !== null);
  assert.equal(few.slowest, 6, 'four runs of 3-6 can only bound the median by the runs themselves');
  assert.ok(
    many.slowest < Math.max(...spread),
    `eighteen runs should pull the band inside the extremes, got ${String(many.slowest)}`,
  );
  assert.ok(many.slowest >= many.minutes, 'and the slow end is never faster than the median it bounds');

  /*
   * THE OVERFLOW GUARD. Past sixty runs the exact binomial divides by 2^n,
   * which is Infinity, and every coverage then reads as exactly 1 - walking the
   * band down to a single sample and calling that certainty. It is finite and
   * plausible-looking on screen, so nothing else would catch it.
   */
  /*
   * 1,024 RUNS, AND BOTH NUMBERS HERE WERE MEASURED RATHER THAN ASSUMED.
   *
   * The exact binomial form is fine to n = 1023 and inverts at exactly 1024,
   * where 2^n overflows to Infinity, every coverage reads as 1, and the band
   * collapses to a single sample - the tightest possible interval produced at
   * the moment the arithmetic broke.
   *
   * The first version of this check used 400 runs of twenty repeated values and
   * passed with the guard deleted, twice: 400 is inside the exact form's range,
   * and the duplicates made both answers land on the same number anyway. A test
   * that cannot fail is not a test, and only sabotaging it showed that.
   *
   * Measured at n = 1024 with distinct values 1..1024, median 512.5:
   *   guarded approximation -> k = 491, slow end 534
   *   overflowed exact form -> k = 512, slow end 513
   * Twenty-one apart, and the second is the median with a band painted on it.
   */
  const long = observe(timed('Defense', Array.from({ length: 1024 }, (_, i) => i + 1))).byType.get('Defense');
  assert.ok(long?.slowest != null && Number.isFinite(long.slowest), 'a long log must still produce a finite band');
  assert.ok(
    long.slowest >= 525,
    `1024 runs must keep a real band (slow end 534), not collapse onto the median at 513 - got ${String(long.slowest)}`,
  );
  assert.ok(long.slowest < 600, `and it must still be a tight band around 512, got ${String(long.slowest)}`);
});

/*
 * A ROUTE YOU ABANDON HALF THE TIME DOES NOT PAY WHAT IT PAYS WHEN IT LANDS.
 * ————————————————————————————————————————————
 * The rate chain is a product — runs an hour, items a run, platinum an item —
 * and every term was a measurement of a run that WORKED. The figure it produced
 * was therefore "platinum an hour if the run lands", presented as platinum an
 * hour.
 *
 * Account-wide that distinction cannot reorder anything: applied to every route
 * equally it is a constant multiplier. Per mission type it can, and that is the
 * point — an account that finishes every Capture and abandons half its
 * Survivals is being told something false when both are quoted at their
 * went-well rate.
 */
check('the rate carries how often this account finishes this kind of run', () => {
  const ended = (name: string, minutes: number, outcome: string): MissionRecord =>
    ({ missionTypeName: name, durationMs: minutes * 60_000, endedAt: 0, outcome }) as unknown as MissionRecord;

  // Six Survivals: three finished, three abandoned. The timings are identical
  // so nothing but the outcome can move the answer.
  const obs = observe([
    ...Array.from({ length: 3 }, () => ended('Survival', 20, 'success')),
    ...Array.from({ length: 3 }, () => ended('Survival', 20, 'abandoned')),
  ]);
  const survival = obs.byType.get('Survival');
  assert.ok(survival);
  assert.equal(survival.runs, 3, 'only the finished runs are timings');
  assert.ok(survival.finished);
  assert.equal(survival.finished.rate, 0.5, 'and half of the DECIDED runs landed');
  assert.equal(survival.finished.decided, 6, 'with all six as the denominator, abandons included');

  /*
   * NULL, NOT ONE, when no run of this type ever stated an outcome. A rate
   * nobody has watched is not a rate of one, and quoting it as certainty is the
   * fabrication this whole module refuses everywhere else.
   */
  const silent = observe([
    { missionTypeName: 'Capture', durationMs: 240_000, endedAt: 0 } as unknown as MissionRecord,
  ]);
  assert.equal(silent.byType.get('Capture')?.finished, null, 'an unstated outcome is not a perfect record');

  /*
   * A PERFECT RECORD IS NOT REPORTED. It multiplies by one, so it changes no
   * figure, and a link saying so in the working of every route would be noise
   * on every card that has one.
   */
  const flawless = observe(Array.from({ length: 5 }, () => ended('Capture', 4, 'success')));
  assert.equal(flawless.byType.get('Capture')?.finished?.rate, 1, 'the measurement is still taken');

  const perfect = chainFor('fissures', flawless, DEFAULT_PREFERENCE, NO_BOOK);
  assert.ok(perfect);
  assert.ok(
    !perfect.chain.links.some((l) => l.label === 'Runs you finish'),
    'a 100 per cent record must not add a link that multiplies by one',
  );
});

check('a failed or abandoned run does not become a fast one', () => {
  const ended = (name: string, minutes: number, outcome: string): MissionRecord =>
    ({ missionTypeName: name, durationMs: minutes * 60_000, endedAt: 0, outcome }) as unknown as MissionRecord;

  const obs = observe([
    ended('Survival', 20, 'success'),
    ended('Survival', 22, 'success'),
    ended('Survival', 4, 'abandoned'),
    ended('Survival', 3, 'failure'),
  ]);
  const survival = obs.byType.get('Survival');
  assert.ok(survival);
  assert.equal(survival.runs, 2, 'only the two runs that finished are timings');
  assert.equal(survival.minutes, 21, 'the median of 20 and 22 - the four-minute abort is not a fast Survival');

  /*
   * AND AN UNKNOWN OUTCOME STILL COUNTS. `outcome` is null when the log did not
   * say, and "we do not know how this ended" is not "this failed" - dropping
   * those would be the same fabrication pointing the other way.
   */
  const unknown = observe([run('Capture', 4), run('Capture', 6)]);
  assert.equal(unknown.byType.get('Capture')?.runs, 2, 'a run with no stated outcome is still a timing');
  assert.equal(unknown.reliability, null, 'and it is not evidence of finishing OR of failing');
});

check('how often this account finishes is measured, with its sample size', () => {
  const ended = (outcome: string): MissionRecord =>
    ({ missionTypeName: 'Capture', durationMs: 60_000, endedAt: 0, outcome }) as unknown as MissionRecord;

  const obs = observe([ended('success'), ended('success'), ended('success'), ended('failure')]);
  assert.ok(obs.reliability);
  assert.equal(obs.reliability.rate, 0.75);
  assert.equal(obs.reliability.runs, 4, 'the denominator is stated, so thin evidence can be said to be thin');

  // Null, never 1: an empty log has not watched this account finish anything,
  // which is a different claim from watching it finish everything.
  assert.equal(observe([]).reliability, null);
  assert.equal(NOTHING_OBSERVED.reliability, null);
});

check('timings are measured from your own runs, never defaulted', () => {
  const obs = observe([run('Capture', 4), run('Capture', 6), run('Capture', 5)]);
  const capture = obs.byType.get('Capture');
  assert.ok(capture, 'Capture should have been observed');
  assert.equal(capture.minutes, 5, 'the MEDIAN of 4, 6 and 5 is 5');
  assert.equal(capture.runs, 3);
  assert.equal(obs.totalRuns, 3);
});

check('the median resists a single runaway run', () => {
  /*
   * The reason this is a median and not a mean: one run left sitting in
   * extraction would drag a mean far enough to make every rate wrong.
   */
  const obs = observe([run('Capture', 4), run('Capture', 5), run('Capture', 6), run('Capture', 400)]);
  const capture = obs.byType.get('Capture');
  assert.ok(capture);
  assert.equal(capture.minutes, 5.5, 'the median of 4,5,6,400 is 5.5 — a mean would be over 100');
});

check('a run with no duration is not counted as a zero-length run', () => {
  const noDuration = { missionTypeName: 'Capture', durationMs: null, endedAt: 0 } as unknown as MissionRecord;
  const obs = observe([run('Capture', 5), noDuration]);
  assert.equal(obs.totalRuns, 1, 'only the run with a real duration counts');
  assert.equal(obs.byType.get('Capture')?.runs, 1);
});

check('with no runs recorded, no route invents a clear speed', () => {
  const rates = rateAll(NOTHING_OBSERVED, DEFAULT_PREFERENCE, NO_BOOK);
  const timed = rates.filter((r) => MODELS[r.routeId]?.timing.kind !== 'noMission');
  assert.ok(timed.length > 0, 'there should be mission-timed routes');
  for (const r of timed) {
    assert.equal(r.perHour, null, `${r.routeId} produced a rate with no runs recorded`);
    assert.equal(r.fromRuns, null, `${r.routeId} claimed to rest on runs that do not exist`);
  }
});

check('the blocked link explains itself in the player\u2019s terms', () => {
  const built = chainFor('fissures', NOTHING_OBSERVED, DEFAULT_PREFERENCE, NO_BOOK);
  assert.ok(built);
  const rate = evaluate(built.chain, built.runs);
  assert.equal(rate.perHour, null);
  assert.match(rate.blockedBy?.note ?? '', /no runs recorded/i, 'the note must say WHY, not just that it failed');
});

check('a chain with every link known multiplies out exactly, and cites the runs', () => {
  const obs = observe([run('Capture', 6), run('Capture', 6)]);
  const book = new Map([['axi_a1_relic', { median: 10, volume: 5 } as never]]);
  const built = chainFor('relic-farm', obs, DEFAULT_PREFERENCE, book);
  assert.ok(built);
  // relic-farm times Defense/Survival/etc, not Capture, so it must refuse.
  assert.equal(evaluate(built.chain, built.runs).perHour, null, 'a route must not borrow another mission type\u2019s timing');

  const obs2 = observe([run('Defense', 6), run('Defense', 6)]);
  const built2 = chainFor('relic-farm', obs2, DEFAULT_PREFERENCE, book);
  assert.ok(built2);
  const rate = evaluate(built2.chain, built2.runs);
  // 60/6 = 10 runs, x1 relic, x10p = 100p an hour.
  assert.equal(rate.perHour, 100, 'the chain must be the plain product of its links');
  assert.equal(rate.fromRuns, 2, 'and must say how many of your runs it rests on');
});

check('a route timed from several mission types uses the BEST-SAMPLED one', () => {
  /*
   * WHAT THIS CAUGHT.
   * `timingLink` picked the first named mission type that had any data at all
   * - `.find((t) => t !== undefined)` - so a model naming Bounty, Survival and
   * Extermination was timed from two Bounty runs while forty Survivals sat
   * unread beside them. The list order decided the answer.
   *
   * `priceLink` in the same file refuses that exact move and says why: "Taking
   * the first would let the order of the list decide the answer, and every list
   * here was written best-first by accident of how it was researched." The
   * reasoning transfers whole and had never been applied to timings.
   *
   * `necramech-mods` names Bounty, Survival, Extermination in that order. The
   * fixture makes the FIRST-listed type the badly-sampled one, so a regression
   * to `.find` fails here rather than passing by luck.
   */
  const book = new Map([['necramech_vitality', { median: 10, volume: 5 } as never]]);
  const obs = observe([
    run('Bounty', 20),
    run('Survival', 5),
    run('Survival', 5),
    run('Survival', 5),
    run('Survival', 5),
  ]);
  const built = chainFor('necramech-mods', obs, DEFAULT_PREFERENCE, book);
  assert.ok(built);
  const rate = evaluate(built.chain, built.runs);
  assert.equal(built.runs, 4, 'the four Survivals are the sample, not the single Bounty');
  // 60/5 = 12 runs an hour x 1 mod x 10p = 120p. Taking Bounty would give 30p.
  assert.equal(rate.perHour, 120, 'the rate must come from the type you have actually run');
});

check('faster play measured produces a higher rate', () => {
  const book = new Map([['axi_a1_relic', { median: 10, volume: 5 } as never]]);
  const fast = evaluate(...(() => {
    const b = chainFor('relic-farm', observe([run('Defense', 3)]), DEFAULT_PREFERENCE, book);
    assert.ok(b);
    return [b.chain, b.runs] as const;
  })());
  const slow = evaluate(...(() => {
    const b = chainFor('relic-farm', observe([run('Defense', 12)]), DEFAULT_PREFERENCE, book);
    assert.ok(b);
    return [b.chain, b.runs] as const;
  })());
  assert.ok(fast.perHour !== null && slow.perHour !== null);
  assert.ok(fast.perHour > slow.perHour, 'clearing faster must produce a higher rate');
});

check('a Riven route can never produce a platinum figure', () => {
  /*
   * The most important refusal in the file. Riven value is set by the roll and
   * no feed publishes it, so no combination of inputs may yield a number.
   */
  const obs = observe([run('Assassination', 5), run('Survival', 5), run('Defense', 5), run('Duviri Endless', 5)]);
  for (const id of ['riven-sortie', 'riven-duviri-endless', 'riven-reroll']) {
    const built = chainFor(id, obs, DEFAULT_PREFERENCE, NO_BOOK);
    assert.ok(built, `${id} should have a model`);
    const rate = evaluate(built.chain, built.runs);
    assert.equal(rate.perHour, null, `${id} produced a riven rate, which cannot be sourced`);
    assert.match(rate.blockedBy?.note ?? '', /roll/i, `${id} must say WHY it cannot be priced`);
  }
});

check('every route is either modelled or has a stated reason, and never both', () => {
  /*
   * The gap this closes: a route with no entry anywhere would be silently
   * missing from the rates, indistinguishable from one that was forgotten.
   */
  for (const route of PLAT_ROUTES) {
    const modelled = MODELS[route.id] !== undefined;
    const explained = MODEL_GAPS[route.id] !== undefined;
    assert.ok(modelled || explained, `${route.id} has neither a throughput model nor a stated reason for having none`);
    assert.ok(!(modelled && explained), `${route.id} is both modelled and excused`);
  }
});

check('every route that pays nothing is excused rather than modelled', () => {
  for (const route of PLAT_ROUTES) {
    if (route.paysNothing === undefined) continue;
    assert.equal(MODELS[route.id], undefined, `${route.id} pays nothing and must not have a rate model`);
    assert.match(MODEL_GAPS[route.id] ?? '', /nothing tradeable/i);
  }
});

/* ------------------------------------------------ the preferences, not data */

/*
 * The rule these pin: a control may hold a CHOICE, never a MEASUREMENT. The
 * squad size, the liquidity floor and the ranking axis all change the ANSWER
 * without touching what was observed; the timing override changes the value in
 * use while leaving the measurement visible beside it.
 */

const OBS = observe([run('Capture', 4), run('Capture', 4), run('Defense', 10)]);
const BOOK = new Map([
  ['axi_a1_relic', { median: 10, volume: 30 } as never],
  ['meso_b1_relic', { median: 10, volume: 30 } as never],
  ['lith_a1_relic', { median: 10, volume: 30 } as never],
  // A high-volume route, so per-hour and per-trade can actually disagree:
  // Capture at 4 minutes is 15 runs an hour x 4 relics = 60 items = 10 trades.
  ['oull', { median: 20, volume: 12 } as never],
  ['xata', { median: 6, volume: 9 } as never],
  ['jahu', { median: 6, volume: 9 } as never],
  ['vome', { median: 5, volume: 9 } as never],
]);

check('the platinum engine never converts a ducat', () => {
  /*
   * The separation this pins. Ducats were once folded into these chains at a
   * rate the player invented, which put a made-up number inside figures built
   * entirely from measurements - in the same column, in the same typeface.
   *
   * Ducats now have their own section and their own units. No chain here may
   * mention them in a way that produces platinum.
   */
  assert.equal(MODELS['ducats'], undefined, 'the ducat route must not be modelled in platinum');
  assert.match(MODEL_GAPS['ducats'] ?? '', /own currency|own loop|Ducats section/i, 'and must say where it went');

  const obs = observe([run('Capture', 5), run('Defense', 10), run('Survival', 20)]);
  for (const r of rateAll(obs, DEFAULT_PREFERENCE, BOOK)) {
    for (const l of r.links) {
      if (l.from !== 'measured' && l.from !== 'yours') continue;
      assert.ok(
        !/ducat/i.test(l.unit),
        `${r.routeId} has a link measured in ducats, which cannot appear in a platinum rate`,
      );
    }
  }
});

check('squad size scales the drops that are per-player, and says so', () => {
  const solo = chainFor('requiem-relics', OBS, { ...DEFAULT_PREFERENCE, squad: 1 }, BOOK);
  const full = chainFor('requiem-relics', OBS, { ...DEFAULT_PREFERENCE, squad: 4 }, BOOK);
  assert.ok(solo && full);
  assert.equal(solo.chain.links[1]?.value, 1, 'alone, one relic opens');
  assert.equal(full.chain.links[1]?.value, 4, 'in a full squad, four do');
  assert.match(full.chain.links[1]?.note ?? '', /4 players/, 'the link must state the squad it assumed');
});

check('the liquidity floor blocks a price it cannot realise, and names the floor', () => {
  const thin = new Map([['axi_a1_relic', { median: 500, volume: 2 } as never]]);
  const built = chainFor('relic-farm', OBS, { ...DEFAULT_PREFERENCE, minVolume: 20 }, thin);
  assert.ok(built);
  const rate = evaluate(built.chain, built.runs, { volume: built.volume ?? undefined });
  assert.equal(rate.perHour, null, 'a 500p item trading twice a day is not 500p of income');
  assert.match(rate.blockedBy?.note ?? '', /below the floor/i);

  const open = chainFor('relic-farm', OBS, { ...DEFAULT_PREFERENCE, minVolume: 0 }, thin);
  assert.ok(open);
  assert.notEqual(evaluate(open.chain, open.runs).perHour, null, 'with no floor the same route computes');
});

check('each ranking axis actually orders by its own measure', () => {
  /*
   * Tested as a property of the sort rather than by hoping the fixture produces
   * a different order: whichever axis is chosen, the list must be descending in
   * THAT axis. Trades are the scarce resource, so per-trade is not a cosmetic
   * alternative to per-hour - it is a different answer to a different question.
   */
  const descending = (values: Array<number | null>): boolean =>
    values.every((v, i) => i === 0 || (values[i - 1] ?? -1) >= (v ?? -1));

  const byHour = rateAll(OBS, { ...DEFAULT_PREFERENCE, sort: 'perHour' }, BOOK);
  assert.ok(descending(byHour.map((r) => r.perHour)), 'the per-hour ranking is not ordered by platinum an hour');

  const byTrade = rateAll(OBS, { ...DEFAULT_PREFERENCE, sort: 'perTrade' }, BOOK);
  assert.ok(descending(byTrade.map((r) => r.perTrade)), 'the per-trade ranking is not ordered by platinum per trade');

  const byVolume = rateAll(OBS, { ...DEFAULT_PREFERENCE, sort: 'liquidity' }, BOOK);
  assert.ok(descending(byVolume.map((r) => r.volume)), 'the liquidity ranking is not ordered by daily trades');

  // And the axes must be capable of disagreeing at all.
  const conflicting = byHour.some((r) => r.perHour !== null && r.perTrade !== null && r.perHour !== r.perTrade);
  assert.ok(conflicting, 'per-hour and per-trade are identical for every route, so one carries no information');
});

check('every rate that has a rate also costs a countable number of trades', () => {
  for (const r of rateAll(OBS, DEFAULT_PREFERENCE, BOOK)) {
    if (r.perHour === null) continue;
    assert.ok(r.tradesPerHour !== null && r.tradesPerHour > 0, `${r.routeId} earns platinum out of no trades at all`);
    assert.ok(r.perTrade !== null, `${r.routeId} has no per-trade figure`);
  }
});

check('an override changes the value in use and never hides the measurement', () => {
  const overridden = chainFor(
    'requiem-relics',
    OBS,
    { ...DEFAULT_PREFERENCE, timingOverride: new Map([['requiem-relics', 2]]) },
    BOOK,
  );
  assert.ok(overridden);
  const link = overridden.chain.links[0];
  assert.ok(link);
  assert.equal(link.value, 30, '2 minutes a run is 30 runs an hour');
  assert.equal(link.from, 'yours', 'an overridden timing must not be presented as measured');
  assert.match(link.note ?? '', /4 minutes/, "the player's own log must stay visible beside their override");
  assert.equal(overridden.overridden, true);
});

check('filters change what is listed, and the count cannot disagree with the rows', () => {
  const all = rateAll(OBS, DEFAULT_PREFERENCE, BOOK);
  const noCapped = rateAll(OBS, { ...DEFAULT_PREFERENCE, includeCapped: false }, BOOK);
  assert.ok(noCapped.length < all.length, 'hiding capped routes removed nothing');
  assert.ok(!noCapped.some((r) => r.cap !== null), 'a capped route survived the filter');

  const noBlocked = rateAll(OBS, { ...DEFAULT_PREFERENCE, includeBlocked: false }, BOOK);
  assert.ok(!noBlocked.some((r) => r.perHour === null), 'a blocked route survived the filter');
});

/* ------------------------------------------------------- standing to plat */

const STANDING_ITEM = '/Lotus/Upgrades/Mods/Warframe/AvatarShockAbsorbersMod';

const offerFixture: readonly Offering[] = [
  { syndicate: 'RedVeilSyndicate', itemType: STANDING_ITEM, standingCost: 25_000, creditsCost: 0, requiredLevel: 3 },
  { syndicate: 'NewLokaSyndicate', itemType: '/Lotus/Not/On/The/Market', standingCost: 5_000, creditsCost: 0, requiredLevel: 0 },
];

const standingCatalog: MarketCatalog = (() => {
  const item = { slug: 'shock_absorbers', name: 'Shock Absorbers', gameRef: STANDING_ITEM } as unknown as MarketItem;
  return {
    byGameRef: new Map([[STANDING_ITEM, item]]),
    bySlug: new Map([['shock_absorbers', item]]),
    all: [item],
    failed: false,
  };
})();

check('an offering that cannot be traded is left out, not priced at zero', () => {
  const out = tradeableOfferings(offerFixture, standingCatalog, null);
  assert.equal(out.length, 1, 'only the market-joinable offering may survive');
  assert.equal(out[0]?.name, 'Shock Absorbers');
});

check('standing value is platinum per THOUSAND standing', () => {
  const joined = tradeableOfferings(offerFixture, standingCatalog, null);
  const priced = priceOfferings(joined, new Map([['shock_absorbers', { median: 50, volume: 9 } as never]]));
  // 50p for 25,000 standing = 2p per thousand.
  assert.equal(priced[0]?.platPerK, 2, 'the ratio must be per thousand standing');
});

check('rank gating is stated, never guessed, and never hides the offering', () => {
  const unknownRank = tradeableOfferings(offerFixture, standingCatalog, null);
  assert.equal(unknownRank[0]?.reachable, null, 'with no account, reachability is unknown and not false');

  const tooLow = tradeableOfferings(offerFixture, standingCatalog, new Map([['RedVeilSyndicate', 1]]));
  assert.equal(tooLow[0]?.reachable, false, 'rank 1 cannot buy a rank 3 offering');
  assert.equal(tooLow.length, 1, 'an unreachable offering is still listed, with its requirement shown');

  const enough = tradeableOfferings(offerFixture, standingCatalog, new Map([['RedVeilSyndicate', 3]]));
  assert.equal(enough[0]?.reachable, true);
});

check('unpriced offerings sort last rather than being dropped', () => {
  const joined = tradeableOfferings(offerFixture, standingCatalog, null);
  const ranked = bestUseOfStanding(joined);
  assert.equal(ranked.length, joined.length, 'nothing may vanish from the ranking for being unpriced');
  assert.equal(ranked[ranked.length - 1]?.platPerK, null);
});

check('a ducat route never appears in a platinum ranking', () => {
  /*
   * The complaint this closes: the platinum panel’s headline answer was "go and
   * get a different currency". Ducats have their own section, in their own
   * units; a route that pays them is not an answer to "how do I earn platinum".
   */
  const ducatRoutes = PLAT_ROUTES.filter((r) => r.paysDucats === true);
  assert.ok(ducatRoutes.length > 0, 'the ducat route should still exist, just not here');

  for (const prefs of [DEFAULT_PREFS, { ...DEFAULT_PREFS, includeLocked: true }]) {
    const ranked = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, prefs, null);
    for (const r of ducatRoutes) {
      assert.ok(!ranked.some((x) => x.state.route.id === r.id), `${r.id} pays ducats and must not be ranked for platinum`);
    }
  }

  // And the recommendation, which is what the player actually reads first.
  const best = bestNow(rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, DEFAULT_PREFS, null));
  if (best) assert.notEqual(best.state.route.paysDucats, true, 'the headline recommendation pays ducats, not platinum');
});

/* ------------------------------------------------------------ today’s plan */

const hold = (name: string, count: number, median: number | null): Holding => ({
  gameRef: '/x/' + name, name, slug: name, count,
  price: median === null ? null : ({ median, volume: 40 } as never),
  worth: median === null ? null : median * count,
  ducats: null, ducatWorth: null,
});

check('the plan never spends more trades than you have', () => {
  const stock = [hold('a', 1, 50), hold('b', 1, 40), hold('c', 1, 30), hold('d', 1, 20)];
  for (const budget of [1, 2, 3, 10]) {
    const plan = planToday(stock, [], budget);
    assert.ok(plan.tradesUsed <= budget, `plan spent ${String(plan.tradesUsed)} of ${String(budget)} trades`);
  }
});

check('the plan is ordered by platinum per trade, not by platinum', () => {
  /*
   * The whole point. A 90p stack costing seven trades is worse than a 40p item
   * costing one, and ranking by raw value would get that exactly backwards.
   */
  const big = hold('big stack', 40, 3);   // 120p over 7 trades = ~17p/trade
  const small = hold('one good part', 1, 40); // 40p over 1 trade = 40p/trade
  const plan = planToday([big, small], [], 10);
  assert.equal(plan.actions[0]?.what, 'Sell one good part', 'the denser action must come first');
});

check('an unpriced holding never enters the plan', () => {
  const plan = planToday([hold('unknown', 5, null), hold('known', 1, 10)], [], 10);
  assert.equal(plan.actions.length, 1, 'only the priced item may be planned');
  assert.ok(!plan.actions.some((a) => a.what.includes('unknown')), 'an unpriced item was planned anyway');
});

check('with no trade count there is no plan, rather than an assumed one', () => {
  const plan = planToday([hold('a', 1, 50)], [], null);
  assert.equal(plan.actions.length, 0);
  /*
   * And it must not blame the PRICES for that. `nothingPriced` names one
   * reason an empty plan is empty - the quotes have not arrived - and the
   * surface above turns it into "nothing you hold has a price yet". Returning
   * it for a missing trade count told a player whose stock was fully priced
   * exactly the wrong thing about their own panel.
   */
  assert.equal(plan.nothingPriced, false, 'a missing trade count is not a pricing problem');
});

check('spent trades still leave the evening plannable', () => {
  /*
   * Time and trades are independent budgets everywhere else in this file, and
   * then a zero trade count returned EMPTY and threw the mission away with it.
   * A player who has spent today's trades and has three hours free is not out
   * of things to do.
   */
  const plan = planToday([hold('a', 1, 50)], [], 0, 60, [runnable('fissures', 'Fissures', 300)]);
  assert.equal(plan.tradesUsed, 0, 'no trades may be spent when none are left');
  assert.ok(!plan.actions.some((a) => a.kind === 'sell'), 'a sale cannot happen without a trade');
  const run = plan.actions.find((a) => a.kind === 'run');
  assert.ok(run, 'the hours are still free, so the mission is still worth planning');
  assert.equal(plan.minutesUsed, 60);
});

check('a completion that cannot be afforded gives its parts back', () => {
  /*
   * Parts are marked consumed as candidates are built, so nothing is planned
   * twice - but the budget test comes later, and a completion rejected for cost
   * used to keep holding its parts. The sale that WOULD have fit disappeared
   * from the plan and from the count of what was left out: nothing on screen
   * said it had ever been considered.
   */
  const blade = hold('nikana_prime_blade', 1, 40);
  const verdict = {
    setSlug: 'nikana_prime_set',
    name: 'Nikana Prime Set',
    parts: ['nikana_prime_blade', 'nikana_prime_hilt', 'nikana_prime_blueprint', 'nikana_prime_handle'],
    held: ['nikana_prime_blade'],
    missing: ['nikana_prime_hilt', 'nikana_prime_blueprint', 'nikana_prime_handle'],
    setPrice: null,
    costs: new Map(),
    toBuy: 20,
    margin: 60,
    trades: 4,
    perTrade: 15,
  } as unknown as Parameters<typeof planToday>[1][number];

  const plan = planToday([blade], [verdict], 1);
  assert.ok(!plan.actions.some((a) => a.kind === 'complete'), 'four trades cannot fit in a budget of one');
  const sale = plan.actions.find((a) => a.ref === 'sell:nikana_prime_blade');
  assert.ok(sale, 'the part it was holding must come back as something you can sell');
  assert.equal(sale.plat, 40);
});

check('a set completion consumes its parts so nothing is counted twice', () => {
  /*
   * Telling somebody to sell the Nikana blade AND to complete the Nikana set is
   * planning the same item twice, and the total would be a lie.
   */
  const verdict = {
    setSlug: 'nikana_prime_set', name: 'Nikana Prime Set',
    parts: ['nikana_prime_blade', 'nikana_prime_hilt', 'nikana_prime_blueprint'],
    held: ['nikana_prime_blade', 'nikana_prime_hilt'], missing: ['nikana_prime_blueprint'],
    setPrice: { median: 67, volume: 21 } as never, costs: new Map(),
    toBuy: 5, margin: 62, trades: 2, perTrade: 31,
  } as unknown as SetVerdict;

  const stock = [hold('nikana_prime_blade', 1, 15), hold('nikana_prime_hilt', 1, 38)];
  const plan = planToday(stock, [verdict], 10);

  assert.ok(plan.actions.some((a) => a.kind === 'complete'), 'the completion should be planned');
  assert.ok(!plan.actions.some((a) => a.what.includes('nikana_prime_blade')), 'a consumed part was also planned as a sale');
  assert.ok(!plan.actions.some((a) => a.what.includes('nikana_prime_hilt')), 'a consumed part was also planned as a sale');
});

check('a losing completion is never planned', () => {
  const bad = { setSlug: 's', name: 'Bad Set', parts: ['a','b','c'], held: ['a'], missing: ['b'],
    setPrice: { median: 10, volume: 5 } as never, costs: new Map(),
    toBuy: 40, margin: -30, trades: 2, perTrade: -15 } as unknown as SetVerdict;
  const plan = planToday([], [bad], 10);
  assert.equal(plan.actions.length, 0, 'a completion that loses platinum must not be advised');
});

check('what did not fit is counted, never silently dropped', () => {
  const stock = [hold('a', 1, 50), hold('b', 1, 40), hold('c', 1, 30)];
  const plan = planToday(stock, [], 1);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.leftOut, 2, 'the plan must say how much it had to leave behind');
});

/** A runnable route with nothing measured about it beyond the rate. */
function runnable(routeId: string, name: string, perHour: number) {
  return { routeId, name, perHour, cap: null, where: null, minutesPerRun: null, runsTimed: null, liveNow: false, hasWindow: false };
}

check('every live signal a route can declare is one the panel can actually raise', () => {
  /*
   * `LiveSignal` had nine members and the panel only ever added eight. The two
   * routes declaring `live: 'duviri'` therefore took the ranker's "its window
   * is closed" penalty for ever, whatever the world was doing - a route pushed
   * down the list permanently by a signal nobody raised, and invisible because
   * a closed window is a perfectly ordinary thing for a route to have.
   *
   * This reads the panel's own source rather than calling it, because the
   * function needs a live worldstate to exercise. What it proves is narrow and
   * exactly the thing that broke: every signal a route can name appears
   * somewhere in the function that builds the set.
   */
  const src = readFileSync(new URL('../src/panels/platinum/PlatinumPanel.tsx', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function liveSignals'), src.indexOf('/* ------------------------------------------------------------------ controls'));
  assert.ok(body.length > 200, 'liveSignals should have been found');

  const declared = new Set(PLAT_ROUTES.map((r) => r.live).filter((s): s is NonNullable<typeof s> => s !== null));
  assert.ok(declared.size > 0, 'some route should declare a live signal');
  /*
   * Matched as a `set.add(...)` CALL, not as the bare word.
   *
   * A first draft looked for the string anywhere in the function, which a
   * commented-out line satisfies perfectly - the gate passed on exactly the
   * defect it was written to catch. What has to be true is that the signal is
   * ADDED, so that is what is matched.
   */
  for (const signal of declared) {
    const call = new RegExp(String.raw`(?<!//\s{0,40})set\.add\('${signal}'\)`);
    assert.ok(call.test(body), `no route may depend on a signal the panel never raises: ${signal}`);
  }
});

check('the trades come before the mission, because a sale needs an answer', () => {
  /*
   * ORDER IS ADVICE HERE, NOT LAYOUT.
   *
   * A sale needs another player to read the listing and whisper you, which
   * happens on their schedule. Posting first means those replies arrive while
   * you are in a mission. Running first leaves every sale queued behind the
   * whole session, which is how an evening earns nothing until the end of it.
   *
   * The run action used to be spread in at the FRONT, purely because it was
   * built first. This gate exists so that cannot come back by accident.
   */
  const plan = planToday([hold('a', 1, 50)], [], 9, 60, [runnable('fissures', 'Fissures', 300)]);
  const kinds = plan.actions.map((a) => a.kind);
  assert.ok(kinds.includes('run'), 'the fixture should produce a run action');
  assert.equal(kinds[kinds.length - 1], 'run', 'the mission must come after the trades, never before');
  assert.ok(kinds.indexOf('sell') < kinds.indexOf('run'), 'a sale must be posted before the session starts');
});

check('reordering the plan did not lose the run from its own total', () => {
  /*
   * The run action is appended after the greedy trade fill now. Its platinum
   * has to survive that: a total that silently dropped the biggest single item
   * would understate the day and nobody would notice, because the list still
   * looks right.
   */
  const plan = planToday([hold('a', 1, 50)], [], 9, 60, [runnable('fissures', 'Fissures', 300)]);
  const summed = plan.actions.reduce((n, a) => n + a.plat, 0);
  assert.equal(plan.platTotal, summed, 'the stated total must equal the actions it lists');
  assert.equal(plan.minutesUsed, 60, 'the session still has to be counted');
});

check('every step carries a stable reference, and no two collide', () => {
  /*
   * The reference is what a ticked-off step is remembered by. Two steps sharing
   * one would tick each other off; a reference built from position would move
   * to a different action the moment a price landed and reordered the list.
   */
  const plan = planToday(
    [hold('a', 1, 50), hold('b', 1, 40)],
    [],
    9,
    60,
    [runnable('fissures', 'Fissures', 300)],
  );
  const refs = plan.actions.map((a) => a.ref);
  assert.equal(new Set(refs).size, refs.length, 'two actions shared a reference');
  for (const ref of refs) {
    assert.ok(/^(sell|complete|run):.+/.test(ref), `a reference must name its kind and its subject: ${ref}`);
  }
});

check('a message meant for trade chat asks for a whole number', () => {
  /*
   * Medians are frequently halves. Nobody has ever typed "29.5p" into trade
   * chat, and a line the player has to edit before sending is a line that has
   * not removed the work it exists to remove. The exact median stays on the row.
   */
  const plan = planToday([hold('a', 2, 29.5)], [], 9, null, []);
  const sale = plan.actions.find((a) => a.kind === 'sell');
  assert.ok(sale?.say, 'a sale should carry the line to send');
  const price = /(\d+(?:\.\d+)?)p/.exec(sale.say ?? '');
  assert.ok(price, 'the message should quote a price');
  assert.ok(!(price[1] ?? '').includes('.'), `a listing must be a whole number, got ${String(price[1])}`);
});

check('a run step says where to go, and never dresses the table up as observation', () => {
  /*
   * "Run Void Fissures for forty minutes" is a topic, not an instruction, so a
   * run step carries a location. It carries where that location CAME FROM too,
   * and for good reason: an earlier version named the node this account ran
   * most of the route's mission types on and captioned it "where you usually
   * run it". Nothing in a mission record says whether a run was a fissure, so a
   * player who farms Adaro for focus was told the fissure node was Adaro.
   *
   * The location is the route table's own words, and it must say so.
   */
  const route = { ...runnable('fissures', 'Fissures', 300), where: 'Any Void Fissure node' };
  const a = planToday([], [], 9, 60, [route]).actions.find((x) => x.kind === 'run');
  assert.equal(a?.where, 'Any Void Fissure node');
  assert.equal(a?.whereFrom, 'route', 'a table location must never pass as a personal observation');

  const nowhere = planToday([], [], 9, 60, [runnable('fissures', 'Fissures', 300)]).actions.find((x) => x.kind === 'run');
  assert.equal(nowhere?.where, null);
  assert.equal(nowhere?.whereFrom, null, 'no location is a real answer, and not an empty string');
});

check('a run step is named, never a sentence with a number glued on', () => {
  /*
   * Route names are sentences - "Prime junk into ducats, ducats into Baro" -
   * and appending a repeat count produced "...into Baro 12 times" in the
   * largest type on the panel. The count is a fact about the step and travels
   * beside it.
   */
  const route = { ...runnable('r', 'Prime junk into ducats, ducats into Baro', 300), minutesPerRun: 5 };
  const a = planToday([], [], 9, 60, [route]).actions.find((x) => x.kind === 'run');
  assert.equal(a?.what, 'Run Prime junk into ducats, ducats into Baro');
  assert.equal(a?.runs, 12, 'twelve five-minute runs fit in an hour');
});

check('time and trades are separate budgets, never converted', () => {
  /*
   * There is no honest exchange rate between an hour and a trade, so the plan
   * fills the two independently. A run action costs minutes and no trades; a
   * sale costs a trade and no minutes.
   */
  const routes = [runnable('fissures', 'Run Void Fissures', 300)];
  const plan = planToday([hold('a', 1, 50)], [], 9, 60, routes);

  const run = plan.actions.find((a) => a.kind === 'run');
  assert.ok(run, 'an hour available and a measured route should produce a run action');
  assert.equal(run.trades, 0, 'running costs time, never a trade');
  assert.equal(run.plat, 300, '300p an hour for sixty minutes');
  assert.equal(plan.minutesUsed, 60);

  const sale = plan.actions.find((a) => a.kind === 'sell');
  assert.ok(sale);
  assert.equal(sale.minutes, 0, 'selling costs a trade, never time');
  assert.equal(plan.tradesUsed, 1);
});

check('a timer-capped route is never planned as an hour of play', () => {
  /*
   * A rate of 900 an hour from something you may run once a week is a rate, not
   * a plan - you cannot spend an hour on it.
   */
  const capped = [{ ...runnable('kahl-mods', 'Kahl mods', 900), cap: 'Once a week' }];
  const plan = planToday([], [], 9, 60, capped);
  assert.ok(!plan.actions.some((a) => a.kind === 'run'), 'a capped route was planned as sustained play');
});

check('with no session length stated, no time is planned', () => {
  const routes = [runnable('fissures', 'Run Void Fissures', 300)];
  const plan = planToday([hold('a', 1, 50)], [], 9, null, routes);
  assert.equal(plan.minutesUsed, 0, 'declining to say how long you have must not assume an evening');
  assert.ok(!plan.actions.some((a) => a.kind === 'run'));
});

/* ------------------------------------------------------- can you do it */

const withMech = { MechSuits: [{ ItemType: '/Lotus/Powersuits/EntratiMech/NechroTech' }] } as unknown as RawAccount;
const noMech = { MechSuits: [] } as unknown as RawAccount;
/*
 * REAL amp paths, and real modular structure.
 *
 * These fixtures used `/Lotus/Weapons/Operator/Pistols/MoteAmp/MoteAmpPistol`
 * and `.../AmpPrismB/AmpPrismB` - neither of which exists. Amps live under
 * `/OperatorAmplifiers/`, and the starter's three components sit under
 * `SentTrainingAmplifier`, with no "MoteAmp" anywhere. The old fixtures
 * invented the paths the old regex expected, so test and code were wrong
 * together and agreed, and every player who had finished Vox Solaris was
 * reported ready for Eidolons.
 *
 * An amp is MODULAR, so the identity lives in `ModularParts`, not `ItemType`.
 */
const moteOnly = {
  OperatorAmps: [
    {
      ItemType: '/Lotus/Weapons/Sentients/OperatorAmplifiers/SentTrainingAmplifier/SentAmpTrainingBarrel',
      ModularParts: [
        '/Lotus/Weapons/Sentients/OperatorAmplifiers/SentTrainingAmplifier/SentAmpTrainingBarrel',
        '/Lotus/Weapons/Sentients/OperatorAmplifiers/SentTrainingAmplifier/SentAmpTrainingChassis',
        '/Lotus/Weapons/Sentients/OperatorAmplifiers/SentTrainingAmplifier/SentAmpTrainingGrip',
      ],
    },
  ],
} as unknown as RawAccount;

const realAmp = {
  OperatorAmps: [
    {
      ItemType: '/Lotus/Weapons/Corpus/OperatorAmplifiers/Set1/Barrel/CorpAmpSet1BarrelPartA',
      ModularParts: [
        '/Lotus/Weapons/Corpus/OperatorAmplifiers/Set1/Barrel/CorpAmpSet1BarrelPartA',
        '/Lotus/Weapons/Corpus/OperatorAmplifiers/Set1/Chassis/CorpAmpSet1ChassisPartA',
        '/Lotus/Weapons/Sentients/OperatorAmplifiers/Set1/Grip/SentAmpSet1GripPartB',
      ],
    },
  ],
} as unknown as RawAccount;

check('owning what a route needs is read from the account, not guessed', () => {
  assert.equal(owns(withMech, 'necramech'), true);
  assert.equal(owns(noMech, 'necramech'), false, 'an empty array is a fact: you do not have one');
  assert.equal(owns(null, 'necramech'), null, 'no account means unknown, never false');
  assert.equal(owns({} as unknown as RawAccount, 'necramech'), null, 'a missing array is unread, not empty');
});

check('the starter Mote Amp does not count as an Amp', () => {
  /*
   * Every player is handed one during Vox Solaris, so counting it would turn
   * "do you have an Amp" into "have you done the intro quest" - a different and
   * far less useful question, and one that would send somebody to an Eidolon
   * with a weapon that cannot break its shields.
   */
  assert.equal(owns(moteOnly, 'amp'), false, 'the Mote Amp is not an Eidolon Amp');
  assert.equal(owns(realAmp, 'amp'), true);

  /*
   * The row's own `ItemType` says nothing here - only the parts do. An amp
   * whose ItemType looks ordinary but is built from training components is
   * still the starter, and a check reading ItemType alone waves it through.
   */
  const disguised = {
    OperatorAmps: [
      {
        ItemType: '/Lotus/Weapons/Corpus/OperatorAmplifiers/Set1/Barrel/CorpAmpSet1BarrelPartA',
        ModularParts: ['/Lotus/Weapons/Sentients/OperatorAmplifiers/SentTrainingAmplifier/SentAmpTrainingGrip'],
      },
    ],
  } as unknown as RawAccount;
  assert.equal(owns(disguised, 'amp'), false, 'a training component makes it the starter whatever the ItemType says');
});

check('a route you cannot equip for is pushed down and says why', () => {
  const has = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, { ...DEFAULT_PREFS, includeLocked: true }, withMech);
  const hasnt = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, { ...DEFAULT_PREFS, includeLocked: true }, noMech);

  const a = has.find((r) => r.state.route.id === 'necramech-mods');
  const b = hasnt.find((r) => r.state.route.id === 'necramech-mods');
  assert.ok(a && b);
  assert.ok(b.score < a.score, 'owning no Necramech did not push the Necramech route down');
  assert.match(b.cannot ?? '', /Necramech/i, 'and it must say which thing is missing');
  assert.ok(b.reasons.some((x) => /do not own/i.test(x.label)), 'the audit trail must carry the reason');
});

check('an unread account is never told it lacks something', () => {
  const ranked = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, { ...DEFAULT_PREFS, includeLocked: true }, null);
  for (const r of ranked) {
    assert.ok(
      !r.gear.some((g) => g.met === false),
      `${r.state.route.id} claimed the player lacks gear on an account that was never read`,
    );
  }
});

check('every gear requirement names something the account can actually prove', () => {
  /*
   * A requirement the inventory cannot verify belongs in `alsoNeeds` prose, not
   * here. This catches somebody adding "needs a good build" as a checkable fact.
   */
  // Everything the account can actually settle. `steelpath` and `lich` are not
  // equipment but are proved just as firmly - a Tier completion and a Nemesis
  // object respectively.
  const knowable = ['amp', 'necramech', 'railjack', 'archwing', 'companion', 'kdrive', 'steelpath', 'lich'];
  for (const route of PLAT_ROUTES) {
    for (const need of route.needsGear ?? []) {
      assert.ok(knowable.includes(need), `${route.id} needs "${need}", which nothing in the account proves`);
    }
  }
});

/*
 * REAL paths, and that is the entire point of this fixture.
 *
 * The previous version of this check used `/Lotus/Powersuits/Nekros/Nekros`,
 * which is not a path that exists in the game. Nekros is
 * `/Lotus/Powersuits/Necro/Necro` - BOTH segments are an internal codename, and
 * only the Prime carries the real name. The test invented data that matched the
 * implementation's assumption, so both were wrong together and agreed with each
 * other, which is how the bug survived: `ownsFrame('Nekros')` returned false for
 * every real account, and the route told players holding Nekros that Nekros
 * would double their drops.
 *
 * Hydroid (`/Pirate/`) and Ivara (`/Ranger/`) are here because they are the
 * other two recommended frames whose folder is not their name.
 */
const FRAME_DB = {
  byType: new Map([
    ['/Lotus/Powersuits/Necro/Necro', { uniqueName: '/Lotus/Powersuits/Necro/Necro', name: 'Nekros' }],
    ['/Lotus/Powersuits/Necro/NekrosPrime', { uniqueName: '/Lotus/Powersuits/Necro/NekrosPrime', name: 'Nekros Prime' }],
    ['/Lotus/Powersuits/Pirate/Pirate', { uniqueName: '/Lotus/Powersuits/Pirate/Pirate', name: 'Hydroid' }],
    ['/Lotus/Powersuits/Ranger/Ranger', { uniqueName: '/Lotus/Powersuits/Ranger/Ranger', name: 'Ivara' }],
    ['/Lotus/Powersuits/Mag/Mag', { uniqueName: '/Lotus/Powersuits/Mag/Mag', name: 'Mag' }],
  ]),
} as unknown as ItemDb;

check('a frame is found under its INTERNAL codename, not its display name', () => {
  const nekros = { Suits: [{ ItemType: '/Lotus/Powersuits/Necro/Necro' }] } as unknown as RawAccount;
  const hydroid = { Suits: [{ ItemType: '/Lotus/Powersuits/Pirate/Pirate' }] } as unknown as RawAccount;
  const ivara = { Suits: [{ ItemType: '/Lotus/Powersuits/Ranger/Ranger' }] } as unknown as RawAccount;
  assert.equal(ownsFrame(nekros, 'Nekros', FRAME_DB), true, 'Nekros lives under /Necro/');
  assert.equal(ownsFrame(hydroid, 'Hydroid', FRAME_DB), true, 'Hydroid lives under /Pirate/');
  assert.equal(ownsFrame(ivara, 'Ivara', FRAME_DB), true, 'Ivara lives under /Ranger/');
});

check('a Prime counts as the frame it is', () => {
  // Telling somebody they lack Nekros while they hold Nekros Prime is absurd.
  const prime = { Suits: [{ ItemType: '/Lotus/Powersuits/Necro/NekrosPrime' }] } as unknown as RawAccount;
  const other = { Suits: [{ ItemType: '/Lotus/Powersuits/Mag/Mag' }] } as unknown as RawAccount;
  assert.equal(ownsFrame(prime, 'Nekros', FRAME_DB), true, 'Nekros Prime is Nekros');
  assert.equal(ownsFrame(other, 'Nekros', FRAME_DB), false, 'and Mag is not');
  assert.equal(ownsFrame(null, 'Nekros', FRAME_DB), null, 'no account means unknown');
});

check('without the catalog, owning a frame is unknown rather than denied', () => {
  const nekros = { Suits: [{ ItemType: '/Lotus/Powersuits/Necro/Necro' }] } as unknown as RawAccount;
  /*
   * The path alone cannot answer this, so the honest reply while the catalog
   * loads is nothing at all. Returning false would put "Nekros would double
   * your drops" in front of somebody holding Nekros - the original bug, dressed
   * as a loading state.
   */
  assert.equal(ownsFrame(nekros, 'Nekros', null), null);
});

check('a frame this app recommends but the catalog does not know is not a denial', () => {
  const nekros = { Suits: [{ ItemType: '/Lotus/Powersuits/Necro/Necro' }] } as unknown as RawAccount;
  // A typo in OUR table is our fault, and must not read as a fact about them.
  assert.equal(ownsFrame(nekros, 'Nekross', FRAME_DB), null);
});

check('the loadout line names a frame you own before one you do not', () => {
  const nekros = { Suits: [{ ItemType: '/Lotus/Powersuits/Necro/NekrosPrime' }] } as unknown as RawAccount;
  const ranked = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, DEFAULT_PREFS, nekros, undefined, FRAME_DB);
  const fissures = ranked.find((r) => r.state.route.id === 'fissures');
  assert.ok(fissures);
  assert.ok(fissures.loadout, 'fissures should suggest a frame');
  assert.equal(fissures.loadout.owned, true);
  assert.match(fissures.loadout.text, /^Bring Nekros/, 'it must name the one you actually have');

  const none = { Suits: [] } as unknown as RawAccount;
  const without = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, DEFAULT_PREFS, none, undefined, FRAME_DB).find(
    (r) => r.state.route.id === 'fissures',
  );
  assert.ok(without?.loadout);
  assert.equal(without.loadout.owned, false);
  assert.match(without.loadout.text, /would help here/, 'and say so plainly when you do not');
});

check('owning the right frame helps a route but never carries it', () => {
  const nekros = { Suits: [{ ItemType: '/Lotus/Powersuits/Necro/Necro' }] } as unknown as RawAccount;
  const none = { Suits: [] } as unknown as RawAccount;
  const find = (acc: RawAccount) =>
    rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, DEFAULT_PREFS, acc, undefined, FRAME_DB).find(
      (r) => r.state.route.id === 'fissures',
    );
  const a = find(nekros);
  const b = find(none);
  assert.ok(a && b);
  assert.ok(a.score > b.score, 'owning Nekros should help');
  assert.ok(a.score - b.score <= 3, 'but a loadout is a multiplier on a choice, not a reason to make one');
});

check('Steel Path access is proved by having cleared it, not by owning a thing', () => {
  const done = { Missions: [{ Tag: 'SolNode1', Completes: 3, Tier: 1 }] } as unknown as RawAccount;
  const normalOnly = { Missions: [{ Tag: 'SolNode1', Completes: 3 }] } as unknown as RawAccount;
  assert.equal(owns(done, 'steelpath'), true, 'a Tier completion is Steel Path');
  assert.equal(owns(normalOnly, 'steelpath'), false, 'ordinary clears are not Steel Path');
  assert.equal(owns({} as unknown as RawAccount, 'steelpath'), null, 'no Missions array is unread, not locked');
});

check('an active Lich is a presence check, and absent is a real answer', () => {
  const hasLich = { Nemesis: { Weapon: 'x' } } as unknown as RawAccount;
  const none = { Suits: [] } as unknown as RawAccount;
  assert.equal(owns(hasLich, 'lich'), true);
  assert.equal(owns(none, 'lich'), false, 'most players have none at any moment, and that is a fact');
  assert.equal(owns(null, 'lich'), null);
});

check('the nemesis routes are gated on actually having one', () => {
  const none = { Suits: [], Missions: [] } as unknown as RawAccount;
  const ranked = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, { ...DEFAULT_PREFS, includeLocked: true }, none);
  for (const id of ['lich-weapons', 'sister-weapons']) {
    const r = ranked.find((x) => x.state.route.id === id);
    assert.ok(r, id + ' should be ranked');
    assert.match(r.cannot ?? '', /Lich|Sister/i, id + ' must say you have no nemesis');
  }
});

/* ------------------------------------------------------- can your mods do it */

const VITALITY = KEY_MODS['vitality'];

check('a ranked mod and an unranked one are different facts', () => {
  /*
   * DE stores them in different arrays for exactly this reason: `RawUpgrades`
   * is the stacked unranked pile, `Upgrades` is individually tracked because it
   * has a rank. An unranked Blind Rage does nothing for a build that needs it
   * near maximum, so "owned" alone would be a misleading answer.
   */
  assert.ok(VITALITY);
  const unranked = { RawUpgrades: [{ ItemType: VITALITY.path, ItemCount: 1 }] } as unknown as RawAccount;
  const maxed = {
    Upgrades: [{ ItemType: VITALITY.path, UpgradeFingerprint: JSON.stringify({ lvl: 10 }) }],
  } as unknown as RawAccount;

  assert.deepEqual(
    { owned: modState(unranked, VITALITY).owned, rank: modState(unranked, VITALITY).rank },
    { owned: true, rank: 0 },
    'a copy in RawUpgrades is owned and unranked',
  );
  assert.equal(modState(maxed, VITALITY).rank, 10, 'the rank comes out of the fingerprint');
});

check('a mod you do not have is false, and an unread account is null', () => {
  assert.ok(VITALITY);
  const empty = { RawUpgrades: [], Upgrades: [] } as unknown as RawAccount;
  assert.equal(modState(empty, VITALITY).owned, false);
  assert.equal(modState({} as unknown as RawAccount, VITALITY).owned, null, 'neither array present is unread');
  assert.equal(modState(null, VITALITY).owned, null);
});

check('a corrupt fingerprint yields rank zero rather than throwing', () => {
  assert.ok(VITALITY);
  const junk = { Upgrades: [{ ItemType: VITALITY.path, UpgradeFingerprint: 'not json at all' }] } as unknown as RawAccount;
  assert.equal(modState(junk, VITALITY).rank, 0, 'a rank we cannot read is zero, not a crash');
});

check('missing mods push a demanding route down, but less than missing gear', () => {
  const none = { RawUpgrades: [], Upgrades: [], Suits: [], MechSuits: [], Missions: [] } as unknown as RawAccount;
  const ranked = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, { ...DEFAULT_PREFS, includeLocked: true }, none);

  const eido = ranked.find((r) => r.state.route.id === 'eidolon');
  assert.ok(eido);
  assert.equal(eido.buildShort, true, 'owning none of the mods should register');
  assert.match(eido.build ?? '', /do not own/i);

  // Mods can be farmed in an evening; a Necramech cannot. The penalties reflect
  // that, and this pins the ordering rather than the exact numbers.
  const modTerm = eido.reasons.find((x) => /missing mods|do not own .*which this build/i.test(x.label));
  const gearRoute = ranked.find((r) => r.state.route.id === 'necramech-mods');
  const gearTerm = gearRoute?.reasons.find((x) => /do not own a Necramech/i.test(x.label));
  assert.ok(modTerm && gearTerm);
  assert.ok(Math.abs(gearTerm.delta) > Math.abs(modTerm.delta), 'missing gear must outweigh missing mods');
});

check('half-ranked is usable, and is not reported as missing', () => {
  assert.ok(VITALITY);
  const half = {
    RawUpgrades: [],
    Upgrades: [{ ItemType: VITALITY.path, UpgradeFingerprint: JSON.stringify({ lvl: 6 }) }],
  } as unknown as RawAccount;
  const r = readiness(half, ['vitality']);
  assert.equal(r.ready, true, 'a rank-6 Vitality is a real mod, not a gap');
  assert.equal(r.underRanked.length, 0, 'past halfway is not under-ranked');
});

check('a syndicate rank can be negative, and unjoined is neutral not unknown', () => {
  /*
   * `Title` goes below zero for a syndicate you have wronged, so a naive
   * "at least N" test must not read -1 as unset. And a faction absent from the
   * array is one you have not joined - rank 0 - which is a real answer.
   */
  const hostile = { Affiliations: [{ Tag: 'ZarimanSyndicate', Title: -1 }] } as unknown as RawAccount;
  const good = { Affiliations: [{ Tag: 'ZarimanSyndicate', Title: 4 }] } as unknown as RawAccount;
  const unjoined = { Affiliations: [] } as unknown as RawAccount;

  assert.equal(syndicateRank(hostile, 'ZarimanSyndicate'), -1);
  assert.equal(syndicateRank(good, 'ZarimanSyndicate'), 4);
  assert.equal(syndicateRank(unjoined, 'ZarimanSyndicate'), 0, 'not joined is neutral');
  assert.equal(syndicateRank({} as unknown as RawAccount, 'ZarimanSyndicate'), null, 'no array is unread');
});

check('Intrinsics are the weaker of piloting and gunnery', () => {
  /* A Railjack run is only as good as its weaker half. */
  const acc = { PlayerSkills: { LPS_PILOTING: 8, LPS_GUNNERY: 3 } } as unknown as RawAccount;
  assert.equal(intrinsics(acc).effective, 3);
  assert.equal(intrinsics({ PlayerSkills: {} } as unknown as RawAccount).effective, null, 'absent is unknown');
  assert.equal(intrinsics(null).effective, null);
});

check('a rank you have not reached is stated, and costs more than thin mods', () => {
  const low = { Affiliations: [{ Tag: 'ZarimanSyndicate', Title: 1 }] } as unknown as RawAccount;
  const ranked = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, { ...DEFAULT_PREFS, includeLocked: true }, low);
  const r = ranked.find((x) => x.state.route.id === 'holdfasts-arcanes');
  assert.ok(r);
  assert.match(r.shortOf ?? '', /rank 1 with The Holdfasts/i, 'it must name the rank you actually hold');

  const term = r.reasons.find((x) => /rank 1 with/i.test(x.label));
  assert.ok(term && term.delta < 0, 'and it must count against the route');
});

check('meeting the rank says nothing at all', () => {
  const high = { Affiliations: [{ Tag: 'ZarimanSyndicate', Title: 5 }] } as unknown as RawAccount;
  const r = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, { ...DEFAULT_PREFS, includeLocked: true }, high)
    .find((x) => x.state.route.id === 'holdfasts-arcanes');
  assert.ok(r);
  assert.equal(r.shortOf, null, 'a satisfied gate is silence, not a badge');
});

/* ------------------------------------------------------------- invasions */

const invCatalog: MarketCatalog = (() => {
  const mk = (slug: string, name: string) => ({ slug, name, gameRef: null }) as unknown as MarketItem;
  const nitain = mk('nitain_extract', 'Nitain Extract');
  return { byGameRef: new Map(), bySlug: new Map([['nitain_extract', nitain]]), all: [nitain], failed: false };
})();

check('an invasion paying something untradeable is left out, not listed at zero', () => {
  /*
   * Most invasions pay Forma, which nobody can sell. Listing it at 0p would
   * imply it had been weighed and found wanting, when it is simply a different
   * kind of thing.
   */
  const invs = [
    { id: 'a', node: 'Numa (Saturn)', attacker: { faction: 'Corpus', reward: { countedItems: [{ count: 1, type: 'Forma Blueprint' }] } } },
    { id: 'b', node: 'Tessera (Venus)', attacker: { faction: 'Grineer', reward: { countedItems: [{ count: 3, type: 'Nitain Extract' }] } } },
  ] as never;
  const out = tradeableOffers(invs, invCatalog);
  assert.equal(out.length, 1, 'only the sellable reward survives');
  assert.equal(out[0]?.item, 'Nitain Extract');
  assert.equal(out[0]?.count, 3, 'the count the feed states is carried, not flattened to one');
});

check('a completed invasion is not offered', () => {
  const invs = [
    { id: 'a', node: 'X', completed: true, attacker: { faction: 'Corpus', reward: { countedItems: [{ count: 1, type: 'Nitain Extract' }] } } },
  ] as never;
  assert.deepEqual(tradeableOffers(invs, invCatalog), [], 'a finished invasion cannot be run');
});

check('no worldstate and no catalogue yield nothing, never a guess', () => {
  assert.deepEqual(tradeableOffers(undefined, invCatalog), []);
  assert.deepEqual(tradeableOffers([] as never, null), []);
});

check('no drop chance is asserted without its working shown', () => {
  /*
   * FOUR of six asserted chances turned out to be invented or wrong when they
   * were finally checked against the drop tables: a 2 per cent for rare mods
   * that actually span 1 to 9.8, a 3 for scenes that run 2.51 to 7.14, a 5 for
   * sculptures that measure 5.95, and a 15 for Zariman arcanes that came from
   * misreading "fifteen entries" as a percentage.
   *
   * A tool whose premise is measurement cannot carry numbers like that. Every
   * surviving chance has to cite where it came from rather than merely assert
   * that the thing is rare.
   */
  const HEDGE = /(sit at|are rare|uncommon|low single-figure|roughly|about |typically|generally)/i;

  for (const [id, model] of Object.entries(THROUGHPUT_MODELS)) {
    const drop = model.drop;
    if (drop.kind !== 'chance') continue;

    assert.ok(drop.percent > 0 && drop.percent <= 100, `${id} has an impossible chance: ${String(drop.percent)}`);
    assert.ok(drop.note.length > 20, `${id} states a chance with no working shown`);
    assert.ok(!HEDGE.test(drop.note), `${id} hedges instead of citing: "${drop.note}"`);

    /*
     * A whole multiple of five is the shape an invented number takes. Allowed
     * only when the note carries a digit, which means it is quoting a source
     * rather than reaching for a round figure.
     */
    if (drop.percent % 5 === 0) {
      assert.match(drop.note, /\d/, `${id} uses the round number ${String(drop.percent)} with nothing cited`);
    }
  }
});

check('a fixed drop count above one must be a game rule, not an estimate', () => {
  /*
   * Every `fixed` count renders as MEASURED in the audit trail, which made this
   * the worst place in the file to keep a guess. Four were: "4 arcanes per
   * hunt", "3 stars per run", "8 fish per trip", "4 gems per trip" - none of
   * them published anywhere, all of them displayed to the reader as measured
   * fact.
   *
   * A count above one is now only allowed where it follows from a RULE the game
   * states: six items a side per trade, two imprints per companion, one relic
   * per player. Those are checkable; "how many fish you land" is not, and
   * belongs in the refusal path with the reason attached.
   */
  const RULE = /(per player|a side|per trade|per companion|each player|one per)/i;

  for (const [id, model] of Object.entries(THROUGHPUT_MODELS)) {
    const drop = model.drop;
    if (drop.kind !== 'fixed') continue;
    if (drop.n <= 1) continue;

    assert.ok(
      RULE.test(drop.note) || drop.perPlayer === true,
      `${id} claims ${String(drop.n)} per cycle as measured fact, with no game rule behind it: "${drop.note}"`,
    );
  }
});

check('a route that cannot state its yield refuses, and says what would settle it', () => {
  /*
   * The four corrected above must now REFUSE rather than quietly carrying a
   * smaller invented number. Each names what would answer the question.
   */
  for (const id of ['eidolon', 'ayatan-stars', 'fish-whole', 'gems-cut']) {
    const model = THROUGHPUT_MODELS[id];
    assert.ok(model, `${id} should still be modelled`);
    assert.equal(model.price.kind, 'unknown', `${id} must refuse rather than assert a per-trip yield`);
    if (model.price.kind === 'unknown') {
      assert.ok(model.price.why.length > 60, `${id} refuses without explaining what would settle it`);
    }
  }
});

/* ------------------------------------------------- the daily counters lie */

check('a trade count from before its own reset is unknown, not stale', () => {
  /*
   * The same bug as dailyState had, in a second place - and this one is now the
   * headline number on the set-completion panel. An account read at 23:00 says
   * nothing about the day that started at 00:00.
   */
  const reset = 1_700_000_000_000;
  const acc = { TradesRemaining: 4, NextRefill: { $date: { $numberLong: String(reset) } } } as unknown as RawAccount;

  const before = platPosition(acc, reset - 60_000);
  assert.equal(before.tradesLeft, 4, 'before the reset the account’s own number stands');

  const after = platPosition(acc, reset + 60_000);
  assert.equal(after.tradesLeft, null, 'past the reset it is unknown, never the leftover count');
  assert.notEqual(after.tradesLeft, 0, 'and it is certainly not zero');
});

/* ------------------------------------------------------ where a number is from */

check('nothing published claims to have been measured from your runs', () => {
  /*
   * THE WORD "MEASURED" IS A CLAIM ABOUT THIS ACCOUNT, AND IT WAS BEING MADE
   * ABOUT A TABLE IN THE SOURCE.
   * ───────────────────────────────────────────────────────────────────────
   * `dropLink` returned `from: 'measured'` in all three of its branches. The
   * values come from `DropModel` - a squad rule, or a published drop chance -
   * so the middle term of every rate this panel quotes was borrowing the
   * standing of the term beside it, which really is the player's own median.
   *
   * A reader has no way to spot that: both rendered as the same word, in the
   * same colour, one card apart. This check is the thing that makes the
   * distinction survive - the labels are a claim, and a claim needs a gate.
   */
  const squad = 4;
  for (const [id, model] of Object.entries(MODELS)) {
    const drop = dropLink(model.drop, squad);
    /*
     * A DropModel is a constant either way. `perPlayer` scales by the squad
     * size the player set, which makes it theirs; nothing here is ever from
     * their runs, and that is exactly what must not be claimed.
     */
    assert.notEqual(
      drop.from,
      'measured',
      `${id}: "${drop.label}" comes from the model table, and calling it measured claims it came from the player's own runs`,
    );
    assert.ok(
      drop.from === 'published' || drop.from === 'yours',
      `${id}: "${drop.label}" has provenance "${drop.from}", which is neither of the two a constant can honestly carry`,
    );
  }

  /*
   * AND THE TIMING LINK IS THE CONTROL. If nothing in this suite ever produced
   * a genuinely measured link, the assertion above would pass on a chain that
   * had simply relabelled everything - so one link has to earn the word.
   */
  const obs = observe([
    { missionTypeName: 'Capture', durationMs: 240_000, endedAt: 0, outcome: 'success' } as unknown as MissionRecord,
    { missionTypeName: 'Capture', durationMs: 300_000, endedAt: 0, outcome: 'success' } as unknown as MissionRecord,
  ]);
  const chain = chainFor('fissures', obs, DEFAULT_PREFERENCE, NO_BOOK);
  assert.ok(chain);
  const timing = chain.chain.links.find((l) => l.label === 'Runs an hour');
  assert.ok(timing);
  assert.equal(timing.from, 'measured', 'a median over the player\u2019s own runs is the one thing that IS measured');
});

check('every factor in the expectation says where its number came from', () => {
  /*
   * The same defect was committed in `plat-expect.ts` while fixing it here: its
   * helpers hard-coded `from: 'measured'`, so the published liquidity, bracket
   * and solo constants were labelled exactly like the trade factor, which is
   * computed from two real numbers off the account.
   */
  const published = [
    liquidityFactor('slow'),
    gearFactor(2, 'a specialised build'),
    soloFactor('needs-squad', true),
  ];
  for (const f of published) {
    assert.ok(f.kind === 'factor');
    assert.equal(f.link.from, 'published', `"${f.link.label}" is a constant in the source and must say so`);
  }

  const measured = tradeFactor(
    {
      routeId: 'x', perHour: 100, blockedBy: null, links: [], fromRuns: 4, cap: null,
      tradesPerHour: 8, perTrade: null, volume: null, overridden: false,
    },
    3,
  );
  assert.ok(measured.kind === 'factor');
  assert.equal(measured.link.from, 'measured', 'trades left and trades needed are both real numbers off this account');
});

/* --------------------------------------------- measured rates in the ranking */

/**
 * Rates as the ranker now takes them: the whole `Rate`, not a bare number.
 *
 * `tradesPerHour` is left null on purpose here. It is the field that decides
 * how much of an hour's haul can be sold today, and a fixture that quietly
 * filled it in would be testing a trade shortage nobody asked for - the trade
 * factor has its own checks in `check-expect.ts`, against explicit numbers.
 */
function ratesOf(perHour: Record<string, number>): ReadonlyMap<string, Rate> {
  const m = new Map<string, Rate>();
  for (const [routeId, n] of Object.entries(perHour)) {
    m.set(routeId, {
      routeId,
      perHour: n,
      blockedBy: null,
      links: [],
      fromRuns: 12,
      cap: null,
      tradesPerHour: null,
      perTrade: null,
      volume: null,
      overridden: false,
    });
  }
  return m;
}

/*
 * THREE CHECKS OF THE SCORING THAT NO LONGER EXISTS USED TO SIT HERE.
 * ————————————————————————————————————————————
 * They asserted that a measured rate was ignored until a slider was raised,
 * that raising it added a positive term to the audit trail, and that the term
 * was normalised against the account's own best rate. All three described real
 * behaviour and all three were checking a defect:
 *
 *   - the slider existed because a SUM cannot tell "not measured" from
 *     "measured at nothing", so counting rates by default would have buried
 *     every route the player had not run. Tiering tells them apart, so the
 *     workaround is gone with the thing it worked around.
 *   - the normaliser divided by the best rate the account had ever seen, which
 *     meant a player who had measured exactly ONE route made that route the
 *     yardstick - and it scored full marks for being the only thing they had
 *     ever timed. The third check ASSERTED that behaviour, and the assertion
 *     was correct about the code and wrong about the world.
 *
 * The replacements below check the properties that survive, and the two that
 * the old shape could not have.
 */

/*
 * NO_LIVE IS A MEASUREMENT: "the worldstate was read and nothing is firing".
 * `null` is "it has not been read". The checks below use both deliberately,
 * because the difference between them is the whole of `liveFactor`.
 */
const LIVE_UNREAD = null;

check('a measured rate ranks the list, without anybody moving a slider', () => {
  /*
   * `wantHighRate` is gone entirely, so there is no setting under which a
   * measured rate is ignored. The rate is not a preference - it is the question
   * the panel asks, and preferring more platinum to less is not a taste.
   */
  assert.ok(!('wantHighRate' in DEFAULT_PREFS), 'the measured-rate weight must not come back');

  /*
   * `rare-mods` rather than `fissures`: fissures only runs while a fissure is
   * open, and NO_LIVE says none is - so it is correctly gated to nothing, and
   * would prove the opposite of what this check is about. A route with no world
   * window is the one whose rate can be read straight through.
   */
  const measured = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, DEFAULT_PREFS, null, ratesOf({ 'rare-mods': 900 }));
  const mods = measured.find((r) => r.state.route.id === 'rare-mods');
  assert.ok(mods, 'rare-mods should be ranked');
  assert.equal(mods.expected.fromRate, 900, 'the measured rate must arrive intact, whatever is then taken off it');
  assert.ok(mods.expected.perHour !== null, 'and with the worldstate read, it must produce an estimate');
  assert.ok(mods.expected.perHour > 0);

  /*
   * AND IT SITS ABOVE EVERY UNMEASURED ROUTE - which is the ordering the slider
   * used to be needed for, arrived at without one.
   */
  const rank = measured.findIndex((r) => r.state.route.id === 'rare-mods');
  const firstUnmeasured = measured.findIndex((r) => r.expected.perHour === null);
  assert.ok(firstUnmeasured > rank, 'a route with a real number must sit above the ones nobody has run');
});

check('an unmeasured route is in its own tier, not at the bottom of a shared one', () => {
  /*
   * THE PROPERTY THE SLIDER EXISTED TO PROTECT, now structural. In a sum, a
   * route with no measurement scored zero from the rate term while a route
   * measured at ten scored a little - so never having played something counted
   * against it. That is circular, and it is why the weight defaulted to off.
   *
   * With tiers there is nothing to default: a route with no estimate is not
   * ranked against one that has an estimate at all. It sits in the second
   * group, ordered among its peers, and the panel can name the group.
   */
  const ranked = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, DEFAULT_PREFS, null, ratesOf({ 'rare-mods': 10 }));
  const tierOf = (r: (typeof ranked)[number]): number =>
    r.expected.gatedBy !== null ? 2 : r.expected.perHour === null ? 1 : 0;

  /*
   * WITHIN each blocked/doable group, because `cannot` outranks the tiers by
   * design: a route you can start but have not measured still beats one you
   * cannot start at all, however well measured that one is.
   */
  for (const blocked of [false, true]) {
    const tiers = ranked.filter((r) => (r.cannot !== null) === blocked).map(tierOf);
    assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b), 'the tiers interleaved - an estimate must outrank a guess');
  }

  const all = ranked.map(tierOf);
  assert.ok(all.includes(0), 'the fixture produced no estimated route, so this check proves nothing');
  assert.ok(all.includes(1), 'the fixture produced no unmeasured route, so this check proves nothing');

  /*
   * And a route measured LOW is still above one never measured - because the
   * question is which tier you are in, not how big the number is. That is the
   * opposite of what the old sum did, and it is the honest ordering: we know
   * what this one pays, and we do not know what that one pays.
   */
  const low = ranked.findIndex((r) => r.state.route.id === 'rare-mods');
  const firstGuess = ranked.findIndex((r) => tierOf(r) === 1);
  assert.ok(low < firstGuess, 'ten platinum an hour we have measured beats any number we have not');
});

check('the ranking is in platinum, so two accounts are not normalised into agreement', () => {
  /*
   * The check this replaces asserted that an account measuring one route at 10
   * an hour and an account measuring one at 10,000 produced the SAME score,
   * because each was divided by its own best. That is what a normaliser does,
   * and it is why the number it produced could not be read as anything.
   *
   * The estimate is in platinum, so the two differ by exactly the factor their
   * measurements differ by. Checked as a RATIO rather than against two literal
   * numbers, so the assertion stays about normalisation and does not quietly
   * become a test of whichever factors this particular route triggers.
   */
  const of = (n: number): number | null =>
    rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, DEFAULT_PREFS, null, ratesOf({ 'rare-mods': n })).find(
      (r) => r.state.route.id === 'rare-mods',
    )?.expected.perHour ?? null;

  const small = of(10);
  const large = of(10_000);
  assert.ok(small !== null && large !== null && small > 0);
  assert.equal(
    Math.round((large / small) * 100) / 100,
    1000,
    'the same route measured a thousand times better must read a thousand times better',
  );
});

check('a ceiling never outranks a reading of the same size', () => {
  /*
   * THE TIER BOUNDARY, AND IT WAS UNGUARDED UNTIL A SABOTAGE FOUND IT.
   * ─────────────────────────────────────────────────────────────────
   * Collapsing tier 1 into tier 0 - so "up to 60" sorts level with a measured
   * 60 - passed every check in this suite and in `check-expect.ts`. Those
   * checks prove the FLAG is set correctly; not one of them proved the ranking
   * reads it. A flag nobody acts on is decoration.
   *
   * The two routes below carry the SAME platinum figure and differ only in
   * whether one of the terms could be evaluated: `sell-relics` has no measured
   * trade cost so nothing is missing, while `rare-mods` has one and the account
   * never reported how many trades are left. Same number, weaker claim, and the
   * weaker claim must sort below.
   */
  const both = new Map([
    ...ratesOf({ 'sell-relics': 200 }),
    ...ratesOf({ 'rare-mods': 200 }).entries(),
  ]);
  // Only `rare-mods` costs trades to sell, so only it can be bounded by an
  // unread trade count.
  const bounded = both.get('rare-mods');
  assert.ok(bounded);
  both.set('rare-mods', { ...bounded, tradesPerHour: 8 });

  // `emptyPos` has never read a trade count, which is the ordinary state.
  assert.equal(emptyPos.tradesLeft, null, 'this check needs an unread trade count to mean anything');

  const ranked = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, DEFAULT_PREFS, null, both);
  const firm = ranked.find((r) => r.state.route.id === 'sell-relics');
  const ceiling = ranked.find((r) => r.state.route.id === 'rare-mods');
  assert.ok(firm && ceiling);

  assert.equal(firm.expected.atMost, false, 'the fixture failed to produce a firm estimate');
  assert.equal(ceiling.expected.atMost, true, 'the fixture failed to produce a ceiling');
  assert.equal(
    firm.expected.perHour,
    ceiling.expected.perHour,
    'the fixture must make the two numbers equal, or this tests size rather than certainty',
  );

  assert.ok(
    ranked.indexOf(firm) < ranked.indexOf(ceiling),
    'a figure we are sure of must outrank an identical one we are not',
  );
});

check('a ceiling outranks a smaller reading, and is what gets recommended', () => {
  /*
   * THE REVIEW'S SEVERITY-ONE FINDING ON THIS PANEL, MEASURED. The sort put
   * tier before platinum, so every ceiling sat below every firm figure at any
   * value. In the ordinary state - game closed, no account, so every route
   * with a per-item trade cost is a ceiling - a firm 1.8 platinum an hour
   * outranked "up to 172", and `bestNow` recommended the 1.8. The comment
   * promised "below the firm ones at equal value"; the code delivered "at any
   * value". Caution counted twice, the defect `plat-expect` describes fixing,
   * one tier over.
   *
   * The same-size case above still holds: at EQUAL platinum, firm first.
   */
  const both = new Map([...ratesOf({ 'sell-relics': 1.8 }), ...ratesOf({ 'rare-mods': 172 }).entries()]);
  const b = both.get('rare-mods');
  assert.ok(b);
  both.set('rare-mods', { ...b, tradesPerHour: 8 });
  assert.equal(emptyPos.tradesLeft, null, 'this check needs an unread trade count, the ordinary state');

  const ranked = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, DEFAULT_PREFS, null, both);
  const firm = ranked.find((r) => r.state.route.id === 'sell-relics');
  const ceiling = ranked.find((r) => r.state.route.id === 'rare-mods');
  assert.ok(firm && ceiling);
  assert.equal(firm.expected.atMost, false, 'fixture failed to produce a firm figure');
  assert.equal(ceiling.expected.atMost, true, 'fixture failed to produce a ceiling');
  assert.ok((ceiling.expected.perHour ?? 0) > (firm.expected.perHour ?? 0), 'the fixture must make the ceiling the larger number');

  assert.ok(ranked.indexOf(ceiling) < ranked.indexOf(firm), `"up to ${String(ceiling.expected.perHour)}" must outrank a firm ${String(firm.expected.perHour)}`);
  const best = bestNow(ranked);
  assert.ok(best);
  assert.equal(best.state.route.id, 'rare-mods', `bestNow recommended ${best.state.route.id} over a route paying a hundred times more`);
});

check('an unread worldstate is not a closed window', () => {
  /*
   * THE BUG THIS CHECK EXISTS FOR WAS INTRODUCED AND THEN CAUGHT HERE.
   * ─────────────────────────────────────────────────────────────────
   * The panel's `liveSignals` returned an EMPTY SET when the worldstate had not
   * loaded - the same shape as "nothing is live". Once a closed window became a
   * gate rather than a three-point nudge, that would have told every player,
   * for the seconds before the fetch lands and forever if it fails, that every
   * timed route was shut. A fabricated certainty, which is the exact failure
   * this whole app is built to avoid.
   */
  const rates = ratesOf({ fissures: 500 });
  const unread = rankRoutes(catalog, emptyPicture, emptyPos, LIVE_UNREAD, DEFAULT_PREFS, null, rates);
  const shut = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, DEFAULT_PREFS, null, rates);
  const open = rankRoutes(catalog, emptyPicture, emptyPos, new Set<LiveSignal>(['fissures']), DEFAULT_PREFS, null, rates);

  const f = (rs: typeof unread): (typeof unread)[number] | undefined =>
    rs.find((r) => r.state.route.id === 'fissures');

  assert.equal(f(shut)?.expected.perHour, 0, 'a window we KNOW is closed pays nothing');
  assert.ok(f(shut)?.expected.gatedBy, 'and it says which gate');

  /*
   * An unread window is a CEILING, not a gate and not a mystery: the route
   * might be open, in which case it pays what the estimate says, and it might
   * be shut, in which case it pays nothing. "At most this" covers both, and is
   * the strongest true statement available.
   */
  assert.equal(f(unread)?.expected.gatedBy, null, 'a window we have not looked at must not be gated shut');
  assert.equal(f(unread)?.expected.atMost, true, 'and the figure it carries must be flagged a ceiling');
  assert.match(f(unread)?.expected.blockedBy?.label ?? '', /window is open/, 'naming the thing that was not read');
  assert.equal(f(open)?.expected.atMost, false, 'while a window we HAVE read gives a firm figure');

  assert.ok((f(open)?.expected.perHour ?? 0) > 0, 'and an open window pays');

  /*
   * The ordering that follows: not knowing ranks ABOVE knowing it is shut. A
   * route nobody has checked is a maybe; one that has been checked is a no.
   */
  const tierOf = (r: (typeof unread)[number] | undefined): number =>
    r === undefined ? 9 : r.expected.gatedBy !== null ? 3 : r.expected.perHour === null ? 2 : r.expected.atMost ? 1 : 0;
  assert.ok(
    tierOf(f(unread)) < tierOf(f(shut)),
    'an unchecked window must rank in a better tier than one known to be shut',
  );
  assert.equal(tierOf(f(open)), 0, 'and an open one is estimable outright');
});

/* ----------------------------------------------------------------- ranking */

check('every ranked route can say why it ranked where it did', () => {
  const ranked = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, { ...DEFAULT_PREFS, session: 'quick' }, null);
  assert.ok(ranked.length > 0);
  for (const r of ranked) {
    assert.ok(r.reasons.length > 0, `${r.state.route.id} scored ${String(r.score)} with no stated reason`);
    const sum = r.reasons.reduce((n, w) => n + w.delta, 0);
    assert.ok(Math.abs(sum - r.score) < 1e-9, `${r.state.route.id}: reasons sum to ${String(sum)} but score is ${String(r.score)}`);
  }
});

check('the ranking is deterministic', () => {
  const a = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, DEFAULT_PREFS, null).map((r) => r.state.route.id);
  const b = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, DEFAULT_PREFS, null).map((r) => r.state.route.id);
  assert.deepEqual(a, b, 'two identical inputs produced different orders');
});

check('the preferences actually change the order', () => {
  // A control that does not move anything is a lie about how the panel works.
  const quick = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, { ...DEFAULT_PREFS, session: 'quick' }, null).map((r) => r.state.route.id, null);
  const evening = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, { ...DEFAULT_PREFS, session: 'evening' }, null).map((r) => r.state.route.id, null);
  assert.notDeepEqual(quick, evening, 'session length did not change the ranking');

  const squad = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, { ...DEFAULT_PREFS, solo: false }, null).map((r) => r.state.route.id, null);
  const solo = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, { ...DEFAULT_PREFS, solo: true }, null).map((r) => r.state.route.id, null);
  assert.notDeepEqual(squad, solo, 'playing solo did not change the ranking');
});

check('a short session pushes whole-session routes down', () => {
  const quick = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, { ...DEFAULT_PREFS, session: 'quick', includeLocked: true }, null);
  const long = quick.filter((r) => r.state.route.cycle === 'session');
  const instant = quick.filter((r) => r.state.route.cycle === 'instant');
  assert.ok(long.length > 0 && instant.length > 0, 'the fixture needs both kinds');
  /*
   * ASSERTED ON POSITION, NOT ON SCORE.
   * ───────────────────────────────────
   * This used to compare `score`, which was the only observable when the
   * ranking was one sum. Session fit is now a GATE rather than a term, so it
   * changes which tier a route lands in and never touches the score at all -
   * and a check that reads the score would report the property broken while the
   * behaviour it names is stronger than it has ever been.
   *
   * Position is what the player actually sees, and it is true under either
   * implementation, which is the point: it tests the behaviour rather than the
   * mechanism that currently produces it.
   */
  const at = (id: string): number => quick.findIndex((r) => r.state.route.id === id);

  /*
   * COMPARED AMONG ROUTES THE ACCOUNT CAN ACTUALLY START, AND THAT EXCLUSION IS
   * THE ORDERING, NOT AN EVASION.
   * ────────────────────────────────────────────────────────────────────────
   * `cannot` outranks every tier by design: not owning the Necramech a route
   * needs is worse than a route merely being too long for tonight, because one
   * is impossible and the other is only impossible tonight. So the fixture's
   * blocked instant routes legitimately sit below a doable session-length one,
   * and a check that ignored that would be asserting the wrong precedence.
   *
   * Instant routes with a CLOSED WINDOW are excluded for the same reason - a
   * Baro route with Baro away is gated on its own account, and comparing it
   * with a session route would be comparing two gates rather than testing this
   * one.
   */
  const startable = instant.filter((r) => r.cannot === null && r.expected.gatedBy === null);
  assert.ok(startable.length > 0, 'the fixture produced no startable instant route, so this check proves nothing');
  const worstInstant = Math.max(...startable.map((r) => at(r.state.route.id)));
  const bestLong = Math.min(...long.map((r) => at(r.state.route.id)));
  assert.ok(worstInstant < bestLong, 'with minutes to spare, a whole-session route outranked an instant one');

  // And every one of them says so, in words, rather than merely sorting low.
  for (const r of long) {
    assert.ok(r.expected.gatedBy, `${r.state.route.id} wants a whole session and was not gated in a quick one`);
    /*
     * THE FIRST GATE WINS, AND MORE THAN ONE CAN BE TRUE. A whole-session route
     * that is ALSO behind a closed world window is reported as shut rather than
     * as long, because that is the order the reasoning runs in and both answers
     * are correct. So the session wording is only demanded of the routes where
     * the session is the only thing gating them.
     */
    if (r.state.route.live === null) {
      assert.match(r.expected.gatedBy.label, /Longer than the time you have/);
    }
  }
});

check('a live route beats the same route when its window is shut', () => {
  const shut = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, DEFAULT_PREFS, null);
  const open = rankRoutes(catalog, emptyPicture, emptyPos, new Set<LiveSignal>(['baro']), DEFAULT_PREFS, null);
  // `baro-flip`, not `ducats`: the ducat route pays a different currency and is
  // deliberately absent from a platinum ranking. This one SPENDS ducats and
  // produces platinum, so it belongs here and is gated on the same signal.
  const before = shut.find((r) => r.state.route.id === 'baro-flip');
  const after = open.find((r) => r.state.route.id === 'baro-flip');
  assert.ok(before && after);
  /*
   * A closed window is a gate now, not a -3, so this is asserted where the
   * effect actually lands: the shut route is gated to nothing and the open one
   * is not. Comparing scores would compare two numbers neither of which the
   * window touches any more.
   */
  assert.ok(before.expected.gatedBy, 'Baro away must gate the Baro route, not merely dock it points');
  assert.equal(before.expected.perHour, 0);
  assert.equal(after.expected.gatedBy, null, 'and Baro being in the relay must open it');
  assert.equal(after.liveNow, true);
  assert.ok(
    shut.indexOf(before) > open.indexOf(after),
    'Baro being in the relay did not raise the Baro route',
  );
});

check('the account changes the answer, not just the labels', () => {
  // Trades are the real constraint: with almost none left, a route that needs a
  // trade per buyer is the wrong call and the ranking has to say so.
  const rich = { PremiumCredits: 900, PremiumCreditsFree: 0, TradesRemaining: 12, PlayerLevel: 14 } as unknown as RawAccount;
  const spent = { PremiumCredits: 900, PremiumCreditsFree: 0, TradesRemaining: 1, PlayerLevel: 14 } as unknown as RawAccount;

  const withTrades = rankRoutes(catalog, emptyPicture, platPosition(rich), NO_LIVE, DEFAULT_PREFS, null);
  const noTrades = rankRoutes(catalog, emptyPicture, platPosition(spent), NO_LIVE, DEFAULT_PREFS, null);

  const stackId = 'relic-farm';
  const a = withTrades.find((r) => r.state.route.id === stackId);
  const b = noTrades.find((r) => r.state.route.id === stackId);
  assert.ok(a && b);
  assert.ok(b.score < a.score, 'running out of trades did not penalise a route that needs many of them');
  assert.ok(
    b.reasons.some((w) => w.label.includes('trades left today')),
    'the penalty was applied without saying why',
  );
  /*
   * THIS IS THE COARSE SIGNAL, AND IT MUST STAY COARSE. `relic-farm` has no
   * measured rate here, so nothing knows how many trades an hour of it really
   * costs - only that it sells in many small pieces and this account has one
   * trade left. That is a direction, not a quantity, so it must move the
   * qualitative score and must NOT appear as a fraction of a platinum estimate
   * the app cannot compute.
   */
  assert.equal(b.expected.perHour, null, 'an unmeasured route must not acquire a platinum figure from a trade count');
  assert.ok(
    !b.expected.links.some((l) => l.label === 'Trades left today'),
    'the measured trade factor must not fire on a route with no measured trade cost',
  );
});

check('ducats held lift the Baro route, and an empty purse lowers it', () => {
  const flush = { MiscItems: [{ ItemType: '/Lotus/Types/Items/MiscItems/PrimeBucks', ItemCount: 2500 }] } as unknown as RawAccount;
  const broke = { MiscItems: [{ ItemType: '/Lotus/Types/Items/MiscItems/PrimeBucks', ItemCount: 10 }] } as unknown as RawAccount;
  const hi = rankRoutes(catalog, emptyPicture, platPosition(flush), NO_LIVE, DEFAULT_PREFS, null).find((r) => r.state.route.id === 'baro-flip', null);
  const lo = rankRoutes(catalog, emptyPicture, platPosition(broke), NO_LIVE, DEFAULT_PREFS, null).find((r) => r.state.route.id === 'baro-flip', null);
  assert.ok(hi && lo);
  assert.ok(hi.score > lo.score, 'holding 2,500 ducats did not outrank holding 10');
});

check('no free Riven slots pushes the Riven routes down', () => {
  const full = { RandomModBin: { Slots: 0 } } as unknown as RawAccount;
  const room = { RandomModBin: { Slots: 8 } } as unknown as RawAccount;
  const a = rankRoutes(catalog, emptyPicture, platPosition(room), NO_LIVE, { ...DEFAULT_PREFS, includeLocked: true }, null).find((r) => r.state.route.id === 'riven-sortie', null);
  const b = rankRoutes(catalog, emptyPicture, platPosition(full), NO_LIVE, { ...DEFAULT_PREFS, includeLocked: true }, null).find((r) => r.state.route.id === 'riven-sortie', null);
  assert.ok(a && b);
  assert.ok(b.score < a.score, 'a full Riven inventory did not discourage farming more Rivens');
});

check('the recommendation is always one the account can actually do', () => {
  const best = bestNow(rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, { ...DEFAULT_PREFS, includeLocked: true }, null));
  assert.ok(best, 'no recommendation at all');
  assert.equal(best.state.status, 'open', 'recommended a route the account cannot reach');
});

check('muting a family removes it entirely', () => {
  const muted = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, { ...DEFAULT_PREFS, muted: new Set(['prime']) }, null);
  assert.ok(!muted.some((r) => r.state.route.family === 'prime'), 'a muted family still appeared');
  assert.ok(muted.length > 0, 'muting one family emptied the board');
});

check('EVERY route has a real, usable guide', () => {
  // A recommendation you cannot act on is not a recommendation. The panel could
  // rank routes long before it could tell anyone how to run one.
  const missing: string[] = [];
  for (const r of PLAT_ROUTES) {
    const g = guideFor(r.id);
    if (!g) {
      missing.push(r.id);
      continue;
    }
    assert.ok(g.steps.length >= 3, `${r.id} has only ${String(g.steps.length)} steps`);
    for (const step of g.steps) {
      /*
       * Read through `stepText`, because a step is now either a string or a
       * bound object. This assertion caught that change the moment it landed -
       * `step.length` on an object is undefined and the prose test was running
       * against "[object Object]" - which is the gate doing its job. The rule
       * it enforces has not moved: every step is still real prose, whether or
       * not it also carries a question the app can answer.
       */
      const text = stepText(step);
      assert.ok(text.length > 25, `${r.id} has a step too short to be an instruction: "${text}"`);
      assert.ok(/[a-z]/.test(text), `${r.id} has a step that is not prose`);
    }
    assert.ok(g.demand >= 1 && g.demand <= 5, `${r.id} has a demand outside 1..5`);
  }
  assert.deepEqual(missing, [], `routes with no guide at all: ${missing.join(', ')}`);
});

check('no guide quotes an invented platinum figure either', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'data', 'plat-guide.ts'), 'utf8');
  const bad = [...source.matchAll(/\d[\d,\s–-]*\s*(platinum|plat\b)/gi)].map((m) => m[0]);
  assert.deepEqual(bad, [], `platinum figures in the guides: ${bad.join(', ')}`);
});

check('the guide covers the routes and nothing else', () => {
  // An orphan guide is a route that was renamed or removed, and it would rot.
  const ids = new Set(PLAT_ROUTES.map((r) => r.id));
  const orphans = Object.keys(ROUTE_GUIDE).filter((k) => !ids.has(k));
  assert.deepEqual(orphans, [], `guides with no route: ${orphans.join(', ')}`);
});

check('combat power changes what is recommended', () => {
  // The whole point of the sliders. A quest gate says a route is PERMITTED;
  // power says whether the gear can carry it, and Eidolon hunting is the case
  // that proves it - permitted early, impossible early.
  const weak = { ...DEFAULT_PREFS, includeLocked: true, power: { frame: 1, weapons: 1 } as const };
  const strong = { ...DEFAULT_PREFS, includeLocked: true, power: { frame: 5, weapons: 5 } as const };

  /*
   * NIGHT, BECAUSE EIDOLONS ONLY EXIST AT NIGHT.
   * ───────────────────────────────────────────
   * With `NO_LIVE` the route is correctly gated to nothing - the hunt is not
   * available - and a gated route keeps none of its rate whatever the player's
   * gear is, so both accounts would read identically and the check would prove
   * the opposite of what it means. The window has to be open before gear can be
   * the thing under test.
   */
  const NIGHT: ReadonlySet<LiveSignal> = new Set<LiveSignal>(['nightCycle']);
  const a = rankRoutes(catalog, emptyPicture, emptyPos, NIGHT, weak, null).find((r) => r.state.route.id === 'eidolon', null);
  const b = rankRoutes(catalog, emptyPicture, emptyPos, NIGHT, strong, null).find((r) => r.state.route.id === 'eidolon', null);
  assert.ok(a && b);
  /*
   * Being short of the bracket is a completion rate now, not a penalty, so the
   * effect lands on the realisation share rather than on the score: a weak
   * account keeps a fraction of whatever an Eidolon hunt pays, and a strong one
   * keeps all of it. `realised` is the field that exists precisely so this
   * still works for a route nobody has measured.
   */
  assert.ok(a.expected.realised !== null && b.expected.realised !== null);
  assert.ok(
    b.expected.realised > a.expected.realised,
    'gear made no difference to a route that is entirely gear-dependent',
  );
  assert.equal(b.expected.realised, 1, 'a maxed account loses nothing to the bracket');
  assert.ok(
    a.expected.links.some((l) => l.label === 'Runs your gear finishes'),
    'an under-geared player was not told their runs would not finish',
  );

  const weakOrder = rankRoutes(catalog, emptyPicture, emptyPos, NIGHT, weak, null).map((r) => r.state.route.id, null);
  const strongOrder = rankRoutes(catalog, emptyPicture, emptyPos, NIGHT, strong, null).map((r) => r.state.route.id, null);
  assert.notDeepEqual(weakOrder, strongOrder, 'the power sliders did not reorder anything');
});

check('the binding constraint is the weaker half of a build', () => {
  // A strong frame with an unmodded weapon fails different content than the
  // reverse, so the build is its weakest half, never an average.
  assert.equal(powerLevel({ frame: 5, weapons: 1 }), 1);
  assert.equal(powerLevel({ frame: 2, weapons: 4 }), 2);
});

check('hiding over-geared routes removes exactly those', () => {
  const shown = rankRoutes(catalog, emptyPicture, emptyPos, NO_LIVE, {
    ...DEFAULT_PREFS,
    includeLocked: true,
    power: { frame: 1, weapons: 1 },
    hideOverGeared: true,
  }, null);
  for (const r of shown) {
    const g = guideFor(r.state.route.id);
    assert.ok(!g || g.demand - 1 < 2, `${r.state.route.id} needs ${String(g?.demand)} but survived the filter`);
  }
  assert.ok(shown.length > 0, 'the filter emptied the board');
});

check('the suggested power is derived, and refuses to guess without an account', () => {
  assert.equal(suggestPower(emptyPicture, null), null, 'a suggestion was made with no mastery rank at all');

  const chart = { nodeCount: 100, nodeIds: new Set(Array.from({ length: 100 }, (_, i) => `SolNode${String(i)}`)) };
  const cleared = Array.from({ length: 95 }, (_, i) => ({ Tag: `SolNode${String(i)}`, Completes: 1 }));
  const veteran = derive({ PlayerLevel: 26, Missions: cleared } as unknown as RawInventory, chart, []);
  const rookie = derive({ PlayerLevel: 3, Missions: cleared.slice(0, 8) } as unknown as RawInventory, chart, []);

  const v = suggestPower(veteran, 60);
  const r = suggestPower(rookie, 0);
  assert.ok(v && r);
  assert.ok(powerLevel(v) > powerLevel(r), 'a veteran and a rookie were suggested the same power');
  assert.ok(powerLevel(v) >= 4, `a maxed veteran was suggested only ${String(powerLevel(v))}`);
  assert.ok(powerLevel(r) <= 2, `a rookie was suggested ${String(powerLevel(r))}`);
});

/*
 * A TIMING NAME MUST BE A TYPE THE STAR CHART ACTUALLY USES.
 * ────────────────────────
 * A run's mission type comes from exactly one place - `chart?.type` in
 * `missionlog.ts` - so `Observed.byType` is keyed on the chart's own
 * vocabulary. A name outside it can never match a run, which means the route
 * silently never earns a measured rate and permanently reads "you have not run
 * this kind of mission with the overlay open yet".
 *
 * Nine entries said `Extermination`. The chart's word is `Exterminate`, and
 * nothing anywhere noticed for as long as those routes have existed. Two more
 * names - `Bounty` and `Duviri Endless` - were not node types either, and
 * `maroo-ayatan` listed only dead names, so that route could never show a rate
 * at all.
 *
 * Nothing about this fails loudly. It is the same shape as the frame and Amp
 * bugs: a plausible string that matches nothing, wearing the appearance of a
 * feature.
 */
check('every mission type a route is timed on is one the star chart names', () => {
  const chartTypes = new Set<string>();
  for (const node of NODES.nodes) {
    if (typeof node.type === 'string' && node.type.length > 0) chartTypes.add(node.type);
  }
  assert.ok(chartTypes.size > 20, `the chart carried only ${String(chartTypes.size)} mission types`);

  const wrong: string[] = [];
  for (const [id, model] of Object.entries(MODELS)) {
    if (model.timing.kind !== 'missionTypes') continue;
    for (const name of model.timing.names) {
      if (!chartTypes.has(name)) {
        wrong.push(`${id} is timed on "${name}", which no node in the star chart is - so it can never match a run`);
      }
    }
    if (model.timing.names.length === 0) {
      wrong.push(`${id} is timed on mission types but names none`);
    }
  }
  assert.deepEqual(wrong, [], wrong.join('\n        '));
});

/*
 * A PRIME SET IS SELLABLE EVEN THOUGH DE MARKS THE FRAME UNTRADEABLE.
 * ────────────────────────
 * `holdingsOf` decides what a player can sell by asking warframe.market's
 * catalogue, not by reading DE's `tradable` flag. That looks like the less
 * principled choice and is the correct one: 230 listed items carry
 * `tradable: false`, and they are the prime warframes - the flag describes the
 * assembled frame, while what sells is the set under the same game reference.
 *
 * A dead `sellablesFrom` used the flag instead, with a comment calling it "the
 * authority". Wiring that in would have removed every prime set from a
 * platinum panel, silently. This check makes the decision explicit so nobody
 * reverses it on the strength of how it reads.
 */
check('what sells is decided by the market catalogue, not by DE’s tradable flag', () => {
  const primeSet = {
    itemName: 'Mag Prime Set',
    slug: 'mag_prime_set',
    gameRef: '/Lotus/Powersuits/Mag/MagPrime',
    ducats: null,
  };
  const catalog = {
    failed: false,
    byGameRef: new Map([[primeSet.gameRef, primeSet]]),
    all: [primeSet],
  } as unknown as Parameters<typeof holdingsOf>[1];

  const acc = { Suits: [{ ItemType: primeSet.gameRef, ItemCount: 1 }] };
  const held = holdingsOf(acc, catalog, null);
  /*
   * The account holds an assembled Mag Prime. DE calls that untradeable; the
   * market lists it. The panel must follow the market.
   */
  assert.equal(held.length, 1, 'a prime the market lists was dropped from the sell stock');
  assert.equal(held[0]?.slug, 'mag_prime_set');
});

/*
 * AN EXAMPLE IN A COMMENT IS A CLAIM ABOUT THE DATA.
 * ────────────────────────
 * `missionlog.ts` documented its `missionTypeName` field as 'The chart's
 * readable type ("Extermination")'. The chart's word is "Exterminate". Nine
 * route timings were then written against the spelling in that comment, and
 * not one of them ever matched a run.
 *
 * The comment was the only place the wrong word came from, and nothing checks
 * comments - so this does. Any quoted mission type in the two files that
 * traffic in them has to be one the chart actually uses.
 */
check('a mission type quoted in a comment is one the chart really has', () => {
  const chartTypes = new Set<string>();
  for (const node of NODES.nodes) {
    if (typeof node.type === 'string' && node.type.length > 0) chartTypes.add(node.type);
  }

  /*
   * Only capitalised words inside double quotes, which is how this codebase
   * writes an example type. A looser scan would flag ordinary prose and get
   * itself deleted.
   */
  const files = ['../src/data/missionlog.ts', '../src/data/plat-throughput.ts'];
  const wrong: string[] = [];
  for (const rel of files) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    for (const m of src.matchAll(/"([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?)"/g)) {
      const word = m[1];
      if (word === undefined) continue;
      /*
       * A quoted capitalised word is only a MISSION TYPE claim when it looks
       * like one: it has to resemble the vocabulary. Anything that shares no
       * stem with a real type is ordinary prose and is left alone.
       */
      const near = [...chartTypes].some((t) => t.startsWith(word.slice(0, 5)) || word.startsWith(t.slice(0, 5)));
      if (near && !chartTypes.has(word)) {
        wrong.push(`${rel.split('/').pop() ?? rel} quotes "${word}", which is not a chart mission type`);
      }
    }
  }
  assert.deepEqual(wrong, [], wrong.join('\n        '));
});

/*
 * NO PRICE FIELD MAY EVER BE A ZERO NOBODY MEASURED.
 * ————————————————————————————————————————————
 * `min`, `max` and `volume` are printed straight to the screen, twice under the
 * literal label `from: 'measured'`. They used to be parsed with `?? 0`, so a
 * closed row carrying a median but no `min_price` produced "0p to 0p, measured".
 *
 * The parser now takes a row whole or takes none of it. This checks both halves
 * of that, because only one of them is visible in a passing app: a complete row
 * still parses, and a row short of ONE field is refused rather than zeroed.
 */
check('a price is parsed from a complete row, or not at all', () => {
  const day = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    datetime: '2026-09-04T00:00:00.000+00:00',
    median: 40, wa_price: 41.5, min_price: 35, max_price: 48, volume: 22,
    ...over,
  });
  const body = (rows: Array<Record<string, unknown>>): string =>
    JSON.stringify({ payload: { statistics_closed: { '48hours': rows, '90days': [] } } });

  const good = parsePrice('x')(body([day()]));
  assert.ok(good, 'a complete row must still parse');
  assert.deepEqual(
    { median: good.median, weighted: good.weighted, min: good.min, max: good.max, volume: good.volume },
    { median: 40, weighted: 41.5, min: 35, max: 48, volume: 22 },
    'and every figure is the row it came from',
  );

  // One field at a time, because a fallback on any single one is the whole bug.
  for (const field of ['median', 'wa_price', 'min_price', 'max_price', 'volume']) {
    const missing = parsePrice('x')(body([day({ [field]: null })]));
    assert.equal(missing, null, `a row missing ${field} must yield no price, never a zero`);
  }

  // A broken row does not poison a series that also holds a good one.
  const mixed = parsePrice('x')(body([day({ min_price: null }), day({ median: 51, min_price: 44 })]));
  assert.equal(mixed?.median, 51, 'the most recent COMPLETE row is the one quoted');

  // And the kept history never carries a zeroed volume.
  const hist = parsePrice('x')(body([day({ volume: null }), day({ datetime: '2026-09-05T00:00:00.000+00:00' })]));
  assert.equal(hist?.history.length, 1, 'the day with no volume is dropped from the series, not zeroed');
});

console.log(failures === 0 ? '\nall platinum rules hold' : `\n${String(failures)} platinum rule(s) broken`);
if (failures > 0) process.exit(1);
