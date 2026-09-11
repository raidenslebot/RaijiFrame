# Auto-modding overlay — architecture

Written 2026-09-07 after an eight-reader understanding pass, two live-log
mining passes, the Overwolf window API check and the account-shape trace. Every
claim below is either measured (cited) or marked as pending a named
verification. Nothing here is guessed and left unlabelled.

The brief, in the user's words: an in-game overlay that opens when anything
moddable is selected, takes into account every mod owned and not owned, every
possible combination, when a missing mod might be obtained, guides to the
perfect build and to the next upgrade, handles every UI state, is never laggy
or intrusive, and feels like it is the game. Screen capture was rejected as
fragile; the solution must be deterministic.

## 0. The one-sentence shape

**The game narrates the modding screen to a file the app already tails; the
account carries the installed build; the catalogue carries every mod's cost and
effect; a constrained search finds the best build the player can make now and
the best build there is, and the difference between the two — ordered by
marginal gain and annotated with where each missing mod drops — is the
guidance. A second, purpose-built Overwolf window draws it in the game's own
card silhouettes in the empty right column of the Upgrades screen.**

```
EE.log tail ──► signal   automod-session.ts    open · visible · slot · edit stream · save · close · build dump
account push ─► resolve  build.ts              slot → item instance → active config → installed mods + ranks + polarities
catalogue ────► data     moddb.ts + modstats.ts + itemdb (extended)   every mod's drain/polarity/effect; every weapon's full stats
              ► compute  modded.ts             the arithmetic, each rule labelled exact | verified | assumed
              ► optimise optimise.ts           best-now · best-ever · next-acquisition · forma plan · rank plan
              ► present  automod window        diegetic card strip, six states, transform-only motion, gated idle
```

## 1. Signal — done, verified against the real log

`core/eelog.ts` parses eleven arsenal event types, mined from a real 151k-line
log and replayed through the real parser: 7 distinct card-screen visits, 58 mod
placements, 6 fusion costs, 2 build dumps, zero name leaks. Full shapes in
`eelog-upgrade-screen.md`.

| event | line | means |
|---|---|---|
| `screen UpgradeCards open` | `Created /Lotus/Interface/DiegeticUpgradeCards.swf` | THE open, every path (5/5 in the first capture) |
| `hudVisible UpgradeCards` | `DiegeticUpgradeCards.lua: DBG: HudVis N` | drawn, +0.5–0.8 s; show nothing before |
| `upgradeSlot N` | `_T.upgradeItemSlot (_Mod): N` | arsenal path only (3/5): 0 frame · 1 primary · 2 secondary · 3 melee |
| `modInstalled` | `mod: <Name> - installed: true\|false (<path>)` | live edit stream, full catalogue path |
| `loadoutSaved` | `OnSaveLoadOutCompleteCommon` | saved; **no inventory write follows** |
| `screen UpgradeCards closed` | `DiegeticUpgradeCards.lua: GoToPreviousScreen` | closed |
| `fusionCost` | `Endo <FUSION_POINTS>N\rCredits <CREDITS>N` | the price of ranking a mod |
| `buildSlots/Capacity/Mods/Drain` | the 4-line dump at `close pod` | 11 slot polarities, capacity, installed mods with adjusted drains |

**The state machine** (`automod-session.ts`, to build):

```
idle ──Created──► opened ──HudVis──► visible ──mod:──► editing ──Saved──► saved ──GoToPrevious──► idle
                     │                                    │                                        ▲
                     └────── slot known? (upgradeSlot within 1 s before) ── item resolved / unknown ┘
```

A repeat `open` within 1 s is the same open (the arsenal path logs two lines
20 ms apart). Visible-before-open, or a close with no open, are tolerated
silently: the tail can start mid-session.

## 2. Resolve — which item, honestly

The log never names the item (`BrokenWar` appears 0 times in 151k lines). The
resolution ladder, most certain first, and **each rung is a distinct UI
state**, not an error:

1. **Loadout join** — `CurrentLoadOutIds[0]` → `LoadOutPresets.NORMAL[i]` with
   that `ItemId` → `.s/.l/.p/.m` by slot → `EquipmentSelection { ItemId, mod }`
   → the instance in `Suits/LongGuns/Pistols/Melee` by `oidOf(ItemId)`; `mod`
   is the active config index (A/B/C). *Status: types exist, zero read sites,
   and the only real dump in the repo (`public/__review-acct.json`) is an
   anonymised 18-key fixture without these fields. UNVERIFIED until a live
   push; not disproven.*
2. **GEP `highlighted`** — documented as "currently viewed item", already
   emitted by `core/gep.ts`. *Whether it fires with the weapon path on the
   Upgrades screen is undocumented; needs one in-game test.*
3. **End-of-mission instance ids** — `Weapon in slot MELEE_SLOT with ID <oid>
   has gained N XP` joins to `Equipment.ItemId`. *One mission stale — wrong
   exactly when the player is swapping gear in the arsenal.*
4. **Unknown** — the category from the slot (or nothing, on the non-arsenal
   path), plus the live `mod:` stream. The overlay shows what it knows and
   offers a one-key pick among the equipped items of that category.

The installed build is the second half of resolution:
`Configs[mod].Upgrades` (11 oid strings, `""` empty) → `Upgrades[]` row by
`oidOf(ItemId)` → `ItemType` + rank from `JSON.parse(UpgradeFingerprint).lvl`.
**No helper does this join today**; `build.ts` is where it lives. Between
pushes, the `mod:` stream is applied on top as the authoritative delta, because
a save emits no inventory write.

**The 11-slot layout** is 8 grid + stance/aura + exilus + arcane. Which index
is which is NOT on the wiki (verified 2026-09-07: the grid's read order is
stated, the array's is not); it has to come from our own `Slots: AP_…|` dumps
against a Forma whose slot we know. The slot arithmetic, measured and then
checked against the wiki — the full table is
[`modding-arithmetic.md`](modding-arithmetic.md): matched polarity `ceil(d/2)`
(Galvanized Elementalist 11 → 6 after a Forma; EXACT), mismatched
`d + roundHalfUp(d/4)` (EXACT), capacity `max(rank, 15 + floor(MR/2)) ×
(catalyst ? 2 : 1)` + stance bonus (the memo's "2 × rank" was the special case
where rank ≥ the mastery floor; REFUTED as a general rule), displayed as
remaining/total, matched stance bonus ×2 (EXACT), mismatched stance bonus
5 → 4 under BOTH of the wiki's contradictory rules (75% half-up and 80%
floor; they diverge only at drain 1, 2 and 6 — CONFLICT, shipped as
`assumed`, and an unranked stance in a wrong-polarity slot settles it).
`AP_UNIVERSAL` matches everything except Umbra, whose mods pay base drain
there (REFUTED in part).

## 3. Data — the catalogue, fetched gently

Three sources, one fetch layer (`core/gentle.ts`, cached, rate-limited, empty
under Node by design).

**`moddb.ts`** — WFCD `Mods.json`, 1,806 rows. Allowlisted fields:
`uniqueName, name, polarity, baseDrain, fusionLimit, rarity, compatName, type,
isAugment, isExilus, isUtility, isPrime, modSet, modSetValues, drops,
levelStats`. Coverage measured by the critic: baseDrain/polarity/rarity/
fusionLimit 1787/1806, levelStats 1622, compatName 1583, drops present.
**The path is the key, never the leaf** — `WeaponCritDamageMod` is Vital Sense
under `/Rifle/` and Organ Shatter under `/Melee/`. **The path is the untiered
row** — Mods.json ships Beginner/Intermediate/Expert copies (the KEY_MODS bug,
fixed and gated).

