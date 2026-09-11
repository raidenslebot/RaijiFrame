/**
 * A PLAYER'S OWN ORDER, LAID OVER AN ORDER THAT KEEPS CHANGING.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Dragging a card in the platinum deck used to DELETE it: any horizontal pull
 * past a threshold called `onMark(ref, 'done' | 'skipped')` and the card left
 * the screen. Moving a thing and destroying it were the same gesture, which is
 * the wrong way round - a drag is the most exploratory input there is, and it
 * was wired to the most destructive outcome.
 *
 * A drag should MOVE. That needs somewhere for the moved thing to go, which is
 * this: an ordering the player owns, laid over the ranking the app computes.
 *
 * THE HARD PART IS THAT THE UNDERLYING ORDER MOVES ON ITS OWN
 * ──────────────────────────────────────────────────────────
 * The deck re-ranks constantly: a price lands, a route's rate is measured, a
 * card is dealt with. So a stored list of keys is stale the moment it is
 * written, and the two naive implementations are both wrong:
 *
 *   - Store positions. A new item appears, every position after it is off by
 *     one, and the player's arrangement quietly scrambles.
 *   - Store the whole order and use it verbatim. Anything the app newly
 *     computes is missing from the stored list and vanishes from the screen -
 *     which is the deletion bug again, by a different route.
 *
 * So the stored order is a PREFERENCE, not a layout. Keys still present keep
 * the player's relative order; keys the player never touched keep the app's;
 * and a key that appears later is inserted where the app would have put it,
 * never dropped. The invariant that matters: `arrange` returns exactly the
 * items it was given, always. It can reorder and it can never lose one.
 */

/** The stored preference: keys in the order the player put them. */
export type Order = readonly string[];

/**
 * Apply a stored order to the current items.
 *
 * Items whose key appears in `order` come first, in that order. Everything
 * else follows in its natural order. Both halves are stable, so an item nobody
 * has touched never moves because of something that happened elsewhere.
 */
export function arrange<T>(items: readonly T[], keyOf: (item: T) => string, order: Order): T[] {
  if (order.length === 0) return [...items];

  const rank = new Map<string, number>();
  for (const [i, k] of order.entries()) rank.set(k, i);

  const pinned: T[] = [];
  const rest: T[] = [];
  for (const item of items) (rank.has(keyOf(item)) ? pinned : rest).push(item);

  pinned.sort((a, b) => (rank.get(keyOf(a)) ?? 0) - (rank.get(keyOf(b)) ?? 0));
  return [...pinned, ...rest];
}

/**
 * Move one key by `delta` places within the CURRENT arrangement.
 *
 * Returns the new stored order. It writes out the whole visible order rather
 * than only the moved key, because the player's intent is "this one goes after
 * that one" and that is a statement about neighbours - recording the mover
 * alone would let the next re-rank slide its neighbours out from under it.
 *
 * Out-of-range moves clamp rather than wrap. Wrapping is right for cycling
 * through a stack, where the set is small and the ends meet; it is wrong for
 * an arrangement, where dragging the top item up should do nothing rather than
 * teleport it to the bottom.
 */
export function move(visible: readonly string[], key: string, delta: number): Order {
  const from = visible.indexOf(key);
  if (from === -1 || delta === 0) return [...visible];
  const to = Math.max(0, Math.min(visible.length - 1, from + delta));
  if (to === from) return [...visible];
  const next = [...visible];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...visible];
  next.splice(to, 0, moved);
  return next;
}

/**
 * Drop `key` at the position of `beforeKey`, for a pointer drag.
 *
 * Separate from `move` because a drag knows a TARGET, not a distance, and
 * converting one to the other in the caller is where off-by-one bugs live.
 * `beforeKey` null means the end of the list.
 */
export function moveTo(visible: readonly string[], key: string, beforeKey: string | null): Order {
  const from = visible.indexOf(key);
  if (from === -1) return [...visible];
  /*
   * DROPPING A THING ON ITSELF IS A NO-OP, AND IT TOOK A TEST TO SAY SO.
   *
   * Without this the key is spliced out, and the lookup for its own target
   * then misses - because the thing being looked for is the thing just
   * removed - so it fell through to the end-of-list branch. Picking a card up
   * and putting it back exactly where it came from sent it to the bottom,
   * which is the same class of defect as a drag that deletes: a gesture that
   * should have changed nothing changed something.
   */
  if (beforeKey === key) return [...visible];
  const next = [...visible];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...visible];
  const at = beforeKey === null ? next.length : next.indexOf(beforeKey);
  next.splice(at === -1 ? next.length : at, 0, moved);
  return next;
}

/**
 * Forget keys that are no longer anywhere, so the preference cannot grow
 * without bound across sessions.
 *
 * Deliberately NOT called on every render: an item can disappear for a moment
 * while a re-price is in flight, and pruning it then would lose an arrangement
 * the player made. This is for a session boundary, where absence is settled.
 */
export function prune(order: Order, alive: Iterable<string>): Order {
  const live = new Set(alive);
  return order.filter((k) => live.has(k));
}
