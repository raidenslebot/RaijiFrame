/**
 * WHAT TO DO NEXT, AND WHY.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The progression panel had a goal picker that could not work. It multiplied a
 * per-kind constant by a per-domain constant - `weight * goal.weights[domain]` -
 * and every mainline quest carried the same weight (1000) in the same domain
 * ('narrative'), so a goal multiplier scaled them all uniformly and never
 * reordered anything. Measured: all seven profiles produced byte-identical
 * output, and because the weights tied inside a band the board fell through to
 * `localeCompare`. The player was reading an alphabetical list.
 *
 * The constants were the real problem. 1000, 420, 700, 220 have no referent -
 * nobody measured them, and no argument makes one of them correct. This module
 * replaces all of them with quantities that are counted from the datasets.
 *
 * THE IDEA
 * ────────
 * Warframe's content is one dependency graph. The most effective thing to do
 * next is the thing that stands between you and the most of everything else -
 * so rank by DOMINANCE: how much of the remaining game becomes reachable only
 * by going through this vertex, divided by what reaching this vertex costs.
 *
 * AND vs OR IS THE WHOLE CORRECTNESS ARGUMENT
 * ───────────────────────────────────────────
 * Two edge relations, never mixed:
 *
 *   AND[v]  every one must be finished first - quest prerequisites, gates named
 *           in a node's `requirements`, junction tasks that name a quest.
 *   OR[v]   star-chart predecessors, ANY ONE of which opens v. `frontier()`
 *           admits a node when `preds.some(cleared)`, so these are alternatives.
 *
 * Conflating them over-claims. 25 of 355 nodes have more than one predecessor,
 * and counting transitive successors treats reaching either of them as
 * mandatory. Dominance does not: a vertex only dominates what genuinely cannot
 * be reached around it.
 *
 * HONESTY RULES BAKED IN HERE
 * ───────────────────────────
 *   - A node's `mastery` of 0 means UNRECORDED, not "pays nothing". 173 of 355
 *     rows read 0 and fifteen whole regions read 0 throughout. Such a row
 *     contributes null, never 0, and is reported separately rather than ranked
 *     last - ranking it last would assert it is worth less than a node worth 3.
 *   - Rows that no measurement separates are reported as TIED, sharing one rank.
 *     Alphabetising them is a fake ordering, which is the bug this replaces.
 *   - A vertex we cannot evaluate goes to a NOT-RANKABLE band carrying the
 *     reason, rather than being given a score we cannot defend.
 */

import type { AccountPicture } from './progression';
// Explicit `.ts`: this module is imported by scripts/check-leverage.ts, which
// Node runs through type-stripping, and that resolver does not add extensions.
// Type-only imports elsewhere in this folder are erased before Node sees them,
// which is why they can stay extensionless.
import { gatesFromText, routeTo, questKey, type Catalog } from './catalog.ts';
import type { NodeEntry, QuestEntry } from './vendor/types';

/* ------------------------------------------------------------------ vertices */

import { NOTHING_OBSERVED, type Link, type Observed } from './plat-throughput.ts';

/** A chain link that also knows which vertex it is - two junctions share a title. */
export type PathLink = Link & { id: string };

export type VertexKind = 'node' | 'quest';

export interface Vertex {
  id: string;
  kind: VertexKind;
  title: string;
  planet: string | null;
  /** Recorded mastery payout. Null when the dataset does not record one. */
  mastery: number | null;
  /** Mainline story quest. */
  mainline: boolean;
  /** Things this quest lists as unlocked. Only quests carry these. */
  unlocks: number;
  /** A hub, relay, conclave or free-flight - a location, not an objective. */
  isPlace: boolean;
  /**
   * The chart's readable mission type ("Capture", "Survival") - the SAME
   * vocabulary `plat-throughput` buckets the player's own run timings under,
   * because `toRecord` writes `missionTypeName` from this very field. That is
   * what makes a node's cost measurable from the log without a name join.
   * Null for a quest, which is not one mission and has no type.
   */
  missionType: string | null;
  /** A `requirements` string we could not resolve to any known vertex. */
  hardGate: string | null;
  /** Mastery rank named in a gate, when one is. */
  mrGate: number | null;
  /** Intrinsics rank named in a gate, when one is. */
  intrinsicGate: number | null;
  /** Advisory prose from a quest note that resolved to nothing. */
  advisory: string | null;
}

export interface Graph {
  vertices: Vertex[];
  index: Map<string, number>;
  /** Must ALL be done first. */
  and: number[][];
  /** ANY ONE opens it. Empty means a graph entry point. */
  or: number[][];
  /** Where the game starts, derived from the first mainline quest. */
  startPlanet: string | null;
  words: number;
}

const MR_GATE = /Mastery Rank (\d+)/i;

/**
 * The part of a quest note that is a GATE the account could contradict and
 * nothing here checks - a rank, a possession, a segment, a bounty count. The
 * Mastery Rank clause is stripped because `mrGate` does check it; what is left
 * is kept only if it reads as a requirement. Stage directions ("First Login",
 * "Talk with Darvo in any Relay") are how the quest starts, not what bars it,
 * and calling Awakening unmeasured for "First Login" would be absurd.
 */
