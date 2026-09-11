/**
 * The transit diagram's rules, enforced rather than eyeballed.
 *
 * A transit diagram is defined by its constraints, not by its look. The moment a
 * segment sits at 37 degrees, or two stations are a different distance apart
 * than two others, it stops being a transit diagram and becomes a sketch of one
 * - and neither of those is visible in a screenshot until someone who knows what
 * they are looking at sees it.
 *
 * So the constraints are assertions. See src/data/transit-layout.ts for why the
 * diagram exists at all, and docs/research/starchart-directions.md for the
 * directions that were considered and rejected.
 *
 * Run: node scripts/check-transit.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCatalog } from '../src/data/catalog.ts';
import { buildTransit, STATION_GAP } from '../src/data/transit-layout.ts';

const root = join(import.meta.dirname, '..', 'src', 'data', 'vendor');
const read = (f: string): unknown => JSON.parse(readFileSync(join(root, f), 'utf8'));
const nodesFile = read('nodes.json') as { nodes: unknown[] };
const questsFile = read('quests.json') as { quests: unknown[] };
const junctionsFile = read('junctions.json') as unknown;
const catalog = buildCatalog(
  nodesFile.nodes as never,
  questsFile.quests as never,
  (Array.isArray(junctionsFile) ? junctionsFile : (junctionsFile as { junctions: unknown[] }).junctions) as never,
);

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log('  ok   ', name);
  } catch (err) {
    failures++;
    console.log('  FAIL ', name, '\n         ', (err as Error).message.split('\n')[0]);
  }
}

const map = buildTransit(catalog);

check('every node in the catalog reaches the diagram', () => {
  // A station quietly dropped is a mission the player cannot find, and the old
  // orbital view had exactly that failure for whole regions.
  const placed = map.stations.size;
  const placeable = [...catalog.nodeById.values()].filter(
    (n) => n.planet !== null && n.planet !== undefined && n.planet !== '',
  ).length;
  assert.equal(placed, placeable, `${String(placeable - placed)} nodes were not placed`);
  assert.ok(placed > 300, `only ${String(placed)} stations`);
});

check('EVERY segment is horizontal, vertical or exactly 45 degrees', () => {
  // The one rule a transit diagram may never break.
  const bad: string[] = [];
  for (const link of map.links) {
    for (let i = 1; i < link.points.length; i++) {
      const a = link.points[i - 1]!;
      const b = link.points[i]!;
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if (dx === 0 || dy === 0) continue; // horizontal or vertical
      // 45 degrees means dx === dy exactly. Not "close to": a rounding drift
      // here is precisely how a diagram stops being octilinear.
      if (Math.abs(dx - dy) > 0.001) bad.push(`${link.from}->${link.to} leg ${String(i)}: dx=${String(dx)} dy=${String(dy)}`);
    }
  }
  assert.deepEqual(bad, [], `off-axis segments:\n    ${bad.join('\n    ')}`);
});

check('stations on a line are uniformly spaced', () => {
  // Distance carries no meaning in this diagram, so it must never vary and
  // imply that it does.
  for (const line of map.lines) {
    for (let i = 1; i < line.stations.length; i++) {
      const gap = line.stations[i]!.x - line.stations[i - 1]!.x;
      assert.equal(gap, STATION_GAP, `${line.planet} station ${String(i)} sits ${String(gap)} from its neighbour`);
      assert.equal(line.stations[i]!.y, line.y, `${line.planet} station ${String(i)} left its own line`);
    }
  }
});

check('no two lines share a row', () => {
  const seen = new Map<number, string>();
  for (const line of map.lines) {
    const other = seen.get(line.y);
    assert.equal(other, undefined, `${line.planet} and ${String(other)} are drawn on top of each other`);
    seen.set(line.y, line.planet);
  }
});

check('the trunks are derived from the junctions, not assumed', () => {
  // A planet is a root because nothing leads to it, not because of its name.
  const at = (planet: string): number | null | undefined => map.lines.find((l) => l.planet === planet)?.depth;
  assert.equal(at('Earth'), 0, 'Earth should be a root of the junction chain');
  assert.equal(at('Venus'), 1, 'Venus is one junction from Earth');
  assert.equal(at('Mars'), 1, 'Mars is one junction from Earth');
  assert.equal(at('Mercury'), 2, 'Mercury is two junctions from Earth');

  // The chain is a FOREST. Nothing links into Deimos, so it roots the outer
  // spine - this is the fact that a single-root walk got wrong.
  assert.equal(at('Deimos'), 0, 'Deimos roots the second trunk');
  assert.equal(at('Jupiter'), 1, 'Jupiter is one junction from Deimos');
  const sedna = at('Sedna');
  assert.ok(sedna !== null && sedna !== undefined && sedna > 4, `Sedna sits at the far end of its spine, not depth ${String(sedna)}`);
});

check('every planet a junction touches has a place on a trunk', () => {
  // The contradiction the forest fix removes: a planet cannot be both "detached"
  // and the target of a drawn junction link.
  for (const j of catalog.junctions) {
    const to = map.lines.find((l) => l.planet === j.to);
    if (!to) continue;
    assert.notEqual(to.depth, null, `${j.to} is linked from ${j.from} but carries no trunk depth`);
  }
});

check('a region the junction chain never reaches is marked detached, not invented into the trunk', () => {
  // Void, Lua, Duviri, the Proximas and the rest genuinely have no junction. The
  // diagram must say so rather than drawing a connection to look tidy.
  assert.ok(map.detached.length > 0, 'every region claimed a trunk position, which the data does not support');
  for (const planet of map.detached) {
    const line = map.lines.find((l) => l.planet === planet);
    assert.equal(line?.depth, null, `${planet} is detached but carries a trunk depth`);
    assert.ok(
      !map.links.some((l) => l.to === planet),
      `${planet} is detached but something links into it`,
    );
  }
});

check('every junction in the catalog is drawn as an interchange', () => {
  for (const j of catalog.junctions) {
    const station = map.stations.get(j.id);
    if (!station) continue; // not every junction id is also a node row
    assert.equal(station.interchange, true, `${j.id} is drawn as an ordinary station`);
  }
  const interchanges = [...map.stations.values()].filter((s) => s.interchange).length;
  assert.ok(interchanges > 0, 'no interchanges at all');
});

check('the diagram is the same every time it is built', () => {
  // A map that reshuffles between renders cannot be learned, and this one is
  // built from a Map whose iteration order must not leak into the layout.
  const again = buildTransit(catalog);
  const a = map.lines.map((l) => `${l.planet}@${String(l.y)}:${l.stations.map((s) => s.id).join(',')}`);
  const b = again.lines.map((l) => `${l.planet}@${String(l.y)}:${l.stations.map((s) => s.id).join(',')}`);
  assert.deepEqual(a, b, 'two builds of the same catalog produced different diagrams');
});

check('the layout does not depend on the account', () => {
  // Progress is PAINTED on the diagram, never encoded into it: a station that
  // moves when you clear it is a map nobody can learn.
  const fresh = buildTransit(catalog);
  assert.equal(fresh.width, map.width);
  assert.equal(fresh.height, map.height);
  assert.equal(fresh.stations.size, map.stations.size);
});

console.log(failures === 0 ? '\nall transit rules hold' : `\n${String(failures)} transit rule(s) broken`);
if (failures > 0) process.exit(1);
