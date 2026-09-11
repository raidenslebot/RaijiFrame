# Melee base damage — is the catalogue half, or is the game doubling?

Research date: 2026-09-08. Occasioned by `scripts/measure-against-game.ts`, whose
Broken War comparison came out at a ratio near 0.5 on every damage line.

Verdict words, as in `fusion-cost.md`: **EXACT** — stated by the source, or
reproduced to the last printed decimal; **APPROX** — implied by a table or a
worked example; **ASSUMED** — a choice made where no source speaks;
**REFUTED** — the sources contradict the claim; **NOT FOUND** — searched for
and not located.

---

## RESOLVED, 2026-09-08, by a second panel

A live capture of the **same weapon with a different build** settles what this
document could not. The build is four mods the app models completely, and the
panel identifies itself: every physical row is the base times the same
multipliers, and the two that must agree do agree.

| row | game | base | implied |
|---|---|---|---|
| impact | 49.6 | 18.7 | x2.6524 |
| puncture | 49.6 | 18.7 | x2.6524 — the same, which is the check |
| slash | 753.2 | 149.6 | x5.0348 = 2.65 x 1.90 |
| corrosive | 892.0 | 187 | x4.7701 = 2.65 x 1.80 |

That is Primed Pressure Point 10 (+165 %), Jagged Edge 5 (+90 % slash), and a
toxin and an electricity mod at 5 combining to corrosive (+180 %). The app
computes **1,749.91 against the panel's 1,744.30 — within 0.32 %**, the residual
being the app's own quantisation, which the panel does not apply.

**So the arithmetic is not halved and never was.** The factor of two belongs to
the FIRST build, whose physical rows are exactly twice what its visible damage
mods account for. The two panels are not in the same state — the first reads
Combo Duration 300 s, the second 5 s — and three of the weapon's eleven slots
have never been read. The app scores the eight grid slots and models neither the
stance nor an arcane, and a melee stance carries damage.

The conclusion below stands where it says the catalogue is right. What changes is
the conclusion that the residual is a property of melee: it is a property of a
build the app could not see whole, and the overlay's marker now says that instead
of "exactly half".

---

## The answer in one line

**(B). The catalogue is right.** Broken War's base damage is 187, split
18.7 / 18.7 / 149.6, and that is what *Digital Extremes' own game export* says,
what the Warframe Wiki says, and what WFCD's `Melee.json` says. The residual is
a factor of **exactly 2.0000**, applied to damage only, and **its source was not
identified**. Do not apply a x2 correction yet — see "What the app should do".

---

## A — Is the catalogue stale? (REFUTED)

| ID | Claim | Verdict | Evidence |
|---|---|---|---|
| A1 | Broken War base damage is 187 total, 18.7 impact / 18.7 puncture / 149.6 slash | **EXACT** | Three independent sources agree to the decimal. See table below. |
| A2 | The same holds for crit chance 35 %, crit multiplier 2.2x, status 20 %, attack speed 1.0 | **EXACT** | All three sources agree on all four. |
| A3 | WFCD `Melee.json` is systematically half the real melee base | **REFUTED** | 5 of 5 weapons checked match the wiki exactly; DE's own export matches too. |
| A4 | WFCD `Melee.json` lags the game | **REFUTED** | Last commit touching `data/json/Melee.json` is 2026-09-05, three days before this research. The file is rebuilt continuously. |

### The three sources, on Broken War

| source | total | impact | puncture | slash | cc | cd | status |
|---|---|---|---|---|---|---|---|
| DE public export (`ExportWeapons`, via `warframe-public-export-plus@0.6.8`) | 187 | 18.7 | 18.7 | 149.6 | 0.35 | 2.2 | 0.20 |
| WFCD `warframe-items` `Melee.json` @master | 187 | 18.7 | 18.7 | 149.6 | 0.35 | 2.2 | 0.20 |
| Warframe Wiki, `wiki.warframe.com/w/Broken_War` | 187 | 18.7 (10 %) | 18.7 (10 %) | 149.6 (80 %) | 35 % | 2.20x | 20 % |

