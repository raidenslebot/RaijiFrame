/**
 * A Warframe mod card, drawn as the game draws one.
 *
 * WHY THIS IS SVG AND NOT A DIV
 * -----------------------------
 * The card's identity is GEOMETRY, and a rounded rectangle with a border is not
 * it: that is the shape every overlay ever pasted over a game, and the first
 * version of this strip shipped exactly that - a grey box with the mod's name
 * written in it as text.
 *
 * THE ANATOMY, TRACED RATHER THAN REMEMBERED
 * ------------------------------------------
 * Cropped out of the player's own 1680 x 1050 capture at 3x and measured: the
 * "Fever Strike" tray card, capture x 86..287, y 658..757. Four earlier passes
 * of this file worked from memory and produced a rectangle with a notch cut in
 * its top edge. The real card is none of that:
 *
 *   - 201 x 99 overall, in two pieces: a body 79 tall and a BASE PLATE under it.
 *   - Every corner of the body is chamfered about 12 px, so the body is an
 *     octagon and never reads as a rectangle.
 *   - A small CREST stands proud of the top edge at the centre. It is the
 *     detail that says Warframe before any colour does.
 *   - The base plate is a separate slab with pointed ends, and THE RANK PIPS
 *     LIVE ON IT. They are not inside the card; every pass before this put them
 *     there.
 *   - The drain tab hangs off the top right with its left edge cut at an angle,
 *     running out to the card's own right edge rather than floating inside it.
 *   - The frame is a THIN BRIGHT RIBBON over dark metal, not a thick coloured
 *     mat. Point-sampled, the frame's left edge is rgb(21,20,27) - nearly black
 *     - against rgb(79,70,66) along the top rail. Three passes matched the
 *     card's MEAN instead, which puts the whole object at one mid value, and
 *     that is precisely what makes a card look like a tile.
 *
 * NOT OWNED IS DRAWN, NOT WRITTEN. A mod the account holds is a lit card; one it
 * does not is the same silhouette gone dark, wearing the game's own empty-slot
 * dash. Nowhere does this component print the words "not owned".
 */

import type { Polarity } from '../data/modded';

/** The card's own coordinate space. Everything below is in these units. */
const W = 201;
const H = 99;

/* The body: an octagon with a crest standing on its top edge. */
const BODY = `M 12 4 L 88 4 L 92 0 L 109 0 L 113 4 L 189 4 L 201 16 L 201 66 L 189 78 L 12 78 L 0 66 L 0 16 Z`;
/** The same shape inset, so the band between the two IS the frame's thickness. */
const FACE = `M 15 8 L 186 8 L 197 18 L 197 64 L 186 74 L 15 74 L 4 64 L 4 18 Z`;
/*
 * The base plate, sampled down a column of the same card (capture x 140):
 * the body's own bottom rail at rgb(105,109,112), a gap, then the plate's top
 * edge at rgb(194,193,203) - the BRIGHTEST pixel anywhere on the card - a dark
 * trough, and a blue bar at rgb(114,154,184) carrying the rank pips. Drawing
 * the plate as a dark outlined hexagon, which the previous pass did, inverts
 * the one part of a game card that is genuinely bright.
 */
const BASE = `M 20 82 L 181 82 L 193 89 L 181 96 L 20 96 L 8 89 Z`;
/** The plate's lit top edge, the brightest line on the whole card. */
const PLATE_RAIL = `M 20 82.6 L 181 82.6`;
/** The lit rails on the body: the top edge, and the softer one along its foot. */
const RAIL_TOP = `M 12 4 L 88 4 L 92 0 L 109 0 L 113 4 L 189 4`;
const RAIL_FOOT = `M 13 77.4 L 188 77.4`;
/*
 * The drain tab, hung off the top right with its left edge cut.
 *
 * It sits in the card's top band and nowhere lower, because a two-line name -
 * "Primed Pressure Point" is the common case, not an edge case - needs the
 * whole middle of the face. One pass had the tab reaching to y 32 and the
 * name's first line ran underneath it.
 */
const TAB = `M 152 9 L 197 9 L 197 28 L 158 28 L 152 22 Z`;

/**
 * The seven school glyphs and the two slot markers, at 10 x 10.
 *
 * These are the shapes the drain tab carries in game (`11 -`, `7 V`, `5 |`).
 * Drawn rather than typed: no font on a player's machine has them, and a letter
 * standing in for a glyph is the tell that gives an overlay away instantly.
 */
const GLYPH: Readonly<Record<Polarity, string | null>> = {
  madurai: 'M1 2 L5 8 L9 2',
  vazarin: 'M2 1 L2 9 M2 1 A4 4 0 0 1 2 9',
  naramon: 'M1 5 L9 5 M3 3 L3 7 M7 3 L7 7',
  zenurik: 'M1 8 L1 2 L9 2',
  unairu: 'M1 8 A4 4 0 0 1 9 8',
  penjaga: 'M1 2 L1 5 A4 4 0 0 0 9 5 L9 2 M5 5 L5 9',
  umbra: 'M1 2 L1 6 A4 4 0 0 0 9 6 L9 2 M1 9 L9 9',
  universal: 'M2 5 A2 2 0 1 1 5 5 A2 2 0 1 0 8 5 A2 2 0 1 1 5 5 A2 2 0 1 0 2 5',
  none: null,
};

