# Data sources — verified 2026-08-31

Everything below was checked live against the actual endpoints, the local Overwolf install, or the shipped binaries.
Anything unverified is labelled as such. Re-verify before relying on a row that matters.

---

## 1. Overwolf

**Warframe game id: `8954`** — this is the *game id* (== `RunningGameInfo.classId`), and it is what goes in
`manifest.json` under `game_targeting.game_ids`, `game_events`, and `launch_events[].event_data.game_ids`.

Confirmed three ways:

- `https://game-events-status.overwolf.com/8954_prod.json` → `{"game_id":8954,"name":"Warframe","state":1,"published":true,"disabled":false,"disabled_electron":false,"is_vgep":false}`
- The local GEP provider's `manifest.json` lists `8954` in `supported_games`
- `%LOCALAPPDATA%\Overwolf\GamesList.*.xml` → `<ID>89541</ID>` for Warframe

`89541` is an **instance id**, not the game id. Instance ids are the game id with one digit appended
(Steam / Epic / 32- vs 64-bit variants). `Math.floor(id / 10) === classId`. Never put an instance id in the manifest.

The local games list also confirms `InjectionDecision: Supported` and `GameRenderers: D3D9 D3D11 D3D12`, so a true
in-game overlay works.

### GEP features — the whole set is four

Warframe's provider is thin. Verified against `dev.overwolf.com` **and** by extracting strings from the local
`Extensions/…/plugins/64/gep_warframeext.dll`:

| Feature | Key | Delivery | Contents |
| --- | --- | --- | --- |
| `gep_internal` | `version_info` | info update | provider version |
| `game_info` | `username` | info update | display name |
| `match_info` | **`inventory`** | info update | **the account dump — see below** |
| `match_info` | `highlighted` | info update | item currently hovered in-game, `{name, riven_details}` |
| `chat` | `chat` | event | every chat line, `"Player: message"` |

There is **no** `kill`, `death`, `match_start`/`match_end`, `mission`, `squad`, `location` or `health` for Warframe.
The DLL's own symbols (`GameMemoryMonitor`, `GameScanner`, `TaskChat`, `TaskDbgLog`) show it works by scanning the
game's memory and parsing its log — which is why the gentleness rule in this app exists.

**`match_info.inventory` is the important one.** It is roughly a 16 KB serialized dump of the account, in the same
shape `inventory.php` returns — including `QuestKeys`, `Missions`, `XPInfo`, `PlayerLevel`. Overwolf's own sanctioned
plugin does the memory read; the app just receives it. No credentials, no scanning of our own.

`match_info.highlighted` is the genuinely unique Overwolf capability — it is what makes a live pricing overlay
possible without OCR.

### Manifest facts worth remembering

- `manifest_version` is the integer `1`; `type` is only ever `"WebApp"`
- `permissions` sits at the **top level**, not inside `data`
- **`block_top_window_capture` does not exist** — the real key is `block_top_window_navigation`
- `externally_connectable.matches` doubles as the CORS allowance for `fetch`
- `FileSystem` is, per the docs, the only permission Overwolf actually enforces

### Tooling

- `overwolf-cli` and `create-overwolf-app` **do not exist on npm**. The real CLI is **`@overwolf/ow-cli`** (0.1.8),
  and it is packaging/publishing only — there is no official scaffolder.
- Loading unpacked requires the Overwolf account to be **whitelisted as a developer**, otherwise the app loads as
  *"Unauthorized App"*.
- Dev tools are off by default since client 0.153 — enable with the registry key in the README.

---

## 2. Reading the account

### 2a. GEP inventory — primary, and what this app uses

Push-delivered while Warframe runs. Richest source: has `QuestKeys` (quest completion), `Missions[]` (per-node
completion counts), `XPInfo`, `PlayerLevel`. No network call, no credentials, no account id needed.

### 2b. Public profile endpoint — supplementary, works with the game closed

