/**
 * The typed Warframe account model.
 *
 * `RawAccount` is the shape of `inventory.php`, which is byte-for-byte what
 * Overwolf GEP hands us as `match_info.inventory`. Every field is traced to
 * `docs/research/inventory-schema.md` (SpaceNinjaServer's `IInventoryClient`,
 * cross-checked against DE's PublicExport and this project's own live reads).
 *
 * Two rules govern everything below, both learned the hard way:
 *
 *   1. EVERYTHING IS OPTIONAL. SpaceNinjaServer marks fields required because it
 *      owns the database; a real payload from a fresh account, an old account, or
 *      a truncated GEP memory read will be missing plenty. Only ~9 fields are
 *      individually verified present in GEP (schema §12.1) — the rest are
 *      *expected* because it is the same blob, not proven. Never crash on absence.
 *   2. NOTHING IS INVENTED. Where the research could not confirm a field it is
 *      either absent here or marked UNCERTAIN. `UpgradesProvidingKey` and
 *      `TrainingRetriesLeft` are deliberately NOT modelled: zero evidence they
 *      exist (schema §12.4, §12.5).
 *
 * `src/core/gep.ts` should import `RawAccount` from here and delete its own thin
 * `RawInventory`; this file is the single description of the payload.
 */

// ---------------------------------------------------------------------------
// Primitives (schema §2)
// ---------------------------------------------------------------------------

/** Legacy clients (pre-U19.5) send `$id` instead of `$oid`. Read with `oidOf`. */
export interface Oid {
  $oid?: string;
  $id?: string;
}

/** Modern payloads use `$date`; pre-U19.5 clients send `{sec, usec}`. Read with `mongoMillis`. */
export type MongoDate = { $date: { $numberLong: string } } | { sec: number; usec?: number };

export interface TypeCount {
  ItemType: string;
  ItemCount: number;
}

export type ArtifactPolarity =
  | 'AP_POWER'
  | 'AP_DEFENSE'
  | 'AP_TACTIC'
  | 'AP_ATTACK'
  | 'AP_WARD'
  | 'AP_UNIVERSAL'
  | 'AP_UMBRA'
  | 'AP_PRECEPT'
  | 'AP_ANY';

export interface Color {
  t0?: number;
  t1?: number;
  t2?: number;
  t3?: number;
  en?: number;
  e1?: number;
  m0?: number;
  m1?: number;
}

export interface ItemConfig {
  /** One entry per cosmetic slot (skin, helmet, syandana, attachments). */
  Skins?: string[];
  pricol?: Color;
  attcol?: Color;
  sigcol?: Color;
  eyecol?: Color;
  facial?: Color;
  syancol?: Color;
  cloth?: Color;
  /**
   * The installed mod loadout. Each entry is an `Upgrades[].ItemId.$oid` string,
   * or `""` for an empty slot. This is the only way to read "what mods are on
   * this frame" — the client normalises the length to 11.
   */
  Upgrades?: string[];
  /** Config nickname ("A", "Steel Path"). */
  Name?: string;
  OperatorAmp?: Oid;
  /** Shawzin. */
  Songs?: Array<{ m?: string; b?: string; p?: string; s?: string }>;
  /** Helminth subsume. */
  AbilityOverride?: { Ability?: string; Index?: number };
  PvpUpgrades?: string[];
  /** "Prime Details" toggle — true means details are OFF. */
  ugly?: boolean;
  /** U16.0 legacy colour encoding. */
  Colors?: number[];
  /** U10–U15 legacy. Shape not modelled by the research. */
  Customization?: unknown;
}

/**
 * Bitmask for `Equipment.Features` — this is how potatoes and adapters are
 * detected, there is no boolean anywhere. Bits 16, 128 and 256 are unassigned in
 * SpaceNinjaServer, which is not the same as proven unused: do not treat an
 * unknown bit as absence of meaning.
 */
export const EquipmentFeature = {
  DOUBLE_CAPACITY: 1,
  UTILITY_SLOT: 2,
  GRAVIMAG_INSTALLED: 4,
  GILDED: 8,
  ARCANE_SLOT: 32,
  SECOND_ARCANE_SLOT: 64,
  INCARNON_GENESIS: 512,
  VALENCE_SWAP: 1024,
} as const;

export type EquipmentFeatureName = keyof typeof EquipmentFeature;

export interface EquipmentSelection {
  ItemId?: Oid;
  ItemType?: string;
  mod?: number;
  cus?: number;
  hide?: boolean;
}

export interface PetTraits {
  BaseColor?: string;
  SecondaryColor?: string;
  TertiaryColor?: string;
  AccentColor?: string;
  EyeColor?: string;
  FurPattern?: string;
  Personality?: string;
  BodyType?: string;
  Head?: string;
  Tail?: string;
}

export interface KubrowPetDetails {
  Name?: string;
  IsMale?: boolean;
  /** 0.7–1.0. */
  Size?: number;
  DominantTraits?: PetTraits;
  RecessiveTraits?: PetTraits;
  IsPuppy?: boolean;
  HasCollar?: boolean;
  PrintsRemaining?: number;
  /** `STATUS_STASIS` still occupies a `PetBin` slot — that is the whole point of the bin. */
  Status?:
    | 'STATUS_INCUBATING'
    | 'STATUS_INCUBATED'
    | 'STATUS_AVAILABLE'
    | 'STATUS_STASIS'
    | 'STATUS_DISTILLING';
  HatchDate?: MongoDate;
}

export interface CrewShipMemberRef {
  ItemId?: Oid;
  /** Exceeds Number.MAX_SAFE_INTEGER — `JSON.parse` silently corrupts it (schema §12.9). */
  NemesisFingerprint?: number;
}

export interface CrewShipWeaponEmplacements {
  PRIMARY_A?: EquipmentSelection;
  PRIMARY_B?: EquipmentSelection;
  SECONDARY_A?: EquipmentSelection;
  SECONDARY_B?: EquipmentSelection;
}

export interface CrewShipWeapon {
  PILOT?: CrewShipWeaponEmplacements;
  PORT_GUNS?: CrewShipWeaponEmplacements;
  STARBOARD_GUNS?: CrewShipWeaponEmplacements;
  ARTILLERY?: CrewShipWeaponEmplacements;
  SCANNER?: CrewShipWeaponEmplacements;
}

