# Warframe UI — Geometry & Ornament

Research for RaijiFrame. Topic: **the constructed visual language of Warframe's interface** —
panel shapes, ornament, edges, layout proportions, the energy-line motif, and depth.

Written 2026-08-31. Every number below is tagged:

| Tag | Meaning |
|---|---|
| **[V]** | **Verified.** I loaded the source, sampled the pixels or read the file, and the URL is given. Numbers are actual measurements. |
| **[I]** | **Inferred.** Derived by reasoning from a [V] measurement (e.g. scaling 1600px → 1920px), or a pattern seen twice and generalised. |
| **[G]** | **Guessed.** Design judgement. Looks right, is not evidence. Marked so you can overrule it. |

Nothing here is a hex value I made up and dressed as fact. Where I could not sample, I say so.

---

## 0. Method & evidence log

I drove a real browser (which passes wiki.warframe.com's Cloudflare interstitial), loaded
official screenshots into a **same-origin `<canvas>`**, and read pixels directly with
`getImageData`. So the geometry below is not eyeballed from a thumbnail — it is edge-scanned
at 1:1.

**Sources actually opened and measured:**

| Source | What it gave |
|---|---|
| `https://wiki.warframe.com/images/Arsenal_Main_Screen_41.0.7.jpg` (1920×1080) | Current (Update 41) Arsenal chrome. Layout proportions, panel fills, scrim ramp, stat-row rhythm. |
| `https://wiki.warframe.com/images/Devshort_115_Riven_QoL_1.png` (1600×900) | Riven cycling screen. **The button hexagon, the double border, the header ornament, the mod card.** The single richest ornament reference I found. |
| `https://wiki.warframe.com/images/Lotus%28xWhite%29.svg` (600 × 355.79) | The Lotus emblem as vector. 11 paths; bounding boxes gave the exact nesting rule. |
| `https://wiki.warframe.com/images/LegacyBackgroundFullscreen.jpg` | Login screen — the WARFRAME crest and the minimal-chrome form language. |
| `https://www-static.warframe.com/build/assets/app-B2bJ_Euw.css` | Digital Extremes' own site CSS. Brand gold and their gold-metal gradient, verbatim. |
| `https://wiki.warframe.com/w/Settings/Interface/Backgrounds_and_Themes` | The 20-odd shipped UI themes; theme icons sampled for accent colour. |

**Sources I could not use:** `gameuidatabase.com` (navigation blocked in this environment).
`wiki.warframe.com/index.php?title=User_Interface&action=raw` → 404 (page does not exist).
WebFetch summarisation of wiki pages returned paraphrase, not wikitext — as warned; I did not
rely on any of it.

---

## 1. The forensic correction you need before you start

**The brief assumes Warframe panels are chamfered. In the current build, mostly they are not.**

I measured the Update 41 Arsenal at 1:1. The loadout list, the item description panel, the
stat readout, the `CONCLAVE` / `EXIT` buttons — **all plain axis-aligned rectangles with a 1px
hairline border.** No corner cuts at all. **[V]**

The angular language is real, but it lives in a specific, smaller set of places:

| Where the cuts actually are | Evidence |
|---|---|
| **Action buttons / CTAs** — the elongated hexagon with chamfered end caps | **[V]** measured, §2.1 |
| **Ribbons & badges** — the `MR 12` bar on a mod card, rank ribbons | **[V]** seen on the Riven card |
| **Mod cards** — faceted, shard-like frame, cut illustration corners | **[V]** |
| **HUD** — ability icons, the shield/health bar caps | **[I]** |
| **Ornament** — the X-flourishes, diamonds, and circuit traces around buttons | **[V]** |

So the honest structure for RaijiFrame is:

> **Rectangles carry the information. Cuts carry the action.**
> A chamfer in Warframe is a signal that something is *pressable* or *earned*, not a decoration
> sprayed on every div. Chamfer everything and you get a 2014 sci-fi-UI-kit look, which is
> exactly what Warframe's current art direction moved *away* from.

That is the replica half. §9 is where we deliberately break this rule and go overboard — but
knowingly, with a switch, not by accident.

---

## 2. Panel shapes — measured, then a clip-path library

### 2.1 The button hexagon — the one shape I measured exactly

Two buttons in the same 1600×900 screenshot, edge-scanned row by row for the bright border pixel.

**`LOCK TRAITS` button** — left/right extents per scanline **[V]**:

```
y=731  x: 107 … 313     <- top edge
y=745  x:  94 … 327
y=760  x:  79 … 341     <- vertical centre, the tips
y=775  x:  94 … 327
y=788  x: 107 … 313     <- bottom edge
```

* Bounding box **263 × 58 px**
* Chamfer horizontal run: `107 − 79 =` **28 px** at each end, perfectly mirrored
* Half-height 29 px → flank angle `atan(29/28)` = **46.0° from horizontal**
* The tips land exactly on the vertical centre line — it is a true elongated hexagon, not a
  parallelogram.

**`CYCLE FOR ⬤1,000` button** — same image **[V]**:

* Bounding box **362 × 45 px** (x 618…980, y 779…823)
* Chamfer horizontal run: **28 px** again
* Half-height 22.5 px → flank angle `atan(22.5/28)` = **38.8° from horizontal**

> **The finding:** the chamfer run is **28 px in both**, while the heights differ (58 vs 45).
> DE is using a **fixed chamfer inset, not a fixed angle.** **[V]** for n=2, **[I]** as a general rule.
>
> 28 px on a 1600-wide capture ≈ **1.75 % of viewport width** ≈ **33–34 px at 1920×1080**. **[I]**

This matters a lot for implementation. A `polygon(0 50%, …)` percentage chamfer changes angle
with element height and looks wrong next to a fixed one. Use px.

### 2.2 The double border — measured

Vertical slice at x=760 through the `CYCLE FOR` button, luminance 0–255 **[V]**:

```
y 779      : 167   <- outer border, bright
y 780-784  :  21      fill
y 785      :  93   <- inner border, dim
y 786-806  :  21      fill
y 818      :  93   <- inner border, dim
y 823      : 167   <- outer border, bright
```

* **Outer stroke 1 px, inner stroke 1 px, gap 6 px.** **[V]**
* Inner stroke luminance is **56 %** of the outer (93 / 167). **[V]**
* Same 6 px inset measured independently on `LOCK TRAITS` (border 732, inner 738). **[V]**

That 1px / 6px / 1px sandwich is *the* Warframe edge. It is cheap and it is the highest-yield
single detail in this whole document.

### 2.3 The clip-path library

```css
/* ---------------------------------------------------------------------------
   Warframe cut geometry.
   --cut is an ABSOLUTE length, deliberately. Percentage chamfers change angle
   with element size; DE's do not.  Measured: 28px @1600w  ->  ~34px @1920w.
   Scale the whole set from one variable so a 4K overlay stays proportional.
--------------------------------------------------------------------------- */
:root {
  --cut-xs: 6px;    /* chips, tags, tiny badges          */
  --cut-sm: 10px;   /* list rows, inputs, tabs           */
  --cut-md: 16px;   /* cards, secondary panels           */
  --cut-lg: 24px;   /* primary panels                    */
  --cut-xl: 34px;   /* modals, hero panels, CTA end caps */
}

/* 1. PRIMARY CONTENT PANEL — opposite corners cut (TL + BR).
      The asymmetry is what makes it read as Warframe rather than as a
      generic "sci-fi" octagon. Never cut all four the same. */
.wf-panel {
  clip-path: polygon(
    var(--cut-lg) 0,
    100% 0,
    100% calc(100% - var(--cut-lg)),
    calc(100% - var(--cut-lg)) 100%,
    0 100%,
    0 var(--cut-lg)
  );
}

/* 1b. Mirror variant, for a panel on the opposite side of the screen.
       Use .wf-panel on the left rail, .wf-panel--mirror on the right rail:
       the cuts then both point "outward", away from the centre of the screen. */
.wf-panel--mirror {
  clip-path: polygon(
    0 0,
    calc(100% - var(--cut-lg)) 0,
    100% var(--cut-lg),
    100% 100%,
    var(--cut-lg) 100%,
    0 calc(100% - var(--cut-lg))
  );
}

/* 2. SECONDARY CARD — single corner cut, top-right.
      One cut only. The moment you cut two corners on a small card it starts
      to read as a hexagon and stops reading as a card. */
.wf-card {
  clip-path: polygon(
    0 0,
    calc(100% - var(--cut-md)) 0,
    100% var(--cut-md),
    100% 100%,
    0 100%
  );
}

/* 2b. Card, cut bottom-left — pairs with .wf-card in a two-column grid. */
.wf-card--alt {
  clip-path: polygon(
    0 0, 100% 0, 100% 100%,
    var(--cut-md) 100%,
    0 calc(100% - var(--cut-md))
  );
}

/* 3. BUTTON — the measured hexagon. Cut = half the height gives DE's 45-46 deg;
      a shorter button with the same --cut gives their shallower 38 deg, which is
      correct and intentional. Do not "fix" it to 45. */
.wf-btn {
  --cut: 34px;
  clip-path: polygon(
    0 50%,
    var(--cut) 0,
    calc(100% - var(--cut)) 0,
    100% 50%,
    calc(100% - var(--cut)) 100%,
    var(--cut) 100%
  );
}

/* 3b. Half-hex — flat left edge, chamfered right end. For a button that sits
      flush against a rail or the screen edge. */
.wf-btn--flush-left {
  --cut: 34px;
  clip-path: polygon(
    0 0, calc(100% - var(--cut)) 0, 100% 50%,
    calc(100% - var(--cut)) 100%, 0 100%
  );
}

/* 4. TAB — top square so it butts cleanly against the panel it belongs to,
      bottom-right sheared. Reads as a "tongue" plugged into the panel. */
.wf-tab {
  clip-path: polygon(
    0 0, 100% 0,
    calc(100% - var(--cut-sm)) 100%,
    0 100%
  );
}
/* Active tab: shear the other way so the pair interlock. */
.wf-tab[aria-selected='true'] {
  clip-path: polygon(
    var(--cut-sm) 0, 100% 0, 100% 100%, 0 100%
  );
}

/* 5. LIST ROW — bottom-left notch only, ~10px. At row scale anything larger
      eats the text. The selected row gets a leading chevron instead. */
.wf-row {
  clip-path: polygon(
    0 0, 100% 0, 100% 100%,
    var(--cut-sm) 100%,
    0 calc(100% - var(--cut-sm))
  );
}

/* 6. MODAL — large opposite cuts plus a centred top notch. The notch is the
      "docking port" motif: it says something plugs in here. Proportions are
      [G]; the notch idea is [V] from Warframe's dialog headers. */
.wf-modal {
  clip-path: polygon(
    0 var(--cut-xl),
    var(--cut-xl) 0,
    calc(50% - 64px) 0,
    calc(50% - 46px) 16px,
    calc(50% + 46px) 16px,
    calc(50% + 64px) 0,
    calc(100% - var(--cut-xl)) 0,
    100% var(--cut-xl),
    100% calc(100% - var(--cut-xl)),
    calc(100% - var(--cut-xl)) 100%,
    var(--cut-xl) 100%,
    0 calc(100% - var(--cut-xl))
  );
}

/* 7. NOTCHED EDGE — a bite out of one side, for docking a badge/avatar into
      a panel edge. The Riven screen does exactly this: the Kavat icon
      overhangs the left cap of the LOCK TRAITS button. [V] */
.wf-notch-left {
  --notch: 44px;
  clip-path: polygon(
    0 0, 100% 0, 100% 100%, 0 100%,
    0 calc(50% + var(--notch) / 2),
    calc(var(--notch) / 2) 50%,
    0 calc(50% - var(--notch) / 2)
  );
}

/* 8. RIBBON — the `MR 12` bar. Same hexagon as the button but squat, and
      always centred under whatever it labels. [V] shape, [G] proportions. */
.wf-ribbon {
  --cut: 12px;
  height: 24px;
  clip-path: polygon(
    0 50%, var(--cut) 0, calc(100% - var(--cut)) 0,
    100% 50%, calc(100% - var(--cut)) 100%, var(--cut) 100%
  );
}
```

### 2.4 Making a chamfered shape that still has a border

`clip-path` destroys `border`. Two techniques; use the second.

**A. Nested elements (simplest, works everywhere).**

```css
.wf-frame         { background: var(--edge); clip-path: var(--clip); position: relative; }
.wf-frame::before { content: ''; position: absolute; inset: 1px;
                    background: var(--fill); clip-path: var(--clip); }
```

The inner polygon re-resolves its percentages against the inset box, so the ring is 1px on
straight edges and ~1.4px on the 45° flanks. Acceptable; slightly heavy at the cuts.

**B. `mask-composite` ring — geometrically exact, and it gives you DE's double border.**

```css
.wf-frame {
  position: relative;
  background: var(--wf-fill);
  clip-path: var(--clip);
}

/* Both strokes share the clip, so they follow the chamfer. */
.wf-frame::before,
.wf-frame::after {
  content: '';
  position: absolute;
  inset: 0;
  clip-path: var(--clip);
  box-sizing: border-box;
  pointer-events: none;

  /* border-box mask MINUS content-box mask == a ring of `padding` thickness */
  -webkit-mask: linear-gradient(#000 0 0) content-box,
                linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
}

.wf-frame::before {           /* outer stroke */
  padding: 1px;
  background: var(--wf-edge);
}

.wf-frame::after {            /* inner stroke: 6px in, 56% brightness  [V] */
  inset: 6px;
  padding: 1px;
  background: var(--wf-edge);
  opacity: 0.56;
}
```

The `inset: 6px` + `opacity: .56` are the two measured constants from §2.2 — that pairing is
what actually makes it look like Warframe rather than like a generic outlined box.

---

## 3. The Lotus emblem and Orokin motifs

### 3.1 The Lotus mark, structurally derived

I parsed `Lotus(xWhite).svg` and took the `getBBox()` of every path, then rasterised it and
scanned the silhouette row by row. Results **[V]**:

* Canvas **600 × 355.79** → aspect **1.686 : 1**. Wide and low. Do not draw it square.
* Perfect mirror symmetry about **x = 300** (verified: outer wings occupy x 0–126 and
  x 474–600; 600 − 126 = 474 exactly).
* **Three nested chevrons** on the centreline, bounding boxes:

| Chevron | Width | Height | Aspect | Scale vs previous |
|---|---|---|---|---|
| outer | 344.0 | 303.7 | 1.133 | — |
| middle | 225.6 | 198.2 | 1.138 | **0.656** |
| inner | 149.3 | 131.1 | 1.139 | **0.662** |

> **Two exact construction rules fall out of this. [V]**
> 1. Every chevron has the **same aspect ratio, 1.138 : 1**.
> 2. Each nested chevron is **exactly 2/3 the size** of the one outside it (0.656, 0.662).

* The chevrons are **not concentric**. Their bottoms step *down* by a constant **18.5 units**
  each, and their apexes descend by 124 then 85.6 units (ratio 0.69 ≈ 2/3 again). **[V]**
* **Two mirrored wing pairs** below and outside: outer wings 126 × 171.6, inner wings
  74.3 × 88.3. Inner/outer ≈ 0.59 wide, 0.51 tall. **[V]**

**Silhouette profile of the outer chevron** (half-width vs. distance from the apex, measured by
alpha-scanning the rasterised SVG) **[V]**:

```
y :   20   40   60   80  100  120  140  150  165
hw:    7   22   44   69   99  133  169  172  172
```

Fit: `halfWidth ≈ 0.111 · (y − 8)^1.5`, holding to within 3 px from y=20 to y=140, then the
flank straightens and the shape terminates. **[I]** — i.e. the flanks are **gently convex,
accelerating outward**, asymptotically approaching `dx/dy ≈ 1.47` (**34.2° from horizontal**).
They are *not* straight lines, and drawing them straight is the single most common way a Lotus
reconstruction looks wrong.

### 3.2 Lotus reconstruction — SVG

> **Legal note, read it.** The Lotus mark is Digital Extremes' trademark. What follows is a
> **reconstruction built from the derived rules above** (2/3 nesting, 1.138 aspect, the convex
> flank curve), not a trace of DE's path data. Use it as a *shape system* for our own ornament
> — a rank pip, a loading spinner, a section marker. Do **not** ship it as a pretend-official
> Lotus, and keep it out of anything that could read as DE branding.

```html
<!-- Lotus-family crest. Reconstruction. viewBox matches the real mark's 600x356. -->
<svg viewBox="0 0 600 356" xmlns="http://www.w3.org/2000/svg"
     fill="currentColor" aria-hidden="true">
  <defs>
    <!-- One chevron band. Apex at (300,0); half-width 172; depth 173.
         Flank control points come from the measured 0.111*(y-8)^1.5 curve. -->
    <path id="wf-chev"
      d="M300 0
         C 308.6 62.3  429 107.3  472 138.4
         L 472 173
         L 300 96
         L 128 173
         L 128 138.4
         C 171 107.3  291.4 62.3  300 0 Z"/>
  </defs>

  <!-- three nested chevrons: scale 1, 2/3, 4/9; apex descends 71 then 48 -->
  <use href="#wf-chev" y="8"/>
  <use href="#wf-chev" y="79"  transform="scale(0.66)"   transform-origin="300 0"/>
  <use href="#wf-chev" y="127" transform="scale(0.4356)" transform-origin="300 0"/>

  <!-- wing pairs: swept blades, outer 126x172, inner 74x88, mirrored about x=300 -->
  <g id="wf-wings">
    <path d="M0 184 C 34 232  76 272  126 300 L 108 356 C 58 316  20 252  0 184 Z"/>
    <path d="M81 243 C 100 274  126 300  155 316 L 143 332 C 110 318  92 286  81 243 Z"/>
  </g>
  <use href="#wf-wings" transform="scale(-1 1)" transform-origin="300 0"/>
</svg>
```

The `transform-origin="300 0"` on the `<use>` elements is what keeps everything locked to the
centreline while scaling. Tune only the three `y=` values and the two scales; the aspect and
the 2/3 ratio are measured and should not be touched.

### 3.3 Diamond / rhombus separator

The rhombus is everywhere: inside the right cap of `LOCK TRAITS`, at both outer tips of the
`CYCLE FOR` flourish, as bullet points in stat lists. **[V]**

Two variants, both needed:

```html
<!-- Solid pip. Used as a bullet and as the centre of a divider. -->
<svg viewBox="0 0 16 16" width="9" height="9" fill="currentColor" aria-hidden="true">
  <path d="M8 0 L16 8 L8 16 L0 8 Z"/>
</svg>

<!-- Ring-and-core: an outlined diamond with a filled diamond inside it.
     This is the exact motif in the right cap of the LOCK TRAITS button. [V] -->
<svg viewBox="0 0 32 32" width="18" height="18" aria-hidden="true">
  <path d="M16 1 L31 16 L16 31 L1 16 Z"
        fill="none" stroke="currentColor" stroke-width="1.5"/>
  <path d="M16 9.5 L22.5 16 L16 22.5 L9.5 16 Z" fill="currentColor"/>
</svg>
```

Pure CSS pip, when an SVG is overkill:

```css
.wf-pip       { width: 9px; height: 9px; background: var(--wf-gold); rotate: 45deg; }
.wf-pip--ring { background: none; box-shadow: inset 0 0 0 1px var(--wf-gold); }
```

### 3.4 Corner flourish — the circuit-trace bundle

This is the ornament I magnified on the `Default Loadout` bar in the Arsenal. **[V]** What it
actually is: **a bundle of 2–4 hairline traces that run horizontally, turn through a small arc,
run diagonally at roughly 30–35°, turn again, and end.** Different traces have different lengths
and are offset ~8–10 px apart. It reads as cable routing / a PCB trace, **not** as baroque
scrollwork. Getting this right is the difference between "Orokin" and "fantasy gold filigree".

```html
<!-- Corner flourish. Anchor at the panel's top-right; mirror for other corners. -->
<svg viewBox="0 0 160 48" width="160" height="48" fill="none"
     stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke"
     aria-hidden="true">
  <!-- three traces, staggered: run -> arc -> ~32 deg climb -> arc -> run -->
  <path d="M0 40 H72 A10 10 0 0 0 80 34 L104 20 A10 10 0 0 1 112 16 H160" opacity="0.95"/>
  <path d="M18 30 H80 A8 8 0 0 0 87 25 L108 12 A8 8 0 0 1 115 9 H150"    opacity="0.60"/>
  <path d="M44 21 H92 A6 6 0 0 0 98 17 L114 7  A6 6 0 0 1 120 5 H138"    opacity="0.35"/>
  <!-- terminator pip -->
  <path d="M160 16 l3 3 -3 3 -3 -3 z" fill="currentColor" stroke="none"/>
</svg>
```

Cheap trick that sells it: give each trace a slightly different `opacity` (0.95 / 0.6 / 0.35).
In game the traces are physically the same colour, but they are sub-pixel-thin, so they
*antialias* to different intensities. Faking that hierarchy is what makes it look photographed
rather than drawn. **[I]**

### 3.5 Divider rule with a central diamond

```html
<svg viewBox="0 0 320 12" width="100%" height="12" preserveAspectRatio="none"
     aria-hidden="true">
  <defs>
    <linearGradient id="wf-fade-l" x1="0" x2="1">
      <stop offset="0" stop-color="currentColor" stop-opacity="0"/>
      <stop offset="1" stop-color="currentColor" stop-opacity=".85"/>
    </linearGradient>
    <linearGradient id="wf-fade-r" x1="0" x2="1">
      <stop offset="0" stop-color="currentColor" stop-opacity=".85"/>
      <stop offset="1" stop-color="currentColor" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0"   y="5.5" width="146" height="1" fill="url(#wf-fade-l)"/>
  <rect x="174" y="5.5" width="146" height="1" fill="url(#wf-fade-r)"/>
  <path d="M160 1 L166 6 L160 11 L154 6 Z" fill="currentColor"/>
</svg>
```

The **fade to transparent at the outer ends** is the important part — Warframe rules almost
never terminate in a hard stop, they dissolve. **[V]** (visible on the Arsenal header rule).

CSS-only version, no markup:

```css
.wf-rule {
  position: relative; height: 1px; border: 0;
  background: linear-gradient(90deg,
    transparent, var(--wf-gold) 18%, var(--wf-gold) 82%, transparent);
  opacity: .55;
}
.wf-rule::after {
  content: ''; position: absolute; left: 50%; top: 50%;
  width: 7px; height: 7px; translate: -50% -50%; rotate: 45deg;
  background: var(--wf-gold);
}
```

### 3.6 The X-flourish (button wings)

Measured on both end caps of `CYCLE FOR`: **two crossing diagonals forming a narrow bowtie, with
a small solid diamond at the outer tip.** **[V]** This is the "this is the important button on
this screen" marker. Use it on at most one control per view.

```html
<svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true"
     fill="none" stroke="currentColor" stroke-width="1">
  <path d="M44 4 L6 22 L44 40"/>
  <path d="M6 22 L28 4 M6 22 L28 40" opacity=".55"/>
  <path d="M6 18 l4 4 -4 4 -4 -4 z" fill="currentColor" stroke="none"/>
</svg>
```

---

## 4. Borders, edges, and glowing rims

### 4.1 Measured edge colours

| What | Value | Tag |
|---|---|---|
| DE brand gold, from **their own site CSS** (`background-color:#ddc57d`) | **`#ddc57d`** | **[V]** |
| DE's gold-metal gradient, verbatim from their CSS | `linear-gradient(.35turn,#f9f9d6,#ac9945,#f9f9d6,#ac9945)` | **[V]** |
| In-game header title fill (dominant, 6.6 % of the header region) | **`#bca766`** | **[V]** |
| In-game header title highlight (3.0 % of the region — the bevel) | **`#f5e3ad`** | **[V]** |
| Panel body fill, Arsenal, luminance 18–22/255 | ≈ **`#12111a` – `#16151d`** | **[V]** |
| Outside-panel scrimmed ground, luminance 6–11/255 | ≈ **`#06060a` – `#0b0b10`** | **[V]** |
| Border bright stroke / dim stroke ratio | **1.00 / 0.56** | **[V]** |

So gold titles in Warframe are a **vertical gradient**, pale cream at the top edge into muted
old-gold: `#f5e3ad → #bca766`. That is measured, and it is why flat `#ddc57d` text looks
slightly dead next to a real screenshot.

```css
.wf-title {
  font-weight: 600;
  letter-spacing: 0.2em;           /* [V] measured ~0.18-0.22em on INVENTORY/MODS */
  text-transform: uppercase;
  background: linear-gradient(180deg, #f5e3ad 0%, #d8c489 42%, #bca766 100%);
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
  /* the drop shadow is what lifts it off a busy 3D background [V] */
  filter: drop-shadow(0 1px 0 rgba(0,0,0,.85))
          drop-shadow(0 0 10px rgba(221,197,125,.18));
}
```

### 4.2 Gradient borders

**Rectangles** — `border-image` is fine and cheap:

```css
.wf-edge-grad {
  border: 1px solid transparent;
  border-image: linear-gradient(180deg,
                  rgba(245,227,173,.85) 0%,
                  rgba(188,167,102,.55) 45%,
                  rgba(109,95,57,.30) 100%) 1;
}
```

**Chamfered shapes** — `border-image` gets clipped and the corners break. Use the
`mask-composite` ring from §2.4 with a gradient background instead of a flat one:

```css
.wf-frame::before {
  padding: 1px;
  background: linear-gradient(180deg, #f5e3ad, #bca766 45%, rgba(109,95,57,.35));
}
```

### 4.3 Hairline glow rim

The measured rim is **one bright pixel plus a very tight bloom** — Warframe's borders glow, but
the bloom radius is small (a few px), not the 20px halo that most web "neon" CSS uses. **[I]**

```css
.wf-rim {
  box-shadow:
    0 0 0 1px rgba(245,227,173,.55),          /* the hairline itself */
    0 0 4px  rgba(245,227,173,.28),           /* tight bloom         */
    0 0 14px rgba(221,197,125,.10),           /* wide, very faint    */
    inset 0 1px 0 rgba(255,255,255,.05);      /* top-edge specular   */
}
```

For a chamfered element, `box-shadow` is clipped away — put the glow on a `filter:
drop-shadow()` on the *parent* instead:

```css
.wf-btn-wrap        { filter: drop-shadow(0 0 6px rgba(245,227,173,.35)); }
.wf-btn-wrap > .wf-btn { clip-path: var(--clip); }
```

### 4.4 Animated gradient border with `@property`

```css
@property --wf-sweep {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

.wf-frame--live::before {
  padding: 1px;
  background:
    /* the base edge */
    linear-gradient(180deg, rgba(245,227,173,.5), rgba(188,167,102,.28)),
    /* the travelling highlight */
    conic-gradient(from var(--wf-sweep) at 50% 50%,
      transparent 0deg 300deg,
      rgba(245,227,173,0)  310deg,
      rgba(245,227,173,1)  345deg,
      rgba(255,255,255,1)  352deg,
      rgba(245,227,173,0)  360deg);
  background-blend-mode: screen;
  animation: wf-sweep 5.5s linear infinite;
}

@keyframes wf-sweep { to { --wf-sweep: 360deg; } }

@media (prefers-reduced-motion: reduce) {
  .wf-frame--live::before { animation: none; }
}
```

Because the pseudo-element is already masked to a 1px ring *and* clipped to the chamfer, the
conic highlight becomes a single point of light chasing the panel outline — including around the
45° cuts. This is the cheapest convincing "the UI is powered" effect available.

`@property` is required: without a registered `<angle>` custom property the browser cannot
interpolate `--wf-sweep` and the animation snaps. Overwolf ships Chromium, so it is safe here.

---

## 5. Layout proportions — measured off the 1920×1080 Arsenal

Column scans for hairline borders and luminance steps. **[V]** unless noted.

### 5.1 Gutters

| Measure | Value | As % of 1920 |
|---|---|---|
| Left panel, left border | **x = 97** | 5.05 % |
| Right panels, right border | **x = 1820–1822** | (98–100 px) 5.10 % |

> **The screen gutter is ~5 % of viewport width — 96–100 px at 1080p — and it is symmetric.** **[V]**
> Round it to `--gutter: 5vw` and every panel snaps into the right place.

### 5.2 Rails

| Element | x range | Width | % of 1920 |
|---|---|---|---|
| Left loadout list | 97 → 424 | **327 px** | **17.0 %** |
| Loadout header bar (wider than the list) | 101 → 446 | 345 px | 18.0 % |
| Gap, list → sub-action column | 424 → 447 | **23 px** | — |
| Right info / stat panels, right edge | → 1820 | — | — |

**Structure: left rail ≈ 17 %, right rail ≈ 22–24 %, centre ≈ 60 % left empty for the 3D
scene.** **[V]** for the left rail and the gutters; **[I]** for the right rail width (its left
edge sits under a soft scrim rather than a hard border, so I could not pin it to a pixel).

The critical read: **Warframe never fills the middle.** The centre 55–60 % of the screen is
reserved for the diegetic object — the Warframe, the mod, the planet. Chrome is pushed to the
rails. For an overlay this translates directly: **keep the centre empty; the game is there.**

### 5.3 Vertical rhythm

| Measure | Value |
|---|---|
| Top status bar (currency chips) | y ≈ 40 → 90 **[V]** |
| Content top | y ≈ 100 **[V]** |
| Left panel bottom | y ≈ 782–785 **[V]** |
| Left panel height | ≈ 685 px = **63 % of 1080** **[V]** |
| Stat-row pitch (Health / Shield / Armor …) | **≈ 26 px** at 1080p **[V]** |
| Zebra stripe alternation | luminance **29 vs 18** → overlay ≈ `rgba(255,255,255,.045)` **[V]** |

26 px rows at 1080p is **dense** — about 13 rows per 350 px. Warframe's readouts are far tighter
than a typical web table. If our overlay uses 40 px rows it will look like a settings page, not
like the game.

```css
:root {
  --gutter: 5vw;            /* [V] 96-100px @1920 */
  --rail-l: 17%;            /* [V] */
  --rail-r: 23%;            /* [I] */
  --row-h:  26px;           /* [V] @1080p; scale with vmin for 4K */
  --panel-gap: 23px;        /* [V] */
}
.wf-shell {
  display: grid;
  grid-template-columns: var(--rail-l) 1fr var(--rail-r);
  column-gap: var(--panel-gap);
  padding-inline: var(--gutter);
  padding-block: 3.7vh 4vh;      /* [V] top bar at y≈40 = 3.7% of 1080 */
}
.wf-list > li               { height: var(--row-h); display: flex; align-items: center; }
.wf-list > li:nth-child(even) { background: rgba(255,255,255,.045); }  /* [V] */
```

---

## 6. The energy-line motif

Two distinct things get called "the energy line". Build both.

### 6.1 Static bundled traces

Covered in §3.4 — the PCB-trace flourish. It is *not* animated in the Arsenal; it just sits
there. **[V]**

### 6.2 The travelling light

A short bright segment that runs along a panel's outline and dies. Three implementations,
increasing cost.

**(a) CSS only, one panel** — the `@property` conic sweep in §4.4. Zero JS. Use for every
resting panel.

**(b) SVG stroke-dash chase** — when the light must follow an *exact* path (a trace, a chevron,
a non-rectangular route):

```css
.wf-trace {
  stroke: #f5e3ad;
  stroke-width: 1;
  fill: none;
  stroke-dasharray: 24 400;          /* 24px of light, 400px of dark */
  stroke-linecap: round;
  filter: drop-shadow(0 0 3px rgba(245,227,173,.9));
  animation: wf-chase 3.2s cubic-bezier(.4,0,.15,1) infinite;
}
@keyframes wf-chase {
  from { stroke-dashoffset: 424; }   /* 424 = 24 + 400, so it loops seamlessly */
  to   { stroke-dashoffset: 0; }
}
```

Ease it, do not run it linear — Warframe's UI motion is snappy-in, drifting-out. **[I]**

**(c) Canvas — many panels, correct overlap, additive glow.** Use this for the overlay's hero
surface: a dozen `@property` animations each forcing a paint is how you lose your frame budget
in Overwolf.

```js
/**
 * Energy lines travelling along a polygon outline.
 * One canvas, N pulses, additive blending.
 */
export function energyEdge(canvas, poly, opts = {}) {
  const ctx = canvas.getContext('2d');
  const {
    count = 3,
    speed = 260,               // px/sec along the perimeter
    len   = 130,               // px of visible tail
    color = [245, 227, 173],
    width = 1.25,
  } = opts;

  // 1. arc-length parameterise the polygon once
  const segs = [];
  let perim = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, d, at: perim });
    perim += d;
  }
  const at = (s) => {                     // s in [0, perim) -> [x, y]
    s = ((s % perim) + perim) % perim;
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; segs[m].at <= s ? (lo = m) : (hi = m - 1); }
    const g = segs[lo], t = (s - g.at) / g.d;
    return [g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t];
  };

  // 2. stagger the pulses so they never bunch
  const phase = Array.from({ length: count }, (_, i) => (perim / count) * i);
  let raf = 0, last = performance.now();

  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);   // clamp: tab-switch guard
    last = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'lighter';         // additive: crossings brighten
    ctx.lineWidth = width;
    ctx.lineCap = 'round';

    const STEPS = 14;
    for (let i = 0; i < count; i++) {
      phase[i] += speed * dt;
      // draw the tail as short segments with falling alpha -> a comet, not a dash
      for (let k = 0; k < STEPS; k++) {
        const p0 = at(phase[i] - (len * k) / STEPS);
        const p1 = at(phase[i] - (len * (k + 1)) / STEPS);
        // skip the segment that wraps the seam, or you get a chord across the panel
        if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > len) continue;
        const a = Math.pow(1 - k / STEPS, 2.2) * 0.9;   // quadratic falloff reads best
        ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${a})`;
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      }
    }
    raf = requestAnimationFrame(frame);
  };

  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

