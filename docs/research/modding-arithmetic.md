# Modding arithmetic — verified against the wiki

Every rule the auto-modder computes with, checked against wiki.warframe.com
(the current wiki; the fandom fork returned HTTP 402 on every page and was not
used). Each row carries its verdict, the corrected rule where the memo was
wrong, and the sentence the verdict rests on. A rule with no sentence is
labelled `assumed` in `src/data/modded.ts` and is not allowed to decide a
build silently.

Verdict words: **EXACT** — the wiki states it; **APPROX** — implied by a table
or an example, never stated; **REFUTED** — the wiki says otherwise, corrected
rule given; **CONFLICT** — the wiki contradicts itself; **NOT FOUND** — two or
three independent attempts, nothing on the wiki either way.

## A — capacity and drain

| ID | Rule as written in the memo | Verdict | Rule to compute with |
|---|---|---|---|
| A1 | capacity = 2 × rank with a catalyst | **REFUTED** | `capacity = max(rank, 15 + floor(MR / 2) [+1 per Legendary Rank]) × (catalyst ? 2 : 1)`, rank cap 30 (some items 40) → 60/80 doubled. The mastery term is a **floor**, never an addend. Whether the Legendary floor can exceed a rank-30 item's 30 is NOT FOUND (a U31.1 note hints it is capped). The Orokin Catalyst page's own example is stale, pre-rework arithmetic. |
| A2 | drain rises +1 per rank from baseDrain | **EXACT** (by every stat table) | Blood Rush 4…14, Condition Overload 10…15, Galvanized Aptitude 2…12, Corrosive Projection −2…−7. Public Export: `baseDrain`, `fusionLimit`. |
| A3 | matched polarity `ceil(d/2)`; mismatched `d + d/4` | **EXACT** both; unpolarised slot APPROX | Mismatched = `d + roundHalfUp(d/4)`: the wiki's bracket list (2–5 → +1, 6–9 → +2, 10–13 → +3, 14–16 → +4) is the proof of half-up. Unpolarised regular slot = listed drain (stated only for auras). |
| A4 | stance/aura bonus: matched ×2, mismatched ×0.75 | matched **EXACT**; mismatched **CONFLICT** | Three pages, three rules: "reduces it by 25%, rounded mathematically" (Mod), "reduce it by 20%" (Polarity), "80% of listed drain, rounded down" (Aura). Both published examples (5 → 4, 9 → 7) satisfy every version. They diverge only at drain **1, 2 and 6**: 75% half-up gives 1/2/5, 80% floor gives 0/1/4. Our 64 on Broken War (Madurai stance slot, Iron Phoenix is Unairu, −2 base, rank 3 → 5, mismatched → 4 under either rule → 60 + 4) is consistent, not discriminating. **In-game discriminator:** an unranked stance (drain 2) in a wrong-polarity slot reads +2 under 75% half-up and +1 under 80% floor. |
| A5 | universal slot matches everything; Umbra ↔ Madurai compatible | universal **REFUTED in part**; Umbra **NOT FOUND** | `AP_UNIVERSAL` matches every polarity **except Umbra**: an Umbral mod in an Omni slot pays base drain (not halved, not increased — "not considered a polarity mismatch"). Umbra Forma cannot polarise exilus or aura slots. Whether a Madurai mod counts as matched in an Umbra slot, or an Umbral mod as mismatched in a Madurai slot, is stated nowhere. |
| A6 | exilus draws from capacity; arcane has no drain; Riven baseDrain 10, max rank 8 | exilus **EXACT**; arcane **NOT FOUND**; Riven **NOT FOUND** | Exilus mods "consume mod capacity, like normal mods"; an exilus slot can be Forma'd and its polarity swapped. Arcanes sit outside the grid; no drain sentence exists. Riven drain is not on the wiki: take it from the export's `baseDrain`/`fusionLimit`. Riven polarity ∈ {Madurai, Naramon, Vazarin}. |
| A7 | 11-slot array = 8 grid + stance/aura + exilus + arcane, in that order | indices **NOT FOUND**; grid read order **EXACT** | Grid is read row 1: 1 2 3 4, row 2: 5 6 7 8, top-left first. Where the exilus and arcane fall in the elemental order is unstated (no elemental exilus mods exist). The index layout has to come from our own `Slots:` dumps against a known Forma. |

## B — damage

