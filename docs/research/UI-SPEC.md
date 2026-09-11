# RaijiFrame UI Specification

**Status: this is the build target.** Not a survey. Every number here is either measured
(the five research briefs under `docs/research/ui-*.md`) or a decision I am making now.
Where the briefs were wrong, this document overrules them and says so.

Written 2026-08-31. Migration source: `src/styles/theme.css` (457 lines) and
`src/ui/orokin.tsx` (1,155 lines — already ships Panel/Card/Meter/Ring/Tabs/Counter/DataTable).
**This is a migration, not a rewrite.** Token *names* are preserved because they are used
244+ times across `src/`; token *values* are re-anchored to the measured ones.

---

## 0. Ground rules

### 0.1 The three sentences that decide everything

1. **Rectangles carry information. Cuts carry action.** Warframe's Update 41 panels are plain
   1px-hairline rectangles — measured. The chamfer appears on buttons, ribbons, mod cards: things
   that are pressable or earned. Chamfer every div and you get a 2014 sci-fi UI kit, which is
   exactly what DE's art direction moved away from.
2. **The chamfer is a fixed 28px run at 1600w (~34px at 1920w), not a fixed angle.** Two buttons
   measured: same 28px horizontal run, different heights (58px, 45px), therefore different flank
   angles (46.0°, 38.8°). Use `px`, never `%`.
3. **Keep the centre empty.** Warframe reserves the middle 55–60% for the diegetic object. For an
   overlay that is free money: the game is already there.
4. **Panels are near-opaque, and `backdrop-filter` cannot blur the game.** Overwolf composites the
   game frame *below* a transparent window, so CSS never sees those pixels — a blur only ever
   applies to other in-app layers. This is recorded in the current `theme.css` from a live
   regression (panels at 0.78 alpha left the game and the Overwolf client legible through the
   text). **It overrules the research briefs**, which assume the game's own diorama-behind-glass
   model. Every surface below carries its own opacity; translucency survives only where something
   in-app is genuinely stacked behind.

### 0.2 UNCERTAIN claims and their fallbacks

Adversarial review flagged these. Each is marked **UNCERTAIN** where it is used below. None is
load-bearing once the fallback is applied.

