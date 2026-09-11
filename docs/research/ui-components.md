# Component-Library Mining for a Warframe-Grade HUD

Research date: 2026-08-31. Target: Overwolf overlay, React 19 + TS + Tailwind v4 + `motion` v13, canvas for heavy visuals.

## How to read this document

Every entry is marked:

- **VERIFIED** — I fetched the actual source or the npm registry record this session. URL given.
- **INFERRED** — derived from source I did read, but the conclusion is mine.
- **GUESSED** — judgement call, no source.

**Policy: we do not install any of these libraries.** All six are copy-in registries (shadcn CLI writes the file into your repo). We take the *technique* and rebuild against our own tokens. The two exceptions where a real dependency is justified are named explicitly in §9 and §10.

### How I got the source (do this again when you need more)

Docs pages on all these sites are React SPAs and WebFetch summarisation returns "I cannot provide the source." **The shadcn registry JSON endpoints return the full file bodies** and are the reliable path:

| Library | Registry endpoint | Status |
|---|---|---|
| Magic UI | `https://magicui.design/r/{name}.json` | VERIFIED working |
| Aceternity | `https://ui.aceternity.com/registry/{name}.json` | VERIFIED working |
| KokonutUI | `https://kokonutui.com/r/{name}.json` | VERIFIED working |
| Bklit | `https://bklit.com/r/{name}.json` (`ui.bklit.com` 301s here) | VERIFIED working |
| scificn-ui | `https://www.scificn.dev/r/{name}.json` | VERIFIED working |
| React Bits | no registry JSON; use `https://raw.githubusercontent.com/DavidHDev/react-bits/main/src/content/{Category}/{Name}/{Name}.jsx` | VERIFIED working |

---

## 0. npm registry verification

All queried against `registry.npmjs.org` on 2026-08-31. **VERIFIED.**

| Package | `latest` | Notes |
|---|---|---|
| `motion` | **13.1.1** | dist-tags: `latest 13.1.1`, `canary 13.1.1-alpha.0`. Brief said v13 — correct. |
| `framer-motion` | 13.1.1 | Version-locked mirror of `motion`. Use `motion` only. |
| `@tanstack/react-virtual` | **3.14.10** | deps on `@tanstack/virtual-core@3.17.8`; peers React 16.8–19. **Use this (§9).** |
| `react-window` | 2.3.0 | v2 is a full rewrite. Viable but less flexible than react-virtual for grids. |
| `react-virtuoso` | 4.18.12 | Batteries-included alternative; heavier. |
| `cmdk` | **1.1.1** | deps: `@radix-ui/react-dialog@^1.1.6`, `react-id`, `react-primitive`, `compose-refs`. Peers React 18/19. **Use this (§10).** |
| `fuse.js` | 7.5.0 | Fuzzy scorer if cmdk's built-in filter isn't enough. |
| `@number-flow/react` | 0.6.2 | Odometer-style digit transitions. Optional; see §4. |
| `recharts` | 3.10.1 | See §8 — probably not our pick. |
| `@visx/visx` | 4.0.0 | visx umbrella. Bklit uses scoped `@visx/*` v4.0.1-alpha.0 packages. |
| `@nivo/core` | 0.99.0 | |
| `uplot` | 1.6.32 | Fastest time-series canvas renderer. See §8. |
| `lightweight-charts` | 5.2.1 | TradingView; financial-only framing. |
| `d3-shape` | 3.2.0 | **Use this (§5, §8).** Arc/pie/line/area path generators, no DOM. |
| `@tanstack/react-table` | 9.2.4 | v9 is current `latest` (dist-tags confirm). Headless; pairs with react-virtual. |
| `@floating-ui/react` | 0.27.20 | Tooltip/popover positioning if Radix is too heavy. |

---

## 1. THE HEADLINE FIND — scificn-ui

**VERIFIED.** https://github.com/baxy5/scificn-ui · https://www.scificn.dev/

Not in the brief's list, surfaced while searching 21st.dev. It is a retro sci-fi design system: Radix + Tailwind v4, shadcn-CLI compatible, 33 components (Alert, Badge, Bar Chart, Breadcrumb, Button, Card, Checkbox, Dialog, Grid, Heatmap, Input, Kbd, Label, Line Chart, **Node Graph**, **Panel**, Progress, **Progress Ring**, Radar Chart, Select, Separator, Skeleton, Spinner, **Stat Card**, **Status Grid**, Switch, Tabs, **Terminal**, Textarea, Toast, Tooltip, Typography).

It is a *terminal/CRT* aesthetic, not Warframe's *Orokin ceramic* aesthetic — green phosphor, monospace, zero radius. **Do not copy its palette.** But its *geometry primitives* are exactly the vocabulary Warframe's UI uses, and they are three CSS variables.

### 1.1 The corner-notch clip-path — steal this verbatim

VERIFIED from `src/styles/globals.css`:

```css
--clip-corner-sm: polygon(6px 0%, 100% 0%, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0% 100%, 0% 6px);
--clip-corner-md: polygon(10px 0%, 100% 0%, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0% 100%, 0% 10px);
--clip-corner-lg: polygon(16px 0%, 100% 0%, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0% 100%, 0% 16px);
```

Note the asymmetry: it chamfers **top-left and bottom-right only**. That diagonal-pair bias is what makes it read as "designed" rather than "octagon". Applied via `clipPath: var(--clip-corner-md)` on the Panel root, with `border: 1px solid var(--border)` and `overflow: hidden`.

**Critical limitation (INFERRED, but certain from how clip-path works):** `clip-path` clips the border too, so a 1px border on a clipped box loses its edge along the chamfer. scificn-ui ships with this bug visible. **Our fix — a four-variable notch frame that keeps a real stroke:**

```css
/* Two stacked clipped layers: the outer is the stroke colour, the inner is
   the fill inset by the border width. Both share the notch geometry. */
.wf-panel {
  --notch: 14px;
  --stroke: 1px;
  --clip: polygon(
    var(--notch) 0, 100% 0,
    100% calc(100% - var(--notch)), calc(100% - var(--notch)) 100%,
    0 100%, 0 var(--notch)
  );
  position: relative;
  clip-path: var(--clip);
  background: var(--wf-edge);          /* the "border" colour */
  padding: var(--stroke);
}
.wf-panel > * {
  clip-path: var(--clip);              /* same polygon, smaller box = parallel inset */
  background: var(--wf-surface);
  height: 100%;
}
```

Because the inner element is inset by `--stroke` on every side, the same polygon percentages produce a geometrically parallel chamfer. This is the single most reusable snippet in this document.

**Going overboard (GUESSED direction, mechanically sound):** animate `--notch` with `@property` so panels *unfold* — chamfer 0 → 14px on mount:

```css
@property --notch { syntax: '<length>'; inherits: true; initial-value: 0px; }
.wf-panel { transition: --notch 320ms cubic-bezier(0.16, 1, 0.3, 1); }
```

`@property` is required — plain custom properties don't interpolate. Chromium-only, which is fine: Overwolf is Chromium.

### 1.2 Other scificn tokens worth noting

VERIFIED, same file. Their glow convention is a **two-stop box-shadow at fixed alpha suffixes**:

```css
--glow-green: 0 0 8px #00ed3f66, 0 0 20px #00ed3f33;   /* 8px @ 40%, 20px @ 20% */
--text-glow-green: 0 0 6px #00ed3f99, 0 0 14px #00ed3f55; /* 6px @ 60%, 14px @ 33% */
```

The pattern — tight/bright inner + wide/faint outer, text glow tighter and hotter than box glow — is a good default. Adopt the *ratios*, swap the hues for our Orokin gold / Tenno teal / Corpus blue tokens.

CRT scanline overlay (VERIFIED):

```css
.scanlines::after {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 10;
  background: repeating-linear-gradient(to bottom,
    transparent 0px, transparent 3px,
    rgba(0,0,0,0.12) 3px, rgba(0,0,0,0.12) 4px);
}
```

3px clear / 1px dark at 12%. Use sparingly — Warframe's UI is *clean* holographic, not CRT. Reserve it for one deliberately "degraded transmission" surface (e.g. a Lotus/Man-in-the-Wall alert).

Their global reset does `border-radius: 0 !important` on `*, *::before, *::after`. Aggressive, but the instinct is right for us: **zero radius everywhere, notches instead.**

---

## 2. Animated / gradient borders and glowing card edges

Four distinct techniques, all VERIFIED from source. They are **not** interchangeable — pick per use case.

### 2.1 BorderBeam (Magic UI) — a light travelling the perimeter

VERIFIED: `https://magicui.design/r/border-beam.json`. Defaults: `size=50, duration=6, delay=0, colorFrom="#ffaa40", colorTo="#9c40ff", borderWidth=1, initialOffset=0, reverse=false`.

The trick is **`offset-path: rect()`** — not a keyframed translate. A square gradient div rides the container's own rectangle:

```tsx
// outer: a transparent-bordered box masked to show only the border band
<div
  className="pointer-events-none absolute inset-0 rounded-[inherit]
             border-(length:--border-beam-width) border-transparent
             mask-[linear-gradient(transparent,transparent),linear-gradient(#000,#000)]
             mask-intersect [mask-clip:padding-box,border-box]"
  style={{ "--border-beam-width": borderWidth + "px" }}
>
  <motion.div
    className="absolute aspect-square bg-linear-to-l
               from-(--color-from) via-(--color-to) to-transparent"
    style={{
      width: size,
      offsetPath: "rect(0 auto auto 0 round " + size + "px)",
      "--color-from": colorFrom,
      "--color-to": colorTo,
    }}
    initial={{ offsetDistance: initialOffset + "%" }}
    animate={{ offsetDistance: [initialOffset + "%", (100 + initialOffset) + "%"] }}
    transition={{ repeat: Infinity, ease: "linear", duration, delay: -delay }}
  />
</div>
```

