/**
 * What to sell, out of what you actually hold.
 *
 * THE TWO-STAGE RANKING, AND WHY IT IS TWO STAGES
 * ───────────────────────────────────────────────
 * Pricing is ONE REQUEST PER ITEM. There is no bulk endpoint, and the whole app
 * shares a single token bucket. A mature account holds several hundred sellable
 * stacks, so pricing everything would take many minutes - by which time the
 * first quote and the last would describe different markets, and a total summed
 * across them would be internally incoherent. A number like that is worse than
 * no number, because it looks authoritative.
 *
 * So:
 *
 *   STAGE 1 ranks EVERYTHING you hold, for free, with no network at all, using
 *   the Ducat value - a published constant, exact, identical for every player.
 *   100 per cent coverage, instantly, and it works with the game closed.
 *
 *   STAGE 2 spends a bounded budget of real requests on the top of that list
 *   only, and it happens when you ask for it. Everything below the cut says so
 *   in words rather than showing a zero.
 *
 * THE DECISION THIS PANEL EXISTS TO MAKE
 * ──────────────────────────────────────
 * Not "what is my inventory worth" - that is unanswerable and nobody acts on it.
 * The real question is per item: SELL IT, OR TURN IT INTO DUCATS? A part worth
 * 1p and 25 ducats should never occupy a trade; a part worth 40p and 15 ducats
 * should never go near the kiosk. Once both numbers are on screen the answer is
 * immediate, and it is the single most common decision a Warframe player makes
 * with their loot.
 *
 * TRADES ARE THE REAL CONSTRAINT
 * ──────────────────────────────
 * Six items per side per trade, and the daily cap is your Mastery Rank. So the
 * useful unit is platinum PER TRADE, not per item, and a large stack of cheap
 * things can be worth less than one good part while costing a week of trading.
 * Every row states what it would cost you in trades.
 */

import { useMemo, useState } from 'react';
import type { DucatDb } from '../../data/ducats';
import { holdingsOf, tradesFor, type Holding } from '../../data/plat-value';
import { ordersOf, type MarketCatalog, type OrderBook } from '../../data/market';
import { LiveOrders, PriceHistory } from '../../ui/MarketDepth';
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { staggerFor } from '../../ui/stagger';
import { CHAMFER, PLATE_COOL as PLATE } from '../../ui/geometry';

/**
 * How far down the list the panel's own pricing pass reaches.
 *
 * This is not a decision made here any more - the pass runs in the panel above,
 * on open, and this constant only has to agree with it so the copy at the foot
 * of the list states the right cut. See `plat-autoprice.ts` for why the button
 * that used to sit here is gone.
 */
const PRICE_CAP = 24;

/*
 * The starting position of the exchange-rate control, NOT a measured constant.
 *
 * There is no published rate at which Ducats convert to platinum - the two are
 * bought and sold in different places, for different things, and what a Ducat is
 * worth to YOU depends entirely on whether you want anything Baro is selling
 * this fortnight. So the app refuses to assert one and asks instead. Ten is
 * simply where the slider starts, and the label says so in as many words.
 */
const DEFAULT_RATE = 10;

type Sort = 'ducats' | 'plat' | 'perTrade';

/**
 * What opens when you click one of your own parts.
 *
 * The row can only carry four numbers, and the interesting thing about a quote
 * is never the median on its own - it is how WIDE the market is around it and
 * how OFTEN it clears. A part with a 40p median and two trades a day is a very
 * different proposition from one with a 40p median and sixty, and the row has
 * no room to say so.
 *
 * Everything here is measured. The bar is drawn from the day's real low, high
 * and median with the trailing median marked on it, so a quote sitting at the
 * top of its own range is visible as a shape rather than stated as an opinion.
 */
/**
 * WHO IS SELLING THIS, RIGHT NOW.
 *
 * WHY A MEDIAN WAS NEVER ENOUGH
 * ————————————————————————————————————————————
 * Every figure in this panel is a median of CLOSED trades - what people paid,
 * over ninety days. That is the right number for valuing a stack and the wrong
 * one for trading: it cannot tell you the part is listed by four people at 12p,
 * that two of them are in the game this minute, or that the cheapest one wants
 * you to take all six.
 *
 * So this reads the live order book, and it reads it ONLY when a row is
 * opened. There is no bulk path: pricing a whole inventory eagerly would be
 * thousands of requests against a volunteer-run service, and the file's own
 * header forbids it.
 *
 * THREE STATES, KEPT APART
 * ────────────────────────
 * Loading, "nobody is listing this", and "the request failed" are different
 * facts and are never collapsed. An empty book is a real answer about the
 * market; a failed one is an answer about us.
 */
