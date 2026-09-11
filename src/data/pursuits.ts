/**
 * Pursuits — every distinct thing a Warframe player can be working toward.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The Progression panel was showing four tiles and a short list. What a
 * completionist actually needs is the whole board: every pursuit in the game,
 * ranked, with the ranking changing according to which KIND of completion they
 * are chasing. Someone hunting Mastery Rank and someone finishing the star chart
 * want different advice from the same account.
 *
 * So this file is two things:
 *
 *   1. A TAXONOMY of every pursuit the game contains, grouped into the domains a
 *      player actually thinks in. This is the "literally everything" half, and it
 *      is deliberately exhaustive even where the account data cannot yet measure
 *      a domain - a pursuit we cannot measure is reported as unmeasured, never
 *      silently dropped. Omitting it would quietly narrow the definition of
 *      "complete".
 *
 *   2. A set of GOAL PROFILES. Each profile re-weights the domains, so the same
 *      account produces a different ranking depending on what the player is
 *      actually going for.
 *
 * Nothing here invents data. A pursuit carries `measurable: false` until the
 * account genuinely exposes it, and the UI must say so rather than show a zero.
 */

export type Domain =
  | 'narrative' // quests, junctions, the story spine
  | 'starchart' // nodes, Steel Path, exploration
  | 'mastery' // rank, levelling, unowned items
  | 'collection' // owning things: frames, weapons, companions
  | 'mods' // mod collection, ranks, primed and riven
  | 'relics' // relics, prime parts, completed sets
  | 'arcanes' // arcanes and their ranks
  | 'operator' // focus schools, waybound, amps
  | 'railjack' // intrinsics, research, crew, Proxima
  | 'syndicate' // standing, ranks, offerings
  | 'nemesis' // liches, sisters, coda
  | 'events' // Nightwave, invasions, time-limited
  | 'routine' // dailies, weeklies, resets
  | 'economy' // resources, credits, foundry throughput
  | 'codex' // scans, fragments, lore
  | 'endgame'; // Steel Path, Archimedea, Netracells, Circuit

/** How a pursuit behaves, which decides how it should be scheduled. */
export type Cadence =
  | 'once' // one-and-done forever
  | 'daily'
  | 'weekly'
  | 'seasonal' // Nightwave, events
  | 'fortnightly' // the Void Trader
  | 'grind'; // open-ended accumulation

export interface Pursuit {
  id: string;
  /** Player-facing, phrased as a thing to pursue. */
  label: string;
  domain: Domain;
  cadence: Cadence;
  /**
   * What this contributes when finished, in comparable units across domains.
   * 1000 gates major content, 100 is a meaningful step, 10 is a tick.
   */
  weight: number;
  /** One line on what it actually is, for a player who does not know. */
  detail: string;
  /** Measured as done-or-not, never as a fraction. */
  binary?: true;
  /**
   * False until the account data genuinely exposes this. An unmeasurable pursuit
   * is still listed - it is part of "complete" - but shown as unmeasured rather
   * than as zero progress, which would be a claim we cannot support.
   */
  measurable: boolean;
  /** Where in the app the player goes to work on it. */
  panel?: string;
  /**
   * The quest that opens this, by catalog name. Sorties need The War Within,
   * Archon Hunts need Veilbreaker, Netracells need Whispers in the Walls: real
   * rules of the game, and without them the expiry lane told a Mars-tier
   * account to do Deep Archimedea tonight.
   */
  gate?: string;
  /** Opens only once every star chart node is cleared (the Steel Path). */
  gateChart?: true;
}

/**
 * THE BOARD.
 *
 * Every pursuit the game contains. Weights are the intrinsic value of finishing
 * the thing; goal profiles below then scale them by domain.
 */
