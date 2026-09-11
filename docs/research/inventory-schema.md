# The complete Warframe account inventory schema

**Researched 2026-08-31.** Every field below is traced to a source you can re-open. Where I could not
verify something I say so instead of guessing — see [§12 Gaps](#12-gaps--do-not-trust-these-without-re-verifying).

## 0. Sources actually read (not summarised — fetched raw and parsed)

| # | Source | What it gives |
| --- | --- | --- |
| S1 | `https://raw.githubusercontent.com/spaceninjaserver/SpaceNinjaServer/main/src/types/inventoryTypes/inventoryTypes.ts` | **The master list.** `IInventoryClient` = the exact response shape of `inventory.php`. 1436 lines, read in full. |
| S2 | `.../src/models/inventoryModels/inventoryModel.ts` | Mongoose schema: types, defaults, and DE-behaviour comments per field. 2215 lines. |
| S3 | `.../src/types/equipmentTypes.ts` | `IEquipmentClient` — the per-item object for every arsenal array. |
| S4 | `.../src/types/inventoryTypes/commonInventoryTypes.ts` | `IItemConfig`, `IColor`, `IPolarity`, `IFlavourItem`. |
| S5 | `.../src/types/saveLoadoutTypes.ts` | `ILoadOutPresets` / `ILoadoutConfigClient`. |
| S6 | `.../src/types/commonTypes.ts` | `IOid`, `IMongoDate`, `ITypeCount`. |
| S7 | `.../src/services/importService.ts` | `importInventory()` — **imports a real `inventory.php` dump**. The single best proof of which fields actually appear in live data. |
| S8 | `.../src/services/inventoryService.ts` (4352 lines) | `productCategoryToInventoryBin`, `allDailyAffiliationKeys`, booster semantics. |
| S9 | `.../src/controllers/api/artifactsController.ts` | Proves how a mod moves from `RawUpgrades` → `Upgrades` on rank-up. |
| S10 | `.../src/controllers/api/checkPendingRecipesController.ts` | Proves foundry "ready" = `CompletionDate <= now`. |
| S11 | `.../src/types/personalRoomsTypes.ts`, `.../src/types/tradingTypes.ts` | `Ship`/`IOrbiterClient`, `PendingTrades`. |
| S12 | `https://raw.githubusercontent.com/WFCD/profile-parser/master/src/{Profile,LoadOutInventory,LoadOutItem,Intrinsics,ChallengeProgress,Mission,XpInfo,Syndicate,ProfileParser}.ts` | **The public `getProfileViewingData.php` shape** — a completely different, much smaller payload. |
| S13 | `https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/warframe/` | Overwolf's own GEP doc, incl. a real `match_info.inventory` payload sample. |
| S14 | `https://content.warframe.com/PublicExport/index_en.txt.lzma` + all 16 manifests | DE primary source. Used to verify `productCategory` values and real `ItemType` strings. |
| S15 | `C:/Claude/Warframe/docs/DATA-SOURCES.md` + `src/core/gep.ts` + `src/data/progression.ts` | This project's own prior live verification. |

SpaceNinjaServer's canonical home is `https://onlyg.it/OpenWF/SpaceNinjaServer` (the GitHub URL in the brief,
`github.com/OpenWF/SpaceNinjaServer`, is **404** — the working GitHub mirror is `spaceninjaserver/SpaceNinjaServer`).

> **Why SNS is trustworthy here.** It is not a guess at the schema: `importService.ts` (S7) ingests real dumps
> exported from live accounts, and `inventoryController.ts` re-serialises them back to real game clients across
> ~40 build versions. Every field name below appears in that round-trip.

---

## 1. The three payloads are NOT the same thing

This distinction matters more than anything else in this brief.

### 1a. `inventory.php` (authenticated) — the full account

`GET https://api.warframe.com/api/inventory.php?accountId=…&nonce=…`
Returns `IInventoryClient` (S1). **~250 top-level keys.** This app does not call it (nonce requires memory
scanning — see DATA-SOURCES §2c). Everything in §3–§11 below is this payload.

### 1b. GEP `match_info.inventory` — the same blob, read from game memory

Overwolf's provider scans `Warframe.x64`'s memory for the inventory JSON the game synced at login and hands it
over verbatim. **Same shape as 1a.** Overwolf's published sample (S13) is:

```json
{ "category": "game_info", "key": "inventory",
  "value": { "Slots": 8 }, "PremiumCredits": 50, "PremiumCreditsFree": 50,
  "PveBonusLoadoutBin": { "Slots": 0 }, "PvpBonusLoadoutBin": { "Slots": 0 },
  "…": [ { "ItemCount": 1, "ItemType": "Lotus/Types/Recipes/Components/VorBoltRemoverFakeItem" } ],
  "valueLength": 16212 }
```

That sample is **mangled in the docs** (the object got flattened and the leading `/` stripped from the ItemType),
but it is still hard evidence that GEP carries: a `*Bin` slot object, `PremiumCredits`, `PremiumCreditsFree`,
`PveBonusLoadoutBin`, `PvpBonusLoadoutBin`, and a counted-item array (`Recipes`-shaped). Note `valueLength: 16212`
— GEP reports the payload size, and the value arrives as a **JSON string** (the app's `coerce()` in `src/core/gep.ts`
already handles string-or-object).

Fields **verified present in GEP** by this project's own code and notes (S15): `PlayerLevel`, `QuestKeys`,
`Missions`, `XPInfo`, `NodeIntrosCompleted`, `Suits`, `LongGuns`, `Pistols`, `Melee`.
Everything else in §3–§11 is *expected* in GEP because it is the same serialized blob — but is **not individually
verified**. Treat every field as optional and never crash on absence.

### 1c. `getProfileViewingData.php` (public) — a *deliberately small* subset

`GET https://api.warframe.com/cdn/getProfileViewingData.php?playerId=<24-hex>`
Top-level: `{ Results: [Profile], TechProjects, XpComponents, XpCacheExpiryDate, CeremonyResetDate, Stats }` (S12).

`Results[0]` is a **completely different interface** from `IInventoryClient`. Its full field list (S12,
`RawProfile`) is only:

```
AccountId, DisplayName, PlatformNames?, PlayerLevel, LoadOutPreset, LoadOutInventory, PlayerSkills,
ChallengeProgress, GuildId, GuildName, GuildTier, GuildXp, GuildClass, GuildEmblem, AllianceId?,
DeathMarks, Harvestable, DeathSquadable, Created, MigratedToConsole, Missions, Affiliations,
DailyAffiliation, DailyAffiliation{Pvp,Library,Cetus,Quills,Solaris,Ventkids,Vox,Entrati,Necraloid,
Zariman,Kahl,Cavia,Hex}?, DailyFocus?, Wishlist?, UnlockedOperator, UnlockedAlignment,
OperatorLoadOuts, Alignment
```

Three things follow that the brief got slightly wrong:

1. **`UnlockedOperator` and `UnlockedAlignment` are public-profile-only fields.** They appear nowhere in
   `IInventoryClient` and nowhere in SNS's schema. Do not look for them in GEP.
2. **`MigratedToConsole`, `GuildName/Tier/Xp/Class/Emblem`, `AllianceId`, `DisplayName`, `AccountId` are also
   public-profile-only** — the inventory carries only a raw `GuildId` oid.
3. **`XPInfo` is declared on the public profile** at `Results[0].LoadOutInventory.XPInfo` (S12, `RawLoadOut`) —
   but this project's live check on 2026-08-31 found it absent. Either DE removed it or the parser is stale.
   **Re-verify before relying on either claim.** `QuestKeys` really is absent from the public endpoint (confirmed
   both ways: not in `RawProfile` at all).

Also public-only, outside `Results`: `Stats` (per-weapon kills/xp, `Stats.Scans` for the Simaris codex,
`Stats.Missions`), `TechProjects`, `XpComponents`.

---

## 2. Primitive shapes used everywhere

```ts
type IOid       = { $oid: string };                            // { "$oid": "5e8f1b2c3d4e5f6a7b8c9d0e" }
type IMongoDate = { $date: { $numberLong: string } };           // { "$date": { "$numberLong": "1756598400000" } }
type ITypeCount = { ItemType: string; ItemCount: number };
```

Legacy clients (pre-U19.5) get `{ $id: … }` and `{ sec, usec }` instead — SNS models this as
`IOidWithLegacySupport` / `IMongoDateWithLegacySupport`. **Modern GEP will always be `$oid` / `$date`, but write
your accessor defensively anyway** (`o.$oid ?? o.$id`).

`ItemType` is always a `/Lotus/...` path. Real, verified examples pulled from DE PublicExport (S14):

| Thing | `ItemType` | Category |
| --- | --- | --- |
| Excalibur | `/Lotus/Powersuits/Excalibur/Excalibur` | `Suits` |
| Excalibur Umbra | `/Lotus/Powersuits/Excalibur/ExcaliburUmbra` | `Suits` |
| Mesa Prime | `/Lotus/Powersuits/Cowgirl/MesaPrime` | `Suits` |
| Voidrig | `/Lotus/Powersuits/EntratiMech/NechroTech` | `MechSuits` |
| Itzal (Archwing) | `/Lotus/Powersuits/Archwing/StealthJetPack/StealthJetPack` | `SpaceSuits` |
| Braton | `/Lotus/Weapons/Tenno/Rifle/Rifle` | `LongGuns` |
| Kuva Bramma | `/Lotus/Weapons/Grineer/Bows/GrnBow/GrnBowWeapon` | `LongGuns` |
| Lex Prime | `/Lotus/Weapons/Tenno/Pistols/PrimeLex/PrimeLex` | `Pistols` |
| Skana | `/Lotus/Weapons/Tenno/Melee/LongSword/LongSword` | `Melee` |
| Carrier | `/Lotus/Types/Sentinels/SentinelPowersuits/CarrierPowerSuit` | `Sentinels` |
| Huras Kubrow | `/Lotus/Types/Game/KubrowPet/FurtiveKubrowPetPowerSuit` | `KubrowPets` |
| Venari | `/Lotus/Powersuits/Khora/Kavat/KhoraKavatPowerSuit` | `SpecialItems` |
| Serration | `/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod` | mod |
| Vitality | `/Lotus/Upgrades/Mods/Warframe/AvatarHealthMaxMod` | mod |
| Ferrite | `/Lotus/Types/Items/MiscItems/Ferrite` | resource |
| Argon Crystal | `/Lotus/Types/Items/MiscItems/ArgonCrystal` | resource (decays!) |
| **Orokin Ducats** | `/Lotus/Types/Items/MiscItems/PrimeBucks` | resource |
| **Aya** | `/Lotus/Types/Items/MiscItems/SchismKey` | resource |
| The Hex (quest) | `/Lotus/Types/Keys/1999Quest/1999QuestKeyChain` | quest key |
| Octavia's Anthem | `/Lotus/Types/Keys/BardQuest/BardQuestKeyChain` | quest key |

> ⚠️ **`PrimeBucks` is Ducats, not Aya.** Verified directly against `ExportResources_en.json` (S14). The naming is
> a DE historical artefact and it is an easy, silent bug.

