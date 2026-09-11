/**
 * Self-check for subsystem derivation.
 *
 * The rules that matter here: an absent field never becomes a confident zero,
 * foundry readiness is derived from the clock rather than from a boolean that
 * does not exist, and the values the payload genuinely cannot supply stay null.
 *
 * Run: node scripts/check-subsystems.ts
 */
import assert from 'node:assert/strict';
import {
  dailyState,
  focusState,
  foundryState,
  intrinsicsState,
  inventoryTotals,
  nemesisState,
  railjackState,
  subsystemSummary,
} from '../src/data/subsystems.ts';

/** The fixture is deliberately untyped: GEP hands over arbitrary JSON. */
type Account = Parameters<typeof subsystemSummary>[0];
const as = (v: unknown): Account => v as Account;

const NOW = 1_756_598_400_000;
const date = (ms: number) => ({ $date: { $numberLong: String(ms) } });

const full = as({
  PlayerLevel: 30,
  FocusXP: { AP_POWER: 1_000_000, AP_ATTACK: 250_000 },
  FocusUpgrades: [
    { ItemType: '/Lotus/Upgrades/Focus/A', IsUniversal: true },
    { ItemType: '/Lotus/Upgrades/Focus/B' },
  ],
  FocusCapacity: 47, DailyFocus: 120_000, FocusAbility: '/Lotus/Upgrades/Focus/Void',
  PlayerSkills: {
    LPP_SPACE: 3_400, LPS_PILOTING: 10, LPS_GUNNERY: 5, LPS_TACTICAL: 0,
    LPS_ENGINEERING: 2, LPS_COMMAND: 1,
    LPP_DRIFTER: 0, LPS_DRIFT_COMBAT: 4, LPS_DRIFT_RIDING: 0,
    LPS_DRIFT_OPPORTUNITY: 0, LPS_DRIFT_ENDURANCE: 0,
  },
  Affiliations: [
    { Tag: 'SteelMeridianSyndicate', Standing: 99_000, Title: 5, Initiated: true },
    { Tag: 'CetusSyndicate', Standing: 12_000, Title: 2 },
    { Tag: 'RadioLegionIntermission16Syndicate', Standing: 4_000 },
    { Tag: 'VoxSyndicate', Standing: 500 },
  ],
  SupportedSyndicate: 'SteelMeridianSyndicate',
  DailyAffiliation: 8_000, DailyAffiliationCetus: 31_000,
  PendingRecipes: [
    { ItemId: { $oid: 'a1' }, ItemType: '/Recipes/Done', CompletionDate: date(NOW - 1) },
    { ItemId: { $oid: 'a2' }, ItemType: '/Recipes/Later', CompletionDate: date(NOW + 90_000) },
    { ItemId: { $oid: 'a3' }, ItemType: '/Recipes/Soon', CompletionDate: date(NOW + 1_000) },
    { ItemId: { $oid: 'a4' }, ItemType: '/Recipes/Broken' },
  ],
  Recipes: [{ ItemType: '/Recipes/Braton', ItemCount: 2 }],
  Nemesis: {
    Faction: 'FC_GRINEER', Rank: 3, WeaponIdx: 7, BirthNode: 'SolNode12',
    Hints: [0, 2], GuessHistory: [1], InfNodes: [{ Node: 'SolNode1', Influence: 0.5 }],
    d: date(NOW - 86_400_000), HenchmenKilled: 40,
  },
  NemesisHistory: [
    { k: true }, { k: true }, { k: false, SecondInCommand: true },
  ],
  CrewShips: [{
    ItemName: 'Sun Chaser', SlotLevels: [3, 2, 1],
    Weapon: { PILOT: { PRIMARY_A: { ItemType: '/Weapons/Photor', ItemId: { $oid: 'w1' } } } },
  }],
  CrewMembers: [{
    ItemId: { $oid: 'c1' }, XP: 5_000, NemesisFingerprint: 0,
    SkillEfficiency: { PILOTING: { Assigned: 5 }, GUNNERY: { Assigned: 3 } },
  }],
  CrewMemberBin: { Slots: 1 },
  CrewShipWeapons: [{}, {}], CrewShipSalvagedWeapons: [{}],
  CrewShipFusionPoints: 250,
  NextRefill: date(NOW + 3_600_000),
  TradesRemaining: 4, GiftsRemaining: 6,
  CompletedSorties: ['s1', 's2'], LastSortieReward: [{ SortieId: { $oid: 'x' } }],
  EntratiVaultCountLastPeriod: 3, EntratiVaultCountResetDate: date(NOW + 100),
  LibraryPersonalTarget: '/Enemies/Charger',
  LibraryActiveDailyTaskInfo: { ScansRequired: 3 },
  SeasonChallengeHistory: [{ challenge: 'a', id: '1' }, { challenge: 'b', id: '2' }],
  TrainingDate: date(NOW + 7_200_000),
  RegularCredits: 5_000_000, PremiumCredits: 1_140, PremiumCreditsFree: 50, FusionPoints: 284_100,
  PrimeTokens: 3,
  MiscItems: [
    { ItemType: '/Lotus/Types/Items/MiscItems/Ferrite', ItemCount: 942_117 },
    { ItemType: '/Lotus/Types/Items/MiscItems/PrimeBucks', ItemCount: 812 },
    { ItemType: '/Lotus/Types/Items/MiscItems/SchismKey', ItemCount: 4 },
  ],
});

