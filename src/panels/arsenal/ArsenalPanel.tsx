/**
 * ARSENAL — every item the game contains, and what your own copies still owe.
 *
 * The panel exists to answer one question a completionist asks constantly:
 * *what do I still need to level?* So the actionable set — owned, masterable,
 * not yet finished — is the thing the layout points at, and everything else
 * (maxed items, exalted weapons, Railjack armaments) is present for density but
 * deliberately quiet.
 *
 * Three correctness rules, all inherited from the derivation modules rather than
 * re-derived here:
 *
 *   - Rank comes from `rankFromLifetimeAffinity`, never from `sqrt(XP / 500)`.
 *     Every Forma resets the item to 0 and raises its cap by 2, so a 5-Forma Kuva
 *     weapon's lifetime affinity feeds the naive formula a rank of 86.
 *   - Per-instance `XP` is the right source *for this panel* (account.ts is
 *     explicit: drive mastery off `XPInfo`, drive the arsenal off the equipment
 *     arrays) because the arsenal is about the objects you own, not the ledger.
 *   - A missing catalog is stated, not papered over. Without it the rank-40 items
 *     are indistinguishable from rank-30 ones, and the provenance fold says so.
 *
 * THREE DEFECTS THIS REBUILD REMOVES, ALL OF THEM MEASURED
 * ───────────────────────────────────────────────────────
 *   1. WITH NO ACCOUNT THE PANEL RENDERED 244 CHARACTERS on a 1500x940 window —
 *      the emptiest screen in the app. The empty state itself was good: it named
 *      the exact fields it was waiting for. But it REPLACED the whole panel, so
 *      the item catalog — thousands of real items, with real classes, mastery
 *      requirements and rank ceilings, needing no account at all — was reachable
 *      only through one button reading "Browse every item in the game".
 *
 *      A file comment used to argue that this panel is the one with no catalog
 *      half, because "which equipment exists is what the Collection panel is".
 *      That is an argument about a panel elsewhere, made to a reader looking at
 *      this one and being shown nothing. The catalog is game data; it is the
 *      floor now, and the refusal is a banner above it rather than a wall in
 *      front of it.
 *
 *   2. THE GROUPING KEY WAS SPENT ON A FILTER. `r.key` is the gear type — 27 of
 *      them — and it drove an exclusive chip strip: pressing "Melee" meant not
 *      seeing anything else, while the table below it ran up to 120 flat sibling
 *      rows with no grouping at all, and the row cap was spent by whichever type
 *      happened to sort first. A key used as an exclusive filter answers one
 *      question and forecloses the rest; the same key used as STRUCTURE answers
 *      all of them at once. So the chips are gone and the key is the group.
 *
 *   3. ONE STRING WAS PRINTED TWICE, PERMANENTLY, ABOUT SIXTY PIXELS APART —
 *      "N of 27 gear types hold something", once in the hero and once in the
 *      filter fold's answer. The fold went with the chips; the hero keeps it.
 *
 * THE NESTING IS THE POINT
 * ────────────────────────
 * Gear type (0) → one item you own (1) → what the catalog knows about it (2) →
 * how its rank was worked out (3). `--disc-depth` drives the type size, so
 * descending looks like descending, and every group carries an aggregate: a
 * CLOSED group still says how many items are in it, how many still owe mastery
 * and how much Forma is buried in it. The catalog half is the same four levels
 * with the account facts absent instead of assumed.
 *
 *   4. TWELVE EM DASHES ON THE FIRST SCREEN, WHICH IS THE MOST IN THE APP.
 *      Driven through a real browser at 1280x720 with nothing read, the
 *      cold-launch panel — the state the owner actually sees — printed a dash in
 *      the answer column of every catalog row, and the first gear type opens by
 *      default with CAP rows in it. Twelve rows, each ending in the same mark.
 *
 *      The convention line above them was honest and did not help: "every dash
 *      is unread, not zero" makes each dash truthful and does nothing about
 *      there being twelve of it, and a screen of them reads as a broken panel
 *      whatever the footnote says. One fact stated twelve times is eleven
 *      restatements, which is defect 3 again in a different costume.
 *
 *      So the dash is gone from the row and the fact moved up to the banner,
 *      which now NAMES the readouts that are unread — rank, Forma, fittings —
 *      with all nine of them and what fills each one press inside it. Nothing is
 *      substituted for the dash: a zero would be a claim, and a catalog row
 *      simply has no account column now.
 *
 * ABSENT IS NEVER ZERO, AND IT IS STATED ONCE
 * ───────────────────────────────────────────
 * Rank, Forma and reactors are properties of your items, not of the game. With
 * no account they are unread — never rendered as a zero, and never printed as a
 * placeholder per row either. The banner states the absence once for the whole
 * screen and names what is in it, which is the stronger form of what
 * `FocusPanel` does with "every dash is unread, not zero": there is no dash left
 * on this screen for a convention to govern.
 *
 * THE SHAPE: PINNED HEAD, ONE SCROLLING PANE, PINNED FOOT
 * ──────────────────────────────────────────────────────
 * The panel root is a fixed-height grid, not a growing column. What the panel
 * TELLS you — the refusal or the backlog hero, and the controls — is pinned at
 * the top; what you LOOK UP in it — the tree, which is thousands of rows and is
 * meant to be long — scrolls inside its own pane; what it CANNOT know is pinned
 * at the bottom where it is always one press away instead of a thousand rows
 * down. The page itself never scrolls.
 *
 * PRESENTATION
 * ────────────
 * One bold element: the backlog — how many owned items still owe mastery. That
 * is the number the panel exists to answer, so it is the only large thing on
 * screen and every other figure is set small beside it. Everything is cut rather
 * than rounded, and every entrance is a CSS class, never a JS tween: rAF does
 * not run while the overlay window is hidden, and a list that animates in from
 * `opacity: 0` under a tween that never runs is a list you cannot read.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAccount } from '../../core/store';
import {
  allEquipment,
  hasFeature,
  isMastered,
  itemXp,
  levelCap,
  EquipmentFeature,
  EQUIPMENT_KEYS,
  oidOf,
  type EquipmentKey,
  type RawAccount,
} from '../../data/account';
import { lifetimeAffinityForRank, rankFromLifetimeAffinity } from '../../data/mastery';
import {
  loadItemDb,
  normaliseItemType,
  type ItemCategory,
  type ItemDb,
  type ItemDbEntry,
} from '../../data/itemdb';
import { CLIP, Counter, EmptyState, Meter, Tabs } from '../../ui/orokin';
import { Facts, type Fact } from '../../ui/interact';
// `Clamp` is used in the banner body and NOWHERE inside an `EmptyState`, which
// is not taste but markup: `EmptyState` renders its detail in a <p>, and Clamp
// is a <div> holding a <button>. The parser closes the paragraph at the div and
// reparents everything after it.
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { ItemDetail } from '../../ui/ItemDetail';
import { countTypes, usePreviousAccount } from '../../ui/useDelta';
import { CHAMFER, GOLD_RIM, GOLD_FILL } from '../../ui/geometry';
import { ListTail } from '../../ui/ListTail';

/**
 * Rows a group shows before it says how many it is holding back.
 *
 * PER GROUP, NOT PER LIST, and that is most of the argument for grouping at all.
 * The flat table this replaced held a single 200-row cap across all 27 gear
 * types, so a veteran asking about Melee was given the first two hundred rows of
 * whatever sorted first instead. A cap inside a group can only ever hold back
 * rows from the group you are actually looking at, and what it holds back is
 * stated on the spot rather than silently truncated.
 */
const CAP = 12;

// ---------------------------------------------------------------------------
// Category vocabulary
// ---------------------------------------------------------------------------

/**
 * Display names for the 27 equipment arrays. `Antiques`, `Scoops` and `Horses`
 * keep DE's own key: the research never confirmed what they hold, and inventing
 * a friendly label for a bin you cannot name is how a tool starts lying.
 */