Two mechanisms worth understanding:

1. **The border-band mask.** Two mask layers — one `padding-box`-clipped, one `border-box`-clipped — intersected. Only the ring between padding box and border box survives. This is the modern Tailwind v4 replacement for the old `mask-composite: exclude` hack (§2.2).
2. **`delay: -delay`.** Negative delay starts the animation *mid-cycle*, so multiple beams on one card are phase-offset without waiting. Stack two BorderBeams with `delay={0}` and `delay={duration/2}` for a counter-rotating pair.

**Warframe adaptation.** `offset-path: rect()` follows the border-box rectangle, so it **does not follow our chamfered polygon** — the beam will cut the corner. Replace with an explicit SVG-path offset-path matching the notch:

```css
/* for a WxH panel with an Npx notch on TL and BR */
offset-path: path("M N,0 L W,0 L W,H-N L W-N,H L 0,H L 0,N Z");
offset-rotate: auto;   /* the beam banks into the chamfer — this is the "overboard" bit */
```

`offset-rotate: auto` makes the beam's own gradient rotate as it turns the corner. Costs nothing, reads as deliberate engineering.

### 2.2 ShineBorder (Magic UI) — the classic mask-composite gradient border

VERIFIED: `https://magicui.design/r/shine-border.json`. Defaults `borderWidth=1, duration=14, shineColor="#000000"`.

```tsx
<div
  className="motion-safe:animate-shine pointer-events-none absolute inset-0 size-full
             rounded-[inherit] will-change-[background-position]"
  style={{
    "--border-width": borderWidth + "px",
    "--duration": duration + "s",
    backgroundImage:
      "radial-gradient(transparent,transparent, " + colors.join(",") + ",transparent,transparent)",
    backgroundSize: "300% 300%",
    mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
    WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
    WebkitMaskComposite: "xor",
    maskComposite: "exclude",
    padding: "var(--border-width)",
  }}
/>
```

```css
@keyframes shine {
  0%   { background-position: 0% 0%; }
  50%  { background-position: 100% 100%; }
  to   { background-position: 0% 0%; }
}
```

`maskComposite: exclude` subtracts the content box from the full box, leaving the padding ring. **This one survives `clip-path`** because it is a background, not a border — so it composes with our notch panel where BorderBeam's border trick does not. The `motion-safe:` prefix respects `prefers-reduced-motion` for free.

`background-size: 300% 300%` plus a diagonal position sweep is what makes it look like light raking across metal. For Warframe: `radial-gradient(transparent, transparent, var(--wf-gold), var(--wf-gold-hot), transparent, transparent)` and slow it down — `duration: 20s`. Fast shine reads cheap.

### 2.3 GlowingEffect (Aceternity) — proximity-reactive conic border. **Best-in-class.**

VERIFIED: `https://ui.aceternity.com/registry/glowing-effect.json`. Defaults `blur=0, inactiveZone=0.7, proximity=0, spread=20, movementDuration=2, borderWidth=1, disabled=true`.

The most sophisticated border in any of the six libraries, and the closest in spirit to Warframe's "the UI notices you" feel. It does three things at once.

**(a) Angle tracking with shortest-path wrapping.** VERIFIED:

```js
const center = [left + width * 0.5, top + height * 0.5];
let targetAngle = (180 * Math.atan2(mouseY - center[1], mouseX - center[0])) / Math.PI + 90;
const currentAngle = parseFloat(element.style.getPropertyValue("--start")) || 0;
const angleDiff = ((targetAngle - currentAngle + 180) % 360) - 180;  // <- shortest path
animate(currentAngle, currentAngle + angleDiff, {
  duration: movementDuration,
  ease: [0.16, 1, 0.3, 1],                 // easeOutExpo
  onUpdate: (v) => element.style.setProperty("--start", String(v)),
});
```

The `((diff + 180) % 360) - 180` normalisation is the important line — without it the glow spins the long way round when crossing 0/360 degrees.

**(b) A dead zone.** `inactiveZone = 0.7`: if the cursor is within 70% of the half-min-dimension from centre, `--active` goes to 0. Prevents jitter when hovering dead-centre. `proximity` extends the active rect *outside* the element, so the glow anticipates arrival.

**(c) The conic-gradient border mask.** VERIFIED, as Tailwind arbitrary properties on an `::after`:

```
after:[border:var(--glowingeffect-border-width)_solid_transparent]
after:[background:var(--gradient)] after:[background-attachment:fixed]
after:[mask-clip:padding-box,border-box]
after:[mask-composite:intersect]
after:[mask-image:linear-gradient(#0000,#0000),
       conic-gradient(from_calc((var(--start)-var(--spread))*1deg),
                      #00000000_0deg,#fff,#00000000_calc(var(--spread)*2deg))]
```

A conic gradient used **as a mask**, not as the colour. `--spread` (default 20) is the half-arc in degrees, so the lit arc is 40 degrees wide, centred on `--start`. The colour underneath is a separate layered gradient. Decoupling arc-position (mask) from colour (background) is the key idea — it means we can put an Orokin gold-to-void-black gradient underneath and still steer where it lights up.

Their default `--gradient` stacks four offset `radial-gradient`s over a `repeating-conic-gradient` with `--repeating-conic-gradient-times: 5`:

```css
--gradient:
  radial-gradient(circle, #dd7bbb 10%, #dd7bbb00 20%),
  radial-gradient(circle at 40% 40%, #d79f1e 5%, #d79f1e00 15%),
  radial-gradient(circle at 60% 60%, #5a922c 10%, #5a922c00 20%),
  radial-gradient(circle at 40% 60%, #4c7894 10%, #4c789400 20%),
  repeating-conic-gradient(from 236.84deg at 50% 50%,
    #dd7bbb 0%,
    #d79f1e calc(25% / var(--repeating-conic-gradient-times)),
    #5a922c calc(50% / var(--repeating-conic-gradient-times)),
    #4c7894 calc(75% / var(--repeating-conic-gradient-times)),
    #dd7bbb calc(100% / var(--repeating-conic-gradient-times)));
```

`background-attachment: fixed` makes the gradient viewport-anchored, so cards at different screen positions sample different parts of it — adjacent panels glow slightly different hues without any per-card configuration. Excellent, nearly free, keep it.

**Gotcha:** `disabled` defaults to **`true`**, and the `!hidden` / `!block` classes invert on it. Ship with `disabled={false}`.

**Warframe adaptation:** rebuild against our notch clip-path (two-layer approach from §1.1, conic mask on the outer layer); drive `--spread` from *game state* rather than a constant — a narrow 15-degree hot arc when idle, widening to 90 degrees when a Void Fissure alert fires. Add a second counter-rotating arc at `--start + 180` for the overboard version.

### 2.4 GlareHover (React Bits) — a single diagonal light sweep

VERIFIED: `raw.githubusercontent.com/DavidHDev/react-bits/main/src/content/Animations/GlareHover/GlareHover.jsx`. Defaults `glareColor='#ffffff', glareOpacity=0.5, glareAngle=-45, glareSize=250, transitionDuration=650, playOnce=false`.

The component is trivial — it parses a hex to `rgba()` and dumps nine CSS variables (`--gh-angle`, `--gh-size`, `--gh-rgba`, `--gh-duration`, ...) onto a div; all the work is in `GlareHover.css`. **The lesson is the architecture, not the code:** a pure CSS-variable pass-through, zero runtime, zero re-renders on hover. For an Overwolf overlay where every frame is contended with the game, this is the pattern we want for all hover effects — set variables, let CSS composite.

Their hex-to-rgba parser handles 3- and 6-digit hex and silently passes anything else through. Use `color-mix(in oklab, var(--wf-gold) 50%, transparent)` instead and delete the parser entirely.

### 2.5 Verdict

| Use case | Pick |
|---|---|
| Static panel edge, always-on | §2.2 ShineBorder technique, slowed to 20s |
| Hero / active panel, cursor-reactive | §2.3 GlowingEffect — **primary recommendation** |
| Alert panel, perimeter runner | §2.1 BorderBeam with SVG `offset-path` + `offset-rotate: auto` |
| Cheap hover on 200 inventory tiles | §2.4 CSS-variable-only glare |

---

## 3. Spotlight and cursor-tracking effects

### 3.1 MagicCard (Magic UI) — dual-gradient padding-box/border-box spotlight

VERIFIED: `https://magicui.design/r/magic-card.json`. Two modes.

**Gradient mode** — the notable trick is a *single* `background` shorthand carrying two layers clipped to different boxes:

```tsx
style={{ background: useMotionTemplate`
  linear-gradient(var(--color-background) 0 0) padding-box,
  radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px,
    ${gradientFrom}, ${gradientTo}, var(--color-border) 100%) border-box
`}}
```

The flat fill is clipped to the padding box; the mouse-following radial fills the border box. Result: **the border alone picks up the spotlight**, with no mask and no pseudo-element. Cheapest cursor-reactive border in the whole survey. Defaults `gradientSize=200, gradientFrom='#9E7AFF', gradientTo='#FE8BBB', gradientOpacity=0.8`.

**Orb mode** — a blurred gradient circle chasing the cursor through springs:

```tsx
const orbX = useSpring(mouseX, { stiffness: 250, damping: 30, mass: 0.6 });
const orbY = useSpring(mouseY, { stiffness: 250, damping: 30, mass: 0.6 });
const orbVisible = useSpring(0, { stiffness: 300, damping: 35 });
// ...
style={{
  width: glowSize /* 420 */, height: glowSize,
  x: orbX, y: orbY, translateX: "-50%", translateY: "-50%",
  borderRadius: 9999,
  filter: `blur(${glowBlur}px)` /* 60 */,
  opacity: orbVisible,
  background: `linear-gradient(${glowAngle}deg, ${glowFrom}, ${glowTo})`,
  mixBlendMode: isDarkTheme ? "screen" : "multiply",
  willChange: "transform, opacity",
}}
```

