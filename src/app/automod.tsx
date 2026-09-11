/**
 * The auto-modding overlay: a second in-game window covering the game's client
 * area, reading the modding-screen session the background controller folds out
 * of EE.log (`data/automod-session.ts`) and the plan the optimiser computes.
 *
 * THE SHAPE, AND THE TWO IT REPLACED
 * ----------------------------------
 * The first version was a grey rectangle of text rows. The second was a 300 px
 * strip in the Upgrades screen's one empty column, showing a single card at a
 * time. Both were the wrong SIZE of idea: the brief asks for a "full
 * comprehensive and complete" overlay, "extremely elaborate" and "seamlessly
 * integrated", and a gutter strip showing one mod is none of those. Unobtrusive
 * means it must not fight the game or take its input - not that it must be small.
 *
 * So the overlay covers the whole screen and paints almost none of it:
 *
 *   1. THE GRID. The perfect build, drawn into the game's OWN eight mod-slot
 *      rectangles (`data/automod-place.ts`, measured off the player's capture)
 *      in the game's own card (`ui/ModCard.tsx`, traced off the same capture).
 *      A slot already holding the right mod at the right rank is left alone
 *      with a small mark: the game's card is underneath and covering it with a
 *      copy would be worse than useless.
 *   2. THE ASIDE, in the one column the screen leaves empty - what this build is
 *      worth against its ceiling, what finishing it costs, and the mods the
 *      account does not own, which have no slot to sit in yet.
 *
 * IT TAKES NO INPUT FROM THE GAME. The window runs `InputPassThrough`, so every
 * click and key reaches the game as well - the player can move, fire and drag
 * mod cards with the overlay up - and the body sets `pointer-events: none` so
 * only its own controls are targets.
 *
 * COST. Imports no panel, no store, no backdrop. Nothing runs on a timer; the
 * only per-frame work is the figure's count-up, for 420 ms after a change.
 */

import { StrictMode, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { IDLE, netEdits, NO_PURSE, SLOT_CATEGORY, type AutomodState, type Edit } from '../data/automod-session';
import { MEASURED_AT, asideBox } from '../data/automod-place';
import { itemIdentity, stillToDo } from '../data/automod-publish';
import type { NextStep, Placed, Plan, Rung } from '../data/optimise';
import type { LadderEnd } from '../data/automod-session';
import { afford } from '../data/fusion';
import { routeRank, routeShort, routeText } from '../data/acquire';
import { formaPolarities } from '../data/forma';
import { slotState } from '../ui/ModGrid';
import { ModCard } from '../ui/ModCard';
import { onWindowStateChanged, WINDOW } from '../core/ow';
import '../styles/theme.css';
import '../styles/motion.css';
import '../styles/automod.css';

/*
 * THE FEED. The background window owns the log tail and publishes `automodFeed`
 * on its own `window`, the way it publishes `codexStore`; this window reads it
 * through `getMainWindow()`. Outside Overwolf - the dev lab, a screenshot pass
 * - there is no main window, so this page publishes a settable feed of its own
 * and a REAL session can be handed to it from the console.
 */
interface SessionFeed {
  get: () => AutomodState;
  subscribe: (fn: () => void) => () => void;
  /** The close control. Hides the window for the session; the hotkey brings it back. */
  mute?: () => void;
  set?: (s: AutomodState) => void;
}

function backgroundFeed(): SessionFeed | null {
  try {
    const main = (globalThis as { overwolf?: { windows: { getMainWindow: () => Window } } }).overwolf?.windows.getMainWindow();
    return (main as unknown as { automodFeed?: SessionFeed } | undefined)?.automodFeed ?? null;
  } catch {
    return null;
  }
}

/*
 * ONE feed per page, resolved at module scope. Resolving it inside a state
 * initializer looked equivalent and was not: StrictMode runs initializers
 * twice, so the page published one local feed on `window` and rendered from
 * the other, and a session handed to the console's feed reached nothing.
 */
const FEED: { feed: SessionFeed; live: boolean } = (() => {
  const remote = backgroundFeed();
  if (remote) return { feed: remote, live: true };
  let state: AutomodState = { session: IDLE, build: null, plan: null, planAssumed: [], purse: NO_PURSE, ladder: [], ladderEnd: 'complete' };
  const listeners = new Set<() => void>();
  const local: SessionFeed = {
    get: () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set: (s) => {
      state = s;
      for (const fn of listeners) fn();
    },
  };
  (window as unknown as { automodFeed: SessionFeed }).automodFeed = local;
  return { feed: local, live: false };
})();

function useAutomod(): AutomodState & { live: boolean } {
  const state = useSyncExternalStore(FEED.feed.subscribe, FEED.feed.get, FEED.feed.get);
  return { ...state, live: FEED.live };
}

/** Stop rendering the moment Overwolf hides this window; a hidden window's idle cost is undocumented. */
function useHiddenGate(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(
    () =>
      onWindowStateChanged(WINDOW.automod, (s) => {
        setHidden(s === 'hidden' || s === 'closed');
        if (s !== 'hidden' && s !== 'closed') rebindIfTheBackgroundRestarted();
      }),
    [],
  );
  return hidden;
}

/**
 * IF THE BACKGROUND PAGE RESTARTED, THIS PAGE IS BOUND TO A CORPSE.
 *
 * `FEED` is resolved once, at module scope, from `getMainWindow().automodFeed`.
 * An Overwolf window outlives its background page - a crash, an extension
 * reload, an auto-refresh in development - and this page is only reloaded when
 * the window is CLOSED, not when it is hidden. So after a background restart
 * the overlay can come back up still holding the old page's feed object:
 * `get()` returns the last state it ever saw, and `subscribe()` registers a
 * listener on a Set nothing will ever iterate again. The overlay sits there
 * showing a plan for a weapon the player put away, and every route out still
 * works, so nothing looks broken from the controller's side.
 *
 * It is the same class of mistake as `stripShown`: a reference held across a
 * lifetime it does not control. The controller's half of that was fixed with a
 * startup reconciliation; this is the page's half.
 *
 * Reloading is the right repair rather than rebinding in place. The page holds
 * no state worth keeping - every figure it shows comes from the feed - and
 * `useSyncExternalStore` is given a stable store at module scope, so swapping
 * it underneath would mean lifting the whole feed into React state to serve a
 * case that happens once in a session at most.
 */
function rebindIfTheBackgroundRestarted(): void {
  if (!FEED.live) return; // the local feed, used by the lab; nothing to rebind to
  const now = backgroundFeed();
  if (now && now !== FEED.feed) {
    console.warn('[automod] the background page restarted; reloading so the overlay is not showing a dead feed');
    window.location.reload();
  }
}

/**
 * The window covers the game's client area, so THE WINDOW IS THE AREA - no
 * message from the controller is needed and none can go stale. It follows a
 * resolution change because the controller re-places the window and the resize
 * lands here.
 */
function useArea(): { width: number; height: number } {
  const [area, setArea] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const on = () => setArea({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return area;
}

/**
 * A NUMBER, OR A DASH - NEVER "NaN" AND NEVER A SIDEWAYS EIGHT.
 *
 * `Math.round(NaN).toLocaleString()` is the string "NaN", and
 * `Infinity.toLocaleString()` is "\u221E". Fed a degenerate score, this overlay
 * printed SUSTAINED DPS NaN and ENDO NaN CR NaN on top of the player's game -
 * measured, not imagined - and the whole doctrine of this app is that it never
 * shows a number it cannot stand behind. A figure it cannot compute is a figure
 * it does not have, and the honest rendering of a thing it does not have is the
 * same em dash the rest of the overlay uses for an unread purse.
 *
 * This is the LAST boundary rather than the first: the arithmetic upstream is
 * guarded too. It sits here because this is the function every figure passes
 * through, and a guard anywhere else is one a future path can miss.
 */
const figure = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '\u2014');

/**
 * A FIGURE THAT MOVES WHEN THE BUILD DOES.
 *
 * The payoff of the whole loop: the overlay says "rank this, +784", the player
 * does it, and the damage figure has to be SEEN to go there - a number that
 * silently swaps has not told anybody they succeeded. The game counts its own
 * arsenal figures for exactly this reason.
 *
 * It does not run on mount, lands EXACTLY on the target, uses the same 420 ms
 * curve as the meter beside it so the two arrive together, and collapses to a
 * single step under reduced motion.
 */
const SETTLE_MS = 420;
/** The `--rf-settle` shape: most of the distance early, a long quiet landing. */
const settleEase = (t: number) => 1 - Math.pow(1 - t, 3);

const QUIET = typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)');
function subscribeQuiet(fn: () => void): () => void {
  QUIET?.addEventListener('change', fn);
  return () => QUIET?.removeEventListener('change', fn);
}
const readQuiet = () => QUIET?.matches ?? false;

function useCountUp(value: number): number {
  /*
   * A non-finite target never enters the animation. The count-up interpolates
   * `from + (to - from) * t`, and with `to` as NaN every intermediate frame is
   * NaN as well - so the guard at the render boundary would be showing a dash
   * for the whole 420 ms rather than only at the end.
   */
  const target = Number.isFinite(value) ? value : 0;
  const quiet = useSyncExternalStore(subscribeQuiet, readQuiet, () => false);
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const start = from.current;
    if (quiet || start === target) {
      from.current = target;
      return;
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / SETTLE_MS);
      if (t >= 1) {
        from.current = target;
        setShown(target);
        raf.current = null;
        return;
      }
      setShown(start + (target - start) * settleEase(t));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    /*
     * THE BACKSTOP. `requestAnimationFrame` does not fire while a document is
     * unpresented, and an Overwolf overlay is unpresented often. A stalled tween
     * would leave a STALE damage figure on screen, which is strictly worse than
     * no animation, so a plain timer lands the true value whether or not a
     * single frame was ever drawn.
     */
    const land = setTimeout(() => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      from.current = target;
      setShown(target);
    }, SETTLE_MS + 80);
    return () => {
      clearTimeout(land);
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      from.current = target;
    };
    // `target` is derived from `value`, so depending on it is the same trigger
    // stated the way the linter can verify.
  }, [target, quiet]);

  /*
   * A FIGURE IT CANNOT COMPUTE COMES BACK UNCHANGED, so `figure` renders the
   * dash. Substituting zero here would be worse than the NaN it replaced: NaN
   * is obviously broken, and "0" is a claim - that the build does no damage at
   * all - stated in the same typeface as every figure the app stands behind.
   * The animation still runs against the guarded `target`, because
   * interpolating toward NaN makes every intermediate frame NaN too.
   */
  if (!Number.isFinite(value)) return value;
  return quiet ? target : shown;
}