const KEY_LABEL: Record<EquipmentKey, string> = {
  Suits: 'Warframes',
  LongGuns: 'Primary',
  Pistols: 'Secondary',
  Melee: 'Melee',
  SpecialItems: 'Exalted',
  Sentinels: 'Sentinels',
  SentinelWeapons: 'Robotic',
  SpaceSuits: 'Archwing',
  SpaceGuns: 'Arch-Gun',
  SpaceMelee: 'Arch-Melee',
  Hoverboards: 'K-Drives',
  OperatorAmps: 'Amps',
  Antiques: 'Antiques',
  MoaPets: 'MOAs',
  Scoops: 'Scoops',
  Horses: 'Horses',
  DrifterGuns: 'Drifter Guns',
  DrifterMelee: 'Drifter Melee',
  Motorcycles: 'Motorcycles',
  CrewShips: 'Railjack',
  DataKnives: 'Parazon',
  MechSuits: 'Necramechs',
  CrewShipHarnesses: 'Plexus',
  KubrowPets: 'Beasts',
  CrewShipWeapons: 'Railjack Arms',
  CrewShipSalvagedWeapons: 'Salvaged Arms',
  OperatorSuits: 'Operator',
};

/**
 * The catalog's own gear types, in the words the owned half already uses.
 *
 * `productCategory` LOOKS like the right key here and is not, which is worth
 * writing down because it is the obvious thing to reach for: it is DE's
 * inventory-bin routing, and measured against the live export it files 45 of
 * Melee.json's rows, 49 of Pets.json's and all 9 masterable Misc rows under
 * `Pistols`. Grouping by it would put Zaw strikes and Kitgun chambers in
 * "Secondary" — an accurate statement about DE's storage and a wrong one about
 * what the thing is.
 *
 * `category` is the WFCD FILENAME the row was fetched from (itemdb.ts is
 * explicit that this is deliberate, because the `category` field inside the
 * rows claims every companion weapon is a Primary). Ten of the eleven filenames
 * are the same gear types the equipment arrays use, so the two halves of this
 * panel group under one vocabulary.
 */
const CATEGORY_LABEL: Record<ItemCategory, string> = {
  Warframes: 'Warframes',
  Primary: 'Primary',
  Secondary: 'Secondary',
  Melee: 'Melee',
  Sentinels: 'Sentinels',
  SentinelWeapons: 'Robotic',
  Pets: 'Beasts',
  Archwing: 'Archwing',
  'Arch-Gun': 'Arch-Gun',
  'Arch-Melee': 'Arch-Melee',
  // The nine masterable rows in the 1256-row Misc junk drawer are all Kitgun and
  // K-Drive components — named for what they are rather than for the file.
  Misc: 'Modular parts',
};

/**
 * The 200-mastery-per-rank classes, which also cost 1000 affinity per rank²
 * instead of 500. Warframes, Archwings, Necramechs, every companion, the Plexus
 * and K-Drives (mastery-math §4.1).
 *
 * `Motorcycles` and `Horses` are deliberately absent: they are vehicles and so
 * *probably* pay the frame rate, but nothing in the research says so, and
 * guessing high would inflate every rank shown for them.
 */
const FRAME_KEYS: ReadonlySet<EquipmentKey> = new Set<EquipmentKey>([
  'Suits',
  'SpaceSuits',
  'MechSuits',
  'Sentinels',
  'KubrowPets',
  'MoaPets',
  'Hoverboards',
  'CrewShipHarnesses',
]);

/** Catalog categories that pay the frame rate, for items the key map cannot place. */
const FRAME_CATEGORIES: ReadonlySet<ItemCategory> = new Set<ItemCategory>([
  'Warframes',
  'Archwing',
  'Sentinels',
  'Pets',
]);

/** `/Lotus/Weapons/Tenno/LongGuns/BratonPrime` -> `Braton Prime`. */
function nameFromType(itemType: string): string {
  const last = itemType.split('/').filter(Boolean).pop() ?? itemType;
  return last.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  name: string;
  key: EquipmentKey;
  group: string;
  /** WFCD's display type (`Rifle`, `Warframe`) when known, else the bin label. */
  type: string;
  xp: number;
  rank: number;
  /** The cap this instance has right now: 30 + 2 per Forma, ceilinged by `maxRank`. */
  cap: number;
  /** The highest rank the item can ever reach. 40 for the 52 + 2 rank-40 items. */
  maxRank: number;
  forma: number;
  /** 0..1 toward the current cap. */
  progress: number;
  /** Lifetime affinity still owed to reach the current cap. 0 at cap. */
  owed: number;
  /**
   * Pays 200 mastery a rank and 1000 affinity per rank², rather than 100/500.
   * Carried on the row because the depth-3 evidence has to name WHICH curve it
   * used — a derived rank that will not say how it was derived is an assertion.
   */
  frame: boolean;
  /** Does this item pay mastery at all? Exalted weapons do not. */
  masterable: boolean;
  /** At its current cap — nothing more to gain without another Forma. */
  atCap: boolean;
  /** Has paid all the mastery it will ever pay. */
  mastered: boolean;
  /** The catalog knew this ItemType. When false, `maxRank` is an assumption. */
  known: boolean;
  /** The catalog row, for the detail one level in. Null when it is not in the export. */
  entry: ItemDbEntry | null;
  reactor: boolean;
  exilus: boolean;
  gilded: boolean;
  incarnon: boolean;
  arcane: boolean;
  favorite: boolean;
}

/** Owned, pays mastery, not finished. The set this whole panel is pointed at. */
function isTodo(r: Row): boolean {
  return r.masterable && !r.mastered;
}

