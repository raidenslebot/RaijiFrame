/**
 * WORLDSTATE — what the solar system is doing, ordered by what runs out first.
 *
 * Everything on this screen is a countdown, so the hierarchy is time: the cycle
 * closest to flipping is drawn large and leads the strip, fissures are sorted by
 * how long they have left rather than by tier, and the only colour used is the
 * one that means "this is about to go".
 *
 * The read itself is cached by the gentle layer; the countdowns are recomputed
 * each second from each item's own `expiry`, so they stay honest for the whole
 * cached window.
 *
 * ONE THING HERE IS NOW DERIVED FROM THE ACCOUNT, AND IT CHANGES THE PANEL
 * ───────────────────────────────────────────────────────────────────────
 * A fissure is a door and a relic is the key, and this panel used to list the
 * doors without ever mentioning the keys. Every row looked equally worth
 * crossing the map for, so the only question anybody opens the list to answer -
 * which of these can I actually use - was left to memory. The relic counts come
 * from `fissure-match`, which joins the account's own `MiscItems` rows to the
 * relic table by DE's item path. Nothing else on the screen touches the account.
 *
 * That join is allowed to fail, and it fails in three different ways: the relic
 * table has not arrived, the account has never been read, or the read came
 * without an item bucket. All three print the word "unknown". None of them
 * prints a zero, and a fissure whose count is unknown is never dimmed and never
 * filtered out, because dimming it would be asserting the thing we do not know.
 *
 * AND IT HAS CONTROLS NOW
 * ───────────────────────
 * It had none: 1040 lines of read-only wall, two lists long enough that finding
 * a row meant scanning all of it. Fissures filter by path and by whether you
 * hold a relic for them; daily missions filter by which of the two they are.
 * Every one is a real button with `aria-pressed` and the app's own inset focus
 * ring, every one persists through `usePersisted`, and no filter is ever
 * allowed to leave a blank region - an emptied list says what it hid and
 * carries the way back.
 *
 * THE LISTS HAVE LEVELS NOW, WHICH IS WHAT THE FILTERS WERE STANDING IN FOR
 * ────────────────────────────────────────────────────────────────────────
 * Eight sections, every one a single accordion with a flat run of siblings
 * inside it: `Fold` took a `depth` and all eight call sites took the default,
 * so a reader could ask "how?" exactly once and then hit the floor. Two of the
 * lists were already computing the key they should have been grouped by and
 * spending it on ink - a fissure's tier was a filter chip and a coloured label
 * on every row, a Nightwave act's cadence was a colour and a three-letter word
 * on every row. Both are groups now, one level inside their section, and the
 * key comes off the rows it was being repeated on. An act with a description
 * carries it a level further down again; an act without one is a plain row,
 * because a level with nothing under it is worse than no level at all.
 * `RelicTree` is where this shape was settled and this panel follows it rather
 * than inventing a second one.
 *
 * The depths are written as literals on the components and nowhere else, on
 * purpose: `check-ui-tokens.ts` counts them by scanning the source, so a
 * comment quoting the prop in its JSX form would be counted as a disclosure
 * that does not exist and would raise the gate's own floor on a fiction.
 *
 * AND THE SECTIONS ARE NO LONGER TEN SIBLINGS IN ONE COLUMN
 * ────────────────────────────────────────────────────────
 * Measured in a real browser at 1280 x 720 with no account read - the cold
 * launch, which is what the owner sees - this panel emitted 803 px into a
 * 672 px viewport with every section closed but the cycle strip. Ten
 * top-level siblings, the most of any panel in the app, all at one level in
 * one `flex-col gap-6`: nothing was subordinate to anything, and 240 px of
 * the height was the gaps and the page padding rather than the content.
 *
 * The fix is structural and is the one the platinum panel already settled: a
 * fixed-height grid, the headline state pinned in a band that never scrolls
 * away, and the sections split into an ANSWER pane and a REFERENCE pane that
 * each scroll inside themselves. The page does not scroll at all now. See the
 * default export at the foot of this file, which carries the whole argument.
 *
 * One consequence reaches into the sections and is worth stating here: FOUR
 * LISTS SPLIT INTO TWO COLUMNS AND ALL FOUR ASKED THE WINDOW'S WIDTH. That
 * was the same measurement as the list's width while the panel was one
 * full-width column and stopped being it the moment there were two panes, so
 * they ask their own container now - `.rf-cols`, in `PanelRules`.
 */

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  humanDuration,
  msUntil,
  readWorldstate,
  type Cycle,
  type Fissure,
  type InvasionSide,
  type NightwaveAct,
  type Worldstate,
} from '../../data/worldstate';
import { loadCatalog } from '../../data/datasets';
import { GoLink } from '../../ui/interact';
import { useAccount } from '../../core/store';
import { loadRelics, type Relic } from '../../data/plat-value';
import { relicStock, stockLabel, tierNeed, type RelicStock } from '../../data/fissure-match';
import { bool, oneOf, strSet, usePersisted } from '../../ui/persist';
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { CHAMFER, PLATE_LIFT as PLATE } from '../../ui/geometry';

/** The same cut at control size. A chip is a small plate, not a pill. */
const CHIP_CHAMFER = 'polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 7px 100%, 0 calc(100% - 7px))';


/** A whole percent (of 100) that never lies at the edges: a started fight is never 0%, an unfinished one never 100%. */
const wholePct = (p: number): string =>
  p > 0 && p < 0.5 ? '<1%' : p < 100 && p >= 99.5 ? '99%' : `${Math.round(p)}%`;

/**
 * A ticking clock, decoupled from data reads.
 *
 * The countdown updates every second; the underlying worldstate is read at most
 * once every 120 seconds. Timers are computed from each item's `expiry`, so they
 * stay correct for the whole cached window rather than drifting.
 */
function useNow(ms = 1000): number {
  // The wall clock is an external system, so it is subscribed to rather than
  // mirrored into state - that keeps render pure and avoids a setState-in-effect.
  // The snapshot is quantised to the tick so it is stable between ticks, which is
  // what `useSyncExternalStore` requires of `getSnapshot`.
  return useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, ms);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / ms) * ms,
    () => 0,
  );
}

interface Loaded {
  data: Worldstate;
  at: number;
  origin: string;
}

function useWorldstate(): { loaded: Loaded | null; error: string | null } {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = () => {
      void readWorldstate()
        .then((r) => {
          if (!alive) return;
          setLoaded({ data: r.value, at: r.at, origin: r.origin });
          setError(null);
        })
        .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'read failed'));
    };
    pull();
    // Asking every 30s is free: the gentle layer's 120s floor turns most of these
    // into cache hits and never lets more than one real request through.
    const id = setInterval(pull, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return { loaded, error };
}

/* ------------------------------------------------------------ relic stock */

/**
 * The relic table, fetched once per app session and shared by every reader.
 *
 * THIS IS NOT A NEW NETWORK READ, AND IT MATTERS THAT IT ISN'T
 * ───────────────────────────────────────────────────────────
 * `loadRelics` is the platinum panel's own reader and it goes through the
 * gentle layer under the static-data policy, which caches the table and
 * persists it. Calling it here is a cache hit on a warm app and one request on a
 * cold one, shared with the panel that already asks for it. Writing a second
 * reader against the same endpoint - or worse, a fissure-specific one - would
 * have doubled a request this app deliberately makes rarely.
 *
 * The module-scope cache mirrors `nodeIdByName` above for the same reason: this
 * panel remounts every time the overlay is opened, and the table does not change
 * between two openings.
 */
let relicTable: readonly Relic[] | null = null;

function useRelicStock(): RelicStock {
  const inventory = useAccount((s) => s.inventory);
  const [table, setTable] = useState<readonly Relic[] | null>(relicTable);

  useEffect(() => {
    if (relicTable !== null) return;
    let alive = true;
    void loadRelics().then((db) => {
      /*
       * An empty table is cached too. `loadRelics` already reports a failure as
       * an empty list, `relicStock` already reads an empty list as unknown
       * rather than as "no relics exist", and retrying a static table on every
       * remount is exactly the hammering the gentle layer exists to prevent.
       */
      relicTable = db.all;
      if (alive) setTable(db.all);
    });
    return () => {
      alive = false;
    };
  }, []);

  return useMemo(() => relicStock(inventory, table), [inventory, table]);
}

/* ----------------------------------------------------------- the controls */

/**
 * A filter, as a real button.
 *
 * WHY THIS IS A BUTTON AND NOT A STYLED DIV
 * ─────────────────────────────────────────
 * A div with an `onClick` is not reachable by Tab, announces nothing, and has no
 * pressed state to announce - so a keyboard or screen-reader user meets a panel
 * whose filters are invisible to them and a mouse user meets one whose current
 * state is carried only by a background colour. `aria-pressed` is the whole
 * point of the control: it is the difference between "a thing you can click" and
 * "a thing that is currently on".
 *
 * `rf-clipped` is load-bearing, not decoration. Every control in this app
 * carries a chamfer, and `clip-path` clips the focus outline along with
 * everything else the element paints - so the app's global focus ring is drawn
 * and then cut away on exactly the elements a keyboard user needs it on. That
 * class swaps it for an inset ring, which is inside the clip and survives.
 *
 * `on` is optional because two different things wear this shape: a toggle, which
 * has a pressed state, and a one-shot command like "show all", which does not.
 * Putting `aria-pressed="false"` on a command would announce a toggle that never
 * turns on.
 */
