/**
 * NESTING, SO NOTHING IS A WALL OF TEXT.
 *
 * THE PROBLEM
 * ───────────
 * Panels in this app answer thoroughly, and thoroughness laid out flat is a
 * wall. A screen that states a verdict, the working behind it, the five
 * requirements it checked, the provenance of each number and what would settle
 * the ones it could not check is a screen nobody reads - not because any of it
 * is wrong, but because all of it arrives at once and the reader has to do the
 * triage the panel should have done.
 *
 * The fix is not to delete the detail. The detail is the honesty. The fix is to
 * put it one level down, behind an answer, so the reader chooses their depth.
 *
 * HOW THIS ANIMATES WITHOUT BREAKING THE ONE RULE THAT MATTERS
 * ───────────────────────────────────────────────────────────
 * The obvious implementation animates the region's HEIGHT, or fades it in. Both
 * are forbidden here and the reason is specific: this overlay's document
 * timeline STOPS while the window is not being presented. A transition or
 * animation then sits at its start value forever - `currentTime: 0`, reporting
 * `running`. An animated `grid-template-rows` is one of the four ways this has
 * already been got wrong in this codebase (see `scripts/check-frozen.ts`), and
 * the symptom is the worst one available: a section the player opened, which
 * then shows nothing at all for as long as they are looking at the game.
 *
 * So the region opens INSTANTLY. Full height, full opacity, on the same frame
 * as the click. There is no transition on the container and there never may be.
 *
 * The motion is in the CHILDREN, and it is transform-only: each one arrives
 * from a few pixels below, staggered. If the timeline freezes mid-open, the
 * section is open, every word is legible, and some rows are nine pixels from
 * where they belong. That is the failure mode this component is designed to
 * have.
 *
 * The summary is a real button carrying `aria-expanded`, and the region is
 * labelled by it. The chevron rotates - a transform, which is safe, and which
 * degrades to "the arrow is pointing the wrong way" rather than to a lie.
 */

import { useId, useState, type ReactNode } from 'react';
import { CHAMFER_SM as CHAMFER } from './geometry';

export interface DisclosureProps {
  /** The one line that has to be readable without opening anything. */
  summary: ReactNode;
  /** Sits above the summary, small and quiet: what KIND of thing this is. */
  eyebrow?: string;
  /**
   * The answer, on the summary row, aligned right. This is the whole point of
   * the pattern: a closed row still says something, so a reader who never opens
   * anything has still been told what they came for.
   */
  answer?: ReactNode;
  /** Open on first render. Use for the one section that is the subject. */
  defaultOpen?: boolean;
  /**
   * How deep this sits. Drives the indent rail, so nested levels are legible as
   * nesting rather than as a list that has drifted right.
   */
  depth?: number;
  /** A colour for the rail and the eyebrow, when this section has a verdict. */
  accent?: string;
  /**
   * Called the first time this opens, and on every open after.
   *
   * The hook a drill-down needs: opening a section is an EVENT, so work that
   * only matters once somebody looks - a request, a computation nobody has
   * asked for yet - belongs here rather than in an effect reacting to the body
   * having mounted. An effect would also re-run on every remount, and these
   * remount whenever a list re-sorts.
   */
  onOpen?: () => void;
  children: ReactNode;
  className?: string;
}

