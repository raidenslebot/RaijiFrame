# Warframe UI — Screen-by-Screen Anatomy

Research doc for the Warframe companion overlay (Overwolf, React + TS + Tailwind v4 + `motion` + canvas).
Target: forensic replica first, then deliberate excess on top of a correct skeleton.

**Date:** 2026-08-31
**Scope:** layout, information hierarchy, interaction pattern, motion — per screen, with implementable technique.

---

## 0. Evidence policy (read this before trusting any number below)

Every claim is tagged:

| Tag | Meaning |
|---|---|
| **[V]** VERIFIED | I read it in a cited source, or it is a literal hex/number quoted from one. URL given. |
| **[I]** INFERRED | Not stated in a source I could reach, but derived from converging textual descriptions + long familiarity with the product. Treat as a strong starting value that you should confirm against a screenshot before shipping. |
| **[G]** GUESSED | Plausible reconstruction. Change freely. Included only where a number is needed to write code at all. |

**What I could and could not see.** Text sources (wiki raw wikitext, warframe.com, forum search summaries) were reachable and are cited. Two image-bearing sources I tried were hard-blocked:

- `https://www.gameuidatabase.com/gameData.php?id=192` → **HTTP 403**. This is the single best screenshot corpus for Warframe UI (it catalogues screens by category); worth opening in a browser manually.
- `https://forums.warframe.com/topic/668638-i-dont-like-the-new-star-chart/` → **HTTP 403** (Cloudflare). The search-engine summary of it did surface concrete complaints: *slow transitions, fade-to-black between states, node positions not corresponding to sensible locations, frame twitching while scrolling.* ([search result summary](https://forums.warframe.com/topic/668638-i-dont-like-the-new-star-chart/))
- `wiki.warframe.com` blocks plain `curl` with a Cloudflare interstitial (confirmed: raw fetch returned a `<title>Please wait</title>` challenge page, 42 kB of base64 font). `WebFetch` on `?action=raw` **does** get through and is the working path.

**Therefore:** every *pixel geometry* number in this document is **[I]** or **[G]** unless marked otherwise. No hex colour is stated as fact unless it is quoted from the wiki's HUD customisation table, which lists DE's own default values. Those are the only sampled-quality colours we have.

### 0.1 Verification harness you should run before locking the theme

Cheapest possible ground truth, ~20 minutes:

1. Take 4K PNG screenshots of: Navigation (system view), Navigation (planet view + node selected), Arsenal Upgrade, Mod list, Foundry, Profile, in-mission HUD.
2. Drop them in `docs/research/screens/`.
3. Sample with a one-file script and commit the output as `palette.sampled.json`:

```js
// tools/sample-palette.mjs — node tools/sample-palette.mjs shot.png 1204 318
import sharp from 'sharp';
const [file, x, y] = process.argv.slice(2);
const { data } = await sharp(file).extract({ left: +x, top: +y, width: 1, height: 1 })
  .raw().toBuffer({ resolveWithObject: true });
console.log('#' + [...data.slice(0,3)].map(b => b.toString(16).padStart(2,'0')).join(''));
```

Sample points that matter most: panel background, panel border, primary accent (the gold), secondary accent (the cyan), disabled text, locked-node fill, selected-node fill, the header rule.

---

## 1. Shared visual language (build these primitives once)

Everything in Warframe's menu chrome is assembled from a small number of shapes. Get these right and every screen falls out cheaply. Get them wrong and no amount of screen-specific work saves you.

### 1.1 The chamfer

**[I]** The defining shape is a rectangle with one or two corners cut at 45°. Not a rounded corner — a straight bevel. Panels, buttons, list rows, mod cards, tooltips all use it. Cut size scales with element size: roughly **`min(14px, height * 0.28)`** on buttons and rows, larger (24–32px) on full panels.

Direction is not random **[I]**: the cut usually points "toward the flow" — a left-aligned list row cuts its **top-left** and **bottom-right**; a right-hand info panel cuts **top-right**/**bottom-left**. This produces the subtle diagonal rhythm that reads as Warframe rather than generic sci-fi.

```css
/* the single most important utility in this project */
:root { --chamfer: 14px; }

.wf-cut { /* top-left + bottom-right */
  clip-path: polygon(
    var(--chamfer) 0, 100% 0,
    100% calc(100% - var(--chamfer)), calc(100% - var(--chamfer)) 100%,
    0 100%, 0 var(--chamfer)
  );
}
.wf-cut-tr { /* top-right + bottom-left (mirror) */
  clip-path: polygon(
    0 0, calc(100% - var(--chamfer)) 0, 100% var(--chamfer),
    100% 100%, var(--chamfer) 100%, 0 calc(100% - var(--chamfer))
  );
}
.wf-cut-4 { /* all four, for tooltips and mod cards */
  clip-path: polygon(
    var(--chamfer) 0, calc(100% - var(--chamfer)) 0, 100% var(--chamfer),
    100% calc(100% - var(--chamfer)), calc(100% - var(--chamfer)) 100%,
    var(--chamfer) 100%, 0 calc(100% - var(--chamfer)), 0 var(--chamfer)
  );
}
```

`clip-path` kills the border. Two ways to get a chamfered *outline*:

```css
/* A. cheap — nested clip, 1px inset. Works everywhere, no AA seams on the diagonal
      because both layers are clipped identically. */
.wf-panel { position: relative; }
.wf-panel::before, .wf-panel::after { content:''; position:absolute; inset:0; }
.wf-panel::before { background: var(--wf-line); }                    /* the "border" */
.wf-panel::after  { inset:1px; background: var(--wf-panel-bg); }     /* the fill */
.wf-panel::before, .wf-panel::after { clip-path: inherit; }
```

```css
/* B. correct — real stroked geometry, use when the border must glow or animate */
/* SVG overlay, vector-effect keeps stroke width constant under transform */
```
```html
<svg class="wf-frame" preserveAspectRatio="none" viewBox="0 0 100 100">
  <path d="M6 0 H100 V94 L94 100 H0 V6 Z" fill="none"
        stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke"/>
</svg>
```
(`preserveAspectRatio="none"` + `viewBox 0 0 100 100` lets one path stretch to any box; the chamfer skews slightly on extreme aspect ratios — acceptable up to ~4:1, past that use the CSS variant or generate the path from measured size.)

### 1.2 The corner bracket

**[I]** Selection and focus are shown with **L-shaped brackets at the corners**, not a full box. Bracket arm ≈ 12–18% of the edge length, 2px stroke, drawn *outside* the element by 4–6px.

```css
.wf-bracket { position: relative; }
.wf-bracket::before, .wf-bracket::after {
  content: ''; position: absolute; pointer-events: none;
  width: 18px; height: 18px;
  border: 2px solid var(--wf-accent);
  transition: inset 140ms cubic-bezier(.2,.8,.2,1), opacity 140ms;
}
.wf-bracket::before { inset: -5px auto auto -5px; border-right: 0; border-bottom: 0; }
.wf-bracket::after  { inset: auto -5px -5px auto; border-left: 0;  border-top: 0; }
/* the "snap": brackets fly in from further out on hover */
.wf-bracket:not(:hover)::before { inset: -1px auto auto -1px; opacity: .35; }
.wf-bracket:not(:hover)::after  { inset: auto -1px -1px auto; opacity: .35; }
```

### 1.3 The diamond / rhombus

**[V]** Node states on the Star Chart are literally described as rhombi: *"Blue rhombus with white lines"* = available, *"White rhombus with white lines"* = completed, *"Black lock with dashed lines"* = locked, *"White triangle (two smaller ones and rhombus)"* = open world. ([Star Chart legend, wiki raw](https://wiki.warframe.com/index.php?title=Star_Chart&action=raw))

So the diamond is a **first-class primitive**, not decoration. Build it as SVG so you can stroke, fill and pulse it independently:

```jsx
// 24px viewBox; scale via width/height. Outer stroke = "white lines", fill = state colour.
const Node = ({ state }) => (
  <svg viewBox="0 0 24 24" className="wf-node">
    <path d="M12 1 L23 12 L12 23 L1 12 Z"
          fill={FILL[state]} stroke="#fff" strokeWidth="1.5"
          strokeDasharray={state === 'locked' ? '3 3' : undefined} />
    {state === 'completed' && <path d="M12 6 L18 12 L12 18 L6 12 Z" fill="#fff" opacity=".9"/>}
  </svg>
);
const FILL = { locked:'#0b0d0f', available:'#0e7fbf', completed:'#e8eef2' }; // [G] pending sample
```

### 1.4 The orb (health / shield / energy motif)

**[V]** In-mission, health and shields are *bars with numerals* (blue number = shields, red number = health, upper left). ([Heads-Up Display, wiki raw](https://wiki.warframe.com/index.php?title=Heads-Up_Display&action=raw)) The **orb** shape belongs to the world pickups (health orb, energy orb) and to Duviri/Operator UI flourishes. Both are worth stealing for a companion overlay because a circle with an internal fill level is the most legible small-format gauge there is.

Radial fill orb, pure CSS, no JS per frame:

```css
.wf-orb {
  --pct: 0.72;              /* set from JS/state */
  --hue: #cc2a28;           /* health [V] */
  width: 56px; aspect-ratio: 1; border-radius: 50%;
  background:
    /* liquid level */
    linear-gradient(to top, color-mix(in oklab, var(--hue) 85%, black) 0 calc(var(--pct) * 100%),
                            transparent calc(var(--pct) * 100%) 100%),
    /* glass */
    radial-gradient(circle at 32% 28%, rgba(255,255,255,.28), transparent 42%),
    radial-gradient(circle at 50% 50%, rgba(0,0,0,.55), rgba(0,0,0,.85));
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--hue) 60%, transparent),
              0 0 18px -4px var(--hue), inset 0 0 14px -4px var(--hue);
}
```

Conic ring variant (for the Mastery ring, ability cooldowns, foundry timers):

```css
.wf-ring {
  --pct: .64; --ring: 5px;
  aspect-ratio: 1; border-radius: 50%;
  background: conic-gradient(var(--wf-accent) calc(var(--pct) * 360deg), rgba(255,255,255,.08) 0);
  mask: radial-gradient(farthest-side, transparent calc(100% - var(--ring)), #000 calc(100% - var(--ring)));
}
```
For an *animatable* ring value, use `@property --pct { syntax:'<number>'; inherits:true; initial-value:0 }` so the conic stop is interpolable — otherwise the browser snaps it.

### 1.5 Colour

The only colours I can state with confidence are DE's own HUD defaults, listed on the wiki's HUD customisation table. **[V]** ([Heads-Up Display, wiki raw](https://wiki.warframe.com/index.php?title=Heads-Up_Display&action=raw))

```
Health              #cc2a28      Shields             #01d8ff
Overshields         #b201fe      Armored health      #e0a635
Invulnerable health #585858      Invulnerable shield #9c9c9a
Object health       #6dada7      Buff icons          #01d8ff
Debuff icons        #cc2a28      Selected ability    #01d6fe
Unselected ability  #f0f0ee      Reticle             #ffffff
Hit indicator       #e9bb06      Headshot indicator  #c80406
Crit (yellow)       #ffff00      Crit (orange)       #fe6c09
Crit (red)          #fe0000
Default marker      #ffffff      Friendly marker     #0795d5
Enemy marker        #c80406      Loot marker         #ffffff
Downed teammate     #c80406      Objective marker    #e9ba08
Attack marker       #c80406      Extraction          #43b306
Focus drop          #e4d570      Life support        #e9ba08
Dojo notable        #01d6fe      Relay notable       #15b7ff
Town notable        #ff9a0c      Plexus mod loot     #fed454
Salvage loot        #a945bf      Energy spawner      #3977fe
Synthesis target    #ffd47b      K-Drive race        #9b07cb
VIP target          #3765ff      Incoming life supp. #23effe
Kuva harvester      #a01b1c      Text                #ffffff
Disabled text       #808080      Negative text       #c80406
Objective progress  #ffffff      Objective glow      #01a6ff
Text background     #414141
```

Read the *system* out of that list, because it is the actual design rule:

- **Cyan `#01d8ff` is "you / yours / good".** Shields, buffs, selected ability, dojo. It is a saturated near-primary cyan, not teal.
- **Red `#cc2a28` / `#c80406` is "cost / harm / them".** Note the two reds: `cc2a28` for your own health, the harder `c80406` for enemies and damage. They deliberately differ.
- **Amber `#e9ba08` / `#e9bb06` is "the objective".** This is the closest thing to the famous Warframe gold *inside verified data*. `#e0a635` (armored health) is a warmer, dustier gold and is the better base for Orokin panel chrome **[I]**.
- **Pure white text on near-black; disabled at `#808080`.** Exactly 50% grey. That is a strong hint the whole neutral ramp is flat greys, not tinted.

**[V]** HUD colour presets shipped by DE: `Default, Protanopia, Deuteranopia, Tritanopia, Grineer, Corpus, Tenno, Vitruvian, Lotus, Neon` (same source). **[V]** Menu themes purchasable in Options → Interface → Customise UI Theme: `Baruuk, Conquera, Corpus, Dark Lotus, Deadlock, Drippy, Equinox, Fortuna, Grineer, Legacy, Lunar Renewal, Pom-2, Stalker, Vitruvian, Zephyr Harrier, Lotus, Nidus, Tenno, Orokin, High Contrast` ([Backgrounds and Themes, wiki raw](https://wiki.warframe.com/index.php?title=Settings/Interface/Backgrounds_and_Themes&action=raw)). Backgrounds are a *separate* axis with its own list, and **UI sounds** are a third axis (`Legacy` / `Vitruvian`).

**Design consequence for us, and it is the big one:** Warframe's UI is *themeable by construction*. Theme, background and sound are orthogonal. Our overlay must be built the same way from day one — a token layer, a background layer, a sound pack — or the "way overboard" phase will be a rewrite. Tailwind v4's `@theme` is the natural home:

```css
@theme {
  --color-wf-bg:      #05070a;   /* [G] */
  --color-wf-panel:   #0b1014;   /* [G] */
  --color-wf-line:    #2a3a44;   /* [G] */
  --color-wf-accent:  #e0a635;   /* [I] the Orokin gold, from armored-health [V] */
  --color-wf-cyan:    #01d8ff;   /* [V] */
  --color-wf-health:  #cc2a28;   /* [V] */
  --color-wf-objective:#e9ba08;  /* [V] */
  --color-wf-dim:     #808080;   /* [V] */
}
```

Then every theme is a `[data-theme="grineer"]` block that overrides ~10 tokens. Grineer = rust/brass + rivet texture, Corpus = white/blue + clean geometry, Orokin = gold/cream + filigree, Stalker = red/black. **[I]** from the theme names, which are all in-fiction factions with famous, unambiguous palettes.

### 1.6 Motion signature

**[I]**, but strongly supported by the forum complaints DE gets: *"slow transitions, fade-to-black effects"* is the number-one criticism of the Star Chart. That tells us what the real motion is: **long, heavy, cinematic transitions with camera moves and cross-fades**, which look magnificent the first ten times and hurt the ten-thousandth.

Warframe's menu motion, decomposed:

1. **Stagger-in.** Lists and grids never appear at once; rows cascade, ~28–40 ms apart, each sliding ~16px from the leading edge with opacity 0→1 over ~180 ms.
2. **Wipe reveal.** Panels reveal along their chamfer diagonal — a `clip-path` or `mask-image` linear wipe at ~110–115°, not a fade.
3. **Overshoot on select.** Selection brackets snap in with a slight overshoot and settle: `cubic-bezier(.16,1.2,.3,1)` over 160–220 ms.
4. **Idle life.** Nothing is fully static. Scanlines drift, holograms flicker at low amplitude, the selected node pulses ~1.6 s.
5. **Sound as a UI channel.** Every hover and click is a sound. It is a purchasable, swappable pack. Our overlay should ship at least hover/select/confirm/back/error.

```ts
// motion/wf.ts — the whole vocabulary in one file
export const wfEase = [0.16, 1, 0.3, 1] as const;          // settle
export const wfEaseSnap = [0.16, 1.2, 0.3, 1] as const;    // overshoot

export const stagger = (i: number) => ({
  initial: { opacity: 0, x: -16, clipPath: 'inset(0 100% 0 0)' },
  animate: { opacity: 1, x: 0,   clipPath: 'inset(0 0% 0 0)' },
  transition: { duration: 0.18, delay: i * 0.032, ease: wfEase },
});
```

```css
/* diagonal wipe reveal — matches the chamfer angle */
@keyframes wf-wipe { from { mask-position: 140% 0 } to { mask-position: 0 0 } }
.wf-reveal {
  mask-image: linear-gradient(115deg, #000 0 45%, transparent 62%);
  mask-size: 250% 100%; animation: wf-wipe 420ms cubic-bezier(.16,1,.3,1) both;
}
```

### 1.7 Texture

**[I]** Warframe panels are never flat fills. Layered, cheapest-first:

```css
.wf-surface {
  background:
    /* 1. faint horizontal scanlines */
    repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0 1px, transparent 1px 3px),
    /* 2. diagonal hatch in the dead zones */
    repeating-linear-gradient(115deg, rgba(255,255,255,.02) 0 2px, transparent 2px 9px),
    /* 3. vignette toward the panel edge */
    radial-gradient(120% 140% at 50% 0%, rgba(255,255,255,.05), transparent 60%),
    var(--color-wf-panel);
}
/* 4. grain — one 128px tiled PNG data-URI at 3–5% opacity, mix-blend-mode: overlay */
```
Do **not** animate the scanline background-position on a large surface — it repaints the whole layer. Put the scanline in a `position:absolute` pseudo-element with `will-change: transform` and translate it.

---

### 1.8 Typography **[V]**

This closes the "what font is it" open question. From [Fonts (wiki raw)](https://wiki.warframe.com/index.php?title=Fonts&action=raw):

| Role | Font | Note |
|---|---|---|
| Header text (Romance/Germanic langs: EN/FR/DE) | **Ailerons** | uppercase-only geometric display face |
| Body text; headers for ZH/KO/JA | **Noto Sans** | on Google Fonts |
| General UI | **Roboto — the ~2013 "Old Roboto"** | wiki explicitly notes differences on capital `R` and the numeral `1` |
| Accent / legacy | Flareserif 821 BT | |
| Kinemantik IM | generic sans-serif | |
| Pom-2 console | **W95FA** | deliberately a Win95 UI face — the joke is the point |
| In-fiction alphabets | Corpus, Grineer, Solaris | ciphered glyph fonts, usable as decorative texture |

**Why this matters more than it looks.** The Warframe "voice" in type is: *uppercase geometric display for every header, wide letterspacing, and a neutral grotesque for everything else.* Ailerons is uppercase-only, which is precisely why every panel title in the game is caps — it is not a style choice layered on top, it is the font. And "Old Roboto" means the numerals are the 2013 shapes; a modern Roboto will look subtly wrong on stat readouts.

Implementable, all three faces are freely available (Ailerons is a free personal/commercial display font by Adilson Gonzales; Noto Sans and Roboto are on Google Fonts):

```css
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;700&family=Roboto:wght@400;500;700&display=swap');
/* Ailerons must be self-hosted — no Google Fonts entry */
@font-face { font-family: 'Ailerons'; src: url('/fonts/Ailerons-Typeface.woff2') format('woff2');
             font-display: swap; }

@theme {
  --font-wf-display: 'Ailerons', 'Roboto Condensed', ui-sans-serif, sans-serif;
  --font-wf-body:    'Roboto', 'Noto Sans', ui-sans-serif, sans-serif;
  --font-wf-num:     'Roboto', ui-sans-serif, sans-serif;   /* tabular-nums always */
}

/* the header recipe — this single rule is ~40% of "it looks like Warframe" */
.wf-title {
  font-family: var(--font-wf-display);
  text-transform: uppercase;
  letter-spacing: .14em;      /* [I] measured by eye off menu headers; 0.10–0.18em range */
  font-weight: 400;           /* Ailerons has one weight; do NOT synthesise bold */
  line-height: 1;
}
.wf-num { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; }
```

**Fallback discipline:** Ailerons has no lowercase and one weight. Anything needing weight contrast or mixed case must fall to `--font-wf-body`. If you cannot ship Ailerons, the closest free substitutes are *Michroma*, *Saira Condensed* (700, uppercase, tracked) or *Chakra Petch*; all read as the same family of "wide technical caps". **[I]**

**Overboard version:** render headers twice — a solid layer plus an offset, 15%-opacity, `mix-blend-mode: screen` chromatic-aberration ghost split ±1px on the x axis in cyan/amber; add a `background-clip: text` linear gradient (`#f6e3b0 → #e0a635 → #8a5f16`) so caps read as brushed gold. Drop in the Corpus/Grineer glyph fonts as decorative micro-text along panel edges at 7px / 25% opacity — the game does exactly this in its tilesets, and no other overlay does it in its chrome.

---

## 2. Main menu / Orbiter navigation

### What it actually is

**[V]** There is no single "main menu" — there are **two parallel affordances for the same commands**, and this duality is the most Warframe thing about the whole product:

1. **Physical consoles inside the Orbiter**, a walkable 3D ship. Verified layout ([Orbiter, wiki raw](https://wiki.warframe.com/index.php?title=Orbiter&action=raw)):
   - *Upper section (bridge):* **Navigation** dead centre in front of the window; **Syndicates** immediately left of Navigation; **Plexus** between Syndicates and Navigation; **News** right of Navigation; **Codex** back-left; **Market** back-right; **Nightwave** small console right of the ramp; **Pom-2** next to News/Market.
   - *Lower section (hall):* **Arsenal** on the wall straight ahead off the ramp; **Mods** immediate left at the bottom of the ramp; **Foundry** opposite Mods; **Incubator** next to Mods; **Void Relic** in the corner right of Arsenal; **Arcanes** between Mods and Incubator; **Conclave** in the corner left of Arsenal; **Railjack transport** in the corridors either side of Arsenal.
   - *Rooms:* Transference Chamber, Helminth Infirmary, Personal Quarters.
2. **The ESC menu**, which mirrors all of it as a flat list — **[V]** *"The pause menu provides quick access to orbiter systems through Equipment > Orbiter sections… without traversing the physical ship."*

### Layout **[I]**

The ESC menu is a **left-anchored vertical list**, roughly the left 22–26% of the screen, over a heavily darkened/blurred freeze of the world behind. Items are large (48–56px rows), all-caps, generously letter-spaced (~0.12em), left-aligned with a thin leading rule. Selection is a filled chamfered bar plus corner brackets. Sub-menus push in from the left as a *second* column rather than replacing the first — you can see your breadcrumb.

Console interaction in-world: proximity → a floating label + press-to-use prompt → **fade to black** → the screen loads. That fade is the transition players complain about, and it is our opportunity (see Overboard).

### Implementable

```jsx
// Left rail menu with staggered wipe-in and a persistent breadcrumb column.
<motion.nav className="fixed left-0 top-0 h-full w-[24vw] min-w-[280px]
                       bg-[linear-gradient(90deg,rgba(5,7,10,.94),rgba(5,7,10,.72)_70%,transparent)]
                       backdrop-blur-md flex flex-col justify-center gap-1 px-10">
  {items.map((it, i) => (
    <motion.button key={it.id} {...stagger(i)}
      className="wf-cut group relative h-13 pl-6 text-left uppercase tracking-[.14em]
                 text-white/70 hover:text-white transition-colors">
      <span className="absolute left-0 top-1/2 h-6 w-px -translate-y-1/2 bg-white/25
                       group-hover:h-full group-hover:bg-[--color-wf-accent]
                       transition-all duration-200" />
      {it.label}
      <span className="absolute inset-0 -z-10 bg-[--color-wf-accent]/0
                       group-hover:bg-[--color-wf-accent]/12 transition-colors" />
    </motion.button>
  ))}
</motion.nav>
```

### What makes it feel like Warframe

The menu is *diegetic*. Every command has a physical location on a ship you own and decorate. The flat menu is the shortcut, not the truth. Second: the enormous negative space — the list occupies a quarter of the screen and the other three quarters are your Warframe standing in a lit room.

### Overboard version

- **Keep the ship.** Render a low-poly Orbiter cross-section in canvas/WebGL behind the menu; hovering a menu item flies a highlight to the corresponding console position and draws a leader line to the list row. Now the flat menu *teaches* the spatial one.
- Menu items arranged on a **subtle arc** (each row translated by `sin(i)`), like a radial menu flattened out.
- **Aperture open** instead of fade-to-black: a 6-blade iris `clip-path` on the outgoing screen, rotating as it closes, gold rim light on the blade edges.
- Idle for >8 s and the menu **drifts** — parallax on the background, the accent rule breathing at 0.15 Hz. Never dead.

---

## 3. The Star Chart — the one that matters

### 3.1 Structural facts **[V]**

From [Star Chart (wiki raw)](https://wiki.warframe.com/index.php?title=Star_Chart&action=raw):

- **263 total nodes** as of v31.5. (Higher now; use it as an order-of-magnitude anchor: our chart must handle ~300 nodes without dying.)
- Origin System bodies: **Earth, Venus, Mercury, Mars, Ceres, Phobos, Deimos, Jupiter, Europa, Saturn, Uranus, Neptune, Pluto, Eris, Sedna, Void, Dojo**. Quest-unlocked: **Lua, Kuva Fortress, Zariman**.
- Separate regions: **Empyrean / Proxima** (Earth, Venus, Saturn, Uranus, Neptune, Pluto, Veil Proxima, Dojo) and **Duviri**.
- **World State Window** sits **top-right**, tabbed: Events, Alerts, Steel Path Incursions, Invasions, Syndicate missions, Void Fissures, daily Sortie, weekly Archon Hunt.
- **Resource Drones** button **bottom-right**, planet-specific.
- **Loadout selection is available from Navigation** as of v36 — you can change Warframe, weapons, companion and mods without leaving the chart.
- Mission countdown timer sits **in front of the voting buttons**.
- The node legend, verbatim: locked = *"Black lock with dashed lines"*; available = *"Blue rhombus with white lines"*; completed/faction hub = *"White rhombus with white lines"*; open world = *"White triangle (two smaller ones and rhombus)"*. Overlay icon types: Alert, Quest, Boss, Dark Sector, Void Fissure, Invasion, Nightmare, Sortie, Arbitration, Archon Hunt, Kuva Siphon, Kuva Flood, Balor Fomorian, Razorback Armada, plus the six syndicate icons.

From [The Steel Path (wiki raw)](https://wiki.warframe.com/index.php?title=The_Steel_Path&action=raw):
- Steel Path is **"a toggle on the right side of the Star Chart screen"** **[V]**, with **VFX on toggle** (added v34).
- Planets get a distinct **"complete" icon** when all their nodes are done *in that mode*, i.e. completion state is per-mode.
- Steel Path **Incursions only appear in the Alerts panel** when the toggle is set to Steel Path; hovering an Incursion shows the Steel Essence reward in the tooltip.

From [Junction (wiki raw)](https://wiki.warframe.com/index.php?title=Junction&action=raw):
- Junctions sit on the **Solar Rail network** between bodies.
- Incomplete junctions that are *next in progression* got **"a pulsing particle effect"** to draw the eye. **[V]** — that is DE explicitly encoding "here is your next step" into the chart's motion.
- Since **Update 39** a junction opens a **dedicated Junction Screen** listing all tasks + rewards, with a *separate* button to actually enter. Task rewards **auto-scroll** to preview everything earned. **[V]**
- Junction bodies: Venus, Mercury, Mars, Phobos, Ceres, Jupiter, Europa, Saturn, Uranus, Neptune, Pluto, Eris, Sedna.

From [warframe.com/en/news/star-chart](https://www.warframe.com/en/news/star-chart) **[V]**, the chart's persistent surrounding chrome is nine things: **Profile & Multiplayer** (Public / Friends Only / Invite Only / Solo), **Quests & Events**, **Duviri**, **Railjack**, **Steel Path**, **Nightwave**, **Adversaries** (your Lich / Sister shown *on the chart*), **Resource Drones**, **Chat** (Squad / Clan / Alliance + public channels).

### 3.2 Layout reconstruction **[I]**

Two states, plus a third for the node detail.

**State A — System view.** Camera looks at the Origin System from a shallow angle above the ecliptic. Planets are 3D models, not icons, each with a label + resource icons on hover (**[V]**, hover-labels were added in v14.1 per [Star Chart 2.0](https://wiki.warframe.com/index.php?title=Star_Chart_2.0&action=raw)). Bodies are laid out along a broad arc/spine across the screen rather than at true orbital radii — this is the single biggest deviation from "realistic solar system" and it exists so 19 bodies fit legibly. Connections between bodies are drawn as **Solar Rails**: thin lines with an animated energy flow along them. Locked branches are dashed and desaturated.

Screen budget, State A:
- Top-left ~18% × 10%: player card (avatar, name, MR, matchmaking mode).
- Top-right ~26% × 45%: World State Window, collapsed to a tab strip until opened.
- Right edge, vertically centred: **Steel Path toggle** **[V]**.
- Bottom-left ~30% × 22%: current loadout summary + squad slots.
- Bottom-right: Resource Drones **[V]**, Chat.
- The middle ~60% × 70% is the chart itself and is kept clear.

**State B — Planet view.** Selecting a planet dollies the camera in; the planet moves to roughly **screen-left third**, rendered large (~28–34% of viewport height); the node constellation fans out to the **right of the planet**, occupying the centre. **[V]** nodes were originally *"circular sectors"* around the planet in 2.0; in the current chart they are the rhombus nodes on a connected graph. Node positions do **not** correspond to geography — a documented player complaint ("nodes not making sense in terms of location").

**State C — Node selected.** An info panel appears (**[I]** left side, ~24% width, ~55% height, chamfered top-right/bottom-left) containing, top to bottom:
1. Node name + planet, big, all-caps.
2. Mission type icon + label (Exterminate / Survival / Defense…), faction badge (Grineer / Corpus / Infested / Corrupted), enemy **level range** as `n – m`.
3. Tileset name.
4. Reward preview — rotation rewards or a drop table teaser.
5. Node completion state, and for Steel Path a separate completion pip.
6. Squad row: 4 slots, host first.
7. **START / DESCEND** button, chamfered, gold, bottom-right of the panel.

### 3.3 How completion is shown **[V]+[I]**

Three independent axes, and getting this right is most of the perceived accuracy:
- **Per node:** locked (dashed/black) → available (blue) → completed (white). **[V]**
- **Per planet:** an aggregate "complete" icon when every node is done **[V]**, plus (in-game) a fraction on hover **[I]**.
- **Per mode:** normal and Steel Path track separately **[V]**.

This maps perfectly onto our "own 312/487" progression framing — same shape of problem.

### 3.4 Implementable: the node graph

Canvas, not DOM. 300 nodes × animated links × a starfield is fine on canvas and miserable in React DOM.

```ts
// starchart/render.ts — draw loop. Nodes in normalised [0..1] layout space.
type Node = { id: string; x: number; y: number; state: 'locked'|'available'|'done';
              kind?: 'boss'|'junction'|'openworld'; links: string[] };

const COL = { locked:'#1a2026', available:'#01d8ff', done:'#e8eef2',
              rail:'#2a3a44', railHot:'#e0a635' };            // [V] cyan, rest [G]

export function draw(ctx: CanvasRenderingContext2D, nodes: Node[], t: number,
                     view: {x:number;y:number;k:number}, hover: string|null) {
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  const P = (n: Node) => [ (n.x * view.k + view.x) * W, (n.y * view.k + view.y) * H ] as const;

  // --- rails, drawn under everything, with a travelling energy dash ---
  ctx.lineWidth = 1.25;
  for (const n of nodes) for (const id of n.links) {
    const m = byId[id]; if (!m) continue;
    const [ax, ay] = P(n), [bx, by] = P(m);
    const live = n.state !== 'locked' && m.state !== 'locked';
    ctx.strokeStyle = live ? COL.rail : 'rgba(120,140,150,.22)';
    ctx.setLineDash(live ? [] : [4, 5]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

    if (live) {                                   // energy pulse travelling the rail
      const len = Math.hypot(bx-ax, by-ay);
      ctx.save();
      ctx.setLineDash([14, len]);                 // one dash, rest gap
      ctx.lineDashOffset = -((t * 0.06 + n.x * 400) % (len + 14));
      ctx.strokeStyle = COL.railHot; ctx.lineWidth = 2;
      ctx.shadowBlur = 8; ctx.shadowColor = COL.railHot;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.restore();
    }
  }
  ctx.setLineDash([]);

  // --- nodes: rhombus, verified shape ---
  for (const n of nodes) {
    const [x, y] = P(n);
    const isHover = hover === n.id;
    const r = (n.kind === 'boss' ? 11 : n.kind === 'junction' ? 13 : 8) * (isHover ? 1.25 : 1);
    // "next step" pulse — DE ships this on junctions [V]
    if (n.kind === 'junction' && n.state === 'available') {
      const p = (Math.sin(t / 420) + 1) / 2;
      ctx.beginPath(); ctx.arc(x, y, r + 6 + p * 10, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(224,166,53,${0.35 * (1 - p)})`; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fillStyle = n.state === 'available' ? COL.available
                  : n.state === 'done' ? COL.done : '#07090b';
    if (n.state !== 'locked') { ctx.shadowBlur = isHover ? 20 : 10; ctx.shadowColor = ctx.fillStyle; }
    ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = n.state === 'locked' ? 'rgba(200,215,225,.35)' : '#fff';
    ctx.lineWidth = 1.5; ctx.setLineDash(n.state === 'locked' ? [3,3] : []); ctx.stroke();
    ctx.setLineDash([]);
    if (n.state === 'done') {                    // inner diamond = completed
      ctx.beginPath(); const s = r * 0.5;
      ctx.moveTo(x, y-s); ctx.lineTo(x+s, y); ctx.lineTo(x, y+s); ctx.lineTo(x-s, y);
      ctx.closePath(); ctx.fillStyle = '#0b1014'; ctx.fill();
    }
  }
}
```

Hit-testing: keep a `Float32Array` of screen-space x/y rebuilt each frame and do a linear scan on `pointermove` — 300 nodes is nothing, don't build a quadtree. `// ponytail: linear hit-test, O(n) per pointermove; add a grid bucket only if node count passes ~5k.`

Layout: precompute node positions once per planet with a **radial fan** (deterministic, no physics, no jitter between sessions):

```ts
// nodes fan out to the right of the planet, on nested arcs by depth in the link graph
const layout = (nodes: Node[]) => {
  const depth = bfsDepth(nodes);                 // planet entry node = 0
  const byDepth = groupBy(nodes, n => depth[n.id]);
  for (const [d, group] of byDepth) {
    const R = 0.10 + d * 0.085;                  // ring radius in layout units
    const spread = Math.min(Math.PI * 0.82, 0.28 + group.length * 0.13);
    group.forEach((n, i) => {
      const a = -spread/2 + (group.length === 1 ? spread/2 : (i / (group.length - 1)) * spread);
      n.x = 0.32 + Math.cos(a) * R;              // 0.32 = planet sits at screen-left third
      n.y = 0.50 + Math.sin(a) * R * 1.35;       // squash horizontally → reads as a fan
    });
  }
};
```

Zoom/pan: animate `view` with a spring, never with CSS transform on the canvas (blurs it). One `requestAnimationFrame` loop that draws only when `dirty || animating`.

**Planet rendering.** Don't ship a 3D engine for this. A 2D canvas planet is convincing:

```ts
function planet(ctx, cx, cy, R, t, tint = '#3d6b8a') {
  // body
  const g = ctx.createRadialGradient(cx - R*.35, cy - R*.35, R*.1, cx, cy, R);
  g.addColorStop(0, tint); g.addColorStop(.7, shade(tint, -.5)); g.addColorStop(1, '#05070a');
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fillStyle = g; ctx.fill();
  // terminator: a second offset radial, multiply
  ctx.save(); ctx.globalCompositeOperation = 'multiply';
  const s = ctx.createRadialGradient(cx + R*.45, cy + R*.2, R*.2, cx + R*.45, cy + R*.2, R*1.5);
  s.addColorStop(0, '#fff'); s.addColorStop(1, '#0a0a0a');
  ctx.fillStyle = s; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill(); ctx.restore();
  // rim light — the thing that sells it
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  ctx.lineWidth = R * .04; ctx.strokeStyle = 'rgba(150,210,255,.55)';
  ctx.shadowBlur = R * .35; ctx.shadowColor = 'rgba(120,190,255,.9)';
  ctx.beginPath(); ctx.arc(cx, cy, R * .995, Math.PI * 1.15, Math.PI * 1.95); ctx.stroke();
  ctx.restore();
  // slow rotation: sample a seamless noise texture with u offset += t*1e-5, or just
  // drift two overlapping radial "cloud" gradients — cheaper and reads fine at ≤200px.
}
```

**Steel Path toggle** — right edge, vertical, with the VFX DE added **[V]**:

```jsx
<button onClick={toggle}
  className="fixed right-0 top-1/2 -translate-y-1/2 wf-cut-tr h-40 w-14
             writing-mode-vertical uppercase tracking-[.3em] text-xs
             border-l-2 transition-colors duration-300"
  style={{ borderColor: steel ? '#c8442e' : 'var(--color-wf-line)',
           color: steel ? '#ffd9cf' : '#8fa3ad',
           background: steel ? 'linear-gradient(180deg,#2a0d08,#140506)' : 'transparent' }}>
  Steel Path
</button>
```
On toggle, run a full-screen shockwave: a radial `mask` ring expanding from the button over 700 ms while the chart's palette cross-fades to the Steel ramp (desaturate + red-shift via a `filter: hue-rotate()` on the canvas layer, or better, swap the `COL` object and let the next frame draw it — instant and free).

### 3.5 What makes it feel like Warframe

- The chart is **a place, not a menu**. Depth, parallax, real lighting on the planets, a starfield that moves.
- **Progression is legible at a glance** through three colours and one shape.
- **Live world state** bolted to the side of it — the chart is always slightly different from an hour ago.
- **The rails.** The connections are not abstract edges, they are Solar Rails with fiction attached, and they carry visible energy.

### 3.6 Overboard version

- **True 3D orbits with a "schematic ↔ orrery" morph.** Hold a key and the arc-laid chart lerps to true orbital positions for the current real date, planets on ellipses, then springs back. One `lerp(schematicPos, orbitalPos, u)` — cheap, and nobody else has it.
- **The rails carry *your* data.** Pulse frequency on each rail = your recent mission count on that route. Rails you have never run stay dark. The chart becomes a heat map of your own play.
- **Completion as light.** Each completed node contributes to a per-planet emissive; a fully cleared planet visibly glows and casts light on its neighbours' rails. Steel Path completion adds a second, red corona.
- **Fissure storms.** Active Void Fissures render as a distortion field — a canvas `globalCompositeOperation:'screen'` swirl + a real chromatic-aberration pass on the region (draw the layer three times at ±0.6px offsets in R/B). Relic-era matching fissures get a beacon.
- **Predictive routing.** Ask "what's my shortest path to Sedna Junction" and the chart animates the route: rails light in sequence, nodes flip to a "planned" state, and an ETA appears. This is the feature that justifies an overlay existing.
- **Depth-of-field.** Blur nodes off the focal ring with a two-pass canvas blur, or fake it: draw far nodes at 60% alpha with a 2px shadow and no stroke.
- **The Void.** When the Void is selected, invert everything — white-gold on cream, the Orokin theme — for that one planet only. Warframe does exactly this kind of per-context reskin and it's the strongest argument for the token architecture in §1.5.

---

## 4. The Arsenal

### 4.1 Structural facts **[V]**

From [Arsenal (wiki raw)](https://wiki.warframe.com/index.php?title=Arsenal&action=raw):

- Selected Warframe and weapons are **centred**; **"the right side of the screen"** carries item details and stats.
- Tabs: **Loadout** (Warframe, Primary, Secondary, Melee, Focus, Exalted Kit, Parazon), **Companion** (companion + its weapon), **Gear** (a **radial menu with twelve base slots**, plus emotes and heavy weapons), **Vehicles** (Archwing, Archgun, Archmelee, Necramech, K-Drive).
- Upgrade screen composition: **header** (item name, rank, mastery status, Forma count); **mod slots** in the middle; **special slots** (Aura for Warframes, Exilus, Stance for melee, Posture for beast claws); **Arcane slots on the right**; **Capacity gauge "located at the top-left, just above the Stats Summary panel"**; **Stats Summary in the left panel with colour-coded changes**; **three Config tabs**; **mod selection at the bottom with search, category filters and sort**.
- Appearance screen: **Physique** and **Colors** groups; helmets, skins, animations, attachments, syandanas; **sigils with rotation / width / height / offset / alpha**; **six colour channels: Primary, Secondary, Tertiary, Accents, Emissive, Energy**.
- Loadout slots earned at even Mastery Ranks (+15 at MR30); Parazon and Gear are universal across loadouts.

That is an unusually complete spec handed to us for free. **The Upgrade screen's geometry is verified: capacity top-left above stats, stats left, arcanes right, mods bottom.**

### 4.2 Layout **[I] proportions on a [V] skeleton**

```
┌──────────────────────────────────────────────────────────────────────┐
│  ← BACK        EXCALIBUR UMBRA   RANK 30   MASTERED   ⬡⬡⬡ 3 FORMA   │  header ~8%
├───────────────┬──────────────────────────────────┬───────────────────┤
│ CAPACITY      │                                  │  ARCANES          │
│ ███████░░ 47/60│         3D VIEWPORT             │  ◇ Arcane Energize│  ~18%
├───────────────┤        (the Warframe,            │  ◇ ─ empty ─      │
│ STATS         │         lit, rotatable)          ├───────────────────┤
│ Health   740  │                                  │  CONFIG  A  B  C  │
│ Shield   670  │      mod slots overlay the       │                   │
│ Armor    132  │      lower third of the viewport │                   │
│ Energy   200  │      as an 8-slot grid + Aura    │                   │
│ Sprint  1.00  │      + Exilus, chamfered cards   │                   │
│ ...           │                                  │                   │
├───────────────┴──────────────────────────────────┴───────────────────┤
│  [search] [Warframe|Aura|Exilus|…] [sort ▾]   ▤ mod tray, horizontal │  ~26%
└──────────────────────────────────────────────────────────────────────┘
   left ≈24%              centre ≈52%                right ≈24%
```

Stat rows use **colour-coded deltas [V]**: green when a pending mod raises the value, red when it lowers it, with the delta shown alongside the base. This is the highest-value interaction in the whole screen and the one people screenshot.

### 4.3 Implementable

**Capacity gauge** — segmented, not smooth. **[I]** it reads as discrete ticks:

```jsx
const Capacity = ({ used, max }) => (
  <div className="flex gap-[2px] h-3 wf-cut" style={{'--chamfer':'4px'}}>
    {Array.from({length: max}, (_, i) => (
      <i key={i} className="flex-1 transition-colors duration-150"
         style={{ background: i < used ? 'var(--color-wf-cyan)'
                : i < used + pending ? '#e9ba08'          /* pending mod, objective amber [V] */
                : 'rgba(255,255,255,.10)' }} />
    ))}
  </div>
);
```
At 60 capacity on a 240px gauge each tick is 2px — perfect. Over ~80, collapse to a continuous bar with tick marks every 10.

**Stat delta row:**

```jsx
const Stat = ({ label, base, next }) => {
  const d = next - base, up = d > 0;
  return (
    <div className="flex items-baseline gap-2 py-1 border-b border-white/[.06]">
      <span className="flex-1 text-[11px] uppercase tracking-wider text-white/45">{label}</span>
      <span className="tabular-nums text-white/90">{fmt(next ?? base)}</span>
      {d !== 0 && (
        <motion.span initial={{opacity:0, y: up ? 4 : -4}} animate={{opacity:1, y:0}}
          className="tabular-nums text-[11px]"
          style={{ color: up ? '#43b306' : '#c80406' }}>  {/* extraction green / enemy red [V] */}
          {up ? '▲' : '▼'}{fmt(Math.abs(d))}
        </motion.span>
      )}
    </div>
  );
};
```

**Polarity symbols.** **[V]** the polarity set and their letter-shapes ([Polarity, wiki raw](https://wiki.warframe.com/index.php?title=Polarity&action=raw)): **Madurai = V** (damage/powers), **Vazarin = D** (defensive/health/armor), **Naramon = dash/bar** (utility), **Zenurik = scratch** (warframe augments, melee stances), **Unairu = R**, **Penjaga = Y** (companion abilities), **Umbra = U** (anti-Sentient, post *The Sacrifice*), **Aura = O** (universal except Umbra).

Ship these as one inline SVG sprite — eight `<symbol>` elements, ~20 path commands each, ~2 kB total. Do not use icon fonts (they break at odd sizes and can't take a per-instance gradient).

```jsx
<svg width="0" height="0" className="hidden">
  <symbol id="pol-madurai" viewBox="0 0 24 24"><path d="M4 4 L12 20 L20 4 L16 4 L12 13 L8 4 Z"/></symbol>
  <symbol id="pol-vazarin" viewBox="0 0 24 24"><path d="M5 3 H12 A9 9 0 0 1 12 21 H5 V17 H12 A5 5 0 0 0 12 7 H9 V21 H5 Z"/></symbol>
  <symbol id="pol-naramon" viewBox="0 0 24 24"><path d="M3 10 H21 V14 H3 Z"/></symbol>
  {/* zenurik: an angled scratch; unairu: R; penjaga: Y; umbra: U; aura: O */}
</svg>
<svg className="w-3 h-3 fill-[--color-wf-accent]"><use href="#pol-madurai"/></svg>
```
(The path data above is my reconstruction **[G]** — trace the real glyphs from a screenshot before shipping; they are angular and slightly asymmetric, not geometric letters.)

**Drain maths, verified [V]** ([Mod, wiki raw](https://wiki.warframe.com/index.php?title=Mod&action=raw)): matching polarity **halves drain, rounded up**; non-matching **increases** drain, scaled by base cost (0–1 → +0, 2–5 → +1, 6–9 → +2, …). Aura/Stance/Posture *add* capacity instead: matching **doubles** the bonus, non-matching **reduces by 25%**. Base capacity floor is **15 + 1 per 2 Mastery Ranks**; max normally 30 (some 40); Reactor/Catalyst doubles it.

```ts
export const drain = (cost: number, slot: Polarity|null, mod: Polarity|null) =>
  slot && mod && slot === mod ? Math.ceil(cost / 2)
  : slot && mod ? cost + Math.floor((cost + 2) / 4)     // 0-1→0, 2-5→+1, 6-9→+2 [V] pattern
  : cost;

// ponytail: one runnable check, no framework
if (import.meta.vitest) { /* or a plain assert block under `node arsenal.js` */ }
console.assert(drain(9,'v','v') === 5 && drain(1,'v','d') === 1
            && drain(5,'v','d') === 6 && drain(9,'v','d') === 11, 'drain table');
```

### 4.4 What makes it feel like Warframe, and the overboard version

**Feel:** the frame is *right there*, lit, huge, and it reacts — colour changes apply live, the model animates in an idle. Numbers on the left, fantasy in the middle, jewellery on the right.

**Overboard:**
- Stat deltas **animate the bar, not just the number** — a ghost bar shoots to the new value and settles, leaving a thin marker at the old one.
- **Build comparison ghosting:** hold a key and Config A's stats overlay Config B's as translucent bars.
- **A live damage simulator** in the empty right column: a small canvas plotting DPS vs armour, redrawn as you hover mods. This is what an *overlay* can do that the game can't.
- Equipping a mod triggers a **plate-slam**: the card scales from 1.15 → 1 with a 3-frame chromatic split and a 40 ms screen shake on the panel only (`translate3d` on the panel wrapper, never on body).

---

## 5. The Mod screen

### 5.1 Structural facts **[V]**

From [Mod (wiki raw)](https://wiki.warframe.com/index.php?title=Mod&action=raw):

- **Rarity → material + diamond count**, and the diamonds are **at the top of the card**: *"Most mods have an increasing number of diamonds at the top of their mod cards depending on their rarity."*
  - Common = **Bronze**, ♦
  - Uncommon = **Silver**, ♦♦
  - Rare = **Gold**, ♦♦♦
  - Legendary = **Platinum**, ♦♦♦♦
  - Riven = **Crystal / purple**, ♦♦♦♦♦
  - Archon = **"Narmer" material**, ♦♦♦♦♦ distinctive styling
  - Galvanized = **Metallic**
  - Umbra = Legendary rarity, exclusive Umbra polarity
  - Primed = Legendary rarity, max rank 10
- **Rank is shown as "blue pips on the bottom of the card"** — verbatim.
- Card carries: name, effect text, item compatibility, variant descriptor (Flawed / Primed / Amalgam), a special indicator for Aura / Stance / Exilus / Riven / Set membership, **drain number + polarity symbol**, rank pips, owned quantity, rarity.
- Mod Console actions: **Fusion, Transmute, Sell, Dissolve, Quick Select, Filter**.
- Fusion consumes **Endo + Credits**; Endo for rank 0→1 is set by rarity and **each subsequent rank doubles**.

So the card anatomy is *fully specified by a source*. This is the single most replicable object in the game and it should be the showpiece component of our overlay.

### 5.2 Card anatomy and geometry **[I] for pixels, [V] for element placement**

Aspect ratio ≈ **2:3** (a playing card). At 220 × 330:

```
┌────────────────────────────┐  ← chamfered top corners, rarity-metal frame
│  ♦♦♦            [V] 9      │  diamonds top-centre [V]; drain+polarity top-right [V]
│  ┌──────────────────────┐  │
│  │      artwork          │  │  ~48% of height, a lit 3D still with a coloured haze
│  └──────────────────────┘  │
│      SERRATION             │  name, all-caps, centred, ~18px
│   +165% Damage             │  effect text, accent colour on the number
│   ────────────────         │
│   RIFLE                    │  compatibility, small, dimmed
│  ● ● ● ● ● ● ● ● ○ ○       │  rank pips, blue, bottom [V]
└────────────────────────────┘
```

Frame by rarity — this is where the "metal" reads. Use a **conic gradient border**, which is how you get a metal that catches light as it rotates:

```css
.mod-card {
  --metal-a:#8a6a3a; --metal-b:#e6c07a; --metal-c:#5a4325;   /* bronze [G] */
  position: relative; aspect-ratio: 2/3; --chamfer: 16px;
}
.mod-card[data-rarity="uncommon"] { --metal-a:#7d8894; --metal-b:#e8eef4; --metal-c:#4b545e; }
.mod-card[data-rarity="rare"]     { --metal-a:#8c6a17; --metal-b:#ffd977; --metal-c:#5a4207; }
.mod-card[data-rarity="legendary"]{ --metal-a:#9aa3ad; --metal-b:#ffffff; --metal-c:#6d757e; }
.mod-card[data-rarity="riven"]    { --metal-a:#5b2a8f; --metal-b:#c79bff; --metal-c:#2c1147; }
.mod-card[data-rarity="archon"]   { --metal-a:#7a4a12; --metal-b:#ffc46b; --metal-c:#3a1f05; }

.mod-card::before {                    /* the frame */
  content:''; position:absolute; inset:0; clip-path: var(--cut-4);
  background: conic-gradient(from var(--spin, -30deg),
    var(--metal-c), var(--metal-b) 18%, var(--metal-a) 34%,
    var(--metal-c) 52%, var(--metal-b) 70%, var(--metal-a) 86%, var(--metal-c));
}
.mod-card::after {                     /* the face, inset by frame width */
  content:''; position:absolute; inset:3px; clip-path: var(--cut-4);
  background: linear-gradient(160deg, #10161b, #070a0d 60%, #0d1216);
}
.mod-card > * { position: relative; z-index: 1; }
```
Animate `--spin` on hover with `@property --spin { syntax:'<angle>'; inherits:false; initial-value:-30deg }` → the metal genuinely rolls. That one trick does more for perceived fidelity than any amount of texture work.

**Tilt + specular** on hover (this is the moment people remember):

```jsx
const onMove = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
  e.currentTarget.style.setProperty('--rx', `${(0.5 - py) * 14}deg`);
  e.currentTarget.style.setProperty('--ry', `${(px - 0.5) * 16}deg`);
  e.currentTarget.style.setProperty('--mx', `${px * 100}%`);
  e.currentTarget.style.setProperty('--my', `${py * 100}%`);
};
```
```css
.mod-card { transform: perspective(900px) rotateX(var(--rx,0)) rotateY(var(--ry,0));
            transition: transform 120ms ease-out; transform-style: preserve-3d; }
.mod-card .glare {           /* the moving highlight */
  position:absolute; inset:0; pointer-events:none; mix-blend-mode: screen;
  background: radial-gradient(220px circle at var(--mx,50%) var(--my,50%),
              rgba(255,255,255,.22), transparent 60%);
}
```

**Rank pips [V]** — blue, bottom edge:

```jsx
<div className="absolute bottom-2 inset-x-3 flex gap-[3px] justify-center">
  {Array.from({length: maxRank}, (_, i) => (
    <span key={i} className="h-[5px] flex-1 max-w-[14px] skew-x-[-20deg]"
      style={{ background: i < rank ? '#01d8ff' : 'rgba(255,255,255,.12)',
               boxShadow: i < rank ? '0 0 6px #01d8ff88' : 'none' }} />
  ))}
</div>
```
(The skew is **[I]** — Warframe's pips are parallelograms, not rectangles.)

**Rarity diamonds [V]** — top of card, count = rarity tier:

```jsx
<div className="absolute top-2 left-1/2 -translate-x-1/2 flex gap-[3px]">
  {Array.from({length: DIAMONDS[rarity]}, (_, i) =>
    <i key={i} className="w-[7px] h-[7px] rotate-45"
       style={{ background:'var(--metal-b)', boxShadow:'0 0 5px var(--metal-b)' }} />)}
</div>
```

### 5.3 The drag interaction

**[I]** Drag from the bottom tray to a slot. The real feel comes from three details:

1. **Ghost follows with lag.** The dragged card trails the cursor by a spring, and *tilts into* the direction of travel (`rotateZ = clamp(vx * 0.06, -12, 12)`).
2. **Compatible slots wake up.** The instant a drag starts, every valid slot brightens and grows a pulsing bracket; invalid slots dim to 30% and desaturate. Polarity-matching slots get a gold ring *and* the drain number in the corner recomputes live to the halved value.
3. **Snap with weight.** On drop, the card scales 1.06 → 1 over 180 ms with `wfEaseSnap`, the capacity gauge's new segments fill left-to-right at 20 ms/segment, and the affected stat rows flash their delta.

Use the Pointer Events API directly — `dnd-kit` and friends are 30 kB for a behaviour that is 40 lines here, and they fight the spring.

```ts
// drag core — pointer capture, no library
function useCardDrag(onDrop: (slot: string) => void) {
  const state = useRef({ id: '', x:0, y:0, vx:0 });
  const down = (e: React.PointerEvent, id: string) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    state.current = { id, x: e.clientX, y: e.clientY, vx: 0 };
    setDragging(id);                       // → slots read this and light up
  };
  const move = (e: React.PointerEvent) => {
    if (!state.current.id) return;
    state.current.vx = e.clientX - state.current.x;
    state.current.x = e.clientX; state.current.y = e.clientY;
    ghostX.set(e.clientX); ghostY.set(e.clientY);           // motion values, springed
    ghostRot.set(clamp(state.current.vx * 0.6, -12, 12));
  };
  const up = (e: React.PointerEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-slot]');
    if (el) onDrop(el.getAttribute('data-slot')!);
    setDragging(null); state.current.id = '';
  };
  return { down, move, up };
}
```

### 5.4 Fusion / upgrade interface

**[V]** Fusion spends **Endo + Credits**; cost doubles per rank; rarity sets the base. **[I]** The presentation: the target card sits centre, enlarged; a large **Endo counter** and a **cost** below; a **RANK UP** button; and on confirm the card's pip row advances one step with a bright sweep across the card face and a rising audio tone.

```css
/* the fusion sweep — a single element, animated once on rank-up */
@keyframes fuse-sweep { from { transform: translateX(-120%) skewX(-18deg) }
                          to { transform: translateX(220%)  skewX(-18deg) } }
.fuse-sweep { position:absolute; inset:-10% -40%; pointer-events:none;
  background: linear-gradient(90deg, transparent, #01d8ff 45%, #fff 50%, #01d8ff 55%, transparent);
  opacity:.85; mix-blend-mode: screen; animation: fuse-sweep 520ms cubic-bezier(.3,0,.2,1) both; }
```

### 5.5 Feel / overboard

**Feel:** mods are *cards*, physical objects with weight, metal and light. The screen is a collection, not a settings list.

**Overboard:**
- **Endo cost preview as a ladder** — hovering the rank-up button shows every remaining rank's cost as a receding staircase with a running total and "you can afford through rank 7" marked.
- **Riven cards get a real shader.** Riven = "Crystal purple" **[V]**; render its face as a canvas with a scrolling voronoi/refraction pattern and per-card randomised seed. Rivens are randomised in fiction; make the card literally unique.
- **Max-rank cards emit.** A ranked-10 Primed mod gets a slow, expensive-looking bloom and a subtle particle drift — earned visual difference.
- **Collection wall.** Show all owned mods as a wall of cards in canvas with depth, and let the user fly through it. 1,200 mods at 24 px each is trivially fast in canvas and impossible in DOM.

---

## 6. The Foundry

### 6.1 Structural facts **[V]**

From [Foundry (wiki raw)](https://wiki.warframe.com/index.php?title=Foundry&action=raw):

- Categories appear **only when they contain items** — a dynamic tab strip: Warframes, Archwings, Companions, Weapons, Gear, Keys, Fishing, Amps, Modular Weapons, Landing Craft.
- **Unlimited simultaneous builds**; the only rule is no two builds of the *same* item at once.
- Reusable blueprints display a **"gold-tinted background and 'REUSABLE BLUEPRINT' at the bottom"** — verbatim.
- In-progress items render **"as a solid mass of energy in the shape of said item"**, acquiring proper colours on completion. This is the Foundry's signature visual and it is a *hologram-fill* effect.
- Builds progress **while logged out**, in real time.
- Component list shows inventory as `owned/required` (e.g. `23,138/100`); hovering a resource reveals its drop locations.
- **CLAIM ALL** appears when several items are ready.
- Rush cost after 50%: `Initial rush cost × (1 - ((Progress - 50) / 100))`.

### 6.2 Layout **[I]**

Left: category rail (dynamic). Centre: the item being built, large, as the energy-mass hologram, rotating slowly on a plinth, with the countdown beneath it. Right: the component checklist with `owned/required` per line, red when short. Bottom-right: **RUSH (platinum)** and **CLAIM**.

The build queue is a **horizontal strip along the bottom** **[I]**, each entry a chamfered tile with a thin progress bar and remaining time; completed entries glow gold and jump the queue to the front.

### 6.3 Implementable: the energy-mass hologram

The most distinctive Foundry visual, and it is achievable with one silhouette image (or a canvas-rendered shape) plus masks:

```css
.foundry-hologram {
  --p: .62;                                     /* build progress */
  -webkit-mask-image: var(--silhouette);        /* the item's alpha silhouette */
          mask-image: var(--silhouette);
  mask-size: contain; mask-repeat: no-repeat; mask-position: center;
  background:
    /* the completed portion: real colours, revealed bottom-up */
    linear-gradient(to top, transparent calc(var(--p)*100%), transparent 0),
    /* the energy mass */
    linear-gradient(to top, #0aa8d8 0%, #01d8ff 55%, #bff4ff 100%);
  position: relative; filter: drop-shadow(0 0 24px #01d8ff66);
}
.foundry-hologram::after {                       /* travelling build line */
  content:''; position:absolute; inset:0;
  background: linear-gradient(to top, transparent calc(var(--p)*100% - 2px),
              #fff calc(var(--p)*100% - 2px) calc(var(--p)*100% + 1px),
              transparent calc(var(--p)*100% + 1px));
  mix-blend-mode: screen;
}
/* scanline drift over the energy mass */
.foundry-hologram::before {
  content:''; position:absolute; inset:-50% 0;
  background: repeating-linear-gradient(0deg, rgba(255,255,255,.14) 0 1px, transparent 1px 4px);
  animation: hol-drift 3.5s linear infinite; mix-blend-mode: overlay;
}
@keyframes hol-drift { to { transform: translateY(4px) } }
```
Layer the *finished* art beneath with `clip-path: inset(calc(100% - var(--p)*100%) 0 0 0)` and you get the exact "fills up with real colour as it completes" behaviour.

**Timers.** Foundry builds are 12 h / 24 h / 72 h. Do not `setInterval` per row.

```ts
// one ticker for the whole app; rows subscribe. Cheap, and stays correct across sleep.
const useNow = (ms = 1000) => {
  const [, force] = useReducer(x => x + 1, 0);
  useEffect(() => { const id = setInterval(force, ms); return () => clearInterval(id); }, [ms]);
  return Date.now();
};
// display: >1h → "23h 04m"; <1h → "58:12"; <60s → "12s" and switch the row to amber
```
Persist `finishesAt` as an absolute epoch ms, never a remaining duration — an overlay gets suspended constantly.

**Claim interaction [I]:** the ready tile pulses gold; clicking it plays a short "materialise" — the hologram snaps to full colour, a ring shockwave leaves the plinth, the tile flips out of the queue. `CLAIM ALL` **[V]** should run them in a 90 ms stagger, not simultaneously; the cascade is the payoff.

### 6.4 Feel / overboard

**Feel:** manufacturing as ritual. Real-world time you cannot skip except with money. The hologram makes waiting visible.

**Overboard:**
- **Desktop notifications when a build completes**, with the hologram rendered into the notification image. This is the killer feature of a companion overlay and it is ~30 lines.
- **A resource-shortfall solver**: for any queued build you're short on, show *which nodes drop it* (we have the drop data) and offer to jump the Star Chart there. Warframe shows drop locations on hover **[V]**; we can go one better and route to it.
- **Foundry as a Gantt chart** — all builds on one timeline with day/night bands, so you can see your next 72 hours at a glance.
- Completed-but-unclaimed items **accumulate physically** in a rendered rack, and the rack visibly overflows if you hoard.

---

## 7. Profile / Mastery

### 7.1 Structural facts **[V]**

From [Player Profile (wiki raw)](https://wiki.warframe.com/index.php?title=Player_Profile&action=raw) and [Mastery Rank (wiki raw)](https://wiki.warframe.com/index.php?title=Mastery_Rank&action=raw):

- Tabs: **Profile**, **Equipment**, **Stats**, **Syndicates**, **Challenges**, **Wishlist**.
- Profile tab: username + **Honoria**, a **diorama** of equipped Warframe / weapons / Operator, **Mastery Rank with total mastery XP and XP needed for next rank**, accolades (Founder tiers, Creator/Partner badges), Clan, **Death Marks**, Alignment.
- Equipment tab: most-used gear by category, with unobtained items hidden.
- Stats tab: time played, credits earned, **Star Chart progress**, kills by faction and by boss, Eidolon captures/kills, accuracy, Conclave, Lunaro, mini-game high scores.
- Mastery is also surfaced by **hovering the avatar in the top-left corner of the UI** — verbatim.
- **XP curve: `2,500 × Rank²` up to MR30; Legendary: `2,250,000 + 147,500 × LR#`.** **[V]** — exact, use it.
- Rank titles progress Unranked → Initiate → Silver Initiate → Gold Initiate → Novice → … Disciple, Hunter, Eagle, Tiger, Dragon, Sage, Master, then **Legendary Rank (LR)** past 30.
- Rank-up tests are solo, with a **23-hour cooldown** after success, replayable at Cephalon Simaris.

### 7.2 Layout **[I]**

Left third: the diorama on a dark plinth. Centre-left: a **large Mastery insignia** — the rank sigil, which is the game's most ornamental single graphic — with the progress arc around it and `currentXP / nextXP` beneath. Right two thirds: the stat grid, 3–4 columns of label/value pairs grouped under thin rules with all-caps section headers.

The insignia is worth real effort. It is a layered emblem: an outer ring of tick marks, an inner geometric badge whose complexity increases with rank, and a numeral.

### 7.3 Implementable: the mastery ring

```jsx
const MasteryRing = ({ rank, xp }) => {
  const need = rank < 30 ? 2500 * (rank + 1) ** 2 : 2250000 + 147500 * (rank - 29);  // [V]
  const have = rank < 30 ? 2500 * rank ** 2 : 2250000 + 147500 * (rank - 30);
  const p = clamp((xp - have) / (need - have), 0, 1);
  const R = 92, C = 2 * Math.PI * R;
  return (
    <svg viewBox="0 0 220 220" className="w-56 h-56">
      <defs>
        <linearGradient id="mg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"  stopColor="#e0a635"/>   {/* [I] gold */}
          <stop offset="55%" stopColor="#ffe9a8"/>
          <stop offset="100%" stopColor="#e0a635"/>
        </linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="3" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      {/* tick ring — 60 ticks, longer every 5th */}
      {Array.from({length:60}, (_,i)=>{
        const a = (i/60)*2*Math.PI - Math.PI/2, long = i%5===0;
        const r0 = R+10, r1 = R + (long?20:15);
        return <line key={i} x1={110+Math.cos(a)*r0} y1={110+Math.sin(a)*r0}
                     x2={110+Math.cos(a)*r1} y2={110+Math.sin(a)*r1}
                     stroke="#ffffff" strokeOpacity={long?0.35:0.14} strokeWidth={long?1.6:1}/>;
      })}
      <circle cx="110" cy="110" r={R} fill="none" stroke="#ffffff14" strokeWidth="6"/>
      <motion.circle cx="110" cy="110" r={R} fill="none" stroke="url(#mg)" strokeWidth="6"
        strokeLinecap="butt" filter="url(#glow)" transform="rotate(-90 110 110)"
        strokeDasharray={C} initial={{strokeDashoffset:C}}
        animate={{strokeDashoffset: C * (1 - p)}}
        transition={{duration:1.1, ease:[0.16,1,0.3,1], delay:.15}}/>
      <text x="110" y="104" textAnchor="middle" className="fill-white"
            style={{font:'700 54px/1 var(--font-wf)', letterSpacing:'-.02em'}}>{rank}</text>
      <text x="110" y="130" textAnchor="middle" className="fill-white/45"
            style={{font:'500 11px/1 var(--font-wf)', letterSpacing:'.28em'}}>MASTERY</text>
    </svg>
  );
};
```

Note `strokeLinecap="butt"` — round caps make it look like a fitness app. Warframe's arcs terminate hard.

**Stats grid [I]:** two-column `label / tabular-nums value`, `border-b border-white/[.06]`, section headers all-caps at 10px with `tracking-[.28em]` and a 1px rule that stops short of the column edge. Numbers right-aligned, `font-variant-numeric: tabular-nums`, and **count up on mount** (400 ms, ease-out) — this is free and enormously satisfying with 40 stats.

### 7.4 Feel / overboard

**Feel:** the profile is a *trophy case*. Ornament proportional to achievement, and a real 3D diorama of your character rather than an avatar crop.

**Overboard — this is our Progression panel, so go hard:**
- **The ring is not one ring.** Concentric arcs: outer = mastery to next rank, then Star Chart completion, then Steel Path completion, then codex scans, then Nightwave. Five arcs, one glance. Each with its own hue from the verified palette.
- **Rank-up as an event.** When mastery crosses a threshold, the whole overlay reacts: the ring overfills past 360°, snaps back to 0 with the numeral rolling over, gold particles, an audio sting.
- **Mastery velocity.** Plot XP/day for 30 days as a sparkline under the ring, with a projected date for the next rank. The game cannot do this; we have history.
- **The unclaimed-mastery list**, ranked by XP-per-hour-of-effort: "these 6 weapons are 3,000 mastery each and you own the blueprints." Actionable, and the single most-wanted Warframe companion feature.
- **A physical trophy shelf** in canvas: one object per milestone, lit, with parallax.

---

## 8. The Codex

### 8.1 Structural facts **[V]**

From [Codex (wiki raw)](https://wiki.warframe.com/index.php?title=Codex&action=raw):

- Sections: **Warframes, Weapons, Companions, Mods, Arcane Enhancements, Void Relics, Enemies, Quests, Fragments, Leverian, Missions.**
- Entries pair a **diorama (3D model)** with detail text.
- **Progressive disclosure by scan count** — this is the Codex's whole personality:
  - 1st scan → name, diorama, faction, base health/armor
  - 25% → description + common drops
  - 50% → Star Chart spawn regions + uncommon drops
  - 100% → full vulnerabilities/resistances + rare drops
- Damage vulnerabilities shown as **colour-coded labels: green `++` = +50%, red `--` = −50%.**
- **Relic search also searches relic *contents*** — search matches nested data, not just titles.
- Quest list is sorted **Active > Incomplete > Complete**, explicitly to avoid scrolling through alphabetical order.

That last one is a design principle worth stealing outright: **sort by relevance to the player's current state, not alphabetically.**

### 8.2 Layout **[I]**

Classic master–detail: category rail left (~16%), scrolling entry list next (~26%), detail pane right (~58%) with the diorama occupying its upper half. Search at the top of the list column; filters as a row of chamfered toggle chips beneath it.

### 8.3 Implementable

For "own 312 / 487" views the *only* hard problem is rendering thousands of rows without jank. Do not reach for a virtualisation library first — `content-visibility` gets you most of the way in three lines:

```css
.codex-row { content-visibility: auto; contain-intrinsic-size: auto 56px; }
```
That skips layout and paint for off-screen rows natively. **`// ponytail: content-visibility only; add @tanstack/react-virtual if the list passes ~5k rows or we need scroll-to-index.`**

Completion is the hero number:

```jsx
<div className="flex items-baseline gap-3">
  <span className="text-5xl tabular-nums font-semibold">{owned}</span>
  <span className="text-xl text-white/35 tabular-nums">/ {total}</span>
  <span className="ml-auto text-sm" style={{color:'var(--color-wf-accent)'}}>
    {((owned/total)*100).toFixed(1)}%
  </span>
</div>
<div className="mt-2 h-[6px] wf-cut" style={{'--chamfer':'3px', background:'rgba(255,255,255,.08)'}}>
  <motion.i className="block h-full" style={{background:'var(--color-wf-accent)'}}
            initial={{width:0}} animate={{width:`${(owned/total)*100}%`}}
            transition={{duration:.9, ease:[0.16,1,0.3,1]}}/>
</div>
```

Scan-progress rings on each row (the Codex's own idiom): reuse `.wf-ring` at 18px, `--pct` = scans/required.

The vulnerability table, exactly as the game shows it **[V]**:

```jsx
{Object.entries(mods).map(([type, mult]) => (
  <div key={type} className="flex items-center gap-2 text-xs">
    <DamageIcon type={type} />
    <span className="flex-1 uppercase tracking-wide text-white/60">{type}</span>
    <span style={{ color: mult > 1 ? '#43b306' : mult < 1 ? '#c80406' : '#808080' }}>
      {mult > 1 ? '++' : mult < 1 ? '--' : '·'} {Math.round((mult-1)*100)}%
    </span>
  </div>
))}
```

### 8.4 Feel / overboard

**Feel:** knowledge is *earned*, revealed in tiers, and every entry has a 3D model. The Codex feels like an archive you are filling in, not a database you are reading.

**Overboard:**
- **Keep the progressive reveal but base it on our data.** Entries you have never encountered render as redacted glyphs with a dissolve-noise mask; encountering one plays a decode animation (characters cycling to the real string over 400 ms).
- **Constellation view of the collection.** Render all 487 items as points; owned ones lit and linked to their source nodes; unowned dark. Filter by planet and the constellation reshapes.
- **Fuzzy search over nested content** — match relic contents, mod effects, drop sources (the game does this for relics **[V]**; extend it everywhere), with the matched substring highlighted in the accent colour.
- A "**what should I chase next**" ranking: unowned items sorted by drop-chance × mastery value ÷ effort.

---

## 9. Market / Syndicate — the dense list + detail pattern

### 9.1 Structural facts **[V]**

Market ([wiki raw](https://wiki.warframe.com/index.php?title=Market&action=raw)): tabs **Warframes, Weapons, Equipment, Companions, Bundles**; **click the Credits icon at the top right of an item to buy its Blueprint instead** of the finished item — a currency toggle *on the tile*; some items carry an icon that **"tells you where to get that particular item"** through gameplay; bundles show **prorated prices** when you already own parts.

Syndicates ([wiki raw](https://wiki.warframe.com/index.php?title=Syndicate&action=raw)): the panel shows the syndicate you're **pledged to** prominently; **standing within rank vs max**, **daily standing remaining**; a **coloured rank icon — green = positive, yellow = neutral, red = negative**; rank-up spends **all** accumulated standing plus material sacrifices, and grants a **choice of gift**; each syndicate's **allied/opposed/neutral/hostile relationships** are displayed because supporting one moves the others.

### 9.2 The pattern

Both are the same object: **a filterable grid/list on the left-to-centre, a rich detail panel on the right, a persistent currency readout in the header.** Warframe's version is dense — tiles ~180×220 with the art bleeding to the tile edge, a name bar across the bottom, price top-right, and an ownership state (owned / mastered / in inventory) as a corner flag.

### 9.3 Implementable

**Currency header** — always visible, always the same place (top-right) **[I]**:

```jsx
<div className="flex items-center gap-5 text-sm tabular-nums">
  <span className="flex items-center gap-1.5"><PlatIcon className="w-4 h-4 text-[#5cc7f0]"/>{plat}</span>
  <span className="flex items-center gap-1.5"><CreditIcon className="w-4 h-4 text-[#e0a635]"/>{fmt(credits)}</span>
  <span className="flex items-center gap-1.5"><EndoIcon  className="w-4 h-4 text-[#b6c2c9]"/>{fmt(endo)}</span>
</div>
```

**Ownership corner flag** — a chamfered triangle, the cheapest possible "you have this":

```css
.tile[data-owned]::after {
  content: attr(data-owned);           /* "OWNED" / "MASTERED" */
  position:absolute; top:0; right:0; padding:2px 8px 3px;
  font:600 9px/1 var(--font-wf); letter-spacing:.16em;
  background: var(--color-wf-accent); color:#0a0a0a;
  clip-path: polygon(10px 0, 100% 0, 100% 100%, 0 100%);
}
```

**Standing bar with the daily cap marker** — the detail that makes it read as Syndicate rather than generic XP:

```jsx
<div className="relative h-3 bg-white/[.07] wf-cut" style={{'--chamfer':'5px'}}>
  <i className="absolute inset-y-0 left-0" style={{width:`${pct*100}%`, background:SYN[id].color}}/>
  {/* daily cap: how far you can still go today */}
  <i className="absolute inset-y-0" style={{ left:`${pct*100}%`, width:`${dailyLeftPct*100}%`,
        background:`repeating-linear-gradient(115deg,${SYN[id].color}55 0 6px,transparent 6px 12px)`}}/>
  <span className="absolute -top-5 right-0 text-[10px] tabular-nums text-white/50">
    {fmt(standing)} / {fmt(rankMax)}
  </span>
</div>
```

**Relationship display [V]** — the six syndicates with allied/opposed edges is a graph, and drawing it as one is both accurate and better than a table: six nodes on a hexagon, green edges for allied, red for opposed, edge thickness = strength. Twelve `<line>`s. Hovering a syndicate dims the unrelated ones.

```jsx
const HEX = Array.from({length:6}, (_,i) => {
  const a = (i/6)*2*Math.PI - Math.PI/2;
  return { x: 110 + Math.cos(a)*78, y: 110 + Math.sin(a)*78 };
});
```

### 9.4 Feel / overboard

**Feel:** dense, commercial, and *opinionated* — the game constantly tells you the alternative acquisition path (blueprint instead of purchase, "where to get this"). That honesty is a design signature and we should copy it.

**Overboard:**
- **Real market data.** Overlay warframe.market median prices next to the platinum price, with a 7-day sparkline. Immediately more useful than the real screen.
- **"Can I afford this?"** — dim tiles you can't afford, and show a shortfall bar rather than nothing.
- **Syndicate relationship graph as a live physics toy**: pledging pulls allied nodes toward you and pushes opposed ones away, with the standing consequence numerically attached to each edge as it animates.

---

## 10. The in-mission HUD

### 10.1 Structural facts **[V]**

All from [Heads-Up Display (wiki raw)](https://wiki.warframe.com/index.php?title=Heads-Up_Display&action=raw):

- **Upper left:** shields as a **blue number**, health as a **red number**, each with a coloured bar. Below: warframe name, rank, and a **white-circled squad-position number** (1 = host). An **affinity bar fills white**, and **disappears at max rank**. **Buff icons in blue to the left** of the health/shield counters; **debuffs in red**.
- Companion stats below yours; **ally stats below the companion's** (shield, health, energy, name, squad position).
- **Weapon block:** magazine ammo as a **large bold number**, reserve after a slash. Melee replaces it with a **combo counter (damage multiplier + hit count) once five hits register**. Below: weapon name, rank, affinity gauge. **Syndicate weapon icons fill with white** as affinity converts.
- **Abilities:** four white icons, 1–4, **left to right**, lighting **blue** when selected/recently cast, **greyed** when unaffordable or locked, with **countdown timers** on duration abilities. A **light-blue energy gauge** with a **white numeric** readout.
- **Minimap:** player is a **white triangle in the middle pointing where you face**; terrain as **white lines**; hostile areas **red**; default view covers **100 × 60 metres centred on the player**; `M` toggles small vs larger rotating view.
- **Reticle:** a small white dot; turns **red with expanded quarter-circles** on an enemy, **blue** on an ally; **reload shows as a clockwise white ring forming from the top**.
- Full HUD element colour customisation since v29.10, with the ten presets and the hex table reproduced in §1.5.

That is an unusually precise spec — the reticle behaviour, the 100×60 m minimap extent, the "affinity bar disappears at max rank", the five-hit combo threshold. Use the real numbers.

### 10.2 Screen budget **[I]**

Corners, ruthlessly. Centre 60% is untouched: top-left = vitals + buffs; bottom-left = abilities + energy; bottom-right = weapon/ammo; top-right = minimap + objective; centre = reticle + damage numbers; centre-top = waypoint/objective text. Everything hugs its corner with ~24–32 px of margin and nothing crosses the middle.

### 10.3 Implementable

**Health/shield bar pair.** They are *stacked*, sheared, with the number *outside* the bar:

```jsx
const Vitals = ({ hp, hpMax, sh, shMax, over }) => (
  <div className="flex flex-col gap-1 w-[280px]">
    <Bar value={sh} max={shMax} color={over ? '#b201fe' : '#01d8ff'} label={Math.round(sh)} />
    <Bar value={hp} max={hpMax} color="#cc2a28" label={Math.round(hp)} />
  </div>
);
const Bar = ({ value, max, color, label }) => (
  <div className="flex items-center gap-2">
    <span className="w-14 text-right tabular-nums text-lg font-semibold"
          style={{color, textShadow:`0 0 12px ${color}80`}}>{label}</span>
    <div className="relative flex-1 h-[9px] skew-x-[-24deg] bg-white/[.09] overflow-hidden">
      <motion.i className="absolute inset-y-0 left-0" style={{background:color}}
        animate={{width:`${(value/max)*100}%`}} transition={{duration:.18, ease:'easeOut'}}/>
      {/* the "damage ghost": a paler bar that lags 400ms behind — sells every hit */}
      <motion.i className="absolute inset-y-0 left-0 opacity-40"
        style={{background:'#fff'}} animate={{width:`${(ghost/max)*100}%`}}
        transition={{duration:.6, delay:.25, ease:'easeIn'}}/>
    </div>
  </div>
);
```
The `skew-x-[-24deg]` on the bar and the **glow-through-text-shadow** on the numeral are the two details that make it read as Warframe rather than as any other shooter.

**Ability icons.** Four, left to right, with cost, cooldown ring and the verified selected/unselected colours:

```jsx
{abilities.map((a, i) => (
  <div key={a.id} className="relative w-14 h-14 wf-cut-4" style={{'--chamfer':'6px'}}>
    <img src={a.icon} className="w-full h-full object-contain p-2"
         style={{ filter: a.affordable ? 'none' : 'grayscale(1) brightness(.45)',
                  // [V] selected #01d6fe / unselected #f0f0ee
                  ['--tint' as any]: a.active ? '#01d6fe' : '#f0f0ee' }} />
    <span className="absolute -top-1 -left-1 w-4 h-4 rotate-45 bg-black/70
                     grid place-items-center text-[9px]"><b className="-rotate-45">{i+1}</b></span>
    <span className="absolute bottom-0 right-1 text-[10px] tabular-nums text-white/70">{a.cost}</span>
    {a.remaining > 0 && (
      <svg className="absolute inset-0 pointer-events-none" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r="25" fill="none" stroke="#01d6fe" strokeWidth="2"
          strokeDasharray={157} strokeDashoffset={157*(1 - a.remaining/a.duration)}
          transform="rotate(-90 28 28)" />
      </svg>
    )}
  </div>
))}
```

**Minimap** — respect the verified **100 × 60 m** extent and the **white triangle** player marker:

```ts
const MAP_W = 100, MAP_H = 60;                       // metres [V]
const toMap = (wx: number, wz: number, px: number, pz: number, w: number, h: number) =>
  [ w/2 + ((wx - px) / MAP_W) * w, h/2 + ((wz - pz) / MAP_H) * h ] as const;
// terrain: white 1px polylines; hostile regions filled rgba(200,4,6,.18)
// player: filled white triangle at centre, rotated to yaw. In rotating mode, rotate the
// whole canvas by -yaw around the centre instead of rotating every element.
```

**Reload ring [V]** — clockwise, forming from the top:

```css
@property --reload { syntax:'<number>'; inherits:false; initial-value:0 }
.reticle-reload {
  width:34px; aspect-ratio:1; border-radius:50%;
  background: conic-gradient(#fff calc(var(--reload)*360deg), transparent 0);
  mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px));
  animation: reload var(--reload-ms) linear both;
}
@keyframes reload { to { --reload: 1 } }
```

**Hit / crit feedback [V]** — three crit tiers with real colours: yellow `#ffff00`, orange `#fe6c09`, red `#fe0000`; hit indicator `#e9bb06`; headshot `#c80406`. Damage numbers should scale with tier: `1.0 / 1.25 / 1.6` and drift upward with a slight random x-jitter over 700 ms.

### 10.4 Feel / overboard

**Feel:** corners only, everything sheared, numbers glowing, and it is *fully recolourable* — DE treats HUD colour as player property, with colour-blind presets shipped as first-class options **[V]**. Copy that: our overlay must ship the same ten presets, using the exact hexes in §1.5, on day one. It is accessibility *and* it is accurate.

**Overboard:**
- **Health orbs instead of bars** — a real liquid-sim orb per vital (see §1.4), sloshing on damage, cracking below 25%, with a rim that flares on shield break. The shape is already the game's iconography via pickups; promoting it to the HUD is the exact "recognisably Warframe but more" move the brief asks for.
- **The minimap as a holographic volume**, drawn with 3D-projected line work and a slight rotation offset, sitting in a chamfered frame with corner brackets.
- **Ability icons that charge visibly**: energy fills each icon bottom-up as you approach its cost, so you can see affordability without reading numbers.
- **A damage-history ribbon** under the vitals: last 10 seconds of incoming DPS as a sparkline, red spikes for hits. The game has no such thing; an overlay can.
- **Squad orbs in a ring** around your own — position in the ring = position in the squad.

---

## 11. Priority order for implementation

Ranked by (identity delivered) ÷ (effort):

1. **§1 primitives** — chamfer, bracket, diamond, orb, ring, token layer, motion vocabulary. Everything else is assembly. Half a day.
2. **The Star Chart canvas** (§3.4). The centrepiece, and the only genuinely hard rendering problem.
3. **The mod card** (§5.2). Highest fidelity-per-line-of-CSS in the whole document; the conic-gradient metal + tilt does 80% of the work.
4. **HUD colour system + the ten presets** (§1.5, §10). Verified data, trivially implemented, and it is what makes the overlay look *native* next to the game.
5. **Mastery ring / progression** (§7.3) — exact XP formulas are verified, so this can be numerically perfect immediately.
6. Foundry timers + notifications (§6.3) — small, and the highest practical value to a real player.
7. Codex/collection lists (§8.3) — `content-visibility`, then stop.

## 12. Open questions for a screenshot pass

Things I could not verify in text and that a 20-minute screenshot session would settle:

- Exact panel background, border and accent hexes for the default (Vitruvian) theme.
- The chamfer size ratio at three element scales (button, panel, card).
- Whether Star Chart node positions per planet are authored or generated (affects whether we can persist a layout).
- Mod card exact aspect ratio and the frame width in px at native 1080p.
- The real polarity glyph outlines (my SVG paths in §4.3 are reconstructions).
- Actual transition durations — I estimated 180–420 ms; the community complaint that transitions are "slow" suggests some are ≥ 700 ms.
- ~~Font~~ **ANSWERED, see §1.8:** Ailerons (headers, EN/FR/DE), Noto Sans (body + CJK headers), "Old Roboto" ~2013 for general UI. Remaining sub-question: exact letterspacing and the display-size ramp.

---

## Sources

- [Star Chart — wiki raw](https://wiki.warframe.com/index.php?title=Star_Chart&action=raw)
- [Star Chart 2.0 — wiki raw](https://wiki.warframe.com/index.php?title=Star_Chart_2.0&action=raw)
- [The Steel Path — wiki raw](https://wiki.warframe.com/index.php?title=The_Steel_Path&action=raw)
- [Junction — wiki raw](https://wiki.warframe.com/index.php?title=Junction&action=raw)
- [Orbiter — wiki raw](https://wiki.warframe.com/index.php?title=Orbiter&action=raw)
- [Arsenal — wiki raw](https://wiki.warframe.com/index.php?title=Arsenal&action=raw)
- [Mod — wiki raw](https://wiki.warframe.com/index.php?title=Mod&action=raw)
- [Polarity — wiki raw](https://wiki.warframe.com/index.php?title=Polarity&action=raw)
- [Foundry — wiki raw](https://wiki.warframe.com/index.php?title=Foundry&action=raw)
- [Mastery Rank — wiki raw](https://wiki.warframe.com/index.php?title=Mastery_Rank&action=raw)
- [Player Profile — wiki raw](https://wiki.warframe.com/index.php?title=Player_Profile&action=raw)
- [Codex — wiki raw](https://wiki.warframe.com/index.php?title=Codex&action=raw)
- [Market — wiki raw](https://wiki.warframe.com/index.php?title=Market&action=raw)
- [Syndicate — wiki raw](https://wiki.warframe.com/index.php?title=Syndicate&action=raw)
- [Nightwave — wiki raw](https://wiki.warframe.com/index.php?title=Nightwave&action=raw)
- [Heads-Up Display — wiki raw](https://wiki.warframe.com/index.php?title=Heads-Up_Display&action=raw) — source of the verified HUD hex table
- [Fonts — wiki raw](https://wiki.warframe.com/index.php?title=Fonts&action=raw) — source of the verified typography table
- [Settings/Interface/Backgrounds and Themes — wiki raw](https://wiki.warframe.com/index.php?title=Settings/Interface/Backgrounds_and_Themes&action=raw)
- [Warframe: The Star Chart (official)](https://www.warframe.com/en/news/star-chart)
- [Game UI Database — Warframe](https://www.gameuidatabase.com/gameData.php?id=192) — **403 to automated fetch; open manually, best screenshot corpus**
- [Forums: "I don't like the new Star Chart"](https://forums.warframe.com/topic/668638-i-dont-like-the-new-star-chart/) — **403 to automated fetch; complaints surfaced via search summary**
- [Forums: Navigation — Solar Map Interface](https://forums.warframe.com/topic/383712-navigation-solar-map-interface/)
- [ArtStation: Kellen McQueen, Warframe UI Layout Mockup](https://www.artstation.com/artwork/8vPgG)
- [ArtStation: Studio Qube, Warframe Various HUD & UI](https://studioqube.artstation.com/projects/o2m9Vk)