export interface ShipCustomization {
  SkinFlavourItem?: string;
  Colors?: Color;
  ShipAttachments?: { HOOD_ORNAMENT?: string };
}

/** The per-item object shared by all 27 equipment arrays (schema §3b). */
export interface Equipment {
  /** Unique instance id — the join key for loadouts. */
  ItemId?: Oid;
  ItemType?: string;
  /** Custom name. For liches it is `"Name|NEMESIS"` — split on `"|"`. */
  ItemName?: string;
  /** Config A/B/C… (up to 6). Index = loadout config slot. */
  Configs?: ItemConfig[];
  UpgradeVer?: number;
  /**
   * Affinity earned on THIS INSTANCE. Not the mastery ledger — a mastered item
   * that was sold keeps its `XPInfo` row but loses this. Drive mastery off
   * `XPInfo` (mastery-math §4.3), drive the arsenal panel off these arrays.
   */
  XP?: number;
  /** `EquipmentFeature` bitmask. */
  Features?: number;
  /** Forma count. Each Forma raises the cap by 2 — see `levelCap`. */
  Polarized?: number;
  Polarity?: Array<{ Slot?: number; Value?: ArtifactPolarity }>;
  FocusLens?: string;
  ModSlotPurchases?: number;
  CustomizationSlotPurchases?: number;
  /** Installed valence/innate upgrade. */
  UpgradeType?: string;
  /** JSON *string* describing that upgrade. */
  UpgradeFingerprint?: string;
  /** Helminth infestation (Suits only). */
  InfestationDate?: MongoDate;
  InfestationDays?: number;
  InfestationType?: string;
  /** Zaw/Kitgun/Amp/MOA/Hound component ItemTypes. Mastery credits the xp-earning part. */
  ModularParts?: string[];
  /** Rented / temporary items. */
  Expiry?: MongoDate;
  /** Incarnon / Railjack skill tree state. */
  SkillTree?: string;
  OffensiveUpgrade?: string;
  DefensiveUpgrade?: string;
  UpgradesExpiry?: MongoDate;
  /** Scrapped "Echoes of Umbra". */
  UmbraDate?: MongoDate;
  /** Warframe archon shards, 5 slots. */
  ArchonCrystalUpgrades?: Array<{ UpgradeType?: string; Color?: string }>;
  /** CrewShips only. */
  Weapon?: CrewShipWeapon;
  /** CrewShips only. */
  Customization?: { CrewshipInterior?: ShipCustomization };
  RailjackImage?: { ItemType?: string };
  /** Railjack component levels. */
  SlotLevels?: number[];
  /** CrewShips only. */
  CrewMembers?: {
    SLOT_A?: CrewShipMemberRef;
    SLOT_B?: CrewShipMemberRef;
    SLOT_C?: CrewShipMemberRef;
  };
  Favorite?: boolean;
  /** The "NEW" badge in the arsenal. */
  IsNew?: boolean;
  /** Bayonets, U41+. */
  AltWeaponModeId?: Oid;
  UpgradeNodes?: number;
  /** Revives remaining (pre-U18). */
  ExtraRemaining?: number;
  /** KubrowPets ONLY. */
  Details?: KubrowPetDetails;
  /** < 24.4.0 legacy. */
  UnlockLevel?: number;
  /** < 24.4.0 legacy. */
  UtilityUnlocked?: number;
  /** < 24.4.0 legacy. */
  Gild?: boolean;
}

/** A slot bin. `Slots` is remaining FREE slots, not capacity — a common misreading. */
export interface SlotBin {
  Slots?: number;
  Extra?: number;
}

/** Rank-0 mods, stacked by type (schema §4). */
export interface RawUpgrade {
  ItemType: string;
  ItemCount: number;
  /** Id of the most recently obtained copy — drives the "new mod" highlight. */
  LastAdded?: Oid;
}

/**
 * Individually tracked upgrades: ranked mods, Rivens AND arcanes.
 * A mod lives in exactly one of `RawUpgrades` / `Upgrades`, never both.
 */
export interface Upgrade {
  ItemId?: Oid;
  ItemType?: string;
  /** JSON *string*: `{"lvl":N}` for mods/arcanes, a much larger object for rivens. */
  UpgradeFingerprint?: string;
  /** Riven mid-reroll. */
  PendingRerollFingerprint?: string;
  /** U7–U8 legacy. */
  ParentId?: Oid;
  Slot?: number;
  AmountRemaining?: number;
  Rank?: number;
}

export interface WeaponSkin {
  ItemId?: Oid;
  ItemType?: string;
  Favorite?: boolean;
  IsNew?: boolean;
  UpgradeType?: string;
  UpgradeFingerprint?: string;
}

export interface LoadoutConfig {
  ItemId?: Oid;
  /** Name. */
  n?: string;
  /** Suit. */
  s?: EquipmentSelection;
  /** Primary. */
  l?: EquipmentSelection;
  /** Secondary. */
  p?: EquipmentSelection;
  /** Melee. */
  m?: EquipmentSelection;
  /** Gravimag / heavy. */
  h?: EquipmentSelection;
  /** Necramech exalted. */
  a?: EquipmentSelection;
  FocusSchool?: 'AP_ATTACK' | 'AP_DEFENSE' | 'AP_POWER' | 'AP_TACTIC' | 'AP_WARD';
  PresetIcon?: string;
  Favorite?: boolean;
}

export interface LoadOutPresets {
  NORMAL?: LoadoutConfig[];
  NORMAL_PVP?: LoadoutConfig[];
  LUNARO?: LoadoutConfig[];
  ARCHWING?: LoadoutConfig[];
  SENTINEL?: LoadoutConfig[];
  OPERATOR?: LoadoutConfig[];
  GEAR?: LoadoutConfig[];
  KDRIVE?: LoadoutConfig[];
  DATAKNIFE?: LoadoutConfig[];
  MECH?: LoadoutConfig[];
  OPERATOR_ADULT?: LoadoutConfig[];
  DRIFTER?: LoadoutConfig[];
}

