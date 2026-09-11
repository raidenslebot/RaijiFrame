/**
 * Self-check for the typed account model.
 *
 * Hand-built fixtures only — these rules must hold whatever a real dump happens
 * to contain today.
 *
 * The rules that matter: the key lists stay exhaustive and single-shaped, the
 * legacy oid/date shapes still read, stacked resources sum instead of taking the
 * first row, the Forma trap bounds the level cap, and absent data yields null
 * rather than a plausible number.
 *
 * Run: node scripts/check-account-model.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EQUIPMENT_KEYS,
  SLOT_KEYS,
  DAILY_AFFILIATION_KEYS,
  EquipmentFeature,
  DUCATS_ITEM_TYPE,
  AYA_ITEM_TYPE,
  allEquipment,
  countBy,
  hasFeature,
  isMastered,
  itemXp,
  levelCap,
  mongoMillis,
  oidOf,
  pendingBuilds,
  recipeCount,
  resourceCount,
  type Equipment,
  type RawAccount,
} from '../src/data/account.ts';

const T0 = 1_700_000_000_000;

/** A tiny account: two frames, one rifle, stacked ducats, three foundry builds. */
const acc: RawAccount = {
  Suits: [
    { ItemType: '/Lotus/Powersuits/Excalibur', XP: 900_000, Features: EquipmentFeature.DOUBLE_CAPACITY },
    { ItemType: '/Lotus/Powersuits/Mag', XP: 0 },
  ],
  LongGuns: [{ ItemType: '/Lotus/Weapons/Braton', XP: 450_000, Polarized: 2 }],
  // DE has been seen to split a stack across rows; both must count.
  MiscItems: [
    { ItemType: DUCATS_ITEM_TYPE, ItemCount: 120 },
    { ItemType: DUCATS_ITEM_TYPE, ItemCount: 5 },
    { ItemType: AYA_ITEM_TYPE, ItemCount: 3 },
  ],
  Recipes: [{ ItemType: '/Lotus/Types/Recipes/Weapons/BratonBlueprint', ItemCount: 2 }],
  PendingRecipes: [
    { ItemId: { $oid: 'late' }, ItemType: '/late', CompletionDate: { $date: { $numberLong: String(T0 + 3600_000) } } },
    { ItemId: { $id: 'legacy' }, ItemType: '/ready', CompletionDate: { sec: (T0 - 60_000) / 1000 } },
    { ItemType: '/undated' },
  ],
  SuitBin: { Slots: 2, Extra: 10 },
  DailyAffiliation: 18_000,
};

function keyListsAreExhaustiveAndUnique() {
  // A duplicate would double-count in allEquipment; a missing key silently hides
  // a whole arsenal array from every panel that iterates these lists.
  assert.equal(EQUIPMENT_KEYS.length, 27, 'schema §3a lists exactly 27 equipment arrays');
  assert.equal(new Set(EQUIPMENT_KEYS).size, 27, 'no duplicates');
  assert.equal(new Set(SLOT_KEYS).size, 13);
  assert.equal(new Set(DAILY_AFFILIATION_KEYS).size, 14);

  // `Ships` is Ship[], not Equipment[] — including it would hand callers items
  // that have no XP, Features or Polarized at all.
  assert.ok(!(EQUIPMENT_KEYS as readonly string[]).includes('Ships'), 'Ships is a different shape and must stay out');
}

function legacyOidShapeStillReads() {
  // Pre-U19.5 payloads send `$id`. Dropping those would break the claim call for
  // exactly the accounts whose data is oldest.
  assert.equal(oidOf({ $oid: 'a' }), 'a');
  assert.equal(oidOf({ $id: 'b' }), 'b', 'the legacy key must still resolve');
  assert.equal(oidOf(undefined), null, 'an absent id is null, never a made-up string');
}

