/**
 * WHAT AN ITEM ROW OPENS ONTO.
 *
 * Four panels — Mastery, Arsenal, Nemesis and Foundry — are lists of the same
 * kind of thing, and each of them showed three or four columns of it. The
 * catalog already carried the item's artwork, its category, its mastery
 * requirement, its maximum rank, its rarity, whether it is vaulted and whether
 * it can be traded. None of that was on screen anywhere.
 *
 * So this is deliberately ONE component rather than four. A weapon should not
 * describe itself differently depending on which screen you found it on, and
 * the panels that need to say something extra say it through `extra` instead of
 * forking the whole layout.
 *
 * EVERY FIELD IS OPTIONAL AND EVERY ABSENT FIELD DISAPPEARS.
 * `ItemDbEntry` marks `vaulted`, `tradable`, `rarity` and `type` optional
 * because the catalog genuinely does not know them for every row — `vaulted`
 * being absent means UNKNOWN, not "not vaulted". Printing "no" there would be
 * inventing an answer, so `Facts` drops the line instead.
 */

import { useState, type ReactNode } from 'react';
import type { ItemDbEntry } from '../data/itemdb';
import { Facts, GoLink, type Fact } from './interact';
import { Chevron } from './orokin';
import { ItemArt } from './ItemArt';

export interface ItemDetailProps {
  /** The catalog row. Null when the item is not in the export. */
  entry: ItemDbEntry | null;
  /** Display name, needed even when the catalog has never heard of the item. */
  name: string;
  /** The raw `/Lotus/...` path — the item's only stable identity. */
  itemType?: string;
  /**
   * Tri-state, and it must stay tri-state. `null` is "we have no inventory to
   * check", which is a different claim from "you do not own this".
   */
  owned?: boolean | null;
  /**
   * The panel's OWN facts - why this row was opened in this panel.
   *
   * Always visible, above the catalog's general knowledge. Must not reuse a
   * label the shared tiers already use; `Facts` drops repeats, so a collision
   * silently loses data rather than printing it twice.
   */
  extra?: readonly Fact[];
  /** Anything that does not fit a label/value pair — a meter, a ladder, a note. */
  children?: ReactNode;
  /**
   * Suppress the "open in collection" jump.
   *
   * For the Collection panel itself, where offering to take you to the panel you
   * are already reading is nonsense - and, since the link scrolls and rings its
   * target, nonsense that visibly does something.
   */
  hideCollectionLink?: boolean;
}

/**
 * A build time, in the units a player thinks in.
 *
 * WFCD sends seconds, and 259,200 is not a duration anyone reads - it is three
 * days. Hours matter below a day (a weapon is 12h, a warframe part is 12h) and
 * stop mattering above it, so this drops them rather than printing "3d 0h".
 */
function buildDuration(seconds: number): string {
  const h = Math.round(seconds / 3600);
  if (h < 24) return `${String(h)}h`;
  const d = Math.floor(h / 24);
  const rem = h % 24;
  return rem === 0 ? `${String(d)}d` : `${String(d)}d ${String(rem)}h`;
}

/**
 * A fraction from the catalog, as the percentage a player reads.
 *
 * The source sends 0.12 for 12%, and carries float noise with it - 6% status
 * arrives as 0.060000002. Rounding to one decimal and dropping a trailing zero
 * turns both into what the game itself shows.
 */
function pct(fraction: number): string {
  const v = Math.round(fraction * 1000) / 10;
  return `${String(Number.isInteger(v) ? v : Number(v.toFixed(1)))}%`;
}

