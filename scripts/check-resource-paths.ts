/**
 * Every inventory path a farming step counts must be a real WFCD item.
 *
 * WHY THIS IS NOT PARANOIA
 * ────────────────────────
 * These paths are what `resolveCurrency` looks for in the account's `MiscItems`
 * rows, and DE's internal names are frequently nothing like the display name.
 * Two of the seven prove it: a **Corrupted Holokey** is stored as `GranumBucks`,
 * and **Vitus Essence** is stored as `Elitium`. Either one guessed from its
 * name would have produced a lookup that finds nothing.
 *
 * And finding nothing does not throw. The count is nullable by design, so a
 * wrong path renders as "your account has not been read" - the honest-unknown
 * wording - on an account that was read perfectly. A correctness failure
 * wearing the costume of an honest unknown, which is the same shape as the
 * market-slug bug `check-slugs` exists to catch, one layer down.
 *
 * OFFLINE IS A SKIP
 * ─────────────────
 * Like `check-slugs`, an unreachable dataset reports SKIP and exits zero. The
 * check is real whenever there is a connection, which is every time it matters.
 *
 * Run: node scripts/check-resource-paths.ts
 */
import assert from 'node:assert/strict';
import { ARCANE_HELMET_PATHS, CURRENCY_PATHS } from '../src/data/plat-steps.ts';

const WFCD = 'https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/';

async function main(): Promise<void> {
  let known: Map<string, string>;
  try {
    const rows: unknown[] = [];
    for (const file of ['Resources.json', 'Misc.json', 'Skins.json']) {
      const res = await fetch(`${WFCD}${file}`);
      if (!res.ok) throw new Error(`${file} responded ${String(res.status)}`);
      const body: unknown = await res.json();
      if (Array.isArray(body)) rows.push(...body);
    }
    known = new Map(
      rows
        .map((r) => r as { uniqueName?: unknown; name?: unknown })
        .filter((r): r is { uniqueName: string; name: string } => typeof r.uniqueName === 'string' && typeof r.name === 'string')
        .map((r) => [r.uniqueName, r.name]),
    );
    assert.ok(known.size > 200, `the resource dataset returned only ${String(known.size)} rows`);
    // Skins.json is by far the largest of the three; a short read means a partial fetch.
    assert.ok(known.size > 5_000, `the datasets returned only ${String(known.size)} rows, so Skins.json did not land`);
  } catch (err) {
    console.log(`  SKIP  resource dataset unreachable (${err instanceof Error ? err.message : String(err)})`);
    console.log(
      `\n${String(CURRENCY_PATHS.length + ARCANE_HELMET_PATHS.length)} paths left unverified; run again with a connection`,
    );
    return;
  }

  const bad: string[] = [];
  for (const { key, path, name } of CURRENCY_PATHS) {
    const real = known.get(path);
    if (real === undefined) {
      bad.push(`${key}: ${path} is not an item in the dataset`);
      continue;
    }
    /*
     * The path must also mean what it says, because a path resolving to a
     * DIFFERENT item counts the wrong thing perfectly happily - worse than one
     * resolving to nothing, since it produces a confident number rather than an
     * honest blank.
     *
     * Matched on a shared significant word, not on the whole string. The first
     * version demanded equality and failed on three cosmetic differences:
     * upstream says "Orokin Ducats" where this app shows "Ducats", and
     * "Riven Sliver"/"Corrupted Holokey" are singular where a count reads
     * better plural. None of those is a wrong item, and a check that fires on
     * them teaches you to delete it rather than to trust it.
     *
     * A shared word still catches the failure that matters: `Elitium` resolving
     * to something other than Vitus Essence, or a path silently reassigned
     * upstream, shares no vocabulary with the name beside it.
     */
    const words = (t: string): Set<string> =>
      new Set(
        t
          .toLowerCase()
          .replace(/s\b/g, '')
          .split(/[^a-z]+/)
          .filter((w) => w.length > 2),
      );
    const mine = words(name);
    const theirs = words(real);
    if (![...mine].some((w) => theirs.has(w))) {
      bad.push(`${key}: ${path} is "${real}" upstream, which shares no word with "${name}"`);
    }
  }


  /*
   * THE 27 ARCANE HELMETS, WHICH NOTHING BUT THIS LIST IDENTIFIES.
   * ────────────────────────
   * Their paths do not carry the word "arcane" and they share the
   * `/Lotus/Upgrades/Skins/` prefix with 665 ordinary helmets, so there is no
   * pattern to fall back on: the suffix rule that looks obvious
   * (`...HelmetAlt`, `...AltHelmet`) was measured against this same export and
   * returns 84 rows, 57 of them modern store cosmetics.
   *
   * That makes the list the only thing standing between a player and being told
   * they own a valuable event item when they own a store skin - so every entry
   * is re-checked against the live export here. Case is normalised because the
   * resolver keys on a lowercased path.
   */
  const byLower = new Map([...known].map(([path, name]) => [path.toLowerCase(), name]));
  for (const { path, name } of ARCANE_HELMET_PATHS) {
    const real = byLower.get(path);
    if (real === undefined) {
      bad.push(`arcane helmet: ${path} is not in the dataset`);
      continue;
    }
    if (real.toLowerCase() !== name.toLowerCase()) {
      bad.push(`arcane helmet: ${path} is "${real}" upstream, not "${name}"`);
    }
    if (!/^arcane .*helmet$/i.test(real)) {
      // A path that stopped being an arcane helmet must not stay on the list.
      bad.push(`arcane helmet: ${path} is "${real}", which is not an arcane helmet at all`);
    }
  }

  /*
   * And the list must still be COMPLETE. A helmet added upstream that nobody
   * adds here fails silently in the direction this route cares about most -
   * the player holds one and is told they hold nothing.
   */
  const upstream = [...known.values()].filter((n) => /^arcane .*helmet$/i.test(n));
  if (upstream.length !== ARCANE_HELMET_PATHS.length) {
    bad.push(
      `arcane helmets: the export lists ${String(upstream.length)} but this app knows ${String(ARCANE_HELMET_PATHS.length)}`,
    );
  }

  for (const line of bad) console.log(`  FAIL  ${line}`);
  assert.deepEqual(bad, [], 'a step counts an inventory path that does not mean what it says');

  console.log(`  ok    all ${String(CURRENCY_PATHS.length)} resource paths resolve to the item they claim`);
  console.log(`  ok    all ${String(ARCANE_HELMET_PATHS.length)} arcane helmets resolve, and the list is complete`);
  console.log('\nevery resource a step counts is the one it names');
}

await main();
