/**
 * The completionism engine.
 *
 * Turns the vendored datasets plus the player's own account into a list of
 * candidate actions, each carrying a real measure of how much it opens up.
 *
 * The central idea is the **frontier**. The star chart is a directed graph, so
 * at any moment there is an exact set of nodes the player can actually do next:
 * uncleared nodes with at least one cleared predecessor. Everything deeper is
 * locked; everything behind is already done. Recommending from the frontier is
 * what makes the advice non-repetitive by construction rather than by penalty.
 *
 * The second idea is **leverage**. Among the things you *can* do, the ones worth
 * doing first are the ones that unlock the most other things. That is a
 * transitive count over the graph, not a guess — a quest that gates six further
 * quests genuinely outranks one that gates none.
 *
 * These functions are pure and take their data as arguments, so the check script
 * can exercise them against fixtures without loading the real datasets.
 */

import type { Action } from './progression';
import { holdsQuest, type AccountPicture } from './progression.ts';
import type { JunctionEntry, NodeEntry, QuestEntry } from './vendor/types';

export interface Catalog {
  nodeById: Map<string, NodeEntry>;
  /**
   * Merged predecessor index: `n.prev` UNION every node that lists `n` in its
   * `next`.
   *
   * The two relations are NOT mirror images in the source data, and the places
   * they disagree are exactly the planet entry points. The Jupiter Junction
   * declares `next: [SolNode100]`, but `SolNode100.prev` names an intra-Jupiter
   * node instead of the junction. Reading only `prev` therefore left all 18
   * Jupiter nodes — and 132 nodes overall — permanently outside the frontier.
   */
  predecessors: Map<string, string[]>;
  /** Merged successor index, the same union in the other direction. */
  successors: Map<string, string[]>;
  questByKey: Map<string, QuestEntry>;
  /** Lowercased quest name -> its key. Prerequisites are written both ways. */
  questKeyByName: Map<string, string>;
  junctions: JunctionEntry[];
  /** Quest key -> keys of quests that list it as a prerequisite. */
  questDependents: Map<string, string[]>;
  /** Planet -> node ids on it. */
  planetNodes: Map<string, string[]>;
  /** Quests whose canonical id is unknown, so completion can't be verified. */
  untrackableQuests: string[];
}

/** Stable key for a quest: its uniqueName when known, else a name-derived key. */
export function questKey(q: Pick<QuestEntry, 'id' | 'name'>): string {
  return q.id ?? `name:${q.name.toLowerCase()}`;
}

/**
 * Resolve a quest reference to its canonical id.
 *
 * References appear as either a `/Lotus/...` uniqueName or a plain display name,
 * depending on whether they came from an infobox or from prose, so both spellings
 * have to resolve to the id the account actually records.
 */
function questIdFromRef(ref: string, catalog: Catalog): string | undefined {
  const direct = catalog.questByKey.get(ref);
  if (direct?.id) return direct.id;
  const key = catalog.questKeyByName.get(ref.toLowerCase());
  // A quest can legitimately have a null id (no canonical uniqueName); normalise
  // that to undefined so callers have one "unresolved" value to test.
  return (key ? catalog.questByKey.get(key)?.id : undefined) ?? undefined;
}

