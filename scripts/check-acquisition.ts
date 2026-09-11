/**
 * The account must never get smaller because of one bad read.
 *
 * WHAT THIS GUARDS
 * ────────────────
 * GEP reads the game's MEMORY. A read taken while Warframe is still populating
 * its structures - login, a loading screen, a host migration - can return
 * well-formed JSON that is almost empty. The old pipeline had no opinion about
 * that: `setInventory` replaced the account with whatever arrived, and the same
 * object went straight to IndexedDB over the good snapshot. One unlucky moment
 * in one session left the player's account permanently gutted, with the game
 * closed and no way to tell why.
 *
 * The rule these assertions enforce is in `src/core/acquire.ts`: a read is
 * evidence, not a replacement. Keys the read carries win, including when the
 * value is an empty array; keys it omits are kept.
 *
 * Nothing here is a fixture that ships. Payloads are built inline from real key
 * names taken from `src/data/account.ts` and the derivation modules.
 *
 * Run: node scripts/check-acquisition.ts
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCOUNT_KEYS,
  CLEARED_WHEN_ABSENT,
  accountKeyCount,
  emptyAcquireStats,
  isPlausibleAccount,
  mergeInventory,
} from '../src/core/acquire.ts';
import { useAccount } from '../src/core/store.ts';
import type { RawInventory } from '../src/core/gep.ts';

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log('  ok   ', name);
  } catch (err) {
    failures++;
    console.log('  FAIL ', name, '\n         ', (err as Error).message.split('\n')[0]);
  }
}

/** A complete-looking account, the shape a healthy GEP push carries. */
function fullAccount(): RawInventory {
  return {
    PlayerLevel: 11,
    Missions: [
      { Tag: 'SolNode1', Completes: 3 },
      { Tag: 'SolNode2', Completes: 1 },
    ],
    QuestKeys: [{ ItemType: '/Lotus/Types/Keys/VorsPrize', Completed: true }],
    XPInfo: [{ ItemType: '/Lotus/Powersuits/Excalibur', XP: 900_000 }],
    Suits: [{ ItemType: '/Lotus/Powersuits/Excalibur', XP: 900_000 }],
    LongGuns: [{ ItemType: '/Lotus/Weapons/Tenno/Rifle/Braton', XP: 450_000 }],
    Melee: [{ ItemType: '/Lotus/Weapons/Tenno/Melee/Skana', XP: 120_000 }],
    MiscItems: [{ ItemType: '/Lotus/Types/Items/MiscItems/Ferrite', ItemCount: 180_000 }],
    Affiliations: [{ Tag: 'SteelMeridianSyndicate', Standing: 61_000, Title: 3 }],
    PendingRecipes: [{ ItemType: '/Lotus/Types/Recipes/Weapons/BratonBlueprint' }],
    RegularCredits: 1_250_000,
  } as unknown as RawInventory;
}

/* -------------------------------------------------------------- the pure gate */

check('a payload with no account key at all is not an account', () => {
  for (const junk of [null, undefined, {}, [], 'a truncated string', 42, { Foo: 1 }]) {
    assert.equal(isPlausibleAccount(junk), false, `${JSON.stringify(junk) ?? 'undefined'} was accepted`);
  }
});

check('a real account, and even a one-key read, is accepted', () => {
  assert.equal(isPlausibleAccount(fullAccount()), true, 'a full account was rejected');
  // A thin read is still real information; the floor only rejects non-accounts.
  assert.equal(isPlausibleAccount({ PlayerLevel: 11 }), true, 'a one-key read was rejected');
  assert.equal(accountKeyCount(fullAccount()), 11);
});

check('every key the gate recognises is a key the app actually reads', () => {
  // ACCOUNT_KEYS is the identity set. A name that no derivation module reads
  // would let a payload of junk fields pass as an account.
  assert.ok(ACCOUNT_KEYS.length >= 15, `only ${String(ACCOUNT_KEYS.length)} identity keys`);
  assert.equal(new Set(ACCOUNT_KEYS).size, ACCOUNT_KEYS.length, 'duplicate key in the identity set');
  for (const key of ACCOUNT_KEYS) assert.match(key, /^[A-Z][A-Za-z]+$/, `${key} is not a payload key`);
});

