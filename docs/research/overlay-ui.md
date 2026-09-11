# Overlay UI — the visual craft

Research brief for RaijiFrame (Overwolf overlay, React 19 + Vite 8 + Tailwind 4 + `motion` 13).
Written 2026-08-31.

**Reading key.** Every claim is tagged:

- **[V]** VERIFIED — I fetched it this session and read it. URL given.
- **[I]** INFERRED — reasoning from verified facts, or standard engineering knowledge. Not fetched.
- **[GAP]** could not verify. Named honestly rather than filled with a guess.

---

## 0. The headline findings, up front

1. **[V] The platform ceiling is far higher than this repo assumes.** Overwolf client `0.292.142`
   (January 2026) "Updated the underlying CEF version from version 131 to version 142."
   — https://dev.overwolf.com/ow-native/getting-started/changelog/ow-changelog/
   `vite.config.ts` targets `chrome108`. That is wrong in both directions: it is *below* what
   Tailwind v4 itself requires, and it needlessly forbids the best tools available
   (`corner-shape`, `@property`, `mask-composite`, `linear()` easing, `@starting-style`,
   scroll-driven animations). **Raise `build.target` to `chrome130` or higher.**

2. **[V] `corner-shape: bevel` is the single highest-leverage discovery in this brief.** Chrome/Edge
   139+; CEF 142 has it. It produces the angular Orokin chamfer *as real box geometry*, so
   `border`, `outline`, `box-shadow`, `overflow` clipping and `backdrop-filter` all follow the cut
   shape. `clip-path` cannot do any of that — it kills your border and your shadow.
   — https://developer.mozilla.org/en-US/docs/Web/CSS/corner-shape (values, interactions)
   — Chrome 139+/Edge 139+, no Firefox/Safari timeline as of mid-2026 (irrelevant here; we ship one engine)

3. **[V] Digital Extremes' own web CSS is a usable primary source for the Orokin palette and
   panel grammar.** Pulled from `https://www-static.warframe.com/build/assets/app-B2bJ_Euw.css`
   and siblings. Exact hexes, exact gold gradient ramps, exact chamfer polygons — §2.

4. **[V] The star chart is not a "355-node graph problem". It is thirty small graphs.**
   Measured directly from `src/data/vendor/nodes.json`: 355 nodes, **321** directed edges (not
   ~500), 30 planet groups of 4–23 nodes, **only 30 cross-planet edges**, max degree 8, and **43
   completely edgeless nodes**. That measurement kills the case for a force-directed layout and for
   every runtime graph library. **Recommendation: precompute a two-level radial-by-planet layout at
   build time; render SVG; ship zero graph libraries.** Full justification in §3.

5. **[V] Overwolf's own product guidelines contradict the current shell design.** Two direct
   quotes from https://dev.overwolf.com/ow-native/guides/product-guidelines/app-screen-behavior/in-game-overlays/
   and the windows guide: *"avoid using semi-transparent widgets or overlays that reduce clarity and
   game performance"* and *"Don't create full-screen transparent windows with draggable HTML
   elements, as this may result in creating low-performance or slow experiences."*
   `Shell.tsx` currently renders a full-bleed `.glass` panel (`backdrop-filter: blur(20px)
   saturate(1.7)`) with an `absolute inset-0` mousedown drag surface in the title bar. That is
   almost exactly the described anti-pattern. Fix in §7 — you can keep the look and lose the cost.

---

## 1. What best-in-class Warframe / game overlays actually look like

### AlecaFrame — the benchmark

**[V]** 1.09M+ downloads, 4.5/5 from 78 ratings, 14.0 MB, v2.6.93, "Free with ads", Overwolf-client
only. — https://www.overwolf.com/app/alejandro_cabrerizo-alecaframe

**[V]** It ships exactly **four** in-game overlays, and every one is *event-triggered and modal to a
game moment*, not an always-on HUD:
— https://docs.alecaframe.com/overlays/overview

| Overlay | Trigger |
|---|---|
| Relic Recommendation | "automatically pops up when you're prompted to select a relic for a void fissure mission"; shows the same data as the Relic Planner tab |
| Relic Rewards | "automatically popup whenever you are prompted to select a reward when a relic is opened" |
| Chat Riven | when you inspect a riven chat link; shows stats and grades |
| Riven Reroll | "will always show you the old riven after a Reroll on the left side, and the new riven will show up on the right side" |

**The lesson is the interaction model, not the pixels.** AlecaFrame's overlay budget is spent on
*decision moments*. The heavy, dense, browsable UI lives in the desktop window; the in-game surface
appears when the game asks a question and the app can answer it. Everything else is a timer.

**[V] Its dense surface (Relic Planner) is a filterable, sortable table with expandable rows**
— https://docs.alecaframe.com/features/relic-planner:
- Filters: only-owned, vaulted status, reward ownership, mastery completion, copies ≥10, tier
  (Intact/Exceptional/Flawless/Radiant), favourite.
- Sorts: Platinum Profit, Ducats Profit, Missing Items (MR optimisation), Name, Amount, Best-to-Upgrade.
- A squad-size control that *changes the numbers* ("affects expected platinum/ducats as well as the
  overall drop rates").
- An export arrow top-right that pushes the current view's settings into the in-game overlay.

That last one is the interaction idea worth stealing outright: **the desktop window configures what
the in-game overlay will say.** You tune your priorities at leisure; the overlay then answers with
*your* ranking at the moment of decision.

### WFinfo

**[V]** C#/WPF, Tesseract OCR on a screenshot of the reward screen; renders "an overlay or separate
window" showing per-part: *"Owned count (based on the Equipment Window), Vaulted tag, Part name,
Plat Value (based on average prices on warframe.market), Ducat Value, Volume Sold."*
— https://github.com/WFCD/WFinfo

Six fields per reward, four rewards, ~2 seconds of decision time. **This is the density ceiling for
an in-mission overlay**: one row per option, six columns, one obviously-highlighted winner. Note it
is not pretty and it is beloved anyway — because the answer arrives before the timer does.

### Overframe

**[V]** Card-based build browser: forma count as an icon, star rating, view count, title, author,
item thumbnail. Sections: Top Builds, News, Tier List, Player Sync, New Build. Alphabetical
warframe listing split standard/Prime; arsenal split primary/secondary/melee/archwing/companion.
— https://overframe.gg/ (colour scheme described by the fetch as "neutral and minimalist"; I did
not pull their CSS, so treat the visual description as **[GAP]**.)

### Where they put emphasis — the synthesis

Every one of these puts **the recommended action in the largest, brightest, most-saturated element
on screen and everything else in greyscale support.** None of them decorate. The opportunity for
Codex is that *none of them are beautiful* — AlecaFrame is a functional WPF-flavoured grid, WFinfo
is a bare list. **Spectacle is genuinely unoccupied territory in this niche**, provided it never
costs the user the answer.

**[GAP]** I did not survey non-Warframe Overwolf apps (Outplayed, CurseForge overlays) this pass.

---

## 2. Orokin / Tenno visual grammar — with DE's own numbers

Everything in this section marked **[V]** was extracted from Digital Extremes' production
stylesheets, downloaded this session:

```
https://www-static.warframe.com/build/assets/app-B2bJ_Euw.css      (376 KB)
https://www-static.warframe.com/build/assets/styles2-CA6L-ssw.css  (107 KB)
https://www-static.warframe.com/build/assets/home-B25JtqhN.css     ( 22 KB)
```

### 2.1 The palette, straight from DE

**[V]** Hex frequency counts across those files, gold family and accents (OKLCH conversions computed
locally via the sRGB→OKLab matrices):

| Hex | Uses | OKLCH | Role in DE's own CSS |
|---|---|---|---|
| `#ddc57d` | 59 | `oklch(0.828 0.095 91.7)` | The workhorse gold. Filigree lines, planet horizon, glow colour |
| `#e4bc53` | 26 | `oklch(0.811 0.130 88.2)` | Prime Access gold — `border-top: 1px solid #e4bc53`, button fills |
| `#d0b549` | 6 | `oklch(0.776 0.130 95.1)` | Base of the metallic sheen ramp |
| `#c79616` | 6 | `oklch(0.701 0.139 84.2)` | Deep gold / shadowed metal |
| `#f6e3ab` | 6 | `oklch(0.918 0.075 91.5)` | Pale gold highlight |
| `#65c4ed` | 8 | `oklch(0.778 0.107 228.6)` | Energy cyan |
| `#042632` | 6 | `oklch(0.251 0.044 226.1)` | Deep teal substrate |
| `#034169` | 6 | `oklch(0.363 0.089 245.0)` | Navy substrate |
| `#b30000` / `#e60012` | 79 / 11 | `oklch(0.481 0.198 29.2)` / `oklch(0.581 0.238 27.9)` | Warframe brand red (alerts, panel accents) |

