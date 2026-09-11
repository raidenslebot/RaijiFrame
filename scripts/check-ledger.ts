/**
 * Self-check for the account ledger.
 *
 * WHAT THIS FILE IS ACTUALLY FOR
 * ──────────────────────────────
 * A ledger's failure mode is not a wrong number. It is a SILENT one: a series
 * that stopped being written, a store a wipe never reached, a truncated read
 * recorded as the player losing everything they own. None of those throw, none
 * of them look wrong in a diff, and every one of them is only visible weeks
 * later when the history is asked a question it cannot answer.
 *
 * So the checks below are mostly about COVERAGE and ABSENCE:
 *
 *   - the mapping from log events is TOTAL over what the parser emits, read out
 *     of `eelog.ts`'s own type union rather than from a list typed here. The
 *     defect this replaces is the one that motivated the whole ledger — the
 *     parser recognises seventeen kinds and the recorder branched on three, and
 *     nothing anywhere failed because of it.
 *   - an absent value is never read as zero, in EITHER direction, with every
 *     other watch set to its most favourable value so a sum could not pass.
 *   - the new object store is reachable from `clearHistory`, `exportJson` and
 *     `importJson`. A store added without those makes "wipe my data" a lie.
 *
 * Run: node scripts/check-ledger.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LEDGER_KINDS,
  NEVER_WATCH,
  WATCHES,
  diffAccount,
  ledgerFromEvent,
  ledgerFromItems,
  type LedgerEvent,
  type LedgerKind,
} from '../src/data/ledger.ts';
import { deltaInventory, diffInventory } from '../src/data/missionlog.ts';
import {
  headline,
  moments,
  ratePerHour,
  seriesShape,
  sessionBreak,
  timeline,
  topMovers,
  typicalMovement,
  unobserved,
} from '../src/data/ledger-read.ts';
import { DB_VERSION, clearHistory, exportJson, importJson, readLedger } from '../src/data/history-store.ts';
import type { LogEvent } from '../src/core/eelog.ts';
import type { RawAccount } from '../src/data/account.ts';

let checks = 0;
let failures = 0;

/*
 * Awaits the body. An `ok` that only CALLED an async check would see the
 * promise, not its rejection, and every asynchronous assertion below would pass
 * whatever it found - a gate that measures nothing, which is the defect this
 * whole file is built to catch.
 */