check('a read carries its keys forward and never drops the ones it omits', () => {
  const prev = fullAccount();
  const thin = { PlayerLevel: 12 } as unknown as RawInventory;
  const merged = mergeInventory(prev, thin);
  assert.equal(merged.PlayerLevel, 12, 'the new value must win');
  assert.equal(merged.Missions?.length, 2, 'Missions was dropped by a read that never mentioned it');
  assert.equal(accountKeyCount(merged), accountKeyCount(prev), 'the account got smaller');
});

check('an empty array in a read overwrites a stale non-empty one', () => {
  // The foundry going idle is a FACT about the account. Keeping the old queue
  // would be exactly the kind of stale claim the honesty rules forbid.
  const prev = fullAccount();
  const merged = mergeInventory(prev, { PendingRecipes: [] } as unknown as RawInventory);
  assert.deepEqual(merged.PendingRecipes, [], 'an empty array must win over a stale queue');
});

check('a read that changes nothing returns the same object', () => {
  const prev = fullAccount();
  assert.equal(mergeInventory(prev, prev), prev, 'an identical read should not allocate a new account');
  assert.notEqual(mergeInventory(prev, { PlayerLevel: 99 } as unknown as RawInventory), prev);
});

/* ------------------------------------------------------------------ the store */

function reset(): void {
  useAccount.setState({
    inventory: null,
    inventoryAt: null,
    capturedAt: null,
    username: null,
    hydrated: false,
    accountOwner: null,
    acquire: emptyAcquireStats(),
  });
}

check('THE BUG: a nearly-empty read cannot gut a complete account', () => {
  reset();
  const store = useAccount.getState();
  store.setInventory(fullAccount());
  const before = accountKeyCount(useAccount.getState().inventory ?? {});

  // The read that used to destroy everything: valid JSON, an object, one key.
  const kept = store.setInventory({ PlayerLevel: 11 } as unknown as RawInventory);

  const after = accountKeyCount(useAccount.getState().inventory ?? {});
  assert.equal(after, before, `the account shrank from ${String(before)} keys to ${String(after)}`);
  assert.equal(useAccount.getState().inventory?.Missions?.length, 2, 'Missions was lost');
  assert.ok(kept, 'the merged account must be returned for persistence');
  assert.equal(accountKeyCount(kept), before, 'what would have been written to disk was the thin read');
  assert.equal(useAccount.getState().acquire.partial, 1, 'the thin read was not counted as partial');
});

check('a read that is not an account is dropped and never persisted', () => {
  reset();
  const store = useAccount.getState();
  store.setInventory(fullAccount());
  const held = useAccount.getState().inventory;

  for (const junk of [{}, [], 'truncated'] as unknown as RawInventory[]) {
    assert.equal(store.setInventory(junk), null, 'a non-account read must return null');
  }
  assert.equal(useAccount.getState().inventory, held, 'the account was touched by a junk read');
  assert.equal(useAccount.getState().acquire.dropped, 3, 'dropped reads were not counted');
});

check('a stored snapshot is folded under a live push, not discarded by it', () => {
  reset();
  const store = useAccount.getState();
  // The race: a thin live push lands first, the snapshot resolves second.
  store.setInventory({ PlayerLevel: 12 } as unknown as RawInventory);
  store.hydrate(fullAccount(), 'Tenno', 1_700_000_000_000);

  const after = useAccount.getState();
  assert.equal(after.inventory?.PlayerLevel, 12, 'the live value must still win');
  assert.equal(after.inventory?.Missions?.length, 2, 'the stored account was thrown away by a thin push');
  assert.equal(after.username, 'Tenno');
  assert.equal(after.hydrated, true);
});

check('hydrating junk never replaces a live account', () => {
  reset();
  const store = useAccount.getState();
  store.setInventory(fullAccount());
  store.hydrate({} as unknown as RawInventory, null, 1);
  assert.equal(accountKeyCount(useAccount.getState().inventory ?? {}), 11, 'a junk snapshot overwrote a live account');
});

