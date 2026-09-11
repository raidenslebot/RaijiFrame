/**
 * Self-check for the mod catalogue (docs/research/moddb-spec.md, Part A and
 * the Part F items that belong to it), on the REAL `Mods.json`.
 *
 * WHY THE REAL FILE AND NOT A FIXTURE
 * ————————————————————————————————————
 * Every rule in Part A is a rule about what the export actually contains -
 * "Serration" is three rows, Galvanized Steel lives under `/Expert/` and is
 * real, 49 Plexus rows have more ranks than `fusionLimit + 1` - and a fixture
 * of invented rows would test the fixture. So this reads the export from
 * `node_modules/.cache/wfcd/Mods.json`, downloads it there on first run, and
 * when neither the cache nor the network exists prints one SKIP line and
 * exits 0: a gate that fails for lack of network is noise, and a gate that
 * silently passes on a fixture is worse. Every input below is a real row,
 * quoted by `uniqueName`.
 *
 * THE PARSER MAY BE ABSENT, AND PART A IS STILL TESTED
 * ————————————————————————————————————————————————————
 * `moddb.ts` imports `parseModStats` from `modstats.ts`, which is written in
 * parallel by someone else. With ESM a missing static import fails the whole
 * module graph, so this gate registers a resolve hook that substitutes a stub
 * ONLY when `./modstats.ts` does not resolve. The stub emits zero effects and
 * refuses every line under the rule `no-parser` - it names what it could not
 * parse and invents nothing - so the row filter, the field allowlist and every
 * count in Part A are exercised either way. The Part D checks (Serration +165,
 * Barrel Diffusion +120, the refusal histogram) run only with the real parser
 * and say so loudly when they did not.
 *
 * ON THE PHANTOM COUNT
 * ————————————————————
 * The spec's A2 rule is "tier marker AND a duplicated name" and it says in the
 * same breath that a path filter alone is wrong (it would drop the 66 Primed
 * mods). Measured on the export, that rule drops 108 rows. The spec's figure
 * of 145 is the number of rows whose path contains `Expert` - the path filter.
 * Both numbers are pinned here by what they actually count, so a drift in
 * either is caught, and neither is fudged to match the other.
 *
 * Run: node scripts/check-moddb.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'wfcd', 'Mods.json');
const MANIFEST = path.join(ROOT, 'public', 'manifest.json');

/** The stub that stands in for modstats.ts when it does not exist yet. Zero effects; every line refused by name. */
const STUB_URL =
  'data:text/javascript,' +
  encodeURIComponent(
    'export function parseModStats(input) {' +
      ' const refused = [];' +
      ' input.levelStats.forEach((lines, rank) => lines.forEach((text, element) => refused.push({ rank, element, rule: "no-parser", reason: "modstats.ts is not present; nothing was parsed", text, numbersFound: [] })));' +
      ' return { effects: [], refused, corrupt: null };' +
      '}',
  );

let parserPresent = true;
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      if (specifier === './modstats.ts' && code === 'ERR_MODULE_NOT_FOUND') {
        parserPresent = false;
        return { url: STUB_URL, shortCircuit: true };
      }
      throw err;
    }
  },
});

type ModDbModule = typeof import('../src/data/moddb.ts');
const moddb: ModDbModule = await import(pathToFileURL(path.join(ROOT, 'src', 'data', 'moddb.ts')).href);
const { parseModsJson, parseModsRows, indexModDb, filterModRows, projectModRow, levelStatsOf, loadModDb, MODS_URL } = moddb;

function ok(sentence: string): void {
  console.log(`  ok    ${sentence}`);
}

// --- the export --------------------------------------------------------------
/**
 * OFFLINE IS A SKIP; A MOVED FILE IS A FAILURE.
 *
 * The first version put `if (!res.ok) throw` inside the try whose catch
 * returns null, so a 404 from the source - the very same URL the packaged app
 * fetches - printed "offline, no cache" and exited 0. A renamed upstream file
 * would have passed this gate silently and broken the app. Only a transport
 * failure (no network, DNS, a refused connection) is a SKIP; an HTTP response
 * that is not ok is a real failure and throws out of here.
 */
