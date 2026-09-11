/**
 * The Origin System, drawn as a transit network.
 *
 * The layout and the reasoning are in `src/data/transit-layout.ts`; the
 * directions considered are in `docs/research/starchart-directions.md`. This
 * file only paints.
 *
 * WHAT IS PAINTED ON, AND WHAT IS NOT
 * ───────────────────────────────────
 * The geometry never moves. Stations sit where the catalog puts them whether the
 * player has cleared everything or nothing, because a map that rearranges itself
 * as you play cannot be learned. The account is INK: cleared stations are
 * filled, locked ones are hollow and dim, and the frontier - the end of the line
 * you can currently reach - is the one thing wearing the signal colour.
 *
 * ONE MOTION LAW: nothing here moves except on the player's own action, and the
 * diagram's entrance is a draw-on of the lines. Under the frozen document
 * timeline an overlay window can stop advancing animations entirely, so every
 * entrance is transform-only or a stroke-dash the compositor settles - never an
 * opacity fade that would strand the diagram invisible. See theme.css.
 */

import { useMemo, useState } from 'react';
import type { TransitMap, Station } from '../../data/transit-layout';
import { LINE_GAP } from '../../data/transit-layout';

export type NodeState = 'cleared' | 'available' | 'locked' | 'objective';

/**
 * What the reader has asked the diagram to bring forward.
 *
 * `null` is every station at full strength, which is the diagram's own resting
 * state and what it always drew. The other three DIM the stations that are not
 * in that state rather than removing them: a transit diagram whose stations
 * disappear stops being a map of the system, and the whole point of the focus
 * is to see the chosen set IN CONTEXT.
 */
export type ChartFocus = 'available' | 'cleared' | 'locked' | null;

/**
 * A line's colour.
 *
 * Derived, not a palette pasted in: the hue is a stable hash of the planet's
 * name, so a new region added to the dataset gets a distinct line without anyone
 * choosing one, and the chroma and lightness stay fixed so no line can shout
 * louder than another. The signal colour is deliberately NOT in this range - it
 * is spent only on the frontier.
 */
export function lineHue(planet: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < planet.length; i++) {
    h ^= planet.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // 200..340: the cold half of the wheel, which leaves warm gold free for the
  // objective and keeps the whole diagram inside the app's existing register.
  return 200 + ((h >>> 0) % 140);
}

const INK = {
  cleared: 'oklch(0.86 0.02 250)',
  locked: 'oklch(0.55 0.02 265)',
  frontier: 'var(--color-tenno-300)',
  objective: 'var(--color-orokin-300)',
  label: 'oklch(0.72 0.015 265)',
};

interface Props {
  map: TransitMap;
  stateOf: (id: string) => NodeState;
  /** Stations one step past the cleared edge: the reachable end of each line. */
  frontier: ReadonlySet<string>;
  objective: string | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Null until the account has been read: the diagram is game data either way. */
  measured: boolean;
  /** Which band of stations the reader asked the diagram to bring forward. */
  focus: ChartFocus;
}

