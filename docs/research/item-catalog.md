# The complete item catalog — "you own 312 of 487 weapons"

Research date **2026-08-31**. Everything marked VERIFIED was fetched and parsed on this machine on that
date; the numbers below come from parsing the actual bytes, not from prose. Where I could not verify
something I say so — see [§9 Gaps](#9-gaps--what-i-could-not-verify).

**Bottom line up front:**

1. The join works. PublicExport / WFCD `uniqueName` and the account's `ItemType` are the **same
   namespace**, both bare `/Lotus/...`. The `/Lotus/StoreItems/` prefix appears only in *reward,
   vendor and store* references, never in inventory, and normalising is a one-line string replace
   (**one exception: boosters**). See [§4](#4-the-join-problem-storeitems).
2. Use **three** sources, not one: `warframe-public-export-plus` (machine-readable, has `vaultedAt`),
   WFCD `warframe-items` (has the `masterable` flag — the only sane MR denominator), and DE
   PublicExport directly only as the freshness tripwire.
3. **DE's CDN does not gzip.** 14.3 MB of manifests transfer as 14.3 MB. jsDelivr gzips the same data
   at 20–40×. This is the single biggest fact in the fetch plan. See [§8](#8-the-fetch-plan).

---

## 1. WFCD `warframe-items`

Repo <https://github.com/WFCD/warframe-items> · npm `@wfcd/items` · MIT.

### 1a. Every file in `data/json/`, with real entry counts — VERIFIED

Fetched via the GitHub contents API and parsed locally, 2026-08-31. Sizes are the **repo** (master
branch) sizes; the npm tarball's copies are larger because the build injects extra fields.

| File | Entries | Repo size | `category` value | Notes |
|---|---:|---:|---|---|
| `Arcanes.json` | 172 | 296 KB | Arcanes | |
| `Arch-Gun.json` | 20 | 461 KB | Arch-Gun | all 20 masterable |
| `Arch-Melee.json` | 8 | 346 KB | Arch-Melee | all 8 masterable |
| `Archwing.json` | 5 | 50 KB | Archwing | all 5 masterable |
| `Enemy.json` | 638 | 2.67 MB | Enemy | not an owned category |
| `Fish.json` | 126 | 84 KB | Fish | |
| `Gear.json` | 184 | 515 KB | Gear | |
| `Glyphs.json` | 1687 | 494 KB | Glyphs | |
| `Melee.json` | 269 | 9.06 MB | Melee | 235 masterable |
| `Misc.json` | 1256 | 8.28 MB | Misc | the junk drawer, 39 distinct `type`s |
| `Mods.json` | 1806 | 5.48 MB | Mods | |
| `Node.json` | 269 | 160 KB | Node | matches `ExportRegions` 269 exactly |
| `Pets.json` | 66 | 270 KB | Pets | 22 masterable |
| `Primary.json` | 195 | 10.49 MB | Primary | all 195 masterable |
| `Quests.json` | 46 | 118 KB | Quests | matches `ExportKeys` 46 exactly |
| `Railjack.json` | 143 | 205 KB | Railjack | matches `ExportRailjackWeapons` 143 |
| `Relics.json` | 3120 | 8.21 MB | Relics | 4 refinement rows per relic |
| `Resources.json` | 241 | 542 KB | Resources | |
| `Secondary.json` | 148 | 7.92 MB | Secondary | all 148 masterable |
| `SentinelWeapons.json` | 24 | 47 KB | **`Primary`** | ← WFCD bug/quirk, see below |
| `Sentinels.json` | 17 | 825 KB | Sentinels | all 17 masterable |
| `Sigils.json` | 335 | 114 KB | Sigils | |
| `Skins.json` | 6776 | 7.09 MB | Skins | |
| `Warframes.json` | 121 | 2.86 MB | Warframes | 120 masterable |
| `i18n.json` | — | **50.1 MB** | — | localisation only, skip it |

24 category files + `i18n.json`. **Repo total 116.6 MB**, of which i18n is 50.1 MB.

> **Gotcha — VERIFIED:** every entry in `SentinelWeapons.json` carries `"category": "Primary"`, not
> `"SentinelWeapons"`. If you bucket by the `category` field you will silently merge 24 companion
> weapons into your Primary count. Bucket by **filename**, not by `category`.

> **Gotcha:** `All.json` is referenced by the repo's own `package.json` (`typings` script) but is
> **not** shipped in either the repo or the npm tarball (VERIFIED against the v1.1275.75 tarball
> file list). Do not plan around it.

### 1b. Fields on an entry — VERIFIED

Real `Warframes.json` entry for Mag, keys elided to types:

```jsonc
{
  "uniqueName": "/Lotus/Powersuits/Mag/Mag",   // ← the join key. Bare. No StoreItems.
  "name": "Mag",
  "description": "...",
  "health": 180, "shield": 455, "armor": 105, "stamina": 3, "power": 140,
  "masteryReq": 0, "sprintSpeed": 1, "productCategory": "Suits",
  "abilities": [ ...4 ], "passiveDescription": "...",
  "buildPrice": 25000, "buildTime": 86400, "skipBuildTimePrice": 50,
  "buildQuantity": 1, "consumeOnBuild": true, "components": [ ...5 ],
  "polarities": [...], "aura": "madurai", "exilusPolarity": "...",
  "type": "Warframe", "category": "Warframes", "imageName": "Mag.png",
  "tradable": false, "conclave": true, "isPrime": false,
  "masterable": true,                          // ← WFCD-added, the MR denominator
  "vaulted": true, "vaultDate": "2017-05-30",  // ← WFCD-added (primes only)
  "estimatedVaultDate": "2017-05-30",
  "introduced": {...}, "releaseDate": "2012-10-25",
  "wikiAvailable": true, "wikiaUrl": "https://wiki.warframe.com/w/Mag",
  "marketCost": 75, "bpCost": 25000, "drops": [...], "sex": "Female"
}
```

The fields WFCD **adds on top of** PublicExport, and which you cannot get anywhere else in
machine-readable form, are:

`masterable` · `vaulted` / `vaultDate` / `estimatedVaultDate` · `isPrime` · `tradable` ·
`components[]` (fully expanded, each with its own `drops[]`) · `drops[]` · `type` · `category` ·
`imageName` · `wikiaUrl` / `wikiaThumbnail` · `releaseDate` / `introduced` · `marketCost` / `bpCost` ·
`polarities` · `disposition` (Riven) · `attacks[]` / `tags[]` · `conclave` · `transmutable` /
`isAugment` / `isExilus` (mods) · `locations[]` / `rewards[]` / `marketInfo` (relics).

Per-file key coverage (count = how many of that file's entries have the key), VERIFIED:

- **Mods.json (1806)** — `uniqueName`/`name`/`type`/`imageName`/`category`/`tradable`/`isPrime`/`masterable` on all 1806; `polarity`/`rarity`/`baseDrain`/`fusionLimit`/`codexSecret` 1787; `levelStats` 1622; `compatName` 1583; `drops` 1401; `isAugment` 454; `isUtility` 194; `description` 142; `modSet` 72; `isExilus` 37; `upgradeEntries` 17 (Rivens); `modSetValues` 5.
- **Relics.json (3120)** — all have `uniqueName`/`name`/`description`/`type`/`imageName`/`category`/`tradable`/`locations`/`rewards`/`masterable`; `marketInfo` and `vaulted` on 3089; `drops` 137.
- **Skins.json (6776)** — all have `uniqueName`/`name`/`codexSecret`/`type`/`imageName`/`category`/`tradable`/`masterable`; `description` 6657; `excludeFromCodex` 1992; `drops` 376; `components` 301; `hexColours` 73.
- **Arcanes.json (172)** — `rarity`/`levelStats` 168; `wikiaUrl`/`introduced`/`releaseDate` 165; `drops` 162.
- **Primary.json (195)** — full weapon stat block on all 195, plus `disposition`, `attacks`, `tags`; `magazineSize` 193; `exilusPolarity` 188; `components` 165; `polarities` 141.

### 1c. Does `uniqueName` match the account's `ItemType`? — VERIFIED (with 14 exceptions)

Yes. Across all 24 category files (24,332 entries), **exactly 14 entries** carry a
`/Lotus/StoreItems/` prefix, all of them in `Misc.json`:

```
/Lotus/StoreItems/Types/Items/MiscItems/Forma
/Lotus/StoreItems/Types/Items/MiscItems/Kuva
/Lotus/StoreItems/Types/Items/MiscItems/UtilityUnlocker
/Lotus/StoreItems/Types/Items/FusionTreasures/OroFusexF
/Lotus/StoreItems/Types/Recipes/Components/OrokinCatalystBlueprint
/Lotus/StoreItems/Types/Recipes/Components/OrokinReactorBlueprint
/Lotus/StoreItems/Upgrades/Mods/Fusers/LegendaryModFuser
/Lotus/StoreItems/Upgrades/Mods/FusionBundles/RareFusionBundle
/Lotus/StoreItems/Upgrades/Mods/Randomized/Raw{Melee,ModularMelee,ModularPistol,Pistol,Rifle,Shotgun}RandomMod
```

Their `name` fields are mangled too (`"Orokincatalystblueprint"`), which is the tell that these
leaked in from a store/reward table during WFCD's build. **Run every WFCD `uniqueName` through the
normaliser in §4 before using it as a key**, and these 14 fold onto their correct bare forms.

Everything else — all 121 warframes, all 195 primaries, all 1806 mods, all 3120 relics — is bare.

### 1d. npm usage, and why you should not use it here

```js
import Items from '@wfcd/items';
const items = new Items({ category: ['Primary', 'Secondary', 'Melee'] });
// options: category[] (default ['All']), ignoreEnemies, i18n, i18nOnObject
```

Valid categories (from the shipped JSDoc, VERIFIED): `All`, `Arcanes`, `Archwing`, `Arch-Gun`,
`Arch-Melee`, `Corpus`, `Enemy`, `Fish`, `Gear`, `Glyphs`, `Melee`, `Misc`, `Mods`, `Pets`,
`Primary`, `Quests`, `Relics`, `Resources`, `Secondary`, `Sentinels`, `Skins`, `Warframes`.

**Do not `npm i @wfcd/items` for the overlay.** VERIFIED from the tarball: the package is
**101.4 MB unpacked, 50 files**, and both `index.js` and `index.mjs` are `node:fs` loaders that
`readFileSync` JSON off disk at runtime. In an Overwolf renderer there is no `fs`, and a bundler
would have to inline 100 MB into your bundle. Fetch the JSON over HTTP instead (§8).

The npm build also inflates the files relative to the repo (`Warframes.json` 4.42 MB on npm vs
2.86 MB in the repo) — another reason to pull from the repo/CDN, not npm.

### 1e. Update cadence — VERIFIED

`.github/workflows/build.yaml`: `schedule: cron: '55 */3 * * *'` → **rebuilds every 3 hours**,
auto-commits `data/**` on change. Latest npm version at time of writing: **1.1275.75**.

---

## 2. DE PublicExport manifests

### 2a. Index — VERIFIED

`https://content.warframe.com/PublicExport/index_en.txt.lzma` → 490 bytes, LZMA1 "alone" with a
non-standard 13-byte header. Working Python:

```python
import lzma, urllib.request
raw = urllib.request.urlopen("https://content.warframe.com/PublicExport/index_en.txt.lzma").read()
filt = [{"id": lzma.FILTER_LZMA1, "dict_size": 1 << 24, "lc": 3, "lp": 0, "pb": 2}]
txt = lzma.LZMADecompressor(lzma.FORMAT_RAW, filt).decompress(raw[13:]).decode("utf-8")
```

Index contents as of 2026-08-31 (16 lines, `<Filename>!<hash>`):

```
ExportCustoms_en.json!00_z6+DxmOuJPrnkKv+auytSQ
ExportDrones_en.json!00_-2N+QHfciQUZhljJlrdz-w
ExportFlavour_en.json!00_WlpxKf-h5Mea-baBtLiEvA
ExportFusionBundles_en.json!00_hUiYYnklWYlkgXXWeNhmng
ExportGear_en.json!00_xyG3URz2HktqxDm3CO+Akw
ExportKeys_en.json!00_x1VPdMpOM3cO-Jrdq-hXGg
ExportRecipes_en.json!00_ftaIks7bCpxZmaQMDvAN7Q
ExportRegions_en.json!00_457BHCafc9wNaxtGHmvoOw
ExportRelicArcane_en.json!00_4eaEZQ8tiUZreFQMUuDNAA
ExportResources_en.json!00_rj70LhG1oC8E8MGC6cvCGw
ExportSentinels_en.json!00_8iGr2T9MTskXt5zeKEVNmQ
ExportSortieRewards_en.json!00_Bt+LyatkTjWOKpnU6GPeng
ExportUpgrades_en.json!00_rf4goWSYW4FjfaMFn3KoLg
ExportWarframes_en.json!00_gFCc6M4iI-LF11CBMzq4FQ
ExportWeapons_en.json!00_zwapa0tHPowLsyegwAU-zw
ExportManifest.json!00_DUrPwumJrmBlg+BF7pbMew
```

Fetch each at `https://content.warframe.com/PublicExport/Manifest/<Filename>!<hash>`.
URL-encode the line but **leave `!`, `+`, `-`, `_` and `.` unescaped** — encoding `+` breaks the
request. All 16 parsed as strict JSON on the first try (no newline-stripping needed on this build,
though DE has historically shipped invalid JSON — keep a `.replace(/[\r\n]/g,'')` fallback).

### 2b. Every manifest, real counts and real field names — VERIFIED (all 16 fetched & parsed)

| Manifest | Raw size | Root array(s) → count | Mastery / rank cap? |
|---|---:|---|---|
| `ExportWarframes_en` | 226.7 KB | `ExportWarframes` **125**, `ExportAbilities` 13 | **`masteryReq` on all 125.** `maxLevelCap` on 2 (both = 40) |
| `ExportWeapons_en` | 595.9 KB | `ExportWeapons` **837**, `ExportRailjackWeapons` 143 | **`masteryReq` on all 837.** `maxLevelCap` on 52 (all = 40) |
| `ExportSentinels_en` | 11.4 KB | `ExportSentinels` **34** | **No `masteryReq`.** No level cap |
| `ExportUpgrades_en` | 2917.9 KB | `ExportUpgrades` **1600**, `ExportModSet` 19, `ExportAvionics` 82, `ExportFocusUpgrades` 105 | No MR. **`fusionLimit` = max mod rank** |
| `ExportResources_en` | 979.2 KB | `ExportResources` **3522** | No |
| `ExportRecipes_en` | 1263.4 KB | `ExportRecipes` **1866** | No |
| `ExportRelicArcane_en` | 3169.8 KB | `ExportRelicArcane` **3261** | No. `fusionLimit` absent here; arcane rank via `levelStats` length (168 entries) |
| `ExportGear_en` | 53.5 KB | `ExportGear` **180** | No |
| `ExportCustoms_en` | 945.8 KB | `ExportCustoms` **4763** | No |
| `ExportDrones_en` | 2.4 KB | `ExportDrones` **6** | No |
| `ExportFlavour_en` | 650.3 KB | `ExportFlavour` **2623** | No |
| `ExportFusionBundles_en` | 9.7 KB | `ExportFusionBundles` **51** | No |
| `ExportKeys_en` | 12.2 KB | `ExportKeys` **46** | No |
| `ExportRegions_en` | 48.3 KB | `ExportRegions` **269** | **`masteryReq` on all 269** (node MR gate) |
| `ExportSortieRewards_en` | 77.8 KB | `ExportSortieRewards` 17, `ExportIntrinsics` 5, `ExportOther` 46, + `ExportNightwave` & `ExportRailjack` objects | No |
| `ExportManifest.json` | 3691.6 KB | `Manifest` **19843** | No — icon lookup table only |

**Total raw: 14.31 MB** (10.71 MB without `ExportManifest`).

Real field names, harvested from the real data (`count/total`):

**`ExportWarframes`** — `uniqueName`, `name`, `parentName`, `description`, `health`, `shield`,
`armor`, `stamina`, `power`, `codexSecret`, **`masteryReq`**, `sprintSpeed`, `abilities[]`,
`productCategory` (125/125); `passiveDescription` 118; `exalted[]` 35; `longDescription` 7;
`excludeFromCodex` 1.
`productCategory` distribution: `Suits` 117, `SpaceSuits` 5 (Archwings), `MechSuits` 2, `SpecialItems` 1.

**`ExportWeapons`** — `name`, `uniqueName`, `codexSecret`, `damagePerShot[20]`, `totalDamage`,
`description`, `criticalChance`, `criticalMultiplier`, `procChance`, `fireRate`, **`masteryReq`**,
`productCategory`, `omegaAttenuation` (837/837); `slot` 657; `noise`/`accuracy`/`trigger`/
`reloadTime`/`multishot` 396; `magazineSize` 382; melee block (`blockingAngle`, `comboDuration`,
`followThrough`, `slamAttack`, `slideAttack`, `heavyAttackDamage`, `heavySlamAttack`) 255–258;
`range`/`slamRadialDamage`/`slamRadius` 247; `excludeFromCodex` 71; **`maxLevelCap` 52**;
`sentinel` 24; `primeOmegaAttenuation` 5.

**`ExportUpgrades`** (mods) — `uniqueName`, `name`, `polarity`, `rarity`, `codexSecret`,
`baseDrain`, **`fusionLimit`** (1600/1600); `compatName` 1583; `type` 1583; `levelStats[]` 1468;
`subtype` 217; `isUtility` 194; `description` 142; `modSet` 72; `excludeFromCodex` 21;
`upgradeEntries` 17 (Riven templates); `availableChallenges` 7; `modSetValues` 5.

**`ExportRecipes`** — `uniqueName`, `resultType`, `buildPrice`, `buildTime`, `skipBuildTimePrice`,
`consumeOnUse`, `num`, `codexSecret`, `ingredients[]` (`{ItemType, ItemCount, ProductCategory}`),
`secretIngredients[]` (1866/1866); `primeSellingPrice` 313; `excludeFromCodex` 278.

**`ExportResources`** — `uniqueName`, `name`, `description`, `codexSecret`, `parentName` (3522/3522);
`excludeFromCodex` 691; `primeSellingPrice` 422; `showInInventory` 117; `longDescription` 6.

**`ExportRelicArcane`** — `uniqueName`, `name`, `codexSecret` (3261/3261); `description` 3089;
`relicRewards[]` 3089 (`{rewardName, rarity, tier, itemCount}`); `levelStats[]` 168 (the arcanes);
`rarity` 151; `excludeFromCodex` 4. It is relics *and* arcanes in one file: 3089 relics + 172 arcanes.

**`ExportSentinels`** — `uniqueName`, `name`, `health`, `shield`, `armor`, `stamina`, `power`,
`codexSecret`, `description`, `productCategory` (34/34); `excludeFromCodex` 2. **No `masteryReq`** —
this is why you cannot compute companion MR from DE's export alone.

**`ExportRegions`** — `uniqueName` (`"SolNode94"`, *not* a `/Lotus/` path), `name`, `systemIndex`,
`systemName`, `nodeType`, **`masteryReq`**, `missionIndex`, `factionIndex`, `minEnemyLevel`,
`maxEnemyLevel` — all 269/269.

**`ExportManifest`** — only `{uniqueName, textureLocation}`, 19843/19843. `textureLocation` is a
content-hashed path, e.g. `/Lotus/Interface/Icons/StoreIcons/.../VanquishedBanner.png!00_tRfV…`,
fetchable at `https://content.warframe.com/PublicExport/<textureLocation>`.

**`ExportGear`** / **`ExportKeys`** / **`ExportDrones`** / **`ExportFlavour`** / **`ExportCustoms`** /
**`ExportFusionBundles`** — see the table; all keyed by `uniqueName` + `name` + `description` +
`codexSecret`, with `parentName` on Gear/Keys/Resources and `fusionPoints` on FusionBundles (which
has **no `name` field at all** — 51/51 lack it).

### 2c. `uniqueName` prefix audit across all 16 manifests — VERIFIED

Of **20,112 distinct `uniqueName`s**, exactly **5** start with `/Lotus/StoreItems/`: 4 in
`ExportManifest` (icon rows) and 1 in `ExportSortieRewards.ExportOther`
(`/Lotus/StoreItems/Types/BoosterPacks/BaroTreasureBox`). **Every catalog manifest is 100 % bare.**

### 2d. Update cadence — VERIFIED from live headers

```
HEAD index_en.txt.lzma
  Content-Length: 490
  Last-Modified:  Wed, 19 Aug 2026 18:05:04 GMT
  ETag:           "1ea-6596a3e21e6a7"
  Cache-Control:  no-cache                      ← poll this
  Access-Control-Allow-Origin: *                ← fetchable from the overlay, no proxy

HEAD Manifest/ExportWarframes_en.json!00_gFCc…
  Content-Length: 232131
  Last-Modified:  Wed, 12 Aug 2026 13:13:11 GMT
  Cache-Control:  public, max-age=29836489      ← ~345 days; content-addressed, immutable
  Access-Control-Allow-Origin: *
```

The index changes when DE ships a build (hotfixes included, so realistically weekly-ish). The
manifest URLs are content-addressed, so **a changed hash *is* the change notification** — never
re-download a manifest whose hash you already have.

---

## 3. `warframe-public-export-plus` — the source I'd actually build on

<https://github.com/calamity-inc/warframe-public-export-plus> · npm `warframe-public-export-plus`
v0.6.8 · by *sainansama*. This is the data layer behind **browse.wf** and behind
**SpaceNinjaServer**, an open-source reimplementation of Warframe's own `inventory.php`.

Why it beats raw PublicExport for this job:

- Keyed as `{ uniqueName: {...} }` **objects, not arrays** — `catalog[itemType]` is O(1), no index build.
- **Data and localisation are split.** `Export*.json` holds `/Lotus/Language/...` label keys;
  `dict.en.json` resolves them. You pay for English once, not 15 times.
- Ships exports DE's index does **not** have: `ExportArcanes`, `ExportRelics` (split out from
  `ExportRelicArcane`), `ExportBoosters`, `ExportBoosterPacks`, `ExportBundles`, `ExportRewards`,
  `ExportVendors`, `ExportSyndicates`, `ExportDojoRecipes`, `ExportEnemies`, `ExportChallenges`,
  `ExportAchievements`, `ExportAnimals`, `ExportBounties`, `ExportCodex`, `ExportImages`,
  `ExportEmailItems`, `ExportTilesets`, `ExportMissionTypes`, `ExportFactions`, `ExportSystems`,
  `ExportVirtuals`, `ExportTextIcons`, `ExportIntrinsics`, `ExportNightwave`.
- Adds fields that are the whole answer to §5 and §6: **`vaultedAt`**, **`introducedAt`**,
  **`isStarter`**, **`isFrivolous`**, `variantType`, `tradable`, `platinumCost`, `partType`,
  `behaviours`, `defaultUpgrades`, `icon`.

Counts I parsed, 2026-08-31 (note they differ from DE's — `-plus` merges in supplementals):

| File | Entries | vs DE | Notable added fields |
|---|---:|---|---|
| `ExportWarframes` | 125 | = | `variantType`, `introducedAt`, `platinumCost`, `nemesisUpgradeTag`, `maxLevelCap` |
| `ExportWeapons` | 843 | +6 | `variantType`, `behaviours`, `partType`, `holsterCategory`, `tradable`, `introducedAt` |
| `ExportRailjackWeapons` | 155 | +12 | split into its own file |
| `ExportSentinels` | 38 | +4 | `defaultWeapon`, `defaultUpgrades`, `exalted` |
| `ExportUpgrades` | 1601 | +1 | **`isStarter` (104), `isFrivolous` (123)**, `introducedAt` (1438), `compat`, `tradable` |
| `ExportArcanes` | 177 | *(split out)* | `fusionLimit` on all 177, `distillPointValue` |
| `ExportRelics` | 3089 | *(split out)* | **`vaultedAt` (2932), `introducedAt` (3089)**, `era`, `quality`, `category`, `rewardManifest` |
| `ExportRecipes` | 2000 | +134 | `tradable`, `hidden`, `oneTimePurchasable`, `platinumCost` |
| `ExportResources` | 3467 | −55 | **`productCategory` (routing key!)**, `rarity`, `helminthSnack`, `pickupQuantity` |
| `ExportCustoms` | 4722 | −41 | `productCategory`, `platinumCost`, `excludeFromMarket` |
| `ExportKeys` | 574 | **+528** | `rewards`, `mission`, `chainStages`, `replayable` — full quest data |
| `ExportBoosters` | 11 | *(new)* | `typeName` — **required** for the booster join exception |
| `ExportFlavour` | 2579 | −44 | `base`, `titleTag`, `platinumCost` |

**Cadence caveat — VERIFIED and important.** The repo has **no scheduled build workflow** (only a
`validate-typings.yml` that runs on push). It is updated by hand. Latest commits at time of writing:
`2026-07-29 Update wiki data`, then 07-27, 07-26, 07-21, 07-04, 07-03, 07-02, 07-01. So it lags DE's
own export by **days to ~5 weeks** — as of 2026-08-31 the newest data is ~4½ weeks old. `vaultedAt`
itself was only added on 2026-07-02, so it is a young field.

**Treat `-plus` as the rich layer and DE's index as the freshness tripwire.** When DE's index hash
moves and `-plus` hasn't caught up, you can still fetch the changed DE manifest and merge.

---

## 4. The join problem (`StoreItems`)

### 4a. The rule — VERIFIED three independent ways

```
normalise(t):
  if t.startsWith("/Lotus/StoreItems/"):  return "/Lotus/" + t.slice("/Lotus/StoreItems/".length)
  if t in ExportBoosters:                 return ExportBoosters[t].typeName     // ← the exception
  return t                                                                     // already bare
```

**Evidence 1 — the data.** I resolved every reward reference in `ExportRelicArcane`:
**18,536 / 18,536 `relicRewards[].rewardName` values start with `/Lotus/StoreItems/`, and after the
single prefix replace, 18,536 / 18,536 resolve to a `uniqueName` that exists in the manifests.
Zero unresolved.**

**Evidence 2 — DE's own catalogs.** Of 20,112 distinct manifest `uniqueName`s, 5 are `StoreItems`
(all icon/store rows). The catalogs are the bare namespace; only *reward, vendor, store and bundle*
tables use the prefixed one.

**Evidence 3 — a working server implementation.** SpaceNinjaServer,
`src/services/itemDataService.ts` (fetched 2026-08-31):

```ts
export const isStoreItem = (type: string): boolean =>
    type.startsWith("/Lotus/StoreItems/") || type in ExportBoosters;

export const toStoreItem = (type: string): string => {
    if (type.startsWith("/Lotus/Types/Boosters/")) {
        const e = Object.entries(ExportBoosters).find(a => a[1].typeName == type);
        if (e) return e[0];
        throw new Error(`could not convert ${type} to a store item`);
    }
    return "/Lotus/StoreItems/" + type.substring("/Lotus/".length);
};

export const fromStoreItem = (type: string): string => {
    if (type.startsWith("/Lotus/StoreItems/"))
        return "/Lotus/" + type.substring("/Lotus/StoreItems/".length);
    if (type in ExportBoosters) return ExportBoosters[type].typeName;
    throw new Error(`${type} is not a store item`);
};
```

And the `-plus` README states it twice independently, for rewards and for vendors:
*"Rewards are given as StoreItems. If they start with `/Lotus/StoreItems/`, you can simply replace
this with `/Lotus/` to get the normal counterpart. Otherwise, it's a 3-day booster and you can find
it in ExportBoosters."*

### 4b. Does the *account* use bare `ItemType`? — VERIFIED BY IMPLEMENTATION, not by a live dump

I did not have a real GEP `match_info.inventory` payload to test against (see §9). But
SpaceNinjaServer's `inventoryService.ts` — which serves the same JSON shape `inventory.php` does —
calls `fromStoreItem()` **before** every `addItem()`:

```ts
const nonStoreItems = keyChainItems.map(item => fromStoreItem(item));
for (const item of nonStoreItems) await addItem(inventory, item);
```

```ts
message.att = reward.items.map(x => (isStoreItem(x) ? fromStoreItem(x) : x));
```

and `addItem` then writes the **bare** `typeName` into the inventory arrays. So: **rewards/vendors
in, bare types stored.** Boosters are stored bare too (`Boosters.push({ ItemType: typeName, … })`
where `typeName` is the `/Lotus/Types/Boosters/...` form).

**Practical instruction: normalise anyway.** The function above is idempotent on already-bare
strings, costs nothing, and covers you against DE leaking a prefixed type into some corner of the
dump (WFCD's own build leaked 14 of them, so it demonstrably happens).

### 4c. Which inventory array does an item land in? — VERIFIED from SpaceNinjaServer's `addItem`

This is the routing table you need to know *where* to look for an owned item. Source:
`src/services/inventoryService.ts`.

| Test on the bare type | Inventory array | Element shape |
|---|---|---|
| `t in ExportRecipes` | `Recipes[]` | `{ItemType, ItemCount}` |
| `t in ExportResources && productCategory == "MiscItems"` | `MiscItems[]` | `{ItemType, ItemCount}` |
| `… productCategory == "ShipDecorations"` | `ShipDecorations[]` | `{ItemType, ItemCount}` |
| `… productCategory == "FusionTreasures"` | `FusionTreasures[]` | `{ItemType, ItemCount, Sockets}` |
| `… productCategory == "Ships"` / `"CrewShips"` | `Ships[]` / `CrewShips[]` | equipment |
| `/Lotus/Types/Game/Projections/…` (relics) | **`MiscItems[]`** | `{ItemType, ItemCount}` |
| `t in ExportCustoms` (`productCategory` `WeaponSkins`/`CrewShipWeaponSkins`) | `WeaponSkins[]` / `CrewShipWeaponSkins[]` | `{ItemType, ItemId}` |
| `t in ExportFlavour` | `FlavourItems[]` | `{ItemType}` |
| `t in ExportUpgrades \|\| ExportArcanes \|\| /Lotus/Upgrades/Mods/…` **and** fingerprint is absent or `{"lvl":0}` | **`RawUpgrades[]`** | `{ItemType, ItemCount}` |
| …same, but fingerprint ≠ `{"lvl":0}` | **`Upgrades[]`** | `{ItemType, ItemId, UpgradeFingerprint}` |
| `t in ExportGear` | `Consumables[]` | `{ItemType, ItemCount}` |
| `t in ExportWeapons` (`totalDamage != 0`) | `LongGuns`/`Pistols`/`Melee`/… per `productCategory` | equipment |
| `t in ExportWarframes` / `ExportSentinels` | `Suits`/`SpaceSuits`/`MechSuits`/`Sentinels`/`KubrowPets`/`MoaPets` | equipment |
| `t in ExportBoosters` (or matching `typeName`) | `Boosters[]` | `{ItemType, ExpiryDate}` |
| `t in ExportBundles` | *(expanded into its contents)* | — |

`ExportResources[t].productCategory` distribution (VERIFIED, `-plus`, 3467 entries):
`MiscItems` 2054 · `ShipDecorations` 1386 · `FusionTreasures` 11 · `SupplyDrop` 8 · `Ships` 7 ·
`CrewShips` 1.

### 4d. The 27 equipment array keys — VERIFIED

From `src/types/inventoryTypes/inventoryTypes.ts`, `equipmentKeys`:

```
Suits, LongGuns, Pistols, Melee, SpecialItems, Sentinels, SentinelWeapons,
SpaceSuits, SpaceGuns, SpaceMelee, Hoverboards, OperatorAmps, Antiques,
MoaPets, Scoops, Horses, DrifterGuns, DrifterMelee, Motorcycles, CrewShips,
DataKnives, MechSuits, CrewShipHarnesses, KubrowPets, CrewShipWeapons,
CrewShipSalvagedWeapons, OperatorSuits
```

Each element (`IEquipmentDatabase`): `ItemType` (required), `ItemName?`, `Configs[]`, `XP?`,
`Polarized?`, `Polarity[]?`, `FocusLens?`, `ModSlotPurchases?`, `UpgradeType?`,
`UpgradeFingerprint?`, **`ModularParts?: string[]`**, `SkillTree?`, `ArchonCrystalUpgrades?`,
`Features?`, `Favorite?`, `Expiry?`, `InfestationDate?`.

Non-equipment counted arrays use `ITypeCount = { ItemType: string; ItemCount: number }`.

---

## 5. Vaulted / unobtainable items

### 5a. How they're marked

| Source | Field | Coverage (VERIFIED) |
|---|---|---|
| **DE PublicExport** | *nothing* | There is **no vault flag anywhere in the 16 manifests.** DE does not export it. |
| **`-plus` `ExportRelics`** | `vaultedAt` (ISO date), `introducedAt` | 2932 of 3089 rows have `vaultedAt`. Machine-readable, best source for relics. |
| **WFCD** | `vaulted: bool`, `vaultDate`, `estimatedVaultDate` | Warframes 44 T / 7 F; Primary 24 T / 10 F; Secondary 25 T / 6 F; Melee 32 T / 9 F; Sentinels 6 T; Arch-Gun 2 T; Archwing 1 T; SentinelWeapons 2 T / 3 F; Relics 2953 T / 136 F. Wiki-sourced. |
| **Either** | `excludeFromCodex: true` | The "never shown in codex" flag — dev artefacts, enemy weapons, exalted weapons. Weapons 71, Warframes 1, Upgrades 21, Skins 1992, Customs 1213. |
| **`-plus` `ExportUpgrades`** | `isStarter`, `isFrivolous` | 104 + 123 mods. Per the `-plus` README these are how you drop duplicate-named Flawed variants and dev artefacts. |
| **`-plus`** | `excludeFromMarket` | Not-purchasable, ≠ unobtainable. Do not use as a vault proxy. |

Note the two `vaulted` sources **disagree**: `-plus` says 733 of 773 base relics vaulted (40
unvaulted); WFCD says 738 of 778 Intact vaulted (34 unvaulted, 6 null). Neither is authoritative —
`-plus` is ~4½ weeks stale, WFCD is scraped from the wiki every 3 h. Prefer WFCD's for *currency*,
`-plus`'s `vaultedAt` for the *date*.

### 5b. How a completion percentage should treat them

Do not silently include or silently exclude. Both choices produce a number the player will call
wrong. The defensible design:

1. **Build the denominator from `masterable` (WFCD), not from "everything in the export."** That
   drops enemy weapons, Duviri Dax weapons, exalted weapons, dev artefacts and modular parent
   suits — none of which a player can own. See §7a for why this matters.
2. **Then split the denominator into three visible buckets** and show all three:
   - **Obtainable now** — the honest headline. `312 / 487 (64 %)`.
   - **Vaulted** — obtainable by trade only (`tradable: true`) or by waiting for an unvault.
     Show as a separate ring, e.g. `+41 vaulted owned / 96 vaulted`.
   - **Truly unobtainable** — Excalibur Prime, Lato/Skana Prime (Founders). Exclude from the
     denominator entirely and footnote the count. Otherwise no account can ever read 100 % and the
     whole panel becomes noise.
3. **Never round 99.6 % up to 100 %.** Use `Math.floor` on the percentage and show the raw
   `owned / total` next to it. The one item a completionist is missing is the whole point of the
   panel.
4. Drive the buckets off `vaulted` at render time, so an unvault event fixes itself on the next
   catalog refresh with no code change.

---

## 6. Mods

### 6a. How many, and how to enumerate — VERIFIED

- **`ExportUpgrades`: 1600** entries (DE) / **1601** (`-plus`). This is the mod catalog.
- Plus `ExportAvionics` **82** (Railjack), `ExportFocusUpgrades` **105** (Focus), `ExportModSet` **19**
  (set-bonus definitions, not ownable), `ExportArcanes` **177** (`-plus`, split out).
- WFCD `Mods.json` has **1806** — it merges mods + avionics + focus + set rows into one file.

Filtering to "real, collectable" mods, per the `-plus` README's own guidance
(*"Several mods share the same name … These can be avoided by checking that `isStarter` and
`isFrivilous` [sic] are both absent"*):

```js
const realMods = Object.entries(ExportUpgrades)
  .filter(([, m]) => !m.isStarter && !m.isFrivolous && !m.excludeFromCodex);
```

→ **1360 mods** (VERIFIED). That's the number to put in "you own X of 1360 mods."

Rarity split of the full 1601: `RARE` 876 · `UNCOMMON` 414 · `COMMON` 231 · `LEGENDARY` 80.
`type` split (top): WARFRAME 417 · PRIMARY 340 · MELEE 203 · SECONDARY 174 · SENTINEL 95 ·
STANCE 85 · `---` 80 · PARAZON 40 · ARCH-GUN 38 · AURA 36 · ARCH-MELEE 20 · KAVAT 19 · KUBROW 18 ·
ARCHWING 15 · HELMINTH CHARGER 4.

### 6b. Duplicates and max rank — VERIFIED

A mod lives in one of **two** account arrays, and which one tells you its rank:

| Array | Shape | Meaning |
|---|---|---|
| `RawUpgrades[]` | `{ItemType, ItemCount}` | **Rank 0** copies. `ItemCount` **is** the duplicate count. |
| `Upgrades[]` | `{ItemType, ItemId, UpgradeFingerprint}` | **One object per physical ranked mod.** Duplicates = count the objects with the same `ItemType`. |

`UpgradeFingerprint` is a JSON **string**. For an ordinary mod it is `{"lvl":N}`; SpaceNinjaServer
branches on exactly this (`targetFingerprint != '{"lvl":0}'` → goes to `Upgrades[]`, else
`RawUpgrades[]`). For a **Riven** it is a much larger object (`{reqLevel, fits, upgrades:[…]}`) —
detect Rivens by `ItemType.startsWith("/Lotus/Upgrades/Mods/Randomized/")` and parse separately.

```js
const rank = JSON.parse(u.UpgradeFingerprint ?? '{"lvl":0}').lvl ?? 0;
const maxRank = ExportUpgrades[u.ItemType].fusionLimit;   // 0|3|5|8|10
const isMaxed = rank >= maxRank;
```

`fusionLimit` distribution across 1601 mods (VERIFIED): **3** → 762 · **5** → 565 · **10** → 228
(Primed/Umbral) · **8** → 17 · **0** → 29.

Total copies of a mod:
```js
(RawUpgrades.find(x => x.ItemType === t)?.ItemCount ?? 0)
+ Upgrades.filter(x => x.ItemType === t).length
```

Note `RandomUpgradesIdentified` (a count) and `Upgrades[].PendingRerollFingerprint` also exist on
the inventory if you want unidentified-Riven and rerolling state.

---

## 7. Relics, prime parts and sets

### 7a. Relics — VERIFIED

`-plus` `ExportRelics` has **3089** rows = every relic × every refinement. The `quality` field
separates them:

| `quality` | Rows | Refinement |
|---|---:|---|
| `VPQ_BRONZE` | **773** | Intact |
| `VPQ_SILVER` | 772 | Exceptional |
| `VPQ_GOLD` | 772 | Flawless |
| `VPQ_PLATINUM` | 772 | Radiant |

So there are **773 distinct relics**. By `era` (all rows): Lith 788 · Meso 752 · Neo 748 · Axi 768 ·
Requiem 17 · Vanguard 16.

Vault status of the 773 base relics: **733 vaulted, 40 unvaulted.** Unvaulted by era:
Lith 8 · Meso 9 · Neo 9 · Axi 13 · Requiem 1.

Relic entries have **no `name` field**. Per the `-plus` README you construct it from `category` +
`era` against the `/Lotus/Language/Relics/VoidProjectionName` label. Example row:

```json
"/Lotus/Types/Game/Projections/T5VoidProjectionImmortalOmniA": {
  "category": "Eterna", "era": "Requiem", "quality": "VPQ_BRONZE",
  "icon": "/Lotus/Interface/Icons/Relics/RelicImmortalC.png",
  "description": "/Lotus/Language/Relics/ImmortalProjectionBaseDesc",
  "rewardManifest": "/Lotus/Types/Game/MissionDecks/ImmortalRelicRewards/ImmortalOmni",
  "introducedAt": "…", "vaultedAt": "…"
}
```

If you want ready-made names + reward tables without the label indirection, WFCD `Relics.json`
(3120 rows, `name: "Axi A1 Exceptional"`, `rewards[]`, `vaulted`) is the easier read.

**Owned relics live in `MiscItems[]`** (VERIFIED from `addItem`'s `/Lotus/Types/Game/Projections/`
branch), keyed by the *refined* type, e.g. `…T2VoidProjectionGaussPrimeDBronze`. `ItemCount` is how
many you hold. The inventory also carries a `HasOwnedVoidProjectionsPreviously` boolean.

### 7b. Prime parts — VERIFIED

Prime components are **not** a separate export. They are ordinary `ExportResources` /
`ExportRecipes` rows distinguished by one field:

- **`ExportRecipes[x].primeSellingPrice`** → **313** entries. These are prime **blueprints**
  (`/Lotus/Types/Recipes/WarframeRecipes/MagPrimeBlueprint`). Owned → `Recipes[]`.
- **`ExportResources[x].primeSellingPrice`** → **422** entries. These are prime **parts**
  (`/Lotus/Types/Recipes/WarframeRecipes/MagPrimeHelmetComponent`). Owned → `MiscItems[]`.

The value itself is the **Ducat price**, which you get for free — nice for a "Ducats sitting in your
inventory" stat.

Prime *items* are flagged by `variantType: "VT_PRIME"` in `-plus`: **50 prime warframes**, **115
prime weapons** (VERIFIED). Warframe `variantType` split: `VT_NORMAL` 73 · `VT_PRIME` 50 ·
`VT_VARIANT` 2. WFCD flags the same thing as `isPrime`.

### 7c. Determining a completed prime set — VERIFIED against Mag Prime

Walk the recipe graph. Build `byResult: resultType → [blueprintUniqueName]` from `ExportRecipes`,
then for a prime item:

```
/Lotus/Types/Recipes/WarframeRecipes/MagPrimeBlueprint
  → resultType /Lotus/Powersuits/Mag/MagPrime
  → ingredients:
      x1 /Lotus/Types/Recipes/WarframeRecipes/MagPrimeHelmetComponent
      x1 /Lotus/Types/Recipes/WarframeRecipes/MagPrimeChassisComponent
      x1 /Lotus/Types/Recipes/WarframeRecipes/MagPrimeSystemsComponent
      x3 /Lotus/Types/Items/MiscItems/OrokinCell        ← plain resource, ignore for set completion
```

A set is **complete** when any of these holds:

1. The built item is in the equipment array — `Suits[].ItemType == "/Lotus/Powersuits/Mag/MagPrime"`.
   (Owning the frame is the strongest signal; the parts were consumed.)
2. Or you hold the top blueprint (`Recipes[]`) **and** every ingredient that itself has a
   `primeSellingPrice`, at the required `ItemCount`, in `MiscItems[]`.
3. Or a mix — some parts built into sub-components, some still raw.

Coverage check (VERIFIED): 49 of 50 prime warframes and 96 of 115 prime weapons have a recipe in
`ExportRecipes`. The misses are Founder-exclusive / never-craftable primes — handle them as the
"truly unobtainable" bucket from §5b.

WFCD gives you the same graph pre-expanded as `components[]` on each prime item, each component
carrying its own `drops[]` with the exact relic and refinement tier — that is the easy path if you
also want "which relic do I run next."

---

## 8. The fetch plan

### 8a. The finding that decides it — VERIFIED

I measured raw vs `Accept-Encoding: gzip` transfer size on every host:

| URL | Raw | With gzip | Ratio |
|---|---:|---:|---:|
| `content.warframe.com` ExportUpgrades | 2918 KB | **2918 KB** | **1.0×** |
| `content.warframe.com` ExportRelicArcane | 3170 KB | **3170 KB** | **1.0×** |
| `content.warframe.com` ExportWeapons | 596 KB | **596 KB** | **1.0×** |
| `cdn.jsdelivr.net` `-plus` ExportRelics | 1467 KB | **34.9 KB** | **42×** |
| `cdn.jsdelivr.net` `-plus` ExportWeapons | 1587 KB | **92.5 KB** | **17×** |
| `cdn.jsdelivr.net` `-plus` ExportUpgrades | 1441 KB | **71.4 KB** | **20×** |
| `cdn.jsdelivr.net` WFCD Warframes.json | 2928 KB | **172.3 KB** | **17×** |
| `cdn.jsdelivr.net` WFCD Mods.json | 5611 KB | **392.2 KB** | **14×** |

**DE's CDN sends no `Content-Encoding` at all.** Pulling all 16 manifests from DE costs the user
**14.3 MB on the wire**. The same catalog coverage from jsDelivr costs a few hundred KB.

All three hosts send `Access-Control-Allow-Origin: *`, so the overlay can fetch any of them directly
with no proxy and no Overwolf `externally_connectable` gymnastics beyond listing the hosts.

### 8b. Recommended: fetch from jsDelivr, use DE only as the tripwire

**Every cold start (cheap, ~0.5 KB):**

```
GET https://content.warframe.com/PublicExport/index_en.txt.lzma
    If-None-Match: <stored ETag>
```
490 bytes, `Cache-Control: no-cache`, real `ETag`. A `304` means DE has not shipped a build → your
cached catalog is current, stop. A `200` means the game updated → refresh the catalog below and
record the new hashes.

**Catalog refresh (only when the tripwire fires, or weekly, whichever first):**

| # | URL | gzip | Gives you |
|---|---|---:|---|
| 1 | `cdn.jsdelivr.net/npm/warframe-public-export-plus@latest/ExportWeapons.json` | ~93 KB | 843 weapons, `masteryReq`, `variantType`, `partType`, `behaviours` |
| 2 | `…/ExportWarframes.json` | ~20 KB | 125 frames/archwings/mechs |
| 3 | `…/ExportSentinels.json` | ~5 KB | 38 companions |
| 4 | `…/ExportUpgrades.json` | ~71 KB | 1601 mods, `fusionLimit`, `isStarter`/`isFrivolous` |
| 5 | `…/ExportArcanes.json` | ~25 KB | 177 arcanes |
| 6 | `…/ExportRelics.json` | ~35 KB | 3089 relic rows + `vaultedAt` |
| 7 | `…/ExportResources.json` | ~90 KB | 3467, `productCategory` routing + `primeSellingPrice` |
| 8 | `…/ExportRecipes.json` | ~80 KB | 2000 recipes → the prime-set graph |
| 9 | `…/ExportBoosters.json` | ~1 KB | **required** for the booster join exception |
| 10 | `…/ExportCustoms.json` | ~110 KB | 4722 skins |
| 11 | `…/ExportGear.json` | ~5 KB | 179 consumables |
| 12 | `…/dict.en.json` | ~350 KB | resolves every `/Lotus/Language/...` label |
| 13 | `cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/Warframes.json` | ~172 KB | **`masterable`** + `vaulted` + `components` |
| 14 | `…/Primary.json`, `Secondary.json`, `Melee.json` | ~450 KB | same, for weapons |

**≈1.6 MB gzipped for the whole universe**, vs 14.3 MB from DE. Skip `i18n.json` (50 MB) and
`Enemy.json` always.

Pin `@0.6.8` / a commit SHA instead of `@latest` / `@master` if you want reproducible builds —
jsDelivr caches pinned URLs immutably (`max-age=604800, s-maxage=43200` on floating refs).

### 8c. Minimal variant (if you only want "you own X of Y")

Three files, **~0.7 MB gzipped**:

1. WFCD `Warframes.json` + `Primary.json` + `Secondary.json` + `Melee.json` + `Sentinels.json` +
   `SentinelWeapons.json` + `Pets.json` + `Archwing.json` + `Arch-Gun.json` + `Arch-Melee.json`
   → filter `masterable: true` → **803 items**, your denominator.
2. `-plus` `ExportUpgrades.json` → 1360 real mods.
3. `-plus` `ExportRelics.json` → 773 relics + vault status.

### 8d. If you must go direct to DE

Only worth it when `-plus` is stale and you need same-day data. Fetch the index, diff the hashes
against what you stored, and re-download **only the changed manifests**. The URLs are
content-addressed with `max-age=29836489` (~345 days), so a hash you have already seen never needs
re-fetching. **Never fetch `ExportManifest.json` (3.7 MB, ungzipped) unless you actually need icon
paths** — it is 26 % of the total payload and contains nothing but `{uniqueName, textureLocation}`.

### 8e. Caching

- **Store the parsed catalog, not the raw JSON.** You need `Map<uniqueName, entry>` at lookup time;
  reparsing 1.6 MB of JSON on every overlay open is wasted frame budget.
- **Key the cache on DE's index ETag**, not on a timestamp. That is the only signal that actually
  correlates with the data changing. Store `{ etag, fetchedAt, catalog }`.
- IndexedDB, not `localStorage` — the parsed catalog is several MB and `localStorage` is a
  synchronous ~5 MB cliff that will jank the overlay.
- Ship a **baked-in snapshot** of the minimal catalog with the app so the first render is instant
  and the app degrades gracefully when offline or when jsDelivr is blocked. Refresh in the
  background.
- Refresh policy: tripwire on launch, hard TTL of 7 days, manual "refresh catalog" button. Do not
  poll more often than that — WFCD rebuilds every 3 h but the *catalog* only meaningfully changes on
  a game update.

---

## 9. Gaps — what I could NOT verify

1. **No live GEP `match_info.inventory` payload.** There is no captured dump anywhere in
   `C:\Claude\Warframe` (I searched every non-`node_modules` JSON for `LongGuns`/`RawUpgrades` —
   nothing). Everything in §4b about the account side is inferred from **SpaceNinjaServer's
   reimplementation** of `inventory.php`, which is strong evidence but is not DE's own code. **The
   very first thing to do with a real dump is assert that no `ItemType` in it starts with
   `/Lotus/StoreItems/`.** If that assertion ever fires, §4a's normaliser already handles it.
2. **`masterable` has no primary source.** It is WFCD's own derived flag, built partly from wiki
   scraping. I could not find a DE field that expresses it. The 803 count is WFCD's opinion.
3. **The two `vaulted` datasets disagree** (§5a): 40 vs 34 unvaulted relics. I did not resolve which
   is right. Both are wiki-derived; WFCD's is fresher.
4. **`-plus` freshness is unmanaged.** No CI schedule, hand-updated, last data commit 2026-07-29 —
   ~4½ weeks stale as of this writing. It could go stale for longer. Any design that depends on it
   for *current* vault status needs the WFCD fallback.
5. **Modular weapon MR is only partly modelled.** WFCD counts modular *parts* as masterable
   (Zaw tips, Kitgun chambers, Amp prisms/scaffolds/braces, Moa heads, Hound heads, K-Drive decks —
   32 such entries, 27 of which carry a `partType` in `-plus`). I verified the account stores them
   in `IEquipmentDatabase.ModularParts: string[]`, but I did **not** verify DE's actual MR-award
   rule for a given part combination. Treat modular MR as approximate until tested against a real
   account.
6. **Arcane rank cap.** DE's `ExportRelicArcane` has no `fusionLimit`; `-plus`'s `ExportArcanes`
   does (all 177). I did not cross-check those values against in-game behaviour.
7. **Quest/`ExportKeys` discrepancy.** DE ships 46 keys, `-plus` ships **574** (it merges in quest
   chain data). I did not audit which of the 574 are player-ownable quest keys vs internal chain
   nodes — relevant if you want a quest-completion panel.
8. **`ExportRegions` `uniqueName` is not a `/Lotus/` path** (`"SolNode94"`). It joins against the
   account's `Missions[].Tag`, not against `ItemType`. I did not verify that join.
9. **I did not fetch wiki.warframe.com at all.** Every number here comes from DE's CDN, GitHub, npm
   or jsDelivr. Nothing in this document is wiki prose.

---

## Appendix A — the masterable denominator, per category (WFCD, VERIFIED)

Bucketed by **filename** (see §1a on why `category` lies for `SentinelWeapons.json`), then by `type`:

| File | `type` | Masterable |
|---|---|---:|
| Melee | Melee | 214 |
| Melee | Zaw Component | 11 |
| Secondary | Pistol | 121 |
| Secondary | Dual Pistols | 14 |
| Secondary | Throwing | 13 |
| Warframes | Warframe | 120 |
| Primary | Rifle | 116 |
| Primary | Shotgun | 36 |
| Primary | Bow | 16 |
| Primary | Sniper | 15 |
| Primary | Launcher | 11 |
| Primary | Pistol | 1 |
| SentinelWeapons | Companion Weapon | 24 |
| Pets | Pets | 22 |
| Arch-Gun | Arch-Gun | 20 |
| Sentinels | Sentinel | 17 |
| Melee | Rifle | 10 |
| Arch-Melee | Arch-Melee | 8 |
| Archwing | Archwing | 5 |
| Misc | K-Drive Component | 5 |
| Misc | Kitgun Component | 4 |
| **TOTAL** | | **803** |

A "weapons" headline number, if you want one: **Primary 195 + Secondary 148 + Melee 235 +
SentinelWeapons 24 + Arch-Gun 20 + Arch-Melee 8 = 630 masterable weapons.**

### Why not just filter PublicExport yourself

I tried. Filtering `ExportWeapons` to entries with `behaviours` (the `-plus` README's own
"is it a real weapon" test) and no `excludeFromCodex`, plus all non-excluded warframes and
sentinels, gives **783** — and the diff against WFCD's 803 is instructive (VERIFIED):

- **32 items WFCD counts that the naive filter misses** — all modular *parts*: Zaw `Tip/TipOne…`,
  Moa `MoaPetHeadLambeo`, Hound `ZanukaPetPartHeadA`, K-Drive `HoverboardCorpusADeck`, and
  `OrionSuit`. These genuinely grant MR; the assembled weapon does not exist as a catalog row.
- **12 items the naive filter counts that WFCD rejects** — Duviri/Dax NPC weapons
  (`DaxDuviriHammerPlayerWeapon`, `DuviriDualSwords`), a Jade Shadows boss weapon, and the modular
  *parent* suits (`MoaPetPowerSuit`, `ZanukaPetAPowerSuit`). None are ownable.

All 803 WFCD-masterable `uniqueName`s **do** exist somewhere in the `-plus` exports, so you can
safely use WFCD purely as the *whitelist* and `-plus` as the *data*.

---

## Appendix B — copy-paste normaliser

```ts
// The only string transform you need to join account ItemType ↔ catalog uniqueName.
// Idempotent: safe to run on already-bare strings.
const STORE = "/Lotus/StoreItems/";

export function normaliseItemType(t: string, boosters: Record<string, { typeName: string }>): string {
  if (t.startsWith(STORE)) return "/Lotus/" + t.slice(STORE.length);
  const b = boosters[t];                 // ExportBoosters, 11 entries — the one non-prefix case
  return b ? b.typeName : t;
}
```

Verified against 18,536 real reward references: 100 % resolve. Load `ExportBoosters.json` (~1 KB
gzipped) or the booster branch silently no-ops and 11 booster types never match.

---

## Appendix C — sources, all fetched 2026-08-31

| What | URL |
|---|---|
| DE PublicExport index | `https://content.warframe.com/PublicExport/index_en.txt.lzma` |
| DE manifests | `https://content.warframe.com/PublicExport/Manifest/<Filename>!<hash>` |
| DE game icons | `https://content.warframe.com/PublicExport/<textureLocation>` |
| WFCD warframe-items | `https://github.com/WFCD/warframe-items` · `data/json/*.json` |
| WFCD via CDN | `https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/<File>.json` |
| WFCD build cadence | `.github/workflows/build.yaml` → `cron: '55 */3 * * *'` |
| warframe-public-export-plus | `https://github.com/calamity-inc/warframe-public-export-plus` |
| …via CDN | `https://cdn.jsdelivr.net/npm/warframe-public-export-plus@latest/<File>.json` |
| …README (StoreItems + filtering rules) | repo root `README.md` |
| SpaceNinjaServer (inventory.php reimpl.) | `https://github.com/spaceninjaserver/SpaceNinjaServer` |
| …`fromStoreItem` / `toStoreItem` / `getMaxLevelCap` | `src/services/itemDataService.ts` |
| …`addItem` routing, `addBooster` | `src/services/inventoryService.ts` |
| …`equipmentKeys`, `IRawUpgrade`, `IUpgradeClient` | `src/types/inventoryTypes/inventoryTypes.ts` |
| …`IEquipmentDatabase` (`ModularParts`, `XP`) | `src/types/equipmentTypes.ts` |
| browse.wf (human-readable view of `-plus`) | `https://browse.wf/` |
