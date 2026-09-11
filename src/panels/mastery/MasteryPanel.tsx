/**
 * MASTERY — the rank centrepiece, and the advice that moves it.
 *
 * Three things happen here and only three:
 *
 *   1. The catalog (`itemdb`) is projected onto the mastery engine's `MasteryDb`.
 *      That join lives here rather than in either module because it is a *policy*
 *      decision — which WFCD category pays 200/rank, which bucket a Necramech
 *      lands in — and both modules are deliberately free of policy.
 *   2. `masteryFromAccount` / `honestCompletion` produce the rank picture.
 *   3. `masteryOpportunities` produces the payoff: what to level next, ranked by
 *      affinity-per-mastery-point, which is the only ranking that is not a lie.
 *
 * The honesty contract from `mastery.ts` is carried through to the pixels: a
 * `null` line renders as "not measured", never as 0, and the gap between the rank
 * we can *explain* and the rank the game *reports* is shown rather than smoothed
 * away — that gap is the size of what this app cannot yet account for.
 *
 * PRESENTATION
 * ────────────
 * One bold element: the rank ring. Everything below it is small, low-chroma and
 * dense — chamfered plates and hairline-ruled section headings rather than a
 * field of glowing cards. The decorative energy field that used to sit behind
 * the two directives is gone: it was sheen, not light, and it made a plain plate
 * look like wet plastic.
 *
 * Entrances are the CSS `.anim-rise` class with a staggered delay, never a JS
 * tween. rAF does not run while the overlay window is hidden, and a content
 * reveal that never runs must fail *visible*.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useAccount } from '../../core/store';
import type { RawAccount } from '../../data/account';
import { loadCatalog, type LoadedCatalog } from '../../data/datasets';
import { loadItemDb, type ItemCategory, type ItemDb, type ItemDbEntry } from '../../data/itemdb';
import {
  honestCompletion,
  masteryFromAccount,
  masteryOpportunities,
  normaliseItemType,
  rankName,
  JUNCTION_MASTERY,
  type MasteryBreakdown,
  type MasteryDb,
  type MasteryEntry,
  type MasteryOpportunity,
  type MasteryOptions,
  type MasterySource,
} from '../../data/mastery';
import { intrinsicsState } from '../../data/subsystems';
import { Counter, DataTable, EmptyState, Meter, Ring, Tabs, type Column, type TabItem } from '../../ui/orokin';
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { ItemArt } from '../../ui/ItemArt';
import { ItemDetail } from '../../ui/ItemDetail';
import { navigate } from '../../ui/navigation';
import { staggerFor } from '../../ui/stagger';
import { CHAMFER } from '../../ui/geometry';

/* ------------------------------------------------------------------ formatting */

/** Module scope so `Counter` never sees a new identity and restarts its tween. */
const fmtInt = (n: number): string => Math.round(n).toLocaleString();

const COMPACT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const compact = (n: number): string => COMPACT.format(Math.round(n));

/** One decimal, but a started figure never reads 0.0% and an unfinished one never 100.0%. */
const pct1 = (n: number): string => {
  const s = n.toFixed(1);
  if (s === '0.0' && n > 0) return '<0.1%';
  if (s === '100.0' && n < 100) return '99.9%';
  return `${s}%`;
};

/** A number we could not measure. Never a zero — a zero reads as a measurement. */
const UNKNOWN = '—';

/**
 * The ONE reason a rank figure can be absent while an account is present.
 *
 * It used to be one arm of a ternary repeated at three call sites, whose other
 * arm explained the missing account — a sentence the banner at the top of the
 * panel already owns. The rank grid is now rendered only when an account exists,
 * so the other arm was unreachable and this is all that is left.
 */
const RANKS_DISAGREE =
  'The mastery this panel can add up does not match the rank the game reports, so any figure here would come from a total known to be wrong.';

/* ------------------------------------------- catalog -> mastery engine (policy) */

const SOURCE_OF: Readonly<Record<ItemCategory, MasterySource>> = {
  Warframes: 'frames',
  Primary: 'primaries',
  Secondary: 'secondaries',
  Melee: 'melee',
  Sentinels: 'companions',
  SentinelWeapons: 'companions',
  Pets: 'companions',
  Archwing: 'archwing',
  'Arch-Gun': 'archwing',
  'Arch-Melee': 'archwing',
  Misc: 'other',
};

/**
 * The 200-mastery-per-rank classes (mastery.ts §4.1). Sentinels and Pets are here
 * because every companion pays the frame rate; `SentinelWeapons` is deliberately
 * absent because a companion's *gun* does not.
 */
const FRAME_RATE: ReadonlySet<ItemCategory> = new Set<ItemCategory>([
  'Warframes',
  'Archwing',
  'Sentinels',
  'Pets',
]);

/**
 * K-Drives and the Plexus land in WFCD's `Misc` bucket but pay the frame rate.
 * Matched on the display type because that is the only field that distinguishes
 * them from the amps and modular parts sharing that file.
 */
const MISC_FRAME_RATE = /k-?drive|plexus/i;

/** Necramechs are `Warframes` rows; only `productCategory` separates them. */
const MECH_PRODUCT_CATEGORY = 'MechSuits';

/**
 * Founder-exclusive. Matched by display name for the same reason `itemdb` does:
 * the research verified the items but never their `uniqueName`s, and inventing a
 * path is the failure this codebase has already been burned by.
 */
const FOUNDER_ONLY: ReadonlySet<string> = new Set(['Excalibur Prime', 'Lato Prime', 'Skana Prime']);

function masteryEntryFor(e: ItemDbEntry): MasteryEntry {
  const category = e.productCategory === MECH_PRODUCT_CATEGORY ? 'necramech' : SOURCE_OF[e.category];
  const isFrame =
    category === 'necramech' ||
    FRAME_RATE.has(e.category) ||
    (e.category === 'Misc' && MISC_FRAME_RATE.test(e.type ?? e.name));

  return {
    name: e.name,
    category,
    isFrame,
    // WFCD's `masterable` is the only machine-readable signal that exists. Note it
    // is NOT `excludeFromCodex`, which mastery.ts §2.3 warns under-counts by 9,000.
    grantsMastery: e.masterable,
    maxLevelCap: e.maxRank,
    ...(FOUNDER_ONLY.has(e.name) ? { obtainable: false } : {}),
  };
}

/**
 * The join. Node and junction tables are attached only when their dataset really
 * loaded: an absent table makes the engine report those lines as `null`, which is
 * the truth, whereas an empty one would report a confident 0.
 */
function masteryDbFrom(items: ItemDb, loaded: LoadedCatalog | null): MasteryDb {
  const map = new Map<string, MasteryEntry>();
  for (const e of items.byType.values()) map.set(normaliseItemType(e.uniqueName), masteryEntryFor(e));

  const db: { items: Map<string, MasteryEntry>; nodes?: Map<string, number>; junctions?: Set<string> } = {
    items: map,
  };

  const junctions = loaded?.status.junctions
    ? new Set(loaded.catalog.junctions.map((j) => j.id))
    : undefined;
  if (junctions) db.junctions = junctions;

  if (loaded?.status.nodes) {
    const nodes = new Map<string, number>();
    for (const [id, node] of loaded.catalog.nodeById) {
      // All 13 junctions are ALSO rows in the node dataset, at 1,000 each. The
      // engine checks the node table first, so leaving them in would credit every
      // junction to the star chart line, permanently pin "Junctions" at zero, and
      // inflate the completion denominator by 26,000 by counting them on both
      // sides. The junction set owns them; the node table must not.
      if (junctions?.has(id)) continue;
      /*
       * `> 0`, not merely `=== 'number'`.
       *
       * All 355 node rows carry a numeric `mastery`, but only 182 carry a real
       * payout: 173 read exactly 0, and those zeros are a COVERAGE HOLE, not a
       * game rule. Fifteen whole regions read 0 on every node - Lua, the Void,
       * Kuva Fortress, Zariman, Duviri, Sanctuary Onslaught and all seven
       * Proximas - and the same planet and mission type flip between a value
       * and 0 (Venus Defense: Tessera 18, Romula 0). nodes.json's sourceNote is
       * exhaustive about every other defect in the file and never mentions
       * `mastery`, so absence is byte-identical to zero here.
       *
       * Admitting the zeros made the engine assert "this node pays nothing",
       * which is a measurement nobody took. Excluded, the known pool is 27,569
       * over 182 payers - verified against the file.
       */
      if (typeof node.mastery === 'number' && node.mastery > 0) nodes.set(id, node.mastery);
    }
    db.nodes = nodes;
  }
  return db;
}

/* --------------------------------------------------------------------- loading */

interface Sources {
  items: ItemDb | null;
  catalog: LoadedCatalog | null;
  failed: boolean;
}