/**
 * Rarity is the frame's colour, sampled from the capture.
 *
 * Bronze / silver / gold are the game's three tiers; Primed and Galvanized mods
 * wear a cold steel-blue that reads as a different material entirely, which is
 * most of how a player spots one across the tray.
 */
function rarityVar(rarity: string | null, name: string): string {
  if (/^(Primed|Galvanized|Umbral|Sacrificial|Archon) /.test(name)) return 'var(--am-rarity-prime)';
  switch ((rarity ?? '').toLowerCase()) {
    case 'legendary':
      return 'var(--am-rarity-prime)';
    case 'rare':
      return 'var(--am-rarity-rare)';
    case 'uncommon':
      return 'var(--am-rarity-uncommon)';
    default:
      return 'var(--am-rarity-common)';
  }
}

export interface ModCardProps {
  name: string;
  rarity: string | null;
  polarity: Polarity;
  /** Drain at the shown rank, as the tab prints it. */
  drain: number;
  rank: number;
  maxRank: number;
  /** A lit card when the account holds it; a dark, dashed one when it does not. */
  owned: boolean;
  /** The rank the account already holds, so the pips show the move rather than a caption. */
  ownedRank?: number | null;
  /** 1 is the game's own size. */
  scale?: number;
  /** The overlay's own figure, in the gold the game reserves for one. */
  gain?: string;
}

