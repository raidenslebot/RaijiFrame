/**
 * THE QUEST MODEL.
 *
 * WHY THE OLD SHAPE COULD NOT CARRY THIS
 * ──────────────────────────────────────
 * A `Pursuit` is a label, a weight and one number. That is enough to RANK things
 * and nothing else — you cannot track it, you cannot step through it, you cannot
 * ask why it is unavailable, and you cannot be told what doing it would open up.
 * A board of bars is a report; a quest log is something you work from.
 *
 * So this promotes every objective in the game to a real quest:
 *
 *   - itemised STEPS, from the game's own data where it exists
 *   - PREREQUISITES, and — because we know the account — which of them are
 *     actually the thing blocking you right now
 *   - what it UNLOCKS, so the cost/benefit of doing it is visible
 *   - WHERE it happens
 *   - what it PAYS
 *
 * WHERE THE DATA ACTUALLY COMES FROM
 * ──────────────────────────────────
 * None of this is invented. Three vendored datasets already carry it and were
 * being used for almost none of their content:
 *
 *   junctions.json  every junction has 4-5 explicit tasks, each with a `kind`
 *                   (`quest` / `craft` / `rank` / `other`) and a `ref`. This is
 *                   itemised, checkable quest text straight from the game.
 *   quests.json     a real prerequisite DAG — `requires`, `unlocks`, `planet`,
 *                   `mainline`, plus free-text gates in `requiresNote`.
 *   nodes.json      per-node mission type, level band, faction, tileset, the
 *                   nodes it opens, and free-text unlock requirements.
 *
 * A pursuit that has no such data becomes a quest with no steps rather than a
 * quest with invented ones. "We do not know the steps" is a fact; a plausible
 * guess at them is the failure this whole codebase is built to avoid.
 */

import { questDone, questKey, type Catalog } from './catalog.ts';
import type { JunctionEntry, NodeEntry, QuestEntry } from './vendor/types';
import type { AccountPicture } from './progression';
import { PURSUITS, type Domain, type Pursuit } from './pursuits.ts';

/* ------------------------------------------------------------------- model */

export type QuestKind = 'quest' | 'junction' | 'node' | 'pursuit';

/**
 * Why a quest is or is not actionable.
 *
 * `unmeasured` is distinct from `blocked` on purpose: one says the game told us
 * you cannot do this yet, the other says we have no idea, and collapsing them
 * would turn an absence of data into a claim about the player.
 */
export type QuestState = 'done' | 'available' | 'blocked' | 'unmeasured';

export interface QuestStep {
  text: string;
  /** From the game's own task data where present. */
  kind: 'quest' | 'craft' | 'rank' | 'mission' | 'other';
  /** The thing the step points at, when it names one. */
  ref: string | null;
  /**
   * Whether this specific step is done.
   *
   * `null` is the common and correct answer: the game exposes whether a QUEST is
   * complete, but not whether you have equipped a particular mod or started a
   * particular build. Rendering those as unticked would tell the player they
   * have work they may well have already done.
   */
  done: boolean | null;
}

export interface QuestLink {
  id: string;
  title: string;
  /** Whether the linked thing is itself complete, when we can tell. */
  done: boolean | null;
}

export interface Quest {
  id: string;
  kind: QuestKind;
  /**
   * True when this is done-or-not-done, with no meaningful middle.
   *
   * A quest, a junction and a mission node are binary: you have cleared it or
   * you have not. Rendering "0%" against one is both wrong and ugly — it implies
   * a partially-completed state the game does not have. Only long-running
   * pursuits carry a real ratio.
   */
  binary: boolean;
  title: string;
  summary: string;
  domain: Domain;

  /** Where it happens, when the data names somewhere. */
  planet: string | null;
  /** The panel that tracks it in detail, when another one does. */
  panel: string | null;

  steps: QuestStep[];
  /** Everything that gates this. */
  requires: QuestLink[];
  /** The subset of `requires` that is actually still outstanding. */
  blockedBy: QuestLink[];
  /** What finishing this opens up. */
  unlocks: QuestLink[];
  /** Free-text gates the datasets record but do not model. */
  notes: string[];

