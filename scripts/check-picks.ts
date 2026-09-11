/**
 * The five kinds keep their runners-up.
 *
 * WHAT THIS GUARDS
 * ────────────────
 * Every slot in `plat-picks.ts` ranks a whole field and then hands back a lead
 * plus the alternates behind it. It used to hand back only the lead and throw
 * the rest away, and the failure that caused was not subtle: any late gate
 * failing on the single best candidate refused THE ENTIRE KIND, so a panel
 * holding a ranked list of forty priced parts could show one line of grey text
 * saying it had nothing to suggest.
 *
 * That regression is invisible to the type system and invisible to a rendered
 * screenshot of an account that happens to have a good lead. It needs an
 * assertion, so:
 *
 *   1. A kind with several viable candidates returns alternates, in order.
 *   2. A kind whose BEST candidate cannot be built still returns the next one,
 *      rather than refusing.
 *   3. A kind refuses only when every candidate failed, and says why.
 *   4. The stack is capped, so a large inventory cannot turn one card into a
 *      hundred.
 *   5. Parts spoken for by ANY visible completion - lead or alternate - are
 *      never also offered as a sale, because a part cannot be both sold and
 *      kept and the header would otherwise sum platinum collectable once.
 *
 * The inputs below are hand-built structures in the app's own types. They are
 * not game data and are not presented as any: nothing here is read by the app,
 * and no value invented here can reach a screen.
 *
 * Run: node scripts/check-picks.ts
 */

import assert from 'node:assert/strict';
import { bestPicks, allPicks, contention, picksOf, type Pick, type PickInputs, type Slot } from '../src/data/plat-picks.ts';
import type { Holding } from '../src/data/plat-value.ts';
import type { Price } from '../src/data/market.ts';

function price(slug: string, median: number): Price {
  // A fixed date, not a clock read: a fixture that changes between runs is not a fixture.
  return {
    slug, median, weighted: median, volume: 20, min: median - 2, max: median + 2, trend: median,
    at: '2026-01-01T00:00:00.000Z',
    // Three days of flat history: enough for anything that reads the series,
    // and fixed so the fixture never changes between runs.
    history: [
      { at: '2025-12-30T00:00:00.000Z', median, volume: 20 },
      { at: '2025-12-31T00:00:00.000Z', median, volume: 20 },
      { at: '2026-01-01T00:00:00.000Z', median, volume: 20 },
    ],
  };
}

function holding(slug: string, count: number, median: number): Holding {
  return {
    gameRef: `/Lotus/Test/${slug}`,
    name: slug.replace(/_/g, ' '),
    slug,
    count,
    price: price(slug, median),
    worth: count * median,
    ducats: 45,
    ducatWorth: count * 45,
  };
}

const EMPTY: PickInputs = {
  holdings: [],
  sets: [],
  routes: [],
  offerings: [],
  relics: [],
  book: new Map(),
  ducats: null,
  tradesLeft: 6,
  tradablePlat: 500,
  standingBy: new Map(),
  liveTiers: null,
  minutes: 60,
  // Null by default: an empty log has never timed a fissure and has never
  // watched this account earn standing, so neither conversion is available and
  // the deck must fall back to its reading order rather than to a guess.
  fissureMinutes: null,
  standingRate: null,
  pricing: false,
  pricingFailed: false,
};

/* ------------------------------------------------ 1. alternates, in order */

{
  const holdings = [
    holding('cheap_part', 1, 10),
    holding('best_part', 1, 90),
    holding('good_part', 1, 60),
    holding('fair_part', 1, 30),
    holding('okay_part', 1, 45),
    holding('last_part', 1, 5),
  ];
  const slots = bestPicks({ ...EMPTY, holdings });
  const sell = slots.find((s) => s.kind === 'sell');
  assert.ok(sell !== undefined && 'pick' in sell, 'the sell kind produced a pick');

  assert.equal(sell.pick.ref, 'sell:best_part', 'the lead is the best rate');
  assert.ok(sell.alternates.length > 0, 'the runners-up survive');

  const order = [sell.pick, ...sell.alternates].map((p) => p.ref);
  assert.deepEqual(
    order,
    ['sell:best_part', 'sell:good_part', 'sell:okay_part', 'sell:fair_part', 'sell:cheap_part'],
    'the stack is ordered by platinum per trade, best first',
  );

  /* 4. capped. Six viable holdings, five shown: a lead and four alternates. */
  assert.equal(sell.alternates.length, 4, 'the stack is capped at four alternates');
  assert.ok(!order.includes('sell:last_part'), 'the tail beyond the cap is not shown');
}

