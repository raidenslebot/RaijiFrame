/**
 * The mastery engine.
 *
 * Every constant in this file traces to `docs/research/mastery-math.md`, which was
 * parsed mechanically out of the wiki's own Lua modules and DE's PublicExport. The
 * section tag on each constant is where to go to check it. Nothing here is from
 * memory, and nothing the research marks [GAP] is modelled as a fact - unverified
 * inputs surface as `null` so the UI can say "unknown" instead of guessing.
 *
 * Three hazards the research calls out are handled structurally rather than by
 * convention, because a convention is something a future edit can forget:
 *
 *   - The Forma trap (§4.2). `sqrt(XP / 500)` is wrong the moment an item has been
 *     polarized. There is no exported sqrt-shaped rank function to reach for; the
 *     only one is cycle-aware, so the wrong answer is not available.
 *   - Modular double-counting (§2.4). Mastery is credited to the xp-earning PART,
 *     so this file reads the account-level `XPInfo` ledger (§4.3) - already keyed
 *     by part - and never walks the equipment arrays for XP.
 *   - Invented denominators (§5.2). Totals come from the catalog passed in, and are
 *     `null` when the catalog cannot support them.
 */

import type { RawInventory } from '../core/gep';
import { EQUIPMENT_KEYS } from './account.ts';

// ---------------------------------------------------------------------------
// 1. The mastery rank XP table (§1.1, §1.2)
// ---------------------------------------------------------------------------

/** Total mastery XP to reach rank 30 - and the point the Legendary run starts. §1.1 */
export const LEGENDARY_XP = 2_250_000;

/** Flat XP per Legendary rank. Equal to the rank-30 step, so the curve is continuous. §1.3 */
export const LEGENDARY_STEP = 147_500;

/**
 * In-game rank names, index = rank, 0..30. §1.2
 * Beyond 30 the game names ranks "Legendary N" - see `rankName`.
 */
export const RANK_NAMES: readonly string[] = [
  'Unranked', 'Initiate', 'Silver Initiate', 'Gold Initiate', 'Novice', 'Silver Novice',
  'Gold Novice', 'Disciple', 'Silver Disciple', 'Gold Disciple', 'Seeker', 'Silver Seeker',
  'Gold Seeker', 'Hunter', 'Silver Hunter', 'Gold Hunter', 'Eagle', 'Silver Eagle', 'Gold Eagle',
  'Tiger', 'Silver Tiger', 'Gold Tiger', 'Dragon', 'Silver Dragon', 'Gold Dragon', 'Sage',
  'Silver Sage', 'Gold Sage', 'Master', 'Middle Master', 'True Master',
];

/**
 * Total mastery XP required to BE at `rank`. §1.1, verbatim from `Module:MasteryRank`.
 *
 * Deliberately unclamped above 30. The wiki module has no upper bound, and LR6 is the
 * current ceiling only because DE has not shipped enough mastery-granting content to
 * pass it (§1.4) - a hardcoded LR10 cap would be wrong today and wrong again later.
 */
export function xpForRank(rank: number): number {
  const r = Math.max(0, Math.floor(rank));
  return r <= 30 ? 2500 * r * r : LEGENDARY_XP + LEGENDARY_STEP * (r - 30);
}

/** Mastery rank implied by a lifetime mastery XP total. §1.1 */
export function rankForXp(xp: number): number {
  const x = Math.max(0, xp);
  return Math.floor(
    Math.sqrt(Math.min(x, LEGENDARY_XP) / 2500) + Math.max(0, x - LEGENDARY_XP) / LEGENDARY_STEP,
  );
}

/** "True Master", "Legendary 3", ... §1.2 */
export function rankName(rank: number): string {
  const r = Math.max(0, Math.floor(rank));
  return RANK_NAMES[r] ?? `Legendary ${r - 30}`;
}

/**
 * Total mastery that exists in the game, and the non-Founders ceiling. §3.1, §5.1
 *
 * These are wiki-maintained figures computed live at Update 42.0, NOT DE-published -
 * DE ships no mastery-granted field at all (§6.7). They go stale on every content
 * patch, so they are exported for cross-checking a catalog-derived total, never as
 * the denominator itself. `masteryTotals(db)` is the number to show.
 */
