import { useEffect, useState } from 'react';
import { loadPrevious } from '../core/snapshot';
import type { RawInventory } from '../core/gep';

/**
 * The account as it was the read BEFORE this one, or null.
 *
 * WHAT THIS IS FOR
 * ────────────────
 * `UI-SPEC.md:1308` asks for delta highlighting and rates it four stars on one
 * argument: *"The game cannot do this; it has no memory of your last login."*
 * An overlay does have that memory, so telling a player which figures moved
 * while they were away is a capability the game structurally cannot offer.
 *
 * NULL IS NOT ZERO HERE EITHER
 * ────────────────────────────
 * Three different things return null and the caller must not conflate them with
 * "nothing changed": the previous read is still loading, there has never been a
 * previous read (a first capture), or storage is unavailable. A figure with no
 * earlier reading is not a figure that held steady, and marking it as unchanged
 * would be a claim about a session that never happened. `Counter` takes
 * `was={null}` to mean exactly that and draws no mark.
 *
 * ONE READ, AT MOUNT
 * ──────────────────
 * The previous generation moves only at the start of a session - app launch,
 * or the game coming up - and never on a push, which is what `core/snapshot.ts`
 * holds it still for. A reader that mounted before a game launch keeps showing
 * the generation it read, which is the one the player was already looking at;
 * re-reading would swap the comparison out from under them mid-glance. So this
 * reads once and never polls, which also keeps it inside the app's rule about
 * being gentle with the things it reads.
 */
export function usePreviousAccount(): RawInventory | null {
  const [prev, setPrev] = useState<RawInventory | null>(null);

  useEffect(() => {
    let alive = true;
    void loadPrevious().then((snap) => {
      if (alive) setPrev((snap?.account ?? null) as unknown as RawInventory | null);
    });
    return () => {
      alive = false;
    };
  }, []);

  return prev;
}

/**
 * Count distinct `ItemType`s across some inventory arrays, or null.
 *
 * Null when the account is absent or carries none of the named arrays — the
 * same three-state reading the rest of this app uses, so a caller can pass the
 * result straight to `Counter`'s `was` and get no mark rather than a false one.
 */
export function countTypes(inv: RawInventory | null, keys: readonly string[]): number | null {
  if (inv === null) return null;
  const seen = new Set<string>();
  let sawAny = false;
  for (const key of keys) {
    const arr = inv[key];
    if (!Array.isArray(arr)) continue;
    sawAny = true;
    for (const row of arr) {
      const t = (row as { ItemType?: unknown } | null)?.ItemType;
      if (typeof t === 'string') seen.add(t);
    }
  }
  return sawAny ? seen.size : null;
}
