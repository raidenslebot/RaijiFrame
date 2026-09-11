import { useMemo, useState, type CSSProperties } from 'react';
import { DOMAIN_LABEL, type Domain, type RankedPursuit } from '../../data/pursuits';
import { Clamp } from '../../ui/Disclosure';

/**
 * THE COMPLETION WHEEL.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The board answers "what should I do next" well and "how am I doing overall"
 * not at all. Sixty-two rows of small grey text is a spreadsheet: correct,
 * scannable, and completely flat. There was no moment on the panel where the
 * shape of the whole account was legible in one look, and no single element
 * carrying the visual weight.
 *
 * So this is the hero. One ring, sixteen arcs, one per domain of the game, each
 * arc's ANGULAR LENGTH proportional to how many pursuits that domain contains
 * and its FILL proportional to how much of it is done. The whole game, its
 * proportions, and your position in it, in one shape.
 *
 * IT IS ALSO THE NAVIGATION
 * ─────────────────────────
 * Every arc is a real control: click it and the board below filters to that
 * domain. A chart that is only decoration on a panel this dense would be waste;
 * making it the primary way to move around the board is what earns it the space.
 * This is the one place the design spends boldness — everything below stays
 * deliberately quiet so this reads first.
 *
 * HONESTY
 * ───────
 * An unmeasured pursuit is drawn as a HATCHED segment, never as empty track.
 * Empty track means "none of this is done", and for a domain the game does not
 * expose we have no basis for that claim. The three states — done, remaining,
 * unmeasurable — are visually distinct, and the centre reports how much of the
 * board is measurable at all rather than quietly averaging over the gaps.
 */

/** Whole percent that never rounds a started thing to 0% or an unfinished one to 100%. */
function pct(ratio: number): string {
  const n = Math.round(ratio * 100);
  if (ratio > 0 && n === 0) return '<1%';
  if (ratio < 1 && n === 100) return '99%';
  return `${String(n)}%`;
}

export interface CompletionWheelProps {
  pursuits: readonly RankedPursuit[];
  /** Currently filtered domains. Empty means no filter. */
  active: ReadonlySet<Domain>;
  onPick: (d: Domain) => void;
}

const SIZE = 260;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_OUT = 118;
const R_IN = 84;
/** Degrees of empty space between adjacent domain arcs. */
const GAP_DEG = 2.4;

const HUE: Record<Domain, string> = {
  narrative: 'oklch(0.83 0.105 90)',
  starchart: 'oklch(0.83 0.105 90)',
  endgame: 'oklch(0.68 0.16 300)',
  mastery: 'oklch(0.78 0.115 228)',
  collection: 'oklch(0.78 0.115 228)',
  mods: 'oklch(0.70 0.10 210)',
  relics: 'oklch(0.70 0.10 210)',
  arcanes: 'oklch(0.70 0.10 210)',
  operator: 'oklch(0.72 0.13 268)',
  railjack: 'oklch(0.72 0.13 268)',
  nemesis: 'oklch(0.63 0.18 27)',
  syndicate: 'oklch(0.76 0.14 152)',
  events: 'oklch(0.80 0.15 72)',
  routine: 'oklch(0.76 0.14 152)',
  economy: 'oklch(0.76 0.14 152)',
  codex: 'oklch(0.62 0.03 265)',
};

/** Point on a circle. -90deg so the ring starts at twelve o'clock. */
function pt(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
}