  state: QuestState;
  /** 0..1, or null when unmeasured. */
  progress: number | null;
  /** Mastery this pays, when it pays a known amount. */
  mastery: number | null;
  /** Level band, for missions. */
  levels: [number, number] | null;
  /** Faction, mission type, tileset — whatever the dataset actually carries. */
  facts: Array<{ label: string; value: string }>;

  /** Ranking weight, carried through from the pursuit taxonomy. */
  weight: number;
}

/* ------------------------------------------------------------- construction */

const linkTo = (id: string, title: string, done: boolean | null): QuestLink => ({ id, title, done });

/**
 * Quests from the vendored quest DAG.
 *
 * `requires` holds either a uniqueName or an exact display name — the dataset is
 * explicit about that — so both are resolved before giving up on a reference.
 */
function questsFrom(catalog: Catalog, picture: AccountPicture): Quest[] {
  // The catalog already indexes quests both ways, because the dataset writes
  // prerequisites sometimes as a uniqueName and sometimes as a display name.
  const quests: QuestEntry[] = [...catalog.questByKey.values()];
  if (quests.length === 0) return [];

  const resolve = (ref: string): QuestEntry | undefined =>
    catalog.questByKey.get(ref) ??
    catalog.questByKey.get(catalog.questKeyByName.get(ref.toLowerCase()) ?? '');
  /*
   * ONE ANSWER TO "IS THIS QUEST DONE", NOT TWO.
   * ————————————————————————————————————————————
   * This was a local reimplementation - `q.id === null ? null :
   * picture.completedQuests.has(q.id)` - and a copy of a rule drifts from the
   * rule. It had drifted twice:
   *
   *   1. It never got the fallback `questDone` carries, where GEP and the
   *      export disagree about a key path and the final segment is compared
   *      before declaring a quest unfinished. So on a REAL account a quest
   *      whose path differed by prefix read "not done" and the row said
   *      "blocked" about work already finished.
   *   2. It answered `false` on an account that was never read, which is how
   *      "Needs The Second Dream first - BLOCKED" appeared for a player nobody
   *      had measured.
   *
   * Both go away by asking the one function that owns the question. It returns
   * `boolean | null` and every consumer below already handles the null: an
   * unknown prerequisite becomes a note rather than a blocker, which is what
   * the comment under `blockedBy` has always said it does.
   */
  const isDone = (q: QuestEntry): boolean | null => questDone(q, picture);

  return quests.map((q): Quest => {
    const done = isDone(q);

    const requires = q.requires
      .map((ref) => {
        const target = resolve(ref);
        // An unresolvable reference is still shown, by the name the dataset
        // used — dropping it would hide a real prerequisite.
        return target === undefined
          ? linkTo(ref, ref, null)
          : linkTo(questKey(target), target.name, isDone(target));
      })
      .sort((a, b) => a.title.localeCompare(b.title));

    const unlocks = (q.unlocks ?? [])
      .map((ref) => {
        const target = resolve(ref);
        return target === undefined
          ? linkTo(ref, ref, null)
          : linkTo(questKey(target), target.name, isDone(target));
      })
      .sort((a, b) => a.title.localeCompare(b.title));

    // Only prerequisites we can positively confirm are outstanding count as
    // blockers. An unknown one is a note, not a blocker.
    const blockedBy = requires.filter((r) => r.done === false);

    const state: QuestState =
      done === null ? 'unmeasured' : done ? 'done' : blockedBy.length > 0 ? 'blocked' : 'available';

    // `q.note` is promoted to the summary above, so listing it again here would
    // print the same sentence twice in one expanded row.
    const notes: string[] = [];
    if (q.requiresNote != null && q.requiresNote.length > 0) notes.push(q.requiresNote);

    const facts: Array<{ label: string; value: string }> = [];
    // Not a fact row: the row's own header chip already names the planet, and
    // that chip is a link. Two copies, one of them dead, is the duplication this
    // pass exists to remove.
    if (q.note != null && q.note.length > 0) facts.push({ label: 'Note', value: q.note });

    return {
      // `questKey`, the same id the engine and every link use. Three id forms
      // for the one null-id quest meant its links went nowhere.
      id: questKey(q),
      kind: 'quest',
      binary: true,
      title: q.name,
      /*
       * Same problem as the nodes: one blurb repeated ten times said nothing
       * about any individual quest. The dataset carries a per-quest note, a
       * prerequisite count and an unlock count — all specific, all more useful
       * than the category.
       */
      /*
       * ONE VOICE PER ROW. The dataset's per-quest note used to be the summary
       * whenever it existed, so a board mixed "Mainline · needs 1 first · opens
       * 4" with "Added in Update 40 (2025-10-15) and retroactively inserted
       * into early progression" and "A former Mastery Rank 5 gate was removed
       * in Update 35" - changelog prose beside terse tokens. The structural line
       * is now the summary for every quest; the note is real and kept, one
       * click away, as a fact.
       */
      summary: (() => {
        const parts: string[] = [q.mainline === true ? 'Mainline' : 'Side quest'];
        if (q.requires.length > 0) parts.push(`needs ${q.requires.length} first`);
        if ((q.unlocks ?? []).length > 0) parts.push(`opens ${(q.unlocks ?? []).length}`);
        return parts.join(' · ');
      })(),
      domain: q.mainline === true ? 'narrative' : 'narrative',
      planet: q.planet ?? null,
      panel: null,
      // The quest dataset records prerequisites and unlocks, not the beats
      // inside a quest. Inventing plausible objectives here would be fiction.
      steps: [],
      requires,
      blockedBy,
      unlocks,
      notes,
      state,
      progress: done === null ? null : done ? 1 : 0,
      mastery: null,
      levels: null,
      facts,
      weight: q.mainline === true ? 1000 : 420,
    };
  });
}

