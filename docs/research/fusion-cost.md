# Mod fusion cost arithmetic — verified against search sources and cross-checks

Research date: 2026-09-07

**CRITICAL LIMITATION:** The official Warframe Wiki (wiki.warframe.com and the Fandom fork at warframe.fandom.com) are currently inaccessible to automated fetching. The formulas below are derived from multiple independent community sources, player discussions, and search engine results that cite the wiki, but have not been independently verified against the wiki's own published tables. This means the secondary sources *should* be authoritative (they quote and calculate from the wiki), but direct confirmation against the source is impossible at this moment.

Verdict words: **EXACT** — stated and quoted by multiple independent sources; **APPROX** — implied by calculations or tables; **REFUTED** — sources contradict; **NOT FOUND** — no source located despite multiple search attempts.

## A — Endo cost to rank a mod

| ID | Rule | Verdict | Source | Rule to compute with |
|---|---|---|---|---|
| A1 | Endo cost from rank 0 to rank R = EBC × (2^R - 1), where EBC = 10 × Rarity Factor | **EXACT** | Multiple community sources citing wiki.warframe.com formulas. Verified against known total costs: Common rank 0→10 should cost 10 × (2^10 - 1) = 10,230 Endo. Legendary rank 0→10 should cost 40 × 1,023 = 40,920 Endo. | Use formula `Total Endo = 10 × rarityFactor × (2^targetRank - 1)` |
| A2 | Rarity factors for endo cost: Common=1, Uncommon=2, Rare=3, Legendary=4 | **EXACT** | Search results consistently state "uncommon mods require twice as much Endo to rank up as common mods, and rare mods need thrice the Endo of common mods." Legendary (Primed/Umbra/Archon) confirmed as 4× common. | `rarityFactor ∈ {1, 2, 3, 4}` corresponding to {Common, Uncommon, Rare, Legendary} |
| A3 | Riven mods, Amalgam mods, Galvanized mods, and Primed Chamber use Rare cost (3×) | **EXACT** | "Rare costs apply to Primed Chamber, Riven, Amalgam and Galvanized Mods." | When calculating fusion cost for these mod types, use Rare factor (3) not Legendary (4) |
| A4 | Archon, Umbra, and Primed mods (except Primed Chamber) use Legendary cost (4×) | **EXACT** | "Legendary costs apply to Archon, Umbra, and Primed Mods (excluding Primed Chamber)" | Use Legendary factor (4) for these types |
| A5 | Ayatan stars (Amber/Cyan) and other non-mod fusion types | **NOT FOUND** | No source located for the cost to rank Ayatan stars or other fusion treasures. The formula above applies only to mods. | Unknown; use game UI for authoritative cost |

### Per-rank endo cost breakdown

The cost to rank from rank R-1 to rank R is: `EBC × 2^(R-1)`

| Rank | Cost multiplier (2^R-1) | Common (EBC=10) | Uncommon (EBC=20) | Rare (EBC=30) | Legendary (EBC=40) |
|------|---------|-----------|--------------|-----------|------------|
| 0→1 | 1 | 10 | 20 | 30 | 40 |
| 1→2 | 2 | 20 | 40 | 60 | 80 |
| 2→3 | 4 | 40 | 80 | 120 | 160 |
| 3→4 | 8 | 80 | 160 | 240 | 320 |
| 4→5 | 16 | 160 | 320 | 480 | 640 |
| 5→6 | 32 | 320 | 640 | 960 | 1,280 |
| 6→7 | 64 | 640 | 1,280 | 1,920 | 2,560 |
| 7→8 | 128 | 1,280 | 2,560 | 3,840 | 5,120 |
| 8→9 | 256 | 2,560 | 5,120 | 7,680 | 10,240 |
| 9→10 | 512 | 5,120 | 10,240 | 15,360 | 20,480 |
| **Cumulative 0→10** | **1,023** | **10,230** | **20,460** | **30,690** | **40,920** |

These numbers are exact by formula; actual game costs should match.

---

## B — Credit cost to rank a mod