/** A fresh or truncated GEP read. Nothing here may throw. */
const empty = as({});

function emptyAccountNeverThrowsAndNeverInvents() {
  const s = subsystemSummary(empty, NOW);
  assert.equal(s.focus.pooledTotal, 0);
  assert.equal(s.focus.daily.cap, null, 'no MR means no cap, not a default MR');
  assert.equal(s.focus.capacity, null);
  assert.equal(s.intrinsics.masteryXp, 0);
  assert.equal(s.intrinsics.railjack.unspentPoints, null);
  assert.deepEqual(s.syndicates.syndicates, []);
  assert.equal(s.foundry.nextReadyMs, null);
  assert.equal(s.nemesis.active, null);
  assert.equal(s.railjack.ship, null);
  assert.equal(s.daily.trades.remaining, null);
  assert.equal(s.totals.credits, null, 'absent credits is null, not 0');
  assert.equal(s.totals.ducats, null);
}

function focusReadsPoolsAndWaybound() {
  const f = focusState(full);
  assert.equal(f.pooledTotal, 1_250_000);
  assert.equal(f.schools.find((s) => s.key === 'AP_POWER')?.pooled, 1_000_000);
  assert.equal(f.schools.find((s) => s.key === 'AP_WARD')?.pooled, 0);
  assert.equal(f.waybound.unlocked, 1);
  assert.equal(f.waybound.total, null, 'waybound denominator is not in the payload');
  assert.equal(f.spent, null, 'spent focus is not derivable');
  assert.equal(f.daily.cap, 250_000 + 30 * 5_000);
}

function intrinsicsRankAndMastery() {
  const i = intrinsicsState(full);
  assert.equal(i.railjack.ranks, 18);
  assert.equal(i.drifter.ranks, 4);
  assert.equal(i.railjack.maxRanks, 50);
  assert.equal(i.drifter.maxRanks, 40);
  assert.equal(i.masteryXp, 22 * 1_500);
  assert.equal(i.masteryXpMax, 90 * 1_500);
  assert.equal(i.railjack.unspentPoints, 3, 'LPP_SPACE is divided by 1000');
}

function syndicateDailyPools() {
  const s = subsystemSummary(full, NOW).syndicates;
  const byTag = new Map(s.syndicates.map((x) => [x.tag, x]));
  assert.equal(byTag.get('SteelMeridianSyndicate')?.dailyRemaining, 8_000, 'shared faction pool');
  assert.equal(byTag.get('SteelMeridianSyndicate')?.dailyCap, 16_000 + 30 * 500);
  assert.equal(byTag.get('CetusSyndicate')?.dailyRemaining, 31_000, 'own pool');
  assert.equal(byTag.get('VoxSyndicate')?.dailyRemaining, null, 'unverified tag stays null');
  assert.equal(byTag.get('RadioLegionIntermission16Syndicate')?.isNightwave, true);
  assert.equal(byTag.get('RadioLegionIntermission16Syndicate')?.dailyCap, null);
  assert.equal(s.pledged, 'SteelMeridianSyndicate');
}

function syndicateDailyPoolsGoStaleAcrossTheReset() {
  /*
   * A KEPT READ SAYS NOTHING ABOUT TODAY.
   *
   * `dailyState` and `platPosition` have always nulled their daily counters
   * once the account's own `NextRefill` is behind the clock. `syndicateState`
   * did not, so a read taken yesterday handed back yesterday's remaining
   * standing and two panels presented it as a fact about this morning - the
   * one number a player checks before deciding where to spend an evening.
   *
   * Null, not the cap: what is left is unknown until the next read, and the
   * player may already have spent it.
   */
  const s = subsystemSummary(full, NOW).syndicates;
  const fresh = new Map(s.syndicates.map((x) => [x.tag, x]));
  assert.equal(s.staleAcrossReset, false, 'the fixture is read before its own reset');
  assert.equal(fresh.get('SteelMeridianSyndicate')?.dailyRemaining, 8_000);

  // One day on, the same bytes describe a day that has already turned over.
  const later = subsystemSummary(full, NOW + 86_400_000 * 2).syndicates;
  const stale = new Map(later.syndicates.map((x) => [x.tag, x]));
  assert.equal(later.staleAcrossReset, true, 'a read from before the reset must say so');
  assert.equal(stale.get('SteelMeridianSyndicate')?.dailyRemaining, null, 'the shared pool cannot be quoted');
  assert.equal(stale.get('CetusSyndicate')?.dailyRemaining, null, 'nor a per-syndicate pool');

  // Cumulative standing and rank are NOT daily counters and must survive.
  assert.equal(
    stale.get('SteelMeridianSyndicate')?.standing,
    fresh.get('SteelMeridianSyndicate')?.standing,
    'banked standing does not reset, so it must not be nulled with the pools',
  );
}