async function ok(label: string, fn: () => void | Promise<void>): Promise<void> {
  checks++;
  try {
    await fn();
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${label}\n        ${(err as Error).message.split('\n')[0]}`);
  }
}

const LEDGER_SRC = readFileSync(new URL('../src/data/ledger.ts', import.meta.url), 'utf8');
const STORE_SRC = readFileSync(new URL('../src/data/history-store.ts', import.meta.url), 'utf8');
const EELOG_SRC = readFileSync(new URL('../src/core/eelog.ts', import.meta.url), 'utf8');

// ── 1. the mapping is total over what the parser emits ───────────────────────

console.log('\nlog event coverage');

/** The event types `eelog.ts` declares, from its own union — never a list here. */
function parsedEventTypes(): string[] {
  const start = EELOG_SRC.indexOf('export type LogEvent');
  assert.notEqual(start, -1, 'the LogEvent union moved');
  const end = EELOG_SRC.indexOf('\n);', start);
  assert.notEqual(end, -1, 'the LogEvent union is not closed as expected');
  const body = EELOG_SRC.slice(start, end);
  return [...new Set([...body.matchAll(/\{ type: '([a-zA-Z]+)'/g)].map((m) => m[1]!))];
}

/** The cases `ledgerFromEvent` handles, from its own switch. */
function mappedEventTypes(): string[] {
  const start = LEDGER_SRC.indexOf('export function ledgerFromEvent');
  assert.notEqual(start, -1, 'ledgerFromEvent moved');
  const end = LEDGER_SRC.indexOf('default:', start);
  assert.notEqual(end, -1, 'ledgerFromEvent has no default case');
  return [...new Set([...LEDGER_SRC.slice(start, end).matchAll(/case '([a-zA-Z]+)'/g)].map((m) => m[1]!))];
}

const parsed = parsedEventTypes();
const mapped = mappedEventTypes();

await ok(`the parser declares more than a handful of event types (${parsed.length})`, () => {
  // Guards the extractor itself: a regex that silently matched nothing would
  // make every assertion below vacuously true.
  assert.ok(parsed.length >= 15, `only found ${parsed.length}`);
});

for (const type of parsed) {
  await ok(`'${type}' reaches the ledger`, () => {
    assert.ok(mapped.includes(type), `${type} is parsed and the ledger drops it`);
  });
}

for (const type of mapped) {
  await ok(`'${type}' is a type the parser actually emits`, () => {
    assert.ok(parsed.includes(type), `${type} is mapped but no longer parsed — stale case`);
  });
}

// ── 2. what the mapping produces ─────────────────────────────────────────────

console.log('\nevent mapping');

const AT = 1_700_000_000_000;

function map(e: LogEvent): LedgerEvent[] {
  return ledgerFromEvent(e, AT, 'Tenno');
}

await ok('every kind produced is a declared kind', () => {
  const samples: LogEvent[] = [
    { at: 1, type: 'login', username: 'Tenno' },
    { at: 2, type: 'sessionState', from: 'SS_STARTING', to: 'SS_STARTED' },
    { at: 3, type: 'loadTime', seconds: 2.2, waitingSeconds: 0.77 },
    { at: 4, type: 'squadMember', name: null, squadCount: 3 },
    { at: 5, type: 'syndicateXp', stage: 'base', amount: 1000 },
    { at: 6, type: 'missionEnd', success: true },
  ];
  for (const s of samples) {
    for (const e of map(s)) assert.ok(LEDGER_KINDS.includes(e.kind), `${e.kind} is not declared`);
  }
});

await ok('a load time becomes TWO series, not one merged number', () => {
  const rows = map({ at: 1, type: 'loadTime', seconds: 2.2, waitingSeconds: 0.77 });
  const names = rows.map((r) => r.name).sort();
  assert.deepEqual(names, ['load-seconds', 'load-waiting-seconds']);
  assert.equal(rows.find((r) => r.name === 'load-waiting-seconds')?.to, 0.77);
});

await ok('a session-state transition keeps BOTH states', () => {
  const [row] = map({ at: 1, type: 'sessionState', from: 'SS_WAITING_FOR_PLAYERS', to: 'SS_STARTED' });
  assert.equal(row?.from, 'SS_WAITING_FOR_PLAYERS');
  assert.equal(row?.to, 'SS_STARTED');
});

await ok('squadCount survives even when the name is withheld', () => {
  const rows = map({ at: 1, type: 'squadMember', name: null, squadCount: 4 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.name, 'squad-count');
  assert.equal(rows[0]?.to, 4);
});

await ok('an opted-in squad name is recorded alongside the count', () => {
  const rows = map({ at: 1, type: 'squadMember', name: 'Somebody', squadCount: 4 });
  assert.deepEqual(rows.map((r) => r.name).sort(), ['squad-count', 'squad-member']);
});

/*
 * PRIVACY. The login line is the only event carrying a string the user did not
 * ask to store, and the account field already holds the same name in a form a
 * wipe can find. A mapping that echoed it into a value would put it somewhere
 * `clearHistory` still reaches but nothing reads — which is how a field becomes
 * permanent by accident.
 */
await ok('the login username is never written into a value', () => {
  const rows = ledgerFromEvent({ at: 1, type: 'login', username: 'SECRET-NAME' }, AT, 'Tenno');
  for (const r of rows) {
    assert.notEqual(r.from, 'SECRET-NAME');
    assert.notEqual(r.to, 'SECRET-NAME');
    assert.notEqual(r.name, 'SECRET-NAME');
  }
});

/*
 * EVERY ARSENAL REGEX IS ANCHORED ON ITS LUA SCRIPT. `BuildLoadOut for <name>`
 * and `SendLoadOut: <name> loadout received` fire in the same second as the
 * modding-screen lines and carry the player's name. No fixture can prove a
 * regex will never drift onto a line that has not been written yet; the
 * source can prove the regex refuses to start anywhere but the script name.
 */
await ok('every arsenal regex in the parser is anchored on its Lua script', () => {
  // `matchLine` is the allowlist; `parseLine` is now the thin wrapper below it
  // that redacts everything on the way out. The patterns live in the former.
  const at = EELOG_SRC.indexOf('function matchLine(');
  assert.ok(at > 0, 'the allowlist matcher is gone from eelog.ts, so nothing here is being checked');
  const parse = EELOG_SRC.slice(at);
  const anchored = [
    ['upgradeSlot', /\/LoadOutRedux\\\.lua: _T\\\.upgradeItemSlot \\\(_Mod\\\):/],
    ['modInstalled', /\/DiegeticUpgradeCards\\\.lua: mod: /],
    ['modOwned', /\/DiegeticUpgradeCards\\\.lua: Multiple cards of type /],
    ['loadoutSaved', /\/LoadOutRedux\\\.lua: OnSaveLoadOutCompleteCommon\//],
    ['screen close', /\(DiegeticUpgradeCards\|LoadOutRedux\)\\\.lua: Background::GoToPreviousScreen/],
  ] as const;
  for (const [name, re] of anchored) {
    assert.ok(re.test(parse), `the ${name} regex no longer starts at its Lua script`);
  }
});

await ok('nothing in ledger.ts reads a raw log line', () => {
  // `parseLine` takes the line; every consumer downstream sees parsed fields
  // only. A ledger is exactly where that rule would rot first.
  for (const forbidden of ['.line', 'rawLine', '.content']) {
    assert.ok(!LEDGER_SRC.includes(forbidden), `ledger.ts mentions ${forbidden}`);
  }
});

// ── 3. absent is not zero ────────────────────────────────────────────────────

console.log('\nabsent is not zero');

/** An account with every watched field set high, so a gate has to stand alone. */
function account(over: Partial<RawAccount> = {}): RawAccount {
  return {
    RegularCredits: 9_999_999,
    PremiumCredits: 5000,
    PlayerLevel: 30,
    DailyFocus: 250_000,
    TradesRemaining: 6,
    Affiliations: [{ Tag: 'CetusSyndicate', Standing: 99_000 }],
    FocusXP: { AP_POWER: 1_000_000 },
    Missions: [{ Tag: 'SolNode1', Completes: 12 }],
    XPInfo: [{ ItemType: '/Lotus/Powersuits/Excalibur', XP: 500_000 }],
    ...over,
  } as RawAccount;
}

await ok('no prior observation yields no events at all', () => {
  assert.deepEqual(diffAccount(null, account(), AT, 'Tenno'), []);
});

await ok('a first sighting of a scalar is not a change from zero', () => {
  const before = account({ PremiumCredits: undefined });
  const after = account({ PremiumCredits: 5000 });
  const rows = diffAccount(before, after, AT, 'Tenno');
  assert.equal(rows.find((r) => r.name === 'platinum'), undefined);
});

await ok('a first sighting inside a keyed collection is not a change from zero', () => {
  const before = account({ Affiliations: [{ Tag: 'CetusSyndicate', Standing: 99_000 }] });
  const after = account({
    Affiliations: [
      { Tag: 'CetusSyndicate', Standing: 99_000 },
      { Tag: 'SolarisSyndicate', Standing: 22_000 },
    ],
  });
  const rows = diffAccount(before, after, AT, 'Tenno');
  assert.equal(rows.length, 0, `unexpected: ${rows.map((r) => r.name).join(', ')}`);
});

await ok('a truncated read does not report the whole collection as earned', () => {
  // Every OTHER watch is identical, so nothing else can mask the result.
  const before = account({ Affiliations: [] });
  const after = account();
  assert.deepEqual(diffAccount(before, after, AT, 'Tenno'), []);
});

await ok('a truncated AFTER reports nothing, rather than a total loss', () => {
  const before = account();
  const after = account({ Affiliations: [] });
  assert.deepEqual(diffAccount(before, after, AT, 'Tenno'), []);
});

await ok('a real move is still reported, with its delta', () => {
  const rows = diffAccount(account(), account({ PremiumCredits: 5200 }), AT, 'Tenno');
  const plat = rows.find((r) => r.name === 'platinum');
  assert.equal(plat?.from, 5000);
  assert.equal(plat?.to, 5200);
  assert.equal(plat?.by, 200);
});

await ok('a keyed move names the entry it belongs to', () => {
  const after = account({ Affiliations: [{ Tag: 'CetusSyndicate', Standing: 100_000 }] });
  const rows = diffAccount(account(), after, AT, 'Tenno');
  assert.deepEqual(
    rows.map((r) => r.name),
    ['standing:CetusSyndicate'],
  );
  assert.equal(rows[0]?.by, 1000);
});

await ok('a loss is reported as a negative delta, not skipped', () => {
  const rows = diffAccount(account(), account({ RegularCredits: 9_000_000 }), AT, 'Tenno');
  const credits = rows.find((r) => r.name === 'credits');
  assert.equal(credits?.by, -999_999);
});

// ── 4. the watch table ───────────────────────────────────────────────────────

console.log('\nthe watch table');

await ok('every watch has a unique name', () => {
  const names = WATCHES.map((w) => w.name);
  assert.equal(new Set(names).size, names.length, `duplicate in: ${names.join(', ')}`);
});

await ok(`the table covers the account broadly (${WATCHES.length} watches)`, () => {
  /*
   * A FLOOR, not a target. It started at 13 and a survey of `account.ts` found
   * roughly seventy more fields carrying a moving number - so this exists to
   * fail if the table is ever quietly trimmed back toward the handful that was
   * easy, which is the direction these things drift.
   */
  assert.ok(WATCHES.length >= 70, `only ${WATCHES.length}`);
});

await ok('every watch tolerates an empty account', () => {
  const empty = {} as RawAccount;
  for (const w of WATCHES) {
    const v = w.read(empty);
    if (w.kind === 'keyed') assert.equal((v as Map<string, number>).size, 0, `${w.name} invented entries`);
    else assert.equal(v, undefined, `${w.name} returned ${String(v)} for an empty account`);
  }
});

await ok('every watch tolerates an account of nulls and wrong types', () => {
  /*
   * GEP hands over whatever the game wrote. A watch that assumes its field is
   * an array, or that a member is a number, throws INSIDE the inventory handler
   * - which would take down the recording of every other field with it.
   */
  const hostile = {
    MiscItems: null,
    Boosters: [{}, { ItemType: 'x' }, { ItemType: 'y', ExpiryDate: 'soon' }],
    Affiliations: 'not an array',
    QuestKeys: [{ ItemType: 'q', Progress: null }],
    PlayerSkills: { LPP_SPACE: 'four' },
    InfestedFoundry: { Resources: [{ ItemType: 'r' }] },
    Nemesis: null,
    FusionPoints: '900',
  } as unknown as RawAccount;
  for (const w of WATCHES) {
    // Must not throw. A watch that throws here takes the whole inventory
    // handler with it, and every other field stops being recorded.
    w.read(hostile);
  }
  /*
   * And then the thing that actually matters: what ARRIVES. A closure may hand
   * back a string; what must never happen is that string reaching an event,
   * where `to - from` is NaN and NaN in an append-only store is permanent.
   */
  const good = account();
  for (const e of diffAccount(hostile, good, AT, 'Tenno')) {
    assert.equal(typeof e.at, 'number', `${e.name} has a non-numeric time`);
    if (e.by !== null) assert.ok(Number.isFinite(e.by), `${e.name} recorded ${String(e.by)}`);
    for (const side of [e.from, e.to]) {
      assert.ok(side === null || typeof side === 'string' || Number.isFinite(side), `${e.name} carries ${String(side)}`);
    }
  }
});

await ok('every watch reads numbers, never strings', () => {
  const a = account();
  for (const w of WATCHES) {
    if (w.kind === 'keyed') {
      for (const [, v] of w.read(a)) assert.equal(typeof v, 'number', `${w.name} is not numeric`);
    } else {
      const v = w.read(a);
      assert.ok(v === undefined || typeof v === 'number', `${w.name} is not numeric`);
    }
  }
});

await ok('every declared kind is named by the differ, not caught by an else', () => {
  /*
   * Adding a kind must break the BUILD, not the runtime. The keyed path was
   * once the implicit `else`, so a new kind fell into it and threw inside the
   * inventory handler - which is where this check came from.
   */
  const kinds = new Set(WATCHES.map((w) => w.kind));
  const src = LEDGER_SRC.slice(LEDGER_SRC.indexOf('export function diffAccount'));
  for (const k of kinds) assert.ok(src.includes(`'${k}'`), `diffAccount never names '${k}'`);
  assert.ok(src.includes(': never'), 'nothing forces the union to stay exhaustive');
});

/*
 * NUMBERS THAT ARE NOT MEASUREMENTS. `account.ts` states three times that these
 * exceed MAX_SAFE_INTEGER and arrive already corrupted by `JSON.parse`. A watch
 * on one emits a change whenever the same value is re-read differently -
 * fabricated history, indistinguishable from the real kind, in the one store
 * whose whole worth is being trustworthy about the past.
 */
await ok('no watch reads a number that JSON.parse has already corrupted', () => {
  const table = LEDGER_SRC.slice(LEDGER_SRC.indexOf('export const WATCHES'), LEDGER_SRC.indexOf('// \u2500\u2500 diffing an account'));
  const code = table.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const banned of NEVER_WATCH) {
    assert.ok(!code.includes(banned), `a watch accessor names ${banned}`);
  }
});

await ok('the never-watch list is not empty, and is read from the module', () => {
  // Guards the check above: an empty list would make it vacuous.
  assert.ok(NEVER_WATCH.length >= 4, `${NEVER_WATCH.length} entries`);
});

/*
 * The affinity trap. `Equipment.XP` resets to zero on every Forma, so a watch on
 * it emits a large NEGATIVE on the exact occasion the player invested most, and
 * anything summing the series reads it as loss rather than expenditure. Mastery
 * is answered by `mastery-xp`, which never resets.
 */
await ok('per-instance affinity is not watched, because Forma resets it', () => {
  assert.equal(WATCHES.find((w) => w.name === 'item-affinity'), undefined);
  assert.ok(WATCHES.some((w) => w.name === 'forma'), 'the monotone half should be watched');
  assert.ok(WATCHES.some((w) => w.name === 'mastery-xp'), 'mastery must still be covered');
});

/*
 * A booster expiry is UNIX SECONDS on the account and milliseconds everywhere
 * else in this app. Mixed units in one store is a thousand-fold error waiting
 * for whoever plots it, and it would look entirely plausible until they did.
 */
await ok('a booster expiry is converted to milliseconds', () => {
  const w = WATCHES.find((x) => x.name === 'booster-expires');
  assert.ok(w && w.kind === 'keyed');
  const seconds = 1_700_000_000;
  const got = (w.read({ Boosters: [{ ItemType: 'b', ExpiryDate: seconds }] } as unknown as RawAccount)).get('b');
  assert.equal(got, seconds * 1000, `${String(got)} is not milliseconds`);
});

// ── 5. item deltas ───────────────────────────────────────────────────────────

console.log('\nitem deltas');

function withItems(items: Array<{ ItemType: string; ItemCount: number }>, over: Partial<RawAccount> = {}) {
  return { MiscItems: items, ...over } as RawAccount;
}

await ok('a spend is reported, where diffInventory drops it', () => {
  const before = withItems([{ ItemType: '/Lotus/Forma', ItemCount: 3 }]);
  const after = withItems([{ ItemType: '/Lotus/Forma', ItemCount: 2 }]);
  assert.deepEqual(diffInventory(before, after), [], 'the loot list must stay positive-only');
  const delta = deltaInventory(before, after);
  assert.equal(delta.length, 1);
  assert.equal(delta[0]?.count, -1);
});

await ok('a stack consumed to nothing is a spend, not an absence', () => {
  const before = withItems([
    { ItemType: '/Lotus/Forma', ItemCount: 1 },
    { ItemType: '/Lotus/Cipher', ItemCount: 4 },
  ]);
  const after = withItems([{ ItemType: '/Lotus/Cipher', ItemCount: 4 }]);
  const forma = deltaInventory(before, after).find((d) => d.itemType === '/Lotus/Forma');
  assert.equal(forma?.count, -1);
});

/*
 * The mirror of the guard that already existed. Reporting losses at all is what
 * makes an absent `after` category dangerous: it used to be unreachable, because
 * only `after`'s keys were ever walked.
 */
await ok('a truncated AFTER does not report the collection as spent', () => {
  const before = withItems([{ ItemType: '/Lotus/Forma', ItemCount: 3 }]);
  const after = withItems([]);
  assert.deepEqual(deltaInventory(before, after), []);
});

await ok('a truncated BEFORE does not report the collection as looted', () => {
  const before = withItems([]);
  const after = withItems([{ ItemType: '/Lotus/Forma', ItemCount: 3 }]);
  assert.deepEqual(deltaInventory(before, after), []);
});

/*
 * Found by watching a real push, not by reading the code: platinum arrived as
 * BOTH a `spend` item event and a `counter`, because `diffInventory` synthesises
 * currency pseudo-items so a loot list can mention them. Two rows for one fact
 * is how a series gets summed twice.
 */
await ok('a category the watch table covers is recorded once, not twice', () => {
  /*
   * Found twice, both times by watching a real push rather than by reading the
   * code: first platinum, then - when the watch table was widened to the whole
   * account - resources and blueprints. Every category the watches carry with
   * BALANCES must be absent from the delta path, or one change is two rows and
   * anything summing the series double-counts it.
   */
  const rows = ledgerFromItems(
    [
      { itemType: '@platinum', count: -20, category: 'currency' },
      { itemType: '/Lotus/Forma', count: -1, category: 'resource' },
      { itemType: '/Lotus/Bp', count: 1, category: 'blueprint' },
      { itemType: '/Lotus/Braton', count: 1, category: 'equipment' },
    ],
    AT,
    'Tenno',
  );
  assert.deepEqual(
    rows.map((r) => r.name),
    ['equipment:/Lotus/Braton'],
    'a category carried by a watch is still going through the delta path',
  );
  // And the ones excluded here must actually BE watched, or the fact is lost.
  for (const name of ['resource', 'blueprint', 'platinum', 'mod-stack', 'mod-owned']) {
    assert.ok(WATCHES.some((w) => w.name === name), `nothing watches ${name}`);
  }
});

await ok('gains and spends land in different kinds', () => {
  const rows = ledgerFromItems(
    [
      { itemType: '/a', count: 3, category: 'equipment' },
      { itemType: '/b', count: -1, category: 'equipment' },
    ],
    AT,
    'Tenno',
  );
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['gain', 'spend'],
  );
  assert.equal(rows[1]?.by, -1, 'the delta belongs in `by`');
  assert.equal(rows[1]?.to, null, '`to` would read as an absolute count');
});

// ── 6. the store is wired everywhere it has to be ────────────────────────────

console.log('\nstore wiring');

/** The body of one exported function in history-store.ts. */
function body(name: string): string {
  const start = STORE_SRC.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} moved`);
  const next = STORE_SRC.indexOf('\nexport ', start + 1);
  return STORE_SRC.slice(start, next === -1 ? undefined : next);
}

