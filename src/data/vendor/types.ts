/**
 * Shapes of the vendored datasets in this directory.
 *
 * These files are committed rather than fetched. Two reasons:
 *
 *  1. The star-chart unlock graph and the junction task lists exist nowhere in
 *     machine-readable form — they were reconstructed from wiki prose. There is
 *     no endpoint to call.
 *  2. wiki.warframe.com sits behind a Cloudflare JS interstitial, so a runtime
 *     fetch from the app would get a challenge page, not data.
 *
 * Refresh them by re-running the research, not by adding a network call.
 * `npm run check:catalog` validates referential integrity after any refresh.
 */

export interface Dataset {
  version: string;
  source: string;
  sourceNote?: string;
}

/** One star-chart node. `id` is the InternalName, which joins to `Missions[].Tag`. */
export interface NodeEntry {
  id: string;
  name: string;
  planet: string | null;
  type: string | null;
  tileset?: string | null;
  enemy?: string | null;
  minLevel: number | null;
  maxLevel: number | null;
  mastery?: number | null;
  /** Nodes this one opens, as InternalNames. */
  next: string[];
  /** Nodes that open this one, as InternalNames. */
  prev: string[];
  /** Free-text gate, e.g. "Must have The New Strange completed to access". */
  requirements?: string | null;
}

export interface NodesFile extends Dataset {
  nodeCount: number;
  unresolved?: string[];
  nodes: NodeEntry[];
}

/** One quest. `id` is the `/Lotus/Types/Keys/...` uniqueName, joining to `QuestKeys[].ItemType`. */
export interface QuestEntry {
  /** null when the canonical uniqueName could not be determined — see `trackable`. */
  id: string | null;
  name: string;
  order: number;
  planet?: string | null;
  /** Prerequisite quests, by uniqueName or by exact name. */
  requires: string[];
  /** Non-quest gates in plain text (junctions, mastery rank, owning an item). */
  requiresNote?: string | null;
  unlocks?: string[];
  mainline?: boolean;
  /**
   * One line about the quest, FOR A PLAYER.
   *
   * Promoted straight to the quest's summary line in the UI, so it has to read
   * as something a player wants to know. Five of these used to carry dataset
   * provenance instead - "DE spells the name 'AWAKENING' in ExportKeys", notes
   * about wiki redirects and missing infoboxes - which meant the headline text
   * under a tracked quest was a message to whoever built the file. That belongs
   * in `provenance`.
   */
  note?: string | null;
  /**
   * Why this row says what it says. NEVER RENDERED.
   *
   * Kept because it is genuinely valuable - it records where a contested field
   * came from and why a quest has a null id - but it is documentation of the
   * dataset, not copy for the app.
   */
  provenance?: string | null;
}

export interface QuestsFile extends Dataset {
  questCount: number;
  quests: QuestEntry[];
}

export type JunctionTaskKind = 'quest' | 'mission' | 'craft' | 'rank' | 'collect' | 'other';

export interface JunctionTask {
  text: string;
  kind: JunctionTaskKind;
  ref?: string | null;
}

/**
 * One junction. `id` is DE's own tag, joining to `Missions[].Tag`.
 *
 * Usually that is `<From>To<To>Junction`, but NOT always: DE never re-tagged the
 * Jupiter Junction when it moved from Ceres to Deimos, so it is still
 * `CeresToJupiterJunction`. Deriving the id from `from`/`to` would silently fail
 * to join. Any id that departs from the pattern must carry an `idNote`.
 */
export interface JunctionEntry {
  id: string;
  name: string;
  from: string;
  to: string;
  /** Required when `id` is not `<from>To<to>Junction`, explaining why. */
  idNote?: string | null;
  unlocksPlanet?: string | null;
  tasks: JunctionTask[];
}

export interface JunctionsFile extends Dataset {
  junctionCount: number;
  junctions: JunctionEntry[];
}
