/**
 * The relic browser: every relic ranked by what it actually returns.
 *
 * WHAT MAKES THE NUMBERS REAL
 * ───────────────────────────
 * Expected platinum per crack is the sum of `chance x median price` over a
 * relic's rewards. The chance is DE's own published drop table; the price is
 * warframe.market's CLOSED trades — what people actually paid. `coverage` says
 * how much of each table could be priced, so a partial sum is never passed off
 * as a whole one, and a relic nothing could price shows no platinum figure at
 * all rather than a zero.
 *
 * Ducats sit beside platinum because they are a different KIND of fact. The
 * platinum figure is an estimate that depends on somebody wanting to buy; the
 * Ducat figure is what DE's own kiosk pays, identical for every player, and it
 * does not move. It is the floor under the relic, and it needs no network.
 *
 * WHY THIS NO LONGER PRICES ONE RELIC AT A TIME
 * ─────────────────────────────────────────────
 * It used to price on the click — six requests for the relic you opened — and
 * that was the right call while the alternative was pricing 3,089 relics. It
 * also meant the LIST could never show a number, so it showed a name and the
 * words "6 rewards", and the panel's whole subject was invisible until you
 * guessed which row to open.
 *
 * Measured against the live table: those 3,089 rows stand on only 591 distinct
 * tradeable reward items — a fifth of the work, and pricing them prices every
 * relic at once. `gentle` persists what it reads, so it is paid for once rather
 * than per click, and the pass is ordered so the list is worth reading long
 * before it finishes: the first fifty requests resolve 36% of all the expected
 * value in the table, a hundred resolve 49%, two hundred resolve 70%.
 *
 * The pass therefore runs on a press, not on mount. It is a deliberate act with
 * a stated cost, against a service run by volunteers, and the panel is useful
 * without it — every Ducat figure and the whole reward structure are already
 * there with no network at all.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from '../../core/store';
import { loadDucats, type DucatDb } from '../../data/ducats';
import type { Price } from '../../data/market';
import { loadRelics, priceRewardUniverse, rewardUniverse, type Relic } from '../../data/plat-value';
import { RelicTree } from './RelicTree';
import { CHAMFER } from '../../ui/geometry';

/** What the pricing pass is doing, in the player's terms. */
interface Pass {
  done: number;
  total: number;
  /** Set when the market could not be reached at all. Never a silent empty. */
  failed: string | null;
}

