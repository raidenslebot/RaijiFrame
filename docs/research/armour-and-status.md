# Armour and status arithmetic — the Q2 objective

Research date: 2026-09-07. Source: **wiki.warframe.com only**, read as raw
wikitext (`?action=raw`) so the formulas are the page's own LaTeX rather than a
reader's paraphrase. Two cross-checks were run on every load-bearing rule: the
formula is quoted from the damage-type page and confirmed from a second page
(Armor, Damage/Calculation, Status Effect, or the mod page).

`curl` cannot reach the wiki from this machine — Cloudflare answers every
request with an interstitial (HTTP 403, 41 KB of challenge HTML). WebFetch gets
through. The fandom fork was not used.

Verdict words, same as `modding-arithmetic.md`: **EXACT** — the wiki states it;
**APPROX** — implied by a formula, table or example, never stated in words;
**CONFLICT** — the wiki contradicts itself, both readings given; **NOT FOUND** —
several independent attempts, nothing on the wiki either way. The code labels in
`modded.ts` are `exact` / `approx` / `assumed`; CONFLICT and NOT FOUND both map
to `assumed` and may never decide a build silently.

**Q2** — sustained damage per second against an ARMOURED target, counting
damage-over-time status procs.

---

## A — armour

### A1. The damage-reduction formula

| ID | Rule | Verdict | Source |
|---|---|---|---|
| A1 | `Enemy Damage Reduction = 90% x sqrt(Net Armor / 2700)` for Net Armor <= 2700 | **EXACT** | Armor page states it as the enemy formula; Damage/Calculation states the same thing as the damage multiplier `DM = 1 - 0.9 x sqrt(AR / 2700)`. Two pages, identical. |
| A2 | Above 2,700 (only reachable by non-scaling sources) the formula falls back to the Tenno form `Net Armor / (Net Armor + 300)` | **EXACT** | Armor page. Level scaling cannot produce it — see A5e. |
| A3 | The **Tenno** (player) formula is `Net Armor / (Net Armor + 300)` and is a different curve | **EXACT** | Armor page. Named here only so the optimiser never uses it for an enemy. 300 armour = 50 % for a player, 30 % for an enemy. |

This is the **Update 36 (Jade Shadows, 2024-06-18)** curve. The patch note on the
Armor page is explicit about what changed and why: armour capped at 2,700
(= 90 % DR), floored at 200, Steel Path no longer raising armour, Grineer health
scaling raised to compensate, and the reduction formula altered "to increase the
effectiveness of Partial Armor Stripping". The previous curve was the
**Update 27.2 (Warframe Revised, 2020-03-17)** one; anything written before June
2024 — including most build calculators and every older guide — is on the old
arithmetic and will disagree with this document. **We are documenting the U36
curve.**

The sqrt is the whole point of the rework and the single easiest thing to get
wrong: 300 armour used to cost you half your damage, and now costs 30 %.

### A4. Worked reductions (computed from A1; the app must reproduce these)

| Net armour | Damage reduction | Damage multiplier |
|---|---|---|
| 0 | 0 % | 1.0000 |
| 100 | 17.3205 % | 0.8268 |
| **200** (minimum cap) | 24.4949 % | 0.7551 |
| 300 | **30 %** exactly | 0.7000 |
| 500 | 38.7298 % | 0.6127 |
| 675 | **45 %** exactly | 0.5500 |
| 900 | 51.9615 % | 0.4804 |
| 1000 | 54.7723 % | 0.4523 |
| 1350 | 63.6396 % | 0.3636 |
| 2000 | 77.4597 % | 0.2254 |
| **2700** (maximum cap) | **90 %** exactly | 0.1000 |

300 → exactly 30 % and 675 → exactly 45 % are the two clean checkpoints; a gate
that hits those two proves the constant and the sqrt together.

### A5. Armour by enemy level

