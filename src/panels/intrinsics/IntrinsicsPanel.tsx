/**
 * INTRINSICS — Railjack and Drifter skill trees.
 *
 * Nine branches, ten ranks each, and every single rank is worth exactly 1,500
 * mastery XP (mastery-math.md §2.5). That flat rate is what makes this panel
 * worth building: intrinsics are the one mastery source where the account's
 * position and the ceiling are both knowable from the inventory alone, with no
 * catalog, no worldState and no guessing. So the panel commits to the number.
 *
 * The one thing it refuses to do is print 0/90 when `PlayerSkills` is simply
 * absent from the snapshot. A missing block and a fresh account produce
 * identical zeroes, and only one of them is a fact.
 *
 * THE ONE BOLD ELEMENT
 * ────────────────────
 * Ranks held against the ninety that exist, and — beside it — the branch whose
 * next rank costs the least. Intrinsic cost rises steeply with rank, so the
 * lowest branch is always the cheapest place to spend, and that pair is the
 * whole decision this panel exists to support. Everything else (the mastery
 * arithmetic, the nine branch tracks) is a dense, quiet readout underneath.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { useAccount } from '../../core/store';
import { MASTERY_PER_INTRINSIC_RANK, intrinsicsState, type IntrinsicTree } from '../../data/subsystems';
import { xpForRank } from '../../data/mastery';
import type { RawAccount } from '../../data/account';
import { cx } from '../../ui/orokin';
import { Facts } from '../../ui/interact';
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { Segmented } from '../shared/Segmented';
import { CHAMFER, PLATE_LIFT as PLATE } from '../../ui/geometry';

/** Railjack reads cyan in game, Duviri reads gold. Keeping that split makes the
    two trees separable at a glance without a second label. */
const RAILJACK_INK = 'var(--color-tenno-400)';
const DRIFTER_INK = 'var(--color-orokin-400)';


const int = (n: number): string => n.toLocaleString();

/** A whole percent that never lies at the edges: started is never 0%, unfinished is never 100%. */
const pct = (r: number): string =>
  r > 0 && r < 0.005 ? '<1%' : r < 1 && r >= 0.995 ? '99%' : `${Math.round(r * 100)}%`;

/** A number we could not measure. Never a zero — a zero reads as a measurement. */
const UNKNOWN = '—';

/** Sheared pip. Warframe never draws a rectangle where it can draw a slant. */
const PIP_CLIP = 'polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)';

/* ------------------------------------------------------------------- banner */

/**
 * The panel WITHOUT ranks to read.
 *
 * The nine branches, their names and their ten-rank caps are game data, as is
 * the 1,500-mastery-per-rank rate and the 135,000 the whole subsystem is worth.
 * Only the ranks held come from the account, so only those go unmeasured — and
 * an absent `PlayerSkills` block is treated exactly like an absent account,
 * since 0/90 and "not read" are the same picture and only one is a fact.
 */
function AccountBanner({ hasAccount }: { hasAccount: boolean }) {
  const running = useAccount((s) => s.gameRunning);
  const gep = useAccount((s) => s.gep);

  const [title, detail] = hasAccount
    ? ([
        'No intrinsic ranks in this account read',
        'This account read carries no intrinsic ranks at all, so the ranks below are unread rather than zero. The trees, their caps and the mastery each rank pays are game data and are shown in full.',
      ] as const)
    : !running
      ? ([
          'Showing both trees, ranks unmeasured',
          'Nine branches, ten ranks each, 1,500 mastery per rank — all game data. Which ranks you hold is not: run Warframe once and they are captured and kept, after which this panel stays accurate with the game closed.',
        ] as const)
      : gep === 'connected'
        ? ([
            'Linked — waiting for your account',
            'Intrinsic ranks appear with the next inventory push Warframe sends.',
          ] as const)
        : ([
            'Linking to the game',
            'Establishing the game-events connection. This normally takes a few seconds after launch.',
          ] as const);

  /*
   * NESTED, BECAUSE THE TITLE ALREADY ANSWERS IT.
   *
   * This banner was a heading and then a four-line paragraph, at the very top
   * of the panel, above the number the reader actually came for. The heading
   * says what state the panel is in; the paragraph says why and what would
   * change it, which is worth exactly one press to somebody who wants it and is
   * a wall to everybody else. Nothing is deleted - it moved one level down.
   */
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
        answer={hasAccount ? 'read, no ranks in it' : 'not read yet'}
        accent="var(--color-orokin-300)"
      >
        <div className="text-[length:var(--text-small)] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          <Clamp lines={2}>{detail}</Clamp>
        </div>
      </Disclosure>
    </section>
  );
}

