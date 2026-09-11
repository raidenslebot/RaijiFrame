/**
 * CAN YOU ACTUALLY BUILD IT — every blueprint you hold, checked against every
 * resource you hold.
 *
 * THE GAP THIS CLOSES
 * ───────────────────
 * The foundry panel listed the blueprints in your inventory and stopped there.
 * A list of things you own is not the question anybody has in front of a
 * foundry. The question is which of them you can start RIGHT NOW, and for the
 * ones you cannot, what you are short and by how much — and the app had every
 * number needed to answer that and answered none of it.
 *
 * It had them because two separate joins were already sitting unused:
 *
 *   `Recipes[]`   in the account is exactly "blueprints owned, not started".
 *   `MiscItems[]` in the account is every resource and crafted part you hold,
 *                 with counts, keyed by the game's own `/Lotus/...` path.
 *   `components`  in the item catalog is the ingredient list, with counts,
 *                 keyed by that SAME path.
 *
 * Three arrays that join on one key, and nothing joined them.
 *
 * WHY THE JOIN IS ON THE PATH AND NEVER ON THE NAME
 * ────────────────────────────────────────────────
 * The obvious implementation matches component names against resource names,
 * and it is wrong in a way that produces confident nonsense rather than an
 * error. Measured across all eleven catalog categories: 187 of the 324
 * distinct component names are shared by more than one item. "Blueprint"
 * appears 901 times. "Systems" 126, "Chassis" 118, "Neuroptics" 114 — every
 * warframe's three parts collide with every other warframe's, so a name join
 * cannot distinguish Ash's Chassis from Ash Prime's, which is precisely the
 * distinction a foundry check exists to make.
 *
 * `uniqueName` is the account's own key and it is exact. `itemdb.ts` now
 * carries it (270 KB, measured) for this.
 *
 * WHAT IT REFUSES TO CLAIM
 * ────────────────────────
 * Every requirement is a `Need` from the platinum panel's vocabulary, whose
 * `met` has three states and whose third is the point:
 *
 *   true   you hold enough, and both numbers are shown
 *   false  you are short, by a stated amount
 *   null   IT CANNOT BE CHECKED — and `unknown` says what would settle it
 *
 * There are three real ways a requirement here lands on `null`, and none of
 * them is allowed to render as a zero:
 *
 *   1. The account has never been read. Nothing is known about any holding.
 *   2. The catalog row for this component carries no `uniqueName`, so there is
 *      no key to look the holding up by.
 *   3. The blueprint's product is not in the catalog at all, so there is no
 *      ingredient list to check — a recipe path is not guaranteed to resolve.
 *
 * A blueprint with any unreadable requirement is `unverifiable`, never
 * `ready`. Saying "you can build this" on the strength of the requirements we
 * happened to be able to see would be the same defect as showing a zero.
 */

import type { ItemDb, ItemDbEntry } from './itemdb.ts';
import type { Need } from './plat-picks.ts';
import { need } from './plat-picks.ts';
import type { RawAccount, TypeCount } from './account.ts';

/**
 * What the check concluded.
 *
 * `short` and `unverifiable` are kept apart on purpose: one is a fact about
 * your inventory, the other is a fact about how much of your inventory this
 * app can see. Collapsing them would make our blind spots look like your
 * shortfalls.
 */
export type BuildVerdict =
  /** Every requirement checked, every one met. */
  | 'ready'
  /** At least one requirement checked and short. */
  | 'short'
  /** Nothing is short, but at least one requirement could not be read. */
  | 'unverifiable'
  /** The catalog has no ingredient list for this product. */
  | 'no-recipe'
  /** The blueprint's path resolves to no catalog product. */
  | 'unplaced';

/**
 * One ingredient, keyed the way the account keys it.
 *
 * WHY THIS EXISTS ALONGSIDE `needs`
 * —————————————————————————————————
 * `needs` is for READING: it carries a display name, both numbers and the
 * three-state verdict, and it is what the panel renders. It is deliberately
 * the same `Need` the platinum cards use so the two screens speak one
 * language.
 *
 * It is useless for ARITHMETIC across builds, because its key is a display
 * name and display names collide: 187 of the 324 distinct component names in
 * the catalog are shared by more than one item, and "Blueprint" alone appears
 * 901 times. Adding up two builds' requirements by name would pool Ash's
 * Chassis with Ash Prime's and produce a confident wrong total.
 *
 * So the arithmetic reads this instead, which is keyed by the game's own item
 * path. `itemType` is null exactly when the catalog gave the component no
 * path - the one case where the amount held cannot be looked up at all, and
 * which must therefore stay unknown rather than being pooled as zero.
 */
