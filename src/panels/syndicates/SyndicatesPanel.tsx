/**
 * SYNDICATES — the standing ledger.
 *
 * The panel exists to answer one question the game makes you visit six separate
 * consoles to answer: *what standing is about to expire, and what does spending
 * it buy me today?*
 *
 * THE ONE BOLD ELEMENT
 * ────────────────────
 * The syndicate closest to its next rank. `buildRows` already sorts by the gap
 * to the next rank, so the head of that list is promoted out of it and drawn
 * large — that is the answer to "spend it here", and it is the only thing on the
 * panel that gets hero treatment. The daily allowance, the ceiling counts and
 * the fourteen other syndicates are dense, quiet rows beneath it.
 *
 * The arithmetic all lives in ./ladder.ts, which is pure and checked by
 * scripts/check-syndicates-panel.ts. This file only decides how it looks.
 */

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useAccount } from '../../core/store';
import type { RawAccount } from '../../data/account';
import { dailyState, nextDailyResetUtc, syndicateState } from '../../data/subsystems';
import { EmptyState } from '../../ui/orokin';
import { buildRows, dailyTotals, specFor, type Ladder, type SyndicateRow } from './ladder';
import { Facts, GoLink } from '../../ui/interact';
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { Segmented } from '../shared/Segmented';
import { CHAMFER, PLATE_LIFT as PLATE } from '../../ui/geometry';

const fmt = (n: number): string => Math.round(n).toLocaleString();

/** Signed, because a demoted faction syndicate genuinely sits below zero. */
const fmtSigned = (n: number): string => (n < 0 ? `−${fmt(Math.abs(n))}` : fmt(n));

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function SectionTitle({ children, count, note }: { children: string; count?: number; note?: string }) {
  return (
    <header className="mb-2.5 flex items-baseline gap-3">
      <h2
        className="font-[family-name:var(--font-title)] text-[length:var(--text-small)] tracking-[0.26em] uppercase"
        style={{ color: 'var(--color-orokin-300)' }}
      >
        {children}
      </h2>
      {count !== undefined && (
        <span className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--text-faint)' }}>
          {count}
        </span>
      )}
      <span
        aria-hidden
        className="h-px flex-1"
        style={{ background: 'var(--rule-hairline)' }}
      />
      {note !== undefined && <span className="eyebrow">{note}</span>}
    </header>
  );
}

/**
 * The world a syndicate stands on, as somewhere you can go.
 *
 * Fifteen coloured syndicate names, each an entity the app has a star chart
 * about, and every one of them was a dead end: you read "Ostron", you want
 * Cetus, and the panel would not take you there. Only the syndicates whose
 * `home` is a real world in the node data carry this — see `SyndicateSpec` —
 * so it is never a link to an empty globe.
 *
 * Dotted underline and the navigation ink at REST, not on hover: an affordance
 * that only exists once the pointer is on it is not an affordance.
 */
function HomeLink({ home }: { home: string }) {
  return (
    <GoLink
      kind="planet"
      id={home}
      className="text-[length:var(--text-micro)] text-[color:var(--color-tenno-300)] underline decoration-dotted underline-offset-2"
      title={`Show ${home} on the star chart`}
    >
      {home}
    </GoLink>
  );
}

/**
 * A flat track with an optional ghost tick.
 *
 * The tick is where today's remaining allowance can carry you on this same bar —
 * the detail that turns two numbers into one decision. Width, not a transform,
 * so a throttled renderer can never leave a filled bar reading empty.
 */
function Track({ value, color, ghost, height = 4 }: { value: number; color: string; ghost?: number | null; height?: number }) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return (
    <span aria-hidden className="relative block w-full overflow-hidden" style={{ height, background: 'oklch(1 0 0 / 0.07)' }}>
      <span className="block h-full" style={{ width: `${Math.max(2, v * 100)}%`, background: color }} />
      {ghost != null && Number.isFinite(ghost) && (
        <span
          className="absolute inset-y-0 w-px"
          style={{ left: `${Math.max(0, Math.min(1, ghost)) * 100}%`, background: 'oklch(1 0 0 / 0.45)' }}
        />
      )}
    </span>
  );
}