DE's export is upstream of both of the others, and it is the game's own data
file. It carries, in addition to the flat fields, a `behaviours` block stating
the normal attack directly:
`{ "impact": { "DT_IMPACT": 18.7, "DT_PUNCTURE": 18.7, "DT_SLASH": 149.6, "procChance": 0.2 } }`.
There is no second, larger normal-attack table hiding in the export. The other
attacks it names are `slideAttack 187`, `slamAttack 561`, `slamRadialDamage
374`, `heavyAttackDamage 935`, `heavySlamAttack 748` — none of which is the
i/p/s-split number the arsenal printed.

**The 374 is a coincidence, and a dangerous one.** `slamRadialDamage` is 374,
which is 2 x 187, and the arsenal's total implies a base of 374.4 under the
app's multiplier. They are unrelated: the slam radial is 100 % Impact and the
printed panel was 92 % Slash.

### The discriminator, run on five weapons (A3)

Wiki page value against `Melee.json` / `Primary.json`, every stat, not just
damage:

| weapon | class | wiki total | export total | wiki i/p/s | export i/p/s | agree? |
|---|---|---|---|---|---|---|
| Broken War | melee | 187 | 187 | 18.7 / 18.7 / 149.6 | 18.7 / 18.7 / 149.6 | yes |
| Nikana Prime | melee | 198 | 198 | 9.9 / 9.9 / 178.2 | 9.9 / 9.9 / 178.2 | yes |
| Gram Prime | melee | 300 | 300 | 60 / 15 / 225 | 60 / 15 / 225 | yes |
| Galatine Prime | melee | 280 | 280 | 7 / 7 / 266 | 7 / 7 / 266 | yes |
| Rubico Prime | primary | 187 | 187 | 149.6 / 28.1 / 9.3 | 149.6 / 28.05 / 9.35 | yes |
| Braton Prime | primary | 35 | 35 | 1.75 / 12.25 / 21 | 1.75 / 12.25 / 21 | yes |

Crit chance, crit multiplier, status chance, attack speed / fire rate and
magazine also matched on every one of the six. **Melee is not halved relative to
primaries, and neither is halved at all.** (A5 in the brief: answered — there is
no primary/melee asymmetry in the export.)

---

## B — Then what is the factor? (the arithmetic, EXACT)

The build is fully recoverable. `scripts/measure-against-game.ts` names the
eight cards read off the capture; `docs/research/eelog-upgrade-screen.md` records
the game's own build dump with the **polarity-adjusted drain of each**, which
pins the ranks. Reconstructed:

| mod | catalogue path | rank | drain in dump | unconditional effect |
|---|---|---|---|---|
| Primed Pressure Point | `…/Melee/Expert/WeaponMeleeDamageModExpert` | 10 | 7 = ceil(14/2), matched | +165 % Melee Damage |
| Jagged Edge | `…/Melee/WeaponSlashDamageMod` | 5 | 7 = 2 + 5, unpolarised | +90 % Slash |
| Carnis Mandible | `…/Sets/Ashen/AshenMandibleMod` | 5 | 5 = ceil(9/2), matched | +90 % Slash, +60 % Status |
| Melee Prowess | `…/Melee/WeaponStunChanceMod` | 5 | — | +90 % Status Chance |
| Organ Shatter | `…/Melee/WeaponCritDamageMod` | 5 | — | +90 % Critical Damage |
| Galvanized Steel | `…/Melee/Expert/WeaponCritChanceSPMod` | **9** | 6 = ceil(11/2), matched | +100 % Critical Chance |
| Galvanized Elementalist | `…/Melee/Expert/WeaponMeleeStatusChanceSPMod` | 9 | 11 = 2 + 9, unpolarised | +72 % Status **Damage** (no unconditional i/p/s term) |
| Gladiator Rush | `…/Sets/Gladiator/MeleeGladiatorRushMod` | 5 | — | +6 s Combo Duration |

