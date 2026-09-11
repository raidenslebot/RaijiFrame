/**
 * Reading the ledger — sessions, series, and the windows nobody was watching.
 *
 * The ledger stores changes with timestamps and nothing else. Everything a
 * reader actually wants is derived, and the derivations are where this can go
 * wrong quietly, so they are stated here once rather than open-coded per panel.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SESSION BREAK IS MEASURED, NOT CONFIGURED.
 *
 * "A play session" is the unit every question here is really asked in — what did
 * that session cost, what did it yield, how fast was the standing coming in.
 * Splitting an event stream into sessions needs a gap threshold, and the obvious
 * move is a constant: thirty minutes, sixty, whatever reads well.
 *
 * A constant would be a number the app could MEASURE, sitting in the app as a
 * number somebody chose — the same defect as a slider for a value the mission
 * log already answers. Inter-event gaps are strongly bimodal: seconds to minutes
 * inside a session, hours between them. So the split is found in the data, as
 * the largest RATIO cliff in the sorted gaps.
 *
 * And when the data cannot support it — too few gaps, or no cliff worth the
 * name — that is said out loud with the sample size, and a stated fallback is
 * used. An unmeasurable threshold silently replaced by a plausible one is how a
 * derived number becomes folklore.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The other rule carried in from `ledger.ts`: BETWEEN sessions the app was not
 * watching. Those windows are returned as `Silence`, not closed up, because a
 * reader who cannot see them will read a flat line as "nothing happened" when it
 * means "nobody was looking".
 */

import { WATCHES, type LedgerEvent, type LedgerKind } from './ledger.ts';

/** Used only when the gaps cannot support a measured threshold. */
const FALLBACK_BREAK_MINUTES = 30;
/** Below this many gaps, the distribution is not a distribution. */
const MIN_GAPS = 8;
/**
 * A cliff has to be a cliff. Consecutive gaps in one session differ by small
 * factors constantly; a 4x step is the smallest that is not just noise, and
 * anything less confident is reported as unmeasured rather than rounded up to a
 * verdict.
 */
const MIN_RATIO = 4;

export interface Break {
  minutes: number;
  /** False when the fallback was used. Show this; never present it as measured. */
  measured: boolean;
  /** How many inter-event gaps the estimate saw. */
  sample: number;
  /** Why it is what it is, in one sentence, for the panel to print verbatim. */
  note: string;
}

/**
 * The gap that separates two sessions, found in the gaps themselves.
 *
 * Gaps are compared as RATIOS rather than differences because the two
 * populations differ by orders of magnitude — a 90-second gap and a 9-hour one
 * are not 8.5 hours apart in any way that matters, they are 360x apart. On a
 * difference scale the biggest step is always somewhere out in the tail.
 */
export function sessionBreak(events: readonly LedgerEvent[]): Break {
  const times = events.map((e) => e.at).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const g = times[i]! - times[i - 1]!;
    // Simultaneous events are one moment, not a zero-length gap: a run's twelve
    // counters share a millisecond and would otherwise dominate the sample.
    if (g > 1000) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);

  if (gaps.length < MIN_GAPS) {
    return {
      minutes: FALLBACK_BREAK_MINUTES,
      measured: false,
      sample: gaps.length,
      note: `${gaps.length} gaps on record — too few to find a session break, so ${FALLBACK_BREAK_MINUTES} minutes is assumed.`,
    };
  }

  let bestRatio = 0;
  let cut = 0;
  for (let i = 1; i < gaps.length; i++) {
    const ratio = gaps[i]! / gaps[i - 1]!;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      cut = i;
    }
  }

  if (bestRatio < MIN_RATIO) {
    return {
      minutes: FALLBACK_BREAK_MINUTES,
      measured: false,
      sample: gaps.length,
      note: `No gap in ${gaps.length} stands out by ${MIN_RATIO}x or more — the play so far is one unbroken stretch, so ${FALLBACK_BREAK_MINUTES} minutes is assumed.`,
    };
  }

  // The geometric mean of the two sides of the cliff: the midpoint on the scale
  // the comparison was made on, rather than on the one it was not.
  const minutes = Math.sqrt(gaps[cut - 1]! * gaps[cut]!) / 60_000;
  return {
    minutes,
    measured: true,
    sample: gaps.length,
    note: `Measured from ${gaps.length} gaps: the longest jump is ${bestRatio.toFixed(1)}x, between ${fmtGap(gaps[cut - 1]!)} and ${fmtGap(gaps[cut]!)}.`,
  };
}

