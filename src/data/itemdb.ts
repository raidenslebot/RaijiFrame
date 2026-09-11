/**
 * Item catalog, and the join from the account's inventory onto it.
 *
 * Two halves:
 *
 *   1. The catalog — fetched, never bundled. WFCD's `masterable` flag is the only
 *      machine-readable "does this grant mastery" signal that exists, so it is the
 *      denominator; `-plus` supplies the two things WFCD does not carry (the
 *      booster type map and `maxLevelCap`).
 *   2. The join — every account `ItemType` goes through `normaliseItemType` before
 *      lookup, and anything that still fails to match is REPORTED, not dropped.
 *      An unmatched type means our catalog is wrong, and we want to see that.
 *
 * Honesty rules this file follows, because the numbers here end up on screen:
 *   - A category whose fetch failed is ABSENT from the db, not zero. A missing
 *     dataset must never read as "you own none of these".
 *   - `vaulted` is wiki-derived and can be missing; absent means unknown, not
 *     "obtainable". Vaulted counts are reported alongside, never folded in.
 *   - Founder-exclusive items are removed from BOTH sides of the ratio, so an
 *     account can actually reach 100 %.
 */

import type { RawInventory } from '../core/gep';
import { EQUIPMENT_KEYS } from './account.ts';

// ---------------------------------------------------------------------------
// The normaliser
// ---------------------------------------------------------------------------

const STORE = '/Lotus/StoreItems/';

export interface BoosterRow {
  /** The bare type the account actually stores. */
  typeName?: string;
}
export type BoosterMap = Readonly<Record<string, BoosterRow | undefined>>;

/**
 * Map any item reference onto the bare `/Lotus/...` namespace the account and the
 * catalogs both use.
 *
 * This is the single most load-bearing function in the file. Reward, vendor and
 * store tables speak `/Lotus/StoreItems/...`; catalogs and inventory speak bare.
 * Research verified the rewrite three independent ways — 18,536 of 18,536 real
 * relic reward references resolve after it, DE's own catalogs are 100 % bare, and
 * SpaceNinjaServer's `fromStoreItem` is character-for-character this rule.
 *
 * Boosters are the one exception: they carry no `StoreItems` prefix and must be
 * looked up in `ExportBoosters` instead. Without that map, 11 booster types
 * silently never match.
 *
 * Idempotent on already-bare strings, which is why it is safe (and required) to
 * run over every account type even though the account is believed to store bare
 * types already — WFCD's own build leaked 14 prefixed rows, so it demonstrably
 * happens.
 */
export function normaliseItemType(t: string, boosters: BoosterMap = {}): string {
  if (t.startsWith(STORE)) return '/Lotus/' + t.slice(STORE.length);
  return boosters[t]?.typeName ?? t;
}

// ---------------------------------------------------------------------------
// Catalog shape
// ---------------------------------------------------------------------------

/**
 * Categories are WFCD **filenames**, not the `category` field inside the rows.
 * Every row in `SentinelWeapons.json` claims `"category": "Primary"`, so bucketing
 * by the field silently merges 24 companion weapons into the primary count.
 */
