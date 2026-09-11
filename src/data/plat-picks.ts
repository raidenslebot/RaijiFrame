/**
 * Five things to do, and no two of them the same kind of thing.
 *
 * WHY THE SECOND SUGGESTION WAS WORSE THAN THE FIRST
 * ─────────────────────────────────────────────────
 * The plan ranks every action on one axis - platinum per trade - and takes them
 * in order. That is right for filling a trade budget and wrong for filling a
 * SCREEN, because the second-best item on a single axis is by construction a
 * slightly worse version of the first. Five rows of "sell a prime part", each
 * paying a little less than the one above it, is one suggestion repeated five
 * times, and the fifth is not worth a card.
 *
 * A player does not have one way to make platinum. They have five, and they are
 * not interchangeable: selling spends a trade, running spends an hour, standing
 * spends a daily cap that cannot be saved, cracking a relic spends a relic. The
 * budgets are separate, so the answers are separate, and the best use of each
 * is a genuinely different question with a genuinely different answer.
 *
 * So this returns the best of each KIND rather than the top five overall.
 * Nothing here competes with anything else, which means nothing here is the
 * runner-up to something else.
 *
 * WHAT IT DOES WHEN A KIND HAS NO ANSWER
 * ──────────────────────────────────────
 * It says so, in that kind's own slot, and says what would settle it. That is
 * not padding: "no set is within two parts" and "the quotes have not arrived"
 * are different facts, both worth knowing, and both better than a sixth sell
 * wearing a different hat. A refusal never claims a number.
 */

import type { Holding } from './plat-value.ts';
import { tradesFor, valueRelic, type Relic } from './plat-value.ts';
import type { DucatDb } from './ducats.ts';
import type { Price } from './market.ts';
import type { SetVerdict } from './set-completion.ts';
import type { RunnableRoute } from './plat-plan.ts';
import { bestUseOfStanding, syndicateLabel, type ValuedOffering } from './standing-value.ts';
import type { StandingRate } from './plat-throughput.ts';

/**
 * One line of a relic's reward table, as the card needs it.
 *
 * `slug` is null for the rewards nobody can trade - Forma, the Requiem mods -
 * and that null is load-bearing: it is what stops the row offering a market
 * page for a thing that has no market.
 */
export interface RewardRow {
  item: string;
  /** Percent, as published. */
  chance: number;
  slug: string | null;
  /** Median platinum, or null when nothing has traded in ninety days. */
  plat: number | null;
  /** Exact ducats at the kiosk. Null when it is not a prime part. */
  ducats: number | null;
  /** chance x plat. Null when unpriced. */
  expected: number | null;
}

/** The five ways, in the order a player meets them. */
export type PickKind = 'sell' | 'complete' | 'run' | 'standing' | 'relic';

export const KIND_LABEL: Record<PickKind, string> = {
  sell: 'Sell something you hold',
  complete: 'Finish a set and sell it',
  run: 'Go and earn it',
  standing: 'Spend today’s standing',
  relic: 'Crack a relic',
};

/**
 * One thing a method requires, checked against what the account actually holds.
 *
 * NOTHING IS ALLOWED TO BE UNACCOUNTED FOR, AND THAT INCLUDES THE UNCHECKABLE.
 * ──────────────────────────────────────────────────────────────────────────
 * Every method here has prerequisites - a trade, the platinum to buy with, the
 * standing banked with that particular faction, a fissure of the right tier
 * being live at this minute. The panel used to name the cost and stop there,
 * which quietly assumed the player could pay it. Telling somebody to buy a part
 * for 38 platinum when they hold 12 is not advice, it is a maths exercise they
 * have to finish themselves.
 *
 * `met` has three states on purpose, and the third is the important one:
 *
 *   true   they have it, and the numbers are shown
 *   false  they are short, by a stated amount
 *   null   IT CANNOT BE CHECKED - and `unknown` says what would settle it
 *
 * A requirement nobody can verify is still stated. Void Traces are the clearest
 * case: refining a relic costs them, this app has no path to read the count, so
 * the card says the requirement exists and says it cannot see the number.
 * Dropping the line would be pretending the requirement does not exist, and
 * showing a zero would be inventing an answer.
 */
export interface Need {
  /** What is required, named the way the player would name it. */
  what: string;
  /** How much of it. Null when the requirement is not a quantity. */
  need: number | null;
  /** How much they have. NULL MEANS UNREAD, and never zero. */
  have: number | null;
  /** Words for the quantity: trades, platinum, standing. */
  unit: string;
  met: boolean | null;
  /** Set when `met` is null: why it cannot be checked. */
  unknown?: string;
}

/** A quantity requirement, checked. */
export function need(what: string, unit: string, needed: number, have: number | null, unknown?: string): Need {
  return {
    what,
    unit,
    need: Math.ceil(needed),
    have,
    met: have === null ? null : have >= needed,
    ...(have === null && unknown !== undefined ? { unknown } : {}),
  };
}

/** A requirement that is a condition rather than a count. */
export function condition(what: string, met: boolean | null, unknown?: string): Need {
  return { what, need: null, have: null, unit: '', met, ...(met === null && unknown !== undefined ? { unknown } : {}) };
}

/**
 * One measured fact behind a card, and where it came from.
 *
 * `from` is not decoration. A published constant cannot be stale and cannot be
 * wrong; a median of closed trades moves daily and is a sample; a figure taken
 * from this player's own log is about them and nobody else. A reader deciding
 * whether to trust a number needs to know which of the three they are looking
 * at, and the card has no room to say it in prose.
 */
export interface Fact {
  label: string;
  value: string;
  from: 'measured' | 'published' | 'yours';
}