**What this tells you that the current `theme.css` gets wrong:** the repo's gold is
`oklch(0.76 0.15 82)`. DE's is *lighter and less chromatic* — `L≈0.81–0.83, C≈0.10–0.13, H≈88–92`.
The repo's is a shade too orange and too saturated; it reads as amber, not gold leaf. Also, DE never
uses one gold — they use a **five-step ladder** (`#c79616 → #d0b549 → #e4bc53 → #ddc57d → #f6e3ab`)
because gold only reads as *metal* when there is a specular highlight above the base tone. A single
flat gold always reads as mustard plastic.

Recommended token set (drop-in for `@theme`):

```css
@theme {
  /* Orokin gold — five steps, matched to DE's own web palette. Metal needs a ramp. */
  --color-orokin-100: oklch(0.918 0.075 91.5);  /* #f6e3ab  specular highlight */
  --color-orokin-200: oklch(0.828 0.095 91.7);  /* #ddc57d  filigree / hairlines */
  --color-orokin-300: oklch(0.811 0.130 88.2);  /* #e4bc53  hero fill  */
  --color-orokin-400: oklch(0.776 0.130 95.1);  /* #d0b549  ramp base   */
  --color-orokin-500: oklch(0.701 0.139 84.2);  /* #c79616  shadowed metal */

  --color-tenno-400:  oklch(0.778 0.107 228.6); /* #65c4ed  energy cyan */
  --color-substrate:  oklch(0.251 0.044 226.1); /* #042632  deep teal ground */
  --color-alarm-500:  oklch(0.581 0.238 27.9);  /* #e60012  brand red — alerts only */
}
```

### 2.2 The angular panel cut — DE's actual polygons

**[V]** DE ships exactly two chamfer shapes on warframe.com, both on Prime Access panels:

```css
/* the "cut corner" — bottom-right chamfer, 13% x 39% */
clip-path: polygon(0% 0%, 100% 0, 100% 61%, 87% 100%, 0% 100%);

/* the "slant" — sheared top-right, used behind package titles */
clip-path: polygon(0% 0%, 86% 0, 100% 100%, 100% 100%, 0% 100%);
```

Selectors, verbatim:
`body.prime_access #primeaccess #packageContainer .package .cutCorner { clip-path: polygon(0% 0%,100% 0,100% 61%,87% 100%,0% 100%) }`
`… .title .titleContain { clip-path: polygon(0% 0%,86% 0,100% 100%,100% 100%,0% 100%); border-top: 1px solid #e4bc53; height: 63px }`

Note the pairing: **the chamfered panel gets a 1px gold rule on exactly one edge.** That asymmetric
single-edge rule is the core Orokin move — not a full gold box.

**[I] Do not copy the `clip-path`.** DE uses it because their site must run in Safari. You do not.
`clip-path` destroys `border`, `box-shadow` and `outline` at the cut, which is why DE has to fake
the gold edge with a separate `border-top` on a rectangle behind it. Use `corner-shape` instead:

```css
/* Orokin panel — one cut corner, real border, real shadow, real backdrop blur. */
.panel {
  border-radius: 0 0 26px 0;   /* only the bottom-right corner has a radius   */
  corner-shape: bevel;         /* …and that radius is rendered as a straight cut */
  border: 1px solid var(--hairline);
  border-top: 1px solid var(--color-orokin-300);   /* DE's asymmetric gold rule */
  background: var(--surface-glass);
  overflow: hidden;            /* clipping follows the bevel — verified on MDN */
}
```

**[V]** MDN confirms `background-color`, `background-image`, `border`, `outline`, `box-shadow`,
`overflow` **and `backdrop-filter`** all respect `corner-shape`. `corner-shape` has no effect
without a non-zero `border-radius`, and is ignored if `border-shape` is set.
— https://developer.mozilla.org/en-US/docs/Web/CSS/corner-shape

Values worth knowing: `bevel` (= `superellipse(0)`, the straight diagonal cut), `notch`
(`superellipse(-infinity)`, a square bite — good for tab notches), `scoop` (`superellipse(-1)`,
concave — good for the "inhale" curve on Orokin door frames), `squircle` (`superellipse(2)`).
Four-value form goes clockwise from top-left: `corner-shape: bevel round round scoop;`

### 2.3 Metallic gold — DE's exact sheen ramps

**[V]** Lifted verbatim from their CSS:

```css
background: linear-gradient(135deg, #d0b549 0, #ffffc5 4rem, #d0b549 8rem);  /* long sheen  */
background: linear-gradient(160deg, #d0b549 0, #ffffc5 1rem, #d0b549 2rem);  /* tight sheen */
background: linear-gradient(to right, transparent, #ddc57d);                 /* filigree hairline */
background: linear-gradient(#ddc57d1a, #0000 32px);                          /* 32px top-edge wash */
background: radial-gradient(closest-side, #ddc57d66 0, #ddc57d00 80%);       /* gold bloom */
filter: drop-shadow(0 0 16px #ddc57d80);                                     /* gold glow */
```

Three structural lessons:

1. **The specular stop is `#ffffc5`, not white.** Warm-white. A pure-white highlight on gold reads
   as chrome.
2. **The sheen ramp is measured in `rem`, not `%`.** So the highlight band stays a *physical width*
   regardless of element size — a small button and a wide header get the same-looking metal. Copying
   `%`-based gold gradients is the classic mistake that makes big elements look like a rainbow.
3. **The filigree hairline fades to `transparent` at one end.** Never a full-length rule. That single
   detail is 80% of "Orokin" versus "gaming website".

### 2.4 The energy-line motif

**[V]** DE's partial-accent border trick, straight from their CSS — a border-image with a hard stop,
producing a rule that is neutral for most of its length and accent-coloured for exactly the last
110px:

```css
border-image: linear-gradient(to left, #1d1c20 110px, var(--panel-accent-color, #b30000) 110px) 1;
border-image: linear-gradient(to left, #1d1c20  50px, var(--panel-accent-color, #b30000)  50px) 1;
```

Retargeted to gold, this is your panel-header rule:

```css
.panel > header {
  border-bottom: 1px solid;
  border-image: linear-gradient(to left,
                  var(--hairline) 0 calc(100% - 96px),
                  var(--color-orokin-300) calc(100% - 96px)) 1;
}
```

### 2.5 The animated gradient border — three implementations, ranked

**Rank 1 — two-layer conic sheet (recommended). Transform-only, therefore composited.** No masks,
no `@property`, works with `corner-shape`, and the only animated property is `rotate`.

```css
.frame {
  position: relative;
  isolation: isolate;
  border-radius: 0 0 26px 0;
  corner-shape: bevel;
  overflow: hidden;               /* clips the sheet to the bevel */
}
.frame::before {                  /* the rotating light source */
  content: '';
  position: absolute;
  inset: -60%;                    /* oversized so the conic covers the corners while spinning */
  z-index: -2;
  background: conic-gradient(from 0deg,
    transparent 0 68%,
    var(--color-orokin-100) 78%,
    var(--color-orokin-300) 84%,
    transparent 92% 100%);
  animation: frame-sweep 7s linear infinite;
}
.frame::after {                   /* the plate that leaves a 1px ring visible */
  content: '';
  position: absolute;
  inset: 1px;
  z-index: -1;
  border-radius: inherit;
  corner-shape: inherit;
  background: var(--surface-glass);
}
@keyframes frame-sweep { to { transform: rotate(1turn); } }
```

**Rank 2 — `@property` conic angle.** One element instead of two, but animating a registered custom
property repaints the pseudo-element every frame. Acceptable on a 1px ring; do not scale it to
twenty cards.

```css
@property --sweep {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}
.frame-lite::before {
  content: '';
  position: absolute;
  inset: 0;
  padding: 1px;
  border-radius: inherit;
  corner-shape: inherit;
  background: conic-gradient(from var(--sweep),
    transparent 0 70%, var(--color-orokin-100) 80%, transparent 90%);
  /* border-only mask — verified from Magic UI's ShineBorder source */
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  animation: sweep 7s linear infinite;
}
@keyframes sweep { to { --sweep: 360deg; } }
```

