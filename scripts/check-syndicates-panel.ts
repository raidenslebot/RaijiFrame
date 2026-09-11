/**
 * Self-check for the syndicate standing ladder.
 *
 * The failure modes worth guarding are all quiet ones — a wrong "to next rank"
 * looks exactly as authoritative as a right one:
 *
 *   - `Standing` is cumulative, so "to next" is `nextRank.min - standing`, never
 *     the rank's own span;
 *   - a syndicate parked on its rank ceiling is discarding everything it earns,
 *     and that has to surface;
 *   - the six originals share one daily pool and must be counted once;
 *   - a tag with no verified thresholds reports a gap, not a plausible zero.
 *
 * Run: node scripts/check-syndicates-panel.ts
 */
import assert from 'node:assert/strict';
import { syndicateState } from '../src/data/subsystems.ts';
import { buildRow, buildRows, dailyTotals, specFor } from '../src/panels/syndicates/ladder.ts';

type Account = Parameters<typeof syndicateState>[0];
const as = (v: unknown): Account => v as Account;

/** MR 30 -> every daily pool refills to 16,000 + 30 x 500 = 31,000. */
const account = as({
  PlayerLevel: 30,
  DailyAffiliation: 12_000,
  DailyAffiliationCetus: 31_000,
  DailyAffiliationEntrati: 0,
  SupportedSyndicate: 'RedVeilSyndicate',
  Affiliations: [
    // Rank 3 begins at 71,000 and holds to 141,000.
    { Tag: 'RedVeilSyndicate', Standing: 90_000, Title: 3, Initiated: true },
    // Parked exactly on the rank-2 ceiling: earning here is thrown away.
    { Tag: 'NewLokaSyndicate', Standing: 71_000, Title: 2, Initiated: true },
    // 4,000 short of rank 1, and 31,000 of allowance left today.
    { Tag: 'CetusSyndicate', Standing: 1_000, Title: 0, Initiated: true },
    { Tag: 'EntratiSyndicate', Standing: 250_000, Title: 5, Initiated: true },
    { Tag: 'LibrarySyndicate', Standing: 60_000, Initiated: true },
    { Tag: 'KahlSyndicate', Standing: 2, Title: 2, Initiated: true },
    { Tag: 'RadioLegionIntermission16Syndicate', Standing: 45_000, Title: 4 },
    { Tag: 'MadeUpSyndicate', Standing: 999, Title: 1 },
  ],
});

const state = syndicateState(account);
const rows = buildRows(state);
const byTag = new Map(rows.map((r) => [r.tag, r]));
const row = (tag: string) => {
  const r = byTag.get(tag);
  assert.ok(r, `no row built for ${tag}`);
  return r;
};

function toNextIsMeasuredFromCumulativeStanding() {
  const veil = row('RedVeilSyndicate');
  assert.equal(veil.title, 3);
  assert.equal(veil.tierMin, 71_000);
  assert.equal(veil.tierMax, 141_000);
  assert.equal(veil.nextAt, 141_000);
  // 141,000 - 90,000. Not 141,000, and not 70,000 (the span).
  assert.equal(veil.toNext, 51_000);
  assert.ok(Math.abs((veil.progress ?? 0) - 19 / 70) < 1e-9);
}

function ceilingIsReportedRatherThanRenderedAsProgress() {
  const loka = row('NewLokaSyndicate');
  assert.equal(loka.atCeiling, true, 'standing sitting on the tier max is wasted standing');
  assert.equal(loka.maxed, false, 'rank 2 of 5 is not maxed');
  assert.equal(loka.toNext, 0);
  assert.equal(loka.progress, 1);
}

function maxRankIsMaxedNotJustFull() {
  const entrati = row('EntratiSyndicate');
  assert.equal(entrati.maxTitle, 5);
  assert.equal(entrati.nextAt, null);
  assert.equal(entrati.toNext, null);
  assert.equal(entrati.maxed, false, '250,000 is inside rank 5, whose ceiling is 372,000');
  assert.equal(entrati.tierMax, 372_000);
}

function rankUpTodayNeedsTheAllowanceToActuallyCoverTheGap() {
  const cetus = row('CetusSyndicate');
  assert.equal(cetus.toNext, 4_000);
  assert.equal(cetus.dailyRemaining, 31_000);
  assert.equal(cetus.rankUpToday, true);

  const veil = row('RedVeilSyndicate');
  assert.equal(veil.dailyRemaining, 12_000, 'the six originals read the shared counter');
  assert.equal(veil.rankUpToday, false, '12,000 does not cover a 51,000 gap');
  // The reach marker sits ahead of the fill by exactly one allowance.
  assert.ok(Math.abs((veil.reachToday ?? 0) - (19 + 12) / 70) < 1e-9);
}

function untitledSyndicatesShowABalanceNotARank() {
  const simaris = row('LibrarySyndicate');
  assert.equal(simaris.title, null, 'Simaris has no titles at all');
  assert.equal(simaris.tierMax, 125_000);
  assert.equal(simaris.toNext, null);
  assert.ok(Math.abs((simaris.progress ?? 0) - 0.48) < 1e-9);
}

