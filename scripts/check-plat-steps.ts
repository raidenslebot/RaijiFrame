/**
 * Self-check for the bound farming steps.
 *
 * The rules that matter here are the two the whole app is built on, applied to
 * a new surface: a step never asserts something the app has not read, and an
 * affordance never opens onto nothing.
 *
 * Run: node scripts/check-plat-steps.ts
 */
import assert from 'node:assert/strict';
import { ROUTE_GUIDE, stepBind, stepText } from '../src/data/plat-guide.ts';
import { PLAIN_STEPS } from '../src/data/plat-plain.ts';
import DROP_SOURCES from '../src/data/vendor/drop-sources.json' with { type: 'json' };
import QUESTS from '../src/data/vendor/quests.json' with { type: 'json' };
import { PLAT_ROUTES } from '../src/data/plat-routes.ts';
import { MODELS, MODEL_GAPS } from '../src/data/plat-throughput.ts';
import { answers, resolveStep, type StepBind, type StepContext } from '../src/data/plat-steps.ts';
import type { Worldstate } from '../src/data/worldstate.ts';
import type { Holding, Relic } from '../src/data/plat-value.ts';
import type { SetVerdict } from '../src/data/set-completion.ts';
import type { Price } from '../src/data/market.ts';
import { buildCatalog, type Catalog } from '../src/data/catalog.ts';
import { derive, type AccountPicture } from '../src/data/progression.ts';
import type { RawInventory } from '../src/core/gep.ts';
import type { RawAccount } from '../src/data/account.ts';
import type { PlatPosition } from '../src/data/platinum.ts';
import type { Observed } from '../src/data/plat-throughput.ts';
import type { MissionRecord } from '../src/data/missionlog.ts';
import type { ItemDb } from '../src/data/itemdb.ts';

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

/* A fixed moment, so every countdown in here is exact rather than "about". */
const NOW = Date.parse('2026-09-03T12:00:00Z');
const IN_AN_HOUR = new Date(NOW + 60 * 60_000).toISOString();
const LONG_GONE = new Date(NOW - 60 * 60_000).toISOString();

const RELIC_TABLE: Relic[] = [
  { itemType: '/Lotus/Types/Game/Projections/T1VoidProjectionAIntact', tier: 'Lith', vaulted: false },
  /* Held (two of them) AND vaulted, so the tier is named. */
  {
    itemType: '/Lotus/Types/Game/Projections/T4VoidProjectionBIntact',
    tier: 'Axi',
    name: 'B1',
    vaulted: true,
    rewards: [
      { item: 'Mag Prime Chassis', rarity: 'Rare', chance: 2, itemType: 'a', slug: 'mag_prime_chassis' },
      { item: 'Forma Blueprint', rarity: 'Rare', chance: 6, itemType: 'f', slug: null },
      { item: 'A Common Thing', rarity: 'Common', chance: 25, itemType: 'c', slug: 'a_common_thing' },
    ],
  },
  /* Vaulted but a tier the account holds NONE of - must not be named. */
  { itemType: '/Lotus/Types/Game/Projections/T3VoidProjectionCIntact', tier: 'Neo', vaulted: true },
] as unknown as Relic[];

const WS: Worldstate = {
  timestamp: new Date(NOW).toISOString(),
  fissures: [
    { id: 'f1', node: 'Ur (Uranus)', missionType: 'MT_SURVIVAL', enemy: 'Grineer', tier: 'Axi', tierNum: 4, expiry: IN_AN_HOUR },
    { id: 'f2', node: 'Hepit (Void)', missionType: 'MT_CAPTURE', enemy: 'Corrupted', tier: 'Lith', tierNum: 1, expiry: IN_AN_HOUR },
    { id: 'f3', node: 'Gone (Ceres)', missionType: 'MT_EXTERMINATION', enemy: 'Grineer', tier: 'Neo', tierNum: 3, expiry: LONG_GONE },
  ],
  sortie: {
    boss: 'Vay Hek',
    faction: 'Grineer',
    expiry: IN_AN_HOUR,
    variants: [
      { missionType: 'MT_EXTERMINATION', modifier: 'Enhanced enemy shields', node: 'Cinxia (Ceres)' },
      { missionType: 'MT_SURVIVAL', modifier: 'Energy reduction', node: 'Selkie (Sedna)' },
      { missionType: 'MT_ASSASSINATION', modifier: 'Eximus stronghold', node: 'Oro (Earth)' },
    ],
  },
  voidTrader: { character: 'Baro Ki’Teer', location: 'Larunda Relay', expiry: IN_AN_HOUR } as Worldstate['voidTrader'],
  cetusCycle: { id: 'c', expiry: IN_AN_HOUR, state: 'night' },
  invasions: [
    {
      id: 'i1',
      node: 'Titan (Saturn)',
      completion: 42,
      attacker: { faction: 'Grineer', reward: { countedItems: [{ count: 1, type: 'Orokin Catalyst' }] } },
      defender: { faction: 'Corpus', reward: { countedItems: [{ count: 1, type: 'Orokin Reactor' }] } },
    },
    { id: 'i2', node: 'Done (Mars)', completed: true },
  ],
  steelPath: { currentReward: { name: 'Umbra Forma', cost: 150 }, expiry: IN_AN_HOUR, remaining: '3d 4h' },
};

/*
 * Priced stock and set gaps, as the panel computes them.
 *
 * One part worth real platinum and one worth almost nothing, so the ordering
 * and the "you would be throwing platinum away" warning are both exercised.
 */
const HOLD = [
  { gameRef: 'a', name: 'Mag Prime Chassis', slug: 'mag_prime_chassis', count: 3, price: null, worth: 36, ducats: 45, ducatWorth: 135 },
  { gameRef: 'b', name: 'Braton Prime Receiver', slug: 'braton_prime_receiver', count: 1, price: null, worth: 4, ducats: 15, ducatWorth: 15 },
] as unknown as readonly Holding[];

/*
 * Three sets on purpose, each proving a different rule:
 *   Hydroid  one part short, best per-trade  -> must come first
 *   Nekros   two parts short, worse per-trade -> must be listed, and second
 *   Rhino    THREE parts short                -> must be excluded entirely,
 *            because the step asks for "one or two pieces from a full set"
 *            and a list that quietly widened that is answering an easier
 *            question than the one printed on screen.
 */
const SETS = [
  { setSlug: 'hydroid_prime_set', name: 'Hydroid Prime', parts: ['a', 'b', 'c', 'd'], held: ['a', 'b', 'c'], missing: ['d'], setPrice: null, costs: new Map(), toBuy: 20, margin: 45, trades: 2, perTrade: 22.5 },
  { setSlug: 'nekros_prime_set', name: 'Nekros Prime', parts: ['a', 'b', 'c', 'd'], held: ['a', 'b'], missing: ['c', 'd'], setPrice: null, costs: new Map(), toBuy: 60, margin: 10, trades: 3, perTrade: 3.3 },
  { setSlug: 'rhino_prime_set', name: 'Rhino Prime', parts: ['a', 'b', 'c', 'd'], held: ['a'], missing: ['b', 'c', 'd'], setPrice: null, costs: new Map(), toBuy: 90, margin: 200, trades: 4, perTrade: 50 },
] as unknown as readonly SetVerdict[];

/*
 * The price book, as the throughput chain already built it.
 *
 * `nightmare-mods` sells four items; three are priced here and `stunning_speed`
 * is deliberately absent, because an item with no recent trades is a normal
 * state of the market and the list has to say so rather than drop it.
 */
const BOOK: ReadonlyMap<string, Price> = new Map([
  ['blaze', { median: 22, volume: 140 }],
  ['wildfire', { median: 8, volume: 60 }],
  ['hammer_shot', { median: 35, volume: 12 }],
] as unknown as Array<[string, Price]>);

/*
 * The item catalog, for the vault flags a holding does not carry.
 *
 * Mag's chassis is vaulted; Braton's receiver carries NO flag at all - and
 * absent means UNKNOWN, not "still dropping". That distinction is the whole
 * point of the step, so the fixture makes it the only difference between the
 * two sets.
 */
const ITEMS = {
  byType: new Map([
    ['a', { uniqueName: 'a', name: 'Mag Prime Chassis', vaulted: true }],
    ['b', { uniqueName: 'b', name: 'Braton Prime Receiver' }],
    /*
     * Powersuits, so the arcane-helmet codename join is actually exercised.
     * `Ninja` is the one that matters: nothing about the string says Ash, which
     * is exactly why the join has to come from the catalog rather than a table
     * somebody typed. The Prime is listed FIRST on purpose - the resolver must
     * still answer "Ash", because a helmet fits the whole family and "Ash Prime"
     * would be a narrower claim than the data supports.
     */
    ['/Lotus/Powersuits/Ninja/AshPrime', { uniqueName: '/Lotus/Powersuits/Ninja/AshPrime', name: 'Ash Prime' }],
    // Ash's base really is `/Ninja/Ninja` - BOTH segments are the codename.
    ['/Lotus/Powersuits/Ninja/Ninja', { uniqueName: '/Lotus/Powersuits/Ninja/Ninja', name: 'Ash' }],
    ['/Lotus/Powersuits/Rhino/Rhino', { uniqueName: '/Lotus/Powersuits/Rhino/Rhino', name: 'Rhino' }],
    ['/Lotus/Powersuits/Trinity/Trinity', { uniqueName: '/Lotus/Powersuits/Trinity/Trinity', name: 'Trinity' }],
    ['/Lotus/Powersuits/Volt/Volt', { uniqueName: '/Lotus/Powersuits/Volt/Volt', name: 'Volt' }],
    // Saryn exists, but under her OWN name - so `Asp` resolves to nothing and
    // the Asp helmets must say so rather than being handed a frame.
    ['/Lotus/Powersuits/Saryn/Saryn', { uniqueName: '/Lotus/Powersuits/Saryn/Saryn', name: 'Saryn' }],
    // The two frames `relic-farm` recommends. Both sit under a codename, which
    // is the whole reason the name has to be resolved through the catalog.
    ['/Lotus/Powersuits/Necro/Necro', { uniqueName: '/Lotus/Powersuits/Necro/Necro', name: 'Nekros' }],
    ['/Lotus/Powersuits/Pirate/Pirate', { uniqueName: '/Lotus/Powersuits/Pirate/Pirate', name: 'Hydroid' }],
    /*
     * The variant weapons, at their REAL paths.
     *
     * Braton Vandal is the case that matters: its path is `VIPRifle` and
     * contains no variant word at all, so the old substring matcher could never
     * find it. Prisma Gorgon is the same. Both fixtures used to spell the paths
     * the way the matcher wanted, which is what hid the miss.
     */
    ['/Lotus/Weapons/Tenno/Rifle/VIPRifle', { uniqueName: '/Lotus/Weapons/Tenno/Rifle/VIPRifle', name: 'Braton Vandal' }],
    ['/Lotus/Weapons/Corpus/Pistols/CrpHandRL/PrismaAngstrum', { uniqueName: '/Lotus/Weapons/Corpus/Pistols/CrpHandRL/PrismaAngstrum', name: 'Prisma Angstrum' }],
    ['/Lotus/Weapons/Grineer/Melee/GrineerMachetteAndCleaver/WraithMacheteWeapon', { uniqueName: '/Lotus/Weapons/Grineer/Melee/GrineerMachetteAndCleaver/WraithMacheteWeapon', name: 'Machete Wraith' }],
    ['/Lotus/Weapons/VoidTrader/PrismaGrakata', { uniqueName: '/Lotus/Weapons/VoidTrader/PrismaGrakata', name: 'Prisma Grakata' }],
    // A Dex weapon is NOT one of the three families this route sells.
    ['/Lotus/Weapons/Tenno/Melee/Swords/DexTheSecond/DexTheSecond', { uniqueName: '/Lotus/Weapons/Tenno/Melee/Swords/DexTheSecond/DexTheSecond', name: 'Dex Dakra' }],
  ]),
} as unknown as ItemDb;

/*
 * The raw log, for the node question.
 *
 * Two nodes of a type `relic-farm` is timed by, and one of a type it is not -
 * so the filter is exercised. One node's runs are UNATTRIBUTED, because a run
 * whose loot could not be read must not be reported as a node that dropped
 * nothing: that is the denominator rule `dropRates` states, and the easiest
 * one to break here.
 */
const LOG = [
  { node: 'Hydron (Sedna)', missionTypeName: 'Defense', durationMs: 9 * 60_000, lootAttributed: true, loot: [{ name: 'Meso B1 Relic', count: 1 }] },
  { node: 'Hydron (Sedna)', missionTypeName: 'Defense', durationMs: 11 * 60_000, lootAttributed: true, loot: [{ name: 'Meso B1 Relic', count: 1 }] },
  { node: 'Ukko (Void)', missionTypeName: 'Survival', durationMs: 20 * 60_000, lootAttributed: false, loot: [] },
  { node: 'Hepit (Void)', missionTypeName: 'Capture', durationMs: 2 * 60_000, lootAttributed: true, loot: [] },
] as unknown as readonly MissionRecord[];

/*
 * The mission log, reduced.
 *
 * `relic-farm` is timed by Survival, Defense, Disruption and Excavation. Two of
 * them are in the log and two are not, because the ones you have NEVER run are
 * the answer to "why can this route not be timed" - and that is exactly what
 * the single figure at the top of the card cannot say.
 */
const OBSERVED = {
  byType: new Map([
    ['Survival', { minutes: 12, runs: 9 }],
    ['Defense', { minutes: 8, runs: 3 }],
  ]),
  overall: { minutes: 10, runs: 12 },
  totalRuns: 12,
  session: null,
  squad: null,
} as unknown as Observed;

/*
 * The wallet position, as `platPosition` builds it.
 *
 * Three of nine trades spent and NO riven slot free, because both are the
 * states that change what a step should say: trades are the scarce thing, and
 * a full riven bin means a Sortie reward has nowhere to land.
 */
const POSITION = {
  held: 412,
  tradable: 412,
  untradable: 0,
  tradesLeft: 6,
  tradesCap: 9,
  ducats: 840,
  aya: 0,
  regalAya: 0,
  rivensHeld: 90,
  rivenSlotsFree: 0,
} as unknown as PlatPosition;

/*
 * An account that owns Nekros and not Hydroid.
 *
 * `relic-farm` names both, so one row is owned and one is not - which is the
 * whole point of listing them rather than collapsing to a single pill.
 */
/*
 * A REAL path. `/Lotus/Powersuits/Nekros/Nekros` does not exist: Nekros is
 * `/Lotus/Powersuits/Necro/Necro`, both segments being an internal codename.
 * This fixture invented the path the old implementation expected, so fixture
 * and code were wrong together and agreed - which is why the frame check passed
 * while `ownsFrame` was returning false for every real Nekros in the world.
 */
