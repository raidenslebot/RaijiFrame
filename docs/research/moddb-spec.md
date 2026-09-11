# The mod catalogue and its stat parser — specification

Written 2026-09-07 from a two-reader + adversarial-critic census of the WFCD
exports (`Mods.json`, 1,806 rows; `Primary/Secondary/Melee.json`, 612 rows),
re-fetched and re-counted by the critic. Every number below was measured on
that fetch. This is the document the implementers build from and the
verifiers judge against; nothing in it is a guess, and where the data is
silent the word is **unknown**, never zero.

Two modules, two gates:

| module | reads | produces | gate |
|---|---|---|---|
| `src/data/modstats.ts` | one row's `levelStats` strings (+ `description`) | `Effect[]` and `Refused[]` per rank | `scripts/check-modstats.ts` |
| `src/data/moddb.ts` | `Mods.json` through the existing gentle fetch | `ModDb`: path-keyed rows after the Part A filter | `scripts/check-moddb.ts` |

`moddb.ts` imports `modstats.ts` (one direction). Neither imports a panel, the
store, or `itemdb.ts`. Neither touches any player data: this is catalogue only.

## The one rule above all others

**Identity is `uniqueName`, never `name`.** 138 names cover 404 rows;
"Unfused Artifact" alone covers 43. An optimiser that picks "Serration" or
"Barrel Diffusion" by name, or by largest magnitude, silently pulls +40 % /
+90 % or the phantom +220 % into every build. The Part A row filter runs before
any string is parsed.

## Part A — row filter (moddb.ts)

Run in this order on every row of `Mods.json`:

- **A1 DROP.** `uniqueName` matches `/\/PvPMods\/|PvPAugmentCard$/` (152
  Conclave rows). `uniqueName` matches `/SampleAntiqueUpgrade|InnateDamageRandomMod|RandomMod/`
  (a DE test row + 10 Railjack random templates). `type` matches
  `/Riven|Transmutation/` (riven templates carry per-rank multipliers under
  `upgradeEntries` with `|val|` locTags; real riven stats live in the player's
  inventory, not this file).
- **A2 PHANTOMS.** `uniqueName` ends in `Intermediate` or `Expert` AND another
  row has the same `name` without that suffix → DROP. **108 rows** on the
  2026-09-07 export (75 Expert + 33 Intermediate): unobtainable copies at
  inflated magnitudes — Handspring "+440 %", Barrel Diffusion "+220 %
  Multishot". A row under `/Expert/` whose `name` is unique (Primed *,
  Galvanized Elementalist / Reflex / Steel) is real → KEEP. The rule is
  "suffix AND duplicated name"; a path filter alone is wrong. *(Correction,
  same day: the first draft of this line said 145. That was the critic's
  count of A1 survivors whose PATH contains "Expert" — 75 phantoms + 70 real
  rows including the 66 Primed mods — i.e. the path filter this rule says is
  wrong. The implementer measured it; the gate pins both numbers.)*
- **A3 FLAWED.** `uniqueName` ends in `Beginner` → KEEP; `displayName` becomes
  `Flawed <name>` (104 rows: obtainable, weaker). `name` is kept as the
  export wrote it.
- **A4 DESCRIPTION-ONLY.** Rows with no `levelStats` (78 Stance, 17 Parazon,
  4 Transmute, 33 Plexus "Unfused Artifact", 19 Mod Set carriers, …) produce
  zero effects. NEVER read `description` as a stat line.
- **A5 RANK.** The rank-r line set is `levelStats[r].stats`; max rank is
  `levelStats[levelStats.length - 1]`, NOT `levelStats[fusionLimit]` (49
  Plexus rows have `length !== fusionLimit + 1`; 40 of them change values per
  level). Parse every rank independently; never derive rank r from rank 0
  (352 of 1,602 single-number series are non-linear — Abating Link
  30/40/50/60; 272 lines change more than one number per rank).
- **A6 INVARIANT.** The digits→N normalisation of a line must be identical
  across every rank of that line (holds on 1,920 / 1,920 series). A violation
  is corrupt data → refuse the whole row, by name.
- **A7 DESCRIPTION AS CONDITION.** If `description` ∈ {`On Hit:`, `When
  Aiming:`, `On Respawn:`, `With Melee Equipped:`, `On Directional Dismount:`,
  `On Ability Cast:`} attach it as a trigger condition to every effect of the
  row; if it matches `/cannot be modified|Only compatible with/` attach it as
  a restriction; otherwise ignore it.
