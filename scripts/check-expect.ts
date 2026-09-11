/**
 * Self-check for the expectation model.
 *
 * WHAT THIS FILE IS ACTUALLY FOR
 * ──────────────────────────────
 * The property that matters is not "does the arithmetic multiply correctly".
 * It is: CAN A REQUIREMENT BE OUTVOTED. The ranking this replaces was a sum,
 * and every hard rule it stated in prose - "a route you cannot start must never
 * top this list", "telling somebody with ten minutes to start an evening grind
 * is the worst answer this panel can give" - was implemented as a number that
 * some combination of the other numbers could beat. Both of those were found
 * violated, and in each case the applied fix was to enlarge the constant.
 *
 * So the checks below are mostly adversarial: they set every other factor to
 * its most favourable value and then assert that the gate still holds. A test
 * that gates a route with everything else neutral proves nothing, because a sum
 * would pass it too.
 *
 * Run: node scripts/check-expect.ts
 */
import assert from 'node:assert/strict';
import {
  expect,
  gearFactor,
  liquidityFactor,
  liveFactor,
  sessionFactor,
  soloFactor,
  tradeFactor,
  type Circumstances,
} from '../src/data/plat-expect.ts';
import type { PlatRoute } from '../src/data/plat-routes.ts';
import type { Rate } from '../src/data/plat-throughput.ts';

/** A route with every attribute at its most favourable, so a gate stands alone. */
function route(over: Partial<PlatRoute> = {}): PlatRoute {
  return {
    id: 'test',
    name: 'Test Route',
    cycle: 'short',
    output: 'set',
    liquidity: 'fast',
    squad: 'solo',
    live: null,
    ...over,
  } as unknown as PlatRoute;
}

function rate(over: Partial<Rate> = {}): Rate {
  return {
    routeId: 'test',
    perHour: 100,
    blockedBy: null,
    links: [],
    fromRuns: 10,
    cap: null,
    tradesPerHour: null,
    perTrade: null,
    volume: null,
    overridden: false,
    ...over,
  };
}

/** Circumstances in which nothing at all reduces the rate. */
const IDEAL: Circumstances = {
  session: 'any',
  solo: false,
  tradesLeft: 100,
  live: new Set(),
  gearShort: 0,
  demandText: 'a starter build',
};

// ───────────────────────────────────────────────────────────────────────────

function anIdealRouteKeepsItsWholeRate(): void {
  const e = expect(rate(), route(), IDEAL);
  assert.equal(e.perHour, 100, 'nothing applies, so nothing is taken off');
  assert.equal(e.links.length, 0, 'and no factor is reported that did not apply');
  assert.equal(e.gatedBy, null);
  assert.equal(e.blockedBy, null);
}

/*
 * THE CHECK THE OLD RANKING COULD NOT PASS.
 * ─────────────────────────────────────────
 * Every remaining dimension at its best, and one gate closed. In a sum this is
 * exactly the arrangement that defeats a penalty: the positives pile up and the
 * single negative is outvoted. Here the gate multiplies, so the arrangement of
 * everything else is irrelevant by construction - which is the entire point of
 * the change, and is what these two assertions are for.
 */
function aClosedGateCannotBeOutvoted(): void {
  const generous = rate({ perHour: 100_000, fromRuns: 5_000 });

  const closedWindow = expect(generous, route({ live: 'baro' }), { ...IDEAL, live: new Set(['fissures']) });
  assert.equal(closedWindow.perHour, 0, 'a route whose window is shut pays nothing, at any rate');
  assert.ok(closedWindow.gatedBy, 'and it must say which gate, not merely rank low');
  assert.match(closedWindow.gatedBy.label, /window is closed/);

  const tooLong = expect(generous, route({ cycle: 'session' }), { ...IDEAL, session: 'quick' });
  assert.equal(tooLong.perHour, 0, 'an evening-long route in a ten-minute window reaches no extraction');
  assert.ok(tooLong.gatedBy);
  assert.match(tooLong.gatedBy.label, /Longer than the time you have/);

  /*
   * And the ordering that follows from it: NO arrangement of the other factors
   * lets a gated route out-earn an ordinary one. A sum cannot promise this; a
   * product can, and this is the assertion that says so.
   */
  const plain = expect(rate({ perHour: 1 }), route(), IDEAL);
  assert.ok(
    plain.perHour !== null && closedWindow.perHour !== null && plain.perHour > closedWindow.perHour,
    'a one-platinum-an-hour route you can actually do beats a hundred-thousand you cannot',
  );
}