export const ITEM_CATEGORIES = [
  'Warframes',
  'Primary',
  'Secondary',
  'Melee',
  'Sentinels',
  'SentinelWeapons',
  'Pets',
  'Archwing',
  'Arch-Gun',
  'Arch-Melee',
  'Misc',
] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export interface ItemDbEntry {
  uniqueName: string;
  name: string;
  category: ItemCategory;
  /** DE's inventory-routing key (`Suits`, `LongGuns`, …). Not on every row. */
  productCategory?: string;
  /** WFCD's display type: `Rifle`, `Warframe`, `Zaw Component`. */
  type?: string;
  masteryReq: number;
  /**
   * Grants mastery. WFCD's own derived flag — there is no DE field for it, so
   * this is the one number in the catalog with no primary source.
   */
  masterable: boolean;
  /** 30, or 40 for the 52 Kuva/Tenet/Coda/Paracesis weapons and the 2 Necramechs. */
  maxRank: number;
  rarity?: string;
  /** Wiki-derived. Absent means UNKNOWN, not "not vaulted". */
  vaulted?: boolean;
  tradable?: boolean;
  imageName?: string;
  /**
   * The item's own codex text.
   *
   * Carried because every item detail in this app - Mastery, Arsenal, Nemesis,
   * Collection - had artwork and a row of numbers and NOTHING that says what the
   * thing actually is, while the source has had a description for all 882 of
   * them the whole time. It was being discarded by the projection below purely
   * as a size measure, and the measurement turned out not to justify it.
   */
  description?: string;
  /** e.g. "Update 9.0". Short, and the only date context the catalog gives. */
  introduced?: string;
  /**
   * How the thing is actually made.
   *
   * The foundry panel states on screen that the item catalog "indexes finished
   * products, not recipes, and carries no build times and no ingredient lists".
   * That was never true of the SOURCE - it was true of this file, which threw
   * all of these away. Measured cost of keeping them: about 157 bytes per item.
   */
  buildTime?: number;
  buildPrice?: number;
  buildQuantity?: number;
  /** Platinum to rush. */
  skipBuildTimePrice?: number;
  /*
   * A COMPONENT'S NAME IS NOT ITS IDENTITY.
   *
   * This carried name and count only, and the name is not a key: measured
   * across all eleven categories, 187 of the 324 distinct component names are
   * shared by more than one item. "Blueprint" appears 901 times. "Systems"
   * 126, "Chassis" 118, "Neuroptics" 114 - which is to say every single
   * warframe's three parts collide with every other warframe's.
   *
   * So a join on the name cannot answer "do I hold Ash's Chassis": it cannot
   * even tell Ash's from Ash Prime's. WFCD sends a `uniqueName` on every
   * component - the same `/Lotus/...` path the account's own inventory rows
   * are keyed by - and it was being dropped, which left the ingredient list
   * readable by a person and unusable by the program.
   *
   * Measured cost of keeping it, the way every other field here was measured:
   * the component lists go from 145.3 KB to 415.7 KB across 901 buildable
   * items and 4,074 components. That is 270 KB, against the 5 MB cliff.
   *
   * Optional because the source omits it on a handful of rows. Absent means
   * the amount held CANNOT BE READ - never that it is zero.
   */
  components?: Array<{
    name: string;
    itemCount?: number;
    uniqueName?: string;
    /**
     * WHERE THE THING ACTUALLY DROPS.
     * ————————————————————————————————————————————
     * The foundry can say "you are short one Chassis" and has never been able
     * to say where to get one - while the answer sat on the same component
     * object the ingredient list came from, and `parseComponents` dropped it.
     *
     * WFCD carries every source with a location and a chance: 3,249 of the
     * 4,074 components have them, 192,675 sources in total. Keeping all of them
     * costs 707 KB; keeping the best FOUR costs the same order. Keeping the
     * single best plus a count costs 207 KB, measured, and answers the question
     * a player is actually asking - "where are the best odds, and is there more
     * than one place" - so that is what is kept.
     *
     * `n` is the honest half: a part with one source at 13% is a different
     * proposition from one with nine, and a best-of that hid the count would
     * quietly make every part look like a single grind.
     */
    from?: { at: string; pct: number; n: number };
  }>;
  /**
   * A warframe's four abilities.
   *
   * `description` is optional per ability on purpose - see `parseAbilities`.
   */
  abilities?: Array<{ name: string; description?: string }>;
  /**
   * The numbers a weapon is actually judged on.
   *
   * Absent on everything that is not a weapon, so each one drops out of the UI
   * rather than rendering a zero. `criticalChance` and `procChance` arrive as
   * fractions (0.12, not 12) and carry float noise - 6% status is sent as
   * 0.060000002 - so both are rounded at the point of display, not here: the
   * stored value stays the one the source gave.
   */
  criticalChance?: number;
  criticalMultiplier?: number;
  procChance?: number;
  fireRate?: number;
  magazineSize?: number;
  reloadTime?: number;
  totalDamage?: number;
  /** Riven disposition, 1 to 5. Higher means stronger rivens. */
  disposition?: number;
  /*
   * A WARFRAME'S OWN NUMBERS, and why they were missing until now.
   *
   * The projection carried only the weapon fields, so a Warframe resolved to a
   * name and nothing else. That was invisible until the player's real log was
   * replayed: FOUR of their ten modding-screen visits were the Warframe slot,
   * and on every one of them the overlay identified the frame and then had
   * nothing whatever to say. Forty per cent of the modding this account
   * actually does, unserved, and nothing in the project had a way to know it.
   *
   * All 121 frames upstream carry all four.
   */
  health?: number;
  shield?: number;
  armor?: number;
  power?: number;
  sprintSpeed?: number;
  /*
   * THE MODDING SURFACE (2026-09-07). Everything the auto-modder computes from,
   * read straight off the export and never derived. Absent means the export
   * did not say - `polarities` is missing on 203 of 612 weapons and that is
   * "unknown", never "no polarised slots". Fractions stay fractions:
   * `criticalChance` 0.2 is 20 %.
   */
  /**
   * 20 damage-type values per shot, in the export's own order: 0 impact,
   * 1 puncture, 2 slash, 3 heat, 4 cold, 5 electricity, 6 toxin, 7 blast,
   * 8 radiation, 9 gas, 10 magnetic, 11 viral, 12 corrosive, 13 void, 14 tau,
   * 15 cinematic, 16 shieldDrain, 17 healthDrain, 18 energyDrain, 19 true.
   * Per PELLET on multishot weapons (Hek: 75 per pellet, 7 pellets).
   */
  damagePerShot?: number[];
  /** Base pellet count, guns only (1..15). */
  multishot?: number;
  /** Auto, Semi, Charge, Held, Burst, Active, Duplex, Auto Burst. Guns only. */
  trigger?: string;
  /** Innate slot polarities as the export names them ('madurai', …). Absent = unknown. */
  polarities?: string[];
  exilusPolarity?: string;
  /** Melee only. */
  stancePolarity?: string;
  /** Per fire mode / attack. `attacks[0]` is NOT always the primary fire (7 guns). */
  attacks?: Array<{
    name: string;
    speed?: number;
    critChance?: number;
    critMult?: number;
    statusChance?: number;
    /** Sparse: only the types the mode deals, keyed by the export's damage-type name. */
    damage?: Record<string, number>;
  }>;
  /** Melee block. */
  range?: number;
  comboDuration?: number;
  followThrough?: number;
  windUp?: number;
  blockingAngle?: number;
  slamAttack?: number;
  slideAttack?: number;
  heavyAttackDamage?: number;
  accuracy?: number;
  noise?: string;
  isPrime?: boolean;
}