| ID | Rule | Verdict | Source |
|---|---|---|---|
| A5a | Armour multiplier, low curve: `f1(q) = 1 + 0.005 x q^1.75` | **EXACT** | Enemy Level Scaling. |
| A5b | Armour multiplier, high curve: `f2(q) = 1 + 0.4 x q^0.75` | **EXACT** | Enemy Level Scaling. |
| A5c | `q = Current Level - Base Level` (the unit's own spawn level, not 1) | **EXACT** | Enemy Level Scaling. Overguard is the one exception and uses `q = Current Level - 1`. |
| A5d | The two curves are blended over `q` in **70..80** by smoothstep: `t = clamp((q - 70) / 10, 0, 1)`, `s = t^2 x (3 - 2t)` | **EXACT** on `t` and `s`, **APPROX** on the blend | The page gives `t` and `s` verbatim but does not reproduce the lerp; `f1 + s x (f2 - f1)` is the only reading that makes `s` mean anything. Armour, shields and health all use the 70..80 band. |
| A5e | Result is clamped: initial armour below 200 is raised to 200; armour is hard-capped at 2,700 | **EXACT** | Armor page. The 200 floor applies **only to the initial value** — strip can take it below 200. |
| A5f | Steel Path: enemy level +100 (+50 Archwing/Railjack, +20 Duviri), health and shields x2.5, and **no armour multiplier at all** since U36 | **EXACT** | The Steel Path page, and the U36 note "Steel Path no longer increases Armor values". |

Worked, for a unit with 100 base armour and base level 1:

| Level | Multiplier | Armour | Enemy DR |
|---|---|---|---|
| 20 | 1.865 | 186 → floored to 200 | 24.5 % |
| 40 | 4.043 | 404 | 34.8 % |
| 60 | 7.280 | 728 | 46.7 % |
| 80 | 11.596 | 1160 | 59.0 % |
| 100 | 13.554 | 1355 | 63.8 % |
| 150 | 18.059 | 1806 | 73.6 % |
| 200 | 22.193 | 2219 | 81.6 % |
| 300 | 29.762 | 2976 → capped to 2700 | 90 % |

**The app has none of this input.** See section H.

---

## A6. Settled since, and what it costs to know it

A second research pass (wiki.warframe.com, current game version Update 43.5+)
closed three questions this document had left open. The game is PAST U36 by
several major updates; the armour rework is still in force, but **damage
attenuation was reworked in Update 40 and again in 40.0.2/40.0.3**, so "post
U36" is the right frame for armour and the wrong one for attenuation.

| ID | Question | Answer | Source |
|---|---|---|---|
| A6a | Does the corrosive strip compound per stack, or is it flat on base armour? | **FLAT.** `1 - (20% + 6% x stacks)`, one additive bracket. | Damage/Corrosive_Damage |
| A6b | Does viral multiply a damage-over-time tick? | **YES**, evaluated per tick against whether a proc is live at that tick, and NOT applied twice as faction damage is. | Damage/Viral_Damage |
| A6c | Does bleed damage overguard, and does its armour bypass help there? | **Damages it, gains nothing by it.** Slash's proc is Cinematic Damage, which "applies to health, shield and overguard"; overguard is neutral to every type but Void, and has no armour DR in its path to bypass. | Damage/Cinematic_Damage, Overguard |

**A6a is settled by an impossibility, which is worth recording because it is the
argument that closes it.** An Emerald Archon Shard raises the corrosive cap to
14 stacks, and the page states 14 stacks "can fully remove all armor".
`0.20 + 0.06 x 14 = 104%`. A product of per-stack factors can never reach zero,
so the series cannot be compounding. The endpoints agree independently: the flat
reading gives exactly the 26 % and 80 % the page prints, where compounding gives
57.6 % at ten. The word that caused the confusion is "multiplicative", which on
these pages means multiplicative BETWEEN SOURCES - heat against corrosive
against Corrosive Projection - and never per stack within corrosive.

**A6b is the fact the level-9999 objective turns on.** Because viral reaches the
tick, bleed's armour bypass and viral's health multiplier COMPOUND rather than
compete, so a scorer applies viral to the direct term and every proc term alike.
Two bounds come with it: a hit applies its own viral stack AFTER dealing its
damage, so no shot benefits from its own proc, and multishot pellets do not
benefit from each other's.

Two questions opened in exchange, both now in `armour.ts`'s `UNKNOWN`: whether
the 2,700 clamp is applied before or after a strip (this module strips the
clamped value, the conservative reading), and the general attenuation formula,
which the wiki itself carries an `UpdateMe` on and does not publish.

---

## B — what bypasses armour

This is the load-bearing section and it survives cross-checking cleanly, from
two pages that state the rule from opposite ends.

| ID | Rule | Verdict | Source |
|---|---|---|---|
| B1 | **Slash's Bleed DoT ignores armour.** "Unlike other DoT effects, enemy armor will have no effect on slash proc damage despite decreasing the initial damage." | **EXACT** | Slash Damage page. Confirmed on the Status Effect overview: the Slash row says the DoT "bypasses Armor". |
| B2 | **Slash's Bleed DoT does NOT bypass shields.** Since U36 it damages shields over time instead. | **EXACT** | Slash Damage patch history: "Slash Status now does not bypass Shields and instead deals damage over time to Shields. Slash Status still bypasses Armor." |
| B3 | **Toxin's DoT bypasses shields, NOT armour.** | **EXACT** | Toxin Damage page states the role split in one sentence: "For role distinction, Toxin bypasses Shields (but not Armor) where as Slash Status bypasses Armor but not Shields." Cross-checked against the Status Effect overview row ("This damage can bypass Shields") and the U27.2 note "Toxin bypasses Shields (but not Armor)". |
| B4 | Toxin does **not** bypass Overguard | **EXACT** | Toxin Damage page: "ignores enemy and player Shields, but not Overguard". |
| B5 | **True damage bypasses both armour and shields** | **EXACT** | Damage page: the True damage type "bypasses Armor damage reduction and Shield". |
| B6 | The Bleed tick is dealt as the internal **Cinematic** damage type, which "bypasses Armor damage reduction" | **EXACT** | Damage page. This is index 15 of `damagePerShot`, already documented in `modding-arithmetic.md` B11 — the same type the app already parses. |
| B7 | Whether **Void** damage bypasses armour | **NOT FOUND** | The Damage page names Void as a type but says nothing about armour or shield interaction. Do not assume. |
| B8 | Heat's DoT is **reduced by armour** like any other damage | **APPROX** | Never stated as such; it is the residual of B1/B3, which name Slash and Toxin as the exceptions and nothing else. Treat Heat DoT as fully armour-mitigated. |

**Consequence for Q2, stated plainly:** against an armoured target the Bleed DoT
is the only damage in the model that sees the target's health at full rate. At
2,700 armour every other damage source in the build is multiplied by 0.10 and
Bleed is multiplied by 1.00 — a 10x swing. If Q2 gets B1 wrong the objective
recommends a completely different mod set.

---

## C — the damage-over-time procs

### C1. "A fraction of WHAT" — the definition all three share

Stated identically, word for word, on the Slash and the Heat pages:

> `Modded Base Damage = Base Damage x (1 + Base Damage Bonuses) x (1 + Faction Damage Bonuses)`

**EXACT.** Read it carefully, because this is the detail secondary sources get
wrong:

- **Base Damage Bonuses** = Serration / Hornet Strike / Pressure Point / Point
  Blank and the other *base damage* mods. In.
- **Elemental mods are NOT in it.** Confirmed explicitly for Slash: "Bleed
  scales off of the base damage of the weapon, the amount of damage dealt is
  not affected by elemental mods nor physical-type mods like Contagious Spread
  and Buzz Kill." Heat and Toxin re-admit *their own* element as a separate
  factor in the tick formula (C3), so the exclusion is real for all three and is
  relaxed only by that explicit `(1 + Heat/Toxin Damage Bonuses)` term.
- **Slash mods (Buzz Kill) do nothing to Bleed.** Stated outright.
- **Faction bonus is inside it, and then applied a SECOND time** in the tick
  formula. That is not a transcription error — it is the double-dip already
  recorded as `modding-arithmetic.md` B7. Faction ends up squared on a DoT.
- Multishot is **not** in it: the DoT is per proc, and multishot multiplies the
  number of procs (E1), not the size of one.
- Crit is **not** in it; crit arrives via "Additional Multipliers" (C4).

**The overview table on the Status Effect page says "35 % / 50 % of the base
damage" with no qualifier. Ignore the overview table.** The per-type pages carry
the real formula and the real definition; the overview is shorthand and is the
source of nearly every wrong number in circulation.

### C2. The three DoTs, compactly

| | **Slash → Bleed** | **Heat → Ignite** | **Toxin → Poison** |
|---|---|---|---|
| Coefficient | **0.35** | **0.5** | **0.5** |
| Of what | Modded Base Damage (C1) | Modded Base Damage (C1) | Modded Base Damage (C1) |
| Element scaling | **none** — no elemental, no physical, no Slash mods | `x (1 + Heat Damage Bonuses)` | `x (1 + Toxin Damage Bonuses)` |
| Faction | `x (1 + Faction)` again, on top of the one inside MBD | same | same |
| Status damage mods | `x (1 + Status Damage Bonuses)` | same | same |
| First tick | after a **1 s** delay | after a **1 s** delay | after a **1 s** delay |
| Interval | 1 s | 1 s | 1 s |
| Duration | **6 s → 6 ticks** | 6 s → 6 ticks | 6 s → 6 ticks |
| Stacking | unlimited independent instances, each with its own timer | unlimited; a new proc adds a stack **and refreshes every existing stack**, so damage ramps linearly for as long as it is refreshed | unlimited independent instances, each with its own timer |
| Display cap | only 10 tick numbers drawn (cosmetic) | — | only 10 tick numbers drawn (cosmetic) |
| Armour | **ignored** | applies | applies |
| Shields | applies (damages shields over time) | applies | **ignored** |
| Crit / headshot | yes, via Additional Multipliers | yes | yes |

Verdicts: coefficients, delay, interval, duration, MBD definition, Slash's
element exclusion, Heat's refresh-all behaviour, and the armour/shield columns
are all **EXACT**. The absence of a stack cap on all three is **APPROX** — the
wiki states a cap for Gas (10) and for every non-DoT status, states none for
Slash, Heat or Toxin, and describes Heat's ramp as "indefinitely (scaling up
linearly)". Absence of a stated cap is not a stated absence of a cap.