/** Trims float noise off a plain number without inventing precision. */
function trim(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/*
 * A default of `[]` is a NEW array on every render, so every consumer that
 * compares props or lists `extra` as a dependency sees a change that never
 * happened. One frozen module-level value, shared by every caller that omits
 * the prop, makes "no extra facts" identical to itself.
 */
const NO_EXTRA: readonly Fact[] = Object.freeze([]);

export function ItemDetail({
  entry,
  name,
  itemType,
  owned = null,
  extra = NO_EXTRA,
  children,
  hideCollectionLink = false,
}: ItemDetailProps) {
  const [open, setOpen] = useState(false);
  /*
   * TIER 1 - VITALS. The two or three numbers that define this KIND of thing.
   *
   * Chosen by what the item HAS rather than by a declared category, because the
   * catalog's categories do not split cleanly: a Necramech is filed under
   * Warframes, an amp under Misc. If it has a critical chance it is a weapon and
   * its crit and status ARE what it is; if it has a build time it is something
   * you make, and what making it costs is the thing you came for.
   */
  const vitals: Fact[] =
    entry?.criticalChance != null
      ? [
          {
            label: 'Critical',
            value: `${pct(entry.criticalChance)}${entry.criticalMultiplier != null ? ` at ${trim(entry.criticalMultiplier)}\u00d7` : ''}`,
          },
          { label: 'Status', value: entry.procChance != null ? pct(entry.procChance) : '', when: entry.procChance != null },
          {
            label: 'Damage',
            value: entry.totalDamage != null ? trim(entry.totalDamage) : '',
            when: entry.totalDamage != null && entry.totalDamage > 0,
          },
        ]
      : entry?.buildTime != null && entry.buildTime > 0
        ? [
            { label: 'Build time', value: buildDuration(entry.buildTime) },
            {
              label: 'Build cost',
              value: entry.buildPrice != null ? `${entry.buildPrice.toLocaleString()} credits` : '',
              when: entry.buildPrice != null && entry.buildPrice > 0,
            },
          ]
        : [];

  /*
   * TIER 3 - everything else that is true. Real, worth having, and not what
   * anyone opened the row to look at. See the note at the top of this file.
   */
  const rest: Fact[] = [
    { label: 'Category', value: entry?.type ?? entry?.category ?? '', when: entry != null },
    {
      label: 'Mastery rank',
      value: entry ? (entry.masteryReq === 0 ? 'none' : String(entry.masteryReq)) : '',
      when: entry != null,
    },
    {
      // The single biggest hidden cost in the game: a rank-40 weapon is roughly
      // six times the affinity of a rank-30 one for the same two mastery points.
      label: 'Rank cap',
      value: entry ? String(entry.maxRank) : '',
      when: entry != null && entry.maxRank !== 30,
    },
    { label: 'Rarity', value: entry?.rarity ?? '', when: entry?.rarity != null },
    { label: 'Grants mastery', value: entry?.masterable === true ? 'yes' : 'no', when: entry != null },
    { label: 'Vaulted', value: entry?.vaulted === true ? 'yes' : 'no', when: entry?.vaulted !== undefined },
    { label: 'Tradable', value: entry?.tradable === true ? 'yes' : 'no', when: entry?.tradable !== undefined },
    {
      label: 'Introduced',
      // WFCD's word for the original release is "Vanilla", which is a data
      // label, not something a player says.
      value: entry?.introduced === 'Vanilla' ? 'At launch' : (entry?.introduced ?? ''),
      when: entry?.introduced != null,
    },
    {
      label: 'Rush',
      value: entry?.skipBuildTimePrice != null ? `${String(entry.skipBuildTimePrice)} platinum` : '',
      when: entry?.skipBuildTimePrice != null && entry.skipBuildTimePrice > 0,
    },
    {
      label: 'Yields',
      value: entry?.buildQuantity != null ? String(entry.buildQuantity) : '',
      when: entry?.buildQuantity != null && entry.buildQuantity > 1,
    },
    {
      label: 'Fire rate',
      value: entry?.fireRate != null ? `${trim(entry.fireRate)}/s` : '',
      when: entry?.fireRate != null && entry.fireRate > 0,
    },
    {
      label: 'Magazine',
      value: entry?.magazineSize != null ? String(entry.magazineSize) : '',
      when: entry?.magazineSize != null && entry.magazineSize > 0,
    },
    {
      label: 'Reload',
      value: entry?.reloadTime != null ? `${trim(entry.reloadTime)}s` : '',
      when: entry?.reloadTime != null && entry.reloadTime > 0,
    },
    {
      label: 'Riven disposition',
      value: entry?.disposition != null ? `${trim(entry.disposition)} of 5` : '',
      when: entry?.disposition != null && entry.disposition > 0,
    },
  ];

  const parts = entry?.components ?? [];
  const abilities = entry?.abilities ?? [];

  /*
   * TIER 3 IS WHATEVER IS LEFT.
   *
   * `Facts` de-duplicates inside a single call, which is not enough here: the
   * card makes three separate calls, so a label appearing in both the panel's
   * facts and the catalog's was printed twice - once above the fold and once
   * inside "Everything else". That is precisely the complaint. The filter has to
   * live where all three tiers are visible at once, which is here.
   */
  const above = new Set([...vitals, ...extra].filter((f) => f.when !== false).map((f) => f.label.toLowerCase()));
  const folded = rest.filter((f) => !above.has(f.label.toLowerCase()));

  return (
    <div className="flex gap-4">
      {/* The artwork is the only object on this card, so it is the only thing
          that can carry a real z axis: `mo-tilt` turns it a few degrees toward
          the pointer. Everything else here is type, and type that tilts is a
          gimmick. Pointer-driven, so it cannot be stranded, and the thumbnail is
          fully drawn at rest whether or not anything ever moves. */}
      <ItemArt
        imageName={entry?.imageName}
        name={name}
        owned={owned}
        size={64}
        plain
        className="mo-field mo-tilt"
      />

      <div className="min-w-0 flex-1 max-w-[72rem]">
        {/*
          No name here. The row this card opened from is directly above it and
          already carries the name and a thumbnail; repeating both forty pixels
          lower was the first thing a reviewer saw. The raw item path lives on
          the card's title attribute for anyone who needs it, not in the copy.
        */}
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1" title={itemType}>
          {/* The one cross-panel jump an item always has: its own catalog row,
              where its acquisition and relic sources live. Not offered when this
              IS that row. */}
          {!hideCollectionLink && (
            <GoLink kind="item" id={name} className="eyebrow" title={`Find ${name} in the collection`}>
              open in collection
            </GoLink>
          )}
        </div>

        {/* What the thing IS, before any numbers about it. Every one of these
            panels previously showed artwork and statistics and never once said
            what the item was. */}
        {entry?.description != null && entry.description.length > 0 && (
          <p
            className="wf-prose mb-2.5"
          >
            {entry.description}
          </p>
        )}

        {/* 1. The vitals, set larger than anything else in the card. Emphasis
            is for what the thing IS - a weapon's crit and status. A build cost
            is an ordinary fact and reads wrong in the large numeric face beside
            the small ones under it. */}
        {vitals.length > 0 && <Facts items={vitals} columns={1} emphasis={entry?.criticalChance != null} />}

        {/* 2. Why you are here. */}
        {extra.length > 0 && <div className={vitals.length > 0 ? 'mt-3' : ''}><Facts items={extra} /></div>}

        {/* What the frame actually DOES. The single most useful thing about a
            warframe, and the app had artwork and a mastery number instead. */}
        {abilities.length > 0 && (
          <div className="mt-3">
            <div className="eyebrow">Abilities</div>
            <ol className="mt-1 flex flex-col gap-1">
              {abilities.map((a, i) => (
                <li key={a.name} className="flex gap-2.5 text-[length:var(--text-micro)] leading-relaxed">
                  <span className="numeric shrink-0" style={{ color: 'var(--text-faint)' }}>
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span style={{ color: 'var(--color-tenno-300)' }}>{a.name}</span>
                    {/* Absent when DE ships it as an unfilled template. */}
                    {a.description != null && (
                      <span style={{ color: 'var(--text-muted)' }}> &middot; {a.description}</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* The ingredient list, as a list rather than a fact - it is the one
            thing here that is a set of things rather than a single value. */}
        {parts.length > 0 && (
          <div className="mt-3">
            <div className="eyebrow">Built from</div>
            {/*
              A LIST OF NAMES IS A DEAD END, AND THIS CARD IS OPENED FROM FIVE
              PANELS.
              ————————————————————————————————————————————
              "Built from: Chassis, Neuroptics, Systems, Orokin Cell" answers
              what a thing is made of and nothing about how to get any of it -
              which is the next question every single time, and the card had
              nowhere to send it. The catalog carries a location and a drop
              chance on each of those components; the parse was discarding it
              and now keeps the best one.

              SHOWN ONLY WHERE IT HELPS. A thing already owned needs no
              directions, so an owned item keeps the compact inline list. A
              thing not owned - or whose ownership is unread - gets the
              sources, because that is when somebody is asking.
            */}
            {owned === true ? (
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                {parts.map((c) => (
                  <li key={c.name} className="text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
                    {c.itemCount != null && c.itemCount > 1 && (
                      <span className="numeric" style={{ color: 'var(--text)' }}>{c.itemCount}&#215; </span>
                    )}
                    {c.name}
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="mt-1 flex flex-col gap-0.5">
                {parts.map((c) => (
                  <li key={c.name} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="shrink-0 text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
                      {c.itemCount != null && c.itemCount > 1 && (
                        <span className="numeric" style={{ color: 'var(--text)' }}>{c.itemCount}&#215; </span>
                      )}
                      {c.name}
                    </span>
                    {c.from === undefined ? (
                      /* Absent is absent. Crafted sub-parts are made rather
                         than found, and the catalog gives them no source - so
                         the row says nothing rather than implying nowhere. */
                      <span className="eyebrow" style={{ color: 'var(--text-ghost)' }}>
                        made, not found
                      </span>
                    ) : (
                      <span className="min-w-0 text-[length:var(--text-nano)]" style={{ color: 'var(--text-faint)' }}>
                        {c.from.at}
                        <span className="numeric" style={{ color: 'var(--color-tenno-300)' }}>
                          {` ${c.from.pct.toFixed(1)}%`}
                        </span>
                        {c.from.n > 1 && (
                          <span style={{ color: 'var(--text-ghost)' }}>
                            {` \u2014 best of ${String(c.from.n)}`}
                          </span>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {children != null && <div className="mt-3">{children}</div>}

        {/*
          3. Everything else, folded away.
          The raw path lives in here too: it is the item's stable identity and
          worth having, and it is also the least readable thing on the card.
        */}
        {folded.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => {
                setOpen((o) => !o);
              }}
              aria-expanded={open}
              data-open={open}
              // `rf-row` already gives this the lit edge, the wash and the give;
              // `mo-focusable` adds the one thing it never had, which is the
              // moment focus ARRIVES. This control is several screens deep in a
              // card that is itself opened from a row, so a keyboard user
              // tabbing into it had no idea where they had landed.
              className="rf-row mo-focusable flex items-center gap-1.5 px-1.5 py-1"
            >
              <Chevron open={open} />
              <span className="eyebrow">{open ? 'Less' : 'Everything else'}</span>
            </button>

            <div className="rf-reveal" data-open={open}>
              <div>
                <div className="pt-2 pl-1.5" inert={!open}>
                  <Facts items={folded} />
                </div>
              </div>
            </div>
          </div>
        )}

        {entry === null && (
          <span className="eyebrow mt-1 block" style={{ color: 'var(--text-faint)' }}>
            not in the catalog export
          </span>
        )}
      </div>
    </div>
  );
}