```
GET https://api.warframe.com/cdn/getProfileViewingData.php?playerId=<24-hex accountId>
```

Unauthenticated, `200`, ~731 KB, `Cache-Control: public, max-age=600`. Platform hosts: `api-ps4`, `api-xb1`,
`api-swi`, `api-mob`, `api-and` — ids are not portable across them.

Has what GEP does not: `Stats.Weapons` (1738 entries with xp/kills), `Stats.Scans` (1378 — Simaris codex),
`ChallengeProgress` (822 entries), `Affiliations` (syndicate standing), `PlayerSkills` (Railjack + Drifter
intrinsics), `Stats.Missions`.

**Lacks**: `QuestKeys`, `NodeIntrosCompleted`, `FocusUpgrades`, `Recipes`/`MiscItems`, and full item ownership —
`LoadOutInventory.{Suits,Pistols,LongGuns,Melee}` is **equipped only**. So the two sources genuinely complement
each other.

Getting the account id: **name lookup is dead** (`?n=<name>` returns an empty body; the `content.warframe.com`
host 404s entirely). The only working route is the user logging into warframe.com and reading `user_id` from
`https://www.warframe.com/api/user-data` with their session cookie. The widely-cited "grab it from EE.log" trick is
**stale** — verified against the live 4.8 MB log on this machine: the login line carries no account id, and the only
24-hex values present are session ids.

Parser available: `npm i @wfcd/profile-parser` (WFCD, pushed 2026-08-31). Its README still documents the dead URL;
the parser itself is current.

`api.warframestat.us/profile/{accountId}` is a thin proxy over the same DE endpoint if you prefer WFCD's parsing.

### 2b-i. Live schema verification (2026-08-31, one request)

Confirmed against `getProfileViewingData.php` for the public example account, so the engine's join is not
guesswork:

- `Missions[]` entries carry exactly `{Completes, Tier, Tag, RewardsCooldownTime}` — no `HighScore`.
- **The array contains only completed content.** All 484 entries had `Completes > 0`, so presence alone
  implies a clear.
- `Tag` shapes observed: `SolNode###` (321 — the star chart), `<From>To<To>Junction`, `ClanNode###` (26),
  `CrewBattleNode###` (53, Railjack), `EventNode###` (29), `SettlementNode###` (20), hub nodes
  (`EarthHUB`, `CetusHub#`, `DeimosHub`, `EntratiLabHub`, `SolarisUnitedHub#`), Nightwave derelicts, and
  raid key paths. Only `SolNode###` and junction tags join to the vendored node graph; the rest are
  expected non-matches.
- `PlayerLevel` is the mastery rank integer (34 on the sampled account).
- **`XPInfo` and `QuestKeys` are absent** from this endpoint, confirming they come only from GEP.

Junction tags seen live include `CeresToJupiterJunction` and `ErisToSednaJunction` — independent
confirmation of the legacy-tag exception recorded in `junctions.json`.

### 2c. What this app will not do

`api.warframe.com/api/inventory.php?accountId=…&nonce=…` is live but requires a nonce scraped out of the running
game's memory. That is squarely inside the EULA's "intercept … communication between the Services and us", and
Overwolf's sandbox doesn't grant arbitrary `ReadProcessMemory` anyway. Not a path worth taking when GEP hands over
the same data.

The old email+password `login.php` flow is dead (404) and hashed with Whirlpool, not MD5. It would also mean
handling the user's password. Don't revive it.

---

## 3. Terms of service — read this before shipping

Digital Extremes publishes **no allow-list** and states plainly, in
`support.warframe.com/hc/en-us/articles/360030014351`:

> "If you use external software in conjunction with Warframe, then you do so at your own risk."

The EULA's Player Conduct section prohibits programs that "intercept, emulate, or redirect any communication between
the Services and us **or that collect information about the Game**" — language broad enough, on its face, to cover
even read-only polling of a public endpoint.

