/**
 * The best thing to spend today's standing on.
 *
 * Standing is the scarce resource: capped daily, the cap set by Mastery Rank,
 * and impossible to buy. So the axis is platinum per THOUSAND standing, not
 * platinum, and the ranking answers the question a player actually has when
 * they log in - given one day's cap, what should it buy?
 *
 * The costs are DE's own published constants and never move. The prices are
 * measured. Nothing between them is estimated.
 */

import { useEffect, useMemo, useState } from 'react';
import type { MarketCatalog } from '../../data/market';
import { priceMany } from '../../data/market';
import {
  bestUseOfStanding,
  priceOfferings,
  syndicateLabel,
  tradeableOfferings,
  type Offering,
  type ValuedOffering,
} from '../../data/standing-value';
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { staggerFor } from '../../ui/stagger';
import type { StandingCap } from '../../data/plat-throughput';
import { CHAMFER, PLATE_COOL as PLATE } from '../../ui/geometry';

/**
 * PRICING EVERY OFFERING, NOT A SHORTLIST, AND WHY THE ORDER MATTERS
 * ─────────────────────────────────────────────────────────────────
 * This page used to carry a button reading "price the top 24 shown". It could
 * not have meant anything: the ranking axis IS platinum per thousand standing,
 * so before a single quote arrives every row's rank is null and the list is in
 * alphabetical order. "The top 24" was the first 24 names in the alphabet, and
 * pricing them produced a leaderboard of the letter A.
 *
 * There is no honest shortlist here, so the pass takes the whole set - in
 * chunks, publishing each one, so the ranking sorts itself into place while you
 * read rather than after you wait. The token bucket paces it at roughly one
 * request a second and the five-minute cache means leaving the tab and coming
 * back costs nothing at all.
 *
 * The ceiling is a runaway guard, not a budget: if the offering tables ever grow
 * past it the page says how many it left, rather than quietly ranking a subset.
 */
const CHUNK = 12;

/**
 * How many distinct offerings one pass will quote.
 *
 * There are 659 of them across nineteen syndicates, which is eleven minutes of
 * requests at the pace the shared bucket allows - too long to spend on a
 * ranking that is only half useful anyway, because standing is not fungible.
 * You cannot spend Arbiters standing on a Perrin item, so the cross-syndicate
 * ranking answers a question you ask rarely (which faction is worth farming)
 * while the question you actually have on login is always inside ONE faction.
 *
 * So the pass is ordered rather than truncated: the syndicate you have selected
 * first, then the ones this account actually has standing with, then the rest.
 * The largest single syndicate offers 117 things, so choosing one always fits
 * inside the ceiling with room to spare - which means the within-faction view,
 * the one that decides where today's cap goes, is always complete. The
 * cross-faction view says how much of itself is unpriced instead of pretending.
 */
const CEILING = 240;

/**
 * What opens when you click an offering.
 *
 * The row states a rank; it cannot state whether that rank is GOOD. A number
 * like 1.73 platinum per thousand standing is meaningless in isolation and
 * obvious the moment it is set against the best row on the same list, so the
 * comparison is the first thing here - measured against the leader, never
 * against a threshold somebody invented.
 */
