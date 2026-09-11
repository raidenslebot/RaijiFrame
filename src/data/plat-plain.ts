/**
 * Why every unbound step is unbound.
 *
 * WHAT THIS FILE IS FOR
 * ────────────────────────
 * `plat-guide.ts` carries 203 steps. About half resolve against something the
 * app has actually read; the rest render as plain text. "The rest" was, for a
 * long time, an unexamined remainder - and an unexamined remainder is where a
 * missed binding hides indefinitely, because nothing distinguishes "we looked
 * and there is nothing to show" from "nobody looked".
 *
 * So every plain step is listed here with a reason, and `check-plat-steps.ts`
 * enforces three things: every plain step has an entry, every entry names a
 * step that really is plain, and every `covered` entry points at a step that
 * really is bound. A new step cannot be added without deciding which it is, and
 * a step that becomes answerable cannot keep its excuse.
 *
 * The reasons are deliberately few. A long taxonomy would let anything be
 * filed somewhere and the file would stop meaning anything.
 */

/** Why a step carries no live answer. */
export type PlainReason =
  /**
   * An action you take in the game. There is no state to report and no
   * decision to make - only the instruction, which is already the step.
   */
  | { kind: 'doing' }
  /**
   * A market or gameplay truth that holds regardless of this account. Attaching
   * a panel would repeat the sentence back with a number that does not depend
   * on it.
   */
  | { kind: 'principle' }
  /**
   * Depends on the player's own plans, taste or risk appetite. The app cannot
   * see those, and the standing instruction on this project is that it must not
   * ask for them either.
   */
  | { kind: 'judgement'; note: string }
  /**
   * The same question is already answered by another step on this route.
   * Binding it again would put two identical panels on one screen, which reads
   * as padding rather than as care.
   */
  | { kind: 'covered'; by: string }
  /**
   * The app would answer this if anything it reads carried the fact. `what`
   * names the missing source precisely, so a future dataset makes this a
   * to-do rather than a mystery.
   *
   * `feedKey` makes the claim FALSIFIABLE where it is about the world state.
   * An excuse is an assertion, and an assertion nobody checks rots: the
   * Circuit's rotation was filed here as absent from the feed while arriving in
   * it fully populated, because it was classified from the TypeScript model
   * rather than from the data. `check-plain-claims.ts` fetches the live feed
   * and fails if a key named here turns out to carry usable content.
   */
  | { kind: 'missing'; what: string; feedKey?: string };

/**
 * Keyed `routeId#stepIndex`.
 *
 * The index is positional, so reordering a route's steps means revisiting its
 * entries. The gate catches that: a key naming a step that is bound, or a step
 * that no longer exists, fails.
 */
