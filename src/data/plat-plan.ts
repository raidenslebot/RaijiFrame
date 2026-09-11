/**
 * What to do with today's trades, specifically.
 *
 * THE QUESTION NOTHING ELSE ANSWERS
 * ─────────────────────────────────
 * Every other view in this panel answers a general question - which routes suit
 * you, what your stock is worth, which relic pays best. A player sitting down
 * for an evening has a much narrower one:
 *
 *     I have nine trades left. What are the nine best things to do with them?
 *
 * That is a different shape of problem, because trades are a BUDGET. The answer
 * is not "the highest-value item" repeated nine times; it is the set of actions
 * whose total cost fits the budget and whose total return is greatest. An item
 * worth 40p that takes one trade beats a stack worth 90p that takes seven.
 *
 * WHY GREEDY IS THE RIGHT ALGORITHM HERE, NOT A COMPROMISE
 * ───────────────────────────────────────────────────────
 * This is a bounded knapsack, and the exact solution is a dynamic program. It
 * is deliberately not used, for two reasons that both matter more than
 * optimality:
 *
 *   The budget is tiny. Mastery Rank caps trades at thirty, and most actions
 *   cost one. Sorting by platinum-per-trade and filling greedily is provably
 *   optimal whenever items are divisible and near-optimal when the budget is
 *   large relative to item cost - which is exactly this shape.
 *
 *   The inputs are estimates. Prices are medians of past trades and move while
 *   you play. Solving a knapsack exactly over numbers that are themselves
 *   approximate is precision theatre: it would produce a different-looking
 *   answer with no more claim to being right.
 *
 * So: rank by value per trade, fill the budget, stop. And show the arithmetic,
 * because a plan nobody can check is a plan nobody should follow.
 *
 * WHAT IT REFUSES
 * ───────────────
 * An unpriced item never enters the plan. Not at zero, not at a guess - it is
 * simply not something we can say is worth doing, and padding a plan with
 * unknowns to make it look complete is how a tool starts lying.
 */

import type { Holding } from './plat-value.ts';
import { tradesFor } from './plat-value.ts';
import type { SetVerdict } from './set-completion.ts';

export type ActionKind = 'sell' | 'complete' | 'run';

export interface Action {
  kind: ActionKind;
  /**
   * Stable across re-pricing, so a step ticked off stays ticked off.
   *
   * Built from the thing itself - a slug, a set slug, a route id - and never
   * from an index, because the list reorders every time a price lands and an
   * index would move the tick to a different action.
   */
  ref: string;
  /** What to do, in the player's words. */
  what: string;
  /** Why it is worth doing, with the numbers behind it. */
  why: string;
  /** Trades this consumes. Zero for anything that costs time instead. */
  trades: number;
  /** Minutes this consumes. Zero for anything that costs a trade instead. */
  minutes: number;
  /** Platinum it returns, net of anything it costs. */
  plat: number;
  /** The ratio this action was chosen on, in its own budget's units. */
  perUnit: number;
  /** Where to go, when going somewhere is what the action is. Null for a trade. */
  where: string | null;
  /**
   * Where that destination came from, so the card can say which it is.
   *
   * A node taken from the log is a place THIS PLAYER runs; a location taken
   * from the route table is the general answer written for anybody. Presenting
   * the second as though it were the first would dress up a guidebook line as
   * a personal observation, and the two deserve different words.
   */
  whereFrom: 'log' | 'route' | null;
  /**
   * The line to put in trade chat, ready to send.
   *
   * The last thing standing between "you should sell this" and having sold it
   * is composing the message and deciding a number, and the panel already knows
   * both: the item's name and the median it has been closing at. Quoting the
   * median is a default, not a law - it is what the market has actually paid -
   * and the player is free to type something else, but they should not have to
   * work out what to type from nothing.
   */
  say: string | null;
  /** How many runs the time budget buys, when a per-run timing was measured. */
  runs: number | null;
}

