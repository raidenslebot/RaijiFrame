/**
 * Preferences that survive a reload.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Every control in the platinum panel - session length, the four ranking
 * weights, the two power sliders, squad size, the liquidity floor, muted
 * families, the sort axis - was held in plain `useState`. All of it reset on
 * every reload. For a panel somebody opens beside a running game, most days,
 * that is not a small annoyance: it makes the customisation decorative, because
 * nobody re-tunes eight controls every session just to see the same list.
 *
 * WHY NOT JUST JSON.stringify
 * ───────────────────────────
 * Because the shapes here contain `Set` and `Map`, and JSON silently turns both
 * into `{}`. A naive round-trip does not fail loudly - it restores an empty
 * object, every muted family quietly comes back, and the reader is left to
 * wonder why their settings half-worked. So each caller supplies an explicit
 * encode/decode pair and owns its own shape.
 *
 * WHAT IT REFUSES TO DO
 * ─────────────────────
 * It never trusts what it reads. Storage can hold a value written by an older
 * version of this app with a different shape, or by a user editing devtools, or
 * nothing at all. Every decode is wrapped, and ANY failure falls back to the
 * default rather than propagating a half-parsed object into a ranking engine.
 * A lost preference is a small cost; a panel that throws on load is not.
 *
 * `localStorage` itself throws in a private window and when a browser is set to
 * block site data, so even the access is guarded. The overlay must open.
 */

import { useEffect, useRef, useState } from 'react';

const PREFIX = 'rf.pref.';

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    // Private windows and blocked site data throw on ACCESS, not on read.
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // Storage full, or blocked. A preference that cannot be saved is not worth
    // interrupting anybody over.
  }
}

/**
 * State that persists, with the shape conversion made explicit.
 *
 * `decode` receives whatever was parsed out of storage as `unknown` and must
 * return a complete value or throw. Throwing is the correct response to an
 * unrecognised shape: the wrapper turns it into "use the default".
 */
export function usePersisted<T>(
  key: string,
  fallback: T,
  encode: (value: T) => unknown,
  decode: (raw: unknown) => T,
): [T, (next: T | ((prev: T) => T)) => void] {
  /*
   * Read once, during the initialiser.
   *
   * Not in an effect: restoring in an effect means the first render uses the
   * default, so the panel visibly flashes an unfiltered list before settling -
   * and on a frozen document timeline that first paint can be the only one
   * anybody sees.
   */
  const [value, setValue] = useState<T>(() => {
    const raw = read(key);
    if (raw === null) return fallback;
    try {
      return decode(JSON.parse(raw));
    } catch {
      return fallback;
    }
  });

  /*
   * The write happens in an EFFECT, not in the setter and not in the updater.
   *
   * A state updater must be pure - React may call it twice under StrictMode and
   * concurrent rendering - so a storage write inside one is a real bug. Doing it
   * in the setter instead needs the previous value, which means reading a ref
   * during render, which is its own rule violation.
   *
   * Persisting is synchronisation with something outside React, which is
   * precisely what an effect is for. It writes once on mount with the value it
   * just read, which is a harmless no-op, and once per change after that.
   */
  /*
   * `encode` is held in a ref rather than watched.
   *
   * Every caller passes an inline arrow, so its identity changes on every
   * render - and with it in the dependency list this effect ran on every
   * render, doing a synchronous `JSON.stringify` and `localStorage.setItem`
   * each time. On the platinum panel, which re-renders as each price lands and
   * again on every hover, that was a storage write per frame for a value that
   * had not changed.
   *
   * The identity is meaningless here; the FUNCTION is the same function. What
   * this effect actually depends on is the key and the value.
   */
  const encodeRef = useRef(encode);
  useEffect(() => {
    encodeRef.current = encode;
  });

  useEffect(() => {
    try {
      write(key, JSON.stringify(encodeRef.current(value)));
    } catch {
      // An unserialisable value is a bug in the caller's `encode`, not a reason
      // to interrupt anybody.
    }
  }, [key, value]);

  return [value, setValue];
}

/* ------------------------------------------------------------- coercion */

/** A finite number within bounds, or the fallback. Never NaN, never Infinity. */
export function num(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

/** A boolean, or the fallback. `undefined` is not `false`. */
export function bool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

/** One of a known set of strings, or the fallback. */
export function oneOf<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** A set of strings from a stored array. Anything else becomes empty. */
export function strSet(raw: unknown): Set<string> {
  return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
}