export function TransitChart({ map, stateOf, frontier, objective, selected, onSelect, measured, focus }: Props) {
  const [hover, setHover] = useState<string | null>(null);

  /* Lines whose every station is cleared read as done at a glance: the stroke
     goes solid and pale. A line with work left stays in its own hue. */
  const lineDone = useMemo(() => {
    const done = new Map<string, boolean>();
    for (const line of map.lines) {
      done.set(line.planet, line.stations.length > 0 && line.stations.every((s) => stateOf(s.id) === 'cleared'));
    }
    return done;
  }, [map, stateOf]);

  return (
    /*
      DRAWN AT ITS NATURAL SIZE, NOT SCALED TO FIT.
      `h-full w-full` on a 900x2000 viewBox scales the whole diagram down to the
      height of the pane: 355 stations became a column of grey dots two pixels
      apart, and the one thing a transit diagram has to be is readable. It is a
      large object; the pane scrolls.
    */
    <svg
      className="rf-chart"
      data-focus={focus ?? undefined}
      width={map.width}
      height={map.height}
      viewBox={`0 0 ${String(map.width)} ${String(map.height)}`}
      role="img"
      aria-label="The Origin System as a transit diagram"
      style={{ display: 'block' }}
    >
      <defs>
        {/*
          The draw-on. A transit map is a drawn object, so it arrives by being
          drawn - stroke-dashoffset, which the compositor settles even when the
          document timeline is throttled, unlike an opacity fade that would
          strand the whole diagram invisible.
        */}
        <style>{`
          .rf-line { stroke-dasharray: var(--len); stroke-dashoffset: var(--len); animation: rf-draw 900ms cubic-bezier(0.22, 1, 0.36, 1) forwards; }
          @keyframes rf-draw { to { stroke-dashoffset: 0; } }

          /*
            LIGHT.

            A transit line was a flat stroke, which is why the whole diagram read
            as a diagram rather than as a lit console. Each line now carries a
            halo in its OWN hue, drawn under it: the stroke is the tube and the
            halo is what the tube casts. It is a static filter, so it costs one
            paint and survives a frozen timeline unchanged.
          */
          .rf-track { filter: drop-shadow(0 0 6px var(--glow)) drop-shadow(0 0 14px var(--glow)); }

          /*
            FOCUS AND CONTEXT.

            The single most useful thing a transit map can do: point at one line
            and the others recede, so a route can be followed across a diagram
            with three hundred and fifty stations on it. Pure CSS via :has, and
            hover-driven, so the frozen timeline never enters into it.
          */
          .rf-chart:has(.rf-row-line:hover) .rf-row-line:not(:hover) { opacity: 0.22; }
          .rf-chart:has(.rf-row-line:hover) .rf-links { opacity: 0.18; }
          .rf-row-line, .rf-links { transition: opacity 200ms cubic-bezier(0.16, 1, 0.3, 1); }
          .rf-row-line:hover .rf-track { stroke-width: 9; }
          .rf-row-line .rf-track { transition: stroke-width 200ms cubic-bezier(0.16, 1, 0.3, 1); }

          /* The line's name lifts with it, so the label is part of the object. */
          .rf-row-line .rf-name { transition: fill 200ms cubic-bezier(0.16, 1, 0.3, 1), transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1); }
          .rf-row-line:hover .rf-name { fill: var(--color-orokin-200); transform: translateX(-3px); }

          /*
            THE OBJECTIVE, ALIVE.

            One energy pulse travelling along the line that carries the next
            thing to do. It is the only moving thing on the chart, which is what
            makes it read as the answer rather than as decoration.

            Frozen-timeline safe: the dash pattern is visible at offset 0, so a
            stopped timeline leaves a static gold segment on the line rather
            than nothing at all.
          */
          @keyframes rf-run { to { stroke-dashoffset: -220; } }
          .rf-pulse { stroke-dasharray: 26 194; animation: rf-run 2.6s linear infinite; }

          /* Stations answer the pointer with weight, not just colour. Keyboard
             focus gets the same growth: without this rule a tabbed-to station
             looked identical to every unfocused one, since the name plate
             below is React state and this transform is pure CSS - the two
             have to be driven together or focus loses half of what hover has. */
          .rf-station { transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 220ms cubic-bezier(0.16, 1, 0.3, 1); transform-box: fill-box; transform-origin: center; }
          .rf-station:hover, .rf-station:focus-visible { transform: scale(1.35); }

          /*
            THE FOCUS BAND — a CONTROL, not the pointer.

            Hovering a line already recedes the others, but hover cannot answer
            "show me everywhere I can go right now" across a diagram three
            hundred and fifty stations long: the pointer is on one line at a
            time, and the frontier is scattered across twenty. The panel's
            focus buttons write data-focus on this element and these four rules
            do the rest - no per-station JavaScript, no re-render, one style
            recalculation for the whole diagram.

            DIMMED TO 0.16, NEVER TO ZERO, and never removed. Two reasons, and
            the second is the load-bearing one: a transit diagram whose stations
            vanish stops being a map of the system, and - because this is an
            overlay whose document timeline can stop at any moment - an opacity
            transition that strands mid-flight must strand on the side where the
            content is still legible. It does: the FROM state here is the
            undimmed diagram, so a stopped clock leaves every station at full
            strength, which is exactly what the panel drew before the control
            existed.
          */
          .rf-chart[data-focus='available'] .rf-st-cleared,
          .rf-chart[data-focus='available'] .rf-st-locked { opacity: 0.16; }
          .rf-chart[data-focus='cleared'] .rf-st-available,
          .rf-chart[data-focus='cleared'] .rf-st-locked,
          .rf-chart[data-focus='cleared'] .rf-st-objective { opacity: 0.16; }
          .rf-chart[data-focus='locked'] .rf-st-cleared,
          .rf-chart[data-focus='locked'] .rf-st-available,
          .rf-chart[data-focus='locked'] .rf-st-objective { opacity: 0.16; }
          /* A dimmed station is still a station: it keeps its target and lights
             up under the pointer, so the focus narrows attention rather than
             taking half the diagram away from you. */
          .rf-chart[data-focus] .rf-station:hover,
          .rf-chart[data-focus] .rf-station:focus-visible { opacity: 1; }

          /*
            THE NAME PLATE ARRIVES.
            It appeared instantly, which read as a tooltip rather than as part
            of the diagram. It now rises three pixels into place - transform
            only, and only ever while the pointer or focus is on the station, so
            neither family rule is in play.
          */
          .rf-plate-in { animation: rf-plate-rise 220ms cubic-bezier(0.34, 1.56, 0.64, 1); }
          @keyframes rf-plate-rise { from { transform: translateY(3px); } to { transform: none; } }

          @media (prefers-reduced-motion: reduce) {
            .rf-line { animation: none; stroke-dashoffset: 0; }
            .rf-pulse { animation: none; }
            .rf-plate-in { animation: none; }
            .rf-station, .rf-row-line, .rf-links, .rf-row-line .rf-track, .rf-row-line .rf-name { transition: none; }
            .rf-station:hover, .rf-station:focus-visible { transform: none; }
          }
        `}</style>
      </defs>

      {/* Connectors first, under the lines: an interchange should read as the
          lines meeting, not as a wire passing over them. */}
      <g className="rf-links">
      {map.links.map((link) => (
        <polyline
          key={`${link.from}-${link.to}`}
          points={link.points.map((p) => `${String(p.x)},${String(p.y)}`).join(' ')}
          fill="none"
          stroke={INK.locked}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      </g>

      {map.lines.map((line, i) => {
        const hue = lineHue(line.planet);
        const done = lineDone.get(line.planet) === true;
        const len = Math.max(1, line.x1 - line.x0);
        return (
          <g key={line.planet} className="rf-row-line">
            {/* The line itself: one stroke, its own hue, and the halo it casts. */}
            <line
              className="rf-line rf-track"
              x1={line.x0}
              y1={line.y}
              x2={line.x1}
              y2={line.y}
              stroke={done ? INK.cleared : `oklch(0.68 0.16 ${String(hue)})`}
              strokeWidth={7}
              strokeLinecap="round"
              style={{
                ['--len' as string]: String(len),
                ['--glow' as string]: done
                  ? 'oklch(0.72 0.10 150 / 0.30)'
                  : `oklch(0.68 0.16 ${String(hue)} / 0.34)`,
                animationDelay: `${String(i * 45)}ms`,
                opacity: measured ? 1 : 0.5,
              }}
            />
            {/*
              The objective's own line carries the one moving thing on the chart.
              Rendered only when there IS an objective, so nothing pulses at
              somebody with nothing to do.
            */}
            {objective !== null && line.stations.some((st) => st.id === objective) && (
              <line
                className="rf-pulse"
                x1={line.x0}
                y1={line.y}
                x2={line.x1}
                y2={line.y}
                stroke="var(--color-orokin-200)"
                strokeWidth={3}
                strokeLinecap="round"
                style={{ pointerEvents: 'none' }}
              />
            )}
            {/* The line's name sits at its head, where a transit map puts it. */}
            <text
              className="rf-name"
              x={line.x0 - 12}
              y={line.y + 4}
              textAnchor="end"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 11,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fill: done ? INK.cleared : INK.label,
              }}
            >
              {line.planet}
            </text>
          </g>
        );
      })}

      {/* Stations last, over everything. */}
      {map.lines.flatMap((line) =>
        line.stations.map((s) => (
          <StationMark
            key={s.id}
            station={s}
            state={stateOf(s.id)}
            onFrontier={frontier.has(s.id)}
            isObjective={s.id === objective}
            selected={s.id === selected}
            hovered={hover === s.id}
            onHover={setHover}
            onSelect={onSelect}
          />
        )),
      )}

      {/* The detached block gets a rule and a label rather than a silent gap:
          these regions have no junction, and that is a fact worth stating. */}
      {map.detached.length > 0 && <DetachedRule map={map} />}
    </svg>
  );
}

function DetachedRule({ map }: { map: TransitMap }) {
  const first = map.lines.find((l) => l.planet === map.detached[0]);
  if (!first) return null;
  const y = first.y - LINE_GAP / 2;
  return (
    <g>
      <line x1={40} y1={y} x2={map.width - 40} y2={y} stroke={INK.locked} strokeWidth={1} strokeDasharray="2 6" />
      <text
        x={40}
        y={y - 7}
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 9.5,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          fill: INK.locked,
        }}
      >
        No junction leads here — reached another way
      </text>
    </g>
  );
}

