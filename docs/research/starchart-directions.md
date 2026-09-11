# Star chart — divergence, and the direction taken

The owner's brief: *"i hate the star chart entirely. completely reimage how it is displayed.
dont try to copy warframes galaxy render anymore."*

## The argument against what was there

The old view was a WebGL solar system: orbits, a shaded planet globe, flight animation between
worlds. It was an imitation of the game's own screen, and imitation is the weakest thing a
companion app can do — the game already renders that, better, and the player is looking at this
app precisely because they want something the game does not give them.

Worse, it encodes almost nothing. In a solar-system render:

- **orbital distance is noise** — Pluto is not "further" in any sense the player cares about,
- **angular position is noise** — nothing is at 40° for a reason,
- **the unlock graph is invisible** — the one structure that actually governs play,
- **the frontier is invisible** — the boundary the player is actually standing on.

353 nodes carry `next[]` and `prev[]`. Thirteen junctions connect the planets into a branching
trunk. That is not a map of space. It is a **network**, and drawing it as space throws the
network away.

## DNA, mined from the subject rather than a gallery

| Ask | Found |
|---|---|
| What is this, structurally | A directed acyclic graph: 355 nodes, 30 regions, 13 named gates |
| What does the game itself call the gates | **Junctions** — the transit word, already |
| The real topology | Earth forks to Venus and Mars; Mars forks to Phobos and Ceres; Jupiter forks to Europa and Saturn; then one long spine, Saturn→Uranus→Neptune→Pluto→Eris→Sedna |
| Regions off that trunk | Void, Lua, Duviri, Zariman, Höllvania, Deimos, the six Proximas, Sanctuary Onslaught, Dark Refractory — genuinely unconnected to the junction chain |
| Material of the world | Void black, Orokin gold, energy cyan — already the app's palette, kept |
| Tempo | Sudden then still. Nothing drifts. |

## Directions considered

1. **Transit diagram** *(cross-domain grammar)* — geography discarded; one line per planet,
   stations for nodes, junctions as interchanges, the frontier as the end of the line you can
   currently reach.
2. **Orokin reliquary plate** *(diegetic framing)* — the chart engraved on gold, radial and
   ceremonial, nodes as filled glyphs.
3. **Depth ladder** *(extreme parameter + amputation)* — no map at all; a vertical accordion
   where your current frontier takes 80% of the screen and everything behind you collapses to a
   hairline.
4. **Etched circuit** *(material transplant)* — traces and vias, cleared paths carrying current.
5. **Tide line** *(temporal signature)* — cleared space as land, locked as water, the frontier
   as an advancing waterline.

Rejected: **2** decorates rather than restructures, and it is the closest of the five to what was
already there. **4** is a UI cliché in its own right. **5** is poetic and cannot address 353
discrete, individually-selectable things. **3** is strong and its idea survives as a graft.

## Committed

> **The Origin System as a transit network: geography thrown away, one line per planet,
> junctions drawn as interchanges, and your frontier as the end of the line you can currently
> reach.**

Beck's insight about the Underground was that when you are navigating a *network*, geographic
truth is noise — and that is precisely the critique of the render this replaces. The direction
carries its own argument against what it displaces, which is what makes it a direction and not a
restyle.

The mapping is native, not forced: junctions are interchanges because the game already calls
them junctions; a planet is a line because its nodes are an ordered run; the route to the next
objective is a journey plan, which is the thing transit diagrams exist to serve.

**Grafted from direction 3, and only this:** the frontier is the emphasis. The reachable end of
each line is drawn heavy and lit; everything beyond it recedes. Your position in the network is
the hero, not the network itself.

## The swap test

Put another game's progression in it and it still draws a network — but *junction-as-interchange*
is Warframe's own vocabulary, and the specific shape (a fork at Earth, a fork at Mars, a fork at
Jupiter, then a six-station spine to Sedna) is the Origin System's and nothing else's. It
survives.

## Rules this direction obeys

- **Octilinear.** Horizontal, vertical and 45° only. No arbitrary angles anywhere.
- **Uniform station spacing.** Distance carries no meaning, so it is never allowed to vary.
- **No orbits, no globes, no starfield behind the diagram.** Amputated deliberately.
- **One line, one colour**, and the signal colour is spent only on the frontier.
- **Interchanges are hollow and larger** than stations, as in every transit diagram ever drawn.