export const PUBLISHED_TOTAL_U42 = 3_201_138;
export const PUBLISHED_NON_FOUNDER_TOTAL_U42 = 3_189_138;
/** Excalibur Prime, Lato Prime, Skana Prime. Untradeable, unobtainable forever. §3.4 */
export const FOUNDERS_MASTERY = 12_000;

// ---------------------------------------------------------------------------
// 2. Affinity curves and item ranks (§4.1, §4.2)
// ---------------------------------------------------------------------------

/** Affinity to reach rank L is `base * L^2`; a frame costs double a weapon. §4.1 */
export const AFFINITY_BASE = { frame: 1000, weapon: 500 } as const;

/** Mastery points per item rank. §2.1 */
export const MASTERY_PER_RANK = { frame: 200, weapon: 100 } as const;

/**
 * Max affinity per category - what a single 0->cap climb costs. §4.1
 *
 * These are single-cycle figures. A Forma'd item's LIFETIME affinity is far larger
 * (§4.2); use `lifetimeAffinityForRank` for that.
 */
export const MAX_AFFINITY = {
  weapon30: 450_000,
  frame30: 900_000,
  weapon40: 800_000,
  frame40: 1_600_000,
} as const;

/** Cumulative affinity to reach `rank` from 0 within one Forma cycle. §4.1 */
export function affinityForRank(rank: number, isFrame: boolean): number {
  const r = Math.max(0, Math.floor(rank));
  return (isFrame ? AFFINITY_BASE.frame : AFFINITY_BASE.weapon) * r * r;
}

/**
 * THE FORMA TRAP - §4.2, "the single biggest correctness hazard".
 *
 * Each Forma resets an item to rank 0 and raises its cap by 2, so a rank-40 weapon
 * was levelled SIX times, not once. Its lifetime affinity is
 * `450,000 + 512,000 + 578,000 + 648,000 + 722,000 + 800,000 = 3,710,000`, which
 * matches the wiki's published rank-40 figure exactly (§4.2). Feed that number to
 * `floor(sqrt(xp / 500))` and you get **rank 86**.
 *
 * So this ladder walks the Forma cycles - caps 30, 32, 34 ... - subtracting each
 * completed cycle before reading the next, and it is the ONLY rank function this
 * module exposes. Do not add a sqrt shortcut "for the simple case": the simple case
 * is what this already computes when the item has never been polarized.
 *
 * `cap` must come from the catalog (`maxLevelCap`). The honest "fully mastered" test
 * for one of the 52 + 2 rank-40 items is `Polarized >= 5 && rank >= 40` (§4.4).
 *
 * Returns the HIGHEST rank the item has ever reached, which is what mastery is paid
 * on - mastery is granted once per rank, permanently, and re-levelling after a Forma
 * pays nothing new (§4.3).
 *
 * [GAP §4.2/§6.1] Whether DE's live server resets per-item `XP` on Forma is
 * unverified; SpaceNinjaServer accumulates and never resets. This assumes
 * accumulation, which is also what the account-level `XPInfo` ledger does (§4.3).
 * Validate against one real Forma'd item in a live capture before trusting any rank
 * display above 30.
 */
export function rankFromLifetimeAffinity(xp: number, isFrame: boolean, cap = 30): number {
  const base = isFrame ? AFFINITY_BASE.frame : AFFINITY_BASE.weapon;
  const ceiling = Math.max(30, Math.floor(cap));
  let spent = 0;
  let best = 0;
  for (let cycleCap = 30; ; cycleCap += 2) {
    const rank = Math.min(cycleCap, Math.floor(Math.sqrt(Math.max(0, xp - spent) / base)));
    if (rank > best) best = rank;
    // Cycle not finished, or we are at the item's real cap: nothing further to unlock.
    if (rank < cycleCap || cycleCap >= ceiling) return Math.min(best, ceiling);
    spent += base * cycleCap * cycleCap;
  }
}

/** Rank of a weapon (100 mastery/rank) from its lifetime affinity. §4.1, §4.2 */
export function weaponRank(xp: number, cap = 30): number {
  return rankFromLifetimeAffinity(xp, false, cap);
}