export function buildCatalog(nodes: NodeEntry[], quests: QuestEntry[], junctions: JunctionEntry[]): Catalog {
  const nodeById = new Map<string, NodeEntry>();
  const planetNodes = new Map<string, string[]>();
  for (const n of nodes) {
    nodeById.set(n.id, n);
    if (n.planet) {
      const list = planetNodes.get(n.planet);
      if (list) list.push(n.id);
      else planetNodes.set(n.planet, [n.id]);
    }
  }

  // Merge both edge relations into symmetric indices. See the doc on `Catalog`
  // for why reading `prev` alone silently strands whole planets.
  const predecessors = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    if (from === to) return;
    const succ = successors.get(from);
    if (succ) {
      if (!succ.includes(to)) succ.push(to);
    } else successors.set(from, [to]);
    const pred = predecessors.get(to);
    if (pred) {
      if (!pred.includes(from)) pred.push(from);
    } else predecessors.set(to, [from]);
  };
  for (const n of nodes) {
    for (const nxt of n.next) link(n.id, nxt);
    for (const prv of n.prev) link(prv, n.id);
  }

  const questByKey = new Map<string, QuestEntry>();
  const keyByName = new Map<string, string>();
  const untrackableQuests: string[] = [];
  for (const q of quests) {
    const key = questKey(q);
    questByKey.set(key, q);
    keyByName.set(q.name.toLowerCase(), key);
    if (!q.id) untrackableQuests.push(q.name);
  }

  // Prerequisites are written either as uniqueNames or as plain names; resolve
  // both to the same key space so the dependent graph is consistent.
  const resolve = (ref: string): string | null =>
    questByKey.has(ref) ? ref : (keyByName.get(ref.toLowerCase()) ?? null);

  const questDependents = new Map<string, string[]>();
  for (const q of quests) {
    const key = questKey(q);
    for (const ref of q.requires ?? []) {
      const parent = resolve(ref);
      if (!parent) continue;
      const list = questDependents.get(parent);
      if (list) list.push(key);
      else questDependents.set(parent, [key]);
    }
  }

  return { nodeById, predecessors, successors, questByKey, questKeyByName: keyByName, junctions, questDependents, planetNodes, untrackableQuests };
}

/** Has the account finished this quest? `null` means we genuinely cannot tell. */
export function questDone(q: QuestEntry, picture: AccountPicture): boolean | null {
  if (!q.id) return null; // no canonical id — unverifiable, so never assume
  // `holdsQuest` owns the membership test, including the loose match for the
  // key paths GEP and the export disagree about. This function adds only the
  // question that needs a `QuestEntry` and an account read: "and if it is not
  // in the set, did we ever look?"
  if (holdsQuest(picture, q.id)) return true;
  /*
   * AN EMPTY SET IS NOT A FINISHED SEARCH.
   * ————————————————————————————————————————————
   * Falling straight to `false` here could not tell "the account says this
   * quest is unfinished" from "the account was never read, so there is nothing
   * to find it in" - and on an unread account that made every quest in the
   * game answer "not done", which is a claim about the player assembled
   * entirely out of our own missing data.
   *
   * It is the same mistake `pursuitGate` already fixed one file over for the
   * star chart ("a null `have` is an unread account, not a finished chart"),
   * and `Counted.have` exists precisely to tell the two apart:
   * `quests.have` is `questsRead ? completedQuests.size : null`, filled by the
   * same read that fills `completedQuests`. So null here is not a guess.
   *
   * The order matters. Both lookups above run FIRST, so a read account that
   * genuinely holds the quest still answers `true`; and a read account that
   * has completed nothing has `have === 0`, not null, and still answers
   * `false`. Only a never-read account reaches this line.
   *
   * What it changes, all of it toward saying less: the endgame lane stops
   * hiding three of its four pursuits behind gates it cannot see, plat-routes
   * stops reporting "Needs X first" as a blocker it never verified, and the
   * quest split stops publishing "0 of N" as if it had counted.
   */
  if (picture.quests.have === null) return null;
  return false;
}

/**
 * How many further quests sit behind this one, transitively.
 * Counts only quests that are not already finished — clearing a gate to content
 * you have already seen is not leverage.
 */
export function questLeverage(key: string, catalog: Catalog, picture: AccountPicture): number {
  const seen = new Set<string>([key]);
  const queue = [key];
  let count = 0;
  while (queue.length) {
    const cur = queue.shift()!;
    for (const child of catalog.questDependents.get(cur) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      const q = catalog.questByKey.get(child);
      if (q && questDone(q, picture) !== true) count++;
      queue.push(child);
    }
  }
  return count;
}

/**
 * The frontier: uncleared nodes the player can reach right now.
 * A node qualifies when it has no predecessors at all (a planet entry point) or
 * at least one predecessor is already cleared.
 */
export function frontier(catalog: Catalog, picture: AccountPicture): NodeEntry[] {
  const out: NodeEntry[] = [];
  for (const n of catalog.nodeById.values()) {
    if (picture.clearedNodes.has(n.id)) continue;
    const preds = catalog.predecessors.get(n.id) ?? [];
    if (preds.length === 0 || preds.some((p) => picture.clearedNodes.has(p))) out.push(n);
  }
  return out;
}

