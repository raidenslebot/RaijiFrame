/**
 * A step that can answer for itself.
 *
 * WHAT WAS WRONG
 * ──────────────
 * `ROUTE_GUIDE` carries 203 steps across 49 farming routes, and they are the
 * most specific writing in the app - "collect ten Reactant before extraction",
 * "sell the junk at a relay kiosk". Every one of them rendered as a dead
 * string. So the deepest layer of the platinum panel was the only layer with
 * nothing to click, and the step that says
 *
 *   "Pick a fissure whose tier matches your relic"
 *
 * sat two modules away from `fissure-match`, which already knows exactly which
 * fissures are live and exactly how many relics of each tier this account
 * holds. The panel even computed a summary of it - "12 open · Lith 3 · Meso 4"
 * - and then answered a different question than the one the step asks. Twelve
 * doors, no word about keys.
 *
 * WHAT A BINDING IS
 * ─────────────────
 * A step may name something the app can settle from live data or the account.
 * It does not carry the answer - it carries the QUESTION, and the answer is
 * resolved at render time against whatever has actually been read. That
 * separation is the point: the guide stays static, checkable content, and
 * nothing in it can go stale or contradict the feed.
 *
 * ABSENT IS NOT ZERO, AGAIN AND EVERYWHERE
 * ────────────────────────────────────────
 * Every resolver returns a null `headline` plus an `unknown` sentence when it
 * cannot answer, and never a zero standing in for a missing read. "No fissures
 * are open" and "the world state has not arrived" are different facts and this
 * file is mostly the discipline of keeping them apart - the same rule
 * `fissure-match` and `Counted` are built on, applied one layer up.
 *
 * A binding that resolves to nothing renders as a plain step. An affordance
 * that opens onto "unknown" is worse than no affordance, because the reader
 * spends a click to learn the app has nothing.
 */

import type { Worldstate } from './worldstate.ts';
import { relicStock, stockLabel, type RelicStock } from './fissure-match.ts';
import type { Holding, Relic } from './plat-value.ts';
import type { SetVerdict } from './set-completion.ts';
import { MODELS, type PriceBook } from './plat-throughput.ts';
import { questDone, type Catalog } from './catalog.ts';
import { pct, type AccountPicture } from './progression.ts';
import { frameAdvice, intrinsics, syndicateRank } from './plat-capability.ts';
import { PLAT_ROUTES } from './plat-routes.ts';
import {
  EquipmentFeature,
  RIVEN_PREFIX,
  hasFeature,
  itemXp,
  pendingBuilds,
  type Equipment,
  type RawAccount,
} from './account.ts';
import type { ItemDb } from './itemdb.ts';
import { epochMs } from './subsystems.ts';
import type { InvasionOffer } from './invasion-value.ts';
import DROP_SOURCES from './vendor/drop-sources.json' with { type: 'json' };
import { nemesisState } from './subsystems.ts';
import type { PlatPosition } from './platinum.ts';
import type { Observed } from './plat-throughput.ts';
import { groupRuns, type MissionRecord } from './missionlog.ts';

/**
 * What a step asks the app to look up.
 *
 * Deliberately a closed union rather than a free-form key: every member here
 * has to be answerable from something the app already fetches, and adding one
 * means adding a resolver that has thought about what "unread" looks like.
 */
export type StepBind =
  /** Live fissures, crossed with the relics this account actually holds. */
  | { of: 'fissures' }
  /** What you hold, by tier, whether or not a fissure is open for it. */
  | { of: 'relics' }
  /** Today's sortie: the boss, and all three missions with their modifiers. */
  | { of: 'sortie' }
  /** This week's Archon Hunt and its three missions. */
  | { of: 'archon' }
  /** Baro: whether he is here, where, and how long is left. */
  | { of: 'baro' }
  /** Varzia, who runs Prime Resurgence. */
  | { of: 'varzia' }
  /** A world cycle, for the routes that only run in one half of it. */
  | { of: 'cycle'; where: 'cetus' | 'vallis' | 'cambion' | 'zariman' | 'duviri' }
  /** The Nightwave acts running right now. */
  | { of: 'nightwave' }
  /** Faction wars in progress, with the reward each side pays. */
  | { of: 'invasions' }
  /** Teshin's rotating Steel Path offer, and what it costs in Essence. */
  | { of: 'steelPath' }
  /**
   * A currency this account holds.
   *
   * Only the two that gate a farming route: Ducats decide whether the Baro
   * loop can start, and Aya decides whether Prime Resurgence can. Both are
   * plain `MiscItems` rows, so an unread account has no number rather than a
   * zero - `resourceCount` cannot tell them apart, which is why the read is
   * checked here before it is called.
   */
  | { of: 'currency'; which: keyof typeof CURRENCY }
  /**
   * Your standing and rank with one syndicate.
   *
   * `tag` is a DE syndicate tag, and only tags confirmed in a primary source
   * are used - the account model is explicit that Quills, Vox, Necraloid and
   * Cavia tags were never observed and must not be hardcoded, so no step binds
   * to one.
   */
  | { of: 'standing'; tag: string; who: string }
  /**
   * The spare prime parts this account is actually holding, worth first.
   *
   * The step that opens the Ducat route says "look at the prime parts you have
   * spare" - and the panel computes precisely that list two sections away, for
   * its own Sell view. Answering the step from it is the difference between an
   * instruction and a shopping list.
   */
  | { of: 'spare' }
  /**
   * Sets this account is one or two parts from completing.
   *
   * `sets-vs-parts` opens with "find the ones that are one or two pieces from a
   * full set", which `set-completion` already answers exactly - including what
   * the missing parts cost and what the assembled set sells for.
   */
  | { of: 'nearSets' }
  /**
   * What THIS route actually sells, item by item, at today's prices.
   *
   * The "sell the duplicates" steps are the last dead end in the guide: they
   * name a category and the reader is left to work out which member of it is
   * worth listing. `plat-throughput` already answers that per route - eighteen
   * of them carry a verified slug list of the items the route produces, and the
   * panel has already priced every one of those slugs to compute the platinum
   * per hour it is showing at the top of the same card.
   *
   * So this costs NOTHING to fetch. It reads the price book the chain was built
   * from, which is why it is safe on a client whose whole reading policy is to
   * be gentle: the request was already made, and its answer was being used for
   * one number and thrown away for every other purpose.
   */
  | { of: 'sells' }
  /**
   * Whether this account has finished the quest the step names.
   *
   * Several routes open with "Finish Angels of the Zariman" or "Finish Heart of
   * Deimos" - a hard prerequisite the account can settle exactly, and which the
   * route's own `gate` field already resolves for its status pill. The step was
   * still telling every reader to go and do it, including the ones who had.
   *
   * `name` is the quest's DISPLAY name and is resolved through the catalog the
   * same way `pursuitGate` does, so nothing here depends on a key path spelled
   * out by hand.
   */
  | { of: 'quest'; name: string }
  /**
   * Star chart progress, for the two routes that a full chart unlocks.
   *
   * Arbitrations and the Steel Path both open on clearing every node, and both
   * steps say so without saying how far off you are - which is the difference
   * between an instruction and a progress bar.
   */
  | { of: 'chart' }
  /**
   * Every frame that changes what this route PRODUCES, and which you own.
   *
   * `betterWith` is a list - each entry a frame and the REASON it alters the
   * output, like "Desecrate rolls the drop table again on every corpse". The
   * panel ran it through `bestFrame`, which returns exactly one and throws the
   * rest away along with every reason but that one's.
   *
   * So a route naming Nekros AND Khora AND Hydroid showed a single pill, and
   * the step that says "bring a frame that clears trash quickly" was left
   * answering a question about SPEED when the list is about YIELD - a different
   * thing, and the one worth knowing. `ownsFrame` returns `boolean | null`, so
   * an unread account is unknown rather than "you do not have it".
   */
  | { of: 'frames' }
  /**
   * The lich, Sister or Coda this account has RIGHT NOW, and how far its
   * murmur has actually got.
   *
   * Fourteen steps across four routes talk about creating a nemesis, working
   * its murmur and guessing the Requiem sequence - and every one of them was
   * written for a reader with no nemesis at all. Somebody three hints in and
   * two wrong guesses down is reading "work its murmur to reveal the Requiem
   * mods in order" as though they had not started.
   *
   * `nemesisState` already reads all of it, honestly: it exposes `weaponIdx`
   * raw and refuses to name the weapon, because the payload stores an index
   * into a manifest this app does not have and "guessing here would be
   * fabrication". Nothing below reaches past what it will say.
   */
  | { of: 'nemesis' }
  /**
   * Trades left today, against the cap your mastery rank sets.
   *
   * Four steps turn on this and none could see it: "a set costs one trade
   * instead of five", "six items per side per trade is the binding limit", "the
   * common ores are not worth a trade slot". Every one of them is arithmetic
   * against a number the account carries and the step could not reach - and it
   * is the number that actually binds, because a route paying 300 platinum over
   * nine trades is worse than one paying 200 over two when you have three left.
   */
  | { of: 'trades' }
  /**
   * Rivens held, and whether there is a slot free to receive another.
   *
   * A veiled Riven from a Sortie needs somewhere to go. `rivenSlotsFree` counts
   * REMAINING slots rather than capacity - the bin misread `subsystems` warns
   * about - and a full bin means the reward is lost, which is the one fact
   * these steps most need to carry.
   */
  | { of: 'rivens' }
  /**
   * Railjack competence, which is not the same as owning one.
   *
   * Two routes need a ship and both say "build a Railjack" as though that were
   * the requirement. It is not: `PlayerSkills` carries the Piloting and Gunnery
   * ranks, the route declares the rank it wants in `needsIntrinsics`, and a
   * hull with rank-1 gunnery is a Void Storm you will not finish.
   *
   * `intrinsics` deliberately reports the RANK and leaves the phrasing to the
   * caller "rather than pronouncing anybody incapable" - so this states the
   * gap and never says you cannot do it.
   */
  | { of: 'intrinsics' }
  /**
   * Your own runs of the mission types this route is timed by.
   *
   * The chain at the top of the card reduces them to one figure. This is the
   * evidence under it: which types you have actually run, the median minutes
   * for each and how many runs that rests on - including the types you have
   * NEVER run, which is why a route says it cannot be timed.
   */
  | { of: 'runs' }
  /**
   * All six faction syndicates, with your rank in each.
   *
   * The augment route opens "pick a syndicate and pledge to it" and the app
   * cannot know which you would pick - but it knows where you already ARE, and
   * that is the answer to the question actually being asked. Somebody at rank 3
   * with Red Veil and rank 0 everywhere else does not have a free choice.
   *
   * Only the six whose tags a primary source confirms. `syndicateRank` returns
   * 0 for "joined nothing" - a real answer, neutral - and null only when the
   * array is absent, which is the unread case.
   */
  | { of: 'syndicates' }
  /**
   * Platinum you can actually spend, and the part of it you can trade away.
   *
   * "Keep enough platinum liquid that you can act when something appears" is
   * the whole flipping route, and it was addressed to a reader whose balance
   * the app is holding. Starter and gift platinum is spendable and never
   * tradable, and `platPosition` keeps them apart - so a wallet that looks
   * healthy can still be unable to buy a set from another player.
   */
  | { of: 'wallet' }
  /**
   * Every open-world cycle at once.
   *
   * "Fish the right water at the right time" names three hubs in one sentence,
   * so a single-cycle binding would answer for one of them and mislead about
   * the others. All four are cheap and already read.
   */
  | { of: 'cycles' }
  /**
   * The nodes YOU have actually run for this route, and what they paid.
   *
   * "Run to the rotation that pays the relic, then extract" is the one step I
   * twice wrote off as unanswerable, on the grounds that the log records a
   * mission and not which rotation you left on. That is true and beside the
   * point: it records the NODE, the duration, and the inventory diff of what
   * actually dropped. So it cannot say "leave on rotation B", and it can say
   * which of the places you have been actually paid you - which is the decision
   * the step is really asking about.
   *
   * Attributed runs only. An unattributed run's loot is UNKNOWN, and counting
   * it as a miss would understate every node on the list - the same denominator
   * rule `dropRates` states one file over.
   */
  | { of: 'spots' }
  /**
   * What the foundry is building right now, and what is already waiting.
   *
   * "Build Dragon Keys in the foundry" is the first step of the corrupted-mod
   * route and it takes real hours - so a reader who started them yesterday is
   * being told to start again, and one who has never queued them does not know
   * the route begins with a wait rather than a mission.
   *
   * `pendingBuilds` is reused rather than rebuilt, and it carries the rule this
   * would otherwise get wrong: there is NO "ready" boolean in the payload, only
   * a completion date, and a build with no date is reported as NOT ready rather
   * than silently treated as finished.
   */
  | { of: 'foundry' }
  /**
   * Which of the prime SETS you hold parts of are out of the drop tables.
   *
   * "Check which of your prime sets are vaulted" is the step, and it is a set
   * question - which is why the relic-level vault flag was the wrong answer to
   * it and was left where relics are the subject. This is the right one: the
   * catalog carries `vaulted` per ITEM, a holding carries both its inventory
   * path and its market slug, and the set is the slug's stem.
   *
   * `vaulted` is ABSENT on many rows and absent means UNKNOWN, not "still
   * dropping" - the catalog says so where it parses the field. So a set is
   * reported vaulted only when a part positively says it is, and the count of
   * sets nobody could settle is reported beside it rather than folded in.
   */
  | { of: 'vaultedSets' }
  /**
   * Credits, which are the half of a Baro purchase people forget.
   *
   * "Everything he sells costs both, and running out of Credits at the kiosk is
   * the usual mistake" - and the account has carried `RegularCredits` the whole
   * time. A step warning about a shortfall it could measure is a step doing
   * half its job.
   */
  | { of: 'credits' }
  /**
   * The Vandal, Wraith and Prisma weapons this account is actually holding.
   *
   * "Identify what you hold" is the first step of that route and it was
   * addressed to somebody who would have to go and look. The variant name is
   * IN the inventory path - `/Lotus/Weapons/.../BratonVandal` - so this is a
   * path match rather than a guess, the same basis `ownsFrame` uses.
   */
  | { of: 'variants' }
  /**
   * What the relics you actually hold are worth opening for.
   *
   * "A relic is worth what its RARE drop is worth, not what its tier is" - and
   * the relic table already carries every reward with its rarity, its published
   * chance and its market slug. The step was telling somebody to go and look up
   * a thing the app had loaded.
   */
  | { of: 'relicRewards' }
  /**
   * Your Ayatan sculptures and stars, and which sculptures are already filled.
   *
   * They do NOT live in `MiscItems` like Ducats and Kuva - they are
   * `FusionTreasures`, which is why a currency lookup would have found nothing
   * and reported it as an unread account. The paths were checked against WFCD:
   * a Cyan Star is `OroFusexOrnamentA`, an Anasa is `OroFusexF`.
   *
   * `Sockets` is the field that matters and is why this is worth a binding at
   * all: "fill a sculpture with stars before selling, a filled one is worth
   * more" is a step about a number the account carries per sculpture.
   */
  | { of: 'ayatan' }
  /**
   * Focus lenses held, split by grade.
   *
   * Two steps turn on which grades you hold - "keep Eidolon lenses for your own
   * frames if you are still building Focus" and "sell the duplicates and the
   * lower grades" - and neither could see the pile they were talking about.
   *
   * Matched on the PATH PREFIX rather than a list of lens names, because the
   * school names are not in the paths at all: Madurai is `AttackLens`, Naramon
   * is `TacticLens`, and the Eidolon grade is `AttackLensOstron`. A per-school
   * table would have been five guesses; the prefix is one verified fact.
   */
  | { of: 'lenses' }
  /**
   * Kahl's weekly, and whether it is already spent.
   *
   * A route capped at once a week is the one where "go and run it" is the most
   * wasteful thing the panel can say, and the account carries the answer: the
   * Kahl affiliation holds `WeeklyMissions`, each with a `CompletedMission`
   * flag. `KahlSyndicate` is one of the tags verified in a primary source.
   *
   * TWO things about that array are NOT in a primary source: whether it is a
   * history of every week or only the current one, and what `WeekCount`
   * counts. So the answer is scoped to the LATEST week the read carried and
   * says exactly that - a sentence that stays true under either shape, and
   * under a stale read. Claiming "this week" would be claiming a calendar this
   * file cannot see.
   */
  | { of: 'kahl' }
  /**
   * Which live invasion rewards are actually worth platinum.
   *
   * "Catalysts and Reactors are always in demand; weapon parts sell if the
   * weapon is popular" is a step about THIS invasion rotation, not about
   * invasions in general - and the panel already computes the answer for its
   * own section, live and priced. The step was restating a general rule beside
   * a screen that knew the specific one.
   *
   * Distinct from `invasions`, which lists every live front and both sides'
   * rewards. That answers "what is running"; this answers "which of those pays
   * something a player would buy", and drops the Forma that is most of them.
   */
  | { of: 'invasionValue' }
  /**
   * Which planets are cleared, because that is what opens Nightmare missions.
   *
   * "Clear a planet fully to make its Nightmare missions appear" is a gate, and
   * the app holds both halves: `catalog.planetNodes` is planet -> node ids, and
   * `picture.clearedNodes` is the set you have done. The step was describing a
   * requirement the panel could have measured for every planet at once.
   */
  | { of: 'planets' }
  /**
   * Cleared nodes of one faction where a nemesis can be started.
   *
   * Both nemesis routes open with "go to a node of faction X", and a node
   * carries every criterion: `enemy` is the faction, `minLevel` is the level,
   * and `clearedNodes` says whether you can actually go there. Sending a player
   * to look this up on a wiki, from inside an app holding the node table, is
   * the failure this whole binding layer exists to fix.
   *
   * `minLevel` is NULL for the Sister route on purpose. The Larvling step says
   * "level-20-plus" and that number is applied because THE STEP states it; the
   * Treasurer step says only "level-appropriate", and no primary source here
   * gives a threshold - so the levels are shown and the player judges, rather
   * than this file inventing a floor and hiding qualifying nodes behind it.
   */
  | { of: 'nemesisNode'; faction: 'Grineer' | 'Corpus'; minLevel: number | null }
  /**
   * Arcane helmets held. The step's own words are "many long-running accounts
   * hold one without realising", which is a question addressed to the app.
   *
   * The 27 are listed EXACTLY, because nothing else identifies them. Their
   * paths do not contain the word arcane - an Arcane Aura Helmet is
   * `/Lotus/Upgrades/Skins/Trinity/TrinityHelmetAlt` - and they share the
   * `/Lotus/Upgrades/Skins/` prefix with 665 ordinary helmets. The obvious
   * suffix rule (`...HelmetAlt`, `...AltHelmet`) was measured against the live
   * export and returns 84 rows, of which 57 are modern cosmetics like the Atlas
   * Tartarus and Baruuk Meroe helmets. Telling somebody they hold a valuable
   * event item when they hold a store skin is worse than saying nothing, so
   * this is a closed set with a live gate rather than a pattern.
   */
  /**
   * The Circuit's current frame and weapon selection.
   *
   * "Pick from the week's offered frames and weapons - you use what the
   * rotation gives, not your own loadout" is a question with a live answer, and
   * this file said it had none. It was classified from the TYPESCRIPT MODEL,
   * where `duviriCycle.choices` sat as an unread `unknown[]`, rather than from
   * the feed, where it arrives fully populated. That is the second time the
   * model has been mistaken for the data - Varzia's inventory was the first.
   *
   * The normal group names warframes and the hard group names the Incarnon
   * Genesis weapons, which is the same split the route's own steps make.
   */
  | { of: 'circuit' }
  /**
   * Where a cosmetic family actually drops.
   *
   * "Find which mission or boss drops the scene you want" and "pick a specific
   * ephemera and find its source" both send the player to a wiki for a fact the
   * drop table publishes. The table is 4.3 MB, so the 79 rows that matter are
   * vendored instead - see `scripts/fetch-drop-sources.ts` for why fetching it
   * at runtime would be the opposite of gentle.
   *
   * The player has a specific cosmetic in mind and this file cannot know which,
   * so the answer is the other half of the question: the PLACES, ranked by how
   * much of the family each one carries.
   */
  | { of: 'dropSource'; family: 'scene' | 'ephemera' }
  /**
   * Netracell runs already spent this week.
   *
   * "Netracells are limited to five a week, so spend them on the weeks you can
   * actually run them" is a step about a number the account carries -
   * `EntratiVaultCountLastPeriod`, which `account.ts` documents as "Netracell
   * runs used this week", beside an `EntratiVaultCountResetDate`.
   *
   * This was filed as a missing data source. It was not missing; it was in the
   * app's own account model, three lines from a comment saying so.
   */
  | { of: 'netracells' }
  /**
   * Maroo's weekly Ayatan hunt, from `TauntHistory`.
   *
   * `account.ts` labels that field "Maroo's Ayatan hunt" and types its state as
   * `TS_UNLOCKED` or `TS_COMPLETED`. Also filed as missing, also present.
   */
  | { of: 'marooHunt' }
  | { of: 'arcaneHelmets' };