const GATE_WORDS = /\b(own|owned|obtain|rank|standing|installed|completed|unlocked|retrieved)\b/i;
function uncheckedGate(note: string): string | null {
  const rest = note
    .replace(MR_GATE, '')
    .split(/;|\band\b/i)
    .map((part) => part.trim().replace(/^[\s,.]+|[\s,.]+$/g, ''))
    .filter((part) => part.length > 0 && GATE_WORDS.test(part));
  return rest.length > 0 ? rest.join('; ') : null;
}
const INTRINSIC_GATE = /Intrinsics? Rank (\d+)/i;
const PLACE_TYPES = new Set(['Hub', 'Relay', 'Conclave', 'Free Flight', 'Free Roam']);

function hasLevelBand(n: NodeEntry): boolean {
  return n.minLevel != null && n.maxLevel != null && n.maxLevel > 0 && n.maxLevel > n.minLevel;
}

/**
 * Stage 0. Account-invariant, so it is built once per catalog and reused across
 * every goal and every account update.
 */
export function buildGraph(catalog: Catalog): Graph {
  const vertices: Vertex[] = [];
  const index = new Map<string, number>();

  const add = (v: Vertex): void => {
    index.set(v.id, vertices.length);
    vertices.push(v);
  };

  for (const n of catalog.nodeById.values()) {
    const req = n.requirements ?? null;
    add({
      id: n.id,
      kind: 'node',
      title: n.name,
      planet: n.planet,
      // 0 is unrecorded. See the module note.
      mastery: typeof n.mastery === 'number' && n.mastery > 0 ? n.mastery : null,
      mainline: false,
      unlocks: 0,
      isPlace: !hasLevelBand(n) && PLACE_TYPES.has(n.type ?? ''),
      missionType: n.type ?? null,
      hardGate: null,
      mrGate: req ? (MR_GATE.exec(req)?.[1] != null ? Number(MR_GATE.exec(req)?.[1]) : null) : null,
      intrinsicGate: req
        ? INTRINSIC_GATE.exec(req)?.[1] != null
          ? Number(INTRINSIC_GATE.exec(req)?.[1])
          : null
        : null,
      advisory: null,
    });
  }

  for (const q of catalog.questByKey.values()) {
    const note = q.requiresNote ?? null;
    add({
      id: q.id ?? questKey(q),
      kind: 'quest',
      title: q.name,
      planet: q.planet ?? null,
      mastery: null,
      mainline: q.mainline === true,
      unlocks: (q.unlocks ?? []).length,
      isPlace: false,
      missionType: null,
      hardGate: null,
      mrGate: note && MR_GATE.exec(note)?.[1] != null ? Number(MR_GATE.exec(note)?.[1]) : null,
      intrinsicGate: null,
      advisory: null,
    });
  }

  const and: number[][] = vertices.map(() => []);
  const or: number[][] = vertices.map(() => []);

  const at = (id: string | undefined): number | undefined => (id == null ? undefined : index.get(id));

  // ---- AND edges ---------------------------------------------------------
  for (const q of catalog.questByKey.values()) {
    const vi = at(q.id ?? questKey(q));
    if (vi === undefined) continue;
    for (const ref of q.requires) {
      const key = catalog.questKeyByName.get(ref.toLowerCase());
      const target = key != null ? catalog.questByKey.get(key) : undefined;
      const ti = at(target?.id ?? (target ? questKey(target) : ref));
      if (ti !== undefined && ti !== vi) and[vi]!.push(ti);
    }
    for (const gate of gatesFromText(q.requiresNote, catalog)) {
      const ti = at(gate);
      if (ti !== undefined && ti !== vi) and[vi]!.push(ti);
    }
    /*
     * A quest note that resolves to NOTHING stays advisory and does not gate.
     * These are prose - "First Login", "Talk with Darvo in any Relay" - not
     * access rules. Treating them as gates would hide Awakening, the first
     * quest in the game, behind "First Login". Node `requirements` are the
     * opposite and ARE hard gates; see below.
     */
    if (q.requiresNote != null && gatesFromText(q.requiresNote, catalog).length === 0) {
      const v = vertices[vi];
      if (v) v.advisory = uncheckedGate(q.requiresNote);
    }
  }

  for (const n of catalog.nodeById.values()) {
    const vi = at(n.id);
    if (vi === undefined) continue;
    const gates = gatesFromText(n.requirements, catalog);
    for (const gate of gates) {
      const ti = at(gate);
      if (ti !== undefined && ti !== vi) and[vi]!.push(ti);
    }
    // A requirement we could not resolve is a HARD gate: every one of the
    // unresolved strings begins "Must ". We cannot evaluate it, so the row is
    // reported as not rankable rather than guessed either way.
    if (n.requirements != null && n.requirements.length > 0 && gates.length === 0) {
      const v = vertices[vi];
      if (v) v.hardGate = n.requirements;
    }
  }

  for (const j of catalog.junctions) {
    const vi = at(j.id);
    if (vi === undefined) continue;
    for (const t of j.tasks ?? []) {
      if (t.kind !== 'quest' || t.ref == null) continue;
      const key = catalog.questKeyByName.get(t.ref.toLowerCase());
      const target = key != null ? catalog.questByKey.get(key) : undefined;
      const ti = at(target?.id ?? (target ? questKey(target) : t.ref));
      if (ti !== undefined && ti !== vi) and[vi]!.push(ti);
    }
  }

  // ---- OR edges ----------------------------------------------------------
  for (const [id, preds] of catalog.predecessors) {
    const vi = at(id);
    if (vi === undefined) continue;
    for (const p of preds) {
      const pi = at(p);
      if (pi !== undefined && pi !== vi) or[vi]!.push(pi);
    }
  }

  // Where the game begins: the lowest-order mainline quest with no prerequisites.
  let start: QuestEntry | null = null;
  for (const q of catalog.questByKey.values()) {
    if (q.mainline !== true || q.requires.length > 0) continue;
    if (start === null || q.order < start.order) start = q;
  }

  return { vertices, index, and, or, startPlanet: start?.planet ?? null, words: Math.ceil(vertices.length / 32) };
}

