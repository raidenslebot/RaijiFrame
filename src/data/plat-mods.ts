/**
 * Whether your mods can actually carry a route.
 *
 * THE HALF THE SLIDERS WERE STANDING IN FOR
 * ─────────────────────────────────────────
 * The panel asks how strong your frame and weapons are with two sliders,
 * because nothing in an inventory describes a BUILD. That is still true of the
 * arrangement - which mods are in which slots, at what rank, on what polarity -
 * and it will stay a slider.
 *
 * But part of it is not a judgment at all. Whether you OWN Blind Rage is a
 * fact. Whether you have ranked it is a fact, because the game stores the rank.
 * A route whose guide says "needs a specialised build" and a player who owns
 * none of the mods that build is made of are not a matching pair, and the
 * account has known this the whole time.
 *
 * WHY RANK MATTERS AND IS CHECKED
 * ───────────────────────────────
 * DE stores mods in two places and the split is the useful part:
 *
 *   `RawUpgrades`  stacked and UNRANKED - `{ItemType, ItemCount}`
 *   `Upgrades`     individually tracked because they have been RANKED, with
 *                  `UpgradeFingerprint` carrying `{"lvl":N}`
 *
 * A mod lives in exactly one, never both. So "owned" and "owned at rank 8" are
 * both answerable, and they are very different facts: an unranked Blind Rage
 * does nothing at all for a build that needs it near maximum.
 *
 * MAX RANKS ARE NOT UNIFORM AND ARE NOT GUESSED
 * ─────────────────────────────────────────────
 * Serration maxes at 10, Vitality at 10, Fleeting Expertise at 5. Every figure
 * below was read from WFCD's mod export rather than assumed, because a "maxed"
 * test against a wrong ceiling is worse than no test.
 *
 * The paths are full paths on purpose: Serration and Hornet Strike are both
 * `WeaponDamageAmountMod` and differ only in `/Rifle/` versus `/Pistol/`, so
 * matching a fragment would conflate them.
 */

import type { RawAccount } from './account.ts';

export interface ModSpec {
  name: string;
  /** DE's full path. Verified against WFCD's export. */
  path: string;
  /** Highest rank this mod accepts. Not uniform, so not assumed. */
  maxRank: number;
}

/**
 * The mods worth checking, and only those.
 *
 * Deliberately small. This is not a mod database - the app has one of those -
 * it is the handful whose absence actually predicts that a demanding route will
 * go badly. Adding fifty more would turn a useful signal into a checklist
 * nobody reads.
 *
 * WHICH ROW THE PATH NAMES
 * The path is the UNTIERED row for the name - no `/Beginner/`, `/Intermediate/`
 * or `/Expert/` segment - and maxRank is that row's fusionLimit. Mods.json
 * ships Beginner, Intermediate and Expert copies of Serration, Hornet Strike,
 * Vitality, Intensify and Stretch under the same name: the Beginner rows are
 * the Flawed mods from Vor's Prize, the Expert rows are Mods 1.0 leftovers the
 * game no longer issues. This table once pointed Serration and Hornet Strike
 * at the Beginner rows, and matching by exact path made a maxed real Serration
 * read as unowned. "Highest fusionLimit" is NOT the rule - it would send
 * Intensify and Stretch to an Expert row (fusionLimit 10) that no account
 * holds. `scripts/check-key-mods.ts` asserts the identity.
 */
export const KEY_MODS: Record<string, ModSpec> = {
  blindRage: { name: 'Blind Rage', path: '/Lotus/Upgrades/Mods/Warframe/DualStat/CorruptedPowerEfficiencyWarframe', maxRank: 10 },
  narrowMinded: { name: 'Narrow Minded', path: '/Lotus/Upgrades/Mods/Warframe/DualStat/CorruptedDurationRangeWarframe', maxRank: 10 },
  transientFortitude: { name: 'Transient Fortitude', path: '/Lotus/Upgrades/Mods/Warframe/DualStat/CorruptedPowerStrengthPowerDurationWarframe', maxRank: 10 },
  fleetingExpertise: { name: 'Fleeting Expertise', path: '/Lotus/Upgrades/Mods/Warframe/DualStat/CorruptedEfficiencyDurationWarframe', maxRank: 5 },
  intensify: { name: 'Intensify', path: '/Lotus/Upgrades/Mods/Warframe/AvatarAbilityStrengthMod', maxRank: 5 },
  stretch: { name: 'Stretch', path: '/Lotus/Upgrades/Mods/Warframe/AvatarAbilityRangeMod', maxRank: 5 },
  flow: { name: 'Flow', path: '/Lotus/Upgrades/Mods/Warframe/AvatarPowerMaxMod', maxRank: 5 },
  streamline: { name: 'Streamline', path: '/Lotus/Upgrades/Mods/Warframe/AvatarAbilityEfficiencyMod', maxRank: 5 },
  vitality: { name: 'Vitality', path: '/Lotus/Upgrades/Mods/Warframe/AvatarHealthMaxMod', maxRank: 10 },
  serration: { name: 'Serration', path: '/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod', maxRank: 10 },
  hornetStrike: { name: 'Hornet Strike', path: '/Lotus/Upgrades/Mods/Pistol/WeaponDamageAmountMod', maxRank: 10 },
};