const ACCOUNT = { Suits: [{ ItemType: '/Lotus/Powersuits/Necro/Necro' }] } as unknown as RawAccount;

/*
 * A quest catalog and an account picture, built the way the app builds them.
 *
 * `Heart of Deimos` is finished and `Angels of the Zariman` is not, so the two
 * answers a bound step can give are both exercised. The chart is deliberately
 * PART way: 300 of 353, which is the state where "clear the star chart" is a
 * real instruction rather than a formality.
 */
const CATALOG = buildCatalog(
  [],
  [
    { id: '/Lotus/Types/Keys/HeartOfDeimos', name: 'Heart of Deimos', requires: [] },
    { id: '/Lotus/Types/Keys/AngelsOfTheZariman', name: 'Angels of the Zariman', requires: [] },
  ] as unknown as Parameters<typeof buildCatalog>[1],
  [],
);

const PICTURE = derive(
  {
    QuestKeys: [{ ItemType: '/Lotus/Types/Keys/HeartOfDeimos', Completed: true }],
    Missions: Array.from({ length: 300 }, (_, i) => ({ Tag: `SolNode${String(i)}`, Completes: 1 })),
  } as unknown as RawInventory,
  { nodeCount: 353, nodeIds: new Set(Array.from({ length: 353 }, (_, i) => `SolNode${String(i)}`)) },
  [],
);

/* A READ account: 840 Ducats, no Aya, Solaris rank 3, never joined the Arbiters. */
const INV_CANDIDATES = [
  { node: 'Tessera (Venus)', faction: 'Corpus', item: 'Orokin Catalyst Blueprint', count: 1, slug: 'orokin_catalyst_blueprint', price: null, worth: null },
  { node: 'Gaia (Earth)', faction: 'Grineer', item: 'Fieldron', count: 2, slug: 'fieldron', price: null, worth: null },
] as const;
const INV_PRICED = [
  { ...INV_CANDIDATES[0], worth: 42 },
  { ...INV_CANDIDATES[1], worth: null },
] as const;

const WITH_CURRENCY: StepContext = {
  invasionCandidates: INV_CANDIDATES,
  invasionOffers: INV_PRICED,
  ws: WS,
  inventory: {
    MiscItems: [{ ItemType: '/Lotus/Types/Items/MiscItems/PrimeBucks', ItemCount: 840 }],
    Affiliations: [{ Tag: 'SolarisSyndicate', Standing: 52_000, Title: 3 }],
  },
  items: ITEMS,
  log: LOG,
  observed: OBSERVED,
  position: POSITION,
  account: ACCOUNT,
  catalog: CATALOG,
  picture: PICTURE,
  routeId: 'nightmare-mods',
  prices: BOOK,
  relics: RELIC_TABLE,
  holdings: HOLD,
  sets: SETS,
  now: NOW,
};

/* An account that has been READ and holds two Axi and no Lith. */
const HELD = {
  MiscItems: [{ ItemType: '/Lotus/Types/Game/Projections/T4VoidProjectionBIntact', ItemCount: 2 }],
};

const FULL: StepContext = { invasionCandidates: INV_CANDIDATES, invasionOffers: INV_PRICED, items: ITEMS, log: LOG, observed: OBSERVED, position: POSITION, account: ACCOUNT, catalog: CATALOG, picture: PICTURE, routeId: 'nightmare-mods', prices: BOOK, ws: WS, inventory: HELD, relics: RELIC_TABLE, holdings: HOLD, sets: SETS, now: NOW };
const NO_WS: StepContext = { invasionCandidates: null, invasionOffers: null, items: ITEMS, log: LOG, observed: OBSERVED, position: POSITION, account: ACCOUNT, catalog: CATALOG, picture: PICTURE, routeId: 'nightmare-mods', prices: BOOK, ws: null, inventory: HELD, relics: RELIC_TABLE, holdings: HOLD, sets: SETS, now: NOW };
const NO_ACCOUNT: StepContext = { invasionCandidates: INV_CANDIDATES, invasionOffers: INV_PRICED, items: ITEMS, log: LOG, observed: OBSERVED, position: null, account: null, catalog: CATALOG, picture: null, routeId: 'nightmare-mods', prices: BOOK, ws: WS, inventory: null, relics: RELIC_TABLE, holdings: null, sets: null, now: NOW };

/** Every binding that appears anywhere in the guide, deduplicated. */
function boundInGuide(): StepBind[] {
  const out: StepBind[] = [];
  for (const guide of Object.values(ROUTE_GUIDE)) {
    for (const s of guide.steps) {
      const b = stepBind(s);
      if (b !== null) out.push(b);
    }
  }
  return out;
}

check('every route still has steps, and every step still has text', () => {
  for (const r of PLAT_ROUTES) {
    const g = ROUTE_GUIDE[r.id];
    assert.ok(g, `${r.id} lost its guide`);
    assert.ok(g.steps.length > 0, `${r.id} has no steps`);
    for (const s of g.steps) {
      const t = stepText(s);
      assert.ok(t.length > 10, `${r.id} has a step with no real text: ${t}`);
    }
  }
});

check('every route carries the detail that decides it, and does not repeat a step', () => {
  /*
   * `tips` is documented as "the things people get wrong, or the detail that
   * changes the outcome" - the sentence you wish you had read AFTER a run went
   * wrong. Fourteen routes had none at all, which is the same failure as a
   * route with no steps: the panel could rank it and could not warn you.
   *
   * The second assertion is the one that keeps them honest. A tip that repeats
   * a step is not a tip, it is the same sentence printed twice at a different
   * size, and it would satisfy a naive coverage count perfectly.
   */
  for (const [id, g] of Object.entries(ROUTE_GUIDE)) {
    assert.ok(g.tips !== undefined && g.tips.length > 0, `${id} has no tip, so nothing warns you off the trap`);
    const steps = g.steps.map((s) => stepText(s).toLowerCase());
    for (const tip of g.tips) {
      assert.ok(tip.length > 40, `${id} has a tip too short to say anything: "${tip}"`);
      const t = tip.toLowerCase();
      assert.ok(!steps.some((step) => step === t), `${id} has a tip that is a verbatim step`);
      /*
       * Overlap heuristic: a tip sharing a long opening clause with a step is
       * almost always that step reworded. Compared on the first eight words,
       * which is long enough to be a real sentence and short enough not to fire
       * on two sentences that merely start with "Sell the".
       */
      const head = t.split(/\s+/).slice(0, 8).join(' ');
      assert.ok(
        head.length < 20 || !steps.some((step) => step.startsWith(head)),
        `${id} has a tip that restates a step: "${tip.slice(0, 60)}"`,
      );
    }
  }
});

check('the guide actually binds something, or this whole layer is inert', () => {
  const bound = boundInGuide();
  assert.ok(bound.length >= 10, `only ${String(bound.length)} steps are bound`);
});

check('with nothing read, no binding invents an answer', () => {
  /*
   * THE RULE THIS FILE EXISTS FOR.
   * A step that cannot be answered must not report a zero, and must not offer a
   * press. "0 fissures open" on an unread world state would be a claim about
   * the game built entirely out of our own missing data.
   */
  const empty: StepContext = { invasionCandidates: null, invasionOffers: null, items: null, log: null, observed: null, position: null, account: null, catalog: null, picture: null, routeId: 'nightmare-mods', prices: null, ws: null, inventory: null, relics: null, holdings: null, sets: null, now: NOW };
  /*
   * A BINDING THAT ANSWERS FROM A VENDORED TABLE IS NOT INVENTING.
   * ————————————————————————————————————————————
   * This check exists to stop a resolver making claims about the PLAYER with
   * nothing read. `dropSource` makes no claim about the player at all: "which
   * mission drops this scene" has the same answer for everybody, and it comes
   * from a file on disk rather than from a read.
   *
   * The exemption is stated as its own assertion rather than as a skip - each
   * listed kind must actually ANSWER with nothing read, which is what makes it
   * static. A kind that goes quiet here is broken, not exempt, and an exemption
   * that stops being needed fails too.
   */
  const STATIC_KINDS = new Set(['dropSource']);
  for (const kind of STATIC_KINDS) {
    const bind = boundInGuide().find((b) => b.of === kind);
    assert.ok(bind !== undefined, `${kind} is exempted here but no step uses it`);
    const a = resolveStep(bind, empty);
    assert.ok(answers(a), `${kind} is exempted as static but answers nothing with no read`);
  }

  for (const bind of boundInGuide()) {
    if (STATIC_KINDS.has(bind.of)) continue;
    const a = resolveStep(bind, empty);
    assert.equal(a.headline, null, `${bind.of} invented a headline with nothing read`);
    assert.equal(a.rows.length, 0, `${bind.of} invented rows with nothing read`);
    assert.ok(a.unknown !== null, `${bind.of} gave no reason for having no answer`);
    assert.equal(answers(a), false, `${bind.of} would render a press that opens onto nothing`);
  }
});

check('a fissure list is ordered by what you can actually open', () => {
  const a = resolveStep({ of: 'fissures' }, FULL);
  assert.equal(a.headline, '1 of 2 you can open now', `headline was ${String(a.headline)}`);
  assert.equal(a.rows.length, 2, 'the expired fissure must not be listed');
  assert.equal(a.rows[0]?.lead, 'Axi', 'the tier you hold relics for must come first');
  assert.equal(a.rows[0]?.tone, 'good');
  assert.ok(a.rows[0]?.text.includes('2 held'), `row said: ${String(a.rows[0]?.text)}`);
  assert.equal(a.rows[1]?.tone, 'warn', 'a tier you hold none of is not actionable');
  assert.ok(a.rows[1]?.text.includes('none held'), `row said: ${String(a.rows[1]?.text)}`);
  assert.ok(!a.rows.some((r) => r.text.includes('Gone')), 'an expired fissure leaked into the list');
});

check('an unread account still gets the doors, and is told the keys are unknown', () => {
  /*
   * Which fissures are open is public. Which of them YOU can open is not. The
   * honest answer keeps the half it has rather than refusing both, and says so
   * in the headline instead of printing a zero.
   */
  const a = resolveStep({ of: 'fissures' }, NO_ACCOUNT);
  assert.ok(a.headline?.includes('unknown'), `headline was ${String(a.headline)}`);
  assert.ok(!/\b0 of\b/.test(a.headline ?? ''), 'an unread account was reported as able to open none');
  assert.equal(a.rows.length, 2, 'the open fissures are still worth listing');
  for (const r of a.rows) assert.equal(r.tone, 'muted', 'no fissure may be marked usable or unusable when the account is unread');
});

check('relics held report a measurement, and a zero only when measured', () => {
  const a = resolveStep({ of: 'relics' }, FULL);
  assert.ok(a.headline?.startsWith('2 held'), `headline was ${String(a.headline)}`);
  const lith = a.rows.find((r) => r.lead === 'Lith');
  assert.ok(lith, 'a tier the table knows must appear even at zero');
  assert.equal(lith.text, 'none held', 'a measured zero must say so in words');
  assert.equal(resolveStep({ of: 'relics' }, NO_ACCOUNT).headline, null, 'an unread account must not report a relic count');
});

check("today's sortie carries all three missions and their modifiers", () => {
  const a = resolveStep({ of: 'sortie' }, FULL);
  assert.ok(a.headline?.includes('Vay Hek'), `headline was ${String(a.headline)}`);
  assert.ok(a.headline?.includes('left'), 'the window has to be stated');
  assert.equal(a.rows.length, 3, 'a sortie is three missions');
  assert.ok(a.rows[0]?.text.includes('Enhanced enemy shields'), 'the modifier is the point of the row');
  assert.ok(a.rows[0]?.text.includes('Extermination'), `mission type not readable: ${String(a.rows[0]?.text)}`);
});

check('an expired sortie is unknown rather than stale', () => {
  const stale: StepContext = { ...FULL, ws: { ...WS, sortie: { ...WS.sortie, expiry: LONG_GONE } } as Worldstate };
  const a = resolveStep({ of: 'sortie' }, stale);
  assert.equal(a.headline, null, 'a sortie that has expired must not still be offered');
  assert.ok(a.unknown !== null, 'and must say why there is nothing');
});

check('Baro reads as present or absent, never as a fabricated countdown', () => {
  const here = resolveStep({ of: 'baro' }, FULL);
  assert.ok(here.headline?.includes('Larunda'), `headline was ${String(here.headline)}`);
  const gone: StepContext = { ...FULL, ws: { ...WS, voidTrader: { ...WS.voidTrader, expiry: LONG_GONE } } as Worldstate };
  const away = resolveStep({ of: 'baro' }, gone);
  assert.ok(away.headline?.includes('not at a relay'), `headline was ${String(away.headline)}`);
  assert.equal(away.rows.length, 0, 'an absent trader has nothing to list');
  assert.equal(away.unknown, null, 'his absence is a measurement, not an unknown');
});

check('a world cycle states which half it is in', () => {
  const a = resolveStep({ of: 'cycle', where: 'cetus' }, FULL);
  assert.ok(a.headline?.includes('night'), `headline was ${String(a.headline)}`);
  assert.ok(a.headline?.includes('Plains of Eidolon'), 'the place has to be named');
});

check('no worldstate means no cycle claim', () => {
  const a = resolveStep({ of: 'cycle', where: 'cetus' }, NO_WS);
  assert.equal(a.headline, null);
  assert.ok(a.unknown !== null);
});

check('a currency balance is a measurement, and its absence is not zero', () => {
  const held = resolveStep({ of: 'currency', which: 'ducats' }, WITH_CURRENCY);
  assert.equal(held.headline, '840 Ducats held', `headline was ${String(held.headline)}`);

  // Read, and none of it held. That IS a measurement and must say so.
  const none = resolveStep({ of: 'currency', which: 'aya' }, WITH_CURRENCY);
  assert.equal(none.headline, '0 Aya held', 'a read account with no Aya must report a measured zero');

  const unread = resolveStep({ of: 'currency', which: 'ducats' }, NO_ACCOUNT);
  assert.equal(unread.headline, null, 'an unread account must not report a balance');
  assert.ok(unread.unknown?.includes('Ducats'), 'and must name what it could not read');
});

check('standing reports the rank as an index, never as an invented name', () => {
  const a = resolveStep({ of: 'standing', tag: 'SolarisSyndicate', who: 'Solaris United' }, WITH_CURRENCY);
  assert.ok(a.headline?.includes('Solaris United'), `headline was ${String(a.headline)}`);
  assert.ok(a.headline?.includes('rank 3'), 'the rank index has to be stated');
  /*
   * `Title` is an index and this app holds no primary-source table mapping it
   * to "Old Mate". Printing a rank NAME here would be the one thing the
   * account model explicitly forbids, so the check pins its absence.
   */
  assert.ok(!/old mate|rank name/i.test(a.headline ?? ''), 'a rank index was dressed up as a name');

  const notJoined = resolveStep({ of: 'standing', tag: 'ArbitersSyndicate', who: 'the Arbiters' }, WITH_CURRENCY);
  assert.ok(notJoined.headline?.includes('no standing'), 'a read account that never joined is a measurement');
  assert.equal(notJoined.unknown, null, 'and is not an unknown');
});