/**
 * Comments stripped, because the first version of this check passed on a
 * `clearHistory` whose ledger line had been DELETED — the word "ledger"
 * survived in the doc comment above it and in `memoryLedger.length = 0`. A gate
 * that greps for a word matches the prose explaining why the word should be
 * there, which is the most comfortable way for a check to measure nothing.
 */
function code(name: string): string {
  return body(name)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

for (const [fn, token] of [
  ['clearHistory', 'objectStore(LEDGER)'],
  ['exportJson', 'readLedger('],
  ['importJson', 'appendLedger('],
] as const) {
  await ok(`${fn} reaches the ledger store`, () => {
    assert.ok(
      code(fn).includes(token),
      `${fn} does not call ${token} — a new store is invisible to it`,
    );
  });
}

await ok('the schema version matches the number of migration blocks', () => {
  // Anchored to the start of a line, so the `// Future: if (oldVersion < n)`
  // comment that documents the next block is not counted as one.
  const blocks = [...STORE_SRC.matchAll(/^\s*if \(oldVersion < (\d+)\)/gm)].map((m) => Number(m[1]));
  assert.equal(blocks.length, DB_VERSION, `${blocks.length} blocks for version ${DB_VERSION}`);
  assert.deepEqual(
    blocks,
    blocks.slice().sort((a, b) => a - b),
    'migration blocks are out of order',
  );
});

await ok('no migration deletes a store', () => {
  assert.ok(!STORE_SRC.includes('deleteObjectStore'), 'a migration would throw away the user history');
});

// ── 7. round trip through the degraded path ──────────────────────────────────

console.log('\nimport round trip');

/*
 * Node has no IndexedDB, so this exercises the MEMORY fallback end to end —
 * which is the path a private window takes, and the one nothing had ever run.
 * It also tests the value that ARRIVES at a reader rather than what a validator
 * returns: `readLedger` is what a panel would call.
 */
const backup = JSON.stringify({
  format: 'raijiframe-mission-history',
  missions: [],
  ledger: [
    { account: 'Tenno', at: AT, kind: 'counter', name: 'platinum', from: 10, to: 20, by: 10 },
    { account: 'Tenno', at: AT + 1, kind: 'spend', name: 'resource:/Lotus/Forma', from: null, to: null, by: -1 },
    { account: 'Tenno', at: 'not-a-number', kind: 'counter', name: 'platinum', from: 1, to: 2, by: 1 },
    { account: 'Tenno', at: AT + 2, kind: 'not-a-kind', name: 'platinum', from: 1, to: 2, by: 1 },
    { account: 'Tenno', at: AT + 3, kind: 'counter', name: '', from: 1, to: 2, by: 1 },
  ],
});

const result = await importJson(backup);

await ok('malformed ledger rows are dropped, not repaired', () => {
  assert.equal(result.importedLedger, 2, `imported ${result.importedLedger}`);
});

await ok('the imported events are readable back', async () => {
  const rows = await readLedger({ account: 'Tenno' });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.name, 'resource:/Lotus/Forma', 'newest first');
});