export interface Pick {
  kind: PickKind;
  /** The working behind the number, shown when the card is opened. */
  facts: readonly Fact[];
  /**
   * Everything this method requires, each checked against the account.
   * A pick is still shown when something is short - it is the best of its kind
   * either way, and the shortfall is the useful part.
   */
  needs: readonly Need[];
  /**
   * THE MARKET ITEM BEHIND THE SUGGESTION, SO "HOW DO YOU KNOW" HAS AN ANSWER.
   * ————————————————————————————————————————————
   * A card states a number and stops. Ask it how it knows and the answer used
   * to be a list of facts that were themselves just more numbers - the median,
   * the range, the volume - each of which invites the same question again and
   * has nowhere to send it.
   *
   * The slug is where it sends them: the ninety days of closes behind that
   * median, and the people actually selling the thing right now. Present on the
   * kinds that name a tradeable item; absent on the ones that do not, because
   * "go and run this mission" has no market page and pretending otherwise
   * would be a link to nothing.
   */
  slug?: string;
  /**
   * THE WHOLE REWARD TABLE, FOR THE ONE KIND WHOSE ANSWER IS A DISTRIBUTION.
   * ————————————————————————————————————————————
   * A relic's value is an EXPECTATION - the sum of every drop times its
   * chance - and an expectation quoted alone is the least inspectable number
   * on the screen. The card showed the top four rewards in its facts and
   * stopped, so a reader who asked where the figure came from got most of an
   * answer and no way to see the rest.
   *
   * Every row here was already computed to produce that expectation. Carrying
   * them costs nothing and turns the one card whose number is a probability
   * into the one card that can show its whole working.
   */
  table?: readonly RewardRow[];
  /** Stable across re-pricing, so a card waved away stays waved away. */
  ref: string;
  /** The imperative. Two or three words. */
  verb: string;
  /** What the instruction is about, named. */
  subject: string;
  /** The payoff, already rounded, in the unit `unit` names. */
  value: number;
  unit: string;
  /**
   * This kind's payoff in PLATINUM PER HOUR, when it has one.
   *
   * Three of the five kinds can be denominated this way and two cannot, and
   * that split is the whole reason it is optional rather than required. A trade
   * is a daily quota, not a rate: "sell this" and "run that for an hour" do not
   * convert, and inventing a rate between them is exactly what this file was
   * right to refuse.
   *
   * Present on `run`, `standing` and `relic`. Absent on `sell` and `complete`,
   * which spend trades. A reader can therefore be told which cards were ranked
   * against each other and which were not, rather than being handed five in a
   * fixed order and left to guess.
   */
  perHour?: number;
  /** The cost, in the currency this kind actually spends. */
  cost: string;
  /** One line of measured support. Never an opinion. */
  why: string;
  /** Where to go, when going somewhere is the action. */
  where: string | null;
  /** The line to paste into trade chat, when there is one. */
  say: string | null;
}

/** A kind with nothing to offer, and the reason, which is the useful part. */
export interface Refusal {
  kind: PickKind;
  /** What is missing, in one sentence. */
  because: string;
  /** What would change it. Never "try again later". */
  settles: string;
}

/**
 * HOW MANY ALTERNATES A KIND KEEPS BEHIND ITS LEAD.
 *
 * Four, so a kind can offer five things in total. The number is not arbitrary:
 * past about five the tail is made of candidates whose rate has fallen far
 * enough that recommending them is worse than recommending the next kind, and
 * a stack nobody reaches the bottom of is the same list-of-everything this
 * panel exists to replace.
 */
const ALTERNATES = 4;

/**
 * One kind's answer: the lead, and the runners-up that were computed anyway.
 *
 * WHY THE RUNNERS-UP STOPPED BEING THROWN AWAY
 * ————————————————————————————————————————————
 * Every slot below ranks a whole field - each priced holding, each near-complete
 * set, each route with a measured rate - and then returned exactly one of them
 * and discarded the rest. Two things followed, and both were bad.
 *
 * The first is that the panel did the work and hid it. An account with forty
 * priced parts had thirty-nine real, ranked, already-computed suggestions
 * deleted between the calculation and the screen.
 *
 * The second is worse. Because a kind had exactly one candidate, ANY late gate
 * failing took the entire kind off the board. Five kinds, three of them
 * collapsed to a line of grey text, and the panel looked empty while holding a
 * ranked list it had just built. A kind refuses now only when EVERY candidate
 * failed, and the alternates ride behind the lead where they can be reached.
 *
 * `alternates` is ordered, best first. It is never padded: a kind with one good
 * answer and nothing else keeps an empty array rather than filling the stack
 * with things not worth doing.
 */
export type Slot =
  | { kind: PickKind; pick: Pick; alternates: readonly Pick[] }
  | { kind: PickKind; refusal: Refusal };

/**
 * Take the lead and the alternates off a ranked list of candidates.
 *
 * The refusal is a thunk so its wording is only built when it is needed - a
 * refusal reads the inputs to explain itself, and there is no point doing that
 * on the common path where a candidate exists.
 *//**
 * What to say to a player whose prices have not arrived, in precedence order.
 *
 * THE OUTAGE OUTRANKS BOTH OTHER ANSWERS, and getting that order wrong is what
 * made the first attempt at this useless. `pricing` is true only while requests
 * are in flight; the moment the pass finishes having failed it goes false, so a
 * failure branch nested under it is never reached. The player then read the
 * ordinary fallback - "check back after the market moves", "open Warframe so a
 * fresh inventory is read" - which blames their account or their timing for an
 * outage that is neither.
 *
 * So: a failed pass is reported first, whether or not another is still running.
 * "What was already known" is the useful half of it - the figures on screen are
 * real but stale, rather than absent.
 */
function whileUnpriced(inp: PickInputs, otherwise: string): string {
  if (inp.pricingFailed) return 'The market could not be reached, so this is what was already known.';
  if (inp.pricing) return 'The quotes are arriving now; this fills itself in.';
  return otherwise;
}


