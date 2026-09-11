import { useCallback, useEffect, useMemo, useState } from 'react';
import { DOMAIN_LABEL } from '../../data/pursuits';
import { stepProgress, type Quest, type QuestLink, type QuestState } from '../../data/quests';
import { GoLink } from '../../ui/interact';
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { getPanel } from '../registry';
import { CHAMFER } from '../../ui/geometry';

/**
 * THE QUEST LOG.
 *
 * WHAT THIS REPLACES
 * ──────────────────
 * A ranked list of bars. It told you what to do next and nothing else: you could
 * not keep a shortlist, could not see what a thing actually involved, could not
 * find out why something was unavailable, and could not tell what finishing it
 * would open up. It was a report about the account rather than something to work
 * from.
 *
 * THE MODEL IS A QUEST LOG, NOT A LEADERBOARD
 * ───────────────────────────────────────────
 * Two halves, and the split is the whole idea:
 *
 *   TRACKED   what YOU decided you are working on, in the order you put it in.
 *             Persisted, so it survives closing the app. This is the
 *             customisable part — the app ranks, the player decides.
 *
 *   THE BOARD everything else, ranked, filtered and searchable, so the tracked
 *             list has somewhere to be filled from.
 *
 * Every quest expands to everything the datasets actually know about it: its
 * itemised steps, its prerequisites, which of those are the thing currently
 * blocking it, what it unlocks, where it happens, what it pays.
 *
 * HONESTY, CARRIED INTO THE INTERACTION
 * ─────────────────────────────────────
 * A step whose completion the game does not expose renders as an OPEN CIRCLE,
 * not an unticked box. An unticked box says "you have not done this"; the circle
 * says "this is a step, and we cannot see it". The difference matters most
 * exactly here, on the screen telling someone what work they have left.
 */


/*
 * Versioned. The stored value is an ordered array of quest ids; if that shape
 * ever changes, the old key is simply never read again rather than being parsed
 * as the new shape and silently mis-restoring someone's tracked list.
 */
const TRACK_KEY = 'raijiframe.tracked.v1';

/** Whole percent that never rounds a started thing to 0% or an unfinished one to 100%. */
function pct(ratio: number): string {
  const n = Math.round(ratio * 100);
  if (ratio > 0 && n === 0) return '<1%';
  if (ratio < 1 && n === 100) return '99%';
  return `${String(n)}%`;
}

const STATE_SPEC: Record<QuestState, { label: string; color: string }> = {
  done: { label: 'Complete', color: 'var(--color-signal-good)' },
  available: { label: 'Available now', color: 'var(--color-tenno-300)' },
  blocked: { label: 'Blocked', color: 'var(--color-signal-warn)' },
  // `--text-muted`, not ghost: this carries information, so it has to clear
  // the 3:1 floor. Ghost is for decoration.
  unmeasured: { label: 'Not measured', color: 'var(--text-muted)' },
};

const KIND_LABEL: Record<Quest['kind'], string> = {
  quest: 'Quest',
  junction: 'Junction',
  node: 'Mission',
  pursuit: 'Pursuit',
};

/* ------------------------------------------------------------------ tracking */

/**
 * The tracked list, persisted.
 *
 * An ordered array of ids rather than a set: the ORDER is the customisation.
 * Ids that no longer resolve are dropped on read rather than on write, so a
 * dataset update cannot corrupt what the player had saved.
 */
export function useTracked(): {
  tracked: string[];
  isTracked: (id: string) => boolean;
  toggle: (id: string) => void;
  move: (id: string, delta: number) => void;
  clear: () => void;
} {
  const [tracked, setTracked] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(TRACK_KEY);
      const parsed: unknown = raw === null ? null : JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      // Corrupt storage must not take the panel down; an empty log is recoverable.
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(TRACK_KEY, JSON.stringify(tracked));
    } catch {
      /* storage full or blocked; tracking is a convenience, not data */
    }
  }, [tracked]);

  const toggle = useCallback((id: string) => {
    setTracked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }, []);

  const move = useCallback((id: string, delta: number) => {
    setTracked((cur) => {
      const i = cur.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      const [item] = next.splice(i, 1);
      next.splice(j, 0, item!);
      return next;
    });
  }, []);

  const clear = useCallback(() => setTracked([]), []);
  const isTracked = useCallback((id: string) => tracked.includes(id), [tracked]);

  return { tracked, isTracked, toggle, move, clear };
}

/* --------------------------------------------------------------------- icons */

function PinIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round">
      <path d="M7 1.5 8.6 5l3.9.4-2.9 2.6.8 3.8L7 10l-3.4 1.8.8-3.8L1.5 5.4 5.4 5Z" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className="size-2.5 transition-transform duration-200"
      style={{ transform: open ? 'rotate(90deg)' : 'none' }}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 2 8.5 6l-4 4" />
    </svg>
  );
}

/** A step's status mark. Three states, three shapes — never a bare checkbox. */
function StepMark({ done }: { done: boolean | null }) {
  if (done === true) {
    return (
      <svg viewBox="0 0 14 14" className="size-3.5 shrink-0" aria-hidden style={{ color: 'var(--color-signal-good)' }}>
        <path d="M2.5 7.4 5.6 10.4 11.5 3.9" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (done === false) {
    return (
      <svg viewBox="0 0 14 14" className="size-3.5 shrink-0" aria-hidden style={{ color: 'var(--text-faint)' }}>
        <rect x={2.5} y={2.5} width={9} height={9} fill="none" stroke="currentColor" strokeWidth={1.4} />
      </svg>
    );
  }
  // Unknown. An open circle, deliberately NOT an unticked box: a box asserts the
  // step is outstanding, and we do not know that.
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 shrink-0" aria-hidden style={{ color: 'var(--text-ghost)' }}>
      <circle cx={7} cy={7} r={4} fill="none" stroke="currentColor" strokeWidth={1.3} strokeDasharray="2 2" />
    </svg>
  );
}

/* ----------------------------------------------------------------- quest row */

export function QuestRow({
  quest,
  tracked,
  onToggleTrack,
  onMove,
  open,
  onToggleOpen,
  onJump,
  rank,
  count,
}: {
  quest: Quest;
  tracked: boolean;
  onToggleTrack: () => void;
  onMove?: (delta: number) => void;
  open: boolean;
  onToggleOpen: () => void;
  /** Follow a prerequisite or unlock to that quest. */
  onJump?: (id: string) => void;
  /** Position in the tracked list, when tracked. */
  rank?: number;
  count?: number;
}) {
  const spec = STATE_SPEC[quest.state];
  const steps = stepProgress(quest);

  return (
    <li
      id={`quest-${quest.id}`}
      /*
       * `mo-field` on the ROW, and nothing else on it.
       *
       * One class puts the document-level pointer tracker's `--mdx/--mdy` on
       * this element, and they inherit - so the pin and the chevron below can
       * lean toward the cursor with no handler, no layout read and no state,
       * on a board that renders sixty of these.
       *
       * Deliberately NOT `.rf-row`: that class draws its own 2px leading edge
       * on hover, directly over the state bar this row already has, and the
       * state bar's colour IS the row's status - blocked, available, done.
       * Painting a gold hover edge over it would make the four states look
       * alike at exactly the moment someone is pointing at one.
       */
      className="mo-field relative scroll-mt-4"
      style={{ clipPath: CHAMFER, background: open ? 'oklch(1 0 0 / 0.055)' : 'var(--plate-lift)' }}
    >
      <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: spec.color }} />

      <div className="flex items-center gap-3 py-2.5 pr-3 pl-4">
        {/* Track. The primary customisation, so it is the leftmost control. */}
        <button
          type="button"
          onClick={onToggleTrack}
          aria-pressed={tracked}
          title={tracked ? 'Stop tracking' : 'Track this'}
          // No `transition-colors`: this colour IS the tracked state, and a
          // stranded transition leaves the pin gold on a quest you just untracked.
          //
          // `mo-magnet` transitions TRANSFORM, which is a different property
          // and carries no state: stranded, it leaves the pin three pixels
          // off, which is not a lie about whether the quest is tracked.
          /* The pin is a 14px glyph and the button box was exactly the glyph,
             so the hit target measured 14x14 against a 24px floor - on a
             control a player taps repeatedly down a sixty-row board. The icon
             is untouched; the target is padded out around it. */
          /* 26, not 24. These rows sit inside the shell's perspective container
             (main.rf-stage), slightly behind the projection plane, so a declared
             24px renders at 23.64 - under the floor it was set to meet. The
             floor has to hold in PIXELS, not in the stylesheet. */
          className="mo-magnet mo-focusable flex min-h-[26px] min-w-[26px] shrink-0 items-center justify-center"
          style={{ color: tracked ? 'var(--color-orokin-400)' : 'var(--text-ghost)' }}
        >
          <PinIcon on={tracked} />
        </button>

        {/*
          A plain DIV, not a button role, even though it still toggles on
          click.

          It used to be `role="button" tabIndex={0}` - a control - wrapping
          the whole content area, and the title line contains the planet chip
          (`PlanetName`, a `GoLink`), which renders a real `<button>`. That put
          a focusable control INSIDE a control: ambiguous for a keyboard user
          (does Tab land on the row, the planet, both?) and for a screen
          reader (which one does the "button" role's name belong to?). It only
          looked safe because it avoided the OTHER illegal nesting - a real
          `<button>` cannot literally contain another `<button>`, and React
          refuses that outright - but `role="button"` on a div sidesteps the
          markup restriction without curing the ambiguity it exists to signal.

          The fix makes the two siblings, not nested: this div carries no
          role or tabIndex any more, so it is not a control at all, just a
          mouse convenience (the same as the DataTable rows this used to
          imitate for their non-`aria-expanded` case). The one real,
          keyboard-operable toggle is the chevron button below - it names the
          quest in its own label since a list of many identical "Expand"
          buttons is no more useful to a screen reader than a list of many
          identical rows - and it stops propagation so clicking it does not
          also fire this div's onClick and toggle the row twice back to
          closed. `GoLink` already stops propagation the same way, for the
          same reason.
        */}
        {/*
          AND IT CARRIES NO CLICK EITHER.

          Leaving the onClick on made it a static element with an interaction:
          a mouse could operate something a keyboard could not see, and every
          audit that looks for that pattern was right to flag it - the pattern
          is how rows end up mouse-only in the first place. The chevron button
          beside it is the row's one control, it is keyboard-operable, and it
          names the quest, so nothing is lost but the ambiguity.
        */}
        <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <span
                className="font-[family-name:var(--font-display)] text-[length:var(--text-small)] font-semibold"
                style={{ color: quest.state === 'done' ? 'var(--text-faint)' : 'var(--text)' }}
              >
                {quest.title}
              </span>
              <span className="eyebrow">{KIND_LABEL[quest.kind]}</span>
              {quest.planet !== null && <PlanetName name={quest.planet} className="eyebrow" />}
            </span>
            <span className="mt-0.5 block truncate text-[length:var(--text-micro)]" style={{ color: 'var(--text-faint)' }}>
              {quest.summary}
            </span>
          </span>

          <span className="flex w-[140px] shrink-0 flex-col items-end gap-1">
            {/* At the type scale's micro step, not below it: at 9.9px this tag
                was the only thing separating an unmeasured row from an
                available one, and it was unreadable against the backdrop. */}
            <span className="text-[length:var(--text-micro)] tracking-[0.12em] uppercase" style={{ color: spec.color }}>
              {spec.label}
            </span>
            {/* Steps beat a percentage when we have them: "2 of 4 confirmed" is
                a truer statement than a bar filled to half. */}
            {/*
             * Three genuinely different readouts, and never a percentage on a
             * binary thing.
             *
             * A mission node showing "0%" was both wrong and noisy: it is
             * cleared or it is not, the state label already says which, and the
             * number added nothing but a column of zeroes down the page.
             */}
            {quest.steps.length > 0 ? (
              <span className="numeric text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
                {/* Only what is KNOWN is counted as done-or-not. "0 of 4 done"
                    asserted three tasks the game never reports on. */}
                {steps.known === 0
                  ? `${quest.steps.length} ${quest.kind === 'junction' ? 'tasks' : 'steps'}`
                  : steps.known < quest.steps.length
                    ? `${steps.done} of ${steps.known} known done \u00b7 ${quest.steps.length - steps.known} not reported`
                    : `${steps.done} of ${quest.steps.length} ${quest.kind === 'junction' ? 'tasks' : 'steps'} done`}
              </span>
            ) : !quest.binary && quest.progress !== null ? (
              <span className="numeric text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
                {pct(quest.progress)}
              </span>
            ) : null}
          </span>

          {/* The row's one real keyboard-operable control - see the comment
              above the wrapping div. `stopPropagation` matches `GoLink`:
              without it, this click would also reach the div's own onClick
              and toggle the row open then immediately closed again. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleOpen();
            }}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${quest.title}`}
            // `mo-icon` nudges it toward what it opens; `mo-focusable` blooms
            // the focus ring, which matters more here than anywhere else on
            // the board - this is the ONE control on the row a keyboard can
            // reach, and sixty identical chevrons give it nothing to be found
            // by otherwise.
            /* Same as the pin above: a 10px chevron in a 10px box. Padded to
               the 24px floor without growing the glyph. */
            className="mo-icon mo-focusable flex min-h-[26px] min-w-[26px] shrink-0 items-center justify-center"
            style={{ color: 'var(--text-ghost)' }}
          >
            <Chevron open={open} />
          </button>
        </div>

        {/*
          Reordering, only where order means something.

          TWO THINGS AN AUDIT OF THE RENDERED PAGE FOUND HERE.
          ————————————————————————————————————————————
          The glyph is 8px and the padding was 4px, so the actual hit target
          measured about 14x14 - a third of the 24px floor, on the one control
          whose whole job is being clicked repeatedly. The icon is unchanged;
          the TARGET is padded out around it, which is the fix that does not
          make a delicate row look clumsy.

          And each arrow disables itself at the end of the list with no reason
          given: a greyed arrow that says nothing is indistinguishable from a
          broken one. `title` now says which end you are at, so the disabled
          state is an answer rather than an absence.
        */}
        {tracked && onMove !== undefined && (
          <span className="flex shrink-0 flex-col">
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={rank === 0}
              aria-label="Move up"
              title={rank === 0 ? 'Already first' : 'Move up'}
              className="mo-magnet mo-focusable flex min-h-6 min-w-6 items-center justify-center disabled:opacity-25"
              style={{ color: 'var(--text-ghost)' }}
            >
              <svg viewBox="0 0 10 6" className="size-2" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
                <path d="M1 5 5 1l4 4" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={count !== undefined && rank === count - 1}
              aria-label="Move down"
              title={count !== undefined && rank === count - 1 ? 'Already last' : 'Move down'}
              className="mo-magnet mo-focusable flex min-h-6 min-w-6 items-center justify-center disabled:opacity-25"
              style={{ color: 'var(--text-ghost)' }}
            >
              <svg viewBox="0 0 10 6" className="size-2" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
                <path d="M1 1 5 5l4-4" />
              </svg>
            </button>
          </span>
        )}
      </div>

      {open && <QuestDetail quest={quest} onJump={onJump} />}
    </li>
  );
}

