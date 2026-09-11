/**
 * COLLECTION — the completionist's ledger.
 *
 * Every other panel answers "what next". This one answers "what is missing", which
 * is a different and much less forgiving question: the moment it rounds, hides a
 * failed fetch, or folds an unobtainable item into a denominator, it stops being
 * usable for the only thing it exists for.
 *
 * So three rules run through the whole file:
 *
 *   1. A missing catalog is UNKNOWN, never zero. `db.missingCategories` renders a
 *      row that says so rather than a 0/0 meter that reads as "you own none".
 *   2. One percentage is a lie. `honestCompletion` returns three numbers with three
 *      different denominators and each is printed next to what it is measured
 *      against — see the caption under every figure.
 *   3. Vaulted and Founder items are visually separated from the rest, because
 *      "missing" and "cannot currently be acquired" are not the same fact and a
 *      completionist plans differently around each.
 *
 * Derivation is entirely borrowed: `ownership()` does the join, `mastery.ts` does
 * the rank maths. The one thing built here is the bridge between them, because the
 * two modules were written against different catalog shapes and nothing joins them
 * yet.
 *
 * PRESENTATION
 * ────────────
 * This panel is a *list*, and it used to be drawn as a wall of large glowing
 * tiles with every item name truncated at the third syllable. It is now dense
 * chamfered rows in as many columns as the width allows: a name wraps rather
 * than being cut, state is carried by a 2px bar on the leading edge, and the
 * only large element on the screen is the obtainable-completion ring.
 *
 * Entrances are the CSS `.anim-rise` class, not a JS tween: rAF does not run
 * while the overlay is hidden, and a list that never finishes animating in is a
 * list that is permanently invisible.
 */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useAccount } from '../../core/store';
import {
  ITEM_CATEGORIES,
  loadItemDb,
  obtainablePct,
  ownership,
  totalOwnership,
  type CategoryOwnership,
  type ItemCategory,
  type ItemDb,
  type ItemDbEntry,
} from '../../data/itemdb';
import {
  honestCompletion,
  ledger,
  masteryFromAccount,
  rankFromLifetimeAffinity,
  rankName,
  type MasteryDb,
  type MasteryEntry,
  type MasterySource,
} from '../../data/mastery';
import { CLIP, Counter, EmptyState, Ring, cx } from '../../ui/orokin';
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { ItemArt } from '../../ui/ItemArt';
import { ItemDetail } from '../../ui/ItemDetail';
import { subscribeFocus } from '../../ui/navigation';
import { staggerFor } from '../../ui/stagger';
import { CHAMFER, GOLD_RIM, GOLD_FILL } from '../../ui/geometry';

/* ------------------------------------------------------------------ the bridge */

/**
 * Which mastery line a catalog category is paid into, and at which rate.
 *
 * `isFrame` is the 200-vs-100 mastery-per-rank switch (mastery-math §4.1), and it
 * does NOT track "is a warframe": Sentinels, Pets and Archwings all pay the frame
 * rate while their weapons pay the weapon rate. Getting this wrong doubles or
 * halves a whole category's contribution, so it is a table rather than a guess at
 * each call site.
 */
const CATEGORY_SOURCE: Readonly<Record<ItemCategory, { source: MasterySource; isFrame: boolean }>> = {
  Warframes: { source: 'frames', isFrame: true },
  Primary: { source: 'primaries', isFrame: false },
  Secondary: { source: 'secondaries', isFrame: false },
  Melee: { source: 'melee', isFrame: false },
  Sentinels: { source: 'companions', isFrame: true },
  SentinelWeapons: { source: 'companions', isFrame: false },
  Pets: { source: 'companions', isFrame: true },
  Archwing: { source: 'archwing', isFrame: true },
  'Arch-Gun': { source: 'archwing', isFrame: false },
  'Arch-Melee': { source: 'archwing', isFrame: false },
  // The masterable half of Misc is modular parts — amp prisms, zaw strikes, kitgun
  // chambers. All weapon-rate.
  Misc: { source: 'other', isFrame: false },
};

const CATEGORY_LABEL: Readonly<Record<ItemCategory, string>> = {
  Warframes: 'Warframes',
  Primary: 'Primaries',
  Secondary: 'Secondaries',
  Melee: 'Melee',
  Sentinels: 'Sentinels',
  SentinelWeapons: 'Sentinel Weapons',
  Pets: 'Companions',
  Archwing: 'Archwing',
  'Arch-Gun': 'Arch-Guns',
  'Arch-Melee': 'Arch-Melee',
  Misc: 'Modular Parts',
};

/**
 * Founder exclusives, by display name.
 *
 * itemdb.ts keeps its own copy of this list private, and mastery.ts needs the
 * `obtainable: false` flag to make its "of obtainable" figure differ from its "of
 * available" one — without it two of the three headline numbers collapse into the
 * same value and the panel silently loses a third of its point. Matched by name
 * for the same reason itemdb does: the research verified the names, not the paths.
 */
const FOUNDER_ONLY: ReadonlySet<string> = new Set(['Excalibur Prime', 'Lato Prime', 'Skana Prime']);

/** Necramechs sit in `Warframes.json` but are their own mastery line. */
const MECH_PRODUCT_CATEGORY = 'MechSuits';

/** Project the item catalog onto the shape the mastery engine consumes. */
function masteryDbFrom(db: ItemDb): MasteryDb {
  const items = new Map<string, MasteryEntry>();
  for (const [category, entries] of db.byCategory) {
    const spec = CATEGORY_SOURCE[category];
    for (const e of entries) {
      const entry: MasteryEntry = {
        name: e.name,
        category: e.productCategory === MECH_PRODUCT_CATEGORY ? 'necramech' : spec.source,
        isFrame: spec.isFrame,
        grantsMastery: e.masterable,
        maxLevelCap: e.maxRank,
      };
      if (FOUNDER_ONLY.has(e.name)) entry.obtainable = false;
      items.set(e.uniqueName, entry);
    }
  }
  // No `nodes` / `junctions`: the star chart tables belong to the progression
  // datasets, not the item catalog. Every mission figure therefore reports null and
  // the panel says out loud that its mastery numbers cover equipment only.
  return { items };
}

/* ---------------------------------------------------------------------- format */

const asCount = (n: number): string => Math.round(n).toLocaleString();
/**
 * Whole percent of a 0..100 figure. Floored, like `obtainablePct`, so nothing
 * unfinished can read as 100%; and a started figure never reads as 0%, because
 * "0%" is a claim of nothing done.
 */
const asPct = (n: number): string => {
  // Nearest, not floored: "10 / 195" beside a floored "4%" read as two different
  // fractions. The two guards keep the ends honest.
  const r = Math.round(n);
  if (r === 0 && n > 0) return '<1%';
  if (r === 100 && n < 100) return '99%';
  return `${r}%`;
};
/** The Founder items are 12,000 of ~3M, so the two headline figures differ in the
 *  first decimal or not at all. Rounding to whole percent hides the distinction the
 *  two denominators exist to make. Same two guards as `asPct`, one decimal down. */
const asFinePct = (n: number): string => {
  const s = n.toFixed(1);
  if (s === '0.0' && n > 0) return '<0.1%';
  if (s === '100.0' && n < 100) return '99.9%';
  return `${s}%`;
};

/** Nothing measured. Never a zero — a zero here reads as a finished measurement. */
const UNKNOWN = '—';


/* -------------------------------------------------------------------- catalog */

type CatalogState = { db: ItemDb } | { error: string } | null;