### C3. The tick formulas, verbatim

```
Slash Proc Damage per Tick = 0.35 x Modded Base Damage
                             x (1 + Faction Damage Bonuses)
                             x (1 + Status Damage Bonuses)
                             x Additional Multipliers

Heat Proc Damage per Tick  = 0.5 x Modded Base Damage
                             x (1 + Heat Damage Bonuses)
                             x (1 + Faction Damage Bonuses)
                             x (1 + Status Damage Bonuses)
                             x Additional Multipliers

Toxin Proc Damage per Tick = 0.5 x Modded Base Damage
                             x (1 + Toxin Damage Bonuses)
                             x (1 + Status Damage Bonuses)
                             x (1 + Faction Damage Bonuses)
```

All **EXACT**, each from its own page. (The factor order differs between pages
because the wiki authors differ; multiplication commutes, so this is not a
conflict.)

Note what this means for Heat: the tick is `0.5 x total modded base damage x
(1 + heat mods)`, **not** half the heat portion of the hit. A weapon with no
innate Heat and one 90 % Heat mod ignites for `0.5 x MBD x 1.9`, off its whole
base damage. That is why Heat DoT is strong, and it is the second-most-commonly
mis-stated number after C1.

### C4. Crit and the DoT

> "Additional Multipliers include modded critical multiplier on Critical Hit and
> multipliers on Enemy Body Parts; these stack multiplicatively with each other."