/* -------------------------------------------------------------------- detail */

/** Ask the shell to switch panels. See the listener in Shell.tsx. */
function goToPanel(id: string): void {
  window.dispatchEvent(new CustomEvent('raijiframe:panel', { detail: id }));
}

/**
 * Fact labels whose value is a planet the star chart can open.
 *
 * Kept as a set rather than a per-fact flag because `facts` is a plain
 * label/value list built in three places in data/quests.ts, and threading a
 * kind through all of them to serve two labels is more machinery than the
 * problem deserves.
 */
const PLACE_FACTS: ReadonlySet<string> = new Set(['Begins on', 'Opens']);

/**
 * Names that occupy a `planet` field but are not worlds the chart can open: a
 * quest that begins in your Orbiter, on a relay, aboard the Railjack, or in
 * several places at once. The star chart opens a world by exact name, so
 * linking one of these lands on an empty globe — worse than the plain text it
 * replaced. `Zariman Ten Zero` and `Hollvania` are the quest file's spellings
 * of worlds the node data calls `Zariman` and `Höllvania`; they stay text
 * rather than have this file guess at a translation. If a dataset update names
 * another non-place, it belongs here.
 */
const OFF_CHART: ReadonlySet<string> = new Set([
  'Orbiter',
  'Relay',
  'Various',
  'Railjack',
  'Zariman Ten Zero',
  'Hollvania',
]);