/** Rank of a frame/vehicle/companion (200 mastery/rank) from its lifetime affinity. §4.1, §4.2 */
export function frameRank(xp: number, cap = 30): number {
  return rankFromLifetimeAffinity(xp, true, cap);
}

/**
 * Lifetime affinity an item has cost by the time it reaches `rank`, Forma re-levels
 * included. The inverse of `rankFromLifetimeAffinity`. §4.2
 */
export function lifetimeAffinityForRank(rank: number, isFrame: boolean): number {
  const base = isFrame ? AFFINITY_BASE.frame : AFFINITY_BASE.weapon;
  const target = Math.max(0, Math.floor(rank));
  let total = 0;
  for (let cycleCap = 30; cycleCap < target; cycleCap += 2) total += base * cycleCap * cycleCap;
  return total + base * target * target;
}

/** How many Forma a cap implies. Caps run 30, 32 ... 40. §4.2 */
export function formaForCap(cap: number): number {
  return Math.max(0, Math.ceil((cap - 30) / 2));
}

// ---------------------------------------------------------------------------
// 3. The catalog this engine needs
// ---------------------------------------------------------------------------

/**
 * Which line of the breakdown an item is paid into.
 *
 * `other` is the honest bucket for everything the app has no row of its own for -
 * amps, kitgun chambers, zaw strikes, K-Drives, the Plexus - rather than silently
 * folding them into a category they do not belong to.
 */
export type MasterySource =
  | 'frames'
  | 'primaries'
  | 'secondaries'
  | 'melee'
  | 'companions'
  | 'archwing'
  | 'necramech'
  | 'other';

export interface MasteryEntry {
  /** Display name, when the catalog has one. */
  name?: string;
  category: MasterySource;
  /**
   * True for the 200-mastery-per-rank classes: Warframes, Archwings, Necramechs, all
   * Companions, the Plexus, K-Drives. Everything else is a weapon. §4.1
   */
  isFrame: boolean;
  /**
   * False for items that rank up but pay nothing: inventory category `SpecialItems`
   * (all exalted weapons, Orion & Sirius) except Venari and Venari Prime, plus the
   * Mote Amp. §2.3
   *
   * Do NOT let a catalog derive this from `excludeFromCodex` - that flag is codex
   * visibility, sits on 71 weapons including three Hound melees that DO grant 3,000
   * each, and using it as a mastery flag under-counts by at least 9,000 (§2.3).
   */
  grantsMastery: boolean;
  /**
   * 30 for almost everything; 40 for the 52 Kuva/Tenet/Coda/Paracesis weapons and the
   * 2 Necramechs. §2.2
   *
   * [GAP §2.2] DE publishes `maxLevelCap` for the 52 weapons but for ZERO warframes,
   * so the catalog has to hardcode the two Necramech types as 40.
   */
  maxLevelCap?: number;
  /**
   * False only when the item can genuinely never be acquired (Founders). Left
   * undefined when the catalog does not know - the exclusives figures in the research
   * contradict each other (§3.4), so "unknown" is a real and common answer here.
   */
  obtainable?: boolean;
}

export interface MasteryDb {
  /** Keyed by bare `/Lotus/...` ItemType, the namespace the account itself uses. */
  items: ReadonlyMap<string, MasteryEntry>;
  /** SolNode tag -> mastery XP. 169 nodes, 3 to 279 each, never uniform. §2.5 */
  nodes?: ReadonlyMap<string, number>;
  /** The 13 junction tags that pay 1,000 each. §2.5 */
  junctions?: ReadonlySet<string>;
}

/** Mastery XP for one junction clear. §2.1 */
export const JUNCTION_MASTERY = 1000;
/** Mastery XP per Railjack or Drifter Intrinsic rank. §2.1 */
export const INTRINSIC_MASTERY = 1500;
/** 5 schools x 10 ranks. §2.5 */
export const RAILJACK_INTRINSIC_RANKS = 50;
/** 4 schools x 10 ranks. §2.5 */
export const DRIFTER_INTRINSIC_RANKS = 40;

const STORE_PREFIX = '/Lotus/StoreItems/';

/**
 * Join-key normaliser. The account stores bare types, but WFCD's own build leaked 14
 * prefixed ones, so normalising is cheap insurance. Idempotent. item-catalog.md §4a.
 * (The booster half of that rule is irrelevant here - boosters grant no mastery.)
 */