/* -------------------------------------------------------------------- goals */

export type GoalId = 'everything' | 'starchart' | 'mastery' | 'story' | 'collection' | 'endgame' | 'efficient';

/**
 * What a vertex is WORTH under a goal, in that goal's own unit.
 *
 * Null means "this goal cannot value this vertex", which is different from zero.
 * Under Mastery a node with no recorded payout is null, so it neither inflates
 * nor deflates any sum, and its row says the payout is unrecorded.
 */
function valueOf(v: Vertex, goal: GoalId): number | null {
  switch (goal) {
    case 'starchart':
    case 'endgame':
      return v.kind === 'node' ? 1 : 0;
    case 'mastery':
      return v.kind === 'node' ? v.mastery : null;
    case 'story':
      return v.kind === 'quest' && v.mainline ? 1 : 0;
    case 'collection':
      return v.kind === 'quest' ? v.unlocks : 0;
    default:
      return 1;
  }
}

/** The unit each goal counts in, for the copy that reports a total. */
export const GOAL_UNIT: Readonly<Record<GoalId, string>> = {
  everything: 'objectives',
  starchart: 'nodes',
  mastery: 'mastery points',
  story: 'mainline quests',
  collection: 'listed unlocks',
  endgame: 'nodes',
  // Not a graph goal at all - see ProgressionPanel's expiry lane.
  efficient: 'expiring pursuits',
};

/* ------------------------------------------------------------------- solving */

export type Band = 1 | 2 | 3 | 4;

export interface Solved {
  band: Map<string, Band>;
  /** Why a band-3 row cannot be ranked, in the player's words. */
  reason: Map<string, string>;
  domCount: Map<string, number>;
  gate: Map<string, number | null>;
  /**
   * What reaching this costs, in `costUnit`.
   *
   * MINUTES, FROM THE PLAYER'S OWN LOG, WHEN THE LOG CAN SPEAK; a count of
   * objectives when it cannot. It was always the count - `costOf(...).size + 1`
   * - which priced a four-minute Capture and a whole quest identically, and
   * `score` divided value by it. A route through two quests came out cheaper
   * than one through three quick nodes. See `pathCost`.
   */
  cost: Map<string, number | null>;
  costUnit: 'minutes' | 'objectives';
  /**
   * True when `cost` is an estimate rather than a reading: some member of the
   * path has no minutes of its own. A mission type this account has never run
   * is priced at the SLOWEST type it has - pessimistic, from its own log - and
   * a quest is priced at nothing and flags the path. The copy names the
   * assumption; the plan compares the figure directly, because the pessimism
   * is already in it. (Named `AtLeast` from a first draft that used the usual
   * pace and called the result a floor. It is not a floor. See `minutesOf`.)
   */
  costAtLeast: Map<string, boolean>;
  /** Undone objectives on the path, excluding the row itself. The old `cost`. */
  prereqs: Map<string, number>;
  /**
   * THE WORKING UNDER "HOW LONG", for every vertex.
   *
   * One link per path member, in walking order, ending on the row itself:
   * its minutes (or null), where the figure came from, and the sentence it
   * claims. `cost` is the sum of these, so what a reader adds up is what the
   * heading printed. A first draft kept this to the plan's rows; a review
   * pointed out that a band-1 row provably has no prerequisites, so the plan's
   * "sum" was always one link and the check pinning it could not fail. Every
   * vertex carries its links now, and the gate sums a row that has some.
   */
  costLinks: Map<string, PathLink[]>;
  /**
   * WHAT STANDS BEHIND a plan row: the vertices it dominates, grouped by
   * planet, largest group first. `gate` and `domCount` are sums over exactly
   * this set - the count the heading prints, finally with names in it.
   */
  behind: Map<string, ReadonlyArray<{ planet: string; ids: string[] }>>;
  score: Map<string, number | null>;
  /** The unit `score` is in, for the copy: "nodes an hour" or "nodes per objective". */
  scoreUnit: string;
  /** Ordered ids: what to do, in the order to do it. */
  plan: string[];
  /** Shared rank group for rows nothing measurable separates. */
  tied: Map<string, number>;
  /** Remaining goal-value across the whole graph. */
  pool: number;
  /** The unit `gate`, `score` and `pool` are counted in, for the copy. */
  unit: string;
  /** How many unfinished vertices this goal can value at all. */
  payers: number;
  /** How many it values at zero - work that does not serve this goal. */
  indifferent: number;
  /**
   * How many it cannot value AT ALL - a null, not a zero.
   *
   * Under Mastery this is every quest plus the 171 nodes whose payout the
   * dataset never recorded. Counting them as indifferent would assert they are
   * worth nothing; they are separated so the copy can say which is which.
   */
  unvalued: number;
  /** Unfinished vertices, the honest denominator for all three counts. */
  remaining: number;
  /**
   * Each vertex's OWN worth under the goal - not the dominated sum. What the
   * wheel needs to size a domain's arc by remaining goal value rather than by
   * how many rows the domain happens to contain.
   */
  value: Map<string, number | null>;
}