/** Cut chip. No glow, no gradient — the colour is the whole message. */
function Badge({ color, children }: { color: string; children: string }) {
  return (
    <span
      className="text-[length:var(--text-nano)] font-semibold tracking-[0.16em] whitespace-nowrap uppercase"
      style={{
        clipPath: 'polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%)',
        padding: '2px 9px',
        color,
        background: `color-mix(in oklab, ${color} 15%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

/** Rank as diamonds, the game's own grammar. Filled to the current title. */
function RankPips({ title, maxTitle, color }: { title: number; maxTitle: number; color: string }) {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden>
      {Array.from({ length: maxTitle }, (_, i) => {
        const held = i < title;
        return (
          <span
            key={i}
            className="h-[9px] w-[9px] rotate-45"
            style={{
              background: held ? color : 'transparent',
              // A 20%-alpha hairline on a 7px diamond read as grit on the plate
              // rather than as an empty rank. The pip carries information — how
              // many ranks are left — so it is drawn at the legibility floor.
              boxShadow: held ? undefined : 'inset 0 0 0 1px oklch(1 0 0 / 0.50)',
            }}
          />
        );
      })}
    </span>
  );
}

/**
 * The rank readout. Negative titles are a real state for the six originals — an
 * alignment hit demotes you — so they are coloured as the hazard they are rather
 * than being clamped away.
 */
function RankLabel({ row }: { row: SyndicateRow }) {
  if (row.title === null) {
    return (
      <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
        no ranks
      </span>
    );
  }
  const tone = row.title > 0 ? row.color : row.title === 0 ? 'var(--color-signal-warn)' : 'var(--color-signal-bad)';
  return (
    <span className="flex items-center gap-2.5">
      {row.maxTitle !== null && row.maxTitle > 0 && row.title >= 0 && (
        <RankPips title={row.title} maxTitle={row.maxTitle} color={row.color} />
      )}
      <span className="flex items-baseline gap-1">
        <span className="eyebrow">Rank</span>
        <span className="numeric text-[length:var(--text-small)]" style={{ color: tone }}>
          {row.title}
        </span>
        {row.maxTitle !== null && (
          <span className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
            /{row.maxTitle}
          </span>
        )}
      </span>
    </span>
  );
}

/** Left/right captions under the rank track — the raw cumulative numbers. */
function Ledger({ row }: { row: SyndicateRow }) {
  return (
    <div className="mt-1.5 flex items-baseline justify-between gap-3">
      <span className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
        {row.tierMin !== null ? fmtSigned(row.tierMin) : '—'}
      </span>
      <span className="numeric text-[length:var(--text-micro)]" style={{ color: 'var(--text)' }}>
        {fmtSigned(row.standing)}
      </span>
      <span className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
        {row.nextAt !== null ? fmtSigned(row.nextAt) : row.tierMax !== null ? fmtSigned(row.tierMax) : '—'}
      </span>
    </div>
  );
}

/** The chips a row can wear. Shared so the lead plate and the list agree. */
function Flags({ row }: { row: SyndicateRow }) {
  return (
    <>
      {row.pledged && <Badge color="var(--color-orokin-300)">Pledged</Badge>}
      {row.rankUpToday && !row.maxed && !row.atCeiling && <Badge color="var(--color-signal-good)">Rank up today</Badge>}
      {row.atCeiling && !row.maxed && <Badge color="var(--color-signal-warn)">Capped · rank up</Badge>}
      {row.maxed && <Badge color="var(--color-void-200)">Max</Badge>}
      {/* Initiation is a rite of the six; a row already holding a rank has plainly passed it. */}
      {!row.initiated && MAIN_SIX.has(row.tag) && (row.title ?? 0) <= 0 && <Badge color="var(--color-void-300)">Not initiated</Badge>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Reset countdown
// ---------------------------------------------------------------------------

/**
 * The clock is its own component on purpose: it re-renders every second, and
 * hoisting that into the panel would re-render fifteen rows a second on top of
 * a live game. Subscribed rather than mirrored into state, so render stays pure.
 */
function ResetCountdown({ at }: { at: number | null }) {
  const now = useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, 1000);
      return () => {
        clearInterval(id);
      };
    },
    () => Math.floor(Date.now() / 1000) * 1000,
    () => 0,
  );

  if (at === null) {
    return (
      <span className="text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
        reset time not in this account read
      </span>
    );
  }

  // The instant came from a memo keyed on the account; a session open across
  // 00:00 UTC would otherwise sit at zero until the next read. Roll it here, on the tick.
  const left = (at > now ? at : nextDailyResetUtc(now)) - now;
  const h = Math.floor(left / 3_600_000);
  const mm = String(Math.floor((left % 3_600_000) / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, '0');
  // Inside the last hour the allowance is genuinely about to be destroyed.
  const urgent = left < 3_600_000;

  return (
    <span className="flex items-baseline gap-2">
      <span className="eyebrow">Resets in</span>
      <span
        className="numeric text-[length:var(--text-small)]"
        style={{ color: urgent ? 'var(--color-signal-warn)' : 'var(--text-muted)' }}
      >
        {h}:{mm}:{ss}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// The lead — the bold element
// ---------------------------------------------------------------------------

/**
 * The syndicate with the smallest gap to its next rank, drawn large.
 *
 * Green when today's allowance genuinely closes the gap, gold when it does not:
 * the colour is the answer, not decoration. This row is removed from the list
 * below rather than repeated in it.
 */
function Lead({ row }: { row: SyndicateRow }) {
  const reachable = row.rankUpToday;
  const tone = reachable ? 'var(--color-signal-good)' : 'var(--color-orokin-400)';

  return (
    <section
      className="mo-field mo-tilt mo-sheen mo-in-settle relative isolate"
      style={{
        clipPath: CHAMFER,
        padding: 1,
        background: `linear-gradient(150deg, ${tone}, color-mix(in oklab, ${tone} 18%, transparent) 44%, transparent 78%)`,
      }}
    >
      {/*
        A GRID, BECAUSE THE FLEX ROW HANDED THE PARAGRAPH THE WIDTH AND THE
        NAME THE SCRAPS.
        ————————————————————————————————————————————
        Measured in a real browser at 1280x720 with an account read: the left
        block - the eyebrow, the badges, the syndicate's NAME at 41.6px and the
        rank bar - was 250px wide, and the right block, whose tallest thing is
        an explanatory sentence, was 708px. That is what `flex-1` beside an
        auto-sized item does: the left item's flex basis is 0, the right one's
        is its max-content, and `.wf-prose` carries a 70ch measure, so the
        paragraph claimed 70ch and the name was left to wrap onto three lines.
        The plate was 281px tall and the bold element was the narrowest thing
        on it.

        Two tracks state the intent instead of leaving it to basis arithmetic:
        the answer column is capped, and everything it does not need goes to
        the name. Below `lg` the tracks collapse to one and it stacks exactly
        as the wrapped flex row did.
      */}
      <div
        className="relative grid items-end gap-x-10 gap-y-5 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)]"
        style={{
          clipPath: CHAMFER,
          background:
            'radial-gradient(120% 150% at 0% 0%, oklch(1 0 0 / 0.05), transparent 58%), linear-gradient(168deg, oklch(0.155 0.026 268 / 0.97), oklch(0.105 0.022 275 / 0.98))',
        }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span aria-hidden className="size-[5px] rotate-45" style={{ background: row.color }} />
            <span className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
              Closest to the next rank
            </span>
            <Flags row={row} />
          </div>

          <h2
            className="mt-2.5 font-[family-name:var(--font-title)] text-[length:var(--text-title)] leading-[1.1] tracking-[0.1em] uppercase"
            style={{ color: row.color }}
          >
            {row.name}
          </h2>

          {row.progress !== null && (
            <div className="mt-3.5 max-w-[34rem]">
              <Track value={row.progress} color={row.color} ghost={row.reachToday} height={6} />
              <Ledger row={row} />
            </div>
          )}

          {row.note !== null && (
            <p className="wf-prose mt-2">
              {row.note}
            </p>
          )}
        </div>

        <div className="min-w-[13rem]">
          <div className="eyebrow" style={{ color: tone }}>
            Standing to next rank
          </div>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className="numeric text-[length:var(--text-hero)] leading-none" style={{ color: tone }}>
              {row.toNext !== null ? fmt(row.toNext) : '—'}
            </span>
            {row.title !== null && (
              <span className="numeric text-[length:var(--text-small)]" style={{ color: 'var(--text-muted)' }}>
                to rank {row.title + 1}
              </span>
            )}
          </div>

          <p className="wf-prose mt-2.5">
            {row.dailyRemaining === null
              ? 'Today’s standing for this syndicate is not tracked here yet, so whether today covers the gap cannot be said.'
              : reachable
                ? `Today's remaining ${fmt(row.dailyRemaining)} covers it. The rank is available before reset.`
                : `Today's remaining ${fmt(row.dailyRemaining)} does not cover it. The tick on the bar is how far it reaches.`}
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The ladder itself
// ---------------------------------------------------------------------------

/**
 * Every rank of a syndicate, and where this account sits on it.
 *
 * These thresholds were already in ladder.ts, exact and verified, and the panel
 * showed exactly one of them: the next one. A player deciding whether a
 * syndicate is worth grinding wants the whole shape - how many ranks are left,
 * how steeply they climb, and how far past the halfway point they already are.
 * That is a question the app could always answer and never did.
 *
 * Only the `tiers` ladder gets a table. `linear` states its step, `untiered`
 * states its cap, and `unknown` says so - inventing rows for a tag whose
 * thresholds are not verified is precisely what ladder.ts refuses to do.
 */
function RankLadder({ row, ladder }: { row: SyndicateRow | null; ladder: Ladder }) {
  if (ladder.kind === 'unknown') {
    return (
      <p className="wf-note">
        No verified rank thresholds exist for this tag, so there is no ladder to draw. Raw standing above is
        measured; everything else would be a guess.
      </p>
    );
  }

  if (ladder.kind === 'untiered') {
    return (
      <Facts
        items={[
          { label: 'Holding cap', value: ladder.cap.toLocaleString() },
          { label: 'Ranks', value: 'none — this syndicate has no titles' },
        ]}
      />
    );
  }

  if (ladder.kind === 'linear') {
    return (
      <Facts
        items={[
          { label: 'Standing per rank', value: ladder.step.toLocaleString() },
          { label: 'Final rank', value: ladder.maxTitle === null ? '' : String(ladder.maxTitle), when: ladder.maxTitle !== null },
        ]}
      />
    );
  }

  /*
   * The widest rank, so every bar below is drawn to the same scale.
   *
   * This is the whole reason to draw them at all: the standard ladder runs
   * 10,000 wide at rank 0 and 132,000 wide at rank 5, and that thirteenfold
   * acceleration is the single most useful thing to know about a syndicate
   * grind. As a column of numbers it is something you have to work out; as bars
   * it is the shape of the list.
   */
  const widest = ladder.tiers.reduce((m, t) => Math.max(m, t.max - t.min), 0);

  return (
    <ol className="flex flex-col gap-px">
      {ladder.tiers.map((t) => {
        const here = row !== null && row.title === t.title;
        // Cumulative standing, so "passed" is a comparison against the rank's
        // own floor. No account means no comparison at all, not a false "no".
        const passed = row !== null && row.title !== null && row.title > t.title;
        const span = t.max - t.min;
        return (
          <li
            key={t.title}
            /*
             * WRAPS, because this table now lives in a column and not across
             * the whole window.
             * ————————————————————————————————————————————
             * The fixed parts of this row - the rank, the 9.5rem range, the
             * 3.4rem width and the 3.5rem "you" marker - come to 358px before
             * the bar gets a pixel, and the row sits two disclosures deep
             * (each level adds 0.85rem of rail plus 1.5rem of body padding).
             * Inside the 604px ladder pane that leaves 287px, so the marker
             * would have hung off the right of the plate. The bar group is the
             * only part that can give, so it is given a floor and the row is
             * allowed to break rather than to overhang: at full width nothing
             * changes, because a row that fits does not wrap.
             */
            className="flex flex-wrap items-center gap-3 px-2.5 py-1"
            style={{
              background: here && row !== null ? `color-mix(in oklch, ${row.color} 14%, transparent)` : 'transparent',
              boxShadow: here && row !== null ? `inset 2px 0 0 0 ${row.color}` : undefined,
            }}
          >
            <span
              className="numeric w-8 shrink-0 text-[length:var(--text-micro)]"
              style={{ color: here && row !== null ? row.color : 'var(--text-muted)' }}
            >
              {t.title >= 0 ? `R${t.title}` : t.title}
            </span>
            {/* The range is the label the bar belongs to, so it is sized to its
                own text and the BAR takes the free width. Left as `flex-1` the
                range stretched across the row and pushed every bar into a 9rem
                gutter at the far right, with half the row empty between them. */}
            <span
              className="numeric w-[9.5rem] shrink-0 whitespace-nowrap text-[length:var(--text-micro)]"
              style={{ color: here ? 'var(--text)' : 'var(--text-muted)' }}
            >
              {t.min.toLocaleString()} to {t.max.toLocaleString()}
            </span>
            {/* A floor rather than `min-w-0`: with a zero floor this group's
                hypothetical size is zero, so the row above would never wrap and
                the fixed columns after it would simply overhang. */}
            <span className="flex min-w-[6rem] flex-1 items-center gap-2">
              <span
                aria-hidden
                className="h-[5px] flex-1 overflow-hidden"
                style={{ background: 'oklch(1 0 0 / 0.06)' }}
              >
                <span
                  className="block h-full"
                  style={{
                    width: `${String(widest > 0 ? Math.max(2, (span / widest) * 100) : 0)}%`,
                    background: here && row !== null ? row.color : 'oklch(1 0 0 / 0.22)',
                  }}
                />
              </span>
              <span
                className="numeric w-[3.4rem] shrink-0 text-right text-[length:var(--text-micro)]"
                style={{ color: 'var(--text-muted)' }}
              >
                {span.toLocaleString()}
              </span>
            </span>
            <span className="w-14 shrink-0 text-right">
              {here ? (
                <span className="eyebrow" style={{ color: row?.color }}>
                  you
                </span>
              ) : passed ? (
                <span className="eyebrow" style={{ color: 'var(--text-muted)' }}>
                  passed
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * How to read every ladder on the page, said once.
 *
 * This used to be a paragraph inside `RankLadder`, which meant twenty-two
 * identical copies of it down a single screen — one per syndicate. It explains
 * the whole list, not any one row, so it belongs with the list's heading.
 */
function LadderLegend() {
  return (
    <div className="mb-2.5 text-[length:var(--text-micro)] leading-snug" style={{ color: 'var(--text-muted)' }}>
      <Clamp lines={1}>
        Thresholds are cumulative lifetime standing, and each bar is that rank&rsquo;s width against the widest one — so
        the climb steepening toward the ceiling is a shape you can see rather than arithmetic you have to do.
      </Clamp>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List row
// ---------------------------------------------------------------------------

function SyndicateRowItem({ row, index }: { row: SyndicateRow; index: number }) {
  // Open state lives in `Disclosure` now, along with the aria wiring and the
  // rule that the body may never animate its own height.
  const { ladder, home } = specFor(row.tag);

  /*
   * Days to the next rank, at today's allowance.
   *
   * Both operands are measured - the gap comes from the ladder, the cap from the
   * account's own daily limit - so this is arithmetic on real numbers rather
   * than an estimate. It is the single question the panel exists to answer and
   * it was never on screen. Guarded on a positive cap because dividing by a
   * missing or zero allowance would produce Infinity.
   */
  // Today counts only what is still left of today's allowance; every later
  // day is a full cap. "Today" beside a gap larger than the remaining
  // allowance was the claim this replaces.
  const daysToNext =
    row.toNext !== null && row.dailyCap !== null && row.dailyCap > 0 && !row.maxed
      ? row.dailyRemaining !== null
        ? row.dailyRemaining >= row.toNext
          ? 1
          : 1 + Math.ceil((row.toNext - row.dailyRemaining) / row.dailyCap)
        : Math.ceil(row.toNext / row.dailyCap)
      : null;

  const dailyFrac =
    row.dailyRemaining !== null && row.dailyCap !== null && row.dailyCap > 0 ? row.dailyRemaining / row.dailyCap : null;

  return (
    <li
      className="rf-plate mo-field mo-sheen mo-in-up relative flex flex-wrap items-start gap-x-5 gap-y-3 py-3 pr-4 pl-4"
      // `--i` is capped by `mo-stagger` itself, so a fifteen-syndicate account
      // does not wait a second for the tail of the list to arrive.
      style={{ '--i': index, clipPath: CHAMFER, background: PLATE } as React.CSSProperties}
    >
      {/* Identity spine. The one place the syndicate's colour is unmixed. */}
      <span
        aria-hidden
        className="absolute top-0 bottom-0 left-0 w-[2px]"
        style={{ background: row.color, opacity: row.maxed ? 0.45 : 1 }}
      />

      <div className="min-w-[18rem] flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {/* Not truncated: a syndicate name that needs two lines gets two lines. */}
            <h3
              className="font-[family-name:var(--font-display)] text-[length:var(--text-small)] leading-tight font-semibold"
              style={{ color: row.color }}
            >
              {row.name}
            </h3>
            {/* Beside the heading rather than inside it: the name is the label of
                this row, the link is a separate thing you can do. */}
            {home !== undefined && (
              <span className="text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
                on <HomeLink home={home} />
              </span>
            )}
            <Flags row={row} />
          </div>
          <div className="flex items-center gap-3">
            <RankLabel row={row} />
          </div>
        </div>

        <div className="mt-2.5">
          {row.progress === null ? (
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="eyebrow">Standing</span>
              <span className="numeric text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
                {fmtSigned(row.standing)}
              </span>
              <span className="text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
                rank thresholds unknown for this syndicate
              </span>
            </div>
          ) : (
            <>
              <Track value={row.progress} color={row.color} ghost={row.reachToday} />
              <Ledger row={row} />
            </>
          )}
        </div>

        {/*
          THREE LEVELS, IN THE ORDER A READER ACTUALLY WANTS THEM.
          The verdict — how long the next rank takes — sits on the closed
          summary. Its working (the days-at-cap arithmetic, the consequence of
          the ceiling) is one level down. The provenance — the whole rank ladder
          with its thresholds, and the note about how the rank was derived — is
          one level below that. The row printed all three at once, twenty-two
          times, and that is the wall this panel was.
        */}
        <div className="mt-2.5">
          <Disclosure
            depth={1}
            accent={row.color}
            eyebrow="ladder"
            summary={row.maxed ? 'At the top rank' : 'How long the next rank takes'}
            answer={
              <span className="numeric">
                {daysToNext === null
                  ? row.maxed
                    ? 'nothing left'
                    : 'needs a daily cap'
                  : daysToNext === 1
                    ? 'today'
                    : `${String(daysToNext)} days`}
              </span>
            }
          >
            {/*
              * ONLY WHAT THE COLLAPSED ROW DOES NOT ALREADY SAY.
              *
              * Five of the seven facts here were already on screen at the same
              * instant: Standing is in the ledger, To next rank and Next rank
              * at are the ledger's two figures relabelled, Daily cap is the
              * right-hand column, and the ladder below marks the same
              * threshold a third time. Opening this is supposed to reveal what
              * you did not know.
              */}
            <Facts
              items={[
                {
                  label: 'Days at full cap',
                  value: daysToNext === null ? '' : daysToNext === 1 ? 'today' : `${String(daysToNext)} days`,
                  when: daysToNext !== null,
                },
                { label: 'At the ceiling', value: 'further standing is discarded until you rank up', when: row.atCeiling },
              ]}
              columns={2}
            />

            {row.note !== null && (
              <div className="max-w-[76ch] text-[length:var(--text-micro)] leading-snug" style={{ color: 'var(--text-muted)' }}>
                <Clamp lines={2}>{row.note}</Clamp>
              </div>
            )}

            {/* Provenance, one level below the working it qualifies. A rank we
                inferred is not a rank the game sent, and that difference has to
                stay reachable — it just does not have to be shouted on a row
                the reader has not opened. */}
            <Disclosure
              depth={2}
              accent={row.color}
              eyebrow="thresholds"
              summary="Every rank on this ladder"
              answer={
                row.maxTitle !== null ? (
                  <span className="numeric">{row.maxTitle + 1} ranks</span>
                ) : (
                  <span>no verified ranks</span>
                )
              }
            >
              {row.titleInferred && row.title !== null && (
                <p className="wf-note" style={{ color: 'var(--color-signal-warn)' }}>
                  Rank not sent by the game — worked out from standing held.
                </p>
              )}
              <RankLadder row={row} ladder={ladder} />
            </Disclosure>
          </Disclosure>
        </div>
      </div>

      {/* The actionable column. Fixed width so the numbers line up down the list
          and the eye can scan them as one column rather than reading them. */}
      <div className="w-[11rem] shrink-0">
        <div className="eyebrow">Daily left</div>
        {row.dailyRemaining === null ? (
          /*
           * THE REASON, WITHOUT THE DASH IN FRONT OF IT.
           * ————————————————————————————————————————————
           * Measured in a real browser with a real account read: the panel
           * carried NINE em-dash readouts and eight of them were this one div,
           * once per syndicate, 26px of --text-lead each, every one of them
           * directly above a sentence that already said the same thing in
           * words. A dash is how this app writes "we did not measure that", and
           * it earns its place where a number would otherwise be invented - but
           * eight of them down one column is not a refusal, it is a texture, and
           * the line underneath was carrying the whole meaning anyway.
           *
           * The reason stays per row because it is not the same reason on every
           * row: the six originals share one pool, Nightwave has no cap at all,
           * and the rest are counters this build cannot map. Only the dash is
           * gone.
           */
          <div className="mt-1 text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
            {row.isNightwave ? 'no daily cap' : row.sharedPool ? 'shared with the six' : 'daily standing not tracked here yet'}
          </div>
        ) : (
          <>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span
                className="numeric text-[length:var(--text-lead)] leading-none"
                style={{ color: row.dailyRemaining > 0 ? 'var(--text)' : 'var(--text-muted)' }}
              >
                {fmt(row.dailyRemaining)}
              </span>
              {row.dailyCap !== null && (
                <span className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
                  /{fmt(row.dailyCap)}
                </span>
              )}
            </div>
            {dailyFrac !== null && (
              <div className="mt-1.5">
                <Track value={dailyFrac} color={row.color} height={3} />
              </div>
            )}
            {row.sharedPool && (
              <div className="mt-1.5 text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
                shared with the six
              </div>
            )}
          </>
        )}

        {row.toNext !== null && !row.maxed && (
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="eyebrow">To next</span>
            <span
              className="numeric text-[length:var(--text-small)]"
              style={{ color: row.rankUpToday ? 'var(--color-signal-good)' : 'var(--text-muted)' }}
            >
              {fmt(row.toNext)}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The ladder with no account behind it
// ---------------------------------------------------------------------------

/** Nightwave's account tag carries the season ("RadioLegion7"); the roster and
 *  `specFor` both match on the bare family. */
function family(tag: string): string {
  return tag.startsWith('RadioLegion') ? 'RadioLegion' : tag;
}

/**
 * Every syndicate this build has verified thresholds for.
 *
 * A roster rather than a derivation, because `syndicateState` can only report
 * what an ACCOUNT carries — a player who has never visited Deimos has no
 * Entrati row — while the ladder itself exists whether or not anyone has joined
 * it. `specFor` owns the names, colours and thresholds; this list only says
 * which tags to ask it about.
 *
 * `RadioLegion` is the Nightwave prefix rather than a season tag: the season
 * changes, the ladder does not.
 */
/** The six with an initiation rite. The open-world factions have none and `Initiated` is simply absent on them. */
const MAIN_SIX: ReadonlySet<string> = new Set([
  'SteelMeridianSyndicate',
  'ArbitersSyndicate',
  'CephalonSudaSyndicate',
  'PerrinSyndicate',
  'RedVeilSyndicate',
  'NewLokaSyndicate',
]);

const ROSTER: readonly string[] = [
  'SteelMeridianSyndicate',
  'ArbitersSyndicate',
  'CephalonSudaSyndicate',
  'PerrinSyndicate',
  'RedVeilSyndicate',
  'NewLokaSyndicate',
  'CetusSyndicate',
  'SolarisSyndicate',
  'VoxSyndicate',
  'VentKidsSyndicate',
  'QuillsSyndicate',
  'EntratiSyndicate',
  'NecraloidSyndicate',
  'EntratiLabSyndicate',
  'ZarimanSyndicate',
  'HexSyndicate',
  'ConclaveSyndicate',
  'KahlSyndicate',
  'NightcapJournalSyndicate',
  'LibrarySyndicate',
  'EventSyndicate',
  'RadioLegion',
];

/**
 * The roster, bucketed by identical ladder shape, in roster order.
 *
 * Insertion-ordered so the six standard syndicates stay first, which is the
 * order players think of them in. Returns [shape, tags] pairs.
 */
function groupedRoster(): Array<[string, string[]]> {
  const groups = new Map<string, string[]>();
  for (const tag of ROSTER) {
    const shape = ladderShape(specFor(tag).ladder);
    const list = groups.get(shape);
    if (list) list.push(tag);
    else groups.set(shape, [tag]);
  }
  return [...groups];
}

/** The top rank a ladder offers, when it offers ranks at all. */
function ceilingOf(l: Ladder): number | null {
  if (l.kind === 'tiers') return l.tiers[l.tiers.length - 1]?.title ?? null;
  if (l.kind === 'linear') return l.maxTitle;
  return null;
}

/** What the ladder IS, in one clause — the part that needs no account. */
function ladderShape(l: Ladder): string {
  switch (l.kind) {
    case 'tiers': {
      const top = l.tiers[l.tiers.length - 1];
      const bottom = l.tiers[0];
      if (top === undefined || bottom === undefined) return 'Rank thresholds not known here';
      return `Ranks ${bottom.title} to ${top.title} · ${fmt(top.max)} standing at the ceiling`;
    }
    case 'linear':
      return l.step === 1
        ? `${l.maxTitle ?? '?'} ranks · standing is a rank counter, not a pool`
        : `${fmt(l.step)} standing per rank${l.maxTitle === null ? ' · season ceiling not known here' : ` · ${l.maxTitle} ranks`}`;
    case 'untiered':
      return `No ranks · standing is a balance capped at ${fmt(l.cap)}`;
    case 'unknown':
      return 'Rank thresholds not known here';
  }
}

/**
 * The panel WITHOUT an account.
 *
 * The ladder — who exists, how many ranks each offers, what the ceiling is — is
 * game data and is drawn in full. Standing, rank held and today's allowance are
 * the account's, and each is marked unmeasured rather than drawn at zero: a
 * zero here would claim you have joined nothing and earned nothing.
 */
function AccountBanner() {
  const running = useAccount((s) => s.gameRunning);
  const gep = useAccount((s) => s.gep);

  const [title, detail] = !running
    ? [
        'Showing the whole ladder, unmeasured',
        "Every syndicate, its ranks and its ceiling are game data. Your standing and today's allowance are not: run Warframe once and they are captured and kept, after which this panel stays accurate with the game closed.",
      ] as const
    : gep === 'connected'
      ? [
          'Linked — waiting for your account',
          'Your account arrives on the next update Warframe pushes — usually within a minute of loading into the Orbiter.',
        ] as const
      : [
          'Linking to the game',
          'Establishing the game-events connection. This normally takes a few seconds after launch.',
        ] as const;

  return (
    <section
      className="mo-in-up"
      style={{
        clipPath: CHAMFER,
        background: 'linear-gradient(168deg, oklch(0.17 0.03 80 / 0.55), oklch(0.12 0.02 70 / 0.6))',
        boxShadow: 'inset 2px 0 0 var(--color-orokin-500)',
      }}
    >
      <Disclosure summary={title} eyebrow="account" answer="what would change it" accent="var(--color-orokin-300)">
        <div className="text-[length:var(--text-small)] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          <Clamp lines={2}>{detail}</Clamp>
        </div>
      </Disclosure>
    </section>
  );
}

/**
 * One roster row.
 *
 * Deliberately COMPACT and free of the ladder-shape sentence.
 *
 * The first version printed `ladderShape()` on every row, which meant the string
 * "Ranks -2 to 5 · 372,000 standing at the ceiling" appeared six times in a
 * column, "not measured" appeared twenty-two times, and every row was the same
 * height and the same shape. Twenty-two rows of identical prose is a wall, not a
 * list — the eye has nothing to catch on and the actual differences (which
 * syndicate, what colour, how many ranks) are buried in the repetition.
 *
 * The shape now lives once on the group heading that owns it. What is left here
 * is only what differs per syndicate.
 */
function CatalogRowItem({ tag, index }: { tag: string; index: number }) {
  const spec = specFor(tag);
  const ceiling = ceilingOf(spec.ladder);

  /*
   * These rows open too, and that matters more here than on the account rows.
   *
   * This is the view a player sees BEFORE the game has ever run - the panel's
   * own banner calls it "the whole ladder, unmeasured". Every rank threshold in
   * it is game data that needs no account at all, and until now the only thing
   * a reader could learn was a one-line summary on the group heading. The
   * numbers were loaded, exact, and unreachable.
   *
   * The `spec.note` used to sit on the row itself, permanently, at up to 46
   * characters a row across twenty-two rows: a column of prose down the middle
   * of the list, which is exactly the wall this pass exists to remove.
   *
   * AND THEN THE LADDER SHAPE TOOK ITS PLACE, WHICH WAS THE SAME BUG.
   * ————————————————————————————————————————————
   * The comment here used to claim the closed row's answer was "the ceiling -
   * the one fact that differs between these syndicates". The code set it to
   * `ladderShape(spec.ladder)` instead, and `groupedRoster()` buckets rows BY
   * identical ladder shape - so within a group that string is invariant by
   * construction. Measured on the rendered page: "ranks 0 to 5 - 372,000
   * standing at the ceiling" appeared ELEVEN times in one viewport, and a
   * near-identical variant seven more.
   *
   * Worse, the ceiling it meant to show was already in the eyebrow as
   * "N ranks" AND drawn as pips beside the name. Three statements of one fact,
   * per row, twenty-two rows.
   *
   * There is no `answer` now. The summary - the name, the rank count, the pips
   * - is what the closed row has to say, and the shape lives once on the group
   * heading that owns it, which is where the previous pass had correctly put
   * it before this one put it back.
   */
  return (
    <li className="mo-in-up" style={{ '--i': Math.min(index, 12) } as React.CSSProperties}>
      <div className="mo-field mo-sheen" style={{ clipPath: CHAMFER, background: PLATE }}>
        <Disclosure
          depth={1}
          accent={spec.color}
          eyebrow={ceiling !== null && ceiling > 0 ? `${ceiling + 1} ranks` : undefined}
          summary={
            <span className="flex min-w-0 flex-wrap items-center gap-3">
              <span
                className="font-[family-name:var(--font-display)] text-[length:var(--text-small)] leading-tight font-semibold"
                style={{ color: spec.color }}
              >
                {spec.name}
              </span>
              {/* Empty pips are the ladder's own shape — how many ranks there
                  are to climb — not a claim that none are held. */}
              {ceiling !== null && ceiling > 0 && (
                <span className="flex shrink-0 items-center" style={{ opacity: 0.8 }}>
                  <RankPips title={0} maxTitle={ceiling} color={spec.color} />
                </span>
              )}
            </span>
          }
        >
          {/* Sentence case, not `.eyebrow`. These are full sentences — "Standing
              is a rank counter here; the spendable currency is Kahl Credits." —
              and the eyebrow style set them in tracked ALL-CAPS at
              `--text-ghost`, which is the wrong voice for prose and below the
              panel's legibility floor. */}
          {spec.note !== undefined && (
            <div className="max-w-[62ch] text-[length:var(--text-micro)] leading-snug" style={{ color: 'var(--text-muted)' }}>
              <Clamp lines={2}>{spec.note}</Clamp>
            </div>
          )}
          {/* In the body, not beside the name: the name sits inside the summary
              button, and a button nested in a button is invalid markup and a
              broken control for a screen reader. */}
          {spec.home !== undefined && (
            <div className="flex items-baseline gap-2">
              <span className="eyebrow">Home</span>
              <HomeLink home={spec.home} />
            </div>
          )}
          {/* No `row`: without an account there is no position on this ladder,
              so nothing is marked "you" and nothing is marked "passed". The
              thresholds themselves are game data and stand on their own. */}
          <RankLadder row={null} ladder={spec.ladder} />
        </Disclosure>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export default function SyndicatesPanel() {
  const inventory = useAccount((s) => s.inventory);
  const inventoryAt = useAccount((s) => s.inventoryAt);

  // The inventory object identity only changes when the underlying bytes change,
  // so keying on it makes this recompute exactly as often as it must — never on
  // a re-render caused by the countdown or a hover.
  const model = useMemo(() => {
    if (!inventory) return null;
    // `RawInventory` is the thin GEP-side view of the same blob `RawAccount`
    // describes in full; the derivation modules take the full shape.
    const acc = inventory as unknown as RawAccount;
    const state = syndicateState(acc);
    const rows = buildRows(state);
    const totals = dailyTotals(state, rows);
    // Only rows with a known ceiling count on either side of the fraction:
    // Nightwave's rank in the numerator against a denominator that leaves it
    // out read 6 of 15 on an account holding four.
    const ranksHeld = rows.reduce((n, r) => n + (r.maxTitle != null ? Math.max(0, r.title ?? 0) : 0), 0);
    const ranksPossible = rows.reduce((n, r) => n + Math.max(0, r.maxTitle ?? 0), 0);
    const laddered = rows.filter((r) => r.maxTitle != null).length;
    return {
      state,
      rows,
      totals,
      ranksHeld,
      ranksPossible,
      laddered,
      rankUpsToday: rows.filter((r) => r.rankUpToday && !r.maxed).length,
      atCeiling: rows.filter((r) => r.atCeiling && !r.maxed).length,
      pledgedName: rows.find((r) => r.pledged)?.name ?? null,
      resetsAtMs: dailyState(acc).resetsAtMs,
    };
  }, [inventory]);

  /*
   * WHICH SYNDICATES — declared HERE, above the no-account early return.
   *
   * A `useState` below that `if` would be a conditional hook: React would see a
   * different number of hooks on the two branches the moment an account
   * arrived, and the state of every hook after it would shift by one. That is
   * not a style point, it is the crash.
   *
   * The list is sorted by gap to the next rank and was otherwise unfilterable.
   * Twenty-two rows, four states already computed for the badges — in reach, at
   * the ceiling, maxed — and no way to ask for one of them.
   */
  const [shown, setShown] = useState<'all' | 'reach' | 'ceiling' | 'maxed'>('all');

  // Without an account there is no standing to rank, so the panel shows the
  // ladder itself: every syndicate, how many ranks it has and where its ceiling
  // sits — all of it game data — with the account column left unmeasured.
  if (!model) {
    return (
      // `overflow-y-auto` is load-bearing: without it the roster overflows a
      // fixed-height flex column and the `mt-auto` footer is painted ON TOP of
      // the last rows instead of after them.
      <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
        <AccountBanner />

        {/*
         * Grouped by ladder SHAPE, not listed flat.
         *
         * Six syndicates share one rank structure, several share another, and a
         * handful are one-offs. Printing that structure per row repeated the
         * same sentence six times and made twenty-two visually identical rows.
         * Grouping states each shape once, as the heading that owns it, and
         * turns the wall into four or five scannable sets — which is also the
         * true structure of the thing being described.
         *
         * Keyed on the shape string itself so the grouping is derived from the
         * data and cannot drift out of step with it.
         */}
        {/*
         * ONE heading, N group captions — not N headings, six of them empty.
         *
         * Rendering each group through `SectionTitle` with a blank title emitted
         * six empty `<h2>` elements: on screen that is an orphaned count digit
         * floating at the left of a full-width rule with the shape stranded at
         * the far right, and to a screen reader it is six unlabelled sections.
         * The groups are subdivisions of one list, so they are captioned as
         * subdivisions.
         */}
        <section>
          <SectionTitle count={ROSTER.length}>The ladder</SectionTitle>
          <LadderLegend />
          <div className="flex flex-col gap-5">
            {groupedRoster().map(([shape, tags]) => (
              <div key={shape}>
                <div className="mb-1.5 flex items-baseline gap-2.5">
                  <span className="eyebrow" style={{ color: 'var(--text-muted)' }}>
                    {shape}
                  </span>
                  <span className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--text-faint)' }}>
                    {tags.length}
                  </span>
                </div>
                <ul className="mo-stagger flex flex-col gap-[3px]">
                  {tags.map((tag, i) => (
                    <CatalogRowItem key={tag} tag={tag} index={i} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2">
          <span className="eyebrow">Thresholds: game export and wiki, cross-checked</span>
          <span className="eyebrow">Daily pools reset 00:00 UTC</span>
        </footer>
      </div>
    );
  }

  const { rows, totals } = model;
  const spent = Math.max(0, totals.cap - totals.remaining);
  // `dailyTotals` sums only the pools that HAVE a mapped counter, so with none
  // mapped every term is zero and the plate printed "0 / 0", a 0%-of-0 bar and
  // "0 spent · 0 pools" — four claims about the player's day manufactured
  // entirely out of our own missing mapping, directly above the line that admits
  // the mapping is missing. Counted is the gate for all of it.
  const counted = totals.pools > 0 && totals.cap > 0;
  const frac = counted ? totals.remaining / totals.cap : 0;

  // `buildRows` already sorts by the gap to the next rank, so the head of that
  // list IS the answer. Promoted out of the list rather than repeated in it.
  const lead = rows.find((r) => r.toNext !== null && !r.maxed) ?? null;
  // The lead is the hero AND a ladder row: a syndicate that vanished from the
  // ladder for being closest read as missing.
  const rest = rows;

  /*
   * The filtered list. Every predicate here is one the panel already computed
   * for its own badges, so a chip and the rows it produces can never disagree —
   * the class of bug where "Wasting 3" is followed by four rows.
   */
  const visible = rest.filter((r) =>
    shown === 'all'
      ? true
      : shown === 'reach'
        ? r.rankUpToday && !r.maxed
        : shown === 'ceiling'
          ? r.atCeiling && !r.maxed
          : r.maxed,
  );

  /*
   * Roster tags the account carries no standing for.
   *
   * `buildRows` only emits a row per syndicate the snapshot mentions, so this is
   * the complement of that against the known roster - never a guess about what
   * the player has joined, just "the payload said nothing about these".
   */
  // A plain derivation, not a memo: this sits after the no-account return, so
  // a hook here would be conditional, and filtering a 22-entry roster is free.
  // Nightwave's account tag carries the season ("RadioLegion7"); the roster
  // holds the bare family, the way `specFor` matches it. Comparing raw tags
  // listed every Nightwave player as not having joined Nightwave.
  const known = new Set(rows.map((r) => family(r.tag)));
  const unjoined = ROSTER.filter((tag) => !known.has(family(tag)));

  return (
    /*
     * ONE SCREEN, AND THE PAGE ITSELF DOES NOT MOVE.
     *
     * THE MEASUREMENT THAT FORCED THIS. This panel was the best-behaved thing
     * in the app on a cold launch - 1.00 screens, nothing to scroll - and the
     * worst in the app the moment an account arrived. Driven through a real
     * browser at 1280x720 with the eight syndicate affiliations of a real
     * capture, it emitted 2,728px into a 629px viewport: 4.34 screens, and the
     * length was a function of how many syndicates the player has standing
     * with, so nothing measured on an empty account could ever have seen it.
     * A flat column of four sibling sections - the lead, the allowance, eight
     * ladder rows at 147px each, fourteen roster rows - has no shape; it just
     * gets longer the more the player has played.
     *
     * The shape is now a fixed-height grid with three rows, and the
     * subordination is structural rather than a promise:
     *
     *   - the ANSWER - which syndicate is closest to a rank, and whether
     *     today's standing covers it - is the first row. It never scrolls
     *     away, because the whole panel exists to say it.
     *   - the second row is two PANES. The ladder, which is as long as the
     *     player's account, scrolls inside the left one. Today's allowance and
     *     the syndicates not joined are reference - things to look up - and
     *     scroll inside the right one. Neither can push the answer off screen.
     *   - the footer is the third row: one line of provenance, always visible.
     *
     * `min-h-0` on every row and column of the chain is what makes that true
     * and is the easy thing to leave out: a grid child's default
     * `min-height: auto` refuses to shrink below its content, so one missing
     * `min-h-0` anywhere and the whole thing grows again, the page scrolls
     * exactly as before, and nothing on screen says anything is wrong.
     *
     * `h-full`, and the panes carry the scrolling. The note this replaces said
     * `min-h-full` was needed because the ladder had no scroll container of
     * its own and would otherwise paint over the footer. It now has one.
     */
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-4 p-5">
      {/* ---- row one: the answer, pinned ------------------------------- */}
      {rows.length === 0 ? (
        <div className="grid place-items-center py-4">
          <EmptyState
            title="No syndicate standing yet"
            detail="Your account has no syndicate standing recorded yet. Every syndicate and its ladder is below; the six originals unlock after Vor's Prize, the open-world ones on first visit."
            className="w-full max-w-[52ch]"
          />
        </div>
      ) : lead !== null ? (
        <Lead row={lead} />
      ) : (
        /* An EMPTY element, not nothing. The three rows are positioned by
           child order, so a branch that renders `false` would slide the panes
           into the header row and the footer into the panes' row - the whole
           layout off by one, silently, only on an account whose every
           syndicate is maxed or unladdered. */
        <div />
      )}

      {/* ---- row two: two panes, each scrolling itself ----------------- */}
      {/*
        The split follows the account: with no standing at all there is no
        ladder to put in the left pane, and a 7fr column of nothing beside the
        roster reads as the panel being broken rather than as the player not
        having joined anything yet.
      */}
      {/*
        THE ROWS ARE DECLARED, NOT LEFT IMPLICIT, AND THAT IS THE WHOLE FIX.
        ————————————————————————————————————————————
        Below `xl` the two panes stack, and a bare `grid` gives stacked children
        IMPLICIT rows, which are auto-sized: each pane would be as tall as its
        content, the container would overflow, and the page would scroll again -
        at every width except the one this was measured at. The overlay is
        composited over a game and is routinely narrower than a browser window,
        so that is the normal case, not the edge one. Two `minmax(0,1fr)` rows
        stacked, one row beside two columns at `xl`.
      */}
      <div
        className={
          rows.length === 0
            ? 'grid min-h-0 grid-rows-[minmax(0,1fr)]'
            : 'grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:grid-rows-[minmax(0,1fr)]'
        }
      >
        {rows.length > 0 && (
          <section className="mo-arrive flex min-h-0 flex-col">
            <SectionTitle count={visible.length} note={lead === null ? 'sorted by gap to next rank' : 'the closest is above'}>
              The ladder
            </SectionTitle>

            {/*
              THE LEGEND AND THE FILTER SHARE A ROW WHEN THERE IS ROOM FOR ONE.
              ————————————————————————————————————————————
              Stacked they were 95px of header above a list that now has about
              200px to live in. Side by side they are 45px. The legend carries a
              floor rather than `min-w-0` so that when there ISN'T room the row
              breaks instead of clamping the sentence to a 164px stub - a
              one-line Clamp in a narrow column shows about four words and a
              "more" button, which is not a legend, it is a rumour of one.
            */}
            <div className="mb-2.5 flex flex-wrap items-start justify-between gap-x-5 gap-y-1">
              <div className="min-w-[18rem] flex-1">
                <LadderLegend />
              </div>
              <Segmented
                label="Which syndicates to show"
                value={shown}
                onChange={setShown}
                options={[
                  { id: 'all', label: 'All', badge: rest.length, hint: 'Every syndicate your account carries standing for' },
                  {
                    id: 'reach',
                    label: 'In reach',
                    badge: model.rankUpsToday,
                    hint: "Today's remaining allowance covers the gap to the next rank",
                  },
                  {
                    id: 'ceiling',
                    label: 'Wasting',
                    badge: model.atCeiling,
                    hint: 'At the rank ceiling — further standing is discarded',
                  },
                  {
                    id: 'maxed',
                    label: 'Maxed',
                    badge: rest.filter((r) => r.maxed).length,
                    hint: 'At the top rank, nothing left to earn',
                  },
                ]}
              />
            </div>

            {/*
              THE LIST SCROLLS, THE PAGE DOES NOT.

              This is the thing whose height is the player's account: eight rows
              here, twenty-two on a finished one, at roughly 150px each. It is
              also the only part of the panel that is legitimately that long,
              which is exactly why it is the part that gets a scroller of its
              own rather than being allowed to lengthen the page.

              `min-h-0` beside `flex-1`: a flex item will not shrink below its
              content without it, so the scroller would be as tall as its rows
              and would scroll nothing at all.
            */}
            {/*
              THE MESSAGE REPLACES THE LIST, IT DOES NOT FOLLOW IT.
              ————————————————————————————————————————————
              An empty list is a fact about the FILTER, not about the account,
              so it says which - silence here would read as "you have no
              syndicates", which is the opposite of true. It used to be rendered
              after the list, which was harmless while the page grew and is not
              now: the scroller is `flex-1`, so an empty one still claims the
              whole pane and the sentence explaining the emptiness was pushed to
              the very bottom of it, a screen's worth of nothing above it.
            */}
            {visible.length === 0 ? (
              <p className="wf-note">
                {shown === 'reach'
                  ? "No syndicate's next rank is inside today's remaining allowance."
                  : shown === 'ceiling'
                    ? 'Nothing is sitting at its rank ceiling — no standing is being discarded.'
                    : 'No syndicate is at its top rank yet.'}
              </p>
            ) : (
              <ul className="mo-stagger flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto pr-1">
                {visible.map((row, i) => (
                  <SyndicateRowItem key={row.tag} row={row} index={i} />
                ))}
              </ul>
            )}
          </section>
        )}

        {/*
          ---------------------------------------------- the reference pane.

          Today's budget and the ladders of every syndicate the player has not
          joined. Both are things to LOOK UP - neither decides anything - and
          both are as long as they are, so they share one scroller. The budget
          is first because it is the one of the two that is about today.
        */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
          {rows.length > 0 && (
          <section className="mo-arrive">
            <SectionTitle note="00:00 UTC">Daily allowance</SectionTitle>

            {/*
              AUTO-FIT, BECAUSE THE PANE IS NOT THE WINDOW.
              ————————————————————————————————————————————
              This was `lg:grid-cols-[1.4fr_1fr_1fr_1fr]`, a VIEWPORT query, and
              the strip now lives in a 5fr pane roughly 412px wide. The viewport
              at which the pane gets narrow is exactly the viewport at which the
              media query says "you are wide" - the two are inverted - so a
              breakpoint here would put four 100px columns in a 412px pane and
              wrap every label onto three lines.

              `auto-fit` over a 13rem floor is measured against the GRID's own
              width, which is the only width that matters: four columns when the
              panes are stacked and the strip has the window, one column when it
              is in the pane. No breakpoint can be wrong because there is none.
            */}
            <div className="grid gap-[3px] [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
              <div className="rf-plate mo-field mo-sheen mo-lift relative px-4 py-3" style={{ clipPath: CHAMFER, background: PLATE }}>
                <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: 'var(--color-orokin-400)' }} />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="eyebrow eyebrow-gold">Standing available today</span>
                  <ResetCountdown at={model.resetsAtMs} />
                </div>

                {/* Dash and the reason, never a number — same shape the per-row
                    "Daily left" column uses when its counter is unmapped. */}
                <div className="mt-2 flex items-baseline gap-2">
                  {counted ? (
                    <>
                      <span className="numeric text-[length:var(--text-title)] leading-none" style={{ color: 'var(--color-orokin-200)' }}>
                        {fmt(totals.remaining)}
                      </span>
                      <span className="numeric text-[length:var(--text-small)]" style={{ color: 'var(--text-muted)' }}>
                        / {fmt(totals.cap)}
                      </span>
                    </>
                  ) : (
                    <span className="numeric text-[length:var(--text-title)] leading-none" style={{ color: 'var(--text-muted)' }}>
                      —
                    </span>
                  )}
                </div>

                {counted && (
                  <div className="mt-3">
                    <Track value={frac} color="var(--color-orokin-400)" />
                  </div>
                )}

                {/*
                  ONE STATEMENT OF ONE FACT.
                  ————————————————————————————————————————————
                  With the review account read, `counted` is false AND four
                  pools are unmapped, so this printed "daily standing for these
                  syndicates is not tracked here yet" and, on the same line,
                  "4 pools not counted — daily standing not tracked here yet".
                  The same sentence, twice, a centimetre apart, above a column
                  of rows each saying it a third time. The second line is the
                  better one - it carries the count and its `title` names the
                  pools - so when nothing is counted it is the only one shown.
                */}
                <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  {counted && (
                    <span className="numeric text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
                      {fmt(spent)} spent · {totals.pools} pool{totals.pools === 1 ? '' : 's'}
                    </span>
                  )}
                  {(!counted || totals.unmapped.length > 0) && (
                    <span
                      className="text-[length:var(--text-micro)]"
                      style={{ color: 'var(--color-signal-warn)' }}
                      title={totals.unmapped.length > 0 ? totals.unmapped.join(', ') : undefined}
                    >
                      {totals.unmapped.length > 0
                        ? `${String(totals.unmapped.length)} pool${totals.unmapped.length === 1 ? '' : 's'} not counted — daily standing not tracked here yet`
                        : 'daily standing for these syndicates is not tracked here yet'}
                    </span>
                  )}
                </div>
              </div>

              {[
                {
                  label: 'Rank-ups in reach',
                  value: model.rankUpsToday,
                  ink: model.rankUpsToday > 0 ? 'var(--color-signal-good)' : 'var(--text-faint)',
                  sub: "today's allowance covers the gap",
                  suffix: null as string | null,
                },
                {
                  label: 'Standing wasted',
                  value: model.atCeiling,
                  ink: model.atCeiling > 0 ? 'var(--color-signal-warn)' : 'var(--text-faint)',
                  sub: 'at the rank ceiling — earnings discarded',
                  suffix: null,
                },
                {
                  label: 'Ranks held',
                  value: model.ranksHeld,
                  ink: 'var(--text)',
                  // The same rows the fraction counts: those with a known ceiling.
                  sub: `across ${model.laddered} syndicate${model.laddered === 1 ? '' : 's'}`,
                  suffix: model.ranksPossible > 0 ? `/${model.ranksPossible}` : null,
                },
              ].map((cell) => (
                <div key={cell.label} className="rf-plate mo-field mo-sheen mo-lift relative px-4 py-3" style={{ clipPath: CHAMFER, background: PLATE }}>
                  <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: cell.ink, opacity: 0.75 }} />
                  <div className="eyebrow">{cell.label}</div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="numeric text-[length:var(--text-title)] leading-none" style={{ color: cell.ink }}>
                      {cell.value}
                    </span>
                    {cell.suffix !== null && (
                      <span className="numeric text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
                        {cell.suffix}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 text-[length:var(--text-micro)] leading-snug" style={{ color: 'var(--text-muted)' }}>
                    {cell.sub}
                  </div>
                </div>
              ))}
            </div>
          </section>
          )}

          {/* ---- the ones you have not joined ------------------------------ */}
          {unjoined.length > 0 && (
            <section>
              <SectionTitle count={unjoined.length} note="ladders are game data — open one to see its ranks">
                Not joined
              </SectionTitle>
              {/*
                Capturing an account used to DELETE these.

                The roster with its rank ladders only rendered on the
                no-account branch, so the moment the game ran once, every
                syndicate the player had not joined vanished - and with it the
                answer to "is Cavia worth starting?". The account view knew
                strictly more and showed strictly less, which is backwards.
              */}
              <ul className="mo-stagger flex flex-col gap-[3px]">
                {unjoined.map((tag, i) => (
                  <CatalogRowItem key={tag} tag={tag} index={i} />
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {/* ---- row three: provenance, one line, never scrolled away -------
              `mt-auto` is gone with the flex column that needed it: this is a
              grid row of its own now, so it is at the bottom by position. */}
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="eyebrow">Thresholds: game export and wiki, cross-checked</span>
        <span className="eyebrow">Daily pools reset 00:00 UTC</span>
        {inventoryAt !== null && (
          <span className="eyebrow ml-auto">Account read {new Date(inventoryAt).toLocaleTimeString()}</span>
        )}
      </footer>
    </div>
  );
}
