/**
 * The star chart.
 *
 * REWRITTEN, NOT RESTYLED. What was here was a WebGL solar system - orbits, a
 * shaded globe you flew between, a planet drill-down. It imitated the game's own
 * screen, which is the weakest thing a companion app can do: the game already
 * draws that, better, and the player opened this because they wanted something
 * the game does not give them.
 *
 * It also encoded nothing. Orbital distance meant nothing; angular position
 * meant nothing; and the unlock graph and the player's frontier - the only two
 * structures that govern play - were both invisible.
 *
 * So the geography is gone. The system is drawn as a transit network: one line
 * per planet, a station per node, junctions as interchanges (the game's own
 * word), and the frontier as the end of the line you can currently reach. The
 * layout, its octilinear rules and the reasoning are in
 * `src/data/transit-layout.ts`; the directions considered and rejected are in
 * `docs/research/starchart-directions.md`; the rules are enforced by
 * `scripts/check-transit.ts` rather than by eye.
 *
 * The drill-down went with the globe. Every one of the 355 stations is on this
 * one surface, so there is nothing to drill into - selecting a station shows it
 * in place, which is one interaction instead of three.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from '../../core/store';
import { derive } from '../../data/progression';
import { buildActions, frontier, routeTo, type Catalog } from '../../data/catalog';
import { recommend } from '../../data/progression';
import { canonFrom, loadCatalog, type LoadedCatalog } from '../../data/datasets';
import { subscribeFocus } from '../../ui/navigation';
import { buildGraph, solve } from '../../data/leverage';
import { buildTransit, type TransitMap } from '../../data/transit-layout';
import type { NodeEntry } from '../../data/vendor/types';
import { TransitChart, lineHue, type ChartFocus, type NodeState } from './TransitChart';
import { RequirementText, buildQuestNameIndex, type QuestNameIndex } from './RequirementText';
import { Facts } from '../../ui/interact';
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { Segmented } from '../shared/Segmented';

function Readout({
  label,
  value,
  sub,
  tone,
  hint,
}: {
  label: string;
  value: string | null;
  sub: string;
  tone?: string;
  hint?: string;
}) {
  return (
    // Pointer-driven only: a readout that lights under the cursor tells you it
    // has a hint worth hovering, which the bare `title` never did.
    <div className="mo-field mo-sheen mo-in-up min-w-0" title={hint}>
      <div className="eyebrow">{label}</div>
      <div
        className="numeric mt-1 text-[length:var(--text-lead)] leading-none"
        style={{ color: value === null ? 'var(--text-muted)' : (tone ?? 'var(--text)') }}
      >
        {value ?? '—'}
      </div>
      <div className="eyebrow mt-1" style={{ color: 'var(--text-faint)' }}>
        {sub}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ the index */

/*
 * THE COMPANION INDEX, AND WHY IT IS NOT THE DIAGRAM PRINTED TWICE.
 * ————————————————————————————————————————————
 * Measured in the running app at 1500x940: this screen put 561 characters on
 * the glass. For 353 missions, a complete prerequisite graph, thirty regions
 * and a route it had already computed. It was the most information-starved
 * surface in the application, and the reason is structural rather than lazy —
 * a station is eight pixels across, so the diagram can carry a dot and nothing
 * else. Everything each node knows about itself had nowhere to go.
 *
 * So the diagram keeps what it is good at and the index carries what it cannot
 * hold. The division is strict and it is the rule these components are written
 * to: WHERE a station sits, which line it belongs to and what state it is in
 * are the dot's job, and no row below repeats them as text. What it IS - the
 * mission, the faction, the tileset, the level band, the mastery it pays, the
 * sentence that gates it, the stations that open it - is the index's job, and
 * none of it was anywhere on this screen before.
 */

/**
 * The level band a run of stations spans, or null when none records one.
 *
 * A 0–0 PAIR IS AN UNRECORDED BAND, NOT A BAND OF ZERO, and it is worth being
 * exact about because it changed a number on screen: 19 of the 353 nodes carry
 * `minLevel: 0, maxLevel: 0` - the hubs and the Conclave rooms, which have no
 * enemies to have a level - and not one node in the dataset pairs a 0 minimum
 * with a real maximum. Counted naively, Iron Wake dragged Earth's whole line
 * down to "levels 0–30" and the reader was told the planet starts at zero.
 */
function levelBand(nodes: readonly NodeEntry[]): string | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const n of nodes) {
    if (n.minLevel === 0 && n.maxLevel === 0) continue;
    if (n.minLevel != null) lo = Math.min(lo, n.minLevel);
    if (n.maxLevel != null) hi = Math.max(hi, n.maxLevel);
  }
  return lo <= hi ? `${String(lo)}–${String(hi)}` : null;
}

/**
 * The facts a station carries that the diagram has no room to draw.
 *
 * Five of the eight fields on a node, and deliberately not the three the dot
 * already says. A missing field is dropped rather than dashed: this run is a
 * description, not a form, and "Tileset —" on two hundred rows is the wallpaper
 * this whole pass exists to remove.
 */
