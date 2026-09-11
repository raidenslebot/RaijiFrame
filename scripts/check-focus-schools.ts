/**
 * The focus school mapping, and the rule it must never break.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The focus panel sorts the account's `FocusUpgrades` into five schools by
 * reading the FOURTH SEGMENT of each node's `/Lotus/...` path. That is a string
 * index into a path shape nobody controls, and it fails silently in both
 * directions: a path DE reshapes lands in no school and the counts quietly drop
 * nodes, or - far worse - a near-miss lands in the WRONG school and the panel
 * confidently tells a player they have unbound something they have not.
 *
 * The panel also states a bill: what a school's remaining waybound nodes cost.
 * That bill is arithmetic over the census, so a census that is wrong produces a
 * number that is wrong and looks exactly as authoritative as a right one.
 *
 * And underneath both sits this app's standing rule, which no panel is allowed
 * to break: AN UNREAD ACCOUNT KNOWS NOTHING. It must report unknown, never
 * zero. "You have unlocked 0 nodes" is a claim about the player; "we have not
 * read your account" is a claim about us, and only the second one is true.
 *
 * The focus panel had no check of any of this - it was written in a pass that
 * could not reach `scripts/`, and the gap was reported rather than hidden.
 *
 * Run: node scripts/check-focus-schools.ts
 */

import assert from 'node:assert/strict';
import {
  WAYBOUND_PER_SCHOOL,
  WAYBOUND_UNBIND_COST,
  nodeCensus,
  schoolDossier,
  schoolOfPath,
} from '../src/panels/focus/schoolDossier.ts';
import type { RawAccount } from '../src/data/account.ts';

/* ------------------------------------------------- the path to school join */

const CASES: ReadonlyArray<readonly [string, string | null]> = [
  ['/Lotus/Upgrades/Focus/Attack/Active/DashFireFocusUpgrade', 'AP_ATTACK'],
  ['/Lotus/Upgrades/Focus/Defense/Active/BlastFocusUpgrade', 'AP_DEFENSE'],
  ['/Lotus/Upgrades/Focus/Tactic/Passive/RecoveryFocusUpgrade', 'AP_TACTIC'],
  ['/Lotus/Upgrades/Focus/Ward/Active/HealFocusUpgrade', 'AP_WARD'],
  ['/Lotus/Upgrades/Focus/Power/Passive/EnergyFocusUpgrade', 'AP_POWER'],
];

for (const [path, expected] of CASES) {
  assert.equal(schoolOfPath(path), expected, `${path} sorts into ${String(expected)}`);
}

/*
 * A path whose fourth segment is not one of the five must return null and NOT
 * be forced into a school. This is the Tauron Strike case: the research says
 * its inventory shape is unknown, and guessing would put a node in a tree it
 * does not belong to.
 */
assert.equal(schoolOfPath('/Lotus/Upgrades/Focus/Tauron/Active/SomeUpgrade'), null, 'an unknown tree is not guessed at');
assert.equal(schoolOfPath('/Lotus/Upgrades/Focus'), null, 'a path too short to have a school segment');
assert.equal(schoolOfPath(''), null, 'the empty path');
/* Case matters: the directory names are exact, and a lowercase near-miss must
   miss rather than being normalised into a school it may not belong to. */
assert.equal(schoolOfPath('/Lotus/Upgrades/Focus/attack/Active/X'), null, 'a case near-miss is not absorbed');

/* ------------------------------------------------------------- the census */

const acc = {
  FocusUpgrades: [
    { ItemType: '/Lotus/Upgrades/Focus/Attack/Active/A', IsUniversal: true },
    { ItemType: '/Lotus/Upgrades/Focus/Attack/Active/B' },
    { ItemType: '/Lotus/Upgrades/Focus/Attack/Passive/C', IsUniversal: false },
    { ItemType: '/Lotus/Upgrades/Focus/Ward/Active/D', IsUniversal: true },
    { ItemType: '/Lotus/Upgrades/Focus/Tauron/Active/E' },
    { ItemType: 42 },
  ],
} as unknown as RawAccount;

const census = nodeCensus(acc);
const attack = census.bySchool.get('AP_ATTACK');
assert.ok(attack !== undefined, 'the attack school is present');
assert.equal(attack.unlocked, 3, 'every attack node is counted');
assert.equal(attack.unbound, 1, 'only IsUniversal: true counts as unbound');

const ward = census.bySchool.get('AP_WARD');
assert.equal(ward?.unlocked, 1);
assert.equal(ward?.unbound, 1);

assert.equal(census.unboundTotal, 2, 'unbound totals across schools');
assert.equal(census.unplaced, 2, 'an unknown tree and a non-string path are reported, not absorbed');
assert.equal(census.bySchool.has('AP_TACTIC'), false, 'a school with no nodes gets no row, rather than a fabricated zero');

/*
 * THE ONE THAT MATTERS MOST.
 *
 * An empty payload must produce an empty census - no rows, no zeros. The
 * distinction is the whole honesty rule: the panel is only allowed to render a
 * zero when it has read an account and that account genuinely holds none. A
 * census that invented `{unlocked: 0}` rows here would make "no row" and
 * "measured zero" indistinguishable one layer up, and the panel would state a
 * zero it had never measured.
 */