function Chip({
  on,
  label,
  count,
  disabled = false,
  title,
  onClick,
}: {
  on?: boolean;
  label: string;
  count?: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      disabled={disabled}
      title={title}
      /*
       * THE CHIPS ANSWER THE POINTER NOW.
       *
       * `mo-field` puts the chip on the document-level pointer tracker, which
       * costs one closest() per move for every chip that will ever exist
       * rather than a React handler each; `mo-sheen` draws the light it
       * writes, `mo-lift` brings the chip two pixels forward under the
       * cursor, and `mo-focusable` blooms the focus ring so a keyboard user
       * can see WHERE focus landed among a dozen identical shapes.
       *
       * Not `mo-underline`: this control is chamfered with clip-path, the
       * underline draws its rule at bottom: -2px which is outside the border
       * box, and the clip deletes it - it renders, it tracks the pointer, and
       * it is invisible. That has cost time elsewhere in this app.
       */
      className="rf-clipped mo-field mo-lift mo-sheen mo-focusable flex shrink-0 items-baseline gap-1.5 px-2.5 py-1"
      style={{
        clipPath: CHIP_CHAMFER,
        background: on === true ? 'oklch(0.30 0.06 235 / 0.6)' : 'oklch(1 0 0 / 0.04)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <span
        className="font-[family-name:var(--font-display)] text-[length:var(--text-nano)] font-semibold tracking-[0.14em] uppercase"
        style={{ color: on === true ? 'var(--text)' : 'var(--text-faint)' }}
      >
        {label}
      </span>
      {count !== undefined && (
        <span
          className="numeric text-[length:var(--text-nano)]"
          style={{ color: on === true ? 'var(--color-orokin-300)' : 'var(--text-faint)' }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** The rule between two groups of chips, so the axes read as separate questions. */
function ChipRule() {
  return <span aria-hidden className="mx-1 h-4 w-px shrink-0" style={{ background: 'oklch(1 0 0 / 0.12)' }} />;
}

/**
 * `msUntil`, with the UNREADABLE timestamp told apart from the absent one.
 *
 * `msUntil` special-cases only a falsy string. A timestamp it cannot parse
 * comes back NaN, `humanDuration(NaN)` falls through every branch to print
 * "NaNs", and `timeInk(NaN, …)` fails both comparisons and paints that row in
 * the quietest ink on the screen - so a garbled field renders as the least
 * urgent thing on a panel whose entire subject is urgency. The shared reader is
 * not this panel's to change, so every countdown drawn here comes through this
 * instead: null for a field the feed did not send and null for one it sent
 * unreadably, which are the same fact to everything downstream, and never a
 * number that is secretly not one.
 */
function leftMs(iso: string | undefined, now: number): number | null {
  if (iso == null || iso === '') return null;
  const ms = msUntil(iso, now);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Colour is pressure, not decoration.
 *
 * Amber inside the closing window, gold inside six times it, quiet beyond. One
 * function for every countdown on the panel so a fissure and a cycle flip mean
 * the same thing when they wear the same colour.
 */
function timeInk(ms: number, soon: number): string {
  if (ms <= soon) return 'var(--color-signal-warn)';
  if (ms <= soon * 6) return 'var(--color-orokin-300)';
  return 'var(--text-muted)';
}

/** Cycle colouring is the one place state maps to hue, so it must be legible. */
const CYCLE_TONE: Record<string, string> = {
  day: 'var(--color-signal-warn)',
  night: 'var(--color-tenno-400)',
  warm: 'var(--color-signal-warn)',
  cold: 'var(--color-tenno-300)',
  fass: 'var(--color-signal-bad)',
  vome: 'var(--color-tenno-400)',
  corpus: 'var(--color-tenno-400)',
  grineer: 'var(--color-signal-bad)',
};

/**
 * EVERY SECTION ON THIS PANEL IS NOW A DISCLOSURE, AND THE HEADING LOST
 * NOTHING BY IT.
 *
 * Eight sections were stacked in one scroller, every one of them permanently
 * expanded: cycles, events, traders, two dailies with three legs each, up to
 * eight Nightwave acts, ten invasions, Teshin, and twelve fissures with a bar
 * under each. Nothing could be put away, so the section a player actually came
 * for was always somewhere in the middle of the other seven.
 *
 * The heading only ever carried a title and a count. The count becomes the
 * closed row's ANSWER - and where a section has something better to say than
 * its own length, it says that instead: who is here now, what flips next, how
 * many of the running fissures survived your filters. A section that says
 * nothing when it is shut is a section nobody opens.
 *
 * `mo-arrive` is scroll-driven. That is not a style choice: the document
 * timeline on this overlay stops while the window is unpresented, and a
 * time-based section entrance would leave every section below the fold parked
 * at its first frame. A scroll timeline has no clock in it to stop.
 *
 * IT TOOK A `depth` PROP AND EVERY ONE OF THE EIGHT CALL SITES TOOK THE
 * DEFAULT, WHICH IS THE SAME AS NOT HAVING ONE.
 * ────────────────────────────────────────────────────────────────────
 * The prop existed, the CSS behind it has driven indent, rail and type size
 * since it was written, and nothing in 1,750 lines ever passed anything but 0 -
 * so the panel was eight sibling accordions with flat markup inside each, and a
 * reader could ask "how?" exactly once. The prop is gone rather than left as a
 * hook nobody reached for: a Fold IS a section, a section is always the top
 * level, and the levels below it are plain `Disclosure`s carrying their own
 * depth - which is how `RelicTree` already does it, and where the grouping in
 * `Nightwave` and `Fissures` below now lives.
 *
 * A Fold's heading treatment is section ink - uppercase, wide-tracked, orokin -
 * and that is exactly why a group must not be one. A group is a row inside a
 * section, not a second section wearing the first one's clothes.
 */
function Fold({
  title,
  eyebrow,
  answer,
  accent,
  defaultOpen = false,
  children,
}: {
  title: string;
  eyebrow?: string;
  answer?: ReactNode;
  accent?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="mo-arrive">
      <Disclosure
        depth={0}
        defaultOpen={defaultOpen}
        accent={accent}
        eyebrow={eyebrow}
        summary={
          <span
            className="rf-fold-ink mo-underline font-[family-name:var(--font-title)] text-[length:var(--text-small)] tracking-[0.26em] uppercase"
            style={{ color: 'var(--color-orokin-300)' }}
          >
            {title}
          </span>
        }
        answer={answer}
      >
        {children}
      </Disclosure>
    </section>
  );
}

/**
 * THE RULES THAT CANNOT BE WRITTEN AS UTILITIES.
 *
 * The first two drive a CHILD from a PARENT's pointer state, and a Tailwind
 * `group-hover:[--mo-on:1]` variant cannot do it here: Tailwind v4 emits
 * utilities into `@layer utilities`, motion.css is unlayered, and an unlayered
 * declaration beats a layered one at any specificity - so the variant loses to
 * `.mo-underline`'s own `--mo-on: 0` and the effect renders, tracks the
 * pointer and stays invisible. A plain rule later in document order wins.
 *
 * The third is a layout rule and lives here for the same reason rather than a
 * different one: it is a CONTAINER query, and Tailwind's `lg:`/`xl:` variants
 * are WINDOW queries. Once this panel is two panes the window stopped
 * describing the space a list has - see `.rf-cols` below. One `<style>`
 * element, so the component is named for what it now carries.
 *
 * Duplicated in the two sibling panels this pass touches rather than shared:
 * the shared home for it is `src/ui`, which this pass does not own.
 */
function PanelRules() {
  return (
    <style>{`
      /*
        A heading underlines from the whole summary row, not from the eleven
        characters of its own title - which is what mo-underline alone gives,
        because it reads --mo-on off the element it is written on.
      */
      .rf-disc-summary:hover .rf-fold-ink,
      .rf-disc-summary:focus-visible .rf-fold-ink {
        --mo-on: 1;
      }

      /*
        A row's leading edge brightens under the pointer. Colour and opacity
        only, on an element two pixels wide that carries no text, so a
        transition stranded by a stopped timeline can only ever hold the
        quieter of two visible states.
      */
      .rf-edge {
        opacity: calc(0.55 + var(--mo-on, 0) * 0.45);
        transition: opacity var(--mo-base) var(--mo-out);
      }

      @media (prefers-reduced-motion: reduce) {
        .rf-edge {
          transition: none;
        }
      }

      /*
        TWO COLUMNS WHEN THE LIST'S OWN CONTAINER IS WIDE, NEVER WHEN THE
        WINDOW IS.

        Four lists here split into two columns and every one of them asked
        Tailwind's lg: or xl: prefix - a WINDOW query. That was true enough
        while the panel was a single full-width column: window width and list
        width were the same measurement wearing two names. This pass makes the
        panel two panes, so they are now different numbers, and the window
        query reads the wrong one: at a 1280px window the narrow pane is about
        430px wide and an xl:grid-cols-2 would still fire, splitting a list of
        act titles into two 200px columns because a window somewhere else was
        roomy.

        A container query asks the element that actually constrains the list.
        Every one of these lists sits inside an .rf-disc, which sets
        container-type: inline-size for exactly this, so the query resolves
        against the disclosure the list is in - one pane wide, not one window
        wide.

        44rem is the width at which a two-up fissure row still holds "Gradivus
        (Mars) · Excavation" and a countdown without wrapping. Below it, one
        column: a pane scrolls now, so height is cheap and a cramped row is
        not.

        Unlayered and after Tailwind's own utilities, which is why it can carry
        the whole decision rather than fighting a grid-cols utility for it.
      */
      .rf-cols {
        grid-template-columns: minmax(0, 1fr);
      }
      @container (min-width: 44rem) {
        .rf-cols {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    `}</style>
  );
}

interface Timed {
  label: string;
  cycle: Cycle;
  /** Null when this read carries no readable expiry for the cycle. Never a zero. */
  left: number | null;
}

/**
 * The one bold element on the screen: whichever world flips next.
 *
 * It is the same data as the cells beside it, promoted rather than duplicated —
 * the strip is sorted by remaining time and the head of it is drawn large.
 */
function LeadCycle({ item }: { item: Timed }) {
  const tone = CYCLE_TONE[item.cycle.state.toLowerCase()] ?? 'var(--color-void-200)';

  return (
    /*
     * The lead cell takes the pointer in two parts: `mo-field` here, because
     * this is the element the document tracker writes the offsets onto, and
     * the sheen on the INNER surface, because the outer is a one-pixel
     * gradient border and a light drawn behind the fill would never be seen.
     * `mo-in-settle` is transform-only, so a stopped timeline leaves the
     * panel's one large figure slightly low rather than absent.
     */
    <div
      className="mo-field mo-tilt mo-in-settle relative isolate sm:col-span-2"
      style={{ clipPath: CHAMFER, padding: 1, background: `linear-gradient(150deg, ${tone}, transparent 72%)` }}
    >
      <div
        className="mo-sheen relative flex h-full flex-col justify-between gap-4 px-5 py-4"
        style={{
          clipPath: CHAMFER,
          background:
            'radial-gradient(120% 150% at 0% 0%, oklch(1 0 0 / 0.05), transparent 60%), linear-gradient(168deg, oklch(0.17 0.024 268 / 0.96), oklch(0.115 0.022 275 / 0.97))',
        }}
      >
        <div className="flex items-baseline gap-2.5">
          <span aria-hidden className="size-[5px] rotate-45" style={{ background: tone }} />
          <span className="eyebrow">{item.label}</span>
          {/* The eyebrow is a CLAIM about the clock beneath it, so it cannot
              stand over a cycle this read gave no readable expiry for. */}
          <span className="eyebrow ml-auto">{item.left === null ? 'no expiry in this read' : 'changes next'}</span>
        </div>

        <div>
          <div
            className="font-[family-name:var(--font-title)] text-[length:var(--text-title)] leading-none tracking-[0.14em] uppercase"
            style={{ color: tone }}
          >
            {item.cycle.state}
          </div>
          <div
            className="numeric mt-2 text-[length:var(--text-lead)] leading-none"
            style={{ color: item.left === null ? 'var(--text-muted)' : timeInk(item.left, 300_000) }}
          >
            {item.left === null ? '—' : humanDuration(item.left)}
          </div>
        </div>
      </div>
    </div>
  );
}

function CycleCell({ item, index }: { item: Timed; index: number }) {
  const tone = CYCLE_TONE[item.cycle.state.toLowerCase()] ?? 'var(--color-void-200)';

  return (
    <div
      className="rf-plate mo-field mo-sheen mo-lift mo-in-up relative px-4 py-3"
      /* `--i` rather than an inline delay: the stagger belongs to the parent,
         which caps it at twelve steps, and an inline animationDelay would
         override that cap and win. */
      style={{ clipPath: CHAMFER, background: PLATE, '--i': index } as React.CSSProperties}
    >
      <span aria-hidden className="rf-edge absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: tone }} />
      <div className="eyebrow">{item.label}</div>
      <div
        className="mt-1.5 font-[family-name:var(--font-display)] text-[length:var(--text-body)] leading-none font-semibold capitalize"
        style={{ color: tone }}
      >
        {item.cycle.state}
      </div>
      <div
        className="numeric mt-1.5 text-[length:var(--text-small)]"
        style={{ color: item.left === null ? 'var(--text-muted)' : timeInk(item.left, 300_000) }}
      >
        {item.left === null ? '—' : humanDuration(item.left)}
      </div>
    </div>
  );
}

/**
 * One trader's row. Baro and Varzia differ only in when they are here.
 *
 * `when` IS ALLOWED TO BE NULL, AND THAT IS THE WHOLE POINT OF THIS PROP.
 * ─────────────────────────────────────────────────────────────────────
 * It used to be a plain number, so a trader the feed sent without an
 * `activation` arrived here as `msUntil(undefined)` - zero - and the row
 * printed "Varzia · Maroo's Bazaar · arrives in · now" from two fields that
 * were never in the response. Null says the read carries no window for this
 * trader, which is a different sentence and the true one.
 */
function TraderRow({
  name,
  location,
  here,
  when,
  note,
}: {
  name: string;
  location: string | undefined;
  here: boolean;
  when: number | null;
  note?: string;
}) {
  return (
    <div
      className="rf-plate mo-field mo-sheen mo-lift mo-in-up relative flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3"
      style={{ clipPath: CHAMFER, background: PLATE }}
    >
      <span
        aria-hidden
        className="rf-edge absolute top-0 bottom-0 left-0 w-[2px]"
        style={{ background: here ? 'var(--color-signal-good)' : 'var(--color-void-500)' }}
      />
      <span
        className="font-[family-name:var(--font-display)] text-[length:var(--text-body)] font-semibold"
        style={{ color: here ? 'var(--color-signal-good)' : 'var(--text)' }}
      >
        {name}
      </span>
      {location != null && (
        <span className="text-[length:var(--text-small)]" style={{ color: 'var(--text-muted)' }}>
          {location}
        </span>
      )}
      {note != null && <span className="eyebrow">{note}</span>}
      {when === null ? (
        <span className="ml-auto text-[length:var(--text-small)]" style={{ color: 'var(--text-ghost)' }}>
          no window in this read
        </span>
      ) : (
        <>
          <span className="eyebrow ml-auto">{here ? 'leaves in' : 'arrives in'}</span>
          <span
            className="numeric text-[length:var(--text-body)]"
            style={{ color: here ? timeInk(when, 3_600_000) : 'var(--text-muted)' }}
          >
            {humanDuration(when)}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Everyone currently selling something.
 *
 * Baro had a section to himself; Varzia and Darvo were in the same response and
 * had nothing. They are the same question - who is here, where, and for how
 * long - so they are one section rather than three, and a player can see the
 * whole set of windows at once.
 */
function Traders({ world, now }: { world: Worldstate; now: number }) {
  const baro = world.voidTrader;
  const varzia = world.vaultTrader;
  const deal = (world.dailyDeals ?? [])[0];

  /*
   * THE GUARD TESTS WHAT THE CHILDREN TEST, AND IT DID NOT.
   *
   * The section was guarded on the three OBJECTS while each row below gated
   * itself on a field INSIDE its object - `character`, `item`. A response
   * carrying an empty `vaultTrader` and nothing else therefore survived the
   * guard and opened onto an empty region, which is the exact defect the
   * fissure section's own empty-state exists to prevent. One set of
   * conditions, named once, read by both.
   */
  const showBaro = baro != null;
  const showVarzia = varzia?.character != null;
  const showDeal = deal?.item != null;
  if (!showBaro && !showVarzia && !showDeal) return null;

  // Every window is read through `leftMs`, so a field the feed omitted and one
  // it sent unreadably both arrive as null instead of as a zero that would
  // print "arrives in · now" about a trader nobody said anything about.
  const baroOpen = leftMs(baro?.activation, now);
  const baroShut = leftMs(baro?.expiry, now);
  const baroHere = baroOpen === 0 && baroShut !== null && baroShut > 0;

  const varziaOpen = leftMs(varzia?.activation, now);
  const varziaShut = leftMs(varzia?.expiry, now);
  const varziaHere = varziaOpen === 0 && varziaShut !== null && varziaShut > 0;

  // Darvo has no activation: a deal is live while it has time left on it.
  const dealLeft = leftMs(deal?.expiry, now);
  const dealHere = showDeal && dealLeft !== null && dealLeft > 0;

  const baroWhen = showBaro ? (baroHere ? baroShut : baroOpen) : null;
  const varziaWhen = showVarzia ? (varziaHere ? varziaShut : varziaOpen) : null;

  /*
   * The closed row's answer is WHO IS HERE, which is the only thing anybody
   * opens this section to find out.
   *
   * DARVO WAS NOT IN THIS SUM, AND THE COMMENT THAT EXCUSED IT WAS FALSE.
   * ───────────────────────────────────────────────────────────────────
   * It read "the rows are always three", and all three are conditional - so a
   * night with a live Darvo deal and neither trader in town said "none here
   * now" over an offer sitting one press below. He counts.
   *
   * `unread` is the other half of the same rule: a row whose window this read
   * does not carry cannot be counted as here, and it must not be silently
   * counted as absent either. It is stated beside the count rather than folded
   * into it.
   */
  const hereNow = (baroHere ? 1 : 0) + (varziaHere ? 1 : 0) + (dealHere ? 1 : 0);
  const unread =
    (showBaro && baroWhen === null ? 1 : 0) +
    (showVarzia && varziaWhen === null ? 1 : 0) +
    (showDeal && dealLeft === null ? 1 : 0);

  return (
    <Fold
      title="Traders"
      eyebrow="who is selling, and for how long"
      answer={
        <span style={{ color: hereNow > 0 ? 'var(--color-signal-good)' : 'var(--text-muted)' }}>
          {hereNow === 0 ? 'none here now' : `${String(hereNow)} here now`}
          {unread > 0 && (
            <span style={{ color: 'var(--text-ghost)' }}>
              {' '}
              &middot; {unread === 1 ? 'one window' : `${String(unread)} windows`} not in this read
            </span>
          )}
        </span>
      }
    >
      <div className="mo-stagger grid gap-[3px]">
        {baro != null && <TraderRow name={baro.character} location={baro.location} here={baroHere} when={baroWhen} />}
        {varzia?.character != null && (
          <TraderRow
            name={varzia.character}
            location={varzia.location}
            here={varziaHere}
            when={varziaWhen}
            note="Prime Resurgence"
          />
        )}
        {deal?.item != null && (
          <div
            className="rf-plate mo-field mo-sheen mo-lift mo-in-up relative flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3"
            style={{ clipPath: CHAMFER, background: PLATE }}
          >
            <span aria-hidden className="rf-edge absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: 'var(--color-orokin-500)' }} />
            <span
              className="font-[family-name:var(--font-display)] text-[length:var(--text-body)] font-semibold"
              style={{ color: 'var(--text)' }}
            >
              {deal.item}
            </span>
            <span className="eyebrow">Darvo</span>
            {deal.salePrice != null && (
              <span className="numeric text-[length:var(--text-small)]" style={{ color: 'var(--color-orokin-300)' }}>
                {deal.salePrice.toLocaleString()} platinum
                {deal.discount != null && deal.discount > 0 && (
                  <span style={{ color: 'var(--text-muted)' }}> &middot; {deal.discount}% off</span>
                )}
              </span>
            )}
            {/* Stock is the reason to hurry as much as the clock is. */}
            {deal.total != null && deal.sold != null && deal.total > 0 && (
              <span className="numeric text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
                {Math.max(0, deal.total - deal.sold).toLocaleString()} of {deal.total.toLocaleString()} left
              </span>
            )}
            {/* A deal with no expiry printed "ends in · now" in the urgent ink,
                from a field the response never carried, over an offer that may
                have all day left on it. */}
            {dealLeft === null ? (
              <span className="ml-auto text-[length:var(--text-small)]" style={{ color: 'var(--text-ghost)' }}>
                no window in this read
              </span>
            ) : (
              <>
                <span className="eyebrow ml-auto">ends in</span>
                <span className="numeric text-[length:var(--text-body)]" style={{ color: timeInk(dealLeft, 3_600_000) }}>
                  {humanDuration(dealLeft)}
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </Fold>
  );
}

/** A live in-game event - a tactical alert, an operation. Rare, and worth the top. */
function Events({ world, now }: { world: Worldstate; now: number }) {
  /*
   * ABSENT IS NOT EXPIRED, AND THIS FILTER USED TO SAY IT WAS.
   *
   * `msUntil(e.expiry ?? '')` is zero for an event the feed sent without an
   * expiry, so `> 0` deleted it - and this component returns null on an empty
   * list, so a live event carrying a description and no clock took the whole
   * section with it, silently, with nothing anywhere saying an event had been
   * withheld. Only an event we can PROVE has run out is dropped now.
   */
  const live = (world.events ?? []).filter((e) => {
    if (e.description == null) return false;
    const left = leftMs(e.expiry, now);
    return left === null || left > 0;
  });
  if (live.length === 0) return null;

  // The closed row carries the clock, not the count: an event is rare and the
  // only question about one is how long it is still there for. Reduced over the
  // events that CARRY a clock, for the reason the filter above exists: a zero
  // folded in from an absent field would report the section as expiring now.
  const timed = live.flatMap((e) => {
    const left = leftMs(e.expiry, now);
    return left === null ? [] : [left];
  });
  const soonest = timed.length === 0 ? null : Math.min(...timed);

  return (
    <Fold
      title="Live event"
      eyebrow={live.length === 1 ? 'running now' : `${String(live.length)} running now`}
      accent="var(--color-signal-rare)"
      answer={
        soonest === null ? (
          <span style={{ color: 'var(--text-ghost)' }}>no expiry in this read</span>
        ) : (
          <span className="numeric" style={{ color: timeInk(soonest, 86_400_000) }}>
            {humanDuration(soonest)} left
          </span>
        )
      }
    >
      <div className="mo-stagger grid gap-[3px]">
        {live.map((e, i) => {
          const left = leftMs(e.expiry, now);
          return (
          <div
            key={e.id}
            className="rf-plate mo-field mo-sheen mo-lift mo-in-up relative flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3"
            style={{ clipPath: CHAMFER, background: PLATE, '--i': i } as React.CSSProperties}
          >
            <span aria-hidden className="rf-edge absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: 'var(--color-signal-rare)' }} />
            <span
              className="font-[family-name:var(--font-display)] text-[length:var(--text-body)] font-semibold"
              style={{ color: 'var(--color-signal-rare)' }}
            >
              {e.description}
            </span>
            {e.node != null && (
              <span className="text-[length:var(--text-small)]" style={{ color: 'var(--text-muted)' }}>
                {e.node}
              </span>
            )}
            {e.faction != null && <span className="eyebrow">{e.faction}</span>}
            {left === null ? (
              <span className="ml-auto text-[length:var(--text-small)]" style={{ color: 'var(--text-ghost)' }}>
                no expiry in this read
              </span>
            ) : (
              <>
                <span className="eyebrow ml-auto">ends in</span>
                <span className="numeric text-[length:var(--text-body)]" style={{ color: timeInk(left, 86_400_000) }}>
                  {humanDuration(left)}
                </span>
              </>
            )}
          </div>
          );
        })}
      </div>
    </Fold>
  );
}


/* ------------------------------------------------------------------ urgency */

/**
 * A row's remaining time, drawn.
 *
 * THE PROBLEM THIS SOLVES
 * ───────────────────────
 * Every single row in this panel is a countdown, and they were all set in the
 * same size and weight - so "5m 9s" and "38m 58s" looked identical and twelve
 * fissures read as an undifferentiated wall of numbers. The panel's entire
 * subject is time and time was the one thing it did not express visually. You
 * had to read and compare every row to find the one about to expire, which is
 * the only question anyone opens this panel to answer.
 *
 * WHY RELATIVE AND NOT ABSOLUTE
 * ─────────────────────────────
 * worldState gives an expiry but no activation for a fissure, so there is no
 * honest way to say "40% of its life remains" - the total life is unknown. What
 * IS knowable is how this row compares to the others on screen, which happens to
 * be the actual question: of the things listed here, which goes first. So the
 * scale is the longest remaining time in the same list, exactly the convention
 * the rest of this app already uses for bars it cannot anchor absolutely.
 *
 * The bar is deliberately the only new ink. Urgency is already carried by
 * `timeInk` on the figure; this makes the ORDER legible without reading.
 */
function TimeBar({ left, longest }: { left: number; longest: number }) {
  // Never zero-width: a row that is about to expire is the most important row
  // in the list, and a bar of nothing reads as "no data" rather than "hurry".
  //
  // The floor sits OUTSIDE the branch, which is the fix rather than a tidy-up.
  // It used to be inside, so `longest === 0` returned a literal 0 - and
  // `longest === 0` is precisely the case where every row in the group is
  // already at zero, i.e. the whole point of the sentence above. The rule the
  // comment states has no exception, so the code may not have one either.
  const frac = Math.max(0.04, longest > 0 ? Math.min(1, left / longest) : 0);
  const ink = timeInk(left, 600_000);
  return (
    <span
      aria-hidden
      className="mt-1.5 block h-[2px] w-full overflow-hidden"
      style={{ background: 'oklch(1 0 0 / 0.05)' }}
    >
      <span
        className="block h-full"
        style={{
          width: `${String(frac * 100)}%`,
          background: ink,
          // The urgent ones are the only thing on the panel that glows. One bold
          // move, and it is spent on the row you most need to see.
          boxShadow: left < 600_000 ? `0 0 6px ${ink}` : 'none',
        }}
      />
    </span>
  );
}

/* ------------------------------------------------------- node cross-linking */

/**
 * Display name -> star-chart node id.
 *
 * worldState names a mission the way the game prints it - "Gradivus (Mars)" -
 * while every other part of this app addresses nodes by their internal id
 * (`SolNode30`). Without this join, the single most obviously clickable thing in
 * the panel - a live fissure sitting on a named node - stays inert text, and the
 * player has to go and find it on the chart by hand.
 *
 * Built once and cached at module scope: the catalog is already fetched for the
 * star chart, and worldState refreshes far more often than the node list ever
 * changes.
 */
let nodeIdByName: ReadonlyMap<string, string> | null = null;

function useNodeIds(): ReadonlyMap<string, string> | null {
  const [map, setMap] = useState<ReadonlyMap<string, string> | null>(nodeIdByName);

  useEffect(() => {
    if (nodeIdByName !== null) return;
    let alive = true;
    void loadCatalog()
      .then((c) => {
        const built = new Map<string, string>();
        for (const n of c.catalog.nodeById.values()) built.set(n.name.toLowerCase(), n.id);
        nodeIdByName = built;
        if (alive) setMap(built);
      })
      .catch(() => {
        // A failed catalog costs the links and nothing else - the panel's own
        // data is unaffected, so the names simply stay as plain text.
        nodeIdByName = new Map();
      });
    return () => {
      alive = false;
    };
  }, []);

  return map;
}

/**
 * A mission name, linked to the chart when we can prove which node it is.
 *
 * Falls back to plain text rather than a dead link. A control that looks
 * clickable and does nothing is worse than no control - it is the exact
 * complaint this pass exists to answer.
 */
function NodeName({ label, ids }: { label: string; ids: ReadonlyMap<string, string> | null }) {
  // worldState prints "Gradivus (Mars)"; the catalog stores "Gradivus".
  const bare = label.replace(/\s*\(.*\)\s*$/, '').trim();
  const id = ids?.get(bare.toLowerCase());
  if (id === undefined) return <>{label}</>;
  return (
    <GoLink kind="node" id={id} title={`Show ${bare} on the star chart`}>
      {label}
    </GoLink>
  );
}

/**
 * Steel Path is a different run, not a harder version of the same one.
 *
 * A player is either doing Steel Path tonight or is not, and mixing the two in
 * one list means half of every screenful is unusable to them. So it filters on
 * its own axis rather than as one more tier chip - the two questions compose,
 * and "Axi on Steel Path" is a thing you can ask for.
 */
type PathFilter = 'all' | 'normal' | 'steel';
const PATHS: readonly PathFilter[] = ['all', 'normal', 'steel'];
const PATH_LABEL: Record<PathFilter, string> = { all: 'Both paths', normal: 'Normal', steel: 'Steel path' };

/**
 * How many fissures fit in ONE TIER before that group stops being scannable.
 *
 * It was twelve across the whole list, and a flat cap on a mixed list is the
 * cap doing the grouping's job badly: the reader who wants Axi is hoping Axi
 * happens to be among the twelve most urgent fissures running, and when it is
 * not, the section quietly shows them somebody else's tier. The cap belongs per
 * group, exactly as `RelicTree` caps per tier - open Neo and you get the most
 * urgent Neo fissures whether or not Lith is having a busy night, and the rows
 * left out are counted by the group that left them out rather than by a line at
 * the bottom of the section restating arithmetic the heading already did.
 */
const TIER_ROWS = 8;

function Fissures({
  world,
  now,
  ids,
  stock,
}: {
  world: Worldstate;
  now: number;
  ids: ReadonlyMap<string, string> | null;
  stock: RelicStock;
}) {
  /*
   * The filters persist, because a filter that resets is decorative.
   *
   * This panel is opened beside a running game and closed again dozens of times
   * in a session, and the component unmounts every time. A player who only ever
   * runs Steel Path should say so once, not once per opening.
   *
   * THE TIER FILTER IS GONE, AND IT IS NOT A LOST CONTROL.
   * ─────────────────────────────────────────────────────
   * Tier is the grouping key now, and a key cannot be spent twice: a chip row
   * that narrows to Axi in front of a list already divided into tiers leaves
   * one group open and five deleted, which is the same reading with less of the
   * board visible. `RelicTree` names this exact fault in its own header - two
   * grouping keys both spent on hiding things - and grouping is the fix, not a
   * companion to the filter. Path and held-relics survive because neither is a
   * grouping key here: they cut ACROSS every tier, which is what makes them
   * compose with the groups instead of competing with them.
   *
   * The persisted `ws.fissureTiers` key is simply no longer read. Deleting a
   * player's stored preference on their behalf would be a worse trade than
   * leaving four bytes in localStorage.
   */
  const [path, setPath] = usePersisted<PathFilter>(
    'ws.fissurePath',
    'all',
    (v) => v,
    (raw) => oneOf(raw, PATHS, 'all'),
  );
  const [heldOnly, setHeldOnly] = usePersisted<boolean>(
    'ws.fissureHeld',
    false,
    (v) => v,
    (raw) => bool(raw, false),
  );

  // Urgency first: a relic run you can still reach beats a tidy tier ordering.
  // The sort survives grouping and does two jobs now - it orders the rows inside
  // a group, and because the groups are built by walking this list, it orders
  // the groups themselves by whichever tier has the next fissure to expire.
  const live = useMemo(
    () =>
      (world.fissures ?? [])
        .filter((f) => f.active !== false && msUntil(f.expiry, now) > 0)
        .sort((a, b) => msUntil(a.expiry, now) - msUntil(b.expiry, now) || a.tierNum - b.tierNum),
    [world, now],
  );

  /*
   * A FILTER NOBODY CAN EVALUATE MUST NOT BE ABLE TO HIDE ANYTHING.
   *
   * `heldOnly` persists, so it can come back true into a session where the
   * account has not been read. Applying it then would delete the entire list on
   * the strength of a number that does not exist, and the player would read that
   * empty list as "you hold no relics at all". So the stored preference is kept
   * - they did ask for it - and simply not applied until it can be answered, and
   * the chip says why it is unavailable rather than silently doing nothing.
   */
  const canFilterByStock = stock.byTier !== null;

  const shown = useMemo(
    () =>
      live.filter((f) => {
        if (path === 'steel' && f.isHard !== true) return false;
        if (path === 'normal' && f.isHard === true) return false;
        /*
         * `met === false`, not `met !== true`.
         *
         * The difference is the Omnia rows. Their tier is not in the relic
         * table at all, so `met` is null even on a perfectly read account, and
         * `!== true` swept them out alongside the tiers we had genuinely
         * measured as empty - which is treating an unknown as a zero, in the
         * one place on this panel where the cost is a row silently vanishing.
         * Only a MEASURED empty tier is hidden here, exactly as only a measured
         * empty tier is dimmed below.
         */
        if (heldOnly && canFilterByStock && tierNeed(stock, f.tier).met === false) return false;
        return true;
      }),
    [live, path, heldOnly, canFilterByStock, stock],
  );

  /*
   * One group per tier that is actually running one.
   *
   * Built by walking the already-sorted list rather than by sorting tier names,
   * so a tier appears exactly when its first fissure does and the group order
   * is the urgency order the section promises in its eyebrow. A tier with
   * nothing running has no group, which is the difference between a level and
   * a row of empty drawers.
   */
  const groups = useMemo(() => {
    const byTier = new Map<string, Fissure[]>();
    for (const f of shown) {
      const rows = byTier.get(f.tier);
      if (rows === undefined) byTier.set(f.tier, [f]);
      else rows.push(f);
    }
    return [...byTier.entries()];
  }, [shown]);

  const filtering = path !== 'all' || (heldOnly && canFilterByStock);

  const clear = (): void => {
    setPath('all');
    setHeldOnly(false);
  };

  if (live.length === 0) return null;

  return (
    <Fold
      title="Void fissures"
      eyebrow="soonest to expire, first"
      /*
       * THE ONE SECTION IN THE LEFT PANE THAT OPENS ITSELF, AND THE REASON IS
       * THE NEW SHAPE RATHER THAN A CHANGE OF MIND.
       * ─────────────────────────────────────────────────────────────────────
       * Every section on this panel was closed on purpose: measured at 1280 x
       * 720 the panel emitted 803 px into a 672 px viewport with nothing but
       * the cycle strip open, so one more open section was one more push past
       * the bottom of the window. Under a fixed-height grid that cost is gone
       * - this section sits in a pane that scrolls inside itself, so opening
       * it moves nothing else on the screen.
       *
       * What was left was the opposite fault: an answer pane holding three
       * closed drawers and four hundred pixels of air, which reads as a broken
       * panel rather than as a tidy one. This is the list the pane exists for
       * - it is the only section here that names a place to go right now - so
       * it is the one that opens.
       */
      defaultOpen
      /*
       * THE ONLY PLACE THIS ARITHMETIC IS STATED.
       *
       * It used to be here as "3 of 11 running" AND again at the foot of the
       * section as "8 hidden by these filters" plus "2 more past the 12 shown"
       * - three sentences, one subtraction, on one screen. The closed row is
       * the right home for it, because it is the one thing a collapsed filter
       * must never hide: a reader who narrowed to Steel Path and put the
       * section away can still see they are looking at part of the board. What
       * a GROUP left out is a different number about a different set, and is
       * stated by that group.
       */
      answer={
        <span className="numeric">
          {shown.length === live.length
            ? `${String(live.length)} running`
            : `${String(shown.length)} of ${String(live.length)} running`}
        </span>
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {PATHS.map((p) => (
          <Chip
            key={p}
            on={path === p}
            label={PATH_LABEL[p]}
            onClick={() => {
              setPath(p);
            }}
          />
        ))}

        <ChipRule />
        <Chip
          on={heldOnly && canFilterByStock}
          label="Relics I hold"
          disabled={!canFilterByStock}
          title={canFilterByStock ? 'Only fissures you are holding a relic for' : (stock.unknown ?? undefined)}
          onClick={() => {
            setHeldOnly(!heldOnly);
          }}
        />

        {filtering && (
          <Chip
            label="Show all"
            onClick={() => {
              clear();
            }}
          />
        )}
      </div>

      {/* The unknown is stated once, in words, rather than repeated as a symbol
          on every row. It names what would settle it, which is the only useful
          thing to say about a number nobody has. */}
      {stock.unknown !== null && (
        <div className="mb-2 text-[length:var(--text-micro)]" style={{ color: 'var(--text-faint)' }}>
          {/* Clamped, not shortened. The reason a count is unknown names what
              would settle it, which is the only useful thing to say about a
              number nobody has - and it is also the longest sentence in this
              section, sitting above the list every time the account has not
              been read. Two lines, then a press. */}
          <Clamp lines={2}>Relics you hold: unknown &mdash; {stock.unknown}.</Clamp>
        </div>
      )}

      {groups.length === 0 ? (
        /* Never a blank region. The filters emptied it, so the panel says how
           many rows they hid and hands back the way out in the same breath. */
        <div className="rf-plate flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" style={{ clipPath: CHAMFER, background: PLATE }}>
          <p className="wf-note">
            {live.length === 1
              ? 'One fissure is running and these filters hide it.'
              : `All ${String(live.length)} running fissures are hidden by these filters.`}
          </p>
          <Chip
            label="Show all"
            onClick={() => {
              clear();
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-[3px]">
          {groups.map(([tier, rows], gi) => {
            const held = tierNeed(stock, tier);
            const capped = rows.slice(0, TIER_ROWS);
            // The scale for every bar in this group. See TimeBar. Per tier now,
            // because comparing a Requiem hour against an Axi ten minutes told
            // the reader nothing they were going to act on.
            const longest = capped.reduce((m, f) => Math.max(m, msUntil(f.expiry, now)), 0);
            const soonest = rows.reduce((m, f) => Math.min(m, msUntil(f.expiry, now)), Number.POSITIVE_INFINITY);
            /*
             * DIMMED, NOT DELETED, AND ONLY WHEN THE ZERO IS REAL.
             *
             * A tier you hold no relic for is still worth knowing about - it is
             * what you would refine a relic for, and it tells you what the
             * rotation is doing - so the group stays in the list and loses
             * contrast instead of its place. The condition is `have === 0` and
             * not `met !== true` on purpose: an unknown count must never dim
             * anything, because dimming it would be asserting the emptiness we
             * have not measured. The dim moved from the rows to the list they
             * sit in, because holding no Axi relics is one fact about Axi, not
             * the same fact restated on each of its four fissures.
             */
            const empty = held.have === 0;
            return (
              <Disclosure
                key={tier}
                depth={1}
                /* The most urgent tier opens with the section, so a glance
                   costs one press rather than two. */
                defaultOpen={gi === 0}
                eyebrow={rows.length === 1 ? '1 running' : `${String(rows.length)} running`}
                summary={<span style={{ color: 'var(--text)' }}>{tier}</span>}
                answer={
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="numeric" style={{ color: timeInk(soonest, 600_000) }}>
                      {humanDuration(soonest)}
                    </span>
                    {/* The key count, on the group that IS the lock. Three
                        states, three different words: a number, "none held",
                        "held: unknown". The last is deliberately not a numeral,
                        so it cannot be skimmed as a quantity by somebody
                        reading down the column.

                        THE TITLE IS ONLY CARRIED WHEN IT SAYS SOMETHING NEW.
                        `tierNeed` falls back to `stock.unknown` for every tier
                        when the account is unread - the same sentence for all
                        of them - and that sentence is already printed in words
                        above the list. Attached here unconditionally it became
                        the section's own line said once as prose and again on
                        each of six tier groups, against the comment above that
                        list claiming it is "stated once, in words". Only the
                        per-tier reason - the Omnia one, which the section
                        cannot state - survives. */}
                    <span
                      className="numeric"
                      style={{ color: held.met === true ? 'var(--color-orokin-300)' : 'var(--text-faint)' }}
                      title={held.unknown === stock.unknown ? undefined : held.unknown}
                    >
                      {stockLabel(held.have)}
                    </span>
                  </span>
                }
              >
                <ul
                  className="rf-cols mo-stagger grid gap-[3px]"
                  /* A plain style value, and it stays one: this is a STATE, and
                     a state that arrives by transition can be stranded
                     half-applied on a stopped timeline. */
                  style={{ opacity: empty ? 0.55 : 1 }}
                >
                  {capped.map((f, i) => {
                    const left = msUntil(f.expiry, now);
                    return (
                      <li
                        key={f.id}
                        className="rf-plate mo-field mo-sheen mo-lift mo-in-up relative flex flex-wrap items-baseline gap-x-3 py-2 pr-3 pl-4"
                        style={{ clipPath: CHAMFER, background: PLATE, '--i': i } as React.CSSProperties}
                      >
                        <span
                          aria-hidden
                          className="rf-edge absolute top-0 bottom-0 left-0 w-[2px]"
                          style={{ background: f.isHard ? 'var(--color-signal-bad)' : 'var(--color-tenno-400)' }}
                        />
                        {/* NO TIER LABEL. The row sits inside its own tier's
                            group, so printing "Axi" on all four of them is the
                            grouping key rendered once per row - the shape
                            grouping exists to replace. The 4.5rem it used to
                            reserve goes to the node name, which is the part
                            that was being truncated. */}
                        <span className="min-w-0 flex-1 text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
                          <NodeName label={f.node} ids={ids} />
                          <span style={{ color: 'var(--text-muted)' }}> · {f.missionType}</span>
                        </span>
                        {f.isStorm && (
                          <span className="eyebrow shrink-0" style={{ color: 'var(--color-tenno-300)' }}>
                            Storm
                          </span>
                        )}
                        {f.isHard && (
                          <span className="eyebrow shrink-0" style={{ color: 'var(--color-signal-bad)' }}>
                            Steel path
                          </span>
                        )}
                        <span className="numeric shrink-0 text-[length:var(--text-small)]" style={{ color: timeInk(left, 600_000) }}>
                          {humanDuration(left)}
                        </span>
                        {/* Full width, under the row: the bars line up as one
                            column and the group's ordering becomes something
                            you see rather than read. */}
                        <span className="basis-full">
                          <TimeBar left={left} longest={longest} />
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {/* Counted by the group that left them out, so it is a fact
                    about this tier rather than the section's own arithmetic
                    said a second time. */}
                {rows.length > capped.length && (
                  <p className="eyebrow mt-2" style={{ color: 'var(--text-faint)' }}>
                    {rows.length - capped.length} more {tier} fissures, every one expiring after these
                  </p>
                )}
              </Disclosure>
            );
          })}
        </div>
      )}
    </Fold>
  );
}

/* ------------------------------------------------------- daily missions */

/**
 * Sortie and Archon Hunt.
 *
 * BOTH OF THESE WERE ALREADY BEING FETCHED AND NEITHER WAS EVER DRAWN. The
 * worldState read that powers this panel carries `sortie` and `archonHunt` in
 * full - three missions each, their nodes, their modifiers, the boss and the
 * faction - and the panel rendered cycles, Baro and fissures and stopped. Two of
 * the three things a player actually opens a companion app to check were sitting
 * in the parsed payload, unrendered.
 *
 * Every node named here is linked, for the same reason the fissures are: these
 * are places, and the app knows where they are.
 */
function DailyMissions({ world, now, ids }: { world: Worldstate; now: number; ids: ReadonlyMap<string, string> | null }) {
  /*
   * Which of the two you are here for, remembered.
   *
   * The hook sits above the early return because it has to: hooks cannot be
   * skipped conditionally, and `sortie` being absent for a rotation would
   * otherwise change the hook order between renders.
   *
   * An empty set means "both", not "neither". That is the same convention the
   * fissure tiers use, and it is the right default because a filter nobody has
   * touched should not be hiding anything.
   */
  const [picked, setPicked] = usePersisted<Set<string>>('ws.dailyBlocks', new Set<string>(), (v) => [...v], strSet);

  const sortie = world.sortie;
  const archon = world.archonHunt;
  if (!sortie && !archon) return null;

  // Both run on the same daily clock, so they belong in one block rather than
  // two sections that would always expire together.
  const blocks: Array<{
    key: string;
    title: string;
    boss: string | undefined;
    faction: string | undefined;
    expiry: string;
    ink: string;
    legs: Array<{ type: string; node: string; modifier?: string }>;
  }> = [];

  if (sortie) {
    blocks.push({
      key: 'sortie',
      title: 'Sortie',
      boss: sortie.boss,
      faction: sortie.faction,
      expiry: sortie.expiry,
      ink: 'var(--color-orokin-400)',
      legs: (sortie.variants ?? []).map((v) => ({ type: v.missionType, node: v.node, modifier: v.modifier })),
    });
  }
  if (archon) {
    blocks.push({
      key: 'archon',
      title: 'Archon hunt',
      boss: archon.boss,
      faction: archon.faction,
      expiry: archon.expiry,
      ink: 'var(--color-signal-rare)',
      legs: (archon.missions ?? []).map((m) => ({ type: m.type, node: m.node })),
    });
  }

  /*
   * The legs are NOT filterable and that is deliberate.
   *
   * A sortie is three missions you have to run in order to be paid; hiding one
   * of them would be hiding part of a thing you still have to do. What a player
   * genuinely wants to drop is a whole daily - somebody who does not run archon
   * hunts wants that plate gone every day, not once. So the axis is the block,
   * which is the only cut here that does not lie about what the day requires.
   */
  const shown = picked.size === 0 ? blocks : blocks.filter((b) => picked.has(b.key));

  // Both blocks run on the same daily clock, so the soonest of them IS the
  // section's clock. Guarded against an emptied filter rather than reduced
  // from Infinity: humanDuration of Infinity is not a duration - and a block
  // whose expiry this read cannot state is skipped for the same reason, since
  // a NaN folded in here would come out of `humanDuration` as "NaNs".
  const clocks = shown.flatMap((b) => {
    const left = leftMs(b.expiry, now);
    return left === null ? [] : [left];
  });
  const soonest = clocks.length === 0 ? null : Math.min(...clocks);

  return (
    <Fold
      title="Daily missions"
      eyebrow="sortie and archon hunt"
      answer={
        shown.length === 0 ? (
          <span style={{ color: 'var(--text-faint)' }}>hidden by a filter</span>
        ) : soonest === null ? (
          <span style={{ color: 'var(--text-ghost)' }}>no expiry in this read</span>
        ) : (
          <span className="numeric" style={{ color: timeInk(soonest, 3_600_000) }}>
            {humanDuration(soonest)} left
          </span>
        )
      }
    >

      {/* One block on its own has nothing to be narrowed against, and a filter
          that can only ever hide everything is not a control. */}
      {blocks.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {blocks.map((b) => (
            <Chip
              key={b.key}
              on={picked.size === 0 || picked.has(b.key)}
              label={b.title}
              /* NO COUNT WHEN THERE IS NO LIST. `variants` is absent on some
                 rotations, and printing its length gave "SORTIE 0" three lines
                 above the block's own "The mission list is not in this
                 worldstate read." - the chip asserting the day pays nothing
                 while the body said it did not know. Absent is not zero, so
                 the chip carries no number at all. */
              count={b.legs.length === 0 ? undefined : String(b.legs.length)}
              title={`Show ${b.title}`}
              onClick={() => {
                setPicked((prev) => {
                  /*
                   * The first press means "only this one".
                   *
                   * Starting from "both are on", toggling the pressed chip off
                   * would leave the other one on and the set holding one entry -
                   * the same visible result as selecting it, by a route that
                   * reads backwards. Selecting from the all-on state selects.
                   */
                  if (prev.size === 0) return new Set([b.key]);
                  const next = new Set(prev);
                  if (!next.delete(b.key)) next.add(b.key);
                  return next;
                });
              }}
            />
          ))}
          {picked.size > 0 && (
            <Chip
              label="Show all"
              onClick={() => {
                setPicked(new Set<string>());
              }}
            />
          )}
        </div>
      )}

      {shown.length === 0 && (
        <div className="rf-plate flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" style={{ clipPath: CHAMFER, background: PLATE }}>
          <p className="wf-note">
            {blocks.map((b) => b.title).join(' and ')} are running today; this filter hides both.
          </p>
          <Chip
            label="Show all"
            onClick={() => {
              setPicked(new Set<string>());
            }}
          />
        </div>
      )}

      <div className="rf-cols mo-stagger grid gap-[3px]">
        {shown.map((b, i) => {
          const left = leftMs(b.expiry, now);
          return (
            <div
              key={b.key}
              className="rf-plate mo-field mo-sheen mo-lift mo-in-up relative px-4 py-3"
              style={{ clipPath: CHAMFER, background: PLATE, '--i': i } as React.CSSProperties}
            >
              <span aria-hidden className="rf-edge absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: b.ink }} />

              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span
                  className="font-[family-name:var(--font-display)] text-[length:var(--text-small)] font-semibold"
                  style={{ color: b.ink }}
                >
                  {b.title}
                </span>
                {/* Absent fields disappear rather than printing "unknown": the
                    payload omits them on some rotations and a placeholder would
                    read as a fact about the rotation. */}
                {b.boss !== undefined && (
                  <span className="text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
                    {b.boss}
                  </span>
                )}
                {b.faction !== undefined && <span className="eyebrow">{b.faction}</span>}
                <span
                  className="numeric ml-auto text-[length:var(--text-small)]"
                  style={{ color: left === null ? 'var(--text-muted)' : timeInk(left, 3_600_000) }}
                >
                  {left === null ? '—' : humanDuration(left)}
                </span>
              </div>

              {b.legs.length === 0 ? (
                <p className="wf-note mt-2">
                  The mission list is not in this worldstate read.
                </p>
              ) : (
                <ol className="mo-stagger mt-2.5 flex flex-col gap-1.5">
                  {b.legs.map((leg, i) => (
                    <li
                      key={`${leg.node}:${String(i)}`}
                      className="mo-in-left flex items-baseline gap-2.5"
                      style={{ '--i': i } as React.CSSProperties}
                    >
                      <span
                        className="numeric shrink-0 text-[length:var(--text-micro)]"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {i + 1}
                      </span>
                      {/* The node and its mission type are the leg's identity and
                          get their own width; the modifier is the long free text,
                          so it takes the remainder and wraps. The other way round,
                          the modifier won the row and broke "Mobile Defense" over
                          two lines. */}
                      <span className="shrink-0 text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
                        <NodeName label={leg.node} ids={ids} />
                        <span style={{ color: 'var(--text-muted)' }}> &middot; {leg.type}</span>
                      </span>
                      {leg.modifier !== undefined && (
                        <span
                          className="min-w-0 flex-1 text-right text-[length:var(--text-micro)]"
                          style={{ color: 'var(--color-signal-warn)' }}
                        >
                          {leg.modifier}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>
    </Fold>
  );
}


/* ---------------------------------------------------------------- nightwave */

/**
 * DE's own untranslated-string marker.
 *
 * The live feed ships acts whose description is literally
 * "[PH] Season Weekly Hard Zariman Bounty Hunter Desc" - a placeholder the game
 * has not filled in yet. Rendering it verbatim puts a developer TODO in front of
 * a player, which is worse than showing nothing: the title already carries the
 * meaning, and an absent description is honest about a string that genuinely
 * does not exist yet.
 */
function published(text: string | undefined): string | undefined {
  if (text == null) return undefined;
  const t = text.trim();
  if (t.length === 0 || t.startsWith('[PH]')) return undefined;
  return t;
}

/**
 * THE GROUPING KEY WAS ALREADY BEING COMPUTED AND WAS BEING SPENT ON A COLOUR.
 * ───────────────────────────────────────────────────────────────────────────
 * `isElite` and `isDaily` were read on every act to pick an ink and to print
 * one of three words at the head of the row. Thirteen rows, each carrying the
 * word "Daily" or "Weekly" - which is the grouping key rendered once per row
 * instead of once, the exact shape grouping replaces. The sort already put
 * Elite first and dailies last, so the ORDER of the groups is not a new
 * decision either; it is the one the flat list was already making silently.
 *
 * Neither flag set means weekly. That reading is the one this panel already
 * shipped and it is preserved verbatim rather than promoted into a fourth
 * "unknown" group: the feed sends the flags on every act it sends at all, and a
 * bucket that exists only for a payload nobody has seen is a level that can
 * only ever be empty.
 */
type Cadence = 'Elite' | 'Weekly' | 'Daily';

const CADENCES: readonly Cadence[] = ['Elite', 'Weekly', 'Daily'];

const CADENCE_INK: Readonly<Record<Cadence, string>> = {
  Elite: 'var(--color-signal-rare)',
  Weekly: 'var(--color-orokin-400)',
  Daily: 'var(--color-tenno-400)',
};

const cadenceOf = (a: NightwaveAct): Cadence =>
  a.isElite === true ? 'Elite' : a.isDaily === true ? 'Daily' : 'Weekly';

/**
 * Depth 2: one act. The title is the summary, and what it ASKS is the body.
 *
 * The two used to be one line joined by a middot, and the comment beside the
 * grid said what that cost: an act title is a full sentence, so at the
 * overlay's narrower widths the row wrapped to two or three lines - which is
 * why the list was only allowed two columns above 1280px. A title names the
 * act; a description is an instruction you read once and then go and do. Moving
 * the instruction one level down shortens the row without deleting a word of it.
 *
 * AN ACT WITH NO DESCRIPTION IS NOT A DISCLOSURE. There would be nothing behind
 * the chevron, and a level with nothing under it is worse than no level - the
 * same rule `RewardRow` follows for a reward the market cannot price. The
 * cadence is not printed here either: the row sits inside its own cadence
 * group, and the group's accent already carries it on the rail.
 */
function ActRow({
  act,
  index,
  longest,
  now,
}: {
  act: NightwaveAct;
  index: number;
  longest: number;
  now: number;
}) {
  const title = published(act.title);
  const desc = published(act.desc);
  const summary = title ?? desc ?? 'Act';
  // The description is the body only when it is not already the summary.
  const body = title === undefined ? undefined : desc;
  const left = leftMs(act.expiry, now);

  /*
   * What the act pays and how long it pays it for, on the closed row. An act
   * with no reputation figure shows none rather than a zero: the feed omits the
   * field on some acts and drawing a 0 there would be a claim about the reward.
   *
   * An act with no expiry now SAYS so instead of showing nothing. It is sorted
   * to the end of its group and it draws no TimeBar, so a silent blank made it
   * look like a row the layout had simply run out of things to say about -
   * rather than the one row on the panel whose clock is not in the read.
   */
  const answer = (
    <span className="flex flex-wrap items-baseline gap-2">
      {act.reputation != null && act.reputation > 0 && (
        <span className="numeric" style={{ color: 'var(--color-orokin-300)' }}>
          {act.reputation.toLocaleString()}
        </span>
      )}
      {left === null ? (
        <span style={{ color: 'var(--text-ghost)' }}>no expiry in this read</span>
      ) : (
        <span className="numeric" style={{ color: timeInk(left, 3_600_000) }}>
          {humanDuration(left)}
        </span>
      )}
    </span>
  );

  return (
    <li
      /* No `mo-field`/`mo-sheen` on the plate: the summary inside is its own
         pointer field, and two nested trackers means the outer one keeps the
         offsets it had when the pointer crossed into the inner. The entrance is
         transform-only and stays. */
      className="rf-plate mo-in-up relative"
      style={{ clipPath: CHAMFER, background: PLATE, '--i': index } as React.CSSProperties}
    >
      {body === undefined ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
          <span className="min-w-0 flex-1 text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
            {summary}
          </span>
          {answer}
        </div>
      ) : (
        <Disclosure depth={2} summary={<span style={{ color: 'var(--text)' }}>{summary}</span>} answer={answer}>
          {/* No size set here. The body inherits, so the instruction stays
              smaller than the section heading and larger than nothing - a size
              written on it would be a fourth number to keep in step with the
              three the depth arithmetic already derives. */}
          <p className="leading-snug" style={{ color: 'var(--text-muted)' }}>
            {body}
          </p>
        </Disclosure>
      )}

      {/* The bar stays OUTSIDE the disclosure, always drawn. Its whole job is to
          make the ordering of a list visible without reading it, and a bar you
          have to open the row to see cannot do that job. */}
      {left !== null && (
        <span className="block px-3 pb-2">
          <TimeBar left={left} longest={longest} />
        </span>
      )}
    </li>
  );
}

/**
 * The acts that are running right now.
 *
 * WHY THIS BELONGS HERE AND NOT IN THE DAILY PANEL
 * ────────────────────────────────────────────────
 * Which acts exist, what each one asks for and what it pays are WORLDSTATE -
 * public, and knowable with the game closed. Only whether YOU have finished one
 * needs an account. The daily panel correctly refuses to guess the second half
 * and, until now, that meant the app said "needs your account" about Nightwave
 * and showed nothing at all - while the whole act list sat unread in a response
 * it was already fetching.
 *
 * So this states the half that is knowable and says plainly that completion is
 * the other half. No tick boxes: an unticked box next to an act would assert you
 * have not done it, which is exactly the claim there is no basis for.
 */
function Nightwave({ world, now }: { world: Worldstate; now: number }) {
  const acts = world.nightwave?.activeChallenges ?? [];
  if (acts.length === 0) return null;

  /*
   * A SUM OVER A POPULATION WITH UNKNOWNS IN IT IS A PARTIAL SUM, AND HAS TO
   * SAY SO.
   *
   * `acts.reduce((t, a) => t + (a.reputation ?? 0), 0)` folded every act the
   * feed sent without a reputation figure in as a zero - the exact value
   * `ActRow` refuses to draw seventy lines above, for the exact reason given
   * there. Thirteen acts with two of them unpriced reported "13 acts · 41,500"
   * on the closed row, silently short, with nothing marking it as partial; and
   * the closed row is all this section shows until it is pressed.
   *
   * So the sum is taken over the acts that carry the field and the count of
   * those acts travels with it. `paid.length === acts.length` is the whole
   * board and prints as before; anything less says which subset it is a total
   * of. This is the treatment `timed` already gets below, applied to the other
   * field that can be absent.
   */
  const paid = acts.filter((a) => a.reputation != null);
  const standing = paid.reduce((t, a) => t + (a.reputation ?? 0), 0);

  /*
   * One group per cadence that actually has acts in it.
   *
   * Walked in the fixed order rather than built from a Map keyed by whatever
   * arrives, for two reasons: Elite-then-Weekly-then-Daily is the order they are
   * worth doing in and the order the old flat sort already used, and a cadence
   * the board is not running this week must leave no empty group behind.
   */
  const groups = CADENCES.flatMap((cadence) => {
    const inCadence = acts.filter((a) => cadenceOf(a) === cadence);

    /*
     * AN ACT WITH NO EXPIRY IS NOT THE MOST URGENT ONE.
     *
     * The sort read `msUntil(a.expiry ?? '')`, which is zero for an absent
     * field, so every act the feed sent without an expiry landed at index 0 of
     * its group - taking the `--i: 0` slot the entrance reserves for the next
     * thing to go, above acts with minutes left, and drawing no TimeBar at all
     * because `ActRow` correctly refuses to draw one. The reduces nine lines
     * down already filtered these out and named this fault; the sort never got
     * the same treatment.
     *
     * So the known ones are ordered by urgency and the unknown ones follow
     * them, in the order the feed sent them, each saying on its own row that
     * its clock is not in this read.
     */
    const timed = inCadence
      .filter((a) => leftMs(a.expiry, now) !== null)
      .sort((a, b) => (leftMs(a.expiry, now) ?? 0) - (leftMs(b.expiry, now) ?? 0));
    const untimed = inCadence.filter((a) => leftMs(a.expiry, now) === null);
    const rows = [...timed, ...untimed];
    if (rows.length === 0) return [];

    /*
     * The clock and the bar scale are taken from the acts that CARRY an expiry.
     * A reduce over the whole group would fold `msUntil('')` in as a zero and
     * report a group as expiring now on the strength of a field the feed simply
     * did not send; null says the group has no clock, which is a different fact
     * and the true one.
     */
    const clocks = timed.flatMap((a) => {
      const left = leftMs(a.expiry, now);
      return left === null ? [] : [left];
    });
    const groupPaid = rows.filter((a) => a.reputation != null);
    return [
      {
        cadence,
        rows,
        // The same partial sum, per group. See `paid` above.
        standing: groupPaid.reduce((t, a) => t + (a.reputation ?? 0), 0),
        paidCount: groupPaid.length,
        soonest: clocks.length === 0 ? null : Math.min(...clocks),
        // Per group, not per section: an Elite act runs for a week and a daily
        // for a day, so one shared scale would flatten every daily bar to a stub.
        longest: clocks.length === 0 ? 0 : Math.max(...clocks),
      },
    ];
  });

  return (
    /*
     * The standing total used to be a sentence under the heading. It is the
     * section's real answer - what is on the board is why you look - so it is
     * the closed row's answer now rather than a line you scroll past, and the
     * words that gave it meaning moved onto the eyebrow. The number is stated
     * once here for the whole board and once per group below, which are two
     * different numbers rather than one said twice.
     */
    <Fold
      title="Nightwave acts"
      eyebrow={standing > 0 ? 'standing on the board right now' : 'elite first, then dailies'}
      answer={
        <span className="numeric">
          {acts.length} acts
          {standing > 0 &&
            (paid.length === acts.length
              ? ` · ${standing.toLocaleString()}`
              : ` · ${standing.toLocaleString()} from ${String(paid.length)}`)}
        </span>
      }
    >
      <div className="flex flex-col gap-[3px]">
        {groups.map((g) => (
          <Disclosure
            key={g.cadence}
            depth={1}
            accent={CADENCE_INK[g.cadence]}
            /* The first group opens with the section, so one press reaches the
               acts that pay most rather than two. */
            defaultOpen={g.cadence === groups[0]?.cadence}
            eyebrow={g.rows.length === 1 ? '1 act' : `${String(g.rows.length)} acts`}
            summary={<span style={{ color: 'var(--text)' }}>{g.cadence}</span>}
            answer={
              <span className="flex flex-wrap items-baseline gap-2">
                {g.standing > 0 && (
                  <span className="numeric" style={{ color: 'var(--color-orokin-300)' }}>
                    {g.standing.toLocaleString()} standing
                    {g.paidCount < g.rows.length && ` from ${String(g.paidCount)}`}
                  </span>
                )}
                {g.soonest === null ? (
                  <span style={{ color: 'var(--text-ghost)' }}>no expiry in this read</span>
                ) : (
                  <span className="numeric" style={{ color: timeInk(g.soonest, 3_600_000) }}>
                    {humanDuration(g.soonest)} left
                  </span>
                )}
              </span>
            }
          >
            {/* Two columns only when this list has 44rem of its OWN to spend.
                Even with the description folded away an act title is a phrase
                rather than a word, so in a narrow column the pair of plates on
                a row stop lining up with each other - and this section now
                lives in the reference pane, which is the narrow one at the
                window width the old `xl:` was written for. See `.rf-cols`. */}
            <ul className="rf-cols mo-stagger grid gap-[3px]">
              {g.rows.map((a, i) => (
                <ActRow key={a.id} act={a} index={i} longest={g.longest} now={now} />
              ))}
            </ul>
          </Disclosure>
        ))}
      </div>

      <div className="mt-2 text-[length:var(--text-micro)]" style={{ color: 'var(--text-faint)' }}>
        <Clamp lines={1}>
          Which acts are running is public. Whether you have finished one is read from your account, so none of these is
          marked done or not done.
        </Clamp>
      </div>
    </Fold>
  );
}

/* --------------------------------------------------------------- steel path */

/** Teshin's rotating offer. One line, because it is one fact. */
function SteelPath({ world, now }: { world: Worldstate; now: number }) {
  const sp = world.steelPath;
  const name = sp?.currentReward?.name;
  if (sp == null || name == null) return null;
  const left = leftMs(sp.expiry, now);

  return (
    /*
     * One fact, so the fact IS the answer: the closed row names what Teshin is
     * selling, and the body carries the price and the rotation clock. Folding
     * a section whose answer is a single name would otherwise be pure loss.
     */
    <Fold
      title="Steel Path honours"
      eyebrow="Teshin's rotating offer"
      accent="var(--color-signal-bad)"
      answer={<span style={{ color: 'var(--text)' }}>{name}</span>}
    >
      <div
        className="rf-plate mo-field mo-sheen mo-lift mo-in-up relative flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3"
        style={{ clipPath: CHAMFER, background: PLATE }}
      >
        <span aria-hidden className="rf-edge absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: 'var(--color-signal-bad)' }} />
        <span
          className="font-[family-name:var(--font-display)] text-[length:var(--text-body)] font-semibold"
          style={{ color: 'var(--text)' }}
        >
          {name}
        </span>
        {sp.currentReward?.cost != null && (
          <span className="numeric text-[length:var(--text-small)]" style={{ color: 'var(--color-orokin-300)' }}>
            {sp.currentReward.cost.toLocaleString()} essence
          </span>
        )}
        <span className="eyebrow ml-auto">rotates in</span>
        <span className="numeric text-[length:var(--text-body)]" style={{ color: left === null ? 'var(--text-muted)' : timeInk(left, 86_400_000) }}>
          {left === null ? '\u2014' : humanDuration(left)}
        </span>
      </div>
    </Fold>
  );
}


/* --------------------------------------------------------------- invasions */

const FACTION_INK: Readonly<Record<string, string>> = {
  Grineer: 'var(--color-faction-grineer)',
  Corpus: 'var(--color-faction-corpus)',
  Infested: 'var(--color-faction-infested)',
  Infestation: 'var(--color-faction-infested)',
};

const factionInk = (f: string | undefined): string => (f != null && FACTION_INK[f] != null ? FACTION_INK[f] : 'var(--text-muted)');

/**
 * How many invasion plates fit before the section stops being scannable.
 *
 * Named rather than inlined as a `10` inside the filter chain, because the
 * number has to be sayable: the closed row now reports how many are running and
 * how many of those are drawn, and a cap the code cannot name is a cap the
 * interface cannot admit to. Not grouped, unlike the fissures and the acts: the
 * key an invasion offers is which faction is attacking, and on most nights that
 * yields one group holding nearly every row - a level with nothing beside it,
 * which is worse than no level.
 */
const INVASION_ROWS = 10;

/** "3 x Fieldron", or nothing when a side pays nothing countable. */
function rewardText(side: InvasionSide | undefined): string | null {
  const items = side?.reward?.countedItems ?? [];
  const parts = items
    .filter((i) => i.type != null)
    .map((i) => (i.count != null && i.count > 1 ? `${String(i.count)} \u00d7 ${String(i.type)}` : String(i.type)));
  if (parts.length > 0) return parts.join(', ');
  const credits = side?.reward?.credits;
  return credits != null && credits > 0 ? `${credits.toLocaleString()} credits` : null;
}

/**
 * Faction wars, drawn as the tug of war they are.
 *
 * WHY A TWO-SIDED BAR
 * ───────────────────
 * `completion` is the one genuinely bidirectional measurement anywhere in this
 * app: 0 means the defender holds the node outright, 100 means the attacker
 * does, and the interesting state is how far from the middle it has moved. A
 * one-directional bar - the shape used everywhere else here - would misrepresent
 * that, because "20%" is not a fifth of something, it is a strong DEFENDER lead.
 * So this is the one place the app draws from the centre out.
 *
 * Both sides' rewards are shown because the choice of side is the actual
 * decision an invasion asks you to make, and it is made on the reward.
 */
function Invasions({ world, now, ids }: { world: Worldstate; now: number; ids: ReadonlyMap<string, string> | null }) {
  void now;
  // The feed keeps finished invasions in the list; they are not a thing to do.
  const running = (world.invasions ?? []).filter((i) => i.completed !== true);
  /*
   * THE CAP IS APPLIED TO AN UNSORTED LIST, AND THE ANSWER NOW SAYS SO.
   *
   * There is no sort here and there cannot honestly be one: an `Invasion`
   * carries no timestamp at all, and `completion` runs from one faction
   * holding the node to the other, so it says nothing about which of these
   * ends first. That leaves the ten rows drawn as "the first ten the feed
   * serialised" - which is a defensible rule and was an invisible one. The
   * fissure cap states its rule ("every one expiring after these") because
   * that list IS sorted before it is sliced; this one states the rule it
   * actually has instead of borrowing that sentence's authority.
   */
  const list = running.slice(0, INVASION_ROWS);
  if (list.length === 0) return null;

  return (
    <Fold
      title="Invasions"
      eyebrow="pick a side, each pays its own"
      /*
       * THE CAP WAS SILENT, AND A SILENT CAP IS THE ONE THING THIS PANEL SAYS
       * IT WILL NOT DO.
       *
       * `slice(0, 10)` sat in the middle of the filter chain and the closed row
       * then reported the length of what SURVIVED it as "10 running" - so on a
       * busy night the section stated a number it had itself invented, and the
       * invasions past the tenth were indistinguishable from invasions that
       * were never there. The answer counts what is running and says how much
       * of it is drawn, in one sentence, in the one place the reader is
       * already looking - and, since the list is not sorted, WHICH of them
       * these are, because "10 of 23" without a rule is a cap that is stated
       * and still silent about what it kept.
       */
      answer={
        <span className="numeric">
          {list.length === running.length
            ? `${String(running.length)} running`
            : `${String(list.length)} of ${String(running.length)} running, in the order the feed sent them`}
        </span>
      }
    >
      <ul className="rf-cols mo-stagger grid gap-[3px]">
        {list.map((inv, i) => {
          // Clamped because the feed can report a run count past the requirement.
          // Null when the feed sent no figure: a bar drawn at half would be a number nobody reported.
          const pct = inv.completion == null ? null : Math.max(0, Math.min(100, inv.completion));
          const atkInk = factionInk(inv.attacker?.faction);
          const defInk = factionInk(inv.defender?.faction);
          const atk = rewardText(inv.attacker);
          const def = rewardText(inv.defender);

          return (
            <li
              key={inv.id}
              className="rf-plate mo-field mo-sheen mo-lift mo-in-up relative px-4 py-2.5"
              style={{ clipPath: CHAMFER, background: PLATE, '--i': i } as React.CSSProperties}
            >
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="min-w-0 flex-1 text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
                  <NodeName label={inv.node} ids={ids} />
                  {inv.desc != null && <span style={{ color: 'var(--text-muted)' }}> &middot; {inv.desc}</span>}
                </span>
                <span
                  className="numeric shrink-0 text-[length:var(--text-micro)]"
                  style={{ color: 'var(--text-muted)' }}
                  title={pct === null ? 'The feed reported no progress for this invasion.' : undefined}
                >
                  {pct === null ? '\u2014' : wholePct(pct)}
                </span>
              </div>

              {/* The tug of war. One track, two fills meeting where the fight is. */}
              {pct !== null && (
                <span aria-hidden className="mt-2 flex h-[5px] w-full overflow-hidden" style={{ background: 'oklch(1 0 0 / 0.05)' }}>
                  <span className="block h-full" style={{ width: `${String(pct)}%`, background: atkInk }} />
                  <span className="block h-full flex-1" style={{ background: defInk }} />
                </span>
              )}

              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 text-[length:var(--text-nano)]">
                <span className="min-w-0 flex-1 truncate" style={{ color: atkInk }}>
                  {inv.attacker?.faction ?? 'Attacker'}
                  {/*
                   * An outbreak is not a choice. The Infestation pays nothing and
                   * cannot be sided with, so saying so is clearer than leaving a
                   * blank where the other side's reward sits on every other row.
                   */}
                  {inv.vsInfestation === true && atk === null ? (
                    <span style={{ color: 'var(--text-faint)' }}> &middot; no side to take</span>
                  ) : (
                    atk != null && <span style={{ color: 'var(--text-muted)' }}> &middot; {atk}</span>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-right" style={{ color: defInk }}>
                  {def != null && <span style={{ color: 'var(--text-muted)' }}>{def} &middot; </span>}
                  {inv.defender?.faction ?? 'Defender'}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Three sentences explaining how to READ the bars, which is worth
          saying once and is not worth eighty pixels under every screenful of
          invasions. Clamped to the first, with the rest one press away. */}
      <div className="mt-2 text-[length:var(--text-micro)] leading-snug" style={{ color: 'var(--text-faint)' }}>
        <Clamp lines={1}>
          The bar runs from the defender holding the node to the attacker taking it, so the percentage is the state of
          the fight rather than your progress through it. In a faction war each side pays its own reward and you pick
          one; an Infested outbreak has only one payable side.
        </Clamp>
      </div>
    </Fold>
  );
}


export default function WorldstatePanel() {
  const { loaded, error } = useWorldstate();
  // Shared with Fissures rather than looked up twice - one catalog, one map.
  const ids = useNodeIds();
  const now = useNow(1000); // ticks the countdowns only; no reads involved
  // The only account-derived thing on this screen. Unknown until both the relic
  // table and an inventory read have arrived, and it says which is missing.
  const stock = useRelicStock();

  // Ordered by what runs out first, which is the whole hierarchy of this panel.
  const cycles = useMemo<Timed[]>(() => {
    const w = loaded?.data;
    if (!w) return [];
    const named: Array<[string, Cycle | undefined]> = [
      ['Cetus', w.cetusCycle],
      ['Orb Vallis', w.vallisCycle],
      ['Cambion Drift', w.cambionCycle],
      ['Zariman', w.zarimanCycle],
    ];
    return (
      named
        .flatMap(([label, cycle]) => (cycle ? [{ label, cycle, left: leftMs(cycle.expiry, now) }] : []))
        /* A cycle whose expiry this read cannot state is not the one about to
           flip. Sorted to the END rather than to the front, which is where a
           null folded into a zero would have put it - and the front of this
           list is the panel's one bold element. */
        .sort((a, b) => (a.left ?? Number.POSITIVE_INFINITY) - (b.left ?? Number.POSITIVE_INFINITY))
    );
  }, [loaded, now]);

  if (error && !loaded) {
    return (
      <div className="grid h-full place-items-center p-10">
        <div
          className="rf-plate mo-field mo-sheen mo-in-settle max-w-[52ch] px-8 py-10 text-center"
          style={{ clipPath: CHAMFER, background: PLATE }}
        >
          <h2
            className="font-[family-name:var(--font-title)] text-[length:var(--text-lead)] tracking-[0.22em] uppercase"
            style={{ color: 'var(--color-orokin-300)' }}
          >
            Worldstate unavailable
          </h2>
          <p className="wf-note mt-4">
            {error}. The app will retry on its normal schedule rather than hammering the endpoint.
          </p>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="grid h-full place-items-center">
        {/* CSS, not rAF: a hidden window must not strand this at zero opacity. */}
        <span className="eyebrow pulse-slow">Reading worldstate</span>
      </div>
    );
  }

  const [lead, ...rest] = cycles;

  return (
    /*
     * ONE SCREEN. THE PAGE DOES NOT MOVE; THE PANES DO.
     *
     * THE MEASUREMENT THAT FORCED THIS. Driven through a real browser at
     * 1280 x 720, this panel emitted 803 px into a 672 px viewport with
     * nothing open but the cycle strip and no account read - one and a
     * quarter screens before a single section had been pressed. It was the
     * most top-level siblings of any panel in the app: ten of them, every one
     * a `<section>` at the same level in one `flex-col gap-6`, so the layout
     * said cycles, a live event, traders, today's dailies, the Nightwave
     * board, faction wars, Teshin's shelf and the fissure list were all
     * equally important and all equally worth the reader's next second. None
     * of them was subordinate to anything, because nothing in a flat stack
     * can be.
     *
     * It was also 240 px of pure chrome: eight 24 px gaps and 48 px of page
     * padding, holding closed rows about 45 px tall. A THIRD of the overflow
     * was the spacing between the sections rather than the sections.
     *
     * So the shape is a grid of a fixed height, and the hierarchy is
     * structural rather than a promise:
     *
     *   - the CYCLE STRIP is pinned. It is the panel's headline state and its
     *     one bold figure, it is what the whole screen is ordered by, and it
     *     can no longer be pushed off the top by a list somebody opened;
     *   - the LEFT pane is WHAT TO GO AND DO - a running event, the fissures,
     *     today's two dailies. All three name a place on the star chart;
     *   - the RIGHT pane is REFERENCE - who is selling, what the Nightwave
     *     board is asking, the faction wars, Teshin's rotation. These are
     *     things to look up. They are legitimately long and they scroll
     *     INSIDE their own pane, where what they can no longer do is push the
     *     answer off the screen.
     *
     * `min-h-0` on every row and column of that chain is what makes it true
     * and is easy to leave out: a grid child's default `min-height: auto`
     * refuses to shrink below its content, so one missing `min-h-0` anywhere
     * and the whole thing grows again and the page scrolls exactly as before,
     * with no visible sign that anything is wrong.
     *
     * `h-full`, where this used to say `min-h-full` and explain that the
     * shell's <main> is the scroller. It still is - that is precisely what is
     * being stopped. A minimum let the column grow with its content, which is
     * the growth being measured above; a fixed height with scrolling panes
     * inside it is the same content with a floor under it.
     */
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 p-5">
      <PanelRules />

      {/*
        ROW 1 - PINNED, AND NOT A DISCLOSURE ANY MORE.
        ─────────────────────────────────────────────
        The panel's whole hierarchy is time and this is the soonest thing on
        it, so it is the one region that is always on screen.

        It was a `Fold` whose closed row read "Cetus · day · 42m" - which is
        the lead cell's own three fields, in smaller type, eight pixels above
        the lead cell. That is the same fact in two costumes, and it cost a
        45 px summary row and 19 px of body padding to say it twice. Opened by
        default it could never usefully be closed either: closing the one
        section that is the subject of the panel leaves a screen that answers
        nothing.

        The title and the eyebrow survive on the band below, and they share
        that line with the read's provenance - which used to be a footer at the
        bottom of eight hundred pixels, i.e. below the fold, on the one panel
        in this app whose data has a shelf life. Both are one-line facts about
        the same read, so they are one line.
      */}
      <section className="min-w-0">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
            World cycles
          </span>
          <span className="eyebrow">ordered by what runs out first</span>
          <span className="eyebrow ml-auto">worldstate read {new Date(loaded.at).toLocaleTimeString()}</span>
          <span className="eyebrow">{loaded.origin}</span>
          <span className="eyebrow">refreshes at most every 2 min</span>
        </div>

        {cycles.length === 0 ? (
          /* The `Fold` this replaced said "none in this read" on its closed
             row for exactly this case. A pinned strip with no cells in it
             would be a blank band instead, which is the one reading that is
             not true: the read happened, and it carried no cycle. */
          <p className="wf-note">No world cycle is in this worldstate read.</p>
        ) : (
          /* Five tracks so the lead's double-width cell and the three quiet
             ones land on a single row instead of orphaning the last. */
          <div className="mo-stagger grid grid-cols-2 gap-[3px] sm:grid-cols-5">
            {lead && <LeadCycle item={lead} />}
            {rest.map((item, i) => (
              <CycleCell key={item.label} item={item} index={i} />
            ))}
          </div>
        )}
      </section>

      {/*
        ROW 2 - TWO PANES ABOVE 1280px, TWO STACKED SCROLLERS BELOW IT.
        ──────────────────────────────────────────────────────────────
        THE ROW TRACKS ARE WRITTEN OUT AND THAT IS NOT TIDINESS. Without them
        the stacked case below `xl` has two AUTO rows inside a track that is
        exactly as tall as the window, and an auto row sizes to its content -
        so the panes would each grow to their full list height, the grid would
        overflow the row it was given, and <main> would scroll again at every
        width under 1280, which is every width this overlay is usually opened
        at. Two `minmax(0, 1fr)` rows share the height instead and each pane
        scrolls within its half; at `xl` a single one hands the whole height
        back to the row the two columns sit on.

        Spelled as arbitrary values rather than `grid-rows-2`, because the
        whole point is the `minmax(0, …)` - a bare `1fr` has an automatic
        minimum and is exactly the growth being prevented, and a numbered
        utility hides which of the two it emits behind a version.
      */}
      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:grid-rows-[minmax(0,1fr)]">
        {/*
          `min-w-0` is load-bearing on both panes, for the reason the shell
          records about its own <main>: a grid item defaults to
          `min-width: auto` and refuses to shrink below its content's
          intrinsic width, so a `minmax(0, 7fr)` TRACK that is allowed to be
          narrow still gets an ITEM that is not - and the overflow goes
          sideways, where `overflow-y-auto` shows no scrollbar and a
          screenshot shows nothing at all.
        */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-1">
          <Events world={loaded.data} now={now} />
          <Fissures world={loaded.data} now={now} ids={ids} stock={stock} />
          <DailyMissions world={loaded.data} now={now} ids={ids} />
        </div>

        <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-1">
          <Traders world={loaded.data} now={now} />
          <Nightwave world={loaded.data} now={now} />
          <Invasions world={loaded.data} now={now} ids={ids} />
          <SteelPath world={loaded.data} now={now} />
        </div>
      </div>
    </div>
  );
}
