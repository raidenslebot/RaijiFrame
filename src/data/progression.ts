/**
 * Progression derivation.
 *
 * Turns the raw GEP inventory dump into the account picture the Progression panel
 * renders, and scores candidate actions for "what should I do next".
 *
 * Two kinds of number live here and they are kept strictly apart:
 *
 *   - DERIVED  — computed from the account's own inventory. Always trustworthy,
 *                because it is just counting what the player actually has.
 *   - CANONICAL — totals for the whole game (how many quests exist, how many
 *                nodes exist). These come from an external dataset. Until one is
 *                loaded, totals are `null` and the UI shows counts without
 *                percentages rather than inventing a denominator.
 *
 * That split is deliberate: a completionism tracker that guesses its own
 * denominator is worse than one that admits it doesn't know yet.
 */

import type { RawInventory } from '../core/gep';

export interface Counted {
  /**
   * How many the account has. `null` when the account never carried the field
   * at all - which is NOT zero, and must not be rendered as a measurement.
   *
   * `inv.Missions ?? []` used to conflate "the game sent an empty list" with
   * "the game did not send the list", and the result was a number. A thin read
   * therefore produced "you have cleared 0% of the star chart" - a claim about
   * the player made entirely out of our own missing data - two lines away from
   * a board that correctly reported the Steel Path as not measured from the
   * very same absent array.
   */
  have: number | null;
  /** Total in the game. `null` until the canonical dataset is loaded. */
  total: number | null;
}

export interface AccountPicture {
  masteryRank: number | null;
  /** Lifetime mastery XP pool, when GEP exposes it. */
  masteryXp: number | null;
  quests: Counted;
  nodes: Counted;
  /*
   * `arsenal` USED TO LIVE HERE. IT WAS DEAD, AND IT WAS DISHONEST.
   * ————————————————————————————————————————————
   * Four counts - frames, primaries, secondaries, melee - built as
   * `inv.Suits?.length ?? 0`. That `?? 0` is precisely the conflation `Counted`
   * above exists to prevent: an ABSENT array and an EMPTY one both became the
   * number 0, so a thin read reported "you own no frames" as a measurement.
   * The fix was applied to `quests` and to `nodes` and this third field was
   * missed, sitting two lines away from them in the same returned object.
   *
   * It is gone rather than repaired because nothing ever read it. Its only
   * reader was its own assertion in check-progression, and `account.ts` had
   * already superseded it with a per-array count covering all 27 equipment
   * arrays - including the two subtleties four fields cannot express: a sold
   * item leaves the arsenal but keeps its `XPInfo` row forever, and
   * `SpecialItems` holds exalted weapons the player never acquired.
   *
   * Repairing it would have left a second, worse answer to a question already
   * answered correctly elsewhere, which is how the duplicate-logic bugs in this
   * codebase started.
   */
  /** Quest item-types the account has completed, for the recommender to exclude. */
  completedQuests: Set<string>;
  /** SolNode tags the account has cleared at least once. */
  clearedNodes: Set<string>;
}

/** Last path segment of a `/Lotus/...` type, lowercased. Used for loose matching. */
function tail(s: string): string {
  const parts = s.split('/');
  return (parts[parts.length - 1] ?? s).toLowerCase();
}

/*
 * The tails of everything the account holds, built once per picture.
 * ————————————————————————————————————————————
 * The loose match below has to compare against every completed quest, and its
 * callers run it per action per prerequisite - which is a triple loop in a
 * `useMemo` on a board of a few hundred rows, i.e. exactly the kind of thing
 * that shows up as a stutter rather than as a bug.
 *
 * A `WeakMap` keyed on the picture costs one pass per account and nothing
 * after; the picture is already memoised upstream, so the entry is reused for
 * the life of that read and collected with it.
 */
const heldTailsByPicture = new WeakMap<AccountPicture, ReadonlySet<string>>();

function heldTails(picture: AccountPicture): ReadonlySet<string> {
  const cached = heldTailsByPicture.get(picture);
  if (cached !== undefined) return cached;
  const built = new Set<string>();
  for (const done of picture.completedQuests) built.add(tail(done));
  heldTailsByPicture.set(picture, built);
  return built;
}

