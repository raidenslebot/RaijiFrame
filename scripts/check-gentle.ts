/**
 * Self-check for the gentle read layer.
 *
 * This is the one guarantee the whole app leans on - "we never spam a source" -
 * so it gets a check that fails loudly if any of the four guards stops holding.
 *
 * Run: node scripts/check-gentle.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GentleReader, RateLimited, type Policy } from '../src/core/gentle.ts';
import { refreshOutcome, unwrapInventory } from '../src/core/gep.ts';
import { accountKeyCount, isPlausibleAccount } from '../src/core/acquire.ts';

// The reader only touches localStorage when a policy sets persist:true.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

const json = (b: string) => JSON.parse(b) as unknown;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fake source that counts exactly how many times it was actually hit. */
function source(bodies: string[]) {
  let n = 0;
  return {
    get hits() {
      return n;
    },
    load: async () => ({ body: bodies[Math.min(n++, bodies.length - 1)]! }),
  };
}

async function cacheGuard() {
  const s = source(['{"v":1}']);
  const g = new GentleReader(100, 100);
  const p: Policy = { ttlMs: 10_000, minIntervalMs: 0 };

  const a = await g.read('k', p, s.load, json);
  const b = await g.read('k', p, s.load, json);

  assert.equal(s.hits, 1, 'a value inside its TTL must not contact the source');
  assert.equal(a.origin, 'fresh');
  assert.equal(b.origin, 'cached');
}

async function singleflightGuard() {
  const s = source(['{"v":1}']);
  const g = new GentleReader(100, 100);
  const p: Policy = { ttlMs: 0, minIntervalMs: 0 };

  // Ten callers pile onto one cold key simultaneously.
  const all = await Promise.all(Array.from({ length: 10 }, () => g.read('k', p, s.load, json)));

  assert.equal(s.hits, 1, '10 concurrent callers must collapse into 1 source read');
  assert.equal(g.stats.coalesced, 9);
  assert.equal(all.length, 10);
}

async function floorGuard() {
  const s = source(['{"v":1}', '{"v":2}']);
  const g = new GentleReader(100, 100);
  // Already stale (ttl 0) but inside the floor: must NOT re-read.
  const p: Policy = { ttlMs: 0, minIntervalMs: 5_000 };

  await g.read('k', p, s.load, json);
  const second = await g.read('k', p, s.load, json);

  assert.equal(s.hits, 1, 'the floor must hold even when the value is stale');
  assert.equal(second.origin, 'cached');
  assert.equal(g.stats.deferred, 1);
}

async function bucketGuard() {
  // Capacity 2, refill 0.5/s: the 3rd distinct key has to wait ~2s for a token.
  const g = new GentleReader(2, 0.5);
  const s = source(['{"v":1}']);
  const p: Policy = { ttlMs: 0, minIntervalMs: 0 };

  const t0 = Date.now();
  await Promise.all([g.read('a', p, s.load, json), g.read('b', p, s.load, json), g.read('c', p, s.load, json)]);
  const elapsed = Date.now() - t0;

  assert.equal(s.hits, 3, 'distinct keys are separate reads');
  assert.ok(elapsed >= 1_500, `bucket must throttle a burst across keys, waited only ${elapsed}ms`);
}

async function unchangedGuard() {
  // Same bytes twice: the second read must hand back the SAME object reference,
  // which is what lets downstream consumers skip work on a `prev === next` check.
  const s = source(['{"v":1}', '{"v":1}']);
  const g = new GentleReader(100, 100);
  const p: Policy = { ttlMs: 0, minIntervalMs: 0 };

  const a = await g.read('k', p, s.load, json);
  const b = await g.read('k', p, s.load, json);

  assert.equal(s.hits, 2);
  assert.equal(b.origin, 'unchanged');
  assert.ok(a.value === b.value, 'identical bytes must resolve to the same reference');
}

async function notModifiedGuard() {
  const g = new GentleReader(100, 100);
  const p: Policy = { ttlMs: 0, minIntervalMs: 0 };
  let sentConditional = false;

  const first = async () => ({ body: '{"v":1}', etag: 'W/"abc"' });
  const second = async (h: Record<string, string>) => {
    sentConditional = h['If-None-Match'] === 'W/"abc"';
    return { body: '', notModified: true };
  };

  const a = await g.read('k', p, first, json);
  const b = await g.read('k', p, second, json);

  assert.ok(sentConditional, 'a stored ETag must be replayed as If-None-Match');
  assert.equal(b.origin, 'unchanged');
  assert.ok(a.value === b.value, 'a 304 must preserve the previous reference');
}

