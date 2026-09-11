/**
 * Ranking the platinum routes.
 *
 * WHAT THIS ENGINE IS ALLOWED TO DO
 * ─────────────────────────────────
 * It cannot tell you which route pays the most platinum, and it never pretends
 * to: no price feed exists, so any plat-per-hour it produced would be invented.
 * Sorting on invented numbers is the failure mode this whole app is built to
 * avoid - it would look far more authoritative and be worth nothing.
 *
 * What it CAN do, and what a player actually needs, is rank by FIT. Given the
 * time you have, the content your account has unlocked, the trades you have left
 * today, the capital you are holding and how you like to play, some routes are
 * plainly better uses of the next hour than others. Every input to that decision
 * is a fact:
 *
 *   from the world   which routes are live right now, and how long the window is
 *   from the account which gates are passed, trades remaining, ducats, Riven slots
 *   from the route   its cycle length, what it outputs, how fast that sells,
 *                    whether it needs a squad, what it needs you to already hold
 *   from the player  the preferences below
 *
 * EVERY CONTRIBUTION IS NAMED. `score.reasons` carries one line per term that
 * moved the score, so the ranking can be audited instead of trusted. A ranking
 * nobody can check is indistinguishable from one that was made up.
 */

import type { AccountPicture } from './progression';
import type { PlatPosition } from './platinum';
import type { Catalog } from './catalog.ts';
import { routeState, PLAT_ROUTES, type LiveSignal, type RouteState } from './plat-routes.ts';
import { guideFor } from './plat-guide.ts';
import { bestFrame, blocker, checkAll, frameAdvice, type Requirement } from './plat-capability.ts';
import type { ItemDb } from './itemdb.ts';
import { modNote, readiness } from './plat-mods.ts';
import { intrinsics, syndicateRank } from './plat-capability.ts';
import type { RawAccount } from './account.ts';
import { expect, type Expectation, type SessionLength } from './plat-expect.ts';
import type { Rate } from './plat-throughput.ts';

/** How long the player has right now. */
/**
 * Re-exported rather than redeclared: `plat-expect` reasons about the session
 * too, and two copies of this union would drift the moment one gained a
 * bucket - with nothing to notice, because both would still typecheck.
 */
export type { SessionLength } from './plat-expect.ts';

/**
 * How capable the player actually is in combat, 1..5, on the same scale as a
 * route's `demand` (see plat-guide.ts).
 *
 * THIS IS THE AXIS THE RANKER WAS MISSING. A quest gate says a route is
 * PERMITTED; it says nothing about whether the player can survive it. Ranking on
 * gates alone told a fresh account to go hunt Eidolons - permitted, and useless
 * advice, because the real requirement is an Amp and a build that can break a
 * shield inside the night window.
 *
 * Two of the three are separate on purpose: a strong frame with an unmodded
 * weapon fails different content than the reverse.
 */
export interface Power {
  /** Frame: survivability and utility. */
  frame: 1 | 2 | 3 | 4 | 5;
  /** Weapons: how fast things actually die. */
  weapons: 1 | 2 | 3 | 4 | 5;
}

/** The binding constraint is whichever is weaker; a build is not an average. */
export function powerLevel(p: Power): number {
  return Math.min(p.frame, p.weapons);
}

export interface Prefs {
  /** How long you have. Routes whose cycle does not fit are pushed down. */
  session: SessionLength;
  /** Playing alone changes which routes are realistic. */
  solo: boolean;
  /** Show routes your account cannot reach yet. */
  includeLocked: boolean;
  /** Weight: prefer one big item over many small ones. Trades are finite. */
  wantBigTicket: number;
  /** Weight: prefer routes that need no setup or capital. */
  wantLowFriction: number;
  /** Families the player has switched off entirely. */
  muted: ReadonlySet<string>;
  /** How strong the player is. Suggested from the account, set by the player. */
  power: Power;
  /** Hide anything the player's gear plainly cannot carry. */
  hideOverGeared: boolean;
  /*
   * THREE SLIDERS USED TO LIVE HERE AND NONE OF THEM CONTROLLED ANYTHING REAL.
   * ─────────────────────────────────────────────────────────────────────────
   * `wantLiquid`, `wantLiveNow` and `wantHighRate` weighted terms that have all
   * moved into `plat-expect`, where they are fractions of a measured rate. A
   * slider that no longer changes the answer is worse than no slider: it is a
   * control that lies about having an effect, and the panel's own note on the
   * subject already said that a control should hold a CHOICE, never stand in
   * for a measurement the app can take.
   *
   * `wantHighRate` deserves its own epitaph, because its default was zero and
   * the comment explaining why was correct about a real problem: letting a
   * measured rate dominate by default "would punish every route with no
   * measurement for the crime of not having been played". That is true of a
   * SUM, where an unmeasured route and a route measured at nothing score alike.
   * It is not true of the tiering that replaced it: an unmeasured route is now
   * in its own tier with its own heading, ranked among its peers, not buried
   * under measured ones. The slider existed to work around a defect in the
   * shape of the arithmetic, and it goes with the defect.
   */
}

