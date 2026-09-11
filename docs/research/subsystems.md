# Account Subsystems Beyond Quests & Star Chart

Research brief for the Overwolf overlay. Scope: how each completionist subsystem appears in the
`inventory.php`-shaped payload delivered by Overwolf `match_info.inventory`, what "complete" means,
what repeats, and what time-gates apply.

**Date of research:** 2026-08-31.

---

## 0. Source ledger and trust levels

Every claim below is tagged. Read the tag before you code against the claim.

| Tag | Meaning |
|---|---|
| **[V-SNS]** | Verified by reading SpaceNinjaServer source. SNS is an open re-implementation of DE's game server that the *real* Warframe client talks to, so its field names and units must match the live protocol. Highest-confidence source for field names/shapes. |
| **[V-EXP]** | Verified by downloading and parsing a game-data export. |
| **[V-WIKI]** | Verified by fetching **raw wikitext** (`action=raw`) and reading quoted lines. Numbers only; never wiki prose summaries. |
| **[V-LIVE]** | Verified against a live DE-derived API response. |
| **[INFERRED]** | Reasoned from verified facts. Stated as inference. |
| **[UNKNOWN]** | Explicitly not established. Do not guess in code. |

### Sources actually fetched

- **SpaceNinjaServer** (`main` branch, fetched 2026-08-31) — raw files at
  `https://raw.githubusercontent.com/spaceninjaserver/SpaceNinjaServer/main/<path>`.
  Key files read in full or in part:
  - `src/types/inventoryTypes/inventoryTypes.ts` (1435 lines — the canonical inventory shape)
  - `src/models/inventoryModels/inventoryModel.ts` (schema + defaults)
  - `src/services/inventoryService.ts` (4352 lines)
  - `src/services/missionInventoryUpdateService.ts` (3052 lines)
  - `src/services/worldStateService.ts`
  - `src/controllers/api/inventoryController.ts` (daily reset block)
  - `src/controllers/api/focusController.ts`, `playerSkillsController.ts`,
    `endlessXpController.ts`, `evolveWeaponController.ts`, `nemesisController.ts`,
    `entratiLabConquestModeController.ts`, `crewMembersController.ts`,
    `syndicateSacrificeController.ts`, `setWeaponSkillTreeController.ts`,
    library/Simaris controllers
  - `src/helpers/syndicateStandingHelper.ts`, `src/helpers/nemesisHelpers.ts`
  - `src/constants/evolutionWeapons.ts`, `src/constants/synthesis.ts`
  - `src/controllers/custom/completeAllMissionsController.ts`,
    `unlockAllIntrinsicsController.ts`, `unlockAllScansController.ts`,
    `unlockAllSimarisResearchEntriesController.ts`

- **DE PublicExport** — `https://content.warframe.com/PublicExport/index_en.txt.lzma`.
  Decode confirmed working: strip first 13 bytes, `lzma.LZMADecompressor(format=FORMAT_RAW,
  filters=[{id:FILTER_LZMA1, dict_size:1<<24, lc:3, lp:0, pb:2}])`.
  **Important negative result:** DE's own export contains only 16 manifests
  (`ExportCustoms, ExportDrones, ExportFlavour, ExportFusionBundles, ExportGear, ExportKeys,
  ExportRecipes, ExportRegions, ExportRelicArcane, ExportResources, ExportSentinels,
  ExportSortieRewards, ExportUpgrades, ExportWarframes, ExportWeapons, ExportManifest`).
  **There is no DE export for syndicates, focus upgrades, intrinsics, nightwave, or codex.**
  Those exist only in the community extraction below. `ExportRegions_en.json` was fetched and
  parsed: **269 nodes**, fields `uniqueName / name / systemIndex / systemName / nodeType /
  masteryReq / missionIndex / factionIndex / minEnemyLevel / maxEnemyLevel`, systemIndex 0..24.