export interface Ingredient {
  itemType: string | null;
  name: string;
  want: number;
  /**
   * The best place to get one, and how many places there are.
   *
   * "You are short one Chassis" is half an answer; the other half was in the
   * same catalog row the ingredient list came from. Absent for the many
   * ingredients the catalog gives no source for - crafted sub-parts you make
   * rather than find, and anything WFCD has no drop data on - and absent is
   * absent, never "nowhere".
   */
  from?: { at: string; pct: number; n: number };
}

export interface Buildable {
  /** The blueprint's own `/Lotus/...` path. Stable identity. */
  itemType: string;
  /** The product this blueprint makes, named by the catalog where it could be placed. */
  product: string | null;
  verdict: BuildVerdict;
  /** Every ingredient plus the credit cost, each checked. Empty when unplaced. */
  needs: readonly Need[];
  /** How many requirements are short. Sorts the worst-off last. */
  shortCount: number;
  /** How many could not be read at all. */
  unreadCount: number;
  /**
   * Of the quantity requirements that ARE readable, the fraction satisfied,
   * capped per requirement so one overflowing resource cannot mask four
   * missing ones. Null when nothing was readable. Used for ordering only —
   * it is never shown as a percentage complete, because it is not one.
   */
  closeness: number | null;
  /** Build time in seconds, from the catalog. Null when it does not carry one. */
  buildTimeSec: number | null;
  /** The same requirements, keyed by item path, for arithmetic across builds. */
  parts: readonly Ingredient[];
  /** Credits this one costs. Null when the catalog names no price. */
  credits: number | null;
}

/**
 * Reverse index: a component's path back to the product that needs it.
 *
 * This is what places a blueprint. A held recipe is `.../AshBlueprint`, and
 * the catalog lists exactly that path as Ash's "Blueprint" component — so the
 * blueprint identifies its own product with no name-guessing at all. Built
 * once per catalog rather than per blueprint.
 */
export function indexByComponent(db: ItemDb): ReadonlyMap<string, ItemDbEntry> {
  const out = new Map<string, ItemDbEntry>();
  for (const entry of db.byType.values()) {
    for (const c of entry.components ?? []) {
      if (c.uniqueName === undefined) continue;
      // FIRST WRITE WINS. A component path can appear under more than one
      // product (a shared part), and overwriting would make the answer depend
      // on catalog iteration order. The collision is real but rare, and a
      // stable wrong-parent beats an unstable one.
      if (!out.has(c.uniqueName)) out.set(c.uniqueName, entry);
    }
  }
  return out;
}

/** Sum an inventory array's counts for one path. */
function held(list: readonly TypeCount[] | undefined, itemType: string): number {
  let total = 0;
  for (const row of list ?? []) {
    if (row?.ItemType === itemType) total += row.ItemCount ?? 0;
  }
  return total;
}

/**
 * How many of one component path the account holds.
 *
 * Both arrays are consulted because a component can be either kind of thing: a
 * crafted part sits in `MiscItems`, an unbuilt sub-blueprint sits in
 * `Recipes`, and the ingredient list does not say which it will be. The paths
 * do not overlap between the two arrays, so the sum is a lookup in whichever
 * one has it rather than a double count.
 */
function heldAnywhere(acc: RawAccount, itemType: string): number {
  return held(acc.MiscItems, itemType) + held(acc.Recipes, itemType);
}

const UNREAD = 'link the game and open your foundry once, so the inventory is read';
const NO_KEY = 'the catalog gives this ingredient no item path, so the amount you hold cannot be looked up';

/**
 * Check one held blueprint.
 *
 * `acc` is null when no account has been read. That case does not shortcut to
 * an empty result: the requirements are still listed, with every holding
 * unknown, because what a thing COSTS is worth reading before you have linked
 * anything and is not a fact about you.
 */