| # | UNCERTAIN claim | Verdict | Safe fallback (what this spec ships) |
|---|---|---|---|
| U1 | `mask-composite` ring gives a chamfered border (`ui-geometry` §2.4 B) | **Broken.** The ring follows the padding-box *rectangle*; `clip-path` then slices it, so the diagonals get no stroke and stub corners appear. | **Nested-element technique (A).** `.wf-frame` = stroke colour + `clip-path` + `padding: 1px`; child = fill + same `clip-path`. Already what `src/ui/orokin.tsx` `Panel` does — keep it. §2.1. |
| U2 | The conic sweep "chases the panel outline including the 45° cuts" | **Impossible** on U1's ring — there is no stroke on the cuts to chase. | Sweep runs on an **SVG `<polygon>` stroke** with `stroke-dasharray`, which genuinely follows the chamfer. §3 E4. |
| U3 | Lotus reconstruction: aspect 1.138:1, chevrons at y 8/79/127 | **Wrong twice** — renders at 1.99 aspect, and `<use x/y>` is post-multiplied by the element transform so chevrons 2 and 3 collapse 3.2px apart. | **Do not hand-reconstruct the Lotus.** Ship the wiki's `Lotus(xWhite).svg` path data unmodified, or use a plain chevron/diamond mark. §2.11. |
| U4 | The double border is a symmetric `inset: 6px` | Brief's own scan is 6px top / 5px bottom, with 11 rows elided from the printed table. | **Ship symmetric `--edge-inset: 6px`.** The 1px asymmetry is invisible; a symmetric constant is what CSS can express. Do not call it measured-exact. |
| U5 | "The panel is a lifted plate on a darker field" | **False on the left rail** — panel interior samples *darker* than the ground beside it almost everywhere. True only for one right-side sample. | **Panels are darker and translucent, not lifted.** Depth comes from the hairline and the scrim. §1 surfaces. |
| U6 | `grid-template-columns: 17% 1fr 23%` with `padding-inline: 5vw` | **CSS bug.** Percentage tracks resolve against the *content* box → 294px, not the measured 327px. | **Use `vw`: `17vw 1fr 23vw`.** One-line fix, reproduces the measurement exactly. §1 `.wf-shell`. |
| U7 | Panel titles are `uppercase` at `letter-spacing: 0.2em` | **Contradicted** — measured inter-letter gaps are 1–3px (≈0 tracking) and the primary header reads "Default Loadout" in Title Case. | **Two roles:** `.wf-title` (Title Case, `0.02em`) for headers; `.wf-eyebrow` (UPPERCASE, `0.18em`) for kickers only. |
| U8 | Chevron flank "asymptotically approaches 34.2°" | Incoherent — the fitted power law has no asymptote. | Nothing consumes it. Dropped. |
| U9 | The 28 theme hexes tagged `[V]` | Sampled from theme **icons**, not the UI; the Riven capture is palette-mode PNG so its hexes are palette entries. Theme *names* are confirmed. | Ship them as `--accent` **starting points, user-overridable in Settings**. Only High Contrast must be exact, and it trivially is. |
| U10 | Terminator pip `M160 16 l3 3 -3 3 -3 -3 z` in a 160-wide viewBox | Clipped at x=163; and the real in-game terminator is a chevron stack, not a diamond. | Ship the chevron stack. §2.9 `Divider`. |
| U11 | 19 themes / 14 backgrounds, "all 19 measured" | **20 themes, 15 backgrounds**; Drippy omitted entirely; only 18 measured. | Ship the **18 measured + High Contrast**. Drippy and Pom-2 are listed as unmeasured and not selectable. |
| U12 | `#C8A858` independently corroborates `#CBAD5E` | Circular — it is `#CBAD5E` floor-quantised to 8 steps (same pixels). | `#CBAD5E` stands alone (56.2% modal of DE's lossless icon). The corroboration argument is dropped. |
| U13 | `--wf-glow: #E5D493` | **Not reproducible** — the same method yields `#FFF8C7` / `#EEC994` / `#F4D7A3`. Right hue family, wrong precision. | Derive: `color-mix(in oklab, var(--accent) 55%, white)`. Never hardcode `#E5D493`. |
| U14 | `googlefonts/roboto-classic` is Apache-2.0 "Old Roboto" | **Wrong repo and wrong licence** — redirects to the modern OFL variable Roboto. Following it ships new Roboto. | We ship no Roboto. Body face is **Bahnschrift** (ships with Windows 10 1709+; Overwolf is Windows-only, so it costs zero bytes). |
| U15 | Chakra Petch 6 weights / Saira Semi Condensed has width + italics / Syncopate single weight | Wrong: 5 / neither / two. | Ship **Chakra Petch 400 + 700 only**, self-hosted woff2. No axis assumptions anywhere. |
| U16 | **Ailerons is free for commercial use** | **FALSE, and the highest-risk error in the corpus.** The designer's page says *"Free for personal use only."* Confused with "Aileron" (singular, different font). | **Ailerons is banned from this repo.** Display face is **Chakra Petch** (SIL OFL 1.1). A CI check greps for `Ailerons` and fails the build. |
| U17 | "Ailerons is uppercase-only, which is why every title is caps" | Contested — the designer shows lowercase forms; and it cannot explain caps in ZH/KO/JA, which use Noto Sans. | Moot given U16. Caps is a **per-role choice we make** (U7), not a font constraint. |
| U18 | Column B is "that theme's measured UI accent" | Sampled from `<Theme>BackgroundFullscreen` art, while theme and background are independent purchasable axes. | Column A (icon modal) drives `--accent`. Column B is only the optional `--accent-text`. |
| U19 | The HUD table is "DE's own default values" | The wiki column header literally reads **"Approx. Hex Code"**. | Use them, call them approximations, expose them as user-tunable in Settings. |
| U20 | `gameuidatabase.com` returns 403 | Returns 200 — it is a JS gallery, so a text fetcher gets nothing. Different failure. | No claim here depends on it. |
| U21 | Aceternity aurora keyframes / 21st.dev "246 registries, 111+ borders" / Bklit "brush" | Not present in the cited artifacts. | We install zero component libraries (§0.3). No impact. |
| U22 | GSAP InertiaPlugin is paid | **Stale ~16 months** — GSAP incl. all Club plugins went free with 3.13 (Apr 2025). | Irrelevant: we do not use GSAP. `motion@13.1.1` is already installed. |
| U23 | Two libraries independently converge on `[0.16,1,0.3,1]` | False — Magic UI's BorderBeam uses `linear`. One library. | We adopt the curve because it is a good expo-out, not because of a coincidence that did not happen. |
| U24 | `three` is 600KB and "indefensible", hence raw WebGL2 | **Premise false** — `three@^0.185.1` + R3F + drei + postprocessing are **already in `package.json`**, used by `src/panels/starchart/`. | Conclusion survives on a different argument: **per-window parse cost**. §4. |
| U25 | The `--wf-t` mask-threshold "materialise" is "the best cost/impact ratio in this document" | **Inert.** The custom property feeds no declaration, the referenced SVG filter does not exist, `mask-mode` is never `luminance`. It degrades to an opacity fade. | Not shipped. The materialise beat is a **`clip-path` wipe + brightness ramp**. §3 E3. |
| U26 | `[0.7,0,0.84,0]` = "circ-in", `[0.83,0,0.17,1]` = "circ-inOut" | Mislabelled (expo-in and quint-inOut). The curves themselves are fine. | Renamed correctly in `src/motion/wf.ts`. §5. |
| U27 | "50 DOM nodes with transforms is 50 layers" | False — static transforms do not force compositing in Chromium. | The budget caps *animated* / `will-change` layers at 25. Static transforms are unlimited. |
| U28 | `#13111C` = `hsl(253,13%,9%)` | Saturation is ~2× that. The hex is correct. | Use hex/oklch; never that hsl(). |
| U29 | `background-size: 100% 4px` on a 3px scanline gradient "expresses the pitch in device pixels" | Wrong twice — it introduces a seam every 4px, and `background-size` resolves in CSS px. | Scanlines are authored at a 3px period in CSS px and left alone. |
| U30 | `vector-effect` on the `<svg>` root inherits to children | It does not (not an inherited property). | Put `vector-effect="non-scaling-stroke"` on the `<path>`/`<polygon>`. |
| U31 | `preserveAspectRatio="none"` chamfer "acceptable up to ~4:1" | Distorts at *any* non-1:1 ratio; a 6-unit chamfer on 300×100 is an 18° wedge. Usable to ~1.2:1. | **Never scale a chamfer through SVG.** Chamfers are `clip-path` with absolute px, always. |
| U32 | `scificn` §1.1 "geometrically parallel chamfer", equal width | Parallel yes, equal no: the diagonal stroke renders `s·√2` ≈ 41% thicker. | Exact fix in §2.1 (`--notch-inner`), applied only at stroke ≥ 2px where it is visible. |
| U33 | Assorted dangling identifiers in the briefs (`--wf-text-1`, `--cut-4`, `--font-wf`, `--reload-ms`, `@keyframes wf-pulse`, `byId`, `pending`, `ghost`, `shade()`) | Copy-paste failures; the code silently no-ops. | Every identifier in this document is defined in this document. Nothing is imported from the briefs by reference. |

### 0.3 Dependencies

**Install nothing.** Present and sufficient: `motion@13.1.1`, `react@19`, `zustand@5`,
`tailwindcss@4`, plus `three`/R3F (star chart only). Every library in `ui-components.md` is a
copy-in registry — take the technique, write it against our tokens.

Two additions are **deferred until a screen actually hurts**: `@tanstack/react-virtual` (when a
list exceeds ~400 rows *and* profiles badly) and `cmdk` (when the command palette ships). Neither
blocks anything in §6.

---

## 1. The token set — complete replacement for `src/styles/theme.css`

### 1.1 What changes, and why

| Token | Today | Becomes | Why |
|---|---|---|---|
| `--color-orokin-400` | `oklch(0.83 0.105 90)` ≈ `#DDC57D` (DE *website* brand gold) | `oklch(0.758 0.105 89)` = **`#CBAD5E`** | 56.2% modal fill of DE's lossless `OrokinTheme.png`. The website gold is the marketing gold; this is the UI gold. |
| `--color-orokin-600` | `oklch(0.64 0.11 84)` | `oklch(0.554 0.060 92.5)` = `#7F7249` | Measured (51.7% modal of `VitruvianTheme.png`) — DE's own *muted* gold. It is what makes the ramp cohere. |
| `--color-tenno-400` | `oklch(0.78 0.115 228)` | `oklch(0.791 0.144 223.2)` = **`#1CCEFE`** | The wiki's `--shield-color`. Shield cyan (h≈223) and Void teal (h≈177) are different colours; conflating them is the standard fan-UI tell. |
| `--color-void-*` | hue 265 | hue **285**, chroma 0.013–0.021 | Measured black is `#080810` — blue channel *double* R and G. Hue 284–289. |
| `--color-faction-*` | eyeballed | wiki `--faction-*-text-color`, isoluminant L 64–79% | Canonical, already tuned for text on dark. |
| `--cut-sm/md/lg` | 8 / 14 / 22 | **10 / 16 / 24** | Aligns to the measured family. `--cut-xl: 34px` was already right. |
| `--clip-button` | parallelogram, 8px shear | **symmetric elongated hexagon, 34px caps** (`--clip-hex`) | The headline geometry finding, and the current value is not a Warframe shape at all. |
| `--font-title` (Cinzel) | inscriptional serif | **deleted** | Warframe's display face is a squarish technical sans. Cinzel is why titles read as Elden Ring. Delete `public/fonts/cinzel*` in the same commit. |
| `--radius-card` | `3px` | **`0px`** | Zero radius everywhere. Notches instead. |
| — | — | `[data-wf-theme]`, `--color-dt-*`, `--color-crit-*`, layout constants, `--accent` | New. |

### 1.2 The file

```css
/* src/styles/theme.css — OROKIN v2. Measured, not eyeballed. */
@import 'tailwindcss';

/* ── Display face ────────────────────────────────────────────────────────────
   Chakra Petch (SIL OFL 1.1), self-hosted, latin subset, 400 + 700 only.
   NOT Ailerons: "free for personal use only" (UNCERTAIN U16). Never add it.
   Body/UI face is Bahnschrift — ships with Windows 10 1709+, variable, zero
   bytes, zero network. Overwolf is Windows-only, so this is free.            */
@font-face {
  font-family: 'Chakra Petch'; font-style: normal; font-weight: 400;
  font-display: block; src: url('/fonts/chakra-petch-400.woff2') format('woff2');
}
@font-face {
  font-family: 'Chakra Petch'; font-style: normal; font-weight: 700;
  font-display: block; src: url('/fonts/chakra-petch-700.woff2') format('woff2');
}

@theme {
  /* ── Orokin gold. Anchored on #CBAD5E and #7F7249, both measured from DE's
        own lossless theme icons. The rest walk L in OKLCh at h≈90 — which is
        the only reason to keep OKLCh around at all.                          */
  --color-orokin-100: oklch(0.940 0.045 90);   /* #F7EBCA  hover text        */
  --color-orokin-200: oklch(0.870 0.085 93);   /* glow tier — see U13        */
  --color-orokin-300: oklch(0.810 0.100 90);   /* #DABE73  hover accent      */
  --color-orokin-400: oklch(0.758 0.105 89);   /* #CBAD5E  MEASURED base     */
  --color-orokin-500: oklch(0.680 0.098 89);   /* #B1954C  pressed           */
  --color-orokin-600: oklch(0.554 0.060 92.5); /* #7F7249  MEASURED muted    */
  --color-orokin-700: oklch(0.400 0.048 90);   /* hairline on dark           */
  --color-orokin-800: oklch(0.280 0.032 90);   /* panel edge                 */

  /* ── Tenno energy — SHIELD cyan, blue-leaning h≈223. ──────────────────── */
  --color-tenno-200: oklch(0.914 0.064 186);   /* #B2F1E9 overguard mint     */
  --color-tenno-300: oklch(0.860 0.110 220);
  --color-tenno-400: oklch(0.791 0.144 223.2); /* #1CCEFE MEASURED shield    */
  --color-tenno-500: oklch(0.706 0.109 215.5); /* #39B1CB shield damage      */
  --color-tenno-600: oklch(0.560 0.110 220);
  --color-tenno-700: oklch(0.410 0.090 222);

  /* ── Void teal — green-leaning h≈177. NOT shield cyan. ────────────────── */
  --color-voidteal: oklch(0.746 0.136 177);    /* #15C8AB Void / Operator    */

  /* ── Ink. Blue-violet h≈285. Never neutral grey: a dead-neutral ramp over a
        game frame reads as a browser window sitting on top of the picture.   */
  --color-void-50:  oklch(0.950 0.004 285);
  --color-void-100: oklch(0.880 0.006 285);
  --color-void-200: oklch(0.780 0.008 285);
  --color-void-300: oklch(0.660 0.010 285);    /* inactive label             */
  --color-void-400: oklch(0.524 0.011 285);    /* disabled text              */
  --color-void-500: oklch(0.400 0.012 285);
  --color-void-600: oklch(0.340 0.013 285);    /* hairline / rule            */
  --color-void-700: oklch(0.270 0.015 285);    /* divider block              */
  --color-void-800: oklch(0.220 0.016 285);    /* panel fill, hover          */
  --color-void-850: oklch(0.177 0.016 285);    /* #101018 MEASURED panel     */
  --color-void-900: oklch(0.139 0.018 284);    /* #080810 MEASURED app bg    */
  --color-void-950: oklch(0.130 0.021 289);    /* #07060F MEASURED void      */

  /* ── Factions. Wiki --faction-*-text-color. Deliberately ISOLUMINANT:
        L 64–79%, hue varies. That is why a star chart full of coloured nodes
        never has one screaming node. Need a new faction? oklch(0.74 0.10 <h>)
        and it will belong.                                                   */
  --color-faction-grineer:  oklch(0.752 0.099 128.3); /* #9CBB76 */
  --color-faction-corpus:   oklch(0.649 0.147 271.3); /* #6F87E8 */
  --color-faction-amalgam:  oklch(0.689 0.134 280.4); /* #8C90EC */
  --color-faction-infested: oklch(0.765 0.031 196.5); /* #9DB9B9 */
  --color-faction-deimos:   oklch(0.770 0.120 354.3); /* #F093B9 */
  --color-faction-orokin:   oklch(0.823 0.145 103.9); /* #D5C94B */
  --color-faction-sentient: oklch(0.707 0.111  57.0); /* #D58E58 */
  --color-faction-murmur:   oklch(0.784 0.029 171.0); /* #A7BFB6 */
  --color-faction-techrot:  oklch(0.761 0.044 167.9); /* #97BBAC */
  --color-faction-scaldra:  oklch(0.767 0.080 165.4); /* #81C4A7 */
  --color-faction-narmer:   oklch(0.756 0.114  83.1); /* #D3A954 */
  --color-faction-kuva:     oklch(0.661 0.165  23.1); /* #E66261 */
  --color-faction-zariman:  oklch(0.752 0.040 166.9); /* #97B7A9 */
  --color-faction-tenno:    oklch(0.701 0.168 289.9); /* #9F89FF */
  --color-faction-neutral:  oklch(0.792 0.000  90.0); /* #BBBBBB */

  /* ── Signal. Note: Warframe uses GOLD as caution, not orange. ─────────── */
  --color-signal-good:   oklch(0.795 0.265 142.6); /* #17E317 */
  --color-signal-warn:   oklch(0.809 0.118  87.5); /* #E1BC61 gold = caution */
  --color-signal-bad:    oklch(0.582 0.229  28.4); /* #E31717 */
  --color-signal-rare:   oklch(0.701 0.168 289.9); /* Tenno violet           */
  --color-signal-good-2: oklch(0.747 0.120 144.3); /* #7CC17C  +stat rows    */
  --color-signal-bad-2:  oklch(0.658 0.086  19.6); /* #C17C7C  -stat rows    */

  /* ── Crit ladder. Warframe escalates MAGNITUDE white→yellow→orange→red.
        Use it for tier/severity (Steel Path tier, riven grade, sortie
        modifier). Reserve signal-good/bad for +/- VALENCE. Getting this one
        mapping right is most of "feels like the game".                       */
  --color-crit-0: oklch(1.000 0.000  90.0);  /* #FFFFFF normal hit  */
  --color-crit-1: oklch(0.955 0.206 108.3);  /* #FEF900 yellow crit */
  --color-crit-2: oklch(0.706 0.198  45.8);  /* #FF6E07 orange crit */
  --color-crit-3: oklch(0.628 0.258  29.2);  /* #FF0000 red crit    */

  /* ── Damage types. Wiki --dt-*-text-color, verbatim. ──────────────────── */
  --color-dt-impact: #80C4C4; --color-dt-puncture: #C6B098; --color-dt-slash: #E69CA0;
  --color-dt-heat: #FB9733;   --color-dt-cold: #5BBCEC;     --color-dt-electricity: #B37FE7;
  --color-dt-toxin: #00CC22;  --color-dt-blast: #DD704E;    --color-dt-radiation: #CEAC49;
  --color-dt-gas: #00CC66;    --color-dt-magnetic: #9797E6; --color-dt-viral: #F093B9;
  --color-dt-corrosive: #93C203; --color-dt-void: #15C8AB;  --color-dt-tau: #F06666;
  --color-dt-true: #DDA700;   --color-dt-default: #E5E5E5;

  /* ── Type ─────────────────────────────────────────────────────────────── */
  --font-display: 'Chakra Petch', 'Bahnschrift', 'Segoe UI Variable Display', system-ui, sans-serif;
  --font-sans:    'Bahnschrift', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
  /* Cascadia Mono ships with Windows and is tabular by construction, so
     counters never jitter and we never have to guess at font-feature support. */
  --font-mono:    'Cascadia Mono', 'Consolas', ui-monospace, monospace;

  /* Fluid modular scale, ratio 1.25. Unchanged — it works and is used 244×. */
  --text-nano:  clamp(0.58rem, 0.56rem + 0.10vw, 0.64rem);
  --text-micro: clamp(0.66rem, 0.63rem + 0.13vw, 0.74rem);
  --text-small: clamp(0.79rem, 0.76rem + 0.15vw, 0.88rem);
  --text-body:  clamp(0.94rem, 0.90rem + 0.19vw, 1.06rem);
  --text-lead:  clamp(1.18rem, 1.10rem + 0.36vw, 1.42rem);
  --text-title: clamp(1.50rem, 1.33rem + 0.72vw, 2.05rem);
  --text-hero:  clamp(2.10rem, 1.65rem + 1.85vw, 3.40rem);
  --text-mega:  clamp(3.00rem, 2.10rem + 3.60vw, 5.50rem);

  /* ── Cut geometry. ABSOLUTE lengths, deliberately: a % chamfer changes angle
        with element size and DE's does not. 28px @1600w → 34px @1920w.       */
  --cut-xs: 6px;    /* chips, tags                       */
  --cut-sm: 10px;   /* list rows, inputs, tabs           */
  --cut-md: 16px;   /* cards, secondary panels           */
  --cut-lg: 24px;   /* primary panels                    */
  --cut-xl: 34px;   /* modals, hero panels, CTA end caps */

  /* Radius only where a radius is genuinely right: dots, avatars, pills. */
  --radius-chrome: 2px;
  --radius-card: 0px;
}
```

```css
@layer base {
  :root {
    color-scheme: dark;

    /* ── The theme axis. A theme is exactly three variables; everything else
          derives from them with color-mix. Default = Orokin gold.            */
    --accent:      var(--color-orokin-400);
    --accent-text: var(--color-orokin-300);
    --ink:         var(--color-void-900);

    /* ── Surfaces. Two rules, both learned the hard way:
       (a) UNCERTAIN U5: panels are NOT lifted plates. Measured, the panel
           interior is DARKER than the ground beside it. Depth comes from the
           hairline and the scrim, never from a lighter fill.
       (b) NEAR-OPAQUE, deliberately (§0.1 rule 4). backdrop-filter cannot blur
           the game frame under Overwolf, so a translucent panel is just a
           see-through panel with the game legible through the text. The panel
           carries its own opacity. -veil is the one genuinely translucent
           surface, for layers stacked over the app's OWN content.            */
    --surface:        color-mix(in oklab, var(--color-void-850) 96.5%, transparent);
    --surface-raised: color-mix(in oklab, var(--color-void-800) 97%, transparent);
    --surface-deep:   color-mix(in oklab, var(--color-void-950) 98%, transparent);
    --surface-well:   color-mix(in oklab, var(--color-void-950) 92%, transparent);
    --surface-veil:   color-mix(in oklab, var(--color-void-900) 86%, transparent);

    --text: var(--color-void-50);
    /* Warframe tints its greys toward the active accent at low chroma.
       Measured label text on the Vitruvian screen is #B6AB88 — gold-tinted,
       not neutral. Reproduce it as a mix, not as a fixed grey.               */
    --text-muted: color-mix(in oklab, var(--accent) 18%, oklch(0.78 0 0));
    --text-faint: color-mix(in oklab, var(--accent) 12%, oklch(0.58 0 0));
    --text-ghost: color-mix(in oklab, var(--accent) 8%,  oklch(0.44 0 0));

    /* ── THE EDGE. Highest-yield single detail in the system:
          1px bright / 6px gap / 1px dim, inner stroke at 56% of the outer.
          (UNCERTAIN U4: real data is 6px top / 5px bottom. Ship symmetric.)  */
    --stroke: 1px;
    --edge-inset: 6px;
    --edge-inner-alpha: 0.56;
    --edge:      color-mix(in oklab, var(--accent) 55%, transparent);
    --edge-soft: color-mix(in oklab, var(--accent) 26%, transparent);
    --hairline:  color-mix(in oklab, var(--accent) 30%, transparent);
    --hairline-strong: color-mix(in oklab, var(--accent) 55%, transparent);
    /* Measured: gold titles are a VERTICAL GRADIENT, pale cream → old gold.
       Flat gold looks dead next to a real screenshot.                        */
    --edge-grad: linear-gradient(180deg,
      color-mix(in oklab, var(--accent) 45%, white) 0%,
      var(--accent) 45%,
      color-mix(in oklab, var(--accent) 45%, transparent) 100%);

    /* ── Glow. The measured bloom radius is TIGHT — a few px, not the 20px
          halo most web "neon" uses. Bright+tight inner, faint+wide outer.    */
    --glow-accent: 0 0 4px color-mix(in oklab, var(--accent) 28%, transparent),
                   0 0 14px color-mix(in oklab, var(--accent) 10%, transparent);
    --glow-text:   0 0 6px color-mix(in oklab, var(--accent) 60%, transparent),
                   0 0 14px color-mix(in oklab, var(--accent) 33%, transparent);
    --shadow-card: 0 1px 2px oklch(0.08 0.02 285 / 0.55),
                   0 4px 14px oklch(0.08 0.02 285 / 0.45),
                   0 18px 36px oklch(0.08 0.02 285 / 0.35);

    /* ── Layout, measured off the 1920×1080 Arsenal. ──────────────────────
          UNCERTAIN U6: vw, not %, or padding-inline eats the rail width.     */
    --gutter: 5vw;      /* measured 97px left, 98–100px right @1920          */
    --rail-l: 17vw;     /* measured 327px = 17.0% of 1920                    */
    --rail-r: 23vw;     /* inferred — right edge sits under a soft scrim     */
    --panel-gap: 23px;  /* measured list → sub-action column                 */
    --row-h: 26px;      /* measured stat-row pitch. DENSE. 40px looks like a
                           settings page, not like the game.                 */
    --zebra: oklch(1 0 0 / 0.045);  /* measured luminance 29 vs 18           */

    /* ── Silhouettes. Absolute px. Never percentage. ────────────────────── */
    /* Primary panel: opposite corners (TL + BR). Never all four — four cuts
       reads as an octagon and stops reading as Warframe.                    */
    --clip-panel: polygon(
      var(--cut-lg) 0, 100% 0,
      100% calc(100% - var(--cut-lg)), calc(100% - var(--cut-lg)) 100%,
      0 100%, 0 var(--cut-lg));
    --clip-panel-mirror: polygon(
      0 0, calc(100% - var(--cut-lg)) 0,
      100% var(--cut-lg), 100% 100%,
      var(--cut-lg) 100%, 0 calc(100% - var(--cut-lg)));
    /* Card: ONE cut, top-right. Two cuts on a small card reads as a hexagon
       and stops reading as a card.                                          */
    --clip-card:     polygon(0 0, calc(100% - var(--cut-md)) 0, 100% var(--cut-md), 100% 100%, 0 100%);
    --clip-card-alt: polygon(var(--cut-md) 0, 100% 0, 100% 100%, 0 100%, 0 var(--cut-md));
    /* THE BUTTON. Measured symmetric elongated hexagon: fixed 28px@1600w run
       (34px@1920w) at each end, tips on the vertical centreline. The old
       --clip-button was a sheared parallelogram — never this shape.         */
    --clip-hex: polygon(
      var(--cut-xl) 0, calc(100% - var(--cut-xl)) 0, 100% 50%,
      calc(100% - var(--cut-xl)) 100%, var(--cut-xl) 100%, 0 50%);
    --clip-hex-sm: polygon(
      var(--cut-md) 0, calc(100% - var(--cut-md)) 0, 100% 50%,
      calc(100% - var(--cut-md)) 100%, var(--cut-md) 100%, 0 50%);
    --clip-tab:   polygon(0 0, 100% 0, calc(100% - var(--cut-sm)) 100%, 0 100%);
    --clip-row:   polygon(0 0, 100% 0, 100% 100%, var(--cut-sm) 100%, 0 calc(100% - var(--cut-sm)));
    --clip-meter: polygon(0 0, 100% 0, calc(100% - 7px) 100%, 0 100%);
    --clip-notch: polygon(
      0 0, calc(50% - 26px) 0, calc(50% - 18px) 9px,
      calc(50% + 18px) 9px, calc(50% + 26px) 0, 100% 0, 100% 100%, 0 100%);
  }

  /* ── The 18 measured themes + High Contrast. Column A (modal fill of DE's
        own lossless Market icon) drives --accent.
        UNCERTAIN U9: sampled from theme ICONS, not the UI — these are
        starting points, overridable from Settings. Drippy and Pom-2 exist
        but are unmeasured (U11) and are deliberately not selectable.        */
  [data-wf-theme='vitruvian'] { --accent: oklch(0.554 0.060  92.5); --accent-text: oklch(0.755 0.065  92.5); --ink: oklch(0.139 0.018 284); }
  [data-wf-theme='orokin']    { --accent: oklch(0.758 0.105  89.0); --accent-text: oklch(0.850 0.090  90.0); --ink: oklch(0.139 0.018 284); }
  [data-wf-theme='legacy']    { --accent: oklch(0.610 0.083 242.9); --accent-text: oklch(0.960 0.010 240.0); --ink: oklch(0.150 0.008 200); }
  [data-wf-theme='stalker']   { --accent: oklch(0.477 0.179  22.5); --accent-text: oklch(0.560 0.170  24.0); --ink: oklch(0.110 0.020  20); }
  [data-wf-theme='grineer']   { --accent: oklch(0.696 0.088  52.9); --accent-text: oklch(0.845 0.104  74.0); --ink: oklch(0.130 0.015 120); }
  [data-wf-theme='corpus']    { --accent: oklch(0.691 0.071 203.9); --accent-text: oklch(0.758 0.126 224.4); --ink: oklch(0.120 0.020 240); }
  [data-wf-theme='baruuk']    { --accent: oklch(0.903 0.097  83.4); --accent-text: oklch(0.880 0.080  83.0); --ink: oklch(0.135 0.015 280); }
  [data-wf-theme='equinox']   { --accent: oklch(0.946 0.000  90.0); --accent-text: oklch(0.780 0.005 285.0); --ink: oklch(0.120 0.006 285); }
  [data-wf-theme='zephyr']    { --accent: oklch(0.736 0.180  55.7); --accent-text: oklch(0.760 0.150  58.0); --ink: oklch(0.130 0.018 285); }
  [data-wf-theme='fortuna']   { --accent: oklch(0.599 0.214 298.2); --accent-text: oklch(0.620 0.110 265.0); --ink: oklch(0.125 0.025 290); }
  [data-wf-theme='darklotus'] { --accent: oklch(0.639 0.136 273.4); --accent-text: oklch(0.660 0.080 310.0); --ink: oklch(0.130 0.020 285); }
  [data-wf-theme='deadlock']  { --accent: oklch(0.839 0.129  91.5); --accent-text: oklch(0.960 0.010 220.0); --ink: oklch(0.125 0.015 285); }
  [data-wf-theme='lotus']     { --accent: oklch(0.735 0.088 321.2); --accent-text: oklch(0.820 0.070 321.0); --ink: oklch(0.130 0.020 300); }
  [data-wf-theme='nidus']     { --accent: oklch(0.676 0.221 323.4); --accent-text: oklch(0.760 0.180 323.0); --ink: oklch(0.125 0.025 320); }
  [data-wf-theme='tenno']     { --accent: oklch(0.691 0.108 166.6); --accent-text: oklch(0.790 0.100 167.0); --ink: oklch(0.125 0.018 200); }
  [data-wf-theme='conquera']  { --accent: oklch(0.719 0.169 335.4); --accent-text: oklch(0.800 0.130 335.0); --ink: oklch(0.130 0.022 320); }
  [data-wf-theme='lunar']     { --accent: oklch(0.421 0.145  35.7); --accent-text: oklch(0.960 0.020  20.0); --ink: oklch(0.115 0.020  25); }
  [data-wf-theme='infested']  { --accent: oklch(0.765 0.031 196.5); --accent-text: oklch(0.840 0.030 196.0); --ink: oklch(0.130 0.012 200); }

  /* Accessibility. DE shipped #FFFF00 on #000000; an overlay sitting on top of
     live gameplay owes this MORE than the game does. Not optional.           */
  [data-wf-theme='contrast'] {
    --accent: oklch(0.968 0.211 109.8); --accent-text: oklch(0.968 0.211 109.8);
    --ink: oklch(0 0 0);
    --surface: oklch(0 0 0 / 0.94); --surface-raised: oklch(0 0 0 / 0.96);
    --surface-deep: oklch(0 0 0 / 0.98); --surface-well: oklch(0 0 0 / 0.9);
    --text: #FFFFFF; --text-muted: #FFFFFF; --text-faint: #E0E0E0; --text-ghost: #BEBEBE;
    --hairline: oklch(0.968 0.211 109.8 / 0.85);
    --glow-accent: none; --glow-text: none; --shadow-card: none;
  }

  /* The fourth axis the game itself cannot offer: bind --accent to the
     player's equipped Warframe energy colour, read at runtime. See §3 E1.    */
  [data-wf-theme='live'] { --accent: var(--live-energy, var(--color-orokin-400)); }

  html, body, #root { height: 100%; }

  body {
    margin: 0;
    background: transparent;        /* Overwolf composites over the game frame */
    color: var(--text);
    font-family: var(--font-sans);
    font-size: var(--text-body);
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
    user-select: none;              /* an overlay is not a document */
    cursor: default;
  }

  ::selection { background: color-mix(in oklab, var(--accent) 30%, transparent); color: var(--text); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

  h1, h2, h3 { font-family: var(--font-display); font-weight: 600; margin: 0; text-wrap: balance; }
  p { margin: 0; text-wrap: pretty; }

  ::-webkit-scrollbar { width: 9px; height: 9px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: color-mix(in oklab, var(--accent) 18%, transparent);
    border: 3px solid transparent; background-clip: content-box;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: color-mix(in oklab, var(--accent) 40%, transparent); background-clip: content-box;
  }
}
```

```css
@layer components {
  /* ── Type roles. UNCERTAIN U7: the game's primary panel header is Title Case
        at ~zero tracking. Caps + wide tracking belongs to the KICKER only.
        Two roles, not interchangeable.                                       */
  .wf-title {
    font-family: var(--font-display); font-weight: 600;
    font-size: var(--text-lead); letter-spacing: 0.02em; color: var(--text);
  }
  /* The gold header treatment — a vertical gradient, plus a hard drop shadow
     which is what lifts it off a busy 3D background.                         */
  .wf-title--gold {
    background: var(--edge-grad);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    filter: drop-shadow(0 1px 0 rgb(0 0 0 / 0.85));
  }
  .wf-eyebrow {
    font-family: var(--font-display); font-size: var(--text-micro); font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.18em; color: var(--text-faint);
  }
  .wf-eyebrow--accent { color: var(--accent-text); }
  .wf-num  { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .wf-stat { font-family: var(--font-display); font-variant-numeric: tabular-nums;
             font-weight: 300; letter-spacing: -0.02em; line-height: 0.9; }

  /* ── The shell. UNCERTAIN U6 fixed: vw tracks, not %. ─────────────────── */
  .wf-shell {
    height: 100%;
    display: grid;
    grid-template-columns: var(--rail-l) 1fr var(--rail-r);
    column-gap: var(--panel-gap);
    padding-inline: var(--gutter);
    padding-block: 3.7vh 4vh;    /* measured: top bar at y≈40 = 3.7% of 1080 */
  }
  /* Keep the centre empty. The game is there. */
  .wf-shell > .wf-stage { pointer-events: none; }
}

/* Motion is meaning, never garnish — and always opt-out. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 1.3 Codemod for the migration

Three mechanical passes, in this order:

1. `--font-title` and `Cinzel` → delete. `rg -l "font-title|Cinzel" src public` then remove; drop
   `public/fonts/cinzel*`.
2. `--clip-button` → `--clip-hex`. It is referenced 4×; the shape genuinely changes, so eyeball each.
3. Chrome that should follow the active theme: `var(--color-orokin-400)` → `var(--accent)` **only**
   in borders, rules, selection markers and glows. Leave it as `--color-orokin-400` where the thing
   is semantically *gold* (Orokin faction, Prime parts, platinum-adjacent). Roughly 46 sites; about
   half should move.

Everything else compiles unchanged. That is the whole point of keeping the names.
---

## 2. The primitive components

All twelve live in `src/ui/` and consume only the tokens in §1. `src/ui/orokin.tsx` already has
five of them in a compatible shape (Panel, Card, Meter, Ring, Tabs); those are **edits**, the
other seven are **new files**. Everything below is copy-in-ready.

### 2.0 The one shared decision: how a chamfered edge gets a stroke

`clip-path` destroys `border`. **UNCERTAIN U1: the `mask-composite` ring the geometry brief tells
you to use does not work.** It produces a ring around the padding-box *rectangle*, which the
`clip-path` then slices — the chamfer flanks come out with no border and visible stub corners.

**Use nesting.** One clipped box of stroke colour, `padding: var(--stroke)`, containing one clipped
box of fill:

```css
/* src/styles/primitives.css */
.wf-frame {
  --notch: var(--cut-lg);
  /* UNCERTAIN U32: the same polygon on a box inset by s puts the diagonal
     s·√2 away, i.e. ~41% thicker than the straight edges. Shrinking the inner
     notch by (2−√2)·s ≈ 0.5858·s makes the perpendicular width exactly s.
     At --stroke: 1px the difference is 0.4px — invisible; it only matters from
     2px up. Costs one calc, so we always do it.                              */
  --notch-in: calc(var(--notch) - 0.5858 * var(--stroke));
  --clip-o: polygon(var(--notch) 0, 100% 0,
                    100% calc(100% - var(--notch)), calc(100% - var(--notch)) 100%,
                    0 100%, 0 var(--notch));
  --clip-i: polygon(var(--notch-in) 0, 100% 0,
                    100% calc(100% - var(--notch-in)), calc(100% - var(--notch-in)) 100%,
                    0 100%, 0 var(--notch-in));

  position: relative;
  isolation: isolate;
  clip-path: var(--clip-o);
  background: var(--frame-edge, var(--edge));
  padding: var(--stroke);
}
.wf-frame > .wf-fill {
  clip-path: var(--clip-i);
  background: var(--frame-fill, var(--surface));
  width: 100%;
  min-height: 0;
  flex: 1;
}

/* The measured Warframe edge is a DOUBLE hairline: 1px bright / 6px gap / 1px
   dim at 56% of the bright stroke. On a chamfered box the only way to get a
   ring that follows the diagonals is a single self-intersecting polygon under
   evenodd — outer loop, then inner loop, hole punched, no fill involved, so
   translucency never stacks. One element, no nesting, no mask.               */
.wf-frame > .wf-fill > .wf-hairline {
  --n1: calc(var(--notch-in) - 0.5858 * var(--edge-inset));
  --n2: calc(var(--n1) - 0.5858 * var(--stroke));
  --s: var(--stroke);
  position: absolute;
  inset: var(--edge-inset);
  pointer-events: none;
  background: var(--edge);
  opacity: var(--edge-inner-alpha);        /* measured 93/167 = 0.56 */
  clip-path: polygon(evenodd,
    var(--n1) 0, 100% 0,
    100% calc(100% - var(--n1)), calc(100% - var(--n1)) 100%,
    0 100%, 0 var(--n1),
    calc(var(--s) + var(--n2)) var(--s),
    calc(100% - var(--s)) var(--s),
    calc(100% - var(--s)) calc(100% - var(--s) - var(--n2)),
    calc(100% - var(--s) - var(--n2)) calc(100% - var(--s)),
    var(--s) calc(100% - var(--s)),
    var(--s) calc(var(--s) + var(--n2)));
}
/* FALLBACK if evenodd renders wrong in the shipped Overwolf Chromium: add
   .wf-frame--single to drop the inner line entirely. The panel still reads
   correctly with one stroke; the double hairline is polish, not structure.   */
.wf-frame--single > .wf-fill > .wf-hairline { display: none; }
```

On a **rectangular** panel — which per rule #1 is most of them — skip all of that:

```css
.wf-rect { border: var(--stroke) solid var(--edge); position: relative; background: var(--surface); }
.wf-rect::after {
  content: ''; position: absolute; inset: var(--edge-inset); pointer-events: none;
  border: var(--stroke) solid var(--edge); opacity: var(--edge-inner-alpha);
}
```

Two lines, exact, zero risk. **Reach for `.wf-frame` only when the shape is genuinely cut.**

---

### 2.1 Panel

Primary content container. Rectangular by default (rule #1); `cut` opts into the chamfer.
Migration: `src/ui/orokin.tsx` `Panel` already nests two clipped boxes — keep the structure, swap
the accent objects for tokens, add `cut` and the inner hairline.

```tsx
// src/ui/Panel.tsx
import type { CSSProperties, ReactNode } from 'react';

export interface PanelProps {
  children?: ReactNode;
  eyebrow?: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  /** Chamfer TL+BR. Off by default: rectangles carry information, cuts carry action. */
  cut?: boolean;
  /** Mirror the cuts so they point away from screen centre on a right-hand rail. */
  mirror?: boolean;
  /** Translucent + blurred. ONLY for a panel stacked over the app's OWN
   *  content — it cannot blur the game frame (§0.1 rule 4). At most one. */
  veil?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Panel({
  children, eyebrow, title, actions,
  cut = false, mirror = false, veil = false, className = '', style,
}: PanelProps) {
  const head = eyebrow != null || title != null || actions != null;

  if (!cut) {
    return (
      <section className={`wf-rect wf-panel ${veil ? 'wf-veil' : ''} ${className}`} style={style}>
        {head && <PanelHead eyebrow={eyebrow} title={title} actions={actions} />}
        {children}
      </section>
    );
  }
  return (
    <section
      className={`wf-frame wf-panel ${className}`}
      style={{ ...style, ...(mirror ? { transform: 'scaleX(-1)' } : null) }}
    >
      <div className={`wf-fill wf-panel__body ${veil ? 'wf-veil' : ''}`}
           style={mirror ? { transform: 'scaleX(-1)' } : undefined}>
        <div className="wf-hairline" aria-hidden />
        {head && <PanelHead eyebrow={eyebrow} title={title} actions={actions} />}
        {children}
      </div>
    </section>
  );
}

function PanelHead({ eyebrow, title, actions }: Pick<PanelProps, 'eyebrow' | 'title' | 'actions'>) {
  return (
    <header className="wf-panel__head">
      <div className="min-w-0">
        {eyebrow != null && <div className="wf-eyebrow wf-eyebrow--accent">{eyebrow}</div>}
        {/* Title Case, ~0 tracking — UNCERTAIN U7. Caps lives on the eyebrow. */}
        {title != null && <h2 className="wf-title wf-title--gold truncate">{title}</h2>}
      </div>
      {actions != null && <div className="wf-panel__actions">{actions}</div>}
    </header>
  );
}
```

```css
.wf-panel { display: flex; flex-direction: column; box-shadow: var(--shadow-card); }
.wf-panel__body, .wf-rect.wf-panel { padding: 20px; display: flex; flex-direction: column; }
.wf-panel__head { display: flex; align-items: flex-start; justify-content: space-between;
                  gap: 16px; margin-bottom: 14px; }
.wf-panel__actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
/* NOT "glass over the game" — that is impossible under Overwolf (§0.1 rule 4).
   This is for a layer stacked over the app's OWN panels, where the blur has
   something to blur. The saturation lift is what stops it reading as a muddy
   grey box. One instance on screen, never animated (§5).                    */
.wf-veil { background: var(--surface-veil); backdrop-filter: blur(14px) saturate(1.4); }
```

`mirror` uses a double `scaleX(-1)` rather than a second polygon: one transform on the frame, one
undo on the body. No second clip-path to keep in sync.

---

### 2.2 Card

One cut, top-right. Two cuts on a small card starts reading as a hexagon and stops reading as a card.

```tsx
// src/ui/Card.tsx
import type { CSSProperties, ReactNode } from 'react';

export function Card({
  children, alt = false, interactive = false, tint, onClick, className = '', style,
}: {
  children?: ReactNode; alt?: boolean; interactive?: boolean;
  /** A faction/damage colour. Cards are GLAZED with it, never filled. */
  tint?: string;
  onClick?: () => void; className?: string; style?: CSSProperties;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`wf-frame wf-card ${interactive ? 'wf-card--i' : ''} ${className}`}
      style={{
        ...style,
        ['--notch' as string]: 'var(--cut-md)',
        ...(tint ? { ['--tint' as string]: tint } : null),
      } as CSSProperties}
    >
      <div className="wf-fill wf-card__body">{children}</div>
    </Tag>
  );
}
```

```css
/* single TR cut — override the frame's TL+BR polygons */
.wf-card {
  --clip-o: polygon(0 0, calc(100% - var(--notch)) 0, 100% var(--notch), 100% 100%, 0 100%);
  --clip-i: polygon(0 0, calc(100% - var(--notch-in)) 0, 100% var(--notch-in), 100% 100%, 0 100%);
  --frame-edge: var(--edge-soft);
  text-align: left; border: 0; font: inherit; color: inherit;
}
.wf-card__body {
  padding: 12px 14px;
  /* Glaze, never fill. 12% is the measured-feel ceiling before a node starts
     screaming; --tint falls back to nothing so an untinted card is untouched. */
  background:
    linear-gradient(0deg, color-mix(in oklab, var(--tint, transparent) 12%, transparent),
                          color-mix(in oklab, var(--tint, transparent) 12%, transparent)),
    var(--surface);
}
.wf-card--i { transition: --nothing 0s; }        /* no layout transition, see §5 */
.wf-card--i:hover  { --frame-edge: var(--edge); }
.wf-card--i:active { transform: scale(0.995); }
.wf-card--i:hover .wf-card__body { background:
    linear-gradient(0deg, color-mix(in oklab, var(--tint, transparent) 18%, transparent),
                          color-mix(in oklab, var(--tint, transparent) 18%, transparent)),
    var(--surface-raised); }
```

---

### 2.3 Button

**The measured shape.** Symmetric elongated hexagon, fixed 34px cap run, tips on the vertical
centreline. The old `--clip-button` parallelogram is deleted.

Warframe's rest state is *unfilled*: text only, the affordance appears on hover. Three variants —
`primary` (hex + double edge, the CTA), `action` (text + gold underline that grows from the left,
the "CHANGE LOADOUT" treatment) and `ghost`.

```tsx
// src/ui/Button.tsx
import { motion } from 'motion/react';
import type { ComponentProps } from 'react';
import { D } from '../motion/wf';

type Variant = 'primary' | 'action' | 'ghost';

export function Button({
  variant = 'action', className = '', ...rest
}: ComponentProps<typeof motion.button> & { variant?: Variant }) {
  return (
    <motion.button
      type="button"
      className={`wf-btn wf-btn--${variant} ${className}`}
      whileTap={{ scale: 0.985 }}
      transition={{ duration: D.micro / 1000, ease: 'easeOut' }}
      {...rest}
    />
  );
}
```

```css
.wf-btn {
  font-family: var(--font-display); font-weight: 700;
  font-size: var(--text-small); text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--accent-text); background: none; border: 0;
  padding: 0.44rem 1.15rem 0.36rem; cursor: pointer; position: relative;
  transition: color 140ms ease-out, background-color 140ms ease-out;
}
.wf-btn:disabled { color: var(--text-ghost); cursor: not-allowed; }