async function failureGuard() {
  const g = new GentleReader(100, 100);
  const p: Policy = { ttlMs: 0, minIntervalMs: 0 };
  const ok = async () => ({ body: '{"v":1}' });
  const boom = async () => {
    throw new Error('network down');
  };

  await g.read('k', p, ok, json);
  const during = await g.read('k', p, boom, json);
  assert.deepEqual(during.value, { v: 1 }, 'a failed read must serve the last good value');

  // ...and it must not turn into a retry storm: the floor now applies to the failure.
  const strict: Policy = { ttlMs: 0, minIntervalMs: 5_000 };
  let attempts = 0;
  const counted = async () => {
    attempts++;
    throw new Error('still down');
  };
  await g.read('k', strict, counted, json);
  await g.read('k', strict, counted, json);
  assert.equal(attempts, 0, 'after a failure the floor must suppress immediate retries');

  // A cold key with no previous value has nothing to serve, so it must reject.
  await assert.rejects(() => g.read('cold', p, boom, json), /network down/);
}

/**
 * A CHANGED PARSE SHAPE NEEDS A NEW CACHE KEY, and forgetting costs a silent
 * wrong answer that only the author never sees.
 *
 * `gentle` caches PARSED values, not raw bodies. Add a field to `ItemDbEntry`
 * and every machine with a cached entry keeps reading the old shape - the new
 * field is `undefined` forever, the code treats it as "the source does not say"
 * rather than "we did not re-parse", and there is nothing on screen to suggest
 * it. It bit this project once already: a Warframe's health, shield and armour
 * were added to the projection and read back as absent until the key went from
 * `itemdb.c4` to `itemdb.c5`.
 *
 * A developer editing the parse cannot be relied on to remember. So the SHAPE
 * is fingerprinted here: the field names of the parsed type, in order. Change
 * them and this fails, and the message says to bump the key - which is the only
 * thing that actually invalidates what is on disk.
 *
 * The list is written out rather than hashed on purpose: a hash tells you
 * something changed, and a diff tells you what.
 */