function fromRanked<T>(
  kind: PickKind,
  ranked: readonly T[],
  make: (candidate: T) => Pick | null,
  refuse: () => Refusal,
): Slot {
  const picks: Pick[] = [];
  /*
   * ONE REF, ONE CARD - AND THIS WAS A REAL REGRESSION.
   * ————————————————————————————————————————————
   * The input lists are not guaranteed distinct. A route can appear twice
   * under one id, and a syndicate offering can be reachable through more than
   * one rank row; both were true in practice. While a kind returned only its
   * single best candidate that never showed, because a duplicate can only
   * collide with something that is also on screen.
   *
   * Keeping four alternates put both copies on screen at once, React saw two
   * children with the same key, and the console filled with duplicate-key
   * errors - which is not merely noisy: two cards sharing a `ref` share their
   * PROGRESS entry too, so marking one as taken would silently remove both.
   *
   * Deduplicating here rather than in each of the five slots because the ref
   * is what must be unique and this is the only place every ref is minted.
   */
  const seen = new Set<string>();
  for (const candidate of ranked) {
    const made = make(candidate);
    // A candidate that cannot be turned into a pick is SKIPPED, not fatal.
    // Before this, the single best failing here refused the whole kind.
    if (made === null || seen.has(made.ref)) continue;
    seen.add(made.ref);
    picks.push(made);
    if (picks.length > ALTERNATES) break;
  }
  const lead = picks[0];
  if (lead === undefined) return { kind, refusal: refuse() };
  return { kind, pick: lead, alternates: picks.slice(1) };
}

export interface PickInputs {
  holdings: readonly Holding[];
  sets: readonly SetVerdict[];
  routes: readonly RunnableRoute[];
  offerings: readonly ValuedOffering[];
  /** Relics this account holds, already filtered to owned. */
  relics: readonly Relic[];
  book: ReadonlyMap<string, Price>;
  ducats: DucatDb | null;
  /** Trades left today. Null when the account never said. */
  tradesLeft: number | null;
  /**
   * Platinum that can actually be sent to another player.
   *
   * Not the wallet total: starter and gift platinum is spendable in the shop
   * and cannot be traded, so it is the wrong number for "can I buy this part".
   * Null when the account never said.
   */
  tradablePlat: number | null;
  /*
   * The wallet total, which is a CEILING on the line above.
   *
   * The two come from different fields and go missing separately:
   * PremiumCredits is the total and PremiumCreditsFree is the part that can
   * never be traded away, and tradable is the subtraction - so a read carrying
   * the first and not the second knows exactly how much platinum the player
   * has and nothing about how much of it can move. Measured on a real read:
   * PremiumCredits 312, no PremiumCreditsFree, and the panel telling the
   * player "your platinum has not been read from the game yet".
   *
   * It is here to say two true things in that state. Which half is missing,
   * and - when the total itself is short of the price - that the purchase is
   * refused rather than unknown, because no share of 312 buys something that
   * costs 400.
   */
  heldPlat: number | null;
  /** Standing banked with each syndicate, by tag. Absent tag means unread. */
  standingBy: ReadonlyMap<string, number>;
  /** Relic tiers with a fissure live right now. Null when no worldstate. */
  liveTiers: ReadonlySet<string> | null;
  /** Minutes measured from this player's own sittings. Null when unmeasured. */
  minutes: number | null;
  /**
   * Measured minutes for ONE fissure run, from this account's own log.
   *
   * Distinct from `minutes` above, which is how long a whole sitting lasts.
   * This is what converts a relic's expected platinum per crack into platinum
   * per hour, and it is the only reason the relic card can be compared with the
   * run card at all. Null when the log has never timed a fissure.
   */
  fissureMinutes: number | null;
  /**
   * Standing per hour, measured. Null when no run has ever answered.
   *
   * With `platPerK` from the offering, this converts the standing card into
   * platinum per hour — the third of the four currencies the deck used to call
   * uncomparable.
   */
  standingRate: StandingRate | null;
  /** True while quotes are still arriving, so a refusal can say "not yet". */
  pricing: boolean;
  /**
   * True when a pricing stage has FAILED, not merely not finished yet.
   *
   * Every stage in `plat-autoprice.ts` catches its own failure and carries on,
   * which is right - a market outage should leave the panel showing what it
   * already knew rather than blanking. But the failure then reached nobody, so
   * this file could not tell "the quotes are still coming" from "the quotes are
   * never coming", and said the first in both cases.
   *
   * Measured, not theorised: blocking every market request on a cleared cache,
   * the screen kept promising "the quotes are arriving now" while all six
   * requests were failing. No fabricated zero appeared - that discipline held -
   * but a promise about the future is a claim like any other, and that one was
   * false.
   */
  pricingFailed: boolean;
}

const round = (n: number): number => Math.round(n);

/** A listing price is a whole number, because nobody types a half into chat. */
const listing = (n: number): number => Math.max(1, Math.round(n));

const title = (words: string): string => words.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/* ------------------------------------------------------------------ sell */