check('an invasion carries both sides, because it is a choice', () => {
  const a = resolveStep({ of: 'invasions' }, FULL);
  assert.equal(a.headline, '1 running', `headline was ${String(a.headline)}`);
  assert.equal(a.rows.length, 1, 'a completed invasion must be dropped');
  assert.ok(a.rows[0]?.text.includes('Orokin Catalyst'), 'the attacker reward is half the answer');
  assert.ok(a.rows[0]?.text.includes('Orokin Reactor'), 'and the defender reward is the other half');
});

check("Teshin's offer states what it costs", () => {
  const a = resolveStep({ of: 'steelPath' }, FULL);
  assert.ok(a.headline?.includes('Umbra Forma'), `headline was ${String(a.headline)}`);
  assert.ok(a.headline?.includes('150 Essence'), 'the price is the point of the row');
});

check('every binding kind in the union is exercised by a real step', () => {
  /*
   * A kind nobody binds is dead code with no test behind it - which is how the
   * first draft of this file shipped an `events` and a `darvo` resolver that
   * no farming step ever names. Both were removed rather than left to rot.
   */
  const used = new Set<StepBind['of']>(boundInGuide().map((b) => b.of));
  /*
   * Typed as the union rather than as `string[]`, so adding a member to
   * `StepBind` without listing it here is a COMPILE error and not a silently
   * unchecked kind. The list is the point of the check; letting it drift would
   * make it decorative.
   */
  const declared: readonly StepBind['of'][] = [
    'fissures',
    'relics',
    'sortie',
    'archon',
    'baro',
    'varzia',
    'cycle',
    'nightwave',
    'invasions',
    'steelPath',
    'currency',
    'standing',
    'spare',
    'nearSets',
    'sells',
    'quest',
    'chart',
    'frames',
    'nemesis',
    'trades',
    'rivens',
    'intrinsics',
    'runs',
    'syndicates',
    'wallet',
    'cycles',
    'spots',
    'foundry',
    'vaultedSets',
    'credits',
    'variants',
    'relicRewards',
    'ayatan',
    'lenses',
    'kahl',
    'invasionValue',
    'planets',
    'nemesisNode',
    'circuit',
    'dropSource',
    'netracells',
    'marooHunt',
    'arcaneHelmets',
  ];
  for (const kind of declared) assert.ok(used.has(kind), `no step binds '${kind}', so it is untested dead code`);
  for (const kind of used) assert.ok(declared.includes(kind), `'${kind}' is bound but not in the declared list`);
});

check('spare parts rank by ducats, and flag the ones worth more as platinum', () => {
  const a = resolveStep({ of: 'spare' }, FULL);
  assert.ok(a.headline?.startsWith('150 Ducats'), `headline was ${String(a.headline)}`);
  assert.equal(a.rows[0]?.lead, '135d', 'the biggest ducat pile comes first');
  /*
   * Amber, not green: 36 platinum is worth more than 135 Ducats to most
   * players, so recommending the kiosk for it would be the panel talking
   * somebody out of money. The threshold is a judgement and is stated as one.
   */
  assert.equal(a.rows[0]?.tone, 'warn', 'a part worth real platinum must not read as free ducats');
  assert.equal(a.rows[1]?.tone, 'good', 'a part worth almost nothing is exactly what a kiosk is for');
  assert.equal(resolveStep({ of: 'spare' }, NO_ACCOUNT).headline, null, 'an unread account holds nothing knowable');
});

check('near-complete sets rank by margin PER TRADE, and state the gap cost', () => {
  const a = resolveStep({ of: 'nearSets' }, FULL);
  assert.equal(a.headline, '2 within two parts', `headline was ${String(a.headline)}`);
  assert.ok(a.rows[0]?.text.startsWith('Hydroid Prime'), `first row was ${String(a.rows[0]?.text)}`);
  assert.equal(a.rows[0]?.lead, '1 to buy');
  assert.ok(a.rows[0]?.text.includes('20p to finish'), 'the cost of the gap is the actionable half');
  assert.equal(a.rows[0]?.tone, 'good', 'a positive margin is worth doing');
  /*
   * A set three or more parts short is NOT listed. The step asks for "one or
   * two pieces from a full set" and a list that quietly widened that would be
   * answering an easier question than the one on screen.
   */
  assert.ok(
    !a.rows.some((r) => r.text.includes('Rhino')),
    'a set three parts short must be excluded even though its margin is the largest on the board',
  );
  assert.ok(a.rows[1]?.text.startsWith('Nekros'), 'the two-part set is listed, and ranks below the one-part set');
  assert.equal(resolveStep({ of: 'nearSets' }, NO_ACCOUNT).headline, null, 'an unread account has no set gaps');
});

check('a route lists what IT sells, priced, with the unpriced ones kept', () => {
  const a = resolveStep({ of: 'sells' }, FULL);
  assert.equal(a.headline, '3 of 4 priced', `headline was ${String(a.headline)}`);
  assert.equal(a.rows[0]?.lead, '35p', 'the dearest comes first, because the step is "which do I list"');
  /*
   * `stunning_speed` has no quote and is STILL listed. An item with no recent
   * trades is a fact about the market worth knowing before you farm for it, and
   * dropping it would quietly shorten the route's own item list.
   */
  const unpriced = a.rows.find((r) => r.text.startsWith('stunning speed'));
  assert.ok(unpriced, 'an unpriced item was dropped from the list it belongs to');
  assert.ok(unpriced.text.includes('no quote yet'), 'and must say why it has no number');
  assert.ok(
    !/traded|trades/i.test(unpriced.text),
    'absence from the price book is OUR missing request, never a claim that the item does not trade',
  );
  assert.equal(unpriced.tone, 'muted', 'an unpriced item is not actionable');
});

check('a route with no item list says so rather than selling nothing', () => {
  /*
   * Not every route declares representatives - the ones that do not are the
   * ones whose output is a currency or a one-off. An empty list there would
   * read as "this route sells nothing", which is false.
   */
  const a = resolveStep({ of: 'sells' }, { ...FULL, routeId: 'flipping' });
  assert.equal(a.headline, null);
  assert.ok(a.unknown?.includes('representative item list'), `said: ${String(a.unknown)}`);
  assert.equal(answers(a), false, 'and must not offer a press');
});

check('every slug a step will price is one the slug gate checks', () => {
  /*
   * The binding never invents an item: it reads the route's own slug list. This
   * asserts the join actually resolves, so a route bound to `sells` whose model
   * lost its price block fails HERE rather than rendering an empty drill.
   */
  for (const [id, g] of Object.entries(ROUTE_GUIDE)) {
    if (!g.steps.some((s) => stepBind(s)?.of === 'sells')) continue;
    const model = MODELS[id];
    assert.ok(model, `${id} binds 'sells' with no throughput model`);
    assert.equal(model.price.kind, 'market', `${id} binds 'sells' but declares no item list`);
    if (model.price.kind === 'market') {
      assert.ok(model.price.slugs.length > 0, `${id} declares an empty item list`);
    }
  }
});

check('a named quest reports finished, unfinished, or unknowable - never guessed', () => {
  const done = resolveStep({ of: 'quest', name: 'Heart of Deimos' }, FULL);
  assert.equal(done.headline, 'Heart of Deimos is finished', `said: ${String(done.headline)}`);

  const notYet = resolveStep({ of: 'quest', name: 'Angels of the Zariman' }, FULL);
  assert.equal(notYet.headline, 'Angels of the Zariman is not finished yet', `said: ${String(notYet.headline)}`);

  /*
   * The third answer, and the one that matters. An unread account must not be
   * told it has not finished a quest - that is a claim about the player made
   * out of our own missing data, and it is the exact bug this session removed
   * from `questDone` itself.
   */
  const unread = resolveStep({ of: 'quest', name: 'Heart of Deimos' }, NO_ACCOUNT);
  assert.equal(unread.headline, null, 'an unread account was told whether it finished a quest');
  assert.ok(unread.unknown !== null, 'and must say why there is no answer');
  assert.equal(answers(unread), false, 'and must not offer a press');
});

check('a quest the catalog does not carry says so, rather than reading as unfinished', () => {
  const a = resolveStep({ of: 'quest', name: 'A Quest That Does Not Exist' }, FULL);
  assert.equal(a.headline, null);
  assert.ok(a.unknown?.includes('no quest called'), `said: ${String(a.unknown)}`);
});

check('the star chart states how far off it is, and never a percentage it cannot compute', () => {
  const a = resolveStep({ of: 'chart' }, FULL);
  assert.equal(a.headline, '53 nodes left of 353', `said: ${String(a.headline)}`);
  assert.equal(a.rows[0]?.lead, '85.0%');
  assert.equal(a.rows[0]?.tone, 'warn', 'an unfinished chart is not yet actionable');

  const unread = resolveStep({ of: 'chart' }, NO_ACCOUNT);
  assert.equal(unread.headline, null, 'an unread account must not be given a chart percentage');
  assert.ok(unread.unknown !== null);
});

check('every frame that changes the yield is listed, owned ones first, reasons kept', () => {
  const a = resolveStep({ of: 'frames' }, { ...FULL, routeId: 'relic-farm' });
  assert.equal(a.headline, '1 of 2 owned', `said: ${String(a.headline)}`);
  assert.equal(a.rows.length, 2, 'both frames must be listed, not just the best one');
  assert.equal(a.rows[0]?.lead, 'owned', 'the one you can actually bring comes first');
  assert.ok(a.rows[0]?.text.startsWith('Nekros'), `first row was ${String(a.rows[0]?.text)}`);
  /*
   * The REASON survives. `bestFrame` kept one frame's `why` and dropped every
   * other, which is what made a list of yield-changing abilities read as a
   * single suggestion.
   */
  assert.ok(a.rows[0]?.text.includes('Desecrate'), 'the reason the frame matters must survive');
  assert.equal(a.rows[1]?.tone, 'warn', 'a frame you do not own is not something you can bring');
  assert.ok(a.rows[1]?.text.includes('Pilfering'), 'and its reason is worth knowing anyway');
});

check('an unread account is not told which frames it lacks', () => {
  const a = resolveStep({ of: 'frames' }, { ...NO_ACCOUNT, routeId: 'relic-farm' });
  assert.ok(a.headline?.includes('unknown'), `said: ${String(a.headline)}`);
  assert.ok(!/\b0 of\b/.test(a.headline ?? ''), 'an unread account was reported as owning none');
  for (const r of a.rows) assert.equal(r.tone, 'muted', 'no frame may be marked owned or missing when nothing was read');
});

check('a route with no yield-changing frame says so rather than listing none', () => {
  const a = resolveStep({ of: 'frames' }, { ...FULL, routeId: 'flipping' });
  assert.equal(a.headline, null);
  assert.ok(a.unknown?.includes('no frame changes'), `said: ${String(a.unknown)}`);
  assert.equal(answers(a), false);
});

check('an active nemesis reports its real murmur progress, and never its weapon', () => {
  const hunting = {
    Suits: [{ ItemType: '/Lotus/Powersuits/Necro/Necro' }],
    Nemesis: { Faction: 'FC_GRINEER', Hints: [0, 1], GuessHistory: [3], MissionCount: 7, WeaponIdx: 4 },
  } as unknown as RawAccount;

  const a = resolveStep({ of: 'nemesis' }, { ...FULL, account: hunting });
  assert.equal(a.headline, 'Kuva Lich · 2 of 3 hints', `said: ${String(a.headline)}`);
  assert.equal(a.rows[0]?.lead, '2 of 3');
  assert.equal(a.rows[0]?.tone, 'warn', 'an incomplete sequence is not yet actionable');
  assert.ok(a.rows.some((r) => r.text.includes('guesses made')), 'guesses already spent are part of the position');

  /*
   * THE WEAPON IS NOT NAMED, AND ITS ABSENCE IS STATED.
   * `ActiveNemesis.weapon` is typed `null` on purpose - the payload holds an
   * index into a manifest this app does not load, and `subsystems` says
   * outright that guessing would be fabrication. This pins that the step layer
   * does not quietly reach past it, and that the gap is EXPLAINED rather than
   * left looking like "it has no weapon".
   */
  const weaponRow = a.rows.find((r) => r.lead === 'weapon');
  assert.ok(weaponRow, 'the missing weapon must be accounted for, not silently absent');
  assert.ok(weaponRow.text.includes('manifest'), 'and must say why it is missing');
  /*
   * "Kuva Lich" is the LINE, derived from the faction tag, and is fine. What
   * must never appear is a weapon: `Kuva Nukor`, `Tenet Envoy`. The first
   * version of this assertion banned "Kuva " outright and failed on the
   * headline - too blunt a net catches the legitimate use and teaches you to
   * loosen the check rather than sharpen it.
   */
  const text = JSON.stringify(a);
  assert.ok(!/kuva (?!lich)\w/i.test(text), 'a Kuva WEAPON name was invented from an index');
  assert.ok(!/tenet \w/i.test(text), 'a Tenet weapon name was invented from an index');
});

check('a read account with no nemesis is a measurement, not an unknown', () => {
  const none = { Suits: [], NemesisHistory: [] } as unknown as RawAccount;
  const a = resolveStep({ of: 'nemesis' }, { ...FULL, account: none });
  assert.ok(a.headline?.includes('no nemesis right now'), `said: ${String(a.headline)}`);
  assert.equal(a.unknown, null, 'having none is a fact about the account, not a gap in our reading');

  const unread = resolveStep({ of: 'nemesis' }, { ...FULL, account: null });
  assert.equal(unread.headline, null, 'an unread account must not be told it has no nemesis');
  assert.ok(unread.unknown !== null);
});

check('trades report what is LEFT, not just the cap', () => {
  const a = resolveStep({ of: 'trades' }, FULL);
  assert.equal(a.headline, '6 left today of 9', `said: ${String(a.headline)}`);
  /*
   * Both halves, because they answer different questions. The cap is your rank
   * and never moves; what is LEFT is what decides whether to spend one on six
   * Ayatan stars. A step showing only the cap would be answering the easier one.
   */
  assert.ok(a.rows.some((r) => r.text.includes('per-trade limit')), 'the six-item limit is the arithmetic the step needs');
  assert.equal(resolveStep({ of: 'trades' }, NO_ACCOUNT).headline, null, 'an unread account must not report trades');
});