export type ModKey = keyof typeof KEY_MODS;

export interface ModState {
  spec: ModSpec;
  /** True when held, false when definitely not, null when the account is unread. */
  owned: boolean | null;
  /** Rank, when held. Zero for an unranked copy sitting in `RawUpgrades`. */
  rank: number | null;
}

const at = (v: unknown, k: string): unknown => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined);

/** The rank inside `{"lvl":N}`, or 0 when the fingerprint says nothing useful. */
function rankOf(row: unknown): number {
  const raw = at(row, 'UpgradeFingerprint');
  if (typeof raw !== 'string') return 0;
  try {
    const lvl = (JSON.parse(raw) as { lvl?: unknown }).lvl;
    return typeof lvl === 'number' && Number.isFinite(lvl) ? lvl : 0;
  } catch {
    // A riven's fingerprint is a much larger object and may not parse the same
    // way; either outcome is "no rank we can state".
    return 0;
  }
}

/** Does the account hold this mod, and at what rank? */
export function modState(acc: RawAccount | null, spec: ModSpec): ModState {
  if (!acc) return { spec, owned: null, rank: null };
  const bag = acc as unknown as Record<string, unknown>;
  const ranked = bag['Upgrades'];
  const raw = bag['RawUpgrades'];

  // Neither array present means unread, which is not the same as owning none.
  if (!Array.isArray(ranked) && !Array.isArray(raw)) return { spec, owned: null, rank: null };

  if (Array.isArray(ranked)) {
    for (const row of ranked) {
      if (at(row, 'ItemType') === spec.path) return { spec, owned: true, rank: rankOf(row) };
    }
  }
  if (Array.isArray(raw)) {
    for (const row of raw) {
      // Present here means owned and UNRANKED - that is what this array is.
      if (at(row, 'ItemType') === spec.path) return { spec, owned: true, rank: 0 };
    }
  }
  return { spec, owned: false, rank: null };
}

export interface Readiness {
  states: readonly ModState[];
  /** Mods the route wants that you do not hold at all. */
  missing: readonly ModSpec[];
  /** Mods you hold but have not ranked past halfway. */
  underRanked: readonly ModState[];
  /** Null when the account was never read. */
  ready: boolean | null;
}

/**
 * Can your mods carry this?
 *
 * `underRanked` uses half of maximum rather than "not maxed", because a
 * half-ranked mod is genuinely usable and calling it a failure would make the
 * signal cry wolf. Missing entirely is the strong signal; under-ranked is worth
 * mentioning and not worth blocking on.
 */
export function readiness(acc: RawAccount | null, keys: readonly ModKey[]): Readiness {
  /*
   * `noUncheckedIndexedAccess` is on, so a Record lookup is possibly undefined
   * even with a keyof-typed key. Filtering rather than asserting: an unknown key
   * is a caller bug and should drop out, not crash a panel.
   */
  const states = keys
    .map((k) => KEY_MODS[k])
    .filter((spec): spec is ModSpec => spec !== undefined)
    .map((spec) => modState(acc, spec));
  if (states.some((s) => s.owned === null)) {
    return { states, missing: [], underRanked: [], ready: null };
  }
  const missing = states.filter((s) => s.owned === false).map((s) => s.spec);
  const underRanked = states.filter((s) => s.owned === true && (s.rank ?? 0) * 2 < s.spec.maxRank);
  return { states, missing, underRanked, ready: missing.length === 0 };
}

/** The one line worth showing, or null when there is nothing to say. */
export function modNote(r: Readiness): string | null {
  if (r.ready === null) return null;
  if (r.missing.length > 0) {
    const names = r.missing.map((m) => m.name);
    const shown = names.slice(0, 3).join(', ');
    return `You do not own ${shown}${names.length > 3 ? ` and ${String(names.length - 3)} more` : ''}, which this build is made of`;
  }
  if (r.underRanked.length > 0) {
    return `You own the mods for this, but ${r.underRanked.map((s) => s.spec.name).slice(0, 3).join(', ')} ${r.underRanked.length === 1 ? 'is' : 'are'} barely ranked`;
  }
  return null;
}
