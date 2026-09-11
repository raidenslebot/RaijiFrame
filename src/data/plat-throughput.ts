/**
 * Platinum per hour, measured from YOUR OWN RUNS.
 *
 * WHY THERE ARE NO SLIDERS HERE
 * ─────────────────────────────
 * The first version of this asked the player how many minutes a fissure takes
 * them, how many drops they pick up an hour, how much standing they earn. That
 * was wrong twice over.
 *
 * It was wrong as design, because it made the reader do the measuring and then
 * presented their guess back to them as a result. Nobody knows their own clear
 * time to the minute; they would move a slider until the number looked nice,
 * and the number would mean nothing.
 *
 * It was wrong as engineering, because this app ALREADY WATCHES THE GAME. The
 * mission recorder has been logging every run - the node, the mission type, the
 * gameplay duration, and the inventory diff of what actually dropped - and the
 * throughput engine was asking the player to type in data that was sitting in
 * the log. That is the definition of tunnel vision: reaching for an input
 * control instead of the measurement one file over.
 *
 * So every temporal term here comes from the player's own recorded runs, with
 * the sample size stated. Nothing is configured. Where there are no runs yet,
 * the chain says exactly that and refuses - it does not fall back to a default,
 * because a default is a guess wearing the same typeface as a measurement.
 *
 * DUCATS ARE NOT PLATINUM, AND ARE NOT MODELLED HERE
 * ──────────────────────────────────────────────────
 * An earlier version converted ducats into platinum inside these chains, at a
 * rate the player set. That quietly poisoned every figure it touched: a rate in
 * platinum-per-hour that secretly contains a made-up exchange rate is not a
 * platinum figure at all, and it sat in the same column as rates built entirely
 * from measurements.
 *
 * Ducats are their own economy with their own loop - junk to kiosk, kiosk to
 * Baro, Baro to a buyer - and they get their own section. The only place the two
 * currencies legitimately meet is a decision about ONE item ("sell this, or
 * ducat it?"), which is a comparison rather than a conversion, and lives where
 * that decision is made.
 *
 * So nothing in this file converts a ducat. A route that pays ducats appears in
 * MODEL_GAPS pointing at the Ducats section, which is where it can be modelled
 * honestly and in its own units.
 *
 * THE CHAIN
 * ─────────
 *     runs an hour  x  sellable things per run  x  platinum per thing
 *
 * with every link declaring its provenance:
 *
 *   MEASURED  from THIS ACCOUNT: your own runs, or a live market median. The
 *             note says which, and how many runs it rests on.
 *   PUBLISHED a constant from a table - a drop chance, a squad rule. True of
 *             the game rather than of you, and it does not move when you play.
 *   YOURS     a preference you set, which changes the answer because you said
 *             so rather than because anything was observed.
 *   UNKNOWN   nobody has published it, and you have not run it yet. Stops the
 *             chain and names itself rather than being estimated.
 *
 * PUBLISHED WAS MISSING AND ITS ABSENCE WAS A CLAIM.
 * ──────────────────────────────────────────────────
 * The vocabulary above used to fold "a published drop chance" into MEASURED, on
 * the reasoning that both are real numbers rather than guesses. They are, and
 * that is not what the word means to a reader: the panel printed "measured"
 * under "1 mod per Nightmare mission", which every player will read as *from my
 * runs* - beside a link that genuinely was. Two things with very different
 * standing wore one label, and the one that could not be checked borrowed the
 * authority of the one that could.
 *
 * `plat-picks.ts` has carried `'measured' | 'published' | 'yours'` for its own
 * evidence rows all along. This is the same distinction, arriving late in the
 * module that needed it most.
 */

import type { Price } from './market.ts';
import type { MissionRecord } from './missionlog.ts';

/*
 * ASSUMED, added for the guidance engine: a figure taken from THIS account's
 * log but for a different mission type - the slowest one timed, standing in
 * for one never run. The minutes are measured; their assignment is not. The
 * first render labelled such a link "measured" directly above the sentence
 * "you have not run Exterminate yet", and a word that contradicts the line
 * under it is the borrowed authority this vocabulary exists to refuse.
 */
export type Provenance = 'measured' | 'published' | 'yours' | 'assumed' | 'unknown';

export interface Link {
  label: string;
  value: number | null;
  from: Provenance;
  note: string;
  unit: string;
}

export interface Chain {
  routeId: string;
  links: Link[];
  cap: string | null;
}

export interface Rate {
  routeId: string;
  perHour: number | null;
  blockedBy: Link | null;
  links: Link[];
  /** How many of your own runs the timing rests on. Null when none were used. */
  fromRuns: number | null;
  cap: string | null;
  /** Trades the hour's output would cost to sell, at six items a trade. */
  tradesPerHour: number | null;
  /** Platinum per trade spent - the axis that matters when trades are scarce. */
  perTrade: number | null;
  /** Daily trades across the representative items. */
  volume: number | null;
  /** True when the player replaced the measured timing with their own. */
  overridden: boolean;
}

export function evaluate(
  chain: Chain,
  fromRuns: number | null,
  extra?: { itemsPerHour?: number; volume?: number; overridden?: boolean },
): Rate {
  const base = {
    routeId: chain.routeId,
    links: chain.links,
    fromRuns,
    cap: chain.cap,
    volume: extra?.volume ?? null,
    overridden: extra?.overridden ?? false,
  };

  let acc = 1;
  for (const link of chain.links) {
    if (link.from === 'unknown' || link.value === null) {
      return { ...base, perHour: null, blockedBy: link, tradesPerHour: null, perTrade: null };
    }
    acc *= link.value;
  }

  const perHour = Math.round(acc * 10) / 10;
  /*
   * Six items a side, per trade. A route that showers you with cheap things can
   * out-earn a good one per HOUR while being far worse per TRADE, and trades are
   * the resource you cannot buy more of.
   */
  const items = extra?.itemsPerHour ?? null;
  const trades = items === null ? null : Math.ceil(items / 6);
  return {
    ...base,
    perHour,
    blockedBy: null,
    tradesPerHour: trades,
    perTrade: trades === null || trades <= 0 ? null : Math.round((perHour / trades) * 10) / 10,
  };
}

/* ------------------------------------------------------ what was observed */

export interface Timing {
  /** Median gameplay minutes for these runs. Median, not mean: one AFK run
   *  sitting in extraction for twenty minutes would drag a mean badly. */
  minutes: number;
  runs: number;
  /**
   * The slowest this median plausibly is, given how few runs are behind it.
   *
   * WHY A POINT ESTIMATE WAS NOT ENOUGH
   * ————————————————————————————
   * `runs` was carried on every timing in this file and used only in prose.
   * The ranking read `minutes` alone, so a route run twice - fast, once, on a
   * good night - outranked a route with ninety runs behind it and held the top
   * of the table until enough contrary evidence piled up to drag it down. The
   * app was reporting luck as a rate, and saying "from 2 runs" underneath it in
   * grey.
   *
   * This is the honest upper end of the same measurement. It is NOT a guess and
   * it needs no prior: for a median, a distribution-free interval falls straight
   * out of the order statistics of the sample itself, so the only choice made is
   * the confidence level. Two runs give a band as wide as the two runs; ninety
   * give a band a few per cent across. The evidence sets its own width.
   *
   * Null when the sample cannot bound a median at all - which is any n below
   * three, and is a real answer rather than a missing one.
   */
  slowest: number | null;
  /**
   * The share of runs of THIS mission type that this account finished.
   *
   * WHY PER TYPE AND NOT PER ACCOUNT
   * ────────────────────────────────
   * `Observed.reliability` already measures how often this account finishes
   * anything, and that number cannot change a ranking: applied to every route
   * equally it is a constant multiplier, and a constant multiplier reorders
   * nothing. Per mission type it can, and the difference is the whole point —
   * an account that finishes every Capture and abandons half its Survivals is
   * being told something false when both are quoted at the rate they pay when
   * they go well.
   *
   * `decided` is the denominator, carried so thin evidence can be said to be
   * thin. Null when no run of this type ever stated an outcome, which is not
   * "you finish everything" — a rate nobody has watched is not a rate of one.
   */
  finished: { rate: number; decided: number } | null;
}