- **A8 SLOT.** `compatName` is the slot (missing on 223 rows: Focus Way,
  Plexus, Mod Set carriers, Railjack, rivens → slot `unknown`). Auras are
  `baseDrain < 0` with `compatName === 'AURA'` (36; Power Donation and Steel
  Charge are −4). `polarity: 'aura'` occurs on one row (Dreamer's Bond) and
  is not the aura marker. `isExilus` (37) and `isUtility` (194) are
  present-only-when-true. **`isAugment` is worthless** — true on all 454
  "Warframe Mod" rows including Vitality, false on the three Archwing
  augments; augments are detected from the `<Ability> Augment:` header in the
  stat text (rule R9).

### Allowlisted fields (nothing else is kept)

`uniqueName`, `name`, `polarity`, `baseDrain`, `fusionLimit`, `rarity`,
`compatName`, `type`, `isExilus`, `isUtility`, `isPrime`, `modSet`,
`modSetValues`, `levelStats` (consumed by modstats, not stored raw),
`description` (consumed by A7, not stored raw), `wikiaThumbnail`, `tradable`,
`introduced.name`.

**Not persisted: `drops[]`.** Measured by the implementer: the parsed
catalogue is 3.1–3.5 MB with a stub parser, of which `drops` is 1.1 MB
(15,711 `{location, chance, rarity}` rows); with real `Effect` records the
total crosses the 5 MB localStorage cliff, and `gentle`'s `commit()` swallows
the quota failure silently (`src/core/gentle.ts:322`), so the symptom would be
a 5.7 MB refetch on every launch rather than an error. Where a mod drops is
already the acquisition layer's job (`acquire.ts`, `check-drop-sources.ts`);
the catalogue does not carry it a second time. For the same reason an
`Effect` carries `text` only when `op` is `unparsed` or a template, and a
`Refused` entry keeps `{ rule, reason, text }` and no more. Observed value sets, for the gate: `baseDrain` ∈ {0 ×156,
2 ×353, 4 ×597, 6 ×457, 10 ×87, −2 ×135, −4 ×2}; `fusionLimit` ∈ {0 ×31,
3 ×860, 5 ×620, 10 ×259, 434 ×17 riven}; `polarity` present on 1,787.

### Output shape (moddb.ts)

```ts
export interface ModRow {
  uniqueName: string;           // the key
  name: string;                 // as exported
  displayName: string;          // 'Flawed ' + name on A3 rows
  slot: string | null;          // compatName; null = unknown
  polarity: string | null;
  baseDrain: number | null;
  fusionLimit: number | null;
  ranks: number;                // levelStats.length; 0 on A4 rows
  isAura: boolean;              // baseDrain < 0 && slot === 'AURA'
  isFlawed: boolean;
  isExilus: boolean;
  isUtility: boolean;
  isPrime: boolean;
  rarity: string | null;
  type: string | null;
  modSet: string | null;
  modSetValues: number[] | null;
  thumbnail: string | null;
  tradable: boolean | null;
  introduced: string | null;
  effects: Effect[];            // from modstats, all ranks
  refused: Refused[];           // from modstats, all ranks
}
export interface ModDb {
  byPath: ReadonlyMap<string, ModRow>;
  /**
   * Every kept row that shares an export `name` (so 'Serration' maps to the
   * real row AND its Flawed variant) — for the leaf-name resolver, never for
   * lookup. Keyed by `name` as exported, not by `displayName`.
   */
  byName: ReadonlyMap<string, readonly ModRow[]>;
  /** templates counts every A1 non-PvP drop: 15 riven templates, 10 Railjack random templates, 4 Transmutation cores, the DE test row = 30. */
  dropped: { pvp: number; phantoms: number; templates: number; corrupt: string[] };
  fetchedAt: number | null;
}
export function parseModsJson(body: string): ModDb;       // pure; what the gate tests
export async function loadModDb(): Promise<ModDb>;         // gentle fetch + cache, same pattern as loadItemDb
```

The fetch goes through the existing gentle helper with its own cache key
(a changed parse shape needs a NEW cache key — see memory
"gentle caches parsed values"). Source URL:
`https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/Mods.json`
(5,745,763 bytes). The host must be in the manifest's `externally_connectable`
— check; if absent, report it, do not edit the manifest.

## Part B — lexer (modstats.ts)

- **B1 pre-pass.** Replace the literal two-character sequence backslash+`n`
  with a LINE token — there is **no U+000A anywhere** in `levelStats`; a
  splitter on a real newline finds nothing. Remove `<LINE_SEPARATOR>`. Trim
  (10 strings carry leading/trailing spaces; Proton Snap [1] is
  `' and +50% …'`). Collapse runs of spaces. Map `’` → `'`. Stat-name
  comparison is case-insensitive (`+120% COMBO COUNT CHANCE`, `ON HIT:`).
- **B2 TAG** := `<` `[A-Z0-9_]+` `>`.
  DT tags: `<DT_(IMPACT|PUNCTURE|SLASH|FIRE|FREEZE|ELECTRICITY|POISON|EXPLOSION|RADIATION|GAS|MAGNETIC|VIRAL|CORROSIVE|RADIANT)_COLOR>` and `<DT_SENTIENT>`.
  Map FIRE→Heat, FREEZE→Cold, POISON→Toxin, EXPLOSION→Blast, RADIANT→Void,
  SENTIENT→Tau, the rest by name. The damage type is ALWAYS the tag; the
  word after it is optional (`apply <DT_SLASH_COLOR> on Critical`), may be
  preceded by a space (`+4 <DT_PUNCTURE_COLOR> Puncture Status Effects`), may
  be a variant (`<DT_ELECTRICITY_COLOR>Electric`). Consume tag + optional
  adjacent word as one DTYPE token.
  `<LOWER_IS_BETTER>`: presentation only — delete it; it never carries sign.
  `<MADURAI_CLEAN|NARAMON_CLEAN|ZENURIK_CLEAN|VAZARIN_CLEAN|UNAIRU_CLEAN>` → SCHOOL token.
  `<ENERGY> <SHIELD> <USE> <SECONDARY_FIRE> <AFFINITY_SHARE> <ACTIVATE_ABILITY_1>` → icon/keybind; the string is PROSE (R9).
- **B3 NUM** := `[+-]? \d{1,3}(,\d{3})*(\.\d+)?` | `[+-]? \d+(\.\d+)?`
  (`+1,000`, `+30,000`, `0.05`, `4.0`, `0`). Keep the displayed sign; keep
  percentages on the 100 scale — never divide.
  MULT := `x` NUM (prefix: `x1.3`, `x0.20`, `x3.0`). COUNT := NUM `x`
  (suffix: `Stacks up to 5x`, `8x Combo Multiplier`).
- **B4 UNIT** := immediately adjacent to NUM: `%` | `m` | `s` | `/s` |
  `/sec` | `sec` | ordinal `st|nd|rd|th`. `12 m` with a space (one Tektolyst
  line) is prose. An ordinal makes the NUM a label, never a magnitude.
- **B5 PLACEHOLDER** := `|` `[A-Z0-9]+` `|` → the whole string is REFUSED (R0).
- **B6 FACTION** := Corpus | Grineer | Infested | Orokin | Murmur | Sentients
  (`Damage to Amps` is a stat name, not a faction).
- **B7 MAGNITUDE vs PARAMETER.** A NUM is a magnitude only when it (a) is
  the first token of the line, or the first after a TRIGGER (R1) or SUBJECT
  (R2) prefix, or after ` and `, AND (b) carries a sign, or is a MULT, or is
  immediately followed by `%`. Every other NUM is a parameter bound by its
  context word and must never be emitted as the effect's value:
  `for Ns` → duration; `Stacks up to Nx|N%|N times`, `(Max stacks N)`,
  `(Maximum N stacks)`, `Max N stacks`, `Capped at N%`, `up to N%` →
  stackCap; `within Nm`, `Nm radius`, `in a Nm` → radius; `every Ns`,
  `Cooldown: Ns`, `Ns cooldown`, `(cooldown Ns)` → cooldown; `per <basis>` →
  scalingBasis; `below N`, `over Nm`, `Magazine N or higher`, `for every N
  Health`, `if N pellets` → threshold; `next N shots`, `N or more enemies` →
  count.

## Part C — grammar (ordered; first rule matching the WHOLE string wins; anything left over is REFUSED with rule id, reason, full text, uniqueName, rank, element index and the NUMs found)

- **R0 REFUSE-FIRST.** Contains a PLACEHOLDER; contains no NUM at all (22
  distinct effect-only lines such as `Convert all base Physical Damage to
  <DT_IMPACT_COLOR>Impact Damage` — emit `{ op: 'unparsed', text }` so the
  optimiser can display and veto, never drop silently); contains an
  icon/keybind tag.
- **R1 TRIGGER** := `^ TRIGGER_HEAD ':' (LINE | ' ') BODY`. TRIGGER_HEAD ∈
  {On Kill, On Melee Kill, On Headshot, On Headshot Kill, On Hit, ON HIT, ON
  CRITICAL HIT, On Reload, On Reload From Empty, On Equip, On Ability Cast,
  On Dodge, On Low Health, On Status Effect, On Status Effect with Weapon,
  On Weak Point Hit, On Weak Point Kill, On Weak Point hits with Primary
  Fire, On Heavy Attack Hit, On Bullet Jump, On Kill or Assist, On Kill with
  Secondary Weapon, On Consecutive throw (Max stacks N), On N Hits within
  Ns, On N Melee Kills within Ns, On <DTYPE> Status Effect, When Damaged, At
  Less than N Health, Burst Fire Only}. Numbers inside the head are
  parameters. A head of the form `<Words> Augment ?:` is NOT a trigger (R9).
  BODY is one or more LINE-separated R3 expressions and MAY contain a second
  TRIGGER block (Galvanized Scope). Each inner effect gets
  `conditions: [trigger]` plus duration/stackCap from the body.
- **R2 SUBJECT** := `^ (Squad(?:'s Companions)? (receives?|gains?|deals|takes|converts|benefits|begins the mission with) | Warframe receives | You (lose|benefit) | Squadmates gain | Enemies lose | Enemy FACTION lose) R3`.
  target = squad | self | enemy(faction?). Sign: a signed NUM is
  authoritative and the verb is ignored (`Enemies lose -18% Armor` = −18);
  unsigned → the verb supplies it (`You lose 30% Ability Strength` = −30);
  `Squad takes 24% reduced damage` → refuse (double verb).
- **R3 STAT** := `SIGNED_NUM UNIT? NAME QUAL* NOTE?`
  `SIGNED_NUM '%' NAME` → `add_pct`. `SIGNED_NUM NAME` → `add_flat`.
  `SIGNED_NUM ('m'|'s'|'/s') NAME` → `add_flat` with unit. `MULT NAME
  ('to'|'vs') FACTION` → `multiply` with faction. `MULT NAME` → `multiply`.
  NAME := (DTYPE | word)+ up to the first QUAL keyword, `(` or LINE. NAME
  beginning with DTYPE and the rest empty or `Damage` → `elementalDamage(type)`;
  rest `Resistance` → `resistance(type)`; `+N% <DTYPE> on Bullet Jump` →
  `parkourProc(type)`, NOT weapon damage.
  NAME containing `/` or ` and ` with no following SIGNED_NUM → DISTRIBUTIVE:
  one effect per conjunct, same magnitude and conditions (`Critical Chance
  and Damage`, `Hull and Armor`, `Viral and Magnetic Damage and Status
  Chance`). ` and ` followed by SIGNED_NUM → a second independent R3.
  Parentheticals: `(xN for Bows|Heavy Attacks)` → altMultiplier; `(+N% Enemy
  Max Health)` → second magnitude `EnemyMaxHealthPct`; `(Use with Caution)`,
  `(Disables Punch Through)`, `(In Space)`, `(Non-AOE Bows)` → note. A
  trailing sentence after `. ` → note. Canonical stat keys: case-folded NAME
  with the DTYPE replaced by its damage type; `to Parkour Velocity` →
  `Parkour Velocity`; `Final Status Chance` stays distinct from `Status Chance`.
- **R4 QUAL** (any order after NAME; each a condition, never a value change):
  `when (Aiming|Crouching|Airborne|Holstered|Sliding|Blocking|Falling|knocked down|inside the Marked Zone|no enemies within Nm|targeting Warframe|Shields are above N%)`,
  `while (Aim Gliding|Airborne|Blocking|Channeling|Invisible|Dodging|Hacking|N% Hull|over N% Shields)`,
  `during (Bleedout|Bullet Jump|Breach)`, `on (Heavy Attack|Slide Attack|Bullet Jump|Block|first shot in Magazine|Lifted enemies|Self|Shotguns|Nikanas|Jump Kick|Stun)`,
  `for (Secondary Weapons?|Slide Attack|Tennokai attacks)`, `for your Nth Ability`, `per <basis>`, `against <target>`, `after <event>`, `if <clause>`, `stacks with Combo Multiplier`, `for Ns`, `Stacks up to …`, `(Maximum N stacks)`, `Cooldown …`, `Max N stacks`.
  Unknown qualifier text after a well-formed R3 head → REFUSE (never keep the head and drop the tail).
- **R5 LEADING-UNSIGNED** (only these two): `^N% of Damage converted into <DTYPE>` → `convert`; `^Nm Companion Gather-Link` → `add_flat`. Any other digit-leading line (32 more) → REFUSE: unsigned means "set", "of" or "chance" as often as "+".
- **R6 CONTINUATION.** An element beginning with `and `, ` and `, `if `, `in a `, `(` continues the PREVIOUS element of the same rank; join with one space and re-run R1–R4 on the joined text (Double-Barrel Drift, Gun Glide, Strafing Slide, Proton Snap, Spring-Loaded Broadhead, Entropy Detonation's three fragments). Never parse the fragment alone.
- **R7 FIXED PROSE TEMPLATES** (exact match after digits→N; each yields named fields): `Converts (Primary|Secondary) ammo pickups to N% of Ammo Pick Up.` → ammoMutation; `Reduced damage by N% while airborne` → damageReduction; `Convert +N% of Damage on Health to Energy. …` → rage; `Health pickups give +N% Energy. Energy pickups give +N% Health.` → equilibrium; `Reduces the chance an enemy will hear gunfire by N%.` → noise; `Drains Energy to stop Lethal Damage with +N% Efficiency.` → quickThinking; `+N '(Truth|Purity|Justice|Entropy|Sequence|Blight)'` → syndicateCounter; `+N% bonus for each Mod from a unique School` / `+N <stat> for each <SCHOOL> School Mod` → perSchoolMod; `Enables Tennokai.` prefix → tennokai then R9 on the rest; `Create Nm seismic shockwaves … dealing N Damage …` → heavyImpact; `Converts N% of Energy used to up to N Bonus Damage …` → energyChannel; `Sentinel recovery time reduced by Ns. Revives with Ns of invulnerability.` → regen; `Enemies killed explode, dealing N Damage shortly after death.` → onDeathExplosion; `Enemies explode on death, dealing N <DTYPE> Damage (+N% Enemy Max Health) in a Nm radius.` → onDeathExplosion; ` <DT_IMPACT_COLOR>Impact Status Effects have N% chance to apply a <DTYPE> Status Effect (xN when Fire Rate is below N)` → procConversion. Add a template only after checking its digits→N form occurs verbatim; never widen one with wildcards.
- **R8 ABSOLUTE SET.** `/\b(to|at) N(%|s|m)?\b/` not preceded by `up` / `Damage` / `Health` / `Energy` / `ammo pickups`; `reduced to`; `set to`; `Increase … to N`; `^0 <stat>` → REFUSE `set-to, not a delta`.
- **R9 PROSE** → REFUSE with the full text: any `<Ability> Augment ?:` header; any line whose only NUMs are unsigned and whose sign lives in a verb (`Increases … by N%`, `reduced by`, `less`, `more`, `faster`, `decrease`); any line containing `twice`, `double`, `doubled`, `half`, `fourth`, `N to N` ranges; running totals (`Each hit increases X by N%`, `Capped at N%`); Focus Way, Companion precept behaviour, K-Drive, Parazon, Plexus battle/tactical, Peculiar, Posture sentences. A refused line is still recorded on the row so the optimiser can show "this mod has an effect the model does not score".

## Part D — output (modstats.ts)

```ts
export interface Effect {
  rank: number; element: number;
  stat: string;                          // canonical case-folded key
  op: 'add_pct' | 'add_flat' | 'multiply' | 'convert' | 'procConversion' | 'unparsed' | `template:${string}`;
  value: number | null;                  // exactly as displayed; percent on the 100 scale; null for unparsed
  unit: '%' | 'flat' | 'm' | 's' | '/s' | null;
  damageType?: string; faction?: string;
  target: 'self' | 'squad' | 'enemy' | 'companion';
  conditions: string[];                  // trigger, state, weaponClass, abilityOrdinal, restriction (A7)
  duration?: number; stackCap?: number; cooldown?: number; threshold?: number;
  scalingBasis?: string; altMultiplier?: { value: number; context: string };
  notes: string[];
  text: string;                          // the line it came from, always
}
export interface Refused { rank: number; element: number; rule: string; reason: string; text: string; numbersFound: number[] }
export interface ModStatsInput { uniqueName: string; name: string; description: string | null; levelStats: string[][] }  // levelStats[rank] = that rank's strings
export function parseModStats(input: ModStatsInput): { effects: Effect[]; refused: Refused[]; corrupt: string | null }
```

`corrupt` names the A6 violation when a line's digits→N shape differs
between ranks; the caller (moddb) then refuses the row.

## Part E — the refuse list (never guessed, always surfaced by name)

`|PLACEHOLDER|` strings; no-number effect lines; absolute set-to lines;
verb-signed prose; augment prose; word-numbers and `N to N` ranges;
running-total lines; description-only rows; riven templates and every
`upgradeEntries` array; Unfused Artifact / *RandomMod; SampleAntiqueUpgrade;
PvP rows; phantom Intermediate/Expert duplicates; Stance rows; any line whose
digits→N shape differs between ranks; any R3 head followed by unrecognised
qualifier text; dead-mechanic stat keys (Channeling Damage, Energy Rate,
Damage Block, Parry Angle, Gore Chance, Combo Count Chance on Conclave rows);
any DT tag not in the B2 list; any TRIGGER_HEAD not in the R1 list.

## Part F — self-checks the gates must pass (real data, named counts)

The gates run on the REAL `Mods.json`. `scripts/check-moddb.ts` and
`scripts/check-modstats.ts` read it from a local cache
(`node_modules/.cache/wfcd/Mods.json`), download it there on first run, and
when neither the cache nor the network is available print ONE loud
`SKIP  Mods.json unavailable (offline, no cache)` line and exit 0 — a gate
that fails for lack of network is noise; a gate that silently passes on a
fixture is worse. No fixture of invented rows anywhere: every test input is a
real row quoted by `uniqueName`.

1. Every rank of every kept row parses to the same shape signature.
2. The count of `add_pct` effects with stat `damage` on kept Primary rows
   names Serration exactly once — the `/Rifle/WeaponDamageAmountMod` row, +165.
3. No kept `add_pct` effect has `value > 500` except R7 templates. *(Corrected
   same day: the first draft said "no kept effect", and the real export has
   legitimate flat values above 500 — Pack Leader and Primed Pack Leader heal
   in the thousands. The bound is a percentage sanity bound, so it applies to
   percentages.)*
4. `Barrel Diffusion` resolves to +120 % Multishot, `Handspring` to +160 %,
   `Ammo Drum` to +90 % (the phantoms would have said 220 / 440 / 165).
5. Zero effects are emitted from rows whose `uniqueName` contains `PvPMods`.
6. `dropped` reports `{ pvp: 152, phantoms: 108, templates: 30 }`; A3
   yields 104 flawed rows; the export carries 145 rows whose path contains
   "Expert" after A1, of which 75 are phantoms and 70 are real — the gate
   pins both so neither can drift unnoticed.
7. The refused list is printed as a histogram by rule with the top-10 texts
   per rule, so the number of refusals is a measurement in the baseline, not a
   surprise in a build. The parser is allowed to refuse; it is not allowed to
   guess.
8. Sabotage: each gate carries at least three assertions that a named
   mistake (name-keyed lookup; `levelStats[fusionLimit]`; a real-newline
   splitter) would fail.

## The weapon side (for `itemdb.ts` — a frozen file, edited serially by the supervisor, not by a worker)

From the 612-row census: `damagePerShot` is a 20-element array on EVERY row,
indexed 0 impact, 1 puncture, 2 slash, 3 heat, 4 cold, 5 electricity, 6
toxin, 7 blast, 8 radiation, 9 gas, 10 magnetic, 11 viral, 12 corrosive, 13
void, 14 tau, 15 cinematic, 16 shieldDrain, 17 healthDrain, 18 energyDrain,
19 true (confirmed on single-type weapons; matches the wiki's Public Export
order). `multishot` (guns only, integer pellets 1..15), `trigger` (Auto,
Semi, Charge, Held, Burst, Active, Duplex, Auto Burst), `polarities[]`
(present on 409; absent means UNKNOWN, never zero slots), `exilusPolarity`
(330), `stancePolarity` (melee, 223), `attacks[]` (585; the per-mode
breakdown — `attacks[0]` disagrees with the top-level crit on 7 guns whose
first mode is not the primary fire), the melee block (`range`,
`comboDuration`, `followThrough`, `windUp`, `blockingAngle`, `slamAttack`,
`slideAttack`, `heavyAttackDamage`, …), `accuracy`, `noise`, `isPrime`,
`maxLevelCap` (50 rows, the rank-40 items). `criticalChance` and `procChance`
are FRACTIONS (0.2 = 20 %). 45 Zaw components carry zeros everywhere and
`productCategory: 'Pistols'` — they are parts, not weapons.