export interface WeeklyMission {
  MissionIndex?: number;
  CompletedMission?: boolean;
  JobManifest?: string;
  Challenges?: string[];
  ChallengesReset?: boolean;
  WeekCount?: number;
}

export interface Affiliation {
  /**
   * Syndicate tag. Verified literals include `ArbitersSyndicate`, `CephalonSudaSyndicate`,
   * `CetusSyndicate`, `EntratiSyndicate`, `EntratiLabSyndicate`, `EventSyndicate`,
   * `HexSyndicate`, `KahlSyndicate`, `LibrarySyndicate`, `NewLokaSyndicate`,
   * `PerrinSyndicate`, `RedVeilSyndicate`, `SolarisSyndicate`, `SteelMeridianSyndicate`,
   * `ZarimanSyndicate`, and `RadioLegion*Syndicate` (Nightwave). Quills / VentKids / Vox /
   * Necraloid / Cavia tags were NOT seen in a primary source — do not hardcode them until a
   * live `Affiliations` array confirms them (schema §12.8).
   *
   * CONCLAVE IS NOW CONFIRMED, from DE's own syndicate export rather than from a live
   * account. `ExportSyndicates.json` is keyed by exactly this tag namespace, and all
   * fifteen tags verified above appear in it — a 15-of-15 correspondence, checked on every
   * run by `check-syndicate-tags.ts`. `ConclaveSyndicate` is a key in that same export, so
   * it is attested by the same evidence as the rest and not by folklore.
   */
  Tag?: string;
  Standing?: number;
  /** Rank index, not a name. */
  Title?: number;
  Initiated?: boolean;
  FreeFavorsEarned?: number[];
  FreeFavorsUsed?: number[];
  /** Kahl weeklies only. */
  WeeklyMissions?: WeeklyMission[];
}

/** Shared by the active Nemesis and every `NemesisHistory` entry (schema §8). */
export interface NemesisBase {
  /** Fingerprint / seed. Exceeds MAX_SAFE_INTEGER — corrupted by plain `JSON.parse`. */
  fp?: number;
  manifest?: string;
  /** The Warframe that spawned it. */
  KillingSuit?: string;
  killingDamageType?: number;
  ShoulderHelmet?: string;
  /** Index into the manifest's weapon list. */
  WeaponIdx?: number;
  AgentIdx?: number;
  BirthNode?: string;
  Faction?: 'FC_GRINEER' | 'FC_CORPUS' | 'FC_INFESTATION';
  /** 0–4. */
  Rank?: number;
  /** Killed (true) vs converted (false) — this is the vanquish/convert record. */
  k?: boolean;
  Traded?: boolean;
  /** Creation date. */
  d?: MongoDate;
  PrevOwners?: number;
  /** Assigned as Railjack on-call crew. */
  SecondInCommand?: boolean;
  Weakened?: boolean;
}

export interface Nemesis extends NemesisBase {
  /** Territory on the star chart. */
  InfNodes?: Array<{ Node?: string; Influence?: number }>;
  HenchmenKilled?: number;
  HintProgress?: number;
  /** Requiem hints revealed, as indices. */
  Hints?: number[];
  GuessHistory?: number[];
  MissionCount?: number;
  LastEnc?: number;
}

export interface CrewMember {
  ItemId?: Oid;
  ItemType?: string;
  /** Non-zero links this crew slot to a converted lich. */
  NemesisFingerprint?: number;
  /** Appearance/name seed for hired crew. */
  Seed?: number;
  AssignedRole?: number;
  SkillEfficiency?: Partial<
    Record<'PILOTING' | 'GUNNERY' | 'ENGINEERING' | 'COMBAT' | 'SURVIVABILITY', { Assigned?: number }>
  >;
  WeaponConfigIdx?: number;
  WeaponId?: Oid;
  XP?: number;
  PowersuitType?: string;
  Configs?: ItemConfig[];
  /** "On call". */
  SecondInCommand?: boolean;
}

export interface PendingRecipe {
  /** The build's own id — what `claimCompletedRecipe.php` takes. */
  ItemId?: Oid;
  ItemType?: string;
  /** Ready when this is in the past. There is NO "ready" boolean (schema §7). */
  CompletionDate?: MongoDate;
  /** Riven / lich targets. */
  TargetFingerprint?: string;
  /** e.g. the Kubrow egg or suit being acted on. */
  TargetItemId?: string;
}

export interface PersonalTechProject {
  ItemId?: Oid;
  ItemType?: string;
  State?: number;
  ReqCredits?: number;
  ReqItems?: TypeCount[];
  ProductCategory?: string;
  CategoryItemId?: Oid;
  HasContributions?: boolean;
  CompletionDate?: MongoDate;
}

/** Helminth. */
export interface InfestedFoundry {
  Name?: string;
  Slots?: number;
  XP?: number;
  Resources?: Array<{
    ItemType?: string;
    Count?: number;
    RecentlyConvertedResources?: Array<{ ItemType?: string; Date?: number }>;
  }>;
  ConsumedSuits?: Array<{ s?: string; c?: Color }>;
  InvigorationIndex?: number;
  InvigorationSuitOfferings?: string[];
  InvigorationsApplied?: number;
  LastConsumedSuit?: Equipment;
  AbilityOverrideUnlockCooldown?: MongoDate;
}

/**
 * Intrinsics. `LPP_*` are unspent POINTS (rank = floor(points / 1000)); the
 * `LPS_*` fields are the actual 0–10 ranks. Each rank is worth 1,500 mastery XP.
 */
export interface PlayerSkills {
  LPP_SPACE?: number;
  LPS_PILOTING?: number;
  LPS_GUNNERY?: number;
  LPS_TACTICAL?: number;
  LPS_ENGINEERING?: number;
  LPS_COMMAND?: number;
  LPP_DRIFTER?: number;
  LPS_DRIFT_COMBAT?: number;
  LPS_DRIFT_RIDING?: number;
  LPS_DRIFT_OPPORTUNITY?: number;
  LPS_DRIFT_ENDURANCE?: number;
}

export interface LibraryDailyTask {
  EnemyTypes?: string[];
  EnemyLocTag?: string;
  EnemyIcon?: string;
  /** Present only once the task has been started. */
  Scans?: number;
  ScansRequired?: number;
  RewardStoreItem?: string;
  RewardQuantity?: number;
  RewardStanding?: number;
}