/**
 * A planet name, as somewhere you can go.
 *
 * Every row on this board names a place the star chart already draws, and all
 * of them were dead text sitting next to a working planet navigator. One
 * component for both sites — the row's header chip and the `Begins on` / `Opens`
 * facts — so the off-chart check cannot be applied to one and forgotten on the
 * other.
 *
 * The chip sits inside the row's own expand toggle, which is what `GoLink`'s
 * `stopPropagation` is for: pressing the planet goes to the planet instead of
 * also opening the row. See ui/interact.tsx.
 */
function PlanetName({ name, className }: { name: string; className?: string }) {
  if (OFF_CHART.has(name)) return <span className={className}>{name}</span>;
  return (
    <GoLink kind="planet" id={name} className={className} title={`Show ${name} on the star chart`}>
      {name}
    </GoLink>
  );
}

/**
 * A reference to another quest, as a real control.
 *
 * These were plain text - "blocked by X", "opens Y" - which is exactly the
 * "looks like it should be clickable and is not" complaint. Following a blocker
 * to the thing blocking you is the single most obvious action on this screen.
 */
function QuestLinkButton({ link, onJump }: { link: QuestLink; onJump?: (id: string) => void }) {
  if (onJump === undefined) {
    return <span style={{ color: 'var(--text-muted)' }}>{link.title}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onJump(link.id)}
      // The dotted rule stays: it is the RESTING affordance, and this control
      // being invisible until hovered was the original complaint. `mo-field`
      // and `mo-focusable` add the response on top of it rather than instead
      // of it.
      className="mo-field mo-focusable underline decoration-dotted underline-offset-2 transition-colors hover:text-[color:var(--color-tenno-200)]"
      style={{ color: 'var(--text-muted)' }}
      title={`Go to ${link.title}`}
    >
      {link.title}
    </button>
  );
}

