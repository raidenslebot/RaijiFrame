/**
 * From "the Upgrades screen opened for slot 3" to "this instance of this item,
 * in this config, with these mods at these ranks".
 *
 * THE LOG NEVER NAMES THE ITEM. `docs/research/eelog-upgrade-screen.md`: the
 * weapon's name appears zero times in 148k lines of a session that modded it.
 * What the log gives is the arsenal slot index; what the account gives is the
 * chain below. Every rung of it can be missing on a real payload - an
 * anonymised capture, a client too old to send presets, an item whose config
 * array is empty - and a missing rung is UNKNOWN, reported by name, never
 * papered over with the first item of the right category.
 *
 *   CurrentLoadOutIds[0]                       the active loadout's id
 *     -> LoadOutPresets.NORMAL[i].ItemId         the preset carrying that id
 *       -> .s / .l / .p / .m  { ItemId, mod }    the instance, and the ACTIVE config index
 *         -> Suits | LongGuns | Pistols | Melee   the instance by its oid
 *           -> Configs[mod].Upgrades[]           eleven oids, "" for an empty slot
 *             -> Upgrades[].ItemId               each installed mod: type and fingerprint
 *               -> UpgradeFingerprint '{"lvl":N}' its rank
 *
 * `mod` is the active config as far as the schema says; whether a live push
 * carries it is one of the named unknowns in the architecture doc, and when
 * it is absent this module says so (`configAssumed`) and reads config A.
 *
 * RANK. The instance's `XP` yields the highest rank it has ever reached
 * (`mastery.ts`, the Forma trap). Its CURRENT rank after a Forma is lower and
 * not derivable from XP; it is known only when the item was never polarised,
 * or when the game's own build dump prints `Initial Capacity`. Both are
 * reported as what they are.
 */

import { EquipmentFeature, hasFeature, itemXp, levelCap, oidOf, type ArtifactPolarity, type Equipment, type EquipmentKey, type LoadOutPresets, type RawAccount } from './account.ts';
import { frameRank, weaponRank } from './mastery.ts';
import type { UpgradeSlot } from './automod-session.ts';
import type { Polarity } from './modded.ts';

export type Category =
  | 'warframe'
  | 'primary'
  | 'secondary'
  | 'melee'
  | 'companion'
  | 'companion-weapon'
  | 'archwing'
  | 'arch-gun'
  | 'arch-melee'
  | 'necramech';

/** The rung at which resolution stopped, in ladder order. */
export type Rung = 'account' | 'loadout-ids' | 'presets' | 'selection' | 'instance' | 'config' | 'upgrades';

export interface InstalledMod {
  /** 0..10, the config array's own index. Which index is which slot is NOT on the wiki. */
  index: number;
  oid: string;
  /** Catalogue path of the mod, or null when the oid matched nothing in `Upgrades`. */
  itemType: string | null;
  /** From the fingerprint's `lvl`; null when absent or unreadable. */
  rank: number | null;
}

export interface ResolvedBuild {
  /*
   * The arsenal slot index, when this came from one. Null for a category the
   * app can reach without a slot - the four the arsenal's top row shows are not
   * the only things on the account with a build.
   */
  slot: UpgradeSlot | null;
  category: Category;
  /** Null until the rung that carries it resolved. */
  itemType: string | null;
  instanceId: string | null;
  configIndex: number | null;
  /** The preset carried no `mod`; config A was read and this says so. */
  configAssumed: boolean;
  /** Null = unknown. An empty array is a MEASURED empty config. */
  installed: InstalledMod[] | null;
  /** Slot polarities as the account writes them, by slot index. Null = unknown. */
  polarities: Array<{ slot: number; value: ArtifactPolarity }> | null;
  forma: number | null;
  catalyst: boolean | null;
  exilus: boolean | null;
  arcaneSlots: number | null;
  /** Highest rank ever reached, from lifetime affinity. Null when the instance is unknown. */
  rankLifetime: number | null;
  /** The rank right now: equal to lifetime when never polarised, else unknown until the game's dump says. */
  rankCurrent: number | null;
  /** Where the ladder stopped, or null when every rung resolved. */
  unknown: Rung | null;
  reason: string | null;
}