export interface StepRow {
  /** The short left-hand term: a tier, a mission type, a phase. */
  lead: string;
  /** The rest of the row. */
  text: string;
  /** `good` = you can act on this now. `warn` = you cannot. Muted = neutral. */
  tone?: 'good' | 'warn' | 'muted';
}

export interface StepAnswer {
  /**
   * The answer at a glance, or NULL when nothing has been read.
   *
   * Never a zero. "0 fissures open" is a measurement and is a legitimate
   * headline; a null here means the question could not be asked at all.
   */
  headline: string | null;
  rows: readonly StepRow[];
  /** Set exactly when `headline` is null: what would settle it. */
  unknown: string | null;
}

/** Everything a resolver is allowed to read. */
export interface StepContext {
  ws: Worldstate | null;
  inventory: Readonly<Record<string, unknown>> | null;
  relics: readonly Relic[] | null;
  /**
   * What this account holds that sells, and which sets it is close to.
   *
   * Both are already computed by the panel for its own Sell and Sets views.
   * NULL is unread and an EMPTY array is a measurement - the same distinction
   * as everywhere else, and the reason these are nullable rather than defaulted
   * to `[]` at the call site.
   */
  holdings: readonly Holding[] | null;
  sets: readonly SetVerdict[] | null;
  /**
   * The route this step belongs to, and the prices already fetched for it.
   *
   * `routeId` is spread in per route rather than sitting on the shared panel
   * context, because "what does this sell" is the one question whose answer
   * differs for every card on screen.
   *
   * `prices` is the SAME book the throughput chain was built from. Nothing here
   * triggers a request; it reads a result the panel already had and was using
   * for exactly one number.
   */
  routeId: string | null;
  prices: PriceBook | null;
  /**
   * The quest catalog and the derived account picture.
   *
   * Both already exist on the panel - the ranker takes them to decide whether a
   * route is even open. Null until the datasets land, which the resolvers
   * report as unknown rather than as "not finished".
   */
  catalog: Catalog | null;
  picture: AccountPicture | null;
  /**
   * The raw account, for the ownership checks that read the equipment arrays.
   *
   * Typed as `RawAccount` rather than reusing `inventory` above, because
   * `frameAdvice` walks the 27 named arsenal arrays and needs the shape, not a
   * bag of unknowns. Same object, honestly typed.
   */
  account: RawAccount | null;
  /**
   * Wallet, trades and riven slots, as the panel already computed them.
   *
   * Every field is nullable and null means unread - `platPosition` returns an
   * all-null object for a missing account rather than zeroes, which is what
   * makes it safe to read here.
   */
  position: PlatPosition | null;
  /**
   * The mission log, reduced. Already built by the panel for the rate engine.
   */
  observed: Observed | null;
  /**
   * Live invasion rewards a player could SELL, before pricing.
   *
   * Null means the world state or the market catalog has not landed - NOT that
   * nothing is tradeable. `tradeableOffers` returns the empty array for both
   * "no catalog" and "nothing sellable is running", and the panel resolves that
   * ambiguity before it gets here, because the two need opposite sentences.
   */
  invasionCandidates: readonly InvasionOffer[] | null;
  /** The same offers with prices attached. Null until the pricing pass lands. */
  invasionOffers: readonly InvasionOffer[] | null;
  /**
   * The item catalog, for the per-item flags a holding does not carry.
   *
   * Loaded by the panel through `gentle`, which persists the parsed value - so
   * on any session after the first this costs nothing, and on the first it is
   * one request shared with every other panel that wants it.
   */
  items: ItemDb | null;
  /**
   * The raw mission log, for the questions that need a NODE rather than a type.
   *
   * `observed` above is the same log reduced to medians per mission type, which
   * is what the rate engine needs and is useless for "where should I go".
   */
  log: readonly MissionRecord[] | null;
  /** Passed in rather than read, so a resolver is pure and testable. */
  now: number;
}

const NO_WORLDSTATE = 'the world state has not been read yet, so this cannot be answered';

/** Time left on an ISO expiry, or null when it has passed or is absent. */
function left(iso: string | undefined, now: number): string | null {
  if (iso === undefined) return null;
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${String(mins)}m left`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${String(hours)}h left`;
  return `${String(Math.floor(hours / 24))}d left`;
}