/*
 * A SHORTER CYCLE IS NEVER PENALISED. The table this replaces scored `instant`
 * at -1 for an evening, on the reasoning that somebody with a whole evening
 * wants something meatier. That is taste, and it was being charged against a
 * platinum estimate: running a quick route repeatedly for an evening earns
 * exactly its rate, and the model must say so.
 */
function timeYouDoNotNeedIsNotACost(): void {
  for (const session of ['quick', 'hour', 'evening'] as const) {
    assert.equal(sessionFactor('instant', session).kind, 'notApplicable', `instant must be free in a ${session} session`);
  }
  assert.equal(sessionFactor('session', 'evening').kind, 'notApplicable', 'and a long route fits an evening');
  assert.equal(sessionFactor('session', 'any').kind, 'notApplicable', 'stating no session gates nothing');
  assert.equal(sessionFactor('medium', 'quick').kind, 'gate');
  assert.equal(sessionFactor('long', 'hour').kind, 'gate');
}

/*
 * THE TRADE FACTOR IS THE ONE MADE ENTIRELY OF MEASUREMENTS, and its three
 * states have to stay apart: a route that costs no trades has NO factor, a
 * route whose trade count was never read BLOCKS, and one with a real shortfall
 * scales. The middle case is the one a `number | null` would have collapsed.
 */
function tradesAreCapacityNotPreference(): void {
  assert.equal(tradeFactor(rate({ tradesPerHour: null }), 3).kind, 'notApplicable', 'no per-item selling, no factor');
  assert.equal(tradeFactor(rate({ tradesPerHour: 8 }), null).kind, 'unknown', 'an unread count is not an unlimited one');
  assert.equal(tradeFactor(rate({ tradesPerHour: 8 }), 20).kind, 'notApplicable', 'more trades than needed changes nothing');

  const tight = tradeFactor(rate({ tradesPerHour: 8 }), 3);
  assert.equal(tight.kind, 'factor');
  assert.ok(tight.kind === 'factor');
  assert.equal(tight.value, 3 / 8, 'three of the eight trades this hour would need');
  assert.match(tight.link.note, /3 left/, 'and the note carries the real numbers, not a phrase');

  // End to end, in platinum: the hour is worth 100 and 3/8 of it can land.
  const e = expect(rate({ perHour: 100, tradesPerHour: 8 }), route(), { ...IDEAL, tradesLeft: 3 });
  assert.equal(e.perHour, 37.5);
  assert.equal(e.fromRate, 100, 'and the rate it started from is kept, so the panel can say "of 100 measured"');
}

/*
 * AN UNKNOWN FACTOR MAKES THE ANSWER A CEILING, NOT A MYSTERY.
 * ───────────────────────────────────────────────────────────
 * This check asserted the opposite until the app was looked at. Every factor is
 * a fraction in [0,1], so a term nobody could evaluate can only have REDUCED
 * the figure - which means the arithmetic without it is an upper bound, and an
 * upper bound is a real answer.
 *
 * Blocking outright was the first design, on the discipline `evaluate` applies
 * to the throughput chain. In the running app, with no account captured - the
 * ordinary state with the game closed - `tradesLeft` is null, so every route
 * with a measured trade cost was blocked, and a route measured at 172 platinum
 * an hour across nine real runs was ranked below routes nobody had ever run.
 *
 * The discipline is intact, because it was never about the number: treating an
 * unknown as 1 and printing "60" is the lie. Printing "up to 60" is not.
 */
