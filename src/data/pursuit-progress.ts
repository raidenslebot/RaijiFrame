// real-data-adapter
/**
 * Measure each pursuit against the real account.
 *
 * THE ONE RULE
 * ────────────
 * Every number here comes from a field the game actually sent. Nothing is
 * estimated, defaulted, or filled in to make a bar look populated. When a field
 * is absent the measurement is `null`, and the UI is required to say
 * "not measured" rather than draw an empty bar — because an empty bar is a
 * claim (`0% done`) and a missing field is not evidence for it.
 *
 * WHY EVERY FIELD IS PROBED RATHER THAN ASSUMED
 * ─────────────────────────────────────────────
 * `docs/research/inventory-schema.md` documents the full account shape from
 * DE's own payloads, but it also records the important caveat: which of those
 * fields Overwolf's GEP actually forwards through `match_info.inventory` is NOT
 * verified field-by-field. So the schema tells us what a field means and what
 * shape it has; it does not promise the field will arrive.
 *
 * Every read therefore goes through `arr()` / `obj()`, which return null on an
 * absent or wrong-typed field. A pursuit whose source never arrives degrades to
 * "unmeasured" for good, and nothing here can invent a value for it.
 *
 * DENOMINATORS
 * ────────────
 * A ratio needs a total, and for most domains the only honest total lives in the
 * vendored catalog, not in the account. Where we have no trustworthy total the
 * measurement is null even though the numerator is known — reporting
 * "412 mods" as a percentage of a number we guessed would be the same lie in a
 * different shape.
 */

import type { RawInventory } from '../core/gep';
import { questDone, type Catalog } from './catalog.ts';
import type { Pursuit } from './pursuits';
import type { AccountPicture } from './progression';
import { totalOwnership, type CategoryOwnership, type ItemCategory, type OwnershipReport } from './itemdb.ts';

/* ------------------------------------------------------------------ probing */

/** An array field, or null if absent / not an array. */
function arr(inv: RawInventory, key: string): unknown[] | null {
  const v = inv[key];
  return Array.isArray(v) ? v : null;
}

