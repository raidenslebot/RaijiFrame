/**
 * Every way to earn platinum, with the attributes a ranker can reason about.
 *
 * WHAT THIS IS
 * ────────────
 * Platinum is not farmed, it is TRADED: with the exception of a handful of
 * alerts and login rewards, nothing in the game drops it. So every route below
 * is really "produce a thing another player will pay for, then sell it", and the
 * interesting question is never "which drops the most plat" - it is which route
 * fits the time you have, the content you have unlocked, the trades you have
 * left today, and how you like to play.
 *
 * WHAT IS CLAIMED, AND WHAT IS REFUSED
 * ────────────────────────────────────
 * Every field here is a CATEGORICAL FACT about a game mechanic - what you do,
 * what comes out, roughly how long a cycle runs, whether it needs a squad, what
 * you must already hold to start. Those are rules of the game and they are
 * checkable.
 *
 * There is no platinum figure anywhere in this file, and there will not be one
 * until a price feed exists. Not a price, not a yield, not a plat-per-hour. A
 * ranker that sorted on invented numbers would look far more authoritative and
 * be worthless, which is the exact trade this project refuses.
 *
 * The durations are BUCKETS, not minutes, for the same reason: "a fissure
 * capture is short and a survival rotation is long" is a fact about the game;
 * "a fissure capture is 4.5 minutes" is a statistic nobody measured.
 */

import type { Catalog } from './catalog.ts';
import { questDone } from './catalog.ts';
import type { AccountPicture } from './progression';
import type { Capability, FramePick } from './plat-capability.ts';
import type { ModKey } from './plat-mods.ts';

export type RouteFamily =
  | 'prime'
  | 'mods'
  | 'arcanes'
  | 'nemesis'
  | 'syndicate'
  | 'railjack'
  | 'trading'
  | 'other';

/** A worldstate signal that says this route is live right now. */
export type LiveSignal =
  | 'fissures'
  | 'baro'
  | 'varzia'
  | 'sortie'
  | 'archon'
  | 'invasions'
  | 'nightwave'
  | 'duviri'
  | 'nightCycle';

/** How long one productive cycle runs. Buckets, never invented minutes. */
export type Cycle = 'instant' | 'short' | 'medium' | 'long' | 'session';

/** What comes out, which decides how many trades it costs to sell. */
export type Output =
  /** Many low-value items: sells often, and eats your daily trade count. */
  | 'stack'
  /** One item or set worth a real amount: few trades, higher each. */
  | 'set'
  /** Rare and unpredictable, occasionally enormous. */
  | 'lottery'
  /** Not an item: a currency or standing you convert into goods. */
  | 'capital';

/** How readily the thing turns into platinum once you have it. */
export type Liquidity = 'fast' | 'steady' | 'slow';

export type Squad = 'solo' | 'better-squad' | 'needs-squad';

export interface PlatRoute {
  id: string;
  name: string;
  family: RouteFamily;
  /** What you actually do. */
  how: string;
  /** What you end up selling to another player. */
  sells: string;
  /** Where it happens, in the game's own vocabulary. */
  where: string;
  /**
   * The quest that opens it, by catalog name. Null means open from the start.
   * Resolved through the catalog and checked against the account, never assumed.
   */
  gate: string | null;
  /** A requirement the account cannot confirm. Stated, never assumed satisfied. */
  alsoNeeds: string | null;
  /**
   * Requirements the account CAN confirm, because they are things you own.
   *
   * `alsoNeeds` above is prose and was never checked against anything - a player
   * with no Necramech was cheerfully told to run Isolation Vaults by a panel
   * holding their entire inventory. Anything in this list is verified.
   */
  needsGear?: readonly Capability[];
  /**
   * Frames whose abilities change what this route PRODUCES, best first.
   *
   * Not "good frames" - a strong frame clears everything faster and is not
   * worth naming. These alter the output: extra loot rolls, stolen drops, held
   * enemies. Checked against the arsenal, so the panel can say "bring the one
   * you already own" instead of listing a wiki page.
   */
  betterWith?: readonly FramePick[];
  /**
   * Mods this route's build is actually made of.
   *
   * The demand bracket in the guide says "needs a specialised build"; this says
   * WHICH mods that build is, and the account can settle whether you hold them.
   * It is the checkable half of a question the sliders otherwise have to guess.
   */
  keyMods?: readonly ModKey[];
  /**
   * A syndicate rank this route needs before it will sell you anything.
   *
   * Standing alone is not enough - every faction gates its good offerings
   * behind a rank, and a panel that says "farm standing" to somebody two ranks
   * short of being allowed to spend it has skipped the step that matters.
   */
  needsRank?: { tag: string; rank: number; who: string };
  /** Minimum Railjack Intrinsics before owning the ship means much. */
  needsIntrinsics?: number;
  /** The worldstate signal that says it is available right now, if any. */
  live: LiveSignal | null;

  /* ------- the attributes the ranker reasons over ------- */
  cycle: Cycle;
  output: Output;
  liquidity: Liquidity;
  squad: Squad;
  /** Effort to get going before the first thing is earned. */
  setup: 'none' | 'light' | 'heavy';
  /** True when the route needs capital you already hold (ducats, standing, relics). */
  needsCapital: boolean;
  /** True when it is capped by a timer rather than by your effort. */
  timeGated: boolean;
  /** Newer players can reach it without a long unlock chain. */
  beginnerFriendly: boolean;