function fmtGap(ms: number): string {
  const m = ms / 60_000;
  if (m < 1) return `${Math.round(ms / 1000)}s`;
  if (m < 90) return `${Math.round(m)} min`;
  return `${(m / 60).toFixed(1)} h`;
}

export interface SeriesNet {
  name: string;
  kind: LedgerKind;
  /** Net movement across the window. Null where no event carried a delta. */
  by: number | null;
  events: number;
  /** The value either side, where the series carries balances. */
  from: number | string | null;
  to: number | string | null;
  firstAt: number;
  lastAt: number;
}

export interface Session {
  from: number;
  to: number;
  count: number;
  /** Zero for a session that is a single moment — not null: it was measured. */
  minutes: number;
  byKind: Partial<Record<LedgerKind, number>>;
  /** Every series that moved, largest absolute movement first. */
  net: SeriesNet[];
}

/** A window inside the record where the app was not watching. */
export interface Silence {
  from: number;
  to: number;
  minutes: number;
}

export interface Timeline {
  sessions: Session[];
  /** The gaps BETWEEN sessions. Never merged into them. */
  silences: Silence[];
  break: Break;
  /** Minutes actually observed — the sum of the sessions, not the outer span. */
  observedMinutes: number;
  /** First and last event on record. Nothing is known before `from`. */
  from: number | null;
  to: number | null;
}

/**
 * Split the ledger into sessions.
 *
 * `observedMinutes` is the denominator every rate on the panel divides by, and
 * it is deliberately NOT the wall-clock span. A player with two hours of events
 * across a fortnight has played two hours; dividing their standing by the
 * fortnight would report a rate a hundred times too low and call it measured.
 */
export function timeline(events: readonly LedgerEvent[]): Timeline {
  const brk = sessionBreak(events);
  const sorted = [...events].sort((a, b) => a.at - b.at || (a.seq ?? 0) - (b.seq ?? 0));
  if (sorted.length === 0) {
    return { sessions: [], silences: [], break: brk, observedMinutes: 0, from: null, to: null };
  }

  const breakMs = brk.minutes * 60_000;
  const groups: LedgerEvent[][] = [[sorted[0]!]];
  for (let i = 1; i < sorted.length; i++) {
    const e = sorted[i]!;
    if (e.at - sorted[i - 1]!.at > breakMs) groups.push([e]);
    else groups[groups.length - 1]!.push(e);
  }

  const sessions = groups.map(summarise);
  const silences: Silence[] = [];
  for (let i = 1; i < sessions.length; i++) {
    const from = sessions[i - 1]!.to;
    const to = sessions[i]!.from;
    silences.push({ from, to, minutes: (to - from) / 60_000 });
  }

  return {
    sessions,
    silences,
    break: brk,
    observedMinutes: sessions.reduce((n, s) => n + s.minutes, 0),
    from: sorted[0]!.at,
    to: sorted[sorted.length - 1]!.at,
  };
}

function summarise(events: LedgerEvent[]): Session {
  const byKind: Partial<Record<LedgerKind, number>> = {};
  for (const e of events) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;

  const bySeries = new Map<string, LedgerEvent[]>();
  for (const e of events) {
    const rows = bySeries.get(e.name);
    if (rows) rows.push(e);
    else bySeries.set(e.name, [e]);
  }

  const net = [...bySeries.values()].map(netOf);
  /*
   * Ordered by how much moved, with a series carrying NO delta placed last
   * rather than at zero. A `session-state` transition did not move by nothing —
   * it has no magnitude at all, and sorting it as 0 would file it among the
   * things that genuinely did not change.
   */
  net.sort((a, b) => rank(b) - rank(a));

  const from = events[0]!.at;
  const to = events[events.length - 1]!.at;
  return { from, to, count: events.length, minutes: (to - from) / 60_000, byKind, net };
}

function rank(s: SeriesNet): number {
  return s.by === null ? -1 : Math.abs(s.by);
}