export function normaliseItemType(t: string): string {
  return t.startsWith(STORE_PREFIX) ? `/Lotus/${t.slice(STORE_PREFIX.length)}` : t;
}

/**
 * Mastery earned for one ItemType from its lifetime affinity. §4.3
 *
 * `rank * perRank` is correct for rank-40 items too, and must NOT be given a bonus on
 * top: 40 x 100 = 4,000 for a Kuva weapon and 40 x 200 = 8,000 for a Necramech, which
 * is exactly what the wiki module's base-plus-bonus arithmetic produces (§2.2).
 */
export function masteryForType(entry: MasteryEntry, xp: number): number {
  if (!entry.grantsMastery) return 0;
  const rank = rankFromLifetimeAffinity(xp, entry.isFrame, entry.maxLevelCap ?? 30);
  return rank * (entry.isFrame ? MASTERY_PER_RANK.frame : MASTERY_PER_RANK.weapon);
}

/** The most mastery an item can ever pay. §2.1 */
export function maxMasteryFor(entry: MasteryEntry): number {
  if (!entry.grantsMastery) return 0;
  return (entry.maxLevelCap ?? 30) * (entry.isFrame ? MASTERY_PER_RANK.frame : MASTERY_PER_RANK.weapon);
}

// ---------------------------------------------------------------------------
// 4. Account -> mastery
// ---------------------------------------------------------------------------

/**
 * One line per breakdown source. `null` means "this account's data cannot tell us",
 * which is a different and far more useful answer than 0.
 */
export interface MasteryBreakdown {
  frames: number | null;
  primaries: number | null;
  secondaries: number | null;
  melee: number | null;
  companions: number | null;
  archwing: number | null;
  necramech: number | null;
  /** Amps, kitguns, zaws, K-Drives, Plexus - whatever the catalog buckets as `other`. */
  other: number | null;
  /** Star chart nodes, with Steel Path counted a second time. §2.5 */
  nodes: number | null;
  junctions: number | null;
  intrinsics: number | null;
}

export interface MasteryPicture {
  /** Rank derived from the mastery we can actually account for. */
  rank: number;
  /** `PlayerLevel` as the game reports it. The honest cross-check on `rank`. */
  reportedRank: number | null;
  /** What our own XP sum implies. Demoted to an estimate; the game wins. */
  estimatedRank: number;
  /** True when the estimate disagrees with the game. The UI must surface it. */
  /**
   * How many ranks the game reports that this catalog cannot explain, or null
   * when the game reported no rank at all.
   *
   * THE VALUE IS HERE BECAUSE THE PANELS KEPT COMPUTING IT WRONG. Both of them
   * wrote `reportedRank - rank`, and `rank` IS `reportedRank` whenever the game
   * sent one - so the subtraction was identically zero, every guard reading
   * `gap !== 0` was dead, and the five places built to disclose the divergence
   * displayed nothing on any account. The gap belongs beside the two numbers it
   * comes from, where the substitution that makes it zero is impossible.
   *
   * Positive is the normal direction: DE has banked mastery from content the
   * catalog cannot see. Negative means this app over-counted, which is the more
   * serious of the two and is worded differently on screen.
   */
  rankGap: number | null;
  xp: number;
  /**
   * Null when our XP model disagrees with the game's own PlayerLevel. Publishing
   * progress derived from a sum we know is wrong would be a confidently wrong
   * number, which is worse than an absent one.
   */
  xpIntoRank: number | null;
  xpToNextRank: number | null;
  breakdown: MasteryBreakdown;
  /**
   * True when `XPInfo` was present. When false, every equipment line is `null` and the
   * picture covers missions only - say that out loud rather than showing a low number.
   */
  fromLedger: boolean;
  /** ItemTypes in `XPInfo` the catalog has never heard of. A staleness signal. */
  unknownTypes: string[];
}

export interface MasteryOptions {
  /**
   * Railjack / Drifter Intrinsic ranks, 0-50 and 0-40. §2.5
   *
   * Not read from the inventory: the research verifies the mastery RATE but never
   * verifies which inventory field carries intrinsic ranks, and inventing a field
   * name is exactly the failure this app has already been burned by. Left unset,
   * intrinsics report `null`.
   */
  railjackIntrinsicRanks?: number;
  drifterIntrinsicRanks?: number;
}

