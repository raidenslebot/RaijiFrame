# EE.log mining — what a mission history can actually get from the engine log

Source: `C:\Users\Administrator\AppData\Local\Warframe\EE.log`
Captured: 2026-08-31, build label `2026.08.19.11.06 Retail Windows x64 [Stripped]`, build unique ID `427001834`.

## 0. Read this before trusting any count in here

**The log is truncated on every game launch.** This capture is exactly one session:
4,738 lines / 433 KB, process uptime 0.009 s → 3,389.996 s (56 min 30 s), ending with
`===[ Exiting main loop ]===`. There is exactly **one** `Process Command-line:` line and
exactly **one** `Current time:` line in the whole file. There is no `EE.log.old`, no rotated
copy anywhere under `%LOCALAPPDATA%\Warframe` or `C:\Games\Warframe` (checked).

**That session contained exactly one mission, and it was a Mastery Rank test**
(`MT_MASTERY`, ran in a dojo level, solo, from the front end). So:

| Class of finding | Confidence |
|---|---|
| Line shapes I quote below | **Verified** — copied from this file, counts are real |
| Session/lifecycle/timing structure | **High** — the full mission bracket is present and coherent |
| Reward, loot, kill, wave, rotation lines | **Verified absent from this capture** — see §4, §5 |
| `Host loading` / `Mission name:` / `launching level for` (what `eelog.ts` parses today) | **Not present in this capture at all.** They belong to squad-launched star-chart missions; a mastery test launched from the front end never emits them. Their absence here is *not* evidence they are gone. |

Occurrence counts below are "in this one 56-minute session". Treat them as shape evidence,
not as base rates. Anything I mark **NEGATIVE** means "I grepped for it across the whole
file and it is not there", which for the loot categories is the important result.

---

## 1. PII inventory — the redaction surface is bigger than the email

`eelog.ts` guards the email and IPv4. Both are confirmed present. Two more things are here
that the current `redact()` does **not** strip, and one parsing trap.

### 1.1 Confirmed PII

| What | Line shape | Count | Notes |
|---|---|---|---|
| Account email | `Sys [Info]: Logging in as <email>` | 3 | Lines 1225, 1250, 1274. Fires once per login attempt. `redact()` handles it. |
| Machine public IP | `Net [Info]: NAT bound for server to <ip>:<port>` | 56 | Also `NAT bound for client to`, `Client/Server test reply from <ip>`, `Pinging <ip> from client`, `Name lookup: arbiter.warframe.com <ip>`. ~150 lines carry an IP. `redact()` handles it. |
| **Windows user name** | `Sys [Diag]: Windows user-name: Administrator` | 1 | Line 4. **Not covered by `redact()`.** |
| **Machine name** | `Sys [Diag]: Windows computer-name: PC` | 1 | Line 5. **Not covered by `redact()`.** |
| **Account ID (stable, cross-session)** | `Net [Info]: AddSquadMember: <name>, mm=AAAAAAAAAAAAAAAAAAAAAAAA, squadCount=1` | 2 | The `mm=` value is a 24-hex Mongo ObjectId — a permanent account identifier. Also in `RemovePlayerFromSession(mm=…)`. **Not covered by `redact()`.** |
| **Other players' display names** | same `AddSquadMember` line, plus `EndOfMatch.lua: <name> - IsInTrigger=true`, `Received medals: <name>`, `Accepted challenge from: <name>` | — | This session was solo so only the local player appears. In a squad these are third parties' names. |
| Clan name | `Sys [Info]: Player name changed to <name> Clan: <TIER> <CLAN NAME>#<NNN>` | 1 | Clan name + clan tier. Semi-public but identifying. |
| Hardware / disk / memory | the whole `Sys [Diag]` header block (28 lines, all at t ≤ 4.1) | 28 | CPU model, RAM, free disk bytes, monitor resolution, system uptime. |

### 1.2 Recommendation

1. **Never read the header.** The first ~30 lines are pure `Sys [Diag]` fingerprinting
   material and contain nothing a mission history needs. The current `skipToEnd: true`
   already avoids them on a live tail — keep it, and do **not** add a "read the top for the
   wall-clock anchor" step (see §3 for a better anchor that needs no header read).
2. **Other players' names are personal data and the app has no consent to store them.**
   Recommendation: parse `AddSquadMember` only for `squadCount`, and never capture the name
   or the `mm=`. A mission history wants "3-player squad", not a roster. If a roster is ever
   wanted, it should be an explicit opt-in and store a per-session salted hash, never the
   `mm=` value.
3. Extend `redact()` with the two Windows identifiers and the account id, as defence in depth:
   ```ts
   .replace(/\bmm=[0-9A-Fa-f]{24}\b/g, 'mm=[id]')
   .replace(/(Windows (?:user|computer)-name: ).*/g, '$1[redacted]')
   ```

### 1.3 Parsing trap: U+E000 sticks to display names

77 lines carry `U+E000` (`\uE000`, Private Use Area) appended directly to the player's
display name — Warframe's platform/account decoration marker. Byte-level proof from line 1808:

```
... A d d S q u a d M e m b e r :   <  n a m e  > 356 200 200 ,   m m = 9 5 6 ...
                                                                ^^^^^^^^^^^ = EE 80 80 = U+E000
```

`Sys [Info]: Logged in <name>` (line 1275) is **plain** — no marker — which is why the
existing login regex `([A-Za-z0-9_.-]+)` works. But any future name capture using `(.+?)`
will silently include the glyph. Strip it:

```ts
const stripPua = (s: string) => s.replace(/[\uE000-\uF8FF]/g, '');
```

---

## 2. Mission lifecycle — the real bracket

### 2.1 Full observed sequence for the one mission in this log

Verbatim timeline (timestamps are seconds since process start):

| t | Line |
|---|---|
| 53.835 | `Game [Info]: FrameworkCmd::OpenLevel - /Lotus/Levels/Tenno/DojoFive.level` |
| 53.847 | `Sys [Info]: ChangeLobbyStatus(0)` |
| 53.849 | `Net [Info]: MatchingService::LeaveSquad` |
| 53.899 | `Sys [Info]: Server ready for load [Heap: …], sessionPlayers=1` |
| 53.903 | `Sys [Info]: EnterState: Challenge` → `Accepted` → `Loading` |
| 53.903 | `Game [Info]: Level=/Lotus/Levels/Tenno/DojoFive.level` |
| 56.109 | `Sys [Info]: Wall time: 2.2s (time waiting to start: 0.77s)` ← **level load time, not mission time** |
| 56.238 | `Sys [Info]: Loading game rules: LotusRankUpGameRules` |
| 56.239 | `Net [Info]: GameRulesImpl - changing state from SS_INVALID to SS_WAITING_TO_START` |
| 56.374 | `… SS_WAITING_TO_START to SS_ARBITRATION_REGISTER` → `SS_STARTING` → `SS_WAITING_FOR_PLAYERS` |
| 56.424 | `Sys [Info]: SyncAutoPopulatedConsumables for mission MT_MASTERY with location ` |
| 56.808 | `Sys [Info]: EnterState: Connected` |
| **56.910** | `Game [Info]: OnStateStarted, mission type=MT_MASTERY` |
| 56.910 | `Game [Info]: GameRulesImpl::StartRound()` |
| 56.910 | `Net [Info]: GameRulesImpl - changing state from SS_WAITING_FOR_PLAYERS to SS_STARTED` |
| 158.771 | `Sys [Info]: Stats uploaded` |
| **164.957** | `Script [Info]: EndOfMatch.lua: Mission Succeeded` |
| 164.957 | `Script [Info]: EndOfMatch.lua: EndOfMatch.lua: GiveMissionRewards. success=true` |
| 164.959 | `Sys [Info]: PlayerProfileCommon::SaveProfile()` |
| 164.960 | `Sys [Info]: Profile hash on write: <32 HEX>` |
| 164.960 | `Script [Info]: EndOfMatch.lua: <name> - IsInTrigger=true` ← extraction |
| 164.961 | `Sys [Info]: SyndicateXP base for mission: 289` |
| 164.961 | `Sys [Info]:  Received medals: <name>` |
| **164.961** | `Game [Info]: CommitInventoryChangesToDB` ← **the inventory-diff trigger** |
| 165.201 | `Script [Info]: EndOfMatch.lua: DbUpdateComplete` ← **inventory now durable server-side** |
| 167.500 | `Script [Info]: EndOfMatch.lua: EndOfMatch.lua - Close` |
| 167.504 | `Net [Info]: GameRulesImpl - changing state from SS_STARTED to SS_ENDING` → `SS_ENDED` |
| 167.504 | `Sys [Info]: GameRulesImpl::WriteStatsCallback [disconnecting=0, session ended=0]` |
| 167.504 | `Net [Info]: Set squad mission: ` |
| 167.504 | `Game [Info]: FrameworkCmd::OpenLevel - /Lotus/Levels/Proc/PlayerShip` |
| 167.737 | `Sys [Info]: ExitState: Connected` |
| 170.320 | `Sys [Info]: Loading game rules: AlternateLotusFrontEndGameRules` ← back in the orbiter |

### 2.2 The high-value patterns

