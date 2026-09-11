/**
 * SEVERAL BUILDS AT ONCE, AND WHAT THEY TAKE FROM EACH OTHER.
 *
 * THE GAP THIS CLOSES
 * ───────────────────
 * `checkBuildable` answers "can I build THIS", one blueprint at a time, and
 * that answer is true and incomplete in a way that misleads. Two blueprints can
 * each report "can start now" while both wanting the same four Orokin Cells,
 * and if you hold four you cannot build both. Nothing in the app said so. The
 * player reads two green verdicts, starts one, and watches the other turn red
 * for a reason that was knowable the whole time.
 *
 * A stock is not a property of one recipe. It is a POOL, and the moment more
 * than one thing draws on it the interesting question stops being "is this
 * affordable" and becomes "which of these are affordable TOGETHER".
 *
 * WHY THIS IS THE INTERACTION AND NOT A READOUT
 * ─────────────────────────────────────────────
 * Every control in this app had become a toggle: open a section, hide a row,
 * cycle a card. Show and unshow. Nothing a player did ever changed a NUMBER.
 *
 * This is the other kind. Selecting a second blueprint does not reveal
 * anything that was already computed and hidden - it makes the app compute
 * something it could not have known before, because the answer depends on the
 * set the player chose. Add a build and the shortfall moves. Remove it and the
 * shortfall moves back. That is a control that does arithmetic, not a control
 * that draws a curtain.
 *
 * WHAT IT REFUSES TO CLAIM
 * ────────────────────────
 * Pooling is keyed on the game's own item path and never on a display name -
 * 187 of 324 component names are shared, so a name-keyed sum would add Ash's
 * Chassis to Ash Prime's. An ingredient the catalog gave no path stays
 * UNKNOWN and is never pooled as zero; a queue containing one is
 * `unverifiable`, never `all`.
 *
 * The subset it reports as affordable is chosen GREEDILY, cheapest-first, and
 * says so. Finding the largest affordable subset is a knapsack problem and the
 * honest options were an exact solver nobody asked for or a stated
 * approximation. It is stated.
 */

import type { Buildable } from './buildable.ts';
import type { RawAccount } from './account.ts';
import type { Need } from './plat-picks.ts';

/** Who wants a given stock, and how much of it. */
export interface Claim {
  /** The product's display name, for saying which build wants it. */
  product: string;
  /** The blueprint path, so a claim can be traced back to its row exactly. */
  blueprint: string;
  wants: number;
}

/** One stock, pooled across every build in the queue. */
export interface PooledNeed extends Need {
  /** The game's item path. Null when the catalog gave the ingredient none. */
  itemType: string | null;
  /** Every build drawing on this stock. Length > 1 means it is shared. */
  claims: readonly Claim[];
  /**
   * More than one build wants it AND the pool cannot cover the total.
   *
   * This is the finding the panel exists to surface: each build alone is
   * satisfied, together they are not, and the reason is this row.
   */
  contested: boolean;
}

export type QueueVerdict =
  /** Every requirement checked and the pool covers all of them. */
  | 'all'
  /** The pool cannot cover the queue as a whole. */
  | 'short'
  /** Nothing is short, but something could not be read. */
  | 'unverifiable'
  /** Nothing selected. */
  | 'empty';

export interface BuildQueue {
  verdict: QueueVerdict;
  /** Every pooled stock, shared ones first, then by how short they are. */
  needs: readonly PooledNeed[];
  /** Only the ones the pool cannot cover. */
  short: readonly PooledNeed[];
  /**
   * Stocks that are ONLY short because more than one build wants them.
   * Every build in the queue would be individually satisfied without these.
   */
  contested: readonly PooledNeed[];
  /**
   * Blueprints affordable together, chosen greedily by fewest requirements
   * first. An approximation, not the largest possible set - see the header.
   */
  affordable: readonly string[];
  /** Blueprints left over once the pool is spent on `affordable`. */
  blocked: readonly string[];
}

const UNREAD = 'link the game and open your foundry once, so the inventory is read';
const NO_KEY = 'the catalog gives this ingredient no item path, so the amount you hold cannot be looked up';
const CREDITS = 'credits';

function held(list: readonly { ItemType?: string; ItemCount?: number }[] | undefined, itemType: string): number {
  let total = 0;
  for (const row of list ?? []) if (row?.ItemType === itemType) total += row.ItemCount ?? 0;
  return total;
}

/** Same two-array lookup `checkBuildable` uses: a part may be crafted or unbuilt. */
function stockOf(acc: RawAccount, itemType: string): number {
  return held(acc.MiscItems, itemType) + held(acc.Recipes, itemType);
}

/**
 * Pool a set of builds against one inventory.
 *
 * `acc` null means nothing is known: every stock reports unknown, and the
 * queue is `unverifiable`. It still lists WHAT the queue costs, because the
 * cost is a fact about the recipes and not about the player.
 */