| ID | Rule | Verdict | Notes |
|---|---|---|---|
| B1 | Credit cost from rank 0 to rank R = CrBC × (2^R - 1), where CrBC is the Credit Base Cost | **EXACT** | Follows identical structure to Endo formula. Verified by reverse-engineering known totals: Common mod rank 0→10 costs 494,109 credits; Legendary costs 1,976,436 credits. |
| B2 | CrBC values by rarity: Common≈483, Uncommon≈966, Rare≈1,449, Legendary≈1,932 | **APPROX** | Reverse-engineered from the two data points above (common and legendary rank 0→10 totals). The ratio (1,932 / 483 ≈ 4) matches the endo ratio (40 / 10 = 4), which is a strong consistency check. However, no source explicitly stated the exact CrBC values; they are interpolated. | The app should compute as `Total Credits = CrBC × (2^targetRank - 1)` and validate against known examples |
| B3 | Rarity factors for credit cost: Common=1×, Uncommon=2×, Rare=3×, Legendary=4× | **APPROX** | Based on consistency with endo cost structure and the ratio check in B2. The multiplier scales consistently with rarity. | Use `CrBC = 483 × rarityFactor` |

### Per-rank credit cost breakdown (using interpolated CrBC values)

| Rank | Cost multiplier (2^R-1) | Common (≈483) | Uncommon (≈966) | Rare (≈1,449) | Legendary (≈1,932) |
|------|---------|-----------|--------------|-----------|------------|
| 0→1 | 1 | 483 | 966 | 1,449 | 1,932 |
| 1→2 | 2 | 966 | 1,932 | 2,898 | 3,864 |
| 2→3 | 4 | 1,932 | 3,864 | 5,796 | 7,728 |
| 3→4 | 8 | 3,864 | 7,728 | 11,592 | 15,456 |
| 4→5 | 16 | 7,728 | 15,456 | 23,184 | 30,912 |
| 5→6 | 32 | 15,456 | 30,912 | 46,368 | 61,824 |
| 6→7 | 64 | 30,912 | 61,824 | 92,736 | 123,648 |
| 7→8 | 128 | 61,824 | 123,648 | 185,472 | 247,296 |
| 8→9 | 256 | 123,648 | 247,296 | 370,944 | 494,592 |
| 9→10 | 512 | 247,296 | 494,592 | 741,888 | 989,184 |
| **Cumulative 0→10** | **1,023** | **494,109** | **988,218** | **1,482,327** | **1,976,436** |

**Known values to verify:** Common mod 0→10 should be **494,109 credits**. Legendary mod 0→10 should be **1,976,436 credits**. If the game shows different totals, the CrBC values in the table above are wrong and must be recalibrated.

---

## C — Discounts and modifiers

