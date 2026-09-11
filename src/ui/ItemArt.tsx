import { useState } from 'react';

/**
 * ITEM ARTWORK.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The catalog panels list 800 Warframes, weapons and companions as rows of text.
 * Warframe's own UI never does that — its arsenal, its market and its codex are
 * built out of the item art, and a player recognises Ash Prime by its silhouette
 * long before they read the word. A text-only catalog is the single largest
 * reason these panels read as a spreadsheet rather than as a companion to the
 * game.
 *
 * 881 of the 882 catalog rows carry an `imageName`, and the art is served at
 * 512x512 from the same host the catalog itself comes from. It was already
 * available and simply unused.
 *
 * OWNERSHIP IS EXPRESSED THROUGH THE ART
 * ──────────────────────────────────────
 * An owned item renders in full colour; one you do not own renders desaturated
 * and dimmed. That single treatment does what a column of "yes/no" text cannot —
 * a grid becomes legible at a glance, and the thing you are missing is visibly
 * missing.
 *
 * Crucially, `owned` is TRI-STATE. `null` means unmeasured, and renders at an
 * intermediate treatment that is neither "you have it" nor "you don't" — because
 * before the game has run once we have no basis for either claim.
 *
 * COST
 * ────
 * `loading="lazy"` and `decoding="async"` mean the browser fetches only what
 * scrolls into view, so a 120-row page costs 120 requests at most rather than
 * 800. Explicit width and height prevent layout shift as each one lands.
 *
 * NO NETWORK IS A NORMAL STATE, NOT AN ERROR
 * ──────────────────────────────────────────
 * This app is expected to work with the game closed and, in the Overwolf build,
 * potentially offline. A failed image is not a broken panel: it falls back to a
 * chamfered plate carrying the item's initial, which keeps the row's rhythm and
 * remains identifiable. Nothing here is load-bearing for correctness — the art
 * is enrichment over data that is already complete.
 */

const CDN = 'https://cdn.warframestat.us/img/';

export interface ItemArtProps {
  /** WFCD's `imageName`, e.g. `AshPrime.png`. */
  imageName?: string | undefined;
  /**
   * Render at full strength, ignoring `owned`.
   *
   * For the one place the tri-state treatment stops making sense: a DETAIL view
   * of a single item. The dimming exists so that a grid of tiles reads at a
   * glance - the thing you are missing is visibly missing - and that is a
   * comparative signal with nothing to compare against when there is one tile.
   * All it does there is make a 64px illustration hard to see, which is the
   * opposite of why the row was opened. Ownership is stated in words in those
   * views, so nothing is lost by not also saying it in the art.
   */
  plain?: boolean;
  /** Item name — the alt text, and the source of the fallback initial. */
  name: string;
  /** true owned, false not owned, null unmeasured. */
  owned?: boolean | null;
  size?: number;
  className?: string;
}

/** Chamfer scaled to the tile, so small and large tiles cut alike. */
const clipFor = (size: number): string => {
  const c = Math.max(4, Math.round(size * 0.16));
  return `polygon(0 0, calc(100% - ${c}px) 0, 100% ${c}px, 100% 100%, ${c}px 100%, 0 calc(100% - ${c}px))`;
};

export function ItemArt({ imageName, name, owned = null, size = 40, className, plain = false }: ItemArtProps) {
  const [failed, setFailed] = useState(false);
  const clip = clipFor(size);

  // Three states, three treatments. Unmeasured deliberately sits between the
  // other two rather than borrowing either one's look.
  const treatment =
    plain || owned === true
      ? { filter: 'none', opacity: 1 }
      : owned === false
        ? { filter: 'grayscale(1) brightness(0.55)', opacity: 0.55 }
        : { filter: 'grayscale(0.55) brightness(0.8)', opacity: 0.8 };

  const shell: React.CSSProperties = {
    width: size,
    height: size,
    clipPath: clip,
    // A faint interior so the tile still reads as a plate while the image is
    // still in flight, rather than as a hole.
    background: 'linear-gradient(155deg, oklch(1 0 0 / 0.055), oklch(1 0 0 / 0.015))',
  };

  if (!imageName || failed) {
    return (
      <div
        className={className}
        style={{ ...shell, display: 'grid', placeItems: 'center', flexShrink: 0 }}
        aria-hidden
        title={name}
      >
        <span
          className="font-[family-name:var(--font-title)]"
          style={{ fontSize: Math.round(size * 0.42), color: 'var(--text-ghost)', lineHeight: 1 }}
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      </div>
    );
  }

  return (
    <div className={className} style={{ ...shell, flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
      <img
        src={`${CDN}${imageName}`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
          transition: 'filter 220ms ease-out, opacity 220ms ease-out',
          ...treatment,
        }}
      />
    </div>
  );
}
