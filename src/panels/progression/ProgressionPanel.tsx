import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useAccount } from '../../core/store';
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { NextMoveDrills } from './NextMoveDrills';
import { derive } from '../../data/progression';
import { canonFrom, loadCatalog, type LoadedCatalog } from '../../data/datasets';
import {
  GOALS,
  DOMAIN_LABEL,
  TIER_DETAIL,
  TIER_LABEL,
  rankPursuits,
  type Domain,
  type GoalProfile,
  type RankedPursuit,
} from '../../data/pursuits';
import { buildGraph, solve, type GoalId, type Graph, type Solved } from '../../data/leverage';
import { NOTHING_OBSERVED, observe } from '../../data/plat-throughput';
import { recentMissions, type StoredMission } from '../../data/history-store';
import { questSplit, makeProgressFor } from '../../data/pursuit-progress';
import { pursuitGate, buildQuests, type Quest } from '../../data/quests';
import { frontier } from '../../data/catalog';
import { QuestRow, TrackedQuests, useTracked } from './QuestLog';
import { subscribeFocus } from '../../ui/navigation';
import { loadItemDb, ownership, type ItemDb, type OwnershipReport } from '../../data/itemdb';
import { CompletionWheel } from './CompletionWheel';
import { CHAMFER } from '../../ui/geometry';

/**
 * PROGRESSION — the whole board.
 *
 * WHAT WAS WRONG
 * ──────────────
 * The previous panel showed one directive, four stat tiles and a short list. For
 * a player whose stated goal is completionism that is not a plan, it is a
 * teaser: it answers "what next" but never "what is there, and how much of it
 * is left".
 *
 * So this shows EVERYTHING — every pursuit the game contains, from the mainline
 * quest line down to Somachord tones — and then does the only thing that makes
 * an exhaustive list usable: it ranks and tiers it, against a goal the player
 * picks. The same account produces a different board for a Mastery hunter and a
 * star-chart completionist, because for them different work genuinely is the
 * right work.
 *
 * THE HONESTY RULE, MADE VISIBLE
 * ──────────────────────────────
 * Most of the board cannot be measured from what the game actually sends today.
 * Rather than hide those pursuits (which would quietly redefine "complete") or
 * draw them at 0% (which would be a false claim), they are listed and marked
 * `not measured`. A player can see the whole shape of the game AND see exactly
 * how much of it this app can currently verify. Those are two different facts
 * and both belong on screen.
 */

/**
 * Load the item catalog once per window.
 *
 * This is what gives most of the board a real denominator: without it every
 * collection pursuit reports "not measured", which is honest but useless. It is
 * fetched rather than vendored because DE ships new items constantly and a
 * frozen copy would be wrong within weeks.
 */
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

/** Load the vendored star chart / quest / junction data once per window. */
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

/**
 * The player's own run timings, for the guidance engine.
 *
 * THE SAME LOG THE PLATINUM PANEL RATES ROUTES FROM, read the same way. The
 * engine used to price every objective at one - a Capture and a quest the same
 * size - because nothing told it how long anything took. This is what tells it.
 * Null until the store answers, and an empty list on failure, so the engine
 * falls back to its count-based cost rather than waiting on a read that may
 * never come.
 */
function useRuns(): StoredMission[] | null {
  const [runs, setRuns] = useState<StoredMission[] | null>(null);
  useEffect(() => {
    let alive = true;
    void recentMissions(500)
      .then((rows) => alive && setRuns(rows))
      .catch(() => alive && setRuns([]));
    return () => {
      alive = false;
    };
  }, []);
  return runs;
}

/**
 * One hue per domain, so a row is identifiable before it is read.
 *
 * Grouped rather than sixteen distinct hues: sixteen would be a rainbow and
 * would carry no meaning. These cluster by kind — the narrative spine and the
 * chart in gold, gear in cyan, endgame in violet, upkeep in green — so the
 * colour tells you the CATEGORY at a glance and the label tells you the rest.
 */
const DOMAIN_HUE: Record<Domain, string> = {
  narrative: 'oklch(0.83 0.105 90)',
  starchart: 'oklch(0.83 0.105 90)',
  endgame: 'oklch(0.68 0.16 300)',
  mastery: 'oklch(0.78 0.115 228)',
  collection: 'oklch(0.78 0.115 228)',
  mods: 'oklch(0.70 0.10 210)',
  relics: 'oklch(0.70 0.10 210)',
  arcanes: 'oklch(0.70 0.10 210)',
  operator: 'oklch(0.72 0.13 268)',
  railjack: 'oklch(0.72 0.13 268)',
  nemesis: 'oklch(0.63 0.18 27)',
  syndicate: 'oklch(0.76 0.14 152)',
  events: 'oklch(0.80 0.15 72)',
  routine: 'oklch(0.76 0.14 152)',
  economy: 'oklch(0.76 0.14 152)',
  codex: 'oklch(0.62 0.03 265)',
};


/* ------------------------------------------------------------------ directive */


/* ---------------------------------------------------------------- goal picker */

