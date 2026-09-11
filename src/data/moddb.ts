/**
 * The mod catalogue: WFCD's `Mods.json` after the Part A row filter of
 * docs/research/moddb-spec.md, keyed by `uniqueName`.
 *
 * THE ONE RULE ABOVE ALL OTHERS: IDENTITY IS `uniqueName`, NEVER `name`.
 * ————————————————————————————————————————————
 * Measured on the 2026-09-07 export (1,806 rows): 138 names cover 404 rows,
 * and "Unfused Artifact" alone covers 43. "Serration" is three rows - the
 * Flawed one (+40 % at cap), the real one (+165 %) and an Intermediate copy the
 * game no longer issues (+90 %); "Barrel Diffusion" has an Expert copy at
 * "+220 % Multishot" that nobody can own. A build optimiser that resolves a mod
 * by name, or by largest magnitude, silently pulls those into every build.
 * `byPath` is the index; `byName` exists for the leaf-name resolver and holds
 * every row sharing a name precisely so that no caller can mistake it for a
 * lookup - it never answers with one row.
 *
 * WHAT IS DROPPED, IN ORDER (A1 then A2; the order matters for the counts):
 *   A1  Conclave rows (`/PvPMods/`, `PvPAugmentCard`), DE's test row
 *       (`SampleAntiqueUpgrade`), the Railjack and riven random templates
 *       (`*RandomMod`) and the Transmutation cores. Riven templates carry
 *       per-rank multipliers with `|val|` placeholders; a player's real riven
 *       stats live in the inventory, not here.
 *   A2  Phantoms: an `Intermediate` or `Expert` tier copy of a mod whose
 *       untiered row also exists - unobtainable copies at inflated magnitudes.
 *       The rule is "tier marker AND a duplicated name": a row under `/Expert/`
 *       whose name is unique (the 66 Primed mods, Galvanized Elementalist /
 *       Reflex / Steel) is real and is KEPT. A path filter alone drops Primed
 *       Continuity. Measured: 108 phantoms (75 Expert + 33 Intermediate); the
 *       spec's "145" is the count of every row under `/Expert/`, i.e. the path
 *       filter it says is wrong - the gate pins both numbers by name.
 *   A6  A row whose stat text changes shape between ranks is corrupt data and
 *       is refused whole, by name, in `dropped.corrupt` - as is any row the
 *       export wrote without a string `uniqueName` or `name`.
 *
 * WHAT IS KEPT AS IT IS:
 *   A3  `Beginner` rows are the obtainable Flawed mods (104). `name` stays as
 *       the export wrote it; `displayName` carries the "Flawed " prefix.
 *   A4  Rows with no `levelStats` (Stances, Parazon, Plexus "Unfused Artifact",
 *       Mod Set carriers, …) produce zero effects. `description` is never read
 *       as a stat line - the parser is not even called for them.
 *   A8  `compatName` is the slot; missing on 206 kept rows, which is `null`
 *       (unknown), never "any". Auras are `baseDrain < 0` with slot `AURA` (36).
 *       `polarity: 'aura'` occurs on exactly one row (Dreamer's Bond) and is
 *       not the aura marker. `isAugment` is not carried at all: it is true on
 *       all 454 "Warframe Mod" rows including Vitality.
 *
 * ABSENT IS UNKNOWN, NEVER ZERO. The 19 Mod Set carriers have no `baseDrain`,
 * no `polarity` and no `fusionLimit`; they read `null` - not 0, which is a real
 * drain 138 rows have.
 *
 * Two entry points, one pure. `parseModsJson(body)` is what the gate tests.
 * `loadModDb()` reads through gentle like `loadItemDb` does, under its OWN
 * cache key, because gentle persists the PARSED value and a Map round-trips
 * through JSON as `{}` - so what gentle caches is `parseModsRows`'s plain
 * arrays, and the Maps are built on the way out.
 */

import { parseModStats, type Effect, type Refused } from './modstats.ts';

// ---------------------------------------------------------------------------
// Output shape (spec Part A)
// ---------------------------------------------------------------------------