| # | What | Regex | Count |
|---|---|---|---|
| L1 | Session state machine (best single lifecycle signal) | `/GameRulesImpl - changing state from (SS_[A-Z_]+) to (SS_[A-Z_]+)/` | 9 |
| L2 | Mission type + location, at load, *before* `OnStateStarted` | `/SyncAutoPopulatedConsumables for mission (MT_[A-Z_]+) with location (.*)$/` | 1 |
| L3 | Mission type at start (already parsed) | `/OnStateStarted, mission type=(MT_[A-Z_]+)/` | 1 |
| L4 | Game rules — distinguishes hub from mission | `/Sys \[Info\]: Loading game rules: (\w+)/` | 3 |
| L5 | Level / tileset path | `/Game \[Info\]: Level=(\/Lotus\/Levels\/[^\s]+)/` | 3 |
| L6 | Connection bracket (works as host *or* client) | `/Sys \[Info\]: (Enter\|Exit)State: (Connected\|Loading\|Synchronizing\|Prefetching\|Disconnected)/` | 24 |
| L7 | Outcome (already parsed) | `/EndOfMatch\.lua: Mission (Succeeded\|Failed)/` | 1 |
| L8 | Outcome, second witness | `/GiveMissionRewards\. success=(true\|false)/` | 1 |
| L9 | Extraction / in-trigger at end | `/EndOfMatch\.lua: .+ - IsInTrigger=(true\|false)/` | 1 |
| L10 | Inventory committed | `/Game \[Info\]: CommitInventoryChangesToDB/` | 1 |
| L11 | Inventory durable | `/EndOfMatch\.lua: DbUpdateComplete/` | 1 |
| L12 | Stats uploaded to DE | `/Sys \[Info\]: Stats uploaded/` | 1 |
| L13 | Profile written (fires on every save, not only missions) | `/Sys \[Info\]: Profile hash on write: ([0-9A-F]{32})/` | 2 |

Real example lines (all PII-free as written):

```
56.424 Sys [Info]: SyncAutoPopulatedConsumables for mission MT_MASTERY with location
56.238 Sys [Info]: Loading game rules: LotusRankUpGameRules
53.903 Game [Info]: Level=/Lotus/Levels/Tenno/DojoFive.level
56.910 Net [Info]: GameRulesImpl - changing state from SS_WAITING_FOR_PLAYERS to SS_STARTED
167.504 Net [Info]: GameRulesImpl - changing state from SS_STARTED to SS_ENDING
```

`Loading game rules:` is the cheapest hub-vs-mission discriminator seen:
`AlternateLotusFrontEndGameRules` = orbiter/front end (×2), `LotusRankUpGameRules` = the
mastery test (×1). A real mission emits its own rules class here. Use it to *suppress*
false mission records for orbiter and relay transitions, which otherwise look like level
loads.

`SyncAutoPopulatedConsumables … with location <X>` is worth extending the parser for: it
carries the mission type ~0.5 s **earlier** than `OnStateStarted`, and the trailing
`location` field (empty in this capture, since a dojo has none) is a second source for the
place the mission is in.

### 2.3 Abort / failure / host migration

- **Abort: NEGATIVE.** No line containing `abort`/`Abort` exists anywhere in the file (0
  hits, case-insensitive). There is no "mission aborted" event. **Detect an abort as: the
  connection bracket closes (`ExitState: Connected`) with no preceding
  `EndOfMatch.lua: Mission Succeeded|Failed` since the last `SS_STARTED`.** That is a
  reliable structural inference, not a guess — `EndOfMatch.lua` only initialises on a real
  end-of-match screen.
- **`Mission Failed`: not observed** (the one mission succeeded). The
  `(Succeeded|Failed)` alternation in `eelog.ts` is presumably correct but I cannot confirm
  the failed branch from this capture.
- **Host migration: the obvious pattern is a trap.**
  `Game [Info]: FinalizeHostMigration, have data for N agent(s)` fires **3 times in this
  solo session**, once per level transition, always with `N=0`. It is a level-init routine,
  not a migration event. The accompanying lines
  `AI [Info]: FinalizeHostMigration - num killed agents: 0` and
  `AI [Info]:  FinalizeHostMigration MaxPop now 18446744073709551615 NumKilledPreMigrate 0 numKilled 0 numSpawned 0 allyFaction`
  are likewise always zero here. **Do not treat `FinalizeHostMigration` as a migration
  signal.** A genuine migration would show non-zero agent counts and would be preceded by
  `Game [Info]: ClientImpl::DisconnectCleanup [host promotion mode=N, seamless=N]` (1
  occurrence here, at the front-end→dojo transition, so that one is not conclusive either).
  Regex if you want it: `/FinalizeHostMigration, have data for (\d+) agent\(s\)/` — and gate
  on `> 0`.
- **Host vs client:** no explicit "you are the host" line. Inferable from
  `Net [Info]: ArbitrationRegisterHostCallback` and
  `Net [Info]: GameRulesImpl::StartedSessionHostCallback: success: 1` (both present, both
  ×1, because this client hosted its own solo session), and from
  `Net [Info]: Has 1 client(s)` / `ReplicationMgr::ClientSubscribe(0)`. A client-side join
  would show `Server test reply` / different callbacks — **not confirmable from this
  capture** (never joined anyone).
- **Matchmaking: essentially NEGATIVE.** Only `MatchingService::LeaveSquad` (×2),
  `MatchingService::ClientDisconnected` (×1), `MatchingService::DeleteSession` (×1),
  `MatchingServiceWeb::LeavePlatformPartyDone` (×1). No join-session, no matchmaking-mode,
  no "searching for squad" lines. Interesting on shutdown:
  `Net [Info]: DeleteSessionCallback(1, {"rewardSeed":6561274695564305179})` — the session's
  reward RNG seed, ×1. Cute, but nothing a history can use.