**[V]** That mask recipe is real production code, taken verbatim from
`https://magicui.design/r/shine-border.json`:
```js
mask: `linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)`,
WebkitMaskComposite: "xor",
maskComposite: "exclude",
padding: "var(--border-width)",
```
**[V]** `mask-composite` values: `add` (default), `subtract`, `intersect`, `exclude`; Baseline
"widely available" since December 2023. — https://developer.mozilla.org/en-US/docs/Web/CSS/mask-composite

**[I] Note the flaw in Magic UI's own component:** `ShineBorder` animates `background-position`
(class `animate-shine`, `will-change: background-position`). That is a repaint every frame on a
full-size element. Do not port that one — port the geometry, not the animation.

**Rank 3 — travelling beam along the border (`offset-path`).** **[V]** This is Magic UI's
`BorderBeam`, source from `https://magicui.design/r/border-beam.json`:

```jsx
<motion.div
  style={{
    width: size,
    offsetPath: `rect(0 auto auto 0 round ${size}px)`,
    background: 'linear-gradient(to left, var(--color-from), var(--color-to), transparent)',
  }}
  initial={{ offsetDistance: `${initialOffset}%` }}
  animate={{ offsetDistance: [`${initialOffset}%`, `${100 + initialOffset}%`] }}
  transition={{ repeat: Infinity, ease: 'linear', duration, delay: -delay }}
/>
```

`offset-distance` resolves to a `transform` on the element, so this is compositor work.
The wrapper confines it to the ring with
`border: Npx solid transparent; mask-clip: padding-box, border-box; mask-composite: intersect`.
**[GAP]** I could not reconcile that specific two-layer `mask-clip`/`intersect` recipe against the
spec text by reading alone — the transparent first layer *should* zero the result. It is shipped
production code in both Magic UI and Aceternity, so it evidently works in Chromium; I am flagging it
rather than explaining it. If you want a mechanism you can reason about, use the Rank 1 or Rank 2
recipe above instead.

Same technique in plain CSS, no React, no library:

```css
.beam {
  position: absolute;
  aspect-ratio: 1;
  width: 90px;
  offset-path: rect(0 auto auto 0 round 26px);
  offset-rotate: 0deg;
  background: linear-gradient(to left, var(--color-orokin-100), var(--color-orokin-300), transparent);
  animation: beam 5.5s linear infinite;
}
@keyframes beam { from { offset-distance: 0%; } to { offset-distance: 100%; } }
```

### 2.6 Cursor-tracked edge glow (the HUD "attention" cue)

**[V]** Aceternity's `GlowingEffect` (`https://ui.aceternity.com/registry/glowing-effect.json`)
drives an unregistered `--start` custom property with motion's imperative `animate()` and uses it as
a conic wedge *mask*, so only a short arc of the border lights up, positioned toward the pointer:

```css
mask-image: linear-gradient(#0000, #0000),
            conic-gradient(from calc((var(--start) - var(--spread)) * 1deg),
              #00000000 0deg, #fff, #00000000 calc(var(--spread) * 2deg));
mask-clip: padding-box, border-box;
mask-composite: intersect;
opacity: var(--active);
transition: opacity 300ms;
```

**[I] Two warnings before you port it.** It sets `background-attachment: fixed` on the gradient —
a fixed background attachment forces expensive repaints and is a bad idea over a live game frame;
drop it. And it recomputes on every `mousemove` through a `requestAnimationFrame` — throttle to the
hovered card only.

**[V]** The much cheaper cousin, Aceternity's `CardSpotlight`
(`https://ui.aceternity.com/registry/card-spotlight.json`), is just a masked overlay:

```jsx
maskImage: useMotionTemplate`radial-gradient(${radius}px circle at ${mouseX}px ${mouseY}px, white, transparent 80%)`
```

**[I] Better for an overlay:** skip the mask entirely. Put an absolutely-positioned blurred radial
`div` inside the card and move it with `transform: translate3d(x, y, 0)`. Same look, transform-only,
no per-frame mask re-rasterisation. Magic UI's `MagicCard` "orb" mode does exactly this and even
annotates it — **[V]** `willChange: "transform, opacity"`, `mixBlendMode: isDarkTheme ? "screen" : "multiply"`.
`mix-blend-mode: screen` on a dark ground is the correct blend for an energy glow.

### 2.7 Negative space and ornamental restraint — the rule that keeps this from being a cheap skin

**[I]** The failure mode of "Orokin-themed web UI" is uniform ornament: gold border on every box,
chamfer on every corner, glow on everything. The game does the opposite. The discipline:

- **One chamfered corner per panel, not four.** Vary *which* corner by hierarchy. A four-corner
  chamfer reads as a sci-fi Bootstrap card.
- **Gold appears at most twice per screen**: once as a fill (the single recommended action), once as
  a 1px partial rule. Everything else is void-neutral and cyan.
- **Ornament goes where a boundary already exists** — panel edges, the seam between rail and content,
  the frontier of the star chart. Never in open field.
- **Ornamental strokes are 1px and fade.** Two-pixel gold lines look like a border; 1px lines that
  fade to transparent look like inlay.
- **Negative space is a material.** DE's panels are >50% empty. If a panel is full, split it.

---

## 3. The star chart — the centrepiece

### 3.1 Measured facts about the actual graph

**[V]** Computed this session directly from `C:/Claude/Warframe/src/data/vendor/nodes.json`
(itself sourced from `https://wiki.warframe.com/index.php?title=Module:Missions/data&action=raw`):

```
nodes:                 355
directed next-edges:   321      <- not ~500
planet groups:          30      <- sizes 2..23
cross-planet edges:     30      <- the junction backbone, and nothing else
max degree:              8      <- exactly one node
degree histogram:       {0:43, 1:86, 2:139, 3:68, 4:17, 5:1, 8:1}
edgeless nodes:         43
```

Group sizes: Earth 23, Mars 21, Saturn 20, Venus 19, Deimos 19, Jupiter 18, Europa 17, Uranus 16,
Sedna 16, Ceres 15, Neptune 15, Pluto 15, Eris 14, Void 13, Mercury 12, Phobos 11, Lua 10,
Höllvania 10, Veil Proxima 10, Kuva Fortress 8, Zariman 7, Earth Proxima 7, Neptune Proxima 7,
Venus Proxima 6, Saturn Proxima 6, Pluto Proxima 6, Dark Refractory 5, Duviri 4, Uranus Proxima 3,
Sanctuary Onslaught 2.

**This is the single most important input to the design and it changes the answer completely.**
The graph is 30 near-linear chains, joined by a 30-edge backbone, plus 43 orphans. Average degree
among connected nodes is ~2.06. There is essentially no tangle to untangle.

### 3.2 Layout: radial-by-planet, two levels, computed at build time

**Recommendation: two-level radial. Level 1 places planets; level 2 places nodes within a planet.
Both computed once in a build script and written into `nodes.json` as `x`/`y`. Zero runtime layout.**

**Level 1 — the solar system.** Take the 30 cross-planet edges as a DAG. BFS from Earth gives each
planet a rank (Earth 0, Venus/Mercury 1, …). Place planets on concentric rings by rank, angle
spaced within the ring, jittered so the rings do not read as a bullseye. That is ~40 lines of code
and it produces *a solar system* — which is what the player already has in their head.

**Level 2 — inside a planet.** Each planet is ≤23 nodes and mostly a chain. BFS-depth from the
planet's entry node gives a depth; place nodes on a small annulus around the planet centroid, angle
= index within depth, radius = base + depth × step. If you want organic wobble, run `d3-force` for
300 ticks *in the build script* with a `forceRadial` constraint and a `forceLink` distance — never
at runtime.

**Level 3 — the 43 orphans.** Duviri, Sanctuary Onslaught, The Orbiter, Drifter's Camp and friends
have no edges. Do not force them into the orbital metaphor and do not let a force layout fling them
into the void. Give them a dedicated band — a horizontal "unbound / narrative" strip below the
system, or a ring outside the outermost planet. Semantic separation, not a layout failure.

### 3.3 Why not the alternatives

**Force-directed (`d3-force`) — reject.** Three concrete disqualifiers, all traceable to the
measured stats:
1. The graph is **disconnected**: 30+ components plus 43 singletons. Force simulation on a
   disconnected graph has no attractive term between components — they drift apart under
   `forceManyBody` until only the bounding box stops them. The 43 singletons drift *hardest*.
2. It is **non-deterministic in feel**. Slightly different seeds give different pictures. A star
   chart is a map the player must memorise across sessions. A map that reshuffles is not a map.