/**
 * The 27 equipment arrays, from the one module that transcribes DE's own list. §4.5
 *
 * THIS WAS A SECOND COPY OF THE SAME TWENTY-SEVEN STRINGS, and `itemdb.ts` held a
 * third. All three agreed, which is the only reason nothing was broken - and it
 * was luck rather than structure: three hand-kept transcriptions of one list stay
 * equal exactly until DE ships a twenty-eighth array and somebody updates the copy
 * they happened to be reading. The failure would be silent in the usual way: a
 * whole arsenal array missing from one panel's fraction and present in another's,
 * with no error anywhere and both numbers looking perfectly reasonable.
 *
 * `account.ts` is the transcription of record - it cites the schema section and it
 * is the module the account model gate already checks - so this re-exports it
 * rather than repeating it. The re-export exists so mastery's own readers keep
 * importing mastery.
 */
export { EQUIPMENT_KEYS } from './account.ts';

/**
 * Lifetime affinity per ItemType, from the account ledger. §4.3
 *
 * `XPInfo` is the right source and the equipment arrays are the wrong one: it is
 * account-level, is never decremented when an item is sold, and is already keyed by
 * the xp-earning PART for modular items - so two Zaws built on one strike count once,
 * which is how the game actually pays (§2.4). Reading per-item `XP` instead would
 * need a `partType` map DE does not publish at all (§6.2) and would over-report every
 * modular weapon.
 */
export function ledger(acc: RawInventory | null): Map<string, number> | null {
  if (!acc?.XPInfo?.length) return null;
  const out = new Map<string, number>();
  for (const e of acc.XPInfo) {
    if (!e?.ItemType) continue;
    const key = normaliseItemType(e.ItemType);
    // Duplicate keys should not occur; if they do, the ledger's high-water-mark
    // semantics mean the larger value is the true one.
    out.set(key, Math.max(out.get(key) ?? 0, e.XP ?? 0));
  }
  return out;
}

/** ItemTypes the account owns right now, across all 27 equipment arrays. §4.5 */
export function ownedTypes(acc: RawInventory | null): Set<string> {
  const out = new Set<string>();
  if (!acc) return out;
  for (const key of EQUIPMENT_KEYS) {
    const arr = acc[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const t = (item as { ItemType?: unknown } | null)?.ItemType;
      if (typeof t === 'string' && t) out.add(normaliseItemType(t));
    }
  }
  return out;
}

const ITEM_SOURCES: readonly MasterySource[] = [
  'frames', 'primaries', 'secondaries', 'melee', 'companions', 'archwing', 'necramech', 'other',
];

const EMPTY_BREAKDOWN: MasteryBreakdown = {
  frames: null, primaries: null, secondaries: null, melee: null, companions: null,
  archwing: null, necramech: null, other: null, nodes: null, junctions: null, intrinsics: null,
};

/**
 * Mastery earned from star chart nodes and junctions. §2.5
 *
 * Steel Path counts nodes AND junctions a second time, so one tag can pay twice.
 * 175 of the 357 mission entries grant nothing at all, which is why this reads a
 * per-node table rather than assuming a flat value.
 *
 * [GAP] The research verifies `Tier` truthy = Steel Path on a mission entry, but not
 * whether a Steel Path clear arrives as a second entry or as a flag on the existing
 * one. Treating it as a flag can only under-count, never invent mastery.
 */
function missionMastery(
  acc: RawInventory,
  db: MasteryDb,
): { nodes: number | null; junctions: number | null } {
  if (!db.nodes && !db.junctions) return { nodes: null, junctions: null };
  let nodes = db.nodes ? 0 : null;
  let junctions = db.junctions ? 0 : null;
  for (const m of acc.Missions ?? []) {
    if (!m?.Tag || (m.Completes ?? 0) <= 0) continue;
    const runs = (m.Tier ?? 0) > 0 ? 2 : 1;
    const nodeXp = db.nodes?.get(m.Tag);
    if (nodeXp != null) {
      if (nodes != null) nodes += nodeXp * runs;
    } else if (db.junctions?.has(m.Tag) && junctions != null) {
      junctions += JUNCTION_MASTERY * runs;
    }
  }
  return { nodes, junctions };
}

