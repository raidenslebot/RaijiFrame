/**
 * NEMESIS — Kuva Lich, Sister of Parvos, Coda.
 *
 * This is the one panel in RaijiFrame that is allowed to be hostile. Everywhere
 * else the system is Orokin gold on void black; here a red threat channel runs
 * under the gold, because the subject is the one thing in the game that hunts
 * the player back.
 *
 * THE ONE BOLD ELEMENT
 * ────────────────────
 * Whether a nemesis is ACTIVE. An active lich taxes every mission reward and
 * holds star-chart nodes hostage, so while one exists the dossier dominates the
 * screen and everything else is a quiet ledger beneath it. With no lich hunting
 * you there is nothing urgent on this panel at all, so the "none active" state
 * is deliberately small — a single line — and the lifetime record and the
 * arsenal carry the panel instead.
 *
 * What this panel refuses to do:
 *
 *   The payload stores `WeaponIdx` / `AgentIdx` — indices into the nemesis
 *   *manifest*, which is game data no module here has. So the weapon and the
 *   ephemera the active nemesis will drop CANNOT be named, and neither can the
 *   nemesis itself (its name is generated from the `fp` seed). Rather than
 *   printing a plausible weapon, the dossier says the drop cannot be named.
 *
 *   `InfNodes[].Influence` has no documented scale, so the territory bars are
 *   normalised against the strongest node and labelled relative. A bar that
 *   claims to be a percentage when nobody verified the units is a lie with a
 *   gradient on it.
 *
 * Entrances come from the motion layer (`src/styles/motion.css`) — mo-in-up,
 * mo-in-left, mo-in-scale, mo-in-settle, staggered by `--i` on a `mo-stagger`
 * parent — never from the animation engine: rAF does not run while the window
 * is hidden, and an element that entered from `opacity: 0` under Motion stays
 * permanently invisible. The whole dossier used to do exactly that. Every one
 * of those classes animates transform and nothing else, so a stopped timeline
 * leaves the dossier a few pixels out of place and entirely readable.
 *
 * The pointer-driven effects (mo-field, mo-tilt, mo-sheen, mo-lift) are exempt
 * from that rule and are where the panel's weight now sits: they can only run
 * while somebody is looking at the window.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAccount } from '../../core/store';
import { ItemDetail } from '../../ui/ItemDetail';
import { GoLink } from '../../ui/interact';
import { goTo } from '../../ui/navigation';
import type { RawInventory } from '../../core/gep';
import type { RawAccount } from '../../data/account';
import { nemesisState, type ActiveNemesis, type NemesisState } from '../../data/subsystems';
import { ledger, ownedTypes, weaponRank } from '../../data/mastery';
import { loadItemDb, type ItemDb, type ItemDbEntry } from '../../data/itemdb';
import { loadCatalog, type LoadedCatalog } from '../../data/datasets';
import { DataTable, EmptyState, type Column } from '../../ui/orokin';
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { Segmented } from '../shared/Segmented';
import { CHAMFER, PLATE_LIFT as PLATE } from '../../ui/geometry';

/** Hostile channel. The only place in the app this red is the dominant accent. */
const THREAT = 'var(--color-signal-bad)';

/**
 * GEP hands over the same serialized blob `inventory.php` serves; `RawInventory`
 * is the thin view of it and `RawAccount` is the full model. Every reader below
 * this point is defensive, so widening here costs nothing and buys the whole
 * account model.
 */
const asAccount = (inv: RawInventory): RawAccount => inv as unknown as RawAccount;

/* ------------------------------------------------------------------ lineages */

interface Lineage {
  key: string;
  /** `Nemesis.Faction`, so the mapping survives a reorder of this list. */
  faction: string | null;
  /** Name prefix in the item catalog. The join is by name because the catalog
   *  carries no nemesis flag — see the footnote the panel renders. */
  prefix: string;
  /** What the player calls the enemy that drops it. */
  hunter: string;
  house: string;
  hue: string;
}

const LINEAGES: readonly Lineage[] = [
  { key: 'Kuva', faction: 'FC_GRINEER', prefix: 'Kuva ', hunter: 'Kuva Lich', house: 'Grineer', hue: 'var(--color-faction-grineer)' },
  { key: 'Tenet', faction: 'FC_CORPUS', prefix: 'Tenet ', hunter: 'Sister of Parvos', house: 'Corpus', hue: 'var(--color-faction-corpus)' },
  { key: 'Coda', faction: 'FC_INFESTATION', prefix: 'Coda ', hunter: 'Coda', house: 'Technocyte', hue: 'var(--color-faction-techrot)' },
];

/** No catalog item is named "Unknown …", so this lineage joins to nothing. */
const UNKNOWN_LINEAGE: Lineage = {
  key: 'Unknown',
  faction: null,
  prefix: 'Unknown ',
  hunter: 'Nemesis',
  house: 'Unknown faction',
  hue: THREAT,
};

/**
 * An unrecognised faction gets the neutral entry rather than a positional
 * guess: labelling a Coda a Kuva Lich is worse than admitting we do not know.
 */
function lineageOf(faction: string | null): Lineage {
  return LINEAGES.find((l) => l.faction === faction) ?? UNKNOWN_LINEAGE;
}

/* ------------------------------------------------------------------- format */