function sellSlot(inp: PickInputs, spokenFor: ReadonlySet<string>): Slot {
  /*
   * Platinum per TRADE, not per item. Trades are the budget - the daily cap is
   * your Mastery Rank and cannot be raised - so a 90p stack costing seven
   * trades is worse than a 40p part costing one, and ranking by total worth
   * would put the seven-trade stack on top.
   */
  /*
   * A PART CANNOT BE BOTH SOLD AND KEPT.
   *
   * The completion card's margin is computed against the GAP, which assumes
   * every part you already hold is still yours. Letting the sell card name one
   * of those parts puts two cards on screen that cannot both be acted on, and
   * the header sums their platinum into a total for money you can only collect
   * once. `plat-plan.ts` guards exactly this with its consumed set and says
   * why; this is the same guard, applied across the two cards.
   */
  const priced = inp.holdings.filter(
    (h) => h.price !== null && h.worth !== null && h.worth > 0 && !spokenFor.has(h.slug),
  );
  if (priced.length === 0) {
    return {
      kind: 'sell',
      refusal: {
        kind: 'sell',
        because: inp.pricing
          ? 'Nothing you hold has a quote yet.'
          : inp.holdings.length === 0
            ? 'Nothing in this account read joins the tradeable catalogue.'
            : 'None of what you hold has closed a trade in the last ninety days.',
        settles: whileUnpriced(inp, 'Open Warframe so a fresh inventory is read, or check back after the market moves.'),
      },
    };
  }

  /*
   * Ranked, not scanned for a maximum. The order is the useful part and it was
   * being computed and dropped: every one of these is a real sale at a real
   * measured price, and the second is not a worse version of the first the way
   * a second entry in a single overall ranking would be - it is a different
   * part, at a different price, out of a different stack.
   */
  const ranked = [...priced].sort(
    (a, b) => (b.worth ?? 0) / Math.max(1, tradesFor(b.count)) - (a.worth ?? 0) / Math.max(1, tradesFor(a.count)),
  );

  return fromRanked(
    'sell',
    ranked,
    (best) => {
      if (best.price === null || best.worth === null) return null;
      const trades = Math.max(1, tradesFor(best.count));
      return {
      kind: 'sell',
      ref: `sell:${best.slug}`,
      slug: best.slug,
      verb: 'Sell',
      subject: best.count > 1 ? `${String(best.count)} × ${best.name}` : best.name,
      value: round(best.worth),
      unit: 'platinum',
      /*
       * "1 of your trades" was what the unknown case produced, and it reads as
       * a claim about a budget nobody has measured. With no trade count read,
       * the cost is simply the trade itself.
       */
      cost:
        inp.tradesLeft === null
          ? `${String(trades)} ${trades === 1 ? 'trade' : 'trades'}`
          : `${String(trades)} of the ${String(inp.tradesLeft)} ${inp.tradesLeft === 1 ? 'trade' : 'trades'} you have left`,
      needs: [need('A trade', trades === 1 ? 'trade' : 'trades', trades, inp.tradesLeft, 'your trade count has not been read from the game yet')],
      facts: [
        { label: 'Median of the last closed day', value: `${String(best.price.median)}p`, from: 'measured' },
        { label: 'That day\u2019s range', value: `${String(best.price.min)}p to ${String(best.price.max)}p`, from: 'measured' },
        { label: 'Median across the window', value: `${String(best.price.trend)}p`, from: 'measured' },
        { label: 'Closed that day', value: `${String(best.price.volume)}`, from: 'measured' },
        { label: 'You hold', value: `${best.count.toLocaleString()}`, from: 'yours' },
        /* It RETURNS this per trade. Labelled "costs" it read as the price of
            doing it, which is the opposite of what the number is. */
        { label: 'Per trade it returns', value: `${String(round(best.worth / trades))}p`, from: 'measured' },
        ...(best.ducats === null
          ? []
          : [
              {
                label: 'Or at the kiosk, each',
                value: `${String(best.ducats)} ducats`,
                from: 'published' as const,
              },
            ]),
      ],
      why: `${String(best.price.median)}p each and ${String(best.price.volume)} of them closed on the last trading day, so it moves`,
      where: null,
      say: `WTS ${best.count > 1 ? `${String(best.count)}x ` : ''}[${best.name}] ${String(listing(best.price.median))}p each`,
      };
    },
    () => ({ kind: 'sell', because: 'No priced holding survived.', settles: 'Open Warframe once.' }),
  );
}

/* -------------------------------------------------------------- complete */

/**
 * A set verdict whose four money figures are all known.
 *
 * `set-completion.ts` computes `margin` as null the moment either the set price
 * or the cost to finish is missing, so a non-null margin already PROVES all four
 * - but nothing said so in a type, and the render below therefore carried
 * `best.setPrice?.median ?? 0` and `best.toBuy ?? 0` beside the label
 * `from: 'measured'`. Unreachable today, and exactly the shape this app forbids:
 * a zero nobody measured, presented as a measurement. Narrowing the filter once
 * lets those fallbacks be deleted and puts the invariant where a later edit to
 * the filter has to answer for it.
 */
type PricedSet = SetVerdict & { setPrice: Price; toBuy: number; margin: number; perTrade: number };

function completeSlot(inp: PickInputs): Slot {
  const usable = inp.sets.filter(
    (s): s is PricedSet =>
      s.margin !== null && s.perTrade !== null && s.margin > 0 && s.setPrice !== null && s.toBuy !== null,
  );
  if (usable.length === 0) {
    return {
      kind: 'complete',
      refusal: {
        kind: 'complete',
        because:
          inp.sets.length === 0
            ? 'Nothing you hold is within two parts of a complete set.'
            : 'Every near-complete set costs more to finish than the finished set sells for.',
        settles:
          inp.sets.length === 0
            ? 'This appears as soon as you are one or two parts short of a set.'
            : 'Prices move daily; a set that does not pay today often pays next week.',
      },
    };
  }

  const ranked = [...usable].sort((a, b) => b.perTrade - a.perTrade);

  return fromRanked(
    'complete',
    ranked,
    (best) => {
      const missing = best.missing.map((m) => m.replace(/_/g, ' '));
      return {
      kind: 'complete',
      ref: `complete:${best.setSlug}`,
      verb: 'Buy, then sell',
      subject: best.name,
      value: round(best.margin),
      unit: 'platinum, net',
      cost: `${String(best.trades)} trades`,
      /*
       * The margin is measured against the GAP, never the whole set - the
       * expensive parts are already yours, which is the entire reason this
       * pays. Saying "buy the set for X, sell for Y" would understate it by an
       * order of magnitude.
       */
      facts: [
        { label: 'The finished set sells at', value: `${String(best.setPrice.median)}p`, from: 'measured' },
        { label: 'You already hold', value: `${String(best.held.length)} of ${String(best.parts.length)} parts`, from: 'yours' },
        ...best.missing.map((slug) => {
          const price = best.costs.get(slug) ?? null;
          return {
            label: `Still to buy: ${slug.replace(/_/g, ' ')}`,
            value: price === null ? 'no recent trades' : `${String(price.median)}p`,
            from: 'measured' as const,
          };
        }),
        { label: 'Trades it costs', value: `${String(best.trades)}`, from: 'published' },
        { label: 'Net, per trade', value: `${String(best.perTrade)}p`, from: 'measured' },
      ],
      needs: [
        need('A trade', best.trades === 1 ? 'trade' : 'trades', best.trades, inp.tradesLeft, 'your trade count has not been read from the game yet'),
        /*
         * The one this panel used to skip entirely. A completion is the only
         * method here that costs money up front, and being told to spend
         * platinum you do not have is worse than being told nothing.
         */
        need(
          'Platinum to buy with',
          'platinum',
          best.toBuy,
          /*
           * The tradable figure when there is one. Failing that, the total -
           * but ONLY when the total already settles it. A player holding 312
           * cannot buy a 400p part however their platinum is divided, so that
           * is a refusal and not an unknown; a player holding 312 facing a
           * 40p part might have 40 tradable or none, and that genuinely is one.
           */
          inp.tradablePlat ?? (inp.heldPlat !== null && inp.heldPlat < best.toBuy ? inp.heldPlat : null),
          inp.heldPlat === null
            ? 'your platinum has not been read from the game yet'
            : `you hold ${String(inp.heldPlat)}, and how much of it can be traded away is not in this read`,
        ),
      ],
      why: `${missing.join(' and ')} costs about ${String(round(best.toBuy))}p and the finished set sells at ${String(best.setPrice.median)}p`,
      where: null,
      say: `WTB ${missing.map((m) => `[${title(m)}]`).join(' ')} ${String(listing(best.toBuy))}p`,
      };
    },
    () => ({ kind: 'complete', because: 'No set survived.', settles: 'Open Warframe once.' }),
  );
}