export interface SpectreLoadout {
  ItemType?: string;
  Suits?: string;
  LongGuns?: string;
  Pistols?: string;
  Melee?: string;
  LongGunsModularParts?: string[];
  PistolsModularParts?: string[];
  MeleeModularParts?: string[];
}

export interface Ship {
  ItemId?: Oid;
  ItemType?: string;
  ShipExterior?: ShipCustomization;
  AirSupportPower?: string;
}

export interface Mission {
  /**
   * Not all tags are star-chart nodes. Observed: `SolNode###`,
   * `<From>To<To>Junction`, `ClanNode###`, `CrewBattleNode###`,
   * `SettlementNode###`, `EventNode###`, hub nodes.
   */
  Tag?: string;
  Completes?: number;
  /** Truthy = Steel Path. */
  Tier?: number;
  RewardsCooldownTime?: MongoDate;
}

export interface QuestKey {
  ItemType?: string;
  Completed?: boolean;
  unlock?: boolean;
  CustomData?: string;
  CompletionDate?: MongoDate;
  /** `c` is the stage counter. */
  Progress?: Array<{ c?: number; i?: boolean; m?: boolean; b?: unknown[] }>;
}

export interface TypeXp {
  ItemType: string;
  XP: number;
}

export interface ChallengeProgress {
  Name?: string;
  Progress?: number;
  Completed?: string[];
  ReceivedJunctionReward?: boolean;
}

export interface SortieReward {
  SortieId?: Oid;
  StoreItem?: string;
  Manifest?: string;
}

/** `ExpiryDate` is UNIX **seconds**, not a MongoDate. Verified in `addBooster`. */
export interface Booster {
  ItemType?: string;
  ExpiryDate?: number;
  UsesRemaining?: number;
}

/** Ayatan sculpture. `Sockets` = stars inserted. */
export interface FusionTreasure {
  ItemType?: string;
  ItemCount?: number;
  Sockets?: number;
  /** Pre-U25.7 legacy shape carried an ItemId and a `{a..d: starItemType}` socket map. */
  ItemId?: Oid;
}

// ---------------------------------------------------------------------------
// Key sets
// ---------------------------------------------------------------------------

/**
 * The 27 arsenal arrays, exhaustive (schema §3a — SpaceNinjaServer's `equipmentKeys`).
 * `Ships` is deliberately NOT here: it is a different shape (`Ship[]`).
 */
export const EQUIPMENT_KEYS = [
  'Suits',
  'LongGuns',
  'Pistols',
  'Melee',
  'SpecialItems',
  'Sentinels',
  'SentinelWeapons',
  'SpaceSuits',
  'SpaceGuns',
  'SpaceMelee',
  'Hoverboards',
  'OperatorAmps',
  'Antiques',
  'MoaPets',
  'Scoops',
  'Horses',
  'DrifterGuns',
  'DrifterMelee',
  'Motorcycles',
  'CrewShips',
  'DataKnives',
  'MechSuits',
  'CrewShipHarnesses',
  'KubrowPets',
  'CrewShipWeapons',
  'CrewShipSalvagedWeapons',
  'OperatorSuits',
] as const;

export type EquipmentKey = (typeof EQUIPMENT_KEYS)[number];

/** The 13 slot bins (schema §3f), transcribed from `productCategoryToInventoryBin`. */
export const SLOT_KEYS = [
  'SuitBin',
  'WeaponBin',
  'SentinelBin',
  'SpaceSuitBin',
  'SpaceWeaponBin',
  'MechBin',
  'OperatorAmpBin',
  'CrewShipSalvageBin',
  'CrewMemberBin',
  'RandomModBin',
  'PetBin',
  'PveBonusLoadoutBin',
  'PvpBonusLoadoutBin',
] as const;

export type SlotKey = (typeof SLOT_KEYS)[number];

/**
 * The 14 daily standing pools. These are REMAINING standing for today, reset at
 * 00:00 UTC to `16000 + PlayerLevel * 500`. `DailyAffiliation` is shared by all
 * six faction syndicates; the rest are per-open-world.
 */
export const DAILY_AFFILIATION_KEYS = [
  'DailyAffiliation',
  'DailyAffiliationPvp',
  'DailyAffiliationLibrary',
  'DailyAffiliationCetus',
  'DailyAffiliationQuills',
  'DailyAffiliationSolaris',
  'DailyAffiliationVentkids',
  'DailyAffiliationVox',
  'DailyAffiliationEntrati',
  'DailyAffiliationNecraloid',
  'DailyAffiliationZariman',
  'DailyAffiliationKahl',
  'DailyAffiliationCavia',
  'DailyAffiliationHex',
] as const;

export type DailyAffiliationKey = (typeof DAILY_AFFILIATION_KEYS)[number];

/** Ducats and Aya hide behind historical names. `PrimeBucks` is Ducats, NOT Aya. */
export const DUCATS_ITEM_TYPE = '/Lotus/Types/Items/MiscItems/PrimeBucks';
export const AYA_ITEM_TYPE = '/Lotus/Types/Items/MiscItems/SchismKey';
export const ARGON_ITEM_TYPE = '/Lotus/Types/Items/MiscItems/ArgonCrystal';
/** Rivens are the `Upgrades` entries under this prefix — count them against `RandomModBin`. */
export const RIVEN_PREFIX = '/Lotus/Upgrades/Mods/Randomized/';

// ---------------------------------------------------------------------------
// RawAccount
// ---------------------------------------------------------------------------

interface AccountFields {
  // --- identity / account --------------------------------------------------
  Created?: MongoDate;
  /** Clan id only. Name/tier come from `getGuild.php`, not from here. */
  GuildId?: Oid;
  /** Founder tier, 1 Hunter … 4 Grand Master. Absent = not a Founder. */
  Founder?: number;
  Staff?: boolean;
  Moderator?: boolean;
  Partner?: boolean;
  Guide?: number;
  Counselor?: boolean;
  Accolades?: { Heirloom?: boolean };
  Settings?: {
    FriendInvRestriction?: string;
    GiftMode?: string;
    GuildInvRestriction?: string;
    ShowFriendInvNotifications?: boolean;
    TradingRulesConfirmed?: boolean;
    SubscribedToSurveys?: boolean;
  };
  SubscribedToEmails?: number;
  SubscribedToEmailsPersonalized?: number;
  HWIDProtectEnabled?: boolean;
  HasResetAccount?: boolean;
  /** Changes on EVERY fetch — useless as a change detector. Hash the payload instead. */
  LastInventorySync?: Oid;
  /** Exceeds MAX_SAFE_INTEGER; arrives already corrupted by `JSON.parse`. */
  RewardSeed?: number;
  Mailbox?: { LastInboxId?: Oid };
  OneTimePurchases?: string[];

