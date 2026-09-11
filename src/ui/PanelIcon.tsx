/**
 * Rail icons.
 *
 * WHY THESE ARE DRAWN AND NOT TYPED
 * ─────────────────────────────────
 * The rail used Unicode dingbats — U+2726, U+2699, U+269C, U+2742 and friends.
 * Three problems, and they compound:
 *
 *   1. Several of them (the gear, the lightning bolt) are in ranges the platform
 *      renders from a COLOUR EMOJI font. On Windows that means a glossy
 *      multicolour bitmap dropped into a hairline monochrome UI. The project has
 *      an absolute no-emoji rule and those characters break it in practice even
 *      though they predate emoji as codepoints.
 *   2. Their metrics are whatever the fallback font decides. Weight, optical
 *      size and baseline vary per glyph, so the column never aligned.
 *   3. They are generic. A dingbat gear is the same gear every dashboard uses.
 *
 * Drawn as vectors they share one stroke weight, one 16x16 box and one optical
 * centre, and they can speak the game's own geometry — diamonds, hexagons,
 * chevrons and cut corners rather than rounded pictograms.
 *
 * All are `currentColor` so the rail's active/inactive colour drives them, and
 * all are stroke-based at 1.3 so they sit at the same visual weight as the
 * hairlines around them.
 */

export interface PanelIconProps {
  id: string;
  className?: string;
  size?: number;
}

/**
 * One path set per panel. Keyed by panel id so the registry carries no
 * presentation, and an unknown id degrades to a neutral mark rather than a gap.
 */
const PATHS: Record<string, React.ReactNode> = {
  // Platinum — two facets of a cut stone meeting on a vertical seam. Not a coin
  // and not a currency glyph: platinum in this game is a traded object, so the
  // mark is a gem being handed over rather than money in a slot.
  platinum: (
    <>
      <path d="M8 2.2 13.4 6 8 13.8 2.6 6Z" />
      <path d="M2.6 6h10.8" />
      <path d="M8 2.2V13.8" />
    </>
  ),
  // Progression — a waypoint diamond with a forward chevron: "where next".
  progression: (
    <>
      <path d="M8 1.6 14.4 8 8 14.4 1.6 8Z" />
      <path d="M6.2 8h3.6M8.4 6.4 10 8l-1.6 1.6" />
    </>
  ),

  // Star Chart — a body with an orbit crossing it.
  starchart: (
    <>
      <circle cx="8" cy="8" r="3.1" />
      <ellipse cx="8" cy="8" rx="6.6" ry="2.8" transform="rotate(-24 8 8)" />
    </>
  ),

  // Mastery — the Tenno rank sigil: a stacked chevron pair.
  mastery: (
    <>
      <path d="M2.6 9.4 8 4l5.4 5.4" />
      <path d="M2.6 12.8 8 7.4l5.4 5.4" />
    </>
  ),

  // Arsenal — a reticle. What you take into the field.
  arsenal: (
    <>
      <circle cx="8" cy="8" r="4.6" />
      <path d="M8 1.4v2.6M8 12v2.6M1.4 8H4M12 8h2.6" />
    </>
  ),

  // Collection — a filled grid of holdings.
  collection: (
    <>
      <path d="M2.4 2.4h4.4v4.4H2.4ZM9.2 2.4h4.4v4.4H9.2ZM2.4 9.2h4.4v4.4H2.4ZM9.2 9.2h4.4v4.4H9.2Z" />
    </>
  ),

  // Resources — a cut ingot, chamfered like every plate in the app.
  resources: (
    <>
      <path d="M4.4 3.2h7.2l2.2 3.4-5.8 6.2-5.8-6.2Z" />
      <path d="M1.8 6.6h12.4" />
    </>
  ),

  // Foundry — a crucible with rising heat. Replaces the emoji gear.
  foundry: (
    <>
      <path d="M3.4 6.6h9.2l-1.5 6.2a1 1 0 0 1-1 .8H5.9a1 1 0 0 1-1-.8Z" />
      <path d="M6.4 4.4V2.6M9.6 4.6V2.4" />
    </>
  ),

  // Focus — a lens: concentric, with a bright centre.
  focus: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <circle cx="8" cy="8" r="1.9" />
    </>
  ),

  // Intrinsics — a hexagonal skill cell with a rising bar.
  intrinsics: (
    <>
      <path d="M8 1.8 13.4 5v6L8 14.2 2.6 11V5Z" />
      <path d="M5.9 9.8V7.4M8 9.8V5.9M10.1 9.8V8.3" />
    </>
  ),

  // Syndicates — three affiliations meeting at a centre.
  syndicates: (
    <>
      <path d="M8 2.2 13 11H3Z" />
      <circle cx="8" cy="8.6" r="1.6" />
    </>
  ),

  // Nemesis — a fractured ring. The lich that holds your territory.
  nemesis: (
    <>
      <path d="M12.1 4.6a5.6 5.6 0 1 1-4.6-2.4" />
      <path d="M9.4 5.4 12.4 2M6.2 8l2.1 2.1 3.4-3.9" />
    </>
  ),

  // Daily — a half-filled dial: the day partly spent.
  daily: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 2.2a5.8 5.8 0 0 1 0 11.6Z" fill="currentColor" stroke="none" />
    </>
  ),

  // Worldstate — a clock face. What the world is doing, and for how long.
  worldstate: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.6V8l2.4 1.6" />
    </>
  ),
};

/** Neutral fallback so an unregistered panel still aligns in the column. */
const FALLBACK = <path d="M8 2.6 13.4 8 8 13.4 2.6 8Z" />;

export function PanelIcon({ id, className, size = 15 }: PanelIconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      aria-hidden
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[id] ?? FALLBACK}
    </svg>
  );
}