function legacyDateShapeStillReads() {
  // Same era, same risk: `{sec, usec}` is seconds, not milliseconds.
  assert.equal(mongoMillis({ $date: { $numberLong: '1700000000000' } }), 1_700_000_000_000);
  assert.equal(mongoMillis({ sec: 1_700_000_000 }), 1_700_000_000_000, 'seconds must be scaled to ms');
  assert.equal(mongoMillis(undefined), null);
  assert.equal(mongoMillis({ $date: { $numberLong: 'not-a-number' } }), null, 'garbage is null, not NaN');
}

function stacksSumRatherThanFirstMatch() {
  // Reading only the first matching row understates Ducats, and Ducats is the
  // number the relic panel spends against.
  assert.equal(resourceCount(acc, DUCATS_ITEM_TYPE), 125, 'split stacks must be summed');
  assert.equal(resourceCount(acc, AYA_ITEM_TYPE), 3, 'Aya (SchismKey) is not Ducats (PrimeBucks)');
  assert.equal(resourceCount(acc, '/Lotus/Nope'), 0, 'an unowned resource is 0');
  assert.equal(recipeCount(acc, '/Lotus/Types/Recipes/Weapons/BratonBlueprint'), 2);
}

function formaTrapBoundsTheCap() {
  // mastery-math §4.2: each Forma raises the cap by 2, so lifetime XP is not a
  // rank. floor(sqrt(5_000_000 / 500)) says rank 100; the honest cap is 30.
  assert.equal(levelCap({ XP: 5_000_000 }), 30, 'an unforma’d item caps at 30 however much XP it holds');
  assert.equal(levelCap({ Polarized: 3 }), 30, 'Forma cannot push a rank-30 item past its catalog cap');
  assert.equal(levelCap({ Polarized: 2 }, 40), 34, '30 + 2 per Forma');
  assert.equal(levelCap({ Polarized: 5 }, 40), 40);
  assert.equal(levelCap({ Polarized: 9 }, 40), 40, 'and never past the catalog cap');
  assert.equal(levelCap(undefined), 30, 'a missing item is the base cap, not a crash');
}

function masteryBoundaries() {
  // The exact thresholds decide whether the panel says "done" — off by one XP in
  // either direction is a wrong answer, not a rounding difference.
  assert.equal(isMastered({ XP: 0 }), false, 'rank 0 is not mastered');
  assert.equal(isMastered({ XP: 449_999 }), false, 'one XP short of rank 30 is not rank 30');
  assert.equal(isMastered({ XP: 450_000 }), true, 'weapons are 500 * 30²');
  assert.equal(isMastered({ XP: 899_999 }, { isFrame: true }), false);
  assert.equal(isMastered({ XP: 900_000 }, { isFrame: true }), true, 'frames are 1000 * 30²');
}

function rankFortyNeedsTheActualPolarizations() {
  // mastery-math §4.4: for a rank-40 item the XP threshold alone is not enough —
  // the item must really be 5x polarized, or the cap is not 40 yet.
  const shape = { maxLevelCap: 40 };
  assert.equal(isMastered({ XP: 800_000, Polarized: 5 }, shape), true, '500 * 40² with 5 Forma');
  assert.equal(isMastered({ XP: 799_999, Polarized: 5 }, shape), false);
  assert.equal(
    isMastered({ XP: 800_000, Polarized: 4 }, shape),
    false,
    'XP past the bar with only 4 Forma is still capped at 38',
  );
}

function featureBitsAreRead() {
  // There is no boolean for a potato anywhere in the payload; a wrong mask here
  // shows an orange catalyst on every item or none.
  const potato = acc.Suits?.[0];
  assert.equal(hasFeature(potato, EquipmentFeature.DOUBLE_CAPACITY), true);
  assert.equal(hasFeature(potato, EquipmentFeature.GILDED), false);
  assert.equal(hasFeature(acc.Suits?.[1], EquipmentFeature.DOUBLE_CAPACITY), false, 'no Features means no features');
  assert.equal(hasFeature(undefined, EquipmentFeature.GILDED), false);
}

function xpIsNeverNaN() {
  // A NaN XP propagates silently through every percentage on the panel.
  assert.equal(itemXp({ XP: Number.NaN }), 0, 'a non-finite XP reads as 0');
  assert.equal(itemXp({}), 0);
  assert.equal(itemXp(null), 0);
}