async function loadBody(): Promise<string | null> {
  if (fs.existsSync(CACHE)) return fs.readFileSync(CACHE, 'utf8');
  let res: Response;
  try {
    res = await fetch(MODS_URL);
  } catch {
    return null; // no network at all
  }
  if (!res.ok) throw new Error(`the mod export responded ${String(res.status)} - the upstream file moved, this is not "offline"`);
  const body = await res.text();
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, body);
  return body;
}

const body = await loadBody();
if (body === null) {
  console.log('  SKIP  Mods.json unavailable (offline, no cache)');
  process.exit(0);
}

interface RawMod {
  uniqueName: string;
  name: string;
  type?: string;
  baseDrain?: number;
  compatName?: string;
  polarity?: string;
  levelStats?: Array<{ stats: string[] }>;
  drops?: Array<{ chance: unknown }>;
  introduced?: { name?: string };
  description?: string;
}
const raw = JSON.parse(body) as RawMod[];
assert.equal(raw.length, 1806, 'the export is the 1,806-row file the spec was measured on');

const db = parseModsJson(body);
const rows = [...db.byPath.values()];
const PVP = /\/PvPMods\/|PvPAugmentCard$/;

// --- shape -------------------------------------------------------------------
assert.deepEqual(Object.keys(db).sort(), ['byName', 'byPath', 'dropped', 'fetchedAt'], 'ModDb carries exactly the four spec fields - no name-keyed lookup can be added without failing here');
assert.equal(db.fetchedAt, null, 'the pure parse fetched nothing');
assert.equal(typeof loadModDb, 'function');
ok('ModDb is byPath, byName, dropped, fetchedAt and nothing else');

// --- accounting --------------------------------------------------------------
const { dropped } = db;
assert.equal(dropped.pvp, 152, 'A1: 152 Conclave rows');
assert.equal(dropped.templates, 30, 'A1: 11 template rows by path (SampleAntiqueUpgrade + 10 Railjack), 15 riven templates, 4 Transmutation cores');
assert.equal(dropped.phantoms, 108, 'A2: 75 Expert + 33 Intermediate copies of a mod whose untiered row exists');
assert.deepEqual(dropped.corrupt, [], 'nothing in the real export is refused as corrupt');
assert.equal(dropped.pvp + dropped.templates + dropped.phantoms + dropped.corrupt.length + rows.length, raw.length, 'every row is either kept or counted in exactly one dropped bucket');
assert.equal(rows.length, 1516);
ok(`1,806 rows: ${String(dropped.pvp)} pvp + ${String(dropped.templates)} templates + ${String(dropped.phantoms)} phantoms + ${String(rows.length)} kept, and nothing corrupt`);

// The spec's "145" reconciled by what it counts. Sabotage: a path filter on
// /Expert/ would make phantoms read 145 and would drop Primed Continuity.
const afterA1 = raw.filter((r) => !PVP.test(r.uniqueName) && !/SampleAntiqueUpgrade|InnateDamageRandomMod|RandomMod/.test(r.uniqueName) && !/Riven|Transmutation/.test(r.type ?? ''));
assert.equal(afterA1.filter((r) => /Expert/.test(r.uniqueName)).length, 145, 'the spec\'s 145 is every A1 survivor whose path contains Expert');
const keptExpert = rows.filter((r) => /Expert/.test(r.uniqueName));
assert.equal(keptExpert.length, 70, '70 of those 145 have a unique name and are real');
assert.ok(keptExpert.every((r) => /^(Primed|Galvanized) /.test(r.name)), 'every kept Expert row is a Primed or Galvanized mod');
assert.equal(rows.filter((r) => /Intermediate/.test(r.uniqueName)).length, 0, 'no Intermediate copy has a unique name; all 33 are phantoms');
assert.equal(145 - keptExpert.length + 33, dropped.phantoms, '145 Expert rows minus the 70 real ones, plus 33 Intermediate, is the 108');
ok('the spec\'s 145 is the path-filter count; the rule it states keeps 70 of them (66 Primed + Primed Animal Instinct, 3 Galvanized) and drops 108');

