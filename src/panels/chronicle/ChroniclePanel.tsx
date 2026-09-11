/**
 * Chronicle — what this account did, in the order it did it.
 *
 * Every other panel here answers a question about the PRESENT: what to run
 * next, what is worth selling, how far through the star chart you are. This one
 * is the only one whose spine is time, and it exists because `data/ledger.ts`
 * finally keeps enough to have a past at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SILENCE IS DRAWN.
 *
 * Every activity feed ever built closes its gaps up: events stack against each
 * other and a fortnight away from the game looks identical to a coffee break.
 * Here a gap is a row — a rule across the column with the length of the absence
 * on it — because this app's whole doctrine is that an absent measurement is not
 * a zero, and a timeline that hides the windows nobody was watching is that
 * doctrine broken in the one place a reader would never think to check it.
 *
 * It costs a row and it is the only structural decision in this file that a
 * competent version of this panel would not have made.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * NESTING. Four rungs, each one an answer to "how do you know that?":
 *
 *   0  a session          47 minutes, 213 changes, and the thing that moved most
 *   1  a series inside it  standing · Cetus            +2,500
 *   2  that series' whole history, with its rate per hour of OBSERVED play
 *   3  one observation     90,000 → 92,500, at a moment
 *
 * The rate at rung 2 is the reason rungs 2 and 3 exist rather than the summary
 * stopping at 1: a number per session is an anecdote, and the panel says so.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { useAccount } from '../../core/store';
import { historyStatus, readLedger } from '../../data/history-store';
import type { LedgerEvent, LedgerKind } from '../../data/ledger';
import {
  headline,
  moments,
  ratePerHour,
  seriesShape,
  timeline,
  topMovers,
  unobserved,
  typicalMovement,
  type Moment,
  type Session,
  type SeriesNet,
  type Timeline,
} from '../../data/ledger-read';
import { humanDuration } from '../../data/worldstate';
import { Disclosure } from '../../ui/Disclosure';
import { ListTail } from '../../ui/ListTail';
import { EmptyState } from '../../ui/orokin';
import { staggerFor } from '../../ui/stagger';

/*
 * A ceiling on what is read into memory at once, not on what is kept. The store
 * is unbounded by design; a panel that walked a year of it on mount would block
 * the first paint. What is NOT shown is reported rather than trimmed silently —
 * see the ListTail under the sessions.
 */
const WINDOW = 4000;

const fmt = (n: number): string => Math.round(n).toLocaleString();
/**
 * A LEVEL keeps its precision. `fmt` rounds, which is right for credits and
 * wrong for a 2.4-second load time — rendering printed that as `2`, and a load
 * time rounded to the second cannot answer the question it was kept for.
 */
/**
 * A figure narrow enough to sit several-to-a-line.
 *
 * Only for the movement strip, where the job is to be COMPARABLE at a glance;
 * every place a reader might act on the number keeps `fmt`, because "164k" is
 * not a quantity you can check against your own screen.
 */