**`modstats.ts`** — the hard piece. `levelStats` is prose: `"+165% Damage"`.
Every per-rank effect must be parsed into `{ stat, magnitude, unit, sign,
scope: damageType | faction | condition | null }` — and **a string the parser
cannot place is refused and named, never guessed**, because a guessed magnitude
corrupts every build it touches. The grammar is specified from the enumerated
vocabulary (workflow `moddb-vocabulary`, critic's `parserSpec`), and the gate
runs the parser over all 1,622 strings and asserts every one either parses or
appears in the refused list with its reason. Dual-stat, set-bonus, on-kill/
stack, and conditional phrasings are their own cases.

**`itemdb.ts` extension** — today the `WfcdRow` whitelist keeps eight fields.
Add: `damagePerShot[20]` (index order per DE's DT_ enum, indices 0–12
confident, 13–19 to verify against a pure-Slash weapon), `multishot`,
`trigger`, `polarities[]`, `exilusPolarity`, `stancePolarity`, `attacks[]`
(per-attack crit/status/damage/speed for melee), the melee block
(`comboDuration, followThrough, slamAttack, slamRadialDamage, slamRadius,
heavyAttackDamage, heavySlamAttack, slideAttack, range, blockingAngle`),
`isPrime`. `itemdb.ts` is a shared-surface file (argo FROZEN): the edit is a
serial pre-step, mine.

## 4. Compute — the arithmetic, labelled

`modded.ts` implements the damage/crit/status/multishot/fire-rate/capacity
rules from the damage-formula reader (K1–K14), **after** the wiki verification
pass returns. Each rule carries a label in code — `exact`, `verified` (with the
wiki URL), or `assumed` — and every `assumed` rule is a scenario parameter the
UI shows, never a hidden constant. Out of scope and said so: enemy armour/
health-type maths (reworked 2024; not modelled from memory), headshot crit
bonus, Blast. The objective is **unarmoured expected damage per second**, with
the scenario (status types on target, faction, Galvanized stacks) stated beside
the number.

Two empirical anchors already in hand validate the compute layer before any
optimiser runs: the build dump's adjusted drains against the screenshot's tags
(five exact matches), and the six real `fusionCost` lines (endo 30 → 930 →
15,330; credits 1,449 → 44,919 → 740,439) against the rarity-doubling fusion
formula.

## 5. Optimise — the algorithm

The problem: choose ≤ 8 grid mods (+ exilus, + stance/aura), each at a rank
0..fusionLimit, assigned to slots, maximising the objective subject to
capacity (polarity-adjusted drains ≤ capacity), one copy per mod, one per
variant family (Serration/Amalgam/…), one riven, class compatibility, exilus
eligibility, stance type. Slot ORDER matters twice: polarity match halves
drain, and elemental mods combine in slot order.

**Why not enumerate.** ~100 eligible melee mods choose 8 is 1.9 × 10¹¹ before
ranks and order. The structure that makes it tractable:

- **Separability with dominance.** The objective is a product of independent
  factors (damage × crit × status × multishot × speed), each a sum over its
  category. Adding a mod to a set never decreases any factor, so a partial set
  dominated in every factor and capacity by another partial set can be pruned.
- **Slot assignment is a sub-problem with a closed form.** For a fixed set and
  ranks: put each mod in a matching-polarity slot if one is free (the drain
  gain is monotone in rank, so greedy by drain works), then order the
  elemental mods to form the wanted combinations. That is ≤ 8! but with
  symmetry it is a handful of cases; it is solved exactly per candidate set.
- **Ranks are not free variables in the "now" build.** A mod's usable rank is
  its OWNED rank (`lvl` from the fingerprint) — the game lets you install lower
  to fit capacity, so rank is a variable only downward.

**The search:** beam search over mod additions. State = (set, ranks, capacity
used); score = objective under exact slot assignment; beam width 200; expand by
every eligible mod not in the set; prune dominated states and states that
cannot fit. Then exact local search on the top 20 sets: every single swap and
every single rank change. This is deterministic, bounded (~200 × 100 × 8
expansions), and reruns in under the frame budget because it runs in a Worker
off the render thread.

**Run it three times, and the differences are the product:**

1. **Now** — over OWNED mods at OWNED ranks with the item's CURRENT polarities
   and capacity: *the best build you can make this minute.*
2. **Ideal** — over ALL mods at MAX ranks, polarities free (each Forma is a
   cost): *the best build there is.*
3. **Next** — for every mod in Ideal but not in Now, the marginal objective
   gain from acquiring or ranking it, holding everything else at Now: *what to
   get next, ordered.* Each row carries the mod's `drops` (where it comes
   from), the fusion cost to rank it (endo + credits, from the same formula the
   log's `fusionCost` lines validate), and — from the ledger — whether the
   player has ever been seen to obtain it.

Plus two plans derived from Ideal against the current item: the **Forma plan**
(which slot polarities minimise total drain for the Ideal set, and in what
order each Forma unlocks the most) and the **rank plan** (endo and credits to
bring each owned-but-underranked mod up, ordered by gain per endo).

**What "perfect" means here, stated so it can be argued with:** the maximum of
a declared objective under declared constraints, with every assumed rule
exposed. A build that is best against one scenario and not another is shown
against both. The optimiser never returns a single number without the question
it answered.

## 6. Present — the window

**A second Overwolf window, `automod`**, in-game only, transparent, not
resizable, no taskbar entry, no keyboard grab, no `focus_game_takeover`, no
static `clickthrough`. It is NOT the existing `ingame` window, which renders
the entire desktop shell with a WebGL backdrop in 1440 × 900 and toggles as a
whole; the spec budget for an in-game window is ≤ 400 KB gzipped, ≤ 1.5 ms per
frame, 0% idle, no rAF while hidden. `automod.html` imports no panels and no
backdrop.

**Placement:** on `hudVisible`, read `logicalWidth/logicalHeight` from
`getRunningGameInfo2`, then `changeSize({window_id, width: round(logicalWidth ×
COL), height: logicalHeight})` and `changePosition(id, logicalWidth − width,
0)` — logical pixels, Overwolf does the DPI. `COL` is the empty right column
beside the arcane slot, to be measured at 1680 × 1050 and 2560 × 1440. Hide on
`screen closed`; `close()` after N minutes hidden so cost is provably zero.
`onStateChanged` filtered on `window_name` cancels every subscription on
`hidden`. All of this needs `changePosition`, `changeSize`, `setWindowStyle`,
`onStateChanged`, `close` and the geometry fields added to `core/ow.ts` — a
frozen file, serial pre-step.

**Input:** the column is empty, so nothing beneath needs clicks; the window is
interactive by default. If a later placement overlaps a game control, idle in
`InputPassThrough` and lift it on `mouseenter` of the panel rect.

**Direction (committed after the swap test — see `automod/directions.md`):
the margin annotator.** The game's own screen stays the subject. The column
holds, top to bottom: the **capacity ledger** — the game's own bar, redrawn as
the Ideal build's plan, segments per mod, polarity-coloured, Forma shown as
empty segments; then **one row per slot**, each the game's own pointed-top
mod card in miniature — drain tag top-right, polarity glyph, rank pips, rarity
frame — showing the recommended card with the current card ghosted behind it,
and beneath it one line of why (`+38% expected damage`); then the **next**
list: what to get, where it drops, what it costs to rank. The card silhouette
is non-negotiable; put another game's grid behind this and it stops meaning
anything. Rarity uses the game's material ladder (bronze/silver/gold/platinum),
which the existing `Rarity` component does not yet model (three inconsistent
schemes exist in the corpus; this reconciles to the wiki's).

**Six states, every one designed:** `unknown` (no slot, no item — category if
known, the live edit stream, a one-key pick); `no-data` (catalogue not loaded —
say what is loading, never a spinner over nothing); `resolving`; `ready`;
`editing` (the player is placing cards — the strip re-diffs live, and the
capacity ledger counts as they go); `saved`. A seventh, `stale` — the account
push is older than the last save — is a banner on any of the others.

**Motion law:** one. Cards *snap* into the strip with the existing
`rf-stage-in` transform-only entrance under the computed stagger, because the
document timeline freezes while the window is unpresented and an opacity or
height entrance would strand the strip invisible — the app has been bitten by
this four times and `check-frozen` enforces it. Exits are 60% of entrances.
The capacity ledger fills with a `stroke-dashoffset` sweep (the one named
exception the spec allows). Reduced motion collapses all of it. Every motion
is watched by scrubbing `currentTime`, never signed off from the diff.

**What must not be built:** three.js in this window, an always-on HUD, a
layoutId tab underline (strands on the frozen timeline), any read of the screen.

## 7. Verification — per layer, before the next layer starts

- signal: `check-eelog.ts` fixtures carry the real bytes (embedded and trailing
  CR); the live-log replay counts; the adjacency trap (`BuildLoadOut for
  <player>` → null); the sabotage harness runs both gate files.
- resolve: a gate that builds a synthetic `RawAccount` with `LoadOutPresets`,
  `CurrentLoadOutIds`, `Configs` and `Upgrades` in the documented shapes and
  asserts the join lands on the right instance and config; plus the
  `review-acct` fixture asserting the `unknown` state is reached cleanly when
  the fields are absent.
- data: every one of 1,622 `levelStats` strings parses or is refused by name;
  the KEY_MODS identity gate; the itemdb extension asserted against a known
  weapon (Broken War's damage split, crit, status, stance polarity).
- compute: each rule's label is asserted; the build-dump drains reproduce; the
  six real fusion costs reproduce; a capacity gate encodes 30 × 2 + 4 = 64.
- optimise: the exact enumeration on a tiny catalogue (5 mods, 3 slots) equals
  the beam result; dominance pruning never drops the optimum on a fuzzed set;
  the Now build's drains fit capacity; Next is ordered by gain.
- present: `check-frozen`, `check-ui-tokens` (every `var(--x)` defined),
  `cgc lint/audit/motion` on the rendered window; the six states each rendered
  and looked at.

## 8. Phases

1. **Data** — `moddb.ts`, `modstats.ts` with the parser gate, `itemdb`
   extension. Fan-out: parser implementers (sonnet) against the enumerated
   vocabulary, opus verifiers per shape family. Serial pre-step: `itemdb.ts`.
2. **Resolve + compute** — `build.ts`, `modded.ts` after the wiki verification;
   `ow.ts` additions. Serial: both are shared-surface.
3. **Optimise** — `optimise.ts` in a Worker, with the tiny-catalogue exact gate.
4. **Present** — the window, the strip, the six states, the loop.
5. **Live** — the one thing this machine cannot do until Warframe runs: the
   loadout-join and `highlighted` tests, and the slot layout against the dumps.

## 9. Unknowns, named

The 11-slot index layout (pending wiki + dumps). Whether a live push carries
`LoadOutPresets`/`CurrentLoadOutIds`/`Configs`. Whether GEP `highlighted` names
the modded item. The mismatched aura/stance factor and rounding. The in-game
window's coordinate origin when the game is borderless and smaller than the
monitor. Whether a hidden Overwolf window throttles timers. `COL`, the empty
column's fraction, at two resolutions. Config A/B/C switching: never logged;
known only from the account's `mod` index at push time.

## 9a. What is moddable, and what this overlay covers

Three things have to be true for a class to work, and they fail independently:
a **signal** saying which screen was opened, a **resolution** from that to an
item on the account, and a **question** whose stats its mods actually give.

| class | question | eligibility | resolution | signal |
|---|---|---|---|---|
| Warframe | Q3 | yes | yes | slot 0 |
| Primary · Secondary · Melee | Q2 | yes | yes | slots 1 · 2 · 3 |
| Sentinel | Q3 | yes | yes | learned |
| Pets (Kavat, Kubrow, Predasite, Vulpaphyla) | Q3 | yes | yes | learned |
| Archwing | Q3 | yes | yes | learned |
| Arch-Gun · Arch-Melee | Q2 | yes | yes | learned |
| Companion Weapon | Q2 | **no** | yes | unobserved |
| Necramech (Voidrig, Bonewidow) | Q3 | yes | yes | learned |
| K-Drive · Parazon · Amp | **none** | no | no | unobserved |

### The question was never the problem

This was written off as needing objectives that did not exist. Measured against
the real exports, that was wrong twice over:

* A Sentinel carries `health` 560, `shield` 250, `armor` 80; an Adarza Kavat
  310 / 270 / 300; an Amesha 650 / 220 / 195 — the same three export fields a
  Warframe carries, and the three `survivability()` reads. Their `COMPANION`
  and `Archwing` mods give health, shield capacity and armor, which is Q3's
  stat set verbatim. **Q3 needed no change at all, only to be asked.**
* An Arch-Gun carries `damagePerShot`, `multishot`, `criticalChance`,
  `criticalMultiplier`, `procChance`, `fireRate`, `magazineSize` and
  `reloadTime` — field for field what a Braton carries — and `Archgun` mods
  give fire rate, multishot, status chance and elements. **That is Q2.**

`check-optimise` builds a real plan for one item of each class on the real
catalogue and asserts it beats the bare item: Carrier 959 → 6,646, Adarza Kavat
890 → 8,380, Amesha 1,293 → 3,430, Corvas 198 → 7,940, Veritux 97 → 668.

### What is deliberately refused, and why that is re-checked every run

Necramech (28 mods), K-Drive (23), Parazon (40) and the operator/amp `ANY` set
(20) give damage reduction, k-drive speed, hacking chance and void stats. No
question here scores any of it, so a build ranked for them would be confident
and empty — worse than the overlay saying it does not know. A gate asserts they
stay out of `eligibleSlots` until a question exists that can read them.
`Companion Weapon` is refused for a different reason, and the mix is measured
rather than asserted: the seven `Sentinel` mods are Assault Mode, Regen, Primed
Regen, Repair Kit, Sacrifice, Self Destruct — the robot's own behaviour — plus
Fired Up, which is its weapon's. No field on a companion weapon names the class
it takes; a Deth Machine Rifle carries only `productCategory=SentinelWeapons`.

The amp case is stronger than "the stat names differ". The `ANY` mods give
**zero** stats Q2 already scores and seven `amp `-prefixed ones — and
warframe-items publishes no amp item in any export this app could fetch, so a
name mapping alone would leave nothing to mod.

A refusal nothing re-checks becomes a habit, so `check-optimise` re-earns all
four every run: it fails if a K-Drive, Parazon or `ANY` mod ever gives a stat
this app scores, if an amp category becomes fetchable, or if the `Sentinel`
class stops mixing the two kinds of mod. Any of those means the class should be
reconsidered rather than refused again out of memory.

### Replayed against the player's own play

`npm run replay` feeds the real EE.log through the SAME reducer the live
controller runs and reports what the overlay would have done. It is the closest
thing to watching it happen that is possible without being at the machine, and
on this account's 548,446 lines it found **13 modding-screen visits**:

```
   slot  category   edits  fusions  dump  late  saved  closed   the overlay would have
      3  melee         39        0   yes   yes    yes     yes   SHOWN (edits to reflect)
      0  warframe       0        0    -    yes     -      yes   shown only if a plan resolved
      -  -              0        0    -    yes     -      yes   NOT READ - arsenal row 6
      -  -              0        0    -    yes    yes      NO   no slot line at all (Mods segment)
```

Five warframe visits, six melee, and the two the app cannot read - which it now
tells apart, because they are different things: one is an arsenal row with no
meaning here, the other came through the Mods segment and carries no slot line
at all. The row-6 visit touched no card, so nothing could be learned from it;
the replay says so rather than assuming. One visit never saw a close line, which
is precisely the case the 90-second silence watchdog exists for.

`npm run slots` is the narrower instrument beside it: indices only, no lines.
Neither writes anything, and neither matches a line that carries a name.

### The overlay's own instruments

`composite.html` is the lab, and three calls answer the three questions nobody
could answer by reading:

* `__sweep()` — every UI state the app can produce, one at a time, with what the
  aside rendered. `__sweepAll()` runs all of them at five resolutions and
  returns only the failures. Its fit verdict measures what each row's content
  WANTS (`scrollHeight` plus margins), not the height flexbox gave it: the
  first version compared the last row's bottom against the column and therefore
  reported "ok" while rows were being crushed from ten pixels to three.
* `__motion()` — the entrance, read off the browser rather than the source.
  Measured: 10 of 12 rows animate, a 90-315 ms stagger in six steps, 220 ms
  each, `cubic-bezier(0.16, 1, 0.3, 1)`, everything settled inside 1.1 s, a
  `prefers-reduced-motion` rule present. It fails on a dead row, a linear ease,
  a flat stagger or motion still running after a second. (`cgc motion` is the
  usual tool and cannot see this entrance — it is over before its first frame.)
* `__stress()` — leaked animations, leaked nodes, and whether an interrupted
  count-up still lands on its true figure.

### When you might get a mod, answered as a prerequisite

Nothing here can predict a date, and inventing one would be a fabricated
number. What the star chart CAN say exactly is what stands in the way. Two
pieces, and the ladder uses both:

* **Reachability decides the order.** `preferable()` puts a step the account can
  act on ahead of one it cannot, whatever the figures say - measured, the ladder
  was handing an Earth/Venus/Mercury account "Serration, from Ceres" as its one
  instruction. Blocked steps are deferred, never dropped, and `reachable: null`
  (unknown) is NOT blocked: refusing a mod because nobody worked out where it
  drops would charge the app's ignorance to the player.
* **When everything left is blocked, the rung is a NODE.** `stepsToPlanet()`
  walks the merged successor index outward from the account's cleared set to the
  first node on the wall's planet; the ladder emits `kind: 'unlock'` naming the
  planet, how many nodes away it is, and which to play first. `nearestWall()`
  picks the closest, because the question is what to do tonight. Its gain is
  ZERO - clearing a node raises no figure by itself; it is the step that makes
  the next step possible.

Without that rung the ladder simply stopped and the overlay said "nothing
further to do", which was the one thing that was definitely untrue.

### What is actually left

**Resolution is built.** `resolveIn(acc, category)` resolves any of the ten
categories; `resolveBuild(acc, slot)` is the four-slot wrapper over it. The
FOUR coordinates per category — preset group, the `CurrentLoadOutIds` entry that
names its active preset, config key, and equipment bins — are the `WHERE` table
in `build.ts`, transcribed from §3 of `inventory-schema.md` rather than
inferred. The index matters: the array is ordered by DE's `eLoadoutIndex`
(NORMAL 0, SENTINEL 1, ARCHWING 2, MECH 8), and reading `[0]` for every group —
as this did at first — hunts the NORMAL id inside the ARCHWING array and never
finds it, so all six new categories would have stopped at the `presets` rung on
a real account. The gate missed it because its fixture gave every group the same
id; it now gives each a different one, so a swapped index breaks exactly the two
categories that read it. A companion lists three bins because a preset's `s` can be
a sentinel, a beast or a moa and the config does not say which; an `ItemId` is a
unique oid, so searching all three cannot be ambiguous. `check-automod` drives
all ten end to end against an account of the documented shape.

That work also fixed a latent error: the rank curve was chosen by
`category === 'warframe'`, and `mastery.ts` states the 200-affinity curve is for
"a frame/vehicle/companion". Every archwing, companion and necramech would have
been ranked on the weapon curve — at 40,000 affinity, rank 20 instead of 14 —
which the player would have felt as a wrong capacity.

**The signal is learned, not guessed.** `_T.upgradeItemSlot (_Mod): N` is the
only line that says which row was opened, and four values have a known meaning:
the capture behind `eelog-upgrade-screen.md` saw **0 and 3** and inferred 1 and
2 from the arsenal's layout. Whether a companion or archwing emits a fifth index
has never been observed, and guessing at it is not available - being wrong means
planning a Kubrow against an Archwing's mods with nothing on screen to say so.

It does not have to be guessed. **A mod cannot be installed on a thing it is not
compatible with**, so the catalogue class of the first mod placed on an unknown
screen IS the class of the item being modded - a deduction from the game's own
data, not an inference from layout. `data/slot-learning.ts` maps a compatibility
name to a category (`COMPANION`/`ROBOTIC`/`BEAST`/`Kavat` to companion,
`Archgun` to arch-gun, and so on) and returns null for the classes that identify
nothing: `ANY` fits anything, and a per-frame augment says the frame's own name.

Measured against this account's own 548,310-line log
(`scripts/measure-slots.mjs`, which emits integers and counts and never a line):
indices **0, 3 and 6** have been opened and **0, 1, 2, 3, 5 and 6** hovered, so
rows past the four exist and are opened in ordinary play. The same measurement
turned index 3 from an inference into a fact - 52 `Melee` mods were placed on
it. The one visit to index 6 placed no mod, so what 5 and 6 are is still open;
that is precisely the case the "another slot" state covers.

Two signals feed that deduction, and the second needs the player to do nothing:
a placement teaches at once, and the card screen's own duplicate-card warning -
filtered to the item, measured at 58 lines inside one open, all of them
melee-compatible on a melee screen - teaches on a mere visit.

So an unknown row stays unknown only until the player opens it, and is known
from then on - for the session, and past it, because the map is persisted and
validated on the way back in. The first companion the player mods teaches the
app what a companion screen is, permanently. An out-of-range index is also
traced by name, so the answer appears in the log whether or not a mod is placed.

Until then the overlay says which of the two unknowns it is, because they are
different things to be told - and on the row it cannot read it says what would
fix that: *Move any mod on it once and it will be recognised from then on.*
The first sentence alone is a wall; the app knows the door and the player has no
way to guess it. An open through the Mods segment carries no slot
line at all and reads "item unknown". An open on an arsenal row this app has no
meaning for reads "another slot", with *This is not one of the four arsenal
slots the overlay reads yet* under it — that state used to render a title and
nothing else, which is indistinguishable from a broken overlay.

## 8. Built, as of 2026-09-08

What exists against the plan above, each with the gate that holds it:

| layer | module | gate | measured |
|---|---|---|---|
| signal | `core/eelog.ts` (11 arsenal events) | `check-eelog`, `check-ledger` (source-anchoring) | 7 visits, 58 placements, 2 dumps in the real log; 0 name leaks |
| session | `data/automod-session.ts` | `check-automod` (32) | dedupe within 1 s; slot within 2 s; late tail reported |
| place | `data/automod-place.ts` | `check-automod` | 300 × 263 at 1680 × 1050, from the user's own capture; no overlap with six game rectangles |
| window | `app/background.ts` + `app/automod.tsx` + manifest `automod` | `check-strip-life` (44), frozen-timeline, ui-tokens | 255 px of a 263 px budget; the window is reconciled against `getWindowState` at startup |
| publish | `data/automod-publish.ts` | `check-strip-life` (44), `check-automod` (32) | the decision the controller cannot be gated on, driven directly: four known rows, a learned row, an unknown row, the Mods segment, idle |
| card | `ui/ModCard.tsx` | Playwright composite over the player's own capture | 201 × 99 traced from the Fever Strike tray card; no element leaves the card's box |
| resolve | `data/build.ts` | `check-build` (11) | every rung unknown by name; current rank unknown after Forma |
| data | `data/moddb.ts`, `data/modstats.ts` (fan-out) | `check-moddb`, `check-modstats` | 1,516 kept rows; 7,141 effects; 3,171 refusals in 8 rules; 0 corrupt |
| cost | `data/fusion.ts` | `check-fusion` (12) | the curve reproduces all 9 fusion prices in the player's own EE.log; credits are exactly 48.3 x endo on every one |
| arithmetic | `data/modded.ts` | `check-modded` (31) | every rule labelled exact/approx/assumed; the wiki's own examples reproduced |
| optimise | `data/optimise.ts` (Q1, Q2, Q3) | `check-optimise` (58) | 564 ms for a weapon fully owned, 1,114 ms for a weapon half owned and 953 ms for a frame (re-measured; this line read "225 ms for a weapon, 456 ms for a frame" and was stale by a factor of two and a half), on an account owning everything; Ideal Braton 60/60 = Primed Cryo Rounds 10 · Serration 10 · Heavy Caliber 7 · Vigilante Armaments 5 · Vile Acceleration 4 → 3,755 dps; 49 of 85 eligible mods scored by Q1 |
| present | the column beside the grid, in two views - one instruction, or the whole build - and NOTHING on the game's own cards | Playwright: 5,136 ENUMERATED states at five resolutions, 34 chosen ones, a stress instrument, frame-by-frame capture | one glance: where you are, the ceiling, the next thing |

**Why the publish decision is a module and not a branch.** Every gate here can
drive the optimiser and none of them can drive `app/background.ts`, because that
file imports Overwolf. So the algorithm was verified exhaustively and the WIRING
not at all - and the wiring is where the ladder was dead: cleared whenever
`session.slot` was null, which is always true for a learned arsenal row, so the
staircase published zero rungs marked `complete` on all six categories it had
just been extended to cover. `data/automod-publish.ts` holds what the controller
DECIDES, with no Overwolf and no module state; `background.ts` keeps the timers,
the windows, the catalogues and the account. The build and the ladder now open on
one branch, and a gate reads the source to prove there is still only one.

**What it costs the machine running the game, measured rather than asserted.**
"i dont want a laggy, unresponsive... overlay" is in the brief and was never
measured against the live client - only the optimiser's own wall-clock timings.
`npm run cost` samples Chromium's own counters on the app's pages twice, ten
seconds apart: over that window the controller and the ingame window each spend
**0.00% of a second in tasks, script, layout and style, with zero layouts and
zero style recalculations**, holding about 10 MB. And publishing into the strip
is not the cost either: 120 consecutive state changes through the real feed
measured **0.0 ms median, 0.2 ms worst** of synchronous work and **zero long
tasks**. (Heap and node counters come back identical for two pages that share a
renderer process - those are the process's; the durations are per page.)

**The running app can be asked what it believes.** Overwolf starts every
renderer with `--remote-debugging-port=54284`, so `npm run live` attaches to the
controller that is up over the game and reads back, without touching it: the
game's resolution as Overwolf reports it (1680x1050 here, the design capture's
own size), which of the four windows are open, the session phase, the plan and
the ladder if a screen is open, and the account's mod counts. It also settles the
one join that had never been checked against an account: **the eleven
`CurrentLoadOutIds` entries map exactly as `build.ts` reads them** - NORMAL 0,
SENTINEL 1, ARCHWING 2, MECH 8, and every other group in `eLoadoutIndex` order.
The match is computed inside the page; what crosses the wire is a list of
indices, never an id and never a name.

**The panel's states are enumerated, not chosen.** `__sweep` is a hand-written
list of 34, and a list cannot promise coverage: 34 chosen states passed while the
column was crushing its own rows at four of five resolutions, and again while a
learned arsenal row was titled "another slot". So `__exhaust` reads the axes off
`Aside`'s own conditionals - one axis per branch that decides whether a row
renders - and walks the cross product: three destinations, the questioned figure,
Forma, the aura line, three assumption depths, unscored, the purse, eight ladder
shapes, an empty ideal, three titles, and the whole no-plan branch (every
resolution rung, with and without an unread row, with and without an edit trail,
in each phase, live and not). **5,136 states**, each fed through the real
component and measured: no row taller than the box it was given, nothing past the
column's end, no `NaN`, `undefined`, `null`, `Infinity` or `[object` anywhere in
the rendered text, and - for the three rows that ARE allowed to clip - the
footer's count checked against the number of lines actually readable.

Run at every size AND in both views: **51,360 renders, 0 failures** - 5,136
states at 1680x1050, 2560x1440, 1440x900, 1366x768 and 1280x720, each swept once
showing the single instruction and once showing the WHOLE BUILD behind the
header's toggle. The instrument clicks that toggle the way a player does and
reads the header back before it believes the view changed, because a pass that
silently measured the first view twice would report a clean sweep of nothing.

Both lists that clip are judged by their marker rather than their pixels: the
caveat list has to say "3 of 5 assumed" and the build list "6 of 8 shown", and a
clip without the count is a failure whatever it looks like.

It has since found four more: the aura line crushed in 192 states, a footer
claiming caveats the column had no room to show a word of, the fullest builds
4-11 px over the column after the type grew, and a route wrapping to a second
line that pushed 240 states past the end at 1366x768.

It found the defect the 34 could not. A column flex item defaults to `flex: 0 1
auto`, so when the panel ran long the browser took the height out of whichever
row it liked: 192 of the first 1,300 states clipped the AURA line, the one line
that says where the eight slots' extra capacity came from. `.am-aside > * { flex:
0 0 auto }` pins every row; the three self-reporting lists keep their own shrink
and say what they cut. `check-strip-life` holds the invariant.

**Three objectives, and the app chooses.** This section said "Q1 only" and
that the armour-aware question was a future objective; both are now out of date,
and the doc is a consumer of the behaviour exactly as the artboard was.

- **Q1** - sustained DPS to UNARMOURED health, no status, headshots, faction or
  conditional effects. It is the honest floor: everything it counts is exact.
  It is what `check-optimise` measures the beam's optimality against, because an
  exact objective is the only fair yardstick for that, and it is no longer what
  the overlay answers.
- **Q2** - the same against 2,700 armour, counting bleed, ignite and poison.
  **This is what a weapon is asked.** Q1 describes almost nothing anybody
  shoots, and the two are not rewordings of one answer: measured on the real
  catalogue the ideal build differs on three of four weapons, and on the
  player's own Broken War five of six mods change - Q1 wants critical damage,
  Q2 wants status and slash, because bleed bypasses armour.
- **Q3** - effective health, for a Warframe, which has no damage figure to
  maximise. Health x (1 + armour/300) + shields, the Tenno curve and not the
  enemy one.

Each carries its own wording on the overlay - "dps · 2,700 armour" is a
different claim from "sustained dps" and is printed as one - never as a silent
change to the number.


### 8.0 What it costs

The brief names Endo and credits before it names mods, and a plan that says
"rank Sacrificial Steel to 10" without saying that costs 15,360 Endo and 741,888
credits is not advice. `data/fusion.ts` carries the curve; every `NextStep` now
carries its price, costed FROM THE RANK THE ACCOUNT HAS rather than from zero.

The curve was not taken from a wiki. The fusion dialog prints its price into
EE.log, `core/eelog.ts` already parsed it, and nine distinct quotes sit in the
player's own log. All nine are reproduced exactly by `10 x rarityFactor x
(2^to - 2^from)` with factors 1/2/3/4, and every one divides to exactly 48.3
credits per Endo - which replaced a research pass that had reconstructed a
separate credit base per rarity and interpolated the middle two tiers. There is
one constant and no interpolation.

The strip shows the two figures the way the game sets CAPACITY on the same
screen, and colours ONLY the resource that is actually short: Endo comes from
sculptures and relics, credits from twenty minutes of Index, and a single
"cannot afford" verdict sends a player to the wrong activity for an evening. An
account the app has not read shows the price with no verdict at all.

### 8.005 The reported bug, reproduced from the player's own log

`scripts/measure-live-log.ts` replays every modding-screen visit the game has
already written into EE.log through the SAME reducer the live controller runs.
Ten visits are recorded, and they settle two things no synthetic test could.

**One visit in ten never saw a close line.** That is the exact failure the player
reported - a strip stuck on screen with no way to remove it - reproduced from
their own play rather than argued about. Without the 90 s silence watchdog the
overlay from that session would still be up. The bug was not a rare race; it is
one in ten.

**Four of the ten visits were the WARFRAME slot**, and at the time the
optimiser had no Warframe objective: Q1 and Q2 both score weapon damage per
second, so on 40 % of the modding this player actually does, the overlay
resolved the item and then had nothing to say. That was the largest single gap
in the product measured by use, and nothing before the replay had any way to
know it - the priority had been guessed from what was easy to build.

That gap is closed. Q3 answers it, and a later replay of a longer log found the
proportion holding: **five of thirteen visits were the Warframe slot.**

The rest of the replay: three visits carried real edits (11, 39 and 2 mods
placed), two carried a full build dump, and the parser read 52 screen lines, 10
fusion quotes, 9 slot presses and 7 saves out of the log. The signal is rich and
the reducer follows it.

The file never prints, stores or matches a raw line - `parseLine` is the app's
own allowlisting parser, and the two lines carrying the player's name are not
among its patterns.

### 8.01 It runs. Live, in Overwolf, with the game up.

Every message in this project's development hedged on the same point: the
overlay had only been seen composited over a screenshot. That turned out to be
a failure of looking, not a limitation.

The app is loaded in Overwolf and running. Warframe is running. Overwolf writes
an app's console to
`%LOCALAPPDATA%/Overwolf/Log/Apps/RaijiFrame/background.html.log`, and reading
it verifies the whole detection chain:

```
[automod] game up area=1680x1050
```

That is the real client area, and it is exactly the 1680 x 1050 every rectangle
in `automod-place.ts` was measured against - so the grid lands on the game's own
slots with no scaling at all. Also confirmed from the same log: the background
page starts cleanly, Overwolf hot-reloads a rebuild within about thirty seconds,
and the one warning it emits (`dropped a read carrying no account keys`) is the
guard working as designed, refusing a thin first GEP push rather than letting it
overwrite a good snapshot.

**The controller now traces its own lifecycle**, which is what made any of this
readable. Before, a session in which the overlay worked perfectly and one in
which it never ran produced identical logs - one warning, then silence. It now
emits one line per rare event: the game appearing, a phase change with its slot,
a plan with its figures and Forma count, the window showing or being taken down,
the catalogues arriving or failing. A modding session produces a handful of
lines. The privacy rule the log tail obeys holds here too: never a raw EE.log
line and never the player's name, only the app's own state.

The CORS errors in the older logs are not a defect either: `gentle` sends a
conditional `If-None-Match`, jsDelivr's preflight refuses that header, and the
documented fallback retries unconditionally. The browser logs the first attempt;
the data arrives on the second.

**It has since been watched, live, and it was wrong twice.** The overlay is no
longer unverified during a real session - it was read over the running game
through Overwolf's own debug port (`npm run live`, `scripts/watch-*.mjs`), and
what that showed is worth more than the gates that passed while it happened.

**1. It named a weapon the player had taken off.** The item is resolved from the
account's loadout presets, and the account is a SNAPSHOT. Equipping something
writes no inventory record DE hands over - `eelog.ts` says so on the
`loadoutSaved` event itself - so the app has to ask GEP, and asking is
asynchronous. It resolved and named anyway: "BROKEN WAR" over an unranked
Ankyros, and later "ANKYROS" over Broken War, each with a full plan underneath
for a weapon that was not on screen. Three things fixed it: the account is
re-read when a screen OPENS, an arsenal equip marks the loadout stale and asks
for a read immediately (the 60 s floor has exactly two named exceptions, counted
by a gate), and until a read newer than that swap lands the panel NAMES NOTHING.
A beat of silence beats a confident wrong answer.

**2. The first fix fired on the CLOSE.** The game emits `HudVis 1` about 206 ms
after `GoToPreviousScreen`, and the reducer read that as a screen becoming
visible with no open on record - the shape of a genuinely late join. Driven over
the whole 697,130-line log, 15 of the 16 idle-to-non-idle transitions in the file
are that artefact. So the refresh fired as the player LEFT, and every real open
after the first arrived from a non-idle phase and was skipped. The trigger is now
`openedAt`, which the reducer sets only on an open the log narrates; and the
phantom itself is refused at the source, because it also carried
`seenWithoutOpen: true` and would have told a player the app had followed all
along that it "joined late".

**3. It made the player wait for the catalogues.** 882 items and 1,516 mods
started loading on the first modding screen, so the first open of every session
paid for them - "it took absolutely forever to load", in the player's words, with
their own trace showing `catalogues ready` arriving after the open. They load
when the GAME does now; the trace shows it before any screen is open.

**4. And the first fix for (1) was keyed to a line that means something else.**
`OnSaveLoadOutCompleteCommon` was read as "the player equipped something",
because it arrived with no modding screen open. Driven over a real session it
fires 7 ms before the ARSENAL screen closes, whether or not anything changed -
it is the arsenal's unconditional write on exit. So every arsenal exit marked
the loadout stale, the panel carried a caveat nothing could clear, the session
parked at `saved` (which made the detector deaf to a genuine equip), and a
bounded retry chain fired four reads in three seconds for nothing. The trigger
is the SCREEN OPENING now: the only moment the answer matters, a few times an
hour, and never a false positive. `openPolicy` is the whole decision and
`check-strip-life` drives it.

**5. And "has the read landed?" was asked of a clock that does not move.**
`inventoryAt` is stamped on a real CHANGE only - `gep.ingest` drops a
byte-identical payload before the store ever sees it, deliberately, because that
is what keeps a repeated read cheap. But an account that has not changed is the
ORDINARY outcome of opening a modding screen, so on a normal visit the answer
never moved the clock the panel was watching: it stayed silent for its whole
four-second window and then printed "the loadout could not be re-read for this
screen" over a loadout the game had just confirmed. `gep.answeredAt` is the
other half - the game answered, and nothing was different - and it is now a
store field, so `npm run live` reports both clocks (`changed` and `answered`)
instead of the one that reads null on a working app. The SEED counts as a read
too: at startup the account comes off disk and the seed reads the same account
out of the game, so the merge returns the object it was given and `inventoryAt`
never moves. Leaving the seed out made the FIRST screen of every session the
broken case.

**6. And "did the game answer?" is a question about the ACCOUNT, which took two
tries to get right.** `ingest` now reports one verdict for the inventory key -
`absent`, `same`, `fresh` or `unusable` - and both the floor and the answer
clock read it. Counting routed and rejected payloads across the whole bag,
which is what the first version did, was wrong in both directions and review
caught both by driving the real `ingest`:

- `route` returns true for `gep_internal` (one of Warframe's four GEP keys) and
  for anything Overwolf adds later, so a bag carrying the provider's own version
  block and nothing else counted as a successful account read. That marks the
  seed done - killing the retry that exists for a player who sees nothing at all
  - and stamps the clock the panel treats as permission to name a weapon. The
  photographed failure, with its one safety net switched off by the read that
  failed.
- `route('highlighted')` returns false whenever nothing is hovered, which is the
  ordinary state, and a refusal's hash is deliberately never recorded, so it
  repeats on every read. Counting refusals in general meant one un-hovered frame
  cleared the one-minute floor for the rest of the session and stopped the
  answer clock moving ever again - the exact regression this pass existed to
  remove, caused by a key with nothing to do with the loadout.

A truncated account still clears the floor, which is what the change was for:
GEP reads the game's memory while the game is writing it, `route` refuses the
half-written JSON and does not record its hash so an immediate retry would
deliver the good value - and the floor used to refuse that retry. And `route`
now applies `isPlausibleAccount`, the same test the store makes, so a
well-formed `{}` can no longer be counted as delivered by one and rejected by
the other.

**7. AND THE APP HAD NEVER READ THE ACCOUNT FROM THE GAME AT ALL.** Fixing (6)
made the seed stop lying about its own success, which surfaced this: `gep`
reported `connected`, `accepted` was `0`, and every number the overlay showed
came from the snapshot on disk. Asked directly through the debug port, the
provider was holding a 247,972-character inventory. It parses to two keys:

    { "InventoryJson": "<the whole account, as ANOTHER JSON string>",
      "MissionRewards": [] }

Neither is an account key, so `isPlausibleAccount` counted zero and `route`
refused every read GEP had ever sent. The 150 keys inside `InventoryJson` are
the real thing - `RawUpgrades`, `Upgrades`, `CurrentLoadOutIds`,
`LoadOutPresets`, `FusionPoints`, `RegularCredits`, the weapon and frame lists.
`unwrapInventory` does the second parse, the flat shape is still accepted
because that is what the disk snapshot is, and a half-written inner string
returns null so the floor opens for the retry. Measured after the fix, on the
same running game: `accepted: 1`, `durable: true`, both clocks moving.

That is the honest answer to "it was totally wrong". The panel was planning
against an account frozen at whatever moment the disk copy was written, and no
gate could see it because a full account was loaded and every screen looked
populated.

**8. And the panel publishes from one place.** A read that changed something
published from the `inventory` handler; a read that changed nothing had to be
caught by the deadline timer - and the timer nulls itself when it fires, so an
answer arriving even slightly late published nothing at all and left its caveat
up for the rest of the visit (a real visit was measured at 88 s with no further
arsenal line). `answered` fires for every read that carried an account, pushes
included, and is now the only publish site for reads.

### 8.015 A visit with no slot line, and a proposal this section got wrong

**Measured over every card-screen open in the log, not eyeballed: 4 of 11
emitted no `upgradeSlot` line at all - 36.4 %.** (An earlier line here said
"roughly half", which came from watching four live visits rather than counting.)
The 7 that did carry a press were all indices 2 and 3, and the press-to-open gap
is 286-352 ms, median 303 - against a source comment that claimed 15-20 ms and
has been corrected, because tightening the window to match THAT would have
stripped the slot from every visit. `categoryOpen` resolves from the slot (0-3) or from
`learned[unreadSlot]`, so a visit with neither has no category, no build and no
plan FOR ITS WHOLE LIFE - the overlay shows, has nothing to say, and takes
itself down. Placing mods cannot rescue it: slot-learning is keyed BY INDEX, and
there is no index to key a lesson to. `eelog-upgrade-screen.md` already names
this path - two of its five visits came through the Mods segment, which emits
no `_Mod` slot line and no `GoToScreen`.

**AND THE FIX THIS SECTION FIRST PROPOSED DOES NOT WORK.** It argued that the
log's build dump could identify the item with no slot at all, and offered a
measurement: the fingerprint (polarities plus installed mod names) is unique for
28 of 28 modded configs on the real account, zero collisions, while polarity
alone collides 24 ways because 35 of 37 items carry no `Polarity` array.

That measurement is real and it is the wrong join. It hashed the ACCOUNT's mod
leaves, which are unique within one account's installed set. The DUMP's leaves
are not the same thing, and `eelog-upgrade-screen.md` had already established
both reasons this cannot work - neither of which the proposal checked:

* **The dump is almost never there.** `Modded Capacity:` appears TWICE against
  SIXTY-SIX card-screen opens, and neither occurrence follows a slot press it
  could be attributed to. Re-measured here on the current log: three dumps in
  the whole file, one a repeat, none of them the item the app was planning at
  the time, and two of the three carrying no `Initial Capacity` line. It is
  written at SAVE, which is what `background.ts` says where it uses
  `dump.initial`. It confirms a build; it cannot announce one.
* **Its leaves collide across classes.** `WeaponCritDamageMod` is Vital Sense
  under `/Rifle/` and Organ Shatter under `/Melee/`; `WeaponSlashDamageMod` is
  Shredder and Jagged Edge. A dump leaf resolves only once the item's CLASS is
  known - which is the thing a slot-less visit is missing. Circular.

So the no-slot visit is an OPEN PROBLEM, not a solved one, and the research
already says where the signal is: placements, which carry the full mod path and
have no leaf ambiguity - fifty-four of them on one index in that log. What is
missing is a way to use a placement when there is no index to attach it to.

**The one thing here that does hold is the live-score gap, and it is separate.**
`planFor` reads `session.dump` for the base capacity and the stance bonus, but
the installed mods come from `build.installed` - the ACCOUNT's saved config. So
during a visit the plan is frozen: measured live, the Grimoire held
`now=628 ideal=1451 steps=4` across eleven consecutive publishes while the
player placed eleven mods. "5 of 8 already right" was counting a build that was
no longer on the screen, and the instruction never advanced.

That one needs no dump and no identification. `modInstalled` fires on every
placement with the full path, the session already folds them, and `netEdits`
returns the net `{placed, lifted}` for the visit. The INSTRUCTION now advances
on exactly that (`stillToDo`); the FIGURES still describe the saved build.

**And the reason first given for not moving the figures was wrong.** It said the
rank of the copy the player placed is unknowable, so a rescore would have to
guess. Measured on the real account instead of asserted:

| mod types owned | held at ONE rank | at two | at three |
|---|---|---|---|
| 352 | **306 (86.9 %)** | 44 | 2 |

A mod the account holds at a single rank has a DETERMINED rank the moment its
path arrives - there is nothing to guess for seven placements in eight. The
remaining 13 % is a stated assumption, which this panel already has a mechanism
for. And the other unknown, which slot it went into, changes whether the build
FITS rather than what it scores; the greedy polarity assignment is already an
assumption the app prints.

So the live rescore is feasible and the honest blocker is smaller than claimed:
it is work, not an impossibility. It is left undone deliberately - it touches
the scoring boundary, which is where a wrong number reaches the player - and
this table is here so the next pass starts from the measurement.

*(Twice in one session this document asserted the app could not know something
and was wrong both times - here, and the dump proposal above. The repo's own
rule is `check-before-claiming-a-limit`: grep and measure before writing the
excuse.)*

### 8.02 Checked against the game, for the first time

Every other check in this repo compares the app against a wiki formula or
against itself. `scripts/measure-against-game.ts` compares it against numbers
the GAME printed on the player's own Upgrades panel, for the eight-mod Broken
War in the capture.

| stat | the game | the app | ratio |
|---|---|---|---|
| critical chance | 70 % | 73 % | 1.050 |
| critical damage | 4.2x | 4.18x | 0.995 |
| impact | 99.1 | 46.46 | 0.469 |
| puncture | 99.1 | 46.46 | 0.469 |
| slash | 2,220.1 | 1,114.99 | 0.502 |
| **total** | **2,418.3** | **1,207.90** | **0.4995** |

**The headline number is half.** Crit lands within half a percent, so the mod
arithmetic is not the problem. The app's damage multiplier off base is x6.4594
against the game's x12.9321 - a ratio of 2.0021 - so the multiplier is right and
the BASE is wrong: the game's total implies a base of 374.4 where the catalogue
(WFCD `Melee.json`) states 187.

**No correction has been applied.** One weapon is one data point, and doubling
every melee figure the app prints on the strength of it would be exactly the
kind of confident wrong answer this project exists to avoid. The two candidate
explanations - a stale export, or a game-side factor the app does not model -
are being settled against the wiki and against other melee weapons before
anything is changed.

This is the finding the whole session had been unable to reach, and it took one
comparison against a real number to surface it. Nothing else in the repo could
have: every gate agreed with a formula that is internally consistent and
externally half.

### 8.03 Where a missing mod comes from

"You are missing this one" was where the advice stopped, and "taking into
account WHEN you might get certain mods" is in the brief. `data/acquire.ts`
answers it, gated by `check-acquire` (9).

**The claim that this already existed was false.** `moddb-spec.md` justified
discarding the export's whole `drops` array by saying "where a mod drops is
already the acquisition layer's job (`acquire.ts`)". No such file existed and
nothing in the app could say where any mod came from. The array is still not
persisted - it is 1,096 KB of a 3,666 KB catalogue against a 5 MB localStorage
cliff whose overflow `gentle.commit()` swallows silently - but the single BEST
source per row now is, at about 84 KB, which is the only part the overlay would
ever show. `check-moddb` verifies that best against the raw table on 1,127 rows,
so a projector that silently took the FIRST drop instead of the highest-chance
one would fail rather than agree with itself.

Three answers, deliberately three different shapes so a caller cannot render the
third as if it were the first:

| the catalogue says | the overlay says |
|---|---|
| a rated drop | the place, and about N runs |
| no drop, tradable | no drop; trade for it |
| no drop, not tradable | source unknown |

The expectation rounds UP. Rounding 9.05 down to 9 would tell a player the run
they are about to start is the one that pays on average, which is a promise
this cannot make. Missing mods sort easiest-first, and a trade sorts under every
farm however long - it costs platinum rather than time, and the overlay should
not lead with money.

### 8.045 The exhaustive route, tried and closed

Before accepting the beam, the obvious question is whether the space can be made
enumerable. There is a proof that would do it if it applied:

> A mod B is DOMINATED by A when A costs no more drain and gives at least as
> much of every bucket the objective reads. Dominance alone does not let B be
> deleted - an optimal build might hold both. But the grid holds eight mods, so
> if EIGHT distinct mods of other families dominate B, any build containing B
> has at most seven others and one dominator must be free to replace it. B can
> never be needed.

`scripts/measure-dominance.ts` applies it. It removes **one** mod from the
Braton's 67 and **none** from Broken War's 63, leaving 5.7e9 sets of eight.

The rule is right; the pruning is negligible, and the reason is structural
rather than a bug. Dominance requires A to match B in EVERY bucket, and a damage
mod and a crit mod share no bucket at all, so neither dominates the other.
Almost the only pairs that do dominate are a mod and its own weaker variant, and
the family rule already excludes those from sitting together.

**So the beam is a measured necessity, not a corner cut**, and the honest claim
about it is the one the gate proves. The next idea, if anyone returns to this,
is a per-bucket admissible over-estimate for branch-and-bound - which yields a
provable optimum without enumerating, and is much harder to get right, because a
bound that is not truly admissible produces a wrong answer labelled optimal.

### 8.04 "Every possible combination", measured

The brief asks for "every single possible mod combination ... in the entire
game". The optimiser does not enumerate them and cannot: choosing 8 of the
Braton's 85 eligible mods is 48,124,511,370 sets before ranks, before slot
assignment, before scoring. It runs a beam.

**And the smallest real case is no better.** That figure invites the reply
"then take a smaller item", so it was tried. Ash under Q3 is the narrowest
search this app performs - of 122 eligible mods only 25 score, collapsing to 21
families, and C(21,8) is 203,490. Enumerable, apparently. It is not:

- **At max rank only**, a depth-first walk of those families with a capacity
  bound visits 159,837 nodes in 298 ms and returns 3,936.70 effective health.
  The beam returns **4,049.47** and BEATS it, because the enumeration cannot
  express what the rank-down pass found - Steel Fiber at rank 8 rather than 10,
  which frees the two points that let a sixth mod fit. So a max-rank
  enumeration is not an upper bound at all: it is a lower bound over a strictly
  smaller space, and the rank-down pass is worth +112.77 EHP, +2.9 %, here.
- **Rank-complete**, every rank of every scoring mod its own candidate (195
  candidates over 21 families): 40,000,000 nodes in 80 seconds without
  finishing, its best still at 2,918.

The objective is a PRODUCT of buckets rather than a sum, so knapsack DP does not
collapse it and there is no cheap admissible bound to prune with. That is the
reason a beam exists, stated with a number rather than as an assertion.

So the honest question is whether the beam ever returns a worse build than
enumeration would, and `scripts/measure-beam.ts` answers it by running both:

| pool | sets enumerated | capacity 30 | capacity 60 |
|---|---|---|---|
| 8 | 256 | identical | beam +17.1 % |
| 14 | 16,384 | identical | beam +8.6 % |
| 20 | 1,048,576 | identical | beam +8.6 % |

Identical at a tight capacity across a million legal sets, and AHEAD at a loose
one - because the beam may rank a mod down to make room and an enumeration over
max-rank sets can never find that build. It is not an approximation that costs
anything measurable; it is strictly better than the thing it approximates, at
90 ms against 532 ms.

**The first run of this measurement was wrong, and instructively.** The
enumeration did not apply the game's family rule, so it was free to install
Serration beside Primed Serration - and it duly "beat" the beam by 0.44 % with a
build no player can make. Widening the beam from 200 to 800 changed nothing,
which is what showed the gap was not the beam's. A benchmark allowed to cheat
measures the cheat. `check-optimise` now runs the same comparison over 16,384
sets at both capacities, with the family rule applied.

### 8.05 Every UI state, and the one that rendered blank

`composite.html` carries `window.__sweep()`, which feeds the strip each state it
can be in through its own local feed and returns what actually rendered. Twenty
states, all fitting inside the 263 px column. It found one defect that nothing
else would have:

**A build at its ceiling rendered nothing.** `next` is empty when the account
already owns every mod the ideal wants, at rank - the state the whole overlay
exists to reach - and it fell through the `plan && hero` branch into the
fallback, which printed a title, a rule and empty space. It now has its own
rendering: the figure in the ceiling's gold, the meter full and thickened, and
the claim.

The claim is gated. An empty step list is NOT by itself proof that Now is Ideal:
a mod held ABOVE the rank the ideal wants is skipped when steps are built, and
its higher drain can push the real build off the ideal. So "nothing in the game
raises this build further" is said only when the two figures actually meet, and
a narrower sentence is used otherwise.

### 8.055 The motion, watched

The brief asks for an overlay that is "extremely elaborate and properly
animated" and that "guides you with animations". Reading a duration does not
tell you whether anything moves, so `cgc motion` stepped the page under a
virtual clock and photographed every frame. The first sheet was unambiguous:

> jump-cut - one frame carries 100% of the whole change - this snaps, it does
> not move.

Ten of eleven frames showed nothing at all. The entrance was a 7 px slide and a
5 px drop, which on a 1680 px screen is not a movement anybody perceives.

**The grid now deals itself out**, one card every 55 ms across the row and then
down, 18 px of travel and a scale of 0.88 - several times what it was - and the
aside's rows assemble on the same rhythm rather than appearing as a block. The
tick on a finished slot lands 140 ms after its own card. Measured on the deal
itself (`?demo=owned` with `--trigger click:#replay`, so the clock is not
measuring the DATA arriving): a real ease-out, 37 / 51 / 76 / 94 / 99 / 100 per
cent across six frames, settling at 238 ms. No jump-cut.

**And reduced motion is a blanket, not a list.** The list of animated selectors
had fallen behind the stylesheet - two of its names matched nothing any more,
and `.am-missing li` was never reached - so the tool measured the page still
travelling half as far under `prefers-reduced-motion`. Every animation and
transition inside the overlay is now off in one rule, with the only
`!important` in the file, because a viewer who asked for less motion outranks
any specificity a stylesheet can invent. Verified directly rather than by the
sheet: 27 elements animate normally, **zero** under reduced motion.

### 8.06 The figure moves

The strip says "slot this, +784"; the player slots it; the damage figure has to
be SEEN to go there, or nothing told them they succeeded. `useCountUp` tweens it
over 420 ms on the same curve the meter uses, so figure and bar arrive together.

Watched rather than read: 30 distinct values, 51 % of the distance covered in the
first 25 % of the time (front-loaded, not linear), landing exactly on the target
at 413 ms. Under `prefers-reduced-motion` it collapses to a single step. It never
runs on mount - an arriving strip shows the true number at once.

It also carries a plain-timer backstop. `requestAnimationFrame` does not fire
while a document is unpresented, and an Overwolf overlay is unpresented often; a
stalled tween would leave a stale damage figure on screen, which is worse than no
animation at all.

### 8.1 The strip's lifecycle, and the bug that forced it

A player photographed the strip stuck on screen reading `ITEM UNKNOWN / SAVED`
with no way to remove it. Three defects, all now gated by `check-strip-life`:

1. **The window outlived the page that owned it.** `stripShown` is a claim this
   background page makes about a window it does not own, and an Overwolf window
   survives a page restart. `hideStrip` early-returned on `!stripShown`, so the
   hotkey, the panic key and the overlay's own close button all declined to act.
   The guard is gone, and startup reconciles against `getWindowState`.
2. **Nothing took it down when the log fell silent.** The reducer reaches `idle`
   from exactly ONE line - the `UpgradeCards` close - and alt-tab, a crash or a
   late-started tail never produce it. A 90 s silence watchdog now does, fed by
   the arrival of any arsenal line rather than by a state change: 6 of the 14
   lines fold to the same session object, so a state change is the wrong signal
   and a player reading the screen would have lost the strip under them.
3. **It appeared with nothing to say.** `hasSomethingToSay()` gates the show on a
   plan or an edit. An overlay taking a column of the screen to report that it
   does not know what the item is, is not an overlay.

### 8.2 The card

Five passes of `ui/ModCard.tsx` worked from memory and produced a rectangle with
a notch in its top edge. The sixth traced the real thing out of the capture at
3x: an octagonal body with a crest, a separate base plate carrying the pips, a
cut-cornered drain tab, and a frame that is dark metal with two lit rails rather
than a bright mat. Matching the card's mean colour - which three passes did - is
what made every one of them read as a flat tile; no pixel on a game card is that
colour.

**Still unknown, still named:** the 11-slot index order (the grid is taken
as indices 0–7 and the strip says "assumed"); the mismatched stance factor;
Umbra ↔ Madurai; whether a live push carries `mod` on the preset; the
window has not yet been watched in the running game.