/* ------------------------------------------------------------------- run */

function runSlot(inp: PickInputs): Slot {
  /*
   * A capped route is excluded on purpose. "465 platinum an hour" from
   * something you may run once a week is a rate, not a plan: you cannot spend
   * an hour on it, and this card is about spending an hour.
   */
  const usable = inp.routes.filter((r) => r.cap === null && r.perHour > 0);
  if (usable.length === 0) {
    return {
      kind: 'run',
      refusal: {
        kind: 'run',
        because:
          inp.routes.length === 0
            ? 'No route your account can run has a rate yet.'
            : 'Every route with a measured rate is capped by a timer rather than by effort.',
        settles: 'Run a few missions with the overlay open; the rates are measured from your own runs.',
      },
    };
  }

  const ranked = [...usable].sort((a, b) => b.perHour - a.perHour);
  const minutes = inp.minutes;

  return fromRanked(
    'run',
    ranked,
    (best) => {
      const runs =
        best.minutesPerRun !== null && best.minutesPerRun > 0 && minutes !== null
          ? Math.max(1, Math.round(minutes / best.minutesPerRun))
          : null;
      return {
      kind: 'run',
      ref: `run:${best.routeId}`,
      verb: 'Go and run',
      subject: best.name,
      value: minutes === null ? round(best.perHour) : round((best.perHour * minutes) / 60),
      unit: minutes === null ? 'platinum an hour' : `platinum in ${String(minutes)} minutes`,
      cost: runs === null ? (minutes === null ? 'an hour' : `${String(minutes)} minutes`) : `${String(runs)} runs`,
      why:
        best.minutesPerRun === null
          ? `${String(round(best.perHour))}p an hour, measured from your own runs`
          : `${String(round(best.perHour))}p an hour at your own pace of ${String(best.minutesPerRun)} minutes a run`,
      where: best.where,
      say: null,
      // Already in the comparable unit; this kind is what the other two are
      // being converted INTO.
      perHour: round(best.perHour),
      facts: [
        { label: 'Measured rate', value: `${String(round(best.perHour))}p an hour`, from: 'measured' },
        ...(best.minutesPerRun === null
          ? []
          : [{ label: 'Your pace, one run', value: `${String(best.minutesPerRun)} minutes`, from: 'yours' as const }]),
        /*
         * THE SAMPLE, NOT JUST THE ADJECTIVE.
         * ————————————————————————————————————————————
         * The card says "measured from your own runs" and stopped there. A
         * median of three runs and a median of ninety are different claims in
         * the same words, and a reader asking how it is known is owed the count
         * rather than the reassurance. The number was in the mission log the
         * whole time - `Timing` carries it - and the one function the panel
         * called returned the median and dropped it.
         */
        ...(best.runsTimed === null || best.minutesPerRun === null
          ? []
          : [
              {
                label: 'Runs that median is built from',
                value: `${String(best.runsTimed)} ${best.runsTimed === 1 ? 'run' : 'runs'} of this kind`,
                from: 'yours' as const,
              },
            ]),
        ...(minutes === null
          ? []
          : [{ label: 'Sitting it is sized to', value: `${String(minutes)} minutes`, from: 'yours' as const }]),
        ...(runs === null ? [] : [{ label: 'Runs that buys', value: String(runs), from: 'yours' as const }]),
      ],
      needs: [
        condition(
          best.hasWindow ? 'Its window is open now' : 'Runnable any time',
          best.hasWindow ? best.liveNow : true,
          'the worldstate has not been read, so whether its window is open is unknown',
        ),
        ...(best.minutesPerRun === null
          ? [condition('A measured pace for it', null, 'you have not run this kind of mission with the overlay open yet')]
          : []),
        /*
         * A pace measured once is a pace nobody should plan an evening on, and
         * saying so is the honest half of quoting it at all. Not a refusal -
         * the figure is still the best evidence there is - but a reader who can
         * see the sample can weigh it, and one who cannot has to trust it.
         */
        ...(best.runsTimed !== null && best.runsTimed < 3
          ? [
              condition(
                `That pace is from ${String(best.runsTimed)} ${best.runsTimed === 1 ? 'run' : 'runs'}`,
                null,
                'a handful of runs is a thin sample - it will settle as you play more',
              ),
            ]
          : []),
      ],
      };
    },
    () => ({ kind: 'run', because: 'No route survived.', settles: 'Run a few missions.' }),
  );
}

/* -------------------------------------------------------------- standing */