/**
 * WHERE EACH KIND OF THING LIVES ON THE ACCOUNT.
 *
 * Three coordinates, and all three are in `docs/research/inventory-schema.md`
 * rather than inferred here: which group of loadout presets holds it, which
 * key inside a preset config points at it, and which equipment bins the
 * instance itself can be in.
 *
 * This was four hardcoded pairs and the arsenal's top row. The rest of the
 * table is what the schema already recorded from DE's own sources - the preset
 * groups `ARCHWING`, `SENTINEL` and `MECH` (S5), the config keys `s` `l` `p`
 * `m` `h` `a` (S5), and the bins (S8's `productCategoryToInventoryBin`, which
 * DE's `productCategory` field names verbatim).
 *
 * A companion lists THREE bins because a preset's `s` can be a sentinel, a
 * beast or a moa and the config does not say which. Searching all three is not
 * a guess: an `ItemId` is a Mongo oid and unique across the account, so at most
 * one bin can hold it.
 */
interface Where {
  preset: keyof LoadOutPresets;
  /**
   * WHICH ENTRY OF `CurrentLoadOutIds` NAMES THIS GROUP'S ACTIVE PRESET.
   *
   * `CurrentLoadOutIds` is an ARRAY indexed by DE's `eLoadoutIndex` - NORMAL 0,
   * SENTINEL 1, ARCHWING 2, NORMAL_PVP 3, LUNARO 4, OPERATOR 5, KDRIVE 6,
   * DATAKNIFE 7, MECH 8 - recorded at `inventory-schema.md` §3. This read
   * `[0]` for every group, which is right for the four arsenal categories and
   * wrong for all six added since: the NORMAL loadout's id would be looked for
   * inside the SENTINEL or ARCHWING array, never found, and every companion,
   * archwing and necramech would stop at the `presets` rung on a real account.
   *
   * The gate did not catch it because its fixture gave all four preset groups
   * the SAME id - the assumption under test, encoded in the test.
   *
   * MEASURED, 2026-09-08, against the account loaded in the RUNNING app -
   * `npm run live` reads it over Overwolf's own debug port. Eleven entries, all
   * eleven filled, and every group's active preset found at the index this
   * table reads: NORMAL 0, SENTINEL 1, ARCHWING 2, NORMAL_PVP 3, LUNARO 4,
   * OPERATOR 5, KDRIVE 6, DATAKNIFE 7, MECH 8, OPERATOR_ADULT 9, DRIFTER 10 -
   * the whole order the schema records, end to end, on one real account. This
   * is no longer read from a document; it is read from an account, and the
   * probe re-reads it whenever the app is up.
   */
  index: number;
  key: 's' | 'l' | 'p' | 'm' | 'h' | 'a';
  bins: readonly EquipmentKey[];
  /** The arsenal row, when this category has one. Null for everything else. */
  slot: UpgradeSlot | null;
  /**
   * Frames, vehicles and companions rank on the 200-affinity curve; weapons on
   * the 100 one - `mastery.ts` says so in as many words. The old code tested
   * `category === 'warframe'`, which would have under-ranked every archwing,
   * companion and necramech by the time they became reachable.
   */
  ranksLikeAFrame: boolean;
}

const WHERE: Record<Category, Where> = {
  warframe: { preset: 'NORMAL', index: 0, key: 's', bins: ['Suits'], slot: 0, ranksLikeAFrame: true },
  primary: { preset: 'NORMAL', index: 0, key: 'l', bins: ['LongGuns'], slot: 1, ranksLikeAFrame: false },
  secondary: { preset: 'NORMAL', index: 0, key: 'p', bins: ['Pistols'], slot: 2, ranksLikeAFrame: false },
  melee: { preset: 'NORMAL', index: 0, key: 'm', bins: ['Melee'], slot: 3, ranksLikeAFrame: false },
  companion: { preset: 'SENTINEL', index: 1, key: 's', bins: ['Sentinels', 'KubrowPets', 'MoaPets'], slot: null, ranksLikeAFrame: true },
  'companion-weapon': { preset: 'SENTINEL', index: 1, key: 'l', bins: ['SentinelWeapons'], slot: null, ranksLikeAFrame: false },
  archwing: { preset: 'ARCHWING', index: 2, key: 's', bins: ['SpaceSuits'], slot: null, ranksLikeAFrame: true },
  'arch-gun': { preset: 'ARCHWING', index: 2, key: 'l', bins: ['SpaceGuns'], slot: null, ranksLikeAFrame: false },
  'arch-melee': { preset: 'ARCHWING', index: 2, key: 'm', bins: ['SpaceMelee'], slot: null, ranksLikeAFrame: false },
  necramech: { preset: 'MECH', index: 8, key: 's', bins: ['MechSuits'], slot: null, ranksLikeAFrame: true },
};
const CATEGORY: Record<UpgradeSlot, Category> = { 0: 'warframe', 1: 'primary', 2: 'secondary', 3: 'melee' };