/** A record field, or null. */
function obj(inv: RawInventory, key: string): Record<string, unknown> | null {
  const v = inv[key];
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Distinct `ItemType` values across several inventory buckets. */
function distinctTypes(inv: RawInventory, keys: readonly string[]): number | null {
  const seen = new Set<string>();
  let sawAny = false;
  for (const k of keys) {
    const list = arr(inv, k);
    if (!list) continue;
    sawAny = true;
    for (const e of list) {
      const t = (e as { ItemType?: unknown } | null)?.ItemType;
      if (typeof t === 'string') seen.add(t);
    }
  }
  return sawAny ? seen.size : null;
}

/**
 * Clamp to the unit interval; a ratio over 1 means our total is stale.
 *
 * A null numerator is "the account never carried this", which is not zero and
 * has no ratio at all - the clamp used to turn it into a confident 0%.
 */
function ratio(have: number | null, total: number | null): number | null {
  if (have == null || total == null || total <= 0) return null;
  return Math.max(0, Math.min(1, have / total));
}

/* ------------------------------------------------------- catalog denominators
 *
 * Totals for the domains where the star-chart/quest datasets are authoritative.
 * Anything not listed has no trustworthy total and stays unmeasured.
 */
export interface PursuitTotals {
  /** Star chart nodes in the vendored catalog. */
  nodes?: number | null;
  /** Junctions in the vendored catalog. */
  junctions?: number | null;
  /** Quests in the vendored catalog. */
  quests?: number | null;
  /** From `questSplit`: finished over measurable, per line. */
  questsMain?: { have: number; total: number } | null;
  questsSide?: { have: number; total: number } | null;
  /**
   * Real per-category ownership from the item catalog.
   *
   * This is what turns most of the collection board from "not measured" into a
   * real ratio. `ownership()` already computes owned-vs-obtainable per category
   * against DE's own export, with founder-exclusives excluded from BOTH sides —
   * a far better denominator than anything that could be hardcoded here, and it
   * tracks every content update automatically.
   *
   * Null when the catalog fetch failed, which must stay distinguishable from
   * "you own none of them".
   */
  ownership?: OwnershipReport | null;
}

/**
 * Categories that make up each collection pursuit.
 *
 * Several pursuits span more than one catalog category — "companions" is
 * Sentinels plus their weapons plus beasts — so the ratio is summed across them
 * rather than taken from any single one.
 */
const PURSUIT_CATEGORIES: Record<string, readonly ItemCategory[]> = {
  'collection.frames': ['Warframes'],
  'collection.primary': ['Primary'],
  'collection.secondary': ['Secondary'],
  'collection.melee': ['Melee'],
  'collection.companions': ['Sentinels', 'SentinelWeapons', 'Pets'],
  'collection.archwing': ['Archwing', 'Arch-Gun', 'Arch-Melee'],
};

/** Sum several categories into one owned/total pair. Null if none resolved. */
function summed(
  report: OwnershipReport | null | undefined,
  cats: readonly ItemCategory[],
): { owned: number; total: number } | null {
  if (!report) return null;
  let owned = 0;
  let total = 0;
  let sawAny = false;
  for (const c of cats) {
    const row: CategoryOwnership | undefined = report.byCategory.get(c);
    if (!row) continue;
    sawAny = true;
    owned += row.owned;
    total += row.total;
  }
  return sawAny ? { owned, total } : null;
}

/* --------------------------------------------------------------- the mapping */

/**
 * The five intrinsic trees each cap at 10, and there are two sets (Railjack and
 * Drifter). Verified in `docs/research/inventory-schema.md` under `PlayerSkills`.
 */
const INTRINSIC_CAP = 10;

/** Main syndicates run rank -2..5, so 5 is the ceiling. */
const SYNDICATE_MAX_RANK = 5;
/**
 * The six with that ladder. Every other affiliation in the export (Nightwave,
 * Cetus, Conclave) has its own ceiling, and counting them against 5 put a
 * denominator on screen that no account could reach.
 */
const MAIN_SYNDICATES: ReadonlySet<string> = new Set([
  'SteelMeridianSyndicate',
  'ArbitersSyndicate',
  'CephalonSudaSyndicate',
  'PerrinSyndicate',
  'RedVeilSyndicate',
  'NewLokaSyndicate',
]);

/**
 * Mainline against side quests, each as finished-over-measurable. The catalog
 * carries `mainline` per quest, so the two rows can carry different numbers
 * honestly; quests with no canonical id are left out of both fractions because
 * `questDone` cannot tell either way for them.
 */
export function questSplit(catalog: Catalog, picture: AccountPicture): Pick<PursuitTotals, 'questsMain' | 'questsSide'> {
  const main = { have: 0, total: 0 };
  const side = { have: 0, total: 0 };
  for (const q of catalog.questByKey.values()) {
    const done = questDone(q, picture);
    if (done === null) continue;
    const bin = q.mainline === true ? main : side;
    bin.total += 1;
    if (done) bin.have += 1;
  }
  return { questsMain: main, questsSide: side };
}
// Ranks live under LPS_*; the LPP_* keys beside them are point pools, and
// reading those reported every account's Railjack intrinsics as unmeasured.
const RAILJACK_SKILLS = ['LPS_PILOTING', 'LPS_GUNNERY', 'LPS_ENGINEERING', 'LPS_TACTICAL', 'LPS_COMMAND'] as const;
const DRIFTER_SKILLS = ['LPS_DRIFT_RIDING', 'LPS_DRIFT_COMBAT', 'LPS_DRIFT_OPPORTUNITY', 'LPS_DRIFT_ENDURANCE'] as const;

/** Sum a `PlayerSkills` subset, or null if the field never arrived. */
function skillProgress(inv: RawInventory, keys: readonly string[]): number | null {
  const skills = obj(inv, 'PlayerSkills');
  if (!skills) return null;
  let have = 0;
  let sawAny = false;
  for (const k of keys) {
    const v = skills[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      have += Math.min(v, INTRINSIC_CAP);
      sawAny = true;
    }
  }
  // Absent keys legitimately mean rank 0, but if NOT ONE key is present the
  // field is shaped differently than we expect and we should not report on it.
  return sawAny ? ratio(have, keys.length * INTRINSIC_CAP) : null;
}

/**
 * Build the per-pursuit measurement function the ranker calls.
 *
 * Returns `null` for any pursuit the account cannot substantiate. The closure
 * captures the inventory and the derived picture so the ranker stays pure.
 */
export function makeProgressFor(
  inv: RawInventory | null,
  picture: AccountPicture,
  totals: PursuitTotals = {},
): (p: Pursuit) => number | null {
  return (p: Pursuit): number | null => {
    if (!inv) return null;

    switch (p.id) {
      /* ---- narrative --------------------------------------------------- */
      case 'quests.main':
        return totals.questsMain ? ratio(totals.questsMain.have, totals.questsMain.total) : null;
      case 'quests.side':
        return totals.questsSide ? ratio(totals.questsSide.have, totals.questsSide.total) : null;

      case 'junctions': {
        const missions = arr(inv, 'Missions');
        if (!missions) return null;
        const done = missions.filter((m) => {
          const tag = (m as { Tag?: unknown }).Tag;
          return typeof tag === 'string' && tag.endsWith('Junction');
        }).length;
        return ratio(done, totals.junctions ?? null);
      }

      /* ---- star chart --------------------------------------------------- */
      case 'nodes.normal':
        return ratio(picture.nodes.have, picture.nodes.total ?? totals.nodes ?? null);

      case 'nodes.steel': {
        // `Tier` on a Missions entry marks a Steel Path clear — verified in the
        // schema notes. Same denominator as the normal chart.
        const missions = arr(inv, 'Missions');
        if (!missions) return null;
        const steel = missions.filter((m) => {
          const tier = (m as { Tier?: unknown }).Tier;
          return typeof tier === 'number' && tier > 0;
        }).length;
        return ratio(steel, picture.nodes.total ?? totals.nodes ?? null);
      }

      /* ---- mastery ------------------------------------------------------ */
      case 'mastery.rank': {
        // Deliberately NOT a percentage toward "max MR": DE raises the cap every
        // update, so any denominator we pick is wrong within months. Reported as
        // unmeasured; the Mastery panel shows the real rank and XP instead.
        return null;
      }

      case 'mastery.unranked': {
        /*
         * WHAT THIS USED TO MEASURE, AND WHY IT WAS WRONG TWICE.
         *
         * It walked four inventory arrays - Suits, LongGuns, Pistols, Melee -
         * and called an item done if its `XP` was above zero. Both halves were
         * wrong, and neither could crash or log.
         *
         * THE LIST WAS SHORT BY TWENTY-THREE. `mastery.ts` names twenty-seven
         * equipment arrays in `EQUIPMENT_KEYS`, verbatim from DE's own
         * `equipmentKeys`. Every sentinel, sentinel weapon, archwing, arch-gun,
         * arch-melee, amp, K-drive, Necramech, MOA and beast the account owned
         * fell outside the fraction entirely - counted in NEITHER half, so the
         * ratio described a slice of the gear and was printed as if it described
         * all of it. Nothing about the shape of the number said so.
         *
         * AND "HAS ANY XP" IS NOT "AT MAX RANK", which is what this pursuit's own
         * label promises the reader. Practically every owned item has been fired
         * once, so the bar sat near 100% for every account, and the ranker read
         * the player's single largest no-acquisition mastery gain as finished.
         *
         * There is nothing here to compute. `ownership()` already answers exactly
         * this question, over all eleven catalog categories, using each item's
         * real `maxRank` and the conservative rank-40 test in `isMaxRanked` - and
         * its report is ALREADY passed in for the collection pursuits. So the
         * only work was deleting the worse answer standing in front of it.
         *
         * `masteredOwned` is deliberately conservative: an instance with no `XP`
         * on it - a modular part - can never satisfy it, and a rank-40 weapon
         * must also show its five Forma. It can under-report a finished item; it
         * can never call an unfinished one done. That bias belongs on this bar,
         * whose whole purpose is to point at work that remains.
         */
        if (!totals.ownership) return null;
        const t = totalOwnership(totals.ownership);
        return ratio(t.masteredOwned, t.owned);
      }

      /* ---- collection ---------------------------------------------------
       * Every one of these is a real owned-over-obtainable ratio from DE's own
       * item export, not an estimate. `ownership()` already excludes items that
       * can no longer be acquired from both sides of the fraction, so 100% is
       * actually reachable.
       */
      case 'collection.frames':
      case 'collection.primary':
      case 'collection.secondary':
      case 'collection.melee':
      case 'collection.companions':
      case 'collection.archwing': {
        const cats = PURSUIT_CATEGORIES[p.id];
        if (!cats) return null;
        const sum = summed(totals.ownership, cats);
        return sum ? ratio(sum.owned, sum.total) : null;
      }

      case 'mastery.unowned': {
        // The whole masterable catalog at once — the honest reading of "acquire
        // everything you have never owned".
        const report = totals.ownership;
        if (!report) return null;
        let owned = 0;
        let total = 0;
        for (const row of report.byCategory.values()) {
          owned += row.owned;
          total += row.total;
        }
        return ratio(owned, total);
      }

      /* ---- syndicates ---------------------------------------------------- */
      case 'syndicate.ranks': {
        /*
         * Ranks held across every syndicate that has been joined.
         *
         * `Affiliations[].Title` is the rank index, and the main syndicates run
         * -2..5, so 5 is max. Measured over the syndicates the account has
         * ACTUALLY joined rather than over every syndicate that exists: joining
         * one of an opposed pair permanently blocks the other, so a denominator
         * of "all syndicates" would describe a state no account can reach.
         */
        const aff = (arr(inv, 'Affiliations') ?? []).filter((a) => MAIN_SYNDICATES.has(String((a as { Tag?: unknown }).Tag)));
        if (aff.length === 0) return null;
        let held = 0;
        for (const a of aff) {
          const title = (a as { Title?: unknown }).Title;
          if (typeof title === 'number') held += Math.max(0, Math.min(title, SYNDICATE_MAX_RANK));
        }
        return ratio(held, aff.length * SYNDICATE_MAX_RANK);
      }

      /* ---- operator ----------------------------------------------------- */
      case 'focus.schools': {
        // Unlocked focus nodes. There is no account-side total for the trees and
        // no vendored focus dataset, so the COUNT is real (see `pursuitCount`)
        // but there is no denominator to divide by.
        return null;
      }

      /* ---- railjack ----------------------------------------------------- */
      case 'railjack.intrinsics':
        return skillProgress(inv, RAILJACK_SKILLS);
      case 'railjack.drifter':
        return skillProgress(inv, DRIFTER_SKILLS);

      case 'railjack.proxima':
        // The cleared count IS available (see `pursuitCount`), but there is no
        // vendored Proxima node total to divide by, so there is no honest ratio.
        return null;

      /* ---- nemesis ------------------------------------------------------ */
      case 'nemesis.active': {
        // A nemesis is binary: you either have one to resolve or you do not.
        const lich = obj(inv, 'Nemesis');
        if (!lich) return null;
        return Object.keys(lich).length > 0 ? 0 : 1;
      }

      /* ---- economy ------------------------------------------------------ */
      case 'economy.foundry': {
        // "Nothing pending" is complete. `PendingRecipes` is the queue.
        const pending = arr(inv, 'PendingRecipes');
        if (!pending) return null;
        return pending.length === 0 ? 1 : 0;
      }

      case 'economy.credits': {
        // A floor, not a completion. Deliberately unmeasured: there is no
        // "enough credits" and a bar implying one would be meaningless.
        return null;
      }

      /* ---- mods --------------------------------------------------------- */
      case 'mods.collection':
        // The distinct-mod count is available (see `pursuitCount`), but the game
        // ships no mod total and we have not vendored one, so no ratio.
        return null;

      default:
        // Everything else is genuinely not derivable from what the game sends
        // today. It stays on the board, marked unmeasured.
        return null;
    }
  };
}

/**
 * The raw counts worth showing next to an unmeasured pursuit.
 *
 * A pursuit with no denominator can still report a real numerator — "412 mods
 * owned" is true and useful even though "412 of ?" is not a percentage. This is
 * how the board stays informative without inventing totals.
 */
export function pursuitCount(inv: RawInventory | null, p: Pursuit): { value: number; unit: string } | null {
  if (!inv) return null;

  switch (p.id) {
    case 'mods.collection': {
      const n = distinctTypes(inv, ['RawUpgrades', 'Upgrades']);
      return n == null ? null : { value: n, unit: 'distinct mods' };
    }
    case 'relics.owned':
      // `MiscItems` mixes relics in with every resource and component, and
      // nothing in the account data separates them. Reporting the bucket size would
      // be a wrong number wearing the right label.
      return null;
    case 'railjack.proxima': {
      const missions = arr(inv, 'Missions');
      if (!missions) return null;
      const done = missions.filter((m) => {
        const tag = (m as { Tag?: unknown }).Tag;
        return typeof tag === 'string' && tag.startsWith('CrewBattleNode');
      }).length;
      return { value: done, unit: 'Proxima nodes cleared' };
    }
    case 'syndicate.ranks': {
      const aff = arr(inv, 'Affiliations');
      return aff == null ? null : { value: aff.length, unit: 'syndicates joined' };
    }
    case 'focus.schools': {
      const n = arr(inv, 'FocusUpgrades');
      return n == null ? null : { value: n.length, unit: 'focus nodes unlocked' };
    }
    case 'focus.waybound': {
      // Waybound nodes are the subset flagged universal.
      const list = arr(inv, 'FocusUpgrades');
      if (!list) return null;
      const bound = list.filter((u) => (u as { IsUniversal?: unknown }).IsUniversal === true).length;
      return { value: bound, unit: 'waybound unlocked' };
    }
    case 'nemesis.weapons': {
      // Kuva / Tenet / Coda weapons live in the normal weapon bins; they are
      // identified by their lich manufacturer path.
      const n = ['LongGuns', 'Pistols', 'Melee'].reduce((acc, bin) => {
        const list = arr(inv, bin);
        if (!list) return acc;
        return (
          acc +
          list.filter((e) => {
            const t = (e as { ItemType?: unknown }).ItemType;
            return typeof t === 'string' && /KuvaLich|Corpus\/Lich|Coda/i.test(t);
          }).length
        );
      }, 0);
      return { value: n, unit: 'nemesis weapons owned' };
    }
    case 'economy.forma': {
      // Forma sits in MiscItems by its blueprint path.
      const misc = arr(inv, 'MiscItems');
      if (!misc) return null;
      const forma = misc.find((m) => {
        const t = (m as { ItemType?: unknown }).ItemType;
        return typeof t === 'string' && t.endsWith('/Types/Items/MiscItems/Forma');
      }) as { ItemCount?: unknown } | undefined;
      const n = typeof forma?.ItemCount === 'number' ? forma.ItemCount : 0;
      return { value: n, unit: 'forma held' };
    }
    case 'mods.rivens': {
      const n = arr(inv, 'Upgrades');
      if (!n) return null;
      const rivens = n.filter((u) => {
        const t = (u as { ItemType?: unknown }).ItemType;
        return typeof t === 'string' && /Randomized/i.test(t);
      }).length;
      return { value: rivens, unit: 'rivens held' };
    }
    case 'railjack.crew': {
      const n = arr(inv, 'CrewMembers');
      return n == null ? null : { value: n.length, unit: 'crew hired' };
    }
    case 'collection.companions': {
      const n = distinctTypes(inv, ['Sentinels', 'KubrowPets', 'MoaPets']);
      return n == null ? null : { value: n, unit: 'companions owned' };
    }
    case 'collection.archwing': {
      const n = distinctTypes(inv, ['SpaceSuits', 'SpaceGuns', 'SpaceMelee']);
      return n == null ? null : { value: n, unit: 'archwing items owned' };
    }
    case 'economy.foundry': {
      const pending = arr(inv, 'PendingRecipes');
      return pending == null ? null : { value: pending.length, unit: 'builds in progress' };
    }
    default:
      return null;
  }
}

/**
 * How a pursuit is measured — or why it cannot be.
 *
 * WHY THIS IS PART OF THE PRODUCT, NOT A DEBUG AID
 * ────────────────────────────────────────────────
 * Roughly half the board reads "not measured", and without an explanation that
 * is indistinguishable from the app being broken. Naming the exact field a
 * number comes from does two things: it lets the player judge how much to trust
 * a figure, and it makes the gaps legible as facts about what the game sends
 * rather than as omissions on our part.
 *
 * Every string here names a real field from `docs/research/inventory-schema.md`
 * or states the specific reason no honest ratio exists.
 */
export function measurementNote(id: string): string {
  switch (id) {
    case 'quests.main':
    case 'quests.side':
      return 'Read from QuestKeys[].Completed, against the vendored quest list, which marks which quests are mainline. Quests with no canonical id are left out of the fraction rather than guessed.';

    case 'junctions':
      return 'Counted from Missions[] entries whose tag ends in "Junction", against the vendored junction list.';

    case 'nodes.normal':
      return 'Counted from Missions[] tags, against the vendored star chart. Missions[] only ever contains content cleared at least once, so presence is proof of a clear.';

    case 'nodes.steel':
      return 'Counted from Missions[] entries carrying a Tier field, which marks a Steel Path clear, over the same node total.';

    case 'mastery.rank':
      return 'Deliberately not shown as a percentage. Digital Extremes raises the rank cap regularly, so any denominator would be wrong within months. The Mastery panel shows your real rank and XP instead.';

    case 'mastery.unranked':
      return 'The share of the gear you own that is already at its rank cap, summed over every category in the item catalog. Rank is read from the affinity on each owned instance against the cap that item carries, and a rank-40 weapon must also show the five Forma the cap needs - so an item is only counted as finished when the account proves it.';

    case 'mastery.unowned':
    case 'collection.frames':
    case 'collection.primary':
    case 'collection.secondary':
    case 'collection.melee':
    case 'collection.companions':
    case 'collection.archwing':
      return 'Owned against obtainable, from your equipment bins joined to DE’s own item export. Founder-exclusives are removed from both sides of the fraction, so 100 percent is actually reachable.';

    case 'railjack.intrinsics':
    case 'railjack.drifter':
      return 'Summed from PlayerSkills, over every tree, each capped at rank 10.';

    case 'railjack.proxima':
      return 'The cleared count comes from Missions[] tags beginning "CrewBattleNode". There is no vendored Proxima node total, so the count is real but the percentage is not available.';

    case 'syndicate.ranks':
      return 'Ranks held from Affiliations[].Title, measured across the syndicates you have actually joined — joining one of an opposed pair permanently blocks the other, so counting every syndicate would describe a state no account can reach.';

    case 'economy.foundry':
      return 'Complete when PendingRecipes is empty. An idle foundry slot is wasted time, so this reads as unfinished whenever anything is building.';

    case 'nemesis.active':
      return 'Read from the Nemesis field. An active lich taxes your rewards and holds nodes, so it counts as unfinished until vanquished or converted.';

    case 'focus.schools':
    case 'focus.waybound':
      return 'Unlocked nodes are counted from FocusUpgrades, but the game sends no total for the trees and no focus dataset has been vendored, so there is no denominator yet.';

    case 'mods.collection':
      return 'Distinct mods are counted across RawUpgrades and Upgrades. The game ships no mod total, so the count is real but there is no percentage.';

    case 'relics.owned':
      return 'MiscItems mixes relics in with every resource and component, and nothing in the payload separates them. Reporting that bucket size would be a wrong number wearing the right label.';

    case 'economy.credits':
      return 'Not shown as progress on purpose: there is no "enough credits", so a completion bar would be meaningless.';

    default:
      return 'The game does not currently send a field this can be measured from. It stays on the board because it is still part of completion — it is simply not something this app can verify yet.';
  }
}