function standingSlot(inp: PickInputs): Slot {
  /*
   * Standing is the only budget here that EXPIRES. It is capped daily, the cap
   * is set by Mastery Rank, and what you do not spend is simply gone at reset -
   * which is why this card exists at all even when it pays less than a sale.
   */
  const reachable = inp.offerings.filter((o) => o.reachable !== false && o.platPerK !== null);
  if (reachable.length === 0) {
    return {
      kind: 'standing',
      refusal: {
        kind: 'standing',
        because: inp.pricing
          ? 'The syndicate offerings are still being priced.'
          : inp.offerings.length === 0
            ? 'No syndicate offering has been priced yet.'
            : 'Nothing your rank allows has closed a trade recently.',
        settles: whileUnpriced(inp, 'Rank up with a syndicate, or open the standing view to price a faction in full.'),
      },
    };
  }

  /*
   * bestUseOfStanding already returns the whole field in order; taking the head
   * threw the rest away. Standing is spent a thousand at a time across several
   * factions, so the runner-up here is frequently with a DIFFERENT syndicate -
   * which makes it not a runner-up at all, but the answer for a budget the lead
   * cannot touch.
   */
  const ranked = bestUseOfStanding(reachable);

  return fromRanked(
    'standing',
    ranked,
    (best) => {
      if (best.platPerK === null || best.price === null) return null;
      return {
      kind: 'standing',
      /*
       * THE RANK IS PART OF THE IDENTITY, NOT DECORATION.
       * ————————————————————————————————————————————
       * A syndicate sells the same mod at more than one rank, at a different
       * standing price each time. Keyed on syndicate and item alone, those two
       * offerings collapsed to one ref - React reported duplicate keys, and
       * worse, the two cards shared a progress entry, so marking one as taken
       * removed both.
       *
       * Deduplicating would also have been wrong here, because these are not
       * duplicates: they are two genuinely different prices for the same thing,
       * and the cheaper one is a real suggestion the player should see. The ref
       * carries the rank so both survive as what they are.
       */
      ref: `standing:${best.syndicate}:${best.itemType}:r${String(best.requiredLevel)}`,
      slug: best.slug,
      verb: 'Buy with standing',
      subject: best.name,
      value: round(best.price.median),
      unit: 'platinum, resold',
      cost: `${best.standingCost.toLocaleString()} standing with ${syndicateLabel(best.syndicate)}`,
      facts: [
        { label: 'Standing it costs', value: best.standingCost.toLocaleString(), from: 'published' },
        ...(best.creditsCost > 0
          ? [{ label: 'And credits', value: best.creditsCost.toLocaleString(), from: 'published' as const }]
          : []),
        { label: 'It resells at', value: `${String(best.price.median)}p`, from: 'measured' },
        { label: 'That day\u2019s range', value: `${String(best.price.min)}p to ${String(best.price.max)}p`, from: 'measured' },
        { label: 'Closed that day', value: String(best.price.volume), from: 'measured' },
        { label: 'Per thousand standing', value: `${best.platPerK.toFixed(2)}p`, from: 'measured' },
      ],
      needs: [
        need(
          `Standing with ${syndicateLabel(best.syndicate)}`,
          'standing',
          best.standingCost,
          inp.standingBy.get(best.syndicate) ?? null,
          'you have never been read as a member of this syndicate',
        ),
        condition(
          best.requiredLevel > 0 ? `Rank ${String(best.requiredLevel)} with them` : 'No rank needed',
          best.requiredLevel === 0 ? true : best.reachable,
          'your rank with this syndicate has not been read',
        ),
      ],
      /*
       * "the best rate your rank can reach" was a claim even when the rank was
       * unknown, which is exactly the case the requirement above exists to
       * surface. The wording now matches what was actually checked.
       */
      why: `${best.platPerK.toFixed(2)}p for every thousand standing, the best rate among the offerings this account is not known to be locked out of`,
      /*
       * STANDING, CONVERTED INTO THE UNIT THE OTHER CARDS SPEAK.
       * ————————————————————————————————————————————
       * `platPerK` is platinum per thousand standing and `standingRate` is
       * standing per hour, both measured; their product is platinum per hour,
       * and it needed no constant. Absent when the log has never watched this
       * account earn standing — the card still stands on its own ratio, it
       * simply cannot be ranked against the run and relic cards without it.
       */
      ...(inp.standingRate === null
        ? {}
        : { perHour: round((best.platPerK * inp.standingRate.perHour) / 1000) }),
      where: null,
      say: `WTS [${best.name}] ${String(listing(best.price.median))}p`,
      };
    },
    () => ({ kind: 'standing', because: 'No offering survived.', settles: 'Open the standing view.' }),
  );
}

/* ----------------------------------------------------------------- relic */

