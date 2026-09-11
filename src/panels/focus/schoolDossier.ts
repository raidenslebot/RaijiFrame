/**
 * ONE SCHOOL, ANSWERED.
 *
 * WHAT WAS WRONG
 * ──────────────
 * FocusPanel rendered five schools as five bars and one aggregate node count,
 * and threw away every per-school fact on the way to the screen. `FocusUpgrades`
 * carries an ItemType path whose FOURTH SEGMENT IS THE SCHOOL - SNS derives the
 * polarity from exactly that, `"AP_" + type.substring(1).split("/")[3]`
 * (docs/research/subsystems.md, "School to polarity mapping", [V-SNS]) - and the
 * panel called `.length` on the array and stopped. So a player could read "47
 * nodes unlocked" and had no way to learn that forty of them sit in one school.
 * Nothing on the panel was per-school except a bar.
 *
 * WHY THERE IS A COST IN HERE AT ALL
 * ──────────────────────────────────
 * FocusPanel's own header says, correctly, that the account carries unspent
 * pools and which nodes are unlocked but never what a node COST, so focus spent
 * and focus still needed cannot be computed and are not drawn. That stands. This
 * module adds no node cost table and computes neither of those figures.
 *
 * What it does use is the one focus price the repository's own research pins
 * from two independent sources: unbinding a Way-Bound node costs 750,000 focus
 * plus one Brilliant Eidolon Shard, from SNS's `UnbindUpgrade` op [V-SNS] and
 * from the wiki [V-WIKI], cross-checked by the wiki's per-school total of
 * 1,500,000 for both nodes - which is 2 x 750,000 exactly
 * (docs/research/subsystems.md, "What complete means"). That is not a rank-up
 * cost that varies per node and per rank; it is a flat published price, the same
 * for every waybound node in the game. A number verified twice and constant
 * across the content is a fact about the game, in the same class as the daily
 * cap formula this panel already prints. That is the whole reason it can be
 * stated here while the rank-up table cannot.
 *
 * The same section pins two waybound nodes per school, ten in the game
 * [V-WIKI]. Tauron Strike is newer, appears in neither the export nor SNS, and
 * the research says outright that the inventory shape recording it is UNKNOWN -
 * so it is not counted, not guessed at, and said so on screen.
 *
 * HONESTY
 * ───────
 * Every field that depends on the account is `| null`, and null means UNREAD,
 * never zero. The verdict is shaped as a `Need` from plat-picks - the house
 * vocabulary for "required / held / met, and met has three states" - so an
 * unreadable requirement is still stated and still says what would settle it.
 *
 * The `Need` TYPE is imported and its two constructors are not: `need()` and
 * `condition()` live in plat-picks, which pulls in the platinum valuation graph
 * (plat-value, standing-value, market, ducats). Dragging five modules of trade
 * pricing into the focus chunk to reuse eight lines of object literal is a worse
 * trade than writing the eight lines. The semantics are copied exactly, and the
 * type is what enforces that.
 */

import type { RawAccount } from '../../data/account';
import type { Need } from '../../data/plat-picks';
import type { FocusSchoolKey } from '../../data/subsystems';

/**
 * Focus to unbind ONE waybound node. [V-SNS] `UnbindUpgrade`, [V-WIKI], and the
 * wiki's own per-school total divides by it exactly.
 */
export const WAYBOUND_UNBIND_COST = 750_000;

/** Waybound nodes per school. [V-WIKI]: "a total of 10 Way-Bound nodes". */
export const WAYBOUND_PER_SCHOOL = 2;

/**
 * Path directory to polarity key.
 *
 * Segment 3 of the path with its leading slash dropped, which is what SNS reads.
 * A path that does not land on one of these five is NOT forced into a school -
 * it is counted as unplaced and reported, because Tauron Strike's inventory
 * shape is explicitly unknown and a wrong school is worse than an honest count.
 */
const SCHOOL_DIR: Readonly<Record<string, FocusSchoolKey>> = {
  Attack: 'AP_ATTACK',
  Defense: 'AP_DEFENSE',
  Tactic: 'AP_TACTIC',
  Ward: 'AP_WARD',
  Power: 'AP_POWER',
};