// Feed it the SAME polygon as the clip-path, in px, and the light traces the chamfers.
// e.g. for .wf-panel with --cut-lg:24px on a 327x685 box:
// energyEdge(cvs, [[24,0],[327,0],[327,661],[303,685],[0,685],[0,24]]);
```

Two details that matter and are usually got wrong:

* **`globalCompositeOperation = 'lighter'`** — where two pulses cross, the game brightens. With
  `source-over` they just occlude and it looks like tape.
* **Quadratic alpha falloff (`^2.2`)**, not linear. A linear tail reads as a dash; a quadratic
  one reads as light. **[I]**

Keep the polygon in one shared JS constant used by both the `clip-path` string and
`energyEdge`, so they cannot drift apart.

---

## 7. Depth and layering — measured

The single most surprising measurement in this whole document:

> **Warframe does not blur its menu background. It darkens and vignettes it.** **[V]**

In the Update 41 Arsenal capture, the ship interior behind the panels is **visibly sharp** — you
can read panel lines and rivets on the geometry behind the loadout list. What DE does instead is
a **wide, soft, one-directional scrim**.

### Measured scrim ramp

Luminance along row y=200, moving right toward the info panel **[V]**:

```
x=1300 : 166      <- unscrimmed scene
x=1354 : 170
x=1438 :  59
x=1462 :  46
x=1486 :  26
x=1500 :  20      <- fully scrimmed
   ... flat ~18-20 across the panel ...