3. It **discards the strongest available prior** — that the player already knows Earth comes before
   Venus comes before Mars. Force layout throws away the semantics you were handed for free.
   `d3-force` remains excellent as a *build-time relaxer inside a single planet*, where the
   component is connected and small. Use it there or not at all.

**Hierarchical (`dagre`/`elkjs`) — reject as the primary.** Correct for the junction backbone (which
genuinely is a DAG), catastrophically wrong inside a planet: with degree ≈2, a layered algorithm
produces 30 tall thin columns. It is also enormous — see the table.

**Radial-by-planet — accept.** Matches the mental model; keeps 30 clusters visually separable;
stable across runs; gives "frontier" a free geometric meaning (the boundary of the lit region); and
the algorithm is trivial enough to own outright.

### 3.4 Library comparison (npm sizes and versions fetched from registry.npmjs.org this session)

**[V]** All figures below are `dist.unpackedSize` and `dist-tags.latest` from the npm registry,
2026-08-31:

| Package | Latest | Unpacked | Deps | Renderer | Verdict |
|---|---|---|---|---|---|
| `d3-force` | **3.0.0** | 87 KB | d3-timer, d3-dispatch, d3-quadtree | layout only, no renderer | **Build-time only**, if at all |
| `elkjs` | **0.12.0** | **7 858 KB** | none | layout only | **No.** 7.9 MB of GWT-compiled Java to place 355 dots |
| `dagre` | 0.8.5 (2019) | — | **lodash**, graphlib | layout only | **Dead.** Last publish 2019, drags lodash |
| `@dagrejs/dagre` | **3.1.1** | — | @dagrejs/graphlib | layout only | The maintained fork; still wrong algorithm here |
| `cytoscape` | **3.34.2** | **5 566 KB** | none | canvas **[GAP]** | Full graph *application* framework. Massive overkill |
| `sigma` | **3.0.3** | 948 KB | events, graphology-utils | **WebGL** | Requires `graphology` (+2 666 KB). Built for thousands of nodes |
| `@xyflow/react` | **12.11.5** | 1 185 KB | zustand, classcat, @xyflow/system | **DOM nodes** | Editor-shaped; DOM nodes cap out well below 355 with effects |
| `graphology` | 0.26.0 | 2 666 KB | — | data structure | Only needed by sigma |
| `d3-quadtree` | 3.0.1 | 42 KB | — | spatial index | Useful *if* you go canvas |
| `d3-hierarchy` | 3.1.2 | 133 KB | — | tree/cluster/pack layouts | Genuinely useful at build time for the per-planet radial |

**[V]** sigma.js self-describes: *"renders graphs using WebGL. It allows drawing larger graphs
faster than with Canvas or SVG based solutions"*, targets *"graphs of thousands of nodes and edges"*,
implements no layouts itself and works *"in symbiosis with graphology"* — https://www.sigmajs.org/

**[V]** Cytoscape.js core layouts: Grid, Circle, Concentric, Breadthfirst, Preset, CoSE; 70
extensions incl. fCoSE, Cola, ELK, Dagre, Klay. Its docs note `hideEdgesOnViewport` and
`textureOnViewport` are *"now largely moot, as a result of performance enhancements."* —
https://js.cytoscape.org/ **[GAP]** that page did not state the renderer; I know it as canvas-2D but
did not verify, and I did not verify whether a WebGL renderer has landed in 3.3x.

**Verdict: ship none of them at runtime.** The layout is a pure function of a static topology.
Compute it once in `scripts/layout-starchart.ts`, write `x`/`y` into the JSON, and the runtime cost
of "graph layout" becomes zero bytes and zero milliseconds. If you want the relaxation quality,
`d3-force` (87 KB) as a **devDependency** in that script is the whole cost.

That is also the honest read of the effort tradeoff: adopting `sigma` means adding 3.6 MB of
dependency and a WebGL text-rendering problem, to solve a rendering load that SVG handles without
breathing hard.

### 3.5 Canvas vs SVG vs WebGL — SVG wins, decisively, at this size

**[I]** ~355 circles + ~321 paths + ≤30 labels ≈ **700 DOM elements**. Chromium is entirely
comfortable there; a moderately complex dashboard has more.

| | Hit-testing | Text | State changes | Verdict |
|---|---|---|---|---|
| **SVG** | Free — real `pointerenter` per element, real `:hover`, real focus, real `<title>` tooltips, real keyboard tab order | Real text rendering, font features, `text-anchor`, ellipsis via `textLength` | One class/attribute change repaints one element | **Use this** |
| **Canvas** | You implement it: quadtree + `isPointInPath`, and you rebuild focus/keyboard nav from scratch | You draw it: no ellipsis, no font-feature-settings, manual DPR scaling or it's blurry | Any change = clear + redraw everything | Only if you exceed ~3 000 elements |
| **WebGL** | Same as canvas, plus picking-buffer complexity | SDF atlases or textured quads. A genuine project | Not at this size | No |

**Accessibility is the tiebreaker nobody mentions.** With SVG each node is a focusable element with
an accessible name and the browser handles arrow-key traversal, screen readers and focus rings for
free. In canvas that is all bespoke, and it is the first thing that gets cut.

**Pan/zoom — the one real performance rule:**

```jsx
// GOOD: single transform on one group. One composited layer for the whole chart.
<svg viewBox="0 0 2400 1600">
  <g style={{ transform: `translate(${x}px, ${y}px) scale(${k})`, transformOrigin: '0 0' }}>
```

```jsx
// BAD: animating the viewBox attribute re-rasterises the entire SVG every frame.
<svg viewBox={`${x} ${y} ${w / k} ${h / k}`}>
```

**[I] Escape hatch if profiling shows raster cost during drag:** wrap the `<svg>` in a `<div>` and
CSS-transform the *div* while the pointer is down (a pure composited layer transform, zero raster),
then swap to the `<g>` transform on `pointerup` so text re-renders crisp. Ugly, effective, and only
worth doing if you measure the need.

### 3.6 Making it beautiful

**Edge bundling — skip it.** **[I]** Bundling exists to tame hairballs. With 321 edges over 355
nodes and a max degree of 8, there is no hairball. Adding a bundling pass would cost real complexity
to solve a problem you do not have. What you *do* want is a consistent curvature sign so parallel
edges fan apart instead of overlapping:

```js
// Quadratic Bézier, curvature signed by a stable hash so it never flickers between renders.
function edgePath(a, b) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x,       dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = 0.14 * len * (((a.i + b.i) & 1) ? 1 : -1);   // stable, not random
  return `M${a.x},${a.y} Q${mx - dy / len * bend},${my + dx / len * bend} ${b.x},${b.y}`;
}
```

**State grammar — four states, four visual treatments.** Drive them all from one attribute on the
root so you can flip the whole chart's meaning (progression / mastery / drop-source) without
touching 355 elements:

```css
.chart .node                 { fill: var(--color-void-600); transition: fill 180ms ease-out; }
.chart .node[data-s="clear"] { fill: var(--color-tenno-400); }
.chart .node[data-s="front"] { fill: var(--color-orokin-300); }
.chart .node[data-s="lock"]  { fill: var(--color-void-800); }
```

**Frontier glow — the one place you spend a filter.** The frontier set is small (nodes that are
uncleared but have a cleared predecessor — **[I]** typically well under 20 given the topology), so a
per-node filter is affordable *there and nowhere else*. Use DE's own glow value:

```css
.chart .node[data-s="front"] {
  filter: drop-shadow(0 0 16px #ddc57d80);   /* verified: DE's own gold glow */
}
```

Plus a breathing halo — a second circle, `transform`-animated only:

```jsx
<motion.circle
  r={11} fill="none" stroke="var(--color-orokin-300)" strokeWidth={1}
  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
  animate={{ scale: [1, 1.9, 1], opacity: [0.55, 0, 0.55] }}
  transition={{ duration: 2.8, repeat: Infinity, ease: 'easeOut' }}
/>
```

`transformBox: 'fill-box'` is essential on SVG shapes or the transform origin is the SVG root and
your halo orbits the corner of the chart.

**Dimming locked regions — one filter per planet, never per node.** This is the single biggest
perf-vs-beauty win available:

```css
.chart .planet[data-locked="true"] {
  opacity: 0.26;
  filter: saturate(0.15);
}
```

30 filtered groups instead of ~200 filtered nodes.

**Animated pulse along the recommended route — use `offset-path`, not `stroke-dashoffset`.**