/**
 * Dominator sets by bitset fixpoint.
 *
 * TWO TRAPS, BOTH ONE CHARACTER, BOTH HANG THE UI THREAD SILENTLY.
 *
 * 1. `>>> 0` on every write. `1 << 31` is NEGATIVE in JavaScript, so a signed
 *    int32 read back from an `&` never compares equal to the stored uint32 and
 *    the fixpoint never settles. Unmasked this runs to the pass cap; masked it
 *    converges in well under twenty passes.
 * 2. The pass cap itself, as insurance against a future dataset shape.
 */
function dominators(g: Graph, done: boolean[]): Uint32Array[] {
  const n = g.vertices.length;
  const W = g.words;
  const dom: Uint32Array[] = [];
  for (let i = 0; i < n; i++) {
    const a = new Uint32Array(W);
    if (!done[i]) a.fill(0xffffffff);
    dom.push(a);
  }

  const scratch = new Uint32Array(W);
  let pass = 0;
  let changed = true;
  while (changed && pass < 300) {
    changed = false;
    pass++;
    for (let v = 0; v < n; v++) {
      if (done[v]) continue;
      scratch.fill(0);

      // AND: union of every unfinished prerequisite and its own dominators.
      for (const a of g.and[v] ?? []) {
        if (done[a]) continue;
        const da = dom[a]!;
        for (let w = 0; w < W; w++) scratch[w] = (scratch[w]! | da[w]! | (a >> 5 === w ? 1 << (a & 31) : 0)) >>> 0;
      }

      // OR: intersection, and only when EVERY alternative is still unfinished.
      const ors = g.or[v] ?? [];
      const openOrs = ors.filter((p) => !done[p]);
      if (ors.length > 0 && openOrs.length === ors.length) {
        const inter = new Uint32Array(W).fill(0xffffffff);
        for (const p of openOrs) {
          const dp = dom[p]!;
          for (let w = 0; w < W; w++) inter[w] = (inter[w]! & (dp[w]! | (p >> 5 === w ? 1 << (p & 31) : 0))) >>> 0;
        }
        for (let w = 0; w < W; w++) scratch[w] = (scratch[w]! | inter[w]!) >>> 0;
      }

      const dv = dom[v]!;
      for (let w = 0; w < W; w++) {
        // Monotone shrink: a vertex only ever loses dominators, so intersecting
        // with the previous value is what makes cycles converge.
        const next = (dv[w]! & scratch[w]!) >>> 0;
        if (next !== dv[w]) {
          dv[w] = next;
          changed = true;
        }
      }
    }
  }
  return dom;
}

/** Objectives that must be finished to reach `v`, including `v` itself. */
function costOf(g: Graph, catalog: Catalog, picture: AccountPicture, done: boolean[], memo: Map<number, Set<number>>, visiting: Set<number>, v: number): Set<number> {
  const hit = memo.get(v);
  if (hit) return hit;
  if (visiting.has(v)) return new Set();
  visiting.add(v);

  const out = new Set<number>();
  for (const a of g.and[v] ?? []) {
    if (done[a]) continue;
    for (const x of costOf(g, catalog, picture, done, memo, visiting, a)) out.add(x);
    out.add(a);
  }

  const vert = g.vertices[v];
  if (vert?.kind === 'node') {
    /*
     * `routeTo` is GATE-BLIND: it walks the star-chart graph and ignores a
     * node's own `requirements`. So a route can pass through a gated node and
     * report a cost that is too low. Folding each route member's own closure in
     * repairs that - measured, 59 of 355 nodes have a shortest route through a
     * node carrying its own gate.
     */
    for (const m of routeTo(catalog, picture, vert.id)) {
      const mi = g.index.get(m);
      if (mi === undefined || mi === v || done[mi]) continue;
      for (const x of costOf(g, catalog, picture, done, memo, visiting, mi)) out.add(x);
      out.add(mi);
    }
  }

  visiting.delete(v);
  memo.set(v, out);
  return out;
}

