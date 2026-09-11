/**
 * An excuse is an assertion, and an unchecked assertion rots.
 *
 * WHY THIS EXISTS
 * ────────────────────────
 * `plat-plain.ts` records why each unbound step is unbound, and the `missing`
 * category is the only one that makes a claim about the outside world: "the app
 * would answer this if anything it reads carried the fact". Nothing verified
 * those claims, and one was wrong the day it was written - the Circuit's weekly
 * rotation was filed as absent from the world state while arriving in it fully
 * populated, because it had been classified from the TYPESCRIPT MODEL, where
 * `duviriCycle.choices` sat as an unread `unknown[]`, rather than from the feed.
 *
 * That is a bad failure precisely because it is invisible: the step reads as
 * plain prose, the accounting says it was considered, and the gates all pass. A
 * player is told to go and look something up that the app is holding.
 *
 * So every `missing` reason that names a `feedKey` is checked against the LIVE
 * feed here. A key that turns out to carry usable content fails the build.
 *
 * WHAT COUNTS AS "NOTHING TO SHOW"
 * ────────────────────────
 * Absent, null, an empty array or object, or an entry the feed itself marks
 * `expired` - that last one is the real state of `arbitration`, which arrives
 * as `SolNode000` / `Tenno` / `Unknown` / `expired: true`. Anything else is
 * usable content and the excuse is wrong.
 *
 * OFFLINE IS A SKIP
 * ────────────────────────
 * Like `check-slugs` and `check-resource-paths`, an unreachable feed reports
 * SKIP and exits zero.
 *
 * Run: node scripts/check-plain-claims.ts
 */
import assert from 'node:assert/strict';
import { PLAIN_STEPS } from '../src/data/plat-plain.ts';

const FEED = 'https://api.warframestat.us/pc';

/** Walk a dotted path, so a claim can name `nightwave.offerings`. */
function at(root: unknown, path: string): unknown {
  let here: unknown = root;
  for (const part of path.split('.')) {
    if (here === null || typeof here !== 'object') return undefined;
    here = (here as Record<string, unknown>)[part];
  }
  return here;
}

/** True when there is genuinely nothing a step could be shown. */
function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // The feed's own word for "this slot is not currently live".
    if (o['expired'] === true) return true;
    return Object.keys(o).length === 0;
  }
  return false;
}

async function main(): Promise<void> {
  const claims = Object.entries(PLAIN_STEPS)
    .filter((e): e is [string, { kind: 'missing'; what: string; feedKey?: string }] => e[1].kind === 'missing')
    .filter(([, r]) => typeof r.feedKey === 'string');

  if (claims.length === 0) {
    console.log('  ok    no step claims a world-state gap, so there is nothing to falsify');
    return;
  }

  let feed: unknown;
  try {
    const res = await fetch(FEED);
    if (!res.ok) throw new Error(`the feed responded ${String(res.status)}`);
    feed = await res.json();
    assert.ok(feed !== null && typeof feed === 'object', 'the feed did not return an object');
    assert.ok(Object.keys(feed as object).length > 20, 'the feed returned too few keys to trust');
  } catch (err) {
    console.log(`  SKIP  world state unreachable (${err instanceof Error ? err.message : String(err)})`);
    console.log(`\n${String(claims.length)} claims left unverified; run again with a connection`);
    return;
  }

  const wrong: string[] = [];
  for (const [step, reason] of claims) {
    const key = reason.feedKey;
    if (key === undefined) continue;
    const value = at(feed, key);
    if (!isEmpty(value)) {
      const shape = Array.isArray(value)
        ? `an array of ${String(value.length)}`
        : typeof value === 'object' && value !== null
          ? `an object with keys ${Object.keys(value).slice(0, 6).join(', ')}`
          : String(value);
      wrong.push(`${step}: claims \`${key}\` has nothing to show, but the feed carries ${shape}`);
    }
  }

  for (const line of wrong) console.log(`  FAIL  ${line}`);
  assert.deepEqual(wrong, [], 'a step is excused by a world-state gap that does not exist');

  console.log(`  ok    all ${String(claims.length)} world-state gaps are real in the live feed`);
  console.log('\nevery recorded excuse still holds against the data');
}

await main();