---

## 3. Gear / arsenal

### 3a. The 27 equipment arrays

`equipmentKeys` (S1, lines 261–289) — **this is the exhaustive list**, all of type `IEquipmentClient[]`:

| Key | What it holds |
| --- | --- |
| `Suits` | Warframes |
| `LongGuns` | Primaries |
| `Pistols` | Secondaries |
| `Melee` | Melee weapons |
| `SpecialItems` | Exalted / innate weapons (Exalted Blade, Venari, Diwata…), non-slot-consuming |
| `Sentinels` | Sentinels (Carrier, Helios…) |
| `SentinelWeapons` | Robotic weapons |
| `SpaceSuits` | Archwings |
| `SpaceGuns` | Arch-guns |
| `SpaceMelee` | Arch-melee |
| `Hoverboards` | K-Drives |
| `OperatorAmps` | Amps |
| `Antiques` | Operator "antique" weapons (Zenurik Grimoire, Naramon Blade, Madurai Bow, Unairu Hammer, Vazarin Staff — verified paths under `/Lotus/Weapons/Operator/Antiques/`) |
| `MoaPets` | MOA companions |
| `Scoops` | The K-Drive-ish tutorial "speedball" (`/Lotus/Weapons/Tenno/Speedball/SpeedballWeaponTest`) |
| `Horses` | Duviri Kaithe |
| `DrifterGuns` | Duviri Drifter primaries |
| `DrifterMelee` | Duviri Drifter melee |
| `Motorcycles` | 1999 Atomicycle |
| `CrewShips` | Railjacks |
| `DataKnives` | Parazon (`/Lotus/Weapons/Tenno/HackingDevices/TnHackingDevice/TnHackingDeviceWeapon`) |
| `MechSuits` | Necramechs |
| `CrewShipHarnesses` | Railjack "harness" (Rising Tide) |
| `KubrowPets` | Kubrows/Kavats/Predasites/Vulpaphylas — **special: carries an extra `Details` object** |
| `CrewShipWeapons` | Identified Railjack armaments |
| `CrewShipSalvagedWeapons` | Unidentified Railjack salvage |
| `OperatorSuits` | Operator/Drifter "suit" records |

`Ships` is **not** in this list — it is `IShipInventory[]`, a different shape (§3d).

DE's own `productCategory` field in PublicExport (S14) confirms a subset of these names verbatim:
`Pistols` (328), `Melee` (224), `LongGuns` (194), `SpaceGuns` (22), `SpaceMelee` (8), `OperatorAmps` (1),
`SentinelWeapons` (24), `SpecialItems` (36+1+2), `Suits` (117), `SpaceSuits` (5), `MechSuits` (2),
`Sentinels` (17), `KubrowPets` (15), `CrewShipWeapons` (143).

### 3b. `IEquipmentClient` — the per-item object (S3)

```ts
interface IEquipmentClient {
  ItemId: IOid;                       // unique instance id — the join key for loadouts
  ItemType: string;                   // "/Lotus/Powersuits/Excalibur/Excalibur"
  ItemName?: string;                  // custom name; for liches it's "Name|NEMESIS" (split on "|")
  Configs: IItemConfig[];             // config A/B/C… (up to 6). Index = loadout config slot.
  UpgradeVer?: number;                // schema version of the mod layout, e.g. 101
  XP?: number;                        // affinity earned ON THIS INSTANCE (not mastery — see XPInfo)
  Features?: number;                  // BITFIELD, see below
  Polarized?: number;                 // number of Forma applied
  Polarity?: { Slot: number; Value: TArtifactPolarity }[];
  FocusLens?: string;                 // "/Lotus/Upgrades/Focus/…Lens"
  ModSlotPurchases?: number;          // extra mod slots bought (Railjack/pets)
  CustomizationSlotPurchases?: number;// extra appearance config slots bought
  UpgradeType?: string;               // installed valence/innate upgrade
  UpgradeFingerprint?: string;        // JSON string describing that upgrade
  InfestationDate?: IMongoDate;       // Helminth infestation (Suits)
  InfestationDays?: number;
  InfestationType?: string;
  ModularParts?: string[];            // Zaw/Kitgun/Amp/MOA/Hound component ItemTypes
  Expiry?: IMongoDate;                // rented/temporary items
  SkillTree?: string;                 // Incarnon / Railjack skill tree state
  OffensiveUpgrade?: string;          // Necramech / Railjack
  DefensiveUpgrade?: string;
  UpgradesExpiry?: IMongoDate;
  UmbraDate?: IMongoDate;             // scrapped "Echoes of Umbra"
  ArchonCrystalUpgrades?: { UpgradeType?: string; Color?: string }[]; // Warframe archon shards (5 slots)
  Weapon?: ICrewShipWeaponClient;     // CrewShips only
  Customization?: { CrewshipInterior: IShipCustomization }; // CrewShips only
  RailjackImage?: { ItemType: string };
  SlotLevels?: number[];              // Railjack component levels
  CrewMembers?: { SLOT_A?, SLOT_B?, SLOT_C? }; // CrewShips only
  Favorite?: boolean;
  IsNew?: boolean;                    // the "NEW" badge in the arsenal
  AltWeaponModeId?: IOid;             // bayonets, U41+
  UpgradeNodes?: number;
  ExtraRemaining?: number;            // revives remaining (pre-U18)
  Details?: IKubrowPetDetailsClient;  // KubrowPets ONLY
  UnlockLevel?: number;               // < 24.4.0 legacy
  UtilityUnlocked?: number;           // < 24.4.0 legacy
  Gild?: boolean;                     // < 24.4.0 legacy
}
```

**`Features` is a bitfield** (S3, `eEquipmentFeatures`) — this is how you detect potatoes/adapters:

| Bit | Value | Meaning |
| --- | --- | --- |
| `DOUBLE_CAPACITY` | `1` | Orokin Reactor / Catalyst installed |
| `UTILITY_SLOT` | `2` | Exilus adapter installed |
| `GRAVIMAG_INSTALLED` | `4` | Gravimag (arch-gun on ground) |
| `GILDED` | `8` | Modular weapon gilded |
| `ARCANE_SLOT` | `32` | Arcane adapter |
| `SECOND_ARCANE_SLOT` | `64` | Second arcane adapter |
| `INCARNON_GENESIS` | `512` | Incarnon Genesis installed |
| `VALENCE_SWAP` | `1024` | Valence-swapped lich weapon |

(16, 128, 256 are unassigned in SNS — do not assume they are unused, just unknown.)

`TArtifactPolarity` (S4): `AP_POWER | AP_DEFENSE | AP_TACTIC | AP_ATTACK | AP_WARD | AP_UNIVERSAL | AP_UMBRA | AP_PRECEPT | AP_ANY`.

Example:

```json
{ "ItemId": { "$oid": "6413ae4f9f5b2c0a1e7d3311" },
  "ItemType": "/Lotus/Powersuits/Cowgirl/MesaPrime",
  "Configs": [ { "Skins": ["","","","","","","","",""], "pricol": { "t0": 52, "t1": 6, "t2": 51, "t3": 0, "en": 24 },
                "Upgrades": ["6413ae5f…","","6413af02…","","","","","",""] }, {}, {} ],
  "XP": 1610000, "UpgradeVer": 101, "Features": 3, "Polarized": 4,
  "Polarity": [ { "Slot": 4, "Value": "AP_TACTIC" }, { "Slot": 7, "Value": "AP_DEFENSE" } ],
  "FocusLens": "/Lotus/Upgrades/Focus/PowerLensGreater",
  "ArchonCrystalUpgrades": [ { "UpgradeType": "/Lotus/Upgrades/Mods/ArchonCrystal/…", "Color": "AC_CRIMSON" }, {}, {}, {}, {} ],
  "Favorite": true, "IsNew": false }
```

### 3c. `IItemConfig` — appearance + installed mods (S4)

```ts
interface IItemConfig {
  Skins?: string[];        // one entry per cosmetic slot (skin, helmet, syandana, attachments…)
  pricol?: IColor;         // primary colours
  attcol?: IColor;         // attachment colours
  sigcol?: IColor;         // sigil colours
  eyecol?: IColor;         // eye colours
  facial?: IColor;
  syancol?: IColor;        // syandana colours
  cloth?: IColor;
  Upgrades?: string[];     // ← INSTALLED MODS: array of Upgrades[].ItemId.$oid, "" = empty slot
  Name?: string;           // config nickname ("A", "Steel Path"…)
  OperatorAmp?: IOid;
  Songs?: { m?, b?, p?, s }[];   // Shawzin
  AbilityOverride?: { Ability: string; Index: number }; // Helminth subsume
  PvpUpgrades?: string[];  // Conclave mod loadout
  ugly?: boolean;          // "Prime Details" toggle (true = details OFF)
  Colors?: number[];       // U16.0 legacy
  Customization?: {...};   // U10–U15 legacy
}

interface IColor { t0?: number; t1?: number; t2?: number; t3?: number;
                   en?: number; e1?: number; m0?: number; m1?: number }
```

`Configs[n].Upgrades` is the **mod loadout**: each element is either `""` (empty) or an `$oid` string that joins
to `inventory.Upgrades[].ItemId.$oid`. Length is normalised to 11 by the client. **This is how you read "what mods
are on this frame".**

### 3d. `Ships` — not an equipment array

```ts
interface IShipInventory {
  ItemId: IOid;
  ItemType: string;                // "/Lotus/Types/Items/Ships/RailjackShip" etc.
  ShipExterior?: { SkinFlavourItem?: string; Colors?: IColor;
                   ShipAttachments?: { HOOD_ORNAMENT?: string } };
  AirSupportPower?: string;        // "/Lotus/Types/Restoratives/LisetAutoHack"
}
```

The Orbiter *interior* (rooms, decorations, Vignette, Wallpaper) is **not** in the inventory — it comes from
`getShip.php` (`IOrbiterClient`, S11). Old clients (≤U22) get a `Ship` key injected into the inventory response;
modern ones do not.

### 3e. `KubrowPets[].Details` (S3)

```ts
{ Name?, IsMale: boolean, Size: number /* 0.7–1.0 */,
  DominantTraits: ITraits, RecessiveTraits: Partial<ITraits>,
  IsPuppy?: boolean, HasCollar: boolean, PrintsRemaining: number,
  Status: "STATUS_INCUBATING"|"STATUS_INCUBATED"|"STATUS_AVAILABLE"|"STATUS_STASIS"|"STATUS_DISTILLING",
  HatchDate: IMongoDate }

ITraits = { BaseColor, SecondaryColor, TertiaryColor, AccentColor, EyeColor,
            FurPattern, Personality, BodyType, Head?, Tail? }   // all string ItemTypes
```

`Status: "STATUS_STASIS"` is how you tell a pet is in stasis vs. active — important, because pets in stasis still
occupy a `PetBin` slot.

### 3f. Slot bins (13 keys, all `{ Slots: number; Extra?: number }`)

`eInventorySlot` (S1) + defaults from S2. `Slots` is **remaining free slots** (it decrements as you fill them),
not capacity — a common misreading.