export interface Plan {
  actions: readonly Action[];
  /** Trades the plan spends. Never more than the budget. */
  tradesUsed: number;
  /** Minutes the plan spends. Never more than the session. */
  minutesUsed: number;
  /** Platinum the plan returns if every action lands at the quoted price. */
  platTotal: number;
  /** Actions that did not fit, so the cut is visible rather than silent. */
  leftOut: number;
  /** True when nothing could be planned because nothing was priced. */
  nothingPriced: boolean;
}

const EMPTY: Plan = { actions: [], tradesUsed: 0, minutesUsed: 0, platTotal: 0, leftOut: 0, nothingPriced: true };

/**
 * One holding, as the action of selling it. Null when it cannot be one.
 *
 * Extracted because a set completion that fails the budget hands its parts back
 * to be sold, and that second pass has to build exactly the same action - an
 * inlined copy would be a place for the two to drift.
 */
function sellAction(h: Holding): Action | null {
  // Unpriced is not worthless; it is unknown, and unknown does not go in a plan.
  if (h.price === null || h.worth === null || h.worth <= 0) return null;
  const trades = tradesFor(h.count);
  if (trades <= 0) return null;

  return {
    kind: 'sell',
    ref: `sell:${h.slug}`,
    what: h.count > 1 ? `Sell ${String(h.count)} × ${h.name}` : `Sell ${h.name}`,
    why: `${String(h.price.median)}p each, ${String(h.price.volume)} trading a day`,
    trades,
    minutes: 0,
    plat: Math.round(h.worth),
    perUnit: Math.round((h.worth / trades) * 10) / 10,
    where: null,
    whereFrom: null,
    /*
     * A whole number, because a listing is a whole number.
     *
     * The median of closed trades is frequently a half - 29.5p - and nobody has
     * ever typed that into trade chat. The exact median stays on the row and in
     * the detail; what goes in the message is the price rounded to something a
     * person would actually ask for.
     */
    say: `WTS ${h.count > 1 ? `${String(h.count)}x ` : ''}[${h.name}] ${String(Math.round(h.price.median))}p each`,
    runs: null,
  };
}

/**
 * A slug read back as the item's name, for a message meant to be sent.
 *
 * Trade chat matches item links by name, so "nikana prime blade" has to go in
 * as "Nikana Prime Blade" or the link does not resolve in the game's client.
 */