/**
 * The account's mastery, attributed by source.
 *
 * `rank` is derived from what we can actually account for, so it sits BELOW
 * `reportedRank` whenever the catalog is incomplete or intrinsics were not supplied.
 * That gap is information - it is the size of what the app cannot yet explain - and
 * it must never be closed by scaling the number up to match.
 */
export function masteryFromAccount(
  acc: RawInventory | null,
  db: MasteryDb,
  opts: MasteryOptions = {},
): MasteryPicture {
  const reportedRank = typeof acc?.PlayerLevel === 'number' ? acc.PlayerLevel : null;
  if (!acc) {
    return {
      rank: reportedRank ?? 0,
      reportedRank,
      estimatedRank: 0,
      rankGap: null,
      xp: 0,
      xpIntoRank: 0,
      xpToNextRank: xpForRank(1),
      breakdown: EMPTY_BREAKDOWN,
      fromLedger: false,
      unknownTypes: [],
    };
  }

  const xpByType = ledger(acc);
  const unknownTypes: string[] = [];
  const breakdown: MasteryBreakdown = { ...EMPTY_BREAKDOWN };

  if (xpByType) {
    for (const k of ITEM_SOURCES) breakdown[k] = 0;
    for (const [itemType, xp] of xpByType) {
      const entry = db.items.get(itemType);
      if (!entry) {
        // A ledger entry the catalog cannot explain - usually a stale catalog,
        // sometimes a non-mastery item. Reported, never quietly credited.
        unknownTypes.push(itemType);
        continue;
      }
      const earned = masteryForType(entry, xp);
      if (earned) breakdown[entry.category] = (breakdown[entry.category] ?? 0) + earned;
    }
  }

  const missions = missionMastery(acc, db);
  breakdown.nodes = missions.nodes;
  breakdown.junctions = missions.junctions;

  const rj = opts.railjackIntrinsicRanks;
  const dr = opts.drifterIntrinsicRanks;
  breakdown.intrinsics = rj == null && dr == null ? null : ((rj ?? 0) + (dr ?? 0)) * INTRINSIC_MASTERY;

  let xp = 0;
  for (const v of Object.values(breakdown)) if (v != null) xp += v;

  /*
   * PlayerLevel is AUTHORITATIVE.
   *
   * `estimatedRank` is what our own XP sum implies, and on a real account the
   * two disagreed badly - the panel displayed MR 7 while the game reported MR 4.
   * Our sum is built from what the catalog says each owned item is WORTH, which
   * over-counts: it cannot see which items DE has actually banked, and it counts
   * star chart and junction mastery the account may not hold.
   *
   * DE's own field is ground truth. A number we derived must never override a
   * number the game states, so the derived one is demoted to an estimate and the
   * divergence is surfaced rather than hidden.
   */
  const estimatedRank = rankForXp(xp);
  const rank = reportedRank ?? estimatedRank;
  const trustworthy = reportedRank == null || reportedRank === estimatedRank;

  return {
    rank,
    estimatedRank,
    reportedRank,
    /** The disagreement between our XP model and the game. The UI must say so. */
    rankGap: reportedRank === null ? null : reportedRank - estimatedRank,
    xp,
    // Only meaningful while the model agrees with the game. Publishing progress
    // derived from a sum we know is wrong would be a confidently wrong number.
    xpIntoRank: trustworthy ? xp - xpForRank(rank) : null,
    xpToNextRank: trustworthy ? xpForRank(rank + 1) - xp : null,
    breakdown,
    fromLedger: xpByType != null,
    unknownTypes,
  };
}

// ---------------------------------------------------------------------------
// 5. What most efficiently advances mastery (§5.3)
// ---------------------------------------------------------------------------