/**
 * The confidence the timing band is quoted at.
 *
 * A stated choice, and the only number in this calculation that somebody picked
 * rather than counted. 80% is deliberately loose: this band is used to stop a
 * two-run fluke leading a ranking, not to publish an interval, and a 95% band
 * over three runs is so wide it would refuse to rank anything at all.
 */
const TIMING_CONFIDENCE = 0.8;

/**
 * A distribution-free confidence band for a median, from the order statistics.
 *
 * The k-th smallest and k-th largest of n samples bracket the true median with
 * probability `1 - 2 * P(Binomial(n, 0.5) < k)`. No assumption is made about
 * the shape of the distribution - which matters, because mission times are not
 * normal: they have a hard floor and a long tail of runs that went wrong.
 *
 * Returns the TIGHTEST band that still meets the confidence, and null when no
 * band does. Symmetric, so it also yields the fast end, which nothing needs
 * yet - the pessimistic end is the one that stops a fluke leading a ranking.
 */
function medianBand(sorted: readonly number[], confidence: number): { low: number; high: number } | null {
  const n = sorted.length;
  if (n < 3) return null;

  /*
   * PAST 1,023 RUNS THE EXACT FORM SILENTLY INVERTS ITS OWN ANSWER.
   * ————————————————————————————————————————————
   * The exact branch below divides binomial coefficients by 2^n. A double holds
   * 2^n up to n = 1023; at exactly 1,024 it becomes Infinity, every coverage
   * then reads as 1, and the loop walks all the way to the middle - returning a
   * band ONE SAMPLE WIDE and presenting the tightest possible interval at the
   * precise moment the arithmetic stopped working. Measured: at n = 1023 the
   * exact form picks k = 490; at n = 1024 it picks k = 512, the degenerate
   * middle. A thousand runs of one mission type is a year of play, not a
   * hypothetical.
   *
   * AND THE FIRST VERSION OF THIS GUARD WAS WRONG. It cut over at n > 60 and
   * said in a comment that both terms overflow "past about sixty runs". They do
   * not, and nothing in the code or the test caught the claim - the two forms
   * agree so closely that swapping them changes nothing. Measured across the
   * valid range they differ by at most one order statistic: at n = 200, k = 91
   * against 90; at n = 1000, k = 480 against 479. That agreement is the reason
   * the approximation is safe to use, and it is also the reason a wrong cutover
   * was invisible.
   *
   * So the cutover sits where the failure actually is, and the number in the
   * comment is one that was measured rather than assumed.
   */
  const EXACT_LIMIT = 1023;
  if (n > EXACT_LIMIT) {
    // Two-sided z for the requested confidence. Only the levels this file asks
    // for appear; a general inverse-normal would be more code and less exact.
    const z = confidence >= 0.95 ? 1.96 : confidence >= 0.9 ? 1.645 : 1.2816;
    const k = Math.max(1, Math.floor(n / 2 - (z * Math.sqrt(n)) / 2));
    return { low: sorted[k - 1] ?? 0, high: sorted[n - k] ?? 0 };
  }

  // P(X < k) for X ~ Binomial(n, 0.5), accumulated as exact binomial
  // coefficients over 2^n. n is a run count, so it never approaches overflow.
  let coeff = 1; // C(n, 0)
  let tail = 0; // sum of C(n, i) for i < k
  const total = Math.pow(2, n);

  let best: { low: number; high: number } | null = null;
  for (let k = 1; k <= Math.floor(n / 2); k += 1) {
    tail += coeff;
    coeff = (coeff * (n - (k - 1))) / k; // C(n, k) from C(n, k-1)
    const coverage = 1 - (2 * tail) / total;
    if (coverage < confidence) break;
    // Tighter than the last one that qualified, so keep walking inward.
    best = { low: sorted[k - 1] ?? 0, high: sorted[n - k] ?? 0 };
  }
  return best;
}

/** How often a set of runs ended in success, over the ones that said. */
interface Finish {
  done: number;
  decided: number;
}

/** A timing, with the band its own sample supports and how often it lands. */
function timingOf(
  values: readonly number[],
  round: (n: number) => number,
  finish?: Finish,
): Timing | null {
  const m = median(values);
  if (m === null) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const band = medianBand(sorted, TIMING_CONFIDENCE);
  return {
    minutes: round(m),
    runs: values.length,
    slowest: band === null ? null : round(band.high),
    finished:
      finish === undefined || finish.decided === 0
        ? null
        : { rate: finish.done / finish.decided, decided: finish.decided },
  };
}

/**
 * The player's own play, reduced to what the engine needs.
 *
 * Built once from the mission log. Everything in it is a measurement of what
 * they actually did, and every field carries the run count so no single
 * unusual run can pass itself off as a rate.
 */
export interface Observed {
  /** Median minutes by the chart's readable mission type ("Capture"). */
  byType: ReadonlyMap<string, Timing>;
  /** Median minutes over every recorded run, whatever it was. */
  overall: Timing | null;
  /** Total runs in the log. */
  totalRuns: number;
  /**
   * How often this account actually finishes what it starts, measured.
   *
   * `rate` is successes over runs with a STATED outcome, and `runs` is that
   * denominator so a caller can say how much evidence is behind it. Null when
   * the log has never recorded an outcome either way.
   *
   * WHY THIS IS A MEASUREMENT AND THE POWER SLIDERS ARE NOT.
   * The panel asks the player to rate their frame and weapons out of five, and
   * `PlatinumPanel` defends that by saying "nothing in an account describes a
   * BUILD". True of the inventory; false of the log, which records the outcome
   * of every run. Whether this account can carry the content it attempts is not
   * a thing to ask about - it is a thing that has already happened.
   */
  reliability: { rate: number; runs: number } | null;
  /**
   * How long this player's sittings actually last, in minutes.
   *
   * `runs` here counts SESSIONS, not missions - it is the sample size behind
   * the median, and a figure built from two evenings should not be presented
   * with the same confidence as one built from thirty.
   *
   * This exists so nothing has to ask "how long have you got?". The answer was
   * always in the log; the question was the panel failing to read it.
   */
  session: Timing | null;
  /**
   * How many players this account actually runs with, as a median.
   *
   * Squad size is a CHOICE, not a fact about a player - the line this file
   * draws elsewhere still holds and this does not cross it. What it provides is
   * a DEFAULT for that choice taken from the player's own recent behaviour,
   * which is a different thing from asserting a measurement as a preference. A
   * default drawn from evidence beats a constant, and it beats a question.
   */
  squad: { size: 1 | 2 | 3 | 4; runs: number } | null;
}

export const NOTHING_OBSERVED: Observed = {
  byType: new Map(),
  overall: null,
  totalRuns: 0,
  session: null,
  squad: null,
  // Null rather than a perfect 1: an empty log has not watched this account
  // finish anything, which is not the same as watching it finish everything.
  reliability: null,
};

/**
 * How long a break has to be before it is a different sitting.
 *
 * A CHOSEN constant, not a measured one, and the only one in this function.
 * Forty-five minutes is longer than all but a handful of missions, so a gap
 * that size inside one sitting is rare; and it is short enough that an evening
 * and the next morning never merge into one implausible six-hour session. The
 * figure is a starting point to tune against real logs, not a discovered law.
 */
const SESSION_GAP_MS = 45 * 60_000;

/** When a run began: its own timestamp, or its end walked back by its length. */
function beganAt(r: MissionRecord): number | null {
  if (r.startedAt !== null) return r.startedAt;
  if (r.durationMs !== null && r.durationMs > 0) return r.endedAt - r.durationMs;
  return null;
}

/**
 * Split the log into sittings and measure how long they run.
 *
 * The sitting IN PROGRESS is excluded when `now` is supplied, because it has
 * not finished and reporting a truncated length as a typical one would tell a
 * player who just sat down that they play for four minutes.
 */