/** Title-case a SCREAMING_SNAKE mission type without inventing words. */
function readable(s: string): string {
  const bare = s.replace(/^MT_/, '').replace(/_/g, ' ').toLowerCase();
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/**
 * The fissure answer, which is the whole reason this file exists.
 *
 * Ordered by whether you can actually open it. A fissure you hold relics for is
 * the answer to the step; a fissure you hold none for is context, and is kept
 * rather than filtered because "there are Neo fissures and you have no Neo
 * relics" is exactly the fact that sends someone to the relic-farm route.
 */
function resolveFissures(ctx: StepContext): StepAnswer {
  const list = ctx.ws?.fissures;
  if (!Array.isArray(list)) {
    return { headline: null, rows: [], unknown: NO_WORLDSTATE };
  }

  const stock: RelicStock = relicStock(ctx.inventory, ctx.relics);
  const open = list.filter((f) => left(f.expiry, ctx.now) !== null);

  const rows: StepRow[] = open
    .map((f) => {
      const tier = f.tier ?? '?';
      const have = stock.byTier?.get(tier) ?? null;
      const when = left(f.expiry, ctx.now);
      const hard = f.isHard === true ? ' · Steel Path' : '';
      const storm = f.isStorm === true ? ' · Void Storm' : '';
      return {
        have,
        row: {
          lead: tier,
          text: `${f.node} · ${readable(f.missionType)}${hard}${storm} · ${stockLabel(have)}${when === null ? '' : ` · ${when}`}`,
          tone: have === null ? ('muted' as const) : have > 0 ? ('good' as const) : ('warn' as const),
        },
      };
    })
    // Openable first, then by how many relics you hold for it. A fissure you
    // cannot use is never the answer, whatever its tier or timer says.
    .sort((a, b) => (b.have ?? -1) - (a.have ?? -1))
    .map((x) => x.row);

  if (stock.byTier === null) {
    // The doors are known and the keys are not. Say both, rather than refusing
    // to answer: which fissures are open is still worth having.
    return {
      headline: `${String(open.length)} open · which you can use is unknown`,
      rows,
      unknown: null,
    };
  }

  const usable = open.filter((f) => (stock.byTier?.get(f.tier ?? '?') ?? 0) > 0).length;
  return {
    headline: open.length === 0 ? 'none open right now' : `${String(usable)} of ${String(open.length)} you can open now`,
    rows,
    unknown: null,
  };
}

/** What you hold, by tier — the other half of the same question. */
function resolveRelics(ctx: StepContext): StepAnswer {
  const stock = relicStock(ctx.inventory, ctx.relics);
  if (stock.byTier === null) {
    return { headline: null, rows: [], unknown: stock.unknown ?? 'the relics you hold are unknown' };
  }
  const rows = [...stock.byTier]
    .sort((a, b) => b[1] - a[1])
    .map(([tier, n]) => ({ lead: tier, text: stockLabel(n), tone: n > 0 ? ('good' as const) : ('muted' as const) }));
  const total = [...stock.byTier.values()].reduce((n, v) => n + v, 0);

  /*
   * WHICH OF THE TIERS ARE OUT OF THE DROP TABLES.
   * ————————————————————————————————————————————
   * `Relic.vaulted` is already on every row of the table this resolver was
   * handed - "out of the drop tables: it can still be traded, never farmed" -
   * and the tier counts above threw it away. A vaulted relic is the one whose
   * supply can only shrink, which is the entire reason the sell-relics route
   * exists, and the step reporting "12 Axi held" could not say whether any of
   * them was worth holding rather than cracking.
   *
   * Reported as a COUNT OF TIERS, not of relics: the stock map sums every
   * refinement per tier and has no per-relic breakdown to cross, so claiming a
   * number of vaulted relics held would be arithmetic this function cannot do.
   * Naming the tiers that contain vaulted relics is what the data supports.
   */
  const vaultedTiers = new Set<string>();
  for (const relic of ctx.relics ?? []) if (relic.vaulted) vaultedTiers.add(relic.tier);
  const held = [...vaultedTiers].filter((t) => (stock.byTier?.get(t) ?? 0) > 0).sort();
  if (held.length > 0) {
    rows.push({
      lead: 'vaulted',
      text: `${held.join(', ')} — these tiers contain relics out of the drop tables, which can be traded but never farmed again`,
      tone: 'good',
    });
  }

  return { headline: `${total.toLocaleString()} held across ${String(stock.byTier.size)} tiers`, rows, unknown: null };
}

function resolveSortie(ctx: StepContext): StepAnswer {
  const s = ctx.ws?.sortie;
  if (!s) return { headline: null, rows: [], unknown: NO_WORLDSTATE };
  const when = left(s.expiry, ctx.now);
  if (when === null) return { headline: null, rows: [], unknown: "today's sortie has expired and the next has not been read yet" };
  const rows = (s.variants ?? []).map((v, i) => ({
    lead: `${String(i + 1)}`,
    text: `${v.node} · ${readable(v.missionType)} · ${v.modifier}`,
    tone: 'muted' as const,
  }));
  const who = [s.boss, s.faction].filter((x) => typeof x === 'string' && x.length > 0).join(' · ');
  return { headline: `${who === '' ? 'Today' : who} · ${when}`, rows, unknown: null };
}

function resolveArchon(ctx: StepContext): StepAnswer {
  const a = ctx.ws?.archonHunt;
  if (!a) return { headline: null, rows: [], unknown: NO_WORLDSTATE };
  const when = left(a.expiry, ctx.now);
  if (when === null) return { headline: null, rows: [], unknown: "this week's Archon Hunt has expired and the next has not been read yet" };
  const rows = (a.missions ?? []).map((m, i) => ({
    lead: `${String(i + 1)}`,
    text: `${m.node} · ${readable(m.type)}`,
    tone: 'muted' as const,
  }));
  const who = [a.boss, a.faction].filter((x) => typeof x === 'string' && x.length > 0).join(' · ');
  return { headline: `${who === '' ? 'This week' : who} · ${when}`, rows, unknown: null };
}

function resolveBaro(ctx: StepContext): StepAnswer {
  const b = ctx.ws?.voidTrader;
  if (!b) return { headline: null, rows: [], unknown: NO_WORLDSTATE };
  const here = left(b.expiry, ctx.now);
  const who = b.character ?? 'Baro Ki’Teer';
  if (here === null) {
    /*
     * Gone is a MEASUREMENT and reads as one. The feed carries his arrival as a
     * separate field from his departure and only one of them is in `expiry`, so
     * the honest statement is that he is not here now - not a countdown to a
     * date this resolver would have to invent.
     */
    return { headline: `${who} is not at a relay right now`, rows: [], unknown: null };
  }
  return {
    headline: `${who} · ${b.location ?? 'a relay'} · ${here}`,
    rows: [{ lead: 'now', text: `Trading at ${b.location ?? 'a relay'}`, tone: 'good' }],
    unknown: null,
  };
}

function resolveVarzia(ctx: StepContext): StepAnswer {
  const v = ctx.ws?.vaultTrader;
  if (!v) return { headline: null, rows: [], unknown: NO_WORLDSTATE };
  const here = left(v.expiry, ctx.now);
  const who = v.character ?? 'Varzia';
  if (here === null) return { headline: `${who} is not at Maroo’s Bazaar right now`, rows: [], unknown: null };
  /*
   * Most of her stock IS mangled - the feed de-camel-cases identifiers into
   * "M P V Banshee Prime Single Pack", "All New1h S G", "T1 Void Projection
   * Banshee Mirage Vault A Bronze" - and none of that gets printed.
   *
   * But the WARFRAMES are not mangled, and they are the whole question this
   * route asks. Every row under `/Lotus/StoreItems/Powersuits/` carries a name
   * that survives de-camel-casing intact, because a prime frame's identifier is
   * two plain words: `BansheePrime` becomes "Banshee Prime" and is right.
   * Checked against the live feed rather than assumed - the Sentinel row
   * ("Prime Helios Power Suit") is mangled and sits under a DIFFERENT prefix,
   * which is why the prefix is the test and "does it contain Prime" is not.
   *
   * So: name the frames, count the rest, and still refuse to print the rest.
   */
  const frames: string[] = [];
  let others = 0;
  for (const row of v.inventory ?? []) {
    const path = typeof row.uniqueName === 'string' ? row.uniqueName.toLowerCase() : null;
    const name = typeof row.item === 'string' ? row.item : null;
    if (path !== null && name !== null && path.startsWith('/lotus/storeitems/powersuits/')) frames.push(name);
    else others += 1;
  }

  const rows: StepRow[] = frames.sort().map((f) => ({ lead: 'unvaulted', text: f, tone: 'good' as const }));
  if (others > 0) {
    rows.push({
      lead: String(others),
      // The relics, cosmetics and bundles. Counted, never named.
      text: 'more items whose names the feed mangles, so they are counted rather than guessed',
      tone: 'muted',
    });
  }

  return {
    headline: `${who} · ${v.location ?? 'Maroo’s Bazaar'} · ${here}${
      frames.length === 0 ? '' : ` · ${frames.join(' and ')}`
    }`,
    rows,
    unknown: null,
  };
}

type CycleWhere = 'cetus' | 'vallis' | 'cambion' | 'zariman' | 'duviri';

const CYCLE_LABEL: Record<CycleWhere, string> = {
  cetus: 'Plains of Eidolon',
  vallis: 'Orb Vallis',
  cambion: 'Cambion Drift',
  zariman: 'Zariman',
  duviri: 'Duviri',
};

function resolveCycle(ctx: StepContext, where: CycleWhere): StepAnswer {
  const key = `${where}Cycle` as const;
  const c = ctx.ws?.[key];
  if (!c) return { headline: null, rows: [], unknown: NO_WORLDSTATE };
  const when = left(c.expiry, ctx.now);
  const state = c.state ?? 'unknown';
  return {
    headline: `${CYCLE_LABEL[where]} · ${state}${when === null ? '' : ` · ${when}`}`,
    rows: [],
    unknown: null,
  };
}

function resolveNightwave(ctx: StepContext): StepAnswer {
  const n = ctx.ws?.nightwave;
  const acts = n?.activeChallenges;
  if (!Array.isArray(acts)) return { headline: null, rows: [], unknown: NO_WORLDSTATE };
  const live = acts.filter((a) => left(a.expiry, ctx.now) !== null);
  const rows = live
    .slice()
    .sort((a, b) => (b.reputation ?? 0) - (a.reputation ?? 0))
    .map((a) => ({
      lead: a.reputation == null ? '?' : String(a.reputation),
      text: `${a.title ?? 'act'}${a.isDaily === true ? ' · daily' : ''}`,
      tone: 'muted' as const,
    }));
  return {
    headline: live.length === 0 ? 'no acts are running right now' : `${String(live.length)} acts running`,
    rows,
    unknown: null,
  };
}

/**
 * Faction wars, and what each side actually pays.
 *
 * Both sides are carried because an invasion is a CHOICE - the whole point of
 * the row is which reward you would rather have - and a list naming only the
 * attacker would be answering half the question the step asks.
 */
function resolveInvasions(ctx: StepContext): StepAnswer {
  const list = ctx.ws?.invasions;
  if (!Array.isArray(list)) return { headline: null, rows: [], unknown: NO_WORLDSTATE };
  const live = list.filter((i) => i.completed !== true);
  const reward = (side: { reward?: { countedItems?: Array<{ count?: number; type?: string }>; credits?: number } } | undefined): string => {
    const item = side?.reward?.countedItems?.[0];
    if (item?.type != null && item.type.length > 0) {
      return `${item.count == null ? '' : `${String(item.count)}× `}${item.type}`;
    }
    const cr = side?.reward?.credits;
    return cr == null || cr === 0 ? 'nothing listed' : `${cr.toLocaleString()} credits`;
  };
  const rows = live.map((i) => ({
    lead: i.completion == null ? '?' : `${String(Math.round(i.completion))}%`,
    text: `${i.node} · ${reward(i.attacker)} vs ${reward(i.defender)}`,
    tone: 'muted' as const,
  }));
  return {
    headline: live.length === 0 ? 'no invasions are running right now' : `${String(live.length)} running`,
    rows,
    unknown: null,
  };
}

/** Teshin's rotating offer, which is the only thing Steel Essence is for. */
function resolveSteelPath(ctx: StepContext): StepAnswer {
  const sp = ctx.ws?.steelPath;
  if (!sp) return { headline: null, rows: [], unknown: NO_WORLDSTATE };
  const name = sp.currentReward?.name;
  if (name == null || name.length === 0) {
    return { headline: null, rows: [], unknown: 'the feed carried no current Steel Path offer' };
  }
  const cost = sp.currentReward?.cost;
  return {
    headline: `${name}${cost == null ? '' : ` · ${String(cost)} Essence`}`,
    // `remaining` arrives pre-formatted from the API; it is passed through
    // rather than reparsed into a countdown this file would have to invent.
    rows: sp.remaining == null ? [] : [{ lead: 'rotates', text: sp.remaining, tone: 'muted' }],
    unknown: null,
  };
}

/**
 * The currencies a farming step turns on, by their REAL inventory paths.
 *
 * Every path here was looked up in WFCD's own `Resources.json` and `Misc.json`
 * rather than inferred from the display name, and two of them prove why that
 * mattered: a Corrupted Holokey is stored as `GranumBucks`, and Vitus Essence
 * is stored as `Elitium`. Guessing either from its name would have produced a
 * lookup that silently found nothing - which, on a nullable count, renders as
 * "unknown" rather than as an error, and would never have been noticed.
 *
 * `check-resource-paths` re-checks every one of them against the live dataset,
 * so a rename upstream fails the build instead of quietly zeroing a step.
 */
const CURRENCY = {
  ducats: { path: '/Lotus/Types/Items/MiscItems/PrimeBucks', name: 'Ducats' },
  aya: { path: '/Lotus/Types/Items/MiscItems/SchismKey', name: 'Aya' },
  kuva: { path: '/Lotus/Types/Items/MiscItems/Kuva', name: 'Kuva' },
  steelEssence: { path: '/Lotus/Types/Items/MiscItems/SteelEssence', name: 'Steel Essence' },
  holokeys: { path: '/Lotus/Types/Items/MiscItems/GranumBucks', name: 'Corrupted Holokeys' },
  rivenSlivers: { path: '/Lotus/Types/Items/MiscItems/RivenFragment', name: 'Riven Slivers' },
  vitusEssence: { path: '/Lotus/Types/Items/MiscItems/Elitium', name: 'Vitus Essence' },
} as const satisfies Record<string, { path: string; name: string }>;

/** Exported so the path gate can re-check every one against the live dataset. */
export const CURRENCY_PATHS: ReadonlyArray<{ key: string; path: string; name: string }> = Object.entries(
  CURRENCY,
).map(([key, v]) => ({ key, path: v.path, name: v.name }));

/**
 * A currency balance, or the honest absence of one.
 *
 * `resourceCount` returns 0 for both "you hold none" and "no account was
 * read", so the read is checked HERE rather than trusting the sum - the same
 * trap `Counted` documents, and the reason this does not simply call it.
 */
function resolveCurrency(ctx: StepContext, which: keyof typeof CURRENCY): StepAnswer {
  const { path, name } = CURRENCY[which];
  if (ctx.inventory === null) {
    return { headline: null, rows: [], unknown: `your account has not been read, so your ${name} are unknown` };
  }
  const misc = ctx.inventory['MiscItems'];
  if (!Array.isArray(misc)) {
    return { headline: null, rows: [], unknown: `this account read did not carry your items, so your ${name} are unknown` };
  }
  let held = 0;
  for (const row of misc) {
    const r = row as { ItemType?: unknown; ItemCount?: unknown } | null;
    if (r?.ItemType === path && typeof r.ItemCount === 'number') held += r.ItemCount;
  }
  return { headline: `${held.toLocaleString()} ${name} held`, rows: [], unknown: null };
}

/**
 * Standing and rank with one syndicate.
 *
 * `Title` is a rank INDEX and not a name, and this file has no table mapping
 * one to the other that came from a primary source - so the index is reported
 * as an index and never dressed up as "Old Mate". Saying less is the whole
 * discipline here.
 */
function resolveStanding(ctx: StepContext, tag: string, who: string): StepAnswer {
  if (ctx.inventory === null) {
    return { headline: null, rows: [], unknown: `your account has not been read, so your ${who} standing is unknown` };
  }
  const affs = ctx.inventory['Affiliations'];
  if (!Array.isArray(affs)) {
    return { headline: null, rows: [], unknown: `this account read did not carry your syndicates, so ${who} standing is unknown` };
  }
  const row = affs.find((a) => (a as { Tag?: unknown } | null)?.Tag === tag) as
    | { Standing?: unknown; Title?: unknown }
    | undefined;
  if (row === undefined) {
    // Read, and not present: you have not joined. That IS a measurement.
    return { headline: `no standing with ${who} yet`, rows: [], unknown: null };
  }
  const standing = typeof row.Standing === 'number' ? row.Standing : null;
  const title = typeof row.Title === 'number' ? row.Title : null;
  return {
    headline: `${standing === null ? 'standing unknown' : `${standing.toLocaleString()} standing`}${
      title === null ? '' : ` · rank ${String(title)}`
    } · ${who}`,
    rows: [],
    unknown: null,
  };
}

/**
 * The spare prime parts, worth first.
 *
 * Ducats before platinum in the ordering, because this binding hangs off the
 * DUCAT route: the question that step is asking is "what can I throw at the
 * kiosk", and a part's ducat value is exact and free while its platinum price
 * is a median over trades that may not exist.
 */
function resolveSpare(ctx: StepContext): StepAnswer {
  if (ctx.holdings === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so what you hold is unknown' };
  }
  const spare = ctx.holdings.filter((h) => (h.ducats ?? 0) > 0);
  if (spare.length === 0) {
    return { headline: 'nothing you hold sells at a kiosk', rows: [], unknown: null };
  }
  const ranked = [...spare].sort((a, b) => (b.ducatWorth ?? 0) - (a.ducatWorth ?? 0));
  const total = ranked.reduce((n, h) => n + (h.ducatWorth ?? 0), 0);
  return {
    headline: `${total.toLocaleString()} Ducats across ${String(ranked.length)} kinds`,
    rows: ranked.slice(0, 12).map((h) => ({
      lead: `${String(h.ducatWorth ?? 0)}d`,
      text: `${h.count > 1 ? `${String(h.count)}× ` : ''}${h.name}${h.worth == null ? '' : ` · ${String(Math.round(h.worth))}p if sold instead`}`,
      // Green only where selling for ducats is NOT throwing platinum away.
      tone: h.worth != null && h.worth >= 10 ? ('warn' as const) : ('good' as const),
    })),
    unknown: null,
  };
}

/**
 * Sets one or two parts from done, by margin per trade.
 *
 * `perTrade` is the ordering and not raw margin, because the daily trade cap is
 * what actually binds - `set-completion` says so where it computes it, and a
 * list sorted by margin would recommend the set that eats four trades for the
 * same return as one that eats two.
 */
function resolveNearSets(ctx: StepContext): StepAnswer {
  if (ctx.sets === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so your sets are unknown' };
  }
  const near = ctx.sets.filter((s) => s.missing.length > 0 && s.missing.length <= 2);
  if (near.length === 0) {
    return { headline: 'no set is within two parts', rows: [], unknown: null };
  }
  const ranked = [...near].sort((a, b) => (b.perTrade ?? -Infinity) - (a.perTrade ?? -Infinity));
  return {
    headline: `${String(ranked.length)} within two parts`,
    rows: ranked.slice(0, 10).map((s) => ({
      lead: `${String(s.missing.length)} to buy`,
      text: `${s.name} · ${s.toBuy == null ? 'cost unpriced' : `${String(Math.round(s.toBuy))}p to finish`}${
        s.margin == null ? '' : ` · ${s.margin >= 0 ? '+' : ''}${String(Math.round(s.margin))}p margin`
      }`,
      tone: s.margin == null ? ('muted' as const) : s.margin > 0 ? ('good' as const) : ('warn' as const),
    })),
    unknown: null,
  };
}

/**
 * What this route sells, by name, at what it is going for.
 *
 * The slug list is the route's own - eighteen of them declare which items they
 * produce, and `check-slugs` proves every one of those slugs is a real
 * warframe.market item rather than a plausible-looking guess.
 *
 * Ordered by price, because the step this answers is "sell the duplicates" and
 * the only useful ordering for that sentence is which one to list first. The
 * unpriced ones stay in the list and say so.
 *
 * WHY "NO QUOTE YET" AND NOT "NO RECENT TRADES".
 * The first draft said the latter, which is a claim about the MARKET, and the
 * book cannot support it: the panel fills that map across four separate fetch
 * stages, so a slug missing from it may simply not have been reached. Absence
 * proves we have no quote and nothing whatever about whether the item trades.
 * Saying otherwise told a player an item was dead when the request for it had
 * not been made - our own incomplete work, reported as a fact about somebody
 * else. It rendered on all four Nightmare mods at once, which is what made it
 * obvious.
 */
function resolveSells(ctx: StepContext): StepAnswer {
  if (ctx.routeId === null) {
    return { headline: null, rows: [], unknown: 'this step is not attached to a route, so it has nothing to sell' };
  }
  const model = MODELS[ctx.routeId];
  if (model === undefined || model.price.kind !== 'market') {
    /*
     * Not every route has a representative item list, and the ones that do not
     * are the ones whose output is a currency or a one-off rather than a
     * tradeable item. Saying so beats an empty list that implies the route
     * sells nothing.
     */
    return { headline: null, rows: [], unknown: 'this route has no representative item list to price' };
  }
  if (ctx.prices === null) {
    return { headline: null, rows: [], unknown: 'prices have not been read yet, so these cannot be valued' };
  }

  const book = ctx.prices;
  const rows = model.price.slugs
    .map((slug) => ({ slug, price: book.get(slug) ?? null }))
    .sort((a, b) => (b.price?.median ?? -1) - (a.price?.median ?? -1))
    .map(({ slug, price }) => ({
      lead: price === null ? '\u2014' : `${String(Math.round(price.median))}p`,
      // The slug IS the name here, unpunctuated: it is how warframe.market
      // spells the item, and turning it into prose would invent a name the
      // market does not use and the player cannot search for.
      text: `${slug.replace(/_/g, ' ')}${price === null ? ' \u00b7 no quote yet' : ` \u00b7 ${String(price.volume)} sold in the window`}`,
      tone: price === null ? ('muted' as const) : ('good' as const),
    }));

  const priced = rows.filter((r) => r.lead !== '\u2014').length;
  return {
    headline: priced === 0 ? 'none priced yet' : `${String(priced)} of ${String(rows.length)} priced`,
    rows,
    unknown: null,
  };
}

/**
 * Has this account finished the quest this step names?
 *
 * Three answers and they are all different: finished, not finished, and not
 * knowable. The last one is why this cannot just call `questDone` and print the
 * boolean - `questDone` returns `boolean | null` precisely because an unread
 * account has no answer, and rendering that null as "not finished" would be the
 * bug this whole session has been about.
 */
function resolveQuest(ctx: StepContext, name: string): StepAnswer {
  if (ctx.catalog === null) {
    return { headline: null, rows: [], unknown: 'the quest catalog has not loaded, so this cannot be checked' };
  }
  if (ctx.picture === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so this cannot be checked' };
  }
  const key = ctx.catalog.questKeyByName.get(name.toLowerCase());
  const quest = key === undefined ? undefined : ctx.catalog.questByKey.get(key);
  if (quest === undefined) {
    return { headline: null, rows: [], unknown: `the catalog carries no quest called ${name}` };
  }
  const done = questDone(quest, ctx.picture);
  if (done === null) {
    return { headline: null, rows: [], unknown: `whether you finished ${name} cannot be confirmed from this read` };
  }
  return {
    headline: done ? `${name} is finished` : `${name} is not finished yet`,
    rows: [],
    unknown: null,
  };
}

/**
 * How much of the star chart is cleared.
 *
 * `pct` is the shared helper and returns null whenever either half of the
 * fraction is missing, which is the whole reason it exists - a percentage
 * assembled from a numerator we have and a denominator we do not would be a
 * number about the player made out of our own gaps.
 */
function resolveChart(ctx: StepContext): StepAnswer {
  if (ctx.picture === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so the chart cannot be measured' };
  }
  const { have, total } = ctx.picture.nodes;
  const share = pct(ctx.picture.nodes);
  if (have === null || total === null || share === null) {
    return {
      headline: null,
      rows: [],
      unknown:
        have === null
          ? 'your cleared nodes have not been read, so there is no progress to show'
          : 'the node catalog has not loaded, so there is nothing to measure against',
    };
  }
  const left = total - have;
  return {
    headline: left <= 0 ? 'the chart is clear, so this is open' : `${String(left)} nodes left of ${String(total)}`,
    rows: [{ lead: `${share.toFixed(1)}%`, text: `${String(have)} cleared`, tone: left <= 0 ? 'good' : 'warn' }],
    unknown: null,
  };
}

/**
 * Which frames change this route's output, and which of them you have.
 *
 * Owned first, because the step is asking what to BRING and a frame you would
 * have to farm first is not an answer to that question - but the unowned ones
 * stay listed with their reason, because "Nekros would roughly double your
 * drops" is worth knowing even when the answer is that you do not have one.
 */
function resolveFrames(ctx: StepContext): StepAnswer {
  if (ctx.routeId === null) {
    return { headline: null, rows: [], unknown: 'this step is not attached to a route' };
  }
  const route = PLAT_ROUTES.find((r) => r.id === ctx.routeId);
  const picks = route?.betterWith ?? [];
  if (picks.length === 0) {
    return { headline: null, rows: [], unknown: 'no frame changes what this route produces' };
  }
  const advice = frameAdvice(ctx.account, picks, ctx.items);
  const owned = advice.filter((a) => a.owned === true).length;
  const unread = advice.some((a) => a.owned === null);

  const rows = [...advice]
    .sort((a, b) => Number(b.owned === true) - Number(a.owned === true))
    .map((a) => ({
      lead: a.owned === null ? 'unknown' : a.owned ? 'owned' : 'not owned',
      text: `${a.pick.name} \u00b7 ${a.pick.why}`,
      tone: a.owned === null ? ('muted' as const) : a.owned ? ('good' as const) : ('warn' as const),
    }));

  return {
    headline: unread
      ? `${String(picks.length)} change the yield \u00b7 which you own is unknown`
      : `${String(owned)} of ${String(picks.length)} owned`,
    rows,
    unknown: null,
  };
}

/** Which nemesis line a faction tag belongs to, in the game's own words. */
const NEMESIS_LINE: Record<string, string> = {
  FC_GRINEER: 'Kuva Lich',
  FC_CORPUS: 'Sister of Parvos',
  FC_INFESTATION: 'Coda',
};

/**
 * Your active nemesis, and the murmur progress the steps assume you do not have.
 *
 * Three states, and they are genuinely different: no account read, a read
 * account with no nemesis, and a nemesis in progress. The middle one is a
 * MEASUREMENT - "you have none right now" is the answer to "should I make one"
 * - and must not be confused with the first.
 *
 * The weapon is not named. `ActiveNemesis.weapon` is typed `null` on purpose
 * and says why: the payload holds an index into a manifest this app does not
 * load. Printing a name here would be inventing the one fact a player most
 * wants, which is the worst possible place to guess.
 */
function resolveNemesis(ctx: StepContext): StepAnswer {
  if (ctx.account === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so any nemesis you have is unknown' };
  }
  const state = nemesisState(ctx.account);
  const active = state.active;

  if (active === null) {
    const rows: StepRow[] = [];
    if (state.vanquished !== null) {
      rows.push({ lead: 'so far', text: `${String(state.vanquished)} vanquished, ${String(state.converted ?? 0)} converted`, tone: 'muted' });
    }
    return { headline: 'no nemesis right now, so this route starts at step one', rows, unknown: null };
  }

  const line = active.faction === null ? 'A nemesis' : (NEMESIS_LINE[active.faction] ?? 'A nemesis');
  const rows: StepRow[] = [
    {
      lead: `${String(active.hintsRevealed)} of 3`,
      text: 'Requiem hints revealed',
      tone: active.hintsRevealed >= 3 ? 'good' : 'warn',
    },
  ];
  if (active.guesses > 0) {
    rows.push({ lead: `${String(active.guesses)}`, text: 'guesses made so far', tone: 'muted' });
  }
  if (active.missionCount !== null) {
    rows.push({ lead: `${String(active.missionCount)}`, text: 'missions run against it', tone: 'muted' });
  }
  /*
   * The weapon is deliberately absent and SAID to be absent, rather than left
   * as a silent gap the reader might mistake for "it has no weapon".
   */
  if (active.weaponIdx !== null) {
    rows.push({ lead: 'weapon', text: 'not named here — the payload stores an index into a manifest this app does not load', tone: 'muted' });
  }

  return {
    headline:
      active.hintsRevealed >= 3
        ? `${line} · all three hints revealed`
        : `${line} · ${String(active.hintsRevealed)} of 3 hints`,
    rows,
    unknown: null,
  };
}

/**
 * Trades left today, and what the cap is.
 *
 * Both halves matter and they are different facts: the cap is your mastery rank
 * and never moves during a day, while what is LEFT is the number that decides
 * whether to spend one on six Ayatan stars.
 */
function resolveTrades(ctx: StepContext): StepAnswer {
  const pos = ctx.position;
  if (pos === null || (pos.tradesLeft === null && pos.tradesCap === null)) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so your trades are unknown' };
  }
  const left = pos.tradesLeft;
  const cap = pos.tradesCap;
  if (left === null) {
    return {
      headline: cap === null ? null : `${String(cap)} a day at your rank`,
      rows: [],
      unknown: cap === null ? 'this read did not carry your trade count' : null,
    };
  }
  return {
    headline: `${String(left)} left today${cap === null ? '' : ` of ${String(cap)}`}`,
    rows: [
      {
        lead: '6',
        text: 'items per side is the per-trade limit, so a bulk sale is one trade however large the lot',
        tone: 'muted',
      },
    ],
    // Amber when trades are the scarce thing, which is when this step matters.
    unknown: null,
  };
}

