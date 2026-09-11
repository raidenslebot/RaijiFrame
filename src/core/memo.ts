/**
 * Remember the LAST result of one expensive derivation.
 *
 * WHY A CACHE OF EXACTLY ONE.
 *
 * The thing this exists for is the build plan: 300-620 ms of beam search,
 * measured on the real catalogue by `scripts/bench-plan.ts`. It was recomputed
 * on every `publishAutomod`, which fires on every mod placed, every screen
 * event and every inventory push while the modding screen is open - so the
 * controller stalled for half a second each time the player touched a card,
 * while the function's own comment said it ran "once per open".
 *
 * One entry, not an LRU, because the player mods one item at a time. A second
 * entry would only pay off when they alternate between two items within a
 * screen visit, and the cost of being wrong about that is one recompute.
 *
 * IDENTITY, NOT EQUALITY. Keys are compared with `Object.is` element by
 * element. That is what makes the account a usable key: `mergeInventory`
 * returns the SAME object when a push changed nothing, so a reference match is
 * a proof that every owned rank is unchanged - a claim no field-by-field
 * comparison could make as cheaply, and one that cannot drift as the account
 * shape grows.
 *
 * The corollary is the rule for callers: every value the result depends on has
 * to be in the key, and anything mutated in place can never be one.
 */
export interface MemoLast<V> {
  /** The cached value when `key` matches the last one, otherwise `produce()`. */
  get(key: readonly unknown[], produce: () => V): V;
  /** Answered from the cache. */
  readonly hits: number;
  /** Actually computed. Exposed so "is it memoised" is measurable, not assumed. */
  readonly misses: number;
}

export function memoLast<V>(): MemoLast<V> {
  let last: { key: readonly unknown[]; value: V } | null = null;
  let hits = 0;
  let misses = 0;
  return {
    get(key: readonly unknown[], produce: () => V): V {
      if (last !== null && last.key.length === key.length && last.key.every((k, i) => Object.is(k, key[i]))) {
        hits++;
        return last.value;
      }
      misses++;
      // Computed BEFORE the entry is replaced: a `produce` that throws must
      // leave the previous answer intact rather than poisoning the cache with
      // a half-built one.
      const value = produce();
      last = { key: [...key], value };
      return value;
    },
    get hits() {
      return hits;
    },
    get misses() {
      return misses;
    },
  };
}