function bandOf(g: Graph, v: number, done: boolean[], measured: boolean, mr: number | null): { band: Band; reason?: string } {
  const vert = g.vertices[v]!;
  if (done[v]) return { band: 4 };
  if (vert.isPlace) return { band: 3, reason: 'a hub, not a mission' };
  if (vert.hardGate !== null) return { band: 3, reason: vert.hardGate };
  if (vert.mrGate !== null) {
    // The account's rank is read where it is reported; only its absence is an
    // unknown. Below the gate the row is blocked with the gap stated.
    if (mr === null) return { band: 3, reason: `needs Mastery Rank ${String(vert.mrGate)}; your rank is not known` };
    if (mr < vert.mrGate) return { band: 3, reason: `needs Mastery Rank ${String(vert.mrGate)}; you are rank ${String(mr)}` };
  }
  if (vert.intrinsicGate !== null && !measured) {
    return { band: 3, reason: `needs Intrinsics Rank ${String(vert.intrinsicGate)}; your ranks are not known` };
  }

  const andOpen = (g.and[v] ?? []).some((a) => !done[a]);
  const ors = g.or[v] ?? [];
  if (andOpen) return { band: 2 };
  if (ors.length === 0) {
    /*
     * A rootless vertex is only genuinely available at the start of the game.
     * Without this, a fresh account is told that Kuva Lich Confrontation, the
     * Grendel locators and three Conclave nodes are "available now" - false, in
     * the band a player trusts most.
     */
    if (vert.kind === 'quest') return { band: 1 };
    return vert.planet !== null && vert.planet === g.startPlanet
      ? { band: 1 }
      : { band: 3, reason: 'no recorded entry condition' };
  }
  return ors.some((p) => done[p]) ? { band: 1 } : { band: 2 };
}

/**
 * How long one vertex takes, from what this account has actually done.
 *
 * THREE ANSWERS, AND THE THIRD IS NOT A NUMBER.
 * ───────────────────────────────────────────
 *   FIRM     a node whose mission type this player has timed: their own median
 *            for it, from `Observed.byType`.
 *   SLOWEST  a node whose type they have never run, but they have a log: the
 *            median of the SLOWEST type they have timed stands in, flagged.
 *   NULL     a quest, or no log at all. A quest is many missions of unknown
 *            count and length, and any per-mission figure lent to it would be
 *            a guess wearing the log's clothes. Null contributes nothing and
 *            flags the path.
 *
 * WHY THE SLOWEST, AND NOT THE USUAL PACE - A SABOTAGE DECIDED IT.
 * ────────────────────────────────────────────────────────────────
 * The first draft used the overall median and then, because an optimistic
 * stand-in can out-score a real measurement, made the plan prefer any firm
 * row over any flagged one. Removing that preference passed every check, so
 * a fixture was built where it would bite: only Rescue timed, at a minute, so
 * Spy became a flagged row scoring 19,140 an hour beside Rescue's firm 60.
 * The rule would have taken the 60. That is not caution; a rate 300 times
 * larger with a one-sided uncertainty is still the better bet unless Spy
 * takes over five hours.
 *
 * So the stand-in is pessimistic instead, and the preference is gone. An
 * untimed type is priced at the slowest thing this player has measured - a
 * figure from their own log, not a table. IT IS A STAND-IN, NOT A BOUND: the
 * log says nothing about whether an untimed type is faster or slower than the
 * slowest timed one, and a review caught the first draft of this comment and
 * the link's note both claiming it "errs long, not short". The slowest known
 * figure is chosen for the cost of being wrong, not for a bound it cannot
 * have: wrong that way sends the player somewhere slower than it said, which
 * they discover in one run; wrong the other way skips a node they never see.
 */
function minutesOf(
  v: Vertex,
  obs: Observed,
): { minutes: number; firm: boolean; basis: string; runs: number } | null {
  if (v.kind !== 'node' || v.missionType === null) return null;
  const own = obs.byType.get(v.missionType);
  if (own !== undefined) return { minutes: own.minutes, firm: true, basis: v.missionType, runs: own.runs };
  let slowest = 0;
  let basis = '';
  let runs = 0;
  for (const [type, t] of obs.byType) {
    if (t.minutes > slowest) {
      slowest = t.minutes;
      basis = type;
      runs = t.runs;
    }
  }
  return slowest > 0 ? { minutes: slowest, firm: false, basis, runs } : null;
}

/**
 * The path as links - one per member, in the order it is walked, ending on the
 * row itself - so the panel can show the working the way the platinum chain
 * shows its own: a value, where it came from, and the sentence it claims.
 *
 * WHY THIS EXISTS: `pathCost` summed these and returned one number, so "about
 * 21 minutes" had nothing under it. The fifth quality measurement put NOW's
 * reachable nesting at one level; this is the second and third. Every link
 * states something a player could contradict with their own log.
 */