x=1822 :  49      <- panel border
x=1828 :  10      <- outside the panel, still inside the scrim
```

* The ramp runs from **~x 1354 to ~x 1490 → a 140 px horizontal fade**. **[V]**
* Full scrim knocks the scene from luminance ~170 down to ~20: **a factor of ~8.5×**, i.e.
  roughly `brightness(0.12)` or an 88 % black overlay. **[V]**
* The panel body (20) is *brighter* than the ground immediately outside it (10). **[V]**
  The panel is not a darker rectangle on a light field — it is a **slightly lifted plate on a
  darker field**. Getting this inversion right is most of the "depth" read.

```css
/* The rail scrim. One-directional, 140px, no blur. */
.wf-rail-right {
  background: linear-gradient(270deg,
    rgba(4,4,9,.94) 0,
    rgba(4,4,9,.94) calc(100% - 140px),
    rgba(4,4,9,0)   100%);
}
.wf-rail-left { background: linear-gradient(90deg, /* ...mirrored... */ ); }

/* Panels sit ON the scrim and are LIGHTER than it. [V] */
.wf-panel {
  background: rgba(18,17,26,.92);          /* ≈ #12111a  [V] */
  box-shadow:
    0 1px 2px   rgba(3,3,7,.60),
    0 6px 18px  rgba(3,3,7,.50),
    0 22px 48px rgba(3,3,7,.38);           /* 3 tinted layers, never one flat black */
}