---

## 3. Timing — mission duration and wall clock

### 3.1 Timestamp format

Every line is prefixed `^\d+\.\d{3} ` — seconds since process start, three decimals,
**monotonically increasing** (verified over all 4,738 lines, max `3390`).

**14 lines have no timestamp prefix at all.** They are:
`UploadChallengeProgress: uploading...`, `OnUploadChallengeProgressResults:…`,
`Unknown property: Tutorial`, `Unknown property: DestroyCount`, and the final
`Sys [Info]: All smart pointers were destroyed!`. A parser that anchors on
`^\d+\.\d+ ` will silently drop these — which is fine for the current allowlist, but note it
if you ever want the challenge-upload lines (§7).

### 3.2 Mission duration

For the one mission here:

- `OnStateStarted` / `StartRound()` / `SS_STARTED` at **56.910**
- `EndOfMatch.lua: Mission Succeeded` at **164.957**
- → **108.05 s of mission**

Recommended: `SS_STARTED` → `SS_ENDING` (56.910 → 167.504 = 110.59 s) as the outer bracket,
and `OnStateStarted` → `Mission Succeeded|Failed` (108.05 s) as the gameplay time. The
difference is the end-of-match screen. Report the second; it's what the player means by
"how long did that run take".

Do **not** use `Sys [Info]: Wall time: 2.2s (time waiting to start: 0.77s)` for this. It
appears 3 times, always immediately after a `Total frames: N, issuing…` block, and its values
(3.9 s, 2.2 s, 2.5 s) are **level load times**, not mission times. It is genuinely useful as
a per-mission "load took N seconds" stat — just do not mislabel it.
Regex: `/Sys \[Info\]: Wall time: ([\d.]+)s \(time waiting to start: ([\d.]+)s\)/`

### 3.3 Wall clock

**One dated line exists**, at t=0.010, line 6:

```
0.010 Sys [Diag]: Current time: Mon Aug 31 21:13:46 2026 [UTC: Tue Sep  1 04:13:46 2026]
```

It gives local **and** UTC explicitly. Regex if you ever want it:
`/Sys \[Diag\]: Current time: .+ \[UTC: (\w{3}) (\w{3})\s+(\d+) (\d{2}:\d{2}:\d{2}) (\d{4})\]/`

**Do not use it.** Three reasons: it is in the `Sys [Diag]` header block next to the Windows
user name and machine fingerprint (§1); with `skipToEnd: true` the app never sees it anyway
if the game was already running; and there is a strictly better anchor.

**Better: derive the epoch from the first tailed line.** When the first line with a
timestamp `t` arrives, `processStartMs ≈ Date.now() - t * 1000`, and every subsequent line's
wall clock is `processStartMs + t * 1000`. One line of code, no header read, no PII.

Accuracy check on this capture: header says 21:13:46 local; last line is at t=3389.996;
21:13:46 + 3389.996 s = 22:10:16, and the file's mtime is **22:10:16.366**. The engine
timestamp tracks wall clock 1:1 with no observable drift over 56 minutes, and does not pause
during loading screens. The only error term is log-flush latency, which is sub-second.

```ts
// ponytail: single anchor captured once per tail; if the game is restarted while we are
// tailing, the timestamp resets to ~0 and the anchor must be re-taken. Detect by t < lastT.
```
That reset is the one real edge case: relaunching Warframe truncates the log and restarts
the clock at 0. Watch for a timestamp going backwards and re-anchor.

### 3.4 Free heartbeat

`Script [Info]: Background.lua: Background: world state refreshed from db` fires **every 300 s
exactly** while in the orbiter (12 occurrences: 43.856, 172.836, 472.997, 772.897, 1073.050,
1372.956, 1672.897, 1972.974, 2272.900, 2572.901, 2873.004, 3172.739). Useful as a liveness
tick and as a cheap drift check against `Date.now()`.
Regex: `/Background: world state refreshed from db/`

---

## 4. Rewards and loot — the important negative result

**The log does not contain the loot.** I searched exhaustively. Here is the evidence, term
by term.