function StockDetail({ h, rate }: { h: Holding; rate: number }) {
  const price = h.price;
  const trades = tradesFor(h.count);
  const perPlat = price === null || h.ducats === null || price.median <= 0 ? null : h.ducats / price.median;

  /*
   * Where a value sits along the bar, as a fraction.
   *
   * The span is the day's low and high WIDENED to include the trailing median,
   * because that median is taken over ninety days and routinely sits outside a
   * single day's range - a part that traded at 35-40p today with a 41p window
   * median is completely normal. Scaling to the day alone would clamp that mark
   * to the end of the bar and quietly draw it as equal to the high, which is
   * the kind of small lie this project exists to refuse.
   */
  const at = (v: number): number => {
    if (price === null) return 0;
    const lo = Math.min(price.min, price.trend);
    const hi = Math.max(price.max, price.trend);
    const span = hi - lo;
    if (span <= 0) return 0.5;
    return Math.min(1, Math.max(0, (v - lo) / span));
  };

  return (
    <div className="rf-open mt-2 flex flex-col gap-3 border-l pl-3.5" style={{ borderColor: 'var(--hairline)' }}>
      {price === null ? (
        /* A div, not a paragraph: Clamp renders a div and would close a <p>
           early. The refusal itself stays on screen - only its second half
           folds - because it is this row's answer. */
        <div className="text-[length:var(--text-micro)] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
          <Clamp lines={1}>
            No quote for this one. Either it sits below the pricing cut, or nothing has closed on it in ninety days -
            those are different facts and the row says which. The ducat figure beside it is exact either way.
          </Clamp>
        </div>
      ) : (
        <>
          {/* the day's real range, drawn */}
          <div>
            <div className="flex items-baseline gap-x-2">
              <span className="numeric leading-none" style={{ fontSize: 'var(--text-lead)', color: 'var(--color-tenno-300)' }}>
                {price.median}p
              </span>
              <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
                median of the last closed day
              </span>
            </div>

            <div className="relative mt-2 h-[18px] max-w-[26rem]">
              <span
                aria-hidden
                className="absolute top-[8px] right-0 left-0 h-px"
                style={{ background: 'linear-gradient(to right, transparent, var(--color-tenno-400), transparent)' }}
              />
              <span
                aria-hidden
                className="rf-mark absolute top-[3px] h-[11px] w-[2px]"
                style={{ left: `calc(${String(Math.round(at(price.median) * 100))}% - 1px)`, background: 'var(--color-tenno-200)' }}
              />
              <span
                aria-hidden
                className="rf-mark absolute top-[5px] h-[7px] w-px"
                style={{
                  left: `calc(${String(Math.round(at(price.trend) * 100))}% - 0.5px)`,
                  background: 'var(--color-orokin-300)',
                  animationDelay: '70ms',
                }}
              />
            </div>

            <div className="flex max-w-[26rem] justify-between">
              <span className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--text-faint)' }}>
                {price.min}p low
              </span>
              <span className="text-[length:var(--text-nano)]" style={{ color: 'var(--color-orokin-300)' }}>
                {price.trend}p across the window
              </span>
              <span className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--text-faint)' }}>
                {price.max}p high
              </span>
            </div>
          </div>

          {/* how fast it moves, and what the stack comes to */}
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span className="text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
              <span className="numeric" style={{ color: 'var(--text)' }}>
                {price.volume}
              </span>{' '}
              closed that day &mdash; {price.volume >= 20 ? 'it moves' : price.volume >= 5 ? 'it moves slowly' : 'it barely moves'}
            </span>
            <span className="text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
              <span className="numeric" style={{ color: 'var(--text)' }}>
                {Math.round((h.worth ?? 0)).toLocaleString()}p
              </span>{' '}
              for all {h.count.toLocaleString()}, across {String(trades)} {trades === 1 ? 'trade' : 'trades'}
            </span>
            <span className="text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
              <span className="numeric" style={{ color: 'var(--text)' }}>
                {h.worth === null ? '—' : String(Math.round(h.worth / Math.max(1, trades)))}p
              </span>{' '}
              for each trade it costs you
            </span>
          </div>

          {/* the decision, spelled out against YOUR line */}
          {perPlat !== null && (
            <p className="wf-prose">
              Ducating one of these yields <span className="numeric">{h.ducats}</span> ducats and gives up{' '}
              <span className="numeric">{price.median}</span> platinum, so it trades at{' '}
              <span className="numeric" style={{ color: 'var(--text)' }}>
                {perPlat.toFixed(1)}
              </span>{' '}
              ducats to the platinum. Your line is {String(rate)}, which is why this reads{' '}
              <span style={{ color: perPlat >= rate ? 'var(--color-orokin-300)' : 'var(--color-signal-good)' }}>
                {perPlat >= rate ? 'ducat it' : 'sell it'}
              </span>
              .
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function SellStock({
  account,
  catalog,
  ducats,
  priced,
  pricing,
}: {
  account: Record<string, unknown> | null;
  catalog: MarketCatalog | null;
  ducats: DucatDb | null;
  /**
   * The same holdings, with real quotes on the top of them - priced by the
   * panel's automatic pass rather than by anything in here. Null until that
   * pass has landed, which is a different state from "worth nothing".
   */
  priced: readonly Holding[] | null;
  /** True while that pass is still running, so the list can say so. */
  pricing: boolean;
}) {
  const [sort, setSort] = useState<Sort>('ducats');
  const [open, setOpen] = useState<string | null>(null);
  /*
   * Live order books, keyed by market slug, fetched when a row is OPENED.
   *
   * A map rather than one value so closing and reopening a row it already read
   * is instant, and so opening a second row does not throw away the first. The
   * gentle layer caches underneath as well; this is only about not making the
   * component ask twice for something it is already holding.
   */
  const [books, setBooks] = useState<ReadonlyMap<string, OrderBook | 'failed'>>(() => new Map());

  const openRow = (h: Holding, isOpen: boolean): void => {
    setOpen(isOpen ? null : h.gameRef);
    if (isOpen || books.has(h.slug)) return;
    // Fired from a click, never from an effect: this is the event that means
    // "somebody wants to see this", and it is the only thing that may spend a
    // request. There is no path here that reads more than one item.
    void ordersOf(h.slug).then((b) => {
      setBooks((prev) => new Map(prev).set(h.slug, b ?? 'failed'));
    });
  };
  const [query, setQuery] = useState('');
  const [rate, setRate] = useState(DEFAULT_RATE);

  /* Stage 1: free, exact, and over everything. */
  const base = useMemo(() => (catalog ? holdingsOf(account, catalog, ducats) : []), [account, catalog, ducats]);

  const rows = useMemo(() => {
    const source = priced ?? base;
    const q = query.trim().toLowerCase();
    const filtered = q === '' ? source : source.filter((h) => h.name.toLowerCase().includes(q));
    const key = (h: Holding): number => {
      if (sort === 'ducats') return h.ducatWorth ?? -1;
      if (sort === 'plat') return h.worth ?? -1;
      // Platinum per trade: what the stack earns for each trade it consumes.
      return h.worth === null ? -1 : h.worth / Math.max(1, tradesFor(h.count));
    };
    return [...filtered].sort((a, b) => key(b) - key(a) || a.name.localeCompare(b.name));
  }, [priced, base, sort, query]);

  const ducatTotal = base.reduce((n, h) => n + (h.ducatWorth ?? 0), 0);
  const ducatKnown = base.filter((h) => h.ducats !== null).length;

  /*
   * DEFECT: "no trades in 90d" vs "not priced" used to be decided from `i`,
   * the row's index in `rows` - the CURRENTLY SORTED AND FILTERED list. The
   * pricing pass itself runs over `holdingsOf`'s ducat-ranked order and stops
   * at PRICE_CAP, an order `rows` only matches when the sort is "by ducats"
   * and the name filter is empty. Sort by platinum, or type into the filter,
   * and `i` no longer lines up with the cut: a stack that was never asked
   * about lands inside the first PRICE_CAP rows of the new order and is told
   * "no trades in 90d" - a claim about the market that was never checked.
   *
   * `priced` (this component's own prop) is never re-sorted - it is `base`
   * with quotes merged in, still in the ducat-ranked order the pricing pass
   * used - so its own first PRICE_CAP slugs are exactly the shortlist that
   * was actually asked about, independent of how `rows` ends up displayed.
   */
  const askedSlugs = useMemo(() => new Set((priced ?? []).slice(0, PRICE_CAP).map((h) => h.slug)), [priced]);

  if (account === null) {
    return (
      <div className="rf-plate px-5 py-8 text-center" style={{ clipPath: CHAMFER, background: PLATE }}>
        <p className="wf-note">
          This account has never sent an inventory.
        </p>
        <p className="wf-prose mx-auto mt-2">
          Nothing here is a zero — it is unread. Open Warframe once and what you hold appears, ranked by what it is
          worth, and stays here afterwards with the game closed.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ---- what the whole stock is worth in the currency that is exact ---- */}
      <div className="rf-plate rf-lit relative px-5 py-4" style={{ clipPath: CHAMFER, background: PLATE }}>
        <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[3px]" style={{ background: 'var(--color-orokin-300)' }} />
        <div className="eyebrow">Your sellable stock</div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="numeric text-[length:var(--text-title)] leading-none" style={{ color: 'var(--color-orokin-200)' }}>
            {ducatTotal.toLocaleString()}
          </span>
          <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
            ducats sitting in prime parts — exact, and free to compute
          </span>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
          <span className="eyebrow" style={{ color: 'var(--text-muted)' }}>
            {String(base.length)} tradeable stacks · {String(ducatKnown)} with a ducat price
          </span>
          <span className="eyebrow" style={{ color: 'var(--text-muted)' }}>
            {String(base.reduce((n, h) => n + tradesFor(h.count), 0))} trades to sell all of it
          </span>
        </div>
        {/* An ABSENCE explained. The closed row says the missing number is
            missing on purpose, which is the whole point of the paragraph; the
            reasoning behind it is one press down. */}
        <div className="mt-2.5">
          <Disclosure
            eyebrow="a number this panel refuses to print"
            summary="There is deliberately no platinum total"
            answer="no single moment to total"
          >
            <p className="wf-prose">
              Pricing is one request per item, so a whole-inventory sweep would take many minutes and the first quote
              would be stale before the last arrived. A total summed across them would not describe any single moment.
            </p>
            <p className="wf-prose mt-2">
              The ducat figure has no such problem: it is a published constant.
            </p>
          </Disclosure>
        </div>
      </div>

      {/* ---- controls ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow" style={{ color: pricing ? 'var(--color-orokin-300)' : 'var(--text-faint)' }}>
          {pricing ? 'Reading closed trades' : priced ? `top ${String(PRICE_CAP)} priced` : 'ranked by ducats'}
        </span>

        {(['ducats', 'plat', 'perTrade'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSort(s)}
            disabled={s !== 'ducats' && priced === null}
            aria-pressed={sort === s}
            className="rf-clipped mo-field mo-lift mo-focusable px-3 py-1.5 text-[length:var(--text-micro)] tracking-[0.18em] uppercase"
            style={{
              clipPath: CHAMFER,
              background: sort === s ? 'oklch(0.30 0.06 235 / 0.4)' : 'oklch(1 0 0 / 0.03)',
              color: s !== 'ducats' && priced === null ? 'var(--text-ghost)' : sort === s ? 'var(--text)' : 'var(--text-muted)',
              cursor: s !== 'ducats' && priced === null ? 'default' : 'pointer',
            }}
          >
            {s === 'ducats' ? 'By ducats' : s === 'plat' ? 'By platinum' : 'Per trade'}
          </button>
        ))}

        <label className="flex items-center gap-2">
          <span className="eyebrow whitespace-nowrap" style={{ color: 'var(--text-faint)' }}>
            1p is worth
          </span>
          <input
            type="range"
            min={2}
            max={30}
            step={1}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            className="mo-focusable w-28"
            aria-label="How many ducats you consider one platinum to be worth"
          />
          <span className="numeric text-[length:var(--text-micro)] whitespace-nowrap" style={{ color: 'var(--text)' }}>
            {String(rate)}d
          </span>
        </label>

        <label className="ml-auto">
          <span className="sr-only">Filter your stock by name</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name"
            className="mo-focusable w-56 bg-transparent px-3 py-1.5 text-[length:var(--text-micro)] outline-none"
            style={{ clipPath: CHAMFER, background: 'oklch(0.08 0.02 275)', color: 'var(--text)' }}
          />
        </label>
      </div>

      {/* ---- the list ---- */}
      <style>{`
        /*
          TRANSFORM ONLY. Not opacity, not width, not height. The overlay's
          document timeline stops the moment the host stops presenting the
          window, and a paused animation reports playState "running" with
          currentTime 0 forever - so anything that begins at zero width or zero
          opacity stays there permanently. A range bar that animates its own
          fill is exactly that trap, which is why the bar is drawn whole and
          only the markers travel.
        */
        @keyframes rf-mark-in { from { transform: translate3d(0,3px,0); } to { transform: none; } }
        @keyframes rf-open-in { from { transform: translate3d(-8px,0,0); } to { transform: none; } }
        .rf-mark { animation: rf-mark-in 320ms cubic-bezier(0.16, 1, 0.3, 1) backwards; }
        .rf-open { animation: rf-open-in 260ms cubic-bezier(0.16, 1, 0.3, 1) backwards; }
        .rf-chev { transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1); }
        @media (prefers-reduced-motion: reduce) {
          .rf-mark, .rf-open { animation: none; }
          .rf-chev { transition: none; }
        }
      `}</style>
      {/* The stagger the rows already carried a delay for. Every row set an
          animationDelay and no rule anywhere gave them an animation to delay,
          so the prop had been inert since it was written; rf-staged is the
          transform-only entrance it was always describing. */}
      <ul className="rf-staged flex flex-col gap-[3px]" style={staggerFor(Math.min(rows.length, 200))}>
        {rows.slice(0, 200).map((h, i) => {
          const trades = tradesFor(h.count);
          const perTrade = h.worth === null ? null : h.worth / Math.max(1, trades);
          /*
           * The verdict, against the rate YOU set.
           *
           * Only stated when both numbers are known - with one side missing
           * there is nothing to compare, and guessing which is larger is exactly
           * the invented judgment this project refuses.
           *
           * `perPlat` is the honest quantity underneath it: how many Ducats this
           * part yields for each platinum you give up by not selling it. That
           * number is measured. Where the line falls is a preference, and it is
           * the slider above, not a constant hidden in here.
           */
          const perPlat = h.price === null || h.ducats === null || h.price.median <= 0 ? null : h.ducats / h.price.median;
          const verdict = perPlat === null ? null : perPlat >= rate ? 'ducats' : 'sell';

          const isOpen = open === h.gameRef;

          return (
            <li
              key={h.gameRef}
              className="rf-row px-3.5 py-2"
              style={{
                clipPath: CHAMFER,
                background: isOpen ? 'oklch(1 0 0 / 0.05)' : 'var(--plate-lift)',
                // The stagger, capped: past four hundred milliseconds the eye
                // has stopped reading a list as one gesture. Transform only, so
                // a frozen timeline leaves a row eight pixels low rather than
                // absent.
                animationDelay: `${String(Math.min(400, i * 12))}ms`,
              }}
            >
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => {
                openRow(h, isOpen);
              }}
              /* The focus bloom goes on the BUTTON, not the row. theme.css lights
                 a row on :focus-visible, and focus never lands on the row - it
                 lands here, on the control inside it - so a keyboard user tabbing
                 down this list had no arrival signal at all. */
              className="mo-focusable flex w-full cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 text-left"
            >
              <span
                aria-hidden
                className="rf-chev shrink-0 text-[length:var(--text-nano)]"
                style={{ color: isOpen ? 'var(--color-orokin-300)' : 'var(--text-ghost)', transform: isOpen ? 'rotate(90deg)' : 'none' }}
              >
                &rsaquo;
              </span>
              <span className="truncate text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
                {h.name}
              </span>
              <span className="numeric eyebrow shrink-0" style={{ color: 'var(--text-faint)' }}>
                ×{h.count.toLocaleString()}
              </span>
              {trades > 1 && (
                <span className="eyebrow shrink-0" style={{ color: 'var(--text-ghost)' }} title="Six items per side, per trade">
                  {String(trades)} trades
                </span>
              )}

              <span className="ml-auto shrink-0" />

              {verdict !== null && (
                <span
                  className="eyebrow shrink-0 px-1.5"
                  style={{
                    color: verdict === 'sell' ? 'var(--color-signal-good)' : 'var(--color-orokin-300)',
                    background: 'oklch(1 0 0 / 0.04)',
                  }}
                >
                  {verdict === 'sell' ? 'sell it' : 'ducat it'}
                </span>
              )}

              {perPlat !== null && (
                <span
                  className="numeric w-24 shrink-0 text-right text-[length:var(--text-nano)]"
                  style={{ color: 'var(--text-ghost)' }}
                  title="Ducats you get for each platinum you give up by not selling it"
                >
                  {perPlat.toFixed(1)} d/p
                </span>
              )}

              <span
                className="numeric w-20 shrink-0 text-right text-[length:var(--text-micro)]"
                style={{ color: 'var(--text-faint)' }}
                title="Ducats for the whole stack, at the kiosk"
              >
                {h.ducatWorth === null ? '—' : `${h.ducatWorth.toLocaleString()}d`}
              </span>

              <span
                className="numeric w-24 shrink-0 text-right text-[length:var(--text-micro)]"
                style={{ color: h.worth === null ? 'var(--text-ghost)' : 'var(--color-tenno-300)' }}
                title={h.price ? `${String(h.price.median)}p median, ${String(h.price.volume)} trades a day` : undefined}
              >
                {h.worth !== null
                  ? `${Math.round(h.worth).toLocaleString()}p`
                  : priced === null
                    ? ''
                    : askedSlugs.has(h.slug)
                      ? 'no trades in 90d'
                      : 'not priced'}
              </span>

              {sort === 'perTrade' && (
                <span className="numeric w-20 shrink-0 text-right text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
                  {perTrade === null ? '—' : `${String(Math.round(perTrade))}p/tr`}
                </span>
              )}
            </button>

            {isOpen && (
              <>
                <StockDetail h={h} rate={rate} />
                {/* The live book sits under the ninety-day picture, because it
                    answers the other question: not what this is worth, but what
                    you could buy or undercut it at this minute. Fetched only
                    now, when a row is actually open. */}
                <div className="flex flex-col gap-3 px-3.5 pb-3">
                  {/* Ninety days first, then who is selling right now: what it
                      has been worth, then what you can do about it today. */}
                  {h.price !== null && <PriceHistory history={h.price.history} />}
                  <LiveOrders book={books.get(h.slug) ?? null} />
                </div>
              </>
            )}
            </li>
          );
        })}

        {rows.length === 0 && (
          <li className="eyebrow px-3.5 py-3" style={{ color: 'var(--text-faint)' }}>
            {catalog === null
              ? 'Reading the market catalogue'
              : query.trim() !== ''
                ? 'Nothing you hold matches that'
                : 'Nothing in this account read joins the tradeable catalogue'}
          </li>
        )}
      </ul>

      {rows.length > 200 && (
        <p className="eyebrow" style={{ color: 'var(--text-faint)' }}>
          Showing the top 200 of {String(rows.length)} — filter by name to reach the rest.
        </p>
      )}

      {/*
        TWO FOOTNOTES, NESTED UNDER WHAT THEY ANNOTATE.

        Both were full paragraphs printed under the list every time a pass
        landed - the last thing on a long screen and the least likely to be
        read there. Each closed row now carries its own conclusion: how far
        the pass reached, and who chose the exchange line.
      */}
      {priced !== null && (
        <div className="flex flex-col gap-1">
          <Disclosure
            eyebrow="how far the pass reached"
            summary={`Priced the top ${String(PRICE_CAP)} by ducat value`}
            answer="past that is unquoted, not worthless"
          >
            <p className="wf-prose">
              Rows past the cut say &ldquo;not priced&rdquo; rather than showing a zero &mdash; they were never
              quoted, which is a different fact from being worth nothing.
            </p>
          </Disclosure>

          <Disclosure
            accent="var(--color-orokin-300)"
            eyebrow="who drew the line"
            summary="The exchange rate is yours to set"
            answer={`currently ${String(rate)} ducats to 1p`}
          >
            <p className="wf-prose">
              No published rate converts Ducats to platinum &mdash; what a Ducat is worth depends entirely on whether
              you want anything Baro is selling this fortnight, so the app will not assert one.
            </p>
            <p className="wf-prose mt-2">
              The <span className="numeric">d/p</span> column is the measured part: how many Ducats a part yields for
              each platinum you give up by not selling it. The slider is where you choose to draw the line, and
              &ldquo;ducat it&rdquo; simply means that row is above it.
            </p>
          </Disclosure>
        </div>
      )}
    </div>
  );
}