/* ------------------------------------------------------------- SectionTitle */

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
        style={{
          background: 'var(--rule-hairline)',
        }}
      />
      {note !== undefined && <span className="eyebrow">{note}</span>}
    </header>
  );
}

/* ------------------------------------------------------------------ Segments */

interface SegmentsProps {
  filled: number;
  total: number;
  color: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * A rank track, not a percentage bar.
 *
 * An intrinsic rank is a discrete purchase, and showing 7/10 as 70% of a smooth
 * bar loses the fact that the eleventh rank does not exist. Ten pips say what
 * the tree actually is.
 *
 * Flat fills, no bloom: nine of these stacked with a glow each was the panel's
 * single largest source of visual noise, and the glow carried no information a
 * filled pip did not already carry.
 */
function Segments({ filled, total, color, className, style }: SegmentsProps) {
  return (
    /*
     * A SPAN, NOT A DIV, AND THAT IS NOT PEDANTRY.
     *
     * The pips moved into the branch row's disclosure SUMMARY, which is a real
     * `<button>`. A button may only contain phrasing content; a div inside one
     * is markup the browser recovers from in its own way, and the recovery is
     * not the same everywhere. `flex` on a span lays out identically and is
     * valid where this now lives.
     */
    <span className={cx('flex gap-[3px]', className)} style={style} aria-hidden>
      {Array.from({ length: total }, (_, i) => {
        const on = i < filled;
        return (
          <span
            key={i}
            className="h-[8px] min-w-0 flex-1"
            style={{
              clipPath: PIP_CLIP,
              background: on ? color : 'oklch(1 0 0 / 0.05)',
              // An unbought rank has to be legible as an EMPTY SLOT, not as
              // background: 2/10 must read as two of ten, never as a short bar.
              boxShadow: on ? undefined : 'inset 0 0 0 1px oklch(1 0 0 / 0.14)',
            }}
          />
        );
      })}
    </span>
  );
}

/* ---------------------------------------------------------------- BranchRow */

interface BranchRowProps {
  name: string;
  /** `null` with no account: the ten slots exist, what is in them does not. */
  rank: number | null;
  maxRank: number;
  color: string;
  /** Milliseconds before this row's entrance runs. */
  delay: number;
  /** The cheapest next rank on the whole panel — the one thing to spend on. */
  cheapest: boolean;
  /** Mastery XP between this player's rank and the next. Null without `PlayerLevel`. */
  step: number | null;
  /** The rank that step runs from, so the drawer can name it. Null when absent. */
  masteryRank: number | null;
}

function BranchRow({ name, rank, maxRank, color, delay, cheapest, step, masteryRank }: BranchRowProps) {
  const maxed = rank !== null && maxRank > 0 && rank >= maxRank;
  // The open/closed state moved into `Disclosure`, which owns it along with the
  // aria wiring and the rule that the body may never animate its height.

  /*
   * The arithmetic this panel is built on, per branch.
   *
   * Every intrinsic rank is worth exactly 1,500 mastery (mastery-math.md §2.5),
   * which is what makes intrinsics the one mastery source with no estimation in
   * it at all. The header states the whole tree's figure and the row states the
   * branch's; what was missing was the gap - how much is still in THIS branch,
   * which is the number that decides where the next point goes.
   *
   * Deliberately nothing about what a rank DOES. The app carries no intrinsic
   * ability text, and writing a plausible-sounding description of rank 7 Tactical
   * would be exactly the invented data this project forbids.
   */
  const ranksLeft = rank === null ? null : Math.max(0, maxRank - rank);
  const ink = cheapest ? 'var(--color-signal-good)' : color;

  /*
   * THE SECOND QUESTION, WHICH THIS ROW HAS NEVER ANSWERED.
   *
   * "Mastery left here" is a five-digit number, and five-digit numbers on this
   * screen mean nothing on their own - the panel already learned that once, at
   * the bottom of the arithmetic section, where the unearned pool is stated as a
   * share of the reader's own next rank step rather than as a bare figure.
   *
   * The same conversion is available per branch and is a DIFFERENT number in
   * each one, which is the test a nested level has to pass here: the drawer
   * above deliberately dropped "Per rank" and "Branch worth" for being the same
   * two constants in all nine drawers, and a level that repeated a constant
   * three deep would be the same fault wearing an indent.
   */
  const masteryLeft = ranksLeft === null ? null : ranksLeft * MASTERY_PER_INTRINSIC_RANK;
  /* One object rather than four parallel nullables: the drawer below needs all
     four together or none of them, and a `?? 0` on any one of them would be the
     fabricated zero this whole panel exists to refuse. */
  const worth =
    masteryLeft === null || masteryLeft === 0 || step === null || step <= 0 || masteryRank === null
      ? null
      : {
          share: masteryLeft / step,
          left: masteryLeft,
          step,
          rank: masteryRank,
        };

  /*
   * A DISCLOSURE, NOT A BESPOKE ROW.
   *
   * This was a hand-rolled `rf-row` button over an `rf-reveal` grid: the same
   * summary/answer/body shape `Disclosure` exists for, reimplemented, with its
   * own chevron and its own indent. `Disclosure` carries the rule that matters
   * - the body opens instantly at full height and only its children move - and
   * carries the depth rail, so a branch reads as sitting UNDER its tree rather
   * than as a list that drifted right.
   *
   * The pips stay in the summary rather than moving into the body. They are the
   * answer at a glance, and a closed row that says nothing is a row nobody
   * opens.
   *
   * A DISCLOSURE ONLY WHEN THERE IS SOMETHING BEHIND IT, though - see the
   * unread branch below, which is the same row without the chevron because
   * everything the drawer held needed a rank to exist.
   */
  /* The two halves of the row, built once because BOTH shapes below use them:
     an unread branch is not a drawer, but it is still the same row. */
  const title = (
    <span className="flex min-w-0 flex-col gap-1.5">
      <span
        className="font-[family-name:var(--font-display)] text-[length:var(--text-small)] font-semibold tracking-wide"
        style={{
          color: rank !== null && rank > 0 ? 'var(--text)' : 'var(--text-muted)',
        }}
      >
        {name}
      </span>
      {/* With no ranks read, the pips are still the honest shape of the
          branch — ten slots exist — so they are dimmed rather than
          dropped, and the numeral beside them says the fill is unknown
          rather than zero. */}
      <Segments
        className="w-[9rem]"
        filled={rank ?? 0}
        total={maxRank}
        color={color}
        style={rank === null ? { opacity: 0.45 } : undefined}
      />
    </span>
  );

  const answer = (
    <span className="flex flex-col items-end">
      <span
        className="numeric text-[length:var(--text-small)] leading-none"
        style={{
          color: rank !== null && rank > 0 ? color : 'var(--text-muted)',
        }}
      >
        {rank ?? UNKNOWN}
        <span style={{ color: 'var(--text-muted)' }}>/{maxRank}</span>
      </span>
      {/* The mastery a branch has paid is rank × 1,500 — with no rank read
          it is the SAME unknown as the line above it, and printing a
          second dash for it put nine redundant dashes down this column.
          One unknown, said once. */}
      {rank !== null && (
        <span className="numeric mt-1 text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
          {int(rank * MASTERY_PER_INTRINSIC_RANK)}
        </span>
      )}
    </span>
  );

  return (
    <li
      className="rf-plate mo-in-up relative"
      style={{
        clipPath: CHAMFER,
        background: PLATE,
        animationDelay: `${delay}ms`,
      }}
    >
      <span
        aria-hidden
        className="absolute top-0 bottom-0 left-0 z-10 w-[2px]"
        style={{
          background: ink,
          opacity: rank === null || rank > 0 || cheapest ? 1 : 0.4,
        }}
      />

      {rank === null ? (
        /*
         * NO DRAWER, BECAUSE THERE IS NOTHING BEHIND IT.
         *
         * Every branch drawer used to carry the same two-line paragraph when no
         * rank had been read - "the ten slots are game data, how many you hold
         * has not been captured yet" - which is nine copies of ONE fact about
         * the account, on a screen whose banner has already stated it in full
         * and whose section heading states it again. The eye stops reading a
         * sentence it has met nine times, and the branch NAMES, which are the
         * only thing that differs down this column, were what it stopped
         * reading.
         *
         * So the sentence is gone rather than shortened, and with it the drawer:
         * the two facts inside were "ranks left" and "mastery left here", both
         * of which need a rank, so an unread branch opened onto nothing but the
         * apology. A chevron over an empty region is a worse lie than a dash -
         * it promises an answer one press away and has none. The dash in the
         * answer column still says the value is unknown; the container says why.
         */
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          {title}
          <span className="ml-auto">{answer}</span>
        </div>
      ) : (
        <Disclosure
          depth={1}
          accent={ink}
          eyebrow={cheapest ? 'cheapest next rank' : maxed ? 'max' : undefined}
          summary={title}
          answer={answer}
        >
          <Facts
            /*
             * ONLY WHAT THE ROW ABOVE DOES NOT SAY.
             *
             * "Ranks held" was the row's own n/10 readout and "Mastery paid" was
             * its second line, so two of the seven were the row retyped. Two more
             * - "Per rank" and "Branch worth" - are the same two constants in all
             * nine drawers and are already on the section heading, so they said
             * nothing about the branch you opened. "Cheapest next rank" is
             * already the eyebrow.
             *
             * What is left is the one thing the row cannot show: how much mastery
             * is still sitting in THIS branch.
             */
            items={[
              {
                label: 'Ranks left',
                value: ranksLeft === null ? '' : String(ranksLeft),
                when: ranksLeft !== null,
              },
              {
                label: 'Mastery left here',
                value: masteryLeft === null ? '' : int(masteryLeft),
                when: masteryLeft !== null,
              },
            ]}
          />

          {/*
            THE LEVEL UNDER THE FACT, BECAUSE THE FACT INVITES A SECOND QUESTION.

            "Mastery left here: 10,500" is a number nobody can size. The panel
            already knows what sizes it - the step from this player's mastery
            rank to their next one - and states that comparison once, for the
            whole subsystem, at the bottom of the arithmetic section. Per branch
            it is a different answer in every drawer, so it is worth a level
            rather than a repeat, and it only exists when the account carries a
            rank to step from: no rank, no drawer, because a level with nothing
            under it is worse than no level.
          */}
          {worth !== null && (
            <Disclosure
              depth={2}
              accent={ink}
              eyebrow="toward your next mastery rank"
              summary="What that mastery is worth"
              answer={
                <span className="numeric" style={{ color: 'var(--color-orokin-300)' }}>
                  {worth.share >= 1 ? `${worth.share.toFixed(1)}×` : pct(worth.share)} of a rank
                </span>
              }
            >
              <p className="text-[length:var(--text-body)] leading-snug" style={{ color: 'var(--text-muted)' }}>
                The step from MR {worth.rank} to {worth.rank + 1} is {int(worth.step)} mastery. The {int(worth.left)}{' '}
                still unbought in this branch is{' '}
                {worth.share >= 1 ? 'more than that whole step' : `${pct(worth.share)} of it`}.
              </p>
            </Disclosure>
          )}
        </Disclosure>
      )}
    </li>
  );
}

/* ----------------------------------------------------------------- TreeBlock */

/**
 * Which branches to show.
 *
 * The panel drew all eighteen branches, always, and offered no way to ask a
 * question about them. "Where is there work left" is the only question anybody
 * has on this screen once a tree is half bought, and the answer was buried in
 * eighteen rows that all look alike.
 */
type BranchFilter = 'all' | 'unfinished' | 'maxed';

interface TreeBlockProps {
  label: string;
  /** What the tree is for, in one clause. The panel is dense; orientation is cheap. */
  role: string;
  tree: IntrinsicTree;
  color: string;
  /** Milliseconds before the first branch row of this tree animates. */
  delay: number;
  /** Branch key of the cheapest next rank across both trees, if it is in here. */
  cheapestKey: string | null;
  /** False with no account: the branches are real, the ranks in them are not. */
  measured: boolean;
  filter: BranchFilter;
  /** Mastery XP between the reader's rank and the next, for the branch drawers. */
  step: number | null;
  /** The rank that step runs from. Null when `PlayerLevel` is not in the read. */
  masteryRank: number | null;
}

function TreeBlock({
  label,
  role,
  tree,
  color,
  delay,
  cheapestKey,
  measured,
  filter,
  step,
  masteryRank,
}: TreeBlockProps) {
  const branchCount = tree.branches.length;
  // Read the cap off the tree instead of hardcoding 10: if the game ever adds a
  // rank, subsystems.ts is the one place that has to change.
  const maxRank = branchCount > 0 ? Math.round(tree.maxRanks / branchCount) : 0;
  const remaining = tree.masteryXpMax - tree.masteryXp;

  /*
   * WITHOUT RANKS THE FILTER CANNOT BE APPLIED, SO IT IS NOT.
   *
   * "Unfinished" and "maxed" are both claims about ranks held, and with no
   * account read there are none. Filtering on our own absence of data would
   * empty the list and imply every branch is at its cap - which is the
   * fabricated-zero failure this project keeps having to undo. Unmeasured shows
   * everything and the control says why on its title.
   */
  const shown =
    !measured || filter === 'all'
      ? tree.branches
      : tree.branches.filter((b) => (filter === 'maxed' ? b.rank >= maxRank : b.rank < maxRank));

  return (
    <section className="mo-arrive min-w-0">
      <SectionTitle
        count={branchCount}
        note={measured ? `${tree.ranks} of ${tree.maxRanks} ranks` : `${tree.maxRanks} ranks to buy`}
      >
        {label}
      </SectionTitle>

      {/*
        THE TREE HEADER, AND THE TREE'S PROSE ONE LEVEL DOWN.
        `role` is a full sentence about where the tree is earned and spent, and
        it sat under the numbers as a permanent third line on both trees. It is
        orientation, which is worth having once and never worth re-reading, so
        the numbers stay on the summary and the sentence moved into the body.
      */}
      <div
        className="rf-plate mo-field mo-sheen mo-in-up relative mb-[3px]"
        style={{ clipPath: CHAMFER, background: PLATE }}
      >
        <span aria-hidden className="absolute top-0 bottom-0 left-0 z-10 w-[2px]" style={{ background: color }} />
        <Disclosure
          accent={color}
          eyebrow="mastery earned"
          summary={
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                className="numeric text-[length:var(--text-lead)] leading-none"
                style={{ color: measured ? color : 'var(--text-muted)' }}
              >
                {measured ? int(tree.masteryXp) : UNKNOWN}
              </span>
              {measured && tree.unspentPoints !== null && (
                // Flagged, not hidden. inventory-schema.md §6 reads LPP_* as
                // unspent points in one place and as an overall rank in
                // another; printing it unqualified would launder an open
                // question into a number.
                <span
                  className="numeric cursor-help text-[length:var(--text-micro)]"
                  style={{
                    color: 'var(--color-signal-warn)',
                    borderBottom: '1px dotted var(--color-signal-warn)',
                  }}
                  title="Read from a field whose meaning the research does not settle — it is taken here as unspent points, but the same field is described elsewhere as an overall rank. Treat it as a hint, not a reading."
                >
                  {tree.unspentPoints} unspent, unverified
                </span>
              )}
            </span>
          }
          answer={
            <span className="numeric" style={{ color: 'var(--text-muted)' }}>
              {!measured
                ? `${int(tree.masteryXpMax)} when complete`
                : remaining > 0
                  ? `${int(remaining)} unearned`
                  : 'tree complete'}
            </span>
          }
        >
          <p className="wf-note">
            {role}
          </p>
        </Disclosure>
      </div>

      <ul className="mo-stagger flex flex-col gap-[3px]">
        {shown.map((b, i) => (
          <BranchRow
            key={b.key}
            name={b.name}
            rank={measured ? b.rank : null}
            maxRank={maxRank}
            color={color}
            delay={delay + i * 35}
            cheapest={b.key === cheapestKey}
            step={step}
            masteryRank={masteryRank}
          />
        ))}
      </ul>

      {/* An empty list after a filter is a fact about the filter, never about
          the tree — so it says which, rather than leaving a silent gap. */}
      {shown.length === 0 && (
        <p className="wf-note mt-2">
          {filter === 'maxed'
            ? 'No branch in this tree is at its cap yet.'
            : 'Every branch in this tree is at its cap.'}
        </p>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------- Panel */

export default function IntrinsicsPanel() {
  const inventory = useAccount((s) => s.inventory);

  // The inventory object is replaced wholesale when the bytes change, so its
  // identity is an exact cache key for everything derived from it.
  //
  // The cast: `RawInventory` and `RawAccount` describe the same bytes, but
  // gep.ts declares `Suits` and friends with a narrower row shape, so the two
  // are not structurally assignable. account.ts already calls for gep.ts to drop
  // its duplicate; until that lands every consumer pays this one cast, and
  // subsystems.ts reads every field defensively anyway.
  //
  // Derived from an empty account when there is none: that yields the nine
  // branches and their ten-rank caps — the shape of the trees, which is game
  // data — and zeroes for everything else, none of which reaches the screen.
  const state = useMemo(() => intrinsicsState((inventory ?? {}) as unknown as RawAccount), [inventory]);

  // A 0/90 board, an absent PlayerSkills block and no account at all look
  // identical downstream. Only one of the three is measurement.
  const hasSkillsBlock = useMemo(() => {
    const v = inventory?.['PlayerSkills'];
    return typeof v === 'object' && v !== null;
  }, [inventory]);

  const measured = inventory !== null && hasSkillsBlock;

  const masteryRank = typeof inventory?.PlayerLevel === 'number' ? inventory.PlayerLevel : null;

  const { railjack, drifter, masteryXp, masteryXpMax } = state;
  const ranks = railjack.ranks + drifter.ranks;
  const maxRanks = railjack.maxRanks + drifter.maxRanks;
  const remainingXp = masteryXpMax - masteryXp;
  const remainingRanks = maxRanks - ranks;

  // What the unearned pool is actually worth to this player: the step from their
  // current mastery rank to the next one. Needs only PlayerLevel and the rank
  // table, so it is exact rather than catalog-dependent.
  const step = masteryRank === null ? null : xpForRank(masteryRank + 1) - xpForRank(masteryRank);
  const stepShare = step === null || step <= 0 ? null : remainingXp / step;

  // The cheapest place to spend next. Intrinsic cost climbs steeply with rank,
  // so the lowest unfinished branch across both trees is always the cheapest —
  // an ordering over ranks already read, never an invented price.
  //
  // Null without ranks to order: with all nine branches reading zero the
  // "cheapest" would be whichever one happens to be listed first, which is
  // advice derived from our own absence of data rather than from the account.
  const trees = [
    { label: 'Railjack', tree: railjack, color: RAILJACK_INK },
    { label: 'Drifter', tree: drifter, color: DRIFTER_INK },
  ];
  const cheapest = !measured
    ? null
    : trees.reduce<{
        tree: string;
        key: string;
        name: string;
        rank: number;
        color: string;
      } | null>((best, t) => {
        const cap = t.tree.branches.length > 0 ? Math.round(t.tree.maxRanks / t.tree.branches.length) : 0;
        for (const b of t.tree.branches) {
          if (b.rank >= cap) continue;
          if (best === null || b.rank < best.rank)
            best = {
              tree: t.label,
              key: b.key,
              name: b.name,
              rank: b.rank,
              color: t.color,
            };
        }
        return best;
      }, null);

  const [branchFilter, setBranchFilter] = useState<BranchFilter>('all');

  /*
   * The counts the filter chips wear.
   *
   * Derived from the same `rank >= cap` test the filter itself uses, so a badge
   * can never disagree with the list it produces - the class of bug where a
   * chip says 4 and the list shows 3 because two places computed "unfinished"
   * slightly differently.
   */
  const branchTotals = trees.reduce(
    (acc, t) => {
      const cap = t.tree.branches.length > 0 ? Math.round(t.tree.maxRanks / t.tree.branches.length) : 0;
      for (const b of t.tree.branches) {
        acc.all += 1;
        if (b.rank >= cap) acc.maxed += 1;
        else acc.unfinished += 1;
      }
      return acc;
    },
    { all: 0, unfinished: 0, maxed: 0 },
  );

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      {!measured && <AccountBanner hasAccount={inventory !== null} />}

      {/* ---- THE BOLD ELEMENT: ranks held, and where the next one is cheapest */}
      {/*
        `mo-field` puts this plate on the document pointer tracker and `mo-tilt`
        reads the signed offset it writes, so the hero turns a few degrees under
        the cursor. Both are pointer-driven, which is why they are allowed to be
        the loudest motion on the panel: a pointer cannot be over a window
        nobody is presenting, so neither effect can be stranded mid-flight.
      */}
      <section
        className="mo-field mo-tilt mo-in-settle relative isolate"
        style={{
          clipPath: CHAMFER,
          padding: 1,
          background:
            'linear-gradient(150deg, var(--color-orokin-400), oklch(0.83 0.105 90 / 0.16) 44%, transparent 78%)',
        }}
      >
        <div
          className="relative flex flex-wrap items-end justify-between gap-x-10 gap-y-5 px-6 py-5"
          style={{
            clipPath: CHAMFER,
            background:
              'radial-gradient(120% 150% at 0% 0%, oklch(0.83 0.105 90 / 0.10), transparent 58%), linear-gradient(168deg, oklch(0.165 0.028 74 / 0.97), oklch(0.105 0.02 70 / 0.98))',
          }}
        >
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5">
              <span aria-hidden className="size-[5px] rotate-45" style={{ background: 'var(--color-orokin-400)' }} />
              <span className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
                Intrinsic ranks held
              </span>
            </div>

            <div className="mt-2.5 flex items-baseline gap-2.5">
              <span
                className="numeric text-[length:var(--text-hero)] leading-none"
                style={{
                  color: measured ? 'var(--color-orokin-200)' : 'var(--text-faint)',
                }}
              >
                {measured ? ranks : UNKNOWN}
              </span>
              <span className="numeric text-[length:var(--text-small)]" style={{ color: 'var(--text-muted)' }}>
                / {maxRanks}
              </span>
            </div>

            {/* No bar without ranks: a 0%-wide fill is a measurement claim. */}
            {measured && (
              <div
                className="mt-3 w-full max-w-[26rem] overflow-hidden"
                style={{ height: 4, background: 'oklch(1 0 0 / 0.07)' }}
              >
                <span
                  aria-hidden
                  className="block h-full"
                  style={{
                    width: `${Math.max(2, (maxRanks > 0 ? ranks / maxRanks : 0) * 100)}%`,
                    background: 'var(--color-orokin-400)',
                  }}
                />
              </div>
            )}

            <div className="numeric mt-2 text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
              {!measured
                ? `${maxRanks} ranks exist across ${railjack.branches.length + drifter.branches.length} branches`
                : remainingRanks > 0
                  ? `${remainingRanks} ranks left to buy`
                  : 'every rank bought'}
            </div>
          </div>

          {/* The other half of the decision: where the next rank costs least. */}
          <div className="min-w-[15rem]">
            <span
              className="eyebrow"
              style={{
                color: cheapest ? 'var(--color-signal-good)' : 'var(--text-faint)',
              }}
            >
              Cheapest next rank
            </span>
            {cheapest !== null ? (
              <>
                <div
                  className="mt-2 font-[family-name:var(--font-title)] text-[length:var(--text-lead)] leading-none tracking-[0.12em] uppercase"
                  style={{ color: 'var(--color-signal-good)' }}
                >
                  {cheapest.name}
                </div>
                <div className="numeric mt-2 text-[length:var(--text-small)]" style={{ color: 'var(--text-muted)' }}>
                  {cheapest.tree} · rank {cheapest.rank} to {cheapest.rank + 1}
                </div>
                <p
                  className="wf-prose mt-2"
                >
                  Intrinsic cost rises with rank, so the lowest branch is always the least expensive place to spend.
                </p>
              </>
            ) : measured ? (
              <div className="mt-2 text-[length:var(--text-small)]" style={{ color: 'var(--text-muted)' }}>
                Every branch is at its cap. Nothing left to buy.
              </div>
            ) : (
              <p
                className="wf-prose mt-2"
              >
                Cost rises with rank, so the lowest branch is always the cheapest — but which one that is needs your
                ranks, and those have not been read yet.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ---- the mastery arithmetic ---------------------------------------- */}
      <section className="mo-arrive">
        <SectionTitle note="1,500 mastery per rank">Mastery from intrinsics</SectionTitle>

        <div className="mo-stagger grid gap-[3px] sm:grid-cols-3">
          {[
            {
              label: 'Earned',
              value: measured ? int(masteryXp) : UNKNOWN,
              sub: measured
                ? `${ranks} ranks × ${int(MASTERY_PER_INTRINSIC_RANK)}`
                : `${int(MASTERY_PER_INTRINSIC_RANK)} per rank — ranks not measured`,
              ink: measured ? 'var(--color-orokin-300)' : 'var(--text-muted)',
            },
            {
              label: 'Still unearned',
              value: measured ? int(remainingXp) : UNKNOWN,
              // NOT "N ranks left to buy" - that exact sentence is already the
              // hero's own subline sixty lines above, and both are visible
              // without scrolling. This says what THIS figure is instead.
              sub: !measured ? 'needs the ranks you hold' : 'at 1,500 mastery per rank',
              ink: measured ? 'var(--text)' : 'var(--text-muted)',
            },
            {
              label: 'Full pool',
              value: int(masteryXpMax),
              sub: `${railjack.maxRanks} Railjack + ${drifter.maxRanks} Drifter`,
              ink: 'var(--color-tenno-300)',
            },
          ].map((cell, i) => (
            <div
              key={cell.label}
              className="rf-plate mo-field mo-sheen mo-lift mo-in-up relative px-4 py-3"
              style={
                {
                  '--i': i,
                  clipPath: CHAMFER,
                  background: PLATE,
                } as CSSProperties
              }
            >
              <span
                aria-hidden
                className="absolute top-0 bottom-0 left-0 w-[2px]"
                style={{ background: cell.ink, opacity: 0.75 }}
              />
              <div className="eyebrow">{cell.label}</div>
              <div className="numeric mt-1.5 text-[length:var(--text-title)] leading-none" style={{ color: cell.ink }}>
                {cell.value}
              </div>
              <div className="numeric mt-1.5 text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
                {cell.sub}
              </div>
            </div>
          ))}
        </div>

        {/*
         * `measured` is load-bearing here, not decoration.
         *
         * `remainingXp` is `masteryXpMax - masteryXp`, and `masteryXp` is 0 when
         * `PlayerSkills` is absent — so without this gate the panel printed
         * "That unearned 135,000 is 98% of the step from MR 27 to 28" three lines
         * under a "Still unearned —" cell that had just refused to state it. The
         * sentence was arithmetic on our own missing data.
         */}
        {measured && stepShare !== null && masteryRank !== null && (
          <p className="wf-note mt-2.5">
            {remainingXp === 0 ? (
              <>Every intrinsic rank is bought. This subsystem can give you nothing further.</>
            ) : (
              <>
                That unearned {int(remainingXp)} is{' '}
                <span className="numeric" style={{ color: 'var(--color-orokin-300)' }}>
                  {stepShare >= 1 ? `${stepShare.toFixed(1)}×` : pct(stepShare)}
                </span>{' '}
                of the step from MR {masteryRank} to {masteryRank + 1}.
              </>
            )}
          </p>
        )}
      </section>

      {/* ---- the nine branches --------------------------------------------- */}
      {/*
        THE CONTROL THIS PANEL DID NOT HAVE.
        Eighteen branch rows, no way to ask a question about them, and one click
        handler in the whole file. "Where is there still work" is the only thing
        anybody wants from this list once a tree is half bought, and the answer
        was already computed — it was just never offered as a choice.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle count={branchTotals.all} note={measured ? undefined : 'ranks unmeasured — showing every branch'}>
          Branches
        </SectionTitle>
        <Segmented
          label="Which branches to show"
          value={branchFilter}
          onChange={setBranchFilter}
          options={[
            {
              id: 'all',
              label: 'All',
              badge: branchTotals.all,
              hint: 'Every branch in both trees',
            },
            {
              id: 'unfinished',
              label: 'Unfinished',
              // Absent, never zero: with no ranks read there is no count to
              // give, and a 0 here would claim every branch is capped.
              badge: measured ? branchTotals.unfinished : null,
              // Each chip says what IT could not decide, not the same sentence
              // twice: two controls wearing one identical refusal is the
              // smaller version of the nine identical paragraphs this panel
              // just lost, and it costs nothing to say which is which.
              hint: measured ? 'Branches below their rank cap' : 'Which branches are below their cap needs your ranks',
            },
            {
              id: 'maxed',
              label: 'Maxed',
              badge: measured ? branchTotals.maxed : null,
              hint: measured ? 'Branches at their rank cap' : 'Which branches are at their cap needs your ranks',
            },
          ]}
        />
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <TreeBlock
          label="Railjack"
          role="Empyrean crew skills — earned in Veil Proxima and spent from the Railjack menu."
          tree={railjack}
          color={RAILJACK_INK}
          delay={140}
          cheapestKey={cheapest !== null && cheapest.tree === 'Railjack' ? cheapest.key : null}
          measured={measured}
          filter={branchFilter}
          step={step}
          masteryRank={masteryRank}
        />
        <TreeBlock
          label="Drifter"
          role="Duviri skills — earned in the Undercroft and spent at the Drifter camp."
          tree={drifter}
          color={DRIFTER_INK}
          delay={200}
          cheapestKey={cheapest !== null && cheapest.tree === 'Drifter' ? cheapest.key : null}
          measured={measured}
          filter={branchFilter}
          step={step}
          masteryRank={masteryRank}
        />
      </div>

      {/* No payload field names down here. They are our names for the game's
          bytes, not anything a player has ever seen on a screen in Warframe. */}
      <footer className="mo-arrive mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-2">
        <span className="eyebrow">Pips are ranks, not a percentage — ten per branch</span>
        {measured && masteryRank === null && (
          <span className="eyebrow ml-auto" style={{ color: 'var(--color-signal-warn)' }}>
            your mastery rank is not in this account read — the rank-step comparison needs it
          </span>
        )}
      </footer>
    </div>
  );
}