/** Links in one run before the run says how many more it is holding back. */
const LINK_CAP = 12;

/**
 * A run of quest links, capped, with the remainder stated where it happened.
 *
 * The cap used to be twenty-four and it lived at the one call site that needed
 * it, so "and N more" was written once and the number twenty-four was written
 * twice - the slice and the test - which is the shape a cap drifts out of. One
 * constant, one derivation of the remainder, one place to change it.
 */
function LinkRun({ links, onJump }: { links: readonly QuestLink[]; onJump?: (id: string) => void }) {
  const shown = links.slice(0, LINK_CAP);
  return (
    <p className="flex flex-wrap gap-x-2 gap-y-1 text-[length:var(--text-micro)] leading-relaxed">
      {shown.map((u) => (
        <QuestLinkButton key={u.id} link={u} onJump={onJump} />
      ))}
      {links.length > shown.length && (
        <span style={{ color: 'var(--text-faint)' }}>and {links.length - shown.length} more</span>
      )}
    </p>
  );
}

/**
 * WHAT FINISHING A QUEST OPENS, SPLIT BY WHETHER IT IS STILL AHEAD OF YOU.
 *
 * WHAT WAS WRONG
 * ──────────────
 * `quest.unlocks.slice(0, 24)` - twenty-four one-fact link buttons wrapped into
 * a single paragraph, in alphabetical order, with nothing separating the three
 * things a reader is actually asking about. On a mainline quest most of that
 * list is content the account has already seen, and it sat interleaved with the
 * content that has not, so the one question the section exists to answer -
 * "what does finishing this get me that I do not already have" - had to be
 * answered by reading twenty-four names and remembering which ones you own.
 *
 * `done` is the key, and it is the key the data already carries: `blockedBy` is
 * built out of exactly this field one file over (`requires.filter(r => r.done
 * === false)`), so splitting on it invents nothing and cannot disagree with the
 * blocker list above.
 *
 * ONE BUCKET IS NOT A GROUPING, AND THIS IS WHERE THAT MATTERS MOST.
 * ─────────────────────────────────────────────────────────────────
 * With no account read, `questDone` returns null for every quest in the game -
 * deliberately, so an unread account cannot be reported as an unfinished one -
 * so every link lands in the same bucket. Wrapping that in a drawer labelled
 * "not measured" would be a chevron over a region whose only content is the
 * refusal the banner at the top of the panel has already made, which is exactly
 * the drawer `IntrinsicsPanel` deleted. So a split that does not actually split
 * renders as the plain run it was.
 */
const UNLOCK_BUCKETS: ReadonlyArray<{ done: boolean | null; label: string }> = [
  { done: false, label: 'Still ahead of you' },
  { done: true, label: 'Already done' },
  // Only reachable on a read account that holds a link to something with no
  // canonical id - never the whole list, because the whole list being null is
  // the one-bucket case above.
  { done: null, label: 'Cannot be told either way' },
];

function Unlocks({ links, onJump }: { links: readonly QuestLink[]; onJump?: (id: string) => void }) {
  if (links.length === 0) return null;
  const buckets = UNLOCK_BUCKETS.map((b) => ({
    ...b,
    links: links.filter((u) => u.done === b.done),
  })).filter((b) => b.links.length > 0);

  if (buckets.length < 2) return <LinkRun links={links} onJump={onJump} />;

  return (
    <>
      {buckets.map((b) => (
        <Disclosure
          key={b.label}
          depth={3}
          summary={b.label}
          // The count, and only here: the section above answers with the whole
          // list's size and these are its parts, so neither number is the other
          // one restated.
          answer={<span className="numeric">{b.links.length}</span>}
        >
          <LinkRun links={b.links} onJump={onJump} />
        </Disclosure>
      ))}
    </>
  );
}