/** An annular sector: the only primitive this chart needs. */
function sector(from: number, to: number, rIn: number, rOut: number): string {
  const large = to - from > 180 ? 1 : 0;
  const [x1, y1] = pt(CX, CY, rOut, from);
  const [x2, y2] = pt(CX, CY, rOut, to);
  const [x3, y3] = pt(CX, CY, rIn, to);
  const [x4, y4] = pt(CX, CY, rIn, from);
  return [
    `M ${x1} ${y1}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rIn} ${rIn} 0 ${large} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

interface Slice {
  domain: Domain;
  from: number;
  to: number;
  count: number;
  measured: number;
  /** Mean progress over the measured pursuits, or null if none are. */
  progress: number | null;
}

export function CompletionWheel({ pursuits, active, onPick }: CompletionWheelProps) {
  const [hot, setHot] = useState<Domain | null>(null);

  const { slices, measurable, total, overall } = useMemo(() => {
    const byDomain = new Map<Domain, RankedPursuit[]>();
    for (const p of pursuits) {
      const list = byDomain.get(p.domain);
      if (list) list.push(p);
      else byDomain.set(p.domain, [p]);
    }

    const entries = [...byDomain.entries()].sort((a, b) => DOMAIN_LABEL[a[0]].localeCompare(DOMAIN_LABEL[b[0]]));
    const n = entries.length;
    const totalCount = pursuits.length || 1;
    // Gaps are taken out of the circle before proportioning, so every arc keeps
    // its true share of what remains.
    const usable = 360 - GAP_DEG * n;

    /*
     * Built with an explicit loop rather than `.map()` with accumulators.
     *
     * A map callback that also mutates variables captured from its enclosing
     * scope is an impure callback — the React Compiler lint flags it, and it is
     * genuinely fragile: the result depends on the callback running exactly once
     * per element, in order, which `.map()` promises but which stops being
     * obvious the moment anyone touches this. A loop says what it does.
     */
    const out: Slice[] = [];
    let cursor = 0;
    let measuredCount = 0;
    let progressSum = 0;

    for (const [domain, list] of entries) {
      const span = (list.length / totalCount) * usable;
      const from = cursor;
      cursor += span + GAP_DEG;

      const withValue = list.filter((p) => p.progress != null);
      measuredCount += withValue.length;

      let domainSum = 0;
      for (const p of withValue) domainSum += p.progress!;
      progressSum += domainSum;

      out.push({
        domain,
        from,
        to: from + span,
        count: list.length,
        measured: withValue.length,
        progress: withValue.length > 0 ? domainSum / withValue.length : null,
      });
    }

    return {
      slices: out,
      measurable: measuredCount,
      total: pursuits.length,
      // Averaged over what is MEASURABLE, not over the whole board. Dividing by
      // 62 when only 14 can be measured would report a number that falls as we
      // add pursuits we cannot yet track, which is backwards.
      overall: measuredCount ? progressSum / measuredCount : null,
    };
  }, [pursuits]);

  const focused = hot ? slices.find((s) => s.domain === hot) ?? null : null;

  return (
    // Wraps rather than squeezing: docked beside the rail this panel is often
    // under 700px, and a fixed row forced the heading to break mid-phrase.
    /*
     * `mo-field` on the WRAPPER, not on the svg.
     *
     * The document-level pointer tracker writes `--mxp/--myp/--mdx/--mdy` onto
     * whichever element matches its selector, and those properties inherit - so
     * one class on the container serves every effect inside it, including the
     * ones drawn on the text column, with no per-element handler. Putting it on
     * the svg instead would have left the half of this component that is plain
     * HTML with no field at all.
     */
    <div className="mo-field flex flex-wrap items-center gap-x-7 gap-y-5">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        /*
         * `mo-in-scale` starts at 0.94, never at 0. A ring that grows from
         * nothing is a ring reading "0% done" for as long as the document
         * timeline is frozen, and this ring's geometry IS the measurement - the
         * same argument the `d` attribute below is left un-transitioned for.
         */
        className="mo-in-scale shrink-0"
        role="group"
        aria-label="Completion by domain"
      >
        <defs>
          {/* Hatching for the unmeasurable share. A distinct TEXTURE rather than
              a third colour: colour already means domain here, and adding a
              fourth meaning to it would break the legend. */}
          <pattern id="cw-unmeasured" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="5" height="5" fill="oklch(1 0 0 / 0.03)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="oklch(1 0 0 / 0.14)" strokeWidth="1.4" />
          </pattern>
        </defs>

        {slices.map((s) => {
          const isHot = hot === s.domain;
          const isOn = active.has(s.domain);
          const dim = (hot != null && !isHot) || (active.size > 0 && !isOn);
          // Hovered arcs grow outward slightly. The ring stays concentric, so
          // the growth reads as the segment lifting toward the viewer.
          const rOut = R_OUT + (isHot ? 7 : 0);
          const measuredFrac = s.count ? s.measured / s.count : 0;
          // The measured share occupies the leading part of the arc; the
          // unmeasurable remainder is hatched.
          const split = s.from + (s.to - s.from) * measuredFrac;
          const fillTo = s.from + (split - s.from) * (s.progress ?? 0);

          return (
            <g
              key={s.domain}
              style={{
                cursor: 'pointer',
                opacity: dim ? 0.32 : 1,
                            /*
                 * The default focus ring is suppressed here, and ONLY here,
                 * because a browser outline on an SVG group is drawn around the
                 * group's bounding BOX — for a thin arc near the top of the ring
                 * that is a tall rectangle floating outside the chart.
                 *
                 * This is not dropping the focus indicator: `onFocus` sets the
                 * same hover state as the pointer, so a keyboard-focused arc
                 * still lifts, keeps full opacity while every other arc dims to
                 * 32%, and names itself in the centre of the ring. That is a
                 * stronger indicator than the outline it replaces.
                 */
                outline: 'none',
              }}
              onPointerEnter={() => setHot(s.domain)}
              onPointerLeave={() => setHot((h) => (h === s.domain ? null : h))}
              onFocus={() => setHot(s.domain)}
              onBlur={() => setHot((h) => (h === s.domain ? null : h))}
              onClick={() => onPick(s.domain)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPick(s.domain);
                }
              }}
              tabIndex={0}
              role="button"
              aria-pressed={isOn}
              aria-label={`${DOMAIN_LABEL[s.domain]}, ${s.count} pursuits, ${s.measured} measurable`}
            >
              {/*
               * An inner band in the domain's own colour, drawn for EVERY arc
               * regardless of how much is measurable.
               *
               * Without it a domain the game does not expose is pure hatch, and
               * with an empty account the whole ring collapses into one grey
               * donut — sixteen distinct things rendered as one. The band keeps
               * the ring legible as a taxonomy even when it has no progress to
               * report, which is exactly the state a new player sees first.
               */}
              <path d={sector(s.from, s.to, R_IN, R_IN + 4)} fill={HUE[s.domain]} opacity={0.55} />

              {/* Remaining-but-measurable: the domain's colour at low alpha. */}
              <path d={sector(s.from, split, R_IN + 4, rOut)} fill={HUE[s.domain]} opacity={0.16} />
              {/* Not measurable: hatched, never empty. */}
              {measuredFrac < 1 && <path d={sector(split, s.to, R_IN + 4, rOut)} fill="url(#cw-unmeasured)" />}
              {/* Done. */}
              {fillTo > s.from + 0.05 && (
                <path
                  d={sector(s.from, fillTo, R_IN + 4, rOut)}
                  fill={HUE[s.domain]}
                  /* NO TRANSITION ON `d`. This wedge's geometry IS the measurement.
                 A transition holds its FROM value on a frozen document timeline,
                 and the timeline is frozen exactly when a new inventory arrives
                 (the game has focus, not the overlay) - so the hero element of
                 this panel would sit showing yesterday's completion, forever,
                 with nothing to say it was stale. It also lagged the three
                 sibling paths in this group by 400ms on hover, which tore.
                 No growth animation is safe here: a value-carrying shape must
                 degrade to "slightly offset", and an arc growing from zero
                 degrades to "0% done", which is a fabricated number. */
                />
              )}
              {/* An outer hairline on the selected domain, so an active filter is
                  visible without hovering. */}
              {isOn && (
                <path d={sector(s.from, s.to, rOut - 2, rOut)} fill={HUE[s.domain]} opacity={0.9} />
              )}
            </g>
          );
        })}

        {/* Centre readout. Switches to the hovered domain, which is what makes
            the ring readable without a legend. */}
        <text
          x={CX}
          y={focused ? CY - 8 : CY - 4}
          textAnchor="middle"
          style={{
            fontFamily: 'Bahnschrift, "Segoe UI", system-ui, sans-serif',
            fontSize: focused ? 15 : 30,
            fontWeight: 300,
            fill: focused ? 'var(--color-tenno-200)' : 'var(--text)',
            letterSpacing: focused ? '0.1em' : '-0.01em',
          }}
        >
          {focused
            ? DOMAIN_LABEL[focused.domain].toUpperCase()
            : overall != null
              ? pct(overall)
              : '—'}
        </text>

        <text
          x={CX}
          y={focused ? CY + 14 : CY + 16}
          textAnchor="middle"
          style={{
            fontFamily: 'Bahnschrift, "Segoe UI", system-ui, sans-serif',
            fontSize: 12,
            letterSpacing: '0.16em',
            fill: 'var(--text-muted)',
          }}
        >
          {focused
            ? `${focused.count} PURSUITS`
            : active.size > 0
              ? 'FILTERING THE BOARD'
              : overall != null
                ? 'OF WHAT IS MEASURABLE'
                : 'NOT YET MEASURED'}
        </text>

        {!focused && active.size > 0 && (
          <text
            x={CX}
            y={CY + 30}
            textAnchor="middle"
            style={{
              fontFamily: 'Bahnschrift, "Segoe UI", system-ui, sans-serif',
              fontSize: 12,
              letterSpacing: '0.16em',
              fill: 'var(--color-tenno-300)',
            }}
          >
            {[...active].map((d) => DOMAIN_LABEL[d]).join(' · ').toUpperCase()}
          </text>
        )}

        {focused && (
          <text
            x={CX}
            y={CY + 30}
            textAnchor="middle"
            style={{
              fontFamily: 'Bahnschrift, "Segoe UI", system-ui, sans-serif',
              fontSize: 12,
              letterSpacing: '0.12em',
              fill: focused.measured ? 'var(--color-signal-good)' : 'var(--color-signal-warn)',
            }}
          >
            {focused.measured
              ? `${focused.measured} MEASURABLE`
              : 'NONE MEASURABLE'}
          </text>
        )}
      </svg>

      <div className="min-w-[280px] flex-1">
        {/*
          `mo-parallax` is scroll-driven, so it has no clock to be stranded in.
          The heading drifts a few pixels slower than the ring beside it as the
          panel scrolls, which is what makes the two read as layered rather than
          painted on one plane. Transform only: a heading that is never scrolled
          to sits 14px high and completely legible.
        */}
        <h2
          className="mo-parallax font-[family-name:var(--font-title)] text-[length:var(--text-lead)] leading-tight tracking-[0.16em] whitespace-nowrap uppercase"
          style={{ color: 'var(--color-orokin-200)' }}
        >
          The whole game
        </h2>

        {/*
          Clamped, not cut. Two lines of explanation under a heading is where a
          wall starts: this paragraph, the three figures and the legend below it
          are four blocks of prose-shaped text stacked in 200px, and the
          paragraph is the only one nobody rereads. `-webkit-line-clamp` is a
          layout property, so the frozen timeline cannot touch it.
        */}
        <div className="mt-2 max-w-[52ch] text-[length:var(--text-small)] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          <Clamp lines={1}>
            Every pursuit Warframe contains, sized by how much of the game it is. Pick an arc to narrow the
            board above.
          </Clamp>
        </div>

        <div className="mo-stagger mt-5 flex flex-wrap gap-x-7 gap-y-3">
          <Figure i={0} label="Pursuit types" value={String(total)} />
          <Figure
            i={1}
            label="Measurable now"
            value={`${measurable}`}
            tone={measurable ? 'var(--color-signal-good)' : 'var(--color-signal-warn)'}
          />
          <Figure i={2} label="Domains" value={String(slices.length)} />
        </div>

        {/* The legend for the one thing colour cannot carry. */}
        <div className="mo-stagger mt-5 flex items-center gap-4">
          <LegendSwatch i={0} label="Done" fill="var(--color-tenno-400)" />
          <LegendSwatch i={1} label="Remaining" fill="oklch(0.78 0.115 228 / 0.25)" />
          <LegendSwatch i={2} label="Not measurable" hatched />
        </div>
      </div>
    </div>
  );
}

/**
 * `--i` is the stagger step, and it is a NUMBER the parent's `.mo-stagger` rule
 * multiplies by `--mo-step`. It is capped at 12 in motion.css, which matters
 * nowhere here (there are three of these) and matters enormously on the catalog
 * lists, which is why the cap lives in the rule rather than at each call site.
 */
function Figure({ label, value, tone, i }: { label: string; value: string; tone?: string; i: number }) {
  return (
    <div className="mo-in-up" style={{ '--i': String(i) } as CSSProperties}>
      <div className="eyebrow">{label}</div>
      <div
        className="numeric mt-1 text-[length:var(--text-lead)] leading-none font-light"
        style={{ color: tone ?? 'var(--text)' }}
      >
        {value}
      </div>
    </div>
  );
}

function LegendSwatch({ label, fill, hatched, i }: { label: string; fill?: string; hatched?: boolean; i: number }) {
  return (
    <span className="mo-in-left flex items-center gap-1.5" style={{ '--i': String(i) } as CSSProperties}>
      <span
        aria-hidden
        className="size-2.5"
        style={
          hatched
            ? {
                background:
                  'repeating-linear-gradient(45deg, oklch(1 0 0 / 0.16) 0 1.5px, oklch(1 0 0 / 0.03) 1.5px 5px)',
              }
            : { background: fill }
        }
      />
      <span className="eyebrow">{label}</span>
    </span>
  );
}