function anUnknownFactorBoundsRatherThanBlocks(): void {
  const e = expect(rate({ perHour: 100, tradesPerHour: 8 }), route(), { ...IDEAL, tradesLeft: null });
  assert.equal(e.perHour, 100, 'the arithmetic without the unknown term is the ceiling');
  assert.equal(e.atMost, true, 'and it MUST be flagged as a ceiling, or it reads as a reading');
  assert.ok(e.blockedBy, 'with the factor that could not be evaluated named');
  assert.match(e.blockedBy.label, /Trades left/);
  assert.equal(e.blockedBy.from, 'unknown', 'and its provenance says so');
  assert.equal(e.fromRate, 100);

  /*
   * THE CEILING IS STILL REDUCED BY EVERYTHING THAT COULD BE MEASURED. An
   * unknown term must not wash out the known ones - that would turn "we could
   * not check one thing" into "we checked nothing", which is how a bound
   * becomes a fiction.
   */
  const mixed = expect(rate({ perHour: 100, tradesPerHour: 8 }), route({ liquidity: 'slow' }), {
    ...IDEAL,
    tradesLeft: null,
  });
  assert.equal(mixed.perHour, 35, 'the measured liquidity factor still applies under the ceiling');
  assert.equal(mixed.atMost, true);

  // A firm estimate is not flagged, or the flag would mean nothing.
  assert.equal(expect(rate(), route(), IDEAL).atMost, false, 'a fully measured estimate is not a ceiling');
}

/*
 * A CEILING NEVER OUTRANKS A READING OF THE SAME SIZE. The tiering in
 * `plat-rank` is what enforces this, but the flag is what it reads, so the flag
 * has to be right for the routes that differ ONLY in what could be measured.
 */
function aCeilingIsAWeakerClaimThanAReading(): void {
  const firm = expect(rate({ perHour: 100, tradesPerHour: 8 }), route(), { ...IDEAL, tradesLeft: 99 });
  const bound = expect(rate({ perHour: 100, tradesPerHour: 8 }), route(), { ...IDEAL, tradesLeft: null });
  assert.equal(firm.perHour, bound.perHour, 'the two arrive at the same number');
  assert.equal(firm.atMost, false);
  assert.equal(bound.atMost, true, 'and only the flag tells them apart, so it carries the whole distinction');
}

/*
 * A GATE BEATS AN UNKNOWN. If the window is shut it does not matter that the
 * trade count is unread: the answer is nothing, and it is knowable. Reporting
 * "cannot estimate" would be false modesty about a certainty, and would let a
 * closed route sit in the unranked tier looking like an opportunity.
 */
function certaintyBeatsIgnorance(): void {
  const e = expect(rate({ tradesPerHour: 8 }), route({ live: 'baro' }), {
    ...IDEAL,
    tradesLeft: null,
    live: new Set(),
  });
  assert.equal(e.perHour, 0, 'shut is shut, whatever else is unread');
  assert.ok(e.gatedBy);
  assert.equal(e.blockedBy, null, 'and it does not also claim to be unmeasurable');
  assert.equal(e.atMost, false, '"up to nothing" is not a sentence worth printing');
}

/*
 * NO MEASURED RATE IS ITS OWN STATE - not a zero, not a gate. It is the
 * ordinary condition of a route the player has never run, and this panel exists
 * partly to tell them about those. The factors still come back, because they
 * are true of the route regardless: knowing that a route you have not measured
 * is also one your gear cannot carry is worth having BEFORE you go and measure
 * it.
 */
function anUnrunRouteIsNotAWorthlessOne(): void {
  const e = expect(null, route({ liquidity: 'slow' }), IDEAL);
  assert.equal(e.perHour, null, 'never run is not measured at nothing');
  assert.equal(e.fromRate, null);
  assert.equal(e.gatedBy, null, 'and it is not gated either');
  assert.ok(
    e.links.some((l) => l.label === 'Sells within the session'),
    'the factors that apply are still reported, so the route can be judged before it is run',
  );

  // But a gate still fires on an unmeasured route, because a gate is about the
  // world rather than about the rate.
  const shut = expect(null, route({ live: 'baro' }), { ...IDEAL, live: new Set() });
  assert.equal(shut.perHour, 0);
  assert.ok(shut.gatedBy);
}