export const PLAIN_STEPS: Readonly<Record<string, PlainReason>> = {
  // ---- fissures -----------------------------------------------------------
  'fissures#1': { kind: 'covered', by: 'fissures#0' },
  'fissures#3': { kind: 'doing' },
  // The other three players' drops are not knowable from outside the mission.
  'fissures#4': { kind: 'doing' },

  // ---- Baro ---------------------------------------------------------------
  'ducats#4': { kind: 'covered', by: 'ducats#3' },
  'ducats#5': { kind: 'doing' },

  // ---- vaulted / resurgence ----------------------------------------------
  'vaulted#2': { kind: 'principle' },
  'vaulted#3': { kind: 'doing' },
  'void-storms#3': { kind: 'doing' },

  // ---- rivens -------------------------------------------------------------
  'riven-sortie#1': { kind: 'covered', by: 'riven-sortie#0' },
  'riven-sortie#2': { kind: 'doing' },
  'riven-archon#1': { kind: 'judgement', note: 'which status weapons you own and like is your loadout, not a fact' },
  'riven-archon#2': { kind: 'doing' },
  'riven-archon#3': { kind: 'doing' },
  'riven-circuit#2': { kind: 'doing' },
  'riven-circuit#3': { kind: 'principle' },
  'riven-reroll#2': { kind: 'judgement', note: 'what a weapon "wants" depends on the build you are aiming at' },
  'riven-reroll#3': {
    kind: 'missing',
    what:
      'the INPUTS are now shown on step 2 - each riven with its weapon and reroll count, which is what the two tips ' +
      'turn on - but the price itself is not: warframe.market sells rivens through a separate auction API keyed on ' +
      'roll similarity, which is a different system from the closed-trade statistics every other route here uses',
  },

  // ---- mods ---------------------------------------------------------------
  'corrupted-mods#1': { kind: 'doing' },
  'corrupted-mods#2': { kind: 'judgement', note: 'who is in your squad and which keys they carry is not on your account' },
  'corrupted-mods#3': { kind: 'doing' },
  'nightmare-mods#1': {
    kind: 'missing',
    what: "a node's Nightmare handicap is chosen per run and is not published in the worldstate feed",
  },
  'nightmare-mods#2': { kind: 'doing' },
  'primed-mods#1': { kind: 'covered', by: 'primed-mods#0' },
  'primed-mods#2': { kind: 'judgement', note: 'which of his stock you want for yourself is taste' },
  'galvanized#1': {
    kind: 'missing',
    what:
      'the feed DOES carry an `arbitration` key, but it arrives unpopulated - node `SolNode000`, enemy `Tenno`, ' +
      'type `Unknown`, `expired: true` - so there is nothing in it to show',
    feedKey: 'arbitration',
  },
  'galvanized#2': { kind: 'judgement', note: 'whether a build survives Arbitration is not derivable from an inventory' },
  'augments#1': { kind: 'doing' },
  'augments#3': { kind: 'covered', by: 'augments#2' },
  'necramech-mods#1': { kind: 'doing' },
  'necramech-mods#2': { kind: 'doing' },
  'rare-mods#0': { kind: 'judgement', note: 'which mod you want to commit to is the decision the route is asking you to make' },
  'rare-mods#3': { kind: 'principle' },

  // ---- arcanes ------------------------------------------------------------
  'eidolon#0': { kind: 'covered', by: 'eidolon#1' },
  'eidolon#3': { kind: 'doing' },
  'eidolon#4': { kind: 'doing' },
  'eidolon#5': { kind: 'principle' },
  'profit-taker#1': { kind: 'doing' },
  'profit-taker#2': { kind: 'judgement', note: 'which damage types you can field is your arsenal and your mods, not a count' },
  'profit-taker#3': { kind: 'judgement', note: 'which Archgun to bring is a build decision' },
  'profit-taker#4': { kind: 'doing' },
  'iso-arcanes#0': { kind: 'doing' },
  'iso-arcanes#1': { kind: 'doing' },
  'iso-arcanes#2': { kind: 'doing' },
  'steel-essence#2': { kind: 'judgement', note: 'whether a build handles Steel Path is not derivable from an inventory' },

  // ---- liches and sisters -------------------------------------------------
  'lich-weapons#1': {
    kind: 'missing',
    what: "the nemesis weapon is a `WeaponIdx` into a manifest this app does not load, so the weapon's name cannot be resolved",
  },
  'lich-weapons#3': { kind: 'covered', by: 'lich-weapons#2' },
  'lich-weapons#4': {
    kind: 'missing',
    what: 'the requiem sequence is per-lich and the account carries only revealed hint INDICES, not the mods they name',
  },
  'lich-weapons#5': { kind: 'judgement', note: 'keeping the weapon or trading it is the choice the route exists to pose' },
  'sister-weapons#2': { kind: 'covered', by: 'sister-weapons#1' },
  'sister-weapons#3': { kind: 'judgement', note: 'keeping the weapon or trading it is the choice the route exists to pose' },
  'coda-weapons#2': { kind: 'judgement', note: 'keeping the weapon or trading it is the choice the route exists to pose' },
  'holokeys#3': { kind: 'doing' },

  // ---- trading itself -----------------------------------------------------
  'flipping#0': { kind: 'judgement', note: 'which items you already know the price of is knowledge the app cannot audit' },
  'flipping#1': { kind: 'judgement', note: 'judging a listing as underpriced is the skill the route is about' },
  'flipping#2': { kind: 'doing' },
  'sets-vs-parts#1': { kind: 'covered', by: 'sets-vs-parts#0' },
  'sets-vs-parts#2': { kind: 'doing' },

  // ---- ayatan -------------------------------------------------------------
  'maroo-ayatan#1': { kind: 'doing' },
  'maroo-ayatan#2': { kind: 'principle' },

  // ---- invasions ----------------------------------------------------------
  'invasion-rewards#1': { kind: 'doing' },
  'invasion-rewards#2': { kind: 'covered', by: 'invasion-rewards#0' },

  // ---- nightwave ----------------------------------------------------------
  'nightwave-cred#1': { kind: 'judgement', note: 'what you were going to play anyway is the one input only you have' },
  'nightwave-cred#2': {
    kind: 'missing',
    what: "Nightwave's shop offerings are not in the worldstate feed, which carries only the acts",
    feedKey: 'nightwave.offerings',
  },
  'nightwave-cred#3': { kind: 'principle' },

  // ---- onslaught ----------------------------------------------------------
  'onslaught#0': { kind: 'doing' },
  'onslaught#1': { kind: 'judgement', note: 'which frame clears zones fast enough is a build decision' },

  // ---- cosmetics ----------------------------------------------------------
  'captura#1': { kind: 'doing' },
  'captura#2': { kind: 'doing' },
  'ephemera#1': { kind: 'doing' },
  'ephemera#2': { kind: 'doing' },
  'imprints#0': { kind: 'judgement', note: 'which colours and breeds are desirable is taste, and it moves' },
  'imprints#1': { kind: 'doing' },

  // ---- relics and lenses --------------------------------------------------
  'sell-relics#3': { kind: 'principle' },
  'focus-lenses#3': { kind: 'principle' },

  // ---- arcane helmets -----------------------------------------------------
  // Answered by the panel on #0, which now names the frame beside each helmet.
  'arcane-helmets#1': { kind: 'covered', by: 'arcane-helmets#0' },

  // ---- syndicates ---------------------------------------------------------
  'kahl-mods#1': { kind: 'doing' },
  'kahl-mods#2': { kind: 'covered', by: 'kahl-mods#3' },
  'holdfasts-arcanes#3': { kind: 'covered', by: 'holdfasts-arcanes#2' },
  'conclave-augments#0': { kind: 'doing' },
  'conclave-augments#2': { kind: 'doing' },
  'conclave-augments#3': { kind: 'principle' },

  // ---- gathering ----------------------------------------------------------
  'fish-whole#0': { kind: 'doing' },
  'fish-whole#2': { kind: 'principle' },
  'fish-whole#3': { kind: 'principle' },
  'gems-cut#0': { kind: 'doing' },
  'gems-cut#2': { kind: 'doing' },
  'gems-cut#3': { kind: 'principle' },

  // ---- duviri -------------------------------------------------------------
  'riven-duviri-endless#1': { kind: 'doing' },
  'riven-duviri-endless#2': { kind: 'principle' },
};