  // --- economy -------------------------------------------------------------
  /** Credits. */
  RegularCredits?: number;
  /** Platinum, total. */
  PremiumCredits?: number;
  /** The untradeable portion of that platinum (starter/gift plat). */
  PremiumCreditsFree?: number;
  /** Endo. */
  FusionPoints?: number;
  /** Dirac. */
  CrewShipFusionPoints?: number;
  /** Regal Aya. */
  PrimeTokens?: number;
  /** All resources, including Ducats (`PrimeBucks`) and Aya (`SchismKey`). */
  MiscItems?: TypeCount[];
  /** Argon found today, exempt from tonight's 50% UTC-midnight decay. */
  FoundToday?: TypeCount[];
  /** Blueprints owned but not started. */
  Recipes?: TypeCount[];
  /** Gear items — ciphers, restores, scanners. */
  Consumables?: TypeCount[];
  /** Mission keys (derelict/dojo/boss). */
  LevelKeys?: TypeCount[];
  ShipDecorations?: TypeCount[];
  /** Pending quest-email items awaiting delivery. */
  EmailItems?: TypeCount[];
  Boosters?: Booster[];
  FusionTreasures?: FusionTreasure[];
  Drones?: Array<{ ItemId?: Oid; ItemType?: string; CurrentHP?: number; RepairStart?: MongoDate }>;
  /** Daily trades left. Resets to `PlayerLevel` (+2 for Founders). */
  TradesRemaining?: number;
  /** Resets to `max(8, PlayerLevel)`. */
  GiftsRemaining?: number;
  /** Rivens ever unveiled. */
  RandomUpgradesIdentified?: number;
  PendingCoupon?: { Expiry?: MongoDate; Discount?: number };
  /** `{ItemId, State, SelfReady, BuddyReady, Revision, Giving?, Getting, ClanTax?}` — not modelled further. */
  PendingTrades?: unknown[];
  /** Market wishlist, StoreItem paths. */
  Wishlist?: string[];
  /** Darvo deals already bought. The deal list itself lives in worldState, not here. */
  UsedDailyDeals?: string[];
  RecentVendorPurchases?: Array<{
    VendorType?: string;
    PurchaseHistory?: Array<{ ItemId?: string; NumPurchased?: number; Expiry?: MongoDate }>;
  }>;

  // --- mods / upgrades -----------------------------------------------------
  /** Rank-0 mods, stacked. */
  RawUpgrades?: RawUpgrade[];
  /** Ranked mods + rivens + arcanes, individually tracked. */
  Upgrades?: Upgrade[];
  WeaponSkins?: WeaponSkin[];
  /** Railjack reactors/shields/engines/plating, identified. */
  CrewShipWeaponSkins?: Upgrade[];
  CrewShipSalvagedWeaponSkins?: Upgrade[];
  /** Gear wheel contents, ItemType paths. */
  EquippedGear?: string[];
  EquippedEmotes?: string[];
  EquippedInstrument?: string;
  /** Mandachord songs. */
  StepSequencers?: Array<{
    ItemId?: Oid;
    Name?: string;
    FingerPrint?: string;
    NotePacks?: { MELODY?: string; BASS?: string; PERCUSSION?: string };
  }>;