export function checkBuildable(
  blueprintType: string,
  acc: RawAccount | null,
  byComponent: ReadonlyMap<string, ItemDbEntry>,
): Buildable {
  const entry = byComponent.get(blueprintType);
  if (entry === undefined) {
    return {
      itemType: blueprintType,
      product: null,
      verdict: 'unplaced',
      needs: [],
      shortCount: 0,
      unreadCount: 0,
      closeness: null,
      buildTimeSec: null,
      parts: [],
      credits: null,
    };
  }

  const base = {
    itemType: blueprintType,
    product: entry.name,
    buildTimeSec: entry.buildTime ?? null,
  };

  const components = entry.components ?? [];
  if (components.length === 0) {
    return { ...base, verdict: 'no-recipe', needs: [], shortCount: 0, unreadCount: 0, closeness: null, parts: [], credits: entry.buildPrice ?? null };
  }

  const needs: Need[] = [];
  const parts: Ingredient[] = [];
  let satisfied = 0;
  let readable = 0;

  for (const c of components) {
    // The blueprint you are standing on is not an ingredient to go and find.
    // Listing it would put "Blueprint 1 of 1" at the top of every single card.
    if (c.uniqueName === blueprintType) continue;

    const want = c.itemCount ?? 1;
    parts.push({
      itemType: c.uniqueName ?? null,
      name: c.name,
      want,
      ...(c.from === undefined ? {} : { from: c.from }),
    });
    if (c.uniqueName === undefined) {
      needs.push(need(c.name, want === 1 ? '' : 'held', want, null, NO_KEY));
      continue;
    }
    if (acc === null) {
      needs.push(need(c.name, want === 1 ? '' : 'held', want, null, UNREAD));
      continue;
    }
    const have = heldAnywhere(acc, c.uniqueName);
    needs.push(need(c.name, want === 1 ? '' : 'held', want, have));
    readable += 1;
    satisfied += Math.min(1, have / want);
  }

  // Credits are a requirement like any other and were the one nobody thought
  // of: a player can hold every ingredient for a Prime frame and still not
  // have the 25,000 credits, and be told to go and build it.
  if (entry.buildPrice !== undefined && entry.buildPrice > 0) {
    const credits = acc === null ? null : (acc.RegularCredits ?? null);
    needs.push(
      need(
        'Credits',
        'credits',
        entry.buildPrice,
        credits,
        acc === null ? UNREAD : 'the inventory carries no credit balance',
      ),
    );
    if (credits !== null) {
      readable += 1;
      satisfied += Math.min(1, credits / entry.buildPrice);
    }
  }

  const shortCount = needs.filter((n) => n.met === false).length;
  const unreadCount = needs.filter((n) => n.met === null).length;
  const verdict: BuildVerdict = shortCount > 0 ? 'short' : unreadCount > 0 ? 'unverifiable' : 'ready';

  return {
    ...base,
    verdict,
    needs,
    shortCount,
    unreadCount,
    closeness: readable === 0 ? null : satisfied / readable,
    buildTimeSec: entry.buildTime ?? null,
    parts,
    credits: entry.buildPrice ?? null,
  };
}

/**
 * The order a player wants: what you can start now, then what you are nearly
 * able to start, then what cannot be checked, then what the catalog cannot
 * place at all.
 *
 * Within `short`, the nearest-to-buildable comes first. That is the useful
 * ranking — a blueprint missing one Orokin Cell is a different proposition
 * from one missing four hundred Ferrite — and it is the reason `closeness`
 * exists. It is never rendered as a number, because "83% of the way to a
 * Braton" is not a thing that is true.
 */
const RANK: Record<BuildVerdict, number> = {
  ready: 0,
  short: 1,
  unverifiable: 2,
  'no-recipe': 3,
  unplaced: 4,
};

export function sortBuildables(rows: readonly Buildable[]): Buildable[] {
  return [...rows].sort((a, b) => {
    const byVerdict = RANK[a.verdict] - RANK[b.verdict];
    if (byVerdict !== 0) return byVerdict;
    if (a.verdict === 'short') {
      const byClose = (b.closeness ?? 0) - (a.closeness ?? 0);
      if (Math.abs(byClose) > 1e-9) return byClose;
    }
    return (a.product ?? a.itemType).localeCompare(b.product ?? b.itemType);
  });
}

/** How many of each verdict, for a heading that states what it is counting. */
export interface BuildTally {
  ready: number;
  short: number;
  unverifiable: number;
  unplaceable: number;
}

export function tally(rows: readonly Buildable[]): BuildTally {
  const t: BuildTally = { ready: 0, short: 0, unverifiable: 0, unplaceable: 0 };
  for (const r of rows) {
    if (r.verdict === 'ready') t.ready += 1;
    else if (r.verdict === 'short') t.short += 1;
    else if (r.verdict === 'unverifiable') t.unverifiable += 1;
    else t.unplaceable += 1;
  }
  return t;
}