/* Screen vignette. [V] corners measured much darker than centre. */
.wf-stage::after {
  content: ''; position: fixed; inset: 0; pointer-events: none;
  background: radial-gradient(120% 90% at 50% 45%,
    transparent 40%, rgba(0,0,0,.35) 78%, rgba(0,0,0,.62) 100%);
}
```

**For an overlay specifically**, one deviation from the replica is justified: the game is running
underneath and we do not control it, so a *small* backdrop blur (4–8 px) plus the measured
darkening buys legibility that DE gets for free by owning the whole frame.

```css
.wf-overlay-panel {
  backdrop-filter: blur(6px) brightness(.34) saturate(.72);
  background: rgba(18,17,26,.86);
}
```

`brightness(.34) saturate(.72)` — the darkening is measured; the desaturation is **[I]** from how
neutral the scrimmed background reads compared with the unscrimmed part of the same frame.

### Layer stack

| z | Layer | Treatment |
|---|---|---|
| 0 | game / scene | untouched |
| 1 | rail scrim | 140 px directional gradient to `rgba(4,4,9,.94)` **[V]** |
| 2 | vignette | radial, corners to ~62 % black **[V]** |
| 3 | panel plate | `#12111a` @ .92, *lighter* than layer 1 **[V]** |
| 4 | hairline + inner hairline | 1px @1.0 / 1px inset 6px @0.56 **[V]** |
| 5 | energy line | additive, `lighter` |
| 6 | content | gold caps titles, white body **[V]** |
| 7 | ornament | traces, diamonds, X-flourishes |