/**
 * WHAT A QUEST ACTUALLY IS, NESTED INSTEAD OF STACKED.
 *
 * WHAT WAS WRONG
 * ──────────────
 * Opening a row dropped six unrelated blocks into one column, all expanded, in
 * a fixed order: the blockers, every step, a wrapped grid of facts, up to
 * twenty-four things it opens, its prerequisites, and any warning notes. On a
 * mainline quest that is well over a screen of text, and the block a reader
 * opened the row FOR was somewhere in it. Worse, it was the same wall whether
 * the quest was blocked (where the blockers are the answer) or available (where
 * the steps are), because nothing about the layout knew which question was
 * being asked.
 *
 * NOW IT IS A HIERARCHY, AND IT KNOWS WHICH QUESTION
 * ─────────────────────────────────────────────────
 * Verdict, then working, then provenance. Exactly ONE section opens by default
 * and WHICH one depends on the quest: a blocked quest opens its blockers,
 * because "what is stopping me" is the only reason to open a blocked row; an
 * unblocked one opens its steps. Everything else states its answer on a closed
 * row - the first blocker by name, how many steps the game does not report,
 * what it pays, how many things it opens - so a reader who opens nothing has
 * still been told each section's conclusion.
 *
 * "Needed first" is nested INSIDE "What it opens", because both are the quest's
 * position in the dependency graph and reading them together is the only way
 * either means anything.
 *
 * WHERE THE DEPTH NUMBERS COME FROM, SINCE THEY ARE NOT ARBITRARY
 * ──────────────────────────────────────────────────────────────
 * The board above this file now nests: a domain group (0) holds the rows, and a
 * row is level 1. `QuestRow` is not a `Disclosure` and cannot become one - its
 * summary line contains a planet `GoLink`, which is a real `<button>`, and
 * `Disclosure` renders its summary inside a button, so the row would be a
 * control inside a control (see the long comment on the row's own toggle). So
 * the row occupies level 1 with no `depth` prop, and everything it opens starts
 * at 2. That is what makes `--disc-depth` step the type size down as a reader
 * descends instead of rendering four levels at one size, which is the defect
 * `motion.css` names in its own comment on the property.
 *
 * NOTHING IS DELETED. Every fact that was in the old wall is still here.
 */