export const DEFAULT_PREFS: Prefs = {
  session: 'any',
  solo: false,
  includeLocked: false,
  wantBigTicket: 1,
  wantLowFriction: 1,
  muted: new Set(),
  power: { frame: 3, weapons: 3 },
  hideOverGeared: false,
};

/**
 * A starting guess at the player's power, from what the account actually shows.
 *
 * Only ever a SUGGESTION - the sliders are the truth, because nothing in the
 * account describes a build. What it can see: mastery rank (breadth of gear
 * owned and levelled), how much of the star chart is cleared (what they have
 * survived), and how much Forma has gone into the arsenal (whether things are
 * actually built rather than merely owned).
 *
 * Returns null when the account cannot support even a guess, and the panel then
 * says the sliders are unset rather than pretending to know.
 */
export function suggestPower(picture: AccountPicture, formaSpent: number | null): Power | null {
  const mr = picture.masteryRank;
  if (mr === null) return null;

  const chart = picture.nodes.have !== null && picture.nodes.total ? picture.nodes.have / picture.nodes.total : null;

  // Mastery rank is breadth: it says how much has been levelled, not how well.
  let frame: number = mr >= 16 ? 4 : mr >= 10 ? 3 : mr >= 5 ? 2 : 1;
  // Clearing the chart means having survived the outer system and the junctions.
  if (chart !== null && chart > 0.85) frame += 1;
  if (chart !== null && chart < 0.25) frame -= 1;

  // Forma is the clearest evidence in the whole account that a build exists
  // rather than a collection: nobody spends it on gear they do not use.
  let weapons: number = mr >= 16 ? 4 : mr >= 10 ? 3 : mr >= 5 ? 2 : 1;
  if (formaSpent !== null && formaSpent >= 40) weapons += 1;
  if (formaSpent !== null && formaSpent < 3) weapons -= 1;

  const clamp = (n: number): 1 | 2 | 3 | 4 | 5 => Math.max(1, Math.min(5, n)) as 1 | 2 | 3 | 4 | 5;
  return { frame: clamp(frame), weapons: clamp(weapons) };
}

/** Plain words for a demand bracket, so a penalty can say what it means. */
const DEMAND_TEXT: Record<number, string> = {
  1: 'any gear',
  2: 'a levelled loadout',
  3: 'a real build',
  4: 'a strong build',
  5: 'a specialised build',
};

/** One named contribution to a route's score. */
export interface Reason {
  label: string;
  /** Positive helps, negative hurts. */
  delta: number;
}

export interface Ranked {
  state: RouteState;
  /**
   * The qualitative residue, and NOT the ranking any more.
   *
   * Every term that was secretly a claim about platinum - the session fit, the
   * live window, liquidity, the gear bracket, playing solo, the trade cost -
   * moved into `expected`, where it is a fraction of a measured rate instead of
   * a point in no unit. What is left here is genuine taste: how much setup you
   * are willing to do, whether you would rather make one big sale than six
   * small ones, whether a route suits a new account. Those are preferences, and
   * a preference is exactly the thing a weighted sum is right for.
   *
   * It orders routes WITHIN a tier. It can no longer outvote a gate, because it
   * is not in the same arithmetic as one.
   */
  score: number;
  reasons: Reason[];
  /**
   * Platinum in hand per hour of the session the player said they have, with
   * the factors that got it there. `perHour` null means not estimable - either
   * unrun, or a factor that applies could not be read - which is a different
   * state from zero and ranks differently.
   */
  expected: Expectation;
  /** True when the world says this is available right now. */
  liveNow: boolean;
  /** Gear the route needs, and whether you own it. Empty when it needs none. */
  gear: readonly Requirement[];
  /** The one-line reason you cannot do this yet, if there is one. */
  cannot: string | null;
  /** Which frame to bring, and whether you have it. Null when none matters. */
  loadout: { text: string; owned: boolean } | null;
  /** What your mods say about carrying this. Null when nothing to say. */
  build: string | null;
  /** True when the route names mods and you are missing some. */
  buildShort: boolean;
  /** A rank or competence gate you have not met, in words. Null when clear. */
  shortOf: string | null;
}