The frequently repeated claim that *"DE spoke with Overwolf and their apps are fine"* could **not** be verified —
the Warframe forums and devtrackers both refuse programmatic fetch, and the official support article says nothing
about Overwolf. Treat it as folklore until you see DE's own post.

Risk ranking, lowest first:

1. `getProfileViewingData.php` for the user's own id, respecting `max-age=600`
2. Parsing the user's own `EE.log` (no server contact, but still "collecting information about the Game")
3. Memory-scanning for the nonce — highest risk, and unnecessary here

**One concrete hazard**: hammering DE's endpoints risks an IP ban, and that ban also blocks logging into the game.
This is the practical reason the gentle-read layer exists, not just good manners.

---

## 4. Static datasets for the completionism engine

### DE PublicExport — canonical, content-addressed

```
GET https://content.warframe.com/PublicExport/index_en.txt.lzma        (490 bytes)
GET https://content.warframe.com/PublicExport/Manifest/<Filename>!<hash>
```

The index is **LZMA1 "alone" format with a non-standard header** — Python's `lzma` fails on `FORMAT_ALONE`. Working
recipe: strip the first 13 bytes, decode raw with `filters=[{id: FILTER_LZMA1, dict_size: 1<<24, lc:3, lp:0, pb:2}]`.

Manifests are immutable (hash in the URL) so they cache forever; poll the 490-byte index daily to detect updates.

- `ExportRegions_en.json` — **269 nodes**: `{uniqueName:"SolNode94", name, systemName, nodeType, masteryReq,
  missionIndex, factionIndex, minEnemyLevel, maxEnemyLevel}`. CORS-open. **No unlock graph, no tileset.**
- `ExportKeys_en.json` — 45 quests, `{uniqueName, name, description, parentName}`. **No prerequisites, no ordering**,
  and incomplete relative to the ~60 quests that exist.

#### What the export can and cannot re-source — measured, file by file

`npm run de` fetches all sixteen files with `provenance.json` beside them (content hash and fetch time per file).
A three-way survey against the app's own consumers, each claim re-measured by an independent verifier:

**`ExportWeapons_en.json`** — 837 rows in `ExportWeapons` plus 143 in `ExportRailjackWeapons`, 37 fields.
Every damage input the optimiser reads is present and one-to-one: `damagePerShot` (in the same 20-slot order as
`DAMAGE_ORDER`, verified index-for-index on nine weapons whose element is unambiguous), `totalDamage`,
`criticalChance`, `criticalMultiplier`, `procChance`, `fireRate`, `magazineSize`, `reloadTime`, `multishot`,
`masteryReq`, `maxLevelCap` (52 rows, all 40). Fractions, never percentages, and **per pellet** - the Hek's
`totalDamage` is 75, not 525, and `multishot` 7 is what makes up the difference.

**THE ONE FATAL GAP is `type`.** The display class - Rifle, Shotgun, Bow, Sniper, Launcher, Pistol, Melee - has
**no field in DE's export at all**. It is load-bearing: `eligibleSlots` switches on it and decides the entire mod
pool, and `questionFor` picks Q2 against Q3 from it. `productCategory` recovers Sentinel, Arch-Gun, Arch-Melee,
Pistol, Melee and exalted; what it cannot recover is the **LongGuns subdivision** (Rifle / Shotgun / Sniper / Bow /
Launcher) and Pets. A path heuristic does not rescue it: Lanka is `/ClanTech/Energy/Railgun`, and Tigris, Corinth,
Astilla and Arca Plasmor all sit under `/LongGuns/`. DE's own MOD side speaks the vocabulary
(`ExportUpgrades.compatName`: Rifle 119, Shotgun 119, Sniper 14, Bow 10, ...) - the join key exists on one side and
is unrepresented on the other. **A DE-only catalogue cannot mod a weapon correctly.**

Also absent: polarities of any kind, `attacks` (no per-fire-mode block), `chargeTime`, any ammo field, `masterable`,
and `rarity`/`vaulted`/`tradable`/`imageName`. `omegaAttenuation` is the raw riven disposition (46 distinct values,
0.5 to 1.55); WFCD's 1-5 dot bucket is derived and the boundaries are unpublished. Nothing reads it.