  // --- progression ---------------------------------------------------------
  /** Mastery rank, as an integer. */
  PlayerLevel?: number;
  /**
   * The lifetime per-ItemType affinity ledger — the mastery source of truth.
   * Never decremented: selling a mastered item leaves its row behind, which is
   * exactly the semantics mastery needs (mastery-math §4.3).
   */
  XPInfo?: TypeXp[];
  /** Contains ONLY content completed at least once, so presence implies a clear. */
  Missions?: Mission[];
  QuestKeys?: QuestKey[];
  /** ItemType of the currently tracked quest. `""` when none. */
  ActiveQuest?: string;
  NodeIntrosCompleted?: string[];
  CompletedAlerts?: string[];
  CompletedSorties?: string[];
  /** Syndicate MISSIONS completed this rotation — not "maxed syndicates". */
  CompletedSyndicates?: string[];
  LastSortieReward?: SortieReward[];
  LastLiteSortieReward?: SortieReward[];
  /** Duplicate-protection weights. */
  SortieRewardAttenuation?: Array<{ Tag?: string; Atten?: number }>;
  /** Baro's Void Surplus uses this one. */
  SpecialItemRewardAttenuation?: Array<{ Tag?: string; Atten?: number }>;
  Affiliations?: Affiliation[];
  SupportedSyndicate?: string;
  ChallengeProgress?: ChallengeProgress[];
  ChallengesFixVersion?: number;
  ChallengeInstanceStates?: Array<{
    id?: Oid;
    Progress?: number;
    params?: Array<{ n?: string; v?: string }>;
    IsRewardCollected?: boolean;
  }>;
  PlayerSkills?: PlayerSkills;
  FocusUpgrades?: Array<{
    ItemType?: string;
    Level?: number;
    IsUniversal?: boolean;
    IsActive?: number | boolean;
    TotalCapacity?: number;
    CooldownTier?: number;
    IsCooldownReductionActive?: boolean;
  }>;
  /** Unspent focus per school. */
  FocusXP?: {
    AP_POWER?: number;
    AP_TACTIC?: number;
    AP_DEFENSE?: number;
    AP_ATTACK?: number;
    AP_WARD?: number;
  };
  FocusAbility?: string;
  FocusCapacity?: number;
  FocusLoadouts?: Array<{ Preset?: EquipmentSelection; FocusAbility?: string }>;
  /** When the next MR test becomes available (24h cooldown after a failure). */
  TrainingDate?: MongoDate;
  /** Incarnon Genesis. */
  EvolutionProgress?: Array<{ ItemType?: string; Rank?: number; Progress?: number }>;
  /** Cephalon fragments / Somachord. */
  LoreFragmentScans?: Array<{ ItemType?: string; Region?: string; Progress?: number }>;
  /** Simaris codex. */
  LibraryPersonalProgress?: Array<{ TargetType?: string; Scans?: number; Completed?: boolean }>;
  /** Kuria and Duviri fragments. `Tracking` is a 90-char bit-string, one char per collectible. */
  CollectibleSeries?: Array<{
    CollectibleType?: string;
    Count?: number;
    Tracking?: string;
    ReqScans?: number;
    IncentiveStates?: Array<{ threshold?: number; complete?: boolean; sent?: boolean }>;
  }>;
  /** e.g. Profit-Taker phases under `"EudicoHeists"`. */
  CompletedJobChains?: Array<{ LocationTag?: string; Jobs?: string[] }>;
  /** Event scores. */
  PersonalGoalProgress?: Array<{ _id?: Oid; Tag?: string; Count?: number; Best?: number }>;
  /** Kuva Siphon / weekly-repeatable trackers. */
  PeriodicMissionCompletions?: Array<{ tag?: string; date?: MongoDate; count?: number }>;
  SongChallenges?: Array<{ Song?: string; Difficulties?: number[] }>;
  /** The Circuit / Steel Path Circuit. */
  EndlessXP?: Array<{
    Category?: 'EXC_NORMAL' | 'EXC_HARD';
    Earn?: number;
    Claim?: number;
    Choices?: string[];
    PendingRewards?: unknown[];
    BonusAvailable?: MongoDate;
    Expiry?: MongoDate;
  }>;
  /** Descent (Cohort) mode. */
  DescentRewards?: Array<{
    Category?: 'DM_COH_NORMAL' | 'DM_COH_HARD';
    Expiry?: MongoDate;
    FloorClaimed?: number;
    Seed?: number;
    SelectedUpgrades?: string[];
    PendingRewards?: unknown[];
  }>;
  /** U39+ junction reward claims. */
  ClaimedJunctionChallengeRewards?: string[];
  /** Daily-tribute milestone choices taken. */
  LoginMilestoneRewards?: string[];
  /** `"WARFRAME"` or `"DUVIRI"`. */
  StoryModeChoice?: string;
  /** U14–U15 legacy. */
  MadeStoryModeDecision?: boolean;
  /** `TSolarMapRegion`: "Earth" … "Void", "SolarMapDeimosName", "1999MapName". */
  LastRegionPlayed?: string;
  /** `Seed` exceeds MAX_SAFE_INTEGER. */
  DuviriInfo?: { Seed?: number; NumCompletions?: number };
  /** Maroo's Ayatan hunt. */
  TauntHistory?: Array<{ node?: string; state?: 'TS_UNLOCKED' | 'TS_COMPLETED' }>;
  /** Open-world caves/POIs found. */
  DiscoveredMarkers?: Array<{ tag?: string; discoveryState?: number[] }>;
  /** Loc-Pins. */
  CustomMarkers?: Array<{
    tag?: string;
    markerInfos?: Array<{
      icon?: string;
      markers?: Array<{
        anchorName?: string;
        color?: number;
        label?: string;
        x?: number;
        y?: number;
        z?: number;
        showInHud?: boolean;
      }>;
    }>;
  }>;
  /** Battle-pay eligibility. */
  QualifyingInvasions?: Array<{
    _id?: Oid;
    Delta?: number;
    AttackerScore?: number;
    DefenderScore?: number;
  }>;
  FactionScores?: number[];
  BountyScore?: number;
  HandlerPoints?: number;
  /** Has ever owned a relic. */
  HasOwnedVoidProjectionsPreviously?: boolean;
  ReceivedStartingGear?: boolean;
  ArchwingEnabled?: boolean;
  PlayedParkourTutorial?: boolean;
  HasContributedToDojo?: boolean;

  // --- foundry -------------------------------------------------------------
  /** Everything in the foundry right now, including Kubrow incubation. */
  PendingRecipes?: PendingRecipe[];
  /** Railjack ("Rising Tide") + Necramech research. */
  PersonalTechProjects?: PersonalTechProject[];
  InfestedFoundry?: InfestedFoundry;
  /** Modern servers store eggs as a MiscItem and synthesise this array. */
  KubrowPetEggs?: Array<{ ItemId?: Oid; ItemType?: string; ExpirationDate?: MongoDate }>;
  KubrowPetPrints?: Array<{
    ItemId?: Oid;
    ItemType?: string;
    Name?: string;
    IsMale?: boolean;
    Size?: number;
    DominantTraits?: PetTraits;
    RecessiveTraits?: PetTraits;
    InheritedModularParts?: unknown[];
  }>;

  // --- nemesis -------------------------------------------------------------
  /** The currently active lich/sister. Absent when there is none. */
  Nemesis?: Nemesis;
  /** Every past lich/sister — the vanquished/converted record. `k` distinguishes them. */
  NemesisHistory?: NemesisBase[];
  LastNemesisAllySpawnTime?: MongoDate;
  /** Rewards forfeited by abandoning a nemesis, as StoreItem paths. */
  NemesisAbandonedRewards?: string[];

  // --- railjack ------------------------------------------------------------
  CrewMembers?: CrewMember[];
  CrewShipAmmo?: TypeCount[];
  CrewShipRawSalvage?: TypeCount[];