/** Rivens held, and whether one more would have anywhere to land. */
function resolveRivens(ctx: StepContext): StepAnswer {
  const pos = ctx.position;
  if (pos === null || (pos.rivensHeld === null && pos.rivenSlotsFree === null)) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so your rivens are unknown' };
  }
  const held = pos.rivensHeld;
  const free = pos.rivenSlotsFree;
  const rows: StepRow[] = [];
  if (free !== null) {
    rows.push({
      lead: free === 0 ? 'full' : String(free),
      text:
        free === 0
          ? 'no slot free - a Riven reward has nowhere to land until you make room'
          : 'slots free to receive another',
      tone: free === 0 ? 'warn' : 'good',
    });
  }

  /*
   * WHICH riven, for WHICH weapon, and how many times it has been rolled.
   *
   * Both of this route's tips turn on exactly these two facts - "disposition
   * matters enormously" is per-weapon, and "an unrolled Riven has option value
   * to a buyer" is the reroll count - and the panel was showing neither.
   *
   * The fingerprint is a JSON STRING, and its shape is documented in
   * `docs/research/inventory-schema.md`: an unveiled riven carries `compat`
   * (the weapon's path) and `rerolls`, while a veiled one carries `challenge`
   * instead and has no weapon yet. That distinction is worth keeping, because a
   * veiled riven cannot be priced by weapon at all.
   *
   * Every read here is defensive. A fingerprint that does not parse, or that
   * lacks the fields, produces NO row rather than a guessed one - a wrong
   * weapon beside a riven is worse than a shorter list.
   */
  const rolled: Array<{ weapon: string; rerolls: number | null }> = [];
  let veiled = 0;
  let unparsed = 0;
  const upgrades = (ctx.account as unknown as Record<string, unknown> | null)?.['Upgrades'];
  for (const raw of Array.isArray(upgrades) ? upgrades : []) {
    const row = raw as { ItemType?: unknown; UpgradeFingerprint?: unknown } | null;
    const type = row?.ItemType;
    if (typeof type !== 'string' || !type.startsWith(RIVEN_PREFIX)) continue;
    const fp = row?.UpgradeFingerprint;
    if (typeof fp !== 'string') {
      unparsed += 1;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fp);
    } catch {
      unparsed += 1;
      continue;
    }
    const o = parsed as { compat?: unknown; rerolls?: unknown; challenge?: unknown };
    if (o.challenge !== undefined && o.compat === undefined) {
      veiled += 1;
      continue;
    }
    if (typeof o.compat !== 'string') {
      unparsed += 1;
      continue;
    }
    const name = ctx.items?.byType.get(o.compat)?.name ?? (o.compat.split('/').pop() ?? o.compat);
    rolled.push({ weapon: name, rerolls: typeof o.rerolls === 'number' ? o.rerolls : null });
  }

  // Unrolled first: those are the ones with option value to a buyer.
  rolled.sort((a, b) => (a.rerolls ?? 0) - (b.rerolls ?? 0) || a.weapon.localeCompare(b.weapon));
  for (const r of rolled.slice(0, 8)) {
    rows.push({
      lead: r.rerolls === null ? '?' : r.rerolls === 0 ? 'unrolled' : `${String(r.rerolls)} rolls`,
      text: r.weapon,
      tone: r.rerolls === 0 ? 'good' : 'muted',
    });
  }
  if (veiled > 0) {
    rows.push({ lead: String(veiled), text: 'still veiled, so not yet for any weapon', tone: 'muted' });
  }
  if (unparsed > 0) {
    // Named rather than dropped: the count would otherwise disagree with the list.
    rows.push({ lead: String(unparsed), text: 'whose fingerprint this read could not parse', tone: 'muted' });
  }

  return {
    headline: held === null ? 'held count not in this read' : `${String(held)} rivens held`,
    rows,
    unknown: null,
  };
}