function netOf(rows: LedgerEvent[]): SeriesNet {
  const deltas = rows.filter((r) => r.by !== null);
  return {
    name: rows[0]!.name,
    kind: rows[0]!.kind,
    by: deltas.length === 0 ? null : deltas.reduce((n, r) => n + (r.by ?? 0), 0),
    events: rows.length,
    from: rows[0]!.from,
    to: rows[rows.length - 1]!.to,
    firstAt: rows[0]!.at,
    lastAt: rows[rows.length - 1]!.at,
  };
}

/**
 * The series that moved most across the whole record.
 *
 * `limit` truncates, so the caller has to say which rows it kept — see
 * `ui/ListTail.tsx`. The ordering is by absolute movement, which is only
 * comparable WITHIN a series: credits move in millions and slots in ones, so
 * this is a list of "what changed a lot for that thing", never a leaderboard
 * across things. The panel must not present it as one.
 */
export function topMovers(events: readonly LedgerEvent[], limit = 0): SeriesNet[] {
  const bySeries = new Map<string, LedgerEvent[]>();
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    const rows = bySeries.get(e.name);
    if (rows) rows.push(e);
    else bySeries.set(e.name, [e]);
  }
  const all = [...bySeries.values()].map(netOf).sort((a, b) => rank(b) - rank(a));
  return limit > 0 ? all.slice(0, limit) : all;
}

export interface Rate {
  /** Units per hour of OBSERVED play. Null when nothing was observed. */
  perHour: number | null;
  by: number;
  minutes: number;
  /** How many sessions contributed. One session is an anecdote; say so. */
  sessions: number;
}

/**
 * Movement per hour of observed play.
 *
 * Returns null rather than a number when there is nothing to divide by — an
 * hour of play that produced no measurable time is not a rate of zero, and a
 * rate of zero would rank below every real one instead of standing aside from
 * them.
 */
export function ratePerHour(name: string, tl: Timeline): Rate | null {
  let by = 0;
  let sessions = 0;
  let seen = false;
  for (const s of tl.sessions) {
    const row = s.net.find((n) => n.name === name);
    if (!row || row.by === null) continue;
    by += row.by;
    sessions++;
    seen = true;
  }
  if (!seen) return null;
  const minutes = tl.observedMinutes;
  return { perHour: minutes > 0 ? (by / minutes) * 60 : null, by, minutes, sessions };
}

// ── what was UNUSUAL, rather than what was biggest ───────────────────────────

export interface Headline {
  row: SeriesNet;
  /** How many times this series' own typical session movement it moved by. */
  times: number | null;
  /**
   * WHICH QUESTION THIS ANSWERS. Three different claims wear the same row, and
   * a reader cannot tell them apart from the number alone:
   *   `unusual`  - this moved notably more than it usually does
   *   `no-history` - too few sessions to know what usual is; this is the largest
   *   `nothing-unusual` - everything moved about as much as it always does, so
   *                       this is merely the largest
   */
  why: 'unusual' | 'no-history' | 'nothing-unusual';
}

/**
 * How far above its own typical a series must move to be worth headlining.
 *
 * WITHOUT THIS FLOOR THE FUNCTION ALWAYS RETURNS SOMETHING, and what it returns
 * is the argmax of a set clustered at 1.0 — which is to say, the most TYPICAL
 * thing, presented as the notable one. Rendering caught it: a session headlined
 * "platinum moved 1.0x its own typical session", which is a sentence that
 * refutes itself. Same shape as the session-break cliff, and the same fix.
 */
const UNUSUAL_AT = 1.5;

/** A series needs this many sessions before "typical for it" means anything. */
const MIN_SESSIONS_FOR_TYPICAL = 3;

/**
 * The median absolute movement per series, across the sessions it appeared in.
 *
 * Median rather than mean because one enormous session — a Nightwave dump, a
 * relic cracked into a windfall — would drag a mean far enough to make every
 * subsequent session look quiet by comparison.
 */
