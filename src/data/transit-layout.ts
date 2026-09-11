/**
 * The Origin System as a transit network.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The star chart used to be a WebGL solar system: orbits, a shaded globe, a
 * flight animation between worlds. It imitated the game's own screen, which is
 * the weakest thing a companion app can do - the game already draws that, and
 * better, and the player is here because they want something the game does not
 * give them.
 *
 * It also encoded almost nothing. Orbital distance carries no meaning to a
 * player; angular position carries none; and the two things that actually govern
 * play - the unlock graph, and where the player's frontier sits inside it - were
 * both invisible.
 *
 * 355 nodes carry `next[]` and `prev[]`; thirteen junctions chain the planets
 * into a branching trunk. That is a NETWORK, and drawing it as space throws the
 * network away. So: geography discarded. One line per planet, stations for its
 * nodes, junctions as interchanges - the game's own word - and the frontier as
 * the end of the line you can currently reach.
 *
 * See docs/research/starchart-directions.md for the directions considered and
 * why this one was taken.
 *
 * THE RULES, and they are not negotiable inside this file
 * ──────────────────────────────────────────────────────
 *   - OCTILINEAR. Every segment is horizontal, vertical, or exactly 45 degrees.
 *     An arbitrary angle is the one thing a transit diagram may never contain,
 *     and `scripts/check-transit.ts` fails the build if one appears.
 *   - UNIFORM SPACING. Distance means nothing here, so it is never allowed to
 *     vary and imply that it does.
 *   - The layout is a pure function of the catalog. It does not know the
 *     account, so it never moves under the player; their progress is painted
 *     ON it by the renderer, not encoded INTO it.
 */

import type { Catalog } from './catalog.ts';
import type { NodeEntry } from './vendor/types';

/** Distance between two adjacent stations on a line. The only spacing there is. */
export const STATION_GAP = 26;
/**
 * Distance between two parallel lines.
 *
 * Tight on purpose. Thirty lines at a comfortable 76px is a two-thousand-pixel
 * scroll and reads as a list; at 46 the whole system is a single object you can
 * take in, which is the only reason to draw a diagram instead of a table.
 */
export const LINE_GAP = 46;

export interface Station {
  id: string;
  name: string;
  planet: string;
  /** Index along its line, from the line's entry end. */
  at: number;
  x: number;
  y: number;
  /** A junction: an interchange between two planet lines. */
  interchange: boolean;
  node: NodeEntry;
}

export interface Line {
  /** The planet, which is the line's identity and its name. */
  planet: string;
  /** Stations in order along the line. */
  stations: Station[];
  /** Where the line runs. Always horizontal, so one y and a span of x. */
  y: number;
  x0: number;
  x1: number;
  /** Trunk depth: 0 is Earth. Null for a region the junction chain never reaches. */
  depth: number | null;
}

/** A connector between two lines, drawn octilinearly. */
export interface Link {
  from: string;
  to: string;
  /** The junction id, when the game names one for this connection. */
  via: string | null;
  /** Points of the polyline. Every leg is horizontal, vertical or 45 degrees. */
  points: Array<{ x: number; y: number }>;
}

export interface TransitMap {
  lines: Line[];
  links: Link[];
  stations: Map<string, Station>;
  width: number;
  height: number;
  /** Regions the junction chain never reaches. Drawn apart, and labelled as such. */
  detached: string[];
}

/**
 * Order a planet's nodes along its line.
 *
 * The graph inside a planet is a DAG, not a path, so there is no single true
 * order. Depth from the planet's own entry points is the honest one: a node two
 * hops in is drawn two stations in. Ties break by name so the diagram is
 * identical every time it is drawn - a map that reshuffles itself is not a map.
 */