/* action — the game's default. No border, no radius, no glow, no gradient:
   just gold caps and a rule underneath that grows from the left on hover.
   transform-only, therefore free.                                           */
.wf-btn--action { background: oklch(1 0 0 / 0.035); }
.wf-btn--action::after {
  content: ''; position: absolute; inset: auto 0 0 0; height: 2px;
  background: var(--accent);
  transform: scaleX(1); transform-origin: left;
  transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1), background-color 140ms;
}
.wf-btn--action:hover { color: var(--color-orokin-100); background: oklch(1 0 0 / 0.07); }
.wf-btn--action:hover::after { background: color-mix(in oklab, var(--accent) 55%, white); }

/* primary — the measured hexagon, with the measured double edge. */
.wf-btn--primary {
  --notch: var(--cut-xl);
  --notch-in: calc(var(--notch) - 0.5858 * var(--stroke));
  clip-path: polygon(var(--notch) 0, calc(100% - var(--notch)) 0, 100% 50%,
                     calc(100% - var(--notch)) 100%, var(--notch) 100%, 0 50%);
  background: var(--edge); padding: var(--stroke);
  min-height: 45px;              /* measured: CYCLE FOR is 362×45 */
}
.wf-btn--primary > span {
  display: grid; place-items: center; height: 100%; padding: 0 1.4rem;
  clip-path: polygon(var(--notch-in) 0, calc(100% - var(--notch-in)) 0, 100% 50%,
                     calc(100% - var(--notch-in)) 100%, var(--notch-in) 100%, 0 50%);
  background: var(--surface-deep);
}
.wf-btn--primary:hover { background: color-mix(in oklab, var(--accent) 80%, white); }