  // --- time-gated ----------------------------------------------------------
  /** Remaining focus earnable today. Resets to `250000 + PlayerLevel * 5000`. */
  DailyFocus?: number;
  /** When the daily pools reset — tomorrow 00:00 UTC. */
  NextRefill?: MongoDate;
  BlessingCooldown?: MongoDate;
  LibraryPersonalTarget?: string;
  LibraryAvailableDailyTaskInfo?: LibraryDailyTask;
  LibraryActiveDailyTaskInfo?: LibraryDailyTask;
  /** Nightwave acts completed. `challenge` is the path, `id` the worldState instance. */
  SeasonChallengeHistory?: Array<{ challenge?: string; id?: string }>;
  /** Netracell runs used this week. */
  EntratiVaultCountLastPeriod?: number;
  EntratiVaultCountResetDate?: MongoDate;
  /** Deep Archimedea. */
  EntratiLabConquestUnlocked?: number;
  EntratiLabConquestHardModeStatus?: number;
  EntratiLabConquestCacheScoreMission?: number;
  EntratiLabConquestActiveFrameVariants?: string[];
  /** Temporal Archimedea (1999). */
  EchoesHexConquestUnlocked?: number;
  EchoesHexConquestHardModeStatus?: number;
  EchoesHexConquestCacheScoreMission?: number;
  EchoesHexConquestActiveFrameVariants?: string[];
  EchoesHexConquestActiveStickers?: string[];
  /** 1999 Kalendar. */
  CalendarProgress?: {
    Version?: number;
    Iteration?: number;
    YearProgress?: { Upgrades?: string[] };
    SeasonProgress?: {
      SeasonType?: string;
      LastCompletedDayIdx?: number;
      LastCompletedChallengeDayIdx?: number;
      ActivatedChallenges?: string[];
    };
  };
  /** DE sometimes sends a bare object instead of an array here — handle both. */
  WeeklyGuildVaultBonusInfo?: unknown;

  // --- cosmetics / social --------------------------------------------------
  /** Glyphs, UI themes, palettes, emotes, collars. Usually the largest array on a mature account. */
  FlavourItems?: Array<{ ItemType?: string }>;
  LoadOutPresets?: LoadOutPresets;
  /** U14–U15 legacy. */
  LoadoutPresets?: unknown[];
  /** Active preset per category; index order is `eLoadoutIndex` (NORMAL 0 … DRIFTER 10). */
  CurrentLoadOutIds?: Oid[];
  OperatorLoadOuts?: Array<ItemConfig & { ItemId?: Oid }>;
  AdultOperatorLoadOuts?: Array<ItemConfig & { ItemId?: Oid }>;
  KahlLoadOuts?: Array<ItemConfig & { ItemId?: Oid }>;
  /** `true` = Drifter, `false` = Operator. */
  UseAdultOperatorLoadout?: boolean;
  OperatorCustomizationSlotPurchases?: number;
  LotusCustomization?: ItemConfig & { Persona?: string };
  HubNpcCustomizations?: Array<{ Tag?: string; Pattern?: string; Colors?: Color }>;
  /** NOT one of the 27 equipment arrays — a different shape entirely. */
  Ships?: Ship[];
  /**
   * UNCERTAIN: only clients ≤U22 get a `Ship` key injected into the inventory
   * response; modern ones read the orbiter interior from `getShip.php` instead.
   */
  Ship?: unknown;
  ThemeStyle?: string;
  ThemeBackground?: string;
  ThemeSounds?: string;
  /** Equipped profile glyph. */
  ActiveAvatarImageType?: string;
  TitleType?: string;
  /** `Alignment` sign is Sun vs Moon. */
  Alignment?: { Wisdom?: number; Alignment?: number };
  AlignmentReplay?: { Wisdom?: number; Alignment?: number };
  SpectreLoadouts?: SpectreLoadout[];
  PendingSpectreLoadouts?: SpectreLoadout[];
  ActiveDojoColorResearch?: string;
  /** Assassins currently hunting you — Stalker, G3, Zanuka, Alad V. */
  DeathMarks?: string[];
  Harvestable?: boolean;
  DeathSquadable?: boolean;
  /** Warframes branded by the Grustrag Three. */
  BrandedSuits?: Oid[];
  /** Weapons locked by G3 / Zanuka. */
  LockedWeaponGroup?: { s?: Oid; p?: Oid; l?: Oid; m?: Oid; sn?: Oid };
  /** 1999 KIM / Hex relationships. Shape known but only expand it if a KIM panel is built. */
  DialogueHistory?: unknown;
  /** Field Guide / Nokko. */
  NokkoColony?: {
    FeedLevel?: number;
    JournalEntries?: Array<{ EntryType?: string; Progress?: number }>;
  };
  /** 1999 sketch decorations. */
  Sketches?: Array<{ decoId?: string; canvas?: string }>;
  RetroWallpaperId?: number;
  RetroFastTyping?: boolean;
  RetroPlayAllConvos?: boolean;
  RetroDisableKissInboxMessage?: boolean;
  /** DE's escape hatch — arbitrary JSON stashed by `PropertyName`. Worth logging unknown names. */
  MiscAccountData?: Array<{ PropertyName?: string; Json?: string }>;

  // --- present in real dumps, unmodelled upstream (schema §12.10) -----------
  // SpaceNinjaServer comments these out, so no field shape is verified. They are
  // typed `unknown` rather than guessed at.
  WebFlags?: unknown;
  TradeBannedUntil?: unknown;
  CompletedJobs?: unknown;
  InvasionChainProgress?: unknown;
  SentientSpawnChanceBoosters?: unknown;
  ActiveLandscapeTraps?: unknown;
  RepVotes?: unknown;
  LeagueTickets?: unknown;
  Quests?: unknown;
  Robotics?: unknown;
}

/**
 * The full inventory payload.
 *
 * The index signature is deliberate: DE adds fields every major update and
 * `MiscAccountData` exists precisely because they stash things ad hoc. Log
 * unrecognised top-level keys once per session rather than dropping them.
 */