function foundryReportsHonestNulls() {
  // A build with no CompletionDate must not look finished — "ready" would send
  // the player to a foundry that has nothing to claim.
  const builds = pendingBuilds(acc, T0);
  assert.equal(builds.length, 3);

  assert.deepEqual(
    builds.map((b) => b.itemType),
    ['/ready', '/late', '/undated'],
    'soonest first, with the undated build last rather than first',
  );

  const [ready, late, undated] = builds;
  assert.equal(ready?.ready, true, 'a past CompletionDate is claimable');
  assert.equal(ready?.secondsRemaining, 0, 'and never negative');
  assert.equal(ready?.id, 'legacy', 'the legacy oid shape must survive into the claim id');

  assert.equal(late?.ready, false);
  assert.equal(late?.secondsRemaining, 3600);

  assert.equal(undated?.completesAt, null);
  assert.equal(undated?.secondsRemaining, null, 'unknown time is null, not 0');
  assert.equal(undated?.ready, false, 'unknown time is never ready');
  assert.equal(undated?.id, null);
}

function partialAccountIsSafe() {
  // GEP hands us whatever it managed to read; most arrays are usually missing.
  const owned = allEquipment(acc);
  assert.equal(owned.length, 3, 'only the arrays that are present contribute');
  assert.deepEqual(
    owned.map((o) => o.key),
    ['Suits', 'Suits', 'LongGuns'],
    'and each item is tagged with the array it came from',
  );

  const counts = countBy(acc);
  assert.equal(counts.Suits, 2);
  assert.equal(counts.Pistols, 0, 'an absent array counts 0, not undefined');
  assert.equal(Object.keys(counts).length, 27, 'every key is present so callers never index undefined');
}

function nullAccountIsSafe() {
  // The panel renders before GEP has ever pushed an inventory.
  assert.deepEqual(allEquipment(null), []);
  assert.deepEqual(pendingBuilds(undefined, T0), []);
  assert.equal(resourceCount(null, DUCATS_ITEM_TYPE), 0);
  assert.equal(recipeCount(null, '/anything'), 0);

  const counts = countBy(null);
  assert.equal(Object.keys(counts).length, 27);
  assert.ok(
    Object.values(counts).every((n) => n === 0),
    'no account means zero owned, never a guess',
  );
}

function emptyArraysAreNotMissingArrays() {
  // An account that genuinely owns no pistols must read the same as one whose
  // Pistols array was never sent — both are 0, neither is a crash.
  const empty: RawAccount = { Suits: [], MiscItems: [], PendingRecipes: [] };
  assert.deepEqual(allEquipment(empty), []);
  assert.equal(countBy(empty).Suits, 0);
  assert.equal(resourceCount(empty, DUCATS_ITEM_TYPE), 0);
  assert.deepEqual(pendingBuilds(empty, T0), []);
}

function itemsSurviveWithoutAnyFields() {
  // A truncated memory read can yield an object with nothing in it.
  const bare: Equipment = {};
  assert.equal(itemXp(bare), 0);
  assert.equal(levelCap(bare), 30);
  assert.equal(isMastered(bare), false, 'an unknown item is unmastered, not mastered by default');
  assert.equal(oidOf(bare.ItemId), null);
}

/**
 * EVERY FEATURE THAT CARRIES A KEY THE APP READS IS ACTUALLY REQUESTED.
 *
 * `setRequiredFeatures` is where the inventory comes from, and asking for the
 * wrong set fails in the worst way available: Overwolf answers `success: true`
 * with a non-empty `supportedFeatures` for ANY subset it recognises, so the
 * client sets its status to `connected`, reports itself healthy, and simply
 * never receives the data. Verified by dropping the list to `['game_info']` -
 * every gate in this repository stayed green.
 *
 * The requirement is DERIVED rather than pinned, because a hand-written list of
 * four strings is exactly the thing nobody revisits. `gep.ts` states the
 * mapping twice over and both are read here:
 *
 *   `route()`         the keys the client actually consumes
 *   `WarframeInfo`    which category declares each of those keys
 *
 * So: for every routed key, find the category that declares it, and require
 * that category. Today that is `match_info` (inventory, highlighted) and
 * `game_info` (username). `gep_internal` and `chat` carry nothing routed and
 * are not required by this - they are requested because the provider offers
 * them, which is a different decision and not one this check has an opinion on.
 */
