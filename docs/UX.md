# RaijiFrame — interaction design

This is the plan the build follows. It exists because the Atlas idea was right but
un-designed, and an un-designed good idea produces a confusing app.

---

## 1. Who is at the keyboard, and when

A mid-to-late-game completionist, playing Warframe right now, with the overlay one
keypress away. There are exactly five moments they open it, and every design
decision below serves one of them:

| # | Moment | The question | Time they will give it |
| --- | --- | --- | --- |
| A | Start of session | "What should I do tonight?" | **2 seconds** |
| B | Standing in the Orbiter | "Where do I get X?" | 10 seconds |
| C | Mid-mission, alt-tabbed | "What does this node drop? Have I been here?" | 3 seconds |
| D | Just finished a mission | "What did I get? Did it move anything?" | 5 seconds |
| E | Idle curiosity | "How complete am I really?" | minutes |

**A is the product.** If the app answers A well, it is worth keeping open. B–D are
frequent and must be frictionless. E is where the depth lives, and it is the only
one that justifies a table.

The failure mode of every existing companion app: they answer E, and make the
player do A themselves.

---

## 2. The single organising principle

> **The app answers. It never asks the player to browse.**

Browsing is what happens when software does not know enough to have an opinion.
RaijiFrame knows the player's entire account, their measured drop rates, and live
worldstate — it has no excuse for presenting a menu.

Concretely, every screen must satisfy: *a player who reads only the largest thing
on it has been given a correct, actionable answer.*

---

## 3. Information architecture

Four surfaces. Not twelve panels behind a tab rail.

```
┌───────────────────────────────────────────────────────────┐
│  DIRECTIVE          the one best action, and why           │  ← moment A
├───────────────────────────────────────────────────────────┤
│                                                           │
│                                                           │
│  ATLAS              the solar system as a live answer      │  ← moments B, C
│                     surface. This is the home screen.      │
│                                                           │
│                                                           │
├──────────────────────────────┬────────────────────────────┤
│  AGENDA                      │  DETAIL                    │  ← moments D, C
│  derived wants + what just   │  the selected thing         │
│  happened, newest first      │                            │
└──────────────────────────────┴────────────────────────────┘
```

Nothing here accepts a typed query. The player navigates; the app decides.

**Panels do not disappear** — arsenal, collection, mods, foundry still exist for
moment E. But they are *drill-downs reached by clicking the thing they explain*,
not siblings competing for a tab. A player never has to know which panel holds an
answer; the Directive links straight into the relevant one.

---

## 4. The Directive

The top strip. One action, stated as an instruction, with the reasoning compressed
to one line.

```
NEXT     Run Cambria, Earth — 3 more Neurodes                    ~18 min
         Your rate here is 22% over 34 runs · T2 fissure live 41m · never cleared
```

Rules, all of which exist to stop it being noise:

- **Exactly one action.** A list of five is a menu, and menus are moment E.
- **Always carries expected cost** in minutes, because that is the number a player
  actually decides on. "11.28% drop chance" is not a decision input; "about 18
  minutes" is.
- **Always carries the why**, drawn from the factors that actually moved the
  ranking — personal rate, live event, completion value.
- **It changes when the world changes.** A fissure expiring re-ranks it. This is
  the app's pulse.
- **It is never repetitive by default.** Grind is scored as a cost (see §7).

If the app can only ever get one thing right, it is this strip.

---

## 5. The Atlas

The solar system, as the home screen rather than a navigation menu.

**Two zoom levels**, matching the game so the player's existing spatial memory
transfers for free:

- **System** — all worlds. Each shows completion, faction control, and whether
  anything is live on it. Answers "where is anything happening".
- **World** — one planet's nodes as labelled markers with their real connections.
  Answers "what is here, and have I done it".

**What the surface encodes** — and why none of it can be a texture:

| Channel | Meaning | Source |
| --- | --- | --- |
| Surface heat | where you have actually spent your time | your mission log |
| Light | what is live right now | worldstate |
| Colour | faction control | worldstate + node data |
| Dark | never been there | your account |
| Pulse rate | time pressure — sooner expiry, faster pulse | worldstate expiries |

Every one of those is per-player and changes by the minute. A shared static image
cannot express any of them. **This is the actual argument for procedural
rendering** — not fidelity, but that the surface is carrying information.

**Interactions**

- Hover a node → name, type, level, your clear state. No click needed for moment C.
- Click a node → the Detail pane fills. Map does not move.
- Click a world → zoom in. Escape or Zoom Out returns.
- The map is always showing the current Directive's **route**: the nodes it
  involves are lit and everything else is pushed down. The map is not a thing to
  interrogate — it is already displaying the answer.

---

## 6. The Agenda — derived, never authored