export const PURSUITS: readonly Pursuit[] = [
  // ---- narrative ---------------------------------------------------------
  { id: 'quests.main', label: 'Mainline quest line', domain: 'narrative', cadence: 'once', weight: 1000, detail: 'The story spine. Gates entire systems, planets and frames.', measurable: true, panel: 'progression' },
  { id: 'quests.side', label: 'Side quests', domain: 'narrative', cadence: 'once', weight: 420, detail: 'Optional quests, most of which award a frame or weapon.', measurable: true, panel: 'progression' },
  { id: 'junctions', label: 'Junctions', domain: 'narrative', cadence: 'once', weight: 700, detail: 'Hard gates between planets. Each is 1,000 mastery and opens a world.', measurable: true, panel: 'starchart' },

  // ---- star chart --------------------------------------------------------
  { id: 'nodes.normal', label: 'Star chart nodes', domain: 'starchart', cadence: 'once', weight: 500, detail: 'Every mission node cleared once. Each pays mastery.', measurable: true, panel: 'starchart' },
  { id: 'nodes.steel', label: 'Steel Path', domain: 'endgame', cadence: 'once', gateChart: true, weight: 450, detail: 'The whole chart again at higher difficulty. Pays mastery a second time.', measurable: true, panel: 'starchart' },
  { id: 'nodes.hidden', label: 'Hidden and event nodes', domain: 'starchart', cadence: 'once', weight: 120, detail: 'Derelicts, event nodes, Sanctuary Onslaught, Lua caves.', measurable: false, panel: 'starchart' },

  // ---- mastery -----------------------------------------------------------
  { id: 'mastery.unranked', label: 'Rank up what you own', domain: 'mastery', cadence: 'grind', weight: 300, detail: 'Owned items not yet at max rank. The cheapest mastery there is - no acquisition needed.', measurable: true, panel: 'mastery' },
  { id: 'mastery.unowned', label: 'Acquire unowned masterable items', domain: 'mastery', cadence: 'grind', weight: 260, detail: 'Every weapon, frame and companion you have never owned.', measurable: true, panel: 'mastery' },
  { id: 'mastery.gilding', label: 'Gild modular items', domain: 'mastery', cadence: 'grind', weight: 180, detail: 'Zaws, Kitguns, Amps, MOAs and Hounds pay mastery only once gilded.', measurable: false, panel: 'mastery' },
  { id: 'mastery.rank', label: 'Mastery Rank tests', domain: 'mastery', cadence: 'once', weight: 200, detail: 'The rank-up test itself, available once every 24 hours.', measurable: true, panel: 'mastery' },

  // ---- collection --------------------------------------------------------
  { id: 'collection.frames', label: 'Warframes', domain: 'collection', cadence: 'grind', weight: 320, detail: 'Every Warframe, including Primes and Umbra.', measurable: true, panel: 'collection' },
  { id: 'collection.primary', label: 'Primary weapons', domain: 'collection', cadence: 'grind', weight: 240, detail: 'Rifles, shotguns, bows, launchers.', measurable: true, panel: 'collection' },
  { id: 'collection.secondary', label: 'Secondary weapons', domain: 'collection', cadence: 'grind', weight: 240, detail: 'Pistols, throwables, Kitguns.', measurable: true, panel: 'collection' },
  { id: 'collection.melee', label: 'Melee weapons', domain: 'collection', cadence: 'grind', weight: 240, detail: 'Every melee, including Zaws and stances.', measurable: true, panel: 'collection' },
  { id: 'collection.companions', label: 'Companions', domain: 'collection', cadence: 'grind', weight: 200, detail: 'Sentinels, Kubrows, Kavats, MOAs, Hounds, Predasites, Vulpaphylas.', measurable: true, panel: 'collection' },
  { id: 'collection.archwing', label: 'Archwing and arch-weapons', domain: 'collection', cadence: 'grind', weight: 160, detail: 'Archwings, arch-guns and arch-melee.', measurable: true, panel: 'collection' },
  { id: 'collection.necramech', label: 'Necramechs', domain: 'collection', cadence: 'grind', weight: 150, detail: 'Voidrig and Bonewidow. Worth 8,000 mastery each.', measurable: false, panel: 'collection' },
  { id: 'collection.vehicles', label: 'K-Drives, Kaithe, Atomicycle', domain: 'collection', cadence: 'grind', weight: 90, detail: 'Hoverboards, the Duviri Kaithe and the 1999 Atomicycle.', measurable: false, panel: 'collection' },

  // ---- mods --------------------------------------------------------------
  { id: 'mods.collection', label: 'Mod collection', domain: 'mods', cadence: 'grind', weight: 220, detail: 'Every distinct mod in the game. Roughly 1,500 of them.', measurable: true, panel: 'collection' },
  { id: 'mods.maxed', label: 'Max-rank your mods', domain: 'mods', cadence: 'grind', weight: 180, detail: 'Endo and credits sunk into ranking what you already hold.', measurable: false, panel: 'collection' },
  { id: 'mods.primed', label: 'Primed and Galvanized mods', domain: 'mods', cadence: 'grind', weight: 200, detail: 'Baro exclusives and Steel Path / Arbitration mods.', measurable: false, panel: 'collection' },
  { id: 'mods.rivens', label: 'Rivens', domain: 'mods', cadence: 'grind', weight: 120, detail: 'Riven mods, their challenges and rolls.', measurable: false, panel: 'collection' },

  // ---- relics and primes -------------------------------------------------
  { id: 'relics.owned', label: 'Relics', domain: 'relics', cadence: 'grind', weight: 150, detail: 'Lith, Meso, Neo, Axi and Requiem relics.', measurable: false, panel: 'collection' },
  { id: 'relics.sets', label: 'Complete prime sets', domain: 'relics', cadence: 'grind', weight: 280, detail: 'Sets missing one or two parts are the highest-value farming targets.', measurable: false, panel: 'collection' },
  { id: 'relics.vaulted', label: 'Vaulted primes', domain: 'relics', cadence: 'grind', weight: 100, detail: 'Currently unobtainable except by trade or Prime Resurgence.', measurable: false, panel: 'collection' },

  // ---- arcanes -----------------------------------------------------------
  { id: 'arcanes.collection', label: 'Arcanes', domain: 'arcanes', cadence: 'grind', weight: 170, detail: 'Every arcane, from Eidolons, Profit-Taker, Deimos and the Zariman.', measurable: false, panel: 'collection' },
  { id: 'arcanes.maxed', label: 'Max-rank arcanes', domain: 'arcanes', cadence: 'grind', weight: 130, detail: 'Each rank needs multiple copies of the same arcane.', measurable: false, panel: 'collection' },

  // ---- operator ----------------------------------------------------------
  { id: 'focus.schools', label: 'Focus schools', domain: 'operator', cadence: 'grind', weight: 240, detail: 'Madurai, Vazarin, Naramon, Unairu, Zenurik - every node unlocked.', measurable: true, panel: 'focus' },
  { id: 'focus.waybound', label: 'Waybound nodes', domain: 'operator', cadence: 'grind', weight: 260, detail: 'Cross-school passives. Require completing another school to unlock.', measurable: false, panel: 'focus' },
  { id: 'operator.amps', label: 'Amps', domain: 'operator', cadence: 'grind', weight: 120, detail: 'Amp parts from the Quills and Vox Solaris, gilded for mastery.', measurable: false, panel: 'collection' },
  { id: 'operator.arcanes', label: 'Operator arcanes', domain: 'operator', cadence: 'grind', weight: 110, detail: 'Magus, Virtuos and Exodia arcanes.', measurable: false, panel: 'collection' },

  // ---- railjack ----------------------------------------------------------
  { id: 'railjack.intrinsics', label: 'Railjack intrinsics', domain: 'railjack', cadence: 'grind', weight: 230, detail: 'Piloting, Gunnery, Engineering, Tactical, Command. 1,500 mastery per rank.', measurable: true, panel: 'intrinsics' },
  { id: 'railjack.drifter', label: 'Drifter intrinsics', domain: 'railjack', cadence: 'grind', weight: 200, detail: 'Riding, Combat, Opportunity, Endurance. Also 1,500 mastery per rank.', measurable: true, panel: 'intrinsics' },
  { id: 'railjack.research', label: 'Railjack armaments and research', domain: 'railjack', cadence: 'grind', weight: 140, detail: 'Zetki, Vidar and Lavan components and weapons.', measurable: false, panel: 'collection' },
  { id: 'railjack.proxima', label: 'Proxima regions', domain: 'railjack', cadence: 'once', weight: 180, detail: 'Earth, Venus, Saturn, Neptune, Pluto and Veil Proxima nodes.', measurable: true, panel: 'starchart' },
  { id: 'railjack.crew', label: 'Crew members', domain: 'railjack', cadence: 'grind', weight: 90, detail: 'Hired and converted crew, and their command ranks.', measurable: false, panel: 'intrinsics' },

  // ---- syndicates --------------------------------------------------------
  { id: 'syndicate.ranks', label: 'Syndicate ranks', domain: 'syndicate', cadence: 'grind', weight: 210, detail: 'Max rank with every syndicate, including the open-world and Holdfast factions.', measurable: true, panel: 'syndicates' },
  { id: 'syndicate.daily', label: 'Daily standing cap', domain: 'syndicate', cadence: 'daily', weight: 160, detail: 'Use-it-or-lose-it. The cap scales with Mastery Rank.', measurable: false, panel: 'syndicates' },
  { id: 'syndicate.offerings', label: 'Syndicate offerings', domain: 'syndicate', cadence: 'grind', weight: 130, detail: 'Weapons, mods, arcanes and cosmetics bought with standing.', measurable: false, panel: 'syndicates' },

  // ---- nemesis -----------------------------------------------------------
  { id: 'nemesis.active', label: 'Resolve your nemesis', domain: 'nemesis', cadence: 'once', binary: true, gate: 'The War Within', weight: 300, detail: 'An active lich taxes your rewards and holds nodes until vanquished or converted.', measurable: true, panel: 'nemesis' },
  { id: 'nemesis.weapons', label: 'Nemesis weapons', domain: 'nemesis', cadence: 'grind', gate: 'The War Within', weight: 190, detail: 'Kuva, Tenet and Coda weapons - a large block of mastery.', measurable: false, panel: 'nemesis' },
  { id: 'nemesis.ephemera', label: 'Nemesis ephemera', domain: 'nemesis', cadence: 'grind', weight: 70, detail: 'Rare cosmetic drops from liches and sisters.', measurable: false, panel: 'nemesis' },

  // ---- events ------------------------------------------------------------
  { id: 'events.nightwave', label: 'Nightwave', domain: 'events', cadence: 'seasonal', weight: 250, detail: 'Seasonal challenges. Rewards expire when the season ends.', measurable: false, panel: 'daily' },
  { id: 'events.invasions', label: 'Invasions', domain: 'events', cadence: 'grind', weight: 120, detail: 'Rotating faction conflicts paying resources and weapon parts.', measurable: false, panel: 'worldstate' },
  { id: 'events.baro', label: 'Void Trader', domain: 'events', cadence: 'fortnightly', weight: 110, detail: 'Baro Ki’Teer arrives every two weeks with Primed mods and vaulted items.', measurable: false, panel: 'worldstate' },
  { id: 'events.limited', label: 'Limited-time events', domain: 'events', cadence: 'seasonal', weight: 200, detail: 'Operations and tactical alerts. Frequently the only source of an item.', measurable: false, panel: 'worldstate' },

  // ---- routine -----------------------------------------------------------
  { id: 'routine.sortie', label: 'Daily sortie', domain: 'routine', cadence: 'daily', gate: 'The War Within', weight: 180, detail: 'Three linked missions with modifiers. Rewards rivens, forma and Endo.', measurable: false, panel: 'daily' },
  { id: 'routine.archon', label: 'Archon Hunt', domain: 'routine', cadence: 'weekly', gate: 'Veilbreaker', weight: 200, detail: 'Weekly three-mission hunt rewarding an Archon Shard.', measurable: false, panel: 'daily' },
  { id: 'routine.netracells', label: 'Netracells', domain: 'endgame', cadence: 'weekly', gate: 'Whispers in the Walls', weight: 190, detail: 'Five weekly runs for Archon Shards and Tauforged.', measurable: false, panel: 'daily' },
  { id: 'routine.archimedea', label: 'Deep Archimedea', domain: 'endgame', cadence: 'weekly', gate: 'Whispers in the Walls', weight: 210, detail: 'Weekly high-difficulty Cavia content with a modifier draft.', measurable: false, panel: 'daily' },
  { id: 'routine.circuit', label: 'The Circuit', domain: 'endgame', cadence: 'weekly', gate: 'The Duviri Paradox', weight: 200, detail: 'Duviri’s weekly rotation. The only source of Incarnon Genesis adapters.', measurable: false, panel: 'daily' },
  { id: 'routine.kahl', label: 'Kahl’s Garrison', domain: 'routine', cadence: 'weekly', gate: 'Veilbreaker', weight: 120, detail: 'Weekly Veilbreaker mission paying Stock toward an Archon Shard.', measurable: false, panel: 'daily' },
  { id: 'routine.simaris', label: 'Daily Simaris target', domain: 'codex', cadence: 'daily', weight: 90, detail: 'A daily synthesis target paying standing toward Simaris offerings.', measurable: false, panel: 'daily' },
  { id: 'routine.login', label: 'Daily login tribute', domain: 'routine', cadence: 'daily', weight: 60, detail: 'Login rewards, and the milestone rewards at 50-day intervals.', measurable: false, panel: 'daily' },

  // ---- economy -----------------------------------------------------------
  { id: 'economy.foundry', label: 'Claim and start builds', domain: 'economy', cadence: 'grind', binary: true, weight: 240, detail: 'Finished items occupy a slot until claimed; an idle foundry is wasted time.', measurable: true, panel: 'foundry' },
  { id: 'economy.resources', label: 'Resource shortfalls', domain: 'economy', cadence: 'grind', weight: 170, detail: 'Materials you are short of for something you already have the blueprint for.', measurable: false, panel: 'resources' },
  { id: 'economy.forma', label: 'Forma and potatoes', domain: 'economy', cadence: 'grind', weight: 130, detail: 'Polarising gear, and Orokin catalysts and reactors.', measurable: false, panel: 'arsenal' },
  { id: 'economy.credits', label: 'Credits and Endo', domain: 'economy', cadence: 'grind', weight: 80, detail: 'The currency floor under mod ranking and crafting.', measurable: true, panel: 'resources' },

  // ---- codex -------------------------------------------------------------
  { id: 'codex.scans', label: 'Codex scans', domain: 'codex', cadence: 'grind', weight: 100, detail: 'Every enemy and object scanned. Simaris standing and full codex entries.', measurable: false, panel: 'collection' },
  { id: 'codex.fragments', label: 'Fragments and lore', domain: 'codex', cadence: 'grind', weight: 80, detail: 'Cephalon Fragments, Somachord tones, Kuria and Lore fragments.', measurable: false, panel: 'collection' },
  { id: 'codex.dojo', label: 'Dojo research', domain: 'economy', cadence: 'grind', weight: 110, detail: 'Clan lab research - a required source for many masterable weapons.', measurable: false, panel: 'collection' },
  { id: 'codex.conclave', label: 'Conclave', domain: 'events', cadence: 'grind', weight: 50, detail: 'PvP standing and its exclusive cosmetics and mods.', measurable: false, panel: 'syndicates' },
];