const empty = nodeCensus({} as unknown as RawAccount);
assert.equal(empty.bySchool.size, 0, 'an unread account yields NO school rows, not five zeroes');
assert.equal(empty.unboundTotal, 0);
assert.equal(empty.unplaced, 0);

/* --------------------------------------------------------------- the bill */

/*
 * Recorded rather than derived, because these are published prices and the
 * panel quotes them as facts. If DE changes either, this fails and the panel's
 * arithmetic gets looked at rather than silently drifting.
 *
 * [V-WIKI]: ten waybound nodes across five schools, 1,500,000 focus per school.
 */
assert.equal(WAYBOUND_UNBIND_COST, 750_000, 'the published unbind cost');
assert.equal(WAYBOUND_PER_SCHOOL, 2, 'two waybound nodes per school');
assert.equal(
  WAYBOUND_UNBIND_COST * WAYBOUND_PER_SCHOOL,
  1_500_000,
  'and the two agree with the published per-school total, which is the cross-check',
);

/* ------------------------------------------------------- the dossier */

const UNREAD = 'link the game once so your focus is read';

const dossier = (over: Partial<Parameters<typeof schoolDossier>[0]> = {}) =>
  schoolDossier({
    key: 'AP_ATTACK',
    pooled: null,
    pooledTotal: null,
    nodes: null,
    dailyCap: null,
    unread: UNREAD,
    ...over,
  });

/*
 * THE HONESTY RULE, WHICH IS THE ONE WORTH LOCKING DOWN.
 *
 * An unread account owes nothing, is short of nothing, and is a number of days
 * away from nothing. Every one of those is UNKNOWN, and the failure mode this
 * guards against is the panel quietly rendering the full 1,500,000 as a
 * shortfall the player has - which is a claim about them made from no data.
 */
{
  const d = dossier();
  assert.equal(d.bill.met, null, 'unread means the bill cannot be checked');
  assert.equal(d.bill.have, null, 'and the pool is unknown, never zero');
  assert.ok((d.bill.unknown ?? '').length > 0, 'and it says what would settle it');
  assert.equal(d.shortfall, null, 'an unread account is not short - it is unread');
  assert.equal(d.days, null, 'and no number of days can be derived from it');
  assert.notEqual(d.bill.met, false, 'it must NEVER read as a shortfall');

  /*
   * The COST is still stated. Two nodes at 750,000 is true of every account, so
   * it is a fact about the game rather than an invention about this player.
   */
  assert.equal(
    d.bill.need,
    WAYBOUND_PER_SCHOOL * WAYBOUND_UNBIND_COST,
    'with nodes unread, the requirement stated is the whole school',
  );
}

/* Already finished: nothing is owed, and the bill says so rather than zeroing. */
{
  const d = dossier({ nodes: { unlocked: 6, unbound: 2 }, pooled: 0, pooledTotal: 0 });
  assert.equal(d.remaining, 0, 'both waybound nodes are unbound');
  assert.equal(d.bill.need, null, 'so there is no quantity left to require');
  assert.equal(d.bill.met, true);
  assert.equal(d.shortfall, null, 'nothing owed is not a shortfall of zero');
  assert.equal(d.days, null);
}

/* Short, with the arithmetic checked against this school's own pool. */
{
  const d = dossier({
    nodes: { unlocked: 6, unbound: 0 },
    pooled: 500_000,
    pooledTotal: 1_000_000,
    dailyCap: 300_000,
  });
  assert.equal(d.remaining, 2);
  assert.equal(d.bill.need, 1_500_000, 'two nodes still to unbind');
  assert.equal(d.bill.have, 500_000);
  assert.equal(d.bill.met, false);
  assert.equal(d.shortfall, 1_000_000, 'the gap, not the whole bill');
  assert.equal(d.days, Math.ceil(1_000_000 / 300_000), 'days is the ceiling of shortfall over the cap');
  assert.equal(d.days, 4);
  assert.equal(d.share, 0.5, 'half the banked focus is here');
}

/* The cap is what makes days sayable; without it the figure is not invented. */
{
  const d = dossier({ nodes: { unlocked: 6, unbound: 0 }, pooled: 0, pooledTotal: 0, dailyCap: null });
  assert.equal(d.shortfall, 1_500_000, 'a READ pool of zero really is zero, and the gap is the whole bill');
  assert.equal(d.days, null, 'but with no cap there is no rate, so no number of days');
}

/* One node done, one to go - the bill halves rather than staying whole. */
{
  const d = dossier({ nodes: { unlocked: 6, unbound: 1 }, pooled: 0, pooledTotal: 0, dailyCap: 250_000 });
  assert.equal(d.remaining, 1);
  assert.equal(d.bill.need, WAYBOUND_UNBIND_COST);
  assert.equal(d.days, 3, 'ceil(750000 / 250000)');
}

console.log('  ok    a focus node sorts into its school by path, exactly');
console.log('  ok    an unknown tree is reported as unplaced, never guessed into a school');
console.log('  ok    only IsUniversal marks a node unbound');
console.log('  ok    an unread account yields no rows at all, never five zeroes');
console.log('  ok    the published waybound prices agree with the published per-school total');
console.log('  ok    an unread dossier is never short and never zero, and still states the cost');
console.log('  ok    days is the ceiling of the shortfall over the cap, and null without one');
console.log('\nthe focus census counts what it read and nothing else\n');
