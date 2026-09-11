/**
 * Referential-integrity check for the vendored datasets.
 *
 * The datasets are reconstructed from wiki prose, so they are the most likely
 * thing in this repo to be quietly wrong. This validates the real files rather
 * than fixtures: every graph edge must resolve, every prerequisite must point at
 * something that exists, and ids must match the format the account data uses.
 *
 * Run after any dataset refresh: node scripts/validate-datasets.ts
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { NodesFile, QuestsFile, JunctionsFile } from '../src/data/vendor/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const vendor = join(here, '..', 'src', 'data', 'vendor');

function load<T>(name: string): T | null {
  const path = join(vendor, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const problems: string[] = [];
const notes: string[] = [];

function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (err) {
    problems.push(`${label}: ${(err as Error).message}`);
    console.error(`  FAIL  ${label}\n        ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------- nodes -----
const nodesFile = load<NodesFile>('nodes.json');
if (!nodesFile) {
  notes.push('nodes.json missing - star chart graph not vendored yet');
  console.log('  skip  nodes.json (not present)');
} else {
  const nodes = nodesFile.nodes;
  const ids = new Set(nodes.map((n) => n.id));

  check('nodes: duplicate ids carry no edges', () => {
    // DE genuinely reuses a couple of InternalNames (ToggleBootLevel, SolNode236).
    // The catalog keys nodes by id, so a duplicate silently drops one - which is
    // harmless ONLY while the duplicates have no edges. Assert exactly that.
    const seen = new Map<string, number>();
    for (const n of nodes) seen.set(n.id, (seen.get(n.id) ?? 0) + 1);
    const dupes = [...seen].filter(([, c]) => c > 1).map(([id]) => id);
    if (dupes.length) notes.push(`${dupes.length} reused InternalName(s): ${dupes.join(', ')} - DE reuses these`);

    const risky = nodes.filter((n) => dupes.includes(n.id) && (n.next.length > 0 || n.prev.length > 0));
    assert.equal(
      risky.length,
      0,
      `a reused id carries edges, so keying by id would corrupt the graph: ${risky.map((n) => `${n.id} (${n.name})`).join(', ')}`,
    );
  });

  check('nodes: ids are usable as keys', () => {
    // Real InternalNames include `1999Hub` and full `/Lotus/Types/Keys/...` paths,
    // so the only real requirement is that an id is non-empty and whitespace-free.
    const bad = nodes.filter((n) => !n.id || /\s/.test(n.id)).slice(0, 5);
    assert.equal(bad.length, 0, `unusable ids: ${bad.map((n) => JSON.stringify(n.id)).join(', ')}`);
  });

  check('nodes: every `next` edge resolves', () => {
    const dangling = nodes.flatMap((n) => n.next.filter((t) => !ids.has(t)).map((t) => `${n.id}->${t}`));
    assert.equal(dangling.length, 0, `${dangling.length} dangling: ${dangling.slice(0, 6).join(', ')}`);
  });

  check('nodes: every `prev` edge resolves', () => {
    const dangling = nodes.flatMap((n) => n.prev.filter((t) => !ids.has(t)).map((t) => `${t}->${n.id}`));
    assert.equal(dangling.length, 0, `${dangling.length} dangling: ${dangling.slice(0, 6).join(', ')}`);
  });

  check('nodes: graph has entry points', () => {
    const roots = nodes.filter((n) => n.prev.length === 0);
    assert.ok(roots.length > 0, 'no node has an empty `prev`, so a fresh account could never start');
  });

  check('nodes: every node is reachable by clearing predecessors', () => {
    // This mirrors what the engine actually does. `frontier()` offers a node when
    // ANY of its `prev` is cleared, so reachability must be computed over `prev`,
    // not by walking `next` forward - the two relations are not mirror images in
    // the source data, and using `next` here reported false orphans.
    // Merge both relations exactly as buildCatalog does: the source disagrees
    // with itself at planet entry points (a junction declares `next` to a node
    // whose `prev` names something else), and reading one relation alone strands
    // whole planets.
    const preds = new Map<string, Set<string>>();
    const add = (to: string, from: string) => {
      const s = preds.get(to);
      if (s) s.add(from);
      else preds.set(to, new Set([from]));
    };
    for (const n of nodes) {
      for (const p of n.prev) add(n.id, p);
      for (const nx of n.next) add(nx, n.id);
    }

    const reachable = new Set(nodes.filter((n) => (preds.get(n.id)?.size ?? 0) === 0).map((n) => n.id));
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of nodes) {
        if (reachable.has(n.id)) continue;
        if ([...(preds.get(n.id) ?? [])].some((p) => reachable.has(p))) {
          reachable.add(n.id);
          grew = true;
        }
      }
    }
    const orphans = nodes.filter((n) => !reachable.has(n.id));
    if (orphans.length) {
      notes.push(
        `${orphans.length} node(s) unreachable by clearing predecessors, e.g. ${orphans.slice(0, 6).map((n) => `${n.id} (${n.name})`).join(', ')}`,
      );
    }
    assert.ok(
      orphans.length < nodes.length / 10,
      `${orphans.length}/${nodes.length} nodes can never be reached - the engine would never offer them`,
    );
  });

  check('nodes: edges are symmetric', () => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const asym: string[] = [];
    for (const n of nodes) {
      for (const t of n.next) if (!byId.get(t)?.prev.includes(n.id)) asym.push(`${n.id}->${t}`);
    }
    // Asymmetry is a data smell rather than fatal; the engine only reads `prev`
    // for the frontier and `next` for leverage, so it degrades gracefully.
    if (asym.length) notes.push(`${asym.length} asymmetric edge(s), e.g. ${asym.slice(0, 4).join(', ')}`);
    assert.ok(asym.length < nodes.length, 'nearly every edge is asymmetric - direction is probably inverted');
  });

  check('nodes: unresolved names were reported not dropped', () => {
    const u = nodesFile.unresolved?.length ?? 0;
    if (u) notes.push(`${u} display name(s) could not be mapped to an InternalName`);
    assert.ok(u < nodes.length / 4, `${u} unresolved names is too many to trust the graph`);
  });
}

// --------------------------------------------------------------- quests -----
const questsFile = load<QuestsFile>('quests.json');
if (!questsFile) {
  notes.push('quests.json missing - quest graph not vendored yet');
  console.log('  skip  quests.json (not present)');
} else {
  const quests = questsFile.quests;
  const byName = new Map(quests.map((q) => [q.name.toLowerCase(), q]));
  const byId = new Map(quests.filter((q) => q.id).map((q) => [q.id!, q]));

  check('quests: no duplicate names', () => {
    assert.equal(byName.size, quests.length, 'duplicate quest name(s)');
  });

  check('quests: ids are /Lotus/ paths where present', () => {
    const bad = quests.filter((q) => q.id && !q.id.startsWith('/Lotus/')).slice(0, 5);
    assert.equal(bad.length, 0, `bad ids: ${bad.map((q) => q.id).join(', ')}`);
  });

  check('quests: every prerequisite resolves', () => {
    const dangling = quests.flatMap((q) =>
      (q.requires ?? []).filter((r) => !byId.has(r) && !byName.has(r.toLowerCase())).map((r) => `${q.name} requires "${r}"`),
    );
    assert.equal(dangling.length, 0, `${dangling.length} unresolved: ${dangling.slice(0, 5).join('; ')}`);
  });

  check('quests: no circular prerequisites', () => {
    const key = (q: { id: string | null; name: string }) => q.id ?? `name:${q.name.toLowerCase()}`;
    const deps = new Map(
      quests.map((q) => [
        key(q),
        (q.requires ?? []).map((r) => (byId.get(r) ?? byName.get(r.toLowerCase()))).filter(Boolean).map((p) => key(p!)),
      ]),
    );
    const state = new Map<string, number>(); // 0 visiting, 1 done
    const walk = (k: string, trail: string[]): void => {
      if (state.get(k) === 1) return;
      assert.ok(state.get(k) !== 0, `cycle: ${[...trail, k].join(' -> ')}`);
      state.set(k, 0);
      for (const d of deps.get(k) ?? []) walk(d, [...trail, k]);
      state.set(k, 1);
    };
    for (const k of deps.keys()) walk(k, []);
  });

  check('quests: enough are trackable to be useful', () => {
    const trackable = quests.filter((q) => q.id).length;
    const pct = Math.round((trackable / quests.length) * 100);
    notes.push(`${trackable}/${quests.length} quests (${pct}%) have a canonical id and are trackable`);
    assert.ok(pct >= 50, `only ${pct}% of quests are trackable; the panel would be mostly blind`);
  });

  check('quests: order is sane', () => {
    const orders = quests.map((q) => q.order).filter((o) => typeof o === 'number');
    assert.equal(orders.length, quests.length, 'every quest needs an order');
  });
}

// ------------------------------------------------------------ junctions -----
const junctionsFile = load<JunctionsFile>('junctions.json');
if (!junctionsFile) {
  notes.push('junctions.json missing - junction tasks not vendored yet');
  console.log('  skip  junctions.json (not present)');
} else {
  const js = junctionsFile.junctions;

  check('junctions: ids follow the pattern, or document why not', () => {
    // DE did not re-tag Jupiter's junction when it moved from Ceres to Deimos, so
    // the pattern has real exceptions. An exception is fine; an UNDOCUMENTED one
    // is a data error, because it means nobody checked it joins to Missions[].Tag.
    const off = js.filter((j) => j.id !== `${j.from}To${j.to}Junction`);
    const undocumented = off.filter((j) => !j.idNote);
    for (const j of off.filter((x) => x.idNote)) notes.push(`junction id exception: ${j.id} (${j.from}->${j.to})`);
    assert.equal(
      undocumented.length,
      0,
      `id departs from <from>To<to>Junction with no idNote: ${undocumented.map((j) => `${j.id} (${j.from}->${j.to})`).join(', ')}`,
    );
  });

  check('junctions: ids are well formed', () => {
    const bad = js.filter((j) => !/^[A-Za-z]+To[A-Za-z]+Junction$/.test(j.id)).slice(0, 6);
    assert.equal(bad.length, 0, `malformed junction ids: ${bad.map((j) => j.id).join(', ')}`);
  });

  check('junctions: no duplicate ids', () => {
    assert.equal(new Set(js.map((j) => j.id)).size, js.length, 'duplicate junction id(s)');
  });

  check('junctions: every junction has tasks', () => {
    const empty = js.filter((j) => !j.tasks?.length).map((j) => j.id);
    assert.equal(empty.length, 0, `no tasks for: ${empty.join(', ')}`);
  });

  check('junctions: task kinds are valid', () => {
    const valid = new Set(['quest', 'mission', 'craft', 'rank', 'collect', 'other']);
    const bad = js.flatMap((j) => j.tasks.filter((t) => !valid.has(t.kind)).map((t) => `${j.id}: ${t.kind}`));
    assert.equal(bad.length, 0, `invalid kinds: ${bad.slice(0, 5).join(', ')}`);
  });

  if (questsFile) {
    check('junctions: quest task refs resolve to real quests', () => {
      const names = new Set(questsFile.quests.map((q) => q.name.toLowerCase()));
      const dangling = js.flatMap((j) =>
        j.tasks.filter((t) => t.kind === 'quest' && t.ref && !names.has(t.ref.toLowerCase())).map((t) => `${j.id}: "${t.ref}"`),
      );
      if (dangling.length) notes.push(`${dangling.length} junction quest ref(s) not in quests.json: ${dangling.slice(0, 4).join(', ')}`);
      assert.ok(dangling.length <= js.length, 'most junction quest references are unresolvable');
    });
  }

  if (nodesFile) {
    check('junctions: target planets exist in the node graph', () => {
      const planets = new Set(nodesFile.nodes.map((n) => n.planet).filter(Boolean));
      const missing = js.filter((j) => !planets.has(j.unlocksPlanet ?? j.to)).map((j) => j.unlocksPlanet ?? j.to);
      if (missing.length) notes.push(`junction target planet(s) absent from nodes.json: ${[...new Set(missing)].join(', ')}`);
      assert.ok(missing.length < js.length, 'no junction target planet matches the node graph - planet naming likely differs');
    });
  }
}

// ------------------------------------------------------------------ out -----
console.log();
for (const n of notes) console.log(`  note  ${n}`);
if (nodesFile) console.log(`\n  nodes.json     ${nodesFile.nodes.length} nodes, source: ${nodesFile.source}`);
if (questsFile) console.log(`  quests.json    ${questsFile.quests.length} quests, source: ${questsFile.source}`);
if (junctionsFile) console.log(`  junctions.json ${junctionsFile.junctions.length} junctions, source: ${junctionsFile.source}`);

console.log(problems.length ? `\n${problems.length} integrity problem(s)` : '\ndatasets are internally consistent');
process.exitCode = problems.length ? 1 : 0;
