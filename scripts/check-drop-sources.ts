/**
 * The vendored cosmetic drop sources must still match the live table.
 *
 * WHY THIS IS NOT PARANOIA
 * ────────────────────────
 * `vendor/drop-sources.json` is a 79-row extract of a 4.3 MB table, taken once
 * and committed. That is the right trade for an overlay that must be gentle,
 * and it is also exactly the kind of file that silently goes stale: nothing in
 * the app fetches it, so nothing notices when DE moves a scene to a different
 * bounty or adds an ephemera.
 *
 * A stale row here does not throw. It sends a player to farm a place that no
 * longer drops the thing - a confident wrong answer, which is worse than the
 * plain prose the binding replaced.
 *
 * WHAT IS CHECKED
 * ────────────────────────
 * Every vendored row must still exist upstream with the same place and rate,
 * and the extract must still be COMPLETE - a cosmetic added upstream that
 * nobody re-vendored is the failure that reads as "this does not drop anywhere".
 *
 * OFFLINE IS A SKIP, like the other live gates.
 *
 * Run: node scripts/check-drop-sources.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ROUTE_GUIDE, stepText } from '../src/data/plat-guide.ts';
import { PLAT_ROUTES } from '../src/data/plat-routes.ts';

const SOURCE = 'https://drops.warframestat.us/data/all.slim.json';

interface Source {
  item: string;
  place: string;
  rarity: string | null;
  chance: number | null;
}

const here = dirname(fileURLToPath(import.meta.url));
const file = JSON.parse(
  readFileSync(join(here, '..', 'src', 'data', 'vendor', 'drop-sources.json'), 'utf8'),
) as { sources: Source[] };

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** `item` + `place` is the identity of a row; an item drops in many places. */
const key = (item: string, place: string): string => `${item}\u0000${place}`;

async function main(): Promise<void> {
  let rows: unknown[];
  try {
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`the drop table responded ${String(res.status)}`);
    const body: unknown = await res.json();
    rows = Array.isArray(body) ? body : Object.values(body as object);
    assert.ok(rows.length > 10_000, `the drop table returned only ${String(rows.length)} rows`);
  } catch (err) {
    console.log(`  SKIP  drop table unreachable (${err instanceof Error ? err.message : String(err)})`);
    console.log(`\n${String(file.sources.length)} vendored rows left unverified; run again with a connection`);
    return;
  }

  const live = new Map<string, number | null>();
  for (const raw of rows) {
    const r = raw as { item?: unknown; place?: unknown; chance?: unknown };
    if (typeof r.item !== 'string' || typeof r.place !== 'string') continue;
    const cosmetic = /\bscene\b/i.test(r.item) || /\bephemera\b/i.test(r.item);
    const duviriRiven = /riven/i.test(r.item) && /Duviri\/Endless/i.test(r.place);
    if (!cosmetic && !duviriRiven) continue;
    /*
     * The upstream `place` carries HTML - "Tier 6 (<b>Hard</b>)" - and the
     * vendored copy strips it, so the tags come off here too. Comparing the raw
     * strings reported every riven row as "no longer drops", which is the kind
     * of false alarm that gets a check deleted rather than believed.
     */
    live.set(key(r.item, r.place.replace(/<[^>]+>/g, '')), num(r.chance));
  }

  const bad: string[] = [];
  for (const s of file.sources) {
    const k = key(s.item, s.place);
    if (!live.has(k)) {
      bad.push(`${s.item} no longer drops at "${s.place}"`);
      continue;
    }
    const now = live.get(k) ?? null;
    /*
     * Rates are compared with a tolerance rather than exactly: the table
     * publishes some as strings and some as numbers, and a rounding difference
     * is not a stale row. A real retune moves them much further than this.
     */
    if (s.chance !== null && now !== null && Math.abs(s.chance - now) > 0.011) {
      bad.push(`${s.item} at "${s.place}" is ${String(now)}% upstream, vendored as ${String(s.chance)}%`);
    }
  }

  // Completeness, which is the direction that reads as "this drops nowhere".
  const missing = [...live.keys()].filter((k) => !file.sources.some((s) => key(s.item, s.place) === k));
  if (missing.length > 0) {
    bad.push(
      `${String(missing.length)} upstream rows are not vendored, e.g. ${missing
        .slice(0, 3)
        .map((k) => k.replace('\u0000', ' at '))
        .join('; ')} - rerun scripts/fetch-drop-sources.ts`,
    );
  }

  for (const line of bad) console.log(`  FAIL  ${line}`);
  assert.deepEqual(bad, [], 'the vendored drop sources no longer match the live table');

  console.log(`  ok    all ${String(file.sources.length)} vendored drop sources still match upstream`);

  /*
   * AND THE PROSE MUST STILL MATCH THE NUMBERS IT QUOTES.
   * ────────────────────────
   * The Duviri route recites this table verbatim: "Melee at 11.9 per cent,
   * Pistol and Rifle at 8.5 each, Zaw and Kitgun at 1.2". Every one of those
   * figures was correct - and the sentence still omitted Shotgun at 2.7, which
   * is the third-best row on the same table. A quoted figure is a claim, and a
   * LIST of quoted figures is also a claim about what is not on it.
   */
  const tier6 = file.sources.filter((s) => /Riven Mod/i.test(s.item) && /Tier 6/.test(s.place));
  /*
   * BOTH the steps and the route's own `how`. The first version read only the
   * steps, so it passed while `plat-routes.ts` still recited the old five-item
   * list two files away - the prose a player reads FIRST, before any step. A
   * gate that covers half the prose certifies the other half.
   */
  const route = PLAT_ROUTES.find((r) => r.id === 'riven-duviri-endless');
  const quoted = [route?.how ?? '', ...(ROUTE_GUIDE['riven-duviri-endless']?.steps.map(stepText) ?? [])].join(' ');
  const unquoted: string[] = [];
  for (const row of tier6) {
    const kind = row.item.replace(/ Riven Mod$/i, '');
    if (!new RegExp(kind, 'i').test(quoted)) {
      unquoted.push(`${kind} drops at ${String(row.chance ?? 0)}% and the route never mentions it`);
    }
  }
  /*
   * The Sliver tiers, which the prose stated as "every tier from the first".
   * They are 1, 3 and 4 - tier 2 has none, and nothing above 4 does. A player
   * told "every tier" keeps pushing for a reward that stopped three tiers ago.
   */
  const sliverTiers = [
    ...new Set(
      file.sources
        .filter((s) => /Riven Sliver/i.test(s.item))
        .map((s) => /Tier (\d+)/.exec(s.place)?.[1])
        .filter((t): t is string => t !== undefined),
    ),
  ].sort();
  /*
   * "not every tier" is the CORRECTED wording and must not trip this. The first
   * version matched a bare /every tier/ and fired on the very sentence written
   * to fix the bug, which would have taught the next reader to delete the check.
   */
  if (/(?<!not )every tier/i.test(quoted)) {
    unquoted.push(`the route says Slivers drop on "every tier", but the table lists only tiers ${sliverTiers.join(', ')}`);
  }

  for (const line of unquoted) console.log(`  FAIL  ${line}`);
  assert.deepEqual(unquoted, [], 'the route quotes some of its table and not the rest');
  console.log(`  ok    the route names every one of the ${String(tier6.length)} riven rows on its own table`);

  console.log('\nevery cosmetic source the app names is still where it says');
}

await main();
