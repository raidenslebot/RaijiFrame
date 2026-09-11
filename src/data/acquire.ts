/**
 * WHERE A MOD YOU DO NOT HAVE COMES FROM, AND ROUGHLY HOW LONG.
 *
 * The overlay's hardest sentence is "you are missing this one". Without a route
 * that is where the advice stops, and the brief asks for the opposite: "taking
 * into account WHEN you might get certain mods". This turns the single best
 * source the catalogue keeps (`moddb.ts`'s `best`) into something a player can
 * act on tonight.
 *
 * A NOTE ON WHAT "WHEN" CAN HONESTLY MEAN
 * ---------------------------------------
 * For a drop it means an expected number of runs, and that is a real number:
 * a 10.53 % chance is one mod per 9.5 attempts on average. It is NOT a promise
 * - the median is lower than the mean and a player can go thirty runs dry - so
 * the wording says "about" and the arithmetic says why.
 *
 * For a mod with no drop table at all - Baro's stock, a quest reward, a
 * syndicate offering - there is no rate to state, and inventing one would be
 * the worst thing this module could do. Those split in two: a TRADABLE mod can
 * be bought from another player, which is a real route with a real price the
 * market layer already knows; anything else is honestly unknown and says so.
 *
 * THE THREE ANSWERS ARE DELIBERATELY DIFFERENT SHAPES, so a caller cannot
 * render "unknown" as if it were a plan.
 */

import type { ModRow } from './moddb';

export type Route =
  /** It drops. `expectedRuns` is 1 / chance, rounded up, at the best-rated source. */
  | {
      kind: 'farm';
      where: string;
      chance: number;
      expectedRuns: number;
      sources: number;
      /** The planet the location names, when it names one. Free text otherwise. */
      planet: string | null;
      /**
       * Whether the account can go there TONIGHT. `null` means the location does
       * not name a place the star chart knows - a boss, an enemy, a hub - and
       * saying "you cannot get this" on a guess would be worse than saying
       * nothing.
       */
      reachable: boolean | null;
    }
  /** No drop table, but other players have it: this is a purchase, not a farm. */
  | { kind: 'trade' }
  /**
   * No drop table and no trade. Two different sentences live here and the app
   * printed one word for both.
   *
   * MEASURED over the whole catalogue (`scripts/measure-routes.ts`): 1,127 mods
   * of 1,516 farm, 222 trade, and 167 come back with nothing. Four of those 167
   * are mods a finished build actually reaches for - Primed Fury, Primed Shred,
   * Primed Sure Footed, Primed Vigor - and the player met one of them as the
   * overlay's NEXT INSTRUCTION, reading "source unknown". That is what an app
   * failure looks like, and it is not what happened.
   *
   * The export is explicit about those four: `tradable: false`, zero drops. So
   * the catalogue is not silent - it says the mod is in no drop table and cannot
   * be bought from another player, which tells the player to stop looking in
   * missions and in trade chat. `unread` is the other case, where the row simply
   * carries nothing either way. Where it DOES come from - a login tribute, an
   * event, a syndicate - is not in any source this app reads, and it is not
   * guessed here.
   */
  | { kind: 'unknown'; because: 'not-in-tables' | 'unread' };

/**
 * THE PLANET A DROP LOCATION NAMES, when it names one.
 *
 * The export's `location` is free text and nothing in this app joined it to the
 * star chart, so the overlay would tell an account that has never left Earth to
 * go and farm the Cambion Drift. That is the "WHEN" half of the brief going
 * unanswered while the module claimed to answer it.
 *
 * Only one of the shapes the export uses carries a planet reliably, and it is
 * the leading segment before a slash:
 *
 *   "Deimos/Cambion Drift (Level 25 - 30 Bounty), Rotation A"  ->  Deimos
 *   "Earth/Cetus (Level 5 - 15 Cetus Bounty), Rotation B"      ->  Earth
 *   "Tyl Regor, Rotation C"                                    ->  null (a boss)
 *   "Ghoul Rictus Alpha"                                       ->  null (an enemy)
 *   "Kahl's Garrison (Chipper), Fort"                          ->  null (a hub)
 *
 * The others are a boss's name, an enemy's name or a hub, and guessing a planet
 * from any of them is how an app starts telling people things that are not so.
 * They return null and the caller says "unknown" rather than "unavailable".
 */