---

## 8. Verified theme accents

Warframe ships ~20 purchasable UI themes; the theme recolours the accent, **not the geometry**.
**[V]** (Settings/Interface/Backgrounds_and_Themes). I sampled the dominant non-black colour from
each official theme icon on the wiki. **Caveat: these are the theme *icons*, which represent the
theme's accent hue — they are not a full sampled UI palette.** Treat as accurate hues,
approximate values.

| Theme | Accent **[V]** | Secondary **[V]** |
|---|---|---|
| Orokin | `#cbad5e` | `#74795d` |
| **Legacy** (the classic blue) | `#5589b1` | `#395164` |
| Tenno | `#4eb18d` | `#376455` |
| Corpus | `#63a9b0` | `#276c74` |
| Grineer | `#c98e69` | `#6d5341` |
| Stalker | `#ab1729` | `#611f27` |
| Lotus | `#c397cb` | `#69556d` |
| Dark Lotus | `#7284de` | `#444d75` |
| Nidus | `#d55be3` | `#733a79` |
| Conquera | `#e377cd` | `#7b2b74` |
| Fortuna | `#9357ec` | `#54397c` |
| Vitruvian | `#7f7249` | `#4e4836` |
| Deadlock | `#e9c75e` | `#5b6d82` |
| Equinox | `#ededed` | `#797979` |

