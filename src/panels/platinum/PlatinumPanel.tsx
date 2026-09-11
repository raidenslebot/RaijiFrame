/**
 * Platinum farming.
 *
 * THE SPINE: given the time you have and what your account can reach, what is
 * the single best use of the next stretch of play — and why.
 *
 * Platinum is not farmed, it is TRADED: almost nothing in the game drops it, so
 * every route is "produce a thing another player buys". Which route is *best*
 * therefore depends on you, not on a leaderboard: the time you have, the content
 * you have unlocked, the trades left today, the capital you hold, and whether
 * you are playing alone. The controls set those, the engine ranks on them, and
 * every route shows exactly which terms moved it.
 *
 * NO PLATINUM FIGURES. Not a price, not a yield, not a plat-per-hour — none can
 * be sourced without a price feed, and a ranking built on invented numbers would
 * look authoritative and be worthless. See src/data/plat-rank.ts.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAccount } from '../../core/store';
import type { RawAccount } from '../../data/account';
import { derive } from '../../data/progression';
import { canonFrom, loadCatalog, type LoadedCatalog } from '../../data/datasets';
import { platPosition } from '../../data/platinum';
import {
  CYCLE_LABEL,
  FAMILY_LABEL,
  PLAT_ROUTES,
  routeState,
  type LiveSignal,
  type RouteFamily,
} from '../../data/plat-routes';
import {
  DEFAULT_PREFS,
  rankRoutes,
  suggestPower,
  type Prefs,
  type Ranked,
  type SessionLength,
} from '../../data/plat-rank';
import { DEMAND_LABEL, guideFor } from '../../data/plat-guide';
import { holdingsOf } from '../../data/plat-value';
import { RelicBrowser } from './RelicBrowser';
import { RouteDetail } from './RouteDetail';
import { SellStock } from './SellStock';
import { SetCompletion } from './SetCompletion';
import { Dispatch, type Progress, type StepState } from './Dispatch';
import type { Order } from '../../ui/ordering';
import { bestPicks } from '../../data/plat-picks';
import { priceGap, setGaps } from '../../data/set-completion';
import { loadRelics, type Relic } from '../../data/plat-value';
import { loadItemDb, type ItemDb } from '../../data/itemdb';
import type { StepContext } from '../../data/plat-steps';
import { priceOfferings, tradeableOfferings } from '../../data/standing-value';
import { autoPrice, type AutoProgress } from '../../data/plat-autoprice';
import { bool, num, oneOf, strSet, usePersisted } from '../../ui/persist';
import { CAPABILITY_LABEL } from '../../data/plat-capability';
import { RUNS_PER_REWARD, priceOffers, tradeableOffers, type InvasionOffer } from '../../data/invasion-value';
import type { Holding } from '../../data/plat-value';
import type { SetVerdict } from '../../data/set-completion';
import { StandingValue } from './StandingValue';
import { DucatEconomy } from './DucatEconomy';
import { HoverPrice } from './HoverPrice';
import { loadOfferings, type Offering } from '../../data/standing-value';
import {
  DEFAULT_PREFERENCE,
  NOTHING_OBSERVED,
  minutesPerRunFor,
  runsTimedFor,
  observe,
  rateAll,
  standingCap,
  standingPerHour,
  type Preference,
  type Rate,
} from '../../data/plat-throughput';
import { recentMissions } from '../../data/history-store';
import type { MissionRecord } from '../../data/missionlog';
import type { Price } from '../../data/market';
import { loadDucats, type DucatDb } from '../../data/ducats';
import { loadMarketCatalog, type MarketCatalog } from '../../data/market';
import { readWorldstate, type Worldstate } from '../../data/worldstate';
import { Chevron } from '../../ui/orokin';
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { staggerFor } from '../../ui/stagger';
import { nextDailyResetUtc } from '../../data/subsystems';
import { CHAMFER, PLATE_COOL as PLATE } from '../../ui/geometry';

const int = (n: number): string => n.toLocaleString();

/**
 * The five ranking weights, so a closed row can say whether any of them has
 * been moved.
 *
 * A disclosure that only says "five sliders live in here" is a label, not an
 * answer - it tells a reader nothing they could not guess from the summary.
 * Whether the ranking they are looking at is the app's or their own is the one
 * fact this section can state without being opened, and it is the fact that
 * decides whether opening it is worth doing.
 */
const WEIGHT_KEYS = ['wantBigTicket', 'wantLowFriction'] as const;
const weightsMoved = (p: Prefs): number => WEIGHT_KEYS.filter((k) => p[k] !== DEFAULT_PREFS[k]).length;

/* Stable identities, so a mismatched account does not hand the memos a new
   array on every render and re-run every ranking underneath them. */
const NO_HOLDINGS: readonly Holding[] = [];
const NO_VERDICTS: readonly SetVerdict[] = [];

function until(iso: string | undefined, now: number): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${String(mins)}m left`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${String(hours)}h left`;
  return `${String(Math.floor(hours / 24))}d left`;
}

/**
 * Which worldstate signals are firing, and the window on each.
 *
 * `set` IS NULL WHEN THE WORLDSTATE HAS NOT BEEN READ, and that is not a
 * nicety. It used to return an empty set, which is the same shape as "nothing
 * is live" - and this very file, two hundred lines below, insists in a comment
 * that those are different answers and that the card must say which. Once a
 * closed window became a hard gate on the estimate rather than a three-point
 * nudge, an empty set would have told every player that every timed route was
 * shut for the seconds before the fetch lands, and permanently if it fails.
 */
function liveSignals(
  ws: Worldstate | null,
  now: number,
): { set: Set<LiveSignal> | null; notes: Map<LiveSignal, string> } {
  const set = new Set<LiveSignal>();
  const notes = new Map<LiveSignal, string>();
  if (!ws) return { set: null, notes };

  const fissures = ws.fissures ?? [];
  if (fissures.length > 0) {
    set.add('fissures');
    const tiers = new Map<string, number>();
    for (const f of fissures) tiers.set(f.tier ?? '?', (tiers.get(f.tier ?? '?') ?? 0) + 1);
    notes.set('fissures', `${String(fissures.length)} open · ${[...tiers].map(([t, n]) => `${t} ${String(n)}`).join(' · ')}`);
  }
  const baro = ws.voidTrader;
  const baroHere = until(baro?.expiry, now);
  if (baro && baroHere) {
    set.add('baro');
    notes.set('baro', `${baro.character ?? 'Baro'} at ${baro.location ?? 'a relay'} · ${baroHere}`);
  }
  const varzia = ws.vaultTrader;
  const varziaHere = until(varzia?.expiry, now);
  if (varzia && varziaHere) {
    set.add('varzia');
    notes.set('varzia', `Prime Resurgence · ${varziaHere}`);
  }
  if (ws.sortie) {
    set.add('sortie');
    notes.set('sortie', `${ws.sortie.boss ?? 'Today'} · ${until(ws.sortie.expiry, now) ?? 'up now'}`);
  }
  if (ws.archonHunt) {
    set.add('archon');
    notes.set('archon', `${ws.archonHunt.boss ?? 'This week'} · ${until(ws.archonHunt.expiry, now) ?? 'up now'}`);
  }
  const inv = (ws.invasions ?? []).length;
  if (inv > 0) {
    set.add('invasions');
    notes.set('invasions', `${String(inv)} running`);
  }
  if ((ws.nightwave?.activeChallenges ?? []).length > 0) {
    set.add('nightwave');
    notes.set('nightwave', `${String((ws.nightwave?.activeChallenges ?? []).length)} acts up`);
  }
  /*
   * DUVIRI, WHICH WAS DECLARED AND NEVER SET.
   *
   * `LiveSignal` has nine members and this function only ever added eight. The
   * two routes that declare `live: 'duviri'` therefore took the ranker's -3
   * "its window is closed" penalty permanently, whatever the world was doing -
   * a route pushed down the list for ever by a signal nobody was raising.
   *
   * Duviri's spiral is ALWAYS running; what rotates is which of the five moods
   * it is in. So the signal is present whenever the cycle is, and the note says
   * which spiral it is rather than counting down to an opening that never
   * closes.
   */
  const duviri = ws.duviriCycle;
  if (duviri) {
    set.add('duviri');
    const mood = typeof duviri.state === 'string' && duviri.state !== '' ? duviri.state : null;
    notes.set(
      'duviri',
      mood === null ? 'The spiral is running' : `${mood[0]?.toUpperCase() ?? ''}${mood.slice(1)} spiral · ${until(duviri.expiry, now) ?? 'now'}`,
    );
  }

  // The Plains night window is what Eidolon hunting waits on.
  const earth = ws.earthCycle as { state?: string; expiry?: string } | undefined;
  const cetus = ws.cetusCycle as { state?: string; expiry?: string } | undefined;
  const night = cetus ?? earth;
  if (night?.state === 'night') {
    set.add('nightCycle');
    notes.set('nightCycle', `Night on the Plains · ${until(night.expiry, now) ?? 'now'}`);
  }
  return { set, notes };
}

/* ------------------------------------------------------------------ controls */

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      /*
        THE HOVER USED TO BE A BRIGHTNESS FILTER AND NOTHING ELSE.

        A filter change is a colour event: it says the pointer is here and
        nothing about the control being a control. Every one of these chips is a
        thing you press, so it now rises toward the cursor and gives under the
        press, from the shared layer, and takes the focus bloom that tells a
        keyboard user where they have landed among twenty of them. The
        brightness stays - it is what makes the chip read as lit rather than
        merely moved.
      */
      className="rf-toggle rf-clipped mo-field mo-lift mo-focusable relative px-3 py-1.5 text-left hover:brightness-125"
      style={{
        clipPath: 'polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 7px 100%, 0 calc(100% - 7px))',
        background: on ? 'oklch(0.30 0.06 235 / 0.55)' : 'oklch(1 0 0 / 0.04)',
      }}
    >
      {on && <span aria-hidden className="absolute right-0 bottom-0 left-0 h-px" style={{ background: 'var(--color-tenno-300)' }} />}
      <span
        className="font-[family-name:var(--font-display)] text-[length:var(--text-nano)] font-semibold tracking-[0.14em] uppercase"
        style={{ color: on ? 'var(--text)' : 'var(--text-faint)' }}
      >
        {children}
      </span>
    </button>
  );
}

function Weight({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={2}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mo-focusable w-full accent-[var(--color-tenno-300)]"
        aria-label={label}
      />
    </label>
  );
}

/* -------------------------------------------------------------------- rows */

/**
 * Signals whose window genuinely shuts, and soon.
 *
 * Fissures, invasions and nightwave are running essentially always, so saying
 * "live" about them tells a reader nothing they did not already assume. Baro is
 * gone for a fortnight, the Eidolon night lasts fifty minutes, and the sortie
 * resets daily - those are worth interrupting someone for.
 */
const SCARCE_WINDOW = new Set<string>(['baro', 'varzia', 'nightCycle', 'sortie', 'archon']);