await ok('a family prefix selects the whole family', async () => {
  assert.equal((await readLedger({ name: 'resource:' })).length, 1);
  assert.equal((await readLedger({ name: 'resource:/Lotus/Forma' })).length, 1);
  assert.equal((await readLedger({ name: 'resource' })).length, 0, 'an exact name must not match a family');
});

await ok('a kind filter reaches the memory fallback', async () => {
  assert.equal((await readLedger({ kind: 'spend' })).length, 1);
});

await ok('a time window is half-open, so consecutive windows never overlap', async () => {
  assert.equal((await readLedger({ from: AT, to: AT + 1 })).length, 1);
});

await ok('a backup written before the ledger existed is not an error', async () => {
  const old = JSON.stringify({ format: 'raijiframe-mission-history', missions: [] });
  const r = await importJson(old);
  assert.equal(r.error, null);
  assert.equal(r.importedLedger, 0);
});

/*
 * The two operations a new object store silently breaks, tested on the value
 * that ARRIVES rather than on the source that produces it. Both ran green
 * against a `clearHistory` that had stopped clearing and an `exportJson` that
 * had stopped exporting, back when this section was a grep.
 *
 * Last, because the wipe is destructive to everything above it.
 */
await ok('a backup carries the ledger', async () => {
  const dump = JSON.parse(await exportJson()) as { ledger?: unknown[] };
  assert.ok(Array.isArray(dump.ledger), 'the export has no ledger at all');
  assert.equal(dump.ledger?.length, 2, `exported ${dump.ledger?.length} events`);
});

