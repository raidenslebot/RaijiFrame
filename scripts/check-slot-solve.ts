/**
 * THE HALF OF THE GRID PROBLEM THAT IS ARITHMETIC.
 *
 * The overlay's slot layer was deleted because nothing the app reads is known
 * to be in the screen's order, and five probes confirmed the log carries no
 * grid index at all. That is one of two unknowns, and it swallowed the other:
 * nobody had tried to work out WHICH SLOT each mod occupies in the game's own
 * dump, because the screen question looked like the whole problem.
 *
 * It is not. A mod's adjusted drain is a known function of its base drain, its
 * polarity and the slot's - `slotDrain`, gated in `check-moddb` - so an
 * observed drain excludes every slot that could not have produced it. The dump
 * states the eleven polarities in index order and every mod with its adjusted
 * drain, which is exactly the two sides of that equation.
 *
 * What this settles: mod -> slot INDEX.
 * What it does not: whether index i is the i-th card on screen.
 *
 * The second needs one screenshot taken while a dump exists. This file is here
 * so that when it is taken, the arithmetic is already written and gated rather
 * than being invented in the same hour as the measurement.
 */
import assert from 'node:assert/strict';
import { pinnedFraction, slotsFor, solveSlots, type DumpedMod } from '../src/data/slot-solve.ts';
import { slotDrain, type Polarity } from '../src/data/modded.ts';

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

/** A mod as it would be dumped, with its adjusted drain COMPUTED by the real rule. */
const at = (mod: string, baseDrain: number, polarity: Polarity, slot: Polarity): DumpedMod => ({
  mod,
  baseDrain,
  polarity,
  drain: slotDrain(baseDrain, slot, polarity),
});

console.log('\nthe inverse of the drain rule');

ok('an observed drain excludes every slot that could not have produced it', () => {
  /*
   * The forward rule, from `modded.ts`: a matching slot halves rounded up, a
   * universal slot halves anything but umbra, a mismatch adds a quarter rounded
   * half-up, and an unpolarised slot leaves the drain alone. Every assertion
   * here runs it forward to build the fixture and backward to solve it, so the
   * two can never drift.
   */
  const grid: Polarity[] = ['madurai', 'naramon', 'none', 'vazarin'];
  // A madurai mod at base 10 costs 5 in its own slot, 10 in an unpolarised one,
  // and 13 in a mismatched one.
  assert.equal(slotDrain(10, 'madurai', 'madurai'), 5);
  assert.equal(slotDrain(10, 'none', 'madurai'), 10);
  assert.equal(slotDrain(10, 'naramon', 'madurai'), 13);

  assert.deepEqual(slotsFor(at('A', 10, 'madurai', 'madurai'), grid), [0], 'the halved drain does not pin the matching slot');
  assert.deepEqual(slotsFor(at('B', 10, 'madurai', 'none'), grid), [2], 'the unchanged drain does not pin the unpolarised slot');
  // A mismatch is ambiguous between the two slots that are neither its own nor bare.
  assert.deepEqual(slotsFor(at('C', 10, 'madurai', 'naramon'), grid), [1, 3], 'a mismatched drain should admit both wrong-polarity slots');
});

ok('two mods cannot share a slot, and propagating that pins more than lookup alone', () => {
  /*
   * THE CONSTRAINT THAT MAKES THIS MORE THAN ELEVEN INDEPENDENT LOOKUPS.
   *
   * Two madurai mods on a grid with one madurai slot and one bare slot: by
   * drain alone the halved one is pinned and the unchanged one is pinned, which
   * lookup gets right. Make it harder - a mismatched mod that could sit in
   * either of two wrong-polarity slots, one of which another mod has already
   * claimed - and only propagation gets it.
   */
  const grid: Polarity[] = ['madurai', 'naramon', 'vazarin'];
  const mods = [
    at('exact', 10, 'naramon', 'naramon'), // pinned to 1 by its halving
    at('wrong', 10, 'madurai', 'naramon'), // admits 1 and 2 by drain alone
  ];
  const before = slotsFor(mods[1]!, grid);
  assert.deepEqual(before, [1, 2], `the mismatched mod should start ambiguous, got ${JSON.stringify(before)}`);

  const solved = solveSlots(mods, grid);
  assert.equal(solved[0]!.slot, 1, 'the exact mod is not pinned');
  assert.equal(solved[1]!.slot, 2, 'propagation did not remove the slot the first mod claimed');
  assert.equal(pinnedFraction(solved), 1, 'a solvable build was not fully solved');
});

ok('what cannot be solved is REPORTED unsolved, never assigned to a free slot', () => {
  /*
   * THE RULE THIS WHOLE MODULE EXISTS TO OBEY. Three madurai mods of the same
   * base drain in three madurai slots are indistinguishable by arithmetic, and
   * the last version of the slot layer placed exactly this kind of thing by
   * coincidence - "a complete disaster visually", measured at 35 px of plate
   * across a 104 px card's name band.
   *
   * Every one of the three must come back with three candidates and no slot.
   */
  const grid: Polarity[] = ['madurai', 'madurai', 'madurai'];
  const mods = [at('x', 8, 'madurai', 'madurai'), at('y', 8, 'madurai', 'madurai'), at('z', 8, 'madurai', 'madurai')];
  const solved = solveSlots(mods, grid);
  for (const s of solved) {
    assert.equal(s.slot, null, `${s.mod} was placed on a grid that cannot distinguish it`);
    assert.deepEqual(s.candidates, [0, 1, 2], `${s.mod} lost a candidate it should still have`);
  }
  assert.equal(pinnedFraction(solved), 0);
});

