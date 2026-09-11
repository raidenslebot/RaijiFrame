# RaijiFrame

A modular Overwolf overlay for Warframe. Reachable from the Overwolf dock button or with **Ctrl + K** in game.

First panel is **Progression**: it reads your account and answers *what should I do next*, with completion as the
goal and repetition as the thing to avoid.

---

## Run it

```bash
npm install
npm run build
```

Then load `dist/` into Overwolf as an unpacked extension:

1. Overwolf must be running, and **your Overwolf account must be whitelisted as a developer** — without that,
   unpacked apps load as *"Unauthorized App"*.
2. Wrench icon in the dock → **About** → **Development Options** → **Load unpacked extension**.
3. Select the **`dist/`** folder (it is the app root: `manifest.json` sits at its top level).
4. "Codex" appears in the dock. Launch Warframe and the overlay attaches.

For an edit-reload loop, `npm run watch` rebuilds `dist/` on save and the manifest's `enable_auto_refresh` picks it up.

### Dev tools

Disabled by default since Overwolf client 0.153. Enable once:

```bash
reg add "HKCU\SOFTWARE\Overwolf\CEF" /v enable-features /t REG_SZ /d enable-dev-tools /f
```

Then **Ctrl + Shift + I** on a focused app window, or attach Chrome to `http://localhost:54284` — the practical way
to debug the in-game window from a second monitor.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Typecheck, then build `dist/` — the loadable Overwolf app |
| `npm run watch` | Rebuild `dist/` on change |
| `npm run check` | The whole gate suite - 54 scripts, 769 named assertions. Exits non-zero on the first failure |
| `npm run check:data` | Referential integrity of the vendored datasets |
| `npm run typecheck` | Both TS projects (app + tooling) |
| `npm run lint` | ESLint with the global react-hooks flat config |
| `npm run opk` | Package a signed `.opk` (needs `@overwolf/ow-cli`) |

### Instruments

These MEASURE rather than assert. A gate says a claim still holds; an instrument
tells you a number nobody knew, and several of the app's stated figures came from
one of these being run once.

| Command | What it measures |
| --- | --- |
| `npm run live` | The app that is RUNNING over the game, read through Overwolf's own debug port: the game's resolution, which windows are up, the open session and its plan, and which `CurrentLoadOutIds` entry each preset group actually uses |
| `npm run cost` | What the live app costs the machine running the game - task, script, layout and style time per second, sampled twice ten seconds apart |
| `npm run routes` | How often the app can say where a mod comes from: 1,127 of 1,516 farm, 222 trade, 167 nothing |
| `npm run bench` | Plan and ladder timings on a real account |
| `npm run slots` | Which arsenal slot indices the player's own EE.log has ever emitted |
| `npm run replay` | The whole EE.log replayed through the parser, reporting only parsed fields |
| `npm run unread-visit` | Whether a visit to an arsenal row the app cannot read has ever happened |

`scripts/panel-states.js` is the odd one out: a browser script rather than a
command. The artboard loads it and it enumerates every state the overlay's column
can be in - the cross product of the panel's own conditionals, both views, at
five resolutions - measuring each one for a crushed row, an overflow, a broken
value in the text, and whether the two lists that clip say how much they cut. It
lives in `scripts/` because the artboard that loads it is gitignored scratch and
this is not: it has found six defects no hand-written sweep did.

---

## Architecture

```
background.html   controller — the only window that talks to GEP or reads EE.log
ingame.html       overlay, in-game only, transparent, Ctrl+K
desktop.html      same shell, native desktop window
```

| Module | Role |
| --- | --- |
| `src/core/gep.ts` | Warframe's game-events client. `match_info.inventory` is a dump of the account — quests, node clears, owned items — with no credentials involved. |
| `src/core/eelog.ts` | Tails `EE.log` for live mission completions. See the privacy note below. |
| `src/core/gentle.ts` | Every outbound read passes through here. See *The gentleness contract*. |
| `src/core/ow.ts` | Promise wrappers over the Overwolf API, plus game lifecycle. |
| `src/data/catalog.ts` | The completionism engine — frontier and leverage. |
| `src/data/vendor/` | Vendored star chart, quest and junction datasets. |
| `src/panels/registry.ts` | Panels register themselves; the shell discovers them. |

### The completionism engine

Two ideas do the work.

**Frontier.** The star chart is a directed graph, so at any moment there is an exact set of nodes you can actually
do next: uncleared nodes with at least one cleared predecessor. Everything deeper is locked, everything behind is
done. Recommending from the frontier makes the advice non-repetitive *by construction* rather than by penalty.

**Leverage.** Among the things you can do, the ones worth doing first are the ones that unlock the most other
things — a transitive count over the graph. A quest gating six further quests genuinely outranks one gating none.