check('capturedAt moves on every accepted read, changed or not', () => {
  reset();
  const store = useAccount.getState();
  const account = fullAccount();
  store.setInventory(account);
  const first = useAccount.getState().capturedAt;
  assert.ok(first, 'capturedAt was not set');
  // The same object again: the account is confirmed current even though nothing
  // in it moved, which is what the age shown in the UI means.
  store.setInventory(account);
  const second = useAccount.getState().capturedAt;
  assert.ok(second !== null && first !== null && second >= first, 'a confirming read did not refresh the age');
  assert.equal(useAccount.getState().acquire.redundant, 1, 'the redundant read was not counted');
});

check('a key DE omits when empty is cleared by a complete read, not carried forever', () => {
  // inventory-schema.md:593 - `Nemesis` is absent when there is no active lich.
  // Carrying it forward told a player who vanquished theirs that it was still
  // alive, on disk, with no way back short of wiping the database.
  const withLich = { ...fullAccount(), Nemesis: { fp: 1 } } as unknown as RawInventory;
  const merged = mergeInventory(withLich, fullAccount());
  assert.equal('Nemesis' in merged, false, 'the vanquished lich survived a complete read');

  // ...but a THIN read is trusted about nothing it fails to mention.
  const thin = { PlayerLevel: 12 } as unknown as RawInventory;
  assert.equal('Nemesis' in mergeInventory(withLich, thin), true, 'a one-key read deleted the lich');
});

check('the clear-when-absent gate counts keys that cannot themselves vanish', () => {
  // Counting ALL recognised keys can never fire: `Nemesis` is one of them, so a
  // post-vanquish read always carries one fewer than what we hold, and the rule
  // would be dead code that reads as if it worked.
  assert.ok(CLEARED_WHEN_ABSENT.includes('Nemesis'), 'Nemesis must be clearable');
  assert.ok(ACCOUNT_KEYS.includes('Nemesis'), 'meaningful only while Nemesis is also an identity key');
  const withLich = { ...fullAccount(), Nemesis: { fp: 1 } } as unknown as RawInventory;
  assert.ok(accountKeyCount(fullAccount()) < accountKeyCount(withLich), 'the naive count would refuse this read');
  assert.equal('Nemesis' in mergeInventory(withLich, fullAccount()), false, 'the gate used the wrong count');
});

check('a second player never inherits the first one\u2019s account', () => {
  reset();
  const store = useAccount.getState();
  store.setUsername('PlayerOne');
  store.setInventory({ ...fullAccount(), Nemesis: { fp: 1 } } as unknown as RawInventory);
  assert.equal(useAccount.getState().accountOwner, 'PlayerOne');

  // A different player logs in on the same PC and their read lands.
  store.setUsername('PlayerTwo');
  store.setInventory({ PlayerLevel: 2, Missions: [{ Tag: 'SolNode1', Completes: 1 }] } as unknown as RawInventory);

  const after = useAccount.getState();
  assert.equal(after.inventory?.PlayerLevel, 2, 'the new player must own the account');
  assert.equal('Nemesis' in (after.inventory ?? {}), false, 'the second player inherited a lich');
  assert.equal(after.inventory?.XPInfo, undefined, 'the second player inherited mastery that was not theirs');
  assert.equal(after.accountOwner, 'PlayerTwo');
  assert.equal(after.acquire.switched, 1, 'the switch was not recorded');
});

check('a stored account is not hydrated into a different player who is live', () => {
  reset();
  const store = useAccount.getState();
  store.setUsername('PlayerTwo');
  store.setInventory({ PlayerLevel: 2 } as unknown as RawInventory);
  // The snapshot on disk belongs to PlayerOne.
  store.hydrate(fullAccount(), 'PlayerOne', 1_700_000_000_000);
  const after = useAccount.getState();
  assert.equal(after.inventory?.PlayerLevel, 2);
  assert.equal(after.inventory?.Missions, undefined, "PlayerOne's account was hydrated into PlayerTwo");
});