This is a gift for RaijiFrame: **ship theme switching with these exact accents.** A Warframe
player who sets our overlay to "Stalker" and sees `#ab1729` will recognise it instantly. The
geometry stays fixed; only `--wf-accent` changes.

---

## 9. Going overboard — without losing the identity

The brief's second half. The rule that keeps "extreme" from becoming "different game":

> **Amplify what is measured. Never contradict it.**
> Warframe's identity is: 5 % gutters, empty centre, 26 px rows, 28 px chamfers on actions only,
> 1px/6px/1px double edges, gold `#f5e3ad→#bca766`, sharp-not-blurred backgrounds. Every one of
> those is a constraint we keep. Overboard means *more* of the ornament, *more* motion, *more*
> light — inside those constraints.

Six escalations, cheapest first:

1. **Chamfer everything, but keep the hierarchy legible.** Turn on cuts for cards and rows too —
   which the current game does not do — but give actions `--cut-xl` and information `--cut-xs`.
   The *contrast* in cut size restores the "cuts mean action" signal that a global chamfer would
   destroy.

2. **Live edges on everything, staggered.** Every panel gets the §4.4 sweep, but with
   `animation-delay` derived from its index, and periods that are mutually prime
   (5.5s / 7.3s / 11.1s). The panel field then never visibly re-syncs, which is what makes
   ambient motion feel alive instead of mechanical.