function foundryReadinessIsDerivedFromTheClock() {
  const f = foundryState(full, NOW);
  assert.equal(f.ready.length, 1);
  assert.equal(f.ready[0]?.itemType, '/Recipes/Done');
  assert.equal(f.building.length, 3, 'an unparseable date counts as still building');
  assert.equal(f.nextReadyMs, NOW + 1_000, 'soonest first');
  assert.equal(f.building[0]?.remainingMs, 1_000);
  assert.equal(f.unstartedBlueprints, 1);

  const later = foundryState(full, NOW + 60_000);
  assert.equal(later.ready.length, 2, 'the same data re-reads as time passes');
}

function nemesisSplitsKilledFromConverted() {
  const n = nemesisState(full);
  assert.equal(n.vanquished, 2);
  assert.equal(n.converted, 1);
  assert.equal(n.onCall, 1);
  assert.equal(n.active?.hintsRevealed, 2);
  assert.equal(n.active?.guesses, 1);
  assert.equal(n.active?.influencedNodes, 1);
  assert.equal(n.active?.weaponIdx, 7);
  assert.equal(n.active?.weapon, null, 'resolving the weapon needs the nemesis manifest');
}

function railjackReadsArmamentsAndCrew() {
  const r = railjackState(full);
  assert.equal(r.ship?.name, 'Sun Chaser');
  assert.deepEqual(r.ship?.componentLevels, [3, 2, 1]);
  assert.equal(r.ship?.armaments.length, 1);
  assert.equal(r.ship?.armaments[0]?.emplacement, 'PILOT');
  assert.equal(r.ship?.armaments[0]?.itemType, '/Weapons/Photor');
  assert.equal(r.crew[0]?.skills['PILOTING'], 5);
  assert.equal(r.crew[0]?.isConvertedLich, false);
  assert.equal(r.crewSlotsFree, 1);
  assert.equal(r.armamentsOwned, 2);
  assert.equal(r.fusionPoints, 250);
}

function dailyGatesStayHonest() {
  const d = dailyState(full, NOW);
  assert.equal(d.resetsAtMs, NOW + 3_600_000);
  assert.equal(d.trades.cap, 30, 'no Founder field means no +2');
  assert.equal(d.gifts.cap, 30);
  assert.equal(d.sortie.done, null, "today's sortie needs worldState");
  assert.equal(d.sortie.rewardPending, true);
  assert.equal(d.archon.rewardPending, false);
  assert.equal(d.netracells.used, 3);
  assert.equal(d.netracells.cap, null, 'the weekly cap is not in the payload');
  assert.equal(d.simaris.scans, null, 'Scans is absent until the daily is started');
  assert.equal(d.simaris.scansRequired, 3);
  assert.equal(d.nightwaveActsDone, 2);
}

/**
 * The daily reset is a property of the GAME, not of an account.
 *
 * Warframe rolls its daily counters at 00:00 UTC. `NextRefill` is authoritative
 * when the account has been read, but before that the instant is still exactly
 * knowable — and the Daily panel depends on that to be useful with the game
 * closed. This guards both halves: the account value must still win when
 * present, and the computed fallback must be a real future 00:00 UTC.
 */