/**
 * HOW FAR THE STAR CHART IS FROM OPENING A PLANET, AND WHAT TO DO FIRST.
 *
 * "This mod drops on Ceres, which is not open to you yet" is a true thing to
 * say and a useless one: it names a wall without a door. The chart knows the
 * door - the account's cleared nodes and the unlock graph are both here - so
 * the honest form of "WHEN might I get this mod" is not a date but a
 * prerequisite: how many nodes away, and which one to play tonight.
 *
 * A breadth-first walk outward from everything already cleared, through the
 * merged successor index, until it reaches any node on the planet. The FIRST
 * uncleared node on that path is the answer to "what now"; its length is the
 * answer to "how far".
 *
 * Null when the planet is unknown to the chart, when nothing is cleared (an
 * unread account is not an account stuck on Earth), or when no path exists at
 * all - which is a real answer for content the chart gates behind a quest.
 */
export function stepsToPlanet(
  catalog: Catalog,
  cleared: ReadonlySet<string>,
  planet: string,
): { nodes: number; next: NodeEntry } | null {
  if (cleared.size === 0) return null;
  const onPlanet = new Set<string>();
  for (const n of catalog.nodeById.values()) if (n.planet === planet) onPlanet.add(n.id);
  if (onPlanet.size === 0) return null;
  // Already there: the caller should not have asked, and saying "0 nodes away"
  // would be a step that does not exist.
  for (const id of onPlanet) if (cleared.has(id)) return null;

  /*
   * The walk starts at the FRONTIER rather than at the cleared set, because the
   * first uncleared node reached is what the player actually plays. Seeding
   * with cleared nodes at depth 0 makes their uncleared successors depth 1,
   * which is the same thing counted from the right place.
   */
  const seen = new Set<string>(cleared);
  let edge: Array<{ id: string; first: string }> = [];
  for (const id of cleared) {
    for (const nxt of catalog.successors.get(id) ?? []) {
      if (seen.has(nxt)) continue;
      seen.add(nxt);
      edge.push({ id: nxt, first: nxt });
    }
  }

  let depth = 1;
  while (edge.length > 0) {
    const next: Array<{ id: string; first: string }> = [];
    for (const step of edge) {
      if (onPlanet.has(step.id)) {
        const first = catalog.nodeById.get(step.first);
        return first ? { nodes: depth, next: first } : null;
      }
      for (const nxt of catalog.successors.get(step.id) ?? []) {
        if (seen.has(nxt)) continue;
        seen.add(nxt);
        next.push({ id: nxt, first: step.first });
      }
    }
    edge = next;
    depth++;
  }
  return null;
}

/** How many still-uncleared nodes open up downstream of this one. */
export function nodeLeverage(id: string, catalog: Catalog, picture: AccountPicture): number {
  const seen = new Set<string>([id]);
  const queue = [id];
  let count = 0;
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nxt of catalog.successors.get(cur) ?? []) {
      if (seen.has(nxt)) continue;
      seen.add(nxt);
      if (!picture.clearedNodes.has(nxt)) count++;
      queue.push(nxt);
    }
  }
  return count;
}

/**
 * Turn a free-text gate into real prerequisite ids.
 *
 * The wiki records node and quest gates as prose - "Must have The New Strange
 * completed to access", "Requires Rising Tide". Left as prose it is decoration;
 * the engine would happily recommend a Railjack node to an account that cannot
 * even launch one. Matching the text against the names we actually know turns it
 * into an enforceable gate.
 *
 * Matching is name-driven rather than pattern-driven: anything mentioning a known
 * quest or junction becomes a dependency on it, which degrades safely when the
 * phrasing changes.
 */
export function gatesFromText(text: string | null | undefined, catalog: Catalog): string[] {
  if (!text) return [];
  const haystack = text.toLowerCase();
  const out = new Set<string>();

  for (const [name, key] of catalog.questKeyByName) {
    // Short names would match inside unrelated words; require word boundaries.
    if (name.length < 4) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack)) {
      const id = catalog.questByKey.get(key)?.id;
      if (id) out.add(id);
    }
  }

  for (const j of catalog.junctions) {
    if (haystack.includes(j.name.toLowerCase())) out.add(j.id);
  }

  return [...out];
}