| Searched for | Hits | Verdict |
|---|---|---|
| `GiveMissionRewards` | 1 | Present, but carries **only** `success=true`. No items, no counts. Full line: `164.957 Script [Info]: EndOfMatch.lua: EndOfMatch.lua: GiveMissionRewards. success=true` |
| `MISSION_REWARD` | 0 | **NEGATIVE** |
| `NotifyTagMultiple` | 0 | **NEGATIVE** |
| `CreditBonus` / `Credit` | 1 | Only `/Lotus/Types/Game/…` asset names. No credit award line. **NEGATIVE** |
| `ResourceDrop` | 1 | `Sys [Error]: Could not find object: /Lotus/Types/Boosters/Changyou/CyResourceDropChanceBooster` — an asset load error. **NEGATIVE** |
| `ItemPickup` / `Pickup` | 9 | All asset paths (`/Lotus/Types/PickUps/UpgradeDrops/BaseUpgradeStoreItemPickup`) or minimap-icon errors, plus `Game [Info]: ======== Removing <name> from restricted pickup list` (a permission toggle, not a pickup). **NEGATIVE** |
| `DropTable` | 0 | **NEGATIVE**. Nearest is `LotusGameRules.lua: AmmoDropTableAtten: Adding Upgrade of 0.225 to TennoAvatar7` — ammo drop-rate attenuation, ×1, not loot. |
| `Reward` (all 109 hits) | 109 | Broken down below — **none are award events** |
| `Loot` | 3 | All `MMMT_SPACE_LOOT_POI mini-map icon` errors. **NEGATIVE** |
| `VoidProjection` / relic reward selection | 0 | **NEGATIVE** — see §6 |
| Syndicate standing | 3 | **PRESENT** — see below, this is the one real exception |

Where the 109 `Reward` hits actually come from:
- 96 × `Sys [Error]: Unknown property: WeeklyVaultBonusRewards[N].Rewards[M].RewardClaimed`
  — schema-mismatch spam emitted while parsing worldState/profile JSON. Fires in a block of
  8 every 300 s alongside the world-state refresh. Reveals field *names* in DE's payload,
  nothing about this account's rewards.
- 9 × `Spot-building`/`Spot-loading /Lotus/Types/Game/MissionDecks/…Rewards…` — reward *table
  definitions* being loaded (e.g. `EliteAlertMissionRewards`, `BossMissionRewards/CowgirlRewards`,
  `NarmerSortieBorealCrystalRewards`). These say what tables exist, never what dropped.
- 1 × `Sys [Error]: /Lotus/Types/Game/MissionDecks/EndlessExterminationRewards/EndlessExterminationRewardsEasy had a NULL reward entry`
- 1 × `Sys [Info]: Received non-coupon login reward` (daily tribute, ×1, no item named)
- 1 × `LotusHumanPlayer::SendLoadOut: … set mIsQualifiedForCoreDropReward to 0`
- 1 × `GiveMissionRewards. success=true`

### 4.1 The exception: syndicate standing IS logged, with the number

```
164.961 Sys [Info]: SyndicateXP base for mission: 289
164.961 Sys [Info]: SyndicateXP post multiplier: 289
164.961 Sys [Info]: SyndicateXP post checkpoint amount: 289
```

Three lines, ×1 each, fired 4 ms after `Mission Succeeded`. This is real per-mission reward
data — standing earned, before and after the syndicate multiplier and the daily cap
("checkpoint"). When base ≠ post-multiplier you learn the multiplier; when post-checkpoint <
post-multiplier the player has hit their daily standing cap, which is genuinely useful to
surface.

```
/Sys \[Info\]: SyndicateXP (base for mission|post multiplier|post checkpoint amount): (\d+)/
```

### 4.2 Conclusion for the design

**The inventory diff is not merely "more reliable than parsing reward text" — it is the only
option.** There is no reward text to parse. The log's job in this architecture is exactly
what the task statement assumed: *when* and *where* and *how it went*. The diff supplies
*what*.

The log does tell you precisely **when to snapshot**, which is the part that makes the diff
correct rather than approximate:

```
164.961 Game [Info]: CommitInventoryChangesToDB     ← mission's item changes are being pushed
165.201 Script [Info]: EndOfMatch.lua: DbUpdateComplete   ← server has them; GEP's next dump will include them
```

Recommended attribution protocol:
1. On `SS_WAITING_FOR_PLAYERS` → `SS_STARTED` (or `OnStateStarted`), latch the most recent
   GEP inventory snapshot as `before`. It is pre-mission by construction — nothing has
   changed yet.
2. On `EndOfMatch.lua: DbUpdateComplete`, request/await the next GEP snapshot as `after`.
   Do **not** trigger on `CommitInventoryChangesToDB` — it is 240 ms earlier and the write
   is still in flight, so a snapshot taken then can miss the run's own items.
3. `after − before` = the run's loot, with quantities.

Caveat to design around: this is a *session-scoped* diff, so anything else that mutates
inventory between the two snapshots (foundry claim, market purchase, trade, daily tribute)
lands in the same delta. `Received non-coupon login reward` and the `DailyTribute.lua` block
are both in this log and both mutate inventory, so this is not hypothetical. Since the whole
mission bracket here is 110 s, keeping the `before` latch as late as possible (at
`SS_STARTED`, not at level load) minimises the window. Anything the player does *inside* the
110 s that is not the mission is not really possible, so the window is about as tight as it
can get.

---

## 5. Objective and performance stats — almost entirely NEGATIVE

This is the biggest disappointment and the one worth being blunt about.