await ok('a wipe reaches the ledger', async () => {
  assert.equal((await readLedger()).length, 2, 'nothing to wipe — the test is vacuous');
  await clearHistory();
  assert.deepEqual(await readLedger(), [], 'the ledger survived a wipe the user asked for');
});

// ── 8. reading it back ───────────────────────────────────────────────────────

console.log('\nsessions and series');

const MIN = 60_000;

/** Events at the given offsets in minutes from a fixed origin. */
function at(minutes: number[], name = 'credits'): LedgerEvent[] {
  return minutes.map((m, i) => ({
    account: 'Tenno',
    at: AT + m * MIN,
    seq: i,
    kind: 'counter' as const,
    name,
    from: i * 100,
    to: (i + 1) * 100,
    by: 100,
  }));
}

/*
 * Two clear sittings an hour apart, with events a couple of minutes apart
 * inside each. The cliff is 30x, which is the shape the measurement exists to
 * find - and every assertion below would also pass on a hardcoded 30 minutes,
 * so the ones that matter are the two after it.
 */
const twoSittings = at([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 80, 82, 84, 86, 88, 90, 92, 94]);

await ok('the session break is measured from the gaps, not assumed', () => {
  const b = sessionBreak(twoSittings);
  assert.equal(b.measured, true, b.note);
  assert.ok(b.minutes > 2 && b.minutes < 62, `${b.minutes} min is not between the two populations`);
});

/*
 * The assertion above passes on a hardcoded 30 minutes, because 30 happens to
 * sit between this fixture's two populations - which is exactly how a constant
 * survives a test written around one dataset. The property a constant CANNOT
 * have is tracking the data: tighter play with a tighter cliff must yield a
 * smaller threshold.
 */
await ok('the break MOVES with the data — a constant cannot pass this', () => {
  const tight = sessionBreak(at([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 12, 12.5, 13, 13.5, 14, 14.5]));
  const loose = sessionBreak(at([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 400, 405, 410, 415, 420, 425]));
  assert.equal(tight.measured, true, tight.note);
  assert.equal(loose.measured, true, loose.note);
  assert.ok(
    loose.minutes > tight.minutes * 3,
    `${loose.minutes.toFixed(1)} is not meaningfully above ${tight.minutes.toFixed(1)} — the threshold is not reading the data`,
  );
});

await ok('too few gaps is reported as unmeasured, with the sample size', () => {
  const b = sessionBreak(at([0, 5, 10]));
  assert.equal(b.measured, false);
  assert.equal(b.sample, 2);
  assert.ok(b.note.includes('2 gaps'), b.note);
});

/*
 * The one that stops the measurement inventing a verdict. An unbroken stretch
 * has no cliff, and a "largest ratio" over noise will always return SOMETHING -
 * so without the floor this would split one sitting into two and report it as
 * measured.
 */
await ok('an unbroken stretch does not get split by noise', () => {
  const even = at([0, 3, 6, 9, 13, 16, 20, 23, 27, 30, 34, 37]);
  const b = sessionBreak(even);
  assert.equal(b.measured, false, `claimed a break at ${b.minutes} min: ${b.note}`);
  assert.equal(timeline(even).sessions.length, 1);
});

await ok('simultaneous events are one moment, not a gap of zero', () => {
  /*
   * A run writes a dozen counters in the same millisecond. Counted as gaps,
   * those zeros make the very first ratio Infinity — so the break is reported
   * as MEASURED with a threshold of zero minutes, and every single event
   * becomes its own session. Asserting `measured === true` alone passes on that
   * catastrophe, which is why the threshold itself is asserted here.
   */
  const burst: LedgerEvent[] = Array.from({ length: 12 }, (_, i) => ({
    account: 'Tenno', at: AT, seq: i, kind: 'counter' as const,
    name: `s${i}`, from: 0, to: 1, by: 1,
  }));
  const withBurst = [...burst, ...twoSittings];
  const b = sessionBreak(withBurst);
  assert.equal(b.measured, true, b.note);
  assert.ok(b.minutes > 1, `a break of ${b.minutes} min makes every event its own session`);
  assert.equal(timeline(withBurst).sessions.length, 2, 'the burst fragmented the timeline');
});

await ok('the timeline splits into sessions and keeps the silence between them', () => {
  const tl = timeline(twoSittings);
  assert.equal(tl.sessions.length, 2, `${tl.sessions.length} sessions: ${tl.break.note}`);
  assert.equal(tl.silences.length, 1);
  assert.ok(tl.silences[0]!.minutes > 55, `${tl.silences[0]!.minutes} min of silence`);
});