**EXACT** that the crit multiplier and the headshot multiplier both apply.
**APPROX** on the mechanism: the wiki never says in words whether the tick
*inherits* the crit tier of the hit that applied it or rolls its own. Every
sentence on the subject is phrased as the proc scaling with "the" critical hit —
"Headshots, orange and red Critical Hits will greatly increase the damage
dealt" — which only makes sense as inheritance. Model it as inheritance and
label it.

**The consequence for the expectation is small but real, and only for Hunter
Munitions.** If crit and status rolls are independent, the expected crit
multiplier on a proccing hit equals the expected multiplier on any hit, so
`averageCritMultiplier` is reusable as-is for Slash/Heat/Toxin procs that come
from status chance. Hunter Munitions is different: its proc exists only
*because* the hit crit, so the expected multiplier on an HM Bleed is conditional
on at least tier 1, which is strictly higher. Reusing `averageCritMultiplier`
for HM under-reports it.

### C5. Status duration

Base duration is 6 s. Status duration mods extend it and add ticks: the Hunter
Munitions page's own worked example is 6 s → **11.4 s with Hunter Track, giving
11 ticks instead of 6**. **EXACT.** Tick count is therefore a function of
duration rather than a constant 6 — the exact rounding rule at non-integer
durations (11.4 s → 11 ticks, so truncation) is **APPROX** from that single
example.

---

## D — the armour- and damage-modifying procs

### D1. Corrosive