| Wanted | Searched | Verdict |
|---|---|---|
| Kills | `kill`, `numKilled`, `Kill` (17 hits) | **NEGATIVE.** Only `FinalizeHostMigration - num killed agents: 0` and `numKilled 0 numSpawned 0` on the migration line (§2.3), plus `CheckNemesisKilled.lua` and asset paths (`VehicleKill.lua`, `MountedKill.lua`). No kill counter. |
| Damage | `Damage` (5) | **NEGATIVE.** All asset/upgrade paths. |
| Revives / downs | `Revive` (0) | **NEGATIVE** |
| Defense waves | `Wave` (4) | **NEGATIVE** for missions. Only `SurvivalChallenge.lua: next Wave` ×2 — that is the *mastery test's* internal stage counter, not a defense wave. |
| Rotations (A/B/C) | `Rotation` (0) | **NEGATIVE** |
| Excavation | `Excavat` (0) | **NEGATIVE** |
| Survival life support | `Survival` (3) | **NEGATIVE.** All three are `SurvivalChallenge.lua`, the mastery-test script. Misleading name. |
| Capture progress | `Capture` (0) | **NEGATIVE** |
| Mission score | `score` (0) | **NEGATIVE** |
| Extraction | `Extraction` (0), `extractionTrigger` (1) | **Partial.** `EndOfMatch.lua: extractionTrigger is nil! Assuming that all players are touching by default.` (×1, this mission had no extraction zone) and `EndOfMatch.lua: <name> - IsInTrigger=true` (×1). In a real mission `IsInTrigger` should tell you per-player whether they made it to extraction — worth capturing (name-stripped) as an extraction flag. |

What *is* available, and is genuinely useful:

| Stat | Line | Count | Note |
|---|---|---|---|
| Squad size at load | `Sys [Info]: Server ready for load [Heap: …], sessionPlayers=1` | 3 | `/sessionPlayers=(\d+)/` — the cleanest squad-size number in the file. Note it reads `0` on the return-to-orbiter transition, so only trust it inside a mission bracket. |
| Squad count (second witness) | `Net [Info]: AddSquadMember: <name>, mm=…, squadCount=1` | 2 | Parse `squadCount` only, never name/`mm`. |
| Load time | `Sys [Info]: Wall time: 2.2s (time waiting to start: 0.77s)` | 3 | §3.2 |
| Mastery XP (item-based) | `Sys [Info]: Player has 83700 (item based) XP` | 5 | Values in this session: 0, 0, 83700, 83700. Account cumulative; per-mission gain = delta between observations. Fires at login and at each level transition. |
| Mission-source XP | `Game [Info]: Mission progress XP: 19758` | 4 | Constant 19758 across the whole session (a mastery test awards none), so I could not observe a delta — but it is clearly the mission-affinity counterpart to the item-based number, and a delta across two runs would be the run's mastery contribution. |
| Mastery completion % | `Sys [Info]: Player is 0.101957% towards all available items at max rank` | 6 | `/Player is ([\d.]+)% towards all available items at max rank/` |
| Mastery rank bracket | `MasteryRankUp.lua: OnMasteryIconReady(Loaded: …/NewMasteryRanks/Rank4to6_d.png)` | 2 | Went `Rank1to3` → `Rank4to6` across the mastery test; `SurvivalChallenge.lua: OnChallengePassed: … "NewLevel":4` confirms MR 4. |
| Medals awarded | `Sys [Info]:  Received medals: <name>` | 1 | Note the **two leading spaces** after the colon. No medal names, just the fact. |

---

## 6. Relics, void fissures, rivens, liches — all NEGATIVE in this capture

- **Relics / fissures / void projections: NEGATIVE.** `Fissure` = 0 hits. `Relic` = 5 hits,
  all asset paths (`Notifications.lua: codexManifest Filter: RelicsAndArcanes`,
  `TnoLisetArsenalMachineVoidRelic_skel.fbx`, `OrokinVoidTileset`). `projection` hits are
  focus-school upgrade names (`DisarmingProjectionUpgrade`), not void projections. No
  relic-opened, no reward-choice, no refinement line.
- **Rivens: NEGATIVE.** 3 hits, all the same
  `/Lotus/Interface/HUD/MiniMap is missing a MMMT_RIVEN_FRAGMENT mini-map icon` error.
- **Liches / Sisters / Coda: partial, and only as a poll, not an event.**
  ```
  43.652 Script [Info]: CheckNemesisKilled.lua: [NEMESIS] Checking for nemesis of faction 0
  43.652 Script [Info]: CheckNemesisKilled.lua: [NEMESIS] NOT FOUND
  ```
  ×3 pairs (factions 0, 1, 2 — Grineer/Kuva, Corpus/Sister, Infested/Coda), fired once at
  login. Regex: `/\[NEMESIS\] Checking for nemesis of faction (\d+)/` then the next line
  `/\[NEMESIS\] (NOT FOUND|.+)/`. This tells you **whether the account currently has an
  active nemesis per faction** — real, if thin, and it is a login-time poll, not a kill
  event. `Kuva` = 1 hit (`KuvaLichLoginSongItem` asset), `Lich` = 2 (asset names),
  `Sister` = 0.