export function ModCard({ name, rarity, polarity, drain, rank, maxRank, owned, ownedRank = null, scale = 1, gain }: ModCardProps) {
  const frame = rarityVar(rarity, name);
  // Gradient ids are document-global; two cards sharing one would share a rarity.
  const uid = name.replace(/[^a-z0-9]/gi, '');
  const glyph = GLYPH[polarity];
  const pips = Math.max(1, Math.min(maxRank, 10));
  /*
   * Two lines at most; the game wraps a long name and never shrinks it, and the
   * break drops the last word, which is where the game's own break falls.
   */
  const words = name.split(' ');
  const lines = name.length > 15 && words.length > 1 ? [words.slice(0, -1).join(' '), words[words.length - 1]!] : [name];
  /* The pips spread across the plate's waist, never past its pointed ends. */
  const pipGap = Math.min(11, 128 / Math.max(1, pips - 1));

  return (
    <svg
      className="am-card"
      width={W * scale}
      height={H * scale}
      viewBox={`0 0 ${String(W)} ${String(H)}`}
      role="img"
      aria-label={`${name}, rank ${String(rank)} of ${String(maxRank)}, drain ${String(drain)}${owned ? '' : ', not owned'}`}
    >
      <defs>
        {/* The face: cool and dark, falling away toward the lower right. */}
        <linearGradient id={`am-face-${uid}`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="var(--am-card-ink)" />
          <stop offset="0.5" stopColor="var(--am-card-ink)" />
          <stop offset="1" stopColor="var(--am-card-deep)" />
        </linearGradient>
        {/*
         * THE DIAGONAL. Every card in the game carries a hard wedge of light
         * across its face, bright at the upper left and gone by the lower
         * right. No mod art ships with this app and inventing one would be a lie
         * about what the overlay knows - but the light that falls on a card
         * belongs to the screen rather than to the art, so it can be drawn.
         */}
        <linearGradient id={`am-lit-${uid}`} x1="0.06" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="oklch(0.86 0.048 226)" stopOpacity="0.5" />
          <stop offset="0.26" stopColor="oklch(0.68 0.045 236)" stopOpacity="0.18" />
          <stop offset="0.64" stopColor="oklch(0.5 0.03 264)" stopOpacity="0" />
        </linearGradient>
        {/* The frame band: dark metal, with the rarity only as a tint over it. */}
        <linearGradient id={`am-band-${uid}`} x1="0" y1="0" x2="0.32" y2="1">
          <stop offset="0" stopColor={frame} stopOpacity="0.5" />
          <stop offset="0.3" stopColor={frame} stopOpacity="0.16" />
          <stop offset="1" stopColor={frame} stopOpacity="0.26" />
        </linearGradient>
        <clipPath id={`am-clip-${uid}`}>
          <path d={FACE} />
        </clipPath>
      </defs>

      {/*
       * THE FACE IS OPAQUE WHETHER OR NOT THE MOD IS OWNED.
       *
       * It used to be drawn at half opacity for a mod the account lacks, which
       * was fine while the card floated on the void and wrong the moment the
       * overlay began laying cards over the game's own: two mod names sat on
       * top of each other and neither could be read. "Not owned" is carried by
       * the dashed frame and the dimmed band, which is where it belongs.
       */}
      <g>
        {/* Frame first, then the face inside it. The band between them is the frame. */}
        <path d={BODY} fill="var(--am-frame-metal)" />
        <path d={BODY} fill={`url(#am-band-${uid})`} opacity={owned ? 1 : 0.55} />
        <path d={FACE} fill={`url(#am-face-${uid})`} />
        <path d={FACE} fill={`url(#am-lit-${uid})`} />

        {/*
         * THE POLARITY, LARGE AND ALMOST GONE. The face carries the one thing
         * the overlay knows and the player needs next: which polarity slot this
         * mod wants. The game marks an empty slot with this glyph at about this
         * weight, so it is the screen's own device rather than decoration.
         */}
        {glyph !== null && (
          <path
            d={glyph}
            transform="translate(74 20) scale(5.4)"
            fill="none"
            stroke={frame}
            strokeOpacity="0.13"
            strokeWidth="0.5"
            clipPath={`url(#am-clip-${uid})`}
          />
        )}
      </g>

      {/*
       * NOT OWNED IS DRAWN. A card the account holds keeps its lit rail and its
       * plate; one it does not loses the light and wears the game's empty-slot
       * dash around the same silhouette. The caption "not owned" sat under this
       * card for exactly one pass, and it is the tell that gives an overlay away.
       */}
      {owned ? (
        <>
          <path d={RAIL_TOP} fill="none" stroke="oklch(0.97 0.008 250)" strokeWidth="1.6" strokeOpacity="0.8" strokeLinejoin="miter" />
          <path d={RAIL_FOOT} fill="none" stroke="oklch(0.97 0.008 250)" strokeWidth="1.2" strokeOpacity="0.42" />
        </>
      ) : (
        <path d={BODY} fill="none" stroke={frame} strokeWidth="1.3" strokeOpacity="0.8" strokeDasharray="7 5" strokeLinejoin="miter" />
      )}

      {lines.map((line, i) => (
        <text key={line} x={W / 2} y={(lines.length === 1 ? 46 : 45) + i * 18} className="am-card-name" textAnchor="middle">
          {line}
        </text>
      ))}

      {/*
       * The drain tab. In game the number turns green when the polarity matches
       * the slot it is going into; the overlay has not worked out which slot yet,
       * so it stays neutral rather than claiming a saving it cannot support.
       */}
      <path d={TAB} fill="var(--am-chip-ink)" fillOpacity="0.95" />
      <path d={TAB} fill="none" stroke={frame} strokeWidth="1" strokeOpacity="0.5" strokeLinejoin="miter" />
      <text x={glyph === null ? 176 : 168} y="23.5" className="am-card-drain" textAnchor="middle">
        {drain}
      </text>
      {glyph !== null && <path d={glyph} transform="translate(178 14) scale(0.85)" fill="none" stroke={frame} strokeWidth="1.7" strokeLinecap="square" />}

      {/*
       * The overlay's own figure, low and to the right, under the name.
       *
       * It sat in the card's top left for one pass, where it fought the drain
       * tab across the card and collided outright with the first line of a
       * two-line name. Down here it is also the right reading order: WHICH mod,
       * then what it buys, then how far the rank has to go.
       */}
      {gain !== undefined && (
        <text x={190} y="71" className="am-card-gain" textAnchor="end">
          {gain}
        </text>
      )}

      {/*
       * THE BASE PLATE, and the pips on it. In game the rank is a bright bar
       * BELOW the card, not marks inside it. Solid to the rank the account
       * already holds, an open ring on every rank this plan would add, dim past
       * the target: the game's own fusion vocabulary, and the reason no caption
       * under this card has to read "3 to 5".
       */}
      <g opacity={owned ? 1 : 0.62}>
        <path d={BASE} fill="var(--am-plate-ink)" />
        <path d={BASE} fill={`url(#am-band-${uid})`} fillOpacity="0.5" />
        {/* The rank bar the pips sit on, muted blue rather than the pips' own cyan. */}
        <path d="M 44 89 L 157 89" stroke="var(--am-plate-bar)" strokeWidth="4.4" strokeOpacity="0.55" />
        <path d={PLATE_RAIL} stroke="var(--am-plate-lit)" strokeWidth="1.7" strokeOpacity={owned ? 0.95 : 0.5} />
        <path d={BASE} fill="none" stroke="var(--am-plate-lit)" strokeWidth="0.9" strokeOpacity="0.4" strokeLinejoin="miter" />
      </g>
      <g transform={`translate(${String(W / 2 - ((pips - 1) * pipGap) / 2)} 89)`}>
        {Array.from({ length: pips }, (_, i) => {
          const held = i < (ownedRank ?? 0);
          const added = !held && i < rank;
          return (
            <circle
              key={i}
              cx={i * pipGap}
              cy="0"
              r={added ? 2.7 : 2.2}
              className={held ? 'am-pip am-pip--on' : added ? 'am-pip am-pip--add' : 'am-pip'}
            />
          );
        })}
      </g>
    </svg>
  );
}