function orderWithin(nodes: NodeEntry[]): NodeEntry[] {
  // Indexed once. A `find` inside the walk is O(n^2) on a 23-station line and
  // pointless when the set is already in hand.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids = new Set(byId.keys());
  const depth = new Map<string, number>();

  // Entry points: nodes whose prerequisites all lie outside this planet.
  const roots = nodes.filter((n) => (n.prev ?? []).every((p) => !ids.has(p)));
  const queue: Array<{ id: string; d: number }> = (roots.length > 0 ? roots : nodes.slice(0, 1)).map((n) => ({
    id: n.id,
    d: 0,
  }));
  for (const q of queue) depth.set(q.id, 0);

  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    const node = byId.get(cur.id);
    for (const nextId of node?.next ?? []) {
      if (!ids.has(nextId)) continue;
      const d = cur.d + 1;
      if ((depth.get(nextId) ?? Infinity) <= d) continue;
      depth.set(nextId, d);
      queue.push({ id: nextId, d });
    }
  }

  return [...nodes].sort((a, b) => {
    const da = depth.get(a.id) ?? 999;
    const db = depth.get(b.id) ?? 999;
    return da - db || a.name.localeCompare(b.name);
  });
}

/**
 * The trunks, from the junction chain.
 *
 * THE CHAIN IS A FOREST, NOT A TREE, and this was discovered by the check
 * script rather than assumed: nothing in the dataset links INTO Deimos, so
 * `Deimos -> Jupiter -> Europa/Saturn -> Uranus -> Neptune -> Pluto -> Eris ->
 * Sedna` is a second trunk with its own root, entirely separate from Earth's
 * `Venus/Mercury` and `Mars/Phobos/Ceres`. A single-root walk left eight
 * planets with no depth at all, and then classified them "detached" while still
 * drawing the junction links into them - the diagram contradicting itself.
 *
 * So every planet that is a junction SOURCE but never a junction TARGET is a
 * root. Roots are derived, never named: a dataset change must move the root
 * rather than silently mislabel one.
 *
 * A planet the chain never touches at all still has no depth, and that is a
 * real fact about it - Void, Lua, Duviri, the Proximas and the rest genuinely
 * have no junction. The diagram says so rather than inventing a connection to
 * make the picture tidier.
 */
function trunk(catalog: Catalog): { depth: Map<string, number>; parent: Map<string, string> } {
  const edges = new Map<string, string[]>();
  const parent = new Map<string, string>();
  for (const j of catalog.junctions) {
    const list = edges.get(j.from) ?? [];
    list.push(j.to);
    edges.set(j.from, list);
    if (!parent.has(j.to)) parent.set(j.to, j.from);
  }

  const targets = new Set(catalog.junctions.map((j) => j.to));
  const roots = [...new Set(catalog.junctions.map((j) => j.from))].filter((p) => !targets.has(p)).sort();

  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const root of roots) {
    depth.set(root, 0);
    queue.push(root);
  }
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    for (const next of edges.get(cur) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, (depth.get(cur) ?? 0) + 1);
      queue.push(next);
    }
  }
  return { depth, parent };
}

