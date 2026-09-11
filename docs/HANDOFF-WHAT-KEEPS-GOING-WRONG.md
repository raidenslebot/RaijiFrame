# RaijiFrame — what keeps going wrong, and the rules that prevent it

A handoff document for another agent (ChatGPT or otherwise) taking over this project.

It is written as a confession first and an instruction list second, because the instructions
only make sense once you know which specific failure each one exists to stop. Every incident
below actually happened in this repository. Nothing here is hypothetical.

---

## 0. What the project is

`C:\Claude\Warframe` — **RaijiFrame**, an Overwolf overlay for Warframe. React 19 + TypeScript +
Vite + Zustand. Four windows: `background` (the controller, no UI), `desktop` (the full app),
`ingame` (a companion panel), `automod` (the modding overlay that sits on the game's Upgrades
screen).

Its data comes from three places and no others:

- **`EE.log`** — the game's own log, tailed live through `overwolf.io.listenOnFile`. It narrates
  the modding screen deterministically: slot opened, every mod placed, fusion cost, save.
- **GEP** (`overwolf.games.events`) — the account inventory, as a JSON blob.
- **Public catalogues** — WFCD `warframe-items`, DE's `PublicExport`, warframe.market,
  `drops.warframestat.us`, `api.warframestat.us`.

The app must work with the game **closed**.

### The owner's standing brief, verbatim

> *"currently im not happy at all. the overlay is horrible at detecting the game and ui state,
> its slow, laggy, unoptimized and unprofessional. the entire system and every single part of it
> needs a complete and massive overhaul. the visual presentation of everything needs to be
> absolutely breathtakingly beautiful, not some garbage that just sit on youre screen. the
> "overlay" should be indistinguishable from the game. and every single piece of information
> needs to be extensively calculated and catered to youre account beyond what any human could
> see, calculate or know. every single thing in the entire game taken into account, present and
> future. the modding assistant needs to always optimize for absolute max dps and universal
> capability aimed at level 9999 mobs. take absolutely everything into account. this is not
> designed to be simple. you must develop and design youre own solutions, innovate, math and
> algorithms are youre friend."*

> *"every single thing should be derived from game data. every single thing literally should be
> collected accurately allowing pure perfection."*

### Hard constraints — non-negotiable, never re-litigate

1. **Fake or simulated data is forbidden.** No fixtures standing in for real values, no
   placeholder numbers, no "example" rows. If a number cannot be derived, the app says so.
2. **Emoji are forbidden anywhere** — code, comments, UI, commit messages, documents.
3. **Memory/account reads must be gentle and non-repetitive.** Polling is forbidden. See
   `src/core/gentle.ts`.
4. **Privacy: no raw `EE.log` line may ever be persisted.** Only allowlisted parsed fields.
   The lines `BuildLoadOut for <player>` and `SendLoadOut: <player> loadout received` carry the
   player name and **must never be matched**.
5. **Screen capture and OCR are rejected.** The solution must be deterministic — the log and the
   account, nothing else.
6. **The app must work with the game closed.**

---

## 1. The failures, by class

These are ranked by how much damage they have actually caused.

### A. Claiming something is verified when it is not

This is the worst one and it has happened repeatedly.

- **The pipe swallows the exit code.** `npm run check 2>&1 | tail -40` returns *`tail`'s* exit
  status, not the suite's. I reported "the suite is green, exit code 0" **twice in one session**
  on the strength of that. Running it properly (`npm run check > out.txt 2>&1; echo $?`) showed
  **8 real failures**, several of them mine.
- **A gate that cannot fail.** `js-lcg-is-not-random`: a 400-trial statistical gate used a
  textbook LCG whose multiplier overflows 2^53, so it returned a constant. The gate passed
  through **three** deliberate sabotages before anyone checked.
- **A gate that measures the wrong end of the wire.** `a-measurement-nothing-consumes`: the
  computation was asserted and was correct; the value was vetoed by a flag before it reached the
  consumer. Every unit check passed throughout the defect.
- **Half a path.** `half-a-path-is-not-coverage`: a gate on the consumer passed while the
  producer still filtered the event away.