function sessions(records: readonly MissionRecord[], now: number | null): Timing | null {
  /*
   * A run whose start is unknown still counts as a POINT in the evening.
   *
   * Dropping those rows was wrong in a way that only showed up as a number
   * being too small: three untimed runs in the middle of a sitting left a gap
   * of more than the threshold between the rows that survived, so one evening
   * was counted as two short ones and the median sank. Collapsing such a run to
   * the instant it ended keeps the sitting whole and adds nothing to its
   * length, which is the honest treatment of a run whose duration nobody knows.
   */
  const rows = records
    .map((r) => ({ from: beganAt(r) ?? r.endedAt, to: r.endedAt }))
    .sort((a, b) => a.from - b.from);
  if (rows.length === 0) return null;

  const spans: Array<{ from: number; to: number }> = [];
  for (const row of rows) {
    const open = spans[spans.length - 1];
    if (open && row.from - open.to <= SESSION_GAP_MS) open.to = Math.max(open.to, row.to);
    else spans.push({ from: row.from, to: row.to });
  }

  /*
   * The OLDEST span is thrown away whenever there is more than one, because the
   * read that produced these records is capped and the cap lands wherever it
   * lands - almost always inside a sitting. Its surviving half is not a short
   * evening, it is half an evening, and it would enter the median at full
   * weight claiming to be the former.
   */
  const whole = spans.length > 1 ? spans.slice(1) : spans;

  /*
   * And the sitting IN PROGRESS is excluded, because it has not finished.
   * Reporting a truncated length as a typical one would tell a player who sat
   * down four minutes ago that they play for four minutes.
   */
  const closed = now === null ? whole : whole.filter((sp) => now - sp.to > SESSION_GAP_MS);
  const lengths = closed.map((sp) => (sp.to - sp.from) / 60_000).filter((m) => m > 0);
  return timingOf(lengths, Math.round);
}

/** The squad size this account actually plays at, as a median of what was seen. */
function squadOf(records: readonly MissionRecord[]): { size: 1 | 2 | 3 | 4; runs: number } | null {
  const seen = records
    .map((r) => r.squadSize)
    .filter((n): n is number => n !== null && n >= 1 && n <= 4);
  const m = median(seen);
  if (m === null) return null;
  const size = Math.min(4, Math.max(1, Math.round(m))) as 1 | 2 | 3 | 4;
  return { size, runs: seen.length };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  return lo === undefined || hi === undefined ? null : (lo + hi) / 2;
}

/**
 * Reduce the mission log to timings.
 *
 * Only runs with a real `durationMs` count. A record whose duration never
 * arrived is not a zero-length run and is not counted as one - it simply does
 * not contribute, and the run count reflects that.
 *
 * A RUN THAT FAILED IS NOT HOW LONG THE ROUTE TAKES.
 * ————————————————————————————
 * This used to filter on `durationMs > 0` alone and never read `outcome`, which
 * `MissionRecord` has carried since it was written. So a Survival abandoned at
 * four minutes entered the median as a four-minute run: it shortened
 * `minutesPerRun`, raised runs-per-hour, and raised the platinum-per-hour of a
 * route for an attempt that paid nothing at all.
 *
 * The bias is one-directional and it is worst for the players it hurts most.
 * Failing and aborting are what an under-geared account does, so the engine
 * quietly told exactly those players that the content they cannot finish is the
 * most profitable thing they could be doing.
 *
 * An UNKNOWN outcome still counts. `outcome` is null when the log did not say,
 * and "we do not know how this ended" is not "this failed" - dropping those
 * would be the same fabrication in the other direction.
 */
export function observe(records: readonly MissionRecord[], now: number | null = null): Observed {
  const buckets = new Map<string, number[]>();
  const all: number[] = [];
  let decided = 0;
  let succeeded = 0;
  /*
   * Outcomes are tallied SEPARATELY from the timing buckets, because the two
   * populations are deliberately different: a failed run is excluded from the
   * median (it is not how long the route takes) and is exactly what the finish
   * rate is counting. Sharing one loop is fine; sharing one bucket would make
   * each measurement wrong in the other's direction.
   */
  const finishes = new Map<string, Finish>();

  for (const r of records) {
    /*
     * The reliability tally runs over every record with a STATED outcome,
     * including ones with no duration: whether a run was finished is a
     * different question from how long it took, and a record can answer the
     * first without the second.
     */
    if (r.outcome === 'success' || r.outcome === 'failure' || r.outcome === 'abandoned') {
      decided += 1;
      if (r.outcome === 'success') succeeded += 1;
      const type = r.missionTypeName;
      if (type !== null) {
        const f = finishes.get(type) ?? { done: 0, decided: 0 };
        f.decided += 1;
        if (r.outcome === 'success') f.done += 1;
        finishes.set(type, f);
      }
    }

    if (r.durationMs === null || r.durationMs <= 0) continue;
    if (r.outcome === 'failure' || r.outcome === 'abandoned') continue;
    const minutes = r.durationMs / 60_000;
    all.push(minutes);
    const key = r.missionTypeName;
    if (key === null) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(minutes);
    else buckets.set(key, [minutes]);
  }

  const byType = new Map<string, Timing>();
  for (const [key, values] of buckets) {
    const t = timingOf(values, (x) => Math.round(x * 10) / 10, finishes.get(key));
    if (t !== null) byType.set(key, t);
  }

  return {
    byType,
    overall: timingOf(all, (x) => Math.round(x * 10) / 10),
    totalRuns: all.length,
    session: sessions(records, now),
    squad: squadOf(records),
    /*
     * Null, not 1, when nothing in the log states an outcome. A rate multiplied
     * by an assumed 100% is the fabricated figure this whole module refuses
     * everywhere else; a caller has to be able to tell "you finish everything"
     * from "we have never seen you finish anything".
     */
    reliability: decided === 0 ? null : { rate: succeeded / decided, runs: decided },
  };
}

/* --------------------------------------------------- the daily standing cap */

/**
 * Whether this account has already hit today's standing cap, from its own runs.
 *
 * WHY THIS EXISTS
 * ───────────────
 * `SyndicateXp` carries three numbers per run - `base`, `afterMultiplier` and
 * `afterCheckpoint` - and its own doc comment states the rule: "Below
 * `afterMultiplier` means the player has hit their daily standing cap." That
 * field is parsed out of the log, typed, threaded through `MissionRecord`, and
 * read by nothing at all.
 *
 * The consequence is a card that gives bad advice for the rest of the day. The
 * standing slot ranks offerings on platinum per thousand standing and then
 * tells the player to go and earn it - when the game has already told us, in
 * the log, that they cannot earn any more standing today. The ratio is not
 * wrong; the instruction is, and only until the reset.
 *
 * THREE STATES, AND THE MIDDLE ONE IS THE POINT
 * ─────────────────────────────────────────────
 * `true` is a measurement: a run since the reset was clipped by the cap.
 * `false` is also a measurement: runs since the reset earned standing and none
 * was clipped.
 * `null` is neither - no run since the reset carried standing at all, so the
 * question has not been answered. It must not collapse into `false`, because
 * "we have not seen you cap out" and "you have room left" are different claims
 * and only one of them is ours to make.
 */
export interface StandingCap {
  /** Null when no run since `since` carried standing at all. */
  hit: boolean | null;
  /** Runs since `since` that carried standing. The evidence behind `hit`. */
  runs: number;
  /** When the cap was first seen to bite, if it was. */
  at: number | null;
}

export function standingCap(records: readonly MissionRecord[], since: number): StandingCap {
  let runs = 0;
  let at: number | null = null;

  for (const r of records) {
    if (r.endedAt < since) continue;
    const xp = r.syndicateXp;
    /*
     * `== null`, NOT `=== null`, AND THIS CRASHED THE WHOLE APP.
     * ————————————————————————————————————————————
     * `MissionRecord.syndicateXp` is typed `SyndicateXp | null`, so TypeScript
     * accepted the strict check — but records come back from IndexedDB through
     * `recentMissions`, and a stored record written before this field existed
     * simply has no such key. That reads `undefined`, which is not `null`, so
     * it passed the guard and the next line dereferenced it.
     *
     * The result was not a wrong number: it was an uncaught TypeError inside
     * render, so React unmounted everything and the overlay was a blank page.
     * typecheck, eslint, the build and all 501 checks passed it, because every
     * fixture in those gates constructs the field. A type union is a claim
     * about values the compiler can see; a field absent from stored JSON is not
     * one of them.
     */
    if (xp == null) continue;
    /*
     * A run that earned nothing at all says nothing about the cap - the player
     * may simply have been running content that pays no standing. Only a run
     * that DID earn is evidence either way.
     */
    if (xp.afterMultiplier <= 0) continue;
    runs += 1;
    if (xp.afterCheckpoint < xp.afterMultiplier && (at === null || r.endedAt < at)) at = r.endedAt;
  }

  return { hit: runs === 0 ? null : at !== null, runs, at };
}