/* ------------------------------- 2. a bad lead does not refuse the kind */

{
  /*
   * `worth` null is exactly the shape a holding takes when its quote has not
   * landed. The old code picked one candidate and, on any such miss, refused.
   */
  const broken: Holding = { ...holding('unpriced', 1, 100), price: null, worth: null };
  const slots = bestPicks({ ...EMPTY, holdings: [broken, holding('real_part', 1, 40)] });
  const sell = slots.find((s) => s.kind === 'sell');
  assert.ok(sell !== undefined && 'pick' in sell, 'an unusable candidate does not refuse the kind');
  assert.equal(sell.pick.ref, 'sell:real_part', 'the usable candidate leads instead');
}

/* ----------------------------------- 3. refusal only when nothing survives */

{
  const slots = bestPicks(EMPTY);
  for (const slot of slots) {
    assert.ok('refusal' in slot, `${slot.kind} refuses on empty input`);
    assert.ok(slot.refusal.because.length > 0, `${slot.kind} says what is missing`);
    assert.ok(slot.refusal.settles.length > 0, `${slot.kind} says what would settle it`);
  }
  assert.equal(picksOf(slots).length, 0, 'no kind claims a pick it does not have');
  assert.equal(allPicks(slots).length, 0, 'and none hides one behind an alternate');
}

/* ------------------------------- 5. every visible completion speaks for its parts */

{
  const held = ['shared_part_a', 'shared_part_b'];
  const sets = [
    {
      setSlug: 'lead_set',
      name: 'Lead Set',
      parts: [...held, 'missing_one'],
      held: ['shared_part_a'],
      missing: ['missing_one'],
      costs: new Map([['missing_one', price('missing_one', 20)]]),
      setPrice: price('lead_set_set', 300),
      toBuy: 20,
      margin: 280,
      perTrade: 140,
      trades: 2,
    },
    {
      setSlug: 'alt_set',
      name: 'Alt Set',
      parts: [...held, 'missing_two'],
      held: ['shared_part_b'],
      missing: ['missing_two'],
      costs: new Map([['missing_two', price('missing_two', 20)]]),
      setPrice: price('alt_set_set', 200),
      toBuy: 20,
      margin: 180,
      perTrade: 90,
      trades: 2,
    },
  ] as unknown as PickInputs['sets'];

  const slots = bestPicks({
    ...EMPTY,
    sets,
    // Both parts are held and priced, so without the guard both are sellable.
    holdings: [holding('shared_part_a', 1, 99), holding('shared_part_b', 1, 98), holding('free_part', 1, 50)],
  });

  const complete = slots.find((s) => s.kind === 'complete');
  assert.ok(complete !== undefined && 'pick' in complete, 'the completion kind produced a pick');
  assert.ok(complete.alternates.length >= 1, 'the second-best set is kept as an alternate');

  const sell = slots.find((s) => s.kind === 'sell');
  assert.ok(sell !== undefined && 'pick' in sell, 'the sell kind still has something to offer');
  const offered = [sell.pick, ...sell.alternates].map((p) => p.ref);
  assert.ok(
    !offered.includes('sell:shared_part_a'),
    'a part the LEAD completion depends on is never also offered for sale',
  );
  assert.ok(
    !offered.includes('sell:shared_part_b'),
    'and neither is a part an ALTERNATE completion depends on',
  );
  assert.ok(offered.includes('sell:free_part'), 'a part no completion needs is still sellable');
}

/* ------------------------------------- 6. every ref on screen is unique */

{
  /*
   * A REF IS AN IDENTITY, AND TWO CARDS SHARING ONE IS NOT A COSMETIC BUG.
   *
   * The deck keys its React children by `ref` AND stores "dealt with" against
   * `ref`. Two cards carrying the same one therefore share a progress entry:
   * marking either as taken silently removes both, and the player loses a
   * suggestion they never acted on.
   *
   * The input lists are not guaranteed distinct - a route can appear twice
   * under one id, a syndicate offering can be reachable through more than one
   * rank row - and while a kind returned only its best candidate a duplicate
   * could never collide with anything. Keeping alternates put both copies on
   * screen at once and the console filled with duplicate-key errors.
   */
  const dup = holding('dup_part', 1, 50);
  const slots = bestPicks({
    ...EMPTY,
    // The same holding three times, exactly as a real feed can produce it.
    holdings: [dup, dup, dup, holding('other_part', 1, 40)],
  });

  const refs = allPicks(slots).map((p) => p.ref);
  assert.equal(new Set(refs).size, refs.length, 'no two picks anywhere share a ref');

  const sell = slots.find((s) => s.kind === 'sell');
  assert.ok(sell !== undefined && 'pick' in sell);
  const shown = [sell.pick, ...sell.alternates].map((p) => p.ref);
  assert.deepEqual(shown, ['sell:dup_part', 'sell:other_part'], 'the duplicate is collapsed, the distinct one kept');
}

