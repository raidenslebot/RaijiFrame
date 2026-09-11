# Mastery Rank Accounting & Honest "% Complete"

Research brief for the Warframe Overwolf companion app.
Compiled **2026-08-31**. Wiki data as of **Update 42.0 (2026-03-25)**; DE PublicExport pulled live 2026-08-31.

**Evidence key** — every claim is tagged:

- **[V] VERIFIED** — I fetched the source and read the actual bytes. URL given.
- **[I] INFERRED** — derived arithmetically from a [V] source; the derivation is shown.
- **[GAP] NOT VERIFIED** — stated as an open question, never as a fact.

## Primary sources actually fetched

| Source | URL | What it gave |
|---|---|---|
| Wiki raw wikitext — Mastery Rank | `https://wiki.warframe.com/index.php?title=Mastery_Rank&action=raw` | rank table, per-source mastery rules, live module args |
| Wiki raw Lua — Module:MasteryRank | `https://wiki.warframe.com/index.php?title=Module:MasteryRank&action=raw` | `getRankXP`, `getXPRank`, `baseMasteryXp`, `RankForties` |
| Wiki raw wikitext — Affinity | `https://wiki.warframe.com/index.php?title=Affinity&action=raw` | affinity-per-rank curves, multi-Forma cumulative totals |
| Wiki raw Lua — Module:Missions/data | `https://wiki.warframe.com/index.php?title=Module:Missions/data&action=raw` | `MasteryExp` per SolNode (357 entries) |
| Wiki raw — Hidden Mastery | `https://wiki.warframe.com/index.php?title=Hidden_Mastery&action=raw` | items hidden from profile that still grant mastery |
| Wiki raw — Exclusive Mastery | `https://wiki.warframe.com/index.php?title=Exclusive_Mastery&action=raw` | limited/retired item lists |
| Wiki template expander (live compute) | `https://wiki.warframe.com/api.php?action=expandtemplates&prop=wikitext&text=...buildMasteryTable...` | the actual total-mastery numbers |
| DE PublicExport | `https://content.warframe.com/PublicExport/index_en.txt.lzma` + `/Manifest/<file>!<hash>` | `masteryReq`, `productCategory`, `maxLevelCap`, `excludeFromCodex`, `ExportRegions` |
| SpaceNinjaServer | `https://raw.githubusercontent.com/Sainan/SpaceNinjaServer/main/src/...` | `inventory.php` shape: `XPInfo`, `Features`, `ModularParts`, `Missions[].Tier`, `equipmentKeys` |

> **Method note.** `wiki.warframe.com` returns HTTP 403 to plain `curl` (Cloudflare interstitial), and WebFetch's summarizer returns wrong and partly invented table rows on these pages — on my first attempt it produced a Legendary table that silently stopped at LR6 and mislabelled the rank names. Everything wiki-sourced in this document was pulled through a real browser against `action=raw` and parsed **mechanically** in Python. No summarizing model touched any number here.

---

## 1. The mastery XP table

### 1.1 Verdict on the claimed formula

The claim *"rank n needs 2,500 x n^2, Legendary k needs 2,250,000 + 147,500k"* is **CORRECT** [V].
The claim *"cap LR10"* is **NOT SUPPORTED** — see §1.4.

Verbatim from `Module:MasteryRank` [V]:

```lua
local function getRankXP(Rank)
    local legRank = math.max(0, Rank - 30)
    Rank = math.min(Rank, 30)
    return 2500 * Rank ^ 2  +  legRank * 147500
end

local legendaryXP = getRankXP(30)   -- 2,250,000

local function getXPRank(XP)
    local legXP = math.max(0, XP - legendaryXP)
    XP = math.min(XP, legendaryXP)
    return math.floor((XP / 2500) ^ 0.5  +  legXP / 147500)
end
```

Canonically, for the app:

```js
// total mastery XP required to BE at rank r
const totalXpToReach = r =>
  r <= 30 ? 2500 * r * r
          : 2_250_000 + 147_500 * (r - 30);

// rank implied by an XP total
const rankFromXp = xp =>
  Math.floor(Math.sqrt(Math.min(xp, 2_250_000) / 2500)
             + Math.max(0, xp - 2_250_000) / 147_500);
```

`getXPRank` has **no upper clamp** — the wiki's own reference implementation returns LR40 if fed enough XP.

### 1.2 Full table, ranks 0-30 and LR1-LR10

| Rank | In-game name | Total XP to reach | XP from previous rank |
|---:|---|---:|---:|
| 0 | Unranked | 0 | 0 |
| 1 | Initiate | 2,500 | 2,500 |
| 2 | Silver Initiate | 10,000 | 7,500 |
| 3 | Gold Initiate | 22,500 | 12,500 |
| 4 | Novice | 40,000 | 17,500 |
| 5 | Silver Novice | 62,500 | 22,500 |
| 6 | Gold Novice | 90,000 | 27,500 |
| 7 | Disciple | 122,500 | 32,500 |
| 8 | Silver Disciple | 160,000 | 37,500 |
| 9 | Gold Disciple | 202,500 | 42,500 |
| 10 | Seeker | 250,000 | 47,500 |
| 11 | Silver Seeker | 302,500 | 52,500 |
| 12 | Gold Seeker | 360,000 | 57,500 |
| 13 | Hunter | 422,500 | 62,500 |
| 14 | Silver Hunter | 490,000 | 67,500 |
| 15 | Gold Hunter | 562,500 | 72,500 |
| 16 | Eagle | 640,000 | 77,500 |
| 17 | Silver Eagle | 722,500 | 82,500 |
| 18 | Gold Eagle | 810,000 | 87,500 |
| 19 | Tiger | 902,500 | 92,500 |
| 20 | Silver Tiger | 1,000,000 | 97,500 |
| 21 | Gold Tiger | 1,102,500 | 102,500 |
| 22 | Dragon | 1,210,000 | 107,500 |
| 23 | Silver Dragon | 1,322,500 | 112,500 |
| 24 | Gold Dragon | 1,440,000 | 117,500 |
| 25 | Sage | 1,562,500 | 122,500 |
| 26 | Silver Sage | 1,690,000 | 127,500 |
| 27 | Gold Sage | 1,822,500 | 132,500 |
| 28 | Master | 1,960,000 | 137,500 |
| 29 | Middle Master | 2,102,500 | 142,500 |
| 30 | True Master | 2,250,000 | 147,500 |
| LR1 | Legendary 1 | 2,397,500 | 147,500 |
| LR2 | Legendary 2 | 2,545,000 | 147,500 |
| LR3 | Legendary 3 | 2,692,500 | 147,500 |
| LR4 | Legendary 4 | 2,840,000 | 147,500 |
| LR5 | Legendary 5 | 2,987,500 | 147,500 |
| LR6 | Legendary 6 | 3,135,000 | 147,500 |
| LR7 | Legendary 7 | 3,282,500 | 147,500 |
| LR8 | Legendary 8 | 3,430,000 | 147,500 |
| LR9 | Legendary 9 | 3,577,500 | 147,500 |
| LR10 | Legendary 10 | 3,725,000 | 147,500 |

Rows 0-30 and LR1-LR6 match the wiki's rendered table exactly [V]; I asserted the rank-name derivation against the wiki's 31 verified names in code before emitting this table. LR7-LR10 are computed from the same formula and match the wiki's own collapsed "Future Rank" block [V], which itself extrapolates to LR21.

### 1.3 Per-rank delta

- Rank r (1..30) costs `2500 * (2r - 1)` more than rank r-1.
- Every Legendary rank costs a flat **147,500**.
- The curve is **continuous at 30**: rank 30 costs 147,500 and so does LR1, because `2500 * (2*30 - 1) = 147,500` exactly. There is no discontinuity to special-case.