/**
 * The account's polarity codes in the arithmetic's vocabulary. The proof of
 * the mapping is the game's own focus-school field, which uses the same words
 * for the same schools: Madurai is the attack school, Vazarin defence, Naramon
 * tactic, Zenurik power, Unairu ward. `AP_ANY` and `AP_UNIVERSAL` are both the
 * Omni/Stance Forma slot, which matches everything but Umbra.
 */
export const POLARITY: Readonly<Record<ArtifactPolarity, Polarity>> = {
  AP_ATTACK: 'madurai',
  AP_DEFENSE: 'vazarin',
  AP_TACTIC: 'naramon',
  AP_POWER: 'zenurik',
  AP_WARD: 'unairu',
  AP_PRECEPT: 'penjaga',
  AP_UMBRA: 'umbra',
  AP_UNIVERSAL: 'universal',
  AP_ANY: 'universal',
};

function stopped(slot: UpgradeSlot | null, category: Category, unknown: Rung, reason: string, partial: Partial<ResolvedBuild> = {}): ResolvedBuild {
  return {
    slot,
    category,
    itemType: null,
    instanceId: null,
    configIndex: null,
    configAssumed: false,
    installed: null,
    polarities: null,
    forma: null,
    catalyst: null,
    exilus: null,
    arcaneSlots: null,
    rankLifetime: null,
    rankCurrent: null,
    ...partial,
    unknown,
    reason,
  };
}

