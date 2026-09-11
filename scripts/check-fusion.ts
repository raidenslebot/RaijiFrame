/**
 * The fusion cost curve, checked against prices the GAME quoted.
 *
 * `src/data/fusion.ts` tells a player whether they can afford to rank a mod. If
 * the curve is wrong, the app says "you can do this" to somebody who cannot, or
 * hides a step they could have taken - and neither failure ever produces an
 * error. Only a comparison against real prices catches it.
 *
 * The ten quotes below are verbatim from the player's own EE.log, written by
 * the fusion dialog. They are the reason this file exists rather than a check
 * against a published table: a wiki can be stale after a patch, whereas a price
 * the client printed cannot be.
 *
 * Run: node scripts/check-fusion.ts
 */
import assert from 'node:assert/strict';
import {
  CREDITS_PER_ENDO,
  afford,
  creditsForEndo,
  endoToRank,
  explainQuote,
  fusionRarity,
  purseOf,
  rankCost,
  RARITY_FACTOR,
} from '../src/data/fusion.ts';

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

/**
 * Every fusion quote in the player's EE.log, with the rank move each one is.
 *
 * The `move` column is DERIVED - `explainQuote` finds which (rarity, from, to)
 * produce that Endo - so it is not an input the check could be fitted to. Where
 * a quote is ambiguous (300 Endo is both a common 1 -> 5 and an uncommon 0 -> 4)
 * the ambiguity is asserted rather than resolved by picking a favourite.
 */
const QUOTES: ReadonlyArray<{ endo: number; credits: number }> = [
  { endo: 30, credits: 1_449 },
  { endo: 60, credits: 2_898 },
  { endo: 120, credits: 5_796 },
  { endo: 300, credits: 14_490 },
  { endo: 310, credits: 14_973 },
  { endo: 930, credits: 44_919 },
  { endo: 15_330, credits: 740_439 },
  { endo: 15_360, credits: 741_888 },
  { endo: 40_920, credits: 1_976_436 },
];

console.log('the prices the game itself quoted');

ok('every one of the 9 distinct quotes in the log is reproduced by the curve', () => {
  const unexplained = QUOTES.filter((q) => explainQuote(q.endo, q.credits).length === 0);
  assert.deepEqual(
    unexplained,
    [],
    `the curve cannot produce ${String(unexplained.length)} real price(s) the client printed: ${JSON.stringify(unexplained)}`,
  );
  assert.equal(QUOTES.length, 9);
});

ok('credits are exactly 48.3 x endo on every quote, with no remainder', () => {
  for (const q of QUOTES) {
    assert.equal(creditsForEndo(q.endo), q.credits, `${String(q.endo)} endo should quote ${String(q.credits)} credits`);
    // and the constant itself is what produces that, not a rounding coincidence
    assert.equal(q.endo * CREDITS_PER_ENDO, q.credits, `${String(q.endo)} x ${String(CREDITS_PER_ENDO)} is not ${String(q.credits)}`);
  }
  assert.equal(CREDITS_PER_ENDO, 48.3);
});

ok('a quote with the wrong credits is refused rather than explained by the endo alone', () => {
  // The pairing is part of the claim: 30 endo does not cost 1,450 credits.
  assert.deepEqual(explainQuote(30, 1_450), []);
  assert.equal(explainQuote(30, 1_449).length > 0, true);
});

ok('the two ambiguous quotes are reported as ambiguous, not silently resolved', () => {
  // 300 endo: common 1->5 (10 x 1 x 30) and uncommon 0->4 (10 x 2 x 15).
  const three = explainQuote(300, 14_490);
  assert.deepEqual(
    three.map((m) => `${m.rarity} ${String(m.from)}->${String(m.to)}`).sort(),
    ['common 1->5', 'uncommon 0->4'],
  );
  // 60 endo: common 0->? no; the pairs that work, pinned exactly.
  assert.deepEqual(
    explainQuote(60, 2_898)
      .map((m) => `${m.rarity} ${String(m.from)}->${String(m.to)}`)
      .sort(),
    ['common 1->3', 'rare 1->2', 'uncommon 0->2'],
  );
});

ok('the 0->9 and 9->10 quotes sum to the 0->10 total, so the curve telescopes', () => {
  // Observed: rare 0->9 is 15,330 and rare 9->10 is 15,360.
  assert.equal(endoToRank('rare', 0, 9), 15_330);
  assert.equal(endoToRank('rare', 9, 10), 15_360);
  assert.equal(endoToRank('rare', 0, 9) + endoToRank('rare', 9, 10), endoToRank('rare', 0, 10));
  // Which means ranking one step at a time costs what ranking in one go costs.
  let stepwise = 0;
  for (let r = 0; r < 10; r++) stepwise += endoToRank('legendary', r, r + 1);
  assert.equal(stepwise, endoToRank('legendary', 0, 10));
  assert.equal(stepwise, 40_920, 'the legendary 0->10 total the client quoted');
});

