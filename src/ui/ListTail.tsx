/**
 * The tail of a truncated list: what is not shown, why, and how to reach it.
 *
 * WHY THIS IS A COMPONENT AND NOT SEVEN PARAGRAPHS
 * ───────────────────────────────────────────────
 * A runtime sweep of the Vault found fifty-three sentences under fifteen
 * pixels. Forty-nine were teasers whose full text is one click down - fine,
 * and left alone. The four that were not turned out to be this message, and
 * the same message was hand-written in seven files:
 *
 *   "204 more, alphabetically after these - filter by name to reach one"
 *
 * set as `<p className="eyebrow">`, which renders it UPPERCASE at 0.18em
 * tracking in the faintest ink. An eyebrow is a kicker of one to three words
 * naming a category. This is a sentence, and it is the sentence that tells a
 * reader the list they are looking at is not the whole list - which on a
 * three-hundred-row catalogue is the difference between "there is nothing
 * else" and "there are two hundred more and here is how to see them".
 *
 * THE SHAPE IS THE POINT. Every site was already saying the same three
 * things, in the same order, in slightly different words. Naming them as
 * parameters is what stops the eighth site from inventing a fourth phrasing:
 *
 *   count · what they are · why these and not those · how to reach them
 *
 * `ordered` is not optional, and that is deliberate: a truncated list that
 * does not say WHICH ones it kept has hidden the rows by an unstated rule,
 * and the reader cannot tell whether the interesting one is above or below
 * the cut. It is the one field this component will not let a caller omit.
 */

export function ListTail({
  hidden,
  noun,
  ordered,
  reach,
  className,
}: {
  /** How many rows are not shown. Renders nothing at zero or below. */
  hidden: number;
  /** What they are - "Lith relics", "stations on this line". Omit for a plain "more". */
  noun?: string;
  /** Why these and not those: "ranked below these", "alphabetically after these". */
  ordered: string;
  /** How to reach the rest, when there is a way. Omit when there is none. */
  reach?: string;
  /** Padding, when the list's own rhythm needs something other than the default. */
  className?: string;
}) {
  if (hidden <= 0) return null;
  return (
    <p className={`wf-note ${className ?? 'px-3 py-2'}`}>
      {hidden.toLocaleString()} more{noun === undefined ? '' : ` ${noun}`}, {ordered}
      {reach === undefined ? '' : ` — ${reach}`}
    </p>
  );
}