/**
 * Railjack competence against what the route actually asks for.
 *
 * Never says you cannot do it. `intrinsics` is explicit that the threshold is a
 * judgement and that "somebody skilled at the game will manage below it", so
 * this reports both numbers and the gap, and lets the reader decide.
 */
function resolveIntrinsics(ctx: StepContext): StepAnswer {
  const want = ctx.routeId === null ? undefined : PLAT_ROUTES.find((r) => r.id === ctx.routeId)?.needsIntrinsics;
  const have = intrinsics(ctx.account);
  if (have.piloting === null && have.gunnery === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so your Intrinsics are unknown' };
  }
  const rows: StepRow[] = [
    { lead: have.piloting === null ? '?' : String(have.piloting), text: 'Piloting', tone: 'muted' },
    { lead: have.gunnery === null ? '?' : String(have.gunnery), text: 'Gunnery', tone: 'muted' },
  ];
  const eff = have.effective;
  if (want !== undefined) {
    rows.push({
      lead: `wants ${String(want)}`,
      text:
        eff === null
          ? 'the route asks for this rank in both'
          : eff >= want
            ? 'you are at or above it in both'
            : `your weaker half is ${String(eff)} — workable, but the tree unlocks what people rely on at ${String(want)}`,
      tone: eff === null ? 'muted' : eff >= want ? 'good' : 'warn',
    });
  }
  return {
    headline: eff === null ? 'one of the two ranks is missing from this read' : `effective rank ${String(eff)}`,
    rows,
    unknown: null,
  };
}

/**
 * The runs behind this route's timing, type by type.
 *
 * Includes the types with NO runs, because that absence is the answer to "why
 * can this route not be timed" - and it is the one the chain's single figure
 * cannot give.
 */
function resolveRuns(ctx: StepContext): StepAnswer {
  if (ctx.observed === null) {
    return { headline: null, rows: [], unknown: 'your mission log has not been read yet' };
  }
  const obs = ctx.observed;
  const model = ctx.routeId === null ? undefined : MODELS[ctx.routeId];
  const names = model?.timing.kind === 'missionTypes' ? model.timing.names : [];
  if (names.length === 0) {
    if (obs.overall === null) {
      return { headline: null, rows: [], unknown: 'nothing in your log carried a usable duration yet' };
    }
    return {
      headline: `${String(obs.overall.minutes)} minutes typical across ${String(obs.overall.runs)} runs`,
      rows: [],
      unknown: null,
    };
  }
  const rows = names.map((n) => {
    const t = obs.byType.get(n);
    return {
      lead: t === undefined ? 'none' : `${String(t.runs)}`,
      text: t === undefined ? `${n} — you have not run one with the overlay open` : `${n} · ${String(t.minutes)} minutes typical`,
      tone: t === undefined ? ('warn' as const) : ('good' as const),
    };
  });
  const ran = rows.filter((r) => r.lead !== 'none').length;
  return {
    headline: ran === 0 ? 'none of these run types are in your log yet' : `${String(ran)} of ${String(names.length)} types measured`,
    rows,
    unknown: null,
  };
}

/** The six faction syndicates, by the tags a primary source confirms. */
const FACTIONS: ReadonlyArray<{ tag: string; who: string }> = [
  { tag: 'SteelMeridianSyndicate', who: 'Steel Meridian' },
  { tag: 'ArbitersSyndicate', who: 'Arbiters of Hexis' },
  { tag: 'CephalonSudaSyndicate', who: 'Cephalon Suda' },
  { tag: 'PerrinSyndicate', who: 'The Perrin Sequence' },
  { tag: 'RedVeilSyndicate', who: 'Red Veil' },
  { tag: 'NewLokaSyndicate', who: 'New Loka' },
];

/**
 * Where you already stand with the six, highest first.
 *
 * The step cannot be told which syndicate to pick, and should not try - the
 * choice is the player's and depends on which augment they want. What it CAN
 * say is where they already are, which is the fact that makes the choice cheap
 * or expensive.
 */
function resolveSyndicates(ctx: StepContext): StepAnswer {
  if (ctx.account === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so your syndicates are unknown' };
  }
  const ranked = FACTIONS.map((f) => ({ ...f, rank: syndicateRank(ctx.account, f.tag) }));
  if (ranked.every((r) => r.rank === null)) {
    return { headline: null, rows: [], unknown: 'this account read did not carry your syndicates' };
  }
  const sorted = [...ranked].sort((a, b) => (b.rank ?? -99) - (a.rank ?? -99));
  const joined = sorted.filter((r) => (r.rank ?? 0) > 0).length;
  return {
    headline: joined === 0 ? 'neutral with all six' : `${String(joined)} of 6 above neutral`,
    rows: sorted.map((r) => ({
      lead: r.rank === null ? '?' : `rank ${String(r.rank)}`,
      text: r.who,
      // A NEGATIVE rank is real: a syndicate you have wronged sits below
      // neutral, and that is worth flagging rather than reading as "not yet".
      tone: r.rank === null ? ('muted' as const) : r.rank > 0 ? ('good' as const) : r.rank < 0 ? ('warn' as const) : ('muted' as const),
    })),
    unknown: null,
  };
}

/** What you can spend, and the part of it another player can receive. */
function resolveWallet(ctx: StepContext): StepAnswer {
  const pos = ctx.position;
  if (pos === null || pos.held === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so your platinum is unknown' };
  }
  const rows: StepRow[] = [];
  if (pos.tradable !== null && pos.untradable !== null && pos.untradable > 0) {
    rows.push({
      lead: `${String(pos.tradable)}p`,
      text: `tradable — the other ${String(pos.untradable)} is starter or gift platinum, spendable but never tradable`,
      tone: 'muted',
    });
  }
  return { headline: `${pos.held.toLocaleString()} platinum held`, rows, unknown: null };
}

/** Every open world's clock, for the routes that turn on one. */
function resolveCycles(ctx: StepContext): StepAnswer {
  const ws = ctx.ws;
  if (ws === null) return { headline: null, rows: [], unknown: NO_WORLDSTATE };
  const each: Array<[CycleWhere, string]> = [
    ['cetus', CYCLE_LABEL.cetus],
    ['vallis', CYCLE_LABEL.vallis],
    ['cambion', CYCLE_LABEL.cambion],
    ['zariman', CYCLE_LABEL.zariman],
  ];
  const rows: StepRow[] = [];
  for (const [key, label] of each) {
    const c = ws[`${key}Cycle` as const];
    if (!c) continue;
    const when = left(c.expiry, ctx.now);
    rows.push({ lead: c.state ?? '?', text: `${label}${when === null ? '' : ` · ${when}`}`, tone: 'muted' });
  }
  if (rows.length === 0) {
    return { headline: null, rows: [], unknown: 'the world state carried no cycles in this read' };
  }
  return { headline: `${String(rows.length)} worlds on the clock`, rows, unknown: null };
}

/**
 * Where your own runs of this route's mission types actually happened.
 *
 * Ordered by runs, because the step is asking where to go and the place you
 * keep going back to is the one you have a real sample for. Loot is reported
 * only from ATTRIBUTED runs, and a node whose runs were all unattributed says
 * so rather than reading as a node that dropped nothing.
 */
function resolveSpots(ctx: StepContext): StepAnswer {
  if (ctx.log === null) {
    return { headline: null, rows: [], unknown: 'your mission log has not been read yet' };
  }
  const model = ctx.routeId === null ? undefined : MODELS[ctx.routeId];
  const names = model?.timing.kind === 'missionTypes' ? new Set(model.timing.names) : null;
  const relevant = names === null ? ctx.log : ctx.log.filter((r) => r.missionTypeName !== null && names.has(r.missionTypeName));
  if (relevant.length === 0) {
    return {
      headline: 'none of your logged runs were this route\u2019s mission types',
      rows: [],
      unknown: null,
    };
  }

  const groups = groupRuns(relevant, (r) => r.node ?? 'unknown').filter((g) => g.key !== 'unknown');
  if (groups.length === 0) {
    return { headline: 'your runs of these types carried no node', rows: [], unknown: null };
  }
  const rows = groups.slice(0, 8).map((g) => {
    const mins = g.durationMs > 0 ? Math.round(g.durationMs / g.runs / 60_000) : null;
    const top = g.loot[0];
    return {
      lead: `${String(g.runs)}\u00d7`,
      text:
        `${g.key}${mins === null ? '' : ` \u00b7 ${String(mins)} min each`}` +
        (g.attributed === 0
          ? ' \u00b7 loot not attributed on these runs'
          : top === undefined
            ? ' \u00b7 nothing dropped in the attributed runs'
            : ` \u00b7 best drop ${top.name ?? 'an item'}`),
      tone: g.attributed === 0 ? ('muted' as const) : ('good' as const),
    };
  });
  return { headline: `${String(groups.length)} of your own nodes`, rows, unknown: null };
}

/**
 * The foundry queue: what is waiting, and what is still cooking.
 *
 * `pendingBuilds` takes the clock as an argument so this is deterministic, and
 * already refuses to call a build with no completion date finished. Nothing
 * here second-guesses that.
 *
 * An empty queue is a MEASUREMENT - "nothing building" is the answer to "should
 * I start something" - and is kept apart from an unread account, which has no
 * queue to report.
 */
function resolveFoundry(ctx: StepContext): StepAnswer {
  if (ctx.account === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so the foundry is unknown' };
  }
  const builds = pendingBuilds(ctx.account, ctx.now);
  if (builds.length === 0) {
    return { headline: 'nothing in the foundry — a slot is free', rows: [], unknown: null };
  }
  const ready = builds.filter((b) => b.ready).length;
  const rows = builds.slice(0, 8).map((b) => {
    const secs = b.secondsRemaining;
    const when =
      b.ready ? 'ready to claim'
      : secs === null ? 'no completion time in this read'
      : secs > 3600 ? `${String(Math.floor(secs / 3600))}h left`
      : `${String(Math.max(1, Math.floor(secs / 60)))}m left`;
    // The item type is a `/Lotus/...` path; its last segment is the closest
    // thing to a name this file can honestly print without a catalog lookup.
    const name = b.itemType === null ? 'a build' : (b.itemType.split('/').pop() ?? b.itemType);
    return {
      lead: b.ready ? 'ready' : 'building',
      text: `${name} · ${when}`,
      tone: b.ready ? ('good' as const) : ('muted' as const),
    };
  });
  return {
    headline: ready > 0 ? `${String(ready)} ready to claim of ${String(builds.length)}` : `${String(builds.length)} building`,
    rows,
    unknown: null,
  };
}

/**
 * Prime sets you hold parts of, split by whether they still drop.
 *
 * The set is the market slug's STEM: every `mag_prime_*` that is not `_set` is
 * a part of `mag_prime`, which is how `set-completion` identifies them and is
 * the only grouping both sides agree on.
 *
 * A set counts as vaulted when a part POSITIVELY says so. The catalog's
 * `vaulted` is optional and absent means unknown rather than "still dropping",
 * so the sets nobody can settle are counted and named as unsettled instead of
 * being quietly filed under "not vaulted" - which would be the whole point of
 * the step, inverted.
 */
