/**
 * From "platinum an hour if you run it" to "platinum in your hand tonight".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS: A SCORE IN NO UNITS CANNOT BE WRONG.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The ranking used to be a sum of about thirty hand-picked constants. Being
 * live was `+4 x slider`. Selling slowly was `-1.5 x slider`. A quest gate was
 * `-8`; missing the gear was `-14`. None of those is measured in anything, so
 * no observation could ever contradict a single one of them - which sounds like
 * safety and is the opposite. A number that cannot be wrong cannot be right,
 * and cannot be improved except by argument.
 *
 * Worse, a sum lets any requirement be outvoted. That is not a theory: the
 * session-fit table in `plat-rank` carries a comment recording that its numbers
 * were GENTLE NUDGES at first, that a route wanting a whole evening kept
 * outranking instant routes for a player who had said they had ten minutes, and
 * that the fix was to make the penalty bigger - up to -16. Nothing stops the
 * next term added from growing past sixteen. The identical defect was found and
 * fixed for gear (-14, "decisive" in prose and outvotable in arithmetic) by
 * making it an ORDERING instead. This file finishes that job for the rest.
 *
 * ── THE INSIGHT ────────────────────────────────────────────────────────────
 *
 * Every one of those constants is secretly a statement about ONE quantity:
 *
 *     platinum that ends up in your hand, per hour of the session you actually
 *     have, on the account you actually have
 *
 * `plat-throughput` already computes the first half of that - platinum an hour
 * IF the run happens and IF you sell what drops - as a product of links, each
 * carrying its provenance. It stops at the point where the world stops being
 * about the route and starts being about the player.
 *
 * This file is the second half of the same chain. It does not score anything.
 * It multiplies that rate by the fraction of it you will really realise, and
 * every factor is a quantity somebody could go and check:
 *
 *     "you have 3 trades left and this hour produces 8 trades' worth,
 *      so you can realise three eighths of it today"
 *
 * That sentence is falsifiable. `-1 x wantBigTicket` is not.
 *
 * ── GATES ARE NOT FACTORS, AND FACTORS ARE NOT SCORES ──────────────────────
 *
 * Three kinds of thing live here and they are deliberately different shapes:
 *
 *   GATE      the route yields NOTHING right now. A closed world window, a
 *             cycle longer than the session. Not a large negative - a zero,
 *             which no positive can outvote, because it multiplies.
 *   FACTOR    a fraction in [0,1] of the rate that survives. Multiplies.
 *   UNKNOWN   applicable, but not measurable here. Every factor is a fraction
 *             in [0,1], so a term nobody could evaluate can only ever have
 *             REDUCED the answer - which makes what is left an UPPER BOUND
 *             rather than an unknown. The estimate stands, flagged `atMost`,
 *             and the panel says "up to".
 *
 *             This started out stopping the estimate dead, on the same
 *             discipline `evaluate` applies to the throughput chain, and
 *             LOOKING AT THE RUNNING APP is what showed it was wrong. With no
 *             account captured - the ordinary state with the game closed -
 *             `tradesLeft` is null, so every route with a measured trade cost
 *             was blocked, and a route measured at 172 platinum an hour from
 *             nine real runs sat below routes nobody had ever run. Discarding a
 *             good measurement for want of a secondary fact is not caution.
 *
 *             The distinction from `evaluate` is real: a missing PRICE means
 *             the platinum figure cannot be computed at all, while a missing
 *             trade count only means it cannot be sharpened. "Up to 60" and
 *             "60" are different claims, and stating the weaker one is the
 *             honest move - stating neither is just silence.
 *
 * And a fourth state that is none of those: NOT APPLICABLE. A route that sells
 * nothing per-item has no trade-capacity factor at all - that is not an unknown
 * trade count, it is a factor that does not exist for this route. Conflating
 * the two is the "absent means zero" mistake this whole app is built against,
 * applied one level up: to the reasoning rather than to the data.
 *
 * ── WHAT THIS DOES NOT CLAIM ───────────────────────────────────────────────
 *
 * The published fractions below (liquidity, gear bracket, solo) are still
 * chosen numbers. The difference from what they replace is not that they are
 * derived - it is that each now CLAIMS SOMETHING CHECKABLE. "About a third of a
 * slow-selling haul converts inside one session" is a sentence a player can
 * contradict with their own sale times, and the day this app measures sale
 * latency it replaces that constant with the measurement and nothing above it
 * changes shape. "-1.5 points" claims nothing, so nothing can ever replace it.
 */