`{ stiffness: 250, damping: 30, mass: 0.6 }` is a genuinely good cursor-lag config — noticeably trailing, never wobbly. **Record it as a token: `SPRING_CURSOR`.** `mixBlendMode: "screen"` on dark is what makes it read as *light* rather than a coloured disc; on a permanently dark Warframe overlay we always want `screen`, so drop the `next-themes` dependency and the `mounted` guard entirely.

**Robustness detail worth copying verbatim.** They reset the spotlight on three global events:

```tsx
window.addEventListener("pointerout", (e) => { if (!e.relatedTarget) reset("global"); });
window.addEventListener("blur", () => reset("global"));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") reset("global");
});
```

In an Overwolf overlay the cursor leaves the window constantly (into the game). **Without these three listeners the spotlight sticks at its last position permanently.** Not optional for us.

### 3.2 CardSpotlight (Aceternity) — mask-image spotlight + WebGL dot matrix

VERIFIED: `https://ui.aceternity.com/registry/card-spotlight.json`.

The spotlight half is four lines and worth taking:

```tsx
<motion.div
  className="pointer-events-none absolute z-0 -inset-px opacity-0
             transition duration-300 group-hover/spotlight:opacity-100"
  style={{
    backgroundColor: color,       // "#262626"
    maskImage: useMotionTemplate`
      radial-gradient(${radius}px circle at ${mouseX}px ${mouseY}px, white, transparent 80%)`,
  }}
/>
```

Flat colour plus a moving radial mask. Defaults `radius=350, color='#262626'`. Opacity is CSS-transitioned on group hover, so mouse-leave fades rather than snapping.

The other half pulls in `@react-three/fiber` + `three` for a GLSL dot matrix (`CanvasRevealEffect`). **Reject the dependency, take the shader.** The interesting lines from their fragment shader (VERIFIED):

```glsl
float PHI = 1.61803398874989484820459;
float random(vec2 xy) { return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x); }

// quantise to a cell, then re-roll per-cell opacity every `frequency` seconds
vec2  st2         = vec2(int(st.x / u_total_size), int(st.y / u_total_size));
float show_offset = random(st2);
float rand = random(st2 * floor((u_time / frequency) + show_offset + frequency) + 1.0);
opacity *= u_opacities[int(rand * 10.0)];

// carve a square dot out of each cell with no geometry
opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));

// radial reveal wipe with a ragged edge
float intro_offset = distance(u_resolution / 2.0 / u_total_size, st2) * 0.01 + (random(st2) * 0.15);
opacity *= step(intro_offset, u_time * animation_speed_factor);
opacity *= clamp((1.0 - step(intro_offset + 0.1, u_time * animation_speed_factor)) * 1.25, 1.0, 1.25);
```

Three transferable ideas:

1. `floor(u_time / frequency + offset)` as a time-quantised random **seed** gives *stepped* flicker instead of smooth noise — reads as digital, not organic.
2. The `1.0 - step(dotSize/cellSize, fract(...))` pair carves square dots out of a continuous field with no vertices.
3. `distance(centre, cell) * k + random * j` as a reveal offset produces a radial wipe with a ragged leading edge.

All three port to a plain 2D-canvas loop or raw WebGL2 without React-Three-Fiber. They render with `blending: THREE.CustomBlending, blendSrc: SrcAlphaFactor, blendDst: OneFactor` — **additive** blending, the correct choice for holographic dots on black. Note it.

**Our version:** run this on a plain `<canvas>` sized to the panel, with the "dots" being Orokin diamond glyphs instead of squares, revealing radially on panel mount. One canvas, one rAF, no Three.

---

## 4. Backgrounds — beam, meteor, grid, dot-matrix, aurora

Ranked by fitness for a Warframe overlay. **The constraint that governs this whole section: we are drawing on top of a running game.** Budget one animated background total, and gate it on `IntersectionObserver` plus `document.visibilityState`.

### 4.1 FlickeringGrid (Magic UI) — **the pick.** Canvas, DPR-correct, self-pausing.

VERIFIED: `https://magicui.design/r/flickering-grid.json`. Defaults `squareSize=4, gridGap=6, flickerChance=0.3, maxOpacity=0.3`.

Best-engineered background in the survey:

```tsx
// state is a flat Float32Array of per-cell opacity — no objects, no GC churn
const squares = new Float32Array(cols * rows);
for (let i = 0; i < squares.length; i++) squares[i] = Math.random() * maxOpacity;

// frame-rate-independent flicker: probability scales with delta time
const updateSquares = (squares, deltaTime) => {
  for (let i = 0; i < squares.length; i++) {
    if (Math.random() < flickerChance * deltaTime) squares[i] = Math.random() * maxOpacity;
  }
};

// DPR handling
const dpr = window.devicePixelRatio || 1;
canvas.width  = width  * dpr;  canvas.height = height * dpr;
canvas.style.width = width + "px";  canvas.style.height = height + "px";
```

Three things to copy exactly:

- **`Float32Array` for cell state.** Thousands of cells, zero allocation per frame.
- **`flickerChance * deltaTime`.** Flicker rate is identical at 60 Hz and 144 Hz. Most implementations get this wrong.
- **`IntersectionObserver` gating.** `animate()` early-returns on `!isInView`, *and* the rAF is only started when in view. Add `visibilitychange` for the overlay case.

Their colour-parsing hack — paint the colour into a 1x1 canvas, `getImageData` to read back RGB — is a neat way to accept any CSS colour string including `hsl()` / `oklch()`. Keep it: it means our grid can take `var(--wf-gold)` resolved via `getComputedStyle`.

**Warframe version:** replace `ctx.fillRect` with a small cached `Path2D` diamond or chevron, and bias the random re-roll toward a *travelling wavefront* (`squares[i] = f(x - t)`) so the flicker reads as a data sweep rather than noise.

### 4.2 AnimatedGridPattern (Magic UI) — SVG grid + roaming lit cells

VERIFIED: `https://magicui.design/r/animated-grid-pattern.json`. Defaults `width=40, height=40, x=-1, y=-1, numSquares=50, maxOpacity=0.5, duration=4, repeatDelay=0.5`.

The static grid is one `<pattern>` and one path — the cheapest grid on the web:

```tsx
<pattern id={id} width={width} height={height} patternUnits="userSpaceOnUse" x={x} y={y}>
  <path d={`M.5 ${height}V.5H${width}`} fill="none" strokeDasharray={strokeDasharray} />
</pattern>
<rect width="100%" height="100%" fill={`url(#${id})`} />
```

`M.5 40V.5H40` = down the left edge, then across the top. The `.5` offsets put the 1px stroke on the pixel centre so it renders crisp instead of 2px-blurry — **this is the detail everyone misses**. `x=-1, y=-1` nudges the whole pattern to hide the outer edge. `useId()` for the pattern id so multiple instances do not collide.

The animated layer is 50 `motion.rect`s each with `repeat: 1, repeatType: "reverse"` (fade in, fade out), `onAnimationComplete` teleporting the square to a new random cell, and `key={id + "-" + iteration}` forcing a remount so the animation restarts. Clever, but **50 concurrent Motion animations is 50 subscriptions**. For a static grid plus a handful of lit cells, prefer §4.1's canvas. Take the `<pattern>`; leave the rects.

### 4.3 Meteors (Magic UI) — trivial, and directly useful

VERIFIED: `https://magicui.design/r/meteors.json`. Defaults `number=20, minDelay=0.2, maxDelay=1.2, minDuration=2, maxDuration=10, angle=215`.

```css
@keyframes meteor {
  0%   { transform: rotate(var(--angle)) translateX(0);      opacity: 1; }
  70%  { opacity: 1; }
  100% { transform: rotate(var(--angle)) translateX(-500px); opacity: 0; }
}
```

Each meteor is a `size-0.5` rounded span with `shadow-[0_0_0_1px_#ffffff10]` (a 1px hairline halo, zero blur radius — cheap and crisp) and an absolutely-positioned child `h-px w-12.5 bg-linear-to-r from-zinc-500 to-transparent` at `-z-10` as the tail. The entire effect is `rotate()` + `translateX()` — one composited transform, essentially free.

**Bug not to copy:** `left: calc(0% + ${Math.random() * window.innerWidth}px)` uses *viewport* width, not the container's — wrong whenever the container is not full-bleed. Use a ResizeObserver width, or just `left: ${Math.random() * 100}%`.

**Warframe use:** this is a Void-streak / ability-proc effect, not a background. Fire 3-5 gold meteors across a panel on level-up or Fissure open. `angle=215` (down-left) is close to our chamfer diagonal; use 225 to match exactly.

### 4.4 Ripple (Magic UI) — concentric pulse rings

VERIFIED: `https://magicui.design/r/ripple.json`. Defaults `mainCircleSize=210, mainCircleOpacity=0.24, numCircles=8`.

Ring `i`: `size = 210 + i*70`, `opacity = 0.24 - i*0.03`, `animationDelay = i*0.06s`. Container masked with `linear-gradient(to bottom, white, transparent)` so rings fade downward. The keyframe is a subtle breathe, not an expanding pulse:

```css
@keyframes ripple {
  0%, 100% { transform: translate(-50%, -50%) scale(1); }
  50%      { transform: translate(-50%, -50%) scale(0.9); }
}
```

The **arithmetic sequence** — linear size step, linear opacity step, linear delay step — is the whole recipe, and it generalises: it is exactly how you would draw a Warframe minimap radar sweep or a Void-relic refinement pulse. Cost: 8 divs, one transform each.

Note the `React.memo` wrapper: the component takes no changing props, so it never re-renders. Do this for every decorative layer we write.

### 4.5 BackgroundBeams (Aceternity) — 50 hand-authored SVG paths

VERIFIED: `https://ui.aceternity.com/registry/background-beams.json`.

50 near-identical cubic beziers, each translated +7px in x and -8px in y from the last:

```
M-380 -189C-380 -189 -312 216 152 343C616 470 684 875 684 875
M-373 -197C-373 -197 -305 208 159 335C623 462 691 867 691 867
```

Each gets its own `<motion.linearGradient gradientUnits="userSpaceOnUse">` animating `x1/x2/y1/y2` from 0% to 100%, with `duration: Math.random()*10 + 10`, `delay: Math.random()*10`, and stops `#18CCFC -> #6344F5 -> #AE48FF` with `stopOpacity: 0` at both ends. Underneath, all 50 paths are concatenated into **one** static `<path>` at `strokeOpacity="0.05"` for the always-visible tracery — a good optimisation: one node for the static layer, N only for the lit ones.

**Do not copy the 50 literal path strings** — that is 4KB of magic numbers describing someone else's composition. Generate ours (deltas INFERRED by differencing their first two paths; the shape is a shallow S sweeping bottom-left to top-right):

```ts
const beams = Array.from({ length: 50 }, (_, i) => {
  const ox = -380 + i * 7, oy = -189 - i * 8;
  return `M${ox} ${oy}C${ox} ${oy} ${ox + 68} ${oy + 405} ${ox + 532} ${oy + 532}` +
         `C${ox + 996} ${oy + 659} ${ox + 1064} ${oy + 1064} ${ox + 1064} ${oy + 1064}`;
});
```

With generated paths we can bend the curve to trace the Lotus sigil silhouette instead. That is the "way overboard" move, and it costs nothing extra.

Animating SVG **gradient coordinates** rather than `stroke-dashoffset` means no path-length measurement and no layout, and gradients composite on the GPU. Good technique — remember it.

### 4.6 AuroraBackground (Aceternity) — layered repeating-linear-gradients

VERIFIED: `https://ui.aceternity.com/registry/aurora-background.json`.

```css
--aurora:        repeating-linear-gradient(100deg,#3b82f6 10%,#a5b4fc 15%,#93c5fd 20%,#ddd6fe 25%,#60a5fa 30%);
--dark-gradient: repeating-linear-gradient(100deg,#000 0%,#000 7%,transparent 10%,transparent 12%,#000 16%);
--white-gradient:repeating-linear-gradient(100deg,#fff 0%,#fff 7%,transparent 10%,transparent 12%,#fff 16%);
```

Applied as:

```
background-image: var(--dark-gradient), var(--aurora);   /* dark mode */
background-size: 300%, 200%;
background-position: 50% 50%, 50% 50%;
filter: blur(10px);
inset: -10px;
mask-image: radial-gradient(ellipse at 100% 0%, black 10%, transparent 70%);

::after {
  background-image: var(--dark-gradient), var(--aurora);
  background-size: 200%, 100%;
  background-attachment: fixed;
  mix-blend-mode: difference;
  animation: aurora 60s linear infinite;
}
```

```css
@keyframes aurora {
  from { background-position: 50% 50%, 50% 50%; }
  to   { background-position: 350% 50%, 350% 50%; }
}
```

The mechanism: two *striped* repeating gradients at 100 degrees, the second a black/transparent stripe mask. The `::after` duplicates them at different `background-size` and composites with `mix-blend-mode: difference`. Two stripe patterns at different scales sliding past each other through `difference` produce a moire that reads as organic aurora. `blur(10px)` softens the banding; `inset: -10px` hides the blur's soft edge; `mask-image` fades the whole thing out; `background-attachment: fixed` anchors to the viewport.

**Verdict: reject as-is** — soft, wide, pastel, everything Warframe's UI is not. **But the difference-blend moire is a strong "Void energy" technique** if the stripes become 2px hard gold-on-black and the blur drops to 2px. Worth one experiment.

### 4.7 DotGrid (React Bits) — physics-reactive dots. **Do not ship as-is.**

VERIFIED: `raw.githubusercontent.com/DavidHDev/react-bits/main/src/content/Backgrounds/DotGrid/DotGrid.jsx`. Defaults `dotSize=16, gap=32, proximity=150, speedTrigger=100, shockRadius=250, shockStrength=5, maxSpeed=5000, resistance=750, returnDuration=1.5`.

Dots are pushed by cursor **velocity** (not position) and spring back:

```js
const dt = pr.lastTime ? now - pr.lastTime : 16;
let vx = ((e.clientX - pr.lastX) / dt) * 1000;   // px/sec
let vy = ((e.clientY - pr.lastY) / dt) * 1000;
let speed = Math.hypot(vx, vy);
if (speed > maxSpeed) { const s = maxSpeed / speed; vx *= s; vy *= s; speed = maxSpeed; }

if (speed > speedTrigger && dist < proximity && !dot._inertiaApplied) {
  dot._inertiaApplied = true;
  gsap.killTweensOf(dot);
  gsap.to(dot, {
    inertia: { xOffset: dot.cx - pr.x + vx * 0.005,
               yOffset: dot.cy - pr.y + vy * 0.005, resistance },
    onComplete: () => {
      gsap.to(dot, { xOffset: 0, yOffset: 0,
                     duration: returnDuration, ease: "elastic.out(1,0.75)" });
      dot._inertiaApplied = false;
    },
  });
}
```

Also present: a click shockwave with `falloff = Math.max(0, 1 - dist / shockRadius)`, a per-dot RGB lerp `base + (active - base) * (1 - dist/proximity)`, one cached `Path2D` circle reused for every dot, and `mousemove` throttled to 50ms.

**Three reasons not to ship it:**

1. It needs **GSAP + InertiaPlugin — InertiaPlugin is a paid GSAP Club plugin.** Licensing problem.
2. It binds `mousemove` and `click` on **`window`**, which in an overlay steals input intent from the game.
3. The draw loop runs unconditionally forever with no visibility gating.

**Rebuild in ~40 lines with no dependency.** Verlet-ish spring per dot:

```ts
// per dot: ox, oy (offset from rest), vx, vy
const k = 0.12, damp = 0.82;        // spring constant, damping
dot.vx += -dot.ox * k;  dot.vy += -dot.oy * k;
dot.vx *= damp;         dot.vy *= damp;
dot.ox += dot.vx;       dot.oy += dot.vy;
```

`k=0.12, damp=0.82` approximates GSAP's `elastic.out(1, 0.75)` feel — **GUESSED starting values, tune on screen.** Then keep their genuinely good ideas: velocity-triggered (not position-triggered) impulse, `maxSpeed` clamp, squared-distance comparison to skip `sqrt`, cached `Path2D`, click shockwave falloff. Attach listeners to the **container**, never `window`.

### 4.8 Background verdict

Ship **one** canvas background built on §4.1's engine (Float32Array + deltaTime + IntersectionObserver + visibilitychange), drawing an Orokin-diamond dot field, with §4.7's velocity-impulse interaction and §3.2's time-quantised flicker seed. Keep §4.3 Meteors as a *transient event* effect, and §4.5's generated beams as a one-off for the main dashboard hero only.

---

## 5. Number tickers and animated counters

### 5.1 NumberTicker (Magic UI) — spring-driven, DOM-direct

VERIFIED: `https://magicui.design/r/number-ticker.json`. Full mechanism:

```tsx
const motionValue = useMotionValue(direction === "down" ? value : startValue);
const springValue = useSpring(motionValue, { damping: 60, stiffness: 100 });
const isInView    = useInView(ref, { once: true, margin: "0px" });

useEffect(() => {
  if (!isInView) return;
  const timer = setTimeout(() => {
    motionValue.set(direction === "down" ? startValue : value);
  }, delay * 1000);
  return () => clearTimeout(timer);
}, [motionValue, isInView, delay, value, direction, startValue]);

useEffect(() =>
  springValue.on("change", (latest) => {
    if (ref.current) {
      ref.current.textContent = Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      }).format(Number(latest.toFixed(decimalPlaces)));
    }
  }), [springValue, decimalPlaces]);
```

Four details that make it good, all worth copying:

1. **`springValue.on("change")` writes `textContent` directly.** No `setState`, therefore **zero React re-renders** during a 1-2 second count. On a stats dashboard with 40 counters this is the difference between smooth and unusable.
2. **`{ damping: 60, stiffness: 100 }`** is heavily overdamped — no overshoot, decelerating arrival. Correct for numbers: a credit count that overshoots and settles back is *wrong information* on screen for a few frames. **Record as `SPRING_COUNTER`.** (Contrast §3.1's `SPRING_CURSOR` `{250, 30, 0.6}` which is deliberately loose.)
3. **`Intl.NumberFormat`** for grouping separators — free, locale-aware, no formatting library.
4. **`tabular-nums`** in the className. Without it the element's width jitters as digit shapes change and the whole row reflows every frame. Mandatory.

**Warframe adaptation.** Two changes:

- Drop `useInView` — an overlay panel is either open or closed, not scrolled into view. Trigger on mount and on value change.
- **`useInView(ref, { once: true })` means it never re-animates.** Our Platinum/Credits/Ducat values update from live worldstate. Replace the `once: true` gate with a plain `useEffect` on `value` so every delta animates.

Overboard version: when the delta is positive, additionally set `--flash: 1` and run a 200ms gold text-shadow pulse and a `+1,250` ghost number that rises and fades. For a *negative* delta (spending platinum), tint red and animate downward. Digit-level odometer roll instead of numeric interpolation is where §5.2 comes in.

### 5.2 `@number-flow/react` — the odometer alternative

VERIFIED on npm: `@number-flow/react@0.6.2`, peers `react ^18 || ^19`. Description: "A component to transition and format numbers."

This is a real dependency, not a copy-in — the one place where I would consider it. It animates **each digit column independently** (true odometer roll) rather than interpolating a scalar and reformatting, which §5.1 cannot do. It is also what **Bklit uses internally** for chart centre-stats (VERIFIED from `bklit.com/r/gauge-chart.json`, which lists `@number-flow/react` alongside `@visx/*` and `d3-shape`).

**Recommendation:** start with §5.1's ~25 lines. Only reach for `@number-flow/react` if we specifically want per-digit rolling on the hero stats. Do not use both.

---

## 6. Progress rings, radial meters, gauges

### 6.1 ProgressRing (scificn-ui) — **use this as the base.** Clean SVG, no deps.

VERIFIED: `https://www.scificn.dev/r/progress-ring.json`. Defaults `size=120, strokeWidth=6, showValue=true, variant='DEFAULT'`.

```tsx
const pct    = Math.min(Math.max(value, 0), 100);
const r      = (size - strokeWidth) / 2;    // inset by half the stroke so it doesn't clip
const circ   = 2 * Math.PI * r;
const offset = circ * (1 - pct / 100);
```

```tsx
{/* track */}
<circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} />

{/* glow layer — same arc, wider stroke, 12% opacity. THIS is the good bit. */}
<circle cx={cx} cy={cy} r={r} fill="none" stroke={accentColor}
        strokeWidth={strokeWidth + 8}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="butt" transform={`rotate(-90 ${cx} ${cy})`} opacity={0.12} />

{/* main arc */}
<circle cx={cx} cy={cy} r={r} fill="none" stroke={accentColor} strokeWidth={strokeWidth}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="butt" transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke-dashoffset 0.4s ease" }} />
```

Why this beats the alternatives:

- **The duplicate wide low-opacity arc is a bloom with no `filter: blur()`.** `filter` on SVG forces an offscreen render pass every frame; a second stroked circle does not. On an overlay with a dozen rings, this matters a lot.
- `r = (size - strokeWidth) / 2` — the arc is inset by half the stroke so it never clips the viewBox.
- `strokeLinecap="butt"` not `"round"`. Hard ends. Correct for a Warframe/Orokin look; `round` reads as consumer-friendly and soft.
- `transform="rotate(-90 cx cy)"` puts 0% at 12 o'clock.
- Animated purely by CSS-transitioning `stroke-dashoffset` — no JS on the frame path.
- `isSmall = size < 80` switches label font sizes. Simple responsive typography without container queries.

**Our additions for "overboard":**

```tsx
// 1. Segmented ring — Warframe-style tick marks instead of a continuous arc.
//    Dash pattern of N segments with a gap, then reveal with a second dashoffset layer.
const SEGMENTS = 32;
const seg = circ / SEGMENTS;
strokeDasharray = `${seg * 0.72} ${seg * 0.28}`;   // 72% mark, 28% gap

// 2. Sweep the whole ring on mount:
//    animate `stroke-dashoffset` from `circ` to `offset` over 700ms with easeOutExpo
//    cubic-bezier(0.16, 1, 0.3, 1) — the same curve Aceternity uses in §2.3.

// 3. A counter-rotating outer tick ring at 0.06 opacity, `animation: spin 40s linear infinite`,
//    reversed. Reads as an Orokin mechanism. Cost: one more <circle>.
```

### 6.2 AnimatedCircularProgressBar (Magic UI) — clever, but skip it

VERIFIED: `https://magicui.design/r/animated-circular-progress-bar.json`. `r=45` in a `0 0 100 100` viewBox, `circumference = 2 * PI * 45`, `--percent-to-px = circumference/100`, `--percent-to-deg = 3.6deg`.

It renders **two** arcs — a primary from 0 to `currentPercent`, and a secondary from `currentPercent` to 90 (`--stroke-percent: 90 - currentPercent`) that is `scaleY(-1)` flipped and rotated by `calc(1turn - 90deg - (var(--gap-percent) * var(--percent-to-deg) * var(--offset-factor-secondary)))` — producing a small gap between the filled and unfilled ends, like a real dial.

Genuinely nice detail, but it is **~15 interdependent CSS custom properties doing trigonometry in `calc()`**, with a `currentPercent <= 90` guard that silently drops the secondary arc above 90%. Unmaintainable. Take the *idea* (a visible gap between arc head and track tail) and implement it by shortening `strokeDasharray` by a few px in §6.1's clean version.

`transform: translateZ(0)` on the root is there to force a compositing layer. Keep that habit.

### 6.3 Bklit gauge — the notch gauge, and what Bklit actually is

VERIFIED: `https://bklit.com/r/gauge-chart.json` (note: `ui.bklit.com` 301-redirects to `bklit.com`).

Bklit is a **shadcn-registry chart collection**, not an npm package. Registry: `https://bklit.com/r/{name}.json`, install `npx shadcn@latest add @bklit/area-chart`. 17 chart types: Area, Bar, Candlestick, Choropleth, Composed, Funnel, **Gauge**, Heatmap, Line, Profit/Loss Line, **Live Line**, Pie, Radar, **Ring**, Scatter, Sankey, Sunburst — plus legends, grids, tooltips, axes, brushes.

**Its stack is the important finding.** Bklit does **not** wrap Recharts. VERIFIED from the gauge registry entry, its dependencies are:

- `@visx/responsive` and `@visx/pattern` (v4.0.1-alpha.0)
- `d3-shape` — arc and pie generators
- `motion/react` — animation
- `@number-flow/react` — centre stat

Their gauge is described as a "notch-based radial or linear gauge with optional center label, patterns, and optional gradients", supporting arc (polar) and linear orientations, staggered entrance animation, gradient/pattern fills, and container-query responsive sizing. Files: `gauge.tsx`, `notch-gauge-shared.ts` (path generation + fill resolution), `pie-center-shell.tsx`, `chart-stat-flow.tsx`.

**Two conclusions:**

1. A **notch gauge** — discrete tick segments around an arc rather than a continuous band — is exactly the Warframe idiom, and someone has already validated that `d3-shape`'s `arc()` + a hand-rolled notch splitter is the right way to build it. That is §6.1's segmented-ring plan, confirmed.
2. **`@visx/pattern` for fills** is a good trick: SVG `<pattern>` fills inside gauge segments (hatching, dots) let a gauge encode *two* dimensions — level by arc length, state by fill pattern. Warframe does this with faction-coded hatching. We can hand-write the `<pattern>` defs (see §4.2) without taking the visx dependency.

**Recommendation: do not install Bklit or visx.** Take `d3-shape@3.2.0` (VERIFIED, tiny, pure functions, no DOM) for `arc()`, `pie()`, `line()`, `area()`, `curveCatmullRom` and generate `d` strings ourselves.

```ts
import { arc } from "d3-shape";
const notch = arc()
  .innerRadius(52).outerRadius(64)
  .cornerRadius(0)                 // hard edges — Orokin, not Material
  .padAngle(0.035);                // the gap between notches

// one path per segment
const d = notch({ startAngle: a0, endAngle: a1 });
```

`padAngle` gives evenly-gapped notches for free at any radius, which is the fiddly part if you do it by hand.

---

## 7. Marquees and scrolling tickers (live worldstate bar)

Two implementations from Magic UI, and they solve different problems. **We want both, in different places.**

### 7.1 Marquee (Magic UI) — pure CSS, constant speed. **Use for the worldstate bar.**

VERIFIED: `https://magicui.design/r/marquee.json`. Defaults `reverse=false, pauseOnHover=false, vertical=false, repeat=4`.

```tsx
<div className="group flex gap-(--gap) overflow-hidden p-2 [--duration:40s] [--gap:1rem] flex-row">
  {Array(repeat).fill(0).map((_, i) => (
    <div key={i} className="flex shrink-0 justify-around gap-(--gap)
                            animate-marquee flex-row
                            group-hover:[animation-play-state:paused]
                            [animation-direction:reverse]">
      {children}
    </div>
  ))}
</div>
```

```css
@keyframes marquee {
  from { transform: translateX(0); }
  to   { transform: translateX(calc(-100% - var(--gap))); }
}
@keyframes marquee-vertical {
  from { transform: translateY(0); }
  to   { transform: translateY(calc(-100% - var(--gap))); }
}
```

The whole design in three points:

- **`calc(-100% - var(--gap))`.** Translating exactly one copy's width *plus the flex gap* is what makes the loop seamless. Off by the gap and you get a visible stutter every cycle. This one `calc` is the entire trick.
- **`repeat=4`** duplicated copies. Crude — for wide containers with few items you can still run out — but requires no measurement, no ResizeObserver, no layout read. For a worldstate bar with 8-15 alerts this is correct.
- **`group-hover:[animation-play-state:paused]`** — pause on hover in CSS, no JS, no state. Essential for us: the user must be able to stop the bar to read and click an alert.
- `[animation-direction:reverse]` for direction, `--duration` and `--gap` as arbitrary-value CSS variables so speed is set per instance from the className.

**Warframe adaptation.** Speed should be *content-relative*, not fixed: a bar with 3 alerts at `--duration: 40s` crawls; with 20 it blurs. Set `--duration: ${items.length * 3.5}s` inline. Add fade masks at both ends so items dissolve rather than clipping:

```css
mask-image: linear-gradient(to right, transparent, black 8%, black 92%, transparent);
```

Overboard: give each alert item a `--tint` from its faction (Grineer rust, Corpus blue, Infested green, Orokin gold), and a chevron separator between items drawn as a `clip-path` triangle. Duplicate the strip at 0.15 opacity, offset 2px down and blurred, as a reflection.

### 7.2 ScrollVelocityRow (Magic UI) — scroll-reactive, measured. Use for long lists.

VERIFIED: `https://magicui.design/r/scroll-based-velocity.json`. Considerably more sophisticated and a better piece of engineering.

Key mechanisms:

```ts
// wrap into a range — the seamless-loop primitive
export const wrap = (min, max, v) => {
  const rangeSize = max - min;
  return ((((v - min) % rangeSize) + rangeSize) % rangeSize) + min;
};

// scroll velocity -> signed speed multiplier, clamped to +/-5
const scrollVelocity = useVelocity(scrollY);
const smoothVelocity = useSpring(scrollVelocity, { damping: 50, stiffness: 400 });
const velocityFactor = useTransform(smoothVelocity, (v) => {
  const sign = v < 0 ? -1 : 1;
  return sign * Math.min(5, (Math.abs(v) / 1000) * 5);
});

// per-frame integration, delta-time correct
useAnimationFrame((_, delta) => {
  if (!isInViewRef.current || !isPageVisibleRef.current) return;
  const dt = delta / 1000;
  const vf = scrollReactivity ? velocityFactor.get() : 0;
  const absVf = Math.min(5, Math.abs(vf));
  const speedMultiplier = prefersReducedMotionRef.current ? 1 : 1 + absVf;
  if (absVf > 0.1) currentDirectionRef.current = baseDirectionRef.current * (vf >= 0 ? 1 : -1);
  const bw = unitWidth.get(); if (bw <= 0) return;
  const pixelsPerSecond = (bw * baseVelocity) / 100;
  baseX.set(baseX.get() + currentDirectionRef.current * pixelsPerSecond * speedMultiplier * dt);
});

// copies computed from measurement, not guessed
const nextCopies = bw > 0 ? Math.max(3, Math.ceil(containerWidth / blockWidth) + 2) : 1;
```

Five things to steal regardless of whether we use scroll reactivity:

1. **`wrap()`.** The double-modulo handles negative values correctly, which a naive `v % range` does not. This is *the* seamless-loop function; put it in `lib/math.ts`.
2. **`Math.max(3, ceil(containerW / blockW) + 2)` copies** — measured, not `repeat=4` guessed. Fixes §7.1's failure mode for wide containers.
3. **Everything is `useRef`, never `useState`, on the animation path** — `isInViewRef`, `isPageVisibleRef`, `prefersReducedMotionRef`. Zero re-renders per frame.
4. **Three independent pause gates**: IntersectionObserver (offscreen), `visibilitychange` (tab/game focus), and `matchMedia("(prefers-reduced-motion: reduce)")` (which here reduces the *multiplier* to 1 rather than stopping — a nice graduated response). For an Overwolf overlay, all three, plus a fourth: pause when the overlay is not the active window.
5. `aria-hidden={i !== 0}` on duplicate copies. Screen readers read the strip once. §7.1 gets this wrong and announces everything four times.

**Verdict:** use §7.1's CSS keyframe for the always-on worldstate bar (cheapest possible, pause-on-hover free), and lift `wrap()` + the copy-count formula + the four pause gates into it from §7.2. Scroll-velocity reactivity itself is not useful in an overlay — there is no long scroll.

---

## 8. Bento grids and dashboard layout

### 8.1 BentoGrid (Magic UI) — thin, and that is the point

VERIFIED: `https://magicui.design/r/bento-grid.json`. The entire grid:

```tsx
<div className="grid w-full auto-rows-[22rem] grid-cols-3 gap-4">{children}</div>
```

Cards default to `col-span-3` and each instance overrides via `className` (`lg:col-span-2`, `lg:row-span-2`). That is the whole layout system — **there is no component worth copying here, only the parameter choice**: fixed row height (`auto-rows-[22rem]`) + explicit per-card spans, rather than masonry or auto-flow-dense. Fixed rows means no layout shift when async data lands, which is what we want for a live dashboard.

The card is more interesting than the grid. Its hover choreography (VERIFIED):

```
group-hover:-translate-y-10          on the content block (lg only)
group-hover:scale-75                 on the icon, origin-left
translate-y-10 opacity-0 -> group-hover:translate-y-0 group-hover:opacity-100   on the CTA
group-hover:dark:bg-neutral-800/10   on a full-bleed overlay div
transition-all duration-300          throughout
transform-gpu                        on everything animated
```

Content slides up, icon shrinks toward its left origin, a CTA rises from below into the vacated space. One `group` hover, four coordinated transforms, no JS. **Copy this choreography wholesale** — it is the best-value hover in the survey.

Their shadow recipe is worth recording:

```
/* light */ [box-shadow:0_0_0_1px_rgba(0,0,0,.03),0_2px_4px_rgba(0,0,0,.05),0_12px_24px_rgba(0,0,0,.05)]
/* dark  */ dark:[box-shadow:0_-20px_80px_-20px_#ffffff1f_inset]
            dark:[border:1px_solid_rgba(255,255,255,.1)]
```

The dark variant is the interesting one: a huge **inset** shadow from *above* (`-20px` y, `80px` blur, `-20px` spread) at 12% white. That is not a drop shadow, it is a simulated top light source *inside* the card — it makes a flat dark panel read as a lit surface. Directly applicable: swap `#ffffff1f` for `var(--wf-gold)` at ~8% and it becomes Orokin ambient light. **Best single find for our dark panels.**

**Warframe adaptation.** Replace `rounded-xl` with our notch clip-path (§1.1). Replace the shadow stack with: inset top light + a 1px gold hairline via the two-layer clip trick + `GlowingEffect` (§2.3) on the focused card only. Keep `auto-rows-[22rem] grid-cols-3` as the base; use `grid-cols-12` in the real dashboard for finer spans.

### 8.2 Charts for account statistics

**Recommendation: `d3-shape@3.2.0` + hand-written SVG/canvas. Do not install a charting library.**

Reasoning, with the evidence:

- **Recharts 3.10.1** — VERIFIED to exist. It is React-component-per-mark, which means large datasets produce large trees, and it fights hard against custom geometry. Every Warframe chart we want is custom geometry (notched gauges, faction-hatched bars, angular area fills). Restyling Recharts to look Orokin is more work than drawing it.
- **Bklit itself does not use Recharts** — VERIFIED, it uses `@visx/*` + `d3-shape` + `motion`. The people who built 17 chart types for a design-engineering audience landed on d3 primitives. That is a strong signal.
- **`@visx/visx@4.0.0`** — VERIFIED. visx is essentially "d3 maths, React rendering". Legitimate choice, but the umbrella package is large and Bklit pins `4.0.1-alpha.0` scoped packages. If we want visx, take only `@visx/scale` and `@visx/shape`; but at that point it is `d3-scale` + `d3-shape` with a wrapper.
- **`uplot@1.6.32`** — VERIFIED. Canvas, ~45KB, renders 100k+ points at 60fps. **This is the right tool for one specific job**: a long time-series of session history / affinity over months, where SVG would produce tens of thousands of nodes. Keep it in the back pocket; do not use it for anything under ~2k points.
- `@nivo/core@0.99.0` (VERIFIED) — opinionated, heavy theming layer we would fight. Skip.
- `lightweight-charts@5.2.1` (VERIFIED) — TradingView; candlestick-shaped worldview. Only relevant if we chart platinum price history, where it would actually be excellent.

Concrete plan:

| Chart | Build |
|---|---|
| Mastery / affinity over time | `d3-shape` `area()` + `curveMonotoneX`, single SVG path, gradient fill, `stroke-dasharray` draw-on animation |
| Faction / damage-type breakdown | `d3-shape` `pie()` + `arc()` with `padAngle` — notched donut per §6.3 |
| Mission-type counts | Plain flex divs with `clip-path` chevron bars. No library. |
| Riven / mod roll distribution | `d3-array` `bin()` + divs |
| Long session history (>2k pts) | `uplot@1.6.32` |
| Platinum price history | `lightweight-charts@5.2.1` if we want real candles |

Animate any `d`-string chart by animating `stroke-dashoffset` from `path.getTotalLength()` to 0 — one line, works for every line/area chart, and reads exactly like a Warframe UI element drawing itself in.

---

## 9. Virtualised list/grid for thousands of owned items

**Package: `@tanstack/react-virtual@3.14.10`.** VERIFIED on npm 2026-08-31 — dist-tags `latest: 3.14.10`, single dependency `@tanstack/virtual-core@3.17.8`, peers `react ^16.8 || ^17 || ^18 || ^19`. **This is a real dependency we should install.** Hand-rolling windowing that handles dynamic row heights, scroll anchoring, and DPR-correct measurement is a genuine multi-week trap.

Alternatives, both VERIFIED to exist, both rejected:

- `react-window@2.3.0` — v2 is a full rewrite. Smaller, but no first-class dynamic measurement and a weaker grid story.
- `react-virtuoso@4.18.12` — batteries-included (grouping, sticky headers), but opinionated markup that will fight our notch geometry.

### 9.1 Fixed-size grid — the inventory case (Warframes, weapons, mods)

Grid virtualisation is **two virtualizers**, one per axis, crossed:

```tsx
import { useVirtualizer } from "@tanstack/react-virtual";

function ItemGrid({ items }: { items: Item[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const COLS = 6, CELL = 132, GAP = 8;
  const rowCount = Math.ceil(items.length / COLS);

  const rowVirt = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CELL + GAP,
    overscan: 4,
  });

  const colVirt = useVirtualizer({
    horizontal: true,
    count: COLS,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CELL + GAP,
    overscan: 2,
  });

  return (
    <div ref={parentRef} className="h-full overflow-auto contain-strict">
      <div style={{
        height: rowVirt.getTotalSize(),
        width:  colVirt.getTotalSize(),
        position: "relative",
      }}>
        {rowVirt.getVirtualItems().map((row) =>
          colVirt.getVirtualItems().map((col) => {
            const item = items[row.index * COLS + col.index];
            if (!item) return null;
            return (
              <div
                key={item.id}
                style={{
                  position: "absolute", top: 0, left: 0,
                  width: col.size, height: row.size,
                  transform: `translate3d(${col.start}px, ${row.start}px, 0)`,
                }}
              >
                <ItemTile item={item} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
```

Non-obvious points:

- **`transform: translate3d(x, y, 0)`, not `top`/`left`.** Positioned offsets cause layout on every scroll frame; a 3D transform promotes to a compositor layer. With 60 visible tiles this is the difference between 60fps and 20.
- **`contain: strict`** on the scroll container tells the browser nothing inside affects outside layout. Free, and it matters at this scale.
- **`overscan`** is asymmetric on purpose — 4 rows vertically (scroll direction), 2 columns horizontally.
- **`key` must be the stable item id, not the index.** Index keys make React reuse a DOM node for a different item, and any CSS transition on that node animates *between two different items*. Very visible with our glow/hover effects.
- `getScrollElement` is called on every measure — return the ref, do not create anything in it.

### 9.2 Dynamic-height list — mod/riven descriptions of varying length

```tsx
const rowVirt = useVirtualizer({
  count: rows.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 72,          // best guess; corrected by measurement
  overscan: 8,
  getItemKey: (i) => rows[i].id,   // stable keys survive re-measure
});

// on each rendered row:
<div
  key={v.key}
  data-index={v.index}
  ref={rowVirt.measureElement}     // ResizeObserver-backed auto-measure
  style={{ position: "absolute", top: 0, left: 0, width: "100%",
           transform: `translateY(${v.start}px)` }}
>
```

`ref={rowVirt.measureElement}` plus `data-index` is the whole dynamic-height API — it wires a ResizeObserver and re-measures on content change. **`data-index` is mandatory**; without it `measureElement` cannot map the element back to a row and silently does nothing.

### 9.3 Scale reality check

A full Warframe account is roughly: ~60 Warframes, ~500 weapons, ~1,200 mods, ~600 relics, several thousand inventory rows in total, and up to ~15k if we index every component and blueprint. Virtualisation is required above ~300 rendered tiles — but note the real cost driver is **per-tile effects**, not the tiles. 60 visible tiles each running a `GlowingEffect` (§2.3) means 60 `pointermove` handlers on `document.body`. **Mitigation: one shared cursor context.** Track the pointer once at the grid level, publish `x`/`y` as a MotionValue on context, and have tiles read from it. Tiles then use §2.4's CSS-variable-only glare, not §2.3.

Pair with `@tanstack/react-table@9.2.4` (VERIFIED as current `latest`) only if we need sorting/filtering/grouping over the same rows — it is headless and composes with react-virtual by design.

---

## 10. Command palette / Ctrl+K omnisearch

**Package: `cmdk@1.1.1`.** VERIFIED on npm 2026-08-31. Dependencies: `@radix-ui/react-dialog@^1.1.6`, `@radix-ui/react-id@^1.1.0`, `@radix-ui/react-primitive@^2.0.2`, `@radix-ui/react-compose-refs@^1.1.1`. Peers `react ^18 || ^19 || ^19.0.0-rc`.

**Install it.** This is the second and last justified dependency. cmdk gives you keyboard navigation with correct roving focus, ARIA combobox/listbox semantics, scroll-into-view on arrow keys, group headings that hide when empty, and value-based selection. Every one of those is a bug factory hand-rolled, and the a11y is not optional.

The Radix dialog dependency comes in via `Command.Dialog`. If we already use Radix elsewhere it is free; if not, we can use bare `<Command>` inside our own overlay container and the dialog code tree-shakes.

### 10.1 Shape

```tsx
import { Command } from "cmdk";

<Command
  label="Omnisearch"
  shouldFilter={false}                 // we filter ourselves — see 10.2
  value={active}
  onValueChange={setActive}
  loop                                 // arrow keys wrap around
>
  <Command.Input value={q} onValueChange={setQ} placeholder="Search account…" />
  <Command.List>
    <Command.Empty>No results.</Command.Empty>

    <Command.Group heading="Warframes">
      {frameHits.map((f) => (
        <Command.Item key={f.id} value={f.id} onSelect={() => go(f)}>
          {f.name}
        </Command.Item>
      ))}
    </Command.Group>

    <Command.Group heading="Mods">{/* … */}</Command.Group>
  </Command.List>
</Command>
```

Ctrl+K binding is ours to write (cmdk deliberately does not own global hotkeys):

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "k" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOpen((o) => !o); }
    if (e.key === "Escape") setOpen(false);
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}, []);
```

**Overwolf note:** an overlay does not reliably receive keyboard events while the game has focus. Register Ctrl+K as an **Overwolf hotkey** in `manifest.json` under `hotkeys` and listen via `overwolf.settings.hotkeys.onPressed`, then fall back to the DOM listener when the overlay itself has focus. Do both; neither alone covers all states.

### 10.2 Scoring: turn off cmdk's filter

cmdk's built-in `filter` is a single-pass string matcher over all items. Across a full account (§9.3, up to ~15k rows) that runs on every keystroke and is both slow and low-quality.

**Do this instead:**

1. `shouldFilter={false}` — cmdk renders exactly what we give it.
2. Score in a `useDeferredValue` + `useMemo` with `fuse.js@7.5.0` (VERIFIED) over a pre-built index, or hand-roll a subsequence matcher.
3. Slice to the top ~8 per category before rendering. Never hand cmdk 15k items.

Hand-rolled scorer, if we want zero dependencies (this is ~20 lines and beats a naive `includes()` badly):

```ts
// subsequence match with bonuses for word-start and consecutive hits
function score(needle: string, hay: string): number {
  const n = needle.toLowerCase(), h = hay.toLowerCase();
  let hi = 0, s = 0, streak = 0;
  for (let i = 0; i < n.length; i++) {
    const idx = h.indexOf(n[i], hi);
    if (idx === -1) return 0;                       // not a subsequence -> reject
    s += idx === 0 || h[idx - 1] === " " ? 12 : 4;  // word-start bonus
    streak = idx === hi ? streak + 1 : 0;
    s += streak * 6;                                // consecutive-run bonus
    hi = idx + 1;
  }
  return s - h.length * 0.1;                        // mild shortness preference
}
```

Prefix the index entries with aliases so `"sp"` finds Steel Path, `"eb"` finds Exalted Blade, `"pt"` finds Profit-Taker. That aliasing is what makes an omnisearch feel like it knows the game.

### 10.3 Making it Warframe

Category ordering weighted by recency and by session context (in a mission, surface mission things first). Kbd hints on rows via the scificn `Kbd` component idea (§1) — square, 1px, monospace, no radius. Wrap the whole palette in a notch panel (§1.1) with `GlowingEffect` (§2.3) on the border, and animate open with `useAnimate` (§11.2) as a three-step sequence rather than a fade: backdrop dims, panel notches unfold, rows stagger in.

---

## 11. `motion` v13 — the API surface we actually need

VERIFIED: `motion@13.1.1` is current `latest` on npm. Docs fetched from motion.dev this session.

### 11.1 Spring configs — adopt as named tokens

Collected from the sources above, all VERIFIED in their originating components:

```ts
// src/lib/motion-tokens.ts
export const SPRING_COUNTER = { damping: 60, stiffness: 100 };                 // NumberTicker §5.1 — overdamped, no overshoot
export const SPRING_CURSOR  = { stiffness: 250, damping: 30, mass: 0.6 };      // MagicCard orb §3.1 — trailing, alive
export const SPRING_ORB_FADE= { stiffness: 300, damping: 35 };                 // MagicCard visibility §3.1
export const SPRING_SCROLL  = { damping: 50, stiffness: 400 };                 // ScrollVelocity §7.2 — snappy smoothing
export const SPRING_BAR     = { stiffness: 100, damping: 30, restDelta: 0.001 };// motion.dev scroll-progress example

