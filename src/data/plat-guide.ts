/**
 * How to actually DO each route, and how much gear it really asks for.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The panel could rank routes and could not tell you how to run one. "Eidolon
 * hunts" as a row is a label; what a player needs is where to stand, what to
 * bring, what order to do things in, and the one detail that ruins the run if
 * they miss it. A recommendation with no instructions is a recommendation you
 * cannot act on.
 *
 * COMBAT DEMAND
 * ─────────────
 * `demand` is how much killing power the route genuinely needs, 1 to 5:
 *
 *   1  a starter frame and a starter weapon clear it
 *   2  a levelled frame and one decent weapon
 *   3  a real build - proper mods, a forma or two
 *   4  a strong build; Steel Path and endurance territory
 *   5  a specialised meta build made for this content
 *
 * This is the axis the panel was missing entirely. Ranking a route "open" from
 * a quest gate alone told a fresh MR8 player to go hunt Eidolons, which is true
 * on paper and useless in practice: the gate is Saya's Vigil, the real
 * requirement is an Amp and a build that can break shields inside a night.
 *
 * Nothing here is a statistic. Steps are procedure and `demand` is a bracket,
 * both checkable against the game rather than measured from data nobody has.
 */

import type { StepBind } from './plat-steps.ts';

/**
 * One step, optionally able to answer for itself.
 *
 * A bare string is a step the app has nothing to add to - "collect ten Reactant
 * before extraction" is true on every account on every day, and dressing it in
 * an affordance that opens onto nothing would be worse than leaving it plain.
 *
 * The object form names a question the app can settle from live data or the
 * account: which fissures are open and which of them your relics can actually
 * open, what today's sortie is, whether Baro is here. The step keeps the
 * QUESTION and never the answer, so the guide stays static checkable content
 * and cannot drift from the feed.
 */
export type Step = string | { text: string; bind: StepBind };

/** The text of a step, whichever form it takes. */
export function stepText(s: Step): string {
  return typeof s === 'string' ? s : s.text;
}

/** The binding on a step, or null for a plain one. */
export function stepBind(s: Step): StepBind | null {
  return typeof s === 'string' ? null : s.bind;
}

export interface RouteGuide {
  /** Ordered, concrete, do-this-then-that. */
  steps: readonly Step[];
  /** How much combat capability it actually needs, 1..5. See the header. */
  demand: 1 | 2 | 3 | 4 | 5;
  /** The things people get wrong, or the detail that changes the outcome. */
  tips?: readonly string[];
}