```jsx
// The route path itself: dim gold, no animation.
<path d={routeD} fill="none" stroke="var(--color-orokin-500)" strokeWidth={1.5} opacity={0.5} />

// A courier travelling it. offset-distance resolves to transform => composited.
<circle r={3.5} fill="var(--color-orokin-100)"
  style={{ offsetPath: `path("${routeD}")`, animation: 'courier 3.2s linear infinite' }} />
```
```css
@keyframes courier { from { offset-distance: 0%; } to { offset-distance: 100%; } }
```

**[I]** The obvious alternative — animating `stroke-dashoffset` on a dashed route — is a *paint*
operation every frame. On one path it is survivable; the courier costs nothing. And a single
travelling dot reads as "this is the way" far more clearly than marching ants, which read as
"selection".

**Never animate `r`, `cx`, `cy`, `x1/y1/x2/y2`, or `d`.** Every one of those triggers SVG layout.
Animate `transform` on a wrapping `<g>` per node, or `opacity`, and nothing else.

**Label LOD.** Render labels for the hovered node, the frontier set and the currently-focused planet
only — roughly 25 `<text>` elements instead of 355. Text is the expensive part of SVG, not shapes.

---

## 4. Motion that earns its place

The repo already does the two hardest things right — `LazyMotion` with `domMax` + `strict`
(`src/app/motion.tsx`) and `layoutId` for the rail marker (`src/app/Shell.tsx`). Build on that.

### 4.1 Easing values worth committing to

**[V]** The `motion` transition API, from https://motion.dev/docs/react-transitions:
`type: 'tween' | 'spring' | 'inertia'`; tween default duration `0.3` (`0.8` for multi-keyframe);
spring takes `stiffness` (default 1), `damping` (10), `mass` (1), `bounce` (0.25), `velocity`,
`restSpeed`, `restDelta`; **`visualDuration`** *"Overrides `duration` to set when the animation
visually appears to reach its target"*; `ease` accepts names, cubic-bezier arrays, or a function;
for keyframe arrays `ease` can itself be an array; `repeatType: 'loop' | 'reverse' | 'mirror'`.

```ts
// src/app/ease.ts — one source of truth. Named intent, not magic numbers at call sites.
export const EASE = {
  /** easeOutExpo. Things arriving. The default for reveals. */
  out:    [0.16, 1, 0.30, 1],
  /** easeOutQuart. Slightly less dramatic; good for hover and colour. */
  soft:   [0.25, 1, 0.50, 1],
  /** Material-standard. For anything that must feel neutral. */
  std:    [0.40, 0, 0.20, 1],
  /** easeInQuad. Exits only — leaving should accelerate away. */
  exit:   [0.55, 0, 1, 0.45],
} as const;

export const SPRING = {
  /** Chips, toggles, the rail marker. Fast, no visible overshoot. */
  snap:   { type: 'spring', stiffness: 520, damping: 40 },
  /** Panels and cards. Reads as having mass. */
  plate:  { type: 'spring', stiffness: 210, damping: 26, mass: 1.1 },
  /** Modern duration-first form — prefer this when you're thinking in time, not physics. */
  hero:   { type: 'spring', visualDuration: 0.42, bounce: 0.18 },
} as const;
```

**[V]** `[0.16, 1, 0.3, 1]` is annotated as easeOutExpo in Magic UI's `AnimatedBeam` source, with
the reference `https://easings.net/#easeOutExpo`.

**Rule: exits are always faster than entrances.** The repo already does this
(`Shell.tsx`: 0.22s in, `y: -4` out). Keep it — exit at ~0.6× the entrance duration.

### 4.2 Staggered reveals

**[V]** The current API is `delayChildren: stagger(0.1)`, with options like `{ from: 'last' }`
— https://motion.dev/docs/react-transitions

```jsx
import { stagger } from 'motion/react';
import { m } from '../app/motion';
import { EASE } from '../app/ease';

const list = {
  hidden: {},
  show: { transition: { delayChildren: stagger(0.035, { from: 'first' }) } },
};

const row = {
  hidden: { opacity: 0, y: 10, filter: 'blur(3px)' },
  show:   { opacity: 1, y: 0, filter: 'blur(0px)',
            transition: { duration: 0.42, ease: EASE.out } },
};

<m.ul variants={list} initial="hidden" animate="show">
  {items.map((i) => <m.li key={i.id} variants={row}>{i.name}</m.li>)}
</m.ul>
```

**[I] The blur is what makes it feel expensive** — a 3px→0 blur alongside the translate reads as
material resolving into focus rather than a div sliding. But `filter` is not free: cap the stagger
list at ~24 visible rows and let the rest appear instantly. Above ~30 concurrent blurred elements
this will cost frames over a running game.

**Stagger delay budget:** `0.035s × n`. At n=24 the last row lands at 0.84s + 0.42s duration =
1.26s. That is the ceiling. Beyond ~1.3s total the reveal stops reading as choreography and starts
reading as slow.

### 4.3 Number counters that tick

**[V]** Magic UI's `NumberTicker` (source: `https://magicui.design/r/number-ticker.json`) — the
mechanism worth stealing is that **it never re-renders React**. The spring is subscribed to and
writes `textContent` directly:

```jsx
const motionValue = useMotionValue(startValue);
const springValue = useSpring(motionValue, { damping: 60, stiffness: 100 });

useEffect(() => springValue.on('change', (latest) => {
  ref.current.textContent = Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces,
  }).format(Number(latest.toFixed(decimalPlaces)));
}), [springValue, decimalPlaces]);
```

**[I] Three changes for this app:**
1. **Drop the `useInView` gate.** Their version waits for scroll-into-view; an overlay panel mounts
   already visible, so `useInView` just adds an IntersectionObserver per counter for nothing.
2. **`{ damping: 60, stiffness: 100 }` is slow** — that is roughly a 1.5s settle. For a HUD use
   `{ damping: 30, stiffness: 180 }` (~0.6s) so the number is readable before the player looks away.
3. **`font-variant-numeric: tabular-nums` is mandatory** or the counter jitters horizontally as digit
   widths change. `theme.css` already has this in `.numeric` — use that class.

```jsx
export function Ticker({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { damping: 30, stiffness: 180 });
  useEffect(() => { mv.set(value); }, [mv, value]);
  useEffect(() => spring.on('change', (v) => {
    if (ref.current) ref.current.textContent = Math.round(v).toLocaleString('en-US');
  }), [spring]);
  return <span ref={ref} className={`numeric ${className ?? ''}`}>0</span>;
}
```

### 4.4 Progress rings that fill

Use SVG `pathLength` normalisation. It makes the maths radius-independent — you animate `0→1`
regardless of the circle's size, so one component works at 16px and 160px.

```jsx
function Ring({ pct, size = 96, w = 6 }: { pct: number; size?: number; w?: number }) {
  const r = (size - w) / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none"
              stroke="var(--hairline)" strokeWidth={w} />
      <m.circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke="var(--color-orokin-300)" strokeWidth={w} strokeLinecap="round"
        pathLength={1} strokeDasharray="1 1"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        initial={{ strokeDashoffset: 1 }}
        animate={{ strokeDashoffset: 1 - pct }}
        transition={{ duration: 0.9, ease: EASE.out }}
      />
    </svg>
  );
}
```

`pathLength={1}` + `strokeDasharray="1 1"` means `strokeDashoffset` is literally "fraction
remaining". **[I]** Yes, `stroke-dashoffset` is a paint property — fine for a handful of rings that
animate once on mount. Do not put fifty of them in a permanently-looping animation.

**The upgrade that makes it feel Orokin:** stroke the arc with a `<linearGradient>` running the gold
ramp (`#c79616 → #f6e3ab → #e4bc53`) so the ring has a specular highlight, and add
`filter: drop-shadow(0 0 10px #ddc57d66)` on the hero ring only.

### 4.5 Layout transitions between panels

**[I]** Motion's `layout` prop is safe: it measures before/after and animates with `transform`
(inverse-scale correction), so despite the name it does **not** animate layout properties per frame.
Two rules:

- Use **`layout="position"`** on anything containing text. Plain `layout` animates size too, which
  distorts glyphs mid-flight — the classic "why does my label look squashed" bug.
- Wrap cross-component shared elements in **`<LayoutGroup>`** so `layoutId` matches across siblings
  that do not share a parent.

The panel-to-detail transition worth building — a card that *becomes* the detail view:

```jsx
{/* grid */}
<m.div layoutId={`node-${id}`} layout="position" onClick={() => open(id)} />

{/* detail, in an AnimatePresence */}
<m.div layoutId={`node-${id}`} layout="position" className="detail" />
```