export interface ItemDb {
  /**
   * Keyed by `uniqueName` - the raw `/Lotus/...` path, NOT the display name.
   *
   * Renamed from `byName`, which is what it was called for most of this
   * project's life and which is a trap: it reads as "look an item up by its
   * name", three separate panels did exactly that with a display name in hand,
   * and every one of those lookups silently returned undefined. Because the
   * consumers treat a miss as "this item is not in the catalog export", the
   * result was three panels confidently stating that Nova is not in the game's
   * item catalog.
   *
   * If you have a display name, you want `byDisplayName` below.
   */
  byType: ReadonlyMap<string, ItemDbEntry>;
  /**
   * Keyed by display name, for the many places that only have one.
   *
   * FIRST ENTRY WINS on a collision. Display names are not guaranteed unique
   * across categories, so this is a convenience index and not an identity: any
   * code that must be exact about WHICH item it has should carry the
   * `uniqueName` and use `byType`.
   */
  byDisplayName: ReadonlyMap<string, ItemDbEntry>;
  byCategory: ReadonlyMap<ItemCategory, readonly ItemDbEntry[]>;
  /**
   * Masterable rows per category, as fetched. Compared against Appendix A on
   * build; `ownership()`'s denominator is this minus the never-obtainable items.
   */
  masterable: ReadonlyMap<ItemCategory, number>;
  boosters: BoosterMap;
  /** Categories whose fetch failed. Their numbers are unknown, not zero. */
  missingCategories: ItemCategory[];
}

/**
 * Verified masterable counts per category (research Appendix A, 803 total).
 * A cross-check only — the live fetch is the source of truth, but a material
 * disagreement means WFCD changed shape and our denominators need a look.
 */
export const MASTERABLE_APPENDIX_A: Readonly<Record<ItemCategory, number>> = {
  Warframes: 120,
  Primary: 195,
  Secondary: 148,
  Melee: 235,
  Sentinels: 17,
  SentinelWeapons: 24,
  Pets: 22,
  Archwing: 5,
  'Arch-Gun': 20,
  'Arch-Melee': 8,
  Misc: 9,
};

/**
 * DE publishes no rank-40 cap for Necramechs (`maxLevelCap` is absent from
 * `ExportWarframes`, and the two research docs disagree on whether it is on 0 or
 * 2 rows), so the two types are hardcoded. Both paths are verified.
 */
const NECRAMECHS: ReadonlySet<string> = new Set([
  '/Lotus/Powersuits/EntratiMech/NechroTech',
  '/Lotus/Powersuits/EntratiMech/ThanoTech',
]);

/**
 * Founder-exclusive items: owned by nobody who did not buy a Founder pack in
 * 2013, and obtainable by no means since. They come out of BOTH sides of the
 * ratio — otherwise no account can ever read 100 % and the panel is noise.
 *
 * Matched by display name: the research verified these three items exist and are
 * unobtainable, but did not verify their `uniqueName`s, and inventing a path is
 * exactly the failure mode this codebase has already been burned by.
 */
const FOUNDER_ONLY: ReadonlySet<string> = new Set(['Excalibur Prime', 'Lato Prime', 'Skana Prime']);

/** Categories that earn 200 mastery per rank rather than 100. */
const FRAME_RATE: ReadonlySet<ItemCategory> = new Set(['Warframes', 'Archwing', 'Sentinels', 'Pets']);

/**
 * The verified equipment arrays, minus `SpecialItems`.
 *
 * `SpecialItems` holds exalted weapons (Exalted Blade, Venari, Diwata). They
 * grant no mastery and appear in no catalog file we fetch, so scanning them would
 * fill `unmatched` with expected noise and destroy its value as a bug signal.
 *
 * DERIVED, NOT TRANSCRIBED. This was the third hand-written copy of DE's
 * twenty-seven-array list; `account.ts` holds the transcription of record and
 * cites the schema section for it. Subtracting the one exclusion in code says
 * exactly what the paragraph above claims - "the verified arrays, minus
 * SpecialItems" - and cannot drift away from the list it claims to be a subset
 * of, which a fourth copy of the strings could do the moment DE adds an array.
 */
const EXALTED_BIN = 'SpecialItems';
const EQUIPMENT_BINS: readonly string[] = EQUIPMENT_KEYS.filter((k) => k !== EXALTED_BIN);

// ---------------------------------------------------------------------------
// Fetch + parse
// ---------------------------------------------------------------------------

