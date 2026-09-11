/**
 * Self-check for the item catalog join.
 *
 * Fixtures, not the live catalog: these are the rules that must hold regardless of
 * what WFCD ships today — the StoreItems rewrite, the booster exception, the
 * vaulted split, founder exclusion, modular parts, and unmatched reporting.
 *
 * The Appendix A drift warnings it prints are expected - the fixtures are
 * deliberately not the real catalog, and that warning firing is itself the check
 * that the cross-check works.
 *
 * Run: node scripts/check-itemdb.ts
 */
import assert from 'node:assert/strict';
import {
  normaliseItemType,
  parseWfcd,
  parseRank40,
  parseBoosters,
  buildItemDb,
  ownership,
  totalOwnership,
  obtainablePct,
  type ItemDbEntry,
} from '../src/data/itemdb.ts';
import type { RawInventory } from '../src/core/gep.ts';

// --- the normaliser --------------------------------------------------------
// Booster store items carry no `/Lotus/StoreItems/` prefix - that is exactly why
// they need their own lookup rather than the string rewrite.
const boosters = parseBoosters(
  JSON.stringify({ '/Lotus/Types/Boosters/AffinityBooster3DayStoreItem': { typeName: '/Lotus/Types/Boosters/AffinityBooster' } }),
);
assert.equal(normaliseItemType('/Lotus/StoreItems/Powersuits/Mag/Mag'), '/Lotus/Powersuits/Mag/Mag');
assert.equal(normaliseItemType('/Lotus/Powersuits/Mag/Mag'), '/Lotus/Powersuits/Mag/Mag', 'idempotent on bare types');
assert.equal(
  normaliseItemType('/Lotus/Types/Boosters/AffinityBooster3DayStoreItem', boosters),
  '/Lotus/Types/Boosters/AffinityBooster',
  'the booster exception, which no prefix rewrite can cover',
);
assert.equal(
  normaliseItemType('/Lotus/Types/Boosters/AffinityBooster3DayStoreItem'),
  '/Lotus/Types/Boosters/AffinityBooster3DayStoreItem',
  'without ExportBoosters the booster types silently never match',
);
assert.equal(normaliseItemType('/Lotus/Types/Boosters/Unknown', boosters), '/Lotus/Types/Boosters/Unknown');

// --- parsing ---------------------------------------------------------------
const wf = parseWfcd(
  'Warframes',
  JSON.stringify([
    { uniqueName: '/Lotus/Powersuits/Mag/Mag', name: 'Mag', masterable: true, masteryReq: 0, type: 'Warframe', productCategory: 'Suits' },
    { uniqueName: '/Lotus/Powersuits/Excalibur/ExcaliburPrime', name: 'Excalibur Prime', masterable: true, vaulted: true },
    { uniqueName: '/Lotus/Powersuits/Mag/MagPrime', name: 'Mag Prime', masterable: true, vaulted: true },
    { uniqueName: '/Lotus/Powersuits/EntratiMech/NechroTech', name: 'Voidrig', masterable: true },
    { name: 'nameless row', masterable: true },
  ]),
);
assert.equal(wf.length, 4, 'rows without a uniqueName are dropped');
assert.equal(wf.every((e) => e.maxRank === 30), true, 'parse never guesses a rank-40 cap');