/**
 * Does the account hold this quest id?
 *
 * ONE MEMBERSHIP TEST, BECAUSE THE RAW ONE IS WRONG.
 * ————————————————————————————————————————————
 * `completedQuests.has(id)` looks like the whole answer and is not: GEP and the
 * export occasionally disagree about a quest's exact key path, so a quest the
 * player HAS finished can be stored under a path the catalog does not use. The
 * loose match on the final segment is what covers that, and every place that
 * asks the question needs it.
 *
 * Two places were asking it raw. `recommend` used it to decide both "already
 * done" and "still blocked", so a single key-path mismatch made the board
 * recommend a finished quest AND withhold work whose prerequisite was in fact
 * satisfied - opposite failures from one cause, in the function whose own
 * docstring promises a completionist is never told to repeat content.
 *
 * Deliberately NOT tri-state. `questDone` layers the "was the account read at
 * all" question on top of this one; this answers only "is it in the set", which
 * is what a caller holding a bare id can ask.
 */
export function holdsQuest(picture: AccountPicture, id: string): boolean {
  if (picture.completedQuests.has(id)) return true;
  return heldTails(picture).has(tail(id));
}

/** Canonical game totals, supplied by a dataset module once one is wired in. */
export interface Canon {
  questCount?: number;
  nodeCount?: number;
  /**
   * Every node id the catalog knows.
   *
   * The account's `Missions[]` is a WIDER population than the star chart: a real
   * capture (docs/DATA-SOURCES.md:107-114) carried 484 completed tags, of which
   * only the SolNode and junction ones join the vendored graph - the rest are
   * ClanNode, CrewBattleNode, EventNode, SettlementNode, hub, Nightwave derelict
   * and raid-key tags. Counting them against the catalog's own size produced
   * "484/353 cleared, 137%" in the star chart headline, a Progression board row
   * clamped to "Star chart nodes 100%", per-planet plates that summed to a
   * completely different number, and - worst - the Steel Path gate resolving
   * `have >= total` as true on a chart the player had not finished.
   *
   * With this present the numerator is restricted to nodes that actually exist
   * in the same denominator. The `clearedNodes` SET stays unfiltered: the
   * frontier walk, routing and the chart paint all do their own `has()` lookups
   * and are correct as they are.
   */
  nodeIds?: ReadonlySet<string>;
}

const NOTHING: AccountPicture = {
  masteryRank: null,
  masteryXp: null,
  quests: { have: null, total: null },
  nodes: { have: null, total: null },
  completedQuests: new Set(),
  clearedNodes: new Set(),
};

/**
 * How many of these ids the catalog also knows.
 *
 * Without the catalog there is no honest count to give: the raw size would be a
 * numerator from a different population than any denominator we could pair it
 * with, which is the defect this exists to prevent. Null, not a guess.
 */
function countIn(cleared: ReadonlySet<string>, known: ReadonlySet<string> | undefined): number | null {
  if (!known) return null;
  let n = 0;
  for (const id of cleared) if (known.has(id)) n++;
  return n;
}

export function derive(
  inv: RawInventory | null,
  canon: Canon = {},
  /** Nodes seen cleared live in EE.log this session, ahead of the next dump. */
  liveClears: readonly string[] = [],
): AccountPicture {
  if (!inv) return liveClears.length ? { ...NOTHING, clearedNodes: new Set(liveClears) } : NOTHING;

  // Present-but-empty and absent are different facts. The SETS are built either
  // way so every graph walk keeps working; only the COUNTS distinguish them.
  const questsRead = Array.isArray(inv.QuestKeys);
  const completedQuests = new Set<string>();
  for (const q of inv.QuestKeys ?? []) {
    if (q?.Completed && q.ItemType) completedQuests.add(q.ItemType);
  }

  // A node counts as cleared once it has been completed at least once. Repeat
  // runs are explicitly NOT progress — that is the whole point of the panel.
  const nodesRead = Array.isArray(inv.Missions) || liveClears.length > 0;
  const clearedNodes = new Set<string>();
  for (const m of inv.Missions ?? []) {
    if (m?.Tag && (m.Completes ?? 0) > 0) clearedNodes.add(m.Tag);
  }
  // A node cleared moments ago counts immediately, even though the inventory
  // dump has not caught up yet.
  for (const n of liveClears) clearedNodes.add(n);

  return {
    masteryRank: typeof inv.PlayerLevel === 'number' ? inv.PlayerLevel : null,
    masteryXp: sumXp(inv),
    quests: { have: questsRead ? completedQuests.size : null, total: canon.questCount ?? null },
    nodes: { have: nodesRead ? countIn(clearedNodes, canon.nodeIds) : null, total: canon.nodeCount ?? null },
    completedQuests,
    clearedNodes,
  };
}