function relicSlot(inp: PickInputs): Slot {
  if (inp.relics.length === 0) {
    return {
      kind: 'relic',
      refusal: {
        kind: 'relic',
        because: 'This account read holds no relics.',
        settles: 'Relics appear here the moment one is in your inventory.',
      },
    };
  }

  /*
   * Expected platinum per crack, and COVERAGE decides whether it can be said at
   * all. A relic whose rare drop could not be priced has an expected value that
   * is too low by exactly the amount that matters, so a table under half priced
   * is not a small error, it is the wrong number.
   */
  const valued = inp.relics
    .map((r) => valueRelic(r, inp.book, inp.ducats))
    .filter((v) => v.coverage >= 0.5 && v.expected > 0)
    .sort((a, b) => b.expected - a.expected);

  return fromRanked(
    'relic',
    valued,
    (best) => {
      const top = [...best.rewards].sort((a, b) => (b.expected ?? 0) - (a.expected ?? 0))[0];
      return {
      kind: 'relic',
      ref: `relic:${best.relic.itemType}:${best.relic.state}`,
      table: [...best.rewards]
        .sort((a, b) => (b.expected ?? 0) - (a.expected ?? 0))
        .map((r) => ({
          item: r.item,
          chance: r.chance,
          slug: r.slug,
          plat: r.price?.median ?? null,
          ducats: r.ducats,
          expected: r.expected,
        })),
      verb: 'Crack',
      subject: `${best.relic.tier} ${best.relic.name} ${best.relic.state}`,
      value: round(best.expected),
      unit: 'platinum a crack, expected',
      cost: 'one relic and one fissure',
      /*
       * A CRACK, OVER HOW LONG A FISSURE TAKES THIS PLAYER.
       * ————————————————————————————————————————————
       * The expectation is per crack and `fissureMinutes` is measured from this
       * account's own fissure runs, so the division is the honest conversion
       * and needs nothing invented.
       *
       * ONE crack per run, deliberately. A full squad opens four relics and the
       * player still takes one reward, so counting four would quote a rate
       * nobody receives; counting one is the floor, it is what a solo player
       * actually gets, and it can only understate. Absent when the log has
       * never timed a fissure — there is then no hour to divide by.
       */
      ...(inp.fissureMinutes === null || inp.fissureMinutes <= 0
        ? {}
        : { perHour: round((best.expected * 60) / inp.fissureMinutes) }),
      why:
        top && top.expected !== null
          ? `${top.item} carries most of it at ${top.chance.toFixed(1)} per cent, and ${String(Math.round(best.coverage * 100))} per cent of the table is priced`
          : `${String(Math.round(best.coverage * 100))} per cent of the reward table is priced, and the ducat floor under it is ${String(round(best.expectedDucats))}`,
      where: 'Any Void Fissure of that tier',
      say: null,
      facts: [
        { label: 'Expected platinum a crack', value: `${String(round(best.expected))}p`, from: 'measured' },
        { label: 'Of the reward table priced', value: `${String(Math.round(best.coverage * 100))} per cent`, from: 'measured' },
        { label: 'Ducat floor, whatever drops', value: `${String(round(best.expectedDucats))}`, from: 'published' },
        ...[...best.rewards]
          .sort((a, b) => (b.expected ?? 0) - (a.expected ?? 0))
          .slice(0, 4)
          .map((r) => ({
            label: `${r.item} at ${r.chance.toFixed(1)} per cent`,
            value: r.price === null ? 'no recent trades' : `${String(r.price.median)}p`,
            from: 'measured' as const,
          })),
      ],
      needs: [
        condition(
          `A live ${best.relic.tier} fissure`,
          inp.liveTiers === null ? null : inp.liveTiers.has(best.relic.tier),
          'the worldstate has not been read, so which fissures are live is unknown',
        ),
        /*
         * STATED, NOT CHECKED, AND SAYING SO.
         *
         * Refining a relic costs Void Traces. Nothing in this app can read how
         * many you hold - the item path is not in any export it consumes - so
         * the honest thing is to name the requirement and name the gap. Leaving
         * the line out would pretend the requirement did not exist; printing a
         * zero would invent an answer to a question never asked.
         */
        condition(
          best.relic.state === 'Intact' ? 'No refining needed' : `It is already ${best.relic.state}`,
          best.relic.state === 'Intact' ? true : null,
          'you already hold it at this refinement, so no traces are needed now - but the app cannot read your Void Traces to say what refining another would cost',
        ),
      ],
      };
    },
    () => ({
      kind: 'relic',
      because: inp.pricing
        ? 'Your relics are still being priced.'
        : 'Too little of any relic’s reward table has a recent trade to put a figure on it.',
      settles: whileUnpriced(inp, 'Open Relic value to price one in full — the ducat floor is exact and needs no network.'),
    }),
  );
}

/**
 * The five slots: three ranked against each other, two that cannot be.
 *
 * WHAT THIS USED TO SAY, AND WHY IT WAS THREE-QUARTERS WRONG
 * ─────────────────────────────────────────────────────────
 * "FIXED, not ranked. Sorting these against each other would need an exchange
 * rate between a trade, an hour, a day's standing and a relic, and no such rate
 * exists that is not invented."
 *
 * The argument is sound and its scope was not. A trade genuinely does not
 * convert to an hour — a daily trade count is a quota, and no amount of playing
 * earns another one. But the other three all reduce to platinum per hour from
 * measurements this app already holds:
 *
 *   run       is platinum per hour already
 *   relic     is expected platinum per crack over measured minutes per fissure
 *   standing  is platinum per thousand standing times measured standing per hour
 *
 * Not one constant was picked to do that. Every term is either published (the
 * offering's cost) or measured from this account's own log, and each of the two
 * new conversions is absent rather than guessed when its measurement is.
 *
 * So the deck now DECIDES among the three it can compare and stays honest about
 * the two it cannot. That matters because this app's own recorded principle is
 * that a ranked list is not an answer and the panel must give one instruction:
 * five cards in "the order a player meets them" was the ranking removed rather
 * than the decision made, and it was justified by a refusal that covered one
 * case out of four.
 *
 * The two trade-bound kinds keep their reading position at the front, because
 * they spend a budget the other three cannot touch — a sale costs a trade and
 * no hours, so it is never in competition with an hour of play.
 */
export function bestPicks(inp: PickInputs): Slot[] {
  /*
   * The completion is chosen FIRST so the sale can be told what it may not
   * name. Order of construction, not order on screen: the array below is still
   * the reading order a player meets these in.
   */
  const complete = completeSlot(inp);
  /*
   * EVERY completion on screen speaks for its parts, not just the lead.
   *
   * A part cannot be both sold and kept, and the completion card's margin is
   * computed against the gap on the assumption that the parts you already hold
   * stay yours. That guard used to read the lead alone, which was right when a
   * kind was one card; now that the alternates are reachable, a part held by
   * any of them would otherwise turn up on the sell card as well, and the
   * header would sum platinum that can only be collected once.
   */
  const spokenFor = new Set<string>();
  if ('pick' in complete) {
    for (const shown of [complete.pick, ...complete.alternates]) {
      const set = inp.sets.find((x) => `complete:${x.setSlug}` === shown.ref);
      for (const held of set?.held ?? []) spokenFor.add(held);
    }
  }

  /*
   * The three time-bound kinds, ordered by the rate they were just denominated
   * in. A kind whose conversion could not be measured keeps its place among
   * them rather than being dropped or sunk: it has a real answer, it simply has
   * no hour attached, and ordering it by a number it does not have would be the
   * fabrication this whole change exists to avoid.
   */
  const timed = [runSlot(inp), standingSlot(inp), relicSlot(inp)];
  const rateOf = (slot: Slot): number | null => ('pick' in slot ? (slot.pick.perHour ?? null) : null);
  timed.sort((a, b) => {
    const ra = rateOf(a);
    const rb = rateOf(b);
    if (ra === null && rb === null) return 0;
    if (ra === null) return 1;
    if (rb === null) return -1;
    return rb - ra;
  });

  return [sellSlot(inp, spokenFor), complete, ...timed];
}