/*
 * FACTORS COMPOSE AS A PRODUCT, and the failure this guards against is the one
 * that made a sum wrong: two independent things that each halve your yield have
 * to leave a quarter, not "minus two points and minus two points" - which is
 * the same as one thing costing four, and is not what happened to the player.
 */
function independentLossesMultiply(): void {
  const both = expect(rate({ perHour: 100 }), route({ liquidity: 'slow', squad: 'needs-squad' }), {
    ...IDEAL,
    solo: true,
  });
  assert.ok(both.perHour !== null);
  // 0.35 (slow) x 0.2 (solo on a squad route) = 0.07
  assert.equal(both.perHour, 7, 'a slow-selling squad route run alone keeps a fourteenth of its rate, not most of it');
  assert.equal(both.links.length, 2, 'and each cause is named separately in the working');

  const soloOnly = expect(rate({ perHour: 100 }), route({ squad: 'needs-squad' }), { ...IDEAL, solo: true });
  const slowOnly = expect(rate({ perHour: 100 }), route({ liquidity: 'slow' }), IDEAL);
  assert.ok(soloOnly.perHour !== null && slowOnly.perHour !== null);
  assert.ok(both.perHour < soloOnly.perHour && both.perHour < slowOnly.perHour, 'two problems are worse than either');
}

/* Each factor states a fraction, and a fraction that is not one must be named. */
function everyFactorSaysWhatItClaims(): void {
  assert.equal(liquidityFactor('fast').kind, 'notApplicable', 'selling instantly costs nothing and needs no line');
  assert.equal(soloFactor('solo', true).kind, 'notApplicable');
  assert.equal(soloFactor('needs-squad', false).kind, 'notApplicable', 'in a squad, a squad route is unremarkable');
  assert.equal(gearFactor(0, 'a starter build').kind, 'notApplicable');
  assert.equal(gearFactor(-3, 'a starter build').kind, 'notApplicable', 'over-geared is not a penalty');
  assert.equal(liveFactor(route({ live: 'baro' }), new Set(['baro'])).kind, 'notApplicable', 'an open window is silent');

  for (const f of [liquidityFactor('slow'), soloFactor('needs-squad', true), gearFactor(2, 'a specialised build')]) {
    assert.ok(f.kind === 'factor');
    assert.ok(f.value > 0 && f.value < 1, 'a factor is a fraction of the rate, never a score');
    assert.equal(f.link.unit, 'of the rate', 'and it says so in its unit, so a reader can tell it from platinum');
    assert.ok(f.link.note.length > 40, 'with a sentence a player could disagree with');
  }

  /*
   * A HARSHER BRACKET IS NEVER KINDER. The lookup is by integer distance and a
   * table written by hand can easily be non-monotonic without anybody noticing.
   */
  const shares = [1, 2, 3, 4].map((n) => {
    const f = gearFactor(n, 'a specialised build');
    assert.ok(f.kind === 'factor');
    return f.value;
  });
  for (let i = 1; i < shares.length; i++) {
    assert.ok(shares[i] <= shares[i - 1], `being ${String(i + 1)} brackets short must not be better than ${String(i)}`);
  }
}

const checks = [
  anIdealRouteKeepsItsWholeRate,
  aClosedGateCannotBeOutvoted,
  timeYouDoNotNeedIsNotACost,
  tradesAreCapacityNotPreference,
  anUnknownFactorBoundsRatherThanBlocks,
  aCeilingIsAWeakerClaimThanAReading,
  certaintyBeatsIgnorance,
  anUnrunRouteIsNotAWorthlessOne,
  independentLossesMultiply,
  everyFactorSaysWhatItClaims,
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
console.log(failed ? `\n${String(failed)} check(s) failed` : '\nthe expectation model holds, and no gate can be outvoted');
process.exitCode = failed ? 1 : 0;