/*
 * The rate's denominator. A player with 32 minutes of events across a fortnight
 * has played 32 minutes; dividing by the fortnight reports a rate a hundred
 * times too low and calls it measured.
 */
await ok('a rate divides by observed play, never by the wall clock', () => {
  const tl = timeline(twoSittings);
  const spanMinutes = (tl.to! - tl.from!) / MIN;
  assert.ok(tl.observedMinutes < spanMinutes / 2, `${tl.observedMinutes} vs ${spanMinutes}`);
  const r = ratePerHour('credits', tl);
  assert.ok(r !== null);
  assert.equal(r.by, 1800, 'eighteen events of 100, across both sittings');
  const wallClockRate = (r.by / spanMinutes) * 60;
  assert.ok(r.perHour! > wallClockRate * 2, `${r.perHour} is not distinguishable from ${wallClockRate}`);
});

await ok('a series nothing observed has no rate, rather than a rate of zero', () => {
  assert.equal(ratePerHour('platinum', timeline(twoSittings)), null);
});

/*
 * THE STATE EVERY ACCOUNT IS IN ON ITS FIRST PUSH, and the one moment a reader
 * is deciding whether to trust the panel. The header divided a duration by a
 * span of zero and rendered "now watched, out of now" - two words that are each
 * correct and together mean nothing.
 */
await ok('a record of one moment reports no span, rather than a nonsensical one', () => {
  const one: LedgerEvent[] = [
    { account: 'T', at: AT, seq: 1, kind: 'counter', name: 'credits', from: 1, to: 2, by: 1 },
    { account: 'T', at: AT, seq: 2, kind: 'counter', name: 'platinum', from: 9, to: 8, by: -1 },
  ];
  const tl = timeline(one);
  assert.equal(tl.sessions.length, 1);
  assert.equal(tl.observedMinutes, 0, 'one moment has no duration');
  assert.equal(tl.to! - tl.from!, 0, 'and no span');
  assert.deepEqual(tl.silences, [], 'and nothing between');
  // The panel branches on this being under a minute; if the timeline ever
  // reported otherwise, the nonsense sentence would come back.
  assert.ok((tl.to! - tl.from!) / 60_000 < 1);
});

await ok('an empty ledger is an empty timeline, not a crash', () => {
  const tl = timeline([]);
  assert.deepEqual(tl.sessions, []);
  assert.equal(tl.from, null);
  assert.equal(tl.observedMinutes, 0);
});

/*
 * A series with no magnitude is not a series that did not move. Sorting a
 * `session-state` transition as 0 would file it among the things that stayed
 * still, which is the additive-penalty mistake in a different costume.
 */
await ok('a series with no delta ranks below one that moved by nothing', () => {
  const rows: LedgerEvent[] = [
    { account: 'Tenno', at: AT, seq: 1, kind: 'session', name: 'session-state', from: 'SS_STARTING', to: 'SS_STARTED', by: null },
    { account: 'Tenno', at: AT + MIN, seq: 2, kind: 'counter', name: 'credits', from: 100, to: 100, by: 0 },
  ];
  const movers = topMovers(rows);
  assert.equal(movers[0]?.name, 'credits');
  assert.equal(movers[1]?.name, 'session-state');
  assert.equal(movers[1]?.by, null, 'a missing magnitude must not become 0');
});

await ok('a truncated mover list still reports every row it kept', () => {
  const rows = [...at([0], 'a'), ...at([1], 'b'), ...at([2], 'c')];
  assert.equal(topMovers(rows, 2).length, 2);
  assert.equal(topMovers(rows, 0).length, 3, 'a limit of 0 must mean everything');
});

// ── 9. what was unusual, rather than what was biggest ────────────────────────

console.log('\nheadlines');

/** One event moving `name` by `by`, at minute `m`. */
function move(m: number, name: string, by: number, seq: number) {
  return { account: 'Tenno', at: AT + m * MIN, seq, kind: 'counter' as const, name, from: 0, to: by, by };
}

/*
 * Four sittings a day apart. `credits` moves in tens of thousands every time;
 * `platinum` moves by 20 every time except the last, where it moves by 400.
 * The largest number in that last session is credits, by three orders of
 * magnitude. The interesting one is platinum.
 */
const DAYM = 24 * 60;
const fourDays: LedgerEvent[] = [];
let seqN = 0;
[0, 1, 2, 3].forEach((d) => {
  fourDays.push(move(d * DAYM, 'credits', 50_000 + d * 1000, seqN++));
  fourDays.push(move(d * DAYM + 2, 'platinum', d === 3 ? -400 : -20, seqN++));
});

const fourTl = timeline(fourDays);
const typical = typicalMovement(fourTl);

await ok('four sittings a day apart are four sessions', () => {
  assert.equal(fourTl.sessions.length, 4, fourTl.break.note);
});

await ok('a typical movement needs several sessions before it means anything', () => {
  assert.equal(typical.get('credits') !== undefined, true);
  const thin = typicalMovement(timeline(fourDays.slice(0, 4)));
  assert.equal(thin.get('credits'), undefined, 'two sessions is not a distribution');
});

/*
 * The whole point. Ranking incomparable series by magnitude picks credits every
 * single time and tells the reader nothing; the answer wanted is the series
 * that moved unusually FOR ITSELF.
 */
await ok('the headline is what was unusual, not what was largest', () => {
  const last = fourTl.sessions[fourTl.sessions.length - 1]!;
  const h = headline(last, typical);
  assert.equal(h?.row.name, 'platinum', `headlined ${String(h?.row.name)}`);
  assert.equal(h?.why, 'unusual');
  assert.ok((h?.times ?? 0) > 15, `only ${String(h?.times)}x its typical`);
});

/*
 * FOUND BY RENDERING IT, not by reading the code. Without a floor the argmax of
 * a set clustered at 1.0 is still returned, so the panel headlined a session
 * with "platinum moved 1.0x its own typical session" - a sentence that refutes
 * itself. Nothing threw, and the number was correct.
 */
await ok('a session where nothing stood out says so, instead of headlining the most typical thing', () => {
  const flat = fourTl.sessions[1]!;
  const h = headline(flat, typical);
  assert.equal(h?.why, 'nothing-unusual', `claimed ${String(h?.why)} at ${String(h?.times)}x`);
  assert.equal(h?.times, null, 'a fallback headline must not carry a multiple that implies it was unusual');
});

await ok('with no history at all the headline says which question it answered', () => {
  const oneTl = timeline([move(0, 'credits', 5, 0), move(1, 'platinum', 2, 1)]);
  const h = headline(oneTl.sessions[0]!, typicalMovement(oneTl));
  assert.equal(h?.why, 'no-history');
  assert.equal(h?.times, null);
});