- **warframe-public-export-plus** (`calamity-inc/warframe-public-export-plus`, branch `senpai`) —
  community extraction straight out of the game package, and the library SNS itself depends on
  (`"warframe-public-export-plus": "^0.6.8"`). npm latest is **0.6.8, published 2026-07-29**.
  **This means the export lags live content by ~1 month as of this writing** — see the Nightwave
  and Focus/Tauron caveats below. Files fetched and parsed: `ExportSyndicates.json` (39 syndicates),
  `ExportIntrinsics.json`, `ExportFocusUpgrades.json` (105 nodes incl. legacy),
  `ExportCodex.json`, `ExportRegions.json` (354 nodes, richer than DE's).

- **wiki.warframe.com raw wikitext** via `?action=raw`. Note: plain `curl` is blocked by the
  Cloudflare JS interstitial; WebFetch does get through. All wiki numbers below are quoted lines,
  not summaries.

- **Live worldState mirror**: `https://api.warframestat.us/pc/nightwave` (200 OK).
  Note `https://content.warframe.com/dynamic/worldState.php` now returns **404** — the old direct
  worldState URL is dead.

### The single most important structural fact

`IInventoryClient` in `inventoryTypes.ts` is the exact object you will receive. There is a parallel
`IInventoryDatabase` type — **ignore it**, it is SNS-internal (Mongo ObjectIds, `Date` instead of
`{$date:{$numberLong}}`, and SNS-only cheat booleans like `noDailyFocusLimit`). Fields that differ
are listed in the `Omit<...>` clause at the top of `IInventoryDatabase`. **[V-SNS]**

---

## 1. Focus / Operator

### Fields

```ts
FocusXP?: {                 // unspent focus pool, per school
    AP_POWER?:   number;    // Zenurik
    AP_TACTIC?:  number;    // Naramon
    AP_DEFENSE?: number;    // Vazarin
    AP_ATTACK?:  number;    // Madurai
    AP_WARD?:    number;    // Unairu
}
FocusUpgrades: {
    ItemType: string;       // e.g. "/Lotus/Upgrades/Focus/Attack/Active/DashFireFocusUpgrade"
    Level?: number;         // node rank
    IsUniversal?: boolean;  // TRUE == this node has been made Waybound (unbound)
    IsActive?: number | boolean;   // Focus 2.0 uses number, Focus 1.0 boolean
    TotalCapacity?: number;        // Focus 1.0 legacy
    CooldownTier?: number;         // Focus 1.0 legacy
    IsCooldownReductionActive?: boolean; // Focus 1.0 legacy
}[]
FocusAbility?: string;      // the currently ACTIVE school
FocusCapacity?: number;     // Focus 2.0 pool size — legacy, pool removed in U31.5
FocusLoadouts?: { Preset: IEquipmentSelectionClient; FocusAbility: string }[]
DailyFocus: number;         // REMAINING focus you may still bank today (counts DOWN)
```
**[V-SNS]** `src/types/inventoryTypes/inventoryTypes.ts` lines ~400–560, 780–812.

### School ↔ polarity mapping

SNS derives the polarity from the item path: `"AP_" + type.substring(1).split("/")[3].toUpperCase()`
(`focusTypeToPolarity` in `focusController.ts`). So path segment 4 is the school directory. **[V-SNS]**

| Path segment | Polarity key | School |
|---|---|---|
| `Attack` | `AP_ATTACK` | Madurai |
| `Defense` | `AP_DEFENSE` | Vazarin |
| `Tactic` | `AP_TACTIC` | Naramon |
| `Power` | `AP_POWER` | Zenurik |
| `Ward` | `AP_WARD` | Unairu |

School names verified **[V-WIKI]** (`Focus`, raw): *"Madurai, School of the Fighters / Vazarin,
School of the Protectors / Naramon, School of the Tacticians / Unairu, School of the Indomitable /
Zenurik, School of the Arcane"*. The directory↔school pairing is **[INFERRED]** from the path
convention plus SNS's supplemental cost table which annotates
`/Lotus/Upgrades/Focus/Power/Residual/ChannelEfficiencyFocusUpgrade` as *"Zenurik's Inner Might"*
and `/Lotus/Upgrades/Focus/Attack/Residual/SlashDamageFocusUpgrade` as *"Madurai's Blazing Fury"* —
which pins Power=Zenurik and Attack=Madurai directly. **[V-SNS]**

### What "complete" means

- **10 Ways per school**, of which **2 are Way-Bound**. *"Each school has two Way-Bound nodes, for a
  total of 10 Way-Bound nodes available to unlock."* and *"Each school typically has 6 Active Ways"*
  + *"Each school typically has 2 Passive Ways, not including Waybounds."* **[V-WIKI]**
- **All Ways have a total of four ranks.** **[V-WIKI]** Consistent with the export: e.g.
  `AttackEfficiencyFocusUpgrade` has `fusionLimit: 3` with 4 `levelStats` entries. **[V-EXP]**
- **Waybound = `IsUniversal: true`** on the `FocusUpgrades` entry. SNS's `UnbindUpgrade` op sets
  exactly that, costing `750_000` focus **per node** plus **1 Brilliant Eidolon Shard per node**
  (`SentientShardBrilliantItem`). **[V-SNS]** Cross-checked **[V-WIKI]**: *"Unbinding a Way-Bound
  node requires the node to be upgraded to the last rank, then spending 750,000 Focus Points and one
  Brilliant Eidolon Shard."*
- **Unlocking a school** beyond your first costs **50,000** focus (`UnlockWay`: `const cost =
  inventory.FocusAbility ? 50_000 : 0`). **[V-SNS]** + **[V-WIKI]**.
- **Totals** **[V-WIKI]**, quoted from `Focus` raw:
  - Per school: *"the total to max a single school requires 9,000,000 Focus Points to max rank each
    Way, as well as an additional 1,500,000 focus and 2 Brilliant Eidolon Shard to unbind both
    Waybound nodes, totaling to 10,500,000 per school."*
  - All five: *"45,000,000 ... plus an additional 7,500,000 focus and 10 Brilliant Eidolon Shards
    for all Waybounds, plus an additional 25,025,000 focus and 864 Lyroic Bridge, 912 Ren Hypercore,
    and 839 Ascaris Prime for the Tauron Strike Ways, to a grand total of 77,525,000."*
  - **Tauron Strike** is new post-*The Old Peace* content: *"After completing The Old Peace and
    purchasing the school's respective Tektolyst Artifact from Marie, players can unlock a Tauron
    Strike that functions as the Operator's third ability."* Per-school cost *"a total of 5,005,000
    Focus per school"* (× 5 = 25,025,000 ✓).
  - ⚠️ **The wiki contradicts itself on Tauron resource totals**: one line says *"A total of 114
    Lyroic Bridge, 162 Ren Hypercore, and 89 Ascaris Prime is needed to max out all school Tauron
    Strike Ways"*, another says *864 / 912 / 839*. Do not display either number as fact.
  - **Tauron Strike does not appear in `ExportFocusUpgrades.json` 0.6.8 nor anywhere in SNS `main`**
    (grepped for "tauron" — zero hits in both). **The inventory field/path that records Tauron
    Strike ownership and rank is [UNKNOWN].** Likely additional `FocusUpgrades` entries under a new
    path, but do not assume.

### Eidolon shard → focus conversion (`ConvertShard` op)

**[V-SNS]** and independently **[V-WIKI]** — the two agree exactly:

| Shard | Focus |
|---|---|
| `SentientShardCommonItem` (Eidolon Shard) | 2,500 |
| `SentientShardSynthesizedItem` (Synthetic) | 5,000 |
| `SentientShardBrilliantItem` (Brilliant) | 25,000 |
| `SentientShardBrilliantTierTwoItem` (Radiant) | 40,000 |

### Daily focus cap — the exact formula

```ts
inventory.DailyFocus = 250000 + inventory.PlayerLevel * 5000;
```
in the daily-reset block of `inventoryController.ts`. **[V-SNS]** `PlayerLevel` **is** Mastery Rank.
Cross-checked **[V-WIKI]**: *"Focus Points have a daily limit of 250,000, which scales at the rate of
5,000 additional cap per Mastery Rank."*

`DailyFocus` counts **down**: `addFocusXpIncreases()` does
`inventory.DailyFocus -= focusXpPlus.reduce((a,b)=>a+b, 0)`. **[V-SNS]** So the overlay should render
`DailyFocus` as *remaining*, and compute `used = (250000 + MR*5000) - DailyFocus`.

The cap is **account-wide, not per school** — one counter, decremented by the sum across all
polarities. **[V-SNS]** (the `.reduce()` over the whole array).

Reset: `NextRefill = new Date((today + 1) * 86400000)` → **daily at 00:00 UTC**. **[V-SNS]**

### Repeatable vs one-and-done

- Unlocking schools, unlocking nodes, ranking nodes, unbinding waybounds: **one-and-done**.
- Earning focus: **repeatable, daily-capped**.
- `FocusLoadouts` (school preset loadouts): cosmetic/config, not completion.

---

## 2. Intrinsics

### Field

```ts
PlayerSkills: {
    LPP_SPACE: number;            // unspent Railjack intrinsic pool
    LPS_PILOTING: number;         // rank 0..10
    LPS_GUNNERY: number;
    LPS_TACTICAL: number;
    LPS_ENGINEERING: number;
    LPS_COMMAND: number;
    LPP_DRIFTER: number;          // unspent Drifter intrinsic pool
    LPS_DRIFT_COMBAT: number;     // rank 0..10
    LPS_DRIFT_RIDING: number;
    LPS_DRIFT_OPPORTUNITY: number;
    LPS_DRIFT_ENDURANCE: number;
}
```
**[V-SNS]** `inventoryTypes.ts` `IPlayerSkills`; schema defaults all `0` in `inventoryModel.ts`.

### Max rank

**10 for all nine skills.** **[V-SNS]** — `unlockAllIntrinsicsController.ts` sets every `LPS_*` to
`10`. Cross-checked **[V-EXP]** `ExportIntrinsics.json`: `LPS_TACTICAL / LPS_PILOTING / LPS_GUNNERY /
LPS_ENGINEERING / LPS_COMMAND`, each with a 10-entry `ranks` array. (Drifter intrinsics are **not**
in `ExportIntrinsics.json` — that export covers Railjack only.) Cross-checked **[V-WIKI]** for both.

### ⚠️ Units: the pool is stored ×1000

`playerSkillsController.ts`:
```ts
const cost = (request.Pool == "LPP_DRIFTER" ? drifterCosts[oldRank] : 1 << oldRank) * 1000;
inventory.PlayerSkills[request.Pool] -= cost;
```
So **`LPP_SPACE` and `LPP_DRIFTER` are in thousandths of an Intrinsic point.** Divide by 1000 to get
the number the game UI shows. **[V-SNS]** — high confidence because the real client and SNS must
agree on the response `PoolInc: -cost`, but flagged since I could not observe a live payload.

### Cost tables

**Railjack** — `1 << rank` intrinsics (i.e. 1,2,4,…,512):

| Rank | Cost | Cumulative |
|---|---|---|
| 1..10 | 1, 2, 4, 8, 16, 32, 64, 128, 256, 512 | **1,023 per skill** |

**5 skills × 1,023 = 5,115 Intrinsics** to max Railjack (= `5,115,000` in `LPP_SPACE` units).
**[V-SNS]** (`1 << oldRank`) and **[V-WIKI]** (`Railjack/Intrinsics` raw: *"a total of 5,115
Intrinsics"*, max rank 10, identical per-rank table).

**Drifter** — `drifterCosts = [20, 25, 30, 45, 65, 90, 125, 160, 205, 255]`:

| Rank | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Cum. |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Cost | 20 | 25 | 30 | 45 | 65 | 90 | 125 | 160 | 205 | 255 | **1,020** |

**4 skills × 1,020 = 4,080 Intrinsics** (= `4,080,000` in `LPP_DRIFTER` units).
**[V-SNS]** (verbatim array) and **[V-WIKI]** (`Drifter/Intrinsics` raw: *"a total of 4,080
Intrinsics"*, identical table).

### Notable rank side-effects (useful overlay hints)

- `LPS_COMMAND` reaching **9** grants a `CrewmateBall` consumable. **[V-SNS]**
- `LPS_DRIFT_RIDING` reaching **9** grants an `ErsatzSummon` consumable. **[V-SNS]**
- `LPS_DRIFT_OPPORTUNITY` **9** unlocks the Riven/Kuva alternatives in the Steel Path Circuit
  reward picker. **[V-WIKI]** (`The Circuit` raw).

### Time gates

**None.** Intrinsics are pure grind. One-and-done per rank; earning points is repeatable.

---

## 3. Syndicates

### Fields

```ts
Affiliations: {
    Tag: string;              // e.g. "SteelMeridianSyndicate"
    Standing: number;         // cumulative, capped by title
    Title?: number;           // rank; can be negative for the 6 originals
    Initiated?: boolean;
    FreeFavorsEarned?: number[];   // rank levels whose free favour has been earned
    FreeFavorsUsed?: number[];
    WeeklyMissions?: IWeeklyMission[];  // Kahl only
}[]
SupportedSyndicate?: string;   // the syndicate whose sigil you have pledged
CompletedSyndicates: string[];
// plus the 14 daily counters, see below
```
**[V-SNS]**

### ⚠️ `CompletedSyndicates` is NOT "syndicates you have maxed"

`missionInventoryUpdateService.ts` case `"SyndicateId"`:
```ts
if (!inventory.syndicateMissionsRepeatable && !inventory.CompletedSyndicates.includes(value)) {
    inventory.CompletedSyndicates.push(value);
}
```
It is the list of **syndicate-mission instance IDs already run** (the daily syndicate missions from
worldState, plus Kahl weekly `KahlSyndicate_<weekCount>` entries). **[V-SNS]** Displaying it as
"syndicates completed" would be wrong.

### The daily standing counters

`IDailyAffiliations` — exactly these 14 fields, each a **remaining allowance that counts down**:

| Inventory field | Standing bin | Who uses it |
|---|---|---|
| `DailyAffiliation` | `STANDING_LIMIT_BIN_NORMAL` | **Shared pool** for the six originals |
| `DailyAffiliationPvp` | `..._PVP` | Conclave |
| `DailyAffiliationLibrary` | `..._LIBRARY` | Cephalon Simaris |
| `DailyAffiliationCetus` | `..._CETUS` | Ostron (Cetus) |
| `DailyAffiliationQuills` | `..._QUILLS` | The Quills |
| `DailyAffiliationSolaris` | `..._SOLARIS` | Solaris United |
| `DailyAffiliationVentkids` | `..._VENTKIDS` | Ventkids |
| `DailyAffiliationVox` | `..._VOX` | Vox Solaris |
| `DailyAffiliationEntrati` | `..._ENTRATI` | Entrati (Necralisk) |
| `DailyAffiliationNecraloid` | `..._NECRALOID` | Necraloid |
| `DailyAffiliationZariman` | `..._ZARIMAN` | The Holdfasts |
| `DailyAffiliationKahl` | `..._KAHL` | Kahl's Garrison (and Nokko/Field Guide) |
| `DailyAffiliationCavia` | `..._CAVIA` | Cavia (`EntratiLabSyndicate`) |
| `DailyAffiliationHex` | `..._HEX` | The Hex |

**[V-SNS]** `standingLimitBinToInventoryKey` in `inventoryService.ts` ~line 1874.
Bins with `STANDING_LIMIT_BIN_NONE` (Nightwave, EventSyndicate) are **uncapped daily** —
`getStandingLimit()` returns `Number.MAX_SAFE_INTEGER`. **[V-SNS]**

### Daily cap formula

```ts
for (const key of allDailyAffiliationKeys) {
    inventory[key] = 16000 + inventory.PlayerLevel * 500;
}
```
**[V-SNS]** `inventoryController.ts` daily-reset block. Cross-checked **[V-WIKI]** (`Syndicate` raw):
*"Starting at Mastery Rank 0, the Daily Standing Cap gain for all Faction Syndicates will start at
16,000 and increase by 500 per rank."*

**Every bin gets the same allowance** — SNS assigns the identical value to all 14 keys. The six
originals *share* one counter (`DailyAffiliation`); each open-world/neutral syndicate gets its own.
**[V-SNS]**

Reset **daily at 00:00 UTC** (`NextRefill`). **[V-SNS]**

Medallion behaviour: `medallionsCappedByDailyLimit` per syndicate decides whether donated medallions
eat the daily cap. It is `false` for the six originals + Simaris, `true` for Cetus/Quills/Solaris/
Ventkids/Vox/Entrati/Necraloid/Zariman/Cavia/Hex. **[V-EXP]** `ExportSyndicates.json`.

### Complete roster with max rank (`ExportSyndicates.json`, 39 entries) **[V-EXP]**

| Tag | Daily bin | Max Title | Top `maxStanding` |
|---|---|---|---|
| `ArbitersSyndicate` | NORMAL | 5 (min −2) | 372,000 |
| `CephalonSudaSyndicate` | NORMAL | 5 (min −2) | 372,000 |
| `NewLokaSyndicate` | NORMAL | 5 (min −2) | 372,000 |
| `PerrinSyndicate` | NORMAL | 5 (min −2) | 372,000 |
| `RedVeilSyndicate` | NORMAL | 5 (min −2) | 372,000 |
| `SteelMeridianSyndicate` | NORMAL | 5 (min −2) | 372,000 |
| `ConclaveSyndicate` | PVP | 5 | 372,000 |
| `LibrarySyndicate` (Simaris) | LIBRARY | **no titles** | 125,000 (SNS hard-codes) |
| `CetusSyndicate` (Ostron) | CETUS | 5 | 372,000 |
| `QuillsSyndicate` | QUILLS | 5 | 372,000 |
| `SolarisSyndicate` | SOLARIS | 5 | 372,000 |
| `VoxSyndicate` (Vox Solaris) | VOX | 5 | 372,000 |
| `VentKidsSyndicate` | VENTKIDS | 5 | 372,000 |
| `EntratiSyndicate` | ENTRATI | 5 | 372,000 |
| `NecraloidSyndicate` | NECRALOID | **3** | 141,000 |
| `EntratiLabSyndicate` (Cavia) | CAVIA | 5 | 372,000 |
| `ZarimanSyndicate` (Holdfasts) | ZARIMAN | 5 | 372,000 |
| `HexSyndicate` | HEX | 5 | 372,000 |
| `KahlSyndicate` | KAHL | 5 | **5** (see below) |
| `NightcapJournalSyndicate` (Nokko / Field Guide) | KAHL | 5 | **5** |
| `EventSyndicate` | NONE | 3 | 500,000 |
| `RadioLegion*Syndicate` (Nightwave) | NONE | varies 15–210 | see §6 |

Notes:
- **Simaris has no titles at all.** `getMaxStanding()` special-cases it: *"if (!syndicate.titles) {
  // LibrarySyndicate → return 125000 }"*. **[V-SNS]** So Simaris standing caps at 125,000 held at
  once and there is no rank to display.
- **Kahl and Nokko use tiny standing values** (titles at 0→1→2→3→4→5). Kahl "standing" is effectively
  a rank counter; the actual currency is `KahlCreds` in `MiscItems`. **[V-SNS]**
- **Necraloid tops out at rank 3.** **[V-EXP]**

### Standing thresholds for a standard 5-rank syndicate **[V-EXP]** + **[V-WIKI]** (agree exactly)

| Title | minStanding | maxStanding | Span shown in UI |
|---|---|---|---|
| 5 | 240,000 | 372,000 | 132,000 |
| 4 | 141,000 | 240,000 | 99,000 |
| 3 | 71,000 | 141,000 | 70,000 |
| 2 | 27,000 | 71,000 | 44,000 |
| 1 | 5,000 | 27,000 | 22,000 |
| 0 | −5,000 | 5,000 | 5,000 |
| −1 | −27,000 | −5,000 | 22,000 |
| −2 | −71,000 | −27,000 | 44,000 |

Negative ranks exist only for the six originals (`alignments` present). Standing floor is hard-clamped
at **−71,000** in `addStanding()`. **[V-SNS]**

### Alignments (the six originals)

`ExportSyndicates.json` `alignments`, e.g. Steel Meridian:
`{"PerrinSyndicate": -1, "NewLokaSyndicate": -0.5, "RedVeilSyndicate": 0.5}`. **[V-EXP]**
`addStanding()` propagates gains to aligned syndicates at those factors and demotes titles when
standing drops below the current title's `minStanding`. **[V-SNS]** — this is why "max all six" is
not achievable simultaneously.

### What "complete" means

- Per syndicate: `Title == maxLevel` **and** `Standing == maxStanding` of that title.
- Truly complete = every `favours` (offering) purchased. The offerings list is in
  `ExportSyndicates[tag].favours` (not enumerated here). Purchases are **not** recorded per-syndicate
  in the inventory; ownership must be inferred from the resulting items. **[INFERRED]**
- `FreeFavorsEarned`/`FreeFavorsUsed` arrays hold **rank levels**, so `Earned \ Used` = unclaimed
  free favours. **[V-SNS]**

### Repeatable

Standing is repeatable and daily-capped; rank-up sacrifices are one-and-done per rank (but rank can
go **down** for the six originals via alignment).

---

## 4. Steel Path

### How it is recorded — there is no separate Missions array

```ts
Missions: {
    Tag: string;        // node uniqueName, e.g. "SolNode94"
    Completes: number;  // normal-mode completion count
    Tier?: number;      // 1 == cleared on Steel Path
    RewardsCooldownTime?: IMongoDate;
}[]
```
**[V-SNS]** `IMission` / `IMissionDatabase` in `inventoryTypes.ts`; `missionSchema` in
`inventoryModel.ts` (`Tier: { type: Number, required: false }`).

Writer (`addMissionComplete`):
```ts
if (itemIndex !== -1) {
    Missions[itemIndex].Completes += Completes;
    if (Completes && Tier) { Missions[itemIndex].Tier = Tier; }
} else if (Tag !== "") {
    Missions.push({ Tag, Completes });      // note: no Tier on first insert
}
```
**[V-SNS]** Two consequences for the overlay:
1. **Steel Path clear is a per-node boolean flag `Tier == 1` on the same `Missions` entry.** There is
   no second array, no difficulty enum, no `SteelPathMissions`.
2. A node cleared *only* on Steel Path and never on normal still gets a `Missions` entry, but the
   first insert drops `Tier` — so a fresh node's Tier appears on the *second* update. Do not treat
   absence of `Tier` on a low-`Completes` node as authoritative.

The `Tier` value flows in from `RewardInfo`/`Missions.Tier` on the mission-results payload; SNS also
keys Steel Path variants of Duviri/Circuit/Kullervo rewards off `mission?.Tier == 1`. **[V-SNS]**

Steel Path unlock itself is recorded as the string `"TeshinHardModeUnlocked"` in
`NodeIntrosCompleted: string[]`. **[V-SNS]** (`completeAllMissionsController.ts` adds it).

### What "complete" means (SNS's reconstruction of DE's trophy rule)

`ensureUserHasSteelPathRewards()` **[V-SNS]**:
```ts
const completedNodes = new Set(inventory.Missions.filter(m => m.Tier).map(m => m.Tag));
// a planet is "eligible" only if EVERY qualifying node on it is in completedNodes
isRequiredForSteelPathTrophy      = (r) => r.missionType != "MT_PVP";
isRequiredForRailjackSteelPathTrophy = (r) => r.systemIndex != 6 && !r.hidden && r.maxEnemyLevel != 1;
```
So: **every non-PvP node in `ExportRegions` must have `Tier` truthy**. Railjack (`MT_RAILJACK`) nodes
roll up into a single pseudo-system index **20 ("DeepSpace")** and exclude systemIndex-6 nodes
(Ash/Garuda farming nodes), `hidden` nodes (nemesis showdown nodes) and the free-roam node
(`maxEnemyLevel == 1`).

The 23 trophy systems **[V-SNS]** (`steelPathSystems`, `[systemIndex, shortName]`):

```
0 Mercury · 1 Venus · 2 Earth · 3 Mars · 4 Jupiter · 5 Saturn · 6 Uranus · 7 Neptune
8 Pluto · 9 Ceres · 10 Eris · 11 Sedna · 12 Europa · 14 Void · 15 Phobos · 16 Deimos
17 Lua · 18 KuvaFortress · 20 DeepSpace · 21 Zariman · 22 Duviri · 23 1999 · 24 Perita
```
(systemIndex 13 and 19 are absent from the trophy list.)

Per-system rewards on full clear **[V-SNS]**:
- Ship deco `"/Lotus/Types/Items/ShipDecos/PlanetTrophies/PlanetTrophy<Name>Bronze"` → `ShipDecorations`
- Emote `"/Lotus/Types/Items/Emotes/Hardmode<Name>Emote"` → `FlavourItems`
- Deimos (index 16) additionally grants `PlanetTrophyDerelictBronze`.

**Overlay recipe:** `steelPathPct = |{tags with Tier}∩nonPvpNodes| / |nonPvpNodes|`, using
`ExportRegions` as the node universe. Community export gives **354 nodes**, **337 non-PvP**
(17 `MT_PVP`); DE's own `ExportRegions_en.json` gives 269 (it omits some newer/hidden node classes).
**[V-EXP]** Prefer the community export for this, and refresh it — the pinned 0.6.8 lags live.

### Steel Path Incursions (daily) & Steel Essence

Incursions arrive as `RewardInfo.periodicMissionTag` beginning with `"HardDaily"`, granting
5 × `SteelEssence`. **[V-SNS]** Completion is recorded in:
```ts
PeriodicMissionCompletions: { tag: string; date: IMongoDate; count?: number }[]
```
The handler upserts by `tag` and refreshes `date` on repeat. **[V-SNS]** So "have I done today's
incursions?" = for each active incursion tag from worldState, is `date` within the current UTC day.
**The set of active `HardDaily*` tags is worldState-driven, not in the inventory** — SNS does not
generate them, so the exact tag naming (`HardDaily0..4`?) is **[UNKNOWN]**.

Other things that use `PeriodicMissionCompletions`: `EliteAlert`/`EliteAlertB` (Elite Sanctuary /
alerts), `KuvaMission*` (Kuva Siphon/Flood), `TreasureHunt*`. **[V-SNS]**

Also relevant: Railjack Steel Path nodes (`CrewBattleNode*` with `mission?.Tier`) grant 2 Steel
Essence as of 43.0.6. **[V-SNS]**

---

## 5. Kuva Liches / Sisters / Coda

### Fields

```ts
Nemesis?: INemesisClient          // the CURRENT active adversary (undefined if none)
NemesisHistory?: INemesisBaseClient[]   // vanquished/converted adversaries
LastNemesisAllySpawnTime?: IMongoDate
NemesisAbandonedRewards: string[]
```

```ts
interface INemesisBaseClient {      // === one entry of NemesisHistory
    fp: bigint | number;    // fingerprint — the RNG seed; identifies the adversary
    manifest: string;       // e.g. "/Lotus/Types/Game/Nemesis/KuvaLich/KuvaLichManifestVersionSeven"
    KillingSuit: string;    // warframe that spawned it
    killingDamageType: number;
    ShoulderHelmet: string;
    WeaponIdx: number;      // index into manifest.weapons
    AgentIdx: number;
    BirthNode: string;
    Faction: "FC_GRINEER" | "FC_CORPUS" | "FC_INFESTATION";
    Rank: number;
    k: boolean;             // true = VANQUISHED, false = CONVERTED
    Traded: boolean;
    d: IMongoDate;          // creation date
    PrevOwners: number;
    SecondInCommand: boolean;   // "on call" crew slot
    Weakened: boolean;
}
interface INemesisClient extends INemesisBaseClient {
    InfNodes: { Node: string; Influence: number }[];
    HenchmenKilled: number;
    HintProgress: number;
    Hints: number[];
    GuessHistory: number[];
    MissionCount: number;
    LastEnc: number;
}
```
**[V-SNS]** `inventoryTypes.ts` ~lines 940–1000.

`NemesisHistory` is appended in `missionInventoryUpdateService.ts` case `"NemesisKillConvert"`,
copying every base field from `Nemesis` and setting `k: value.killed`. Entries are **removed**
(spliced by `fp`) when you relinquish them via `nemesisController` `mode=d`. **[V-SNS]** So
`NemesisHistory` is a *roster of retained adversaries*, **not a permanent kill log** — a player who
relinquishes everything shows an empty history despite having farmed dozens.

### Faction ↔ variant

| `Faction` | Manifest family | Showdown node | Kind |
|---|---|---|---|
| `FC_GRINEER` | `KuvaLichManifest*` (7 versions) | `CrewBattleNode557` | Kuva Lich |
| `FC_CORPUS` | `LawyerManifest*` (5 versions) | `CrewBattleNode558` | Sister of Parvos |
| `FC_INFESTATION` | `InfestedLichManifest` | `CrewBattleNode559` | **Coda** (1999, systemIndex 23) |

**[V-SNS]** `nemesisHelpers.ts`.

### Weapon collections — "complete"

The weapon you get is `manifest.weapons[WeaponIdx]`, given as a **recipe** on vanquish
(`giveNemesisWeaponRecipe`); converting gives no weapon. **[V-SNS]**

- **Kuva (latest manifest, `KuvaLichManifestVersionSeven`) — 21 weapons** **[V-SNS]**, counted from
  the class chain (base 13 + V3 `+3` + V5 `+3` + V6 `+1` + V7 `+1`). Paths, verbatim, without
  display-name guesses:
  `KuvaDrakgoon, KuvaKarak, GrnKuvaLichScytheWeapon, KuvaKohm, KuvaOgris, KuvaQuartakk, KuvaTonkor,
  KuvaBrakk, KuvaKraken, KuvaSeer, KuvaStubba, GrnHeavyGrenadeLauncher, GrnKuvaLichRifleWeapon`
  (base) `+ GrnBowWeapon, KuvaHind, KuvaNukor` (V3) `+ KuvaHekWeapon, KuvaZarr, KuvaGrattler` (V5)
  `+ KuvaSobek` (V6) `+ KuvaGhoulSaw` (V7).
  *The live count depends on which manifest version string the client sends in `Nemesis.manifest`.*
- **Corpus (`LawyerManifestVersionFive`) — 11 weapons** **[V-SNS]**, paths verbatim:
  `CrpBriefcaseLauncher, CrpBEArcaPlasmor, CrpBEFluxRifle, CrpBETetra, CrpBECycron, CrpBEDetron,
  CrpIgniterPistol, CrpBriefcaseAkimboPistol` (base) `+ CrpBEPlinxWeapon` (V2) `+ CrpBEGlaxion` (V3)
  `+ CrpBEQuanta` (V5). Mapping these paths to in-game display names was **not** verified — do it via
  `ExportWeapons` + `dict.en`.
- **Coda / Infested — `weapons = []` in SNS.** The Coda weapon list is **not implemented in SNS**,
  and `giveNemesisWeaponRecipe` is skipped for `FC_INFESTATION` (SNS comment: *"weaponLoc is
  '/Lotus/Language/Weapons/DerelictCernosName' for these for some reason"*). **The authoritative Coda
  weapon list is [UNKNOWN] from the sources I checked** — do not fabricate one.

Ownership of an obtained lich weapon shows up like any other weapon: an entry in `LongGuns` /
`Pistols` / `Melee` with a `UpgradeFingerprint` carrying the innate elemental bonus, plus a
`Recipes` / `PendingRecipes` entry while it is being built. **[INFERRED from V-SNS]**

### Ephemera — "complete"

Ephemera are `WeaponSkins`-style skins added via `addSkin(inventory, profile.ephemera)`, and
**"Players will receive a Lich's Ephemera regardless of whether they Vanquish or Convert them."**
**[V-SNS]** (comment + code).

Ephemera are keyed by the adversary's **innate damage tag**, 7 per faction **[V-SNS]**:

| Damage tag | Kuva | Corpus (Sister) |
|---|---|---|
| InnateElectricityDamage | `KuvaLightningEphemera` | `CorpusLichEphemeraA` |
| InnateHeatDamage | `KuvaFireEphemera` | `CorpusLichEphemeraB` |
| InnateFreezeDamage | `KuvaIceEphemera` | `CorpusLichEphemeraC` |
| InnateToxinDamage | `KuvaToxinEphemera` | `CorpusLichEphemeraD` |
| InnateMagDamage | `KuvaMagneticEphemera` | `CorpusLichEphemeraE` |
| InnateRadDamage | `KuvaTricksterEphemera` | `CorpusLichEphemeraF` |
| InnateImpactDamage | `KuvaImpactEphemera` | `CorpusLichEphemeraG` |

Drop chance per adversary: Kuva `ephemeraChance` 0.05 → 0.1 → **0.2**; Corpus **0.2**;
Infested/Coda **0** (`ephemeraChance = 0`, no `ephemeraTypes`). **[V-SNS]** So **Coda have no
ephemera** in SNS's model.

**"Ephemera collection complete" = own all 7 Kuva + all 7 Corpus = 14 skins** in `WeaponSkins`.
**[INFERRED from V-SNS]**

### One-time badges/sigils

First vanquish / first convert per faction **[V-SNS]**:
- Kuva: `LichKillerBadgeItem` (kill) / `KuvaLichSigil` (convert)
- Corpus: `CorpusLichBadgeItem` / `CorpusLichSigil`
- Infested: `InfLichVanquishedSigil` / `InfLichConvertedSigil`

### Parazon / Requiem

`Nemesis.Hints`, `GuessHistory`, `HintProgress`, `HenchmenKilled` drive the murmur/passcode loop.
Passcode is derived deterministically from `fp` (`getNemesisPasscode`), 3 symbols for Grineer/Corpus,
**1 symbol for Infested/Coda**. Infested use `AntivirusOneMod..AntivirusEightMod` instead of Requiem
mods. Guess encoding: symbols 0–7 normal, `8 = GUESS_NONE`, `9 = GUESS_WILDCARD`; results
`0 = neutral, 1 = incorrect, 2 = correct`, packed with `encodeNemesisGuess`. **[V-SNS]**

### Repeatable / gated

Fully repeatable, no time gate. `LastNemesisAllySpawnTime` gates ally (converted-lich) spawns.
Converted adversaries can be assigned as Railjack crew (`SecondInCommand` = "on call").

---

## 6. Nightwave

### Fields

```ts
SeasonChallengeHistory: { challenge: string; id: string }[]
ChallengeProgress: { Name: string; Progress: number; Completed?: string[];
                     ReceivedJunctionReward?: boolean }[]
Affiliations: [ ..., { Tag: "RadioLegionIntermission16Syndicate", Standing, Title } ]
```
**[V-SNS]**

Writer:
```ts
case "SeasonChallengeCompletions": {
    const processedCompletions = value.map(({ challenge, id }) => ({
        challenge: challenge.substring(challenge.lastIndexOf("/") + 1),   // path is stripped!
        id
    }));
    inventory.SeasonChallengeHistory.push(...processedCompletions);
}
```
**[V-SNS]** — so `SeasonChallengeHistory[].challenge` is the **short name only** (last path segment),
and entries are **appended without dedup**. Match against worldState `SeasonInfo.ActiveChallenges[].Challenge`
by trailing segment.

In-progress (not yet completed) acts live in `ChallengeProgress` by `Name`. **[V-SNS]**

### Current season (live)

**[V-LIVE]** `https://api.warframestat.us/pc/nightwave`:
```
season: 18, tag: "RadioLegionIntermission16Syndicate",
activation: 2026-08-12T15:30:00Z, expiry: 2027-03-08T00:00:00Z, phase: 0
```
SNS names it **"Amir's Shockwave"** in `nightwaveTagToSeason`. **[V-SNS]**

Full tag→season map **[V-SNS]** (`worldStateService.ts`):

| Tag | Season | Name |
|---|---|---|
| `RadioLegionSyndicate` | 0 | The Wolf of Saturn Six |
| `RadioLegionIntermissionSyndicate` | 1 | Intermission I |
| `RadioLegion2Syndicate` | 2 | The Emissary |
| `RadioLegionIntermission2Syndicate` | 3 | Intermission II |
| `RadioLegion3Syndicate` | 4 | Glassmaker |
| `RadioLegionIntermission3Syndicate` | 5 | Intermission III |
| `RadioLegionIntermission4Syndicate` | 6 | Nora's Choice |
| `RadioLegionIntermission5..15Syndicate` | 7..17 | Nora's Mix Vol. 1 … Time Tempests |
| `RadioLegionIntermission16Syndicate` | **18** | **Amir's Shockwave** |

### Rank cap

- **30 main ranks, 10,000 standing each.** **[V-WIKI]** (`Nightwave` raw: *"30 ranks (15 during
  Intermission I)"*, *"each level requiring 10,000 to level up"*).
- Prestige ranks beyond 30: *"The amount of prestige ranks varies between Series."* **[V-WIKI]**
- **[V-EXP]** confirms per-season caps from `ExportSyndicates.json`:
  `RadioLegionIntermission5..15Syndicate` → **max title 180**, top `maxStanding` 1,810,000
  (180 × 10,000 + 10,000 buffer). `RadioLegion3Syndicate` (Glassmaker) → 210.
  `RadioLegionIntermission2/3` → 90. `RadioLegionSyndicate`/`RadioLegion2Syndicate` → 60.
  `RadioLegionIntermissionSyndicate` → 15.
- ⚠️ **`RadioLegionIntermission16Syndicate` (the current season) is NOT in
  `ExportSyndicates.json` 0.6.8** — that export predates the season. Its rank cap is **[UNKNOWN]**;
  180 is the pattern for every Nora's Mix season since Vol. 1, so 180 is a reasonable **[INFERRED]**
  default, but read it from the live syndicate data if you can.

### Standing per act **[V-WIKI]**

Daily 1,000 · Weekly 4,500 · Elite Weekly 7,000. Prestige rank-up awards 15 Nightwave Creds.

### Time gates

- Nightwave standing bin is `STANDING_LIMIT_BIN_NONE` → **no daily cap**. **[V-EXP]**+**[V-SNS]**
- Daily acts roll every 24h; weekly/elite weekly roll weekly (worldState
  `SeasonInfo.ActiveChallenges` with `Activation`/`Expiry`). **[V-SNS]** (`getSeasonDailyChallenge`,
  `pushWeeklyActs`).
- Season expiry is in `SeasonInfo.Expiry`; unclaimed rank rewards are lost at season end.
- SNS keeps a cheat `nightwaveStandingMultiplier` — irrelevant to live, ignore.

### "Complete"

Rank 30 (all reward-bearing ranks claimed) + as many prestige ranks as the season offers. There is
**no inventory field that says "season fully complete"** — you must compute it from
`Affiliations[tag].Title` vs the season's max title. **[INFERRED]**

---

## 7. Simaris / Codex scans

### ⚠️ The single biggest gotcha: enemy/object codex scans are NOT in the inventory

`unlockAllScansController.ts` **[V-SNS]**:
```ts
const [stats, inventory] = await Promise.all([getStats(accountId), getInventory(...)]);
stats.Scans = [];
for (const type of scanTypes) { stats.Scans.push({ type, scans: 9999 }); }
```
`Scans` lives on the **player stats document** (the `/stats/view.php` profile record), *not* on the
inventory. **If `match_info.inventory` is a pure `inventory.php` dump, per-enemy codex scan counts
will not be in it.** Plan for a separate source or mark that panel unavailable. **[V-SNS]**

### What IS in the inventory

```ts
LibraryPersonalTarget?: string;              // currently-selected Simaris synthesis target
LibraryPersonalProgress: { TargetType: string; Scans: number; Completed: boolean }[]
LibraryAvailableDailyTaskInfo?: ILibraryDailyTaskInfo;
LibraryActiveDailyTaskInfo?:   ILibraryDailyTaskInfo;
LoreFragmentScans: { ItemType: string; Progress: number; Region: string }[]
CollectibleSeries?: { CollectibleType: string; Count: number; Tracking: string;
                      ReqScans: number; IncentiveStates: {threshold,complete,sent}[] }[]
```
**[V-SNS]**

```ts
interface ILibraryDailyTaskInfo {
    EnemyTypes: string[]; EnemyLocTag: string; EnemyIcon: string;
    Scans?: number; ScansRequired: number;
    RewardStoreItem: string; RewardQuantity: number; RewardStanding: number;
}
```

### Simaris synthesis targets ("research")

`unlockAllSimarisResearchEntriesController.ts` **[V-SNS]** writes:
```ts
LibraryPersonalProgress = ["Research1Target" … "Research7Target"]
    .map(type => ({ TargetType: type, Scans: 10, Completed: true }));
```
→ **7 research targets, 10 scans each**, plus the quest target
`/Lotus/Types/Game/Library/Targets/DragonframeQuestTarget` (Chroma quest) which
`startLibraryPersonalTargetController` flags with `IsQuest: true`. **[V-SNS]**

However `src/constants/synthesis.ts` maps **`Research1Target` … `Research10Target`** to avatars.
**[V-SNS]** So the target pool may be 10 rather than 7; SNS's "unlock all" helper only fills 7.
**Treat "7 vs 10" as [UNKNOWN]; count `LibraryPersonalProgress` entries with `Completed: true`
and don't hard-code a denominator.**

### Daily Simaris task

`startLibraryDailyTaskController` copies `LibraryAvailableDailyTaskInfo → LibraryActiveDailyTaskInfo`;
`claimLibraryDailyTaskRewardController` clears both, adds `RewardStanding` to `LibrarySyndicate`, and
grants `rewardEndo * RewardQuantity` FusionPoints (80 endo if the reward is `RareFusionBundle`, else
50). A new `LibraryAvailableDailyTaskInfo` is minted in the **daily 00:00 UTC reset**
(`createLibraryDailyTask(buildLabel)`). **[V-SNS]**

There is also `abandonLibraryDailyTaskController`. **[V-SNS]**

### Fragments / collectibles — countable completion

`ExportCodex.json` **[V-EXP]** (v0.6.8):

| Bucket | Count | Where it lands |
|---|---|---|
| `loreFragments` | **179** (each has `reqScans`, commonly 3) | `LoreFragmentScans` |
| `songs` | **86** (`reqScans` e.g. 4) | `LoreFragmentScans` |
| `fighterFrames` | **44** (`reqScans` 1) | `LoreFragmentScans` |
| `objects` | **169** | **stats.Scans**, not inventory |

`CollectibleSeries` known series **[V-SNS]** (from `unlockAllScansController`):

| `CollectibleType` | `ReqScans` | What |
|---|---|---|
| `/Lotus/Objects/Orokin/Props/CollectibleSeriesOne` | **56** | Kuria |
| `/Lotus/Types/Lore/Fragments/DuviriFragments/DuviriCollectibleDeco` | **90** | Duviri fragments |
| `/Lotus/Types/Lore/Fragments/DuviriMITWFragments/DuviriMITWCollectibleDeco` | **15** | Isleweaver fragments |

`Tracking` is a **per-item bitstring of "0"/"1" characters** — SNS writes 90 chars of `1` to mark a
series complete. Kuria/Isleweaver carry `IncentiveStates` at thresholds `0.5` and `0.75`. **[V-SNS]**

Also inventory-side and completionist-relevant: `isEligibleForThousandYearFishDeco()` requires all
five `EidolonFragmentA..E` in `LoreFragmentScans`; `receivedThousandYearFishDeco` is an SNS-internal
boolean (**not** on the client type). **[V-SNS]**

### "Complete"

- Simaris standing/offerings: standing caps at 125,000; no ranks. **[V-SNS]**
- Synthesis targets: all `LibraryPersonalProgress[].Completed == true`.
- Fragments: for each `ExportCodex` entry, `LoreFragmentScans[type].Progress >= reqScans`.
- Full enemy codex: **not determinable from inventory**. **[V-SNS]**

### Time gates

Daily Simaris task (00:00 UTC). Simaris standing daily cap = `DailyAffiliationLibrary`.
Synthesis target selection is one-at-a-time (`LibraryPersonalTarget`) but re-selectable.

---

## 8. Invasions, Sorties, Archon Hunts, Arbitrations, Duviri, Netracells, Deep Archimedea

### Invasions — repeatable, no calendar gate

```ts
QualifyingInvasions: { _id: IOid; Delta: number; AttackerScore: number; DefenderScore: number }[]
FactionScores: number[]
DeathMarks: string[]
```
**[V-SNS]** Progress accumulates per invasion `_id`; the client sends `InvasionProgress` deltas which
SNS sums into `QualifyingInvasions`. Siding with one faction 3× completes your share (SNS's
`finishInvasionsInOneMission` cheat multiplies each delta by 3, which pins the intended run count at
**3**). **[INFERRED from V-SNS]**

Side-effect worth surfacing: siding against a faction accumulates death-squad points and, at **≥ 5**,
sets a death mark and mails you (`DeathMarks`, Grineer/Corpus death squads). **[V-SNS]**

### Sorties — **daily**

```ts
CompletedSorties: string[]                                   // sortie instance IDs
LastSortieReward?: { SortieId: IOid; StoreItem: string; Manifest: string }[]
SortieRewardAttenuation?: { Tag: string; Atten: number }[]    // pity/duplicate protection
```
**[V-SNS]** Written from `RewardInfo.sortieId` (format `<node>_<sortieId>`), manifest
`/Lotus/Types/Game/MissionDecks/SortieRewards`. Sorties cycle daily at **16:00 or 17:00 UTC depending
on London DST** (SNS comment: *"Sortie & syndicate missions cycling every day (at 16:00 or 17:00 UTC
depending on if London, OT is observing DST)"*). **[V-SNS]**

"Done today" = current sortie's id present in `CompletedSorties`.

### Archon Hunts — **weekly**

```ts
LastLiteSortieReward?: { SortieId; StoreItem; Manifest }[]
```
**[V-SNS]** Archon Hunts are "Lite Sorties": `RewardInfo.sortieId` of form `<node>_Lite_<weekId>`;
`getLiteSortie(week)` in worldState. Completion also pushes into `CompletedSorties` (same
`SortieId` case handler). **[V-SNS]**

### Arbitrations — **explicit gap**

Grepping SNS `main` for `Arbitration`/`arbitration` returns **zero hits** outside unrelated
`ArbitersSyndicate` and the SNS `arbiter` HTTP namespace (which is matchmaking, not the game mode).
**There is no dedicated arbitration field in the inventory type.** Arbitration participation is only
visible indirectly: node completes in `Missions`, and **Vitus Essence** accumulating in `MiscItems`.
Arbitrations rotate hourly (worldState-driven). **[V-SNS] negative result / [UNKNOWN]** for any
per-arbitration record.

### Duviri

```ts
DuviriInfo?: { Seed: bigint; NumCompletions: number }
```
**[V-SNS]** `Seed` regenerates and `NumCompletions` increments on every non-quit completion of a
Duviri game mode (`duviriCaveOffers` handler). Steel Path Duviri is `mission.Tier == 1`; Undercroft
side-portal rotations use `RewardInfo.T` values 13 (normal) / 14 (Steel Path); Kullervo is `T == 15`;
Murmur chests `T == 17 / 19`; Orowyrm chest `T == 70` or `6` giving 10 Pathos Clamps (15 on Steel
Path). **[V-SNS]** The Duviri "circuit" side is §10.

### Netracells — **weekly, 5 runs**

```ts
EntratiVaultCountLastPeriod?: number;    // search pulses SPENT this week (counts UP)
EntratiVaultCountResetDate?: IMongoDate; // when the week's allowance resets
```
**[V-SNS]** `updateEntratiVault()`:
```ts
if (!EntratiVaultCountResetDate || now >= EntratiVaultCountResetDate) {
    const EPOCH = 1734307200 * 1000;          // Monday
    const week = trunc(trunc((now-EPOCH)/86400000)/7);
    EntratiVaultCountLastPeriod = 0;
    EntratiVaultCountResetDate = new Date(EPOCH + week*604800000 + 604800000);
    // ...and the two Conquest states are cleared
}
```
`EntratiVaultCountLastPeriod += 1` per Netracell reward container collected. **[V-SNS]**

**[V-WIKI]** (`Search Pulse` raw): *"players get 5 of every week"*, *"The pulses all players have are
refreshed every Monday 0:00 UTC."*, Netracell *"consumes 1 Search Pulse upon the completion of the
mission"*, Deep Archimedea *"consumes 2 Search Pulse to be playable for that duration of the week."*

So: **remaining pulses = 5 − `EntratiVaultCountLastPeriod`**, reset Monday 00:00 UTC. Note SNS's
EPOCH `1734307200` = 2024-12-16 00:00 UTC, a Monday. **[V-SNS]**

### Deep Archimedea (Cavia) & Temporal Archimedea (Hex) — **weekly**

```ts
EntratiLabConquestUnlocked?: number;            // 1 once bought this week
EntratiLabConquestHardModeStatus?: number;
EntratiLabConquestCacheScoreMission?: number;   // score progress
EntratiLabConquestActiveFrameVariants?: string[];

EchoesHexConquestUnlocked?: number;             // Temporal Archimedea
EchoesHexConquestHardModeStatus?: number;
EchoesHexConquestCacheScoreMission?: number;
EchoesHexConquestActiveFrameVariants?: string[];
EchoesHexConquestActiveStickers?: string[];
```
**[V-SNS]** `entratiLabConquestModeController.ts`: `BuyMode` does
`EntratiVaultCountLastPeriod += 2` then sets the relevant `*Unlocked = 1` — matching the wiki's
"2 Search Pulses". All conquest state is cleared by the same weekly `updateEntratiVault()` reset.
**[V-SNS]**

Conquest generation (worldState side, `conquestService.ts`): `CT_LAB` (Deep Archimedea, faction
`FC_MITW`) and `CT_HEX` (Temporal Archimedea, factions `FC_SCALDRA`/`FC_TECHROT`, plus a
`CalendarSeasonType` of `CST_WINTER/SPRING/SUMMER/FALL` cycling `week % 4`). Difficulty modifiers are
`deviations` + `risks`. **[V-SNS]**

Reward thresholds for Deep Archimedea (score `at`) **[V-SNS]**: 5, 10, 15, 20, 28, 31, 34, 37 —
with Entrati Lanthorn ×3 at 15, Distill Points ×20 at 28 and ×50 at 37.

### Other weekly/periodic things visible in inventory (bonus)

- `PeriodicMissionCompletions: {tag, date, count?}[]` — Steel Path incursions (`HardDaily*`), Kuva
  Siphon/Flood (`KuvaMission*`), Elite Alerts (`EliteAlert`, `EliteAlertB`), Treasure Hunts. **[V-SNS]**
- `DescentRewards: { Category: "DM_COH_NORMAL"|"DM_COH_HARD"; Expiry; FloorClaimed; PendingRewards;
  Seed; SelectedUpgrades }[]` — the newer weekly **Descent** mode (`MT_DESCENT`, 4 nodes in
  `ExportRegions`). **[V-SNS]** + **[V-EXP]**
- `CalendarProgress: { Version, Iteration, YearProgress:{Upgrades}, SeasonProgress:{ SeasonType,
  LastCompletedDayIdx, LastCompletedChallengeDayIdx, ActivatedChallenges } }` — the 1999 Kalymos
  calendar; season cycles weekly, `YearIteration` every 4 weeks. **[V-SNS]**
- `DialogueHistory: { YearIteration?, ResetDates?: {Date, Pack:"Hex"|"Roundtable"|"Triad", Resets}[],
  Dialogues?: { DialogueName, Rank, Chemistry, AvailableDate, AvailableGiftDate, RankUpExpiry,
  BountyChemExpiry, Gifts, Booleans, Counters, Completed }[] }` — 1999 Hex chemistry/romance.
  Rank/Chemistry caps are **[UNKNOWN]** (SNS enforces none server-side).
- `BlessingCooldown?: IMongoDate` — relay blessing. `TradesRemaining` = MR (+2 founder), daily.
  `GiftsRemaining` = `max(8, MR)`, daily. **[V-SNS]**
- `WeeklyGuildVaultBonusInfo` — weekly clan vault bonus. `LoginMilestoneRewards: string[]` — daily
  tribute milestones. `UsedDailyDeals: string[]` — Darvo, cleared on the daily reset (26-hour Darvo
  cycle handled specially). **[V-SNS]**
- Argon Crystal decay is processed in the same daily block (half of non-`FoundToday` crystals per
  elapsed day); `FoundToday: IMiscItem[]` holds today's protected finds. **[V-SNS]**

---

## 9. Railjack

### Fields

```ts
CrewShips: IEquipmentClient[]           // your Railjack(s)
CrewShipHarnesses: IEquipmentClient[]
CrewShipWeapons: IEquipmentClient[]           // built armaments
CrewShipSalvagedWeapons: IEquipmentClient[]   // un-identified salvage
CrewShipWeaponSkins: IUpgradeClient[]         // components (reactor/engines/shield/plating)
CrewShipSalvagedWeaponSkins: IUpgradeClient[] // un-identified component salvage
CrewShipAmmo: ITypeCount[]
CrewShipRawSalvage: ITypeCount[]
CrewShipFusionPoints: number                  // Dirac (pre-rework)
CrewMembers: ICrewMemberClient[]
PersonalTechProjects: IPersonalTechProjectClient[]   // Railjack research
Drones: { ItemType, CurrentHP, ItemId, RepairStart? }[]
PlayerSkills: { LPP_SPACE, LPS_* }                    // see §2
CrewShipSalvageBin: ISlots     // default Slots: 8
CrewMemberBin: ISlots          // default Slots: 3
```
**[V-SNS]** `inventoryTypes.ts` + `inventoryModel.ts`.

```ts
interface ICrewMemberClient {
    ItemType: string;
    NemesisFingerprint: bigint;   // links a converted lich crewmate to NemesisHistory[].fp
    Seed: bigint;
    AssignedRole?: number;
    SkillEfficiency: { PILOTING, GUNNERY, ENGINEERING, COMBAT, SURVIVABILITY: {Assigned:number} };
    WeaponConfigIdx: number; WeaponId: IOid; XP: number;
    PowersuitType?: string; Configs: IItemConfig[];
    SecondInCommand: boolean;     // "on call" slot
    ItemId: IOid;
}
```
**[V-SNS]** Note: a **converted adversary used as crew** is *not* in `CrewMembers` — it stays in
`NemesisHistory` with `SecondInCommand` toggled there. `crewMembersController` special-cases
`ItemId.$oid == "000000000000000000000000"` and looks the entry up in `NemesisHistory` by
`NemesisFingerprint`. **[V-SNS]** Any "crew roster" UI must union both arrays.

### Research

```ts
interface IPersonalTechProjectClient {
    State: number; ReqCredits: number; ItemType: string;
    ProductCategory?: string; CategoryItemId?: IOid;
    ReqItems: ITypeCount[]; HasContributions?: boolean;
    CompletionDate?: IMongoDate; ItemId: IOid;
}
```
**[V-SNS]** Driven by `guildTechController` with `Mode: "Personal"`, resolving recipes from
`ExportDojoRecipes.research` (a recipe is "personal" iff it has a `resultType`). Completed research
is **removed** from `PersonalTechProjects` when claimed — so this array is a *work-in-progress
queue*, not a research-completion ledger. **[V-SNS]** Ownership of researched items must be read from
the resulting `CrewShipWeapons` / `CrewShipWeaponSkins` / `Recipes` entries. **[INFERRED]**

### What "complete" means

There is **no single Railjack completion flag**. A completionist definition has to be assembled:
1. Intrinsics: all five `LPS_*` (Railjack) at 10 (§2).
2. Star chart: all `MT_RAILJACK` nodes present in `Missions`; Steel Path = `Tier == 1` on the
   qualifying subset (excludes `systemIndex == 6`, `hidden`, `maxEnemyLevel == 1`) → the **DeepSpace**
   trophy at pseudo-system index 20 (§4). **[V-SNS]**
3. Armaments/components: own every House (Zetki/Vidar/Lavan) variant — enumerate from
   `ExportRailjackWeapons.json` in the community export (present, 300,586 bytes; **not parsed in this
   pass — contents [UNKNOWN]**).
4. Crew: `CrewMemberBin.Slots` default 3; crew are Ticker-hired (`CrewmateBall` at Command 9) or
   converted liches.
5. Dirac/Avionics: `CrewShipFusionPoints` is legacy pre-rework Dirac. **[V-SNS]**

`ExportRegions` has **44 `MT_RAILJACK` nodes** in the 0.6.8 community export. **[V-EXP]**

### Time gates

None. Repair drones (`Drones` with `RepairStart`) and research (`CompletionDate`) are build timers,
not calendar gates.

---

## 10. Incarnon adapters / Steel Path Circuit

### How owned Incarnon Genesis appears

Three distinct signals **[V-SNS]** (`evolveWeaponController.ts`):

1. **The un-installed adapter** is a `MiscItems` entry, e.g.
   `/Lotus/Types/Items/MiscItems/IncarnonAdapters/Primary/BratonIncarnonUnlocker`
   (store form `/Lotus/StoreItems/Types/Items/MiscItems/IncarnonAdapters/...`).
2. **Installed on a weapon**: that weapon's `IEquipmentClient` gets
   `Features |= 512` (`eEquipmentFeatures.INCARNON_GENESIS`) and `SkillTree` set (initially `"0"`).
   `SkillTree` is an opaque string written by `setWeaponSkillTreeController` — it encodes the chosen
   evolution perks. Uninstalling clears the bit (`Features &= ~512`) and returns the unlocker to
   `MiscItems`.
3. **Evolution rank**: a row in
   ```ts
   EvolutionProgress?: { ItemType: string; Rank: number; Progress: number }[]
   ```
   keyed by the **base weapon path** (e.g. `/Lotus/Weapons/Tenno/ThrowingWeapons/StalkerKunai`),
   created at `{Progress: 0, Rank: 1}` on install. **[V-SNS]**

Full `eEquipmentFeatures` bitfield for context **[V-SNS]**:
`DOUBLE_CAPACITY 1 · UTILITY_SLOT 2 · GRAVIMAG_INSTALLED 4 · GILDED 8 · ARCANE_SLOT 32 ·
SECOND_ARCANE_SLOT 64 · INCARNON_GENESIS 512 · VALENCE_SWAP 1024`.

Weapons *eligible* for an adapter are enumerated in SNS `src/constants/evolutionWeapons.ts`
(`evolutionWeapons` set) with a sub-set `permanentEvolutionWeapons` (Zariman/Entrati weapons whose
Incarnon form is innate and cannot be uninstalled — Phenmor, Laetum, Innodem, Praedos, Ruvox, etc.).
**[V-SNS]**

### The Steel Path Circuit — weekly progress fields

```ts
EndlessXP?: {
    Category: "EXC_NORMAL" | "EXC_HARD";
    Earn: number;              // total circuit XP earned this week
    Claim: number;             // XP level up to which rewards have been claimed
    BonusAvailable?: IMongoDate;
    Expiry?: IMongoDate;       // week end
    Choices: string[];         // this week's 3 (normal) or 5 (hard) picks
    PendingRewards: { RequiredTotalXp: number; Rewards: ICountedStoreItem[] }[];
}[]
```
**[V-SNS]** `endlessXpController.ts` (`Mode:"r"` resets/rerolls, `Mode:"c"` claims). Week boundary:
```ts
const weekStart = 1734307200_000 + trunc((Date.now()-1734307200_000)/604800000)*604800000;
```
→ **Monday 00:00 UTC**, same epoch as Netracells. **[V-SNS]** Cross-checked **[V-WIKI]**
(`The Circuit` raw): *"Tier rewards can only be claimed once per week. Weekly reward pools reset on
Monday 0:00 UTC."*

Circuit XP earned per run (`SolNode238`) **[V-SNS]**:
round 1 → +100, round 2 → +110, round 3 → +125, round 4 → +145 **plus a +50 daily bonus** if
`BonusAvailable <= now` (then `BonusAvailable = now + 24h`), rounds 5+ → +170 each.
Category is `EXC_HARD` iff `mission.Tier == 1`.

Steel Path tier thresholds (`RequiredTotalXp`) **[V-SNS]**, byte-for-byte matching **[V-WIKI]**:
```
285, 600, 945, 1335, 1785, 2310, 2925, 3645, 4485, 5460
```
Tiers **5 and 10** (1785 and 5460) are the two **chosen** rewards → `hardModeChosenRewards[Choices[0]]`
and `[Choices[1]]`. The rest roll from
`DuviriEndlessSteelPath{Silver,Gold,Arcane,SteelEssence}Rewards`. **[V-SNS]**
**[V-WIKI]** normal-mode cumulative thresholds: 190, 400, 630, 890, 1190, 1540, 1950, 2430, 2990,
3640, then +900/tier; Steel Path +1,400/tier past 10.

### The rotation — full, from SNS's worldState generator

`getEndlessXpChoices(week, buildVersion)` **[V-SNS]** — this is SNS reproducing DE's
`EndlessXpChoices` / `EndlessXpSchedule`, selected as `array[week % array.length]`.

**Steel Path (`EXC_HARD`) — 9 weeks × 5 adapters = 45**, matching **[V-WIKI]** *"9 weeks (labeled A
through I), with 5 Incarnon Genesis Adapters available each week"*:

| Wk | Adapters |
|---|---|
| A | Boar, Gammacor, Angstrum, Gorgon, Anku |
| B | Bo, Latron, Furis, Furax, Strun |
| C | Lex, Magistar, Boltor, Bronco, Ceramic Dagger |
| D | Torid, Dual Toxocyst, Dual Ichor, Miter, Atomos |
| E | Ack & Brunt, Soma, Vasto, Nami Solo, Burston |
| F | Zylok, Sibear, Dread, Despair, Hate |
| G | Dera, Sybaris, Cestra, Sicarus, Okina |
| H | Vectis, Stug, Ballistica, Destreza, Obex  *(added at build ≥ 43.0.0)* |
| I | Braton, Lato, Skana, Paris, Kunai |

Item paths for all 45 are in `hardModeChosenRewards` in `endlessXpController.ts`, of form
`/Lotus/StoreItems/Types/Items/MiscItems/IncarnonAdapters/{Primary|Secondary|Melee}/<Name>IncarnonUnlocker`.
**[V-SNS]** Plus 4 non-adapter picks: `RivenPrimary` → `RawRifleRandomMod`, `RivenSecondary` →
`RawPistolRandomMod`, `RivenMelee` → `RawMeleeRandomMod`, `Kuva` →
`/Lotus/Types/Game/DuviriEndless/CircuitSteelPathBIGKuvaReward`. These are only offered *"If the
player has Drifter Intrinsics Opportunity Rank 9"* **[V-WIKI]** (and, in practice, once you already
own the week's adapters).

**Normal (`EXC_NORMAL`) — 11 weeks × 3 warframes = 33** **[V-SNS]**:

| Wk | Warframes |
|---|---|
| 1 | Nidus, Octavia, Harrow |
| 2 | Gara, Khora, Revenant |
| 3 | Garuda, Baruuk, Hildryn |
| 4 | Excalibur, Trinity, Ember |
| 5 | Loki, Mag, Rhino |
| 6 | Ash, Frost, Nyx |
| 7 | Saryn, Vauban, Nova |
| 8 | Nekros, Valkyr, Oberon |
| 9 | Hydroid, Mirage, Limbo |
| 10 | Mesa, Chroma, Atlas |
| 11 | Ivara, Inaros, Titania |

Normal-mode chosen rewards are 5-step warframe part chains (Helmet BP, Chassis BP, an ability
augment, Systems BP, main BP) — see `normalModeChosenRewards`. **[V-SNS]**

⚠️ The `week` index is SNS's own `trunc((now − EPOCH)/604800000)` with EPOCH 2024-12-16. **Whether
DE's live rotation is phase-aligned to that same epoch is [UNKNOWN]** — derive the current week from
live worldState `EndlessXpSchedule`/`EndlessXpChoices` rather than computing it, if you can reach it.

### What "complete" means

- **All 45 Circuit adapters owned**: for each of the 45 base weapons, either the unlocker is in
  `MiscItems` or an `EvolutionProgress` row exists for that base weapon path.
- **Every Incarnon fully evolved**: `EvolutionProgress[].Rank` at max for each. The max Rank value is
  **[UNKNOWN]** from the sources checked (SNS just mirrors the client's `Rank`; the in-game UI shows
  5 evolution stages, but I did not verify a numeric cap in any primary source).
- Beyond the Circuit there are non-Circuit Incarnon weapons (Zariman/Entrati `permanentEvolutionWeapons`,
  and adapters from other sources) — those also appear in `EvolutionProgress`. The complete universe
  of Incarnon-capable weapons per SNS is `evolutionWeapons` = **45 own entries + the 8
  `permanentEvolutionWeapons` = 53 total** (counted from the file). **[V-SNS]**

---

## Quick field index (for the overlay's parser)

| Subsystem | Primary field(s) | Cadence |
|---|---|---|
| Focus | `FocusXP`, `FocusUpgrades`, `FocusAbility`, `DailyFocus` | daily cap, 00:00 UTC |
| Intrinsics | `PlayerSkills` | none |
| Syndicates | `Affiliations`, `DailyAffiliation*` (14) | daily cap, 00:00 UTC |
| Syndicate missions | `CompletedSyndicates` | daily (16:00/17:00 UTC) |
| Star chart / Steel Path | `Missions[].Completes` / `Missions[].Tier` | one-off |
| SP unlock | `NodeIntrosCompleted` ∋ `TeshinHardModeUnlocked` | one-off |
| SP incursions | `PeriodicMissionCompletions` (`HardDaily*`) | daily |
| Liches/Sisters/Coda | `Nemesis`, `NemesisHistory` | none |
| Nightwave | `SeasonChallengeHistory`, `ChallengeProgress`, `Affiliations[RadioLegion*]` | daily + weekly acts |
| Simaris | `LibraryPersonalTarget/Progress`, `Library*DailyTaskInfo` | daily task |
| Fragments | `LoreFragmentScans`, `CollectibleSeries` | one-off |
| Codex enemy scans | **stats.Scans — NOT in inventory** | — |
| Invasions | `QualifyingInvasions`, `FactionScores`, `DeathMarks` | rolling |
| Sorties | `CompletedSorties`, `LastSortieReward`, `SortieRewardAttenuation` | daily |
| Archon Hunts | `LastLiteSortieReward` (+ `CompletedSorties`) | weekly |
| Arbitrations | **none** (Vitus Essence in `MiscItems`) | hourly rotation |
| Duviri | `DuviriInfo` | rolling |
| Netracells | `EntratiVaultCountLastPeriod` / `EntratiVaultCountResetDate` | weekly, 5/wk, Mon 00:00 UTC |
| Deep/Temporal Archimedea | `EntratiLabConquest*` / `EchoesHexConquest*` | weekly, costs 2 pulses |
| Descent | `DescentRewards` | weekly |
| Railjack | `CrewShips`, `CrewShip*`, `CrewMembers`, `PersonalTechProjects` | none |
| Circuit / Incarnon | `EndlessXP`, `EvolutionProgress`, `MiscItems` (unlockers), `Features & 512` | weekly, Mon 00:00 UTC |
| 1999 calendar | `CalendarProgress` | weekly season, 4-week year |
| Hex chemistry | `DialogueHistory` | daily/weekly gift & rank timers |

---

## Honest gaps (do not fill these with guesses)

1. **Coda (Infested lich) weapon list** — SNS ships `weapons = []` for `InfestedLichManifest`. Not
   recoverable from anything I fetched.
2. **Tauron Strike** — real per the wiki, but absent from `ExportFocusUpgrades.json` 0.6.8 and from
   SNS. Its inventory representation is unknown. Wiki's own resource totals for it are
   self-contradictory (114/162/89 vs 864/912/839).
3. **Max `EvolutionProgress.Rank`** for Incarnon evolutions — not verified numerically anywhere.
4. **Steel Path incursion tag names** (`HardDaily*` suffixes) — SNS only matches the prefix.
5. **Nightwave season 18 rank cap** — `RadioLegionIntermission16Syndicate` postdates export 0.6.8.
   180 is the pattern, not a verified fact.
6. **Simaris research target count** — SNS's "unlock all" uses 7; `synthesis.ts` maps 10.
7. **Codex enemy/object scan counts** — confirmed to live on the *stats* document, not the inventory.
   If `match_info.inventory` really is inventory-only, this panel has no data source.
8. **`ExportRailjackWeapons.json`** — present in the community export (300 KB) but not parsed in this
   pass; the House/variant universe for Railjack armaments is therefore unenumerated here.
9. **Live `EndlessXpChoices` phase alignment** vs SNS's 2024-12-16 epoch — unverified.
10. **`DialogueHistory` Rank/Chemistry caps** — no server-side cap in SNS; client-side values unknown.
11. **`https://content.warframe.com/dynamic/worldState.php` returns 404** as of 2026-08-31. If the app
    needs live worldState (it does, for daily/weekly instance IDs), the endpoint has moved and needs
    rediscovery; `api.warframestat.us` works as a mirror but is third-party.