Keep `AnimatePresence mode="wait"` for panel swaps (already in `Shell.tsx`) — concurrent in/out on a
transparent overlay double-composites and looks muddy over a game frame.

### 4.6 The scan line / hologram — tasteful version

The cheesy version is a 50%-opacity animated GIF of CRT lines over everything. The tasteful version
has four properties: **it is barely visible, it is slow, it is confined to one panel, and it only
runs while data is genuinely live.**

```css
/* Static scanline texture — no animation at all. Costs one paint, ever. */
.holo::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    oklch(1 0 0 / 0.028) 0 1px,
    transparent 1px 3px
  );
  mix-blend-mode: overlay;
}

/* A single slow sweep band. transform-only => composited. */
.holo::after {
  content: '';
  position: absolute;
  inset-inline: 0;
  top: 0;
  height: 28%;
  pointer-events: none;
  background: linear-gradient(to bottom,
    transparent,
    oklch(0.86 0.09 92 / 0.055) 45%,
    oklch(0.92 0.075 91 / 0.09) 50%,
    oklch(0.86 0.09 92 / 0.055) 55%,
    transparent);
  will-change: transform;
  animation: holo-sweep 6.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
@keyframes holo-sweep {
  0%        { transform: translateY(-100%); opacity: 0; }
  12%, 78%  { opacity: 1; }
  100%      { transform: translateY(400%); opacity: 0; }
}
```

**[I] The numbers matter.** Peak alpha `0.09`, scanline alpha `0.028`, period 6.5s. At those values
the effect is subliminal — you notice the panel feels alive without being able to say why. Double
any of them and it becomes a costume. And 3px scanline pitch is the minimum that survives
non-integer DPI scaling without moiré.

**Gate it on liveness.** Add `.holo` only when `gep === 'connected'`. A hologram effect on stale
cached data is a lie about the data's freshness, and that is a UX bug, not a style choice.

**Chromatic aberration edge** (the detail that sells "projection"), one extra pseudo-element,
static, zero animation:

```css
.holo { box-shadow: inset  1px 0 0 oklch(0.78 0.107 229 / 0.18),
                    inset -1px 0 0 oklch(0.70 0.14 28 / 0.10); }
```

---

## 5. Data-dense display patterns

### 5.1 Virtualization — reach for the native feature first

**[V] `content-visibility: auto` + `contain-intrinsic-size` is Baseline since September 2024**;
it turns on layout/style/paint containment and skips rendering off-screen content *while keeping it
findable by find-in-page and tab navigation*.
— https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility

```css
.item-row {
  content-visibility: auto;
  contain-intrinsic-size: auto 56px;   /* reserve height so the scrollbar doesn't jump */
}
```

**[I]** That is one CSS declaration and zero dependencies, and it covers the "2 000 owned items in a
scrolling grid" case at ~90% of the quality of a virtualizer. **Try it first.** It fails when you
need scroll-to-index, sticky measured headers, or horizontal virtualization — then reach for:

**[V] `@tanstack/react-virtual@3.14.10`** — 55 KB unpacked, 9 files, MIT, single dependency
`@tanstack/virtual-core`, published 2026-08-18. That is the smallest serious virtualizer available
and the right pick.

**[I] Grid pattern — one virtualizer, not two.** For a fixed-column grid (which is what an item
grid is) virtualize *rows of N* rather than running a row and a column virtualizer:

```jsx
const COLS = 8;
const rows = Math.ceil(items.length / COLS);
const v = useVirtualizer({
  count: rows,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 92,
  overscan: 3,                 // 3, not 10 — every overscanned row is real paint over a game
});

<div ref={scrollRef} style={{ overflow: 'auto', height: '100%' }}>
  <div style={{ height: v.getTotalSize(), position: 'relative' }}>
    {v.getVirtualItems().map((vr) => (
      <div key={vr.key}
           style={{ position: 'absolute', top: 0, left: 0, width: '100%',
                    height: vr.size, transform: `translateY(${vr.start}px)` }}>
        {items.slice(vr.index * COLS, vr.index * COLS + COLS).map(renderCell)}
      </div>
    ))}
  </div>
</div>
```

Note `transform: translateY(...)` rather than `top` — the library's own docs use this and it is the
difference between composited row positioning and a layout pass per scroll frame.

### 5.2 Completion matrix (heatmap)

For "every Warframe × every component" or "every planet × every mission type", a dense cell grid
beats any chart library.

```jsx
<div className="matrix">
  {cells.map((c) => (
    <i key={c.id} title={c.label}
       style={{ '--v': c.ratio } as CSSProperties}
       data-state={c.ratio === 1 ? 'done' : c.ratio > 0 ? 'part' : 'none'} />
  ))}
</div>
```
```css
.matrix { display: grid; grid-template-columns: repeat(auto-fill, 10px); gap: 2px; }
.matrix > i {
  aspect-ratio: 1;
  border-radius: 1px;
  background: color-mix(in oklch,
    var(--color-void-800),
    var(--color-orokin-300) calc(var(--v) * 100%));
}
.matrix > i[data-state="done"] { background: var(--color-orokin-300); }
```

**[I] The performance rules for this pattern**, in order of importance:
1. **`background-color` only.** No `box-shadow`, no `border`, no `filter` per cell. A 2 000-cell
   grid with a per-cell box-shadow will cost you frames; the same grid with flat backgrounds costs
   essentially nothing.
2. **`gap`, not `margin`.** Margins on 2 000 elements is 2 000 more layout boxes to resolve.
3. **Hover state via a parent `:hover` + one absolutely-positioned readout**, not a transition on
   every cell.
4. `color-mix(in oklch, …)` interpolates perceptually, so a 50%-complete cell actually looks
   half-way. sRGB interpolation on gold goes muddy-brown at the midpoint.

### 5.3 Sparkline rows

**[I] Do not add a chart library for this.** A sparkline is nine lines of code:

```jsx
function Spark({ data, w = 88, h = 20 }: { data: number[]; w?: number; h?: number }) {
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--color-tenno-400)"
                strokeWidth={1.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
```

`vectorEffect="non-scaling-stroke"` keeps the line 1.25 device-px regardless of any parent scaling —
without it, sparklines inside a zoomable panel go fat and blurry.

### 5.4 Radial progress clusters

The "seven rings arranged in a ring" summary widget. Same `pathLength` primitive from §4.4, placed
with a trivial polar loop. Animate them in with the §4.2 stagger, `from: 'center'`, so the cluster
blooms outward. **[I]** Cap at ~12 rings — beyond that the eye cannot compare arcs and you should
have used a bar chart.

### 5.5 Packages — the complete recommended list

| Need | Package | Version **[V]** | Why |
|---|---|---|---|
| Long lists / grids | `@tanstack/react-virtual` | 3.14.10 | 55 KB, MIT, one dep. Only if `content-visibility` isn't enough |
| Build-time graph relaxation | `d3-force` (**dev**) | 3.0.0 | 87 KB, never shipped to the client |
| Build-time radial/tree placement | `d3-hierarchy` (**dev**) | 3.1.2 | 133 KB, `d3.cluster`/`d3.pack` for per-planet layout |
| Everything else | — | — | Hand-build it. See §6 |

---

## 6. Component libraries worth mining (mine the mechanism, not the dependency)

**The stance: do not install any of these.** They are shadcn-style copy-in registries, they assume
`@/lib/utils`, `next-themes` and Tailwind class conventions this project does not share, and every
one of them hardcodes purple/pink gradients you would immediately strip. **Fetch the source, extract
the mechanism, rebuild with the tokens from §2.1.** Below is what I actually read this session.