function Figure({ value, className }: { value: number; className?: string }) {
  return <span className={className}>{figure(useCountUp(value))}</span>;
}

/**
 * WHAT IS MISSING: THE COUNT, AND THE ONE TO DO TONIGHT.
 *
 * THE MEASUREMENT THAT DECIDED THIS SHAPE
 * ---------------------------------------
 * This was a list of every missing mod with its route, and it kept running out
 * of column. The aside is the screen's own empty space - 292 x 263 px at
 * 1680 x 1050, and only 292 x 180 at 1280 x 720 - and it cannot grow without
 * covering the game, which is the one thing the overlay may never do.
 *
 * Measured at the worst case a build can actually produce (eight mods missing,
 * a price line, a four-polarity Forma line, a long weapon name, the footer):
 * four of the eight fitted at 720p, six at 1050p. Two rounds of making the rows
 * smaller bought one more row each and did not change the answer. A list of
 * eight does not fit a box that holds four, and no amount of typography will
 * make it.
 *
 * SO THE LIST IS NOT WHERE THE ANSWER LIVES
 * -----------------------------------------
 * Every missing mod belongs to one of the eight grid slots, the slot is on
 * screen, and `ModGrid` already draws its name there. It now draws the route
 * there too. So all eight are named AND routed, simultaneously, at every
 * resolution - and repeating them here would only be a second copy competing
 * for a box too small to hold it.
 *
 * What the grid CANNOT say is which one to do first: it is a layout, and the
 * ordering - fewest runs first, a trade under every farm, an unknown last - is
 * not a spatial fact. So that is what this says, and it says it in full,
 * including the qualification `routeShort` drops on the slot. One row, plus a
 * count, so there is nothing here that can ever be truncated.
 *
 * This is the app's own rule about lists arriving where it was already needed:
 * a ranking is not an answer, and the overlay is supposed to decide.
 */
/**
 * THE NEXT STEP, AS ONE INSTRUCTION, WITH THE ARC IT BELONGS TO.
 *
 * `Missing` below answers "which mod do I not own that is easiest to farm",
 * which is a good question and not the one the brief asks. Two things it cannot
 * see: a RANK-UP is often the better next move than any farm, and when capacity
 * is what binds, the answer is a Forma and no mod at all. Both are rungs on the
 * ladder, and the ladder is measured - each rung's gain is over the build the
 * rung before it produced, not over a Now that stops existing after step one.
 *
 * ONE instruction, not the list. The overlay is supposed to decide; the rest of
 * the ladder appears as its length and its destination, which is the shape of
 * the work rather than a competing set of options to weigh. The grid already
 * marks every missing mod in place, so nothing here is the only mention.
 *
 * `working` is why the count is not simply `rungs.length`: the ladder is built
 * between timeouts and published as it grows, so a short ladder mid-build and a
 * finished one look identical in the array and mean opposite things. While it
 * is still working this says how far it has got and nothing about the end.
 */
/**
 * ONE RUNG, AS A LINE. Four kinds, and each is a different sentence.
 *
 * Pulled out of `NextUp` when the fourth arrived: a nested ternary picking
 * between four shapes inside JSX is where a wrong branch hides, and the
 * star-chart rung is the one nobody would notice missing - it only ever shows
 * when the player is stuck, which is exactly when they are reading.
 */
function instruction(r: Rung): ReactNode {
  if (r.kind === 'forma') {
    return (
      <>
        <span className="am-queue-name">Forma</span>
        <span className="am-route">polarise a slot to {r.polarity}</span>
      </>
    );
  }
  if (r.kind === 'unlock') {
    /*
     * NOT A MOD AT ALL. Everything this build still wants drops somewhere the
     * account has not opened, so the next thing to do is on the star chart. The
     * node is named because "unlock Ceres" is a wall and "play Draco" is a door.
     */
    return (
      <>
        <span className="am-queue-name">{r.nodeName}</span>
        <span className="am-route">
          {r.nodes === 1 ? 'opens ' : `${String(r.nodes)} nodes to `}
          {r.planet}, where the rest of this build is
        </span>
      </>
    );
  }
  /*
   * THE ROUTE ON ONE LINE, with the whole of it a hover away.
   *
   * "Duviri/Endless: Tier 1 (Normal) · about 150 runs" wraps to two lines in a
   * 292 px column, and measured across every state of the panel that second
   * line is what put the fullest builds 7 px over the column at 1366x768 - the
   * footer's honesty markers fall off the end for a qualification nobody needs
   * while deciding. `routeShort` was written for exactly this and keeps the half
   * that decides: the place, and how many runs. The full wording is the title,
   * which is where the game itself puts a detail too long for its own row.
   */
  return (
    <>
      <span className="am-queue-name">{r.name}</span>
      <span className="am-route" title={r.route ? routeText(r.route) : undefined}>
        {r.fromRank === null ? (r.route ? routeShort(r.route) : 'not owned') : `rank ${String(r.fromRank)} to ${String(r.toRank)}`}
      </span>
    </>
  );
}