export function Disclosure({
  summary,
  eyebrow,
  answer,
  defaultOpen = false,
  depth = 0,
  accent,
  onOpen,
  children,
  className,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const ink = accent ?? 'var(--color-orokin-300)';

  return (
    <div
      className={`rf-disc${className === undefined ? '' : ` ${className}`}`}
      data-open={open}
      style={{ '--disc-ink': ink, '--disc-depth': String(depth) } as React.CSSProperties}
    >
      <button
        type="button"
        aria-expanded={open}
        /*
         * ONLY WHILE THE REGION EXISTS.
         *
         * The body is rendered inside `{open && ...}` below, so a closed
         * disclosure carried an `aria-controls` pointing at an id that was not
         * in the document. That is not a cosmetic violation: the attribute is a
         * promise that the element is there, and a screen reader following it
         * finds nothing to describe. `aria-expanded` already carries the state,
         * which is the part that must always be present.
         */
        aria-controls={open ? id : undefined}
        onClick={() => {
          /*
           * THE EFFECT GOES OUTSIDE THE UPDATER, AND THIS WAS A REAL BUG.
           * ————————————————————————————————————————————
           * `onOpen` is how a drill starts loading what it is about to show -
           * ninety days of prices, the live sellers. It was being called from
           * inside the `setOpen` updater, which React deliberately invokes
           * TWICE in StrictMode to surface exactly this. So every drill fired
           * its request twice: double the traffic, from a client whose entire
           * reading policy exists to be gentle, against an API that had
           * already answered with 429s once.
           *
           * `open` read here is the value from the render this handler was
           * attached to, which is the correct one - a click always lands in a
           * render that has the current value.
           */
          if (!open) onOpen?.();
          setOpen((v) => !v);
        }}
        /*
         * `mo-field` opts this row into the document-level pointer tracker, so
         * the light below costs no React handler and no layout read per row -
         * which matters, because these nest and a panel can hold dozens.
         */
        className="rf-disc-summary rf-clipped mo-field mo-focusable"
        style={{ clipPath: CHAMFER }}
      >
        <span aria-hidden className="rf-disc-chev" />
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          {eyebrow !== undefined && (
            <span className="eyebrow" style={{ color: ink }}>
              {eyebrow}
            </span>
          )}
          <span className="rf-disc-title min-w-0 text-left">{summary}</span>
        </span>
        {answer !== undefined && <span className="rf-disc-answer ml-auto min-w-0">{answer}</span>}
      </button>

      {/*
        RENDERED ONLY WHEN OPEN, AND THAT IS DELIBERATE.

        Keeping it mounted and hidden would mean the catalog panels holding
        every collapsed detail of eight hundred rows in the DOM - the exact cost
        this app already fights. Unmounting also means the stagger below replays
        on each open, which is what makes opening feel like an action rather
        than like a reveal of something that was always there.
      */}
      {open && (
        <div id={id} className="rf-disc-body mo-stagger">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A paragraph that refuses to become a wall.
 *
 * Long prose on screen is nearly always a sign that a panel is explaining
 * something it could have shown, and the honest ones in this app are the worst
 * offenders: a refusal that names what is missing AND what would settle it is
 * two sentences minimum, and there are five of them on one screen.
 *
 * Clamped to a few lines with the rest one press away. `-webkit-line-clamp` is
 * a layout property, not an animation, so a frozen timeline cannot affect it -
 * and the clamped state still shows the first lines, so the failure mode is
 * "you can see most of it" rather than "you can see none of it".
 */
export function Clamp({ lines = 2, children }: { lines?: number; children: ReactNode }) {
  const [all, setAll] = useState(false);
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      <div
        id={id}
        className="min-w-0"
        style={
          all
            ? undefined
            : {
                display: '-webkit-box',
                WebkitLineClamp: lines,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }
        }
      >
        {children}
      </div>
      {/*
        THE TOGGLE HAS TO SAY WHAT IT DOES.

        A bare "more" announces as the word "more" and nothing else: a screen
        reader user is told there is a button, not that there is text it is
        hiding, nor whether it is currently hiding it. The expanded state and a
        label naming the region turn it from a mystery control into the same
        disclosure the rest of this file implements.
      */}
      <button
        type="button"
        aria-expanded={all}
        aria-controls={id}
        onClick={() => {
          setAll((v) => !v);
        }}
        /* A 24px floor on the target, not on the text. The label is one small
           word and should stay one small word; what was 47x23 and awkward to
           hit is now the same word with a real target under it. */
        className="rf-disc-more mo-underline mo-field eyebrow inline-flex min-h-6 cursor-pointer items-center"
      >
        {all ? 'less' : 'more'}
      </button>
    </div>
  );
}