// --- A1: no Conclave, riven or transmute row survives ---------------------------
assert.equal(rows.filter((r) => PVP.test(r.uniqueName)).length, 0, 'no kept uniqueName contains /PvPMods/ or ends in PvPAugmentCard');
assert.equal(rows.filter((r) => r.type !== null && /Riven|Transmutation/.test(r.type)).length, 0);
assert.equal(rows.filter((r) => /RandomMod|SampleAntiqueUpgrade/.test(r.uniqueName)).length, 0);
assert.equal(rows.reduce((n, r) => n + (PVP.test(r.uniqueName) ? r.effects.length : 0), 0), 0, 'F5: zero effects come from PvP rows');
ok('no kept row is a Conclave mod, a riven template, a random template or a transmute core, and zero effects come from one');

// --- A2 by name: Serration, Barrel Diffusion, Handspring, Ammo Drum -------------
// Sabotage: a name-keyed lookup has two answers for each of these and the
// gate asserts that it does. The identity is the path.
function two(name: string, real: string, fusionLimit: number, ranks: number): void {
  const same = db.byName.get(name);
  assert.ok(same, `${name} is in byName`);
  assert.equal(same.length, 2, `${name}: the real row and the Flawed row, nothing else`);
  const realRow = db.byPath.get(real);
  assert.ok(realRow, `${real} is kept`);
  assert.equal(realRow.name, name);
  assert.equal(realRow.displayName, name);
  assert.equal(realRow.isFlawed, false);
  assert.equal(realRow.fusionLimit, fusionLimit);
  assert.equal(realRow.ranks, ranks, 'ranks is levelStats.length');
  const flawed = same.find((r) => r.uniqueName !== real);
  assert.ok(flawed);
  assert.equal(flawed.isFlawed, true);
  assert.equal(flawed.displayName, `Flawed ${name}`);
  assert.equal(flawed.name, name, 'name stays as the export wrote it');
  assert.ok(/Beginner$/.test(flawed.uniqueName));
}
two('Serration', '/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod', 10, 11);
assert.equal(db.byPath.has('/Lotus/Upgrades/Mods/Rifle/Intermediate/WeaponDamageAmountModIntermediate'), false, 'the +90 % Serration is gone');
two('Barrel Diffusion', '/Lotus/Upgrades/Mods/Pistol/WeaponFireIterationsMod', 5, 6);
assert.equal(db.byPath.has('/Lotus/Upgrades/Mods/Pistol/Expert/WeaponFireIterationsModExpert'), false, 'the +220 % Barrel Diffusion is gone');
assert.equal(db.byName.get('Handspring')?.length, 1, 'Handspring has no Flawed row');
assert.ok(db.byPath.has('/Lotus/Upgrades/Mods/Warframe/AvatarKnockdownRecoveryMod'));
assert.equal(db.byPath.has('/Lotus/Upgrades/Mods/Warframe/Expert/AvatarKnockdownRecoveryModExpert'), false, 'the +440 % Handspring is gone');
assert.equal(db.byPath.has('/Lotus/Upgrades/Mods/Warframe/Intermediate/AvatarKnockdownRecoveryModIntermediate'), false);
two('Ammo Drum', '/Lotus/Upgrades/Mods/Rifle/WeaponAmmoMaxMod', 5, 6);
assert.equal(db.byPath.has('/Lotus/Upgrades/Mods/Rifle/Expert/WeaponAmmoMaxModExpert'), false, 'the +165 % Ammo Drum is gone');
ok('Serration, Barrel Diffusion and Ammo Drum are each two rows by name (real + Flawed) and one row by path; their Intermediate/Expert copies are gone');