// --- the modding surface ----------------------------------------------------
// Two REAL rows, values quoted from the 2026-09-07 census of the export (Ack &
// Brunt from Melee.json, Acceltra from Primary.json). The assertions are the
// three ways this surface goes wrong: a short damage vector read as damage, an
// absent polarity list read as "no slots", and a fraction read as a percent.
{
  const [ackBrunt] = parseWfcd(
    'Melee',
    JSON.stringify([
      {
        uniqueName: '/Lotus/Weapons/Grineer/Melee/GrineerTylAxeAndBoar/RegorAxeShield',
        name: 'Ack & Brunt',
        masterable: true,
        masteryReq: 3,
        criticalChance: 0.2,
        criticalMultiplier: 2,
        procChance: 0.10000002,
        damagePerShot: [14.900001, 14.900001, 119.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        totalDamage: 149,
        stancePolarity: 'madurai',
        range: 2.5,
        comboDuration: 5,
        followThrough: 0.60000002,
        windUp: 0.69999999,
        blockingAngle: 70,
        slamAttack: 447,
        slideAttack: 149,
        heavyAttackDamage: 745,
        isPrime: false,
        attacks: [{ name: 'Normal Attack', speed: 0.833, crit_chance: 20, crit_mult: 2, status_chance: 10, damage: { impact: 14.9, puncture: 14.9, slash: 119.2 } }],
      },
    ]),
  );
  assert.ok(ackBrunt);
  assert.equal(ackBrunt.damagePerShot?.length, 20, 'the damage vector is the export\'s 20 types');
  assert.equal(ackBrunt.damagePerShot?.[2], 119.2, 'index 2 is slash');
  assert.equal(ackBrunt.polarities, undefined, 'an absent polarity list is unknown, not an empty list');
  assert.equal(ackBrunt.multishot, undefined, 'melee has no pellet count');
  assert.equal(ackBrunt.criticalChance, 0.2, 'fractions stay fractions');
  assert.equal(ackBrunt.attacks?.[0]?.critChance, 20, 'the per-mode block keeps the export\'s percent numbers, renamed');
  assert.equal(ackBrunt.stancePolarity, 'madurai');
  assert.equal(ackBrunt.heavyAttackDamage, 745);
  assert.equal(ackBrunt.isPrime, false);

  const [acceltra] = parseWfcd(
    'Primary',
    JSON.stringify([
      {
        uniqueName: '/Lotus/Weapons/Tenno/LongGuns/TnoMicroRocketLauncher/TnoMicroRocketLauncher',
        name: 'Acceltra',
        masterable: true,
        multishot: 1,
        trigger: 'Auto',
        fireRate: 12,
        magazineSize: 48,
        reloadTime: 2,
        accuracy: 23.529411,
        noise: 'Alarming',
        polarities: ['madurai'],
        exilusPolarity: 'madurai',
        damagePerShot: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
    ]),
  );
  assert.ok(acceltra);
  assert.equal(acceltra.trigger, 'Auto');
  assert.equal(acceltra.multishot, 1);
  assert.deepEqual(acceltra.polarities, ['madurai']);
  assert.equal(acceltra.exilusPolarity, 'madurai');
  assert.equal(acceltra.damagePerShot, undefined, 'a 19-element vector is not a damage vector');
  console.log('  ok    the modding surface reads the export as it is, and absence stays unknown');
}

const misc = parseWfcd('Misc', JSON.stringify([
  { uniqueName: '/Lotus/Weapons/Ostron/Melee/Tip/TipOne', name: 'Zaw Tip', masterable: true },
  { uniqueName: '/Lotus/StoreItems/Types/Items/MiscItems/Forma', name: 'Forma' },
]));
assert.deepEqual(misc.map((e) => e.name), ['Zaw Tip'], 'Misc keeps only its masterable rows');

const rank40 = parseRank40(JSON.stringify({
  '/Lotus/Weapons/Grineer/KuvaLich/Rifle/KuvaKarak': { maxLevelCap: 40 },
  '/Lotus/Weapons/Tenno/Rifle/Braton': {},
}));
assert.deepEqual(rank40, ['/Lotus/Weapons/Grineer/KuvaLich/Rifle/KuvaKarak']);

// --- index build -----------------------------------------------------------
const primaries: ItemDbEntry[] = [
  { uniqueName: '/Lotus/Weapons/Tenno/Rifle/Braton', name: 'Braton', category: 'Primary', masteryReq: 0, masterable: true, maxRank: 30 },
  { uniqueName: '/Lotus/Weapons/Grineer/KuvaLich/Rifle/KuvaKarak', name: 'Kuva Karak', category: 'Primary', masteryReq: 5, masterable: true, maxRank: 30 },
  { uniqueName: '/Lotus/Weapons/Enemy/DaxRifle', name: 'Dax Rifle', category: 'Primary', masteryReq: 0, masterable: false, maxRank: 30 },
];
/*
 * THE DRIFT ALARM IS THE ONLY THING WATCHING ELEVEN DENOMINATORS, so it gets
 * asserted rather than merely observed.
 *
 * `MASTERABLE_APPENDIX_A` is eleven hand-recorded counts that the live catalog
 * has to keep matching; measured against WFCD today all eleven are exact. The
 * whole protection against that quietly rotting is one `console.warn` inside
 * `buildItemDb` - and a warning nobody asserts on is deletable by accident, at
 * which point the numbers rot in silence and every ownership percentage in the
 * app is quietly wrong.
 *
 * These fixtures are far below every appendix figure, so the alarm MUST fire
 * here. Catching it turns the file header's claim - "that warning firing is
 * itself the check that the cross-check works" - from a sentence into a test.
 */
const warned: string[] = [];
const realWarn = console.warn;
console.warn = (...a: unknown[]): void => void warned.push(a.map(String).join(' '));
const db = buildItemDb({ Warframes: wf, Primary: primaries, Misc: misc }, boosters, rank40);
console.warn = realWarn;

assert.ok(warned.length > 0, 'the Appendix A cross-check never fired - the drift alarm is gone');
for (const category of ['Warframes', 'Primary', 'Misc']) {
  assert.ok(
    warned.some((w) => w.includes(`[itemdb] ${category}:`) && w.includes('denominator drifted')),
    `${category} is far below its appendix figure and must have warned`,
  );
}
// Printed after the assertions so the expected noise still reaches a reader.
for (const w of warned) realWarn(w);

assert.equal(db.byType.get('/Lotus/Weapons/Grineer/KuvaLich/Rifle/KuvaKarak')?.maxRank, 40);
assert.equal(db.byType.get('/Lotus/Powersuits/EntratiMech/NechroTech')?.maxRank, 40, 'Necramech cap is hardcoded');
assert.equal(db.byType.get('/Lotus/Weapons/Tenno/Rifle/Braton')?.maxRank, 30);
assert.equal(db.masterable.get('Primary'), 2, 'non-masterable rows stay in the index but out of the denominator');
assert.equal(db.missingCategories.includes('Melee'), true, 'a category that never loaded is missing, not zero');
assert.equal(db.byCategory.has('Melee'), false);

// --- the join --------------------------------------------------------------
const acc: RawInventory = {
  Suits: [
    { ItemType: '/Lotus/Powersuits/Mag/Mag', XP: 900_000 },
    { ItemType: '/Lotus/Powersuits/Excalibur/ExcaliburPrime', XP: 900_000 },
  ],
  LongGuns: [
    // Prefixed on purpose: the account is believed bare, and this is the assertion
    // research asked for — it must still join, and it must be counted.
    { ItemType: '/Lotus/StoreItems/Weapons/Tenno/Rifle/Braton', XP: 450_000 },
    { ItemType: '/Lotus/Weapons/Grineer/KuvaLich/Rifle/KuvaKarak', XP: 800_000, Polarized: 5 },
    { ItemType: '/Lotus/Weapons/Tenno/Rifle/Braton', XP: 10 },
  ],
  Melee: [{ ItemType: '/Lotus/Weapons/Tenno/Melee/Zaw', ModularParts: ['/Lotus/Weapons/Ostron/Melee/Tip/TipOne', 42] }],
  SpecialItems: [{ ItemType: '/Lotus/Powersuits/Excalibur/ExaltedBlade' }],
} as unknown as RawInventory;

const report = ownership(acc, db);
assert.equal(report.storePrefixed, 1, 'the StoreItems rewrite fired exactly once');

const frames = report.byCategory.get('Warframes');
assert.ok(frames);
assert.equal(frames.total, 3, 'Excalibur Prime leaves the denominator');
assert.equal(frames.unobtainableExcluded, 1);
assert.equal(frames.owned, 1, '...and the numerator, even though the account owns it');
assert.equal(frames.masteredOwned, 1);
assert.equal(frames.vaultedTotal, 1, 'Mag Prime only — Excalibur Prime is already excluded');
assert.equal(frames.vaultedOwned, 0);
assert.deepEqual(frames.missing.map((e) => e.name).sort(), ['Mag Prime', 'Voidrig']);

const prim = report.byCategory.get('Primary');
assert.ok(prim);
assert.equal(prim.owned, 2, 'duplicate Bratons count once');
assert.equal(prim.total, 2, 'the non-masterable Dax rifle is in neither side');
assert.equal(prim.masteredOwned, 1, 'a 5-Forma Kuva weapon at 800k XP is NOT claimed as maxed');

const mods = report.byCategory.get('Misc');
assert.equal(mods?.owned, 1, 'modular parts are owned through ModularParts');
assert.equal(mods?.masteredOwned, 0, 'a part carries no XP, so it is never claimed as mastered');

assert.deepEqual(
  report.unmatched.map((u) => u.itemType),
  ['/Lotus/Weapons/Tenno/Melee/Zaw'],
  'unmatched is reported, deduped, and free of exalted-weapon noise',
);

const all = totalOwnership(report);
assert.equal(all.owned, 4);
assert.equal(all.total, 6, '3 frames + 2 primaries + 1 modular part');
assert.equal(obtainablePct({ ...all, owned: 7, total: 8, vaultedOwned: 0, vaultedTotal: 0 }), 87, 'floored, never rounded up');
assert.equal(obtainablePct({ ...all, owned: 0, total: 0, vaultedOwned: 0, vaultedTotal: 0 }), null);

// An empty account must not throw and must not invent ownership.
assert.equal(totalOwnership(ownership(null, db)).owned, 0);

console.log('check-itemdb: ok');
