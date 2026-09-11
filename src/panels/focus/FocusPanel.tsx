/**
 * FOCUS — the operator's five schools.
 *
 * The account payload is generous about *pools* and silent about *costs*: it
 * carries `FocusXP` (unspent per school) and `FocusUpgrades` (which nodes are
 * unlocked), but never what a node cost. So "focus spent" and "focus needed for
 * full completion" cannot be computed from the account — only from a node cost
 * table this app does not have. Neither is drawn at all: not as a zero, and not
 * as the section of permanent dashes a "Completion" block here used to be. The
 * footer states the gap once, because a completionist who is shown a fabricated
 * 0 / 26,000,000 will plan around it.
 *
 * THE ONE BOLD ELEMENT
 * ────────────────────
 * Focus still earnable today. It is the only number on this panel with a
 * deadline — the allowance is destroyed at reset, unearned — so it is the only
 * thing drawn at hero size and the only thing wearing energy cyan. The pool, the
 * capacity and the node counts are all standing facts that will be just as true
 * tomorrow, so they are dense, quiet plates underneath it.
 *
 * Everything is cut rather than rounded, and the meters are flat 3px tracks
 * rather than lit bars: five glowing rows behind a live game is decoration, and
 * decoration is what this panel was previously spending its contrast on.
 *
 * WHAT WAS WRONG: FIVE SCHOOLS AND NO WAY TO ASK ABOUT ONE
 * ───────────────────────────────────────────────────────
 * This file was 505 lines with no event handler and no form control in it. It
 * showed all five schools at once, each flattened to a bar and a two-decimal
 * millions figure, and there was nothing on the screen a reader could touch. The
 * Pentad below it did have a click, and the click went nowhere: it dimmed four
 * arms inside that component and told the panel nothing, so the one gesture the
 * screen offered bought no information at all.
 *
 * Selection is now this panel's state, and it BUYS something. Picking a school -
 * from the figure or from the list, with the pointer or with the arrow keys -
 * is what makes the panel compute that school on its own: its pool in full
 * digits rather than rounded to 2.41M, its exact share, how many of the unlocked
 * nodes are actually in it, and the one thing below.
 *
 * THE QUESTION THIS PANEL DID NOT ANSWER
 * ──────────────────────────────────────
 * It stated what is held and what expires and stopped. A focus player is not
 * banking focus for its own sake, and the one long-horizon purchase the account
 * can actually be checked against is a waybound unbind: a flat 750,000 focus per
 * node, two nodes per school, pinned twice over in this repo's own research and
 * arithmetically consistent with the wiki's per-school total. That is a price
 * published by the game, not a per-node cost table - see schoolDossier.ts for
 * exactly why that distinction is what lets this one number be shown when
 * "focus spent" still cannot be.
 *
 * So the selected school gets a bill and a verdict: what its remaining waybound
 * nodes cost, whether its own pool covers it, and if not, the FLOOR on how many
 * days that is at today's full daily cap - a floor, because that cap is shared
 * across all five schools, so the count only holds if every point of it went
 * here. Unread stays unread throughout: `met` is null, an unmeasured value is a
 * bare dash under a container that has already said why, and nothing anywhere
 * renders a zero it did not measure.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useAccount } from '../../core/store';
import type { RawAccount } from '../../data/account';
import { dailyState, focusState, type FocusSchoolKey } from '../../data/subsystems';
import { EmptyState } from '../../ui/orokin';
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { Pentad, type PentadSchool } from './Pentad';
import {
  WAYBOUND_PER_SCHOOL,
  WAYBOUND_UNBIND_COST,
  nodeCensus,
  schoolDossier,
  type SchoolDossier,
} from './schoolDossier';
import { CHAMFER, PLATE_LIFT as PLATE } from '../../ui/geometry';

/** Operator void energy. The hero, and the only cyan on the panel. */
const HERO = 'var(--color-tenno-400)';

/* --------------------------------------------------------------- school ink */

/**
 * The five school energies, matched to the lens and school-icon colours in game
 * rather than to the app's palette: Madurai burns red, Vazarin is protective
 * blue, Naramon a colourless silver, Unairu amber stone, Zenurik green.
 * theme.css has no token for these — they are content colours, not chrome.
 */
const SCHOOL_INK: Record<FocusSchoolKey, string> = {
  AP_ATTACK: 'oklch(0.66 0.20 30)',
  AP_DEFENSE: 'oklch(0.74 0.13 243)',
  AP_TACTIC: 'oklch(0.88 0.025 250)',
  AP_WARD: 'oklch(0.81 0.14 85)',
  AP_POWER: 'oklch(0.78 0.15 155)',
};

/** One line of flavour so the five rows read as five identities, not five bars. */
const SCHOOL_CREED: Record<FocusSchoolKey, string> = {
  AP_ATTACK: 'Aggression · damage and fire',
  AP_DEFENSE: 'Protection · healing and shields',
  AP_TACTIC: 'Cunning · melee and stealth',
  AP_WARD: 'Fortitude · armour strip and stone',
  AP_POWER: 'Vitality · energy and time',
};

/* ------------------------------------------------------------------ helpers */

const int = (n: number): string => Math.round(n).toLocaleString();