- **One-sided bounds.** `pin-a-formula-by-its-boundaries`: bleed:ignite is exactly 7 if correct
  and exactly 0.7 if the defect is present. The gate asserted `> 1`. It passed while the defect
  was live.
- **The instrument goes stale too.** `the-instrument-goes-stale-too`: the design artboard kept
  feeding the old Q1 objective after the app moved to Q2, so weeks of design judgement were made
  about a screen the app could no longer produce.
- **Two agents agreeing is not a measurement.** A workflow's authors and its adversarial
  verifiers both signed off on sabotage proofs that had never been run. Running them myself
  found real gaps.
- **`npm run check` is 57 scripts joined by `&&`.** A failure in number three leaves numbers
  four through fifty-seven **unrun and unreported**, and the summary line you read — "27 checks,
  2 failures" — belongs to one script, not to the suite. `check-control-chars.ts` is **last**, so
  the scanner that exists specifically to catch invisible bytes is the gate most often skipped.
  It was skipped for an entire debugging session while a backspace byte sat inside a gate file
  disabling one of that file's own assertions. **Read the assertion count, not the last line: a
  healthy full run is 815 `ok` lines.**

### B. Not looking at the thing I built

The owner has sent screenshots twice with *"still a complete disaster visually"* and *"what is
this disaster? even if it worked, is that it!?!?"*. Both times the code was correct and the
picture was bad, and I had not looked at the picture.

- `watch-the-frames-not-the-end`: a 55-pixel spill over the game's own cards passed **every**
  gate, because all of them measure the settled state. Scrubbing `getAnimations()` frame by
  frame found it immediately.
- `never-print-a-broken-number`: the overlay printed **"SUSTAINED DPS NaN"** over the game.
- This session: the modding overlay's actual appearance was never rendered and inspected until
  the owner complained about it. When I finally rendered it, the diagnosis took ninety seconds.

### C. Building internal machinery instead of the user-visible thing

A session-end hook flagged this explicitly:

> *"No evidence in the transcript shows visual design work, UI/overlay improvements, game
> detection, latency optimization, or any feature visible to a user. The work is internal test
> harness infrastructure — important, but not the user-visible 'massively overhauled' and
> 'breathtakingly beautiful' system the condition specifies."*

An entire session went into rebuilding a 53-gate check file. The brief leads with *visual
presentation* and *speed*. There are **~7,000 lines of measured UI specification** in
`docs/research/` (`ui-geometry.md`, `ui-color-type.md`, `ui-motion.md`, `ui-components.md`,
`overlay-ui.md`, `UI-SPEC.md`) and the shipped app is a different design
(`spec-exists-and-is-ignored`).

### D. Producing a report where an answer was asked for

- `a-ranked-list-is-not-an-answer`: the app must **decide** and give one instruction at a time.
  Sorting the options better is still a failure.
- The Platinum panel, measured this session in a real browser at 1280×720: **2,984 px of content
  in a 672 px viewport (4.44 screens)**, rising to 6,234 px with its route families open, and
  **9.78 screens** on the "spend your standing" view. Even with every route family muted — zero
  recommendations — it was still 2,204 px.
- It gave **four different answers to one question in one frame**, two of them naming different
  routes, and the largest type on the page carried **no platinum figure at all** while a 45-pixel
  row below it said "up to 109 p/hr".
- A family header claimed **"best 312 p/hr"** over twelve rows, **not one of which showed 312** —
  because the header read the raw measured rate and the rows read the gated rate.
- `plat-plan.ts`'s `planToday()` computes a complete, ordered, checkable plan — actions, trades
  used, minutes used, platinum total, and the literal trade-chat message to send. **It is dead
  code in the UI.** Its only callers are a check script.
- With no account read, the deck printed **nine lines** of refusal — five "what is missing" and
  four "what would fix it" — every one honest, collectively a wall saying one thing.

### E. Destroying things with careless shell and Python

- **`open(path, "w")` truncates before the read.** Chaining a read and a write in one Python
  expression destroyed a **52-gate, ~2,000-line file**. There were no git commits to undo with,
  no file-history entry and no shadow copy. Thirteen gates were recovered from transcripts; forty
  had to be re-derived.