await ok('a series whose typical movement is zero is not infinitely surprising', () => {
  const still: LedgerEvent[] = [];
  let n = 0;
  [0, 1, 2, 3].forEach((d) => {
    still.push(move(d * DAYM, 'credits', 0, n++));
    still.push(move(d * DAYM + 2, 'platinum', d === 3 ? -400 : -20, n++));
  });
  const tl2 = timeline(still);
  assert.equal(typicalMovement(tl2).get('credits'), undefined, 'a median of 0 must not become a divisor');
  assert.equal(headline(tl2.sessions[3]!, typicalMovement(tl2))?.row.name, 'platinum');
});

await ok('an empty session has no headline, rather than a headline about nothing', () => {
  assert.equal(headline({ from: 0, to: 0, count: 0, minutes: 0, byKind: {}, net: [] }, typical), null);
});

// ── 10. the shape of a series ─────────────────────────────────────

console.log('\nseries shape');

await ok('a line breaks where nobody was watching', () => {
  /*
   * THE ONE THING THAT MAKES THIS NOT A GENERIC SPARKLINE. Joining samples
   * across a two-day absence draws a claim the data cannot support: that the
   * value moved smoothly from here to there while the app was closed.
   */
  const two = at([0, 2, 4, 6, 200, 202, 204]);
  const shape = seriesShape(two, 'credits', 30);
  assert.equal(shape.segments.length, 2, `${shape.segments.length} segments`);
  assert.equal(shape.segments[0]?.length, 4);
  assert.equal(shape.segments[1]?.length, 3);
});

await ok('one unbroken sitting is one segment', () => {
  assert.equal(seriesShape(at([0, 2, 4, 6]), 'credits', 30).segments.length, 1);
});

/*
 * A LEVEL is plotted at its value; a FLOW has no value to plot and is
 * accumulated from zero. Deciding per SERIES rather than per event stops one odd
 * row switching the line's meaning halfway along - which would draw a step
 * nothing measured.
 */
await ok('a series of deltas is accumulated, and says that it was', () => {
  const flows: LedgerEvent[] = [0, 1, 2].map((m, i) => ({
    account: 'Tenno', at: AT + m * MIN, seq: i, kind: 'gain' as const,
    name: 'resource:/x', from: null, to: null, by: 5,
  }));
  const shape = seriesShape(flows, 'resource:/x', 30);
  assert.equal(shape.cumulative, true);
  assert.deepEqual(shape.segments[0]?.map((p) => p.value), [5, 10, 15]);
});

await ok('a series of balances is plotted at its value, not summed', () => {
  const shape = seriesShape(at([0, 1, 2]), 'credits', 30);
  assert.equal(shape.cumulative, false);
  assert.deepEqual(shape.segments[0]?.map((p) => p.value), [100, 200, 300]);
});

await ok('a series with one mixed row does not switch meaning halfway', () => {
  // One row carrying a balance is enough to make the whole series a level.
  const mixed: LedgerEvent[] = [
    { account: 'Tenno', at: AT, seq: 1, kind: 'counter', name: 'm', from: null, to: null, by: 5 },
    { account: 'Tenno', at: AT + MIN, seq: 2, kind: 'counter', name: 'm', from: 90, to: 100, by: 10 },
  ];
  const shape = seriesShape(mixed, 'm', 30);
  assert.equal(shape.cumulative, false, 'a level series was accumulated');
  assert.deepEqual(shape.segments.flat().map((p) => p.value), [100], 'the delta-only row has no value to plot');
});

await ok('an unknown series is an empty shape, not a crash', () => {
  const shape = seriesShape(at([0, 1]), 'nothing-by-this-name', 30);
  assert.deepEqual(shape.segments, []);
  assert.equal(shape.min, 0);
});

await ok('a flat series reports a zero range rather than dividing by it', () => {
  const flat: LedgerEvent[] = [0, 1, 2].map((m, i) => ({
    account: 'Tenno', at: AT + m * MIN, seq: i, kind: 'counter' as const,
    name: 'flat', from: 7, to: 7, by: 0,
  }));
  const shape = seriesShape(flat, 'flat', 30);
  assert.equal(shape.max - shape.min, 0, 'the panel centres on this; a NaN here puts the line off-screen');
});

// ── 11. what was happening ───────────────────────────────────────

console.log('\nmoments');

/** Events at one instant, as one act. */
function act(atMs: number, rows: Array<[string, number | null, LedgerKind?]>): LedgerEvent[] {
  return rows.map(([name, by, kind], i) => ({
    account: 'Tenno',
    at: atMs,
    seq: i,
    kind: kind ?? ('counter' as const),
    name,
    from: null,
    to: null,
    by,
  }));
}

await ok('changes at one instant are one moment', () => {
  const m = moments(act(AT, [['credits', 5188], ['standing:Cetus', 2200], ['focus:AP_POWER', 11000]]));
  assert.equal(m.length, 1);
  assert.equal(m[0]?.events.length, 3);
});

await ok('acts minutes apart are separate moments', () => {
  const m = moments([...act(AT, [['credits', 100]]), ...act(AT + 5 * MIN, [['credits', 100]])]);
  assert.equal(m.length, 2);
});

/*
 * The window is not zero. A run's log lines arrive from the file tail seconds
 * either side of the inventory push carrying its rewards, so a zero window files
 * the two halves of one run as unrelated acts.
 */
await ok('a run"s log lines and its inventory push are one moment', () => {
  const m = moments([
    ...act(AT, [['mission-end', null, 'mission']]),
    ...act(AT + 2500, [['credits', 5188]]),
  ]);
  assert.equal(m.length, 1, 'the log line and the reward split apart');
  assert.equal(m[0]?.kind, 'mission');
});

/*
 * ORDERED, NOT SCORED. A mission-end line is sufficient on its own, and cannot
 * be outvoted by coincidental currency movement. A weighted guess would be wrong
 * exactly in the moments with the most going on, which are the ones a reader
 * most wants explained.
 */
await ok('a mission is a mission however much else moved', () => {
  const m = moments(
    act(AT, [
      ['mission-end', null, 'mission'],
      ['platinum', -50],
      ['credits', -900_000],
      ['standing:Cetus', -5000],
    ]),
  );
  assert.equal(m[0]?.kind, 'mission', `read as ${String(m[0]?.kind)}`);
});

