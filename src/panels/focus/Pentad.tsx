import { useRef, useState } from 'react';
import type { CSSProperties, FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { FocusSchoolKey } from '../../data/subsystems';

/**
 * THE PENTAD.
 *
 * WHY THIS IS NOT A LIST
 * ──────────────────────
 * The five focus schools were rendered as five stacked rows, which is how you
 * would draw any five things. But the schools are not any five things — in the
 * game they are laid out as a five-pointed arrangement around the Operator, and
 * a player picks a school by pointing at a position, not by reading down a
 * column. Madurai is where Madurai IS.
 *
 * This is the concrete answer to "every panel is banner, hero, rows": the shape
 * of the content should decide the shape of the layout. Five peers with no
 * ordering, each with an identity and a magnitude, is a radial problem. Making
 * it a list threw away the one structural fact everyone already knows about it.
 *
 * WHAT EACH PART MEANS
 * ────────────────────
 *   - position       fixed, so muscle memory works — Madurai always top
 *   - spoke length   the school's share of your pooled focus
 *   - node size      the same magnitude again, so it reads at a glance
 *   - ink            the school's own energy colour, from the game
 *
 * With no account there are no magnitudes, so the figure drops to its AXES: five
 * full-length arms and their names, no closed web and no nodes. Not zero-length
 * spokes, which would read as "you have nothing" — and not the uniform resting
 * length it used to draw either, because a regular pentagon at half radius is a
 * reading, and the reading it gives is "your five pools are equal".
 *
 * THE FIGURE AND THE LEGEND ARE ONE CONTROL
 * ─────────────────────────────────────────
 * Pointing at a school anywhere lights it up everywhere: hover a spoke and its
 * legend row lifts, hover a legend row and its point in the figure grows. They
 * are two views of the same five things, and a reader should never have to work
 * out which row goes with which arm - especially here, where the arms are
 * arranged by position rather than sorted.
 *
 * Highlighting is DECORATION ONLY. Every school's name, creed and value is on
 * screen at all times and at full contrast; selecting one dims its neighbours
 * but never hides them. The frozen-timeline rule in theme.css applies: the
 * resting look is applied as a plain style value, and the transition only
 * smooths the change to it.
 *
 * WHAT WAS WRONG: THE SELECTION WENT NOWHERE
 * ──────────────────────────────────────────
 * This component pinned a school and then kept the pin to itself, so the click
 * dimmed four arms and changed nothing a reader could read. The panel that hosts
 * it had no handlers at all: five schools on screen and no way to ask about one
 * of them. Selection is now the panel's state and this is a controlled control -
 * picking a school here is what makes the panel compute that school's own
 * numbers, so the click buys something.
 *
 * WHAT WAS WRONG: THE ARMS WERE NOT REALLY CONTROLS
 * ─────────────────────────────────────────────────
 * The arms carried `role="button"` and a tabindex and were reachable one at a
 * time by Tab, which means five tab stops to cross one figure and no way to
 * sweep it. Five mutually exclusive choices is a RADIOGROUP, and the arms and
 * the legend rows are now two radiogroups over the same value: one tab stop
 * each, arrow keys to move between schools, Enter or Space to choose, Escape to
 * clear. The legend's radios are real `button` elements; the figure's cannot be,
 * because SVG has no button element and the alternative - HTML buttons in a
 * `foreignObject` positioned over the geometry - would put the hit targets in a
 * different coordinate system from the thing they are targets for.
 *
 * MOTION: THE FIGURE LEANS TOWARD WHAT YOU ARE REACHING FOR
 * ─────────────────────────────────────────────────────────
 * The lean is written per input event straight onto the group's own custom
 * properties, with NO transition and NO keyframes. That is deliberate and it is
 * the frozen-timeline rule taken seriously rather than worked around: this
 * overlay's document timeline stops while the window is unpresented, so anything
 * with a duration can strand. A transform recomputed on every pointermove has no
 * duration to strand in - it is only ever at the value the last event put it at,
 * and if no event ever arrives it sits at the identity the CSS declares. Nothing
 * is revealed by it, nothing moves more than a few user units, and reduced
 * motion switches it off in CSS rather than in a media query read from script.
 *
 * Writing the properties through a ref instead of through state is not a
 * micro-optimisation: a pointermove-driven React state would re-render five arms
 * and five rows per frame to move one transform that React does not need to know
 * about.
 */

export interface PentadSchool {
  key: FocusSchoolKey;
  name: string;
  creed: string;
  ink: string;
  /** 0..1 share of the pooled total, or null when unmeasured. */
  share: number | null;
  /** Formatted pool, or null. */
  value: string | null;
}

export interface PentadProps {
  schools: readonly PentadSchool[];
  /** The school the panel is currently reporting on. Null is the resting figure. */
  selected: FocusSchoolKey | null;
  onSelect: (key: FocusSchoolKey | null) => void;
}

const SIZE = 300;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_MIN = 46;
const R_MAX = 104;

/**
 * How far the figure leans, in user units out of 300.
 *
 * Small on purpose. The lean is an answer to the pointer, not a parallax toy:
 * past about ten units the labels start to look like they are drifting off their
 * arms, which is the point where motion stops meaning "this is live" and starts
 * meaning "something is broken".
 */
const LEAN = 7;

/** Twelve o'clock, then clockwise — the game's own ordering. */
function angleFor(i: number, n: number): number {
  return (-90 + (360 / n) * i) * (Math.PI / 180);
}

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

export function Pentad({ schools, selected, onSelect }: PentadProps) {
  const n = schools.length || 1;

  /*
   * Measured or not, and it changes what is drawn rather than how brightly.
   *
   * With every share null the figure used to park all five spokes at a uniform
   * resting length and close the web across them — which draws a tidy regular
   * pentagon at half radius. A radar chart's polygon IS its reading, so a
   * regular one is a claim that the five pools are equal, made at a radius
   * nobody measured. Unmeasured now draws the AXES only: the five arms out to
   * full length, their names, and no polygon and no nodes to read a value off.
   *
   * Gated per arm rather than once for the whole figure, so a partially-read
   * account cannot get a node — or a polygon vertex — sitting at an axis end.
   */
  const plotted = schools.every((s) => s.share !== null);

  /*
   * Hover previews, selection persists.
   *
   * Two states rather than one because they answer different questions: the
   * pointer asks "what is this one" and the selection asks "keep this one while
   * I read its numbers elsewhere on the panel". Collapsing them into a single
   * hover state would make the highlight vanish the moment the cursor left the
   * figure, which is exactly when it is being used. Hover stays local because it
   * is a preview and nothing outside this component should recompute for it;
   * the selection belongs to the panel, because the panel is what answers it.
   */
  const [hovered, setHovered] = useState<FocusSchoolKey | null>(null);

  /*
   * Which control has focus, and whether the browser thinks that focus deserves
   * a ring. `where` is not redundant: without it, tabbing to a legend row would
   * draw the ring on the corresponding ARM as well, and a focus indicator that
   * appears in two places at once tells a keyboard user nothing about where they
   * are.
   */
  const [focus, setFocus] = useState<{ where: 'arm' | 'row'; idx: number; ring: boolean } | null>(null);

  const active = hovered ?? selected;

  const armRefs = useRef<Array<SVGGElement | null>>([]);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const figureRef = useRef<SVGGElement | null>(null);

  /*
   * The one tab stop each group gets. Roving: it follows focus while the group
   * has it, so arrowing to an arm and tabbing away and back returns you to the
   * arm you left rather than to the top of the figure.
   */
  const selectedIdx = selected === null ? -1 : schools.findIndex((s) => s.key === selected);
  const anchor = focus?.idx ?? (selectedIdx >= 0 ? selectedIdx : 0);

  /** Per-event, straight onto the node. See the header note on why not state. */
  const lean = (x: number, y: number, scale: number): void => {
    const g = figureRef.current;
    if (g === null) return;
    g.style.setProperty('--rf-lean-x', `${x.toFixed(2)}px`);
    g.style.setProperty('--rf-lean-y', `${y.toFixed(2)}px`);
    g.style.setProperty('--rf-lean-s', scale.toFixed(3));
  };

  const leanToward = (i: number): void => {
    const a = angleFor(i, n);
    lean(Math.cos(a) * LEAN, Math.sin(a) * LEAN, 1.02);
  };

  const rest = (): void => {
    lean(0, 0, 1);
  };

  const onFigureMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    lean(clamp1(nx) * LEAN, clamp1(ny) * LEAN, 1.02);
  };

  const onFocusAt = (where: 'arm' | 'row', i: number) => (e: ReactFocusEvent<Element>) => {
    setFocus({ where, idx: i, ring: e.currentTarget.matches(':focus-visible') });
    leanToward(i);
  };

  const onBlurAt = (): void => {
    setFocus(null);
    rest();
  };

  /**
   * Radiogroup keys, shared by both groups.
   *
   * Arrows MOVE without choosing, which is the variant the panel wants: sweeping
   * the five schools should not fire five recomputations of a dossier nobody
   * asked for. Enter and Space choose. Escape clears, which is how the resting
   * figure — five arms at full contrast, nothing dimmed — is reachable from the
   * keyboard at all.
   */
  const onGroupKey = (e: ReactKeyboardEvent<Element>, where: 'arm' | 'row', i: number): void => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step !== 0) {
      e.preventDefault();
      const next = (i + step + n) % n;
      (where === 'arm' ? armRefs.current[next] : rowRefs.current[next])?.focus();
      return;
    }
    if (e.key === 'Escape' && selected !== null) {
      e.preventDefault();
      onSelect(null);
    }
  };

  const points = schools.map((s, i) => {
    const a = angleFor(i, n);
    // An unmeasured arm runs the full axis. That is the extent of the chart, not
    // a value on it, which is why nothing is drawn at its end.
    const r = s.share === null ? R_MAX : R_MIN + Math.max(0, Math.min(1, s.share)) * (R_MAX - R_MIN);
    return {
      s,
      x: CX + Math.cos(a) * r,
      y: CY + Math.sin(a) * r,
      // Label sits further out than its node so it never collides with it.
      lx: CX + Math.cos(a) * (R_MAX + 26),
      ly: CY + Math.sin(a) * (R_MAX + 26),
    };
  });

  // The web connecting the nodes. Closed, so the five read as one figure rather
  // than five unrelated spokes. Drawn only when there are nodes to connect.
  const web = points.map((p) => `${p.x},${p.y}`).join(' ');

  // Nothing selected means everything is at full strength - the resting figure
  // is unchanged from before this was interactive.
  const dim = (key: FocusSchoolKey): number => (active === null || active === key ? 1 : 0.28);

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
      {/*
       * The figure SCALES. It used to be pinned at 300x300 inside a container
       * measured at 1,087px, so the panel's one hero element sat as a small
       * square adrift in a field of empty space - and its labels, which are
       * placed outside the viewBox, were cramped against it at that size.
       *
       * `viewBox` already makes the drawing resolution-independent; all it
       * needed was to be allowed to fill something. Capped at 420px because past
       * that the five spokes stop reading as one shape and start reading as five
       * separate lines, and `min-w` keeps it from collapsing when the legend
       * wraps beside it on a narrow overlay.
       */}
      {/*
       * `role="radiogroup"`, not `role="img"` and not `role="group"`.
       *
       * `img` asserted the whole subtree was a flat picture, and browsers prune
       * everything inside such a subtree from the accessibility tree - which hid
       * five real controls. `group` fixed that but described the arms as five
       * unrelated buttons, so nothing said they were five choices of one thing,
       * and every one of them was its own tab stop. A radiogroup says what this
       * actually is: pick one of five. One tab stop, arrows to move, Enter or
       * Space to choose.
       */}
      {/*
        `mo-in-scale` and not a fade. The entrance is time-based, so it is
        transform-only by the rule this whole app is built around, and it
        starts at 0.94 rather than at 0: a figure scaled from nothing is a
        figure with no area, which is content hidden by another name. A stopped
        timeline leaves the pentad six per cent small and perfectly readable.
      */}
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mo-in-scale h-auto w-full max-w-[420px] min-w-[240px] shrink basis-[360px]"
        role="radiogroup"
        aria-label="The five focus schools"
        onPointerMove={onFigureMove}
        onPointerLeave={rest}
      >
        <defs>
          <style>{`
            /*
              THE LEAN.

              Declared once here so the resting state is the IDENTITY transform:
              a fallback of 0px/0px/1 in the var() calls means an event that
              never arrives leaves the figure exactly where the geometry put it.
              The custom properties are written per pointer event.

              transform-box: view-box makes the origin below mean user units, so
              150px 150px is the centre of the 300-unit viewBox. If SIZE changes,
              this changes with it.
            */
            .rf-lean {
              transform-box: view-box;
              transform-origin: 150px 150px;
              transform: translate(var(--rf-lean-x, 0px), var(--rf-lean-y, 0px)) scale(var(--rf-lean-s, 1));
            }

            /*
              Transitions live here rather than inline because inline styles
              cannot carry a media query, and the reduced-motion block below has
              to be able to switch them off. They were inline before, which meant
              this figure ignored reduced motion entirely.
            */
            .rf-arm, .rf-pentad-row { transition: opacity 180ms cubic-bezier(0.16, 1, 0.3, 1); }
            .rf-arm-spoke { transition: stroke-width 180ms cubic-bezier(0.16, 1, 0.3, 1); }

            /*
              The node grows by TRANSFORM, not by its own geometry.

              It used to transition x, y, width and height together - four
              properties, none of them compositable, each one a re-layout of the
              shape per frame, and named individually only because "all" would
              have dragged fill into it and a stranded colour transition on a
              frozen timeline holds the wrong hue. One scale about the node's own
              centre says the same thing in one compositable property, and the
              rotation that makes the square a diamond rides along with it.
            */
            .rf-arm-node {
              transform-box: view-box;
              transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
            }

            /*
              THE LEGEND ROW DRIVES ITS OWN PARTS, AND IT HAS TO BE A PLAIN
              RULE TO DO IT.

              Both of the rules below hand a parent's hover down to a child by
              writing --mo-on on it. A Tailwind group-hover variant cannot: v4
              emits utilities into the utilities layer, motion.css is
              unlayered, and an unlayered declaration beats a layered one at
              any specificity - so the variant loses to .mo-underline's own
              --mo-on: 0 and the rule renders, tracks the pointer, and stays
              invisible. This stylesheet is in the document and unlayered, so
              it wins on order.

              The underline takes the SCHOOL'S ink rather than the app accent:
              --rf-row-accent is already set on the row for its leading edge,
              so the rule under Madurai is Madurai red. A gold line under five
              differently coloured names would have read as chrome.
            */
            .rf-pentad-row:hover .rf-pentad-name,
            .rf-pentad-row:focus-visible .rf-pentad-name { --mo-on: 1; }
            .rf-pentad-name::after { background: var(--rf-row-accent, var(--color-orokin-300)); }

            /*
              The swatch turns. It is the same diamond that marks a position
              everywhere in this app, and turning it a further 90 degrees under
              the pointer is the cheapest possible acknowledgement that the row
              is live - no layout, one compositable property, and the resting
              state is a plain 45 degrees that no stopped timeline can take
              away.
            */
            .rf-pentad-mark {
              transform: rotate(45deg);
              transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
            }
            .rf-pentad-row:hover .rf-pentad-mark,
            .rf-pentad-row:focus-visible .rf-pentad-mark { transform: rotate(135deg) scale(1.18); }

            /*
              Vestibular safety is a constraint, not a preference. Switched OFF,
              never shortened: a 0.01ms transition is still a transition, and on
              a timeline that can stop it is still something that can strand.
            */
            @media (prefers-reduced-motion: reduce) {
              .rf-lean { transform: none; }
              .rf-arm, .rf-arm-spoke, .rf-arm-node, .rf-pentad-row { transition: none; }
              .rf-pentad-mark { transform: rotate(45deg); transition: none; }
            }
          `}</style>
        </defs>

        <g ref={figureRef} className="rf-lean">
        {/* Reference rings. Faint, and they are what make a long spoke legible
            as long rather than just as a line. */}
        {[R_MIN, (R_MIN + R_MAX) / 2, R_MAX].map((r) => (
          <circle key={r} cx={CX} cy={CY} r={r} fill="none" stroke="oklch(1 0 0 / 0.055)" strokeWidth={1} />
        ))}

        {/* The closed web — the reading itself, so it exists only when there is
            something to read. */}
        {plotted && (
          <polygon points={web} fill="var(--plate-lift)" stroke="oklch(1 0 0 / 0.10)" strokeWidth={1} />
        )}

        {points.map((p, i) => {
          const on = active === p.s.key;
          const ringed = focus !== null && focus.ring && focus.where === 'arm' && focus.idx === i;
          return (
          <g
            key={p.s.key}
            ref={(el) => {
              armRefs.current[i] = el;
            }}
            className="rf-arm"
            role="radio"
            tabIndex={i === anchor ? 0 : -1}
            aria-checked={selected === p.s.key}
            aria-label={`${p.s.name} — ${p.s.creed}`}
            style={{ cursor: 'pointer', opacity: dim(p.s.key) }}
            onPointerEnter={() => {
              setHovered(p.s.key);
            }}
            onPointerLeave={() => {
              setHovered(null);
            }}
            onFocus={onFocusAt('arm', i)}
            onBlur={onBlurAt}
            onClick={() => {
              onSelect(p.s.key);
            }}
            onKeyDown={(e) => {
              // A `g` gets no native activation, so Enter and Space are handled
              // here. The legend's radios are real buttons and must NOT be, or
              // the key press would both fire this and fire the native click.
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(p.s.key);
                return;
              }
              onGroupKey(e, 'arm', i);
            }}
          >
            {/* An invisible target over the whole arm. The spoke is 1.4px wide
                and the diamond is 10px: without this, hitting a school would be
                a test of aim rather than a control. */}
            <line x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="transparent" strokeWidth={22} strokeLinecap="round" />
            {/* Spoke, in the school's own energy. */}
            <line
              className="rf-arm-spoke"
              x1={CX}
              y1={CY}
              x2={p.x}
              y2={p.y}
              stroke={p.s.ink}
              strokeWidth={on ? 2.4 : 1.4}
              // An axis is structure and still has to be visible; a measured
              // spoke is the reading, so it sits brighter.
              opacity={p.s.share === null ? 0.55 : 0.85}
            />
            {/*
              The keyboard focus ring, DRAWN rather than outlined.
              theme.css gives every `[tabindex]` a gold outline, but an outline
              on an SVG `g` is painted by the browser around a box the arm does
              not really occupy, and on a rotated 1.4px line that lands anywhere
              from invisible to a full-figure rectangle. A ring placed on the
              arm's own endpoint is where the eye already is, and it is gold
              rather than the school's ink so that focus never reads as
              selection.
            */}
            {ringed && (
              <circle
                cx={p.x}
                cy={p.y}
                r={13}
                fill="none"
                stroke="var(--color-orokin-400)"
                strokeWidth={1.6}
                strokeDasharray="3 3"
              />
            )}
            {/* A halo on the selected arm's node, so the figure says which one
                is live even at a glance from across the panel. */}
            {on && p.s.share !== null && (
              <circle
                cx={p.x}
                cy={p.y}
                r={11}
                fill="none"
                stroke={p.s.ink}
                strokeWidth={1}
                opacity={0.5}
              />
            )}
            {/* The node. A diamond, not a circle — everything in this app that
                marks a position is cut. It marks a magnitude, so an unmeasured
                school has none: a diamond parked at a resting radius is a value
                a reader will take off the chart. */}
            {p.s.share !== null && (
            <rect
              className="rf-arm-node"
              x={p.x - 5}
              y={p.y - 5}
              width={10}
              height={10}
              fill={p.s.ink}
              style={{
                transformOrigin: `${p.x}px ${p.y}px`,
                transform: on ? 'rotate(45deg) scale(1.4)' : 'rotate(45deg) scale(1)',
              }}
            />
            )}
            {/* Name, placed radially and anchored by which side it falls on so
                it never overlaps the figure. */}
            <text
              x={p.lx}
              y={p.ly}
              textAnchor={Math.abs(p.lx - CX) < 12 ? 'middle' : p.lx > CX ? 'start' : 'end'}
              dominantBaseline="middle"
              style={{
                fontFamily: 'Bahnschrift, "Segoe UI", system-ui, sans-serif',
                fontSize: 11.5,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fill: p.s.ink,
                paintOrder: 'stroke',
                stroke: 'rgba(2,6,10,0.85)',
                strokeWidth: 3,
              }}
            >
              {p.s.name}
            </text>
          </g>
          );
        })}

        {/* The centre carries the Operator's own mark rather than a number: the
            magnitudes are already in the spokes, and a figure here would compete
            with them. */}
        <circle cx={CX} cy={CY} r={5} fill="none" stroke="oklch(1 0 0 / 0.35)" strokeWidth={1.2} />
        <circle cx={CX} cy={CY} r={1.6} fill="oklch(1 0 0 / 0.55)" />
        </g>
      </svg>

      {/* The creeds, beside the figure. Five identities, read once. */}
      {/* The legend takes every pixel the figure does not. It used to share the
          free space with the figure, which left the five rows crammed into a
          column beside a lot of nothing. */}
      {/* A `div`, not the `ul`/`li` it was: an intervening `li` between a
          radiogroup and its radios is not a required owned element, and some
          assistive tech drops the grouping on that basis. The rows are still a
          list; they are now a list of five choices, which is the stronger
          statement. */}
      <div
        role="radiogroup"
        aria-label="The five focus schools, as a list"
        className="mo-stagger flex min-w-[17rem] grow basis-[22rem] flex-col gap-px"
      >
        {schools.map((s, i) => (
          <button
            key={s.key}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected === s.key}
            tabIndex={i === anchor ? 0 : -1}
            onPointerEnter={() => {
              setHovered(s.key);
            }}
            onPointerLeave={() => {
              setHovered(null);
            }}
            onFocus={onFocusAt('row', i)}
            onBlur={onBlurAt}
            onClick={() => {
              onSelect(s.key);
            }}
            onKeyDown={(e) => {
              onGroupKey(e, 'row', i);
            }}
            data-open={active === s.key}
            /*
             * `rf-row` is already on the document pointer tracker's selector
             * list, so the light costs no `mo-field` here and - more to the
             * point - no React handler per row. No `mo-lift`: `.rf-row:hover`
             * already declares a transform at higher specificity, and two
             * rules writing transform means one of them silently does
             * nothing.
             */
            className="rf-row rf-pentad-row mo-sheen mo-focusable mo-in-up flex w-full items-baseline gap-3 px-2 py-1.5 text-left"
            // The dim is a plain value; only its transition is in the stylesheet
            // above, where a reduced-motion query can reach it. Inline, it could
            // not be switched off at all.
            style={{ '--rf-row-accent': s.ink, opacity: dim(s.key), '--i': i } as CSSProperties}
          >
            <span aria-hidden className="rf-pentad-mark size-2 shrink-0" style={{ background: s.ink }} />
            <span
              className="rf-pentad-name mo-underline w-[7ch] shrink-0 font-[family-name:var(--font-display)] text-[length:var(--text-micro)] font-semibold"
              style={{ color: s.ink }}
            >
              {s.name}
            </span>
            <span className="min-w-0 flex-1 text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
              {s.creed}
            </span>
            <span
              className="numeric shrink-0 text-[length:var(--text-micro)]"
              // Muted, not ghost: an unmeasured dash still has to clear the
              // contrast floor — it is the row's answer, not decoration.
              style={{ color: s.value === null ? 'var(--text-muted)' : 'var(--text)' }}
            >
              {s.value ?? '—'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
