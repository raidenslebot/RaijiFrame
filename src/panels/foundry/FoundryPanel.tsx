/**
 * FOUNDRY — what the orbiter is building, what is waiting to be collected, and
 * what could be started next.
 *
 * Three things about the payload shape the whole panel:
 *
 *  1. There is no "ready" flag. A job is ready when `CompletionDate <= now`
 *     (schema §7), so this panel needs a live clock, not just the inventory.
 *     The clock is a module-level external store read through
 *     `useSyncExternalStore`: render stays pure, one interval serves every
 *     countdown on screen, and the interval only exists while a panel is
 *     mounted.
 *
 *  2. There is no build DURATION. Only the completion instant is stored, so a
 *     "62% complete" bar would be an invention. The bars here measure remaining
 *     time against the longest wait in the queue — a race, not a progress bar —
 *     and the section header says so.
 *
 *  3. There are no display names. Everything is a `/Lotus/...` path, and the
 *     item catalog indexes *products*, not recipes, so it cannot resolve
 *     `…/BurstonPrimeBlueprint`. Names are derived from the path and the panel
 *     admits it in the footer rather than pretending they came from DE.
 *
 * WHY THIS PANEL STILL HAS AN EMPTY STATE
 * ───────────────────────────────────────
 * Nine sibling panels were rewritten to render their game-data half before an
 * account exists — the resource catalog, the masterable item list, the star
 * chart, the daily reset clocks. WHAT IS BUILDING and WHICH BLUEPRINTS YOU HOLD
 * are both pure account state, and there is no game-data substitute for either:
 * no catalog can say what YOUR foundry is cooking. The honest move is to say
 * exactly which fields are missing and what each one is for, which is what
 * `Waiting` below does — not to pad the panel with a list invented to fill it.
 *
 * CORRECTION, AND WHY IT IS RECORDED HERE
 * ───────────────────────────────────────
 * This note used to go further and claim the catalog itself had nothing to
 * offer: "`ItemDbEntry` carries name, category, mastery requirement and art, but
 * no recipe, no ingredient list and no build time". That was true of
 * `ItemDbEntry` and false about the data. WFCD sends `buildTime`, `buildPrice`,
 * `skipBuildTimePrice` and `components` for every buildable item; `parseWfcd`
 * was discarding them to keep the cached catalog small, and the limitation got
 * written up as a fact about the world rather than a consequence of our own
 * projection. Those fields are carried now, and every item detail in the app
 * shows the recipe.
 *
 * The lesson worth keeping: "the data does not have it" needs checking against
 * the source, not against our own model of the source.
 *
 * Ready jobs are dense rows with a green leading edge because
 * they are the only actionable thing on this screen. Everything else stays
 * quiet so that lands.
 */

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useAccount } from '../../core/store';
import { ARGON_ITEM_TYPE, mongoMillis, resourceCount, type RawAccount } from '../../data/account';
import { loadItemDb, type ItemDb } from '../../data/itemdb';
import { checkBuildable, indexByComponent, sortBuildables, tally, type Buildable, type BuildVerdict } from '../../data/buildable';
import { queueOf, type PooledNeed } from '../../data/build-queue';
import type { Need } from '../../data/plat-picks';
import { foundryState, inventoryTotals } from '../../data/subsystems';
import { DataTable, EmptyState, Ornament, type Column } from '../../ui/orokin';
import { GoLink } from '../../ui/interact';
import { ItemDetail } from '../../ui/ItemDetail';
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { CHAMFER, PLATE_LIFT as PLATE } from '../../ui/geometry';

/* ---------------------------------------------------------------- the clock */

/**
 * One second-resolution clock for the whole window.
 *
 * A countdown per row would mean a timer per row; this is a single external
 * store instead. `getSnapshot` returns a cached number so React can compare it,
 * and the interval is created on the first subscriber and destroyed with the
 * last, so an unmounted panel costs nothing.
 */
let tick = Date.now();
const watchers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
/**
 * Whether `tick` has gone cold.
 *
 * THE RE-SEED HAD TO MOVE, AND THE REASON IS A REAL DEFECT.
 *
 * It used to happen in `subscribeClock`, with a comment saying a stale first
 * frame would show a stale countdown. React subscribes AFTER the first render,
 * so the re-seed happened one render too late: render one read a `tick` frozen
 * at the moment the last foundry panel unmounted, which on a panel a player
 * opens and closes all evening is minutes in the past.
 *
 * That was invisible while the only consumer was a countdown - React re-renders
 * as soon as the snapshot changes, so nobody saw the stale frame. It stopped
 * being invisible when the sections became disclosures: `defaultOpen` is read
 * ONCE, by `useState`, on that first render. A job that finished ninety seconds
 * ago read as still building against a three-minute-old clock, "Ready to claim"
 * looked empty, and the wrong section opened itself - permanently, because
 * nothing re-reads a default.
 *
 * Re-seeding in the snapshot fixes it at the source. It is guarded rather than
 * unconditional because `getSnapshot` must return the SAME value every time it
 * is called within a render: `Date.now()` on each call is the documented way to
 * make React loop forever. One re-seed per cold start, then the interval owns
 * the value again.
 */
let cold = true;

function subscribeClock(onChange: () => void): () => void {
  watchers.add(onChange);
  if (timer === null) {
    tick = Date.now();
    cold = false;
    timer = setInterval(() => {
      tick = Date.now();
      for (const w of watchers) w();
    }, 1_000);
  }
  return () => {
    watchers.delete(onChange);
    if (watchers.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      // Nothing is ticking now, so the next reader gets a fresh seed.
      cold = true;
    }
  };
}

const clockSnapshot = (): number => {
  if (cold) {
    tick = Date.now();
    cold = false;
  }
  return tick;
};

function useNow(): number {
  return useSyncExternalStore(subscribeClock, clockSnapshot, clockSnapshot);
}

/* -------------------------------------------------------------- the catalog */

/** Shared across every mount of the panel: the fetch and parse happen once. */
let dbOnce: Promise<ItemDb> | null = null;

/**
 * Null while the catalog is in flight. Read for two things only: the item card
 * a blueprint row opens onto, and whether a ready job's name is a catalog item
 * at all — a name the catalog cannot place is not offered as a link.
 */