export const ROUTE_GUIDE: Readonly<Record<string, RouteGuide>> = {
  fissures: {
    demand: 2,
    steps: [
      { text: 'Open the Void Relic segment in your orbiter and refine the relics you intend to run. Radiant costs the most Void Traces and gives the rare drop the best odds.', bind: { of: 'relics' } },
      'Equip one refined relic before you queue — the game asks after the mission starts, but choosing early avoids a scramble.',
      { text: 'Pick a fissure whose tier matches your relic. Capture and Exterminate are the fastest; Survival and Defence pay a second reward per rotation.', bind: { of: 'fissures' } },
      'Collect ten Reactant from the corrupted enemies before extraction. No Reactant means no reward, and this is the single most common way a run is wasted.',
      'At the reward screen you see all four players’ drops and choose one. Take the highest-value item, not the one from your own relic.',
      { text: 'Sell duplicates to other players; sell the junk at a relay kiosk for ducats.', bind: { of: 'spare' } },
    ],
    tips: [
      'Void Traces cap at 200 by default. Spend them on refining rather than letting them sit at the cap.',
      'A squad of four opens four relics, so you see four rewards for one run — this is why fissures are worth doing in a group.',
    ],
  },
  'relic-farm': {
    demand: 2,
    steps: [
      { text: 'Decide which tier you need: Lith drops on the early planets, Meso and Neo mid-system, Axi in the outer system and from later rotations.', bind: { of: 'relics' } },
      { text: 'Pick an endless mission on a planet in that band — Survival, Defence or Disruption — and check the rotation the relic drops in.', bind: { of: 'runs' } },
      { text: 'Run to the rotation that pays the relic, then extract and repeat rather than staying indefinitely.', bind: { of: 'spots' } },
      { text: 'Bring a frame that clears trash quickly; the bottleneck is enemy density, not survivability.', bind: { of: 'frames' } },
    ],
    tips: ['A resource or drop-chance booster multiplies this route more than any other, because the drop is the whole reward.'],
  },
  ducats: {
    demand: 1,
    steps: [
      { text: 'Open your inventory and look at the prime parts you have spare — anything you already own the set of, or that trades for almost nothing.', bind: { of: 'spare' } },
      { text: 'Go to any relay and find the Void Trader kiosk near where Baro appears.', bind: { of: 'baro' } },
      { text: 'Sell the spare parts for ducats. Common parts give the least, rare ones the most.', bind: { of: 'currency', which: 'ducats' } },
      { text: 'Bank the ducats until Baro arrives — his stock rotates and you cannot buy ahead.', bind: { of: 'baro' } },
      'When he lands, buy what resells well rather than what you personally want.',
      'List the surplus on the market; players who missed his visit pay for it afterwards.',
    ],
    tips: ['Baro stays two days. Check what he brought before spending, since ducats are slow to rebuild.'],
  },
  vaulted: {
    demand: 1,
    steps: [
      { text: 'Check which of your prime sets are vaulted — a vaulted set no longer drops from any relic.', bind: { of: 'vaultedSets' } },
      { text: 'Assemble complete sets where you can; a set sells for more than its parts and costs one trade instead of five.', bind: { of: 'trades' } },
      'Price against recent closed trades rather than the cheapest live listing, which is often someone undercutting to clear stock.',
      'List and wait. Vaulted items are slow but they do not lose value while they sit.',
    ],
    tips: [
      '“Vaulted” is not permanent. Prime Resurgence and the periodic unvaultings put a set back into circulation for a while, and a set listed at vaulted prices will sit unsold through one.',
    ],
  },
  resurgence: {
    demand: 1,
    steps: [
      { text: 'Go to Maroo’s Bazaar on Mars and find Varzia.', bind: { of: 'varzia' } },
      { text: 'Check which primes are currently unvaulted — the selection rotates.', bind: { of: 'varzia' } },
      { text: 'Spend Aya on the relics for the set you want. Aya drops from missions; Regal Aya is bought with money.', bind: { of: 'currency', which: 'aya' } },
      { text: 'Crack the relics in fissures as normal, then sell the parts or the assembled set.', bind: { of: 'fissures' } },
    ],
    tips: ['Unvaulted items dip in price while Varzia offers them and recover after she rotates away.'],
  },
  'void-storms': {
    demand: 4,
    steps: [
      { text: 'Build and equip a Railjack, and make sure its armaments can actually kill fighters.', bind: { of: 'intrinsics' } },
      { text: 'Choose a Void Storm node in the Proximas whose tier matches your relic.', bind: { of: 'fissures' } },
      { text: 'Equip the relic before launching, as with any fissure.', bind: { of: 'relics' } },
      'Clear the objectives and collect ten Reactant, exactly as in a ground fissure.',
      { text: 'Bank the Holokeys that drop; ten of them buys a Tenet weapon from Ergo Glast at any relay.', bind: { of: 'currency', which: 'holokeys' } },
    ],
    tips: ['Holokeys drop from Void Storms specifically, not from ordinary Railjack missions.'],
  },
  'riven-sortie': {
    demand: 3,
    steps: [
      { text: 'Open the Sortie from the star chart. It is three linked missions with escalating modifiers.', bind: { of: 'sortie' } },
      'Read the modifiers before building: an elemental enhancement or a weapon restriction can make a favourite loadout useless.',
      'Complete all three in order. Leaving between missions is fine; progress is kept for the day.',
      { text: 'If the reward is a veiled Riven, either unveil it yourself for the challenge or sell it veiled — veiled Rivens trade briskly because the buyer gambles on the roll.', bind: { of: 'rivens' } },
    ],
    tips: ['Sorties reset daily at 00:00 UTC. One attempt is all there is, so it is worth doing even on a short evening.'],
  },
  'riven-archon': {
    demand: 4,
    steps: [
      { text: 'Open the Archon Hunt — three missions, once a week, each harder than a Sortie.', bind: { of: 'archon' } },
      'Bring status weapons: Archons take reduced damage and the fight is long.',
      'Complete all three. The final mission is the Archon itself.',
      'Take the Archon Shard reward, and note that the table also carries a Riven.',
    ],
    tips: ['Archon Shards are not tradable. The Riven is the part of this table that turns into platinum.'],
  },
  'riven-circuit': {
    demand: 3,
    steps: [
      { text: 'Enter Duviri and choose The Circuit from the Undercroft.', bind: { of: 'cycle', where: 'duviri' } },
      { text: 'Pick from the week’s offered frames and weapons — you use what the rotation gives, not your own loadout, in the normal Circuit.', bind: { of: 'circuit' } },
      'Clear stages to advance the reward track. Each tier of the track pays out once per week.',
      'Steel Path Circuit pays the Incarnon adapters; normal Circuit pays the lower track.',
    ],
    tips: ['The reward track resets weekly. Anything you do not claim is gone when the rotation turns over.'],
  },
  'riven-reroll': {
    demand: 1,
    steps: [
      { text: 'Farm Kuva — Kuva Survival and Kuva Siphon missions on the Kuva Fortress are the direct sources.', bind: { of: 'currency', which: 'kuva' } },
      { text: 'Open the Riven at a mod station and reroll. Each roll costs more Kuva than the last, up to a ceiling.', bind: { of: 'rivens' } },
      'Stop when you hit a combination the weapon actually wants: damage and multishot on a gun, or a strong negative that does not matter.',
      'Price the result against recent sales of the same weapon with a similar roll.',
    ],
    tips: [
      'Disposition matters enormously: the same roll on a high-disposition weapon is worth several times what it is on a low one.',
      'An unrolled Riven has option value to a buyer. Selling it unrolled is sometimes better than a mediocre roll.',
    ],
  },
  'corrupted-mods': {
    demand: 2,
    steps: [
      { text: 'Build Dragon Keys in the foundry. Each key applies a handicap while carried.', bind: { of: 'foundry' } },
      'Take a Vault run on Deimos in the Orokin Derelict tileset.',
      'Ideally bring four players each carrying a different key, so any vault you find can be opened.',
      'Find the vault, open it with the matching key, and take the corrupted mod.',
      { text: 'Sell duplicates; the good corrupted mods are staples that newer players always need.', bind: { of: 'sells' } },
    ],
    tips: ['Carrying a key you do not need is pure handicap. Match keys to the vault type when you know it.'],
  },
  'nightmare-mods': {
    demand: 2,
    steps: [
      { text: 'Clear a planet fully to make its Nightmare missions appear.', bind: { of: 'planets' } },
      'Read the handicap before launching — energy drain, no shields, vampire and timed variants all change what you should bring.',
      'Complete the mission for a roll on the Nightmare mod table.',
      { text: 'Sell the dual-stat mods; several are still build staples.', bind: { of: 'sells' } },
    ],
    tips: [
      'Nightmare is an alternate mode that rotates across the planets you have already cleared, not a permanent node. If the one you want is not showing, it is on rotation rather than missing.',
    ],
  },
  'primed-mods': {
    demand: 1,
    steps: [
      { text: 'Bank ducats and credits ahead of Baro’s arrival.', bind: { of: 'baro' } },
      'When he lands, check the primed mods in his stock against what has been offered recently — the rarer the rotation, the better it resells.',
      'Buy the ones that resell, not only the ones you want.',
      { text: 'List them after he leaves, when the supply stops.', bind: { of: 'sells' } },
    ],
    tips: [
      'His stock is not a fixed list. A primed mod can be absent for many visits and then return, and it is precisely the ones he rarely carries that resell - what he brought last time tells you nothing about what he will bring next.',
    ],
  },
  galvanized: {
    demand: 4,
    steps: [
      { text: 'Clear the entire star chart, which is what unlocks Arbitrations.', bind: { of: 'chart' } },
      'Open the Arbitration node; it rotates hourly and only one is active at a time.',
      'Bring a build that survives: revives do not work normally in Arbitration and death ends your run.',
      { text: 'Complete rotations for Vitus Essence.', bind: { of: 'currency', which: 'vitusEssence' } },
      { text: 'Spend Essence with the Arbiters of Hexis on Galvanized mods and arcanes, then resell the surplus.', bind: { of: 'standing', tag: 'ArbitersSyndicate', who: 'the Arbiters of Hexis' } },
    ],
    tips: ['Arbitration Drones make nearby enemies invulnerable. Kill the drone first or nothing else dies.'],
  },
  augments: {
    demand: 1,
    steps: [
      { text: 'Pick a syndicate and pledge to it; standing accrues to the one you are sworn to.', bind: { of: 'syndicates' } },
      'Equip the syndicate sigil so missions build standing.',
      { text: 'Run missions until you reach the rank the augment you want requires.', bind: { of: 'syndicates' } },
      'Buy the augment with standing and list it. Standing is free; the mod is not.',
    ],
    tips: [
      'Opposed syndicates lose standing when you gain it. Pick a pair that does not fight, or accept the loss.',
      'The daily standing cap is shared across the six factions, so it is the real limit on this route.',
    ],
  },
  'necramech-mods': {
    demand: 3,
    steps: [
      { text: 'Finish Heart of Deimos and speak to Mother in the Necralisk.', bind: { of: 'quest', name: 'Heart of Deimos' } },
      'Take an Isolation Vault bounty in the Cambion Drift.',
      'Complete the vault stages; deeper vaults pay better tables.',
      { text: 'Collect the Necramech mods and sell the duplicates.', bind: { of: 'sells' } },
    ],
    tips: ['A Necramech of your own makes the deeper vaults far quicker, though it is not required to start.'],
  },
  'rare-mods': {
    demand: 2,
    steps: [
      'Pick a mod that sells steadily and has a single reliable source.',
      { text: 'Check the drop source and go to the node where that enemy spawns densely.', bind: { of: 'spots' } },
      { text: 'Farm with a frame that kills quickly and a resource booster if you have one.', bind: { of: 'frames' } },
      'Sell in small batches rather than dumping the lot, which crashes the price.',
    ],
    tips: [
      'A mod that sells steadily at ten platinum is worth more than one listed at two hundred with no buyers. Check that live buy orders exist before committing an evening to the drop.',
    ],
  },
  eidolon: {
    demand: 5,
    steps: [
      'Build an Amp — the starter Mote Amp is not enough; a decent tier from the Quills or Vox Solaris is the real entry requirement.',
      { text: 'Go to the Plains of Eidolon at night. The cycle is fifty minutes of night in a hundred-minute rotation.', bind: { of: 'cycle', where: 'cetus' } },
      { text: 'Bring a frame that can strip or ignore the shield, and a heavy single-target weapon for the limbs.', bind: { of: 'frames' } },
      'Break the Eidolon’s shield with Void damage from the Amp, then destroy the limbs with your weapon.',
      'Capture rather than kill for the better reward, using the lure charges you prepared beforehand.',
      'Convert the arcanes: five of a lower grade combine into one of the next.',
    ],
    tips: [
      'Lures must be charged before the fight starts or the capture is not possible.',
      'This is the most gear-dependent route in the game. Attempting it under-equipped wastes the night window entirely.',
    ],
  },
  'profit-taker': {
    demand: 4,
    steps: [
      { text: 'Reach Old Mate standing with Solaris United in Fortuna.', bind: { of: 'standing', tag: 'SolarisSyndicate', who: 'Solaris United' } },
      'Take the Profit-Taker heist from Eudico.',
      'Bring weapons covering several damage types — the Orb cycles its shield resistance and you need the matching element.',
      'Use an Archgun for the body once the shields are down.',
      'Collect the arcanes and the very large credit payout.',
    ],
    tips: ['Profit-Taker is the best credit source in the game, which matters because trading costs credits in tax.'],
  },
  'iso-arcanes': {
    demand: 3,
    steps: [
      'Take an Isolation Vault bounty from Mother in the Necralisk.',
      'Complete the first vault, then chain into the second and third for the better tables.',
      'Collect the arcanes from the vault rewards.',
      { text: 'Sell duplicates; several Deimos arcanes are build staples.', bind: { of: 'sells' } },
    ],
    tips: [
      'The vaults chain. Running the second and third straight from the first is far faster than taking three separate bounties, because the opening stages are not repeated.',
    ],
  },
  'steel-essence': {
    demand: 4,
    steps: [
      { text: 'Clear the whole star chart to unlock the Steel Path.', bind: { of: 'chart' } },
      { text: 'Open the Steel Path and find the daily Incursion nodes — there are several, each paying Steel Essence once a day.', bind: { of: 'currency', which: 'steelEssence' } },
      'Bring a build that handles the level and armour increase; this is not normal-difficulty content.',
      { text: 'Spend Essence with Teshin on arcanes and the rotating rare offerings, then resell.', bind: { of: 'steelPath' } },
    ],
    tips: ['Acolytes spawn in Steel Path missions and drop Essence directly. They are worth stopping for.'],
  },
  'zariman-arcanes': {
    demand: 4,
    steps: [
      { text: 'Finish Angels of the Zariman to open the Chrysalith.', bind: { of: 'quest', name: 'Angels of the Zariman' } },
      { text: 'Take Zariman bounties from the board, or Netracells from the Sanctum Anatomica if you have finished Whispers in the Walls.', bind: { of: 'standing', tag: 'ZarimanSyndicate', who: 'The Holdfasts' } },
      { text: 'Netracells are limited to five a week, so spend them on the weeks you can actually run them.', bind: { of: 'netracells' } },
      { text: 'Collect and sell the arcanes; several of these are current meta and hold price well.', bind: { of: 'sells' } },
    ],
    tips: [
      'These are among the few arcanes still in the current meta, which cuts both ways: a patch that changes a frame can halve or double one overnight. Sell into demand rather than hoarding.',
    ],
  },
  'lich-weapons': {
    demand: 3,
    steps: [
      { text: 'Kill a Kuva Larvling on a level-20-plus Grineer node in the origin system to create a lich.', bind: { of: 'nemesisNode', faction: 'Grineer', minLevel: 20 } },
      'Note the weapon and element it shows — this is fixed for that lich, so murmur only if it is one you want.',
      { text: 'Run its territory to build murmur progress and reveal the Requiem mods in order.', bind: { of: 'nemesis' } },
      'Buy or farm the Requiem mods you need; they come from Kuva Siphons and the Requiem relics.',
      'Attempt the parazon finisher with the right sequence. Guessing wrong levels the lich and costs you a run.',
      'Vanquish to keep the weapon, or Convert to make it tradable to another player.',
    ],
    tips: [
      'A converted lich is the tradable form. Vanquishing keeps the weapon for yourself instead.',
      'Check the weapon before committing: a lich you do not want is hours you do not get back.',
    ],
  },
  'sister-weapons': {
    demand: 4,
    steps: [
      { text: 'Kill a Treasurer on a level-appropriate Corpus node to create a Candidate, then a Sister.', bind: { of: 'nemesisNode', faction: 'Corpus', minLevel: null } },
      { text: 'Work the murmur exactly as with a lich, revealing the Requiem sequence.', bind: { of: 'nemesis' } },
      'Complete the Sister’s final confrontation, which takes place in Railjack — a built Railjack is required.',
      'Convert to trade the Tenet weapon, or Vanquish to keep it.',
    ],
    tips: [
      'The confrontation is in Railjack, so a built ship is not optional the way it is for a Kuva lich. Creating a Sister you cannot finish leaves her stalking your missions until you can.',
    ],
  },
  'coda-weapons': {
    demand: 4,
    steps: [
      { text: 'Progress the Höllvania content far enough to trigger the Coda nemesis line.', bind: { of: 'quest', name: 'The Hex' } },
      { text: 'Create a Coda and work its murmur the same way as a lich.', bind: { of: 'nemesis' } },
      'Complete the confrontation and either keep or convert the weapon.',
    ],
    tips: [
      'This is recent content, so the market for Coda weapons is thin and moves in both directions. Read the live orders rather than the listed price before committing to the hunt.',
    ],
  },
  holokeys: {
    demand: 4,
    steps: [
      { text: 'Build a Railjack capable of running Void Storms.', bind: { of: 'intrinsics' } },
      { text: 'Run Void Storm nodes, which drop Holokeys alongside the fissure rewards.', bind: { of: 'fissures' } },
      { text: 'Bank ten Holokeys — that is the exact price of one weapon, and partial stacks buy nothing.', bind: { of: 'currency', which: 'holokeys' } },
      'Trade them to Ergo Glast at any relay for a Tenet weapon with a rolled bonus — no Sister required.',
    ],
    tips: ['The bonus percentage is rolled at purchase. A high roll is worth noticeably more to a buyer.'],
  },
  flipping: {
    demand: 1,
    steps: [
      'Pick a handful of items you know the usual price of — a narrow watchlist beats a wide one.',
      'Watch for listings well under that price, usually from players clearing inventory quickly.',
      'Buy, then relist at the normal price and wait.',
      { text: 'Keep enough platinum liquid that you can act when something appears.', bind: { of: 'wallet' } },
    ],
    tips: [
      'Your daily trade count is the real limit here, not your platinum.',
      'Undercutting your own relist by a few platinum sells much faster than holding out for the top price.',
    ],
  },
  'sets-vs-parts': {
    demand: 1,
    steps: [
      { text: 'Look at the prime parts you hold and find the ones that are one or two pieces from a full set.', bind: { of: 'nearSets' } },
      'Buy the missing pieces cheaply — they are usually the common ones.',
      'List the completed set rather than the parts.',
    ],
    tips: ['A set is one trade. The same parts sold individually can be five, against a daily limit.'],
  },
  ayatan: {
    demand: 1,
    steps: [
      { text: 'Take Maroo’s weekly Ayatan Treasure Hunt from Maroo’s Bazaar for a guaranteed sculpture.', bind: { of: 'marooHunt' } },
      { text: 'Keep the sculptures rather than filling and dissolving them all for Endo.', bind: { of: 'ayatan' } },
      { text: 'Fill a sculpture with stars before selling — a filled one is worth more.', bind: { of: 'ayatan' } },
      { text: 'List for collectors; this is a slow but steady seller.', bind: { of: 'sells' } },
    ],
    tips: [
      'Dissolving a sculpture for Endo destroys the trade permanently. Endo has many sources and some sculptures have very few - check what one sells for before feeding it to the converter.',
    ],
  },
  'invasion-rewards': {
    demand: 2,
    steps: [
      { text: 'Open the invasion list on the star chart and read what each side is offering.', bind: { of: 'invasions' } },
      'Complete three missions for the faction whose reward you want.',
      'Take the reward — often a weapon part, an Orokin Catalyst or a Reactor.',
      { text: 'Catalysts and Reactors are always in demand; weapon parts sell if the weapon is popular.', bind: { of: 'invasionValue' } },
    ],
    tips: ['Invasions expire when one side wins. A reward you wanted can disappear mid-progress.'],
  },
  'nightwave-cred': {
    demand: 2,
    steps: [
      { text: 'Open Nightwave and read the current acts — daily, weekly and elite weekly.', bind: { of: 'nightwave' } },
      'Do the ones that overlap with what you were going to play anyway.',
      'Spend the creds on the offerings that sell: Nitain, auras, and the rarer cosmetics.',
      'Buy the limited-stock items first; they rotate out.',
    ],
    tips: [
      'The elite weeklies pay several times what a daily pays. A week spent only on dailies costs far more play time per cred than one where the two elites are cleared first.',
    ],
  },
  onslaught: {
    demand: 4,
    steps: [
      'Open Elite Sanctuary Onslaught from the Sanctuary node.',
      'Bring a frame that clears zones quickly — efficiency drains if you kill too slowly, and the run ends.',
      { text: 'Push to the later zones where the reward table improves.', bind: { of: 'spots' } },
      { text: 'Sell the Peculiar mods and the Khora parts.', bind: { of: 'sells' } },
    ],
    tips: [
      'Efficiency drains faster the longer you stay, and hitting zero ends the run at the last rotation you banked rather than the zone you are standing in. Leave on a rotation boundary instead of pushing one zone further.',
    ],
  },
  captura: {
    demand: 2,
    steps: [
      { text: 'Find which mission or boss drops the scene you want.', bind: { of: 'dropSource', family: 'scene' } },
      'Check whether it is farmed at all: most scenes are a syndicate rank reward you buy with standing, and only eleven of the sixty-three are a drop.',
      'List them for players who build screenshots — a small but consistent market.',
    ],
    tips: [
      'A scene is a one-off purchase - nobody needs two. That caps demand hard, so price it to sell rather than holding out for a peak that never arrives.',
    ],
  },
  imprints: {
    demand: 1,
    steps: [
      'Raise a Kubrow or Kavat whose colours or breed are desirable.',
      'Buy Genetic Code Templates and make imprints from it — two imprints reproduce the pattern.',
      { text: 'Sell imprints in pairs; a buyer needs two to breed the result.', bind: { of: 'sells' } },
    ],
    tips: ['Rare colour combinations are the whole value. A common one is not worth the incubator time.'],
  },
  'sell-relics': {
    demand: 1,
    steps: [
      { text: 'Look at which Prime sets are currently unvaulted or newly released — those relics are the ones people are actively buying.', bind: { of: 'varzia' } },
      { text: 'Check what your relic actually contains before listing it. A relic is worth what its rare drop is worth, not what its tier is.', bind: { of: 'relicRewards' } },
      { text: 'List the relic itself rather than cracking it. This costs you no mission time at all and no Void Traces.', bind: { of: 'sells' } },
      'Refinement matters to buyers: a Radiant relic is a different listing from an Intact one, and worth more.',
    ],
    tips: [
      'This is the route to take when you have twenty minutes and no appetite for a squad. It is the only prime-economy option that needs no mission.',
      'Vaulted relics cannot drop any more, so their supply only shrinks. Holding those rather than cracking them is a real strategy.',
    ],
  },
  'requiem-relics': {
    demand: 2,
    steps: [
      { text: 'Farm Requiem relics in the Kuva Fortress, or run Requiem fissures when they appear in the world state.', bind: { of: 'fissures' } },
      { text: 'Crack them in a Requiem fissure. All eight Requiem mods are tradeable and every one of them sells.', bind: { of: 'fissures' } },
      { text: 'Keep a full set with charges left for your own Lich or Sister first — the mods are consumed as you use them.', bind: { of: 'nemesis' } },
      { text: 'Sell the surplus. Demand renews every time any player starts a new nemesis, which never stops.', bind: { of: 'sells' } },
    ],
    tips: [
      'Charges are visible to buyers. A mod with all three charges is worth distinctly more than a partly used one.',
      'Oull substitutes for any Requiem, which makes it the most valuable of the family.',
    ],
  },
  'baro-flip': {
    demand: 1,
    steps: [
      { text: 'Before he arrives, build a Ducat pile — the prime junk route below feeds this one directly.', bind: { of: 'currency', which: 'ducats' } },
      { text: 'Bring Credits as well. Everything he sells costs both, and running out of Credits at the kiosk is the usual mistake.', bind: { of: 'credits' } },
      { text: 'When he lands, compare what he brought against live market prices. The good flips vary wildly from visit to visit.', bind: { of: 'baro' } },
      { text: 'Buy the items whose platinum price clearly exceeds their Ducat cost, and list them.', bind: { of: 'currency', which: 'ducats' } },
    ],
    tips: [
      'His stock is not published until he actually arrives, so no shopping list can be prepared in advance. Prepare the Ducats instead.',
      'He stays for forty-eight hours and then leaves for two weeks. Missing him costs you a fortnight.',
    ],
  },
  'ayatan-stars': {
    demand: 1,
    steps: [
      { text: 'Stop dropping them. Amber and Cyan stars fall constantly in ordinary missions and most players ignore them.', bind: { of: 'ayatan' } },
      { text: 'Accumulate a real quantity — individually they are worth very little, so this is only worth a trade in bulk.', bind: { of: 'ayatan' } },
      { text: 'Fill your own sculptures first if you still want Endo; sell the surplus stars.', bind: { of: 'ayatan' } },
      { text: 'Sell in the largest lots a buyer will take, because six items per side per trade is the binding limit here.', bind: { of: 'trades' } },
    ],
    tips: [
      'Amber stars are the scarcer of the two and are worth noticeably more than Cyan.',
      'Check the trade arithmetic before committing: a very large stack can cost more daily trades than it is worth.',
    ],
  },
  'focus-lenses': {
    demand: 2,
    steps: [
      { text: 'Collect lenses from Sortie rewards and from Cetus and Fortuna bounty tiers.', bind: { of: 'sortie' } },
      { text: 'Keep Eidolon lenses for your own frames if you are still building Focus — they are the best in the game.', bind: { of: 'lenses' } },
      { text: 'Sell the duplicates and the lower grades; players levelling a new school buy them constantly.', bind: { of: 'sells' } },
      'Do not install one you intend to sell. An installed lens is gone.',
    ],
    tips: [
      'This is a slow, reliable seller rather than a spike. Supply is a fixed trickle from Sorties and bounties and demand renews with every player who starts a new school, so the price barely moves in either direction.',
    ],
  },
  'arcane-helmets': {
    demand: 1,
    steps: [
      { text: 'Check whether you already own any. They came from events years ago and many long-running accounts hold one without realising.', bind: { of: 'arcaneHelmets' } },
      'Confirm which frame it belongs to — value varies enormously between them.',
      { text: 'List it, or hold it. Supply cannot grow: they have not been obtainable for a very long time.', bind: { of: 'sells' } },
    ],
    tips: [
      'These are among the only tradeable cosmetics in the entire game. Almost everything else you wear is bound to your account.',
    ],
  },
  'syndicate-weapons': {
    demand: 2,
    steps: [
      { text: 'Identify what you hold: Vandal, Wraith and Prisma variants of ordinary weapons.', bind: { of: 'variants' } },
      { text: 'Check the weapon is UNALTERED. Ranking it up, adding Forma, or installing a catalyst can end its tradeability.', bind: { of: 'variants' } },
      { text: 'Sell it as it came. Buyers want the untouched item because they intend to build it themselves.', bind: { of: 'sells' } },
      { text: 'Watch Baro and the events — a variant that returns to circulation loses value quickly.', bind: { of: 'baro' } },
    ],
    tips: [
      'This is the one family where using the thing destroys its value. Decide before you put a single Forma in it.',
    ],
  },
  'kahl-mods': {
    demand: 2,
    steps: [
      { text: 'Run Kahl’s Break Narmer mission once a week. It is a stealth-flavoured mission with its own loadout, not your frames.', bind: { of: 'kahl' } },
      'Collect the Stock it pays and spend it with Chipper in the Drifter’s Camp.',
      'Buy the Archon mods — Vitality, Continuity, Stretch, Intensify and Flow. All five trade.',
      { text: 'Keep one set for your own builds; they are genuinely strong. Sell the rest.', bind: { of: 'sells' } },
    ],
    tips: [
      'The cap is weekly and cannot be rushed, so this is a steady trickle rather than something to grind.',
    ],
  },
  'holdfasts-arcanes': {
    demand: 3,
    steps: [
      { text: 'Finish Angels of the Zariman to unlock the Chrysalith and the Holdfasts syndicates.', bind: { of: 'quest', name: 'Angels of the Zariman' } },
      { text: 'Run Zariman missions to earn Holdfasts standing. Your daily standing cap is shared, so this is a daily rhythm.', bind: { of: 'standing', tag: 'ZarimanSyndicate', who: 'The Holdfasts' } },
      { text: 'Buy arcanes outright from Cavalero for standing rather than hoping for a drop.', bind: { of: 'standing', tag: 'ZarimanSyndicate', who: 'The Holdfasts' } },
      'Sell them. Because the standing prices are published, you know the conversion rate before you commit an evening.',
    ],
    tips: [
      'This is the rare arcane route with no luck in it at all: fixed cost in, known item out.',
      'The daily standing cap rises with Mastery Rank, so this scales with your account rather than your gear.',
    ],
  },
  'conclave-augments': {
    demand: 3,
    steps: [
      'Talk to Teshin in any relay and queue for Conclave matches.',
      { text: 'Earn Conclave standing. It comes from its own pool and does not touch your six-faction daily cap at all — this is free standing you are not otherwise using.', bind: { of: 'standing', tag: 'ConclaveSyndicate', who: 'Conclave' } },
      'Buy the warframe augment mods he sells.',
      'Sell them. Very few players are willing to play Conclave, which is exactly why the supply is thin.',
    ],
    tips: [
      'The separate standing pool is the real point: running Conclave costs you nothing you would have spent elsewhere.',
    ],
  },
  'maroo-ayatan': {
    demand: 1,
    steps: [
      { text: 'Visit Maroo in Maroo’s Bazaar once a week and take the Ayatan sculpture hunt.', bind: { of: 'marooHunt' } },
      'Run the mission — it is a treasure hunt built around finding one sculpture, and it is short.',
      'Keep the sculpture whole. Filling it with stars and dissolving it for Endo destroys the trade.',
      { text: 'Sell the rarer sculptures; the common ones are usually worth more to you as Endo.', bind: { of: 'sells' } },
    ],
    tips: [
      'One a week, guaranteed, with no drop chance involved. It is small but it never fails.',
    ],
  },
  'fish-whole': {
    demand: 1,
    steps: [
      'Buy a spear and bait from the hub vendor — Fisher Hai-Luk in Cetus, The Business in Fortuna, Daughter in the Necralisk.',
      { text: 'Fish the right water at the right time: the rare species are conditional on time of day, on the pond, and often on bait.', bind: { of: 'cycles' } },
      'Do NOT take the catch to the vendor to be cut. Cutting turns a tradeable fish into untradeable parts, and it cannot be undone.',
      'Trade the fish whole. Buyers want them uncut precisely because they want to cut them for their own crafting.',
    ],
    tips: [
      'This is the one place in the game where processing your loot destroys its value. Every fish part is untradeable; every whole fish can be sold.',
      'Cut only what YOUR own blueprints need, and only after you have set aside what you intend to sell.',
    ],
  },
  'gems-cut': {
    demand: 1,
    steps: [
      'Buy a mining laser from the hub vendor and learn the ore nodes: red veins are ore, blue are gems.',
      { text: 'Mine the rare gems specifically — the common ores are not worth a trade slot.', bind: { of: 'trades' } },
      'Take the raw stones to the vendor and pay to have them cut. This is the opposite of fishing: raw ore does not sell, the cut gem does.',
      'Trade the cut gems. Buyers want them cut because cutting costs them the same vendor time it cost you.',
    ],
    tips: [
      'Cutting takes real time on the vendor’s clock, so start a batch before you log off rather than waiting on it.',
    ],
  },
  'riven-duviri-endless': {
    demand: 4,
    steps: [
      { text: 'Finish The Duviri Paradox, then enter Duviri and choose Endless rather than the Circuit.', bind: { of: 'quest', name: 'The Duviri Paradox' } },
      'Select HARD. Rivens do not appear in the Normal table at all, at any tier.',
      'Push to tier six or seven — both carry the same table: Melee at 11.9 per cent, Pistol and Rifle at 8.5 each, Shotgun at 2.7, Zaw and Kitgun at 1.2. Past tier seven you are on Repeated Rewards, where every one of them falls to 0.95.',
      { text: 'Tiers one, three and four pay three Riven Slivers at 4.43 per cent — not every tier, and none above four. Ten Slivers buy a Riven from Palladino.', bind: { of: 'currency', which: 'rivenSlivers' } },
      { text: 'Veiled Rivens sell as they are. Unveiling is a gamble that can raise or destroy the price, so sell veiled unless you intend to keep it.', bind: { of: 'rivens' } },
    ],
    tips: [
      'The gear check is real: Hard tiers scale, and a build that stalls at tier four never reaches the Riven rows.',
      'This is the route people mean when they say "Duviri drops Rivens". The Circuit, which is what most players run, does not.',
    ],
  },
  ephemera: {
    demand: 3,
    steps: [
      { text: 'Pick a specific ephemera and find its source — liches, Eidolons and specific bosses each drop their own.', bind: { of: 'dropSource', family: 'ephemera' } },
      'Check whether it is farmed at all: several are syndicate or vendor rewards bought with standing rather than dropped.',
      'List it. Cosmetics hold price because supply is thin and demand is constant.',
    ],
    tips: [
      'The drop rates are among the lowest in the game and there is no pity mechanic, so this belongs alongside something else rather than as a target. The flip side is why they pay: nobody can farm one reliably, including the person buying it.',
    ],
  },
};

/** The guide for a route, or null when none is written yet. */
export function guideFor(id: string): RouteGuide | null {
  return ROUTE_GUIDE[id] ?? null;
}

export const DEMAND_LABEL: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Any gear',
  2: 'A levelled loadout',
  3: 'A real build',
  4: 'A strong build',
  5: 'A specialised build',
};