- **`clearHistory()` in a console probe destroyed ten real stored missions.**
- **Heredocs corrupt escapes, invisibly.** Twice now:
  - `control-chars-from-heredocs`: a stray NUL made a source file invisible to `ripgrep` while
    every gate still passed.
  - **This session**: `\b` inside a bash heredoc became a literal **backspace byte (0x08)**, so a
    gate's regex was `/‹BS›return‹BS›/` and matched nothing. `grep` rendered it as `/return/`, so
    the file looked correct. The gate silently could not fail. It took six debugging round trips
    to find, and only a byte-level dump revealed it.
  - Also this session: `\\/` in a non-raw Python string inside a heredoc raised a
    `SyntaxWarning` and left `s.replace()` matching **nothing** — while the script printed
    "success".
- **A blind range delete.** A CSS edit cut "from `.am-price {` to `.am-queue-name {`" and
  silently took an unrelated rule with it. Nothing failed until a gate, twenty minutes later,
  asserted a list that rule belonged to.

### F. There is no version control

`git status` shows **every file untracked and zero commits**. Every mistake in class E was
unrecoverable for that reason. This is the single highest-leverage fix available and it has never
been done.

### G. Re-deriving instead of checking what already exists

- `check-before-claiming-a-limit`: this project has **twice** shipped a false *"the app cannot
  know that"*. Grep and read the types before writing the excuse.
- `companions-fit-q3-unchanged`: Sentinels, Pets, Archwings already carry a Warframe's
  health/shield/armour fields and Arch-Guns carry a Braton's. The questions needed no change,
  only asking.
- `planToday()` again: a finished engine, ignored, while the panel printed four worse answers.
- `navigation.ts` ships a deep-link mechanism the Platinum panel never imports. `SubRail` exists
  in the shell and is dead on that panel because it is the sole member of its group, so the panel
  hand-rolled its own tab strip inside a 2,212-line component.

### H. Assumptions going stale without anyone noticing

- `assumptions-go-stale`: the exilus "scores nothing" justification was true under Q1 and false
  the moment Q2 existed. It stayed in the code as prose.
- `stat-names-are-the-catalogues`: scoring `"shield"` instead of `"shield capacity"` made **every
  shield mod worth zero**, silently.
- `a-fix-can-reopen-an-old-bug`: a Ctrl+K fix broke `showStrip`'s re-check, which used the mute
  flag as its proxy for "superseded".
- `one-key-two-jobs`: Ctrl+K muted the modding overlay while opening the companion panel. It was
  fixed. **It came back this session** by a different route — the key hid a live strip with
  nothing scheduled to bring it back, so the owner pressed it and the overlay never returned.

### I. Measuring the wrong quantity

- `match-the-range-not-the-mean`: a game asset's **average** colour is a colour nothing on it
  actually is. Sampling the mean is what makes a redraw look flat. The same error in reverse —
  sampling **peaks** — put the overlay at the palette's extreme everywhere at once.
- `measure-off-the-measured-resolution`: "screen edge minus column start" equalled the correct
  300 px **only at 1680 wide**. At 32:9 the same expression gave 1,822 px.
- `oklch-defeats-contrast-auditors`: every token is `oklch`; auditors that parse hex read the ink
  as black and fail the whole app at 1.04:1.
- **This session**: the game's measured section gap is 39 px and its row pitch 19.5 px, so a
  section is two pitches. I applied 2 × pitch as a CSS **margin** — but the measurement is
  **baseline to baseline**, which already contains one line box. The double count was the entire
  42-px overflow of the overlay column.

### J. Treating performance as somebody else's problem

Measured this session:

- **The overlay was never shown on the path where the plan becomes available.** There were four
  callers of `showStrip()` and not one was on that path. `gep.on('answered')` and the settle
  deadline each published the new state to a window nobody had put on screen, and every
  subsequent log line folded to the same session object and returned early. The overlay appeared
  **when the player next placed a mod** — an unbounded wait. That is the whole of *"it took
  forever to appear"*, and every other cost on that path is bounded and sums to under two
  seconds.
- The log watcher read the **entire 33 MB log every second** — `readFileSync(LOG).subarray(...)`
  — roughly a third of a gigabyte per second to find four lines.
