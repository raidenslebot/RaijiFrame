/**
 * Self-check for the build resolver.
 *
 * Two kinds of input, and the gate says which is which:
 *
 *   1. The REAL anonymised capture at public/__review-acct.json (real shapes,
 *      ids rewritten to x0, x1, …; no presets, no configs). Everything the
 *      resolver can say about it is "unknown at the presets rung", and the
 *      gate holds it to exactly that - not to a guess dressed as an answer.
 *
 *   2. The happy path, which no capture on disk carries. Its account is
 *      ASSEMBLED here from the review capture's own melee instance (Ack &
 *      Brunt, id x0) plus the loadout rungs the schema documents
 *      (`docs/research` + `src/data/account.ts`). It is a shape test, labelled
 *      as such, and it is replaced by a real capture the first time one is
 *      available - see the architecture doc's named unknowns.
 *
 * Run: node scripts/check-build.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { RawAccount } from '../src/data/account.ts';
import { POLARITY, rankFromFingerprint, resolveBuild } from '../src/data/build.ts';

let checks = 0;
let failures = 0;
function ok(label: string, fn: () => void): void {
  checks++;
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${label}\n        ${(err as Error).message.split('\n')[0]}`);
  }
}

const review = JSON.parse(readFileSync(new URL('../public/__review-acct.json', import.meta.url), 'utf8')) as RawAccount;

console.log('\nthe real anonymised capture');

ok('with no loadout ids the ladder stops at the first rung and says so', () => {
  const r = resolveBuild(review, 3);
  assert.equal(r.unknown, 'loadout-ids');
  assert.equal(r.installed, null, 'an unresolved build must not read as an empty one');
  assert.equal(r.itemType, null);
  assert.equal(r.rankCurrent, null);
});

ok('no account at all is unknown at the account rung, never a thrown error', () => {
  assert.equal(resolveBuild(null, 0).unknown, 'account');
  assert.equal(resolveBuild(undefined, 1).unknown, 'account');
});

console.log('\nthe assembled happy path (a shape test, from the capture\'s own melee instance)');

const ackBrunt = review.Melee?.find((m) => m.ItemType === '/Lotus/Weapons/Grineer/Melee/GrineerTylAxeAndBoar/RegorAxeShield');
assert.ok(ackBrunt, 'the review capture carries Ack & Brunt');

function assembled(overrides: Partial<RawAccount> = {}, instanceOverrides: Partial<NonNullable<RawAccount['Melee']>[number]> = {}): RawAccount {
  return {
    ...review,
    CurrentLoadOutIds: [{ $oid: 'L1' }],
    LoadOutPresets: {
      NORMAL: [{ ItemId: { $oid: 'L1' }, m: { ItemId: ackBrunt!.ItemId, ItemType: ackBrunt!.ItemType, mod: 1 } }],
    },
    Melee: [
      {
        ...ackBrunt!,
        Features: 1 | 2 | 32, // catalyst, exilus, one arcane slot
        Polarity: [
          { Slot: 3, Value: 'AP_ATTACK' },
          { Slot: 6, Value: 'AP_TACTIC' },
        ],
        Configs: [
          { Upgrades: [] },
          { Upgrades: ['M1', '', 'M2', '', '', '', '', '', '', '', ''] },
        ],
        ...instanceOverrides,
      },
    ],
    Upgrades: [
      { ItemId: { $oid: 'M1' }, ItemType: '/Lotus/Upgrades/Mods/Melee/WeaponCritDamageMod', UpgradeFingerprint: '{"lvl":5}' },
      { ItemId: { $oid: 'M2' }, ItemType: '/Lotus/Upgrades/Mods/Melee/Expert/WeaponMeleeDamageModExpert', UpgradeFingerprint: '{"lvl":8}' },
    ],
    ...overrides,
  };
}

ok('every rung resolves: instance, active config B, two installed mods with their ranks, the empty slots skipped', () => {
  const r = resolveBuild(assembled(), 3);
  assert.equal(r.unknown, null);
  assert.equal(r.itemType, ackBrunt!.ItemType);
  assert.equal(r.configIndex, 1);
  assert.equal(r.configAssumed, false);
  assert.deepEqual(
    r.installed?.map((m) => [m.index, m.itemType, m.rank]),
    [
      [0, '/Lotus/Upgrades/Mods/Melee/WeaponCritDamageMod', 5],
      [2, '/Lotus/Upgrades/Mods/Melee/Expert/WeaponMeleeDamageModExpert', 8],
    ],
  );
  assert.equal(r.catalyst, true);
  assert.equal(r.exilus, true);
  assert.equal(r.arcaneSlots, 1);
  assert.deepEqual(r.polarities, [
    { slot: 3, value: 'AP_ATTACK' },
    { slot: 6, value: 'AP_TACTIC' },
  ]);
});

ok('the capture\'s rank-30 melee with 5 Forma: lifetime rank is 30, the current rank is UNKNOWN', () => {
  const r = resolveBuild(assembled(), 3);
  assert.equal(r.forma, 5);
  assert.equal(r.rankLifetime, 30);
  assert.equal(r.rankCurrent, null, 'a Forma resets the rank and XP cannot say where it is now');
});

ok('an item never polarised has a known current rank', () => {
  const r = resolveBuild(assembled({}, { Polarized: 0 }), 3);
  assert.equal(r.rankCurrent, r.rankLifetime);
});

ok('a preset without `mod` reads config A and says it assumed', () => {
  const acc = assembled();
  delete acc.LoadOutPresets!.NORMAL![0]!.m!.mod;
  const r = resolveBuild(acc, 3);
  assert.equal(r.configIndex, 0);
  assert.equal(r.configAssumed, true);
  assert.deepEqual(r.installed, [], 'config A is measured empty, not unknown');
});

ok('an installed oid that matches no Upgrades entry is an unknown mod, not a dropped one', () => {
  const r = resolveBuild(assembled({ Upgrades: [] }), 3);
  assert.equal(r.installed?.length, 2);
  assert.equal(r.installed?.[0]?.itemType, null);
  assert.equal(r.installed?.[0]?.rank, null);
});

ok('each missing rung is named: presets, selection, instance, config', () => {
  assert.equal(resolveBuild(assembled({ LoadOutPresets: { NORMAL: [] } }), 3).unknown, 'presets');
  assert.equal(resolveBuild(assembled(), 1).unknown, 'selection');
  const gone = assembled();
  gone.Melee = [];
  assert.equal(resolveBuild(gone, 3).unknown, 'instance');
  const noConfig = resolveBuild(assembled({}, { Configs: [{ Upgrades: [] }] }), 3);
  assert.equal(noConfig.unknown, 'config');
  assert.equal(noConfig.itemType, ackBrunt!.ItemType, 'what was resolved before the stop is still reported');
});

ok('a weapon with nothing on it is a MEASURED empty build, not an unreadable one', () => {
  /*
   * CAUGHT LIVE, and it is the case the overlay exists for.
   *
   * The player opened a Gammacor
   * (`/Lotus/Weapons/Syndicates/CephalonSuda/Pistols/CSDroidArray`). The app
   * named it correctly, read the purse, and published `unknown: upgrades` with
   * NO PLAN - so the panel had nothing to say while the player placed three
   * mods by hand. An automodding overlay that goes quiet in front of an
   * unmodded weapon has failed at the only thing it is for.
   *
   * The account is why. DE omits an empty array rather than writing one: that
   * weapon's config A carried `Skins` and `pricol` and no `Upgrades` key at
   * all, while the AutoPistol beside it IN THE SAME PAYLOAD carried `Upgrades`
   * with seven of eight filled. So the absence is not a gap in the read - the
   * read was complete - it is the game saying the slots are empty.
   *
   * `installed` was already documented "Null = unknown. An empty array is a
   * MEASURED empty config." Only the code producing it disagreed.
   */
  const bare = resolveBuild(assembled({}, { Configs: [{ Skins: [] }, {}, {}] as never }), 3);
  assert.equal(bare.unknown, null, 'A BARE WEAPON IS UNREADABLE: the panel says nothing on the item that needs it most');
  assert.deepEqual(bare.installed, [], 'a weapon with no mods reports an unknown build rather than an empty one');
  assert.equal(bare.itemType, ackBrunt!.ItemType, 'the item it could not read the mods of is still named');

  // An explicit empty array means the same thing and always did.
  const explicit = resolveBuild(assembled({}, { Configs: [{ Upgrades: [] }, {}, {}] as never }), 3);
  assert.equal(explicit.unknown, null, 'an explicitly empty Upgrades array stopped being a measured empty build');
  assert.deepEqual(explicit.installed, []);

  /*
   * AND THE CONFIG ITSELF STILL HAS TO EXIST. A missing config is a real gap -
   * the app was pointed at a config the instance does not carry - and it stops
   * at the rung above rather than inventing an empty build there.
   */
  const noConfig = resolveBuild(assembled({}, { Configs: [] }), 3);
  assert.equal(noConfig.unknown, 'config', 'a MISSING config is now read as an empty build, which invents a bare weapon out of a gap');
  assert.equal(noConfig.installed, null, 'a missing config reports an empty build rather than an unknown one');
});

ok('fingerprints: {"lvl":N} reads N; empty, malformed and riven-sized strings without lvl read null', () => {
  assert.equal(rankFromFingerprint('{"lvl":10}'), 10);
  assert.equal(rankFromFingerprint(''), null);
  assert.equal(rankFromFingerprint('{not json'), null);
  assert.equal(rankFromFingerprint('{"buffs":[]}'), null);
  assert.equal(rankFromFingerprint('{"lvl":8,"buffs":[{"Tag":"WeaponCritChanceMod","Value":0.5}]}'), 8);
});

ok('the polarity vocabulary covers every account code and both universal spellings agree', () => {
  for (const code of ['AP_ATTACK', 'AP_DEFENSE', 'AP_TACTIC', 'AP_POWER', 'AP_WARD', 'AP_PRECEPT', 'AP_UMBRA', 'AP_UNIVERSAL', 'AP_ANY'] as const)
    assert.ok(code in POLARITY, code);
  assert.equal(POLARITY.AP_ANY, POLARITY.AP_UNIVERSAL);
  assert.equal(POLARITY.AP_ATTACK, 'madurai');
});

console.log(`\n${checks} checks, ${failures} failures\n`);
process.exit(failures === 0 ? 0 : 1);