export function typicalMovement(tl: Timeline): Map<string, number> {
  const bySeries = new Map<string, number[]>();
  for (const s of tl.sessions) {
    for (const row of s.net) {
      if (row.by === null) continue;
      const xs = bySeries.get(row.name);
      if (xs) xs.push(Math.abs(row.by));
      else bySeries.set(row.name, [Math.abs(row.by)]);
    }
  }

  const out = new Map<string, number>();
  for (const [name, xs] of bySeries) {
    if (xs.length < MIN_SESSIONS_FOR_TYPICAL) continue;
    xs.sort((a, b) => a - b);
    const mid = Math.floor(xs.length / 2);
    const median = xs.length % 2 === 1 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
    // A series whose typical movement is zero has no scale to be unusual
    // against; dividing by it would rank it infinitely surprising forever.
    if (median > 0) out.set(name, median);
  }
  return out;
}

/**
 * The one line a session should be summarised by.
 *
 * NOT the largest number. Absolute magnitude is only comparable within a
 * series: credits move in tens of thousands and platinum in tens, so "biggest"
 * picks the same series every session and tells the reader nothing they could
 * not have guessed. Ranking incomparable quantities against each other is not
 * a ranking, it is a units error with an ordering on it.
 *
 * So each series is scored against ITS OWN typical session, and the headline is
 * whichever moved most unusually for itself. Where the record is too short for
 * any series to have a typical, this falls back to the largest movement and
 * reports `times: null` so the panel can say which question it answered.
 */
export function headline(session: Session, typical: ReadonlyMap<string, number>): Headline | null {
  const first = session.net[0];
  if (first === undefined) return null;

  let best: SeriesNet | null = null;
  let bestTimes = 0;
  let scored = 0;
  for (const row of session.net) {
    if (row.by === null) continue;
    const t = typical.get(row.name);
    if (t === undefined) continue;
    scored++;
    const times = Math.abs(row.by) / t;
    // Ties broken on absolute movement, so the choice is deterministic rather
    // than dependent on the order the series happened to be summarised in.
    if (times > bestTimes || (times === bestTimes && best !== null && Math.abs(row.by) > Math.abs(best.by ?? 0))) {
      best = row;
      bestTimes = times;
    }
  }

  if (best !== null && bestTimes >= UNUSUAL_AT) return { row: best, times: bestTimes, why: 'unusual' };
  return { row: first, times: null, why: scored === 0 ? 'no-history' : 'nothing-unusual' };
}

// ── the shape of a series ────────────────────────────────────────────────────

export interface Point {
  at: number;
  value: number;
}

/**
 * A series as points in time, split into segments at every gap.
 *
 * THE SPLIT IS THE POINT. Every sparkline ever drawn joins its samples with a
 * straight line, and across a two-day absence that line is a claim: it says the
 * value moved smoothly from here to there while you were away. It did not — the
 * app was not watching, and what happened in between is unknown.
 *
 * So the path breaks wherever consecutive observations are further apart than
 * the measured session break. Drawn, that reads as exactly what it is: a
 * measurement, a gap, another measurement. It is the same rule the timeline
 * draws its silences with, applied to a line instead of a column, and it is why
 * this cannot be a generic charting component.
 *
 * A series carrying balances (`to`) is plotted at its value. A series carrying
 * only deltas (`by` — a gain, a spend) is accumulated from zero, and the result
 * is a shape rather than a level: it answers "how fast" and cannot answer "how
 * much do I have", which is a distinction the caller has to keep.
 */
export function seriesShape(
  events: readonly LedgerEvent[],
  name: string,
  breakMinutes: number,
): { segments: Point[][]; min: number; max: number; cumulative: boolean } {
  const rows = events
    .filter((e) => e.name === name)
    .sort((a, b) => a.at - b.at || (a.seq ?? 0) - (b.seq ?? 0));

  if (rows.length === 0) return { segments: [], min: 0, max: 0, cumulative: false };

  // A series is a LEVEL if its observations carry balances, and a FLOW if they
  // only carry movement. Deciding per series rather than per event stops one
  // odd row switching the whole line's meaning halfway along.
  const cumulative = !rows.some((r) => typeof r.to === 'number');

  const points: Point[] = [];
  let running = 0;
  for (const r of rows) {
    if (cumulative) {
      running += r.by ?? 0;
      points.push({ at: r.at, value: running });
    } else if (typeof r.to === 'number') {
      points.push({ at: r.at, value: r.to });
    }
  }
  if (points.length === 0) return { segments: [], min: 0, max: 0, cumulative };

  const breakMs = breakMinutes * 60_000;
  const segments: Point[][] = [[points[0]!]];
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    if (p.at - points[i - 1]!.at > breakMs) segments.push([p]);
    else segments[segments.length - 1]!.push(p);
  }

  let min = points[0]!.value;
  let max = min;
  for (const p of points) {
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }
  return { segments, min, max, cumulative };
}