await ok('a tribute outranks everything, because it is what contaminates a run', () => {
  const m = moments(act(AT, [['daily-tribute', null, 'system'], ['credits', 5000], ['mission-end', null, 'mission']]));
  assert.equal(m[0]?.kind, 'tribute');
});

/*
 * The arsenal outranks every spend rule. Ranking a mod costs credits and endo,
 * and saving a build can move both; without this rung a fusion is filed as
 * "a purchase" - a wrong story about something the player did on purpose.
 */
await ok('a fusion with its credit cost is the arsenal, not a purchase', () => {
  const m = moments(act(AT, [['fusion-endo', null, 'arsenal'], ['fusion-credits', null, 'arsenal'], ['credits', -12_400], ['endo', -1240]]));
  assert.equal(m[0]?.kind, 'arsenal', `read as ${String(m[0]?.kind)}`);
  assert.ok(/ranked/.test(m[0]?.summary ?? ''), m[0]?.summary);
});

await ok('mods placed and lifted are counted in the arsenal summary', () => {
  const rows: LedgerEvent[] = [
    { account: 'T', at: AT, seq: 1, kind: 'arsenal', name: 'mod:/Lotus/A', from: null, to: 'installed', by: null },
    { account: 'T', at: AT, seq: 2, kind: 'arsenal', name: 'mod:/Lotus/B', from: null, to: 'installed', by: null },
    { account: 'T', at: AT, seq: 3, kind: 'arsenal', name: 'mod:/Lotus/C', from: null, to: 'removed', by: null },
    { account: 'T', at: AT, seq: 4, kind: 'arsenal', name: 'loadout-saved', from: null, to: null, by: null },
  ];
  const m = moments(rows);
  assert.equal(m[0]?.kind, 'arsenal');
  assert.ok(/2 mods placed/.test(m[0]?.summary ?? '') && /1 lifted/.test(m[0]?.summary ?? '') && /saved/.test(m[0]?.summary ?? ''), m[0]?.summary);
});

await ok('a lone credit loss is still a purchase, never the arsenal', () => {
  assert.equal(moments(act(AT, [['credits', -500]]))[0]?.kind, 'purchase');
});

/*
 * `modOwned` is a dump of the collection, thirty-odd lines per screen open. It
 * is state, and the ledger records changes; written, it would put the same
 * rows down on every visit.
 */
await ok('the owned-mod dump reaches the ledger as nothing', () => {
  const rows = ledgerFromEvent({ at: 1, type: 'modOwned', itemType: '/Lotus/Upgrades/Mods/Melee/X' }, AT, 'Tenno');
  assert.deepEqual(rows, []);
});

await ok('a fusion cost is two series, one per currency', () => {
  const rows = ledgerFromEvent({ at: null, type: 'fusionCost', endo: 1240, credits: 12400 }, AT, 'Tenno');
  assert.deepEqual(rows.map((r) => [r.name, r.to]), [['fusion-endo', 1240], ['fusion-credits', 12400]]);
  for (const r of rows) assert.equal(r.kind, 'arsenal');
});

await ok('the Helminth is read before the foundry, since feeding it also spends resources', () => {
  const m = moments(act(AT, [['helminth-xp', 4000], ['resource:/Lotus/Ferrite', -3000]]));
  assert.equal(m[0]?.kind, 'helminth', `read as ${String(m[0]?.kind)}`);
});

await ok('materials in and a blueprint out is the foundry', () => {
  const m = moments(act(AT, [['resource:/Lotus/Ferrite', -3000], ['blueprint:/Lotus/Rhino', 1]]));
  assert.equal(m[0]?.kind, 'foundry');
});

await ok('platinum leaving with no run is the market', () => {
  const m = moments(act(AT, [['platinum', -20]]));
  assert.equal(m[0]?.kind, 'market');
  assert.ok(m[0]?.summary.includes('20'), m[0]?.summary);
});

/*
 * The one that matters most. A wrong story about what somebody did is worse than
 * no story: they know what they did, and being told otherwise makes every other
 * claim on the page suspect. So the last rung says it cannot tell.
 */
await ok('an unrecognisable moment says so rather than picking the least unlikely label', () => {
  const m = moments(act(AT, [['cosmetics', 1]]));
  assert.equal(m[0]?.kind, 'unknown');
  assert.ok(/nothing to identify/.test(m[0]?.summary ?? ''), m[0]?.summary);
});

await ok('a gain with no loss is never read as a purchase', () => {
  // Everything rising is a reward, not a spend. Reading it as a purchase would
  // invert the meaning of the moment entirely.
  const m = moments(act(AT, [['credits', 5000], ['standing:Cetus', 2000]]));
  assert.notEqual(m[0]?.kind, 'purchase');
  assert.notEqual(m[0]?.kind, 'market');
});

await ok('an empty ledger has no moments, rather than one empty one', () => {
  assert.deepEqual(moments([]), []);
});

await ok('every moment carries the events it was built from', () => {
  const rows = [...act(AT, [['credits', 1]]), ...act(AT + 10 * MIN, [['platinum', -1]])];
  const seen = moments(rows).flatMap((m) => m.events);
  assert.equal(seen.length, rows.length, 'a moment dropped an event');
});

// ── 12. not seen is not zero ────────────────────────────────────

console.log('\nnot seen');

await ok('an empty ledger has seen nothing, and says so rather than reporting zeroes', () => {
  const u = unobserved([]);
  assert.equal(u.seen, 0);
  assert.equal(u.names.length, u.total);
  assert.ok(u.total >= 70, `${u.total} watches`);
});

await ok('a family that has moved is not listed as unseen', () => {
  const u = unobserved(at([0, 1], 'credits'));
  assert.ok(!u.names.includes('credits'), 'credits moved and is still listed as unseen');
  assert.equal(u.seen, 1);
});

/*
 * A KEYED series reports its FAMILY as seen, not the individual entry. One
 * syndicate earning standing means `standing` is being watched successfully;
 * listing it as unseen because fifteen other syndicates have not moved would
 * make the list useless the moment anything happened at all.
 */
await ok('one entry moving marks the whole family seen', () => {
  const u = unobserved(at([0, 1], 'standing:CetusSyndicate'));
  assert.ok(!u.names.includes('standing'));
});

await ok('the list is every watch name, never an invented one', () => {
  const u = unobserved([]);
  const known = new Set(WATCHES.map((w) => w.name));
  for (const n of u.names) assert.ok(known.has(n), `${n} is not a watch`);
});

// ── report ───────────────────────────────────────────────────────────────────

console.log(`\n${checks} checks, ${failures} failures\n`);
process.exit(failures === 0 ? 0 : 1);