On top of that: quest prerequisites and junction task requirements are resolved into real gates, so nothing is
suggested before it is startable. A junction is only offered once you can reach its origin planet. A quest whose
completion cannot be verified is never recommended at all — the risk of telling you to redo something is exactly
what the panel exists to prevent — and the count of those is shown instead.

### The gentleness contract

GEP reads the game's memory, and hammering Digital Extremes' endpoints risks an IP ban that also blocks logging
into the game. So restraint is enforced structurally, not by convention:

- **GEP is push-only.** `getInfo()` is called exactly once per game session to seed state; there is no polling
  loop anywhere, and the call is guarded so one can't be reintroduced by accident.
- **Every payload is content-hashed.** An update carrying bytes we already hold is dropped before it reaches the
  store, so identical data costs nothing downstream.
- **HTTP reads pass four guards** — cache, single-flight, a per-key minimum interval, and a global token bucket.
  A failed read keeps the stale value and pushes the clock forward, so an outage can't become a retry storm.
- **Conditional requests** (ETag / `If-Modified-Since`) mean an unchanged resource costs a 304 and no body.
- **EE.log replaces polling.** A node cleared mid-session is picked up from the log immediately, so the app never
  asks the game to re-read anything just to notice progress.

`npm run check` asserts all of it. If you loosen a guard, that check is what should fail.

### Adding a panel

One call in `src/panels/panels.ts` plus the module it points at. Nothing else needs editing — the tab rail, routing
and lazy-loading follow.

```ts
registerPanel({
  id: 'market',
  title: 'Market',
  glyph: '⬡',
  order: 1,
  load: () => import('./market/MarketPanel'),
});
```

Panels read account state with `useAccount(...)` and never open their own GEP connection.

---

## The vendored datasets

`src/data/vendor/` holds three files that are **committed rather than fetched**, because:

1. The star-chart unlock graph and the junction task lists exist nowhere in machine-readable form. DE's
   `ExportRegions` has no edges; `ExportKeys` has no prerequisites. They were reconstructed from wiki prose.
2. `wiki.warframe.com` sits behind a Cloudflare JS interstitial, so a runtime fetch returns a challenge page.

| File | Contents |
| --- | --- |
| `nodes.json` | Star chart: every node, its planet/type/levels, and `next`/`prev` edges by InternalName |
| `quests.json` | Every quest, in order, with prerequisites resolved |
| `junctions.json` | All 13 junctions and their exact task lists |

They join to account data on `Missions[].Tag` and `QuestKeys[].ItemType`. Missing files degrade rather than
break — the panel says what it is missing instead of under-reporting.

**Refreshing them** means re-running the research, not adding a network call. Two hard-won lessons:

- **Do not use summarizing fetch tools on the wiki.** Two calls on the same URL returned different, mutually
  inconsistent results — the summarizer cannot handle the `<tabber>` transclusion layout and silently invented
  entries. Use raw wikitext (`index.php?title=X&action=raw`) through a real browser session.
- **DE's junction tags have exceptions.** The Jupiter Junction moved from Ceres to Deimos and was never re-tagged,
  so it is still `CeresToJupiterJunction`. Deriving ids from `from`/`to` silently fails to join. Any id departing
  from the pattern must carry an `idNote`, and `npm run check:data` enforces that.

Always run `npm run check:data` after a refresh. It verifies every graph edge resolves, prerequisites point at
real quests, there are no dependency cycles, and ids match the format the account data actually uses.

## Data sources

| Source | Use | Notes |
| --- | --- | --- |
| GEP `match_info.inventory` | The account itself | Push-delivered, no login |
| GEP `match_info.highlighted` | Hovered item in game | Enables live pricing without OCR |
| `EE.log` | Live mission completions | Node id, name, type, outcome |
| `api.warframestat.us` | Worldstate, item DB | CORS-open |
| `api.warframe.com/cdn/worldState.php` | Official raw worldstate | Needs `externally_connectable` |

Full provenance, verified schemas and rate limits: [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

> ### Privacy
>
> **EE.log contains the account email in plaintext** (on the `Logging in as …` line) and the machine's IP address.
> The parser is an explicit allowlist of line patterns rather than a scanner, redaction is applied to everything
> that escapes the module, and the tail starts at end-of-file so history is never read. Verified against a live
> 46,000-line log: 31 runs extracted, zero PII in any output. **Never log, persist, or transmit a raw line.**

> ### Terms of service
>
> Digital Extremes publishes no allow-list and states plainly that external software is used *"at your own risk"*.
> The EULA bars programs that "collect information about the Game" — broad enough, on its face, to cover even
> read-only polling. The frequent claim that DE blessed Overwolf apps could **not** be verified. Read
> [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) before shipping this to anyone else.
