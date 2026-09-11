/**
 * RESOURCES — every resource the game contains, and how much of each you hold.
 *
 * THE PANEL HAS TWO HALVES AND ONLY ONE OF THEM IS YOURS
 * ─────────────────────────────────────────────────────
 * WHICH resources exist, what they are called, what type they are, what they do
 * and what they look like is game data — `resourcedb.ts` fetches them (Resources.json plus the planet drops in Misc.json)
 * from the same WFCD export the item catalog uses. That half is worth reading
 * before Warframe has ever been launched, so it renders unconditionally.
 *
 * How many of each you are HOLDING is account state. Without an account that
 * half is simply absent: the vault tree and the rare-stock strip are omitted
 * rather than drawn empty, because an empty vault is a claim that you own
 * nothing, and every currency reads `—` rather than a zero.
 *
 * Two honesty problems shape the account half:
 *
 *   1. The item catalog cannot name a resource. `itemdb.parseWfcd` drops every
 *      non-masterable `Misc` row on purpose, so Orokin Cell and Rubedo are simply
 *      not in it. Rather than render blanks, names are derived from DE's own
 *      internal path — `.../MiscItems/OrokinCell` -> "Orokin Cell" — and the
 *      derivation is now openable on the row it produced rather than asserted in
 *      a footer nobody can check.
 *
 *   2. `MiscItems` only lists stacks the account actually holds, so a rare that is
 *      absent is genuinely zero, not unknown. That inference is what makes the
 *      "Rare stock" strip trustworthy — and it is the one inference this panel
 *      makes, stated out loud.
 *
 * TWO FLAT TABLES, AND WHAT WAS WRONG WITH THEM
 * ─────────────────────────────────────────────
 * This panel used to end in a pair of `DataTable`s — up to a hundred and twenty
 * sibling rows each, no nesting anywhere. The catalog row carried a name and a
 * type and nothing else, and the type was ALSO printed on the two hundred and
 * eighteen rows that share it. The vault row carried a name, a tier, a count and
 * the family it was filed under, and the family was likewise repeated down every
 * row of its own block.
 *
 * Both halves already had a grouping key and both spent it on HIDING things:
 * `family` on a tab strip and `tier` on a segmented control, so choosing Gems
 * meant not seeing anything else, and the shared 120-row cap was spent on
 * whichever family happened to sort first. A key used as an exclusive filter
 * answers one question and forecloses the rest; the same key used as structure
 * answers all of them at once.
 *
 * So the key becomes the group. Family (0) → one stack you hold (1) → what the
 * catalog knows about it (2) → where its name came from (3), and type (0) → one
 * resource in the game (1) → the same two levels under it. `--disc-depth` drives
 * the type size, so descending looks like descending, and every group carries an
 * aggregate: a closed group still tells the reader how many units are inside it,
 * how many are rare, and how many the catalog cannot name.
 *
 * Everything numeric comes from `inventoryTotals` in subsystems.ts; nothing here
 * re-reads the account bag directly.
 *
 * TWO SCREENS OF STACKING, AND SEVEN DASHES AT THE TOP OF THEM
 * ───────────────────────────────────────────────────────────
 * Measured in a real browser at 1280x720 with no account read — the cold-launch
 * state, which is what the owner actually sees: 1,297px of panel inside a 672px
 * viewport. 2.06 screens. The page scrolled, and what it scrolled past first was
 * a gold hero reading `—`, a platinum readout reading `—`, and five plates
 * reading `—`. Seven readouts, all saying the same thing, above a banner that
 * had already said it in a sentence.
 *
 * Two structural changes, both borrowed from the Platinum panel, which had the
 * same disease and the same cure:
 *
 *   1. THE PAGE NO LONGER SCROLLS. The root is a fixed-height grid — a pinned
 *      row for the headline state and one `minmax(0,1fr)` row for everything
 *      else — and the long things (the vault, the catalog) scroll INSIDE their
 *      own panes. `min-h-0` is on every row and column of that chain, because a
 *      grid child's default `min-height: auto` refuses to shrink below its
 *      content: one omission anywhere and the panel silently grows again with
 *      nothing on screen to say so.
 *
 *   2. THE WALLET IS ACCOUNT-ONLY. With nothing read, the hero and the five
 *      plates have no number between them, so they are not drawn. The banner —
 *      which is the ONE place this panel states the absence — names the seven
 *      denominations it would fill in, one click down. Nothing is lost: the
 *      labels that were on screen are still on screen one press away, and they
 *      now arrive with what each currency is FOR, which the plates only ever
 *      showed once they had a value to explain.
 *
 * The horizontal half of the same fix: the catalog used to be a full-width
 * column under everything else, so with an account the panel was a single narrow
 * stack with the right half of the window empty. The vault and the catalog are
 * now two panes side by side at xl, which is the width the measurement was taken
 * at.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useAccount } from '../../core/store';
import type { RawAccount } from '../../data/account';
import { loadResourceDb, type ResourceDb, type ResourceEntry } from '../../data/resourcedb';
import { inventoryTotals, type InventoryTotals } from '../../data/subsystems';
import { ItemArt } from '../../ui/ItemArt';
import { CLIP, Counter, EmptyState, Rarity } from '../../ui/orokin';
import { Facts, type Fact } from '../../ui/interact';
import { subscribeFocus } from '../../ui/navigation';
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { CHAMFER, PLATE_LIFT as PLATE } from '../../ui/geometry';
import { ListTail } from '../../ui/ListTail';

/* ------------------------------------------------------------------ naming */

/**
 * DE names that are not what the player calls them. Verified against
 * inventory-schema.md §2 — `PrimeBucks` really is Ducats and `SchismKey` really
 * is Aya, and getting those two backwards is a silent, plausible-looking bug.
 */
const ALIAS: Readonly<Record<string, string>> = {
  PrimeBucks: 'Ducats',
  SchismKey: 'Aya',
  KuvaBucks: 'Kuva',
  Alertium: 'Nitain Extract',
  FusionBundle: 'Endo Bundle',
  // Planet drops whose internal name is not the player's. Display names verified
  // against WFCD Misc.json, the same export the item catalog reads.
  Neurode: 'Neurodes',
  Nanospores: 'Nano Spores',
  NeuralSensor: 'Neural Sensors',
  OxiumAlloy: 'Oxium',
  ConcentratedGas: 'Hexenon',
  Morphic: 'Morphics',
};

/** `MiscItems` -> "Resources": the folder is the only grouping signal DE gives us. */
const FOLDER: Readonly<Record<string, string>> = {
  MiscItems: 'Resources',
  /*
   * DE HAS THREE FOLDERS FOR "A RESOURCE" AND TWO OF THEM DIFFER BY ONE LETTER.
   *
   * `/Items/MiscItems/` holds Ferrite, `/Gameplay/1999Wf/Resources/` holds the
   * Hex dog tags and `/Gameplay/Duviri/Resource/` holds Aggristone. Spaced out
   * of camel case the last two read "Resources" and "Resource", so seventeen
   * rows sat next to two hundred and seventeen wearing a label one character
   * different — which reads as our typo, not as DE's folder. They are the same
   * bucket and are named as one. Everything with a real origin — Deimos,
   * Solaris, Eidolon, Mechs, Railjack — keeps it, because that is a fact about
   * where the resource comes from rather than about how DE filed it.
   */
  Resource: 'Resources',
  Gems: 'Gems',
  Fish: 'Fish',
  Plants: 'Plants',
  Research: 'Research',
  Recipes: 'Blueprints',
  ShipDecorations: 'Decorations',
  Consumables: 'Gear',
};