| Claim | Verdict | Detail |
|---|---|---|
| First proc strips **26 %** of armour, for **8 s** | **EXACT** | Corrosive Damage page and the U27.2 patch note, identical wording. |
| Each subsequent proc strips a further **6 %** | **EXACT** | Same two sources. |
| Cap is **10 stacks = 80 %** total | **EXACT** | "culminating in a total armor reduction of 80% at 10 stacks". 26 + 6 x 9 = 80 checks out. |
| Each stack has its own 8 s timer; the 11th replaces the oldest | **EXACT** | Corrosive Damage page. |
| **It is temporary, not permanent** | **EXACT** | 8 s per stack. Permanent strip comes from abilities (Frost's Avalanche, Banshee's Sonic Fracture, Mag's Fracturing Crush), never from the proc. |
| Emerald Archon Shard raises the max stack count by **+2 (+3 Tauforged)** | **EXACT** | Corrosive Damage page. So 12 or 13 stacks = 92 % or 98 % under the linear reading. |
| Corrosive strip is **multiplicative** with other armour-reduction sources | **EXACT** | "Corrosive status armor reduction is multiplicative with other armor reduction sources." |
| Whether the per-stack removal compounds (each taking a share of what is left) or forms one flat factor | **CONFLICT** | The Armor page's strip table classes Heat and Corrosive as "From Current Armor" and adds "and thus has diminishing returns". The Corrosive page says 10 stacks = 80 %. These cannot both be true: compounding gives 0.74 x 0.94^9 = 0.424, i.e. 57.6 %, not 80 %. **Only the flat reading reproduces the wiki's own stated 80 %.** Use the flat reading (`strip = min(0.80, 0.26 + 0.06 x (n - 1))` as a single factor, multiplicative with Heat), label it `assumed`, and measure it in game. |

### D2. Heat

| Claim | Verdict | Detail |
|---|---|---|
| Strips up to **50 %** of armour | **EXACT** | Heat Damage page and the Status Effect overview row agree. |
| Ramps **15 % → 30 % → 40 % → 50 %**, one step every **0.5 s**, reaching max at **2 s** | **EXACT** | Heat Damage page, verbatim. |
| **Temporary.** After the proc ends armour returns 50 → 40 → 30 → 15 → 0 %, one step every **1.5 s** over **6 s** | **EXACT** | Heat Damage page, verbatim. |
| Multiplicative with Corrosive | **EXACT** | Armor page and Corrosive page. |

**Heat's armour strip is a ramp with a floor, and a sustained-DPS objective must
either integrate it or say it did not.** For the first 0.5 s after the first Heat
proc there is no strip at all; the 50 % holds only while Heat is being
re-applied. A model that assumes steady-state 50 % overstates early damage. The
lazy correct answer for Q2 is: assume steady state (status is reapplied every
shot, which is what a status build does), and label the assumption.

### D3. Combined strip, worked

Armour is multiplied by `(1 - heatStrip) x (1 - corrosiveStrip)`. From a capped
2,700:

| Strip | Net armour | DR | Damage multiplier | vs unstripped |
|---|---|---|---|---|
| none | 2700 | 90 % | 0.1000 | 1.00x |
| Heat only (50 %) | 1350 | 63.64 % | 0.3636 | **3.64x** |
| Corrosive 10 stacks (80 %) | 540 | 40.25 % | 0.5975 | **5.98x** |
| Both (90 %) | 270 | 28.46 % | 0.7154 | **7.15x** |
| Full strip (100 %) | 0 | 0 % | 1.0000 | 10.00x |

This table is the whole argument for the U36 rework and the reason Q2 exists:
under the sqrt curve, **partial strip is worth most of what full strip is
worth**. Q1 cannot see any of it.

### D4. Viral

| Claim | Verdict | Detail |
|---|---|---|
| First stack: **+100 %** damage to health. Each further stack **+25 %**. Cap **10 stacks = +325 %** | **EXACT** | Viral Damage page and the U27.2 note, identical. |
| Formula `Resultant Damage to Health = Modded Damage x [2 + 0.25 x (stacks - 1)]` | **EXACT** | Viral Damage page. 10 stacks → x3.25. |
| Duration **6 s** per stack | **EXACT** | Viral Damage page. |
| Applies to **health only** — including health behind armour ("yellow health"); shields and Overguard are unaffected | **EXACT** | "will work even when the health is protected by armor ('yellow health'); only shields and overguards are not affected." |

Viral is therefore fully live for Q2 and multiplies *everything that lands on
health*, which includes the Bleed DoT. Whether the Viral multiplier applies to
Bleed is not stated anywhere — but since Bleed damages health and Viral
multiplies damage to health, the only consistent reading is that it does.
**APPROX.**

### D5. Magnetic

Shields and Overguard only: x2 at one stack, +25 % per stack, 10 stacks →
x3.25, 6 s each, plus reduced shield regeneration and a forced Electricity proc
when the shield breaks. **EXACT.** **Irrelevant to Q2** as specified — an
armoured target's armour sits on health, not shields. It is recorded here so the
optimiser can say *why* it scored zero rather than omitting it.

---

## E — status chance to procs

| ID | Rule | Verdict | Detail |
|---|---|---|---|
| E1 | `Average Procs Per Shot = Multishot x (Forced Procs + Status Chance per Projectile)` | **EXACT** | Status Effect page, verbatim. This is exactly `modded.ts procsPerShot` — reusable unchanged. |
| E2 | `Average Procs Per Second = Average Procs Per Shot x Fire Rate` | **EXACT** | Status Effect page. |
| E3 | Status chance is **per projectile**, rolled independently per pellet | **EXACT** | Status Effect page: "the probability that each projectile will individually proc". |
| E4 | Above 100 %: "a single damage instance will be able to create two Status Effects" — a guaranteed one plus the fractional chance of a second | **EXACT** on the sentence, **APPROX** on the arithmetic | The linear-expectation reading is what E1 already encodes and is consistent with it; the wiki never writes out the >200 % case. |
| E5 | Proc type is chosen by **damage share**: `Proc Type Chance = Damage / Total Damage` | **EXACT** as a formula | Status Effect page, with a worked example: 20 Impact / 5 Puncture / 10 Slash / 25 Heat / 50 Corrosive, total 110, Corrosive = 45.45 %. |
| E6 | **Physical types are NOT weighted differently.** The 4x physical bias was removed in **U27.2** | **EXACT** | Status Effect page: "Prior to ver 27.2, physical procs were weighted four times more than elemental ones", and the patch note "we've removed 0.25x Multiplier for Elemental Status Effects, meaning all Elemental Status Effects are 4x more likely". |
| E7 | Whether the weights use base or **modded** damage per type | **CONFLICT**, unchanged from `modding-arithmetic.md` B8 | The prose says "Damage"; the worked example's 50 Corrosive is a *combined modded element* that no weapon has as a base type. The example is the stronger evidence — weights must be taken from the post-`combineElements`, post-`quantise32` damage split. Label `assumed`. |
| E8 | Each proc's type is drawn **independently**, so one shot can produce two of the same type | **EXACT** | Status Effect page. |
| E9 | Beam weapons: multishot multiplies the single instance's status chance instead of adding instances | **EXACT** | Already recorded as `modding-arithmetic.md` B5. E1 needs this branch and the catalogue cannot flag it — see H. |

**What E5 + E7 mean for Q2 in practice:** the proc-type weights come out of
`combineElements` for free. If the build has Corrosive and Heat, the split
between "an armour-strip proc" and "a Heat DoT plus strip proc" is decided by
the relative size of the two combined elements, and Slash's share is whatever
the weapon's own Slash column is after physical mods. A weapon with low innate
Slash gets almost no Bleed from status chance alone — which is the entire reason
Hunter Munitions exists.

---

## F — Hunter Munitions

| ID | Rule | Verdict | Detail |
|---|---|---|---|
| F1 | Trigger: **on a Critical Hit**, force a Slash status effect | **EXACT** | "grants Primary Weapons a chance to force a Slash status effect upon a Critical Hit". |
| F2 | Chance by rank: 5 / 10 / 15 / 20 / 25 / **30 %**; drain 4..9 | **EXACT** | Mod stat table. |
| F3 | The roll is **independent of the weapon's status chance and of its damage-type distribution** | **EXACT** | "The 30% trigger chance is independent to itself and is not affected by the weapon's Status Chance, or damage type distribution, besides being indirectly affected by its Critical Chance." |
| F4 | The forced Slash lands **in addition to** any status the weapon's own status chance produced | **EXACT** | Mod description: "alongside any other Status Effect(s), that would have occurred from Status Chance, or a weapon trait". |
| F5 | Its damage is an ordinary Bleed proc: `0.35 x Modded Base Damage`, unaffected by elemental and physical mods | **EXACT** | "As with all Slash procs, their damage only depends on the weapons modded base Damage and is therefore not affected by elemental and physical damage mods." Same rule as C1/C3 — there is no separate HM formula. |
| F6 | **Primary weapons only** (and Exalted weapons that count as primaries, e.g. Artemis Bow) | **EXACT** | Mod description and the ver 33 patch note. |
| F7 | Cannot double up with another forced-Slash source in the same damage instance (Internal Bleeding, Seeking Talons); can stack with Slash from the weapon's own status chance | **EXACT** | Notes section, with a worked joint probability (54.5 % / 79 %) for the HM + Internal Bleeding case. |
| F8 | An AoE weapon can trigger it **twice** on a direct hit — once on impact, once on the AoE | **EXACT** | Notes section. |
| F9 | Whether the roll is **per pellet** on a shotgun / per projectile on multishot | **NOT FOUND** | The page never says. Every pellet rolls crit independently (`modding-arithmetic.md` B5), so per-pellet is the natural reading and would make HM scale with multishot — but the wiki does not state it and the difference is a factor of 4 on a Hek. **Do not guess.** |

**Expected HM Bleed procs per shot** (per-pellet reading, labelled `assumed`):
`multishot x min(1, critChance) x 0.30`. Note this is *not*
`averageCritMultiplier` territory — see C4: the proc's own damage multiplier is
conditional on the hit having crit, so it is at least the tier-1 multiplier,
never 1.0.

---

## G — what Q2 can reuse from `modded.ts` unchanged

| Function | Reuse | Note |
|---|---|---|
| `statusChance` | **unchanged** | Still `approx` for the same reason (confirmed only through the Weeping Wounds formula). |
| `procsPerShot` | **unchanged** | It is literally E1. But its `forced` argument has no source in the catalogue (H), and beams need the E9 branch, which is the caller's job. |
| `conditionOverload` | **unchanged** | Q2 is what finally feeds it a real status count. Its 16-status cap and hitscan/projectile split stand. |
| `comboMultiplier`, `comboScaledBonus` | **unchanged** | Melee only; untouched by Q2. |
| `factionMultiplier` | **unchanged** | The *caller* changes: on a DoT the factor is applied twice (once inside Modded Base Damage, once as the explicit tick factor). The function is right; the formula around it is new. |
| `critChance` | **unchanged** | |
| `averageCritMultiplier` | **unchanged for status-chance procs; WRONG for Hunter Munitions** | Crit and status rolls are independent, so the expected multiplier on a proccing hit equals the expected multiplier on any hit. HM's proc is conditional on a crit and needs a conditional expectation. See C4. |
| `combineElements` | **unchanged** | Q2 needs its output twice over: for the proc-type weights (E5) and to know which DoTs the build can even produce. |
| `quantise32` | **unchanged** | Confirmed again this session against Damage/Calculation, which states 1/32 and gives `Quantized(x) = sign(x) x floor(abs(x) x 32 + 0.5) / 32` with `x = type damage / Modded Base Damage`. A web search result claiming 1/16 was wrong; the page says 1/32. |
| `sustainedDps` | **partially** | Correct for the direct-hit term. DoT DPS is **not** `burst x uptime` — a proc's damage is spread over 6 s and does not stop during a reload, so the DoT term is `procsPerSecond x ticks x tickDamage` and the reload suppresses only `procsPerSecond`. Q2 needs a second term, not a modified `sustainedDps`. |

**New functions Q2 needs** (none of these exist): `armourDR` (A1),
`armourAtLevel` (A5), `moddedBaseDamage` (C1), `dotTick` (C3),
`procTypeWeights` (E5), `corrosiveStrip` (D1), `heatStrip` (D2),
`viralMultiplier` (D4), `hunterMunitionsProcs` (F).

---

## H — what the catalogue actually carries, and what it does not

From `src/data/itemdb.ts`, `ItemDbEntry` (lines 194–248). Exact field names.

**Present and usable by Q2:**

| Field | Type | Note |
|---|---|---|
| `procChance` | `number?` | Status chance **as a fraction** (0.06, not 6), with float noise. This is the status chance Q2 needs. |
| `damagePerShot` | `number[]?` | 20 values in the export's order — index 2 Slash, 3 Heat, 6 Toxin, 12 Corrosive, 15 Cinematic, 19 True. **Per pellet** on multishot weapons. Gives both the damage split for E5 and the base for C1. |
| `fireRate` | `number?` | E2. |
| `multishot` | `number?` | Base pellet count, guns only. E1. |
| `criticalChance`, `criticalMultiplier` | `number?` | Fractions. C4, F. |
| `magazineSize`, `reloadTime` | `number?` | `sustainedDps`. |
| `totalDamage` | `number?` | Redundant with `damagePerShot`; derive from the array. |
| `trigger` | `string?` | Auto / Semi / Charge / Held / Burst / Active / Duplex / Auto Burst. |
| `attacks[]` | `{name, speed?, critChance?, critMult?, statusChance?, damage?}` | Per fire mode, with a **sparse** damage map keyed by type name. `attacks[0]` is not always primary fire (7 guns). |
| `polarities`, `exilusPolarity`, `stancePolarity` | | Capacity, not Q2. |

**MISSING — a formula with no input is not usable, so these are the blockers:**

1. **The entire enemy side.** There is no enemy table anywhere in `src/data/`.
   No armour, no health, no base level, no faction, no unit list. Grepping
   `src/data/*.ts` and `src/core/*.ts` for armour/enemy/faction turns up only
   `account.ts`'s alert `Faction` enum, `missionlog.ts`'s per-mission `faction`
   (taken from the star chart, and nullable — "the log never says"), and
   `modstats.ts`'s faction *mod* parsing. **Q2 cannot name a target.** Either
   the target becomes an explicit parameter of the objective (armour value and
   level, stated on the result the way Q1 states "unarmoured"), or an enemy
   table has to be added. The parameter form is the honest one and matches the
   house rule that a control holds a choice, not a measurement.
2. **Forced / guaranteed procs per weapon.** `procsPerShot` takes `forced` and
   nothing supplies it. Weapons with innate forced status (Kuva Nukor, Zarr,
   Epitaph, several Incarnon forms) will be scored as if they have none.
3. **A beam flag.** E9 needs it. `trigger === 'Held'` is a plausible proxy and is
   **not** the same statement; the export does not say "beam".
4. **Base status duration.** Assumed 6 s for all three DoTs. No per-weapon
   duration field exists, and some weapons and Incarnon forms alter it.
5. **`ammoPerShot` / ammo pool.** `sustainedDps` accepts `ammoPerShot`; the
   catalogue has no such field, so multi-ammo-per-shot weapons over-report.
6. **AoE / punch-through / delivery class.** F8 (HM triggering twice) and the
   `conditionOverload` hitscan-vs-projectile split (`modding-arithmetic.md` B10)
   both need it. B10 already flagged that `itemdb.ts` must expose it; it still
   does not.
7. **Whether `damagePerShot` on a beam weapon is per tick or per second.** Not
   documented in the file and not verified.

---

## I — the values I could NOT confirm. Blunt list.

Nothing below is filled in with a plausible number. Each is a measurement to
take or a parameter to expose.

1. **Whether Corrosive's per-stack strip compounds or is flat.** The Armor page
   says Heat and Corrosive strip "from current armor" with "diminishing
   returns"; the Corrosive page says 10 stacks = 80 %. Compounding gives 57.6 %.
   Both are on wiki.warframe.com. **Only the flat reading reproduces the wiki's
   own number**, so use it and label it `assumed`. In-game discriminator: apply
   exactly 10 Corrosive stacks to a unit at 2,700 armour and read the bar — 540
   (flat) or 1,146 (compounding).
2. **Whether Hunter Munitions rolls per pellet.** Not stated. On a 4-pellet
   shotgun this is a 4x difference in Bleed procs — larger than any mod choice
   Q2 would make. Do not score shotgun HM until this is measured.
3. **Whether a DoT tick inherits the crit tier of the applying hit or rolls its
   own.** Every sentence implies inheritance; none states it.
4. **Whether Slash, Heat and Toxin have a stack cap at all.** The wiki states
   caps for every other status and none for these three.
5. **Whether Void damage bypasses armour.** The Damage page names the type and
   says nothing.
6. **Whether Viral's health multiplier applies to the Bleed DoT.** Consistent
   with both rules, stated by neither.
7. **The smoothstep blend target** in A5d — `t` and `s` are given verbatim, the
   lerp they feed is not.
8. **The tick-count rounding rule** at non-integer status durations. One example
   (11.4 s → 11 ticks) implies truncation; one example is not a rule.
9. **Whether the proc-type weights use base or modded damage** (E7) — unchanged
   CONFLICT from `modding-arithmetic.md` B8.
10. **Heat's armour-strip level in a sustained model.** The ramp (0 → 50 % over
    2 s) and the decay (50 → 0 % over 6 s) are both EXACT, but the value a
    continuously firing weapon holds is a modelling choice, not a wiki fact.