- Putting the overlay up cost **five awaited Overwolf round trips**; two of them were the same
  question asked twice, and two more were independent calls awaited in series.
- The beam-search ladder's 63 ms slices queued **in front of** the window show, because one
  publish started both.
- Three recorded performance figures in comments were stale by 2.5–4× (`"293-621 ms"` for a plan
  that measures 553–1,014 ms; *"under a second and a half"* for a ladder that measures 3,730 ms).

---

## 2. The instruction list

### Before anything else

1. **`git init` and commit.** This repository has zero commits and every file untracked. Commit
   before your first edit and after every working change. Nothing else on this list matters as
   much.
2. **Read `MEMORY.md` at the project memory path and every file it indexes.** ~60 entries, each
   one a recorded failure with its cause. They are cheap to read and expensive to rediscover.
3. **Read `docs/research/UI-SPEC.md`, `ui-geometry.md`, `ui-color-type.md`, `ui-motion.md` and
   `overlay-ui.md` before touching anything visual.** The measurements you need already exist.
4. **Run `npm run check` once, to a file, and record the number.** `npm run check > out.txt 2>&1;
   echo $?`. The current baseline is **815 assertions, 0 failures**.

### How to run commands

5. **Never pipe a command whose exit code you intend to report.** A pipeline returns the last
   element's status. Redirect to a file, echo `$?`, **and count the assertions**:

   ```bash
   npm run check > out.txt 2>&1; echo "exit=$?"; grep -c "^  ok" out.txt; grep -A1 FAIL out.txt
   ```

   815 `ok` lines is a full run. Anything far below it means the `&&` chain aborted early and
   most of the suite never executed, whatever the last line says. `grep -c FAIL` alone is worse
   than nothing — grep exits 1 when it finds nothing, so clean looks like failure.
5b. **After editing any file under `scripts/`, run `node scripts/check-control-chars.ts`
   directly.** It is last in the chain and will not be reached if anything ahead of it fails.
6. **Never write source files through a bash heredoc.** Escapes are mangled silently: `\b`
   becomes a backspace byte, `\/` becomes an invalid escape that leaves `str.replace()` matching
   nothing, and a NUL makes a file invisible to `ripgrep` while every gate still passes. Write a
   `.py` file with the Write tool and run it, or use the Edit tool.
7. **Every patch script asserts before it writes.** `assert s.count(old) == 1` — not `>= 1`, not
   a silent `replace`. A replace that matched nothing must be a crash, never a success message.
8. **Never read and write the same file in one expression.** `open(p,"w").write(open(p).read()...)`
   truncates before the read runs. Read into a variable first, on a separate statement.
9. **Never delete a source range by "from marker A to marker B" without printing what you
   removed** and asserting that it contains only what you meant.
10. **After any byte-level edit, dump the bytes.** `sorted({c for c in open(p,'rb').read() if c
    < 9 or 13 < c < 32})` must be empty. `grep` will not show you a backspace.
11. **Never run a destructive console probe against live data.** Export first, or measure the
    delta instead of emptying.

### How to verify

12. **A gate that has not been sabotaged is decoration.** For every behaviour you add: delete it,
    run the gate, watch it go red, restore. Keep the sabotage script. If the gate stays green,
    the gate is wrong, not the sabotage.
13. **Sabotage at least three different ways.** `a-gate-needs-the-case-that-hurts`: three checks
    in one session passed while their defect was live, because the fixture never exercised the
    term.
14. **Assert the value that ARRIVES at the consumer**, not the value the producer computed.
15. **Pin a formula by a two-sided boundary.** If correct gives 7 and the classic defect gives
    0.7, assert *equals 7*, never *greater than 1*.
16. **Gate both ends of a path** — the producer and the consumer — or the argument is worthless.
17. **A source-text gate cannot prove reachability.** If you assert that a call exists, also
    assert that nothing returns before it.
18. **Never trust a subagent's claim that it verified something.** Re-run the proof yourself. Two
    agents agreeing is one opinion twice.
19. **When a refactor moves code, check what reads it.** Splitting a render function out of
    another made two gates start reading a body with no awaits in it; both passed on an empty
    claim and one reported the opposite of the truth.