/**
 * Junctions — the richest quests in the game as far as our data goes, because
 * every one carries its explicit task list.
 */
/**
 * A junction's quest task names the quest ("The Teacher"); the account records
 * quest KEYS (`/Lotus/Types/Keys/...`). Comparing the name against the key list
 * never matched, so no junction task ever ticked on any account. Resolve the
 * name through the catalog first. A name the catalog cannot place stays
 * unknown - never unticked, which would be an accusation.
 */
export function questTaskDone(catalog: Catalog, picture: AccountPicture, ref: string): boolean | null {
  const key = catalog.questByKey.has(ref) ? ref : catalog.questKeyByName.get(ref.toLowerCase());
  const q = key ? catalog.questByKey.get(key) : undefined;
  return q ? questDone(q, picture) : null;
}

function junctionsFrom(catalog: Catalog, picture: AccountPicture): Quest[] {
  const junctions: JunctionEntry[] = catalog.junctions ?? [];

  return junctions.map((j): Quest => {
    const done = picture.clearedNodes.has(j.id);

    const steps: QuestStep[] = j.tasks.map((t) => ({
      text: t.text,
      kind: t.kind === 'quest' || t.kind === 'craft' || t.kind === 'rank' ? t.kind : 'other',
      ref: t.ref ?? null,
      // Only a quest task can be confirmed: the account records completed
      // quests. Whether a mod is equipped or a build was started is not in the
      // payload, and an unticked box would be an accusation.
      // A cleared junction has every task behind it; only an open one needs the task checked.
      done: done ? true : t.kind === 'quest' && t.ref != null ? questTaskDone(catalog, picture, t.ref) : null,
    }));

    // No `From`: it is the planet the row's own header chip already shows.
    // `Opens` is the other side of the junction and appears nowhere else.
    const facts: Array<{ label: string; value: string }> = [{ label: 'Opens', value: j.to }];

    return {
      id: j.id,
      kind: 'junction',
      binary: true,
      title: j.name,
      // Short: thirteen of these sit in one list and the second sentence was
      // the same on every row.
      summary: `Gate from ${j.from} to ${j.to} \u00b7 every task first`,
      domain: 'narrative',
      planet: j.from,
      panel: 'starchart',
      steps,
      requires: [],
      blockedBy: [],
      /*
       * Deliberately empty. This used to hold `linkTo(j.unlocksPlanet, ...)`,
       * but `linkTo` builds a QUEST link and `unlocksPlanet` is a planet name,
       * so the resulting button asked the panel to focus a quest id that does
       * not exist: it cleared the player's filters and went nowhere. The fact
       * itself is not lost - it is the `Opens` entry in `facts` above.
       */
      unlocks: [],
      notes: j.idNote != null && j.idNote.length > 0 ? [j.idNote] : [],
      state: done ? 'done' : 'available',
      progress: done ? 1 : 0,
      // Every junction pays 1,000 mastery — a documented constant, not an
      // estimate.
      mastery: 1000,
      levels: null,
      facts,
      weight: 700,
    };
  });
}