function stationFacts(node: NodeEntry): string[] {
  const out: string[] = [];
  if (node.type != null) out.push(node.type);
  if (node.enemy != null) out.push(node.enemy);
  const band = levelBand([node]);
  if (band !== null) out.push(`level ${band}`);
  if (node.tileset != null) out.push(node.tileset);
  // A 0 in this dataset is an unrecorded payout, not a measured zero - the same
  // reading the detail pane at the foot of this panel already takes.
  if (node.mastery != null && node.mastery > 0) out.push(`${String(node.mastery)} XP`);
  return out;
}

function FactRun({ node }: { node: NodeEntry }) {
  const facts = stationFacts(node);
  if (facts.length === 0) {
    return (
      <span className="eyebrow" style={{ color: 'var(--text-ghost)' }}>
        no mission facts recorded
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
      {facts.map((f, i) => (
        // The mission type leads because it is the one a player filters on; the
        // rest recede so a run of five facts reads as one line, not as five.
        <span key={f} style={{ color: i === 0 ? 'var(--text-muted)' : 'var(--text-faint)' }}>
          {f}
        </span>
      ))}
    </span>
  );
}

/**
 * Depth 2: everything standing between the player and this station.
 *
 * Two different kinds of gate live here and the app used to show only one. The
 * prose requirement was already rendered - on the SELECTED station, one at a
 * time, and nowhere else. The prerequisite stations were never rendered at all,
 * although `catalog.predecessors` is the exact index the frontier walk runs on.
 *
 * The rule that index encodes is worth stating in words, because it is not
 * obvious and it changes what a player does: ANY ONE cleared predecessor opens
 * a station. A reader looking at four blocked entries does not have to clear
 * four of them.
 */
function StationGate({
  node,
  catalog,
  questNames,
  clearedNodes,
  measured,
}: {
  node: NodeEntry;
  catalog: Catalog;
  questNames: QuestNameIndex | null;
  clearedNodes: ReadonlySet<string>;
  measured: boolean;
}) {
  const before = (catalog.predecessors.get(node.id) ?? [])
    .map((id) => catalog.nodeById.get(id))
    .filter((n): n is NodeEntry => n != null);
  const clearedBefore = before.filter((p) => clearedNodes.has(p.id)).length;

  return (
    <Disclosure
      depth={2}
      accent={node.requirements != null ? 'var(--color-signal-warn)' : undefined}
      eyebrow="what opens it"
      summary={
        node.requirements != null
          ? 'Gated by more than the line'
          : before.length === 0
            ? 'Where this line starts'
            : 'Opened by what comes before it'
      }
      answer={
        before.length === 0 ? (
          <span style={{ color: 'var(--text-faint)' }}>nothing precedes it</span>
        ) : (
          <span className="flex flex-wrap items-baseline gap-x-2">
            {/* Absent is not zero: with no account read this says how many lead
                here, which is a fact about the chart, and says nothing at all
                about how many of them are behind the player. */}
            <span style={{ color: 'var(--text-muted)' }}>
              {measured
                ? `${String(clearedBefore)} of ${String(before.length)} cleared`
                : `${String(before.length)} lead here`}
            </span>
            <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
              any one is enough
            </span>
          </span>
        )
      }
    >
      <div className="flex flex-col gap-2 text-[length:var(--text-body)] leading-snug">
        {node.requirements != null && (
          <div style={{ color: 'var(--color-signal-warn)' }}>
            <Clamp lines={2}>
              <RequirementText text={node.requirements} index={questNames} />
            </Clamp>
          </div>
        )}
        {before.length === 0 ? (
          <p style={{ color: 'var(--text-faint)' }}>
            Nothing on the chart comes before it. This is an entry point, and its line begins here.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {before.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-3">
                <span style={{ color: 'var(--text-muted)' }}>{p.name}</span>
                <span className="eyebrow">{p.planet}</span>
                <span
                  className="eyebrow"
                  style={{
                    color: !measured
                      ? 'var(--text-ghost)'
                      : clearedNodes.has(p.id)
                        ? 'var(--color-signal-good)'
                        : 'var(--text-faint)',
                  }}
                >
                  {measured ? (clearedNodes.has(p.id) ? 'cleared' : 'not cleared') : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Disclosure>
  );
}

/** Depth 1: one station, carrying what it is rather than where it is. */
function StationRow({
  node,
  catalog,
  questNames,
  clearedNodes,
  measured,
}: {
  node: NodeEntry;
  catalog: Catalog;
  questNames: QuestNameIndex | null;
  clearedNodes: ReadonlySet<string>;
  measured: boolean;
}) {
  return (
    <Disclosure
      depth={1}
      summary={
        <span className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span style={{ color: 'var(--text)' }}>{node.name}</span>
          {/* The one state fact the diagram genuinely cannot draw: a dimmed dot
              says "not open yet" and never says whether that is the line's
              doing or a quest's. */}
          {node.requirements != null && (
            <span className="eyebrow" style={{ color: 'var(--color-signal-warn)' }}>
              gated
            </span>
          )}
        </span>
      }
      answer={<FactRun node={node} />}
    >
      <StationGate
        node={node}
        catalog={catalog}
        questNames={questNames}
        clearedNodes={clearedNodes}
        measured={measured}
      />
    </Disclosure>
  );
}

/**
 * Depth 0: one line, carrying its own aggregate so a CLOSED row still answers.
 *
 * The lines come in the diagram's own order and the stations in the diagram's
 * own order within them, so the index is an index OF the drawing rather than a
 * second, differently-sorted copy of the data.
 *
 * The cap is per line, which is the point of grouping: Earth's first eight
 * stations without Mars's nineteen in front of them, and what was left out said
 * out loud rather than truncated in silence.
 */
function LineIndex({
  map,
  catalog,
  questNames,
  clearedNodes,
  frontierIds,
  measured,
  openPlanet,
  cap = 8,
}: {
  map: TransitMap;
  catalog: Catalog;
  questNames: QuestNameIndex | null;
  clearedNodes: ReadonlySet<string>;
  frontierIds: ReadonlySet<string>;
  measured: boolean;
  openPlanet: string | null;
  cap?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      {map.lines.map((line) => {
        const nodes = line.stations.map((s) => s.node);
        const band = levelBand(nodes);
        const clearedHere = nodes.filter((n) => clearedNodes.has(n.id)).length;
        const openHere = nodes.filter((n) => frontierIds.has(n.id)).length;
        const shown = line.stations.slice(0, cap);
        return (
          <Disclosure
            key={line.planet}
            depth={0}
            defaultOpen={line.planet === openPlanet}
            eyebrow={`${String(line.stations.length)} stations`}
            summary={line.planet}
            answer={
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                {/*
                  THIRTY DASHES IS A WALL, EVEN WHEN EACH ONE IS HONEST.
                  ————————————————————————————————————————————
                  This row used to read "— of 12 cleared" on every line with no
                  account read: thirty rows whose only content was the same
                  missing fact, restated thirty times, in the pane that is
                  supposed to carry what the diagram cannot. Nothing is lost by
                  dropping it - the denominator is the station count, which the
                  eyebrow on this same row already prints - and the one place
                  that says the account is unread is the strip at the top.
                */}
                {measured && (
                  <span style={{ color: 'var(--color-signal-good)' }}>
                    {String(clearedHere)} of {String(line.stations.length)} cleared
                  </span>
                )}
                {band !== null && <span style={{ color: 'var(--text-faint)' }}>levels {band}</span>}
                {measured && openHere > 0 && (
                  <span style={{ color: 'var(--color-tenno-300)' }}>{String(openHere)} open now</span>
                )}
              </span>
            }
          >
            <div className="flex flex-col">
              {shown.map((s) => (
                <StationRow
                  key={s.id}
                  node={s.node}
                  catalog={catalog}
                  questNames={questNames}
                  clearedNodes={clearedNodes}
                  measured={measured}
                />
              ))}
              {line.stations.length > shown.length && (
                <p className="eyebrow px-3 py-2" style={{ color: 'var(--text-faint)' }}>
                  {String(line.stations.length - shown.length)} more stations on this line, drawn above in the same
                  order
                </p>
              )}
            </div>
          </Disclosure>
        );
      })}
    </div>
  );
}

/**
 * The route, which was already computed and then thrown away.
 *
 * `routeTo` has run on every render of this panel since it was written, and the
 * entirety of its result reached the screen as one word: "away". A player was
 * given a distance and never the path, so the obvious next question - through
 * WHAT? - had no answer anywhere in the application, although the answer was in
 * memory the whole time.
 *
 * `routeTo` starts its walk from a station the player has already cleared, so
 * the first hop is ground covered rather than work. It is kept and marked
 * rather than dropped, because a plan that starts from nowhere is harder to
 * place on the diagram than one that starts somewhere recognisable.
 */
function JourneyPlan({
  route,
  catalog,
  clearedNodes,
}: {
  route: readonly string[];
  catalog: Catalog;
  clearedNodes: ReadonlySet<string>;
}) {
  const hops = route.map((id) => catalog.nodeById.get(id)).filter((n): n is NodeEntry => n != null);
  if (hops.length < 2) return null;
  const firstToDo = hops.findIndex((n) => !clearedNodes.has(n.id));
  const band = levelBand(hops.filter((n) => !clearedNodes.has(n.id)));
  const toDo = hops.filter((n) => !clearedNodes.has(n.id)).length;

  return (
    <section className="flex flex-col gap-1">
      <p className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
        The way there
      </p>
      <p className="text-[length:var(--text-body)]" style={{ color: 'var(--text-muted)' }}>
        {String(toDo)} {toDo === 1 ? 'mission' : 'missions'} you have not cleared
        {band === null ? '' : `, at levels ${band}`}.
      </p>
      <ol className="mt-1 flex flex-col">
        {hops.map((n, i) => {
          const done = clearedNodes.has(n.id);
          const mark = done ? 'behind you' : i === firstToDo ? 'start here' : i === hops.length - 1 ? 'the objective' : null;
          const tone = done ? 'var(--text-faint)' : i === firstToDo ? 'var(--color-tenno-300)' : 'var(--color-orokin-300)';
          return (
            <li key={n.id} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1">
              {/* The same rotated square the diagram draws a station with, in
                  the same line colour, so a hop can be found on the map without
                  the row having to name a coordinate. */}
              <span
                aria-hidden
                className="inline-block size-2 shrink-0 self-center"
                style={{
                  background: `oklch(0.62 0.11 ${String(lineHue(n.planet ?? ''))})`,
                  transform: 'rotate(45deg)',
                  opacity: done ? 0.4 : 1,
                }}
              />
              <span
                className="text-[length:var(--text-body)]"
                style={{ color: done ? 'var(--text-faint)' : 'var(--text)' }}
              >
                {n.name}
              </span>
              <span className="eyebrow">{n.planet}</span>
              {mark !== null && (
                <span className="eyebrow" style={{ color: tone }}>
                  {mark}
                </span>
              )}
              <span className="ml-auto min-w-0">
                <FactRun node={n} />
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default function StarChartPanel() {
  const inventory = useAccount((s) => s.inventory);
  const liveClears = useAccount((s) => s.liveClears);
  const [loaded, setLoaded] = useState<LoadedCatalog | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /*
   * WHICH BAND OF STATIONS TO BRING FORWARD.
   *
   * The diagram already knew each station's state — it painted four different
   * inks with it — and the only way to use that knowledge was to scan three
   * hundred and fifty dots for one colour. This is the control that was
   * missing; the dimming itself is four CSS rules in TransitChart, so choosing
   * a band costs one style recalculation and no per-station work at all.
   */
  const [focus, setFocus] = useState<ChartFocus>(null);

  useEffect(() => {
    let alive = true;
    void loadCatalog().then((c) => {
      if (alive) setLoaded(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  const picture = useMemo(
    () => derive(inventory, loaded ? canonFrom(loaded.status, loaded.catalog) : {}, liveClears),
    [inventory, loaded, liveClears],
  );

  const map = useMemo(() => (loaded ? buildTransit(loaded.catalog) : null), [loaded]);
  const chartRef = useRef<HTMLDivElement>(null);
  // `map` loads asynchronously, so a planet request can arrive before it
  // exists. Refs, not state: neither is ever read by render, only by the
  // scroll below, so tracking them as state would re-render the panel for a
  // value nothing on screen depends on.
  const mapRef = useRef<TransitMap | null>(null);
  const pendingPlanetRef = useRef<string | null>(null);

  // Scroll the diagram to a planet's line, if the diagram exists yet. Returns
  // whether it could.
  function scrollToPlanet(planet: string): boolean {
    const line = mapRef.current?.lines.find((l) => l.planet === planet);
    if (!line) return false;
    chartRef.current?.scrollTo({ top: Math.max(0, line.y - 120) });
    return true;
  }

  // A deep link from another panel: "tracked in detail on the star chart".
  // `subscribeFocus` claims the pending request for EVERY kind passed to it,
  // not just the ones the handler below acts on - claiming 'planet' while
  // only branching on 'node' silently swallowed every planet request (e.g.
  // the "Show Mars on the star chart" link in the quest log): the request
  // was consumed and nothing happened. Planet requests carry a planet name,
  // not a node id, so they cannot select a station the way a node request
  // does; they scroll the diagram to that planet's line instead, once it
  // exists - held in `pendingPlanetRef` when it does not exist yet, and
  // retried by the effect below as soon as `map` arrives.
  useEffect(
    () =>
      subscribeFocus(['node', 'planet'], (req) => {
        if (req.kind === 'node') setSelected(req.id);
        else if (!scrollToPlanet(req.id)) pendingPlanetRef.current = req.id;
      }),
    [],
  );

  useEffect(() => {
    mapRef.current = map;
    if (map && pendingPlanetRef.current) {
      scrollToPlanet(pendingPlanetRef.current);
      pendingPlanetRef.current = null;
    }
  }, [map]);
  const graph = useMemo(() => (loaded ? buildGraph(loaded.catalog) : null), [loaded]);
  const solved = useMemo(
    () => (graph && loaded ? solve(graph, loaded.catalog, picture, 'everything') : null),
    [graph, loaded, picture],
  );

  /*
   * The frontier: what the engine says is open NOW. `frontier()` alone walks
   * only star-chart predecessors, so it admits nodes whose own stated
   * requirement is unmet - which is how Lua used to draw as open while the quest
   * that gates it sat blocked. Band 1 is the engine's verdict and the two must
   * agree, because they are on screen together.
   */
  const frontierIds = useMemo(() => {
    if (!loaded) return new Set<string>();
    const out = new Set<string>();
    for (const n of frontier(loaded.catalog, picture)) {
      const band = solved?.band.get(n.id);
      if (band != null && band !== 1) continue;
      out.add(n.id);
    }
    return out;
  }, [loaded, picture, solved]);

  const objective = useMemo(() => {
    if (!loaded) return null;
    const ranked = recommend(buildActions(loaded.catalog, picture), picture, 24);
    const onChart = ranked.find((a) => (a.kind === 'node' || a.kind === 'junction') && loaded.catalog.nodeById.has(a.id));
    return onChart ?? null;
  }, [loaded, picture]);

  const route = useMemo(
    () => (loaded && objective ? routeTo(loaded.catalog, picture, objective.id) : []),
    [loaded, picture, objective],
  );
  const routeSet = useMemo(() => new Set(route), [route]);

  const questNames = useMemo(
    () => (loaded ? buildQuestNameIndex(loaded.catalog.questByKey.values()) : null),
    [loaded],
  );

  const stateOf = useMemo(() => {
    const cleared = picture.clearedNodes;
    return (id: string): NodeState => {
      if (id === objective?.id) return 'objective';
      if (cleared.has(id)) return 'cleared';
      if (frontierIds.has(id)) return 'available';
      return 'locked';
    };
  }, [picture, frontierIds, objective]);

  const node = selected && loaded ? (loaded.catalog.nodeById.get(selected) ?? null) : null;

  /*
   * WHICH LINE THE INDEX OPENS ON.
   *
   * The objective's own, so the drill lands where the instruction points and a
   * reader who came here to act does not have to find it. With nothing to
   * recommend - no account, or an account that has finished - the first line
   * the diagram draws opens instead, because a column of thirty closed rows
   * teaches nobody what is inside one.
   */
  const objectivePlanet =
    (objective ? loaded?.catalog.nodeById.get(objective.id)?.planet : null) ?? map?.lines[0]?.planet ?? null;

  if (!loaded || !map) {
    return (
      <div className="grid h-full place-items-center">
        <div className="eyebrow">Loading the system</div>
      </div>
    );
  }

  // `nodes.have` is already restricted to nodes this chart contains, and null
  // when the account never carried the field.
  const cleared = picture.nodes.have;
  const total = picture.nodes.total ?? map.stations.size;
  const openRegions = new Set(
    [...frontierIds].map((id) => loaded.catalog.nodeById.get(id)?.planet).filter((p): p is string => !!p),
  ).size;

  return (
    /*
     * ONE SCREEN, TWO PANES, AND NOTHING HANGING OFF THE RIGHT EDGE.
     * ————————————————————————————————————————————
     * THE MEASUREMENT THAT FORCED THIS. Driven through a real browser at
     * 1280x720 with no account read, this panel scrolled SIDEWAYS by 172px.
     * One declaration did it: the index beside the diagram asked for
     * `min-w-[24rem]` inside a flex row whose other child is the 836px diagram,
     * and the diagram is `shrink-0` by necessity - its octilinear geometry is
     * asserted by `scripts/check-transit.ts` and must not be squeezed. 836 + 28
     * + 384 does not fit in the ~1,056px this panel is given at 720p, so the
     * index hung 172px past the window. Sideways overflow is the one failure a
     * screenshot cannot show: the page looks finished and a third of the index
     * is simply not there.
     *
     * The floor existed for a real reason - a `Disclosure` is a
     * `container-type: inline-size` element and contributes zero max-content,
     * so a shrink-to-fit parent collapses it to one letter per line (the trap
     * documented on `.rf-disc`). A GRID TRACK answers that without a floor: a
     * `minmax(0, 5fr)` column is a definite size for the disclosures to lay out
     * against AND is allowed to be narrower than its content wants, which is
     * exactly the pair of properties a flex basis could not give at once.
     *
     * So the shape is the one the Platinum panel already shipped: a fixed-height
     * grid, a header that is pinned and never scrolls away, two panes that
     * scroll inside themselves, and a page that does not scroll at all.
     * `min-h-0` on every row and column of the chain is what makes that true and
     * is the easy thing to leave out - a grid child defaults to
     * `min-height: auto` and refuses to shrink below its content, so one
     * omission anywhere and the page grows again with no visible sign.
     *
     * The diagram keeps its natural size and its own pane scrolls to it, which
     * is what it already did: 1,460px tall was never going to fit a 720p window,
     * and a transit map scaled to fit is a column of grey dots.
     */
    <div
      className={`grid h-full min-h-0 gap-4 p-5 ${node ? 'grid-rows-[auto_minmax(0,1fr)_auto]' : 'grid-rows-[auto_minmax(0,1fr)]'}`}
    >
      {/* ROW ONE: pinned. The instruction, the counts it is measured against,
          and the control that re-inks the diagram. None of it scrolls away,
          because all three are the things the panes below are read against. */}
      <div className="flex min-w-0 flex-col gap-3">
        {/* The objective used to sit in the readout strip as a fourth Readout,
            set at the same --text-lead as Cleared/Open now/Regions - a stat
            beside three other stats. But it is not a measurement, it is an
            instruction (go here next), and disguising it as a fourth count
            buried the one line on this screen that says what to do. It gets
            its own line, above the counts, at title size. */}
        {/*
          AND IT IS ONLY AN INSTRUCTION IF THERE IS AN ACCOUNT BEHIND IT.
          With nothing read, `recommend` runs against an empty picture and returns
          the first mission in the game - so the panel said "go here next: E Prime,
          you can start it now" to a player who may have cleared the whole chart
          years ago. The three counts beside it already say they need the account;
          the line that tells somebody what to do cannot be the one that guesses.
        */}
        {objective && cleared !== null && (
          <div>
            <p className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
              Go here next
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-3">
              <h2
                className="font-[family-name:var(--font-title)] text-[length:var(--text-title)] leading-none tracking-[0.04em]"
                style={{ color: 'var(--color-orokin-200)' }}
              >
                {objective.title}
              </h2>
              <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
                {route.length > 1
                  ? `${String(route.length - 1)} station${route.length === 2 ? '' : 's'} away`
                  : 'you can start it now'}
              </span>
            </div>
          </div>
        )}

        {/* The readouts lead, because the number a glance should learn is how much
            of the system is behind you and how much is open right now. */}
        <div className="flex flex-wrap items-start gap-x-7 gap-y-3">
          {/*
            THREE DASHES ARE NOT THREE READOUTS.
            ————————————————————————————————————————————
            Measured at 1280x720 with no account read: the first thing on this
            screen was a row of three em dashes under three labels, and a
            paragraph below them explaining that all three were unread. Four
            elements, one fact. A reader learns nothing from the SHAPE of an
            unknown number, so reserving the strip for it spends the top of the
            screen on a form nobody can fill in.

            So the strip appears once there is something in it, and until then
            the same width carries the one sentence that says why - plus what the
            diagram DOES know without an account, which is not nothing: the
            station count and the number of lines are facts about the chart. What
            each readout will say is one press away rather than three dashes
            away, and the hover hints that were `title` attributes nobody could
            discover are now written out there.
          */}
          {cleared !== null ? (
            <>
              <Readout
                label="Cleared"
                value={`${String(cleared)} / ${String(total)}`}
                sub="stations on this diagram"
              />
              {/*
                Both of these used to print `frontierIds.size` / `openRegions`
                unconditionally, even with `inventory` null. `frontier()` walks
                star-chart predecessors against `picture.clearedNodes`, and with
                no account that set is simply empty (not "unknown") - so it
                happily returned every prerequisite-free station as open, and a
                count of the regions holding them. That is a confident number
                computed from a premise ("nothing is cleared") that is not the
                truth ("we have not read your account"). All three now live
                inside one `cleared !== null` branch rather than each carrying
                its own guard, so they cannot drift apart again: the strip is
                either three measurements or it is not on the screen.
              */}
              <Readout
                label="Open now"
                value={String(frontierIds.size)}
                tone="var(--color-tenno-300)"
                sub={frontierIds.size === 1 ? 'mission you can start' : 'missions you can start'}
                hint="Stations whose prerequisite you have cleared and whose own stated requirement the engine could confirm."
              />
              <Readout
                label="Regions"
                value={String(openRegions)}
                sub={openRegions === 1 ? 'holds one of them' : 'hold one of them'}
              />
            </>
          ) : (
            /*
              THE ONE PLACE THIS SCREEN SAYS IT HAS NOT READ THE ACCOUNT.

              There were four: three sub-lines under the readouts and a fourth,
              longer, where the filter goes. Four statements of one fact is the
              shape that turns an honest panel into wallpaper - the eye stops on
              the third copy and reads none of them.

              So the convention is stated once, for the whole screen, and every
              dash below it - in the line index, in a station's prerequisites - is
              covered by it. Nothing is softened: it still says the dash is
              unknown rather than none, and it still says what would settle it.
            */
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="wf-prose" style={{ color: 'var(--color-signal-warn)' }}>
                Nothing has been read from your account yet, so this screen cannot say what you have cleared — that comes
                from the game, and running Warframe once fills it in. The {String(total)} stations on this diagram, their
                missions and their gates are facts about the chart and are drawn either way.
              </p>
              <Disclosure
                accent="var(--color-signal-warn)"
                eyebrow="what fills in"
                summary="Three counts, once the game has run"
                answer="what each one measures"
              >
                <ul className="flex flex-col gap-1.5">
                  {[
                    {
                      label: 'Cleared',
                      text: `How many of the ${String(total)} stations on this diagram are behind you.`,
                    },
                    {
                      label: 'Open now',
                      text: 'Missions you can start: stations whose prerequisite you have cleared and whose own stated requirement the engine could confirm.',
                    },
                    { label: 'Regions', text: 'How many of the lines below hold one of those missions.' },
                  ].map((r) => (
                    <li key={r.label} className="flex min-w-0 flex-wrap items-baseline gap-x-3">
                      <span className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
                        {r.label}
                      </span>
                      <span className="wf-note min-w-0">{r.text}</span>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            </div>
          )}
          <div
            /*
             * `w-[34ch] shrink-0`, AND THE MISSING FLOOR WAS THE UGLIEST THING ON
             * THIS SCREEN.
             * ————————————————————————————————————————————
             * This was `ml-auto max-w-[36ch] self-center`: a maximum with no
             * minimum, in a flex row. Once the three readouts and the gaps had
             * taken the width, flex shrank this item to ZERO and its text wrapped
             * one character per line - measured in the running app at width 0,
             * height 524. So it was invisible as a panel, ran off the right edge
             * as a vertical column of single letters, AND inflated the header row
             * to 548px, which is where the enormous empty band above the diagram
             * came from and why the 1460px chart was left 250px to draw in.
             *
             * One missing width floor produced the void, the squeeze and the
             * stray glyphs at once. A definite basis with `shrink-0` lets the
             * row wrap it onto its own line when the readouts fill the width,
             * which is what it should have done in the first place.
             */
            className="mo-field mo-sheen ml-auto w-[34ch] max-w-full shrink-0 self-center"
          >
            {/*
              The one sentence that says what KIND of drawing this is. It is
              orientation, worth reading once and never worth re-reading, so it
              states its claim on the closed row and keeps the explanation one
              press down instead of parking three lines beside the counts.
            */}
            <Disclosure
              summary="Not a map of space"
              eyebrow="how to read this"
              answer="what it does encode"
              accent="var(--color-tenno-300)"
            >
              <div className="text-[length:var(--text-micro)] leading-snug" style={{ color: 'var(--text-faint)' }}>
                <Clamp lines={2}>
                  Distance and position carry no meaning here — only what connects to what, and where you have got to.
                </Clamp>
              </div>
            </Disclosure>
          </div>
        </div>

        {/* The sentence that used to sit here - "every dash on this screen is
            unread, not zero" - now stands in the readout strip's own place,
            because that is where the dashes were. One fact, one element, one
            position on the screen. */}

        {/*
          THE FOCUS CONTROL.

          Offered only once there is an account behind it: "open now" and "not
          open yet" are both claims about the player, and with nothing read every
          station would fall into the locked band — a filter answering entirely
          from our own missing data. The line above has already said why it is
          missing, so the row simply does not appear rather than repeating it.
        */}
        {cleared !== null && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
              Bring forward
            </span>
            <Segmented
              label="Which stations to bring forward"
              value={focus ?? 'all'}
              onChange={(id) => {
                setFocus(id === 'all' ? null : (id as ChartFocus));
              }}
              accent="var(--color-tenno-300)"
              options={[
                { id: 'all', label: 'Everything', badge: map.stations.size, hint: 'The whole system at full strength' },
                {
                  id: 'available',
                  label: 'Open now',
                  badge: frontierIds.size,
                  hint: 'Stations you can start, plus the one to go to next',
                },
                { id: 'cleared', label: 'Cleared', badge: cleared, hint: 'Stations behind you' },
                {
                  id: 'locked',
                  label: 'Not open yet',
                  // Derived, not counted twice: everything that is neither
                  // cleared nor on the frontier. Kept above zero so a completed
                  // chart does not offer a band with nothing in it.
                  badge: Math.max(0, map.stations.size - cleared - frontierIds.size),
                  hint: 'Stations whose prerequisite you have not cleared',
                },
              ]}
            />
          </div>
        )}
      </div>

      {/*
        THE DIAGRAM, AND BESIDE IT THE THINGS IT CANNOT HOLD.
        ————————————————————————————————————————————
        The index goes beside the diagram rather than under it: a companion
        1,460 pixels below the thing it accompanies is one nobody scrolls to,
        and this way the two are read together - a hop in the plan, the same
        station on the map.

        This was ONE scroller holding a flex row, which is the arrangement the
        comment on the root records as overflowing the window. Two grid TRACKS
        instead, each scrolling inside itself. `min-w-0` and `min-h-0` on both
        are load-bearing: without them a grid item's automatic minimum is its
        content, both panes grow to the 836px diagram and the index, and the
        panel is exactly as wide and as tall as it was before.

        The chart is alone in its scroller, which `scrollToPlanet` depends on:
        it scrolls that container to a line's own y, and that only stays true
        while the diagram starts at the top of it.
      */}
      <div className="grid min-h-0 grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-5">
        <div ref={chartRef} className="min-h-0 min-w-0 overflow-auto">
          <TransitChart
            map={map}
            stateOf={stateOf}
            frontier={frontierIds}
            objective={objective?.id ?? null}
            selected={selected}
            onSelect={setSelected}
            measured={cleared !== null}
            focus={focus}
          />
        </div>

        {/* The reference pane. Thirty lines and 355 stations are legitimately
            long, so they scroll HERE - what they may no longer do is push the
            instruction at the top of the screen out of the window. */}
        <div className="mo-in-up flex min-h-0 min-w-0 flex-col gap-5 overflow-y-auto pr-1">
          {/* The route is an instruction, so it is not behind a press. It is
              also a claim about the player, so it appears only once there is
              an account to make it from. */}
          {cleared !== null && (
            <JourneyPlan route={route} catalog={loaded.catalog} clearedNodes={picture.clearedNodes} />
          )}

          <section className="flex min-w-0 flex-col gap-1">
            <p className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
              Every line, station by station
            </p>
            <p className="wf-note">The dots carry where a station is. These carry what it is.</p>
            <div className="mt-1">
              <LineIndex
                map={map}
                catalog={loaded.catalog}
                questNames={questNames}
                clearedNodes={picture.clearedNodes}
                frontierIds={frontierIds}
                measured={cleared !== null}
                openPlanet={objectivePlanet}
              />
            </div>
          </section>
        </div>
      </div>

      {/* The selected station, in place. There is no planet to open: every
          station in the system is already on the diagram above. */}
      {node && (
        <div
          /* The third grid row, and it only exists while a station is
             selected - the template above adds the `auto` track with it, so an
             empty band never reserves height or a gap. The negative margins
             put it back against the panel edges the root's own padding pulled
             it in from, which is what makes it read as a band under the panes
             rather than as another card inside them. */
          className="mo-in-up -mx-5 -mb-5 border-t px-5 py-4"
          style={{ borderColor: 'oklch(1 0 0 / 0.08)', background: 'oklch(0.11 0.02 265 / 0.6)' }}
        >
          <div className="flex flex-wrap items-baseline gap-3">
            <span
              aria-hidden
              className="inline-block size-2.5 shrink-0"
              style={{
                background: `oklch(0.62 0.11 ${String(lineHue(node.planet ?? ''))})`,
                transform: 'rotate(45deg)',
              }}
            />
            <h2
              className="font-[family-name:var(--font-title)] text-[length:var(--text-lead)] tracking-[0.14em] uppercase"
              style={{ color: 'var(--text)' }}
            >
              {node.name}
            </h2>
            <span className="eyebrow">{node.planet}</span>
            <span
              className="eyebrow"
              style={{
                color:
                  stateOf(node.id) === 'cleared'
                    ? 'var(--color-signal-good)'
                    : stateOf(node.id) === 'locked'
                      ? 'var(--text-muted)'
                      : 'var(--color-tenno-300)',
              }}
            >
              {stateOf(node.id) === 'cleared'
                ? 'Cleared'
                : stateOf(node.id) === 'locked'
                  ? 'Not open yet'
                  : routeSet.has(node.id)
                    ? 'On your route'
                    : 'You can start this'}
            </span>
            <button
              type="button"
              className="rf-link ml-auto text-[length:var(--text-micro)]"
              onClick={() => setSelected(null)}
            >
              Close
            </button>
          </div>

          {/*
            THE STATION, NESTED — the mission is the subject, so it is the one
            section that opens by itself.

            Both blocks used to print at once under the heading, and the access
            requirement is the longer of the two by far ("Must have Whispers in
            the Walls completed to access"), so on a locked station the panel's
            last word was a paragraph rather than the mission facts somebody
            clicked the station to read. The requirement is still one press
            away, and its own summary states that there IS one — a gate you
            cannot see is worse than a gate you have to open.
          */}
          <div className="mt-3">
            <Disclosure defaultOpen depth={1} eyebrow="mission" summary="What this station is" answer={node.type ?? 'type not in the catalog'}>
              <Facts
                items={[
                  { label: 'Mission', value: node.type ?? null },
                  { label: 'Faction', value: node.enemy ?? null },
                  { label: 'Tileset', value: node.tileset ?? null },
                  {
                    label: 'Level',
                    value:
                      node.minLevel != null && node.maxLevel != null
                        ? `${String(node.minLevel)}–${String(node.maxLevel)}`
                        : null,
                  },
                  // A 0 in this dataset is an unrecorded payout, not a measured zero.
                  { label: 'Mastery', value: node.mastery != null && node.mastery > 0 ? `${String(node.mastery)} XP` : null },
                ]}
                columns={3}
              />
            </Disclosure>

            {node.requirements && (
              <Disclosure
                depth={1}
                accent="var(--color-signal-warn)"
                eyebrow="access"
                summary="This station is gated"
                answer="what unlocks it"
              >
                <div className="text-[length:var(--text-micro)] leading-relaxed" style={{ color: 'var(--color-signal-warn)' }}>
                  <Clamp lines={2}>
                    <RequirementText text={node.requirements} index={questNames} />
                  </Clamp>
                </div>
              </Disclosure>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
