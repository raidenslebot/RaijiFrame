# Quality baseline — measured, 2026-09-07

The owner's verdict was "2.3/10 overall: too messy, too ugly, not enough
information, but the information is too everywhere; way more nesting needed".
This file turns that into numbers so the next pass has something to move rather
than an adjective to argue with.

Everything here was **measured**, either from the running app at 1500×940 with
no account read, or by counting source. Nothing is estimated.

## Per panel, live DOM

| Panel | chars on screen | disclosures | max depth | depth ≥2 | refusal strings at once | % of text under 16px |
|---|---|---|---|---|---|---|
| NOW | 1,728 | 7 | 0 | 0 | 7 | 58 |
| STAR CHART | 561 | 1 | 0 | 0 | 4 | 94 |
| ARSENAL | 244 | 0 | 0 | 0 | 1 | 0 |
| STANDING | 1,129 | 23 | 1 | 0 | 0 | 71 |
| VAULT | 20,311 | 1 | 0 | 0 | 6 | 85 |
| PLATINUM (routes) | 2,749 | 19 | 1 | 0 | 8 | 97 |

Three things this says outright:

- **Density has no shared rule.** 244 characters against 20,311 is an 83× swing
  between two screens of the same application.
- **Nesting is one level everywhere.** `depth ≥ 2` is zero in every panel
  measured. The Star Chart shows 561 characters for 353 nodes, a full
  prerequisite graph and a route.
- **Absence is restated per field.** Eight separate refusal strings on one
  screen. The worst in source is `IntrinsicsPanel.tsx:331-337`, which renders
  the identical "not captured yet" paragraph inside all eighteen branch drawers.

## Second measurement — 2026-09-07, after the first rollout

Same method: default state, no account read, 1500x940. Nothing opened by hand.

| Panel | chars | disclosures | max depth | refusals at once | % text under 16px |
|---|---|---|---|---|---|
| NOW | 1,728 -> **1,504** | 7 -> 6 | 0 | 7 -> **5** | 58 -> 49 |
| STAR CHART | 561 -> 567 | 1 | 0 | 4 -> **3** | 94 |
| ARSENAL | 244 | 0 | 0 | 1 | 0 |
| STANDING | 1,129 | 23 | 1 | 0 | 71 |
| **VAULT** | **20,311 -> 3,200** | 1 -> **19** | 0 -> 1 | 6 | 85 -> 83 |
| PLATINUM | 2,749 -> **3,439** | 19 -> 11 | 0 | 8 -> **2** | 97 -> 87 |

**Density swing: 83x -> 14x.** The Vault's twenty-thousand-character dump is the
single biggest change; it is now a grouped structure rather than two flat
120-row tables.

Reachable depth, measured by opening every disclosure on each screen rather
than reading the default state: Vault reaches **depth 3 with 112 disclosures
two or more levels deep**, Platinum **depth 2 with 225**. Both were 0.

Untouched so far, and the honest remainder: **Arsenal** (244 characters, no
disclosures at all) and **Star Chart** (567 characters for 353 nodes).

## Third measurement — all six panels rebuilt

| Panel | chars at start | now | disclosures | refusals |
|---|---|---|---|---|
| NOW | 1,728 | 1,504 | 6 | 5 |
| STAR CHART | **561** | **2,731** | 1 -> **39** | 4 -> **1** |
| ARSENAL | **244** | **1,265** | 0 -> **25** | 1 -> 2 |
| STANDING | 1,129 | 1,129 | 23 | 0 |
| VAULT | **20,311** | **3,105** | 1 -> **19** | 6 -> **1** |
| PLATINUM | 2,749 | 3,942 | 19 -> 12 | 8 -> 2 |

**Density swing: 83x -> 3x.** Every panel now sits between 1,129 and 3,942
characters. Disclosures across the six screens: 51 -> 124.

The convention line that replaced per-field refusals — *"every dash is unread,
not zero"* — began in `FocusPanel` and is now shared by Arsenal and the Vault.
Stating the rule once is what let five token plates stop each printing
"needs your account" under a banner that had already said it.

## Fourth measurement — after the adversarial review and its fixes

Refusals counted at ELEMENT granularity (a leaf whose whole text is a refusal
phrase), which is what "a refusal on screen" actually means. An earlier count
matched substrings inside prose and reported 40 where the truth was 1.

**No account read:**

| Panel | refusal phrases | worst repeat | bare dashes | chars |
|---|---|---|---|---|
| NOW | 2 | 1 | 1 | 1,233 |
| STAR CHART | 0 | 0 | 3 | 2,731 |
| ARSENAL | 0 | 0 | 12 | 1,265 |
| STANDING | 0 | 0 | 0 | 1,129 |
| VAULT | 1 | 1 | 7 | 3,105 |
| PLATINUM | 0 | 0 | 3 | 3,936 |

**With an account read: one refusal element across all six panels.**

**No refusal phrase is repeated on any screen.** At the start of this work
`IntrinsicsPanel` rendered the identical "not captured yet" paragraph inside all
eighteen branch drawers, `CollectionPanel` carried thirteen refusal strings on
one screen, and the worst screen showed eight at once. The dashes that remain
are governed by one convention line per screen — *"every dash is unread, not
zero"* — which began in `FocusPanel` and is now shared by Arsenal and the Vault.

Density swing: **83x -> 3x**. Disclosures across the six screens: **51 -> 153**.

## Fifth measurement — 2026-09-07, and a correction to the method

**The instrument was measuring the closed app.** Every measurement above took
the landing state of each tab, and a disclosure's body renders only when it is
open — so `depth ≥ 2` read 0 on every panel while the source gate counted 19
disclosures at depth ≥ 2 and a maximum of 3. Both were true. "Nesting is one
level everywhere" was partly the instrument. The owner's own test — *"keeps
asking how? and clicking on it, how?"* — is about the OPENED state, so this
measurement adds a second pass that opens every `aria-expanded` control under
`<main>` breadth-first until nothing else opens, and reports what is REACHABLE.