function QuestDetail({ quest, onJump }: { quest: Quest; onJump?: (id: string) => void }) {
  const steps = stepProgress(quest);
  const blocked = quest.blockedBy.length > 0;
  const [firstBlocker] = quest.blockedBy;
  /* The place a fact names, for the "Where and what it pays" closed row. */
  const place = quest.facts.find((f) => PLACE_FACTS.has(f.label));

  return (
    <div className="anim-rise flex flex-col gap-1.5 border-t px-4 py-3.5" style={{ borderColor: 'var(--hairline)' }}>
      {/*
        THE SUMMARY, IN FULL, BECAUSE IT EXISTED ONLY AS A FRAGMENT.
        ───────────────────────────────────────────────────────────
        `quest.summary` was rendered in exactly one place - the closed row's
        second line, `truncate` at `--text-micro` - so a sentence like "Every
        weapon, frame and companion you have never levelled..." stopped at the
        column edge and the rest was unreachable by any interaction. A runtime
        sweep found thirty-five such sentences on this tab alone; a source rule
        could not, because the size is inherited and the clipping is a class.
        The row keeps its one-line teaser, which is what makes a hundred rows
        scannable. Opening it - the thing a reader does when a line is cut off
        mid-word - now yields the whole sentence at reading size.
      */}
      {quest.summary.length > 0 && <p className="wf-prose">{quest.summary}</p>}

      {/* What is actually stopping you. First, and open, because it is the
          answer to the question anyone opens a blocked quest to ask. */}
      {blocked && (
        <Disclosure
          depth={2}
          defaultOpen
          accent="var(--color-signal-warn)"
          eyebrow={`Blocked by ${String(quest.blockedBy.length)}`}
          summary="What is stopping you"
          // The blocker BY NAME, not its count: a reader who never opens this
          // has still been told the one thing they came for. The count is in
          // the eyebrow, where it belongs.
          answer={
            <span style={{ color: 'var(--color-signal-warn)' }}>
              {firstBlocker?.title}
              {quest.blockedBy.length > 1 && ` +${quest.blockedBy.length - 1}`}
            </span>
          }
        >
          <ul className="flex flex-col gap-1">
            {quest.blockedBy.map((b) => (
              <li key={b.id} className="flex items-center gap-2 text-[length:var(--text-small)]">
                <StepMark done={false} />
                <QuestLinkButton link={b} onJump={onJump} />
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      {quest.steps.length > 0 && (
        <Disclosure
          depth={2}
          // Open only when nothing is in the way. A blocked quest's steps are
          // reference; its blockers are the answer, and two sections open by
          // default is the wall coming back one press further in.
          defaultOpen={!blocked}
          summary={quest.kind === 'junction' ? 'What it asks of you' : 'Steps'}
          // NOT the "2 of 4 done" readout - that is already on the collapsed
          // row sixty pixels above this. What the row cannot say is how much of
          // it the game reports at all, which is this panel's honesty in one
          // line.
          answer={
            steps.known < quest.steps.length ? (
              <span style={{ color: 'var(--text-muted)' }}>
                {quest.steps.length - steps.known} not reported
              </span>
            ) : (
              <span>all {quest.steps.length} reported</span>
            )
          }
        >
          <ul className="flex flex-col gap-1.5">
            {quest.steps.map((s, i) => (
              <li key={`${s.text}-${i}`} className="flex items-start gap-2.5">
                <span className="mt-0.5">
                  <StepMark done={s.done} />
                </span>
                <span
                  className="text-[length:var(--text-small)] leading-snug"
                  style={{ color: s.done === true ? 'var(--text-faint)' : 'var(--text)' }}
                >
                  {s.text}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      {/*
        * The guard covers Level and Pays too, which are rendered inside it. It
        * used to test `facts.length` alone, so emptying `facts` would silently
        * have deleted the level band and the mastery payout as well.
        */}
      {(quest.facts.length > 0 || quest.levels !== null || quest.mastery !== null) && (
        <Disclosure
          depth={2}
          summary="Where it is, and what it pays"
          // The payout leads when there is one - it is the only figure here a
          // completionist is actually hunting - and the place leads otherwise.
          answer={
            quest.mastery !== null ? (
              <span style={{ color: 'var(--color-orokin-300)' }}>{quest.mastery.toLocaleString()} mastery</span>
            ) : place !== undefined ? (
              <span>{place.value}</span>
            ) : quest.levels !== null ? (
              <span>
                level {quest.levels[0]}–{quest.levels[1]}
              </span>
            ) : undefined
          }
        >
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {quest.facts.map((f) => (
              <div key={f.label}>
                <div className="eyebrow">{f.label}</div>
                <div className="mt-0.5 text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
                  {/*
                   * A fact whose value IS a place becomes a way to go there.
                   * Every planet name in this panel was dead text sitting beside
                   * a working planet navigator - the star chart opens a world by
                   * name, and nothing here ever asked it to.
                   */}
                  {PLACE_FACTS.has(f.label) ? <PlanetName name={f.value} /> : f.value}
                </div>
              </div>
            ))}
            {quest.levels !== null && (
              <div>
                <div className="eyebrow">Level</div>
                <div className="numeric mt-0.5 text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
                  {quest.levels[0]} - {quest.levels[1]}
                </div>
              </div>
            )}
            {quest.mastery !== null && (
              <div>
                <div className="eyebrow">Pays</div>
                <div className="numeric mt-0.5 text-[length:var(--text-small)]" style={{ color: 'var(--color-orokin-300)' }}>
                  {quest.mastery.toLocaleString()} mastery
                </div>
              </div>
            )}
          </div>
        </Disclosure>
      )}

      {(quest.unlocks.length > 0 || (quest.requires.length > 0 && !blocked)) && (
        <Disclosure
          depth={2}
          accent="var(--color-tenno-300)"
          eyebrow="Its place in the graph"
          summary="What finishing it opens"
          answer={
            quest.unlocks.length > 0 ? (
              // "1 things" was on screen. A count and its noun are one fact and
              // have to be written as one.
              <span style={{ color: 'var(--color-tenno-300)' }}>
                {quest.unlocks.length} {quest.unlocks.length === 1 ? 'thing' : 'things'}
              </span>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>nothing recorded</span>
            )
          }
        >
          <Unlocks links={quest.unlocks} onJump={onJump} />

          {/*
            One level deeper, and only when nothing is actually blocking: with a
            blocker the section above already names it, and "Needed first" would
            be the same list under a different heading. Depth 3 puts it on the
            indent rail one step in from the section that holds it, so it reads
            as part of the graph question rather than as a seventh block in a
            stack - and it sits beside the unlock buckets above, which is right:
            both are the same list of links seen from the two ends.
          */}
          {quest.requires.length > 0 && !blocked && (
            <Disclosure
              depth={3}
              summary="Needed first"
              answer={<span>{quest.requires.length} done already</span>}
            >
              <LinkRun links={quest.requires} onJump={onJump} />
            </Disclosure>
          )}
        </Disclosure>
      )}

      {/* A note is a caveat about the dataset, not a sentence to read every
          time the row opens. Clamped to one line, with the rest a press away -
          `-webkit-line-clamp` is layout, so a frozen timeline cannot hide it. */}
      {quest.notes.map((n) => (
        <div key={n} className="text-[length:var(--text-micro)] leading-relaxed" style={{ color: 'var(--color-signal-warn)' }}>
          <Clamp lines={1}>{n}</Clamp>
        </div>
      ))}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="eyebrow">{DOMAIN_LABEL[quest.domain]}</span>
        {/*
          * `quest.panel` is a ROUTE ID, not a name. Printed raw and uppercased
          * by `.eyebrow` it read "OPEN THE STARCHART PANEL" - and for a quest
          * already listed on the progression panel it offered to open the panel
          * you were reading. The registry already holds the display title, so
          * there is no second label map to keep in sync.
          */}
        {quest.panel !== null && quest.panel !== 'progression' && getPanel(quest.panel) !== undefined && (
          <button
            type="button"
            onClick={() => {
              goToPanel(quest.panel!);
            }}
            className="mo-field mo-focusable eyebrow underline decoration-dotted underline-offset-2 hover:text-[color:var(--color-tenno-200)]"
            style={{ color: 'var(--color-tenno-300)' }}
          >
            Open {getPanel(quest.panel)?.title}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- tracked block */

export function TrackedQuests({
  quests,
  order,
  onToggleTrack,
  onMove,
  onClear,
  openId,
  onToggleOpen,
  onJump,
}: {
  quests: readonly Quest[];
  order: readonly string[];
  onToggleTrack: (id: string) => void;
  onMove: (id: string, delta: number) => void;
  onClear: () => void;
  openId: string | null;
  onToggleOpen: (id: string) => void;
  onJump?: (id: string) => void;
}) {
  const byId = useMemo(() => new Map(quests.map((q) => [q.id, q])), [quests]);
  // Resolved on READ, so an id whose quest vanished with a dataset update is
  // simply skipped rather than corrupting the saved order.
  const rows = order.map((id) => byId.get(id)).filter((q): q is Quest => q !== undefined);

  return (
    /*
      `mo-arrive` rather than `anim-rise`. This section sits below the hero
      and the two pickers, so on a docked overlay it is usually off-screen at
      mount - which is the worst case for a time-based entrance, because a
      frozen document timeline strands it nine pixels low and it has already
      "played" by the time anybody scrolls to it. Scroll-driven progress comes
      from position; there is no clock in it to stop.
    */
    <section className="mo-arrive">
      <header className="mb-2.5 flex items-baseline gap-3">
        <h3
          className="font-[family-name:var(--font-title)] text-[length:var(--text-small)] tracking-[0.26em] uppercase"
          style={{ color: 'var(--color-orokin-300)' }}
        >
          Tracking
        </h3>
        {/*
          `--text-muted`, not `--text-ghost`. Measured at 2.66:1 against the panel
          behind it, which is under the 3:1 floor for any text carrying information -
          and this is a COUNT, the number that says how big the list under this heading
          is. Ghost is the tone for pure decoration.
        */}
        <span className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
          {rows.length}
        </span>
        <span aria-hidden className="h-px flex-1" style={{ background: 'var(--rule-hairline)' }} />
        {rows.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="mo-field mo-underline mo-focusable eyebrow inline-flex min-h-[26px] cursor-pointer items-center"
            style={{ color: 'var(--text-faint)' }}
          >
            Clear
          </button>
        )}
      </header>

      {rows.length === 0 ? (
        <p
          className="wf-note px-4 py-3"
          style={{ clipPath: CHAMFER, background: 'oklch(1 0 0 / 0.02)', color: 'var(--text-muted)' }}
        >
          Nothing tracked yet. Pin anything from the board below and it appears here, in the order you
          put it in — this is your list, not the app&rsquo;s ranking of it.
        </p>
      ) : (
        <ul className="flex flex-col gap-[3px]">
          {rows.map((q, i) => (
            <QuestRow
              key={q.id}
              quest={q}
              tracked
              rank={i}
              count={rows.length}
              onToggleTrack={() => onToggleTrack(q.id)}
              onMove={(d) => onMove(q.id, d)}
              open={openId === q.id}
              onToggleOpen={() => onToggleOpen(q.id)}
              onJump={onJump}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