export interface MasteryOpportunity {
  itemType: string;
  name?: string;
  category: MasterySource;
  owned: boolean;
  earned: number;
  /** Mastery this item pays when fully ranked. */
  potential: number;
  /** Mastery still on the table. */
  remaining: number;
  /** Lifetime affinity still to grind, Forma re-levels included. §4.2 */
  affinityRemaining: number;
  /**
   * Affinity per mastery point - the ranking key, lower is better. §5.3
   *
   * This is the number that makes the advice honest. A weapon and a Warframe both
   * cost 150 affinity per point; a rank-40 weapon or a Necramech costs 928, which is
   * 6.2x worse. Rank-40 grinds are completionist work, not efficient progress.
   */
  affinityPerPoint: number;
  /** Forma required to finish it. §4.2 */
  forma: number;
  /**
   * Rank held now, and the ceiling it is being measured against.
   *
   * Both were computed here and thrown away, so the UI could say how much
   * affinity was left but never where you actually are - which is the one thing
   * that tells you whether a row is nearly done or untouched.
   */
  rank: number;
  cap: number;
  /** From the catalog; undefined means the catalog does not know. §3.4 */
  obtainable?: boolean;
}

/**
 * Every item that still owes the account mastery, most efficient first. §5.3
 *
 * Covers both halves the research asks for: items owned but not maxed, and items not
 * owned at all. Items already paying their maximum are dropped - offering them would
 * be exactly the "go regrind what you finished" advice this app exists to avoid.
 *
 * Junctions and Intrinsics beat every item on ratio (§5.3: 13 junctions x 1,000 x 2
 * plus 90 intrinsic ranks x 1,500 = 161,000 with no affinity grind at all), but they
 * are not items and so are not listed here - they belong to the mission and intrinsic
 * side of the UI.
 */
export function masteryOpportunities(acc: RawInventory | null, db: MasteryDb): MasteryOpportunity[] {
  const xpByType = ledger(acc);
  const owned = ownedTypes(acc);
  const out: MasteryOpportunity[] = [];

  for (const [itemType, entry] of db.items) {
    if (!entry.grantsMastery) continue;
    const potential = maxMasteryFor(entry);
    const xp = xpByType?.get(itemType) ?? 0;
    const earned = masteryForType(entry, xp);
    const remaining = potential - earned;
    if (remaining <= 0) continue;

    const cap = entry.maxLevelCap ?? 30;
    const rank = rankFromLifetimeAffinity(xp, entry.isFrame, cap);
    const affinityRemaining =
      lifetimeAffinityForRank(cap, entry.isFrame) - lifetimeAffinityForRank(rank, entry.isFrame);

    out.push({
      itemType,
      ...(entry.name === undefined ? {} : { name: entry.name }),
      category: entry.category,
      owned: owned.has(itemType),
      earned,
      potential,
      remaining,
      affinityRemaining,
      affinityPerPoint: affinityRemaining / remaining,
      forma: formaForCap(cap),
      rank,
      cap,
      ...(entry.obtainable === undefined ? {} : { obtainable: entry.obtainable }),
    });
  }

  /*
   * WHAT YOU ALREADY OWN COMES FIRST, AND THE OLD KEY COULD NOT SAY SO.
   * ────────────────────────────────────────────────────────────
   * The sort was `affinityPerPoint`, then `remaining`, then path. That key has
   * a tie-density problem this file already admits to in its own comment -
   * every plain weapon costs the same 150 affinity per mastery point, so the
   * first term is equal across roughly six hundred items and the ordering is
   * decided by the second and third almost everywhere.
   *
   * `owned` was computed for every row and left out of the sort entirely, and
   * it is the single largest fact about what a player can do tonight. An
   * unowned weapon behind a forty-hour lich grind sorted level with one already
   * in the arsenal needing a Hydron run, on the grounds that both pay 150 per
   * point - which is true of the affinity and says nothing about the evening.
   *
   * The pursuit this list feeds describes itself as "the cheapest mastery there
   * is - no acquisition needed". That sentence IS the ordering, and it was not
   * implemented.
   *
   * ORDERING, NOT A WEIGHT. Owning a thing is not worth some number of
   * affinity-per-point that a cheap enough unowned item could overcome; it is a
   * different kind of task. So it sorts first and the old key orders within it,
   * which keeps every one of the original comparisons doing its job among items
   * that are actually comparable.
   *
   * Ties are still the norm inside each group, so the caveat below still holds:
   * a caller showing N of this list must say how many more tie at the cut.
   */
  return out.sort(
    (a, b) =>
      Number(b.owned) - Number(a.owned) ||
      a.affinityPerPoint - b.affinityPerPoint ||
      b.remaining - a.remaining ||
      a.itemType.localeCompare(b.itemType),
  );
}