/* ------------------------------- 7. what the cards take from each other */

{
  /*
   * THE FINDING NO SINGLE CARD CAN MAKE.
   *
   * Two cards, each wanting one trade, against an account with one trade left.
   * Each card checks itself and reports "you have enough" - correctly. Doing
   * both is impossible, and before `contention` nothing on the screen said so.
   */
  const trade = (n: number): Pick['needs'] => [
    { what: 'A trade', need: n, have: 1, unit: 'trades', met: true },
  ];
  const card = (kind: Pick['kind'], needs: Pick['needs']): Pick =>
    ({ kind, ref: `${kind}:x`, needs }) as unknown as Pick;

  const both = contention([card('sell', trade(1)), card('complete', trade(1))]);
  assert.equal(both.length, 1, 'one budget is over-committed');
  assert.equal(both[0]?.what, 'A trade');
  assert.equal(both[0]?.wanted, 2, 'the two cards want two between them');
  assert.equal(both[0]?.have, 1);
  assert.equal(both[0]?.claims.length, 2, 'and both claimants are named');

  /* One card alone can never contend with itself. */
  assert.deepEqual(contention([card('sell', trade(1))]), [], 'a single card is not a conflict');

  /*
   * NARROWER THAN "SHORT", exactly like the foundry's contested rule. A card
   * that does not fit ON ITS OWN already says so on its own face; repeating it
   * here would be noise, not a finding.
   */
  const soloShort: Pick['needs'] = [{ what: 'A trade', need: 5, have: 1, unit: 'trades', met: false }];
  assert.deepEqual(
    contention([card('sell', soloShort), card('complete', trade(1))]),
    [],
    'a card that does not fit alone is not reported as contention',
  );

  /* An unknown budget cannot be over-spent: nobody knows how big it is. */
  const unknown: Pick['needs'] = [{ what: 'A trade', need: 1, have: null, unit: 'trades', met: null }];
  assert.deepEqual(
    contention([card('sell', unknown), card('complete', unknown)]),
    [],
    'ABSENT IS NOT ZERO: an unread budget is never reported as over-committed',
  );

  /* Comfortable budgets stay silent. */
  const roomy: Pick['needs'] = [{ what: 'A trade', need: 1, have: 6, unit: 'trades', met: true }];
  assert.deepEqual(contention([card('sell', roomy), card('complete', roomy)]), [], 'no conflict, no line');
}

/* ------------------- 8. the conflict is RESOLVED, not merely reported */

{
  /*
   * A conflict named and left to the reader is the same failure as a ranked
   * list: the work moved rather than getting done. Where the claimants can be
   * compared in the budget's own units, the panel has to say which to do.
   */
  const valued = (kind: Pick['kind'], value: number, wants: number): Pick =>
    ({
      kind,
      ref: `${kind}:x`,
      value,
      needs: [{ what: 'A trade', need: wants, have: 2, unit: 'trades', met: true }],
    }) as unknown as Pick;

  // Both want 2 trades, only 2 are left. The completion pays far more.
  const [row] = contention([valued('sell', 30, 2), valued('complete', 300, 2)]);
  assert.ok(row !== undefined, 'the clash is found');
  assert.equal(row.first, 'complete', 'the higher return per trade is the one to do');
  assert.deepEqual(row.after, ['sell'], 'and the one that will not fit after it is named');

  // Reverse the values and the answer reverses. A recommendation that does not
  // move with the numbers is a hardcoded preference wearing a calculation.
  const [flipped] = contention([valued('sell', 300, 2), valued('complete', 30, 2)]);
  assert.equal(flipped?.first, 'sell', 'the order follows the value, not the kind');

  /*
   * THE REFUSAL, WHICH MATTERS AS MUCH AS THE ANSWER.
   *
   * A route's value is platinum an HOUR. Ranking it against a sale for a TRADE
   * budget needs an exchange rate between an hour and a trade, and this file
   * refuses to invent one. The clash is still reported; only the ordering is
   * withheld.
   */
  const [mixed] = contention([valued('sell', 30, 2), valued('run', 900, 2)]);
  assert.ok(mixed !== undefined, 'the clash is still reported');
  assert.equal(mixed.first, null, 'but no order is claimed across incomparable units');
  assert.deepEqual(mixed.after, [], 'and nothing is declared to not fit on the strength of a rate that does not exist');
}