function title(words: string): string {
  return words.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * A route worth spending time on, with the rate that was measured for it.
 *
 * Only routes whose chain actually resolved appear here. A route with no rate
 * is not a slow route, it is an unmeasured one, and planning an hour against a
 * number nobody has is the whole thing this file exists to avoid.
 */
export interface RunnableRoute {
  routeId: string;
  name: string;
  /** Platinum an hour, measured from the player's own runs. */
  perHour: number;
  /** Set when a timer, not effort, caps it - so an hour of it is not available. */
  cap: string | null;
  /** Where it happens, in the route table's own words. */
  where: string | null;
  /** Their median minutes for one run of it. Null when never timed. */
  minutesPerRun: number | null;
  /**
   * HOW MANY RUNS THAT MEDIAN IS MADE OF.
   * ————————————————————————————————————————————
   * The card says "measured from your own runs" and never said how many. A
   * median of three runs and a median of ninety are different claims wearing
   * the same sentence, and a reader who asks "how do you know" deserves the
   * sample rather than the adjective.
   *
   * Null when the route has never been timed, which is already why
   * `minutesPerRun` is null - carried separately so a caller can tell "no runs"
   * from "runs, but we did not record how many".
   */
  runsTimed: number | null;
  /** True when this route has a window and that window is open right now. */
  liveNow: boolean;
  /** True when it has a window at all. A route with none is always runnable. */
  hasWindow: boolean;
}

/**
 * Build the plan.
 *
 * `budget` is trades remaining today. Null means the account has not told us -
 * in which case there is no budget to fill and no plan to make, rather than an
 * assumed one.
 */
export function planToday(
  holdings: readonly Holding[],
  sets: readonly SetVerdict[],
  budget: number | null,
  /** Minutes the player said they have. Null means they did not say. */
  minutes: number | null = null,
  routes: readonly RunnableRoute[] = [],
): Plan {
  /*
   * NO TRADES IS NOT NO PLAN.
   *
   * This used to bail out entirely the moment the budget was zero, which threw
   * away the run action with it - so a player who had spent today's trades and
   * had three hours free was told there was nothing to do. Time and trades are
   * two budgets, stated as independent everywhere else in this file, and one
   * being empty says nothing about the other.
   *
   * A NULL budget is different and still stops the trade half: it means the
   * account never told us, and filling a budget nobody has measured is exactly
   * the invention this file exists to avoid. Both cases fall through to the
   * time half.
   */
  const tradeBudget = budget ?? 0;

  const candidates: Action[] = [];

  /*
   * Completing a set first, because it is usually the densest action available
   * and it CONSUMES parts that would otherwise appear as sell candidates. A
   * plan that told you to sell the Nikana blade and also to complete the Nikana
   * set would be double-counting the same item.
   */
  const consumed = new Set<string>();
  for (const s of sets) {
    if (s.margin === null || s.perTrade === null || s.margin <= 0) continue;
    const missing = s.missing.map((m) => m.replace(/_/g, ' '));
    candidates.push({
      kind: 'complete',
      ref: `complete:${s.setSlug}`,
      what: `Complete ${s.name}`,
      why: `Buy ${missing.join(' and ')} for ${String(s.toBuy ?? 0)}p, sell the set for ${String(s.setPrice?.median ?? 0)}p`,
      trades: s.trades,
      minutes: 0,
      plat: s.margin,
      perUnit: s.perTrade,
      where: null,
      whereFrom: null,
      say: `WTB ${missing.map((m) => `[${title(m)}]`).join(' ')} ${String(Math.ceil(s.toBuy ?? 0))}p`,
      runs: null,
    });
    for (const held of s.held) consumed.add(held);
  }

  for (const h of holdings) {
    if (consumed.has(h.slug)) continue;
    const action = sellAction(h);
    if (action !== null) candidates.push(action);
  }

  /*
   * The earning half.
   *
   * Time and trades are SEPARATE budgets and are deliberately not converted
   * into one another: an hour you do not have is not worth three trades, and no
   * exchange rate between them exists that is not invented. So the two are
   * filled independently and shown in one list.
   *
   * A capped route is excluded from a time budget entirely. "465 platinum an
   * hour" from a route you can run once a week is a rate, not a plan - you
   * cannot spend an hour on it.
   */
  const runnable = routes
    .filter((r) => r.cap === null && r.perHour > 0)
    .sort((a, b) => b.perHour - a.perHour);

  const timeActions: Action[] = [];
  let minutesUsed = 0;
  if (minutes !== null && minutes > 0) {
    const best = runnable[0];
    if (best) {
      // One route for the session, not a schedule: switching content every ten
      // minutes costs more in loading and travel than the ranking difference.
      const runs =
        best.minutesPerRun !== null && best.minutesPerRun > 0
          ? Math.max(1, Math.round(minutes / best.minutesPerRun))
          : null;
      timeActions.push({
        kind: 'run',
        ref: `run:${best.routeId}`,
        /*
         * The route's own name and nothing appended.
         *
         * Route names are sentences - "Prime junk into ducats, ducats into
         * Baro" - so gluing a count on the end produced "...into Baro 12
         * times". The count is a fact ABOUT the step, so it travels in `runs`
         * and the card sets it beside the minutes where it reads as a figure
         * rather than as the tail of a sentence.
         */
        what: `Run ${best.name}`,
        why:
          best.minutesPerRun === null
            ? `${String(Math.round(best.perHour))}p an hour, measured from your own runs`
            : `${String(Math.round(best.perHour))}p an hour at your own pace of ${String(best.minutesPerRun)} minutes a run`,
        trades: 0,
        minutes,
        plat: Math.round((best.perHour * minutes) / 60),
        perUnit: best.perHour,
        where: best.where,
        whereFrom: best.where !== null ? 'route' : null,
        say: null,
        runs,
      });
      minutesUsed = minutes;
    }
  }

  if (candidates.length === 0 && timeActions.length === 0) {
    /*
     * `nothingPriced` names ONE reason for an empty plan: the quotes are not in
     * yet. It used to be returned as true for every empty plan, including the
     * ones caused by a missing trade count, which made the surface above say
     * "nothing you hold has a price yet" to a player whose stock was fully
     * priced. An account holding nothing at all is not that reason either.
     */
    return { ...EMPTY, nothingPriced: holdings.length > 0 && holdings.every((h) => h.price === null) };
  }

  // Densest first. Ties break toward the cheaper action, so a full budget
  // reaches more of the list.
  candidates.sort((a, b) => b.perUnit - a.perUnit || a.trades - b.trades);

  /*
   * TRADES FIRST, THEN THE MISSION - and this is domain reasoning, not layout.
   *
   * The run action used to be spread in at the front simply because it was
   * built first. Doing it in that order wastes the evening: a sale needs
   * ANOTHER PLAYER to see the listing and whisper you, which takes as long as
   * it takes. Post the listings, then go and play - the replies arrive while
   * you are in a mission, and the trades happen between runs instead of after
   * them. Running first leaves every sale queued behind the whole session.
   *
   * It also puts the cheap actions first. A trade takes a minute; the run takes
   * the rest of the sitting. Front-loading the short ones means a player who
   * gets pulled away has still banked something.
   */
  const actions: Action[] = [];
  /** Which candidates made it, so a rejected completion can be identified. */
  const accepted = new Set<string>();
  let used = 0;
  let total = timeActions.reduce((n, a) => n + a.plat, 0);
  let skipped = 0;

  for (const c of candidates) {
    if (used + c.trades > tradeBudget) {
      // Kept counting rather than breaking: a plan should be able to say how
      // much it had to leave behind.
      skipped++;
      continue;
    }
    actions.push(c);
    accepted.add(c.ref);
    used += c.trades;
    total += c.plat;
  }

  /*
   * A COMPLETION THAT DID NOT FIT MUST GIVE ITS PARTS BACK.
   *
   * Parts are marked consumed while candidates are built, so a plan can never
   * tell you to sell the Nikana blade and also to complete the Nikana set. But
   * the budget check happens later, and a completion rejected for cost was
   * still holding its parts hostage - so a 40p one-trade sale silently vanished
   * from the plan AND from the count of what was left out. Nothing on screen
   * said it had been considered; it simply was not there.
   *
   * Here the parts of every rejected completion come back as ordinary sales and
   * compete for whatever budget is left. Double-counting stays impossible,
   * because a part is either inside an accepted completion or on sale as
   * itself, never both.
   */
  const rejected = new Set<string>();
  for (const s of sets) {
    if (s.margin === null || s.perTrade === null || s.margin <= 0) continue;
    if (accepted.has(`complete:${s.setSlug}`)) continue;
    for (const held of s.held) rejected.add(held);
  }
  if (rejected.size > 0) {
    const freed = holdings
      .filter((h) => rejected.has(h.slug) && h.price !== null && h.worth !== null && h.worth > 0)
      .map((h) => sellAction(h))
      .filter((a): a is Action => a !== null)
      .sort((a, b) => b.perUnit - a.perUnit || a.trades - b.trades);

    for (const c of freed) {
      if (used + c.trades > tradeBudget) {
        skipped++;
        continue;
      }
      actions.push(c);
      used += c.trades;
      total += c.plat;
    }
  }

  actions.push(...timeActions);

  return {
    actions,
    tradesUsed: used,
    minutesUsed,
    platTotal: Math.round(total),
    leftOut: skipped,
    nothingPriced: false,
  };
}