Buckets: base damage **+165 %** (x2.65) — Primed Pressure Point is the *only*
damage mod in the build. Slash-specific **+180 %** (x2.80) — Jagged Edge 90 +
Carnis Mandible 90. Status **+150 %** (x2.50). Crit damage **+90 %** (x1.90).
Crit chance **+100 %** (x2.00).

### What that predicts, against what the game printed

| stat | predicted | game printed | ratio |
|---|---|---|---|
| critical chance | 35 x 2.00 = **70.0 %** | 70 % | **1.0000** |
| critical damage | 2.2 x 1.90 = **4.18x** | 4.2x | **1.000** (one-decimal display) |
| status chance | 20 x 2.50 = **50.0 %** | 50 % | **1.0000** |
| impact | 18.7 x 2.65 = **49.555** | 99.1 | **1.99980** |
| puncture | 18.7 x 2.65 = **49.555** | 99.1 | **1.99980** |
| slash | 149.6 x 2.80 x 2.65 = **1110.032** | 2220.1 | **2.00003** |
| total | **1209.142** | 2418.3 | **2.00001** |

The three non-damage stats land **exactly**. Damage is off by a factor
indistinguishable from **2.0000** — 18.7 x 5.30 = 99.11 prints as 99.1;
149.6 x 2.80 x 5.30 = 2220.064 prints as 2220.1; the total 2418.284 prints as
2418.3. Every printed digit is accounted for.

**Two rules of the app's model are confirmed EXACT by this capture**, and that is
worth as much as the defect:

- **B1.** Base-damage mods form one additive bucket multiplied against the base
  (`moddedStat`). +165 % gives x2.65, and it reproduces the printed split.
- **B2.** Physical (+Slash) mods are additive *with each other* within their own
  damage type, and that type bonus is **multiplicative** with the base-damage
  bucket (`physicalDamage` x `factor` in `optimise.ts`). 90 + 90 = +180 % on
  slash and nothing on impact/puncture reproduces the printed 22.4 : 1
  slash-to-impact ratio to five figures. An additive-with-base reading of the
  physical mods requires a +954 % slash bonus and is **REFUTED**.

### Why the observed ratios looked non-uniform (and it is not the base)

The as-shipped app produced ratios of 2.1331 on impact, 1.9911 on slash and
2.0021 on the total. **No wrong base value can do that** — the base split is
proportional, so a bad base scales all three types identically. The spread comes
from `quantise32`:

| type | app, as shipped | app, unquantised | quantisation effect |
|---|---|---|---|
| impact / puncture | 46.46 | 49.555 | **x0.9375** (18.7 is 3.2 steps of 187/32; rounds to 3) |
| slash | 1114.99 | 1110.032 | x1.00446 (71.68 steps; rounds to 72) |

Remove it and the ratio is a clean, uniform 2.0000 on all three. That is the
single most important structural fact in this document: **the discrepancy is one
scalar on damage, not a per-type formula error.**

### Is `quantise32` itself wrong? (APPROX — it is right about the hit, wrong about the panel)

| ID | Claim | Verdict | Notes |
|---|---|---|---|
| B3 | Warframe quantises each damage type to 1/32 of modded base damage | **EXACT** | Wiki `Damage`: "(Undocumented) Damage Quantization changed from 1/16 to 1/32" at Update 40.0 (2025-10-15). `Damage/Calculation` gives `Quantized(x) = sign(x) x floor(|x| x 32 + 0.5) / 32`. |
| B4 | The app's ordering (quantise against the unmodded total, then apply the base-damage factor) is equivalent to quantising against modded base | **EXACT** | `quantise32(v, base) x F == quantise(v x F, base x F)`. The app implements the wiki rule correctly. |
| B5 | The **Arsenal panel** does not quantise | **EXACT** for this capture | Both damage lines are exact unquantised products. Quantised, impact would print 92.9 (not 99.1) and slash 2230.0 (not 2220.1). Two independent confirmations inside one capture, one of them a 6.25 % move. |

