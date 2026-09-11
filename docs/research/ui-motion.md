# Warframe UI — Motion, Effects, and How to Exceed It

Research for the RaijiFrame Overwolf overlay. Target stack: React + TypeScript + Tailwind v4 +
`motion` v13 + canvas/WebGL, running in Overwolf's CEF (Chromium) compositing over a game at 60–144 fps.

**Evidence grading used throughout:**

- **[V]** VERIFIED — I fetched the artefact and read/sampled it. URL given.
- **[I]** INFERRED — reasoned from verified evidence, but not directly measured.
- **[G]** GUESSED — plausible, unmeasured, flagged so you do not build a spec on it.

**What I could NOT verify:** I have no frame-accurate capture of the running game. Nobody publishes
Warframe's UI timing curves; DE's UI is authored in their in-house Evolution engine tooling and the
easing values are not public. **Every millisecond figure in §1 is [I] or [G].** They are calibrated
targets for *our* overlay, chosen to sit in the same perceptual family as the game while being
faster — which the community actively asks for (see §1.0). Do not cite them as "Warframe's real numbers".

---

## §0. The forensic baseline — what I actually sampled

I pulled two **official Digital Extremes screenshots** off warframe.com and sampled pixels out of them
with `System.Drawing`. These are the only hard colour numbers in this document.

| Source | URL |
|---|---|
| Star Chart, 3840×2160 [V] | `https://warframe-web-assets.nyc3.cdn.digitaloceanspaces.com/uploads/c3c7aac4df4d4c94b1fe5b348aa469a7.jpg` (linked from `https://www.warframe.com/en/news/star-chart`) |
| Nightwave panel, 1280×720 [V] | `https://warframe-web-assets.nyc3.cdn.digitaloceanspaces.com/uploads/4d23cc7e7e015f0c3f8a5dd72037ebbb.jpg` |

### Sampled values [V]

```
Star Chart (4K):
  panel / bar chrome background (modal)   #0F1620   rgb(15,22,32)
  secondary chrome                        #10101A   #0D141E
  gold label, glyph core                  #B1A46D   rgb(177,164,109)
  gold label, antialias peak              #EADDBB   #EBD3A3   #E1D3A6
  background nebula, darkest              #041213
  background nebula, mid                  #172A2E
Nightwave panel (720p):
  card background (modal)                 #13111C   #15141C
  gutter between cards                    #18171F
  gold stroke peak                        #D7C593   #D6C692
```

**The single most important forensic finding:** Warframe's gold is **not** `#FFD700` and not orange.
Converted from the sampled `#B1A46D` it is **`hsl(48.5, 30%, 56%)`** — a *desaturated khaki/parchment*.
Its highlight `#EADDBB` is **`hsl(43, 53%, 83%)`**. Saturation stays under ~55% even at peak. Anyone who
reaches for a saturated gold will produce something that reads as Destiny or Diablo, not Warframe.

The chrome is **not** neutral black either — it is a near-black with a blue/indigo cast, `#0F1620`
(hsl 213, 36%, 9%) on the star chart and `#13111C` (hsl 253, 13%, 9%) on card surfaces. Roughly 8–10%
lightness, 13–36% saturation, hue drifting between indigo and slate blue depending on screen.

```css
/* Paste-ready tokens, derived from the samples above. */
:root {
  --wf-gold:        #b1a46d;  /* glyph / stroke core            hsl(48,30%,56%) */
  --wf-gold-hi:     #eaddbb;  /* highlight, hover, focus ring   hsl(43,53%,83%) */
  --wf-gold-lo:     #6b6242;  /* disabled / 60% of core                          */
  --wf-chrome:      #0f1620;  /* panel + bar background                          */
  --wf-chrome-card: #13111c;  /* card surface                                    */
  --wf-chrome-edge: #18171f;  /* 1px separators, gutters                         */
  --wf-void:        #041213;  /* deepest background                              */
  --wf-nebula:      #172a2e;  /* background mid                                  */
  --wf-text:        #d6d2c6;  /* body text (off-white, warm)          [I]        */
}
```

### Structural observations from the screenshots [V]

- **Star chart:** the whole screen is a *photographic* backdrop (nebula + a giant Warframe silhouette,
  centre-anchored, with a hot bloom point at its lap). All UI chrome is pushed to the four corners as
  thin horizontal bars. There is a full-width and full-height **hairline crosshair** through the exact
  centre of the screen — a 1px extremely low-alpha line, plus concentric elliptical orbit rings drawn
  as ~1px dashed strokes at maybe 4–6% opacity.
- **Planet labels** are widely letterspaced small-caps, near-white, with *no* box behind them — legibility
  comes purely from a soft shadow. Estimated tracking: **0.25–0.35em**. [I]
- **Bottom-right action row** ("RESOURCE DRONES / CHANGE LOADOUT / EXIT") is gold small-caps on a
  translucent dark bar, separated by 1px vertical rules, no button fills at rest.
- **Top-left corner** shows three small icon tiles each with a **gold underline bar** beneath — the
  underline, not a fill or an outline, is the state indicator.
- **Nightwave panel:** a grid of cards on `#13111C` with ~1px `#18171F` gutters; each card holds
  gold *line-art* iconography (stroke, never fill), a small currency glyph, and a number. The
  progress bar under REWARD TIERS is a flat gold fill on a near-black track — no gradient, no rounding
  visible at this resolution. Scrollbar is a thin vertical gold rounded bar.
- **No visible rounded corners anywhere on chrome.** Corners are square or cut. This matters: `border-radius`
  above ~2px immediately reads as "generic web dashboard".

### Other verified facts

- Themes ship **with sounds**: the wiki's settings page lists "Customize UI Theme (themes, backgrounds,
  **sounds**)" [V] — `https://wiki.warframe.com/index.php?title=Settings/Interface&action=raw`.
  So UI audio is part of the game's identity, not an add-on. Relevant to §3.5.
- 20 themes / 15 backgrounds exist (Orokin, Corpus, Grineer, Tenno, Lotus, Vitruvian, Stalker, Nidus,
  Equinox, Fortuna, Deadlock, Conquera, Drippy, Pom-2, Legacy, High Contrast, Baruuk, Dark Lotus,
  Lunar Renewal, Zephyr Harrier) [V] —
  `https://wiki.warframe.com/index.php?title=Settings/Interface/Backgrounds_and_Themes&action=raw`.
  Each theme "has its own color profile that is used to customise the login page, user interface/menu
  and HUD" [V]. **Design implication: our whole palette must live in CSS custom properties on `:root`
  and be swappable at runtime, because the game itself works that way.**

---

## §1. How Warframe's UI moves

### 1.0 The one hard datum about timing [V]

Two long-running Warframe forum threads exist specifically asking DE to *speed the menus up*:

- "Menu UI animated transitions are really slow. Can we get a setting to speed them up?"
  `https://forums.warframe.com/topic/1124825-...`
- "I would like an option to disable menu transitions."
  `https://forums.warframe.com/topic/1259611-...`

(Thread titles verified via search index; the forum returns HTTP 403 to WebFetch so I could not read
the bodies.)

**This is the most actionable timing evidence available.** The game's own transitions are long enough
that a meaningful part of the playerbase finds them obstructive. For an *overlay* — which the player
opens mid-mission, reads for two seconds, and dismisses — copying that pacing would be a design bug.

> **Rule: match Warframe's transition *shape*, halve its *duration*.**
> Steal the character (a slide with a settle, a light sweep, a stagger), reject the languor.

### 1.1 The motion vocabulary [I, from screenshot structure + general observation]

Warframe's menus have five recognisable moves. My reading of what each *is*:

1. **Slide-and-settle panel entrance.** Panels arrive from an edge, overshoot very slightly, settle.
   Not a bounce — a single soft overshoot, like mass on a stiff damper.
2. **Wipe reveal.** Content is revealed by a moving boundary rather than by fading. The boundary is
   often lit — a bright line travels ahead of the content.
3. **Staggered list cascade.** Rows do not appear together; they cascade with a short per-item delay,
   usually top-to-bottom, each row translating a few px and fading in.