function sumXp(inv: RawInventory): number | null {
  if (!inv.XPInfo?.length) return null;
  let total = 0;
  for (const e of inv.XPInfo) total += e?.XP ?? 0;
  return total;
}

/** Percent complete, or null when either half of the fraction is unknown. */
export function pct(c: Counted): number | null {
  if (c.have == null || c.total == null || c.total <= 0) return null;
  return Math.min(100, (c.have / c.total) * 100);
}

// ---------------------------------------------------------------------------
// Recommender
// ---------------------------------------------------------------------------

export type ActionKind = 'quest' | 'junction' | 'node' | 'arsenal';

export interface Action {
  id: string;
  kind: ActionKind;
  title: string;
  /** Why this is the right next move, in the player's terms. */
  because: string;
  /** Where to go, when the action is tied to a place. */
  where?: string;
  /** Prerequisite ids that must already be done. */
  requires?: string[];
  /** How many other locked things this unlocks. The anti-repetition lever. */
  unlocks?: number;
  /**
   * Domain adjustment, computed where the knowledge lives rather than here.
   * Carries things leverage cannot express: narrative ordering, whether an
   * action sits on the main progression spine, and whether its prerequisites are
   * verifiable at all.
   */
  bias?: number;
}

export interface ScoredAction extends Action {
  score: number;
}

/**
 * Rank candidate actions for a completionist who does not want to repeat content.
 *
 * The ordering principle: an action is worth more when it opens up *other* work
 * than when it merely adds one tick to a counter. Grinding a node the player has
 * already cleared scores zero by construction, because `done` filters it out
 * before scoring rather than merely penalising it.
 */
export function recommend(actions: Action[], picture: AccountPicture, limit = 5): ScoredAction[] {
  // Both tests go through `holdsQuest`, not `completedQuests.has`. The raw
  // membership check misses a quest stored under a drifted key path, and each
  // of these two turns that miss into a different visible failure: `done`
  // re-offers finished work, `blocked` withholds work already unlocked.
  const done = (a: Action): boolean =>
    (a.kind === 'quest' && holdsQuest(picture, a.id)) ||
    ((a.kind === 'node' || a.kind === 'junction') && picture.clearedNodes.has(a.id));

  const blocked = (a: Action): boolean =>
    (a.requires ?? []).some((r) => !holdsQuest(picture, r) && !picture.clearedNodes.has(r));

  // Base rank by kind, plus a per-kind value for what the action opens up.
  //
  // The multipliers differ because the `unlocks` figures are not comparable: a
  // quest gating 6 quests is a far bigger deal than a node that sits 6 steps from
  // the end of a chain. Quests also never repeat and are one-and-done, which is
  // exactly what a completionist who dislikes grinding wants first.
  const weight: Record<ActionKind, { base: number; per: number }> = {
    quest: { base: 1000, per: 100 },
    junction: { base: 700, per: 25 },
    node: { base: 200, per: 12 },
    arsenal: { base: 100, per: 5 },
  };

  const scored: ScoredAction[] = [];
  for (const a of actions) {
    if (done(a) || blocked(a)) continue;
    const w = weight[a.kind];
    scored.push({ ...a, score: w.base + (a.unlocks ?? 0) * w.per + (a.bias ?? 0) });
  }
  return scored.sort((x, y) => y.score - x.score || x.title.localeCompare(y.title)).slice(0, limit);
}
