/**
 * The arsenal strings this app matches on must be the ones DE uses.
 *
 * WHY THIS EXISTS
 * ────────────────────────
 * `betterWith` names six frames as free strings, and `ownsFrame` resolves each
 * one against the account. For a long time it did that by looking for
 * `/powersuits/<name>/` in the inventory path - which is wrong for 52 of the
 * 128 powersuits, because the folder is an internal codename. Three of the six
 * were among them: Hydroid is `/Pirate/`, Ivara is `/Ranger/`, Nekros is
 * `/Necro/`.
 *
 * So the app told every player - including those holding Nekros - that Nekros
 * would roughly double their drops. No error, no crash, just a confident wrong
 * answer on the one line the route exists to give.
 *
 * The lookup goes through the catalog now, which fixes the mechanism. This
 * checks the DATA: a name in `betterWith` that the catalog does not carry
 * resolves to nothing, and the advice silently reverts to "you do not own it"
 * for everybody. A typo, or a frame DE renames, brings the bug straight back.
 *
 * OFFLINE IS A SKIP, like the other live gates.
 *
 * Run: node scripts/check-frame-picks.ts
 */
import assert from 'node:assert/strict';
import { PLAT_ROUTES } from '../src/data/plat-routes.ts';
import { WEAPON_ARRAYS } from '../src/data/plat-steps.ts';

const WFCD_BASE = 'https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/';
const WFCD = `${WFCD_BASE}Warframes.json`;

/**
 * Every inventory array a tradeable variant can live in must be scanned.
 *
 * `resolveVariants` walks a fixed list of arrays. It held four - LongGuns,
 * Pistols, Melee, SpecialItems - and four variants live outside them: the
 * Prisma Burst Laser is a `SentinelWeapons`, the Imperator Vandal and Prisma
 * Dual Decurions are `SpaceGuns`, the Prisma Veritux is a `SpaceMelee`. None of
 * them was mis-read; none of them was read at all.
 *
 * DE's `productCategory` on each item IS the array name, so the catalog can be
 * asked directly which arrays matter. A variant in a category nobody scans is a
 * player being told they do not own something they own.
 */
async function checkWeaponArrays(): Promise<string[]> {
  const files = [
    'Primary.json',
    'Secondary.json',
    'Melee.json',
    'SentinelWeapons.json',
    'Arch-Gun.json',
    'Arch-Melee.json',
  ];
  const needed = new Map<string, string[]>();
  for (const file of files) {
    const res = await fetch(`${WFCD_BASE}${file}`);
    if (!res.ok) throw new Error(`${file} responded ${String(res.status)}`);
    const body: unknown = await res.json();
    for (const row of Array.isArray(body) ? body : []) {
      const r = row as { name?: unknown; productCategory?: unknown };
      if (typeof r.name !== 'string' || typeof r.productCategory !== 'string') continue;
      // The same word test the resolver uses, on the display name.
      const words = new Set(r.name.toLowerCase().split(/[^a-z]+/));
      if (!['vandal', 'wraith', 'prisma'].some((w) => words.has(w))) continue;
      const seen = needed.get(r.productCategory) ?? [];
      if (seen.length < 3) seen.push(r.name);
      needed.set(r.productCategory, seen);
    }
  }

  const scanned = new Set<string>(WEAPON_ARRAYS);
  const bad: string[] = [];
  for (const [category, examples] of needed) {
    if (!scanned.has(category)) {
      bad.push(`variants live in "${category}" (${examples.join(', ')}) and nothing scans it`);
    }
  }
  return bad;
}

async function main(): Promise<void> {
  const picks = new Map<string, string[]>();
  for (const route of PLAT_ROUTES) {
    for (const pick of route.betterWith ?? []) {
      const seen = picks.get(pick.name) ?? [];
      seen.push(route.id);
      picks.set(pick.name, seen);
    }
  }

  if (picks.size === 0) {
    console.log('  ok    no route recommends a frame, so there is nothing to resolve');
    return;
  }

  let names: Set<string>;
  try {
    const res = await fetch(WFCD);
    if (!res.ok) throw new Error(`the warframe export responded ${String(res.status)}`);
    const body: unknown = await res.json();
    assert.ok(Array.isArray(body), 'the warframe export was not an array');
    names = new Set(
      (body as Array<{ name?: unknown; uniqueName?: unknown }>)
        .filter((f) => typeof f.name === 'string' && typeof f.uniqueName === 'string')
        .filter((f) => (f.uniqueName as string).toLowerCase().startsWith('/lotus/powersuits/'))
        .map((f) => f.name as string),
    );
    assert.ok(names.size > 40, `the export returned only ${String(names.size)} warframes`);
  } catch (err) {
    console.log(`  SKIP  warframe export unreachable (${err instanceof Error ? err.message : String(err)})`);
    console.log(`\n${String(picks.size)} recommended frames left unverified; run again with a connection`);
    return;
  }

  const bad: string[] = [];
  for (const [name, routes] of picks) {
    if (!names.has(name)) {
      bad.push(
        `"${name}" (recommended by ${routes.join(', ')}) is not a warframe in the export, ` +
          'so every player will be told they do not own it',
      );
    }
  }

  for (const line of bad) console.log(`  FAIL  ${line}`);
  assert.deepEqual(bad, [], 'a recommended frame cannot be resolved, so the advice is wrong for everybody');

  console.log(`  ok    all ${String(picks.size)} recommended frames exist, so ownership can actually be checked`);

  const arrays = await checkWeaponArrays();
  for (const line of arrays) console.log(`  FAIL  ${line}`);
  assert.deepEqual(arrays, [], 'a tradeable variant lives in an array nothing looks at');
  console.log(`  ok    all ${String(WEAPON_ARRAYS.length)} scanned arrays cover every category a variant lives in`);

  console.log('\nevery arsenal string this app matches on is one DE uses');
}

await main();