/** Row assignment: siblings on a branch get their own rows, depth-first. */
function assignRows(
  planets: string[],
  depth: Map<string, number>,
  parent: Map<string, string>,
): Map<string, number> {
  const children = new Map<string, string[]>();
  for (const p of planets) {
    const par = parent.get(p);
    if (par === undefined) continue;
    const list = children.get(par) ?? [];
    list.push(p);
    children.set(par, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.localeCompare(b));

  const row = new Map<string, number>();
  let next = 0;
  const walk = (planet: string): void => {
    row.set(planet, next++);
    for (const child of children.get(planet) ?? []) walk(child);
  };
  const roots = planets.filter((p) => depth.get(p) === 0);
  for (const r of roots) walk(r);
  // Anything the walk missed is on the chain but unreachable from a root.
  for (const p of planets) if (!row.has(p)) row.set(p, next++);
  return row;
}

/**
 * Build the diagram.
 *
 * Pure: same catalog in, same picture out, every time. The account is painted on
 * top by the renderer and never moves a station, because a map that rearranges
 * itself as you play is not something anyone can learn.
 */
export function buildTransit(catalog: Catalog): TransitMap {
  const junctionIds = new Set(catalog.junctions.map((j) => j.id));

  const byPlanet = new Map<string, NodeEntry[]>();
  for (const node of catalog.nodeById.values()) {
    const planet = node.planet;
    if (planet === null || planet === undefined || planet === '') continue;
    const list = byPlanet.get(planet) ?? [];
    list.push(node);
    byPlanet.set(planet, list);
  }

  const { depth, parent } = trunk(catalog);
  const onTrunk = [...byPlanet.keys()].filter((p) => depth.has(p)).sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0));
  const detached = [...byPlanet.keys()].filter((p) => !depth.has(p)).sort((a, b) => a.localeCompare(b));

  const row = assignRows(onTrunk, depth, parent);
  /*
   * Detached regions get their own block with a gap above it, so the diagram
   * never implies a junction the data does not have. They start at the left
   * margin rather than indented: they are not "deep" in the chain, they are
   * apart from it.
   */
  const trunkRows = onTrunk.length;
  detached.forEach((p, i) => row.set(p, trunkRows + 1 + i));

  const PAD_X = 132;
  const PAD_Y = 40;

  const lines: Line[] = [];
  const stations = new Map<string, Station>();

  for (const planet of [...onTrunk, ...detached]) {
    const ordered = orderWithin(byPlanet.get(planet) ?? []);
    const r = row.get(planet) ?? 0;
    const y = PAD_Y + r * LINE_GAP;
    // Indent by trunk depth so the eye reads left-to-right as progress. A
    // detached region starts at the left margin: it is not "deep", it is apart.
    const d = depth.get(planet) ?? null;
    const x0 = PAD_X + (d ?? 0) * 26;

    const built: Station[] = ordered.map((node, i) => {
      const st: Station = {
        id: node.id,
        name: node.name,
        planet,
        at: i,
        x: x0 + i * STATION_GAP,
        y,
        interchange: junctionIds.has(node.id),
        node,
      };
      stations.set(node.id, st);
      return st;
    });

    lines.push({
      planet,
      stations: built,
      y,
      x0,
      x1: x0 + Math.max(0, built.length - 1) * STATION_GAP,
      depth: d,
    });
  }

  const byName = new Map(lines.map((l) => [l.planet, l]));

  /**
   * Connectors, octilinear by construction.
   *
   * A leg down to the next line is drawn as: run along the parent line, a 45
   * degree diagonal exactly as tall as it is wide, then run into the child's
   * first station. Because the diagonal's dx and dy are the same number, the
   * angle is exactly 45 degrees and cannot drift - which is what the check
   * script verifies rather than trusting.
   */
  const links: Link[] = [];
  for (const j of catalog.junctions) {
    const from = byName.get(j.from);
    const to = byName.get(j.to);
    if (!from || !to) continue;

    const dy = to.y - from.y;
    const rise = Math.abs(dy);
    // Leave from the junction's own station when the dataset places one on the
    // parent line; otherwise from the parent's end.
    const gate = stations.get(j.id);
    const startX = gate && gate.planet === j.from ? gate.x : from.x1;
    const endX = to.x0;

    // The diagonal is `rise` wide so it is exactly 45 degrees. The horizontal
    // legs absorb whatever is left over.
    const diagStart = Math.max(startX, endX - rise);
    links.push({
      from: j.from,
      to: j.to,
      via: j.id,
      points: [
        { x: startX, y: from.y },
        { x: diagStart, y: from.y },
        { x: diagStart + rise, y: from.y + dy },
        { x: endX, y: to.y },
      ],
    });
  }

  const width = Math.max(...lines.map((l) => l.x1), 0) + PAD_X;
  const height = Math.max(...lines.map((l) => l.y), 0) + PAD_Y;

  return { lines, links, stations, width, height, detached };
}