function RouteRow({
  r,
  open,
  onToggle,
  index,
  chain,
  ctx,
}: {
  r: Ranked;
  open: boolean;
  onToggle: () => void;
  index: number;
  /**
   * Everything the METHOD steps are allowed to answer from.
   *
   * Threaded rather than read here so `resolveStep` stays pure and a check
   * script can pin a moment. Null until the world state lands, which the steps
   * render as themselves rather than as a broken affordance.
   */
  ctx: StepContext | null;
  /*
   * `rate` used to be here: the bare measured figure, passed in beside the
   * chain that already carries it. The row now shows what the ranking is
   * ordered by, which comes off `r.expected`, so the prop was a second source
   * for a number that has one - and the two had already disagreed on screen.
   */
  /**
   * How that rate was arrived at, link by link, or why it could not be.
   *
   * This used to be a SECOND list of the same thirty routes, in its own section
   * further down the page - which is the real reason the panel read as two
   * unrelated tools stacked on top of each other. There is one list now, and
   * the arithmetic lives inside the route it belongs to.
   */
  chain: Rate | null;
}) {
  const { route, status } = r.state;
  const guide = guideFor(route.id);
  const tone =
    status === 'open' ? 'var(--color-signal-good)' : status === 'blocked' ? 'var(--text-muted)' : 'var(--color-signal-warn)';

  return (
    <li
      /*
        rf-lit, not rf-row, and the distinction is deliberate. rf-row would also
        draw a lit edge down the leading side - and this row already has one, in
        the span below, carrying the route's OPEN/BLOCKED tone. Two mechanisms
        fighting over one hairline is the mistake theme.css names in as many
        words. rf-lit is the half that was actually missing: the specular
        response, fed by the same document-level tracker, with no edge of its
        own.
      */
      className="rf-route anim-rise rf-lit relative"
      style={{
        clipPath: CHAMFER,
        background: open ? 'oklch(1 0 0 / 0.055)' : 'oklch(1 0 0 / 0.026)',
        animationDelay: `${String(Math.min(index, 12) * 22)}ms`,
      }}
    >
      <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: r.liveNow ? 'var(--color-tenno-300)' : tone, opacity: 0.85 }} />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="mo-focusable flex w-full items-center gap-3 py-2.5 pr-3 pl-4 text-left"
      >
        <Chevron open={open} />
        <span className="font-[family-name:var(--font-display)] text-[length:var(--text-small)] font-semibold" style={{ color: 'var(--text)' }}>
          {route.name}
        </span>
        {/*
          `live` is only worth saying when it is unusual. Nine rows in ten
          carried this badge, because most worldstate signals are on most of the
          time - and a badge that is almost always lit is not a signal, it is
          furniture. It now marks only the windows that actually CLOSE: a
          fortnightly trader, a nightly cycle, a daily sortie.
        */}
        {r.liveNow && SCARCE_WINDOW.has(route.live ?? '') && (
          <span className="eyebrow shrink-0" style={{ color: 'var(--color-tenno-300)' }}>
            live now
          </span>
        )}
        {/*
          THE GLOSS YIELDS WHOLE, WHICH IS THE RULE THE WALLET STRIP ALREADY
          FOLLOWS TWELVE HUNDRED LINES DOWN.

          Photographed on a real account with the reference pane at 718px: "Sell
          complete sets, not parts" wrapping to two lines with "ASSEMBLED
          PRIM..." beside it, and the row below it reading "WHATEVER YOU BOUGHT
          U...". An ellipsis in the middle of a row reads as the panel being
          broken; the same row without the gloss reads as a row. The route's
          name, what it needs and whether it is open are the data, and this is a
          gloss on the name - so it is the part that goes, and it goes entirely
          rather than being cut off mid-word.

          Measured on the row rather than on the window, because the pane's
          width now follows how many deck cards are open and a viewport
          breakpoint would be guessing at it from two rooms away.
        */}
        <span className="rf-sells eyebrow min-w-0 truncate" style={{ color: 'var(--text-faint)' }}>
          {route.sells}
        </span>
        {/*
          THE NUMBER THE LIST IS ORDERED BY, WHICH IS NOT THE ONE IT USED TO
          SHOW.
          ─────────────────────────────────────────────────────────────────
          The row printed the raw measured rate while the ranking had already
          moved to expected platinum in hand, so a reader saw a route marked
          "172 p/hr" sitting below one marked "25 p/hr" and had no way to tell
          that the first sells slowly and the second does not. A list whose
          visible numbers contradict its own order teaches the reader that the
          order is arbitrary, which is worse than showing no numbers at all -
          and showing no numbers at all is what this row did before that.

          The measured rate has not gone anywhere; it is one press down, in the
          chain, under "of 172 your runs measured".

          A route with no estimate still shows nothing rather than a dash. Most
          rows have none, and forty dashes would be louder than the handful of
          real figures.
        */}
        {r.expected.gatedBy !== null ? (
          <span
            className="eyebrow shrink-0"
            style={{ color: 'var(--color-signal-warn)' }}
            title={r.expected.gatedBy.note}
          >
            pays nothing now
          </span>
        ) : r.expected.perHour !== null ? (
          <span
            className="numeric shrink-0 text-[length:var(--text-micro)]"
            style={{ color: r.expected.atMost ? 'var(--text-muted)' : 'var(--color-orokin-200)' }}
            title={
              r.expected.fromRate === null
                ? 'Expected from your own runs, priced from closed trades'
                : `Measured at ${String(Math.round(r.expected.fromRate))} p/hr from your own runs; this is what reaches you after ${String(r.expected.links.length)} ${r.expected.links.length === 1 ? 'factor' : 'factors'}`
            }
          >
            {r.expected.atMost ? 'up to ' : ''}
            {Math.round(r.expected.perHour).toLocaleString()} p/hr
          </span>
        ) : null}
        {guide && (
          <span className="eyebrow ml-auto shrink-0" style={{ color: 'var(--text-faint)' }}>
            {DEMAND_LABEL[guide.demand]}
          </span>
        )}
        <span className={guide ? 'eyebrow shrink-0' : 'eyebrow ml-auto shrink-0'} style={{ color: 'var(--text-faint)' }}>
          {CYCLE_LABEL[route.cycle]}
        </span>
        {/*
          Owning what the route needs is a FACT the account carries, and it used
          to be prose nobody checked. A route you cannot start says so on the
          row, not three clicks in.
        */}
        {r.cannot !== null && r.gear.some((g) => g.met === false) ? (
          <span className="eyebrow shrink-0" style={{ color: 'var(--color-signal-warn)' }} title={r.cannot}>
            no {r.gear.filter((g) => g.met === false).map((g) => CAPABILITY_LABEL[g.capability].replace(/^an? /, '')).join(', ')}
          </span>
        ) : (
          <span className="eyebrow shrink-0" style={{ color: tone }}>
            {status === 'open' ? 'Open' : status === 'blocked' ? 'Locked' : 'Unconfirmed'}
          </span>
        )}
      </button>

      {/* Rendered, never revealed by a transition: a frozen document timeline
          holds a height transition at its FROM value and the body never shows. */}
      {/*
        Rendered, never revealed by a transition: a frozen document timeline
        holds a height transition at its FROM value and the body never shows.
      */}
      {open && <RouteDetail r={r} chain={chain} guide={guide} ctx={ctx} />}
    </li>
  );
}

/* ------------------------------------------------------------------- panel */

/*
 * Ranking preferences, across a reload.
 *
 * `muted` is a Set and would come back as `{}` through a naive JSON round-trip,
 * quietly un-muting every family the player switched off - so both directions
 * are written out by hand. Every field is bounded on the way back in: a stored
 * value is only ever a suggestion, and a weight of NaN or a session of
 * "banana" must produce the default rather than a broken ranking.
 */
const PREFS_CODEC = {
  encode: (p: Prefs): unknown => ({ ...p, muted: [...p.muted] }),
  decode: (raw: unknown): Prefs => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const power = (r['power'] ?? {}) as Record<string, unknown>;
    const level = (v: unknown, f: 1 | 2 | 3 | 4 | 5): 1 | 2 | 3 | 4 | 5 =>
      ([1, 2, 3, 4, 5] as const).find((n) => n === v) ?? f;
    return {
      session: oneOf(r['session'], ['quick', 'hour', 'evening', 'any'] as const, DEFAULT_PREFS.session),
      solo: bool(r['solo'], DEFAULT_PREFS.solo),
      includeLocked: bool(r['includeLocked'], DEFAULT_PREFS.includeLocked),
      /*
       * `wantLiquid`, `wantLiveNow` and `wantHighRate` are no longer read. A
       * prefs object saved before they were removed still carries them and is
       * still valid - every key here is looked up by name with a default, so an
       * extra one is simply ignored rather than being an error.
       */
      wantBigTicket: num(r['wantBigTicket'], DEFAULT_PREFS.wantBigTicket, 0, 3),
      wantLowFriction: num(r['wantLowFriction'], DEFAULT_PREFS.wantLowFriction, 0, 3),
      muted: strSet(r['muted']),
      power: { frame: level(power['frame'], DEFAULT_PREFS.power.frame), weapons: level(power['weapons'], DEFAULT_PREFS.power.weapons) },
      hideOverGeared: bool(r['hideOverGeared'], DEFAULT_PREFS.hideOverGeared),
    };
  },
};

/** The rate engine's own preferences. `timingOverride` is a Map, so likewise. */
const TEMPO_CODEC = {
  encode: (p: Preference): unknown => ({ ...p, timingOverride: [...p.timingOverride] }),
  decode: (raw: unknown): Preference => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const pairs = Array.isArray(r['timingOverride']) ? r['timingOverride'] : [];
    const overrides = new Map<string, number>();
    for (const pair of pairs) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const [id, mins] = pair as [unknown, unknown];
      if (typeof id === 'string' && typeof mins === 'number' && Number.isFinite(mins)) {
        overrides.set(id, Math.min(120, Math.max(1, mins)));
      }
    }
    const squad = ([1, 2, 3, 4] as const).find((n) => n === r['squad']) ?? DEFAULT_PREFERENCE.squad;
    return {
      squad,
      minVolume: num(r['minVolume'], DEFAULT_PREFERENCE.minVolume, 0, 200),
      includeCapped: bool(r['includeCapped'], DEFAULT_PREFERENCE.includeCapped),
      includeBlocked: bool(r['includeBlocked'], DEFAULT_PREFERENCE.includeBlocked),
      sort: oneOf(r['sort'], ['perHour', 'perTrade', 'liquidity'] as const, DEFAULT_PREFERENCE.sort),
      timingOverride: overrides,
    };
  },
};

/**
 * The five views, as data.
 *
 * They used to be a nested ternary five deep for the name and a second one five
 * deep for the caption, which is how the two drifted apart in the first place.
 * A row here is one view: what it is called and what it is for.
 */
const VIEWS = [
  /*
   * FOUR OF THE FIVE CAPTIONS SAY SOMETHING THE VIEW CANNOT SAY FOR ITSELF -
   * that the sell list is exact before any request goes out, that ducats are a
   * separate currency on their own terms. This one said "ranked against your
   * account and your gear" three lines above a count that reads "44 routes for
   * you" and a disclosure headed "how this list is ordered". Three statements
   * of one fact, stacked, in the space before the first row of the list they
   * are all about. A caption is worth a line when it qualifies; this one only
   * agreed.
   */
  { id: 'routes', name: 'Ways to earn', caption: null },
  {
    id: 'sell',
    name: 'Sell what you hold',
    caption: 'your own stock, ranked by what it is worth \u2014 exactly, before any request goes out',
  },
  { id: 'ducats', name: 'Ducats', caption: 'a separate currency, on its own terms \u2014 every figure here is exact' },
  {
    id: 'standing',
    name: 'Spend your standing',
    caption: 'every syndicate offering in the game, ranked by platinum per thousand standing',
  },
  { id: 'relics', name: 'Relic value', caption: 'expected platinum per crack, from real drop tables and real closed trades' },
] as const;

type ViewId = (typeof VIEWS)[number]['id'];

/**
 * The view strip.
 *
 * WHAT WAS WRONG WITH IT
 * ----------------------
 * Five identical chips in a row, the same size and weight as the eight route
 * family chips and the four squad-size chips below them, with one caption
 * parked at the end of the line describing whichever was selected. Nothing said
 * which of the five you were in except a slightly lighter background, and
 * nothing said that these five were a different KIND of control from the twenty
 * underneath them. Twenty-five identical objects is a texture, not a set of
 * choices.
 *
 * THE HIERARCHY INSTEAD
 * ---------------------
 * The one you are in is set in the title face, two steps up, in gold, over a
 * spine. The other four are small and quiet. The caption moves underneath the
 * active name, because it describes THAT view and belongs to it rather than to
 * the strip. No chips at all: these are places, and the rest of the panel's
 * chips are settings, which is exactly the distinction that was missing.
 */
function ViewStrip({ view, onPick }: { view: ViewId; onPick: (v: ViewId) => void }) {
  const active = VIEWS.find((v) => v.id === view) ?? VIEWS[0];

  return (
    /*
     * A RAIL, NOT A MASTHEAD.
     *
     * This was five tabs laid out across a full-width page with the active one
     * set at `--text-lead` in the title face: a heading, essentially, with four
     * small words beside it. In a pane that is five twelfths of the screen it
     * wrapped to three lines and spent sixty pixels before a single route.
     *
     * So the active tab stops being a headline and becomes a marked item in a
     * row - one line, one size, the gold bar and the ink carrying the state
     * instead of the type size. The caption moves onto the same line, because
     * it qualifies the tab and there is room for it there.
     */
    <div className="flex min-w-0 flex-col gap-1">
      <nav className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {VIEWS.map((v) => {
          const on = v.id === view;
          return (
            <button
              key={v.id}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => onPick(v.id)}
              /* The rule draws itself from wherever the pointer entered, which
                 is what separates a response from an effect. The active view's
                 own gold bar sits two pixels above it, so the two never meet. */
              className="rf-view mo-field mo-underline mo-focusable relative cursor-pointer pb-1"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--text-micro)',
                fontWeight: on ? 600 : 400,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: on ? 'var(--color-orokin-200)' : 'var(--text-faint)',
              }}
            >
              {v.name}
              {on && (
                <span
                  aria-hidden
                  className="absolute right-0 bottom-0 left-0 h-[2px]"
                  style={{ background: 'linear-gradient(to right, var(--color-orokin-300), transparent)' }}
                />
              )}
            </button>
          );
        })}
      </nav>
      {active.caption !== null && (
        <span className="eyebrow truncate" style={{ color: 'var(--text-ghost)' }}>
          {active.caption}
        </span>
      )}
    </div>
  );
}