export interface RawAccount
  extends Partial<Record<EquipmentKey, Equipment[]>>,
    Partial<Record<SlotKey, SlotBin>>,
    Partial<Record<DailyAffiliationKey, number>>,
    AccountFields {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Accessors — pure, so they are testable without a browser or a live game
// ---------------------------------------------------------------------------

/** Reads an oid defensively: pre-U19.5 payloads use `$id` instead of `$oid`. */
export function oidOf(o: Oid | undefined | null): string | null {
  return o?.$oid ?? o?.$id ?? null;
}

/** Milliseconds since epoch, or null. Handles both the modern and the legacy date shape. */
export function mongoMillis(d: MongoDate | undefined | null): number | null {
  if (!d || typeof d !== 'object') return null;
  if ('$date' in d) {
    const n = Number(d.$date?.$numberLong);
    return Number.isFinite(n) ? n : null;
  }
  if ('sec' in d && typeof d.sec === 'number') return d.sec * 1000;
  return null;
}

export interface OwnedEquipment {
  key: EquipmentKey;
  item: Equipment;
}

/** Every item across all 27 arsenal arrays, tagged with the array it came from. */
export function allEquipment(acc: RawAccount | null | undefined): OwnedEquipment[] {
  if (!acc) return [];
  const out: OwnedEquipment[] = [];
  for (const key of EQUIPMENT_KEYS) {
    for (const item of acc[key] ?? []) {
      if (item && typeof item === 'object') out.push({ key, item });
    }
  }
  return out;
}

/**
 * Owned count per equipment array.
 *
 * This counts what is in the arsenal RIGHT NOW, which is not the same as mastery
 * progress: a sold item disappears from here but keeps its `XPInfo` row forever.
 * Drive a mastery panel off `XPInfo`, an arsenal panel off this.
 *
 * `SpecialItems` is included for completeness but should not be read as
 * ownership — it holds exalted weapons the player never acquired and consumes no slots.
 */
export function countBy(acc: RawAccount | null | undefined): Record<EquipmentKey, number> {
  const out = {} as Record<EquipmentKey, number>;
  for (const key of EQUIPMENT_KEYS) out[key] = acc?.[key]?.length ?? 0;
  return out;
}

/** Quantity of a resource from `MiscItems`. Ducats and Aya live here too. */
export function resourceCount(acc: RawAccount | null | undefined, itemType: string): number {
  return sumTypeCount(acc?.MiscItems, itemType);
}

/** Copies of a blueprint owned but not yet started, from `Recipes`. */
export function recipeCount(acc: RawAccount | null | undefined, itemType: string): number {
  return sumTypeCount(acc?.Recipes, itemType);
}

/** Sums duplicates rather than taking the first match — DE has been seen to split stacks. */
function sumTypeCount(list: TypeCount[] | undefined, itemType: string): number {
  let total = 0;
  for (const e of list ?? []) {
    if (e?.ItemType === itemType) total += e.ItemCount ?? 0;
  }
  return total;
}

/** Affinity on this instance. Not the mastery ledger — see `RawAccount.XPInfo`. */
export function itemXp(item: Equipment | null | undefined): number {
  const xp = item?.XP;
  return typeof xp === 'number' && Number.isFinite(xp) ? xp : 0;
}

/** True when the given `EquipmentFeature` bit is set (potato, exilus, gilded…). */
export function hasFeature(item: Equipment | null | undefined, bit: number): boolean {
  return ((item?.Features ?? 0) & bit) !== 0;
}

/**
 * The item's current level cap.
 *
 * THE FORMA TRAP (mastery-math §4.2): every Forma resets the level to 0 and
 * raises the cap by 2, so a Forma'd item's lifetime affinity is far larger than
 * `500 * level²` and `floor(sqrt(XP / 500))` returns nonsense — rank 86 for a
 * 5-Forma Kuva weapon. `Polarized` is the Forma count and is the only honest way
 * to bound the cap.
 *
 * `maxLevelCap` is 40 for the 52 + 2 rank-40 items and 30 otherwise; it comes
 * from the item catalog, which this module deliberately does not depend on.
 */
export function levelCap(item: Equipment | null | undefined, maxLevelCap = 30): number {
  return Math.min(maxLevelCap, 30 + 2 * (item?.Polarized ?? 0));
}

export interface MasteryShape {
  /** Frames and vehicles use `1000 * rank²`; weapons use `500 * rank²`. From the catalog. */
  isFrame?: boolean;
  /** 40 for the 52 + 2 rank-40 items, 30 otherwise. From the catalog. */
  maxLevelCap?: number;
}

/**
 * Is this instance fully mastered?
 *
 * Defaults to the weapon curve and a rank-30 cap because the frame/rank-40
 * distinction lives in the item catalog, not in the payload — pass `shape` once
 * the catalog is joined rather than guessing from the ItemType path here.
 *
 * For a rank-40 item, reaching the XP threshold is not enough: the item must
 * also actually be 5x polarized (mastery-math §4.4).
 *
 * UNCERTAIN: it is unverified whether DE's live server resets per-item `XP` on
 * Forma or keeps accumulating (mastery-math §4.2 [GAP]). SpaceNinjaServer
 * accumulates. Until a real Forma'd item is captured, treat a `false` here on a
 * heavily Forma'd item as "unknown", not as "definitely unmastered".
 */
export function isMastered(item: Equipment | null | undefined, shape: MasteryShape = {}): boolean {
  const cap = levelCap(item, shape.maxLevelCap ?? 30);
  const base = shape.isFrame ? 1000 : 500;
  if (itemXp(item) < base * cap * cap) return false;
  return cap <= 30 || (item?.Polarized ?? 0) >= 5;
}

export interface PendingBuild {
  /** The build's own id, for `claimCompletedRecipe.php`. */
  id: string | null;
  itemType: string | null;
  /** Milliseconds since epoch, or null when the payload omitted the date. */
  completesAt: number | null;
  /** Seconds until claimable; 0 when ready, null when the date is unknown. */
  secondsRemaining: number | null;
  /** Ready has no boolean in the payload — it is `CompletionDate <= now` (schema §7). */
  ready: boolean;
}

/**
 * Foundry contents with their completion times, soonest first.
 *
 * Takes `now` as an argument so the result is deterministic in a test.
 * A build with no `CompletionDate` is reported as not ready with a null time
 * rather than silently treated as finished.
 */
export function pendingBuilds(acc: RawAccount | null | undefined, now = Date.now()): PendingBuild[] {
  const out: PendingBuild[] = [];
  for (const r of acc?.PendingRecipes ?? []) {
    if (!r || typeof r !== 'object') continue;
    const completesAt = mongoMillis(r.CompletionDate);
    out.push({
      id: oidOf(r.ItemId),
      itemType: r.ItemType ?? null,
      completesAt,
      secondsRemaining: completesAt == null ? null : Math.max(0, Math.floor((completesAt - now) / 1000)),
      ready: completesAt != null && completesAt <= now,
    });
  }
  return out.sort((a, b) => (a.completesAt ?? Infinity) - (b.completesAt ?? Infinity));
}