| Key | Covers | Default |
| --- | --- | --- |
| `SuitBin` | Warframes | 3 |
| `WeaponBin` | Primary+Secondary+Melee (shared) | 11 |
| `SentinelBin` | Sentinels, SentinelWeapons, KubrowPets, MoaPets | 10 |
| `SpaceSuitBin` | Archwings, Hoverboards | 4 |
| `SpaceWeaponBin` | SpaceGuns, SpaceMelee | 4 |
| `MechBin` | Necramechs | 4 |
| `OperatorAmpBin` | Amps, Antiques | 8 |
| `CrewShipSalvageBin` | Railjack components + armaments | 8 |
| `CrewMemberBin` | Railjack crew | 3 |
| `RandomModBin` | **Riven slots** | 15 |
| `PetBin` | pet stasis slots | 2 |
| `PveBonusLoadoutBin` | extra PvE loadout configs | 0 |
| `PvpBonusLoadoutBin` | extra Conclave loadout configs | 0 |

`productCategoryToInventoryBin()` (S8) is the authoritative category→bin mapping; the table above is that function
transcribed.

---

## 4. Mods / upgrades — how ranked vs unranked works

This is the single most misunderstood part of the schema. There are **two parallel arrays**, and a mod lives in
exactly one of them.

### `RawUpgrades: IRawUpgrade[]` — unranked, stacked

```ts
{ ItemType: string; ItemCount: number; LastAdded?: IOid }
```
Every **rank-0** copy of a mod. Stacked by type. `LastAdded` is the id of the most recently obtained copy
(the client uses it for the "new mod" highlight).

```json
{ "ItemType": "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod", "ItemCount": 7,
  "LastAdded": { "$oid": "66aa19f0a1b2c3d4e5f60011" } }
```

### `Upgrades: IUpgradeClient[]` — individually tracked

```ts
{ ItemId: IOid; ItemType: string;
  UpgradeFingerprint?: string;        // JSON *string*
  PendingRerollFingerprint?: string;  // riven mid-reroll
  ParentId?, Slot?, AmountRemaining?, Rank?  // U7–U8 legacy only
}
```

Anything that is not a plain rank-0 stackable lives here: **ranked mods, Rivens, and Arcanes.**

**Rank-up mechanics, verified in `artifactsController.ts` (S9):** when you fuse a mod up from rank 0, the server
does `addMods(inventory, [{ItemType, ItemCount: -1}])` (removing one from `RawUpgrades`) and pushes a new
`Upgrades` entry with `UpgradeFingerprint: '{"lvl":N}'`. Ranking an already-ranked mod just mutates its
fingerprint in place.

`UpgradeFingerprint` payloads:

| Item | Fingerprint (parsed) |
| --- | --- |
| Ranked mod | `{"lvl": 5}` |
| Foil/variant mod | `{"lvl": 10, "variant": 1}` |
| Arcane | `{"lvl": 4}` |
| **Veiled riven** | `{"challenge":{"Type":"…","Progress":0,"Required":150,"Complication":"…"},"IsSentinel":true?}` |
| **Unveiled riven** | `{"compat":"/Lotus/Weapons/…","lim":0,"lvl":0,"lvlReq":12,"rerolls":3,"pol":"AP_ATTACK","buffs":[{"Tag":"WeaponCritChanceMod","Value":0.83}],"curses":[{"Tag":"…","Value":0.4}],"IsSentinel":true?}` |

(riven shapes from `src/helpers/rivenHelper.ts`, S-extra, read in full)

### How to count distinct mods owned

```
distinct = new Set([...RawUpgrades.map(u => u.ItemType), ...Upgrades.map(u => u.ItemType)]).size
```

Total copies of one mod = `RawUpgrades.find(...)?.ItemCount ?? 0` **plus** `Upgrades.filter(u => u.ItemType === t).length`.
Rivens are the `Upgrades` entries whose `ItemType` starts with `/Lotus/Upgrades/Mods/Randomized/` — count them
against `RandomModBin`.

> **Trap:** SNS's own inventory controller strips arcanes out of `Upgrades` for old clients
> (`Upgrades.filter(u => !(u.ItemType in ExportArcanes))`). On a live account arcanes **are** in `Upgrades`, with
> `{"lvl":N}` fingerprints. Don't be surprised by arcanes appearing among your "mods".

### `UpgradesProvidingKey`

**Not found.** Zero hits across the entire SpaceNinjaServer codebase (grepped the full repo tarball),
zero hits in WFCD/profile-parser, zero credible web hits. I could not confirm this field exists in any of the
three payloads. Treat it as **non-existent unless you observe it in a real dump.**

### Adjacent upgrade arrays

| Field | Type | Meaning |
| --- | --- | --- |
| `CrewShipWeaponSkins` | `IUpgradeClient[]` | Railjack armament "skins" (actually the upgrade instances) |
| `CrewShipSalvagedWeaponSkins` | `IUpgradeClient[]` | Unidentified versions of the above |
| `WeaponSkins` | `IWeaponSkinClient[]` | **Owned cosmetic skins.** `{ItemId, ItemType, Favorite?, IsNew?, UpgradeType?, UpgradeFingerprint?}` |
| `EquippedEmotes` | `string[]` | Emote wheel contents, ItemType paths |
| `EquippedGear` | `string[]` | Gear wheel contents, ItemType paths |
| `EquippedInstrument` | `string` | Equipped Shawzin |
| `StepSequencers` | `IStepSequencerClient[]` | Mandachord songs: `{ItemId, Name, FingerPrint, NotePacks:{MELODY,BASS,PERCUSSION}}` |

---

## 5. Resources / economy