function StandingDetail({ o, best }: { o: ValuedOffering; best: number | null }) {
  const share = best !== null && best > 0 && o.platPerK !== null ? o.platPerK / best : null;

  return (
    <div className="rf-open mt-2 flex flex-col gap-2.5 border-l pl-3.5" style={{ borderColor: 'var(--hairline)' }}>
      {o.platPerK === null ? (
        /* A div, because Clamp is one and a div inside a <p> closes the
           paragraph early. The refusal keeps its first line: it is this row's
           answer, and only the qualification folds. */
        <div className="max-w-[76ch] text-[length:var(--text-micro)] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
          <Clamp lines={1}>
            Not quoted yet, or nothing has closed on it in ninety days. The standing price beside it is exact either
            way &mdash; it is DE&rsquo;s own constant and does not move.
          </Clamp>
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-x-2">
            <span className="numeric leading-none" style={{ fontSize: 'var(--text-lead)', color: 'var(--color-orokin-200)' }}>
              {o.platPerK.toFixed(2)}
            </span>
            <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
              platinum per thousand standing
            </span>
          </div>

          {/* against the best row, drawn - the bar is whole, the mark travels */}
          {share !== null && (
            <div className="max-w-[26rem]">
              <div className="relative h-[14px]">
                <span aria-hidden className="absolute top-[6px] right-0 left-0 h-px" style={{ background: 'var(--hairline)' }} />
                <span
                  aria-hidden
                  className="absolute top-[6px] left-0 h-px"
                  style={{ width: `${String(Math.round(share * 100))}%`, background: 'var(--color-orokin-400)' }}
                />
                <span
                  aria-hidden
                  className="rf-mark absolute top-[2px] h-[9px] w-[2px]"
                  style={{ left: `calc(${String(Math.round(share * 100))}% - 1px)`, background: 'var(--color-orokin-200)' }}
                />
              </div>
              <span className="text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
                {Math.round(share * 100)}% of the best return on this list
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span className="text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
              <span className="numeric" style={{ color: 'var(--text)' }}>
                {o.standingCost.toLocaleString()}
              </span>{' '}
              standing
              {o.creditsCost > 0 && (
                <>
                  {' '}
                  and <span className="numeric">{o.creditsCost.toLocaleString()}</span> credits
                </>
              )}
            </span>
            {o.price && (
              <span className="text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
                sells at{' '}
                <span className="numeric" style={{ color: 'var(--color-tenno-300)' }}>
                  {o.price.median}p
                </span>
                , range{' '}
                <span className="numeric">
                  {o.price.min}&ndash;{o.price.max}p
                </span>
              </span>
            )}
            {o.price && (
              <span className="text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
                <span className="numeric" style={{ color: 'var(--text)' }}>
                  {o.price.volume}
                </span>{' '}
                closed that day &mdash;{' '}
                {o.price.volume >= 20 ? 'it moves' : o.price.volume >= 5 ? 'it moves slowly' : 'it barely moves'}
              </span>
            )}
          </div>

          {/* Whether you can buy it is the fact; why it is listed anyway is
              the footnote. One line, the rest a press away. */}
          <div className="max-w-[76ch] text-[length:var(--text-nano)] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            <Clamp lines={1}>
              {o.reachable === false
                ? `Locked: this needs rank ${String(o.requiredLevel)} with ${syndicateLabel(o.syndicate)} and your rank is lower. It is listed anyway because what sits above you is the reason to pick one syndicate over another.`
                : o.reachable === null
                  ? 'Your rank with this syndicate has not been read, so whether you can buy it is unknown rather than no.'
                  : `Your rank with ${syndicateLabel(o.syndicate)} allows this.`}
            </Clamp>
          </div>
        </>
      )}
    </div>
  );
}

export function StandingValue({
  offerings,
  catalog,
  ranks,
  cap,
}: {
  offerings: readonly Offering[];
  catalog: MarketCatalog | null;
  ranks: ReadonlyMap<string, number> | null;
  /**
   * Whether this account has already hit today's standing cap, from its runs.
   *
   * `hit: null` is the third state and must not be drawn as "you have room
   * left" - it means no run since the reset earned standing at all, so the
   * question was never answered. Only `true` changes what this card says.
   */
  cap: StandingCap;
}) {
  const [priced, setPriced] = useState<ValuedOffering[] | null>(null);
  /*
   * Which slugs this session has asked about - not how many, and not a
   * per-pass counter. Reordering the pass when you pick a syndicate would make
   * a counter jump backwards; a set only ever grows, and progress derived from
   * it is honest across every restart.
   */
  const [asked, setAsked] = useState<ReadonlySet<string>>(new Set());
  const [syndicate, setSyndicate] = useState<string>('all');
  const [reachableOnly, setReachableOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  /* Free and exact: which offerings can be sold at all, and what they cost. */
  const base = useMemo(
    () => (catalog ? tradeableOfferings(offerings, catalog, ranks) : []),
    [offerings, catalog, ranks],
  );

  const syndicates = useMemo(() => [...new Set(base.map((o) => o.syndicate))].sort(), [base]);

  const shown = useMemo(() => {
    const source = priced ?? base;
    const filtered = source.filter(
      (o) => (syndicate === 'all' || o.syndicate === syndicate) && (!reachableOnly || o.reachable !== false),
    );
    return bestUseOfStanding(filtered);
  }, [priced, base, syndicate, reachableOnly]);

  /* The leader of the CURRENT list, which is what a row is compared against. */
  const bestReturn = useMemo(() => shown.find((o) => o.platPerK !== null)?.platPerK ?? null, [shown]);

  /*
   * The pass order, and it is the whole design.
   *
   * Distinct slugs, because two syndicates selling the same mod is one quote.
   * Ordered by how likely you are to care: what you are looking at, then what
   * you have standing with, then everything else.
   */
  const slugs = useMemo(() => {
    const rank = (o: Offering): number => {
      if (syndicate !== 'all' && o.syndicate === syndicate) return 0;
      if (ranks?.has(o.syndicate) === true) return 1;
      return 2;
    };
    const best = new Map<string, number>();
    for (const o of base) {
      const r = rank(o);
      const prev = best.get(o.slug);
      if (prev === undefined || r < prev) best.set(o.slug, r);
    }
    return [...best.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, CEILING)
      .map(([slug]) => slug);
  }, [base, ranks, syndicate]);

  /*
   * The pass, on open, in chunks.
   *
   * Nothing is set synchronously here - every publish happens after an await,
   * which keeps this out of the set-state-in-effect trap this project has
   * walked into four times. A chunk that fails leaves the chunks before it on
   * screen and moves on: partial is better than blank, and the rows that never
   * arrived say "not quoted" rather than showing a zero.
   *
   * The two audit rules this shape trips are answered, not silenced.
   * `no-set-state-after-await-in-effect` guards against publishing into a
   * component that has gone: every publish is behind `alive`, cleared by the
   * cleanup. `async-await-in-loop` guards against needless serialisation: here
   * one chunk at a time is deliberate, because it is what paces the pass and
   * what lets the ranking sort itself into place while you read it.
   */
  useEffect(() => {
    if (slugs.length === 0) return;
    let alive = true;
    void (async () => {
      for (let i = 0; i < slugs.length; i += CHUNK) {
        const part = slugs.slice(i, i + CHUNK);
        try {
          const prices = await priceMany(part, part.length);
          if (!alive) return;
          // Fold across the WHOLE set so a filter change keeps what landed.
          setPriced((prev) => priceOfferings(prev ?? base, prices));
        } catch {
          if (!alive) return;
        }
        if (!alive) return;
        setAsked((prev) => {
          const next = new Set(prev);
          for (const slug of part) next.add(slug);
          return next;
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [slugs, base]);

  /*
   * Progress, derived rather than counted. A slug already asked about this
   * session needs no request - the five-minute cache answers it - so a pass
   * that restarts after you change the filter races through what it has seen
   * and the line below never goes backwards.
   */
  const outstanding = slugs.filter((slug) => !asked.has(slug)).length;
  const pricing = outstanding > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="rf-plate rf-lit relative px-5 py-4" style={{ clipPath: CHAMFER, background: PLATE }}>
        <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[3px]" style={{ background: 'var(--color-orokin-300)' }} />
        <div className="eyebrow">Standing into platinum</div>

        {/*
          THE ONE THING THAT MAKES THIS CARD WRONG FOR THE REST OF THE DAY.
          ————————————————————————————————————————————
          Everything below ranks offerings by platinum per thousand standing,
          which stays true whatever time it is. What does not stay true is the
          instruction attached to it: "go and earn the standing". The game
          records, per run, the standing paid before and after the daily
          checkpoint, and when the second is lower than the first the cap has
          already bitten. That field was parsed, typed and carried on every
          record, and read by nothing — so the card kept sending players to earn
          something they could not earn again until 00:00 UTC.

          Only `true` prints. `null` means no run since the reset earned any
          standing, which is a question nobody asked rather than an answer, and
          drawing it as "you have room left" would be exactly the fabrication
          this app refuses everywhere else.
        */}
        {cap.hit === true && (
          <p className="mt-1.5 text-[length:var(--text-body)] leading-snug" style={{ color: 'var(--color-signal-warn)' }}>
            You have already hit today&rsquo;s standing cap
            <span className="eyebrow ml-2" style={{ color: 'var(--text-faint)' }}>
              measured across {String(cap.runs)} {cap.runs === 1 ? 'run' : 'runs'} since the reset &mdash; the ratios
              below still hold, but the standing has to wait for 00:00 UTC
            </span>
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="numeric text-[length:var(--text-title)] leading-none" style={{ color: 'var(--color-orokin-200)' }}>
            {base.length.toLocaleString()}
          </span>
          <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
            offerings across {String(syndicates.length)} syndicates that can be resold
          </span>
        </div>
        {/*
          THE AXIS, NESTED UNDER THE FIGURE IT EXPLAINS.

          Four sentences of grey type directly under the largest number on the
          plate: the reader's eye left the number, hit a paragraph, and left.
          The closed row now states the axis itself - which is the one thing
          the paragraph existed to establish - and the provenance of each side
          of it sits one level down.
        */}
        <div className="mt-2.5">
          <Disclosure
            eyebrow="the axis everything here is ranked on"
            summary="Platinum per thousand standing"
            answer="standing is the scarce side, not platinum"
          >
            <p className="wf-prose">
              The cost side is DE&rsquo;s own published price and never changes; the return side is the median of real
              closed trades.
            </p>

            <div className="mt-2">
              <Disclosure
                depth={1}
                eyebrow="what is left out"
                summary="Offerings that cannot be traded at all"
                answer="left out, not shown as worthless"
              >
                <p className="wf-prose">
                  A syandana bound to your account is a different thing, not a bad deal.
                </p>
              </Disclosure>
            </div>
          </Disclosure>
        </div>
      </div>

      {/* ---- controls ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow whitespace-nowrap" style={{ color: pricing ? 'var(--color-orokin-300)' : 'var(--color-signal-good)' }}>
          {pricing
            ? `Reading closed trades — ${String(slugs.length - outstanding)} of ${String(slugs.length)}`
            : syndicate === 'all'
              ? `${String(slugs.length)} priced`
              : 'this syndicate priced in full'}
        </span>

        <label className="flex items-center gap-2">
          <span className="sr-only">Filter by syndicate</span>
          <select
            value={syndicate}
            onChange={(e) => setSyndicate(e.target.value)}
            className="mo-focusable px-3 py-1.5 text-[length:var(--text-micro)] outline-none"
            style={{ clipPath: CHAMFER, background: 'oklch(0.08 0.02 275)', color: 'var(--text)' }}
          >
            <option value="all">Every syndicate</option>
            {syndicates.map((s) => (
              <option key={s} value={s}>
                {syndicateLabel(s)}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setReachableOnly((v) => !v)}
          aria-pressed={reachableOnly}
          className="rf-clipped mo-field mo-lift mo-focusable px-3 py-1.5 text-[length:var(--text-micro)] tracking-[0.18em] uppercase"
          style={{
            clipPath: CHAMFER,
            background: reachableOnly ? 'oklch(0.30 0.06 235 / 0.4)' : 'oklch(1 0 0 / 0.03)',
            color: reachableOnly ? 'var(--text)' : 'var(--text-muted)',
          }}
        >
          Only what my rank allows
        </button>

        <span className="eyebrow ml-auto" style={{ color: 'var(--text-faint)' }}>
          {String(shown.length)} shown
        </span>
        {syndicate === 'all' && !pricing && (
          <span className="eyebrow" style={{ color: 'var(--color-signal-warn)' }}>
            pick a syndicate to rank it in full
          </span>
        )}
      </div>

      {/* ---- the ranking ---- */}
      <style>{`
        /* TRANSFORM ONLY - see SellStock for why a bar may never animate its
           own width on a timeline that can stop at frame zero. */
        @keyframes rf-mark-in { from { transform: translate3d(-6px,0,0); } to { transform: none; } }
        @keyframes rf-open-in { from { transform: translate3d(-8px,0,0); } to { transform: none; } }
        .rf-mark { animation: rf-mark-in 320ms cubic-bezier(0.16, 1, 0.3, 1) backwards; }
        .rf-open { animation: rf-open-in 260ms cubic-bezier(0.16, 1, 0.3, 1) backwards; }
        .rf-chev { transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1); }
        @media (prefers-reduced-motion: reduce) { .rf-mark, .rf-open { animation: none; } .rf-chev { transition: none; } }
      `}</style>
      <ul className="rf-staged flex flex-col gap-[3px]" style={staggerFor(Math.min(shown.length, 120))}>
        {shown.slice(0, 120).map((o) => {
          const id = `${o.syndicate}-${o.itemType}`;
          const isOpen = open === id;
          return (
          <li
            key={id}
            className="rf-row px-3.5 py-2"
            style={{ clipPath: CHAMFER, background: isOpen ? 'oklch(1 0 0 / 0.05)' : 'var(--plate-lift)' }}
          >
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => setOpen(isOpen ? null : id)}
            /* Focus lands here rather than on the row, so the bloom belongs
               here too - see SellStock for the same correction. */
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
              {o.name}
            </span>
            <span className="eyebrow shrink-0" style={{ color: 'var(--text-faint)' }}>
              {syndicateLabel(o.syndicate)}
            </span>
            {o.requiredLevel > 0 && (
              <span
                className="eyebrow shrink-0"
                style={{ color: o.reachable === false ? 'var(--color-signal-warn)' : 'var(--text-ghost)' }}
                title={o.reachable === false ? 'Your rank in this syndicate is not high enough yet' : undefined}
              >
                rank {String(o.requiredLevel)}
              </span>
            )}

            <span className="ml-auto shrink-0" />

            <span
              className="numeric w-24 shrink-0 text-right text-[length:var(--text-micro)]"
              style={{ color: 'var(--text-faint)' }}
              title="Published standing price — a constant, identical for every player"
            >
              {o.standingCost.toLocaleString()}
            </span>
            <span
              className="numeric w-16 shrink-0 text-right text-[length:var(--text-micro)]"
              style={{ color: o.price ? 'var(--color-tenno-300)' : 'var(--text-ghost)' }}
            >
              {/*
                DEFECT: this used to read `priced === null ? '' : 'no trades'`.
                The moment the FIRST chunk of the pass landed, `priced` went
                non-null for the WHOLE list - so every row not yet reached by
                the pass, and every row past the CEILING that will never be
                reached at all, printed "no trades", a claim about the market
                for something that was never asked about. `asked` is the set
                this component already tracks for exactly this distinction: a
                slug in it was actually queried, so no price back means the
                market genuinely has nothing recent; a slug not in it has not
                been asked about yet, and is left blank rather than accused.
              */}
              {o.price ? `${String(o.price.median)}p` : asked.has(o.slug) ? 'no trades' : ''}
            </span>
            <span
              className="numeric w-24 shrink-0 text-right text-[length:var(--text-small)]"
              style={{ color: o.platPerK === null ? 'var(--text-ghost)' : 'var(--color-orokin-200)' }}
              title="Platinum per thousand standing — the number that decides where your daily cap goes"
            >
              {o.platPerK === null ? '—' : `${o.platPerK.toFixed(2)}`}
            </span>
          </button>

          {isOpen && <StandingDetail o={o} best={bestReturn} />}
          </li>
          );
        })}

        {shown.length === 0 && (
          <li className="eyebrow px-3.5 py-3" style={{ color: 'var(--text-faint)' }}>
            {catalog === null ? 'Reading the market catalogue' : 'Nothing here can be resold'}
          </li>
        )}
      </ul>

      {/* The two conventions the list depends on, each stating its own
          conclusion when shut. */}
      <div className="flex flex-col gap-1">
        <Disclosure
          eyebrow="reading the last column"
          summary="A dash is not a zero"
          answer="not quoted, not worth nothing"
        >
          <p className="wf-prose">
            The last column is platinum per thousand standing. Rows show a dash until they are priced.
          </p>
        </Disclosure>

        <Disclosure
          eyebrow="why locked rows are still listed"
          summary="Rank requirements are shown, not filtered away"
          answer="what sits above you is the reason to choose"
        >
          <p className="wf-prose">
            What sits two ranks above you is exactly the reason to pick one syndicate over another, so hiding it would
            hide the decision.
          </p>
        </Disclosure>
      </div>
    </div>
  );
}