function buildRows(inventory: RawAccount | null, db: ItemDb | null): Row[] {
  const out: Row[] = [];

  for (const { key, item } of allEquipment(inventory)) {
    const raw = item.ItemType ?? '';
    const itemType = raw ? normaliseItemType(raw, db?.boosters ?? {}) : '';
    const entry = itemType ? db?.byType.get(itemType) : undefined;

    // The key map is authoritative where it speaks, because the catalog buckets
    // K-Drives and the Plexus into Misc and would silently halve their curve.
    const isFrame = FRAME_KEYS.has(key) || (entry ? FRAME_CATEGORIES.has(entry.category) : false);
    const maxRank = entry?.maxRank ?? 30;
    const cap = levelCap(item, maxRank);
    const xp = itemXp(item);
    const rank = rankFromLifetimeAffinity(xp, isFrame, cap);
    const forma = item.Polarized ?? 0;
    // `SpecialItems` is exalted weapons — Exalted Blade, Venari, Diwata. They rank
    // up and pay nothing, so folding them into the backlog would invent work.
    const masterable = entry ? entry.masterable : key !== 'SpecialItems';
    const ceiling = lifetimeAffinityForRank(cap, isFrame);

    out.push({
      id: `${key}:${out.length}:${oidOf(item.ItemId) ?? itemType}`,
      name: item.ItemName?.split('|')[0] || (entry?.name ?? (itemType ? nameFromType(itemType) : 'Unknown item')),
      key,
      group: KEY_LABEL[key],
      type: entry?.type ?? KEY_LABEL[key],
      xp,
      rank,
      cap,
      maxRank,
      forma,
      progress: ceiling > 0 ? Math.min(1, xp / ceiling) : 0,
      owed: Math.max(0, ceiling - xp),
      frame: isFrame,
      masterable,
      atCap: isMastered(item, { isFrame, maxLevelCap: maxRank }),
      mastered: masterable && rank >= maxRank,
      known: entry !== undefined,
      entry: entry ?? null,
      reactor: hasFeature(item, EquipmentFeature.DOUBLE_CAPACITY),
      exilus: hasFeature(item, EquipmentFeature.UTILITY_SLOT),
      gilded: hasFeature(item, EquipmentFeature.GILDED),
      incarnon: hasFeature(item, EquipmentFeature.INCARNON_GENESIS),
      arcane: hasFeature(item, EquipmentFeature.ARCANE_SLOT),
      favorite: item.Favorite === true,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

/** Shared across every mount of the panel: the fetch and parse happen once. */
let dbOnce: Promise<ItemDb> | null = null;

function useItemDb(): ItemDb | null {
  const [db, setDb] = useState<ItemDb | null>(null);

  useEffect(() => {
    let alive = true;
    dbOnce ??= loadItemDb();
    void dbOnce.then(
      (d) => {
        if (alive) setDb(d);
      },
      // A failed catalog is a degraded panel, not a broken one: names fall back
      // to the ItemType path and every cap is assumed to be 30.
      (err: unknown) => {
        console.warn('[arsenal] item catalog unavailable', err);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  return db;
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

interface FittingSpec {
  glyph: string;
  title: string;
  color: string;
}

const FITTINGS: readonly (readonly [keyof Row, FittingSpec])[] = [
  ['reactor', { glyph: 'R', title: 'Orokin Reactor / Catalyst installed', color: 'var(--color-orokin-400)' }],
  ['exilus', { glyph: 'X', title: 'Exilus adapter installed', color: 'var(--color-tenno-300)' }],
  ['incarnon', { glyph: 'I', title: 'Incarnon Genesis installed', color: 'var(--color-orokin-200)' }],
  ['arcane', { glyph: 'A', title: 'Arcane slot unlocked', color: 'var(--color-signal-rare)' }],
  ['gilded', { glyph: 'G', title: 'Gilded', color: 'var(--color-signal-good)' }],
];

function Fittings({ row }: { row: Row }) {
  const on = FITTINGS.filter(([field]) => row[field] === true);
  if (on.length === 0) {
    return (
      <span
        className="eyebrow"
        style={{ color: 'var(--text-faint)' }}
        title="No reactor or catalyst, exilus, incarnon, arcane slot or gilding on this item"
      >
        bare
      </span>
    );
  }
  return (
    <span className="flex gap-1">
      {on.map(([field, spec]) => (
        <span
          key={String(field)}
          title={spec.title}
          // The one explicit type size left on a row, and it is not a label
          // size: this is a 17px plate with a single letter in it, so the letter
          // is sized to the plate rather than to the paragraph it sits in.
          className="grid h-[17px] w-[17px] place-items-center text-[length:var(--text-nano)] font-semibold"
          style={{
            clipPath: CLIP.button,
            color: spec.color,
            // Two stops rather than a flat tint: even a 17px chip reads as a lit
            // plate instead of a coloured square.
            background: `linear-gradient(160deg, color-mix(in oklab, ${spec.color} 30%, transparent), color-mix(in oklab, ${spec.color} 8%, transparent))`,
            boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${spec.color} 38%, transparent)`,
          }}
        >
          {spec.glyph}
        </span>
      ))}
    </span>
  );
}

function RankCell({ row }: { row: Row }) {
  const done = row.mastered;
  const color = done ? 'var(--color-orokin-400)' : row.atCap ? 'var(--color-signal-warn)' : 'var(--color-tenno-400)';

  return (
    // Both halves are fixed-width: the answer column is content-sized, so a
    // flexible meter here collapses to a stub the moment an item has a long name.
    // No font size on either — the summary row's size comes from `--disc-depth`,
    // which is what makes a row at depth 1 read as a level under its group.
    <span className="flex items-center gap-2.5">
      <span
        className="numeric w-[52px] shrink-0 text-right"
        style={{ color: done ? 'var(--color-orokin-300)' : 'var(--text)' }}
      >
        {done ? 'MAX' : `${row.rank}/${row.cap}`}
      </span>
      <Meter className="w-[110px] shrink-0" value={row.progress} color={color} height={5} />
    </span>
  );
}

/** The actionable half of every row: what is left, in the unit you act on. */
function RemainingCell({ row }: { row: Row }) {
  if (!row.masterable) {
    return <span style={{ color: 'var(--text-faint)' }}>no mastery</span>;
  }
  if (row.mastered) {
    return <span style={{ color: 'var(--text-faint)' }}>—</span>;
  }
  if (row.atCap) {
    // At cap but not finished only happens on the rank-40 items: the remaining
    // ranks are gated behind Forma, not behind affinity.
    const need = Math.ceil((row.maxRank - row.cap) / 2);
    return <span style={{ color: 'var(--color-signal-warn)' }}>{need} forma</span>;
  }
  return <span style={{ color: 'var(--color-orokin-300)' }}>{row.cap - row.rank} ranks</span>;
}

// ---------------------------------------------------------------------------
// The levels
// ---------------------------------------------------------------------------

/**
 * Depth 3: how the rank two levels above it was arrived at.
 *
 * The panel's footer states, once and globally, that a rank past 30 is this
 * app's arithmetic rather than a figure Warframe sent. That is the right place
 * for the CLAIM and the wrong place for the WORKING: it applies to a thousand
 * rows and can be checked against none of them. Here it is checkable — the
 * curve, the Forma that moved the ceiling, and the two affinity totals the rank
 * was measured between, for the one item the reader actually asked about.
 *
 * Nothing here is restated from the card above it. `ItemDetail`'s own facts
 * carry the lifetime affinity and what is still owed; these are the constants
 * behind them.
 */
function RankEvidence({ row }: { row: Row }) {
  const base = row.frame ? 1000 : 500;
  const costOfCap = lifetimeAffinityForRank(row.cap, row.frame);
  const costOfMax = lifetimeAffinityForRank(row.maxRank, row.frame);

  return (
    <Disclosure
      depth={3}
      summary="How this rank was worked out"
      answer={
        row.cap > 30 ? (
          <span style={{ color: 'var(--color-signal-warn)' }}>estimated past rank 30</span>
        ) : (
          <span>read off the affinity curve</span>
        )
      }
    >
      <Facts
        columns={1}
        items={[
          {
            label: 'Affinity curve',
            value: `${base.toLocaleString()} per rank squared — ${
              row.frame ? 'frames, companions and vehicles' : 'weapons'
            }`,
          },
          {
            label: 'Forma on this copy',
            value:
              row.forma === 0
                ? 'none — the ceiling is the base 30'
                : `${row.forma} — each one resets the item to rank 0 and lifts the ceiling by 2`,
          },
          { label: 'Total the current ceiling costs', value: `${costOfCap.toLocaleString()} at rank ${row.cap}` },
          {
            label: 'Total the maximum costs',
            value: `${costOfMax.toLocaleString()} at rank ${row.maxRank}`,
            when: row.maxRank !== row.cap,
          },
          {
            // The one place the assumption is admitted next to the number it
            // produced, rather than in a footer covering the whole screen.
            label: 'Ceiling',
            value: 'assumed to be 30 — this item is not in the catalog export',
            when: !row.known,
          },
        ]}
      />
    </Disclosure>
  );
}

/**
 * What is behind the fold, in the words of what is actually in there.
 *
 * A depth-2 answer has to be a fact rather than a signpost, and "details" is a
 * signpost. What varies row to row is which KINDS of thing the catalog carries
 * for it: a warframe has abilities, a weapon has crit and status, a buildable
 * has a recipe, and a row the export has never heard of has none of them and
 * says so.
 */
function foldAnswer(entry: ItemDbEntry | null): ReactNode {
  if (entry === null) {
    return <span style={{ color: 'var(--text-ghost)' }}>not in the catalog export</span>;
  }
  const has: string[] = [];
  if (entry.criticalChance != null) has.push('weapon statistics');
  if ((entry.abilities?.length ?? 0) > 0) has.push(`${String(entry.abilities?.length ?? 0)} abilities`);
  if ((entry.components?.length ?? 0) > 0) has.push(`built from ${String(entry.components?.length ?? 0)}`);
  if (entry.description != null && entry.description.length > 0) has.push('codex entry');
  return has.length === 0 ? (
    <span style={{ color: 'var(--text-faint)' }}>name and mastery only</span>
  ) : (
    <span>{has.join(' · ')}</span>
  );
}

/**
 * Depth 2: what the catalog knows, under a row that has already said what you own.
 *
 * `ItemDetail` is not rewritten here and must not be: five panels open the same
 * card, and a weapon that describes itself differently depending on which screen
 * you found it on is five maintenance problems. It already carries its own
 * deeper fold ("Everything else"), so this level is a wrapper that gives it a
 * depth and an answer, and hands it whatever the caller's row could not hold.
 */
function ItemFold({
  entry,
  name,
  owned,
  extra,
  children,
}: {
  entry: ItemDbEntry | null;
  name: string;
  /** Tri-state, and it must stay tri-state: null is "no inventory to check". */
  owned: boolean | null;
  extra?: readonly Fact[];
  children?: ReactNode;
}) {
  return (
    <Disclosure depth={2} summary="What it is" answer={foldAnswer(entry)}>
      <ItemDetail entry={entry} name={name} owned={owned} extra={extra}>
        {children}
      </ItemDetail>
    </Disclosure>
  );
}

/**
 * Depth 1: one item you own.
 *
 * NO GEAR TYPE ON THIS ROW. The row sits inside its own type's group, so
 * printing "Melee" on all four hundred of them is the grouping key rendered once
 * per row — exactly the shape grouping replaces, and exactly what the old Class
 * column was. The catalog's finer word for it (`Bow`, `Sniper Rifle`) survives,
 * because that one varies inside the group and is the half worth having.
 */
function ItemRow({ row }: { row: Row }) {
  return (
    <Disclosure
      depth={1}
      summary={
        <span className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span
            className="min-w-0 truncate font-[family-name:var(--font-display)] font-semibold"
            style={{ color: row.mastered ? 'var(--text-muted)' : 'var(--text)' }}
          >
            {row.name}
          </span>
          {row.favorite && (
            // An SVG diamond, not a glyph: the app ships no icon font, and the
            // app's own mark for "flagged" is a cut square on its point.
            <svg viewBox="0 0 8 8" className="size-2 shrink-0" aria-hidden>
              <title>Favorited</title>
              <path d="M4 0 L8 4 L4 8 L0 4 Z" fill="var(--color-orokin-500)" />
            </svg>
          )}
          {/* `Warframes / Warframe` is noise; `Primary / Bow` is the point. */}
          {!row.group.toLowerCase().startsWith(row.type.toLowerCase()) && (
            <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
              {row.type}
            </span>
          )}
        </span>
      }
      answer={
        <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <RankCell row={row} />
          {/* A zero is not printed as one: an item with no Forma in it shows
              nothing, because "0 forma" reads as a measurement of nothing and
              the column it used to sit in has been replaced by a sentence. */}
          {row.forma > 0 && (
            <span className="numeric" style={{ color: 'var(--color-orokin-400)' }}>
              ×{row.forma} forma
            </span>
          )}
          <Fittings row={row} />
          <RemainingCell row={row} />
        </span>
      }
    >
      <ItemFold
        entry={row.entry}
        name={row.name}
        owned
        /*
         * ONLY WHAT THE COLLAPSED ROW CANNOT HOLD.
         *
         * Ten of the thirteen facts here were once the row's own cells retyped
         * as label/value pairs - rank, forma, bin, status, favourite, and the
         * five fittings - so opening a row showed you what you had just read.
         * The five fittings were the subtlest of them: the row still renders
         * R/X/I/A/G, so they were five stacked sentences restating five letters.
         *
         * They are not simply deleted, though. Those letters explain themselves
         * only through a `title` attribute, which is mouse-only and unreachable
         * by keyboard, so the spelled-out form is the one accessible copy of the
         * legend. It survives as ONE line instead of five.
         */
        extra={[
          {
            // Two different ceilings, and conflating them is the classic
            // Warframe confusion: the cap you have now moves with Forma, the
            // maximum never does. Shown only when they disagree.
            //
            // The label is ItemDetail's own, on purpose: it drops its catalog
            // copy of a fact only when the labels match, and as "Ceiling" this
            // line sat above the fold while "Rank cap 40" sat inside "Everything
            // else" - the same number twice.
            label: 'Rank cap',
            value: `${row.maxRank}${row.known ? '' : ' (assumed)'}`,
            when: row.cap !== row.maxRank || !row.known,
          },
          { label: 'Lifetime affinity', value: row.xp.toLocaleString() },
          // The one number no row holds: what the next cap costs. Never printed
          // as 0 - at cap the line is absent. ("Pays mastery" was cut: the
          // Remaining cell already says "no mastery" for the items that do not.)
          {
            label: 'Affinity to cap',
            value: row.owed.toLocaleString(),
            when: row.masterable && !row.atCap && row.owed > 0,
          },
          {
            label: 'Fitted',
            value: FITTINGS.filter(([f]) => row[f] === true)
              .map(([, spec]) => spec.title)
              .join(' · '),
            when: row.reactor || row.exilus || row.arcane || row.incarnon || row.gilded,
          },
        ]}
      >
        <RankEvidence row={row} />
      </ItemFold>
    </Disclosure>
  );
}

/**
 * Depth 1: one item the game contains, with no account to measure it against.
 *
 * Every fact on this row is game data — the class, the mastery it demands, the
 * ceiling it can reach. The one account fact is a dash, and the dash is NOT
 * explained here: the banner at the top of the panel declares the convention
 * once for the whole screen, and repeating it on a thousand rows would say
 * nothing the reader has not already been told.
 *
 * `owned` is `null` all the way down, which is what keeps `ItemDetail` from
 * claiming you do not own the thing. It has no inventory to check.
 */
function CatalogRow({ entry }: { entry: ItemDbEntry }) {
  return (
    <Disclosure
      depth={1}
      summary={
        <span className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span className="min-w-0 truncate font-[family-name:var(--font-display)]" style={{ color: 'var(--text)' }}>
            {entry.name}
          </span>
          {/* The catalog's finer word for the thing, where it differs from the
              group. `Warframes / Warframe` is the grouping key twice. */}
          {entry.type != null && !CATEGORY_LABEL[entry.category].toLowerCase().startsWith(entry.type.toLowerCase()) && (
            <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
              {entry.type}
            </span>
          )}
        </span>
      }
      answer={
        <span className="flex flex-wrap items-baseline justify-end gap-x-3 gap-y-1">
          {/* Suppressed at zero rather than printed as "MR 0". Most of the
              catalog demands no mastery at all, so the negative case is a
              constant wearing the costume of a fact - and the group above
              states the highest requirement it holds, which is the number
              somebody scanning for a wall actually wants. */}
          {entry.masteryReq > 0 && (
            <span className="numeric" style={{ color: 'var(--color-tenno-300)' }}>
              MR {entry.masteryReq}
            </span>
          )}
          {/* The single biggest hidden cost in the game, and true of 54 items
              out of thousands: a rank-40 weapon is roughly six times the
              affinity of a rank-30 one for the same two mastery points. */}
          {entry.maxRank !== 30 && (
            <span className="numeric" style={{ color: 'var(--color-signal-warn)' }}>
              ranks to {entry.maxRank}
            </span>
          )}
          {!entry.masterable && (
            <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
              no mastery
            </span>
          )}
          {/*
            THERE IS NO ACCOUNT COLUMN HERE ANY MORE, AND THE DASH THAT WAS IS
            THE DEFECT THIS COMMENT RECORDS.

            This row used to end in an em dash standing in for the account facts
            a catalog row cannot have — rank, Forma, fittings. Measured in a real
            browser at 1280x720 with nothing read, the cold-launch panel printed
            that dash TWELVE times, the most of any panel in the app: the first
            gear type opens by default and lists CAP rows, so the reader's first
            screen was twelve rows each terminating in the same punctuation mark.

            Twelve dashes are not twelve facts. They are ONE fact — "your own
            gear has not been read" — restated once per row in a costume, and a
            screen of them is precisely the "most of the data is incorrect or
            empty" reading this panel kept getting. The convention line above
            them ("every dash is unread, not zero") made each dash honest and did
            nothing about there being twelve of it.

            The fact is not deleted and it is not substituted with a zero, which
            would be a claim rather than an absence. It is stated ONCE, at the
            top of the panel, where `AccountBanner` names which readouts are
            unread and what fills them — with the full per-readout list one press
            inside it. A row here now carries only what the export actually
            knows, and a row with nothing notable to say says nothing.
          */}
        </span>
      }
    >
      <ItemFold entry={entry} name={entry.name} owned={null} />
    </Disclosure>
  );
}

/**
 * Depth 0: one gear type you own, carrying its own aggregate.
 *
 * The aggregate is the reason a closed group is worth having. "Melee · 412
 * owned" is a table of contents; "Melee · 412 owned · 38 still owe mastery · 96
 * forma" is an answer, and a reader who never opens anything has still been told
 * which types their backlog is in and where their Forma went.
 *
 * THE AGGREGATE COUNTS `population`. IT MUST NEVER COUNT `rows`.
 * ─────────────────────────────────────────────────────────────
 * `rows` is whatever the current tab and the search left standing; `population`
 * is every item of that type you own. Counting the aggregate off `rows` turned
 * all three figures into a restatement of the filter, and it did it in the two
 * places a reader would never think to doubt: the default To-level tab printed
 * "Melee · 187 owned · 187 still owe mastery" to a player who owns 412 melee
 * weapons, and the Mastered tab — where `isTodo` is false for every row BY
 * CONSTRUCTION — gave every group on screen the green "all finished" while 38
 * items still owed mastery. An artefact of the filter wearing the costume of a
 * count.
 *
 * That is the same defect the hero one screen up already refuses: it is computed
 * off unfiltered `rows` so that switching tab or typing a search cannot make the
 * count and the name beside it disagree. The rule holds here too — the numbers
 * describe the whole gear type, the LIST describes the current view, and when
 * the two differ the group says how many rows it is actually showing rather than
 * passing the filtered count off as the total.
 */
function ArsenalTree({
  rows,
  population,
  empty,
}: {
  rows: readonly Row[];
  /** Every owned item, before the tab and the search. The only thing counted. */
  population: readonly Row[];
  empty: ReactNode;
}) {
  const groups = useMemo(() => {
    // What survived the filter, so a group has something to SHOW.
    const shownBy = new Map<EquipmentKey, Row[]>();
    for (const r of rows) {
      const list = shownBy.get(r.key);
      if (list === undefined) shownBy.set(r.key, [r]);
      else list.push(r);
    }

    // The whole gear type behind it, so a group has something to COUNT.
    const by = new Map<EquipmentKey, { owned: number; todo: number; forma: number }>();
    for (const r of population) {
      const agg = by.get(r.key) ?? { owned: 0, todo: 0, forma: 0 };
      agg.owned += 1;
      if (isTodo(r)) agg.todo += 1;
      agg.forma += r.forma;
      by.set(r.key, agg);
    }

    return [...by.entries()]
      .map(([key, agg]) => ({
        key,
        label: KEY_LABEL[key],
        ...agg,
        // Actionable first, then closest to done — the completionist's own order,
        // applied inside the group so the cap below can only ever hold back the
        // rows furthest from finished.
        rows: (shownBy.get(key) ?? []).sort((a, b) => {
          const at = isTodo(a);
          const bt = isTodo(b);
          if (at !== bt) return at ? -1 : 1;
          return b.progress - a.progress || a.name.localeCompare(b.name);
        }),
      }))
      // A gear type the current view emptied is not drawn: a group whose only
      // content is its own aggregate is a heading that opens onto nothing.
      .filter((g) => g.rows.length > 0)
      // The type with the most left to do leads, because that is the panel's
      // question. Alphabetical order put "Amps" at the top of every account.
      .sort((a, b) => b.todo - a.todo || b.owned - a.owned || a.label.localeCompare(b.label));
  }, [rows, population]);

  if (groups.length === 0) return <>{empty}</>;

  return (
    <div className="flex flex-col gap-1">
      {groups.map((g, i) => {
        const shown = g.rows.slice(0, CAP);
        return (
          <Disclosure
            key={g.key}
            depth={0}
            eyebrow={`${String(g.owned)} owned`}
            summary={g.label}
            defaultOpen={i === 0}
            answer={
              <span className="flex flex-wrap items-baseline justify-end gap-2.5">
                {g.todo > 0 ? (
                  <span className="numeric" style={{ color: 'var(--color-orokin-200)' }}>
                    {g.todo} still owe mastery
                  </span>
                ) : (
                  // A counted zero, not an unmeasured one — every item YOU OWN
                  // of this type was read and none of them owes anything. That
                  // sentence was false while this counted the filtered rows: on
                  // the Mastered tab it was true of every group by construction,
                  // so the whole screen went green over a backlog of 38. It is
                  // counted over the population now, which is what makes it a
                  // claim rather than a restatement of the tab. Said in words
                  // rather than as "0 to level", which is the shape an absent
                  // number wears and would teach the reader to distrust the ones
                  // beside it.
                  <span className="eyebrow" style={{ color: 'var(--color-signal-good)' }}>
                    all finished
                  </span>
                )}
                {g.forma > 0 && (
                  <span className="numeric" style={{ color: 'var(--color-orokin-400)' }}>
                    {g.forma} forma spent
                  </span>
                )}
                {/* The three figures above are about the whole gear type; the
                    rows under this one are what the tab and the search left. So
                    when they differ the group says so, rather than letting a
                    reader take the list length for the count it just read. */}
                {g.rows.length < g.owned && (
                  <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
                    {g.rows.length} in this view
                  </span>
                )}
              </span>
            }
          >
            <div className="flex flex-col">
              {shown.map((r) => (
                <ItemRow key={r.id} row={r} />
              ))}
              <ListTail
                hidden={g.rows.length - shown.length}
                ordered="ranked below these"
                reach="filter by name to reach one"
              />
            </div>
          </Disclosure>
        );
      })}
    </div>
  );
}

/**
 * Depth 0: one gear type the game contains.
 *
 * Same shape as the owned tree above and deliberately so: the panel does not
 * change its grammar when it loses the account, it only loses the facts that
 * were about you. Every aggregate here is countable from the export alone.
 */
function CatalogTree({ db, query }: { db: ItemDb; query: string }) {
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...db.byCategory.entries()]
      .map(([category, entries]) => {
        const matched =
          q === ''
            ? [...entries]
            : entries.filter((e) => e.name.toLowerCase().includes(q) || (e.type ?? '').toLowerCase().includes(q));
        return {
          category,
          label: CATEGORY_LABEL[category],
          /*
           * HARDEST FIRST, SO THE GROUP'S OWN CLAIM IS THE FIRST ROW UNDER IT.
           *
           * Ascending was the first build and it filled every group with the
           * MR-0 starter gear and Zaw components — twelve rows of the least
           * interesting items in the game, under an answer announcing that the
           * group's hardest item needs MR 17 and no way to see it. A group that
           * states a maximum and then shows twelve minimums is arguing with
           * itself.
           */
          entries: matched.sort((a, b) => b.masteryReq - a.masteryReq || a.name.localeCompare(b.name)),
          hardest: matched.reduce((n, e) => Math.max(n, e.masteryReq), 0),
          deep: matched.filter((e) => e.maxRank !== 30).length,
        };
      })
      .filter((g) => g.entries.length > 0)
      .sort((a, b) => b.entries.length - a.entries.length || a.label.localeCompare(b.label));
  }, [db, query]);

  if (groups.length === 0) {
    return (
      <EmptyState
        title="Nothing matches that filter"
        detail={`No item in the catalog matches “${query.trim()}”. The filter searches the name and the class.`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {groups.map((g, i) => {
        const shown = g.entries.slice(0, CAP);
        return (
          <Disclosure
            key={g.category}
            depth={0}
            eyebrow={`${String(g.entries.length)} in the game`}
            summary={g.label}
            defaultOpen={i === 0}
            answer={
              <span className="flex flex-wrap items-baseline justify-end gap-2.5">
                {g.hardest > 0 ? (
                  <span className="numeric" style={{ color: 'var(--color-tenno-300)' }}>
                    hardest needs MR {g.hardest}
                  </span>
                ) : (
                  // A counted zero, in words. Three of the eleven groups —
                  // Sentinels, Archwing and the modular parts — carry no mastery
                  // requirement anywhere in them, and suppressing the clause left
                  // those three with an eyebrow, a name and an empty answer: a
                  // closed group that says nothing is the thing grouping was
                  // supposed to fix.
                  <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
                    none of these need mastery to use
                  </span>
                )}
                {/* Only where it is true. Fifty-four items in the whole game rank
                    past 30, so a group that holds none of them says nothing
                    rather than printing a zero down the screen. */}
                {g.deep > 0 && (
                  <span className="numeric" style={{ color: 'var(--color-signal-warn)' }}>
                    {g.deep} rank past 30
                  </span>
                )}
              </span>
            }
          >
            <div className="flex flex-col">
              {shown.map((e) => (
                <CatalogRow key={e.uniqueName} entry={e} />
              ))}
              <ListTail
                hidden={g.entries.length - shown.length}
                ordered="needing less mastery than these"
                reach="filter by name to reach one"
              />
            </div>
          </Disclosure>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

/**
 * EVERY ACCOUNT READOUT THIS PANEL DRAWS, AND WHAT WOULD FILL EACH ONE.
 *
 * This list is the per-row detail that the twelve em dashes used to carry, one
 * dash at a time, on the twelve rows of the first open gear type. It is a
 * module constant rather than a literal in the body because it is a fixed
 * statement about the panel, not about any render: every entry names a readout
 * that `ItemRow` actually draws when there IS an account — `RankCell`'s rank and
 * cap, the Forma count beside it, `RemainingCell`, and the five `FITTINGS`
 * glyphs — so nothing here is invented for the empty state.
 *
 * Order is the order those readouts appear on a row, left to right, so a reader
 * who has seen the panel with an account can map each line back to the column it
 * describes.
 */
const UNREAD_READOUTS: readonly Fact[] = [
  { label: 'Rank and cap', value: 'the rank on your own copy, and how far its Forma has lifted the ceiling' },
  { label: 'Forma', value: 'how many polarisations are in your copy' },
  { label: 'Still owed', value: 'the ranks, or the Forma, between your copy and its maximum' },
  { label: 'Reactor / catalyst', value: 'whether the mod capacity is doubled on your copy' },
  { label: 'Exilus adapter', value: 'whether the utility slot is open on your copy' },
  { label: 'Incarnon Genesis', value: 'whether a Genesis is installed on your copy' },
  { label: 'Arcane slot', value: 'whether the arcane slot is unlocked on your copy' },
  { label: 'Gilding', value: 'whether a modular weapon of yours has been gilded' },
  {
    label: 'Whether you own it',
    value: 'the catalog below is every item the game contains, owned or not — which of them are yours is an account fact',
  },
];

/**
 * The panel WITHOUT an account, and the ONE place the absence is stated.
 *
 * This used to be the whole panel: a centred empty state that replaced every
 * item in the game with an apology, and measured 244 characters on a 1500x940
 * window. The copy itself was the good part — it names the exact fields it is
 * waiting for, which is the house standard for a refusal — so the copy stays and
 * only its place changes. One sentence had to move with it: "there is nothing
 * here until Warframe has run once" was true when it replaced the panel and is a
 * lie above a catalog.
 *
 * THIS BANNER IS NOW THE WHOLE OF THE ABSENCE, AND THAT IS THE POINT.
 * ──────────────────────────────────────────────────────────────────
 * It used to declare a CONVENTION — "every dash is unread, not zero" — for the
 * twelve dashes the catalog rows below were printing. That was the wrong job:
 * the convention made each dash honest, and a reader still met a first screen of
 * twelve rows all terminating in a punctuation mark. The dashes are gone, so
 * this row states the absence itself instead of annotating a symbol: the summary
 * says the gear is unread, the answer NAMES which readouts, and the body lists
 * all nine of them with what fills each — the per-row detail, once, one press
 * down, instead of once per row in front of everybody.
 */
function AccountBanner() {
  const running = useAccount((s) => s.gameRunning);
  const gep = useAccount((s) => s.gep);

  const [title, detail] = !running
    ? ([
        'Showing every item in the game, your own gear unread',
        'Rank, Forma and reactors are read off your own gear, so those stay unread until Warframe has run once — the catalog below needs no account at all. After that every item is kept and the arsenal works with the game closed.',
      ] as const)
    : gep === 'connected'
      ? ([
          'Linked — waiting for your arsenal',
          'Your gear list arrives with the next update Warframe pushes — usually within a few seconds of loading into the Orbiter. Until then only the catalog below is measured.',
        ] as const)
      : ([
          'Linking to the game',
          'Establishing the game-events connection. This takes a few seconds after launch.',
        ] as const);

  return (
    <section
      className="mo-in-up shrink-0"
      style={{
        clipPath: CHAMFER,
        background: 'linear-gradient(168deg, oklch(0.17 0.03 80 / 0.55), oklch(0.12 0.02 70 / 0.6))',
        boxShadow: 'inset 2px 0 0 var(--color-orokin-500)',
      }}
    >
      <Disclosure
        summary={title}
        eyebrow="account"
        /*
         * THE ANSWER NAMES THE READOUTS, IT NO LONGER EXPLAINS A PUNCTUATION
         * MARK.
         *
         * This line used to read "every dash is unread, not zero". That was a
         * correct convention and it solved the wrong half of the problem: it
         * made each of the twelve dashes below honest without making there be
         * fewer of them, so the screen still read as a panel full of nothing.
         * The dashes are gone (see `CatalogRow`), so the convention has nothing
         * left to govern; what a reader needs instead is the one sentence the
         * twelve rows were collectively failing to say — WHICH figures are
         * missing. The nine of them are named in full one press below.
         *
         * Not a count. "9 unread" would tell the player nothing they can act on;
         * the names are what says whether the thing they came to look up is
         * among them.
         */
        answer="rank, forma and fittings unread"
        accent="var(--color-orokin-300)"
      >
        {/* The one refusal on a no-account screen, so it is set at reading size
            rather than at the caption size a footnote would get. */}
        <div className="text-[length:var(--text-body)] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          <Clamp lines={2}>{detail}</Clamp>
        </div>

        {/*
          THE PER-ROW DETAIL, ONCE, INSTEAD OF ONCE PER ROW.

          Every line here was previously implied by a dash on a catalog row and
          explained by nothing. Stating it in one place costs nine lines behind a
          press; stating it per row cost twelve dashes in front of one, on the
          first screen, before the reader had asked anything.

          `columns={1}` because the values are sentences: at the default of two
          the label and its sentence end up at opposite ends of a wide row and
          stop reading as a pair.
        */}
        <div className="mt-3">
          <p className="wf-note">
            What is read off your own gear, and so stays unread until Warframe has run once with RaijiFrame open:
          </p>
          <Facts columns={1} items={UNREAD_READOUTS} />
        </div>
      </Disclosure>
    </section>
  );
}

/**
 * The one item to take into the next mission, named.
 *
 * Its own component rather than a branch inside the panel, which is already
 * long enough that react-doctor counts its control flow: a conditional block
 * with a nested ternary inside the panel body pushed it over that line, and the
 * block does not read any panel state beyond the row it is handed.
 */
function LevelNext({ row }: { row: Row }) {
  const toCap = row.cap - row.rank;
  return (
    <div className="mt-4">
      <span className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
        Level this next
      </span>
      <div
        className="mt-1 truncate font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-lead)]"
        style={{ color: 'var(--color-orokin-200)' }}
      >
        {row.name}
      </div>
      <div className="mt-0.5 text-[length:var(--text-body)]" style={{ color: 'var(--text-muted)' }}>
        Rank {row.rank}/{row.cap} ·{' '}
        {/* Rank-40 items sit at their current cap with mastery still owed, which
            is RemainingCell's own "at cap but not finished" case - gated behind
            Forma rather than affinity, so the sentence has to change with it. */}
        {row.atCap
          ? `${Math.ceil((row.maxRank - row.cap) / 2)} forma to open more ranks`
          : `${toCap} rank${toCap === 1 ? '' : 's'} to cap`}
      </div>
    </div>
  );
}

/** A quiet headline figure. Small on purpose — the backlog is the loud one. */
function Figure({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="stat mt-1.5 text-[length:var(--text-lead)]" style={{ color: 'var(--text)' }}>
        {value}
      </div>
      {sub != null && (
        <div className="mt-1 max-w-[22ch] text-[length:var(--text-micro)] leading-snug" style={{ color: 'var(--text-muted)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

type View = 'all' | 'todo' | 'maxed' | 'bare';

export default function ArsenalPanel() {
  const inventory = useAccount((s) => s.inventory);
  const db = useItemDb();

  const [view, setView] = useState<View>('todo');
  const [query, setQuery] = useState('');

  // The inventory object identity only changes when the underlying bytes change,
  // so this recomputes exactly as often as it must and no more.
  const rows = useMemo(() => buildRows(inventory as RawAccount | null, db), [inventory, db]);
  const hasAccount = inventory !== null && rows.length > 0;

  /*
   * WHAT MOVED WHILE YOU WERE AWAY.
   * ————————————————————————————————————————————
   * `UI-SPEC.md:1308` makes the case in one line: "The game cannot do this; it
   * has no memory of your last login." This app keeps one generation of account
   * history now, so the owned count can be compared against the read before
   * this one and marked if it changed - the mark is a rule under the figure,
   * wiped away after a moment, and the figure itself never animates.
   *
   * `countTypes` returns null when there is no earlier read at all, and
   * `Counter` draws nothing for null: a first capture is not a change, and
   * saying it was would be a claim about a session that never happened.
   */
  const before = usePreviousAccount();
  const ownedBefore = useMemo(() => countTypes(before, EQUIPMENT_KEYS), [before]);

  const totals = useMemo(() => {
    let masterable = 0;
    let mastered = 0;
    let forma = 0;
    let reactors = 0;
    const present = new Set<EquipmentKey>();

    for (const r of rows) {
      present.add(r.key);
      if (r.masterable) masterable++;
      if (r.masterable && r.mastered) mastered++;
      forma += r.forma;
      if (r.reactor) reactors++;
    }

    return { masterable, mastered, forma, reactors, present };
  }, [rows]);

  /**
   * The named half of "still to level": the same order the tree sorts to, run
   * over every owned item rather than the current tab or search. `remaining`
   * below is computed off the unfiltered `rows` too, so switching to the Maxed
   * tab or typing a search must not make the count and the name it sits beside
   * disagree with each other.
   */
  const topPick = useMemo(
    () => rows.filter(isTodo).sort((a, b) => b.progress - a.progress || a.name.localeCompare(b.name))[0],
    [rows],
  );

  /** Text narrowing. The view tabs count against this, not the whole set. */
  const scoped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === '' ? rows : rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  const counts = useMemo(() => {
    let todo = 0;
    let maxed = 0;
    let bare = 0;
    for (const r of scoped) {
      if (isTodo(r)) todo++;
      if (r.mastered) maxed++;
      if (r.masterable && !r.reactor) bare++;
    }
    return { all: scoped.length, todo, maxed, bare };
  }, [scoped]);

  const visible = useMemo(
    () =>
      scoped.filter((r) => {
        if (view === 'todo') return isTodo(r);
        if (view === 'maxed') return r.mastered;
        if (view === 'bare') return r.masterable && !r.reactor;
        return true;
      }),
    [scoped, view],
  );

  const groupsPresent = EQUIPMENT_KEYS.filter((k) => totals.present.has(k));
  const remaining = totals.masterable - totals.mastered;

  return (
    /*
     * ONE SCREEN: A PINNED HEAD, ONE SCROLLING REFERENCE PANE, A PINNED FOOT.
     *
     * WHAT THIS REPLACED. The panel root was `flex h-full flex-col overflow-y-auto`
     * — the panel itself was the one scroller, and everything on it was a sibling
     * in one growing column. That measured as fitting, at 1.00 screens with
     * nothing read, and it fits by luck rather than by construction: open the
     * provenance fold, or land on an account with a hero and four gear types
     * expanded, and the head scrolls away along with the answer it carries.
     *
     * The shape is now the one the Platinum panel already proved. The head (the
     * refusal or the hero, the section title, the filter) and the foot (what the
     * panel cannot know) are pinned rows of a fixed-height grid; the TREE is
     * reference material — thousands of catalog rows, legitimately long — and it
     * scrolls inside its own pane. The page cannot scroll, so nothing the reader
     * is looking up can push what they are being told off the top of the screen.
     *
     * `min-h-0` is on every row of the chain, and leaving one out is the failure
     * that has no symptom: a grid child defaults to `min-height: auto` and
     * refuses to shrink below its content, so one omission anywhere and the whole
     * thing grows back to a scrolling column with nothing on screen saying so.
     * `minmax(0, 1fr)` is that same guarantee written into the track.
     */
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,auto)_minmax(9rem,1fr)_auto] gap-4 p-5">
      {/* ---- pinned head ----------------------------------------------------
          The state of the account and the controls that narrow the pane below.
          Its own flex column rather than three grid rows, because these three
          are one thing — "what you are looking at, and how to cut it" — and
          giving each its own track would let the grid stretch them apart. */}
      <div className="flex min-w-0 flex-col gap-4">
      {/* The refusal, and the one statement of which readouts are unread on this
          screen. Above the catalog rather than instead of it. */}
      {!hasAccount && <AccountBanner />}

      {/* ---- headline ------------------------------------------------------
          One bold element. The backlog is the whole question this panel answers,
          so it is the only figure set large; owned, forma and reactors are
          context and are set small beside it.

          EVERY FIGURE IN HERE IS AN ACCOUNT FACT, so the whole plate is absent
          without one rather than rendered at zero. "0 still to level" beside
          "0 forma spent" is not an empty state, it is a false one. */}
      {hasAccount && (
        /*
          THE HERO IS A PLATE WITH A Z AXIS, NOT A PAINTED RECTANGLE.

          `mo-field` puts the pointer field on the outer section, so every effect
          inside reads `--mxp/--myp/--mdx/--mdy` by inheritance and no child needs
          a handler of its own. `mo-tilt` uses the signed fractions to rotate the
          whole plate a few degrees toward the cursor - a real perspective, so the
          rim gradient and the fill move together and the plate reads as a
          physical object rather than as a picture of one. `mo-sheen` on the INNER
          div draws the light: the outer element is a 1px rim and would have lit
          only its own border.

          Both are hover-gated, which is what makes them exempt from the
          transform-only rule - a pointer cannot be over a window nobody is
          presenting, so the timeline is running by definition whenever either of
          them has a non-zero value.
        */
        <section
          className="mo-field mo-tilt anim-rise shrink-0"
          style={{ clipPath: CHAMFER, padding: 1, background: GOLD_RIM }}
        >
          <div
            className="mo-sheen flex flex-wrap items-center gap-x-12 gap-y-6 px-7 py-6"
            style={{ clipPath: CHAMFER, background: GOLD_FILL }}
          >
            <div className="min-w-[17rem] flex-1">
              <div className="flex items-center gap-2.5">
                <span aria-hidden className="size-[5px] rotate-45" style={{ background: 'var(--color-orokin-400)' }} />
                <span className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
                  Still to level
                </span>
              </div>

              <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span
                  className="stat leading-none"
                  style={{ fontSize: 'var(--text-hero)', color: 'var(--color-orokin-200)' }}
                >
                  <Counter value={remaining} />
                </span>
                <span className="text-[length:var(--text-body)]" style={{ color: 'var(--text-muted)' }}>
                  {remaining === 0
                    ? 'every owned item is finished'
                    : `owned item${remaining === 1 ? '' : 's'} still owe${remaining === 1 ? 's' : ''} mastery`}
                </span>
              </div>

              <Meter
                className="mt-4 max-w-[26rem]"
                value={totals.masterable > 0 ? totals.mastered / totals.masterable : 0}
                color="var(--color-orokin-400)"
                height={7}
                label={`${totals.mastered} of ${totals.masterable} mastered`}
              />

              {/* A count is not an instruction — it still leaves the player to open
                  the tree, land on the Todo tab and read the top row themselves.
                  `topPick` is that top row, so name it here instead of making them
                  go find it. Rendered only when it exists: `remaining === 0` and
                  `topPick === undefined` are the same condition (both come from
                  `isTodo`), so an empty backlog shows no instruction rather than
                  a stale or invented one. */}
              {topPick && <LevelNext row={topPick} />}
            </div>

            <div className="grid grid-cols-2 gap-x-9 gap-y-4 sm:grid-cols-3">
              {/* THE ONE PLACE THIS SENTENCE IS PRINTED. It used to appear here
                  and again sixty pixels below, in the answer of a filter fold
                  that no longer exists - the same string on screen twice, in
                  view of each other, permanently. */}
              <Figure
                label="Items owned"
                value={<Counter value={rows.length} was={ownedBefore} />}
                sub={`${groupsPresent.length} of ${EQUIPMENT_KEYS.length} gear types hold something`}
              />
              <Figure label="Forma spent" value={<Counter value={totals.forma} />} sub="across the arsenal" />
              <Figure
                label="Reactors / catalysts"
                value={<Counter value={totals.reactors} />}
                sub={`${Math.max(0, totals.masterable - totals.reactors)} masterable items still bare`}
              />
            </div>
          </div>
        </section>
      )}

      <header
        className="anim-rise flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-2"
        style={{ animationDelay: '110ms' }}
      >
        <h2
          className="font-[family-name:var(--font-title)] text-[length:var(--text-small)] tracking-[0.26em] uppercase"
          style={{ color: 'var(--color-orokin-300)' }}
        >
          {hasAccount ? 'The whole arsenal' : 'The item catalog'}
        </h2>
        <span
          aria-hidden
          className="h-px flex-1"
          style={{ background: 'var(--rule-hairline)' }}
        />
        <span className="eyebrow">
          {hasAccount ? 'grouped by gear type · actionable first' : 'grouped by gear type · game data, no account needed'}
        </span>
      </header>

      {/* ---- controls ------------------------------------------------------
          The gear-type chips are gone: a key cannot be both the grouping and a
          filter, and as a filter it foreclosed twenty-six types to answer about
          one. What is left is a text filter, which is not a grouping key, and
          the four views - which are not one either, since each of them cuts
          ACROSS every group. */}
      {/* `justify-end` rather than `justify-between` with a filler, and the
          filler is the point: the no-account build had an eyebrow here reading
          "every item in the game, whether you own it or not" — the banner's own
          title ninety pixels above, reworded. The same defect this rebuild
          exists to remove, reintroduced to balance a flex row. */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {hasAccount && (
          <Tabs
            className="mr-auto"
            value={view}
            onChange={(id) => {
              setView(id as View);
            }}
            items={[
              { id: 'todo', label: 'To level', badge: counts.todo },
              { id: 'all', label: 'All', badge: counts.all },
              { id: 'maxed', label: 'Mastered', badge: counts.maxed },
              { id: 'bare', label: 'No reactor', badge: counts.bare },
            ]}
          />
        )}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="Filter by name"
          aria-label="Filter the arsenal by item name"
          // `mo-focusable` only. An input cannot carry `mo-sheen` - the sheen is
          // drawn on ::after, and a replaced control does not render
          // pseudo-elements - so a sheen class here would be a class that does
          // nothing, which is worse than no class at all.
          className="mo-focusable select-text w-52 px-3 py-1.5 text-[length:var(--text-small)] outline-none"
          style={{
            clipPath: CLIP.button,
            background: 'oklch(0 0 0 / 0.35)',
            boxShadow: 'inset 0 0 0 1px var(--hairline)',
            color: 'var(--text)',
          }}
        />
      </div>
      </div>

      {/* ---- the tree ------------------------------------------------------
          SCROLL-DRIVEN, NOT CLOCK-DRIVEN, FROM HERE DOWN.

          `anim-rise` with a delay would be a time-based entrance on the one
          element that is usually BELOW the fold, which is the worst place for
          one: on a frozen document timeline it sits nine pixels low forever, and
          it fires whether or not anybody has scrolled to it. `mo-arrive` takes
          its progress from scroll POSITION, so the tree settles as it comes into
          view and there is no clock in it to stop. Where the browser has no
          scroll timelines the rule does nothing at all, which is the correct
          fallback: no entrance beats a time-based one.

          THE PANE, NOT THE PAGE, IS THE SCROLLER FROM HERE DOWN. This is the
          reference half of the panel — a gear type at a time, twelve rows deep,
          eleven or twenty-seven groups of them — and it is the only thing on
          this screen that is allowed to be longer than the window. The scroll
          lives on the outer div so `mo-arrive` keeps its own element: the
          entrance is a transform, and putting a transform on a scroll container
          makes it the containing block for everything inside it. */}
      <div className="min-h-0 overflow-y-auto pr-1">
      <div className="mo-arrive">
        {hasAccount ? (
          <ArsenalTree
            rows={visible}
            /* The unfiltered set, for the same reason the hero uses it: a group
               that counted only what the tab left it would be reporting the
               filter back to the reader as a measurement of their arsenal. */
            population={rows}
            empty={
              <div className="p-6">
                <EmptyState
                  title={query ? 'Nothing matches that filter' : 'Nothing in this view'}
                  detail={
                    view === 'todo'
                      ? 'Every owned item has paid all the mastery it can. Switch to All to see them.'
                      : 'Clear the name filter or pick another view.'
                  }
                />
              </div>
            }
          />
        ) : db === null ? (
          <EmptyState
            title="Loading the item catalog"
            detail="Fetching the item export. Until it lands, how many items the game contains is unknown — it is not zero."
          />
        ) : (
          <CatalogTree db={db} query={query} />
        )}
      </div>
      </div>

      {/* ---- provenance ----------------------------------------------------
          The panel says what it cannot know. A completionism tool that hides its
          blind spots is worse than one that names them - in the player's words,
          not the build's: no package names, no spec sections.

          Three caveats laid end to end under the tree is a strip of small grey
          text that a reader either scans past or has to parse in full, and two
          of the three only matter to someone who has already noticed a number
          they do not believe. So the strip is one row that states the one fact a
          reader acts on - how much of the catalog is known - with the caveats a
          press below it. Nothing is deleted; the detail is the honesty, and it
          moved one level down.

          PINNED, NOT TRAILING. It used to be the last sibling in the scrolling
          column, which meant the one row saying what the panel cannot know was
          the one row you had to scroll past a thousand catalog items to find.
          As the grid's third track it is always the bottom line of the screen,
          and opening it takes height from the pane above rather than from the
          window. `mo-arrive` is gone with the scroll it was reading: a
          scroll-driven entrance on an element that is permanently in view is a
          class that resolves to its end state and does nothing, which is worse
          than no class because it reads as motion that exists. */}
      <div className="min-w-0">
        <Disclosure
          eyebrow="What this panel cannot know"
          summary="Provenance"
          answer={
            db == null ? (
              <span style={{ color: 'var(--color-signal-warn)' }}>catalog still loading</span>
            ) : (
              <span>{db.byType.size.toLocaleString()} items known</span>
            )
          }
        >
          <p className="eyebrow">
            {/* The cut is stated per group rather than once for the panel: each
                gear type says how many rows it is holding back, which is the
                only place that number means anything now that the cap is per
                group instead of a single 200 shared across all 27 of them. */}
            each gear type lists {CAP} rows and counts the rest on its own line
          </p>
          {db == null ? (
            // Not "caps unknown": every item is actively being ranked against 30
            // while the catalog is out, and that is an assumption, not an absence.
            <p className="eyebrow">catalog still loading — every item ranked as if it stops at 30</p>
          ) : (
            db.missingCategories.length > 0 && (
              <p className="eyebrow" style={{ color: 'var(--color-signal-warn)' }}>
                {db.missingCategories.length} item categories could not be loaded — their caps are unknown, not 30
              </p>
            )
          )}
          {/*
            One level deeper, because it explains a figure the lines above do
            not: the rank printed on every owned row past 30 is derived. The
            working for any ONE item is on that item, three levels in; this is
            the claim that covers all of them.
          */}
          <Disclosure depth={1} summary="Ranks above 30" answer={<span>estimated</span>}>
            <p className="eyebrow leading-relaxed">
              Worked out from lifetime affinity. The game does not publish how Forma resets an item&rsquo;s affinity, so
              a rank past 30 is this app&rsquo;s arithmetic rather than a figure Warframe sent. Every owned row opens
              onto the arithmetic it used.
            </p>
          </Disclosure>
        </Disclosure>
      </div>
    </div>
  );
}