function useItemDb(): ItemDb | null {
  const [db, setDb] = useState<ItemDb | null>(null);
  useEffect(() => {
    let alive = true;
    dbOnce ??= loadItemDb();
    void dbOnce.then(
      (d) => {
        if (alive) setDb(d);
      },
      // A failed catalog is a thinner panel, not a broken one: rows keep their
      // derived names and simply do not open onto a card.
      (err: unknown) => {
        console.warn('[foundry] item catalog unavailable', err);
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return db;
}

/* --------------------------------------------------------------- formatting */

const int = (n: number): string => Math.round(n).toLocaleString();

const pad = (n: number): string => String(n).padStart(2, '0');

/** Coarse at the top, precise at the bottom — seconds only matter near zero. */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3_600);
  const min = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${pad(h)}h ${pad(min)}m`;
  if (h > 0) return `${h}h ${pad(min)}m ${pad(s)}s`;
  return `${min}m ${pad(s)}s`;
}

/** Wall-clock completion, with the date only when it is not today. */
function formatWhen(readyAtMs: number, now: number): string {
  const at = new Date(readyAtMs);
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (at.toDateString() === new Date(now).toDateString()) return time;
  return `${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

/** `SomeItemName` -> `Some Item Name`. Also splits `Mk1` style runs of digits. */
function humanise(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

/**
 * Recipe paths are shaped `/Lotus/Types/Recipes/<group>/<Thing>Blueprint`.
 * The group is real data straight from the path, so it is worth surfacing; the
 * name is a best-effort de-camel of the leaf.
 */
const KIND_ALIASES: Readonly<Record<string, string>> = {
  Weapons: 'Weapon',
  Warframes: 'Warframe',
  // The folder the game actually files frame blueprints under
  // (`.../Recipes/WarframeRecipes/MagPrimeBlueprint`, item-catalog.md).
  WarframeRecipes: 'Warframe',
  Components: 'Component',
  Items: 'Item',
  WeaponParts: 'Weapon Part',
  EnemyItemBlueprints: 'Enemy Drop',
  AiSpecs: 'Companion',
  Gameplay: 'Gameplay',
  Recipes: 'Blueprint',
};

interface Named {
  name: string;
  kind: string;
}

function describe(itemType: string): Named {
  const parts = itemType.split('/').filter(Boolean);
  const leaf = parts[parts.length - 1] ?? itemType;
  const recipeAt = parts.indexOf('Recipes');
  const group = recipeAt >= 0 ? parts[recipeAt + 1] : undefined;

  // The trailing "Blueprint" is noise once the whole panel is blueprints.
  const bare = leaf.replace(/Blueprint$/, '');
  return {
    name: humanise(bare === '' ? leaf : bare),
    // Any other `<Kind>Recipes` folder reads as its kind, not "Sentinel Recipes".
    kind: group === undefined ? 'Foundry' : (KIND_ALIASES[group] ?? humanise(group.replace(/Recipes$/, ''))),
  };
}

/* -------------------------------------------------------------- derivation */

interface Job extends Named {
  key: string;
  itemType: string;
  /** Null when the payload's date was unreadable — never rendered as ready. */
  readyAtMs: number | null;
  /** Personal research (dojo / Necramech) rather than a foundry recipe. */
  research: boolean;
}

interface BlueprintStack extends Named {
  itemType: string;
  count: number;
}

interface Derived {
  jobs: Job[];
  blueprints: BlueprintStack[];
  /** Research with contributions still outstanding — no completion date yet. */
  researchPending: number;
  credits: number | null;
  argon: number;
  /** Argon found today, exempt from tonight's decay (`FoundToday`). */
  argonSafe: number;
  helminth: { subsumed: number; invigorations: number; xp: number | null } | null;
}

function derive(acc: RawAccount): Derived {
  // Parsed against epoch 0 so nothing is classified as ready here: the ready /
  // building split belongs to the render, which has the live clock. This memo
  // exists to do the expensive part — date parsing and naming — once per
  // inventory push rather than once per second.
  const parsed = foundryState(acc, 0);

  const jobs: Job[] = parsed.building.map((j, i) => ({
    key: j.id ?? `${j.itemType}#${i}`,
    itemType: j.itemType,
    readyAtMs: j.readyAtMs,
    research: false,
    ...describe(j.itemType),
  }));

  // Personal research shares the Foundry screen in game and the same shape here,
  // so it shares the queue. Projects with no completion date are still gathering
  // contributions and are counted separately rather than shown as building.
  let researchPending = 0;
  for (const [i, p] of (acc.PersonalTechProjects ?? []).entries()) {
    const itemType = p?.ItemType;
    if (typeof itemType !== 'string') continue;
    const readyAtMs = mongoMillis(p.CompletionDate);
    if (readyAtMs === null) {
      researchPending++;
      continue;
    }
    jobs.push({
      key: p.ItemId?.$oid ?? p.ItemId?.$id ?? `research#${i}`,
      itemType,
      readyAtMs,
      research: true,
      ...describe(itemType),
    });
  }
  jobs.sort((a, b) => (a.readyAtMs ?? Infinity) - (b.readyAtMs ?? Infinity));

  // `Recipes` is already exactly "owned but not started" — starting a build
  // moves the blueprint into `PendingRecipes` — so no filtering is needed.
  const stacks = new Map<string, BlueprintStack>();
  for (const row of acc.Recipes ?? []) {
    const itemType = row?.ItemType;
    if (typeof itemType !== 'string') continue;
    const count = typeof row.ItemCount === 'number' ? row.ItemCount : 0;
    const seen = stacks.get(itemType);
    // DE has been seen to split stacks, so duplicates are summed, not replaced.
    if (seen) seen.count += count;
    else stacks.set(itemType, { itemType, count, ...describe(itemType) });
  }

  let argonSafe = 0;
  for (const row of acc.FoundToday ?? []) {
    if (row?.ItemType === ARGON_ITEM_TYPE && typeof row.ItemCount === 'number') argonSafe += row.ItemCount;
  }

  const helm = acc.InfestedFoundry;
  const xp = helm?.XP;

  return {
    jobs,
    blueprints: [...stacks.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    researchPending,
    credits: inventoryTotals(acc).credits,
    argon: resourceCount(acc, ARGON_ITEM_TYPE),
    argonSafe,
    helminth:
      helm === undefined
        ? null
        : {
            subsumed: helm.ConsumedSuits?.length ?? 0,
            invigorations: helm.InvigorationsApplied ?? 0,
            // No rank table here, so raw XP is shown rather than a fabricated rank.
            xp: typeof xp === 'number' ? xp : null,
          },
  };
}

/* ------------------------------------------------------------------- pieces */

/**
 * Bar length for a queued job.
 *
 * Build times span three orders of magnitude — a 40-second Forma sits in the
 * same queue as a three-day Prime — so a linear share of the longest wait draws
 * every short job as an invisible sliver. Compressing the range logarithmically
 * against a one-minute floor keeps the ordering honest and every row readable.
 * `remaining = 0` still lands on empty, `remaining = horizon` still lands on full.
 */
const BAR_FLOOR_MS = 60_000;

function barShare(remainingMs: number, horizonMs: number): number {
  const lo = Math.log(BAR_FLOOR_MS);
  const hi = Math.log(horizonMs + BAR_FLOOR_MS);
  if (hi <= lo) return 0;
  return Math.max(0, Math.min(1, (Math.log(remainingMs + BAR_FLOOR_MS) - lo) / (hi - lo)));
}


/**
 * Urgency by colour, and the colours mean what they mean everywhere else in the
 * app: green for effectively done, amber for landing inside the hour, cyan for a
 * job that is simply running. The row worth looking at is the one that changed.
 */
function urgency(remainingMs: number): string {
  if (remainingMs < 60_000) return 'var(--color-signal-good)';
  if (remainingMs < 3_600_000) return 'var(--color-signal-warn)';
  return 'var(--color-tenno-400)';
}

/* ------------------------------------------------------------------- pieces */

/**
 * A SECTION, AS A DISCLOSURE.
 *
 * WHAT WAS WRONG
 * ──────────────
 * Every section here was a heading over a permanently expanded list, and there
 * were five of them stacked in one scroller: ready, building, Helminth, two
 * hundred blueprints, and a footer of provenance. A player opening the panel to
 * ask "is anything waiting for me" scrolled past all of it, every time, because
 * nothing on the screen could ever be put away.
 *
 * The heading loses nothing by folding. Its count and its note were the only
 * things it carried, and both survive on the closed row - the note as the
 * eyebrow, the count as the ANSWER. A section that says nothing when closed is
 * a section nobody opens, which is why `answer` is not optional in practice
 * even though the component allows it.
 *
 * `mo-arrive` is scroll-driven, so it takes its progress from position rather
 * than from the clock. That matters here specifically: this panel is often
 * opened while the window is unpresented and the document timeline is stopped,
 * and a time-based section entrance would leave every section parked at its
 * first frame.
 */
function Fold({
  title,
  eyebrow,
  answer,
  accent,
  depth = 0,
  defaultOpen = false,
  children,
}: {
  title: string;
  eyebrow?: string;
  answer?: ReactNode;
  accent?: string;
  depth?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="mo-arrive">
      <Disclosure
        depth={depth}
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
 * The single bold element on the screen.
 *
 * The foundry asks exactly one question — is anything waiting for me right now —
 * so that is the only thing set large. When nothing is claimable the same slot
 * carries the next completion instead, because that is the next moment the
 * answer changes. Everything below stays small and low-chroma.
 */
function Hero({
  readyCount,
  nextName,
  nextIn,
}: {
  readyCount: number;
  nextName: string | null;
  nextIn: number | null;
}) {
  const claimable = readyCount > 0;
  const ink = claimable ? 'var(--color-signal-good)' : 'var(--color-orokin-200)';

  // Only said when the headline has not already said it. The non-claimable
  // case used to print the next job's bare name here — the top row of the
  // queue, repeated 200px above it, both ticking in step.
  const them = readyCount === 1 ? 'it' : 'them';
  const detail = claimable
    ? nextName === null
      ? `Collect ${them} in the orbiter. Nothing else is queued behind ${them}.`
      : `Collect ${them} in the orbiter. ${nextName} lands next.`
    : nextIn === null
      ? 'The queue is empty. Anything you start appears here with its countdown.'
      : null;
  const edge = claimable
    ? 'linear-gradient(150deg, var(--color-signal-good), oklch(0.76 0.16 152 / 0.18) 42%, transparent 78%)'
    : 'var(--plate-gold-rim)';

  return (
    /*
     * The hero takes the pointer, and it takes it in two parts.
     *
     * `mo-field` on the OUTER plate is what puts this element on the document
     * tracker's list, so the signed offsets and the percentages are written
     * once, here, and inherit down. `mo-tilt` reads those offsets and turns the
     * whole plate a few degrees toward the cursor; the sheen has to sit on the
     * INNER surface instead, because the outer is a one-pixel gradient border
     * and a light drawn behind the inner fill would never be seen.
     *
     * `mo-in-settle` is transform-only - eighteen pixels and six tenths of a
     * degree - so a frozen timeline leaves the panel's one large number slightly
     * low and slightly askew rather than absent.
     */
    <section
      className="mo-field mo-tilt mo-in-settle relative isolate"
      style={{ clipPath: CHAMFER, padding: 1, background: edge }}
    >
      <div
        className="mo-sheen relative px-7 py-6"
        style={{
          clipPath: CHAMFER,
          background: claimable
            ? 'radial-gradient(120% 150% at 0% 0%, oklch(0.76 0.16 152 / 0.12), transparent 58%), linear-gradient(168deg, oklch(0.16 0.028 168 / 0.97), oklch(0.105 0.02 200 / 0.98))'
            : 'var(--plate-gold-fill)',
        }}
      >
        <div className="flex items-center gap-2.5">
          {/* The mark leans with the plate. It rides `--mdx` directly rather
              than wearing `mo-magnet`, because the two would both write
              `transform` and the later rule would simply delete the rotation
              that makes this a diamond rather than a square. */}
          <span
            aria-hidden
            className="rf-hero-mark size-[5px]"
            style={{ background: ink }}
          />
          <span className="eyebrow" style={{ color: ink }}>
            Orbiter foundry
          </span>
          <span className="eyebrow ml-auto">{claimable ? 'waiting for you' : 'next completion'}</span>
        </div>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="stat text-[length:var(--text-hero)] leading-none" style={{ color: ink }}>
            {claimable ? int(readyCount) : nextIn === null ? '—' : formatRemaining(nextIn)}
          </span>
          <span
            className="font-[family-name:var(--font-display)] text-[length:var(--text-lead)]"
            style={{ color: 'var(--text)' }}
          >
            {claimable
              ? `item${readyCount === 1 ? '' : 's'} ready to claim`
              : nextIn === null
                ? 'nothing under construction'
                : nextName === null
                  ? 'until the next build finishes'
                  : `until ${nextName} finishes`}
          </span>
        </div>

        {detail !== null && (
          <div
            className="mt-2.5 max-w-[64ch] text-[length:var(--text-small)] leading-relaxed"
            style={{ color: 'var(--text-muted)' }}
          >
            {/* Two lines, then a press. This sentence is the only prose on the
                hero and it still ran to three lines at the overlay's docked
                width, which pushed the queue below the fold on the one screen
                whose whole job is to be read at a glance. */}
            <Clamp lines={2}>{detail}</Clamp>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * THE THREE RULES THAT CANNOT BE WRITTEN AS UTILITIES.
 *
 * All three drive a CHILD from a PARENT's pointer state, and Tailwind cannot
 * express that here. `group-hover:[--mo-on:1]` compiles into `@layer utilities`
 * while motion.css is unlayered, and an unlayered declaration beats a layered
 * one at any specificity - so the variant loses to `.mo-underline`'s own
 * `--mo-on: 0` and the effect renders, tracks the pointer, and stays invisible.
 * Plain rules in document order win instead.
 *
 * They also have to be here rather than in motion.css: that file is owned
 * elsewhere, and these are this panel's own shapes.
 */
function MotionRules() {
  return (
    <style>{`
      /*
        A SECTION HEADING UNDERLINES FROM THE WHOLE ROW, NOT FROM THE WORD.

        mo-underline reads --mo-on off the element it sits on, so an underline
        placed on the heading only drew while the pointer was over the eleven
        characters of the title - and the target a reader actually aims at is
        the summary row, which is forty times wider. Handing the row's own
        hover down to the label is the whole fix.

        The underline sits on an inner span and not on the summary button for a
        reason that cost an afternoon elsewhere in this app: the button is
        chamfered with clip-path, mo-underline draws its rule at bottom: -2px,
        which is OUTSIDE the border box, and a clip deletes it. On the label,
        two pixels below the text, it is well inside the clip.
      */
      .rf-disc-summary:hover .rf-fold-ink,
      .rf-disc-summary:focus-visible .rf-fold-ink {
        --mo-on: 1;
      }

      /*
        The hero's mark leans with the plate.

        It cannot wear mo-magnet: that rule writes transform, this element's
        rotation IS a transform, and the later rule would silently delete the
        45 degrees that make the square a diamond. Reading the same signed
        offset by hand keeps both.
      */
      .rf-hero-mark {
        transform: rotate(45deg) translate3d(calc(var(--mdx, 0) * 2px), calc(var(--mdy, 0) * 2px), 0);
        transition: transform var(--mo-base) var(--mo-out);
      }

      /*
        A row's leading edge brightens under the pointer. State, not motion:
        the width is fixed and only the colour eases, so a stranded transition
        can only hold the quieter of two visible colours.
      */
      .rf-edge {
        opacity: calc(0.55 + var(--mo-on, 0) * 0.45);
        transition: opacity var(--mo-base) var(--mo-out);
      }

      @media (prefers-reduced-motion: reduce) {
        .rf-hero-mark {
          transform: rotate(45deg);
          transition: none;
        }
        .rf-edge {
          transition: none;
        }
      }
    `}</style>
  );
}

/**
 * A quiet readout. Small on purpose — the hero carries the weight.
 *
 * `--i` rather than an inline `animationDelay`: the stagger belongs to the
 * PARENT (`mo-stagger`), which caps it at twelve steps, and an inline delay
 * would override the cap and win.
 */
function Readout({ label, value, sub, index }: { label: string; value: string; sub: string; index: number }) {
  return (
    <div
      className="rf-plate mo-field mo-sheen mo-lift mo-in-up px-4 py-3"
      style={{ clipPath: CHAMFER, background: PLATE, '--i': index } as React.CSSProperties}
    >
      <div className="eyebrow">{label}</div>
      <div className="numeric mt-1.5 text-[length:var(--text-lead)] leading-none" style={{ color: 'var(--text)' }}>
        {value}
      </div>
      <div className="mt-1.5 text-[length:var(--text-nano)] leading-snug" style={{ color: 'var(--text-muted)' }}>
        {sub}
      </div>
    </div>
  );
}

/**
 * Ready to claim: a dense row, not a card with a glow in it.
 *
 * The previous version gave each item a 124px block whose lower half was
 * deliberately empty "because it is the light". Fourteen of those is a wall of
 * identical lens flares with the names truncated mid-word — maximum space for
 * minimum information. Claimable items are a LIST: you scan them, you go claim
 * them. The count is already large in the hero.
 */
function ReadyRow({ job, index, linked }: { job: Job; index: number; linked: boolean }) {
  return (
    <li
      className="rf-plate mo-field mo-sheen mo-lift mo-in-up relative flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 pr-4 pl-4"
      style={{ clipPath: CHAMFER, background: PLATE, '--i': index } as React.CSSProperties}
    >
      <span
        aria-hidden
        className="rf-edge absolute top-0 bottom-0 left-0 w-[2px]"
        style={{ background: 'var(--color-signal-good)' }}
      />
      <span className="eyebrow shrink-0" style={{ minWidth: '5.5rem' }}>
        {job.kind}
      </span>
      {/* No truncation: a name with room to wrap gets to wrap. The NAME is the
          destination, not the row: a ready item is the moment you want to know
          what the thing is, and the row has nothing else to disclose. */}
      <span
        className="min-w-0 flex-1 font-[family-name:var(--font-display)] text-[length:var(--text-body)] font-semibold"
        style={{ color: 'var(--text)' }}
      >
        {linked ? (
          <GoLink kind="item" id={job.name} title={`Find ${job.name} in the collection`}>
            {job.name}
          </GoLink>
        ) : (
          job.name
        )}
      </span>
      <span className="eyebrow shrink-0" style={{ color: 'var(--color-signal-good)' }}>
        Ready
      </span>
    </li>
  );
}

function BuildRow({
  job,
  now,
  horizon,
  index,
  linked = false,
}: {
  job: Job;
  now: number;
  /** Longest wait in the queue. Null with one job: a bar measured against itself is always full. */
  horizon: number | null;
  index: number;
  /** The catalog can place this name, so it is somewhere you can go. */
  linked?: boolean;
}) {
  const remaining = job.readyAtMs === null ? null : Math.max(0, job.readyAtMs - now);
  const color = remaining === null ? 'var(--text-faint)' : urgency(remaining);

  return (
    <li
      className="rf-plate mo-field mo-sheen mo-lift mo-in-up relative flex items-center gap-4 py-2.5 pr-4 pl-4"
      style={{ clipPath: CHAMFER, background: PLATE, '--i': index } as React.CSSProperties}
    >
      {/* The edge brightens under the pointer instead of sitting at a fixed
          0.8. It is the row's urgency colour, so lighting it is the cheapest
          way to say WHICH row the cursor is on without moving any text. */}
      <span aria-hidden className="rf-edge absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: color }} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span
            className="font-[family-name:var(--font-display)] text-[length:var(--text-small)] font-semibold"
            style={{ color: 'var(--text)' }}
          >
            {linked ? (
              <GoLink kind="item" id={job.name} title={`Find ${job.name} in the collection`}>
                {job.name}
              </GoLink>
            ) : (
              job.name
            )}
          </span>
          <span className="eyebrow shrink-0">{job.kind}</span>
          {job.research && (
            <span className="eyebrow shrink-0" style={{ color: 'var(--color-signal-rare)' }}>
              Research
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
          {job.readyAtMs === null ? 'completion time unreadable' : `completes ${formatWhen(job.readyAtMs, now)}`}
        </div>
      </div>

      {/* Time still outstanding against the longest wait in the queue — not
          percent complete, because the payload carries no build duration. Width
          rather than a transform tween: this repaints once a second, and a tween
          would never settle between ticks. */}
      <div className="flex w-[172px] shrink-0 flex-col items-end gap-1.5">
        <span className="numeric text-[length:var(--text-micro)] leading-none" style={{ color }}>
          {remaining === null ? '—' : formatRemaining(remaining)}
        </span>
        {horizon !== null && (
          <span aria-hidden className="block h-[3px] w-full overflow-hidden" style={{ background: 'oklch(1 0 0 / 0.07)' }}>
            <span
              className="block h-full"
              style={{
                width: `${Math.max(2, (remaining === null ? 0 : barShare(remaining, horizon)) * 100)}%`,
                background: color,
              }}
            />
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * Everything this panel shows, and what each part is for.
 *
 * All of it is account state. The list is spelled out rather than summarised as
 * "your inventory" because a person looking at an empty panel deserves to know
 * precisely what is absent — and because writing it out is what makes it
 * checkable that none of it can be substituted with game data. In the player's
 * words: this used to print the payload's field names, which are our variable
 * names and not anything the game calls them.
 */
const REQUIRED_FIELDS: ReadonlyArray<readonly [what: string, need: string]> = [
  ['Jobs in the foundry', 'when each one finishes'],
  ['Dojo and Necramech research', 'it shares the same queue'],
  ['Blueprints you hold', 'the ones you have not started'],
  ['Credits', 'what you can afford to start'],
  ['Argon Crystals', 'your stock, and how much survives tonight’s decay'],
  ['Helminth', 'frames subsumed, invigorations applied, XP'],
];

/**
 * The account is not here yet, and unlike the sibling panels there is nothing
 * else to draw. Say which of the three reasons it is, name what is missing, and
 * say why none of it has a game-data substitute.
 */
function Waiting() {
  const running = useAccount((s) => s.gameRunning);
  const gep = useAccount((s) => s.gep);

  /*
   * THE HEADLINE, THE ONE-LINE REASON, AND EVERYTHING ELSE.
   *
   * This was a single paragraph of up to 158 characters sitting directly under
   * the title, over a six-row list, over a footnote - the longest unbroken
   * block of prose in the app, on the screen a first-time player meets FIRST.
   * None of it was wrong and none of it is deleted. It is cut at the seam it
   * always had: the reason a person needs in order to ACT is one line, and
   * what happens next is one press below it.
   */
  const [title, reason, next] = !running
    ? ([
        'Your foundry has not been read yet',
        'The game is not running, and nothing has been read from it yet.',
        'Run Warframe once and every build, timer and blueprint is read out of the running game and kept — after which this panel keeps working with the game closed.',
      ] as const)
    : gep === 'connected'
      ? ([
          'Waiting for your account',
          'Linked to the game, which has not pushed your account yet.',
          'Your foundry is read the next time the game pushes an update — RaijiFrame waits for it rather than asking.',
        ] as const)
      : ([
          'Linking to the game',
          'Establishing the game-events connection.',
          'This usually takes a few seconds after launch.',
        ] as const);

  return (
    /*
     * Its own scroller, and centred with auto margins rather than
     * `place-items-center`.
     *
     * At the overlay's minimum height this plate is taller than the panel, and a
     * centred grid item overflows equally in both directions — the top half then
     * sits above the scroll origin where nothing can reach it. Flex auto margins
     * collapse to zero as soon as the free space runs out, so the plate stays
     * centred when it fits and scrolls from its top edge when it does not.
     */
    <div className="flex h-full min-h-0 justify-center overflow-y-auto p-6">
      <MotionRules />
      {/*
        THE NESTED SECTIONS ARE SIBLINGS OF THE PLATE, NOT ITS `action` SLOT,
        AND THAT IS NOT A LAYOUT PREFERENCE.

        They were inside it, and the result on screen was a column fourteen
        pixels wide with one letter per line - the whole empty state, the
        highest-stakes copy in the app, rendered as a vertical alphabet.

        `EmptyState` centres its children, so its action slot takes its width
        shrink-to-fit from its contents. `Disclosure` is `container-type:
        inline-size`, whose entire purpose is to make an element's inline size
        independent of its contents - so its max-content contribution is ZERO.
        A box sized by its contents, holding a box that refuses to contribute
        any, collapses to the width of the chevron.

        Nothing about it is visible in the source and nothing warns: a legal
        container query meeting a legal shrink-to-fit box, and TypeScript,
        ESLint and every gate in `scripts/` pass. It was found by looking at
        the rendered page, which is the argument for looking at it.

        As stretched children of this column the disclosures have a definite
        width, and the containment does the job it is actually for: a
        disclosure three levels down lays its summary out by ITS width rather
        than the window's.
      */}
      <div className="my-auto flex w-full max-w-[62ch] flex-col gap-1.5">
        <EmptyState title={title} detail={reason} />
        <div className="flex w-full flex-col gap-1.5 text-left">
            {/*
              The field list is the subject of THIS screen, so it is the one
              section that opens itself. Closed, it would still say how many
              fields are missing - which is the rule the whole panel is built
              on: a row that says nothing when shut is a row nobody opens.
            */}
            <Disclosure
              defaultOpen
              accent="var(--color-orokin-300)"
              eyebrow="all of it is account state"
              summary={
                <span className="rf-fold-ink mo-underline">What this panel is waiting for</span>
              }
              answer={<span className="numeric">{REQUIRED_FIELDS.length} fields</span>}
            >
              <ul className="mo-stagger flex flex-col gap-[3px]">
                {REQUIRED_FIELDS.map(([what, need], i) => (
                  <li
                    key={what}
                    /*
                     * CSS, not Motion: a rAF entrance strands rows invisible
                     * when the overlay mounts while hidden. `mo-in-left` is
                     * transform-only for the same reason, and the stagger is
                     * the parent's `--i` rather than an inline delay, so the
                     * twelve-step cap in motion.css still applies.
                     */
                    className="rf-plate mo-field mo-sheen mo-lift mo-in-left relative flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 pr-3 pl-3.5"
                    style={{ clipPath: CHAMFER, background: PLATE, '--i': i } as React.CSSProperties}
                  >
                    <span
                      aria-hidden
                      className="rf-edge absolute top-0 bottom-0 left-0 w-[2px]"
                      style={{ background: 'var(--color-orokin-500)' }}
                    />
                    <span
                      className="shrink-0 text-[length:var(--text-micro)] leading-snug"
                      style={{ color: 'var(--color-orokin-300)', minWidth: '13rem' }}
                    >
                      {what}
                    </span>
                    <span
                      className="min-w-0 flex-1 text-[length:var(--text-micro)] leading-snug"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {need}
                    </span>
                  </li>
                ))}
              </ul>
            </Disclosure>

            {/*
              Depth 1, so the indent rail says this is a footnote to the list
              above rather than a second heading of equal weight. It carries
              what used to be the long paragraph under the title, plus the one
              line about where build times DO come from - both of which a
              reader who already knows the answer never has to scroll past.
            */}
            <Disclosure
              depth={1}
              eyebrow="and then"
              summary={<span className="rf-fold-ink mo-underline">What happens next</span>}
              answer={
                <span style={{ color: 'var(--text-faint)' }}>{running ? 'waiting on the game' : 'run the game once'}</span>
              }
            >
              <div className="text-[length:var(--text-micro)] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                <Clamp lines={3}>{next}</Clamp>
              </div>
              <p className="wf-note mt-2">
                Build times, costs and components are game data — open any item in Collection.
              </p>
            </Disclosure>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ requirements */

/**
 * One ingredient, and whether you have it.
 *
 * THE THREE STATES ARE THE WHOLE POINT.
 *
 * A requirement is met, short, or UNREADABLE, and the third is not a polite
 * way of saying zero. An account that has never been read holds an unknown
 * amount of everything, and a catalog row with no item path cannot be looked
 * up at all. Rendering either as "0 of 4" would be inventing the one number
 * this panel exists to stop guessing at.
 */
function Requirement({ need: n }: { need: Need }) {
  const ink =
    n.met === true
      ? 'var(--color-signal-good)'
      : n.met === false
        ? 'var(--color-signal-warn)'
        : 'var(--text-ghost)';
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-0.5">
      <span className="shrink-0 text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
        {n.what}
      </span>
      <span className="numeric ml-auto shrink-0 text-[length:var(--text-nano)]" style={{ color: ink }}>
        {n.have === null
          ? n.need === null
            ? '\u2014'
            : `\u2014 of ${n.need.toLocaleString()}`
          : `${n.have.toLocaleString()} of ${(n.need ?? 0).toLocaleString()}`}
      </span>
      {n.met === false && n.need !== null && n.have !== null && (
        <span className="shrink-0 text-[length:var(--text-nano)]" style={{ color: 'var(--color-signal-warn)' }}>
          short {(n.need - n.have).toLocaleString()}
        </span>
      )}
      {n.met === null && n.unknown !== undefined && (
        <span className="w-full text-[length:var(--text-nano)]" style={{ color: 'var(--text-ghost)' }}>
          {n.unknown}
        </span>
      )}
    </div>
  );
}

/**
 * WHERE TO GET THE ONE YOU ARE SHORT OF.
 * ————————————————————————————————————————————
 * The requirement row said "Chassis - 0 of 1 - short 1" and stopped, which is
 * the exact shape of answer that invites "so where do I get one" and has
 * nowhere to send it. The catalog carries a source and a drop chance on the
 * same component object the ingredient list is read from, and it was being
 * discarded in the parse.
 *
 * Shown only on rows that are actually SHORT. A part you already hold does not
 * need directions, and putting them on every row would bury the two that matter
 * under six that do not.
 */
function WhereFrom({ from }: { from: { at: string; pct: number; n: number } }) {
  return (
    <span className="w-full text-[length:var(--text-nano)]" style={{ color: 'var(--text-faint)' }}>
      {from.at}
      <span className="numeric" style={{ color: 'var(--color-tenno-300)' }}>
        {` ${from.pct.toFixed(1)}%`}
      </span>
      {from.n > 1 && (
        <span style={{ color: 'var(--text-ghost)' }}>
          {` \u2014 best of ${String(from.n)} places`}
        </span>
      )}
    </span>
  );
}

/** Everything one blueprint asks for, in the order the catalog lists it. */
function Requirements({ build }: { build: Buildable }) {
  if (build.verdict === 'unplaced') {
    return (
      <span className="eyebrow" style={{ color: 'var(--text-ghost)' }}>
        the catalog indexes no product under this recipe path, so its ingredients cannot be looked up
      </span>
    );
  }
  if (build.needs.length === 0) {
    return (
      <span className="eyebrow" style={{ color: 'var(--text-ghost)' }}>
        the catalog places this item but carries no ingredient list for it
      </span>
    );
  }
  return (
    <div className="flex min-w-0 flex-col">
      {build.needs.map((n) => {
        // Matched by NAME here because that is the key `needs` carries; the
        // parts list beside it is keyed by path. Within one recipe the names
        // are unique, which is the only place that join is safe.
        const part = build.parts.find((x) => x.name === n.what);
        return (
          <div key={n.what} className="flex min-w-0 flex-col">
            <Requirement need={n} />
            {n.met === false && part?.from !== undefined && <WhereFrom from={part.from} />}
          </div>
        );
      })}
    </div>
  );
}

const VERDICT_INK: Record<BuildVerdict, string> = {
  ready: 'var(--color-signal-good)',
  short: 'var(--color-signal-warn)',
  unverifiable: 'var(--text-ghost)',
  'no-recipe': 'var(--text-ghost)',
  unplaced: 'var(--text-ghost)',
};

const VERDICT_WORD: Record<BuildVerdict, string> = {
  ready: 'can start now',
  short: 'short',
  unverifiable: 'cannot be checked',
  'no-recipe': 'no recipe',
  unplaced: 'not in the catalog',
};

/**
 * WHICH BLUEPRINTS ARE SHOWN.
 *
 * A filter, not a sort, because the useful question at a foundry is a
 * yes-or-no one and a list of two hundred blueprints answers it slowly. Every
 * option is reachable and the counts are on the buttons, so narrowing never
 * hides the existence of what it narrowed away.
 */
type Lens = 'all' | 'ready' | 'short' | 'unknown';

const LENS_LABEL: Record<Lens, string> = {
  all: 'Everything held',
  ready: 'Can start now',
  short: 'Short of something',
  unknown: 'Cannot be checked',
};

function keepFor(lens: Lens, b: Buildable): boolean {
  if (lens === 'all') return true;
  if (lens === 'ready') return b.verdict === 'ready';
  if (lens === 'short') return b.verdict === 'short';
  return b.verdict === 'unverifiable' || b.verdict === 'no-recipe' || b.verdict === 'unplaced';
}

const BLUEPRINT_COLUMNS: ReadonlyArray<Column<BlueprintStack>> = [
  {
    key: 'name',
    header: 'Blueprint',
    render: (r) => <span style={{ color: 'var(--text)' }}>{r.name}</span>,
    compare: (a, b) => a.name.localeCompare(b.name),
  },
  {
    key: 'kind',
    header: 'Group',
    width: '9rem',
    render: (r) => <span className="eyebrow">{r.kind}</span>,
    compare: (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  },
  {
    key: 'count',
    header: 'Copies',
    align: 'right',
    width: '6rem',
    render: (r) => (
      <span style={{ color: r.count > 1 ? 'var(--color-orokin-400)' : 'var(--text-muted)' }}>{r.count}</span>
    ),
    compare: (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  },
];

/**
 * The verdict column.
 *
 * Built per render rather than declared at module scope, because it is the one
 * column that needs an answer computed from the account: the rest of the table
 * describes the blueprint, this describes YOU against it. Null while the
 * catalog is still arriving, so the column is absent rather than saying
 * something it does not yet know.
 */
/**
 * The blueprint's name, taken from the product rather than from its path.
 *
 * DE FILES BLUEPRINTS UNDER CODENAMES, AND THIS PANEL WAS SHOWING THEM.
 *
 * `AtlasBlueprint` does not exist: Atlas's recipe is `BrawlerBlueprint`.
 * Baruuk's is `PacifistBlueprint`, Dante's is `PagemasterBlueprint`, Equinox's
 * is `AnimaAnimusBlueprint`. Deriving a name from the path - which is all this
 * panel could do, and which its footer apologised for - therefore produced a
 * name the player has never seen for 410 of the 647 recipes in the catalog.
 *
 * The component join resolves the path to the actual product, so the name is
 * now the real one wherever the path can be placed, and the derived name is
 * kept only where it cannot. The derived name is still shown alongside when
 * the two disagree, because it is what the game's own files say and hiding it
 * would make the row impossible to reconcile with anything else.
 */
function nameColumn(byBlueprint: ReadonlyMap<string, Buildable>): Column<BlueprintStack> {
  const nameOf = (r: BlueprintStack): string => byBlueprint.get(r.itemType)?.product ?? r.name;
  return {
    key: 'name',
    header: 'Blueprint',
    render: (r) => {
      const real = byBlueprint.get(r.itemType)?.product ?? null;
      return (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span style={{ color: 'var(--text)' }}>{real ?? r.name}</span>
          {real !== null && real !== r.name && (
            <span className="eyebrow" style={{ color: 'var(--text-ghost)' }} title="the name the game files this recipe under">
              filed as {r.name}
            </span>
          )}
        </span>
      );
    },
    compare: (a, b) => nameOf(a).localeCompare(nameOf(b)),
  };
}

function verdictColumn(byBlueprint: ReadonlyMap<string, Buildable>): Column<BlueprintStack> {
  const rank = (r: BlueprintStack): number => {
    const b = byBlueprint.get(r.itemType);
    if (b === undefined) return 9;
    return b.verdict === 'ready' ? 0 : b.verdict === 'short' ? 1 : 2;
  };
  return {
    key: 'buildable',
    header: 'Can you build it',
    width: '13rem',
    render: (r) => {
      const b = byBlueprint.get(r.itemType);
      if (b === undefined) return <span className="eyebrow" style={{ color: 'var(--text-ghost)' }}>{'\u2014'}</span>;
      return (
        <span className="eyebrow" style={{ color: VERDICT_INK[b.verdict] }}>
          {VERDICT_WORD[b.verdict]}
          {b.verdict === 'short' && b.shortCount > 0
            ? ` ${String(b.shortCount)} ${b.shortCount === 1 ? 'thing' : 'things'}`
            : ''}
        </span>
      );
    },
    compare: (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
  };
}

/**
 * THE COLUMN THAT MAKES THE PANEL DO ARITHMETIC.
 *
 * Every other control on this screen shows or hides something. This one
 * changes an ANSWER: a blueprint in the queue draws on the same stock as every
 * other blueprint in the queue, so adding one can make a requirement that was
 * satisfied stop being satisfied. Nothing that was already computed is being
 * revealed - the number does not exist until the set does.
 *
 * A real checkbox, not a styled div: it is a multi-select and the platform
 * already has the right control, with the right keyboard behaviour and the
 * right thing to announce.
 */
function queueColumn(
  queued: ReadonlySet<string>,
  toggle: (itemType: string) => void,
  byBlueprint: ReadonlyMap<string, Buildable>,
): Column<BlueprintStack> {
  return {
    key: 'queued',
    header: 'Build together',
    width: '8rem',
    render: (r) => {
      const on = queued.has(r.itemType);
      const name = byBlueprint.get(r.itemType)?.product ?? r.name;
      return (
        <input
          type="checkbox"
          checked={on}
          aria-label={`Add ${name} to the build queue`}
          onChange={() => {
            toggle(r.itemType);
          }}
          /* The row opens on click; a press meant for this control must not
             also toggle the row underneath it. */
          onClick={(e) => {
            e.stopPropagation();
          }}
          className="mo-focusable cursor-pointer"
          style={{ accentColor: 'var(--color-orokin-400)' }}
        />
      );
    },
    compare: (a, b) => Number(queued.has(b.itemType)) - Number(queued.has(a.itemType)),
  };
}

/**
 * One pooled stock, and who is drawing on it.
 *
 * The claim list is the whole reason this is not just another requirement row:
 * "you are short two Orokin Cells" is arithmetic the player can do, and
 * "Ash Prime and Baruuk both want them" is the part they cannot see.
 */
function PooledRow({ need: n, qualify }: { need: PooledNeed; qualify: boolean }) {
  const ink = n.contested
    ? 'var(--color-signal-warn)'
    : n.met === true
      ? 'var(--color-signal-good)'
      : n.met === false
        ? 'var(--color-signal-warn)'
        : 'var(--text-ghost)';
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-0.5">
      <span className="shrink-0 text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
        {n.what}
      </span>
      {/*
        WHOSE CHASSIS.
        ————————————————————————————————————————————
        The pool keys on the item path, so Ash's Chassis and Ash Prime's Chassis
        are correctly kept apart - and both render as the word "Chassis", one
        above the other, each reading "1 of 1". The arithmetic was right and the
        screen looked like a bug.

        Names collide by design here: 187 of the 324 component names in the
        catalog are shared. So where a name appears on more than one row, the
        row that has exactly one claimant says which build it belongs to. Rows
        with several claimants already name them on the contested line.
      */}
      {qualify && n.claims.length === 1 && n.claims[0] !== undefined && (
        <span className="eyebrow shrink-0" style={{ color: 'var(--text-ghost)' }}>
          for {n.claims[0].product}
        </span>
      )}
      {n.claims.length > 1 && (
        <span className="eyebrow shrink-0" style={{ color: 'var(--text-ghost)' }}>
          {n.claims.length} builds want it
        </span>
      )}
      <span className="numeric ml-auto shrink-0 text-[length:var(--text-nano)]" style={{ color: ink }}>
        {n.have === null
          ? `\u2014 of ${(n.need ?? 0).toLocaleString()}`
          : `${n.have.toLocaleString()} of ${(n.need ?? 0).toLocaleString()}`}
      </span>
      {n.contested && (
        <span className="w-full text-[length:var(--text-nano)]" style={{ color: 'var(--color-signal-warn)' }}>
          {'each of these could be built on its own; together they cannot \u2014 '}
          {n.claims.map((c) => c.product).join(' and ')}
        </span>
      )}
      {n.met === null && n.unknown !== undefined && (
        <span className="w-full text-[length:var(--text-nano)]" style={{ color: 'var(--text-ghost)' }}>
          {n.unknown}
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- panel */

export default function FoundryPanel() {
  const inventory = useAccount((s) => s.inventory);
  const inventoryAt = useAccount((s) => s.inventoryAt);
  const now = useNow();
  const db = useItemDb();

  // The inventory object identity only changes when the payload bytes changed,
  // so this is exactly as often as the derivation can produce a new answer.
  const d = useMemo(
    // One documented cast at the boundary: the store types the payload loosely
    // (`RawInventory`) while the derivation modules type it fully. Same bytes.
    () => (inventory === null ? null : derive(inventory as unknown as RawAccount)),
    [inventory],
  );

  /*
   * CAN YOU ACTUALLY BUILD ANY OF THEM.
   *
   * The reverse index is built once per catalog rather than once per blueprint:
   * it walks every buildable item's component list, which is four thousand
   * entries, and an account can hold hundreds of blueprints.
   */
  const byComponent = useMemo(() => (db === null ? null : indexByComponent(db)), [db]);

  const builds = useMemo(() => {
    if (d === null || byComponent === null) return null;
    const acc = inventory === null ? null : (inventory as unknown as RawAccount);
    return sortBuildables(d.blueprints.map((b) => checkBuildable(b.itemType, acc, byComponent)));
  }, [d, byComponent, inventory]);

  const [lens, setLens] = useState<Lens>('all');
  /*
   * Which blueprints are being considered together. Deliberately NOT
   * persisted: a build queue is a question you are asking right now, and a
   * stale one restored on launch would put a verdict on screen about a
   * decision the player has forgotten making.
   */
  const [queued, setQueued] = useState<ReadonlySet<string>>(() => new Set());
  const toggleQueued = (itemType: string): void => {
    setQueued((prev) => {
      const next = new Set(prev);
      if (!next.delete(itemType)) next.add(itemType);
      return next;
    });
  };

  if (d === null) return <Waiting />;

  /*
   * Null while the catalog is in flight, and rendered as "checking" rather than
   * as a verdict. A blueprint whose requirements have not been looked at yet is
   * not a blueprint you cannot build.
   */
  const counts = builds === null ? null : tally(builds);
  const byBlueprint =
    builds === null ? null : new Map<string, Buildable>(builds.map((b) => [b.itemType, b]));
  /*
   * The queue, pooled. Recomputed from the selection, which is the point: this
   * is the one number on the screen that only exists because of a choice the
   * player made.
   */
  /*
   * THE SELECTION CAN GO STALE UNDER THE PANEL, AND IT DID.
   * ————————————————————————————————————————————
   * `queued` holds blueprint paths. The inventory behind them is re-read every
   * time the game pushes one, and a blueprint that has since been STARTED
   * moves out of `Recipes` and out of this list - so a path in the selection
   * may name something no longer held.
   *
   * The lookup dropped those silently while the heading still counted them
   * from `queued.size`: queue three, build one, and the panel read "1 of 3 can
   * be started" while the queue itself only knew about two. A denominator
   * counting something that is not there is the same defect as a zero standing
   * in for an unknown, and it was in the feature written to stop exactly that.
   *
   * The resolved builds are now the single source for both the queue and its
   * count, and anything that fell out is REPORTED rather than quietly dropped.
   */
  const queuedBuilds =
    byBlueprint === null
      ? []
      : [...queued].flatMap((t) => {
          const b = byBlueprint.get(t);
          return b === undefined ? [] : [b];
        });
  const queuedGone = byBlueprint === null ? 0 : queued.size - queuedBuilds.length;

  const queue =
    byBlueprint === null
      ? null
      : queueOf(queuedBuilds, inventory === null ? null : (inventory as unknown as RawAccount));

  /* The verdict column only exists once there is a verdict to put in it. */
  const columns =
    byBlueprint === null
      ? BLUEPRINT_COLUMNS
      : [
          queueColumn(queued, toggleQueued, byBlueprint),
          nameColumn(byBlueprint),
          ...BLUEPRINT_COLUMNS.slice(1),
          verdictColumn(byBlueprint),
        ];
  const shown =
    byBlueprint === null
      ? d.blueprints
      : d.blueprints.filter((b) => {
          const build = byBlueprint.get(b.itemType);
          return build === undefined ? lens === 'all' : keepFor(lens, build);
        });

  const ready = d.jobs.filter((j) => j.readyAtMs !== null && j.readyAtMs <= now);
  const building = d.jobs.filter((j) => j.readyAtMs === null || j.readyAtMs > now);
  const remainings = building.map((j) => (j.readyAtMs === null ? 0 : Math.max(0, j.readyAtMs - now)));
  // A race needs two runners. One job's bar against its own wait is a full
  // bar for the whole build, which reads as a chart of one.
  const horizon = building.length > 1 ? Math.max(60_000, ...remainings) : null;
  const next = building.find((j) => j.readyAtMs !== null);
  const nextIn = next && next.readyAtMs !== null ? Math.max(0, next.readyAtMs - now) : null;

  const idle = d.jobs.length === 0 && d.blueprints.length === 0;

  // Research still gathering contributions has no timer and so no row; the
  // section heading is where that count lives now that the readout is gone.
  const productionNote = [
    d.researchPending > 0 ? `${int(d.researchPending)} research awaiting contributions` : '',
    horizon !== null ? 'bars are log-scaled to the longest wait' : '',
  ]
    .filter((s) => s !== '')
    .join(' · ');

  // Argon halves at 00:00 UTC. The decay itself is a game rule, not a payload
  // field, but the clock to it is exact and it is the one resource that
  // punishes you for stockpiling.
  const utc = new Date(now);
  const argonDecayMs = Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate() + 1) - now;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <MotionRules />
      <Hero readyCount={ready.length} nextName={next?.name ?? null} nextIn={nextIn} />

      {/* Only the two figures with no section of their own. "In production" and
          "Blueprints held" are headings on this same screen, each already
          carrying its count; a readout for either was the heading said twice. */}
      <div className="mo-stagger grid grid-cols-2 gap-[3px]">
        <Readout
          index={0}
          label="Credits"
          value={d.credits === null ? '—' : int(d.credits)}
          sub={d.credits === null ? 'not in this account read' : 'available to spend'}
        />
        <Readout
          index={1}
          label="Argon"
          value={int(d.argon)}
          sub={
            d.argon === 0 ? 'none held' : `${int(d.argonSafe)} safe · half decays in ${formatRemaining(argonDecayMs)}`
          }
        />
      </div>

      {idle && (
        <EmptyState
          title="The foundry is empty"
          detail={
            <Clamp lines={2}>
              Nothing is building and no blueprints are held. Either this account has genuinely cleared the foundry, or
              the account was read before the foundry had loaded.
            </Clamp>
          }
        />
      )}

      {/* --------------------------------------------------------- ready */}
      {ready.length > 0 && (
        <Fold
          title="Ready to claim"
          eyebrow="collect in the orbiter"
          accent="var(--color-signal-good)"
          /* The subject of the screen, and the only section that opens itself.
             When nothing is claimable this section does not exist at all, and
             the queue below takes the open slot instead. */
          defaultOpen
          answer={
            <span className="numeric" style={{ color: 'var(--color-signal-good)' }}>
              {ready.length} waiting
            </span>
          }
        >
          <ul className="mo-stagger flex flex-col gap-[3px]">
            {ready.map((job, i) => (
              // Linked only when the catalog can place the name: a component or
              // a research project is not a collection item, and a link that
              // lands nowhere is worse than plain text.
              <ReadyRow key={job.key} job={job} index={i} linked={db?.byDisplayName.has(job.name) ?? false} />
            ))}
          </ul>
        </Fold>
      )}

      {/* ------------------------------------------------------ building */}
      {(d.jobs.length > 0 || d.researchPending > 0) && (
        <Fold
          title="In production"
          eyebrow={productionNote === '' ? undefined : productionNote}
          /* Open only when nothing is claimable. Two sections that both open
             themselves is two subjects, which is no subject. */
          defaultOpen={ready.length === 0}
          answer={
            building.length === 0 ? (
              <span style={{ color: 'var(--text-faint)' }}>queue clear</span>
            ) : (
              /* The closed row keeps ticking. This is the panel's second-best
                 answer and it has to survive being collapsed: how many are
                 running, and when the next one lands. */
              <span className="numeric">
                {building.length} building{nextIn === null ? '' : ` · next in ${formatRemaining(nextIn)}`}
              </span>
            )
          }
        >
          {building.length === 0 ? (
            <EmptyState
              title="Nothing under construction"
              detail={
                d.jobs.length > 0
                  ? 'Every job in the foundry has finished.'
                  : 'Research is still gathering contributions, so nothing has a timer yet.'
              }
            />
          ) : (
            <ul className="mo-stagger flex flex-col gap-[3px]">
              {building.map((job, i) => (
                <BuildRow
                  key={job.key}
                  job={job}
                  now={now}
                  horizon={horizon}
                  index={i}
                  // Same gate as the ready list: linked only when the catalog
                  // can place the name, so a building row is never a dead link.
                  linked={db?.byDisplayName.has(job.name) ?? false}
                />
              ))}
            </ul>
          )}
        </Fold>
      )}

      {/* ----------------------------------------------------- helminth */}
      {d.helminth !== null && (
        <Fold
          title="Helminth"
          eyebrow="the infested foundry"
          answer={<span className="numeric">{int(d.helminth.subsumed)} subsumed</span>}
        >
          <div className="mo-stagger grid grid-cols-1 gap-[3px] sm:grid-cols-3">
            <Readout index={0} label="Subsumed" value={int(d.helminth.subsumed)} sub="warframes consumed" />
            <Readout index={1} label="Invigorations" value={int(d.helminth.invigorations)} sub="applied" />
            <Readout
              index={2}
              label="Helminth XP"
              value={d.helminth.xp === null ? '—' : int(d.helminth.xp)}
              sub="rank needs a table this build does not carry"
            />
          </div>
        </Fold>
      )}

      {/* ---------------------------------------------------- blueprints */}
      {d.blueprints.length > 0 && (
        <Fold
          title="Blueprints held"
          eyebrow={
            counts === null
              ? 'checking each against what you hold'
              : counts.ready > 0
                ? `${int(counts.ready)} you can start right now`
                : 'none of these can be started with what you hold'
          }
          answer={<span className="numeric">{d.blueprints.length} distinct</span>}
        >

          {/*
            THE CONTROL THIS PANEL DID NOT HAVE.

            Nine hundred lines rendered a list of blueprints and there was not
            one thing on the screen you could press. The question at a foundry
            is "what can I start", it is answerable from data the app already
            held - your resources, and the catalog's ingredient lists, joined on
            the game's own item path - and the panel asked it of nothing.

            Real buttons, not divs: each is reachable by keyboard, carries its
            own pressed state, and shows its count so narrowing the list never
            hides that the rest exist.
          */}
          {/*
            WHAT THE SELECTION ACTUALLY BOUGHT YOU.
            ————————————————————————————————————————————
            This section does not exist until something is in the queue, and
            what it says is not retrievable from the rows above it. Each
            blueprint's own verdict is computed against the whole inventory, so
            two of them can both read "can start now" while wanting the same
            four Orokin Cells. Checking them one at a time can never report
            that; pooling them is the only way it becomes visible.

            The contested line is the finding. Short is ordinary arithmetic the
            player can do; "each of these could be built on its own, together
            they cannot" is the part the app owes them.
          */}
          {queue !== null && queue.verdict !== 'empty' && (
            <div
              className="rf-lit mo-field mo-sheen mb-2 flex flex-col gap-1 px-3.5 py-3"
              style={{ clipPath: CHAMFER, background: PLATE }}
            >
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
                  Building these together
                </span>
                <span
                  className="eyebrow"
                  style={{
                    color:
                      queue.verdict === 'all'
                        ? 'var(--color-signal-good)'
                        : queue.verdict === 'short'
                          ? 'var(--color-signal-warn)'
                          : 'var(--text-ghost)',
                  }}
                >
                  {queue.verdict === 'all'
                    ? 'the stock covers all of them'
                    : queue.verdict === 'short'
                      ? `${int(queue.affordable.length)} of ${int(queuedBuilds.length)} can be started`
                      : 'not everything here can be checked'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setQueued(new Set());
                  }}
                  className="rf-act mo-underline mo-field mo-focusable eyebrow ml-auto cursor-pointer"
                  style={{ color: 'var(--text-ghost)' }}
                >
                  clear the queue
                </button>
              </div>

              {queuedGone > 0 && (
                <p className="wf-note" style={{ color: 'var(--text-ghost)' }}>
                  {queuedGone === 1
                    ? 'One blueprint you queued is no longer in your foundry, so it is not counted here.'
                    : `${int(queuedGone)} blueprints you queued are no longer in your foundry, so they are not counted here.`}
                </p>
              )}

              {queue.contested.length > 0 && (
                <p className="wf-note" style={{ color: 'var(--color-signal-warn)' }}>
                  {queue.contested.length === 1
                    ? 'One stock is spoken for twice.'
                    : `${int(queue.contested.length)} stocks are spoken for more than once.`}
                  {' Every blueprint below is fine on its own; the shortfall is what they take from each other.'}
                </p>
              )}

              <div className="mt-1 flex min-w-0 flex-col">
                {queue.needs.map((n) => (
                  <PooledRow
                    key={`${n.itemType ?? 'unkeyed'}:${n.what}`}
                    need={n}
                    /* Only where the name is genuinely ambiguous on THIS screen.
                       Qualifying every row would put "for Ash" beside an Orokin
                       Cell nobody could have confused with anything. */
                    qualify={queue.needs.filter((o) => o.what === n.what).length > 1}
                  />
                ))}
              </div>
            </div>
          )}

          {counts !== null && (
            <div role="group" aria-label="Which blueprints to show" className="mo-stagger mb-2 flex flex-wrap gap-1.5">
              {(['all', 'ready', 'short', 'unknown'] as const).map((k, i) => {
                const n =
                  k === 'all'
                    ? (builds?.length ?? 0)
                    : k === 'ready'
                      ? counts.ready
                      : k === 'short'
                        ? counts.short
                        : counts.unverifiable + counts.unplaceable;
                const on = lens === k;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    disabled={n === 0 && k !== 'all'}
                    onClick={() => {
                      setLens(k);
                    }}
                    /*
                     * `mo-lift` and NOT `mo-magnet` alongside it: both write
                     * `transform`, motion.css declares the magnet later, and
                     * the two together silently resolve to one of them. One
                     * transform effect per element, every time.
                     */
                    className="rf-clipped mo-field mo-lift mo-sheen mo-focusable mo-in-up eyebrow cursor-pointer px-2.5 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                    style={{
                      clipPath: CHAMFER,
                      background: on ? 'oklch(0.34 0.07 235 / 0.55)' : 'oklch(1 0 0 / 0.04)',
                      color: on ? 'var(--text)' : 'var(--text-muted)',
                      '--i': i,
                    } as React.CSSProperties}
                  >
                    {LENS_LABEL[k]} {int(n)}
                  </button>
                );
              })}
            </div>
          )}
          <div style={{ clipPath: CHAMFER, background: PLATE }}>
            <DataTable
              columns={columns}
              rows={shown}
              rowKey={(r) => r.itemType}
              /* Once the check has run, what you can start sorts to the top -
                 that is the question the panel is here to answer. Before it
                 has, copy count is the only thing worth ordering by. */
              initialSort={byBlueprint === null ? 'count' : 'buildable'}
              /*
               * The card every other item list opens onto, now with the thing
               * this panel is actually for above it.
               *
               * The item card is joined by DISPLAY NAME, which is all it ever
               * had; the requirement check below is joined by the recipe's own
               * `/Lotus/...` path through the catalog's component lists, which
               * is exact. Both are shown because they answer different
               * questions - what is this, and can I make it.
               */
              /*
                NESTED, NOT STACKED.

                Opening a row used to drop the requirement list AND the entire
                item dossier - description, abilities, the full weapon stat
                block - into one column. Two unrelated answers, both long, and
                the one the player opened the row FOR was on top of a wall they
                had to scroll past to reach the next row.

                They are two questions and they are now two sections. "What it
                needs" is what this panel is for, so it is open; "What it is" is
                the codex entry, which is worth having and is not why anybody
                came here, so it is one press away. The closed row still states
                its own answer, so collapsing costs nothing.
              */
              expand={(r) => {
                const build = byBlueprint?.get(r.itemType) ?? null;
                return (
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Disclosure
                      eyebrow="Checked against what you hold"
                      summary="What it needs"
                      defaultOpen
                      accent={build === null ? undefined : VERDICT_INK[build.verdict]}
                      answer={
                        build === null ? (
                          <span style={{ color: 'var(--text-faint)' }}>checking</span>
                        ) : (
                          <span style={{ color: VERDICT_INK[build.verdict] }}>{VERDICT_WORD[build.verdict]}</span>
                        )
                      }
                    >
                      {byBlueprint === null ? (
                        <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
                          checking what this needs against what you hold
                        </span>
                      ) : build === null ? null : (
                        <Requirements build={build} />
                      )}
                    </Disclosure>

                    <Disclosure
                      eyebrow="From the item catalog"
                      summary="What it is"
                      answer={
                        build?.buildTimeSec == null ? undefined : (
                          <span>{`${String(Math.round(build.buildTimeSec / 3600))} h to build`}</span>
                        )
                      }
                    >
                      {db === null ? (
                        // Not `entry={null}` while the catalog is in flight: the card
                        // would print "not in the catalog export", which is not yet known.
                        <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
                          loading the item catalog
                        </span>
                      ) : (
                        <ItemDetail
                          entry={db.byDisplayName.get(build?.product ?? r.name) ?? null}
                          name={build?.product ?? r.name}
                          itemType={r.itemType}
                          owned={null}
                        />
                      )}
                    </Disclosure>
                  </div>
                );
              }}
            />
            {shown.length === 0 && (
              <p className="wf-note px-3 py-3">
                Nothing you hold is in that state. {int(builds?.length ?? 0)} blueprints are still here under
                {' '}
                <button
                  type="button"
                  onClick={() => {
                    setLens('all');
                  }}
                  /* `mo-underline` rather than Tailwind's `underline`: the
                     rule draws itself from wherever the pointer entered, which
                     is what makes it read as a response. Safe here because
                     this button carries no clip-path - on a chamfered control
                     the rule sits at bottom: -2px, outside the border box, and
                     the clip deletes it. */
                  className="mo-field mo-underline eyebrow cursor-pointer"
                  style={{ color: 'var(--color-orokin-300)' }}
                >
                  {LENS_LABEL.all}
                </button>
                .
              </p>
            )}
          </div>
        </Fold>
      )}

      {/* --------------------------------------------------- provenance */}
      {/*
        THE FOOTER WAS THREE PARAGRAPHS WEARING A LABEL'S CLOTHES.

        Two of the three lines here run past 90 characters, they are set in
        tracked uppercase micro type - the hardest text on the screen to read -
        and they sat permanently at the bottom of every foundry screen. They
        are the panel's honesty and they are not deleted: they are behind the
        one fact from this block that a reader checks repeatedly, which is when
        the account was last read. That fact is now the closed row's answer.
      */}
      <footer className="mo-arrive mt-auto pt-2">
        <Ornament variant="divider" size={28} className="w-full opacity-30" />
        <Disclosure
          eyebrow="provenance"
          summary={<span className="rf-fold-ink mo-underline eyebrow">Where these names and bars come from</span>}
          answer={
            inventoryAt === null ? (
              <span style={{ color: 'var(--text-faint)' }}>account not read</span>
            ) : (
              <span className="numeric">read {new Date(inventoryAt).toLocaleTimeString()}</span>
            )
          }
        >
          {/*
            The apology stopped being true of every row.

            It was written when the panel could only de-camel the recipe path,
            and it is still exactly right for a recipe the catalog cannot place
            - that name IS worked out from the path and may be wrong.
            Everywhere else the name now comes from the product the path
            resolves to, and repeating the disclaimer over a table of correct
            names would be apologising for the wrong thing.
          */}
          <div className="eyebrow">
            <Clamp lines={2}>
              {counts === null || counts.unplaceable > 0
                ? 'the game sends no name for a recipe; where one cannot be placed in the catalog its name is worked out from the path'
                : 'names come from the product each recipe path resolves to, not from the path itself'}
            </Clamp>
          </div>
          {horizon !== null && (
            <div className="eyebrow mt-1.5">
              <Clamp lines={2}>
                the game says when a build finishes, not when it started — bars rank the queue, not progress
              </Clamp>
            </div>
          )}
        </Disclosure>
      </footer>
    </div>
  );
}
