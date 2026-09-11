/**
 * "You are missing this mod" is not advice until it says where to get it.
 *
 * `src/data/acquire.ts` turns the single best drop the catalogue keeps into a
 * place and a number of runs, and this is what stops that number becoming a
 * confident lie. The failure mode is specific: an expected-runs figure that is
 * wrong sends a player to farm the wrong thing for an evening and never throws.
 *
 * THE THREE ANSWERS MUST STAY THREE DIFFERENT SHAPES. A mod that drops, a mod
 * that must be traded for, and a mod nobody can place are different facts, and
 * the one thing this module must never do is render the third as if it were the
 * first.
 *
 * Run: node scripts/check-acquire.ts
 */
import assert from 'node:assert/strict';
import { planetOf, routeRank, routeShort, routeText, routeTo, type Route } from '../src/data/acquire.ts';

let checks = 0;
let failures = 0;
function ok(label: string, fn: () => void): void {
  checks++;
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${label}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log('what a player has to do');

ok('a drop becomes a place and an expected number of runs', () => {
  // Hunter Munitions' best listed source in the export: Ghoul Rictus Alpha at 11.05 %.
  const r = routeTo({ best: { where: 'Ghoul Rictus Alpha', chance: 11.05 }, sources: 3, tradable: true });
  assert.equal(r.kind, 'farm');
  if (r.kind !== 'farm') return;
  assert.equal(r.where, 'Ghoul Rictus Alpha');
  // 100 / 11.05 = 9.05, so ten whole runs.
  assert.equal(r.expectedRuns, 10);
  assert.equal(r.sources, 3);
  assert.match(routeText(r), /Ghoul Rictus Alpha/);
  assert.match(routeText(r), /10 runs/);
});

ok('the expectation rounds UP, because rounding down promises the next run pays', () => {
  // 50 % is two runs, not one: the first run is not the expectation.
  assert.equal((routeTo({ best: { where: 'x', chance: 50 }, sources: 1, tradable: null }) as { expectedRuns: number }).expectedRuns, 2);
  // 100 % is one run and never zero.
  assert.equal((routeTo({ best: { where: 'x', chance: 100 }, sources: 1, tradable: null }) as { expectedRuns: number }).expectedRuns, 1);
  // A rate above 100 cannot mean less than one run.
  assert.equal((routeTo({ best: { where: 'x', chance: 200 }, sources: 1, tradable: null }) as { expectedRuns: number }).expectedRuns, 1);
  // A punishing rate is stated, not softened.
  assert.equal((routeTo({ best: { where: 'x', chance: 0.5 }, sources: 1, tradable: null }) as { expectedRuns: number }).expectedRuns, 200);
});

ok('a mod that drops nowhere but is tradable is a PURCHASE, not a farm', () => {
  // Primed Pressure Point: no drop table in the export, tradable true.
  const r = routeTo({ best: null, sources: 0, tradable: true });
  assert.deepEqual(r, { kind: 'trade' });
  assert.match(routeText(r), /trade/);
  assert.doesNotMatch(routeText(r), /runs/, 'a trade must never be worded as a farm');
});

ok('a mod that drops nowhere and cannot be traded is UNKNOWN, and says so', () => {
  /*
   * WHAT HOLDS FOR BOTH KINDS OF UNKNOWN. Which sentence each one gets is the
   * check below this section; here is the part neither may break - it is not a
   * farm, and it must never be worded as one.
   */
  for (const tradable of [false, null]) {
    const r = routeTo({ best: null, sources: 0, tradable });
    assert.equal(r.kind, 'unknown');
    assert.doesNotMatch(routeText(r), /runs/, 'an unknown must never be worded as a farm');
    assert.doesNotMatch(routeText(r), /trade for it/, 'an unknown must never be worded as a trade');
  }
});

ok('a source with no stated rate is not a route - it cannot answer "how long"', () => {
  assert.equal(routeTo({ best: { where: 'somewhere', chance: 0 }, sources: 1, tradable: true }).kind, 'trade');
  assert.equal(routeTo({ best: { where: 'somewhere', chance: 0 }, sources: 1, tradable: false }).kind, 'unknown');
});

console.log('\nwhich one to do first');

ok('the easiest farm sorts first, a trade under every farm, an unknown last', () => {
  const easy = routeTo({ best: { where: 'a', chance: 50 }, sources: 1, tradable: null });
  const hard = routeTo({ best: { where: 'b', chance: 0.5 }, sources: 1, tradable: null });
  const buy = routeTo({ best: null, sources: 0, tradable: true });
  const none = routeTo({ best: null, sources: 0, tradable: false });
  const order = [none, buy, hard, easy].sort((x, y) => routeRank(x) - routeRank(y)).map((r) => r.kind);
  assert.deepEqual(order, ['farm', 'farm', 'trade', 'unknown']);
  // And specifically: even a 200-run farm sorts ahead of a trade, because it
  // costs time rather than platinum and the overlay should not lead with money.
  assert.ok(routeRank(hard) < routeRank(buy));
  assert.ok(routeRank(buy) < routeRank(none));
});

ok('the short route keeps the destination and the runs, and drops the qualification', () => {
  /*
   * THE COLUMN IS 292 x 263 PX AND CANNOT GROW. A mod name over a wrapped
   * bounty string is three rows, and at three rows a fresh account's eight
   * missing mods showed as two - the other six cut off in silence, on exactly
   * the account that needs the list most.
   *
   * One line a mod is what fixed it, and this is the shortening that made one
   * line possible. It is a SHORTENING, not a different claim: same place, same
   * expectation, less qualification.
   */
  const bounty: Route = { kind: 'farm', where: 'Deimos/Cambion Drift (Level 25 - 30 Cambion Drift Bounty), Rotation A', chance: 2.67, expectedRuns: 38, sources: 9, planet: null, reachable: null };
  assert.equal(routeShort(bounty), 'Deimos/Cambion Drift · 38 runs');
  // The number of runs is the half that decides whether to go tonight; it stays.
  assert.ok(routeShort(bounty).includes('38'), 'the run count was dropped');
  // And it has to be materially shorter, or the row still wraps and nothing was gained.
  assert.ok(routeShort(bounty).length * 2 < routeText(bounty).length, `short ${routeShort(bounty).length} vs full ${routeText(bounty).length}`);

  // A comma with no bracket is the other shape the drop tables use.
  assert.equal(routeShort({ kind: 'farm', where: "Kahl's Garrison (Chipper), Fort", chance: 100, expectedRuns: 1, sources: 158, planet: null, reachable: null }), "Kahl's Garrison · 1 run");
  assert.equal(routeShort({ kind: 'farm', where: 'Tyl Regor, Rotation C', chance: 25.81, expectedRuns: 4, sources: 50, planet: null, reachable: null }), 'Tyl Regor · 4 runs');
  // A place with no qualification at all is already as short as it goes.
  assert.equal(routeShort({ kind: 'farm', where: 'Tyl Regor', chance: 25.81, expectedRuns: 4, sources: 50, planet: null, reachable: null }), 'Tyl Regor · 4 runs');

  // Nothing to shorten on the other two, and they must not be mangled.
  assert.equal(routeShort({ kind: 'trade' }), routeText({ kind: 'trade' }));
  assert.equal(routeShort({ kind: 'unknown', because: 'unread' }), routeText({ kind: 'unknown', because: 'unread' }));
  assert.equal(routeShort({ kind: 'unknown', because: 'not-in-tables' }), routeText({ kind: 'unknown', because: 'not-in-tables' }));
});

ok('"nothing found" and "found nothing" are different sentences, and the catalogue distinguishes them', () => {
  /*
   * THE PLAYER READ "SOURCE UNKNOWN" AS THE NEXT INSTRUCTION.
   *
   * Measured across the whole catalogue by `scripts/measure-routes.ts`: of 1,516
   * mods, 1,127 farm, 222 trade, and 167 route to nothing. Four of those 167 are
   * mods a finished build reaches for - Primed Fury, Primed Shred, Primed Sure
   * Footed, Primed Vigor - and one of them was on screen.
   *
   * For those four the export is not silent. It says `tradable: false` and
   * carries no drop at all, which is a POSITIVE statement: this mod is in no
   * drop table and cannot be bought from another player. Telling the player that
   * sends them to stop searching missions and trade chat; "source unknown" tells
   * them the app is broken. Where it does come from is in no source this app
   * reads and is not guessed at.
   */
  const notInTables = routeTo({ best: null, sources: 0, tradable: false });
  assert.deepEqual(notInTables, { kind: 'unknown', because: 'not-in-tables' });
  assert.equal(routeText(notInTables), 'in no drop table, and not tradable');

  // Absence is not a statement: a row that says nothing either way stays unknown.
  for (const tradable of [undefined, null] as const) {
    const unread = routeTo({ best: null, sources: 0, tradable: tradable ?? null });
    assert.deepEqual(unread, { kind: 'unknown', because: 'unread' }, `tradable=${String(tradable)} was read as a statement`);
    assert.equal(routeText(unread), 'source unknown');
  }

  /*
   * AND `sources` IS PART OF THE CLAIM. A row that says "not tradable" while
   * carrying drop sources has not been read correctly - it has a farm - so the
   * strong sentence is reserved for the case where both halves agree.
   */
  const contradictory = routeTo({ best: null, sources: 3, tradable: false });
  assert.deepEqual(contradictory, { kind: 'unknown', because: 'unread' }, 'a row with drop sources was called "in no drop table"');

  // The ranking does not change: both are still the last thing to recommend.
  assert.equal(routeRank({ kind: 'unknown', because: 'not-in-tables' }), routeRank({ kind: 'unknown', because: 'unread' }));
});

ok('a planet the account has never been to is not a plan, and is not guessed at either', () => {
  /*
   * "TAKING INTO ACCOUNT WHEN YOU MIGHT GET CERTAIN MODS" is in the brief, and
   * for a long time this module answered only half of it: how many runs, never
   * whether the player can go there at all. The overlay would tell an account
   * that has never left Earth to farm the Cambion Drift for thirty-eight runs.
   *
   * The join is the leading segment of the export's own location string, and it
   * only exists for one of the shapes the export uses. The other shapes name a
   * boss, an enemy or a hub, and those must come back `null` - because saying
   * "you cannot get this" on a guess is worse than saying nothing.
   */
  assert.equal(planetOf('Deimos/Cambion Drift (Level 25 - 30 Cambion Drift Bounty), Rotation A'), 'Deimos');
  assert.equal(planetOf('Earth/Cetus (Level 5 - 15 Cetus Bounty), Rotation B'), 'Earth');
  assert.equal(planetOf('Kuva Fortress/Dakata (Capture)'), 'Kuva Fortress');
  /*
   * THE ONE SLASH IN THE REAL EXPORT WHOSE HEAD IS NOT A PLANET, quoted
   * verbatim. The first version of this check had no such case at all - every
   * null example it tried had no slash in it - so removing the shape test
   * entirely still passed. It is a compound region, and a compound region is
   * not a planet the star chart can be asked about.
   */
  assert.equal(planetOf('Dark Refractory, Deimos/Recall: Dactolyst (The Perita Rebellion)'), null);
  // A boss, an enemy and a hub: no planet, and no guessing one.
  assert.equal(planetOf('Tyl Regor, Rotation C'), null);
  assert.equal(planetOf('Ghoul Rictus Alpha'), null);
  assert.equal(planetOf("Kahl's Garrison (Chipper), Fort"), null);
  assert.equal(planetOf(''), null);

  const row = { best: { where: 'Deimos/Cambion Drift (Level 25 - 30 Cambion Drift Bounty), Rotation A', chance: 2.67 }, sources: 9, tradable: true };
  // No predicate supplied: unknown, and NEVER false.
  const blind = routeTo(row);
  assert.equal(blind.kind, 'farm');
  assert.equal(blind.kind === 'farm' && blind.reachable, null);
  assert.ok(!routeText(blind).includes('not open'), 'an unknown reachability was rendered as a refusal');

  const open = routeTo(row, () => true);
  const shut = routeTo(row, () => false);
  assert.equal(open.kind === 'farm' && open.reachable, true);
  assert.equal(shut.kind === 'farm' && shut.reachable, false);
  // The sentence changes shape rather than appending a caveat to advice already given.
  assert.ok(routeText(open).includes('about 38 runs'), routeText(open));
  assert.ok(!routeText(shut).includes('38 runs'), `still counting runs on a locked planet: ${routeText(shut)}`);
  assert.ok(routeText(shut).includes('Deimos'), routeText(shut));
  assert.ok(routeShort(shut).includes('not open yet'), routeShort(shut));

  /*
   * AND IT SORTS LAST AMONG THINGS YOU CAN DO. The list is "what to do
   * tonight", so a 1-run farm on a planet that is shut must sort below a
   * 38-run farm on one that is open - and below a trade, which is a real
   * action - while still sorting above `unknown`, which is not advice at all.
   */
  const easyButShut = routeTo({ best: { where: 'Deimos/Cambion Drift', chance: 100 }, sources: 1, tradable: true }, () => false);
  const hardButOpen = routeTo(row, () => true);
  assert.ok(routeRank(hardButOpen) < routeRank(easyButShut), 'a locked one-run farm outranked an open thirty-eight-run one');
  assert.ok(routeRank({ kind: 'trade' }) < routeRank(easyButShut), 'a locked farm outranked a trade');
  assert.ok(routeRank(easyButShut) < routeRank({ kind: 'unknown', because: 'unread' }), 'a locked farm sorted below "nobody knows"');
});

console.log(`\n${String(checks)} checks, ${String(failures)} failures`);
// `process.exitCode`, not `process.exit()` - see the note in check-fusion.ts.
process.exitCode = failures === 0 ? 0 : 1;