function memberLinks(g: Graph, obs: Observed, members: ReadonlySet<number>, self: number, unit: 'minutes' | 'objectives'): PathLink[] {
  const out: PathLink[] = [];
  for (const m of [...members, self]) {
    const v = g.vertices[m]!;
    const label = v.title;
    const id = v.id;
    if (unit === 'objectives') {
      out.push({
        id,
        label,
        value: 1,
        from: 'published',
        note: 'Counted as one objective. Nothing in your log has timed it, so a count is the honest unit.',
        unit: 'objectives',
      });
      continue;
    }
    const t = minutesOf(v, obs);
    if (t === null) {
      out.push({
        id,
        label,
        value: null,
        from: 'unknown',
        note:
          v.kind === 'quest'
            ? 'A quest is not one mission, so your log cannot time it. It adds nothing to the figure and the figure says so.'
            : 'No run of this type in your log, and nothing timed that could stand in for it.',
        unit: 'minutes',
      });
      continue;
    }
    out.push(
      t.firm
        ? {
            id,
            label,
            value: t.minutes,
            from: 'measured',
            note: `Your median for ${t.basis} across ${String(t.runs)} of your ${t.runs === 1 ? 'run' : 'runs'}.`,
            unit: 'minutes',
          }
        : {
            id,
            label,
            value: t.minutes,
            from: 'assumed',
            note: `You have not run ${v.missionType ?? 'this type'} yet. Priced at the pace of your slowest timed mission - ${t.basis}, ${String(t.minutes)} ${t.minutes === 1 ? 'minute' : 'minutes'} across ${String(t.runs)} ${t.runs === 1 ? 'run' : 'runs'}. Nothing in your log says ${v.missionType ?? 'it'} is faster or slower than that.`,
            unit: 'minutes',
          },
    );
  }
  return out;
}

/**
 * The cost of a path, and what kind of number it is.
 *
 * WHY MINUTES, AND WHY NOT ALWAYS.
 * ───────────────────────────────
 * `score` is value unlocked per unit of cost, and value already has a real unit
 * per goal - nodes, mastery points, mainline quests. Dividing it by a COUNT of
 * things-to-do gave a figure nothing could contradict, and one that called a
 * quest and a Capture the same size. Dividing by minutes from the player's own
 * log gives "nodes an hour", which the platinum panel already speaks in and a
 * player can check against their evening.
 *
 * But minutes can only be claimed where they were measured. With no log at all
 * the count is the honest unit, and this returns exactly what the old code did
 * - `check-leverage.ts` holds that line, so a fresh account's plan cannot
 * change by accident. A path whose members have no minutes between them (a
 * lone quest, with a log that never times quests) is NULL in minutes mode: it
 * cannot be rated in this unit, and it says so rather than borrowing the
 * count.
 */
function pathCost(
  g: Graph,
  obs: Observed,
  members: ReadonlySet<number>,
  self: number,
  unit: 'minutes' | 'objectives',
): { cost: number | null; atLeast: boolean; links: PathLink[] } {
  const links = memberLinks(g, obs, members, self, unit);
  if (unit === 'objectives') return { cost: members.size + 1, atLeast: false, links };
  /*
   * ONE SOURCE OF TRUTH: the figure is the sum of the links the panel shows,
   * so what a reader adds up under "how?" is what the heading printed. A flag
   * on any link (a null, or a stand-in) flags the total.
   */
  let minutes = 0;
  let atLeast = false;
  let any = false;
  for (const l of links) {
    if (l.value === null) {
      atLeast = true;
      continue;
    }
    any = true;
    minutes += l.value;
    if (l.from === 'assumed') atLeast = true;
  }
  return any ? { cost: minutes, atLeast, links } : { cost: null, atLeast: true, links };
}