function resolveVaultedSets(ctx: StepContext): StepAnswer {
  if (ctx.holdings === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so your sets are unknown' };
  }
  if (ctx.items === null) {
    return { headline: null, rows: [], unknown: 'the item catalog has not loaded, so vault status cannot be checked' };
  }

  /** set stem -> the strongest thing its parts say about vaulting. */
  const sets = new Map<string, { vaulted: boolean; unknown: boolean }>();
  for (const h of ctx.holdings) {
    const stem = h.slug.replace(/_(set|blueprint|chassis|systems|neuroptics|barrel|receiver|stock|blade|handle|link|gauntlet|boot|carapace|cerebrum|harness|wings)$/, '');
    if (stem === h.slug && !h.slug.includes('_prime')) continue;
    const entry = ctx.items.byType.get(h.gameRef);
    const flag = entry?.vaulted;
    const prev = sets.get(stem) ?? { vaulted: false, unknown: false };
    sets.set(stem, {
      vaulted: prev.vaulted || flag === true,
      unknown: prev.unknown || flag === undefined,
    });
  }

  if (sets.size === 0) {
    return { headline: 'you hold no prime parts', rows: [], unknown: null };
  }

  const vaulted = [...sets].filter(([, v]) => v.vaulted).map(([stem]) => stem);
  const unsettled = [...sets].filter(([, v]) => !v.vaulted && v.unknown).length;

  const rows: StepRow[] = vaulted
    .slice(0, 10)
    .sort()
    .map((stem) => ({ lead: 'vaulted', text: stem.replace(/_/g, ' '), tone: 'good' as const }));
  if (unsettled > 0) {
    rows.push({
      lead: 'unsettled',
      // Named, not folded into "not vaulted". Absent is unknown.
      text: `${String(unsettled)} more the catalog does not say either way about`,
      tone: 'muted',
    });
  }

  return {
    headline:
      vaulted.length === 0
        ? `none of your ${String(sets.size)} sets is marked vaulted`
        : `${String(vaulted.length)} of ${String(sets.size)} sets are vaulted`,
    rows,
    unknown: null,
  };
}

/** Credits held, or the honest absence of a number. */
function resolveCredits(ctx: StepContext): StepAnswer {
  if (ctx.account === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so your credits are unknown' };
  }
  const raw = (ctx.account as unknown as Record<string, unknown>)['RegularCredits'];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { headline: null, rows: [], unknown: 'this account read did not carry your credits' };
  }
  return { headline: `${raw.toLocaleString()} credits held`, rows: [], unknown: null };
}

/**
 * The tradeable weapon variants this account holds.
 *
 * Every array DE routes a weapon through is scanned, because a Vandal can be a
 * rifle, a secondary or a melee and checking only one would report an account
 * as holding none while it holds three.
 *
 * THE LIST WAS SHORT BY THREE. It held only the four obvious arsenals, and four
 * variants live outside them: the Prisma Burst Laser is a `SentinelWeapons`,
 * the Imperator Vandal and Prisma Dual Decurions are `SpaceGuns`, and the
 * Prisma Veritux is a `SpaceMelee`. Each was invisible - not mis-priced or
 * mis-labelled, simply never looked at.
 *
 * The names are DE's own `productCategory` values, which is what makes them
 * checkable: `check-frame-picks.ts` asserts that every category the catalog
 * gives a variant appears here.
 */
const VARIANT_WORDS = ['vandal', 'wraith', 'prisma'] as const;
export const WEAPON_ARRAYS = [
  'LongGuns',
  'Pistols',
  'Melee',
  'SpecialItems',
  'SentinelWeapons',
  'SpaceGuns',
  'SpaceMelee',
] as const;

function resolveVariants(ctx: StepContext): StepAnswer {
  if (ctx.account === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so your arsenal is unknown' };
  }
  const bag = ctx.account as unknown as Record<string, unknown>;
  const anyArray = WEAPON_ARRAYS.some((k) => Array.isArray(bag[k]));
  if (!anyArray) {
    return { headline: null, rows: [], unknown: 'this account read did not carry your weapons' };
  }
  if (ctx.items === null) {
    /*
     * Unknown, not "you hold none". Only the catalog can say whether a path is
     * a Vandal, so an empty answer here would be the old bug with a new face.
     */
    return { headline: null, rows: [], unknown: 'the item catalog has not loaded, so your variants cannot be named' };
  }

  const found: Array<{ word: string; name: string; altered: string[] }> = [];
  for (const key of WEAPON_ARRAYS) {
    const rows = bag[key];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const item = row as Equipment | null;
      const type = (item as { ItemType?: unknown } | null)?.ItemType;
      if (typeof type !== 'string') continue;
      /*
       * THE NAME COMES FROM THE CATALOG, NOT FROM THE PATH.
       * ————————————————————————————————————————————
       * This used to look for "vandal", "wraith" or "prisma" inside the
       * inventory path. That is right for 34 of the 36 variants and wrong for
       * two of the best known: Braton Vandal is
       * `/Lotus/Weapons/Tenno/Rifle/VIPRifle` and Prisma Gorgon is
       * `/VoidTraderGorgon/VTGorgon`. Neither path contains the word, so a
       * player holding a Braton Vandal was told they held no Vandal at all.
       *
       * The same shape as the frame bug: a path segment read as though it were
       * a name. The catalog is the only thing that maps one to the other.
       */
      const label = ctx.items.byType.get(type)?.name ?? null;
      if (label === null) continue;
      /*
       * A word-set test rather than a word-boundary regex. Written as a
       * single backslash-b inside a template literal, the boundary becomes the
       * BACKSPACE character and matches nothing - which is what this line did
       * on its first three attempts. Splitting on non-letters needs no escape
       * at all, so there is nothing left to get wrong.
       */
      const words = new Set(label.toLowerCase().split(/[^a-z]+/));
      const word = VARIANT_WORDS.find((w) => words.has(w));
      if (word === undefined) continue;

      /*
       * The three things the route warns about, each read from the field that
       * actually carries it.
       *
       * Absent is treated as zero HERE, which is the one place in this file it
       * is - and it is not a guess. `itemXp`, `Polarized` and `Features` are an
       * equipment row's own fields, omitted by the game when they are zero, and
       * `account.ts` already encodes that: `itemXp` returns 0 for absent and
       * `levelCap` reads `Polarized ?? 0` to do mastery maths on. The rule this
       * file keeps - absent is not zero - is about a field a READ never carried.
       * The row is here; its zero fields simply are not written.
       */
      const altered: string[] = [];
      const xp = itemXp(item);
      const forma = typeof item?.Polarized === 'number' ? item.Polarized : 0;
      if (xp > 0) altered.push('ranked up');
      if (forma > 0) altered.push(forma === 1 ? '1 Forma' : `${String(forma)} Forma`);
      // DOUBLE_CAPACITY is the Orokin Catalyst bit; there is no boolean for it.
      if (hasFeature(item, EquipmentFeature.DOUBLE_CAPACITY)) altered.push('catalyst installed');

      found.push({ word, name: label, altered });
    }
  }

  if (found.length === 0) {
    // Read, and none held. A measurement, and the answer to "have I got any".
    return { headline: 'you hold no Vandal, Wraith or Prisma weapons', rows: [], unknown: null };
  }

  const untouched = found.filter((f) => f.altered.length === 0).length;
  const rows = found
    // The ones that will not trade come first: that is the step's whole warning.
    .slice()
    .sort((a, b) => b.altered.length - a.altered.length || a.name.localeCompare(b.name))
    .slice(0, 12)
    .map((f) => ({
      lead: f.altered.length === 0 ? 'unaltered' : 'altered',
      text: `${f.name}${f.altered.length === 0 ? '' : ` · ${f.altered.join(', ')}`}`,
      tone: f.altered.length === 0 ? ('good' as const) : ('muted' as const),
    }));

  return {
    headline: `${String(found.length)} held · ${String(untouched)} still unaltered`,
    rows,
    unknown: null,
  };
}

/**
 * The rare drops inside the relics this account holds.
 *
 * Ordered by rarity then chance, because the step says a relic is worth what
 * its rare drop is worth - so the rare rows are the answer and the commons are
 * context. A reward nobody can trade carries no slug and says so rather than
 * being dropped: Forma and the Requiem mods being untradeable is exactly the
 * fact that decides whether a relic is worth listing.
 */
function resolveRelicRewards(ctx: StepContext): StepAnswer {
  if (ctx.relics === null) {
    return { headline: null, rows: [], unknown: 'the relic table has not loaded, so contents cannot be read' };
  }
  if (ctx.inventory === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so the relics you hold are unknown' };
  }
  const misc = ctx.inventory['MiscItems'];
  if (!Array.isArray(misc)) {
    return { headline: null, rows: [], unknown: 'this account read did not carry your items' };
  }
  const held = new Set<string>();
  for (const row of misc) {
    const t = (row as { ItemType?: unknown } | null)?.ItemType;
    if (typeof t === 'string') held.add(t);
  }
  const mine = ctx.relics.filter((r) => held.has(r.itemType));
  if (mine.length === 0) {
    return { headline: 'you hold no relics the table knows', rows: [], unknown: null };
  }

  const rare = mine
    .flatMap((r) => r.rewards.filter((w) => w.rarity.toLowerCase() === 'rare').map((w) => ({ relic: r, w })))
    .sort((a, b) => b.w.chance - a.w.chance);

  const rows = rare.slice(0, 10).map(({ relic, w }) => ({
    lead: `${w.chance.toFixed(1)}%`,
    text: `${w.item} · from ${relic.tier} ${relic.name}${w.slug === null ? ' · not tradeable' : ''}`,
    tone: w.slug === null ? ('muted' as const) : ('good' as const),
  }));
  return {
    headline: `${String(mine.length)} relics held · ${String(rare.length)} rare rewards between them`,
    rows,
    unknown: null,
  };
}

/* Verified against WFCD: stars carry `Ornament` in the path, sculptures do not. */
const AYATAN_PREFIX = '/lotus/types/items/fusiontreasures/';

/**
 * Sculptures and stars, and how many sculptures are already filled.
 *
 * `Sockets` is a count of filled slots on that sculpture, so it separates the
 * ones ready to sell at the higher price from the ones still worth stars. A
 * sculpture with no `Sockets` field is reported as unfilled rather than as
 * unknown, because the field is absent when nothing is socketed.
 */
function resolveAyatan(ctx: StepContext): StepAnswer {
  if (ctx.account === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so your Ayatans are unknown' };
  }
  const rows0 = (ctx.account as unknown as Record<string, unknown>)['FusionTreasures'];
  if (!Array.isArray(rows0)) {
    return { headline: null, rows: [], unknown: 'this account read did not carry your Ayatan treasures' };
  }
  let stars = 0;
  let sculptures = 0;
  let filled = 0;
  for (const row of rows0) {
    const r = row as { ItemType?: unknown; ItemCount?: unknown; Sockets?: unknown } | null;
    const type = typeof r?.ItemType === 'string' ? r.ItemType.toLowerCase() : null;
    if (type === null || !type.startsWith(AYATAN_PREFIX)) continue;
    const count = typeof r?.ItemCount === 'number' ? r.ItemCount : 1;
    if (type.includes('ornament')) {
      stars += count;
    } else {
      sculptures += count;
      if (typeof r?.Sockets === 'number' && r.Sockets > 0) filled += count;
    }
  }
  if (stars === 0 && sculptures === 0) {
    return { headline: 'you hold no Ayatan sculptures or stars', rows: [], unknown: null };
  }
  const rows: StepRow[] = [
    { lead: String(sculptures), text: `sculptures held${sculptures > 0 ? ` · ${String(filled)} already socketed` : ''}`, tone: sculptures > 0 ? 'good' : 'muted' },
    { lead: String(stars), text: 'Amber and Cyan stars held', tone: stars > 0 ? 'good' : 'muted' },
  ];
  return { headline: `${String(sculptures)} sculptures, ${String(stars)} stars`, rows, unknown: null };
}

/*
 * Every focus lens lives under this prefix. Verified against WFCD: the school
 * is NOT in the path - Madurai is `AttackLens`, Naramon is `TacticLens` - so
 * grade is the only thing the path reliably distinguishes, and grade is what
 * the steps are about.
 */
const LENS_PREFIX = '/lotus/upgrades/focus/';

/**
 * Lenses held, by grade.
 *
 * `Ostron` marks the Eidolon grade and `Greater` the middle one; anything else
 * under the prefix is a plain lens. The steps ask about grades rather than
 * schools - keep the Eidolons, sell the rest - so grade is the split.
 */
function resolveLenses(ctx: StepContext): StepAnswer {
  if (ctx.account === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so your lenses are unknown' };
  }
  const bag = ctx.account as unknown as Record<string, unknown>;
  const rows0 = bag['RawUpgrades'];
  if (!Array.isArray(rows0)) {
    return { headline: null, rows: [], unknown: 'this account read did not carry your mods and lenses' };
  }
  let eidolon = 0;
  let greater = 0;
  let plain = 0;
  for (const row of rows0) {
    const r = row as { ItemType?: unknown; ItemCount?: unknown } | null;
    const type = typeof r?.ItemType === 'string' ? r.ItemType.toLowerCase() : null;
    if (type === null || !type.startsWith(LENS_PREFIX)) continue;
    const n = typeof r?.ItemCount === 'number' ? r.ItemCount : 1;
    if (type.includes('ostron')) eidolon += n;
    else if (type.includes('greater')) greater += n;
    else plain += n;
  }
  const total = eidolon + greater + plain;
  if (total === 0) {
    return { headline: 'you hold no focus lenses', rows: [], unknown: null };
  }
  return {
    headline: `${String(total)} ${total === 1 ? 'lens' : 'lenses'} held`,
    rows: [
      { lead: String(eidolon), text: 'Eidolon — the grade worth keeping for your own frames', tone: eidolon > 0 ? 'good' : 'muted' },
      { lead: String(greater), text: 'Greater', tone: greater > 0 ? 'good' : 'muted' },
      { lead: String(plain), text: 'plain — the lower grades players levelling a new school buy', tone: plain > 0 ? 'good' : 'muted' },
    ],
    unknown: null,
  };
}

/**
 * Kahl's weekly, as far as the read can honestly settle it.
 *
 * Only the entries at the highest `WeekCount` are counted, because the array's
 * shape is not documented in a primary source - it may be a history. Taking the
 * latest week and SAYING it is the latest week the read carried is true whether
 * the array holds one week or twenty, and does not pretend to know today's date.
 *
 * `CompletedMission` absent is neither done nor waiting. It is counted apart and
 * named, the same as every other absent field in this file.
 */