So the app and the game are computing two different quantities and comparing
them. The panel shows the ideal product; the hit is quantised. Both are
legitimate numbers; the app has to say which one it prints.

---

## C — Where the x2 comes from (NOT FOUND)

Ruled out by name, each with its source:

| candidate | verdict | why |
|---|---|---|
| A stale or halved catalogue | **REFUTED** | Section A: three sources, six weapons, every stat. |
| A second base-damage mod in the build | **REFUTED** | All eight cards are identified and only Primed Pressure Point touches damage. Galvanized Steel is a **critical chance** mod (+110 % at rank 10) — the app's own 73.5 % crit output is the proof it was read as one. |
| The **Combo Multiplier** | **REFUTED** | Wiki `Melee_Combo`: the combo multiplier does not multiply normal-attack damage; combo count is *spent* on heavy attacks. It is x1 on this screen regardless. |
| Initial Combo | **REFUTED** | Same page; and it is not an arsenal stat. |
| The equipped **stance** (Iron Phoenix) | **APPROX refuted** | Wiki `Damage/Calculation`: arsenal damage "does not include Stance damage multipliers". Stance mods carry no damage stat of their own. |
| A melee-wide damage change in a recent update | **NOT FOUND** | No update note, wiki line, or forum thread found describing a global melee x2. DE's export still states the normal attack as 18.7/18.7/149.6. |
| The panel showing a different attack (slam / slide / heavy) | **REFUTED** | Slam radial is 374 but 100 % Impact; heavy is 935; slide is 187. None has the printed 1 : 1 : 8-with-slash-bonus split. |
| A **melee Arcane** in the arcane slot | **NOT FOUND / untested** | No melee arcane with an unconditional +100 % damage term was located. The slot's contents were never read. |
| An **Exilus** melee mod | **NOT FOUND / untested** | Melee exilus mods are utility (range, combo duration). The slot's contents were never read. |

**The gap in the measurement, stated plainly.** `docs/research/eelog-upgrade-screen.md`
records the game's own dump as **eleven slots** — "8 grid + 1 stance/aura + 1
exilus + 1 arcane". `measure-against-game.ts` feeds the comparison **eight**.
Three slots on this weapon have never been read, and any of them is a candidate.
The capture's `CAPACITY 8/64` with the eight grid tags summing to 56 leaves 8
capacity free, which is consistent with an empty exilus **or** a cheap one, and
says nothing about the arcane (arcanes cost no capacity).

So the honest statement is: **the factor is real, it is exactly 2, it is on
damage only, and this research could not name it.**

---

## What the app should do

### 1. Do NOT apply a x2 correction. (recommendation, and it is a firm one)

One weapon, one build, one screenshot, with three of eleven slots unread and no
documentary source for a melee-wide factor. A blanket x2 would double every
melee number the app prints, on every build, on the strength of an unexplained
constant. The app's job is to decide for the user; a confidently doubled number
is worse than a number labelled unverified.

### 2. Run the controlled experiment. It is one screenshot and it is decisive.

Open **Upgrades** on Broken War with **every mod, the stance, the exilus and the
arcane removed**, and read the panel:

- prints **187.0** total (18.7 / 18.7 / 149.6) → there is no melee-wide x2, and
  the factor lives in a slot that was not read. Read the slots.
- prints **374.0** total (37.4 / 37.4 / 299.2) → the factor is game-side and
  global, and the app should apply it **to melee only**, as a named constant with
  this measurement cited beside it.

Second step, to separate "on the base" from "on the whole hit": reinstall only
Primed Pressure Point. Without the factor the panel reads **495.6**; with it,
**991.1**.

### 3. Read the other three slots.

Extend `measure-against-game.ts` to take the stance, exilus and arcane from the
EE.log build dump (`buildSlots` / `buildMods` in
`docs/research/eelog-upgrade-screen.md`) instead of only the eight grid cards.
Until it does, any residual it reports is "the mods I happened to look at",
not "the build".

### 4. Fix two things the measurement got wrong regardless of the x2.

