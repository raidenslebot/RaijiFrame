# EE.log — the Upgrades (modding) screen

Mined 2026-09-07 from a real 148,280-line EE.log (`%LOCALAPPDATA%\Warframe\EE.log`,
16.5 MB) written the same day as the user's screenshot of `UPGRADES / BROKEN WAR [30]`.
The research capture in `eelog-mining.md` never visited the arsenal, so nothing below
was in it. Player name, ids and machine identifiers are redacted here and **no raw
line from that file is stored anywhere in this repo** — only the shapes.

**Why this matters.** An in-game auto-modding overlay needs to know when the player
opens the modding screen and for what. Screen capture (the AlecaFrame route) was
rejected as fragile. This is the deterministic alternative: the game's own Lua
narrates the modding screen to the log, which the app already tails.

## The open sequence — identical across all three visits in the capture

Timestamps are seconds since process start; the sequence completes in ~300 ms.

```
t+0.000  Script [Info]: LoadOutRedux.lua: _T.upgradeItemSlot (RefreshStatList): 	3   ← hovering slots in the arsenal (repeats)
t+0.000  Script [Info]: LoadOutRedux.lua: _T.upgradeItemSlot (_Mod): 	3                ← THE TRIGGER: "Upgrade" pressed on slot 3
t+0.009  Sys [Info]: Resloader 0x… (/Lotus/Interface/DiegeticUpgradeCards.swf) starting
t+0.020  Script [Info]: LoadOutRedux.lua: Background::GoToScreen(screenName=UpgradeCards) ← the screen is open
t+0.280  Script [Info]: Background.lua: Background::PushChildMovie(UpgradeCards)
t+0.281  Script [Info]: DiegeticUpgradeCards.lua: USE SLOW UPDATE TOUCH BUTTONS	false
t+…      Script [Info]: DiegeticUpgradeCards.lua: Multiple cards of type /Lotus/Upgrades/Mods/Melee/WeaponCritChanceMod with the same ID.   (× many)
```

`_T.upgradeItemSlot (_Mod): N` carries the **slot index** with a literal TAB before
the number. Observed values 0 and 3. From the arsenal's own layout and the screenshot
(slot 3 → Broken War, a melee weapon): **0 = warframe, 1 = primary, 2 = secondary,
3 = melee.** 1 and 2 were seen only in `RefreshStatList` form (hover), never `_Mod`,
in this capture — the numbering is inferred from position, not proven for those two.

`(RefreshStatList)` fires on hovering/selecting a slot in the arsenal and is NOT the
trigger — it fires several times per visit for slots the player merely looked at.

## The slot indices, measured against 548,310 lines of live log

`scripts/measure-slots.mjs` reads the account's own EE.log and emits nothing but
integers and counts - no line is printed, returned or written anywhere. What it
found settles part of what this document called unknown:

```
opened  (_Mod)            0x4  3x7  6x1
hovered (RefreshStatList) 0x33  1x17  2x11  3x22  5x2  6x2
mods placed, by class     3: Melee x52, Swords x2
```

Three things follow, and one does not.

**Index 3 is melee, and it is no longer an inference.** Fifty-two mods of class
`Melee` and two of class `Swords` were placed on it. A mod cannot go on a thing
it is not compatible with, so this is the game stating it.

**Rows past 3 exist and are opened.** Index **6** was opened once and hovered
twice; index **5** was hovered twice. This account's arsenal therefore emits at
least six distinct row indices, and the four-slot assumption meets a fifth in
ordinary play. Whatever the overlay does about rows it does not know, it is not
a hypothetical case.

**There is a gap at 4.** Indices 0, 1, 2, 3, 5 and 6 appear; 4 never does, in
either form, across the whole log. Nothing here says why - a row this account
has not unlocked, or one the arsenal numbers past. It is recorded because a
future reader will otherwise assume the indices are contiguous.

**What 5 and 6 ARE is still not known, and this log cannot say — three ways.**