| Component | Source **[V]** | Mechanism | Verdict for a Tenno HUD |
|---|---|---|---|
| **Magic UI · BorderBeam** | `magicui.design/r/border-beam.json` | `offset-path: rect(0 auto auto 0 round Npx)` + animated `offsetDistance` on a gradient square; wrapper masks to the border ring | **Take it.** Best animated-border mechanism found. Compositor-only. Retint to gold. See §2.5 rank 3 |
| **Magic UI · NumberTicker** | `magicui.design/r/number-ticker.json` | `useMotionValue` → `useSpring` → `.on('change')` writes `textContent`. Zero React re-renders | **Take it,** with the three fixes in §4.3 |
| **Magic UI · AnimatedBeam** | `magicui.design/r/animated-beam.json` | Measures two refs against a container via `getBoundingClientRect`, builds a quadratic `M/Q` path, animates a `<linearGradient>`'s `x1/x2` with `ease: [0.16,1,0.3,1]`, `ResizeObserver` for reflow | **Take the gradient-sweep idea** for star-chart route highlighting. Skip the ref-measuring: your node coordinates are already known |
| **Magic UI · ShineBorder** | `magicui.design/r/shine-border.json` | `mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); mask-composite: exclude; padding: var(--border-width)` | **Take the mask, reject the animation.** It animates `background-position` = repaint per frame |
| **Magic UI · MagicCard** | `magicui.design/r/magic-card.json` | Two modes: a `useMotionTemplate` radial-gradient in `border-box` for the border glow, and an "orb" mode using a blurred div moved by `x`/`y` with `mixBlendMode: 'screen'` and `willChange: 'transform, opacity'` | **Take the orb mode.** Transform-only. `screen` blend is the right blend for energy on dark |
| **Aceternity · CardSpotlight** | `ui.aceternity.com/registry/card-spotlight.json` | `maskImage: radial-gradient(Npx circle at mouseX mouseY, white, transparent 80%)` over a coloured plate; pulls in a **three.js** `CanvasRevealEffect` shader | **Take the mask idea only.** The three.js dependency for a dot matrix is absurd here |
| **Aceternity · GlowingEffect** | `ui.aceternity.com/registry/glowing-effect.json` | Conic-gradient *mask* wedge positioned by a `--start` custom property driven by motion's imperative `animate()`; only a short border arc lights, aimed at the cursor | **Take the concept** for "this panel wants attention". Strip `background-attachment: fixed` (repaint hazard) and the rainbow radial stack |
| **Aceternity · Spotlight (new)** | `ui.aceternity.com/registry/spotlight-new.json` | Pure `motion` + layered gradients, no canvas | Cheapest ambient background of the set |

**[V] Magic UI's full catalogue** (https://magicui.design/docs/components) — the entries relevant to
a dark sci-fi HUD: *Special Effects*: Animated Beam, Border Beam, Shine Border, Magic Card, Glare
Hover, Meteors, Particles. *Text*: Number Ticker, Animated Shiny Text, Animated Gradient Text, Text
Animate, Blur Fade, Hyper Text, Morphing Text, Sparkles Text. *Backgrounds*: Flickering Grid,
Animated Grid Pattern, Retro Grid, Dot Pattern, Grid Pattern, Hexagon Pattern, Light Rays, Noise
Texture, Warp Background. *Core*: Marquee, Animated List, Dock, Orbiting Circles, Progressive Blur.

**[I] Of those, the four worth building for this app:** Border Beam (panel focus), Number Ticker
(every stat), Orbiting Circles (the star-chart planet motif — literally the right metaphor), and
Hexagon Pattern or Dot Pattern as a static, non-animated substrate texture.

**[V] React Bits** (https://reactbits.dev, catalogue enumerated from
`github.com/DavidHDev/react-bits/tree/main/src/content`) — 57 Backgrounds, 38 Animations, 43
Components, 32 Text Animations. Names that fit the brief: `Scanner`, `GridScan`, `Radar`,
`FaultyTerminal`, `LetterGlitch`, `Topography`, `LightPillar`, `SideRays`, `Prism`, `DotGrid`,
`ElectricBorder`, `StarBorder`, `BorderGlow`, `MagnetLines`, `SpotlightCard`, `GlassSurface`,
`Counter`, `DecryptedText`, `ScrambledText`, `SplitFlapText`, `CountUp`, `ShinyText`, `StrokeText`.

**[I] Caution:** a large fraction of React Bits' Backgrounds are WebGL/three.js shaders (`Prism`,
`LiquidChrome`, `Plasma`, `Galaxy`, `Iridescence`, `Dither`…). **A persistent WebGL context in an
overlay competes with the game for the GPU.** Do not run a shader background over live gameplay.
`DecryptedText` / `ScrambledText` / `SplitFlapText` are the genuinely on-brief picks — Tenno
terminals decode, and a decode-in animation on a stat label is exactly the right amount of theatre.

**[V] 21st.dev** (via site search): the relevant clusters are a 38-component **Border** collection
(gradient borders, glowing outlines, travelling-beam variants), `easemize/animated-glow-card`
(*"animated, glowing border effect using an SVG filter (feColorMatrix)"*), `ibelick/glow-effect`,
`aceternity/glowing-effect`, `easemize/spotlight-card`, and a Tron-inspired shadcn theme with
`DataCard`, `HUD` and `Radar` components. **[I]** The `feColorMatrix` glow technique is worth
knowing — `feGaussianBlur` + `feColorMatrix` to crush alpha into a hard-edged bloom is how you get a
neon glow that stays crisp, unlike `box-shadow` which always goes soft.

**[GAP] KokonutUI**: `kokonutui.com/docs/components` is client-rendered and returned no component
list to a plain fetch. Not enumerated this pass.

---

## 7. Overwolf overlay performance — the rules

### 7.1 The platform facts

**[V]** CEF 142 since Overwolf client `0.292.142`, January 2026.
— https://dev.overwolf.com/ow-native/getting-started/changelog/ow-changelog/

**[V]** Overwolf's own guidance, quoted:
- *"Avoid using semi-transparent widgets or overlays that reduce clarity and game performance."*
- *"Avoid Blocking Game UI—ensure overlays don't interfere with critical gameplay elements."*
- *"Don't create full-screen transparent windows with draggable HTML elements, as this may result in
  creating low-performance or slow experiences and using more CPU than required for your features."*
- *"Set your window as native if your app includes a window that will only be visible on desktop but
  not while playing"* — improves performance.
— https://dev.overwolf.com/ow-native/guides/product-guidelines/app-screen-behavior/in-game-overlays/
and https://dev.overwolf.com/ow-native/guides/dev-tools/windows/general-tips-for-using-windows/

**[V]** Warframe has a mouse cursor in menus, so **Standard mode** applies — *"allowing interaction
without pulling focus from the game"* — rather than the Exclusive mode required for cursor-less FPS
titles.