function StationMark({
  station,
  state,
  onFrontier,
  isObjective,
  selected,
  hovered,
  onHover,
  onSelect,
}: {
  station: Station;
  state: NodeState;
  onFrontier: boolean;
  isObjective: boolean;
  selected: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}) {
  const { x, y, interchange } = station;
  const cleared = state === 'cleared';

  const ink = isObjective ? INK.objective : onFrontier ? INK.frontier : cleared ? INK.cleared : INK.locked;
  // An interchange is bigger and hollow, as in every transit diagram ever drawn.
  const r = interchange ? 6.5 : 4;

  return (
    <g
      /*
       * The state is written into the CLASS, not just into the ink.
       *
       * It was already computed for the fill colour and thrown away, so a
       * question like "where can I go right now" could only be answered by the
       * reader's eye scanning three hundred and fifty dots for a particular
       * cyan. With the state on the element, the focus control in the panel
       * above is four CSS rules and no JavaScript at all - which matters here
       * more than anywhere else in the app, because a per-station handler would
       * be 355 of them over a running game.
       */
      className={`rf-station rf-st-${state}`}
      onMouseEnter={() => onHover(station.id)}
      onMouseLeave={() => onHover(null)}
      /*
       * All 355 stations are tabbable, and until now focus was invisible: the
       * name plate below renders only on `hovered`, which the mouse handlers
       * above set but nothing else did, so a keyboard user tabbing through
       * got no station name and, since the growth transform is CSS `:hover`
       * (see the stylesheet above), no size change either - nothing told them
       * where they were. `onFocus`/`onBlur` drive the same `hover` state the
       * pointer does, so a tabbed-to station now shows its name and grows
       * exactly as a hovered one does - the reason `outline: none` below is
       * safe rather than a silent removal.
       */
      onFocus={() => onHover(station.id)}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(selected ? null : station.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(selected ? null : station.id);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`${station.name}, ${station.planet}, ${state}`}
      style={{ cursor: 'pointer', outline: 'none' }}
    >
      {/* A generous invisible target: a 9px dot is a cruel thing to ask anyone
          to hit, and there are 355 of them. */}
      <circle cx={x} cy={y} r={13} fill="transparent" />

      {(selected || isObjective) && (
        <circle
          cx={x}
          cy={y}
          r={r + 5}
          fill="none"
          stroke={isObjective ? INK.objective : INK.frontier}
          strokeWidth={1.25}
          /* Drawn at its final size: a ring that grows via a transition holds
             its FROM value on a frozen timeline and never appears. */
        />
      )}

      {/*
        STATION MARKS, and why they are not all circles.
        A circle at every one of 355 stations, 26px apart, covers the line it
        sits on: the diagram read as a grid of grey dots with no visible
        network. Transit convention solves exactly this - a minor stop is a
        TICK across the line, and only the stops that matter get a full circle.
        So the line stays the dominant object, which is the whole point of
        drawing lines.
      */}
      {interchange ? (
        // An interchange is hollow and large, as in every transit diagram drawn.
        <circle cx={x} cy={y} r={r} fill="oklch(0.11 0.02 265)" stroke={ink} strokeWidth={2.5} />
      ) : cleared || onFrontier || isObjective ? (
        // Somewhere you have been, or somewhere you can go: a full stop.
        <circle cx={x} cy={y} r={r} fill={ink} stroke="oklch(0.11 0.02 265)" strokeWidth={1} />
      ) : (
        // Not open yet: a tick, so the line reads through it.
        <line x1={x} y1={y - 5} x2={x} y2={y + 5} stroke={ink} strokeWidth={2} strokeLinecap="round" />
      )}

      {/* The name appears on hover and on selection only. 355 permanent labels
          is not a diagram, it is a wall of text - the one thing the old orbital
          view and this both had to solve, and the transit answer is the same one
          Beck used: label on demand, and let the line carry the identity. */}
      {(hovered || selected || isObjective) && (
        <g className="rf-plate-in" style={{ pointerEvents: 'none' }}>
          <rect
            x={x - 4}
            y={y - 30}
            width={Math.max(46, station.name.length * 6.4 + 12)}
            height={17}
            fill="oklch(0.11 0.02 265 / 0.94)"
            stroke={ink}
            strokeWidth={0.75}
          />
          <text
            x={x + 2}
            y={y - 18}
            style={{ fontFamily: 'var(--font-display)', fontSize: 10.5, letterSpacing: '0.06em', fill: 'oklch(0.94 0.01 265)' }}
          >
            {station.name}
          </text>
        </g>
      )}
    </g>
  );
}