export function queueOf(builds: readonly Buildable[], acc: RawAccount | null): BuildQueue {
  if (builds.length === 0) {
    return { verdict: 'empty', needs: [], short: [], contested: [], affordable: [], blocked: [] };
  }

  /*
   * Keyed by item path. The two ingredients that cannot be: one with no path
   * at all, and credits, which is not an inventory row. Both are handled
   * explicitly rather than being given a fake key, because a fake key is how
   * two different unknowns get added together.
   */
  const byType = new Map<string, { name: string; want: number; claims: Claim[] }>();
  const unkeyed: PooledNeed[] = [];

  for (const b of builds) {
    for (const part of b.parts) {
      const claim: Claim = { product: b.product ?? b.itemType, blueprint: b.itemType, wants: part.want };
      if (part.itemType === null) {
        // Not pooled: with no key there is no stock to pool against, and two
        // unkeyed ingredients from different builds are not known to be the
        // same thing. Each is reported on its own, unknown.
        unkeyed.push({
          what: part.name,
          itemType: null,
          need: part.want,
          have: null,
          unit: '',
          met: null,
          unknown: NO_KEY,
          claims: [claim],
          contested: false,
        });
        continue;
      }
      const row = byType.get(part.itemType) ?? { name: part.name, want: 0, claims: [] };
      row.want += part.want;
      row.claims.push(claim);
      byType.set(part.itemType, row);
    }
  }

  const needs: PooledNeed[] = [];

  for (const [itemType, row] of byType) {
    const have = acc === null ? null : stockOf(acc, itemType);
    const met = have === null ? null : have >= row.want;
    /*
     * CONTESTED is the whole point, and it is deliberately narrow.
     *
     * Not "shared", and not "short" - both of those are ordinary. It is short
     * AND shared AND every claimant would have been satisfied alone. That last
     * clause is what makes it a finding rather than a restatement: it means the
     * shortfall was created by the COMBINATION, which is the one thing checking
     * builds one at a time can never report.
     */
    const shared = row.claims.length > 1;
    const eachAlone = have === null ? false : row.claims.every((c) => have >= c.wants);
    needs.push({
      what: row.name,
      itemType,
      need: row.want,
      have,
      unit: '',
      met,
      ...(have === null ? { unknown: UNREAD } : {}),
      claims: row.claims,
      contested: met === false && shared && eachAlone,
    });
  }

  // Credits pool like anything else, and are the requirement most often
  // forgotten: four builds at 25,000 apiece is 100,000, not 25,000.
  const creditTotal = builds.reduce((n, b) => n + (b.credits ?? 0), 0);
  if (creditTotal > 0) {
    const have = acc === null ? null : (acc.RegularCredits ?? null);
    const claims = builds
      .filter((b) => (b.credits ?? 0) > 0)
      .map((b) => ({ product: b.product ?? b.itemType, blueprint: b.itemType, wants: b.credits ?? 0 }));
    needs.push({
      what: 'Credits',
      itemType: null,
      need: creditTotal,
      have,
      unit: CREDITS,
      met: have === null ? null : have >= creditTotal,
      ...(have === null ? { unknown: UNREAD } : {}),
      claims,
      contested:
        have !== null && have < creditTotal && claims.length > 1 && claims.every((c) => have >= c.wants),
    });
  }

  needs.push(...unkeyed);

  // Contested first - it is the finding. Then short, then everything else.
  needs.sort((a, b) => {
    if (a.contested !== b.contested) return a.contested ? -1 : 1;
    const rank = (n: PooledNeed): number => (n.met === false ? 0 : n.met === null ? 1 : 2);
    return rank(a) - rank(b) || a.what.localeCompare(b.what);
  });

  const short = needs.filter((n) => n.met === false);
  const contested = needs.filter((n) => n.contested);
  const unread = needs.some((n) => n.met === null);
  const verdict: QueueVerdict = short.length > 0 ? 'short' : unread ? 'unverifiable' : 'all';

  return { verdict, needs, short, contested, ...allocate(builds, acc) };
}

/**
 * Which of these could actually be started, spending the pool once.
 *
 * ponytail: greedy, fewest-requirements-first. The exact answer is a knapsack
 * and would need a solver; this can therefore report a smaller set than is
 * possible. It is never WRONG about what it does report - each build in
 * `affordable` is checked against the stock left after the ones before it -
 * and the panel says the order it used, so a player who disagrees can reorder
 * the queue and get the other answer. Upgrade to an exact search only if a
 * real queue is ever long enough for the difference to matter.
 */
function allocate(
  builds: readonly Buildable[],
  acc: RawAccount | null,
): { affordable: readonly string[]; blocked: readonly string[] } {
  if (acc === null) return { affordable: [], blocked: builds.map((b) => b.itemType) };

  const stock = new Map<string, number>();
  const take = (itemType: string): number => {
    const seen = stock.get(itemType);
    if (seen !== undefined) return seen;
    const n = stockOf(acc, itemType);
    stock.set(itemType, n);
    return n;
  };
  let credits = acc.RegularCredits ?? 0;

  const order = [...builds].sort((a, b) => a.parts.length - b.parts.length);
  const affordable: string[] = [];
  const blocked: string[] = [];

  for (const b of order) {
    // A build with an unreadable ingredient can never be promised, so it is
    // blocked rather than being allowed to consume stock on a guess.
    const readable = b.parts.every((p) => p.itemType !== null);
    const cost = b.credits ?? 0;
    const canPay = readable && cost <= credits && b.parts.every((p) => p.itemType !== null && take(p.itemType) >= p.want);
    if (!canPay) {
      blocked.push(b.itemType);
      continue;
    }
    for (const p of b.parts) if (p.itemType !== null) stock.set(p.itemType, take(p.itemType) - p.want);
    credits -= cost;
    affordable.push(b.itemType);
  }

  return { affordable, blocked };
}