**`ExportUpgrades_en.json`** — 1,600 rows, and the mod side is far cleaner: `uniqueName` (0 duplicates, all 1,600
present in WFCD), `compatName` byte-identical to WFCD's `slot` (1,583 present, 17 absent, 0 differ), `baseDrain`
0/1,600 differ, `fusionLimit` 0/1,600 differ, `levelStats.length === fusionLimit + 1` on all 1,468 rows that have
them. Two things DE says that WFCD destroys: `type === 'AURA'` on exactly the 36 aura rows (WFCD rewrites all 36 to
'Warframe Mod'), and 104 `/Beginner$/` Flawed rows. What breaks on a raw DE feed is `polarity` - DE emits
`AP_ATTACK`/`AP_TACTIC`/... and `toPolarity` falls back to 'none', silently unpolarising every mod in the game.

**`ExportRegions_en.json`** — 267 of the app's 353 nodes overlap; `name` agrees on 255, `planet` on 262,
`minEnemyLevel` on 255, `maxEnemyLevel` on 250. Rows carry exactly ten keys on all 269, verified by field histogram
rather than by sampling: **no adjacency, prerequisite, next or previous field of any name.** Zero of the 13
junctions appear. `masteryReq` is non-zero on exactly two rows (Oro 5, Tyana Pass 3), so it is a rank gate and not
per-node mastery. `missionIndex` has 32 integer values and `factionIndex` 10, with **no string table anywhere in the
sixteen files** - and both collide (missionIndex 8 covers Defense, Mirror Defense and Stage Defense).

**`ExportManifest_en.json`** — 19,843 rows covering 16,943 of 16,943 catalogue ids with zero duplicates. It replaces
the id-to-art ASSOCIATION, not `imageName`: `textureLocation` is an internal path plus a hash
(`/Lotus/Interface/Icons/.../X.png!00_hash`), not a CDN filename.

**There is no enemy export.** DE publishes no enemy health, shield, armour or base level anywhere in the sixteen
files, so the level-9999 model cannot be sourced from game data the way a weapon can. That boundary is why
`src/data/armour.ts` cites the wiki with a verdict per rule and carries an `UNKNOWN` list.

**Two corrections worth keeping.** The control-character strip in `scripts/fetch-de-export.py` was a no-op on all
four files measured - they parse raw with zero sub-0x20 bytes outside tab, newline and return - so it is insurance,
not a requirement. And `unwrap` (`itemdb.ts`) explicitly rejects arrays, so pointed at a raw DE file it returns the
ROOT object and `parseRank40` yields **zero** entries rather than stringified indices: every Kuva/Tenet/Coda/
Paracesis weapon would silently plan at maxRank 30, i.e. three-quarters of its real capacity, with no error.

### The unlock graph — wiki only, and must be vendored

`https://wiki.warframe.com/w/Module:Missions/data` (last edited 2026-08-03) is the **only** machine-readable source
for node prerequisites:

```lua
{ Name = "Boethius", Planet = "Mercury", Type = "Mobile Defense", Tileset = "Grineer Asteroid",
  MinLevel = 8, MaxLevel = 10, MasteryExp = 3, InternalName = "SolNode223",
  NextNodes = { "Apollodorus" }, PreviousNodes = { "M Prime" } }
```

`InternalName` joins directly to `Missions[].Tag` from the account data. **That join is the backbone of the
"what node next" engine.**

⚠️ `wiki.warframe.com` sits behind a Cloudflare JS interstitial — `api.php`, `?action=raw` and `Special:CargoTables`
all return a challenge page to plain HTTP clients. **Scrape once, commit the parsed JSON, refresh by hand on major
updates.** Do not fetch it at runtime. (The Fandom mirror is scrape-friendly but frozen at 2025-01-14.)