4. **Underline / bracket selection.** Selection is expressed as a gold underline or a pair of corner
   brackets that *slide* from the previous item to the new one, rather than fading in place. [V — the
   underline mechanism is visible in the star chart's top-left tiles.]
5. **Diegetic camera moves.** The star chart is a 3D scene; entering it is a camera dolly, not a
   2D transition. Zoom into a planet, the whole field parallaxes.

### 1.2 `motion` v13 configs — a complete transition set

Verified against `https://motion.dev/docs/react-transitions` [V]: `type: "spring"` accepts
`stiffness`, `damping`, `mass`, `bounce`, `duration`, `visualDuration`; `type: "tween"` accepts
`duration` and `ease` (named keyword, cubic-bezier array `[a,b,c,d]`, or a function). Named eases:
`linear, easeIn, easeOut, easeInOut, circIn/Out/InOut, backIn/Out/InOut, anticipate`.

`motion` is at **13.1.1** [V] (`https://registry.npmjs.org/motion/latest`). Import from `motion/react`.

```ts
// src/motion/wf.ts — the whole motion language in one file.
import type { Transition, Variants } from "motion/react";

/* ---- Curves ------------------------------------------------------------ */
/* Warframe's ease reads as a strong front-load with a long tail: things leave
   fast and arrive slowly. That is circOut territory, not easeOut.            */
export const EASE_ENTER = [0.16, 1, 0.3, 1] as const;   // expo-out. Arrivals.
export const EASE_EXIT  = [0.7, 0, 0.84, 0] as const;   // circ-in. Departures.
export const EASE_SWEEP = [0.83, 0, 0.17, 1] as const;  // circ-inOut. Light sweeps.
export const EASE_MECH  = [0.65, 0, 0.35, 1] as const;  // mechanical, symmetric.

/* ---- Durations (ms). Halved-Warframe. ---------------------------------- */
export const D = {
  micro:   90,   // hover tint, icon tick
  fast:   180,   // button press, underline slide
  base:   260,   // panel enter, tab change
  slow:   420,   // full-screen route change
  epic:   900,   // star-chart dolly, materialise sequence
} as const;

/* ---- Springs ----------------------------------------------------------- */
/* Prefer visualDuration+bounce over stiffness/damping: it decouples "how long
   it looks like it takes" from "how much it overshoots", which is exactly the
   two knobs a designer wants. (motion >= 11)                                */
export const SPRING_PANEL:  Transition = { type: "spring", visualDuration: 0.26, bounce: 0.12 };
export const SPRING_SNAP:   Transition = { type: "spring", visualDuration: 0.16, bounce: 0.00 };
export const SPRING_METER:  Transition = { type: "spring", stiffness: 170, damping: 26, mass: 1.1 };
export const SPRING_NEEDLE: Transition = { type: "spring", stiffness: 420, damping: 18, mass: 0.6 };
// SPRING_NEEDLE deliberately underdamped (zeta ~0.57) — a real gauge needle overshoots.

/* ---- Variants ---------------------------------------------------------- */
export const panelIn: Variants = {
  hidden:  { opacity: 0, x: -24, filter: "brightness(2.2)" },
  visible: { opacity: 1, x: 0,  filter: "brightness(1)",
             transition: { ...SPRING_PANEL, filter: { duration: D.slow / 1000, ease: EASE_ENTER } } },
  exit:    { opacity: 0, x: -12,
             transition: { duration: D.fast / 1000, ease: EASE_EXIT } },
};
// The brightness ramp is the cheap version of "arrives hot, cools down" — it is
// what sells Warframe's entrances more than the translation does.

export const listStagger: Variants = {
  visible: { transition: { staggerChildren: 0.035, delayChildren: 0.06 } },
  exit:    { transition: { staggerChildren: 0.012, staggerDirection: -1 } },
};
export const listRow: Variants = {
  hidden:  { opacity: 0, x: -14, scaleX: 0.985 },
  visible: { opacity: 1, x: 0, scaleX: 1, transition: SPRING_PANEL },
  exit:    { opacity: 0, x: -6, transition: { duration: 0.11, ease: EASE_EXIT } },
};
```

**Stagger arithmetic that matters.** `staggerChildren: 0.035` over a 14-row list is 490ms of cascade
on top of each row's own 260ms — the last row finishes at ~750ms. That is already at the edge of
"slow menu". **Cap the total: `stagger = min(0.035, 0.30 / n)`.** Compute it, do not hardcode it.

```tsx
const stagger = Math.min(0.035, 0.30 / Math.max(rows.length, 1));
<motion.ul variants={{ visible: { transition: { staggerChildren: stagger } } }} …>
```

### 1.3 Hover / selection feedback

Warframe's rest state is *unfilled*. Buttons at rest are text only; the affordance appears on hover.

```tsx
<motion.button
  className="wf-btn"
  initial={false}
  whileHover={{ color: "var(--wf-gold-hi)" }}
  whileTap={{ scale: 0.985 }}
  transition={{ duration: D.micro / 1000, ease: "easeOut" }}
/>
```

```css
/* The gold underline that grows from the left. Transform-only: free. */
.wf-btn { position: relative; color: var(--wf-gold); letter-spacing: .12em;
          text-transform: uppercase; background: none; border: 0; }
.wf-btn::after {
  content: ""; position: absolute; inset: auto 0 -2px 0; height: 1px;
  background: var(--wf-gold-hi);
  transform: scaleX(0); transform-origin: left;
  transition: transform 180ms cubic-bezier(.16,1,.3,1);
}
.wf-btn:hover::after, .wf-btn:focus-visible::after { transform: scaleX(1); }
```

**Shared selection indicator — the single highest-value 6 lines in this document.** The gold underline
must *travel* between tabs, not cross-fade. `motion`'s `layoutId` does this for free and it is the
move that most reads as "this was made by the same people who made the game".

```tsx
{tabs.map(t => (
  <button key={t.id} onClick={() => setActive(t.id)} className="relative px-4 py-2">
    {t.label}
    {active === t.id && (
      <motion.span
        layoutId="wf-tab-underline"
        className="absolute inset-x-0 -bottom-px h-px bg-[var(--wf-gold-hi)]"
        transition={{ type: "spring", visualDuration: 0.22, bounce: 0.18 }}
      />
    )}
  </button>
))}
```

### 1.4 Loading spinner

Warframe does not use a smooth CSS spinner; its loaders read as *segmented and mechanical*. Reproduce
with a `steps()` rotation on a dashed ring — 24 steps at 1.2s gives a 20fps mechanical tick that costs
nothing (single composited transform).

```css
@keyframes wf-tick { to { transform: rotate(360deg); } }
.wf-spinner {
  width: 28px; aspect-ratio: 1; border-radius: 50%;
  border: 1px solid transparent;
  border-top-color: var(--wf-gold-hi);
  border-right-color: color-mix(in oklab, var(--wf-gold) 40%, transparent);
  animation: wf-tick 1.2s steps(24, end) infinite;
  will-change: transform;
}
```

### 1.5 The star-chart transition

In game this is a **camera dolly through a 3D scene**, so a 2D fade will always feel wrong. The cheap
honest equivalent in a browser is a **scale + blur + brightness triad on the outgoing layer**, with the
incoming layer arriving from a *different Z*:

```tsx
<AnimatePresence mode="popLayout">
  <motion.div key={route} style={{ transformPerspective: 1200 }}
    initial={{ opacity: 0, scale: 1.06, z: -120, filter: "blur(6px) brightness(1.8)" }}
    animate={{ opacity: 1, scale: 1,    z: 0,    filter: "blur(0px) brightness(1)" }}
    exit={   { opacity: 0, scale: 0.97, z:  60,  filter: "blur(4px) brightness(0.6)" }}
    transition={{ duration: D.slow / 1000, ease: EASE_ENTER }} />
</AnimatePresence>
```

⚠️ **`filter: blur()` animated across a full-screen element is the single most expensive thing in this
document.** It is acceptable *only* here, *only* for ≤420ms, and *only* once per navigation. See §4.
On the low-performance tier, drop the blur term entirely and keep scale+opacity.

---

## §2. Signature effects, each with an implementable technique

### 2.1 Holographic scan-line / interlace

Two separate things, usually conflated:

**(a) Static interlace** — a fixed 2px stripe pattern. Do *not* animate it; a scrolling stripe pattern
at 1–2px pitch aliases horribly and looks like a broken monitor.

```css
.wf-interlace::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    rgba(234,221,187,.045) 0px, rgba(234,221,187,.045) 1px,
    transparent 1px,          transparent 3px);
  mix-blend-mode: screen;
}
/* On HiDPI, express the pitch in device pixels or it disappears: */
@media (min-resolution: 1.5dppx) { .wf-interlace::before { background-size: 100% 4px; } }
```

**(b) The travelling sweep** — one soft bright band crossing the panel every few seconds. This is the
part that sells "hologram". Animate `transform: translateY` on a single tall gradient element, never
`background-position`.

```css
.wf-sweep { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.wf-sweep::after {
  content: ""; position: absolute; left: 0; right: 0; height: 34%; top: -34%;
  background: linear-gradient(to bottom,
    transparent, rgba(234,221,187,.10) 45%, rgba(234,221,187,.16) 50%,
    rgba(234,221,187,.10) 55%, transparent);
  animation: wf-sweep 5.5s cubic-bezier(.83,0,.17,1) infinite;
  will-change: transform;
}
@keyframes wf-sweep { 0%,70% { transform: translateY(0); } 100% { transform: translateY(400%); } }
```

**Cost:** one extra composited layer per panel, zero per-frame JS. Safe. Keep the sweep to ≤2
simultaneously visible panels; 12 panels each with their own layer is 12 layers to composite.

### 2.2 Energy flowing along a panel edge

Three implementations, in ascending cost. **Use (a).**

**(a) Conic-gradient border via `@property` — GPU-interpolated, one element, no JS.** [Best]

```css
@property --wf-a { syntax: "<angle>"; inherits: false; initial-value: 0deg; }

.wf-energy-edge {
  position: relative;
  background: var(--wf-chrome-card);
}
.wf-energy-edge::before {
  content: ""; position: absolute; inset: -1px; z-index: -1;
  background: conic-gradient(from var(--wf-a),
    transparent 0deg, transparent 300deg,
    var(--wf-gold) 340deg, var(--wf-gold-hi) 352deg, var(--wf-gold) 358deg, transparent 360deg);
  animation: wf-orbit 4s linear infinite;
}
@keyframes wf-orbit { to { --wf-a: 360deg; } }
```

Registering `--wf-a` with `@property` is what makes the angle *interpolatable* — without it the
animation snaps. Chromium supports this; Overwolf's CEF is Chromium, so it is available. The
gradient is repainted each frame but only within the element's own box, so keep the element small
(a 320×90 card is fine; a 1600×900 panel is not).

**(b) SVG stroke dash — for a non-rectangular / notched Orokin outline.** Exact control of the path.

```tsx
<svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
  <path d="M0,6 L6,0 L94,0 L100,6 L100,94 L94,100 L6,100 L0,94 Z"
        pathLength={1} fill="none" vectorEffect="non-scaling-stroke"
        stroke="var(--wf-gold-hi)" strokeWidth={1}
        strokeDasharray="0.14 0.86" strokeLinecap="round"
        style={{ animation: "wf-flow 3.2s linear infinite" }} />
</svg>
```
```css
@keyframes wf-flow { to { stroke-dashoffset: -1; } }
```

`pathLength={1}` normalises the path so dash values are fractions regardless of geometry — the
trick that makes this reusable across every panel shape. `vectorEffect="non-scaling-stroke"` keeps
the 1px hairline 1px under `preserveAspectRatio="none"` distortion.

**(c) Canvas.** Only if you need >30 simultaneously flowing edges — then batch them all into one
canvas rather than 30 DOM layers.

### 2.3 The "materialise" effect — UI assembling from fragments

**(a) Mask-threshold dissolve — 1 element, GPU, the best cost/impact ratio in this document.**

Bake a 256×256 blue-noise PNG once (or generate it at build time). Animate a `mask-image` whose
gradient hard-edge sweeps through the noise's luminance range: pixels cross the threshold at
noise-ordered times, so the panel appears to precipitate out of static rather than wipe.

```css
@property --wf-t { syntax: "<percentage>"; inherits: false; initial-value: 0%; }

.wf-materialise {
  --wf-t: 0%;
  -webkit-mask-image: url(/noise-256.png), linear-gradient(#000 0 0);
  mask-image: url(/noise-256.png), linear-gradient(#000 0 0);
  mask-size: 256px 256px, 100% 100%;
  mask-composite: intersect;
  /* the actual reveal: luminance threshold marching through the noise */
  filter: url(#wf-threshold);
  animation: wf-mat 700ms cubic-bezier(.16,1,.3,1) both;
}
@keyframes wf-mat { from { --wf-t: 0%; opacity: 0; } to { --wf-t: 100%; opacity: 1; } }
```

If `mask-composite` gets fiddly, the simpler and near-identical-looking version is a **single
`mask-image: linear-gradient` with a very short soft edge, translated across**:

```css
.wf-materialise-lite {
  mask-image: linear-gradient(105deg, #000 0 35%, rgba(0,0,0,.35) 45%, transparent 55%);
  mask-size: 300% 100%;
  animation: wf-matlite 620ms cubic-bezier(.16,1,.3,1) both;
}
@keyframes wf-matlite { from { mask-position: 100% 0; } to { mask-position: 0 0; } }
```
`mask-position` animation *is* a paint, but on a single element for 620ms once. Acceptable.

**(b) Shard assembly — for the hero moment only.** N absolutely-positioned divs, each a `clip-path`
polygon slice of the same background, each flying in from a jittered offset. `motion` handles the
choreography; 12–20 shards max.

```tsx
const SHARDS = 16;
const shard = (i: number) => {
  const y0 = (i / SHARDS) * 100, y1 = ((i + 1) / SHARDS) * 100;
  const skew = (i % 2 ? 4 : -4);                       // alternating diagonal cut
  return `polygon(0% ${y0}%, 100% ${y0 + skew}%, 100% ${y1 + skew}%, 0% ${y1}%)`;
};

{Array.from({ length: SHARDS }, (_, i) => (
  <motion.div key={i} aria-hidden
    className="absolute inset-0 bg-[var(--wf-chrome-card)]"
    style={{ clipPath: shard(i) }}
    initial={{ x: (i % 2 ? 1 : -1) * (40 + (i * 7) % 30), opacity: 0, filter: "brightness(3)" }}
    animate={{ x: 0, opacity: 1, filter: "brightness(1)" }}
    transition={{ duration: 0.5, delay: i * 0.018, ease: [0.16, 1, 0.3, 1] }} />
))}
```

⚠️ `clipPath` is set **statically** and only `x/opacity/filter` animate. Never animate `clip-path`
itself across many elements — it forces a repaint per element per frame.

### 2.4 Convincing bloom, cheaply

Real bloom = threshold → downsample → blur → additive composite. In a browser you have three tiers:

**Tier 1 — layered shadows (free, no filter, no extra layer).** For text and thin strokes this is
genuinely convincing because bloom on a thin bright line *is* just a few nested falloffs.

```css
.wf-bloom-text {
  color: var(--wf-gold-hi);
  text-shadow:
    0 0 1px  rgba(234,221,187,.90),
    0 0 4px  rgba(234,221,187,.55),
    0 0 12px rgba(200,175,105,.30),
    0 0 34px rgba(200,175,105,.14);
}
```
Static `text-shadow` is painted once and cached in the layer. **Never animate the shadow radii** —
that reflows the paint every frame. To pulse it, animate `opacity` on a *duplicate* element instead.

**Tier 2 — duplicate + blur + screen (one extra layer, GPU).** The correct browser bloom.

```css
.wf-bloom-wrap { position: relative; isolation: isolate; }
.wf-bloom-wrap > .glow {           /* an exact copy of the content, aria-hidden */
  position: absolute; inset: 0;
  filter: blur(10px) saturate(1.6) brightness(1.5);
  mix-blend-mode: screen;
  pointer-events: none;
  opacity: .75;
}
```
Cost is proportional to **blurred area × radius**. Budget: **≤2 such layers on screen, each ≤400×400
CSS px, radius ≤12px.** Animate only its `opacity`/`transform`, never its `blur()` radius.

**Tier 3 — canvas additive bloom (for the WebGL background, §3.1).** Render the emissive pass to a
half-resolution FBO, two-tap separable Gaussian, add back. In our case the background shader can just
*author* its own glow analytically (`pow(intensity, 3.0)` falloff) which costs one instruction instead
of three passes. **Do that.**

### 2.5 Chromatic aberration on edges

**(a) SVG filter — physically correct, per-channel offset. Define once, reference by `filter: url(#…)`.**

```html
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <filter id="wf-ca" x="-3%" y="-3%" width="106%" height="106%" color-interpolation-filters="sRGB">
    <feOffset in="SourceGraphic" dx="-1.1" dy="0" result="r"/>
    <feOffset in="SourceGraphic" dx="1.1"  dy="0" result="b"/>
    <feColorMatrix in="r" result="rc" type="matrix"
      values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/>
    <feColorMatrix in="b" result="bc" type="matrix"
      values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"/>
    <feColorMatrix in="SourceGraphic" result="gc" type="matrix"
      values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"/>
    <feBlend in="rc" in2="gc" mode="screen" result="rg"/>
    <feBlend in="rg" in2="bc" mode="screen"/>
  </filter>
</svg>
```

⚠️ **SVG filters in Chromium are frequently rasterised off the fast path.** Apply this to **small,
static** elements (an icon, a heading, a badge) — never to a scrolling list, never to a full panel,
and never animate any of its attributes.

**(b) The cheap version — three offset text layers, pure compositing, animatable.** Prefer this when
the element moves.

```css
.wf-ca { position: relative; color: var(--wf-text); }
.wf-ca::before, .wf-ca::after {
  content: attr(data-text); position: absolute; inset: 0;
  mix-blend-mode: screen; pointer-events: none;
}
.wf-ca::before { color: #ff2a2a; transform: translateX(-1px); }
.wf-ca::after  { color: #2ad6ff; transform: translateX(1px); }
```
Then aberration-on-motion is `translateX` on the pseudo-elements — pure transform, free.

### 2.6 Particle drift in the background

**Canvas 2D, one canvas, fixed pool, no allocation in the loop.** Do not use a particle library and
do not use DOM elements.

```ts
// src/fx/drift.ts — ~40 lines, no dependency.
export function startDrift(cv: HTMLCanvasElement, count = 90) {
  const g = cv.getContext("2d", { alpha: true, desynchronized: true })!;
  const dpr = Math.min(devicePixelRatio, 1.5);           // cap DPR: 4K is not worth 4x fill
  let w = 0, h = 0, raf = 0, last = performance.now();
  const p = new Float32Array(count * 5);                  // x,y,vx,vy,life — one flat buffer

  const resize = () => {
    w = cv.clientWidth; h = cv.clientHeight;
    cv.width = (w * dpr) | 0; cv.height = (h * dpr) | 0;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const seed = (i: number, fresh = false) => {
    const o = i * 5;
    p[o] = Math.random() * w;
    p[o + 1] = fresh ? h + 8 : Math.random() * h;
    p[o + 2] = (Math.random() - 0.5) * 0.06;              // px/ms
    p[o + 3] = -(0.008 + Math.random() * 0.022);
    p[o + 4] = 0.25 + Math.random() * 0.75;               // brightness
  };
  resize(); for (let i = 0; i < count; i++) seed(i);

  const tick = (t: number) => {
    const dt = Math.min(t - last, 50); last = t;          // clamp: tab-switch spikes
    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = "lighter";               // additive == free bloom
    for (let i = 0; i < count; i++) {
      const o = i * 5;
      p[o] += p[o + 2] * dt; p[o + 1] += p[o + 3] * dt;
      if (p[o + 1] < -8) seed(i, true);
      const a = p[o + 4] * (0.35 + 0.65 * Math.sin((t * 0.0006) + i));
      g.fillStyle = `rgba(234,221,187,${(a * 0.30).toFixed(3)})`;
      g.fillRect(p[o] | 0, p[o + 1] | 0, 1, 1);           // 1px rects, not arcs: ~8x cheaper
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const ro = new ResizeObserver(resize); ro.observe(cv);
  return () => { cancelAnimationFrame(raf); ro.disconnect(); };
}
```

`fillRect(x|0, y|0, 1, 1)` instead of `arc()` is the whole performance story: 90 arcs/frame is
measurable, 90 integer-aligned 1px rects is not. `globalCompositeOperation = "lighter"` gives
additive accumulation, which is bloom for free where particles overlap.

**Cost:** ~0.15–0.35ms/frame at 90 particles, 1080p, DPR-capped. Safe. At 500 particles you need
WebGL point sprites instead — but 500 particles in an overlay is noise, not design.

### 2.7 Glitch / datamosh flicker (Void, Murmur, Zariman)

**The rule that makes glitch not-annoying: it must be rare and short.** A continuously glitching
element is a bug; an element that glitches for 140ms every 6–14s is characterisation.

```css
@keyframes wf-glitch {
  0%,100% { clip-path: inset(0 0 0 0);        transform: translate3d(0,0,0); }
  12%     { clip-path: inset(18% 0 62% 0);    transform: translate3d(-3px,0,0); }
  24%     { clip-path: inset(0 0 0 0);        transform: translate3d(0,0,0); }
  38%     { clip-path: inset(70% 0 12% 0);    transform: translate3d(4px,0,0); }
  46%     { clip-path: inset(0 0 0 0);        transform: translate3d(0,0,0); }
  61%     { clip-path: inset(41% 0 44% 0);    transform: translate3d(-2px,0,0); }
  70%     { clip-path: inset(0 0 0 0);        transform: translate3d(0,0,0); }
}
.wf-glitching { animation: wf-glitch 140ms steps(1, end) 2; }
```

`steps(1, end)` is essential — glitch must *jump*, not interpolate. Drive it from JS on a jittered
timer, and stack it with §2.5(b) chromatic aberration for the datamosh read:

```ts
export function scheduleGlitch(el: HTMLElement, minMs = 6000, maxMs = 14000) {
  let id: number;
  const fire = () => {
    el.classList.add("wf-glitching");
    setTimeout(() => el.classList.remove("wf-glitching"), 300);
    id = window.setTimeout(fire, minMs + Math.random() * (maxMs - minMs));
  };
  id = window.setTimeout(fire, minMs + Math.random() * (maxMs - minMs));
  return () => clearTimeout(id);
}
```

⚠️ Gate all of this behind `@media (prefers-reduced-motion: reduce)` — flicker is a genuine
accessibility hazard, not a taste question.

```css
@media (prefers-reduced-motion: reduce) {
  .wf-glitching, .wf-sweep::after, .wf-spinner { animation: none !important; }
}
```

---

## §3. Going way overboard — the escalation

### 3.1 WebGL background — library recommendation and a starter shader

**Recommendation: raw WebGL2, no library.** A single fullscreen-quad fragment shader needs ~55 lines
of setup that never changes. Reasons:

| Option | Verdict |
|---|---|
| **raw WebGL2** | **Use this.** 0 KB. One quad, one program, three uniforms. Nothing three.js gives you applies to a fullscreen shader. |
| `ogl` **1.0.11** [V] (`https://registry.npmjs.org/ogl/latest`, "WebGL Library") | Reasonable fallback (~12 KB gz) **if** you later need render targets / multi-pass. Not needed for one pass. |
| `three` | No. 600 KB+ for zero benefit here. In an overlay that must stay under a few MB and start instantly, this is indefensible. |
| CSS Houdini Paint Worklet | No. Paint worklets run on the **main thread** and repaint per frame — the exact opposite of what an overlay needs. Fine for a static generated texture, wrong for animation. |

```ts
// src/fx/orokinBg.ts
const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2  uRes;
uniform float uT;
uniform vec3  uGold;    // #b1a46d -> vec3(0.694,0.643,0.427)
uniform vec3  uVoid;    // #041213 -> vec3(0.016,0.071,0.075)

float h(vec2 v){ return fract(sin(dot(v, vec2(127.1,311.7))) * 43758.5453); }
float n(vec2 v){
  vec2 i = floor(v), f = fract(v);
  f = f*f*(3.0-2.0*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x),
             mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 v){
  float s = 0.0, a = 0.5;
  mat2 R = mat2(0.80, 0.60, -0.60, 0.80);   // rotate each octave: kills axis-aligned banding
  for(int i = 0; i < 5; i++){ s += a * n(v); v = R * v * 2.02; a *= 0.5; }
  return s;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / uRes.y;   // aspect-correct, centre origin
  float t  = uT * 0.035;

  /* --- domain warp: the difference between "noise" and "nebula" ---------- */
  vec2 q = vec2(fbm(uv*1.6 + vec2(0.0, t)), fbm(uv*1.6 + vec2(5.2, 1.3 - t)));
  vec2 r = vec2(fbm(uv*1.6 + 3.4*q + vec2(1.7, 9.2) + 0.15*t),
                fbm(uv*1.6 + 3.4*q + vec2(8.3, 2.8) - 0.13*t));
  float f = fbm(uv*1.6 + 3.6*r);

  /* --- Orokin ramp: void -> teal -> parchment gold, never saturated ------ */
  vec3 col = mix(uVoid, vec3(0.090,0.165,0.180), smoothstep(0.30, 0.72, f));
  col = mix(col, uGold * 0.85, smoothstep(0.66, 0.94, f) * 0.55);

  /* --- concentric Orokin rings, breathing --------------------------------- */
  float rad  = length(uv);
  float ring = sin(rad * 46.0 - uT * 0.55);
  col += uGold * pow(max(ring, 0.0), 34.0) * 0.16 * smoothstep(1.05, 0.22, rad);

  /* --- a slow radial sweep, like a scanning beacon ------------------------ */
  float ang = atan(uv.y, uv.x);
  float sweep = pow(max(0.0, cos(ang - uT*0.22)), 26.0);
  col += uGold * sweep * 0.10 * smoothstep(1.10, 0.10, rad);

  /* --- analytic bloom: cube the emissive term. one instruction, no pass --- */
  col += uGold * pow(smoothstep(0.80, 1.0, f), 3.0) * 0.30;

  col *= smoothstep(1.45, 0.30, rad);                          // vignette
  col += (h(gl_FragCoord.xy + uT) - 0.5) * 0.014;              // dither: kills banding
  o = vec4(col, 1.0);
}`;

export function startOrokinBg(cv: HTMLCanvasElement, scale = 0.5) {
  const gl = cv.getContext("webgl2", { alpha: false, antialias: false,
                                       powerPreference: "low-power" })!;
  const sh = (t: number, s: string) => {
    const x = gl.createShader(t)!; gl.shaderSource(x, s); gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)!);
    return x;
  };
  const pr = gl.createProgram()!;
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(pr); gl.useProgram(pr);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  // one oversized triangle, not two triangles: no diagonal seam, 2 fewer verts

  const uRes = gl.getUniformLocation(pr, "uRes"), uT = gl.getUniformLocation(pr, "uT");
  gl.uniform3f(gl.getUniformLocation(pr, "uGold"), 0.694, 0.643, 0.427);
  gl.uniform3f(gl.getUniformLocation(pr, "uVoid"), 0.016, 0.071, 0.075);

  let raf = 0, running = true;
  const resize = () => {
    cv.width  = Math.max(2, (cv.clientWidth  * scale) | 0);   // HALF RES. See §4.
    cv.height = Math.max(2, (cv.clientHeight * scale) | 0);
    gl.viewport(0, 0, cv.width, cv.height);
    gl.uniform2f(uRes, cv.width, cv.height);
  };
  resize();
  const t0 = performance.now();
  const loop = () => {
    if (!running) return;
    gl.uniform1f(uT, (performance.now() - t0) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(loop);
  };
  loop();
  const ro = new ResizeObserver(resize); ro.observe(cv);
  return {
    stop() { running = false; cancelAnimationFrame(raf); ro.disconnect();
             gl.getExtension("WEBGL_lose_context")?.loseContext(); },
    pause(v: boolean) { if (running === !v) return; running = !v; if (running) loop(); },
  };
}
```

```css
/* Half-res canvas upscaled by CSS. A nebula has no high-frequency detail, so
   the bilinear upscale is invisible — and you just saved 75% of the fill rate. */
