/**
 * A player's order, and the one thing it must never do.
 *
 * WHY THIS IS A GATE
 * ──────────────────
 * This module exists because dragging a card used to DELETE it. The fix is to
 * make a drag move things instead, which means laying a stored order over a
 * ranking that changes underneath it - and the obvious implementations of that
 * lose items, which would be the same deletion bug wearing a different hat:
 *
 *   - use the stored order verbatim, and anything newly computed is absent
 *     from the list and vanishes from the screen;
 *   - store positions, and one insertion scrambles every arrangement after it.
 *
 * So the invariant asserted hardest below is not about ordering at all. It is
 * that `arrange` returns EXACTLY the items it was handed - same count, same
 * membership - for every stored order, including stale, corrupt and hostile
 * ones. It may reorder. It may never lose one.
 *
 * Run: node scripts/check-ordering.ts
 */

import assert from 'node:assert/strict';
import { arrange, move, moveTo, prune } from '../src/ui/ordering.ts';

const id = (s: string): string => s;
const keys = (xs: readonly string[]): string[] => [...xs];

/* ------------------------------------- 1. it never loses or invents an item */

{
  const items = ['a', 'b', 'c', 'd', 'e'];
  const orders: string[][] = [
    [],
    ['a'],
    ['e', 'd', 'c', 'b', 'a'],
    ['c', 'a'],
    // stale: names things that are gone
    ['zzz', 'yyy', 'c'],
    // corrupt: duplicates
    ['a', 'a', 'b', 'a'],
    // hostile: every key twice, in the wrong order, plus junk
    ['e', 'e', 'x', 'd', 'd', 'a', 'a', 'b', 'b', 'c', 'c', ''],
  ];
  for (const order of orders) {
    const out = arrange(items, id, order);
    assert.equal(out.length, items.length, `count preserved for ${JSON.stringify(order)}`);
    assert.deepEqual(
      [...out].sort(),
      [...items].sort(),
      `membership preserved for ${JSON.stringify(order)} - NOTHING may be lost`,
    );
  }
}

/* ------------------------------------- 2. a new item appears, it is not lost */

{
  // The player arranged three; the app then computes a fourth.
  const order = ['c', 'a', 'b'];
  const out = arrange(['a', 'b', 'c', 'NEW'], id, order);
  assert.equal(out.length, 4, 'the new item survives');
  assert.deepEqual(keys(out).slice(0, 3), ['c', 'a', 'b'], 'and the arrangement is untouched');
  assert.equal(out[3], 'NEW', 'an untouched item follows the arranged ones, in natural order');
}

/* ------------------------------- 3. an item nobody touched does not drift */

{
  const order = ['d'];
  const out = arrange(['a', 'b', 'c', 'd'], id, order);
  assert.deepEqual(out, ['d', 'a', 'b', 'c'], 'only the moved one moves; the rest keep their relative order');
}

/* ---------------------------------------------------- 4. moving, and clamps */

{
  const v = ['a', 'b', 'c', 'd'];
  assert.deepEqual(move(v, 'a', 1), ['b', 'a', 'c', 'd'], 'one place later');
  assert.deepEqual(move(v, 'd', -1), ['a', 'b', 'd', 'c'], 'one place earlier');
  assert.deepEqual(move(v, 'a', -1), ['a', 'b', 'c', 'd'], 'the top item clamps rather than wrapping to the bottom');
  assert.deepEqual(move(v, 'd', 99), ['a', 'b', 'c', 'd'], 'and the bottom clamps rather than wrapping');
  assert.deepEqual(move(v, 'missing', 1), ['a', 'b', 'c', 'd'], 'a key that is not there changes nothing');
  assert.deepEqual(move(v, 'b', 0), ['a', 'b', 'c', 'd'], 'a zero move is a no-op, not a rewrite');
  for (const k of v) {
    for (const d of [-3, -1, 1, 3]) {
      assert.deepEqual([...move(v, k, d)].sort(), [...v].sort(), 'a move never loses a key');
    }
  }
}

/* ------------------------------------------------------ 5. dropping on a target */

{
  const v = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveTo(v, 'd', 'b'), ['a', 'd', 'b', 'c'], 'dropped before b');
  assert.deepEqual(moveTo(v, 'a', null), ['b', 'c', 'd', 'a'], 'null target means the end');
  assert.deepEqual(moveTo(v, 'a', 'a'), ['a', 'b', 'c', 'd'], 'dropping a thing on itself is a no-op');
  assert.deepEqual(moveTo(v, 'a', 'nope'), ['b', 'c', 'd', 'a'], 'an unknown target falls to the end rather than dropping the key');
  for (const k of v) {
    for (const t of [...v, null]) {
      assert.deepEqual([...moveTo(v, k, t)].sort(), [...v].sort(), 'a drop never loses a key');
    }
  }
}

/* ------------------------------------------------------------- 6. pruning */

{
  assert.deepEqual(prune(['a', 'b', 'c'], ['a', 'c']), ['a', 'c'], 'forgets what is gone');
  assert.deepEqual(prune(['a', 'b'], []), [], 'and copes with everything being gone');
  assert.deepEqual(prune([], ['a']), [], 'and with nothing stored');
}

/* --------------------------------- 7. arrange is stable under repetition */

{
  const items = ['a', 'b', 'c', 'd'];
  const order = ['c', 'a'];
  const once = arrange(items, id, order);
  const twice = arrange(once, id, order);
  assert.deepEqual(twice, once, 'applying the same order twice changes nothing');
}

console.log('  ok    arrange returns exactly what it was given, for stale, duplicate and hostile orders');
console.log('  ok    an item the app newly computes is placed, never dropped');
console.log('  ok    an item nobody moved keeps its relative position');
console.log('  ok    moves clamp at the ends rather than wrapping, and never lose a key');
console.log('  ok    a drop on a missing target falls to the end rather than deleting');
console.log('\nmoving something never destroys it\n');