function aChangedParseShapeBumpsTheCacheKey(): void {
  const shapeOf = (file: string, iface: string): string[] => {
    const src = readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8');
    const m = new RegExp(`export interface ${iface} \\{([\\s\\S]*?)\\n\\}`).exec(src);
    assert.ok(m, `${iface} is gone from ${file}`);
    const body = (m[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*/g, ' ');
    return [...body.matchAll(/^\s*(\w+)\??\s*:/gm)].map((x) => x[1] ?? '');
  };

  const itemdb = readFileSync(new URL('../src/data/itemdb.ts', import.meta.url), 'utf8');
  const moddb = readFileSync(new URL('../src/data/moddb.ts', import.meta.url), 'utf8');

  // The keys, as the code writes them.
  assert.ok(/itemdb\.c5\./.test(itemdb), 'the item catalogue cache key is no longer itemdb.c5 - update the shape below with it');
  assert.ok(/'moddb\.v2'/.test(moddb), 'the mod catalogue cache key is no longer moddb.v2 - update the shape below with it');

  assert.deepEqual(
    shapeOf('itemdb.ts', 'ItemDbEntry'),
    ITEMDB_C5_SHAPE,
    'ItemDbEntry changed shape. Every machine with a cached entry is still reading the OLD one: bump itemdb.c5 to c6 and update this list.',
  );
  assert.deepEqual(
    shapeOf('moddb.ts', 'ModRow'),
    MODDB_V2_SHAPE,
    'ModRow changed shape. Every machine with a cached entry is still reading the OLD one: bump moddb.v2 to v3 and update this list.',
  );
}

/** The fields `itemdb.c5` was written with. */
const ITEMDB_C5_SHAPE = [
  'uniqueName',
  'name',
  'category',
  'productCategory',
  'type',
  'masteryReq',
  'masterable',
  'maxRank',
  'rarity',
  'vaulted',
  'tradable',
  'imageName',
  'description',
  'introduced',
  'buildTime',
  'buildPrice',
  'buildQuantity',
  'skipBuildTimePrice',
  'components',
  'name',
  'itemCount',
  'uniqueName',
  'from',
  'abilities',
  'criticalChance',
  'criticalMultiplier',
  'procChance',
  'fireRate',
  'magazineSize',
  'reloadTime',
  'totalDamage',
  'disposition',
  'health',
  'shield',
  'armor',
  'power',
  'sprintSpeed',
  'damagePerShot',
  'multishot',
  'trigger',
  'polarities',
  'exilusPolarity',
  'stancePolarity',
  'attacks',
  'name',
  'speed',
  'critChance',
  'critMult',
  'statusChance',
  'damage',
  'range',
  'comboDuration',
  'followThrough',
  'windUp',
  'blockingAngle',
  'slamAttack',
  'slideAttack',
  'heavyAttackDamage',
  'accuracy',
  'noise',
  'isPrime',
];
/** The fields `moddb.v2` was written with. */
const MODDB_V2_SHAPE = [
  'uniqueName',
  'name',
  'displayName',
  'slot',
  'polarity',
  'baseDrain',
  'fusionLimit',
  'ranks',
  'isAura',
  'isFlawed',
  'isExilus',
  'isUtility',
  'isPrime',
  'rarity',
  'type',
  'modSet',
  'modSetValues',
  'thumbnail',
  'tradable',
  'best',
  'sources',
  'introduced',
  'effects',
  'refused',
];

const checks = [
  cacheGuard,
  singleflightGuard,
  floorGuard,
  bucketGuard,
  unchangedGuard,
  notModifiedGuard,
  failureGuard,
  aChangedParseShapeBumpsTheCacheKey,
];

let failed = 0;
for (const c of checks) {
  try {
    await c();
    console.log(`  ok    ${c.name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${c.name}\n        ${(err as Error).message}`);
  }
}
await sleep(0);
console.log(failed ? `\n${failed} check(s) failed` : '\nall gentle-read guards hold');
// Set the code rather than calling process.exit(): exiting immediately can
// race stdout flushing on Windows and print a libuv assertion after the report.
process.exitCode = failed ? 1 : 0;

/* ------------------------------------------- being told to slow down */

/*
 * A 429 IS A REFUSAL, NOT A CRASH, AND THE DIFFERENCE IS THE WHOLE POINT.
 * ————————————————————————————————————————————
 * Observed live against api.warframe.market. Thrown as a bare Error it was
 * handled like a network drop: keep the stale value, push `at` forward by the
 * ordinary floor, try again on the next tick - which is the exact cadence the
 * server had just refused. The reader has to wait LONGER after a refusal than
 * after a failure, and honour Retry-After when it is sent.
 */
{
  const policy: Policy = { ttlMs: 0, minIntervalMs: 0 };
  const g = new GentleReader(100, 100);

  let calls = 0;
  const limited = async (): Promise<never> => {
    calls++;
    throw new RateLimited('http://example.test/x', 5_000);
  };

  // A first, successful read gives the reader something to hold.
  const ok = async () => ({ body: '{"v":1}' });
  const first = await g.read('rl', policy, ok, (b) => JSON.parse(b) as { v: number });
  assert.equal(first.value.v, 1, 'the good value is read');

  // Now the source starts refusing.
  const second = await g.read('rl', policy, limited, (b) => JSON.parse(b) as { v: number });
  assert.equal(calls, 1, 'the refusal was attempted once');
  assert.equal(second.value.v, 1, 'and the stale value is still served rather than an error');

  /*
   * The floor here is ZERO, so an ordinary failure would allow an immediate
   * retry. A refusal must not: the next read has to be held off by what the
   * server asked for.
   */
  const third = await g.read('rl', policy, limited, (b) => JSON.parse(b) as { v: number });
  assert.equal(calls, 1, 'the source is NOT contacted again inside the Retry-After window');
  assert.equal(third.value.v, 1, 'and the stale value keeps being served meanwhile');

  assert.ok(new RateLimited('u', null).retryAfterMs === null, 'a 429 with no Retry-After carries none');
  assert.equal(new RateLimited('u', 1000).retryAfterMs, 1000, 'and one with a header carries it');
}

/*
 * AND THE SAME REFUSAL ON A COLD CACHE, WHICH IS WHERE IT WAS BEING DISCARDED.
 *
 * Everything above starts with a successful read, so there is an entry to push
 * `at` forward on. With nothing cached there was no entry: the 429 was caught,
 * the wait was computed into a `held` object, and both were dropped along with
 * the entry on the way out. The next caller began again at guard 1 with nothing
 * to stop it - a retry storm against the one server that had explicitly asked
 * for the opposite, and the case that happens on a first launch, which is
 * exactly when a shared CDN is most likely to refuse.
 *
 * The refusal must be honoured with no value to serve, so the caller keeps
 * getting an error. That is the honest outcome; a fabricated value would be
 * worse than the throw.
 */
{
  const policy: Policy = { ttlMs: 0, minIntervalMs: 0 };
  const g = new GentleReader(100, 100);

  let calls = 0;
  const limited = async (): Promise<never> => {
    calls++;
    throw new RateLimited('http://example.test/cold', 5_000);
  };
  const read = () => g.read('cold', policy, limited, (b) => JSON.parse(b) as { v: number });

  await assert.rejects(read, RateLimited, 'a cold 429 must still reach the caller as a refusal');
  assert.equal(calls, 1, 'the refusal was attempted once');

  await assert.rejects(read, RateLimited, 'and the second caller is refused too');
  assert.equal(calls, 1, 'THE SOURCE WAS CONTACTED AGAIN INSIDE ITS OWN RETRY-AFTER WINDOW');

  await assert.rejects(read, RateLimited);
  assert.equal(calls, 1, 'nor on any read after that');

  /*
   * And the hold is released by a success rather than lasting forever: a
   * refusal that outlived the server's own window would turn one 429 into a
   * permanently dead key.
   */
  const g2 = new GentleReader(100, 100);
  let hit = 0;
  const brief = async (): Promise<never> => {
    hit++;
    throw new RateLimited('http://example.test/brief', 20);
  };
  await assert.rejects(() => g2.read('brief', policy, brief, json), RateLimited);
  await sleep(40);
  const after = await g2.read('brief', policy, async () => ({ body: '{"v":7}' }), (b) => JSON.parse(b) as { v: number });
  assert.equal(after.value.v, 7, 'the key stayed refused past the window the server asked for');
  assert.equal(hit, 1, 'the refusing loader was not called again');
  console.log('  ok    a 429 on a COLD cache is honoured too, rather than dropped with the entry');
}

/*
 * AND THE UNCONDITIONAL RETRY MUST NOT FIRE ON ONE.
 *
 * A conditional read that fails is retried without its headers, because
 * cdn.jsdelivr.net rejects `If-None-Match` at CORS and the alternative was a
 * catalogue frozen forever at whatever version loaded first. That retry was
 * written for a header problem and then applied to EVERY failure - so a 429
 * arriving on a revalidation was answered by immediately sending the same
 * request again, minus the header that would have let the server answer 304.
 * Two requests where the server asked for none, and the counter that is
 * supposed to make the reader's gentleness observable counted it as a repair.
 *
 * Both halves are checked: the retry still happens for an ordinary failure, and
 * never for a refusal.
 */
{
  const policy: Policy = { ttlMs: 0, minIntervalMs: 0 };

  // An entry with an ETag, so the next read is conditional.
  const warm = async (g: GentleReader, key: string) => {
    const first = await g.read(key, policy, async () => ({ body: '{"v":1}', etag: 'W/\"1\"' }), (b) => JSON.parse(b) as { v: number });
    assert.equal(first.value.v, 1);
  };

  const refusing = new GentleReader(100, 100);
  await warm(refusing, 'rl-retry');
  let sent = 0;
  // The stale value is still served - that half is checked further up. What
  // matters here is how many times the refused request was sent.
  const held = await refusing.read(
    'rl-retry',
    policy,
    async (h) => {
      sent++;
      assert.ok(Object.keys(h).length > 0, 'the second attempt dropped the conditional headers, which is the retry firing');
      throw new RateLimited('http://example.test/rl-retry', 5_000);
    },
    (b) => JSON.parse(b) as { v: number },
  );
  assert.equal(held.value.v, 1, 'the stale value is no longer served through a refusal');
  assert.equal(sent, 1, 'A REFUSAL WAS ANSWERED BY SENDING THE REQUEST AGAIN');
  assert.equal(refusing.stats.unconditionalRetries, 0, 'and it was counted as a header repair');

  // The retry itself still works, which is what pays for the CORS case.
  const broken = new GentleReader(100, 100);
  await warm(broken, 'hdr');
  const seen: number[] = [];
  const second = await broken.read(
    'hdr',
    policy,
    async (h) => {
      seen.push(Object.keys(h).length);
      if (seen.length === 1) throw new TypeError('Request header field if-none-match is not allowed');
      return { body: '{"v":2}' };
    },
    (b) => JSON.parse(b) as { v: number },
  );
  assert.deepEqual(seen, [1, 0], 'the header-rejection retry no longer drops the headers');
  assert.equal(second.value.v, 2, 'and the fresh value never arrives');
  assert.equal(broken.stats.unconditionalRetries, 1, 'the retry is not counted');

  console.log('  ok    the unconditional retry repairs a rejected header and never re-sends a refused request');
}

console.log('  ok    a 429 is held off for what the server asked, not retried at the old cadence');

/* ------------------------------------ one ceiling across many windows */

/*
 * TWO WINDOWS ARE TWO BUCKETS UNLESS THE BUCKET IS SHARED.
 * ————————————————————————————————————————————
 * `ingame.html` and `desktop.html` mount the same panel registry, so both can
 * open the Platinum panel. Each window is its own JS context, so each held its
 * own module-level `GentleReader` and its own token bucket: a pair reading at
 * "one a second" put TWO a second on warframe.market. That is not a near miss.
 * The market reader's own note records measuring 429s at exactly two a second,
 * so the unshared bucket landed on the rate already proven to fail.
 *
 * The two halves below are the same work through two readers. The only
 * difference is whether they share a key, and the elapsed time has to show it.
 */
{
  const policy: Policy = { ttlMs: 0, minIntervalMs: 0 };
  const body = async () => ({ body: '{"v":1}' });
  const parse = (b: string) => JSON.parse(b) as { v: number };

  /** Six reads split across two readers, all in flight together. */
  const race = async (a: GentleReader, b: GentleReader): Promise<number> => {
    const t0 = Date.now();
    await Promise.all(
      // Distinct keys, so nothing is served from cache or coalesced - every
      // one of these has to take a token.
      [0, 1, 2, 3, 4, 5].map((i) => (i % 2 === 0 ? a : b).read(`k${String(i)}`, policy, body, parse)),
    );
    return Date.now() - t0;
  };

  // One token in hand, then one every 200ms.
  const shared = await race(new GentleReader(1, 5, 'shared.test'), new GentleReader(1, 5, 'shared.test'));
  mem.delete('codex.bucket.shared.test');
  const apart = await race(new GentleReader(1, 5), new GentleReader(1, 5));

  /*
   * Shared: one free token, then five more at 200ms each - about a second.
   * Apart: each reader has its own free token and its own refill, so the six
   * reads finish in roughly the time three take - about 400ms.
   */
  assert.ok(shared >= 800, `sharing the key must pace the pair: took ${String(shared)}ms, expected 1000ms`);
  assert.ok(apart <= 600, `unshared readers do NOT pace each other: took ${String(apart)}ms`);
  assert.ok(
    shared > apart * 1.5,
    `the share key has to make a real difference: shared ${String(shared)}ms vs apart ${String(apart)}ms`,
  );
}

console.log('  ok    one shared bucket paces every window, so two windows are not two rate limits');

/*
 * THE ONE-MINUTE FLOOR WAS NOT UNCONDITIONAL, and `gep.ts` says in as many
 * words that it is: "even if a future caller wires this to something chattier,
 * the game is asked at most once a minute".
 *
 * The reset was keyed to what a read ROUTED. But `ingest` skips a byte-identical
 * payload before it counts anything, and an unchanged inventory is the ORDINARY
 * outcome of a refresh - so the common case cleared the floor and the next
 * caller got a free read of the game's memory. It held only when the data had
 * changed, which is the case where it does not matter.
 *
 * `seen` counts every entry the bag carried, deduped or not.
 */
assert.equal(refreshOutcome('absent'), 'nothing', 'a read that carried no account at all is not distinguished');
assert.equal(refreshOutcome('same'), 'unchanged', 'a read that answered "nothing changed" is treated as a failure, which clears the floor');
assert.equal(refreshOutcome('fresh'), 'new', 'a read that carried a changed account is not recognised');
for (const verdict of ['same', 'fresh'] as const) {
  assert.notEqual(refreshOutcome(verdict), 'nothing', `an account that arrived ${verdict} would reopen the refresh window`);
}
console.log('  ok    a refresh that answered "nothing changed" consumes its window, so the floor is real');

/*
 * AND THE THIRD CASE, which the first two hid between them.
 *
 * GEP reads the game's memory while the game is writing it, so a payload can
 * arrive TRUNCATED - `coerce` hands back the raw string, `route` refuses it,
 * and `ingest` deliberately does not record its hash so an immediate retry
 * would deliver the good value. The call used to read as "nothing changed" and
 * consume the whole minute: the retry it was designed for was then refused by
 * the floor, and the panel sat on numbers the app had just failed to replace.
 * Both halves of that were written on purpose and they cancelled each other out.
 */
assert.equal(refreshOutcome('unusable'), 'nothing', 'A TRUNCATED READ CONSUMES THE MINUTE, so the retry that would have fixed it is refused');
console.log('  ok    a read that arrived unusable does not spend the window a retry needs');

/*
 * AND THE VERDICT IS ABOUT THE INVENTORY, NOT ABOUT KEY COUNTS. The first
 * version of this counted routed and rejected payloads across the whole bag,
 * and both halves were wrong in opposite directions:
 *
 *   - `route` returns true for `gep_internal` - one of Warframe's four GEP keys
 *     - and for anything Overwolf adds later, so a bag carrying the provider's
 *     own version block and nothing else counted as a successful account read.
 *     That marks the seed done, killing the retry that exists for a player who
 *     sees nothing at all, and stamps the clock the panel treats as permission
 *     to name a weapon.
 *   - `route('highlighted')` returns false whenever nothing is hovered, which
 *     is the ordinary state, and a refusal's hash is deliberately not recorded,
 *     so it repeats on every read. Counting refusals in general meant one
 *     un-hovered frame cleared the one-minute floor for the rest of the session
 *     and stopped the answer clock moving ever again.
 *
 * Four verdicts, one subject. `check-account-model` pins the source that
 * produces them.
 */
assert.deepEqual(
  (['absent', 'same', 'fresh', 'unusable'] as const).map(refreshOutcome),
  ['nothing', 'unchanged', 'new', 'nothing'],
  'the four things that can happen to an account no longer map onto the three things a caller can do about it',
);

/*
 * THE ACCOUNT ARRIVES INSIDE A SECOND JSON STRING, and reading only the first
 * one meant the app discarded every read GEP ever gave it.
 *
 * Measured on the live app over the running game by asking the provider
 * directly: `match_info.inventory` is a 247,972-character string that parses to
 * two keys - `InventoryJson`, holding the whole account as ANOTHER JSON string,
 * and `MissionRewards`. Neither is an account key, so `isPlausibleAccount`
 * counted zero and the read was refused. The app was reading `gep: connected`
 * with `accepted: 0` while a quarter of a megabyte of account sat unpacked, and
 * every number the overlay showed came from the snapshot on disk - which is
 * what "it was totally wrong" looks like from the inside.
 *
 * The shapes below are STRUCTURE, not data: key names carry no account content.
 */
const WRAPPED = JSON.stringify({
  InventoryJson: JSON.stringify({ RawUpgrades: [], Upgrades: [], CurrentLoadOutIds: [], LoadOutPresets: {}, RegularCredits: 0 }),
  MissionRewards: [],
});
const wrapped = unwrapInventory(JSON.parse(WRAPPED));
assert.ok(isPlausibleAccount(wrapped), 'THE WRAPPER IS TAKEN FOR THE ACCOUNT: every read GEP sends is refused as carrying no account keys');
assert.equal(accountKeyCount(JSON.parse(WRAPPED)), 0, 'the outer object counts as an account, so this whole check is measuring the wrong thing');

// The flat shape is what the snapshot on disk is, and what an older provider sent.
const flat = { RawUpgrades: [], Upgrades: [], RegularCredits: 0 };
assert.equal(unwrapInventory(flat), flat, 'an account that is not wrapped is unwrapped anyway, which would drop the disk snapshot');

/*
 * And a HALF-WRITTEN inner string is refused rather than half-read. GEP reads
 * the game's memory while the game is writing it; returning null here is what
 * makes `route` refuse, `refreshOutcome` say `unusable`, and the floor open for
 * the retry - see the truncation case above.
 */
assert.equal(unwrapInventory({ InventoryJson: '{"RawUpgrades":[' }), null, 'a truncated account is half-parsed instead of refused');
assert.ok(!isPlausibleAccount(unwrapInventory({ InventoryJson: '{"RawUpgrades":[' })), 'a truncated account still passes as plausible');

// Shapes that are not the wrapper are handed back untouched, never crashed on.
for (const odd of [null, 'a raw string coerce could not parse', 42, [], { InventoryJson: 7 }] as const) {
  assert.equal(unwrapInventory(odd), odd, `unwrapInventory rewrote ${JSON.stringify(odd)} instead of leaving it for isPlausibleAccount to refuse`);
}
console.log('  ok    the account is unwrapped from the string GEP nests it in, and a truncated one is refused');