/** Only the slots that produced something to do, leads only. */
export function picksOf(slots: readonly Slot[]): Pick[] {
  return slots.flatMap((s) => ('pick' in s ? [s.pick] : []));
}

/**
 * A budget more than one card is spending, and whether it stretches.
 */
export interface Contended {
  /** The budget, named as the cards name it: "A trade", "Platinum to buy with". */
  what: string;
  unit: string;
  /** What the cards want between them. */
  wanted: number;
  /** What the account has. Never null here - an unknown budget cannot contend. */
  have: number;
  /** Which kinds are drawing on it, and for how much. */
  claims: ReadonlyArray<{ kind: PickKind; wants: number }>;
  /**
   * WHICH TO DO FIRST, and which will not fit after it.
   *
   * Naming a conflict and leaving the reader to resolve it is the same failure
   * as handing them a ranked list: the work was moved, not done. This spends
   * the budget on the claimants in order and says where it runs out.
   *
   * Empty only when the ordering cannot be justified - see `order` below.
   */
  first: PickKind | null;
  /** Claimants the budget cannot reach once `first` has taken its share. */
  after: readonly PickKind[];
}

/**
 * WHAT THE CARDS TAKE FROM EACH OTHER.
 * ————————————————————————————————————————————
 * Every card checks its own requirements against the account, and every one of
 * those checks is correct. Together they still mislead, because the five kinds
 * are not five independent budgets: selling and completing both spend TRADES,
 * and the daily trade count is set by Mastery Rank and cannot be raised.
 *
 * With two trades left, a sale wanting one and a completion wanting two each
 * report "you have enough". Both are true. Doing both is not possible, and
 * nothing on the screen said so - the same defect the foundry's build queue
 * exists to fix, unclosed on the panel it matters most on.
 *
 * DELIBERATELY NARROW, for the same reason as `contested` in `build-queue.ts`:
 * this reports only budgets where the cards INDIVIDUALLY fit and jointly do
 * not. A card that is short on its own already says so on its own face, and
 * repeating it here would be noise rather than a finding.
 *
 * Pooling by `what` is safe here and would not be elsewhere: these strings come
 * from a closed set minted in this file, not from a catalog where 187 of 324
 * names collide.
 */
export function contention(picks: readonly Pick[]): Contended[] {
  const byKind = new Map<PickKind, Pick>(picks.map((p) => [p.kind, p]));
  const pooled = new Map<string, { unit: string; have: number; claims: Array<{ kind: PickKind; wants: number }> }>();

  for (const p of picks) {
    for (const n of p.needs) {
      // Only quantities the account could actually be measured against. An
      // unknown budget cannot be over-spent, because nobody knows its size.
      if (n.need === null || n.have === null) continue;
      const row = pooled.get(n.what) ?? { unit: n.unit, have: n.have, claims: [] };
      row.claims.push({ kind: p.kind, wants: n.need });
      pooled.set(n.what, row);
    }
  }

  const out: Contended[] = [];
  for (const [what, row] of pooled) {
    if (row.claims.length < 2) continue;
    const wanted = row.claims.reduce((t, c) => t + c.wants, 0);
    if (wanted <= row.have) continue;
    // Each alone had to fit, or this is ordinary shortfall rather than contention.
    if (!row.claims.every((c) => c.wants <= row.have)) continue;

    /*
     * RANKING THE CLAIMANTS IS LEGITIMATE HERE AND NOWHERE ELSE.
     * ————————————————————————————————————————————
     * This file refuses to rank the five kinds against each other, and it is
     * right to: that needs an exchange rate between a trade, an hour, a day's
     * standing and a relic, and no such rate exists that is not invented.
     *
     * This is a different question. These claimants are competing for ONE
     * budget, so they can be compared in THAT budget's own units - value per
     * unit spent - with nothing invented. It is the same axis the day plan uses
     * for exactly this reason: filling a trade budget is ranked on platinum per
     * trade because that is what the budget is denominated in.
     *
     * Where a claimant's value is not denominated in the same thing as the
     * others - a route paying platinum an hour, competing for trades - the
     * comparison would need the rate that does not exist, so no order is
     * claimed and `first` stays null. The conflict is still reported; only the
     * recommendation is withheld.
     */
    const rate = (kind: PickKind): number | null => {
      const p = byKind.get(kind);
      const claim = row.claims.find((c) => c.kind === kind);
      if (p === undefined || claim === undefined || claim.wants <= 0) return null;
      // Only the kinds whose `value` is platinum in hand. A run pays per hour
      // and a relic pays per crack; neither converts into a trade.
      if (p.kind !== 'sell' && p.kind !== 'complete' && p.kind !== 'standing') return null;
      return p.value / claim.wants;
    };

    const rates = row.claims.map((c) => ({ kind: c.kind, wants: c.wants, rate: rate(c.kind) }));
    const comparable = rates.every((r) => r.rate !== null);
    let first: PickKind | null = null;
    const after: PickKind[] = [];

    if (comparable) {
      const order = [...rates].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
      let left = row.have;
      for (const [i, r] of order.entries()) {
        if (r.wants <= left) {
          left -= r.wants;
          if (i === 0) first = r.kind;
        } else {
          after.push(r.kind);
        }
      }
    }

    out.push({ what, unit: row.unit, wanted, have: row.have, claims: row.claims, first, after });
  }
  return out;
}

/** Every suggestion the five kinds produced, leads and alternates alike. */
export function allPicks(slots: readonly Slot[]): Pick[] {
  return slots.flatMap((s) => ('pick' in s ? [s.pick, ...s.alternates] : []));
}