check('a full riven bin is stated as the blocker it is', () => {
  const a = resolveStep({ of: 'rivens' }, FULL);
  assert.equal(a.headline, '90 rivens held', `said: ${String(a.headline)}`);
  const slot = a.rows[0];
  assert.ok(slot, 'the slot row is the actionable half');
  assert.equal(slot.lead, 'full');
  assert.equal(slot.tone, 'warn', 'no room is a warning, not a neutral fact');
  assert.ok(slot.text.includes('nowhere to land'), 'and must say what that costs you');

  /*
   * `rivenSlotsFree` counts REMAINING slots, not capacity - the bin misread
   * `subsystems` documents. A zero therefore means FULL, and reading it as
   * "no capacity configured" would invert the advice completely.
   */
  const roomy = resolveStep({ of: 'rivens' }, { ...FULL, position: { ...POSITION, rivenSlotsFree: 4 } as PlatPosition });
  assert.equal(roomy.rows[0]?.tone, 'good', 'free slots are not a warning');
  assert.ok(roomy.rows[0]?.text.includes('slots free'));

  assert.equal(resolveStep({ of: 'rivens' }, NO_ACCOUNT).headline, null, 'an unread account must not report rivens');
});

/*
 * THE AUDIT, ENCODED SO IT CANNOT ROT.
 * ————————————————————————————————————————————
 * Every pass over the guide has found steps I had previously written off as
 * "universal procedure" - the arsenal bucket, the nemesis bucket, six quest and
 * chart steps. Reading them again is not a strategy; the reading has to be
 * something the suite performs.
 *
 * So: if a step's own words name a thing the app can answer, it must either
 * carry that binding or appear below with a reason. A new or reworded step that
 * matches and does neither FAILS, which forces the decision at the moment
 * somebody writes it rather than three audits later.
 */
const ANSWERABLE: ReadonlyArray<{ kind: StepBind['of']; pattern: RegExp }> = [
  { kind: 'fissures', pattern: /\bfissure/i },
  { kind: 'sortie', pattern: /\bsortie/i },
  { kind: 'archon', pattern: /archon hunt/i },
  { kind: 'baro', pattern: /\bbaro\b|void trader/i },
  { kind: 'varzia', pattern: /\bvarzia\b/i },
  { kind: 'nightwave', pattern: /\bnightwave\b/i },
  { kind: 'invasions', pattern: /\binvasion/i },
  { kind: 'currency', pattern: /\bducat|\baya\b/i },
  { kind: 'chart', pattern: /star chart/i },
  { kind: 'nemesis', pattern: /\bmurmur\b/i },
  { kind: 'rivens', pattern: /veiled riven|riven at a mod station/i },
];

/**
 * Steps that match a pattern and are deliberately NOT bound.
 *
 * Each one is a decision with a reason, not an oversight. The reasons are the
 * valuable part: they are the places where an obvious-looking binding would
 * have been wrong, and every one of them was nearly made.
 */
const EXCUSED: ReadonlyArray<{ contains: string; why: string }> = [
  {
    contains: 'Talk to Teshin in any relay and queue for Conclave',
    why: 'this Teshin sells CONCLAVE, not the Steel Path offer — binding steelPath here would show a price for a different shop',
  },
  {
    contains: 'Note the weapon and element it shows',
    why: 'the weapon is exactly what the app cannot know: the payload stores an index into a manifest it does not load',
  },
  {
    contains: 'collect ten Reactant, exactly as in a ground fissure',
    why: 'the sentence is procedure about Reactant; a list of live fissures answers a question it is not asking',
  },
];

check('no step names something the app can answer and leaves it plain', () => {
  const missed: string[] = [];
  for (const [id, g] of Object.entries(ROUTE_GUIDE)) {
    for (const step of g.steps) {
      if (stepBind(step) !== null) continue;
      const text = stepText(step);
      if (EXCUSED.some((e) => text.includes(e.contains))) continue;
      for (const { kind, pattern } of ANSWERABLE) {
        if (pattern.test(text)) missed.push(`${id} could bind '${kind}': "${text.slice(0, 70)}"`);
      }
    }
  }
  assert.deepEqual(missed, [], `steps naming answerable data but left plain:\n  ${missed.join('\n  ')}`);
});

check('every excuse still applies to a step that exists', () => {
  /*
   * An excuse for a step nobody wrote any more is dead weight that makes the
   * check above weaker - it would silently permit a future step that happens to
   * contain the same words.
   */
  const all = Object.values(ROUTE_GUIDE).flatMap((g) => g.steps.map((s) => stepText(s)));
  for (const e of EXCUSED) {
    assert.ok(
      all.some((t) => t.includes(e.contains)),
      `an excuse names a step that no longer exists: "${e.contains}"`,
    );
  }
});