/* --------------------------------------------------------------- summary */

{
  const slots = bestPicks({
    ...EMPTY,
    holdings: [holding('a', 1, 90), holding('b', 1, 80), holding('c', 1, 70)],
  });
  assert.equal(picksOf(slots).length, 1, 'picksOf still reports one lead per productive kind');
  assert.equal(allPicks(slots).length, 3, 'allPicks reports every suggestion the kinds produced');
}

console.log('  ok    a kind keeps its runners-up, in rank order');
console.log('  ok    an unusable best candidate no longer refuses the whole kind');
console.log('  ok    a refusal happens only when every candidate failed, and says why');
console.log('  ok    the stack is capped at five suggestions a kind');
console.log('  ok    no part is offered for sale while any visible completion needs it');
console.log('  ok    no two picks share a ref, so no two cards share a progress entry');
console.log('  ok    two cards that each fit alone are reported when they cannot both be done');
console.log('  ok    an unread budget is never reported as over-committed');
console.log('  ok    a contended budget says which to do first, and the order follows the value');
console.log('  ok    and refuses to order across units no exchange rate connects');
/*
 * A PROMISE ABOUT THE FUTURE IS A CLAIM LIKE ANY OTHER.
 * ————————————————————————————————————————————
 * While prices are in flight the refusals say "The quotes are arriving now;
 * this fills itself in". With the market unreachable that is false - nothing is
 * arriving and nothing will fill itself in - and the panel said it anyway,
 * because every pricing stage caught its own failure and told nobody.
 *
 * Measured by blocking every market request on a cleared cache: six failing
 * requests, and the screen still promising quotes. No fabricated zero appeared,
 * so the absent-is-not-zero discipline held; what broke was the tense.
 */
{
  const settlesOf = (inp: PickInputs): string[] =>
    bestPicks(inp).flatMap((s) => ('refusal' in s ? [s.refusal.settles] : []));

  const healthy = settlesOf({ ...EMPTY, pricing: true, pricingFailed: false });
  assert.ok(healthy.length > 0, 'an empty account should refuse every kind, so there is something to read');
  assert.ok(
    healthy.some((line) => /arriving now/.test(line)),
    `while pricing is healthy the refusals should still say the quotes are coming: ${healthy.join(' | ')}`,
  );

  /*
   * THE ORDER IS THE POINT. `pricing` goes false the moment the pass finishes,
   * so a failure only reported "while pricing" is reported never - the player
   * gets the ordinary fallback, which blames their account for an outage. Both
   * of these must name the outage, and the finished case is the one that was
   * broken.
   */
  const broken = settlesOf({ ...EMPTY, pricing: true, pricingFailed: true });
  const finished = settlesOf({ ...EMPTY, pricing: false, pricingFailed: true });
  assert.ok(
    finished.some((line) => /could not be reached/.test(line)),
    `a finished, failed pass must still name the outage: ${finished.join(' | ')}`,
  );
  /*
   * Only the PRICE-dependent fallbacks are forbidden here. A refusal like "you
   * are not one or two parts short of a set" is an account fact and has nothing
   * to do with the market - demanding every refusal mention the outage was the
   * first version of this check, and it failed on exactly that line.
   */
  const blamesThePlayer = [
    'check back after the market moves',
    'Rank up with a syndicate',
    'Open Relic value to price one in full',
  ];
  for (const line of finished) {
    for (const wrong of blamesThePlayer) {
      assert.ok(!line.includes(wrong), `blames the player for an outage: ${line}`);
    }
  }
  for (const line of broken) {
    assert.doesNotMatch(line, /arriving now|fills itself in/, `still promising quotes that are not coming: ${line}`);
  }
  assert.ok(
    broken.some((line) => /could not be reached/.test(line)),
    `a failed pricing pass should say so: ${broken.join(' | ')}`,
  );

  console.log('  ok    a failed pricing pass stops the panel promising quotes that are not coming');
}