  /**
   * True when this route's output is DUCATS rather than platinum.
   *
   * Ducats are a separate currency with a separate loop and their own section.
   * A ducat route topping a list headed "best use of your next hour" in the
   * PLATINUM panel is the thing that made the whole page read as incoherent:
   * the panel had been told to keep the two apart and then recommended one as
   * the answer to the other.
   */
  paysDucats?: boolean;

  /**
   * Set when this route was MEASURED to produce nothing another player can buy,
   * and holds the measurement itself.
   *
   * This is a positive finding, not an omission. A route that pays no tradeable
   * thing is exactly the one a player is most likely to waste an evening on, so
   * deleting it from this file would leave the obvious question - "why is there
   * nothing here about ephemera?" - answered by silence, and a player who
   * assumes it was ranked and simply came last. Ranking it would be worse. It
   * is carried, excluded from the ranking, and shown with the count that
   * settles it.
   */
  paysNothing?: string;
}

export const PLAT_ROUTES: readonly PlatRoute[] = [
  /* ------------------------------------------------------------ prime economy */
  {
    id: 'fissures', name: 'Run Void Fissures', family: 'prime', betterWith: [{ name: 'Nekros', why: 'Desecrate rolls the drop table again on every corpse' }, { name: 'Khora', why: 'Pilfering Strangledome does the same to everything it holds' }],
    how: 'Crack the relics you hold in a fissure mission. Four players open four relics, so you see four rewards and pick one.',
    sells: 'Prime parts, and the sets they complete', where: 'Any Void Fissure node, by relic tier',
    gate: null, alsoNeeds: 'Relics to open. Radiant relics improve the odds of the rare drop.', live: 'fissures',
    cycle: 'short', output: 'stack', liquidity: 'fast', squad: 'better-squad', setup: 'light',
    needsCapital: true, timeGated: false, beginnerFriendly: true,
  },
  {
    id: 'relic-farm', name: 'Farm relics to crack later', family: 'prime', betterWith: [{ name: 'Nekros', why: 'Desecrate rolls the drop table again on every corpse' }, { name: 'Hydroid', why: 'Pilfering Swarm adds a second roll to what the tentacles kill' }],
    how: 'Relics drop by tier: Lith on early planets, Meso and Neo in the middle, Axi from the outer system and endless rotations.',
    sells: 'The relics themselves, and what comes out of them', where: 'Defence, Survival, Disruption and bounty rotations',
    gate: null, alsoNeeds: null, live: null,
    cycle: 'long', output: 'stack', liquidity: 'steady', squad: 'better-squad', setup: 'none',
    needsCapital: false, timeGated: false, beginnerFriendly: true,
  },
  {
    id: 'ducats', name: 'Prime junk into ducats, ducats into Baro', family: 'prime', paysDucats: true,
    how: 'Common prime parts nobody wants sell at a relay kiosk for ducats. Ducats buy Baro Ki’Teer’s stock, and his stock resells to players.',
    sells: 'What you bought from Baro: primed mods, rare weapons, cosmetics', where: 'Any relay kiosk, then Baro when he lands',
    gate: null, alsoNeeds: 'Baro visits every two weeks and stays two days.', live: 'baro',
    cycle: 'instant', output: 'set', liquidity: 'steady', squad: 'solo', setup: 'none',
    needsCapital: true, timeGated: true, beginnerFriendly: true,
  },
  {
    id: 'vaulted', name: 'Sell vaulted prime sets', family: 'prime',
    how: 'A vaulted prime no longer drops from any relic, so the only supply is what players already hold. That is what holds its value.',
    sells: 'Vaulted prime sets and their parts', where: 'Anything you already own',
    gate: null, alsoNeeds: null, live: null,
    cycle: 'instant', output: 'set', liquidity: 'slow', squad: 'solo', setup: 'none',
    needsCapital: true, timeGated: false, beginnerFriendly: false,
  },
  {
    id: 'resurgence', name: 'Prime Resurgence', family: 'prime',
    how: 'Varzia unvaults a rotating selection. Aya buys the relics; Regal Aya is bought with money and is not farmed.',
    sells: 'Unvaulted prime parts and sets', where: 'Varzia, in Maroo’s Bazaar on Mars',
    gate: null, alsoNeeds: 'Only what Varzia is currently offering can be bought.', live: 'varzia',
    cycle: 'short', output: 'set', liquidity: 'fast', squad: 'solo', setup: 'light',
    needsCapital: true, timeGated: true, beginnerFriendly: true,
  },
  {
    id: 'void-storms', name: 'Void Storms', family: 'railjack', needsIntrinsics: 5, needsGear: ['railjack'],
    how: 'Railjack fissures. They crack relics like any fissure and also drop Holokeys, which buy Tenet weapons from Ergo Glast.',
    sells: 'Prime parts, and Tenet weapons bought with Holokeys', where: 'Void Storm nodes, in the Proximas',
    gate: 'Rising Tide', alsoNeeds: 'A built Railjack.', live: 'fissures',
    cycle: 'long', output: 'stack', liquidity: 'fast', squad: 'better-squad', setup: 'heavy',
    needsCapital: true, timeGated: false, beginnerFriendly: false,
  },

  /* -------------------------------------------------------------------- mods */
  {
    id: 'riven-sortie', name: 'Sorties for Rivens', family: 'mods',
    how: 'Three linked missions once a day. The reward table includes a veiled Riven — the single highest-ceiling tradable in the game.',
    sells: 'Veiled and unveiled Rivens', where: 'Sortie, once daily',
    gate: 'The War Within', alsoNeeds: null, live: 'sortie',
    cycle: 'medium', output: 'lottery', liquidity: 'slow', squad: 'better-squad', setup: 'none',
    needsCapital: false, timeGated: true, beginnerFriendly: false,
  },
  {
    id: 'riven-archon', name: 'Archon Hunts', family: 'mods',
    how: 'A weekly three-mission hunt. It pays an Archon Shard, which is a permanent stat upgrade you slot into your own frames and can never pass to another player.',
    sells: 'Nothing tradeable', where: 'Archon Hunt, weekly',
    gate: 'Veilbreaker', alsoNeeds: null, live: 'archon',
    cycle: 'medium', output: 'lottery', liquidity: 'slow', squad: 'better-squad', setup: 'none',
    needsCapital: false, timeGated: true, beginnerFriendly: false,
    paysNothing:
      'The Archon Hunt drop table is three rows — Amar’s, Boreal’s and Nira’s Shard — and no Riven. No shard ' +
      'appears anywhere in warframe.market’s catalogue. Run it every week for your own build, not for platinum.',
  },
  {
    id: 'riven-circuit', name: 'The Circuit', family: 'mods',
    how: 'Duviri’s weekly rotation. It pays Incarnon Genesis adapters, which permanently upgrade your own weapons and cannot be traded. The Rivens people associate with Duviri are not here — they are in Endless, on Hard.',
    sells: 'Nothing tradeable', where: 'The Circuit, in Duviri',
    gate: 'The Duviri Paradox', alsoNeeds: null, live: 'duviri',
    cycle: 'session', output: 'lottery', liquidity: 'slow', squad: 'solo', setup: 'none',
    needsCapital: false, timeGated: true, beginnerFriendly: false,
    paysNothing:
      'The Circuit’s three rotations pay Incarnon adapters and seven Duviri resources. Neither the adapters nor those ' +
      'resources are on the market. For the Riven, run Duviri Endless on Hard instead — it is the row below this one.',
  },
  {
    id: 'riven-duviri-endless', name: 'Duviri Endless, on Hard', family: 'mods', keyMods: ['vitality', 'stretch', 'flow'],
    how:
      'The Endless mode inside Duviri, played on Hard. Riven mods sit on tiers 6 and 7: Melee at 11.9 per cent, '
      + 'Pistol and Rifle at 8.5 each, Shotgun at 2.7, Zaw and Kitgun at 1.2. Tiers one, three and four pay three '
      + 'Riven Slivers at 4.43 per cent instead.',
    sells: 'Rivens of every class', where: 'Duviri, Endless, Hard — tier six and beyond',
    gate: 'The Duviri Paradox', alsoNeeds: 'Enough gear to hold a Hard tier past the sixth round.', live: 'duviri',
    cycle: 'session', output: 'lottery', liquidity: 'slow', squad: 'solo', setup: 'none',
    needsCapital: false, timeGated: false, beginnerFriendly: false,
  },
  {
    id: 'riven-reroll', name: 'Roll Rivens to raise their value', family: 'mods',
    how: 'Kuva rerolls a Riven’s stats. A god roll on a high-disposition weapon is worth many times an average one, and rolling is the only way there.',
    sells: 'Rolled Rivens', where: 'Your mod station, with Kuva',
    gate: 'The War Within', alsoNeeds: 'Kuva, and a Riven worth rolling.', live: null,
    cycle: 'instant', output: 'lottery', liquidity: 'slow', squad: 'solo', setup: 'light',
    needsCapital: true, timeGated: false, beginnerFriendly: false,
  },
  {
    id: 'corrupted-mods', name: 'Corrupted mods from Orokin Vaults', family: 'mods',
    how: 'Vaults in the Orokin Derelict need a Dragon Key, which handicaps you while carried. Each vault gives one corrupted mod.',
    sells: 'Corrupted mods', where: 'Orokin Derelict, on Deimos',
    gate: 'Heart of Deimos', alsoNeeds: 'A Dragon Key, built in the foundry.', live: null,
    cycle: 'short', output: 'stack', liquidity: 'steady', squad: 'better-squad', setup: 'light',
    needsCapital: false, timeGated: false, beginnerFriendly: false,
  },
  {
    id: 'nightmare-mods', name: 'Nightmare mods', family: 'mods',
    how: 'Nightmare missions apply a handicap and reward dual-stat mods from their own table.',
    sells: 'Nightmare mods', where: 'Nightmare-flagged nodes, once a planet is cleared',
    gate: null, alsoNeeds: null, live: null,
    cycle: 'short', output: 'stack', liquidity: 'slow', squad: 'solo', setup: 'none',
    needsCapital: false, timeGated: false, beginnerFriendly: true,
  },
  {
    id: 'primed-mods', name: 'Primed mods from Baro', family: 'mods',
    how: 'Baro sells primed mods for ducats and credits. Players who missed a rotation buy them afterwards.',
    sells: 'Primed mods', where: 'Baro Ki’Teer, every two weeks',
    gate: null, alsoNeeds: 'Ducats and credits, and whichever mods he brings.', live: 'baro',
    cycle: 'instant', output: 'set', liquidity: 'steady', squad: 'solo', setup: 'none',
    needsCapital: true, timeGated: true, beginnerFriendly: true,
  },
  {
    id: 'galvanized', name: 'Arbitrations', family: 'mods',
    how: 'Arbitrations pay Vitus Essence, which buys Galvanized mods and arcanes from the Arbiters.',
    sells: 'Galvanized mods and Arbitration arcanes', where: 'Arbitration, rotating hourly',
    gate: null, alsoNeeds: 'The whole star chart cleared before Arbitrations unlock.', live: null,
    cycle: 'long', output: 'capital', liquidity: 'steady', squad: 'better-squad', setup: 'none',
    needsCapital: false, timeGated: false, beginnerFriendly: false,
  },
  {
    id: 'augments', name: 'Syndicate augment mods', family: 'syndicate',
    how: 'Daily standing buys augment mods from your syndicate. They cost standing, not platinum, and sell for platinum.',
    sells: 'Warframe and weapon augments', where: 'Your syndicate’s offerings',
    gate: null, alsoNeeds: 'Enough rank with the syndicate that sells the augment.', live: null,
    cycle: 'instant', output: 'stack', liquidity: 'steady', squad: 'solo', setup: 'none',
    needsCapital: true, timeGated: true, beginnerFriendly: true,
  },
  {
    id: 'necramech-mods', name: 'Necramech mods from Isolation Vaults', family: 'mods', needsGear: ['necramech'],
    how: 'Isolation Vault bounties on Deimos drop the Necramech mod set.',
    sells: 'Necramech mods', where: 'Isolation Vaults, Cambion Drift',
    gate: 'Heart of Deimos', alsoNeeds: null, live: null,
    cycle: 'long', output: 'stack', liquidity: 'steady', squad: 'better-squad', setup: 'light',
    needsCapital: false, timeGated: false, beginnerFriendly: false,
  },
  {
    id: 'rare-mods', name: 'Farm specific rare mods', family: 'mods', betterWith: [{ name: 'Nekros', why: 'more corpses rolled means more chances at the rare slot' }, { name: 'Ivara', why: 'Prowl pickpockets the drop before the kill, which stacks with the kill itself' }],
    how: 'A handful of mods drop from one enemy or one mission type and are bought constantly by newer players.',
    sells: 'Rare mods', where: 'Wherever that mod’s source spawns',
    gate: null, alsoNeeds: null, live: null,
    cycle: 'medium', output: 'stack', liquidity: 'steady', squad: 'solo', setup: 'none',
    needsCapital: false, timeGated: false, beginnerFriendly: true,
  },

  /* ----------------------------------------------------------------- arcanes */
  {
    id: 'eidolon', name: 'Eidolon hunts', family: 'arcanes', keyMods: ['intensify', 'vitality', 'flow'], betterWith: [{ name: 'Volt', why: 'his shield multiplies the damage that actually breaks the synovia' }, { name: 'Trinity', why: 'keeps the squad and the lures alive through the fight' }], needsGear: ['amp'],
    how: 'Hunt the Eidolons on the Plains at night. Each takedown pays arcanes, and they stack five-to-one into their higher grade.',
    sells: 'Eidolon arcanes', where: 'Plains of Eidolon, at night',
    gate: "Saya's Vigil", alsoNeeds: 'An Amp, and enough gear to break the shields inside the night window.', live: 'nightCycle',
    cycle: 'long', output: 'stack', liquidity: 'fast', squad: 'needs-squad', setup: 'heavy',
    needsCapital: false, timeGated: true, beginnerFriendly: false,
  },
  {
    id: 'profit-taker', name: 'Profit-Taker and Exploiter', family: 'arcanes',
    how: 'Profit-Taker pays credits at a rate nothing else matches, and credits are what pay the tax on every trade you make. The arcane drop widely attributed to these fights is in no published drop table this app reads, so it is not claimed here.',
    sells: 'Credits, which fund the tax on your other sales', where: 'Orb Vallis, from Fortuna',
    gate: 'Vox Solaris', alsoNeeds: 'Old Mate standing with Solaris United for the heists.', live: null,
    cycle: 'medium', output: 'stack', liquidity: 'fast', squad: 'solo', setup: 'heavy',
    needsCapital: false, timeGated: false, beginnerFriendly: false,
  },
  {
    id: 'iso-arcanes', name: 'Isolation Vault arcanes', family: 'arcanes', keyMods: ['vitality', 'serration'], needsGear: ['necramech'],
    how: 'Deep vault runs on Deimos pay their own arcane set.',
    sells: 'Deimos arcanes', where: 'Isolation Vaults, Cambion Drift',
    gate: 'Heart of Deimos', alsoNeeds: null, live: null,
    cycle: 'long', output: 'stack', liquidity: 'steady', squad: 'better-squad', setup: 'light',
    needsCapital: false, timeGated: false, beginnerFriendly: false,
  },
  {
    id: 'steel-essence', name: 'Steel Path incursions', family: 'arcanes', keyMods: ['vitality', 'serration', 'intensify'], needsGear: ['steelpath'],
    how: 'Daily Steel Path incursions pay Steel Essence, which buys arcanes and rare mods from Teshin.',
    sells: 'Arcanes and mods bought with Steel Essence', where: 'Steel Path incursions, daily',
    gate: null, alsoNeeds: 'The Steel Path, which opens once the whole star chart is cleared.', live: null,
    cycle: 'medium', output: 'capital', liquidity: 'fast', squad: 'solo', setup: 'none',
    needsCapital: false, timeGated: true, beginnerFriendly: false,
  },
  {
    id: 'zariman-arcanes', name: 'Zariman and Cavia arcanes', family: 'arcanes',
    how: 'Zariman bounties and Cavia’s Netracells pay their own arcane sets, several of which are staples.',
    sells: 'Zariman and Entrati Lab arcanes', where: 'Chrysalith, and the Sanctum Anatomica',
    gate: 'Angels of the Zariman', alsoNeeds: null, live: null,
    cycle: 'long', output: 'stack', liquidity: 'fast', squad: 'better-squad', setup: 'none',
    needsCapital: false, timeGated: true, beginnerFriendly: false,
  },

  /* ----------------------------------------------------------------- nemesis */
  {
    id: 'lich-weapons', name: 'Kuva liches', family: 'nemesis', needsGear: ['lich'],
    how: 'A lich carries a Kuva weapon with a random element and bonus. Vanquish it and the weapon is yours; a converted lich can be traded whole.',
    sells: 'Kuva weapons, and lich ephemera', where: 'Wherever the lich holds territory',
    gate: 'The War Within', alsoNeeds: null, live: null,
    cycle: 'session', output: 'set', liquidity: 'steady', squad: 'better-squad', setup: 'light',
    needsCapital: false, timeGated: false, beginnerFriendly: false,
  },
  {
    /*
     * THE RAILJACK MOVED FROM PROSE INTO THE CHECKED LIST.
     * ————————————————————————————————————————————
     * It sat in `alsoNeeds` - "A Railjack, for the Sister's final
     * confrontation." - which the interface above describes as the exact bug it
     * exists to prevent: a requirement stated in a sentence nobody verified,
     * on a panel holding the player's entire inventory.
     *
     * It is not a soft requirement. The confrontation happens in Railjack, so
     * somebody without a ship can create a Sister, work her murmur to the end,
     * and then be unable to finish - leaving her stalking their missions. The
     * route's own tip warns about precisely that, which made the omission worse:
     * the panel knew to warn and did not know to check.
     */
    id: 'sister-weapons', name: 'Sisters of Parvos', family: 'nemesis', needsGear: ['lich', 'railjack'],
    how: 'The Corpus equivalent: a Sister carries a Tenet weapon, and a converted Sister can be traded.',
    sells: 'Tenet weapons', where: 'Sister territory, Corpus nodes',
    gate: 'The War Within', alsoNeeds: null, live: null,
    cycle: 'session', output: 'set', liquidity: 'steady', squad: 'better-squad', setup: 'heavy',
    needsCapital: false, timeGated: false, beginnerFriendly: false,
  },
  {
    id: 'coda-weapons', name: 'Coda — the Technocyte hunt', family: 'nemesis',
    how: 'Höllvania’s nemesis line. A Coda carries its own weapon set, traded the same way as a lich.',
    sells: 'Coda weapons', where: 'Höllvania, 1999',
    gate: 'The Hex', alsoNeeds: null, live: null,
    cycle: 'session', output: 'set', liquidity: 'steady', squad: 'better-squad', setup: 'light',
    needsCapital: false, timeGated: false, beginnerFriendly: false,
  },
  {
    id: 'holokeys', name: 'Holokeys for Tenet weapons', family: 'railjack', needsIntrinsics: 5, needsGear: ['railjack'],
    how: 'Void Storms drop Holokeys, and Ergo Glast trades them for a Tenet weapon with a rolled bonus. The weapon is yours to use and cannot be passed on.',
    sells: 'Nothing tradeable', where: 'Ergo Glast, in any relay',
    gate: 'Rising Tide', alsoNeeds: 'A built Railjack, and Holokeys from Void Storms.', live: null,
    cycle: 'long', output: 'set', liquidity: 'steady', squad: 'better-squad', setup: 'heavy',
    needsCapital: true, timeGated: false, beginnerFriendly: false,
    paysNothing:
      'Neither end of this trade is sellable: no Holokey and no Tenet weapon appears anywhere in ' +
      'warframe.market’s catalogue. It is a good way to arm yourself, and not a way to earn platinum.',
  },

  /* ----------------------------------------------------------------- trading */
  {
    id: 'flipping', name: 'Buy low, sell high', family: 'trading',
    how: 'Watch the market for items listed well under their usual price, buy them, and relist. No mission required — only capital and patience.',
    sells: 'Whatever you bought under price', where: 'Trade chat and the market',
    gate: null, alsoNeeds: 'Platinum to start with, and the daily trade count to move it.', live: null,
    cycle: 'instant', output: 'set', liquidity: 'slow', squad: 'solo', setup: 'none',
    needsCapital: true, timeGated: true, beginnerFriendly: false,
  },
  {
    id: 'sets-vs-parts', name: 'Sell complete sets, not parts', family: 'trading',
    how: 'A finished set sells for noticeably more than its parts sold separately, and costs one trade instead of five.',
    sells: 'Assembled prime sets', where: 'Anything you have the parts for',
    gate: null, alsoNeeds: 'Every part of the set.', live: null,
    cycle: 'instant', output: 'set', liquidity: 'fast', squad: 'solo', setup: 'none',
    needsCapital: true, timeGated: false, beginnerFriendly: true,
  },

  /* ------------------------------------------------------------------- other */
  {
    id: 'ayatan', name: 'Ayatan sculptures', family: 'other',
    how: 'Sculptures appear in missions and from Maroo’s weekly hunt. Most players sell them for Endo; collectors buy them for platinum.',
    sells: 'Ayatan sculptures and stars', where: 'Anywhere; Maroo’s Bazaar weekly',
    gate: null, alsoNeeds: null, live: null,
    cycle: 'short', output: 'stack', liquidity: 'slow', squad: 'solo', setup: 'none',
    needsCapital: false, timeGated: false, beginnerFriendly: true,
  },
  {
    id: 'invasion-rewards', name: 'Invasions', family: 'other',
    how: 'Side with a faction across three missions for the reward on offer — often a weapon part, a catalyst or a reactor.',
    sells: 'Invasion reward items', where: 'Invasion nodes, while the invasion runs',
    gate: null, alsoNeeds: null, live: 'invasions',
    cycle: 'medium', output: 'stack', liquidity: 'steady', squad: 'solo', setup: 'none',
    needsCapital: false, timeGated: true, beginnerFriendly: true,
  },
  {
    id: 'nightwave-cred', name: 'Nightwave creds', family: 'other',
    how: 'Acts pay standing, and standing buys the offerings — Nitain, auras and the cosmetics players otherwise wait months for.',
    sells: 'Nightwave offerings', where: 'Nightwave, this season',
    gate: null, alsoNeeds: null, live: 'nightwave',
    cycle: 'medium', output: 'capital', liquidity: 'steady', squad: 'solo', setup: 'none',
    needsCapital: false, timeGated: true, beginnerFriendly: true,
  },
  {
    id: 'onslaught', name: 'Sanctuary Onslaught', family: 'other',
    how: 'Elite Onslaught pays Peculiar mods and the Khora parts, both of which stay in demand.',
    sells: 'Peculiar mods, Khora parts', where: 'Sanctuary Onslaught',
    gate: null, alsoNeeds: 'Mastery Rank and a build that survives the later zones.', live: null,
    cycle: 'long', output: 'stack', liquidity: 'steady', squad: 'better-squad', setup: 'none',
    needsCapital: false, timeGated: false, beginnerFriendly: false,
  },
  {
    id: 'captura', name: 'Captura scenes', family: 'other',
    how:
      'Mostly bought with syndicate standing rather than farmed: of the 63 scenes in the drop table, 52 are rank '
      + 'rewards and only 11 actually drop. Players building screenshots buy them.',
    sells: 'Captura scenes', where: 'Scattered; each scene has its own source',
    gate: null, alsoNeeds: null, live: null,
    cycle: 'medium', output: 'set', liquidity: 'slow', squad: 'solo', setup: 'none',
    needsCapital: false, timeGated: false, beginnerFriendly: true,
  },
  {
    id: 'imprints', name: 'Kubrow and Kavat imprints', family: 'other', needsGear: ['companion'],
    how: 'An imprint copies a companion’s genetics. Two imprints breed the pattern, and rare colours sell.',
    sells: 'Imprints', where: 'The incubator, in your orbiter',
    gate: null, alsoNeeds: 'A companion worth copying, and Genetic Code.', live: null,
    cycle: 'instant', output: 'set', liquidity: 'slow', squad: 'solo', setup: 'heavy',
    needsCapital: true, timeGated: false, beginnerFriendly: false,
  },
  {
    id: 'fish-whole', name: 'Sell fish whole — never cut them', family: 'other',
    how: 'Fish sell to other players only while they are still whole. Cutting one at the hub vendor gives you parts for your own crafting and destroys the trade, because every part is untradeable. Fish, then leave the catch exactly as it came out of the water.',
    sells: 'Whole fish', where: 'Cetus, Orb Vallis, Cambion Drift',
    gate: null, alsoNeeds: 'A spear and bait from the hub vendor.', live: null,
    cycle: 'long', output: 'stack', liquidity: 'steady', squad: 'solo', setup: 'light',
    needsCapital: false, timeGated: false, beginnerFriendly: true,
  },
  {
    id: 'gems-cut', name: 'Cut your gems before selling them', family: 'other',
    how: 'Mining is the exact opposite of fishing. Raw ore does not sell; the cut gem does. Take the raw stones to the hub vendor, pay to have them cut, and trade the result.',
    sells: 'Cut gems', where: 'Cetus, Orb Vallis, Cambion Drift',
    gate: null, alsoNeeds: 'A mining laser, and the vendor fee to cut each stone.', live: null,
    cycle: 'long', output: 'stack', liquidity: 'steady', squad: 'solo', setup: 'light',
    needsCapital: false, timeGated: false, beginnerFriendly: true,
  },
  {
    id: 'ephemera', name: 'Ephemera', family: 'other',
    how:
      'Trailing cosmetic effects. Most of the ones with a published source are syndicate or vendor rewards rather '
      + 'than drops, and every one binds to your account the moment you get it.',
    sells: 'Nothing tradeable', where: 'Each has its own source — liches, Eidolons, bosses',
    gate: null, alsoNeeds: null, live: null,
    cycle: 'session', output: 'lottery', liquidity: 'slow', squad: 'better-squad', setup: 'none',
    needsCapital: false, timeGated: false, beginnerFriendly: false,
    paysNothing:
      'Not one ephemera is tradeable. Nothing in warframe.market’s catalogue is an ephemera, and DE’s own ' +
      'cosmetics export marks every ephemera row untradeable. Chase them because you want to wear them.',
  },
  /* ---------------------------------------------- measured against the market */
  {
    id: 'sell-relics', name: 'Sell relics without opening them', family: 'prime',
    how: 'Relics are themselves tradeable, and a relic for a currently-wanted part sells for more than the average of what falls out of it. When you are short on time this beats cracking: no mission, no squad, no refinement.',
    sells: 'Unopened relics', where: 'Anywhere — they are in your inventory already',
    gate: null, alsoNeeds: 'Relics you are willing to part with.', live: null,
    cycle: 'instant', output: 'stack', liquidity: 'steady', squad: 'solo', setup: 'none',
    needsCapital: true, timeGated: false, beginnerFriendly: true,
  },
  {
    id: 'requiem-relics', name: 'Requiem relics for Requiem mods', family: 'nemesis',
    how: 'Requiem fissures pay the eight Requiem mods, and every player hunting a Lich or Sister needs a matching set with charges left. Demand renews every time somebody starts a new nemesis, which is constantly.',
    sells: 'Requiem mods', where: 'Requiem Void Fissures, and the Kuva Fortress',
    gate: 'The War Within', alsoNeeds: 'Requiem relics, which drop in the Kuva Fortress and from Requiem fissures.', live: 'fissures',
    cycle: 'short', output: 'stack', liquidity: 'fast', squad: 'better-squad', setup: 'none',
    needsCapital: true, timeGated: false, beginnerFriendly: false,
  },
  {
    // NOT `paysDucats`: this one SPENDS ducats and produces platinum, which is
    // the step that actually belongs in a platinum ranking.
    id: 'baro-flip', name: 'Flip Baro stock for platinum', family: 'prime',
    how: 'Baro Ki’Teer sells for Ducats and Credits, and much of what he brings resells to players for platinum. This is the step that turns the Ducat pile into actual currency, and it only exists for the forty-eight hours he is docked.',
    sells: 'Whatever he brought — primed mods, weapons, cosmetics', where: 'Baro Ki’Teer, at a relay, every two weeks',
    gate: null, alsoNeeds: 'Ducats and Credits in hand before he lands.', live: 'baro',
    cycle: 'instant', output: 'set', liquidity: 'steady', squad: 'solo', setup: 'none',
    needsCapital: true, timeGated: true, beginnerFriendly: false,
  },
  {
    id: 'ayatan-stars', name: 'Ayatan stars, sold in bulk', family: 'other', betterWith: [{ name: 'Nekros', why: 'stars drop from enemies, and Desecrate rolls each one twice' }],
    how: 'Amber and Cyan stars drop constantly and are worth very little each, but everyone filling sculptures for Endo needs them and nobody enjoys farming them. This is a volume trade, not a value one.',
    sells: 'Amber and Cyan Ayatan stars', where: 'Any mission — they drop from containers and enemies',
    gate: null, alsoNeeds: null, live: null,
    cycle: 'instant', output: 'stack', liquidity: 'steady', squad: 'solo', setup: 'none',
    needsCapital: true, timeGated: false, beginnerFriendly: true,
  },
  {
    id: 'focus-lenses', name: 'Focus lenses', family: 'other',
    how: 'Lenses come from Sorties, Eidolon bounties and the occasional event, and every player levelling Focus wants Eidolon-grade ones. They are small, they stack, and demand never really stops.',
    sells: 'Focus lenses', where: 'Sortie rewards, Cetus bounties, events',
    gate: null, alsoNeeds: null, live: 'sortie',
    cycle: 'medium', output: 'stack', liquidity: 'steady', squad: 'solo', setup: 'none',
    needsCapital: false, timeGated: true, beginnerFriendly: false,
  },
  {
    id: 'arcane-helmets', name: 'Arcane helmets', family: 'other',
    how: 'Twenty-seven alternate helmets from long-finished events. They cannot drop any more, so supply only ever shrinks, and they are among the very few cosmetics in the game that can be traded at all.',
    sells: 'Arcane helmets', where: 'Nowhere — they are no longer obtainable, only traded',
    gate: null, alsoNeeds: 'One you already own, or the platinum to buy low and hold.', live: null,
    cycle: 'instant', output: 'set', liquidity: 'slow', squad: 'solo', setup: 'none',
    needsCapital: true, timeGated: false, beginnerFriendly: false,
  },
  {
    id: 'syndicate-weapons', name: 'Vandal, Wraith and Prisma weapons', family: 'syndicate',
    how: 'Event and vendor variants of ordinary weapons. Some return periodically through Baro or an event; others are gone for good. An unaltered one — no forma, no catalyst, no ranked-up XP — is what buyers want.',
    sells: 'Vandal, Wraith and Prisma weapons', where: 'Baro, events, and the Sanctuary Onslaught rotation',
    gate: null, alsoNeeds: 'The weapon still in its original state; modifying it ends the trade.', live: 'baro',
    cycle: 'instant', output: 'set', liquidity: 'slow', squad: 'solo', setup: 'none',
    needsCapital: true, timeGated: false, beginnerFriendly: false,
  },
  {
    id: 'kahl-mods', name: 'Kahl’s Archon mods', family: 'mods',
    how: 'Kahl’s weekly Break Narmer mission pays Stock, and Chipper sells the five Archon mods for it. They are strong, they are weekly-capped, and they trade well.',
    sells: 'Archon Vitality, Continuity, Stretch, Intensify and Flow', where: 'Chipper, for Stock from Kahl’s weekly mission',
    gate: 'Veilbreaker', alsoNeeds: null, live: null,
    cycle: 'medium', output: 'set', liquidity: 'steady', squad: 'solo', setup: 'none',
    needsCapital: false, timeGated: true, beginnerFriendly: false,
  },
  {
    id: 'holdfasts-arcanes', name: 'Holdfasts standing into arcanes', family: 'arcanes', needsRank: { tag: 'ZarimanSyndicate', rank: 3, who: 'The Holdfasts' },
    how: 'The Zariman syndicate sells arcanes outright for standing rather than dropping them. No luck involved: farm the standing, buy the arcane, sell it. The published prices make the conversion rate knowable in advance.',
    sells: 'Zariman arcanes', where: 'Cavalero, on the Zariman',
    gate: 'Angels of the Zariman', alsoNeeds: 'Holdfasts standing, which is capped daily.', live: null,
    cycle: 'long', output: 'stack', liquidity: 'fast', squad: 'solo', setup: 'light',
    needsCapital: false, timeGated: true, beginnerFriendly: false,
  },
  {
    id: 'conclave-augments', name: 'Conclave augment mods', family: 'syndicate',
    how: 'Teshin sells warframe augments for Conclave standing, which comes from its own daily pool and is untouched by the six faction syndicates. Most players never touch Conclave, so supply stays thin.',
    sells: 'Conclave augment mods', where: 'Teshin, in any relay',
    gate: null, alsoNeeds: 'Conclave standing, earned in PvP matches.', live: null,
    cycle: 'long', output: 'set', liquidity: 'slow', squad: 'needs-squad', setup: 'light',
    needsCapital: false, timeGated: true, beginnerFriendly: false,
  },
  {
    id: 'maroo-ayatan', name: 'Maroo’s weekly Ayatan hunt', family: 'other',
    how: 'One sculpture hunt a week from Maroo, in a mission built around finding it. A single guaranteed sculpture, and the rarer ones carry real value.',
    sells: 'Ayatan sculptures', where: 'Maroo’s Bazaar, weekly',
    gate: null, alsoNeeds: null, live: null,
    cycle: 'medium', output: 'set', liquidity: 'steady', squad: 'solo', setup: 'none',
    needsCapital: false, timeGated: true, beginnerFriendly: true,
  },
];