export function solve(
  g: Graph,
  catalog: Catalog,
  picture: AccountPicture,
  goal: GoalId,
  /**
   * The player's own run timings. Optional and defaulting to nothing observed,
   * so every caller that predates it gets the count-based cost it always had.
   */
  observed: Observed = NOTHING_OBSERVED,
): Solved {
  const n = g.vertices.length;
  const measured = picture.clearedNodes.size > 0 || picture.completedQuests.size > 0;

  /*
   * THE UNIT IS DECIDED ONCE, PER SOLVE, AND ONLY IF SOMETHING PAYING CAN BE
   * TIMED. Minutes for a goal whose payers are all quests (story, collection)
   * would be minutes for nobody, so those stay in objectives - which is exactly
   * their old behaviour. A mixed unit across rows would make `score` mean two
   * things in one list, which is worse than either alone.
   */
  const costUnit: 'minutes' | 'objectives' =
    observed.overall !== null &&
    g.vertices.some((v) => {
      const val = valueOf(v, goal);
      return val != null && val > 0 && !(picture.clearedNodes.has(v.id) || picture.completedQuests.has(v.id)) && minutesOf(v, observed)?.firm === true;
    })
      ? 'minutes'
      : 'objectives';

  const done: boolean[] = g.vertices.map(
    (v) => picture.clearedNodes.has(v.id) || picture.completedQuests.has(v.id),
  );

  const value = g.vertices.map((v) => valueOf(v, goal));
  const solveOnce = (): {
    gate: (number | null)[];
    cost: (number | null)[];
    atLeast: boolean[];
    prereqs: number[];
    score: (number | null)[];
    domCount: number[];
    links: PathLink[][];
    dom: Uint32Array[];
  } => {
    const dom = dominators(g, done);

    // Invert: gate[x] = value(x) + sum of value(y) for every y that x dominates.
    const gate: (number | null)[] = new Array<number | null>(n).fill(0);
    for (let i = 0; i < n; i++) gate[i] = done[i] ? 0 : (value[i] ?? null);
    const domCount = new Array<number>(n).fill(0);
    for (let y = 0; y < n; y++) {
      if (done[y]) continue;
      const vy = value[y];
      const dy = dom[y]!;
      for (let w = 0; w < g.words; w++) {
        let bits = dy[w]!;
        while (bits !== 0) {
          const b = 31 - Math.clz32(bits & -bits);
          const x = w * 32 + b;
          bits = (bits & ~(1 << b)) >>> 0;
          if (x >= n) continue;
          domCount[x] = (domCount[x] ?? 0) + 1;
          if (vy != null) gate[x] = (gate[x] ?? 0) + vy;
        }
      }
    }

    const memo = new Map<number, Set<number>>();
    const cost: (number | null)[] = [];
    const atLeast: boolean[] = [];
    const prereqs: number[] = [];
    const score: (number | null)[] = [];
    const links: PathLink[][] = [];
    for (let i = 0; i < n; i++) {
      const members = costOf(g, catalog, picture, done, memo, new Set(), i);
      prereqs.push(members.size);
      const pc = pathCost(g, observed, members, i, costUnit);
      cost.push(pc.cost);
      atLeast.push(pc.atLeast);
      links.push(pc.links);
      const gi = gate[i];
      /*
       * Per HOUR in minutes mode, so the figure reads as a rate a person can
       * hold - "3 nodes an hour" - rather than a fraction of a node a minute.
       */
      score.push(gi == null || pc.cost == null || pc.cost <= 0 ? null : costUnit === 'minutes' ? (gi / pc.cost) * 60 : gi / pc.cost);
    }
    return { gate, cost, atLeast, prereqs, score, domCount, links, dom };
  };

  let solved = solveOnce();

  /*
   * The plan, greedily. Each step is re-solved with the previous ones marked
   * done, which is what makes step k correct GIVEN steps 1..k-1 rather than
   * five independent copies of the same answer.
   */
  const plan: string[] = [];
  const restore: number[] = [];
  for (let step = 0; step < 5; step++) {
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < n; i++) {
      if (done[i]) continue;
      if (bandOf(g, i, done, measured, picture.masteryRank).band !== 1) continue;
      const s = solved.score[i];
      const gt = solved.gate[i];
      if (s == null || gt == null || gt <= 0) continue;
      /*
       * SCORES COMPARE DIRECTLY, FLAGGED OR NOT. A tier that put every firm
       * row ahead of every flagged one lived here briefly; see `minutesOf` for
       * the fixture that showed it choosing a firm 60 over a flagged 19,140.
       * The flagged score is a pessimistic estimate from the player's own
       * slowest pace, so it is already the cautious number, and ranking it
       * below a smaller firm one would be caution counted twice.
       */
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    /*
     * AN UNRATED ROW IS NOT A SKIPPED ROW.
     * ──────────────────────────────────
     * In minutes mode a quest has no cost and therefore no score, and the loop
     * above skips it. An adversarial review measured the consequence: an
     * account with Earth cleared, no quests done and a mission log had SIX
     * open quests and an EMPTY plan - the landing tab's one instruction gone,
     * because the player had a log. In objectives mode the same account was
     * told "Awakening" with five steps behind it.
     *
     * So when nothing rated remains, the unrated rows enter the plan in order
     * of what they open. The panel prints no minutes for them - `cost` is null
     * and stays null - so the plan says "do this, it opens 358 things" without
     * pretending to know how long it takes. Rated rows still go first: we know
     * what they pay, and we do not know what a quest costs, and that is the
     * honest order between a rate and a non-rate.
     */
    if (best < 0) {
      let bestGate = 0;
      for (let i = 0; i < n; i++) {
        if (done[i]) continue;
        if (bandOf(g, i, done, measured, picture.masteryRank).band !== 1) continue;
        if (solved.score[i] != null) continue;
        const gt = solved.gate[i];
        if (gt == null || gt <= bestGate) continue;
        bestGate = gt;
        best = i;
      }
    }
    if (best < 0) break;
    plan.push(g.vertices[best]!.id);
    done[best] = true;
    restore.push(best);
    if (step < 4) solved = solveOnce();
  }
  for (const i of restore) done[i] = false;
  solved = solveOnce();

  // ---- assemble -----------------------------------------------------------
  const band = new Map<string, Band>();
  const reason = new Map<string, string>();
  const gate = new Map<string, number | null>();
  const cost = new Map<string, number | null>();
  const costAtLeast = new Map<string, boolean>();
  const prereqs = new Map<string, number>();
  const score = new Map<string, number | null>();
  const domCount = new Map<string, number>();

  for (let i = 0; i < n; i++) {
    const v = g.vertices[i]!;
    const b = bandOf(g, i, done, measured, picture.masteryRank);
    band.set(v.id, b.band);
    if (b.reason != null) reason.set(v.id, b.reason);
    gate.set(v.id, solved.gate[i] ?? null);
    cost.set(v.id, solved.cost[i] ?? null);
    costAtLeast.set(v.id, solved.atLeast[i] ?? false);
    prereqs.set(v.id, solved.prereqs[i] ?? 0);
    score.set(v.id, b.band === 3 ? null : (solved.score[i] ?? null));
    domCount.set(v.id, solved.domCount[i] ?? 0);
    /*
     * A row this unit cannot rate says why, in the same place a gate would.
     * Under minutes, that is a path with nothing timed on it - a quest, whose
     * length the log never sees.
     */
    if (costUnit === 'minutes' && b.band !== 3 && !done[i] && solved.cost[i] == null) {
      reason.set(v.id, v.kind === 'quest' ? 'a quest is not one mission, so your log cannot time it' : 'nothing on the way to it has been timed yet');
    }
  }

  /*
   * Ties are REPORTED, not broken alphabetically.
   *
   * Roughly twenty rows mid-game are identical on every axis we can measure.
   * Sorting them by name invents an ordering and is exactly the failure this
   * module replaces, so they share a rank and say so.
   */
  const tied = new Map<string, number>();
  const buckets = new Map<string, string[]>();
  for (let i = 0; i < n; i++) {
    const v = g.vertices[i]!;
    if (band.get(v.id) !== 1) continue;
    const key = `${String(solved.score[i] ?? 'x')}|${String(solved.domCount[i])}|${String(solved.cost[i])}`;
    const arr = buckets.get(key) ?? [];
    arr.push(v.id);
    buckets.set(key, arr);
  }
  let group = 0;
  for (const ids of buckets.values()) {
    if (ids.length < 2) continue;
    group++;
    for (const id of ids) tied.set(id, group);
  }

  let pool = 0;
  let payers = 0;
  let indifferent = 0;
  let unvalued = 0;
  let remaining = 0;
  for (let i = 0; i < n; i++) {
    if (done[i]) continue;
    remaining++;
    const v = value[i];
    if (v == null) {
      unvalued++;
      continue;
    }
    if (v > 0) {
      payers++;
      pool += v;
    } else {
      indifferent++;
    }
  }

  const valueById = new Map<string, number | null>();
  for (let i = 0; i < n; i++) valueById.set(g.vertices[i]!.id, done[i] ? 0 : (value[i] ?? null));

  /*
   * The two drills, for the plan's rows. `solved.dom` is the final fixpoint
   * (computed after `restore`, so nothing the plan marked done still counts).
   * Vertex x dominates y when bit x of dom[y] is set - the same convention the
   * inversion loop above walks with clz32.
   */
  const costLinks = new Map<string, PathLink[]>();
  for (let i = 0; i < n; i++) costLinks.set(g.vertices[i]!.id, solved.links[i] ?? []);
  const behind = new Map<string, ReadonlyArray<{ planet: string; ids: string[] }>>();
  for (const id of plan) {
    const x = g.index.get(id);
    if (x === undefined) continue;
    const groups = new Map<string, string[]>();
    for (let y = 0; y < n; y++) {
      if (done[y] || y === x) continue;
      const word = solved.dom[y]?.[x >>> 5] ?? 0;
      if (((word >>> (x & 31)) & 1) === 0) continue;
      const v = g.vertices[y]!;
      const planet = v.planet ?? (v.kind === 'quest' ? 'Quests' : 'Elsewhere');
      const arr = groups.get(planet) ?? [];
      arr.push(v.id);
      groups.set(planet, arr);
    }
    const titleOf = (vid: string): string => g.vertices[g.index.get(vid) ?? -1]?.title ?? vid;
    behind.set(
      id,
      [...groups]
        .map(([planet, ids]) => ({ planet, ids: ids.sort((a, b) => titleOf(a).localeCompare(titleOf(b))) }))
        .sort((a, b) => b.ids.length - a.ids.length || a.planet.localeCompare(b.planet)),
    );
  }

  return {
    band, reason, domCount, gate, cost, costUnit, costAtLeast, prereqs, costLinks, behind, score, plan, tied, pool,
    unit: GOAL_UNIT[goal],
    scoreUnit: costUnit === 'minutes' ? `${GOAL_UNIT[goal]} an hour` : `${GOAL_UNIT[goal]} per objective`,
    payers, indifferent, unvalued, remaining, value: valueById,
  };
}