/**
 * Where this instruction sits in the arc, in the fewest words that keep the
 * three endings apart. 'working' says more is coming; 'horizon' says more
 * exists and the app stopped looking; 'complete' says this is all of it.
 * Collapsing any two would either promise rungs that never arrive or present a
 * truncated ladder as a finished one.
 *
 * It is short because it shares a line with the head: the version that said
 * "then five more, and further after that" was a row of its own, and the aside
 * measured 17 px over budget at 1280x720 with it.
 */
function tailText(end: LadderEnd, after: number): string | null {
  if (after <= 0) return end === 'working' ? null : '1 of 1';
  if (end === 'working') return `1 of ${String(after + 1)} so far`;
  if (end === 'horizon') return `1 of ${String(after + 1)}+`;
  return `1 of ${String(after + 1)}`;
}

function NextUp({ rungs, end, cardWidth }: { rungs: readonly Rung[]; end: LadderEnd; cardWidth: number }) {
  const first = rungs[0];
  if (!first) return null;
  const after = rungs.length - 1;
  const where = tailText(end, after);
  return (
    <>
      <p className="am-aside-head">
        next{where !== null && <span className="numeric">{where}</span>}
      </p>
      {/*
       * THE INSTRUCTION IS A CARD, because the thing the player has to do is
       * find a card.
       *
       * The name was set as 21 px of type and everything else about the mod -
       * its polarity, its drain, the rank it has to reach, whether the account
       * holds it at all - was either a separate line of text or absent. All
       * four of those are things a Warframe card SAYS, in a vocabulary the
       * player already reads faster than any sentence: the glyph on the drain
       * tab, the number beside it, the pips on the base plate, and lit against
       * dark for owned against not.
       *
       * `ModCard` had been drawing all of it for nobody. It is the most
       * measured object in this repo - the body octagon and its 12 px chamfers,
       * the crest, the plate whose top rail is the brightest pixel on a real
       * card, nine polarity glyphs, twelve point-sampled colours, all traced at
       * 3x off the player's own capture - and it reached zero pixels because it
       * went dark with the grid layer.
       *
       * IT IS NOT BLOCKED BY WHAT BLOCKED THE GRID. That layer had to know
       * WHICH SLOT each mod sits in, and no array the app can read is known to
       * be in the screen's order. A card in the overlay's own column is placed
       * on nothing and claims no position - so the measurement comes back
       * without the guess that made it wrong.
       *
       * At `scale = 1` it is 201 x 99, which is the size the game draws its own
       * tray cards at on this screen, inside a 300 px column. Drawing it at the
       * game's size is the whole point: a card that is nearly the game's reads
       * as a copy of one.
       */}
      <CardInstruction rung={first} cardWidth={cardWidth} />
    </>
  );
}

/**
 * The card, or the words - whichever the rung can actually be.
 *
 * A Forma rung and an unlock rung are not mods and have no card to draw: there
 * is no Forma card in the tray and a star-chart node is not an object at all.
 * They keep the sentence, which is the honest form for a thing with no picture.
 */
/**
 * THE CARD IS WORTH DRAWING, OR IT IS NOT DRAWN.
 *
 * The card takes a third of the column, so its width follows the panel's: 99 px
 * at 1680 x 1050, 85 at 1600 x 900, 72 at 1366 x 768, 68 at 1280 x 720. Below
 * about eighty it stops being a card and becomes a stamp - the polarity glyph
 * is drawn at 10 units in a 201-unit box, so at 68 px wide it renders under
 * four pixels, and the drain numeral is not far behind. A picture nobody can
 * read is not a quieter version of the information; it is noise occupying the
 * room the name and the route need.
 *
 * So there is a floor, and under it the instruction is the sentence it was
 * before. The trade was argued before it was measured, so here is the
 * measurement, taken across every resolution the panel is drawn at:
 *
 *              panel   card    route needs   route has
 *   1680x1050   300     96         189          189
 *   1600x900    257     82         161          161
 *   1366x768    219    none        211          211
 *   1280x720    206    none        198          198
 *
 * The route is a hair inside its column at every size and truncates nowhere.
 * Putting a card back at 1280 costs it about 103 px - half the line - so the
 * choice is a legible card beside "Ghoul Rict..." or no card beside the whole
 * of "Ghoul Rictus Alpha - 10 runs". The route is the half that says what to
 * DO, so the card is what gives way. The card only ever said the name faster.
 */
export const CARD_MIN_PX = 80;
/** The card's share of the column - kept here so the floor and the CSS agree. */
export const CARD_SHARE = 0.33;

function CardInstruction({ rung, cardWidth }: { rung: Rung; cardWidth: number }) {
  if (rung.kind === 'forma' || rung.kind === 'unlock') return <p className="am-first">{instruction(rung)}</p>;
  if (cardWidth < CARD_MIN_PX) return <p className="am-first">{instruction(rung)}</p>;
  return (
    <div className="am-instruct">
      {/*
       * THE CARD BESIDE THE NAME, NOT INSTEAD OF IT - and that was measured,
       * not preferred.
       *
       * The first version replaced the 21 px name with the card and let the
       * card carry it. `ModCard` sets a name at 19 units in a 201-unit box, so
       * at the card's rendered width W the name lands at 19 x W/201 px: legible
       * needs W >= 116, and the card renders 117 px at 1680 x 1050 and 52 px at
       * 1280 x 720. It carries its own name at exactly one resolution and at
       * none of the smaller ones - which is the resolution nobody plays at
       * being the only one that works.
       *
       * So the card does the job it is uniquely good at, which is being
       * RECOGNISED: silhouette, polarity glyph, drain, rank pips, lit against
       * dark for owned against not. Four facts, none of them words. The name
       * and the route stay as type beside it, where they are legible at every
       * size the panel is ever drawn at.
       */}
      <ModCard
        name={rung.name}
        rarity={rung.rarity}
        polarity={rung.polarity}
        drain={rung.drain}
        rank={rung.toRank}
        maxRank={rung.maxRank}
        owned={rung.fromRank !== null}
        ownedRank={rung.fromRank}
      />
      <span className="am-instruct-say">
        <span className="am-queue-name">{rung.name}</span>
        <span className="am-route" title={rung.route ? routeText(rung.route) : undefined}>
          {rung.fromRank === null ? (rung.route ? routeShort(rung.route) : 'not owned') : `rank ${String(rung.fromRank)} to ${String(rung.toRank)}`}
        </span>
      </span>
    </div>
  );
}