function compact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '+';
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}m`;
  if (a >= 1000) return `${sign}${(a / 1000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return `${sign}${String(Math.round(a))}`;
}

const figure = (n: number): string =>
  Math.abs(n) < 10 && !Number.isInteger(n) ? n.toFixed(2).replace(/\.?0+$/, '') : fmt(n);
/** U+2212, the real minus. A hyphen at figure size reads as a dash. */
const fmtSigned = (n: number): string => (n < 0 ? `−${fmt(Math.abs(n))}` : `+${fmt(n)}`);

function useLedger(): LedgerEvent[] | null {
  const [rows, setRows] = useState<LedgerEvent[] | null>(null);
  useEffect(() => {
    let alive = true;
    void readLedger({ limit: WINDOW })
      .then((r) => {
        if (alive) setRows(r);
      })
      // An unreadable ledger is an EMPTY chronicle, not a broken panel: the
      // store degrades to memory rather than throwing, so this only fires on
      // something stranger, and a blank page beats a stack trace.
      .catch(() => {
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  return rows;
}

// ── naming ───────────────────────────────────────────────────────────────────

const KIND_WORD: Record<LedgerKind, string> = {
  counter: 'account',
  gain: 'gained',
  spend: 'spent',
  session: 'session',
  mission: 'mission',
  squad: 'squad',
  system: 'system',
  arsenal: 'arsenal',
};

/**
 * A series name for a person.
 *
 * The stored name is a machine key — `standing:CetusSyndicate`,
 * `resource:/Lotus/Types/Items/MiscItems/Forma`. Splitting on the first colon
 * gives the family and the entry; an entry that is a `/Lotus/` path keeps only
 * its last segment, and a `PascalCase` tag is broken at its humps. No catalog
 * lookup and no network — this must work with the game closed and the item
 * database unloaded.
 */
function label(name: string): { family: string; entry: string | null } {
  const cut = name.indexOf(':');
  if (cut === -1) return { family: words(name), entry: null };
  const family = words(name.slice(0, cut));
  const rest = name.slice(cut + 1);
  const leaf = rest.includes('/') ? (rest.split('/').pop() ?? rest) : rest;
  return { family, entry: words(leaf) };
}

function words(raw: string): string {
  return raw
    .replace(/[-_]/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
}

function when(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── shared bits ──────────────────────────────────────────────────────────────

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
          {fmt(count)}
        </span>
      )}
      <span aria-hidden className="h-px flex-1" style={{ background: 'var(--rule-hairline)' }} />
      {note !== undefined && <span className="eyebrow">{note}</span>}
    </header>
  );
}

/** A figure and what it is, for the header strip. */
function Figure({ value, of, tone }: { value: ReactNode; of: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="numeric text-[length:var(--text-lead)]" style={{ color: tone ?? 'var(--text)' }}>
        {value}
      </span>
      <span className="eyebrow">{of}</span>
    </div>
  );
}

/**
 * The movement mark — and it has THREE cases, not two.
 *
 * A FLOW moved by an amount: credits, standing, a stack of forma. Signed, and
 * coloured by direction.
 *
 * A LEVEL was read at a value: how long the level took to load, which session
 * state the game entered. It has no delta and never will, and the first version
 * of this printed "no figure" over `load seconds 2.4` — a reading, rendered as
 * an absence. That is the same confusion between "unmeasured" and "no
 * magnitude" the ranking gets right and the display got wrong.
 *
 * Only the third case — no delta AND no value — is genuinely nothing to show.
 */
function Delta({ by, level }: { by: number | null; level?: number | string | null }) {
  if (by !== null) {
    return (
      <span className="numeric" style={{ color: by < 0 ? 'var(--color-signal-bad)' : 'var(--color-tenno-400)' }}>
        {fmtSigned(by)}
      </span>
    );
  }
  if (level !== null && level !== undefined) {
    return (
      <span className="numeric" style={{ color: 'var(--text-muted)' }}>
        {typeof level === 'number' ? figure(level) : level}
      </span>
    );
  }
  return <span className="eyebrow">no figure</span>;
}

/**
 * The shape of one series, computed from its own observations.
 *
 * BROKEN WHERE NOBODY WAS WATCHING. Every sparkline joins its samples with a
 * straight line, and across a two-day absence that line is a claim the data
 * cannot support: it says the value moved smoothly from here to there while the
 * app was closed. Here the path stops at the last real observation and starts
 * again at the next one, so a gap looks like a gap.
 *
 * Hand-rolled SVG, like `ui/MarketDepth.tsx` before it — a charting library
 * would draw the honest version as a special case, if at all, and this is the
 * whole reason the picture is worth drawing.
 */
const SPARK_W = 132;
const SPARK_H = 26;
/** The visible width of a break. Fixed, so it reads as a mark and not a duration. */
const SPARK_GAP = 7;
/** A stretch narrower than this cannot show a line at all. */
const SPARK_MIN = 5;

function Spark({ name, all, breakMinutes }: { name: string; all: readonly LedgerEvent[]; breakMinutes: number }) {
  const shape = useMemo(() => seriesShape(all, name, breakMinutes), [all, name, breakMinutes]);
  const { segments, min, max } = shape;
  if (segments.length === 0) return null;

  /*
   * A BROKEN AXIS, and the breaks are the reason it exists.
   *
   * Plotted against real time this was honest and unreadable: three sittings
   * across six days put every observation inside 2% of the width and left the
   * rest empty. The usual fix is to plot against sample INDEX, which makes a
   * beautiful line and quietly asserts the samples are evenly spaced - it draws
   * a two-day absence as one smooth step, which is the exact claim this whole
   * store exists to refuse.
   *
   * So each stretch of watching gets width in proportion to ITS OWN duration,
   * and every gap between them gets the same fixed notch regardless of length.
   * Inside a stretch the spacing is true; between them it is deliberately not,
   * and the notch says so. The label carries how long the gaps actually were.
   */
  const spans = segments.map((seg) => Math.max(1, (seg[seg.length - 1]?.at ?? 0) - (seg[0]?.at ?? 0)));
  const totalSpan = spans.reduce((n, v) => n + v, 0);
  const gaps = SPARK_GAP * (segments.length - 1);
  const usable = Math.max(SPARK_MIN * segments.length, SPARK_W - gaps);

  const lefts: number[] = [];
  const widths: number[] = [];
  let cursor = 0;
  for (const span of spans) {
    const w = Math.max(SPARK_MIN, (span / totalSpan) * usable);
    lefts.push(cursor);
    widths.push(w);
    cursor += w + SPARK_GAP;
  }
  const drawn = cursor - SPARK_GAP;

  const spanV = max - min;
  // A flat series centres rather than pinning to the top edge: "this did not
  // move" and "this is at its maximum" must not look the same.
  const y = (v: number) => (spanV === 0 ? SPARK_H / 2 : SPARK_H - 3 - ((v - min) / spanV) * (SPARK_H - 6));

  const flat = segments.flat();
  const last = flat[flat.length - 1]!;
  const rising = flat.length > 1 && last.value >= flat[0]!.value;
  const ink = rising ? 'var(--color-tenno-400)' : 'var(--color-signal-bad)';

  return (
    <svg
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${String(Math.max(SPARK_W, drawn))} ${String(SPARK_H)}`}
      role="img"
      aria-label={`${String(segments.length)} stretch${segments.length === 1 ? '' : 'es'} of watching, ${
        rising ? 'rising' : 'falling'
      } overall; the breaks between them are not to scale`}
      className="shrink-0 overflow-visible"
    >
      {segments.map((seg, i) => {
        const left = lefts[i] ?? 0;
        const w = widths[i] ?? SPARK_MIN;
        const t0 = seg[0]?.at ?? 0;
        const span = spans[i] ?? 1;
        const x = (at: number) => left + ((at - t0) / span) * w;
        return (
          // Keyed by the stretch's own first observation, not by index: the
          // number of stretches changes as the ledger grows, and an index key
          // makes React reuse the wrong stretch's node when it does.
          <g key={seg[0]?.at ?? i}>
            {seg.length === 1 ? (
              // One observation is a point, not a line. Drawing a line through
              // it would invent a direction nothing measured.
              <circle cx={left + w / 2} cy={y(seg[0]!.value)} r={1.5} fill={ink} />
            ) : (
              <path
                d={seg.map((p, j) => `${j === 0 ? 'M' : 'L'}${x(p.at).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ')}
                fill="none"
                stroke={ink}
                strokeWidth={1.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {/* The break itself, drawn: a hairline the line does not cross. */}
            {i < segments.length - 1 && (
              <line
                x1={left + w + SPARK_GAP / 2}
                x2={left + w + SPARK_GAP / 2}
                y1={2}
                y2={SPARK_H - 2}
                stroke="var(--hairline)"
                strokeWidth={1}
              />
            )}
          </g>
        );
      })}
      <circle cx={drawn} cy={y(last.value)} r={2} fill={ink} />
    </svg>
  );
}

const MOMENT_KIND_WORD: Record<string, string> = {
  mission: 'a run',
  tribute: 'the daily tribute',
  foundry: 'the foundry',
  purchase: 'a purchase',
  market: 'the market',
  syndicate: 'a syndicate',
  helminth: 'the Helminth',
  arsenal: 'the arsenal',
  unknown: 'unidentified',
};

/**
 * RUNG 5 — everything else that moved in the same moment.
 *
 * This is the rung the whole chain was built to reach. `credits +5,188` is a
 * number; `credits +5,188 alongside +2,200 standing, +11,000 focus, one forma
 * spent and a mission that ended` is a Cetus bounty, and the reader knew that
 * the instant they saw the list. The ledger cannot label an act - the account is
 * a bag of numbers and the game never narrates - but what moved together was
 * caused together, and that is enough.
 *
 * The series the reader arrived from is marked rather than removed: seeing where
 * it sits among the rest is the point, and dropping it would leave them
 * comparing a list against a number they can no longer see.
 */
function MomentBody({ moment, focus }: { moment: Moment; focus: string }) {
  const rows = [...moment.events].sort((a, b) => Math.abs(b.by ?? 0) - Math.abs(a.by ?? 0));
  return (
    <>
      <p className="wf-prose">{moment.summary}</p>
      {/*
        * DELIBERATELY NOT STAGGERED. Everything in this list happened at the
        * same instant - that is the entire claim the rung makes - and rows
        * arriving one after another would say they happened in sequence. The
        * cheapest polish available here is also the one lie the panel must not
        * tell, so this list arrives all at once.
        */}
      <div className="mt-2 flex flex-col gap-0.5">
        {rows.map((e) => {
          const { family, entry } = label(e.name);
          const isFocus = e.name === focus;
          return (
            <div
              // Time plus series, never the index: `seq` is absent on rows the
              // store had to hold in memory, and a moment's rows differ by name.
              key={`${String(e.at)}-${e.name}`}
              className="flex items-baseline justify-between gap-4 py-0.5"
              style={{ color: isFocus ? 'var(--text)' : 'var(--text-muted)' }}
            >
              <span className="text-[length:var(--text-micro)]">
                {isFocus && (
                  <span aria-hidden style={{ color: 'var(--color-orokin-400)' }}>
                    {'\u203a '}
                  </span>
                )}
                {/*
                  * The family goes FIRST and quiet, with a separator. Trailing
                  * it read as part of the name: `words()` upper-cases an entry
                  * like AP_POWER, the eyebrow is upper-case too, and "AP POWER
                  * FOCUS" merged into one label at a glance.
                  */}
                {entry !== null && (
                  <span style={{ color: 'var(--text-faint)' }}>
                    {family}
                    <span aria-hidden>{' · '}</span>
                  </span>
                )}
                {entry ?? family}
              </span>
              <Delta by={e.by} level={e.to} />
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── rung 3: one observation ──────────────────────────────────────────────────

function Observation({ event }: { event: LedgerEvent }) {
  const balances = event.from !== null || event.to !== null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="numeric text-[length:var(--text-micro)]" style={{ color: 'var(--text-faint)' }}>
        {clock(event.at)}
      </span>
      {balances ? (
        <span className="numeric text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
          {typeof event.from === 'number' ? fmt(event.from) : (event.from ?? '—')}
          <span aria-hidden style={{ color: 'var(--text-faint)' }}>
            {' → '}
          </span>
          {typeof event.to === 'number' ? fmt(event.to) : (event.to ?? '—')}
        </span>
      ) : (
        <Delta by={event.by} />
      )}
    </div>
  );
}

// ── rung 2: the whole history of one series ──────────────────────────────────

function SeriesHistory({ name, all, tl }: { name: string; all: readonly LedgerEvent[]; tl: Timeline }) {
  const rows = useMemo(
    () => all.filter((e) => e.name === name).sort((a, b) => b.at - a.at),
    [all, name],
  );
  const rate = useMemo(() => ratePerHour(name, tl), [name, tl]);
  /*
   * Every event indexed by the moment it belongs to, computed once for the whole
   * series rather than per row - clustering the entire ledger inside a map over
   * forty rows would be forty passes over everything.
   */
  const byMoment = useMemo(() => {
    const index = new Map<number, Moment>();
    for (const m of moments(all)) {
      for (const e of m.events) index.set(e.seq ?? e.at, m);
    }
    return index;
  }, [all]);
  const shown = rows.slice(0, 40);

  return (
    <Disclosure
      depth={2}
      eyebrow="across every session"
      summary={<span className="rf-fold-ink mo-underline">How this has moved since the record began</span>}
      answer={
        <span className="numeric">
          {rate?.perHour == null ? 'no rate' : `${fmtSigned(Math.round(rate.perHour))} / h`}
        </span>
      }
    >
      <div className="mb-2 flex items-center gap-3">
        <Spark name={name} all={all} breakMinutes={tl.break.minutes} />
        <span className="eyebrow">
          {seriesShape(all, name, tl.break.minutes).segments.length} separate stretches of watching
        </span>
      </div>
      <p className="wf-note">
        {rate === null
          ? 'This has been observed changing, but never inside a session long enough to divide by.'
          : /*
             * The denominator is the point. Dividing by the calendar would
             * report a rate a hundred times too low for anyone who plays in
             * bursts, and would look every bit as measured.
             */
            `${fmtSigned(rate.by)} across ${fmt(rate.sessions)} ${rate.sessions === 1 ? 'session' : 'sessions'} and ${humanDuration(rate.minutes * 60_000)} of observed play. Time the app was not running is not in that figure.`}
      </p>
      {rate !== null && rate.sessions === 1 && (
        <p className="wf-note">One session is an anecdote. The rate will move as more are recorded.</p>
      )}

      <div className="mt-2 flex flex-col">
        {shown.map((e) => {
          const moment = byMoment.get(e.seq ?? e.at) ?? null;
          return (
            <Disclosure
              key={`${String(e.seq ?? e.at)}-${e.name}`}
              depth={3}
              eyebrow={when(e.at)}
              /*
               * The summary names WHAT WAS HAPPENING rather than repeating the
               * kind. Every row here said `account` before, on every row, which
               * is a label that distinguishes nothing from anything.
               */
              summary={
                <span className="rf-fold-ink mo-underline">
                  {moment ? MOMENT_KIND_WORD[moment.kind] : KIND_WORD[e.kind]}
                </span>
              }
              answer={<Delta by={e.by} level={e.to} />}
            >
              <Observation event={e} />
              {moment !== null && moment.events.length > 1 && (
                <Disclosure
                  depth={4}
                  eyebrow={`${fmt(moment.events.length - 1)} other ${moment.events.length === 2 ? 'change' : 'changes'}`}
                  summary={<span className="rf-fold-ink mo-underline">What else moved at that moment</span>}
                  answer={<span className="numeric">{MOMENT_KIND_WORD[moment.kind]}</span>}
                >
                  <MomentBody moment={moment} focus={name} />
                </Disclosure>
              )}
            </Disclosure>
          );
        })}
      </div>
      <ListTail
        hidden={rows.length - shown.length}
        noun=" observations of this"
        ordered="the most recent are kept"
        reach="the whole series is in an export"
      />
    </Disclosure>
  );
}

// ── rung 1: one series inside one session ────────────────────────────────────

function SeriesRow({ row, all, tl }: { row: SeriesNet; all: readonly LedgerEvent[]; tl: Timeline }) {
  const { family, entry } = label(row.name);
  return (
    <Disclosure
      depth={1}
      /*
       * A series with no entry — `credits`, `platinum` — has nothing to put in
       * the eyebrow except its own name, and "CREDITS / credits" reads as a
       * rendering bug. The kind is the category in that case, which is what an
       * eyebrow is for.
       */
      eyebrow={entry === null ? KIND_WORD[row.kind] : family}
      summary={<span className="rf-fold-ink mo-underline">{entry ?? family}</span>}
      answer={<Delta by={row.by} level={row.to} />}
    >
      <p className="wf-note">
        {fmt(row.events)} {row.events === 1 ? 'observation' : 'observations'} in this session
        {row.from !== null && row.to !== null && typeof row.from === 'number' && typeof row.to === 'number'
          ? `, ${fmt(row.from)} to ${fmt(row.to)}.`
          : '.'}
      </p>
      <SeriesHistory name={row.name} all={all} tl={tl} />
    </Disclosure>
  );
}

/**
 * The biggest few movements, on one line, at rest.
 *
 * The first version of this panel put everything behind a disclosure, which
 * fixed "the information is too everywhere" by creating "there is not enough
 * information": a closed session read as a date and a change count, and told
 * you nothing about what you had actually done. A summary row that summarises
 * nothing is a table of contents.
 *
 * Three, because four does not fit at the narrowest column width the shell
 * allows and a strip that wraps stops being a strip.
 */
const STRIP = 3;

function MovementStrip({ net }: { net: readonly SeriesNet[] }) {
  const rows = net.filter((r) => r.by !== null && r.by !== 0).slice(0, STRIP);
  if (rows.length === 0) return null;
  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      {rows.map((r) => {
        const { family, entry } = label(r.name);
        return (
          <span key={r.name} className="text-[length:var(--text-nano)]" style={{ color: 'var(--text-faint)' }}>
            {entry ?? family}{' '}
            <span className="numeric" style={{ color: (r.by ?? 0) < 0 ? 'var(--color-signal-bad)' : 'var(--text-muted)' }}>
              {compact(r.by ?? 0)}
            </span>
          </span>
        );
      })}
    </span>
  );
}

// ── rung 0: a session ────────────────────────────────────────────────────────

const SERIES_SHOWN = 12;

function SessionRow({
  session,
  all,
  tl,
  typical,
  lead,
}: {
  session: Session;
  all: readonly LedgerEvent[];
  tl: Timeline;
  typical: ReadonlyMap<string, number>;
  lead: boolean;
}) {
  const head = headline(session, typical);
  const shown = session.net.slice(0, SERIES_SHOWN);
  const headLabel = head ? label(head.row.name) : null;

  return (
    <Disclosure
      depth={0}
      defaultOpen={lead}
      eyebrow={when(session.from)}
      summary={
        <span className="rf-fold-ink flex flex-col gap-1">
          <span>
            {session.minutes < 1 ? 'A moment' : humanDuration(session.minutes * 60_000)}
            <span style={{ color: 'var(--text-faint)' }}>
              {' · '}
              {fmt(session.count)} changes across {fmt(session.net.length)}{' '}
              {session.net.length === 1 ? 'thing' : 'things'}
            </span>
          </span>
          <MovementStrip net={session.net} />
        </span>
      }
      /*
       * ONLY when it says something the strip does not. A fallback headline is
       * by definition the largest movement, which the strip already leads with
       * — printing it again on the right of the same row is the same fact
       * twice, and it made the two cases indistinguishable at a glance. Now the
       * chip's presence IS the signal that something was unusual.
       */
      answer={
        headLabel && head && head.why === 'unusual' ? (
          <span className="numeric line-clamp-1 max-w-[36ch]">
            {headLabel.entry ?? headLabel.family} <Delta by={head.row.by} />
          </span>
        ) : undefined
      }
    >
      {head !== null && (
        <p className="wf-note">
          {/*
            * Three different claims, said apart. A row that headlines the
            * largest number and a row that headlines a genuine outlier look
            * identical, and the reader cannot tell which they are being shown.
            */}
          {head.why === 'unusual' && head.times !== null
            ? `Headlined because ${headLabel?.entry ?? headLabel?.family ?? 'this'} moved ${head.times.toFixed(1)}× its own typical session — not because it is the largest number here.`
            : head.why === 'no-history'
              ? 'Headlined by the largest movement. There are not yet enough sessions to know what is usual for any of these.'
              : 'Nothing moved unusually for itself this session, so this is simply the largest movement.'}
        </p>
      )}
      <div className="flex flex-col">
        {shown.map((row) => (
          <SeriesRow key={row.name} row={row} all={all} tl={tl} />
        ))}
      </div>
      <ListTail
        hidden={session.net.length - shown.length}
        noun=" things moved in this session"
        ordered="the largest movements are kept"
        reach="a smaller movement is still in its own series above"
      />
    </Disclosure>
  );
}

/**
 * The gap between two sessions, drawn AT ITS LENGTH.
 *
 * The first version of this was a caption — a hairline and the words "2d 1h
 * unwatched" — and rendering it proved the point against itself: a two-hour
 * break and a four-day one were the same six millimetres of screen, so the
 * panel asserted in text exactly what its layout denied. A gap you have to read
 * is not drawn.
 *
 * So the row's HEIGHT is the measurement. Logarithmically, because the range is
 * minutes to weeks and a linear scale would make every short gap invisible to
 * buy resolution between "four days" and "five days" that nobody wants; the
 * consequence, stated because a log axis always has one, is that a fortnight
 * does not look seven times a two-day gap. It looks bigger, and it is bigger,
 * and the label carries the number for anyone who needs it exactly.
 *
 * Not a `Disclosure`: there is nothing underneath it, and a chevron promising
 * something that is not there is worse than the gap being unremarkable.
 */
const QUIET_MIN = 26;
const QUIET_MAX = 150;
/** Beyond this the ticks stop being countable and the label carries it. */
const MAX_TICKS = 7;

function SilenceRow({ minutes }: { minutes: number }) {
  /*
   * The height is computed from the data and handed to the element as an
   * inline measurement rather than picked from a set of classes: this row's
   * appearance differs per value, which is the whole difference between drawing
   * a measurement and captioning one.
   */
  const height = Math.round(
    Math.min(QUIET_MAX, Math.max(QUIET_MIN, QUIET_MIN + 26 * Math.log10(Math.max(1, minutes)))),
  );
  /*
   * A TICK PER MIDNIGHT CROSSED, so the gap can be counted rather than only
   * read. A dashed rule would have said "time passed"; this says how much, in a
   * unit a player thinks in — and it is the reason the void is worth its height
   * instead of being collapsed to a caption.
   *
   * Above MAX_TICKS they stop being countable at a glance, so the row shows
   * that many and the label carries the exact figure. A tick fence claiming to
   * be countable when it is not would be worse than no fence.
   */
  const days = Math.floor(minutes / (60 * 24));
  const ticks = Math.min(days, MAX_TICKS);

  return (
    <div
      className="relative flex items-center pl-[7px]"
      style={{ height: `${String(height)}px` }}
      title={`${humanDuration(minutes * 60_000)} with the app closed`}
    >
      {/* The spine continues through the gap: the time passed, the record did not. */}
      <span
        aria-hidden
        className="absolute top-0 bottom-0 left-[7px] w-px"
        style={{ background: 'linear-gradient(180deg, transparent, var(--hairline) 18%, var(--hairline) 82%, transparent)' }}
      />
      {Array.from({ length: ticks }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute left-[4px] h-px w-[7px]"
          style={{
            // Evenly spread inside the void's own height, so the fence reads as
            // a scale of THIS gap rather than as decoration at a fixed pitch.
            top: `${String(Math.round(((i + 1) / (ticks + 1)) * 100))}%`,
            background: 'var(--text-faint)',
          }}
        />
      ))}
      <span className="eyebrow ml-4" style={{ color: 'var(--text-faint)' }}>
        {humanDuration(minutes * 60_000)} unwatched
        {days > MAX_TICKS ? ` · ${fmt(days)} days` : ''}
      </span>
    </div>
  );
}

/**
 * The header, as its own component.
 *
 * Extracted because the panel function carried every branch in this block on
 * top of its own loading and empty states, which is a lot of control flow for
 * something whose job is to pick between three screens. Nothing here needs the
 * session list, so it does not have to live beside it.
 */
function RecordHeader({
  tl,
  count,
  username,
  status,
}: {
  tl: Timeline;
  count: number;
  username: string | null;
  status: { durable: boolean; reason: string | null; pendingLedger: number };
}) {
  const spanMinutes = ((tl.to ?? 0) - (tl.from ?? 0)) / 60_000;
  // Guarded: a record of one moment has no span, and 0/0 would print NaN%.
  const watchedShare = spanMinutes > 0 ? tl.observedMinutes / spanMinutes : 1;

  return (
<section className="anim-rise">
    <SectionTitle note={username ?? 'no account named yet'}>What the record holds</SectionTitle>

    {/*
      * THE TWO-SECOND READ IS THE RATIO, so it is the only thing set large.
      * The first version put four equal figures in a row and the eye landed
      * on "162 changes recorded", which is the least interesting number on
      * the page - a count of rows in a table. What the record actually says
      * about this account is how little of its life the app has seen.
      */}
    {/*
      * A RECORD OF ONE MOMENT HAS NO SPAN, and this sentence read
      * "now watched, out of now" - `humanDuration(0)` is the word "now",
      * and two of them in one line is not a measurement, it is a rendering
      * accident. Every panel gets this state on its very first push, which
      * is the one moment a reader is deciding whether to trust it.
      */}
    {spanMinutes < 1 ? (
      <p className="wf-prose">
        Everything on record so far happened in one moment. There is no stretch of time to measure against yet —
        the ratio appears once this account has been seen on two separate occasions.
      </p>
    ) : (
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="stat numeric" style={{ color: 'var(--text)' }}>
          {humanDuration(tl.observedMinutes * 60_000)}
        </span>
        <span className="wf-prose" style={{ maxWidth: 'none' }}>
          watched, out of
        </span>
        <span className="stat numeric" style={{ color: 'var(--text-muted)' }}>
          {humanDuration(spanMinutes * 60_000)}
        </span>
        <span className="wf-prose" style={{ maxWidth: 'none' }}>
          since the record began.
        </span>
      </div>
    )}

    {/*
      * The same ratio as a length. Two spans, no chart library, and it is
      * the one place on this panel where a proportion is shown rather than
      * stated - which is what makes the sentence above it land instead of
      * having to be arithmetic-ed by the reader.
      */}
    <div className="mt-3 flex h-[5px] w-full max-w-[38ch] overflow-hidden" aria-hidden hidden={spanMinutes < 1}>
      <span
        /*
         * A floor of 1.4%, because the honest value here is often about
         * two - and at two percent of a wide bar the lit segment reads as a
         * rendering artefact rather than as a quantity. The floor keeps it
         * legible as a deliberate mark; the figures above it are what
         * anyone reading the number exactly should use.
         */
        style={{
          width: `${String(Math.max(1.4, watchedShare * 100))}%`,
          background: 'var(--color-tenno-400)',
        }}
      />
      <span className="flex-1" style={{ background: 'var(--hairline)' }} />
    </div>

    <div className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
      <Figure value={fmt(count)} of="changes recorded" />
      <Figure value={fmt(tl.sessions.length)} of={tl.sessions.length === 1 ? 'session' : 'sessions'} />
      {/* Omitted rather than shown as "now": one session has no between. */}
      {tl.silences.length > 0 && (
        <Figure
          value={humanDuration(tl.silences.reduce((n, s) => n + s.minutes, 0) * 60_000)}
          of="unwatched between sessions"
          tone="var(--text-muted)"
        />
      )}
    </div>

    {/*
      * The methodology is nested rather than stacked. It is the answer to
      * "how do you know where one session ends?", which is a question the
      * reader has only after reading the sessions - so it waits there
      * instead of sitting between them and the headline as two paragraphs
      * of grey.
      */}
    <div className="mt-4">
      <Disclosure
        depth={0}
        eyebrow="how the record is read"
        summary={<span className="rf-fold-ink mo-underline">What counts as one session, and what is not known</span>}
        answer={<span className="numeric">{tl.break.measured ? 'measured' : 'assumed'}</span>}
      >
        <p className="wf-prose">{tl.break.note}</p>
        <p className="wf-prose">
          {tl.break.measured
            ? 'Anything closer together than that is one sitting. The threshold is read out of your own gaps rather than chosen, so it follows how you actually play.'
            : 'Sessions below are split on that assumption rather than on a measurement. It will become measured once there are enough gaps to find a cliff in.'}
        </p>
        <p className="wf-prose">
          Nothing is known from before {when(tl.from ?? 0)}. The record begins where the app started watching, and a
          series missing from a session was not observed changing — which is a different fact from it having stayed
          still.
        </p>
        {!status.durable && (
          <p className="wf-prose" style={{ color: 'var(--color-signal-bad)' }}>
            Storage refused a write ({status.reason ?? 'unknown'}), so {fmt(status.pendingLedger)} of these are held
            in memory only and will not survive a restart.
          </p>
        )}
      </Disclosure>
    </div>
    </section>
  );
}

/**
 * One series, at whichever depth it sits.
 *
 * Rendered at depth 1 inside a family, and at depth 0 when its family holds only
 * it — so a lone series is one click from its history rather than two, and the
 * two paths cannot drift apart into different rows for the same thing.
 */
function SeriesLine({
  row,
  all,
  tl,
  depth,
}: {
  row: SeriesNet;
  all: readonly LedgerEvent[];
  tl: Timeline;
  depth: number;
}) {
  const { entry, family } = label(row.name);
  const rate = ratePerHour(row.name, tl);
  return (
    <Disclosure
      depth={depth}
      eyebrow={`${fmt(row.events)} seen`}
      summary={<span className="rf-fold-ink mo-underline">{entry ?? family}</span>}
      answer={
        <span className="flex items-center gap-3">
          <Spark name={row.name} all={all} breakMinutes={tl.break.minutes} />
          <span className="numeric">
            {row.by === null ? (
              <Delta by={null} level={row.to} />
            ) : (
              <>
                {fmtSigned(row.by)}
                {rate?.perHour != null && (
                  <span style={{ color: 'var(--text-faint)' }}>
                    {' \u00b7 '}
                    {compact(rate.perHour)}/h
                  </span>
                )}
              </>
            )}
          </span>
        </span>
      }
    >
      <SeriesHistory name={row.name} all={all} tl={tl} />
    </Disclosure>
  );
}

/**
 * Everything this account has ever been seen to move, grouped by family.
 *
 * The session list answers "what did I do then". This answers "what does this
 * account actually accumulate", which is a different question and the one a
 * player asks after the third session — and it needs no clicking to begin
 * reading, which the session list did.
 *
 * ORDERED BY OBSERVATIONS, deliberately, and NOT by magnitude. Magnitude is not
 * comparable across families — credits move in millions and slots in ones — so
 * sorting by it produces a leaderboard of unit sizes. How OFTEN a thing was
 * seen to change is comparable, and it is also the honest answer to "what does
 * this record actually know a lot about".
 */
function SeriesLedger({ all, tl }: { all: readonly LedgerEvent[]; tl: Timeline }) {
  const families = useMemo(() => {
    const rows = topMovers(all);
    const byFamily = new Map<string, SeriesNet[]>();
    for (const row of rows) {
      const key = label(row.name).family;
      const list = byFamily.get(key);
      if (list) list.push(row);
      else byFamily.set(key, [row]);
    }
    return [...byFamily.entries()]
      .map(([family, series]) => ({
        family,
        series: series.slice().sort((a, b) => b.events - a.events),
        events: series.reduce((n, r) => n + r.events, 0),
      }))
      .sort((a, b) => b.events - a.events);
  }, [all]);

  if (families.length === 0) return null;

  return (
    <>
      {families.map((f, i) =>
        /*
         * ONE GROUP IS NOT A GROUPING. A family holding a single series wraps
         * that series in a header that repeats its own name and an
         * observation count it already carries - two rungs to reach one row.
         * The house rule elsewhere in this app is to render the row directly,
         * and it is the difference between nesting that earns its click and
         * nesting for its own sake.
         */
        f.series.length === 1 && f.series[0] ? (
          <SeriesLine key={f.family} row={f.series[0]} all={all} tl={tl} depth={0} />
        ) : (
        <Disclosure
          key={f.family}
          depth={0}
          // The first group opens, so the section is never a wall of closed
          // rows with nothing readable in it.
          defaultOpen={i === 0}
          eyebrow={`${fmt(f.series.length)} ${f.series.length === 1 ? 'series' : 'series'}`}
          summary={<span className="rf-fold-ink mo-underline">{f.family}</span>}
          answer={
            <span className="numeric">
              {fmt(f.events)} {f.events === 1 ? 'observation' : 'observations'}
            </span>
          }
        >
          {f.series.slice(0, 24).map((row) => (
            <SeriesLine key={row.name} row={row} all={all} tl={tl} depth={1} />
          ))}
          <ListTail
            hidden={f.series.length - Math.min(f.series.length, 24)}
            noun={` more in ${f.family}`}
            ordered="the most-observed are kept"
            reach="a rarer one appears in the session it moved in"
          />
        </Disclosure>
        ),
      )}
    </>
  );
}

// ── the panel ────────────────────────────────────────────────────────────────

const SESSIONS_SHOWN = 30;

export default function ChroniclePanel() {
  const username = useAccount((s) => s.username);
  const events = useLedger();

  const tl = useMemo(() => timeline(events ?? []), [events]);
  const status = historyStatus();

  if (events === null) {
    return (
      <div className="grid h-full place-items-center p-8">
        <EmptyState className="w-full max-w-[46ch]" title="Reading the record" detail="Opening the account ledger." />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="grid h-full place-items-center p-8">
        <EmptyState
          className="w-full max-w-[54ch]"
          title="Nothing recorded yet"
          detail={
            <>
              The ledger writes a row when something about this account CHANGES — credits, standing, focus, a slot
              spent, an item consumed, a mission bracket opening or closing. It has not seen a change yet, which is
              not the same as nothing having happened: it only watches while RaijiFrame is running alongside the
              game.
            </>
          }
        />
      </div>
    );
  }

  const typical = typicalMovement(tl);
  const unseen = unobserved(events);
  const sessions = tl.sessions.slice().reverse();
  const shown = sessions.slice(0, SESSIONS_SHOWN);
  /*
   * Silences are indexed against the ORIGINAL chronological order, and this
   * list is newest-first. The silence that belongs above a session is the one
   * that ended when it began — matched by timestamp rather than by index, so
   * reversing cannot quietly pair a gap with the wrong side of itself.
   */
  const silenceBefore = new Map(tl.silences.map((s) => [s.to, s.minutes]));

  return (
    <div className="flex min-h-full flex-col gap-6 p-6">
      <RecordHeader tl={tl} count={events.length} username={username} status={status} />

      <section className="mo-arrive">
        <SectionTitle count={tl.sessions.length}>Sessions, newest first</SectionTitle>
        {/*
          * THE ONE STAGGER IN THIS PANEL, and it is on the session list because
          * that list is chronological: rows arriving in order is the order the
          * sittings happened in. Computed by `staggerFor`, so a long history
          * does not take proportionally longer to appear.
          *
          * It is transform-only, which is not a style choice here - an entrance
          * that fades or collapses would strand the whole timeline on the
          * in-game overlay, where the document timeline never advances.
          */}
        <div className="rf-staged flex flex-col" style={staggerFor(shown.length)}>
          {shown.map((s, i) => {
            const quiet = silenceBefore.get(s.from);
            return (
              <div key={s.from}>
                {quiet !== undefined && <SilenceRow minutes={quiet} />}
                <SessionRow session={s} all={events} tl={tl} typical={typical} lead={i === 0} />
              </div>
            );
          })}
        </div>
        {/*
          * THE BOTTOM EDGE. Without it the oldest session sits flush against
          * the end of the list and reads as the beginning of the account's
          * history, when it is only the beginning of the RECORD. Every other
          * boundary on this timeline is drawn; leaving this one implied would
          * make the one gap the reader most easily misreads the only invisible
          * one.
          */}
        {sessions.length === shown.length && (
          <div className="flex items-center gap-3 pt-3 pl-1">
            <span aria-hidden className="h-px w-3 shrink-0" style={{ background: 'var(--hairline)' }} />
            <span className="eyebrow shrink-0" style={{ color: 'var(--text-faint)' }}>
              the record begins here
            </span>
            <span aria-hidden className="h-px flex-1" style={{ background: 'var(--rule-hairline)' }} />
          </div>
        )}
        <ListTail
          hidden={sessions.length - shown.length}
          noun=" earlier sessions"
          ordered="the most recent are kept"
          reach="every one of them is in an export"
        />
      </section>

      <section className="mo-arrive">
        <SectionTitle note="ordered by how often each was seen to change">
          Everything this account moves
        </SectionTitle>
        <SeriesLedger all={events} tl={tl} />
      </section>

      <section className="mo-arrive">
        <SectionTitle count={unseen.names.length}>Not seen for this account</SectionTitle>
        <p className="wf-prose">
          The record follows {fmt(unseen.total)} kinds of thing and has observed {fmt(unseen.seen)} of them change on
          this account. The rest are listed below, and the only thing that means is <em>not seen</em> — an account with
          no lich and an account whose lich has not moved while RaijiFrame was open look identical from here, and so
          does one that changed while the app was closed.
        </p>
        <p className="wf-note">
          This is why the list exists rather than a row of zeroes. A zero is a claim about your account; this is a
          statement about the record.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {unseen.names.slice(0, 48).map((n) => (
            <span key={n} className="eyebrow" style={{ color: 'var(--text-faint)' }}>
              {label(n).family}
            </span>
          ))}
        </div>
        <ListTail
          hidden={unseen.names.length - Math.min(unseen.names.length, 48)}
          noun=" more kinds of thing"
          ordered="listed alphabetically"
          reach="each one starts recording the first time it moves"
        />
      </section>

      {/*
        * The whole section is conditional, not just its sentence. A heading
        * over nothing is a promise the page does not keep, and this one would
        * have been on screen for every account small enough not to need it.
        */}
      {events.length >= WINDOW && (
        <section className="mo-arrive">
          <SectionTitle>The window</SectionTitle>
          <p className="wf-note">
            This reads the most recent {fmt(WINDOW)} changes. Older ones are still on disk and still in an export; they
            are not shown here so the panel opens instantly.
          </p>
        </section>
      )}
    </div>
  );
}