// ---------------------------------------------------------------------------
// 6. Honest completion (§5.1, §5.2)
// ---------------------------------------------------------------------------

/**
 * Total mastery the catalog says exists, and the slice of it still obtainable. §5.1
 *
 * Derived from the catalog rather than from the published 3,201,138 on purpose (§1.4):
 * a catalog-derived ceiling self-corrects when DE ships more content, while a
 * hardcoded one silently rots. `null` when there is nothing to count.
 */
export function masteryTotals(
  db: MasteryDb,
  opts: MasteryOptions = {},
): { available: number | null; obtainable: number | null } {
  if (db.items.size === 0 && !db.nodes && !db.junctions) return { available: null, obtainable: null };

  let items = 0;
  let obtainableItems = 0;
  for (const entry of db.items.values()) {
    const max = maxMasteryFor(entry);
    items += max;
    // Unknown obtainability counts as obtainable: the exclusives figures contradict
    // each other (§3.4), and quietly shrinking the denominator inflates the percentage.
    if (entry.obtainable !== false) obtainableItems += max;
  }

  // Everything below is obtainable by anyone, so it lands in both denominators.
  let shared = 0;
  // Steel Path doubles nodes AND junctions. §2.5
  if (db.nodes) for (const xp of db.nodes.values()) shared += xp * 2;
  if (db.junctions) shared += db.junctions.size * JUNCTION_MASTERY * 2;
  // The intrinsic pool is fixed; only counted when the caller can measure the account
  // side of it, so the numerator and denominator stay describing the same thing.
  if (opts.railjackIntrinsicRanks != null || opts.drifterIntrinsicRanks != null) {
    shared += (RAILJACK_INTRINSIC_RANKS + DRIFTER_INTRINSIC_RANKS) * INTRINSIC_MASTERY;
  }

  return { available: items + shared, obtainable: obtainableItems + shared };
}

export interface HonestCompletion {
  earned: number;
  /** Against everything in the game, Founders items included. */
  ofAvailable: { total: number | null; pct: number | null };
  /** Against what this account can actually still get. The number a player can move. */
  ofObtainable: { total: number | null; pct: number | null };
  /** The only figure that changes day to day. */
  /**
   * Progress to the next rank. Every field is nullable because it is only
   * meaningful while our XP model agrees with the game's own PlayerLevel; when
   * they diverge there is no honest progress figure and the UI must show none.
   */
  toNextRank: {
    rank: number;
    next: number;
    xpIntoRank: number | null;
    xpToNextRank: number | null;
    pct: number | null;
  };
}

/**
 * Three numbers, never one. §5.2
 *
 * A single "% complete" lies in both directions at once. Measured against all mastery
 * in the game it silently includes the 12,000 of Founders items nobody can ever get,
 * so it can never reach 100 and quietly blames the player for that. Measured against
 * "obtainable" it hides that the ceiling moves every patch. And neither says anything
 * about the only thing that moves this week, which is the next rank. So all three
 * ship, each labelled with its own denominator, and any of them may be `null` when the
 * catalog cannot honestly supply one.
 */
export function honestCompletion(
  picture: MasteryPicture,
  db: MasteryDb,
  opts: MasteryOptions = {},
): HonestCompletion {
  const totals = masteryTotals(db, opts);
  const share = (total: number | null): number | null =>
    total == null || total <= 0 ? null : Math.min(100, (picture.xp / total) * 100);

  const rank = picture.rank;
  const span = xpForRank(rank + 1) - xpForRank(rank);
  return {
    earned: picture.xp,
    ofAvailable: { total: totals.available, pct: share(totals.available) },
    ofObtainable: { total: totals.obtainable, pct: share(totals.obtainable) },
    toNextRank: {
      rank,
      next: rank + 1,
      // Null propagates deliberately: when our XP model disagrees with the
      // game's own rank there is no honest progress figure to draw.
      xpIntoRank: picture.xpIntoRank,
      xpToNextRank: picture.xpToNextRank,
      pct: picture.xpIntoRank != null && span > 0 ? (picture.xpIntoRank / span) * 100 : null,
    },
  };
}