An earlier draft of this document put a command bar here: type "neurodes", get a
route. That contradicts §2. It only *looks* like an answer engine — the player
still has to know what they need, name it correctly, and re-ask every time the
world changes. It is browsing with extra steps.

**The player never states a want.** The app holds the entire account; it has no
business asking. Every want is derived continuously from real state:

| Source | What it yields |
| --- | --- |
| Foundry | items finished and waiting to claim; builds blocked on materials |
| Quests | anything startable right now, mainline weighted highest |
| Star chart | the frontier — reachable and never cleared |
| Mastery | owned-but-unranked items (the cheapest mastery there is) |
| Prime sets | sets missing one or two parts, and the relics holding them |
| Syndicates | unspent daily standing, and standing to the next rank |
| Nightwave | active challenges and where they are done |
| Dailies | sortie, archon, netracells, Simaris — unclaimed, expiring |
| Nemesis | an active lich's requiem and the nodes it holds |
| Intrinsics | branches below max |
| Focus | schools short of waybound |
| Resources | anything a known blueprint is short of |

**Why these are comparable.** A derived want is only useful if it can be ranked
against every other one, so each carries the same three properties: what it
unlocks (`weight`), when it stops being available (`expiry`), and whether it is
one-and-done or repeatable. That is what lets *"your sortie expires in 2h"* beat
*"you are 3 Neurodes short"* without either being special-cased.

Priority is deliberately transparent — `weight × urgency`, discounted if
repeatable. Anything cleverer becomes impossible for the UI to explain, and an
unexplainable recommendation is one the player will not trust.

**The player's only inputs** are navigational, never declarative:

- click a world or node to look at it
- scroll the agenda if curious what is *second*
- dismiss or defer an item they are not interested in

That last one is the only feedback channel, and it is a correction rather than a
query — the app proposes, the player vetoes.

## 7. The ranking, stated plainly

This is the engine's contract, and the UI must be able to explain every placement.

1. **Your rate beats the published rate**, shrunk by sample size. A global 11.28%
   is a prior; 34 personal runs is evidence. Blend toward personal as the sample
   grows (half-weight at ~25 runs) — trusting three runs would swing wildly,
   ignoring two hundred throws away the best evidence the app has.
2. **Availability beats probability.** A worse node with a live fissure can be the
   better use of the next twenty minutes.
3. **Repetition is a cost, not a tiebreak.** The explicit brief was progress
   *without* grinding. Penalty grows logarithmically with your run count, so the
   first few runs barely register and the four-hundredth is strongly discouraged.
4. **Never-cleared content earns a bonus** — it satisfies the want *and* advances
   completion.
5. **Report expected minutes, not drop chance.** Rate × your measured run time.

Every ranked row shows the factors that moved it. If the app cannot explain a
recommendation, it does not make it.

---

## 8. The Ledger

Bottom-left. What just happened, newest first.

```
CAMBRIA · EARTH        14:32   ✓ 6m12s
  +2 Neurodes  +1,204 Credits  +Vauban Blueprint
  → Neurodes 8/10 for Nekros Prime
```

Fed by the mission log: EE.log says when/where/how it went, an inventory snapshot
diff says exactly what dropped. The third line is the point — loot is only
interesting in relation to a goal.

This is also what makes the personal drop rates in §7 accumulate. The Ledger is
not a feed; it is the app's evidence base.

---

## 9. Empty and honest states

The app will frequently know less than it wants to. It must say so precisely,
never fill the gap with a plausible number.

| Situation | What it says |
| --- | --- |
| Game not running | "Launch Warframe — RaijiFrame reads your account from the running game." |
| Connected, no inventory yet | "Linked. Waiting for the game's first account push." |
| No mission history yet | Published drop rates only, labelled as such. |
| Thin history on a node | "3 runs — using the published rate." |
| Dataset missing | Counts without a denominator, and which dataset is missing. |

Rule: **a number on screen is either real or absent.** Never a placeholder, never
a plausible fill. A screenshot of invented state hides exactly the bugs real input
would expose. This is enforced by `npm run check:fake`.

---

## 10. Build order

Each step is independently useful and shippable.

1. **Atlas system view** on real account state — completion, faction, live overlays
2. **Directive strip** — one action, expected minutes, reasoning
3. **Atlas world view** — the node map, already built
4. **Ledger** — mission log with inventory-diff loot attribution
5. **Agenda** — derive wants from every subsystem, ranked comparably
6. **Route rendering** — the map dims to the current directive's route
7. **Personal drop rates** — accumulate from the Ledger, feed back into ranking
8. **Panels as drill-downs** — reached from Atlas and Ask, not a tab rail

Steps 1, 2 and 4 alone answer moments A, C and D — the ones that decide whether the
app earns its keybind.