function dailyResetIsKnownWithoutAnAccount() {
  // Account value wins.
  const withAccount = dailyState(full, NOW);
  assert.equal(withAccount.resetsAtMs, NOW + 3_600_000, 'NextRefill must take precedence');

  // No account at all: still a real deadline.
  const bare = dailyState({} as never, NOW);
  assert.ok(bare.resetsAtMs !== null, 'a computed reset must exist with no account');
  const d = new Date(bare.resetsAtMs!);
  assert.equal(d.getUTCHours(), 0, 'reset is midnight UTC');
  assert.equal(d.getUTCMinutes(), 0);
  assert.equal(d.getUTCSeconds(), 0);
  assert.ok(bare.resetsAtMs! > NOW, 'the reset must be in the future');
  assert.ok(bare.resetsAtMs! - NOW <= 86_400_000, 'and no more than a day away');

  // Everything the account owns stays unmeasured — never zero.
  assert.equal(bare.focus.remaining, null, 'no account means no focus reading');
  assert.equal(bare.standing.remaining, null);
  assert.equal(bare.trades.cap, null, 'trade cap needs PlayerLevel');

  // Omitting `now` means the wall clock: the reset is always a real instant.
  const wall = dailyState({} as never).resetsAtMs;
  assert.ok(wall !== null && wall > Date.now() && wall - Date.now() <= 86_400_000, 'no clock means the wall clock');

  // A kept read goes stale: a `NextRefill` already behind the clock must roll
  // forward to the next 00:00 UTC, never count down to a moment that has passed.
  const stale = dailyState({ NextRefill: date(NOW - 3_600_000) } as never, NOW);
  assert.ok(stale.resetsAtMs !== null && stale.resetsAtMs > NOW, 'a past NextRefill rolls forward');
  assert.equal(stale.resetsAtMs, bare.resetsAtMs, 'to the same instant the clock alone names');
}

function ducatsAreNotAya() {
  const t = inventoryTotals(full, 2);
  assert.equal(t.ducats, 812, 'PrimeBucks is Ducats');
  assert.equal(t.aya, 4, 'SchismKey is Aya');
  assert.equal(t.regalAya, 3);
  assert.equal(t.platinumTradable, 1_090);
  assert.equal(t.topResources.length, 2);
  assert.equal(t.topResources[0]?.count, 942_117, 'sorted by quantity');
  assert.equal(t.distinctResources, 3);
}

function legacyMongoDatesStillParse() {
  const legacy = as({ NextRefill: { sec: NOW / 1000, usec: 0 } });
  assert.equal(dailyState(legacy, NOW - 1).resetsAtMs, NOW);
}

function legacyOidIsRead() {
  // A pre-U19.5 account sends `$id`. The foundry id is what claimCompletedRecipe
  // takes, so dropping it would leave a ready build unclaimable from the overlay.
  const legacy = as({
    PendingRecipes: [{ ItemId: { $id: 'old1' }, ItemType: '/Recipes/Done', CompletionDate: date(NOW - 1) }],
  });
  assert.equal(foundryState(legacy, NOW).ready[0]?.id, 'old1');
}

function garbageShapesDegradeToNullRatherThanThrow() {
  // A truncated GEP memory read yields wrong TYPES, not just missing keys. The
  // whole defensive-reader design exists for this, so assert it directly.
  const junk = as({
    PlayerLevel: 'thirty',
    FocusXP: null,
    FocusUpgrades: 'nope',
    PlayerSkills: 42,
    Affiliations: [null, { Tag: 5 }, 'x'],
    PendingRecipes: [{ ItemType: '/Recipes/A', CompletionDate: 'soon' }],
    CrewShips: 'nope',
    MiscItems: [7, { ItemType: '/Lotus/Types/Items/MiscItems/PrimeBucks' }],
    NextRefill: 'tomorrow',
    PremiumCredits: Number.NaN,
  });
  const s = subsystemSummary(junk, NOW);

  assert.equal(s.focus.daily.cap, null, 'a non-numeric MR must not produce a NaN cap on screen');
  assert.equal(s.focus.pooledTotal, 0);
  assert.equal(s.focus.nodesUnlocked, 0);
  assert.equal(s.intrinsics.masteryXp, 0);
  assert.deepEqual(s.syndicates.syndicates, [], 'rows without a usable Tag are dropped, not half-read');
  assert.equal(s.foundry.ready.length, 0, 'an unreadable date must never read as ready');
  assert.equal(s.foundry.building[0]?.remainingMs, null);
  assert.equal(s.railjack.ship, null);
  assert.ok(s.daily.resetsAtMs !== null, 'an unreadable NextRefill still leaves the clock');
  assert.equal(s.totals.platinum, null, 'NaN is not a platinum balance');
  assert.equal(s.totals.ducats, null, 'a stack with no count is not zero ducats');
}

const checks = [
  emptyAccountNeverThrowsAndNeverInvents,
  focusReadsPoolsAndWaybound,
  intrinsicsRankAndMastery,
  syndicateDailyPools,
  syndicateDailyPoolsGoStaleAcrossTheReset,
  foundryReadinessIsDerivedFromTheClock,
  nemesisSplitsKilledFromConverted,
  railjackReadsArmamentsAndCrew,
  dailyGatesStayHonest,
  dailyResetIsKnownWithoutAnAccount,
  ducatsAreNotAya,
  legacyMongoDatesStillParse,
  legacyOidIsRead,
  garbageShapesDegradeToNullRatherThanThrow,
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
console.log(failed ? `\n${failed} check(s) failed` : '\nall subsystem rules hold');
process.exitCode = failed ? 1 : 0;
