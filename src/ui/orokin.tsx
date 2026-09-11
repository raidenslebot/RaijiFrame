/**
 * OROKIN — the component kit.
 *
 * Every panel in RaijiFrame is assembled from this file, so the two hard
 * material problems are solved here once rather than re-approximated per panel:
 *
 *   GOLD is not a colour, it is a *ramp*. A single fill reads as mustard plastic.
 *   Metal reads as metal because the eye sees shadow -> mid -> a hot specular
 *   band -> mid -> shadow across the surface, plus an anisotropic sheen that
 *   shifts as the surface turns. `GoldPlate` builds that out of layered
 *   gradients and sweeps the specular on hover.
 *
 *   ENERGY is not a cyan box. It reads as plasma because it is emissive: a hot
 *   near-white core, a saturated mid, and a wide soft falloff, blended
 *   additively (`screen`) so overlapping layers brighten rather than muddy.
 *   `EnergyField` layers blurred radials and drifts them slowly.
 *
 * Rules this file obeys, because it sits on top of a game at 60fps:
 *   - only `transform` and `opacity` are ever animated;
 *   - the chamfered silhouettes come from the --clip-* tokens in theme.css;
 *   - nothing here fetches, derives or knows about account data.
 *
 * The rim light: `clip-path` deletes borders, and `box-shadow` is clipped away
 * with them. So a lit edge is drawn as a two-element sandwich — an outer node
 * carrying the edge gradient, and an inner node inset by 1px carrying the fill,
 * both wearing the same clip. That is the only way to get a crisp 1px light
 * along a chamfer.
 */

import {
  useCallback,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useReducedMotion } from 'motion/react';
import { m } from '../app/motion';

/* ------------------------------------------------------------------ helpers */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Alpha without knowing the colour space of the input. `color-mix` lets callers
 * pass any CSS colour — a token, a hex, a faction var — and still get correct
 * fades, which a hardcoded rgba() string could never do.
 */
function fade(color: string, percent: number): string {
  return `color-mix(in oklab, ${color} ${percent}%, transparent)`;
}

/** Lift a colour toward white for the emissive core of an energy layer. */
function hot(color: string, percent: number): string {
  return `color-mix(in oklab, white ${percent}%, ${color})`;
}

const EASE_OUT = [0.22, 0.61, 0.36, 1] as const;

export const CLIP = {
  panel: 'var(--clip-panel)',
  card: 'var(--clip-card)',
  cardAlt: 'var(--clip-card-alt)',
  button: 'var(--clip-button)',
  tab: 'var(--clip-tab)',
  /** A meter has one slanted end so the fill reads as flowing off the edge. */
  meter: 'polygon(0 0, 100% 0, calc(100% - 7px) 100%, 0 100%)',
} as const;

/* ------------------------------------------------------------------- accents */

export type Accent = 'default' | 'gold' | 'energy';

interface AccentSpec {
  /** The rim gradient. Brightest at the top-left: the whole app is lit from there. */
  edge: string;
  /** Interior fill, always layered — a flat fill is what makes a surface look printed. */
  fill: string;
  glow: string;
  ink: string;
}

const ACCENTS: Record<Accent, AccentSpec> = {
  default: {
    edge: 'linear-gradient(145deg, oklch(1 0 0 / 0.28), oklch(1 0 0 / 0.07) 38%, oklch(1 0 0 / 0.02) 62%, transparent 88%)',
    fill: [
      'radial-gradient(120% 90% at 8% 0%, oklch(1 0 0 / 0.055), transparent 58%)',
      'linear-gradient(168deg, oklch(0.17 0.024 268 / 0.94), oklch(0.115 0.022 275 / 0.96))',
    ].join(','),
    glow: 'none',
    ink: 'var(--text)',
  },
  gold: {
    edge: 'linear-gradient(145deg, var(--color-orokin-200), var(--color-orokin-500) 30%, oklch(0.83 0.105 90 / 0.22) 58%, transparent 88%)',
    fill: [
      'radial-gradient(130% 100% at 6% -8%, oklch(0.83 0.105 90 / 0.20), transparent 55%)',
      'radial-gradient(90% 70% at 100% 108%, oklch(0.64 0.11 84 / 0.14), transparent 60%)',
      'linear-gradient(168deg, oklch(0.185 0.03 80 / 0.95), oklch(0.115 0.02 70 / 0.96))',
    ].join(','),
    glow: 'var(--glow-gold)',
    ink: 'var(--color-orokin-200)',
  },
  energy: {
    edge: 'linear-gradient(145deg, var(--color-tenno-200), var(--color-tenno-500) 30%, oklch(0.78 0.115 228 / 0.20) 58%, transparent 88%)',
    fill: [
      'radial-gradient(130% 100% at 6% -8%, oklch(0.78 0.115 228 / 0.20), transparent 55%)',
      'radial-gradient(90% 70% at 100% 108%, oklch(0.52 0.12 236 / 0.16), transparent 60%)',
      'linear-gradient(168deg, oklch(0.17 0.035 240 / 0.95), oklch(0.11 0.025 250 / 0.96))',
    ].join(','),
    glow: 'var(--glow-tenno)',
    ink: 'var(--color-tenno-200)',
  },
};

/* --------------------------------------------------------------------- Panel */

export interface PanelProps {
  children?: ReactNode;
  className?: string;
  /** Interior padding class. Set to '' when the panel hosts its own scroller. */
  padding?: string;
  variant?: Accent;
  /** Small caps kicker above the title. */
  eyebrow?: ReactNode;
  title?: ReactNode;
  /** Right-aligned controls in the header row. */
  actions?: ReactNode;
  /** Orokin filigree in the cut corners. Off by default — it is loud. */
  ornament?: boolean;
  /** Drops the drop-shadow for panels nested inside another surface. */
  flat?: boolean;
  style?: CSSProperties;
}