/** `OrokinCell` -> `Orokin Cell`. Two passes so `MK1Braton` keeps its acronym. */
function spaceCamel(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

function displayName(itemType: string): string {
  const tail = itemType.slice(itemType.lastIndexOf('/') + 1);
  return ALIAS[tail] ?? spaceCamel(tail);
}

function familyOf(itemType: string): string {
  const parts = itemType.split('/').filter(Boolean);
  // Last segment is the item; the one before it is the folder DE filed it under.
  const folder = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  if (!folder) return 'Other';
  return FOLDER[folder] ?? spaceCamel(folder);
}

/* ------------------------------------------------------------------- tiers */

type Tier = 'common' | 'uncommon' | 'rare';

/**
 * The classic planetary drop table. This is a curated list, not catalog data —
 * everything outside it gets NO tier rather than a guessed one, which is why most
 * of a real vault carries no tier chip at all. A guessed rarity would be worse
 * than an absent one.
 *
 * Keys are the game's own ids (the tail of `/Lotus/Types/Items/MiscItems/...`),
 * every one checked against WFCD Misc.json. Six of them are not the player's
 * word — `Neurode`, `Nanospores`, `NeuralSensor`, `OxiumAlloy`, `ConcentratedGas`,
 * `Morphic` — and keying by the friendly spelling meant those six never matched.
 */
const TIER: Readonly<Record<string, Tier>> = {
  Ferrite: 'common',
  Nanospores: 'common',
  Salvage: 'common',
  AlloyPlate: 'common',
  PolymerBundle: 'common',
  Circuits: 'uncommon',
  Rubedo: 'uncommon',
  Plastids: 'uncommon',
  Cryotic: 'uncommon',
  OxiumAlloy: 'uncommon',
  ConcentratedGas: 'uncommon',
  OrokinCell: 'rare',
  NeuralSensor: 'rare',
  Neurode: 'rare',
  ControlModule: 'rare',
  Gallium: 'rare',
  Morphic: 'rare',
  Tellurium: 'rare',
  ArgonCrystal: 'rare',
  Alertium: 'rare',
};

const RARE_TAILS = Object.entries(TIER).flatMap(([tail, t]) => (t === 'rare' ? [tail] : []));

function tierOf(itemType: string): Tier | null {
  return TIER[itemType.slice(itemType.lastIndexOf('/') + 1)] ?? null;
}

/* -------------------------------------------------------------------- rows */

interface Stack {
  itemType: string;
  name: string;
  family: string;
  tier: Tier | null;
  count: number;
  /** Position in the count-descending order across the WHOLE vault. */
  rank: number;
}

interface Vault {
  totals: InventoryTotals;
  stacks: Stack[];
  totalUnits: number;
  /** Known rares, scarcest first, including the ones held at zero. */
  rares: Array<{ tail: string; name: string; count: number; share: number }>;
}

function buildVault(acc: RawAccount): Vault {
  // `top` is a slice bound; asking for everything is what makes this the full list.
  const totals = inventoryTotals(acc, Number.MAX_SAFE_INTEGER);
  const raw = totals.topResources; // already sorted count-descending

  const stacks: Stack[] = raw.map((s, i) => ({
    itemType: s.itemType,
    name: displayName(s.itemType),
    family: familyOf(s.itemType),
    tier: tierOf(s.itemType),
    count: s.count,
    rank: i,
  }));

  const totalUnits = stacks.reduce((n, s) => n + s.count, 0);

  const held = new Map(stacks.map((s) => [s.itemType.slice(s.itemType.lastIndexOf('/') + 1), s.count]));
  const rareCounts = RARE_TAILS.map((tail) => ({
    tail,
    name: ALIAS[tail] ?? spaceCamel(tail),
    count: held.get(tail) ?? 0,
  }));
  const rareMax = rareCounts.reduce((n, r) => Math.max(n, r.count), 0);

  return {
    totals,
    stacks,
    totalUnits,
    rares: rareCounts
      .map((r) => ({ ...r, share: rareMax > 0 ? r.count / rareMax : 0 }))
      .sort((a, b) => a.count - b.count || a.name.localeCompare(b.name)),
  };
}

/* ----------------------------------------------------------------- catalog */

/**
 * Fetch the resource catalog once per window.
 *
 * `null` means still in flight — which is NOT the same as "the catalog is
 * empty", so the two states render differently. `gentle` caches and revalidates,
 * so reopening the panel costs one 304.
 */
function useResourceDb(): ResourceDb | null {
  const [db, setDb] = useState<ResourceDb | null>(null);
  useEffect(() => {
    let alive = true;
    void loadResourceDb().then((d) => {
      if (alive) setDb(d);
    });
    return () => {
      alive = false;
    };
  }, []);
  return db;
}

/* ---------------------------------------------------------------- fragments */

/** Spreadsheet data-bar: one paint, no tween, so 300 of them cost nothing. */
function DataBar({ value, color }: { value: number; color: string }) {
  return (
    <span
      aria-hidden
      className="relative block h-[4px] w-20 overflow-hidden"
      style={{
        clipPath: CLIP.meter,
        background: 'linear-gradient(180deg, oklch(0 0 0 / 0.55), oklch(1 0 0 / 0.05))',
      }}
    >
      <span
        className="absolute inset-y-0 left-0 block"
        style={{
          width: `${Math.max(0, Math.min(1, value)) * 100}%`,
          background: `linear-gradient(90deg, color-mix(in oklab, ${color} 45%, transparent), ${color})`,
        }}
      />
    </span>
  );
}

/**
 * Rows a group shows before it says how many it is holding back.
 *
 * PER GROUP, NOT PER LIST, and that is most of the argument for grouping at all.
 * The two tables this replaced shared a 120-row cap across everything they held,
 * so a veteran asking about Gems was given the first hundred and twenty stacks
 * of Resources instead: the cap was spent by whichever family sorted first. A
 * cap inside a group can only ever hold back rows from the group you are
 * actually looking at, and what it holds back is stated on the spot.
 */
const CAP = 14;

/** A share as a percentage, or null when there is no denominator to divide by. */
function pct(part: number, whole: number): string | null {
  if (whole <= 0) return null;
  const v = (part / whole) * 100;
  return v < 0.1 ? '<0.1%' : `${v.toFixed(1)}%`;
}

/* ------------------------------------------------------------- the levels */

/**
 * Depth 3: the evidence behind the name on the row two levels above it.
 *
 * This file's header makes a claim — that a resource's name is DERIVED from DE's
 * internal path rather than looked up — and the old tables stated it once, in a
 * footer, where it applied to three hundred rows and could be checked against
 * none of them. It is a claim that is wrong per row without help: `Neurode`
 * spaces out to "Neurode" and the player's word is "Neurodes", which is why the
 * alias table exists at all.
 *
 * So the derivation is openable where it was applied. It names which of the two
 * rules produced this name, and — when the catalog carries the same item, which
 * is the only independent check available — whether the two agree.
 */
function Provenance({ itemType, catalogName }: { itemType: string; catalogName: string | null }) {
  const tail = itemType.slice(itemType.lastIndexOf('/') + 1);
  const alias = ALIAS[tail];
  const derived = displayName(itemType);
  return (
    <Disclosure
      depth={3}
      summary="Where this name came from"
      answer={
        <span
          style={{
            color:
              catalogName === null
                ? 'var(--text-ghost)'
                : catalogName === derived
                  ? 'var(--color-signal-good)'
                  : 'var(--color-signal-warn)',
          }}
        >
          {catalogName === null
            ? 'derived — nothing to check it against'
            : catalogName === derived
              ? 'the derivation matches the catalog'
              : 'the catalog spells it differently'}
        </span>
      }
    >
      <Facts
        /*
         * `columns={1}` WAS A 150px OVERHANG, and only once the catalog became a
         * pane rather than the full window.
         *
         * `Facts` sizes its tracks `minmax(MIN_PAIR_REM / columns, 1fr)`, and
         * MIN_PAIR_REM is 30rem — so asking for one column asks for a 480px
         * minimum track. This block sits three disclosures deep inside the
         * catalog pane, which at the 1280px width everything here is measured at
         * is 432px wide before the nesting indents take another hundred: a 480px
         * track in a ~330px box overhangs by roughly 150px, and because the pane
         * scrolls it would have paid for that with a sideways scrollbar rather
         * than an error.
         *
         * Two is not a layout change in the narrow case — `auto-fill` still
         * fits exactly one 240px track in 330px, so these read as one column
         * exactly as before — and it is what lets the same block use the room
         * when the panel is wide. The long value here is the game path, which
         * this component truncates either way.
         */
        columns={2}
        items={[
          { label: 'Game path', value: itemType },
          { label: 'Rule applied', value: alias === undefined ? 'spaced out of camel case' : 'hand-checked alias' },
          { label: 'Derived name', value: derived },
          // Absent for every classic planet drop, which is the whole reason the
          // derivation exists. Dropped rather than dashed — the answer above has
          // already said the catalog carries nothing for this one.
          { label: 'Catalog name', value: catalogName ?? '', when: catalogName !== null },
        ]}
      />
    </Disclosure>
  );
}

/**
 * Depth 2: what the catalog knows, under a row that has already said what you hold.
 *
 * Every field here already existed in the loaded catalog and none of it was
 * reachable: a table could show a name, a tier and a number, and the item's own
 * artwork, its in-game description and whether it can be traded sat in memory
 * unrendered. That gap — data present, UI dead — is the thing this whole pass is
 * about.
 *
 * `entry` is nullable on purpose. A held stack whose raw path is absent from the
 * catalog export is a real case (new items ship in the game before the export
 * catches up), and the honest response is to show the little that IS known
 * rather than to invent the rest.
 *
 * `facts` comes from the CALLER because only the caller knows which of these
 * numbers its own row already printed. A detail that always listed the category,
 * the tier and the count reprinted the row directly under the row you had just
 * clicked, so five facts appeared of which two were new.
 */
function ResourceDetail({
  entry,
  itemType,
  facts,
}: {
  entry: ResourceEntry | null;
  itemType: string;
  facts: readonly Fact[];
}) {
  return (
    <Disclosure
      depth={2}
      summary="What it is"
      answer={
        entry === null ? (
          <span style={{ color: 'var(--text-ghost)' }}>not in the resource catalog</span>
        ) : (
          <span style={{ color: entry.tradable ? 'var(--color-tenno-300)' : 'var(--text-faint)' }}>
            {entry.tradable ? 'tradable' : 'not tradable'}
          </span>
        )
      }
    >
      {/* The raw path is the only stable identity a resource has, but it is not
          prose: it lives on the title so it is still copyable from a hover, and
          spelled out properly one level further down. */}
      <div className="flex gap-4" title={itemType}>
        {/* Full-size art, which the row itself has no room for. */}
        <ItemArt imageName={entry?.imageName ?? undefined} name={entry?.name ?? itemType} owned={null} size={64} plain />

        <div className="min-w-0 flex-1">
          {/* The in-game blurb runs to five lines on some gems. Clamped, so the
              facts under it are not pushed off the fold by prose the reader may
              not want; `-webkit-line-clamp` is layout, not animation, so a frozen
              timeline cannot affect it. */}
          {entry?.description != null && (
            <div
              className="mb-2.5 max-w-[62ch] text-[length:var(--text-small)] leading-relaxed"
              style={{ color: 'var(--text-muted)' }}
            >
              <Clamp lines={2}>{entry.description}</Clamp>
            </div>
          )}

          <Facts items={facts} />

          <div className="mt-2.5">
            <Provenance itemType={itemType} catalogName={entry?.name ?? null} />
          </div>
        </div>
      </div>
    </Disclosure>
  );
}

/**
 * Depth 1: one stack you hold.
 *
 * NO FAMILY ON THIS ROW. The row sits inside its own family's group, so printing
 * "Resources" on all two hundred and eighteen of them is the grouping key
 * rendered once per row — exactly the shape grouping replaces, and exactly what
 * the vault table's Group column was.
 *
 * The bar is scaled to the largest stack IN THIS GROUP rather than in the vault.
 * Vault-wide, every gem and every fish is a sliver against Ferrite and the bar
 * says nothing; inside its own group it separates the stack you have thousands
 * of from the one you have four of, which is the comparison a reader opening
 * "Gems" is making. The scale is stated once, in the footer under the tree.
 */
function StackRow({
  stack,
  entry,
  groupMax,
  groupUnits,
  vaultUnits,
  vaultStacks,
}: {
  stack: Stack;
  entry: ResourceEntry | null;
  groupMax: number;
  groupUnits: number;
  vaultUnits: number;
  vaultStacks: number;
}) {
  const inGroup = pct(stack.count, groupUnits);
  const ofVault = pct(stack.count, vaultUnits);
  return (
    <Disclosure
      depth={1}
      summary={
        <span className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span className="font-[family-name:var(--font-display)]" style={{ color: 'var(--text)' }}>
            {stack.name}
          </span>
          {/* Tier is a fact about the row, not the key it is filed under, so it
              belongs here. Most stacks carry none and simply show nothing — the
              reason is given once, in the footer, rather than as a dash on every
              row that would read as "no rarity" instead of "not classified". */}
          {stack.tier !== null && <Rarity tier={stack.tier} />}
        </span>
      }
      answer={
        <span className="flex items-center justify-end gap-2.5">
          <DataBar value={groupMax > 0 ? stack.count / groupMax : 0} color="var(--color-void-400)" />
          <span className="numeric tabular-nums" style={{ color: 'var(--text)' }}>
            {stack.count.toLocaleString()}
          </span>
          {/*
            "overall" IS LOAD-BEARING. The rank is across the whole vault, not
            within this group, so a group of nine can hold #7, #9 and #12 and the
            gaps are other families' stacks sitting between them. Written as
            "#9 of 13" beside a group eyebrow reading "9 stacks" it read as a
            rank inside the group and the arithmetic looked broken.
          */}
          <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
            #{stack.rank + 1} of {vaultStacks} overall
          </span>
        </span>
      }
    >
      <ResourceDetail
        entry={entry}
        itemType={stack.itemType}
        facts={[
          // The catalog's own word for the kind of thing this is. It is NOT the
          // family above — DE files Hexenon under `MiscItems` and WFCD types it
          // `Resource` — so this is new information rather than the group again.
          { label: 'Category', value: entry?.type ?? '', when: entry?.type != null },
          { label: 'Share of this group', value: inGroup ?? '', when: inGroup !== null },
          { label: 'Share of everything you hold', value: ofVault ?? '', when: ofVault !== null },
        ]}
      />
    </Disclosure>
  );
}

/**
 * Depth 1: one resource the game contains.
 *
 * NO TYPE ON THIS ROW, for the same reason the stack row carries no family: the
 * row is inside its type's group. The old catalog row carried a name and a type
 * and the type was constant down two hundred and eighteen consecutive rows, so
 * the row carried ONE fact.
 *
 * `held` is `null` when there is no account to read, and that is not zero. It is
 * the one absent value on this screen and the banner at the top of the panel
 * states it once for the whole panel; repeating it on three hundred and
 * fifty-three rows would say nothing the reader has not already been told.
 */
function CatalogRow({ entry, held }: { entry: ResourceEntry; held: number | null }) {
  return (
    <Disclosure
      depth={1}
      /*
       * NO ARTWORK ON THIS LINE, AND THE REASON IS THE MARKUP.
       *
       * The old table put a 32px `ItemArt` in the name cell and it was worth
       * having. A summary is a `<button>`, though, and `ItemArt`'s root is a
       * `<div>` — flow content inside a control whose content model is phrasing
       * content only. Every other summary in this app is spans the whole way
       * down. The tile moves one level in instead, at 64px, where the body is a
       * div and can hold one; the ownership state it used to carry visually is
       * the first thing the answer says in words.
       */
      summary={
        <span className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span className="min-w-0 truncate font-[family-name:var(--font-display)]" style={{ color: 'var(--text)' }}>
            {entry.name}
          </span>
          {/*
            WHERE IT COMES FROM, WHICH IS NOT THE GROUP.

            Measured across the live export: the `Gem` group's 44 rows split
            16/14/14 across Eidolon, Deimos and Solaris, and the `Resource`
            group's 218 spread over eight folders. So the folder DE files an
            item under varies inside a type and is the one thing a player
            actually wants from a gem — which of the three open worlds it is
            from. `Plant` and `Misc` are single-folder and this reads as
            constant there; a fact that varies where it can is still worth more
            than the type printed a second time.
          */}
          <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
            {familyOf(entry.uniqueName)}
          </span>
        </span>
      }
      answer={
        <span className="flex flex-wrap items-baseline justify-end gap-2.5">
          {/*
            A HELD COUNT, OR NOTHING — AND NOT THE WORDS "none held".

            The first build printed "none held" on every stack the account does
            not carry, which on a real read was two hundred and twelve of the two
            hundred and eighteen rows in this one group: a phrase repeated down
            the whole screen, which is a constant rather than a fact, and it
            crowded out the six rows where the number is the point.

            Silence here is not the ambiguity it looks like. The group's own
            answer says "6 of 218 in your vault" whenever there IS a vault and
            says nothing at all when there is not, so which of the two silences
            this is has already been settled one level up — once, rather than
            once per row.
          */}
          {held !== null && held > 0 && (
            <span className="numeric tabular-nums" style={{ color: 'var(--color-tenno-300)' }}>
              {held.toLocaleString()} held
            </span>
          )}
          {/*
            ONLY WHEN IT IS TRUE, and that is not the panel hiding a negative.

            Ten of the three hundred and fifty-three resources in the export
            trade. Printing "not tradable" on the other three hundred and
            forty-three is a constant down the screen wearing the costume of a
            fact — the same defect as a relic row that says "6 rewards" when
            every relic has six. The full statement, positive or negative, is
            the answer on the detail one level down, where it is about the one
            item the reader actually asked about.
          */}
          {entry.tradable && (
            <span className="eyebrow" style={{ color: 'var(--color-tenno-300)' }}>
              tradable
            </span>
          )}
          {entry.description !== null && (
            <span className="max-w-[34ch] truncate" style={{ color: 'var(--text-muted)' }}>
              {entry.description}
            </span>
          )}
        </span>
      }
    >
      {/* No facts passed: this row's own answer already prints the held count and
          whether it trades, and the group above it prints the type. Everything
          the detail could add is already on screen, so it adds nothing. */}
      <ResourceDetail entry={entry} itemType={entry.uniqueName} facts={[]} />
    </Disclosure>
  );
}

/**
 * Depth 0: one family of the vault, carrying its own aggregate.
 *
 * The aggregate is the reason a closed group is worth having. "Gems · 12 stacks"
 * is a table of contents; "Gems · 12 stacks · 4,180 units · 2 not in the catalog"
 * is an answer, and a reader who never opens anything has still been told which
 * families they are deep in and where the catalog has fallen behind the game.
 */
function VaultTree({ vault, catalog, query }: { vault: Vault; catalog: ResourceDb | null; query: string }) {
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const matched =
      q === ''
        ? vault.stacks
        : vault.stacks.filter((s) => s.name.toLowerCase().includes(q) || s.itemType.toLowerCase().includes(q));

    const by = new Map<string, Stack[]>();
    for (const s of matched) {
      const list = by.get(s.family);
      if (list === undefined) by.set(s.family, [s]);
      else list.push(s);
    }
    // Biggest first: the family holding most of your material is the one the
    // panel should open on, and alphabetical order put "Blueprints" there.
    return [...by.entries()]
      .map(([family, stacks]) => ({
        family,
        stacks,
        units: stacks.reduce((n, s) => n + s.count, 0),
        max: stacks.reduce((n, s) => Math.max(n, s.count), 0),
        rare: stacks.filter((s) => s.tier === 'rare').length,
      }))
      .sort((a, b) => b.units - a.units || a.family.localeCompare(b.family));
  }, [vault, q]);

  if (groups.length === 0) {
    return (
      <EmptyState
        /*
         * An empty tree has two possible causes now, down from four: the tier
         * control and the family tabs were both filters, and each of them could
         * empty the table in a way that looked exactly like a failed account
         * read. Only the text filter can do that any more.
         */
        title={q === '' ? 'No resources in this account read' : 'Nothing matches that filter'}
        detail={
          q === ''
            ? 'The account carries no resource stacks yet. Resources appear the moment the game pushes an inventory that contains them.'
            : `No held resource matches “${query.trim()}”. The filter searches the name and the game's own path.`
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {groups.map((g, i) => {
        /*
         * UNKNOWABLE UNTIL THE CATALOG LANDS, so it is not counted until then.
         * `catalog.byType.has` over a null catalog would report every stack as
         * missing from it, which is a confident and completely wrong number
         * dressed as a measurement. The catalog section below is the one place
         * that says the catalog has not arrived.
         */
        const unnamed =
          catalog === null || catalog.failed ? null : g.stacks.filter((s) => !catalog.byType.has(s.itemType)).length;
        const shown = g.stacks.slice(0, CAP);
        return (
          <Disclosure
            key={g.family}
            depth={0}
            eyebrow={`${String(g.stacks.length)} stacks`}
            summary={g.family}
            defaultOpen={i === 0}
            answer={
              <span className="flex flex-wrap items-baseline justify-end gap-2.5">
                <span className="numeric tabular-nums" style={{ color: 'var(--color-void-200)' }}>
                  {g.units.toLocaleString()} units
                </span>
                {g.rare > 0 && (
                  <span className="numeric" style={{ color: 'var(--color-signal-rare)' }}>
                    {g.rare} rare
                  </span>
                )}
                {unnamed !== null && unnamed > 0 && (
                  <span className="eyebrow" style={{ color: 'var(--text-ghost)' }}>
                    {unnamed} not in the catalog
                  </span>
                )}
              </span>
            }
          >
            <div className="flex flex-col">
              {shown.map((s) => (
                <StackRow
                  key={s.itemType}
                  stack={s}
                  entry={catalog?.byType.get(s.itemType) ?? null}
                  groupMax={g.max}
                  groupUnits={g.units}
                  vaultUnits={vault.totalUnits}
                  vaultStacks={vault.stacks.length}
                />
              ))}
              {g.stacks.length > shown.length && (
                <p className="eyebrow px-3 py-2" style={{ color: 'var(--text-faint)' }}>
                  {g.stacks.length - shown.length} smaller {g.family.toLowerCase()} stacks below these — filter by name
                  to reach one
                </p>
              )}
            </div>
          </Disclosure>
        );
      })}
    </div>
  );
}

/**
 * Depth 0: one type of resource, as the catalog files it.
 *
 * A type the catalog does not give becomes ONE group that says so, rather than
 * an em-dash on every row that has none. That is the same trade the tier chip
 * makes on the stack row: an absence stated once where it can be explained beats
 * the same absence repeated where it reads as a zero.
 */
function CatalogTree({
  rows,
  vault,
  query,
}: {
  rows: readonly ResourceEntry[];
  /** Null when there is no account. Held counts are then not shown at all. */
  vault: Vault | null;
  query: string;
}) {
  const held = useMemo(
    () => (vault === null ? null : new Map(vault.stacks.map((s) => [s.itemType, s.count]))),
    [vault],
  );

  const groups = useMemo(() => {
    const by = new Map<string, ResourceEntry[]>();
    for (const e of rows) {
      // The empty string is not a type; it is the bucket for rows the catalog
      // gave no type at all, and the group's own summary says which it is.
      const key = e.type ?? '';
      const list = by.get(key);
      if (list === undefined) by.set(key, [e]);
      else list.push(e);
    }
    return [...by.entries()]
      .map(([type, entries]) => ({
        type,
        entries,
        tradable: entries.filter((e) => e.tradable).length,
      }))
      .sort((a, b) => b.entries.length - a.entries.length || a.type.localeCompare(b.type));
  }, [rows]);

  if (groups.length === 0) {
    return (
      <EmptyState
        title="Nothing matches that filter"
        detail={`No resource in the catalog matches “${query.trim()}”. The filter searches the name and the type.`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {groups.map((g, i) => {
        const mine = held === null ? null : g.entries.filter((e) => (held.get(e.uniqueName) ?? 0) > 0).length;
        const shown = g.entries.slice(0, CAP);
        return (
          <Disclosure
            key={g.type === '' ? '(untyped)' : g.type}
            depth={0}
            eyebrow={`${String(g.entries.length)} resources`}
            summary={g.type === '' ? 'Type not given' : g.type}
            defaultOpen={i === 0}
            answer={
              <span className="flex flex-wrap items-baseline justify-end gap-2.5">
                {g.type === '' && (
                  <span className="eyebrow" style={{ color: 'var(--text-ghost)' }}>
                    the export carries no type for these
                  </span>
                )}
                {mine !== null && (
                  <span className="numeric tabular-nums" style={{ color: 'var(--color-tenno-300)' }}>
                    {mine} of {g.entries.length} in your vault
                  </span>
                )}
                {/* A counted zero, not an unmeasured one — every entry in this
                    group was read and none of them trades. Said in words rather
                    than as "0 tradable", which is the shape an absent number
                    wears and would teach the reader to distrust the ones beside
                    it. */}
                {g.tradable === 0 ? (
                  <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
                    none of these trade
                  </span>
                ) : (
                  <span className="numeric tabular-nums" style={{ color: 'var(--color-tenno-300)' }}>
                    {g.tradable} tradable
                  </span>
                )}
              </span>
            }
          >
            <div className="flex flex-col">
              {shown.map((e) => (
                <CatalogRow
                  key={e.uniqueName}
                  entry={e}
                  /*
                   * Two distinct states, kept apart. With no vault the count is
                   * UNMEASURED and the row prints nothing. With a vault, absence
                   * is genuinely zero — the game only lists stacks you actually
                   * hold — and the row says "none held".
                   */
                  held={held === null ? null : (held.get(e.uniqueName) ?? 0)}
                />
              ))}
              <ListTail
                hidden={g.entries.length - shown.length}
                ordered="alphabetically after these"
                reach="filter by name to reach one"
              />
            </div>
          </Disclosure>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ chrome */

/** The one filter control, used by both trees. */
function Filter({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder: string;
}) {
  return (
    <label className="relative block" style={{ clipPath: CLIP.button, padding: 1, background: 'var(--hairline-strong)' }}>
      <span className="sr-only">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="w-56 bg-transparent px-3 py-1.5 text-[length:var(--text-small)] outline-none placeholder:opacity-45"
        style={{ clipPath: CLIP.button, background: 'oklch(0.08 0.02 275)', color: 'var(--text)' }}
      />
    </label>
  );
}

function SectionTitle({ children, count, note }: { children: string; count?: string; note?: string }) {
  return (
    /*
     * WRAPS, BECAUSE THIS IS NO LONGER A FULL-WIDTH ROW.
     *
     * Four items with no wrap: a wide-tracked title, a count, a hairline that
     * takes the slack, and a note. That is fine across a 1,016px column and it
     * is not fine in the 432px catalog pane this panel now uses, where
     * "Resource catalog" + "353 in the game" + "game data — no account needed"
     * measure past the pane and walk out of it. A no-wrap flex row is one of
     * the three ways this app has produced sideways overflow, and it is the
     * invisible one: `overflow-y-auto` on the pane turns the overhang into a
     * horizontal scrollbar rather than into anything that looks like a fault.
     */
    <header className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2
        className="font-[family-name:var(--font-title)] text-[length:var(--text-small)] tracking-[0.26em] uppercase"
        style={{ color: 'var(--color-orokin-300)' }}
      >
        {children}
      </h2>
      {count !== undefined && (
        <span className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--text-faint)' }}>
          {count}
        </span>
      )}
      <span
        aria-hidden
        className="h-px flex-1"
        style={{ background: 'var(--rule-hairline)' }}
      />
      {note !== undefined && <span className="eyebrow">{note}</span>}
    </header>
  );
}

/** A tinted denomination mark. The chamfer comes from the clip, never a border. */
function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="px-2 py-[3px] text-[length:var(--text-nano)] font-semibold tracking-[0.2em] uppercase"
      style={{
        clipPath: CLIP.button,
        color,
        background: `linear-gradient(180deg, color-mix(in oklab, ${color} 24%, transparent), color-mix(in oklab, ${color} 8%, transparent))`,
      }}
    >
      {label}
    </span>
  );
}

/**
 * The single bold element on the panel.
 *
 * Credits are the one currency every other number here eventually converts into,
 * so they get the hero and nothing else does. The previous version gave three
 * currencies an `EnergyField` each — a drifting bloom behind the digits, with a
 * third of the card left empty "because it is the light". Three lens flares in a
 * row read as decoration, and decoration is not hierarchy.
 */
function CreditHero({
  value,
  platinum,
  tradable,
  hasAccount,
}: {
  value: number | null;
  platinum: number | null;
  tradable: number | null;
  hasAccount: boolean;
}) {
  // "Missing from what the game sent" and "the game sent nothing" are different
  // facts and the copy has to keep them apart. Both render `—`, never a zero.
  const absent = hasAccount ? 'not in this account read' : 'needs your account';
  return (
    /*
     * THE SECOND PANEL TO WEAR THE FRAME (UI-SPEC §2.0, Wave 2), by the recipe
     * the reset hero proved and an adversarial review vetted: the rim and fill
     * this plate always had pass through as `--frame-edge` / `--frame-fill`,
     * `--notch` keeps the app's 10px cut, and the frame adds what the hand
     * version could not - the compensated inner notch and the second hairline
     * at 56%. Cut direction is the research's measured rule: pointing away
     * from screen centre, so top-left / bottom-right in the content column.
     *
     * Of the four gold heroes, this and the reset plate render without an
     * account. Arsenal's and Foundry's are account-only, and an adoption
     * nobody can photograph is the unwatched change this rule forbids; they
     * follow when a real capture exists, not an invented one.
     */
    <section
      className="wf-frame mo-field mo-tilt mo-sheen mo-in-settle relative isolate"
      style={
        {
          '--notch': 'var(--cut-base)',
          '--frame-edge': 'var(--plate-gold-rim)',
          '--frame-fill': 'var(--plate-gold-fill)',
        } as CSSProperties
      }
    >
      <div className="wf-fill relative flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-7 py-6">
        <div className="wf-hairline" aria-hidden />
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="size-[5px] rotate-45" style={{ background: 'var(--color-orokin-400)' }} />
            <span className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
              Credits
            </span>
            <Chip label="CR" color="var(--color-orokin-300)" />
          </div>
          {value == null ? (
            <div className="stat mt-3 text-[length:var(--text-hero)] leading-none" style={{ color: 'var(--text-faint)' }}>
              —
            </div>
          ) : (
            <Counter
              value={value}
              className="stat mt-3 block text-[length:var(--text-hero)] leading-none"
              style={{ color: 'var(--color-orokin-200)' }}
            />
          )}
          {/* Body copy at the BODY step. This is the sentence that explains the
              largest number on the panel, and it was set two steps below it in
              the caption size everything else here wears. */}
          <p className="mt-2.5 text-[length:var(--text-body)]" style={{ color: 'var(--text-muted)' }}>
            {value != null
              ? 'Liquid. Spent on everything the foundry builds.'
              : hasAccount
                ? 'Your credit balance was not in what the game sent.'
                : 'Your balance is read out of the running game. Nothing is assumed until it arrives.'}
          </p>
        </div>

        <div className="text-right">
          <div className="eyebrow">Platinum</div>
          <div className="numeric mt-1.5 text-[length:var(--text-title)] leading-none" style={{ color: 'var(--color-tenno-300)' }}>
            {platinum == null ? '—' : platinum.toLocaleString()}
          </div>
          <div className="mt-1.5 text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
            {platinum == null
              ? absent
              : tradable == null
                ? 'tradable split unknown'
                : `${tradable.toLocaleString()} tradable · ${(platinum - tradable).toLocaleString()} gifted`}
          </div>
        </div>
      </div>
    </section>
  );
}

/** A quiet denomination readout. Small on purpose — the hero carries the weight. */
function Token({
  label,
  value,
  color,
  sub,
  index,
}: {
  label: string;
  value: number | null;
  color: string;
  sub: string;
  index: number;
}) {
  return (
    <div
      className="rf-plate mo-field mo-sheen mo-lift mo-in-up px-4 py-3"
      style={{ '--i': index, clipPath: CHAMFER, background: PLATE } as React.CSSProperties}
    >
      <div className="eyebrow">{label}</div>
      <div
        className="numeric mt-1.5 text-[length:var(--text-lead)] leading-none"
        style={{ color: value == null ? 'var(--text-faint)' : color }}
      >
        {value == null ? '—' : value.toLocaleString()}
      </div>
      {/*
        THE SUB-LINE IS FOR A VALUE, NOT FOR ITS ABSENCE.
        ————————————————————————————————————————————
        Five of these plates sit in one row, and each printed its own refusal —
        "needs your account", five times, directly under a banner that had
        already said the stocks were unmeasured. That is six statements of one
        fact inside 300px, and it is precisely the shape the rest of this
        rebuild removed: absence stated once, per screen, not once per field.

        A plate with no value now shows the dash and nothing else. The dash is
        governed by the banner's convention line, the same way `FocusPanel` and
        `ArsenalPanel` govern theirs, and the plate keeps its sub-line for the
        case it was written for — explaining a number that is actually there.
      */}
      {value != null && (
        <div className="mt-1.5 text-[length:var(--text-nano)] leading-snug" style={{ color: 'var(--text-muted)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/**
 * The five minor denominations, in the order the plates print them.
 *
 * ONE LIST, TWO READERS, AND THAT IS WHY IT IS A LIST.
 * ────────────────────────────────────────────────────
 * The plates print these when there are numbers to print. The cold-launch
 * banner NAMES them, because with nothing read the plates are not drawn at all
 * and the labels would otherwise be information this panel used to show and
 * stopped showing. Written out twice, the band could fall silently out of step
 * with the row it is standing in for — a currency added to one and not the
 * other, with nothing to catch it. Written once, it cannot.
 *
 * `read` is the accessor rather than a key so the null stays a null: every
 * field on `InventoryTotals` is `number | null` at source and there is no
 * `?? 0` anywhere on this path.
 */
const TOKENS: ReadonlyArray<{
  label: string;
  /** What the currency is FOR. One phrase, not a sentence. */
  sub: string;
  color: string;
  read: (t: InventoryTotals) => number | null;
}> = [
  { label: 'Endo', sub: 'mod fusion', color: 'var(--color-signal-warn)', read: (t) => t.endo },
  { label: 'Ducats', sub: "Baro's currency", color: 'var(--color-orokin-300)', read: (t) => t.ducats },
  { label: 'Aya', sub: 'relic packs', color: 'var(--color-tenno-300)', read: (t) => t.aya },
  { label: 'Regal Aya', sub: 'premium relics', color: 'var(--color-signal-rare)', read: (t) => t.regalAya },
  { label: 'Dirac', sub: 'railjack upgrades', color: 'var(--color-tenno-200)', read: (t) => t.dirac },
];

/**
 * The two the hero carries, named here so the banner can list all seven in one
 * place. They are not in `TOKENS` because they are not plates — credits get the
 * hero and platinum gets the corner of it.
 */
const HERO_CURRENCIES: ReadonlyArray<{ label: string; sub: string }> = [
  { label: 'Credits', sub: 'everything the foundry builds' },
  { label: 'Platinum', sub: 'trade, and the tradable share of it' },
];

/* --------------------------------------------------------------- no account */

/**
 * The panel WITHOUT an account, and the ONE place the absence is stated.
 *
 * This used to be the whole panel: a centred empty state that replaced every
 * resource in the game with an apology. The catalog below needs no account at
 * all, so only the stock half is unmeasured and only the stock half says so —
 * here, once, rather than as a blank column on three hundred and fifty-three
 * catalog rows.
 */
function AccountBanner() {
  const running = useAccount((s) => s.gameRunning);
  const gep = useAccount((s) => s.gep);

  const [title, detail] = !running
    ? ([
        'Showing the catalog, your stocks unmeasured',
        'Every resource the game contains is listed below with its type, description and artwork — that is game data. How much of each you hold is not: RaijiFrame reads your vault out of the running game. Launch Warframe once and every stack fills in here.',
      ] as const)
    : gep === 'connected'
      ? ([
          'Linked — waiting for your account',
          'Your account arrives with the next update the game pushes. Your stacks fill in then.',
        ] as const)
      : ([
          'Linking to the game',
          'Establishing the game-events connection. This usually takes a few seconds after launch.',
        ] as const);

  return (
    <section
      className="mo-in-up"
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
         * THE ANSWER NAMES WHAT IS BEHIND THE ROW, NOT WHAT THE ROW DOES.
         *
         * It read "what would change it", which describes the body rather than
         * reporting anything — and this row is now standing in for seven
         * readouts that used to be drawn as seven em-dashes. A closed
         * disclosure hiding a control or a fact has to say what it is hiding,
         * or the reader cannot know it is there. The count is derived from the
         * two lists below rather than typed, so it cannot go stale.
         */
        answer={`${String(HERO_CURRENCIES.length + TOKENS.length)} currency readouts waiting`}
        accent="var(--color-orokin-300)"
      >
        {/* The one refusal on a no-account screen, so it is set at reading size
            rather than at the caption size a footnote would get. */}
        <div className="wf-prose" style={{ color: 'var(--text-muted)' }}>
          <Clamp lines={2}>{detail}</Clamp>
        </div>

        {/*
          THE SEVEN LABELS, WHICH WERE THE ONLY THING THE DASHES CARRIED.
          ————————————————————————————————————————————
          Measured cold at 1280x720: a gold hero reading `—`, a platinum corner
          reading `—`, and five plates reading `—`. Seven readouts, 300px of
          screen, and between them exactly one fact — that nothing has been read
          — which the sentence above this already states in words. So the plates
          are not drawn without an account and their labels move here, where
          they are one press from the row that explains why they are empty.

          Nothing is lost and something is gained: a plate only prints what a
          currency is FOR once it has a value to explain, so with nothing read
          "Dirac" used to appear with no indication of what Dirac is.
        */}
        <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
          {[...HERO_CURRENCIES, ...TOKENS].map((c) => (
            <div key={c.label} className="flex min-w-0 items-baseline gap-2">
              <dt className="shrink-0 text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
                {c.label}
              </dt>
              <dd className="eyebrow min-w-0 truncate">{c.sub}</dd>
            </div>
          ))}
        </dl>
      </Disclosure>
    </section>
  );
}

/* ------------------------------------------------------- the account half */

/**
 * Everything that needs an account, in one place.
 *
 * It takes a non-null `Vault`, which is the whole point: inside here there is no
 * absent field to accidentally render as a zero, and the filter state lives with
 * the tree it filters instead of in the panel above.
 */
function VaultSections({
  vault,
  inventoryAt,
  catalog,
  onInspect,
}: {
  vault: Vault;
  inventoryAt: number | null;
  /** For joining held stacks to their catalog entry. Null until it loads. */
  catalog: ResourceDb | null;
  /** Show one resource, by display name, in the catalog tree below. */
  onInspect: (name: string) => void;
}) {
  const [query, setQuery] = useState('');

  // Measured over a vault that exists — never computed from an absent
  // inventory, which is how a `.filter().length` turns into a fabricated zero.
  const missingRares = vault.rares.filter((r) => r.count === 0).length;

  return (
    <>
      {/* -------------------------------------------------------- rare stock */}
      {/* Nine "none held" rows tell an empty account nothing it does not already
          know, so the strip only appears once there is a vault to reason about. */}
      {vault.stacks.length > 0 && (
        <section>
          <SectionTitle
            count={`${vault.rares.length}`}
            note={missingRares > 0 ? `${missingRares} at zero` : 'all held'}
          >
            Rare stock
          </SectionTitle>

          {/*
            THE THIRD COLUMN MOVED UP A BREAKPOINT, BECAUSE THE STRIP MOVED
            INTO A PANE.
            ————————————————————————————————————————————
            These breakpoints were chosen when this section was the full width
            of the window. It is now the 7fr half of a two-pane row, so at the
            1280px width everything here is measured at, `xl:grid-cols-3` put
            three cards into roughly 600px — about 170px of content each, for a
            name and a count that together want more than that. `2xl` is where
            the pane is wide enough for a third column to be a division rather
            than a squeeze.
          */}
          <div className="mo-stagger grid grid-cols-1 gap-[3px] md:grid-cols-2 2xl:grid-cols-3">
            {vault.rares.map((r, i) => {
              const out = r.count === 0;
              const ink = out ? 'var(--color-signal-bad)' : 'var(--color-orokin-400)';
              return (
                <button
                  key={r.tail}
                  type="button"
                  onClick={() => {
                    onInspect(r.name);
                  }}
                  // Gated the way the catalog's own Filter is: without a catalog
                  // to filter, the click would be a promise the panel cannot keep.
                  disabled={catalog === null || catalog.failed}
                  title={`Show ${r.name} in the resource catalog`}
                  /*
                   * `hover:brightness-125` was the entire hover response: a
                   * filter on the whole card, which forces a repaint of every
                   * pixel in it. `mo-lift` and `mo-sheen` composite instead —
                   * a transform and a pseudo-element on its own layer — which
                   * is what this panel needs when it draws twenty of these
                   * over a running game.
                   */
                  className="rf-clipped mo-field mo-sheen mo-lift mo-focusable mo-in-up relative w-full cursor-pointer px-4 py-2.5 text-left disabled:cursor-default"
                  style={{ '--i': Math.min(i, 14), clipPath: CHAMFER, background: PLATE } as React.CSSProperties}
                >
                  <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: ink, opacity: 0.85 }} />
                  <span className="flex items-baseline justify-between gap-3">
                    <span
                      className="font-[family-name:var(--font-display)] text-[length:var(--text-small)] font-semibold"
                      style={{ color: out ? 'var(--text-muted)' : 'var(--text)' }}
                    >
                      {r.name}
                    </span>
                    <span className="numeric shrink-0 text-[length:var(--text-micro)]" style={{ color: ink }}>
                      {out ? 'none held' : r.count.toLocaleString()}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="mt-1.5 block h-[3px] w-full overflow-hidden"
                    style={{ background: 'oklch(1 0 0 / 0.07)' }}
                  >
                    <span className="block h-full" style={{ width: `${Math.max(1, r.share * 100)}%`, background: ink }} />
                  </span>
                </button>
              );
            })}
          </div>

          {/* The one inference this panel makes, stated out loud — and stated
              at a level below the strip it justifies rather than as a third
              paragraph the reader has to get past. */}
          <div className="mt-3 text-[length:var(--text-micro)] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            <Clamp lines={1}>
              Bars are relative to your largest rare stack — a scale, not a target. The game only lists stacks you
              actually hold, so a resource the game did not list is genuinely zero.
            </Clamp>
          </div>
        </section>
      )}

      {/* -------------------------------------------------------------- tree */}
      <section>
        {/* No count here: the groups below carry their own, and the footer says
            how many stacks the caps are holding back. */}
        <SectionTitle note="grouped by the folder the game files each one under">Vault</SectionTitle>

        <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
          {/*
           * THE ONLY CONTROL LEFT, AND THAT IS THE POINT.
           *
           * There were three: a family tab strip, a tier segmented control and
           * this. Two of them were the vault's own grouping keys spent on hiding
           * rows — pressing "Gems" meant not seeing Resources, pressing "Rare"
           * meant not seeing the other ninety-seven per cent, and the pair could
           * empty the table in four different ways that all looked like a failed
           * account read. Both keys are now structure: family is the group,
           * tier is a chip on the row and a count on the group it belongs to.
           * A text filter is not a grouping key and stays.
           */}
          <Filter value={query} onChange={setQuery} label="Filter held resources" placeholder="Filter by name" />
        </div>

        <VaultTree vault={vault} catalog={catalog} query={query} />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
          {/* Most stacks carry no tier chip (see TIER), and an absence with no
              stated reason reads as "not rare". This is the reason, given once
              for the whole tree rather than as three hundred dashes. */}
          <span className="eyebrow">
            {vault.stacks.length.toLocaleString()} stacks · {vault.totalUnits.toLocaleString()} units · bars scale to
            the largest stack in their own group · tier known for the classic planet-drop resources only
          </span>
          <span className="eyebrow">
            names are worked out from the game&apos;s internal item name — every row opens onto its derivation
            {inventoryAt != null && ` · account read ${new Date(inventoryAt).toLocaleTimeString()}`}
          </span>
        </div>
      </section>
    </>
  );
}

/* -------------------------------------------------------------------- panel */

export default function ResourcesPanel() {
  const inventory = useAccount((s) => s.inventory);
  const inventoryAt = useAccount((s) => s.inventoryAt);
  const catalog = useResourceDb();
  const [catalogQuery, setCatalogQuery] = useState('');
  /*
   * THE CATALOG'S OWN SCROLLER, not the section around it.
   *
   * This used to point at the `<section>` and call `scrollIntoView`, which
   * worked because the page scrolled. The page no longer scrolls — the root is
   * a fixed-height grid and the catalog lives in a pane with its own overflow —
   * so `scrollIntoView` on the section is now a guaranteed no-op, and a click
   * that appears to do nothing is worse than one that does nothing honestly.
   * The pane is what has to move, so the pane is what is held.
   */
  const catalogRef = useRef<HTMLDivElement>(null);

  // `RawInventory` and `RawAccount` are the same GEP payload described at two
  // levels of detail; subsystems.ts models the detailed one and reads every field
  // defensively, so the widening is safe and costs no runtime work. The inventory
  // object's identity only changes when the underlying bytes changed, so this
  // recomputes exactly as often as it must and no more.
  const vault = useMemo(() => (inventory ? buildVault(inventory as unknown as RawAccount) : null), [inventory]);

  /*
   * Honour a resource another panel sent us to.
   *
   * Filters the catalog tree down to that one resource rather than trying to
   * scroll to it: each group caps its rows, so a resource that sorts past its
   * group's cap simply is not in the DOM to scroll to, and the jump would
   * silently do nothing for most of the catalog.
   */
  useEffect(
    () =>
      subscribeFocus(['resource'], (req) => {
        setCatalogQuery(req.id);
      }),
    [],
  );

  /*
   * A rare-stock card opens onto the CATALOG, not the vault. A rare held at
   * zero is not in the vault tree at all — the game only lists stacks you
   * hold — so filtering the vault would answer "nothing matches" for exactly
   * the cards the strip exists to flag. The catalog has every resource, and
   * its rows carry the held count. The rows have no id to jump to, so this is
   * the same filter the cross-panel jump above uses, plus a scroll so the
   * click visibly lands somewhere.
   *
   * The scroll is now the catalog pane's own, and it is a reset to the top
   * rather than a jump: the filter has just rebuilt the tree under a pane that
   * may be scrolled hundreds of pixels down, and leaving it there shows the
   * reader the middle of a list that is now one item long.
   */
  const inspect = (name: string): void => {
    setCatalogQuery(name);
    catalogRef.current?.scrollTo(0, 0);
  };

  const cq = catalogQuery.trim().toLowerCase();
  const catalogRows = useMemo(() => {
    const all = catalog?.all ?? [];
    if (cq === '') return all;
    return all.filter((e) => e.name.toLowerCase().includes(cq) || (e.type ?? '').toLowerCase().includes(cq));
  }, [catalog, cq]);

  // Every currency below is `number | null` at source and stays null without an
  // account, so each one renders `—`. There is no `?? 0` anywhere on this path.
  const totals: InventoryTotals | null = vault?.totals ?? null;
  const hasAccount = vault !== null;

  return (
    /*
     * A FIXED-HEIGHT GRID, NOT A GROWING COLUMN.
     * ──────────────────────────────────────────
     * The note that used to sit here said "no `h-full`: the shell's <main> is
     * the page scroller", and that was true and was the defect. Measured at
     * 1280x720 with nothing read: 1,297px of panel in a 672px viewport, so the
     * reader met a wallet of em-dashes, scrolled past it, and found the catalog
     * — the only part of this panel that works before the game has ever been
     * launched — below the fold.
     *
     * Two rows. The first is `auto` and is PINNED: it is the headline state,
     * and it never scrolls away. The second is `minmax(0,1fr)` and holds the
     * long material — the vault and the catalog — each of which scrolls inside
     * its own pane. The page itself does not scroll at all.
     *
     * `min-h-0` on every row and column of the chain is what makes that true
     * and is the easy thing to leave out: a grid child defaults to
     * `min-height: auto` and refuses to shrink below its content, so one
     * omission anywhere and the whole thing grows again with nothing on screen
     * to say anything is wrong.
     */
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,auto)_minmax(9rem,1fr)] gap-4 p-5">
      {/*
        THE PINNED ROW IS THE WALLET, OR THE REASON THERE ISN'T ONE.
        ————————————————————————————————————————————
        These are two states of one thing, so they are one row rather than two
        stacked sections. With an account the hero and the plates carry seven
        real numbers and are the headline. With none they carry seven em-dashes
        and a banner underneath already saying, in a sentence, the single fact
        all seven were spelling out — so the band takes the row on its own and
        names the seven inside it, one press away.
      */}
      {hasAccount ? (
        <div className="flex min-w-0 flex-col gap-3">
          <CreditHero
            value={totals?.credits ?? null}
            platinum={totals?.platinum ?? null}
            tradable={totals?.platinumTradable ?? null}
            hasAccount={hasAccount}
          />

          <div className="mo-stagger grid grid-cols-2 gap-[3px] lg:grid-cols-5">
            {TOKENS.map((t, i) => (
              <Token
                key={t.label}
                index={i}
                label={t.label}
                // Still `number | null` the whole way: `totals` is non-null in
                // this branch, and the accessor returns the field as it is.
                value={totals === null ? null : t.read(totals)}
                color={t.color}
                sub={t.sub}
              />
            ))}
          </div>
        </div>
      ) : (
        <AccountBanner />
      )}

      {/*
        THE REFERENCE ROW, AND IT USES THE WIDTH.
        ————————————————————————————————————————————
        With an account there are two long things to read and they were stacked,
        which is what made this panel two screens: the catalog sat under a vault
        tree that is itself hundreds of rows, in a single column with the right
        half of the window empty. Side by side they are one screen, and each one
        scrolls without moving the other.

        Below `xl` the two panes become two half-height rows rather than two
        auto rows, because auto rows size to their content and a grid does not
        clip: two auto rows here is the growing column again, just written
        differently.

        With NO account there is no vault to put beside it — the account half is
        omitted entirely, since an empty vault tree asserts that you hold
        nothing, which is a different claim from not knowing what you hold — so
        the catalog takes the whole row rather than being given half of it and
        leaving a hole where the other half would be.
      */}
      <div
        className={
          hasAccount
            ? 'grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:grid-rows-[minmax(0,1fr)]'
            : 'grid min-h-0 grid-rows-[minmax(0,1fr)]'
        }
      >
        {vault !== null && (
          <div className="flex min-h-0 min-w-0 flex-col gap-5 overflow-y-auto pr-1">
            <VaultSections vault={vault} inventoryAt={inventoryAt} catalog={catalog} onInspect={inspect} />
          </div>
        )}

        {/* ----------------------------------------------------------- catalog */}
        {/*
          `mo-arrive` IS GONE WITH THE SCROLL IT WAS READING.
          ————————————————————————————————————————————
          It is a scroll-driven entrance — `animation-timeline: view()`, ranged
          over the first quarter of the section's entry — and this section used
          to be the last thing in a 1,297px column, so it genuinely entered.
          As a pane it is permanently in view, which resolves the animation
          straight to its end state and leaves a class that does nothing. The
          Arsenal panel struck the same class for the same reason when its
          footer became a pinned track: motion that exists in the source and
          never in the pixels is worse than no motion, because it reads as
          having been considered. The panel's own entrance is `anim-rise` on
          the shell's <main>, which is unaffected.
        */}
        <section className="flex min-h-0 min-w-0 flex-col">
          {/* The one place the total is stated. Each group states its own size, so
              nothing else needs to count. */}
          <SectionTitle
            count={
              catalog === null
                ? 'loading'
                : catalog.failed
                  ? 'total unknown'
                  : cq === ''
                    ? `${catalog.all.length.toLocaleString()} in the game`
                    : `${catalogRows.length.toLocaleString()} of ${catalog.all.length.toLocaleString()} match the filter`
            }
            note="game data — no account needed"
          >
            Resource catalog
          </SectionTitle>

          {/* The title and the filter stay put; only the tree under them moves.
              A filter that scrolls away from the list it filters is a control
              the reader has to go and find again after every keystroke. */}
          {catalog !== null && !catalog.failed && (
            <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
              <Filter
                value={catalogQuery}
                onChange={setCatalogQuery}
                label="Filter the resource catalog"
                placeholder="Filter by name or type"
              />
            </div>
          )}

          <div ref={catalogRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
            {catalog === null ? (
              <EmptyState
                title="Loading the resource catalog"
                detail="Fetching the resource export. Until it lands, how many resources the game contains is unknown — it is not zero."
              />
            ) : catalog.failed ? (
              <EmptyState
                title="Resource catalog unavailable"
                detail="The catalog fetch failed, so how many resources the game contains is unknown — not zero — and this panel will not print a total it cannot substantiate. It retries on the next launch."
              />
            ) : (
              <CatalogTree rows={catalogRows} vault={vault} query={catalogQuery} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