import type { Link, Rate } from './plat-throughput.ts';
import type { Cycle, Liquidity, PlatRoute, Squad } from './plat-routes.ts';

/** How long the player says they have. Mirrors `plat-rank`'s own vocabulary. */
export type SessionLength = 'quick' | 'hour' | 'evening' | 'any';

/**
 * One factor's verdict, in the four states the reasoning actually has.
 *
 * `notApplicable` is why this is not simply `number | null`. A route with no
 * per-item sales has no trade-capacity factor; a route with an unread trade
 * count has one that cannot be evaluated. Both would be `null`, and they must
 * lead to opposite outcomes - the first is ignored, the second stops the
 * estimate.
 */
export type Factor =
  | { kind: 'factor'; value: number; link: Link }
  | { kind: 'gate'; link: Link }
  | { kind: 'unknown'; link: Link }
  | { kind: 'notApplicable' };

const NA: Factor = { kind: 'notApplicable' };

/*
 * THE PROVENANCE IS PASSED IN, BECAUSE THESE FACTORS DO NOT ALL HAVE THE SAME
 * ONE - AND THIS FILE SHIPPED CLAIMING THEY DID.
 * ───────────────────────────────────────────────────────────────────────────
 * Every helper here hard-coded `from: 'measured'`, so the published constants
 * below - the liquidity share, the bracket survival rate, the solo completion
 * rate - were labelled exactly like the trade factor, which is computed from
 * two real numbers off the account. That is the same borrowed authority this
 * file's own header objects to in the ranking it replaced, committed in the
 * replacement, one screen further down.
 */
const factor = (value: number, from: Link['from'], label: string, note: string): Factor => ({
  kind: 'factor',
  value,
  link: { label, value, from, note, unit: 'of the rate' },
});

const gate = (from: Link['from'], label: string, note: string): Factor => ({
  kind: 'gate',
  link: { label, value: 0, from, note, unit: 'of the rate' },
});

const unknown = (label: string, note: string): Factor => ({
  kind: 'unknown',
  link: { label, value: null, from: 'unknown', note, unit: 'of the rate' },
});

// ───────────────────────────────────────────────────────────────────────────
// the factors
// ───────────────────────────────────────────────────────────────────────────

/** Both vocabularies are ordered, and the ordering is the whole comparison. */
const CYCLE_ORDER: readonly Cycle[] = ['instant', 'short', 'medium', 'long', 'session'];
const SESSION_FITS: Record<Exclude<SessionLength, 'any'>, Cycle> = {
  quick: 'short',
  hour: 'medium',
  evening: 'session',
};

/**
 * Does one productive cycle fit in the time the player says they have?
 *
 * THIS IS A GATE, AND THE TWENTY-NUMBER TABLE IT REPLACES WAS NOT.
 * ───────────────────────────────────────────────────────────────
 * That table gave every (session, cycle) pair a score between +4 and -16, and
 * its own comment records that the numbers had to be RAISED because a route
 * wanting a whole evening kept winning anyway. That is the tell: a constant
 * chosen to beat the other constants was chosen against the arithmetic rather
 * than against the world, and the next term added can beat it again.
 *
 * The world's answer is simpler, and is not a number. Warframe missions pay on
 * EXTRACTION. Half of a Survival rotation is not half the reward; it is no
 * reward. So a cycle that does not fit the session does not yield a reduced
 * rate - it yields nothing, and a rate quoted for it is a rate for an hour the
 * player has just said they do not have.
 *
 * Deliberately NOT converted to minutes: `Cycle` is a bucket precisely so that
 * nobody invents a duration for it, so this compares two orderings instead. A
 * cycle SHORTER than the session is not penalised at all - running a quick
 * route repeatedly all evening is a perfectly good evening, and the old table's
 * `instant: -1` for an evening was taste dressed up as arithmetic.
 */
export function sessionFactor(cycle: Cycle, session: SessionLength): Factor {
  if (session === 'any') return NA;
  const longest = CYCLE_ORDER.indexOf(SESSION_FITS[session]);
  const wants = CYCLE_ORDER.indexOf(cycle);
  if (wants <= longest) return NA;
  return gate(
    // YOURS: the route's cycle is published, but the line it fails is the
    // session length the player typed in, and they can move it.
    'yours',
    'Longer than the time you have',
    `One cycle of this is "${cycle}" and you said you have a ${session} session, so you would not reach an extraction - and an unfinished run pays nothing`,
  );
}