### Gaps with no machine-readable source — hand-author these

- **Quest prerequisite graph** — nowhere. Wiki prose only.
- **Junction requirements** — nowhere; no `Module:Junctions/data` exists. ~11 junctions × ~4 tasks. An afternoon's
  work, and it changes rarely.

### Mastery math (wiki, verified)

- XP for rank *n* (0–30): **2,500 × n²**; Legendary *k*: **2,250,000 + 147,500 × k**, cap LR10
- Weapons **100/rank → 3,000** (Kuva/Tenet/Coda with 5 Forma reach rank 40 → 4,000)
- Warframes / companions / archwings **200/rank → 6,000**; Necramechs **8,000**
- Junction first clear **1,000**; node first clear per-node via `MasteryExp`
- Railjack and Drifter intrinsics **1,500 per rank** — pairs with `PlayerSkills`

### Drop tables

`https://drops.warframestat.us/data/{all,missionRewards,relics,…}.json`. Poll the 94-byte
`data/info.json` (`{hash, timestamp, modified}`) for change detection rather than the 4.5 MB payload.
Deploys roughly monthly.

---

## 5. Rate limits

| Service | Limit | Policy here |
| --- | --- | --- |
| `api.warframe.com/cdn/getProfileViewingData.php` | none published, `max-age=600` | **≥600 s.** Session start + manual refresh only. Excessive requests risk an IP ban that also blocks game login. |
| `content.warframe.com/PublicExport` | none | index daily; manifests immutable, cache forever |
| `api.warframestat.us` | none published, `max-age=120` | respect 120 s, send `If-None-Match` |
| `drops.warframestat.us` | none | `info.json` hourly, conditional-GET the rest |
| `warframe.market` | **3 req/s**, published | mandatory descriptive User-Agent with a contact URL; disguising as a browser is explicitly forbidden |
| `wiki.warframe.com` | Cloudflare challenge | never at runtime |

Set one descriptive User-Agent globally. `POLICY` in `src/core/gentle.ts` encodes these; keep the two in sync.

---

## 6. EE.log

`%LOCALAPPDATA%\Warframe\EE.log` — real, current, actively written (verified: 4.8 MB, updating live on this machine).
Carries mission name and node, `Game [Info]: OnStateStarted, mission type=MT_PURIFY`, squad countdown, host/client
role, and level path.