/** Fetch the catalog once per window. gentle caches it, so a reopen costs 304s. */
function useItemDb(): CatalogState {
  const [state, setState] = useState<CatalogState>(null);
  useEffect(() => {
    let alive = true;
    loadItemDb().then(
      (db) => {
        if (alive) setState({ db });
      },
      (err: unknown) => {
        if (alive) setState({ error: err instanceof Error ? err.message : 'catalog unavailable' });
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/* ------------------------------------------------------------------- materials */

/** Cut, not rounded. The game chamfers every plate it draws. */


/**
 * The sticky group header's ground.
 *
 * OPAQUE, and that is the whole point: this plate had a gradient that faded to
 * transparent over its bottom third, so item rows scrolled up THROUGH the
 * header they were supposed to pass behind. The plate language everywhere else
 * in the app is a top-lit dark gradient, so this is that, with nothing to see
 * through.
 */
const HEADER_PLATE = 'linear-gradient(168deg, oklch(0.155 0.024 268), oklch(0.105 0.022 275))';

/** The row ground. Barely there — density comes from the type, not from plates. */
const ROW_BG = 'var(--plate-lift)';
const ROW_BG_ON = 'oklch(0.83 0.105 90 / 0.10)';

/*
 * THE LOCAL `Heading` IS GONE, AND ITS ONE CALLER IS WHY.
 *
 * It rendered a ruled section header - title, hairline, note - and had exactly
 * one call site: "By category". That section is a `Disclosure` now, and a
 * Disclosure summary IS a heading with a note (the eyebrow) and an answer, so
 * keeping a second heading component for a section that no longer has one
 * would be a component maintained for nothing.
 *
 * The other panels keep their own copies because their headings still sit over
 * sections that are open, which is the case this one no longer has.
 */

/** A static progress bar with an optional ceiling mark. Width, not scaleX: the
 *  bar is painted once and never re-measured, so a transform would only need a
 *  wrapper to keep the track from stretching with it. */
function Bar({ value, ghost, color, height = 3 }: { value: number; ghost?: number; color: string; height?: number }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <span className="relative block w-full overflow-hidden" style={{ height, background: 'oklch(1 0 0 / 0.07)' }}>
      <span className="block h-full" style={{ width: `${v * 100}%`, background: color }} />
      {ghost != null && (
        <span
          aria-hidden
          className="absolute inset-y-0 w-px"
          style={{ left: `${Math.max(0, Math.min(1, ghost)) * 100}%`, background: 'oklch(1 0 0 / 0.45)' }}
        />
      )}
    </span>
  );
}

/* --------------------------------------------------------------------- chrome */

function Chip({ children, tone = 'faint' }: { children: ReactNode; tone?: 'faint' | 'warn' | 'gold' }) {
  const color =
    tone === 'warn' ? 'var(--color-signal-warn)' : tone === 'gold' ? 'var(--color-orokin-400)' : 'var(--text-muted)';
  return (
    <span
      className="eyebrow inline-flex items-center gap-1.5 px-2 py-[3px]"
      style={{
        clipPath: CLIP.button,
        color,
        background: `color-mix(in oklab, ${color} 10%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 26%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      // `transition-colors` with nothing to transition to: the plate colour is an
      // inline style, so a Tailwind hover background never wins over it. Brightness
      // does, and it is the same hover the Arsenal chip rail already uses.
      className="rf-clipped mo-field mo-magnet mo-sheen mo-focusable eyebrow cursor-pointer px-3 py-[6px] transition-[filter,color] hover:brightness-125"
      style={{
        clipPath: CLIP.button,
        color: on ? 'var(--color-orokin-200)' : 'var(--text-muted)',
        background: on ? 'oklch(0.83 0.105 90 / 0.18)' : 'oklch(1 0 0 / 0.04)',
        boxShadow: on ? 'inset 0 -2px 0 0 var(--color-orokin-400)' : 'inset 0 0 0 1px var(--hairline)',
      }}
    >
      {children}
    </button>
  );
}

/**
 * One of the three headline figures.
 *
 * The caption is not decoration — a completion percentage without its denominator
 * printed beside it is the exact failure this panel is built to avoid.
 */
function Figure({
  label,
  value,
  denominator,
  tone = 'gold',
}: {
  label: string;
  value: ReactNode;
  denominator: ReactNode;
  tone?: 'gold' | 'energy';
}) {
  const ink = tone === 'gold' ? 'var(--color-orokin-300)' : 'var(--color-tenno-300)';
  return (
    <div className="min-w-0">
      <div className="eyebrow" style={{ color: ink }}>
        {label}
      </div>
      <div className="stat mt-2 text-[length:var(--text-lead)]" style={{ color: ink }}>
        {value}
      </div>
      <div className="numeric mt-1 text-[length:var(--text-micro)]" style={{ color: 'var(--text-faint)' }}>
        {denominator}
      </div>
      {/*
       * NO EXPLANATORY PARAGRAPH HERE.
       *
       * Each figure used to carry ~30 words under it, so three visually
       * identical figures put ninety words of body copy between the ring and the
       * first item — and the reader was left to work out which of the three
       * percentages they had wanted. Label, value and denominator are what a
       * player reads; the reasoning is one fold away, under the whole grid,
       * where it is read once rather than three times.
       */}
    </div>
  );
}

/*
 * THE LOCAL `Fold` IS GONE. `Disclosure` IS THE FOLD NOW.
 *
 * It was a chevron button plus `.rf-reveal` plus an `inert` toggle, written out
 * here and again, near-identically, in MasteryPanel. Two hand-rolled copies of
 * the one pattern in this app that must never be got wrong - the region has to
 * open instantly at full height, because this overlay's document timeline can
 * stop on the frame after the click - is two chances for someone to "improve"
 * one of them with a height transition and blank the section.
 *
 * `Disclosure` is that pattern once, with the reasoning in its own header, and
 * it adds the thing the old fold could not do: the closed row states its own
 * answer, so a reader who never opens it has still been told the count.
 */

/** How many raw paths a list prints before it says how many are left. */
const PATH_LIMIT = 25;

/**
 * A list the panel counted, printed as a count, and used to throw away.
 *
 * Both of these arrays name items — the ones your account holds that the catalog
 * has never heard of. Reduced to an integer they are an unanswerable complaint;
 * printed, they are the only way to tell WHICH item is missing from a total. The
 * path is raw and ugly, which is why it is folded and set as code: it is the
 * item's real identity, and it is what the catalog would be searched by.
 *
 * `depth={1}`: these sit INSIDE "How these are measured", and the indent rail
 * that the depth drives is what makes that legible as nesting rather than as a
 * list that has drifted right.
 */
function Paths({ label, paths }: { label: string; paths: readonly string[] }) {
  const shown = paths.slice(0, PATH_LIMIT);
  return (
    <Disclosure
      depth={1}
      accent="var(--color-signal-warn)"
      summary={label}
      answer={<span>{asCount(paths.length)} items</span>}
    >
      {shown.map((p) => (
        <code
          key={p}
          className="block text-[length:var(--text-micro)] break-all"
          style={{ color: 'var(--text-muted)' }}
        >
          {p}
        </code>
      ))}
      {/* The remainder is the real length minus what was printed — never a
          padded list, never an invented entry. */}
      {paths.length > shown.length && (
        <span className="eyebrow mt-1 block">and {asCount(paths.length - shown.length)} more</span>
      )}
    </Disclosure>
  );
}

/* ----------------------------------------------------------- category summary */

interface CategoryRowProps {
  category: ItemCategory;
  own: CategoryOwnership | undefined;
  selected: boolean;
  onSelect: () => void;
  delay: number;
  /** False with no account: the totals are real, the owned counts are not. */
  measured: boolean;
}

function CategoryRow({ category, own, selected, onSelect, delay, measured }: CategoryRowProps) {
  const label = CATEGORY_LABEL[category];
  const style: CSSProperties = {
    clipPath: CHAMFER,
    background: selected ? ROW_BG_ON : ROW_BG,
    animationDelay: `${delay}ms`,
  };

  // A category whose fetch failed has no numbers at all. Rendering 0/0 here would
  // be indistinguishable from a genuinely empty collection.
  if (!own) {
    return (
      <div className="anim-rise relative px-3.5 py-2.5" style={style}>
        <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: 'var(--color-signal-warn)' }} />
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-[family-name:var(--font-display)] text-[length:var(--text-micro)] font-semibold" style={{ color: 'var(--text-muted)' }}>
            {label}
          </span>
          <span className="eyebrow" style={{ color: 'var(--color-signal-warn)' }}>
            catalog did not load
          </span>
        </div>
      </div>
    );
  }

  const obtainable = obtainablePct(own);
  const ratio = own.total > 0 ? own.owned / own.total : 0;
  const complete = obtainable === 100;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      // Eleven category rows that select a list, with no hover feedback at all —
      // `transition-colors` had nothing to transition because the row's own
      // background is an inline style. Brightness reads over any fill.
      /*
       * `mo-field` + `mo-sheen` + `mo-lift` + `mo-focusable`, and eleven is
       * the number that makes that affordable: these are eleven rows, not
       * eight hundred, so each one can carry the pseudo-element the sheen is
       * drawn on. The item rows below deliberately do not - see ItemRow.
       *
       * `mo-lift` is the only transform class here. Stacking it with
       * `mo-magnet` or `mo-tilt` would not be two effects; all three declare
       * `transform`, so the later rule in motion.css wins outright and the
       * other class silently does nothing.
       */
      className="mo-field mo-sheen mo-lift mo-focusable anim-rise relative cursor-pointer px-3.5 py-2.5 text-left transition-[filter] hover:brightness-125"
      style={style}
    >
      <span
        aria-hidden
        className="absolute top-0 bottom-0 left-0 w-[2px]"
        style={{
          background: selected
            ? 'var(--color-orokin-400)'
            : measured && complete
              ? 'var(--color-signal-good)'
              : 'var(--color-tenno-400)',
          opacity: selected ? 1 : 0.7,
        }}
      />

      <div className="flex items-baseline justify-between gap-3">
        <span
          className="font-[family-name:var(--font-display)] text-[length:var(--text-micro)] font-semibold tracking-[0.02em]"
          style={{ color: selected ? 'var(--color-orokin-200)' : 'var(--text)' }}
        >
          {label}
        </span>
        {/*
          ELEVEN DASHES WERE ONE FACT WEARING ELEVEN COSTUMES.

          Measured at 1280x720 with no account read: this printed "— / 119" on
          every one of the eleven rows, which is the same single absence - the
          game has not been run yet - typeset eleven times down the side of the
          panel. The band above says it once, in a sentence.

          The TOTAL is not unknown: it is counted from the live catalog and is
          true before Warframe has ever been launched. So the unmeasured row
          prints that, alone, and the sub-line below it drops the "N masterable"
          that would now be saying it twice.
        */}
        <span className="numeric shrink-0 text-[length:var(--text-micro)]" style={{ color: 'var(--text)' }}>
          {measured ? (
            <>
              {own.owned}
              <span style={{ color: 'var(--text-faint)' }}> / {own.total}</span>
            </>
          ) : (
            own.total
          )}
        </span>
      </div>

      {measured ? (
        <>
          <div className="mt-2 flex items-center gap-2.5">
            {/* Ghost mark: where the bar can still reach without trading — everything
                except the vaulted items NOT already owned. */}
            <Bar
              value={ratio}
              ghost={own.total > 0 ? (own.total - (own.vaultedTotal - own.vaultedOwned)) / own.total : undefined}
              color={selected ? 'var(--color-orokin-400)' : 'var(--color-tenno-400)'}
            />
            <span
              className="numeric shrink-0 text-[length:var(--text-nano)]"
              style={{ color: complete ? 'var(--color-signal-good)' : 'var(--text-faint)' }}
            >
              {/* The same fraction the count beside it prints, owned over the category. */}
              {own.total > 0 ? asPct(ratio * 100) : UNKNOWN}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[length:var(--text-nano)]">
            <span style={{ color: 'var(--color-orokin-500)' }}>{own.masteredOwned} maxed</span>
            {own.vaultedTotal > 0 && (
              <span style={{ color: 'var(--color-signal-rare)' }}>
                {own.vaultedOwned}/{own.vaultedTotal} vaulted
              </span>
            )}
            {own.unobtainableExcluded > 0 && (
              <span style={{ color: 'var(--text-muted)' }}>{own.unobtainableExcluded} Founder-only</span>
            )}
          </div>
        </>
      ) : (
        // No bar and no percentage: an empty track reads as 0 % owned, which is a
        // claim about the player. The catalog counts behind the row are real, so
        // those are what the row carries instead — minus the category total,
        // which is now the row's own headline number rather than a second
        // printing of it two lines down.
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[length:var(--text-nano)]">
          {own.vaultedTotal > 0 && (
            <span style={{ color: 'var(--color-signal-rare)' }}>{own.vaultedTotal} vaulted</span>
          )}
          {own.unobtainableExcluded > 0 && (
            <span style={{ color: 'var(--text-muted)' }}>{own.unobtainableExcluded} Founder-only</span>
          )}
        </div>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ item rows */

/**
 * `unmeasured` is a fourth genuine state, not a placeholder: with no account
 * there is nothing to diff the catalog against, and calling every item
 * `missing` would assert an empty collection. `unobtainable` still applies —
 * Founder exclusives are unobtainable regardless of who is asking.
 */
type ItemState = 'unmeasured' | 'missing' | 'owned' | 'mastered' | 'unobtainable';

interface Tile {
  entry: ItemDbEntry;
  state: ItemState;
  /** Highest rank ever reached, from the account ledger. `null` = no ledger. */
  rank: number | null;
  vaulted: boolean;
}

const STATE_ORDER: Readonly<Record<ItemState, number>> = {
  // Actionable first: what you can go and get, then what you can go and rank,
  // then the finished pile, then the three you will never own.
  unmeasured: 0,
  missing: 0,
  owned: 1,
  mastered: 2,
  unobtainable: 3,
};

/** State is a 2px bar on the leading edge and one word. Not a glowing plate. */
const STATE_SPEC: Readonly<Record<ItemState, { color: string; label: string }>> = {
  unmeasured: { color: 'var(--color-void-400)', label: 'Not measured' },
  missing: { color: 'var(--color-void-500)', label: 'Not owned' },
  owned: { color: 'var(--color-tenno-400)', label: 'Owned' },
  mastered: { color: 'var(--color-orokin-400)', label: 'Mastered' },
  unobtainable: { color: 'var(--color-signal-bad)', label: 'Founder' },
};

function ItemRow({ tile, index, focused }: { tile: Tile; index: number; focused: boolean }) {
  const { entry, state, rank, vaulted } = tile;
  const spec = STATE_SPEC[state];

  /*
   * THE ROW OPENS.
   *
   * This panel's entire subject is the item catalog, and it was the only panel
   * that could not show you an item: every row was an inert `<li>`, and
   * ItemDetail - the component written for exactly this, used by Mastery,
   * Arsenal, Nemesis and Foundry - was not even imported here. So the app's
   * catalog screen was the one place a player could not read a weapon's
   * critical, its status, its recipe or a warframe's abilities, and the
   * "open in collection" link from those other panels landed somewhere that
   * knew LESS than where it came from.
   *
   * Local state rather than a set on the parent: nothing outside the row reads
   * it, and `content-visibility` skips paint without unmounting React state, so
   * scrolling an opened row off-screen and back keeps it open.
   */
  const [open, setOpen] = useState(false);
  /*
   * THE CARD IS BUILT ON FIRST OPEN, NOT ON EVERY ROW.
   *
   * Measured in a real browser at 1280x720 with no account read: every CLOSED
   * row still rendered a whole ItemDetail inside the reveal. The reveal clips
   * it - `.rf-reveal > *` is `overflow: hidden` - so none of it was visible,
   * but it was all laid out, and ItemDetail's fact grid sizes its pairs from a
   * minimum column width that a 268px catalogue column cannot hold. The result
   * was 156 elements sitting with their right edge 194px past the viewport,
   * and a category of eight hundred rows paying for eight hundred detail cards
   * of layout in an overlay composited over a running game.
   *
   * `everOpen` rather than `open`: unmounting on close would rebuild the card
   * every time a row is toggled, and hiding it is what the reveal is for. Once
   * a row has been opened it stays built.
   */
  const [everOpen, setEverOpen] = useState(false);

  return (
    <li
      // The anchor another panel scrolls to. Keyed on the unique path rather
      // than the display name, because that is what is actually unique.
      id={`item-${entry.uniqueName}`}
      // `list-row-lg` is content-visibility with an estimate that matches these
      // rows: a 235-item category is 235 rows of artwork and chips, and
      // off-screen ones must not pay for layout or paint in an overlay
      // composited over a running game. The `-lg` variant exists because the
      // default 44px estimate is wrong for these 60px rows, which made every
      // deep link into this grid land in the wrong place. See theme.css.
      className={cx(
        'anim-rise list-row-lg relative py-2 pr-3 pl-3.5',
        // An opened row takes the whole grid width. Expanding inside one 268px
        // column would set the detail in a gutter.
        open ? 'col-span-full' : '',
      )}
      // Capped so a 235-item category still finishes arriving in well under a
      // second; an uncapped stagger would take three seconds to reach the last row.
      style={{
        clipPath: CHAMFER,
        background: ROW_BG,
        animationDelay: `${Math.min(index, 24) * 14}ms`,
        // Arriving from another panel: the row you were sent to has to be
        // findable in a grid of two hundred near-identical ones. A ring rather
        // than a background wash, because the background already carries the
        // owned/missing state and must not be overwritten by "you came here".
        ...(focused
          ? {
              outline: '1px solid var(--color-tenno-300)',
              outlineOffset: -1,
              background: 'oklch(0.78 0.115 228 / 0.12)',
            }
          : null),
      }}
    >
      <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: spec.color, opacity: state === 'unobtainable' ? 0.5 : 0.9 }} />

      {vaulted && (
        // Hatching, not a colour swap: vaulted is a property that stacks on top of
        // owned/missing rather than replacing it, so it has to read as an overlay.
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'repeating-linear-gradient(135deg, oklch(0.72 0.16 300 / 0.13) 0 3px, transparent 3px 9px)' }}
        />
      )}

      {/* The whole row is the control - keyboard-reachable for free, and it
          matches how a DataTable row behaves in the other four panels. */}
      <button
        type="button"
        onClick={() => {
          setEverOpen(true);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        /*
         * `mo-lift` and `mo-focusable` ONLY, and the omissions are the
         * decision. This renders up to eight hundred times over a running
         * game, so nothing here may cost a pseudo-element per row: no
         * `mo-sheen` (an ::after on every row), no `mo-field` (nothing here
         * reads the pointer field, so the class would only widen the
         * tracker's `closest()` for no effect), and no `.rf-row`, whose own
         * 2px leading edge would be drawn directly over the state bar this
         * row already has and would make owned and missing look alike.
         *
         * What is left is a transition on `transform` that costs nothing
         * until a pointer is actually over the row, and a focus ring that
         * tells a keyboard user which of two hundred near-identical rows
         * they are on - which this grid had no way of saying at all.
         */
        className="mo-lift mo-focusable flex w-full items-start gap-3 text-left"
      >

      {/*
       * The artwork, and the first thing in the row.
       *
       * A collection is recognised by silhouette, not by reading names down a
       * column — it is how the game's own arsenal and codex are built, and it is
       * what turns 235 melee weapons from a list into something scannable.
       *
       * `owned` is passed tri-state so the tile distinguishes "you do not have
       * this" from "not measured yet": it desaturates for the first and sits at
       * an intermediate treatment for the second.
       */}
      <ItemArt
        className="relative"
        imageName={entry.imageName}
        name={entry.name}
        owned={state === 'unmeasured' ? null : state === 'owned' || state === 'mastered'}
        size={38}
      />

      <div className="relative min-w-0 flex-1">
        {/* Never truncated. A name that does not fit wraps — a collection panel
            whose whole job is naming what you are missing must print the name. */}
        <span
          className="font-[family-name:var(--font-display)] text-[length:var(--text-micro)] leading-tight font-semibold"
          style={{ color: state === 'owned' || state === 'mastered' ? 'var(--text)' : 'var(--text-muted)' }}
        >
          {entry.name}
        </span>

        <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-[length:var(--text-nano)]">
          {/*
           * The state word, but only when it is a state and not a constant.
           *
           * With no account every row is `unmeasured`, so this printed the words
           * "Not measured" 119 identical times down one category — a fact about
           * the whole list masquerading as a per-item reading. The legend above
           * the list says it once, which is where a constant belongs.
           */}
          {state !== 'unmeasured' && (
            <span className="tracking-[0.14em] uppercase" style={{ color: spec.color }}>
              {spec.label}
            </span>
          )}
          {/* MR0 is not a requirement, it is the absence of one — and the card
              this row opens says "Mastery rank: none" for the same item. A rank
              of zero printed as a badge is a reading nobody took. */}
          {entry.masteryReq > 0 && (
            <span className="numeric" style={{ color: 'var(--text-muted)' }} title="Mastery rank required">
              MR{entry.masteryReq}
            </span>
          )}
          {vaulted && (
            <span
              className="tracking-[0.14em] uppercase"
              style={{ color: 'var(--color-signal-rare)' }}
              title="Vaulted — not currently farmable, trade only"
            >
              Vault
            </span>
          )}
          {entry.maxRank > 30 && (
            <span
              className="numeric"
              style={{ color: 'var(--color-signal-warn)' }}
              title="Ranks past 30 — five Forma to reach the cap"
            >
              rank cap {entry.maxRank}
            </span>
          )}
        </div>
      </div>

      {/*
       * Rank is `null` when the snapshot carried no affinity ledger. A 0 there
       * would claim the item is unranked, which is a different fact.
       *
       * With no account at all the dash is not even that — it is the same
       * placeholder on every row in the category, so the column is dropped
       * rather than ruled out to a wall of dashes. `—` still appears when an
       * account IS present and the ledger is missing, because there it varies.
       */}
      {state !== 'unmeasured' && (
        <span
          className="numeric relative shrink-0 pt-0.5 text-[length:var(--text-micro)]"
          style={{ color: rank == null ? 'var(--text-faint)' : 'var(--text-muted)' }}
        >
          {rank == null ? UNKNOWN : `${rank}/${entry.maxRank}`}
        </span>
      )}
      </button>

      <div className="rf-reveal" data-open={open}>
        <div>
          {/* See `everOpen` above: a closed row builds no card at all, because
              eight hundred clipped cards were still eight hundred cards of
              layout — and 194px of them hung off the side of the window. */}
          {everOpen && (
          <div className="pt-2.5 pl-1" inert={!open}>
            <ItemDetail
              entry={entry}
              name={entry.name}
              itemType={entry.uniqueName}
              /*
               * Tri-state, and it must stay tri-state here of all places: this
               * panel's whole job is the owned/missing/unmeasured distinction,
               * and collapsing "we never looked" into "you do not have it" is
               * the exact claim the panel exists to avoid.
               */
              owned={state === 'unmeasured' ? null : state === 'owned' || state === 'mastered'}
              hideCollectionLink
            />
          </div>
          )}
        </div>
      </div>
    </li>
  );
}

/* --------------------------------------------------------------- empty states */

/**
 * The ledger WITHOUT an account.
 *
 * The catalog half of this panel — which items exist, in which category, at
 * which mastery requirement, which of them are vaulted — is a fact about the
 * game and is worth reading before the game has ever been launched. Only the
 * OWNED half needs an account, so only that half goes unmeasured.
 *
 * Note what is deliberately NOT shown: `ownership()` with no account reports
 * every item as missing, because it has nothing to subtract. Rendering that
 * would assert an empty collection.
 */
function AccountBanner() {
  const running = useAccount((s) => s.gameRunning);
  const gep = useAccount((s) => s.gep);

  const [title, detail] = !running
    ? [
        'Showing the catalog, ownership unmeasured',
        'Every masterable item and its category totals are game data and are listed below. What you own is not: run Warframe once and it is captured and kept, after which this panel stays accurate with the game closed.',
      ] as const
    : gep === 'connected'
      ? [
          'Linked — waiting for your account',
          'Your account arrives with the next update Warframe pushes, usually within a minute of reaching the Orbiter.',
        ] as const
      : [
          'Linking to the game',
          'Establishing the game-events connection. This usually takes a few seconds after launch.',
        ] as const;

  /*
   * NO PLATE OF ITS OWN ANY MORE.
   *
   * This was a full-width chamfered section pinned above the hero, which made
   * the cold-launch screen say the same thing three times in three costumes:
   * this banner, then a "Showing the catalog" note inside the hero, then three
   * completion figures each reading a dash. It is now the hero's answer slot -
   * the same words, in the one place the reader is already looking, with the
   * plate that surrounds it belonging to the hero.
   */
  return (
    <div className="min-w-0">
      <div className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
        {title}
      </div>
      {/*
        A <div> and a Clamp rather than a <p>: Clamp is a div holding a
        button, and a div inside a p is closed by the parser at the div.

        The longest of the three details is three sentences, and it is the
        first thing on the panel - three lines of explanation standing in
        front of the numbers they are explaining. The eyebrow above states
        the situation, two lines give the reason, the rest is a press away.
      */}
      <div className="mt-1 text-[length:var(--text-small)] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        <Clamp lines={2}>{detail}</Clamp>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- panel */

export default function CollectionPanel() {
  const inventory = useAccount((s) => s.inventory);
  const catalog = useItemDb();
  const db = catalog && 'db' in catalog ? catalog.db : null;

  const [selected, setSelected] = useState<ItemCategory>('Warframes');
  /** The item another panel sent us to, by uniqueName. */
  const [focus, setFocus] = useState<string | null>(null);
  const [missingOnly, setMissingOnly] = useState(false);
  const [hideVaulted, setHideVaulted] = useState(false);
  const [query, setQuery] = useState('');

  // Every derivation below is pure and keyed on the inventory object, whose
  // identity only changes when GEP delivered genuinely different bytes.
  const report = useMemo(() => (db ? ownership(inventory, db) : null), [inventory, db]);
  const totals = useMemo(() => (report ? totalOwnership(report) : null), [report]);
  const mdb = useMemo(() => (db ? masteryDbFrom(db) : null), [db]);
  const picture = useMemo(() => (mdb ? masteryFromAccount(inventory, mdb) : null), [inventory, mdb]);
  const completion = useMemo(() => (picture && mdb ? honestCompletion(picture, mdb) : null), [picture, mdb]);
  const xpByType = useMemo(() => ledger(inventory), [inventory]);

  // Everything above this line is catalog; everything keyed on it is account.
  const hasAccount = inventory !== null;

  /*
   * Honour "open in collection" from anywhere else in the app.
   *
   * Every item detail in Mastery, Arsenal, Nemesis and Foundry offers this jump,
   * which is several hundred links; without this they all landed on the panel
   * with Warframes selected and no indication of what you had asked for. A link
   * that goes to roughly the right place is not much better than no link.
   *
   * The request carries a DISPLAY NAME, because that is all the calling panels
   * have. Resolving it needs the catalog, so the whole thing waits on `db` and
   * re-subscribes when it lands.
   */
  useEffect(() => {
    if (!db) return;
    return subscribeFocus(['item'], (req) => {
      // Which category holds it. Linear over ~880 entries, once per navigation.
      let hit: { category: ItemCategory; uniqueName: string } | null = null;
      for (const [category, entries] of db.byCategory) {
        const match = entries.find((e) => e.name === req.id);
        if (match) {
          hit = { category, uniqueName: match.uniqueName };
          break;
        }
      }
      if (!hit) {
        // Not an exact catalog name - a component, a blueprint, a quest reward.
        // Rather than doing nothing (which every other panel's "open in
        // collection" link then appeared to do), land on the list filtered to
        // the name, so the nearest thing is on screen and the miss is visible.
        setMissingOnly(false);
        setHideVaulted(false);
        setQuery(req.id);
        return;
      }

      // Filters are cleared, not respected: arriving at a row that the active
      // filter then hides is indistinguishable from the jump having failed.
      setQuery('');
      setMissingOnly(false);
      setHideVaulted(false);
      setSelected(hit.category);
      setFocus(hit.uniqueName);

    });
  }, [db]);

  /*
   * The scroll, in its own effect, off the frame clock.
   *
   * NOT `requestAnimationFrame`, which is where this started. rAF does not fire
   * while the window is not being presented - the same frozen document timeline
   * that forces every entrance animation in this app to be transform-only - so
   * the scroll simply never happened. Measured: the right row, correctly
   * selected and highlighted, sitting 6,577px down a 235-row list with the
   * viewport still at the top.
   *
   * A passive effect needs no delay at all. React runs it after the DOM is
   * committed, on the scheduler rather than the frame clock, so the tile is
   * guaranteed to exist and the callback is guaranteed to run. `selected` is a
   * dependency because the tile only exists once its category is the open one.
   */
  /*
   * Scroll to the focused tile, and keep correcting until it stops moving.
   *
   * WHY A ONE-SHOT SCROLL DOES NOT WORK HERE
   * ────────────────────────────────────────
   * These tiles carry `content-visibility`, which is what keeps a 235-item
   * category from costing 235 rows of layout in an overlay over a running game.
   * The catch is that they also sit in a MULTI-COLUMN grid, and the browser
   * cannot size a skipped item's grid track properly - it estimates the list as
   * though it were a single column. Measured on the Warframes category: a
   * scrollHeight of ~7,600px that settled to 3,968px once the rows rendered,
   * which is 120 x 60px instead of 40 grid rows x 57px.
   *
   * So the first scroll aims into a container that is about to lose half its
   * height, and the browser then clamps the position to the new maximum. The
   * observed result was landing at the very bottom of the list every time, with
   * the correct row selected and highlighted 930px above the viewport.
   *
   * Re-asserting until the target stops moving converges on the right position
   * no matter how wrong the estimate started out, and costs a handful of reads.
   * Timers rather than rAF, deliberately: rAF does not fire while the window is
   * not being presented, which this path was already caught by once.
   */
  useEffect(() => {
    if (focus === null) return;

    const timers: number[] = [];
    let last = -1;

    const settle = (attempt: number): void => {
      const el = document.getElementById(`item-${focus}`);
      if (!el) return;

      // The nearest ancestor that actually scrolls. Found rather than assumed,
      // because the panel's scroller is the shell's, not this section's.
      let sc: HTMLElement | null = el.parentElement;
      while (sc && sc !== document.documentElement) {
        const oy = getComputedStyle(sc).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && sc.scrollHeight > sc.clientHeight + 4) break;
        sc = sc.parentElement;
      }
      if (!sc || sc === document.documentElement) {
        el.scrollIntoView({ block: 'center' });
        return;
      }

      // Offset within the scroller, which - unlike a viewport rect - does not
      // depend on the window having a height. It does not in a hidden overlay.
      let off = 0;
      let node: HTMLElement | null = el;
      while (node && node !== sc) {
        off += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }

      const target = Math.max(0, Math.min(off - (sc.clientHeight - el.offsetHeight) / 2, sc.scrollHeight - sc.clientHeight));
      sc.scrollTop = target;

      // Stop as soon as two consecutive passes agree: the layout has settled.
      if (Math.abs(target - last) < 2 || attempt >= 5) return;
      last = target;
      timers.push(window.setTimeout(() => {
        settle(attempt + 1);
      }, 90));
    };

    settle(0);
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [focus, selected]);

  const tiles = useMemo<Tile[] | null>(() => {
    if (!db || !report) return null;
    const entries = db.byCategory.get(selected);
    if (!entries) return null;
    const own = report.byCategory.get(selected);
    const missing = new Set((own?.missing ?? []).map((e) => e.uniqueName));
    const isFrame = CATEGORY_SOURCE[selected].isFrame;

    const out: Tile[] = [];
    for (const entry of entries) {
      if (!entry.masterable) continue;
      const xp = xpByType?.get(entry.uniqueName);
      const rank = xp === undefined ? (xpByType ? 0 : null) : rankFromLifetimeAffinity(xp, isFrame, entry.maxRank);
      const state: ItemState = FOUNDER_ONLY.has(entry.name)
        ? 'unobtainable'
        : // `missing` holds EVERY item when there is no account to subtract, so
          // the "not owned" verdict is only trustworthy once one has arrived.
          !hasAccount
          ? 'unmeasured'
          : missing.has(entry.uniqueName)
            ? 'missing'
            : rank != null && rank >= entry.maxRank
              ? 'mastered'
              : 'owned';
      out.push({ entry, state, rank, vaulted: entry.vaulted === true });
    }

    return out.sort(
      (a, b) =>
        STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
        a.entry.masteryReq - b.entry.masteryReq ||
        a.entry.name.localeCompare(b.entry.name),
    );
  }, [db, report, selected, xpByType, hasAccount]);

  const shown = useMemo(() => {
    if (!tiles) return [];
    const q = query.trim().toLowerCase();
    return tiles.filter(
      (t) =>
        (!hasAccount || !missingOnly || t.state === 'missing') &&
        (!hideVaulted || !t.vaulted) &&
        (q === '' || t.entry.name.toLowerCase().includes(q)),
    );
  }, [tiles, hasAccount, missingOnly, hideVaulted, query]);

  if (catalog === null) {
    return (
      <div className="grid h-full place-items-center p-8">
        <EmptyState
          title="Loading the item catalog"
          detail="Fetching the masterable item list. Every total on this panel is counted from it, so they appear once it lands."
        />
      </div>
    );
  }

  if (!db || !report || !totals || !completion || !picture) {
    const why = catalog && 'error' in catalog ? catalog.error : 'the catalog did not index';
    return (
      <div className="grid h-full place-items-center p-8">
        <EmptyState
          title="No item catalog"
          detail={`The item catalog did not load (${why}). Every total on this panel is counted from it, so none of them can be shown.`}
        />
      </div>
    );
  }

  /** Founder exclusives in the open category: in the list, out of the row's total. */
  const founderHere = report.byCategory.get(selected)?.unobtainableExcluded ?? 0;

  /**
   * The hero ring states a percentage and a fraction — how you are doing, never
   * what to do next. `tiles` (below) already sorts state first, then mastery
   * requirement ascending, then name, so the cheapest thing left to go and get
   * in the open category is whichever `missing` tile sorted first; a second
   * sort here would risk disagreeing with the list underneath it. `tiles` can
   * still be `null` with an account read — this category's own fetch failed,
   * distinct from "checked and nothing is missing" and worded differently below.
   */
  const easiestMissing = hasAccount ? (tiles?.find((t) => t.state === 'missing') ?? null) : null;

  // The arc and the numeral in its centre must be the SAME measurement, or the
  // headline gauge quietly disagrees with its own label. Both are drawn from
  // `totalRatio`: owned and total with vaulted items taken off each side.
  // `totalPct` is only the gate - null when there is nothing obtainable to count.
  const totalPct = hasAccount ? obtainablePct(totals) : null;
  // The ring's arc and numeral describe the fraction printed beside them: owned
  // over the catalog with the Founder items already removed. The vaulted ceiling
  // is the ghost mark on each category bar, not a second denominator here.
  const totalRatio = hasAccount && totals.total > 0 ? totals.owned / totals.total : 0;
  // Without `XPInfo` there is no affinity ledger, so every mastery figure below
  // would be a floor of zero dressed up as a measurement. Ownership counts are
  // unaffected — those come from the equipment arrays, which are always present.
  const measured = picture.fromLedger;
  // Against the ESTIMATE, not against `picture.rank` - which is the reported
  // rank itself whenever the game sent one, so the old subtraction here was
  // always zero and this chip could never appear. `masteryFromAccount` computes
  // it now, beside the two numbers it is the difference of.
  const rankGap = measured ? picture.rankGap : null;

  /** The reasoning behind each figure, folded away under the grid rather than
   *  printed three times in body copy between the ring and the first item. */
  const howMeasured: ReadonlyArray<{ label: string; text: string }> = [
    {
      label: 'Of all mastery',
      text: measured
        ? 'Measured against every masterable item in the game, Founder exclusives included. This one can never reach 100% and that is not your fault.'
        : hasAccount
          ? 'The total is known — every masterable item in the game — but the game has not sent item ranks yet, so how much of it you have finished cannot be measured.'
          : 'The total is known — every masterable item in the game.',
    },
    {
      label: 'Of obtainable',
      text: measured
        ? 'The same mastery against only what an account opened today can still acquire. Reachable — but the ceiling moves with every update.'
        : 'The Founder exclusives are already out of this total, so it is the one an account can actually finish.',
    },
    {
      label: 'To next rank',
      // `toNextRank.rank` is the rank the GAME reports, not what the item ranks
      // add up to; the old sentence credited the game's figure to equipment.
      // Both measured figures are stated as themselves, and when they disagree
      // the reason the figure is blank is that disagreement, nothing invented.
      text: measured
        ? completion.toNextRank.pct != null
          ? `The only figure that moves this week. Counted from your item ranks toward MR ${completion.toNextRank.next}.${
              picture.reportedRank != null ? ` They add up to MR ${completion.toNextRank.rank}, matching what the game reports.` : ''
            }`
          : `Not shown. Your item ranks add up to ${rankName(picture.estimatedRank)} (MR ${picture.estimatedRank}) while the game reports MR ${picture.reportedRank ?? picture.rank}. Until the two agree there is no honest progress figure to draw.`
        : 'Rank progress needs the item ranks the game sends. Without them, printing 0% here would be a claim rather than a reading.',
    },
  ];

  /** Whether anything could not be measured. With nothing to report the strip is
   *  not rendered at all, rather than drawn as an empty ruled band. */
  const warned =
    (hasAccount && !picture.fromLedger) ||
    (rankGap != null && rankGap !== 0) ||
    db.missingCategories.length > 0 ||
    report.unmatched.length > 0;

  return (
    /*
     * THE PANEL IS A FIXED-HEIGHT GRID, NOT A GROWING COLUMN.
     *
     * Measured in a real browser at 1280x720 with no account read - the cold
     * launch, which is what the owner actually sees: this was ONE scroller
     * holding the ring, three completion figures, a folded eleven-row picker
     * and only then the item list, so the catalogue the whole panel exists for
     * started a screen and a half below the fold while a third of the window
     * sat empty beside it.
     *
     * It is now the shape the Platinum panel proved. The ANSWER - what you are
     * missing and how far along you are - is a band pinned at the top that
     * never scrolls away. The REFERENCE - the picker, the provenance and the
     * eight hundred catalogue rows - sits beside it in panes that scroll on
     * their own. The page itself never scrolls at all.
     *
     * `min-h-0` on every row and column of the chain is what makes that true,
     * and it is the easy thing to leave out: a grid child defaults to
     * `min-height: auto` and refuses to shrink below its content, so one
     * missing `min-h-0` anywhere and the whole thing grows again with no
     * visible sign that anything is wrong.
     */
    <div className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,auto)_minmax(9rem,1fr)] gap-4 p-5">
      {/* ------------------------------------------------------------- answer */}
      {/*
        THE HERO IS A BAND, AND IT READS ACROSS RATHER THAN DOWN.

        Identity, title, the answer, the ring and the three figures were five
        stacked blocks about 450px tall inside a 629px window. They are the
        same five things, laid along the width the panel was already not using.

        `mo-field` on the outer element is what the document-level pointer
        tracker matches; it writes `--mxp/--myp/--mdx/--mdy` there and they
        inherit, so nothing inside needs a handler. `mo-tilt` reads the signed
        fractions and rotates the plate through a real `perspective()`, so the
        rim, the ring and the figures move together as one object. `mo-sheen`
        goes on the INNER div and not the outer, because the outer is a
        one-pixel rim - a light drawn on it lights the border and nothing else.
      */}
      <header
        className="mo-field mo-tilt anim-rise min-w-0"
        style={{ clipPath: CHAMFER, padding: 1, background: GOLD_RIM }}
      >
        <div className="mo-sheen min-w-0 px-5 py-4" style={{ clipPath: CHAMFER, background: GOLD_FILL }}>
          {/*
            IDENTITY AND TITLE ON ONE LINE.

            The title is the panel's SUBJECT, not its headline - the headline
            is the answer under it - and as its own block at lead size it was
            taking a fifth of a band that has to stay short enough for the
            catalogue to be on the same screen.
          */}
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <span aria-hidden className="size-[5px] rotate-45" style={{ background: 'var(--color-orokin-400)' }} />
            <span className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
              Collection
            </span>
            <h1
              className="min-w-0 font-[family-name:var(--font-title)] text-[length:var(--text-small)] tracking-[0.2em] uppercase"
              style={{ color: 'var(--color-orokin-200)' }}
            >
              Every masterable item, owned against what exists
            </h1>
          </div>

          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-8 gap-y-4">
            {/*
              THE ANSWER, AND WITH NO ACCOUNT IT IS THE ONLY SENTENCE.

              Four states, not two: no account read, the category's own fetch
              failed, something is missing, or nothing obtainable is left. Each
              says a different true thing rather than the same blank filled in.

              The no-account branch is the account banner itself, which used to
              be a second full-width plate above this one saying the same thing
              in a different costume - a banner there, a title here, and a
              third "Showing the catalog" note in between. It is stated once.
            */}
            <div className="min-w-0 flex-1 basis-[16rem]">
              {!hasAccount ? (
                <AccountBanner />
              ) : tiles === null ? (
                <>
                  <div className="eyebrow">Cheapest pick unknown</div>
                  <p className="wf-note mt-1">
                    {CATEGORY_LABEL[selected]}&apos;s item list failed to fetch, so which one is cheapest to go and get
                    cannot be said.
                  </p>
                </>
              ) : easiestMissing ? (
                /*
                  THE CATEGORY IS NAMED, because the answer is only about the
                  category. `tiles` is rebuilt per selected tab, so this is the
                  cheapest missing WARFRAME while the Warframes tab is open -
                  and it sits beside a ring that counts the whole catalogue.
                  "The easiest one you are missing" read as a claim about
                  everything and would have been wrong for every tab but the
                  widest one.
                */
                <>
                  <div className="eyebrow">
                    {/* The label is plural ("Warframes"), so the sentence is built
                        around it rather than in front of it - "the easiest
                        warframes you are missing" names one item with a plural. */}
                    Easiest of the {CATEGORY_LABEL[selected].toLowerCase()} you are missing
                  </div>
                  <div className="mt-1 text-[length:var(--text-lead)]" style={{ color: 'var(--color-orokin-200)' }}>
                    {easiestMissing.entry.name}
                  </div>
                  <p className="numeric mt-1 text-[length:var(--text-micro)]" style={{ color: 'var(--text-faint)' }}>
                    Mastery rank {easiestMissing.entry.masteryReq} to use it
                  </p>
                </>
              ) : (
                <>
                  <div className="eyebrow">Nothing obtainable left</div>
                  <p className="wf-note mt-1">
                    Every {CATEGORY_LABEL[selected].toLowerCase()} you can still get is already in your inventory.
                  </p>
                </>
              )}
            </div>

            {hasAccount ? (
              <div className="flex min-w-0 flex-1 basis-[18rem] items-center gap-5">
                {/* The arc and the numeral in its centre are the SAME
                    measurement, or the headline gauge quietly disagrees with
                    its own label. Both are drawn from `totalRatio`: owned and
                    total with the Founder items taken off each side. */}
                <Ring className="shrink-0" value={totalRatio} size={118} thickness={8} gap={70}>
                  <div className="stat text-[length:var(--text-lead)]" style={{ color: 'var(--color-orokin-300)' }}>
                    {totalPct == null ? UNKNOWN : <Counter value={totalRatio * 100} format={asPct} />}
                  </div>
                  <div className="eyebrow mt-0.5">obtainable</div>
                </Ring>

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div>
                    <div className="stat text-[length:var(--text-lead)]" style={{ color: 'var(--text)' }}>
                      <Counter value={totals.owned} format={asCount} />
                      <span className="numeric text-[length:var(--text-small)]" style={{ color: 'var(--text-faint)' }}>
                        {' / '}
                        {totals.total}
                      </span>
                    </div>
                    {/* The denominator drops the Founder exclusives (they are
                        subtracted from both sides of every ratio on this panel),
                        so it says so here rather than leaving the mastery panel's
                        catalog total looking like a different count. */}
                    <div className="eyebrow mt-1">
                      items owned
                      {totals.unobtainableExcluded > 0 && ` · ${totals.unobtainableExcluded} Founder-only excluded`}
                    </div>
                  </div>
                  <span aria-hidden className="h-px w-full" style={{ background: 'var(--hairline)' }} />
                  {/* "Missing" is `total − owned`. */}
                  <div className="flex flex-col gap-1 text-[length:var(--text-micro)]">
                    <span style={{ color: 'var(--color-orokin-400)' }}>{totals.masteredOwned} at max rank</span>
                    <span style={{ color: 'var(--color-signal-rare)' }}>
                      {totals.vaultedTotal - totals.vaultedOwned} missing &amp; vaulted
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {totals.missing.length - (totals.vaultedTotal - totals.vaultedOwned)} missing &amp; farmable
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              /*
                WITH NOTHING READ, THE BAND PRINTS NUMBERS INSTEAD OF DASHES.

                Measured at 1280x720 with no account: this half of the band was
                a ring reading "—", an owned count reading "—", a "— at max
                rank — not measured" line and three completion figures each
                reading "—" over a "— / N" denominator. Six readouts, every one
                of them the same single fact - nobody has run the game yet -
                which the sentence to the left already states in words.
                ————————————————————————————————————————————
                Every number below is real and comes from the catalog, which is
                game data and is worth reading before Warframe has ever been
                launched. Nothing is lost: the two mastery denominators that
                sat under the dashed figures are the last line here, and each
                figure's own reasoning is one press away in "How these are
                measured" beside the picker.
              */
              <div className="min-w-0 flex-1 basis-[18rem]">
                <div className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
                  What the catalog holds
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[length:var(--text-micro)]">
                  <span className="stat text-[length:var(--text-lead)]" style={{ color: 'var(--text)' }}>
                    {asCount(totals.total)}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>masterable items</span>
                  {totals.unobtainableExcluded > 0 && (
                    <span style={{ color: 'var(--text-muted)' }}>
                      {totals.unobtainableExcluded} Founder-only excluded
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[length:var(--text-micro)]">
                  <span style={{ color: 'var(--color-signal-rare)' }}>{totals.vaultedTotal} vaulted, trade only</span>
                  <span style={{ color: 'var(--text-muted)' }}>{totals.total - totals.vaultedTotal} farmable today</span>
                </div>
                {/* The denominators of the two completion figures. They are
                    catalog facts and do not need an account to be true; the
                    figures themselves do, being a fraction of these. */}
                {completion.ofObtainable.total != null && completion.ofAvailable.total != null && (
                  <div className="numeric mt-1.5 text-[length:var(--text-micro)]" style={{ color: 'var(--text-faint)' }}>
                    {asCount(completion.ofObtainable.total)} mastery obtainable ·{' '}
                    {asCount(completion.ofAvailable.total)} counting the Founder exclusives
                  </div>
                )}
              </div>
            )}

            {/* The three-number completion. One figure would have to pick a single
                denominator, and each of these three answers a different question.
                Account only: with nothing read all three are the same dash, and a
                dash three times is not three readings. */}
            {hasAccount && (
              <div className="grid min-w-0 flex-1 basis-[16rem] grid-cols-1 gap-5 sm:grid-cols-3">
                <Figure
                  label="Of all mastery"
                  value={!measured || completion.ofAvailable.pct == null ? UNKNOWN : asFinePct(completion.ofAvailable.pct)}
                  denominator={
                    // One glyph for "we cannot say", app-wide. The `?` here sat
                    // directly under a `—` meaning the same thing.
                    `${measured ? asCount(completion.earned) : UNKNOWN} / ${completion.ofAvailable.total == null ? UNKNOWN : asCount(completion.ofAvailable.total)}`
                  }
                />
                <Figure
                  label="Of obtainable"
                  value={!measured || completion.ofObtainable.pct == null ? UNKNOWN : asFinePct(completion.ofObtainable.pct)}
                  denominator={
                    `${measured ? asCount(completion.earned) : UNKNOWN} / ${completion.ofObtainable.total == null ? UNKNOWN : asCount(completion.ofObtainable.total)}`
                  }
                />
                <Figure
                  label="To next rank"
                  tone="energy"
                  value={measured && completion.toNextRank.pct != null ? asPct(completion.toNextRank.pct) : UNKNOWN}
                  denominator={
                    measured && completion.toNextRank.xpToNextRank != null
                      ? `${asCount(completion.toNextRank.xpToNextRank)} to MR ${completion.toNextRank.next}`
                      : measured
                        ? 'item ranks do not add up to the game’s rank'
                        : 'the game has not sent item ranks yet'
                  }
                />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------------- reference */}
      {/*
        TWO PANES, AND THE PICKER NO LONGER STANDS IN FRONT OF THE LIST.

        The eleven category tiles were a fold sitting between the hero and the
        item list, which is the worst place for a picker: closed it cost a
        press to read, open it cost most of a screen, and either way the list
        started below it. Beside the list it is simply visible - which is what
        a picker is for - and it costs the list nothing, because the width it
        takes is width the list was leaving empty at the right of the window.

        Both panes scroll on their own. That is the point of the fixed grid
        above: eight hundred catalogue rows can be as long as they like without
        moving the answer off the top of the screen.
      */}
      <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_minmax(0,2fr)] gap-4 xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] xl:grid-rows-1">
        <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto">
          {/*
            What the panel could NOT measure, and nothing else. Every line that
            was merely true — the equipment-only caveat, the Founder exclusions,
            a normalisation that succeeded — reads as a caption rather than a
            warning, and belongs in the fold below.

            It leads this pane rather than trailing the band: a caveat about a
            figure has to be on the same screen as the figure, and here it is
            the first thing under it rather than the last thing after eight
            hundred rows.
          */}
          {warned && (
            <div className="flex flex-wrap items-center gap-2">
              {/* No "no account captured" chip here. The band says exactly that
                  in a sentence, on the same screen, and this strip is for
                  provenance the sentence does NOT cover. It was one of eight
                  restatements of a single absence. */}
              {hasAccount && !picture.fromLedger && (
                <Chip tone="warn">the game has not sent item ranks yet — mastery understated</Chip>
              )}
              {rankGap != null && rankGap !== 0 && (
                <Chip tone="warn">
                  game reports MR {picture.reportedRank} · {rankGap > 0 ? `${rankGap} rank` : `${-rankGap} rank`}
                  {Math.abs(rankGap) === 1 ? '' : 's'} {rankGap > 0 ? 'unaccounted for' : 'over-counted'}
                </Chip>
              )}
              {db.missingCategories.length > 0 && (
                <Chip tone="warn">no catalog for {db.missingCategories.join(', ')}</Chip>
              )}
              {/* The consequence, not the pipeline stage: what a player loses by
                  this is that the item is not counted as owned. */}
              {report.unmatched.length > 0 && (
                <Chip tone="warn">
                  {report.unmatched.length} owned item{report.unmatched.length === 1 ? '' : 's'} the catalog does not
                  know — not counted as owned
                </Chip>
              )}
            </div>
          )}

          {/*
            THREE LEVELS, BECAUSE THERE ARE GENUINELY THREE.

            This was one fold holding ninety words of body copy: the
            equipment-only caveat, then a paragraph per figure, then the
            Founder exclusion, then two raw path lists. Opening it replaced
            three clean numbers with a page of prose and left the reader to
            work out which paragraph belonged to which figure.

            It is a hierarchy and it now looks like one. The verdict is the
            three figures in the band. The WORKING is one line - what the three
            of them count. Each figure's own reasoning is one level in,
            labelled with the figure's name so there is no matching up to do,
            and each states its verdict on the closed row so a reader can see
            which one is measured without opening any of them. The PROVENANCE -
            the raw item paths behind the two "not in the catalog" caveats - is
            a level in from that.

            Nothing was cut. Every sentence that was here is still here, under
            the label it belongs to.
          */}
          <Disclosure eyebrow="Provenance" summary="How these are measured" answer={<span>equipment only</span>}>
            <p className="wf-prose">
              All three count equipment only. Star chart nodes, junctions and intrinsics pay mastery too and are not in
              these totals — the mastery panel has those.
            </p>

            {howMeasured.map((h) => (
              <Disclosure
                key={h.label}
                depth={1}
                summary={h.label}
                // The closed row carries the figure's STATE, not the figure:
                // the number itself is in the band above, and printing it twice
                // on one screen is the duplication this panel keeps having to
                // be cured of.
                answer={<span>{measured ? 'measured' : 'not measured'}</span>}
              >
                <div
                  className="max-w-[76ch] text-[length:var(--text-micro)] leading-relaxed"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Clamp lines={2}>{h.text}</Clamp>
                </div>
              </Disclosure>
            ))}

            {totals.unobtainableExcluded > 0 && (
              <p className="wf-note">
                {totals.unobtainableExcluded} Founder exclusives are removed from both sides of the obtainable figure.
              </p>
            )}
            {report.unmatched.length > 0 && (
              <Paths label="owned, and not in the catalog" paths={report.unmatched.map((u) => u.itemType)} />
            )}
            {picture.unknownTypes.length > 0 && (
              <Paths label="ranked, and not in the catalog — mastery understated" paths={picture.unknownTypes} />
            )}
          </Disclosure>

          {/* ONE COLUMN, because this pane is 17rem wide. The two- and
              three-column grid these tiles used to sit in was sized for the
              full window, which is where they used to be. */}
          <div className="min-w-0">
            <div className="eyebrow mb-1.5">
              {/* With no account the row's number is a catalog total rather than
                  a fraction, so the word the eleven rows used to each carry -
                  "masterable" - is said once, here, instead of eleven times. */}
              {hasAccount
                ? 'By category · ghost mark = ceiling without trading'
                : 'By category · masterable items in the live catalog'}
            </div>
            <div className="rf-staged grid grid-cols-1 gap-[3px]" style={staggerFor(ITEM_CATEGORIES.length)}>
              {ITEM_CATEGORIES.map((c, i) => (
                <CategoryRow
                  key={c}
                  category={c}
                  own={report.byCategory.get(c)}
                  selected={c === selected}
                  onSelect={() => {
                    setSelected(c);
                  }}
                  delay={110 + i * 18}
                  measured={hasAccount}
                />
              ))}
            </div>
          </div>
        </div>

        {/* --------------------------------------------------------------- list */}
        {/*
          `relative` ON THE PANE, AND IT IS LOAD-BEARING.

          The deep-link scroll above walks `offsetTop` up through `offsetParent`
          until it reaches the scroller it found. A static scroller is never an
          `offsetParent`, so the walk would run straight past this pane to
          `main` and return an offset carrying the whole band above it - which
          is the "correct row, correctly highlighted, nine hundred pixels off
          screen" failure this file already records once.

          `mo-arrive` rather than `anim-rise` with a delay: scroll-driven
          progress comes from position, so there is no clock in it to stop on
          this overlay's frozen document timeline. Now that the pane is beside
          the band rather than below the fold it is always in view, which holds
          the rule at its end state - the settled one - which is the right
          fallback rather than a section stranded nine pixels low forever.
        */}
        <section className="mo-arrive relative flex min-h-0 min-w-0 flex-col overflow-y-auto">
          {/*
            THE SCROLLER CARRIES NO PADDING OF ITS OWN.

            The header below is sticky, and a scroll container's own padding is
            not something a sticky child can stick against: the header parked a
            padding's width down the scrollport and item rows scrolled up
            through the strip left above it. This pane's inset is the grid's
            own gap instead, so `top-0` is flush with the top of the visible
            list and the header - opaque and full-bleed - actually covers what
            passes under it. The `-mx-7 px-7` that used to fake that is gone
            along with the padding which made it necessary.
          */}
          <div
            className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-3 py-2.5"
            style={{ background: HEADER_PLATE }}
          >
            <h2
              className="font-[family-name:var(--font-title)] text-[length:var(--text-small)] tracking-[0.26em] uppercase"
              style={{ color: 'var(--color-orokin-300)' }}
            >
              {CATEGORY_LABEL[selected]}
            </h2>
            {/* `tiles` is null when THIS category's catalog failed to fetch, and
                the old fallback printed "0 of 0" — a confident measurement of a
                list we could not read at all. */}
            <span className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
              {tiles == null ? `${UNKNOWN} items` : `${shown.length} of ${tiles.length}`}
            </span>
            {/* The list counts every masterable item in the category; the
                category row beside it counts what an account can actually
                obtain, which is that minus the Founder exclusives. Two true
                numbers one apart read as a contradiction unless the difference
                is named where it happens — the row calls the same items
                "Founder-only". */}
            {founderHere > 0 && <span className="eyebrow">incl. {founderHere} Founder-only</span>}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
                placeholder="Filter by name"
                aria-label="Filter items by name"
                className="mo-focusable numeric w-36 px-3 py-[6px] text-[length:var(--text-micro)] outline-none placeholder:opacity-55"
                style={{
                  clipPath: CLIP.button,
                  background: 'oklch(0 0 0 / 0.35)',
                  boxShadow: 'inset 0 0 0 1px var(--hairline)',
                  color: 'var(--text)',
                }}
              />
              {/* Only offered with an account: with none, "missing" would match
                  every item in the catalog and the filter would assert you own
                  nothing. */}
              {hasAccount && (
                <Toggle
                  on={missingOnly}
                  onClick={() => {
                    setMissingOnly((v) => !v);
                  }}
                >
                  Missing only
                </Toggle>
              )}
              <Toggle
                on={hideVaulted}
                onClick={() => {
                  setHideVaulted((v) => !v);
                }}
              >
                Hide vaulted
              </Toggle>
            </div>
          </div>

          {/* Legend. Four states carried purely by a colour would be a puzzle, so
              each row also prints its state in words — this only names the bar. */}
          <div className="mo-stagger mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[length:var(--text-nano)]">
            {/* `--i` is set per swatch because a fragment does not create a DOM
                node: these spans really are the direct children `mo-stagger`
                selects, and without an index every one of them would take the
                same delay - which is a stagger that does not stagger. */}
            {hasAccount ? (
              <>
                <span className="mo-in-left" style={{ color: 'var(--color-orokin-300)', '--i': '0' } as CSSProperties}>
                  gold edge — mastered
                </span>
                <span className="mo-in-left" style={{ color: 'var(--color-tenno-300)', '--i': '1' } as CSSProperties}>
                  cyan edge — owned
                </span>
                <span className="mo-in-left" style={{ color: 'var(--text-muted)', '--i': '2' } as CSSProperties}>
                  grey edge — not owned
                </span>
              </>
            ) : (
              <span className="mo-in-left" style={{ color: 'var(--text-muted)', '--i': '0' } as CSSProperties}>
                grey edge — ownership not measured
              </span>
            )}
            <span className="mo-in-left" style={{ color: 'var(--color-signal-rare)', '--i': '3' } as CSSProperties}>
              hatched — vaulted, trade only
            </span>
            <span className="mo-in-left" style={{ color: 'var(--color-signal-bad)', '--i': '4' } as CSSProperties}>
              red edge — Founder, unobtainable
            </span>
          </div>

          {tiles == null ? (
            <EmptyState
              title={`No catalog for ${CATEGORY_LABEL[selected]}`}
              detail="That category's item list failed to fetch, so its contents are unknown rather than empty. It will retry on the next launch."
            />
          ) : shown.length === 0 ? (
            <EmptyState
              title={hasAccount && missingOnly ? 'Nothing missing here' : 'Nothing matches'}
              detail={
                hasAccount && missingOnly
                  ? `Every ${CATEGORY_LABEL[selected].toLowerCase()} in the catalog is already in your inventory${hideVaulted ? ', vaulted items aside' : ''}.`
                  : 'No item in this category matches the current filters.'
              }
            />
          ) : (
            // Rows, in as many columns as the width allows. Dense and readable beats
            // a grid of big plates with every name cut off mid-word.
            <ul
              className="rf-staged grid gap-[3px]"
              /* Up to 235 rows here: without a computed step the cascade ran to
                 442ms and row 19 arrived before row 18. */
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(268px, 1fr))', ...staggerFor(shown.length) }}
            >
              {shown.map((t, i) => (
                <ItemRow key={t.entry.uniqueName} tile={t} index={i} focused={t.entry.uniqueName === focus} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* No footer. "Totals from the live catalog, not hardcoded" is a promise
          made to a code reviewer — a player has no model in which the
          alternative existed — and the heading over the categories already says
          where the totals come from. */}
    </div>
  );
}