3. **Ornament that responds to data.** The trace bundle in §3.4 becomes a bus: the number of lit
   traces = squad size; trace speed = mission-timer urgency; a pip lights per objective. Ornament
   that *means* something is the only way to add this much of it without it reading as noise.

4. **A Lotus that breathes.** The §3.2 crest, three chevrons, each on its own slow scale +
   opacity cycle at 2/3 the previous one's period (matching the 2/3 spatial rule). Put it at
   40 % opacity behind the primary panel as a watermark. It will read as depth, not decoration.

5. **Energy that follows attention.** The canvas pulses in §6.2 take a `bias` toward whatever
   panel the pointer is over — pulses accelerate along that panel's perimeter and slow elsewhere.
   Cost: one extra scalar per pulse.

6. **Void mode.** A held-modifier state where the whole surface inverts to a Void/Duviri
   register: gold → `#f5e3ad` at full, the scrim goes hard black, chamfers deepen from 34 px to
   52 px on a spring, and every energy line runs at 3× for 400 ms then settles. This is the "way
   overboard" pressure valve — spectacular, *bounded in time*, and because it only exaggerates
   existing values it still reads as the same product.

**The one thing not to do:** rounded corners. Not `2px`, not `4px`. The measured game has
essentially none, and a radius is the single fastest way to make all of the above look like a
dark-mode dashboard wearing a costume.