/**
 * Standing earned per hour, measured from this account's own runs.
 *
 * WHY THIS IS THE MISSING EXCHANGE RATE
 * ────────────────────────────────────
 * `plat-picks.ts` shows five suggestion cards in a fixed order and refuses to
 * rank them, on a stated argument: *"Sorting these against each other would
 * need an exchange rate between a trade, an hour, a day's standing and a relic,
 * and no such rate exists that is not invented."*
 *
 * That is true of ONE of the four. Trades genuinely do not convert to hours —
 * a daily trade count is a quota, not a rate. The other three do, and the data
 * to convert them has been sitting in the log the whole time:
 *
 *   the run card    is already platinum per hour
 *   the relic card  is expected platinum per crack, over minutes per fissure
 *   the standing card is THIS — standing per hour — times the platinum a
 *                    thousand standing buys, which `standing-value.ts` already
 *                    computes as `platPerK`
 *
 * So the refusal was over-broad by three cases out of four, and the app has
 * been showing five uncomparable cards where it could rank three of them in one
 * unit. Its own recorded principle is that a ranked list is not an answer and
 * the app must decide; five cards in "the order a player meets them" is the
 * ranking removed rather than the decision made.
 *
 * WHAT IS MEASURED AND WHAT IS REFUSED
 * ────────────────────────────────────
 * Only runs that BOTH carried standing and carried a duration count. A run with
 * standing and no clock cannot contribute a rate, and a run with a clock and no
 * standing is evidence about a different question — it may simply have been
 * content that pays none.
 *
 * `afterCheckpoint` is the figure taken, not `afterMultiplier`: it is what the
 * account actually banked once the daily cap had its say, which is the number a
 * platinum conversion has to be built on. Using the pre-cap figure would quote
 * a rate the player cannot realise.
 *
 * Null when no run answers, which is not zero — "we have never watched you earn
 * standing" and "you earn none" are different claims and only one is ours.
 */
export interface StandingRate {
  /** Standing per hour, over the runs that could answer. */
  perHour: number;
  /** How many runs that was, so thin evidence can be said to be thin. */
  runs: number;
}

export function standingPerHour(records: readonly MissionRecord[]): StandingRate | null {
  let standing = 0;
  let ms = 0;
  let runs = 0;

  for (const r of records) {
    const xp = r.syndicateXp;
    /*
     * `== null`, NOT `=== null`, AND THIS CRASHED THE WHOLE APP.
     * ————————————————————————————————————————————
     * `MissionRecord.syndicateXp` is typed `SyndicateXp | null`, so TypeScript
     * accepted the strict check — but records come back from IndexedDB through
     * `recentMissions`, and a stored record written before this field existed
     * simply has no such key. That reads `undefined`, which is not `null`, so
     * it passed the guard and the next line dereferenced it.
     *
     * The result was not a wrong number: it was an uncaught TypeError inside
     * render, so React unmounted everything and the overlay was a blank page.
     * typecheck, eslint, the build and all 501 checks passed it, because every
     * fixture in those gates constructs the field. A type union is a claim
     * about values the compiler can see; a field absent from stored JSON is not
     * one of them.
     */
    if (xp == null) continue;
    if (r.durationMs === null || r.durationMs <= 0) continue;
    /*
     * A run that banked nothing is not evidence of a rate. It is far more
     * likely to have been content that pays no standing at all than an hour
     * of standing-earning play that yielded none, and averaging it in would
     * drag every rate toward zero for players who mix content.
     */
    if (xp.afterCheckpoint <= 0) continue;
    standing += xp.afterCheckpoint;
    ms += r.durationMs;
    runs += 1;
  }

  if (runs === 0 || ms <= 0) return null;
  return { perHour: Math.round((standing / (ms / 3_600_000)) * 10) / 10, runs };
}

/* ------------------------------------------------------- the preferences */

/**
 * What a player configures.
 *
 * THE LINE THIS FILE DRAWS
 * ────────────────────────
 * A control may hold a CHOICE. It may never hold a MEASUREMENT.
 *
 * How fast you clear a Capture is a measurement, and asking for it was the
 * mistake this file was rewritten to undo. Whether you intend to run in a full
 * squad is a choice - it is not true or false about you until you decide it,
 * two players with identical logs will answer differently, and no amount of
 * watching the game reveals it. Everything below is of the second kind.
 *
 * `timingOverride` is the interesting case and sits deliberately on the choice
 * side: it does not replace the measurement, it says "I intend to play faster
 * than my log shows". The measured figure stays on screen beside it, labelled,
 * so the reader can always see what they overrode and by how much.
 */
export interface Preference {
  /** How many of you there will be. Squad-scaled drops multiply by this. */
  squad: 1 | 2 | 3 | 4;
  /**
   * Hide anything whose representative items trade fewer than this many times a
   * day. A 200p item nobody buys is not 200p of income.
   */
  minVolume: number;
  /** Include routes a timer caps, which cannot be repeated for a whole hour. */
  includeCapped: boolean;
  /** Include routes whose chain is blocked, so the missing term is visible. */
  includeBlocked: boolean;
  /** What "best" means to you. */
  sort: SortAxis;
  /** Minutes you insist on, per route, when you disagree with your own log. */
  timingOverride: ReadonlyMap<string, number>;
}

/**
 * The axis a rate is judged on.
 *
 * `perHour` is the obvious one and the wrong one for a seller: trades are the
 * scarce resource, not hours, so a route producing one 200p item an hour beats
 * one producing forty 5p items that cost seven trades to move.
 */
export type SortAxis = 'perHour' | 'perTrade' | 'liquidity';

export const SORT_LABEL: Record<SortAxis, string> = {
  perHour: 'Platinum an hour',
  perTrade: 'Platinum per trade',
  liquidity: 'How fast it sells',
};

export const DEFAULT_PREFERENCE: Preference = {
  squad: 4,
  minVolume: 0,
  includeCapped: true,
  includeBlocked: true,
  sort: 'perHour',
  timingOverride: new Map(),
};

/* ------------------------------------------------------------- the model */

/** Where a route's timing comes from. */
type TimingModel =
  /** Measured from the player's runs of these mission types, in order of preference. */
  | { kind: 'missionTypes'; names: readonly string[] }
  /** Measured from every run they have logged, whatever it was. */
  | { kind: 'overall' }
  /** The route has no mission at all - it happens at a console or a vendor. */
  | { kind: 'noMission'; note: string };

export type DropModel =
  /** `perPlayer` marks a drop that scales with squad size, like a relic. */
  | { kind: 'fixed'; n: number; label: string; note: string; perPlayer?: boolean }
  | { kind: 'chance'; percent: number; label: string; note: string };

type PriceModel =
  | { kind: 'market'; slugs: readonly string[]; label: string }
  | { kind: 'unknown'; label: string; why: string };

export interface RouteModel {
  timing: TimingModel;
  drop: DropModel;
  price: PriceModel;
  cap?: string;
}