function resolveKahl(ctx: StepContext): StepAnswer {
  if (ctx.inventory === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so Kahl’s week is unknown' };
  }
  const affs = ctx.inventory['Affiliations'];
  if (!Array.isArray(affs)) {
    return { headline: null, rows: [], unknown: 'this account read did not carry your syndicates' };
  }
  const kahl = affs.find((a) => (a as { Tag?: unknown } | null)?.Tag === 'KahlSyndicate') as
    | { WeeklyMissions?: unknown }
    | undefined;
  if (kahl === undefined) {
    // Read, and not present: you have not started Veilbreaker. A measurement.
    return { headline: 'you have not started Kahl’s weeklies', rows: [], unknown: null };
  }
  const weeks = kahl.WeeklyMissions;
  if (!Array.isArray(weeks) || weeks.length === 0) {
    return { headline: null, rows: [], unknown: 'your Kahl standing carried no weekly missions in this read' };
  }

  const entries = weeks.map((w) => w as { CompletedMission?: unknown; WeekCount?: unknown } | null);
  const counts = entries.map((w) => (typeof w?.WeekCount === 'number' ? w.WeekCount : null)).filter((n): n is number => n !== null);
  const latest = counts.length === 0 ? null : Math.max(...counts);
  const week = latest === null ? entries : entries.filter((w) => w?.WeekCount === latest);

  let done = 0;
  let waiting = 0;
  let unclear = 0;
  for (const w of week) {
    if (w?.CompletedMission === true) done += 1;
    else if (w?.CompletedMission === false) waiting += 1;
    else unclear += 1;
  }

  const rows: StepRow[] = [];
  if (waiting > 0) rows.push({ lead: String(waiting), text: 'still to run', tone: 'good' });
  if (done > 0) rows.push({ lead: String(done), text: 'already run', tone: 'muted' });
  if (unclear > 0) rows.push({ lead: String(unclear), text: 'the read did not say either way', tone: 'muted' });
  rows.push({
    lead: 'read',
    // Never "this week". The array's shape is undocumented and the read may be old.
    text: latest === null ? 'the weeks your account carried, which are not dated' : 'the latest week your account carried',
    tone: 'muted',
  });

  return {
    headline:
      waiting > 0
        ? `${String(waiting)} still to run`
        : done > 0
          ? 'the latest week your account carried is already run'
          : 'nothing this read can settle',
    rows,
    unknown: null,
  };
}

/**
 * The live invasion rewards worth selling, ranked by what they pay.
 *
 * Three states kept apart, because they need opposite sentences: nothing read
 * yet, a rotation where nothing tradeable is running, and a priced list. The
 * empty array is deliberately NOT allowed to mean the first of those - the
 * panel resolves that before the context is built.
 */
function resolveInvasionValue(ctx: StepContext): StepAnswer {
  if (ctx.invasionCandidates === null) {
    return { headline: null, rows: [], unknown: 'the invasion list has not been read yet' };
  }
  if (ctx.invasionCandidates.length === 0) {
    // Read, and nothing sellable. A measurement about this rotation.
    return { headline: 'nothing running right now pays something you could sell', rows: [], unknown: null };
  }

  const priced = ctx.invasionOffers;
  const offers = priced ?? ctx.invasionCandidates;
  const rows = [...offers]
    .sort((a, b) => (b.worth ?? -1) - (a.worth ?? -1))
    .slice(0, 8)
    .map((o) => ({
      lead: o.worth === null ? (priced === null ? '—' : 'no quote') : `${String(Math.round(o.worth))}p`,
      text: `${o.count > 1 ? `${String(o.count)}× ` : ''}${o.item} · ${o.node} · ${o.faction}`,
      tone: o.worth === null ? ('muted' as const) : ('good' as const),
    }));

  const worth = offers.reduce((n, o) => n + (o.worth ?? 0), 0);
  return {
    headline:
      priced === null
        ? `${String(offers.length)} tradeable ${offers.length === 1 ? 'reward' : 'rewards'} running · prices still being read`
        : /*
           * Three runs per reward is the game's rule, not an estimate, and it is
           * what turns a price into a decision - `RUNS_PER_REWARD` in
           * `invasion-value.ts` carries it.
           */
          `${String(offers.length)} tradeable ${offers.length === 1 ? 'reward' : 'rewards'} running · ${String(Math.round(worth))}p if you took ${offers.length === 1 ? 'it' : 'them all'}`,
    rows,
    unknown: null,
  };
}

/**
 * Planets fully cleared, which is the Nightmare gate.
 *
 * The catalog is the denominator and `clearedNodes` the numerator, in that
 * order and never the reverse: `progression.ts` records that `Missions[]` is a
 * WIDER population than the star chart, so counting from the account's side
 * would let a node that is not on the chart at all inflate a planet.
 */
function resolvePlanets(ctx: StepContext): StepAnswer {
  if (ctx.catalog === null) {
    return { headline: null, rows: [], unknown: 'the node catalog has not loaded, so planets cannot be measured' };
  }
  if (ctx.picture === null || ctx.picture.nodes.have === null) {
    // Unread is not "nothing cleared". A zero here would be a claim about the player.
    return { headline: null, rows: [], unknown: 'your cleared nodes have not been read, so no planet can be checked' };
  }
  const cleared = ctx.picture.clearedNodes;

  const done: string[] = [];
  const partial: Array<{ planet: string; left: number; of: number }> = [];
  for (const [planet, ids] of ctx.catalog.planetNodes) {
    if (ids.length === 0) continue;
    const have = ids.filter((id) => cleared.has(id)).length;
    if (have === ids.length) done.push(planet);
    else partial.push({ planet, left: ids.length - have, of: ids.length });
  }
  if (done.length === 0 && partial.length === 0) {
    return { headline: null, rows: [], unknown: 'the catalog carries no planets to measure' };
  }

  // The nearest unfinished planet is the actionable one - it is the next place
  // Nightmare missions can be unlocked, and the step is about unlocking them.
  partial.sort((a, b) => a.left - b.left);
  const rows: StepRow[] = [];
  if (done.length > 0) {
    rows.push({ lead: String(done.length), text: `fully cleared: ${done.sort().join(', ')}`, tone: 'good' });
  }
  for (const q of partial.slice(0, 3)) {
    rows.push({ lead: `${String(q.left)} left`, text: `${q.planet} · ${String(q.of)} nodes`, tone: 'warn' });
  }

  return {
    headline:
      done.length === 0
        ? 'no planet is fully cleared yet, so Nightmare missions have not opened'
        : `${String(done.length)} ${done.length === 1 ? 'planet carries' : 'planets carry'} Nightmare missions${partial.length === 0 ? '' : ` · ${String(partial.length)} still open`}`,
    rows,
    unknown: null,
  };
}

/**
 * Cleared nodes of one faction, optionally above a level floor.
 *
 * Every criterion comes from the step itself and every one is a field on the
 * node: the faction, the level, and whether you have cleared it. A node you
 * cannot reach is not an answer, so uncleared ones are excluded rather than
 * listed with a caveat.
 *
 * A floor is applied only when the step states a number. Inventing one for a
 * step that says "level-appropriate" would hide qualifying nodes behind a
 * threshold this file cannot source.
 */
function resolveNemesisNode(ctx: StepContext, faction: 'Grineer' | 'Corpus', minLevel: number | null): StepAnswer {
  if (ctx.catalog === null) {
    return { headline: null, rows: [], unknown: 'the node catalog has not loaded, so nodes cannot be listed' };
  }
  if (ctx.picture === null || ctx.picture.nodes.have === null) {
    return { headline: null, rows: [], unknown: 'your cleared nodes have not been read, so no node can be suggested' };
  }
  const cleared = ctx.picture.clearedNodes;

  const spots = [...ctx.catalog.nodeById.values()]
    .filter((n) => {
      if (!cleared.has(n.id)) return false;
      /*
       * An EXACT faction match, which excludes the six nodes the catalog calls
       * 'Grineer or Corpus' and 'Grineer and Corpus'. Their faction alternates,
       * so naming one would send a player somewhere that is the right faction
       * only some of the time - and 110 nodes are plainly Grineer and 106
       * plainly Corpus, so nothing is lost by declining to guess about six.
       */
      if (n.enemy !== faction) return false;
      // No floor stated by the step means no floor invented here.
      if (minLevel === null) return true;
      // A stated floor applies to the node's OWN minimum, not its maximum.
      return n.minLevel !== null && n.minLevel >= minLevel;
    })
    .sort((a, b) => (a.minLevel ?? 0) - (b.minLevel ?? 0));

  if (spots.length === 0) {
    // Read, and none qualify. A measurement, and the answer to "where do I go".
    return {
      headline:
        minLevel === null
          ? `you have cleared no ${faction} node`
          : `no ${faction} node you have cleared runs at level ${String(minLevel)} or above`,
      rows: [],
      unknown: null,
    };
  }
  return {
    headline: `${String(spots.length)} of your own ${faction} ${spots.length === 1 ? 'node qualifies' : 'nodes qualify'}`,
    rows: spots.slice(0, 6).map((n) => ({
      lead: `${String(n.minLevel ?? 0)}-${String(n.maxLevel ?? 0)}`,
      text: `${n.name}${n.planet === null ? '' : ` · ${n.planet}`}${n.type === null ? '' : ` · ${n.type}`}`,
      tone: 'good' as const,
    })),
    unknown: null,
  };
}

/*
 * The 27 arcane helmets, keyed by lowercased path.
 *
 * Verified against WFCD's `Skins.json`; `check-resource-paths.ts` re-checks
 * every one against the live export, so a rename or a removal fails the build
 * rather than silently turning into "you hold none".
 */
const ARCANE_HELMETS = new Map<string, string>([
  ['/lotus/upgrades/skins/trinity/trinityhelmetalt', 'Arcane Aura Helmet'],
  ['/lotus/upgrades/skins/frost/frosthelmetalt', 'Arcane Aurora Helmet'],
  ['/lotus/upgrades/skins/excalibur/excaliburhelmetalt', 'Arcane Avalon Helmet'],
  ['/lotus/upgrades/skins/ember/emberhelmetaltb', 'Arcane Backdraft Helmet'],
  ['/lotus/upgrades/skins/asp/aspalthelmetb', 'Arcane Chlora Helmet'],
  ['/lotus/upgrades/skins/decree/decreealthelmetb', 'Arcane Chorus Helmet'],
  ['/lotus/upgrades/skins/mag/maghelmetalt', 'Arcane Coil Helmet'],
  ['/lotus/upgrades/skins/trapper/trapperhelmetalt', 'Arcane Esprit Helmet'],
  ['/lotus/upgrades/skins/loki/lokihelmetalt', 'Arcane Essence Helmet'],
  ['/lotus/upgrades/skins/antimatter/antialthelmet', 'Arcane Flux Helmet'],
  ['/lotus/upgrades/skins/trapper/trapperhelmetaltb', 'Arcane Gambit Helmet'],
  ['/lotus/upgrades/skins/asp/aspalthelmet', 'Arcane Hemlock Helmet'],
  ['/lotus/upgrades/skins/ninja/ninjahelmetaltb', 'Arcane Locust Helmet'],
  ['/lotus/upgrades/skins/mag/maghelmetaltb', 'Arcane Mag Gauss Helmet'],
  ['/lotus/upgrades/skins/jade/jadehelmetalt', 'Arcane Menticide Helmet'],
  ['/lotus/upgrades/skins/trinity/trinityhelmetaltb', 'Arcane Meridian Helmet'],
  ['/lotus/upgrades/skins/excalibur/excaliburhelmetaltb', 'Arcane Pendragon Helmet'],
  ['/lotus/upgrades/skins/ember/emberhelmetalt', 'Arcane Phoenix Helmet'],
  ['/lotus/upgrades/skins/volt/volthelmetaltb', 'Arcane Pulse Helmet'],
  ['/lotus/upgrades/skins/decree/decreealthelmet', 'Arcane Reverb Helmet'],
  ['/lotus/upgrades/skins/ninja/ninjahelmetalt', 'Arcane Scorpion Helmet'],
  ['/lotus/upgrades/skins/frost/frosthelmetaltb', 'Arcane Squall Helmet'],
  ['/lotus/upgrades/skins/volt/volthelmetalt', 'Arcane Storm Helmet'],
  ['/lotus/upgrades/skins/loki/lokihelmetaltb', 'Arcane Swindle Helmet'],
  ['/lotus/upgrades/skins/rhino/rhinohelmetalt', 'Arcane Thrak Helmet'],
  ['/lotus/upgrades/skins/rhino/rhinohelmetaltb', 'Arcane Vanguard Helmet'],
  ['/lotus/upgrades/skins/jade/jadehelmetaltb', 'Arcane Vespa Helmet'],
]);

/** For the live gate: every arcane helmet path this file claims exists. */
export const ARCANE_HELMET_PATHS: ReadonlyArray<{ path: string; name: string }> = [...ARCANE_HELMETS].map(
  ([path, name]) => ({ path, name }),
);

/**
 * Arcane helmets in this account, wherever the read happens to keep them.
 *
 * EVERY array in the read is searched rather than one named field. The obvious
 * candidate is `WeaponSkins`, whose rows carry an `ItemType` - but that name is
 * about weapons and these are warframe cosmetics, and no primary source in this
 * repository settles which array DE actually uses for them. Guessing wrong
 * would produce "you hold none" on the one step whose entire premise is that
 * you may hold one without knowing, which is the worst possible place in this
 * file to be confidently wrong. Searching everywhere costs one pass over a read
 * that is already in memory and cannot be wrong about the location.
 */