**[GAP]** Shared-texture rendering (*"the overlay hands the GPU texture directly to the game, which
composites it without a CPU-side pixel copy"*; D3D9/OpenGL/Vulkan fall back to the CPU copy path) is
documented under **ow-electron**, at
https://dev.overwolf.com/ow-electron/reference/examples/overlay/shared-texture-rendering/.
I did not verify whether ow-native exposes an equivalent. **Worth checking** — Warframe runs DX11/DX12,
so if ow-native has this path it is the single largest available perf win and it costs no UI compromise.

### 7.2 The two concrete problems in the current shell

1. **`.glass` is a full-window `backdrop-filter: blur(20px) saturate(1.7)`.** **[I]** `backdrop-filter`
   forces the compositor to read back everything behind the element into a texture, blur it, and
   re-composite — every frame the backdrop is dirty. Over a *running game*, the backdrop is dirty
   **every single frame**. This is the most expensive thing in the app, and Overwolf explicitly warns
   against semi-transparent overlays on performance grounds.

   **Fix without losing the look:** apply the blur to a *smaller region*, or drop it entirely and use
   a high-opacity tinted background plus a subtle inner gradient. Over a busy game frame, a 0.88-alpha
   panel is more readable than a 0.72-alpha blurred one anyway — the blur is spending frames to make
   the text *harder* to read.

   ```css
   /* Cheap, no readback, better contrast over gameplay. */
   .plate {
     background:
       linear-gradient(oklch(0.14 0.028 265 / 0.94), oklch(0.11 0.03 265 / 0.97)),
       radial-gradient(120% 80% at 50% 0%, oklch(0.25 0.04 226 / 0.35), transparent 70%);
     border: 1px solid var(--hairline);
   }
   ```
   If you keep glass, confine it to the title bar strip and drop the radius to `blur(12px)` — cost
   scales with **area × radius**.

2. **The full-inset drag surface.** `TitleBar` renders
   `<div aria-hidden className="absolute inset-0" onMouseDown={() => dragMove(windowId)} />`.
   Combined with a transparent full-window overlay, that is the literal pattern Overwolf's docs warn
   about. **[I] Fix:** use the CSS drag region instead of a JS handler — `theme.css` already defines
   `.drag-handle { -webkit-app-region: drag }`. Put that class on the header itself and add
   `-webkit-app-region: no-drag` to the buttons. The window manager handles the drag; no JS, no
   inert overlay div, no mousedown listener on every frame.

### 7.3 The rules, as a checklist

**Animate only these:** `transform`, `opacity`. That is the list.
Everything else costs a layout pass, a paint, or both.

**Never animate, over a live game:**
`width` · `height` · `top`/`left`/`right`/`bottom` · `margin` · `padding` · `border-width` ·
`border-radius` · `box-shadow` · `background-position` · `background-size` · `background-color`
(prefer cross-fading two stacked layers with `opacity`) · SVG `r`/`cx`/`cy`/`d`/`x1..y2` ·
`clip-path` (Chromium animates it on the main thread as paint) · `filter` on large or numerous
elements · anything under a `backdrop-filter`.

**[V]** Motion's own guidance agrees: *"Motion is optimised to animate `transform` and `opacity` on
the compositor thread wherever possible, avoiding layout and paint… For best performance, prefer
animating `transform` and `opacity` over properties like `width` or `top`."*
— https://motion.dev/docs/react-motion-component

**Containment and layer hygiene:**
```css
.panel  { contain: paint; }                   /* clip paint, isolate the panel's layout */
.list-row { content-visibility: auto; contain-intrinsic-size: auto 56px; }
```
- **`will-change` only on elements that are actually mid-animation.** Set it in the animating class,
  remove it when the animation ends. A permanent `will-change` is a permanent extra GPU layer and
  permanent extra VRAM — over a game that is memory the game wanted.
- **Never `will-change: transform` on a container with hundreds of children.** It promotes the whole
  subtree into one layer, and every change repaints all of it.

**Frame budget:** **[I]** target **≤2 ms of main-thread work per frame** while the game is running.
A 144fps player has a 6.9 ms budget total, and the game wants all of it. Verify with DevTools
Performance (`Rendering` → *Paint flashing*, *Layer borders*; the **Animations** track marks
non-composited animations with a red triangle — **[V]**
https://developer.chrome.com/docs/devtools/performance/reference).

**Stop work when hidden.** An Overwolf overlay window that is hidden is not necessarily
`document.hidden`. Subscribe to `overwolf.windows.onStateChanged` and:
- pause every `requestAnimationFrame` loop,
- pause ambient CSS animations by toggling a root class (`.quiet * { animation-play-state: paused }`),
- stop polling.
**[GAP]** I did not verify this session whether CEF throttles rAF for a hidden Overwolf window
automatically. Assume it does not, and gate explicitly.

**Ambient effects run at 30fps, not 60.** A background sweep, a drifting particle field, a breathing
halo — none of them need 60fps. Halving their rate halves their cost and nobody can tell. Where the
effect is a CSS animation this is free: make the period longer and the keyframes coarser.

**No WebGL background.** **[I]** A persistent WebGL context in the overlay competes with the game for
the GPU and for VRAM. Every gorgeous three.js background in React Bits and Aceternity is
disqualified by this one constraint. Everything in this brief is achievable in CSS and SVG.

**Respect `prefers-reduced-motion`.** Already handled in `theme.css`. Keep it.

### 7.4 Build config changes implied by all this

```ts
// vite.config.ts
build: {
  target: 'chrome130',   // was 'chrome108'. CEF is 142 (verified). Tailwind v4 itself needs 111+.
}
```
**[I]** `chrome108` currently forces Vite/Lightning-CSS to down-compile or refuse modern syntax you
are entitled to use, while simultaneously being below the floor Tailwind v4 requires — so the stated
target is not actually achievable anyway. Raising it is strictly a win. Pin the manifest's
`minimum-overwolf-version` to a client that ships CEF 142 (`0.292.142` or later — **[V]**) so the
guarantee is real.

---

## 8. The concrete recommendation

**Star chart stack:**

- **Layout:** two-level radial-by-planet (§3.2), computed in `scripts/layout-starchart.ts`, written
  as `x`/`y` into `src/data/vendor/nodes.json`. Optional `d3-force@3.0.0` + `d3-hierarchy@3.1.2` as
  **devDependencies** for per-planet relaxation.
- **Runtime graph libraries:** **none.** 0 KB.
- **Renderer:** SVG. ~700 elements. Free hit-testing, real text, free accessibility.
- **Pan/zoom:** one `transform` on one `<g>`; never the `viewBox` attribute.
- **Beauty:** signed-curvature Bézier edges; `drop-shadow(0 0 16px #ddc57d80)` on the frontier set
  only; `opacity`+`saturate` dimming per *planet group*; an `offset-path` courier dot along the
  recommended route; label LOD.

**Why this and not sigma/cytoscape/xyflow:** the measured graph is 30 disconnected chains with mean
degree 2 and a static topology. Every library in the comparison exists to solve dynamic layout of
dense graphs at scale. Adopting one means shipping 1–8 MB and inheriting a WebGL text problem, to
compute an answer that never changes and that a 40-line build script produces better — because the
build script can use the domain knowledge (planets, junctions, progression order) that no generic
layout algorithm has access to.

**Visual stack:**

- `corner-shape: bevel` for panel geometry (real borders, real shadows, real overflow clipping).
- DE's own five-step gold ramp and `rem`-anchored sheen gradients.
- Rotating conic sheet for animated borders (transform-only), `offset-path` beams for hero panels.
- One gold fill and one partial gold rule per screen. Everything else void-neutral and cyan.
- Static scanline texture at α 0.028 + one 6.5s transform-only sweep band, gated on live GEP.
- Motion: `stagger(0.035)` reveals with a 3px→0 blur, `layout="position"` for shared elements,
  spring `{ visualDuration: 0.42, bounce: 0.18 }` for hero motion, exits at 0.6× entrance.
- `content-visibility: auto` first; `@tanstack/react-virtual@3.14.10` only where it is not enough.
- Zero new runtime dependencies beyond (possibly) `@tanstack/react-virtual`.

---

## 9. Verification ledger

**Fetched and read this session:**
- Overwolf changelog (CEF 131→142, client 0.292.142, Jan 2026) — dev.overwolf.com
- Overwolf in-game overlay product guidelines + windows tips (quoted verbatim) — dev.overwolf.com
- AlecaFrame docs: overlays overview, relic planner — docs.alecaframe.com
- AlecaFrame Overwolf store listing (1.09M downloads, v2.6.93, 14 MB) — overwolf.com
- WFinfo README (C#/WPF, Tesseract OCR, field list) — github.com/WFCD/WFinfo
- Overframe.gg homepage structure — overframe.gg
- warframe.com HTML + 4 production stylesheets (506 KB total): palette hexes with frequency counts,
  two `clip-path` chamfer polygons with selectors, gold gradient ramps, `border-image` accent
  technique, `drop-shadow` glow value, font stacks — www-static.warframe.com
- MDN: `corner-shape`, `mask-composite`, `content-visibility`
- Chrome DevTools performance reference
- motion.dev: react-transitions, react-motion-component, react-upgrade-guide
- Magic UI registry source: border-beam, number-ticker, animated-beam, magic-card, shine-border
- Aceternity registry source: card-spotlight, spotlight-new, glowing-effect
- React Bits full component catalogue via GitHub API
- npm registry: exact versions, unpacked sizes, deps, publish dates for 9 packages
- The project's own `nodes.json` — all graph statistics computed locally

**Gaps, stated honestly:**
1. **Cytoscape.js renderer** — its own docs page did not state canvas vs WebGL; I did not verify
   whether a WebGL renderer exists in 3.34.
2. **The `mask-clip: padding-box, border-box` + `mask-composite: intersect` recipe** used by Magic UI
   and Aceternity — shipped production code, but I could not reconcile its mechanism against the
   spec by reading. Two alternatives given whose mechanism I can defend.
3. **KokonutUI catalogue** — client-rendered site, no component list retrievable by fetch.
4. **Warframe wiki UI-theme pages** — Cloudflare interstitial blocked the raw-wikitext endpoint for
   every page tried (`UI Themes`, `Interface`, `Theme`, `Orokin`). No wiki data used in this brief;
   the Orokin palette comes from DE's own production CSS instead, which is a better source anyway.
5. **Michroma** — verified as linked in warframe.com's `<head>`
   (`fonts.googleapis.com/css?family=Michroma`), but I found **no** `font-family: Michroma` rule in
   the four main stylesheets. So: DE loads it; where they use it is unconfirmed. It is OFL-licensed
   and self-hostable, and is a strong candidate to replace Bahnschrift for display headings — but do
   not cite it as "Warframe's font" on this evidence.
6. **ow-native shared-texture rendering** — documented only under ow-electron. Unverified for
   ow-native, and potentially the biggest perf win available.
7. **Non-Warframe Overwolf app survey** — not done.
8. **Overframe's actual visual design** — described only from a page summary; CSS not pulled.