export const MODELS: Record<string, RouteModel> = {
  /* ---------------------------------------------------- the prime economy */
  fissures: {
    timing: { kind: 'missionTypes', names: ['Capture', 'Exterminate', 'Sabotage', 'Rescue'] },
    drop: { kind: 'fixed', n: 1, perPlayer: true, label: 'Relics opened each run', note: 'One per player, and you pick from all of them' },
    price: { kind: 'unknown', label: 'Platinum expected per relic', why: 'No relic has been priced yet — open one under Relic value and this fills in' },
  },
  'relic-farm': {
    timing: { kind: 'missionTypes', names: ['Defense', 'Survival', 'Disruption', 'Interception'] },
    drop: { kind: 'fixed', n: 1, label: 'Relics per qualifying rotation', note: 'One relic from the rotations that carry them' },
    price: { kind: 'market', slugs: ['axi_a1_relic', 'meso_b1_relic', 'lith_a1_relic'], label: 'Platinum per relic' },
  },
  'sell-relics': {
    timing: { kind: 'noMission', note: 'Listing a relic takes no mission at all — the limit is your daily trades, not your time' },
    drop: { kind: 'fixed', n: 6, label: 'Relics per trade', note: 'Six items a side, per trade' },
    price: { kind: 'market', slugs: ['axi_a1_relic', 'meso_b1_relic', 'lith_a1_relic'], label: 'Platinum per relic' },
    cap: 'Bounded by your daily trades, not by hours played',
  },

  /* ------------------------------------------------------------- the mods */
  'corrupted-mods': {
    timing: { kind: 'missionTypes', names: ['Sabotage', 'Exterminate', 'Survival'] },
    drop: { kind: 'chance', percent: 4.17, label: 'Chance of a corrupted mod', note: 'The Derelict vault table is 24 mods at 4.17 per cent each' },
    price: { kind: 'market', slugs: ['narrow_minded', 'blind_rage', 'transient_fortitude', 'fleeting_expertise'], label: 'Platinum per corrupted mod' },
  },
  'nightmare-mods': {
    timing: { kind: 'overall' },
    drop: { kind: 'fixed', n: 1, label: 'Mods per nightmare mission', note: 'A nightmare mission pays one mod from its table on completion' },
    price: { kind: 'market', slugs: ['blaze', 'wildfire', 'hammer_shot', 'stunning_speed'], label: 'Platinum per nightmare mod' },
  },
  'necramech-mods': {
    timing: { kind: 'missionTypes', names: ['Free Roam', 'Survival', 'Exterminate'] },
    drop: { kind: 'fixed', n: 1, label: 'Mods per vault run', note: 'The Isolation Vault tiers each pay from the Necramech mod table' },
    price: { kind: 'market', slugs: ['necramech_vitality', 'necramech_steel_fiber', 'necramech_continuity'], label: 'Platinum per Necramech mod' },
  },
  'kahl-mods': {
    timing: { kind: 'noMission', note: "Kahl's mission is weekly and its own thing; the Stock it pays converts at Chipper's fixed prices" },
    drop: { kind: 'fixed', n: 1, label: 'Archon mods per week of Stock', note: "Chipper's prices are fixed, so a week's Stock buys a known number" },
    price: { kind: 'market', slugs: ['archon_vitality', 'archon_continuity', 'archon_stretch'], label: 'Platinum per Archon mod' },
    cap: 'Once a week — the Stock cap, not your effort, is the limit',
  },
  'primed-mods': {
    timing: { kind: 'noMission', note: 'Bought from Baro at a relay; no mission is involved' },
    drop: { kind: 'fixed', n: 1, label: 'Primed mods per purchase', note: 'Bounded by the ducats you brought, not by time' },
    price: { kind: 'market', slugs: ['primed_continuity', 'primed_flow', 'primed_pressure_point'], label: 'Platinum per primed mod' },
    cap: 'Only while Baro is docked, once a fortnight',
  },
  'rare-mods': {
    timing: { kind: 'overall' },
    /*
     * No single chance exists here, and the old 2 per cent was invented.
     * Measured: 25 rare mod rows spanning 1 to 9.8 per cent across ten distinct
     * values, which depend entirely on which enemy you are farming. One number
     * would describe none of them.
     */
    drop: { kind: 'fixed', n: 1, label: 'Rare mods per drop', note: 'One mod, when one drops' },
    price: {
      kind: 'unknown',
      label: 'Chance of the mod you want',
      why:
        'Rare mod chances are per-enemy, not per-route: 25 rare mod rows span 1 to 9.8 per cent across ten different ' +
        'values. Pick the mod you actually want and the drop tables give its own rate; a rate for "rare mods" in ' +
        'general would be an average of enemies you will never fight together.',
    },
  },

  /* --------------------------------------------------------- the arcanes */
  eidolon: {
    timing: { kind: 'missionTypes', names: ['Free Roam'] },
    /*
     * Was "4 arcanes per hunt", which was invented and - worse - rendered as
     * MEASURED, because every fixed count is. How many a night pays depends on
     * how many of the three Eidolons the squad captures and on the rolls after
     * each, and no source publishes a per-hunt figure.
     */
    drop: { kind: 'fixed', n: 1, label: 'Arcanes per drop', note: 'One arcane, per drop' },
    price: {
      kind: 'unknown',
      label: 'Arcanes a night actually pays',
      why:
        'It depends on how many of the three Eidolons your squad captures and on the rolls after each, and no source ' +
        'publishes a per-hunt figure. The arcanes themselves price fine under Sell what you hold once you have some.',
    },
    cap: 'Night only — a fifty-minute window in every two-and-a-half-hour cycle',
  },
  'iso-arcanes': {
    timing: { kind: 'missionTypes', names: ['Free Roam'] },
    drop: { kind: 'fixed', n: 1, label: 'Arcanes per vault run', note: 'The Arcana bounty tiers carry 72 arcane entries across three tiers' },
    price: { kind: 'market', slugs: ['arcane_blessing', 'arcane_avenger', 'arcane_ice'], label: 'Platinum per vault arcane' },
  },
  'zariman-arcanes': {
    timing: { kind: 'missionTypes', names: ['Exterminate', 'Survival', 'Defense', 'Alchemy'] },
    drop: {
      kind: 'chance',
      percent: 18.37,
      label: 'Chance of an arcane, from a Void Angel',
      note:
        'summed over the Void Angel table. The source matters and is named on purpose: a Ravenous Void Angel is 7.37 ' +
        'and a Thrax 3.63, so a single figure for "the Zariman" would describe none of them',
    },
    price: { kind: 'market', slugs: ['molt_efficiency', 'emergence_dissipate', 'molt_vigor'], label: 'Platinum per Zariman arcane' },
  },

  /* -------------------------------------------------------- everything else */
  'ayatan-stars': {
    timing: { kind: 'overall' },
    drop: { kind: 'fixed', n: 1, label: 'Stars per drop', note: 'One star, per drop' },
    price: {
      kind: 'unknown',
      label: 'Stars you pick up in a run',
      why:
        'Stars fall from containers and enemies at rates that differ by tileset and by how thoroughly you loot, and ' +
        'nothing publishes a per-run count. Your own mission log will answer this once it has recorded enough runs.',
    },
  },
  ayatan: {
    timing: { kind: 'overall' },
    drop: { kind: 'chance', percent: 5.95, label: 'Chance of a sculpture', note: 'the measured rate on the rotation tables that carry them, not a round number' },
    price: { kind: 'market', slugs: ['ayatan_anasa_sculpture', 'ayatan_orta_sculpture'], label: 'Platinum per sculpture' },
  },
  'maroo-ayatan': {
    /*
     * NOT timed by mission type. `Ayatan Sculpture Hunt` is not a type the
     * star chart carries - and a run's type comes only from the chart, so a
     * name outside its vocabulary matches nothing, ever. This route listed it
     * beside `Extermination`, itself a typo for `Exterminate`, so BOTH names
     * were dead and the route could never show a measured rate at all.
     */
    timing: { kind: 'noMission', note: 'Maroo’s hunt is weekly and is not a mission type the star chart names' },
    drop: { kind: 'fixed', n: 1, label: 'Sculptures per hunt', note: 'Guaranteed — the mission is built around finding exactly one' },
    price: { kind: 'market', slugs: ['ayatan_anasa_sculpture', 'ayatan_orta_sculpture'], label: 'Platinum per sculpture' },
    cap: 'Once a week',
  },
  'fish-whole': {
    timing: { kind: 'missionTypes', names: ['Free Roam'] },
    drop: { kind: 'fixed', n: 1, label: 'Fish per catch', note: 'One fish, per catch' },
    price: {
      kind: 'unknown',
      label: 'Fish you land in a trip',
      why:
        'How many you land depends on your spear, your bait, the water and the time of day, and no table states a ' +
        'per-trip figure. The fish themselves price fine once caught.',
    },
  },
  'gems-cut': {
    timing: { kind: 'missionTypes', names: ['Free Roam'] },
    drop: { kind: 'fixed', n: 1, label: 'Gems per vein', note: 'One gem, per vein cut' },
    price: {
      kind: 'unknown',
      label: 'Rare gems you find in a trip',
      why:
        'Vein spawns are random per instance and the rare ones are a small share of them; no published table gives a ' +
        'per-trip count. The cut gems price fine once you have them.',
    },
  },
  'focus-lenses': {
    timing: { kind: 'missionTypes', names: ['Assassination', 'Exterminate', 'Survival'] },
    drop: { kind: 'fixed', n: 1, label: 'Lenses per sortie', note: 'Lenses sit in the sortie and bounty reward tables' },
    price: { kind: 'market', slugs: ['eidolon_madurai_lens', 'madurai_lens', 'naramon_lens'], label: 'Platinum per lens' },
    cap: 'The sortie is once a day',
  },
  captura: {
    timing: { kind: 'overall' },
    /*
     * The old 3 per cent was invented. Measured: 63 scene rows at rates that
     * differ by source - 7.14 on some tilesets, 2.51 on others - so which scene
     * you are after decides the rate entirely.
     */
    drop: { kind: 'fixed', n: 1, label: 'Scenes per drop', note: 'One scene, when one drops' },
    price: {
      kind: 'unknown',
      label: 'Chance of the scene you want',
      why:
        'Scene rates are per-source, not per-route: 63 scene rows run from 2.51 to 7.14 per cent depending on where ' +
        'they drop. Choose the scene and its own table gives the rate.',
    },
  },
  'requiem-relics': {
    timing: { kind: 'missionTypes', names: ['Capture', 'Exterminate', 'Survival'] },
    drop: { kind: 'fixed', n: 1, perPlayer: true, label: 'Requiem relics opened each run', note: 'One per player' },
    price: { kind: 'market', slugs: ['oull', 'xata', 'jahu', 'vome'], label: 'Platinum per Requiem mod' },
  },
  'syndicate-weapons': {
    timing: { kind: 'noMission', note: 'These come from vendors and events, not from a repeatable mission' },
    drop: { kind: 'fixed', n: 1, label: 'Variants per acquisition', note: 'One at a time, and only when one is offered' },
    price: { kind: 'market', slugs: ['prisma_grakata', 'vulkar_wraith', 'viper_wraith'], label: 'Platinum per variant' },
    cap: 'Only when Baro or an event offers one',
  },
  imprints: {
    timing: { kind: 'noMission', note: 'Imprinting happens in your orbiter; incubation time, not mission time, sets the pace' },
    drop: { kind: 'fixed', n: 2, label: 'Imprints per companion', note: "Two per companion - the game's own limit, not an estimate" },
    price: { kind: 'market', slugs: ['chesa_kubrow_imprint', 'huras_kubrow_imprint'], label: 'Platinum per imprint' },
    cap: 'Incubation time, not your effort, sets the pace',
  },
  onslaught: {
    timing: { kind: 'missionTypes', names: ['Sanctuary Onslaught', 'Exterminate'] },
    drop: { kind: 'fixed', n: 1, label: 'Rewards per elite rotation', note: 'Elite Sanctuary Onslaught pays from its own rotation table' },
    price: { kind: 'market', slugs: ['peculiar_bloom', 'peculiar_growth'], label: 'Platinum per reward' },
  },
  'arcane-helmets': {
    timing: { kind: 'noMission', note: 'They have not dropped for many years; the only supply is what players already hold' },
    drop: { kind: 'fixed', n: 1, label: 'Helmets per trade', note: 'One at a time, bought from another player' },
    price: { kind: 'market', slugs: ['arcane_vanguard_helmet', 'arcane_thrak_helmet'], label: 'Platinum per helmet' },
    cap: 'No longer obtainable in game',
  },

  /* ---------------------------------------- the ones that genuinely refuse */
  'riven-sortie': {
    timing: { kind: 'missionTypes', names: ['Assassination', 'Exterminate', 'Survival', 'Defense'] },
    drop: { kind: 'chance', percent: 28, label: 'Chance of a Riven', note: 'The sortie reward table carries a Riven at 28 per cent' },
    price: { kind: 'unknown', label: 'Platinum per Riven', why: 'A Riven is priced by its ROLL, not by its weapon, and no feed publishes what an unrolled one is worth. Two Rivens for the same weapon can differ by a factor of a hundred.' },
    cap: 'Once a day',
  },
  'riven-duviri-endless': {
    timing: { kind: 'missionTypes', names: ['Survival', 'Defense'] },
    drop: { kind: 'chance', percent: 31.3, label: 'Chance of a Riven at tier six', note: 'Melee 11.9, Pistol 8.5, Rifle 8.5, Zaw 1.2, Kitgun 1.2 — summed' },
    price: { kind: 'unknown', label: 'Platinum per Riven', why: 'Riven value is set by the roll. No published feed prices an unrolled one.' },
  },
  'riven-reroll': {
    timing: { kind: 'noMission', note: 'Rerolling happens at your mod station and costs Kuva, not time' },
    drop: { kind: 'fixed', n: 1, label: 'Rerolls per attempt', note: 'One roll, one Kuva cost' },
    price: { kind: 'unknown', label: 'Platinum gained per reroll', why: 'A reroll can raise or destroy the value, and the distribution of outcomes is not published.' },
  },
  'baro-flip': {
    timing: { kind: 'noMission', note: 'Bought at a relay kiosk; no mission is involved' },
    drop: { kind: 'fixed', n: 1, label: 'Items per purchase', note: 'Bounded by the ducats you brought' },
    price: { kind: 'unknown', label: 'Platinum per item', why: "Baro's stock is not published until he lands, so nothing can be ranked in advance. Once he arrives, each item can be compared to its market price." },
    cap: 'Forty-eight hours, once a fortnight',
  },
  'holdfasts-arcanes': {
    timing: { kind: 'noMission', note: 'Bought outright from Cavalero for standing' },
    drop: { kind: 'fixed', n: 1, label: 'Arcanes per purchase', note: 'A fixed standing price, no drop chance involved' },
    price: { kind: 'unknown', label: 'Platinum per point of standing', why: 'Priced exactly under Spend your standing, which ranks all 861 offerings against their published standing cost — this chain would only duplicate it less precisely.' },
  },
  augments: {
    timing: { kind: 'noMission', note: 'Bought from a syndicate for standing' },
    drop: { kind: 'fixed', n: 1, label: 'Augments per purchase', note: 'Every faction augment is exactly 25,000 standing' },
    price: { kind: 'unknown', label: 'Platinum per point of standing', why: 'Priced exactly under Spend your standing, against every syndicate at once.' },
  },
  'conclave-augments': {
    timing: { kind: 'noMission', note: 'Bought from Teshin for Conclave standing' },
    drop: { kind: 'fixed', n: 1, label: 'Augments per purchase', note: 'A separate standing pool that nothing else draws on' },
    price: { kind: 'unknown', label: 'Platinum per point of standing', why: 'Priced exactly under Spend your standing, which carries all 117 Conclave offerings.' },
  },
};