/**
 * Mission nodes.
 *
 * Only the frontier and a little context around it: all 355 as separate quests
 * would bury everything else, and a node you cannot reach is not an objective,
 * it is scenery. The star chart is where the whole graph lives.
 */
function nodesFrom(catalog: Catalog, picture: AccountPicture, frontier: ReadonlySet<string>): Quest[] {
  const out: Quest[] = [];
  /*
   * The 13 junctions are ALSO rows in nodes.json, under the same ids. The
   * junction projection above already renders each one with its task list, so
   * a junction that reaches the frontier (clear Earth, and EarthToVenusJunction
   * does) must not be built a second time as a bare mission node - it produced
   * two board rows with one key, which React reported the moment an account
   * was present and never before it.
   */
  const junctionIds = new Set((catalog.junctions ?? []).map((j) => j.id));

  for (const id of frontier) {
    if (junctionIds.has(id)) continue;
    const n: NodeEntry | undefined = catalog.nodeById.get(id);
    if (n === undefined) continue;

    const unlocks = n.next
      .map((t) => {
        const target = catalog.nodeById.get(t);
        return target === undefined
          ? null
          : linkTo(t, target.name, picture.clearedNodes.has(t));
      })
      .filter((l): l is QuestLink => l !== null);

    const facts: Array<{ label: string; value: string }> = [];
    // Mission type and faction are already the row's summary line (see `bits`
    // below). Opening a row must reveal something it did not already show.
    if (n.tileset != null) facts.push({ label: 'Tileset', value: n.tileset });

    /*
     * The summary is the row's ONE line, so it has to earn it.
     *
     * It used to read "A mission node on your frontier." on twenty-five rows at
     * once — text that is true, useless, and identical everywhere it appears.
     * Every one of those nodes carries a mission type, a level band, a faction
     * and a count of what it opens, all of which were already loaded and none of
     * which was being shown.
     *
     * Built from whatever the dataset actually has, in decreasing order of what
     * a player decides on, and falls back to the generic line only when the
     * dataset genuinely has nothing.
     */
    const bits: string[] = [];
    if (n.type != null) bits.push(n.type);
    // A level band is only information when it is actually a BAND. Hubs, relays,
    // Conclave nodes and Free Flight all carry degenerate values in the dataset
    // — 0-0, 1-1 — and printing "lv 0-0" is worse than printing nothing: it
    // reads as a real reading of zero rather than as an absent one.
    // The level band stays a FACT, not a summary fragment: the summary is
    // truncated in the row and "Level 15-20" reads better in the detail grid.
    if (n.enemy != null) bits.push(n.enemy);
    if (unlocks.length > 0) bits.push(`opens ${unlocks.length}`);

    out.push({
      id: n.id,
      kind: 'node',
      binary: true,
      title: n.name,
      summary: bits.length > 0 ? bits.join(' · ') : 'A mission node on your frontier.',
      domain: 'starchart',
      planet: n.planet ?? null,
      panel: 'starchart',
      steps: [],
      requires: [],
      blockedBy: [],
      unlocks,
      notes: n.requirements != null && n.requirements.length > 0 ? [n.requirements] : [],
      state: picture.clearedNodes.has(n.id) ? 'done' : 'available',
      progress: picture.clearedNodes.has(n.id) ? 1 : 0,
      // 0 means NOT RECORDED here, not "pays nothing" - 173 of 355 rows read 0
      // and fifteen whole regions read 0 throughout. See masteryDbFrom.
      mastery: typeof n.mastery === 'number' && n.mastery > 0 ? n.mastery : null,
      levels: hasLevelBand(n) ? [n.minLevel!, n.maxLevel!] : null,
      facts,
      // Nodes that open more nodes are worth more; a dead end is worth least.
      weight: 220 + Math.min(unlocks.length, 4) * 40,
    });
  }

  return out;
}

/**
 * What stands in front of a pursuit, when the game puts something there. A
 * quest gate resolves through the catalog and is checked against the account;
 * the Steel Path gate is the star chart itself. Null when there is no gate or
 * nothing can be said about it.
 */