function everyFeatureCarryingAReadKeyIsRequested(): void {
  const src = readFileSync(new URL('../src/core/gep.ts', import.meta.url), 'utf8');

  const list = /WARFRAME_FEATURES = \[([^\]]*)\]/.exec(src);
  assert.ok(list, 'WARFRAME_FEATURES is gone from gep.ts');
  const requested = new Set([...(list[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]));
  assert.ok(requested.size > 0, 'no features are requested at all, so no data will ever arrive');

  // The keys the client consumes, from `route`'s own switch.
  const routeBody = /private route\([\s\S]*?\n  \}/.exec(src);
  assert.ok(routeBody, 'route() is gone from gep.ts, or is no longer a single method');
  const routed = [...(routeBody[0] ?? '').matchAll(/case '(\w+)':/g)].map((m) => m[1] ?? '');
  assert.ok(routed.length >= 2, `only ${String(routed.length)} routed keys found; route() has changed shape`);

  // Which category declares each of them, from the typed info bag.
  const bag = /export interface WarframeInfo[\s\S]*?\n\}/.exec(src);
  assert.ok(bag, 'WarframeInfo is gone from gep.ts');
  const categories = [...(bag[0] ?? '').matchAll(/^\s*(\w+)\?:\s*\{([^}]*)\}/gm)].map(([, name, body]) => ({
    name: name ?? '',
    keys: [...(body ?? '').matchAll(/(\w+)\?:/g)].map((m) => m[1] ?? ''),
  }));

  const missing: string[] = [];
  for (const key of routed) {
    const owner = categories.find((c) => c.keys.includes(key));
    if (!owner) {
      missing.push(`the app reads "${key}" and WarframeInfo does not say which feature carries it`);
      continue;
    }
    if (!requested.has(owner.name)) missing.push(`"${key}" arrives under ${owner.name}, which is not in WARFRAME_FEATURES - it will never arrive`);
  }
  assert.deepEqual(missing, [], `the feature list does not cover what the app reads:\n        ${missing.join('\n        ')}`);
}

/**
 * A READ COUNTS AS DELIVERED ONLY IF SOMETHING WAS DELIVERED.
 *
 * `getInfo` answers `success: true` with a bag carrying nothing this client
 * routes while the provider has acknowledged its features but has not finished
 * its first memory read - and `res.res` is truthy for `{}`. Two places treated
 * that as data:
 *
 *   seed()     set `seeded = true`, which stops the bounded retry FOREVER. The
 *              symptom is written in that file already: "a player who opened
 *              the app and stood in their orbiter saw nothing at all, with no
 *              error and nothing to retry". The retry exists to fix that and
 *              was stopping itself on a success that delivered nothing.
 *   refresh()  consumed the whole minute-long floor, which exists precisely
 *              because a mission has just ended and the numbers are stale. Its
 *              own comment says "a call that returned nothing must not consume
 *              the window" - and that is what it meant to do.
 *
 * `ingest` now returns how many payloads it routed, so both ask the question
 * they mean rather than a proxy for it.
 */