/** Routes with no model at all, and the reason. Every one is a finding. */
export const MODEL_GAPS: Record<string, string> = {
  ducats:
    'Ducats are their own currency with their own loop, and converting them to platinum here would hide a made-up exchange rate inside a measured figure. Modelled properly, in ducats, under the Ducats section.',
  vaulted: 'A holding strategy, not an activity — there is no per-hour rate for waiting.',
  resurgence:
    'Varzia is in no syndicate export - checked against all 39 - so her Aya prices are not published anywhere this app may read, and how fast you gather Aya depends on which bounties you run.',
  'void-storms': 'Void Storms pay the same relic table as ordinary fissures — the fissure row already covers it.',
  flipping: 'Buying low and selling high has no yield per hour; it is bounded by your capital and by how long a listing sits.',
  'sets-vs-parts': 'Set assembly is an arbitrage on prices you already hold, not an activity with a rate.',
  galvanized:
    'The 12 Galvanized mods DO sell, but their cost does not: the Arbitration Honors vendor charges Vitus Essence and appears in no syndicate export - checked against all 39. Without a published price there is no conversion to state.',
  'invasion-rewards':
    'Rotates every few hours, and most invasions pay Forma, which nobody can sell - so a standing rate would average a rotation you will never actually meet. What IS answerable is which of the ones running RIGHT NOW pay something tradeable, and that is shown live under Ways to earn.',
  'nightwave-cred': 'Cred comes from completing specific acts, not at a rate per hour.',
  'lich-weapons': 'A Kuva weapon cannot be sold as an item — no Kuva weapon appears on the market. What trades is the converted lich, and no feed prices those.',
  'sister-weapons': 'Same as liches: the weapon is untradeable and only the converted Sister changes hands, unpriced.',
  'coda-weapons': 'Same again — the weapon is bound to the account.',
  'steel-essence': 'Steel Essence is untradeable, and no published table converts it to platinum through what it buys.',
  'profit-taker': 'This route pays credits, which fund your trade tax. Credits are not platinum and are deliberately not converted to it.',
  'riven-archon': 'Pays nothing tradeable.',
  'riven-circuit': 'Pays nothing tradeable.',
  ephemera: 'Pays nothing tradeable.',
  holokeys: 'Pays nothing tradeable.',
};