/**
 * jsDelivr, not `content.warframe.com`. DE's CDN sends no `Content-Encoding` at
 * all — the same catalog coverage costs 14.3 MB there and a few hundred KB here.
 * Both hosts send `Access-Control-Allow-Origin: *`, so no proxy is involved.
 */
const WFCD = 'https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/';
const PLUS = 'https://cdn.jsdelivr.net/npm/warframe-public-export-plus@latest/';

interface WfcdRow {
  uniqueName?: unknown;
  name?: unknown;
  type?: unknown;
  buildTime?: unknown;
  buildPrice?: unknown;
  buildQuantity?: unknown;
  skipBuildTimePrice?: unknown;
  components?: unknown;
  abilities?: unknown;
  criticalChance?: unknown;
  criticalMultiplier?: unknown;
  procChance?: unknown;
  fireRate?: unknown;
  magazineSize?: unknown;
  reloadTime?: unknown;
  totalDamage?: unknown;
  /* A Warframe's own numbers; every frame upstream carries all four. */
  health?: unknown;
  shield?: unknown;
  armor?: unknown;
  power?: unknown;
  sprintSpeed?: unknown;
  disposition?: unknown;
  productCategory?: unknown;
  masteryReq?: unknown;
  masterable?: unknown;
  vaulted?: unknown;
  tradable?: unknown;
  imageName?: unknown;
  rarity?: unknown;
  description?: unknown;
  /** WFCD nests the update as an object; only its `name` is wanted. */
  introduced?: { name?: unknown } | unknown;
  damagePerShot?: unknown;
  multishot?: unknown;
  trigger?: unknown;
  polarities?: unknown;
  exilusPolarity?: unknown;
  stancePolarity?: unknown;
  attacks?: unknown;
  range?: unknown;
  comboDuration?: unknown;
  followThrough?: unknown;
  windUp?: unknown;
  blockingAngle?: unknown;
  slamAttack?: unknown;
  slideAttack?: unknown;
  heavyAttackDamage?: unknown;
  accuracy?: unknown;
  noise?: unknown;
  isPrime?: unknown;
}

/** A 20-number damage vector, or nothing: a short or non-numeric array is not "some damage". */
function parseDamageVector(v: unknown): number[] | undefined {
  if (!Array.isArray(v) || v.length !== 20) return undefined;
  const out: number[] = [];
  for (const x of v) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return undefined;
    out.push(x);
  }
  return out;
}

function parseStrings(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string');
  return out.length === v.length ? out : undefined;
}

/**
 * The per-mode breakdown. The export spells its keys crit_chance / crit_mult /
 * status_chance and carries percent numbers here (20 = 20 %) where the row's
 * top level carries fractions (0.2); this keeps the export's numbers as they
 * are and names them so the caller cannot mistake one for the other.
 */
function parseAttacks(v: unknown): ItemDbEntry['attacks'] {
  if (!Array.isArray(v)) return undefined;
  const out: NonNullable<ItemDbEntry['attacks']> = [];
  for (const raw of v) {
    const a = raw as Record<string, unknown> | null;
    const name = str(a?.name);
    if (!name) continue;
    const dmgRaw = a?.damage;
    let damage: Record<string, number> | undefined;
    if (dmgRaw && typeof dmgRaw === 'object' && !Array.isArray(dmgRaw)) {
      damage = {};
      for (const [k, x] of Object.entries(dmgRaw as Record<string, unknown>)) if (typeof x === 'number') damage[k] = x;
    }
    out.push({
      name,
      speed: num(a?.speed),
      critChance: num(a?.crit_chance),
      critMult: num(a?.crit_mult),
      statusChance: num(a?.status_chance),
      damage,
    });
  }
  return out.length ? out : undefined;
}

/**
 * Just the name and the count from each component.
 *
 * WFCD sends a whole nested item per component - its own description, artwork,
 * drops and patch logs - which is most of the weight of the raw file. What a
 * player needs from a recipe is what goes in and how many, so that is all this
 * keeps; the rest is exactly the bulk the projection exists to shed.
 */
/**
 * DE's runtime substitution markers, e.g. `|CHANCE|`, `|PERCENT|`, `|DURATION|`.
 *
 * The game fills these in from the ability's live stats; the export ships them
 * raw. A description containing one cannot be shown - "enemies have |CHANCE|% to
 * drop health orbs" is a broken string, and stripping the token leaves "have % to
 * drop", which is worse. So a templated description is treated as ABSENT.
 *
 * Measured against the live export before deciding what to carry: of 513 ability
 * descriptions only 2 are templated, so abilities are worth having. Of 118
 * passive descriptions 88 are templated, which is why `passiveDescription` is
 * deliberately not carried at all - three quarters of it would be unshowable.
 */
const TEMPLATE_TOKEN = /\|[A-Z_]+\|/;