check('nor is one whose owner was never recorded, once a player IS known', () => {
  /*
   * The asymmetry the merge turns on. A snapshot written before the login line
   * was seen carries no username; merging it into a KNOWN live player is the
   * one blend nothing downstream can undo, because the merged account takes the
   * live name as its owner and `switched` needs the two to differ.
   */
  reset();
  const store = useAccount.getState();
  store.setUsername('PlayerTwo');
  store.setInventory({ PlayerLevel: 2 } as unknown as RawInventory);
  store.hydrate(fullAccount(), null, 1_700_000_000_000);
  const after = useAccount.getState();
  assert.equal(after.inventory?.PlayerLevel, 2);
  assert.equal(after.inventory?.Missions, undefined, 'an account of unknown ownership was blended into a named player');
  assert.equal(after.accountOwner, 'PlayerTwo', 'and the blend took the live name, so nothing downstream could ever unpick it');
});

check('but an unknown LIVE owner still hydrates, because that correction exists', () => {
  /*
   * The other half, and the reason the check above is not simply "refuse when
   * anything is unknown": at startup there is usually no login line yet, and
   * refusing here would throw away the account on disk on every launch. This
   * one is safe because it self-corrects - `accountOwner` becomes the stored
   * name, so a push for anybody else replaces rather than merges.
   */
  reset();
  const store = useAccount.getState();
  store.hydrate(fullAccount(), 'PlayerOne', 1_700_000_000_000);
  const after = useAccount.getState();
  assert.ok(after.inventory?.Missions, 'the stored account was discarded at a launch that knew nothing about it');
  assert.equal(after.accountOwner, 'PlayerOne', 'and its owner was not carried, so a later switch could not be seen');
});

check('durability is reported, never assumed', () => {
  reset();
  assert.equal(useAccount.getState().acquire.durable, null, 'durability must start unknown, not true');
  useAccount.getState().setDurable(false);
  assert.equal(useAccount.getState().acquire.durable, false);
  useAccount.getState().setDurable(true);
  assert.equal(useAccount.getState().acquire.durable, true);
});

/* ------------------------------------------------------- the fetch allowance */

check('every host the app fetches is in the manifest CORS allowance', () => {
  /*
   * `externally_connectable.matches` doubles as the CORS allowance for `fetch`
   * inside Overwolf (docs/DATA-SOURCES.md:53). Three of the four hosts this app
   * reads from were missing from it, and the failure is invisible in
   * development: Vite's dev server has no such gate, so every catalog loaded on
   * this machine and none of them loaded in the packaged app. `itemdb` swallows
   * a failed fetch by design, so the result was not an error - it was seven of
   * the eight collection pursuits reporting "not measured" against a complete,
   * healthy account. Exactly "not thorough enough", and undiscoverable without
   * building and installing.
   *
   * The two files can only drift apart silently, so this is the gate.
   */
  const root = join(import.meta.dirname, '..');
  const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.json'), 'utf8')) as {
    data?: { externally_connectable?: { matches?: string[] } };
  };
  const allowed = manifest.data?.externally_connectable?.matches ?? [];
  assert.ok(allowed.length > 0, 'the manifest declares no fetch allowance at all');

  const permits = (origin: string): boolean =>
    allowed.some((m) => {
      if (m === origin) return true;
      // `https://*.overwolf.com` style wildcards.
      const star = m.indexOf('*');
      if (star < 0) return false;
      const [head, tail] = [m.slice(0, star), m.slice(star + 1)];
      return origin.startsWith(head) && origin.endsWith(tail);
    });

  // Every https origin written as a literal anywhere under src/.
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name)) files.push(full);
    }
  };
  walk(join(root, 'src'));

  const missing = new Map<string, string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/https:\/\/[a-z0-9.-]+/gi)) {
      const origin = m[0];
      // Only what the app actually fetches: a URL inside a comment is prose.
      const line = text.slice(text.lastIndexOf('\n', m.index) + 1, text.indexOf('\n', m.index));
      if (/^\s*(\*|\/\/)/.test(line)) continue;
      if (!permits(origin)) missing.set(origin, `${file.slice(root.length + 1)}: ${line.trim().slice(0, 60)}`);
    }
  }
  assert.deepEqual(
    [...missing.keys()],
    [],
    `not in the manifest allowance, so blocked in the packaged app:\n    ${[...missing].map(([o, w]) => `${o}  (${w})`).join('\n    ')}`,
  );
});

console.log(failures === 0 ? '\nall acquisition rules hold' : `\n${String(failures)} acquisition rule(s) broken`);
if (failures > 0) process.exit(1);