Since none of this appears, relic/lich loot has to come from the inventory diff too — which
it does, cleanly, since relic rewards and lich weapons are inventory items.

---

## 7. Other things worth having that the log *does* carry

These were not on the brief. They are the "etc etc etc" — checked, present, and useful.

| # | What | Regex | Count | Why a companion app wants it |
|---|---|---|---|---|
| E1 | Nightwave / daily+weekly challenge completions | `/OnUploadChallengeProgressResults:mRecentSeasonChallengeCompletions = (\d+), mRecentChallengeCompletions=(\d+)/` | 7 | Season vs non-season completions since the last upload. Non-zero after a run that completed a challenge. **No timestamp prefix on these lines** (§3.1). |
| E2 | Challenge upload state | `/UploadChallengeProgress (nothing changed, skipping upload\|currently in progress, queueing upload)/` and `/^UploadChallengeProgress: uploading\.\.\./` | 5 / 4 / 2 | "nothing changed" after a run = that run advanced no challenge. Cheap and definitive. |
| E3 | Mastery rank-up event | `/Script \[Info\]: MasteryRankUp\.lua: OnMasteryIconReady\(Loaded: .+\/Rank(\d+)to(\d+)/` | 2 | MR-up is a milestone a history should mark. Bracket only, but paired with E4 you get the exact rank. |
| E4 | Exact mastery rank after a test | `/OnTrainingResultUploaded result=(true\|false), body=(\{.*\})/` | 1 | Real line: `158.641 Script [Info]: SurvivalChallenge.lua: OnChallengePassed: OnTrainingResultUploaded result=true, body={"NewTrainingDate":{"$date":{"$numberLong":"1788318985000"}},"NewLevel":4,"InventoryChanges":[]}`. Carries `NewLevel` (= MR 4), a **millisecond epoch** (`1788318985000`), and an `InventoryChanges` array — empty here, but this is DE's standard inventory-delta shape and proves the client does sometimes log one. Worth a targeted watch: if `InventoryChanges` is ever non-empty elsewhere, that is a literal loot list. Do **not** log the raw body; extract `NewLevel` and the epoch only. |
| E5 | Loadout / gear taken into the mission | `/Sys \[Info\]: Consumable slot (\d+) - (\/Lotus\/[^\s:]+): (\d+)/` | 8 | Fired at `GetMissionLoadOut`. Example: `56.428 Sys [Info]: Consumable slot 8 - /Lotus/Types/Restoratives/Cipher: 58`. Gives the gear wheel and the count carried in — so gear *consumed* during a run is derivable, and it corroborates the inventory diff for consumables. |
| E6 | Loadout slot problems | `/Sys \[Warning\]: (Invalid item ID for loadout item at slot \|No items in inventory list for )(\w+)/` | 9 | Diagnostic noise, but it names the slot categories (`SUIT_SLOT`, `LONG_GUN_SLOT`, `PISTOL_SLOT`, `MELEE_SLOT`, `HEAVY_GUN_SLOT`, `LOT_KDRIVE`, `LOT_MECH`, `LOT_OPERATOR_ADULT`, `LOT_DRIFTER`, `LOT_SENTINEL`) — a free enumeration of the loadout schema. |
| E7 | Clan | `/Player name changed to .+ Clan: (.+?)#(\d+)/` | 1 | `Clan: <TIER> <CLAN NAME>#<NNN>` — clan tier (`Champion`) and name. Strip the U+E000 first. |
| E8 | Elite Alert / world-state node names | `/Background\.lua: EliteAlertMission at (SolNode\d+) \(([^)]+)\)/` | 4 | `43.870 … EliteAlertMission at SolNode100 (Jupiter - Elara)` and `2773.878 … at SolNode101 (Venus - Kiliken)`. This is a **free `SolNode` → "Planet - Node" ground truth sample** you can regression-test the vendored star chart against. Note the format is `Planet - Node`, unlike `Mission name: X (Planet)` which is `Name (Planet)`. |
| E9 | Duviri mood | `/RadialSolarMapLite\.lua: Duviri: rolled mood (\w+) mood/` | 57 | `Duviri: rolled mood Fear mood`. Fires whenever the solar map is open. The current Duviri spiral mood — a thing companion apps normally have to fetch from the API. |
| E10 | Inbox | `/Sys \[Info\]: Inbox: (no new messages\|.+)/` | 1 | `174.121 Sys [Info]: Inbox: no new messages`. Unread-mail indicator. |
| E11 | Daily tribute claimed | `/Sys \[Info\]: Received non-coupon login reward/` + `/DailyTribute\.lua: DailyTribute: Wrapping up/` | 1 + 1 | Explains an inventory delta that is **not** mission loot (§4.2). Worth parsing purely to exclude it from attribution. |
| E12 | Login-day state | `/Background\.lua: Login: (Daily\|Daily Done\|No Daily)/` | 3 | Whether today's tribute is pending/claimed. |
| E13 | World-state fetch failures | `/Sys \[Error\]: Bad data from worldState\.php \(error (\d+)\)/` | 12 | 12 failures in 56 min is a lot. If the app also polls world state, this is a signal that DE's endpoint is flaky right now and the app's own failures aren't its fault. |
| E14 | Build version | `/Sys \[Diag\]: Build Label: ([\d.]+) (.+)$/` | 1 | `2026.08.19.11.06 Retail Windows x64 [Stripped]`. Header line — see the §1 warning about reading the header; if you want it, take *only* this line and the `Build Unique ID`, never the block. Better: get the version from the API through `gentle.ts` instead. |
| E15 | Session end | `/===\[ Exiting main loop \]=/` | 1 | Clean "game closed" marker. Everything after is shutdown noise. Use it to close an open mission record rather than leaving it dangling. |