.wf-btn--ghost { color: var(--text-muted); }
.wf-btn--ghost:hover { color: var(--text); background: oklch(1 0 0 / 0.05); }
```

`primary` needs the inner `<span>`:
`<Button variant="primary"><span>Cycle for 1,000</span></Button>`. That is the price of a real
stroke on a cut shape; it is one element.

---

### 2.4 Tab

The single highest-value six lines in the system: the selection underline must **travel** between
tabs, not cross-fade. `motion`'s `layoutId` does it for free and it is the move that most reads as
"made by the people who made the game".

```tsx
// src/ui/Tabs.tsx
import { motion } from 'motion/react';

export function Tabs<T extends string>({ items, value, onChange }: {
  items: { id: T; label: string; badge?: number }[];
  value: T; onChange: (id: T) => void;
}) {
  return (
    <div className="wf-tabs" role="tablist">
      {items.map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          className="wf-tab"
          onClick={() => onChange(t.id)}
        >
          <span>{t.label}</span>
          {t.badge != null && <em className="wf-tab__badge wf-num">{t.badge}</em>}
          {value === t.id && (
            <motion.span
              layoutId="wf-tab-underline"
              className="wf-tab__mark"
              transition={{ type: 'spring', visualDuration: 0.22, bounce: 0.18 }}
            />
          )}
        </button>
      ))}
    </div>
  );
}
```

```css
.wf-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--hairline); }
.wf-tab {
  position: relative; background: none; border: 0; cursor: pointer;
  clip-path: var(--clip-tab);
  padding: 0.5rem 1.1rem; font-family: var(--font-display); font-weight: 600;
  font-size: var(--text-small); text-transform: uppercase; letter-spacing: 0.1em;
  color: var(--text-faint); transition: color 140ms ease-out, background-color 140ms ease-out;
}
.wf-tab:hover { color: var(--text-muted); background: oklch(1 0 0 / 0.04); }
.wf-tab[aria-selected='true'] { color: var(--accent-text); }
.wf-tab__mark {
  position: absolute; inset: auto 0 -1px 0; height: 2px;
  background: var(--accent); box-shadow: var(--glow-accent);
}
.wf-tab__badge { font-style: normal; font-size: var(--text-nano); margin-left: 6px;
                 color: var(--text-ghost); }
