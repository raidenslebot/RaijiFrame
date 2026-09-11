/**
 * The relic table as a drill, not a list.
 *
 * WHAT THIS REPLACES, AND WHY IT WAS THE WORST LIST IN THE APP
 * ───────────────────────────────────────────────────────────
 * The browser rendered one flat run of siblings — up to a hundred and fifty of
 * them — and each row carried a name and the words "6 rewards". Every relic has
 * six rewards, so that second fact is constant: the row carried ONE fact,
 * repeated down the screen. Refinement was a global filter, so choosing Radiant
 * hid three quarters of the table, and tier was another, so the two grouping
 * keys the data already has were both spent on hiding things.
 *
 * THREE PROBLEMS, ONE SHAPE
 * ─────────────────────────
 *   1. `Axi A1 Intact` and `Axi A1 Radiant` are separate rows in DE's table
 *      with DIFFERENT drop chances. Grouping them under one relic identity
 *      takes 3,089 rows down to 772 and turns the filter into a comparison.
 *   2. That comparison is the decision a player actually has. Refining costs
 *      Void Traces, and whether it pays is `expected(Radiant) −
 *      expected(Intact)` — computable from two reward tables the app already
 *      holds, needing no trace count at all, and never shown until now.
 *   3. Ranking the list needed a price for every relic, which is why it was
 *      never ranked. `priceRewardUniverse` inverts that: 591 reward items stand
 *      behind all 772 relics, so one pass prices everything and the list can
 *      sort on real expected platinum.
 *
 * THE NESTING IS THE POINT
 * ────────────────────────
 * Tier (0) → relic (1) → the four refinements and the reward table (2) → one
 * reward's market (3). Four levels, each a real disclosure, each a smaller type
 * step than its parent because `--disc-depth` drives the size. A reader who
 * keeps asking "how?" keeps getting an answer, which is the whole contract.
 *
 * COVERAGE RIDES ON EVERY NUMBER
 * ──────────────────────────────
 * A pass over 591 rewards takes minutes, so this renders while it is running.
 * That is only honest if a partial sum says it is partial: every expected value
 * carries how much of its own table was priced, and a relic under half priced
 * is marked rather than ranked as though its number were whole. An unpriced
 * relic shows no platinum figure at all — never a zero.
 */

import { useMemo, type ReactNode } from 'react';
import { Disclosure } from '../../ui/Disclosure';
import type { DucatDb } from '../../data/ducats';
import type { Price } from '../../data/market';
import { valueRelic, type Refinement, type Relic, type RelicValue } from '../../data/plat-value';
import { ListTail } from '../../ui/ListTail';

/** Cheapest to richest. DE's own order, and the order a player refines in. */
const STATES: readonly Refinement[] = ['Intact', 'Exceptional', 'Flawless', 'Radiant'];

/** One relic across all four of its refinements. */
interface Identity {
  tier: string;
  name: string;
  /** Valued per state; a state DE does not publish is simply absent. */
  byState: Map<Refinement, RelicValue>;
  /** The best expected platinum across states, and which state that was. */
  best: { state: Refinement; value: RelicValue } | null;
  /** Radiant minus Intact, when both are priced. What refining buys. */
  refineGain: number | null;
  /** Copies in the account, summed over every refinement. Null when unread. */
  held: number | null;
}

/** Count copies of each relic ItemType the account holds. Null when unread. */
function heldByType(inventory: Readonly<Record<string, unknown>> | null): Map<string, number> | null {
  if (inventory === null) return null;
  const misc = inventory['MiscItems'];
  if (!Array.isArray(misc)) return null;
  const out = new Map<string, number>();
  for (const row of misc) {
    if (row === null || typeof row !== 'object') continue;
    const held = row as Record<string, unknown>;
    const type = held['ItemType'];
    if (typeof type !== 'string') continue;
    // A row exists because the account holds the item, so a missing count is
    // one rather than none — the same reading the platinum panel already uses.
    const n = typeof held['ItemCount'] === 'number' && Number.isFinite(held['ItemCount']) ? held['ItemCount'] : 1;
    out.set(type, (out.get(type) ?? 0) + Math.max(0, Math.trunc(n)));
  }
  return out;
}