- **Rank is not `fusionLimit`.** Galvanized Steel is at **rank 9**, not 10. The
  script assumed max rank and produced 73.5 % crit chance against the game's 70 %;
  at rank 9 it is exact. The rank is recoverable from the drain in the EE.log
  dump — `ceil((baseDrain + rank) / 2)` for a matched slot — so solve it, do not
  assume it.
- **The variant chooser is a coin flip.** `Jagged Edge`, `Organ Shatter` and
  `Melee Prowess` each exist in Beginner / normal / Expert forms in `Mods.json`
  (+60/+90/+165 % respectively), all with the same display name. Choosing "the
  row with the most effects" picked correctly here by luck. Pin the variant by
  `uniqueName` from the EE.log dump leaf.

### 5. Say which number is being printed.

The arsenal panel is unquantised (B5); the damage actually dealt is quantised
(B3). The app currently quantises and then compares to the panel. Pick one:
reproduce the panel (drop the quantisation on that path) or estimate the hit
(keep it, and stop calling the panel the ground truth for it).

### 6. Get a second and third data point before trusting any constant.

Repeat the capture on one more melee weapon **and one primary**. If the primary
reproduces with no factor and the second melee needs the same x2, the factor is
melee-specific and can be named. If the primary also needs x2, it is a property
of the panel. If the second melee needs a *different* factor, the whole
"constant" reading is wrong and the cause is in the slots.

---

## Unknowns, named

1. **The x2 itself.** Not identified. Section C lists what it is not.
2. **The contents of the stance/exilus/arcane slots** on the captured Broken War.
   Never read; the most likely home of the x2.
3. **Whether the arsenal quantises in general.** B5 is EXACT for this capture
   only. A weapon whose base type value does not sit near a half-step would not
   discriminate.
4. **Whether `Galvanized Elementalist`'s "+80 % Status Damage" has an
   unconditional term the panel shows.** It contributed nothing here (the panel's
   three lines sum exactly to its total, so no fourth damage type was present),
   but "status damage" is not a stat the app models at all.
5. **The exact per-rank curve of Galvanized Steel.** +100 % at rank 9 and +110 %
   at rank 10 is consistent with a linear +11 %/rank, but only the two endpoints
   are known.

---

## Sources

- Digital Extremes public export, `ExportWeapons`, via
  `https://cdn.jsdelivr.net/npm/warframe-public-export-plus@latest/ExportWeapons.json`
  (package version 0.6.8). The game's own data file; upstream of everything else here.
- WFCD `warframe-items`, `data/json/Melee.json`, `Primary.json`, `Mods.json` @master,
  via jsDelivr. Last commit touching `Melee.json`: 2026-09-05.
- Warframe Wiki: `/w/Broken_War`, `/w/Nikana_Prime`, `/w/Gram_Prime`,
  `/w/Galatine_Prime`, `/w/Rubico_Prime`, `/w/Braton_Prime`, `/w/Galvanized_Steel`,
  `/w/Jagged_Edge`, `/w/Carnis_Mandible`, `/w/Melee`, `/w/Melee_Combo`,
  `/w/Damage`, `/w/Damage/Calculation`.
- `warframe.fandom.com` returned HTTP 402 for every page attempted; the Fandom
  fork could not be used as a second wiki. The DE export stands in its place and
  is a better source.
- In-repo: `scripts/measure-against-game.ts` (the capture's numbers and the eight
  card names), `docs/research/eelog-upgrade-screen.md` (the eleven-slot build dump
  and the drains), `src/data/optimise.ts` `score()` (the arithmetic under test),
  `src/data/modded.ts` (the labelled rules).

---

## Addendum: the log's build dump is NOT the screenshot's build

Checked after the research above, because the obvious next move was to read the
three unread slots out of the player's own EE.log dump. It cannot be done, and
the reason is worth recording so nobody tries again.

