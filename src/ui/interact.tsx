/**
 * INTERACTION PRIMITIVES.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * Eight of the thirteen panels contained not one click handler. Every screen
 * was a wall of rows that looked like controls, sat under a `cursor: pointer`
 * inherited from a neighbour, and did nothing at all when pressed.
 *
 * The two pieces every one of those panels turned out to need are here: a way to
 * state a set of facts without inventing the ones we do not have, and a way to
 * turn a named thing into somewhere you can go. The MOVEMENT lives in the
 * INTERACTION block of styles/theme.css rather than in components, because a
 * catalog panel renders hundreds of rows at once over a running game and hover
 * is something the browser already tracks for free.
 *
 * There is deliberately no `Disclosure` component. One was written, and every
 * panel ended up composing `.rf-row` and `.rf-reveal` around its own summary
 * markup instead - the summaries have nothing in common but the chevron, and a
 * component whose only shared part is an arrow is not worth the indirection.
 */

import type { ReactNode } from 'react';
import { cx } from './orokin';
import { goTo, type FocusKind } from './navigation';

/* -------------------------------------------------------------------- facts */

export interface Fact {
  label: string;
  value: ReactNode;
  /** Suppresses the row entirely rather than printing a placeholder. */
  when?: boolean;
}

export interface FactsProps {
  items: readonly Fact[];
  /**
   * Set the values larger than the labels.
   *
   * For the two or three numbers that define a thing, where the value is the
   * point and the label is only there to name it. Everywhere else the two are
   * peers and this stays off.
   */
  emphasis?: boolean;
  /**
   * Roughly how many columns to aim for at a typical width.
   *
   * A hint, not a fixed count - the grid auto-fits, so a wide container gets
   * more and a narrow one gets fewer. Lower this for facts with long values.
   */
  columns?: number;
}

/**
 * The detail body: a list of label/value pairs.
 *
 * `when` exists so a panel can pass every fact it MIGHT know and have the
 * unknown ones vanish. The alternative — printing "—" or "0" for something that
 * was simply never measured — is the fabricated-data failure this project has
 * had to fix repeatedly, and it is worse than showing nothing.
 */
/**
 * Narrowest a label/value pair may be, for `columns: 1`; divided down from there.
 *
 * At the default of 2 this makes each pair 15rem, which is about as wide as a
 * label and a right-aligned value can be before the eye stops connecting them.
 * The first attempt let a pair fill half a full-width table row - roughly 500px
 * with a quarter of that empty between "Category" and "Warframe" - and it read
 * as two unrelated columns of text.
 */
const MIN_PAIR_REM = 30;

export function Facts({ items, columns = 2, emphasis = false }: FactsProps) {
  /*
   * A repeated label is DROPPED, not printed twice.
   *
   * The item card composes facts from three places - the catalog's shared set,
   * the panel's own, and the vitals - and they collided: "Mastery rank" arrived
   * from two of them at once, and "Rank cap" and "Max rank" were the same number
   * under two names. Silently keeping the first is the right failure here,
   * because the alternative that was shipping was the same value twice in one
   * card.
   */
  const seen = new Set<string>();
  const shown = items.filter((f) => {
    if (f.when === false) return false;
    const key = f.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (shown.length === 0) return null;
  /*
   * Auto-fit, with a cap.
   *
   * A fixed two-column grid inside a full-width table row stretched each pair to
   * ~600px, which left "Category" and "Warframe" at opposite ends of the screen
   * with nothing between them - the label stops reading as belonging to the
   * value. `auto-fit` with a minimum instead adds COLUMNS as space allows, so a
   * pair is never wider than it needs to be, and the whole block stops at a
   * width the eye can still take in as one thing.
   */
  /*
   * Emphasis is a ROW, not a grid.
   *
   * The grid stretches each pair to fill its column, which is right when a
   * label and its value are peers reading left-to-right. For the two or three
   * numbers that define a thing it is wrong: it put "Critical" hard against the
   * left edge and its value hard against the right, 400px away, and the eye
   * stopped connecting them. A stat block wants the label sitting directly on
   * top of the number, and the numbers sitting next to each other so they can be
   * compared at a glance.
   */
  if (emphasis) {
    return (
      <dl className="flex flex-wrap items-end gap-x-9 gap-y-3">
        {shown.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="eyebrow">{f.label}</dt>
            <dd
              className="numeric mt-0.5 truncate"
              style={{ color: 'var(--text)', fontSize: 'var(--text-lead)', lineHeight: 1.05 }}
            >
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl
      className="grid max-w-[64rem] gap-x-7 gap-y-1.5 text-[length:var(--text-small)]"
      /*
       * `auto-fill`, not `auto-fit`. They differ only when the row is not full,
       * and that difference is the whole point: auto-fit COLLAPSES the empty
       * tracks and hands their width to the survivors, so a lone fact was given
       * a 1,022px column with its label at one end and its value at the other.
       * auto-fill keeps the empty tracks, so one fact stays one column wide and
       * its label and value stay next to each other.
       */
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${String(MIN_PAIR_REM / columns)}rem, 1fr))` }}
    >
      {shown.map((f) => (
        <div key={f.label} className="flex min-w-0 items-baseline justify-between gap-3">
          <dt className="eyebrow shrink-0">{f.label}</dt>
          <dd className="numeric min-w-0 truncate text-right" style={{ color: 'var(--text)' }}>
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* --------------------------------------------------------------------- link */

/**
 * A named thing, rendered as somewhere you can go.
 *
 * The app is full of cross-references that were dead text: a quest naming a
 * node, a resource naming the planet it drops on, a syndicate naming its
 * sacrifice. Each one is a question the app can already answer, and each one was
 * a dead end. This turns any of them into one click.
 */
export function GoLink({
  kind,
  id,
  children,
  className,
  title,
}: {
  kind: FocusKind;
  id: string;
  children?: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      /*
       * `mo-underline` is NOT added here, deliberately.
       *
       * It would be the more responsive of the two - it draws from wherever the
       * pointer crossed the word, where `rf-link` always draws from the left -
       * but both effects are painted on the SAME ::after, so wearing both means
       * one silently deleting the other. A link is also the one place where the
       * fixed left origin is arguably right: it reads as the word being
       * underlined, in reading order, rather than as a surface being lit.
       *
       * What `rf-link` never had is the arrival: `mo-focusable` blooms the ring
       * the moment focus lands. These links are scattered inside dense detail
       * cards, and tabbing between them moved a static gold outline with no
       * indication that it had moved at all.
       */
      className={cx('rf-link mo-focusable', className)}
      title={title ?? `Go to ${id}`}
      onClick={(e) => {
        // Rows are buttons too; without this a link inside one toggles the row.
        e.stopPropagation();
        goTo(kind, id);
      }}
    >
      {children ?? id}
    </button>
  );
}