### How to build anything visual

20. **Render it and look at the picture.** Every time. `preview_start` the Vite config
    (`.claude/launch.json`, name `codex-lab`, port 5273) and drive it with the Playwright MCP —
    the Browser pane times out on the overlay artboard.
    - The desktop app: `http://localhost:5273/desktop.html`.
    - The modding overlay composited on the player's real captured Upgrades screen:
      `http://localhost:5273/composite.html?demo=owned` (also `unowned`, `frame`, `perfect`), plus
      `&zoom=2.6` for inspection size and `&guides` for the measured column.
21. **Judge the overlay only in composite.** It exists to be indistinguishable from the game, and
    an isolated render cannot answer that. Judging it alone is how it shipped as a grey box.
22. **Derive every visual value from the game's own capture, not from taste.** The capture is
    `__lab-bg.webp` (1680×1050). The measured palette is `src/ui/game-palette.ts` — three ink
    levels, a brass band, an energy cyan, a violet ground, and a **bright budget**: the game
    spends only 1.55 % of its area above luminance 192, so the overlay gets at most the same.
23. **Match the distribution, not a single statistic.** The mean is flat; the peak is garish.
    Both were shipped.
24. **Copy the game's grammar, not just its colours.** Its stat column is: uppercase tracked
    SECTION heads, sentence-case row labels, values hard right on one shared axis, tabular
    figures, a gold hairline under each head, and a 19.5 px row pitch with 39 px between
    sections. The overlay had that exactly inverted — shouting `ENDO` and `CR` in the case the
    game reserves for headings.
25. **A measured pitch is baseline-to-baseline, not a margin.** Subtract one line box before you
    use it as CSS spacing.
26. **The game sets numbers in its body face with tabular figures, never in a monospace.** A
    terminal font beside the game's own chrome is the single loudest tell that something foreign
    is on screen.
27. **One loud thing per panel, and it is the instruction.** Not the progress statistic, not the
    biggest number. Decide what a two-second glance should learn and make everything else a level
    quieter.
28. **Scrub animations frame by frame.** Every gate in this repo measures the settled state; a
    55 px spill over the game's art lived through all of them.
29. **Never cover the game's own art.** Mark a slot with an edge and a bottom-lip plate. A
    hand-drawn card over a real card reads as garbage on sight.
30. **Never print a broken number.** An em dash is honest; a substituted zero is a claim.

### How to design a panel

31. **The panel answers one question and leads with the answer.** If two things on screen answer
    the same question, delete one — do not reconcile them.
32. **Never emit more than one screen.** Measure it: `main.scrollHeight / main.clientHeight` must
    be 1.00. Reference material belongs in its own pane with its own scroll, never the page's.
33. **A control holds a choice, never a measurement the app could take.**
34. **Say the caveat, not its count.** "1 assumed" tells the player nothing; "catalyst unknown:
    the plan was built against half the capacity" tells them everything.
35. **An empty pane is worse than no pane.** If there is nothing to recommend, collapse the
    recommendation and give the width to what is still useful.
36. **When everything refuses for the same reason, say it once.** Nine honest sentences that
    amount to one fact is what makes a screen unreadable.
37. **Check for an existing engine before writing a new one.** `planToday`, `bestPicks`,
    `navigation.ts`, `Disclosure`, `SubRail` all exist and were all being ignored.

### How to treat data

38. **Every number comes from game data or the app says it does not know.** No fixtures, no
    placeholders, no illustrative values.
39. **Numbers from DE's export; classification from WFCD.** DE's `PublicExport` has every damage
    field and **no `type` field at all**, and `eligibleSlots` switches on `type` to pick the whole
    mod pool. See `docs/DATA-SOURCES.md`.
40. **Never persist a raw log line.** Allowlist the fields. Never match the two lines carrying the
    player name.
41. **Never poll.** `src/core/gentle.ts` caches parsed values with conditional revalidation; a
    changed parse shape needs a **new cache key** or your edit looks like a no-op.
42. **A stored record can be missing a field you added later.** Repair at the read boundary, and
    make the gate delete keys rather than build sparse objects.

### How to treat performance