check('Railjack competence is reported as ranks, never as a verdict on you', () => {
  const flying = {
    Suits: [],
    PlayerSkills: { LPS_PILOTING: 7, LPS_GUNNERY: 3 },
  } as unknown as RawAccount;
  const a = resolveStep({ of: 'intrinsics' }, { ...FULL, account: flying, routeId: 'void-storms' });
  assert.equal(a.headline, 'effective rank 3', `said: ${String(a.headline)} — the WEAKER half is the rank that binds`);
  const want = a.rows.find((r) => r.lead.startsWith('wants'));
  assert.ok(want, 'the rank the route asks for must be stated');
  assert.equal(want.tone, 'warn', 'being under it is worth flagging');
  /*
   * `intrinsics` is explicit that the threshold is a judgement and that
   * "somebody skilled at the game will manage below it". So the wording must
   * never pronounce the player incapable - it states the gap and stops.
   */
  assert.ok(!/cannot|can't|unable|not ready/i.test(JSON.stringify(a)), 'a rank gap was turned into a verdict on the player');
  assert.ok(want.text.includes('workable'), 'and must say the gap is workable');

  assert.equal(resolveStep({ of: 'intrinsics' }, { ...FULL, account: null }).headline, null, 'an unread account has no ranks');
});

check('the runs behind a timing name the types you have NEVER run', () => {
  const a = resolveStep({ of: 'runs' }, { ...FULL, routeId: 'relic-farm' });
  assert.ok(a.headline?.includes('measured'), `said: ${String(a.headline)}`);
  const never = a.rows.filter((r) => r.lead === 'none');
  assert.ok(never.length > 0, 'a type with no runs is the answer to "why is this not timed", and must be listed');
  assert.ok(never[0]?.text.includes('not run one'), 'and must say so plainly');
  assert.equal(never[0]?.tone, 'warn');
  const measured = a.rows.find((r) => r.text.includes('Survival'));
  assert.ok(measured?.text.includes('12 minutes'), 'a measured type carries its median');
  assert.equal(measured?.lead, '9', 'and the sample size behind it');

  assert.equal(resolveStep({ of: 'runs' }, { ...FULL, observed: null }).headline, null, 'an unread log has no timings');
});

/**
 * Routes where NOTHING can be bound, and why.
 *
 * A route with no live step at all is either an oversight or a fact about the
 * data. These three are the fact: nothing the app fetches touches them, and
 * saying so here is what keeps the distinction visible.
 */
const NO_DATA_ROUTES: ReadonlyArray<{ id: string; why: string }> = [
];

check('no route hides a checkable requirement in unverified prose', () => {
  /*
   * WHAT THIS CAUGHT.
   * `sister-weapons` declared `needsGear: ['lich']` and put the ship in
   * `alsoNeeds`: "A Railjack, for the Sister's final confrontation." That field
   * is documented as the thing this list exists to replace - "prose that was
   * never checked against anything... a player with no Necramech was cheerfully
   * told to run Isolation Vaults by a panel holding their entire inventory".
   *
   * It is not soft. The confrontation happens in Railjack, so a player without
   * one can create a Sister, work her murmur to the end and be unable to
   * finish. The route's own tip warns about exactly that, which made it worse:
   * the panel knew to warn and did not know to check.
   *
   * A step's PROSE naming gear is fine - "bring an Archgun" is advice. This
   * only fires on `alsoNeeds`, which is the field claiming to state a
   * requirement.
   */
  const CHECKABLE: ReadonlyArray<{ gear: string; pattern: RegExp }> = [
    { gear: 'railjack', pattern: /\brailjack\b/i },
    { gear: 'necramech', pattern: /\bnecramech\b/i },
    { gear: 'amp', pattern: /\bamp\b/i },
    { gear: 'companion', pattern: /\bkubrow\b|\bkavat\b/i },
  ];
  const hidden: string[] = [];
  for (const route of PLAT_ROUTES) {
    const prose = route.alsoNeeds;
    if (prose === null) continue;
    const declared = new Set<string>(route.needsGear ?? []);
    for (const { gear, pattern } of CHECKABLE) {
      if (pattern.test(prose) && !declared.has(gear)) {
        hidden.push(`${route.id}: alsoNeeds names ${gear} but needsGear does not — "${prose.slice(0, 50)}"`);
      }
    }
  }
  assert.deepEqual(hidden, [], `requirements the app can verify, left in prose:\n  ${hidden.join('\n  ')}`);
});

check('a route with no live step at all is a decision, not an oversight', () => {
  const bare = Object.entries(ROUTE_GUIDE)
    .filter(([, g]) => !g.steps.some((s) => stepBind(s) !== null))
    .map(([id]) => id);
  const excused = new Set(NO_DATA_ROUTES.map((r) => r.id));
  const unexplained = bare.filter((id) => !excused.has(id));
  assert.deepEqual(unexplained, [], `routes with nothing live and no reason given: ${unexplained.join(', ')}`);

  /*
   * And the reverse: an excuse for a route that HAS gained a binding is stale,
   * and would go on permitting a future regression on that route.
   */
  for (const r of NO_DATA_ROUTES) {
    assert.ok(bare.includes(r.id), `${r.id} now has a live step, so its no-data excuse is stale`);
  }
});

check('the six faction syndicates report where you already stand', () => {
  const sworn = {
    Suits: [],
    Affiliations: [
      { Tag: 'RedVeilSyndicate', Standing: 44_000, Title: 3 },
      { Tag: 'NewLokaSyndicate', Standing: -5_000, Title: -1 },
    ],
  } as unknown as RawAccount;
  const a = resolveStep({ of: 'syndicates' }, { ...FULL, account: sworn });
  assert.equal(a.headline, '1 of 6 above neutral', `said: ${String(a.headline)}`);
  assert.equal(a.rows.length, 6, 'all six are the choice, so all six are listed');
  assert.equal(a.rows[0]?.text, 'Red Veil', 'the one you are furthest along with comes first');
  /*
   * A NEGATIVE rank is a real state - a syndicate you have wronged sits below
   * neutral - and must not read as "not joined yet". `syndicateRank` documents
   * that trap; this pins that the tone tells them apart.
   */
  const loka = a.rows.find((r) => r.text === 'New Loka');
  assert.equal(loka?.lead, 'rank -1');
  assert.equal(loka?.tone, 'warn', 'a negative rank is a warning, not a neutral blank');
  assert.equal(resolveStep({ of: 'syndicates' }, { ...FULL, account: null }).headline, null);
});

check('the wallet separates what you can spend from what you can trade', () => {
  const a = resolveStep(
    { of: 'wallet' },
    { ...FULL, position: { ...POSITION, held: 500, tradable: 420, untradable: 80 } as PlatPosition },
  );
  assert.equal(a.headline, '500 platinum held', `said: ${String(a.headline)}`);
  /*
   * Starter and gift platinum spends but never trades, so a wallet that looks
   * healthy can still be unable to buy a set from another player. That is the
   * one thing the flipping route turns on.
   */
  assert.ok(a.rows[0]?.text.includes('never tradable'), 'the untradable portion has to be called out');
  assert.equal(a.rows[0]?.lead, '420p');
});

check('your own nodes answer "where do I go", filtered to this route\u2019s types', () => {
  const a = resolveStep({ of: 'spots' }, { ...FULL, routeId: 'relic-farm' });
  assert.ok(a.headline?.includes('your own nodes'), `said: ${String(a.headline)}`);
  /*
   * Hepit is a Capture and `relic-farm` is not timed by Capture, so it must not
   * appear. A list that ignored the route's own mission types would be
   * answering "where have you been" rather than "where should I go for THIS".
   */
  assert.ok(!a.rows.some((r) => r.text.includes('Hepit')), 'a node of the wrong mission type leaked in');
  assert.ok(a.rows[0]?.text.includes('Hydron'), 'the node with the most runs comes first');
  assert.equal(a.rows[0]?.lead, '2\u00d7');
  assert.ok(a.rows[0]?.text.includes('10 min each'), 'the median time is the actionable half');

  /*
   * THE DENOMINATOR RULE. Ukko's runs were unattributed, so its loot is
   * UNKNOWN. Reporting it as a node that dropped nothing would understate it
   * exactly as `dropRates` warns.
   */
  const ukko = a.rows.find((r) => r.text.includes('Ukko'));
  assert.ok(ukko, 'an unattributed node is still a place you have been');
  assert.ok(ukko.text.includes('not attributed'), 'and must say its loot is unknown, not absent');
  assert.ok(!ukko.text.includes('nothing dropped'), 'unattributed was reported as a measured zero');
  assert.equal(ukko.tone, 'muted');

  assert.equal(resolveStep({ of: 'spots' }, { ...FULL, log: null }).headline, null, 'an unread log has no nodes');
});

check('the foundry queue keeps ready, building and unknown apart', () => {
  const cooking = {
    Suits: [],
    PendingRecipes: [
      { ItemType: '/Lotus/Types/Keys/DragonKeyBleeding', CompletionDate: { sec: Math.floor(NOW / 1000) - 60 } },
      { ItemType: '/Lotus/Types/Keys/DragonKeyDecaying', CompletionDate: { sec: Math.floor(NOW / 1000) + 7200 } },
      { ItemType: '/Lotus/Types/Keys/DragonKeyHobbled' },
    ],
  } as unknown as RawAccount;

  const a = resolveStep({ of: 'foundry' }, { ...FULL, account: cooking });
  assert.equal(a.headline, '1 ready to claim of 3', `said: ${String(a.headline)}`);
  assert.equal(a.rows[0]?.lead, 'ready', 'the finished one comes first, because it is the actionable one');
  assert.ok(a.rows[0]?.text.includes('ready to claim'));

  /*
   * THE TRAP `pendingBuilds` DOCUMENTS. There is no "ready" boolean in the
   * payload - only a completion date - so a build with NO date must read as
   * not-ready with the reason, never as finished.
   */
  const dateless = a.rows.find((r) => r.text.includes('Hobbled'));
  assert.ok(dateless, 'a build with no completion time is still in the queue');
  assert.equal(dateless.lead, 'building', 'a missing date must not be read as finished');
  assert.ok(dateless.text.includes('no completion time'), 'and must say why it has no countdown');

  /* An empty foundry is a measurement; an unread account is not. */
  const idle = resolveStep({ of: 'foundry' }, { ...FULL, account: { Suits: [] } as unknown as RawAccount });
  assert.ok(idle.headline?.includes('a slot is free'), `said: ${String(idle.headline)}`);
  assert.equal(idle.unknown, null);
  assert.equal(resolveStep({ of: 'foundry' }, { ...FULL, account: null }).headline, null);
});

check('the relic count names the tiers whose relics can never be farmed again', () => {
  const a = resolveStep({ of: 'relics' }, FULL);
  const vault = a.rows.find((r) => r.lead === 'vaulted');
  assert.ok(vault, 'the vaulted flag was on every row of the table and was being thrown away');
  assert.ok(vault.text.startsWith('Axi'), `said: ${String(vault.text)}`);
  /*
   * Neo is vaulted in the table and the account holds NONE of it. Naming it
   * would tell somebody they were sitting on something they do not have -
   * which is the same shape of error as reporting an unread count as a zero.
   */
  assert.ok(!vault.text.includes('Neo'), 'a vaulted tier the account holds none of must not be named');
  assert.ok(vault.text.includes('never farmed again'), 'and must say why it matters');
});

check('a vaulted set is only one a part POSITIVELY says is vaulted', () => {
  const a = resolveStep({ of: 'vaultedSets' }, FULL);
  assert.equal(a.headline, '1 of 2 sets are vaulted', `said: ${String(a.headline)}`);
  assert.ok(a.rows[0]?.text.includes('mag prime'), `first row was ${String(a.rows[0]?.text)}`);

  /*
   * THE ABSENT FLAG. Braton's entry carries no `vaulted` field, and the catalog
   * is explicit that absent means UNKNOWN rather than "not vaulted". Folding it
   * into the not-vaulted pile would invert the step: somebody would be told a
   * set still drops when nobody knows. It is counted and NAMED as unsettled.
   */
  const unsettled = a.rows.find((r) => r.lead === 'unsettled');
  assert.ok(unsettled, 'a set the catalog cannot settle must be named, not filed under "not vaulted"');
  assert.ok(unsettled.text.includes('does not say either way'));

  assert.equal(resolveStep({ of: 'vaultedSets' }, NO_ACCOUNT).headline, null, 'an unread account holds no known sets');
  assert.equal(
    resolveStep({ of: 'vaultedSets' }, { ...FULL, items: null }).headline,
    null,
    'without the catalog the vault status is unknown, not absent',
  );
});

check('credits are the half of a Baro purchase the step could always have measured', () => {
  const rich = { Suits: [], RegularCredits: 1_450_000 } as unknown as RawAccount;
  const a = resolveStep({ of: 'credits' }, { ...FULL, account: rich });
  assert.equal(a.headline, '1,450,000 credits held', `said: ${String(a.headline)}`);

  /* Read, but the field absent, is not the same as unread - and neither is zero. */
  const thin = resolveStep({ of: 'credits' }, { ...FULL, account: { Suits: [] } as unknown as RawAccount });
  assert.equal(thin.headline, null);
  assert.ok(thin.unknown?.includes('did not carry'), `said: ${String(thin.unknown)}`);
  assert.equal(resolveStep({ of: 'credits' }, { ...FULL, account: null }).headline, null);
});

check('variant weapons are found in EVERY array a weapon can live in', () => {
  const armed = {
    LongGuns: [{ ItemType: '/Lotus/Weapons/Tenno/Rifle/VIPRifle' }],
    Pistols: [{ ItemType: '/Lotus/Weapons/Corpus/Pistols/CrpHandRL/PrismaAngstrum' }],
    Melee: [{ ItemType: '/Lotus/Weapons/Grineer/Melee/GrineerMachetteAndCleaver/WraithMacheteWeapon' }],
  } as unknown as RawAccount;
  const a = resolveStep({ of: 'variants' }, { ...FULL, account: armed });
  /*
   * A Vandal can be a rifle, a secondary or a melee. Scanning one array would
   * have reported this account as holding one when it holds two, which is the
   * kind of undercount that reads as a measurement.
   */
  assert.match(String(a.headline), /^3 held/, `said: ${String(a.headline)}`);
  assert.ok(a.rows.some((r) => r.text === 'Braton Vandal'));
  assert.ok(a.rows.some((r) => r.text === 'Prisma Angstrum'));
  assert.ok(a.rows.some((r) => r.text === 'Machete Wraith'), 'the Melee arm was never proven before this');
  assert.ok(!a.rows.some((r) => r.text.includes('Dakra')), 'a Dex weapon is not a tradeable variant');

  /* Read and holding none is a MEASUREMENT - it answers "have I got any". */
  const none = resolveStep({ of: 'variants' }, { ...FULL, account: { LongGuns: [] } as unknown as RawAccount });
  assert.ok(none.headline?.includes('you hold no'), `said: ${String(none.headline)}`);
  assert.equal(none.unknown, null);
  assert.equal(resolveStep({ of: 'variants' }, { ...FULL, account: null }).headline, null);
});

check('a relic is described by its RARE rewards, and untradeable ones say so', () => {
  const a = resolveStep({ of: 'relicRewards' }, FULL);
  assert.ok(a.headline?.includes('1 relics held'), `said: ${String(a.headline)}`);
  /*
   * Only the rare rows. "A relic is worth what its RARE drop is worth, not what
   * its tier is" - listing the commons alongside would bury the answer in the
   * thing the step explicitly says not to judge by.
   */
  assert.ok(!a.rows.some((r) => r.text.includes('A Common Thing')), 'a common reward is not what the relic is worth');
  assert.equal(a.rows.length, 2, 'both rare rewards are listed');

  /*
   * Forma carries no market slug and that is the honest answer for it. Dropping
   * it would overstate the relic; the row stays and says it cannot be traded,
   * which is exactly the fact that decides whether to list the relic.
   */
  const forma = a.rows.find((r) => r.text.includes('Forma'));
  assert.ok(forma, 'an untradeable reward is still part of what the relic contains');
  assert.ok(forma.text.includes('not tradeable'));
  assert.equal(forma.tone, 'muted');
});

check('Ayatans are read from FusionTreasures, and socketed ones are counted', () => {
  const hoard = {
    Suits: [],
    FusionTreasures: [
      { ItemType: '/Lotus/Types/Items/FusionTreasures/OroFusexF', ItemCount: 1, Sockets: 4 },
      { ItemType: '/Lotus/Types/Items/FusionTreasures/OroFusexC', ItemCount: 2 },
      { ItemType: '/Lotus/Types/Items/FusionTreasures/OroFusexOrnamentA', ItemCount: 37 },
      { ItemType: '/Lotus/Types/Items/MiscItems/PrimeBucks', ItemCount: 900 },
    ],
  } as unknown as RawAccount;
  const a = resolveStep({ of: 'ayatan' }, { ...FULL, account: hoard });
  assert.equal(a.headline, '3 sculptures, 37 stars', `said: ${String(a.headline)}`);
  /*
   * `Sockets` is the whole reason this is worth a binding: "a filled one is
   * worth more" is a step about a per-sculpture number the account carries.
   */
  assert.ok(a.rows[0]?.text.includes('1 already socketed'), `said: ${String(a.rows[0]?.text)}`);
  /* A Ducat row living in the same array must not be counted as an Ayatan. */
  assert.ok(!a.headline?.includes('900'), 'a non-Ayatan row in FusionTreasures was counted');

  assert.equal(resolveStep({ of: 'ayatan' }, { ...FULL, account: null }).headline, null);
});

check('a step carries text, not another step', () => {
  /*
   * WHAT THIS CAUGHT.
   * A patch that binds by matching step TEXT will happily match inside a step
   * that is already bound, producing `{ text: { text: ..., bind: A }, bind: B }`
   * - one binding nested inside another. It happened here, and only tsc noticed,
   * and only because the same prefix also hit a `tips` array which is typed as
   * strings. On a `steps` array the nesting is structurally legal: `text` is
   * typed `string`, so a nested object is a type error ONLY if something reads
   * it. Nothing did.
   *
   * A nested binding renders the inner object as text, so the step would have
   * displayed "[object Object]" to a player. This asserts the shape directly.
   */
  for (const [id, g] of Object.entries(ROUTE_GUIDE)) {
    for (const step of g.steps) {
      if (typeof step === 'string') continue;
      assert.equal(
        typeof step.text,
        'string',
        `${id} has a step whose text is another step — a binding was applied on top of a binding`,
      );
      assert.ok(step.text.length > 10, `${id} has a step with no readable text`);
    }
  }
});

check('focus lenses are split by GRADE, which is the only thing the path carries', () => {
  const kit = {
    Suits: [],
    RawUpgrades: [
      { ItemType: '/Lotus/Upgrades/Focus/AttackLensOstron', ItemCount: 2 },
      { ItemType: '/Lotus/Upgrades/Focus/AttackLensGreater', ItemCount: 3 },
      { ItemType: '/Lotus/Upgrades/Focus/TacticLens', ItemCount: 5 },
      { ItemType: '/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod', ItemCount: 1 },
    ],
  } as unknown as RawAccount;
  const a = resolveStep({ of: 'lenses' }, { ...FULL, account: kit });
  assert.equal(a.headline, '10 lenses held', `said: ${String(a.headline)}`);
  /*
   * The SCHOOL is not in the path - Madurai is `AttackLens`, Naramon is
   * `TacticLens` - so a per-school split would be invention. Grade is what the
   * path carries and what the steps ask about.
   */
  assert.equal(a.rows[0]?.lead, '2', 'the Eidolon grade is the one worth keeping');
  assert.equal(a.rows[1]?.lead, '3');
  assert.equal(a.rows[2]?.lead, '5', 'a plain lens is neither Ostron nor Greater');
  assert.ok(!JSON.stringify(a).includes('Madurai'), 'a school was named from a path that does not carry one');

  const none = resolveStep({ of: 'lenses' }, { ...FULL, account: { RawUpgrades: [] } as unknown as RawAccount });
  assert.ok(none.headline?.includes('no focus lenses'));
  assert.equal(resolveStep({ of: 'lenses' }, { ...FULL, account: null }).headline, null);
});

/*
 * Kahl's weekly.
 *
 * The shape of `WeeklyMissions` is not documented in a primary source - it may
 * be a history - so the resolver takes the LATEST `WeekCount` and says so. The
 * phrase gate below is the important one: "this week" would be a calendar claim
 * this file cannot make, and a stale read would make it false.
 */
check('an unread account cannot say whether Kahl’s week is spent', () => {
  const a = resolveStep({ of: 'kahl' }, { ...FULL, inventory: null });
  assert.equal(a.headline, null, 'no headline without a read');
  assert.ok(a.unknown !== null, 'and a stated reason');
});

check('a read account with no Kahl standing has not started Veilbreaker', () => {
  const a = resolveStep({ of: 'kahl' }, { ...FULL, inventory: { Affiliations: [{ Tag: 'SolarisSyndicate' }] } });
  // Read and absent is a MEASUREMENT, not a gap.
  assert.equal(a.unknown, null, 'read and absent is an answer');
  assert.match(String(a.headline), /not started/, `said: ${String(a.headline)}`);
});

check('only the latest week counts, so a finished older week cannot hide a waiting one', () => {
  const inv = {
    Affiliations: [
      {
        Tag: 'KahlSyndicate',
        WeeklyMissions: [
          { WeekCount: 190, CompletedMission: true },
          { WeekCount: 190, CompletedMission: true },
          { WeekCount: 191, CompletedMission: false },
        ],
      },
    ],
  };
  const a = resolveStep({ of: 'kahl' }, { ...FULL, inventory: inv });
  assert.match(String(a.headline), /^1 still to run/, `said: ${String(a.headline)}`);
  const done = a.rows.find((r) => r.text === 'already run');
  assert.equal(done, undefined, 'week 190 is a different week and is not counted');
});

check('a missing CompletedMission is counted apart, never as done', () => {
  const inv = {
    Affiliations: [{ Tag: 'KahlSyndicate', WeeklyMissions: [{ WeekCount: 5 }, { WeekCount: 5, CompletedMission: true }] }],
  };
  const a = resolveStep({ of: 'kahl' }, { ...FULL, inventory: inv });
  const vague = a.rows.find((r) => r.text === 'the read did not say either way');
  assert.equal(vague?.lead, '1', 'the absent flag is named, not folded into either pile');
});

check('the Kahl answer never claims to know which week is current', () => {
  const inv = {
    Affiliations: [{ Tag: 'KahlSyndicate', WeeklyMissions: [{ WeekCount: 5, CompletedMission: false }] }],
  };
  const a = resolveStep({ of: 'kahl' }, { ...FULL, inventory: inv });
  const said = [a.headline ?? '', ...a.rows.map((r) => `${r.lead} ${r.text}`)].join(' | ');
  // The array may be a history and the read may be days old. Either makes
  // "this week" false, and nothing in the schema settles which.
  assert.doesNotMatch(said, /this week|current week|today/i, `claimed a calendar: ${said}`);
});


/*
 * Varzia names the frames and nothing else.
 *
 * Her feed de-camel-cases identifiers, so most of the stock arrives as "M P V
 * Banshee Prime Single Pack" or "T1 Void Projection Banshee Mirage Vault A
 * Bronze". The Warframe rows survive intact because a prime frame's identifier
 * is two plain words, and they are told apart by PATH - the mangled Sentinel
 * row is also called "Prime ..." and sits somewhere else.
 */
const VARZIA_WS = {
  vaultTrader: {
    character: 'Varzia',
    location: 'Maroo’s Bazaar (Mars)',
    expiry: new Date(Date.now() + 86_400_000).toISOString(),
    inventory: [
      { uniqueName: '/Lotus/StoreItems/Powersuits/Banshee/BansheePrime', item: 'Banshee Prime' },
      { uniqueName: '/Lotus/StoreItems/Powersuits/Harlequin/MiragePrime', item: 'Mirage Prime' },
      { uniqueName: '/Lotus/Types/StoreItems/Packages/MegaPrimeVault/MPVBansheePrimeSinglePack', item: 'M P V Banshee Prime Single Pack' },
      { uniqueName: '/Lotus/StoreItems/Types/Sentinels/SentinelPowersuits/PrimeHeliosPowerSuit', item: 'Prime Helios Power Suit' },
      { uniqueName: '/Lotus/StoreItems/Types/Game/Projections/T1VoidProjectionBansheeMirageVaultABronze', item: 'T1 Void Projection Banshee Mirage Vault A Bronze' },
    ],
  },
} as unknown as Worldstate;

check('Varzia names the unvaulted frames, which is what the route asks', () => {
  const a = resolveStep({ of: 'varzia' }, { ...FULL, ws: VARZIA_WS });
  const named = a.rows.filter((r) => r.lead === 'unvaulted').map((r) => r.text);
  assert.deepEqual(named, ['Banshee Prime', 'Mirage Prime'], `named: ${named.join(', ')}`);
  assert.match(String(a.headline), /Banshee Prime and Mirage Prime/, `said: ${String(a.headline)}`);
});

check('the Sentinel is excluded by PATH, not by whether its name says Prime', () => {
  const a = resolveStep({ of: 'varzia' }, { ...FULL, ws: VARZIA_WS });
  const said = a.rows.map((r) => r.text).join(' | ');
  // "Prime Helios Power Suit" contains "Prime" and is mangled. A name test
  // would have let it through; the path test is why it does not.
  assert.doesNotMatch(said, /Helios/, `printed a mangled Sentinel: ${said}`);
});

check('no mangled identifier ever reaches the screen from Varzia', () => {
  const a = resolveStep({ of: 'varzia' }, { ...FULL, ws: VARZIA_WS });
  const said = [a.headline ?? '', ...a.rows.map((r) => r.text)].join(' | ');
  // The tell of a de-camel-cased identifier is an isolated single letter.
  assert.doesNotMatch(said, /(^|\s)[A-Z](\s|$)/, `printed a mangled name: ${said}`);
  assert.doesNotMatch(said, /Void Projection|Single Pack|Dual Pack/, `printed a mangled name: ${said}`);
});

check('the rows Varzia will not name are still counted', () => {
  const a = resolveStep({ of: 'varzia' }, { ...FULL, ws: VARZIA_WS });
  const rest = a.rows.find((r) => r.text.includes('mangles'));
  assert.equal(rest?.lead, '3', 'the pack, the Sentinel and the relic are counted, not dropped');
});

/*
 * The alteration warning, which is the step this route hangs on.
 *
 * "Ranking it up, adding Forma, or installing a catalyst can end its
 * tradeability" was a warning the app could always have measured: XP, Polarized
 * and the Features bitmask are all on the equipment row.
 */
check('an untouched variant reads as unaltered', () => {
  const armed = { LongGuns: [{ ItemType: '/Lotus/Weapons/Tenno/Rifle/VIPRifle' }] } as unknown as RawAccount;
  const a = resolveStep({ of: 'variants' }, { ...FULL, account: armed });
  assert.equal(a.headline, '1 held · 1 still unaltered', `said: ${String(a.headline)}`);
  assert.equal(a.rows[0]?.lead, 'unaltered');
});

check('each of the three things that ends a trade is named separately', () => {
  const armed = {
    LongGuns: [{ ItemType: '/Lotus/Weapons/Tenno/Rifle/VIPRifle', XP: 1_500 }],
    Pistols: [{ ItemType: '/Lotus/Weapons/Corpus/Pistols/CrpHandRL/PrismaAngstrum', Polarized: 2 }],
    // 1 is DOUBLE_CAPACITY - the Orokin Catalyst. There is no boolean for it.
    Melee: [{ ItemType: '/Lotus/Weapons/Grineer/Melee/GrineerMachetteAndCleaver/WraithMacheteWeapon', Features: 1 }],
  } as unknown as RawAccount;
  const a = resolveStep({ of: 'variants' }, { ...FULL, account: armed });
  assert.equal(a.headline, '3 held · 0 still unaltered', `said: ${String(a.headline)}`);
  const said = a.rows.map((r) => r.text).join(' | ');
  assert.match(said, /Braton Vandal · ranked up/, said);
  assert.match(said, /Prisma Angstrum · 2 Forma/, said);
  assert.match(said, /Machete Wraith · catalyst installed/, said);
});

check('the ones that will not trade are listed first', () => {
  const armed = {
    LongGuns: [
      { ItemType: '/Lotus/Weapons/Tenno/Rifle/VIPRifle' },
      { ItemType: '/Lotus/Weapons/VoidTrader/PrismaGrakata', Polarized: 5, XP: 9_000 },
    ],
  } as unknown as RawAccount;
  const a = resolveStep({ of: 'variants' }, { ...FULL, account: armed });
  // The warning is the point of the step, so the broken one cannot be second.
  assert.equal(a.rows[0]?.lead, 'altered', `first row: ${String(a.rows[0]?.text)}`);
  assert.match(String(a.rows[0]?.text), /ranked up, 5 Forma/, String(a.rows[0]?.text));
});

check('an unset Features bit is not read as a catalyst', () => {
  // 2 is UTILITY_SLOT, not DOUBLE_CAPACITY. A truthiness test would fail here.
  const armed = { LongGuns: [{ ItemType: '/Lotus/Weapons/Tenno/Rifle/VIPRifle', Features: 2 }] } as unknown as RawAccount;
  const a = resolveStep({ of: 'variants' }, { ...FULL, account: armed });
  assert.equal(a.headline, '1 held · 1 still unaltered', `said: ${String(a.headline)}`);
});

/*
 * Live invasion rewards worth selling.
 *
 * `tradeableOffers` returns the empty array for three unrelated situations -
 * no world state, no market catalog, and a rotation where every reward is
 * Forma - and only the last is a measurement. The panel resolves that before
 * building the context; these check it stays resolved.
 */
check('an unread invasion list is unknown, not "nothing sells"', () => {
  const a = resolveStep({ of: 'invasionValue' }, { ...FULL, invasionCandidates: null, invasionOffers: null });
  assert.equal(a.headline, null, `said: ${String(a.headline)}`);
  assert.ok(a.unknown !== null, 'and gives the reason');
});

check('a rotation where nothing sells says so, and is not mistaken for unread', () => {
  const a = resolveStep({ of: 'invasionValue' }, { ...FULL, invasionCandidates: [], invasionOffers: null });
  // Read, and nothing tradeable. That IS an answer about this rotation.
  assert.equal(a.unknown, null, 'an empty rotation is a measurement');
  assert.match(String(a.headline), /nothing running right now pays/, `said: ${String(a.headline)}`);
});

check('rewards are ranked by what they pay, and the total is stated', () => {
  const a = resolveStep({ of: 'invasionValue' }, FULL);
  assert.match(String(a.headline), /2 tradeable rewards running · 42p/, `said: ${String(a.headline)}`);
  assert.equal(a.rows[0]?.lead, '42p', 'the one that pays comes first');
  assert.match(String(a.rows[0]?.text), /Orokin Catalyst Blueprint/, String(a.rows[0]?.text));
});

check('an unpriced reward reads as no quote, never as zero platinum', () => {
  const a = resolveStep({ of: 'invasionValue' }, FULL);
  const unpriced = a.rows.find((r) => r.text.includes('Fieldron'));
  // 0p would be a claim that it was weighed and found worthless.
  assert.equal(unpriced?.lead, 'no quote', `said: ${String(unpriced?.lead)}`);
});

check('while prices are still being read, the count is given without a total', () => {
  const a = resolveStep({ of: 'invasionValue' }, { ...FULL, invasionOffers: null });
  assert.match(String(a.headline), /prices still being read/, `said: ${String(a.headline)}`);
  assert.doesNotMatch(String(a.headline), /\dp\b/, 'no total is claimed before one exists');
  assert.equal(a.rows[0]?.lead, '—', 'and no row claims a figure either');
});

/*
 * Planets cleared, and where a Larvling can spawn.
 *
 * Both read the node catalog as the DENOMINATOR and `clearedNodes` as the
 * numerator, never the reverse: `progression.ts` records that the account's
 * `Missions[]` is a wider population than the star chart, so counting from the
 * account's side would let an off-chart node inflate a planet to complete.
 */
const CHART_CAT = {
  planetNodes: new Map([
    ['Earth', ['E1', 'E2']],
    ['Venus', ['V1', 'V2', 'V3', 'V4']],
  ]),
  nodeById: new Map([
    ['E1', { id: 'E1', name: 'Oro', planet: 'Earth', type: 'Assassination', enemy: 'Grineer', minLevel: 20, maxLevel: 25, next: [], prev: [] }],
    ['E2', { id: 'E2', name: 'Cambria', planet: 'Earth', type: 'Excavation', enemy: 'Grineer', minLevel: 3, maxLevel: 8, next: [], prev: [] }],
    ['V1', { id: 'V1', name: 'Tessera', planet: 'Venus', type: 'Defense', enemy: 'Corpus', minLevel: 22, maxLevel: 24, next: [], prev: [] }],
    ['V2', { id: 'V2', name: 'Kiliken', planet: 'Venus', type: 'Excavation', enemy: 'Grineer or Corpus', minLevel: 30, maxLevel: 35, next: [], prev: [] }],
    ['V3', { id: 'V3', name: 'Unm', planet: 'Venus', type: 'Survival', enemy: 'Grineer', minLevel: 40, maxLevel: 45, next: [], prev: [] }],
    // Deliberately BELOW 20: this is the node a copied Larvling floor would hide,
    // and without it the no-invented-floor check passes while doing nothing.
    ['V4', { id: 'V4', name: 'Aphrodite', planet: 'Venus', type: 'Survival', enemy: 'Corpus', minLevel: 5, maxLevel: 10, next: [], prev: [] }],
  ]),
} as unknown as Catalog;

/** Earth fully cleared, Venus one short, plus an off-chart node. */
const CHART_PIC = {
  nodes: { have: 5, total: 6 },
  clearedNodes: new Set(['E1', 'E2', 'V1', 'V3', 'V4', 'NOT_ON_THE_CHART']),
} as unknown as AccountPicture;

check('a planet counts as cleared only when every node the CATALOG lists is done', () => {
  const a = resolveStep({ of: 'planets' }, { ...FULL, catalog: CHART_CAT, picture: CHART_PIC });
  // One planet CARRIES; the plural verb here read as a bug to anyone looking.
  assert.match(String(a.headline), /^1 planet carries Nightmare missions/, `said: ${String(a.headline)}`);
  assert.ok(a.rows.some((r) => r.text.includes('fully cleared: Earth')), 'Earth is done');
  // Venus has V2 outstanding. The off-chart clear must not fill that hole.
  assert.ok(a.rows.some((r) => r.lead === '1 left' && r.text.includes('Venus')), 'Venus is one short');
});

check('an unread account cannot be told which planets are cleared', () => {
  const unread = { nodes: { have: null, total: 5 }, clearedNodes: new Set() } as unknown as AccountPicture;
  const a = resolveStep({ of: 'planets' }, { ...FULL, catalog: CHART_CAT, picture: unread });
  // A zero here would be a claim about the player, made out of our own gap.
  assert.equal(a.headline, null, `said: ${String(a.headline)}`);
  assert.ok(a.unknown !== null, 'and states why');
});

check('a Larvling node must be Grineer, level 20 plus, and one you have cleared', () => {
  const a = resolveStep({ of: 'nemesisNode', faction: 'Grineer', minLevel: 20 }, { ...FULL, catalog: CHART_CAT, picture: CHART_PIC });
  const named = a.rows.map((r) => r.text);
  assert.equal(a.rows.length, 2, `listed: ${named.join(', ')}`);
  assert.ok(named.some((t) => t.includes('Oro')), 'Oro is Grineer, level 20, cleared');
  assert.ok(named.some((t) => t.includes('Unm')), 'Unm is Grineer, level 40, cleared');
  assert.ok(!named.some((t) => t.includes('Cambria')), 'Cambria is level 3 and must not appear');
  assert.ok(!named.some((t) => t.includes('Tessera')), 'Tessera is Corpus and must not appear');
  // Kiliken alternates faction, so it is not reliably a Grineer node.
  assert.ok(!named.some((t) => t.includes('Kiliken')), 'an alternating-faction node is not named');
});

check('the lowest-level Larvling node comes first, since any of them works', () => {
  const a = resolveStep({ of: 'nemesisNode', faction: 'Grineer', minLevel: 20 }, { ...FULL, catalog: CHART_CAT, picture: CHART_PIC });
  assert.equal(a.rows[0]?.lead, '20-25', `first: ${String(a.rows[0]?.text)}`);
});

check('a player with no qualifying node is told so, not shown an empty list', () => {
  const none = { nodes: { have: 1, total: 5 }, clearedNodes: new Set(['E2']) } as unknown as AccountPicture;
  const a = resolveStep({ of: 'nemesisNode', faction: 'Grineer', minLevel: 20 }, { ...FULL, catalog: CHART_CAT, picture: none });
  assert.equal(a.unknown, null, 'read and none qualifying is a measurement');
  assert.match(String(a.headline), /no Grineer node you have cleared/, `said: ${String(a.headline)}`);
});

/*
 * A COUNT OF ONE IS THE CASE NOBODY LOOKS AT.
 * ————————————————————————————————————————————
 * Every one of these headlines was written while thinking about a player with
 * a pile of things, and read correctly for that player. With exactly one, three
 * of them said "1 lenses held", "1 tradeable rewards running" and "1 planets
 * carry Nightmare missions" - which is not a rounding error in the prose, it is
 * the app looking like it cannot count, on the screen of the player who has
 * least reason to trust it yet.
 *
 * The pattern is a literal 1 followed within a few words by a plural noun. It
 * deliberately does not fire on "1 of your own Grineer nodes", which is correct
 * English, so it is a check on agreement rather than on the letter s.
 */
const SAYS_ONE_PLURAL = /^1 (?:[a-z]+ )?([a-z]+s)\b/;

/*
 * Two kinds of word end in s while being perfectly singular, and both appear
 * here: third-person verbs ("1 planet CARRIES Nightmare missions") where the s
 * is agreement WITH the singular rather than against it, and nouns that simply
 * end in one ("1 LENS held"). A gate that flagged either would push the prose
 * the wrong way and make the app say "1 len", so they are named. The list grows
 * when a real word joins it; the rule does not get loosened until it catches
 * nothing, which is the usual way a check like this dies.
 */
const SINGULAR_WORDS = new Set([
  'carries', 'holds', 'is', 'has', 'needs', 'pays', 'sells', 'runs', 'costs', 'sits', 'takes', 'remains', 'was',
  'lens', 'bonus', 'status', 'this', 'its',
]);

/** The offending plural noun, or null when the phrase agrees. */
function disagrees(said: string): string | null {
  const m = SAYS_ONE_PLURAL.exec(said);
  if (m === null) return null;
  const word = m[1];
  if (word === undefined || SINGULAR_WORDS.has(word)) return null;
  return word;
}

check('a count of exactly one reads as singular everywhere it is stated', () => {
  const oneNode = { id: 'G1', name: 'Oro', planet: 'Earth', type: 'Assassination', enemy: 'Grineer', minLevel: 20, maxLevel: 25, next: [], prev: [] };
  const cat = {
    planetNodes: new Map([['Earth', ['G1']]]),
    nodeById: new Map([['G1', oneNode]]),
  } as unknown as Catalog;
  const pic = { nodes: { have: 1, total: 1 }, clearedNodes: new Set(['G1']) } as unknown as AccountPicture;
  const offer = { node: 'Numa (Saturn)', faction: 'Grineer', item: 'Strun Wraith Barrel', count: 1, slug: 'x', price: null, worth: 25 };

  const singles: Array<[StepBind, StepContext]> = [
    [{ of: 'planets' }, { ...FULL, catalog: cat, picture: pic }],
    [{ of: 'nemesisNode', faction: 'Grineer', minLevel: 20 }, { ...FULL, catalog: cat, picture: pic }],
    [{ of: 'invasionValue' }, { ...FULL, invasionCandidates: [offer], invasionOffers: [offer] }],
    [{ of: 'invasionValue' }, { ...FULL, invasionCandidates: [offer], invasionOffers: null }],
    [{ of: 'lenses' }, { ...FULL, account: { RawUpgrades: [{ ItemType: '/Lotus/Upgrades/Focus/AttackLens', ItemCount: 1 }] } as unknown as RawAccount }],
    [{ of: 'variants' }, { ...FULL, account: { LongGuns: [{ ItemType: '/Lotus/Weapons/Tenno/Rifle/VIPRifle' }] } as unknown as RawAccount }],
  ];
  for (const [bind, ctx] of singles) {
    const a = resolveStep(bind, ctx);
    const said = String(a.headline ?? '');
    assert.equal(disagrees(said), null, `${bind.of} said: ${said}`);
    for (const r of a.rows) {
      assert.equal(disagrees(`${r.lead} ${r.text}`), null, `${bind.of} row said: ${r.lead} ${r.text}`);
    }
  }
});

/*
 * Arcane helmets, which nothing but an exact list identifies.
 *
 * The step exists because a long-running account may hold one without knowing,
 * so the two ways to get this wrong are opposite and both bad: miss one the
 * player owns, or claim one they do not. The fixtures below are a real arcane
 * helmet, a real ORDINARY helmet whose path fits every obvious pattern, and a
 * read that puts the helmet somewhere this file never named.
 */
check('an unread account cannot say whether you hold an arcane helmet', () => {
  const a = resolveStep({ of: 'arcaneHelmets' }, { ...FULL, inventory: null });
  assert.equal(a.headline, null, `said: ${String(a.headline)}`);
  assert.ok(a.unknown !== null, 'and states why');
});

check('an arcane helmet is found wherever the read happens to keep it', () => {
  /*
   * `WeaponSkins` is the likely home and `SomeArrayNobodyNamed` is not - and
   * the resolver must find both, because no primary source here settles which
   * array DE uses for warframe cosmetics. This is the test that would fail if
   * somebody "tidied" the search down to one named field.
   */
  const a = resolveStep({ of: 'arcaneHelmets' }, {
    ...FULL,
    inventory: {
      WeaponSkins: [{ ItemType: '/Lotus/Upgrades/Skins/Rhino/RhinoHelmetAltB' }],
      SomeArrayNobodyNamed: [{ ItemType: '/Lotus/Upgrades/Skins/Trinity/TrinityHelmetAlt' }],
    },
  });
  assert.equal(a.headline, '2 arcane helmets held', `said: ${String(a.headline)}`);
  const named = a.rows.map((r) => r.text);
  assert.deepEqual(
    named,
    ['Arcane Aura Helmet · Trinity', 'Arcane Vanguard Helmet · Rhino'],
    named.join(', '),
  );
});

check('an ordinary alt helmet is NOT reported as an arcane one', () => {
  /*
   * The Atlas Tartarus helmet is `/Lotus/Upgrades/Skins/Brawler/BrawlerAltHelmet`
   * - same prefix, same "AltHelmet" suffix, a store cosmetic. It is one of 57
   * that the obvious pattern rule would have claimed as a valuable event item.
   */
  const a = resolveStep({ of: 'arcaneHelmets' }, {
    ...FULL,
    inventory: { WeaponSkins: [{ ItemType: '/Lotus/Upgrades/Skins/Brawler/BrawlerAltHelmet' }] },
  });
  assert.equal(a.unknown, null, 'the read happened');
  assert.match(String(a.headline), /no arcane helmet appears/, `said: ${String(a.headline)}`);
});

check('having none is stated as what was searched, not as a claim about you', () => {
  const a = resolveStep({ of: 'arcaneHelmets' }, { ...FULL, inventory: { WeaponSkins: [] } });
  /*
   * "no arcane helmet appears anywhere in this account read" is earned - every
   * array was searched. "you own none" would be a stronger claim than the
   * search supports, and this route's whole premise is that the player's own
   * belief about what they own is unreliable.
   */
  assert.doesNotMatch(String(a.headline), /you (own|hold) none/i, `said: ${String(a.headline)}`);
  assert.match(String(a.headline), /anywhere in this account read/, `said: ${String(a.headline)}`);
});

check('a helmet stored as a bare path string is found too', () => {
  // Some inventory arrays hold paths rather than rows; both shapes occur.
  const a = resolveStep({ of: 'arcaneHelmets' }, {
    ...FULL,
    inventory: { Skins: ['/Lotus/Upgrades/Skins/Volt/VoltHelmetAlt'] },
  });
  assert.equal(a.headline, '1 arcane helmet held', `said: ${String(a.headline)}`);
  assert.equal(a.rows[0]?.text, 'Arcane Storm Helmet · Volt');
});

/*
 * The Sister half of the same resolver, where the step states NO level.
 *
 * "Kill a Treasurer on a level-appropriate Corpus node" gives no number, and no
 * primary source in this repository gives one either. Copying the Larvling's 20
 * across would have been the natural thing to do and would have hidden every
 * qualifying low-level node behind a threshold this file invented.
 */
check('with no level stated, no level floor is invented', () => {
  const a = resolveStep({ of: 'nemesisNode', faction: 'Corpus', minLevel: null }, { ...FULL, catalog: CHART_CAT, picture: CHART_PIC });
  const named = a.rows.map((r) => r.text);
  // Tessera is Corpus at 22-24 and cleared. It is the only one, and it counts
  // because it is Corpus - not because it cleared a number.
  assert.ok(named.some((t) => t.includes('Tessera')), `listed: ${named.join(', ')}`);
  // Aphrodite is level 5. It qualifies because it is Corpus and cleared - the
  // ONLY reason a level-appropriate step can give - and a copied floor of 20
  // would silently drop it.
  assert.ok(named.some((t) => t.includes('Aphrodite')), `a low-level node was hidden: ${named.join(', ')}`);
  assert.match(String(a.headline), /2 of your own Corpus nodes qualify/, `said: ${String(a.headline)}`);
});

check('the two factions do not leak into each other', () => {
  const corpus = resolveStep({ of: 'nemesisNode', faction: 'Corpus', minLevel: null }, { ...FULL, catalog: CHART_CAT, picture: CHART_PIC });
  const grineer = resolveStep({ of: 'nemesisNode', faction: 'Grineer', minLevel: 20 }, { ...FULL, catalog: CHART_CAT, picture: CHART_PIC });
  assert.ok(!corpus.rows.some((r) => r.text.includes('Oro')), 'a Grineer node reached the Corpus list');
  assert.ok(!grineer.rows.some((r) => r.text.includes('Tessera')), 'a Corpus node reached the Grineer list');
  // Kiliken is 'Grineer or Corpus' and belongs to neither.
  assert.ok(!corpus.rows.some((r) => r.text.includes('Kiliken')), 'an alternating node reached the Corpus list');
  assert.ok(!grineer.rows.some((r) => r.text.includes('Kiliken')), 'an alternating node reached the Grineer list');
});

check('a faction with no cleared node says so in its own words', () => {
  const none = { nodes: { have: 1, total: 5 }, clearedNodes: new Set(['E2']) } as unknown as AccountPicture;
  const a = resolveStep({ of: 'nemesisNode', faction: 'Corpus', minLevel: null }, { ...FULL, catalog: CHART_CAT, picture: none });
  // No floor was stated, so the sentence must not mention one.
  assert.match(String(a.headline), /you have cleared no Corpus node/, `said: ${String(a.headline)}`);
  assert.doesNotMatch(String(a.headline), /level/, 'a level appeared in a sentence that has no level');
});

/*
 * EVERY PLAIN STEP IS ACCOUNTED FOR, OR THIS FAILS.
 * ————————————————————————————————————————————
 * Half of the guide's steps render as plain text, and for a long time that half
 * was simply "the rest" - which is exactly where a missed binding hides
 * forever, because nothing in the repository distinguishes "we looked and there
 * is nothing to show" from "nobody looked". Counting bound steps could never
 * tell those apart; only naming each one can.
 *
 * `plat-plain.ts` gives every plain step a reason. These three checks make the
 * file impossible to let rot: a new step must be classified, a step that gains
 * a binding must lose its excuse, and an excuse that points at another step
 * must point at one that actually answers something.
 */
function everyPlainStep(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, guide] of Object.entries(ROUTE_GUIDE)) {
    guide.steps.forEach((step, i) => {
      if (stepBind(step) === null) out.set(`${id}#${String(i)}`, stepText(step));
    });
  }
  return out;
}