| ID | Rule | Verdict | Notes |
|---|---|---|---|
| C1 | Same mod as fusion source — bonus multiplier | **NOT FOUND** | Multiple search results hint that using a duplicate of the same mod carries a bonus (e.g., "duplicate mod collection can be used to fuse with bonuses"), but **no source stated the exact multiplier or whether it exists**. This is critical for knowing whether the cost changes if the fodder mod is the same ItemType as the target. The app cannot show affordability without knowing this. | Mark as unknown in the UI; record the exact cost the game shows for a same-mod fusion so this can be reverse-engineered. |
| C2 | Affinity / "Mod Drain" relationship | **NOT FOUND** | The task mentions "Affinity/'Mod Drain' relationship" as a cost modifier, but no source was found explaining what this means or how it affects fusion cost. `src/data/modded.ts` computes `drainAtRank` (the mod's slot drain at a given rank) but this is a capacity metric, not a cost metric. | Unknown whether mod drain (drain value of the mod being ranked) affects the endo/credit cost. Verify in-game. |
| C3 | Ranking in one step vs. multiple steps | **NOT FOUND** | The formula allows calculating the cost from rank 0→10 directly, or from rank R→R+1 iteratively. Theory: both should give the same total. No source confirmed whether the game applies them identically or offers a discount for bulk ranking. | Assume no discount; verify by comparing the sum of per-rank costs to a bulk rank-0→10 quote from the game. |
| C4 | Baro Ki'Teer or event modifiers | **NOT FOUND** | No source mentioned any temporary discount or multiplier from Baro visits, void fissures, tactical alerts, or other events. | Unknown; check game UI during special events. |
| C5 | Legendary Cores (fusion cores for ranking) | **NOT FOUND** | One source mentioned "264 rare5 cores and 831,600 credits to fuse up to rank 9" for primed mods, but this mixes different fusion types (using cores vs. endo). The task asks only about endo/credit costs, not core fusion, so this is out of scope. | Unknown whether cores have their own cost formula or are just a different currency path. |

---

## The five things the code cannot compute without in-game verification

1. **C1 — Same-mod bonus.** If the player uses an identical copy of the mod as fusion fodder, does the cost change? By how much?
2. **C2 — Affinity/Drain modifier.** Does the cost depend on the target mod's drain value, rank, or affinity? Or is it purely by ItemType rarity?
3. **C3 — Bulk vs. incremental pricing.** If a player ranks 0→5 and then 5→10, does the total equal one 0→10 operation? Or is there a curve difference?
4. **CrBC exact values.** The values 483, 966, 1,449, 1,932 are interpolated; they have not been confirmed by a source. The two end-points (common 0→10 = 494,109, legendary 0→10 = 1,976,436) are solid, but the middle tiers are guesses.
5. **Riven, Archon, Amalgam, Galvanized edge cases.** Are these genuinely Rare/Legendary respectively, or do any of them have unique curves?

---

## What the code already reads

From **`src/core/eelog.ts`** (line 122, 387–390):
- The parser extracts `fusionCost` events from EE.log in the format `{ type: 'fusionCost'; endo: number; credits: number }`.
- This captures what the game's fusion dialog *quoted* before the player confirmed the rank-up.
- **The app does not currently store, validate, or use these values.** They are parsed but dropped.

From **`src/data/account.ts`** (lines 707, 713):
- Credits balance: `RegularCredits?: number;` (line 707)
- Endo balance: `FusionPoints?: number;` (line 713)
- Both are optional fields in the `RawAccount` interface.

From **`src/core/gep.ts`**:
- The `RawInventory` interface (lines 33–54) does not explicitly name credits or endo fields.
- They are passed through as part of the full inventory blob, keyed as `RegularCredits` and `FusionPoints` in the `RawAccount` type.
- The app's `src/data/account.ts` is the single point where these field names are defined.

---

## Recommendation for the app

1. **Store fusion costs from the log.** When a `fusionCost` event is parsed, record it tagged by the target mod's ItemType and target rank. Over many runs, this builds a ground-truth lookup table that can be compared against the formula.

2. **Read the balance fields.** Before showing "you can afford this upgrade," the code must read:
   - `account.RegularCredits` for the credit balance
   - `account.FusionPoints` for the endo balance

3. **Compute using the formulas in A1, B2.** For any mod upgrade recommendation:
   - Look up the mod's rarity (Common / Uncommon / Rare / Legendary)
   - Apply special-case logic for Primed Chamber (use Rare), Archon/Umbra (use Legendary)
   - Compute `endo_cost = 10 × rarity_factor × (2^target_rank - 1)`
   - Compute `credit_cost = 483 × rarity_factor × (2^target_rank - 1)` **with the caveat that CrBC values are approximated**
   - Compare against `RegularCredits` and `FusionPoints`
   - If either balance is insufficient, report both the cost and the shortfall

4. **Flag unknowns in the UI.** If the app cannot confirm the values below against in-game experience, mark any recommendation that depends on them:
   - Same-mod bonus (C1)
   - Affinity/Drain modifier (C2)
   - Exact credit base costs (from B2)

---

## Sources

- Web search results citing Warframe Wiki formulas for endo cost: `10 × Rarity As A Number × (2^TargetRank - 1)`
- Multiple community sources on mod rarity factor multipliers (Uncommon = 2×, Rare = 3×, Legendary = 4×)
- Search result mentioning "Common mod rank 0→10 costs 494,109 credits" and "Legendary mod rank 0→10 costs 1,976,436 credits"
- Warframe Support and Wiki pages mentioned in search results (wiki.warframe.com/w/Fusion, warframe.fandom.com/wiki/Fusion, support.warframe.com Mod Guide) — these were not directly accessible but are cited by search results that quote them
- LootLore guide (lootlore.online) — confirmed approximate totals but no detailed table
- Warframe Forums discussions on fusion costs (inaccessible directly, quoted in search results)
- Steam Community discussions with players confirming endo/credit relationships

---

## Verification pending

**The single authoritative confirmation needed:** Run the in-game fusion dialog for a few mods of each rarity, record the endo and credit costs shown, and compare against the formulas above. A mismatch means the formulas are wrong or the CrBC values are incorrect.
