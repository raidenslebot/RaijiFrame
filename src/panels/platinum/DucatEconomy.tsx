/**
 * The ducat economy, on its own terms.
 *
 * WHY THIS IS NOT PART OF THE PLATINUM SECTION
 * ────────────────────────────────────────────
 * Ducats were being converted into platinum inside the plat-per-hour chains, at
 * a rate the player invented with a slider. That put a made-up number inside
 * figures that were otherwise built entirely from measurements, in the same
 * column, in the same typeface. A reader had no way to tell which rates were
 * real.
 *
 * Ducats are a separate currency with a separate loop, so they get separate
 * arithmetic in their own units:
 *
 *     prime junk  →  kiosk  →  ducats  →  Baro  →  a buyer
 *
 * Only the last arrow crosses into platinum, and it is the one arrow nobody can
 * price in advance, because Baro's stock is not published until he lands.
 *
 * EVERYTHING HERE IS EXACT
 * ────────────────────────
 * `primeSellingPrice` IS the kiosk price. It is a published constant, identical
 * for every player, unchanged between patches, and needs no network at all. So
 * unlike the platinum side, this section has no estimates in it whatsoever —
 * every number is either DE's own figure or a count of what you hold.
 */

import { useMemo, useState } from 'react';
import type { DucatDb } from '../../data/ducats';
import type { MarketCatalog } from '../../data/market';
import { holdingsOf, tradesFor, type Holding } from '../../data/plat-value';
import { Disclosure } from '../../ui/Disclosure';
import { staggerFor } from '../../ui/stagger';
import { CHAMFER, PLATE_COOL as PLATE } from '../../ui/geometry';

/** DE's five kiosk tiers, measured over the exports. Not three, as folklore has it. */
const TIERS = [15, 25, 45, 65, 100] as const;