11. **Faction vulnerability magnitude** is EXACT at x1.5 (Damage page:
    "Vulnerable + = x1.5 and Resistant - = x0.5 incoming damage multiplier", as
    of U36; Grineer are vulnerable to Impact and Corrosive, Corpus to Puncture
    and Magnetic, Infested to Slash and Heat, and post-U36 factions carry no
    resistances). What is **NOT FOUND** is whether the faction vulnerability
    multiplier applies to a DoT tick as well as to the direct hit.

And the inputs the app simply does not have, restated so they are not lost:
**an enemy** (armour, level, faction — nothing exists), **forced procs**, **a
beam flag**, **status duration**, **ammo per shot**, **a delivery/AoE class**.

---

## What this changes in the code

- `modded.ts` gains the nine functions in G, each with a `RULES` entry. A1, C1,
  C3, D2, D4, E1, E5, F2, F5 are `exact`; A5d, C4, D4-on-Bleed, E4 and E7 are
  `approx`; D1 (flat vs compounding), F9 (per pellet) and the three stack caps
  are `assumed` and must surface on any card that depends on them.
- Q2's objective signature must carry the **target** — armour and level — as a
  stated parameter of the question, exactly as Q1 carries "unarmoured". The
  build that is best at 2,700 armour is not the build that is best at 500.
- The gate needs the two clean checkpoints from A4 (300 → 30 %, 675 → 45 %), the
  combined-strip row from D3 (2,700 with 90 % strip → 28.46 % DR), and the U36
  date, so a future wiki change is caught rather than absorbed.
- `itemdb.ts` must expose the seven missing fields in H before Q2 can score a
  shotgun, a beam, or anything with a forced proc. Until then those weapons are
  scored with a named gap, never a silent zero.

Verification run: 2026-09-07, one agent, wiki.warframe.com only, raw wikitext
wherever the page would give it. Pages read: Armor, Damage, Damage/Calculation,
Damage/Slash_Damage, Damage/Heat_Damage, Damage/Toxin_Damage,
Damage/Corrosive_Damage, Damage/Viral_Damage, Damage/Magnetic_Damage,
Damage/Grineer, Status_Effect, Status_Damage, Enemy_Level_Scaling,
The_Steel_Path, Hunter_Munitions.