/** `{"lvl":N}` for mods and arcanes; a much larger object for rivens, which also carries `lvl`. */
export function rankFromFingerprint(fingerprint: string | undefined | null): number | null {
  if (typeof fingerprint !== 'string' || fingerprint === '') return null;
  try {
    const parsed: unknown = JSON.parse(fingerprint);
    const lvl = (parsed as { lvl?: unknown } | null)?.lvl;
    return typeof lvl === 'number' && Number.isFinite(lvl) ? lvl : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the build for an arsenal slot. The four the arsenal's top row shows.
 */
export function resolveBuild(acc: RawAccount | null | undefined, slot: UpgradeSlot, shape: { maxLevelCap?: number } = {}): ResolvedBuild {
  return resolveIn(acc, CATEGORY[slot], shape);
}

/**
 * Resolve the build for ANY category, slot or no slot.
 *
 * `resolveBuild` was written against the four arsenal slots and hardcoded their
 * two lookups; everything else on the account - the companion, the archwing and
 * its two weapons, the necramech - was unreachable, not because the account
 * does not carry them but because this function had no table for them. The
 * table is `WHERE`, and it is transcribed rather than derived.
 *
 * The slot index is passed through only so a caller that HAS one keeps it in
 * the result. Which arsenal row emits which index for these categories is a
 * separate unknown, and this function is deliberately not the place that
 * guesses at it - see `automod-session.ts`, which records an index it does not
 * recognise instead of inventing a meaning for it.
 */
export function resolveIn(acc: RawAccount | null | undefined, category: Category, shape: { maxLevelCap?: number } = {}): ResolvedBuild {
  const where = WHERE[category];
  /*
   * DERIVED, NOT PASSED. `slot` used to be a parameter, so a caller could hand
   * in a slot and a category that disagreed - slot 0 with category melee - and
   * nothing checked. It is a property of the category, so the table holds it
   * and the disagreement cannot be expressed.
   */
  const slot = where.slot;
  if (!acc) return stopped(slot, category, 'account', 'no account has been read');

  /*
   * ONE ENTRY PER GROUP, not one id for all of them. See `Where.index`: the
   * array is ordered by DE's `eLoadoutIndex`, so the archwing you fly is named
   * by entry 2 and the companion at your side by entry 1.
   */
  const loadoutId = oidOf(acc.CurrentLoadOutIds?.[where.index]);
  if (!loadoutId) {
    return stopped(
      slot,
      category,
      'loadout-ids',
      acc.CurrentLoadOutIds
        ? `CurrentLoadOutIds has no entry ${String(where.index)} for ${where.preset}`
        : 'the account carries no CurrentLoadOutIds',
    );
  }
  const presets = acc.LoadOutPresets?.[where.preset];
  const preset = presets?.find((p) => oidOf(p.ItemId) === loadoutId);
  if (!preset) {
    return stopped(
      slot,
      category,
      'presets',
      presets ? `no ${where.preset} preset carries loadout ${loadoutId}` : `the account carries no ${where.preset} loadout presets`,
    );
  }

  const selection = preset[where.key];
  const instanceId = oidOf(selection?.ItemId);
  if (!instanceId) return stopped(slot, category, 'selection', `the active preset has nothing in its ${category} slot`);
  const configAssumed = typeof selection?.mod !== 'number';
  const configIndex = configAssumed ? 0 : (selection!.mod as number);

  let instance: Equipment | undefined;
  for (const bin of where.bins) {
    instance = acc[bin]?.find((e) => oidOf(e.ItemId) === instanceId);
    if (instance) break;
  }
  if (!instance) {
    return stopped(slot, category, 'instance', `${where.bins.join('/')} carries no item with id ${instanceId}`, {
      instanceId,
      configIndex,
      configAssumed,
      itemType: selection?.ItemType ?? null,
    });
  }

  const forma = typeof instance.Polarized === 'number' ? instance.Polarized : null;
  const cap = levelCap(instance, shape.maxLevelCap ?? 30);
  const rankLifetime = where.ranksLikeAFrame ? frameRank(itemXp(instance), cap) : weaponRank(itemXp(instance), cap);
  const known: Partial<ResolvedBuild> = {
    itemType: instance.ItemType ?? selection?.ItemType ?? null,
    instanceId,
    configIndex,
    configAssumed,
    polarities: instance.Polarity
      ? instance.Polarity.filter((p): p is { Slot: number; Value: ArtifactPolarity } => typeof p.Slot === 'number' && typeof p.Value === 'string').map((p) => ({ slot: p.Slot, value: p.Value }))
      : null,
    forma,
    catalyst: hasFeature(instance, EquipmentFeature.DOUBLE_CAPACITY),
    exilus: hasFeature(instance, EquipmentFeature.UTILITY_SLOT),
    arcaneSlots:
      (hasFeature(instance, EquipmentFeature.ARCANE_SLOT) ? 1 : 0) + (hasFeature(instance, EquipmentFeature.SECOND_ARCANE_SLOT) ? 1 : 0),
    rankLifetime,
    // Never polarised: the item has only ever gone up, so the highest rank is the rank.
    rankCurrent: forma === 0 ? rankLifetime : null,
  };

  const config = instance.Configs?.[configIndex];
  if (!config) {
    return stopped(slot, category, 'config', instance.Configs ? `the instance has no config ${configIndex}` : 'the instance carries no Configs', known);
  }
  /*
   * A WEAPON WITH NOTHING ON IT IS MEASURED, NOT UNKNOWN - and calling it
   * unknown blanked the panel on the one item that needs it most.
   *
   * CAUGHT LIVE, on a real visit. The player opened a Gammacor
   * (`/Lotus/Weapons/Syndicates/CephalonSuda/Pistols/CSDroidArray`), the app
   * named it correctly, read the purse, and then published `unknown: upgrades`
   * with no plan at all - so the panel had nothing to say while the player
   * placed three mods by hand. An automodding overlay that goes quiet in front
   * of an unmodded weapon has failed at its only job.
   *
   * The account is why: DE omits an empty array rather than writing one. That
   * weapon's config A carried `Skins` and `pricol` and no `Upgrades` key, while
   * the AutoPistol beside it in the same payload carried `Upgrades` with seven
   * of eight filled. So the key's absence is not a gap in the read - the read
   * was complete - it is the game saying the slots are empty.
   *
   * The distinction was already in the type: `installed` is documented "Null =
   * unknown. An empty array is a MEASURED empty config." Only the code that
   * produces it disagreed, and only for the case where the game had said so by
   * saying nothing.
   *
   * The config itself still has to EXIST - a missing config is a real gap and
   * stops at the rung above.
   */
  if (!config.Upgrades) return { ...stopped(slot, category, 'upgrades', '', known), installed: [], unknown: null, reason: null };

  const byOid = new Map<string, { itemType: string | null; rank: number | null }>();
  for (const u of acc.Upgrades ?? []) {
    const id = oidOf(u.ItemId);
    if (id) byOid.set(id, { itemType: u.ItemType ?? null, rank: rankFromFingerprint(u.UpgradeFingerprint) });
  }
  const installed: InstalledMod[] = [];
  config.Upgrades.forEach((oid, index) => {
    if (!oid) return;
    const found = byOid.get(oid);
    installed.push({ index, oid, itemType: found?.itemType ?? null, rank: found?.rank ?? null });
  });

  return { ...stopped(slot, category, 'upgrades', '', known), installed, unknown: null, reason: null };
}