export interface ModRow {
  uniqueName: string; // the key
  name: string; // as exported
  displayName: string; // 'Flawed ' + name on A3 rows
  slot: string | null; // compatName; null = unknown
  polarity: string | null;
  baseDrain: number | null;
  fusionLimit: number | null;
  ranks: number; // levelStats.length; 0 on A4 rows
  isAura: boolean; // baseDrain < 0 && slot === 'AURA'
  isFlawed: boolean;
  isExilus: boolean;
  isUtility: boolean;
  isPrime: boolean;
  rarity: string | null;
  type: string | null;
  modSet: string | null;
  modSetValues: number[] | null;
  thumbnail: string | null;
  tradable: boolean | null;
  /*
   * WHERE IT COMES FROM, and how often.
   *
   * The overlay tells a player they are missing a mod; without this that is
   * where the advice stops, and "taking into account WHEN you might get certain
   * mods" is in the brief. The upstream export carries 20,778 drop rows across
   * 1,401 mods and persisting all of them was measured at 1.1 MB, which is what
   * put the catalogue over the localStorage cliff and got them dropped
   * entirely. So only the BEST one is kept - the highest-chance location - plus
   * how many others there are. About 84 KB, and it is the only row the overlay
   * would ever show.
   *
   * null for a mod with no drop table at all: Baro's stock, quest rewards,
   * syndicate offerings. `tradable` is what distinguishes "buy it from another
   * player" from "nobody knows", and the two must not be conflated.
   */
  best: { where: string; chance: number } | null;
  /** How many places it drops from at all, so "one place only" can be said. */
  sources: number;
  introduced: string | null;
  effects: Effect[]; // from modstats, all ranks
  refused: Refused[]; // from modstats, all ranks
}

export interface ModDb {
  byPath: ReadonlyMap<string, ModRow>;
  /** Every row that shares a name — for the leaf-name resolver, never for lookup. */
  byName: ReadonlyMap<string, readonly ModRow[]>;
  dropped: { pvp: number; phantoms: number; templates: number; corrupt: string[] };
  fetchedAt: number | null;
}

/** The JSON-safe half: what gentle persists. Arrays, not Maps. */
export interface ParsedMods {
  rows: ModRow[];
  dropped: ModDb['dropped'];
}

/** jsDelivr, as itemdb.ts explains: DE's own CDN sends no Content-Encoding. */
export const MODS_URL = 'https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/Mods.json';

/** A NEW key, because the parse shape is new — see the memory "gentle caches parsed values". */
/*
 * v2 because the parsed SHAPE changed: rows now carry `best` and `sources`.
 * `gentle` caches parsed values, so a row written by v1 has neither field and
 * would read back as a mod that drops nowhere - a confident wrong answer rather
 * than a miss. A changed parse shape always needs a new key.
 */
export const MODS_CACHE_KEY = 'moddb.v2';

// ---------------------------------------------------------------------------
// Part A — the row filter (no parser involved)
// ---------------------------------------------------------------------------

const PVP = /\/PvPMods\/|PvPAugmentCard$/;
const TEMPLATE_PATH = /SampleAntiqueUpgrade|InnateDamageRandomMod|RandomMod/;
const TEMPLATE_TYPE = /Riven|Transmutation/;
/**
 * The Mods 1.0 tier marker, wherever the export put it: a path segment
 * (`/Melee/Expert/WeaponCritChanceSPMod`, which is Galvanized Steel and real)
 * or a leaf suffix (`WeaponDamageAmountModExpert`). Both spellings occur.
 */
const TIER = /\/(?:Intermediate|Expert)\/|(?:Intermediate|Expert)$/;
const FLAWED = /Beginner$/;