`npm run unread-visit` dumps every line SHAPE the game emitted between that
open and its close (numbers, paths and quoted text removed; nothing stored).
Thirty-nine distinct shapes, and three candidate signals in them, all measured
and all negative:

* `ArsenalInventoryController ScriptSetSpaceMode(N)` looked decisive - "space
  mode" is the archwing context and the archwing bins are literally
  `SpaceSuits`/`SpaceGuns`/`SpaceMelee`. It is **0 in all 58 occurrences** across
  the whole log, including during this visit. It does not discriminate.
* The **build dump** would name the mods already installed, which identifies the
  class as surely as a placement. `Modded Capacity:` appears **twice** in
  548,976 lines against 66 card-screen opens, and neither follows a slot press
  it can be attributed to.
* Thirteen `/Lotus/...` paths are named during the visit and **not one is an
  item**: four interface .swf, a sound, a level, two input filters, a quest
  title, two HUD scripts.

So the deduction from the first mod TOUCHED - placed, or flagged as a duplicate
- is not merely the chosen mechanism, it is the only one this log supports.
 The one visit
to index 6 placed no mod, so the deduction the app makes at runtime - the
compatibility class of the first mod placed IS the class of the item - had
nothing to work with. That is exactly the case the overlay's "another slot"
state exists for.

**The duplicate-card warning is a second signal, and a better one.**
`Multiple cards of type <path>` fires INSIDE an open - 58 times on index 3 in
this log, 375-454 lines after the press - and is filtered to the item being
modded: every one of the 58 was melee-compatible (`Melee` x57, `Swords` x1) on a
melee screen. A screen listing every duplicate on the account would have shown
WARFRAME and Rifle classes too. This document previously called it "state, not a
change", which is true of what it reports and wrong about what it identifies.

It matters because it needs the player to do nothing. A placement teaches at
once, but somebody can open a companion's mods, look, and leave - which is
exactly what happened the one time this account opened index 6. The app learns
from both.

The build dump was checked as a third signal and rejected: `Modded Capacity:`
appears **twice** against **66** card-screen opens, and neither occurrence
follows a slot press it could be attributed to. Placements are the signal -
fifty-four of them on one index in this log alone.

## The universal open, and the two paths that skip the arsenal

A second reader found what the first pass missed. The live log holds **five**
card-screen visits, not three: two came through a non-arsenal entry (the Mods
segment) that emits **no `_Mod` slot line and no `GoToScreen`**. The line that
fired on all five:

```
Sys [Info]: Created /Lotus/Interface/DiegeticUpgradeCards.swf     ← the open, every path
Script [Info]: DiegeticUpgradeCards.lua: DBG: HudVis 1|2         ← visible, +0.5–0.8 s
```

`HudVis 1` follows an arsenal entry, `HudVis 2` the other path. On the two
non-arsenal visits the slot is UNKNOWN from the log; "item unknown" is therefore
a first-class state of any consumer, not an error.

## While the screen is open

```
Script [Info]: DiegeticUpgradeCards.lua: mod: True Steel - installed: true (/Lotus/Upgrades/Mods/Melee/WeaponCritChanceMod)
Script [Info]: DiegeticUpgradeCards.lua: mod: Pressure Point - installed: false (/Lotus/Upgrades/Mods/Melee/WeaponMeleeDamageMod)
```

One line per mod the player installs (`installed: true`) or removes (`false`), with
the display name AND the catalogue `uniqueName` path. This is the live build-edit
stream. It carries no identifier of any kind.

```
Script [Info]: DiegeticUpgradeCards.lua: Multiple cards of type <path> with the same ID.
```

**Correction (same day).** The first draft of this doc said this fired "in a
burst on open". Measured against the whole log by a second reader: all thirty
occurrences share ONE timestamp, `t=6577.052`, which is 203 seconds after the
open at `t=6374.347`, and they appear in one visit of three. It is a mid-session
duplicate-id warning, not an on-open inventory dump, and it is not usable as a
second identification path. It does name the equipped stance once
(`/Lotus/Weapons/Tenno/Melee/MeleeTrees/IronPhoenixMeleeTree`).