/**
 * One labelled group of controls, with a rule between it and the next.
 *
 * Every control in this panel used to be the same chip at the same size in one
 * long wrap: session length, playing solo, show locked, squad size and eight
 * route families, indistinguishable from each other and from the five view
 * tabs above them. Twenty-odd identical objects is not a set of options, it is
 * a texture, and the eye cannot find anything in it.
 *
 * The label carries the tier. Naming what a group is FOR turns a wrap of chips
 * into three or four readable fields, and costs one line of type each.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="eyebrow" style={{ color: 'var(--text-ghost)' }}>
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/** The hairline between fields. Vertical where there is room, gone when wrapped. */
function Rule() {
  return <span aria-hidden className="hidden w-px self-stretch sm:block" style={{ background: 'var(--hairline)' }} />;
}

/**
 * WHAT YOU CAN TRADE WITH RIGHT NOW - PINNED, NOT BURIED.
 *
 * Two things were wrong with this where it used to live.
 *
 * It was the SEVENTH section of a two-thousand-nine-hundred-pixel column, so
 * the three numbers every other number on the panel is spent against sat a
 * screen and a half below the recommendations that spend them. It is context,
 * and context that has to be scrolled to is not context.
 *
 * And it was three cards in a FOUR-column grid. The Riven readout was removed
 * for a good reason - recorded below - and `lg:grid-cols-4` was left behind, so
 * the strip has been drawing a permanently empty fourth column ever since. That
 * is the exact shape of "most of the data is empty": not a missing number, a
 * hole where a removal was only half done.
 *
 * It is a STRIP now rather than three stacked cards: label, figure, note on one
 * line each, which is a third of the height and reads left to right the way a
 * status bar does.
 */
function Wallet({
  pos,
}: {
  pos: {
    held: number | null;
    tradable: number | null;
    untradable: number | null;
    tradesLeft: number | null;
    tradesCap: number | null;
    ducats: number | null;
  };
}) {
  /*
   * THE CLAIM DEGRADES, NOT THE NUMBER.
   *
   * Tradable platinum is PremiumCredits minus PremiumCreditsFree, and it is
   * null the moment either is missing. Caught on a real read carrying
   * PremiumCredits 312 and no PremiumCreditsFree at all: the first cell of the
   * panel printed an em dash while the figure it is derived from was sitting
   * in the account. That is the "most of the data is empty" complaint in its
   * purest form - not a number the app cannot know, a number it knows and
   * refuses to say because it cannot say the SHARPER thing.
   *
   * An em dash is the honest rendering of a number nobody has, and it is the
   * wrong rendering of a number nobody has QUALIFIED. So when the split is
   * unknown the cell falls back to the platinum that is known, renames itself
   * to what it is now claiming, and says in its own note which part it could
   * not work out. Nothing is invented: the untradable share is not assumed to
   * be zero, it is stated as unread.
   */
  const splitKnown = pos.tradable !== null;
  const platinum = splitKnown
    ? { label: 'Tradable platinum', value: pos.tradable, sub: pos.untradable ? `${int(pos.untradable)} untradable` : 'yours to trade away' }
    : { label: 'Platinum', value: pos.held, sub: pos.held === null ? 'not read yet' : 'how much is tradable is not in this read' };
  return (
    <section className="anim-rise grid grid-cols-3 gap-[3px]">
      {[
        { ...platinum, tone: 'var(--color-orokin-300)' },
        { label: 'Trades left today', value: pos.tradesLeft, sub: pos.tradesCap === null ? 'resets 00:00 UTC' : `of ${int(pos.tradesCap)}`, tone: undefined },
        { label: 'Ducats', value: pos.ducats, sub: 'Baro’s currency', tone: undefined },
        /*
         * Riven slots deliberately absent. This strip answers "what can I trade
         * with right now"; how many Riven slots are free is a fact about
         * storage, it was almost always a dash, and a dash nobody asked for
         * reads as the panel being broken rather than as an honest absence.
         * THREE columns, because there are three of them - see above.
         */
      ].map((c) => (
        <div
          key={c.label}
          /* rf-lit gives them the pointer light and rf-plate--raise lets them
             come toward the reader on approach; both are already in theme.css
             and neither needs a line of JavaScript. */
          className="rf-plate rf-plate--raise rf-lit relative flex items-baseline gap-2.5 overflow-hidden px-3.5 py-2"
          style={{ clipPath: CHAMFER, background: PLATE }}
          title={`${c.label} — ${c.sub}`}
        >
          <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: c.tone ?? 'var(--text-faint)', opacity: 0.7 }} />
          <div className="eyebrow shrink-0">{c.label}</div>
          <div className="numeric ml-auto text-[length:var(--text-lead)] leading-none 2xl:ml-0" style={{ color: c.value === null ? 'var(--text-muted)' : (c.tone ?? 'var(--text)') }}>
            {c.value === null ? '—' : int(c.value)}
          </div>
          {/*
           * THE GLOSS GOES WHEN THERE IS NO ROOM FOR IT, rather than being
           * truncated. At 1280 each cell is about 345 px and the three parts do
           * not fit: the strip rendered "TRADABLE PLATINUM - YOURS TO ..." with
           * the figure squeezed between them, which reads as the panel being
           * broken rather than as a caption being abbreviated. The label and the
           * figure are the data; this is a gloss on them, so it is the part that
           * yields, and it stays reachable on the plate's own title.
           */}
          <div className="eyebrow ml-auto hidden truncate 2xl:block" style={{ color: 'var(--text-faint)' }}>
            {c.sub}
          </div>
        </div>
      ))}
    </section>
  );
}