The most recent dump in the log states a capacity of **34** (a base of 30 plus
the Iron Phoenix stance's +4) and lists **six** installed mods: Gladiator Rush,
Galvanized Elementalist, Galvanized Steel, Organ Shatter, Carnis Mandible and
Primed Pressure Point. The screenshot's panel shows **eight** mods - those six
plus Jagged Edge and Melee Prowess - at a capacity of **64**, which is 30 x 2 + 4
and therefore a weapon with an Orokin Catalyst.

So the two are different states of the weapon, taken at different times, and
joining them would be inventing a build that never existed. The screenshot is
the only complete record of the build whose numbers this document analyses, and
it does not show the stance, exilus or arcane slots.

**The decisive experiment is still the one named above, and it needs the game.**
Open Upgrades on Broken War with every mod stripped and read the Total. **187.0**
means the factor of two lives in one of the three unread slots and can be found;
**374.0** means it is game-side and applies to every melee weapon the app will
ever score. Until one of those two numbers exists, no correction should be
applied, because the two answers demand opposite fixes.

A catalyst doubles CAPACITY and nothing else - that was checked, and it is not
the factor. It is noted here only because 64 = 30 x 2 + 4 makes the doubling
look tempting.

---

## Addendum 2: the three unread slots are accounted for, and none of them is the factor

The research above named "three of eleven slots never read" as the place to
look. They have now been read - off the same capture, from the row the game
draws ABOVE the mod grid (capture x 560..1420, y 190..350):

| slot | what the capture shows |
|---|---|
| stance | **Iron Phoenix**, installed, carrying its `+4` capacity marker |
| exilus | **LOCKED** - a grey plate with a padlock and the exilus glyph |
| arcane | **LOCKED** - "Requires Melee Arcane Adapter" |

Two of the three are empty and cannot hold anything; the third is a stance,
which grants capacity and combos rather than damage. The capacity arithmetic
agrees independently: the log's dump states a base of 30 with
`IronPhoenixMeleeTree+4`, and the panel reads 64, which is `30 x 2 + 4` - the
doubling of a catalyst, and the +4 of that stance, with nothing left over.

**So the factor of two is not hiding in an unread slot.** The hypothesis this
document ranked most likely is refuted, and by the capture itself rather than by
anything needing the game. What remains is a game-side factor, which makes the
stripped-weapon reading MORE decisive rather than less: with no mods installed
the panel should read 187.0, and a reading of 374.0 would locate the doubling in
the base itself.

## Addendum 3: why the exilus slot is not simply added to the optimiser

Reading those slots raised the obvious feature - the optimiser fills eight slots
and the grid has eleven, so an exilus mod is a whole extra mod on every build.

**The first answer written here was wrong, and it is worth leaving the correction
visible.** It claimed the slot could not be used because it is locked until an
Adapter is installed and "nothing the app can read says whether it is". The app
reads it, and has all along: `data/build.ts:187` resolves
`hasFeature(instance, UTILITY_SLOT)` from the account's own item record, beside
the catalyst bit it already uses for capacity and the two arcane bits after it.
A limitation asserted instead of checked - the same mistake this session made
earlier about an Overwolf window's input, and caught the same way, by going and
looking.

The real reason is duller and firmer. A weapon's exilus slot accepts the
`isUtility` mods - ten for a rifle, twelve for a melee - and they are ammo
capacity, ammo mutation, zoom, recoil, punch through and silence. Q1 scores none
of them; they are most of the 38 mods `measure-coverage` reports as invisible.
An exilus slot would therefore be offered and left empty, because every candidate
for it is worth exactly zero to the question being asked. It becomes real the
moment an objective values any of those, and the data to fill it is already
resolved and waiting.

Auras were excluded for a different reason - they belong to Warframes, and the
optimiser had no Warframe objective to score them against. **That reason expired
when Q3 arrived**, and the aura is now searched as a ninth slot: its drain is
negative, so it hands the eight grid slots more capacity, and Physique's twenty
per cent maximum health is exactly what effective health maximises. On Ash it is
worth 3,340 against 4,049.

They remain excluded from a WEAPON's pool, which is the claim this section is
really making: an aura sits on the frame, not on the sword.