43. **Trace the whole path from trigger to pixel and time every step.** The dominant cost is
    usually a missing call, not a slow computation.
44. **Every path that produces an answer must also present it.** Publishing and showing belong in
    one function so one cannot exist without the other.
45. **Read only the bytes that arrived.** Positional `readSync` from a tracked offset, never
    `readFileSync(...).subarray(...)`.
46. **Cache what cannot change.** An Overwolf declared window's id is constant for the life of
    the app; it was being asked for twice per show.
47. **Await independent calls together.** `Promise.all`, not two sequential `await`s.
48. **Background work yields to the thing the user is waiting for**, and the yield is bounded so
    a call that never returns cannot stall it forever.
49. **When you record a performance figure in a comment, date it.** Three in this repo were stale
    by 2.5–4× and were being used to justify keeping a one-second computation on the main thread.

### How to behave

50. **Do the user-visible thing first.** The brief leads with beauty and speed. Internal
    correctness matters, but a session that produces only harness work has not addressed the
    brief.
51. **Report failures plainly and immediately.** If a claim of mine turns out to be false —
    including "the suite is green" — correct it in one sentence and move on. Do not let it stand.
52. **State what was not done.** Scope that was skipped is the user's call, not the agent's.
53. **Do not narrate options.** Decide, build, show. The user redirects from a finished artifact.

---

## 3. What is actually outstanding

Current state: **815 assertions, 0 failures**; lint clean; `npm run build` ~400 ms.

### Done this session, verified

- Ctrl+K restores the overlay it hid, while the log still narrates the screen
  (`src/app/background.ts`, gated, sabotage-proved).
- Every plan-ready path now shows the overlay — `publishAndShow()` replaces the bare publish on
  `gep.on('answered')` and the settle deadline. **This was the unbounded wait.**
- Overwolf round trips per show: 5 → 2 (`src/core/ow.ts`).
- The ladder yields while the window is coming up (~315 ms).
- The overlay's aside rebuilt on the game's own stat-table grammar
  (`src/app/automod.tsx`, `src/styles/automod.css`), with the numerals off the monospace.
- Platinum panel: **4.44 screens → 1.00**, controls behind a disclosure, the contradicting
  headline card deleted, the family header made to agree with its rows, the permanently empty
  fourth wallet column removed, nine refusal lines collapsed to one.

### Not done

- **The star chart, arsenal, foundry, collection, mastery, progression, syndicates, worldstate,
  focus, nemesis, intrinsics, daily and chronicle panels have not been through any of this.**
  Assume each has the same defects the Platinum panel had.
- **`planToday()` is still not on screen.** Wiring it is the single biggest improvement available
  to the Platinum panel.
- **No master/detail anywhere.** Opening a route still pushes the page down instead of filling a
  detail pane.
- **The game's real body face is not vendored.** The game uses an old Roboto; the app uses Segoe
  UI. This is a visible difference on the overlay.
- **The mod card renders as a featureless dark box in the not-owned state.**
- **Heavy attacks**: the damage is exact, the rate has a missing denominator (see
  `the-heavy-attack-rate-trap`).
- **The slot solver has never seen a mixed-polarity build dump.** Capture is armed via
  `npm run dump`; every dump so far is `AP_UNIVERSAL ×8`.
- **≥36.4 % of modding-screen opens have no `upgradeSlot` line** and therefore no category for
  their whole life.
- **Live rescore** is feasible for 87 % of placements and is not implemented.
- **Re-sourcing the catalogue from DE** is blocked on the missing `type` field.

---

## 4. Commands

```bash
npm run dev          # Vite, port 5273
npm run check        # the whole gate suite - redirect, never pipe
npm run build        # typecheck + build
npm run lint
npm run bench        # beam-search timings
npm run dump         # watch EE.log for a build dump
npm run de           # fetch DE's PublicExport with provenance
npm run slots        # measure arsenal slot indices from the live log
```

The dev server proxies the CORS-blocked hosts under `/__wfm`, `/__drops` and `/__ws`. In the
packaged app `public/manifest.json`'s `externally_connectable` is the CORS gate — a host missing
from it fails **only** in the packaged build, never in the dev server.