---

## 8. Concrete recommendations for extending `eelog.ts`

Keep the allowlist discipline exactly as it is. Additions, in priority order:

1. **`SS_*` state transitions (L1)** — replaces load-order guesswork with an actual state
   machine, gives abort detection for free, and works identically host or client.
2. **`CommitInventoryChangesToDB` / `DbUpdateComplete` (L10/L11)** — the two events that make
   inventory diffing correct instead of approximate. Arguably the single most valuable
   addition in this whole document.
3. **`SyncAutoPopulatedConsumables … (MT_X) with location Y` (L2)** — mission type earlier
   than `OnStateStarted`, plus a location field.
4. **`Loading game rules: X` (L4)** — suppress hub/orbiter transitions that currently look
   like missions.
5. **`sessionPlayers=N` (§5)** — squad size with no name capture and no PII exposure.
6. **`SyndicateXP …` (§4.1)** — the only genuine per-mission reward number in the log.
7. **`Wall time:` (§3.2)** — per-mission load time, cheap.
8. **`IsInTrigger` (L9)** — extraction flag. **Capture the boolean only; discard the name.**
9. Timestamp capture on every event, plus the `Date.now() - t*1000` anchor from §3.3, and a
   backwards-timestamp check to re-anchor on game relaunch.

Do **not** add: any regex that captures a player name, the `mm=` account id, or anything from
the `Sys [Diag]` header block. Do not add `FinalizeHostMigration` as a migration signal
without the `> 0` gate.

Suggested test-fixture lines for `scripts/check-eelog.ts` (all real, all PII-free as written):

```
56.910 Net [Info]: GameRulesImpl - changing state from SS_WAITING_FOR_PLAYERS to SS_STARTED
56.424 Sys [Info]: SyncAutoPopulatedConsumables for mission MT_MASTERY with location
56.238 Sys [Info]: Loading game rules: LotusRankUpGameRules
53.899 Sys [Info]: Server ready for load [Heap: 701,568,544/873,070,592 Footprint: 3,487,522,816 Handles: 1,358], sessionPlayers=1
164.961 Sys [Info]: SyndicateXP base for mission: 289
164.961 Game [Info]: CommitInventoryChangesToDB
165.201 Script [Info]: EndOfMatch.lua: DbUpdateComplete
167.504 Net [Info]: GameRulesImpl - changing state from SS_STARTED to SS_ENDING
56.109 Sys [Info]: Wall time: 2.2s (time waiting to start: 0.77s)
43.870 Script [Info]: Background.lua: EliteAlertMission at SolNode100 (Jupiter - Elara)
```

Plus negative fixtures the existing test style already implies — assert `parseLine` returns
`null` for, and that `redact()` neutralises:

```
0.010 Sys [Diag]: Windows user-name: Administrator
0.010 Sys [Diag]: Windows computer-name: PC
43.928 Net [Info]: AddSquadMember: SomePlayer, mm=AAAAAAAAAAAAAAAAAAAAAAAA, squadCount=1
163.781 Net [Info]: NAT bound for server to 203.0.113.7:4950
```

---

## 9. What to re-check when a real star-chart mission is in the log

This capture cannot confirm the following. When the user next plays actual missions, grep for
these first:

- `Host loading {"difficulty":…,"name":"SolNode###"}` and `launching level for SolNodeNNN`
  and `ThemedSquadOverlay.lua: Mission name: X (Planet)` — all three are what `eelog.ts`
  parses today and **none appear here**. Confirm they still exist and confirm ordering.
- `EndOfMatch.lua: Mission Failed` — the failure branch.
- Whether `Net [Info]: Set squad mission: ` (empty here) carries a mission key in a squad.
- Whether `SyncAutoPopulatedConsumables … with location <X>` populates `location` for a real
  node.
- Whether `FinalizeHostMigration, have data for N agent(s)` ever reports `N > 0` on a genuine
  migration.
- Whether any `InventoryChanges` array (§7 E4) is ever emitted non-empty.
- Whether endless missions emit anything per-rotation. `Rotation` is 0 hits here, but a
  survival/defense run is the obvious place for it and none ran.
- `Mission progress XP:` before and after a real mission, to confirm it deltas.
