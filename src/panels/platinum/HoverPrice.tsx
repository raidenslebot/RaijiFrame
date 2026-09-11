/**
 * The live price of whatever you are hovering, in game.
 *
 * THE CAPABILITY NOTHING WAS USING
 * ────────────────────────────────
 * Overwolf's game event provider reports the item under the cursor while
 * Warframe is running. That signal has been plumbed the whole way through this
 * app for a long time - `gep.ts` declares it, emits it; `background.ts` stores
 * it; `store.ts` holds it under a comment reading "Drives live pricing";
 * `mirror.ts` copies it to every overlay window - and until now nothing read it.
 * This is the consumer.
 *
 * It is the one thing this app can do that a website cannot, which is the whole
 * argument for it being an overlay: look at a drop in your own inventory, or at
 * a reward on the end-of-mission screen, and see what it sells for without
 * alt-tabbing, typing a name, or spelling "Akstiletto" correctly.
 *
 * THE NAME IS A PATH, NOT A LABEL
 * ───────────────────────────────
 * Overwolf's published sample is
 * `/Lotus/StoreItems/Types/Game/Projections/T1VoidProjectionWispPrimeABronze`.
 * Run it through `normaliseItemType` and it becomes the bare ItemType that both
 * the account and every catalogue here key on. So the join is exact - no OCR,
 * no fuzzy name matching, nothing to get subtly wrong.
 *
 * Relics are the one shape that needs care: their market rows carry no
 * refinement suffix, so `Bronze|Silver|Gold|Platinum` is stripped to find the
 * item and remembered to say WHICH refinement was quoted.
 *
 * ONE HOVER IS ONE REQUEST, AT HUMAN SPEED
 * ────────────────────────────────────────
 * Exactly the shape a courtesy rate limit was written for. The lookup is
 * debounced, deduplicated against the last item, and cached by the reader's own
 * TTL, so resting the cursor on something does not produce a burst.
 *
 * WHEN THE GAME IS CLOSED THIS RENDERS NOTHING. It never shows a remembered
 * hover: a stale price beside an item you are not looking at is worse than an
 * empty space.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAccount } from '../../core/store';
import { normaliseItemType } from '../../data/itemdb';
import { priceOf, type MarketCatalog, type Price } from '../../data/market';
import type { DucatDb } from '../../data/ducats';
import { CHAMFER } from '../../ui/geometry';

/** Relic paths end in a refinement the market does not model as a separate item. */
const REFINEMENT = /(Bronze|Silver|Gold|Platinum)$/;
const REFINEMENT_LABEL: Record<string, string> = {
  Bronze: 'Intact',
  Silver: 'Exceptional',
  Gold: 'Flawless',
  Platinum: 'Radiant',
};

/**
 * Everything about the hovered item that can be known WITHOUT a request.
 *
 * Derived, never stored. The identity of what is under the cursor is a pure
 * function of the signal and the catalogues, so putting it in state and
 * synchronising it with an effect would be the `set-state-in-effect` mistake
 * this codebase has now made four times. Only the price is genuinely
 * asynchronous, and only the price is state.
 */
interface Target {
  slug: string | null;
  name: string;
  ducats: number | null;
  refinement: string | null;
}

interface Quoted {
  slug: string;
  price: Price | null;
}

export function HoverPrice({ catalog, ducats }: { catalog: MarketCatalog | null; ducats: DucatDb | null }) {
  const highlighted = useAccount((s) => s.highlighted);
  const [quoted, setQuoted] = useState<Quoted | null>(null);

  const raw = highlighted?.name ?? null;

  /* Pure: who is under the cursor, and what is knowable for free. */
  const target = useMemo((): Target | null => {
    if (raw === null || !catalog || catalog.failed) return null;

    const bare = normaliseItemType(raw);
    const suffix = REFINEMENT.exec(bare)?.[1] ?? null;
    // Relics: strip the refinement to FIND the item, keep it to LABEL the quote.
    const lookup = suffix === null ? bare : bare.replace(REFINEMENT, '');
    const item = catalog.byGameRef.get(lookup) ?? catalog.byGameRef.get(bare);
    const duc = ducats ? (ducats.byItemType.get(bare) ?? null) : null;

    if (!item) return { slug: null, name: bare.split('/').pop() ?? bare, ducats: duc, refinement: null };
    return {
      slug: item.slug,
      name: item.name,
      ducats: duc,
      refinement: suffix ? (REFINEMENT_LABEL[suffix] ?? null) : null,
    };
  }, [raw, catalog, ducats]);

  const slug = target?.slug ?? null;

  /*
   * The only genuinely asynchronous part, and the only state.
   *
   * Debounced: sweeping the cursor across an inventory screen crosses dozens of
   * items, and only the one actually rested on is worth a request. Keyed by
   * slug, so resting on the same item again costs nothing and a late reply for
   * a previous item cannot overwrite the current one.
   */
  useEffect(() => {
    if (slug === null) return;
    let alive = true;
    const timer = setTimeout(() => {
      void priceOf(slug)
        .then((price) => {
          if (alive) setQuoted({ slug, price });
        })
        .catch(() => {
          if (alive) setQuoted({ slug, price: null });
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [slug]);

  // Game closed, nothing hovered, or nothing to say: render nothing at all.
  if (target === null) return null;

  const settled = slug === null || quoted?.slug === slug;
  const price = quoted?.slug === slug ? quoted.price : null;
  const quote = { name: target.name, ducats: target.ducats, refinement: target.refinement, price, settled };

  return (
    <div
      /*
        THIS BAR APPEARS BECAUSE THE PLAYER MOVED A CURSOR IN THE GAME, so it
        arrives rather than blinking into existence - mo-in-up, which is
        transform only, because the overlay can stop being presented in the same
        breath as the hover that produced it and a fade would strand the price
        at nothing. Offset by twelve pixels is the worst it can do.

        rf-lit gives it the pointer light every other readout in this panel has:
        it is a live figure on a flat plate, which is exactly what that class is
        for, and the document-level tracker already serves the selector.
      */
      className="mo-in-up rf-lit relative flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5"
      style={{ clipPath: CHAMFER, background: 'oklch(0.30 0.06 235 / 0.28)' }}
    >
      <span className="eyebrow" style={{ color: 'var(--color-tenno-300)' }}>
        Hovering in game
      </span>
      <span className="text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
        {quote.name}
      </span>
      {quote.refinement !== null && (
        <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
          {quote.refinement}
        </span>
      )}

      <span className="ml-auto" />

      {quote.ducats !== null && (
        <span className="numeric text-[length:var(--text-micro)]" style={{ color: 'var(--text-faint)' }}>
          {String(quote.ducats)} ducats
        </span>
      )}
      <span
        className="numeric text-[length:var(--text-small)]"
        style={{ color: quote.price ? 'var(--color-orokin-200)' : 'var(--text-faint)' }}
      >
        {quote.price
          ? `${String(quote.price.median)}p`
          : quote.settled
            ? 'no trades in 90d'
            : 'reading closed trades…'}
      </span>
      {quote.price && (
        <span className="eyebrow" style={{ color: 'var(--text-muted)' }}>
          {String(quote.price.volume)} a day
        </span>
      )}
    </div>
  );
}