/*
 * THE TWENTY-NUMBER SESSION TABLE USED TO BE HERE, AND ITS OWN COMMENT WAS THE
 * ARGUMENT AGAINST IT.
 * ───────────────────────────────────────────────────────────────────────────
 * It scored every (session, cycle) pair between +4 and -16, and recorded that
 * the numbers had been GENTLE NUDGES at first, that a route wanting a whole
 * evening kept outranking instant routes for a player who had said they had ten
 * minutes, and that the fix was to enlarge the penalty until it won. Nothing
 * stopped the next term added from growing past sixteen.
 *
 * It is now `sessionFactor` in `plat-expect.ts`, where it is a GATE: a cycle
 * that does not fit the session yields nothing, because Warframe pays on
 * extraction and half a run is not half a reward. A gate multiplies, so no
 * arrangement of the other preferences can beat it - which is what the comment
 * wanted all along and what a sum could not give it.
 */

/**
 * Rank every route.
 *
 * `live` is the set of worldstate signals currently firing, passed in rather
 * than fetched so this stays a pure function and can be checked.
 */
export function rankRoutes(
  catalog: Catalog | null,
  picture: AccountPicture,
  pos: PlatPosition,
  /**
   * Signals firing right now, or NULL when the worldstate has not been read.
   *
   * Not an empty set for "not read": an empty set is a measurement saying
   * nothing is live, and treating an unloaded worldstate as one told every
   * player their windows were shut. See `liveFactor`.
   */
  live: ReadonlySet<LiveSignal> | null,
  prefs: Prefs,
  /**
   * The raw account, for the requirements that are FACTS rather than judgments.
   * Whether you own a Necramech is not something to ask about with a slider.
   */
  acc: RawAccount | null,
  /**
   * The measured rate for each route, by id, from the player's own runs.
   *
   * THE WHOLE `Rate`, NOT A BARE NUMBER, and that is a deliberate change. The
   * panel computes these with their provenance, their sample size, their
   * confidence band and their trade cost, then used to flatten each one to a
   * single `perHour` float before handing them over - so the ranking was blind
   * to the one field that decides how much of an hour's output can be sold
   * today (`tradesPerHour`), and blind to how many runs any figure rested on.
   * Everything the throughput model worked out was being thrown away at this
   * boundary.
   *
   * Optional and usually absent: a rate exists only where the player has run
   * the thing AND the market could price it. A route missing from this map is
   * not penalised - it is UNRANKED, in its own tier, because "not measured" and
   * "measured at nothing" are different sentences.
   */
  rates?: ReadonlyMap<string, Rate>,
  /**
   * The item catalog, solely so a frame recommendation can tell whether you own
   * the frame. Last and optional because every caller predates it; without it
   * `ownsFrame` answers "unknown", which is the honest state rather than "no".
   */
  items?: ItemDb | null,
): Ranked[] {
  const out: Ranked[] = [];

  /*
   * THE NORMALISER IS GONE WITH THE TERM IT SCALED.
   *
   * It divided every rate by the best rate the account had ever measured, which
   * meant a player who had measured exactly ONE route made that route the
   * yardstick - and it then scored full marks for being the only thing they had
   * ever timed. Platinum an hour needs no normaliser: it is already in units
   * that compare, which is the entire reason for ranking on it.
   */

  for (const route of PLAT_ROUTES) {
    if (prefs.muted.has(route.family)) continue;
    const state = routeState(route, catalog, picture);
    /*
     * A route measured to pay nothing tradeable never enters the ranking, at
     * any preference setting. `includeLocked` is a request to see what could be
     * unlocked; this is not that. It is shown separately, with its evidence.
     */
    if (state.status === 'pays-nothing') continue;
    /*
     * A route whose output is ducats does not belong in a platinum ranking. It
     * is not worthless - it has its own section, in its own units - but putting
     * it here meant the platinum panel's headline answer was "go and get a
     * different currency", which is not an answer.
     */
    if (route.paysDucats === true) continue;
    if (!prefs.includeLocked && state.status === 'blocked') continue;
    // Hide what the gear plainly cannot carry, when asked.
    if (prefs.hideOverGeared) {
      const g = guideFor(route.id);
      if (g && g.demand - powerLevel(prefs.power) >= 2) continue;
    }

    /*
     * What the route needs and whether you have it. CHECKED, not assumed - the
     * `alsoNeeds` prose beside it was never verified against anything.
     */
    const gear = checkAll(acc, route.needsGear ?? []);
    const cannot = blocker(gear);
    /* Which frame actually changes this route's output, checked against yours. */
    const loadout = bestFrame(frameAdvice(acc, route.betterWith ?? [], items ?? null));
    /* The checkable half of "are you strong enough": do you own the mods. */
    const mods = readiness(acc, route.keyMods ?? []);
    const build = modNote(mods);
    const buildShort = mods.missing.length > 0;

    /*
     * Rank and competence, which ownership does not cover.
     *
     * Standing is not access - every faction gates its good offerings behind a
     * rank - and owning a Railjack is not the same as being able to run one.
     */
    let shortOf: string | null = null;
    if (route.needsRank) {
      const have = syndicateRank(acc, route.needsRank.tag);
      if (have !== null && have < route.needsRank.rank) {
        shortOf = `You are rank ${String(have)} with ${route.needsRank.who}; this needs rank ${String(route.needsRank.rank)}`;
      }
    }
    if (shortOf === null && route.needsIntrinsics !== undefined) {
      const skill = intrinsics(acc).effective;
      if (skill !== null && skill < route.needsIntrinsics) {
        shortOf = `Your Railjack Intrinsics are at ${String(skill)}; this wants about ${String(route.needsIntrinsics)}`;
      }
    }

    const reasons: Reason[] = [];
    let score = 0;
    const add = (label: string, delta: number): void => {
      if (delta === 0) return;
      score += delta;
      reasons.push({ label, delta });
    };

    /* ---- is it even open ---- */
    if (state.status === 'blocked') add('Locked behind a quest', -8);
    if (state.status === 'unknown') add('Cannot confirm you have unlocked this', -2);

    /* ----
       THE MEASURED RATE IS NO LONGER A TERM IN THIS SUM. IT IS THE RANKING.

       It used to be `6 x (rate / your best rate) x slider`, which had two
       defects beyond being unitless. The share was taken against the best rate
       the account had ever measured, so a player who had measured exactly ONE
       route made that route the yardstick and it scored the full weight for
       being the only thing they had ever timed. And flattening platinum an hour
       into a 0..1 share put the single quantity this panel is about into the
       same currency as "sells quickly", where eighteen points of it could be
       assembled out of preferences.

       It now flows through `expected` below, in platinum, and orders the list
       directly. `wantHighRate` is gone with it: preferring a high rate is not a
       preference, it is the question.
    ---- */

    /*
     * Not owning the gear is decisive, and deliberately heavier than a locked
     * quest. A quest is an evening; a Necramech is a long grind, and putting a
     * route you cannot start at the top of a list headed "best use of your next
     * hour" is the most useless thing this panel could do.
     */
    if (gear.some((g) => g.met === false)) add(cannot ?? 'You do not own what it needs', -14);
    else if (gear.some((g) => g.met === null)) add('Cannot confirm you own what it needs', -2);

    /*
     * Owning the frame that changes a route's OUTPUT is worth something real -
     * Desecrate is roughly a second roll on every corpse - but it is a
     * multiplier on a route you were already going to pick, not a reason to
     * pick one. Small, and positive only.
     */
    if (loadout?.owned === true) add(`You own ${loadout.text.replace(/^Bring /, '').split(' — ')[0]}, which suits it`, 2);

    /*
     * Missing the mods a build is made of is a real signal and a softer one
     * than missing the gear: mods can be farmed in an evening and a Necramech
     * cannot, and somebody may well be borrowing a friend's build. It moves the
     * route down; it does not bury it.
     */
    if (buildShort) add(build ?? 'You are missing mods this build needs', -5);
    /* A rank you have not reached is a hard door, not a difficulty. */
    if (shortOf !== null) add(shortOf, -7);

    const liveNow = route.live !== null && live !== null && live.has(route.live);
    /* ----
       A CLOSED WINDOW WAS -3. A SESSION MISMATCH WAS UP TO -16. PLAYING A
       SQUAD ROUTE ALONE WAS -6. SELLING SLOWLY WAS -1.5 x slider.

       All four are now factors in `expected`, because all four are statements
       about how much platinum reaches your hand rather than about how much you
       would enjoy the route. A Baro route while Baro is away does not pay three
       points less; it pays nothing, because the vendor is not there. An Eidolon
       hunt solo is not a mild preference against; it is a run that mostly does
       not finish, and an unfinished run pays nothing.

       `wantLiveNow` and `wantLiquid` no longer weight anything here. What they
       expressed - "I would rather do the thing that is happening now", "I would
       rather not hold inventory" - is real, but it is a tie-break between
       comparable estimates, not a quantity that can be added to platinum.
    ---- */

    /* ----
       TRADES ARE THE REAL CONSTRAINT, and this is the part most guides miss.
       You get a fixed number of trades a day. A route producing many small items
       needs a trade for each buyer; one producing a single good item needs one.
       When trades are scarce, "many small items" is actively the wrong choice.
    ---- */
    if (route.output === 'set' || route.output === 'lottery') add('One trade, not many', 1.5 * prefs.wantBigTicket);
    if (route.output === 'stack') {
      add('Many small sales, many trades', -1 * prefs.wantBigTicket);
      /*
       * TRADE SCARCITY IS MEASURED WHERE IT CAN BE AND ESTIMATED WHERE IT
       * CANNOT, AND THE TWO LIVE IN DIFFERENT PLACES ON PURPOSE.
       * ────────────────────────────────────────────────────────────────────
       * `tradeFactor` computes what a shortage really costs - trades left over
       * trades the hour needs - but it can only do that once the route has a
       * MEASURED trade cost, which means once the player has run it. For every
       * route they have not, the cost per hour is unknown and no fraction of it
       * can be honestly computed.
       *
       * What is still knowable is coarse and real: `stack` means many small
       * items by definition, so a player down to their last few trades cannot
       * liquidate one. That belongs here, in the qualitative residue, and NOT
       * as a factor on platinum - a factor claims to know how much, and this
       * only knows the direction.
       *
       * Removing it entirely was the first attempt, and a check caught it: with
       * no measured rate, running out of trades stopped moving anything at all.
       */
      if (pos.tradesLeft !== null && pos.tradesLeft <= 3) {
        add(`Only ${String(pos.tradesLeft)} trades left today`, -3);
      }
    }

    /* ----
       CAN YOU ACTUALLY DO IT. A gate says a route is permitted; this says
       whether the gear can carry it. Being two brackets short is not a nudge -
       it is the difference between a productive hour and a wasted one.
    ---- */
    /* ----
       BEING SHORT OF THE BRACKET IS A COMPLETION RATE, NOT A PENALTY.

       `-9` for being two brackets over said the route was worth nine points
       less. What is actually true is that most of those runs end before the
       reward does, and the measured timing this panel quotes was taken from
       runs that FINISHED - so the honest correction is to the rate, not to a
       score. It moved to `gearFactor`.

       The bracket is still computed here because the expectation needs it, and
       because `guide` is read for other reasons below.
    ---- */
    const guide = guideFor(route.id);
    const gearShort = guide ? guide.demand - powerLevel(prefs.power) : null;

    /* ---- friction ---- */
    if (route.setup === 'none') add('Nothing to set up', 1.5 * prefs.wantLowFriction);
    if (route.setup === 'heavy') add('Heavy setup first', -2 * prefs.wantLowFriction);
    if (route.needsCapital) add('Needs something you already hold', -1 * prefs.wantLowFriction);
    if (route.beginnerFriendly) add('Reachable early', 0.5);

    /* ----
       ACCOUNT-SPECIFIC MODIFIERS. These are the ones that make the ranking
       yours rather than generic, and each is read from a real field.
    ---- */
    /*
     * Routes that SPEND ducats. `ducats` itself used to be here and no longer
     * is - it earns them, and it is not ranked for platinum at all now.
     */
    if (route.id === 'baro-flip' || route.id === 'primed-mods') {
      if (pos.ducats !== null && pos.ducats >= 1000) add(`You are holding ${pos.ducats.toLocaleString()} ducats`, 3);
      if (pos.ducats !== null && pos.ducats < 100) add('Almost no ducats banked', -2);
    }
    if (route.family === 'mods' && route.output === 'lottery') {
      if (pos.rivenSlotsFree === 0) add('No free Riven slots', -5);
      else if (pos.rivenSlotsFree !== null && pos.rivenSlotsFree <= 2) add('Riven slots nearly full', -1.5);
    }
    if (route.id === 'flipping' && pos.tradable !== null) {
      if (pos.tradable < 50) add('Little platinum to trade with', -4);
      else if (pos.tradable >= 300) add('You have capital to work with', 2);
    }
    if (route.timeGated && pos.tradesLeft === 0) add('No trades left today', -2);

    /*
     * THE ESTIMATE. Built from the route's own measured rate where there is one
     * and from this account's circumstances always, so the factors that apply
     * are reported even for a route nobody has run - a player deciding whether
     * to go and measure something wants to know first that their gear cannot
     * carry it.
     */
    const expected = expect(rates?.get(route.id) ?? null, route, {
      session: prefs.session,
      solo: prefs.solo,
      tradesLeft: pos.tradesLeft,
      live,
      gearShort,
      demandText: guide ? DEMAND_TEXT[guide.demand] ?? 'a demanding build' : 'a demanding build',
    });

    out.push({ state, score, reasons, liveNow, gear, cannot, loadout, build, buildShort, shortOf, expected });
  }

  /*
   * A BLOCKER IS NOT A PENALTY, AND MAKING IT ONE WAS OUTVOTABLE.
   * ────────────────────────────────────────────────────────────
   * Not owning the gear a route needs scores −14, under a comment that calls it
   * "decisive" and says that "putting a route you cannot start at the top of a
   * list headed 'best use of your next hour' is the most useless thing this
   * panel could do". It is not decisive. It is a term in a sum, and the sum has
   * more than fourteen points of positives available: the measured-rate term
   * alone reaches 18 at a maxed slider, before the live-window, liquidity,
   * big-ticket, low-friction, ducat, capital and session-fit terms.
   *
   * So a player with no Necramech could be told to run Isolation Vaults,
   * provided the route was live, liquid and fitted their evening — which is
   * exactly the failure the comment forbids, reached through the arithmetic
   * rather than through the reasoning.
   *
   * ORDERING, NOT WEIGHTING. `cannot` is already computed and already means
   * "there is a thing you do not own that this needs". Sorting on it first
   * makes the constraint absolute at no cost: nothing can outvote it because it
   * is not in the vote. The score still orders WITHIN each group, so every one
   * of the twenty-two named reasons keeps doing its job, and a blocked route
   * keeps its place among the other blocked ones rather than being hidden.
   *
   * This is the shape a hard requirement should always have had. A weight says
   * "this matters a lot"; a requirement says "not without this", and the second
   * cannot be expressed as more of the first.
   */
  const canDo = (r: Ranked): number => (r.cannot === null ? 0 : 1);

  /*
   * FOUR TIERS, AND EACH IS A DIFFERENT SENTENCE THE PANEL CAN PRINT.
   * ────────────────────────────────────────────────────────────────
   * 0  a firm estimate in platinum. Ranked against each other by it.
   * 1  a CEILING - the same arithmetic with a factor nobody could evaluate, so
   *    the true figure is at most this. Below the firm ones at equal value,
   *    because "up to 60" is a weaker claim than "60" and a ranking that
   *    treated them alike would be quietly promoting ignorance.
   * 2  no rate at all: nobody has run it. These cannot be ranked against a
   *    number without inventing one, so they are not - they sit below, ordered
   *    by how much of whatever they pay would reach you.
   * 3  gated to nothing right now: the window is shut, or it is longer than the
   *    session. Below everything, because "pays nothing tonight" is a worse
   *    answer than "we do not know yet".
   *
   * Mixing 0 and 2 in one order was what the old sum did, by giving an
   * unmeasured route the score of a route measured at nothing. The list looked
   * complete and half of its ordering was fabricated.
   */
  const tier = (r: Ranked): number => {
    if (r.expected.gatedBy !== null) return 3;
    if (r.expected.perHour === null) return 2;
    return r.expected.atMost ? 1 : 0;
  };

  /*
   * A CEILING IS ALREADY THE CAUTIOUS NUMBER, SO IT COMPETES ON VALUE.
   * ────────────────────────────────────────────────────────────────
   * The first version compared tiers before platinum, so every ceiling sat
   * below every firm figure whatever the two numbers were. An adversarial
   * review measured what that did in the ordinary state - game closed, no
   * account, so every route with a per-item trade cost is a ceiling: a firm
   * 1.8 platinum an hour outranked "up to 172", and `bestNow` recommended
   * the 1.8. The comment above promised "below the firm ones at equal
   * value"; the code delivered "below all firm ones at any value" - the exact
   * defect `plat-expect` describes fixing, one tier over. Caution counted
   * twice, again.
   *
   * So the two estimated tiers order by platinum together, and firm beats
   * ceiling only when the numbers tie. `tier` still names the four states for
   * the panel; it just no longer outranks the figure it qualifies.
   */
  /*
   * 0 and 1 fold together (they order by platinum); 2 and 3 stay themselves.
   * The first draft wrote `Math.min(tier, 1)`, which also folded the no-rate
   * and gated tiers into one group that nothing then ordered - the check that
   * says tiers must not interleave caught it within the minute.
   */
  const group = (r: Ranked): number => (tier(r) <= 1 ? 0 : tier(r));
  return out.sort((a, b) => {
    const gate = canDo(a) - canDo(b) || group(a) - group(b);
    if (gate !== 0) return gate;
    if (group(a) === 0) {
      const byPlat = (b.expected.perHour ?? 0) - (a.expected.perHour ?? 0);
      if (byPlat !== 0) return byPlat;
      const firmFirst = tier(a) - tier(b);
      if (firmFirst !== 0) return firmFirst;
    } else if (tier(a) === 2) {
      /*
       * NO RATE, BUT THE FACTORS STILL HOLD. A route nobody has timed can still
       * be one you would keep a seventh of - because you are solo and it needs a
       * squad, because it is two brackets above your gear, because it sells
       * slowly. `realised` is always a number under the ceiling model: an unread
       * factor is left out of the product and flagged, never made a null.
       */
      const byShare = b.expected.realised - a.expected.realised;
      if (byShare !== 0) return byShare;
    }
    return b.score - a.score || a.state.route.name.localeCompare(b.state.route.name);
  });
}

/**
 * The single best use of the next stretch of play, and why.
 *
 * Deliberately one route, not three: a recommendation the player has to choose
 * between is not a recommendation. The rest of the ranking is right below it.
 */
export function bestNow(ranked: readonly Ranked[]): Ranked | null {
  /*
   * `status` IS THE QUEST GATE. IT IS NOT THE ONLY GATE.
   * ────────────────────────────────────────────────────────────
   * `routeState` sets `status` from the quest that opens a route, so a route
   * whose quest you finished is `open` — even when `cannot` says you do not own
   * the Necramech, Railjack or Amp it also needs. This filter therefore let a
   * gear-blocked route be returned as "the single best use of the next stretch
   * of play", which is the one job this function has.
   *
   * Both gates now have to be clear. The fallbacks below it are unchanged and
   * deliberately ordered: a quest-open route you cannot equip for still beats
   * nothing at all, and it arrives carrying its own `cannot` sentence, so the
   * panel says what is missing rather than pretending the route is ready.
   */
  const ready = ranked.filter((r) => r.state.status === 'open' && r.cannot === null);
  const open = ranked.filter((r) => r.state.status === 'open');
  return ready[0] ?? open[0] ?? ranked[0] ?? null;
}