/** One-line description of what a junction still wants from the player. */
function junctionSummary(j: JunctionEntry): string {
  const opens = `Opens ${j.unlocksPlanet ?? j.to}.`;
  const first = j.tasks[0]?.text;
  if (!first) return opens;
  return j.tasks.length === 1 ? `${opens} ${first}.` : `${opens} ${j.tasks.length} tasks, starting with: ${first}.`;
}

/**
 * Generate every candidate action for this account.
 *
 * The result is fed to `recommend()`, which applies the final ranking and drops
 * anything already done or still blocked. Emitting rather than ranking here
 * keeps one scoring path in the app.
 */
export function buildActions(catalog: Catalog, picture: AccountPicture): Action[] {
  const actions: Action[] = [];

  /*
   * "UNVERIFIABLE" MEANS THIS ONE QUEST, NOT THE WHOLE ACCOUNT.
   * ————————————————————————————————————————————
   * The guard below withholds work whose completion cannot be checked, so the
   * board never tells you to redo something you may already have finished.
   * That is right when the account HAS been read and one quest is opaque -
   * a quest with no canonical id, which nothing can resolve.
   *
   * It is wrong when nothing has been read at all. Then every quest is
   * unverifiable, the guard withholds all of them, and the board is empty -
   * which is not a more honest answer than the mainline order, it is no
   * answer. The order quests come in is game data and true of every account;
   * only the claim "you have not done this" needed the account, and that claim
   * is not being made. The panel already carries the caveat globally, in the
   * banner that says the board is unmeasured until the game runs once.
   */
  const readAtAll = picture.quests.have !== null;

  // --- Quests: highest leverage, and strictly one-and-done. -----------------
  for (const q of catalog.questByKey.values()) {
    const done = questDone(q, picture);
    if (done === true) continue;
    if (done === null && readAtAll) continue; // this one is opaque; never risk repeating

    const key = questKey(q);
    const leverage = questLeverage(key, catalog, picture);

    // `note` is research provenance about how the dataset was derived - it is not
    // copy for a player. The headline is generated; the note is not surfaced.
    const because =
      leverage > 0
        ? `Gates ${leverage} further quest${leverage === 1 ? '' : 's'}.`
        : 'Completes a quest line.';
    const alsoNeeds = q.requiresNote ? ` Also needs ${q.requiresNote}.` : '';

    // Non-quest gates are prose. Some resolve to a junction we can actually check
    // ("Earth to Mars Junction"); the rest are things the account data cannot
    // confirm at all ("Mastery Rank 5", "Observer rank with The Quills").
    // An unverifiable gate is demoted rather than ignored: sending someone at a
    // quest they cannot start is the same class of mistake as sending them to
    // repeat one, so it must not outrank work that is definitely available.
    const resolvedGates = gatesFromText(q.requiresNote, catalog);
    const unverifiableGate = !!q.requiresNote && resolvedGates.length === 0;

    // Narrative position, which leverage cannot see.
    //
    // The mainline is a defined sequence, so it is followed as a sequence rather
    // than nudged: within it, `order` dominates, so the earliest unfinished
    // mainline quest always leads. Side quests rank below the whole spine and are
    // demoted further when their gate cannot be verified.
    //
    // These weights are a starting point, not measured truth - there is no
    // ground-truth ranking to fit against. They are deliberately coarse so the
    // ordering is easy to reason about and retune.
    const order = Math.min(q.order ?? 99, 60);
    const bias = q.mainline ? 600 - order * 10 : -order * 2 - (unverifiableGate ? 350 : 0);

    // Prerequisites arrive as either uniqueNames or plain names.
    const questRequires: string[] = [];
    for (const ref of q.requires ?? []) {
      const id = questIdFromRef(ref, catalog);
      if (id) questRequires.push(id);
    }

    actions.push({
      id: q.id ?? key,
      kind: 'quest',
      title: q.name,
      because: because + alsoNeeds,
      where: q.planet ?? undefined,
      bias,
      // Prerequisites arrive as either uniqueNames or plain names; resolve both
      // through the catalog's key space, then down to the ids the account records.
      // Non-quest gates ("Uranus Junction", "Earth to Mars Junction") live in
      // prose; resolving them stops a quest being offered before its junction.
      requires: [...questRequires, ...resolvedGates],
      unlocks: leverage,
    });
  }

  // --- Junctions: hard gates on whole planets. -----------------------------
  for (const j of catalog.junctions) {
    if (picture.clearedNodes.has(j.id)) continue;

    // A junction is only a real option once the player can stand on its origin
    // planet. Without this, a brand-new account gets told to go do the Sedna
    // Junction, which is exactly the kind of useless advice this panel exists to
    // avoid. When the origin planet isn't in the node data at all we can't judge
    // reachability, so we allow it rather than hide content.
    const origin = catalog.planetNodes.get(j.from) ?? [];
    if (origin.length > 0 && !origin.some((id) => picture.clearedNodes.has(id))) continue;

    // Junction tasks routinely require a quest ("Complete Quest: The Teacher").
    // Promoting those to real prerequisites lets the shared `recommend()` filter
    // withhold the junction until the quest is actually done.
    const requires: string[] = [];
    for (const t of j.tasks) {
      if (t.kind !== 'quest' || !t.ref) continue;
      const id = questIdFromRef(t.ref, catalog);
      if (id) requires.push(id);
    }

    const opens = catalog.planetNodes.get(j.unlocksPlanet ?? j.to)?.length ?? 0;
    actions.push({
      id: j.id,
      kind: 'junction',
      title: j.name,
      because: junctionSummary(j),
      where: j.from,
      requires,
      // A junction opens a planet, so its leverage is that planet's node count,
      // damped so a large planet can't outrank an entire quest line.
      unlocks: Math.round(opens / 3),
    });
  }

  // --- Nodes: only the frontier, ranked by what they open. -----------------
  for (const n of frontier(catalog, picture)) {
    const leverage = nodeLeverage(n.id, catalog, picture);
    actions.push({
      id: n.id,
      kind: 'node',
      title: n.name,
      // The leverage clause only. Type and level band belong to the selection
      // plate, which prints them for every node; carrying them here too meant
      // the objective card and the plate read the same sentence side by side.
      because: leverage > 0 ? `Opens ${leverage} further node${leverage === 1 ? '' : 's'}.` : 'Uncleared.',
      where: n.planet ?? undefined,
      // The wiki's prose gate becomes a real prerequisite, so a Railjack node is
      // withheld until the quest that grants a Railjack is actually done.
      requires: gatesFromText(n.requirements, catalog),
      // Raw transitive count is a poor discriminator on a mostly-linear chart -
      // an early node trivially "opens" hundreds. Damping keeps the ordering
      // among nodes while stopping one early node from outranking a quest line.
      unlocks: Math.round(Math.sqrt(leverage)),
    });
  }

  return actions;
}