Read it with **`overwolf.io.*`** — `listenOnFile(id, path, {skipToEnd:true}, cb)` tails line-by-line and is built for
exactly this. It needs only the `FileSystem` permission. Do **not** use `overwolf.extensions.io.*` (its `StorageSpace`
enum can't reach arbitrary paths) and do not add the legacy `simple-io` plugin.

> **EE.log contains PII** — the account email and the machine's IP address appear in it. Read locally, never upload.

`WFCD/warframe-deathlog` is a working reference parser.

---

## 7. The vendored datasets (built 2026-08-31)

`src/data/vendor/` holds three files reconstructed from wiki prose, because the unlock graph and junction task
lists exist nowhere in machine-readable form. `npm run check:data` validates them.

| File | Contents | Source |
| --- | --- | --- |
| `nodes.json` | 355 nodes, 227 with `next`, 307 with `prev`, 89 with a prose gate, **0 unresolved, 0 dangling** | `wiki.warframe.com` `Module:Missions/data`, raw wikitext |
| `quests.json` | 45 quests, 44 with a canonical `/Lotus/` id, 27 mainline, no dependency cycles | `ExportKeys_en.json` for ids + per-quest raw wikitext for prerequisites |
| `junctions.json` | 13 junctions, 52 tasks (4 each) | Junction hub + 13 per-junction pages, raw wikitext |

### Four traps found the hard way

**1. Summarizing fetch tools return wrong wiki data.** Two calls on the same URL produced different, mutually
inconsistent junction→task mappings — the summarizer cannot handle the `<tabber>` transclusion layout, and it
invented junctions that do not exist while dropping real ones. Both results looked plausible. The quest pass hit the
same problem and had fabricated four prerequisites (a Europa Junction on *The New Strange*, a Jupiter-to-Europa
Junction on *The Limbo Theorem*, a Mastery Rank on *Natah*, a Venus Junction on *Vox Solaris*), all corrected
against raw wikitext. **Use `index.php?title=X&action=raw` through a real browser session.**

**2. `next` and `prev` are not mirror images.** 9 edges exist in one direction only, and they are exactly the planet
entry points. `CeresToJupiterJunction` declares `next: [SolNode100]`, but `SolNode100.prev` names an intra-Jupiter
node. An engine reading only `prev` leaves **132 of 355 nodes permanently unreachable** — all of Jupiter included.
`buildCatalog` therefore merges both relations into `predecessors`/`successors` indices, and both the engine and the
validator compute reachability over the union.

**3. Junction tags do not always follow `<From>To<To>Junction`.** DE moved the Jupiter Junction from Ceres to
Deimos and never re-tagged it, so it is still `CeresToJupiterJunction` — confirmed present in live account data.
Sedna's *was* updated (`ErisToSednaJunction`). Deriving ids from `from`/`to` silently fails to join. Exceptions must
carry an `idNote`, and the validator enforces that.

**4. DE reuses two InternalNames.** `ToggleBootLevel` and `SolNode236` each cover two entries. The catalog keys by
id, so one of each pair is dropped — harmless only because all four are edgeless, which the validator asserts rather
than assumes.

### Current topology (post-Update 39 "Isleweaver")

Earth→Venus, Venus→Mercury, Earth→Mars, Mars→Phobos, Mars→Ceres, **Deimos→Jupiter**, Jupiter→Europa,
Jupiter→Saturn, Saturn→Uranus, Uranus→Neptune, Neptune→Pluto, Pluto→Eris, **Eris→Sedna**. There is no Eris→Deimos
or Void junction; Void paths, Earth→Lua and Mars→Deimos have no junction at all.

### Known limits

- Quest `order` is a reconstructed sequencing, not DE's own.
- Non-quest gates ("Mastery Rank 5", "Observer rank with The Quills") cannot be verified from account data. Quests
  behind them are demoted rather than hidden, and the requirement is shown in the recommendation text.
- *The Maker* has no canonical id (cutscene, no `internalname`), so its completion can never be verified. It is
  reported as untrackable rather than recommended.
- *Prelude to War* is a narrative arc, not a quest, and has no key; The New War's requirement is expanded into its
  three chapters.

## 8. EE.log — verified parse (2026-08-31)

Run over a live 46,444-line log: **90 events matched, 31 complete mission runs, zero PII in any output.**

Line shapes, in the order they appear per mission:

```
Script [Info]: ThemedSquadOverlay.lua: Mission name: Oestrus (Eris)
Script [Info]: ThemedSquadOverlay.lua: Host loading {"difficulty":1,"name":"SolNode167"} with MissionInfo:
Script [Info]: ThemedSquadOverlay.lua: Lobby::Host_StartMatch: launching level for SolNode167 (/Lotus/Levels/...)
Game   [Info]: OnStateStarted, mission type=MT_PURIFY
Script [Info]: EndOfMatch.lua: Mission Succeeded
```

- The name line precedes the node line. An earlier tracker that reset state on mission start silently dropped the
  name from every run; the tracker is now order-independent and only resets on outcome.
- `difficulty` is a **float** (`0.375` observed), not an integer.
- Junctions appear here too — `PlutoToErisJunction` with `MT_JUNCTION` — so they join to `junctions.json`.
- `Sys [Info]: Logged in <DisplayName>` gives the username. The line three above it is
  `Sys [Info]: Logging in as <email>` — the parser matches an allowlist precisely so that line can never produce an
  event, and there is a dedicated regression test for it.
- Read with `encoding: 'UTF8'`; node names carry non-ASCII characters (Stöfler) that ANSI mangles.

