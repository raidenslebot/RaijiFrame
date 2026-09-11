/**
 * The Forma count must be exact, minimal, and never invented.
 *
 * A Forma costs a build slot for 24 hours and a slot in the player's evening.
 * Telling somebody they need three when they need one is a real cost, and
 * telling them they need none when the build cannot fit is worse - they will
 * try it and it will not go on.
 *
 * WHAT IS ASSERTED, and why each one can actually fail:
 *   - the deficit is the count: no arrangement needs fewer
 *   - universals are spent AFTER exact matches, or a wasted universal invents a
 *     Forma that is not needed
 *   - a universal will not take Umbra, which is the game's own rule
 *   - an unpolarised mod is happy anywhere and demands nothing
 *   - what is left over is reported as spare rather than swallowed
 *
 * Run: node scripts/check-forma.ts
 */
import assert from 'node:assert/strict';
import { formaPlan, formaText } from '../src/data/forma.ts';
import type { Polarity } from '../src/data/modded.ts';

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
const P = (...p: Polarity[]) => p;

console.log('how many forma, and to what');

ok('a grid that already supplies every polarity needs none', () => {
  const plan = formaPlan(P('madurai', 'naramon'), P('madurai', 'naramon', 'none'));
  assert.equal(plan.count, 0);
  assert.deepEqual(plan.to, []);
  assert.equal(plan.alreadyMatched, 2);
  assert.equal(formaText(plan), '', 'a build that fits must say nothing at all');
});

ok('the deficit is the count, and it is per polarity not per mod', () => {
  // Three Madurai mods, one Madurai slot: two Forma, both to Madurai.
  const plan = formaPlan(P('madurai', 'madurai', 'madurai'), P('madurai', 'none', 'none'));
  assert.equal(plan.count, 2);
  assert.deepEqual(plan.to, [{ polarity: 'madurai', count: 2 }]);
  assert.equal(plan.alreadyMatched, 1);
  assert.match(formaText(plan), /2 forma/);
  assert.match(formaText(plan), /2 madurai/);
});

ok('a universal covers anything except Umbra - the game own rule', () => {
  assert.equal(formaPlan(P('naramon'), P('universal')).count, 0);
  assert.equal(formaPlan(P('vazarin'), P('universal')).count, 0);
  // Umbra is the exception, and it is the whole reason `slotDrain` special-cases it.
  const umbral = formaPlan(P('umbra'), P('universal'));
  assert.equal(umbral.count, 1);
  assert.deepEqual(umbral.to, [{ polarity: 'umbra', count: 1 }]);
});

ok('universals are spent AFTER exact matches, or they invent a forma', () => {
  /*
   * One Madurai mod and one Naramon mod; the grid has a Madurai slot and a
   * universal. Spending the universal on the Madurai mod first would leave the
   * Naramon mod facing an exact Madurai slot and report one Forma. Nothing is
   * needed here at all.
   */
  const plan = formaPlan(P('madurai', 'naramon'), P('madurai', 'universal'));
  assert.equal(plan.count, 0, 'a universal was spent where an exact slot already fitted');
  assert.equal(plan.alreadyMatched, 2);
});

ok('a scarce universal goes where it removes the most', () => {
  // Two Madurai and one Naramon wanted; one universal only.
  const plan = formaPlan(P('madurai', 'madurai', 'naramon'), P('universal'));
  assert.equal(plan.count, 2, 'one universal covers one mod, whichever it is');
  // It goes to the larger deficit, so Madurai is left needing one and Naramon one.
  assert.deepEqual(
    plan.to.map((t) => `${t.polarity}:${String(t.count)}`).sort(),
    ['madurai:1', 'naramon:1'],
  );
});

ok('an unpolarised mod demands nothing', () => {
  const plan = formaPlan(P('none', 'none', 'madurai'), P('none', 'none', 'none'));
  assert.equal(plan.count, 1, 'only the polarised mod can want anything');
  assert.deepEqual(plan.to, [{ polarity: 'madurai', count: 1 }]);
});

ok('what is left over is reported as spare, not swallowed', () => {
  // Eight slots, two of them wanted: six spare for whatever comes later.
  const plan = formaPlan(P('madurai', 'naramon'), P('madurai', 'naramon', 'none', 'none', 'none', 'none', 'universal', 'universal'));
  assert.equal(plan.count, 0);
  assert.equal(plan.spare, 6, 'four unpolarised and two unspent universals');
});

ok('the empty cases do not throw or invent', () => {
  assert.deepEqual(formaPlan([], []), { count: 0, to: [], alreadyMatched: 0, spare: 0 });
  assert.equal(formaPlan(P('madurai'), []).count, 1, 'no grid at all still needs the forma');
  assert.equal(formaPlan([], P('madurai', 'none')).spare, 1, 'a polarised slot nobody wants is not spare');
});

ok('the wording is the count and the polarities, and nothing else', () => {
  const plan = formaPlan(P('madurai', 'madurai', 'naramon'), P('none'));
  assert.equal(plan.count, 3);
  /*
   * BOTH READINGS, because the wording was wrong in one of them on the player's
   * own screen: "5 forma · 2 madurai, 2 naramon, umbra", where the bare word
   * reads as a number that went missing rather than as one of a kind.
   */
  assert.equal(formaText(plan), '3 forma · 2 madurai, 1 naramon');
  // Alone, a "1" beside the polarity would read as a mod name ("1 Madurai"), so it goes.
  assert.equal(formaText(formaPlan(P('naramon'), [])), '1 forma · naramon');
  // Two different polarities, one each: still no counts, because none of them is counted.
  assert.equal(formaText(formaPlan(P('naramon', 'madurai'), [])), '2 forma · madurai, naramon');
});

console.log(`\n${String(checks)} checks, ${String(failures)} failures`);
// `process.exitCode`, not `process.exit()` - see the note in check-fusion.ts.
process.exitCode = failures === 0 ? 0 : 1;