export function DucatEconomy({
  account,
  catalog,
  ducats,
  held,
  baroAtMs,
  baroWhere,
  now,
}: {
  account: Record<string, unknown> | null;
  catalog: MarketCatalog | null;
  ducats: DucatDb | null;
  /** Ducats currently in the purse, from the account. Null when unread. */
  held: number | null;
  baroAtMs: number | null;
  baroWhere: string | null;
  now: number;
}) {
  const [tier, setTier] = useState<number | 'all'>('all');

  const stock = useMemo(() => (catalog ? holdingsOf(account, catalog, ducats) : []), [account, catalog, ducats]);
  const withDucats = useMemo(() => stock.filter((h) => h.ducats !== null), [stock]);

  const total = withDucats.reduce((n, h) => n + (h.ducatWorth ?? 0), 0);
  const byTier = useMemo(() => {
    const map = new Map<number, { count: number; ducats: number }>();
    for (const t of TIERS) map.set(t, { count: 0, ducats: 0 });
    for (const h of withDucats) {
      const bucket = map.get(h.ducats ?? 0);
      if (!bucket) continue;
      bucket.count += h.count;
      bucket.ducats += h.ducatWorth ?? 0;
    }
    return map;
  }, [withDucats]);

  const shown = useMemo(() => {
    const rows = tier === 'all' ? withDucats : withDucats.filter((h) => h.ducats === tier);
    return [...rows].sort((a, b) => (b.ducatWorth ?? 0) - (a.ducatWorth ?? 0));
  }, [withDucats, tier]);

  const peak = shown.reduce((n, h) => Math.max(n, h.ducatWorth ?? 0), 0);
  const baroIn = baroAtMs === null ? null : baroAtMs - now;

  return (
    <div className="rf-duc flex flex-col gap-3">
      {/*
        The animated fill and the pointer-tracked sheen are declared once here.
        Both decorate content that is ALREADY on screen: under a frozen document
        timeline the bars simply sit at their final width and the sheen never
        moves, and nothing is hidden behind either.
      */}
      <style>{`
        @property --duc-fill { syntax: '<percentage>'; inherits: false; initial-value: 0%; }
        .rf-duc { container-type: inline-size; }
        .rf-bar {
          background: linear-gradient(90deg,
            oklch(0.78 0.13 85 / 0.85) 0%,
            oklch(0.72 0.15 62 / 0.85) var(--duc-fill),
            oklch(1 0 0 / 0.05) var(--duc-fill));
          transition: --duc-fill 620ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        /*
          THE ROW LIGHT IS THE SHARED ONE, TINTED.

          This file used to declare the whole effect again - position, isolation,
          a pseudo-element, a gradient, a transition - which is the rf-row
          light in theme.css rewritten in ducat gold. The only thing that was
          actually local was the COLOUR, and the shared rule already takes its
          hue from --rf-row-accent. So the duplicate is gone and one custom
          property does the whole job, which also means these rows pick up the
          lit edge and the depth lift they were quietly missing.
        */
        .rf-duc .rf-row { --rf-row-accent: oklch(0.78 0.13 85); }
        .rf-tier { transition: transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), background-color 160ms cubic-bezier(0.33, 1, 0.68, 1); }
        .rf-tier:hover { transform: translateY(-2px); }
        .rf-tier[aria-pressed='true'] { transform: translateY(-3px); }
        /* The vault reads as one object at width; as a stack when the pane is narrow. */
        @container (min-width: 760px) { .rf-vault { grid-template-columns: repeat(5, 1fr); } }
        @media (prefers-reduced-motion: reduce) {
          .rf-bar, .rf-tier { transition: none; }
        }
      `}</style>

      {/* ---- the purse ---- */}
      {/* The three biggest figures in the section sit on this plate, so it
          takes the pointer light: a flat surface with a large number on it is
          exactly what rf-lit was added for, and it costs one class. */}
      <div
        className="rf-plate rf-lit relative px-5 py-4"
        style={{ clipPath: CHAMFER, background: PLATE, ['--rf-row-accent' as string]: 'oklch(0.78 0.13 85)' }}
      >
        <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[3px]" style={{ background: 'oklch(0.78 0.13 85)' }} />
        <div className="eyebrow">The ducat economy</div>

        <div className="mt-2 flex flex-wrap items-baseline gap-x-8 gap-y-2">
          <div>
            <div className="numeric text-[length:var(--text-title)] leading-none" style={{ color: 'oklch(0.82 0.12 85)' }}>
              {held === null ? '—' : held.toLocaleString()}
            </div>
            <div className="eyebrow mt-1" style={{ color: 'var(--text-faint)' }}>
              {held === null ? 'not in this account read' : 'in your purse'}
            </div>
          </div>
          <div>
            <div className="numeric text-[length:var(--text-title)] leading-none" style={{ color: 'var(--color-orokin-200)' }}>
              {total.toLocaleString()}
            </div>
            <div className="eyebrow mt-1" style={{ color: 'var(--text-faint)' }}>
              sitting unsold in prime junk
            </div>
          </div>
          <div>
            <div className="numeric text-[length:var(--text-lead)] leading-none" style={{ color: 'var(--text)' }}>
              {held === null ? total.toLocaleString() : (held + total).toLocaleString()}
            </div>
            <div className="eyebrow mt-1" style={{ color: 'var(--text-faint)' }}>
              if you sold every duplicate today
            </div>
          </div>
        </div>

        {/* The claim IS the summary - a reader who never opens this has still
            been told the three figures above it are exact. */}
        <div className="mt-3">
          <Disclosure
            accent="oklch(0.78 0.13 85)"
            eyebrow="how much of this is estimated"
            summary="Every figure on this page is exact"
            answer="none of it is a market estimate"
          >
            <p className="wf-prose">
              The kiosk price is DE&rsquo;s own published constant &mdash; identical for every player, unchanged
              between patches, and needing no network at all.
            </p>
            <p className="wf-prose mt-2">
              Which is precisely why it does not belong mixed into platinum-per-hour, where every other term is
              measured rather than published.
            </p>
          </Disclosure>
        </div>
      </div>

      {/* ---- Baro, the only door out ---- */}
      <div className="rf-plate rf-lit relative px-5 py-3.5" style={{ clipPath: CHAMFER, background: PLATE }}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="eyebrow" style={{ color: 'oklch(0.82 0.12 85)' }}>
            Baro Ki&rsquo;Teer
          </span>
          {baroIn === null ? (
            <span className="text-[length:var(--text-small)]" style={{ color: 'var(--text-muted)' }}>
              His schedule has not been read.
            </span>
          ) : baroIn > 0 ? (
            <span className="text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
              arrives in {formatGap(baroIn)}
              {baroWhere !== null && <span style={{ color: 'var(--text-faint)' }}> · {baroWhere}</span>}
            </span>
          ) : (
            <span className="text-[length:var(--text-small)]" style={{ color: 'var(--color-signal-good)' }}>
              here now{baroWhere !== null && <span style={{ color: 'var(--text-faint)' }}> · {baroWhere}</span>}
            </span>
          )}
        </div>
        <div className="mt-1.5">
          <Disclosure
            accent="oklch(0.78 0.13 85)"
            eyebrow="why there is no shopping list"
            summary="His stock is not published until he lands"
            answer="what you can prepare is the ducats"
          >
            <p className="wf-prose">
              Ducats only become platinum through him, so no list can be prepared in advance and this app will not
              pretend otherwise. Everything above is the preparation that CAN be done, measured.
            </p>
          </Disclosure>
        </div>
      </div>

      {/* ---- the vault, by tier ---- */}
      <div className="rf-plate rf-lit px-5 py-4" style={{ clipPath: CHAMFER, background: PLATE }}>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="eyebrow">Your junk, by kiosk tier</span>
          <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
            five tiers, measured over DE&rsquo;s exports — not the three that folklore repeats
          </span>
        </div>

        <div className="rf-vault mt-3 grid grid-cols-2 gap-[3px] sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setTier('all')}
            aria-pressed={tier === 'all'}
            className="rf-clipped rf-tier mo-focusable px-3 py-2.5 text-left"
            style={{
              clipPath: CHAMFER,
              background: tier === 'all' ? 'oklch(0.30 0.06 235 / 0.45)' : 'oklch(1 0 0 / 0.03)',
            }}
          >
            <div className="numeric text-[length:var(--text-lead)] leading-none" style={{ color: 'var(--text)' }}>
              {withDucats.length}
            </div>
            <div className="eyebrow mt-1" style={{ color: 'var(--text-faint)' }}>
              every tier
            </div>
          </button>

          {TIERS.map((t) => {
            const b = byTier.get(t);
            const on = tier === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTier(on ? 'all' : t)}
                aria-pressed={on}
                className="rf-clipped rf-tier mo-focusable px-3 py-2.5 text-left"
                style={{
                  clipPath: CHAMFER,
                  background: on ? 'oklch(0.30 0.06 235 / 0.45)' : 'oklch(1 0 0 / 0.03)',
                }}
              >
                <div className="numeric text-[length:var(--text-lead)] leading-none" style={{ color: 'oklch(0.82 0.12 85)' }}>
                  {b?.ducats.toLocaleString() ?? '0'}
                </div>
                <div className="eyebrow mt-1" style={{ color: 'var(--text-faint)' }}>
                  {String(t)}d each · {String(b?.count ?? 0)} held
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- what to take to the kiosk ---- */}
      {/* rf-staged is theme.css's index-driven entrance: transform only, and
          the delays stop at eighteen so a long list cannot finish arriving
          after the player has stopped looking. */}
      <ul className="rf-staged flex flex-col gap-[3px]" style={staggerFor(Math.min(shown.length, 120))}>
        {shown.slice(0, 120).map((h) => (
          <DucatRow key={h.gameRef} h={h} peak={peak} />
        ))}
        {shown.length === 0 && (
          <li className="eyebrow px-3.5 py-3" style={{ color: 'var(--text-faint)' }}>
            {account === null
              ? 'This account has never sent an inventory — nothing here is a zero, it is unread.'
              : catalog === null
                ? 'Reading the catalogues'
                : 'Nothing you hold carries a kiosk price.'}
          </li>
        )}
      </ul>
    </div>
  );
}

function DucatRow({ h, peak }: { h: Holding; peak: number }) {
  const width = peak > 0 ? Math.max(2, ((h.ducatWorth ?? 0) / peak) * 100) : 0;
  return (
    <li
      /*
        THE HANDLER THAT USED TO BE HERE IS GONE, AND NOTHING WAS LOST.

        Every row carried its own onPointerMove, measuring its own rectangle on
        every move, to write the two properties the light reads. `ui/pointer.ts`
        has done that for the whole document for some time - one listener, one
        cached rectangle, and `.rf-row` is the first entry in its selector - so
        this was a hundred and twenty React handlers and a hundred and twenty
        layout reads a second duplicating a job already done, over a running
        game. The class alone is the whole subscription.
      */
      className="rf-row px-3.5 py-2"
      style={{ clipPath: CHAMFER, background: 'var(--plate-lift)' }}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="truncate text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
          {h.name}
        </span>
        <span className="numeric eyebrow shrink-0" style={{ color: 'var(--text-faint)' }}>
          ×{h.count.toLocaleString()}
        </span>
        <span className="numeric eyebrow shrink-0" style={{ color: 'var(--text-ghost)' }}>
          {String(h.ducats)}d each
        </span>
        <span className="ml-auto shrink-0" />
        <span className="eyebrow shrink-0" style={{ color: 'var(--text-ghost)' }} title="Six items a side, per trade">
          {String(tradesFor(h.count))} {tradesFor(h.count) === 1 ? 'trade' : 'trades'}
        </span>
        <span className="numeric w-24 shrink-0 text-right text-[length:var(--text-small)]" style={{ color: 'oklch(0.82 0.12 85)' }}>
          {(h.ducatWorth ?? 0).toLocaleString()}d
        </span>
      </div>
      {/* The bar encodes the value, so the ranking is readable at a glance
          rather than as a column of digits the eye has to compare. */}
      <div className="rf-bar mt-1.5 h-[3px] w-full" style={{ ['--duc-fill' as string]: `${String(width)}%` }} />
    </li>
  );
}

function formatGap(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return `${String(days)}d ${String(hours)}h`;
  if (hours > 0) return `${String(hours)}h ${String(mins % 60)}m`;
  return `${String(mins)}m`;
}