/** Compact for the millions a long-lived pool reaches — 12,345,678 is unreadable at a glance. */
const short = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}K` : int(n);

/** A whole percent that never lies at the edges: started is never 0%, unfinished is never 100%. */
const pct = (r: number): string =>
  r > 0 && r < 0.005 ? '<1%' : r < 1 && r >= 0.995 ? '99%' : `${Math.round(r * 100)}%`;

/**
 * What would settle an unread value, for the ONE consumer that still needs it.
 *
 * It was written out seven separate times on this panel, twice verbatim, under
 * a banner that had already said it in full - so the screen read as an apology
 * repeated rather than a panel explaining itself once. Then it was moved into
 * six tooltips, which is the same seven copies with a hover in front of them.
 *
 * It survives here because `schoolDossier` shapes its verdict as a `Need`, and
 * a `Need` that cannot be checked is required to say what would settle it -
 * that is the house vocabulary and it is right. The panel now spends it once,
 * in the dossier's own sentence, rather than on every dash on the screen.
 */
const UNREAD = 'Not captured yet - run Warframe once.';

/** `/Lotus/…/AbilityEnergyDash` -> `Energy Dash`. */
function prettyPath(path: string): string {
  const last = path.split('/').filter(Boolean).pop() ?? path;
  return last.replace(/^Ability/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/**
 * A value the account genuinely does not carry.
 *
 * This used to print the word UNKNOWN. It appeared ELEVEN times on one screen,
 * which turned the panel's most important claim into wallpaper — the eye stops
 * reading a word it has already seen ten times, and the actual differences (a
 * pool, a capacity, a node count) drowned in it.
 *
 * The claim is not deleted, it is relocated: each section states its own gap
 * once on its heading, and every value here is a quiet dash.
 *
 * `why` IS OPTIONAL, AND THAT IS THE SECOND HALF OF THE SAME FIX.
 * ————————————————————————————————————————————
 * Passing a reason to every dash brought the repetition straight back in the
 * tooltip layer: with no account read, SIX of these carried the identical
 * sentence - the pool, the node total, waybound, school-bound, today's
 * allowance and the waybound line under the pentad - under a banner that had
 * already said it and a section heading that says it again. Six copies of one
 * fact is six copies whether they are painted or hovered, and the dotted
 * underline promised each one held something the last did not.
 *
 * So a reason is passed only when it is SPECIFIC to this value - "today's
 * remaining allowance is not in this read", which is a different gap from the
 * account being unread at all. When the whole account is unread the dash is
 * bare, and the container says why, once.
 *
 * Never a zero, and never a bare dash without a section saying what the dashes
 * mean — a dash on its own reads as "none", which is the lie this panel exists
 * to avoid.
 */
function Unknown({ why }: { why?: string }) {
  return (
    <span
      title={why}
      className={
        why === undefined
          ? 'numeric text-[length:var(--text-small)] leading-none'
          : 'numeric cursor-help text-[length:var(--text-small)] leading-none'
      }
      style={{
        color: 'var(--text-muted)',
        borderBottom: why === undefined ? undefined : '1px dotted var(--text-faint)',
      }}
    >
      —
    </span>
  );
}

/** Small-caps labels never wrap: at 1100px "School-bound" broke into two lines
    mid-hyphen, which reads as two labels rather than one. */
function Label({ children }: { children: ReactNode }) {
  return <div className="eyebrow whitespace-nowrap">{children}</div>;
}

/**
 * A flat track. Width, not a transform: the bar is painted at its value on the
 * first frame, so a throttled renderer can never leave it reading zero.
 */
function Track({ value, color, height = 3 }: { value: number; color: string; height?: number }) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return (
    <span aria-hidden className="block w-full overflow-hidden" style={{ height, background: 'oklch(1 0 0 / 0.07)' }}>
      {/* The 2% floor keeps a real but tiny value visible, and applied to ZERO
          it painted one: "0 earned · 0% of today's cap" sat under a bar with
          ink in it, and a filled track is a reading. Zero draws an empty
          track, which is the reading zero has. A non-finite value lands here
          too, and an empty track is the honest shape for it as well - the
          callers that have nothing to measure draw a dash instead of a bar. */}
      <span
        className="block h-full"
        style={{ width: `${v === 0 ? 0 : Math.max(2, v * 100)}%`, background: color }}
      />
    </span>
  );
}

/** Heading plus the hairline that fills the row — the app's section grammar. */
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

/**
 * A SECTION, AS A DISCLOSURE.
 *
 * Used for the five schools and nothing else on this panel, and that is the
 * point of the rule rather than an exception to it: `defaultOpen` belongs to
 * the ONE section that is the subject of the screen. Today's allowance is a
 * row of hero plates - a hero you have to unfold is not a hero - and the
 * dossier below is the answer to a gesture the reader just made, which must
 * never arrive folded. So the walls inside those two are nested instead, and
 * the figure is the section that folds.
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
 * THE RULES THAT CANNOT BE WRITTEN AS UTILITIES.
 *
 * Both drive a CHILD from a PARENT's pointer state, and a Tailwind
 * `group-hover:[--mo-on:1]` variant cannot: Tailwind v4 emits utilities into
 * `@layer utilities`, motion.css is unlayered, and an unlayered declaration
 * beats a layered one at any specificity - so the variant loses to
 * `.mo-underline`'s own `--mo-on: 0`, and the effect renders, tracks the
 * pointer, and stays invisible. A plain rule later in document order wins.
 *
 * Duplicated in the two sibling panels this pass touches rather than shared:
 * the shared home for it is `src/ui`, which this pass does not own.
 */
function MotionRules() {
  return (
    <style>{`
      /*
        A heading underlines from the whole summary row rather than from the
        sixteen characters of its own title - which is all mo-underline alone
        can give, because it reads --mo-on off the element it is written on.
      */
      .rf-disc-summary:hover .rf-fold-ink,
      .rf-disc-summary:focus-visible .rf-fold-ink {
        --mo-on: 1;
      }

      /*
        A plate's leading edge brightens under the pointer. Opacity only, on a
        two-pixel bar that carries no text, so a transition stranded by a
        stopped timeline can only hold the quieter of two visible states.
      */
      .rf-edge {
        opacity: calc(0.62 + var(--mo-on, 0) * 0.38);
        transition: opacity var(--mo-base) var(--mo-out);
      }

      @media (prefers-reduced-motion: reduce) {
        .rf-edge {
          transition: none;
        }
      }
    `}</style>
  );
}

/* ------------------------------------------------------------------- school */

/**
 * One measured cell of the dossier. Null renders as a reasoned dash, never a zero.
 *
 * `--i` is read by the parent's `mo-stagger`, so the four cells assemble one
 * after another instead of all landing in the same frame. Transform only: a
 * stopped timeline leaves a cell twelve pixels low and completely legible.
 */
function Cell({ label, value, index }: { label: string; value: string | null; index: number }) {
  return (
    <div className="mo-in-up" style={{ '--i': index } as React.CSSProperties}>
      <Label>{label}</Label>
      <div className="numeric mt-1 text-[length:var(--text-lead)] leading-none" style={{ color: 'var(--text)' }}>
        {/* No reason on the dash. All four of these are null for exactly one
            cause - the account is unread - and the card's own verdict below
            states it, once, in a full sentence. Four tooltips saying the same
            thing is the defect this card was rebuilt to remove. */}
        {value ?? <Unknown />}
      </div>
    </div>
  );
}

/**
 * THE ONE SCHOOL A READER PICKED.
 *
 * Every figure on this card is one the panel above deliberately does not show:
 * the pool at full precision rather than rounded to two decimal millions, the
 * exact share rather than a bar length, the node count for THIS school rather
 * than the account-wide total, and the waybound bill - which nothing anywhere
 * computed before.
 *
 * The verdict is a `Need`, so its three states are the three states the house
 * vocabulary defines and not two states plus a zero. `met: null` is drawn as the
 * same dash as everywhere else on this panel, with its own reason on hover, and
 * the requirement is still stated beside it: a requirement nobody can check is
 * still a requirement, and dropping the line would be pretending it does not
 * exist.
 */
function Dossier({ d, name, creed, ink }: { d: SchoolDossier; name: string; creed: string; ink: string }) {
  const owed = d.bill.need;
  // The share of the bill this school's own pool already covers. A real ratio of
  // two real numbers, so it is drawn only when both exist.
  const covered = owed !== null && d.pooled !== null ? Math.min(1, d.pooled / owed) : null;

  /* The three census figures move together - they are one row of one map - so
     they are narrowed together. A `?? 0` on any of them would put a measured
     zero where an unread value belongs, on the one card that exists to keep
     those apart. */
  const counted =
    d.nodes !== null && d.unbound !== null && d.remaining !== null
      ? { nodes: d.nodes, unbound: d.unbound, remaining: d.remaining }
      : null;

  return (
    <div
      className="rf-plate mo-field mo-sheen mo-in-up relative px-5 py-4"
      style={{ clipPath: CHAMFER, background: PLATE }}
    >
      <span aria-hidden className="rf-edge absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: ink }} />

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3
          className="font-[family-name:var(--font-display)] text-[length:var(--text-lead)] leading-none font-semibold"
          style={{ color: ink }}
        >
          {name}
        </h3>
        <span className="text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
          {creed}
        </span>
      </div>

      {/* Four numbers, none of which the panel above can show. `auto-fit` on this
          grid rather than a fixed four columns: the card sits under a figure
          that already wraps, so it gets whatever width is left. */}
      <div className="mo-stagger mt-3.5 grid gap-x-4 gap-y-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,9rem),1fr))]">
        <Cell index={0} label="Pooled here" value={d.pooled === null ? null : int(d.pooled)} />
        <Cell index={1} label="Share of pool" value={d.share === null ? null : pct(d.share)} />
        <Cell index={2} label="Nodes in school" value={d.nodes === null ? null : int(d.nodes)} />
        <Cell
          index={3}
          label="Unbound here"
          value={d.unbound === null ? null : `${int(d.unbound)} / ${String(WAYBOUND_PER_SCHOOL)}`}
        />
      </div>

      {/* ---- the answer ------------------------------------------------- */}
      <div className="mt-4 pt-3.5" style={{ borderTop: '1px solid var(--hairline)' }}>
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span aria-hidden className="size-[5px] rotate-45" style={{ background: ink }} />
          <span className="eyebrow whitespace-nowrap">{d.bill.what}</span>
          {owed !== null && (
            <span className="numeric ml-auto text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
              {int(owed)} focus
            </span>
          )}
        </div>

        {covered !== null && (
          <div className="mt-2.5">
            <Track value={covered} color={ink} height={4} />
          </div>
        )}

        {/* The verdict runs to three lines in its longest branch - the one that
            has to explain that the day count is a FLOOR and why. Clamped to
            two, with the qualification a press away rather than deleted: the
            qualification is the honest half of the sentence. */}
        <div className="mt-2.5 text-[length:var(--text-micro)] leading-snug" style={{ color: 'var(--text-muted)' }}>
          <Clamp lines={2}>
            {d.bill.met === null ? (
              <>
                {/* Bare: the sentence it opens is the reason, spelled out. */}
                <Unknown /> Whether this school covers it cannot be checked until the account is read; the price itself
                is a published constant and is true either way.
              </>
            ) : d.remaining === 0 ? (
              <>Nothing left to buy here at a price this app can verify.</>
            ) : d.bill.met ? (
              <>This school&apos;s own pool already covers it, with {int((d.pooled ?? 0) - (owed ?? 0))} to spare.</>
            ) : (
              <>
                Short {int(d.shortfall ?? 0)}.{' '}
                {d.days === null
                  ? 'How many days that is needs your mastery rank for the daily cap, which is missing from this read.'
                  : `At least ${int(d.days)} more ${d.days === 1 ? 'day' : 'days'} — and only if every point of the daily cap went to this school, which is shared across all five.`}
              </>
            )}
          </Clamp>
        </div>

        {/*
          THREE QUESTIONS, THREE LEVELS, AND THE READER CHOOSES HOW FAR TO GO.

          This was one level deep and stopped: a caveat about the price, folded
          once, under a bill whose arithmetic was nowhere on the screen. A
          reader who asked "how is that 1,500,000 reached" had no answer, and a
          reader who asked "why should I believe 750,000" had the assertion and
          nothing behind it.

          They are genuinely different questions and they nest, which is why
          this is three levels rather than three paragraphs: how the bill is
          reached (this school's own remaining nodes), what the per-node price
          does and does not cover, and how a price can be stated at all on a
          panel that refuses to state focus spent. Each one is the "how?" of the
          line above it, and the last is evidence rather than more explanation.
          The closed row still answers - the multiplication is the answer prop -
          so a reader who never presses anything has still been told the shape
          of the sum.
        */}
        {/* No bill, no drawer: a school with both nodes unbound owes nothing,
            and "0 × 750,000" is arithmetic about a purchase that does not
            exist. The verdict above has already said so in words. */}
        {counted?.remaining !== 0 && (
          <Disclosure
            depth={1}
            eyebrow="how the bill is reached"
            summary={<span className="rf-fold-ink mo-underline">Where this figure comes from</span>}
            answer={
              <span className="numeric">
                {counted === null ? WAYBOUND_PER_SCHOOL : counted.remaining} × {int(WAYBOUND_UNBIND_COST)}
              </span>
            }
          >
            <p className="text-[length:var(--text-body)] leading-snug" style={{ color: 'var(--text-muted)' }}>
              {counted === null ? (
                <>
                  Every school has {WAYBOUND_PER_SCHOOL} waybound nodes at {int(WAYBOUND_UNBIND_COST)} focus each. How
                  many of this school&apos;s are already unbound needs the account, so the bill states both — which is
                  true of every account and therefore invents nothing about this one.
                </>
              ) : (
                <>
                  {int(counted.nodes)} nodes of this school are on the account and {int(counted.unbound)} of them are
                  already unbound, which leaves {counted.remaining} of its {WAYBOUND_PER_SCHOOL} waybound nodes at{' '}
                  {int(WAYBOUND_UNBIND_COST)} focus each.
                </>
              )}
            </p>

            <Disclosure
              depth={2}
              eyebrow="what the price covers"
              summary={<span className="rf-fold-ink mo-underline">What this price does and does not include</span>}
              answer={<span className="numeric">focus only</span>}
            >
              <p className="text-[length:var(--text-body)] leading-snug" style={{ color: 'var(--text-muted)' }}>
                {int(WAYBOUND_UNBIND_COST)} per node is the published unbind price, not a node cost table. Unbinding
                also needs the node at its last rank and one Brilliant Eidolon Shard; neither is checked here.
              </p>

              <Disclosure
                depth={3}
                eyebrow="how the price is pinned"
                summary={
                  <span className="rf-fold-ink mo-underline">Why this number can be shown when node costs cannot</span>
                }
                answer={<span className="numeric">two sources, one division</span>}
              >
                <p className="wf-note">
                  Two independent sources give the same figure — the game&apos;s own unbind operation and the wiki — and
                  the wiki&apos;s per-school total of {int(WAYBOUND_UNBIND_COST * WAYBOUND_PER_SCHOOL)} divides by it
                  exactly. It is one flat price for every waybound node in the game, in the same class as the daily cap
                  formula above. A node&apos;s rank-up cost is none of those things: it varies per node, the account
                  never carries it, and that is why this panel shows a bill and no focus-spent figure.
                </p>
              </Disclosure>
            </Disclosure>
          </Disclosure>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- banner */

/**
 * The panel WITHOUT an account.
 *
 * The five schools, what each one is for and the shape of the daily allowance
 * are facts about the game; only the pools, the cap and the node counts come
 * from the player. So the panel renders and marks its own gaps rather than
 * refusing to draw.
 */
function AccountBanner() {
  const running = useAccount((s) => s.gameRunning);
  const gep = useAccount((s) => s.gep);

  /*
   * THE HEADLINE, THE ONE-LINE REASON, AND EVERYTHING ELSE.
   *
   * This was a 202-character paragraph sitting directly under the headline on
   * the panel's no-account path - the longest single block of prose on the
   * screen, and the first thing a new player reads here. It is cut at the seam
   * it always had rather than shortened: the reason a person needs in order to
   * ACT is one line, and the explanation of which half of this panel is game
   * data is one press below it. Nothing is deleted.
   */
  const [title, reason, detail] = !running
    ? ([
        'Showing the five schools, unmeasured',
        'The game is not running, and nothing has been read from it yet.',
        'The schools and what each one is for are game data. Your pools and unlocked nodes are not: run Warframe once and they are captured and kept, after which this panel stays accurate with the game closed.',
      ] as const)
    : gep === 'connected'
      ? ([
          'Linked — waiting for your account',
          'Linked to the game, which has not pushed your account yet.',
          'Your account arrives on the next update Warframe pushes, usually within a minute of reaching the Orbiter.',
        ] as const)
      : ([
          'Linking to the game',
          'Establishing the game-events connection.',
          'This normally takes a few seconds after launch.',
        ] as const);

  return (
    <section
      /* A large flat surface with no answer to the cursor reads as a
         screenshot of a UI rather than a UI. `mo-in-left` is transform-only,
         so a stopped timeline slides it sixteen pixels and never hides it. */
      className="mo-field mo-sheen mo-in-left flex items-start gap-3 px-4 py-3"
      style={{
        clipPath: CHAMFER,
        background: 'linear-gradient(168deg, oklch(0.17 0.03 80 / 0.55), oklch(0.12 0.02 70 / 0.6))',
        boxShadow: 'inset 2px 0 0 var(--color-orokin-500)',
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
          {title}
        </div>
        <p className="wf-note mt-1">
          {reason}
        </p>
        <Disclosure
          depth={1}
          eyebrow="what is game data and what is yours"
          summary={<span className="rf-fold-ink mo-underline">Why the five schools still draw</span>}
          answer={
            <span style={{ color: 'var(--text-faint)' }}>{running ? 'waiting on the game' : 'run the game once'}</span>
          }
        >
          <div className="text-[length:var(--text-micro)] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            <Clamp lines={3}>{detail}</Clamp>
          </div>
        </Disclosure>

        {/*
          THE THREE PLATES' GAME FACTS, KEPT WHEN THE PLATES THEMSELVES ARE NOT.
          ————————————————————————————————————————————
          Measured at 1280x720 with no account read, the Today strip printed
          FIVE em-dashes - the allowance, the pool, the node total, waybound and
          school-bound - in three large plates whose every number was the same
          single unknown. That is not five readouts, it is one sentence, which
          this banner is already saying above it in words. So the plates do not
          render on the unread path at all and the band shrinks to this.

          What the plates carried that was NOT account data is a different
          matter and is not deleted: the cap formula, the reset, that nothing
          caps a pool, and the two kinds of node are facts about the game and
          true with the game never launched. They are one press away, which is
          the rule - a fact that was on the screen stays reachable in one click.
        */}
        <Disclosure
          depth={1}
          eyebrow="what this panel reports once it has read you"
          summary={<span className="rf-fold-ink mo-underline">The three readouts, and what they mean</span>}
          answer={<span style={{ color: 'var(--text-faint)' }}>three, all unread</span>}
        >
          <dl
            className="grid gap-x-4 gap-y-2 text-[length:var(--text-micro)] leading-snug [grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))]"
            style={{ color: 'var(--text-muted)' }}
          >
            <div className="min-w-0">
              <dt className="eyebrow whitespace-nowrap" style={{ color: 'var(--color-tenno-300)' }}>
                Focus earnable today
              </dt>
              <dd className="mt-0.5">
                Use it or lose it. The cap is 250,000 + MR x 5,000 and it resets at 00:00 UTC, unearned.
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="eyebrow whitespace-nowrap">Pooled focus</dt>
              <dd className="mt-0.5">
                Unspent, waiting to go into nodes. Nothing caps what you hold; the daily cap is what limits what you
                earn.
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="eyebrow whitespace-nowrap">Nodes unlocked</dt>
              <dd className="mt-0.5">
                Split into waybound nodes, which are universal, and school-bound nodes, which are per school.
              </dd>
            </div>
          </dl>
        </Disclosure>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- panel */

export default function FocusPanel() {
  const inventory = useAccount((s) => s.inventory);

  /*
   * The panel's one piece of reader state.
   *
   * It starts null, and null is a real resting state rather than a placeholder:
   * with nothing picked the pentad sits at full contrast on all five arms, which
   * is the reading "here are your five schools". Defaulting it to the largest
   * pool would have made the panel look pre-answered and would have dimmed four
   * schools nobody dimmed.
   */
  const [selected, setSelected] = useState<FocusSchoolKey | null>(null);

  // Every account-derived figure below is gated on this. The school list, the
  // creeds and the section structure are not account data and always render.
  const measured = inventory !== null;

  // Identity of the inventory object only changes when the underlying bytes
  // change (the controller replaces it wholesale), so this key is exact.
  //
  // With no inventory the state is derived from an empty account, which yields
  // the five schools and nothing else — every value it reports as 0 is gated on
  // `measured` before it reaches the screen.
  const view = useMemo(() => {
    // RawInventory is the same blob with a narrower declared surface; the
    // derivation modules read every field defensively off the index signature.
    const raw = (inventory ?? {}) as unknown as Readonly<Record<string, unknown>>;
    const acc = raw as unknown as RawAccount;
    // The census is keyed on the same identity for the same reason: it walks
    // `FocusUpgrades` once, and re-walking it every time a reader points at a
    // different arm would be work whose answer cannot have changed.
    const day = dailyState(acc);
    return {
      focus: focusState(acc),
      /*
       * THE DAILY FIGURES COME FROM `dailyState`, NEVER FROM `focusState`.
       *
       * They are the same two fields read off the same key, and only one of the
       * two reads is gated: `focusState().daily.remaining` is `num(DailyFocus)`
       * raw, `dailyState().focus.remaining` is that same value put through
       * `today()`, which returns null once `NextRefill` is behind the clock.
       *
       * With the game closed - this app's normal mode - a kept read goes stale
       * the moment the clock passes 00:00 UTC, so the ungated field printed an
       * account captured at 22:00 as "187,000 / 280,000 · use it or lose it"
       * at 09:00 the next morning, about a day that ended nine hours earlier,
       * with a correct tomorrow reset sitting beside it. `DailyPanel` reads the
       * gated field off this same function and said unknown for the same
       * account; two panels disagreeing about one number is how a reader learns
       * which one to believe, and it was the wrong one.
       */
      daily: day.focus,
      staleAcrossReset: day.staleAcrossReset,
      resetsAtMs: day.resetsAtMs,
      census: nodeCensus(acc),
      /*
       * WHICH FOCUS FIELDS THIS READ ACTUALLY CARRIED.
       *
       * `focusState` cannot answer that and should not try: every school pool is
       * `num(FocusXP[key]) ?? 0`, so an ABSENT `FocusXP` and a read one full of
       * zeroes both arrive as `pooledTotal === 0`. That is fine for a figure and
       * fatal for a claim, and the claim below is the loudest one this panel
       * owns - it replaces the entire screen. `acquire.ts` accepts a payload on
       * ONE recognised key, so a partial read carrying `Suits` and
       * `RegularCredits` and none of the three focus keys is an ordinary shape,
       * and it told a player with 40M banked focus that they had none.
       *
       * Absent is never zero. So presence is read here, off the raw bag, and the
       * claim is gated on it.
       */
      read: {
        pools: raw['FocusXP'] !== undefined,
        nodes: raw['FocusUpgrades'] !== undefined,
        /* Present AND zero, in one test: "this account has a daily focus
           counter and it is empty", which is a different fact from "no counter
           reached us". Deliberately NOT `daily.remaining === null`, which is
           also what a stale read looks like. */
        dailyZero: raw['DailyFocus'] === 0,
      },
    };
  }, [inventory]);

  const { focus, daily, staleAcrossReset, resetsAtMs, census, read } = view;
  // `capacity` is left out on purpose: `FocusCapacity` is the Focus 2.0 pool
  // capacity, a node-slot figure the 2022 rework retired, and pooled focus
  // measured against it read as "184% of the cap" on a normal account.
  // `focus.daily` is left out for the reason stated in the memo above.
  const { schools, pooledTotal, waybound, nodesUnlocked } = focus;

  // The operator system does not exist before The Second Dream. Three fields
  // READ AND EMPTY is that; three fields MISSING is a partial read and nothing
  // more. `measured` cannot tell them apart - it is one boolean for the whole
  // payload, true the moment any recognised key arrives - so each field states
  // its own presence and all three must be present before the claim is made.
  if (measured && read.pools && read.nodes && read.dailyZero && pooledTotal === 0 && nodesUnlocked === 0) {
    return (
      <div className="grid h-full place-items-center p-8">
        <EmptyState
          title="Focus not unlocked"
          /* The three things actually READ AND FOUND EMPTY, named as such. It
             said "no daily cap", which was a description of the old test - an
             absent `DailyFocus` - and the test is now "present and zero". */
          detail="This account carries no pooled focus in any school, no unlocked nodes and no focus left to earn today. The operator and the five schools unlock with The Second Dream."
          className="w-full max-w-[52ch]"
        />
      </div>
    );
  }
  /*
   * `measured` SPEAKS FOR THE PAYLOAD, NOT FOR ANY FIELD IN IT.
   *
   * It is true the moment `acquire.ts` accepts anything at all, so on a partial
   * read it stands over figures whose key never arrived - and every one of them
   * is `?? 0` on the way here. That was invisible while the not-unlocked claim
   * above swallowed the whole screen for exactly those accounts; correcting the
   * claim is what makes the panel render for them, so the plates behind it have
   * to be honest too or the same lie survives in smaller type. Each figure now
   * reads the presence of the key it actually comes from.
   */
  const readPools = measured && read.pools;
  const readNodes = measured && read.nodes;

  // reduce without a seed: `schools` is the fixed five, but noUncheckedIndexedAccess
  // still types schools[0] as possibly undefined, and a seeded reduce would lie about it.
  //
  // THE GUARD IS THE POOL, NOT THE LIST LENGTH. `schools.length > 0` names the
  // right worry - the comment under it said so - and cannot act on it: the five
  // schools are hardcoded, so it is a constant that is true on every account,
  // and with every pool tied at zero the seedless reduce falls through to
  // `schools[0]` and the section announced "Madurai · 0" as the lead. A best
  // that is really list order. Nothing banked means there is no largest, so the
  // gate is the total, which is also what makes the reduce safe: a positive
  // total needs at least one school to reduce over.
  const lead = readPools && pooledTotal > 0 ? schools.reduce((best, s) => (s.pooled > best.pooled ? s : best)) : null;

  // Null, not zero, when the remaining figure exceeds the cap. That is our cap
  // formula disagreeing with the game, and `Math.max(0, …)` turned the
  // disagreement into a confident "0 earned · 0% of today's cap" - a measured
  // figure's shape over an unresolvable one. Both consumers below are already
  // gated on null, so it simply is not drawn.
  const dailyEarned =
    daily.cap !== null && daily.remaining !== null && daily.remaining <= daily.cap ? daily.cap - daily.remaining : null;
  const dailyUsed = daily.cap !== null && daily.cap > 0 && dailyEarned !== null ? dailyEarned / daily.cap : null;

  const schoolBound = nodesUnlocked - waybound.unlocked;

  /*
   * The selected school, answered.
   *
   * Computed here rather than memoised: it is a handful of divisions over
   * numbers already in hand, and it changes on every selection, which is exactly
   * the input a memo would be keyed on.
   *
   * Note what `nodes` does with an unread account. The census over an empty
   * payload has no row for any school, and "no row" would ordinarily mean zero
   * nodes - which is the one thing this panel refuses to say when it has read
   * nothing. So the row is null unless `measured`, and only then does an absent
   * row become a genuine zero.
   */
  const chosen = selected === null ? null : (schools.find((s) => s.key === selected) ?? null);
  const dossier: SchoolDossier | null =
    chosen === null
      ? null
      : schoolDossier({
          key: chosen.key,
          pooled: readPools ? chosen.pooled : null,
          pooledTotal: readPools ? pooledTotal : null,
          nodes: readNodes ? (census.bySchool.get(chosen.key) ?? { unlocked: 0, unbound: 0 }) : null,
          dailyCap: daily.cap,
          unread: UNREAD,
        });

  return (
    /*
     * ONE SCREEN: A PINNED BAND, TWO PANES, AND A PINNED CAVEAT.
     *
     * WHAT WAS MEASURED. Driven through a real browser at 1280x720 with no
     * account read - the cold-launch state, which is what the owner actually
     * sees - this panel emitted 1,241 px into a 672 px viewport. Just under two
     * screens, from six sections stacked in one narrow column with the right
     * third of the window empty, and ten em-dash readouts all saying the same
     * one thing.
     *
     * The shape is now a fixed-height grid, and `min-h-0` on every row and every
     * pane of the chain is what makes that true. It is also the easy thing to
     * leave out: a grid child defaults to `min-height: auto` and refuses to
     * shrink below its content, so one missing `min-h-0` anywhere and the page
     * grows again with nothing on the screen to say that it has.
     *
     *   - the BAND is what can still be acted on today - or, with nothing read,
     *     the single sentence saying so. It never scrolls away.
     *   - the LEFT pane is the five schools. It is the CONTROL: picking one is
     *     what makes the right pane compute.
     *   - the RIGHT pane is the school that was picked, which is the ANSWER to
     *     the gesture the reader just made, so it sits beside the gesture rather
     *     than a screen below it.
     *   - the FOOTER is the standing caveat about what the account never
     *     carries. True on every account forever, so it is pinned rather than
     *     left at the bottom of a scroll nobody reaches.
     *
     * Each pane scrolls inside itself. The page does not scroll at all.
     */
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-4 p-5">
      <MotionRules />

      {/* ---- the band: today, or the one sentence saying today is unread ---- */}
      {/*
        THE PLATES DO NOT RENDER WHEN THERE IS NOTHING IN THEM.
        ————————————————————————————————————————————
        With no account read all three were dashes - five of them - and three
        large plates of nothing is a hole, not an empty state: it reads as the
        panel being broken rather than as the app not having been told anything
        yet. The banner says it once, in a sentence, and carries the three
        readouts' GAME facts one press down. A partial read still gets the
        plates, because there a dash is a real difference between fields rather
        than one fact wearing five costumes.
      */}
      {measured ? (
      <section className="min-w-0">
        {/* The section owns the honesty its values used to repeat one word at a
            time. Each dash still explains itself on hover. */}
        <SectionTitle note={readPools && readNodes ? 'what expires and what overflows' : 'every dash is unread, not zero'}>
          Today
        </SectionTitle>

        {/*
         * Wraps on the width this grid actually has, not on the window's.
         * `lg:` measures the viewport, so at a 1100px window the three plates
         * stayed side by side in ~330px each and every small-caps label broke
         * in half. `auto-fit` with a floor drops the third plate onto its own
         * row instead, and gives it the full width when it lands there.
         *
         * THE FLOOR CAME DOWN FROM 22rem TO 21rem, AND THE ONE REM IS THE WHOLE
         * DIFFERENCE. This container is 1,056px wide at 1280x720 - the window
         * less the 184px rail and this panel's own padding - and three 22rem
         * plates with their gutters want 1,062. Six pixels short, so the third
         * plate wrapped, the band stood two rows deep at about 380px of a 632px
         * screen, and the figure and the answer below it were left less room
         * than either needs. At 21rem the three want 1,014, sit in one row, and
         * each ends up 350px wide - past the ~330px where the small-caps labels
         * start breaking mid-word, which is the defect the floor exists for.
         */}
        <div className="mo-stagger grid gap-[3px] [grid-template-columns:repeat(auto-fit,minmax(min(100%,21rem),1fr))]">
          {/* THE BOLD ELEMENT. Use-it-or-lose-it, so it is the only hero on the
              panel and the only thing wearing energy cyan.

              `mo-field` here and the sheen on the inner surface: this outer is
              a one-pixel gradient border, and a light drawn behind the inner
              fill would never be seen. The tilt reads the same signed offsets
              the field writes, so the plate turns toward the cursor. */}
          <div
            className="mo-field mo-tilt mo-in-settle relative isolate"
            style={{
              clipPath: CHAMFER,
              padding: 1,
              background: `linear-gradient(150deg, ${HERO}, oklch(0.78 0.115 228 / 0.16) 44%, transparent 78%)`,
            }}
          >
            <div
              className="mo-sheen relative flex h-full flex-col justify-between gap-4 px-6 py-5"
              style={{
                clipPath: CHAMFER,
                background:
                  'radial-gradient(120% 150% at 0% 0%, oklch(0.78 0.115 228 / 0.10), transparent 58%), linear-gradient(168deg, oklch(0.155 0.026 264 / 0.97), oklch(0.105 0.022 275 / 0.98))',
              }}
            >
              {/* Wraps between the two labels, never inside one: "USE IT OR LOSE /
                  IT" and "FOCUS EARNABLE / TODAY" were both readable as gibberish. */}
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span aria-hidden className="size-[5px] rotate-45" style={{ background: HERO }} />
                <span className="eyebrow whitespace-nowrap" style={{ color: 'var(--color-tenno-300)' }}>
                  Focus earnable today
                </span>
                <span className="eyebrow ml-auto whitespace-nowrap">use it or lose it</span>
              </div>

              <div>
                {daily.remaining !== null ? (
                  <div className="flex items-baseline gap-2.5">
                    <span
                      className="numeric text-[length:var(--text-hero)] leading-none"
                      style={{ color: 'var(--color-tenno-200)' }}
                    >
                      {int(daily.remaining)}
                    </span>
                    {daily.cap !== null && (
                      <span className="numeric text-[length:var(--text-small)]" style={{ color: 'var(--text-muted)' }}>
                        / {int(daily.cap)}
                      </span>
                    )}
                  </div>
                ) : (
                  /* The one dash on this screen with a gap of its own: a read
                     account that still carries no allowance is a different fact
                     from no account, and only that case earns a reason. */
                  <Unknown
                    why={
                      staleAcrossReset
                        ? 'This account was captured before the last daily reset, so what is left today is not in it.'
                        : measured
                          ? "Today's remaining allowance is not in this account read."
                          : undefined
                    }
                  />
                )}

                {dailyUsed !== null && dailyEarned !== null && (
                  <div className="mt-3">
                    <Track value={dailyUsed} color={HERO} height={4} />
                    <div
                      className="numeric mt-1.5 text-[length:var(--text-micro)]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {int(dailyEarned)} earned · {pct(dailyUsed)} of today&apos;s cap
                    </div>
                  </div>
                )}
              </div>

              <div className="text-[length:var(--text-micro)] leading-snug" style={{ color: 'var(--text-muted)' }}>
                <Clamp lines={2}>
                  {daily.cap !== null
                    ? 'Cap is 250,000 + MR × 5,000. '
                    : measured
                      ? 'Cap needs mastery rank, which is missing. '
                      : 'Cap is 250,000 + MR × 5,000, once your rank is known. '}
                  {resetsAtMs !== null
                    ? `Resets ${new Date(resetsAtMs).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}.`
                    : 'Resets 00:00 UTC.'}
                </Clamp>
              </div>
            </div>
          </div>

          {/* The pool. Nothing caps it, so nothing here earns a warning colour. */}
          <div
            className="rf-plate mo-field mo-sheen mo-lift mo-in-up relative px-5 py-4"
            /* `--i` rather than an inline animationDelay: the stagger belongs
               to the parent, which caps it, and an inline delay would beat the
               cap. */
            style={
              {
                clipPath: CHAMFER,
                background: PLATE,
                '--i': 1,
              } as React.CSSProperties
            }
          >
            <span
              aria-hidden
              className="rf-edge absolute top-0 bottom-0 left-0 w-[2px]"
              style={{ background: 'var(--color-tenno-500)' }}
            />
            <Label>Pooled focus</Label>
            <div className="mt-2 flex items-baseline gap-2">
              {readPools ? (
                <span className="numeric text-[length:var(--text-title)] leading-none" style={{ color: 'var(--text)' }}>
                  {short(pooledTotal)}
                </span>
              ) : (
                <Unknown />
              )}
            </div>

            <div className="mt-3 text-[length:var(--text-micro)] leading-snug" style={{ color: 'var(--text-muted)' }}>
              <Clamp lines={2}>
                Unspent, waiting to go into nodes. Nothing caps what you hold; the daily cap is what limits what you
                earn.
              </Clamp>
            </div>
          </div>

          {/* Nodes. Unlocked is known; every denominator is not. */}
          <div
            className="rf-plate mo-field mo-sheen mo-lift mo-in-up relative px-5 py-4"
            style={
              {
                clipPath: CHAMFER,
                background: PLATE,
                '--i': 2,
              } as React.CSSProperties
            }
          >
            <span
              aria-hidden
              className="rf-edge absolute top-0 bottom-0 left-0 w-[2px]"
              style={{ background: 'var(--color-orokin-500)' }}
            />
            <Label>Nodes unlocked</Label>
            <div className="mt-2 flex flex-wrap items-baseline gap-2">
              {readNodes ? (
                <span className="numeric text-[length:var(--text-title)] leading-none" style={{ color: 'var(--text)' }}>
                  {int(nodesUnlocked)}
                </span>
              ) : (
                <Unknown />
              )}
              {/* NO DENOMINATOR, AND NO SENTENCE ABOUT NOT HAVING ONE.
                  "of — the account carries no total for the trees" sat here
                  permanently, on every account, measured or not - a second
                  standing refusal three lines above a plate full of dashes. It
                  is the same class of gap the footer already states for focus
                  spent and focus still needed, so it is stated there with them,
                  once, and the count is left to be the count it is. */}
            </div>

            <div className="mt-3.5 grid grid-cols-2 gap-3">
              <div>
                <Label>Waybound</Label>
                <div
                  className="numeric mt-1 text-[length:var(--text-lead)] leading-none"
                  style={{ color: 'var(--color-orokin-300)' }}
                >
                  {readNodes ? waybound.unlocked : <Unknown />}
                </div>
                <div className="mt-1 text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
                  universal
                </div>
              </div>
              <div>
                <Label>School-bound</Label>
                <div
                  className="numeric mt-1 text-[length:var(--text-lead)] leading-none"
                  style={{ color: 'var(--color-tenno-300)' }}
                >
                  {readNodes ? Math.max(0, schoolBound) : <Unknown />}
                </div>
                <div className="mt-1 text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
                  per school
                </div>
              </div>
            </div>

            {/* Honest: a share of the unlocked set, not of a total nobody here knows. */}
            {readNodes && nodesUnlocked > 0 && (
              <div className="mt-3.5">
                <Track value={waybound.unlocked / nodesUnlocked} color="var(--color-orokin-400)" />
                <div className="numeric mt-1.5 text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
                  waybound share of unlocked
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
      ) : (
        <AccountBanner />
      )}

      {/*
        ---- the control and the answer, side by side -----------------------

        The figure was a full-width section with the card underneath it, so
        choosing a school moved the answer to somewhere the reader was not
        looking - and, at 1280x720, to somewhere off the bottom of the screen
        entirely. Beside it, the cause and the effect are in one glance, and the
        right third of the window that was empty is now carrying the answer.

        Both panes take their own `overflow-y-auto`. In practice neither is
        expected to use it; what the containers guarantee is that if one ever
        does - a long verdict, four nested disclosures opened at once - it
        scrolls without moving anything else on the screen and without the page
        growing.
      */}
      <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:grid-rows-[minmax(0,1fr)]">
      <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto pr-1">
      {/* ---- the five schools ---------------------------------------------- */}
      <Fold
        title="The five schools"
        /* The bars are `pooled / pooledTotal` - each school's share of what you
           hold, which is the ratio `Pentad` documents and the same one the
           dossier prints as "Share of pool". This read "bars relative to
           <lead>", which describes a different number: a school holding a
           quarter of the pool draws at a quarter of the arm here, not at a
           quarter of the leader's. The number is the one every other surface
           agrees with, so the LABEL was the wrong half and is the half that
           changed. The lead is still named, in the answer beside it. */
        eyebrow={lead ? 'bar length is share of the pool' : 'five peers, no ordering'}
        /*
         * THE ONE SECTION THAT OPENS ITSELF.
         *
         * It is the subject of the panel and it is also the only CONTROL on
         * it: picking a school here is what makes the dossier below compute.
         * A collapsed figure with a card underneath saying "pick a school in
         * the figure" would be incoherent, so this is the section that gets
         * the open slot and Today keeps its plates.
         */
        defaultOpen
        answer={
          lead !== null ? (
            <span className="numeric">
              {lead.name} · {short(lead.pooled)}
            </span>
          ) : readPools ? (
            /* A counted zero, in words. `lead` is null for two different
               reasons now and they are not the same fact: nothing read, and
               nothing banked. Calling a read account "unmeasured" would be the
               absent-is-zero error run backwards. */
            <span style={{ color: 'var(--text-muted)' }}>nothing banked yet</span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>unmeasured</span>
          )
        }
      >
        {/*
         * A pentad, not a list.
         *
         * Five peers with no ordering, each with an identity and a magnitude, is
         * a radial problem — and the game itself arranges the schools around the
         * Operator, so a player already knows Madurai by WHERE it is. Stacking
         * them as rows threw that away and made this panel look like every other
         * panel.
         */}
        {/*
         * The pentad's labels sit outside its own square viewBox — measured at
         * the two horizontal points, "Vazarin" runs to x=329 and "Zenurik"
         * starts at x=-30 in a 0..300 box — so the SVG's default overflow clip
         * was cutting two of the five school names in half ("VAZ…", "…URIK").
         * Unclip the figure and give it the ~30px of room on each side that its
         * labels actually occupy.
         */}
        <div className="px-9 [&_svg]:overflow-visible">
          <Pentad
            schools={schools.map((s): PentadSchool => ({
              key: s.key,
              name: s.name,
              creed: SCHOOL_CREED[s.key],
              ink: SCHOOL_INK[s.key],
              share: readPools && pooledTotal > 0 ? s.pooled / pooledTotal : null,
              value: readPools ? short(s.pooled) : null,
            }))}
            selected={selected}
            onSelect={setSelected}
          />
        </div>
      </Fold>
      </div>

      {/* ---- the one school a reader asked about --------------------------- */}
      <section className="flex min-h-0 min-w-0 flex-col overflow-y-auto pr-1">
        <SectionTitle note={chosen === null ? 'arrow keys move, Enter picks' : 'Esc clears'}>
          {chosen === null ? 'One school' : chosen.name}
        </SectionTitle>

        {chosen === null || dossier === null ? (
          /*
           * The unselected state is not a placeholder and not an empty box. It
           * says what the control does and then spends its space on the one
           * account-wide figure that belongs to the same question the card
           * answers - so a reader who never clicks anything still leaves with
           * something the panel could not tell them before.
           */
          <div
            className="rf-plate mo-field mo-sheen mo-in-up relative px-5 py-4"
            style={{ clipPath: CHAMFER, background: PLATE }}
          >
            <span
              aria-hidden
              className="rf-edge absolute top-0 bottom-0 left-0 w-[2px]"
              style={{ background: 'var(--color-orokin-500)' }}
            />
            <div className="text-[length:var(--text-small)] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              <Clamp lines={2}>
                Pick a school — in the figure or in the list beside it — for its pool at full precision, how many of
                your unlocked nodes are actually in it, and what its remaining waybound nodes still cost.
              </Clamp>
            </div>
            <div className="mt-2.5 text-[length:var(--text-micro)] leading-snug" style={{ color: 'var(--text-muted)' }}>
              {readNodes ? (
                <>
                  Across all five: {int(census.unboundTotal)} of the ten waybound nodes are unbound
                  {census.unplaced > 0 && (
                    <>
                      {' '}
                      · {int(census.unplaced)} unlocked {census.unplaced === 1 ? 'node sits' : 'nodes sit'} on a path
                      that names no school and {census.unplaced === 1 ? 'is' : 'are'} counted in no school here
                    </>
                  )}
                  .
                </>
              ) : (
                /* NOT A DASH, AND THIS ONE IS THE CLEAREST CASE ON THE PANEL.
                   It read "Across all five: — of the ten waybound nodes", which
                   is a sentence built around an unknown that the band above has
                   already stated in full. The ten is the half that is a fact
                   about the game and is true with the game never launched, so
                   it survives as a fact rather than as a denominator under a
                   dash — one of the ten em-dashes the cold-launch screen was
                   measured printing, removed without losing anything. */
                <>There are ten waybound nodes across the five schools, two in each.</>
              )}
            </div>
          </div>
        ) : (
          <Dossier d={dossier} name={chosen.name} creed={SCHOOL_CREED[chosen.key]} ink={SCHOOL_INK[chosen.key]} />
        )}
      </section>
      </div>

      <footer className="mo-arrive flex flex-wrap items-center gap-x-4 gap-y-1">
        {/* The gap a focus tracker's "spent" and "still needed" figures would
            fill, stated once. The derivation hardcodes both as unavailable, so
            the "Completion" section that used to render them could never show
            anything but dashes — a whole block whose information content was
            zero, by construction.

            Clamped to one line: it is the same claim every time, it is on
            every focus screen forever, and a reader who has read it once
            should not have to read it again to reach the footer under it. */}
        <div className="basis-full text-[length:var(--text-micro)] leading-snug" style={{ color: 'var(--text-muted)' }}>
          <Clamp lines={1}>
            The account carries unspent pools and which nodes are unlocked, never what a node cost and never how many
            nodes exist — so focus spent, focus still needed and any completion share are not shown rather than
            invented.
          </Clamp>
        </div>
        {/* The daily reset is NOT repeated here: the hero above already prints it,
            as the exact instant when the account carries one. */}
        {focus.activeAbility !== null && (
          <span className="eyebrow" style={{ color: 'var(--color-tenno-300)' }}>
            active · {prettyPath(focus.activeAbility)}
          </span>
        )}
      </footer>
    </div>
  );
}