Two things the second pass had to learn, recorded so the sixth does not:
Clamp `more/less` buttons and segmented options carry `aria-expanded="false"`
forever and churn a naive loop (1,018 clicks on NOW that were toggles, not
controls); and Platinum's route rows are an exclusive accordion (`setOpen(open
=== id ? null : id)`), so depth inside a route is measured by opening ONE row and
recursing inside its `<li>`. The refusal-phrase set is now written into the
script rather than remembered: *not captured yet · not read yet · unread · not
confirmed · nothing counted yet · not filtering · needs your account ·
unmeasured · not measured · no account read · not known · not timed yet ·
unconfirmed*, matched as the whole text of a leaf element.

**Closed state (landing), 1500×940, no account read:**

| Panel | chars | disclosures | max depth | refusals | dashes | % text under 16px |
|---|---|---|---|---|---|---|
| NOW | 1,313 | 8 | 1 | 1 | 1 | 53 |
| STAR CHART | 2,731 | 39 | 1 | 0 | 3 | 22 |
| ARSENAL | 1,265 | 25 | 1 | 0 | 12 | 72 |
| STANDING | 1,129 | 23 | 1 | 0 | 0 | 73 |
| VAULT | 3,105 | 19 | 1 | 1 | 7 | 87 |
| PLATINUM | 3,938 | 12 | 0 | 0 | 7 | 83 |

The "% under 16px" column is not continuous with the fourth measurement's
(Star Chart 94 → 22, Arsenal 0 → 72): this one weights by leaf text length and
that one's definition was not persisted. Treat this column as a new series.

**Opened state — reachable nesting, the number that answers the directive:**

| Panel | reachable max depth | at depth ≥ 2 | disclosures when open | chars when open |
|---|---|---|---|---|
| **NOW** | **1** | 0 | 27 | 11,895 |
| STAR CHART | 2 | 212 | 455 | 42,200 |
| ARSENAL | 2 | 118 | 250 | 78,787 |
| **STANDING** | **1** | 0 | 23 | 5,190 |
| VAULT | **3** | 112 (56 at each level) | 173 | 31,514 |
| PLATINUM | 2 (inside one route) | 1 on an unmeasured route | 17 + the route's | — |

The nesting work landed on the Vault (the relic drill), the Star Chart and the
Arsenal. It did not land on NOW — the tab every session opens on — or Standing.
On both, "how?" ends after one click. **That is the next target, chosen by this
table rather than by preference.** Refusals: NOW 2 → 1, Vault 1, the rest 0;
no phrase repeats on any screen.

**NOW, re-measured the same afternoon, after the two drills under "Do this
next":** reachable max depth **1 → 2**, disclosures when open 27 → 435, at
depth ≥ 2 **0 → 369** (`{0: 8, 1: 58, 2: 369}`). Nothing was invented to get
there: "369 objectives sit behind it" was a sum over a set the engine computed
and discarded, and "about 21 minutes" a sum over path members it timed and
discarded. The drills are those sums un-summed — each member with its minutes
and provenance and the sentence it claims; each dominated objective by planet,
carrying its own gate and its own cost from the same solve. The vocabulary
gained one word for it: *assumed from your log*, because the first render put
"MEASURED" directly above "you have not run Exterminate yet".

**Standing's depth 1 is the state, not the panel, and it is not a target.**
Read before acting on: `SyndicatesPanel.tsx:608` nests a depth-1 ladder
("how long the next rank takes") over a depth-2 threshold table with "you" and
"passed" marks and the rank-inference caveat — but only on the WITH-account
branch, which cannot render with the game closed and nothing captured. The
no-account branch (`:938`) renders each syndicate's full threshold table
INLINE at depth 1, because there is nothing account-specific to put between
the name and the ladder. Same information, one level shallower, for a reason.
Wrapping that inline table in a disclosure would raise this column by hiding
the table — nesting as padding, the thing this table must not reward. The
method measures the no-account state on purpose; this is the one row where
that understates the panel, and it is recorded here so the next measurement
does not re-open it.

## From source

| Measure | Value | Where |
|---|---|---|
| Type-scale use in the bottom 3 of 8 steps | 82% -> **81%** | `check-ui-tokens.ts` |
| `--text-mega` uses | **0** | scale step nothing uses |
| `--text-body` uses | 16 -> **22** | the *body* size, in a whole app |
| Disclosures at `depth ≥ 2` | 1 -> **9** | `check-ui-tokens.ts` |
| Tailwind `rounded-*` | 28 | against a spec of `--radius-card: 0` |
| Panels react-doctor calls giant | 23 (was 24) | `npx react-doctor` |
| Hand-tuned scoring constants with no derivation | ~120 | algorithm audit |
| Call sites for `allTimeTotals` (measured per-run loot) | **0** | `history-store.ts:350` |
| Pursuits permanently pinned at 0% by `progress == null` | **28 of 55** | `pursuits.ts:295` |

## What is ratcheted

`scripts/check-ui-tokens.ts` holds these so they cannot quietly rot back:

- bottom-three type share may fall, not rise (**81**, lowered once already)
- `rounded-*` may fall, not rise (28)
- `--clip-button` may fall, not rise (4)
- disclosures at depth ≥2 may rise, **not fall** (floor **9**)
- zero tolerance, already clean: `Ailerons`, hardcoded hex outside the shader,
  `border-radius` outside the allowed set

## Where the specification stands

`docs/research/` holds ~7,000 lines of measured UI specification. Audited
against the code: seven of twelve named primitives absent (Card, Button,
ListRow, Divider, Badge, Tooltip, Modal); row pitch 48px against a specified
26px; type 25–40% larger than spec at every step; `UX.md`'s four surfaces
replaced by fourteen panels behind two tab rails; most of the motion layer
unbuilt. See `spec-exists-and-is-ignored` in project memory.

## Done so far against this baseline

1. **Star Chart layout.** A `max-w` with no `min-w` in a flex row collapsed a
   panel to width 0 / height 524, which produced the empty band, the squeezed
   1460px diagram and a column of stray glyphs off the right edge — one missing
   floor causing three visible defects.
2. **Depth drives type size.** `--disc-depth` now sets the summary size, so a
   nested chain reads 19 → 16.8 → 14.5 → 12.7px instead of one flat size.
3. **`check-ui-tokens.ts`** exists (spec §B2, never written) as a ratchet.
4. **Relic pricing inverted.** 591 reward prices cover all 772 relics rather
   than pricing one relic per click; 50 requests resolve 36% of all expected
   value, 200 resolve 70%.
5. **`RelicTree`** — the first four-level drill in the app: tier → relic →
   refinement → reward → that reward's market, and it shows the marginal value
   of refining, which nothing in the app could previously express.

6. **The entrance cascade is computed.** It was 18 hardcoded delays ending at
   442ms against a specified 300ms cap, with no rule past the eighteenth - so
   rows 19+ started at 0 and arrived before the rows above them. Measured after:
   235 rows finish their cascade in 22.1ms, in order.
7. **Delta highlighting** (spec E8, never built). The app kept ONE snapshot and
   overwrote it, so "what changed since last login" had nothing to subtract
   from. It keeps one generation now, guarded so an identical push does not roll
   the history away.
8. **The rate engine stopped counting failures as fast runs.** `observe()`
   filtered on duration alone and never read `outcome`, so an abandoned
   four-minute Survival shortened the median, raised runs-per-hour and raised
   platinum-per-hour for an attempt that paid nothing. The bias ran one way and
   landed hardest on under-geared accounts. `reliability` now carries the
   measured finish rate with its sample size.
9. **`solo` is derived, not asked.** The panel measured median squad size from
   the log for one preference and asked the player for the other; both now take
   the log as their default until the control is touched.
10. **Four panels rebuilt by parallel workers** - Resources, Intrinsics, Focus,
   Worldstate. Intrinsics went from 16 refusal strings (9 byte-identical) to 7
   distinct; Focus from 13 (6 identical) to 7, and to 0 with an account read.

11. **An adversarial review of the whole rebuild** found five severity-1 bugs
   that passed typecheck, eslint, build and 496 checks. All fixed. The two worst
   were introduced by this work: Arsenal group aggregates were computed from the
   FILTERED view, so the Mastered tab rendered the green "all finished" on every
   group while items still owed mastery; and Focus took its daily figure from the
   ungated `focusState()` rather than the stale-aware one, printing yesterday's
   numbers with the game closed - which the module it bypassed calls "the one
   kind of wrong that looks exactly like right".
12. **Two defects in the tooling itself.** A stray NUL byte made
   `RelicTree.tsx` binary to ripgrep, git grep and GitHub search while every gate
   still passed. And `check-frozen.ts` could not see a keyframe whose start
   selector was grouped (`0%, 20% {`), so a start state of `opacity: 0` with a
   `both` fill passed all three of its checks - proven with a probe, not argued.
   Both fixed; the frozen gate now tests its own parser.
13. **The NaN class in the worldstate.** An unparseable timestamp rendered
   "NaNs" in `--text-lead`, the panel's boldest element, painted in the quietest
   ink. Fixed at the root with one helper rather than a guard per call site.

14. **The platinum ranking is no longer a sum.** `rankRoutes` was ~30 constants
   in no unit; a hard requirement was a large negative that positives could
   outvote, and two had been outvoted. It is now an estimate in platinum
   (`plat-expect.ts`): a measured rate times factors each stating a checkable
   claim, gates as orderings, an unknown factor as a ceiling ("up to"), four
   tiers, three dead sliders removed. Verified on the account's own log:
   Nightmare mods 172/hr measured → "up to 60" in hand, the reason one click
   down and the claim one click below that.
15. **Provenance has four values.** `dropLink` labelled a table constant
   "measured" in every branch, beside a link that really was the player's own
   median. `published` now exists, is rendered as "from the game", and a gate
   with a control refuses the relabel.
16. **The guidance engine costs a path in minutes**, from the player's log, not
   in a count that priced a quest and a four-minute Capture identically. A
   sabotage found a wrong rule (prefer firm over flagged) and it was replaced by
   a pessimistic stand-in; "About 21 minutes … as slowly as your slowest
   mission" renders on the real ten-run log.
17. **The stored-record crash class is closed at the boundary.** A field added
   to `MissionRecord` arrives absent on older runs; `hydrateRecord` repairs
   every read, and the gate deletes keys instead of building sparse fixtures.
18. **Geometry is named once.** The chamfer polygon was typed in 24 files (the
   app's own 10px cut in no token), plates in 13, the hairline in 10; all are
   tokens now, reached through `ui/geometry.ts`, proved pixel-identical by a
   computed-style hash, refused by a hard rule. The two ground colours' rule
   (warm content over cool structure, research §7.1) is finally written down.
19. **UI-SPEC Wave 1 exists and passed its own check.** `primitives.css` with
   the stroke-bearing frame and its `lab.html` artboard: stroke continuous round
   the diagonals, the 4px diagonal no thicker (19.6568 = 22 − 0.5858·4), the
   inner hairline following the chamfer. First adoption: the reset hero, cut
   direction taken from the research's measured rule.

20. **A second adversarial review of the day's work found two severity-1
   defects past 520 green checks.** Both were "caution counted twice". In
   minutes mode a quest has no score and the plan loop skipped it, so an
   account with Earth cleared and no quest done had six open quests and an
   EMPTY "Do this next" — because the player had a mission log; unrated rows
   now enter the plan after rated ones, by what they open, printing no
   minutes. And the platinum sort compared tier before value, so a firm 1.8
   p/hr outranked "up to 172" and was recommended — the defect fixed in the
   guidance engine hours earlier and left standing here; tiers now order by
   value, firm first only on a tie. Four severity-2s were also real: absent
   rendered as zero under Mastery ("nothing behind it" over unrecorded nodes),
   a panel-local "tied" that ignored the engine's own tie map, a stand-in
   claiming a bound the log cannot give, and a nullable type that was never
   null. Every fix got a gate written to fail on the old code first — all
   four did — and the first correction of the platinum sort had a sign error
   that two checks caught within a minute. Verified afterwards on the real
   log: no false "tied" labels, Mastery reads in mastery points, and the
   platinum list orders its ceilings by value.

21. **The second frame adoption, and the two that honestly cannot be next.**
   The Vault's Credits plate wears the frame by the vetted recipe, with its
   before (cut top-right/bottom-left, single rim) and after (cut top-left/
   bottom-right, `--notch` 10px, inner notch 9.4142px, hairline at 0.56)
   both on record. The Arsenal and Foundry heroes are the same shape and were
   the obvious next two — and both render only with an account, which the
   store's plausibility guard means inventing. An adoption nobody can
   photograph is the unwatched change this baseline exists to refuse; they
   wait for a real capture.

22. **The app had a class for labels, a class for numbers, and none for a
   sentence** — which is the mechanical cause behind "79% of type in the bottom
   three steps". `.eyebrow` and `.numeric` are named roles used 345 and 262
   times; every sentence was dressed by hand, and by hand meant at whatever
   size its row happened to be. **Fifty-seven paragraphs were set at the label
   sizes**, including "they were never quoted, which is a different fact from
   being worth nothing" — this app's whole doctrine — at 12px in the faintest
   ink, and `chain.blockedBy.note`, why a rate cannot be computed, likewise.
   Two roles now exist (`.wf-prose`, body size, for a paragraph the reader came
   for; `.wf-note`, small and muted, for a sentence attached to a control),
   each owning size, colour, leading and measure. 42 + 35 paragraphs converted.
   Measured on the running app: `route.how` went **13px in `--text-faint` to
   17px in `--text` with a 641px measure**. A hard gate refuses a paragraph at
   label size, and fails when one is put back.

   **The share moved 79 → 72, the first movement on that metric in this
   session** — and only after the counter was taught to read the roles, since
   a paragraph wearing `.wf-prose` has no size class at all and forty-two of
   them had gone invisible to it. Raising prose from nano to *small* alone
   would not have moved the number: small is itself a bottom-three step.

23. **The runtime sweep the source gate cannot do.** Opening every disclosure
   on NOW and measuring each leaf: **35 of 92 sentences under 15px**, none of
   them a `<p>`, so the hard rule was blind to all thirty-five. Three kinds,
   two of which were information the reader could not reach at all:

   - **`quest.summary` existed only as a fragment.** Rendered in exactly one
     place — the closed row's second line, `truncate` at `--text-micro` — so
     "Every weapon, frame and companion you have never levelled…" stopped at
     the column edge and *no interaction reached the rest*. The row keeps its
     one-line teaser, which is what makes a hundred rows scannable; opening it
     now yields the whole sentence at 17px. Verified live: teaser clipped at
     13px, body text 17px, same string.
   - **A band's caveat wore `.eyebrow`** — a kicker's costume — so "a reason a
     whole domain shares is stated once, on the domain" rendered as A REASON A
     WHOLE DOMAIN SHARES IS STATED ONCE, ON THE DOMAIN, uppercase at 0.18em in
     the faintest ink. That is precisely the "hierarchy faked with uppercase
     and letterspacing" this file's own gate header names as the symptom. The
     closed row now reads "Cannot be ranked · 89"; the sentence is inside at
     15px with `text-transform: none`.
   - **One clamped teaser was NOT a defect** and is recorded as such: the goal
     picker's `answer` is clipped to 34ch, but its body already carries the
     full sentence as a `wf-note`. A teaser whose full text is one click down
     is a teaser; a teaser whose full text is nowhere is a loss.

   The remaining sentences under 15px are in `<div>`/`<span>`, several
   inheriting size from a parent — a source-only rule cannot see them, and the
   probe that can is recorded in `prose-has-a-role`.

24. **The Vault's 53-of-100 was mostly not a defect, and the method is what
   said so.** Sweeping the Vault found 53 sentences under 15px — a number that
   reads as a disaster. Forty-nine were resource descriptions clipped at 34ch
   in a catalogue row, and `ResourceDetail` renders the same string in full at
   17px one click down. **Verified by opening one and comparing**: teaser
   clipped, body complete. Converting them would have made a three-hundred-row
   catalogue unscannable to fix nothing. The check that separates a teaser from
   a loss — *is the full text reachable?* — is the whole judgement, and it has
   now saved two changes (this and the goal picker) and demanded one
   (`quest.summary`).

25. **`ListTail`, the app's first new primitive since the spec was written.**
   The four Vault sentences that were NOT teasers turned out to be one message
   hand-written in seven files — "204 more, alphabetically after these — filter
   by name to reach one" — every copy set as `<p className="eyebrow">`, so the
   sentence telling a reader the list is not the whole list rendered UPPERCASE
   at 0.18em in the faintest ink. It is a component now, and the shape is the
   point: *count · what they are · why these and not those · how to reach
   them*. `ordered` is required and cannot be omitted — a truncated list that
   does not say which rows it kept has hidden them by an unstated rule.
   Measured after: 15px, `text-transform: none`, normal tracking.

   Twenty `<p className="eyebrow">` remain. They are not all defects — five
   are genuine kickers ("Reading the drop tables", "The way there") that are
   correct as they are, and the distinction is content, not markup.

26. **A tested, correct measurement that reached nobody.** `Pursuit.measurable`
   is read by `rankPursuits` as a veto — `p.measurable ? progressFor(p) : null`
   — so a pursuit with a working progress case and `measurable: false` has its
   answer computed and thrown away. That is what had happened to `nodes.steel`:
   `makeProgressFor` counts Missions entries carrying a Steel Path `Tier`, and
   `check-pursuits.ts` **already asserted it returns 0.25 for one clear of four
   nodes — an assertion that passed for as long as the defect existed.** The
   computation was covered; the flag that gates it was not. A player who had
   cleared half the Steel Path was told it was not measured, and the completion
   wheel counted one fewer measurable pursuit than it had.

   Twelve had drifted the other way — `measurable: true` with nothing computing
   them. No user-visible effect (the wheel counts `progress != null`, not the
   flag), but the field is a claim about the account data and twelve were false.

   Both directions are now one gate that **reads the switch in
   `pursuit-progress.ts` rather than a list typed beside it**, because a list
   typed beside it is the same drift one file over. Plus the assertion that was
   missing: the value that *arrives at the board*, not the one the function
   returns. Sabotaged by restoring the old flag; caught. 160 → 164 assertions.

27. **Seventeen measurements taken, three consumed.** A four-agent survey of
   the tree found **42 fields parsed, computed or held and then discarded**, all
   failing the same way: the value is reduced on the way in and the reduction is
   the only thing kept. `eelog.ts` recognises 17 event types and the mission
   recorder branches on 3. `Wall time: 2.2s (time waiting to start: 0.77s)` is
   parsed into both numbers and the case that receives it reads one. `squadCount`
   — the parser's own second witness for squad size — is read by the switch that
   receives it and thrown away in the same statement. `captureSquadNames` is a
   privacy opt-in that is fully wired on the parser side and dropped at the
   record boundary, so flipping it changes nothing observable anywhere. And
   `core/snapshot.ts` keeps exactly TWO account generations, ever, so every
   earlier value of every field the account has held is gone.

   None of that threw, none of it looked wrong in a diff, and none of it was
   visible to the 525 checks that were already green.

   `src/data/ledger.ts` + store `ledger` in `raijiframe-history` v2 is the fix —
   an append-only per-account change log fed from the three seams that already
   saw everything. **The design rules are the same three-state doctrine the rest
   of the app runs on:** a first sighting is not a change (or every app start
   re-baselines several thousand mastery rows); an absent key is never read as
   zero, in either direction; and outside `ledgerSpan()`'s window the app was not
   watching, which is silence rather than stillness.

   Two defects the gates found in the new code, and one the browser did:
   - `deltaInventory` needed the MIRROR of the guard `diffInventory` already had.
     Reporting losses at all made a truncated `after` newly dangerous — it would
     read as the player spending their entire mod collection. The old guard was
     one-sided because only `after`'s keys were ever walked.
   - The wiring gate first passed on a `clearHistory` whose ledger line had been
     **deleted**: the word "ledger" survived in the doc comment above it. A grep
     matches the prose explaining why the code should be there. It now strips
     comments and names `objectStore(LEDGER)`, and export/import are checked
     behaviourally instead.
   - Platinum was recorded twice — once as a `counter` with both balances, once
     as a `spend` item event, because `diffInventory` synthesises currency
     pseudo-items so a loot list can mention them. **Found by watching a real
     push, not by reading the code.** Anything summing the series would have
     double-counted it.

   72 checks, and every one sabotage-tested: 12 defects reintroduced, 12 caught.
   The v1→v2 migration was verified against the populated database rather than
   argued about — every existing mission record survived it.

   **Nothing reads the ledger yet**, which is item 26's defect in its purest
   form and is the next piece rather than a finished one.

28. **A threshold that would have been a constant.** Reading the ledger needs
   one derived unit — the play SESSION — and splitting an event stream into
   sessions needs a gap threshold. The obvious implementation is a constant:
   thirty minutes, sixty, whatever reads well. That is the same defect as a
   slider for a number the mission log could answer, one layer down: a value the
   data determines, sitting in the source as a value somebody picked.

   `sessionBreak` measures it instead. Inter-event gaps are strongly bimodal —
   seconds to minutes inside a sitting, hours between them — so the split is the
   largest **ratio** cliff in the sorted gaps, compared as ratios because a
   90-second gap and a 9-hour one are 360x apart rather than 8.5 hours apart, and
   on a difference scale the biggest step is always out in the tail. Below eight
   gaps, or with no cliff of at least 4x, it reports `measured: false` with the
   sample size and a stated fallback, because an unmeasurable threshold silently
   replaced by a plausible one is how a derived number becomes folklore.

   **Two gates here were written loose enough to pass on the defect, and the
   sabotage pass is the only reason that was found:**
   - "the break is measured, not assumed" asserted the answer lay between the
     fixture's two populations. A hardcoded 30 minutes lies between them too. The
     property a constant CANNOT have is tracking the data, so the gate now runs
     two fixtures with different cliffs and requires the thresholds to differ.
   - "simultaneous events are one moment" asserted only `measured === true`. With
     the zero-gaps counted, the first ratio is Infinity, so the break comes back
     **measured, at zero minutes** — every single event its own session — and the
     assertion passed on that. It now asserts the threshold and the session count.

   The other rule the read layer carries: **a rate divides by observed play, not
   by the wall clock.** Two hours of events across a fortnight is two hours
   played; dividing by the fortnight reports a rate a hundred times too low and
   calls it measured. And the silences BETWEEN sessions are returned as silences
   rather than closed up, because a reader who cannot see them reads a flat line
   as "nothing happened" when it means "nobody was looking".

   83 checks; 18 defects reintroduced, 18 caught.

29. **The ledger got a reader, and rendering it found two defects reading it
   could not.** A store nothing reads is measurement 26's defect in its purest
   form, so `panels/chronicle/ChroniclePanel.tsx` is the panel — four rungs of
   "how do you know that?": a session, a series inside it, that series across
   every session with its rate, and one observation.

   **The silence is drawn at its length.** The first version captioned it — a
   hairline and the words "2d 1h unwatched" — and the render refuted the file's
   own doc comment: a two-hour break and a four-day one were the same six
   millimetres, so the panel asserted in text exactly what its layout denied. A
   gap you have to READ is not drawn. The row's height is now logarithmic in the
   gap, with a tick per midnight crossed so it can be counted rather than only
   read, and the log scale's distortion is stated rather than hidden.

   **Two algorithm defects, both found by looking at the picture:**
   - The session headline ranked series by absolute movement, so every session
     was headlined `AP POWER` — focus moves in tens of thousands and platinum in
     tens. **Ranking incomparable quantities against each other is not a
     ranking, it is a units error with an ordering on it.** Replaced by movement
     against each series' own median session, so the headline is what was
     unusual FOR ITSELF.
   - That replacement then rendered "platinum moved 1.0× its own typical
     session" — an argmax over a set clustered at 1.0 returns the most TYPICAL
     thing and presents it as the notable one. **Exactly the shape of the
     session-break cliff, and the same fix**: a floor, and three explicit
     reasons (`unusual` / `no-history` / `nothing-unusual`) so the row says which
     question it answered instead of leaving the reader to guess.

   A third, smaller: `load seconds 2.4` printed as `no figure`, then as `2`. A
   LEVEL is not a FLOW — it was read at a value rather than moved by one — and
   rounding a load time to the second destroys the measurement it was kept for.

   90 checks; 22 defects reintroduced, 22 caught. Nesting at depth ≥2 rose 20 →
   22.

30. **A ratchet that had been counting English.** `check-ui-tokens` failed on an
   unrelated commit: `rounded-*` classes 19, baseline 18. Nothing had added a
   Tailwind class — a new file's comment used the word "rounded" in a sentence.
   The pattern's `-[a-z0-9]+` group is optional and it ran on the raw file, so it
   matched the bare word anywhere, **including in this gate's own prose about
   rounded corners and in the chamfer doctrine written directly above it.**

   The real count is **3**, all `rounded-full` on a status dot and a legend
   swatch. Sixteen of the eighteen were sentences. So the baseline fell 18 → 3
   because the MEASUREMENT was wrong, not because corners were fixed — a ratchet
   that counts English can be paid down by deleting documentation and pushed up
   by explaining yourself, which is to say it holds nobody to anything.

   Same defect shape as the ledger's own wiring gate, found the same day, one
   file apart: **a gate that greps for a word matches the prose explaining why
   the word should be there.**

31. **Nesting fixed "everywhere" and created "not enough".** The Chronicle's
   first build put every fact behind a disclosure. That answered one half of the
   complaint — the information stopped being scattered — and broke the other:
   a closed session read as a date and a change count, which is a table of
   contents, not a summary. **A summary row that summarises nothing has moved
   the problem rather than solved it.**

   Three changes, all about what is legible WITHOUT clicking:
   - a **movement strip** on every closed session — the three largest movements,
     compactly (`credits +207k · AP POWER +60k · Cetus Syndicate +10k`). Compact
     notation only here, where the job is comparison at a glance; anywhere a
     reader might act on a figure keeps the full number, because "164k" is not
     something you can check against your own screen.
   - a whole second section, **"Everything this account moves"**, grouped by
     family, each series carrying its total and its rate per observed hour, and
     each opening into the same history rungs from a different entry point.
     Ordered by OBSERVATIONS rather than magnitude, because magnitude across
     families is a leaderboard of unit sizes — the same units error the headline
     already had.
   - the **answer chip now appears only when it says something the strip does
     not.** A fallback headline is by definition the largest movement, which the
     strip already leads with; printing it again made the two cases
     indistinguishable. Its presence is now itself the signal.

   And the timeline got its bottom edge — `the record begins here`. Without it
   the oldest session sat flush against the end of the list and read as the
   start of the account's history rather than the start of the RECORD, which is
   the one boundary on this page a reader would most easily misread and was the
   only one not drawn.

32. **Thirteen watched fields became eighty-four; seventeen log events became
   twenty-four.** Two read-only surveys measured what the app could be keeping
   and was not. The account one found `RawAccount` carries roughly seventy more
   fields with a moving number, including a whole family the first pass could
   not see: the **fourteen daily standing pools**, inherited through
   `Partial<Record<DailyAffiliationKey, number>>` rather than named in the
   interface body. Those drain as you play and reset at 00:00 UTC, which makes
   them the closest thing the account has to a record of one day's effort.

   Now watched, among others: every `{ItemType, ItemCount}` array (resources,
   blueprints, consumables, keys, decorations, railjack stock) — continuously,
   where `diffInventory` only ever saw them inside a mission bracket, so a trade,
   a foundry claim and a market purchase were invisible; **the server's own
   duplicate-protection pity weight per reward tag**, which is the number that
   decides why the same sortie reward keeps coming and which no companion app
   has ever been able to explain; Helminth XP and secretions; lich thralls,
   hints and territory; Nightwave and challenge progress; intrinsics; incarnon
   and fragment progress; and fifteen lifetime counters where the array's LENGTH
   is the measurement, which needed a third watch kind rather than fifteen
   bespoke closures.

   **Three traps the survey named, each of which would have fabricated data:**
   - `Boosters.ExpiryDate` is **UNIX seconds**, not a MongoDate and not
     milliseconds. Converted on the way in; a store mixing seconds and
     milliseconds is a thousand-fold error that looks entirely plausible.
   - Seeds and fingerprints (`RewardSeed`, `Nemesis.fp`, `DuviriInfo.Seed`)
     exceed `MAX_SAFE_INTEGER` and arrive **already corrupted by `JSON.parse`**.
     A watch on one emits a change whenever the same value is re-read
     differently. `NEVER_WATCH` lists them and a gate reads the accessor source.
   - `Equipment.XP` **resets to zero on every Forma**, so a watch would emit a
     large negative on the exact occasion the player invested most. Deliberately
     unwatched; `forma` (monotone) and `mastery-xp` (never resets) cover it.

   **Four defects the gates and the browser found, in that order:**
   - `endo` handed back the string `'900'` from an account of hostile types. The
     gate then got rewritten to assert what ARRIVES at an event rather than what
     a closure returns — because `NaN` in an append-only store is permanent.
   - the keyed branch was an implicit `else`, so the new `count` kind fell into
     it and **threw inside the inventory handler**, which would have stopped
     every other field recording. Now exhaustive with a `never`, so the next kind
     fails the build instead.
   - a live push emitted `resource:…/Forma` **twice** — the currency
     double-count from measurement 29, reintroduced for resources and blueprints
     by widening the watch table. Found the same way: by watching a push.
   - and then `mod` as well, because `mod-stack` covers exactly what the delta
     path read. Fixed by adding `mod-owned` for the individually-tracked half so
     both are covered once, rather than by dropping the fact.

   On the log side, seven event types out of the 4,738-line capture: the daily
   tribute (**the only one that fixes something rather than adding something** —
   a tribute claimed inside a run's attribution window is currently credited to
   the run as loot, and a snapshot diff cannot tell where items came from), the
   engine's own mastery percentage and both halves of its XP, the gear carried
   in per slot (which separates a consumable SPENT from one SOLD), the network
   phase at 24 a session, and `extractionTrigger is nil` — which makes a zoneless
   mission report `extraction: null` instead of a fabricated `{1 of 1}` that
   reads as a clean extraction.

   Measured live through the real GEP path: **30 ledger events from one account
   push**, against 12 before.

33. **A token that did not exist, used four times, invisible to everything but
   the render.** `cgc techniques` called the Chronicle *assembled — 1 of 42*:
   nothing in it did anything a default could not. The dimension it most
   obviously lacked was **generative** — the ledger holds thousands of
   observations and the panel was showing endpoints.

   So every series got its shape drawn. And drawing it found the bug.

   `var(--color-blood-400)` is used for "this went down". **The token does not
   exist.** As a `color` the declaration is invalid and the element inherits, so
   every negative in the panel rendered in ordinary ink and looked entirely
   deliberate while carrying none of the meaning it was written to carry. As an
   SVG `stroke` the property resolves to nothing and **the line is simply not
   drawn** — which is how it was finally caught, by looking at a picture with a
   missing line in it. Neither the type checker, the linter, the build, nor any
   of the other forty gates could see it: a misspelt token is indistinguishable
   from a correct one at every stage except the render. The real token is
   `--color-signal-bad`.

   `check-ui-tokens` now has a HARD rule that every `var(--x)` names something a
   stylesheet defines. Two exemptions, both principled rather than a whitelist:
   `var(--x, fallback)` is not relying on the token existing, and a property a
   component sets on itself — including through the computed-key spelling
   `['--len' as string]:` the transit chart uses — is defined where it is used.
   Sabotaged by restoring the old token; caught.

   **The sparkline's own design decision.** Plotted against real time it was
   honest and unreadable: three sittings across six days put every observation
   inside 2% of the width. The usual fix is to plot against sample INDEX, which
   makes a handsome line and quietly asserts the samples are evenly spaced — it
   draws a two-day absence as one smooth step, which is the exact claim this
   store exists to refuse. So the axis is BROKEN: each stretch of watching gets
   width in proportion to its own duration, every gap gets the same fixed notch
   whatever its length, and the notch is drawn as a hairline the line does not
   cross. Inside a stretch the spacing is true; between them it deliberately is
   not, and the mark says so.

   Also fixed: a family holding one series wrapped that series in a header
   repeating its own name — two rungs to reach one row. **One group is not a
   grouping**, so a lone series now renders directly, from the same component,
   at depth 0 rather than depth 1.

   118 checks; 24 defects reintroduced, 24 caught.

34. **The rung that turns a number into an act.** Four rungs of drill-down
   still ended at a number: `credits +5,188`, at a time, and nothing more. The
   question a player actually has there — *what was I doing?* — had no answer,
   and the account can never carry one. It is a bag of numbers and the game
   never narrates.

   But **changes that happen together were caused together**. `moments()`
   clusters the ledger into acts and `readMoment` names each one from what moved
   in it: a run, the daily tribute, the foundry, the Helminth, the market, a
   syndicate. `credits +5,188` alone is a number; `credits +5,188 alongside
   +2,200 standing, +11,000 focus, one forma spent and a mission that ended` is a
   Cetus bounty, and the reader knows it the instant they see the list.

   **Three decisions in that inference, each of which could have been made the
   easy way and been wrong:**
   - **The window is not zero.** One GEP push writes every counter in the same
     millisecond, so zero looks right. It is not: a run's log lines arrive from
     the file tail seconds either side of the inventory push carrying its
     rewards, and a zero window files the two halves of one run as unrelated
     acts. Four seconds holds them together without merging two deliberate acts.
   - **ORDERED, NOT SCORED.** Every rule is a sufficient condition and the first
     that holds wins, so a moment carrying a mission-end line is a mission
     whatever else moved. A weighted guess would let three coincidental currency
     changes outvote it — and would be wrong exactly in the moments with the most
     going on, which are the ones a reader most wants explained. The same shape
     as the expectation model's gates: **a requirement is an ordering, never an
     additive weight.**
   - **The last rung says it cannot tell.** A wrong story about what somebody did
     is worse than no story: they know what they did, and being told otherwise
     makes every other claim on the page suspect. `unknown` reports the count and
     stops, rather than picking the least unlikely label.

   Ordering that carries real knowledge: the tribute outranks everything,
   because contaminating a run's loot attribution is the exact defect it was
   added to fix; and the Helminth is read before the foundry, because feeding it
   also consumes resources and the resource loss alone reads as a build.

   Six rungs now, and the observation rows finally say something: every one used
   to read `account`, a label distinguishing nothing from anything. They now name
   the act. The nesting counter was also widened — it printed depths 0–3 only, so
   a rung it could not print was a rung nobody would notice had been added.

   130 checks; 28 defects reintroduced, 28 caught.

35. **Run against a real account at last, and it found two things.** There has
   been a real capture in the tree the whole time — `public/__review-acct.json`,
   MR 16, 4,120,500 credits, 8 syndicates, 347 `XPInfo` rows, 185 cleared nodes.
   Every claim in measurements 32–34 had been checked against fixtures I wrote.

   Through the real background wiring, two pushes of that capture with a
   realistic change between them produce **seven correct events** — including
   `standing:ArbitersSyndicate −2000 → −1100`, because standing genuinely goes
   negative in this game and the diff handles it without comment. The moment
   inference reads that push as `unknown` and says so, rather than calling it a
   run: there is no mission-end line in a bare inventory diff, and inventing one
   is exactly what the last rung exists to refuse.

   **12 of 84 watches find data in that capture, producing 689 distinct series.**
   The honest reading of the other 72 is the app's own doctrine turned on my own
   verification: that file carries 18 of the account's top-level keys, so the
   empty watches are UNSEEN, not dead. Concluding "72 watches find nothing" from
   a partial capture would be the absent-is-not-zero error committed against the
   instrument rather than the data.

   That measurement became a feature. **"Not seen for this account"** names every
   watch that has never recorded anything, and says what that does and does not
   mean: an account with no lich, and an account whose lich has not moved while
   RaijiFrame was open, look identical from here — and so does one that changed
   while the app was closed. A row of zeroes would claim the first. The panel is
   entitled to claim only *not seen*, and that is per-account catering which
   consists of admitting what the record cannot tell you.

   **And the degenerate state, which every account is in on its first push.** The
   header divided by a span of zero and rendered "**now watched, out of now**" —
   `humanDuration(0)` is the word "now", and two of them in one line are each
   correct and together mean nothing. It is the one moment a reader decides
   whether to trust the panel, and it had the worst sentence on the page. It now
   says there is no stretch to measure against yet; the ratio bar is hidden, and
   the between-sessions figure is omitted rather than shown as "now".

   135 checks; 29 defects reintroduced, 29 caught.

36. **The motion decision worth making was where NOT to move.** The Chronicle
   had added no motion at all — it wore the shell's existing entrance and
   nothing else.

   The cheapest polish available was to stagger the "what else moved at that
   moment" list. **That is the one lie this panel must not tell.** Everything in
   that list happened at the same instant — it is the entire claim the rung
   makes — and rows arriving one after another would say they happened in
   sequence. It arrives all at once, and the comment says why.

   The stagger went on the session list instead, which is chronological, using
   the app's own `rf-staged` + `staggerFor` — computed rather than hardcoded, so
   a long history does not take proportionally longer to appear.

   **Then it was watched rather than described**, by scrubbing the real
   animations by `currentTime` on the live route and reading the transform that
   actually renders:
   - **three animations ran.** Zero is the defect that matters most in motion
     and is invisible in a diff — the class applied, the trigger silent, and it
     ships described as "subtle".
   - **`cubic-bezier(0.22, 1, 0.36, 1)`** — 38% of the distance covered in the
     first 9.5% of the time. A straight line is the absence of a decision; this
     is not one.
   - the stagger is legible in the frames: at 40 ms the three rows sit at
     **4.92 / 7.57 / 8 px**.
   - it settles — 0.14 px at 320 ms, home at 420 — and no single frame carries
     the change.
   - `prefers-reduced-motion` covers `.rf-staged > *` and the sparkline, checked
     against the CSSOM rather than against the comment above the rule.
   - `translate3d` → `none`, transform only, so nothing strands on the in-game
     overlay where the document timeline never advances.

   **And the probe that said there were no reduced-motion rules at all was
   wrong.** It read `r.media?.mediaText` while walking `@layer` blocks and
   handed the wrong value down, reporting zero. The rule was there the whole
   time. Measuring the instrument before believing it is the same discipline as
   measuring the code — a broken probe reports a defect that does not exist just
   as readily as it misses one that does.

37. **The modding screen was in the log the whole time.** An in-game
   auto-modding overlay needs to know when the player opens the Upgrades screen
   and for what. The research capture never visited the arsenal, the Overwolf
   GEP carries no screen state, and the one companion app that solves this
   (AlecaFrame) reads pixels — which the user rejected as fragile before it was
   even proposed. Nobody had opened the real log on this machine.

   `%LOCALAPPDATA%\Warframe\EE.log` — 148,280 lines, written the same day as the
   screenshot — narrates the modding screen in the game's own Lua, and it is
   **deterministic, zero-cost, permission-free and already tailed.**
   `_T.upgradeItemSlot (_Mod): 3` is the press on Upgrade with the slot; 20 ms
   later `GoToScreen(screenName=UpgradeCards)`; every card placed or lifted logs
   `mod: True Steel - installed: true (/Lotus/Upgrades/Mods/Melee/WeaponCritChanceMod)`
   with the catalogue path; save and close each have a line; and ranking a mod
   logs **its endo and credit cost**. Six new `LogEvent` types, a new ledger kind
   `arsenal`, and a new moment rung, all mined from real lines rather than
   invented — full shapes in `docs/research/eelog-upgrade-screen.md`.

   **Three facts that shape the design, all negative:**
   - **the weapon is never named.** `BrokenWar` appears 0 times in 148k lines.
     The slot index is the identity, resolved through the account
     (`CurrentLoadOutIds` → `LoadOutPresets.NORMAL[…]` → the slot's
     `EquipmentSelection`) — and that selection's `mod` field is the active
     Config A/B/C index, knowable from data although the log never says it.
   - **a loadout save emits no inventory write.** Every
     `CommitInventoryChangesToDB` in the capture is a mission. Between GEP
     pushes the `mod:` stream is the only current picture of the build, and the
     overlay has to treat it as authoritative while the screen is open.
   - **the hover is not the press.** `(RefreshStatList)` fires for every slot
     merely looked at; only `(_Mod)` is the trigger. Read as one, the overlay
     would open on a glance.

   **And the harness had a blind spot.** Two sabotages reported MISSED — the
   hover read as the trigger, and an arsenal regex losing its script anchor —
   while the assertion that catches the first sat unexecuted in
   `check-eelog.ts`: the sabotage runner only ever ran `check-ledger.ts`. A
   harness that runs one gate measures one gate. It now runs both, and the
   anchoring concern became a SOURCE gate, because no fixture can prove a regex
   will never drift onto `BuildLoadOut for <player>` — a line that fires in the
   same second and carries the name — but the source can prove the regex refuses
   to start anywhere but the script name.

   153 checks; 33 defects reintroduced, 33 caught across both gate files.

38. **Two of the five real opens had no trigger, and my own doc stated a
   falsehood.** An eight-agent understanding pass over the auto-modding overlay
   ran while I was mining the live log, and its critic — given the readers'
   reports and told to refute them — found three things against my own work.

   **`modOwned` does not fire on open.** I had written, in the research doc and
   in a ledger comment, that the `Multiple cards of type` lines were "emitted in
   a burst on every open". Measured across the whole log: all thirty share ONE
   timestamp, 203 seconds after an open, in one visit of three. I inferred from
   proximity in a 70-line window; the critic counted. Both places corrected, and
   the correction left in the doc rather than silently overwritten.

   **The arsenal path is not the only path.** `_T.upgradeItemSlot (_Mod)` fires
   when Upgrade is pressed in the arsenal — and two of five visits came through
   the Mods segment, which emits no slot line and no `GoToScreen`. The line that
   fired on every visit is `Created /Lotus/Interface/DiegeticUpgradeCards.swf`,
   and `DBG: HudVis N` marks the moment it is actually drawn. Both added; on the
   non-arsenal path the slot is unknown, so **"item unknown" is a first-class
   state of the overlay, not an error.** Replayed against the growing live log:
   12 open lines, **7 distinct visits**, 36 visibility lines, 5 slot presses,
   58 placements, 6 fusion costs, zero name leaks.

   **A heredoc corrupted two files the same way.** A backslash-r escape in a
   Python string inside a shell heredoc became a literal carriage return in TypeScript source
   — once inside a regex literal, once inside a fixture string. `tsc` printed
   nothing for the first (the file was unreadable, not wrong); Node refused the
   second with "Expected ','". Both repaired byte-safely from a script file,
   with an assertion that no CR byte survives. The memory note on heredocs
   exists because of exactly this, and I used one anyway.

   Also from the critic, taken as-is: the fusion line carries a real embedded
   CR between its two amounts, so the regex needs an optional carriage return
   between them and the fixture needs the byte — the fixture passed and the four real lines did not until it did;
   `KEY_MODS` points Serration and Hornet Strike at Beginner variants
   (fusionLimit 3) and `check-key-mods` passes because it checks
   self-consistency, never identity (delegated as a bounded fix); and the mod
   catalogue "blocker" dissolves on one fetch — but every per-rank effect in
   that catalogue is prose, and the real work is a gated parser over 1,622 mods.

   One claim of the critic's I did not take: that the loadout join is
   "disproven" because `public/__review-acct.json` lacks the fields. That file
   is an anonymised 18-key fixture. The honest status is *unverified until a
   live push*, which is the same rule that stopped 72 empty watches being read
   as dead.

   155 checks; 33 sabotages, 33 caught across both gate files.

39. **The game states the installed build outright, and the same byte bit the
   parser twice.** At `close pod` after a session that changed a build, the log
   writes a four-line dump: eleven slot polarities in index order, the item's
   base capacity with its stance bonus, and **every installed mod with its
   polarity-adjusted drain.** Against the user's screenshot of the same item:
   the listed drains equal the on-screen drain tags exactly; `Initial Capacity:
   30` is the item's rank; `CAPACITY 8/64` is 30 × 2 (catalyst) + 4 (stance),
   with 56 drain installed — so **the game shows REMAINING/total**, the
   catalyst doubles the rank but not the stance bonus, and the research doc's
   "15 + 1 per 2 mastery ranks" is refuted by the game's own line. Between the
   two dumps a Forma turned index 2 `AP_UNIVERSAL → AP_DEFENSE` and Galvanized
   Elementalist's drain went **11 → 6**: `ceil(11/2)`, the matched-polarity
   rule, measured rather than remembered.

   Four stateless events (`buildSlots`, `buildCapacity`, `buildMods`,
   `buildDrain`), correlated by arrival. And `buildMods` parsed its fixture and
   **neither real line**: the real line ends in a carriage return, `.` does not
   match one in JS, and the regex ended in `$` with nothing left to anchor to.
   The fusion line had failed the same way hours earlier for an *embedded* CR.
   Every fixture for an unstamped line now carries the byte the file has.

   Also landed: the Serration/Hornet Strike wrong-variant fix, delegated as a
   bounded task — and the agent improved the rule it was given. "Highest
   fusionLimit for the name" would have moved Intensify and Stretch onto
   Mods-1.0 *Expert* leftovers; it chose "the untiered row", proved the new
   identity gate fails on the old table, and touched nothing else.

   163 checks; 33 sabotages, 33 caught.

**The honest remainder, re-measured:** `--text-mega` is still a scale step
nothing uses; the bottom three type steps still carry 79% of all type; six of
the specification's twelve primitives are still absent (Wave 1 unblocks them);
23 panels still wear the old cut; `IntrinsicsPanel` carries an uncommented
gold-rim variant and `Shell.tsx` an unowned 4–11px chip micro-scale; the ten
replayed runs are gone (a `clearHistory()` in a verification probe, no backup;
they were dev-seeded from a log replay, not live play) and re-seeding needs the
game running. And
the fifth measurement's own verdict: on NOW and STANDING, "how?" still ends
after one click.

40. **The modding screen has a consumer, a window and a place** (2026-09-07,
   later). Measurement 39 left eleven arsenal events parsed and nothing
   reading them. Now: `data/automod-session.ts` folds them into one Session
   (open / visible / editing / saved, the slot when the arsenal path logged
   it and `null` when the Mods segment did not, every placement since the
   open, the fusion costs quoted, the saved build's four-line dump); the
   background controller is its only consumer and publishes it as
   `automodFeed` beside `codexStore`; a second in-game window `automod`
   (manifest: in-game only, transparent, not resizable, no taskbar entry, no
   keyboard grab, `restrict_to_game_bounds`) is restored when `HudVis`
   fires, hidden on close, and CLOSED five minutes later because a hidden
   Overwolf window's idle cost is undocumented; `core/ow.ts` gained
   `placeWindow` (logical px; Overwolf's own DPI arithmetic), `closeWindow`,
   `getWindowState`, `onWindowStateChanged`, `gameArea` and a
   `resolutionChanged` path the first watcher had discarded.

   **Where it sits was measured, not designed.** The user's own 1680 × 1050
   capture, scanned per column for deviation from the median luminance: the
   cards read 13–33 per 40-px bin, the starfield right of x = 1360 reads
   2.0–7.6. The empty column is x 1372–1680, y 335–598 — right of Gladiator
   Rush / Melee Prowess, below the arcane slot, above the tray's rule — 300 ×
   263 logical px at that size, held as fractions in `data/automod-place.ts`.
   The gate pins the box at the measured size and asserts it intersects none
   of six measured game rectangles (the overlap test is itself tested).

   **The arithmetic was checked against the wiki** (one agent, 96 fetches,
   wiki.warframe.com only; `docs/research/modding-arithmetic.md`). Of the
   memo's rules: capacity "2 × rank" is REFUTED as a general rule — it is
   `max(rank, 15 + floor(MR/2)) × 2`, the mastery term a floor and never an
   addend, and 64 was the special case where rank ≥ floor; matched drain
   `ceil(d/2)` EXACT; mismatched `d + roundHalfUp(d/4)` EXACT; the mismatched
   stance/aura factor is a three-way CONFLICT on the wiki itself (25 % half-up
   / 20 % / 80 % floor) whose published examples cannot tell the rules apart —
   they diverge at drain 1, 2 and 6, so an unranked stance in a wrong-polarity
   slot is the in-game measurement that settles it; `AP_UNIVERSAL` excludes
   Umbra (REFUTED in part); the 11-slot index order is NOT on the wiki at all;
   Galvanized/Condition Overload is two rules (additive on hitscan,
   multiplicative on projectile weapons), not one; and the element resolver
   has five sub-rules the memo lacked. Five rules are named that an optimiser
   may not use silently.

   Also caught on the way: a `\a` inside a non-raw Python string put a BELL
   byte into the harness's path constant (the heredoc rule's second form:
   escape-bearing text goes through raw strings in a script file, never a
   plain literal); a scratch `copy.py` shadowed the stdlib and broke PIL
   until renamed; and `deslop` was right twice — `momentsFor` and two
   placement helpers had no consumer and are gone or moved into the gate.

   18 automod checks; 39 sabotages (six new, all on the session machine), 39
   caught; tsc 0; eslint 0; `npm run check` exit 0; react-doctor 59 (down
   from 61; the four remaining unused-exports predate this work).
   `automod.tsx` is a plain-text scaffold of the six states and is the next
   thing measured — against a live 300 × 263 window, not a description.

41. **The strip exists, and it was looked at** (2026-09-07, later still).
   `src/app/automod.tsx` is no longer a plain-text scaffold. The design
   premise, stated so it can be argued with: the Upgrades screen already has a
   plate on its LEFT — the stats column, square-cornered, a thin gold rule on
   top, small-caps section heads, label/value rows with the value right-aligned
   in tabular figures — and this window is that plate's counterpart on the
   RIGHT, same material, same grammar, answering the stats column instead of
   covering it. It says only what the log says: the slot's category (or "item
   unknown" on the Mods-segment path), the placements since the open with
   their real names, the ranking cost quoted, and the saved build's capacity
   — written the game's way, REMAINING/total, as its own `CAPACITY 8/64` is —
   drain, stance bonus and an 11-cell slot map with the polarised cells filled
   and the count beside it.

   **Measured against the real column, not described.** Driven through
   Playwright with sessions folded from real log lines (the parser gate's own),
   at 300 × 263 (1680 × 1050) and 460 × 352 (1440p). The first version was
   367 px tall in a 263 px window and looked fine in a screenshot's top half —
   `plate.scrollHeight <= window.innerHeight` is the test now, and it holds in
   every phase at both sizes. What made it fit was structural, not a smaller
   font: the trail is bounded (last four, the rest counted as "N earlier" — a
   real visit placed 58 cards), the fusion is one line, and THE PHASE DECIDES
   WHICH SECTION IS OPEN — editing opens the trail and folds the last save to
   "34 cap · 18 drain"; saved opens the build and folds the trail to "4 in ·
   1 out". At 1440p the column is tall enough for both, and a `min-height`
   media query on the window's own viewport unfolds them (9 rows visible at
   460 × 352, 5 at 300 × 263, measured).

   **Motion, watched.** One law: sudden, then still — the plate and each new
   row arrive 6 px from the grid's side over `--rf-approach` and end at
   `transform: none`. The frozen-timeline gate caught the first draft ending
   at `translateX(0)` (a real transform, which strands the element when motion
   is off) and it was fixed to `none`. `cgc motion` reported the entrance as
   "dead": on a Vite page the 220 ms move finishes before the tool's first
   frame. Proven instead by sampling computed transforms 30 ms after a state
   change — rows read `matrix(1,0,0,1,-2.63,0)` mid-flight. Recorded in
   memory so the next reader does not chase it.

   Also caught: a state initializer that assigned the local feed to `window`
   ran twice under StrictMode, so the console's feed was not the one the
   component rendered from — resolved at module scope; two helper components
   in the entry file (react-doctor's "crowded component file") became one
   plain row function; stray Playwright screenshots in the repo root were
   removed and `.playwright-mcp/` ignored.

   frozen ok · ui-tokens ok · tsc 0 (the transient `moddb.ts → modstats.ts`
   error is the running fan-out's, whose second module has not landed) ·
   eslint 0 · react-doctor 59 + 1 (`moddb.ts` unused-file, the same fan-out).
   Not yet: the optimiser's "next move" rows; the item's NAME (the loadout
   join); a live Overwolf run of the window in the game — the placement is
   measured, the restore-on-HudVis is wired, neither has been watched in the
   running game.

42. **Arithmetic, resolver, and the item's name** (2026-09-07, later). Three
   modules landed while the catalogue fan-out ran.

   `src/data/modded.ts` is the modding arithmetic as pure functions over plain
   numbers, every rule labelled with the wiki verification's verdict in one
   `RULES` table (`exact | approx | assumed`) that a gate reads back: no
   exported rule may be unlabelled, and the two ASSUMED rules — the mismatched
   aura/stance factor and Umbra-against-Madurai — are named as such where the
   optimiser will have to show them. Its gate holds the formulas to the wiki's
   own worked examples: Maim's 87.5, Hek's 525, the 1.54 s reload, the
   58.5 → 59 magazine, the 297.8202 bleed tick, the drain brackets 2→3 … 14→18,
   the Prova example (Cold, Toxin, Heat on innate Electricity → Viral then
   Radiation), the measured 11 → 6 and Broken War's 60 + 4. The one failure
   the first run produced was the CHECK's: it expected +90 % on 100 base to
   read 90, and by the wiki's own 1/32 quantisation it reads 90.625 — the
   formula was right and the expectation was corrected, with the reason kept
   in the check. Nine sabotages, each a plausible wrong formula (floor instead
   of ceil on the matched halving, the mastery floor as an addend, the Omni
   exception lost, quantisation skipped, HCET order dropped, faction starting
   at 1.00, magazine rounding down, a label removed) — all caught.

   `src/data/build.ts` is the ladder from "slot 3 opened" to the instance,
   its active config, and the installed mods with ranks:
   `CurrentLoadOutIds[0] → LoadOutPresets.NORMAL → s/l/p/m → the equipment
   array by oid → Configs[mod].Upgrades → Upgrades[] by oid → fingerprint
   lvl`. Every rung can be missing on a real payload and a missing rung is
   UNKNOWN by name, never the first item of the right category; a preset
   without `mod` reads config A and says it assumed; an installed oid that
   matches nothing is an unknown mod, not a dropped one; the current rank of
   a Forma'd item is reported unknown because XP cannot say it (the Forma
   trap) while the lifetime rank is given. The gate runs the REAL anonymised
   capture (which stops at the first rung, and must) and an assembled happy
   path built from that capture's own Ack & Brunt — a shape test, labelled as
   one. Five sabotages, all caught (48 → 53 across the harness).

   The background controller now resolves the build on every phase change
   and names the item through the item catalogue, loaded once and lazily the
   first time the screen is seen; the strip's eyebrow reads "ACK & BRUNT"
   over "Config B · 2 mods · 5 Forma · catalyst" instead of "MELEE". When the
   ladder stops, the strip says where in the player's words ("The account
   carries no active loadout."), not the ladder's.

   **The spec was wrong and the implementer said so.** The catalogue
   implementer measured the A2 phantom rule on the real export: 108 rows (75
   Expert + 33 Intermediate), not the 145 the spec quoted — 145 was the
   critic's count of Expert-PATH survivors, the very filter the rule says is
   wrong, and it would have dropped the 66 Primed mods. The spec is corrected
   with the correction left visible, the gate pins both numbers. The same
   report measured the persisted catalogue at 3.1–3.5 MB against the 5 MB
   localStorage cliff whose overflow `gentle` swallows silently; decision
   taken and written into the spec: `drops[]` is not persisted (1.1 MB, and
   the acquisition layer already carries it), effects carry their text only
   when unparsed.

   Also: a patch script that patched a patch script turned an escaped
   newline into a real one — the escape trap's third form this session. The
   fix was to stop meta-patching and write the script whole through the Write
   tool. Recorded in memory.

   gates: modded 31/31 · build 10/10 · automod 18/18 · tsc 0 outside the
   fan-out's two files · eslint 0 · react-doctor 59 (the two `js-set-map`
   nits it raised on `combineElements` were real and are fixed).

43. **The optimiser answers, and the strip says the answer** (2026-09-07,
   last). `src/data/optimise.ts`: one objective, stated with the result —
   Q1, sustained DPS to unarmoured health, no status, no headshots, no
   faction, no conditional effects — a beam search over adding one eligible
   mod at a time (width 200), variants of one family excluded, a greedy
   polarity assignment, a rank-down pass when a strong set does not fit, and
   three runs of it: Now (owned mods at owned ranks), Ideal (the whole
   catalogue at max), Next (what each missing or under-ranked Ideal mod would
   add to Now, ordered by measured gain). Everything Q1 does not score is
   COUNTED on the result, and every assumed rule (eligibility classes the
   catalogue does not state, the greedy assignment, melee without combo or
   stance multipliers, a Charge trigger scored linearly) travels with it.

   **Measured on the real catalogue and a real rifle.** The gate parses the
   real `Mods.json` and `Primary.json` (cached under `node_modules/.cache/`),
   and on a rank-30 catalyst Braton with unpolarised slots the Ideal build is
   Primed Cryo Rounds 10 · Serration 10 · Heavy Caliber ranked DOWN to 7 ·
   Vigilante Armaments 5 · Vile Acceleration 4 — 60 / 60 drain, 3,755 dps, 66
   of the 105 eligible mods scored by Q1. *(Later: 49 of 85. Flawed mods were
   excluded from the pool on 2026-09-08 - the overlay had been telling the
   player to farm Flawed Jagged Edge for a thousand runs - and the build and
   the dps are unchanged.)* It picks the real Serration and
   never the Flawed row or a phantom; on an account owning nothing the first
   acquisition it names is Serration; the beam matches exhaustive enumeration
   on a six-mod pool at a capacity that forces a choice; the same input gives
   the same answer twice. The gate's own first draft demanded six mods in the
   Ideal build; sixty unpolarised points hold five ranked-up mods, and the
   expectation was wrong, not the search — kept in the check.

   **Then it was made fast.** 39 s for the gate's fifteen searches, because
   the rank-down pass ran on every over-capacity expansion and re-evaluated
   the set once per mod per point shed. Memoising each mod's scored effects
   took it to 28 s; bounding the rank-down to the forty strongest over-capacity
   sets per depth took it to 1.7 s — about 100 ms per search, with the
   identical answer. That is fast enough to run in the controller on a screen
   open; no Worker, and the reason is in the code.

   **Wired end to end.** The background loads both catalogues once, lazily,
   the first time the screen is seen; on every phase change it resolves the
   build, computes the plan, and publishes `{ session, build, plan,
   planAssumed }`; the strip's head reads `NOW · DPS 1,462 / 3,755` and lists
   the next three gains — "Serration 5 → 10 +611", "Primed Cryo Rounds +588",
   "Vile Acceleration +402" — with "N effects not scored · N assumed" under
   them. Rendered in Playwright at the column's size: it fits, and the
   "Nothing changed yet" line no longer sits beside a plan.

   **The harness caught the gap it was built to catch.** Of three optimiser
   sabotages, "two variants of one mod may share a build" was MISSED: the
   Ideal search never wants Flawed Serration beside Serration, so the run
   could not tell a family rule from no rule. The gate now asserts the family
   directly and runs a two-row pool with room for both; 56 sabotages, 56
   caught.

   Fan-out status at this measurement: the catalogue implementer's report
   corrected the spec twice (108 phantoms, not 145; F3 is a percentage bound,
   not a flat one — Pack Leader heals in the thousands); the verifier
   returned fix-required on `moddb.ts` (drops still persisted, an HTTP error
   read as offline) and the fix round is running; the parser's verifier is
   still out. Their gates are wired into `npm run check` only when they land.

   Addendum, same measurement: the strip gained the game's own meter idiom
   under NOW · DPS — a 2 px hairline with a gold fill scaled to now/ideal
   (measured in Playwright: `matrix(0.389…)` for 1,462 / 3,755, 109 px of
   280) — and its styles moved to `styles/automod.css` when the `<style>`
   block pushed the component past react-doctor's size line. The Overwolf
   bundle builds with the window: `automod.html` pulls 6.5 KB of its own code,
   the session machine (1.9 KB), the window API (3.2 KB), React (8.2 KB) and
   the shared primitives chunk (182 KB) — 64 KB gzipped in total against the
   400 KB in-game budget. `dist/manifest.json` carries the `automod` window.
   What remains is the one thing this session cannot do from here: load the
   unpacked extension (README: dock wrench → About → Development Options) and
   open the Upgrades screen in the running game.