export type RouteStatus = 'open' | 'blocked' | 'unknown' | 'pays-nothing';

export interface RouteState {
  route: PlatRoute;
  status: RouteStatus;
  /** Why, in the player's words. Empty when it is simply open. */
  reason: string;
}

/**
 * Can this account do this route?
 *
 * `open` means the gate is finished, or there is no gate. `blocked` means the
 * account positively shows the gating quest unfinished. `unknown` means we could
 * not tell - no account, or a quest the catalog cannot place - and it is never
 * silently promoted to open.
 */
export function routeState(route: PlatRoute, catalog: Catalog | null, picture: AccountPicture): RouteState {
  /*
   * Measured-worthless outranks every other verdict, including "you have not
   * unlocked this yet". Calling such a route blocked implies it would be worth
   * unlocking, which is the opposite of what was measured.
   */
  if (route.paysNothing !== undefined) return { route, status: 'pays-nothing', reason: route.paysNothing };
  if (route.gate === null) return { route, status: 'open', reason: '' };
  if (!catalog) return { route, status: 'unknown', reason: `Needs ${route.gate}; your account has not been read.` };

  const key = catalog.questKeyByName.get(route.gate.toLowerCase());
  const quest = key ? catalog.questByKey.get(key) : undefined;
  if (!quest) return { route, status: 'unknown', reason: `Needs ${route.gate}, which is not in the quest catalog.` };

  const done = questDone(quest, picture);
  if (done === null) return { route, status: 'unknown', reason: `Needs ${route.gate}; whether you finished it cannot be confirmed.` };
  if (done) return { route, status: 'open', reason: '' };
  return { route, status: 'blocked', reason: `Needs ${route.gate} first.` };
}

export const FAMILY_LABEL: Record<RouteFamily, string> = {
  prime: 'The prime economy',
  mods: 'Mods',
  arcanes: 'Arcanes',
  nemesis: 'Liches and Sisters',
  syndicate: 'Syndicates',
  railjack: 'Railjack',
  trading: 'Trading itself',
  other: 'Everything else',
};

export const CYCLE_LABEL: Record<Cycle, string> = {
  instant: 'no mission',
  short: 'a few minutes',
  medium: 'a mission or three',
  long: 'a long run',
  session: 'a whole session',
};

export const OUTPUT_LABEL: Record<Output, string> = {
  stack: 'many small items',
  set: 'one worthwhile item',
  lottery: 'rare and unpredictable',
  capital: 'a currency you spend',
};