export function planetOf(where: string): string | null {
  const i = where.indexOf('/');
  if (i <= 0) return null;
  const head = where.slice(0, i).trim();
  // A planet is one or two plain words. Anything else is some other use of a slash.
  return /^[A-Z][A-Za-z' ]{1,18}$/.test(head) ? head : null;
}

/**
 * What a player has to do to get this mod.
 *
 * `canReach` answers "has this account set foot on that planet" and is supplied
 * by the caller - this module has no business importing the star chart, and the
 * optimiser has no business knowing what a planet is. It returns null for a
 * planet it cannot judge, and the route carries that through unchanged.
 */
export function routeTo(row: Pick<ModRow, 'best' | 'sources' | 'tradable'>, canReach?: (planet: string) => boolean | null): Route {
  if (row.best !== null && row.best.chance > 0) {
    const planet = planetOf(row.best.where);
    return {
      kind: 'farm',
      where: row.best.where,
      planet,
      reachable: planet !== null && canReach ? canReach(planet) : null,
      chance: row.best.chance,
      /*
       * Rounded UP, and it matters which way. Rounding 9.5 down to 9 would tell
       * a player the run they are about to do is the one that pays, on average,
       * which is a promise this cannot make; rounding up states the first whole
       * run at which the expectation has been met.
       */
      expectedRuns: Math.max(1, Math.ceil(100 / row.best.chance)),
      sources: row.sources,
    };
  }
  if (row.tradable === true) return { kind: 'trade' };
  // `false` is a statement; anything else is an absence. See the type above.
  return { kind: 'unknown', because: row.tradable === false && row.sources === 0 ? 'not-in-tables' : 'unread' };
}

/**
 * The route in the overlay's few words.
 *
 * Deliberately short: it sits under a mod name in a column beside the game's
 * own screen, and a sentence there is a paragraph. The location is the
 * catalogue's own wording, which is already how the wiki and the drop tables
 * name a place, so a player can search it.
 */
export function routeText(r: Route): string {
  switch (r.kind) {
    case 'farm':
      /*
       * A place the account cannot get to yet is not a plan, and the runs are
       * beside the point until it can. So the sentence changes shape rather than
       * appending a caveat to advice it has already given.
       */
      if (r.reachable === false) return `${r.where} · ${r.planet ?? 'that planet'} is not open to you yet`;
      // "about 1 runs" was on the player's screen. One run is a run.
      return `${r.where} · about ${String(r.expectedRuns)} ${r.expectedRuns === 1 ? 'run' : 'runs'}`;
    case 'trade':
      return 'no drop; trade for it';
    case 'unknown':
      return r.because === 'not-in-tables' ? 'in no drop table, and not tradable' : 'source unknown';
  }
}

/**
 * The same route on ONE line, for the list where every mod has to fit.
 *
 * The column beside the game's grid is 292 x 263 px of the screen's own empty
 * space and cannot grow without covering something. At two lines a mod, four of
 * a fresh account's eight missing mods fell off the bottom; at one line they
 * all fit. So this drops the part of the location that is qualification rather
 * than destination - "Deimos/Cambion Drift (Level 25 - 30 Cambion Drift
 * Bounty), Rotation A" becomes "Deimos/Cambion Drift" - and keeps the number of
 * runs, which is the half that decides whether to go tonight.
 *
 * It is a SHORTENING, not a different claim: same place, same expectation, less
 * qualification. The full wording is still what `routeText` gives, and it is
 * what the hovered card shows.
 */
export function routeShort(r: Route): string {
  if (r.kind !== 'farm') return routeText(r);
  // Everything before the first bracket, and before a comma if there is no bracket.
  const where = (r.where.split(' (')[0] ?? r.where).split(', ')[0] ?? r.where;
  if (r.reachable === false) return `${where} · not open yet`;
  return `${where} · ${String(r.expectedRuns)} ${r.expectedRuns === 1 ? 'run' : 'runs'}`;
}

/**
 * Which of two routes to show first when a build is missing several mods.
 *
 * Fewest runs first, because that is the one to do tonight. A trade sorts after
 * every farm - it costs platinum rather than time, and the overlay should not
 * lead with spending money - and an unknown sorts last, since it is not advice.
 */
export function routeRank(r: Route): number {
  switch (r.kind) {
    case 'farm':
      /*
       * A FARM THE ACCOUNT CANNOT REACH SORTS BELOW EVERY ONE IT CAN, and below
       * a trade too. "The one to do tonight" is the whole point of this ordering
       * and a locked planet is not a thing anybody can do tonight - however good
       * the drop rate is. It still sorts above `unknown`, because "get to
       * Deimos" is a real instruction and "nobody knows" is not.
       */
      return r.reachable === false ? 2e6 + r.expectedRuns : r.expectedRuns;
    case 'trade':
      return 1e6;
    case 'unknown':
      return 1e9;
  }
}