const CLOCK = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Display fallback for a `/Lotus/...` type the catalog has no row for. */
function prettyType(type: string | null): string | null {
  if (type === null) return null;
  const parts = type.split('/');
  const tailPart = parts[parts.length - 1];
  if (tailPart === undefined || tailPart === '') return type;
  return tailPart.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function days(fromMs: number, toMs: number): number {
  return Math.max(0, Math.floor((toMs - fromMs) / 86_400_000));
}

/* -------------------------------------------------------------------- hooks */

/** The item catalog, for the Kuva/Tenet/Coda collection join. Cached by gentle. */
function useItemDb(): ItemDb | null {
  const [db, setDb] = useState<ItemDb | null>(null);
  useEffect(() => {
    let alive = true;
    void loadItemDb().then((d) => {
      if (alive) setDb(d);
    });
    return () => {
      alive = false;
    };
  }, []);
  return db;
}

/** Star chart names, so territory reads as "Cassini, Saturn" not "SolNode108". */
function useCatalog(): LoadedCatalog | null {
  const [loaded, setLoaded] = useState<LoadedCatalog | null>(null);
  useEffect(() => {
    let alive = true;
    void loadCatalog().then((c) => {
      if (alive) setLoaded(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return loaded;
}

/* ------------------------------------------------------------------ pieces */

function SectionTitle({ children, count, note }: { children: string; count?: number; note?: string }) {
  return (
    <header className="mb-2.5 flex items-baseline gap-3">
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

/** A flat track. Painted at its value, so a throttled renderer cannot empty it. */
function Track({ value, color, height = 3 }: { value: number; color: string; height?: number }) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return (
    <span aria-hidden className="block w-full overflow-hidden" style={{ height, background: 'oklch(1 0 0 / 0.07)' }}>
      <span className="block h-full" style={{ width: `${Math.max(2, v * 100)}%`, background: color }} />
    </span>
  );
}

/** Small-caps key/value row. The dossier is mostly these, packed tight. */
function Field({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: string }) {
  const missing = value === null || value === undefined;
  return (
    <div className="min-w-0" title={hint}>
      <div className="eyebrow">{label}</div>
      <div
        className="mt-1 text-[length:var(--text-small)] leading-snug"
        style={{ color: missing ? 'var(--text-muted)' : 'var(--text)' }}
      >
        {/* The same reason the threat numeral gives for its dash: the value is
            absent from the account read, which is a fact about the snapshot and
            not a parser state. "unresolved" was the parser talking. */}
        {missing ? 'not in this account read' : value}
      </div>
    </div>
  );
}

/** A hazard chip. Used only for states the payload actually asserts. */
function Flag({ children, hue = THREAT }: { children: ReactNode; hue?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-[3px] text-[length:var(--text-nano)] font-semibold tracking-[0.18em] uppercase"
      style={{
        clipPath: 'polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%)',
        color: hue,
        background: `color-mix(in oklab, ${hue} 15%, transparent)`,
      }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rotate-45" style={{ background: hue }} />
      {children}
    </span>
  );
}

/**
 * A requiem lock.
 *
 * Three slots, filled left to right as murmurs reveal them. The sigil is
 * DECORATIVE and the caption says so: `Hints` holds manifest indices, so which
 * of the eight requiem mods a revealed slot holds is not knowable from here.
 */
function RequiemLock({ index, revealed }: { index: number; revealed: boolean }) {
  // void-600 on the hatch read as a rendering failure rather than a locked slot.
  const ink = revealed ? 'var(--color-orokin-300)' : 'var(--color-void-300)';
  return (
    <div
      className="mo-in-scale relative isolate flex flex-col items-center gap-2 px-3 py-3"
      style={{
        clipPath: CHAMFER,
        animationDelay: `${200 + index * 45}ms`,
        background: revealed ? 'oklch(0.83 0.105 90 / 0.10)' : 'repeating-linear-gradient(135deg, oklch(1 0 0 / 0.05) 0 6px, transparent 6px 12px)',
        boxShadow: `inset 0 0 0 1px ${revealed ? 'oklch(0.83 0.105 90 / 0.34)' : 'oklch(1 0 0 / 0.14)'}`,
      }}
    >
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
        <g stroke={ink} strokeWidth="1.3" fill="none">
          <path d="M16 2 L29 16 L16 30 L3 16 Z" />
          {/* Three variants so the row does not read as one glyph stamped thrice. */}
          {index === 0 && <path d="M16 8 V24 M10 16 H22" />}
          {index === 1 && <path d="M10 12 L22 20 M22 12 L10 20 M16 6 V26" />}
          {index === 2 && <path d="M16 7 L22 16 L16 25 L10 16 Z M16 12 V20" />}
        </g>
        {revealed && <rect x="14" y="14" width="4" height="4" transform="rotate(45 16 16)" fill={ink} />}
      </svg>
      <div className="eyebrow" style={{ color: revealed ? 'var(--color-orokin-400)' : 'var(--text-faint)' }}>
        {['I', 'II', 'III'][index] ?? index + 1}
      </div>
      <div className="text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
        {revealed ? 'revealed' : 'unknown'}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- dossier */

/**
 * The dossier — the hero, and the panel's answer to "is something hunting me".
 *
 * Red edge, red hazard band, red threat numeral. No bloom behind the text: the
 * energy field that used to sit under this lit the copy from behind and cost
 * more legibility than it bought mood.
 */
function Dossier({
  active,
  lineage,
  db,
  nodeName,
  nowRef,
}: {
  active: ActiveNemesis;
  lineage: Lineage;
  db: ItemDb | null;
  nodeName: (id: string | null) => string | null;
  nowRef: number | null;
}) {
  const level = active.rank === null ? null : active.rank + 1;
  // `suit` is the catalog row; `suitName` falls back to a prettified path when
  // the catalog has no row. Only the former can be linked - the collection
  // panel looks items up by catalog name, so a prettified path is a dead end.
  const suit = active.killingSuit === null ? null : (db?.byType.get(active.killingSuit) ?? null);
  const suitName = active.killingSuit === null ? null : (suit?.name ?? prettyType(active.killingSuit));
  const birthName = nodeName(active.birthNode);
  const age = active.createdMs !== null && nowRef !== null ? days(active.createdMs, nowRef) : null;
  // The three "how the hunt has gone" counters sit behind a fold: none of them
  // changes what the player does next, and at equal weight with the four that
  // do they buried them. `Disclosure` owns the open state now.

  const remaining = Math.max(0, 3 - active.hintsRevealed);
  const directive =
    remaining > 0
      // The node COUNT belongs to the "Nodes held" heading below, which is the
      // filtered number the list under it actually shows. Printing it here as
      // well put the same integer twice within one screen height, and the two
      // could silently disagree: the territory builder drops entries whose
      // `Node` is not a string, so a malformed one would be counted here and
      // absent there. The condition stays, only the number goes.
      ? `${active.influencedNodes === 0 ? 'Hunt thralls wherever it spawns' : 'Hunt thralls on the nodes it holds'} — ${remaining} requiem${remaining === 1 ? '' : 's'} still unrevealed.`
      // The attempt count lives in the "Parazon attempts" cell below; printing
      // it here as well put it on screen twice once the lock row filled.
      : 'All three requiems are revealed. The order is not.';

  return (
    // The dossier is the one thing on this panel that hunts back, so it is the
    // one surface that reacts in three dimensions. `mo-field` puts it on the
    // document pointer tracker; `mo-tilt` turns it toward the cursor and
    // `mo-sheen` lights it from there. Hover-driven, so the frozen document
    // timeline can never catch either mid-flight.
    <section
      className="mo-field mo-tilt mo-sheen mo-in-settle relative isolate"
      style={{
        clipPath: CHAMFER,
        padding: 1,
        background: `linear-gradient(145deg, ${THREAT}, oklch(0.63 0.20 27 / 0.22) 42%, transparent 82%)`,
      }}
    >
      <div className="relative" style={{ clipPath: CHAMFER, background: 'linear-gradient(168deg, oklch(0.145 0.028 20 / 0.97), oklch(0.095 0.02 275 / 0.98))' }}>
        {/* Hazard band along the top edge. Static, cheap, and instantly legible
            as "danger" without a single word. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[3px] opacity-70"
          style={{ background: `repeating-linear-gradient(115deg, ${THREAT} 0 10px, transparent 10px 20px)` }}
        />

        <div className="relative grid gap-7 p-6 lg:grid-cols-[auto_1fr]">
          {/* Threat level. The biggest numeral on the panel, because the rank is
              what decides whether a failed parazon attempt is survivable. */}
          <div className="flex flex-row items-end gap-4 lg:w-[9rem] lg:flex-col lg:items-start">
            <div>
              <div className="eyebrow" style={{ color: THREAT }}>
                Threat level
              </div>
              <div className="numeric mt-1 text-[length:var(--text-hero)] leading-none" style={{ color: THREAT }}>
                {level ?? '—'}
              </div>
              <div className="mt-1.5 text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
                {level === null ? 'rank not in this account read' : 'of 5'}
              </div>
            </div>
            <div className="flex gap-1.5 pb-1.5" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-5"
                  style={{
                    clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
                    background: level !== null && i < level ? THREAT : 'oklch(1 0 0 / 0.09)',
                  }}
                />
              ))}
            </div>
          </div>

          <div className="min-w-0">
            <div className="mo-in-left flex flex-wrap items-center gap-2" style={{ animationDelay: '60ms' }}>
              <span className="eyebrow" style={{ color: THREAT }}>
                active nemesis
              </span>
              <Flag hue={lineage.hue}>{lineage.hunter}</Flag>
              {active.weakened && <Flag>weakened</Flag>}
              {active.secondInCommand && <Flag hue="var(--color-tenno-400)">on call</Flag>}
            </div>

            <h2
              className="mo-in-up mt-2 font-[family-name:var(--font-title)] text-[length:var(--text-title)] leading-[1.1] tracking-[0.1em] uppercase"
              style={{ color: 'var(--color-orokin-200)', animationDelay: '80ms' }}
            >
              {lineage.hunter}
              <span className="ml-3 align-middle text-[length:var(--text-small)] tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
                {lineage.house}
              </span>
            </h2>

            <p
              className="mo-in-up mt-3.5 max-w-[68ch] text-[length:var(--text-body)] leading-snug"
              style={{ color: 'var(--text)', animationDelay: '120ms' }}
            >
              {directive}
            </p>

            {/* Requiem row — the actionable half of the dossier. */}
            <div className="mt-5 grid grid-cols-3 gap-[3px] sm:max-w-[24rem]">
              {[0, 1, 2].map((i) => (
                <RequiemLock key={i} index={i} revealed={i < active.hintsRevealed} />
              ))}
            </div>

            <div className="mo-in-up mt-5 grid grid-cols-2 gap-x-6 gap-y-3.5 sm:grid-cols-4" style={{ animationDelay: '340ms' }}>
              {/*
                * Both of these name a thing the app can open, and both were
                * dead text - ten lines below a list whose every node links to
                * the star chart. Linked only when the lookup actually resolved:
                * an unresolved id renders as before rather than as a control
                * that goes nowhere. Same rule as the worldstate node names.
                */}
              <Field
                label="Born at"
                value={
                  active.birthNode === null ? null : birthName === null ? (
                    active.birthNode
                  ) : (
                    <GoLink kind="node" id={active.birthNode} title={`Show ${birthName} on the star chart`}>
                      {birthName}
                    </GoLink>
                  )
                }
              />
              <Field
                label="Spawned from"
                value={
                  suit === null ? suitName : (
                    <GoLink kind="item" id={suit.name} title={`Find ${suit.name} in the collection`}>
                      {suit.name}
                    </GoLink>
                  )
                }
                hint={active.killingSuit ?? undefined}
              />
              {/*
                * One cell, not two: "Age" was this cell's hover hint promoted to
                * a neighbour. The two nulls are independent - `createdMs` can be
                * present while `age` is not, because age also needs the read
                * time - so the date alone is a valid state and "nulld ago" is
                * never printed. Age is measured from the account read, which the
                * footer dates.
                */}
              <Field
                label="Created"
                value={
                  active.createdMs === null
                    ? null
                    : age === null
                      ? CLOCK.format(active.createdMs)
                      : `${CLOCK.format(active.createdMs)} · ${age}d ago`
                }
              />
              <Field label="Parazon attempts" value={active.guesses.toLocaleString()} />
            </div>

            {/*
              * NESTED PROPERLY, RATHER THAN AS A HAND-ROLLED FOLD.
              *
              * This was a bespoke `rf-row` button over an `rf-reveal` grid —
              * the same summary/answer/body shape `Disclosure` exists for. What
              * `Disclosure` adds is the ANSWER: the closed row now says how far
              * the murmurs have got, so a reader who never opens it has still
              * been told the one thing this drawer is for. Closed, it said
              * "Hunt so far" and nothing else.
              */}
            <div className="mo-in-up mt-3">
              <Disclosure
                depth={1}
                accent={THREAT}
                eyebrow="hunt so far"
                summary="Missions, thralls and murmur progress"
                answer={
                  <span className="numeric">
                    {active.missionCount === null ? 'not in this read' : `${active.missionCount.toLocaleString()} missions`}
                  </span>
                }
              >
                <div className="grid grid-cols-2 gap-x-6 gap-y-3.5 sm:grid-cols-4">
                  <Field
                    label="Missions faced"
                    value={active.missionCount === null ? null : active.missionCount.toLocaleString()}
                  />
                  <Field
                    label="Thralls killed"
                    value={active.henchmenKilled === null ? null : active.henchmenKilled.toLocaleString()}
                  />
                  <Field
                    label="Murmur progress"
                    value={active.hintProgress === null ? null : active.hintProgress.toLocaleString()}
                    hint="The game reports murmur progress as a raw count with no documented scale, so it is shown unconverted."
                  />
                </div>
              </Disclosure>
            </div>
          </div>
        </div>

        {/*
          THE HONEST GAP, NESTED.

          Written for a player, not for whoever wrote the parser: this band used
          to say "The account stores manifest indices, not item types" and then
          print WeaponIdx 7 and a raw /Lotus/ path. All three are true and none
          of them are the player's business.

          The refusal itself — "the drop cannot be named" — stays on the closed
          row, because that IS the fact and hiding it would be the dishonesty
          this panel exists to avoid. The two sentences explaining what the
          account does and does not record are the provenance, and provenance is
          exactly what a third level is for.
        */}
        <div
          className="mo-in-up relative"
          style={{ background: 'oklch(0.06 0.015 275 / 0.78)', boxShadow: 'inset 0 1px 0 0 oklch(1 0 0 / 0.06)' }}
        >
          <Disclosure
            depth={1}
            accent="var(--color-signal-warn)"
            eyebrow="weapon & ephemera unknown"
            summary="This nemesis's drop cannot be named"
            answer="why not"
          >
            <div className="max-w-[70ch] text-[length:var(--text-micro)] leading-snug" style={{ color: 'var(--text-muted)' }}>
              <Clamp lines={2}>
                Your account records only a reference to the drop, not its name, so this nemesis cannot be told apart
                from another carrying different loot. Everything else on this page is read directly and is exact.
              </Clamp>
            </div>
          </Disclosure>
        </div>
      </div>
    </section>
  );
}

/**
 * No lich hunting you.
 *
 * Deliberately one quiet row rather than a hero plate: nothing on this panel is
 * urgent while this is true, and a large card saying "nothing is happening"
 * spends the panel's whole hierarchy on an absence.
 */
function NoNemesis() {
  return (
    <section
      className="rf-plate mo-field mo-sheen mo-in-up relative flex flex-wrap items-baseline gap-x-5 gap-y-1.5 px-5 py-4"
      style={{ clipPath: CHAMFER, background: PLATE }}
    >
      <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: 'var(--color-signal-good)' }} />
      <span className="eyebrow" style={{ color: 'var(--color-signal-good)' }}>
        no active nemesis
      </span>
      <span
        className="font-[family-name:var(--font-display)] text-[length:var(--text-body)] font-semibold"
        style={{ color: 'var(--text)' }}
      >
        Nothing is hunting you
      </span>
      <div className="max-w-[70ch] text-[length:var(--text-small)]" style={{ color: 'var(--text-muted)' }}>
        {/* A div, not a span: `Clamp` renders a block, and a block inside an
            inline element is markup the browser recovers from unpredictably. */}
        <Clamp lines={1}>
          Execute a Kuva Larvling, a Corpus Candidate or a Technocyte host to open a new hunt. No mission rewards are
          being taxed and no nodes are held.
        </Clamp>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- territory */

interface TerritoryRow {
  node: string;
  name: string;
  planet: string | null;
  influence: number | null;
}

/** Star-chart territory. Bars are relative — see the header note. */
function Territory({ rows }: { rows: readonly TerritoryRow[] }) {
  // The units of `Influence` are undocumented, so the only honest normaliser is
  // the strongest node in this player's own set.
  const peak = rows.reduce((m2, r) => Math.max(m2, r.influence ?? 0), 0);

  return (
    <section className="mo-arrive min-w-0">
      <SectionTitle count={rows.length} note="bars relative">
        Nodes held
      </SectionTitle>

      {rows.length === 0 ? (
        <div className="rf-plate px-5 py-4" style={{ clipPath: CHAMFER, background: PLATE }}>
          <p className="wf-note">
            This nemesis has not spread onto the star chart yet, or the influence list has not been pushed.
          </p>
        </div>
      ) : (
        <ul className="mo-stagger flex flex-col gap-[3px]">
          {rows.map((r, i) => (
            <li
              key={r.node}
              className="mo-in-left"
              style={{ '--i': Math.min(i, 12) } as React.CSSProperties}
            >
              {/*
               * A held node is a PLACE, and until now it was a line of text. The
               * whole point of the panel is "your nemesis is out there" - being
               * unable to go and look at where is the obvious missing verb.
               *
               * `--rf-row-accent` carries the nemesis threat colour into the
               * shared hover treatment, so this row lights up red where a
               * resource row lights up gold. The highlight stays informative
               * instead of becoming generic chrome.
               */}
              <button
                type="button"
                onClick={() => {
                  goTo('node', r.node, r.name);
                }}
                title={`Show ${r.name} on the star chart`}
                className="rf-clipped rf-row mo-sheen mo-lift mo-focusable block w-full py-2.5 pr-4 pl-4 text-left"
                style={{ clipPath: CHAMFER, background: PLATE, '--rf-row-accent': THREAT } as React.CSSProperties}
              >
              <div className="flex items-baseline gap-3">
                <span className="min-w-0 flex-1 text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
                  {r.name}
                  {r.planet !== null && <span style={{ color: 'var(--text-muted)' }}> · {r.planet}</span>}
                </span>
                <span className="numeric shrink-0 text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
                  {r.influence === null ? '—' : r.influence.toLocaleString()}
                </span>
              </div>
              <div className="mt-2">
                {/*
                 * `(r.influence ?? 0) / peak` used to run unconditionally, so a
                 * node whose payload omits `Influence` drew a bar at the same
                 * floor width (`Track`'s 2% minimum) as a node the game
                 * genuinely reported at zero. The number beside it already
                 * shows an em dash for exactly this case; the bar substituting
                 * zero underneath it contradicted that dash instead of
                 * matching it. No reading, no bar.
                 */}
                {r.influence !== null && <Track value={peak > 0 ? r.influence / peak : 0} color={THREAT} />}
              </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- record */

/**
 * The lifetime record. Always visible — a completionist counts these.
 *
 * `null` state is no account rather than an empty history, and the two are not
 * the same claim: "0 vanquished" says you have never beaten one.
 */
function Record({ state }: { state: NemesisState | null }) {
  const total = state === null ? null : state.historyTotal;
  const cells = [
    { label: 'Vanquished', value: state?.vanquished ?? null, ink: THREAT },
    { label: 'Converted', value: state?.converted ?? null, ink: 'var(--color-tenno-300)' },
    { label: 'Railjack on call', value: state?.onCall ?? null, ink: 'var(--color-orokin-300)' },
  ];

  return (
    <section className="mo-arrive min-w-0">
      {/* No "not measured" note: the four cells below are already dashes, and the
          banner states once, at the top of the panel, why. */}
      <SectionTitle {...(total === null ? { note: state === null ? 'needs your account' : 'not in this account read' } : { count: total, note: 'lifetime' })}>Record</SectionTitle>

      {/*
        TWO COLUMNS, NOT FOUR, AND THE BREAKPOINT WAS THE WRONG AXIS.

        `lg:grid-cols-4` is a VIEWPORT query, and the record no longer gets the
        viewport: it sits in the five-twelfths reference column beside the
        arsenal, which is about 420px wide at the 1280px the panel is measured
        at. Four cards in 420px is 105px each, and "Railjack on call" alone is
        wider than that as an eyebrow, so every card wrapped its own label to
        three lines while the viewport-width query happily reported "large".
        Two columns fit the column this actually lives in.
      */}
      <div className="mo-stagger grid grid-cols-2 gap-[3px]">
        {cells.map((c, i) => (
          <div
            key={c.label}
            className="rf-plate mo-field mo-sheen mo-lift mo-in-up relative px-4 py-3"
            style={{ '--i': i, clipPath: CHAMFER, background: PLATE } as React.CSSProperties}
          >
            <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: c.ink, opacity: 0.75 }} />
            <div className="eyebrow">{c.label}</div>
            <div
              className="numeric mt-1.5 text-[length:var(--text-title)] leading-none"
              style={{ color: c.value === null ? 'var(--text-muted)' : c.ink }}
            >
              {c.value === null ? '—' : c.value.toLocaleString()}
            </div>
          </div>
        ))}

        <div className="rf-plate relative px-4 py-3" style={{ clipPath: CHAMFER, background: PLATE }}>
          <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: 'var(--text-faint)', opacity: 0.75 }} />
          <div className="eyebrow">Kill rate</div>
          <div className="numeric mt-1.5 text-[length:var(--text-title)] leading-none" style={{ color: 'var(--text)' }}>
            {state === null || state.vanquished === null || total === null || total === 0 ? '—' : `${Math.round((state.vanquished / total) * 100)}%`}
          </div>
          {/* No caption under the track: the two counts it would name sit in
              the cells beside it at four times the size, and the denominator is
              the section count. Nothing is left to say. */}
          {state !== null && state.vanquished !== null && total !== null && total > 0 && (
            <div className="mt-2.5">
              <Track value={state.vanquished / total} color={THREAT} />
            </div>
          )}
          {total === 0 && (
            <div className="mt-2.5 text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
              no nemesis resolved yet
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- arsenal */

interface WeaponRow {
  id: string;
  name: string;
  lineage: Lineage;
  slot: string;
  masteryReq: number;
  cap: number;
  owned: boolean;
  /** Highest rank ever reached, or `null` when the account carries no ledger. */
  rank: number | null;
}

interface LineageTally {
  lineage: Lineage;
  owned: number;
  total: number;
  maxed: number;
}

interface ArsenalData {
  rows: WeaponRow[];
  tallies: LineageTally[];
  /** True when the affinity ledger is absent, so ranks are unknown not zero. */
  noLedger: boolean;
  incomplete: boolean;
  /**
   * False when there is no account. The weapon list, its slots and its mastery
   * requirements are catalog facts and stay; `owned` is meaningless without
   * something to look them up in, so nothing is said about it.
   */
  measured: boolean;
}

function buildArsenal(inventory: RawInventory | null, db: ItemDb): ArsenalData {
  const owned = ownedTypes(inventory);
  const xp = ledger(inventory);
  const rows: WeaponRow[] = [];
  const tallies = new Map<string, LineageTally>(
    LINEAGES.map((l) => [l.key, { lineage: l, owned: 0, total: 0, maxed: 0 }]),
  );

  for (const entry of db.byType.values()) {
    if (!entry.masterable) continue;
    const lineage = LINEAGES.find((l) => entry.name.startsWith(l.prefix));
    if (!lineage) continue;

    const isOwned = owned.has(entry.uniqueName);
    const affinity = xp?.get(entry.uniqueName);
    const rank = affinity === undefined ? null : weaponRank(affinity, entry.maxRank);

    rows.push({
      id: entry.uniqueName,
      name: entry.name,
      lineage,
      slot: slotOf(entry),
      masteryReq: entry.masteryReq,
      cap: entry.maxRank,
      owned: isOwned,
      rank,
    });

    const tally = tallies.get(lineage.key);
    if (tally) {
      tally.total++;
      if (isOwned) tally.owned++;
      if (isOwned && rank !== null && rank >= entry.maxRank) tally.maxed++;
    }
  }

  rows.sort(
    (a, b) =>
      Number(a.owned) - Number(b.owned) || a.lineage.key.localeCompare(b.lineage.key) || a.name.localeCompare(b.name),
  );

  return {
    rows,
    tallies: [...tallies.values()],
    noLedger: xp === null,
    // Any missing catalog category makes every denominator below a floor, not a total.
    incomplete: db.missingCategories.length > 0,
    measured: inventory !== null,
  };
}

/** WFCD's `type` is the useful label ("Rifle", "Shotgun"); category is the fallback. */
function slotOf(entry: ItemDbEntry): string {
  return entry.type ?? entry.category;
}

function Arsenal({
  arsenal,
  highlight,
  db,
}: {
  arsenal: ArsenalData;
  highlight: Lineage | null;
  /** For the artwork and catalog facts an expanded row shows. */
  db: ItemDb | null;
}) {
  const measured = arsenal.measured;
  const columns = useMemo<ReadonlyArray<Column<WeaponRow>>>(
    () => [
      {
        key: 'name',
        header: 'Weapon',
        compare: (a, b) => a.name.localeCompare(b.name),
        render: (r) => (
          <span className="flex items-center gap-2">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rotate-45" style={{ background: r.lineage.hue }} />
            {/* Dimming an unowned name is itself a claim about ownership, so with
                nothing to check against every name reads at full weight. */}
            <span style={{ color: !measured || r.owned ? 'var(--text)' : 'var(--text-muted)' }}>{r.name}</span>
          </span>
        ),
      },
      {
        key: 'lineage',
        header: 'Hunt',
        width: '9rem',
        compare: (a, b) => a.lineage.key.localeCompare(b.lineage.key),
        render: (r) => <span style={{ color: r.lineage.hue }}>{r.lineage.hunter}</span>,
      },
      {
        key: 'slot',
        header: 'Slot',
        width: '7rem',
        compare: (a, b) => a.slot.localeCompare(b.slot),
        render: (r) => r.slot,
      },
      {
        key: 'mr',
        header: 'MR',
        align: 'right',
        width: '4rem',
        compare: (a, b) => a.masteryReq - b.masteryReq,
        render: (r) => r.masteryReq,
      },
      /*
       * Rank is the account's half of this table, so with no account the column
       * is dropped rather than filled.
       *
       * It used to render the same em-dash on all 50 rows AND carry the table's
       * initial sort — a sort control whose every key was identical, so pressing
       * it could not reorder anything. The four columns that remain are catalog
       * facts and all four sort for real.
       */
      ...(!measured
        ? []
        : [{
        key: 'rank',
        header: 'Rank',
        align: 'right' as const,
        width: '6rem',
        // Unowned sorts below every owned item; unknown-rank owned items sort above unowned.
        compare: (a: WeaponRow, b: WeaponRow) => rankScore(a) - rankScore(b),
        render: (r: WeaponRow) =>
          !r.owned ? (
            <span style={{ color: 'var(--text-muted)' }}>—</span>
          ) : r.rank === null ? (
            <span style={{ color: 'var(--color-signal-warn)' }} title="Owned, but the game has not sent item ranks.">
              owned
            </span>
          ) : (
            <span style={{ color: r.rank >= r.cap ? 'var(--color-signal-good)' : 'var(--text)' }}>
              {r.rank}/{r.cap}
            </span>
          ),
      }]),
    ],
    [measured],
  );

  /*
   * THE TALLY CARDS WERE A CONTROL WEARING A DIV.
   *
   * Three cards, each naming a lineage and counting the weapons in it, sat
   * directly above a fifty-row table of exactly those weapons — and clicking
   * one did nothing. The panel had already bucketed the table three ways,
   * drawn the buckets, and then made the reader scroll to use them. That plus
   * the territory rows were the entire interactive surface of a 1,151-line
   * file: two handlers.
   *
   * They are `<button aria-pressed>` now. Pressing one filters the table to
   * that hunt; pressing it again clears it. Keyboard reachable, announced as
   * pressed, and the focus ring blooms where it lands — none of which a div
   * with an onClick would have given.
   */
  const [lineage, setLineage] = useState<string>('all');
  const [owned, setOwned] = useState<'all' | 'owned' | 'missing'>('all');

  const rows = arsenal.rows.filter(
    (r) =>
      (lineage === 'all' || r.lineage.key === lineage) &&
      // Ownership can only be filtered on when there is something to check
      // against. Without an account `r.owned` is false for every row because
      // nothing was read, not because nothing is owned — filtering on it would
      // turn our own missing data into a claim about the player's collection.
      (!measured || owned === 'all' || (owned === 'owned' ? r.owned : !r.owned)),
  );

  return (
    <section className="mo-arrive">
      <SectionTitle
        count={rows.length}
        note={arsenal.incomplete ? 'catalog partial' : measured ? 'Kuva · Tenet · Coda' : 'catalog only'}
      >
        Nemesis arsenal
      </SectionTitle>

      <div className="mo-stagger grid gap-[3px] sm:grid-cols-3">
        {arsenal.tallies.map((t, i) => {
          const lit = highlight !== null && highlight.key === t.lineage.key;
          const on = lineage === t.lineage.key;
          return (
            <button
              key={t.lineage.key}
              type="button"
              aria-pressed={on}
              title={on ? `Show every hunt again` : `Show only ${t.lineage.hunter} weapons`}
              onClick={() => {
                setLineage(on ? 'all' : t.lineage.key);
              }}
              className="rf-clipped mo-field mo-sheen mo-lift mo-focusable mo-in-up relative w-full cursor-pointer px-4 py-3 text-left"
              style={{
                '--i': i,
                clipPath: CHAMFER,
                background: on
                  ? `color-mix(in oklab, ${t.lineage.hue} 14%, ${PLATE})`
                  : lit
                    ? `color-mix(in oklab, ${t.lineage.hue} 8%, ${PLATE})`
                    : PLATE,
                boxShadow: on ? `inset 0 0 0 1px color-mix(in oklab, ${t.lineage.hue} 45%, transparent)` : undefined,
              } as React.CSSProperties}
            >
              <span
                aria-hidden
                className="absolute top-0 bottom-0 left-0 w-[2px]"
                style={{ background: t.lineage.hue, opacity: on || lit ? 1 : 0.6 }}
              />
              {/*
                SPANS, NOT DIVS, AND THAT IS NOT PEDANTRY.
                A button may only contain phrasing content; a div inside one is
                invalid markup and browsers recover from it inconsistently. The
                card was a div, so it could nest whatever it liked. It is a
                control now, so its own layout has to be built out of inline
                elements set to flex.
              */}
              <span className="flex items-baseline justify-between gap-2">
                <span className="eyebrow" style={{ color: t.lineage.hue }}>
                  {t.lineage.key}
                </span>
                {lit && (
                  <span className="eyebrow" style={{ color: THREAT }}>
                    hunting now
                  </span>
                )}
                {on && !lit && (
                  <span className="eyebrow" style={{ color: t.lineage.hue }}>
                    filtering
                  </span>
                )}
              </span>
              {/*
                SIX OF THE ELEVEN DASHES WERE HERE, AND THE CARDS HAD A REAL
                NUMBER TO PRINT THE WHOLE TIME.

                Measured at 1280x720 with no account read, this panel showed
                eleven em-dash readouts before the player learned anything, and
                three of these cards contributed two each: a dash over the
                family total for owned, and a bare dash where "n maxed" goes.
                Both are honest —
                neither is knowable without an account — but the denominator
                beside them never needed one. `t.total` is a catalog fact, the
                same fact the table underneath is built from, and printing it as
                the numeral says strictly more than a dash over it did.

                So with no account the card states the size of the family, and
                the ownership half of it stays absent rather than dashed: the
                banner at the top of the panel states once, in a sentence, that
                the account has not been read. It does not need repeating three
                times in punctuation.
              */}
              <span className="mt-1.5 flex items-baseline gap-1">
                <span className="numeric text-[length:var(--text-lead)] leading-none" style={{ color: 'var(--text)' }}>
                  {measured ? t.owned : t.total}
                </span>
                {measured ? (
                  <span className="numeric text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
                    /{t.total}
                  </span>
                ) : (
                  <span className="text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
                    in the catalog
                  </span>
                )}
              </span>
              {/* No track without an account: an empty bar reads as "you own none
                  of these", which is a claim we have no basis for. */}
              {measured && (
                <span className="mt-2.5 block">
                  <Track value={t.total > 0 ? t.owned / t.total : 0} color={t.lineage.hue} />
                  <span
                    className="numeric mt-1.5 block text-[length:var(--text-micro)]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {t.maxed} maxed
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/*
        The second half of the control: which of them you already hold. Only
        offered when there is an account to check against — see the filter
        above. Without one the row states why instead of showing a control that
        would answer from our own missing data.
      */}
      <div className="mt-[3px] flex flex-wrap items-center justify-between gap-3">
        <span className="eyebrow">
          {lineage === 'all' ? 'every hunt' : `${lineage} only`} · {rows.length} shown
        </span>
        {measured ? (
          <Segmented
            label="Which weapons to show"
            value={owned}
            onChange={setOwned}
            accent={THREAT}
            options={[
              { id: 'all', label: 'All', badge: arsenal.rows.length, hint: 'Every nemesis weapon in the catalog' },
              {
                id: 'owned',
                label: 'Owned',
                badge: arsenal.rows.filter((r) => r.owned).length,
                hint: 'Weapons your account carries',
              },
              {
                id: 'missing',
                label: 'Missing',
                badge: arsenal.rows.filter((r) => !r.owned).length,
                hint: 'Weapons your account does not carry',
              },
            ]}
          />
        ) : (
          <span className="eyebrow" style={{ color: 'var(--color-signal-warn)' }}>
            owned / missing needs your account
          </span>
        )}
      </div>

      {/* No height cap: the table flows in the page and the panel scrolls as one
          document. The 120-row limit with "show more" is what bounds it. */}
      <div className="rf-plate mt-[3px]" style={{ clipPath: CHAMFER, background: PLATE }}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          initialSort={measured ? 'rank' : 'mr'}
          /*
           * Nemesis weapons are the one part of the arsenal where the rank
           * ceiling actually matters, and the table could only show the number.
           * Opening a row states what that ceiling costs and how far this
           * account has got, using the same item layout as every other panel.
           */
          expand={(r) => (
            <ItemDetail
              entry={db?.byDisplayName.get(r.name) ?? null}
              name={r.name}
              owned={measured ? r.owned : null}
              extra={[
                // Only what the row above cannot say. Slot, rank cap and mastery
                // rank are catalog facts ItemDetail already states; the lineage
                // is the Hunt cell thirty pixels up and the first word of the
                // name beside it. Each of those printed twice on one card.
                //
                // Best rank survives for ONE case: an unowned weapon whose
                // affinity ledger entry outlived the sale. The Rank cell shows a
                // dash for it, so this line is the only statement of the rank
                // the account once reached. For an owned weapon the cell already
                // prints it. `rank` is null without a ledger, and null is not 0.
                { label: 'Best rank', value: r.rank === null ? '' : `${String(r.rank)} of ${String(r.cap)}`, when: r.rank !== null && !r.owned },
              ]}
            />
          )}
          empty={
            /*
             * An empty table now has two possible causes and they are not the
             * same claim. "The catalog carries no nemesis rows" is a fault in
             * the download; "nothing matches the filter you pressed" is the
             * control working. Saying the first when the second is true would
             * report a data failure that has not happened.
             */
            arsenal.rows.length === 0 ? (
              <EmptyState
                title="No nemesis weapons in the catalog"
                detail="The item catalog loaded but carries no Kuva, Tenet or Coda rows — the download was incomplete, or the source changed shape."
              />
            ) : (
              <EmptyState
                title="Nothing matches those filters"
                detail="Every nemesis weapon is still here — press the lit hunt card again, or set the owned filter back to All."
              />
            )
          }
        />
      </div>

      {/* The no-account clause used to live here too. The banner at the top of
          the panel already says the account has not been read; repeating it under
          the table was the eighth statement of it on one screen. */}
      <div className="mt-2.5 max-w-[92ch] text-[length:var(--text-micro)] leading-snug" style={{ color: 'var(--text-muted)' }}>
        <Clamp lines={2}>
          Grouped by weapon family. Some Tenet melee weapons are bought from Ergo Glast rather than dropped by a Sister.
          {measured && arsenal.noLedger
            ? ' The game has not sent item ranks, so these read as owned rather than as a rank.'
            : ''}
        </Clamp>
      </div>
    </section>
  );
}

function rankScore(r: WeaponRow): number {
  if (!r.owned) return -1;
  return r.rank === null ? 0 : r.rank + 1;
}

/* -------------------------------------------------------------------- shell */

/**
 * The panel WITHOUT an account.
 *
 * The Kuva, Tenet and Coda weapon lists are catalog data and are the bulk of
 * this panel; the hunt, the territory and the lifetime record are the account's.
 * So the arsenal renders in full and the rest is marked unmeasured — in
 * particular there is no "nothing is hunting you", which would be a claim.
 */
function AccountBanner() {
  const running = useAccount((s) => s.gameRunning);
  const gep = useAccount((s) => s.gep);

  const [title, detail] = !running
    ? [
        'Showing the arsenal, the hunt unmeasured',
        'Every Kuva, Tenet and Coda weapon is game data and is listed below. Whether one is hunting you, and what you have already beaten, are not: run Warframe once and they are captured and kept.',
      ] as const
    : gep === 'connected'
      ? [
          'Linked — waiting for your account',
          'Your account arrives on the next update the game pushes.',
        ] as const
      : [
          'Linking to the game',
          'Establishing the game-events connection. This usually takes a few seconds after launch.',
        ] as const;

  return (
    <section
      className="mo-in-up"
      style={{
        clipPath: CHAMFER,
        background: 'linear-gradient(168deg, oklch(0.17 0.03 80 / 0.55), oklch(0.12 0.02 70 / 0.6))',
        boxShadow: 'inset 2px 0 0 var(--color-orokin-500)',
      }}
    >
      <Disclosure summary={title} eyebrow="account" answer="what would change it" accent="var(--color-orokin-300)">
        <div className="text-[length:var(--text-small)] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          <Clamp lines={2}>{detail}</Clamp>
        </div>
        {/*
          THE FIVE DASHES THAT WERE TWO WHOLE SECTIONS, SAID ONCE.

          Below this banner there used to be a band printing "active nemesis —"
          and, under it, the lifetime record printing four more dashes. All five
          were dashes for the SAME reason — nothing has been read — which the
          summary line above already states. Two sections saying one thing in
          punctuation is most of what made this panel measure 2,449px in a 672px
          viewport, with eleven em-dash readouts in front of anything a player
          could learn from.

          Nothing is lost: every label those sections carried is named here, one
          click from the closed row, and all five reappear as real numbers the
          moment there is an account to read them from.
        */}
        <p className="wf-note mt-2.5">
          Needs your account, so it is not shown yet: whether a nemesis is hunting you and which lineage, the star-chart
          nodes it holds, and the lifetime record — vanquished, converted, Railjack on call and kill rate.
        </p>
      </Disclosure>
    </section>
  );
}

/*
 * `HuntNotMeasured` LIVED HERE AND IS GONE ON PURPOSE.
 *
 * It was a full plate whose entire content was the word "active nemesis" and an
 * em dash. The banner directly above it already said the account had not been
 * read, so the dash was the same fact a second time, in punctuation, occupying a
 * whole section of a panel that measured 3.89 screens. Its one label is now
 * named in the banner's own disclosure, which is one click from the closed row.
 */

export default function NemesisPanel() {
  const inventory = useAccount((s) => s.inventory);
  const inventoryAt = useAccount((s) => s.inventoryAt);
  const db = useItemDb();
  const loaded = useCatalog();

  // The inventory object identity changes only when the underlying bytes change,
  // so every derivation below recomputes exactly as often as it must.
  const state = useMemo(() => (inventory ? nemesisState(asAccount(inventory)) : null), [inventory]);

  const territory = useMemo<TerritoryRow[]>(() => {
    if (!inventory) return [];
    const nodes = asAccount(inventory).Nemesis?.InfNodes ?? [];
    const byId = loaded?.catalog.nodeById;
    const rows: TerritoryRow[] = [];
    for (const n of nodes) {
      const id = typeof n?.Node === 'string' ? n.Node : null;
      if (id === null) continue;
      const entry = byId?.get(id);
      rows.push({
        node: id,
        name: entry?.name ?? id,
        planet: entry?.planet ?? null,
        influence: typeof n.Influence === 'number' && Number.isFinite(n.Influence) ? n.Influence : null,
      });
    }
    return rows.sort((a, b) => (b.influence ?? 0) - (a.influence ?? 0) || a.name.localeCompare(b.name));
  }, [inventory, loaded]);

  // The weapon lists are catalog; only the join onto them needs an account.
  const arsenal = useMemo(() => (db ? buildArsenal(inventory, db) : null), [inventory, db]);

  const active = state?.active ?? null;
  const lineage = active === null ? null : lineageOf(active.faction);

  const nodeName = (id: string | null): string | null =>
    id === null ? null : (loaded?.catalog.nodeById.get(id)?.name ?? null);

  /*
   * THE FOOTER ONLY EXISTS WHEN IT HAS SOMETHING TO SAY.
   *
   * All three of its children are caveats, and on a cold launch — no account
   * read, complete star chart, complete catalog — every one of them is false.
   * It still rendered: an empty `<footer>` with `pt-2`, plus the column gap
   * above it. In a growing column that was invisible; in a fixed-height grid it
   * is a track and a gap, about 24px of a 672px viewport spent on an element
   * with no content. So the row is only laid out when one of the three fires.
   */
  const hasFooter =
    inventoryAt !== null ||
    (loaded !== null && !loaded.status.nodes) ||
    (db !== null && db.missingCategories.length > 0);

  return (
    /*
     * ONE SCREEN. THE PAGE DOES NOT MOVE; THE REFERENCE DOES.
     *
     * THE MEASUREMENT THAT FORCED THIS. Driven through a real browser at
     * 1280x720 with no account read — which is what the owner sees on every
     * launch before the game has been run once — this panel emitted 2,449px
     * into a 672px viewport. Three point eight nine screens, and eleven em-dash
     * readouts stacked in front of the only thing on it that was actually
     * knowable: the Kuva, Tenet and Coda weapon lists, which are catalog data
     * and need no account at all. The player scrolled four screens of "we do
     * not know" to reach the one section that did.
     *
     * The shape is the same one the Platinum panel was rebuilt to: a grid with
     * a FIXED height, so the page itself can never scroll, and the long list
     * scrolls inside its own pane instead of pushing everything above it off
     * the top.
     *
     *   - ROW 1 is the ANSWER and is pinned. Exactly one of three things: the
     *     dossier when something is hunting you, the quiet "nothing is hunting
     *     you" band when nothing is, and the account banner when we have not
     *     read you yet. It never scrolls away, because it is the one thing on
     *     this panel a player opens it to find out.
     *   - ROW 2 is REFERENCE. The fifty-row arsenal is legitimately long and is
     *     a thing to look up, so it gets the wide column and its own scroller;
     *     the territory and the lifetime record are short lookups and take the
     *     narrow one. Neither can push the answer off the screen any more.
     *
     * `min-h-0` on EVERY row and column of the chain is what makes that true
     * and is the easy thing to leave out: a grid child defaults to
     * `min-height: auto` and refuses to shrink below its content, so one
     * missing `min-h-0` anywhere and the whole thing grows again and the page
     * scrolls exactly as before, with nothing visible to say anything is wrong.
     *
     * The padding drops from `p-6` to `p-5` and the gaps from 6 to 4/5 for the
     * same reason they did on Platinum: at 672px of viewport, 8px of outer
     * padding is a row of the table.
     */
    <div
      className={
        hasFooter
          ? 'grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,auto)_minmax(9rem,1fr)_auto] gap-4 p-5'
          : 'grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,auto)_minmax(9rem,1fr)] gap-4 p-5'
      }
    >
      {/*
        ROW 1 — THE ANSWER, PINNED.

        Three states, ONE band, where there used to be two stacked: the banner
        and then, under it, a second plate restating the banner as a dash. The
        `state === null` branch is the cold launch the measurement above was
        taken on, and it is now a single row that says one honest sentence.
      */}
      {active !== null && lineage !== null ? (
        <Dossier active={active} lineage={lineage} db={db} nodeName={nodeName} nowRef={inventoryAt} />
      ) : state === null ? (
        <AccountBanner />
      ) : (
        <NoNemesis />
      )}

      {/*
        ROW 2 — REFERENCE, IN ITS OWN SCROLLERS.

        With no account there is nothing for the narrow column to hold: the
        territory needs a live nemesis and the record needs a read. A reserved
        five-twelfths of the window holding nothing reads as the panel being
        broken rather than as the app not knowing anything yet, so the column is
        not laid out at all and the arsenal — which is complete, catalog data,
        and the only thing on the screen with real numbers in it — takes the
        full width.
      */}
      <div
        className={
          state === null
            ? 'grid min-h-0 min-w-0 gap-5'
            : 'grid min-h-0 min-w-0 gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]'
        }
      >
        {/*
          `overflow-y-auto` here is also what keeps the track above it honest:
          a scroll container contributes zero to its grid track's minimum, so
          the auto row can never grow past the height the root grid gave it.
          Without it the pane sizes to fifty rows of table and the page is back
          where it started.
        */}
        <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto pr-1">
          {arsenal ? (
            <Arsenal arsenal={arsenal} highlight={lineage} db={db} />
          ) : (
            <section className="mo-arrive">
              <SectionTitle note="Kuva · Tenet · Coda">Nemesis arsenal</SectionTitle>
              <div className="rf-plate px-5 py-4" style={{ clipPath: CHAMFER, background: PLATE }}>
                <p className="wf-note">
                  Joining your account against the Kuva, Tenet and Coda weapon lists. This is cached after the first
                  launch.
                </p>
              </div>
            </section>
          )}
        </div>

        {state !== null && (
          <div className="flex min-h-0 min-w-0 flex-col gap-5 overflow-y-auto pr-1">
            {/* Same guard the old layout carried implicitly by living inside the
                "there is a lich" branch. Stated here because this column is now
                shared by both account states: `territory` is built from
                `Nemesis.InfNodes`, so with no lich it is empty and the section
                would render its "has not spread onto the star chart yet" plate
                beside a band that has just said nothing is hunting you. */}
            {active !== null && <Territory rows={territory} />}
            <Record state={state} />
          </div>
        )}
      </div>

      {hasFooter && (
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {inventoryAt !== null && <span className="eyebrow">account read {CLOCK.format(inventoryAt)}</span>}
          {loaded !== null && !loaded.status.nodes && (
            <span className="eyebrow" style={{ color: 'var(--color-signal-warn)' }}>
              no star chart data — nodes shown by id
            </span>
          )}
          {db !== null && db.missingCategories.length > 0 && (
            <span className="eyebrow" style={{ color: 'var(--color-signal-warn)' }}>
              catalog missing {db.missingCategories.join(', ')}
            </span>
          )}
        </footer>
      )}
    </div>
  );
}