function everyBoundStep(): Set<string> {
  const out = new Set<string>();
  for (const [id, guide] of Object.entries(ROUTE_GUIDE)) {
    guide.steps.forEach((step, i) => {
      if (stepBind(step) !== null) out.add(`${id}#${String(i)}`);
    });
  }
  return out;
}

check('every plain step carries a recorded reason for being plain', () => {
  const plain = everyPlainStep();
  const missing = [...plain.keys()].filter((k) => !(k in PLAIN_STEPS));
  assert.deepEqual(
    missing,
    [],
    `these steps render as plain text with no reason recorded:\n        ${missing
      .map((k) => `${k} :: ${plain.get(k) ?? ''}`)
      .join('\n        ')}`,
  );
});

check('no reason is recorded for a step that is already answered', () => {
  const plain = everyPlainStep();
  const bound = everyBoundStep();
  const stale = Object.keys(PLAIN_STEPS).filter((k) => !plain.has(k));
  const wrong = stale.map((k) => (bound.has(k) ? `${k} (it is BOUND - delete the excuse)` : `${k} (no such step)`));
  assert.deepEqual(wrong, [], `plat-plain.ts describes steps that are not plain:\n        ${wrong.join('\n        ')}`);
});

check('a step excused as "covered" points at a step that really answers it', () => {
  const bound = everyBoundStep();
  const broken: string[] = [];
  for (const [key, reason] of Object.entries(PLAIN_STEPS)) {
    if (reason.kind !== 'covered') continue;
    /*
     * The point of `covered` is "another panel on this screen already says
     * this". If the step it names is itself plain, the claim is empty and the
     * question is unanswered on the route - the exact hole this file exists to
     * make visible.
     */
    if (!bound.has(reason.by)) broken.push(`${key} says ${reason.by} covers it, but ${reason.by} answers nothing`);
    const route = key.slice(0, key.indexOf('#'));
    if (!reason.by.startsWith(`${route}#`)) broken.push(`${key} points at ${reason.by}, which is on a different route`);
  }
  assert.deepEqual(broken, [], broken.join('\n        '));
});