function GoalPicker({
  value,
  onChange,
  effect,
}: {
  value: GoalProfile;
  onChange: (g: GoalProfile) => void;
  /**
   * What picking this goal actually did, in one line.
   *
   * The single most direct answer to "I select different filters and nothing
   * changes": rather than making the player hunt the board for a difference,
   * the picker says what moved and what the next move became.
   */
  effect: string | null;
}) {
  return (
    /*
      SEVEN CHIPS AND TWO PARAGRAPHS, FOLDED BEHIND THE ONE YOU PICKED.

      This block sat permanently open directly under the answer: seven goal
      chips, a sentence describing the selected goal, and a second sentence
      saying what selecting it did. All of that is worth having and none of it
      is worth re-reading, because six of the seven chips are not selected and
      both sentences are about the one that is.

      Folded, the closed row names the active goal and what the pick actually
      changed - which is exactly what the two paragraphs said - so a reader who
      never opens it has lost nothing and has been given back a third of the
      screen above the board.
    */
    <div className="anim-rise" style={{ animationDelay: '60ms' }}>
      <Disclosure
        accent="var(--color-tenno-300)"
        eyebrow="What kind of completion are you after"
        summary={value.label}
        // The EFFECT, not the label repeated: the summary already says which
        // goal is on, and the single most common complaint about this picker
        // was "I select different filters and nothing changes". The one line
        // that answers that is the one worth showing while closed.
        answer={
          effect === null ? undefined : (
            <span className="line-clamp-1 max-w-[34ch]" style={{ color: 'var(--color-tenno-300)' }}>
              {effect}
            </span>
          )
        }
      >
        <div className="mo-stagger flex flex-wrap gap-1.5">
          {GOALS.map((g, i) => {
            const on = g.id === value.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onChange(g)}
                aria-pressed={on}
                title={g.detail}
                /*
                 * No `transition-colors`: the styles below are selection state.
                 *
                 * `mo-magnet` is the one transform class - `mo-lift` and
                 * `mo-tilt` declare the same property, so stacking them would
                 * be one silently winning and the others doing nothing. A chip
                 * that leans toward the cursor reads as a rail responding to
                 * where you are rather than seven buttons that light up.
                 */
                className="rf-clipped mo-field mo-magnet mo-sheen mo-focusable mo-in-up relative cursor-pointer px-3.5 py-2"
                style={{
                  clipPath: 'polygon(7px 0, 100% 0, calc(100% - 7px) 100%, 0 100%)',
                  background: on ? 'oklch(0.78 0.115 228 / 0.20)' : 'oklch(1 0 0 / 0.035)',
                  boxShadow: on ? 'inset 0 -2px 0 var(--color-tenno-400)' : 'none',
                  '--i': String(i),
                } as CSSProperties}
              >
                <span
                  className="font-[family-name:var(--font-display)] text-[length:var(--text-nano)] font-semibold tracking-[0.14em] uppercase"
                  style={{ color: on ? 'var(--color-tenno-200)' : 'var(--text-faint)' }}
                >
                  {g.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* A <div> rather than a <p>, so `Clamp` can live in it: Clamp renders
            a div holding a button, and the parser closes a p at the div. */}
        <div className="text-[length:var(--text-small)]" style={{ color: 'var(--text-faint)' }}>
          <Clamp lines={2}>{value.detail}</Clamp>
        </div>

        {effect !== null && (
          <p className="wf-note" style={{ color: 'var(--color-tenno-300)' }}>
            {effect}
          </p>
        )}
      </Disclosure>
    </div>
  );
}

/* ------------------------------------------------------------------- filters */

/**
 * Narrow the board.
 *
 * Sixty rows is the right amount of CONTENT and the wrong amount to scroll
 * through looking for one thing. Three controls, each answering a question a
 * completionist actually asks:
 *
 *   - "show me only the gear stuff"        -> domain chips
 *   - "hide what I have already finished"  -> done toggle
 *   - "where is that one thing"            -> text filter
 *
 * All three are presentation-only: they change what is rendered, never the
 * ranking, so the tier a row sits in does not shift when you filter.
 */
function Filters({
  active,
  onToggleDomain,
  onClear,
  hideDone,
  onHideDone,
  query,
  onQuery,
  showing,
  total,
}: {
  active: ReadonlySet<Domain>;
  onToggleDomain: (d: Domain) => void;
  onClear: () => void;
  hideDone: boolean;
  onHideDone: (v: boolean) => void;
  query: string;
  onQuery: (v: string) => void;
  showing: number;
  total: number;
}) {
  return (
    /*
      FOLDED, AND THE CLOSED ROW SAYS WHETHER IT IS DOING ANYTHING.

      A search field, a toggle and a token rail sitting open above the board is
      three controls' worth of chrome between the reader and the thing being
      controlled - and in the overwhelmingly common case, none of the three is
      set to anything.

      The answer is the only fact a reader needs from a filter they have not
      touched: whether it is narrowing. "165 of 165" was deliberately suppressed
      inside for being the same number twice; on the closed row the equivalent
      is a word, and it is the word that decides whether to open this at all.
    */
    <Disclosure
      className="anim-rise"
      eyebrow="Narrow the board"
      summary="Filters"
      accent="var(--color-tenno-300)"
      answer={
        showing === total ? (
          <span style={{ color: 'var(--text-faint)' }}>not filtering</span>
        ) : (
          <span style={{ color: 'var(--color-tenno-300)' }}>
            {showing} of {total}
          </span>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Filter pursuits"
          aria-label="Filter pursuits by name"
          className="mo-focusable w-[200px] px-3 py-1.5 text-[length:var(--text-small)] outline-none"
          style={{
            clipPath: 'var(--chamfer-sm)',
            background: 'oklch(1 0 0 / 0.05)',
            color: 'var(--text)',
          }}
        />

        <button
          type="button"
          onClick={() => onHideDone(!hideDone)}
          aria-pressed={hideDone}
          // No `transition-colors`: the styles below are toggle state.
          // `mo-magnet` transitions TRANSFORM, which carries no state and so
          // cannot strand a lie about whether the toggle is on.
          className="rf-clipped mo-field mo-magnet mo-sheen mo-focusable cursor-pointer px-3 py-1.5"
          style={{
            clipPath: 'polygon(7px 0, 100% 0, calc(100% - 7px) 100%, 0 100%)',
            background: hideDone ? 'oklch(0.76 0.14 152 / 0.20)' : 'oklch(1 0 0 / 0.035)',
          }}
        >
          <span
            className="font-[family-name:var(--font-display)] text-[length:var(--text-nano)] font-semibold tracking-[0.14em] uppercase"
            style={{ color: hideDone ? 'var(--color-signal-good)' : 'var(--text-faint)' }}
          >
            Hide complete
          </span>
        </button>

        {/* Only when a filter is actually narrowing: "165 of 165" forty pixels
            above a heading that says 165 is the same number twice. */}
        {showing !== total && (
          <span className="eyebrow ml-auto">
            {showing} of {total}
          </span>
        )}
      </div>

      {/*
       * THE ACTIVE FILTERS, NOT A SECOND PICKER.
       *
       * This row used to render all sixteen domains as chips - directly beneath
       * a wheel that already renders the same sixteen domains as arcs, and whose
       * arcs are real buttons (role, tabIndex, aria-pressed, keyboard handler in
       * CompletionWheel.tsx:229-239). Two complete pickers for one filter, one
       * above the other, is the clutter complaint in its plainest form: sixteen
       * controls of which fifteen are usually inert, competing with the hero.
       *
       * Now it shows only what is actually filtering. Empty by default, so it
       * costs nothing until you use it; clicking a token removes that domain.
       * The wheel remains the way filters go ON, which is what it was already
       * built to be.
       */}
      <div className="flex flex-wrap gap-1">
        {[...active].map((d) => {
          const on = true;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onToggleDomain(d)}
              aria-pressed={on}
              /*
               * NO `transition-colors`. It strands: on a frozen document
               * timeline a colour transition holds its FROM value, so toggling
               * a chip left the background showing the old state while the
               * underline - which is a box-shadow and so not covered by that
               * class - switched immediately. The chip contradicted itself.
               * `.rf-row` supplies hover and press from the compositor instead.
               */
              className="rf-clipped rf-row mo-magnet mo-focusable cursor-pointer px-2.5 py-1"
              style={{
                clipPath: 'polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%)',
                background: on ? 'oklch(1 0 0 / 0.10)' : 'oklch(1 0 0 / 0.025)',
                /*
                 * The domain's own hue as an underline, ALWAYS - which is what
                 * makes the claim below true. It used to appear only on the
                 * active chips, so the row bars' colours had no key unless you
                 * happened to have switched every filter on, which also happens
                 * to be the one state in which the filter does nothing.
                 */
                boxShadow: `inset 0 -2px 0 ${DOMAIN_HUE[d]}`,
                opacity: on ? 1 : 0.75,
                '--rf-row-accent': DOMAIN_HUE[d],
              } as React.CSSProperties}
            >
              <span
                className="text-[length:var(--text-micro)] tracking-[0.1em] uppercase"
                // `--text-muted`, not `--text-ghost`. Ghost is the tone for
                // decoration; these are sixteen live controls and at that weight
                // they were effectively invisible against the plate.
                style={{ color: on ? 'var(--text)' : 'var(--text-muted)' }}
              >
                {DOMAIN_LABEL[d]}
              </span>
            </button>
          );
        })}
        {active.size > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="mo-field mo-underline mo-focusable cursor-pointer px-2.5 py-1 text-[length:var(--text-micro)] tracking-[0.1em] uppercase"
            style={{ color: 'var(--color-tenno-300)' }}
          >
            Clear
          </button>
        )}
      </div>
    </Disclosure>
  );
}

/* -------------------------------------------------------------------- states */

/**
 * The board WITHOUT an account.
 *
 * This panel used to refuse to render at all until the game had run, which was
 * the same mistake the star chart made: the taxonomy of pursuits, the goal
 * profiles and the item-catalog totals are all real and useful before the game
 * has ever been launched. Only the PROGRESS needs an account.
 *
 * So the board always renders, and this states plainly what is missing and what
 * to do about it — rather than hiding an entire feature behind a precondition it
 * does not actually have.
 */
function AccountBanner() {
  const running = useAccount((s) => s.gameRunning);
  const gep = useAccount((s) => s.gep);

  const [title, detail] = !running
    ? ['Showing the full board, unmeasured', 'Run Warframe once and your progress is captured and kept — after that this panel stays accurate with the game closed.'] as const
    : gep === 'connected'
      ? ['Linked — waiting for your account', 'Your account arrives on the next update the game pushes.'] as const
      : ['Linking to the game', 'Establishing the game-events connection. This usually takes a few seconds after launch.'] as const;

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
        {/* A <div>, not a <p>: Clamp renders a div holding a button, and the
            parser closes a paragraph at the div. One line of reason under the
            title, the rest a press away. */}
        <div className="mt-1 text-[length:var(--text-small)] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          <Clamp lines={1}>{detail}</Clamp>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------- panel */

const GOAL_KEY = 'raijiframe.goal';

/** How a cadence reads in a sentence. Module scope: it never changes. */
function cadence(c: string): string {
  return c === 'daily' ? 'daily' : c === 'weekly' ? 'weekly' : c === 'fortnightly' ? 'every two weeks' : 'this season';
}

/** The unit's singular for a count of one; the units are already plural nouns. */
function singular(unit: string, n: number): string {
  if (n !== 1) return unit;
  return unit === 'mastery' ? unit : unit.replace(/s$/, '');
}

/* ------------------------------------------------------------- the answer */

/**
 * WHAT TO DO NEXT, AND THE FOUR MOVES AFTER IT.
 *
 * THE HIERARCHY DECISION
 * ──────────────────────
 * A glance at this panel should learn one thing: the name of the next thing to
 * do. Everything else on the screen is support for that sentence.
 *
 * The panel used to open on the completion wheel - a ring of sixteen arcs, all
 * hatched and unmeasured before an account exists, above a heading reading "The
 * whole game". It was the loudest element and it answered nothing, while the
 * answer itself was somewhere below the fold in an alphabetical list. So the
 * wheel moves below the board, where a map belongs, and this takes the top.
 *
 * NO PLATE, DELIBERATELY.
 * Every other block on this panel sits on a chamfered plate. Putting one here
 * would make the answer a card among cards. It gets a single cyan rule in the
 * margin instead - the app's colour for the live thing - and otherwise sits
 * directly on the backdrop. It is the only element on the panel that is not in
 * a box, which is what makes it read as the statement rather than an item.
 *
 * ONE ACCENT. Step 1 carries cyan; steps 2-5 are the same rows in `--text-muted`
 * with faint numerals. Five equally-lit rows would be a list again.
 *
 * FROZEN-TIMELINE RULE. Every number here is in its final state at first paint.
 * The entrance is `anim-rise`, transform-only, and decorative: if the document
 * timeline never advances, the block sits nine pixels low and completely
 * legible. Nothing is revealed by a transition and no figure arrives as an
 * animation's TO value.
 */
/**
 * WHICH HALF OF THE ANSWER THIS CALL IS RENDERING.
 *
 * WHAT WAS MEASURED. Driven through a real browser at 1280x720 with no account
 * read, this panel emitted 1,498 px into a 672 px viewport - 2.38 screens -
 * across eight top-level siblings, and this section alone was roughly half the
 * viewport: the eyebrow, a 42 px title, the sentence, and then THREE sibling
 * disclosure rows (the two drills and the plan) at about 65 px each. Pinning
 * all of that would have left the board under 220 px, which is a board nobody
 * can read.
 *
 * So the section renders in two parts from ONE derivation. `answer` is the
 * statement - the thing that must never scroll away. `working` is the drills
 * and the plan, which are already one click deep and belong with the reference
 * they explain, directly above the board that was ranked by the same solve.
 *
 * One component rather than two, deliberately: `head`, `gated`, `prereqs`,
 * `cost`, `atLeast` and `figures` are all derived here, and two components
 * would be two copies of that derivation free to drift apart. The derivation is
 * pure and cheap; the guards are written once and cannot disagree.
 */
type AnswerPart = 'answer' | 'working';

function NextMove({
  solved,
  graph,
  unit,
  measured,
  part,
}: {
  solved: Solved | null;
  graph: Graph | null;
  unit: string;
  measured: boolean;
  part: AnswerPart;
}) {
  if (solved === null || graph === null || solved.plan.length === 0) return null;

  const titleOf = (id: string): string => graph.vertices[graph.index.get(id) ?? -1]?.title ?? id;
  const [head, ...rest] = solved.plan;
  if (head == null) return null;

  const gated = solved.gate.get(head) ?? null;
  /*
   * `cost` used to be read here and tested `<= 1` to mean "needs nothing else
   * first" - true only while cost was a COUNT with the row itself included. It
   * is minutes now, wherever the log allows, so that test would have read a
   * one-minute node as prerequisite-free and a ninety-minute one as gated.
   * The count is its own field.
   */
  const prereqs = solved.prereqs.get(head) ?? 0;
  const cost = solved.cost.get(head) ?? null;
  const atLeast = solved.costAtLeast.get(head) ?? false;
  // Behind it, not including it - the figure every step shows. Kept for the
  // whole plan so equal neighbours can be called a tie instead of an order.
  const figures = solved.plan.map((id) => {
    const gate = solved.gate.get(id) ?? null;
    return gate == null ? null : gate - (solved.value.get(id) ?? 0);
  });

  if (part === 'working') {
    /*
      THE WORKING, WHERE THE REFERENCE IT EXPLAINS IS.

      No wrapper element. Both drills and the plan below can each decline to
      render - a head with no timed path, nothing dominated, a one-step plan -
      and an empty wrapper inside a gapped column is a gap with nothing in it,
      which reads as a section that failed to load. A fragment that emits
      nothing takes no space.
    */
    return (
      <>
        <NextMoveDrills solved={solved} head={head} atLeast={atLeast} unit={unit} titleOf={titleOf} />

        {rest.length > 0 && (
          <Disclosure
            accent="var(--color-tenno-300)"
            eyebrow="Then, in order"
            summary="The moves after it"
            answer={<span>{rest.length} queued</span>}
          >
            <ol className="flex flex-col gap-1.5">
              {rest.map((id: string, i: number) => {
                const g = figures[i + 1] ?? null;
                /*
                 * THE ENGINE'S OWN TIE, NOT A LOOK-ALIKE. This used to compare
                 * the figure behind a step with its neighbours' and call equals
                 * "tied - nothing measurable orders them". That was true while
                 * cost was a count of one; with minutes from the log, two rows
                 * opening the same four objectives at 30 and 55 minutes were
                 * labelled tied while the engine scored them 10.0 and 5.5.
                 * `solved.tied` is the engine's definition - equal on every axis
                 * it measures - and the panel had been computing its own and
                 * ignoring it.
                 */
                const tied = solved.tied.has(id);
                return (
                  <li key={id} className="flex items-baseline gap-3">
                    {/* Hanging numeral: the step index sits in the margin so the
                        titles form one clean left edge to read down. */}
                    <span
                      className="numeric w-4 shrink-0 text-right text-[length:var(--text-micro)]"
                      style={{ color: 'var(--text-ghost)' }}
                    >
                      {i + 2}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[length:var(--text-small)]" style={{ color: 'var(--text-muted)' }}>
                      {titleOf(id)}
                    </span>
                    {/* Same figure as a neighbour: nothing measurable orders them. */}
                    {tied && <span className="eyebrow shrink-0">tied</span>}
                    {g != null && (
                      <span className="numeric shrink-0 text-[length:var(--text-micro)]" style={{ color: 'var(--text-faint)' }}>
                        {g.toLocaleString()}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>

            {/*
              The provenance, one level in. It never gates content: the ranking
              above it is the game's own dependency graph and is exactly as true
              before the game has ever run, which is why the closed row can state
              the SOURCE rather than a caveat.
            */}
            <Disclosure
              depth={1}
              summary="How this order was reached"
              answer={<span>{measured ? 'from your account' : 'from a fresh start'}</span>}
            >
              <p className="wf-note">
                {measured
                  ? 'Ranked against what your account has done.'
                  : 'No account captured — this is the game’s own dependency graph, from a fresh start.'}
              </p>
            </Disclosure>
          </Disclosure>
        )}
      </>
    );
  }

  return (
    <section className="anim-rise" style={{ paddingLeft: 18, boxShadow: 'inset 2px 0 0 0 var(--color-tenno-400)' }}>
      <div className="eyebrow" style={{ color: 'var(--color-tenno-300)' }}>
        Do this next
      </div>

      <div className="mt-1.5 flex items-baseline gap-3">
        <span className="numeric w-4 shrink-0 text-right text-[length:var(--text-micro)]" style={{ color: 'var(--color-tenno-300)' }}>
          1
        </span>
        <h2
          className="font-[family-name:var(--font-title)] text-[length:var(--text-title)] leading-[1.1] tracking-[0.02em]"
          style={{ color: 'var(--text)' }}
        >
          {titleOf(head)}
        </h2>
      </div>

      <p className="wf-prose mt-2">
        {gated == null ? (
          'Nothing else has to happen first.'
        ) : (
          <>
            <span className="numeric" style={{ color: 'var(--text)' }}>
              {(gated - (solved.value.get(head) ?? 0)).toLocaleString()}
            </span>{' '}
            {singular(unit, gated - (solved.value.get(head) ?? 0))} {gated - (solved.value.get(head) ?? 0) === 1 ? 'sits' : 'sit'} behind it
            {prereqs === 0 ? ', and it needs nothing else first.' : '.'}
            {/*
              THE COST, IN THE PLAYER'S OWN MINUTES, when the log can say. When
              a member of the path has no minutes of its own - a mission type
              they have never run - it is priced at the slowest type they have,
              and the sentence names that assumption rather than presenting an
              estimate as a reading. A quest on the path is priced at nothing
              and the figure says so. In objectives mode there is nothing to
              add: the sentence above already counts them.
            */}
            {solved.costUnit === 'minutes' && cost != null && cost > 0
              ? ` About ${String(Math.round(cost))} ${Math.round(cost) === 1 ? 'minute' : 'minutes'} of play${
                  atLeast ? ', if the parts you have not run yet go as slowly as your slowest mission' : ', at your own pace'
                }.`
              : ''}
          </>
        )}
      </p>

      {/*
        THE WORKING IS NOT HERE ANY MORE, AND THAT IS THE POINT.

        The verdict is the heading above: one quest, named, with what stands
        behind it. Under it sat the two drills AND the plan - three sibling
        disclosure rows at about 65 px each - so the section a glance is
        supposed to read in one line was around half of a 672 px viewport on
        its own, and the board it introduces could not fit under it.

        They are rendered by the same component under `part="working"`, at the
        top of the reference column below, immediately above the board that the
        same solve ranked. Nothing is deleted and nothing is more than one click
        away; the statement is simply the only thing that is pinned.
      */}
    </section>
  );
}


/* ---------------------------------------------------------- tonight's answer */

/**
 * The hero for "Best use of tonight". Same shape and the same rules as
 * NextMove - one loud line, four quiet ones, every figure final at first paint -
 * but the list is what EXPIRES, ordered by the pursuit ranking's own score.
 */
function Tonight({
  lane,
  measured,
  part,
}: {
  lane: { kind: 'expiry' | 'endgame'; rows: readonly RankedPursuit[]; daily: number; weekly: number; seasonal: number };
  measured: boolean;
  /**
   * SPLIT THE SAME WAY `NextMove` IS, OR THE PANEL CHANGES SHAPE WITH THE GOAL.
   *
   * These two heroes are alternates - one renders or the other does - so if one
   * of them pinned its queue and the other did not, picking "Best use of
   * tonight" would move the board down the screen by the height of a disclosure
   * row and the reader would be looking for what broke. The statement is pinned
   * in both; the queue is in the reference column in both.
   */
  part: AnswerPart;
}) {
  const [head, ...rest] = lane.rows;
  if (head === undefined) return null;
  const expiry = lane.kind === 'expiry';

  /*
   * The provenance sentence, hoisted out of the JSX.
   *
   * One branch of it is genuinely `null` - an expiring pursuit whose state
   * the account CAN answer has no caveat to make - and the fold above has to
   * test the same expression it renders. Inline, the guard would have been a
   * second copy of a four-deep ternary, and the two would eventually disagree
   * about when the section exists.
   */
  const provenance: string | null = expiry
    ? measured
      ? // The same wording as the Daily panel: the two must not disagree.
        // Only under the sortie: the sentence is about the sortie.
        head.id === 'routine.sortie'
        ? 'Whether today’s is already done, your account cannot answer — it records every sortie ever cleared, not which one was today.'
        : null
      : 'Cadence is game data. Whether today’s is already done needs your account, and is not assumed.'
    : measured
      ? 'Ranked by the pursuit taxonomy’s own weights; your progress is read where the game reports it.'
      : 'Ranked by the pursuit taxonomy’s own weights. Your progress needs your account, and is not assumed.';

  if (part === 'working') {
    /*
      No wrapper, for the reason `NextMove` has none: a lane with a single row
      has no queue, and an empty container inside a gapped column is a gap with
      nothing in it.
    */
    if (rest.length === 0) return null;
    return (
      <Disclosure
        accent="var(--color-tenno-300)"
        eyebrow={expiry ? 'Then, soonest first' : 'Then, most valuable first'}
        summary={expiry ? 'What else is on the clock' : 'The rest of the endgame'}
        answer={<span>{Math.min(rest.length, 4)} more</span>}
      >
        <ol className="flex flex-col gap-1.5">
          {rest.slice(0, 4).map((p, i) => {
            /*
             * THE LABEL MARKS THE BREAK, IT DOES NOT TAG EVERY ROW.
             * ————————————————————————————————————————————
             * The endgame rows had nothing in this slot, so four ranked titles
             * read as one undifferentiated list - the rank number says which is
             * first and nothing about where "worth doing now" stops.
             *
             * Stamping the tier on every row fixes that badly: on a real
             * account the top of this list is usually one band, so it renders
             * as HIGH PRIORITY three times, which is repetition wearing the
             * costume of information. The hero above already names the band in
             * words. What is genuinely unknown is where the band CHANGES, so
             * the label appears there and only there - once, at the boundary,
             * measured against the row above it (the hero, for the first).
             *
             * The expiry lane keeps its cadence on every row: daily, weekly and
             * seasonal genuinely alternate down that list, so there is no
             * repetition to collapse.
             */
            const prev = i === 0 ? head : rest[i - 1];
            const breaks = !expiry && p.tier !== prev?.tier;
            return (
              <li key={p.id} className="flex items-baseline gap-3">
                <span className="numeric w-4 shrink-0 text-right text-[length:var(--text-micro)]" style={{ color: 'var(--text-ghost)' }}>
                  {i + 2}
                </span>
                <span className="min-w-0 flex-1 truncate text-[length:var(--text-small)]" style={{ color: 'var(--text-muted)' }}>
                  {p.label}
                </span>
                {expiry ? (
                  <span className="eyebrow shrink-0">{cadence(p.cadence)}</span>
                ) : (
                  breaks && (
                    <span className="eyebrow shrink-0" style={{ color: 'var(--color-orokin-300)' }}>
                      {TIER_LABEL[p.tier]}
                    </span>
                  )
                )}
              </li>
            );
          })}
        </ol>

        {/*
          The provenance, one level in - the same place `NextMove` puts it.
          Under a cadence goal it can be genuinely absent (an expiring pursuit
          whose state the account CAN answer has no caveat to make), and an
          absent caveat is rendered as no section rather than as an empty one:
          a heading over nothing is the failure this whole pass is about.
        */}
        {provenance !== null && (
          <Disclosure
            depth={1}
            summary="How this order was reached"
            answer={<span>{measured ? 'from your account' : 'game data only'}</span>}
          >
            <p className="wf-note">{provenance}</p>
          </Disclosure>
        )}
      </Disclosure>
    );
  }

  return (
    <section className="anim-rise" style={{ paddingLeft: 18, boxShadow: 'inset 2px 0 0 0 var(--color-tenno-400)' }}>
      <div className="eyebrow" style={{ color: 'var(--color-tenno-300)' }}>
        {expiry ? 'Tonight' : 'Endgame, most valuable first'}
      </div>
      <div className="mt-1.5 flex items-baseline gap-3">
        <span className="numeric w-4 shrink-0 text-right text-[length:var(--text-micro)]" style={{ color: 'var(--color-tenno-300)' }}>
          1
        </span>
        <h2
          className="font-[family-name:var(--font-title)] text-[length:var(--text-title)] leading-[1.1] tracking-[0.02em]"
          style={{ color: 'var(--text)' }}
        >
          {head.label}
        </h2>
      </div>
      {/* A <div> rather than a <p>: `Clamp` renders a div holding a button,
          and a div inside a p is closed by the parser at the div. Two lines,
          then a press - the pursuit blurbs run long and the sentence that
          matters is the first one. */}
      <div className="mt-2 max-w-[70ch] text-[length:var(--text-small)] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        <Clamp lines={2}>
          {head.detail}{' '}
          {/*
            WHAT KIND OF COMMITMENT THIS IS, WHICH THE RANK NUMBER CANNOT SAY.
            ————————————————————————————————————————————
            The two lanes answer the same question in the two ways their own
            work allows. An expiring pursuit is bounded by a clock, so it says
            when it comes back. An endgame pursuit has no clock at all, and a
            ranked list of them is exactly the failure worth naming: rank 1 and
            rank 5 look alike in a numbered list, and one of them is an evening
            while the other is measured in months.

            `rankPursuits` had already decided that - it buckets every pursuit
            relative to the top score - and the four sentences explaining the
            buckets were written and never rendered. This is the slot they fit
            without fighting the board, whose bands classify STATE and already
            own the words "Do now" for a different meaning.

            Not a guarantee, and worth being exact about: a weekly endgame
            pursuit takes the `rel > 0.55 ? 'now' : 'high'` branch, so `now` IS
            reachable here. It does not fire today only because the best weekly
            scores 0.548 against the Steel Path - a margin of 0.002, which is
            luck rather than design. If a weight moves and it does fire, the row
            reads "Do now" under a heading that says "most valuable first",
            which is true in this lane's own terms; it is the board far below
            that means something else by the phrase. Worth knowing before
            anyone tunes a weight and wonders where the word came from.
          */}
          {expiry ? (
            <span style={{ color: 'var(--text)' }}>Resets {cadence(head.cadence)}.</span>
          ) : (
            <span style={{ color: 'var(--text)' }}>{TIER_DETAIL[head.tier]}</span>
          )}
        </Clamp>
      </div>
      {/*
        THE QUEUE IS IN THE REFERENCE COLUMN, NOT UNDER THE STATEMENT.

        Same split as the other hero, and for the same measured reason: the
        panel emitted 1,498 px into a 672 px viewport, and a disclosure row
        pinned under the title is a row the board pays for. It renders from
        this component under the working part, directly above the board.
      */}
    </section>
  );
}

/* ------------------------------------------------------------ board section */

/** Every band of the board. All five are capped, all five fold, all five group. */
type BoardSectionId = 'now' | 'indifferent' | 'blocked' | 'unrankable' | 'done';

/**
 * One row of the board: the quest, and the sentence saying why it sits here.
 *
 * The two are separate because they belong to different LEVELS. See the long
 * note on `project` for the defect that forced them apart - in short, a
 * sentence every row in a band shares is a property of the band, and nothing
 * that can see only one row is able to notice that.
 */
interface BoardRow {
  q: Quest;
  why: string;
}

/**
 * Rows in one domain group before the group says how many it is holding back.
 *
 * Twelve, not the sixty the whole board used to share. The old cap was a
 * DOM-weight budget spent across five bands in order, so it was the reason the
 * two bands at the bottom opened empty; a per-group cap cannot do that, because
 * a group is never asked to render rows another group already spent.
 */
const GROUP_CAP = 12;

/**
 * The one sentence a whole run of rows shares, or null when they differ.
 *
 * This is the entire mechanism behind "state a convention once". It is a test,
 * not a rule: nothing here decides that the unrankable band repeats itself, it
 * MEASURES whether it does. So a band whose rows genuinely differ keeps every
 * row's own reason, and a band that turns out to have one reason states it one
 * level up - and if a future engine change makes those reasons specific, the
 * rows get them back with no edit here.
 */
function sharedWhy(rows: readonly BoardRow[]): string | null {
  const [first] = rows;
  if (first === undefined) return null;
  return rows.every((r) => r.why === first.why) ? first.why : null;
}

/**
 * A band's rows partitioned by domain, keeping the board's own ranked order.
 *
 * A `Map` rather than a sort: insertion order is the order the rows arrived in,
 * which is the ranking, so the domain holding the best row leads and no second
 * ordering rule can drift away from the first. `RelicTree` sorts its tiers for
 * the same effect because its groups are built from a fold rather than from an
 * already-ranked list.
 */
function byDomain(rows: readonly BoardRow[]): Array<[Domain, BoardRow[]]> {
  const out = new Map<Domain, BoardRow[]>();
  for (const r of rows) {
    const list = out.get(r.q.domain);
    if (list === undefined) out.set(r.q.domain, [r]);
    else list.push(r);
  }
  return [...out.entries()];
}

/**
 * The rows themselves, capped, with what is held back stated where it happened.
 *
 * ONE NUMBER, ONE CONTROL. The old remainder line printed the shortfall AND the
 * total - "40 more match - narrow with the filters above, or Show all 70" - two
 * derivations of one population, forty pixels under a band heading that had
 * already answered "70". The count that is genuinely new here is how many are
 * NOT on screen, so that is the only one printed, and it is printed on the
 * control that fixes it rather than beside it.
 */
function RowRun({
  rows,
  shared,
  expanded,
  onExpand,
  renderRow,
}: {
  rows: readonly BoardRow[];
  /** Stated once above these rows, so no row repeats it. */
  shared: string | null;
  expanded: boolean;
  onExpand: () => void;
  renderRow: (q: Quest) => ReactNode;
}) {
  const shown = expanded ? rows : rows.slice(0, GROUP_CAP);
  return (
    <ul className="rf-staged flex flex-col gap-[3px]">
      {shown.map((r) => renderRow(shared === null ? { ...r.q, summary: r.why } : r.q))}
      {rows.length > shown.length && (
        <li className="px-1 pt-1">
          <button
            type="button"
            onClick={onExpand}
            className="mo-field mo-focusable cursor-pointer text-[length:var(--text-body)] underline decoration-dotted underline-offset-2"
            style={{ color: 'var(--color-tenno-300)' }}
          >
            Show the other {(rows.length - shown.length).toLocaleString()}
          </button>
        </li>
      )}
    </ul>
  );
}

/**
 * One band of the board, and the domains inside it.
 *
 * WHAT WAS WRONG
 * ──────────────
 * A band was a heading over a flat run of up to SIXTY sibling rows, and a
 * "Show all" that removed the cap entirely. Nothing between the heading and the
 * row said anything: sixty rows arrived at one level, ordered by a key that is
 * invisible on the row, and a reader looking for the gear work had to read past
 * forty star-chart nodes to find it. This was the last panel in the app that
 * still did that, and it is the app's front door.
 *
 * WHAT REPLACES IT
 * ────────────────
 * `domain` is the key, and it is not a new one: it is what the filter chips
 * above already partition on and what the wheel at the bottom of the panel
 * already draws sixteen arcs of. So the board now agrees with its own two
 * navigation controls instead of ignoring both, and a closed group answers -
 * how many rows it holds, and the best of them by name - which is what a reader
 * scanning for a domain wants before deciding to open anything.
 *
 * The cap is per GROUP, which is the point of grouping rather than a detail of
 * it: a reader after relic work gets the best of it without the star chart's
 * hundred rows in front, and what is held back is stated inside the group it
 * was held back from.
 *
 * ONE GROUP IS NOT A GROUPING.
 * ───────────────────────────
 * When every row of a band is in one domain, the group and the band hold the
 * same rows, and a chevron whose region contains exactly what its parent
 * contained is a level promising an answer it does not have - `WorldstatePanel`
 * refused to group one list for this reason and `IntrinsicsPanel` deleted a
 * drawer for it. So a single-domain band renders its rows directly, still
 * capped, still stating the remainder.
 *
 * THE LEADING GROUP OPENS.
 * ────────────────────────
 * `RelicTree`'s rule, and here it fixes an old failure rather than importing a
 * habit: the previous shared sixty-row budget was usually spent before it
 * reached the last two bands, so a reader who opened one of them found a
 * heading, a link, and no rows at all. Opening any band now always shows rows,
 * because its leading group is open and its cap is its own.
 *
 * THE LADDER, AND THE ONE PLACE IT IS NOT A CLEAN STAIRCASE
 * ────────────────────────────────────────────────────────
 * Group (0), row (1), what the row is (2), the evidence under that (3) - the
 * same four `RelicTree` walks, and the numbers are the `depth` prop except at
 * level 1, where `QuestRow` is not a `Disclosure` and cannot become one (its
 * summary line carries a planet `GoLink`, which is a real button, and a
 * `Disclosure` summary IS a button). So the row takes no `depth` and everything
 * it opens starts at 2.
 *
 * The band above the group is also a `Disclosure`, and it takes no depth
 * either, so band and group both compute `--disc-depth: 0` and do not step
 * apart in type size. That is deliberate rather than missed: the band is a
 * section heading in the same position `SectionTitle` occupies on the other
 * panels, and the four rungs above are the drill. What separates the two on
 * screen is the body's own indent, the domain's hue on the group's rail against
 * the band's cyan, and the count in the group's eyebrow. If the band ever needs
 * to read as a rung, it is one prop, and every level below shifts with it.
 */
function BoardSection({
  id,
  title,
  count,
  note,
  quiet = false,
  defaultOpen = false,
  rows,
  openId,
  expanded,
  onExpand,
  renderRow,
}: {
  id: BoardSectionId;
  title: string;
  count: number;
  note?: string;
  /** Lower-contrast rail and eyebrow for the bands that are not what you came for. */
  quiet?: boolean;
  /** Exactly one band on the board sets this: the one you can act on now. */
  defaultOpen?: boolean;
  rows: readonly BoardRow[];
  /**
   * The row a link or the palette asked to open.
   *
   * Its group renders uncapped and opens itself. A deep link to the sixty-third
   * blocked row used to select a row that was never built, so the jump landed
   * on nothing and read as a broken link; the cap is a weight measure, and one
   * row a reader explicitly asked for is not weight.
   */
  openId: string | null;
  /** Groups the reader asked to see whole, keyed band-then-domain. */
  expanded: ReadonlySet<string> | null;
  onExpand: (key: string) => void;
  renderRow: (q: Quest) => ReactNode;
}) {
  const groups = byDomain(rows);
  const bandShared = sharedWhy(rows);
  const [leadDomain] = groups[0] ?? [];
  const holdsOpen = (run: readonly BoardRow[]): boolean => openId !== null && run.some((r) => r.q.id === openId);

  return (
    <Disclosure
      defaultOpen={defaultOpen}
      accent={quiet ? 'var(--text-muted)' : 'var(--color-tenno-300)'}
      /*
       * NO EYEBROW: `note` used to go here, and `note` is a SENTENCE - "a
       * reason a whole domain shares is stated once, on the domain" - which
       * `.eyebrow` renders as A REASON A WHOLE DOMAIN SHARES IS STATED ONCE,
       * ON THE DOMAIN, uppercase at 0.18em tracking in the faintest ink. That
       * is a kicker's costume on a paragraph, and it is the exact mechanism
       * this repo's design-system gate names: hierarchy faked with capitals
       * because everything is set at label size. The eyebrow slot is for one
       * to three words naming a category; the band's title already is that.
       * The sentence moves into the body, set as a sentence.
       */
      summary={title}
      // The count IS the band's answer. "Blocked · 40" tells a reader what they
      // would have opened it to learn, and the heading already names the state
      // so the number needs no unit. It is stated here and nowhere else: the
      // groups below count their own rows, which is a different population.
      answer={<span className="numeric">{count.toLocaleString()}</span>}
    >
      {/* The band's caveat, at reading size, above the rows it is about. */}
      {note !== undefined && note.length > 0 && <p className="wf-note mb-1.5">{note}</p>}

      <div className="flex flex-col gap-[3px]">
        {/*
          THE CONVENTION, ONCE, WHERE `FocusPanel` PUTS IT.

          Not a refusal per row, and not a tooltip per row either - those are the
          same repetition with different paint. When the measurement above finds
          that every row in this band says one thing, the band says it, and the
          rows below are left to be the rows they are.
        */}
        {bandShared !== null && (
          <p className="px-1 pb-1 text-[length:var(--text-body)] leading-snug" style={{ color: 'var(--text-muted)' }}>
            {bandShared}
          </p>
        )}

        {groups.length < 2 ? (
          <RowRun
            rows={rows}
            shared={bandShared}
            expanded={expanded?.has(`${id}:all`) === true || holdsOpen(rows)}
            onExpand={() => {
              onExpand(`${id}:all`);
            }}
            renderRow={renderRow}
          />
        ) : (
          groups.map(([domain, group]) => {
            // Asked only when the band did not already answer it: one band-wide
            // convention repeated on each of eight domain groups is the same
            // eight copies the row-level version had, one level up.
            const groupShared = bandShared === null ? sharedWhy(group) : null;
            const [lead] = group;
            const key = `${id}:${domain}`;
            return (
              <Disclosure
                key={domain}
                /*
                 * A RUNG BELOW THE BAND, NOT BESIDE IT.
                 * ————————————————————————————————————————————
                 * This was `depth={0}`, the same value the band above it
                 * computes, so the two rendered at the identical type size and
                 * the staircase had a flat step in it. `--disc-depth` drives
                 * the summary size precisely so that descending LOOKS like
                 * descending; two rungs sharing a number is the flat nesting
                 * this whole rebuild exists to remove, reappearing one level up.
                 *
                 * The band is the state ("Blocked"), the group is the domain
                 * inside it. One contains the other, so one is smaller.
                 */
                depth={1}
                accent={DOMAIN_HUE[domain]}
                eyebrow={`${group.length.toLocaleString()} ${group.length === 1 ? 'row' : 'rows'}`}
                summary={DOMAIN_LABEL[domain]}
                defaultOpen={domain === leadDomain || holdsOpen(group)}
                /*
                 * A CLOSED GROUP STILL ANSWERS, with whichever of the two things
                 * it has: the reason, when every row in it shares one, and
                 * otherwise the best row in it by name. The rows arrive ranked,
                 * so "the first one" is not an arbitrary sample - it is this
                 * domain's answer to the question the band is asking.
                 */
                answer={
                  <span
                    className="line-clamp-1 max-w-[42ch]"
                    style={{ color: groupShared === null ? 'var(--text-muted)' : 'var(--text-faint)' }}
                  >
                    {groupShared ?? lead?.q.title}
                  </span>
                }
              >
                <RowRun
                  rows={group}
                  shared={groupShared ?? bandShared}
                  expanded={expanded?.has(key) === true || holdsOpen(group)}
                  onExpand={() => {
                    onExpand(key);
                  }}
                  renderRow={renderRow}
                />
              </Disclosure>
            );
          })
        )}
      </div>
    </Disclosure>
  );
}


export default function ProgressionPanel() {
  const inventory = useAccount((s) => s.inventory);
  const liveClears = useAccount((s) => s.liveClears);
  const loaded = useCatalog();
  const itemDb = useItemDb();

  const [goal, setGoal] = useState<GoalProfile>(() => {
    // Guarded: blocked or corrupt storage must not take the panel down.
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(GOAL_KEY);
    } catch {
      /* storage unavailable; the default goal is fine */
    }
    return GOALS.find((g) => g.id === saved) ?? GOALS[0]!;
  });
  const [activeDomains, setActiveDomains] = useState<ReadonlySet<Domain>>(() => new Set());
  const [hideDone, setHideDone] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(GOAL_KEY, goal.id);
    } catch {
      /* a goal that does not persist is a convenience lost, not data */
    }
  }, [goal]);

  // Derivation is pure, and the inventory object identity only changes when the
  // bytes changed, so this recomputes exactly as often as it must.
  const picture = useMemo(
    () => derive(inventory, loaded ? canonFrom(loaded.status, loaded.catalog) : {}, liveClears),
    [inventory, loaded, liveClears],
  );

  // Owned-vs-obtainable per category, straight from DE's export. Recomputed only
  // when the account bytes or the catalog actually change.
  const owned: OwnershipReport | null = useMemo(
    () => (itemDb ? ownership(inventory, itemDb) : null),
    [inventory, itemDb],
  );

  const ranked = useMemo(() => {
    const totals = {
      nodes: picture.nodes.total,
      quests: picture.quests.total,
      junctions: loaded?.catalog.junctions?.length ?? null,
      ownership: owned,
      ...(loaded ? questSplit(loaded.catalog, picture) : {}),
    };
    return rankPursuits(goal, makeProgressFor(inventory, picture, totals));
  }, [goal, inventory, picture, loaded, owned]);


  /*
   * The quest log.
   *
   * Everything the datasets know, promoted from "a label and a number" to a real
   * objective with steps, prerequisites, blockers and unlocks. See data/quests.ts
   * for where each field actually comes from — none of it is invented.
   */
  const frontierIds = useMemo(
    () => new Set(loaded ? frontier(loaded.catalog, picture).map((n) => n.id) : []),
    [loaded, picture],
  );

  /*
   * THE GUIDANCE ENGINE.
   *
   * `graph` is account-invariant, so it is built once per catalog and survives
   * every inventory update. `solved` re-runs on a goal or account change only -
   * never per frame, never on a filter keystroke. See data/leverage.ts.
   */
  const graph = useMemo(() => (loaded ? buildGraph(loaded.catalog) : null), [loaded]);
  /*
   * A ticking `now` is deliberately not a dependency: `observe` uses it only
   * to bucket the session window, which the engine never reads, and a
   * per-second memo would re-solve the whole graph every tick. The moment the
   * panel opened is reference enough - taken once, as a lazy initialiser,
   * because `Date.now()` inside the memo itself is an impure read and the
   * hooks lint is right to refuse it.
   */
  const runs = useRuns();
  const [openedAt] = useState(() => Date.now());
  const observed = useMemo(() => (runs === null ? NOTHING_OBSERVED : observe(runs, openedAt)), [runs, openedAt]);
  const solved = useMemo(
    () => (graph && loaded ? solve(graph, loaded.catalog, picture, goal.id as GoalId, observed) : null),
    [graph, loaded, picture, goal, observed],
  );

  /*
   * The effect line. Recomputed only when the goal or the account changes, and
   * built from the same solve the board is ranked by - so it cannot drift from
   * what is actually on screen.
   *
   * Everything vs Star Chart genuinely moves very little, because 353 of the
   * 398 vertices ARE the star chart. That is stated rather than dressed up:
   * manufacturing a difference there would be the same class of lie as a
   * fabricated number.
   */
  /*
   * THE EXPIRY LANE - "Best use of tonight".
   *
   * This goal is not a graph question. The dependency graph answers "what
   * unlocks the most"; tonight's question is "what is lost if I do not do it
   * today" - dailies, weeklies and the season. Left to the graph it produced
   * the same answer as Everything, which is precisely the "I picked a goal and
   * nothing changed" failure the other six profiles were cured of.
   *
   * Cadence is game data: a daily exists every day whether or not an account
   * has been captured, so this lane is exactly as true with the game closed.
   * What it does NOT claim is whether you have done today's yet - that stays
   * "unmeasured" on the row unless the account says otherwise.
   */
  const tonight = useMemo(() => {
    /*
     * Two goals are not graph questions, and both used to fall through to the
     * graph. "Best use of tonight" is about what EXPIRES. "Endgame" is about
     * Steel Path, Archon Shards, Netracells, Deep Archimedea and the Circuit -
     * pursuits that are all in the `endgame` domain and none of which are star
     * chart vertices, so ranking it by nodes produced a board byte-identical to
     * Star Chart under a blurb that promised something else.
     */
    const kind: 'expiry' | 'endgame' | null = goal.id === 'efficient' ? 'expiry' : goal.id === 'endgame' ? 'endgame' : null;
    if (kind === null) return null;
    // A pursuit the game has not opened for this account is not tonight's
    // best use of anything: Archon Hunts need Veilbreaker, Netracells need
    // Whispers in the Walls. The board files these as blocked.
    const open = (p: { id: string }) => pursuitGate(p.id, loaded?.catalog ?? null, picture)?.done !== false;
    const lead = ranked
      .filter((p) =>
        (kind === 'expiry'
          ? (p.cadence === 'daily' || p.cadence === 'weekly' || p.cadence === 'fortnightly' || p.cadence === 'seasonal') &&
            (p.progress === null || p.progress < 0.999)
          : p.domain === 'endgame' && (p.progress === null || p.progress < 0.999)) && open(p),
      )
      .sort((a, b) => b.score - a.score);
    const count = (c: string) => lead.filter((p) => p.cadence === c).length;
    return {
      kind,
      rows: lead,
      score: new Map(lead.map((p) => [p.id, p.score])),
      daily: count('daily'),
      weekly: count('weekly'),
      seasonal: count('seasonal'),
    };
  }, [goal, ranked, loaded, picture]);

  const goalEffect = useMemo(() => {
    if (tonight !== null && tonight.kind === 'endgame') {
      return tonight.rows.length === 0
        ? 'Nothing endgame is left.'
        : `Ranking endgame pursuits first \u2014 ${String(tonight.rows.length)} of them \u2014 with the star chart beneath as the route.`;
    }
    if (tonight !== null) {
      const parts = [
        tonight.daily > 0 ? `${String(tonight.daily)} daily` : null,
        tonight.weekly > 0 ? `${String(tonight.weekly)} weekly` : null,
        tonight.seasonal > 0 ? `${String(tonight.seasonal)} seasonal` : null,
      ].filter((x): x is string => x !== null);
      return parts.length === 0
        ? 'Nothing on the clock is left.'
        : `Ranking by what expires. ${parts.join(', ')} pursuits are on the clock; everything else waits.`;
    }
    if (solved === null || graph === null) return null;
    /*
     * What the GOAL does, not what the answer is.
     *
     * This first said "Next: Awakening - it stands in front of 26 mainline
     * quests", which is word for word what the hero above already says. Saying
     * it twice on one screen is the complaint this whole pass is about.
     *
     * What the hero cannot tell you is what the goal you just picked actually
     * counts, and how much of the game it is indifferent to - which is the
     * clearest possible evidence that the click did something.
     */
    if (solved.payers === 0) return null;
    const rest: string[] = [];
    if (solved.indifferent > 0) rest.push(`${solved.indifferent.toLocaleString()} count only as the route`);
    // Separated from `indifferent` on purpose: "no recorded payout" is not the
    // same claim as "worth nothing toward this goal".
    if (solved.unvalued > 0) rest.push(`${solved.unvalued.toLocaleString()} have no recorded value here`);
    const tail = rest.length > 0 ? ` The other ${rest.join(', and ')}.` : '';
    return `Ranking by ${solved.unit}. ${solved.payers.toLocaleString()} of ${solved.remaining.toLocaleString()} objectives on the map pay toward it.${tail}`;
  }, [solved, graph, tonight]);

  const quests = useMemo(() => {
    const totals = {
      nodes: picture.nodes.total,
      quests: picture.quests.total,
      junctions: loaded?.catalog.junctions?.length ?? null,
      ownership: owned,
      ...(loaded ? questSplit(loaded.catalog, picture) : {}),
    };
    const measure = makeProgressFor(inventory, picture, totals);
    return buildQuests({
      catalog: loaded?.catalog ?? null,
      picture,
      frontier: frontierIds,
      progressFor: measure,
    });
  }, [loaded, picture, frontierIds, inventory, owned]);

  /**
   * The board, ranked.
   *
   * Actionable work first, then blocked, then unmeasured, then finished — a
   * quest you cannot start and a quest you already did are both reference, and
   * neither should sit above something you could go and do now. Within a band,
   * the taxonomy's own weight decides.
   */
  const rankedQuests = useMemo(() => {
    /*
     * Bands come from the engine where it knows the vertex, because it resolves
     * gates the quest projection cannot see - a node whose `requirements` names
     * a quest, or a gate string we cannot evaluate at all. Rows the graph does
     * not contain (pursuits that are not nodes or quests) keep their own state.
     */
    const band = (x: Quest): number => {
      // A daily is on the clock whether or not we can read your account: that
      // is a fact about the game, so it sits with the doable work, and the row
      // keeps its "unmeasured" badge to say we do not know if it is done yet.
      if (tonight !== null && tonight.score.has(x.id)) return 0;
      const b = solved?.band.get(x.id);
      if (b != null) return b - 1;
      return x.state === 'available' ? 0 : x.state === 'blocked' ? 1 : x.state === 'unmeasured' ? 2 : 3;
    };

    /*
     * THE GOAL HAS TO REACH THE BOARD.
     *
     * It did not. `rankPursuits(goal, ...)` was computed above and its only
     * consumer was the completion wheel, which sizes each arc by how many
     * pursuits a domain CONTAINS - a count that does not move when the goal
     * moves. Meanwhile this list sorted by band, then weight, then title; the
     * weights tie inside a band, so the order fell through to alphabetical and
     * every one of the seven goal profiles produced byte-identical output.
     *
     * The picker was, in effect, decorative. Weighting the board's own score by
     * the goal's domain multiplier is the smallest change that makes it honest:
     * switching to Star Chart now visibly lifts star-chart work to the top.
     *
     * `?? 1` is the "Everything" case - that profile carries no weights at all
     * by design, and must leave the natural order untouched rather than flatten
     * it.
     */
    /*
     * The engine's score, not a constant times a constant.
     *
     * `x.weight` was one of four declared numbers (1000/700/420/220) with no
     * referent, and `goal.weights[domain]` scaled every row in a domain by the
     * same factor - so the product tied inside a band and the board fell through
     * to alphabetical. `solved.score` is dominated value per unit of cost -
     * per hour of the player's own play where the log can time the path, per
     * objective where it cannot (`solved.scoreUnit` says which) - counted off
     * the dependency graph, and it differs per row AND per goal.
     *
     * Rows the engine cannot value (a gate it cannot evaluate, a payout the
     * dataset never recorded) come back null and sort last WITHOUT being given a
     * fabricated zero - `x.weight` is the fallback only so their relative order
     * stays stable, never to claim a measurement.
     */
    const score = (x: Quest): number => {
      // Tonight's answer is perishable work; the story spine waits. Rows the
      // expiry lane knows outrank everything the graph knows, and the graph's
      // rows keep their own order beneath them.
      if (tonight !== null) {
        const t = tonight.score.get(x.id);
        if (t != null) return 1_000_000 + t;
      }
      return solved?.score.get(x.id) ?? -1;
    };

    const q = query.trim().toLowerCase();

    return [...quests]
      .filter((x) => {
        if (activeDomains.size > 0 && !activeDomains.has(x.domain)) return false;
        if (hideDone && x.state === 'done') return false;
        if (q && !x.title.toLowerCase().includes(q) && !x.summary.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => band(a) - band(b) || score(b) - score(a) || a.title.localeCompare(b.title));
  }, [quests, activeDomains, hideDone, query, solved, tonight]);

  const track = useTracked();
  const [openQuest, setOpenQuest] = useState<string | null>(null);

  /**
   * Honour a quest the palette (or another panel) asked us to open.
   *
   * Filters are cleared for the same reason the in-panel jump clears them:
   * arriving at a row the active filter then hides looks exactly like the
   * navigation having failed.
   */
  /** The row a link or the palette asked to scroll to, consumed by the effect below. */
  const pendingScrollRef = useRef<string | null>(null);

  useEffect(
    () =>
      subscribeFocus(['quest'], (req) => {
        setQuery('');
        setActiveDomains(new Set());
        // Ask for the scroll here, where the request is known; the effect
        // below performs it once the row exists.
        pendingScrollRef.current = req.id;
        setOpenQuest(req.id);
      }),
    [],
  );

  /*
   * The scroll, off the frame clock.
   *
   * This was a `requestAnimationFrame` callback, which never fires while the
   * window is not presented - the same frozen timeline that forces every
   * entrance in this app to be transform-only. The quest would be selected and
   * the viewport would not move. A passive effect runs after the commit on the
   * scheduler instead, so the row exists and the scroll is guaranteed.
   */
  /*
   * Scroll only to a row the player ASKED for - a followed link, a palette
   * jump - not on every inventory push. Keyed on `quests` as well so the row
   * exists by the time it runs, and the pending id is a ref so the effect
   * consumes it without a setState of its own.
   */
  useEffect(() => {
    if (openQuest === null || pendingScrollRef.current !== openQuest) return;
    const el = document.getElementById(`quest-${openQuest}`);
    // Keep the request until the row actually exists: clearing it on a miss
    // meant a deep link to a row beyond the cap was silently dropped.
    if (!el) return;
    pendingScrollRef.current = null;
    el.scrollIntoView({ block: 'center' });
  }, [openQuest, quests]);

  /**
   * Follow a prerequisite or unlock to the quest it names.
   *
   * Opens the target and scrolls it into view. Clearing the text filter first is
   * deliberate: the whole point of following a blocker is that the thing
   * blocking you is usually NOT what you were just searching for, and jumping to
   * a row that the active filter then hides would look like the click did
   * nothing.
   */
  const jumpTo = useCallback((id: string) => {
    setQuery('');
    setActiveDomains(new Set());
    pendingScrollRef.current = id;
    setOpenQuest(id);
  }, []);

  /*
   * THE BOARD IN BANDS, AND THE BANDS IN DOMAINS.
   *
   * One flat list of 165 rows ordered by an invisible key is the thing the
   * player called useless: nothing on it said WHY a row sat where it sat, and a
   * quest you cannot start yet sat two rows under one you could. The engine
   * already knows the difference - it bands every vertex - so the board says it
   * out loud: what you can do now, what pays nothing toward the goal you picked,
   * what is blocked and by what, what cannot be ranked, and what is done.
   *
   * Banding alone was not enough, and that is what this pass fixes. A band was
   * still a heading over up to sixty siblings, which is the same wall one
   * heading further in. `BoardSection` now partitions each band by `domain` -
   * the key the filter chips and the completion wheel already use - so the
   * ladder a reader descends is group, row, what the row is, and the evidence
   * under that.
   */
  /*
   * `showUnrankable` and `showDone` are GONE, along with the two `useState`s
   * that held them.
   *
   * They existed only so the parent could avoid building rows for a section
   * nobody had opened - which is exactly what `Disclosure` does by unmounting
   * its body, and it does it for all five bands rather than the two that
   * happened to be written that way.
   */
  /*
   * Per-GROUP "Show all", where it used to be per band.
   *
   * The cap is a DOM-weight measure, not a verdict on the rows past it, so a
   * group the player opens can be asked to show everything it holds. It is
   * keyed on the filters for the reason it always was: a narrower board is a
   * different population and starts capped again.
   *
   * There is no board-wide budget any more. The old one was a single sixty-row
   * allowance spent across the bands in order, which had to be special-cased
   * twice - once so the two bands at the bottom were not handed a budget of
   * zero, and once so a deep-linked row past the cap got built at all. A cap
   * that belongs to the group it bounds needs neither exception.
   */
  const filterKey = `${[...activeDomains].join(',')}|${String(hideDone)}|${query}`;
  const [shownAll, setShownAll] = useState<{ key: string; groups: ReadonlySet<string> }>({ key: filterKey, groups: new Set() });
  const expanded = shownAll.key === filterKey ? shownAll.groups : null;
  const expandGroup = useCallback(
    (key: string) => {
      setShownAll((cur) => ({
        key: filterKey,
        // A stale key means the filters moved under it, so the set it holds is
        // about a population that is no longer on screen and is discarded.
        groups: new Set(cur.key === filterKey ? [...cur.groups, key] : [key]),
      }));
    },
    [filterKey],
  );

  const board = useMemo(() => {
    const unit = solved?.unit ?? 'objectives';
    const bandOf = (q: Quest): 1 | 2 | 3 | 4 => {
      if (tonight !== null && tonight.score.has(q.id)) return 1;
      const b = solved?.band.get(q.id);
      if (b != null) return b;
      return q.state === 'available' ? 1 : q.state === 'blocked' ? 2 : q.state === 'unmeasured' ? 3 : 4;
    };
    /*
     * A quest whose catalog note the engine could not turn into a gate ("Rank
     * 3 with the Quills", "own an Archwing") is advisory in the graph: nothing
     * blocks it, so it lands in band 1. The account could disprove such a
     * gate, and "Available now" over it was a claim nobody had checked. Those
     * rows keep their place but read as not measured, with the note as the
     * reason.
     */
    const unchecked = (id: string): string | null =>
      graph ? (graph.vertices[graph.index.get(id) ?? -1]?.advisory ?? null) : null;

    const explain = (q: Quest, band: number): string => {
      // The engine's reason and a named blocker hold under every goal: a place
      // that cannot be ranked is not on tonight's clock either.
      if (band === 3) return solved?.reason.get(q.id) ?? q.summary;
      if (band === 2 && q.blockedBy.length > 0) return `Needs ${q.blockedBy.map((b) => b.title).join(', ')} first.`;
      // Under a lane goal the lane's rows already carry their cadence in the
      // summary, and the graph rows must not be captioned in the lane's unit -
      // "stands in front of 369 expiring pursuits" was a real sentence here.
      if (tonight !== null) return q.summary;
      if (!solved || !solved.band.has(q.id)) return q.summary;
      /*
       * NOT THE WORD "Done." - AND THAT WORD IS WHY THIS IS WORTH A COMMENT.
       * ————————————————————————————————————————————
       * It was returned for all forty rows of the Done band, under a heading
       * reading "Done", an eyebrow reading "nothing left to do here", and a
       * state badge on every row reading COMPLETE. Four statements of one fact,
       * and the row's own line - what the thing actually was - was the one
       * spent on it. Collapsing it to a single band-level convention would have
       * been the fourth copy printed once instead of forty times; a finished
       * quest should say what it WAS.
       */
      if (band === 4) return q.summary;
      const gate = band === 1 && q.state !== 'done' ? unchecked(q.id) : null;
      if (gate !== null) return `Gate not checked: ${gate}`;
      const g = solved.gate.get(q.id);
      if (band === 2) return q.summary;
      if (g == null) return `No recorded ${unit} value here.`;
      if (g <= 0) return `Pays nothing toward ${unit}; still a place you can go.`;
      // `gate` includes the row's own worth; "stands in front of" is the rest.
      const behind = g - (solved.value.get(q.id) ?? 0);
      if (behind <= 0) return `Worth ${g.toLocaleString()} ${singular(unit, g)} on its own; nothing waits behind it.`;
      return `Stands in front of ${behind.toLocaleString()} ${singular(unit, behind)}.`;
    };

    const now: BoardRow[] = [];
    const indifferent: BoardRow[] = [];
    const blocked: BoardRow[] = [];
    const unrankable: BoardRow[] = [];
    const done: BoardRow[] = [];

    /*
     * The row's badge must agree with the section it sits in. The quest
     * projection marks a junction "available" because its star-chart
     * predecessor is cleared, while the engine bands it blocked because one
     * of its tasks names a quest that is not done - and the engine is right
     * (a junction needs its quest). A row reading AVAILABLE NOW under a
     * heading reading BLOCKED is exactly the "does not logically make sense"
     * the player complained of, so the badge follows the band. One function
     * for the board and the Tracking list, so they cannot disagree.
     */
    const project = (q: Quest): { row: Quest; why: string; b: 1 | 2 | 3 | 4 } => {
      const b = bandOf(q);
      const state: Quest['state'] =
        b === 1
          ? // A daily on the clock is "unmeasured" until the account says it is
            // done; the expiry lane must not promote that to "available now".
            // Nor may a quest whose stated gate nobody checked.
            q.state === 'unmeasured' || (q.state !== 'done' && unchecked(q.id) !== null)
            ? 'unmeasured'
            : 'available'
          : b === 2
            ? 'blocked'
            : b === 4
              ? 'done'
              : // Band 3 is "the engine cannot say", so the row may not keep a
                // projection state that claims it can.
                'unmeasured';
      /*
       * THE EXPLANATION TRAVELS BESIDE THE ROW, NOT INSIDE IT.
       * ————————————————————————————————————————————
       * It used to be written straight over `summary`, which is why every row
       * of two whole bands carried one identical sentence. "Pays nothing
       * toward mastery; still a place you can go." appeared on all thirty-one
       * rows of a band whose HEADING already reads "Pays nothing toward
       * mastery", and the engine's unrankable reason appeared on all
       * eighty-nine rows of the band called "Cannot be ranked" - one fact,
       * restated once per row, in the two places the reader had least need of
       * it.
       *
       * Carried separately, the renderer can ask the only question that
       * settles it: do these rows say the SAME thing? If they do it is a
       * convention and belongs on the container once; if they differ it is
       * information and belongs on the row. Neither the projection nor the
       * engine can answer that, because neither one can see a row's
       * neighbours.
       */
      return { row: { ...q, state }, why: explain(q, b), b };
    };

    for (const q of rankedQuests) {
      const { row, why, b } = project(q);
      const entry: BoardRow = { q: row, why };
      if (b === 1) {
        const gate = solved?.gate.get(q.id);
        if (solved?.band.has(q.id) && gate != null && gate <= 0) {
          indifferent.push(entry);
          continue;
        }
        now.push(entry);
      } else if (b === 2) blocked.push(entry);
      else if (b === 3) unrankable.push(entry);
      else done.push(entry);
    }
    /*
     * EVERY quest, filtered or not, so a tracked row agrees with the board.
     *
     * The explanation goes onto the summary HERE and nowhere else. A tracked
     * row has no band and no domain group above it to carry a convention -
     * it is a handful of rows the player chose, in the order they chose - so
     * the sentence has to be on the row, which is exactly the case the board
     * no longer is.
     */
    const byId = new Map<string, Quest>();
    for (const q of quests) {
      const p = project(q);
      byId.set(q.id, { ...p.row, summary: p.why });
    }
    return { now, indifferent, blocked, unrankable, done, unit, byId };
  }, [rankedQuests, solved, tonight, quests, graph]);

  const bandedQuests = useMemo(() => [...board.byId.values()], [board]);

  /*
   * THE BANDS, IN THE ORDER A READER MEETS THEM.
   *
   * A list rather than five hand-written blocks: they differ in four words each
   * and were previously five near-identical twelve-line JSX blocks, which is how
   * "Cannot be ranked" ended up with a note promising something the rows below
   * it no longer do. Declared once, rendered once.
   *
   * A row the player was SENT to needs no special case here any more. The old
   * board spent one budget across the bands in order, so a deep link to the
   * sixty-third blocked row selected a row that was never built and the jump
   * landed on nothing; `BoardSection` now renders the GROUP holding that row
   * uncapped and open, which is both narrower and the only place that knows.
   */
  const bands: ReadonlyArray<{
    id: BoardSectionId;
    title: string;
    rows: readonly BoardRow[];
    note: string;
    quiet?: boolean;
    defaultOpen?: boolean;
  }> = [
    {
      id: 'now',
      title: 'Do now',
      rows: board.now,
      // THE ONE OPEN BAND. It is the only one that answers the question this
      // panel exists for, and four more open sections under it is the wall
      // this pass removed.
      defaultOpen: true,
      note:
        tonight === null
          ? 'ranked by what each one stands in front of'
          : tonight.kind === 'expiry'
            ? 'what expires first, then the rest'
            : 'endgame first, then the rest',
    },
    {
      id: 'indifferent',
      title: `Pays nothing toward ${board.unit}`,
      rows: board.indifferent,
      note: 'available, but not what you picked',
      quiet: true,
    },
    { id: 'blocked', title: 'Blocked', rows: board.blocked, note: 'each row names what is in the way' },
    {
      id: 'unrankable',
      title: 'Cannot be ranked',
      rows: board.unrankable,
      // NOT "each row says why" any more, because they no longer do and the
      // note would be describing the defect: the engine hands almost this whole
      // band one identical sentence, which used to be painted on all eighty-nine
      // rows. It is now stated once, on whichever level actually shares it.
      note: 'a reason a whole domain shares is stated once, on the domain',
      quiet: true,
    },
    { id: 'done', title: 'Done', rows: board.done, note: 'nothing left to do here', quiet: true },
  ];


  /*
   * The footer says what is still ARRIVING, so it exists only while something
   * is. Rendered unconditionally it was an empty flex row in a gapped column -
   * a band of nothing at the bottom of a panel that had already run out of
   * room. Nothing here is new: the same three notes, on the same conditions.
   */
  const stillArriving = !loaded || !itemDb || itemDb.missingCategories.length > 0;

  return (
    /*
     * ONE SCREEN, A PINNED ANSWER AND TWO PANES, AND THE PAGE DOES NOT MOVE.
     *
     * WHAT WAS MEASURED. Driven through a real browser at 1280x720 with no
     * account read - the cold launch, which is the state the owner actually
     * sees - this panel emitted 1,498 px into a 672 px viewport. Two and a
     * third screens, laid out as EIGHT top-level siblings in one flex column:
     * the answer, the account banner, the goal picker, the filters, the
     * tracking list, the board, the completion wheel, the footer. Nothing in
     * that stack was subordinate to anything else, so the thing the panel
     * exists to say - the name of the next thing to do - could be scrolled off
     * the top by a ring of sixteen arcs that answers a slower question.
     *
     * A flat stack also wastes the width. The panel was one narrow column with
     * the right half of the window empty, which is the other half of why it was
     * two and a third screens tall.
     *
     * So the shape is a fixed-height grid, and the subordination is structural
     * rather than a promise:
     *
     *   - the ANSWER is pinned. One statement, and the banner that says what it
     *     was computed without. It never scrolls away.
     *   - the LEFT pane is that answer's WORKING and then the BOARD - the two
     *     things the same solve produced, in the order you would read them. It
     *     is legitimately long and it scrolls INSIDE ITSELF.
     *   - the RIGHT pane is the CONTROLS and the MAP. The goal and the filters
     *     are what shape the board, so they sit beside it rather than above it,
     *     and the tracking list and the wheel scroll under them.
     *
     * `min-h-0` on every row, column and flex child of that chain is what makes
     * it true, and is the easy thing to leave out: a grid child defaults to
     * `min-height: auto` and refuses to shrink below its content, so one
     * missing `min-h-0` anywhere and the whole thing grows again and the page
     * scrolls exactly as before, with nothing on screen to say anything is
     * wrong.
     *
     * THE NARROW CASE IS THE NORMAL CASE, so the rows are explicit. Below the
     * two-column breakpoint the panes stack, and a stacked pane in an implicit
     * `auto` row is a trap: `flex-1` is `flex: 1 1 0%`, whose hypothetical main
     * size is zero, so a scrolling child of an auto-height column collapses to
     * nothing and takes its content with it. Two explicit `minmax(0,1fr)` rows
     * give both panes a definite height at every width, which is what lets each
     * of them scroll instead of the page.
     */
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,auto)_minmax(9rem,1fr)] gap-4 p-5">
      {/*
        THE ANSWER, PINNED. One statement and, when there is no account, the one
        honest sentence saying so - not eleven readouts saying it eleven times.
      */}
      <div className="flex min-w-0 flex-col gap-3">
        {tonight !== null ? (
          <Tonight lane={tonight} measured={inventory !== null} part="answer" />
        ) : (
          <NextMove
            solved={solved}
            graph={graph}
            unit={solved?.unit ?? 'objectives'}
            measured={inventory !== null}
            part="answer"
          />
        )}

        {!inventory && <AccountBanner />}
      </div>

      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:grid-rows-[minmax(0,1fr)]">
        {/*
          ------------------------------------------------ the working and the board.

          One scroller, because these are one reading: the drills explain the
          statement above, the plan is the statement's queue, and the board is
          every other row the same solve ranked. Scrolling them together is what
          keeps "why this one" attached to "and here is everything else".
        */}
        <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto pr-1">
          {tonight !== null ? (
            <Tonight lane={tonight} measured={inventory !== null} part="working" />
          ) : (
            <NextMove
              solved={solved}
              graph={graph}
              unit={solved?.unit ?? 'objectives'}
              measured={inventory !== null}
              part="working"
            />
          )}

          {/* Scroll-driven, like everything else on this panel that lives below
              the fold. The heading drifts slower than its own rows, which is what
              makes the board read as layered rather than flat - and `mo-parallax`
              takes its progress from position, so a frozen document timeline has
              no clock in it to stop. */}
          <section className="mo-arrive">
            <header className="mb-2.5 flex items-baseline gap-3">
              <h3
                className="mo-parallax font-[family-name:var(--font-title)] text-[length:var(--text-small)] tracking-[0.26em] uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                The board
              </h3>
              {/*
                `--text-muted`, not `--text-ghost`. Measured at 2.66:1 against the panel
                behind it, which is under the 3:1 floor for any text carrying information -
                and this is a COUNT, the number that says how big the list under this heading
                is. Ghost is the tone for pure decoration.
              */}
              <span className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
                {rankedQuests.length}
              </span>
              <span
                aria-hidden
                className="h-px flex-1"
                style={{ background: 'var(--rule-hairline)' }}
              />
              <span className="eyebrow">actionable first, then blocked</span>
            </header>

            {rankedQuests.length === 0 ? (
              <p className="wf-note">
                Nothing matches those filters.
              </p>
            ) : (
              <div className="flex flex-col gap-6">
                {bands
                  .filter((b) => b.rows.length > 0)
                  .map((b) => (
                    <BoardSection
                      key={b.id}
                      id={b.id}
                      title={b.title}
                      count={b.rows.length}
                      note={b.note}
                      quiet={b.quiet}
                      defaultOpen={b.defaultOpen}
                      rows={b.rows}
                      openId={openQuest}
                      expanded={expanded}
                      onExpand={expandGroup}
                      renderRow={(q) => (
                        <QuestRow
                          key={q.id}
                          quest={q}
                          tracked={track.isTracked(q.id)}
                          onToggleTrack={() => {
                            track.toggle(q.id);
                          }}
                          open={openQuest === q.id}
                          onToggleOpen={() => {
                            setOpenQuest((cur) => (cur === q.id ? null : q.id));
                          }}
                          onJump={jumpTo}
                        />
                      )}
                    />
                  ))}
              </div>
            )}
          </section>
        </div>

        {/*
          ------------------------------------------------ the controls and the map.

          The two pickers lead this pane rather than sitting above the board,
          which is where they used to push it down the page. They are both
          folded and both state on their closed row what they are currently
          doing, so at rest they are two rows beside the thing they shape.

          THEY ARE INSIDE THE SCROLLER, NOT PINNED ABOVE IT, AND THAT IS A
          MEASUREMENT RATHER THAN A PREFERENCE. Pinned, they are two flex items
          whose `min-height: auto` forbids them shrinking below their content -
          so opening the goal picker (seven chips and two sentences, about 200
          px) and the filters (a field, a toggle and a token rail) would have
          taken roughly 370 px of a 431 px pane and left the tracking list and
          the wheel sharing what was left. A control that guts the pane it
          shares when you use it reads as the panel breaking. Inside the
          scroller, opening one pushes rather than squeezes.
        */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-1">
            <GoalPicker value={goal} onChange={setGoal} effect={goalEffect} />

            <Filters
              active={activeDomains}
              onToggleDomain={(d) =>
                setActiveDomains((cur) => {
                  const next = new Set(cur);
                  if (next.has(d)) next.delete(d);
                  else next.add(d);
                  return next;
                })
              }
              onClear={() => setActiveDomains(new Set())}
              hideDone={hideDone}
              onHideDone={setHideDone}
              query={query}
              onQuery={setQuery}
              showing={rankedQuests.length}
              total={quests.length}
            />

            <TrackedQuests
              quests={bandedQuests}
              order={track.tracked}
              onToggleTrack={track.toggle}
              onMove={track.move}
              onClear={track.clear}
              openId={openQuest}
              onToggleOpen={(id) => setOpenQuest((cur) => (cur === id ? null : id))}
              onJump={jumpTo}
            />

            {/*
              THE MAP, LAST, AND NOW BESIDE THE BOARD RATHER THAN A SCREEN BELOW IT.
              Sixteen arcs of domain coverage answer "how much of the game is there",
              which is a different and slower question than "what do I do now". It led
              the panel once and it answered nothing before an account existed - every
              arc hatched and unmeasured above a heading reading "The whole game". It
              is genuinely useful once you are oriented, and it is also the way domain
              filters go ON, which is why it belongs in the same pane as the filter it
              sets rather than at the bottom of a page nobody reached.
            */}
            {/*
              The map arrives on SCROLL, not on a clock - and the scroller is now
              this pane rather than the page, which is the only thing that changed
              about it. `view()` resolves against the nearest scroll container, and
              the animation is transform-only either way: a map that is never
              scrolled to sits twenty pixels low and completely legible.
            */}
            <section className="mo-arrive">
              <CompletionWheel
                pursuits={ranked}
                active={activeDomains}
                onPick={(d) =>
                  setActiveDomains((cur) => {
                    const next = new Set(cur);
                    if (next.has(d)) next.delete(d);
                    else next.add(d);
                    return next;
                  })
                }
              />
            </section>
          </div>

          {stillArriving && (
            <footer className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {!loaded && <span className="eyebrow">star chart still indexing</span>}
              {!itemDb && <span className="eyebrow">item catalog still loading</span>}
              {itemDb && itemDb.missingCategories.length > 0 && (
                <span className="eyebrow" style={{ color: 'var(--color-signal-warn)' }}>
                  {itemDb.missingCategories.join(', ')} unavailable — those totals are unknown, not zero
                </span>
              )}
            </footer>
          )}
        </div>
      </div>
    </div>
  );
}