export function Panel({
  children,
  className,
  padding = 'p-5',
  variant = 'default',
  eyebrow,
  title,
  actions,
  ornament = false,
  flat = false,
  style,
}: PanelProps) {
  const a = ACCENTS[variant];
  const header = eyebrow != null || title != null || actions != null;

  return (
    // `flex` + `flex-1` rather than `h-full` on the inner: a percentage height
    // against this auto-height shell resolves to the scroll container instead of
    // to the content, which stretches a panel to a full viewport.
    // `mo-arrive` is SCROLL-DRIVEN, not timed, and that is the whole reason a
    // panel may have an entrance at all. A panel is the largest thing on screen;
    // a time-based entrance on it would be the biggest possible casualty of the
    // frozen document timeline - a whole screen stuck at its first frame. A
    // `view()` timeline takes its progress from scroll POSITION, so there is no
    // clock in it to stop, and motion.css keeps it transform-only anyway, so a
    // panel that is never scrolled to is a panel sitting 20px low rather than a
    // panel that is missing. See the family rules at the top of motion.css.
    <div
      className={cx('mo-arrive relative isolate flex', className)}
      style={{
        clipPath: CLIP.panel,
        padding: 1,
        background: a.edge,
        boxShadow: flat ? undefined : 'var(--shadow-card)',
        ...style,
      }}
    >
      <div
        className={cx('relative w-full flex-1', padding)}
        style={{ clipPath: CLIP.panel, background: a.fill, backdropFilter: 'blur(18px) saturate(1.5)' }}
      >
        {ornament && (
          <>
            <Ornament
              variant="corner"
              className="pointer-events-none absolute top-0 right-0 opacity-45"
              color={a.ink}
              size={54}
            />
            <Ornament
              variant="corner"
              className="pointer-events-none absolute bottom-0 left-0 rotate-180 opacity-30"
              color={a.ink}
              size={54}
            />
          </>
        )}

        {header && (
          <header className="mb-4 flex items-start justify-between gap-4">
            {/*
             * The heading drifts a little slower than the body it belongs to, so
             * a long panel reads as two planes instead of one flat sheet. Only
             * the eyebrow/title block moves - `actions` are controls, and a
             * control that slides while you are reaching for it is worse than a
             * flat panel.
             *
             * Scroll-driven, so the frozen timeline cannot reach it, and
             * transform-only regardless: a panel that is never scrolled sits at
             * range start, which is a heading fourteen pixels low and entirely
             * readable.
             */}
            <div className="mo-parallax min-w-0">
              {eyebrow != null && (
                <div className={cx('eyebrow', variant !== 'default' && 'eyebrow-gold')} style={{ color: a.ink }}>
                  {eyebrow}
                </div>
              )}
              {title != null && (
                <h2
                  className="mt-1 truncate text-[length:var(--text-lead)] leading-tight"
                  style={{ color: variant === 'default' ? 'var(--text)' : a.ink }}
                >
                  {title}
                </h2>
              )}
            </div>
            {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          </header>
        )}

        {children}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- Card */



/* ----------------------------------------------------------------- GoldPlate */

/**
 * The metal.
 *
 * Four stacked layers, because that is what a photograph of gold contains:
 *   1. the value ramp — dark burnish, mid, a hot specular band, mid, dark;
 *   2. an anisotropic sheen — a conic gradient, which is how brushed metal
 *      redistributes light by *angle* rather than by position;
 *   3. a micro-brush texture — 2px repeating lines at very low contrast, the
 *      thing that stops a gradient from looking like a gradient;
 *   4. a moving specular sweep, parked off-screen until hover.
 */

const GOLD_RAMP =
  'linear-gradient(146deg,' +
  ' var(--color-orokin-800) 0%,' +
  ' var(--color-orokin-600) 16%,' +
  ' var(--color-orokin-300) 33%,' +
  ' var(--color-orokin-100) 43%,' + // the hot specular band
  ' var(--color-orokin-400) 52%,' +
  ' var(--color-orokin-700) 68%,' +
  ' var(--color-orokin-500) 84%,' +
  ' var(--color-orokin-800) 100%)';

const GOLD_SHEEN =
  'conic-gradient(from 210deg at 30% 20%,' +
  ' oklch(1 0 0 / 0.30) 0deg,' +
  ' oklch(1 0 0 / 0) 42deg,' +
  ' oklch(0.38 0.07 76 / 0.42) 128deg,' +
  ' oklch(1 0 0 / 0.16) 205deg,' +
  ' oklch(0.38 0.07 76 / 0.34) 292deg,' +
  ' oklch(1 0 0 / 0.30) 360deg)';

const GOLD_BRUSH =
  'repeating-linear-gradient(146deg,' +
  ' oklch(1 0 0 / 0.055) 0px,' +
  ' oklch(1 0 0 / 0) 1px,' +
  ' oklch(0 0 0 / 0.05) 2px,' +
  ' oklch(0 0 0 / 0) 3px)';



/* ---------------------------------------------------------------- EnergyField */

export interface GoldPlateProps {
  children?: ReactNode;
  className?: string;
  padding?: string;
  clip?: string;
  /** Ink colour on top of the plate. Dark by default — you engrave gold, not paint it. */
  ink?: string;
  /** Runs the specular sweep continuously instead of only on hover. */
  shimmer?: boolean;
  /** Adds a warm bloom behind the plate. */
  glow?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}

export function GoldPlate({
  children,
  className,
  padding = 'px-4 py-2',
  clip = CLIP.button,
  ink = 'oklch(0.20 0.03 76)',
  shimmer = false,
  glow = false,
  onClick,
  style,
}: GoldPlateProps) {
  const reduced = useReducedMotion();
  const interactive = onClick != null;
  const Root = interactive ? m.button : m.div;

  // Parked off the left edge until hover, then driven across in one pass. The
  // return trip is instant so releasing hover never shows the highlight running
  // backwards, which no physical light does.
  const sweep = {
    rest: { x: '-150%', transition: { duration: 0 } },
    active: {
      x: '150%',
      transition: shimmer
        ? { duration: 2.6, ease: 'linear' as const, repeat: Infinity, repeatDelay: 1.4 }
        : { duration: 0.85, ease: EASE_OUT },
    },
  };

  return (
    <Root
      {...(interactive ? { type: 'button' as const, onClick } : {})}
      /*
       * THE PLATE TAKES A POINTER LIGHT.
       *
       * The four layers below build a plausible piece of metal and then light it
       * from one fixed direction forever, which is what makes a large plate read
       * as printed: real metal changes as the light moves across it, and the only
       * light this app has that moves is the cursor. `mo-field` opts the plate
       * into the document-level tracker and `mo-sheen` puts a warm specular under
       * the ramp at wherever the pointer actually is - so the surface has a
       * finish rather than a picture of one.
       *
       * This is safe to run on opacity because it is INPUT-DRIVEN: a pointer
       * cannot be over a window that is not being presented, so the document
       * timeline is running by definition whenever any of it can fire.
       *
       * The travelling sweep further down is kept and is a different statement -
       * it is the plate reacting to being TOUCHED, one pass, one direction. The
       * sheen is the plate reacting to being LOOKED AT.
       */
      className={cx(
        'mo-field mo-sheen relative isolate inline-flex items-center justify-center overflow-hidden',
        // Only a plate you can press gets the press: lift and focus bloom are
        // affordances, and putting them on a decorative badge would promise a
        // click that is not there.
        interactive && 'mo-lift mo-focusable',
        className,
      )}
      style={{
        clipPath: clip,
        background: GOLD_RAMP,
        boxShadow: glow ? '0 0 22px oklch(0.83 0.105 90 / 0.45), var(--shadow-card)' : 'var(--shadow-card)',
        ...style,
      }}
      initial="rest"
      animate={shimmer && !reduced ? 'active' : 'rest'}
      whileHover={reduced ? undefined : 'active'}
    >
      {/* Anisotropic sheen: overlay keeps the ramp's own values visible under it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: GOLD_SHEEN, mixBlendMode: 'overlay' }}
      />
      {/* Brushed grain. Soft-light so it perturbs the surface without dirtying it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{ background: GOLD_BRUSH, mixBlendMode: 'soft-light' }}
      />
      {/* Bevel: a bright top-left lip and a dark bottom-right one. This is what
          gives the plate thickness rather than looking like printed paper. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(146deg, oklch(1 0 0 / 0.55), oklch(1 0 0 / 0) 14%, oklch(0 0 0 / 0) 82%, oklch(0 0 0 / 0.45))',
        }}
      />
      {/* The travelling specular. Narrow and near-white; transform only. */}
      <m.span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-1/3 w-2/3"
        style={{
          background:
            'linear-gradient(105deg, transparent, oklch(1 0 0 / 0.10) 35%, oklch(1 0 0 / 0.85) 50%, oklch(1 0 0 / 0.10) 65%, transparent)',
          mixBlendMode: 'screen',
          filter: 'blur(1px)',
        }}
        variants={sweep}
      />
      <span
        className={cx('relative z-10 font-[family-name:var(--font-display)] font-semibold', padding)}
        style={{ color: ink, textShadow: '0 1px 0 oklch(1 0 0 / 0.25)' }}
      >
        {children}
      </span>
    </Root>
  );
}

export interface EnergyFieldProps {
  children?: ReactNode;
  className?: string;
  /** Any CSS colour: a token, a faction var, a hex. Defaults to Tenno cyan. */
  color?: string;
  /** 0..1. Scales every layer's alpha together so it dims as one light source. */
  intensity?: number;
  clip?: string;
  
/** Kills the drift for static contexts (a printed screenshot, a dense list). */
  still?: boolean;
  style?: CSSProperties;
}

export function EnergyField({
  children,
  className,
  color = 'var(--color-tenno-400)',
  intensity = 1,
  clip = CLIP.card,
  still = false,
  style,
}: EnergyFieldProps) {
  const reduced = useReducedMotion();
  const drift = !still && !reduced;
  const k = Math.max(0, Math.min(1, intensity));

  return (
    <div
      className={cx('relative isolate overflow-hidden', className)}
      style={{ clipPath: clip, background: 'oklch(0.07 0.018 275)', ...style }}
    >
      {/* Base bloom. Five stops, not two: a plasma has a white-hot core, a
          saturated body, and a long low falloff. Collapsing the middle is
          exactly what makes cheap glows look like a blurred circle. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(78% 78% at 50% 96%, ${hot(color, 62)} 0%, ${fade(color, 92 * k)} 14%, ${fade(color, 52 * k)} 30%, ${fade(color, 18 * k)} 52%, transparent 74%)`,
        }}
      />

      {/* Two slow blobs, blurred and screened so overlaps brighten. Transform
          only — the blur is rasterised once and the layer is then just moved. */}
      <m.span
        aria-hidden
        className="pointer-events-none absolute bottom-[-10%] left-[-10%] h-[75%] w-[55%]"
        style={{
          background: `radial-gradient(closest-side, ${fade(hot(color, 30), 80 * k)}, ${fade(color, 24 * k)} 55%, transparent 74%)`,
          filter: 'blur(18px)',
          mixBlendMode: 'screen',
        }}
        animate={drift ? { x: ['-4%', '52%', '-4%'], y: ['6%', '-14%', '6%'], scale: [1, 1.22, 1] } : undefined}
        transition={{ duration: 13, ease: 'easeInOut', repeat: Infinity }}
      />
      <m.span
        aria-hidden
        className="pointer-events-none absolute right-[-8%] bottom-[-20%] h-[85%] w-[48%]"
        style={{
          background: `radial-gradient(closest-side, ${fade(color, 78 * k)}, transparent 68%)`,
          filter: 'blur(26px)',
          mixBlendMode: 'screen',
        }}
        animate={drift ? { x: ['4%', '-46%', '4%'], y: ['0%', '-18%', '0%'], scale: [1.1, 0.85, 1.1] } : undefined}
        transition={{ duration: 17, ease: 'easeInOut', repeat: Infinity }}
      />

      {/* The core: small, tight, and clipping to white. Emissive things read as
          emissive because their centre blows out, not because they are bright. */}
      <m.span
        aria-hidden
        className="pointer-events-none absolute inset-x-[34%] bottom-[-6%] h-[42%]"
        style={{
          background: `radial-gradient(closest-side, white, ${hot(color, 55)} 32%, ${fade(color, 45 * k)} 60%, transparent 78%)`,
          filter: 'blur(5px)',
          mixBlendMode: 'screen',
        }}
        animate={drift ? { opacity: [0.6 * k, 1 * k, 0.6 * k], scaleY: [1, 1.16, 1] } : { opacity: 0.8 * k }}
        transition={{ duration: 4.2, ease: 'easeInOut', repeat: Infinity }}
      />

      {/* Vignette. Glow is a contrast effect: without a dark surround the field
          is just a coloured rectangle, however many layers are stacked in it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 110% at 50% 92%, transparent 42%, oklch(0.05 0.015 275 / 0.5) 82%, oklch(0.04 0.012 275 / 0.8) 100%)',
        }}
      />

      {/* Containment field: fine horizontal scan lines. Cheap, static, and the
          single detail that makes the glow feel like it is *held* by hardware. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          background: 'repeating-linear-gradient(0deg, oklch(0 0 0 / 0.5) 0px, transparent 1px, transparent 3px)',
        }}
      />

      {children != null && <div className="relative z-10">{children}</div>}
    </div>
  );
}

/* --------------------------------------------------------------------- Meter */

export interface MeterProps {
  /** 0..1. Values outside are clamped rather than overflowing the track. */
  value: number;
  className?: string;
  color?: string;
  height?: number;
  /** Left/right captions above the track. */
  label?: ReactNode;
  caption?: ReactNode;
  /** Ghost mark for a target or a previous value. 0..1. */
  ghost?: number;
}

export function Meter({ value, className, color = 'var(--color-tenno-400)', height = 6, label, caption, ghost }: MeterProps) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  // The leading edge lives inside the scaled fill, so it must be scaled back by
  // the inverse or it stretches into a smear. Floored so v=0 cannot divide by 0.
  const inverse = 1 / Math.max(v, 0.04);

  return (
    <div className={className}>
      {(label != null || caption != null) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {label != null && <span className="eyebrow">{label}</span>}
          {caption != null && (
            <span className="numeric text-[length:var(--text-micro)]" style={{ color: 'var(--text-faint)' }}>
              {caption}
            </span>
          )}
        </div>
      )}

      {/*
       * The track lights where you point at it.
       *
       * A meter is a READOUT, and the one thing it must never do is animate its
       * own value (see the note on the fill below - that rule is not negotiable
       * on a frozen timeline). That left it as the only element in the kit with
       * no response of any kind, which read as disabled rather than as static.
       *
       * A pointer light is the response a readout can honestly have: it says "you
       * are looking at this one" without claiming anything about the number. It
       * is input-driven, so it cannot strand, and it costs nothing until the
       * cursor actually arrives.
       */}
      <div
        className="mo-field mo-sheen relative w-full overflow-hidden"
        style={{
          height,
          clipPath: CLIP.meter,
          background: 'linear-gradient(180deg, oklch(0 0 0 / 0.55), oklch(1 0 0 / 0.05))',
          boxShadow: `inset 0 0 0 1px oklch(1 0 0 / 0.07)`,
        }}
      >
        {ghost != null && (
          <span
            aria-hidden
            className="absolute inset-y-0 w-px"
            style={{ left: `${Math.max(0, Math.min(1, ghost)) * 100}%`, background: 'oklch(1 0 0 / 0.35)' }}
          />
        )}

        {/*
         * The fill is rendered AT its value and NOT transitioned to it.
         *
         * A transition looked safe because the first paint is already at the
         * value. It is not safe for the SECOND value: an inventory push arrives
         * while the overlay is unpresented - the normal case, the game has
         * focus - and a transition started on a frozen document timeline holds
         * its FROM value indefinitely. The meter would sit at last week's
         * number with nothing to say it was stale. This is a measurement; it
         * changes instantly or it lies.
         */}
        <div
          className="absolute inset-y-0 left-0 w-full origin-left"
          style={{
            background: `linear-gradient(90deg, ${fade(color, 45)}, ${color} 62%, ${hot(color, 45)})`,
            boxShadow: `0 0 12px ${fade(color, 55)}`,
            transform: `scaleX(${v})`,
          }}
        >
          {/* The bright leading edge — the tell that a bar is filling rather than
              just being long. Counter-scaled so it stays a crisp 3px. */}
          <span
            aria-hidden
            className="absolute inset-y-0 right-0 w-[3px] origin-right"
            style={{
              background: hot(color, 80),
              boxShadow: `0 0 10px ${color}, 0 0 20px ${fade(color, 70)}`,
              transform: `scaleX(${inverse})`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- Ring */

export interface RingProps {
  /** 0..1. */
  value: number;
  size?: number;
  thickness?: number;
  color?: string;
  trackColor?: string;
  className?: string;
  /** Centre content — a rank number, a percentage, a glyph. */
  children?: ReactNode;
  /** Leaves a gap at the bottom, like a gauge. Degrees. */
  gap?: number;
}

export function Ring({
  value,
  size = 132,
  thickness = 7,
  color = 'var(--color-orokin-400)',
  trackColor = 'oklch(1 0 0 / 0.08)',
  className,
  children,
  gap = 0,
}: RingProps) {
  const uid = useId().replace(/:/g, '');
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - thickness) / 2;
  // Dash geometry in real user units. `pathLength` normalisation is the tidier
  // API but it disagrees with the animated value often enough to draw short
  // arcs, and a progress ring that lies is worse than one that is verbose.
  const circumference = 2 * Math.PI * r;
  const arc = circumference * (1 - gap / 360);

  return (
    /*
     * THE RING TURNS TOWARD YOU.
     *
     * A ring is the one shape in the kit that is unmistakably an OBJECT rather
     * than a rectangle, and it was being drawn flat on the page like a printed
     * dial. `mo-tilt` rotates it a few degrees on the real z axis toward wherever
     * the pointer is, which is the cheapest way to say "this is a disc sitting in
     * space" - the glow filter and the gradient stroke only pay off once the
     * thing they are lighting has an orientation.
     *
     * Pointer-driven, so it cannot strand, and the arc itself is untouched: the
     * value is still rendered at its value, never animated to it.
     */
    <div
      className={cx('mo-field mo-tilt relative inline-grid place-items-center', className)}
      style={{ width: size, height: size }}
    >
      {/* A full ring starts at 12 o'clock; a gauge starts wherever puts its gap
          centred at the bottom, which is the only place a gap reads as intended. */}
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0"
        style={{ rotate: `${gap === 0 ? -90 : 90 + gap / 2}deg` }}
      >
        <defs>
          <linearGradient id={`ring-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={hot(color, 55)} />
            <stop offset="45%" stopColor={color} />
            <stop offset="100%" stopColor={fade(color, 55)} />
          </linearGradient>
          <filter id={`glow-${uid}`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation={thickness * 0.55} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={thickness}
          strokeLinecap="butt"
          strokeDasharray={`${arc} ${circumference}`}
        />
        {/* The one animation in the kit that is not a transform. Dash offset is a
            paint-only property on a ~130px surface and only moves when the value
            changes, so it never costs the overlay a frame during play. */}
        {/* Rendered at its value, untransitioned - see Meter for why a value
            may never arrive via an animation on a frozen document timeline. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#ring-${uid})`}
          strokeWidth={thickness}
          strokeLinecap="round"
          filter={`url(#glow-${uid})`}
          strokeDasharray={`${arc} ${circumference}`}
          strokeDashoffset={arc * (1 - v)}
        />
      </svg>
      {children != null && <div className="relative z-10 text-center">{children}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------------- Stat */



/* ------------------------------------------------------------------- Counter */

const defaultFormat = (n: number): string => Math.round(n).toLocaleString();

export interface CounterProps {
  /**
   * The same figure at the previous account read, when the caller has it.
   *
   * Undefined: not asked. Null: asked, and there was no earlier reading — a
   * first capture is not a change and must not be marked as one.
   */
  was?: number | null;
  value: number;
  /** Must be referentially stable (module scope or useCallback) or the tween restarts. */
  format?: (n: number) => string;
  duration?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Counts to its value.
 *
 * The tween writes `textContent` from inside an effect rather than through
 * state: sixty setState calls a second would re-render whatever panel holds this
 * counter, and the render pass itself must stay pure — no clock, no ref reads.
 * First render prints the true value, so a reduced-motion or paused user never
 * sees a lie.
 */
export function Counter({ value, was, format = defaultFormat, className, style }: CounterProps) {
  /*
   * WHAT MOVED SINCE LAST TIME. `was` is the same figure from the previous
   * session's snapshot, which this app persists and the game does not keep at
   * all. Undefined means nobody asked the question; null means it was asked and
   * there was no previous reading - and neither is a change, because "we have
   * never seen this before" is not "this went up".
   */
  const delta = was === undefined || was === null || was === value ? null : value > was ? 'up' : 'down';
  /*
   * NO TWEEN. This used to count up from the previous value on a
   * requestAnimationFrame-driven animation that wrote intermediate numbers
   * into the DOM. On a frozen document timeline the first tick could land and
   * the rest never come, leaving a number on screen that was never true. A
   * figure is rendered at its value; the entrance around it may move, the
   * figure may not.
   */
  /*
   * THE FIGURE CANNOT MOVE, SO THE LIGHT ON IT DOES.
   *
   * The note above rules out every entrance and every tween for this component,
   * and it stays ruled out: a figure that arrives by animation is a figure that
   * can be caught mid-flight and left showing a number that was never true. That
   * also ruled out a transform entrance, because a Counter is routinely set
   * inside a `truncate` box - overflow hidden, one line high - where a 12px
   * offset does not read as "slightly low", it reads as half a number.
   *
   * What is left is the pointer, which is input-driven and therefore exempt: the
   * figure warms as the cursor crosses it. The value is still printed at its
   * value on the very first paint, with or without a timeline.
   */
  return (
    <span
      className={cx('mo-field mo-sheen numeric tabular-nums', delta !== null && 'rf-delta', className)}
      style={
        delta === null
          ? style
          : {
              ...style,
              ['--rf-delta-ink' as string]:
                delta === 'up' ? 'var(--color-signal-good)' : 'var(--color-signal-warn)',
            }
      }
      title={delta === null ? undefined : `was ${format(was ?? 0)} when this account was last read`}
    >
      {format(value)}
    </span>
  );
}

/* --------------------------------------------------------------------- Tabs */

export interface TabItem {
  id: string;
  label: ReactNode;
  glyph?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  variant?: Accent;
}

export function Tabs({ items, value, onChange, className, variant = 'gold' }: TabsProps) {
  const ink = ACCENTS[variant].ink;

  return (
    <div className={cx('flex items-stretch gap-1', className)} role="tablist">
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={cx(
              // No `transition-opacity`: `opacity-60` below is selection state,
              // not hover, and a stranded opacity transition leaves the outgoing
              // tab at full strength. See the marker note below.
              'rf-clipped relative isolate px-4 py-2 text-[length:var(--text-small)]',
              'font-[family-name:var(--font-display)] tracking-wide',
              item.disabled ? 'cursor-not-allowed opacity-30' : 'cursor-pointer',
              !active && !item.disabled && 'opacity-60 hover:opacity-90',
              /*
               * A DISABLED TAB GETS NONE OF IT, AND THAT IS NOT A DETAIL.
               *
               * `:hover` still matches a disabled button - the browser fires no
               * click, but the pseudo-class is live - so handing these classes to
               * every tab would give a tab that cannot be chosen the exact
               * physical response of one that can. The magnet is the tab leaning
               * toward the cursor: on a dead control that is a promise.
               */
              !item.disabled && 'mo-host mo-field mo-magnet mo-focusable',
            )}
            style={{ clipPath: CLIP.tab, color: active ? ink : 'var(--text-muted)' }}
          >
            {active && (
              /*
               * A PLAIN SPAN ON THE SELECTED TAB, not one marker sliding between
               * tabs.
               *
               * This used Motion's `layoutId`, which animates on the document
               * timeline. This app is an overlay whose host stops presenting the
               * window at will, and a frozen timeline strands a shared-layout
               * element on the PREVIOUS tab - so the marker sits under one tab
               * while a different tab is the selected one.
               *
               * That is the same failure the nav rail in app/Shell.tsx was fixed
               * for, and the reasoning there applies verbatim: an indicator that
               * can point at the wrong thing is worse than one that does not
               * slide. Tabs are a shared primitive used across most panels, so
               * this was that bug multiplied.
               */
              <span
                aria-hidden
                className="absolute inset-0 -z-10"
                style={{
                  background: `linear-gradient(180deg, ${fade(ink, 22)}, ${fade(ink, 6)})`,
                  boxShadow: `inset 0 -2px 0 0 ${ink}`,
                }}
              />
            )}
            <span className="flex items-center gap-2">
              {item.glyph != null && <span aria-hidden>{item.glyph}</span>}
              {/*
               * THE UNDERLINE IS ON THE LABEL, NOT ON THE BUTTON, AND THAT IS
               * FORCED BY THE CHAMFER.
               *
               * `mo-underline` draws its rule on an ::after at `bottom: -2px`,
               * i.e. two pixels OUTSIDE the border box. The tab wears
               * `clip-path: CLIP.tab`, and a clip-path clips an element's
               * pseudo-elements along with everything else - so on the button the
               * rule renders, tracks the pointer correctly, and is invisible. On
               * the label it sits inside the button's `py-2` and is drawn.
               *
               * The pointer field is still the BUTTON's (`mo-field` above), which
               * is what makes the line grow from where the cursor entered the tab
               * rather than from where it entered the four words of the label;
               * `--mxp` inherits, which is exactly what motion.css declares it
               * for. `mo-host` is what carries the hover state down to here - see
               * the rule in app/Shell.tsx.
               *
               * Only on tabs that are NOT selected: the selected tab already
               * carries a lit bottom edge as STATE, and a second gold line under
               * it on hover would make "chosen" and "pointed at" look the same.
               */}
              <span className={cx(!active && !item.disabled && 'mo-underline')}>{item.label}</span>
              {item.badge != null && (
                <span className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--text-faint)' }}>
                  {item.badge}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- DataTable */

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Omit to make the column unsortable. */
  compare?: (a: T, b: T) => number;
  align?: 'left' | 'right';
  /** Any CSS width; numeric columns want a fixed one so they stop jittering. */
  width?: string;
  className?: string;
}

export interface DataTableProps<T> {
  columns: ReadonlyArray<Column<T>>;
  rows: readonly T[];
  rowKey: (row: T) => string;
  className?: string;
  onRowClick?: (row: T) => void;
  /** Shown instead of the table when `rows` is empty. */
  empty?: ReactNode;
  /** Initially sorted column key. */
  initialSort?: string;
  /**
   * Rows rendered before the "show more" control appears.
   *
   * Defaults to 120. See the note on PAGE below for why a cap exists at all.
   */
  pageSize?: number;
  /**
   * Detail revealed when a row is clicked.
   *
   * Supplying this makes every row a disclosure. It exists because the tables
   * carry far more than they can show: a column can hold a number, but not the
   * item's description, its drop sources, what it is spent on, or a way to
   * navigate to any of them. All of that was present in the data and unreachable
   * in the UI, which is most of why the tables read as dead.
   *
   * ONLY CALLED FOR ROWS THAT ARE ACTUALLY OPEN, so it may be as expensive as it
   * needs to be. The first version called it for every visible row on every
   * render in order to decide whether to draw a chevron, which meant 120 detail
   * trees built per render and - because one caller looks its row up in the
   * inventory by scanning it - a quadratic scan on every keystroke in the
   * filter box. Whether a table's rows open is a property of the TABLE, so the
   * chevron is driven by this prop being present at all.
   */
  expand?: (row: T) => ReactNode;
}

type SortState = { key: string; dir: 1 | -1 } | null;

/**
 * Default row cap.
 *
 * THIS IS A PERFORMANCE CONSTRAINT, NOT A UI PREFERENCE.
 * The mastery catalog is ~800 rows. Rendered in full it produced ~13,000 DOM
 * nodes in a single panel and a measured 210ms forced layout — enough to stall
 * the browser's own screenshot, and this app is an overlay composited over a
 * running game that pays for every one of those milliseconds.
 *
 * `content-visibility` was tried first and is retained on the rows, but it only
 * skips PAINT and layout for off-screen content; the nodes still exist, still
 * cost style recalculation, and still have to be built. The only way to not pay
 * for a row is to not create it.
 *
 * 120 is comfortably more than fits on screen at any realistic window size, so
 * the cap is invisible during normal scrolling, and the remainder is one click
 * away with the exact count stated. Sorting and filtering apply to the FULL row
 * set before the cap, so the cap never hides a row that should have ranked into
 * view.
 */
const PAGE = 120;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  className,
  onRowClick,
  empty,
  initialSort,
  pageSize = PAGE,
  expand,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>(initialSort ? { key: initialSort, dir: 1 } : null);
  const [limit, setLimit] = useState(pageSize);
  /*
   * Which rows are open, by key.
   *
   * A set rather than a single id: comparing two items means having both open at
   * once, and closing one in order to read another is the kind of small friction
   * that makes a tool feel like it is fighting you.
   */
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());

  const toggleRow = useCallback((key: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.compare) return rows;
    const cmp = col.compare;
    return [...rows].sort((a, b) => cmp(a, b) * sort.dir);
  }, [rows, columns, sort]);

  const toggle = useCallback((key: string) => {
    setSort((prev) => (prev && prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
    // Re-sorting changes which rows belong at the top, so an expanded view is
    // collapsed back to the cap rather than leaving a stale long list.
    setLimit(pageSize);
  }, [pageSize]);

  // The cap is applied AFTER sorting, so it always shows the correct leading
  // rows rather than an arbitrary slice of the input order.
  const visible = useMemo(() => (sorted.length > limit ? sorted.slice(0, limit) : sorted), [sorted, limit]);
  const hidden = sorted.length - visible.length;

  if (rows.length === 0) {
    return <>{empty ?? <EmptyState title="Nothing to show" detail="This table has no rows yet." />}</>;
  }

  return (
    <div className={cx('relative w-full overflow-auto', className)}>
      {/*
        `table-layout: fixed`, so a column with no declared width takes what is
        LEFT rather than what its longest cell wants. Auto layout let a
        description column push the table to 1900px inside an 1190px scroller:
        every description was cut mid-word, no ellipsis, and the whole table
        scrolled sideways. With fixed layout the cell's own `truncate` engages.
      */}
      <table className="w-full border-collapse text-[length:var(--text-small)]" style={{ tableLayout: 'fixed' }}>
        <thead>
          <tr>
            {columns.map((col) => {
              const active = sort?.key === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={cx(
                    'eyebrow sticky top-0 z-10 px-3 py-2 text-left whitespace-nowrap',
                    col.align === 'right' && 'text-right',
                    col.compare && 'select-none',
                  )}
                  style={{
                    width: col.width,
                    // Opaque, not translucent: a sticky header over scrolling rows
                    // has to actually occlude them.
                    background: 'linear-gradient(180deg, oklch(0.14 0.024 268), oklch(0.14 0.024 268 / 0.92))',
                    boxShadow: 'inset 0 -1px 0 0 var(--hairline)',
                    color: active ? 'var(--color-orokin-400)' : undefined,
                  }}
                  // A sortable header is a control, so it is a real button rather
                  // than a click handler on the cell: keyboard, focus ring and
                  // screen-reader sort state all come for free.
                  aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                >
                  {col.compare ? (
                    /*
                     * THE SORT CONTROL LOOKED EXACTLY LIKE THE COLUMNS THAT ARE
                     * NOT ONE.
                     *
                     * A sortable header and an unsortable header were the same
                     * eight-pixel small-caps label, and the only way to find out
                     * which was which was to click and see whether the table
                     * moved. `cursor: pointer` is not an affordance a player
                     * notices in a dense table.
                     *
                     * `mo-lift` rises on approach and gives under the press, so
                     * the header behaves like the button it has always been;
                     * `mo-underline` draws a rule from wherever the pointer
                     * crossed the label, which is the one move in the vocabulary
                     * that says "this is a control" without adding a border to a
                     * table that already has enough lines in it. No clip-path
                     * here, so unlike the tabs the rule can live on the button.
                     *
                     * All of it is hover/focus/press, so none of it can be
                     * stranded by the frozen timeline, and none of it costs
                     * anything until the pointer is actually on the header - the
                     * catalog tables run to ~800 rows and the header is drawn
                     * once for all of them.
                     */
                    <button
                      type="button"
                      className="eyebrow mo-field mo-lift mo-underline mo-focusable inline-flex cursor-pointer items-center whitespace-nowrap"
                      style={{ color: 'inherit' }}
                      onClick={() => toggle(col.key)}
                    >
                      {col.header}
                      {active && <span aria-hidden className="ml-1">{sort.dir === 1 ? '▲' : '▼'}</span>}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => {
            const key = rowKey(row);
            const isOpen = openKeys.has(key);
            // Built only when it will be shown. See the note on `expand`.
            const detail = isOpen && expand ? expand(row) : null;
            /*
             * One activation for two behaviours. A table gets `onRowClick` OR
             * `expand`, never both meaningfully, and resolving it here keeps the
             * row markup from carrying two parallel sets of handlers.
             */
            const activate =
              expand
                ? () => {
                    toggleRow(key);
                  }
                : onRowClick
                  ? () => {
                      onRowClick(row);
                    }
                  : undefined;
            return [
            <tr
              key={key}
              onClick={activate}
              // A clickable row must also be reachable without a mouse. Enter and
              // Space are the two keys a user expects to activate a focused thing.
              tabIndex={activate ? 0 : undefined}
              aria-expanded={expand ? isOpen : undefined}
              onKeyDown={
                activate
                  ? (e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      activate();
                    }
                  : undefined
              }
              // `list-row-sm` applies content-visibility so off-screen rows skip
              // layout and paint entirely. The catalog tables run to ~800 rows —
              // measured at ~13,000 DOM nodes in one panel — and this app is an
              // overlay composited over a running game, where recalculating
              // style across all of them is a tax the game pays. See theme.css.
              // No `transition-colors`: the `background` below is the open-row
              // highlight, which is state. A stranded transition would leave the
              // wrong row looking open.
              className={cx('list-row-sm group', activate && 'cursor-pointer')}
              style={{
                boxShadow: 'inset 0 -1px 0 0 oklch(1 0 0 / 0.05)',
                // An open row stays lit for as long as its detail is showing, so
                // a long detail block never leaves you unsure which row it
                // belongs to.
                background: isOpen ? 'oklch(0.83 0.105 90 / 0.07)' : undefined,
              }}
            >
              {columns.map((col, ci) => (
                <td
                  key={col.key}
                  className={cx(
                    'overflow-hidden px-3 py-2 align-middle group-hover:bg-[oklch(0.83_0.105_90_/_0.06)]',
                    col.align === 'right' && 'numeric text-right',
                    col.className,
                  )}
                  style={{ color: 'var(--text-muted)' }}
                >
                  {/* The arrow rides the first column rather than taking one of
                      its own: these tables are already dense, and a column that
                      is 12px of chevron and nothing else is wasted width. */}
                  {ci === 0 && expand ? (
                    <span className="flex items-center gap-2">
                      <Chevron open={isOpen} />
                      <span className="min-w-0 flex-1">{col.render(row)}</span>
                    </span>
                  ) : (
                    col.render(row)
                  )}
                </td>
              ))}
            </tr>,
            /*
             * The detail is its OWN row, not a box inside the first cell: a cell
             * cannot span the table's width from inside a row that already has
             * columns, and nesting it would make every column's width depend on
             * the detail's content.
             *
             * Rendered only while open. Unlike the standalone Disclosure this
             * height is not animated - a `<tr>` cannot be a CSS grid, so there
             * is no collapsed box that needs to stay measurable.
             */
            detail != null ? (
              <tr key={key + ':detail'}>
                <td
                  colSpan={columns.length}
                  className="px-3 pt-1 pb-3 pl-9"
                  style={{
                    background: 'oklch(0.83 0.105 90 / 0.04)',
                    boxShadow: 'inset 0 -1px 0 0 oklch(1 0 0 / 0.05), inset 2px 0 0 0 var(--color-orokin-500)',
                  }}
                >
                  {/* Slides into place as it appears. Safe to animate: the row
                      only opens because someone clicked it, and a click means
                      the document timeline is running. See theme.css. */}
                  <div className="anim-rise">{detail}</div>
                </td>
              </tr>
            ) : null,
            ];
          })}
        </tbody>
      </table>

      {hidden > 0 && (
        <div className="flex items-center gap-3 px-3 py-2.5">
          <button
            type="button"
            onClick={() => setLimit((n) => n + pageSize)}
            // The two controls that extend the table were the only plates in it
            // that did not move at all. `mo-lift` is the whole answer: rise on
            // approach, give on press. Chamfered, so no underline - see the tab
            // note about clip-path eating an ::after that sits outside the box.
            className="rf-clipped mo-lift mo-focusable px-3 py-1.5 transition-colors hover:bg-white/6"
            style={{
              clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
              background: 'oklch(1 0 0 / 0.045)',
            }}
          >
            <span
              className="font-[family-name:var(--font-display)] text-[length:var(--text-nano)] font-semibold tracking-[0.14em] uppercase"
              style={{ color: 'var(--color-tenno-300)' }}
            >
              Show {Math.min(hidden, pageSize)} more
            </span>
          </button>
          {/* The exact remainder, always. A capped list that does not say it is
              capped reads as a complete list that is missing rows. */}
          <span className="eyebrow">
            {hidden.toLocaleString()} more of {sorted.length.toLocaleString()}
          </span>
          {hidden > pageSize && (
            <button
              type="button"
              onClick={() => setLimit(sorted.length)}
              className="eyebrow mo-field mo-lift mo-underline mo-focusable ml-auto px-2 py-1 transition-colors hover:text-[color:var(--text)]"
              style={{ color: 'var(--text-faint)' }}
            >
              Show all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- Rarity */

export type RarityTier = 'common' | 'uncommon' | 'rare' | 'legendary' | 'prime';

const RARITY: Record<Exclude<RarityTier, 'prime'>, { color: string; label: string }> = {
  common: { color: 'var(--color-void-300)', label: 'Common' },
  uncommon: { color: 'var(--color-tenno-300)', label: 'Uncommon' },
  rare: { color: 'var(--color-orokin-400)', label: 'Rare' },
  legendary: { color: 'var(--color-signal-rare)', label: 'Legendary' },
};

export interface RarityProps {
  tier: RarityTier;
  children?: ReactNode;
  className?: string;
}

/** Prime is not a rarity tier so much as a material, so it gets the real plate. */
export function Rarity({ tier, children, className }: RarityProps) {
  if (tier === 'prime') {
    return (
      <GoldPlate
        className={cx('text-[length:var(--text-nano)] tracking-[0.18em] uppercase', className)}
        padding="px-2 py-[3px]"
        shimmer
      >
        {children ?? 'Prime'}
      </GoldPlate>
    );
  }

  const spec = RARITY[tier];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 px-2 py-[3px]',
        'text-[length:var(--text-nano)] font-semibold tracking-[0.18em] uppercase',
        className,
      )}
      style={{
        clipPath: CLIP.button,
        color: spec.color,
        background: `linear-gradient(180deg, ${fade(spec.color, 20)}, ${fade(spec.color, 8)})`,
        boxShadow: `inset 0 0 0 1px ${fade(spec.color, 35)}`,
      }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rotate-45" style={{ background: spec.color }} />
      {children ?? spec.label}
    </span>
  );
}

/* ------------------------------------------------------------------ Ornament */

export interface OrnamentProps {
  variant?: 'corner' | 'divider' | 'crest';
  color?: string;
  size?: number;
  className?: string;
}

/**
 * The disclosure arrow.
 *
 * Points right when closed, down when open, and turns between the two. Drawn
 * rather than typed because a text glyph cannot be rotated reliably across the
 * font fallbacks an overlay ends up with.
 */
export function Chevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={cx('rf-chevron size-3 shrink-0', className)}
      data-open={open}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 2.5 8.5 6l-4 3.5" />
    </svg>
  );
}

/**
 * Orokin filigree. Hairline strokes, bilateral symmetry, a diamond at every
 * junction — the grammar the game uses for every decorative element.
 */
export function Ornament({ variant = 'corner', color = 'var(--color-orokin-400)', size = 64, className }: OrnamentProps) {
  if (variant === 'divider') {
    return (
      <svg
        className={className}
        width="100%"
        height={Math.max(10, size / 4)}
        viewBox="0 0 240 16"
        preserveAspectRatio="none"
        aria-hidden
      >
        <g stroke={color} strokeWidth="1" fill="none" opacity="0.75">
          <path d="M0 8 H92" />
          <path d="M148 8 H240" />
          <path d="M92 8 l10 -6 M92 8 l10 6" />
          <path d="M148 8 l-10 -6 M148 8 l-10 6" />
        </g>
        <g fill={color}>
          <rect x="116" y="4" width="8" height="8" transform="rotate(45 120 8)" />
          <circle cx="104" cy="8" r="1.4" opacity="0.8" />
          <circle cx="136" cy="8" r="1.4" opacity="0.8" />
        </g>
      </svg>
    );
  }

  if (variant === 'crest') {
    return (
      <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <g stroke={color} strokeWidth="1.2" fill="none">
          <path d="M32 4 C46 14 52 26 52 34 C52 48 42 58 32 60 C22 58 12 48 12 34 C12 26 18 14 32 4 Z" opacity="0.85" />
          <path d="M32 12 C42 20 46 28 46 34 C46 45 39 52 32 54 C25 52 18 45 18 34 C18 28 22 20 32 12 Z" opacity="0.45" />
          <path d="M32 20 V48" opacity="0.5" />
          <path d="M22 32 H42" opacity="0.35" />
        </g>
        <rect x="28" y="28" width="8" height="8" transform="rotate(45 32 32)" fill={color} />
      </svg>
    );
  }

  // corner: sits in a cut corner, arcs following the chamfer.
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <g stroke={color} strokeWidth="1" fill="none">
        <path d="M64 2 H30 A28 28 0 0 0 2 30 V64" opacity="0.5" />
        <path d="M64 10 H36 A26 26 0 0 0 10 36 V64" opacity="0.3" />
        <path d="M64 20 H44 M64 26 H50" opacity="0.55" />
        <path d="M44 4 l6 6 M52 4 l6 6" opacity="0.4" />
      </g>
      <g fill={color}>
        <rect x="38" y="16" width="5" height="5" transform="rotate(45 40.5 18.5)" opacity="0.9" />
        <circle cx="18" cy="46" r="1.6" opacity="0.7" />
      </g>
    </svg>
  );
}

/* ---------------------------------------------------------------- EmptyState */

export interface EmptyStateProps {
  title: ReactNode;
  /** Say what is actually missing. Never render zeros as if they were measured. */
  detail?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * The empty state is the FIRST thing a new user sees, and the previous one was
 * effectively invisible: a 2%-white hatch with no plate, a micro-caps title, and
 * body copy in `--text-ghost` (L 0.45) on a dark ground — under 2:1 contrast.
 *
 * It is also the highest-stakes copy in the app, because it is where we explain
 * that the game must be run once. So it gets a real surface and real type: a
 * chamfered plate at full opacity, an inscriptional title at reading size, and
 * body text at a contrast a person can actually read.
 */
export function EmptyState({ title, detail, action, className }: EmptyStateProps) {
  return (
    /*
     * `mo-in-settle` is a TIME-BASED entrance, so it is transform only and it is
     * the settle rather than a fade: eighteen pixels of travel and six tenths of
     * a degree of rotation, on the spring curve, as if the plate had been set
     * down. A frozen document timeline leaves it eighteen pixels low and very
     * slightly askew - which on the highest-stakes copy in the app (this is where
     * we explain that the game has to be run once) is the only acceptable failure
     * mode. Anything that faded would have left a blank screen saying nothing.
     *
     * The plate itself takes the pointer light, for the same reason GoldPlate
     * does: it is a large flat surface, and a large flat surface with no response
     * to the cursor reads as a screenshot of a UI rather than a UI.
     */
    <div
      className={cx('mo-in-settle relative isolate flex flex-col items-center justify-center gap-4 text-center', className)}
      style={{ clipPath: CLIP.panel, padding: 1, background: ACCENTS.default.edge }}
    >
      <div
        className="mo-field mo-sheen flex w-full flex-1 flex-col items-center justify-center gap-4 px-8 py-12"
        style={{ clipPath: CLIP.panel, background: ACCENTS.default.fill }}
      >
        {/* The hatch stays, but as a faint texture INSIDE an opaque plate rather
            than as the surface itself. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'repeating-linear-gradient(135deg, oklch(1 0 0 / 0.02) 0 9px, transparent 9px 18px)',
          }}
        />

        <Ornament variant="crest" size={52} color="var(--color-orokin-600)" className="relative opacity-70" />

        <h2
          className="relative font-[family-name:var(--font-title)] text-[length:var(--text-lead)] tracking-[0.22em] uppercase"
          style={{ color: 'var(--color-orokin-300)' }}
        >
          {title}
        </h2>

        {detail != null && (
          <p
            className="wf-prose relative"
          >
            {detail}
          </p>
        )}

        {action != null && <div className="relative mt-2">{action}</div>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- Grid */