check('a step excused as "missing" says exactly what is missing', () => {
  const vague: string[] = [];
  for (const [key, reason] of Object.entries(PLAIN_STEPS)) {
    if (reason.kind !== 'missing') continue;
    /*
     * "no data" is not a reason, it is a shrug. The whole value of this
     * category is that a future dataset turns the entry into a to-do, and it
     * can only do that if the entry names the source it wants.
     */
    if (reason.what.length < 40) vague.push(`${key}: "${reason.what}" does not name a source`);
    if (/^(no data|not available|unavailable|unknown)\b/i.test(reason.what)) {
      vague.push(`${key}: "${reason.what}" is a shrug, not a source`);
    }
  }
  assert.deepEqual(vague, [], vague.join('\n        '));
});

/*
 * Where a cosmetic actually drops.
 *
 * These answer from a vendored extract rather than from a read, which is why
 * `dropSource` is in STATIC_KINDS above. The risk here is not fabrication, it
 * is flattening: a scene that comes from a syndicate rank at 100 per cent is
 * not a lucky drop, and telling somebody to farm it would waste an evening.
 */
check('a guaranteed source is named as bought, never as a 100% drop', () => {
  const a = resolveStep({ of: 'dropSource', family: 'scene' }, FULL);
  const bought = a.rows.filter((r) => r.lead === 'bought');
  assert.ok(bought.length > 0, 'no syndicate or vendor source was distinguished at all');
  for (const r of bought) {
    assert.match(r.text, /not a drop/, `a bought source read as farmable: ${r.text}`);
  }
  // 100% must never appear as a rate; it is the tell of a rank reward.
  assert.ok(!a.rows.some((r) => r.lead === '100.00%'), 'a rank reward was printed as a drop rate');
});

check('scenes and ephemera do not leak into each other', () => {
  const scenes = resolveStep({ of: 'dropSource', family: 'scene' }, FULL);
  const eph = resolveStep({ of: 'dropSource', family: 'ephemera' }, FULL);
  assert.match(String(scenes.headline), /scenes across/, `said: ${String(scenes.headline)}`);
  assert.match(String(eph.headline), /ephemera across/, `said: ${String(eph.headline)}`);
  // Two different families must not produce the same list.
  assert.notDeepEqual(
    scenes.rows.map((r) => r.text),
    eph.rows.map((r) => r.text),
    'both families produced the same places, so the filter is not filtering',
  );
});

check('the places carrying the most of a family come first', () => {
  const a = resolveStep({ of: 'dropSource', family: 'scene' }, FULL);
  const counts = a.rows.map((r) => Number(/· (\d+) of them/.exec(r.text)?.[1] ?? '0'));
  const sorted = [...counts].sort((x, y) => y - x);
  assert.deepEqual(counts, sorted, `not ranked by how much each place carries: ${counts.join(', ')}`);
});

/*
 * PROSE MUST NOT CONTRADICT THE TABLE BESIDE IT.
 * ————————————————————————————————————————————
 * The captura route said "scenes are usually a low-chance drop from a specific
 * place" and the ephemera route said much the same. The vendored table says the
 * opposite: 52 of the 63 scenes and 8 of the 12 ephemera are syndicate or
 * vendor rank rewards, bought with standing. Only eleven scenes drop at all.
 *
 * Nobody wrote that on purpose - it was written from the general shape of the
 * game before the data was in the repository, and it survived because nothing
 * compared the two. The binding put the real numbers on the same screen as the
 * sentence contradicting them, which is how it was noticed.
 *
 * So the guide is checked against the table: a family the data says is mostly
 * BOUGHT may not be described only in the language of farming.
 */