/**
 * The share of an hour's output you can actually sell today.
 *
 * THE ONE FACTOR THAT IS PURE MEASUREMENT, and it was `-1 x slider`.
 * ─────────────────────────────────────────────────────────────────
 * Trades are the only hard resource in this game that cannot be farmed: the
 * count is set by mastery rank and refills once a day. `plat-throughput`
 * already computes how many trades an hour of a route would cost to liquidate,
 * and the account already reports how many are left. Both are real numbers, and
 * the ranking was discarding them in favour of "Many small sales, many trades".
 *
 * If the hour produces eight trades' worth and three trades remain, five
 * eighths of that hour's platinum is not platinum tonight. It is inventory.
 *
 * NOT APPLICABLE rather than unknown when the route reports no trade cost: a
 * capital route converts without a per-item sale, so there is no factor here to
 * be ignorant of. Unknown only when the count itself was never read.
 */
export function tradeFactor(rate: Rate, tradesLeft: number | null): Factor {
  const need = rate.tradesPerHour;
  if (need === null || need <= 0) return NA;
  if (tradesLeft === null) {
    return unknown(
      'Trades left today',
      'An hour of this costs trades to sell, and the account has not reported how many you have left - so how much of it lands today cannot be said',
    );
  }
  if (tradesLeft >= need) return NA;
  const share = tradesLeft / need;
  return factor(
    share,
    // The one factor made entirely of numbers off this account.
    'measured',
    'Trades left today',
    `An hour of this is about ${String(need)} ${need === 1 ? 'trade' : 'trades'} of selling and you have ${String(tradesLeft)} left, so ${String(Math.round(share * 100))} per cent of it can become platinum today`,
  );
}

/**
 * How much of what you earn converts inside the session you are in.
 *
 * A ranking that treats platinum-on-the-market as platinum-in-hand is quoting a
 * price nobody has paid you. `fast` is effectively immediate - somebody is
 * always buying Prime parts. `slow` means the item sits until a buyer appears,
 * which may be next week; it is worth the same, just not tonight, and
 * "tonight" is the question this panel asks.
 *
 * PUBLISHED, and it says what it claims: the share of a haul that finds a buyer
 * within one session. That is a statement about the market which sale timings
 * would confirm or refute, and the day this app records how long its own
 * listings take to sell, this constant is replaced by that measurement and
 * nothing above it changes shape.
 */
const CONVERTS_TONIGHT: Record<Liquidity, number> = { fast: 1, steady: 0.7, slow: 0.35 };

export function liquidityFactor(liquidity: Liquidity): Factor {
  const share = CONVERTS_TONIGHT[liquidity];
  if (share >= 1) return NA;
  return factor(
    share,
    'published',
    'Sells within the session',
    liquidity === 'slow'
      ? 'This sells slowly - the platinum is real, but most of it arrives after tonight, so only about a third of it counts towards this hour'
      : 'This sells at a steady pace rather than instantly, so some of the haul is still listed when you stop playing',
  );
}

/**
 * How often a run of this actually goes the way the timing says.
 *
 * A route two brackets above your gear does not pay a reduced rate - it pays
 * the full rate on the runs you finish and nothing on the ones you do not, and
 * the measured timing was taken from runs that finished. This is the same
 * quantity as the per-mission-type finish rate in `plat-throughput`; that one
 * is measured from your own log, and this is the published estimate for a route
 * you have never run, which is exactly the case where it is needed.
 *
 * `short` is the route's demand bracket minus the player's own power, both on
 * the 1..5 scale in `plat-guide`. Zero means matched.
 */
const SURVIVES_THE_BRACKET: Record<number, number> = { 1: 0.55, 2: 0.25, 3: 0.1 };

export function gearFactor(short: number | null, demandText: string): Factor {
  if (short === null) {
    return unknown(
      'Whether your gear carries it',
      'Neither this route’s demand nor your own power level could be read, so how often a run of it would finish cannot be estimated',
    );
  }
  if (short <= 0) return NA;
  const share = SURVIVES_THE_BRACKET[Math.min(3, short)] ?? 0.1;
  return factor(
    share,
    'published',
    'Runs your gear finishes',
    `This is ${demandText} and sits ${String(short)} ${short === 1 ? 'bracket' : 'brackets'} above where your build reads, so a good share of the runs would end before the reward does`,
  );
}