/** `/Lotus/Upgrades/Focus/Attack/Active/DashFireFocusUpgrade` -> `AP_ATTACK`. */
export function schoolOfPath(path: string): FocusSchoolKey | null {
  const seg = path.replace(/^\//, '').split('/')[3];
  return seg === undefined ? null : (SCHOOL_DIR[seg] ?? null);
}

/** What the account holds in one school's tree. */
export interface SchoolNodes {
  /** Nodes of this school present on the account. */
  unlocked: number;
  /** Of those, how many have been unbound - `IsUniversal: true`. */
  unbound: number;
}

export interface FocusNodeCensus {
  bySchool: ReadonlyMap<FocusSchoolKey, SchoolNodes>;
  /**
   * Nodes whose path named no school directory. Zero on every account this
   * mapping covers; non-zero is the signal that DE shipped a tree shape the
   * research has not seen, which the panel says out loud rather than absorbing.
   */
  unplaced: number;
  /** Unbound nodes across all five schools. */
  unboundTotal: number;
}

/**
 * Sort `FocusUpgrades` into schools. Cheap - one pass over a list that is a few
 * dozen entries at most - but it depends only on the inventory object, so the
 * panel memoises it on that identity rather than recomputing per selection.
 */
export function nodeCensus(acc: RawAccount): FocusNodeCensus {
  const bySchool = new Map<FocusSchoolKey, SchoolNodes>();
  let unplaced = 0;
  let unboundTotal = 0;

  for (const node of acc.FocusUpgrades ?? []) {
    const path = node.ItemType;
    const key = typeof path === 'string' ? schoolOfPath(path) : null;
    if (key === null) {
      unplaced += 1;
      continue;
    }
    const row = bySchool.get(key) ?? { unlocked: 0, unbound: 0 };
    row.unlocked += 1;
    if (node.IsUniversal === true) {
      row.unbound += 1;
      unboundTotal += 1;
    }
    bySchool.set(key, row);
  }

  return { bySchool, unplaced, unboundTotal };
}

/** Everything the panel shows about the ONE school a reader picked. */
export interface SchoolDossier {
  key: FocusSchoolKey;
  /** Unspent focus banked here, in full. Null is UNREAD, never zero. */
  pooled: number | null;
  /** 0..1 of the pooled total across all five. Null when unread or the total is zero. */
  share: number | null;
  /** Nodes of this school on the account. */
  nodes: number | null;
  /** Of those, how many are already unbound. */
  unbound: number | null;
  /** Waybound nodes here still to unbind. */
  remaining: number | null;
  /**
   * THE ANSWER. What finishing this school's waybound nodes costs, checked
   * against the pool this school actually holds.
   */
  bill: Need;
  /** Focus short of the bill. Null when covered, already done, or unread. */
  shortfall: number | null;
  /**
   * A LOWER bound on days to close that shortfall: the daily cap is shared
   * across all five schools, so this is the count only if every point of it goes
   * here. Null when the cap is unknown or nothing is owed.
   */
  days: number | null;
}

export interface DossierInput {
  key: FocusSchoolKey;
  /** From `focusState().schools`. Null when no account has been read. */
  pooled: number | null;
  pooledTotal: number | null;
  /** This school's row of the census, or null when unread. Absent from a read census means zero nodes. */
  nodes: SchoolNodes | null;
  /** `250,000 + MR x 5,000`, or null when mastery rank is missing. */
  dailyCap: number | null;
  /** What would settle an unread value - goes into `Need.unknown`. */
  unread: string;
}

export function schoolDossier(input: DossierInput): SchoolDossier {
  const { key, pooled, pooledTotal, nodes, dailyCap, unread } = input;

  const remaining = nodes === null ? null : Math.max(0, WAYBOUND_PER_SCHOOL - nodes.unbound);

  /*
   * With nothing read, how many are LEFT is unknown - so the requirement stated
   * is the whole school's, 2 x 750,000, which is true of every account and
   * therefore not an invention about this one. `have` stays null and `met` stays
   * null, which is what makes the card read as unread rather than as a shortfall
   * of the full amount.
   */
  const owed = (remaining ?? WAYBOUND_PER_SCHOOL) * WAYBOUND_UNBIND_COST;

  const bill: Need =
    remaining === 0
      ? {
          what: 'Both waybound nodes are already unbound',
          need: null,
          have: null,
          unit: '',
          met: true,
        }
      : {
          what:
            remaining === null
              ? 'Unbind both waybound nodes'
              : remaining === 1
                ? 'Unbind the last waybound node'
                : 'Unbind both waybound nodes',
          need: owed,
          have: pooled,
          unit: 'focus',
          met: pooled === null ? null : pooled >= owed,
          ...(pooled === null ? { unknown: unread } : {}),
        };

  const shortfall = pooled === null || remaining === null || remaining === 0 ? null : Math.max(0, owed - pooled);

  const days =
    shortfall === null || shortfall === 0 || dailyCap === null || dailyCap <= 0
      ? null
      : Math.ceil(shortfall / dailyCap);

  return {
    key,
    pooled,
    share: pooled === null || pooledTotal === null || pooledTotal <= 0 ? null : pooled / pooledTotal,
    nodes: nodes === null ? null : nodes.unlocked,
    unbound: nodes === null ? null : nodes.unbound,
    remaining,
    bill,
    shortfall,
    days,
  };
}
