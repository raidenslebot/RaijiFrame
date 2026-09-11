/**
 * HOW MUCH, AND THEN: HOW DO YOU KNOW?
 * ————————————————————————————————————————————
 * Every price this app shows is a median of closed trades, and a median is the
 * end of a conversation rather than the start of one. A reader who accepts it
 * learns nothing; a reader who does not has nowhere to go.
 *
 * These two are that somewhere. The history says what the number has been for
 * ninety days - already in the same response the median came from, and
 * previously discarded. The order book says who is selling it this minute and
 * whether they are in the game, which no median can carry at all.
 *
 * They live here rather than in one panel because the question is not the
 * panel's: a card that suggests selling something and a row that lists it
 * both have to answer "how do you know", and they should answer it the same
 * way.
 *
 * BOTH ARE POINTER-DRIVEN, WHICH IS WHY THEY ARE SAFE.
 * This overlay's document timeline stops while the window is unpresented, so
 * anything time-based can strand at frame zero. A reading scrubbed from
 * pointer position is recomputed per event and has no timeline to strand in;
 * the resting state is the whole series, drawn, with the latest day named.
 */

import { useState } from 'react';
import { type OrderBook, type PriceDay } from '../data/market';

/**
 * NINETY DAYS, WHICH WERE ALREADY IN THE RESPONSE.
 * ————————————————————————————————————————————
 * The statistics request returns up to ninety daily closes and the parse used
 * to reduce them to six numbers and drop the rest. A median says what a part is
 * worth; the series says whether it is climbing, whether the last close was a
 * fluke, and whether anybody trades it in a normal week. All of it arrived in
 * the same request, and none of it was shown.
 *
 * SCRUBBED BY THE POINTER, WHICH IS WHY IT IS SAFE.
 * A day is read by moving across the chart, so the reading is recomputed per
 * pointer event and never interpolated. This overlay's document timeline stops
 * when the window is unpresented, and anything time-based can strand at frame
 * zero - input-driven motion cannot, because there is no timeline in it. The
 * resting state is the whole series, fully drawn, with the latest day named.
 */
export function PriceHistory({ history }: { history: readonly PriceDay[] }) {
  const [at, setAt] = useState<number | null>(null);
  if (history.length < 2) return null;

  const medians = history.map((d) => d.median);
  const lo = Math.min(...medians);
  const hi = Math.max(...medians);
  const span = hi - lo || 1;
  const W = 240;
  const H = 34;
  const x = (i: number): number => (i / (history.length - 1)) * W;
  const y = (v: number): number => H - ((v - lo) / span) * H;
  const path = history.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(d.median).toFixed(1)}`).join(' ');

  const shown = at === null ? history[history.length - 1] : history[at];
  const first = history[0];
  const climbing = shown !== undefined && first !== undefined && shown.median > first.median;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
          {`${String(history.length)} days of closes`}
        </span>
        {shown !== undefined && (
          <span className="numeric text-[length:var(--text-micro)]" style={{ color: 'var(--color-tenno-200)' }}>
            {`${String(shown.median)}p`}
            <span className="eyebrow ml-2" style={{ color: 'var(--text-faint)' }}>
              {shown.at.slice(0, 10)}
            </span>
          </span>
        )}
        <span className="eyebrow ml-auto" style={{ color: climbing ? 'var(--color-signal-good)' : 'var(--text-faint)' }}>
          {`${String(lo)}p to ${String(hi)}p over the window`}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        width="100%"
        height={H}
        role="img"
        aria-label={`Closing price over ${String(history.length)} days, ${String(lo)} to ${String(hi)} platinum`}
        style={{ display: 'block', overflow: 'visible' }}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          if (box.width === 0) return;
          const f = (e.clientX - box.left) / box.width;
          setAt(Math.max(0, Math.min(history.length - 1, Math.round(f * (history.length - 1)))));
        }}
        onPointerLeave={() => {
          setAt(null);
        }}
      >
        <path d={path} fill="none" stroke="var(--color-tenno-300)" strokeWidth={1.4} strokeLinejoin="round" />
        {shown !== undefined && at !== null && (
          <g>
            <line x1={x(at)} y1={0} x2={x(at)} y2={H} stroke="var(--color-orokin-300)" strokeWidth={0.8} opacity={0.6} />
            <circle cx={x(at)} cy={y(shown.median)} r={2.4} fill="var(--color-orokin-300)" />
          </g>
        )}
      </svg>
    </div>
  );
}

export function LiveOrders({ book }: { book: OrderBook | null | 'failed' }) {
  /*
   * PURELY PRESENTATIONAL, AND THAT IS THE POINT.
   *
   * The first version fetched for itself in a `useEffect` and set state when
   * the promise landed. `react-hooks/set-state-in-effect` rejected it, and the
   * rule is right: opening a row is an EVENT, so the request belongs in the
   * handler that opens it, not in an effect reacting to the component having
   * appeared. The distinction is not pedantry - an effect-driven fetch also
   * re-runs on every remount, and this list remounts on every sort.
   *
   * The parent owns the request and hands the answer down.
   */
  if (book === null) {
    return (
      <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
        reading the live listings
      </span>
    );
  }
  if (book === 'failed') {
    return (
      <span className="eyebrow" style={{ color: 'var(--text-ghost)' }}>
        the live listings could not be read just now &mdash; the median above is unaffected
      </span>
    );
  }
  if (book.sell.length === 0) {
    return (
      <span className="eyebrow" style={{ color: 'var(--text-ghost)' }}>
        nobody is listing this on the market right now
      </span>
    );
  }

  const top = book.live.length > 0 ? book.live : book.sell;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
          Listed right now
        </span>
        <span className="text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
          {String(book.sell.length)} selling
          {book.live.length > 0 ? (
            <>
              {', '}
              <span style={{ color: 'var(--color-signal-good)' }}>
                {String(book.live.length)} in game now
              </span>
            </>
          ) : (
            ', none in game this minute'
          )}
        </span>
        {book.bestLive !== null && (
          <span className="numeric ml-auto text-[length:var(--text-micro)]" style={{ color: 'var(--color-signal-good)' }}>
            {String(book.bestLive)}p to buy now
          </span>
        )}
      </div>

      {/*
        Five is the whole useful depth. Past the fifth cheapest seller nobody is
        reading names, and the count above already says how deep the book goes.
      */}
      <ul className="flex flex-col">
        {top.slice(0, 5).map((o, i) => (
          <li
            key={`${o.seller}:${String(o.platinum)}:${String(i)}`}
            className="mo-in-left flex flex-wrap items-baseline gap-x-2 py-0.5"
            style={{ ['--i' as string]: String(i) }}
          >
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: o.status === 'ingame' ? 'var(--color-signal-good)' : 'var(--text-ghost)' }}
            />
            <span className="numeric shrink-0 text-[length:var(--text-micro)]" style={{ color: 'var(--color-tenno-200)' }}>
              {String(o.platinum)}p
            </span>
            <span className="min-w-0 truncate text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
              {o.seller}
            </span>
            {o.perTrade > 1 && (
              <span className="eyebrow shrink-0" style={{ color: 'var(--color-signal-warn)' }}>
                {String(o.perTrade)} at a time
              </span>
            )}
            <span className="eyebrow ml-auto shrink-0" style={{ color: 'var(--text-ghost)' }}>
              {o.status === 'ingame' ? 'in game' : 'offline'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