// Sabotage: "under /Expert/ means phantom" drops these; the rule keeps them.
const galvanizedSteel = db.byPath.get('/Lotus/Upgrades/Mods/Melee/Expert/WeaponCritChanceSPMod');
assert.ok(galvanizedSteel, 'Galvanized Steel is kept although its path is under /Expert/');
assert.equal(galvanizedSteel.name, 'Galvanized Steel');
assert.ok(/\/Expert\//.test(galvanizedSteel.uniqueName), 'and a path filter would have matched it');
assert.equal(db.byName.get('Galvanized Steel')?.length, 1);
assert.equal(db.byPath.get('/Lotus/Upgrades/Mods/Warframe/Expert/AvatarAbilityDurationModExpert')?.name, 'Primed Continuity', 'Primed Continuity ends in Expert and is real');
assert.equal(db.byName.get('Primed Continuity')?.length, 1);
ok('Galvanized Steel and Primed Continuity survive A2: the tier marker alone is not the rule');

// --- A3: Flawed ---------------------------------------------------------------
const flawed = rows.filter((r) => r.isFlawed);
assert.equal(flawed.length, 104, 'A3: 104 Flawed rows');
assert.ok(flawed.every((r) => /Beginner$/.test(r.uniqueName) && r.displayName === `Flawed ${r.name}`));
assert.ok(rows.every((r) => r.isFlawed === /Beginner$/.test(r.uniqueName)));
assert.ok(rows.every((r) => r.isFlawed || r.displayName === r.name), 'displayName is the name everywhere else');
ok('104 Flawed rows are kept with displayName "Flawed <name>" and name unchanged');

// --- A4: description-only rows ------------------------------------------------
const rankless = rows.filter((r) => r.ranks === 0);
assert.equal(rankless.length, 130, 'A4: 130 kept rows have no levelStats');
assert.ok(rankless.every((r) => r.effects.length === 0 && r.refused.length === 0), 'a row with no stat lines has no effects and nothing to refuse');
// Sabotage: reading `description` as a stat line would give this Stance an effect.
const stance = db.byPath.get('/Lotus/Weapons/Tenno/Melee/MeleeTrees/GlaiveCmbTwoMeleeTree');
assert.ok(stance);
assert.equal(raw.find((r) => r.uniqueName === stance.uniqueName)?.description, 'Orbiting slashes and lashing strikes.', 'the export carries a description for it');
assert.equal(stance.ranks, 0);
assert.equal(stance.effects.length + stance.refused.length, 0, 'and it is never read as a stat');
assert.equal('description' in stance, false, 'description is not stored raw');
ok('130 description-only rows (Stances, Parazon, Plexus, Mod Set carriers) produce zero effects; description is never a stat line');

// --- A5: ranks is levelStats.length, never fusionLimit + 1 ----------------------
// Sabotage: `levelStats[fusionLimit]` reads rank 5 of a 9-rank Plexus mod as its cap.
const cheapShot = db.byPath.get('/Lotus/Upgrades/Mods/Railjack/Gunnery/ZektiFreeSuperWeaponAmmo');
assert.ok(cheapShot);
assert.equal(cheapShot.fusionLimit, 5);
assert.equal(cheapShot.ranks, 9, 'Artillery Cheap Shot has nine rank lines and a fusionLimit of 5');
const offByRank = rows.filter((r) => r.ranks > 0 && r.fusionLimit !== null && r.ranks !== r.fusionLimit + 1);
assert.equal(offByRank.length, 49, '49 Plexus rows have length !== fusionLimit + 1');
assert.ok(offByRank.every((r) => r.type === 'Plexus Mod'));
for (const r of raw) {
  const kept = db.byPath.get(r.uniqueName);
  if (kept) assert.equal(kept.ranks, r.levelStats?.length ?? 0, `${r.uniqueName}: ranks is levelStats.length`);
}
ok('ranks is levelStats.length on every kept row; 49 Plexus rows would be misread through fusionLimit');

// Sabotage: a real-newline splitter finds nothing. The strings moddb hands the
// parser are the export's own: 727 carry the two characters backslash + n,
// none carries U+000A.
{
  let backslashN = 0;
  let newline = 0;
  for (const r of raw) {
    if (!db.byPath.has(r.uniqueName)) continue;
    const levels = levelStatsOf({ ...r });
    assert.equal(levels.corrupt, null);
    for (const lines of levels.ranks ?? []) {
      for (const s of lines) {
        if (s.includes('\\n')) backslashN++;
        if (s.includes('\n')) newline++;
      }
    }
  }
  assert.ok(backslashN > 500, `stat lines carry the literal two-character sequence backslash+n (${String(backslashN)})`);
  assert.equal(newline, 0, 'and no U+000A anywhere');
  ok(`${String(backslashN)} stat strings carry a literal backslash+n and none carries a real newline; they reach the parser untouched`);
}

// --- A8: slot, aura, exilus, utility ----------------------------------------------
const auras = rows.filter((r) => r.isAura);
assert.equal(auras.length, 36, 'A8: 36 auras');
assert.deepEqual(
  auras.map((r) => r.uniqueName).sort(),
  rows.filter((r) => r.baseDrain !== null && r.baseDrain < 0 && r.slot === 'AURA').map((r) => r.uniqueName).sort(),
  'isAura is exactly baseDrain < 0 with slot AURA',
);
assert.equal(db.byPath.get('/Lotus/Upgrades/Mods/Aura/AvatarAuraPowerMaxMod')?.baseDrain, -4, 'Power Donation is -4');
assert.equal(db.byPath.get('/Lotus/Upgrades/Mods/Aura/PlayerMeleeAuraMod')?.baseDrain, -4, 'Steel Charge is -4');
// Sabotage: `polarity === 'aura'` marks one row (Dreamer's Bond), not 36.
const dreamersBond = db.byPath.get('/Lotus/Upgrades/Mods/Aura/PlayerEnergyHealthRegenAuraMod');
assert.equal(dreamersBond?.polarity, 'aura');
assert.equal(dreamersBond?.isAura, true);
assert.equal(rows.filter((r) => r.polarity === 'aura').length, 1, 'polarity aura occurs once and is not the marker');
assert.equal(rows.filter((r) => r.baseDrain !== null && r.baseDrain < 0 && !r.isAura).length, 80, 'the other 80 negative-drain rows (Plexus, Companion) are not auras');
ok('isAura is true on exactly the 36 rows with baseDrain < 0 and slot AURA; Dreamer\'s Bond\'s polarity "aura" is not the rule');

assert.equal(rows.filter((r) => r.slot === null).length, 206, 'A8: compatName missing on 206 kept rows reads null, never a default');
assert.equal(rows.filter((r) => r.isExilus).length, 33);
assert.equal(rows.filter((r) => r.isUtility).length, 128);
assert.equal(rows.filter((r) => r.isPrime).length, 71);
assert.ok(rows.every((r) => !('isAugment' in r)), 'isAugment is not carried: it is true on all 454 Warframe Mod rows');
ok('slot is null on 206 rows; isExilus 33, isUtility 128, isPrime 71; isAugment is not carried');

// --- the allowlist ---------------------------------------------------------------
const SPEC_KEYS = [
  'uniqueName', 'name', 'displayName', 'slot', 'polarity', 'baseDrain', 'fusionLimit', 'ranks', 'isAura', 'isFlawed',
  'isExilus', 'isUtility', 'isPrime', 'rarity', 'type', 'modSet', 'modSetValues', 'thumbnail', 'tradable',
  'introduced', 'effects', 'refused', 'best', 'sources',
].sort();
for (const r of rows) assert.deepEqual(Object.keys(r).sort(), SPEC_KEYS, `${r.uniqueName}: exactly the spec's fields`);
/*
 * `drops` IS THE ONE FIELD THE EXPORT HAS AND THE CATALOGUE STILL REFUSES:
 * 1,096 KB of a 3,666 KB persisted catalogue, against a 5 MB localStorage cliff
 * whose overflow gentle's commit() swallows silently. A regression that re-adds
 * the whole array is caught here rather than at the cliff, months later, as a
 * refetch per launch.
 *
 * WHAT CHANGED: the comment here used to say "where a mod drops is already the
 * acquisition layer's answer", naming an `acquire.ts` that does not exist and
 * never did. Nothing in the app could say where a mod came from. The catalogue
 * now keeps the single BEST source per row and a count of the rest - the only
 * part the overlay would ever show - which is about 84 KB rather than 1,096.
 */
for (const r of rows) assert.ok(!('drops' in r), `${r.uniqueName}: the whole drops array is not persisted`);
assert.equal(
  raw.filter((r) => db.byPath.has(r.uniqueName)).reduce((n, r) => n + (r.drops?.length ?? 0), 0),
  15711,
  'the export does carry 15,711 drop rows on kept mods - they are refused deliberately, not missing',
);
// Sabotage: the projection alone, on the raw rows it is given, with no parser anywhere near it.
{
  const { kept } = filterModRows(raw);
  assert.equal(kept.length, 1516 + 0);
  const direct = kept.map(projectModRow);
  for (const p of direct) assert.deepEqual(Object.keys(p).sort(), SPEC_KEYS.filter((k) => k !== 'effects' && k !== 'refused'));
  assert.deepEqual(direct.map((p) => p.uniqueName).sort(), rows.map((r) => r.uniqueName).sort(), 'the filter and the projection, run without the parser, keep the same rows');
}
ok('every kept row carries exactly the 22 allowlisted fields and nothing raw leaks (no levelStats, description, drops, codexSecret, upgradeEntries)');

// --- absent is unknown, never zero --------------------------------------------------
const carriers = rows.filter((r) => r.baseDrain === null);
assert.equal(carriers.length, 19, 'the 19 Mod Set carriers have no baseDrain');
assert.ok(carriers.every((r) => r.type === 'Mod Set Mod' && r.polarity === null && r.fusionLimit === null && r.rarity === null));
assert.equal(rows.filter((r) => r.baseDrain === 0).length, 138, 'and they are not among the 138 rows whose drain really is 0');
const DRAINS = new Set([0, 2, 4, 6, 10, -2, -4]);
assert.ok(rows.every((r) => r.baseDrain === null || DRAINS.has(r.baseDrain)), 'every baseDrain is in the observed set or null');
const LIMITS = new Set([0, 3, 5, 10]);
assert.ok(rows.every((r) => r.fusionLimit === null || LIMITS.has(r.fusionLimit)), 'every fusionLimit is in the observed set or null (434 is riven-only and dropped)');
assert.equal(rows.filter((r) => r.introduced !== null).length, 1352);
assert.equal(db.byPath.get('/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod')?.introduced, 'Vanilla', 'introduced is the nested update name');
assert.equal(rows.filter((r) => r.modSetValues !== null).length, 5);
assert.equal(rows.filter((r) => r.modSet !== null).length, 72);
assert.equal(rows.filter((r) => r.thumbnail !== null).length, 1313);
assert.ok(rows.every((r) => r.tradable !== null), 'tradable is on every row');
ok('19 carriers read baseDrain null, not 0; 13 drop chances stay null; 15,711 drops and 1,352 introduced names survive the projection');

// --- byName is a collector, never a lookup --------------------------------------------
const unfused = db.byName.get('Unfused Artifact');
assert.ok(unfused);
assert.equal(unfused.length, 33, '33 Plexus "Unfused Artifact" rows are kept (the 10 RandomMod ones are templates)');
assert.equal(new Set(unfused.map((r) => r.uniqueName)).size, 33, 'all distinct by path');
for (const r of unfused) assert.equal(db.byPath.get(r.uniqueName), r, 'each is the byPath row, by identity');
assert.ok(unfused.every((r) => r.ranks === 0 && r.effects.length === 0));
for (const list of db.byName.values()) assert.ok(Array.isArray(list) && list.length > 0, 'every byName value is a list');
assert.equal([...db.byName.values()].filter((l) => l.length > 1).length, 109, '109 names still cover more than one kept row');
assert.equal([...db.byName.values()].reduce((n, l) => n + l.length, 0), rows.length, 'byName partitions byPath; it never picks');
ok('byName maps "Unfused Artifact" to its 33 rows and 109 names to more than one row; a name is a resolver input, not an answer');

// --- the persisted shape --------------------------------------------------------------
{
  const parsed = parseModsRows(body);
  const json = JSON.stringify(parsed);
  const again = indexModDb(JSON.parse(json) as typeof parsed, 0);
  assert.equal(again.byPath.size, db.byPath.size, 'the JSON round-trip gentle performs rebuilds the same index');
  assert.equal(again.byName.size, db.byName.size);
  assert.deepEqual(again.dropped, db.dropped);
  assert.equal(again.fetchedAt, 0);
  const kb = Math.round(Buffer.byteLength(json) / 1024);
  ok(`the parsed value survives gentle's JSON persist (Maps are built on the way out); it measures ${String(kb)} KB against the 5 MB localStorage cliff`);
}

// --- the fetch path -----------------------------------------------------------------------
{
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as { data?: { externally_connectable?: { matches?: string[] } } };
  const hosts = manifest.data?.externally_connectable?.matches ?? [];
  const origin = new URL(MODS_URL).origin;
  assert.ok(hosts.includes(origin), `${origin} must be in the manifest's externally_connectable (the memory "the manifest is the CORS gate")`);
  ok(`${origin} is in externally_connectable, so the packaged app can fetch ${MODS_URL.slice(origin.length)}`);
}

// --- Part D, only with the real parser --------------------------------------------------------
if (parserPresent) {
  const maxEffect = (p: string, stat: RegExp): { rank: number; value: number | null } => {
    const r = db.byPath.get(p);
    assert.ok(r);
    const top = r.ranks - 1;
    const hit = r.effects.find((e) => e.rank === top && stat.test(e.stat));
    assert.ok(hit, `${p}: rank ${String(top)} has a ${stat.source} effect (refused: ${r.refused.map((x) => x.rule + ' ' + x.text).join(' | ')})`);
    return { rank: hit.rank, value: hit.value };
  };
  assert.deepEqual(maxEffect('/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod', /^damage$/i), { rank: 10, value: 165 }, 'F2/F4: Serration is +165 % Damage');
  assert.deepEqual(maxEffect('/Lotus/Upgrades/Mods/Pistol/WeaponFireIterationsMod', /multishot/i), { rank: 5, value: 120 }, 'F4: Barrel Diffusion +120 %, not the phantom 220');
  assert.deepEqual(maxEffect('/Lotus/Upgrades/Mods/Warframe/AvatarKnockdownRecoveryMod', /knockdown recovery/i), { rank: 3, value: 160 }, 'F4: Handspring +160 %, not 440');
  assert.deepEqual(maxEffect('/Lotus/Upgrades/Mods/Rifle/WeaponAmmoMaxMod', /ammo maximum/i), { rank: 5, value: 90 }, 'F4: Ammo Drum +90 %, not 165');
  const serrations = rows.filter((r) => r.type === 'Primary Mod' && r.displayName === 'Serration' && r.effects.some((e) => e.op === 'add_pct' && /^damage$/i.test(e.stat)));
  assert.deepEqual(serrations.map((r) => r.uniqueName), ['/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod'], 'F2: one Primary row named Serration carries add_pct damage');
  /*
   * F3 IS A PERCENTAGE BOUND, and the spec's first draft did not say so.
   * Run against every effect it fails on real data: Pack Leader and Primed
   * Pack Leader grant +600 … +2,200 Overguard Max, which are flat values and
   * entirely legitimate. A percentage above 500 would be a parse that read a
   * parameter as a magnitude; a flat value above 500 is just a big number.
   * The spec is corrected; the flat outliers are pinned here so a new one
   * cannot appear unnoticed.
   */
  const tooBig = rows.flatMap((r) =>
    r.effects.filter((e) => e.op === 'add_pct' && e.value !== null && e.value > 500).map((e) => `${r.uniqueName} rank ${String(e.rank)}: ${e.text}`),
  );
  assert.deepEqual(tooBig, [], 'F3: no kept percentage effect exceeds 500 outside R7 templates');
  const bigFlat = rows.flatMap((r) =>
    r.effects.filter((e) => e.op === 'add_flat' && e.value !== null && e.value > 500).map((e) => `${r.displayName}: ${e.text}`),
  );
  assert.deepEqual(
    [...new Set(bigFlat.map((s) => s.split(':')[0]))].sort(),
    ['Pack Leader', 'Primed Pack Leader'],
    'the only flat effects above 500 are the two Pack Leader rows (Overguard Max)',
  );
  assert.equal(bigFlat.length, 13, '13 of them, ranks 2-5 and 2-10');
  ok('with modstats present: Serration +165, Barrel Diffusion +120, Handspring +160, Ammo Drum +90; no percentage above 500, and the 13 flat ones are both Pack Leaders');
} else {
  console.log('  note  modstats.ts is not present; every stat line was refused under "no-parser" and the Part D checks (Serration +165, Barrel Diffusion +120, value <= 500) did not run');
}

// --- F7: the refusal histogram, a measurement in the baseline ----------------------------------------
{
  const byRule = new Map<string, { n: number; texts: Map<string, number> }>();
  let total = 0;
  for (const r of rows) {
    for (const x of r.refused) {
      total++;
      const bucket = byRule.get(x.rule) ?? { n: 0, texts: new Map<string, number>() };
      bucket.n++;
      bucket.texts.set(x.text, (bucket.texts.get(x.text) ?? 0) + 1);
      byRule.set(x.rule, bucket);
    }
  }
  const effects = rows.reduce((n, r) => n + r.effects.length, 0);
  console.log(`\nrefused: ${String(total)} lines across ${String(byRule.size)} rule(s); effects: ${String(effects)} (parser ${parserPresent ? 'present' : 'ABSENT - stub'})`);
  for (const [rule, b] of [...byRule].sort((a, c) => c[1].n - a[1].n)) {
    console.log(`  ${rule}  ${String(b.n)}`);
    for (const [text, n] of [...b.texts].sort((a, c) => c[1] - a[1]).slice(0, 10)) console.log(`      ${String(n).padStart(4)}  ${text}`);
  }
}

// --- the best source, which is what the overlay tells a player to go and do ---
{
  const withBest = rows.filter((r) => r.best !== null);
  const live = raw.filter((r) => db.byPath.has(r.uniqueName));
  /*
   * The row's `best` must be the highest-chance drop the export actually lists,
   * checked against the raw table rather than against itself - a projector that
   * silently picked the FIRST drop would agree with any assertion derived from
   * its own output.
   */
  let checked = 0;
  for (const r of live) {
    // Narrowed explicitly: the upstream row type declares `chance` as unknown,
    // and the whole point of this check is not to trust the shape.
    const rated = ((r.drops ?? []) as Array<{ chance?: unknown; location?: unknown }>)
      .map((d) => ({ chance: d.chance, location: d.location }))
      .filter((d): d is { chance: number; location: string } => typeof d.chance === 'number' && d.chance > 0 && typeof d.location === 'string');
    const row = db.byPath.get(r.uniqueName)!;
    if (rated.length === 0) {
      assert.equal(row.best, null, `${r.uniqueName}: a mod with no rated drop must have no best`);
      assert.equal(row.sources, 0, `${r.uniqueName}: sources must be zero`);
      continue;
    }
    const top = rated.reduce((a, b) => (b.chance > a.chance ? b : a));
    assert.equal(row.best?.chance, top.chance, `${r.uniqueName}: best is not the highest chance`);
    assert.equal(row.sources, rated.length, `${r.uniqueName}: sources miscounted`);
    checked++;
  }
  assert.ok(checked > 1_000, `only ${checked} rows had a rated drop to check`);
  ok(`best source verified against the raw table on ${checked} rows; ${withBest.length} rows carry one`);

  // A mod nobody can farm must be distinguishable from one nobody has looked up.
  const noDrop = rows.filter((r) => r.best === null);
  const tradableNoDrop = noDrop.filter((r) => r.tradable === true);
  assert.ok(tradableNoDrop.length > 0, 'no mod is both undroppable and tradable, which cannot be right');
  ok(`${noDrop.length} rows drop nowhere; ${tradableNoDrop.length} of those are tradable, which is a different answer`);
}

console.log('\ncheck-moddb: ok');