export function RelicBrowser() {
  const inventory = useAccount((s) => s.inventory);
  const [ducats, setDucats] = useState<DucatDb | null>(null);
  const [relics, setRelics] = useState<Relic[] | null>(null);
  const [query, setQuery] = useState('');
  const [prices, setPrices] = useState<ReadonlyMap<string, Price>>(new Map());
  const [pass, setPass] = useState<Pass | null>(null);

  useEffect(() => {
    let alive = true;
    void loadDucats().then((d) => alive && setDucats(d));
    void loadRelics().then((d) => alive && setRelics(d.all.slice()));
    return () => {
      alive = false;
    };
  }, []);

  const table = useMemo(() => relics ?? [], [relics]);
  const universeSize = useMemo(() => (relics === null ? 0 : rewardUniverse(relics).length), [relics]);

  /*
   * ONE PASS AT A TIME, AND IT SURVIVES A RE-RENDER.
   *
   * The ref guards the double-press: the button disables itself while a pass
   * runs, but a disabled button is a render away and this is a real network
   * budget. `alive` is not enough on its own — the pass outlives any single
   * render and must not be started twice.
   */
  const running = useRef(false);
  const startPricing = (): void => {
    if (running.current || relics === null) return;
    running.current = true;
    setPass({ done: 0, total: universeSize, failed: null });
    void priceRewardUniverse(relics, (done, total, soFar) => {
      setPass({ done, total, failed: null });
      // A NEW map each report: the tree re-ranks from it, and mutating the one
      // it already holds would leave React with nothing to notice.
      setPrices(new Map(soFar));
    })
      .then((final) => {
        setPrices(new Map(final));
        setPass((p) => (p === null ? null : { ...p, done: p.total }));
      })
      .catch((err: unknown) => {
        /*
         * A failed pass leaves every price it DID land in place. What it must
         * not do is leave the panel looking finished: the failure is stated, so
         * the figures on screen read as what was already known rather than as
         * the whole answer.
         */
        setPass((p) => ({
          done: p?.done ?? 0,
          total: p?.total ?? universeSize,
          failed: err instanceof Error ? err.message : 'the market could not be reached',
        }));
      })
      .finally(() => {
        running.current = false;
      });
  };

  // A pass is in flight while it has started, not finished, and not failed.
  const inFlight = pass !== null && pass.failed === null && pass.done < pass.total;
  const priced = prices.size;
  const pct = universeSize === 0 ? 0 : Math.min(100, Math.round((100 * priced) / universeSize));

  return (
    <div className="rf-relics">
      {/*
        @property is the only way to animate a gradient stop, and it earns its
        place here: the bar fills as real prices land, so "the number is still
        arriving" is visible on the content itself rather than as a spinner
        beside it. It decorates a figure that is already legible — under a
        frozen timeline the bar simply sits at its current position and the
        count beside it still reads.
      */}
      <style>{`
        @property --rf-fill { syntax: '<percentage>'; inherits: false; initial-value: 0%; }
        .rf-relics { container-type: inline-size; }
        .rf-meter { background: linear-gradient(90deg, var(--color-orokin-400) var(--rf-fill), oklch(1 0 0 / 0.07) var(--rf-fill)); transition: --rf-fill 700ms cubic-bezier(0.22,1,0.36,1); }
        @media (prefers-reduced-motion: reduce) { .rf-meter { transition: none; } }
      `}</style>

      {/* ---- the pass, and what it costs ---- */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={startPricing}
          /*
           * DERIVED FROM STATE, NOT FROM THE REF.
           *
           * `running.current` here was a ref read during render, which React
           * does not guarantee is current and eslint flags outright. The ref
           * still guards the double-start inside the handler - that is what a
           * ref is for - but what the button DISPLAYS has to come from state,
           * or the disabled attribute can disagree with the pass it describes.
           */
          disabled={relics === null || inFlight}
          className="rf-clipped mo-field mo-lift mo-focusable px-3.5 py-2"
          style={{ clipPath: CHAMFER, background: 'oklch(0.30 0.06 235 / 0.5)' }}
        >
          <span
            className="font-[family-name:var(--font-display)] text-[length:var(--text-nano)] font-semibold tracking-[0.14em] uppercase"
            style={{ color: 'var(--text)' }}
          >
            {pass === null ? 'Price every relic' : pass.done >= pass.total ? 'Priced' : 'Pricing…'}
          </span>
        </button>

        <div className="min-w-[16ch] flex-1">
          {/*
            NO BAR AND NO COUNTS UNTIL THE TABLE IS IN.
            ————————————————————————————————————————————
            `universeSize` is 0 while `loadRelics()` is in flight, and `pct` is
            derived from it, so this rendered "0 reward prices cover all 0 relic
            rows" over a bar drawn at 0% — two unknown counts printed as zeros
            and an empty meter, which the house rule names explicitly. A bar at
            zero is a measurement of nothing, not an absence of measurement.

            The tree below already handles this state correctly ("Reading the
            drop tables"); this is the same sentence for the same moment.
          */}
          {relics === null ? (
            <p className="eyebrow mt-1" style={{ color: 'var(--text-faint)' }}>
              Reading the drop tables
            </p>
          ) : (
            <>
              <div className="rf-meter h-1" style={{ ['--rf-fill' as string]: `${String(pct)}%` }} />
              <p className="eyebrow mt-1" style={{ color: 'var(--text-faint)' }}>
                {pass === null
                  ? `${String(universeSize)} reward prices cover all ${String(table.length)} relic rows`
                  : `${String(priced)} of ${String(universeSize)} rewards priced`}
              </p>
            </>
          )}
        </div>

        <label className="ml-auto">
          <span className="sr-only">Filter relics by name or by the rewards they contain</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by relic or reward"
            spellCheck={false}
            className="mo-focusable w-64 bg-transparent px-3 py-1.5 text-[length:var(--text-small)] outline-none placeholder:opacity-45"
            style={{ clipPath: CHAMFER, background: 'oklch(0.08 0.02 275)', color: 'var(--text)' }}
          />
        </label>
      </div>

      {pass?.failed != null && (
        <p className="eyebrow mb-2" style={{ color: 'var(--color-signal-bad)' }}>
          {pass.failed} — what is shown is what was already known
        </p>
      )}

      <RelicTree relics={table} prices={prices} ducats={ducats} inventory={inventory} query={query} />
    </div>
  );
}