ok('the all-universal dump the live log actually contains solves to nothing, and that is correct', () => {
  /*
   * THE ONE REAL DUMP ON THIS MACHINE, and it is the degenerate case: eleven
   * slots, ten of them AP_UNIVERSAL, two mods. A universal slot halves anything
   * that is not umbra, so both mods are halved in any of ten slots and the
   * arithmetic separates nothing.
   *
   * That is worth gating rather than glossing: it is exactly why this module
   * cannot be validated on the data in hand, and exactly what a mixed-polarity
   * dump would change. Nothing here pretends the one dump settled anything.
   */
  const slots: Polarity[] = ['universal', 'universal', 'universal', 'universal', 'universal', 'universal', 'universal', 'universal', 'vazarin', 'universal', 'universal'];
  const mods = [at('WeaponMeleeRangeIncMod', 14, 'none', 'universal'), at('WeaponMeleeDamageModExpert', 28, 'none', 'universal')];
  const solved = solveSlots(mods, slots);
  assert.equal(pinnedFraction(solved), 0, 'an all-universal grid is being claimed as solved');
  assert.ok(solved[0]!.candidates.length > 1, 'the degenerate case is reporting a single candidate');
});

ok('what the arithmetic can pin depends ENTIRELY on how diverse the grid is', () => {
  /*
   * THE RESULT I EXPECTED WAS WRONG, AND THE REAL ONE IS MORE USEFUL.
   *
   * This gate first asserted "a realistic mixed grid pins most of a build" and
   * measured 0 %. Two things defeat the arithmetic, and both are ordinary:
   *
   *   A REPEATED POLARITY. Two madurai slots are identical to the drain rule,
   *   so two madurai mods are interchangeable between them forever.
   *   A UNIVERSAL SLOT. It halves anything that is not umbra - exactly what a
   *   MATCHING slot does - so a halved drain cannot tell the two apart.
   *
   * Measured across grid shapes, with every mod in a slot of its own polarity
   * and base drains 4 to 14:
   *
   *   all distinct polarities, no universal   100 %
   *   all distinct plus one universal         100 %
   *   duplicated polarities (three pairs)       0 %
   *   all unpolarised                           0 %
   *   all universal                             0 %
   *   two pairs, one single, one bare          33 %
   *
   * So this is not a technique that half-works everywhere; it is total on a
   * diverse grid and worthless on a uniform one. That matters for the layer it
   * would feed: a player Formas to MATCH their mods, so an endgame grid tends
   * toward repeats and toward the bottom of that table. The slot layer could
   * come back for the top rows and must not for the rest - which is a bound
   * worth having, and is what "blocked" was hiding.
   */
  const shapes: Array<[string, Polarity[], number]> = [
    ['all distinct, no universal', ['madurai', 'naramon', 'vazarin', 'zenurik', 'unairu', 'penjaga'], 1],
    ['all distinct plus universal', ['madurai', 'naramon', 'vazarin', 'zenurik', 'unairu', 'universal'], 1],
    ['duplicated polarities', ['madurai', 'madurai', 'naramon', 'naramon', 'vazarin', 'vazarin'], 0],
    ['all unpolarised', ['none', 'none', 'none', 'none', 'none', 'none'], 0],
    ['all universal', ['universal', 'universal', 'universal', 'universal', 'universal', 'universal'], 0],
  ];
  const fallback: Polarity[] = ['madurai', 'naramon', 'vazarin', 'zenurik', 'unairu', 'penjaga'];
  for (const [label, grid, expected] of shapes) {
    const mods = grid.map((slot, i) => at(String.fromCharCode(97 + i), 4 + i * 2, slot === 'none' || slot === 'universal' ? fallback[i % fallback.length]! : slot, slot));
    const solved = solveSlots(mods, grid);
    assert.equal(pinnedFraction(solved), expected, `${label}: pinned ${(100 * pinnedFraction(solved)).toFixed(0)} % against the measured ${String(100 * expected)} %`);
    // Whatever it does pin, it pins correctly - that is the invariant that
    // survives every shape, and the one the deleted layer broke.
    for (const sol of solved) {
      if (sol.slot === null) continue;
      const m = mods.find((x) => x.mod === sol.mod)!;
      assert.equal(slotDrain(m.baseDrain, grid[sol.slot]!, m.polarity), m.drain, `${label}: ${sol.mod} pinned to a slot that cannot produce its drain`);
    }
  }

  /*
   * AND THE PARTIAL CASE, which is the one a real dump will look like: two
   * pairs, one single and one bare pins the single and the bare and nothing
   * else. A third of a build placed truthfully is a different proposition from
   * a whole build placed by coincidence.
   */
  const grid: Polarity[] = ['madurai', 'madurai', 'naramon', 'naramon', 'vazarin', 'none'];
  const mods = grid.map((slot, i) => at(String.fromCharCode(97 + i), 4 + i * 2, slot === 'none' ? 'zenurik' : slot, slot));
  const solved = solveSlots(mods, grid);
  assert.ok(Math.abs(pinnedFraction(solved) - 1 / 3) < 1e-9, `the partial grid pinned ${(100 * pinnedFraction(solved)).toFixed(0)} %, not a third`);
  assert.equal(solved[4]!.slot, 4, 'the lone vazarin slot is not pinned');
  assert.equal(solved[5]!.slot, 5, 'the bare slot is not pinned');
});

console.log('');
if (failures === 0) console.log(`the slot arithmetic holds  (${String(checks)} checks)`);
assert.equal(failures, 0, `${String(failures)} slot-solving rule(s) broken`);