/**
 * Fold the table into one entry per relic identity, valued at every refinement.
 *
 * Ordered by the best expected platinum a relic reaches, so the top of the list
 * is the answer to "what is worth cracking" rather than whatever sorts first
 * alphabetically. Relics nothing could price fall to the bottom in name order
 * rather than being dropped: an unpriced relic is unknown, not worthless.
 */
export function foldIdentities(
  relics: readonly Relic[],
  prices: ReadonlyMap<string, Price>,
  ducats: DucatDb | null,
  inventory: Readonly<Record<string, unknown>> | null,
): Identity[] {
  const held = heldByType(inventory);
  const byKey = new Map<string, Identity>();

  for (const relic of relics) {
    const key = `${relic.tier} ${relic.name}`;
    let id = byKey.get(key);
    if (id === undefined) {
      id = { tier: relic.tier, name: relic.name, byState: new Map(), best: null, refineGain: null, held: null };
      byKey.set(key, id);
    }
    id.byState.set(relic.state, valueRelic(relic, prices, ducats));
    if (held !== null) id.held = (id.held ?? 0) + (held.get(relic.itemType) ?? 0);
  }

  for (const id of byKey.values()) {
    for (const state of STATES) {
      const v = id.byState.get(state);
      if (v === undefined || v.coverage === 0) continue;
      if (id.best === null || v.expected > id.best.value.expected) id.best = { state, value: v };
    }
    const intact = id.byState.get('Intact');
    const radiant = id.byState.get('Radiant');
    // Only when BOTH tables are priced to the same extent is the difference a
    // fact about refining rather than a fact about which one we know more of.
    id.refineGain =
      intact && radiant && intact.coverage > 0 && Math.abs(intact.coverage - radiant.coverage) < 0.01
        ? Math.round((radiant.expected - intact.expected) * 10) / 10
        : null;
  }

  return [...byKey.values()].sort(
    (a, b) =>
      (b.best?.value.expected ?? -1) - (a.best?.value.expected ?? -1) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}

/* ------------------------------------------------------------------ atoms */

function Fig({ n, unit, tone }: { n: number | null; unit: string; tone?: string }): ReactNode {
  if (n === null) return <span style={{ color: 'var(--text-ghost)' }}>—</span>;
  return (
    <span className="numeric" style={{ color: tone ?? 'var(--text)' }}>
      {n.toFixed(1)}
      <span className="eyebrow ml-0.5" style={{ color: 'var(--text-faint)' }}>
        {unit}
      </span>
    </span>
  );
}

/**
 * How much of this relic's table is priced, as words rather than a bar.
 *
 * A bar at 60% invites the reader to treat the number beside it as 60% true,
 * which is the wrong reading: the expected value is a floor that will only rise
 * as the rest lands. Saying which rewards are missing is the useful form.
 */
function Coverage({ v }: { v: RelicValue }): ReactNode {
  const priced = v.rewards.filter((r) => r.price !== null).length;
  const total = v.rewards.length;
  if (priced === total) return null;
  return (
    <span className="eyebrow" style={{ color: 'var(--color-signal-warn)' }}>
      {priced} of {total} priced
    </span>
  );
}

/**
 * The Ducat expectation, from whichever refinement carries one.
 *
 * Every state has the same reward ITEMS and different chances, so the figure
 * differs slightly between them; Intact is the one a player holds by default
 * and so the one this quotes. Null only when the Ducat table itself is absent.
 */
function ducatsOf(id: Identity): number | null {
  const v = id.byState.get('Intact') ?? [...id.byState.values()][0];
  if (v === undefined || v.ducatCoverage === 0) return null;
  return v.expectedDucats;
}

/**
 * The rare drop's chance in this refinement.
 *
 * This is the only figure that genuinely differs between the four states, and
 * it is the reason refining exists: the table marks exactly one reward `Rare`
 * per relic, and its chance climbs from 2% Intact to 10% Radiant while the
 * commons fall to make room. Null when the table names no rare at all, which is
 * a shape change rather than a missing value and must not read as a zero.
 */
function rareChance(v: RelicValue): number | null {
  const rare = v.rewards.find((r) => r.rarity.toLowerCase() === 'rare');
  return rare === undefined ? null : rare.chance;
}

/* ------------------------------------------------------------- the levels */

/** Depth 3: what the market says about one reward. */
function RewardMarket({ price }: { price: Price }): ReactNode {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 py-1">
      {[
        ['Median, last closed day', `${String(price.median)}p`],
        ['That day’s range', `${String(price.min)}p to ${String(price.max)}p`],
        ['Median across the window', `${String(price.trend)}p`],
        ['Closed that day', String(price.volume)],
      ].map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="eyebrow" style={{ color: 'var(--text-faint)' }}>
            {label}
          </dt>
          <dd className="numeric" style={{ color: 'var(--text-muted)' }}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Depth 2: one reward, its chance, its price, and what it contributes. */
function RewardRow({ reward }: { reward: RelicValue['rewards'][number] }): ReactNode {
  const summary = (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate" style={{ color: 'var(--text)' }}>
        {reward.item}
      </span>
      <span className="numeric shrink-0" style={{ color: 'var(--text-faint)' }}>
        {reward.chance.toFixed(2)}%
      </span>
    </span>
  );

  /*
   * A reward with no market entry is not worth zero — it is untradeable, or the
   * market has no closed trades for it. Those are different from each other and
   * both are different from "worth nothing", so each says which it is.
   */
  if (reward.price === null) {
    return (
      <div className="flex flex-wrap items-baseline gap-2 py-1 pl-3">
        {summary}
        <span className="eyebrow ml-auto" style={{ color: 'var(--text-ghost)' }}>
          {reward.slug === null ? 'not tradeable' : 'no closed trades'}
        </span>
        {reward.ducats !== null && (
          <span className="numeric" style={{ color: 'var(--color-orokin-300)' }}>
            {reward.ducats}d
          </span>
        )}
      </div>
    );
  }

  return (
    <Disclosure
      depth={3}
      summary={summary}
      answer={
        <span className="flex items-baseline gap-2">
          <Fig n={reward.expected} unit="p expected" tone="var(--color-orokin-200)" />
          <span className="numeric" style={{ color: 'var(--text-faint)' }}>
            {reward.price.median}p each
          </span>
        </span>
      }
    >
      <RewardMarket price={reward.price} />
    </Disclosure>
  );
}

/** Depth 2: one refinement of this relic, and what it returns. */
function StateRow({ state, v, baseline }: { state: Refinement; v: RelicValue; baseline: number | null }): ReactNode {
  const delta = baseline === null || v.coverage === 0 ? null : Math.round((v.expected - baseline) * 10) / 10;
  return (
    <Disclosure
      depth={2}
      eyebrow={state}
      summary={
        <span style={{ color: 'var(--text-muted)' }}>
          {/*
            "6 REWARDS" WAS A CONSTANT, PRINTED ON ALL FOUR ROWS.
            ————————————————————————————————————————————
            Every refinement of a relic holds the same reward ITEMS, so this
            summary rendered the identical string four times — which is verbatim
            the defect this file's own header opens by describing. Removed at
            depth 1 and reintroduced at depth 2, by the same hand, in the same
            change.

            The rare's chance is what actually differs between the four, and it
            is the whole reason a player refines at all: 2% at Intact climbing
            to 10% at Radiant. Null when the table names no rare — a shape
            change, not a zero.
          */}
          {rareChance(v) === null ? (
            <span style={{ color: 'var(--text-ghost)' }}>no rare in this table</span>
          ) : (
            <>
              <span className="numeric" style={{ color: 'var(--color-orokin-200)' }}>
                {rareChance(v)?.toFixed(2)}%
              </span>
              <span className="eyebrow ml-1.5" style={{ color: 'var(--text-faint)' }}>
                for the rare
              </span>
            </>
          )}
          {delta !== null && delta !== 0 && (
            <span className="numeric ml-2" style={{ color: delta > 0 ? 'var(--color-signal-good)' : 'var(--text-faint)' }}>
              {delta > 0 ? '+' : ''}
              {delta.toFixed(1)}p over Intact
            </span>
          )}
        </span>
      }
      answer={
        v.coverage === 0 ? (
          /*
            NOT FOUR IDENTICAL REFUSALS, WHICH IS WHAT THIS WAS.
            ————————————————————————————————————————————
            The pricing pass runs on a press and never on mount, so on the
            default screen every relic has zero platinum coverage at all four
            refinements — and this printed "not priced yet" four times, stacked,
            inside one opened relic.

            `RelicRow` fixes exactly this sixty lines below and says why: the
            Ducat expectation is EXACT, costs no request, was already in memory,
            and differs per refinement. It is the one figure that makes these
            four rows say four different things instead of one thing four times.
          */
          <span className="flex items-baseline gap-2">
            <Fig n={v.ducatCoverage === 0 ? null : v.expectedDucats} unit="d" tone="var(--color-orokin-400)" />
            <span className="eyebrow" style={{ color: 'var(--text-ghost)' }}>
              platinum not priced
            </span>
          </span>
        ) : (
          <span className="flex items-baseline gap-2">
            <Fig n={v.expected} unit="p" tone="var(--color-orokin-200)" />
            <Fig n={v.expectedDucats} unit="d" tone="var(--color-orokin-400)" />
            <Coverage v={v} />
          </span>
        )
      }
    >
      <div className="flex flex-col">
        {[...v.rewards]
          .sort((a, b) => (b.expected ?? -1) - (a.expected ?? -1) || b.chance - a.chance)
          .map((r) => (
            <RewardRow key={r.itemType} reward={r} />
          ))}
      </div>
    </Disclosure>
  );
}

/** Depth 1: one relic, across every refinement it has. */
function RelicRow({ id }: { id: Identity }): ReactNode {
  const intact = id.byState.get('Intact');
  const baseline = intact && intact.coverage > 0 ? intact.expected : null;

  return (
    <Disclosure
      depth={1}
      /*
       * NO TIER EYEBROW. The row sits inside its own tier's group, so printing
       * "Axi" on all 192 of them is the grouping key rendered once per row -
       * exactly the shape grouping replaces. `StandingValue` still does this
       * with its syndicate label on 120 rows; this is the pattern that fixes it.
       */
      summary={
        <span className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span style={{ color: 'var(--text)' }}>{id.name}</span>
          {/*
            The account fact, and it is the reason this row is worth ranking for
            THIS player rather than in general: a 90p relic you do not hold is
            trivia, and one you hold eleven of is tonight's plan.
          */}
          {id.held !== null && id.held > 0 && (
            <span className="numeric" style={{ color: 'var(--color-tenno-300)' }}>
              {id.held} held
            </span>
          )}
        </span>
      }
      answer={
        id.best === null ? (
          /*
           * NOT SILENT, AND NOT A ZERO EITHER.
           * ————————————————————————
           * The first build of this row printed "not priced yet" on every relic
           * before a pass had run - twelve identical refusals down one screen,
           * which is precisely the fault this rebuild exists to remove.
           *
           * The Ducat expectation is EXACT, is a different kind of fact from
           * the platinum estimate, and was already in memory with no request
           * made. So an unpriced relic still answers: it shows the floor it is
           * worth to the kiosk, and the missing platinum stays honestly absent
           * rather than being drawn as a zero or as a row of apologies.
           */
          <span className="flex items-baseline gap-2">
            <Fig n={ducatsOf(id)} unit="d" tone="var(--color-orokin-400)" />
            <span className="eyebrow" style={{ color: 'var(--text-ghost)' }}>
              platinum not priced
            </span>
          </span>
        ) : (
          <span className="flex flex-wrap items-baseline gap-2">
            <Fig n={id.best.value.expected} unit="p" tone="var(--color-orokin-200)" />
            <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
              at {id.best.state}
            </span>
            {id.refineGain !== null && id.refineGain > 0 && (
              <span className="numeric" style={{ color: 'var(--color-signal-good)' }}>
                +{id.refineGain.toFixed(1)}p to refine
              </span>
            )}
            <Coverage v={id.best.value} />
          </span>
        )
      }
    >
      <div className="flex flex-col">
        {STATES.map((s) => {
          const v = id.byState.get(s);
          return v === undefined ? null : <StateRow key={s} state={s} v={v} baseline={baseline} />;
        })}
      </div>
    </Disclosure>
  );
}

/* --------------------------------------------------------------- the tree */

export interface RelicTreeProps {
  relics: readonly Relic[];
  prices: ReadonlyMap<string, Price>;
  ducats: DucatDb | null;
  inventory: Readonly<Record<string, unknown>> | null;
  /** Name or reward substring. Empty shows everything. */
  query: string;
  /** Rows per tier before the group says how many more there are. */
  cap?: number;
}

/**
 * Depth 0: one tier, carrying its own aggregate so a closed group still answers.
 *
 * The cap is per GROUP rather than per list, which is the point of grouping: a
 * reader wanting Axi gets the best of Axi without Lith's hundred rows in front
 * of it, and the number left out is stated rather than silently truncated.
 */
export function RelicTree({ relics, prices, ducats, inventory, query, cap = 12 }: RelicTreeProps): ReactNode {
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = foldIdentities(relics, prices, ducats, inventory);
    const matched =
      q === ''
        ? all
        : all.filter(
            (id) =>
              `${id.tier} ${id.name}`.toLowerCase().includes(q) ||
              [...id.byState.values()].some((v) => v.rewards.some((r) => r.item.toLowerCase().includes(q))),
          );

    const byTier = new Map<string, Identity[]>();
    for (const id of matched) {
      const list = byTier.get(id.tier);
      if (list === undefined) byTier.set(id.tier, [id]);
      else list.push(id);
    }
    // Tiers ordered by the best relic in each, so the richest tier leads.
    return [...byTier.entries()].sort(
      (a, b) => (b[1][0]?.best?.value.expected ?? -1) - (a[1][0]?.best?.value.expected ?? -1) || a[0].localeCompare(b[0]),
    );
  }, [relics, prices, ducats, inventory, query]);

  if (groups.length === 0) {
    return (
      <p className="eyebrow px-2 py-4" style={{ color: 'var(--text-faint)' }}>
        {relics.length === 0 ? 'Reading the drop tables' : 'Nothing matches that filter'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {groups.map(([tier, ids]) => {
        const held = ids.reduce((n, id) => n + (id.held ?? 0), 0);
        const anyHeld = ids.some((id) => id.held !== null);
        const shown = ids.slice(0, cap);
        return (
          <Disclosure
            key={tier}
            depth={0}
            eyebrow={`${String(ids.length)} relics`}
            summary={tier}
            defaultOpen={groups[0]?.[0] === tier}
            answer={
              <span className="flex flex-wrap items-baseline gap-2">
                {ids[0]?.best ? (
                  <>
                    <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
                      best
                    </span>
                    <Fig n={ids[0].best.value.expected} unit="p" tone="var(--color-orokin-200)" />
                    {/*
                      THE COVERAGE RIDES ON THE HEADER TOO.
                      ————————————————————————————————————————————
                      `RelicRow` carries this and the group header did not, so
                      mid-pass the largest figure on a closed tier could be a
                      relic ranked on one of six priced rewards and labelled
                      flatly "best". This file's header promises the opposite:
                      "a relic under half priced is marked rather than ranked as
                      though its number were whole." It was marked one level
                      down and ranked as whole at the top.
                    */}
                    <Coverage v={ids[0].best.value} />
                  </>
                ) : (
                  <span className="eyebrow" style={{ color: 'var(--text-ghost)' }}>
                    not priced yet
                  </span>
                )}
                {/*
                  A MEASURED ZERO SAYS SO IN WORDS.
                  ————————————————————————————————————————————
                  `anyHeld` is true whenever the account was read at all — every
                  identity gets a non-null `held` in that case — so a tier the
                  player owns none of printed "Requiem · 0 held": a bare zero
                  beside a platinum figure, which reads as a null rather than as
                  the measurement it is. Arsenal and Resources both spell this
                  case out in words instead, and so does this now.
                */}
                {anyHeld &&
                  (held > 0 ? (
                    <span className="numeric" style={{ color: 'var(--color-tenno-300)' }}>
                      {held} held
                    </span>
                  ) : (
                    <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
                      none held
                    </span>
                  ))}
              </span>
            }
          >
            <div className="flex flex-col">
              {shown.map((id) => (
                <RelicRow key={`${id.tier}-${id.name}`} id={id} />
              ))}
              <ListTail hidden={ids.length - shown.length} noun={`${tier} relics`} ordered="ranked below these" />
            </div>
          </Disclosure>
        );
      })}
    </div>
  );
}