/**
 * Shortest route from cleared territory to a target node.
 *
 * Answers "how do I actually get there from where I am" rather than just naming
 * a destination, which is what makes the star chart's highlighted path useful
 * instead of decorative.
 *
 * Breadth-first from every cleared node at once (or from the graph's roots on a
 * fresh account), walking the merged successor index so it crosses the
 * one-directional planet gateways. Returns the node ids in travel order,
 * inclusive of the target, or an empty array when no route exists.
 */
export function routeTo(catalog: Catalog, picture: AccountPicture, target: string): string[] {
  if (!catalog.nodeById.has(target)) return [];
  if (picture.clearedNodes.has(target)) return [target];

  const starts: string[] = [];
  for (const id of picture.clearedNodes) if (catalog.nodeById.has(id)) starts.push(id);
  if (!starts.length) {
    // Nothing cleared yet: start from every entry point.
    for (const n of catalog.nodeById.values()) {
      if ((catalog.predecessors.get(n.id) ?? []).length === 0) starts.push(n.id);
    }
  }
  if (!starts.length) return [];

  const cameFrom = new Map<string, string | null>();
  const queue: string[] = [];
  for (const s of starts) {
    if (cameFrom.has(s)) continue;
    cameFrom.set(s, null);
    queue.push(s);
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    for (const nxt of catalog.successors.get(cur) ?? []) {
      if (cameFrom.has(nxt)) continue;
      cameFrom.set(nxt, cur);
      if (nxt === target) {
        const path: string[] = [];
        for (let at: string | null | undefined = target; at != null; at = cameFrom.get(at)) path.push(at);
        return path.reverse();
      }
      queue.push(nxt);
    }
  }
  return [];
}