/** An export row that at least carries its identity. Everything else is read through `str`/`num`/`bool`. */
export interface WfcdMod {
  uniqueName: string;
  name: string;
  [field: string]: unknown;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
/** All finite numbers or nothing: a half-numeric list is not "some values". */
function nums(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const out: number[] = [];
  for (const x of v) {
    const n = num(x);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

/**
 * A1 and A2 over the raw export, plus the identity check: a row without a
 * string `uniqueName` or `name` cannot be keyed and is refused by position, a
 * second row with a `uniqueName` already seen is refused by that name. Nothing
 * here reads a stat string.
 */
export function filterModRows(rows: readonly unknown[]): { kept: WfcdMod[]; dropped: ModDb['dropped'] } {
  const dropped: ModDb['dropped'] = { pvp: 0, phantoms: 0, templates: 0, corrupt: [] };
  const survivors: WfcdMod[] = [];
  const seen = new Set<string>();
  rows.forEach((raw, i) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      dropped.corrupt.push(`row ${String(i)}: not an object`);
      return;
    }
    const row = raw as Record<string, unknown>;
    const uniqueName = str(row.uniqueName);
    const name = str(row.name);
    if (uniqueName === null) {
      dropped.corrupt.push(`row ${String(i)}: uniqueName is not a string`);
      return;
    }
    if (name === null) {
      dropped.corrupt.push(`${uniqueName}: name is not a string`);
      return;
    }
    if (seen.has(uniqueName)) {
      dropped.corrupt.push(`${uniqueName}: appears twice in the export`);
      return;
    }
    seen.add(uniqueName);
    // A1
    if (PVP.test(uniqueName)) {
      dropped.pvp++;
      return;
    }
    const type = str(row.type);
    if (TEMPLATE_PATH.test(uniqueName) || (type !== null && TEMPLATE_TYPE.test(type))) {
      dropped.templates++;
      return;
    }
    survivors.push({ ...row, uniqueName, name });
  });

  // A2, on the A1 survivors: a tier copy is a phantom only when the untiered
  // row of the same name exists. Two tier copies of a name nobody else has
  // would both be kept - that case does not occur, and inventing a winner
  // would be a guess.
  const untiered = new Set<string>();
  for (const r of survivors) if (!TIER.test(r.uniqueName)) untiered.add(r.name);
  const kept = survivors.filter((r) => {
    const phantom = TIER.test(r.uniqueName) && untiered.has(r.name);
    if (phantom) dropped.phantoms++;
    return !phantom;
  });
  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// Part A — the field allowlist (no parser involved)
// ---------------------------------------------------------------------------

/**
 * Only the allowlisted fields, read as they are. `levelStats` and
 * `description` are consumed by the parser and never stored raw.
 *
 * `drops` IS NOT KEPT, and the reason is measured: the persisted catalogue is
 * 3,666 KB with it and 2,558 KB without, against a 5 MB localStorage cliff
 * that `gentle`'s `commit()` swallows silently - the symptom of crossing it is
 * a 5.7 MB refetch on every launch, not an error. Where a mod drops is the
 * acquisition layer's job already (`acquire.ts`, `check-drop-sources.ts`); the
 * catalogue does not carry it a second time.
 */
/**
 * The single best place a mod drops, and how many places there are.
 *
 * "Best" is the highest CHANCE, not the lowest level or the easiest mission,
 * because chance is the only field the export gives that is comparable across
 * every kind of source - a bounty rotation, an assassination target and a
 * relic all state one. Anything richer than that would be this app inventing a
 * ranking it cannot support.
 *
 * A zero or missing chance is discarded rather than kept as the best: a source
 * that states no rate cannot be turned into "how long will this take", which is
 * the only reason any of it is stored.
 */
function bestDrop(row: WfcdMod): { best: ModRow['best']; sources: number } {
  const drops = Array.isArray(row.drops) ? row.drops : [];
  let best: ModRow['best'] = null;
  let sources = 0;
  for (const d of drops) {
    const where = str((d as { location?: unknown }).location);
    const chance = num((d as { chance?: unknown }).chance);
    if (where === null || chance === null || chance <= 0) continue;
    sources++;
    if (!best || chance > best.chance) best = { where, chance };
  }
  return { best, sources };
}

export function projectModRow(row: WfcdMod): Omit<ModRow, 'effects' | 'refused'> {
  const slot = str(row.compatName);
  const baseDrain = num(row.baseDrain);
  return {
    uniqueName: row.uniqueName,
    name: row.name,
    displayName: FLAWED.test(row.uniqueName) ? `Flawed ${row.name}` : row.name,
    slot,
    polarity: str(row.polarity),
    baseDrain,
    fusionLimit: num(row.fusionLimit),
    ranks: Array.isArray(row.levelStats) ? row.levelStats.length : 0,
    isAura: baseDrain !== null && baseDrain < 0 && slot === 'AURA',
    isFlawed: FLAWED.test(row.uniqueName),
    // Present-only-when-true in the export; absent is the export's own "false".
    isExilus: row.isExilus === true,
    isUtility: row.isUtility === true,
    isPrime: row.isPrime === true,
    rarity: str(row.rarity),
    type: str(row.type),
    modSet: str(row.modSet),
    modSetValues: nums(row.modSetValues),
    thumbnail: str(row.wikiaThumbnail),
    tradable: bool(row.tradable),
    ...bestDrop(row),
    // WFCD nests the update as `{ name: 'Update 15.6', ... }`.
    introduced: str((row.introduced as { name?: unknown } | null | undefined)?.name),
  };
}

/**
 * `levelStats[r].stats` for every rank, or `null` on an A4 row. A `levelStats`
 * that is present but not an array of `{ stats: string[] }` is named as
 * corrupt rather than read as "no ranks".
 */
export function levelStatsOf(row: WfcdMod): { ranks: string[][] | null; corrupt: string | null } {
  const raw = row.levelStats;
  if (raw === undefined) return { ranks: null, corrupt: null };
  if (!Array.isArray(raw)) return { ranks: null, corrupt: 'levelStats is not an array' };
  const ranks: string[][] = [];
  for (let r = 0; r < raw.length; r++) {
    const level = raw[r] as { stats?: unknown } | null;
    const stats: unknown = level?.stats;
    if (!Array.isArray(stats) || !stats.every((s): s is string => typeof s === 'string')) {
      return { ranks: null, corrupt: `levelStats[${String(r)}].stats is not a string list` };
    }
    ranks.push(stats);
  }
  return { ranks, corrupt: null };
}

// ---------------------------------------------------------------------------
// Parse + index
// ---------------------------------------------------------------------------

/**
 * The JSON-safe parse gentle persists. A body that is not an array throws:
 * gentle then keeps whatever it last had, which is the right outcome — an
 * empty catalogue would read as "there are no mods".
 */
export function parseModsRows(body: string): ParsedMods {
  const root: unknown = JSON.parse(body);
  if (!Array.isArray(root)) throw new Error('Mods.json is not an array');
  const { kept, dropped } = filterModRows(root);
  const rows: ModRow[] = [];
  for (const raw of kept) {
    const base = projectModRow(raw);
    const levels = levelStatsOf(raw);
    if (levels.corrupt !== null) {
      dropped.corrupt.push(`${raw.uniqueName}: ${levels.corrupt}`);
      continue;
    }
    // A4: no stat lines, no effects, and the description is never a stat.
    if (levels.ranks === null) {
      rows.push({ ...base, effects: [], refused: [] });
      continue;
    }
    const parsed = parseModStats({
      uniqueName: raw.uniqueName,
      name: raw.name,
      description: str(raw.description),
      levelStats: levels.ranks,
    });
    // A6: a shape that differs between ranks is corrupt data. The whole row
    // goes, by name, rather than one rank being trusted over another.
    if (parsed.corrupt !== null) {
      dropped.corrupt.push(`${raw.uniqueName}: ${parsed.corrupt}`);
      continue;
    }
    rows.push({ ...base, effects: parsed.effects, refused: parsed.refused });
  }
  return { rows, dropped };
}

/** Build the two indexes. `byName` collects; it never picks. */
export function indexModDb(parsed: ParsedMods, fetchedAt: number | null): ModDb {
  const byPath = new Map<string, ModRow>();
  const byName = new Map<string, ModRow[]>();
  for (const row of parsed.rows) {
    byPath.set(row.uniqueName, row);
    const same = byName.get(row.name);
    if (same) same.push(row);
    else byName.set(row.name, [row]);
  }
  return { byPath, byName, dropped: parsed.dropped, fetchedAt };
}

/** Pure; what the gate tests. `fetchedAt` is null because nothing was fetched. */
export function parseModsJson(body: string): ModDb {
  return indexModDb(parseModsRows(body), null);
}

/**
 * Fetch and index through gentle with `POLICY.staticData` (24 h TTL, 6 h
 * floor, persisted), the same path `loadItemDb` takes. A failed first read
 * THROWS rather than returning an empty catalogue: the caller can show "the
 * mod catalogue is unavailable", and must never be handed a db in which every
 * mod is missing.
 */
export async function loadModDb(): Promise<ModDb> {
  // Imported lazily so everything above stays loadable by
  // `node scripts/check-moddb.ts`, which cannot resolve extensionless specifiers.
  const { gentle, httpLoader, POLICY } = await import('../core/gentle');
  const read = await gentle.read(MODS_CACHE_KEY, POLICY.staticData, httpLoader(MODS_URL), parseModsRows);
  return indexModDb(read.value, read.at);
}