/**
 * DE's inline FORMATTING markup, e.g. `<DT_FIRE_COLOR>`, `<HEALTH>`, `<br>`.
 *
 * A different animal from TEMPLATE_TOKEN above, and handled the opposite way.
 * These are not missing values - they are colour and icon markers that sit
 * immediately in front of the word they decorate:
 *
 *     "<HEALTH>Health Orb"            -> "Health Orb"
 *     "<AFFINITY_SHARE>Affinity Range" -> "Affinity Range"
 *     "<DT_SENTIENT_COLOR>Tau Status"  -> "Tau Status"
 *
 * Removing them therefore LOSES NOTHING, where removing a `|CHANCE|` would leave
 * "have % to drop". So templated descriptions are dropped and marked-up ones are
 * cleaned. 90 of the 513 ability descriptions carry this markup; without the
 * cleaning, one in six abilities rendered with a raw tag in the middle of the
 * sentence.
 */
const MARKUP_TAG = /<[^>]{1,40}>/g;

/** `<br>` is a line break and has to leave a space behind; the rest just go. */
function cleanMarkup(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(MARKUP_TAG, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ability names, and their descriptions where those are actually renderable.
 *
 * The NAME is always clean, and is worth keeping even when the description is
 * not - "Null Star, Antimatter Drop, Worm Hole, Molecular Prime" tells you what
 * a warframe does far better than nothing does.
 */
function parseAbilities(v: unknown): Array<{ name: string; description?: string }> | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Array<{ name: string; description?: string }> = [];
  for (const raw of v) {
    const row = raw as { name?: unknown; description?: unknown } | null;
    const name = str(row?.name);
    if (name === undefined) continue;
    const desc = str(row?.description);
    const clean = desc === undefined || TEMPLATE_TOKEN.test(desc) ? undefined : cleanMarkup(desc);
    out.push(clean !== undefined && clean.length > 0 ? { name, description: clean } : { name });
  }
  return out.length > 0 ? out : undefined;
}

type ParsedComponent = {
  name: string;
  itemCount?: number;
  uniqueName?: string;
  from?: { at: string; pct: number; n: number };
};

/** The best source for one component, and how many there are in total. */
function bestSource(v: unknown): { at: string; pct: number; n: number } | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  let at: string | undefined;
  let pct = -1;
  let n = 0;
  for (const raw of v) {
    const row = raw as { location?: unknown; chance?: unknown } | null;
    const where = str(row?.location);
    if (where === undefined) continue;
    n += 1;
    const chance = num(row?.chance) ?? 0;
    if (chance > pct) {
      pct = chance;
      at = where;
    }
  }
  return at === undefined ? undefined : { at, pct: Math.round(pct * 100) / 100, n };
}

