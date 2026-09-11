/**
 * The key-mod table must still describe the mods it names.
 *
 * WHY THIS IS NOT PARANOIA
 * ────────────────────────
 * `plat-mods.ts` hardcodes eleven mods with DE's full path and a maximum rank,
 * and its own header says the figures "were read from WFCD's mod export rather
 * than assumed, because a 'maxed' test against a wrong ceiling is worse than no
 * test". That was true when written and nothing has checked it since.
 *
 * Both fields fail silently and in the direction that hurts:
 *
 *   A WRONG PATH means `readiness()` finds nothing, so the app tells a player
 *   who has Serration that they lack it - and `plat-rank.ts` then downranks
 *   every route that wants it. The player sees a worse list and no error.
 *
 *   A WRONG CEILING means a rank-5 Vitality reads as maxed at a cap of 5 when
 *   the real cap is 10, so a half-ranked mod is reported as finished.
 *
 * The name check catches a swap. Serration and Hornet Strike share the leaf
 * `WeaponDamageAmountMod` and differ only in `/Rifle/` versus `/Pistol/` - two
 * paths that look interchangeable and are not. Verifying the path resolves to
 * the NAME beside it catches a swap that a path-exists check would wave through.
 *
 * The IDENTITY check catches the failure the first two cannot. Mods.json holds
 * THREE rows named "Serration": a Beginner one (the Flawed mod, fusionLimit 3),
 * an Intermediate one (5) and the real one (10). A table entry pointing at the
 * Beginner row with maxRank 3 is self-consistent - right name, right ceiling for
 * that row - and this gate passed it while a maxed real Serration read as
 * unowned. So each entry must be the UNTIERED row for its name (no
 * `/Beginner/`, `/Intermediate/` or `/Expert/` segment), at that row's
 * fusionLimit. Not "highest fusionLimit": Intensify and Stretch have an Expert
 * row at 10 that the game no longer issues, and the mod players hold is the
 * untiered one at 5.
 *
 * OFFLINE IS A SKIP, like the other live gates.
 *
 * Run: node scripts/check-key-mods.ts
 */
import assert from 'node:assert/strict';
import { KEY_MODS } from '../src/data/plat-mods.ts';

const WFCD = 'https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/Mods.json';

interface WfcdMod {
  uniqueName?: unknown;
  name?: unknown;
  fusionLimit?: unknown;
}

interface Row {
  uniqueName: string;
  name: string;
  fusionLimit: number | null;
}

/** The Mods 1.0 tier segments that mark a copy of a mod rather than the mod. */
const TIERED = /\/(Beginner|Intermediate|Expert)\//;

async function main(): Promise<void> {
  const keys = Object.keys(KEY_MODS);

  let live: Map<string, Row>;
  const byName = new Map<string, Row[]>();
  try {
    const res = await fetch(WFCD);
    if (!res.ok) throw new Error(`the mod export responded ${String(res.status)}`);
    const body: unknown = await res.json();
    assert.ok(Array.isArray(body), 'the mod export was not an array');
    const rows: Row[] = (body as WfcdMod[])
      .filter((m): m is WfcdMod & { uniqueName: string; name: string } => typeof m.uniqueName === 'string' && typeof m.name === 'string')
      .map((m) => ({ uniqueName: m.uniqueName, name: m.name, fusionLimit: typeof m.fusionLimit === 'number' ? m.fusionLimit : null }));
    live = new Map(rows.map((r) => [r.uniqueName, r]));
    for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
    assert.ok(live.size > 500, `the mod export returned only ${String(live.size)} mods`);
  } catch (err) {
    console.log(`  SKIP  mod export unreachable (${err instanceof Error ? err.message : String(err)})`);
    console.log(`\n${String(keys.length)} key mods left unverified; run again with a connection`);
    return;
  }

  const bad: string[] = [];
  for (const key of keys) {
    const spec = KEY_MODS[key];
    if (spec === undefined) continue;
    const real = live.get(spec.path);
    if (real === undefined) {
      bad.push(`${key}: ${spec.path} is not a mod in the export, so this mod can never be found on an account`);
      continue;
    }
    if (real.name !== spec.name) {
      // The Serration / Hornet Strike case: a real path, the wrong mod.
      bad.push(`${key}: ${spec.path} is "${real.name}" upstream, not "${spec.name}"`);
    }
    if (real.fusionLimit !== null && real.fusionLimit !== spec.maxRank) {
      bad.push(
        `${key}: "${spec.name}" maxes at ${String(real.fusionLimit)} upstream, but this app uses ${String(spec.maxRank)}`,
      );
    }

    // IDENTITY: the untiered row for this name, not merely a row with this
    // name. Once the path is that row, the ceiling check above pins maxRank to
    // its fusionLimit, so the two together assert "the real mod, at its cap".
    const untiered = (byName.get(spec.name) ?? []).filter((r) => !TIERED.test(r.uniqueName));
    const canon = untiered.length === 1 ? untiered[0] : undefined;
    if (canon === undefined) {
      bad.push(`${key}: "${spec.name}" has ${String(untiered.length)} untiered rows upstream, so which one players hold needs deciding by hand`);
      continue;
    }
    if (canon.uniqueName !== spec.path) {
      const tier = TIERED.exec(spec.path)?.[1];
      bad.push(
        `${key}: ${spec.path} is ${tier === undefined ? 'not' : `the ${tier} copy of`} "${spec.name}"; the mod players hold is ${canon.uniqueName} (fusionLimit ${String(canon.fusionLimit)})`,
      );
    }
  }

  for (const line of bad) console.log(`  FAIL  ${line}`);
  assert.deepEqual(bad, [], 'a key mod is described wrongly, so readiness will misreport it');

  console.log(`  ok    all ${String(keys.length)} key mods resolve to the mod they name - the untiered one - at the rank it caps at`);
  console.log('\nevery mod the route ranking depends on is the one it says');
}

await main();