### 1.4 The "LR10 cap" claim — CORRECTED

There is **no evidence of a hard LR10 cap**, and good evidence against any cap:

- `Module:MasteryRank.getXPRank` has no clamp [V].
- The wiki rank table shows **LR1-LR6 as implemented** (each has a named, described test) and **LR7-LR21 inside a collapsed "Future Rank" block with `??` for every test** [V].
- The `Tests for Legendary 1-10` section contains tab stubs for LR7/8/9/10 that are **completely empty** [V].
- Total mastery available in the entire game is **3,201,138**, which lands on **LR6** with **81,362 short of LR7** [V, §3].

**The real constraint is content, not a cap.** LR6 is currently the highest reachable rank because DE has not shipped enough mastery-granting content to exceed it. Independently corroborated: [Mastery Rank Checklist](https://wiki.warframe.com/w/Mastery_Rank_Checklist) reports a non-founder maximum of **3,189,138** XP = LR6 — exactly our 3,201,138 minus the 12,000 of Founders-exclusive mastery [I, arithmetic on two [V] figures].

**App guidance:** do not hardcode a cap. Compute rank from XP and let it run. Render "LR6 (current game maximum)" as a *derived* statement from your own catalog total, so it self-corrects when DE ships more content.

---

## 2. Mastery per source, exhaustively

### 2.1 The canonical rate table

Verbatim from `Module:MasteryRank` [V] — the wiki's machine-readable source of truth, which agrees with the prose on the Mastery Rank page [V]:

```lua
local baseMasteryXp = {
    warframes = 6000,
    primaries = 3000, secondaries = 3000, melee = 3000,
    kitguns = 3000, amps = 3000,
    companions = 6000, kubrows = 6000, kavats = 6000, predasite = 6000,
    vulpaphyla = 6000, moas = 6000, hounds = 6000, sentinels = 6000,
    plexus = 6000,
    sentinelWeapons = 3000, roboticWeapons = 3000, houndWeapons = 3000,
    archwings = 6000, archGuns = 3000, archMelees = 3000,
    ['k-drives'] = 6000,
    necramechs = 8000,
    junctions = 1000,
    railjackIntrinsics = 1500, drifterIntrinsics = 1500,
}
```

Reduced to the rules the app needs [V]:

| Class | Mastery / rank | Max rank | Max mastery |
|---|---:|---:|---:|
| **Weapons** — Primary, Secondary, Melee, Arch-gun, Arch-melee, Sentinel/Robotic/Hound weapons, Kitgun chambers, Zaw strikes, Amp prisms | **100** | 30 | **3,000** |
| **Frames & vehicles** — Warframes, Archwings, all Companions (Sentinel, Kubrow, Kavat, MOA, Predasite, Vulpaphyla, Hound), Plexus, K-Drives | **200** | 30 | **6,000** |
| **Rank-40 weapons** — Kuva / Tenet / Coda / Paracesis | **100** | 40 (5 Forma) | **4,000** |
| **Necramechs** — Voidrig, Bonewidow | **200** | 40 (5 Forma) | **8,000** |
| **Junction** — First Victory vs the specter | — | — | **1,000** each |
| **Railjack Intrinsic rank** | — | — | **1,500** each |
| **Drifter Intrinsic rank** | — | — | **1,500** each |
| **Star chart node** — first clear of main objective + extract | — | — | **per-node, 3 to 279** (§2.5) |

Verbatim from the Mastery Rank page [V]:

> Ranking Weapons, Kitgun Chambers, Zaw Strikes, Amp Prisms, Sentinel weapons, and Archwing weapons will earn **100** mastery points for each rank gained up to Rank 30 for a total of **3,000**.
> Ranking Warframes, Companions, Archwings, K-Drives, the Plexus, and Necramechs will earn **200** mastery points for each rank gained up to Rank 30 for a total of **6,000**, or **8,000** for a Necramech that has been polarized 5 times.

### 2.2 Rank-40 weapons — exact count, cross-validated across two independent sources

From `Module:MasteryRank` [V]:

```lua
local RankForties = {
    primaries   = 12+7+5,   -- kuva + tenet + coda   = 24
    secondaries = 5+5+4,    -- kuva + tenet + coda   = 14
    melee       = 2+4+5+1,  -- kuva + tenet + coda + paracesis = 12
    archGuns    = 2,        -- kuva                  = 2
}
```

Total **52** weapons capping at rank 40.

**Independent cross-validation [V]:** DE's live `ExportWeapons_en.json` carries a `maxLevelCap` field on exactly **52 entries, every one of them value 40**, and the category split is `LongGuns 24, Pistols 14, Melee 12, SpaceGuns 2` — matching the Lua counts **exactly, category by category**. Two entirely unrelated sources agree to the individual item. This is the most trustworthy number in this document.

The bonus is applied in Lua as `RankForties[key] * baseMasteryXp[key] / 3`, i.e. **+1,000** per rank-40 weapon [V] — so 3,000 base + 1,000 = **4,000**.

**Paracesis is in that 52 and does grant 4,000** [V] — `Hidden_Mastery` lists it explicitly as `Paracesis || 4,000`, and it appears in the `maxLevelCap: 40` set as `/Lotus/Weapons/Orokin/BallasSword/BallasSwordWeapon`.

**Necramechs are 8,000**, baked directly into `baseMasteryXp.necramechs = 8000` [V]. It is *not* expressed as base + bonus, so **do not double-apply** a rank-40 bonus to mechs.

**[GAP]** `maxLevelCap` appears on **zero** entries in `ExportWarframes_en.json` — I grepped the live manifest and got 0 occurrences [V]. DE does not publish the Necramech rank-40 cap anywhere in PublicExport. SpaceNinjaServer's `getMaxLevelCap()` consequently returns 30 for Necramechs [V]:

```ts
export const getMaxLevelCap = (type: string): number => {
    if (type in ExportWarframes) return ExportWarframes[type].maxLevelCap ?? 30;
    if (type in ExportWeapons)   return ExportWeapons[type].maxLevelCap ?? 30;
    return 30;
};
```

The app must **hardcode** the two Necramech ItemTypes as cap-40 / 8,000:
`/Lotus/Powersuits/EntratiMech/NechroTech` (Voidrig), `/Lotus/Powersuits/EntratiMech/ThanoTech` (Bonewidow) [V].

### 2.3 Which items grant NO mastery

Verbatim from the Mastery Rank page [V]:

> All Exalted Weapons, Garuda Talons (Prime), Sevagoth's Shadow (Prime), the secondary son from Sirius & Orion, and all Kubrow, Kavat, Predasite, and Vulpaphyla weapons do **not** award mastery points.

**The exact rule the server uses.** From SpaceNinjaServer `inventoryService.ts` -> `applyClientEquipmentUpdates` [V]:

```ts
if (
    categoryName != "SpecialItems" ||
    item.ItemType == "/Lotus/Powersuits/Khora/Kavat/KhoraKavatPowerSuit" ||
    item.ItemType == "/Lotus/Powersuits/Khora/Kavat/KhoraPrimeKavatPowerSuit"
) {
    // ...credit inventory.XPInfo (the mastery ledger)
}
```

**The rule: inventory category `SpecialItems` earns no mastery — with exactly two exceptions, Venari and Venari Prime.**

Confirmed from both directions:

- DE's `ExportWeapons` has **36** entries with `productCategory: "SpecialItems"`, and **all 36 carry `excludeFromCodex: true`** [V]. They are precisely the exalted weapons — Exalted Blade / Prime / Umbra, Artemis Bow (+Prime), Iron Staff (+Prime), Dex Pixia, Diwata, Regulators, Valkyr Talons, Garuda Talons, Shadow Claws, Whipclaw, Landslide Fists, Desert Wind, Balefire Charger, Shattered Lash, Neutralizer, Noctua, Glory, Shadow Clones, Arquebex, Ironbride, and their Prime variants.
- `ExportSentinels` has exactly **2** `SpecialItems`: **Venari and Venari Prime** — the two exceptions [V].
- `Hidden_Mastery` [V]: *"Venari and Venari Prime do not show up in the profile even if leveled up, but still provide mastery."*
- `ExportWarframes` has 1 `SpecialItems` entry: **Orion & Sirius** (`/Lotus/Powersuits/SiriusOrion/OrionSuit`) [V] — the "secondary son" the prose excludes.

**Also grants nothing: the Mote Amp** (the training amp; it cannot be gilded). `Hidden_Mastery` under Amps [V]: *"some players may see an additional 'amp' that counts, but does not provide mastery points."* In `ExportWeapons`, `Mote Scaffold` and `Mote Brace` carry `excludeFromCodex: true` [V].

**Do NOT use `excludeFromCodex` alone as a mastery flag.** 71 weapons carry it, including 16 Predasite/Vulpaphyla antigen/mutagen parts, the 3 Hound melee weapons (Akaten / Batoten / Lacerten — which per `Hidden_Mastery` **do** grant 3,000 each [V]), and 8 PvP-variant Zaw tips. It is a codex-visibility flag, not a mastery flag. Using it as one will under-count by at least 9,000.

### 2.4 Modular items and gilding

**Mechanic [V]** (`Modular_Weapon#Gilding`, raw wikitext):

> Gilding is a mechanic where players at Rank 3 of the appropriate Syndicate can reset their modular weapon's level back to 0 to add a Polarity (similar to Forma) ... players then can name their modular weapon; install Arcane Enhancements and Focus Lens; **earn Mastery Rank experience from releveling**; and customize their weapon's colors.

From the Mastery Rank page [V]:

> Kitguns, Zaws, and Amps must be ranked up to 30, gilded at their respective vendors, then ranked up again to award mastery points.
> MOAs, Predasites, and Vulpaphylas must be ranked up to 30, gilded at their respective vendors, then ranked up again to award mastery points.
> K-Drives, despite their modular nature, do not require gilding to be able to award mastery points.

So: **pre-gild ranks 0-30 award zero mastery. Gilding resets rank to 0. Only the post-gild 0-30 climb awards the 3,000 / 6,000.** Gilding does not "reset and re-grant" mastery — it *enables* mastery for the first time. There is no double-dip. **K-Drives are the exception** and award mastery ungilded.

**How a gilded item appears in the inventory data [V]** — `equipmentTypes.ts`:

```ts
export enum EquipmentFeatures {
    DOUBLE_CAPACITY     = 1,
    UTILITY_SLOT        = 2,
    GRAVIMAG_INSTALLED  = 4,
    GILDED              = 8,
    ARCANE_SLOT         = 32,
    SECOND_ARCANE_SLOT  = 64,
    INCARNON_GENESIS    = 512,
    VALENCE_SWAP        = 1024,
}
```

**`(item.Features & 8) !== 0` -> gilded.** Legacy clients before 24.4.0 instead sent a boolean `Gild?: boolean` [V]. The item also carries `ModularParts?: string[]` [V].

**Mastery for a modular item is credited to the PART, not the assembled weapon.** From `inventoryService.ts` [V]:

```ts
const xpEarningParts: readonly string[] = [
    "LWPT_BLADE",       // Zaw strike
    "LWPT_GUN_BARREL",  // Kitgun chamber
    "LWPT_AMP_OCULUS",  // Amp prism
    "LWPT_MOA_HEAD",    // MOA model
    "LWPT_ZANUKA_HEAD", // Hound model
    "LWPT_HB_DECK",     // K-Drive deck
];

let xpItemType = item.ItemType;
if (item.ModularParts) {
    for (const part of item.ModularParts) {
        const partType = ExportWeapons[part]?.partType;
        if (partType !== undefined && xpEarningParts.indexOf(partType) != -1) {
            xpItemType = part;   // <-- mastery credited to the PART
            break;
        }
    }
}
```

This is why the wiki counts **Kitguns: 6** and **Amps: 9** — it counts *chambers* and *prisms*, not assemblies. **Two different Zaws built on the same strike grant mastery once.** The app must dedupe modular mastery by xp-earning part, or it will wildly over-report.

**[GAP]** `partType` is **not** in DE's raw PublicExport — I grepped `ExportWeapons_en.json` and got **0 occurrences** [V]. SpaceNinjaServer obtains it from the `warframe-public-export-plus` npm package, which enriches DE's export with part metadata. The app must either take that dependency or build and maintain its own part-type map. This is a real, load-bearing dependency.

### 2.5 Star chart, junctions, intrinsics — exact values

**Source [V]:** `Module:Missions/data`, the `MissionDetails` array. Each entry carries `InternalName` (the SolNode ID, which is exactly the `Tag` used in the player's `inventory.Missions`) and a `MasteryExp` integer.

I brace-matched and parsed all **357** entries mechanically:

- **169 nodes** grant mastery, totalling **14,569** [V]
- **13 junctions** grant **1,000** each = **13,000** [V]
- **175 entries grant 0** (Conclave, Sanctuary Onslaught, some relays, hidden nodes)
- Grand total **27,569**

**This sum reproduces the wiki's own `missionsXp = 14569` plus `junctions = 13 x 1000` exactly** [V] — an independent confirmation that the parse is complete and correct.

Observed per-node values: `3, 18, 20, 24, 25, 41, 44, 45, 49, 50, 51, 52, 55, 69, 100, 138, 157, 163, 177, 279`. They are **not uniform** — never assume a flat per-node value.

The 13 mastery-granting junctions [V]: `VenusToMercuryJunction`, `EarthToVenusJunction`, `EarthToMarsJunction`, `MarsToCeresJunction`, `MarsToPhobosJunction`, `CeresToJupiterJunction`, `JupiterToEuropaJunction`, `JupiterToSaturnJunction`, `SaturnToUranusJunction`, `UranusToNeptuneJunction`, `NeptuneToPlutoJunction`, `PlutoToErisJunction`, `ErisToSednaJunction`.

**Steel Path doubles both nodes and junctions** [V]:

```lua
-- Missions and junctions needed to be counted a second time for Steel Path
local totalCount = argTable['missions'] + argTable['junctions']
local totalXp    = argTable['missionsXp'] + masteryFrom('junctions', true)
-- ...the generic loop below then adds 'missions' and 'junctions' AGAIN
```

Star chart therefore contributes **27,569 x 2 = 55,138** in total.

**Intrinsics [V]** — 1,500 mastery per rank:

- Railjack: `railjackIntrinsics = 50` (5 schools x 10 ranks) -> **75,000**
- Drifter: `drifterIntrinsics = 40` (4 schools x 10 ranks) -> **60,000**

Caveats verbatim from the wiki [V]:

> Not all Star Chart nodes give Mastery XP so players can have the max amount without completing all missions.
> In-game profile stats for Star Chart XP includes XP from completing Junctions.

Per-planet breakdown (non-junction nodes only) [V]:

| Planet | Nodes granting MR | Mastery XP |
|---|---:|---:|
| Ceres | 12 | 1,956 |
| Earth | 13 | 308 |
| Eris | 9 | 2,511 |
| Europa | 12 | 1,656 |
| Jupiter | 14 | 718 |
| Mars | 16 | 777 |
| Mercury | 9 | 49 |
| Neptune | 11 | 572 |
| Phobos | 9 | 1,356 |
| Pluto | 11 | 561 |
| Saturn | 13 | 709 |
| Sedna | 14 | 2,274 |
| Uranus | 12 | 803 |
| Venus | 14 | 319 |
| **Total (non-junction)** | **169** | **14,569** |

The complete 169-node table is in **Appendix A**.

### 2.6 Anything else that grants mastery

Per the module's category list, the complete set of mastery sources is: Warframes, Primaries, Secondaries, Melee (incl. Zaws), Kitguns, star chart nodes, Junctions, Railjack Intrinsics, Drifter Intrinsics, Sentinels, Sentinel/Robotic/Hound weapons, Companions (Kubrow, Kavat, Predasite, Vulpaphyla, MOA, Hound), **Plexus**, Archwings, Archguns, Archmelees, Amps, K-Drives, Necramechs [V]. There is no other category in the module.

Two easily-missed entries:

- **The Plexus** grants **6,000** and is counted in the in-game "Companions" mastery breakdown [V]. It is hidden from the profile until *The Archwing* is completed [V].
- **Relays** appear as star chart nodes with nonzero `MasteryExp` (e.g. Vesper Relay = 50) [V].

The wiki also notes: **270 Forma total** is required to fully rank all Necramechs, Kuva/Tenet/Coda weapons and the Paracesis [V].

---

## 3. Total available mastery

### 3.1 Yes — there is a current published figure

I ran the wiki's own Lua module through the MediaWiki template expander with the exact arguments the Mastery Rank page passes it, so these are **computed live, not transcribed** [V]:

```
{{#invoke:MasteryRank|buildMasteryTable
 | ver=42.0 | k-drives=5 | missions=241 | missionsXp=14569 | junctions=13
 | railjackIntrinsics=50 | drifterIntrinsics=40
 | exclusives=114 | exclusivesXp=426000 }}
```

| Category | Count | Mastery |
|---|---:|---:|
| Warframes | 117 | 702,000 |
| Primaries | 194 | 606,000 |
| Secondaries | 147 | 455,000 |
| Melee (incl. Zaws) | 235 | 717,000 |
| Kitguns | 6 | 18,000 |
| Normal missions (nodes + junctions) | 254 (241 + 13) | 27,569 (14,569 + 13,000) |
| The Steel Path (nodes + junctions) | 254 (241 + 13) | 27,569 (14,569 + 13,000) |
| Railjack Intrinsics | 50 | 75,000 |
| Drifter Intrinsics | 40 | 60,000 |
| Sentinels | 17 | 102,000 |
| Sentinel Weapons | 24 | 72,000 |
| — Robotic Weapons | 21 | 63,000 |
| — Hound Weapons | 3 | 9,000 |
| Companions | 25 | 150,000 |
| — Kubrows | 6 | 36,000 |
| — Kavats | 5 | 30,000 |
| — Predasites | 3 | 18,000 |
| — Vulpaphylas | 3 | 18,000 |
| — MOAs | 4 | 24,000 |
| — Hounds | 3 | 18,000 |
| — Plexus | 1 | 6,000 |
| Archwings | 5 | 30,000 |
| Archguns | 20 | 62,000 |
| Archmelees | 8 | 24,000 |
| Amps | 9 | 27,000 |
| K-Drives | 5 | 30,000 |
| Necramechs | 2 | 16,000 |
| **TOTAL** | **1,412** | **3,201,138** -> MR36 (Legendary 6), 81,362 to LR7 |
| **Minus Exclusives** | **1,298** | **2,775,138** -> MR33 (Legendary 3) |

**Total available mastery = 3,201,138 as of Update 42.0** [V]. Non-founder max = **3,189,138** [V, corroborated].

Sanity checks I ran against DE's PublicExport [V] — all pass:

| Wiki count | PublicExport `productCategory` count | Match |
|---|---|---|
| Warframes 117 | `Suits` 117 | yes |
| Primaries 194 | `LongGuns` 194 | yes |
| Archwings 5 | `SpaceSuits` 5 | yes |
| Archmelees 8 | `SpaceMelee` 8 | yes |
| Necramechs 2 | `MechSuits` 2 | yes |
| Sentinels 17 | `Sentinels` 17 | yes |
| Sentinel Weapons 24 | `SentinelWeapons` 24 | yes |

### 3.2 How the app should compute this from a catalog

The formula the module uses, restated [V]:

```
categoryMastery(key) = count[key] * baseMasteryXp[key]
                     + rankForties[key] * baseMasteryXp[key] / 3

total = 2 * (missionsXp + junctions * 1000)     // normal + Steel Path
      + sum over all other categories of categoryMastery(key)
```

Two aggregate keys — `companions` and `sentinelWeapons` — are **excluded from the summation loop** because they are rollups of the sub-rows and would double-count [V]. Replicate that exclusion.

### 3.3 What the published total does NOT tell you — and why you cannot naively count PublicExport

**Critical warning [GAP-adjacent, but verified as a hazard [V]]:** you **cannot** derive these counts by counting `productCategory` in DE's PublicExport. Several categories diverge badly:

| Wiki | PublicExport | Why |
|---|---|---|
| Secondaries 147 | `Pistols` **328** | DE's `Pistols` is a grab-bag: it also holds Kitgun chambers, Amp parts, Zaw PvP-variant tips, and 16 Predasite/Vulpaphyla antigen/mutagen parts |
| Melee 235 (incl. Zaws) | `Melee` **224** | Zaw strikes are counted by the wiki but live elsewhere / differently in the export |
| Amps 9 | `OperatorAmps` **1** | only Sirocco is a whole-weapon amp; the other 8 are *prisms*, stored as parts |
| Kitguns 6 | — | chambers, stored as parts |
| Archguns 20 | `SpaceGuns` **22** | export includes non-mastery entries |

The seven categories in §3.1 that *do* match are safe to derive; the rest need the wiki counts or an enriched catalog.

### 3.4 What is excluded — vaulted and unobtainable

The module subtracts **`exclusives = 114` items / `exclusivesXp = 426,000`** [V]. `Exclusive_Mastery` breaks the exclusives into these tabs [V]:

| Tab | Items | Mastery | Still obtainable? |
|---|---:|---:|---|
| Market Retired (Snipetron) | 1 | 3,000 | Events / Plague Star / Star Days |
| **Founders Pack** (Excalibur Prime, Lato Prime, Skana Prime) | 3 | 12,000 | **Never. Untradeable.** |
| Nightwave (Wolf Sledge, Vitrica) | 2 | 6,000 | Wolf Beacon / Nihil's Oubliette |
| Event Reward (Dex weapons, Wraiths, Plague Zaw strikes, Opticor Vandal, Basmu, Ceti Lacera...) | 11 | 33,000 | Seasonal events; most parts tradeable |
| Void Trader (Prisma / Vandal / Wraith line, Prisma Shade) | 32 | 99,000 | Baro Ki'Teer rotation; unranked tradeable |
| Daily Tribute (Azima, Zenistar, Zenith, Sigma & Octantis) | 4 | 12,000 | Login milestones 100/300/500/700 |
| Prime Vault | 80 | 333,000 | Prime Resurgence rotation / trade |

**[GAP] — a real inconsistency in the source data.** Those tab totals sum to **133 items / 498,000**, but the Mastery Rank page passes the module **114 / 426,000**. The difference is **19 items / 72,000**. Both figures are hand-maintained on different wiki pages and the module arguments were last touched at ver 42.0; the `Exclusive_Mastery` page has evidently been updated since (it even contains a commented-out Saryn/Nikana/Spira Prime block from an unvaulting). **Neither number is trustworthy to the item.** The app should treat "exclusives" as an *advisory* bucket, and — far better — compute unobtainability per-item from its own catalog rather than from a scalar.

Additional exclusions noted on the page [V]:

- Tables exclude the China-only **Excalibur Umbra Prime**.
- **Consoles cannot obtain** Excalibur Prime, Lato Prime, Skana Prime (12,000 of Founders mastery).

### 3.5 Hidden mastery — items that grant mastery but never show in the profile

From `Hidden_Mastery` [V]. These are the classic sources of "the app says I'm missing something I actually have" bugs:

- **Venari / Venari Prime** — 6,000 each; never appear in the profile even when ranked.
- **Plexus** — 6,000; hidden until *The Archwing* is complete.
- **Excalibur Prime / Umbra** — 6,000 each.
- **All Amps** are hidden from any profile until the *viewing* user owns an Amp.
- ~40 further weapons hidden until ranked to at least 1 (Dera Vandal, Dex Sybaris, Gorgon/Karak/Latron Wraith, Nataruk, Opticor Vandal, Prisma Gorgon/Lenz, Quanta Vandal, Snipetron (+Vandal), Strun Wraith, Vinquibus, Mara Detron, Twin Vipers Wraith, Viper Wraith, Grimoire, Dex Dakra, Korumm, Machete Wraith, Nepheri, **Paracesis (4,000)**, Prisma Ohma, Sheev, Skiajati, Skana Prime, Tak & Lug, Tonkkatt, Verdilac, War Prime, Xoris, Akaten, Batoten, Lacerten, Prisma Burst Laser, Prisma Shade (6,000), Prisma Dual Decurions, Prisma Veritux, Sirocco).

---

## 4. Detecting item rank from the inventory data

### 4.1 The affinity curves (answers Q6)

Verbatim from the Affinity page [V]:

> To reach a given level from unranked, a Warframe or Companion needs 1000 x level^2 Affinity in total. A weapon needs half that amount.
> To reach the same level from the previous level, a Warframe or Companion needs 1000 x (2 x level - 1) Affinity. Again, a weapon needs half that amount.

```js
// cumulative affinity required to BE at rank L
const xpForRank = (L, isFrame) => (isFrame ? 1000 : 500) * L * L;

// rank implied by an item's XP  (clamp to the item's cap)
const rankFromXp = (xp, isFrame, cap = 30) =>
  Math.min(cap, Math.floor(Math.sqrt(xp / (isFrame ? 1000 : 500))));
```

"isFrame" = the 200-mastery-per-rank classes: Warframes, Archwings, Necramechs, all Companions, Plexus, K-Drives. Everything else is a weapon.

Anchor values [V]: weapon rank 30 = **450,000**; frame rank 30 = **900,000**; weapon rank 40 = **800,000**; Necramech rank 40 = **1,600,000**.

| Rank | Warframe/Companion/Vehicle cumulative | Weapon cumulative | WF delta | Weapon delta |
|---:|---:|---:|---:|---:|
| 1 | 1,000 | 500 | 1,000 | 500 |
| 2 | 4,000 | 2,000 | 3,000 | 1,500 |
| 3 | 9,000 | 4,500 | 5,000 | 2,500 |
| 4 | 16,000 | 8,000 | 7,000 | 3,500 |
| 5 | 25,000 | 12,500 | 9,000 | 4,500 |
| 6 | 36,000 | 18,000 | 11,000 | 5,500 |
| 7 | 49,000 | 24,500 | 13,000 | 6,500 |
| 8 | 64,000 | 32,000 | 15,000 | 7,500 |
| 9 | 81,000 | 40,500 | 17,000 | 8,500 |
| 10 | 100,000 | 50,000 | 19,000 | 9,500 |
| 11 | 121,000 | 60,500 | 21,000 | 10,500 |
| 12 | 144,000 | 72,000 | 23,000 | 11,500 |
| 13 | 169,000 | 84,500 | 25,000 | 12,500 |
| 14 | 196,000 | 98,000 | 27,000 | 13,500 |
| 15 | 225,000 | 112,500 | 29,000 | 14,500 |
| 16 | 256,000 | 128,000 | 31,000 | 15,500 |
| 17 | 289,000 | 144,500 | 33,000 | 16,500 |
| 18 | 324,000 | 162,000 | 35,000 | 17,500 |
| 19 | 361,000 | 180,500 | 37,000 | 18,500 |
| 20 | 400,000 | 200,000 | 39,000 | 19,500 |
| 21 | 441,000 | 220,500 | 41,000 | 20,500 |
| 22 | 484,000 | 242,000 | 43,000 | 21,500 |
| 23 | 529,000 | 264,500 | 45,000 | 22,500 |
| 24 | 576,000 | 288,000 | 47,000 | 23,500 |
| 25 | 625,000 | 312,500 | 49,000 | 24,500 |
| 26 | 676,000 | 338,000 | 51,000 | 25,500 |
| 27 | 729,000 | 364,500 | 53,000 | 26,500 |
| 28 | 784,000 | 392,000 | 55,000 | 27,500 |
| 29 | 841,000 | 420,500 | 57,000 | 28,500 |
| 30 | 900,000 | 450,000 | 59,000 | 29,500 |
| 31 | 961,000 | 480,500 | 61,000 | 30,500 |
| 32 | 1,024,000 | 512,000 | 63,000 | 31,500 |
| 33 | 1,089,000 | 544,500 | 65,000 | 32,500 |
| 34 | 1,156,000 | 578,000 | 67,000 | 33,500 |
| 35 | 1,225,000 | 612,500 | 69,000 | 34,500 |
| 36 | 1,296,000 | 648,000 | 71,000 | 35,500 |
| 37 | 1,369,000 | 684,500 | 73,000 | 36,500 |
| 38 | 1,444,000 | 722,000 | 75,000 | 37,500 |
| 39 | 1,521,000 | 760,500 | 77,000 | 38,500 |
| 40 | 1,600,000 | 800,000 | 79,000 | 39,500 |

### 4.2 The Forma trap — the single biggest correctness hazard

An item above rank 30 has been Forma'd, and **each Forma resets the level to 0 while raising the cap by 2**. The *lifetime* affinity is therefore much larger than `500 * L^2`. The Affinity page publishes the true cumulative totals [V]:

| Max rank reached | Forma used | Weapon TOTAL affinity incl. re-levels | Necramech TOTAL |
|---:|---:|---:|---:|
| 30 | 0 | 450,000 | 900,000 |
| 32 | 1 | 962,000 | 1,924,000 |
| 34 | 2 | 1,540,000 | 3,080,000 |
| 36 | 3 | 2,188,000 | 4,376,000 |
| 38 | 4 | 2,910,000 | 5,820,000 |
| 40 | 5 | 3,710,000 | 7,420,000 |

Wiki's own row-by-row values for the odd ranks too [V]: 31 -> 930,500 / 1,861,000; 33 -> 1,506,500 / 3,013,000; 35 -> 2,152,500 / 4,305,000; 37 -> 2,872,500 / 5,745,000; 39 -> 3,670,500 / 7,341,000.

Derivation [I, from the [V] table]: total = sum over each Forma cycle of the affinity to reach that cycle's cap, with caps 30, 32, 34, 36, 38, 40. For weapons: `450,000 + 512,000 + 578,000 + 648,000 + 722,000 + 800,000 = 3,710,000` — matches the published rank-40 figure exactly.

**Consequences for the app:**

- `Math.floor(sqrt(XP / 500))` is **only valid for a never-Forma'd item**. On a 5-Forma Kuva weapon with 3,710,000 XP it returns rank 86.
- The inventory carries **`Polarized?: number`** — the Forma count [V] (`unlockLevelCapController` sets it directly; `addXpController` forces it to 5 for `getMaxLevelCap > 30` items). Use it: `cap = min(maxLevelCap, 30 + 2 * (Polarized ?? 0))`.
- The wiki also notes [V]: *"The Affinity count in the profile page for specific equipment does not increase upon polarization, only when the amount of cumulative Affinity earned prior to the polarization is exceeded"*, and *"Until they were polarized 5 times they do not gain affinity when they are at their temporary max level."* Treat the per-item `XP` as a **high-water mark of lifetime affinity**, not a clean per-cycle counter.

**[GAP]** I could **not** verify from a real captured `inventory.php` payload whether the live DE server resets the per-item `XP` field on Forma or keeps accumulating. SpaceNinjaServer accumulates (`item.XP += XP`) and never resets it [V], and the wiki's profile note is consistent with accumulation — but SNS is a reimplementation, not DE's server. **Validate this against one real Forma'd item in a live capture before shipping any rank display that depends on it.** This is the highest-risk unknown in this brief.

### 4.3 The far better approach — use `XPInfo`, not per-item XP

The inventory contains an **account-level, per-ItemType lifetime affinity ledger** [V]:

```ts
export interface ITypeXPItem { ItemType: string; XP: number; }
// on the inventory:
XPInfo: ITypeXPItem[];
```

`applyClientEquipmentUpdates` credits it in parallel with the per-item XP, keyed by ItemType (or by the xp-earning **part** for modular items) [V]. It is **never decremented** — selling the item does not remove it. This is exactly the semantics mastery needs, and it matches the wiki's rule [V]:

> Each individual equipment will only grant its mastery points once per variant; polarization or selling a Rank 30 equipment and then purchasing & reusing it will **not** grant mastery points again... If equipment below max rank are sold, then purchased and reused, only the ranks previously not gained will grant mastery points.

**Recommended algorithm:**

```js
// mastery earned for one ItemType, from the account ledger
function masteryFor(itemType, xp, catalog) {
  const e = catalog[itemType];
  if (!e || !e.grantsMastery) return 0;            // SpecialItems except Venari, Mote amp
  const perRank = e.isFrame ? 200 : 100;           // 200 frames/vehicles, 100 weapons
  const base    = e.isFrame ? 1000 : 500;
  const cap     = e.maxLevelCap ?? 30;             // 40 for the 52 + 2 Necramechs
  const rank    = Math.min(cap, Math.floor(Math.sqrt(xp / base)));
  return rank * perRank;
}
```

Caveat: this still assumes `XPInfo.XP` is a single-cycle-equivalent value. For rank-40 items you must decide between the `sqrt` reading and the cumulative-with-Forma-cycles reading — the same [GAP] as §4.2. Cross-check against `Polarized` and against the in-game profile total.

### 4.4 Detecting "is it maxed"

```js
const isMaxed = (xp, isFrame, cap) => xp >= (isFrame ? 1000 : 500) * cap * cap;
```

...but for a rank-40 item, `cap` must come from `maxLevelCap` **and** the item must actually be 5x polarized. `Polarized >= 5 && rank >= 40` is the honest "fully mastered" test for the 52 + 2.

### 4.5 Relevant inventory fields, verified

From SpaceNinjaServer's `inventory.php` model [V]:

| Field | Location | Meaning |
|---|---|---|
| `XPInfo: [{ItemType, XP}]` | inventory root | **lifetime per-ItemType affinity ledger — the mastery source of truth** |
| `PlayerLevel: number` | inventory root | the player's current Mastery Rank |
| `TrainingDate` | inventory root | last MR test date (drives the 24h retry cooldown) |
| `Missions: [{Tag, Completes, Tier?}]` | inventory root | node completion. `Tag` = SolNode ID; **`Tier` truthy = Steel Path** [V] (`const isSteelPath = missions?.Tier \|\| alerts?.Tier`) |
| `XP` | per equipment item | that item's affinity |
| `Features` | per equipment item | bitfield; **`& 8` = GILDED** |
| `Polarized` | per equipment item | Forma count; cap = `30 + 2 * Polarized` |
| `ModularParts: string[]` | per equipment item | parts; mastery credited to the xp-earning one |
| `ItemType` | per equipment item | the `/Lotus/...` unique name |

The 27 equipment categories in `inventory.php` [V]:

```
Suits, LongGuns, Pistols, Melee, SpecialItems, Sentinels, SentinelWeapons,
SpaceSuits, SpaceGuns, SpaceMelee, Hoverboards, OperatorAmps, Antiques,
MoaPets, Scoops, Horses, DrifterGuns, DrifterMelee, Motorcycles, CrewShips,
DataKnives, MechSuits, CrewShipHarnesses, KubrowPets, CrewShipWeapons,
CrewShipSalvagedWeapons, OperatorSuits
```

Note `Hoverboards` = K-Drives, `MoaPets` = MOAs **and Hounds** (`ZanukaPet*` types map to `MoaPets` [V]), `MechSuits` = Necramechs, `KubrowPets` = Kubrows, Kavats, Predasites **and** Vulpaphylas.

---

## 5. Computing an honest "% complete"

### 5.1 The denominators, and which are defensible

| Denominator | Value | Honesty |
|---|---:|---|
| All mastery in the game | 3,201,138 | Honest but demoralising — includes Founders items nobody can get |
| Minus Founders (3 items) | 3,189,138 | **The right default for PC.** This is the real ceiling for a non-founder |
| Minus all "exclusives" | 2,775,138 | Misleading — most exclusives *are* obtainable (Baro, Prime Resurgence, events) |
| To reach LR6 | 3,135,000 | Useful as a "next rank" goal |

**Recommendation:** default to **3,189,138** (or 3,201,138 if the account actually owns a Founders item — detectable from `XPInfo`). Show the exclusives bucket as a **separate, itemised "hard to get" list**, never folded into the percentage.

### 5.2 Present three numbers, not one

A single percentage lies. Show:

1. **Earned / total available** — the true completion figure.
2. **Earned / currently obtainable** — excludes Founders (and console-locked items on console). This is the number the player can actually move.
3. **Progress to next rank** — `(xp - totalXpToReach(r)) / 147500` for r >= 29. This is the only one that feels actionable day to day.

### 5.3 "What most efficiently advances it" — the ranking the app should compute

Mastery per unit of effort, best first [I, arithmetic on [V] rates]:

| Action | Mastery | Effort |
|---|---:|---|
| One Junction (normal, then again on Steel Path) | 1,000 x2 | One specter fight. **Best ratio in the game.** |
| One Intrinsic rank (Railjack or Drifter) | 1,500 | Scales steeply at high ranks |
| Rank a Necramech 0-40 | 8,000 | 7,420,000 affinity + 5 Forma |
| Rank a Warframe / Companion / K-Drive / Plexus 0-30 | 6,000 | 900,000 affinity |
| Rank a Kuva/Tenet/Coda weapon 0-40 | 4,000 | 3,710,000 affinity + 5 Forma |
| Rank any weapon 0-30 | 3,000 | 450,000 affinity |
| Clear a high-value star chart node | up to 279 | One mission |
| Clear a low-value star chart node | 3 | One mission |

**The two highest-leverage insights the app can surface:**

1. **Affinity per mastery point strongly favours frames.** A weapon costs 450,000 affinity for 3,000 mastery (150 affinity/point). A Warframe costs 900,000 for 6,000 (150/point) — identical. But a **rank-40 weapon costs 3,710,000 for 4,000** (928/point) and a **Necramech 7,420,000 for 8,000** (928/point) — **6.2x worse**. Rank-40 grinds should be flagged as low-priority completionist work, not efficient progress.
2. **Un-run Junctions and un-levelled Intrinsics are nearly free mastery** and are the most commonly forgotten. 13 junctions x 1,000 x 2 (Steel Path) = 26,000, and 90 intrinsic ranks x 1,500 = 135,000 — together **161,000**, more than a full Legendary rank, with no affinity grind at all.

Also worth surfacing: **Bonus Affinity is +125%** of base on mission success [V], so *"getting an item to Rank 20 will result in that item becoming Rank 30"*, and *"for Rank 40 weapons ... getting to Rank 26 and two-thirds will result in a Rank 40 weapon"* [V]. The app can show a live "rank you will finish at" during a mission.

### 5.4 Things that will make the app wrong if ignored

1. Counting `productCategory` from PublicExport as the item catalog (§3.3).
2. Using `excludeFromCodex` as the mastery flag (§2.3).
3. Counting modular *assemblies* instead of xp-earning *parts* (§2.4).
4. Forgetting the two Venari exceptions to the `SpecialItems` rule (§2.3).
5. Forgetting Plexus (6,000) and that it hides until *The Archwing* (§3.5).
6. Assuming all star chart nodes grant mastery — 175 of 357 grant zero (§2.5).
7. Forgetting Steel Path doubles nodes **and** junctions (§2.5).
8. Applying `sqrt(XP/500)` to a Forma'd item (§4.2).
9. Hardcoding an LR10 cap (§1.4).
10. Assuming DE publishes the Necramech rank-40 cap — it does not (§2.2).

---

## 6. Open gaps — what I could NOT verify

1. **[GAP] Whether the live DE server resets per-item `XP` on Forma.** SpaceNinjaServer accumulates and never resets [V], and the wiki's profile note is consistent with that, but SNS is a reimplementation. **Must be validated against a real captured `inventory.php` with a known Forma'd item.** Highest-risk item in this brief.
2. **[GAP] `partType` is absent from DE's raw PublicExport** (0 occurrences [V]). Modular part-type mapping requires `warframe-public-export-plus` or a hand-built map.
3. **[GAP] `maxLevelCap` is absent from `ExportWarframes`** (0 occurrences [V]). Necramech cap-40 must be hardcoded.
4. **[GAP] Exclusive-mastery figures are internally inconsistent** — 114/426,000 (module args) vs 133/498,000 (tab totals). Neither is trustworthy per-item (§3.4).
5. **[GAP] The exact identity of the 241 "missions" count.** The module is passed `missions = 241`, but `Module:Missions/data` yields 169 mastery-granting nodes out of 357 entries, and DE's `ExportRegions` has 269 SolNodes. The three counts measure different things and I did not reconcile them. The **XP** figures reconcile perfectly (14,569); only the item *count* is ambiguous.
6. **[GAP] Whether a hard Legendary cap exists in the client at all.** No cap in the wiki module [V]; LR6 is content-limited [V]. I found no DE primary source stating a maximum.
7. **[GAP] Per-source mastery totals are wiki-maintained, not DE-published.** DE's PublicExport contains **no mastery-granted field at all** — only `masteryReq` (the MR needed to *use* an item). Every mastery *value* in this document traces to the wiki module or wiki prose, cross-checked against PublicExport counts where possible. There is no authoritative DE endpoint for "mastery available".

---

## Appendix A — all 169 mastery-granting star chart nodes

Extracted mechanically from `Module:Missions/data` (`MasteryExp` field, `InternalName` = the `Tag` in `inventory.Missions`). Junctions (13 x 1,000) are listed separately in §2.5. Sum of this table = **14,569** [V].

| SolNode | Name | Planet | Mission type | Mastery XP |
|---|---|---|---|---:|
| SolNode132 | Bode | Ceres | Spy | 163 |
| SolNode149 | Casta | Ceres | Defense | 163 |
| SolNode147 | Cinxia | Ceres | Interception | 163 |
| SolNode146 | Draco | Ceres | Survival | 163 |
| SolNode141 | Ker | Ceres | Sabotage | 163 |
| SolNode140 | Kiste | Ceres | Mobile Defense | 163 |
| SolNode139 | Lex | Ceres | Capture | 163 |
| SolNode138 | Ludi | Ceres | Hijack | 163 |
| SolNode137 | Nuovo | Ceres | Rescue | 163 |
| SolNode131 | Pallas | Ceres | Exterminate | 163 |
| SolNode135 | Thon | Ceres | Sabotage | 163 |
| SolNode144 | Exta | Ceres | Assassination | 163 |
| SolNode228 | Plains of Eidolon | Earth | Free Roam | 24 |
| SolNode79 | Cambria | Earth | Spy | 24 |
| SolNode75 | Cervantes | Earth | Sabotage | 24 |
| SolNode27 | E Prime | Earth | Exterminate | 24 |
| SolNode903 | Erpo | Earth | Mobile Defense | 24 |
| SolNode59 | Eurasia | Earth | Mobile Defense | 24 |
| SolNode39 | Everest | Earth | Excavation | 24 |
| SolNode26 | Lith | Earth | Defense | 24 |
| SolNode63 | Mantle | Earth | Capture | 24 |
| SolNode89 | Mariana | Earth | Exterminate | 24 |
| SolNode15 | Pacific | Earth | Rescue | 24 |
| SolNode24 | Oro | Earth | Assassination | 24 |
| SolNode85 | Gaia | Earth | Interception | 20 |
| SolNode153 | Brugia | Eris | Rescue | 279 |
| SolNode162 | Isos | Eris | Capture | 279 |
| SolNode164 | Kala-azar | Eris | Defense | 279 |
| SolNode175 | Naeglar | Eris | Sabotage | 279 |
| SolNode166 | Nimus | Eris | Survival | 279 |
| SolNode167 | Oestrus | Eris | Infested Salvage | 279 |
| SolNode171 | Saxis | Eris | Exterminate | 279 |
| SolNode173 | Solium | Eris | Mobile Defense | 279 |
| SolNode172 | Xini | Eris | Interception | 279 |
| SolNode203 | Abaddon | Europa | Capture | 138 |
| SolNode204 | Armaros | Europa | Exterminate | 138 |
| SolNode205 | Baal | Europa | Exterminate | 138 |
| SolNode220 | Kokabiel | Europa | Sabotage | 138 |
| SolNode209 | Morax | Europa | Mobile Defense | 138 |
| SolNode217 | Orias | Europa | Rescue | 138 |
| SolNode211 | Ose | Europa | Interception | 138 |
| SolNode212 | Paimon | Europa | Defense | 138 |
| SolNode214 | Sorath | Europa | Hijack | 138 |
| SolNode215 | Valac | Europa | Spy | 138 |
| SolNode216 | Valefor | Europa | Excavation | 138 |
| SolNode210 | Naamah | Europa | Assassination | 138 |
| SolNode740 | The Ropalolyst | Jupiter | Assassination | 55 |
| SolNode88 | Adrastea | Jupiter | Sabotage | 51 |
| SolNode97 | Amalthea | Jupiter | Spy | 51 |
| SolNode73 | Ananke | Jupiter | Capture | 51 |
| SolNode25 | Callisto | Jupiter | Interception | 51 |
| SolNode74 | Carme | Jupiter | Mobile Defense | 51 |
| SolNode121 | Carpo | Jupiter | Exterminate | 51 |
| SolNode100 | Elara | Jupiter | Survival | 51 |
| SolNode905 | Galilea | Jupiter | Sabotage | 51 |
| SolNode87 | Ganymede | Jupiter | Disruption | 51 |
| SolNode125 | Io | Jupiter | Defense | 51 |
| SolNode126 | Metis | Jupiter | Rescue | 51 |
| SolNode10 | Thebe | Jupiter | Sabotage | 51 |
| SolNode53 | Themisto | Jupiter | Assassination | 51 |
| SolNode106 | Alator | Mars | Interception | 51 |
| SolNode45 | Ara | Mars | Capture | 51 |
| SolNode113 | Ares | Mars | Sabotage | 51 |
| SolNode41 | Arval | Mars | Spy | 51 |
| SolNode16 | Augustus | Mars | Excavation | 51 |
| SolNode58 | Hellas | Mars | Exterminate | 51 |
| SolNode36 | Martialis | Mars | Rescue | 51 |
| SolNode30 | Olympus | Mars | Disruption | 51 |
| SolNode46 | Spear | Mars | Defense | 51 |
| SolNode904 | Syrtis | Mars | Exterminate | 51 |
| SolNode11 | Tharsis | Mars | Mobile Defense | 51 |
| SolNode14 | Ultor | Mars | Exterminate | 51 |
| SolNode68 | Vallis | Mars | Mobile Defense | 51 |
| SolNode99 | War | Mars | Assassination | 51 |
| SolNode65 | Gradivus | Mars | Sabotage | 45 |
| SolNode450 | Tyana Pass | Mars | Mirror Defense | 18 |
| SolNode108 | Tolstoj | Mercury | Assassination | 25 |
| SolNode223 | Boethius | Mercury | Mobile Defense | 3 |
| SolNode119 | Caloris | Mercury | Rescue | 3 |
| SolNode12 | Elion | Mercury | Capture | 3 |
| SolNode130 | Lares | Mercury | Defense | 3 |
| SolNode103 | M Prime | Mercury | Exterminate | 3 |
| SolNode224 | Odin | Mercury | Interception | 3 |
| SolNode226 | Pantheon | Mercury | Exterminate | 3 |
| SolNode225 | Suisei | Mercury | Spy | 3 |
| SolNode6 | Despina | Neptune | Excavation | 52 |
| SolNode1 | Galatea | Neptune | Capture | 52 |
| SolNode118 | Laomedeia | Neptune | Disruption | 52 |
| SolNode49 | Larissa | Neptune | Mobile Defense | 52 |
| SolNode84 | Nereid | Neptune | Spy | 52 |
| SolNode62 | Neso | Neptune | Exterminate | 52 |
| SolNode17 | Proteus | Neptune | Defense | 52 |
| SolNode908 | Salacia | Neptune | Mobile Defense | 52 |
| SolNode57 | Sao | Neptune | Sabotage | 52 |
| SolNode78 | Triton | Neptune | Rescue | 52 |
| SolNode127 | Psamathe | Neptune | Assassination | 52 |
| SettlementNode1 | Roche | Phobos | Exterminate | 157 |
| SettlementNode15 | Sharpless | Phobos | Mobile Defense | 157 |
| SettlementNode11 | Gulliver | Phobos | Defense | 157 |
| SettlementNode10 | Kepler | Phobos | Rush | 157 |
| SettlementNode12 | Monolith | Phobos | Rescue | 157 |
| SettlementNode14 | Shklovsky | Phobos | Spy | 157 |
| SettlementNode2 | Skyresh | Phobos | Capture | 157 |
| SettlementNode3 | Stickney | Phobos | Survival | 157 |
| SettlementNode20 | Iliad | Phobos | Assassination | 100 |
| SolNode4 | Acheron | Pluto | Exterminate | 51 |
| SolNode43 | Cerberus | Pluto | Interception | 51 |
| SolNode56 | Cypress | Pluto | Sabotage | 51 |
| SolNode76 | Hydra | Pluto | Capture | 51 |
| SolNode38 | Minthe | Pluto | Mobile Defense | 51 |
| SolNode21 | Narcissus | Pluto | Exterminate | 51 |
| SolNode102 | Oceanum | Pluto | Spy | 51 |
| SolNode72 | Outer Terminus | Pluto | Defense | 51 |
| SolNode81 | Palus | Pluto | Survival | 51 |
| SolNode48 | Regna | Pluto | Rescue | 51 |
| SolNode51 | Hades | Pluto | Assassination | 51 |
| SolNode31 | Anthe | Saturn | Rescue | 55 |
| SolNode82 | Calypso | Saturn | Sabotage | 55 |
| SolNode70 | Cassini | Saturn | Capture | 55 |
| SolNode67 | Dione | Saturn | Spy | 55 |
| SolNode42 | Helene | Saturn | Defense | 55 |
| SolNode93 | Keeler | Saturn | Mobile Defense | 55 |
| SolNode50 | Numa | Saturn | Rescue | 55 |
| SolNode906 | Pandora | Saturn | Pursuit | 55 |
| SolNode18 | Rhea | Saturn | Interception | 55 |
| SolNode20 | Telesto | Saturn | Exterminate | 55 |
| SolNode96 | Titan | Saturn | Survival | 55 |
| SolNode32 | Tethys | Saturn | Assassination | 55 |
| SolNode19 | Enceladus | Saturn | Sabotage | 49 |
| SolNode189 | Naga | Sedna | Rescue | 177 |
| SolNode195 | Hydron | Sedna | Defense | 177 |
| SolNode187 | Selkie | Sedna | Survival | 177 |
| SolNode181 | Adaro | Sedna | Exterminate | 177 |
| SolNode184 | Rusalka | Sedna | Sabotage | 177 |
| SolNode188 | Kelpie | Sedna | Spy | 177 |
| SolNode191 | Marid | Sedna | Hijack | 177 |
| SolNode196 | Charybdis | Sedna | Mobile Defense | 177 |
| SolNode177 | Kappa | Sedna | Disruption | 177 |
| SolNode190 | Nakki | Sedna | Arena | 177 |
| SolNode199 | Yam | Sedna | Arena | 177 |
| SolNode183 | Vodyanoi | Sedna | Arena | 177 |
| SolNode193 | Merrow | Sedna | Assassination | 100 |
| SolNode185 | Berehynia | Sedna | Interception | 50 |
| SolNode33 | Ariel | Uranus | Capture | 69 |
| SolNode907 | Caelus | Uranus | Interception | 69 |
| SolNode60 | Caliban | Uranus | Rescue | 69 |
| SolNode83 | Cressida | Uranus | Mobile Defense | 69 |
| SolNode98 | Desdemona | Uranus | Sabotage | 69 |
| SolNode69 | Ophelia | Uranus | Survival | 69 |
| SolNode9 | Rosalind | Uranus | Spy | 69 |
| SolNode122 | Stephano | Uranus | Defense | 69 |
| SolNode34 | Sycorax | Uranus | Exterminate | 69 |
| SolNode64 | Umbriel | Uranus | Interception | 69 |
| SolNode105 | Titania | Uranus | Assassination | 69 |
| SolNode114 | Puck | Uranus | Exterminate | 44 |
| SolNode239 | Vesper Relay | Venus | Follie's Hunt | 50 |
| SolNode104 | Fossa | Venus | Assassination | 41 |
| SolNode129 | Orb Vallis | Venus | Free Roam | 24 |
| SolNode61 | Ishtar | Venus | Sabotage | 24 |
| SolNode2 | Aphrodite | Venus | Mobile Defense | 18 |
| SolNode23 | Cytherean | Venus | Interception | 18 |
| SolNode128 | E Gate | Venus | Exterminate | 18 |
| SolNode101 | Kiliken | Venus | Excavation | 18 |
| SolNode109 | Linea | Venus | Rescue | 18 |
| SolNode902 | Montes | Venus | Exterminate | 18 |
| SolNode22 | Tessera | Venus | Defense | 18 |
| SolNode66 | Unda | Venus | Spy | 18 |
| SolNode107 | Venera | Venus | Capture | 18 |
| SolNode123 | V Prime | Venus | Survival | 18 |