function aReadCountsOnlyWhenSomethingArrived(): void {
  const src = readFileSync(new URL('../src/core/gep.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ');

  /*
   * THE VERDICT IS ABOUT THE INVENTORY KEY, and counting keys in general was
   * wrong in both directions - `gep_internal` routes and counts as a delivered
   * account, `highlighted` is refused on every frame nothing is hovered and its
   * hash is deliberately never recorded. `check-gentle` drives the four
   * verdicts; this pins the code that produces them.
   */
  assert.ok(
    /private ingest\(info: InfoBag\): \{ routed: number; rejected: number; inventory: InventoryRead \}/.test(src),
    'ingest no longer reports what became of the ACCOUNT, so a bag of provider metadata reads as a confirmed read',
  );
  assert.ok(/return \{ routed, rejected, inventory \};/.test(src), 'ingest no longer returns its verdict');
  assert.ok(/if \(key === 'inventory'\) inventory = 'same';/.test(src), 'an account that arrived unchanged is not counted as an answer, which is the ordinary visit');
  assert.ok(
    /if \(key === 'inventory'\) inventory = delivered \? 'fresh' : 'unusable';/.test(src),
    'a delivered account and a refused one are not told apart, so a truncated read confirms the loadout',
  );
  /*
   * AND ONE DEFINITION OF AN ACCOUNT. `route` used to accept any non-array
   * object, so a well-formed `{}` was emitted and counted as delivered - while
   * the STORE refused it (`setInventory` returns null) and the controller's
   * handler bailed out. The read was recorded as confirmed and the panel was
   * published from the old snapshot with no caveat at all.
   */
  assert.ok(/if \(!isPlausibleAccount\(inv\)\) \{/.test(src), 'the client and the store disagree about what an account is, and the client is the looser of the two');
  /*
   * AND THE ACCOUNT IS UNWRAPPED WHERE IT ARRIVES. `check-gentle` drives
   * `unwrapInventory` over every shape; this is the other half of that path,
   * and without it the helper can be correct and unreachable - which is what it
   * was for the whole life of the app. Measured live: `match_info.inventory`
   * parses to `{InventoryJson, MissionRewards}`, neither an account key, so
   * every read GEP sent was refused as carrying no account.
   */
  assert.ok(
    /const inv = unwrapInventory\(coerce<RawInventory>\(raw\)\) as RawInventory \| null;/.test(src),
    'THE APP DISCARDS EVERY READ GEP SENDS: route reads the wrapper instead of the account nested inside it',
  );

  const seed = /private seed\(\)[\s\S]*?\n  \}/.exec(src);
  assert.ok(seed, 'seed() is gone from gep.ts');
  assert.ok(
    /\.inventory : \('absent' as const\);/.test(seed[0]) && /refreshOutcome\(seeded\) !== 'nothing'/.test(seed[0]),
    'seed marks itself seeded on a bag that carried no ACCOUNT - the provider\'s own version block is enough - so the retry that exists for a player who sees nothing at all never runs',
  );
  /*
   * AND THE SEED IS A READ. Leaving it out of `answer()` put the defect it
   * exists to fix straight back on the most common path there is: at startup
   * the account is loaded from disk, the seed reads the same account out of the
   * game, `mergeInventory` returns the object it was given, and `inventoryAt`
   * stays null. Measured on the live app - a full account, 316 mod rows, both
   * clocks null - so the first modding screen of the session waited out its
   * whole settle window and then said the loadout could not be re-read.
   */
  assert.ok(/this\.answer\(\);/.test(seed[0]), 'a successful seed does not count as the game answering, so the first screen of every session waits for nothing');
  assert.ok(!/success && res\.res\) \{\s*this\.seeded/.test(seed[0]), 'seed is back to trusting the call rather than the payload');
  /*
   * AND IT DOES NOT GIVE UP WHILE THE GAME IS RUNNING. Measured on the live
   * app: the six exponential attempts span 62 seconds, Overwolf's provider took
   * longer than that on the launch that was watched, the seed stopped, and
   * nothing else asks - `refresh`'s callers are a mission ending and a modding
   * screen opening. The app sat with `gep: connected` and `accepted: 0`, every
   * number on screen from the snapshot on disk, while the provider was holding
   * a 247,972-character inventory nobody was asking for.
   *
   * Capped at the refresh floor, this is the same once-a-minute rate the class
   * grants every caller, it runs only while the app has NEVER had an account,
   * and it stops dead on the first one.
   */
  assert.ok(
    /Math\.min\(2_000 \* 2 \*\* \(this\.seedAttempts - 1\), GepClient\.REFRESH_FLOOR_MS\)/.test(seed[0]),
    'the seed backoff is unbounded or uncapped - either it gives up on the account, or it doubles past the floor for ever',
  );
  assert.ok(!/seed gave up/.test(seed[0]), 'THE APP STRANDS ITSELF ON THE DISK SNAPSHOT: the seed still stops asking while the game is running');
  assert.ok(/if \(this\.seeded \|\| !this\.connected\) return;/.test(seed[0]), 'nothing stops the retry when the account lands or the game goes away, which is what makes it a poll');

  const refresh = /refresh\(reason: string, urgent = false\)[\s\S]*?\n  \}/.exec(src);
  assert.ok(refresh, 'refresh() is gone from gep.ts');
  /*
   * THE TEST MOVED, AND SO DID ITS MEANING. This pinned the literal
   * `routed === 0`, which is what an empty read AND an unchanged one both look
   * like - `ingest` drops a byte-identical payload before it counts anything.
   * So the floor was cleared by the ordinary outcome of a refresh and held only
   * when the data had changed. `refreshOutcome` separates the three cases and
   * `check-gentle` DRIVES it; this stays a source check because the callback it
   * lives in cannot be reached without Overwolf.
   */
  assert.ok(/refreshOutcome\(read\.inventory\) === 'nothing'/.test(refresh[0]), 'the refresh no longer asks which of the three outcomes it got');
  assert.ok(
    /this\.ingest\(res\.res as InfoBag\) : \{ inventory: 'absent' as const \}/.test(refresh[0]),
    'a call that came back with nothing at all no longer reads as an absent account',
  );
  assert.ok(/lastRefreshAt = 0/.test(refresh[0]), 'a failed refresh no longer frees the window');
  /*
   * AND THE FLOOR HAS EXACTLY ONE WAY PAST IT, which is now literally one.
   *
   * `urgent` exists for the moment the panel would otherwise be WRONG: a
   * modding screen opening onto an account snapshot that may predate what the
   * player is wearing. That is what they photographed - "BROKEN WAR" titled
   * over an Ankyros - and it happens a few times an hour.
   *
   * IT USED TO BE THREE, and the other two were a mistake worth remembering.
   * The arsenal's `loadoutSaved` was read as an equip, so it took an urgent
   * read and a bounded retry chain behind it; driven over a real session, that
   * line fires 7 ms before the arsenal screen CLOSES whether or not anything
   * changed, so the pair of them ran on every arsenal exit - four reads in
   * three seconds for nothing. It is a gentle refresh now, behind the floor
   * like everything else. Any second caller has to be argued for here.
   */
  assert.ok(
    /if \(!urgent && now - this\.lastRefreshAt < GepClient\.REFRESH_FLOOR_MS\)/.test(refresh[0]),
    'the floor no longer has a single named exception',
  );
  const bg = readFileSync(new URL('../src/app/background.ts', import.meta.url), 'utf8');
  const urgent = [...bg.matchAll(/gep\.refresh\([^)]*, true\)/g)];
  assert.equal(
    urgent.length,
    1,
    `${String(urgent.length)} callers bypass the refresh floor. Exactly one is argued for - the modding screen opening. Any other has to be argued for here`,
  );
  assert.ok(
    /gep\.refresh\('a modding screen opened', true\)/.test(bg),
    'the one moment the panel is wrong without a read no longer asks for one',
  );
  /*
   * AND THE EXIT SAVE IS GENTLE. It may well be worth a read - the account
   * moves while the player is in the arsenal - but not an urgent one, and not
   * a retry chain.
   */
  const saved = /event\.type === 'loadoutSaved' && session\.phase === 'idle'\) ([^;]+);/.exec(bg);
  assert.ok(saved, 'the arsenal write is no longer handled at all');
  assert.ok(
    /^gep\.refresh\('the arsenal wrote a loadout'\)$/.test((saved[1] ?? '').trim()),
    `the exit save does "${(saved[1] ?? '').trim()}" - it fires on every arsenal exit, so anything more than a gentle read is a poll`,
  );
  assert.ok(!/settleRetries/.test(bg), 'the retry chain behind the exit save is back, which is four reads in three seconds for nothing');
}

