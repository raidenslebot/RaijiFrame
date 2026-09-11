/**
 * The syndicate standing ladder.
 *
 * `subsystems.syndicateState()` hands over the raw truth — tag, cumulative
 * standing, rank index, daily allowance. It deliberately stops there, because
 * turning a rank index into "12,400 more standing and you rank up" needs the
 * threshold table, which is game data rather than account data.
 *
 * That table lives here, transcribed from docs/research/subsystems.md §3, which
 * cross-checks `ExportSyndicates.json` against the wiki and records them as
 * agreeing exactly. Two facts from that research drive every number below and
 * are easy to get backwards:
 *
 *   1. `Affiliations[].Standing` is CUMULATIVE, not standing-within-rank. A
 *      rank-3 syndicate at 90,000 has 90,000 total, and needs 141,000 to reach
 *      rank 4 — not 141,000 more.
 *   2. Standing is HARD-CAPPED at the current rank's ceiling. Sitting at the
 *      ceiling means every point earned today is discarded until you rank up,
 *      which is the single most expensive thing this panel can fail to say.
 *
 * This module is pure and React-free so `scripts/check-syndicates-panel.ts` can
 * exercise it without a browser.
 */

import type { SyndicateStanding, SyndicateState } from '../../data/subsystems';

// ---------------------------------------------------------------------------
// Ladders
// ---------------------------------------------------------------------------

export interface Tier {
  readonly title: number;
  /** Cumulative standing at which this rank begins. */
  readonly min: number;
  /** Cumulative standing this rank holds at most — the earning ceiling. */
  readonly max: number;
}

/**
 * The standard five-rank ladder. Negative ranks exist only for the six original
 * faction syndicates, whose alignments can demote you; everyone else is clamped
 * to title 0 and up, which is why `tiersTo` takes a floor.
 */
const STANDARD_TIERS: readonly Tier[] = [
  { title: -2, min: -71_000, max: -27_000 },
  { title: -1, min: -27_000, max: -5_000 },
  { title: 0, min: -5_000, max: 5_000 },
  { title: 1, min: 5_000, max: 27_000 },
  { title: 2, min: 27_000, max: 71_000 },
  { title: 3, min: 71_000, max: 141_000 },
  { title: 4, min: 141_000, max: 240_000 },
  { title: 5, min: 240_000, max: 372_000 },
];

export type Ladder =
  | { readonly kind: 'tiers'; readonly tiers: readonly Tier[] }
  /** Evenly spaced ranks: Nightwave (10,000 each) and Kahl (literally 1 each). */
  | { readonly kind: 'linear'; readonly step: number; readonly maxTitle: number | null }
  /** Cephalon Simaris has no titles at all — just a 125,000 holding cap. */
  | { readonly kind: 'untiered'; readonly cap: number }
  /** A tag we have no verified thresholds for. Reported as a gap, never guessed. */
  | { readonly kind: 'unknown' };