function parseComponents(v: unknown): ParsedComponent[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ParsedComponent[] = [];
  for (const raw of v) {
    const row = raw as { name?: unknown; itemCount?: unknown; uniqueName?: unknown; drops?: unknown } | null;
    const name = str(row?.name);
    if (name === undefined) continue;
    const count = num(row?.itemCount);
    const id = str(row?.uniqueName);
    const from = bestSource(row?.drops);
    const base: ParsedComponent = count === undefined ? { name } : { name, itemCount: count };
    if (id !== undefined) base.uniqueName = id;
    if (from !== undefined) base.from = from;
    out.push(base);
  }
  return out.length > 0 ? out : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Project a WFCD category file down to lean entries *inside the parse step*.
 *
 * Deliberate: `Primary.json` is 10.5 MB of stat blocks and gentle persists
 * whatever `parse` returns into localStorage, which is a synchronous ~5 MB cliff.
 * Keeping only the fields the app reads turns the whole catalog into ~220 KB.
 *
 * WHAT IS STILL DROPPED, AND WHY IT MIGHT NOT DESERVE TO BE
 * ────────────────────────────────────────────────────────
 * The source also carries `abilities`, `passiveDescription`, base stats
 * (health/shield/armor/power), `components`, `buildTime`, `buildPrice`,
 * `polarities` and `wikiaUrl`. Those are not dropped because they are useless -
 * several are things panels currently say the catalog does not know. In
 * particular the foundry's "the item catalog carries no recipe and no build
 * times" is a consequence of THIS function, not of the data.
 *
 * `description` and `introduced` were pulled back in after measuring rather than
 * assuming. Whole-of-localStorage before: 303 KB. After: 435 KB. The cliff is
 * 5 MB, so the size argument that had justified dropping them was against a
 * limit eleven times further away than the number it produced.
 *
 * The recipe fields followed, measured the same way. Whole-of-localStorage after
 * adding buildTime, buildPrice, skipBuildTimePrice, buildQuantity and
 * components-as-name-and-count: 624 KB, against that 5 MB cliff. (The estimate
 * beforehand was 575 KB; the figure here is the one that was actually read back
 * off a cold cache, because an estimate is not a measurement.)
 *
 * `abilities` followed, measured the same way: 94 KB across the 126 warframes,
 * taking the whole catalog to 726 KB read back off a cold cache. The weapon
 * stat block after it is 15 KB across the 195 primaries.
 *
 * What is still dropped: `patchlogs`, the fully-nested component items WFCD
 * actually sends, and `passiveDescription` - that last one not for size but
 * because 88 of its 118 entries are unfilled templates (see TEMPLATE_TOKEN).
 * The point is not that size does not matter here; it is that this budget had
 * never been counted, and every field added since has been measured rather than
 * argued about.
 */
export function parseWfcd(category: ItemCategory, body: string): ItemDbEntry[] {
  const rows: unknown = JSON.parse(body);
  if (!Array.isArray(rows)) return [];
  const out: ItemDbEntry[] = [];
  for (const raw of rows) {
    const row = raw as WfcdRow | null;
    const uniqueName = str(row?.uniqueName);
    if (!uniqueName) continue;
    const masterable = row?.masterable === true;
    // Misc is the 1256-row junk drawer and only its 9 masterable modular parts
    // are ownable equipment; the rest can never appear in an equipment array.
    if (category === 'Misc' && !masterable) continue;
    out.push({
      // WFCD's build leaked 14 `/Lotus/StoreItems/` rows into Misc.json.
      uniqueName: normaliseItemType(uniqueName),
      name: str(row?.name) ?? uniqueName,
      category,
      productCategory: str(row?.productCategory),
      type: str(row?.type),
      masteryReq: num(row?.masteryReq) ?? 0,
      masterable,
      maxRank: 30,
      rarity: str(row?.rarity),
      vaulted: bool(row?.vaulted),
      tradable: bool(row?.tradable),
      imageName: str(row?.imageName),
      description: str(row?.description),
      buildTime: num(row?.buildTime),
      buildPrice: num(row?.buildPrice),
      buildQuantity: num(row?.buildQuantity),
      skipBuildTimePrice: num(row?.skipBuildTimePrice),
      components: parseComponents(row?.components),
      abilities: parseAbilities(row?.abilities),
      criticalChance: num(row?.criticalChance),
      criticalMultiplier: num(row?.criticalMultiplier),
      procChance: num(row?.procChance),
      fireRate: num(row?.fireRate),
      magazineSize: num(row?.magazineSize),
      reloadTime: num(row?.reloadTime),
      totalDamage: num(row?.totalDamage),
      disposition: num(row?.disposition),
      health: num(row?.health),
      shield: num(row?.shield),
      armor: num(row?.armor),
      power: num(row?.power),
      sprintSpeed: num(row?.sprintSpeed),
      // WFCD nests this as `{ name: 'Update 9.0', ... }`.
      introduced: str((row?.introduced as { name?: unknown } | undefined)?.name),
      damagePerShot: parseDamageVector(row?.damagePerShot),
      multishot: num(row?.multishot),
      trigger: str(row?.trigger),
      polarities: parseStrings(row?.polarities),
      exilusPolarity: str(row?.exilusPolarity),
      stancePolarity: str(row?.stancePolarity),
      attacks: parseAttacks(row?.attacks),
      range: num(row?.range),
      comboDuration: num(row?.comboDuration),
      followThrough: num(row?.followThrough),
      windUp: num(row?.windUp),
      blockingAngle: num(row?.blockingAngle),
      slamAttack: num(row?.slamAttack),
      slideAttack: num(row?.slideAttack),
      heavyAttackDamage: num(row?.heavyAttackDamage),
      accuracy: num(row?.accuracy),
      noise: str(row?.noise),
      isPrime: bool(row?.isPrime),
    });
  }
  return out;
}

/** `-plus` ships `{uniqueName: row}`; tolerate a DE-style `{ExportX: {…}}` wrapper. */
function unwrap(body: string, key: string): Record<string, unknown> {
  const root: unknown = JSON.parse(body);
  if (!root || typeof root !== 'object' || Array.isArray(root)) return {};
  const obj = root as Record<string, unknown>;
  const inner = obj[key];
  return inner && typeof inner === 'object' && !Array.isArray(inner) ? (inner as Record<string, unknown>) : obj;
}

export function parseBoosters(body: string): Record<string, BoosterRow> {
  const src = unwrap(body, 'ExportBoosters');
  const out: Record<string, BoosterRow> = {};
  for (const [k, v] of Object.entries(src)) {
    const typeName = str((v as { typeName?: unknown } | null)?.typeName);
    if (typeName) out[k] = { typeName };
  }
  return out;
}

/**
 * The rank-40 weapons. Returns an array rather than a Set because gentle persists
 * parsed values as JSON, and a Set round-trips to `{}`.
 */
export function parseRank40(body: string): string[] {
  const src = unwrap(body, 'ExportWeapons');
  const out: string[] = [];
  for (const [k, v] of Object.entries(src)) {
    const cap = num((v as { maxLevelCap?: unknown } | null)?.maxLevelCap);
    if (cap !== undefined && cap > 30) out.push(normaliseItemType(k));
  }
  return out;
}

async function grab<T>(key: string, url: string, parse: (body: string) => T): Promise<T | undefined> {
  try {
    // Imported lazily so everything below the fetch layer stays loadable by
    // `node scripts/check-itemdb.ts`, which cannot resolve extensionless specifiers.
    const { gentle, httpLoader, POLICY } = await import('../core/gentle');
    return (await gentle.read(key, POLICY.staticData, httpLoader(url), parse)).value;
  } catch (err) {
    // Partial failure degrades: the category is reported missing, never zeroed.
    console.warn(`[itemdb] ${key} unavailable`, err);
    return undefined;
  }
}

/**
 * Fetch and index the catalog. Every read goes through gentle with
 * `POLICY.staticData` (24 h TTL, 6 h floor, persisted) and revalidates
 * conditionally, so a repeat launch costs a handful of 304s.
 */
export async function loadItemDb(): Promise<ItemDb> {
  const [boosters, rank40, parts] = await Promise.all([
    grab('itemdb.boosters', PLUS + 'ExportBoosters.json', parseBoosters),
    grab('itemdb.rank40', PLUS + 'ExportWeapons.json', parseRank40),
    Promise.all(
      /*
       * KEY BUMPED WITH THE PARSE SHAPE, DELIBERATELY.
       *
       * gentle persists the PARSED value, not the response body. A parse that
       * gains a field while keeping its key reads the OLD shape back off the
       * cache and looks like a no-op for a full 24 h TTL - the change appears
       * to have done nothing, on the one machine where it was tested. The
       * suffix moves with the shape; the stale `itemdb.<category>` entries are
       * left to expire rather than swept, because the catalog at 1.0 MB plus
       * the orphans is still comfortably inside the 5 MB cliff.
       */
      ITEM_CATEGORIES.map((c) => /*
       * c5, not c4: `gentle` caches PARSED values, so an entry written by the
       * previous version has no health, shield, armor or power and would read
       * back as a Warframe with none - which the objective would score as zero
       * rather than as unknown. A changed parse shape always takes a new key.
       */
      grab(`itemdb.c5.${c}`, `${WFCD}${c}.json`, (b) => parseWfcd(c, b))),
    ),
  ]);

  const loaded: Partial<Record<ItemCategory, ItemDbEntry[]>> = {};
  ITEM_CATEGORIES.forEach((c, i) => {
    const entries = parts[i];
    if (entries) loaded[c] = entries;
  });

  return buildItemDb(loaded, boosters ?? {}, rank40 ?? []);
}

/** Pure index build, so the join can be exercised without a network or a browser. */
export function buildItemDb(
  loaded: Partial<Record<ItemCategory, ItemDbEntry[]>>,
  boosters: BoosterMap = {},
  rank40: readonly string[] = [],
): ItemDb {
  const cap40 = new Set(rank40);
  const byType = new Map<string, ItemDbEntry>();
  const byDisplayName = new Map<string, ItemDbEntry>();
  const byCategory = new Map<ItemCategory, ItemDbEntry[]>();
  const masterable = new Map<ItemCategory, number>();
  const missingCategories: ItemCategory[] = [];

  for (const category of ITEM_CATEGORIES) {
    const src = loaded[category];
    if (!src) {
      missingCategories.push(category);
      continue;
    }
    const entries: ItemDbEntry[] = [];
    let count = 0;
    for (const e of src) {
      const maxRank = cap40.has(e.uniqueName) || NECRAMECHS.has(e.uniqueName) ? 40 : e.maxRank;
      const entry = maxRank === e.maxRank ? e : { ...e, maxRank };
      entries.push(entry);
      byType.set(entry.uniqueName, entry);
      // First wins: see the note on `byDisplayName`.
      if (!byDisplayName.has(entry.name)) byDisplayName.set(entry.name, entry);
      if (entry.masterable) count++;
    }
    byCategory.set(category, entries);
    masterable.set(category, count);

    const expected = MASTERABLE_APPENDIX_A[category];
    if (Math.abs(count - expected) > Math.max(2, expected * 0.02)) {
      console.warn(`[itemdb] ${category}: ${count} masterable, research verified ${expected} — denominator drifted`);
    }
  }

  return { byType, byDisplayName, byCategory, masterable, boosters, missingCategories };
}

// ---------------------------------------------------------------------------
// The join
// ---------------------------------------------------------------------------

export interface CategoryOwnership {
  /** Distinct masterable items owned. */
  owned: number;
  /** Masterable items that exist, minus the never-obtainable ones. */
  total: number;
  /** Owned and at its rank cap. Conservative — see `isMaxRanked`. */
  masteredOwned: number;
  /** Subsets of the above that WFCD currently marks vaulted (trade-only). */
  vaultedOwned: number;
  vaultedTotal: number;
  /** Founder-exclusives dropped from both sides. Footnote it; don't hide it. */
  unobtainableExcluded: number;
  missing: ItemDbEntry[];
}

export interface OwnershipReport {
  byCategory: Map<ItemCategory, CategoryOwnership>;
  /** Types we could not place. A data bug to surface, not a rounding error. */
  unmatched: Array<{ bin: string; itemType: string }>;
  /**
   * Account types that actually needed the StoreItems rewrite. Expected: 0.
   * Research could not test the join against a live dump, so this is the assertion
   * it asked for — a non-zero value means the account side is not bare after all.
   */
  storePrefixed: number;
}

interface EquipmentRow {
  ItemType?: unknown;
  XP?: unknown;
  Polarized?: unknown;
  ModularParts?: unknown;
}

interface OwnedInstance {
  bin: string;
  /** Affinity on the instance. Absent for modular parts, which carry none. */
  xp?: number;
  polarized?: number;
}

/**
 * Is this instance finished?
 *
 * Rank-cap affinity is verified: 450,000 for a 100/rank item, 900,000 for a
 * 200/rank one. For the rank-40 items research left one thing open — whether
 * `XP` is a single-cycle value or cumulative across Forma cycles — so this takes
 * the cumulative (higher) threshold and additionally requires the 5 Forma the
 * cap needs. That can under-count a maxed Kuva weapon; it can never claim one is
 * finished when it is not, which is the error worth making here.
 */
function isMaxRanked(e: ItemDbEntry, inst: OwnedInstance): boolean {
  if (inst.xp === undefined) return false;
  const frame = FRAME_RATE.has(e.category);
  if (e.maxRank <= 30) return inst.xp >= (frame ? 900_000 : 450_000);
  return (inst.polarized ?? 0) >= 5 && inst.xp >= (frame ? 7_420_000 : 3_710_000);
}

/** Per-category ownership, plus the diagnostics that keep it honest. */
export function ownership(acc: RawInventory | null, db: ItemDb): OwnershipReport {
  const owned = new Map<string, OwnedInstance>();
  const unmatched: Array<{ bin: string; itemType: string }> = [];
  const seenUnmatched = new Set<string>();
  let storePrefixed = 0;

  for (const bin of EQUIPMENT_BINS) {
    const arr: unknown = acc?.[bin];
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      const row = raw as EquipmentRow | null;
      const own = str(row?.ItemType);
      // Modular weapons (Zaws, Kitguns, Amps, MOA/Hound heads, K-Drive decks) award
      // mastery per *part*, and the parts are strings on the assembled instance.
      const mp: unknown = row?.ModularParts;
      const parts = Array.isArray(mp) ? mp.filter((p): p is string => typeof p === 'string') : [];
      const refs: Array<{ type: string; instanced: boolean }> = [
        ...(own ? [{ type: own, instanced: true }] : []),
        ...parts.map((p) => ({ type: p, instanced: false })),
      ];

      for (const ref of refs) {
        const type = normaliseItemType(ref.type, db.boosters);
        if (type !== ref.type) storePrefixed++;
        const inst: OwnedInstance = ref.instanced
          ? { bin, xp: num(row?.XP), polarized: num(row?.Polarized) }
          : { bin };
        const prev = owned.get(type);
        // Duplicates are common (two copies of one weapon); keep the best-ranked.
        if (!prev || (inst.xp ?? -1) > (prev.xp ?? -1)) owned.set(type, inst);
        if (!db.byType.has(type) && !seenUnmatched.has(type)) {
          seenUnmatched.add(type);
          unmatched.push({ bin, itemType: type });
        }
      }
    }
  }

  const byCategory = new Map<ItemCategory, CategoryOwnership>();
  for (const [category, entries] of db.byCategory) {
    const o: CategoryOwnership = {
      owned: 0,
      total: 0,
      masteredOwned: 0,
      vaultedOwned: 0,
      vaultedTotal: 0,
      unobtainableExcluded: 0,
      missing: [],
    };
    for (const e of entries) {
      if (!e.masterable) continue;
      if (FOUNDER_ONLY.has(e.name)) {
        o.unobtainableExcluded++;
        continue;
      }
      o.total++;
      if (e.vaulted === true) o.vaultedTotal++;
      const inst = owned.get(e.uniqueName);
      if (!inst) {
        o.missing.push(e);
        continue;
      }
      o.owned++;
      if (e.vaulted === true) o.vaultedOwned++;
      if (isMaxRanked(e, inst)) o.masteredOwned++;
    }
    byCategory.set(category, o);
  }

  return { byCategory, unmatched, storePrefixed };
}

/** Sum the per-category rows, for a headline that stays consistent with the parts. */
export function totalOwnership(report: OwnershipReport): CategoryOwnership {
  const t: CategoryOwnership = {
    owned: 0,
    total: 0,
    masteredOwned: 0,
    vaultedOwned: 0,
    vaultedTotal: 0,
    unobtainableExcluded: 0,
    missing: [],
  };
  for (const c of report.byCategory.values()) {
    t.owned += c.owned;
    t.total += c.total;
    t.masteredOwned += c.masteredOwned;
    t.vaultedOwned += c.vaultedOwned;
    t.vaultedTotal += c.vaultedTotal;
    t.unobtainableExcluded += c.unobtainableExcluded;
    t.missing.push(...c.missing);
  }
  return t;
}

/**
 * Obtainable-now completion, floored.
 *
 * Floored on purpose: the one item a completionist is still missing is the whole
 * point of the panel, and 99.6 % must never render as 100 %.
 */
export function obtainablePct(c: CategoryOwnership): number | null {
  const total = c.total - c.vaultedTotal;
  if (total <= 0) return null;
  return Math.floor(((c.owned - c.vaultedOwned) / total) * 100);
}