function kahlStandingIsARankCounterNotAStandingPool() {
  const kahl = row('KahlSyndicate');
  assert.equal(kahl.tierMin, 2);
  assert.equal(kahl.nextAt, 3, 'Kahl ranks are one "standing" apart');
  assert.equal(kahl.toNext, 1);
  assert.ok((kahl.note ?? '').includes('Kahl Credits'));
}

function nightwaveIsTenThousandPerRankAndUncapped() {
  const nw = row('RadioLegionIntermission16Syndicate');
  assert.equal(nw.isNightwave, true);
  assert.equal(nw.nextAt, 50_000);
  assert.equal(nw.toNext, 5_000);
  assert.equal(nw.maxTitle, null, 'this season is absent from the export we have');
  assert.equal(nw.dailyRemaining, null, 'Nightwave has no daily standing cap');
}

function unknownTagsDegradeToAGapNotAZero() {
  const made = row('MadeUpSyndicate');
  assert.equal(made.progress, null);
  assert.equal(made.toNext, null);
  assert.equal(made.tierMax, null);
  assert.equal(made.name, 'Made Up');
  assert.ok((made.note ?? '').includes('Unrecognised'));
}

function rowsSortByHowCloseTheNextRankIs() {
  const ordered = rows.map((r) => r.tag);
  // Absolute distance, not percentage: New Loka (0) then Kahl (1) then Cetus
  // (4,000) then Nightwave (5,000) then Red Veil (51,000).
  assert.deepEqual(ordered.slice(0, 5), [
    'NewLokaSyndicate',
    'KahlSyndicate',
    'CetusSyndicate',
    'RadioLegionIntermission16Syndicate',
    'RedVeilSyndicate',
  ]);
  // Everything without a next rank sinks to the bottom.
  const tail = new Set(ordered.slice(5));
  assert.deepEqual(tail, new Set(['LibrarySyndicate', 'EntratiSyndicate', 'MadeUpSyndicate']));
}

function sharedPoolIsCountedExactlyOnce() {
  const totals = dailyTotals(state, rows);
  // 12,000 shared + 31,000 Cetus + 0 Entrati. Red Veil and New Loka add nothing.
  assert.equal(totals.remaining, 43_000);
  assert.equal(totals.cap, 31_000 * 3);
  assert.equal(totals.pools, 3);
  // Kahl's counter is absent from this fixture and the tag has no mapping in
  // subsystems for Nokko/Quills/Vox/Ventkids/Necraloid either: reported, not hidden.
  assert.ok(totals.unmapped.includes("Kahl's Garrison"));
  assert.ok(!totals.unmapped.includes('Nightwave'), 'uncapped is not the same as unmapped');
}

function pledgeComesFromSupportedSyndicate() {
  assert.equal(row('RedVeilSyndicate').pledged, true);
  assert.equal(row('CetusSyndicate').pledged, false);
}

function missingTitleIsDerivedAndFlagged() {
  const derived = buildRow(
    { tag: 'CetusSyndicate', standing: 30_000, rank: null, initiated: true, dailyRemaining: null, dailyCap: null, sharedPool: false, isNightwave: false },
    null,
  );
  assert.equal(derived.title, 2, '30,000 sits inside rank 2 (27,000 - 71,000)');
  assert.equal(derived.titleInferred, true);
}

function everyKnownTagHasAColourAndAName() {
  for (const tag of ['SteelMeridianSyndicate', 'HexSyndicate', 'ZarimanSyndicate', 'NecraloidSyndicate']) {
    const spec = specFor(tag);
    assert.ok(spec.name.length > 0 && spec.color.length > 0, tag);
  }
  // Necraloid stops at rank 3, so rank 3 is genuinely the end of its ladder.
  const necra = buildRow(
    { tag: 'NecraloidSyndicate', standing: 141_000, rank: 3, initiated: true, dailyRemaining: null, dailyCap: null, sharedPool: false, isNightwave: false },
    null,
  );
  assert.equal(necra.maxTitle, 3);
  assert.equal(necra.maxed, true);
}

const checks = [
  toNextIsMeasuredFromCumulativeStanding,
  ceilingIsReportedRatherThanRenderedAsProgress,
  maxRankIsMaxedNotJustFull,
  rankUpTodayNeedsTheAllowanceToActuallyCoverTheGap,
  untitledSyndicatesShowABalanceNotARank,
  kahlStandingIsARankCounterNotAStandingPool,
  nightwaveIsTenThousandPerRankAndUncapped,
  unknownTagsDegradeToAGapNotAZero,
  rowsSortByHowCloseTheNextRankIs,
  sharedPoolIsCountedExactlyOnce,
  pledgeComesFromSupportedSyndicate,
  missingTitleIsDerivedAndFlagged,
  everyKnownTagHasAColourAndAName,
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
console.log(failed ? `\n${failed} check(s) failed` : '\nall syndicate ladder rules hold');
process.exitCode = failed ? 1 : 0;
