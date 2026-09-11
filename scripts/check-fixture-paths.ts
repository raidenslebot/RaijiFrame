/**
 * A fixture must not invent an item path.
 *
 * WHY THIS EXISTS
 * ────────────────────────
 * Two of the worst bugs in this project were each concealed by a green test,
 * in the same way: the fixture invented the path the implementation expected,
 * so code and check were wrong together and agreed with each other.
 *
 *   `ownsFrame` looked for `/powersuits/<display name>/`, and the fixture said
 *   `/Lotus/Powersuits/Nekros/Nekros`. Nekros is really `/Powersuits/Necro/
 *   Necro`, so the function returned false for every account in the world while
 *   its test passed.
 *
 *   The Mote Amp exclusion matched `/MoteAmp/`, and the fixture said
 *   `/Lotus/Weapons/Operator/Pistols/MoteAmp/MoteAmpPistol`. The real components
 *   are under `SentTrainingAmplifier`, so the guard never fired once, and its
 *   test passed too.
 *
 * Neither bug was findable by reading the test - the test looked right. They
 * were findable only by asking whether the DATA was real.
 *
 * SCOPE, AND WHY IT IS NARROW
 * ────────────────────────
 * Only `/Lotus/Powersuits/` and `/OperatorAmplifiers/` - the two families where
 * the implementation reads MEANING out of the path's structure, and the two
 * where it has already been wrong. See the note on `CHECKED` for why the wider
 * version was rejected.
 *
 * Fixtures elsewhere use deliberate placeholders (`/Lotus/Nope`, `Q1`,
 * `TestPlatinum`) whose whole purpose is to be unrecognised, and a check that
 * forced those to be real would be deleted within a week.
 *
 * OFFLINE IS A SKIP, like the other live gates.
 *
 * Run: node scripts/check-fixture-paths.ts
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const WFCD = 'https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/';

/**
 * The two families where a path can look right and be WRONG.
 *
 * `/Lotus/Powersuits/` because 52 of the 128 frames sit under an internal
 * codename, and `/OperatorAmplifiers/` because the starter Amp's components do
 * too. Those are not guesses about where trouble might be - they are the two
 * places it has already been, and in both the implementation read MEANING out
 * of the path's internal structure.
 *
 * A first version of this check covered all of `/Lotus/Weapons/` and found
 * fifteen more fabrications - `BratonRifle` written as `Braton`, and so on.
 * Every one was an opaque identifier: the test used it as "some weapon" and
 * asserted something else entirely, so making them real would have been fifteen
 * edits that improved nothing. A check that demands busywork gets deleted, and
 * then it is not there for the case that matters.
 */
const CHECKED = /^\/Lotus\/Powersuits\/[^/]+\/.+|\/OperatorAmplifiers\//i;

/**
 * Paths that are deliberately not real, with the reason.
 *
 * Each entry is a claim that the fixture MEANS to be unrecognised. Anything
 * else in the checked families must resolve.
 */
const DELIBERATE: Readonly<Record<string, string>> = {
  '/lotus/powersuits/excalibur/exaltedblade': 'an exalted weapon, tested as a thing that is not a frame',
};

function fixturePaths(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of readdirSync(here).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join(here, file), 'utf8');
    for (const m of src.matchAll(/'(\/Lotus\/[^']+)'/g)) {
      const path = m[1];
      if (path === undefined || !CHECKED.test(path)) continue;
      const seen = found.get(path) ?? [];
      if (!seen.includes(file)) seen.push(file);
      found.set(path, seen);
    }
  }
  return found;
}

async function main(): Promise<void> {
  const paths = fixturePaths();
  if (paths.size === 0) {
    console.log('  ok    no fixture names a frame or weapon path');
    return;
  }

  let known: Set<string>;
  try {
    const files = [
      'Warframes.json',
      'Primary.json',
      'Secondary.json',
      'Melee.json',
      'Misc.json',
      'Arch-Gun.json',
      'Arch-Melee.json',
      'SentinelWeapons.json',
      'Sentinels.json',
      /*
       * The vehicles and the beasts. Added when resolution grew past the four
       * arsenal slots: a check that names an Archwing or a Kavat is exactly the
       * kind that should be held to a real path, and without these files their
       * paths could not be looked up at all.
       */
      'Archwing.json',
      'Pets.json',
      /*
       * MODS TOO, and the omission was a real trap rather than an oversight.
       *
       * This gate treats any `/Lotus/Powersuits/<x>/<y>` literal as a WARFRAME
       * path and resolves it against the item exports. But Warframe augment
       * cards are MODS living under exactly that prefix - `/Lotus/Powersuits/
       * Berserker/GrappleAugmentCard` is a real row in Mods.json - so quoting
       * one in a check failed here with "is not a real item", which is the
       * opposite of true. The question this file means to ask is "does the game
       * actually have this thing", not "is it a frame", and the fix is to let
       * it see the rest of the game rather than to skip the paths it misreads.
       */
      'Mods.json',
    ];
    known = new Set<string>();
    for (const file of files) {
      const res = await fetch(`${WFCD}${file}`);
      if (!res.ok) throw new Error(`${file} responded ${String(res.status)}`);
      const body: unknown = await res.json();
      for (const row of Array.isArray(body) ? body : []) {
        const u = (row as { uniqueName?: unknown }).uniqueName;
        if (typeof u === 'string') known.add(u.toLowerCase());
      }
    }
    // A floor, not a precision claim: it exists to catch a fetch that returned
    // an empty array with a 200, which would make every path below resolve as
    // missing. Mods.json adds roughly 1,500 rows, so the floor moved with it.
    assert.ok(known.size > 3_500, `the exports returned only ${String(known.size)} items`);
  } catch (err) {
    console.log(`  SKIP  item exports unreachable (${err instanceof Error ? err.message : String(err)})`);
    console.log(`\n${String(paths.size)} fixture paths left unverified; run again with a connection`);
    return;
  }

  const bad: string[] = [];
  for (const [path, files] of paths) {
    const lower = path.toLowerCase();
    if (known.has(lower) || lower in DELIBERATE) continue;
    bad.push(`${path} (${files.join(', ')}) is not a real item, so any check using it proves nothing`);
  }

  // An excuse that stopped being needed is a stale excuse.
  for (const [path, why] of Object.entries(DELIBERATE)) {
    if (!paths.has(path) && ![...paths.keys()].some((p) => p.toLowerCase() === path)) {
      bad.push(`${path} is excused here ("${why}") but no fixture uses it any more`);
    }
  }

  for (const line of bad) console.log(`  FAIL  ${line}`);
  assert.deepEqual(bad, [], 'a fixture invents an item path, which is how two silent bugs stayed green');

  console.log(`  ok    all ${String(paths.size)} frame and weapon paths in fixtures are real items`);
  console.log('\nno check is passing against data that does not exist');
}

await main();