// ── moments ──────────────────────────────────────────────────────────────────

/**
 * How close two events must be to be one act.
 *
 * A single GEP push writes every counter that moved in the same millisecond, so
 * the obvious window is zero. It is wrong: the log events for a run arrive from
 * the file tail seconds before or after the inventory push that carries its
 * rewards, and a window of zero files them as unrelated. Four seconds is long
 * enough to hold a run's log lines and its inventory write together, and short
 * enough that two deliberate acts do not merge.
 */
const MOMENT_MS = 4000;

export type MomentKind =
  | 'mission'
  | 'tribute'
  | 'foundry'
  | 'purchase'
  | 'market'
  | 'syndicate'
  | 'helminth'
  | 'arsenal'
  | 'unknown';

export interface Moment {
  at: number;
  events: LedgerEvent[];
  kind: MomentKind;
  /** One sentence, derived. Never a template with the numbers dropped in. */
  summary: string;
}

/**
 * Group events into the acts that produced them.
 *
 * The ledger records CHANGES; a player did ACTS. Nothing in the store says which
 * act a change belongs to, and no field ever will — the account is a bag of
 * numbers and the game does not narrate. But changes that happen together were
 * caused together, and what moved together is enough to say what happened.
 */
export function moments(events: readonly LedgerEvent[]): Moment[] {
  const sorted = [...events].sort((a, b) => a.at - b.at || (a.seq ?? 0) - (b.seq ?? 0));
  if (sorted.length === 0) return [];

  const groups: LedgerEvent[][] = [[sorted[0]!]];
  for (let i = 1; i < sorted.length; i++) {
    const e = sorted[i]!;
    if (e.at - sorted[i - 1]!.at > MOMENT_MS) groups.push([e]);
    else groups[groups.length - 1]!.push(e);
  }
  return groups.map(readMoment);
}

/** Did any series in this moment start with `prefix`, and which way did it go? */
function moved(rows: readonly LedgerEvent[], prefix: string): number | null {
  let total: number | null = null;
  for (const r of rows) {
    if (!r.name.startsWith(prefix)) continue;
    if (r.by === null) {
      total ??= 0;
      continue;
    }
    total = (total ?? 0) + r.by;
  }
  return total;
}

function has(rows: readonly LedgerEvent[], name: string): boolean {
  return rows.some((r) => r.name === name);
}

/**
 * What this moment WAS.
 *
 * ORDERED, NOT SCORED. Every one of these is a sufficient condition, and the
 * first that holds wins — so a moment carrying a mission-end line is a mission
 * regardless of what else moved, and cannot be outvoted by three coincidental
 * currency changes. A weighted guess would let exactly that happen, and would be
 * wrong in the cases that matter most: the ones with the most going on.
 *
 * The last rung is `unknown`, and it says so rather than picking the least
 * unlikely label. A wrong story about what a player did is worse than no story:
 * they know what they did, and being told otherwise makes every other claim on
 * the page suspect.
 */