/*
 * THREE OF THE FIVE KINDS ARE COMPARABLE, AND THE DECK USED TO RANK NONE.
 * ————————————————————————————————————————————
 * `bestPicks` refused to order its kinds on the grounds that no exchange rate
 * existed between a trade, an hour, a day's standing and a relic. That holds
 * for trades — a daily trade count is a quota and no amount of playing earns
 * another — and fails for the other three, all of which reduce to platinum per
 * hour from measurements the app already holds.
 *
 * What is defended here is the SHAPE of that claim, not any particular order:
 * a conversion that could not be measured must be absent rather than guessed,
 * and the two trade-bound kinds must stay out of the comparison entirely.
 */
{
  const rateOf = (slots: readonly Slot[], kind: string): number | null | undefined => {
    const slot = slots.find((x) => x.kind === kind);
    return slot && 'pick' in slot ? (slot.pick.perHour ?? null) : undefined;
  };

  // A route at 300p/hr, an offering worth 2p per thousand standing, and a relic
  // worth 30p a crack. With both conversions measured, all three carry a rate.
  const inp: PickInputs = {
    ...EMPTY,
    routes: [{ routeId: 'r', name: 'A route', perHour: 300, cap: null, where: null, minutesPerRun: 10, runsTimed: 9, hasWindow: false, liveNow: true }],
    fissureMinutes: 12,
    standingRate: { perHour: 20_000, runs: 14 },
  };

  const run = rateOf(bestPicks(inp), 'run');
  assert.equal(run, 300, 'the run kind is already in the comparable unit');

  /*
   * TRADES ARE STILL REFUSED, and that is the half of the old argument that was
   * right. A sale costs a trade and no hours; it can never be in competition
   * with an hour of play, so it must carry no rate at all.
   */
  const slots = bestPicks(inp);
  for (const kind of ['sell', 'complete']) {
    const r = rateOf(slots, kind);
    assert.ok(r === null || r === undefined, `${kind} spends trades and must carry no hourly rate, got ${String(r)}`);
  }

  /*
   * AND AN UNMEASURED CONVERSION IS ABSENT, NEVER ZERO. Without a standing rate
   * there is no hour to attach, and quoting 0p/hr would rank a real suggestion
   * below every other one on a number nobody measured.
   *
   * THE FIRST VERSION OF THIS CHECK PASSED WITH THE BUG IN. It accepted
   * `undefined` — meaning the kind produced no pick at all — as satisfying "no
   * rate", so an empty fixture satisfied it trivially and sabotaging the code
   * changed nothing. The kind has to actually MAKE a suggestion before its
   * absence of a rate says anything, so the offering below exists to force one.
   */
  const withOffering: PickInputs = {
    ...inp,
    standingBy: new Map([['ZarimanSyndicate', 50_000]]),
    offerings: [
      {
        syndicate: 'ZarimanSyndicate',
        itemType: '/Lotus/Test/Thing',
        standingCost: 25_000,
        creditsCost: 0,
        requiredLevel: 0,
        name: 'A thing',
        slug: 'a_thing',
        price: price('a_thing', 50),
        platPerK: 2,
        reachable: true,
      },
    ],
  };

  const measured = bestPicks(withOffering);
  assert.equal(rateOf(measured, 'standing'), 40, 'measured: 2p per thousand x 20,000 standing an hour = 40p an hour');

  const unmeasured = bestPicks({ ...withOffering, fissureMinutes: null, standingRate: null });
  assert.notEqual(
    rateOf(unmeasured, 'standing'),
    undefined,
    'the standing kind must still make its suggestion without a rate - otherwise this check proves nothing',
  );
  assert.equal(
    rateOf(unmeasured, 'standing'),
    null,
    'and with no measured standing rate it must carry NO hourly figure, not a zero',
  );

  /*
   * The two trade-bound kinds keep the front of the deck, so a reader still
   * meets them in the order the panel intends.
   */
  assert.deepEqual(
    bestPicks(inp).slice(0, 2).map((x) => x.kind),
    ['sell', 'complete'],
    'the trade-bound kinds are not shuffled into the ranked ones',
  );
}

console.log('  ok    the deck ranks what converts to an hour and refuses what does not');

console.log('\nthe five kinds hand down what they ranked\n');