/**
 * Running a squad route alone.
 *
 * `needs-squad` is not a preference to be weighed against selling quickly. An
 * Eidolon hunt solo on most builds is a failed run, and a failed run pays
 * nothing - so this is the same completion-probability quantity as the bracket
 * above, arriving from a different cause.
 */
const SOLO_COMPLETION: Record<Squad, number> = { solo: 1, 'better-squad': 0.75, 'needs-squad': 0.2 };

export function soloFactor(squad: Squad, solo: boolean): Factor {
  if (!solo) return NA;
  const share = SOLO_COMPLETION[squad];
  if (share >= 1) return NA;
  return factor(
    share,
    'published',
    'Solo, on a squad route',
    squad === 'needs-squad'
      ? 'You said you are playing alone and this genuinely needs a squad, so most attempts would not reach a reward'
      : 'You said you are playing alone and this goes markedly better with a squad, so expect fewer completed cycles an hour',
  );
}

/**
 * A world window that is not open.
 *
 * The clearest gate of the set, and it was `-3`. A Baro route while Baro is not
 * here does not pay less; it pays nothing, because the vendor is not there. No
 * arrangement of the other preferences should be able to recommend it, and in a
 * sum some arrangement eventually can.
 *
 * NULL IS "WE HAVE NOT LOOKED", AND MAKING IT A GATE WOULD HAVE BEEN THIS APP'S
 * OWN WORST BUG.
 * ─────────────────────────────────────────────────────────────────────────────
 * `liveSignals` in the panel returns an EMPTY SET when the worldstate has not
 * loaded yet, which is exactly the shape of "nothing is live" - and the same
 * file, two hundred lines lower, carries a comment insisting that those two
 * answers are different and that the card must say which. Gating on an empty
 * set would therefore have told every player, in the seconds before the
 * worldstate arrives and forever if it fails, that every timed route's window
 * was shut. That is a fabricated claim about the world, stated with certainty,
 * which is the one thing this app is built not to do.
 *
 * So the set is nullable and an unread worldstate is UNKNOWN, not shut. A
 * closed window is a certainty and stops the route; an unread one is ignorance
 * and stops the estimate. The old `-3` survived this only by being too weak to
 * matter, which is not a defence of it.
 */
export function liveFactor(route: PlatRoute, live: ReadonlySet<string> | null): Factor {
  if (route.live === null) return NA;
  if (live === null) {
    return unknown(
      'Whether its window is open',
      `This only runs while ${route.live} is active, and the worldstate has not been read - so whether it is available right now is unknown, which is not the same as closed`,
    );
  }
  if (live.has(route.live)) return NA;
  // MEASURED: the worldstate was read, and it says this window is shut.
  return gate('measured', 'Its window is closed', `This only runs while ${route.live} is active, and it is not right now`);
}

// ───────────────────────────────────────────────────────────────────────────
// the estimate
// ───────────────────────────────────────────────────────────────────────────

export interface Expectation {
  /**
   * Platinum in hand per hour of THIS session. Null when a factor that applies
   * could not be evaluated, or when the route has no measured rate to start
   * from - never a zero standing in for either.
   */
  perHour: number | null;
  /** The rate before this file's factors, for the "of X measured" sentence. */
  fromRate: number | null;
  /**
   * The share of whatever this route pays that would actually reach you - the
   * product of the factors alone, with no rate involved.
   *
   * THIS IS WHY IT EXISTS, AND IT WAS FOUND MISSING BY A FAILING CHECK.
   * ──────────────────────────────────────────────────────────────────
   * Most routes have no measured rate, because most routes have not been run.
   * With `perHour` null for all of them, every factor here did nothing to the
   * ordering: a check asserting that "playing solo changes the ranking" failed,
   * and it was right to. A player who has measured nothing - which is every new
   * player - was getting a list in which saying they were solo moved not one
   * route, even though half the list needs a squad.
   *
   * The factors are true of the route whether or not anybody has timed it, and
   * their product is a real quantity that needs no rate: "about a seventh of
   * what this route pays would reach you tonight". That is what orders the
   * unmeasured tier, and it is not an invented rate - it never claims to know
   * what the route pays, only how much of it you would keep.
   *
   * Always a number. A first draft made this null when a factor could not be
   * read; under the ceiling model an unread factor is left out of the product
   * and `atMost` says so, and a review found the null branch unreachable, a
   * dead `?? -1` in the ranking, and a comment describing an ordering that
   * never happened. The type now says what the code does.
   */
  realised: number;
  /** Every factor that applied, in the order the reasoning runs. */
  links: Link[];
  /**
   * A factor that applied and could not be evaluated, if there was one.
   *
   * No longer stops the estimate - see the header. It is what the panel names
   * when it says why the figure is a ceiling rather than a reading.
   */
  blockedBy: Link | null;
  /**
   * True when `perHour` is a ceiling rather than a reading, because at least
   * one factor that applies could not be measured.
   *
   * The number is the same either way; the CLAIM is not, and the claim is the
   * part that has to be right.
   */
  atMost: boolean;
  /** The gate that zeroed it, when one did. Distinct from being unknown. */
  gatedBy: Link | null;
}