export const EASE_EXPO_OUT  = [0.16, 1, 0.3, 1] as const;  // used by BOTH Aceternity §2.3 and Magic UI §2.1 — the house curve
```

`EASE_EXPO_OUT` appearing independently in two libraries is not a coincidence; `cubic-bezier(0.16, 1, 0.3, 1)` is the standard easeOutExpo and it is the right default for UI that should feel *mechanically decisive*. **Make it our global default easing.**

Motion v13 also supports duration-based springs, which are easier to reason about than stiffness/damping (VERIFIED from motion.dev/docs/animate):

- `bounce` — 0 to 1, default 0.25. 0 = no bounce.
- `visualDuration` — overrides `duration`; the time to *visually* reach the target, ignoring the settle tail.

```ts
// "arrives in 400ms, barely bounces" — reads better than guessing stiffness
{ type: "spring", visualDuration: 0.4, bounce: 0.15 }
```

Physics defaults for reference: `stiffness: 1`, `damping: 10`, `mass: 1`.

### 11.2 `useAnimate` — scoped imperative timelines

VERIFIED from motion.dev/docs/react-use-animate and motion.dev/docs/animate.

```tsx
const [scope, animate] = useAnimate();
return <div ref={scope}>{children}</div>;

// animate the scoped element:
animate(scope.current, { opacity: 1 }, { duration: 1 });
// or any descendant, by selector, scoped to this subtree:
animate("li", { backgroundColor: "#000" }, { ease: "linear" });
```

Animations are cleaned up automatically on unmount. Sequences are arrays of `[target, keyframes, options]`, sequential by default:

```ts
animate([
  ["ul", { opacity: 1 }, { duration: 0.5 }],
  ["li", 100,            { ease: "easeInOut" }],
]);
```

The `at` option controls placement (VERIFIED):

| `at` value | Meaning |
|---|---|
| `0.5` | absolute time, 0.5s into the sequence |
| `"<"` | start together with the previous segment |
| `"+0.5"` | 0.5s **after** the previous segment ends |
| `"-0.2"` | 0.2s **before** the previous segment ends (overlap) |
| `"<0.5"` | 0.5s after the previous segment **started** |

Segments accept every `animate` option except `repeatDelay` and `repeatType`.

```ts
import { animate, stagger } from "motion";
animate(".item", { x: 300 }, { delay: stagger(0.1) });
```

Returned controls (VERIFIED):

```ts
const a = animate(el, { opacity: 0 });
a.time = 0.5;      // get/set current time (scrubbable)
a.speed = 2;       // get/set playback rate
a.duration;        // read-only
a.pause(); a.play(); a.complete(); a.cancel(); a.stop();
await a;           // promise-like, resolves on finish
```

**This is exactly what a Warframe panel-open sequence needs.** Concrete:

```ts
const [scope, animate] = useAnimate();