export default function PlatinumPanel() {
  const inventory = useAccount((s) => s.inventory);
  const [loaded, setLoaded] = useState<LoadedCatalog | null>(null);
  const [market, setMarket] = useState<MarketCatalog | null>(null);
  const [ducats, setDucats] = useState<DucatDb | null>(null);
  const [offerings, setOfferings] = useState<readonly Offering[]>([]);
  /*
   * The relic tables, loaded here rather than only inside the relic browser.
   * One of the five things a player can do with an evening is crack a relic
   * they already hold, and that answer cannot be produced from an inventory
   * alone - the reward table lives in the vendored drop data.
   */
  const [relicDb, setRelicDb] = useState<readonly Relic[]>([]);
  /*
   * The item catalog, for the per-item flags a holding does not carry.
   *
   * `gentle` persists the PARSED value, so on any session after the first this
   * resolves from cache without a request, and on the first it is one fetch
   * shared with every other panel that wants the same catalog.
   */
  const [items, setItems] = useState<ItemDb | null>(null);

  /*
   * What the two sell views have actually priced, collected here so the day's
   * plan can weigh a set completion against a straight sale. Both report on a
   * CLICK, so nothing here is state synchronised out of a render.
   */
  /*
   * PRICED RESULTS CARRY THE ACCOUNT THEY WERE PRICED FOR.
   *
   * They are a snapshot of an async pass, so they cannot be derived - and left
   * as a bare array they outlived the account that produced them. Clearing the
   * inventory left five confident cards on screen about stock the app no
   * longer had any record of, which is the worst failure this project has a
   * name for: a claim with nothing behind it.
   *
   * Stamping each result with its account and comparing at render is the fix
   * that needs no effect and has no window where the two disagree.
   */
  const [pricedFor, setPricedFor] = useState<{ acc: unknown; rows: readonly Holding[] }>({ acc: null, rows: [] });
  const [verdictsFor, setVerdictsFor] = useState<{ acc: unknown; rows: readonly SetVerdict[] }>({ acc: null, rows: [] });
  const [auto, setAuto] = useState<AutoProgress>({ stage: null, done: 0, total: 0, failedStages: 0 });

  /*
   * The throughput inputs live here because they have TWO readers: the rate
   * engine below, and the route ranker, which now scores against measured
   * rates. Holding them in the child meant the ranker could not see them
   * without a second mission-log read and a second fifty-request price pass.
   */
  const [runs, setRuns] = useState<readonly MissionRecord[] | null>(null);
  const [book, setBook] = useState<ReadonlyMap<string, Price>>(new Map());
  const [invOffers, setInvOffers] = useState<InvasionOffer[] | null>(null);

  const [tempoPref, setTempoPref] = usePersisted<Preference>(
    'plat.tempo',
    DEFAULT_PREFERENCE,
    TEMPO_CODEC.encode,
    TEMPO_CODEC.decode,
  );
  const [ws, setWs] = useState<Worldstate | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [prefs, setPrefs] = usePersisted<Prefs>('plat.prefs', DEFAULT_PREFS, PREFS_CODEC.encode, PREFS_CODEC.decode);

  /*
   * THE PLAYER'S OWN ORDER FOR THE DECK, KEPT.
   * ————————————————————————————————————————————
   * Not stored beside `plat.progress`, which is deliberately thrown away when
   * the day turns because trades come back daily. An arrangement is not about
   * a day: a player who wants the run card first wants it first tomorrow too,
   * so this outlives the reset that clears what was dealt with.
   *
   * Decoded defensively because it is the one persisted value a hand edit or a
   * half-written entry can turn into anything. `arrange` is total over garbage
   * - it can only reorder, never lose - but a non-array here would throw
   * before it ever got there.
   */
  const [deckOrder, setDeckOrder] = usePersisted<Order>(
    'plat.deck.order',
    [],
    (v) => [...v],
    (raw) => (Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []),
  );
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    void loadCatalog().then((c) => {
      if (alive) setLoaded(c);
    });
    /*
     * The market catalogue and the ducat exports are static, cached and
     * persisted, so loading them with the panel costs nothing on a warm start
     * and means the free ranking is ready the moment the tab is opened.
     */
    void loadMarketCatalog().then((c) => alive && setMarket(c));
    void loadDucats().then((d) => alive && setDucats(d));
    void loadOfferings().then((o) => alive && setOfferings(o.all));
    void loadRelics().then((r) => alive && setRelicDb(r.all));
    void loadItemDb().then((db) => alive && setItems(db));
    // The mission log is the timing source for every rate on this panel.
    void recentMissions(500)
      .then((rows) => alive && setRuns(rows))
      .catch(() => alive && setRuns([]));
    void readWorldstate()
      .then((res) => {
        if (alive) setWs(res.value ?? null);
      })
      .catch(() => {
        /* left null: nothing is assumed to be running */
      });
    return () => {
      alive = false;
    };
  }, []);

  const acc = (inventory ?? null) as unknown as RawAccount | null;

  /*
   * Priced results belong to the account they were priced for, and are simply
   * not there for any other one. No effect, no clearing, no window where the
   * cards describe stock the app has no record of.
   */
  const pricedStock = pricedFor.acc === acc ? pricedFor.rows : NO_HOLDINGS;
  const setVerdicts = verdictsFor.acc === acc ? verdictsFor.rows : NO_VERDICTS;
  const picture = useMemo(() => derive(inventory, loaded ? canonFrom(loaded.status, loaded.catalog) : {}, []), [inventory, loaded]);
  const pos = useMemo(() => platPosition(acc), [acc]);
  // `notes` went with the headline card that used to print them; `set` is what
  // the ranking reads to know which windows are open right now.
  const { set: live } = useMemo(() => liveSignals(ws, now), [ws, now]);

  /* Which view you were last on, too: reopening always on "Ways to earn" when
     you live in "Sell what you hold" is its own small friction. */
  const [view, setView] = usePersisted<'routes' | 'sell' | 'ducats' | 'standing' | 'relics'>(
    'plat.view',
    'routes',
    (v) => v,
    (raw) => oneOf(raw, ['routes', 'sell', 'ducats', 'standing', 'relics'] as const, 'routes'),
  );

  /*
   * Syndicate ranks, straight off the account.
   *
   * `Title` is the rank the player has reached with that faction, and it gates
   * which offerings they can actually buy. Absent means unknown, never zero:
   * an account that has not been read must not be told it is locked out.
   */
  const ranks = useMemo(() => {
    const rows = (acc as unknown as Record<string, unknown> | null)?.['Affiliations'];
    if (!Array.isArray(rows)) return null;
    const out = new Map<string, number>();
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const r = row as Record<string, unknown>;
      if (typeof r['Tag'] === 'string' && typeof r['Title'] === 'number') out.set(r['Tag'], r['Title']);
    }
    return out.size > 0 ? out : null;
  }, [acc]);

  /*
   * The power sliders start from the account and are then the player's.
   *
   * Nothing in an account describes a BUILD - it knows what you own and what you
   * have cleared, never how well it is modded. So the account seeds a starting
   * bracket and the sliders are the truth; `suggested` is only used until the
   * player touches them.
   */
  const formaSpent = useMemo(() => {
    const bins = ['Suits', 'LongGuns', 'Pistols', 'Melee'] as const;
    let total: number | null = null;
    for (const key of bins) {
      const rows = (acc as unknown as Record<string, unknown> | null)?.[key];
      if (!Array.isArray(rows)) continue;
      total ??= 0;
      for (const row of rows) {
        const n = (row as { Polarized?: unknown }).Polarized;
        if (typeof n === 'number') total += n;
      }
    }
    return total;
  }, [acc]);

  const suggested = useMemo(() => suggestPower(picture, formaSpent), [picture, formaSpent]);
  const [touchedPower, setTouchedPower] = useState(false);

  /*
   * DERIVED, not written back into state by an effect.
   *
   * Seeding prefs from the account inside a `useEffect` meant setting state as a
   * consequence of rendering, which is the `set-state-in-effect` mistake this
   * codebase has now made three times. The account's suggestion is simply what
   * is USED until the player moves a slider; nothing has to be synchronised,
   * and there is no frame where the two disagree.
   */
  const power = touchedPower ? prefs.power : (suggested ?? prefs.power);


  /*
   * `now` is handed in so the sitting IN PROGRESS is excluded from the session
   * measurement. Without it, opening this four minutes after starting to play
   * would report that you play for four minutes and size the whole plan to it.
   */
  const observed = useMemo(() => (runs === null ? NOTHING_OBSERVED : observe(runs, now)), [runs, now]);

  /*
   * HAVE YOU ALREADY CAPPED OUT TODAY? THE LOG SAYS, AND NOTHING ASKED IT.
   * ————————————————————————————————————————————
   * `SyndicateXp.afterCheckpoint` is parsed from the log on every run and its
   * own doc comment states the rule: below `afterMultiplier` means the daily
   * standing cap has bitten. It was carried on every `MissionRecord` and read
   * by no consumer, so the standing card went on ranking offerings by platinum
   * per thousand standing and telling the player to go and earn it — after the
   * game had already told us they cannot earn any more until the reset.
   *
   * The window starts at the LAST 00:00 UTC, which `nextDailyResetUtc` gives
   * by subtracting a day from the next one. Runs before that belong to a
   * different day's cap and are not evidence about this one.
   */
  const cap = useMemo(
    () => standingCap(runs ?? [], nextDailyResetUtc(now) - 86_400_000),
    [runs, now],
  );

  /*
   * Squad size: a CHOICE, defaulted from behaviour.
   *
   * `plat-throughput.ts` draws the line that a control may hold a choice and
   * never a measurement, and that stands - who you intend to play with is not
   * a fact about you. But a default is not an assertion, and the best available
   * default for "how many of you will there be" is how many of you there have
   * BEEN. So the log wins until the player touches the control, at which point
   * their choice wins for the rest of the sitting.
   *
   * The FACT OF HAVING CHOSEN is persisted along with the choice. It was not,
   * at first, on the theory that each sitting should start from behaviour - but
   * that made the control decorative in exactly the way `persist.ts` was
   * written to prevent: a player who set it to 1 because they play solo got 4
   * back on every reload, for ever, and nothing on screen explained why.
   */
  const [squadTouched, setSquadTouched] = usePersisted<boolean>(
    'plat.squadChosen',
    false,
    (v) => v,
    (raw) => bool(raw, false),
  );
  const tempo = useMemo(
    () => (squadTouched || observed.squad === null ? tempoPref : { ...tempoPref, squad: observed.squad.size }),
    [squadTouched, observed, tempoPref],
  );
  /*
   * `solo` IS THE SAME QUESTION THE LOG ALREADY ANSWERED.
   * ————————————————————————————————————————————
   * Twenty lines above, `tempo.squad` takes its default from `observed.squad` -
   * the median squad size across every run this account has recorded - and only
   * yields to the control once the player touches it. That is the right shape
   * and it was applied to exactly one of the two preferences that ask the same
   * thing.
   *
   * `prefs.solo` stayed a raw `false`, and it is not decorative: it drives −6
   * for a route that needs a squad, −1.5 for one that is much better with one,
   * and +1.5 for one that works alone. So an account whose every recorded run
   * was solo was still being told to go and do the four-player content, while
   * the panel's own squad control had already worked out that they play alone.
   *
   * Same rule, same reason: the log supplies the DEFAULT, the control always
   * wins once touched, and the fact of having touched it is what `squadTouched`
   * already persists.
   */
  const effective = useMemo(
    () => ({
      ...prefs,
      power,
      solo: squadTouched || observed.squad === null ? prefs.solo : observed.squad.size === 1,
    }),
    [prefs, power, squadTouched, observed],
  );

  const rates = useMemo(() => rateAll(observed, tempo, book), [observed, tempo, book]);

  /*
   * The rates as the ranker wants them: route id to platinum an hour, carrying
   * only the ones that actually resolved. A route with no rate is simply absent
   * rather than present with a zero, because "not measured" must not be scored
   * as "measured at nothing".
   */
  const chainById = useMemo(() => {
    const m = new Map<string, Rate>();
    for (const r of rates) m.set(r.routeId, r);
    return m;
  }, [rates]);

  const rateById = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rates) if (r.perHour !== null) m.set(r.routeId, r.perHour);
    return m;
  }, [rates]);


  const ranked = useMemo(
    /*
     * `chainById`, NOT `rateById`. The ranker now needs the whole `Rate` - its
     * trade cost decides how much of an hour's output can be sold today, and
     * flattening each one to a bare `perHour` here was throwing that away one
     * line before the code that needed it.
     */
    () => rankRoutes(loaded?.catalog ?? null, picture, pos, live, effective, acc, chainById, items),
    /*
     * `acc` belongs here: the ranking checks gear and frames against the
     * account, so leaving it out froze those checks on whatever inventory
     * happened to be present at first render.
     *
     * `items` for the same reason one layer down - a frame recommendation
     * cannot tell whether you own the frame until the catalog lands, so a memo
     * that ignored it would keep answering "unknown" for the whole session.
     */
    [loaded, picture, pos, live, effective, acc, chainById, items],
  );

  /*
   * THE SAME RANKING, GROUPED BY THE THING THE PANEL ALREADY KNOWS.
   * ————————————————————————————————————————————
   * Not a re-sort: the families come out in the order their BEST route appears
   * in `ranked`, so the global ranking still decides what a reader meets first.
   * Grouping a ranked list by re-sorting it alphabetically would throw away the
   * ranking, which is the one thing this section is for.
   *
   * `best` is the highest rate in the family, and null when nothing in it has
   * one - which is a real state and not a zero. Several families are worth
   * running and have never been timed by this account, and "best 0 p/hr" would
   * be a claim that they pay nothing.
   *
   * AND IT MUST BE THE SAME NUMBER THE ROWS PRINT. It was not. This read
   * `rateById` - the RAW measured rate, straight off the mission log - while
   * every row under it prints `r.expected.perHour`, which is that rate after
   * the gating factors are applied. Measured on a live launch:
   *
   *     12 ROUTES | Everything else | best 312 p/hr
   *       Arcane helmets .................. up to 109 p/hr
   *       Maroo's weekly Ayatan hunt ...... up to 4 p/hr
   *       ...
   *
   * A header claiming 312 over twelve rows, not one of which shows 312. The
   * comment on `RouteRow` records fixing exactly this contradiction INSIDE a
   * row - "the prop was a second source" - and the fix was never carried up to
   * the group. Two sources for one number is the defect; the header now reads
   * the rows' own.
   */
  const rankedByFamily = useMemo(() => {
    const groups = new Map<RouteFamily, typeof ranked>();
    for (const r of ranked) {
      const f = r.state.route.family;
      const list = groups.get(f);
      if (list) list.push(r);
      else groups.set(f, [r]);
    }
    return [...groups].map(([family, rows]) => {
      let top: number | null = null;
      /*
       * `atMost` rows are ceilings rather than expectations, so a family whose
       * only figures are ceilings gets a ceiling for a header - carried, not
       * dropped, because "up to 109" is still the honest thing to say about it.
       */
      let atMost = false;
      for (const r of rows) {
        const rate = r.expected.perHour;
        if (rate !== null && Number.isFinite(rate) && (top === null || rate > top)) {
          top = rate;
          atMost = r.expected.atMost;
        }
      }
      return { family, rows, best: top, bestAtMost: atMost };
    });
  }, [ranked]);

  /** Whether ANY family has a measured rate - decides if per-family answers say anything. */
  const anyFamilyTimed = rankedByFamily.some((g) => g.best !== null);

  const set = (patch: Partial<Prefs>): void => setPrefs((p) => ({ ...p, ...patch }));
  const toggleFamily = (f: RouteFamily): void =>
    setPrefs((p) => {
      const muted = new Set(p.muted);
      if (muted.has(f)) muted.delete(f);
      else muted.add(f);
      return { ...p, muted };
    });

  const families = [...new Set(PLAT_ROUTES.map((r) => r.family))];

  /*
   * Deliberately NOT taken from `ranked` - the ranker drops these before it
   * scores anything, which is the point. They are read straight off the route
   * table so that a route measured to pay nothing can never be silently missing
   * from both lists.
   */
  /*
   * When Baro next docks, as epoch ms.
   *
   * The feed states it as an ISO string; an unparseable one becomes null rather
   * than NaN, so the countdown is absent instead of nonsense.
   */
  const baroAtMs = useMemo(() => {
    const at = ws?.voidTrader?.activation;
    if (typeof at !== 'string') return null;
    const ms = Date.parse(at);
    return Number.isFinite(ms) ? ms : null;
  }, [ws]);

  /*
   * What the account holds, as market slugs. The set-completion engine works in
   * slugs because that is what the market names parts by.
   */
  const ownedSlugs = useMemo(() => {
    if (!market) return new Set<string>();
    return new Set(holdingsOf(acc as unknown as Record<string, unknown> | null, market, ducats).map((h) => h.slug));
  }, [acc, market, ducats]);

  /*
   * Today's plan: a trade budget filled with the densest actions available.
   *
   * Empty until something has been priced, and that is correct - a plan built
   * from unpriced items would be a list of guesses in the shape of advice.
   */
  /*
   * How long the player has, WITHOUT ASKING THEM.
   *
   * This used to be a four-way toggle defaulting to "any", and "any" is not a
   * length - so out of the box the plan contained no mission at all. The whole
   * earning half of the panel was switched off behind a control nobody had a
   * reason to touch.
   *
   * The log answers it. A sitting is a run of missions with no long gap in it,
   * and how long those last is a measurement of this player, taken over every
   * sitting they have finished. The toggle survives, one surface down, as an
   * override for the evening that is not like the others.
   */
  const measuredMinutes = observed.session?.minutes ?? null;
  const sessionMinutes =
    prefs.session === 'quick' ? 20 : prefs.session === 'hour' ? 60 : prefs.session === 'evening' ? 180 : measuredMinutes;

  /** Where that number came from, in the player's words. Never a bare figure. */
  const sessionNote =
    prefs.session !== 'any'
      ? `Sized to the ${prefs.session === 'quick' ? 'few minutes' : prefs.session === 'hour' ? 'hour' : 'evening'} you asked for`
      : observed.session === null
        ? null
        : observed.session.runs === 1
          ? `Sized to the one sitting you have finished so far — ${String(observed.session.minutes)} minutes. It settles as you play.`
          : `Sized to your own sittings — ${String(observed.session.minutes)} minutes, the median of ${String(observed.session.runs)} you have finished`;

  /*
   * WHAT THE PLAN IS ALLOWED TO TELL YOU TO GO AND DO.
   *
   * The rate engine does not gate on the account at all - it drops routes with
   * no measurable chain and routes a timer caps, and that is all it claims to
   * do. The ranker is the half that knows about quests you have not finished
   * and gear you do not own, and for one release the plan simply did not ask
   * it: three Deimos routes resolve a perfectly good platinum-an-hour from a
   * Survival timing and a live market, so an account that has never landed on
   * Deimos could be told, in the largest type on the page, to go and run
   * Isolation Vaults.
   *
   * That is the single worst failure this panel can have. The list below it
   * would have shown the same route as blocked, which makes it a contradiction
   * as well as a lie. So the plan draws only from routes the ranker says this
   * account can actually run.
   */
  const canRun = useMemo(() => {
    const ok = new Set<string>();
    for (const r of ranked) {
      if (r.cannot !== null) continue;
      if (r.state.status !== 'open') continue;
      if (r.gear.some((g) => g.met === false)) continue;
      ok.add(r.state.route.id);
    }
    return ok;
  }, [ranked]);

  const runnable = useMemo(
    () =>
      rates
        .filter((r) => r.perHour !== null && canRun.has(r.routeId))
        .map((r) => {
          const route = PLAT_ROUTES.find((x) => x.id === r.routeId);
          return {
            routeId: r.routeId,
            name: route?.name ?? r.routeId,
            perHour: r.perHour ?? 0,
            cap: r.cap,
            /*
             * The route table's own words for where it happens. Correct, if
             * general. An earlier version named the node this account runs most
             * of the route's mission types on and called it "where you usually
             * run it" - see `minutesPerRunFor` for why that claim could not be
             * supported by anything in a mission record.
             */
            where: route?.where ?? null,
            minutesPerRun: minutesPerRunFor(r.routeId, observed),
            runsTimed: runsTimedFor(r.routeId, observed),
            hasWindow: route?.live != null,
            // Null live set means unread, and unread is not "not live".
            liveNow: route?.live != null && live !== null && live.has(route.live),
          };
        }),
    [rates, canRun, observed, live],
  );

  /*
   * `planToday` IS NO LONGER CALLED HERE, AND THAT IS A FINDING.
   * ————————————————————————————————————————————
   * Removing the duplicated pricing indicator above left this memo with no
   * consumer at all, which is how it became visible that the panel had stopped
   * rendering the day plan entirely: the whole `plat-plan.ts` ranking ran on
   * every inventory change, every re-price and every session-length change, and
   * the ONLY thing anybody read off it was `plan.actions.length === 0` - used to
   * decide whether to print a progress line the deck was already printing.
   *
   * The five-kind deck (`plat-picks.ts`) superseded it: a plan is one ranking on
   * one axis, which is exactly the shape that made the second suggestion a
   * worse copy of the first, and the deck exists because that was wrong.
   *
   * The module and `check-plat.ts` stay. It is a working, tested ranker and
   * deleting it on the strength of one panel's layout would be throwing away
   * something that took real research. What is removed is the call - work done
   * on every render for a value nobody displays.
   */

  /*
   * THE SET VERDICTS ARE THE PANEL'S, NOT THE SECTION'S.
   *
   * They used to be priced inside `SetCompletion`, which only mounts when the
   * "sell what you hold" view is open - so the card at the top of the panel
   * that answers "is a set worth finishing" could only ever say "nothing is
   * within two parts", however many sets were. The answer existed and the
   * component that computed it was not on screen.
   *
   * The closest few are priced here instead, once, and handed down. `setGaps`
   * already sorts closest-first, so the head of it is where the cheap
   * completions are; each verdict costs one request per missing part plus one
   * for the set, which is why this is the only pass with a cap in single
   * figures.
   *
   * The two audit rules this shape trips are answered rather than silenced.
   * `no-set-state-after-await-in-effect` guards against publishing into a
   * component that has gone: every publish is behind `alive`, cleared by the
   * cleanup. `async-await-in-loop` guards against needless serialisation: here
   * one verdict at a time is deliberate, because it is what paces the pass and
   * what lets each card appear as it lands.
   */
  const gaps = useMemo(() => (market === null ? [] : setGaps(ownedSlugs, market)), [ownedSlugs, market]);

  useEffect(() => {
    if (gaps.length === 0) return;
    let alive = true;
    const shortlist = gaps.slice(0, 8);
    void (async () => {
      for (const gap of shortlist) {
        try {
          const v = await priceGap(gap);
          if (!alive) return;
          setVerdictsFor((prev) => ({
            acc,
            rows: [...(prev.acc === acc ? prev.rows : []).filter((x) => x.setSlug !== v.setSlug), v],
          }));
        } catch {
          if (!alive) return;
        }
      }
    })();
    return () => {
      alive = false;
    };
    /* `acc` is in the list because the verdicts are stamped with it: a pass
       that started under one account must not write its results under another,
       and `gaps` alone does not change when the account does if the two reads
       happen to hold the same parts. */
  }, [gaps, acc]);

  /*
   * WHAT THE ACCOUNT ACTUALLY HAS, for the requirement checks on every card.
   *
   * Standing is per syndicate and never pooled across them - you cannot spend
   * Cetus standing at Necraloid - so the check has to be per tag. A tag absent
   * from this map means it was never read, which is a different fact from
   * holding none, and the map is deliberately left without an entry rather than
   * carrying a zero.
   */
  const standingBy = useMemo(() => {
    const out = new Map<string, number>();
    const rows = (acc as unknown as Record<string, unknown> | null)?.['Affiliations'];
    if (!Array.isArray(rows)) return out;
    for (const row of rows) {
      const r = row as Record<string, unknown> | null;
      const tag = r?.['Tag'];
      const held = r?.['Standing'];
      if (typeof tag === 'string' && typeof held === 'number') out.set(tag, held);
    }
    return out;
  }, [acc]);

  /*
   * Which relic tiers have a fissure open at this minute.
   *
   * Null, not an empty set, when the worldstate has not been read: "no fissures
   * are live" and "we have not looked" are different answers and the card says
   * which. A closed or expired fissure is not live.
   */
  const liveTiers = useMemo(() => {
    const rows = ws?.fissures;
    if (!Array.isArray(rows)) return null;
    const out = new Set<string>();
    for (const f of rows) {
      if (f.active === false) continue;
      if (Date.parse(f.expiry) <= now) continue;
      out.add(f.tier);
    }
    return out;
  }, [ws, now]);

  /*
   * WHAT THE METHOD STEPS ARE ALLOWED TO READ.
   * ————————————————————————————————————————————
   * One object, memoised, handed down to every route's step list. Each step
   * that carries a binding resolves against this at render time rather than the
   * guide holding an answer that could go stale.
   *
   * `relicDb` is the whole relic table and NOT `ownedRelics` below: the join
   * from an account row to a tier needs every relic path the table knows, and
   * handing in only the owned ones would make `relicStock` unable to tell an
   * unheld tier from an unknown one - the exact distinction that module exists
   * to keep.
   *
   * `now` is in the deps on purpose. Every binding prints a countdown and a
   * fissure list whose membership changes as things expire, so this has to
   * recompute on the panel's clock rather than freeze at first paint.
   */
  /*
   * Invasions currently paying something a player can sell.
   *
   * Read live and never cached into a rate: they rotate every few hours, and
   * most of them pay Forma, which nobody can sell.
   */
  const invasionCandidates = useMemo(
    () => tradeableOffers(ws?.invasions, market),
    [ws, market],
  );

  const stepCtx = useMemo<StepContext>(
    () => ({
      ws: ws ?? null,
      inventory: (acc as unknown as Record<string, unknown> | null) ?? null,
      relics: relicDb.length > 0 ? relicDb : null,
      /*
       * NULL WHEN NOT YET COMPUTED, NOT THE EMPTY ARRAY.
       * ————————————————————————————————————————————
       * `pricedStock` and `setVerdicts` collapse to a shared empty constant
       * whenever the priced rows belong to a DIFFERENT account than the one in
       * hand - which is the normal state for the first moments after a read,
       * and every moment before one. Passed straight through, that empty array
       * would reach the step resolvers as the measurement "you hold nothing
       * sellable" and "no set is within two parts", which is a claim about the
       * player made out of a race between two pieces of our own state.
       *
       * So the freshness test is repeated here rather than trusting the value:
       * matched and non-null is a measurement, anything else is unknown.
       */
      holdings: acc !== null && pricedFor.acc === acc ? pricedStock : null,
      sets: acc !== null && verdictsFor.acc === acc ? setVerdicts : null,
      // Filled in per route by RouteDetail; the panel context has no single answer.
      routeId: null,
      prices: book,
      catalog: loaded?.catalog ?? null,
      picture,
      account: acc,
      position: pos,
      observed,
      log: runs,
      items,
      /*
       * NULL WHEN NOTHING COULD HAVE BEEN COMPUTED, NOT THE EMPTY ARRAY.
       * ————————————————————————————————————————————
       * `tradeableOffers` returns `[]` for three different situations: the
       * world state has not landed, the market catalog has not landed, and a
       * rotation where every reward is Forma. Only the last of those is a
       * measurement, and the step resolver needs to say opposite things about
       * them - so the ambiguity is resolved HERE, where the inputs are in hand,
       * rather than guessed at downstream.
       */
      invasionCandidates: ws?.invasions === undefined || market === null || market.failed ? null : invasionCandidates,
      invasionOffers: invOffers,
      now,
    }),
    [
      ws, acc, relicDb, pricedFor.acc, pricedStock, verdictsFor.acc, setVerdicts, book, loaded, picture, pos,
      observed, runs, items, market, invasionCandidates, invOffers, now,
    ],
  );

  /* Which relics this account is actually holding, joined by DE's own path. */
  const ownedRelics = useMemo(() => {
    const held = new Set<string>();
    const misc = (acc as unknown as Record<string, unknown> | null)?.['MiscItems'];
    if (Array.isArray(misc)) {
      for (const row of misc) {
        const t = (row as Record<string, unknown> | null)?.['ItemType'];
        if (typeof t === 'string') held.add(t);
      }
    }
    return held.size === 0 ? [] : relicDb.filter((r) => held.has(r.itemType));
  }, [acc, relicDb]);

  /* Syndicate offerings, joined to the catalogue and to whatever has been priced. */
  const valuedOfferings = useMemo(
    () => (market === null ? [] : priceOfferings(tradeableOfferings(offerings, market, ranks), book)),
    [offerings, market, ranks, book],
  );

  /*
   * FIVE ANSWERS TO FIVE DIFFERENT QUESTIONS.
   *
   * The plan above ranks everything on platinum per trade and is right to: it
   * is filling a trade budget. But the second entry in a single ranking is by
   * construction a slightly worse version of the first, so five of them is one
   * suggestion repeated. These are the best of each KIND instead - a sale, a
   * set, a route, today's standing, a relic - and no two of them compete for
   * the same budget, so none of them is the runner-up to another.
   */
  const slots = useMemo(
    () =>
      bestPicks({
        holdings: pricedStock,
        sets: setVerdicts,
        routes: runnable,
        offerings: valuedOfferings,
        relics: ownedRelics,
        /*
         * THE TWO MEASUREMENTS THAT LET THREE OF THE FIVE CARDS BE COMPARED.
         * ————————————————————————————————————————————
         * `plat-picks` refused to rank its kinds because there was no exchange
         * rate between a trade, an hour, a day's standing and a relic. That is
         * true of trades and false of the other three, and both missing
         * conversions were measurable from the log this panel already holds:
         * how long a fissure takes this player, and how much standing an hour
         * of their play actually banks.
         */
        fissureMinutes: minutesPerRunFor('fissures', observed),
        standingRate: standingPerHour(runs ?? []),
        book,
        ducats,
        tradesLeft: pos.tradesLeft ?? null,
        tradablePlat: pos.tradable,
        heldPlat: pos.held,
        standingBy,
        liveTiers,
        minutes: sessionMinutes,
        pricing: auto.stage !== null,
        pricingFailed: auto.failedStages > 0,
      }),
    [
      pricedStock,
      setVerdicts,
      runnable,
      valuedOfferings,
      ownedRelics,
      book,
      ducats,
      pos.tradesLeft,
      pos.tradable,
      pos.held,
      standingBy,
      liveTiers,
      sessionMinutes,
      auto.stage,
      // Both halves of the pricing state, not just the running half. `stage`
      // alone happens to change on the same ticks today, which is precisely the
      // kind of accident that stops being true after one refactor - and the
      // thing it would silently strand is the outage sentence.
      auto.failedStages,
      /*
       * The two measured conversions the deck now ranks on. Without these the
       * memo would hold its first ordering: a player finishes a session, the
       * log gains thirty runs, and the cards keep the order they were given
       * before any of it happened. The whole point of ranking on measurements
       * is that it moves when the measurements do.
       */
      observed,
      runs,
    ],
  );

  /*
   * Is there anything to recommend at all? A slot carries a `pick` when it has
   * one and a `refusal` when it does not, so this is the deck's own verdict
   * rather than a second opinion about it.
   */
  const hasAnswer = slots.some((sl) => 'pick' in sl);
  /*
   * THE WIDTH GOES WHERE THERE IS SOMETHING TO PUT IN IT.
   *
   * Seven twelfths to the deck and five to the reference is right when the
   * deck is full. It is not always full: a kind opens only when it has a pick,
   * and on a real account one did. Measured at 1680 wide with one card open,
   * the deck held 414 pixels of card in 900 of column - about 470 of nothing -
   * while the reference beside it was truncating the labels it had no room for
   * ("Sell complete sets, not parts" cut to "ASSEMBLE..."). The space was not
   * missing, it was in the wrong column.
   *
   * So the split follows the deck. One card and the reference takes the larger
   * share; two and they share evenly; three or more and the deck is doing the
   * work again and takes it back. The card never drops below the 28rem its own
   * container query needs to set the figure at hero size, so the lead reads as
   * the lead at every one of these.
   *
   * The class strings are written out whole rather than assembled, because
   * Tailwind reads this file as text and an interpolated arbitrary value is a
   * class it never generates.
   */
  const openCount = slots.filter((sl) => 'pick' in sl).length;
  const SPLIT: Readonly<Record<number, string>> = {
    1: 'xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]',
    2: 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]',
  };
  const split = SPLIT[openCount] ?? 'xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]';

  /*
   * WHAT THE HIDDEN CONTROLS ARE ACTUALLY SET TO, in one line.
   *
   * Stated rather than counted: "3 families off" tells a reader that something
   * is filtering their list and not what, which is the worst of both - it
   * raises the question and refuses the answer.
   */
  const controlSummary =
    [
      prefs.session === 'any' ? null : prefs.session === 'quick' ? 'a few minutes' : prefs.session === 'hour' ? 'an hour' : 'an evening',
      tempo.squad === 4 ? null : `squad of ${String(tempo.squad)}`,
      prefs.solo ? 'solo' : null,
      prefs.includeLocked ? 'locked shown' : null,
      prefs.hideOverGeared ? 'over-geared hidden' : null,
      prefs.muted.size === 0 ? null : `${[...prefs.muted].join(', ')} off`,
    ]
      .filter((x): x is string => x !== null)
      .join(' · ') || 'everything, any session length';

  /*
   * WHICH STEPS ARE ALREADY DEALT WITH, AND WHY IT IS STORED WITH A DATE.
   *
   * The app must work with the game closed and remember what it was told, so a
   * step ticked off before alt-tabbing has to still be ticked off afterwards.
   * But trades come back daily, and yesterday's ticks against today's list
   * would silently hide work that is available again - so the record carries
   * the day it belongs to and is dropped whole when the day turns. A stale tick
   * is worse than no tick: it removes a step without saying it did.
   *
   * Keyed by `Action.ref`, never by position, because every price that lands
   * reorders the list.
   */
  const [progress, setProgress] = usePersisted<{ day: string; steps: Progress }>(
    'plat.progress',
    { day: '', steps: {} },
    (v) => v,
    (raw) => {
      if (typeof raw !== 'object' || raw === null) return { day: '', steps: {} };
      const r = raw as Record<string, unknown>;
      const day = typeof r['day'] === 'string' ? r['day'] : '';
      const steps: Record<string, StepState> = {};
      if (typeof r['steps'] === 'object' && r['steps'] !== null) {
        for (const [k, v] of Object.entries(r['steps'] as Record<string, unknown>)) {
          if (v === 'done' || v === 'skipped') steps[k] = v;
        }
      }
      return { day, steps };
    },
  );

  /*
   * THE DAY IS READ AT THE CLICK, NOT AT MOUNT.
   *
   * `now` is a mount-time constant - correct for the rest of this panel, wrong
   * for this. A panel opened at 23:50 UTC and still open at 00:10 would keep
   * yesterday's key: the trades reset, the plan rebuilds for the new day, and
   * yesterday's ticks would be applied to today's list, hiding work that had
   * come back. The mirror image is worse - a step ticked after midnight would
   * be filed under yesterday and silently discarded on the next remount.
   *
   * Warframe's daily reset IS 00:00 UTC, which the rest of this app asserts,
   * so the UTC date is the right key. It just has to be the CURRENT one.
   */
  const dayKey = (at: number): string => new Date(at).toISOString().slice(0, 10);
  const steps: Progress = progress.day === dayKey(now) ? progress.steps : {};

  const markStep = (ref: string, state: StepState): void => {
    const today = dayKey(Date.now());
    setProgress((prev) => ({
      day: today,
      steps: { ...(prev.day === today ? prev.steps : {}), [ref]: state },
    }));
  };

  /*
   * THE PANEL PRICES ITSELF.
   *
   * Six buttons used to stand between opening this and learning anything. They
   * were gates against hammering the market, which the token bucket and the
   * five-minute cache already handle - so they were protecting nothing and
   * costing the panel its whole purpose. Now it starts on open, in the order
   * the reader needs: what you hold first, because the answer at the top rests
   * on it, then the routes.
   */
  useEffect(() => {
    if (!market || market.failed) return;
    return autoPrice(
      acc as unknown as Record<string, unknown> | null,
      market,
      ducats,
      {
        onProgress: setAuto,
        onResult: (r) => {
          if (r.holdings) setPricedFor({ acc, rows: r.holdings });
          /*
           * MERGED, never replaced.
           *
           * Four stages each publish only the quotes THEY fetched, so assigning
           * the last one would wipe the three before it - the relic prices would
           * arrive and the route rates would vanish with them, which reads as
           * the panel forgetting what it had just told you.
           */
          if (r.book) {
            setBook((prev) => {
              const next = new Map(prev);
              for (const [slug, price] of r.book ?? []) next.set(slug, price);
              return next;
            });
          }
        },
      },
      offerings,
      ranks,
      relicDb,
    );
  }, [market, ducats, acc, offerings, ranks, relicDb]);

  /*
   * Invasions price themselves too, and this one is the clearest case of all.
   *
   * There are only ever a handful live, each pays exactly one thing, and the
   * whole section is worthless without the prices - the list is a set of node
   * names and factions until a number arrives. A button here asked the reader
   * to request the only content the section has.
   *
   * The candidates rotate every few hours, so the pass follows them: the effect
   * re-runs when the live set changes and the previous result is left on screen
   * until the new one lands.
   */
  useEffect(() => {
    if (invasionCandidates.length === 0) return;
    let alive = true;
    void (async () => {
      try {
        const rows = await priceOffers(invasionCandidates);
        if (!alive) return;
        setInvOffers(rows);
      } catch {
        /* the section falls back to naming the invasions without a figure */
      }
    })();
    return () => {
      alive = false;
    };
  }, [invasionCandidates]);

  /*
   * DEFECT: this used to be a `useState(false)` that nothing in the file ever
   * set to `true` - the only assignment left was `setInvBusy(false)` in both
   * the success and catch paths above, so the flag could never become true
   * and the "Reading closed trades" branch below was dead code, permanently
   * showing a priced count instead. Setting it synchronously in the effect
   * above (before starting the fetch) is what a busy flag usually wants, but
   * `react-hooks/set-state-in-effect` correctly flags that as an avoidable
   * extra render here - the fact it would track is already sitting in state
   * this component holds: there is no live pass for the current candidates
   * until `invOffers` has landed for them. Deriving it needs no effect
   * change, no extra render and cannot go stale the way a hand-set flag can.
   */
  const invBusy = invasionCandidates.length > 0 && invOffers === null;

  const worthless = useMemo(
    () => PLAT_ROUTES.filter((r) => r.paysNothing !== undefined).map((r) => routeState(r, loaded?.catalog ?? null, picture)),
    [loaded, picture],
  );

  return (
    /*
     * ONE SCREEN, TWO PANES, AND THE PAGE ITSELF DOES NOT MOVE.
     *
     * THE MEASUREMENT THAT FORCED THIS. Driven through a real browser at
     * 1280x720, the panel emitted 2,984 px into a 672 px viewport with nothing
     * expanded and no account read - four and a half screens - and 6,234 px
     * with its nine route families open. The "spend your standing" view was
     * 6,575 px, nine and three quarter screens. Even with every route family
     * muted, so the ranking held nothing at all, it was still 2,204 px: the
     * panel was three and a quarter screens tall with zero recommendations in
     * it. That is not a panel with a lot of content, it is a panel with no
     * shape.
     *
     * AND IT WAS FOUR ANSWERS TO ONE QUESTION. The deck said "spend today's
     * standing, Necramech Vitality, 13 platinum"; a card seven hundred pixels
     * lower said "best use of your next hour: arcane helmets" with no figure at
     * all; the ranked list five hundred pixels below that said "arcane helmets,
     * up to 109 p/hr"; and the invasion section said "Dera Vandal, 9p". Two of
     * them named different routes. Nothing about a flat stack of eight sibling
     * sections stops that happening, because nothing in a flat stack is
     * subordinate to anything else.
     *
     * So the shape is a grid with a fixed height and two panes, and the
     * subordination is structural rather than a promise:
     *
     *   - the WALLET is the strip everything else is measured against, so it is
     *     pinned and never scrolls away;
     *   - the LEFT pane is the ANSWER - one action at a time, from the deck -
     *     and it is always on screen;
     *   - the RIGHT pane is REFERENCE. Forty-four ranked routes, the ducat
     *     table, every syndicate offering: these are things to look up, they
     *     are legitimately long, and they scroll INSIDE their own pane. What
     *     they can no longer do is push the answer off the top of the screen.
     *
     * `min-h-0` on every row and column of the grid is what makes that true and
     * is easy to leave out: a grid child's default `min-height: auto` refuses
     * to shrink below its content, so one missing `min-h-0` anywhere in the
     * chain and the whole thing grows again and the page scrolls exactly as
     * before, with no visible sign that anything is wrong.
     */
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,auto)_minmax(9rem,1fr)] gap-4 p-5">
      <style>{`
        /*
          These transitions may MOVE things, which the note here used to forbid.
          The reasoning it recorded was sound and the scope was wrong: a
          transition cannot be trusted to REVEAL anything on a timeline that
          stops, because a frozen half-revealed thing is a missing thing - but
          every transition below is gated on hover or focus, and a pointer
          cannot be over a window nobody is presenting. Frozen means at rest,
          not half-lit.
        */
        /*
          A LOCAL TRANSITION LIST REPLACES THE LAYER'S, IT DOES NOT ADD TO IT.

          motion.css is unlayered, which puts it above every Tailwind utility
          and above theme.css's @layer components - but a rule in a <style> tag
          in the body is unlayered too, and later in document order, so it wins
          on the tie. Both rules below therefore have to restate every property
          they still want transitioned, or the shared effect silently loses its
          easing and snaps: --mo-on jumping 0 to 1 makes mo-underline appear at
          full width instead of drawing, and mo-lift arrive with no travel. That
          failure is invisible in a diff and obvious in the pixels, which is the
          shape of defect this file's neighbours keep a record of.
        */
        /* Same 24px target floor as rf-act: these were 23.5px tall. */
        .rf-view { min-height: 24px; transition: color 160ms ease-out, --mo-on 240ms cubic-bezier(0.16, 1, 0.3, 1); }
        .rf-view:hover { color: var(--text) !important; }
        .rf-toggle {
          transition:
            filter 160ms ease-out,
            transform 220ms cubic-bezier(0.16, 1, 0.3, 1),
            --mo-on 220ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .rf-route { container-type: inline-size; }
        /*
          The threshold is the row's own content, not a round number: the
          longest route name in the catalogue sets the left half and the three
          state words plus the rate set the right, and below this the gloss is
          the first thing with nothing left to give.
        */
        @container (max-width: 46rem) { .rf-sells { display: none; } }
        @media (prefers-reduced-motion: reduce) { .rf-view, .rf-toggle { transition: none; } }
      `}</style>
      <Wallet pos={pos} />

      {/*
        THE LAYOUT FOLLOWS WHETHER THERE IS AN ANSWER, because a pane reserved
        for an answer that does not exist is the worst thing on the screen.
        ————————————————————————————————————————————
        With nothing read - which is every launch before the game has been run
        once - all five deck kinds refuse, and the answer pane became seven
        twelfths of the window holding six lines of "nothing yet" and eight
        hundred pixels of air. That is not an honest empty state, it is a hole:
        it reads as the panel being broken rather than as the app not knowing
        anything yet.
        ————————————————————————————————————————————
        The reference half does NOT depend on the account. Every route's value,
        every ducat rate, every syndicate offering is worth looking up with the
        game never launched. So when there is nothing to recommend, the
        recommendation collapses to a band and the reference takes the width it
        was already not using.
      */}
      <div className={hasAnswer ? `grid min-h-0 gap-5 ${split}` : 'grid min-h-0 grid-rows-[minmax(0,auto)_minmax(9rem,1fr)] gap-4'}>
        {/*
          THE ANSWER COMES FIRST, AND IT IS NOT A LIST.

          Everything in the other pane is a place to look things up. This is the
          part that tells you what to do, one step at a time, and it is beside
          the navigation rather than under it on purpose: choosing a tab is
          itself a decision, and the player should not have to make one before
          the panel is any use.

          It gets its own scroll rather than the page's. The deck is short - one
          lead card and up to four refusals - so in practice it does not scroll
          at all; what the container guarantees is that if it ever does, it does
          so without moving anything else on the screen.
        */}
        <div className={hasAnswer ? 'flex min-h-0 flex-col gap-4 overflow-y-auto pr-1' : 'flex min-w-0 flex-col gap-4'}>
      <Dispatch
        slots={slots}
        progress={steps}
        order={deckOrder}
        onReorder={setDeckOrder}
        onMark={markStep}
        onReset={(ref) => {
          /*
           * ONE THING BACK, OR ALL OF THEM.
           *
           * Restoring everything was the only option there was, so undoing a
           * single mistaken tap also undid every deliberate one. With a ref it
           * puts exactly that card back and leaves the rest dealt with.
           */
          if (ref === undefined) {
            setProgress({ day: dayKey(Date.now()), steps: {} });
            return;
          }
          setProgress((prev) => {
            const next: Record<string, StepState> = { ...prev.steps };
            delete next[ref];
            return { day: prev.day, steps: next };
          });
        }}
        session={sessionNote}
        pricing={auto.stage === null ? null : { stage: auto.stage, done: auto.done, total: auto.total }}
      />

      {/*
        The live hover. It renders only while the game is running and the cursor
        is on something, so with the game closed it costs exactly one null
        return.
      */}
      <HoverPrice catalog={market} ducats={ducats} />
        </div>

        {/*
          ------------------------------------------------ the reference pane.

          The divider that used to introduce this said "Or look something up",
          which was the right sentence in the wrong dimension: it was a
          horizontal rule with two thousand pixels of lookup under it, so the
          "or" was a promise the layout could not keep. A pane boundary says the
          same thing and enforces it.
        */}
        <div className="flex min-h-0 flex-col gap-3">
      <ViewStrip view={view} onPick={setView} />

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      {view === 'relics' ? (
        <RelicBrowser />
      ) : view === 'sell' ? (
        <div className="flex flex-col gap-5">
          {/*
            While the automatic pass is still running, say so once - quietly,
            and only where the answer will appear. A spinner per section would
            be five spinners saying one thing.
          */}
          {/*
            REMOVED, AND THE COMMENT ABOVE IS WHY.
            ————————————————————————————————————————————
            "A spinner per section would be five spinners saying one thing" was
            the right rule and this was the third violation of it. The deck sits
            directly above this line and already reports the pass in its own
            header; printing it again here put the same sentence twice in one
            viewport, a few hundred pixels apart.

            Measured on the Platinum screen with no account read, the panel was
            stating some version of "we have not read you yet, the quotes are
            coming" EIGHT times, twice of them verbatim. That is what makes a
            screen unreadable - not the amount of information, but one fact
            wearing eight costumes.
          */}

          {/*
            The plan used to be repeated here as a numbered list. It is now the
            agenda at the top of the panel, worked one step at a time - and two
            copies of the same answer, one of them a list to re-read, is exactly
            the shape this panel was rebuilt to stop having.
          */}

          <SetCompletion
            ownedSlugs={ownedSlugs}
            catalog={market}
            tradesLeft={pos.tradesLeft ?? null}
            tradablePlat={pos.tradable}
            priced={setVerdicts}
            onVerdict={(v) => {
              setVerdictsFor((prev) => ({
                acc,
                rows: [...(prev.acc === acc ? prev.rows : []).filter((x) => x.setSlug !== v.setSlug), v],
              }));
            }}
          />
          <SellStock
            account={acc as unknown as Record<string, unknown> | null}
            catalog={market}
            ducats={ducats}
            priced={pricedStock.length > 0 ? pricedStock : null}
            pricing={auto.stage !== null}
          />
        </div>
      ) : view === 'ducats' ? (
        <DucatEconomy
          account={acc as unknown as Record<string, unknown> | null}
          catalog={market}
          ducats={ducats}
          held={pos.ducats}
          baroAtMs={baroAtMs}
          baroWhere={ws?.voidTrader?.location ?? null}
          now={now}
        />
      ) : view === 'standing' ? (
        <StandingValue offerings={offerings} catalog={market} ranks={ranks} cap={cap} />
      ) : (
        <>
      {/*
        THE SECOND ANSWER USED TO BE HERE, AND IT DISAGREED WITH THE FIRST.

        A card titled "Best use of your next hour" sat at the top of this view,
        seven hundred pixels below the deck, and the two named different routes.
        Measured on a cold launch in a real browser, in one frame: the deck said
        "Spend today's standing -> Necramech Vitality -> 13 platinum"; this card
        said "Arcane helmets" and carried NO PLATINUM FIGURE AT ALL; the ranked
        list forty-five pixels of row below it said "Arcane helmets, up to 109
        p/hr". The largest type on the screen stated strictly less than the row
        underneath it, and contradicted the answer above it.

        It was not even ranking by value. `bestNow` returns `ready[0] ?? open[0]
        ?? ranked[0]`, and with no mission log every route falls to the same
        tier and is ordered by `score` - which, with no measured rate to order
        on, is the sum of the two taste sliders. So the headline answer to "what
        is the best use of your next hour" was decided by "one big item over
        many" and "low setup", and it changed its own mind twice in the first
        sixty seconds as the pricing pass landed.

        `Dispatch` is the answer, it is pinned in the other pane, and it states
        a figure. Two answers to one question is worse than either of them
        alone, and the fix for that is not to reconcile them - it is to have
        one. `bestNow` went with it: this card was its only reader, so leaving
        the call in place would have been a second ranking computed for nobody.
      */}
      {/*
        ---- the controls, BEHIND A DOOR ----

        Three hundred and ninety-five measured pixels of chips and sliders sat
        between the reader and the first route: four session lengths, four squad
        sizes, three toggles, two power sliders, a disclosure of weights and
        eight family switches. None of it answers a question the player asked;
        all of it is there for the reader who disagrees with the ranking and
        wants to tune it, which is a thing one does occasionally and not on
        every open.
        ————————————————————————————————————————————
        The summary line is the point of putting it behind a door rather than
        deleting it: a control that is hidden AND silent is a control the player
        cannot know is affecting their list. It states what is actually set, so
        a muted family or a short session is visible without opening anything.
      */}
      <Disclosure
        eyebrow="The ranking's inputs"
        summary="Time, squad, gear and which families to show"
        answer={<span style={{ color: 'var(--text-faint)' }}>{controlSummary}</span>}
      >
      <section className="rf-plate rf-lit anim-rise flex flex-col gap-3 px-4 py-3.5" style={{ clipPath: CHAMFER, background: PLATE, animationDelay: '50ms' }}>
        <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
          <Field label="Time I have">
            {(['quick', 'hour', 'evening', 'any'] as SessionLength[]).map((s) => (
              <Toggle key={s} on={prefs.session === s} onClick={() => set({ session: s })}>
                {s === 'quick' ? 'minutes' : s === 'hour' ? 'an hour' : s === 'evening' ? 'an evening' : 'any'}
              </Toggle>
            ))}
          </Field>

          <Rule />

          <Field label="Squad size">
            {([1, 2, 3, 4] as const).map((n) => (
              <Toggle
                key={n}
                on={tempo.squad === n}
                onClick={() => {
                  setSquadTouched(true);
                  setTempoPref((prev) => ({ ...prev, squad: n }));
                }}
              >
                {String(n)}
              </Toggle>
            ))}
          </Field>

          <Rule />

          <Field label="Showing">
            <Toggle on={prefs.solo} onClick={() => set({ solo: !prefs.solo })}>
              Playing solo
            </Toggle>
            <Toggle on={prefs.includeLocked} onClick={() => set({ includeLocked: !prefs.includeLocked })}>
              Locked routes
            </Toggle>
            <Toggle on={prefs.hideOverGeared} onClick={() => set({ hideOverGeared: !prefs.hideOverGeared })}>
              Hide over-geared
            </Toggle>
          </Field>

          {/*
            No button. The pass runs on open; this only reports where it is,
            and disappears the moment it has nothing left to say.
          */}
          {/*
            Only the FINISHED count, never the running one.

            "35 of 68" while the pass runs is the deck's line to say, and it
            says it at the top of the screen. What this strip can add that the
            deck cannot is the settled total once the pass is over - a different
            fact, worth one line, said in the section it describes.
          */}
          <span className="eyebrow ml-auto" style={{ color: 'var(--text-faint)' }}>
            {auto.stage === null && rateById.size > 0 ? `${String(rateById.size)} routes priced` : ''}
          </span>
        </div>

        {/*
          FOLDED AWAY, and that is the fix.

          Five unlabelled sliders sat open on the default view - no numbers, no
          units, and no way to tell what moving one would do. They are a way to
          disagree with the ranking, which most readers never need and nobody
          needs BEFORE seeing the ranking. Shut by default, the page opens with
          an answer instead of a control panel.
        */}
        <Disclosure
          eyebrow="the ranking's terms"
          summary="Disagree with the ranking? Tune what it cares about"
          answer={
            weightsMoved(prefs) === 0
              ? 'the app is deciding'
              : `${String(weightsMoved(prefs))} of 5 moved by you`
          }
        >
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            {/*
              TWO SLIDERS, NOT FIVE, AND THE THREE THAT WENT WERE THE DISHONEST
              ONES. "Sells quickly", "What is live now" and "Measured rate" all
              weighted terms that are now factors on a platinum estimate: a
              closed window pays nothing rather than three points less, a slow
              seller converts about a third of its haul within the session, and
              the measured rate IS the ranking rather than a term in it. Leaving
              their sliders would have left three controls that move nothing,
              which is worse than having none - the panel's own rule is that a
              control holds a choice and never stands in for a measurement.

              What is left is genuinely taste, and cannot be measured from an
              account: whether you would rather make one sale or six, and how
              much setup you are willing to do before the first drop.
            */}
            <Weight label="One big item over many" value={prefs.wantBigTicket} onChange={(v) => set({ wantBigTicket: v })} />
            <Weight label="Low setup" value={prefs.wantLowFriction} onChange={(v) => set({ wantLowFriction: v })} />
          </div>
        </Disclosure>

        {/* ---- how strong are you ---- */}
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="min-w-[13rem] flex-1">
            <div className="flex items-baseline gap-2">
              <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
                Your frame
              </span>
              <span className="eyebrow" style={{ color: 'var(--color-tenno-300)' }}>
                {DEMAND_LABEL[power.frame]}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={power.frame}
              aria-label="How strong your Warframe build is"
              onChange={(e) => {
                setTouchedPower(true);
                set({ power: { ...power, frame: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 } });
              }}
              className="mo-focusable w-full accent-[var(--color-tenno-300)]"
            />
          </div>
          <div className="min-w-[13rem] flex-1">
            <div className="flex items-baseline gap-2">
              <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
                Your weapons
              </span>
              <span className="eyebrow" style={{ color: 'var(--color-tenno-300)' }}>
                {DEMAND_LABEL[power.weapons]}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={power.weapons}
              aria-label="How strong your weapons are"
              onChange={(e) => {
                setTouchedPower(true);
                set({ power: { ...power, weapons: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 } });
              }}
              className="mo-focusable w-full accent-[var(--color-tenno-300)]"
            />
          </div>

        </div>
        {/* A div, because Clamp is a div and a div inside a <p> closes the
            paragraph early. One line, with the rest a press away. */}
        <div className="text-[length:var(--text-nano)] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
          <Clamp lines={1}>
            {suggested && !touchedPower
              ? `Started from your account — mastery rank, how much of the chart you have cleared, and Forma spent. Nothing in an account describes a build, so correct it if it is wrong.`
              : `A build is only as strong as its weaker half, so routes are judged against ${DEMAND_LABEL[Math.min(power.frame, power.weapons) as 1 | 2 | 3 | 4 | 5].toLowerCase()}.`}
          </Clamp>
        </div>

          <Field label="Route families — switch off what you never run">
            {families.map((f) => (
              <Toggle key={f} on={!prefs.muted.has(f)} onClick={() => toggleFamily(f)}>
                {FAMILY_LABEL[f]}
              </Toggle>
            ))}
          </Field>
      </section>

      </Disclosure>

      {/* ---- the ranking ---- */}
      <section className="anim-rise" style={{ animationDelay: '150ms' }}>
        <div className="mb-2 flex flex-wrap items-baseline gap-3">
          {/* Scroll-driven, so there is no clock in it to freeze: the heading
              drifts a little slower than the list it belongs to, which is what
              makes a long section read as layered rather than flat. Transform
              only, and a section never scrolled to simply has its heading a few
              pixels high. */}
          {/*
            "RANKED FOR YOU" WAS THE SEVENTH HEADING BEFORE THE FIRST ROUTE.

            Counted on a real account, the reference pane opened with: the view
            rail (two lines, because five tabs wrap), its caption "ranked
            against your account and your gear", the ranking's inputs with its
            own summary, this heading, the route count, and "how this list is
            ordered" with its own answer. Seven lines of label above one line of
            content - the headings outnumbered the thing they head.

            This one is the cut, because it is the only one that says nothing
            the reader does not already have: the rail's active tab names the
            view, and what the ranking is against is in the count itself. The
            count carries the section, which is what a heading is for when the
            content is a list of exactly that many things.

            Written first as "Ranked for you" shortened to "Ranked", which was
            the defect surviving its own fix: a single word in the heading
            colour, orphaned to the left of the count, meaning nothing on its
            own and repeating the count when read with it.
          */}
          <span className="eyebrow" style={{ color: 'var(--color-orokin-200)' }}>
            {/*
              "35 shown, 49 known" invited the obvious question and answered
              none of it: the fourteen missing were ducat routes, measured-
              worthless ones and whatever families are muted. Now the line only
              claims what it can account for.
            */}
            {String(ranked.length)} routes for you
            <span style={{ color: 'var(--text-faint)' }}>
              {worthless.length > 0 && <> · {String(worthless.length)} checked and ruled out below</>}
            {/*
              SAID ONCE, HERE, RATHER THAN EIGHT TIMES BELOW.

              Grouping the list gave every family an answer, and with no run
              measured yet every one of those answers was the same four words.
              Eight rows saying "no measured rate yet" is the wall this grouping
              existed to remove, rebuilt out of the fix.
            */}
              {rankedByFamily.length > 0 && rankedByFamily.every((g) => g.best === null) && (
                <> · none timed yet, so no family has a rate to compare</>
              )}
            </span>
          </span>
        </div>

        {/*
          THE SECTION INTRO, NESTED.

          It was four sentences of grey type between the heading and the list -
          the longest single block on the panel, sitting where the eye is
          already travelling to the first row. The closed summary carries the
          one thing it existed to say, so a reader who never opens it has still
          been told what the order means; the qualifications are one press down.
        */}
        <div className="mb-3">
          {/*
            THIS COPY SAID "RANKED BY FIT, NOT BY PAYOUT" AND IT HAD JUST STOPPED
            BEING TRUE.
            ────────────────────────────────────────────────────────────────────
            It was accurate about a ranking that was one sum of preference
            weights, in which the measured rate was a term worth at most
            eighteen points and switched off by default. The list is now ordered
            by platinum an hour that would actually reach the player, so the
            sentence was describing the previous release to somebody looking at
            this one - and a wrong explanation of an ordering is worse than
            none, because the reader trusts it and then cannot make the list
            make sense.

            Caught by reading the panel rather than by any check. Nothing in the
            suite can know that a paragraph has come loose from the code it
            describes.
          */}
          <Disclosure
            eyebrow="how this list is ordered"
            summary="By what you would actually hold, per hour"
            answer="measured first, guesses in their own group, never an invented figure"
            depth={0}
          >
            <p className="wf-prose">
              Where your own runs and real closed trades produced a rate, the list takes that rate and subtracts what
              would not reach you tonight &mdash; the share of runs your gear finishes, how much of the haul sells
              inside one session, and how many trades you have left to sell it with. What is left is the order.
            </p>
            <p className="wf-prose mt-2">
              Routes nobody has run yet cannot be given a figure, so they are not mixed in with the ones that have one.
              They sit in their own group below, ordered by how much of whatever they pay you would keep. A route that
              pays nothing right now &mdash; a closed window, or longer than the time you said you have &mdash; sits
              below both, and says which.
            </p>
            <p className="wf-prose mt-2">
              Open any route to see every factor that came off its rate, and open a factor to see the claim it makes.
            </p>
          </Disclosure>
        </div>

        {/*
          FORTY-FOUR ROWS IN ONE COLUMN IS NOT A LIST, IT IS A WALL.
          ————————————————————————————————————————————
          Measured on the rendered page: 44 rows at 45px each, a 2,215px section
          - two and a half screens of flat list - carrying ONE disclosure in the
          whole thing. Every row spends five or six lines on its name, its
          window, what it pays, the gear it needs and the time it takes, and
          forty-four of those in a column is a texture rather than a ranking.

          The grouping already existed and was only being used to FILTER: every
          route carries a family, and the strip above this list switches
          families off. So the list is grouped by the thing the panel already
          understands, and each family states its own best rate on the closed
          row - which is the number anybody scanning a family actually wants.

          Only the first family opens. The ranking is global, so the family
          holding the best route is the one worth reading first, and the rest
          are one press each. A reader who opens nothing still sees eight lines
          that each name a family and its best rate, instead of forty-four rows
          that name themselves.
        */}
        <div className="flex flex-col gap-1.5">
          {rankedByFamily.map((g, gi) => (
            <Disclosure
              key={g.family}
              defaultOpen={gi === 0}
              eyebrow={`${String(g.rows.length)} ${g.rows.length === 1 ? 'route' : 'routes'}`}
              summary={FAMILY_LABEL[g.family]}
              /*
                An answer ONLY where it distinguishes this family from its
                siblings. When nothing has been timed the section heading says
                so once; repeating it per family would restate one fact eight
                times, which is what grouping the list was meant to stop.
              */
              answer={
                g.best !== null ? (
                  <span className="numeric" style={{ color: 'var(--color-tenno-200)' }}>
                    {/* "best up to 109" if the row it came from is a ceiling: the
                        header must not promote a ceiling to an expectation. */}
                    best {g.bestAtMost ? 'up to ' : ''}
                    {String(Math.round(g.best))} p/hr
                  </span>
                ) : anyFamilyTimed ? (
                  <span style={{ color: 'var(--text-ghost)' }}>not timed yet</span>
                ) : undefined
              }
            >
              <ul className="flex flex-col gap-[3px]">
                {g.rows.map((r, i) => (
                  <RouteRow
                    key={r.state.route.id}
                    r={r}
                    index={i}
                    chain={chainById.get(r.state.route.id) ?? null}
                    open={open === r.state.route.id}
                    ctx={stepCtx}
                    onToggle={() => setOpen(open === r.state.route.id ? null : r.state.route.id)}
                  />
                ))}
              </ul>
            </Disclosure>
          ))}
        </div>
      </section>

      {/* ---- invasions worth running, right now ---- */}
      {invasionCandidates.length > 0 && (
        <section className="rf-plate rf-lit anim-rise relative px-5 py-4" style={{ clipPath: CHAMFER, background: PLATE, animationDelay: '170ms' }}>
          <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[3px]" style={{ background: 'var(--color-tenno-300)' }} />
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="eyebrow">Invasions worth running now</span>
            <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
              {String(invasionCandidates.length)} of the live ones pay something you can sell
            </span>
          </div>

          {/* The cost per reward is the fact a reader needs before the list;
              the rest is why this section cannot carry a per-hour rate, which
              is a question you only ask once. */}
          <div className="mt-2">
            <Disclosure
              accent="var(--color-tenno-300)"
              eyebrow="what a reward costs"
              summary={`${String(RUNS_PER_REWARD)} missions on one side, per reward`}
              answer="no standing rate exists"
            >
              <p className="wf-prose">
                Invasions rotate every few hours and most pay Forma, which nobody can sell &mdash; so there is no
                standing rate for &ldquo;invasions&rdquo;, only the question of which ones are worth it at this moment.
              </p>
              <p className="wf-prose mt-2">
                Ones paying nothing tradeable are left out rather than listed at zero.
              </p>
            </Disclosure>
          </div>

          <p className="eyebrow mt-3" style={{ color: invBusy ? 'var(--color-orokin-300)' : 'var(--color-signal-good)' }}>
            {invBusy ? 'Reading closed trades' : `${String((invOffers ?? []).length)} priced`}
          </p>

          <ul className="rf-staged mt-3 flex flex-col gap-[3px]" style={staggerFor(10)}>
            {(invOffers ?? invasionCandidates).slice(0, 10).map((o) => (
              <li
                key={`${o.node}-${o.faction}-${o.slug}`}
                className="rf-row flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3.5 py-2"
                style={{ clipPath: CHAMFER, background: 'var(--plate-lift)' }}
              >
                <span className="text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
                  {o.count > 1 ? `${String(o.count)} × ` : ''}
                  {o.item}
                </span>
                <span className="eyebrow truncate" style={{ color: 'var(--text-faint)' }}>
                  {o.node} · side with the {o.faction}
                </span>
                <span className="ml-auto shrink-0" />
                <span className="eyebrow shrink-0" style={{ color: 'var(--text-ghost)' }}>
                  {String(RUNS_PER_REWARD)} missions
                </span>
                <span
                  className="numeric w-20 shrink-0 text-right text-[length:var(--text-small)]"
                  style={{ color: o.worth === null ? 'var(--text-ghost)' : 'var(--color-orokin-200)' }}
                >
                  {o.worth === null ? (invOffers ? 'no trades' : '—') : `${Math.round(o.worth).toLocaleString()}p`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- the routes that pay nothing, said out loud ---- */}
      {worthless.length > 0 && (
        <section className="anim-rise" style={{ animationDelay: '190ms' }}>
          <div className="mb-2 flex flex-wrap items-baseline gap-3">
            <h2
              className="mo-parallax font-[family-name:var(--font-title)] text-[length:var(--text-small)] tracking-[0.26em] uppercase"
              style={{ color: 'var(--text-muted)' }}
            >
              Pays nothing tradeable
            </h2>
            <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
              {String(worthless.length)} checked and ruled out
            </span>
          </div>
          <div className="mb-3">
            <Disclosure
              accent="var(--text-muted)"
              eyebrow="why these are listed at all"
              summary="Checked and ruled out, not overlooked"
              answer="none of them earns platinum"
            >
              <p className="wf-prose">
                Each was checked against the full market catalogue and against DE&rsquo;s own drop tables, and each
                pays only things that stay on your account.
              </p>
              <p className="wf-prose mt-2">
                Several are excellent for your own power. That is a different question from this one.
              </p>
            </Disclosure>
          </div>
          <ul className="flex flex-col gap-[3px]">
            {worthless.map((st) => (
              <li key={st.route.id} className="rf-lit relative px-3.5 py-2.5" style={{ clipPath: CHAMFER, background: 'oklch(1 0 0 / 0.022)' }}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span
                    className="font-[family-name:var(--font-display)] text-[length:var(--text-small)] font-semibold"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {st.route.name}
                  </span>
                  <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
                    {st.route.where}
                  </span>
                </div>
                {/*
                  A DIV, NOT A PARAGRAPH, AND THAT IS NOT COSMETIC.

                  Clamp renders a div, and a div inside a <p> makes the parser
                  close the paragraph early - the "more" control then lands
                  outside the block it belongs to. Same reason as the thirteen
                  found elsewhere in this app.

                  One line each. Twelve of these reasons stacked at full length
                  was the second-largest wall on the panel, and the first line
                  of every one of them already names what the route pays.
                */}
                <div className="mt-1 max-w-[86ch] text-[length:var(--text-nano)] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
                  <Clamp lines={1}>{st.reason}</Clamp>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
        </>
      )}
      </div>
        </div>
      </div>
    </div>
  );
}
