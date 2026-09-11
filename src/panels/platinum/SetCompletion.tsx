/**
 * Sets you are nearly holding, and whether finishing one pays.
 *
 * THE CONSTRAINT THIS PANEL LEADS WITH
 * ────────────────────────────────────
 * Not the margin. The TRADES.
 *
 * Buying a missing part costs one trade; selling the finished set costs one
 * more. A four-part set you hold three of is two trades for one sale. Your cap
 * is your Mastery Rank per day and cannot be raised, bought, or saved up — so
 * the only figure worth comparing between sets is platinum per trade spent, and
 * the only figure worth comparing against OTHER methods is what those same
 * trades would earn elsewhere.
 *
 * The margin is measured against the GAP, not the whole set, and the difference
 * is an order of magnitude. Buying every part of a set and reselling earns one
 * to three platinum a trade. Buying the single part you are missing, measured
 * live: Hydroid Prime 38p in, 93p out, two trades — 27.5p a trade. Nikana Prime
 * 5p in, 67p out — 31p a trade. The expensive parts were already yours, which
 * is the whole point.
 */

import { useMemo, useRef, useState } from 'react';
import { planSets } from '../../data/set-completion';
import type { MarketCatalog } from '../../data/market';
import { priceGap, setGaps, type SetGap, type SetVerdict } from '../../data/set-completion';
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { staggerFor } from '../../ui/stagger';
import { CHAMFER, PLATE_COOL as PLATE } from '../../ui/geometry';

/**
 * How many gaps the panel's automatic pass costs out, and why it is not all.
 *
 * Each verdict is one request per missing part plus one for the set, so two or
 * three each - the only pricing in this panel that is not one-to-one. The list
 * is already sorted closest-first, so the head of it is where the cheap
 * completions are and the tail is sets you are two expensive parts away from.
 * Everything past the cut still opens on a click.
 *
 * The pass itself runs in `PlatinumPanel`, because the card at the top of the
 * panel needs its answer whether or not this section is on screen. This
 * constant has to agree with the slice up there.
 */
const AUTO_GAPS = 8;

/** A slug, read as words. Module scope: it closes over nothing. */
const label = (slug: string): string => slug.replace(/_/g, ' ');

/**
 * What opens when you click a set.
 *
 * The row says "+27.5p/trade" and that is the answer, but it is also a number
 * with four inputs and no way to check it. This lays the set out part by part:
 * what you already hold, what you would have to buy and for how much, and what
 * the finished thing sells for - so the margin is something you can read off
 * the pieces rather than take on trust.
 *
 * Every price here is the median of real closed trades. A part with no recent
 * trades shows as unquoted, and one unquoted part is why a whole verdict can
 * refuse: an unknown cost cannot be added to a known one.
 */