```

**One `layoutId` per tab strip.** Two strips sharing the id will fling the underline across the
screen — scope it (`layoutId={`wf-tab-${groupId}`}`) if a screen has more than one.

---

### 2.5 ListRow

**26px pitch.** Measured. This is dense — ~13 rows per 350px. A 40px row makes the overlay look
like a settings page rather than the game, and it is the single easiest way to get this wrong.

```tsx
// src/ui/ListRow.tsx
import type { ReactNode } from 'react';

export function ListRow({
  icon, label, value, meta, selected = false, tint, onClick,
}: {
  icon?: ReactNode; label: ReactNode; value?: ReactNode; meta?: ReactNode;
  selected?: boolean; tint?: string; onClick?: () => void;
}) {
  return (
    <div
      className={`wf-row ${selected ? 'is-selected' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={tint ? ({ ['--tint']: tint } as React.CSSProperties) : undefined}
    >
      {icon && <span className="wf-row__icon">{icon}</span>}
      <span className="wf-row__label">{label}</span>
      {meta && <span className="wf-row__meta">{meta}</span>}
      {value != null && <span className="wf-row__value wf-num">{value}</span>}
    </div>
  );
}
```

```css
.wf-row {
  height: var(--row-h);                 /* 26px, measured */
  display: grid; grid-template-columns: auto 1fr auto auto;
  align-items: center; gap: 8px;
  padding-inline: 8px;
  font-size: var(--text-small); color: var(--text-muted);
  clip-path: var(--clip-row);           /* single small BL cut */
  cursor: inherit;
}
.wf-row:nth-child(even) { background: var(--zebra); }   /* measured 29 vs 18 */
.wf-row:hover { background: oklch(1 0 0 / 0.075); color: var(--text); }
/* Selection is a gold bar on the leading edge, not a filled row. */
.wf-row.is-selected { color: var(--accent-text); background: color-mix(in oklab, var(--accent) 9%, transparent); }
.wf-row.is-selected::before {
  content: ''; position: absolute; left: 0; top: 12%; bottom: 12%; width: 2px;
  background: var(--accent); box-shadow: var(--glow-accent);
}
.wf-row { position: relative; }
.wf-row__icon  { color: var(--tint, var(--text-faint)); display: grid; place-items: center; }
.wf-row__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wf-row__meta  { color: var(--text-ghost); font-size: var(--text-nano); }
.wf-row__value { color: var(--text); }
```

Virtualise at >400 rows, not before. `@tanstack/react-virtual` is the pick when that day comes.

---

### 2.6 Meter

One slanted end so the fill reads as flowing off the edge. The fill is a spring, not a tween —
a resource bar that arrives with a tiny settle reads as physical.

```tsx
// src/ui/Meter.tsx
import { motion } from 'motion/react';
import { SPRING_METER } from '../motion/wf';

export function Meter({
  value, max = 1, color = 'var(--color-tenno-400)', ghost, label, caption, height = 6,
}: {
  value: number; max?: number; color?: string;
  /** A second, dimmer fill behind the real one: "what this will become". */
  ghost?: number;
  label?: React.ReactNode; caption?: React.ReactNode; height?: number;
}) {
  const pct = Math.max(0, Math.min(1, value / (max || 1)));
  const gpct = ghost == null ? null : Math.max(0, Math.min(1, ghost / (max || 1)));
  return (
    <div className="wf-meter">
      {(label || caption) && (
        <div className="wf-meter__head">
          <span className="wf-eyebrow">{label}</span>
          <span className="wf-num wf-meter__cap">{caption}</span>
        </div>
      )}
      <div className="wf-meter__track" style={{ height }}>
        {gpct != null && <div className="wf-meter__ghost" style={{ width: `${gpct * 100}%`, background: color }} />}
        <motion.div
          className="wf-meter__fill"
          style={{ background: color, transformOrigin: 'left' }}
          initial={false}
          animate={{ scaleX: pct }}
          transition={SPRING_METER}
        />
      </div>
    </div>
  );
}
```

```css
.wf-meter__head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
.wf-meter__cap  { font-size: var(--text-nano); color: var(--text-faint); }
.wf-meter__track {
  position: relative; overflow: hidden; clip-path: var(--clip-meter);
  background: var(--surface-well); box-shadow: inset 0 0 0 1px var(--hairline);
}
.wf-meter__fill, .wf-meter__ghost { position: absolute; inset: 0; }
.wf-meter__fill  { width: 100%; box-shadow: var(--glow-accent); }
.wf-meter__ghost { opacity: 0.22; }
```

`scaleX` on a full-width bar, never `width` — `width` is a layout property and is on the never-animate
list (§5).

---

### 2.7 Ring

Radial progress and the mastery tick ring. Two bugs from the briefs are fixed here:
the circumference is computed, not hardcoded, and **the viewBox is sized to include the ticks**
(the brief's `220` viewBox clipped a `112`-radius tick ring on all four sides).

```tsx
// src/ui/Ring.tsx
import { motion } from 'motion/react';
import { SPRING_METER } from '../motion/wf';

export function Ring({
  value, max = 1, r = 46, width = 3, ticks = 0, color = 'var(--accent)', children,
}: {
  value: number; max?: number; r?: number; width?: number;
  /** Tick count around the outside; 0 = plain ring. Every 5th tick is long. */
  ticks?: number; color?: string; children?: React.ReactNode;
}) {
  const long = 10, short = 6;
  const pad = width / 2 + (ticks ? long + 2 : 2);   // viewBox must contain the ticks
  const c = r + pad;                                 // centre
  const size = c * 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / (max || 1)));

  return (
    <div className="wf-ring" style={{ ['--ring' as string]: `${size}px` }}>
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%" aria-hidden>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--hairline)" strokeWidth={width} />
        <motion.circle
          cx={c} cy={c} r={r} fill="none"
          stroke={color} strokeWidth={width} strokeLinecap="butt"
          strokeDasharray={circ}
          transform={`rotate(-90 ${c} ${c})`}
          initial={false}
          animate={{ strokeDashoffset: circ * (1 - pct) }}
          transition={SPRING_METER}
          style={{ filter: 'drop-shadow(0 0 4px currentColor)' }}
        />
        {Array.from({ length: ticks }, (_, i) => {
          const a = (i / ticks) * Math.PI * 2 - Math.PI / 2;
          const len = i % 5 === 0 ? long : short;
          const r0 = r + width / 2 + 2, r1 = r0 + len;
          return (
            <line
              key={i}
              x1={c + Math.cos(a) * r0} y1={c + Math.sin(a) * r0}
              x2={c + Math.cos(a) * r1} y2={c + Math.sin(a) * r1}
              stroke={i / ticks <= pct ? color : 'var(--hairline)'}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"   /* UNCERTAIN U30: must be on the shape */
            />
          );
        })}
      </svg>
      {children && <div className="wf-ring__centre">{children}</div>}
    </div>
  );
}
```

```css
.wf-ring { position: relative; width: var(--ring); aspect-ratio: 1; }
.wf-ring__centre { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; }
```

---

### 2.8 Divider

The section rule. **UNCERTAIN U10: the in-game terminator is a chevron stack, not a diamond pip**,
and the brief's pip path was clipped by its own viewBox. Chevrons, then, and the gradient fade at
both ends — Warframe's hairlines are essentially never solid grey end-to-end.

```tsx
// src/ui/Divider.tsx
export function Divider({ label, mark = true }: { label?: string; mark?: boolean }) {
  return (
    <div className="wf-div">
      <span className="wf-div__line" />
      {label && <span className="wf-eyebrow wf-div__label">{label}</span>}
      {mark && (
        <svg className="wf-div__mark" width="22" height="10" viewBox="0 0 22 10" aria-hidden>
          <path d="M1 1 L5 5 L1 9 M8 1 L12 5 L8 9 M15 1 L19 5 L15 9"
                fill="none" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="square" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <span className="wf-div__line" />
    </div>
  );
}
```

```css
.wf-div { display: flex; align-items: center; gap: 10px; color: var(--accent); margin: 12px 0; }
.wf-div__line {
  flex: 1; height: 1px;
  background: linear-gradient(90deg, transparent, var(--hairline) 18%, var(--hairline) 82%, transparent);
}
.wf-div__label { color: var(--text-faint); }
.wf-div__mark { opacity: 0.75; flex-shrink: 0; }
```

---

### 2.9 Badge

Chips: damage type, rarity, faction, mastery rank. The measured in-game chip is a **near-black
background tinted ~2% toward the type hue** — that tiny tint is why 17 chips read as a family
instead of a rainbow. Small chips get `--clip-hex-sm`; rank ribbons get the notch.

```tsx
// src/ui/Badge.tsx
export function Badge({ tone = 'var(--text-faint)', shape = 'chip', children }: {
  /** Any colour token: --color-dt-heat, --color-faction-corpus, --color-crit-2… */
  tone?: string; shape?: 'chip' | 'hex' | 'ribbon'; children: React.ReactNode;
}) {
  return (
    <span className={`wf-badge wf-badge--${shape}`} style={{ ['--tone' as string]: tone }}>
      {children}
    </span>
  );
}
```

```css
.wf-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 0.14em 0.55em;
  font-family: var(--font-display); font-size: var(--text-nano); font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--tone);
  /* the 2% tint: a near-black ground pushed a few units toward the tone hue */
  background: color-mix(in oklab, var(--tone) 8%, var(--color-void-800));
  border: 1px solid color-mix(in oklab, var(--tone) 42%, transparent);
}
.wf-badge--hex {
  border: 0; padding: 0.2em 0.75em;
  clip-path: var(--clip-hex-sm);
  background: color-mix(in oklab, var(--tone) 14%, var(--color-void-800));
}
/* Rank ribbon — the MR bar on a mod card: notched top edge, solid tone rule. */
.wf-badge--ribbon {
  clip-path: var(--clip-notch); border: 0; border-bottom: 2px solid var(--tone);
  padding: 0.22em 0.9em 0.16em; background: var(--surface-deep); color: var(--text);
}
```

Rarity uses the crit ladder, not a bespoke set: common `--text-faint`, uncommon
`--color-signal-good-2`, rare `--color-crit-1`, legendary `--color-crit-2`, prime
`--color-orokin-400`. One decision, no invented hexes.

---

### 2.10 Tooltip

No dependency, no anchor-positioning bet. Portal + one `getBoundingClientRect` on open, flipped if
it would leave the viewport. ~30 lines and it cannot break when the Chromium version moves.

```tsx
// src/ui/Tooltip.tsx
import { cloneElement, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Tooltip({ content, children }: { content: ReactNode; children: ReactElement }) {
  const [box, setBox] = useState<{ x: number; y: number; flip: boolean } | null>(null);
  const t = useRef<number>(0);

  const show = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    t.current = window.setTimeout(() => {
      const flip = r.top < 120;                       // not enough room above → below
      setBox({ x: r.left + r.width / 2, y: flip ? r.bottom + 8 : r.top - 8, flip });
    }, 120);                                          // Warframe-ish dwell, not instant
  };
  const hide = () => { clearTimeout(t.current); setBox(null); };

  return (
    <>
      {cloneElement(children, { onMouseEnter: show, onMouseLeave: hide, onBlur: hide })}
      {box && createPortal(
        <div
          role="tooltip"
          className="wf-tip"
          style={{ left: box.x, top: box.y, transform: `translate(-50%, ${box.flip ? '0' : '-100%'})` }}
        >
          <div className="wf-tip__body">{content}</div>
        </div>,
        document.body,
      )}
    </>
  );
}
```

```css
.wf-tip { position: fixed; z-index: 60; pointer-events: none; max-width: 320px;
          animation: wf-tip-in 120ms cubic-bezier(0.16, 1, 0.3, 1); }
.wf-tip__body {
  background: var(--surface-deep); color: var(--text);
  border: 1px solid var(--edge-soft);
  padding: 8px 10px; font-size: var(--text-small); line-height: 1.35;
  box-shadow: var(--shadow-card);
  clip-path: var(--clip-card);
}
@keyframes wf-tip-in { from { opacity: 0; transform-origin: bottom; } to { opacity: 1; } }
```

The `translate` in `style` and the `opacity` keyframe do not fight: the keyframe animates opacity
only. Do not add a `transform` to the keyframe or it will clobber the positioning transform.

---

### 2.11 Modal

Native `<dialog>`. Backdrop, `Esc`, focus trap, inertness of the page behind — all free from the
platform. Writing a custom one is 200 lines to reproduce what the browser already does.

**UNCERTAIN U3: do not hand-reconstruct the Lotus emblem for the header.** The brief's SVG renders
at the wrong aspect and collapses two of its three chevrons. Use the wiki's `Lotus(xWhite).svg`
path data unmodified, or the chevron mark from §2.8.

```tsx
// src/ui/Modal.tsx
import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ open, onClose, title, children, actions }: {
  open: boolean; onClose: () => void; title?: ReactNode; children?: ReactNode; actions?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="wf-modal" onClose={onClose} onCancel={onClose}>
      <div className="wf-frame wf-modal__frame" style={{ ['--notch' as string]: 'var(--cut-xl)' }}>
        <div className="wf-fill wf-modal__body">
          <div className="wf-hairline" aria-hidden />
          {title && <h2 className="wf-title wf-title--gold">{title}</h2>}
          <div className="wf-modal__content">{children}</div>
          {actions && <div className="wf-modal__actions">{actions}</div>}
        </div>
      </div>
    </dialog>
  );
}
```

```css
.wf-modal { border: 0; padding: 0; background: transparent; max-width: min(680px, 90vw); }
.wf-modal::backdrop { background: oklch(0.05 0.015 285 / 0.72); backdrop-filter: blur(6px); }
.wf-modal__body { padding: 26px 28px; display: flex; flex-direction: column; gap: 16px; }
.wf-modal__actions { display: flex; justify-content: flex-end; gap: 10px; }
/* Entrance: opacity + transform only. */
.wf-modal[open] { animation: wf-modal-in 260ms cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes wf-modal-in { from { opacity: 0; transform: translateY(10px) scale(0.985); } }
```

The `::backdrop` blur is the **one permitted `backdrop-filter` instance** (§5) — and it is never on
screen at the same time as a glass panel, because the modal covers them.

---

### 2.12 Ticker

Animated numerals with **zero React re-renders**: `motion` drives a `MotionValue`, a subscriber
writes `textContent`. This matters — a mastery counter re-rendering a tree 60× a second is exactly
the kind of thing that eats the 1.5 ms budget.

```tsx
// src/ui/Ticker.tsx
import { animate, useMotionValue, useMotionValueEvent } from 'motion/react';
import { useEffect, useRef } from 'react';
import { D, EASE_ENTER } from '../motion/wf';

const nf = new Intl.NumberFormat('en-US');

export function Ticker({ value, format = (n: number) => nf.format(Math.round(n)), duration = D.epic }: {
  value: number; format?: (n: number) => string; duration?: number;
}) {
  const mv = useMotionValue(value);
  const el = useRef<HTMLSpanElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; mv.set(value); if (el.current) el.current.textContent = format(value); return; }
    const c = animate(mv, value, { duration: duration / 1000, ease: EASE_ENTER });
    return () => c.stop();
  }, [value, duration, mv, format]);

  useMotionValueEvent(mv, 'change', v => { if (el.current) el.current.textContent = format(v); });

  return <span ref={el} className="wf-num wf-ticker" aria-label={String(value)} />;
}
```

```css
.wf-ticker { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; }
```

The first value is set, not animated: counting up from 0 on mount for a stat the player already
owns is noise. Animate only *deltas*.

---

## 3. The escalation layer — what takes it past the game's own UI

Ranked by **impact per effort**, highest first. Effort is in half-days for one implementer.
Everything above the line ships in v1; everything below it is opt-in and gated on §5's quality tier.

| # | Move | Impact | Effort | Verdict |
|---|---|---|---|---|
| E1 | **Live theme** — `--accent` follows the player's equipped Warframe energy colour | ⭑⭑⭑⭑⭑ | 0.25 | **Ship.** Nothing else in this list is close. |
| E2 | **Travelling selection underline** (`layoutId`) | ⭑⭑⭑⭑ | 0.1 | **Ship.** Already in §2.4. |
| E3 | **Halved transitions** — the game's *shape*, half its *duration* | ⭑⭑⭑⭑ | 0.25 | **Ship.** Players run threads asking DE to speed the menus up. |
| E4 | **Density** — 26px rows, empty centre, 5% gutters | ⭑⭑⭑⭑ | 0.5 | **Ship.** Restraint, not addition. |
| E5 | **Materialise on mount** — clip-path wipe with a lit leading edge | ⭑⭑⭑⭑ | 0.5 | **Ship.** Replaces the inert U25 technique. |
| E6 | **Perimeter sweep** on the focused panel (SVG dasharray) | ⭑⭑⭑ | 0.5 | **Ship.** Replaces the impossible U2 conic. |
| E7 | **Command palette** (`Ctrl+K` → any item, node, mod, frame) | ⭑⭑⭑⭑⭑ | 2.0 | **Ship in v1.1.** The game has no search. This is our biggest genuine advantage over it. |
| E8 | **Delta highlighting** — every number that changed since last session glows once | ⭑⭑⭑⭑ | 1.0 | **Ship in v1.1.** The game cannot do this; it has no memory of your last login. |
| E9 | **WebGL Orokin background** (§4) | ⭑⭑⭑ | 1.0 | **Ship, desktop window only, tier ≥ med.** |
| E10 | **Pointer parallax** on the hero panel | ⭑⭑ | 0.5 | Ship, tier ≥ med. |
| E11 | **Chromatic split** on the hero title (3-layer text-shadow) | ⭑⭑ | 0.1 | Ship. Free. |
| E12 | **Interlace overlay**, exactly one surface | ⭑⭑ | 0.25 | Ship, one surface, never two. |
| E12b | **Opaque-panel discipline** — no see-through chrome over live gameplay | ⭑⭑⭑ | 0 | Already enforced by §1 surfaces. It is the difference between readable and unusable mid-mission. |
| E13 | **Adaptive quality ladder** (probe 90 frames, drop a tier at p95 > 12ms) | ⭑⭑⭑ | 0.5 | **Ship.** It is what makes E9–E12 safe to ship at all. |
| — | — | — | — | — |
| E14 | Glitch/datamosh on Void surfaces | ⭑ | 1.0 | Later. SVG filter animation is a CPU trap (§5). |
| E15 | Shard-based materialise (16 layers) | ⭑ | 1.0 | Hero moments only, or never. |
| E16 | UI sound set | ⭑⭑ | 2.0 | Later. Overwolf audio over a live game needs its own volume policy. |

### E1 — Live theme (the one to build first)

The game gives three customisation axes: theme, background, sound. Add a fourth it cannot:
**bind the overlay's accent to the player's actual equipped energy colour.** Players are already
trained to read their energy colour as "mine"; every panel then matches the frame on screen.

```ts
// src/app/liveTheme.ts — one function, no state library needed.
export function applyLiveEnergy(rgb: [number, number, number] | null) {
  const root = document.documentElement;
  if (!rgb) { root.removeAttribute('data-wf-theme'); return; }
  const [r, g, b] = rgb;
  root.style.setProperty('--live-energy', `rgb(${r} ${g} ${b})`);
  root.dataset.wfTheme = 'live';
}
```

That is the whole feature: `[data-wf-theme='live']` is already in §1 and every token in the app
derives from `--accent` through `color-mix`. **This only works if the codemod in §1.3 is done** —
it is the reason that codemod exists.

Guard rail: clamp chroma so a player running a neon-magenta energy does not produce unreadable
`--text-muted`. One line at the call site:
`color-mix(in oklab, var(--live-energy) 70%, var(--color-orokin-400))` if the raw colour's OKLCh
chroma exceeds 0.22.

### E3 — Halved transitions

```ts
// src/motion/wf.ts — the whole motion language, one file.
import type { Transition, Variants } from 'motion/react';

/* UNCERTAIN U26: the brief mislabelled these. Correct names below.
   Warframe's feel is a strong front-load with a long tail.                    */
export const EASE_ENTER = [0.16, 1, 0.3, 1] as number[];   // expo-out. Arrivals.
export const EASE_EXIT  = [0.7, 0, 0.84, 0] as number[];   // expo-IN. Departures.
export const EASE_SWEEP = [0.83, 0, 0.17, 1] as number[];  // quint-inOut. Light sweeps.
export const EASE_MECH  = [0.65, 0, 0.35, 1] as number[];  // symmetric, mechanical.
/* NOT `as const`: a readonly tuple is not assignable to motion's BezierDefinition
   and the brief's version fails typecheck in this exact stack.                */

export const D = { micro: 90, fast: 180, base: 260, slow: 420, epic: 900 } as const;

export const SPRING_PANEL: Transition = { type: 'spring', visualDuration: 0.26, bounce: 0.12 };
export const SPRING_SNAP:  Transition = { type: 'spring', visualDuration: 0.16, bounce: 0 };
export const SPRING_METER: Transition = { type: 'spring', stiffness: 170, damping: 26, mass: 1.1 };
export const SPRING_NEEDLE:Transition = { type: 'spring', stiffness: 420, damping: 18, mass: 0.6 };

export const panelIn: Variants = {
  hidden:  { opacity: 0, x: -24 },
  visible: { opacity: 1, x: 0, transition: SPRING_PANEL },
  exit:    { opacity: 0, x: -12, transition: { duration: D.fast / 1000, ease: EASE_EXIT } },
};
export const listRow: Variants = {
  hidden:  { opacity: 0, x: -14 },
  visible: { opacity: 1, x: 0, transition: SPRING_PANEL },
  exit:    { opacity: 0, x: -6, transition: { duration: 0.11, ease: EASE_EXIT } },
};

/** Cap total cascade at 300ms regardless of row count. Compute, never hardcode. */
export const stagger = (n: number) => Math.min(0.035, 0.3 / Math.max(n, 1));
```

Note what is **not** here: the brief's `filter: brightness()` on `panelIn`. §5 forbids animating
`filter`, and the brief's own budget table forbids it two sections after recommending it four
times. The brightness ramp survives only in E5, where it is a one-shot on a single element.

### E5 — Materialise (replaces the inert U25 dissolve)

**UNCERTAIN U25: the `--wf-t` mask-threshold technique does nothing.** The custom property feeds no
declaration, the `url(#wf-threshold)` filter is never defined, and `mask-mode` never becomes
`luminance` — it silently degrades to an opacity fade. This is the working version: a `clip-path`
wipe with a lit leading edge, which is the move Warframe actually makes (content revealed by a
travelling boundary, not by a fade).

```css
@property --wf-wipe { syntax: '<percentage>'; inherits: false; initial-value: 0%; }

.wf-materialise {
  --wf-wipe: 0%;
  clip-path: inset(0 calc(100% - var(--wf-wipe)) 0 0);
  animation: wf-mat 520ms cubic-bezier(0.83, 0, 0.17, 1) forwards;
}
.wf-materialise::before {           /* the lit boundary running ahead of the content */
  content: ''; position: absolute; top: 0; bottom: 0; width: 2px;
  /* fully inside the wipe: the parent's clip-path would eat an edge
     straddling the boundary, leaving a half-width line. */
  left: calc(var(--wf-wipe) - 2px);
  background: color-mix(in oklab, var(--accent) 60%, white);
  box-shadow: var(--glow-accent);
  animation: wf-mat-edge 520ms cubic-bezier(0.83, 0, 0.17, 1) forwards;
}
@keyframes wf-mat      { to { --wf-wipe: 100%; } }
@keyframes wf-mat-edge { to { --wf-wipe: 100%; opacity: 0; } }
```

`@property` is required — plain custom properties do not interpolate. Chromium-only in 2023;
Baseline since mid-2024, and Overwolf is Chromium regardless (UNCERTAIN: the brief's "Chromium-only"
justification was outdated, but the conclusion holds).

### E6 — Perimeter sweep (replaces the impossible U2 conic)

**UNCERTAIN U2: a light cannot chase a chamfer on a mask-composite ring, because there is no ring
on the chamfer.** An SVG `<polygon>` stroke genuinely follows every edge including the diagonals.
One element, one animated `stroke-dashoffset`, and it is the *only* technique in the corpus that
does what the brief claimed.

```tsx
// src/ui/Sweep.tsx — absolutely positioned inside a .wf-frame, pointer-events none.
export function Sweep({ notch = 24, run = 2600 }: { notch?: number; run?: number }) {
  // Percent-space polygon matching --clip-panel. preserveAspectRatio="none" is
  // fine HERE and only here: we are stroking a path, not shaping one, and the
  // stroke is kept uniform by vector-effect (UNCERTAIN U31 does not apply).
  const pts = `${notch},0 100,0 100,${100 - notch} ${100 - notch},100 0,100 0,${notch}`;
  return (
    <svg className="wf-sweep" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <polygon
        points={pts}
        fill="none" stroke="currentColor" strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        pathLength={100}
        strokeDasharray="14 86"
        style={{ animation: `wf-sweep ${run}ms linear infinite` }}
      />
    </svg>
  );
}
```

```css
.wf-sweep { position: absolute; inset: 0; width: 100%; height: 100%;
            color: color-mix(in oklab, var(--accent) 70%, white);
            filter: drop-shadow(0 0 3px currentColor); pointer-events: none; }
@keyframes wf-sweep { to { stroke-dashoffset: -100; } }
```

`pathLength={100}` normalises the perimeter, so one dasharray works on any panel size.
**One sweep visible at a time** — it marks the focused panel, which is the whole point.

### E7 — Command palette

The game has no search. We do. `Ctrl+K` over every item, node, mod, frame and mission the app
already indexes, with the crit ladder for match quality. This is the single most useful thing the
overlay can do that the game cannot, and it is why `cmdk` is the one dependency worth adding — when
it ships, not before.

### E8 — Delta highlighting

Every numeric readout compares against the previous session's snapshot (the app already persists
one) and pulses **once** on first paint if it changed: green-2 for up, red-2 for down, gold for
"newly unlocked". One `useEffect`, one class, one 700ms animation. The game has no memory of your
last login; this is a capability, not a decoration.

### E11 — Chromatic split (free, do it)

```css
.wf-title--hero {
  text-shadow:
    -1px 0 0 color-mix(in oklab, var(--color-tenno-400) 55%, transparent),
     1px 0 0 color-mix(in oklab, var(--color-crit-2) 40%, transparent);
}
```

Three layers of text, zero cost, and it does the "hot signal" read that an SVG chromatic filter
would cost 1–3 ms/frame to fake.

---

## 4. The shader background

**Recommendation: raw WebGL2, one fullscreen triangle, half render scale, desktop window only.**

**UNCERTAIN U24: the motion brief's reasoning was wrong** — it argued `three` was out because it
would add 600 KB, but `three@^0.185.1`, `@react-three/fiber`, `drei` and `postprocessing` are
*already dependencies* and already used by `src/panels/starchart/`. The recommendation survives on
a different and better argument:

- Vite splits per entry (`background.html`, `desktop.html`, `ingame.html`, `lab.html`). The
  in-game HUD window must **not** pull in three; a fullscreen fragment shader there is ~2 KB of
  raw GL versus a whole renderer's parse and init cost, per window, on top of a running game.
- The star chart already owns an R3F canvas. **Where an R3F canvas is already mounted, render the
  background as a plane inside it** — one GL context, reusing `src/gfx/shaders.ts`, which already
  ships simplex + fbm + domain warp. Do not open a second context beside it.
- Everywhere else: the module below. **Exactly one WebGL context per window** (§5).

```ts
// src/fx/orokinBg.ts
const VS = `#version 300 es
layout(location = 0) in vec2 p;   // explicit: attribute 0 is NOT guaranteed otherwise
void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2  uRes;
uniform float uT;
uniform vec3  uAccent;   // fed from --accent at runtime
uniform vec3  uVoid;     // #07060F -> vec3(0.027,0.024,0.059)

float h(vec2 v){ return fract(sin(dot(v, vec2(127.1,311.7))) * 43758.5453); }
float n(vec2 v){
  vec2 i = floor(v), f = fract(v);
  f = f*f*(3.0-2.0*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x),
             mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 v){
  float s = 0.0, a = 0.5;
  mat2 R = mat2(0.80, 0.60, -0.60, 0.80);   // rotate per octave: kills axis banding
  for(int i = 0; i < 5; i++){ s += a * n(v); v = R * v * 2.02; a *= 0.5; }
  return s;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / uRes.y;
  float t = uT * 0.035;

  // domain warp — the difference between "noise" and "nebula"
  vec2 q = vec2(fbm(uv*1.6 + vec2(0.0, t)), fbm(uv*1.6 + vec2(5.2, 1.3 - t)));
  vec2 r = vec2(fbm(uv*1.6 + 3.4*q + vec2(1.7, 9.2) + 0.15*t),
                fbm(uv*1.6 + 3.4*q + vec2(8.3, 2.8) - 0.13*t));
  float f = fbm(uv*1.6 + 3.6*r);

  vec3 col = mix(uVoid, vec3(0.055,0.075,0.115), smoothstep(0.30, 0.72, f));
  col = mix(col, uAccent * 0.85, smoothstep(0.66, 0.94, f) * 0.45);

  float rad = length(uv);
  float ring = sin(rad * 46.0 - uT * 0.55);                       // Orokin rings
  col += uAccent * pow(max(ring, 0.0), 34.0) * 0.14 * smoothstep(1.05, 0.22, rad);

  float ang = atan(uv.y, uv.x);                                   // slow beacon sweep
  col += uAccent * pow(max(0.0, cos(ang - uT*0.22)), 26.0) * 0.09 * smoothstep(1.10, 0.10, rad);

  col += uAccent * pow(smoothstep(0.80, 1.0, f), 3.0) * 0.26;     // analytic bloom, no pass
  col *= smoothstep(1.45, 0.30, rad);                             // vignette
  col += (h(gl_FragCoord.xy + uT) - 0.5) * 0.014;                 // dither, kills banding
  o = vec4(col, 1.0);
}`;

export function startOrokinBg(cv: HTMLCanvasElement, accent: [number, number, number], scale = 0.5) {
  const gl = cv.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' });
  if (!gl) return null;                       // caller falls back to the static CSS gradient

  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? '');
    return s;
  };
  const pr = gl.createProgram()!;
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(pr); gl.useProgram(pr);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  // one oversized triangle, not two: no diagonal seam, two fewer verts
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(pr, 'uRes');
  const uT   = gl.getUniformLocation(pr, 'uT');
  const uAcc = gl.getUniformLocation(pr, 'uAccent');
  gl.uniform3f(uAcc, ...accent);
  gl.uniform3f(gl.getUniformLocation(pr, 'uVoid'), 0.027, 0.024, 0.059);

  let raf = 0, running = false;
  const resize = () => {
    cv.width  = Math.max(2, (cv.clientWidth  * scale) | 0);
    cv.height = Math.max(2, (cv.clientHeight * scale) | 0);
    gl.viewport(0, 0, cv.width, cv.height);
    gl.uniform2f(uRes, cv.width, cv.height);
  };
  const ro = new ResizeObserver(resize); ro.observe(cv); resize();

  const t0 = performance.now();
  const loop = () => { gl.uniform1f(uT, (performance.now() - t0) / 1000);
                       gl.drawArrays(gl.TRIANGLES, 0, 3);
                       raf = requestAnimationFrame(loop); };

  const api = {
    /** Idempotent. Safe to call from any visibility handler. */
    setRunning(on: boolean) {
      if (on === running) return;
      running = on;
      if (on) loop(); else cancelAnimationFrame(raf);
    },
    setAccent(rgb: [number, number, number]) { gl.useProgram(pr); gl.uniform3f(uAcc, ...rgb); },
    destroy() { api.setRunning(false); ro.disconnect(); gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
  api.setRunning(true);
  return api;
}
```

```css
/* Half-res canvas, upscaled by CSS. A nebula has no high-frequency detail, so
   the bilinear upscale is invisible and we just saved 75% of the fill rate. */
canvas.wf-bg { position: fixed; inset: 0; width: 100%; height: 100%; display: block; z-index: -1; }
```

**Half-res is not negotiable.** Five octaves × five fbm calls ≈ 25 noise evaluations per pixel:
at 2560×1440 that is 92M/frame, at 0.5 scale it is 23M. On an integrated GPU that is the difference
between "background" and "the reason your game stutters".

`setRunning(boolean)` rather than the brief's `pause(v)`/`stop()` mix — **UNCERTAIN: the brief's own
lifecycle snippet passes a boolean to a zero-argument teardown, so both `true` and `false` destroy
the particle system permanently.** One idempotent setter, no way to get it wrong.

---

## 5. Performance budget

The overlay composites over a game targeting 60–144 fps. **Every millisecond we spend on the main
thread is a millisecond the game does not get**, and the compositor contends with it for the GPU.

### Hard ceilings

| Resource | Ceiling | How to check |
|---|---|---|
| Main-thread JS per frame | **≤ 1.5 ms** | Performance panel, overlay visible and idle |
| Our GPU time per frame | **≤ 1.5 ms** | half-res background is why this is reachable |
| Composited layers (animated / `will-change`) | **≤ 25** | Layers panel. UNCERTAIN U27: *static* transforms do **not** create layers — do not count them |
| Concurrent `filter: blur()` layers | **≤ 2**, each ≤ 400×400 CSS px, radius ≤ 12px | |
| `backdrop-filter` instances | **≤ 1 on screen, never animated** | the most expensive property in CSS — and under Overwolf it cannot blur the game frame at all (§0.1 rule 4), so it is only ever worth paying for over the app's own content |
| Canvas particles | **≤ 120**, DPR capped at 1.5 | |
| WebGL contexts | **exactly 1 per window**, render scale 0.5 | |
| Bundle, in-game window | **≤ 400 KB gz** | and it must not contain `three` |
| Idle CPU when the overlay is hidden | **0%. No rAF at all.** | non-negotiable |

### Allowed to animate

`transform` (`translate3d` / `scale` / `rotate`), `opacity`, and registered `@property` custom
properties **that feed into those two**. That is the complete list.

Two documented exceptions, both one-shot and both on a single element:
`clip-path: inset()` in E5 (the materialise wipe) and `stroke-dashoffset` in E6 (the perimeter
sweep). Neither runs on more than one element at a time.

### Never animate, in any circumstance

`width` · `height` · `top` / `left` / `right` / `bottom` · `margin` · `padding` · `font-size` ·
`border-width` (all layout — they reflow the subtree) · `box-shadow` radius or spread ·
`border-radius` · `background-position` on a large element · **`filter` on anything recurring**
(the briefs recommend it four times and forbid it once; the forbid wins) · **any SVG filter
attribute**, especially `feTurbulence`'s `baseFrequency` and `feDisplacementMap`'s `scale` — these
are CPU-rasterised and are the classic "why is my glitch effect 12 fps" bug · `backdrop-filter`
anything.

### Must be canvas or GPU, never DOM

- Anything with more than ~50 independently *animating* elements.
- Any per-pixel effect over a large area (nebula, noise field, plasma) — shader, half-res.
- Additive accumulation of overlapping glows — `globalCompositeOperation: 'lighter'` or a GL blend.
  Per-element `mix-blend-mode: screen` creates a layer per element.

### Lifecycle — the rule that actually protects the player's frame rate

```ts
// src/app/lifecycle.ts
import type { startOrokinBg } from '../fx/orokinBg';

export function bindOverlayLifecycle(bg: ReturnType<typeof startOrokinBg>) {
  const set = (visible: boolean) => {
    bg?.setRunning(visible);                       // idempotent; never destroys
    document.documentElement.classList.toggle('wf-frozen', !visible);
  };
  overwolf.windows.onStateChanged.addListener(e => {
    set(e.window_state_ex === 'normal' || e.window_state_ex === 'maximized');
  });
  document.addEventListener('visibilitychange', () => set(!document.hidden));
  return () => bg?.destroy();
}
```

```css
.wf-frozen *, .wf-frozen *::before, .wf-frozen *::after { animation-play-state: paused !important; }
```

### Adaptive quality ladder

Measure, do not guess. Probe 90 frames on mount; drop a tier when p95 exceeds 12 ms.
`high` = everything. `med` = no WebGL background (static CSS gradient instead), no parallax.
`low` = no glass, no glow, no sweep, no interlace; transitions collapse to opacity only.

```ts
// src/app/tier.ts
export type Tier = 'high' | 'med' | 'low';

export function probeTier(cb: (t: Tier) => void, frames = 90) {
  const d: number[] = [];
  let last = performance.now(), n = 0;
  const step = (t: number) => {
    d.push(t - last); last = t;
    if (++n < frames) return void requestAnimationFrame(step);
    const p95 = d.slice().sort((a, b) => a - b)[Math.floor(d.length * 0.95)];
    const tier: Tier = p95 > 20 ? 'low' : p95 > 12 ? 'med' : 'high';
    document.documentElement.dataset.wfTier = tier;
    cb(tier);
  };
  requestAnimationFrame(step);
}
```

`prefers-reduced-motion` is honoured globally in §1, and the `contrast` theme kills every glow and
shadow. Both are already wired; neither is optional.

---

## 6. Build order

Dependency-ordered. Each item is independently implementable by one agent with no knowledge of the
others beyond its stated dependency, and each has a check that fails if the item is wrong.
Items in the same **wave** have no dependency on each other and can be built in parallel.

### Wave 0 — foundation (must land first, blocks everything)

**B1. Replace `src/styles/theme.css` with §1.2.**
Depends on: nothing.
Also: delete `public/fonts/cinzel-0.woff2`, `cinzel-1.woff2`, `cinzel.css`; add
`public/fonts/chakra-petch-400.woff2` and `-700.woff2` (SIL OFL 1.1, latin subset via `pyftsubset`,
target ≤ 22 KB each).
Check: `npm run build` passes; `rg -i "cinzel|ailerons" src public` returns nothing; the app renders
with the new gold (`#CBAD5E`, visibly cooler and less bright than the old `#DDC57D`).

**B2. Guardrail check script `scripts/check-ui-tokens.ts`.**
Depends on: B1.
Fails the build if: any `Ailerons` reference exists anywhere (licence, U16); any hardcoded hex
appears in `src/**/*.tsx` outside `theme.css` and the damage-type table (all colour must come from
tokens); `--clip-button` or `--font-title` is still referenced; `border-radius` appears with a value
other than `0`, `50%`, `var(--radius-chrome)` or `9999px`.
Add it to the existing `npm run check` chain.
Check: the script fails on a deliberately reintroduced `#DDC57D` and passes on a clean tree.

**B3. `src/motion/wf.ts` — the motion language (§3 E3).**
Depends on: nothing.
Exports `EASE_*`, `D`, `SPRING_*`, `panelIn`, `listRow`, `stagger(n)`. No `as const` on the bezier
arrays (it breaks `motion`'s `BezierDefinition` typing in this stack).
Check: `npm run typecheck` passes with a component that spreads `SPRING_PANEL` into a
`<motion.div transition>`.

### Wave 1 — the frame (blocks every visual primitive)

**B4. `src/styles/primitives.css` — `.wf-frame` / `.wf-rect` / `.wf-hairline` (§2.0).**
Depends on: B1.
Includes the `--notch-in` compensation and the evenodd annulus, plus `.wf-frame--single`.
Check: **add an artboard to `lab.html`** with a 300×120 and a 900×120 `.wf-frame` at
`--stroke: 1px` and at `4px`; screenshot and confirm (a) the stroke is continuous around the
diagonals, (b) the diagonal stroke is not visibly thicker than the straight edges at 4px, (c) the
inner hairline follows the chamfer. If (c) fails, add `.wf-frame--single` globally and note it in
this spec — the panel still reads correctly with one stroke.

**B5. Type roles + shell layout (`.wf-title`, `.wf-eyebrow`, `.wf-num`, `.wf-stat`, `.wf-shell`).**
Depends on: B1.
Check: at 1920×1080 the left rail measures 327 ± 3 px and the left gutter 96 ± 3 px
(`getBoundingClientRect` in the lab page). This is the U6 regression test — with `%` tracks it
comes out at 294px and the check fails.

### Wave 2 — primitives (parallel; each depends only on B4/B5)

**B6. Panel (§2.1)** — migrate `src/ui/orokin.tsx`'s existing `Panel`: replace the `ACCENTS` object
with tokens, add `cut` / `mirror` / `glass`, default to rectangular.
Check: rendering `<Panel>` with no props produces a rectangle with a double hairline and no chamfer.

**B7. Card (§2.2)** — migrate the existing `Card`; add `tint` glaze, drop the gradient "metal" fills.
Check: a tinted card's interior is ≤ 12% of the tint colour over `--surface`, not a filled block.

**B8. Button (§2.3)** — new file; three variants; the hex is the measured symmetric shape.
Check: `--clip-hex` on a 362×45 box puts the tip at exactly x=0, y=22.5 and the top-left vertex at
x=34 — measure with `getBoundingClientRect` on a probe element positioned at the polygon vertex.

**B9. Tabs (§2.4)** — migrate the existing `Tabs` to `layoutId`.
Check: switching tabs animates the underline across, not a cross-fade (visually, in the lab page);
two tab strips on one page do not fling into each other (scoped `layoutId`).

**B10. ListRow (§2.5)** — new file, 26px pitch, zebra, leading-edge selection bar.
Check: 13 rows fit in 350px ± 4px.

**B11. Meter (§2.6)** and **B12. Ring (§2.7)** — migrate the existing pair.
Check (Meter): the fill animates `scaleX`, and `rg "width:" ` on the animated element finds nothing.
Check (Ring): with `ticks={20}` nothing is clipped at the four cardinal points — the U-bug in the
brief's mastery ring. Assert `svg.getBBox()` fits inside the viewBox.

**B13. Divider (§2.8)**, **B14. Badge (§2.9)**.
Check (Badge): the 17 damage types render as a family — sample each chip's background and confirm
every one is within ΔL 4% of the others (the 2% tint rule).

**B15. Tooltip (§2.10)** — portal + rect, 120ms dwell, viewport flip.
Check: a tooltip on an element in the top 100px of the window flips below instead of clipping.

**B16. Modal (§2.11)** — native `<dialog>`.
Check: `Esc` closes it, focus returns to the trigger, and the page behind is inert. All free; the
check is that nobody reimplemented them.

**B17. Ticker (§2.12)** — MotionValue + `textContent`.
Check: React DevTools profiler records **zero** renders of the parent during a count animation.

### Wave 3 — escalation (each independently gated)

**B18. Live theme (E1)** — `src/app/liveTheme.ts` + the §1.3 codemod pass 3.
Depends on: B1, and whichever account-parsing module exposes equipped energy colour.
Check: setting `--live-energy` to `rgb(255 0 255)` retints every panel edge, hairline, meter glow
and selection bar without touching any component.

**B19. Materialise (E5)** and **B20. Perimeter sweep (E6)**.
Depends on: B4.
Check (B20): the sweep's leading dot is visible **on the diagonal** — this is the U2 regression test.

**B21. Adaptive tier probe (E13)** — `src/app/tier.ts`, sets `data-wf-tier` on `<html>`.
Depends on: nothing.
Check: forcing `low` removes glass, glow, sweep and interlace via CSS only, no JS branching.

**B22. WebGL background (§4)** — `src/fx/orokinBg.ts` + `src/app/lifecycle.ts`.
Depends on: B21 (only runs at tier ≥ med) and B18 (accent uniform).
Check: hide the overlay window → `requestAnimationFrame` count drops to **zero** (instrument with a
counter in the loop). This is the non-negotiable idle rule, and it is where the brief's own snippet
was broken.

**B23. Theme picker UI** — the 18 measured themes + High Contrast, as `data-wf-theme` on `<html>`,
persisted in the existing settings store.
Depends on: B1, B6, B9.
Check: High Contrast produces `#FFFF00` on `#000000` with every glow and shadow off; contrast ratio
on body text ≥ 7:1.

### Wave 4 — beyond the game (post-v1)

**B24. Delta highlighting (E8)** · **B25. Command palette (E7, adds `cmdk`)** ·
**B26. List virtualisation (adds `@tanstack/react-virtual`)**, only when a real list exceeds ~400
rows and profiles badly.

---

## 7. What this spec deliberately does not build

- **A chamfer on every panel.** Rule #1. The switch exists (`cut`), it is off by default.
- **The Lotus emblem, hand-reconstructed.** U3. Ship the official SVG or a chevron.
- **Animated `filter` anywhere recurring**, including the brief's favourite `brightness()` panel
  entrance. §5.
- **SVG filter effects** (chromatic aberration, glitch, turbulence). Three text layers get 80% of
  the read for 0% of the cost.
- **Any of the six component libraries.** All copy-in registries; we take technique, not code.
- **`three` in the in-game window.**
- **Ailerons.** Ever. U16.

## 8. Open questions worth one hour each, later

1. Which Chromium version Overwolf ships — decides whether `polygon(evenodd, …)` (B4) and CSS anchor
   positioning (would simplify B15) are available. One `navigator.userAgentData` log answers both.
2. Whether the account data exposes the equipped Warframe's energy colour as RGB or as a palette
   index. Decides how much work E1 actually is; the CSS half is done either way.
3. Re-sample the 18 theme accents from in-game captures rather than Market icons (U9/U18), if a
   player is willing to screenshot each theme's menu at 1080p.