function tiersTo(maxTitle: number, minTitle = 0): Ladder {
  return { kind: 'tiers', tiers: STANDARD_TIERS.filter((t) => t.title >= minTitle && t.title <= maxTitle) };
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export interface SyndicateSpec {
  readonly name: string;
  /**
   * Identity colour. OKLCH so it stays in the same perceptual space as
   * theme.css; the two tags whose colour genuinely *is* a system colour reuse
   * the token rather than re-stating it.
   */
  readonly color: string;
  readonly ladder: Ladder;
  /** Shown verbatim when the row's numbers need a caveat. */
  readonly note?: string;
  /**
   * The world this syndicate stands on, as the star chart spells it.
   *
   * Set ONLY where the syndicate has an overworld home that is a real planet in
   * the node data, because the panel turns it into a link and the chart opens a
   * world by exact name — an invented or misspelled one lands on an empty globe.
   * The six originals, Conclave, Simaris, Nightwave, Kahl, Nokko and the event
   * syndicate live on relays or nowhere in particular, and The Hex's Höllvania
   * is not a planet on the chart, so all of them are left without one.
   */
  readonly home?: string;
}

/** The six originals share `DailyAffiliation` and can be driven to negative ranks. */
const ORIGINAL = tiersTo(5, -2);
const STANDARD = tiersTo(5);

const SYNDICATES: Readonly<Record<string, SyndicateSpec>> = {
  SteelMeridianSyndicate: { name: 'Steel Meridian', color: 'oklch(0.62 0.15 40)', ladder: ORIGINAL },
  ArbitersSyndicate: { name: 'Arbiters of Hexis', color: 'oklch(0.84 0.04 250)', ladder: ORIGINAL },
  CephalonSudaSyndicate: { name: 'Cephalon Suda', color: 'oklch(0.66 0.20 335)', ladder: ORIGINAL },
  PerrinSyndicate: { name: 'The Perrin Sequence', color: 'oklch(0.70 0.13 200)', ladder: ORIGINAL },
  RedVeilSyndicate: { name: 'Red Veil', color: 'oklch(0.56 0.21 25)', ladder: ORIGINAL },
  NewLokaSyndicate: { name: 'New Loka', color: 'oklch(0.72 0.15 145)', ladder: ORIGINAL },

  CetusSyndicate: { name: 'Ostron', color: 'var(--color-orokin-400)', ladder: STANDARD, home: 'Earth' },
  SolarisSyndicate: { name: 'Solaris United', color: 'oklch(0.74 0.16 60)', ladder: STANDARD, home: 'Venus' },
  VoxSyndicate: { name: 'Vox Solaris', color: 'oklch(0.68 0.17 30)', ladder: STANDARD, home: 'Venus' },
  VentKidsSyndicate: { name: 'Vent Kids', color: 'oklch(0.78 0.17 100)', ladder: STANDARD, home: 'Venus' },
  QuillsSyndicate: { name: 'The Quills', color: 'oklch(0.66 0.14 285)', ladder: STANDARD, home: 'Earth' },
  EntratiSyndicate: { name: 'Entrati', color: 'oklch(0.64 0.13 300)', ladder: STANDARD, home: 'Deimos' },
  // Necraloid stops at rank 3 (ExportSyndicates: top maxStanding 141,000).
  NecraloidSyndicate: { name: 'Necraloid', color: 'oklch(0.72 0.09 195)', ladder: tiersTo(3), home: 'Deimos' },
  EntratiLabSyndicate: { name: 'Cavia', color: 'oklch(0.76 0.11 172)', ladder: STANDARD, home: 'Deimos' },
  ZarimanSyndicate: { name: 'The Holdfasts', color: 'oklch(0.86 0.07 95)', ladder: STANDARD, home: 'Zariman' },
  HexSyndicate: { name: 'The Hex', color: 'oklch(0.68 0.19 320)', ladder: STANDARD },
  ConclaveSyndicate: { name: 'Conclave', color: 'oklch(0.70 0.15 15)', ladder: STANDARD },

  // Kahl's "standing" is a rank counter: titles sit at 0,1,2,3,4,5 and the real
  // currency is KahlCreds in MiscItems. Rendering 3/372,000 would be nonsense.
  KahlSyndicate: {
    name: "Kahl's Garrison",
    color: 'oklch(0.68 0.11 125)',
    ladder: { kind: 'linear', step: 1, maxTitle: 5 },
    note: 'Standing is a rank counter here; the spendable currency is Kahl Credits.',
  },
  NightcapJournalSyndicate: {
    name: 'Nokko',
    color: 'oklch(0.74 0.10 135)',
    ladder: { kind: 'linear', step: 1, maxTitle: 5 },
    note: 'Shares the Kahl daily allowance.',
  },

  // Simaris has no titles: getMaxStanding() special-cases the tag to 125,000.
  LibrarySyndicate: {
    name: 'Cephalon Simaris',
    color: 'var(--color-tenno-400)',
    ladder: { kind: 'untiered', cap: 125_000 },
    note: 'No ranks — standing is a spendable balance capped at 125,000.',
  },

  EventSyndicate: {
    name: 'Operational Supply',
    color: 'var(--color-orokin-300)',
    ladder: { kind: 'unknown' },
    note: 'Event syndicate: no daily cap, and its rank thresholds are not known here.',
  },
};

/**
 * Nightwave. Every season is 10,000 standing per rank; the *max* title varies by
 * season and the current season is absent from the export we have, so the cap is
 * left null rather than asserted as 30 or 180.
 */
const NIGHTWAVE: SyndicateSpec = {
  name: 'Nightwave',
  color: 'oklch(0.60 0.21 22)',
  ladder: { kind: 'linear', step: 10_000, maxTitle: null },
  note: 'No daily cap. The season rank ceiling is not in the account data.',
};

/** `SteelMeridianSyndicate` -> `Steel Meridian`, for a tag we do not know. */
function prettify(tag: string): string {
  return tag
    .replace(/Syndicate$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
}

export function specFor(tag: string): SyndicateSpec {
  if (tag.startsWith('RadioLegion')) return NIGHTWAVE;
  return (
    SYNDICATES[tag] ?? {
      name: prettify(tag) || tag,
      color: 'var(--color-void-300)',
      ladder: { kind: 'unknown' },
      note: 'Unrecognised syndicate — rank thresholds unknown, so only standing held is shown.',
    }
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface SyndicateRow {
  readonly tag: string;
  readonly name: string;
  readonly color: string;
  readonly standing: number;
  readonly title: number | null;
  /** True when `title` was derived from standing because the payload omitted it. */
  readonly titleInferred: boolean;
  readonly maxTitle: number | null;
  readonly tierMin: number | null;
  readonly tierMax: number | null;
  /** Cumulative standing at which the next rank begins. */
  readonly nextAt: number | null;
  /** Standing still to earn before the next rank. */
  readonly toNext: number | null;
  /** 0..1 through the current rank, or through the holding cap for Simaris. */
  readonly progress: number | null;
  /** Sitting on the ceiling: further standing is discarded until you rank up. */
  readonly atCeiling: boolean;
  readonly maxed: boolean;
  readonly dailyRemaining: number | null;
  readonly dailyCap: number | null;
  /** Today's remaining allowance covers the whole gap to the next rank. */
  readonly rankUpToday: boolean;
  /** 0..1 — how far along the bar today's remaining allowance can carry you. */
  readonly reachToday: number | null;
  readonly sharedPool: boolean;
  readonly isNightwave: boolean;
  readonly initiated: boolean;
  readonly pledged: boolean;
  readonly note: string | null;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/**
 * `Title` is optional in the payload. When it is missing the rank is recovered
 * from cumulative standing, which the ladder makes exact — but the row says it
 * was inferred rather than presenting it as read.
 */
function tierFor(tiers: readonly Tier[], title: number | null, standing: number): { tier: Tier; inferred: boolean } | null {
  if (title !== null) {
    const exact = tiers.find((t) => t.title === title);
    if (exact) return { tier: exact, inferred: false };
  }
  const guess = tiers.find((t) => standing < t.max) ?? tiers[tiers.length - 1];
  return guess === undefined ? null : { tier: guess, inferred: true };
}

function withDaily(
  base: Omit<SyndicateRow, 'rankUpToday' | 'reachToday'>,
): SyndicateRow {
  const daily = base.dailyRemaining;
  const span = base.tierMin !== null && base.tierMax !== null ? base.tierMax - base.tierMin : null;
  return {
    ...base,
    rankUpToday: daily !== null && base.toNext !== null && !base.maxed && daily >= base.toNext,
    reachToday:
      daily === null || base.progress === null || span === null || span <= 0
        ? null
        : clamp01(base.progress + daily / span),
  };
}

export function buildRow(s: SyndicateStanding, pledged: string | null): SyndicateRow {
  const spec = specFor(s.tag);
  const shell = {
    tag: s.tag,
    name: spec.name,
    color: spec.color,
    standing: s.standing,
    dailyRemaining: s.dailyRemaining,
    dailyCap: s.dailyCap,
    sharedPool: s.sharedPool,
    isNightwave: s.isNightwave,
    initiated: s.initiated,
    pledged: pledged !== null && pledged === s.tag,
    note: spec.note ?? null,
  };

  if (spec.ladder.kind === 'tiers') {
    const { tiers } = spec.ladder;
    const found = tierFor(tiers, s.rank, s.standing);
    const last = tiers[tiers.length - 1];
    if (found === null || last === undefined) {
      return withDaily({
        ...shell,
        title: s.rank,
        titleInferred: false,
        maxTitle: null,
        tierMin: null,
        tierMax: null,
        nextAt: null,
        toNext: null,
        progress: null,
        atCeiling: false,
        maxed: false,
      });
    }
    const { tier, inferred } = found;
    const next = tiers[tiers.indexOf(tier) + 1] ?? null;
    return withDaily({
      ...shell,
      title: tier.title,
      titleInferred: inferred,
      maxTitle: last.title,
      tierMin: tier.min,
      tierMax: tier.max,
      nextAt: next?.min ?? null,
      toNext: next === null ? null : Math.max(0, next.min - s.standing),
      progress: clamp01((s.standing - tier.min) / (tier.max - tier.min)),
      atCeiling: s.standing >= tier.max,
      maxed: next === null && s.standing >= tier.max,
    });
  }

  if (spec.ladder.kind === 'linear') {
    const { step, maxTitle } = spec.ladder;
    const title = s.rank ?? Math.floor(s.standing / step);
    const capped = maxTitle !== null && title >= maxTitle;
    const min = title * step;
    const max = (title + 1) * step;
    return withDaily({
      ...shell,
      title,
      titleInferred: s.rank === null,
      maxTitle,
      tierMin: min,
      tierMax: capped ? min : max,
      nextAt: capped ? null : max,
      toNext: capped ? null : Math.max(0, max - s.standing),
      progress: capped ? 1 : clamp01((s.standing - min) / step),
      atCeiling: capped,
      maxed: capped,
    });
  }

  if (spec.ladder.kind === 'untiered') {
    const { cap } = spec.ladder;
    return withDaily({
      ...shell,
      title: null,
      titleInferred: false,
      maxTitle: null,
      tierMin: 0,
      tierMax: cap,
      nextAt: null,
      toNext: null,
      progress: clamp01(s.standing / cap),
      atCeiling: s.standing >= cap,
      maxed: false,
    });
  }

  return withDaily({
    ...shell,
    title: s.rank,
    titleInferred: false,
    maxTitle: null,
    tierMin: null,
    tierMax: null,
    nextAt: null,
    toNext: null,
    progress: null,
    atCeiling: false,
    maxed: false,
  });
}

/**
 * Rows sorted by how close the next rank is.
 *
 * Absolute standing remaining, not percentage: 400 short of rank 1 is genuinely
 * closer to a reward than 60% of the way through rank 4. Anything with no next
 * rank — maxed, untiered, unknown thresholds — sorts to the bottom, since there
 * is nothing there to be close to.
 */
export function buildRows(state: SyndicateState): SyndicateRow[] {
  return state.syndicates
    .map((s) => buildRow(s, state.pledged))
    .sort(
      (a, b) =>
        (a.toNext ?? Number.POSITIVE_INFINITY) - (b.toNext ?? Number.POSITIVE_INFINITY) ||
        b.standing - a.standing ||
        a.name.localeCompare(b.name),
    );
}

// ---------------------------------------------------------------------------
// Daily allowance
// ---------------------------------------------------------------------------

export interface DailyTotals {
  /** Standing still earnable today across every pool this account can read. */
  readonly remaining: number;
  /** Sum of the caps behind that number, so the meter has an honest denominator. */
  readonly cap: number;
  /** How many separate daily pools are counted above. */
  readonly pools: number;
  /**
   * Pools whose counter this build cannot map to a tag. They are excluded from
   * the totals and surfaced, because a silently short total reads as "nothing
   * left to earn" — the exact wrong conclusion.
   */
  readonly unmapped: string[];
}

/**
 * The six originals draw on one `DailyAffiliation` counter, so it is added once
 * no matter how many of them the account has joined. Nightwave has no cap at all
 * and is excluded rather than counted as zero.
 */
export function dailyTotals(state: SyndicateState, rows: readonly SyndicateRow[]): DailyTotals {
  let remaining = 0;
  let cap = 0;
  let pools = 0;
  const unmapped: string[] = [];

  if (state.sharedDaily.remaining !== null) {
    remaining += state.sharedDaily.remaining;
    cap += state.sharedDaily.cap ?? state.sharedDaily.remaining;
    pools += 1;
  }

  for (const row of rows) {
    if (row.sharedPool || row.isNightwave) continue;
    if (row.dailyRemaining === null) {
      unmapped.push(row.name);
      continue;
    }
    remaining += row.dailyRemaining;
    cap += row.dailyCap ?? row.dailyRemaining;
    pools += 1;
  }

  return { remaining, cap, pools, unmapped };
}