function readMoment(rows: LedgerEvent[]): Moment {
  const at = rows[0]!.at;
  const credits = moved(rows, 'credits');
  const platinum = moved(rows, 'platinum');
  const standing = moved(rows, 'standing:');
  const resources = moved(rows, 'resource:');
  const blueprints = moved(rows, 'blueprint:');
  const kinds = new Set(rows.map((r) => r.name));

  const near = (n: number) => `${n < 0 ? '\u2212' : '+'}${Math.abs(Math.round(n)).toLocaleString()}`;

  if (has(rows, 'daily-tribute')) {
    return {
      at,
      events: rows,
      kind: 'tribute',
      summary: 'The daily tribute was claimed. Anything that arrived here came from the login reward, not from a run.',
    };
  }

  if (kinds.has('mission-end') || kinds.has('mission-start') || kinds.has('inventory-durable')) {
    const parts: string[] = [];
    if (credits) parts.push(`${near(credits)} credits`);
    if (standing) parts.push(`${near(standing)} standing`);
    if (resources) parts.push(`${near(resources)} items`);
    return {
      at,
      events: rows,
      kind: 'mission',
      summary: parts.length > 0 ? `A run resolved: ${parts.join(', ')}.` : 'A run resolved, with nothing measurable to show for it.',
    };
  }

  /*
   * The arsenal, read before any spend: saving a build or ranking a mod can
   * move credits and endo, and without this rung a fusion would be filed as
   * "a purchase". Only the arsenal's own lines qualify; a lone credit loss
   * never does.
   */
  const placed = rows.filter((r) => r.name.startsWith('mod:') && r.to === 'installed').length;
  const lifted = rows.filter((r) => r.name.startsWith('mod:') && r.to === 'removed').length;
  if (placed + lifted > 0 || kinds.has('loadout-saved') || kinds.has('fusion-endo')) {
    const parts: string[] = [];
    if (placed) parts.push(`${String(placed)} ${placed === 1 ? 'mod' : 'mods'} placed`);
    if (lifted) parts.push(`${String(lifted)} lifted`);
    if (kinds.has('fusion-endo')) parts.push('a mod ranked');
    if (kinds.has('loadout-saved')) parts.push('the build saved');
    return { at, events: rows, kind: 'arsenal', summary: `In the arsenal: ${parts.join(', ')}.` };
  }

  // Helminth before foundry: feeding it also consumes resources, and the
  // resource loss alone would read as a build.
  if (moved(rows, 'helminth-') !== null) {
    return { at, events: rows, kind: 'helminth', summary: 'The Helminth was fed or its rank moved.' };
  }

  if (resources !== null && resources < 0 && ((blueprints ?? 0) > 0 || (credits ?? 0) < 0)) {
    return { at, events: rows, kind: 'foundry', summary: 'A build was started: materials and credits went in.' };
  }

  if (platinum !== null && platinum < 0) {
    return {
      at,
      events: rows,
      kind: 'market',
      summary: `${near(platinum)} platinum spent — a market purchase or a trade.`,
    };
  }

  if (standing !== null && standing < 0) {
    return { at, events: rows, kind: 'syndicate', summary: 'Standing was spent at a syndicate.' };
  }

  if (credits !== null && credits < 0) {
    return { at, events: rows, kind: 'purchase', summary: `${near(credits)} credits spent.` };
  }

  return {
    at,
    events: rows,
    kind: 'unknown',
    summary: `${String(rows.length)} ${rows.length === 1 ? 'change' : 'changes'} with nothing to identify what caused them.`,
  };
}


// ── what has never been seen ─────────────────────────────────────────────────

export interface Unobserved {
  /** Watch names with no event, ever. */
  names: string[];
  /** Watches that have produced at least one. */
  seen: number;
  total: number;
}

/**
 * The watches that have never recorded anything for this account.
 *
 * MEASURED AGAINST A REAL ACCOUNT: of 84 watches, 12 found data in the capture
 * in `public/__review-acct.json` — but that capture carries 18 of the account's
 * top-level keys, so the other 72 are not dead, they are UNSEEN. Reading the
 * empty ones as "this player has no Helminth" would be the app's own worst error
 * class committed against its own configuration.
 *
 * So this returns what has not been observed, and the panel that shows it has to
 * say what that does and does not mean. There are three reasons a watch is here
 * and the ledger can only distinguish the third:
 *
 *   - the account genuinely has none of it (no lich, no Railjack)
 *   - it has some, and none of it has changed while the app was watching
 *   - the app has not been running at the moments it did change
 *
 * A panel that renders this as "0" claims the first. It is entitled to claim
 * only "not seen".
 */
export function unobserved(events: readonly LedgerEvent[]): Unobserved {
  const families = new Set<string>();
  for (const e of events) {
    const cut = e.name.indexOf(':');
    families.add(cut === -1 ? e.name : e.name.slice(0, cut));
  }
  const names: string[] = [];
  for (const w of WATCHES) if (!families.has(w.name)) names.push(w.name);
  names.sort();
  return { names, seen: WATCHES.length - names.length, total: WATCHES.length };
}