function resolveArcaneHelmets(ctx: StepContext): StepAnswer {
  if (ctx.inventory === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so your helmets are unknown' };
  }
  const arrays = Object.values(ctx.inventory).filter((v): v is unknown[] => Array.isArray(v));
  if (arrays.length === 0) {
    return { headline: null, rows: [], unknown: 'this account read carried no item lists to search' };
  }

  /*
   * WHICH FRAME A HELMET BELONGS TO, WITHOUT INVENTING IT.
   * ————————————————————————————————————————————
   * "Confirm which frame it belongs to - value varies enormously between them"
   * was filed as unanswerable because the skin export has no frame field and
   * the path carries only an internal codename: an Arcane Scorpion Helmet is
   * `/Lotus/Upgrades/Skins/Ninja/NinjaHelmetAlt`, and nothing in it says Ash.
   *
   * But the WARFRAME's own path carries the same codename -
   * `/Lotus/Powersuits/Ninja/Ninja` - so this is a join against the catalog the
   * app already loads, not a hand-written table. Twelve of the fourteen
   * codenames resolve that way, including the four nobody would guess: Trapper
   * is Vauban, AntiMatter is Nova, Ninja is Ash, Jade is Nyx.
   *
   * `Asp` and `Decree` resolve to NOTHING, because no warframe path uses them
   * any more - Saryn is `/Lotus/Powersuits/Saryn/Saryn` and Banshee is
   * `/Lotus/Powersuits/Banshee/Banshee`. Those four helmets say the frame could
   * not be resolved rather than being assigned one from folklore.
   */
  const byCodename = new Map<string, string>();
  for (const entry of ctx.items?.byType.values() ?? []) {
    const m = /^\/lotus\/powersuits\/([^/]+)\//i.exec(entry.uniqueName);
    const code = m?.[1]?.toLowerCase();
    if (code === undefined) continue;
    /*
     * The SHORTEST name wins, not the first.
     *
     * First-wins was the obvious rule and it was wrong: catalog order is
     * arbitrary, so `/Powersuits/Ninja/` resolved to "Ash Prime" as often as to
     * "Ash". A helmet fits the whole family, so naming the Prime is a narrower
     * claim than the data supports - and a player reading "Ash Prime" would
     * reasonably conclude the helmet does not fit their Ash.
     *
     * A base frame's name is always a prefix of its variants - Ash of Ash
     * Prime, Excalibur of Excalibur Umbra - so the shortest is the family name.
     */
    const prev = byCodename.get(code);
    if (prev === undefined || entry.name.length < prev.length) byCodename.set(code, entry.name);
  }

  const found = new Map<string, { n: number; frame: string | null }>();
  for (const rows of arrays) {
    for (const row of rows) {
      const type = (row as { ItemType?: unknown } | null)?.ItemType;
      // Some arrays hold bare path strings rather than rows.
      const path = typeof type === 'string' ? type : typeof row === 'string' ? row : null;
      if (path === null) continue;
      const lower = path.toLowerCase();
      const name = ARCANE_HELMETS.get(lower);
      if (name === undefined) continue;
      const code = /^\/lotus\/upgrades\/skins\/([^/]+)\//.exec(lower)?.[1];
      const prev = found.get(name);
      found.set(name, {
        n: (prev?.n ?? 0) + 1,
        frame: code === undefined ? null : (byCodename.get(code) ?? null),
      });
    }
  }

  if (found.size === 0) {
    /*
     * Every array was searched, so this is a measurement rather than a miss.
     * It is phrased as what was done - not "you own none" from one guessed
     * field, which is a different and unearned claim.
     */
    return { headline: 'no arcane helmet appears anywhere in this account read', rows: [], unknown: null };
  }
  return {
    headline: `${String(found.size)} arcane ${found.size === 1 ? 'helmet' : 'helmets'} held`,
    rows: [...found]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, v]) => ({
        lead: v.n > 1 ? `${String(v.n)}x` : 'held',
        /*
         * The frame is the half that decides the price, so it leads the text
         * where it is known. Where it is not, the gap is named - an unresolved
         * codename is our limit, not a fact about the helmet.
         */
        text:
          v.frame === null
            ? `${name} \u00b7 the path does not say which frame`
            : `${name} \u00b7 ${v.frame}`,
        tone: 'good' as const,
      })),
    unknown: null,
  };
}

/** The Circuit's two groups, in the feed's own keys. */
const CIRCUIT_GROUP: Readonly<Record<string, string>> = {
  EXC_NORMAL: 'normal Circuit \u00b7 warframes',
  EXC_HARD: 'Steel Path Circuit \u00b7 Incarnon weapons',
};

/**
 * What the Circuit is currently offering.
 *
 * NO EXPIRY IS SHOWN, deliberately. `duviriCycle.expiry` belongs to the mood,
 * which turns over every two hours, while the selection is weekly - so printing
 * the cycle's clock beside these names would tell a player their frames change
 * in twenty minutes. A wrong deadline is worse than no deadline on a route
 * whose whole point is that you cannot pick your own loadout.
 */
function resolveCircuit(ctx: StepContext): StepAnswer {
  const groups = ctx.ws?.duviriCycle?.choices;
  if (!Array.isArray(groups)) return { headline: null, rows: [], unknown: NO_WORLDSTATE };

  const rows: StepRow[] = [];
  let named = 0;
  for (const g of groups) {
    const picks = g.choices;
    if (!Array.isArray(picks) || picks.length === 0) continue;
    const key = typeof g.categoryKey === 'string' ? g.categoryKey : null;
    /*
     * The feed's own label is the fallback. An unrecognised key means DE added
     * a group, and printing its raw name beats dropping a group the player can
     * actually pick from.
     */
    const label = (key === null ? null : CIRCUIT_GROUP[key]) ?? g.category ?? 'offered';
    rows.push({ lead: String(picks.length), text: `${label}: ${picks.join(', ')}`, tone: 'good' });
    named += picks.length;
  }

  if (rows.length === 0) {
    return { headline: null, rows: [], unknown: 'the world state carried no Circuit selection in this read' };
  }
  return { headline: `${String(named)} on offer, and you use what it gives`, rows, unknown: null };
}

/**
 * Where a cosmetic family drops, by place.
 *
 * A place listed at 100 per cent is not a lucky drop - it is a syndicate rank
 * or a vendor, where the item is bought rather than farmed. That distinction is
 * the most useful thing in the table and is stated rather than flattened into
 * an average, because "you cannot farm this one, you rank up for it" changes
 * what the player does this evening.
 */
function resolveDropSource(ctx: StepContext, family: 'scene' | 'ephemera'): StepAnswer {
  void ctx;
  const want = family === 'scene' ? /\bscene\b/i : /\bephemera\b/i;
  const rows = DROP_SOURCES.sources.filter((r) => want.test(r.item));
  if (rows.length === 0) {
    return { headline: null, rows: [], unknown: `the vendored drop table carries no ${family} rows` };
  }

  /** place -> how many of the family it carries, and the best rate on it. */
  const byPlace = new Map<string, { n: number; best: number | null; guaranteed: boolean }>();
  for (const r of rows) {
    const prev = byPlace.get(r.place) ?? { n: 0, best: null, guaranteed: false };
    byPlace.set(r.place, {
      n: prev.n + 1,
      best: r.chance === null ? prev.best : Math.max(prev.best ?? 0, r.chance),
      guaranteed: prev.guaranteed || r.chance === 100,
    });
  }

  const ranked = [...byPlace].sort((a, b) => b[1].n - a[1].n || (b[1].best ?? 0) - (a[1].best ?? 0));
  const items = new Set(rows.map((r) => r.item)).size;

  return {
    headline: `${String(items)} ${family === 'scene' ? 'scenes' : 'ephemera'} across ${String(byPlace.size)} places`,
    rows: ranked.slice(0, 8).map(([place, v]) => ({
      lead: v.guaranteed ? 'bought' : v.best === null ? '?' : `${v.best.toFixed(2)}%`,
      text: `${place} \u00b7 ${String(v.n)} of them${v.guaranteed ? ' \u00b7 a rank or vendor reward, not a drop' : ''}`,
      tone: v.guaranteed ? ('muted' as const) : ('good' as const),
    })),
    unknown: null,
  };
}

/**
 * Netracells spent, and how many the week has left.
 *
 * THE RESET DATE IS LOAD-BEARING. `EntratiVaultCountLastPeriod` is a count for
 * the period ending at `EntratiVaultCountResetDate`; once that moment passes,
 * the number describes a week that is over. Reporting it anyway would tell a
 * player they had spent runs they have just been given back.
 *
 * A stale count is therefore UNKNOWN rather than zero - the same rule
 * `subsystems.ts` applies to daily standing, and the same reason: the account
 * has simply not been read since the reset, which is our gap, not a fact about
 * the player. The cap of five comes from the step's own words.
 */
const NETRACELLS_PER_WEEK = 5;

function resolveNetracells(ctx: StepContext): StepAnswer {
  if (ctx.account === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so this week is unknown' };
  }
  const bag = ctx.account as unknown as Record<string, unknown>;
  const used = bag['EntratiVaultCountLastPeriod'];
  if (typeof used !== 'number' || !Number.isFinite(used)) {
    return { headline: null, rows: [], unknown: 'this account read did not carry your Netracell count' };
  }

  const reset = bag['EntratiVaultCountResetDate'];
  const resetMs = epochMs(reset);
  if (resetMs !== null && resetMs <= ctx.now) {
    return {
      headline: null,
      rows: [],
      unknown: 'your Netracell week has reset since this account was read, so what you have spent is unknown',
    };
  }

  // `remaining`, not `left`: this file already has a `left()` that formats a
  // countdown, and shadowing it here silently broke the reset row below.
  const remaining = Math.max(0, NETRACELLS_PER_WEEK - used);
  const rows: StepRow[] = [
    { lead: String(remaining), text: 'left this week', tone: remaining > 0 ? 'good' : 'muted' },
    { lead: String(used), text: 'already run', tone: 'muted' },
  ];
  if (resetMs !== null) {
    rows.push({ lead: 'resets', text: left(new Date(resetMs).toISOString(), ctx.now) ?? 'soon', tone: 'muted' });
  }
  return {
    headline:
      remaining === 0 ? 'this week is spent' : `${String(remaining)} of ${String(NETRACELLS_PER_WEEK)} left this week`,
    rows,
    unknown: null,
  };
}

/**
 * Maroo's weekly hunt.
 *
 * `TauntHistory` carries one entry per node with a state of `TS_UNLOCKED` or
 * `TS_COMPLETED`. Nothing in the model dates those entries, so - exactly as
 * with Kahl's weeklies - this reports what the read carried and does not claim
 * to know which week it belongs to.
 */
function resolveMarooHunt(ctx: StepContext): StepAnswer {
  if (ctx.account === null) {
    return { headline: null, rows: [], unknown: 'your account has not been read, so the hunt is unknown' };
  }
  const hist = (ctx.account as unknown as Record<string, unknown>)['TauntHistory'];
  if (!Array.isArray(hist)) {
    return { headline: null, rows: [], unknown: 'this account read did not carry Maroo’s hunt' };
  }
  if (hist.length === 0) {
    // Read and empty: you have not taken it. That IS a measurement.
    return { headline: 'you have not taken Maroo’s hunt', rows: [], unknown: null };
  }

  let done = 0;
  let open = 0;
  let unclear = 0;
  for (const row of hist) {
    const state = (row as { state?: unknown } | null)?.state;
    if (state === 'TS_COMPLETED') done += 1;
    else if (state === 'TS_UNLOCKED') open += 1;
    else unclear += 1;
  }

  const rows: StepRow[] = [];
  if (open > 0) rows.push({ lead: String(open), text: 'unlocked and not yet run', tone: 'good' });
  if (done > 0) rows.push({ lead: String(done), text: 'completed', tone: 'muted' });
  if (unclear > 0) rows.push({ lead: String(unclear), text: 'the read did not say either way', tone: 'muted' });
  rows.push({
    lead: 'read',
    // Never "this week": nothing in TauntHistory dates an entry.
    text: 'what your account carried, which is not dated',
    tone: 'muted',
  });

  return {
    headline: open > 0 ? `${String(open)} unlocked and not yet run` : done > 0 ? 'the hunt your account carried is done' : 'nothing this read can settle',
    rows,
    unknown: null,
  };
}

/**
 * Answer one step's binding against whatever has actually been read.
 *
 * Pure: everything it can see arrives in `ctx`, including the clock, so a check
 * script can pin a moment and assert the wording exactly.
 */
export function resolveStep(bind: StepBind, ctx: StepContext): StepAnswer {
  switch (bind.of) {
    case 'fissures':
      return resolveFissures(ctx);
    case 'relics':
      return resolveRelics(ctx);
    case 'sortie':
      return resolveSortie(ctx);
    case 'archon':
      return resolveArchon(ctx);
    case 'baro':
      return resolveBaro(ctx);
    case 'varzia':
      return resolveVarzia(ctx);
    case 'cycle':
      return resolveCycle(ctx, bind.where);
    case 'nightwave':
      return resolveNightwave(ctx);
    case 'invasions':
      return resolveInvasions(ctx);
    case 'steelPath':
      return resolveSteelPath(ctx);
    case 'currency':
      return resolveCurrency(ctx, bind.which);
    case 'standing':
      return resolveStanding(ctx, bind.tag, bind.who);
    case 'spare':
      return resolveSpare(ctx);
    case 'nearSets':
      return resolveNearSets(ctx);
    case 'sells':
      return resolveSells(ctx);
    case 'quest':
      return resolveQuest(ctx, bind.name);
    case 'chart':
      return resolveChart(ctx);
    case 'frames':
      return resolveFrames(ctx);
    case 'nemesis':
      return resolveNemesis(ctx);
    case 'trades':
      return resolveTrades(ctx);
    case 'rivens':
      return resolveRivens(ctx);
    case 'intrinsics':
      return resolveIntrinsics(ctx);
    case 'runs':
      return resolveRuns(ctx);
    case 'syndicates':
      return resolveSyndicates(ctx);
    case 'wallet':
      return resolveWallet(ctx);
    case 'cycles':
      return resolveCycles(ctx);
    case 'spots':
      return resolveSpots(ctx);
    case 'foundry':
      return resolveFoundry(ctx);
    case 'vaultedSets':
      return resolveVaultedSets(ctx);
    case 'credits':
      return resolveCredits(ctx);
    case 'variants':
      return resolveVariants(ctx);
    case 'relicRewards':
      return resolveRelicRewards(ctx);
    case 'ayatan':
      return resolveAyatan(ctx);
    case 'lenses':
      return resolveLenses(ctx);
    case 'kahl':
      return resolveKahl(ctx);
    case 'invasionValue':
      return resolveInvasionValue(ctx);
    case 'planets':
      return resolvePlanets(ctx);
    case 'nemesisNode':
      return resolveNemesisNode(ctx, bind.faction, bind.minLevel);
    case 'arcaneHelmets':
      return resolveArcaneHelmets(ctx);
    case 'circuit':
      return resolveCircuit(ctx);
    case 'netracells':
      return resolveNetracells(ctx);
    case 'marooHunt':
      return resolveMarooHunt(ctx);
    case 'dropSource':
      return resolveDropSource(ctx, bind.family);
  }
}

/**
 * Is this answer worth an affordance?
 *
 * A step only becomes clickable when opening it would show something. An
 * answer with no headline and no rows is a click that costs the reader a
 * gesture to learn nothing, which is worse than the plain string it replaced.
 */
export function answers(a: StepAnswer): boolean {
  return a.headline !== null || a.rows.length > 0;
}