/**
 * THE WHOLE BUILD, WHICH THE APP HAS ALWAYS KNOWN AND NEVER SHOWN.
 *
 * The panel gives ONE instruction at a time, and that is right - a ranked list
 * of options is not an answer, and this project has a note to itself saying so.
 * But the ideal build is not a list of options. It is the answer: eight slots,
 * the mod in each, the rank it wants, what it costs the capacity bar. The
 * optimiser computes all of it on every open and the player was shown a count.
 *
 * So it is one click away, in the same column, in the game's own idiom - a mod
 * name, its rank, its drain - and the header says which view is on. The default
 * is still the instruction: opening a screen should answer "what now", not hand
 * over a table.
 *
 * WHAT EACH ROW SAYS. Gold is a slot already right. Quiet ink with an arrow is
 * one you own and have to rank up. A dashed leader is one you do not own, and
 * the route is the line under the instruction view, not repeated here - eight
 * routes do not fit and the one that matters is the one you are being told to
 * do next.
 */
function WholeBuild({ placed, aura, capacity, drain }: { placed: readonly Placed[]; aura: Placed | null; capacity: number; drain: number }) {
  /*
   * IT SAYS WHAT IT CUT. The list clips - it has to, because eight slots plus an
   * aura do not fit a 180 px column at 1280x720 - and a build list that silently
   * drops the last two slots is a lie about the build. The same measurement the
   * caveat list makes: count the rows whose bottom is inside the box, and if
   * that is fewer than there are, the footer says so.
   */
  const [list, setList] = useState<HTMLOListElement | null>(null);
  const [shown, setShown] = useState(0);
  const total = placed.length + (aura ? 1 : 0);
  useEffect(() => {
    if (!list) return;
    const measure = () => {
      const bottom = list.getBoundingClientRect().bottom + 0.5;
      let n = 0;
      for (const li of list.children) if (li.getBoundingClientRect().bottom <= bottom) n++;
      setShown(n);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => {
      ro.disconnect();
    };
  }, [list, placed, aura]);
  return (
    <>
      <ol className="am-build" ref={setList}>
        {aura && (
          <li data-state={slotState(aura)}>
            <span className="am-build-slot">aura</span>
            <span className="am-build-name">{aura.name}</span>
            <span className="am-build-rank numeric">{String(aura.rank)}</span>
            {/*
             * THE SIGN IS THE WHOLE POINT. Every other row's number is capacity
             * SPENT; an aura's is capacity GIVEN, and printed bare in the same
             * column it read as a seventh mod costing seven points. It carries
             * the plus and the gain colour the instruction view already uses.
             */}
            <span className="am-build-drain am-build-gain numeric">+{String(-aura.drain)}</span>
          </li>
        )}
        {placed.map((p, i) => (
          <li key={p.path} data-state={slotState(p)}>
            <span className="am-build-slot numeric">{String(i + 1)}</span>
            <span className="am-build-name">{p.name}</span>
            <span className="am-build-rank numeric">{p.ownedRank !== null && p.ownedRank < p.rank ? `${String(p.ownedRank)}\u2009\u2192\u2009${String(p.rank)}` : String(p.rank)}</span>
            <span className="am-build-drain numeric">{String(p.drain)}</span>
          </li>
        ))}
      </ol>
      <p className="am-build-foot">
        <span className="am-build-slot">{shown < total ? `${String(shown)} of ${String(total)} shown` : 'capacity'}</span>
        <span className="numeric">
          {String(drain)} of {String(capacity)}
        </span>
      </p>
    </>
  );
}

/**
 * THE ONE INSTRUCTION, FROM WHICHEVER SOURCE CAN GIVE IT YET.
 *
 * The ladder is the answer, and it takes about a second to find its first rung.
 * The fallback is not a placeholder: it is the answer this overlay gave before
 * the ladder existed, it is correct, and it is on screen the instant the plan
 * is. Going blank while the controller works would leave the panel empty at
 * exactly the moment the player opened the screen.
 *
 * The choice lives here rather than in `Overlay` because it is one decision
 * about one line of the panel, and it is the sort that grows a third case.
 */
function WhatNext({ rungs, end, missing, cardWidth }: { rungs: readonly Rung[]; end: LadderEnd; missing: readonly Placed[]; cardWidth: number }) {
  if (rungs.length > 0) return <NextUp rungs={rungs} end={end} cardWidth={cardWidth} />;
  if (missing.length > 0) return <Missing items={missing} cardWidth={cardWidth} />;
  return null;
}

function Missing({ items, cardWidth }: { items: readonly Placed[]; cardWidth: number }) {
  const first = items[0];
  if (!first) return null;
  return (
    <>
      {/*
       * "all marked on the grid" was true while the overlay drew on the game's
       * own cards, and those marks are gone - they were placed on an order the
       * app cannot know. A count is what is left, and it is the honest half:
       * one mod is named, and the player is told how many there are.
       */}
      <p className="am-aside-head">{items.length > 1 ? `not owned${' '}·${' '}${String(items.length)}` : 'not owned'}</p>
      {/*
       * THE SAME CARD THE LADDER DRAWS. This branch is the answer before the
       * controller has finished the ladder, and it was the only one on screen
       * for the whole of the pass that added the card - so leaving it as text
       * would have shipped two answers to one question in two languages.
       *
       * `Placed` carries the same six fields a `Rung` does, and its own comment
       * says why: "the overlay lays the ideal build out on the game's own eight
       * mod slots, so every placed mod has to become a real card". That layer
       * is gone; the card is not.
       */}
      {cardWidth < CARD_MIN_PX ? (
        <p className="am-first">
          <span className="am-queue-name">{first.name}</span>
          {first.route && (
            <span className="am-route" title={routeText(first.route)}>
              {routeShort(first.route)}
            </span>
          )}
        </p>
      ) : (
      <div className="am-instruct">
        <ModCard
          name={first.name}
          rarity={first.rarity}
          polarity={first.polarity}
          drain={first.drain}
          rank={first.rank}
          maxRank={first.maxRank}
          owned={first.ownedRank !== null}
          ownedRank={first.ownedRank}
        />
        <span className="am-instruct-say">
          <span className="am-queue-name">{first.name}</span>
          {first.route && (
            <span className="am-route" title={routeText(first.route)}>
              {routeShort(first.route)}
            </span>
          )}
        </span>
      </div>
      )}
    </>
  );
}

/**
 * WHAT THE APP COULD NOT READ, SAID RATHER THAN COUNTED - AND COUNTED HONESTLY
 * WHEN IT CANNOT ALL BE SAID.
 *
 * The footer said "1 assumed" and stopped. The number is useless alone and the
 * sentences behind it are not: "catalyst unknown: capacity computed without one"
 * means the entire plan was built against thirty points instead of sixty, and
 * the player was told there was one of something.
 *
 * These are ITEM-SPECIFIC - what could not be read about THIS item on THIS open
 * - which is why they earn the room and the optimiser's seven standing rules do
 * not. In practice there are none or one; the live log replay showed one.
 *
 * The worst case is five at once, and measured, only three of five fit at
 * 1680x1050 and ONE at 1280x720. So the count is lifted to the footer, which
 * already exists and already says "N assumed": it becomes "3 of 5 assumed"
 * rather than listing three and claiming five. Changing that text does not
 * change the footer's height, so nothing can oscillate.
 */
function Assumed({ items, onFit }: { items: readonly string[]; onFit: (n: number) => void }) {
  const [list, setList] = useState<HTMLUListElement | null>(null);
  useEffect(() => {
    if (!list) return;
    const measure = () => {
      const bottom = list.getBoundingClientRect().bottom + 0.5;
      let n = 0;
      for (const li of list.children) if (li.getBoundingClientRect().bottom <= bottom) n++;
      onFit(n);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => {
      ro.disconnect();
    };
  }, [list, items, onFit]);
  return (
    <ul className="am-assumed" ref={setList}>
      {items.map((a) => (
        <li key={a}>{a}</li>
      ))}
    </ul>
  );
}

/** The optimiser's question in the overlay's few words; the full wording is QUESTION_TEXT. */
const QUESTION_WORD: Record<Plan['now']['question'], string> = {
  Q1: 'sustained dps',
  // The target is part of the answer, not a footnote: a figure against 2,700
  // armour is a different claim from the same figure against bare health.
  Q2: 'dps · 2,700 armour',
  // A frame has no damage figure. What it has is how much it can take.
  Q3: 'effective health',
};

/** Why the item could not be named, in the player's words rather than the ladder's. */
const RUNG_WORD: Record<NonNullable<AutomodState['build']>['unknown'] & string, string> = {
  account: 'No account read yet.',
  'loadout-ids': 'No active loadout on the account.',
  presets: 'No loadout presets on the account.',
  selection: 'Nothing equipped in this slot.',
  instance: 'This item is not in the account.',
  config: 'That config could not be read.',
  upgrades: 'That config carries no mod list.',
};

/** The net edit trail, oldest first. */
function trail(edits: readonly Edit[]): Array<{ path: string; name: string; placed: boolean }> {
  const last = new Map<string, Edit>();
  for (const e of edits) last.set(e.itemType, e);
  return [...last.values()].map((e) => ({ path: e.itemType, name: e.name, placed: e.installed }));
}

/**
 * THE LEDGER: EVERY NUMBER ON ONE AXIS.
 *
 * WHY THIS EXISTS AT ALL. The column used to be nine independent rows, each
 * with its own flex box, its own gaps and its own idea of where a value goes -
 * the tally left, the price in two side-by-side cells, the Forma line as one
 * run of prose, the aura in three spans, the matchup right-aligned to itself.
 * Rendered and looked at, THAT is what read as a basic panel: not the colours,
 * which are sampled off the game, and not the words, which are carefully
 * chosen. Nothing lined up with anything.
 *
 * The game's own answer to a column of numbers on the void is four hundred
 * pixels to the left of this one: the CAPACITY / PRIMARY / DAMAGE block. Its
 * grammar, copied rather than invented -
 *
 *   - the SECTION head is uppercase and tracked; the ROW label is sentence
 *     case. The overlay had that exactly inverted, shouting ENDO and CR at the
 *     player in the case the game reserves for headings;
 *   - the label sits on the left margin and the value hard right, on ONE axis
 *     shared by every row in the block, in tabular figures;
 *   - a fixed row pitch, so the rows read as a table rather than as paragraphs;
 *   - the value is the bright ink and the label the quiet one, which is what
 *     makes a table scannable without any row being loud.
 *
 * `dl` because that is what this is - terms and their values - and it costs
 * nothing over the divs it replaces.
 */
function Ledger({ rows }: { rows: readonly { key: string; label: string; value: ReactNode; className?: string; short?: boolean }[] }) {
  const shown = rows.filter((r) => r.value !== null);
  if (shown.length === 0) return null;
  return (
    <dl className="am-stats">
      {shown.map((r) => (
        <div key={r.key} className={r.className === undefined ? 'am-stat' : `am-stat ${r.className}`} data-short={r.short === true ? '' : undefined}>
          <dt>{r.label}</dt>
          <dd className="numeric">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * EVERY NUMBER THE BUILD HAS, IN ONE BLOCK, UNDER THE INSTRUCTION.
 *
 * These were six separate rows - the tally, the matchup, the price, the Forma
 * line, the aura - each laid out its own way. Rendered at inspection size the
 * column read as eight paragraphs of similar weight with the one thing to DO
 * somewhere in the middle of them, which is what the player called a basic
 * panel and was right to.
 *
 * The order is not the old order. It is what a glance wants, most useful
 * first: how far along, then what the figure above is weakest against, then
 * the bill, then the Forma, then the aura. Nothing here is loud - the whole
 * block is the game's stat table, and the instruction above it is the only
 * bright thing in the column.
 */
function StateLedger({ done, of, weakest }: { done: number; of: number; weakest: { against: string; factor: number } | null }) {
  return (
    <Ledger
      rows={[
        { key: 'done', label: 'slots right', value: `${String(done)} of ${String(of)}` },
        /*
         * The matchup keeps its own class because it keeps its own INK: it is a
         * fact about the build rather than a step, so it sits in the
         * unactionable level even inside a block that is already quiet.
         */
        { key: 'weakest', label: 'weakest', className: 'am-weakest', value: weakest === null ? null : `${weakest.against} ×${weakest.factor.toFixed(2)}` },
      ]}
    />
  );
}

function CostLedger({
  cost,
  purse,
  forma,
  aura,
  showAura,
}: {
  cost: { endo: number; credits: number };
  purse: AutomodState['purse'];
  forma: Plan['forma'];
  aura: Placed | null;
  showAura: boolean;
}) {
  /*
   * A price nobody can compute is not a price, and a free step is not a price
   * either - both are silence rather than a row reading "endo -". Carried over
   * verbatim from `Price`, which this replaces; `afford` still decides which of
   * the two resources is the short one, because sending a player to the Index
   * for an evening when it was Endo they lacked is the failure that rule
   * exists to prevent.
   */
  const priced = Number.isFinite(cost.endo) && Number.isFinite(cost.credits) && cost.endo !== 0;
  const verdict = priced ? afford({ ...cost, verdict: 'exact' }, purse) : null;
  if (!priced && forma.count === 0 && (aura === null || !showAura)) return null;
  return (
    <>
      <p className="am-aside-head">cost</p>
      <Ledger
      rows={[
        { key: 'endo', label: 'endo', value: priced ? figure(cost.endo) : null, short: verdict === 'endo' || verdict === 'both' },
        { key: 'credits', label: 'credits', value: priced ? figure(cost.credits) : null, short: verdict === 'credits' || verdict === 'both' },
        { key: 'forma', label: 'forma', value: forma.count > 0 ? `${String(forma.count)} · ${formaPolarities(forma)}` : null },
        /*
         * The aura is a ninth slot and the only mod on the plan that GIVES
         * capacity, so the figure beside it is what the eight slots got to
         * spend because of it. It is dropped when the instruction above is
         * already the aura, or the panel says the same thing twice two rows
         * apart.
         */
        { key: 'aura', label: 'aura', value: aura === null || !showAura ? null : `${aura.name} ${String(aura.rank)}  +${String(-aura.drain)}` },
      ]}
      />
    </>
  );
}

/** Everything the whole plan costs, which is the number a player budgets against. */
function planCost(steps: readonly NextStep[]): { endo: number; credits: number } {
  let endo = 0;
  let credits = 0;
  for (const s of steps) {
    if (!s.cost) continue;
    endo += s.cost.endo;
    credits += s.cost.credits;
  }
  return { endo, credits };
}

/**
 * WHAT THE COLUMN SAYS WITH NO PLAN TO SHOW.
 *
 * Not an error state and not an empty one: five different things can be true
 * here and each is a different sentence. The controller has not published yet;
 * the screen is one of the four and the account could not be resolved past some
 * rung; the screen is not one of the four at all; the tail joined mid-session;
 * or the catalogue is still on the wire. Underneath any of them there may still
 * be an edit trail, which is the one thing the app knows without a plan.
 *
 * Split out of `Aside` because it is the whole of one branch of a `plan ? :`
 * and shares nothing with the other. Both halves were long enough that the
 * branch itself had stopped being visible.
 */
function NoPlan({
  live,
  build,
  session,
  edits,
  net,
}: {
  live: boolean;
  build: AutomodState['build'];
  session: AutomodState['session'];
  edits: ReturnType<typeof trail>;
  net: ReturnType<typeof netEdits>;
}) {
  return (
    <>
          {!live && <p className="am-say">No feed from the controller.</p>}
          {/*
           * THE SCREEN OUTSIDE THE FOUR, which had no words at all.
           *
           * When the slot is one this app does not read, `resolveBuild` is
           * never called - so `build` is null, every line below it is skipped,
           * and the panel stood there with a title reading "item unknown" and
           * nothing underneath. The player gets a blank overlay on a screen
           * the app knows it cannot read, which looks exactly like a broken
           * overlay on a screen it should be able to.
           *
           * It says which, because "not yet" and "went wrong" are different
           * things to be told, and the second would send somebody looking for
           * a bug that is not there.
           */}
          {/*
           * ONLY WHILE IT IS STILL UNREAD. `unreadSlot` stays set for the whole
           * visit, including after the row has been learned - so this asked the
           * player to teach the app something it already knew, on every publish,
           * beside the resolution failure that was the real problem. `build` is
           * the tell: the controller only resolves one when it knows which
           * category is open.
           */}
          {session.unreadSlot !== null && build === null && session.phase !== 'idle' && (
            <>
              <p className="am-say">This is not one of the four arsenal slots the overlay reads yet.</p>
              {/*
               * AND WHAT UNBLOCKS IT, because the app knows and the player
               * cannot guess.
               *
               * The first sentence alone is a dead end: true, unhelpful, and
               * indistinguishable from "this will never work". The app learns
               * an unknown row from the compatibility class of the first mod
               * touched on it - a mod cannot be installed on a thing it does
               * not fit - so ONE placement teaches it for good, on this account
               * and every session after. Saying so turns a wall into a door.
               *
               * "Move any mod" rather than "install one": lifting a card off
               * emits the same line and teaches the same thing, and asking
               * somebody to change a build they did not come here to change
               * would be a worse instruction than the one it replaces.
               */}
              <p className="am-say">Move any mod on it once and it will be recognised from then on.</p>
            </>
          )}
          {build && build.unknown !== null && session.phase !== 'idle' && <p className="am-say">{RUNG_WORD[build.unknown]}</p>}
          {session.seenWithoutOpen && <p className="am-say">Joined late: this is everything since the tail started.</p>}
          {live && build?.unknown === null && session.phase !== 'idle' && <p className="am-say">Reading the catalogue…</p>}
          {edits.length > 0 && (
            <ul className="am-missing">
              {edits.map((e) => (
                <li key={e.path}>
                  <span className="am-edit" data-placed={e.placed || undefined}>
                    <span className="am-queue-name">{e.name}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {edits.length > 0 && (
            <p className="am-foot">
              {String(net.placed.length)} in · {String(net.lifted.length)} out
            </p>
          )}
    </>
  );
}

/**
 * THE COLUMN, WHICH IS THE WHOLE OF WHAT THE OVERLAY SAYS.
 *
 * Split out of `Overlay` when that function reached 179 lines: everything it
 * does is either LAYOUT - where the grid and this column sit on the game's own
 * screen - or WORDS, and the two had grown into one another. A render function
 * that long stops being read, which is where a wrong branch goes unnoticed;
 * this file has already had two.
 *
 * The derivations came with it rather than being passed down as a dozen props.
 * They are all functions of the same four things the feed carries, so a prop
 * list would have been the same data spelled twice with a chance to disagree.
 *
 * Nothing about the rendering changed. The proof is not the diff: the artboard's
 * `__sweepAll()` renders all 32 states at five resolutions, `__motion()` reads
 * the entrance off the browser, and `__stress()` checks for leaked nodes and
 * animations - all three were run before and after.
 */
function Aside({
  session,
  build,
  plan,
  planAssumed,
  purse,
  ladder,
  ladderEnd,
  live,
  cardWidth,
}: {
  session: AutomodState['session'];
  build: AutomodState['build'];
  plan: AutomodState['plan'];
  planAssumed: readonly string[];
  purse: AutomodState['purse'];
  ladder: readonly Rung[];
  ladderEnd: LadderEnd;
  live: boolean;
  /** What the card would render at, so the instruction can refuse to draw one too small to read. */
  cardWidth: number;
}) {
  const [assumedShown, setAssumedShown] = useState(0);
  /*
   * Which view the column is showing, and WHAT IT RESETS WITH.
   *
   * It has to reset with the ITEM and not with the publish: leaving it on
   * 'build' across a screen change answers a question the player asked about a
   * different weapon, and a reset on every publish would close the view under
   * them while they read it.
   *
   * WHAT THIS ACTUALLY COVERS, precisely, because the comment here once claimed
   * more: `Overlay` returns null while the window is hidden and every close
   * hides it, so `Aside` unmounts between visits and `useState(false)` already
   * resets the toggle for the NEXT weapon. The case left over is the item
   * changing while the window stays up - a loadout the app could not confirm at
   * the open, corrected by a read that lands mid-visit. One case, and the one
   * where the player is looking at the panel while it happens.
   *
   * Adjusted during render rather than in an effect, and without a `key` on the
   * component: remounting would replay the arrival animation, and transitions
   * do not advance in an unpresented document, so an entrance can be left stuck
   * at its first frame - a blank column.
   */
  const itemKey = itemIdentity(session.openedAt, build);
  const [shownFor, setShownFor] = useState(itemKey);
  const [showBuild, setShowBuild] = useState(false);
  if (shownFor !== itemKey) {
    setShownFor(itemKey);
    setShowBuild(false);
  }
  const ideal = plan?.ideal.placed ?? [];
  /*
   * THE SAME FOUR-SLOT ASSUMPTION THE CONTROLLER HAD, one layer up.
   *
   * `SLOT_CATEGORY[session.slot]` answers for the four arsenal rows this app
   * was born reading and for nothing else, and a LEARNED row's slot is always
   * null - so a companion screen the app had identified fell through to "another
   * slot", the words reserved for a screen it cannot read at all. The resolved
   * build already carries the category it was resolved FOR; the table is the
   * fallback for a state that has a slot and no build, which is what the
   * artboard feeds.
   */
  const category = build?.category ?? (session.slot === null ? null : SLOT_CATEGORY[session.slot]);

  const steps = plan?.next ?? [];
  /*
   * A screen outside the four is not an unknown ITEM - the app never got as far
   * as an item. Saying "item unknown" there sends the reader looking for a
   * missing weapon; "another slot" says what actually happened.
   */
  /*
   * The category is a key, not a label: 'companion-weapon' and 'arch-gun' are
   * how the code spells them, and the title is set uppercase, so the hyphen
   * reads as punctuation in a display line. A space is the same word.
   */
  const named = category?.replace(/-/g, ' ') ?? null;
  const title = build?.name ?? named ?? (session.phase === 'idle' ? 'upgrades' : session.unreadSlot !== null ? 'another slot' : 'item unknown');
  const done = ideal.filter((p) => slotState(p) === 'done').length;
  /*
   * Missing mods, EASIEST FIRST. Sorted by how many runs the best source takes,
   * so the top of the list is the one to go and do tonight; a mod that has to
   * be traded for sorts under every farm, and one nobody can place sorts last.
   */
  const missing = ideal.filter((p) => slotState(p) === 'get').sort((a, b) => (a.route ? routeRank(a.route) : 1e9) - (b.route ? routeRank(b.route) : 1e9));
  /*
   * The meter is clamped at BOTH ends. The upper clamp was here; the lower was
   * not, and a negative figure - which the app should never produce and which
   * this cannot rule out - gave `scaleX(-0.06)`, a bar that grows the wrong way
   * out of its own left edge. A non-finite ratio reads as no progress at all.
   */
  const ratio = plan && plan.ceiling.score.value > 0 ? plan.now.score.value / plan.ceiling.score.value : 0;
  const reach = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  const total = planCost(steps);
  const edits = trail(session.edits);
  const net = netEdits(session.edits);
  /*
   * THE STRONG CLAIM IS GATED, AND "NO MODS LEFT" WAS NEVER ENOUGH FOR IT.
   *
   * An empty step list is not proof that Now is Ideal - a mod held ABOVE the
   * rank the ideal wants is skipped when the steps are built, and its higher
   * drain can push the real build off the ideal. That much was already here.
   *
   * What was not: `steps` only ever knew about MODS. A player who owns every
   * mod in the game on a grid nobody has polarised has an empty step list and
   * eight Forma of real work in front of them, and this told them they were at
   * the ceiling. The ladder is what knows the difference, so it is what decides
   * - and only once it has finished looking, because a ladder still being built
   * is not yet evidence of anything.
   */
  /*
   * The projection: where the first rung lands, as a fraction of the same
   * ceiling the bar and the headline read. Null when there is no rung yet, so
   * the bar draws nothing rather than a segment at zero - which would read as a
   * step worth nothing rather than as no step known.
   */
  /*
   * WHAT IS LEFT OF THE STAIRCASE, after what the player has already placed on
   * this visit. See `stillToDo`: the log names every placement by full path, so
   * this needs no inference.
   *
   * `ladder` itself is NOT replaced. `ladderIdle` and `atCeiling` below are
   * derived from its length, and filtering it to empty would make the panel
   * announce a finished build the moment the player placed the last suggestion
   * - before the arsenal has written anything and while the account still says
   * otherwise. Falling back to the unfiltered list when everything is placed
   * keeps the column showing something true rather than nothing at all.
   */
  const shownLadder = ((): readonly Rung[] => {
    const ahead = stillToDo(ladder, netEdits(session.edits).placed);
    return ahead.length > 0 ? ahead : ladder;
  })();
  const nextValue = shownLadder[0]?.value;
  const nextReach =
    plan && nextValue !== undefined && plan.ceiling.score.value > 0 && Number.isFinite(nextValue)
      ? Math.min(1, Math.max(0, nextValue / plan.ceiling.score.value))
      : null;
  /*
   * The staircase's first rung and the aura row can name the same mod, and when
   * they do the row is a restatement of the instruction.
   */
  const firstRung = shownLadder[0];
  const auraIsNext = firstRung?.kind === 'aura' && firstRung.path === plan?.ideal.aura?.path;
  const ladderIdle = ladderEnd === 'complete' && ladder.length === 0;
  const atCeiling = plan !== null && steps.length === 0 && ladderIdle;
  const reachedIdeal = plan !== null && plan.now.score.value >= plan.ceiling.score.value;


  return (
    <>
        <header className="am-head">
          <h1 className="am-title">{title}</h1>
          {/*
           * ONE CLICK TO THE WHOLE BUILD. The overlay takes no input anywhere
           * else - the window is click-through except for the two controls in
           * this header - so this costs the player nothing until they want it.
           */}
          {plan && (
            <button
              type="button"
              className="am-view"
              onClick={() => {
                setShowBuild((v) => !v);
              }}
              title={showBuild ? 'Back to the next thing to do' : 'Show the whole build this weapon is aiming at'}
            >
              {showBuild ? 'next' : 'build'}
            </button>
          )}
          <button
            type="button"
            className="am-close"
            onClick={() => FEED.feed.mute?.()}
            title="Hide the overlay (Ctrl+Shift+M brings it back)"
            aria-label="Hide the overlay"
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 2 L10 10 M10 2 L2 10" />
            </svg>
          </button>
        </header>
        <div className="am-rule" />

        {plan && showBuild ? (
          <WholeBuild placed={plan.ideal.placed} aura={plan.ideal.aura} capacity={plan.ideal.capacity} drain={plan.ideal.drain} />
        ) : plan ? (
          <>
            <div className="am-now" data-quiet={plan.now.score.figureNote !== null || undefined}>
              <span className="am-now-label">{QUESTION_WORD[plan.now.question]}</span>
              <span className="am-now-figs">
                <b>
                  <Figure value={plan.now.score.value} />
                </b>
                {/*
                 * THE GAME'S OWN MARKER. The Upgrades panel puts a small
                 * diamond after Slam Attack and Status - the stats whose printed
                 * value is not the whole story. A melee figure is in exactly
                 * that category: the app scores the eight grid slots and not the
                 * stance, exilus or arcane, so a build using one of those is
                 * understated. It carries the same mark rather than a warning of
                 * its own, and the title names the gap, because an unmarked
                 * number that disagrees with the game is the one thing this must
                 * not print.
                 *
                 * The mark used to say the figure was "exactly half". That came
                 * from one capture and was wrong as a general claim: a second
                 * panel on the same weapon, with a build the app models whole,
                 * lands within 0.32 %.
                 */}
                {plan.now.score.figureNote !== null && (
                  <i className="am-mark" title={plan.now.score.figureNote} aria-label="this figure disagrees with the game" />
                )}
                {!atCeiling && <i className="am-to" aria-hidden="true" />}
                {/*
                 * THE CEILING FIGURE IS THE CEILING, which the class has always
                 * claimed and the value did not. It was `ideal` - the best build
                 * the account's CURRENT grid allows - so the panel carried two
                 * different destinations at once: "2,055 to 4,049" at the top and
                 * the ladder's "of 5,203" four lines below it, with nothing to
                 * say why they disagreed. The meter reads against the same
                 * number, so the bar and the figure are one claim.
                 */}
                {!atCeiling && <Figure value={plan.ceiling.score.value} className="am-ceiling" />}
              </span>
            </div>
            <div className="am-meter" data-full={atCeiling && reachedIdeal ? '' : undefined} aria-hidden="true">
              {/*
               * WHERE THE NEXT STEP LANDS, on the bar rather than in a line of
               * its own. The game previews a mod's cost as a second segment on
               * the capacity bar before you commit it; this is the same move
               * for the same reason, and it is what let the panel keep the aura
               * line and the honesty footer - which the text version was
               * crushing to three pixels at 1280x720.
               */}
              {nextReach !== null && <u style={{ transform: `scaleX(${String(nextReach)})` }} />}
              <i style={{ transform: `scaleX(${String(atCeiling ? 1 : reach)})` }} />
            </div>

            {/*
             * THE WORST MATCHUP, which is the one thing on this panel nobody
             * could have worked out for themselves.
             *
             * The figure above is already multiplied by it - Q2 takes the
             * minimum over the game's 15 factions and 14 health layers and
             * scores that - so the number was on screen and the reason for it
             * was not. "0.76 against Infested Deimos" names the element to
             * trade; a lone figure names nothing, and nobody carries a 16 x 15
             * and a 16 x 14 grid in their head or re-checks them on every mod
             * swap.
             *
             * It sits directly under the meter because it QUALIFIES that
             * figure, in the unactionable ink, because it is a fact about the
             * build rather than a thing to do. Shown only where the column has
             * the room - the same measured floor the card uses, and for the
             * same reason: this line costs 17 px and at 1280 x 720 the panel
             * has four.
             */}
            {/*
             * `?? null` BECAUSE A FEED CAN PREDATE THE FIELD, and `!== null`
             * was not enough. The controller publishes a plan the overlay
             * renders, and any plan built before `weakest` existed - a cached
             * one, the artboard's fixtures - carries `undefined` rather than
             * null. The first version of this guard tested `!== null`, which
             * `undefined` passes, and the whole overlay went blank with
             * "Cannot read properties of undefined (reading 'against')".
             *
             * The same shape as the stored-record rule this repo already
             * carries: a field added to a published type is absent on
             * everything published before it, so it is repaired where it is
             * READ and never assumed at the write end.
             */}
            {atCeiling ? (
              <>
                <p className="am-done">{reachedIdeal ? 'at the ceiling' : 'nothing left to add'}</p>
                <p className="am-say">
                  {reachedIdeal
                    ? 'Nothing in the game raises this build further. Every mod it wants is on it, at rank, in a slot polarised for it.'
                    : 'No mod, rank or Forma raises this build. The ceiling scores higher, so something on it is ranked past what the ceiling wants.'}
                </p>
              </>
            ) : (
              <>
                {/*
                 * THE INSTRUCTION, THEN ITS PRICE, and it used to be the other
                 * way round. Endo, credits, Forma and the aura all came first
                 * and the one thing to DO was last - the player read the bill
                 * before the purchase. What a glance should learn here is "fit
                 * Melee Prowess next"; everything else on the panel qualifies
                 * that sentence.
                 */}
                {/*
                 * AND THEN EVERY NUMBER, ON ONE AXIS, UNDER IT.
                 *
                 * The order of this column is the whole argument. What a glance
                 * should learn is the one thing to do next; everything below
                 * qualifies that sentence, and nothing below it is allowed to
                 * out-weigh it. Six rows that each laid themselves out could not
                 * keep that promise - the tally was set in the display face at
                 * twice the instruction's size and won every time.
                 */}
                <StateLedger done={done} of={ideal.length} weakest={cardWidth < CARD_MIN_PX ? null : (plan.now.score.weakest ?? null)} />
                <WhatNext rungs={shownLadder} end={ladderEnd} missing={missing} cardWidth={cardWidth} />
                <CostLedger cost={total} purse={purse} forma={plan.forma} aura={plan.ideal.aura} showAura={!auraIsNext} />
              </>
            )}

            {/*
             * WHAT THE APP GUESSED, IN WORDS.
             *
             * This said "1 assumed" and stopped. The number is useless on its
             * own and the things behind it are not: "catalyst unknown: capacity
             * computed without one" means the whole plan was built against
             * thirty points instead of sixty, and the player was told only that
             * there was one of something.
             *
             * They are ITEM-SPECIFIC - what could not be read about THIS weapon
             * on THIS open - which is why they are worth the room and the
             * optimiser's seven standing rules are not. They are usually none:
             * a weapon the app has read a save for produces an empty list and
             * this renders nothing at all.
             *
             * The room is measured, not hoped for, and it is the ONE row here
             * allowed to run out of it: `flex: 0 1 auto` with the overflow
             * hidden, so a long caveat list shrinks and every other row keeps
             * its height. The footer then says how many of it the player is
             * actually reading. Enumerating the panel's 5,136 states at five
             * sizes puts the tallest at 263 px of the column's 263 - exactly
             * full, with this list absorbing the difference.
             */}
            {planAssumed.length > 0 && <Assumed items={planAssumed} onFit={setAssumedShown} />}

            {(plan.now.unscored > 0 || planAssumed.length > 0) && (
              <p className="am-foot">
                {[
                  plan.now.unscored > 0 ? `${String(plan.now.unscored)} unscored` : null,
                  /*
                   * "3 of 5 assumed" whenever the column cannot hold them all,
                   * so the footer never claims more than the list shows.
                   */
                  /*
                   * "0 OF 1" IS A REAL READING, and requiring `assumedShown > 0`
                   * is what made it a lie. Enumerating the panel found 720 states
                   * at 1680x1050 and 2,340 at 1366x768 where the column squeezes
                   * the caveat list to NOTHING and this then printed a flat
                   * "1 assumed" - the count of something the player cannot see a
                   * word of. The zero is the honest number: it says a caveat
                   * exists and that this screen has no room to state it.
                   */
                  planAssumed.length > 0
                    ? assumedShown < planAssumed.length
                      ? `${String(assumedShown)} of ${String(planAssumed.length)} assumed`
                      : `${String(planAssumed.length)} assumed`
                    : null,
                ]
                  .filter((x): x is string => x !== null)
                  .join(' · ')}
              </p>
            )}
          </>
        ) : (
          <NoPlan live={live} build={build} session={session} edits={edits} net={net} />
        )}
    </>
  );
}

function Overlay() {
  const { session, build, plan, planAssumed, purse, ladder, ladderEnd, live } = useAutomod();
  const hidden = useHiddenGate();
  const area = useArea();
  if (hidden) return null;
  const scale = area.height / MEASURED_AT.height;
  const aside = asideBox(area);

  return (
    /*
     * `--am-scale` is the screen's own scale, published to CSS so the aside's
     * type grows with the cards instead of staying fixed beside them.
     */
    <main className="am" data-phase={session.phase} style={{ '--am-scale': scale } as CSSProperties}>
      {/*
       * THE GRID LAYER IS GONE, AND IT WAS NOT A STYLE PROBLEM.
       *
       * It drew `plan.ideal.placed[i]` onto the game's card `i`: an edge, a name
       * plate, a tick. Both halves of that are wrong, and the player's own
       * screenshot is what proved it.
       *
       * 1. THE IDEAL'S ORDER IS THE SEARCH'S, not the screen's. Nothing lines
       *    the two up, so card 1 got whichever mod the beam happened to place
       *    first.
       * 2. THE ACCOUNT'S ORDER IS NOT THE SCREEN'S EITHER. Read live off the
       *    unranked Ankyros the player was looking at: `Configs[0].Upgrades`
       *    holds Reach at index 6 and Primed Pressure Point at index 7 - and the
       *    game drew Primed Pressure Point in the FIRST grid slot and Reach in
       *    the second. Under any reading of the array as a layout the overlay
       *    would have marked the bottom-right two slots for mods sitting in the
       *    top-left two.
       *
       * So every plate was placed by coincidence, and the plates covered the
       * game's own card names doing it - measured, a `get` plate took 35 px of a
       * 104 px card, a third of it, straight across the name band. That is what
       * "a complete disaster visually" was.
       *
       * The overlay now says nothing it cannot place truthfully. Which mods to
       * fit, in what order, at what cost and where to get them is the column
       * beside the grid, and none of that needs a slot index. If the array's
       * order is ever pinned to the screen's - one capture and one account read
       * at the same instant settles it - this can come back placed for real.
       */}

      <aside className="am-aside" style={{ left: aside.left, top: aside.top, width: aside.width, height: aside.height }}>
        <Aside session={session} build={build} plan={plan} planAssumed={planAssumed} purse={purse} ladder={ladder} ladderEnd={ladderEnd} live={live} cardWidth={aside.width * CARD_SHARE} />
      </aside>

    </main>
  );
}

/*
 * The class the transparency rule hangs off. It is set from script rather than
 * written into automod.html so the rule cannot be defeated by import order:
 * whatever `theme.css` declares on `:root`, this selector is more specific and
 * lands after it.
 */
document.documentElement.classList.add('am-transparent');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Overlay />
  </StrictMode>,
);