/** Both datasets are independently cached, so this costs one fetch per session. */
function useSources(): Sources {
  const [items, setItems] = useState<ItemDb | null>(null);
  const [catalog, setCatalog] = useState<LoadedCatalog | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadItemDb().then(
      (db) => {
        if (alive) setItems(db);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    void loadCatalog().then(
      (c) => {
        if (alive) setCatalog(c);
      },
      () => {
        // The star chart is optional here: without it the node and junction lines
        // report unknown and the rest of the panel is unaffected.
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  return { items, catalog, failed };
}

/* ------------------------------------------------------------------- materials */

/**
 * Cut, not rounded. Radius is the single strongest "this is a web dashboard"
 * signal there is; the game chamfers every plate it draws.
 */

type Tone = 'gold' | 'energy' | 'quiet';

/** The lit rim. Brightest at the top-left, because the whole app is lit there. */
const RIM: Readonly<Record<Tone, string>> = {
  gold: 'var(--plate-gold-rim)',
  energy: 'linear-gradient(150deg, var(--color-tenno-400), oklch(0.78 0.115 228 / 0.18) 42%, transparent 78%)',
  quiet: 'linear-gradient(150deg, oklch(1 0 0 / 0.20), oklch(1 0 0 / 0.05) 42%, transparent 78%)',
};

const FILL: Readonly<Record<Tone, string>> = {
  gold: 'var(--plate-gold-fill)',
  energy:
    'radial-gradient(120% 150% at 0% 0%, oklch(0.78 0.115 228 / 0.12), transparent 58%), linear-gradient(168deg, oklch(0.16 0.03 242 / 0.97), oklch(0.10 0.022 258 / 0.98))',
  quiet: 'linear-gradient(168deg, oklch(0.155 0.024 268 / 0.96), oklch(0.105 0.022 275 / 0.97))',
};

/**
 * A dark chamfered plate: rim gradient outside, fill one pixel in.
 *
 * EVERY PLATE IN THIS PANEL NOW TAKES THE LIGHT, AND IT IS BUILT IN HERE
 * ─────────────────────────────────────────────────────────────────────
 * These plates were flat: a fixed radial baked into `FILL` that pretends the
 * app is lit from the top-left, and nothing that acknowledges a pointer. Three
 * of them sit side by side on this panel, so "flat" was multiplied.
 *
 * The two classes are split across the two elements on purpose and it is not
 * interchangeable. `mo-field` goes on the OUTER section, because that is the
 * element the document-level pointer tracker matches and writes `--mxp/--myp`
 * onto; those inherit, so everything inside sees them with no handler anywhere.
 * `mo-sheen` goes on the INNER div, because the outer element is a one-pixel
 * rim - a light drawn on it would light the border and nothing else.
 *
 * The sheen is drawn on `::after` at `z-index: -1` inside the inner div's own
 * stacking context (`isolation: isolate`), which paints it above the plate's
 * fill and below its text: a light on the surface rather than a wash over the
 * numbers. And `clip-path` clips descendants, so it stays inside the chamfer
 * without a second mask.
 *
 * All of it is hover-gated, which is what exempts it from the transform-only
 * rule: a pointer cannot be over a window that is not being presented, so
 * `--mo-on` is only ever non-zero while the timeline is running.
 */
function Plate({
  tone = 'quiet',
  padding = 'p-5',
  className,
  style,
  children,
}: {
  tone?: Tone;
  padding?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <section
      className={`mo-field${className === undefined ? '' : ` ${className}`}`}
      style={{ clipPath: CHAMFER, padding: 1, background: RIM[tone], ...style }}
    >
      <div className={`mo-sheen h-full ${padding}`} style={{ clipPath: CHAMFER, background: FILL[tone] }}>
        {children}
      </div>
    </section>
  );
}

/**
 * A section heading. The rule fills the remaining width, which is what makes a
 * heading read as a divider rather than as a floating label.
 */
function Heading({ children, note, aside }: { children: ReactNode; note?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-2">
      {/*
        The heading drifts slower than the section it names. `mo-parallax` is
        scroll-driven - `animation-timeline: view()` - so its progress comes
        from position, not from a clock, and a frozen timeline has nothing to
        strand. Transform only, so the worst case is a heading fourteen pixels
        from where it belongs and completely readable.
      */}
      <h2
        className="mo-parallax font-[family-name:var(--font-title)] text-[length:var(--text-small)] tracking-[0.26em] uppercase"
        style={{ color: 'var(--color-orokin-300)' }}
      >
        {children}
      </h2>
      <span aria-hidden className="h-px flex-1" style={{ background: 'var(--rule-hairline)' }} />
      {note != null && <span className="eyebrow">{note}</span>}
      {aside}
    </header>
  );
}

/** The one label the whole panel leans on. Never a zero standing in for a gap. */
function NotMeasured({ title }: { title?: string }) {
  return (
    <span
      className="text-[length:var(--text-micro)] tracking-[0.14em] uppercase"
      style={{ color: 'var(--text-muted)' }}
      title={title}
    >
      not measured
    </span>
  );
}

/**
 * One of the three rank figures beside the ring.
 *
 * A `null` value used to render a large em-dash with the words "not measured"
 * stacked under it — the same absence stated twice, in three adjacent columns,
 * under a ring that already said it a fourth time. The words win: they carry
 * the reason in their tooltip and the dash carries nothing.
 */
function RankStat({
  label,
  value,
  ink,
  unknownTitle,
}: {
  label: string;
  value: number | null;
  ink: string;
  unknownTitle: string;
}) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      {value == null ? (
        <div className="mt-2.5">
          <NotMeasured title={unknownTitle} />
        </div>
      ) : (
        <div className="stat mt-1.5 text-[length:var(--text-lead)]" style={{ color: ink }}>
          <Counter value={value} format={fmtInt} />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- breakdown rows */

interface SourceRow {
  key: keyof MasteryBreakdown;
  label: string;
  color: string;
}

/**
 * Hues are pulled from the faction tokens rather than a ramp of one colour: eleven
 * shades of gold are indistinguishable in a 6px stacked bar, eleven hues are not.
 */
const SOURCE_ROWS: readonly SourceRow[] = [
  { key: 'frames', label: 'Warframes', color: 'var(--color-orokin-400)' },
  { key: 'primaries', label: 'Primaries', color: 'var(--color-faction-corpus)' },
  { key: 'secondaries', label: 'Secondaries', color: 'var(--color-tenno-300)' },
  { key: 'melee', label: 'Melee', color: 'var(--color-faction-grineer)' },
  { key: 'companions', label: 'Companions', color: 'var(--color-faction-infested)' },
  { key: 'archwing', label: 'Archwing', color: 'var(--color-faction-sentient)' },
  { key: 'necramech', label: 'Necramech', color: 'var(--color-faction-murmur)' },
  { key: 'other', label: 'Amps · Zaws · K-Drives', color: 'var(--color-void-400)' },
  { key: 'nodes', label: 'Star chart', color: 'var(--color-signal-good)' },
  { key: 'junctions', label: 'Junctions', color: 'var(--color-faction-narmer)' },
  { key: 'intrinsics', label: 'Intrinsics', color: 'var(--color-signal-rare)' },
];

const CATEGORY_LABEL: Readonly<Record<MasterySource, string>> = {
  frames: 'Warframe',
  primaries: 'Primary',
  secondaries: 'Secondary',
  melee: 'Melee',
  companions: 'Companion',
  archwing: 'Archwing',
  necramech: 'Necramech',
  other: 'Other',
};

/**
 * Which of the eleven attribution rows correspond to ITEMS on the board below.
 *
 * `CATEGORY_LABEL` is already exactly the eight item sources, so it is the
 * membership test — `nodes`, `junctions` and `intrinsics` are missions and
 * subsystems, they have no rows in the table and cannot filter it.
 */
const isItemSource = (k: keyof MasteryBreakdown): k is MasterySource => k in CATEGORY_LABEL;

/* ------------------------------------------------------------- opportunity grid */

const displayName = (o: MasteryOpportunity): string =>
  o.name ?? o.itemType.split('/').pop() ?? o.itemType;

/**
 * 150 affinity per mastery point is the floor — a plain weapon or a plain frame.
 * A rank-40 weapon costs 928, which is 6.2x worse and is completionist work, not
 * progress. Colouring the ratio is the fastest way to say that without a legend.
 */
function ratioTone(v: number): string {
  if (v <= 200) return 'var(--color-signal-good)';
  if (v <= 500) return 'var(--color-signal-warn)';
  return 'var(--color-signal-bad)';
}

/*
 * Column widths, and why the headers are terse.
 *
 * The table is `table-layout: fixed`, so Item gets whatever the fixed columns
 * leave. At 51rem of fixed columns a 900px table left Item 35px wide. The
 * seven below sum to ~42rem, which keeps Item at ~220px there; the headers are
 * cut to fit one line at that width (the header cell cannot wrap) and each
 * carries its long form as a tooltip.
 */
const OPS_COLUMNS: ReadonlyArray<Column<MasteryOpportunity>> = [
  {
    key: 'name',
    header: 'Item',
    compare: (a, b) => displayName(a).localeCompare(displayName(b)),
    render: (o) => (
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rotate-45"
          style={{ background: o.owned ? 'var(--color-orokin-400)' : 'var(--color-void-500)' }}
        />
        <span
          className="font-[family-name:var(--font-display)] font-semibold"
          style={{ color: o.owned ? 'var(--text)' : 'var(--text-muted)' }}
        >
          {displayName(o)}
        </span>
        {o.obtainable === false && (
          <span className="eyebrow" style={{ color: 'var(--color-signal-bad)' }}>
            unobtainable
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'category',
    header: 'Class',
    width: '6.5rem',
    compare: (a, b) => a.category.localeCompare(b.category),
    render: (o) => <span className="eyebrow">{CATEGORY_LABEL[o.category]}</span>,
  },
  {
    key: 'status',
    header: 'Held',
    width: '4.5rem',
    compare: (a, b) => Number(b.owned) - Number(a.owned),
    render: (o) => (
      <span style={{ color: o.owned ? 'var(--color-orokin-300)' : 'var(--text-faint)' }}>
        {o.owned ? 'Owned' : 'No'}
      </span>
    ),
  },
  {
    key: 'earned',
    header: 'Earned',
    align: 'right',
    width: '5rem',
    compare: (a, b) => b.earned - a.earned,
    render: (o) => (
      <span style={{ color: o.earned > 0 ? 'var(--text-muted)' : 'var(--text-faint)' }}>{fmtInt(o.earned)}</span>
    ),
  },
  {
    key: 'remaining',
    header: <span title="Mastery this item still pays">Left</span>,
    align: 'right',
    width: '4.5rem',
    compare: (a, b) => b.remaining - a.remaining,
    render: (o) => <span style={{ color: 'var(--color-orokin-300)' }}>+{fmtInt(o.remaining)}</span>,
  },
  {
    key: 'affinity',
    header: <span title="Affinity still to grind, Forma re-levels included">Affinity</span>,
    align: 'right',
    width: '6.5rem',
    compare: (a, b) => a.affinityRemaining - b.affinityRemaining,
    // `compact` renders 900K. The exact figure used to be repeated as a row in
    // the expanded card; it lives here instead, where it does not duplicate.
    render: (o) => <span title={o.affinityRemaining.toLocaleString()}>{compact(o.affinityRemaining)}</span>,
  },
  {
    key: 'ratio',
    header: <span title="Affinity per mastery point — lower is better">Per point</span>,
    align: 'right',
    width: '7.5rem',
    compare: (a, b) => a.affinityPerPoint - b.affinityPerPoint,
    render: (o) => <span style={{ color: ratioTone(o.affinityPerPoint) }}>{Math.round(o.affinityPerPoint)}</span>,
  },
  {
    key: 'forma',
    // `formaForCap`: what the item's rank cap demands from unranked - five for a
    // rank-40 item - not Forma already on your copy, which the catalog cannot see.
    header: <span title="Forma the rank cap demands, starting unranked">Forma to cap</span>,
    align: 'right',
    width: '8rem',
    compare: (a, b) => a.forma - b.forma,
    render: (o) => (o.forma > 0 ? String(o.forma) : <span style={{ color: 'var(--text-faint)' }}>0</span>),
  },
];

/**
 * The same board with no account behind it.
 *
 * Every column here is a property of the ITEM — what it is worth, what it costs
 * to max from scratch, how many Forma that takes. `earned`, `remaining` and
 * `owned` are dropped rather than printed at their no-account values, because
 * with nothing to subtract those would assert an empty arsenal.
 */
/**
 * The catalog columns, built around an artwork lookup.
 *
 * A factory rather than a constant because the name cell renders the item's
 * actual art, and the `imageName` for that lives in the loaded item catalog —
 * which a module-scope constant cannot reach. Everything else about the columns
 * is static; only the lookup is injected.
 *
 * The art matters most here: this is 803 rows, and a diamond bullet in front of
 * every one of them distinguishes nothing. A silhouette does.
 */
function catalogColumns(artOf: (itemType: string) => string | undefined): ReadonlyArray<Column<MasteryOpportunity>> {
  return [
  {
    key: 'name',
    header: 'Item',
    compare: (a, b) => displayName(a).localeCompare(displayName(b)),
    render: (o) => (
      <span className="flex items-center gap-2.5">
        <ItemArt imageName={artOf(o.itemType)} name={displayName(o)} owned={null} size={26} />
        <span className="font-[family-name:var(--font-display)] font-semibold" style={{ color: 'var(--text)' }}>
          {displayName(o)}
        </span>
        {o.obtainable === false && (
          <span className="eyebrow" style={{ color: 'var(--color-signal-bad)' }}>
            unobtainable
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'category',
    header: 'Class',
    width: '6.5rem',
    compare: (a, b) => a.category.localeCompare(b.category),
    render: (o) => <span className="eyebrow">{CATEGORY_LABEL[o.category]}</span>,
  },
  /*
   * No `Held` column here, deliberately.
   *
   * With no account every one of the 803 rows renders the same em-dash, and it
   * was the only header in the table with nothing to sort by — a column that
   * costs width and carries no information. The section note and the banner
   * above already say ownership is unmeasured; saying it 803 more times in a
   * fixed-width column does not make it truer.
   */
  {
    key: 'worth',
    header: 'Mastery worth',
    align: 'right',
    width: '8rem',   // room for the header itself under fixed table layout
    compare: (a, b) => b.potential - a.potential,
    render: (o) => <span style={{ color: 'var(--color-orokin-300)' }}>{fmtInt(o.potential)}</span>,
  },
  {
    key: 'affinity',
    header: <span title="Affinity to max from unranked, Forma re-levels included">Affinity</span>,
    align: 'right',
    width: '6.5rem',
    compare: (a, b) => a.affinityRemaining - b.affinityRemaining,
    // `compact` renders 900K. The exact figure used to be repeated as a row in
    // the expanded card; it lives here instead, where it does not duplicate.
    render: (o) => <span title={o.affinityRemaining.toLocaleString()}>{compact(o.affinityRemaining)}</span>,
  },
  {
    key: 'ratio',
    header: <span title="Affinity per mastery point — lower is better">Per point</span>,
    align: 'right',
    width: '7.5rem',
    compare: (a, b) => a.affinityPerPoint - b.affinityPerPoint,
    render: (o) => <span style={{ color: ratioTone(o.affinityPerPoint) }}>{Math.round(o.affinityPerPoint)}</span>,
  },
  {
    key: 'forma',
    // `formaForCap`: what the item's rank cap demands from unranked - five for a
    // rank-40 item - not Forma already on your copy, which the catalog cannot see.
    header: <span title="Forma the rank cap demands, starting unranked">Forma to cap</span>,
    align: 'right',
    width: '8rem',
    compare: (a, b) => a.forma - b.forma,
    render: (o) => (o.forma > 0 ? String(o.forma) : <span style={{ color: 'var(--text-faint)' }}>0</span>),
  },
  ];
}

const TABS: readonly TabItem[] = [
  { id: 'owned', label: 'Owned' },
  { id: 'unowned', label: 'Not owned' },
  { id: 'all', label: 'Everything' },
];

/** The table is a scanning tool, not a spreadsheet; past ~120 rows nobody reads. */
const ROW_LIMIT = 120;

/** How many of the cheapest unowned items the directive names. */
const CHEAP_N = 12;

/** How many raw paths a fold prints before it says how many are left. */
const PATH_LIMIT = 25;

/* ---------------------------------------------------------------- sub-sections */

interface FreeLine {
  label: string;
  detail: string;
  earned: number | null;
  max: number | null;
  color: string;
  /**
   * The panel that owns this pool, when one exists and has something to show.
   *
   * Set makes the row pressable. "Star chart · 227 nodes · +112,000 left" is the
   * most actionable line on the screen and it named a whole subsystem as dead
   * text, on a chamfered plate with an accent bar that reads as pressable.
   */
  panel?: string;
}

/**
 * The three pools that pay mastery for no affinity at all. §5.3 puts them above
 * every item on the board — 161,000 points with nothing to level — so they sit
 * above the item table even though they are not items.
 *
 * Rows, not cards: three big plates for three numbers is a poster, and the
 * detail line under each is the part a player actually reads.
 */
function FreeMastery({ lines }: { lines: readonly FreeLine[] }) {
  // Only worth labelling a line "not measured" when the OTHER lines carry a
  // number. With no account all three are absent, and the banner at the top of
  // the panel has already said that once — three more labels turn one fact into
  // a wall that reads as the app being broken.
  const anyKnown = lines.some((l) => l.earned != null && l.max != null && l.max > 0);

  return (
    <ul className="rf-staged flex flex-col gap-[3px]" style={staggerFor(lines.length)}>
      {lines.map((line) => {
        const known = line.earned != null && line.max != null && line.max > 0;
        const left = known ? Math.max(0, (line.max ?? 0) - (line.earned ?? 0)) : null;
        const ratio = known ? (line.earned ?? 0) / (line.max ?? 1) : 0;
        const panel = line.panel;

        const body = (
          <>
            <div className="min-w-0 flex-1">
              <span
                className="font-[family-name:var(--font-display)] text-[length:var(--text-micro)] font-semibold"
                style={{ color: 'var(--text)' }}
              >
                {line.label}
              </span>
              <p className="wf-note mt-0.5">
                {line.detail}
              </p>
            </div>

            <div className="flex w-[196px] shrink-0 flex-col items-end gap-1.5">
              {left == null ? (
                <>
                  {anyKnown && (
                    <NotMeasured title="What this pool has paid you is read from the account; without it, what is left is unknown rather than zero." />
                  )}
                  {/* The pool's SIZE is game data even when your share of it is
                      not, so it is still worth stating. */}
                  {line.max != null && (
                    <span
                      className="numeric text-[length:var(--text-micro)]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {fmtInt(line.max)} in this pool
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="numeric text-[length:var(--text-micro)]" style={{ color: line.color }}>
                    +{fmtInt(left)}
                  </span>
                  <span className="h-[3px] w-full overflow-hidden" style={{ background: 'oklch(1 0 0 / 0.07)' }}>
                    <span
                      className="block h-full"
                      style={{ width: `${Math.max(2, ratio * 100)}%`, background: line.color }}
                    />
                  </span>
                  <span
                    className="numeric text-[length:var(--text-micro)]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {fmtInt(line.earned ?? 0)} of {fmtInt(line.max ?? 0)} banked
                  </span>
                </>
              )}
            </div>
          </>
        );

        return (
          <li
            key={line.label}
            className="rf-row relative"
            style={{ clipPath: CHAMFER, background: 'var(--plate-lift)' }}
          >
            <span
              aria-hidden
              className="absolute top-0 bottom-0 left-0 z-10 w-[2px]"
              style={{ background: line.color, opacity: known ? 0.9 : 0.4 }}
            />

            {/* Not `.rf-row`: that class draws its own 2px leading edge on hover,
                directly over the accent bar this row already has. Travel alone,
                and travel is a transform — nothing here is revealed by it.

                `mo-magnet` replaces the flat `hover:translate-x-0.5`. Same
                family, same safety, but the direction comes from where the
                pointer actually is: the `<li>` above carries `.rf-row`, which
                the document tracker already writes `--mdx/--mdy` onto, so the
                row leans TOWARD the cursor instead of always to the right, and
                it costs no handler and no layout read to do it. `mo-focusable`
                keeps the keyboard equivalent, as a ring bloom rather than a
                translate a keyboard user has to notice. */}
            {panel != null ? (
              <button
                type="button"
                onClick={() => {
                  navigate(panel);
                }}
                className="mo-magnet mo-focusable flex w-full items-center gap-4 py-2.5 pr-4 pl-4 text-left"
              >
                {body}
              </button>
            ) : (
              <div className="flex items-center gap-4 py-2.5 pr-4 pl-4">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A counted list, opened.
 *
 * `unknownTypes` is every entry in the player's own ledger this catalog cannot
 * explain — the exact content of the rank-gap warning beside it, and the most
 * interesting data on the panel for anyone asking why the numbers disagree. It
 * was summed to an integer and thrown away. The paths are raw and ugly, which is
 * why they are folded and set as `<code>`: that is the item's real identity, and
 * it is the only thing that lets a player say which item is missing.
 */
function PathFold({ label, paths, className }: { label: string; paths: readonly string[]; className?: string }) {
  const shown = paths.slice(0, PATH_LIMIT);

  /*
   * WAS A HAND-ROLLED FOLD; IS NOW THE SHARED DISCLOSURE.
   *
   * The old version was `.rf-reveal` - a grid that goes `0fr` to `1fr` with no
   * transition - plus a chevron button, plus an `inert` toggle, all written out
   * here and again, near-identically, in CollectionPanel. Two copies of a
   * pattern is where they start to drift, and the thing they must not get wrong
   * is precisely the thing that is easy to "improve" by adding a height
   * transition to one of them.
   *
   * `Disclosure` is that pattern, once, with the reason for it in its header:
   * the region opens instantly at full height and only its CHILDREN move, by
   * transform, because this overlay's document timeline can stop on the frame
   * after the click. It also unmounts the body when closed, which the old fold
   * did not - so a 25-path list costs nothing until it is asked for.
   *
   * And it gains what the old fold never had: the closed row now states its own
   * answer - how many paths are in there - so the count is legible without
   * opening anything, which was the whole point of printing the label.
   */
  return (
    <div className={className}>
      <Disclosure
        accent="var(--color-signal-warn)"
        eyebrow="Not in the catalog"
        summary={label}
        answer={<span>{fmtInt(paths.length)} paths</span>}
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
        {/* The remainder is the real length minus what was printed. Never a
            padded list and never an invented entry. */}
        {paths.length > shown.length && (
          <span className="eyebrow mt-1.5 block">
            and {fmtInt(paths.length - shown.length)} more
          </span>
        )}
      </Disclosure>
    </div>
  );
}

interface DirectiveProps {
  eyebrow: string;
  headline: string;
  gain: number;
  affinity: number;
  names: string[];
  share: number;
  tone: 'gold' | 'energy';
  /** Stagger index within the directive grid, not a millisecond count. */
  i: number;
}

/** Reads as a sentence, not a stat. Quiet plate — the rank ring is the loud one. */
function Directive({ eyebrow, headline, gain, affinity, names, share, tone, i }: DirectiveProps) {
  const ink = tone === 'gold' ? 'var(--color-orokin-300)' : 'var(--color-tenno-300)';

  return (
    /*
     * `mo-in-settle` rather than `anim-rise` with a hand-written delay.
     *
     * The delay was a magic number per call site - 110ms, 150ms - which is how
     * a panel ends up with fourteen slightly different rhythms. The parent grid
     * carries `mo-stagger` and each card carries its index, so the step comes
     * from one token (`--mo-step`) and is capped by the rule rather than by
     * whoever typed the last number.
     *
     * `settle` is the right keyframe for these two specifically: they are cards
     * that land on the surface, with the overshoot in the curve. It is still
     * transform only - translate and a 0.6deg rotation - so a frozen timeline
     * leaves a card slightly low and very slightly askew, and completely
     * readable.
     *
     * `mo-lift` is the hover half: the card comes toward you. It is a different
     * element from the sheen inside `Plate`, so the two do not fight over
     * `transform`.
     */
    <Plate
      tone={tone}
      className="mo-in-settle mo-lift h-full"
      style={{ '--i': String(i) } as CSSProperties}
    >
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="size-[5px] rotate-45" style={{ background: ink }} />
        <span className="eyebrow" style={{ color: ink }}>
          {eyebrow}
        </span>
      </div>

      <h3
        className="mt-2.5 font-[family-name:var(--font-display)] text-[length:var(--text-lead)] leading-tight font-semibold"
        style={{ color: 'var(--text)' }}
      >
        {headline}
      </h3>

      <div className="mt-3.5 flex items-baseline gap-3">
        <span className="stat text-[length:var(--text-title)]" style={{ color: ink }}>
          +<Counter value={gain} format={fmtInt} />
        </span>
        <span className="numeric text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
          mastery · {compact(affinity)} affinity
        </span>
      </div>

      <Meter
        className="mt-3.5"
        value={share}
        color={ink}
        height={5}
        caption={`${pct1(share * 100)} of everything you have left`}
      />

      {names.length > 0 && (
        // A <div>, not a <p>, so `Clamp` can live in it: Clamp is a div wrapping
        // a button, and a div inside a p is closed by the parser at the div.
        // Five item names run to three lines on a narrow overlay and the fifth
        // is never the one anybody needed - the first is. One line, with the
        // rest one press away.
        <div className="mt-3 text-[length:var(--text-small)] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          <Clamp lines={1}>{names.join(' · ')}</Clamp>
        </div>
      )}
    </Plate>
  );
}

/* -------------------------------------------------------------- waiting states */

/**
 * The panel WITHOUT an account.
 *
 * This used to refuse to render at all until the game had run, which threw away
 * the ~800-item masterable catalog, every rank cap and every affinity figure —
 * all of them facts about the GAME, none of them about a player. Only the rank,
 * the ledger and what is owned need an account, so only those go unmeasured.
 */
function AccountBanner() {
  const running = useAccount((s) => s.gameRunning);
  const gep = useAccount((s) => s.gep);

  const [title, detail] = !running
    ? [
        'Showing the whole catalog, unmeasured',
        'Every masterable item, its rank cap and what it pays are game data and are listed below. Your rank and your item ranks are not: run Warframe once and they are captured and kept, after which this panel stays accurate with the game closed.',
      ] as const
    : gep === 'connected'
      ? [
          'Linked — waiting for your account',
          'Your account arrives with the next update Warframe pushes, usually within a minute of reaching the Orbiter.',
        ] as const
      : [
          'Linking to the game',
          'Establishing the game-events connection. This normally takes a few seconds after launch.',
        ] as const;

  return (
    <section
      className="mo-field mo-sheen anim-rise flex items-start gap-3 px-4 py-3"
      style={{
        clipPath: CHAMFER,
        background: 'linear-gradient(168deg, oklch(0.17 0.03 80 / 0.55), oklch(0.12 0.02 70 / 0.6))',
        boxShadow: 'inset 2px 0 0 var(--color-orokin-500)',
      }}
    >
      <div className="min-w-0">
        <div className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
          {title}
        </div>
        {/*
          A <div> and a Clamp, not a <p>. The longest of the three details runs
          to three sentences and is the FIRST thing a new player reads on this
          panel, above a ring that already says "not measured" - so it was three
          lines of explanation in front of the thing being explained. The title
          above carries the state; one line carries the reason; the rest is a
          press away. `-webkit-line-clamp` is layout, not animation, so the
          frozen timeline cannot leave it collapsed to nothing.
        */}
        <div className="mt-1 text-[length:var(--text-small)] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          <Clamp lines={1}>{detail}</Clamp>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------- panel */

export default function MasteryPanel() {
  const inventory = useAccount((s) => s.inventory);
  const { items, catalog, failed } = useSources();
  const [tab, setTab] = useState<string>('owned');
  /**
   * The attribution legend, used as a filter.
   *
   * "Primaries account for 18% of your mastery" is the question "which primaries
   * do I still owe?", and the answer was 800 rows away with no path to it.
   */
  const [cat, setCat] = useState<MasterySource | null>(null);
  /** The legend sits BELOW the table it filters, so a click has to bring it back. */
  const boardRef = useRef<HTMLElement>(null);

  const db = useMemo(() => (items ? masteryDbFrom(items, catalog) : null), [items, catalog]);

  /**
   * Normalised item path -> artwork filename.
   *
   * Keyed the same way `masteryDbFrom` keys its map, so an opportunity's
   * `itemType` joins straight onto it with no per-row search over 882 entries.
   */
  const artByType = useMemo(() => {
    const map = new Map<string, string>();
    if (!items) return map;
    for (const e of items.byType.values()) {
      if (e.imageName !== undefined) map.set(normaliseItemType(e.uniqueName), e.imageName);
    }
    return map;
  }, [items]);

  const catalogCols = useMemo(() => catalogColumns((t) => artByType.get(t)), [artByType]);

  /**
   * The item counts the footer prints, taken from the SAME map the board is
   * built from.
   *
   * They used to come from the catalog's per-category tallies, which printed
   * "800 masterable" under a board of 803 rows with "882 items known" beside
   * both - three figures for one population. One source means the footer
   * cannot disagree with the rows above it: the board is `db.items` filtered
   * to `grantsMastery`, and so is this.
   */
  const counts = useMemo(() => {
    let masterable = 0;
    let founder = 0;
    if (db) {
      for (const e of db.items.values()) {
        if (!e.grantsMastery) continue;
        masterable++;
        if (e.obtainable === false) founder++;
      }
    }
    return { masterable, founder };
  }, [db]);

  // Intrinsic ranks are not in `RawInventory`'s declared shape but are in the same
  // blob; `subsystems` reads every field defensively, so the cast cannot make a
  // missing field render as a number.
  //
  // Called even with no account, which is how IntrinsicsPanel reads the ceiling:
  // the branch count, the rank cap per branch and therefore the SIZE of the pool
  // are game constants that fall out of an empty account unchanged. Only `ranks`
  // needs an account, and every read of it below is gated on `measured`.
  const intrinsics = useMemo(
    () => intrinsicsState((inventory ?? {}) as unknown as RawAccount),
    [inventory],
  );

  // Gated on the inventory, not on `intrinsics`: handing the engine 0 ranks from
  // an empty account would turn "unknown" into a confident zero on that line.
  const options = useMemo<MasteryOptions>(
    () =>
      inventory
        ? { railjackIntrinsicRanks: intrinsics.railjack.ranks, drifterIntrinsicRanks: intrinsics.drifter.ranks }
        : {},
    [inventory, intrinsics],
  );

  const picture = useMemo(
    () => (db ? masteryFromAccount(inventory, db, options) : null),
    [inventory, db, options],
  );

  const completion = useMemo(
    () => (picture && db ? honestCompletion(picture, db, options) : null),
    [picture, db, options],
  );

  const ops = useMemo(() => (db ? masteryOpportunities(inventory, db) : []), [inventory, db]);

  const split = useMemo(() => {
    const owned = ops.filter((o) => o.owned);
    // Unobtainable items are excluded from advice: telling a player to acquire
    // Excalibur Prime is not advice. They stay in the table under "Everything".
    const unowned = ops.filter((o) => !o.owned && o.obtainable !== false);
    const sum = (xs: readonly MasteryOpportunity[], pick: (o: MasteryOpportunity) => number): number =>
      xs.reduce((t, o) => t + pick(o), 0);

    const cheapUnowned = unowned.slice(0, CHEAP_N);
    // The cut almost always lands inside a run of equal ratios - every plain
    // weapon costs the same 150 per point - so the N shown are the biggest
    // prizes among the tied (mastery.ts orders ties that way), and how many
    // more tie at the cut is counted so the copy can say so.
    const cutoff = cheapUnowned[cheapUnowned.length - 1]?.affinityPerPoint;
    let cheapTied = 0;
    if (cutoff !== undefined) {
      for (let i = cheapUnowned.length; unowned[i]?.affinityPerPoint === cutoff; i++) cheapTied++;
    }
    const totalRemaining = sum(ops, (o) => o.remaining);
    return {
      owned,
      unowned,
      cheapUnowned,
      cheapTied,
      ownedGain: sum(owned, (o) => o.remaining),
      ownedAffinity: sum(owned, (o) => o.affinityRemaining),
      cheapGain: sum(cheapUnowned, (o) => o.remaining),
      cheapAffinity: sum(cheapUnowned, (o) => o.affinityRemaining),
      totalRemaining,
    };
  }, [ops]);

  // Everything below is a fact about the GAME until an account arrives. This one
  // flag is what separates the two, and it gates every account-derived figure.
  const measured = inventory !== null;

  // Without an account the owned/unowned split is meaningless (nothing can be
  // owned), so the catalog is the whole board.
  // Not memoised: each branch returns an existing array, so the reference is
  // stable per branch and the memo below keys on it correctly.
  const base = !measured ? ops : tab === 'owned' ? split.owned : tab === 'unowned' ? split.unowned : ops;

  // The source filter is applied BEFORE the cap, so the 120 rows shown are the
  // 120 cheapest within the category rather than whatever survived a cap taken
  // across all eight.
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byCat = cat == null ? base : base.filter((o) => o.category === cat);
    return q.length === 0 ? byCat : byCat.filter((o) => (o.name ?? o.itemType).toLowerCase().includes(q));
  }, [base, cat, query]);

  // Uncapped with no account: the catalog is the point of the screen then,
  // rather than a shortlist of advice.
  const rows = useMemo(() => (measured && !showAll ? filtered.slice(0, ROW_LIMIT) : filtered), [measured, filtered, showAll]);

  if (failed) {
    return (
      <div className="grid h-full place-items-center p-8">
        <EmptyState
          className="w-full max-w-[52ch]"
          title="Item catalog unavailable"
          detail="Mastery totals need the item catalog, and every attempt to fetch it failed. Your rank still exists — this panel just cannot say what it is out of until the catalog loads."
        />
      </div>
    );
  }

  if (!db || !picture || !completion) {
    return (
      <div className="grid h-full place-items-center p-8">
        <EmptyState
          className="w-full max-w-[46ch]"
          title="Indexing the catalog"
          detail="Matching your item ranks against every masterable item in the game."
        />
      </div>
    );
  }

  const { toNextRank } = completion;
  // Null when our XP model disagrees with the game's own rank, and null again
  // when there is no account at all. Drawing a ring from a figure we know is
  // wrong — or from a zero we invented — would be a confidently wrong number.
  const ringValue = measured && toNextRank.pct != null ? toNextRank.pct / 100 : null;
  // Same correction as the collection panel: `picture.rank` IS `reportedRank`
  // when the game sent one, so this used to be a guaranteed zero and every note
  // and eyebrow below it was unreachable.
  const rankGap = picture.rankGap;

  const breakdownTotal = SOURCE_ROWS.reduce((t, r) => t + (picture.breakdown[r.key] ?? 0), 0);

  const freeLines: FreeLine[] = [
    {
      label: 'Junctions',
      detail: db.junctions ? `${db.junctions.size} junctions, Steel Path counts each twice` : 'junction data still loading',
      earned: picture.breakdown.junctions,
      max: db.junctions ? db.junctions.size * JUNCTION_MASTERY * 2 : null,
      color: 'var(--color-faction-narmer)',
      // Only when the dataset actually loaded: sending a player to a star chart
      // that has no junctions in it is worse than not offering the jump.
      ...(db.junctions ? { panel: 'starchart' } : {}),
    },
    {
      label: 'Intrinsics',
      // The ranks you HAVE need an account; how many exist does not. The other
      // two rows print their pool size with no account, and this one used to
      // print nothing at all next to the words "intrinsic ranks unknown".
      detail: measured
        ? `${intrinsics.railjack.ranks}/${intrinsics.railjack.maxRanks} Railjack · ${intrinsics.drifter.ranks}/${intrinsics.drifter.maxRanks} Drifter`
        : `${intrinsics.railjack.maxRanks} Railjack and ${intrinsics.drifter.maxRanks} Drifter ranks exist`,
      earned: picture.breakdown.intrinsics,
      max: intrinsics.masteryXpMax,
      color: 'var(--color-signal-rare)',
      // Always: the intrinsics panel reads the account itself and states its own
      // absence, so it is worth arriving at with or without one.
      panel: 'intrinsics',
    },
    {
      label: 'Star chart',
      detail: db.nodes ? `${db.nodes.size} nodes with a recorded payout, Steel Path counts each twice` : 'star chart data still loading',
      earned: picture.breakdown.nodes,
      max: db.nodes ? [...db.nodes.values()].reduce((t, v) => t + v, 0) * 2 : null,
      color: 'var(--color-signal-good)',
      ...(db.nodes ? { panel: 'starchart' } : {}),
    },
  ];

  /*
   * THE ANSWERS THE FOLDED SECTIONS SHOW WHILE CLOSED.
   *
   * A section that says nothing when closed is a section nobody opens, so each
   * of the three below is computed from the SAME arrays the section renders -
   * never from a second source that could drift away from what is inside.
   *
   * `freeKnown` is the honesty gate: with no account every pool's earned figure
   * is null, and summing nulls as zeroes would put "+161,000 left" on the row
   * as though it had been measured. Unmeasured, the row states the pool's SIZE
   * instead, which is game data and true either way.
   */
  const freeKnown = freeLines.filter((l) => l.earned != null && l.max != null && l.max > 0);
  const freeLeft = freeKnown.reduce((t, l) => t + Math.max(0, (l.max ?? 0) - (l.earned ?? 0)), 0);
  const freePool = freeLines.reduce((t, l) => t + (l.max ?? 0), 0);

  /** The largest attribution row, for the legend's closed-state answer. */
  const topSource =
    measured && breakdownTotal > 0
      ? SOURCE_ROWS.reduce<{ label: string; value: number } | null>((best, r) => {
          const v = picture.breakdown[r.key];
          if (v == null || v <= 0) return best;
          return best === null || v > best.value ? { label: r.label, value: v } : best;
        }, null)
      : null;

  const notes: Array<{ text: string; tone: string }> = [];
  if (measured && !picture.fromLedger) {
    notes.push({
      text: 'The game has not sent item ranks yet — every equipment line below is unknown, not zero',
      tone: 'var(--color-signal-bad)',
    });
  }
  if (rankGap != null && rankGap > 0) {
    notes.push({
      text: `Game reports MR ${picture.reportedRank} · ${rankGap} rank${rankGap === 1 ? '' : 's'} this catalog cannot yet explain`,
      tone: 'var(--color-signal-warn)',
    });
  }
  // `unknownTypes` is not in this list: it is an ARRAY, and a note row can only
  // print its length. It gets a fold below the strip that names what is in it.
  if (items && items.missingCategories.length > 0) {
    notes.push({ text: `no ${items.missingCategories.join(' / ')} catalog`, tone: 'var(--color-signal-warn)' });
  }
  if (!db.nodes || !db.junctions) {
    notes.push({ text: 'star chart and junction totals are not available in this build', tone: 'var(--color-signal-warn)' });
  }

  // Counted after the source filter, or "120 of 803" would report a total the
  // table is no longer drawn from.
  const shownTotal = filtered.length;

  return (
    <div className="flex h-full flex-col gap-7 overflow-y-auto p-7">
      {!measured && <AccountBanner />}

      {/* ------------------------------------------------------------ the rank
          The single bold element on the panel. Everything below is small. */}
      <Plate tone="gold" padding="px-7 py-6" className="anim-rise">
        <div className="flex flex-wrap items-center gap-9">
          <div className="shrink-0">
            <Ring value={ringValue ?? 0} size={208} thickness={10} color="var(--color-orokin-400)" gap={70}>
              <div className="flex flex-col items-center">
                <span className="eyebrow eyebrow-gold">Mastery Rank</span>
                <span
                  className="stat leading-none"
                  style={{ fontSize: 'var(--text-hero)', color: measured ? 'var(--color-orokin-200)' : 'var(--text-faint)' }}
                >
                  {measured ? <Counter value={picture.rank} format={fmtInt} /> : UNKNOWN}
                </span>
                <span
                  className="mt-1.5 font-[family-name:var(--font-title)] text-[length:var(--text-nano)] tracking-[0.2em] uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {measured ? rankName(picture.rank) : 'not measured'}
                </span>
              </div>
            </Ring>
          </div>

          <div className="min-w-[20rem] flex-1">
            {/* The whole line is about the rank you are climbing towards, so with
                no rank to climb from it is not rendered as "— next rank". */}
            {measured && (
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
                <span
                  className="font-[family-name:var(--font-title)] text-[length:var(--text-lead)] tracking-[0.2em] uppercase"
                  style={{ color: 'var(--color-orokin-200)' }}
                >
                  {rankName(toNextRank.next)}
                </span>
                <span className="eyebrow">next rank</span>
                {rankGap != null && rankGap !== 0 && (
                  <span className="eyebrow" style={{ color: 'var(--color-signal-warn)' }}>
                    game says MR {picture.reportedRank}
                  </span>
                )}
              </div>
            )}

            {/* `xpIntoRank` / `xpToNextRank` are null when our XP model disagrees
                with the game's own `PlayerLevel`. That disagreement is a fact
                about this app, and it is printed rather than papered over.

                The whole grid needs an account, and with none it rendered three
                "not measured" labels in a row under a ring that had already said
                it — a wall of one fact, which reads as the app being broken
                rather than as the app waiting. The banner says it once. */}
            {measured && (
              <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
                <RankStat
                  label={`Into rank ${String(toNextRank.rank)}`}
                  value={toNextRank.xpIntoRank}
                  ink="var(--text)"
                  unknownTitle={RANKS_DISAGREE}
                />
                <RankStat
                  label="Still to earn"
                  value={toNextRank.xpToNextRank}
                  ink="var(--color-orokin-300)"
                  unknownTitle={RANKS_DISAGREE}
                />
                <RankStat
                  label="Lifetime mastery"
                  value={picture.xp}
                  ink="var(--text)"
                  unknownTitle={RANKS_DISAGREE}
                />
              </div>
            )}

            {/* A track drawn at zero is a reading of zero, and there is nothing
                to read yet — so with no account there is no bar, exactly as the
                Collection panel refuses to draw its category bars. */}
            {measured && (
              <Meter
                className="mt-5"
                value={ringValue ?? 0}
                color="var(--color-orokin-400)"
                height={8}
                label={`Rank ${toNextRank.rank} to ${toNextRank.next}`}
                caption={toNextRank.pct != null ? pct1(toNextRank.pct) : 'Not shown. Your item ranks do not add up to the rank the game reports.'}
              />
            )}

            {/* Two denominators, never one. A single "% complete" lies in both
                directions at once — see mastery.ts §5.2. */}
            <div className="mt-5 flex flex-wrap gap-x-10 gap-y-3">
              {/*
               * The denominators are catalog facts and stay on screen even with
               * no account — only the share of them goes unmeasured.
               *
               * Printed in full rather than compacted. The two totals are ~12,000
               * apart out of ~3,000,000, so `compact()` rendered BOTH as "3M" and
               * the two figures that exist precisely to differ read identically.
               */}
              <div>
                <div className="eyebrow">{measured ? 'Of everything in the game' : 'Mastery the game holds'}</div>
                <div className="numeric mt-1 text-[length:var(--text-small)]" style={{ color: 'var(--text-muted)' }}>
                  {completion.ofAvailable.total == null
                    ? UNKNOWN
                    : measured
                      ? `${completion.ofAvailable.pct != null ? pct1(completion.ofAvailable.pct) : UNKNOWN} of ${fmtInt(completion.ofAvailable.total)}`
                      : fmtInt(completion.ofAvailable.total)}
                </div>
              </div>
              <div>
                <div className="eyebrow">{measured ? 'Of what you can still get' : 'Of that, still obtainable'}</div>
                <div className="numeric mt-1 text-[length:var(--text-small)]" style={{ color: 'var(--color-tenno-300)' }}>
                  {completion.ofObtainable.total == null
                    ? UNKNOWN
                    : measured
                      ? `${completion.ofObtainable.pct != null ? pct1(completion.ofObtainable.pct) : UNKNOWN} of ${fmtInt(completion.ofObtainable.total)}`
                      : fmtInt(completion.ofObtainable.total)}
                </div>
              </div>
            </div>

            {/*
             * WHY THE ADVICE SENTENCE LIVES IN THE HERO.
             *
             * Everything else in this column - the next-rank line, the three
             * rank figures, the meter - needs an account, so with none the
             * plate was a ring beside two numbers and half a plate of nothing.
             * The sentence that used to head an otherwise empty "what moves
             * your rank next" section is exactly what belongs in that space:
             * it says why there is no order to offer yet, next to the figures
             * it is talking about.
             */}
            {!measured && (
              // Two lines, then a press. Fifty-two words explaining why there is
              // no advice, inside the hero plate, above a board that works
              // perfectly well without them - the sentence that matters is the
              // first one, and the rest is the argument for it.
              <div
                className="mt-5 max-w-[62ch] text-[length:var(--text-small)] leading-relaxed"
                style={{ color: 'var(--text-muted)' }}
              >
                <Clamp lines={2}>
                  What is worth levelling next means subtracting what you have already levelled. Until the game has run
                  once there is nothing to subtract, so no order is offered — the board below is sorted by affinity per
                  mastery point, which is a property of the items themselves.
                </Clamp>
              </div>
            )}
          </div>
        </div>

        {(notes.length > 0 || picture.unknownTypes.length > 0) && (
          <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--hairline)' }}>
            {notes.length > 0 && (
              // Each caveat arrives on its own beat rather than the strip
              // appearing as one block: these are up to four separate things
              // this panel could not verify, and a stagger says "four" without
              // printing the number. `mo-in-left` is transform-only, so a
              // frozen timeline shows every one of them, sixteen pixels left.
              <div className="mo-stagger flex flex-wrap items-center gap-x-5 gap-y-1.5">
                {notes.map((n, i) => (
                  <span
                    key={n.text}
                    className="mo-in-left flex items-center gap-2"
                    style={{ '--i': String(i) } as CSSProperties}
                  >
                    <span aria-hidden className="size-[4px] rotate-45" style={{ background: n.tone }} />
                    <span className="eyebrow" style={{ color: n.tone }}>
                      {n.text}
                    </span>
                  </span>
                ))}
              </div>
            )}

            {picture.unknownTypes.length > 0 && (
              <PathFold
                className={notes.length > 0 ? 'mt-2' : ''}
                label={`${fmtInt(picture.unknownTypes.length)} ranked items the catalog has never heard of`}
                paths={picture.unknownTypes}
              />
            )}
          </div>
        )}
      </Plate>

      {/* ------------------------------------------------------- the directives
          Advice, not catalog: every headline here is a statement about what you
          own. With no account to diff against there is nothing to rank, and the
          section used to stand as a heading over a single paragraph explaining
          its own absence. That paragraph now fills the hero plate's otherwise
          empty right half, and the section simply does not exist until there is
          advice to give. */}
      {/*
        THE PANEL IS NESTED FROM HERE DOWN, AND ONE SECTION IS OPEN.

        Below the ring this panel used to be four full-height sections stacked
        in a column - two directive cards, three free-mastery rows, an 803-row
        board and an eleven-row attribution legend - every one of them fully
        expanded, with `anim-rise` delays of 70/190/240/290ms deciding the order
        they arrived in and nothing deciding which mattered.

        Now the reader chooses their depth, and the ONE section left open is the
        one the panel is for: what to level next. The other two state their own
        answer on a closed row - how much free mastery is left, and which source
        your rank actually came from - so folding them costs a reader nothing
        and saves them roughly a screen and a half of scrolling.

        Nothing is deleted. Every figure that was on this panel is still on it,
        one press further in.
      */}
      {measured && (
        <Disclosure
          defaultOpen
          eyebrow="Ranked by affinity per mastery point"
          summary="What moves your rank next"
          answer={<span>{fmtInt(split.totalRemaining)} still on the table</span>}
        >
          {ops.length === 0 ? (
            <EmptyState
              title="Nothing left in this catalog"
              detail="Every masterable item the catalog knows about is already paying its maximum. That is the end of the item board — junctions, intrinsics and Steel Path are what remain."
            />
          ) : (
            <div className="mo-stagger grid gap-3 lg:grid-cols-2">
              <Directive
                tone="gold"
                i={0}
                eyebrow="Already in your arsenal"
                headline={
                  split.owned.length === 0
                    ? 'Everything you own is maxed'
                    : `Rank up the ${split.owned.length} item${split.owned.length === 1 ? '' : 's'} you already own`
                }
                gain={split.ownedGain}
                affinity={split.ownedAffinity}
                share={split.totalRemaining > 0 ? split.ownedGain / split.totalRemaining : 0}
                names={split.owned.slice(0, 5).map(displayName)}
              />
              <Directive
                tone="energy"
                i={1}
                eyebrow="Cheapest mastery you do not own"
                headline={
                  split.cheapUnowned.length === 0
                    ? 'You own every masterable item'
                    : split.cheapTied > 0
                      ? `${split.cheapUnowned.length} of the ${split.cheapUnowned.length + split.cheapTied} items that tie as the cheapest mastery left`
                      : `These ${split.cheapUnowned.length} are the cheapest mastery left`
                }
                gain={split.cheapGain}
                affinity={split.cheapAffinity}
                share={split.totalRemaining > 0 ? split.cheapGain / split.totalRemaining : 0}
                names={split.cheapUnowned.slice(0, 5).map(displayName)}
              />
            </div>
          )}
        </Disclosure>
      )}

      {/* ------------------------------------------------------- free mastery */}
      <Disclosure
        eyebrow="The pools that pay for no grind at all"
        summary="Mastery with no affinity behind it"
        accent="var(--color-signal-good)"
        answer={
          freeKnown.length > 0 ? (
            // What is LEFT, because that is what the reader would open for.
            <span style={{ color: 'var(--color-signal-good)' }}>+{fmtInt(freeLeft)} left</span>
          ) : (
            // With no account the share is unknown, so the row states the pool's
            // SIZE instead - game data, true with the game closed, and never a
            // zero standing in for a measurement nobody took.
            <span>{fmtInt(freePool)} in these pools</span>
          )
        }
      >
        <FreeMastery lines={freeLines} />
      </Disclosure>

      {/* --------------------------------------------------------- item board */}
      {ops.length > 0 && (
        // NOT a Disclosure, and that is the point of the one-open rule: this is
        // the working surface, it carries its own tabs and filter, and hiding a
        // table behind a press when the reader came to read the table is
        // folding for the sake of folding. `mo-arrive` gives it the entrance
        // instead - scroll-driven, so it settles as the reader reaches it and
        // there is no clock in it to freeze.
        <section ref={boardRef} className="mo-arrive">
          <Heading
            note={
              cat != null ? (
                // The filter lives in the legend at the bottom of the panel, so
                // the board has to say which one is on and be able to lift it.
                <button
                  type="button"
                  onClick={() => {
                    setCat(null);
                  }}
                  className="mo-field mo-underline mo-focusable eyebrow cursor-pointer transition-[filter] hover:brightness-125"
                  style={{ color: 'var(--color-orokin-300)' }}
                >
                  {CATEGORY_LABEL[cat]} only · clear
                </button>
              ) : measured ? undefined : (
                'mastery requirement, rank cap and worth — all catalog'
              )
            }
            aside={
              <span className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
                {/* The same word the footer uses for the same population, so
                    "803 masterable" here and there are visibly one count. */}
                {rows.length < shownTotal
                  ? `${fmtInt(rows.length)} of ${fmtInt(shownTotal)}`
                  : `${fmtInt(rows.length)} ${measured ? 'still owing' : 'masterable'}`}
              </span>
            }
          >
            {measured ? 'Every item that still owes you' : 'Every masterable item in the game'}
          </Heading>

          {/* The owned / not-owned split needs an account to exist at all. */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {measured && <Tabs items={TABS} value={tab} onChange={setTab} />}
            {/* The same frame as the Resources filter: a hairline chamfer around a dark field. */}
            <label className="relative ml-auto block" style={{ clipPath: CHAMFER, padding: 1, background: 'var(--hairline-strong)' }}>
              <span className="sr-only">Filter items by name</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by name"
                spellCheck={false}
                className="mo-focusable w-56 bg-transparent px-3 py-1.5 text-[length:var(--text-small)] outline-none placeholder:opacity-45"
                style={{ clipPath: CHAMFER, background: 'oklch(0.08 0.02 275)', color: 'var(--text)' }}
              />
            </label>
            {measured && !showAll && filtered.length > ROW_LIMIT && (
              <button type="button" className="rf-link mo-field mo-underline mo-focusable text-[length:var(--text-micro)]" onClick={() => setShowAll(true)}>
                Show all {fmtInt(filtered.length)}
              </button>
            )}
          </div>

          <DataTable
            columns={measured ? OPS_COLUMNS : catalogCols}
            rows={rows}
            rowKey={(o) => o.itemType}
            initialSort="ratio"
            /*
             * Opening a row answers the question the table cannot: WHY is this
             * item ranked where it is. The ratio column is the ranking key and
             * on its own it is an unexplained number - the affinity still owed,
             * the Forma it will cost, and the rank ceiling that produced that
             * ratio are the actual argument, and all three were computed and
             * then thrown away.
             */
            expand={(o) => {
              const entry = items?.byDisplayName.get(o.name ?? '') ?? null;
              return (
                <ItemDetail
                  entry={entry}
                  name={o.name ?? o.itemType}
                  itemType={o.itemType}
                  owned={measured ? o.owned : null}
                  /*
                   * ONLY WHAT THE ROW ABOVE DOES NOT ALREADY SAY.
                   *
                   * This list used to restate six of the seven columns it opened
                   * from - mastery worth, affinity to max, aff/point, forma - so
                   * the same six numbers appeared twice, about forty pixels
                   * apart, at the same instant. Opening a row taught the player
                   * that opening rows does nothing.
                   *
                   * `Source` was the worst of them: it printed the raw engine key
                   * ("primaries", "necramech") beside a Class column already
                   * showing the proper label, so the duplicate was also uglier
                   * than the original.
                   */
                  extra={[
                    // `potential` is in no column: the row shows what is still
                    // owed, never what the item is worth once finished.
                    // Where you actually are on it. No column carries this, and
                    // without it "900K affinity left" is a number with no anchor.
                    { label: 'Rank', value: `${String(o.rank)} of ${String(o.cap)}`, when: measured },
                    { label: 'Worth when maxed', value: o.potential.toLocaleString(), when: measured },
                    // Absent means the catalog does not know, so the row goes.
                    { label: 'Obtainable', value: o.obtainable === true ? 'yes' : 'no longer', when: o.obtainable !== undefined },
                  ]}
                />
              );
            }}
            empty={
              <EmptyState
                title={tab === 'owned' ? 'Nothing you own still owes mastery' : 'Nothing here'}
                detail={
                  tab === 'owned'
                    ? 'Every item in your arsenal is at its rank cap. The remaining mastery is all in items you have not built yet.'
                    : 'This filter matches no item the catalog knows about.'
                }
              />
            }
          />
        </section>
      )}

      {/* -------------------------------------------------------- attribution */}
      {/*
        Folded, with the answer on the closed row.

        Eleven attribution rows and a stacked bar is a legend, and a legend is
        by definition the thing you consult rather than the thing you read. What
        a reader actually takes from it is one sentence - which source your rank
        came from - so that sentence is the closed row and the eleven rows are
        the working behind it. `topSource` is computed from the same
        `picture.breakdown` the rows below render, so the summary cannot drift
        from what opening it shows.
      */}
      <Disclosure
        eyebrow={measured ? 'By source' : 'No item ranks yet — none of the eleven measured'}
        summary="Where your mastery came from"
        accent="var(--color-tenno-300)"
        answer={
          topSource === null ? (
            <span style={{ color: 'var(--text-muted)' }}>not measured</span>
          ) : (
            <span>
              {topSource.label} leads · {pct1((topSource.value / breakdownTotal) * 100)}
            </span>
          )
        }
      >
        {/* With no account every source is `null`, and the legend below already
            renders each of those as "not measured" — which is the truth. The
            empty state is only correct when an account IS present and reports
            nothing. */}
        {measured && breakdownTotal <= 0 ? (
          <EmptyState
            title="Nothing to attribute yet"
            detail="No source in this account read reports any mastery. That usually means the game has not sent item ranks yet — it is not the same as having none."
          />
        ) : (
          <>
            {breakdownTotal > 0 && (
            <div className="flex h-3.5 w-full overflow-hidden" style={{ clipPath: 'var(--clip-button)' }}>
              {SOURCE_ROWS.map((r) => {
                const v = picture.breakdown[r.key];
                if (v == null || v <= 0) return null;
                return (
                  <span
                    key={r.key}
                    className="h-full"
                    style={{
                      width: `${(v / breakdownTotal) * 100}%`,
                      background: r.color,
                      boxShadow: 'inset -1px 0 0 oklch(0 0 0 / 0.45)',
                    }}
                  />
                );
              })}
            </div>
            )}

            {/* Dense two-up rows rather than eleven meters in a bento: this is a
                legend for the bar above it, and a legend should be readable in
                one pass.

                The eight ITEM rows are also the filter for the board above: the
                share this row states is the question "which of these do I still
                owe?", and until now the answer was 800 rows away with nothing
                connecting them. The three mission rows stay inert — they have no
                items, and the free-mastery section is already their readout.

                With no account every share is null, and eleven full-width
                tracks then ruled across the panel to nothing — eleven leaders
                pointing at an absence the heading has already named. Unmeasured,
                the eleven collapse to their names on one wrapped row, which is
                all that is left to say, and the eight item sources stay
                pressable as filters for the catalog board. */}
            <ul
              className={
                measured
                  ? 'mt-3 grid gap-x-8 gap-y-[3px] xl:grid-cols-2'
                  : 'mt-3 flex flex-wrap gap-x-1 gap-y-1'
              }
            >
              {SOURCE_ROWS.map((r) => {
                const v = picture.breakdown[r.key];
                const share = v == null ? 0 : v / breakdownTotal;
                const key = r.key;
                const on = isItemSource(key) && cat === key;

                const body = (
                  <>
                    <span aria-hidden className="size-2 shrink-0 rotate-45" style={{ background: r.color }} />
                    <span
                      className="shrink-0 text-[length:var(--text-small)]"
                      style={{
                        color: on
                          ? 'var(--color-orokin-200)'
                          : measured && v == null
                            ? 'var(--text-faint)'
                            : 'var(--text-muted)',
                      }}
                    >
                      {r.label}
                    </span>
                    {measured && (
                      <span className="h-[3px] flex-1" style={{ background: 'oklch(1 0 0 / 0.07)' }}>
                        <span
                          className="block h-full"
                          style={{ width: `${share * 100}%`, background: r.color, opacity: v == null ? 0 : 1 }}
                        />
                      </span>
                    )}
                    {v == null ? (
                      // Only worth saying per row when the OTHER rows have
                      // numbers; with no account every row is null and the
                      // heading carries it once instead.
                      measured && <NotMeasured title="This source cannot be measured from what the game has sent." />
                    ) : (
                      <>
                        <span className="numeric shrink-0 text-[length:var(--text-nano)]" style={{ color: 'var(--text-faint)' }}>
                          {pct1(share * 100)}
                        </span>
                        <span
                          className="numeric w-[5.5rem] shrink-0 text-right text-[length:var(--text-small)]"
                          style={{ color: 'var(--text)' }}
                        >
                          {fmtInt(v)}
                        </span>
                      </>
                    )}
                  </>
                );

                return (
                  <li key={r.key}>
                    {isItemSource(key) ? (
                      <button
                        type="button"
                        aria-pressed={on}
                        data-open={on}
                        onClick={() => {
                          setCat(on ? null : key);
                          // The board is above this legend, so a filter applied
                          // from here would otherwise change something the reader
                          // cannot see.
                          boardRef.current?.scrollIntoView({ block: 'nearest' });
                        }}
                        className="rf-row mo-focusable flex w-full items-center gap-3 px-1.5 py-1.5 text-left"
                        style={{ '--rf-row-accent': r.color } as CSSProperties}
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="flex items-center gap-3 px-1.5 py-1.5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Disclosure>

      <footer className="mo-arrive mt-auto flex items-center gap-3 pt-2">
        <span aria-hidden className="h-px flex-1" style={{ background: 'linear-gradient(90deg, transparent, var(--hairline))' }} />
        {/*
         * One population, nested, largest first.
         *
         * `db.items` deliberately holds EVERY catalog row — 882 — because the
         * mastery engine has to be able to look up any owned item, masterable or
         * not, to read its XP. Only 803 of those pay mastery, and three of that
         * 803 are Founder exclusives no account can obtain. Stated as "882, of
         * which 803, of which 3" so each figure names what it counts; the board
         * above says "803 masterable" from the same map. The collection panel
         * prints 800 with its own "3 Founder-only excluded" caption — that is
         * 803 minus 3, labelled, not a fourth count.
         */}
        <span className="eyebrow">
          {fmtInt(db.items.size)} items in the catalog · {fmtInt(counts.masterable)} masterable
          {counts.founder > 0 && ` · ${fmtInt(counts.founder)} of those Founder-only`}
        </span>
      </footer>
    </div>
  );
}