export interface Circumstances {
  session: SessionLength;
  solo: boolean;
  tradesLeft: number | null;
  /** Null when the worldstate has not been read. NOT an empty set. */
  live: ReadonlySet<string> | null;
  /** Demand bracket minus power, both 1..5. Null when either is unread. */
  gearShort: number | null;
  demandText: string;
}

/**
 * Compose the estimate.
 *
 * ORDER IS DELIBERATE, and it is the order the reasoning happens in: can you do
 * this at all right now, then how much of it will you complete, then how much
 * of what you complete becomes platinum tonight. A reader following the chain
 * downwards is walking forwards through their own evening.
 *
 * A GATE WINS OVER AN UNKNOWN. If the window is closed it does not matter that
 * the trade count was never read: the answer is nothing, and it is knowable.
 * Reporting "cannot estimate" there would be false modesty about a certainty.
 */
export function expect(rate: Rate | null, route: PlatRoute, c: Circumstances): Expectation {
  const factors: Factor[] = [
    liveFactor(route, c.live),
    sessionFactor(route.cycle, c.session),
    soloFactor(route.squad, c.solo),
    gearFactor(c.gearShort, c.demandText),
    liquidityFactor(route.liquidity),
    rate === null ? NA : tradeFactor(rate, c.tradesLeft),
  ];

  const links: Link[] = [];
  let gatedBy: Link | null = null;
  let blockedBy: Link | null = null;
  let product = 1;

  for (const f of factors) {
    if (f.kind === 'notApplicable') continue;
    links.push(f.link);
    if (f.kind === 'gate') {
      /*
       * Recorded, not multiplied. `product *= 0` was here and was DEAD CODE -
       * the gated branch below returns before `product` is ever read - which
       * made the line worse than absent: it read as the mechanism enforcing the
       * gate, so a later reader could have deleted the early return believing
       * this still held the line. A sabotage that changed this from 0 to 0.0001
       * passed every check in `check-expect.ts`. Sabotaging the early return
       * failed two. The early return IS the gate.
       */
      gatedBy ??= f.link;
    } else if (f.kind === 'unknown') {
      blockedBy ??= f.link;
    } else {
      product *= f.value;
    }
  }

  const fromRate = rate?.perHour ?? null;
  /*
   * A GATE STILL WINS OVER AN UNKNOWN, and now it is the only thing that does.
   * If the window is shut it does not matter that the trade count is unread:
   * the answer is nothing, and it is knowable. "Up to nothing" is not a
   * sentence worth printing.
   */
  if (gatedBy !== null) {
    return { perHour: 0, fromRate, realised: 0, atMost: false, links, blockedBy: null, gatedBy };
  }

  const atMost = blockedBy !== null;

  if (fromRate === null) {
    /*
     * NO MEASURED RATE IS NOT A ZERO AND NOT A GATE. It is the ordinary state
     * of a route the player has never run, and telling them about those is part
     * of this panel's job. The factors are still returned - they are true of
     * the route regardless - so a reader can see that a route they have not
     * measured is also one their gear could not carry, which is worth knowing
     * BEFORE they go and measure it.
     */
    return {
      perHour: null,
      fromRate: null,
      realised: product,
      atMost,
      links,
      blockedBy: blockedBy ?? rate?.blockedBy ?? null,
      gatedBy: null,
    };
  }
  return {
    perHour: Math.round(fromRate * product * 10) / 10,
    fromRate,
    realised: product,
    atMost,
    links,
    blockedBy,
    gatedBy: null,
  };
}