/* ------------------------------------------------------------ evaluation */

export type PriceBook = ReadonlyMap<string, Price>;

/**
 * How long ONE run of a route takes this player.
 *
 * The same measurement the rate engine already makes, exposed so a plan can say
 * "four runs" instead of "forty minutes" - a number of runs is something you can
 * count while playing, and forty minutes is something you have to watch a clock
 * for.
 *
 * A NODE IS DELIBERATELY NOT RETURNED, and an earlier version of this function
 * did return one. It picked the node with the most runs of any of the route's
 * mission types, and the card presented that as "where you usually run it" -
 * but nothing in a mission record says whether a run was a fissure, a bounty or
 * an ordinary mission. A player who farms Adaro for focus was told the fissure
 * destination was Adaro, which is not a fissure node and never has been. Two
 * routes sharing `['Bounty', 'Free Roam']` sent Isolation Vault arcanes to the
 * Plains. The claim the function computed was "where you run missions of these
 * types most", the claim the card made was "where you run this route", and no
 * data in this app can close that gap. So the destination is the route table's
 * own words, which are correct, and this returns only the timing.
 */
export function minutesPerRunFor(routeId: string, obs: Observed): number | null {
  const model = MODELS[routeId];
  if (!model || model.timing.kind !== 'missionTypes') return null;
  for (const name of model.timing.names) {
    const t = obs.byType.get(name);
    if (t) return t.minutes;
  }
  return null;
}

/**
 * HOW MANY RUNS THE MEDIAN ABOVE IS MADE OF.
 * ————————————————————————————————————————————
 * `minutesPerRunFor` finds a `Timing` and returns its `minutes`, dropping the
 * `runs` beside it - the sample size the whole file exists to carry. Its own
 * header says "every field carries the run count so no single unusual run can
 * pass itself off as a rate", and then the one function the panel actually
 * calls threw that count away.
 *
 * Same lookup, same order, so the count returned is always the count behind the
 * median returned - never a different mission type's.
 */
export function runsTimedFor(routeId: string, obs: Observed): number | null {
  const model = MODELS[routeId];
  if (!model || model.timing.kind !== 'missionTypes') return null;
  for (const name of model.timing.names) {
    const t = obs.byType.get(name);
    if (t) return t.runs;
  }
  return null;
}

export function representativeSlugs(): string[] {
  const out = new Set<string>();
  for (const model of Object.values(MODELS)) {
    if (model.price.kind === 'market') for (const s of model.price.slugs) out.add(s);
  }
  return [...out];
}

/**
 * The timing this route should be measured by: the best-SAMPLED named type.
 *
 * ONE implementation, because there were two and they were the same rule.
 * `timingLink` picked a type for the rate and picked one AGAIN, separately, for
 * the note that tells an overriding player what the measured figure was - both
 * with `.find`, both taking whichever name happened to be listed first.
 *
 * Sample size decides rather than a median across types: these are DIFFERENT
 * missions, and averaging a four-minute Capture with a twenty-minute Survival
 * describes neither. The one you have actually run is the one that predicts
 * your next hour.
 */
function bestSampled(timing: TimingModel, obs: Observed): Timing | null {
  if (timing.kind === 'overall') return obs.overall;
  if (timing.kind === 'noMission') return null;
  return (
    timing.names
      .map((n) => obs.byType.get(n))
      .filter((t): t is Timing => t !== undefined)
      .sort((a, b) => b.runs - a.runs)[0] ?? null
  );
}

/**
 * The share of these runs the account actually finishes, as a chain link.
 *
 * WHY THIS BELONGS IN THE CHAIN AND NOT BESIDE IT
 * ──────────────────────────────────────────────
 * The chain is a product: runs an hour, times items a run, times platinum an
 * item. Every one of those is a measured or published quantity, and the answer
 * it produces is "platinum an hour IF THE RUN LANDS". For a player who finishes
 * everything that distinction is empty. For one who abandons half their
 * Survivals it is the difference between the number on screen and the platinum
 * that reaches their inventory.
 *
 * A fourth term is the honest place for it, because the chain is already the
 * panel's own explanation of where the figure came from — the link appears in
 * the working with its own provenance and its own sample size, rather than
 * silently scaling a number the reader is shown the derivation of.
 *
 * RETURNS NULL RATHER THAN A LINK WHEN UNMEASURED, and that is load-bearing:
 * `evaluate` blocks the whole chain on any link whose value is null, so a link
 * that means "we have not watched you play this" would refuse to quote a rate
 * at all. Absent, the chain is exactly the three terms it always was.
 */
function finishLink(timing: TimingModel, obs: Observed): Link | null {
  const picked = bestSampled(timing, obs);
  const finished = picked?.finished ?? null;
  if (finished === null) return null;

  /*
   * A perfect record is not reported. It multiplies by one, so it changes no
   * figure, and a link reading "100 per cent of runs finish" in the working of
   * every route would be four words of noise on every card that has them.
   */
  if (finished.rate >= 1) return null;

  return {
    label: 'Runs you finish',
    value: finished.rate,
    from: 'measured',
    note:
      `${String(Math.round(finished.rate * 100))} per cent of your ${String(finished.decided)} ` +
      `recorded runs of this kind ended in success - the rest paid nothing`,
    unit: 'of runs',
  };
}

/** The timing link, and how many of your runs it rests on. */
function timingLink(
  timing: TimingModel,
  obs: Observed,
  override: number | undefined,
): { link: Link; runs: number | null; overridden: boolean } {
  /*
   * An override replaces the VALUE and never the record: the measured figure
   * stays in the note so the reader can see what they changed and by how much.
   */
  if (override !== undefined && timing.kind !== 'noMission') {
    const measuredPick = bestSampled(timing, obs);
    return {
      link: {
        label: 'Runs an hour',
        value: 60 / Math.max(0.5, override),
        from: 'yours',
        note: measuredPick
          ? `${String(override)} minutes, your figure. Your own ${String(measuredPick.runs)} recorded ${measuredPick.runs === 1 ? 'run' : 'runs'} median ${String(measuredPick.minutes)} minutes.`
          : `${String(override)} minutes, your figure. Nothing in your log covers this yet.`,
        unit: 'runs/hr',
      },
      runs: measuredPick?.runs ?? null,
      overridden: true,
    };
  }

  if (timing.kind === 'noMission') {
    return {
      link: { label: 'No mission to time', value: 1, from: 'measured', note: timing.note, unit: 'per act' },
      runs: null,
      overridden: false,
    };
  }

  /*
   * THE BEST-SAMPLED TYPE, NOT THE FIRST ONE LISTED.
   * ————————————————————————————————————————————
   * This was `.find((t) => t !== undefined)`, which took whichever named
   * mission type happened to appear first in the model and ignored every other
   * - so a route naming Bounty, Survival and Extermination was timed from two
   * Bounty runs while forty Survivals sat unread beside them.
   *
   * `priceLink` in this same file already refuses that exact move, in as many
   * words: "Taking the first would let the order of the list decide the answer,
   * and every list here was written best-first by accident of how it was
   * researched." The reasoning transfers whole and had not been applied here.
   *
   * Sample size is the tiebreak rather than a median across types, because
   * these are DIFFERENT missions and averaging a four-minute Capture with a
   * twenty-minute Survival describes neither. The one you have actually run is
   * the one that predicts your next hour.
   */
  const pick = bestSampled(timing, obs);

  if (!pick) {
    return {
      link: {
        label: 'Runs an hour',
        value: null,
        from: 'unknown',
        note:
          obs.totalRuns === 0
            ? 'No runs recorded yet. Play with the overlay open and this fills in from your own missions — nothing here is guessed on your behalf.'
            : timing.kind === 'overall'
              ? 'None of your recorded runs carried a usable duration.'
              : `None of your recorded runs were ${timing.names.slice(0, 3).join(', ')} — run one and this fills in.`,
        unit: 'runs/hr',
      },
      runs: null,
      overridden: false,
    };
  }

  const basis = timing.kind === 'overall' ? 'across every run you have logged' : 'from your own runs of this type';
  return {
    link: {
      label: 'Runs an hour',
      value: 60 / Math.max(0.5, pick.minutes),
      from: 'measured',
      note: `${String(pick.minutes)} minutes median, ${basis} (${String(pick.runs)} ${pick.runs === 1 ? 'run' : 'runs'})`,
      unit: 'runs/hr',
    },
    runs: pick.runs,
    overridden: false,
  };
}