function SetDetail({ v }: { v: SetVerdict }) {
  return (
    <div className="rf-open mt-2.5 flex flex-col gap-2.5 border-l pl-3.5" style={{ borderColor: 'var(--hairline)' }}>
      <ul className="flex flex-col gap-1">
        {v.held.map((slug) => (
          <li key={slug} className="flex items-baseline gap-2 text-[length:var(--text-nano)]">
            <span className="w-[4.5rem] shrink-0" style={{ color: 'var(--color-signal-good)' }}>
              held
            </span>
            <span style={{ color: 'var(--text-muted)' }}>{label(slug)}</span>
          </li>
        ))}
        {v.missing.map((slug) => {
          const p = v.costs.get(slug) ?? null;
          return (
            <li key={slug} className="flex items-baseline gap-2 text-[length:var(--text-nano)]">
              <span className="w-[4.5rem] shrink-0" style={{ color: 'var(--color-signal-warn)' }}>
                to buy
              </span>
              <span style={{ color: 'var(--text)' }}>{label(slug)}</span>
              <span className="numeric ml-auto" style={{ color: p === null ? 'var(--text-ghost)' : 'var(--color-tenno-300)' }}>
                {p === null ? 'no recent trades' : `${String(p.median)}p`}
              </span>
              {p !== null && (
                <span className="numeric w-24 shrink-0 text-right" style={{ color: 'var(--text-ghost)' }}>
                  {p.min}&ndash;{p.max}p, {p.volume} a day
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {v.margin === null ? (
        /* Clamped, never nested: a refusal is the answer for this set, so its
           first line stays on screen. Only the reasoning folds. A div, because
           Clamp is one and would otherwise close the paragraph early. */
        <div className="max-w-[76ch] text-[length:var(--text-nano)] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
          <Clamp lines={1}>
            No verdict: {v.setPrice === null ? 'the finished set' : 'one of the parts you would buy'} has no closed
            trades in the window, and a cost that is unknown cannot be subtracted from one that is known. That is a
            gap in the record, not a bad deal.
          </Clamp>
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[length:var(--text-micro)]">
          <span className="numeric" style={{ color: 'var(--color-signal-warn)' }}>
            {v.toBuy?.toFixed(1)}p
          </span>
          <span style={{ color: 'var(--text-ghost)' }}>out</span>
          <span style={{ color: 'var(--text-ghost)' }}>&rarr;</span>
          <span className="numeric" style={{ color: 'var(--color-tenno-300)' }}>
            {v.setPrice?.median}p
          </span>
          <span style={{ color: 'var(--text-ghost)' }}>back</span>
          <span style={{ color: 'var(--text-ghost)' }}>&divide;</span>
          <span className="numeric" style={{ color: 'var(--text)' }}>
            {String(v.trades)} trades
          </span>
          <span className="numeric ml-1.5" style={{ color: v.perTrade !== null && v.perTrade > 0 ? 'var(--color-signal-good)' : 'var(--color-signal-warn)' }}>
            {v.perTrade !== null && v.perTrade > 0 ? '+' : ''}
            {v.perTrade}p a trade
          </span>
        </div>
      )}

      {/* The caveat belongs to the margin above it, so it nests under it
          rather than being printed at full length under every open set. */}
      <Disclosure
        depth={1}
        accent="var(--color-signal-warn)"
        eyebrow="against what"
        summary="Measured against selling the parts alone"
        answer="a comparison, not free money"
      >
        <p className="wf-prose">
          The parts you hold could have been sold separately instead, so the true gain is this margin minus what those
          would have fetched alone. Completing usually still wins &mdash; a set sells for more than its parts and moves
          in fewer trades.
        </p>
      </Disclosure>
    </div>
  );
}

export function SetCompletion({
  ownedSlugs,
  catalog,
  tradesLeft,
  tradablePlat,
  onVerdict,
  priced,
}: {
  ownedSlugs: ReadonlySet<string>;
  catalog: MarketCatalog | null;
  /** Trades remaining today, from the account. Null when unread. */
  tradesLeft: number | null;
  /** Platinum this account can actually spend. Null when unread. */
  tradablePlat: number | null;
  /**
   * Reported upward so the day's plan can weigh a completion against a sale.
   * Called from the click handler, never from an effect: it is a consequence of
   * what the player did, not of this component rendering.
   */
  onVerdict: (v: SetVerdict) => void;
  /**
   * The verdicts the panel above already has.
   *
   * The automatic pass moved up there, because a card at the top of the panel
   * needs it whether or not this section is on screen, and this section only
   * mounts when its own view is open. Everything past that pass is still priced
   * here, on a click.
   */
  priced: readonly SetVerdict[];
}) {
  const [clicked, setClicked] = useState<Map<string, SetVerdict>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const seqRef = useRef(0);

  /* What the panel priced, plus anything asked for by hand since. */
  const verdicts = useMemo(() => {
    const m = new Map<string, SetVerdict>();
    for (const v of priced) m.set(v.setSlug, v);
    for (const [k, v] of clicked) m.set(k, v);
    return m;
  }, [priced, clicked]);

  const gaps = useMemo(() => (catalog ? setGaps(ownedSlugs, catalog) : []), [ownedSlugs, catalog]);

  /*
   * THE AUTOMATIC PASS MOVED UP TO THE PANEL.
   *
   * It used to live here, and that meant it only ran while this section was on
   * screen - so the card at the top of the panel that answers "is a set worth
   * finishing" said "nothing is within two parts" whenever the player was
   * looking at any other view. The answer existed; the component that computed
   * it was not mounted. Whatever the panel has already priced arrives in
   * `priced`; everything past its cap is still priced here, on a click.
   */

  /* One gap, on a click: a handful of requests, spent because you asked. */
  const price = (gap: SetGap): void => {
    if (busy !== null) return;
    const mine = ++seqRef.current;
    setBusy(gap.setSlug);
    void priceGap(gap)
      .then((v) => {
        if (seqRef.current !== mine) return;
        setClicked((prev) => new Map(prev).set(gap.setSlug, v));
        onVerdict(v);
      })
      .finally(() => {
        if (seqRef.current === mine) setBusy(null);
      });
  };

  if (catalog === null) {
    return (
      <p className="eyebrow px-3.5 py-3" style={{ color: 'var(--text-faint)' }}>
        Reading the market catalogue
      </p>
    );
  }

  /*
   * Recomputed from the verdicts on screen, so it can never describe a set the
   * reader is not looking at.
   */
  const plan = planSets([...verdicts.values()], tradablePlat, tradesLeft);

  return (
    <div className="flex flex-col gap-3">
      {/*
        WHICH OF THESE YOU CAN ACTUALLY FINISH, NOT JUST WHICH ARE WORTH IT.
        ————————————————————————————————————————————
        Every row below is priced against the whole account, so five sets can
        each show a green margin while your platinum covers two and your trades
        cover one. Each row is right; the list is not, because the sets compete
        for the same two budgets and nothing said so.

        Ordered by margin per trade - which this file already calls the only
        figure worth comparing across sets - so nothing is invented to rank
        them. With either budget unread it says so rather than guessing.
      */}
      {plan.settled && plan.take.length + plan.blocked.length > 1 && (
        <p className="wf-note mb-2 px-1">
          <span style={{ color: plan.take.length > 0 ? 'var(--color-signal-good)' : 'var(--color-signal-warn)' }}>
            {plan.take.length === 0
              ? 'None of these fit what you hold today'
              : `${String(plan.take.length)} of these fit what you hold today`}
          </span>
          {plan.blocked.length > 0 && (
            <>
              {' \u2014 '}
              {(() => {
                const p = plan.blocked.filter((b) => b.ranOut === 'platinum').length;
                const t = plan.blocked.filter((b) => b.ranOut === 'trades').length;
                const parts: string[] = [];
                if (p > 0) parts.push(`${String(p)} past what your platinum covers`);
                if (t > 0) parts.push(`${String(t)} past your trades for today`);
                return parts.join(', ');
              })()}
            </>
          )}
        </p>
      )}

      <div className="rf-plate rf-lit relative px-5 py-4" style={{ clipPath: CHAMFER, background: PLATE, ['--rf-row-accent' as string]: 'var(--color-tenno-300)' }}>
        <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[3px]" style={{ background: 'var(--color-tenno-300)' }} />
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="eyebrow">Sets you are nearly holding</span>
          <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
            {/*
              AN EMPTY LIST IS NOT AN ANSWER OF NONE.
              ————————————————————————————————————————————
              This read `gaps.length === 0 ? 'none within two parts'`, and with
              no account read `gaps` is empty because nothing is KNOWN. The
              heading therefore stated, confidently and in the section's own
              summary line, that the player holds no near-complete set - a claim
              about their inventory made from no data at all.

              It is the exact rule the rest of this codebase is built on, broken
              in the one line most likely to be read: absent is not zero, and a
              collection that is empty because it was never filled says nothing
              about what it would have contained.
            */}
            {ownedSlugs.size === 0
              ? 'not yet known'
              : gaps.length === 0
                ? 'none within two parts'
                : `${String(gaps.length)} within two parts`}
          </span>
          {gaps.length > 0 && (
            <span
              className="eyebrow"
              style={{ color: verdicts.size < Math.min(AUTO_GAPS, gaps.length) ? 'var(--color-orokin-300)' : 'var(--color-signal-good)' }}
            >
              {verdicts.size < Math.min(AUTO_GAPS, gaps.length)
                ? `checking the closest \u2014 ${String(verdicts.size)} of ${String(Math.min(AUTO_GAPS, gaps.length))}`
                : `${String(verdicts.size)} checked`}
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="numeric text-[length:var(--text-title)] leading-none" style={{ color: 'var(--color-tenno-300)' }}>
            {tradesLeft === null ? '—' : tradesLeft}
          </span>
          <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
            {tradesLeft === null ? 'trades left today — not in this account read' : 'trades left today, and that is the real limit'}
          </span>
        </div>

        {/*
          THREE PARAGRAPHS OF THE SAME GREY TYPE, STACKED, WAS THE WALL.

          They are not the same KIND of thing: the first is the rule the whole
          section runs on, the second is what the number in the rows actually
          measures, the third is the caveat on that number. Flat, they read as
          one block nobody finishes. Nested, each closed row states its own
          conclusion, and the second and third sit UNDER the first because they
          are qualifications of it - which is what the depth rail draws.
        */}
        <div className="mt-2.5">
          <Disclosure
            accent="var(--color-tenno-300)"
            eyebrow="the unit this section compares in"
            summary="Platinum per trade, not platinum"
            answer="the cap is your Mastery Rank"
          >
            <p className="wf-prose">
              A part costs one trade to buy and the finished set costs one to sell, so a set you hold three of is two
              trades for one sale. Your daily cap cannot be raised or saved up &mdash; which makes platinum{' '}
              <em>per trade</em> the only number worth comparing.
            </p>

            <div className="mt-2">
              <Disclosure
                depth={1}
                accent="var(--color-tenno-300)"
                eyebrow="what the margin measures"
                summary="Against the gap, not the whole set"
                answer="an order of magnitude apart"
              >
                <p className="wf-prose">
                  Buying every part of a set and reselling it earns one to three platinum a trade and is barely worth
                  the cap. Buying the ONE part you are missing is a completely different trade.
                </p>
                <p className="wf-prose mt-2">
                  Measured live: Hydroid Prime came out at 38p in for a 93p set &mdash; 27.5p a trade &mdash; because
                  the expensive parts were already yours.
                </p>
              </Disclosure>
            </div>

            <div className="mt-2">
              <Disclosure
                depth={1}
                accent="var(--color-signal-warn)"
                eyebrow="what the margin leaves out"
                summary="The parts you hold could have been sold alone"
                answer="a comparison, not free money"
              >
                <p className="wf-prose">
                  The true gain is this margin minus what those parts would have fetched on their own. Completing
                  usually still wins &mdash; a set sells for more than its parts and costs fewer trades to move.
                </p>
              </Disclosure>
            </div>
          </Disclosure>
        </div>
      </div>

      <style>{`
        /* TRANSFORM ONLY: the overlay's timeline can stop at frame zero and
           never advance, so an entrance that starts from hidden stays hidden. */
        @keyframes rf-open-in { from { transform: translate3d(-8px,0,0); } to { transform: none; } }
        .rf-open { animation: rf-open-in 260ms cubic-bezier(0.16, 1, 0.3, 1) backwards; }
        .rf-chev { transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1); background: none; border: 0; padding: 0; }
        @media (prefers-reduced-motion: reduce) { .rf-open { animation: none; } .rf-chev { transition: none; } }
      `}</style>
      <ul className="rf-staged flex flex-col gap-[3px]" style={staggerFor(Math.min(gaps.length, 40))}>
        {gaps.slice(0, 40).map((gap) => {
          const v = verdicts.get(gap.setSlug);
          const loading = busy === gap.setSlug;
          const isOpen = open === gap.setSlug;
          return (
            <li
              key={gap.setSlug}
              className="rf-row px-3.5 py-2.5"
              style={{ clipPath: CHAMFER, background: isOpen ? 'oklch(1 0 0 / 0.05)' : 'var(--plate-lift)' }}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {v !== undefined && v.margin !== null && (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-label={`Show how ${gap.name} is priced`}
                    onClick={() => setOpen(isOpen ? null : gap.setSlug)}
                    className="rf-chev mo-focusable shrink-0 cursor-pointer text-[length:var(--text-nano)]"
                    style={{ color: isOpen ? 'var(--color-orokin-300)' : 'var(--text-ghost)', transform: isOpen ? 'rotate(90deg)' : 'none' }}
                  >
                    &rsaquo;
                  </button>
                )}
                <span className="text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
                  {gap.name}
                </span>
                <span className="eyebrow shrink-0" style={{ color: 'var(--text-faint)' }}>
                  {gap.held.length} of {gap.parts.length} held
                </span>
                <span className="eyebrow shrink-0" style={{ color: 'var(--color-signal-warn)' }}>
                  {gap.missing.length + 1} trades
                </span>

                <span className="ml-auto shrink-0" />

                {v === undefined ? (
                  <button
                    type="button"
                    onClick={() => price(gap)}
                    disabled={busy !== null}
                    className="rf-clipped mo-field mo-lift mo-focusable px-3 py-1 text-[length:var(--text-micro)] tracking-[0.16em] uppercase"
                    style={{
                      clipPath: CHAMFER,
                      background: loading ? 'oklch(1 0 0 / 0.05)' : 'oklch(0.30 0.06 235 / 0.4)',
                      color: loading ? 'var(--text-faint)' : 'var(--text)',
                      cursor: busy !== null ? 'default' : 'pointer',
                    }}
                  >
                    {loading ? 'Pricing…' : 'Check this one'}
                  </button>
                ) : v.margin === null ? (
                  <span className="eyebrow" style={{ color: 'var(--color-signal-warn)' }}>
                    {v.setPrice === null ? 'the set has no recent trades' : 'a missing part has no recent trades'}
                  </span>
                ) : (
                  <>
                    <span className="numeric text-[length:var(--text-micro)]" style={{ color: 'var(--text-faint)' }}>
                      buy {v.toBuy?.toFixed(1)}p → sell {v.setPrice?.median}p
                    </span>
                    <span
                      className="numeric w-24 text-right text-[length:var(--text-small)]"
                      style={{ color: v.perTrade !== null && v.perTrade > 0 ? 'var(--color-signal-good)' : 'var(--color-signal-warn)' }}
                    >
                      {v.perTrade !== null && v.perTrade > 0 ? '+' : ''}
                      {v.perTrade}p/trade
                    </span>
                  </>
                )}
              </div>

              {v !== undefined && v.margin !== null && !isOpen && (
                <p className="wf-note mt-1">
                  {v.perTrade !== null && v.perTrade <= 0
                    ? 'Negative — the parts cost more than the set sells for. Sell them separately instead.'
                    : `Still to buy: ${gap.missing.map((m) => m.replace(/_/g, ' ')).join(', ')}.`}
                </p>
              )}

              {isOpen && v !== undefined && <SetDetail v={v} />}
            </li>
          );
        })}

        {gaps.length === 0 && (
          <li className="eyebrow px-3.5 py-3" style={{ color: 'var(--text-faint)' }}>
            {/*
              Short, because the panel says the rest once.

              This used to carry the full "this account has never sent an
              inventory - nothing here is a zero, it is unread" sentence, and
              the plate immediately below says the same thing at length. One
              screen was stating the account's state eight times; this is one of
              the eight. The section says only what is true OF THE SECTION and
              lets the plate carry the explanation.
            */}
            {ownedSlugs.size === 0
              ? 'Not known until an inventory is read.'
              : 'Nothing you hold is within two parts of a complete set.'}
          </li>
        )}
      </ul>
    </div>
  );
}