| Field | Type | Meaning | Example |
| --- | --- | --- | --- |
| `RegularCredits` | `number` | **Credits** | `18452301` |
| `PremiumCredits` | `number` | **Platinum (total)** | `1140` |
| `PremiumCreditsFree` | `number` | Portion of that platinum that is **untradeable** (starter/gift plat) | `50` |
| `FusionPoints` | `number` | **Endo** | `284100` |
| `CrewShipFusionPoints` | `number` | **Dirac** (pre-rework Railjack currency) | `0` |
| `PrimeTokens` | `number` | **Regal Aya** | `3` |
| `MiscItems` | `ITypeCount[]` | **All resources**, incl. Ducats (`…/PrimeBucks`) and Aya (`…/SchismKey`) | `[{"ItemType":"/Lotus/Types/Items/MiscItems/Ferrite","ItemCount":942117}]` |
| `Recipes` | `ITypeCount[]` | **Blueprints owned** (unbuilt) | `[{"ItemType":"/Lotus/Types/Recipes/Weapons/BratonBlueprint","ItemCount":1}]` |
| `Consumables` | `ITypeCount[]` | Gear items (Ciphers, restores, scanners) | `[{"ItemType":"/Lotus/Types/Restoratives/Cipher","ItemCount":48}]` |
| `LevelKeys` | `ITypeCount[]` | Mission keys (derelict/dojo/boss keys) | `[{"ItemType":"/Lotus/Types/Keys/DerelictSurvival","ItemCount":3}]` |
| `ShipDecorations` | `ITypeCount[]` | Orbiter decorations owned (unplaced) | `[{"ItemType":"/Lotus/Types/Items/ShipDecos/…","ItemCount":2}]` |
| `EmailItems` | `ITypeCount[]` | Pending "quest email" items awaiting delivery | `[]` |
| `CrewShipAmmo` | `ITypeCount[]` | Railjack munitions | `[{"ItemType":"/Lotus/Types/Items/ShipAmmo/…","ItemCount":200}]` |
| `CrewShipRawSalvage` | `ITypeCount[]` | Unrefined Railjack wreckage resources | `[]` |
| `FusionTreasures` | `IFusionTreasure[]` | **Ayatan sculptures**: `{ItemType, ItemCount, Sockets}` (`Sockets` = stars inserted). Pre-U25.7 legacy shape is `{ItemId, ItemType, Sockets: Record<"a".."d", starItemType>}` | `[{"ItemType":"/Lotus/Types/Items/FusionTreasures/AnasaSculpture","ItemCount":2,"Sockets":4}]` |
| `Boosters` | `IBooster[]` | `{ItemType, ExpiryDate, UsesRemaining?}` — **`ExpiryDate` is UNIX seconds, not an IMongoDate** (verified in `addBooster`, S8) | `[{"ItemType":"/Lotus/Types/Boosters/AffinityBooster","ExpiryDate":1756944000}]` |
| `FoundToday` | `IMiscItem[] \| undefined` | Argon Crystals found today (exempt from tonight's 50 % decay) | `[{"ItemType":"/Lotus/Types/Items/MiscItems/ArgonCrystal","ItemCount":3}]` |
| `Drones` | `IDroneClient[]` | Resource extractor drones: `{ItemId, ItemType, CurrentHP, RepairStart?}` | |
| `KubrowPetEggs` | `IKubrowPetEgg[]` | `{ItemId, ItemType, ExpirationDate}` — modern servers store eggs as a MiscItem and synthesise this array | |
| `KubrowPetPrints` | `IKubrowPetPrintClient[]` | Imprints: `{ItemId, ItemType, Name, IsMale, Size, DominantTraits, RecessiveTraits, InheritedModularParts?}` | |

Related counters: `TradesRemaining` (daily trades left, = MR, +2 for Founders), `GiftsRemaining`
(`max(8, PlayerLevel)`), `RandomUpgradesIdentified` (rivens ever unveiled).

---

## 6. Progression

| Field | Type | Meaning |
| --- | --- | --- |
| `PlayerLevel` | `number` | **Mastery Rank** (integer). `34`. |
| `XPInfo` | `{ItemType, XP}[]` | **Mastery-bearing XP per item type.** Sum → lifetime mastery XP. Note: `IEquipmentClient.XP` on an *instance* is not the same number (an item mastered then sold keeps its `XPInfo` row). |
| `Missions` | `IMission[]` | `{Tag, Completes, Tier?, RewardsCooldownTime?}`. **Only contains content completed ≥1 time.** `Tier` marks Steel Path. Tags: `SolNode###`, `<From>To<To>Junction`, `ClanNode###`, `CrewBattleNode###`, `SettlementNode###`, `EventNode###`, hub nodes. |
| `QuestKeys` | `IQuestKeyClient[]` | `{ItemType, Completed?, unlock?, Progress?: IQuestStage[], CustomData?, CompletionDate?}`. `IQuestStage = {c: number, i: boolean, m: boolean, b: any[]}` — `c` is the stage counter. |
| `ActiveQuest` | `string` | ItemType of the currently tracked quest. `""` if none. |
| `NodeIntrosCompleted` | `string[]` | Node/first-time cinematics seen. |
| `LevelKeys` | `ITypeCount[]` | see §5. |
| `CompletedSyndicates` | `string[]` | Syndicate **missions** completed this rotation (not "maxed syndicates"). |
| `Affiliations` | `IAffiliation[]` | `{Tag, Standing, Title?, Initiated?, FreeFavorsEarned?: number[], FreeFavorsUsed?: number[], WeeklyMissions?}`. `Title` is the rank index. `WeeklyMissions` only on `KahlSyndicate`. |
| `SupportedSyndicate` | `string` | Currently pledged syndicate tag. |
| `ChallengeProgress` | `IChallengeProgress[]` | `{Name, Progress, Completed?: string[], ReceivedJunctionReward?}` — achievements + junction tasks. |
| `ChallengesFixVersion` | `number` | Client-side challenge migration marker. |
| `PlayerSkills` | `IPlayerSkills` | **Intrinsics.** See below. |
| `FocusUpgrades` | `IFocusUpgrade[]` | `{ItemType, Level?, IsUniversal?, IsActive?, TotalCapacity?, CooldownTier?, IsCooldownReductionActive?}`. Example ItemType `/Lotus/Upgrades/Focus/Attack/Active/CloakAttackChargeFocusUpgrade` (Void Strike). |
| `FocusXP` | `IFocusXP` | `{AP_POWER?, AP_TACTIC?, AP_DEFENSE?, AP_ATTACK?, AP_WARD?}` — unspent focus per school. |
| `FocusAbility` | `string` | Equipped focus school "way-bound" active. |
| `FocusCapacity` | `number` | Focus 2.0 pool capacity. |
| `FocusLoadouts` | `IFocusLoadoutClient[]` | `{Preset: IEquipmentSelectionClient, FocusAbility: string}` |
| `TrainingDate` | `IMongoDate` | **When the next MR test becomes available** (24 h cooldown after a failure). |
| `CompletedAlerts` / `CompletedSorties` | `string[]` | Ids of cleared alerts / sorties. |
| `LastSortieReward` / `LastLiteSortieReward` | `ILastSortieRewardClient[]` | `{SortieId, StoreItem, Manifest}` — the reward you're owed. |
| `SortieRewardAttenuation` / `SpecialItemRewardAttenuation` | `{Tag, Atten}[]` | Duplicate-protection weights (Baro's Void Surplus uses the latter). |
| `EvolutionProgress` | `IEvolutionProgress[]` | **Incarnon Genesis**: `{ItemType, Rank, Progress}`. |
| `LoreFragmentScans` | `ILoreFragmentScan[]` | `{ItemType, Region, Progress}` — Cephalon fragments / Somachord. |
| `LibraryPersonalProgress` | `ILibraryPersonalProgress[]` | Simaris codex: `{TargetType, Scans, Completed}`. |
| `CollectibleSeries` | `ICollectibleEntry[]` | Kuria (`/Lotus/Objects/Orokin/Props/CollectibleSeriesOne`) and Duviri fragments (`/Lotus/Types/Lore/Fragments/DuviriFragments/DuviriCollectibleDeco`). `{CollectibleType, Count, Tracking, ReqScans, IncentiveStates:[{threshold,complete,sent}]}`. **`Tracking` is a 90-char bit-string, one char per collectible.** |
| `CompletedJobChains` | `ICompletedJobChain[]` | `{LocationTag, Jobs: string[]}` — e.g. Profit-Taker phases under `"EudicoHeists"`. |
| `PersonalGoalProgress` | `IGoalProgressClient[]` | Event scores: `{_id, Tag, Count, Best?}`. |
| `PeriodicMissionCompletions` | `[{tag, date, count?}]` | Kuva Siphon / weekly-repeatable trackers. |
| `SongChallenges` | `[{Song, Difficulties: number[]}]` | Shawzin song challenges. |
| `EndlessXP` | `IEndlessXpProgressClient[]` | **The Circuit / Steel Path Circuit.** `{Category:"EXC_NORMAL"\|"EXC_HARD", Earn, Claim, Choices: string[], PendingRewards, BonusAvailable?, Expiry?}`. |
| `DescentRewards` | `IDescentCategoryRewardClient[]` | Descent (Cohort) mode: `{Category:"DM_COH_NORMAL"\|"DM_COH_HARD", Expiry, FloorClaimed, Seed, SelectedUpgrades, PendingRewards}`. |
| `ClaimedJunctionChallengeRewards` | `string[]` | U39+ junction reward claims. |
| `LoginMilestoneRewards` | `string[]` | Daily-tribute milestone choices taken. |
| `StoryModeChoice` | `string` | `"WARFRAME"` or `"DUVIRI"`. |
| `MadeStoryModeDecision` | `boolean` | U14–U15 legacy. |
| `LastRegionPlayed` | `TSolarMapRegion` | `"Earth" \| "Ceres" \| … \| "Void" \| "SolarMapDeimosName" \| "1999MapName"` |
| `DuviriInfo` | `{Seed: bigint, NumCompletions: number}` | Current Duviri spiral seed. |
| `TauntHistory` | `[{node, state:"TS_UNLOCKED"\|"TS_COMPLETED"}]` | Maroo's Ayatan hunt. |
| `DiscoveredMarkers` | `[{tag, discoveryState: number[]}]` | Open-world caves/POIs found. |
| `CustomMarkers` | `ICustomMarkers[]` | **Loc-Pins**: `{tag, markerInfos:[{icon, markers:[{anchorName,color,label?,x,y,z,showInHud}]}]}`. |
| `HasOwnedVoidProjectionsPreviously` | `boolean` | Has ever owned a relic. |
| `ReceivedStartingGear` / `ArchwingEnabled` / `PlayedParkourTutorial` / `HasResetAccount` / `HasContributedToDojo` | `boolean` | One-shot flags. |
| `BountyScore` | `number` | |
| `FactionScores` | `number[]` | Invasion faction reputation. |
| `QualifyingInvasions` | `IInvasionProgressClient[]` | `{_id, Delta, AttackerScore, DefenderScore}` — battle-pay eligibility. |

**`PlayerSkills` (intrinsics), verified in both S1 and S12:**

```ts
{ LPP_SPACE: number,        // Railjack intrinsic POINTS. Rank = floor(LPP_SPACE / 1000)
  LPS_PILOTING, LPS_GUNNERY, LPS_TACTICAL, LPS_ENGINEERING, LPS_COMMAND: number,   // 0–10 each
  LPP_DRIFTER: number,      // Drifter intrinsic POINTS. Rank = floor(LPP_DRIFTER / 1000)
  LPS_DRIFT_COMBAT, LPS_DRIFT_RIDING, LPS_DRIFT_OPPORTUNITY, LPS_DRIFT_ENDURANCE: number }
```

The `/1000` conversion is confirmed by WFCD's parser (S12, `Intrinsics.ts`) — `LPP_*` are **unspent points**, the
`LPS_*` are the actual ranks. Each intrinsic rank is worth 1,500 mastery XP.

**`TrainingRetriesLeft`: not found.** Zero hits in SNS (full-repo grep) and not in WFCD's profile schema. The only
MR-test field I can verify is `TrainingDate`. Do not model `TrainingRetriesLeft` until you see it in a real dump.

---

## 7. Foundry / crafting

```ts
interface IPendingRecipeClient {
  ItemId: IOid;                     // the build's own id — what claimCompletedRecipe.php takes
  ItemType: string;                 // "/Lotus/Types/Recipes/Weapons/BratonPrimeBlueprint"
  CompletionDate: IMongoDate;       // ← ready when this is in the past
  TargetFingerprint?: string;       // riven/lich targets
  TargetItemId?: string;            // e.g. the Kubrow egg / suit being acted on
}
```

**"Ready to claim" has no boolean.** It is derived: `CompletionDate.$date.$numberLong <= Date.now()`.
Proof: `checkPendingRecipesController.ts` (S10) computes
`SecondsRemaining = max(0, floor((CompletionDate - now) / 1000))` and the client renders "Claim" at 0.

| Field | Type | Meaning |
| --- | --- | --- |
| `PendingRecipes` | `IPendingRecipeClient[]` | Everything in the foundry right now (incl. Kubrow incubation). |
| `Recipes` | `ITypeCount[]` | Blueprints **owned but not started**. |
| `PendingCoupon` | `{Expiry: IMongoDate, Discount: number}` | Darvo/market discount coupon awaiting use. |
| `PersonalTechProjects` | `IPersonalTechProjectClient[]` | **Railjack ("Rising Tide") + Necramech research.** `{ItemId, ItemType, State, ReqCredits, ReqItems: ITypeCount[], ProductCategory?, CategoryItemId?, HasContributions?, CompletionDate?}` |
| `InfestedFoundry` | `IInfestedFoundryClient` | **Helminth.** `{Name?, Slots?, XP?, Resources: [{ItemType, Count, RecentlyConvertedResources?:[{ItemType,Date}]}], ConsumedSuits: [{s: suitItemType, c?: IColor}], InvigorationIndex?, InvigorationSuitOfferings?: string[], InvigorationsApplied?, LastConsumedSuit?, AbilityOverrideUnlockCooldown?}` |

---

## 8. Nemesis (Kuva Liches / Sisters of Parvos / Coda)

```ts
interface INemesisBaseClient {   // shape of BOTH the active Nemesis and every NemesisHistory entry
  fp: bigint;                 // fingerprint / seed — drives name generation
  manifest: string;           // "/Lotus/Types/Game/Nemesis/KuvaLich/KuvaLichManifest…"
  KillingSuit: string;        // the Warframe that spawned it
  killingDamageType: number;
  ShoulderHelmet: string;
  WeaponIdx: number;          // index into the manifest's weapon list
  AgentIdx: number;
  BirthNode: string;          // "SolNode###"
  Faction: "FC_GRINEER" | "FC_CORPUS" | "FC_INFESTATION";
  Rank: number;               // 0–4
  k: boolean;                 // killed (true) vs converted (false)
  Traded: boolean;
  d: IMongoDate;              // creation date
  PrevOwners: number;         // times traded
  SecondInCommand: boolean;   // assigned as Railjack on-call crew
  Weakened: boolean;
}

interface INemesisClient extends INemesisBaseClient {   // active nemesis only
  InfNodes: { Node: string; Influence: number }[];      // territory on the star chart
  HenchmenKilled: number;
  HintProgress: number;
  Hints: number[];                                       // requiem hints revealed (indices)
  GuessHistory: number[];                                // your parazon guesses so far
  MissionCount: number;
  LastEnc: number;
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `Nemesis` | `INemesisClient?` | The **currently active** lich/sister. Absent when none. |
| `NemesisHistory` | `INemesisBaseClient[]?` | Every past lich/sister — **this is your "liches vanquished/converted" record.** `k` distinguishes them. |
| `LastNemesisAllySpawnTime` | `IMongoDate?` | Cooldown for converted-lich assists. |
| `NemesisAbandonedRewards` | `string[]` | Rewards forfeited by abandoning a nemesis (StoreItem paths). |

Companion field: `CrewMembers[].NemesisFingerprint` links a converted lich to its Railjack crew slot.

---

## 9. Crew / Railjack

| Field | Type | Meaning |
| --- | --- | --- |
| `CrewShips` | `IEquipmentClient[]` | The Railjack itself. Uses `Weapon`, `Customization`, `CrewMembers`, `SlotLevels`, `RailjackImage`, `ItemName`. |
| `CrewShipHarnesses` | `IEquipmentClient[]` | The harness component. |
| `CrewShipWeapons` | `IEquipmentClient[]` | Identified armaments. |
| `CrewShipSalvagedWeapons` | `IEquipmentClient[]` | Un-identified wreckage armaments. |
| `CrewShipWeaponSkins` / `CrewShipSalvagedWeaponSkins` | `IUpgradeClient[]` | Reactors/Shields/Engines/Plating (identified / unidentified). Their `UpgradeFingerprint` is `{compat, buffs:[{Tag,Value}], SubroutineIndex?}`. |
| `CrewShipAmmo` | `ITypeCount[]` | Munitions. |
| `CrewShipRawSalvage` | `ITypeCount[]` | Wreckage resources. |
| `CrewShipFusionPoints` | `number` | Dirac. |
| `CrewMembers` | `ICrewMemberClient[]` | see below |

```ts
interface ICrewMemberClient {
  ItemId: IOid; ItemType: string;
  NemesisFingerprint: bigint;   // non-zero for converted liches
  Seed: bigint;                 // appearance/name seed for hired crew
  AssignedRole?: number;
  SkillEfficiency: { PILOTING:{Assigned:number}, GUNNERY:{…}, ENGINEERING:{…}, COMBAT:{…}, SURVIVABILITY:{…} };
  WeaponConfigIdx: number; WeaponId: IOid;
  XP: number; PowersuitType?: string;
  Configs: IItemConfig[];
  SecondInCommand: boolean;     // "on call"
}
```

Railjack armament placement lives on `CrewShips[0].Weapon`:
`{PILOT?, PORT_GUNS?, STARBOARD_GUNS?, ARTILLERY?, SCANNER?}`, each
`{PRIMARY_A?, PRIMARY_B?, SECONDARY_A?, SECONDARY_B?}` of `IEquipmentSelectionClient`
(`{ItemId?, ItemType?, mod?, cus?, hide?}`).

---

## 10. Time-gated / daily / weekly

### Daily standing pools (14 fields, all `number`)

`DailyAffiliation`, `DailyAffiliationPvp`, `DailyAffiliationLibrary`, `DailyAffiliationCetus`,
`DailyAffiliationQuills`, `DailyAffiliationSolaris`, `DailyAffiliationVentkids`, `DailyAffiliationVox`,
`DailyAffiliationEntrati`, `DailyAffiliationNecraloid`, `DailyAffiliationZariman`, `DailyAffiliationKahl`,
`DailyAffiliationCavia`, `DailyAffiliationHex`.

These are **remaining** standing for today, reset at 00:00 UTC to `16000 + PlayerLevel * 500` (verified in
`inventoryController.ts`). `DailyAffiliation` is shared by all six *faction* syndicates (Steel Meridian, Arbiters,
Cephalon Suda, Perrin Sequence, Red Veil, New Loka); the rest are per-open-world. The server-side mapping is
`standingLimitBinToInventoryKey` (S8), transcribed exactly above.

| Field | Type | Meaning |
| --- | --- | --- |
| `DailyFocus` | `number` | Remaining focus you can earn today. Resets to `250000 + PlayerLevel * 5000`. |
| `NextRefill` | `IMongoDate` | **When all of the above reset** (tomorrow 00:00 UTC). |
| `TradesRemaining` | `number` | Resets to `PlayerLevel` (+2 for Founders). |
| `GiftsRemaining` | `number` | Resets to `max(8, PlayerLevel)`. |
| `UsedDailyDeals` | `string[]` | StoreItem paths of Darvo deals already bought. **The deal list itself is in worldState, not the inventory.** |
| `LibraryPersonalTarget` | `string` | Simaris target currently being hunted. |
| `LibraryAvailableDailyTaskInfo` | `ILibraryDailyTaskInfo` | Today's *offered* Simaris daily. |
| `LibraryActiveDailyTaskInfo` | `ILibraryDailyTaskInfo` | The one you *accepted*. `{EnemyTypes: string[], EnemyLocTag, EnemyIcon, Scans?, ScansRequired, RewardStoreItem, RewardQuantity, RewardStanding}`. `Scans` present only once started. |
| `SeasonChallengeHistory` | `{challenge: string, id: string}[]` | **Nightwave acts completed.** `challenge` is the challenge path; `id` is the worldState instance id. |
| `BlessingCooldown` | `IMongoDate` | Relay blessing cooldown. |
| `EntratiVaultCountLastPeriod` / `EntratiVaultCountResetDate` | `number` / `IMongoDate` | **Netracell runs used this week** + reset time. |
| `EntratiLabConquestUnlocked` / `…HardModeStatus` / `…CacheScoreMission` / `…ActiveFrameVariants` | `number`/`number`/`number`/`string[]` | **Deep Archimedea.** |
| `EchoesHexConquestUnlocked` / `…HardModeStatus` / `…CacheScoreMission` / `…ActiveFrameVariants` / `…ActiveStickers` | | **Temporal Archimedea (1999).** |
| `CalendarProgress` | `ICalendarProgress` | 1999 Kalendar: `{Version, Iteration, YearProgress:{Upgrades:string[]}, SeasonProgress:{SeasonType, LastCompletedDayIdx, LastCompletedChallengeDayIdx, ActivatedChallenges:string[]}}` |
| `WeeklyGuildVaultBonusInfo` | `IWeeklyGuildVaultBonus[]` | `{WeekCount, BonusRegion, Progress?, Rewards:[{RewardClaimed, PointThreshold, ItemCount, Reward}]}`. **SNS notes DE sometimes sends a bare object instead of an array — handle both.** |
| `RecentVendorPurchases` | `IRecentVendorPurchaseClient[]` | Per-vendor purchase limits: `{VendorType, PurchaseHistory:[{ItemId, NumPurchased, Expiry}]}`. |
| `PendingTrades` | `IPendingTradeClient[]` | In-flight trade windows: `{ItemId, State, SelfReady, BuddyReady, Revision, Giving?, Getting, ClanTax?}`. |
| `Wishlist` | `string[]` | Market wishlist — StoreItem paths. |
| `PeriodicMissionCompletions` | `[{tag, date, count?}]` | e.g. Kuva Siphon weekly. |
| `Affiliations[].WeeklyMissions` | `IWeeklyMission[]` | **Kahl weeklies only**: `{MissionIndex, CompletedMission, JobManifest, Challenges: string[], ChallengesReset?, WeekCount}`. |

**Nightwave, assembled:** rank/standing lives in `Affiliations` under a tag from this verified list (S-`worldStateService.ts`):
`RadioLegionSyndicate` (S0 Wolf of Saturn Six) … `RadioLegionIntermission16Syndicate` (S18, "Amir's Shockwave").
Completed acts are in `SeasonChallengeHistory`. The *active* act list is worldState-side (`SeasonInfo.ActiveChallenges`),
not inventory.

---

## 11. Cosmetics / social / misc

| Field | Type | Meaning |
| --- | --- | --- |
| `FlavourItems` | `{ItemType: string}[]` | **Glyphs, UI themes, colour palettes, emotes, Kavasa collars — every non-slot cosmetic.** Usually the largest array on a mature account. |
| `WeaponSkins` | `IWeaponSkinClient[]` | Owned skins (see §4). |
| `LoadOutPresets` | `ILoadOutPresets` | `{NORMAL, NORMAL_PVP, LUNARO, ARCHWING, SENTINEL, OPERATOR, GEAR?, KDRIVE, DATAKNIFE, MECH, OPERATOR_ADULT, DRIFTER}`, each `ILoadoutConfigClient[]`. |
| `CurrentLoadOutIds` | `IOid[]` | Which preset is active per category (index order = `eLoadoutIndex`: NORMAL 0, SENTINEL 1, ARCHWING 2, NORMAL_PVP 3, LUNARO 4, OPERATOR 5, KDRIVE 6, DATAKNIFE 7, MECH 8, OPERATOR_ADULT 9, DRIFTER 10). **MEASURED 2026-09-08** against the account in the running app (`npm run live`): eleven entries, all filled, every group's active preset found at exactly that index. |
| `EquippedGear` / `EquippedEmotes` | `string[]` | Gear & emote wheels. |
| `StepSequencers` | `IStepSequencerClient[]` | Mandachord songs (§4). |
| `Alignment` / `AlignmentReplay` | `{Wisdom: number, Alignment: number}` | Operator alignment. `Alignment` sign = Sun/Moon. |
| `Accolades` | `{Heirloom?: boolean}` | |
| `Founder` | `number` | Founder tier (1 Hunter … 4 Grand Master). Absent = not a Founder. |
| `Staff` / `Moderator` / `Partner` / `Guide` / `Counselor` | `boolean`/`number` | Account badges. `Counselor` unlocks an extra chat channel. |
| `DeathMarks` | `string[]` | Assassins currently hunting you (`"/Lotus/Types/Game/…/BossAladV"`, Stalker, G3, Zanuka). |
| `Harvestable` / `DeathSquadable` | `boolean` | Eligible for Zanuka / Grustrag Three. |
| `BrandedSuits` | `IOid[]` | Warframes branded by the Grustrag Three. |
| `LockedWeaponGroup` | `{s, p?, l?, m?, sn?}` of `IOid` | Weapons locked by G3/Zanuka. |
| `ThemeStyle` / `ThemeBackground` / `ThemeSounds` | `string` | UI theme selection. |
| `ActiveAvatarImageType` | `string` | Equipped profile glyph. |
| `TitleType` | `string` | Equipped profile title. |
| `LotusCustomization` | `ILotusCustomization` | Lotus/Margulis/Natah appearance: `IItemConfig` + `{Persona: string}`. |
| `HubNpcCustomizations` | `[{Tag, Pattern, Colors?}]` | Custom looks for hub NPCs. |
| `OperatorLoadOuts` / `AdultOperatorLoadOuts` / `KahlLoadOuts` | `IOperatorConfigClient[]` | Operator / Drifter / Kahl appearance configs (`IItemConfig` + `ItemId`). |
| `UseAdultOperatorLoadout` | `boolean` | `true` = Drifter, `false` = Operator. |
| `OperatorCustomizationSlotPurchases` | `number` | |
| `GuildId` | `IOid?` | Clan. Name/tier come from `getGuild.php`, not here. |
| `Settings` | `ISettings` | `{FriendInvRestriction, GiftMode, GuildInvRestriction, ShowFriendInvNotifications, TradingRulesConfirmed, SubscribedToSurveys?}` — the `*Restriction` values are `"GIFT_MODE_ALL"\|"GIFT_MODE_FRIENDS"\|"GIFT_MODE_NONE"`. |
| `SubscribedToEmails` / `SubscribedToEmailsPersonalized` | `number` | Marketing opt-in bitflags. |
| `Created` | `IMongoDate` | Account creation. |
| `RewardSeed` | `bigint` | Server RNG seed. **Arrives as a JS number and will lose precision — read it as a string if you ever need it.** |
| `LastInventorySync` | `IOid` | Sync token; changes on every fetch. **Useless as a change detector — hash the payload instead** (which `src/core/gep.ts` already does). |
| `Mailbox` | `{LastInboxId: IOid}` | Last-read inbox message. |
| `OneTimePurchases` | `string[]` | Non-repeatable market purchases already made. |
| `SpectreLoadouts` / `PendingSpectreLoadouts` | `ISpectreLoadout[]` | `{ItemType, Suits, LongGuns, Pistols, Melee, *ModularParts?}` — Specter blueprints. |
| `ActiveDojoColorResearch` | `string` | |
| `DialogueHistory` | `IDialogueHistoryClient` | **1999 KIM / Hex relationships.** `{YearIteration?, Resets?, ResetDates?, Dialogues:[{DialogueName, Rank, Chemistry, AvailableDate, AvailableGiftDate, RankUpExpiry, BountyChemExpiry, QueuedDialogues, Gifts, Booleans, Counters?, Completed}]}` |
| `NokkoColony` | `{FeedLevel: number, JournalEntries: [{EntryType, Progress}]}` | Field Guide / Nokko. |
| `Sketches` | `[{decoId, canvas?}]` | 1999 sketch decorations. |
| `Retro*` (`RetroWallpaperId`, `RetroFastTyping`, `RetroPlayAllConvos`, `RetroDisableKissInboxMessage`) | | 1999 "computer" UI prefs. |
| `MiscAccountData` | `[{PropertyName, Json}]` | **Escape hatch — DE stashes arbitrary JSON strings here.** Worth logging unknown `PropertyName`s. |
| `ChallengeInstanceStates` | `[{id, Progress, params:[{n,v}], IsRewardCollected}]` | Per-instance challenge state. |
| `HandlerPoints` | `number` | |
| `HWIDProtectEnabled` | `boolean` | |
| `HasResetAccount` | `boolean` | |

---

## 12. Gaps — do not trust these without re-verifying

1. **GEP field-by-field coverage is unverified.** Overwolf documents `match_info.inventory` as "type and amount of
   items on the local player" and the blob is the game's own synced inventory, so it *should* be the full
   `IInventoryClient`. Directly evidenced so far: `PlayerLevel, QuestKeys, Missions, XPInfo, NodeIntrosCompleted,
   Suits, LongGuns, Pistols, Melee` (this project, S15) + `PremiumCredits, PremiumCreditsFree, PveBonusLoadoutBin,
   PvpBonusLoadoutBin, a *Bin, a counted-item array` (Overwolf's own sample, S13). **The cheapest way to close this
   gap is to dump one real payload's `Object.keys()` and diff it against §14's interface.** Do that before building
   any panel that assumes a field exists.
2. **Payload size / truncation.** Overwolf's sample reports `valueLength: 16212`. A maxed account's inventory is
   megabytes. I could not find any documented GEP info-update size cap, and could not verify whether Overwolf
   truncates, chunks, or drops oversized values. **Test with a large account before promising completeness.**
3. **`XPInfo` on the public profile.** WFCD declares it at `Results[0].LoadOutInventory.XPInfo`; this project's
   2026-08-31 live check found it absent. Unresolved.
4. **`UpgradesProvidingKey`** — no evidence it exists anywhere. Excluded from the interface.
5. **`TrainingRetriesLeft`** — no evidence it exists anywhere. Only `TrainingDate` is verified.
6. **`DailyDeals` as an inventory field** — does not exist. The inventory has `UsedDailyDeals: string[]`; the deals
   themselves come from worldState.
7. **`Features` bits 16, 128, 256** are unassigned in SNS. Unknown, not proven unused.
8. **Syndicate `Tag` values**: verified from source — `ArbitersSyndicate, CephalonSudaSyndicate, CetusSyndicate,
   EntratiSyndicate, EntratiLabSyndicate, EventSyndicate, HexSyndicate, KahlSyndicate, LibrarySyndicate,
   NewLokaSyndicate, PerrinSyndicate, RedVeilSyndicate, SolarisSyndicate, SteelMeridianSyndicate,
   ZarimanSyndicate`, plus all `RadioLegion*Syndicate`. Quills / VentKids / Vox / Necraloid / Cavia / Conclave tags
   follow the same pattern but I did **not** see their literal strings in a primary source — confirm from a live
   `Affiliations` array. (`https://content.warframe.com/dynamic/worldState.php` now 404s, so I could not cross-check
   there.)
9. **`bigint` fields** (`RewardSeed`, `Nemesis.fp`, `CrewMembers.Seed`, `NemesisFingerprint`, `DuviriInfo.Seed`)
   exceed `Number.MAX_SAFE_INTEGER`. `JSON.parse` will silently corrupt them. If you ever need exact values, parse
   with a reviver or a bigint-aware parser.
10. **Some `IInventoryClient` fields are commented out in SNS** (`WebFlags`, `TradeBannedUntil`, `CompletedJobs`,
    `InvasionChainProgress`, `SentientSpawnChanceBoosters`, `ActiveLandscapeTraps`, `RepVotes`, `LeagueTickets`,
    `Quests`, `Robotics`). They exist in real dumps — SNS just doesn't model them. **If you want literally
    everything, keep an index signature and log unknown keys.**

---

## 13. Practical notes for the app

- **Everything is optional.** SNS marks many fields required because it controls the database; a real payload from
  an older account, a fresh account, or a truncated GEP read will be missing plenty. Model the whole thing as
  `Partial<>` at the boundary.
- **Change detection**: `LastInventorySync` changes every fetch, so it cannot tell you whether anything actually
  changed. The FNV-1a content hash already in `src/core/gep.ts` is the correct approach — keep it.
- **Counting owned items** ≠ `array.length` for mastery. `XPInfo` is the mastery record; a sold item stays in
  `XPInfo` but leaves `Suits`/`LongGuns`/etc. For a mastery panel, drive off `XPInfo`; for an arsenal panel, drive
  off the equipment arrays.
- **`SpecialItems` is not slot-consuming** and includes exalted weapons the player never "acquired" — do not count
  it as ownership.
- **Argon decay** is real and modelled: `MiscItems` Argon minus `FoundToday` Argon decays 50 % at each UTC midnight.
- **Keep an index signature** (`[key: string]: unknown`) and log unrecognised top-level keys once per session.
  DE adds fields every major update, and `MiscAccountData` exists precisely because they stash things ad hoc.

---

## 14. TypeScript interface — pasteable

```ts
// ---------------------------------------------------------------------------
// Warframe account inventory. Shape of `inventory.php` / GEP `match_info.inventory`.
// Sourced from SpaceNinjaServer's IInventoryClient (onlyg.it/OpenWF/SpaceNinjaServer,
// src/types/inventoryTypes/inventoryTypes.ts) + equipmentTypes.ts + commonInventoryTypes.ts.
// EVERYTHING IS OPTIONAL at the boundary — see docs/research/inventory-schema.md §12.
// ---------------------------------------------------------------------------

export type Oid = { $oid?: string; $id?: string };
export type MongoDate = { $date: { $numberLong: string } } | { sec: number; usec: number };
export interface TypeCount { ItemType: string; ItemCount: number }

export type ArtifactPolarity =
  | 'AP_POWER' | 'AP_DEFENSE' | 'AP_TACTIC' | 'AP_ATTACK'
  | 'AP_WARD' | 'AP_UNIVERSAL' | 'AP_UMBRA' | 'AP_PRECEPT' | 'AP_ANY';

export interface Color { t0?: number; t1?: number; t2?: number; t3?: number;
                         en?: number; e1?: number; m0?: number; m1?: number }

export interface ItemConfig {
  Skins?: string[];
  pricol?: Color; attcol?: Color; sigcol?: Color; eyecol?: Color;
  facial?: Color; syancol?: Color; cloth?: Color;
  /** Installed mods. Each entry is an Upgrades[].ItemId.$oid, or "" for an empty slot. */
  Upgrades?: string[];
  Name?: string;
  OperatorAmp?: Oid;
  Songs?: { m?: string; b?: string; p?: string; s: string }[];
  AbilityOverride?: { Ability: string; Index: number };
  PvpUpgrades?: string[];
  ugly?: boolean;
  Colors?: number[];
}

/** Bitmask for Equipment.Features. */
export const EquipmentFeature = {
  DOUBLE_CAPACITY: 1, UTILITY_SLOT: 2, GRAVIMAG_INSTALLED: 4, GILDED: 8,
  ARCANE_SLOT: 32, SECOND_ARCANE_SLOT: 64, INCARNON_GENESIS: 512, VALENCE_SWAP: 1024,
} as const;

export interface EquipmentSelection { ItemId?: Oid; ItemType?: string; mod?: number; cus?: number; hide?: boolean }

export interface PetTraits {
  BaseColor: string; SecondaryColor: string; TertiaryColor: string; AccentColor: string;
  EyeColor: string; FurPattern: string; Personality: string; BodyType: string;
  Head?: string; Tail?: string;
}

export interface KubrowPetDetails {
  Name?: string; IsMale: boolean; Size: number;
  DominantTraits: PetTraits; RecessiveTraits: Partial<PetTraits>;
  IsPuppy?: boolean; HasCollar: boolean; PrintsRemaining: number;
  Status: 'STATUS_INCUBATING' | 'STATUS_INCUBATED' | 'STATUS_AVAILABLE' | 'STATUS_STASIS' | 'STATUS_DISTILLING';
  HatchDate?: MongoDate;
}

export interface Equipment {
  ItemId: Oid;
  ItemType: string;
  ItemName?: string;                 // liches: "Name|NEMESIS"
  Configs?: ItemConfig[];
  UpgradeVer?: number;
  XP?: number;                       // affinity on this instance
  Features?: number;                 // EquipmentFeature bitmask
  Polarized?: number;                // forma count
  Polarity?: { Slot: number; Value: ArtifactPolarity }[];
  FocusLens?: string;
  ModSlotPurchases?: number;
  CustomizationSlotPurchases?: number;
  UpgradeType?: string;
  UpgradeFingerprint?: string;
  InfestationDate?: MongoDate; InfestationDays?: number; InfestationType?: string;
  ModularParts?: string[];
  Expiry?: MongoDate;
  SkillTree?: string;
  OffensiveUpgrade?: string; DefensiveUpgrade?: string; UpgradesExpiry?: MongoDate;
  UmbraDate?: MongoDate;
  ArchonCrystalUpgrades?: { UpgradeType?: string; Color?: string }[];
  Weapon?: CrewShipWeapon;
  Customization?: { CrewshipInterior: ShipCustomization };
  RailjackImage?: { ItemType: string };
  SlotLevels?: number[];
  CrewMembers?: { SLOT_A?: CrewShipMemberRef; SLOT_B?: CrewShipMemberRef; SLOT_C?: CrewShipMemberRef };
  Favorite?: boolean; IsNew?: boolean;
  AltWeaponModeId?: Oid; UpgradeNodes?: number; ExtraRemaining?: number;
  Details?: KubrowPetDetails;        // KubrowPets only
  UnlockLevel?: number; UtilityUnlocked?: number; Gild?: boolean;   // legacy
}

export interface CrewShipMemberRef { ItemId?: Oid; NemesisFingerprint?: number }
export interface CrewShipWeaponEmplacements {
  PRIMARY_A?: EquipmentSelection; PRIMARY_B?: EquipmentSelection;
  SECONDARY_A?: EquipmentSelection; SECONDARY_B?: EquipmentSelection;
}
export interface CrewShipWeapon {
  PILOT?: CrewShipWeaponEmplacements; PORT_GUNS?: CrewShipWeaponEmplacements;
  STARBOARD_GUNS?: CrewShipWeaponEmplacements; ARTILLERY?: CrewShipWeaponEmplacements;
  SCANNER?: CrewShipWeaponEmplacements;
}
export interface ShipCustomization {
  SkinFlavourItem?: string; Colors?: Color; ShipAttachments?: { HOOD_ORNAMENT?: string };
}

export interface Slots { Slots: number; Extra?: number }

export interface RawUpgrade { ItemType: string; ItemCount: number; LastAdded?: Oid }
export interface Upgrade {
  ItemId: Oid; ItemType: string;
  UpgradeFingerprint?: string;         // JSON string: {"lvl":N} | riven fingerprint
  PendingRerollFingerprint?: string;
}
export interface WeaponSkin {
  ItemId: Oid; ItemType: string;
  Favorite?: boolean; IsNew?: boolean; UpgradeType?: string; UpgradeFingerprint?: string;
}

export interface LoadoutConfig {
  ItemId: Oid;
  n?: string;                       // name
  s?: EquipmentSelection;           // suit
  l?: EquipmentSelection;           // primary
  p?: EquipmentSelection;           // secondary
  m?: EquipmentSelection;           // melee
  h?: EquipmentSelection;           // gravimag / heavy
  a?: EquipmentSelection;           // necramech exalted
  FocusSchool?: 'AP_ATTACK' | 'AP_DEFENSE' | 'AP_POWER' | 'AP_TACTIC' | 'AP_WARD';
  PresetIcon?: string; Favorite?: boolean;
}
export interface LoadOutPresets {
  NORMAL: LoadoutConfig[]; NORMAL_PVP: LoadoutConfig[]; LUNARO: LoadoutConfig[];
  ARCHWING: LoadoutConfig[]; SENTINEL: LoadoutConfig[]; OPERATOR: LoadoutConfig[];
  GEAR?: LoadoutConfig[]; KDRIVE: LoadoutConfig[]; DATAKNIFE: LoadoutConfig[];
  MECH: LoadoutConfig[]; OPERATOR_ADULT: LoadoutConfig[]; DRIFTER: LoadoutConfig[];
}

export interface Affiliation {
  Tag: string; Standing: number; Title?: number; Initiated?: boolean;
  FreeFavorsEarned?: number[]; FreeFavorsUsed?: number[];
  WeeklyMissions?: { MissionIndex: number; CompletedMission: boolean; JobManifest: string;
                     Challenges: string[]; ChallengesReset?: boolean; WeekCount: number }[];
}

export interface NemesisBase {
  fp: number; manifest: string; KillingSuit: string; killingDamageType: number;
  ShoulderHelmet: string; WeaponIdx: number; AgentIdx: number; BirthNode: string;
  Faction: 'FC_GRINEER' | 'FC_CORPUS' | 'FC_INFESTATION';
  Rank: number; k: boolean; Traded: boolean; d: MongoDate;
  PrevOwners: number; SecondInCommand: boolean; Weakened: boolean;
}
export interface Nemesis extends NemesisBase {
  InfNodes: { Node: string; Influence: number }[];
  HenchmenKilled: number; HintProgress: number; Hints: number[];
  GuessHistory: number[]; MissionCount: number; LastEnc: number;
}

export interface CrewMember {
  ItemId: Oid; ItemType: string; NemesisFingerprint: number; Seed: number;
  AssignedRole?: number;
  SkillEfficiency: Record<'PILOTING'|'GUNNERY'|'ENGINEERING'|'COMBAT'|'SURVIVABILITY', { Assigned: number }>;
  WeaponConfigIdx: number; WeaponId: Oid; XP: number;
  PowersuitType?: string; Configs: ItemConfig[]; SecondInCommand: boolean;
}

export interface PendingRecipe {
  ItemId: Oid; ItemType: string;
  CompletionDate: MongoDate;        // ready when in the past
  TargetFingerprint?: string; TargetItemId?: string;
}

export interface InfestedFoundry {
  Name?: string; Slots?: number; XP?: number;
  Resources?: { ItemType: string; Count: number;
                RecentlyConvertedResources?: { ItemType: string; Date: number }[] }[];
  ConsumedSuits?: { s: string; c?: Color }[];
  InvigorationIndex?: number; InvigorationSuitOfferings?: string[]; InvigorationsApplied?: number;
  LastConsumedSuit?: Equipment; AbilityOverrideUnlockCooldown?: MongoDate;
}

export interface PlayerSkills {
  LPP_SPACE: number;   // railjack points; rank = floor(/1000)
  LPS_PILOTING: number; LPS_GUNNERY: number; LPS_TACTICAL: number;
  LPS_ENGINEERING: number; LPS_COMMAND: number;
  LPP_DRIFTER: number; // drifter points; rank = floor(/1000)
  LPS_DRIFT_COMBAT: number; LPS_DRIFT_RIDING: number;
  LPS_DRIFT_OPPORTUNITY: number; LPS_DRIFT_ENDURANCE: number;
}

/** The 27 arsenal arrays. */
export type EquipmentKey =
  | 'Suits' | 'LongGuns' | 'Pistols' | 'Melee' | 'SpecialItems'
  | 'Sentinels' | 'SentinelWeapons' | 'SpaceSuits' | 'SpaceGuns' | 'SpaceMelee'
  | 'Hoverboards' | 'OperatorAmps' | 'Antiques' | 'MoaPets' | 'Scoops' | 'Horses'
  | 'DrifterGuns' | 'DrifterMelee' | 'Motorcycles' | 'CrewShips' | 'DataKnives'
  | 'MechSuits' | 'CrewShipHarnesses' | 'KubrowPets' | 'CrewShipWeapons'
  | 'CrewShipSalvagedWeapons' | 'OperatorSuits';

export type SlotKey =
  | 'SuitBin' | 'WeaponBin' | 'SentinelBin' | 'SpaceSuitBin' | 'SpaceWeaponBin'
  | 'MechBin' | 'OperatorAmpBin' | 'CrewShipSalvageBin' | 'CrewMemberBin'
  | 'RandomModBin' | 'PetBin' | 'PveBonusLoadoutBin' | 'PvpBonusLoadoutBin';

export type DailyAffiliationKey =
  | 'DailyAffiliation' | 'DailyAffiliationPvp' | 'DailyAffiliationLibrary'
  | 'DailyAffiliationCetus' | 'DailyAffiliationQuills' | 'DailyAffiliationSolaris'
  | 'DailyAffiliationVentkids' | 'DailyAffiliationVox' | 'DailyAffiliationEntrati'
  | 'DailyAffiliationNecraloid' | 'DailyAffiliationZariman' | 'DailyAffiliationKahl'
  | 'DailyAffiliationCavia' | 'DailyAffiliationHex';

export type Inventory =
  & Partial<Record<EquipmentKey, Equipment[]>>
  & Partial<Record<SlotKey, Slots>>
  & Partial<Record<DailyAffiliationKey, number>>
  & {
  // --- identity / account -------------------------------------------------
  Created?: MongoDate;
  GuildId?: Oid;
  Founder?: number; Staff?: boolean; Moderator?: boolean; Partner?: boolean;
  Guide?: number; Counselor?: boolean; Accolades?: { Heirloom?: boolean };
  Settings?: { FriendInvRestriction: string; GiftMode: string; GuildInvRestriction: string;
               ShowFriendInvNotifications: boolean; TradingRulesConfirmed: boolean;
               SubscribedToSurveys?: boolean };
  SubscribedToEmails?: number; SubscribedToEmailsPersonalized?: number;
  HWIDProtectEnabled?: boolean; HasResetAccount?: boolean;
  LastInventorySync?: Oid; RewardSeed?: number; Mailbox?: { LastInboxId: Oid };
  OneTimePurchases?: string[];

  // --- economy ------------------------------------------------------------
  RegularCredits?: number;          // credits
  PremiumCredits?: number;          // platinum (total)
  PremiumCreditsFree?: number;      // untradeable portion
  FusionPoints?: number;            // endo
  CrewShipFusionPoints?: number;    // dirac
  PrimeTokens?: number;             // regal aya
  MiscItems?: TypeCount[];          // resources; ducats = .../PrimeBucks, aya = .../SchismKey
  FoundToday?: TypeCount[];         // argon safe from tonight's decay
  Recipes?: TypeCount[];            // blueprints owned
  Consumables?: TypeCount[];        // gear items
  LevelKeys?: TypeCount[];
  ShipDecorations?: TypeCount[];
  EmailItems?: TypeCount[];
  Boosters?: { ItemType: string; ExpiryDate: number /* UNIX SECONDS */; UsesRemaining?: number }[];
  FusionTreasures?: { ItemType: string; ItemCount: number; Sockets: number }[];  // ayatans
  Drones?: { ItemId: Oid; ItemType: string; CurrentHP: number; RepairStart?: MongoDate }[];
  TradesRemaining?: number; GiftsRemaining?: number; RandomUpgradesIdentified?: number;
  PendingCoupon?: { Expiry: MongoDate; Discount: number };
  PendingTrades?: unknown[];
  Wishlist?: string[];
  UsedDailyDeals?: string[];
  RecentVendorPurchases?: { VendorType: string;
    PurchaseHistory: { ItemId: string; NumPurchased: number; Expiry: MongoDate }[] }[];

  // --- mods / upgrades ----------------------------------------------------
  RawUpgrades?: RawUpgrade[];       // rank-0, stacked
  Upgrades?: Upgrade[];             // ranked mods + rivens + arcanes
  WeaponSkins?: WeaponSkin[];
  CrewShipWeaponSkins?: Upgrade[];
  CrewShipSalvagedWeaponSkins?: Upgrade[];
  EquippedGear?: string[]; EquippedEmotes?: string[]; EquippedInstrument?: string;
  StepSequencers?: { ItemId: Oid; Name: string; FingerPrint: string;
                     NotePacks: { MELODY: string; BASS: string; PERCUSSION: string } }[];

  // --- progression --------------------------------------------------------
  PlayerLevel?: number;             // mastery rank
  XPInfo?: { ItemType: string; XP: number }[];
  Missions?: { Tag: string; Completes: number; Tier?: number; RewardsCooldownTime?: MongoDate }[];
  QuestKeys?: { ItemType: string; Completed?: boolean; unlock?: boolean; CustomData?: string;
                CompletionDate?: MongoDate;
                Progress?: { c: number; i: boolean; m: boolean; b: unknown[] }[] }[];
  ActiveQuest?: string;
  NodeIntrosCompleted?: string[];
  CompletedAlerts?: string[]; CompletedSorties?: string[]; CompletedSyndicates?: string[];
  LastSortieReward?: { SortieId: Oid; StoreItem: string; Manifest: string }[];
  LastLiteSortieReward?: { SortieId: Oid; StoreItem: string; Manifest: string }[];
  SortieRewardAttenuation?: { Tag: string; Atten: number }[];
  SpecialItemRewardAttenuation?: { Tag: string; Atten: number }[];
  Affiliations?: Affiliation[];
  SupportedSyndicate?: string;
  ChallengeProgress?: { Name: string; Progress: number; Completed?: string[];
                        ReceivedJunctionReward?: boolean }[];
  ChallengesFixVersion?: number;
  ChallengeInstanceStates?: { id: Oid; Progress: number; params: { n: string; v: string }[];
                              IsRewardCollected: boolean }[];
  PlayerSkills?: PlayerSkills;
  FocusUpgrades?: { ItemType: string; Level?: number; IsUniversal?: boolean;
                    IsActive?: number | boolean }[];
  FocusXP?: { AP_POWER?: number; AP_TACTIC?: number; AP_DEFENSE?: number;
              AP_ATTACK?: number; AP_WARD?: number };
  FocusAbility?: string; FocusCapacity?: number;
  FocusLoadouts?: { Preset: EquipmentSelection; FocusAbility: string }[];
  TrainingDate?: MongoDate;
  EvolutionProgress?: { ItemType: string; Rank: number; Progress: number }[];
  LoreFragmentScans?: { ItemType: string; Region: string; Progress: number }[];
  LibraryPersonalProgress?: { TargetType: string; Scans: number; Completed: boolean }[];
  CollectibleSeries?: { CollectibleType: string; Count: number; Tracking: string;
                        ReqScans: number;
                        IncentiveStates: { threshold: number; complete: boolean; sent: boolean }[] }[];
  CompletedJobChains?: { LocationTag: string; Jobs: string[] }[];
  PersonalGoalProgress?: { _id: Oid; Tag: string; Count: number; Best?: number }[];
  PeriodicMissionCompletions?: { tag: string; date: MongoDate; count?: number }[];
  SongChallenges?: { Song: string; Difficulties: number[] }[];
  EndlessXP?: { Category: 'EXC_NORMAL' | 'EXC_HARD'; Earn: number; Claim: number;
                Choices: string[]; PendingRewards: unknown[];
                BonusAvailable?: MongoDate; Expiry?: MongoDate }[];
  DescentRewards?: { Category: 'DM_COH_NORMAL' | 'DM_COH_HARD'; Expiry: MongoDate;
                     FloorClaimed: number; Seed: number; SelectedUpgrades: string[];
                     PendingRewards: unknown[] }[];
  ClaimedJunctionChallengeRewards?: string[];
  LoginMilestoneRewards?: string[];
  StoryModeChoice?: string; MadeStoryModeDecision?: boolean;
  LastRegionPlayed?: string;
  DuviriInfo?: { Seed: number; NumCompletions: number };
  TauntHistory?: { node: string; state: 'TS_UNLOCKED' | 'TS_COMPLETED' }[];
  DiscoveredMarkers?: { tag: string; discoveryState: number[] }[];
  CustomMarkers?: { tag: string; markerInfos: { icon: string;
    markers: { anchorName: string; color: number; label?: string;
               x: number; y: number; z: number; showInHud: boolean }[] }[] }[];
  QualifyingInvasions?: { _id: Oid; Delta: number; AttackerScore: number; DefenderScore: number }[];
  FactionScores?: number[];
  BountyScore?: number; HandlerPoints?: number;
  HasOwnedVoidProjectionsPreviously?: boolean; ReceivedStartingGear?: boolean;
  ArchwingEnabled?: boolean; PlayedParkourTutorial?: boolean; HasContributedToDojo?: boolean;

  // --- foundry ------------------------------------------------------------
  PendingRecipes?: PendingRecipe[];
  PersonalTechProjects?: { ItemId: Oid; ItemType: string; State: number; ReqCredits: number;
                           ReqItems: TypeCount[]; ProductCategory?: string;
                           CategoryItemId?: Oid; HasContributions?: boolean;
                           CompletionDate?: MongoDate }[];
  InfestedFoundry?: InfestedFoundry;
  KubrowPetEggs?: { ItemId: Oid; ItemType: string; ExpirationDate: MongoDate }[];
  KubrowPetPrints?: { ItemId: Oid; ItemType: string; Name: string; IsMale: boolean; Size: number;
                      DominantTraits: PetTraits; RecessiveTraits: PetTraits;
                      InheritedModularParts?: unknown[] }[];

  // --- nemesis ------------------------------------------------------------
  Nemesis?: Nemesis;
  NemesisHistory?: NemesisBase[];
  LastNemesisAllySpawnTime?: MongoDate;
  NemesisAbandonedRewards?: string[];

  // --- railjack -----------------------------------------------------------
  CrewMembers?: CrewMember[];
  CrewShipAmmo?: TypeCount[];
  CrewShipRawSalvage?: TypeCount[];

  // --- time-gated ---------------------------------------------------------
  DailyFocus?: number;
  NextRefill?: MongoDate;
  BlessingCooldown?: MongoDate;
  LibraryPersonalTarget?: string;
  LibraryAvailableDailyTaskInfo?: LibraryDailyTask;
  LibraryActiveDailyTaskInfo?: LibraryDailyTask;
  SeasonChallengeHistory?: { challenge: string; id: string }[];   // nightwave acts done
  EntratiVaultCountLastPeriod?: number; EntratiVaultCountResetDate?: MongoDate;
  EntratiLabConquestUnlocked?: number; EntratiLabConquestHardModeStatus?: number;
  EntratiLabConquestCacheScoreMission?: number; EntratiLabConquestActiveFrameVariants?: string[];
  EchoesHexConquestUnlocked?: number; EchoesHexConquestHardModeStatus?: number;
  EchoesHexConquestCacheScoreMission?: number; EchoesHexConquestActiveFrameVariants?: string[];
  EchoesHexConquestActiveStickers?: string[];
  CalendarProgress?: { Version: number; Iteration: number;
                       YearProgress: { Upgrades: string[] };
                       SeasonProgress: { SeasonType: string; LastCompletedDayIdx: number;
                                         LastCompletedChallengeDayIdx: number;
                                         ActivatedChallenges: string[] } };
  WeeklyGuildVaultBonusInfo?: unknown;   // array OR bare object — DE is inconsistent

  // --- cosmetics / social -------------------------------------------------
  FlavourItems?: { ItemType: string }[];
  LoadOutPresets?: LoadOutPresets;
  LoadoutPresets?: unknown[];            // U14–U15 legacy
  CurrentLoadOutIds?: Oid[];
  OperatorLoadOuts?: (ItemConfig & { ItemId: Oid })[];
  AdultOperatorLoadOuts?: (ItemConfig & { ItemId: Oid })[];
  KahlLoadOuts?: (ItemConfig & { ItemId: Oid })[];
  UseAdultOperatorLoadout?: boolean;
  OperatorCustomizationSlotPurchases?: number;
  LotusCustomization?: ItemConfig & { Persona: string };
  HubNpcCustomizations?: { Tag: string; Pattern: string; Colors?: Color }[];
  Ships?: { ItemId: Oid; ItemType: string; ShipExterior?: ShipCustomization;
            AirSupportPower?: string }[];
  ThemeStyle?: string; ThemeBackground?: string; ThemeSounds?: string;
  ActiveAvatarImageType?: string; TitleType?: string;
  Alignment?: { Wisdom: number; Alignment: number };
  AlignmentReplay?: { Wisdom: number; Alignment: number };
  SpectreLoadouts?: SpectreLoadout[]; PendingSpectreLoadouts?: SpectreLoadout[];
  ActiveDojoColorResearch?: string;
  DeathMarks?: string[]; Harvestable?: boolean; DeathSquadable?: boolean;
  BrandedSuits?: Oid[];
  LockedWeaponGroup?: { s: Oid; p?: Oid; l?: Oid; m?: Oid; sn?: Oid };
  DialogueHistory?: unknown;             // 1999 KIM — expand if you build a KIM panel
  NokkoColony?: { FeedLevel: number; JournalEntries: { EntryType: string; Progress: number }[] };
  Sketches?: { decoId: string; canvas?: string }[];
  RetroWallpaperId?: number; RetroFastTyping?: boolean;
  RetroPlayAllConvos?: boolean; RetroDisableKissInboxMessage?: boolean;
  MiscAccountData?: { PropertyName: string; Json: string }[];

  /** DE adds fields every update. Log unknown keys once per session. */
  [key: string]: unknown;
};

export interface LibraryDailyTask {
  EnemyTypes: string[]; EnemyLocTag: string; EnemyIcon: string;
  Scans?: number; ScansRequired: number;
  RewardStoreItem: string; RewardQuantity: number; RewardStanding: number;
}
export interface SpectreLoadout {
  ItemType: string; Suits: string; LongGuns: string; Pistols: string; Melee: string;
  LongGunsModularParts?: string[]; PistolsModularParts?: string[]; MeleeModularParts?: string[];
}

// ---------------------------------------------------------------------------
// PUBLIC profile endpoint — a DIFFERENT, much smaller shape. Do not conflate.
// GET https://api.warframe.com/cdn/getProfileViewingData.php?playerId=<24-hex>
// ---------------------------------------------------------------------------
export interface PublicProfileResponse {
  Results: PublicProfile[];
  TechProjects?: unknown[]; XpComponents?: unknown[];
  XpCacheExpiryDate?: MongoDate; CeremonyResetDate?: MongoDate;
  Stats: unknown;   // Stats.Weapons / Stats.Scans / Stats.Missions — not in the inventory
}
export interface PublicProfile {
  AccountId: Oid; DisplayName: string; PlatformNames?: string[]; PlayerLevel: number;
  LoadOutPreset: unknown;
  LoadOutInventory: { WeaponSkins: unknown[]; Suits: Equipment[];
                      Pistols?: Equipment[]; LongGuns?: Equipment[]; Melee?: Equipment[];
                      XPInfo: { ItemType: string; XP: number }[] };   // XPInfo presence UNCONFIRMED
  PlayerSkills: Partial<PlayerSkills>;
  ChallengeProgress: { Name: string; Progress: number }[];
  GuildId: Oid; GuildName: string; GuildTier: number; GuildXp: number;
  GuildClass: number; GuildEmblem: boolean; AllianceId?: Oid;
  DeathMarks: string[]; Harvestable: boolean; DeathSquadable: boolean;
  Created: MongoDate; MigratedToConsole: boolean;
  Missions: { Tag?: string; Completes?: number; Tier?: number }[];
  Affiliations: { Tag: string; Standing: number; Title: number }[];
  DailyAffiliation: number; DailyFocus?: number; Wishlist?: string[];
  UnlockedOperator: boolean;      // PUBLIC PROFILE ONLY — not in the inventory
  UnlockedAlignment: boolean;     // PUBLIC PROFILE ONLY — not in the inventory
  OperatorLoadOuts: unknown[];
  Alignment: { Wisdom: number; Alignment: number };
}
```