/**
 * How many of the thing a run produces.
 *
 * EVERY BRANCH OF THIS RETURNED `from: 'measured'`, AND NOT ONE OF THEM IS.
 * ────────────────────────────────────────────────────────────────────────
 * The values come from `DropModel`, which is a table in this file: a squad rule
 * ("one relic per player"), or a published drop chance. They are facts about
 * the game and they are worth having - but the panel was printing "measured"
 * beneath them, one column away from a link that really did come from the
 * player's own runs, with no way for a reader to tell the two apart.
 *
 * This is the middle term of every rate the panel quotes, so it was the single
 * largest borrowed authority in the chain.
 *
 * WHAT IT IS NOT: a measurement waiting to happen. Measuring drops per run from
 * the mission log is possible in principle - `MissionRecord.loot` carries
 * attributed items - but `DropModel` names no item type, and the only bridge
 * from a route to an item id runs through display names, which this codebase
 * has been burned by before. Until that join exists, the honest move is to say
 * where the number is from, not to invent a way of pretending it is yours.
 *
 * `perPlayer` is the one branch with a genuine YOURS component: the squad size
 * multiplying it is the player's own setting.
 */
export function dropLink(drop: DropModel, squad: number): Link {
  switch (drop.kind) {
    case 'fixed': {
      if (drop.perPlayer !== true) {
        return { label: drop.label, value: drop.n, from: 'published', note: drop.note, unit: 'items/hr' };
      }
      return {
        label: drop.label,
        value: drop.n * squad,
        from: 'yours',
        note: `${drop.note} — ${String(squad)} ${squad === 1 ? 'player' : 'players'}, which is your choice above`,
        unit: 'items/hr',
      };
    }
    case 'chance':
      return {
        label: drop.label,
        value: drop.percent / 100,
        from: 'published',
        note: `${String(drop.percent)} per cent — ${drop.note}`,
        unit: 'items/hr',
      };
  }
}

function priceLink(price: PriceModel, pref: Preference, book: PriceBook): { link: Link; volume: number | null } {
  if (price.kind === 'unknown') {
    return { link: { label: price.label, value: null, from: 'unknown', note: price.why, unit: 'plat/hr' }, volume: null };
  }
  /*
   * The MEDIAN across the representatives, not the first one that has a quote.
   *
   * Taking the first would let the order of the list decide the answer, and
   * every list here was written best-first by accident of how it was researched
   * - so `oull` would have priced the whole Requiem route at the value of its
   * rarest member. A median over what actually traded is the honest stand-in for
   * "a typical drop from this table".
   */
  const quotes = price.slugs.map((slug) => book.get(slug)).filter((q): q is Price => q !== undefined);
  if (quotes.length > 0) {
    const medians = quotes.map((q) => q.median).sort((a, b) => a - b);
    const mid = Math.floor(medians.length / 2);
    const lo = medians[mid - 1];
    const hi = medians[mid];
    const typical =
      medians.length % 2 === 1 ? (medians[mid] ?? 0) : lo === undefined || hi === undefined ? (hi ?? lo ?? 0) : (lo + hi) / 2;
    const volume = quotes.reduce((n, q) => n + q.volume, 0);

    /*
     * The liquidity floor. A high median on two sales in ninety days is not
     * income, and the player sets where that line is rather than the app
     * assuming one.
     */
    if (volume < pref.minVolume) {
      return {
        volume,
        link: {
          label: price.label,
          value: null,
          from: 'unknown',
          note: `${String(volume)} trades a day, below the floor of ${String(pref.minVolume)} you set. The price exists; the demand to realise it does not.`,
          unit: 'plat/hr',
        },
      };
    }

    return {
      volume,
      link: {
        label: price.label,
        value: Math.round(typical * 100) / 100,
        from: 'measured',
        note:
          `${String(Math.round(typical * 100) / 100)}p, the median across ${String(quotes.length)} representative ` +
          `${quotes.length === 1 ? 'item' : 'items'} of this table (${String(volume)} trades a day between them). ` +
          'Not the best of them - the middle one, so the order of the list cannot decide the answer.',
        unit: 'plat/hr',
      },
    };
  }
  return {
    volume: null,
    link: {
      label: price.label,
      value: null,
      from: 'unknown',
      note: 'Not priced yet — nothing here has been quoted, which is different from being worthless',
      unit: 'plat/hr',
    },
  };
}

export function chainFor(
  routeId: string,
  obs: Observed,
  pref: Preference,
  book: PriceBook,
): { chain: Chain; runs: number | null; itemsPerHour: number | null; volume: number | null; overridden: boolean } | null {
  const model = MODELS[routeId];
  if (!model) return null;

  const timing = timingLink(model.timing, obs, pref.timingOverride.get(routeId));
  const drop = dropLink(model.drop, pref.squad);
  const price = priceLink(model.price, pref, book);

  // Items an hour is the product of the first two links, when both are known.
  const itemsPerHour = timing.link.value !== null && drop.value !== null ? timing.link.value * drop.value : null;

  /*
   * The finish rate joins the product when there is one to join it. Placed
   * after the timing it qualifies and before the drop, so the working reads in
   * the order a run actually happens: this often, this much of the time it
   * lands, this many items, this much each.
   */
  const finish = finishLink(model.timing, obs);

  return {
    chain: {
      routeId,
      cap: model.cap ?? null,
      links: finish === null ? [timing.link, drop, price.link] : [timing.link, finish, drop, price.link],
    },
    runs: timing.runs,
    itemsPerHour,
    volume: price.volume,
    overridden: timing.overridden,
  };
}

/**
 * Every modelled route, rated and ordered by whichever axis the player chose.
 *
 * Filtering happens here rather than in the view so that the count the panel
 * reports and the rows it draws can never disagree.
 */
export function rateAll(obs: Observed, pref: Preference, book: PriceBook): Rate[] {
  const out: Rate[] = [];
  for (const id of Object.keys(MODELS)) {
    const built = chainFor(id, obs, pref, book);
    if (!built) continue;
    const rate = evaluate(built.chain, built.runs, {
      itemsPerHour: built.itemsPerHour ?? undefined,
      volume: built.volume ?? undefined,
      overridden: built.overridden,
    });
    if (!pref.includeCapped && rate.cap !== null) continue;
    if (!pref.includeBlocked && rate.perHour === null) continue;
    out.push(rate);
  }

  const key = (r: Rate): number => {
    if (pref.sort === 'perTrade') return r.perTrade ?? -1;
    if (pref.sort === 'liquidity') return r.volume ?? -1;
    return r.perHour ?? -1;
  };
  return out.sort((a, b) => key(b) - key(a) || a.routeId.localeCompare(b.routeId));
}