```
Script [Info]: DiegeticUpgradeCards.lua: Well this was called for soem reason	FORMA
```

The Forma action (DE's own typo). Seen once.

```
Sys [Info]: Created /Lotus/Interface/ModFusion.swf
Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Applying this fusion will cost:
Endo <FUSION_POINTS>1,240Credits <CREDITS>12,400
```

Ranking a mod: the fusion dialog logs its **endo and credit cost** on a following
unstamped line. The two numbers are the measurement; the wrapper is a language key.

## Save and close

```
Script [Info]: LoadOutRedux.lua: OnSaveLoadOutCompleteCommon          ← the loadout was saved
Sys [Info]: LotusGameRules: Sending loadout to server
Script [Info]: DiegeticUpgradeCards.lua: Background::GoToPreviousScreen(skipScreens=nil)   ← back to the arsenal
Script [Info]: LoadOutRedux.lua: Background::GoToPreviousScreen(skipScreens=1)             ← leaving the arsenal
```

**A loadout save does NOT emit `CommitInventoryChangesToDB` / `DbUpdateComplete`.**
Every occurrence of those in the capture is an `EndOfMatch` (mission) write. So the
trigger the app uses to refresh the account after a run does not fire after a build
is saved; whether GEP pushes an inventory on its own after a save is a separate
question for `core/gep.ts`.

## The build dump — the game's own statement of the installed build

Fired at `Background.lua: close pod` after a session in which the build changed
(2 of 7 visits). One stamped line and three UNSTAMPED continuation lines:

```
6695.781 Sys [Info]: Slots: AP_UNIVERSAL|AP_UNIVERSAL|AP_UNIVERSAL|AP_ATTACK|AP_UNIVERSAL|AP_UNIVERSAL|AP_TACTIC|AP_ATTACK|AP_ATTACK|AP_UNIVERSAL|AP_UNIVERSAL|
Initial Capacity: 30|IronPhoenixMeleeTree+4
Modded Capacity: 34|WeaponMeleeStatusChanceSPMod-11|WeaponMeleeDamageModExpert-7|WeaponSlashDamageMod-7|AshenMandibleMod-5|WeaponCritChanceSPMod-6
Final Mod Drain: 4
```

**Eleven slots**, polarity per index; `AP_UNIVERSAL` here means *unpolarised*.
This is the same 11-length array `Configs[].Upgrades` is normalised to. Which
index is stance/exilus/arcane is not stated by the line; a second dump 35
minutes later shows index 2 changed `AP_UNIVERSAL → AP_DEFENSE` after the
`FORMA` line, so the indices are stable per item and a Forma edits one.

**Capacity, empirically.** `Initial Capacity: 30` is the item's rank, not a
mastery-rank formula. The stance adds its base drain (`+4`, unpolarised slot).
The user's screenshot of the same item reads `CAPACITY 8/64`: 64 = 30 × 2
(Orokin Catalyst) + 4 — **the catalyst doubles the rank, not the stance
bonus** — and the eight installed mods' tags sum to 56, so **the game displays
REMAINING/total, not used/total.** The doc formula "15 + 1 per 2 MR" in
`ui-screens.md` is refuted by this line.

**Drains, empirically.** The listed drains (`…SPMod-11`, `…Expert-7`,
`WeaponSlashDamageMod-7`, `AshenMandibleMod-5`, `…CritChanceSPMod-6`) equal the
screenshot's drain tags exactly — these are polarity-ADJUSTED drains of the
installed mods. Between the two dumps Galvanized Elementalist goes `-11 → -6`
after the Forma: `ceil(11 / 2) = 6`, the matched-polarity rule, measured.

`Final Mod Drain: 4` — semantics unresolved (it equals the stance's drain in
both dumps; not the sum of the list).

**The stance arithmetic, as a hypothesis that fits every number.** The
catalogue gives Iron Phoenix `baseDrain −2, fusionLimit 3, polarity unairu` —
a stance's drain is negative because it ADDS capacity, and at max rank it adds
5. Broken War's stance slot is Madurai; Unairu in a Madurai slot is
mismatched, and a mismatched aura/stance bonus is reduced to 0.75:
5 × 0.75 = 3.75 → **4**, the dump's `+4`, with round-half-up. That mismatch is
also why the stance card's drain tag renders **red** (`^4`) in the screenshot
while every grid card's tag does not. Pending the wiki check of the 0.75 factor
and its rounding; every other reading of these numbers I tried fails one of
the two dumps or the screenshot.

**The count.** Eleven slots is consistent only as 8 grid + 1 stance/aura + 1
exilus + 1 arcane. Which index is which is NOT settled by the drains alone:
with rank as a free variable, unpolarised slots accept almost any drain, and a
constraint solver over both dumps left every mod with several candidate
indices. The layout needs the wiki's statement of the client's slot order, or
a live account push where `Configs[].Upgrades` and `Polarity[].Slot` can be
read against a known build.

**The dump names mods by LEAF, and leaves collide across classes.**
`WeaponCritDamageMod` is Vital Sense under `/Rifle/` and Organ Shatter under
`/Melee/`; `WeaponSlashDamageMod` is Shredder and Jagged Edge. A dump leaf
resolves only together with the item's class (from the slot index → weapon
category). The live `mod: … (<path>)` stream carries the full path and has no
such ambiguity. And the dump's **list order is not slot order**: Galvanized
Elementalist (Vazarin) is first in one dump and second in the next while its
drain 11 → 6 pins it to index 2 (the slot the Forma made `AP_DEFENSE`) both
times. The layout has to be solved from the polarities, not read off.