canvas.wf-bg { width: 100%; height: 100%; display: block; image-rendering: auto; }
```

**Why half-res is non-negotiable:** this shader is ~5 octaves × 5 fbm calls = ~25 noise evaluations
per pixel. At 2560×1440 that is 92M noise evals/frame. At 0.5 scale it is 23M. On an integrated GPU
that is the difference between "background" and "the reason your game stutters".

### 3.2 Volumetric / parallax panel depth on pointer move

Three rules: (1) read the pointer in a passive listener, (2) write only CSS custom properties,
(3) let CSS do the transform. Never `setState` on pointermove.

```tsx
export function useTilt<T extends HTMLElement>(max = 7) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let raf = 0, tx = 0, ty = 0, cx = 0, cy = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width  - 0.5) * 2;
      ty = ((e.clientY - r.top)  / r.height - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(step);
    };
    const step = () => {
      cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12;    // critically-damped-ish lerp
      el.style.setProperty("--tx", cx.toFixed(4));
      el.style.setProperty("--ty", cy.toFixed(4));
      raf = (Math.abs(tx - cx) + Math.abs(ty - cy) > 0.001)
        ? requestAnimationFrame(step) : 0;               // self-terminating: 0 idle cost
    };
    const onLeave = () => { tx = ty = 0; if (!raf) raf = requestAnimationFrame(step); };
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave, { passive: true });
    return () => { cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave); };
  }, []);
  return ref;
}
```

```css
.wf-deep { perspective: 900px; transform-style: preserve-3d; }
.wf-deep > * {
  transform: rotateY(calc(var(--tx, 0) * 7deg)) rotateX(calc(var(--ty, 0) * -7deg));
}
/* Layers at different depths -> real parallax, one transform each. */
.wf-deep .l-back  { transform: translateZ(-40px) scale(1.09) rotateY(calc(var(--tx,0)* 7deg)); }
.wf-deep .l-mid   { transform: translateZ(  0px)             rotateY(calc(var(--tx,0)* 7deg)); }
.wf-deep .l-front { transform: translateZ( 34px) scale(.96)  rotateY(calc(var(--tx,0)* 7deg)); }
/* Specular sheen that tracks the pointer — sells "glass" more than the tilt does. */
.wf-deep::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(
    600px circle at calc(50% + var(--tx,0)*45%) calc(50% + var(--ty,0)*45%),
    rgba(234,221,187,.13), transparent 60%);
  mix-blend-mode: screen;
}
```

⚠️ The `::after` radial gradient repaints as the pointer moves. It is one element; that is fine.
Do **not** put one on every card in a 30-card grid — put it only on the hovered card.

### 3.3 Animated SVG filigree that draws itself

`pathLength={1}` normalises every path so one stagger formula works for all of them, regardless of
how long each path actually is.

```tsx
const draw = {
  hidden:  { pathLength: 0, opacity: 0 },
  visible: (i: number) => ({
    pathLength: 1, opacity: 1,
    transition: {
      pathLength: { delay: i * 0.09, duration: 1.1, ease: [0.16, 1, 0.3, 1] },
      opacity:    { delay: i * 0.09, duration: 0.12 },
    },
  }),
};