---

## 10. What to change in `src/styles/theme.css`

The file already carries `--cut-sm/md/lg/xl` and `#DDC57D`. Both check out against my
measurements — `#ddc57d` is confirmed verbatim from DE's own site CSS. **[V]** Corrections and
additions, in priority order:

```css
@theme {
  /* CORRECTION: measured cut inset is ~34px @1920, not 22px.
     DE uses a fixed inset, so these must stay absolute, not %. [V] */
  --cut-xs: 6px;
  --cut-sm: 10px;
  --cut-md: 16px;
  --cut-lg: 24px;
  --cut-xl: 34px;   /* the measured button chamfer */

  /* NEW: the measured gold gradient endpoints. Flat #ddc57d looks dead. [V] */
  --gold-hi:   #f5e3ad;
  --gold-body: #bca766;
  --gold-lo:   #6d5f39;   /* [I] extrapolated for the gradient foot */

  /* NEW: the double-border constants. Highest-value detail in this document. [V] */
  --edge-inner-inset: 6px;
  --edge-inner-alpha: 0.56;

  /* NEW: measured layout [V] */
  --gutter: 5vw;
  --row-h: 26px;
  --panel-gap: 23px;
  --scrim-ramp: 140px;
}
```

`--radius-chrome: 2px` / `--radius-card: 3px` currently in the file: **drop them.** I found no
radius anywhere in the measured chrome. Keep a radius only for genuinely circular things
(avatars, dots, the segmented energy ring).

---

## 11. Open gaps

Things I could not verify and would want before treating this as final:

1. **The modern HUD.** Every HUD screenshot reachable on the wiki was pre-2018 (flat cyan shield
   / red health bars). I could not measure the current angled shield/health/energy readouts.
   §2.1's chamfer rule is **[I]** for the HUD.
2. **Right-rail exact width.** Its inboard edge is a soft scrim, not a border, so 23 % is **[I]**,
   not measured.
3. **Panel fill alpha.** I measured the *composited* result (luminance 18–22) but not the alpha
   and the plate colour independently. `rgba(18,17,26,.92)` reproduces the measurement over our
   scrim; it may not be DE's actual pair.
4. **Motion timings.** Nothing in this document's durations or easings is measured — all
   **[I]/[G]**. Frame-stepping a menu-transition video would fix this and is the single
   highest-value follow-up.
5. **n=2 on the chamfer.** "Fixed 28 px inset" rests on two buttons in one screenshot. Two more
   screens at different resolutions would confirm or kill it.
6. **Type.** The display face is a squarish technical sans with flat terminals and ~0.2em
   tracking **[V]**, but I did not identify it. Bahnschrift (already in `theme.css`) is a
   defensible stand-in; DIN-adjacent alternatives are worth a look.