Privacy: paths and numbers only. Parsed as `buildSlots`, `buildCapacity`,
`buildMods`, `buildDrain` — four stateless events a consumer correlates by
arrival (they land within 1 ms).

## The arsenal itself

```
Script [Info]: LoadOutRedux.lua: Background::ScreenOpened(screenName=LoadOut)   ← arsenal opened (5 in capture)
Script [Info]: Background.lua: Background::PushChildMovie(LoadOut)
Sys [Info]: Created /Lotus/Interface/InlineLoadout.swf
Game [Info]: UpgradeManager::Clear()                                             ← 111 in capture; fires on every loadout rebuild, NOT specific to the screen
Sys [Info]: BuildLoadOut for <player>                                            ← CARRIES THE PLAYER NAME. Never parse this line.
```

## Every screen the log ever names

`ScreenOpened(screenName=LoadOut)` ×5 · `GoToScreen(screenName=UpgradeCards)` ×3 ·
`OpenScreen(screenName=MissionStats)` ×4 · `GoToScreen(screenName=MissionStats)` ×1.
Plus `PushChildMovie(Default | LoadOut | UpgradeCards | MissionStats)`. The main
menu logs `ThemedMainMenu.lua: MainMenu::SetCurrentState(N)` for N in 0–6.

## What is NOT in the log

- The **item being modded is not named** on open. The slot index is; the item is
  resolved through the account's current loadout for that slot (`CurrentLoadOutIds`
  in `data/account.ts`). See the resolution note in the design.
- Config A/B/C switching: no line found.
- Capacity / drain numbers: not logged.

## Privacy

The four lines the overlay needs — `_T.upgradeItemSlot (_Mod)`, `GoToScreen(screenName=UpgradeCards)`,
`mod: … - installed: … (…)`, `GoToPreviousScreen` — carry a slot number, a screen
name, a mod display name and a `/Lotus/` asset path. None can carry a player name,
email, id, IP or machine path. `BuildLoadOut for <name>` and
`LotusHumanPlayer::SendLoadOut: <name> loadout received` fire in the same second
and DO carry the name; they must never be matched.