/**
 * Goal profiles.
 *
 * The same account should produce different advice depending on what the player
 * is chasing. A profile multiplies each domain, so a Mastery-focused player is
 * pushed toward levelling and acquisition while a story-focused one is pushed
 * toward quests - without either being shown a different, incompatible board.
 *
 * `Everything` is deliberately flat: it is the true completionist view where no
 * domain is privileged.
 */
export interface GoalProfile {
  id: string;
  label: string;
  detail: string;
  weights: Partial<Record<Domain, number>>;
}

export const GOALS: readonly GoalProfile[] = [
  {
    id: 'everything',
    label: 'Everything',
    detail: 'True completion. No domain is privileged over any other.',
    weights: {},
  },
  {
    id: 'mastery',
    label: 'Mastery Rank',
    detail: 'Fastest route up the ranks: level what you own, then acquire what is cheapest.',
    weights: { mastery: 2.4, collection: 1.8, railjack: 1.5, nemesis: 1.3, starchart: 1.2, narrative: 1.1 },
  },
  {
    id: 'starchart',
    label: 'Star Chart',
    detail: 'Clear the solar system, then clear it again on Steel Path.',
    weights: { starchart: 2.6, narrative: 1.6, endgame: 1.4, railjack: 1.2 },
  },
  {
    id: 'story',
    label: 'Story',
    detail: 'The narrative spine and everything gated behind it.',
    weights: { narrative: 2.8, starchart: 1.3, operator: 1.4 },
  },
  {
    id: 'collection',
    label: 'Collection',
    detail: 'Own one of everything: frames, weapons, companions, mods, arcanes.',
    weights: { collection: 2.4, mods: 2.0, relics: 1.9, arcanes: 1.7, nemesis: 1.3 },
  },
  {
    id: 'endgame',
    label: 'Endgame',
    detail: 'Steel Path, Archon Shards, Netracells, Deep Archimedea, the Circuit.',
    weights: { endgame: 2.6, operator: 1.7, mods: 1.4, routine: 1.3 },
  },
  {
    id: 'efficient',
    label: 'Best use of tonight',
    detail: 'Whatever expires soonest or is free to claim, then the highest-value grind.',
    weights: { routine: 2.4, economy: 2.0, events: 1.9, syndicate: 1.6 },
  },
];