<motion.svg viewBox="0 0 200 200" initial="hidden" animate="visible" className="wf-filigree">
  {FILIGREE_PATHS.map((d, i) => (
    <motion.path key={i} d={d} custom={i} variants={draw}
      pathLength={1} fill="none"
      stroke="var(--wf-gold)" strokeWidth={1.1}
      strokeLinecap="round" vectorEffect="non-scaling-stroke" />
  ))}
</motion.svg>
```

`motion` animates `pathLength` by writing `stroke-dasharray`/`stroke-dashoffset` — which are
**paint-only**, not layout. Cost is proportional to stroke area. Keep filigree to ≤ 40 paths and
≤ 2 simultaneously-drawing SVGs. For the glow, put a **static** `drop-shadow` on the whole `<svg>`
(one filter for the whole tree) rather than per-path.

```css
.wf-filigree { filter: drop-shadow(0 0 3px rgba(234,221,187,.45)); }  /* static only */
```

### 3.4 Counters, progress rings, radial meters with real physics

**Everything below runs on `MotionValue`s, which are updated outside React's render loop.** This is
the difference between a smooth 60fps counter and 60 React renders per second.

```tsx
import { useMotionValue, useTransform, useSpring, animate, motion } from "motion/react";

/* --- Counter: never re-renders React ---------------------------------- */
export function WfCounter({ to, digits = 0 }: { to: number; digits?: number }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, v => v.toLocaleString("en-US",
    { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  useEffect(() => {
    const c = animate(mv, to, { duration: 0.9, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [to]);
  return <motion.span className="tabular-nums">{text}</motion.span>;
}
```
⚠️ Use Tailwind's `tabular-nums` (`font-variant-numeric: tabular-nums`) or the counter will jitter
horizontally as glyph widths change — the classic tell of an amateur counter.

```tsx
/* --- Progress ring: spring-driven dashoffset --------------------------- */
export function WfRing({ value, size = 96, w = 3 }: { value: number; size?: number; w?: number }) {
  const r = (size - w) / 2, C = 2 * Math.PI * r;
  const spring = useSpring(0, { stiffness: 170, damping: 26, mass: 1.1 });
  useEffect(() => { spring.set(Math.max(0, Math.min(1, value))); }, [value]);
  const dash = useTransform(spring, v => `${v * C} ${C}`);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={w}
              stroke="var(--wf-chrome-edge)" />
      <motion.circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={w}
              stroke="var(--wf-gold-hi)" strokeLinecap="butt"
              style={{ strokeDasharray: dash }}
              filter="drop-shadow(0 0 4px rgba(234,221,187,.6))" />
    </svg>
  );
}
```

**Needle meters:** use `SPRING_NEEDLE` from §1.2 (`stiffness: 420, damping: 18, mass: 0.6`, damping
ratio ζ ≈ 0.57). Underdamped on purpose — a critically damped needle looks like a progress bar; a
real instrument overshoots and settles. This is exactly the kind of "physical" detail that pushes
past the game's own UI.

**Overshoot on completion:** when a bar fills, punch it. `useSpring` with `bounce` and a one-shot
brightness flash reads as impact:

```tsx
useEffect(() => {
  if (value < 1) return;
  animate(ringRef.current, { filter: ["brightness(1)", "brightness(2.6)", "brightness(1)"] },
          { duration: 0.45, times: [0, 0.12, 1], ease: "easeOut" });
}, [value]);
```

### 3.5 Sound design in an Overwolf overlay

**Feasible?** Yes — Overwolf overlay windows are Chromium windows; Web Audio works.
**Appropriate?** Warframe itself ships UI sounds as part of each theme [V, §0], so it is *in identity*.
But an overlay sits on top of a game whose own audio the player is listening to.

**The rules:**
1. **Default OFF.** Ship a visible toggle. An overlay that makes noise on first launch is uninstalled.
2. **Volume ceiling ~0.10 linear.** These are ticks, not events.
3. **Only on user-initiated actions** (click, tab change, panel open). Never on data arriving,
   never on timers, never ambient.
4. **Never duck or capture the game's audio.**

**Do not add a dependency.** UI ticks are synthesised in ~25 lines with Web Audio — zero assets, zero
network, zero bundle. (`howler` is at **2.2.4** [V], `https://registry.npmjs.org/howler/latest`, and is
the right call **only** if you decide to ship actual recorded sample files with sprite maps. For clicks,
it is 30 KB to do what an oscillator does for free.)

```ts
// src/fx/ui-sound.ts
let ac: AudioContext | null = null;
const ctx = () => (ac ??= new AudioContext());

/** A short filtered click. hz ~ pitch, ms ~ length, gain <= 0.12. */
export function tick(hz = 1800, ms = 38, gain = 0.06) {
  const c = ctx(); if (c.state === "suspended") c.resume();
  const t = c.currentTime;
  const osc = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(hz, t);
  osc.frequency.exponentialRampToValueAtTime(hz * 0.55, t + ms / 1000);
  f.type = "bandpass"; f.frequency.value = hz; f.Q.value = 3.5;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);           // 4ms attack
  g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);     // exp decay
  osc.connect(f).connect(g).connect(c.destination);
  osc.start(t); osc.stop(t + ms / 1000 + 0.02);
}

export const sfx = {
  hover:   () => tick(2400, 22, 0.030),
  select:  () => tick(1500, 45, 0.070),
  open:    () => { tick(900, 70, 0.070); setTimeout(() => tick(1650, 40, 0.045), 55); },
  close:   () => { tick(1650, 40, 0.050); setTimeout(() => tick(760, 80, 0.060), 45); },
  error:   () => tick(220, 130, 0.080),
};
```

`AudioContext` cannot start before a user gesture — create it lazily inside the first click handler
(the `ctx()` accessor above does this) or every early call silently no-ops.

**What it adds:** the *open/close* pair is the one that matters. A descending two-tone on close and an
ascending one on open gives the overlay a sense of physical mechanism, which is precisely what
Warframe's own menus are trying to communicate. Ship those two and `select`; skip the rest.

---

## §4. Performance rules and a hard budget

The overlay composites over a game targeting 60–144 fps. **Any main-thread work we do is frame time
the game does not get** (the compositor and the game contend for the same GPU).

### The budget

| Resource | Hard ceiling | Notes |
|---|---|---|
| Main-thread JS per frame | **≤ 1.5 ms** | measured in the Performance panel, overlay visible + idle |
| GPU per frame (our contribution) | **≤ 1.5 ms** | half-res background is the whole reason this is achievable |
| Composited layers | **≤ 25** | check `Layers` panel; every `will-change`/`filter`/`mix-blend-mode` makes one |
| Simultaneous `filter: blur()` layers | **≤ 2**, each ≤ 400×400 CSS px, radius ≤ 12px | |
| `backdrop-filter` instances | **≤ 1 on screen, never animated** | most expensive CSS property that exists |
| Canvas particles | **≤ 120**, DPR capped at **1.5** | |
| WebGL contexts | **exactly 1**, render scale **0.5** | |
| Bundle (overlay window) | **≤ 400 KB gz** | which is why `three` is out |
| **Idle CPU when overlay hidden** | **0%. No rAF at all.** | non-negotiable |

### Per-technique cost table

| Technique | Cost | Verdict |
|---|---|---|
| §1.2–1.4 transform/opacity animations | ~free (compositor) | ✅ unlimited |
| §1.3 `layoutId` shared underline | one layout read per change | ✅ |
| §1.5 full-screen animated `blur()` | **high**, ~1–3 ms/frame | ⚠️ ≤420ms, once per nav, drop on low tier |
| §2.1a static interlace | free (painted once) | ✅ |
| §2.1b sweep (`translateY`) | free | ✅ ≤2 visible |
| §2.2a conic `@property` border | repaint of element box/frame | ✅ if element ≤ ~400×150 |
| §2.2b SVG dashoffset | paint of stroke area | ✅ |
| §2.3a mask threshold | one element, one-shot | ✅ |
| §2.3b 16 shards | 16 layers for 500ms | ⚠️ hero moments only |
| §2.4 T1 static text-shadow | free | ✅ |
| §2.4 T2 blur+screen dupe | ~0.3–0.8 ms per layer | ⚠️ ≤2 |
| §2.5a SVG chromatic filter | **can fall off the fast path** | ⚠️ small + static only |
| §2.5b 3-layer text CA | free | ✅ |
| §2.6 canvas drift, 90 pts | 0.15–0.35 ms | ✅ |
| §3.1 WebGL bg @ 0.5 scale | 0.4–1.2 ms GPU | ✅ (at 1.0 scale: 1.6–4.8 ms ❌) |
| §3.2 pointer tilt | ~0.05 ms while moving, 0 idle | ✅ |
| §3.3 filigree draw-on | paint, one-shot | ✅ ≤40 paths |
| §3.4 MotionValue counters/rings | ~0 React renders | ✅ |

### Must be canvas/GPU, never CSS

- **Anything with >50 independently moving elements.** 50 DOM nodes with transforms is 50 layers.
- **Any per-pixel effect over a large area** (nebula, noise field, plasma) — shader, half-res.
- **Additive accumulation** (overlapping glows summing) — `globalCompositeOperation: "lighter"` or GL
  blend. CSS `mix-blend-mode: screen` per element creates a layer per element.

### Never animate, in any circumstance

`width`, `height`, `top`, `left`, `right`, `bottom`, `margin`, `padding`, `font-size`, `border-width`
(layout — forces reflow of the subtree) · `box-shadow` radius/spread, `border-radius`,
`background-position` on a large element (paint every frame) · **any SVG filter attribute**, especially
`feTurbulence`'s `baseFrequency` and `feDisplacementMap`'s `scale` (CPU-rasterised; this is the classic
"why is my glitch effect 12fps" bug) · `backdrop-filter` anything · `filter: blur()` radius on more
than one element at a time.

**Animate instead:** `transform` (`translate3d/scale/rotate`), `opacity`, and registered
`@property` custom properties that feed into those two. That is the complete list.

### The non-negotiable lifecycle rule

```ts
// Overwolf: the overlay window is frequently hidden. Everything must stop.
overwolf.windows.onStateChanged.addListener(e => {
  const visible = e.window_state_ex === "normal" || e.window_state_ex === "maximized";
  bg.pause(!visible);           // §3.1
  driftStop.current?.(!visible);// §2.6
  document.documentElement.classList.toggle("wf-frozen", !visible);
});
document.addEventListener("visibilitychange", () =>
  document.documentElement.classList.toggle("wf-frozen", document.hidden));
```
```css
.wf-frozen *, .wf-frozen *::before, .wf-frozen *::after {
  animation-play-state: paused !important;
}
```

### Adaptive quality ladder

Measure, do not guess. Sample frame time for 90 frames on mount; drop a tier if the p95 exceeds 12ms.

```ts
export type Tier = "high" | "med" | "low";
export function probeTier(cb: (t: Tier) => void, frames = 90) {
  const d: number[] = []; let last = performance.now();
  const step = (t: number) => {
    d.push(t - last); last = t;
    if (d.length < frames) return requestAnimationFrame(step);
    d.sort((a, b) => a - b);
    const p95 = d[(frames * 0.95) | 0];
    cb(p95 < 12 ? "high" : p95 < 20 ? "med" : "low");
  };
  requestAnimationFrame(step);
}
```

| | high | med | low |
|---|---|---|---|
| WebGL background | 0.5 scale, 5 octaves | 0.35 scale, 3 octaves | **off** → static gradient + noise PNG |
| Particles | 120 | 60 | 0 |
| Bloom dupe layers | 2 | 1 | 0 (text-shadow only) |
| Route blur | yes | yes | no |
| Sweep / glitch | yes | sweep only | none |
| Filigree draw-on | yes | yes, 400ms | instant |

`prefers-reduced-motion: reduce` forces **low** regardless of measurement, plus disables glitch entirely.

---

## §5. Named packages, verified

| Package | Version | Verified at | Use |
|---|---|---|---|
| `motion` | **13.1.1** | `https://registry.npmjs.org/motion/latest` [V] | All React animation. Import `motion/react`. |
| `ogl` | **1.0.11** | `https://registry.npmjs.org/ogl/latest` [V] | *Optional*. Only if the background grows to multi-pass FBOs. Not needed today. |
| `howler` | **2.2.4** | `https://registry.npmjs.org/howler/latest` [V] | *Optional*. Only if you ship recorded audio sprites. §3.5's synth needs nothing. |

**Deliberately not recommended:** `three` (bundle size — 600 KB+ for one fullscreen quad),
`react-spring` (`motion` already covers it; two animation runtimes is two rAF loops),
`gsap` (licensing friction + overlaps `motion` entirely), `tsparticles` (40× the code of §2.6 for a
drifting dust field), `postprocessing` (needs three.js).

**Total new runtime dependencies required by this document: zero.** `motion` is already in the stack.

---

## §6. What is still unknown, and how to close it

1. **Real frame timings.** Everything in §1 is calibrated, not measured. To close it: capture the game
   at 60fps with OBS, step frame-by-frame in a video editor over (a) Escape-menu open, (b) Arsenal
   panel entrance, (c) tab switch, (d) star-chart entry. Count frames; divide by 60. One hour of work
   converts §1's `[I]` labels to `[V]`.
2. **Exact easing curves.** Not obtainable without frame data. Once you have (1), fit a cubic-bezier
   to the position-over-time curve of a single moving element.
3. **Per-theme palettes.** I sampled only the *default* theme from two official screenshots. The other
   19 themes each carry a different colour profile [V]. To close it: sample screenshots per theme and
   emit one CSS custom-property block per theme.
4. **Font.** Warframe's UI face is a proprietary DE typeface. Nothing I found identifies it. Closest
   free stand-ins by structure (geometric, wide-tracked, small-caps-friendly): `Michroma`,
   `Saira Condensed`, `Rajdhani`, `Chakra Petch`. **[G]** — verify by eye against §0's screenshots.
5. **ArtStation / Warframe forums both return HTTP 403 to automated fetches.** Any deeper dive into
   DE artist breakdowns needs a real browser session.