console.log('\nthe curve');

ok('the four cumulative 0->max totals are the published ones', () => {
  assert.equal(endoToRank('common', 0, 10), 10_230);
  assert.equal(endoToRank('uncommon', 0, 10), 20_460);
  assert.equal(endoToRank('rare', 0, 10), 30_690);
  assert.equal(endoToRank('legendary', 0, 10), 40_920);
  // and the factors are 1,2,3,4 - the totals are that ratio and nothing else
  assert.deepEqual(Object.values(RARITY_FACTOR), [1, 2, 3, 4]);
});

ok('a common mod ranked 0->5 costs 310, which is the quote and not 10 x 5 x anything', () => {
  assert.equal(endoToRank('common', 0, 5), 310);
  // The curve is exponential, not linear: five ranks is not five times one rank.
  assert.notEqual(endoToRank('common', 0, 5), 5 * endoToRank('common', 0, 1));
  assert.equal(endoToRank('common', 0, 1), 10);
});

ok('a move to a rank at or below the current one costs nothing', () => {
  assert.equal(endoToRank('rare', 5, 5), 0);
  assert.equal(endoToRank('rare', 7, 3), 0);
});

console.log('\nunknown stays unknown');

ok('an unrecognised rarity yields no cost rather than a guessed one', () => {
  assert.equal(fusionRarity('Riven'), null);
  assert.equal(fusionRarity(null), null);
  assert.equal(fusionRarity(undefined), null);
  assert.equal(rankCost(null, 0, 10), null);
  assert.equal(rankCost('nonsense', 0, 10), null);
  // and the four it does know
  for (const r of ['Common', 'UNCOMMON', 'rare', 'Legendary']) assert.notEqual(fusionRarity(r), null);
});

ok('an absent balance is unknown, never zero - the account is not reported broke', () => {
  assert.deepEqual(purseOf(null), { endo: null, credits: null });
  assert.deepEqual(purseOf({}), { endo: null, credits: null });
  assert.deepEqual(purseOf({ FusionPoints: 0, RegularCredits: 0 }), { endo: 0, credits: 0 });
  const cost = rankCost('rare', 0, 10);
  assert.equal(afford(cost, purseOf(null)), 'unknown');
  assert.equal(afford(cost, purseOf({ FusionPoints: 5 })), 'unknown', 'one balance present is still unknown');
  // a real zero, however, IS an answer
  assert.equal(afford(cost, purseOf({ FusionPoints: 0, RegularCredits: 0 })), 'both');
});

ok('affordability names WHICH resource is short, because they are farmed differently', () => {
  const cost = rankCost('rare', 0, 10);
  assert.deepEqual(cost, { endo: 30_690, credits: 1_482_327, verdict: 'exact' });
  assert.equal(afford(cost, { endo: 40_000, credits: 2_000_000 }), 'yes');
  assert.equal(afford(cost, { endo: 100, credits: 2_000_000 }), 'endo');
  assert.equal(afford(cost, { endo: 40_000, credits: 100 }), 'credits');
  assert.equal(afford(cost, { endo: 100, credits: 100 }), 'both');
  // exactly enough is enough
  assert.equal(afford(cost, { endo: 30_690, credits: 1_482_327 }), 'yes');
  assert.equal(afford(cost, { endo: 30_689, credits: 1_482_327 }), 'endo');
});

ok('a free move is affordable on an empty purse, but only if the purse is KNOWN', () => {
  const free = rankCost('rare', 5, 5);
  assert.deepEqual(free, { endo: 0, credits: 0, verdict: 'exact' });
  assert.equal(afford(free, { endo: 0, credits: 0 }), 'yes');
  assert.equal(afford(free, purseOf(null)), 'unknown');
});

console.log(`\n${String(checks)} checks, ${String(failures)} failures`);
/*
 * `process.exitCode`, NOT `process.exit()`.
 *
 * With `process.exit()` this script aborted on a libuv assertion
 * (`!(handle->flags & UV_HANDLE_CLOSING)`, src/win/async.c) in 4 of 10 runs on
 * Node 24 for Windows - AFTER printing "12 checks, 0 failures", so the gate had
 * already passed and the chain still failed. Setting the code and letting Node
 * drain its handles removed it: 0 of 12. Why this file and not the other
 * forty-eight that call `process.exit()` is NOT understood, so this is a
 * measured fix rather than an explained one - do not restore `process.exit()`
 * here without re-running it a dozen times.
 */
process.exitCode = failures === 0 ? 0 : 1;