| ID | Rule | Verdict | Notes the optimiser must carry |
|---|---|---|---|
| B1 | modded stat = base × (1 + Σ bonuses); crit chance likewise | **EXACT** | Absolute crit bonuses are added AFTER the multiply. Physical and elemental damages are **quantised to 1/32 of the attack's base damage** before further multipliers — ±1.5% per element, enough to reorder near-tied builds. Serration is additive with Heavy Caliber, multiplicative with faction mods. |
| B2 | elemental mods add base × bonus of that element | **EXACT** | Computed on the full base damage, rounded to 1/32 of base, then added. Physical mods (Sawtooth Clip) scale only their own type. |
| B3 | pairs Blast/Corrosive/Gas/Magnetic/Radiation/Viral, combine top-left first, innate last | pairs, order, innate-last **EXACT**; leftover-single, physical-never-combines APPROX | Five sub-rules the memo omitted: (1) an innate element moves to the position of the first equipped mod of the same element; (2) a repeated element keeps its first position; (3) the innate element combines with the LAST uncombined mod element; (4) a two-element Riven gives priority to its **last-listed** stat; (5) Kuva/Tenet dual innates follow Heat > Cold > Electricity > Toxin. Exilus/arcane position in the order: NOT FOUND. |
| B4 | crit tiers; expected multiplier 1 + CC × (CD − 1) | **EXACT** | Headshot location multiplier is **3.0×** almost everywhere; a crit on a head gets an extra 2× in the crit-damage term: `HM × (1 + tier × (2·CD − 1))`. No headcrit on Corpus humanoids; none on weapons with a 1× head multiplier. |
| B5 | multishot multiplies projectiles; export damage is per pellet | **EXACT** | Fractional projectiles are a chance of one more. Each pellet rolls status and crit independently. Beam weapons: multishot multiplies the single instance's status chance instead of adding instances. |
| B6 | fire rate ×(1 + Σ); reload ÷(1 + Σ); magazine round-half-up; sustained DPS | fire rate **EXACT**; reload `÷` form **EXACT**, `×(1 − x)` **REFUTED**; magazine **EXACT**; sustained **EXACT** | Charge weapons: `EFR = 1 / (chargeTime / (1 + bonus) + 1 / FR)`. Vectis subtracts 1 from the denominator; Epitaph ignores reload. Melee animation length = base / (attackSpeed × (1 + Σ)). |
| B7 | faction mods ×1.05/rank, double-dip on DoT | **EXACT** | Faction sources are additive with each other, multiplicative with everything else; the bonus is applied a second time to the DoT the hit creates. |
| B8 | status > 100% = guaranteed proc + fractional chance of a second; proc type weighted by damage share | > 100% **APPROX**; weighting **APPROX** | The 4× physical bias was removed in U27.2 — **EXACT**. Status modding `base × (1 + Σ)` is confirmed only through the Weeping Wounds formula. The weighting page says "base damage" while its example uses a modded combined element. |
| B9 | combo 2× at 20 hits … 12× at 220; Blood Rush/Weeping Wounds scale by (combo − 1); CO +80% per status | **EXACT** on every sub-claim | Combo does NOT multiply normal attacks — only heavies. Blood Rush at 12× = +440%. Condition Overload: the proccing hit does not benefit; max 16 statuses; additive with Pressure Point. |
| B10 | Galvanized Aptitude/Savvy/Shot additive with base damage | **APPROX — it is two rules** | Additive with Serration on **hitscan**; **multiplicative** on projectile, homing, bouncing, punch-through and wave weapons (Boltor, Zymos, Cyanex, Lanka, Arca Plasmor). Never on the hit that inflicts the new status. Killing Blow is additive with Pressure Point — EXACT. |
| B11 | export `damagePerShot[20]` order | **EXACT** | Impact, Puncture, Slash, Heat, Cold, Electricity, Toxin, Blast, Radiation, Gas, Magnetic, Viral, Corrosive, Void, Tau, Cinematic, ShieldDrain, HealthDrain, EnergyDrain, True — 0-based. |

## C — conflicts

| ID | Rule | Verdict |
|---|---|---|
| C1 | no duplicate mods; no two variants of one mod (Flow / Primed Flow / Archon Flow); one Riven per weapon | **EXACT** ("Flawed" not named; covered by "variants"). Amalgam excludes its standard counterpart. A Riven is locked to one weapon family; one copy may sit on the weapon and its variants at once. |
| C2 | two augments of one ability | **EXACT — not allowed**. "Different Augments affecting the same ability or passive cannot be equipped together." |

## The five rules an optimiser may not use silently

1. **A4 — mismatched aura/stance bonus.** Three contradictory wiki rules whose own examples cannot separate them; they diverge at exactly the drains of an unranked aura or stance. One capacity point flips a build from legal to illegal. Rule: ship it as `assumed: 75% half-up`, and record the in-game discriminator above as the measurement that settles it.
2. **A5 — Umbra.** Halving Umbral drain in a universal slot overspends by up to 8 on an Umbral Intensify/Vitality/Fiber build. Umbral ↔ Madurai matching is unverified in either direction.
3. **A1 / A6 — the Legendary floor and Riven drain.** `min(floor, maxRankCapacity)` if the account is LR1+ and still reads 64; Riven drain from the export, never from memory.
4. **B10 — Galvanized / Condition Overload.** A single "additive" flag is wrong for roughly half the arsenal, and the multiplicative half is where builds are won.
5. **B3 — element order.** The five sub-rules above change which pair forms. Arcane and exilus placement is unstated.

## What this changes in the code

- `modded.ts` labels every rule `exact | approx | assumed`; a build that depends on an `assumed` rule says so on the card that depends on it.
- Capacity is computed from A1 with the account's mastery rank from the profile, not from the item rank alone; `buildCapacity`'s `initial` from the log is the measured value the formula must reproduce, and a mismatch is reported, not averaged.
- Drain uses A3 with half-up rounding on the mismatch branch; A5's Umbra exclusion is a hard rule for `AP_UNIVERSAL`.
- The element resolver implements B3's five sub-rules and quantises per B1.
- Galvanized/CO carries the weapon's delivery class (hitscan or not) — `itemdb.ts` must expose it; where the export does not say, the stacking is `unknown` and both results are shown.

Verification run: 2026-09-07, one agent, 96 page fetches, wiki.warframe.com only.
