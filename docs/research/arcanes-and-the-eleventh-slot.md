# Arcanes — would loading them change any answer?

Research date: 2026-09-08. Occasioned by the claim that the app scores 8 of a
weapon's 11 slots, and that the arcane slot was the one genuinely missing
because arcanes are absent from `Mods.json`. That framing said the gap was a
fetch away. It was, so the fetch was done.

Verdict words, as in `fusion-cost.md`: **EXACT** — stated by the source, or
reproduced to the last printed decimal; **APPROX** — implied by a table or a
worked example; **ASSUMED** — a choice made where no source speaks;
**REFUTED** — the sources contradict the claim.

---

## The answer in one line

**Not one arcane in the game contributes an unconditional effect that any of the
three objectives score.** Loading the export would change no build, no ordering
and no figure. **EXACT**, from the export itself.

---

## What was measured

`Arcanes.json` from WFCD's `warframe-items`, 172 rows, run through the app's own
`parseModStats` and then through the same scoring rule `search` uses —
unconditional, self- or squad-targeted, and a stat the question reads.

| | count |
|---|---|
| arcane rows | 172 |
| parsed cleanly | 91 |
| refused by the parser's shape rule | 77 |
| top-rank effects | 32 |
| unconditional and self/squad targeted | 15 |
| **scoring under Q1 / Q2 / Q3 after reading the source text** | **0 / 0 / 0** |

The parser's first pass suggested four: Shotgun Vendetta (+180 % multishot),
Eternal Onslaught (+180 % critical chance), Magus Husk (+300 armour) and Magus
Vigor (+600 health). Reading the source text refutes all four — every one has an
explicit trigger:

```
Shotgun Vendetta   "On shotgun kill within 5m of target:\n+180% Multishot ... for 15s."
Eternal Onslaught  "On Energy Depleted:\n180% Critical Chance for 8s"
Magus Husk         "On Transference Out:\n+300 Armor"
Magus Vigor        "On Transference Out:\n+600 Health"
```

Two of those are Operator arcanes and one is an Amp arcane, so they do not go on
anything the overlay plans in any case.

All twelve **Melee Arcanes** are conditional by inspection — "On Melee Hit:",
"On Shield Break:", "On Melee Kill:", "against Frozen enemies", "for every 200
current Shields". So the arcane slot is worth exactly zero on the item class
whose figure carries the marker.

## The parser weakness this exposed, and why it does not matter

The four false positives share a shape: the trigger is separated from the effect
by a **literal backslash-n** inside the string, not a real newline, so the
prepass did not split it off as a condition.

That is a real weakness in `modstats.ts` — and it is confined to this export.
Counted over every stat line in `Mods.json`: **0 lines contain a literal
backslash-n, and 0 contain a real newline.** No mod the app scores has that
shape, so no live figure is affected. **EXACT**, by count.

If arcanes are ever loaded for real, the prepass must split on `\n` as well as
on the trigger set in `A7_TRIGGERS`, or four conditional arcanes will be scored
as unconditional.

## The four arcane-shaped rows that ARE in the mod catalogue

`CosmeticEnhancers` is the path prefix for arcanes and also for the four
**Peculiar** mods — the cosmetic joke mods that make flowers grow on enemies you
hit. Those are in `Mods.json`, are flagged `isUtility`, sit in the `WARFRAME`
slot at drain 2, and carry **zero effects**. They are exilus-slot cosmetics and
are already covered by the exilus measurement. A gate matching the prefix alone
counts them as arcanes and fails for the wrong reason.

## What the app should do

Nothing. The slot is empty because everything that could go in it is worth zero
to the questions being asked — the same reason the exilus slot is empty, and now
established to the same standard rather than left as an absence.

It becomes real the moment an objective values a conditional effect. That is a
much larger change than a fetch: it means deciding how often a condition holds,
which is a preference the player has not stated.