/** Tier a pursuit falls into once weighted. Drives the grouped presentation. */
export type Tier = 'now' | 'high' | 'steady' | 'longterm';

export const TIER_LABEL: Record<Tier, string> = {
  now: 'Do now',
  high: 'High priority',
  steady: 'Steady progress',
  longterm: 'Long term',
};

export const TIER_DETAIL: Record<Tier, string> = {
  now: 'Expiring, free, or blocking something else.',
  high: 'The best return on your next few sessions.',
  steady: 'Accumulates while you do other things.',
  longterm: 'Measured in months. Chip away.',
};

export interface RankedPursuit extends Pursuit {
  score: number;
  tier: Tier;
  /** 0..1 where measurable, else null. Never a fabricated zero. */
  progress: number | null;
}

/**
 * Rank the whole board for a goal.
 *
 * `progressFor` is supplied by the caller and reads real account state; a domain
 * it cannot measure returns null and the pursuit is still listed, marked
 * unmeasured. Dropping it would quietly redefine what "complete" means.
 */
export function rankPursuits(
  goal: GoalProfile,
  progressFor: (p: Pursuit) => number | null,
): RankedPursuit[] {
  const ranked = PURSUITS.map((p): RankedPursuit => {
    const progress = p.measurable ? progressFor(p) : null;
    const multiplier = goal.weights[p.domain] ?? 1;

    /*
     * Something already finished should sink, so remaining work floats up.
     *
     * AN UNMEASURED PURSUIT GETS THE MIDPOINT, NOT THE MAXIMUM.
     * ————————————————————————————
     * This used to read `progress == null ? 1 : ...` and defend it as "the
     * conservative direction, since it keeps it visible". It does keep it
     * visible - by asserting the single most favourable thing that could be
     * true of it. `remaining = 1` is not neutral; it is a claim that NONE of
     * this pursuit is done, and it is the same fabrication this codebase
     * refuses everywhere a number is printed.
     *
     * Twenty-eight of the fifty-five pursuits are `measurable: false`, so
     * twenty-eight sat permanently at full remaining weight. A player who
     * finished this season's Nightwave, ran today's sortie, cleared all five
     * Netracells and beat this week's Circuit saw all four of them in "Do now",
     * on every reload, for ever - because the board had decided, on no
     * evidence, that they had done none of it.
     *
     * The midpoint is what "we do not know" actually scores as: the term runs
     * 0.25 when finished to 1.0 when untouched, so an unknown sits at 0.625 and
     * the pursuit ranks on the things we DO know - its weight, the goal
     * profile, and its cadence. It neither floats to the top on a guess nor
     * sinks out of sight, and `progress: null` still reaches the panel, which
     * already prints "not measured" rather than a percentage.
     */
    const UNKNOWN_REMAINING = 0.625;
    const remaining = progress == null ? UNKNOWN_REMAINING : 1 - progress;

    // Cadence: expiring things are urgent by nature, one-and-done work is worth
    // more than open-ended grind because it never has to be revisited.
    const cadenceBoost =
      p.cadence === 'daily' ? 1.5 : p.cadence === 'weekly' ? 1.35 : p.cadence === 'fortnightly' ? 1.3 : p.cadence === 'seasonal' ? 1.25 : p.cadence === 'once' ? 1.15 : 1;

    const score = p.weight * multiplier * cadenceBoost * (0.25 + remaining * 0.75);
    return { ...p, score, progress, tier: 'steady' };
  });

  ranked.sort((a, b) => b.score - a.score);

  // Tiers are relative to the top score rather than absolute, so the board stays
  // meaningfully divided whatever goal is selected.
  const top = ranked[0]?.score ?? 1;
  for (const r of ranked) {
    const rel = r.score / top;
    r.tier =
      r.cadence === 'daily' || r.cadence === 'weekly'
        ? rel > 0.55
          ? 'now'
          : 'high'
        : rel > 0.78
          ? 'high'
          : rel > 0.45
            ? 'steady'
            : 'longterm';
  }
  return ranked;
}

export function groupByTier(ranked: RankedPursuit[]): Record<Tier, RankedPursuit[]> {
  const out: Record<Tier, RankedPursuit[]> = { now: [], high: [], steady: [], longterm: [] };
  for (const r of ranked) out[r.tier].push(r);
  return out;
}

/** Domains present on the board, for filter chips. */
export const DOMAIN_LABEL: Record<Domain, string> = {
  narrative: 'Narrative',
  starchart: 'Star Chart',
  mastery: 'Mastery',
  collection: 'Collection',
  mods: 'Mods',
  relics: 'Relics & Primes',
  arcanes: 'Arcanes',
  operator: 'Operator',
  railjack: 'Railjack',
  syndicate: 'Syndicates',
  nemesis: 'Nemesis',
  events: 'Events',
  routine: 'Routine',
  economy: 'Economy',
  codex: 'Codex',
  endgame: 'Endgame',
};