/**
 * "PREVIOUS" HAS TO MEAN THE LAST TIME THEY PLAYED, NOT THE LAST PUSH.
 *
 * The delta highlighting is the one capability the spec argues the game cannot
 * offer: it has no memory of your last login and an overlay does. That rests
 * entirely on `account.previous` being the account as the player left it.
 *
 * It was rolled "whenever the account differs", which sounds equivalent and is
 * not, because of a fact one module away: `gep.ingest` hashes every payload and
 * drops the byte-identical ones BEFORE routing, so an account that reaches the
 * writer has always changed. The test was true on every push, the previous
 * generation was rolled away seconds before the player could be shown it, and
 * `ui/useDelta.ts` documented the opposite as a fact.
 *
 * Three things are pinned, because the fix fails differently at each: the
 * premise (gep really does dedup, so a difference test really is vacuous), the
 * gate (the roll is driven by a session starting), and the wiring (something
 * actually opens a session, or the generation rolls once and then never again).
 */
function previousMeansTheStartOfASession(): void {
  const strip = (p: string) =>
    readFileSync(new URL(p, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/.*/g, ' ');

  // The premise. Without this, rolling on a difference would be defensible.
  const gep = strip('../src/core/gep.ts');
  const ingest = /private ingest\(info: InfoBag\): \{ routed: number; rejected: number; inventory: InventoryRead \}[\s\S]*?\n  \}/.exec(gep);
  assert.ok(ingest, 'ingest is gone from gep.ts');
  assert.ok(
    /this\.hashes\.get\(id\) === fp[\s\S]*?continue;/.test(ingest[0]),
    'gep no longer drops byte-identical payloads, which is the whole reason a difference test cannot decide what a session is',
  );

  const snap = strip('../src/core/snapshot.ts');
  const write = /const existing = store\.get\(KEY\);[\s\S]*?\n      \};/.exec(snap);
  assert.ok(write, 'the snapshot write is gone from snapshot.ts');
  assert.ok(
    /if \(rollDue && prior !== undefined && !sameAccount\(prior, snapshot\)\)/.test(write[0]),
    'the previous generation rolls on a difference again: every push will roll it, so the delta will mean "since the last push" instead of "while you were away"',
  );
  assert.ok(/rollDue = false;/.test(write[0]), 'nothing closes the roll, so it will keep rolling for the rest of the session');
  assert.ok(/export function rollGenerationOnNextSave\(\)/.test(snap), 'there is no way left to say a session has begun');

  // And the wiring, or the generation rolls once per process and never again.
  const bg = strip('../src/app/background.ts');
  assert.ok(/rollGenerationOnNextSave/.test(bg), 'nothing tells the writer a session started, so the delta freezes at app launch');
  const start = /onStart: \([\s\S]*?\n  \},/.exec(bg);
  assert.ok(start, 'the game-start handler is gone from background.ts');
  assert.ok(
    /rollGenerationOnNextSave\(\)/.test(start[0]),
    'the roll is no longer opened when the game comes up, which is the moment that defines "while you were away"',
  );
}

const checks = [
  keyListsAreExhaustiveAndUnique,
  legacyOidShapeStillReads,
  legacyDateShapeStillReads,
  stacksSumRatherThanFirstMatch,
  formaTrapBoundsTheCap,
  masteryBoundaries,
  rankFortyNeedsTheActualPolarizations,
  featureBitsAreRead,
  xpIsNeverNaN,
  foundryReportsHonestNulls,
  partialAccountIsSafe,
  nullAccountIsSafe,
  emptyArraysAreNotMissingArrays,
  itemsSurviveWithoutAnyFields,
  everyFeatureCarryingAReadKeyIsRequested,
  aReadCountsOnlyWhenSomethingArrived,
  previousMeansTheStartOfASession,
];

let failed = 0;
for (const c of checks) {
  try {
    c();
    console.log(`  ok    ${c.name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${c.name}\n        ${(err as Error).message}`);
  }
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall account model rules hold');
// Set the code rather than calling process.exit(): exiting immediately can
// race stdout flushing on Windows and print a libuv assertion after the report.
process.exitCode = failed ? 1 : 0;