function familySplit(want: RegExp): { bought: number; drop: number } {
  const items = new Map<string, { bought: boolean; drop: boolean }>();
  for (const r of DROP_SOURCES.sources) {
    if (!want.test(r.item)) continue;
    const e = items.get(r.item) ?? { bought: false, drop: false };
    if (r.chance === 100) e.bought = true;
    else e.drop = true;
    items.set(r.item, e);
  }
  const v = [...items.values()];
  return { bought: v.filter((x) => x.bought).length, drop: v.filter((x) => x.drop && !x.bought).length };
}

check('a route whose items are mostly BOUGHT does not tell you to farm them', () => {
  const families: Array<{ route: string; want: RegExp }> = [
    { route: 'captura', want: /\bscene\b/i },
    { route: 'ephemera', want: /\bephemera\b/i },
  ];
  const wrong: string[] = [];
  for (const { route, want } of families) {
    const split = familySplit(want);
    if (split.bought <= split.drop) continue;
    const guide = ROUTE_GUIDE[route];
    assert.ok(guide !== undefined, `${route} has no guide`);
    const prose = [PLAT_ROUTES.find((r) => r.id === route)?.how ?? '', ...guide.steps.map(stepText)].join(' ');
    /*
     * The test is that the standing route is MENTIONED at all - not that the
     * word "farm" is banned, because eleven scenes really do drop and the
     * guide should still say so.
     */
    if (!/standing|syndicate|rank reward|vendor|bought|buy/i.test(prose)) {
      wrong.push(
        `${route}: ${String(split.bought)} of its items are bought and ${String(split.drop)} drop, ` +
          'but nothing in the route mentions standing',
      );
    }
  }
  assert.deepEqual(wrong, [], wrong.join('\n        '));
});

/*
 * Which frame an arcane helmet belongs to.
 *
 * The skin export has no frame field and the path carries only an internal
 * codename, so this was filed as unanswerable. It is answerable by JOIN: the
 * warframe's own path carries the same codename, and the catalog is already
 * loaded. The checks below are about the four ways that join can go wrong.
 */
check('a codename nothing about the string explains still resolves', () => {
  const a = resolveStep({ of: 'arcaneHelmets' }, {
    ...FULL,
    // Arcane Scorpion Helmet lives under `Ninja`. Nothing in that says Ash.
    inventory: { WeaponSkins: [{ ItemType: '/Lotus/Upgrades/Skins/Ninja/NinjaHelmetAlt' }] },
  });
  assert.equal(a.rows[0]?.text, 'Arcane Scorpion Helmet · Ash', `said: ${String(a.rows[0]?.text)}`);
});

check('the base frame answers, not whichever variant the catalog lists first', () => {
  const a = resolveStep({ of: 'arcaneHelmets' }, {
    ...FULL,
    inventory: { WeaponSkins: [{ ItemType: '/Lotus/Upgrades/Skins/Ninja/NinjaHelmetAltB' }] },
  });
  // Ash Prime is listed BEFORE Ash in the fixture. A helmet fits the family,
  // so naming the Prime would be a narrower claim than the data supports.
  assert.match(String(a.rows[0]?.text), /· Ash$/, `said: ${String(a.rows[0]?.text)}`);
});

check('a codename no warframe uses any more is admitted, not guessed', () => {
  const a = resolveStep({ of: 'arcaneHelmets' }, {
    ...FULL,
    // `Asp` is a legacy codename; Saryn's own path is /Powersuits/Saryn/Saryn.
    inventory: { WeaponSkins: [{ ItemType: '/Lotus/Upgrades/Skins/Asp/AspAltHelmet' }] },
  });
  assert.equal(a.rows[0]?.text, 'Arcane Hemlock Helmet · the path does not say which frame', `said: ${String(a.rows[0]?.text)}`);
  // Folklore says Asp is Saryn. Folklore is not a source.
  assert.doesNotMatch(String(a.rows[0]?.text), /Saryn/, 'a frame was assigned from folklore');
});

check('with no catalog loaded, no frame is claimed for any helmet', () => {
  const a = resolveStep({ of: 'arcaneHelmets' }, {
    ...FULL,
    items: null,
    inventory: { WeaponSkins: [{ ItemType: '/Lotus/Upgrades/Skins/Ninja/NinjaHelmetAlt' }] },
  });
  // The helmet is still found - that needs no catalog. Only the frame is unknown.
  assert.match(String(a.headline), /1 arcane helmet held/, `said: ${String(a.headline)}`);
  assert.match(String(a.rows[0]?.text), /does not say which frame/, `said: ${String(a.rows[0]?.text)}`);
});

/*
 * Weekly allowances, where a stale read is the whole hazard.
 *
 * `EntratiVaultCountLastPeriod` is a count for the period ending at
 * `EntratiVaultCountResetDate`. Once that passes, the number describes a week
 * that is over - and reporting it anyway tells a player they have spent runs
 * the game has just given back, which is the most expensive kind of wrong on a
 * route whose entire point is a weekly cap.
 */
const WEEK_AHEAD = { $date: { $numberLong: String(NOW + 3 * 86_400_000) } };
const WEEK_PAST = { $date: { $numberLong: String(NOW - 3 * 86_400_000) } };

check('Netracells left is counted against the stated cap of five', () => {
  const acc = { EntratiVaultCountLastPeriod: 2, EntratiVaultCountResetDate: WEEK_AHEAD } as unknown as RawAccount;
  const a = resolveStep({ of: 'netracells' }, { ...FULL, account: acc });
  assert.equal(a.headline, '3 of 5 left this week', `said: ${String(a.headline)}`);
  assert.ok(a.rows.some((r) => r.lead === 'resets'), 'the reset countdown is the actionable half');
});

check('a count from a week that has already reset is unknown, never zero-used', () => {
  const acc = { EntratiVaultCountLastPeriod: 5, EntratiVaultCountResetDate: WEEK_PAST } as unknown as RawAccount;
  const a = resolveStep({ of: 'netracells' }, { ...FULL, account: acc });
  /*
   * Five used and the week already turned over. Reporting "this week is spent"
   * would be exactly backwards - the player has five fresh runs.
   */
  assert.equal(a.headline, null, `said: ${String(a.headline)}`);
  assert.match(String(a.unknown), /reset since this account was read/, String(a.unknown));
});

check('a spent week says so plainly', () => {
  const acc = { EntratiVaultCountLastPeriod: 5, EntratiVaultCountResetDate: WEEK_AHEAD } as unknown as RawAccount;
  const a = resolveStep({ of: 'netracells' }, { ...FULL, account: acc });
  assert.equal(a.headline, 'this week is spent', `said: ${String(a.headline)}`);
});

check("Maroo's hunt reports its states and dates none of them", () => {
  const acc = {
    TauntHistory: [{ node: 'A', state: 'TS_COMPLETED' }, { node: 'B', state: 'TS_UNLOCKED' }, { node: 'C' }],
  } as unknown as RawAccount;
  const a = resolveStep({ of: 'marooHunt' }, { ...FULL, account: acc });
  assert.match(String(a.headline), /1 unlocked and not yet run/, `said: ${String(a.headline)}`);
  const said = [a.headline ?? '', ...a.rows.map((r) => `${r.lead} ${r.text}`)].join(' | ');
  // Nothing in TauntHistory dates an entry, so no calendar may be claimed.
  assert.doesNotMatch(said, /this week|current week|today/i, `claimed a calendar: ${said}`);
  assert.ok(a.rows.some((r) => r.text.includes('did not say either way')), 'the stateless entry is named apart');
});

check('an account that never took the hunt is measured, not left unknown', () => {
  const a = resolveStep({ of: 'marooHunt' }, { ...FULL, account: { TauntHistory: [] } as unknown as RawAccount });
  assert.equal(a.unknown, null, 'read and empty is an answer');
  assert.match(String(a.headline), /have not taken/, `said: ${String(a.headline)}`);
});

/*
 * A STEP-LEVEL QUEST NAME MUST RESOLVE.
 * ————————————————————————————————————————————
 * `check-plat.ts` already verifies that every ROUTE's `gate` resolves in the
 * catalog. Nothing checked the quest names bound to individual STEPS, which is
 * a separate list and a worse failure: `resolveQuest` reports an unrecognised
 * name as not-done rather than as unknown, so a typo renders as a permanent
 * blocker on a route the player may have finished years ago.
 *
 * (An earlier version of this block also demanded that every route with a
 * `gate` bind a quest to one of its steps. That was wrong: `routeState` already
 * answers the gate for the whole route, and the rule would have forced fourteen
 * redundant panels onto routes whose steps never mention the quest.)
 */
check('every quest a step names is one the catalog actually has', () => {
  const wrong: string[] = [];
  for (const [id, guide] of Object.entries(ROUTE_GUIDE)) {
    guide.steps.forEach((step, i) => {
      const bind = stepBind(step);
      if (bind === null || bind.of !== 'quest') return;
      /*
       * A quest name that matches nothing resolves to "not done" forever, which
       * renders as a permanent blocker on a route the player may have finished.
       * The catalog is the authority, so the name has to be in it.
       */
      /*
       * The REAL vendored table, not `CATALOG` above - that is a two-quest
       * fixture built for the gate-status checks, and testing quest names
       * against it would fail for every quest in the game bar two. The first
       * version of this check did exactly that and reported "The Hex" as
       * missing from a catalog that contains it.
       */
      const found = QUESTS.quests.some((q) => q.name?.toLowerCase() === bind.name.toLowerCase());
      if (!found) wrong.push(`${id}#${String(i)} names the quest "${bind.name}", which is not in the catalog`);
    });
  }
  assert.deepEqual(wrong, [], wrong.join('\n        '));
});

/*
 * Rivens, by weapon and by how often they have been rolled.
 *
 * Both of this route's tips turn on exactly these facts - disposition is
 * per-weapon, and "an unrolled Riven has option value to a buyer" is the
 * reroll count - and the panel showed neither. The fingerprint is a JSON
 * STRING whose shape is documented in `docs/research/inventory-schema.md`.
 */
const RIVEN_ACCOUNT = {
  Upgrades: [
    { ItemType: '/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare', UpgradeFingerprint: JSON.stringify({ compat: '/Lotus/Weapons/Tenno/Rifle/Boltor', rerolls: 12, lvl: 8 }) },
    { ItemType: '/Lotus/Upgrades/Mods/Randomized/LotusPistolRandomModRare', UpgradeFingerprint: JSON.stringify({ compat: '/Lotus/Weapons/Tenno/Pistols/Lex', rerolls: 0, lvl: 0 }) },
    // Veiled: a challenge and NO weapon, so it cannot be priced by weapon.
    { ItemType: '/Lotus/Upgrades/Mods/Randomized/LotusModularMeleeRandomModRare', UpgradeFingerprint: JSON.stringify({ challenge: { Type: 'x', Progress: 0, Required: 150 } }) },
    // Malformed: must be counted, never guessed at.
    { ItemType: '/Lotus/Upgrades/Mods/Randomized/Broken', UpgradeFingerprint: '{not json' },
    // Not a riven at all - a ranked mod lives in the same array.
    { ItemType: '/Lotus/Upgrades/Mods/Rifle/SerrationMod', UpgradeFingerprint: '{"lvl":10}' },
  ],
} as unknown as RawAccount;

check('each riven names its weapon and how many times it has been rolled', () => {
  const a = resolveStep({ of: 'rivens' }, { ...FULL, account: RIVEN_ACCOUNT });
  const said = a.rows.map((r) => `${r.lead}|${r.text}`);
  assert.ok(said.includes('unrolled|Lex'), `unrolled riven missing: ${said.join(', ')}`);
  assert.ok(said.includes('12 rolls|Boltor'), `rolled riven missing: ${said.join(', ')}`);
});

check('the unrolled riven leads, because that is the one with option value', () => {
  const a = resolveStep({ of: 'rivens' }, { ...FULL, account: RIVEN_ACCOUNT });
  const first = a.rows.find((r) => r.text === 'Lex' || r.text === 'Boltor');
  assert.equal(first?.text, 'Lex', `ordered wrong: ${a.rows.map((r) => r.text).join(', ')}`);
});

check('a veiled riven is not given a weapon it does not have yet', () => {
  const a = resolveStep({ of: 'rivens' }, { ...FULL, account: RIVEN_ACCOUNT });
  assert.ok(a.rows.some((r) => r.text.includes('still veiled')), 'the veiled riven vanished');
  assert.equal(a.rows.filter((r) => r.text === 'Boltor' || r.text === 'Lex').length, 2, 'a veiled riven was given a weapon');
});

check('an unparseable fingerprint is counted, never guessed', () => {
  const a = resolveStep({ of: 'rivens' }, { ...FULL, account: RIVEN_ACCOUNT });
  const bad = a.rows.find((r) => r.text.includes('could not parse'));
  assert.equal(bad?.lead, '1', `said: ${String(bad?.lead)}`);
});

check('a ranked mod in the same array is not mistaken for a riven', () => {
  const a = resolveStep({ of: 'rivens' }, { ...FULL, account: RIVEN_ACCOUNT });
  // Serration has a `{"lvl":10}` fingerprint and lives in `Upgrades` too.
  assert.ok(!a.rows.some((r) => /serration/i.test(r.text)), 'a ranked mod reached the riven list');
});

/*
 * A ROUTE WITH NO RATE MUST SAY WHY, WHERE THE PLAYER CAN SEE IT.
 * ————————————————————————————————————————————
 * `MODEL_GAPS` holds fifteen reasons a route cannot be given a platinum-per-
 * hour figure, and every one is a real finding rather than a shrug. They were
 * consumed by exactly one thing: the test asserting they exist. The panel's
 * rate block is `chain && (...)`, so those routes rendered NOTHING - no figure,
 * no absence, no reason - and a player asking what a route pays got silence,
 * which reads as an oversight rather than an answer.
 *
 * These two checks keep the set honest now that it is on screen: every route
 * lacking a model needs a reason, and no reason may describe a route that has
 * one.
 */
check('every route without a throughput model explains itself', () => {
  const missing = PLAT_ROUTES.filter((r) => MODELS[r.id] === undefined)
    .map((r) => r.id)
    .filter((id) => MODEL_GAPS[id] === undefined);
  assert.deepEqual(missing, [], `these routes show no rate and give no reason: ${missing.join(', ')}`);
});

check('no explanation is kept for a route that does have a rate', () => {
  const stale = Object.keys(MODEL_GAPS).filter((id) => MODELS[id] !== undefined);
  assert.deepEqual(stale, [], `these routes have a model, so their "no rate" note is wrong: ${stale.join(', ')}`);
});

console.log(failures === 0 ? '\nevery bound step answers honestly' : `\n${String(failures)} step rule(s) broken`);
if (failures > 0) process.exit(1);