export function pursuitGate(id: string, catalog: Catalog | null, picture: AccountPicture): QuestLink | null {
  const p = PURSUITS.find((x) => x.id === id);
  if (!p) return null;
  if (p.gateChart) {
    const { have, total } = picture.nodes;
    // A null `have` is an unread account, not a finished chart. This gate used
    // to compare an inflated count (every completed tag, including the ones that
    // are not star chart nodes) against the catalog size, and reported the Steel
    // Path as open on a chart the player had not finished.
    if (have === null || total === null || total === 0) return null;
    return { id: 'nodes.normal', title: 'every star chart node', done: have >= total };
  }
  if (!p.gate || !catalog) return null;
  const key = catalog.questKeyByName.get(p.gate.toLowerCase());
  const q = key ? catalog.questByKey.get(key) : undefined;
  if (!q) return null;
  return { id: questKey(q), title: q.name, done: questDone(q, picture) };
}

/** Long-running pursuits, carried over from the taxonomy. */
function pursuitsAsQuests(progressFor: (p: Pursuit) => number | null, catalog: Catalog | null, picture: AccountPicture): Quest[] {
  return PURSUITS.map((p): Quest => {
    const progress = p.measurable ? progressFor(p) : null;
    const done = progress !== null && progress >= 0.999;
    const gate = pursuitGate(p.id, catalog, picture);
    // Only a gate the account positively shows unfinished blocks; an unknown one is a note.
    const blocked = gate !== null && gate.done === false;

    return {
      id: p.id,
      kind: 'pursuit',
      // A yes/no pursuit (the foundry idle, no lich alive) is not a percentage.
      binary: p.binary === true,
      title: p.label,
      summary:
        p.cadence === 'daily'
          ? `Resets daily. ${p.detail}`
          : p.cadence === 'weekly'
            ? `Resets weekly. ${p.detail}`
            : p.cadence === 'seasonal'
              ? `Ends with the season. ${p.detail}`
              : p.cadence === 'fortnightly'
                ? `Every two weeks. ${p.detail}`
                : p.detail,
      domain: p.domain,
      planet: null,
      panel: p.panel ?? null,
      steps: [],
      requires: gate === null ? [] : [gate],
      blockedBy: blocked ? [gate] : [],
      unlocks: [],
      notes: gate !== null && gate.done === null ? [`Needs ${gate.title} first`] : [],
      state: done ? 'done' : blocked ? 'blocked' : progress === null ? 'unmeasured' : 'available',
      progress,
      mastery: null,
      levels: null,
      // No Cadence fact: the summary already leads with it for anything on a
      // clock, and a fact repeating the line above it is the duplication this
      // panel keeps being caught doing.
      facts: [],
      weight: p.weight,
    };
  });
}

/* ---------------------------------------------------------------- assembly */

export interface QuestInputs {
  catalog: Catalog | null;
  picture: AccountPicture;
  frontier: ReadonlySet<string>;
  progressFor: (p: Pursuit) => number | null;
}

/**
 * Every objective in the game, as a quest.
 *
 * Deliberately unsorted and unfiltered: ranking is a view concern and the caller
 * owns it, so this stays a pure projection of catalog plus account.
 */
export function buildQuests({ catalog, picture, frontier, progressFor }: QuestInputs): Quest[] {
  const out: Quest[] = [...pursuitsAsQuests(progressFor, catalog, picture)];
  if (catalog !== null) {
    out.push(...questsFrom(catalog, picture), ...junctionsFrom(catalog, picture), ...nodesFrom(catalog, picture, frontier));
  }
  return out;
}

/**
 * Whether a node's level range is a real band.
 *
 * The dataset stores 0-0 for hubs, relays and Conclave, and 1-1 for Free Flight.
 * Those are placeholders, not readings, and rendering them as "lv 0-0" states a
 * level the mission does not have.
 */
export function hasLevelBand(n: NodeEntry): boolean {
  return (
    n.minLevel != null &&
    n.maxLevel != null &&
    n.maxLevel > 0 &&
    n.maxLevel > n.minLevel
  );
}

/** Steps a quest can actually confirm, over the total it lists. */
export function stepProgress(q: Quest): { done: number; known: number; total: number } {
  let done = 0;
  let known = 0;
  for (const s of q.steps) {
    if (s.done === null) continue;
    known++;
    if (s.done) done++;
  }
  return { done, known, total: q.steps.length };
}