async function openPanel() {
  await animate([
    [scope.current, { "--notch": "0px" },          { duration: 0 }],
    [scope.current, { opacity: 1 },                { duration: 0.12 }],
    [scope.current, { "--notch": "14px" },         { duration: 0.32, ease: EASE_EXPO_OUT }],
    [".panel-rule", { scaleX: [0, 1] },            { duration: 0.28, at: "<0.08", ease: EASE_EXPO_OUT }],
    [".panel-row",  { opacity: [0, 1], x: [-12, 0] },
                    { duration: 0.24, delay: stagger(0.035), at: "-0.14" }],
    [".panel-glow", { opacity: [0, 1, 0.6] },      { duration: 0.5, at: "<" }],
  ]);
}
```

The chamfer unfolds, a rule wipes across before it finishes, rows stagger in overlapping the rule, and the border glow blooms and settles — one declarative block, no nested timeouts. `a.speed = 2` gives us a "fast UI" accessibility setting for free, and `a.speed = 0.25` is a debugging tool for tuning the choreography.

Animating a CSS custom property (`--notch`) through Motion requires the `@property` registration from §1.1.

### 11.3 Scroll-linked effects

VERIFIED from motion.dev/docs/react-scroll-animations. The distinction: **scroll-triggered** fires when an element enters/leaves the viewport (`useInView`); **scroll-linked** binds a style continuously to scroll position (`useScroll`).

`useScroll()` returns `scrollX`, `scrollY` (pixels) and `scrollXProgress`, `scrollYProgress` (0-1). Options:

- `target` — a ref; tracks that element's progress through the viewport instead of the page.
- `offset` — when progress starts and ends, e.g. `["start end", "end start"]`.
- `container` — a ref for a custom scroll container (**required for us** — the overlay scrolls a panel, not the window).
- `axis` — which axis to track.

```tsx
const { scrollYProgress } = useScroll({ container: listRef });
const scaleX = useSpring(scrollYProgress, SPRING_BAR);
return <motion.div style={{ scaleX, transformOrigin: "0%" }} className="h-px bg-[--wf-gold]" />;
```

`useTransform` maps progress to any value, including strings:

```tsx
const filter = useTransform(scrollYProgress, [0, 1], ["blur(0px)", "blur(10px)"]);
```

**For our overlay, scroll-linked is mostly the wrong tool** — there is no long scroll to link to. The two real uses: (1) a scroll-progress rail on the inventory grid, (2) `useVelocity(scrollY)` (§7.2) to add drag/skew to fast-scrolling item tiles, which is a cheap and very "game UI" touch.

### 11.4 Layout animations

`layout` on a `motion` component makes position/size changes animate via FLIP (transform-only, no layout thrash). `layoutId` shared across two components makes one morph into the other across a mount/unmount boundary.

Direct applications, in priority order:

1. **Tab underline / active-panel indicator** — one `layoutId="nav-active"` element inside the active tab. Slides and resizes between tabs automatically.
2. **Item tile -> detail panel** — same `layoutId` on the grid tile's frame and the detail view's frame. The tile *expands* into the detail. This is the single highest-impact animation available to us for the money.
3. **Filter/sort reflow of the inventory grid** — `layout` on tiles so re-sorting slides them rather than snapping.

Two constraints, both important at our scale:

- **`layout` conflicts with virtualisation.** Virtualised tiles are absolutely positioned by transform (§9.1); Motion's FLIP also writes transform. Do not put `layout` on virtualised tiles. Use `layoutId` only for the tile-to-detail morph, on a non-virtualised overlay clone of the tile.
- Wrap the morph in `<LayoutGroup>` and remember that `layout` reads layout on every affected element each frame it starts. Fine for 1-20 elements; not for 600.

---

## 12. Consolidated verdict

### Install these three (and nothing else from this survey)

| Package | Version | Why |
|---|---|---|
| `motion` | 13.1.1 | Already in the stack. Covers §11 entirely. |
| `@tanstack/react-virtual` | 3.14.10 | §9. Not worth hand-rolling. |
| `cmdk` | 1.1.1 | §10. The a11y and roving focus alone justify it. |

Plus, when charts land: `d3-shape@3.2.0` (pure path maths, §6/§8), and `uplot@1.6.32` only if a dataset exceeds ~2k points.

Optional single-purpose: `@number-flow/react@0.6.2` if we want per-digit odometer rolls (§5.2). `fuse.js@7.5.0` if the hand-rolled scorer in §10.2 proves insufficient.

### Copy the technique, not the package, from

| Source | What we take |
|---|---|
| **scificn-ui** | The corner-notch `clip-path` triple (§1.1) — most valuable single find. Glow ratio convention, scanline gradient, ProgressRing structure (§6.1). |
| **Aceternity** | GlowingEffect: `atan2` + shortest-path angle wrap + conic-gradient-as-mask + `background-attachment: fixed` (§2.3). CardSpotlight's mask-image spotlight and its shader ideas ported to 2D canvas (§3.2). Generated (not literal) beam paths (§4.5). |
| **Magic UI** | FlickeringGrid's canvas engine — Float32Array, deltaTime flicker, IntersectionObserver gating (§4.1). NumberTicker's `.on("change")` DOM writes and `SPRING_COUNTER` (§5.1). Marquee's `calc(-100% - var(--gap))` (§7.1). ScrollVelocity's `wrap()` and measured copy count (§7.2). BentoCard's four-transform hover choreography and the **inset top-light shadow** (§8.1). BorderBeam's `offset-path` + negative delay (§2.1). ShineBorder's `mask-composite: exclude` (§2.2). |
| **React Bits** | GlareHover's CSS-variables-only architecture (§2.4). DotGrid's velocity-impulse interaction model, rebuilt without GSAP InertiaPlugin (§4.7). |
| **KokonutUI** | Little. Its particle-button is a `motion.div` burst of 6 dots with staggered `delay: i * 0.1` and `scale: [0, 1, 0]` — fine, generic, and its `handleClick` never calls the passed `onClick` or `onSuccess` (a real bug, VERIFIED in source). Take the 6-particle burst pattern for confirm actions; ignore the rest. |
| **Bklit** | Not a library to install — a signal. It proves `@visx` + `d3-shape` + `motion` + `@number-flow/react` is the right chart stack over Recharts, and that a **notch gauge** is a solved shape (§6.3). |
| **21st.dev** | A meta-index (12,000+ components, 246 registries) rather than a source. Its real value here was surfacing scificn-ui. Use it as a search engine when we need a specific pattern; its "border" category alone has 111+ entries. |

### The five snippets to write first

1. **`.wf-panel` two-layer notch frame** with `@property --notch` (§1.1) — everything else sits inside it.
2. **`GlowingEffect` rebuilt** against that notch, with `--spread` driven by game state (§2.3).
3. **`wf-canvas-field`** — FlickeringGrid's engine (§4.1) with Orokin diamond glyphs and the velocity impulse from §4.7.
4. **`ProgressRing`** with the wide-low-opacity bloom arc, segmented via `d3-shape` `arc().padAngle()` (§6.1, §6.3).
5. **`motion-tokens.ts`** — the spring table and `EASE_EXPO_OUT` from §11.1, before any animation is written, so nothing is tuned ad hoc.

### Open questions this research did not answer

- Overwolf's exact compositing behaviour with `mix-blend-mode: screen` and `backdrop-filter` over a running game — needs empirical testing, not documentation. `backdrop-filter` in particular may sample black rather than the game frame.
- Whether `offset-path: path()` with `offset-rotate: auto` (§2.1) performs acceptably at 8+ simultaneous instances. Untested.
- Actual Warframe hex values. **Nothing in this document is a Warframe colour** — every hex here is the source library's own. The palette must come from the forensic-accuracy research, not from here.

### Sources (all fetched 2026-08-31)

- Magic UI registry: `https://magicui.design/r/{border-beam,number-ticker,marquee,animated-grid-pattern,magic-card,meteors,animated-circular-progress-bar,animated-beam,shine-border,flickering-grid,bento-grid,ripple,scroll-based-velocity}.json`
- Aceternity registry: `https://ui.aceternity.com/registry/{glowing-effect,card-spotlight,background-beams,aurora-background}.json`
- scificn-ui: `https://www.scificn.dev/r/{panel,progress-ring}.json` · `https://raw.githubusercontent.com/baxy5/scificn-ui/main/src/styles/globals.css` · `https://github.com/baxy5/scificn-ui`
- React Bits: `https://raw.githubusercontent.com/DavidHDev/react-bits/main/src/content/{Backgrounds/DotGrid/DotGrid.jsx,Animations/GlareHover/GlareHover.jsx}`
- KokonutUI: `https://kokonutui.com/r/particle-button.json` · `https://kokonutui.com/docs`
- Bklit: `https://bklit.com/r/gauge-chart.json` · `https://bklit.com/docs/installation` · `https://bklit.com/`
- 21st.dev: `https://21st.dev/` · `https://21st.dev/community/components/s/border`
- Motion: `https://motion.dev/docs/animate` · `https://motion.dev/docs/react-use-animate` · `https://motion.dev/docs/react-scroll-animations`
- npm: `https://registry.npmjs.org/{package}` — all versions in §0 read from live `dist-tags`.
