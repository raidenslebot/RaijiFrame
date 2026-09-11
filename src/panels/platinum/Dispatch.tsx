/**
 * Five orders, one per way of making platinum.
 *
 * WHY FIVE, AND WHY THEY ARE NOT A TOP FIVE
 * ─────────────────────────────────────────
 * One instruction at a time was right about shape and wrong about supply: it
 * gave a player with an evening ahead of them a single thing to do. But the
 * obvious fix - show the next five in the ranking - is worse than it sounds,
 * because a ranking on one axis makes every entry after the first a slightly
 * worse copy of it. Five sells in a row is one idea repeated.
 *
 * `plat-picks.ts` answers five DIFFERENT questions instead, one per budget:
 * a trade, an hour, today's standing, a relic, and the parts already in your
 * inventory. Nothing here is the runner-up to anything else, and a kind with no
 * answer says what is missing rather than being replaced by a sixth sale.
 *
 * MOTION, AND THE CONSTRAINT THAT SHAPED ALL OF IT
 * ───────────────────────────────────────────────
 * This overlay's document timeline STOPS the moment the host stops presenting
 * the window, and a paused CSS animation reports playState "running" at
 * currentTime 0 for ever. Every animation in this project has had to be timid
 * because of it: transform-only, no reveal, nothing that matters mid-flight.
 *
 * There is a whole class of motion that constraint cannot touch, and it is the
 * one this file is built on. INPUT-DRIVEN motion is not interpolated over time
 * at all - it is recomputed on every pointer event, so its value is always a
 * function of where the pointer is RIGHT NOW. If the window is not presented
 * there are no pointer events, so there is no frame to be stranded on: the card
 * simply sits at its rest position. Nothing can hang half-lit or half-tilted.
 *
 * Three moves come out of that, and each does a job:
 *
 *   THE LIGHT   A specular highlight tracks the cursor across the card, drawn
 *               from the card's own colour in oklch rather than a pasted white.
 *               Orokin surfaces are polished metal; this is what polished metal
 *               does under a moving light, and it makes the card read as an
 *               object rather than a rectangle.
 *   THE TILT    The same pointer position rotates the card a couple of degrees
 *               on a real z axis. It is the same physical claim as the light,
 *               and the two together are what sell the object.
 *   THE PULL    Drag a card right to take it, left to wave it away. The card
 *               follows the pointer one to one, the edge it is heading for
 *               brightens as it crosses the threshold, and letting go past that
 *               point commits. A gesture, not a button - and the buttons stay
 *               for the keyboard, because a gesture nobody can reach is a
 *               decoration with extra steps.
 *
 * None of the three touches React state while it is happening. Every frame is a
 * custom property written straight to the element, so dragging a card does not
 * re-render the panel behind it.
 */

import { useRef, useState } from 'react';
import { ordersOf, priceOf, type OrderBook, type Price } from '../../data/market';
import { Disclosure } from '../../ui/Disclosure';
import { LiveOrders, PriceHistory } from '../../ui/MarketDepth';
import { contention, type Fact, type Need, type Pick, type Refusal, type RewardRow, type Slot } from '../../data/plat-picks';
import { arrange, move, type Order } from '../../ui/ordering';
import { KIND_LABEL } from '../../data/plat-picks';
import { CHAMFER_MD as CHAMFER } from '../../ui/geometry';

/** What the player has already dealt with, and how. */
export type StepState = 'done' | 'skipped';
export type Progress = Readonly<Record<string, StepState>>;

/** How far a card must travel before letting go commits it. */
/*
 * HOW FAR A CARD TRAVELS BEFORE IT MOVES ONE PLACE.
 *
 * This was MOVE_PX and it committed: past it, the card was marked done or
 * skipped and left the deck. A drag is the most exploratory input a pointer
 * has - it is how you find out what something does - and it was wired to the
 * one outcome you cannot take back by letting go.
 *
 * It moves the card now. Removing one takes a labelled button, which is a
 * thing you decide to press rather than a thing you discover by pulling.
 */
const MOVE_PX = 96;
/** Under this, a press was a click and not a pull. */
const CLICK_PX = 5;
/** How far the tilt goes at the very corner of a card. */
const TILT_DEG = 5;

function Meta({ children }: { children: React.ReactNode }) {
  return (
    <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
      {children}
    </span>
  );
}

/**
 * What a method requires, checked, with the shortfall drawn.
 *
 * Always on the card, never behind a disclosure. The whole point is that the
 * player should not have to work out whether they can afford the thing they are
 * being told to do, and a requirement hidden one click away is a requirement
 * they will discover in the game instead.
 *
 * Three states, three readings. Met is quiet - a requirement you satisfy is not
 * news. Short is amber and carries the gap, because the gap is the actionable
 * part. Unknown is neither: it says the app cannot see the number, which is a
 * fact about this app and not about the player.
 */
function Needs({ needs }: { needs: readonly Need[] }) {
  if (needs.length === 0) return null;

  return (
    <ul className="mt-3 flex flex-col gap-1">
      {needs.map((n) => {
        const short = n.met === false;
        const unknown = n.met === null;
        const ink = short ? 'var(--color-signal-warn)' : unknown ? 'var(--text-ghost)' : 'var(--color-signal-good)';
        /* How far along they are, for the bar. Only drawn when both numbers
           are real: a bar with an unknown numerator would be a guess. */
        const ratio = n.need !== null && n.need > 0 && n.have !== null ? Math.min(1, n.have / n.need) : null;

        return (
          <li key={n.what} className="flex flex-wrap items-baseline gap-x-2">
            <span aria-hidden className="mt-[5px] size-[5px] shrink-0 rotate-45 self-start" style={{ background: ink }} />
            <span className="text-[length:var(--text-nano)]" style={{ color: short ? 'var(--text)' : 'var(--text-muted)' }}>
              {n.what}
            </span>

            {/* "9 of 2 trades" read as nine out of two. The requirement comes
                first because it is the fixed quantity, and what they hold
                follows it, each labelled so neither can be misread. */}
            {n.need !== null && (
              <span className="numeric text-[length:var(--text-nano)]" style={{ color: ink }}>
                needs {n.need.toLocaleString()}
                {n.unit !== '' && ` ${n.unit}`}
                {n.have === null ? ', yours not read' : `, you have ${n.have.toLocaleString()}`}
              </span>
            )}

            {short && n.need !== null && n.have !== null && (
              <span className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--color-signal-warn)' }}>
                &mdash; {(n.need - n.have).toLocaleString()} short
              </span>
            )}

            {ratio !== null && ratio < 1 && (
              <span aria-hidden className="relative ml-auto h-px w-16 shrink-0 self-center" style={{ background: 'var(--hairline)' }}>
                <span
                  className="absolute top-0 left-0 h-px"
                  style={{ width: `${String(Math.round(ratio * 100))}%`, background: 'var(--color-signal-warn)' }}
                />
              </span>
            )}

            {unknown && n.unknown !== undefined && (
              <span className="text-[length:var(--text-nano)]" style={{ color: 'var(--text-ghost)' }}>
                {n.unknown}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The working behind the number, opened by a press on the card.
 *
 * The card states one figure and one reason; this is every measurement that
 * produced it, each labelled with where it came from. Provenance is the point:
 * a published constant and a median of yesterday's trades and a figure from
 * this player's own log carry completely different weight, and a column of
 * bare numbers hides that difference.
 */
/**
 * Can this be done right now, with what the account actually holds?
 *
 *   true   every requirement checked out
 *   false  at least one is short by a known amount
 *   null   at least one could not be checked, and nothing is short
 *
 * The three states are the same three a `Need` has, collapsed, and the middle
 * one is the only one that should ever change the order of the deck: a card
 * you are short for is still worth seeing, and a card whose requirement this
 * app cannot read is not a card you have been told you cannot do.
 */
function doableNow(pick: Pick): boolean | null {
  if (pick.needs.some((n) => n.met === false)) return false;
  if (pick.needs.some((n) => n.met === null)) return null;
  return true;
}

const FROM_INK: Record<Fact['from'], string> = {
  measured: 'var(--color-tenno-300)',
  published: 'var(--color-signal-good)',
  yours: 'var(--color-orokin-300)',
};

const FROM_WORD: Record<Fact['from'], string> = {
  measured: 'measured',
  published: 'published',
  yours: 'yours',
};

/**
 * ONE MORE "HOW DO YOU KNOW", AND THEN ANOTHER.
 * ————————————————————————————————————————————
 * The card answers with a number. Pressed, it shows its working - which is a
 * list of more numbers, each inviting the same question with nowhere to send
 * it. Every previous version of this card stopped there.
 *
 * This is the step below: the ninety days of closes behind that median, and
 * the people selling the thing this minute. Both were already being fetched or
 * already available and neither was ever shown.
 *
 * Fetched on OPEN, never on render. Opening a card is something the player did,
 * so the request belongs in that event - an effect would fire for cards nobody
 * looked at and re-fire every time the deck re-ranked.
 */
function Evidence({ slug }: { slug: string }) {
  const [price, setPrice] = useState<Price | null | 'none'>(null);
  const [book, setBook] = useState<OrderBook | null | 'failed'>(null);
  const [asked, setAsked] = useState(false);

  const ask = (): void => {
    if (asked) return;
    setAsked(true);
    void priceOf(slug).then((p) => {
      setPrice(p ?? 'none');
    });
    void ordersOf(slug).then((b) => {
      setBook(b ?? 'failed');
    });
  };

  return (
    <Disclosure
      eyebrow="how this price is known"
      summary="The market behind it"
      onOpen={ask}
      answer={
        price !== null && price !== 'none' ? (
          <span className="numeric">{`${String(price.history.length)} days of closes`}</span>
        ) : price === 'none' ? (
          <span style={{ color: 'var(--text-ghost)' }}>no closed trades in ninety days</span>
        ) : asked ? (
          <span style={{ color: 'var(--text-faint)' }}>reading the market</span>
        ) : (
          <span style={{ color: 'var(--text-ghost)' }}>ninety days, and who is selling now</span>
        )
      }
    >
      {price !== null && price !== 'none' && <PriceHistory history={price.history} />}
      <LiveOrders book={book} />
    </Disclosure>
  );
}

/**
 * THE DISTRIBUTION BEHIND AN EXPECTATION.
 * ————————————————————————————————————————————
 * A relic's number is not a price, it is an average over a drop table - the
 * least inspectable figure the deck produces. The card listed its four best
 * rewards and stopped, which answers "what is in it" and not "why that
 * number".
 *
 * The whole table, ordered by what each row contributes, with the arithmetic
 * visible: a chance, a price, and the product that went into the total. A row
 * nobody can trade says so and offers no market page - Forma and the Requiem
 * mods have none, and a link to nothing is worse than no link.
 *
 * Each tradeable row then drills again, into the same ninety days and live
 * sellers every other card reaches. That is the point: the chain does not stop
 * because the question got specific.
 */
function RewardTable({ rows }: { rows: readonly RewardRow[] }) {
  if (rows.length === 0) return null;
  const priced = rows.filter((r) => r.expected !== null).length;
  return (
    <Disclosure
      eyebrow="what is in it, and what each part contributes"
      summary="The whole reward table"
      answer={
        <span className="numeric">
          {`${String(rows.length)} rewards, ${String(priced)} priced`}
        </span>
      }
    >
      <div className="flex min-w-0 flex-col">
        {rows.map((r) => (
          <div key={r.item} className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-baseline gap-x-2 py-0.5">
              <span className="numeric shrink-0 text-[length:var(--text-nano)]" style={{ color: 'var(--text-faint)' }}>
                {`${r.chance.toFixed(1)}%`}
              </span>
              <span className="min-w-0 truncate text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
                {r.item}
              </span>
              <span className="numeric ml-auto shrink-0 text-[length:var(--text-nano)]" style={{ color: 'var(--text-faint)' }}>
                {r.plat === null ? (r.slug === null ? 'not tradeable' : 'no recent trades') : `${String(r.plat)}p`}
              </span>
              {r.expected !== null && (
                <span
                  className="numeric w-16 shrink-0 text-right text-[length:var(--text-nano)]"
                  style={{ color: 'var(--color-tenno-300)' }}
                  title="Its chance times its price - what this row contributes to the expected value"
                >
                  {`+${r.expected.toFixed(1)}p`}
                </span>
              )}
            </div>
            {/* And the same question again, one level down, for anything with
                a market. */}
            {r.slug !== null && r.plat !== null && (
              <div className="pl-4">
                <Evidence slug={r.slug} />
              </div>
            )}
          </div>
        ))}
      </div>
    </Disclosure>
  );
}

function Working({ facts }: { facts: readonly Fact[] }) {
  if (facts.length === 0) return null;
  return (
    <dl className="rf-open mt-3 flex flex-col gap-1 border-l pl-3" style={{ borderColor: 'var(--hairline)' }}>
      {facts.map((f) => (
        <div key={f.label} className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-[length:var(--text-nano)]" style={{ color: 'var(--text-faint)' }}>
            {f.label}
          </dt>
          <dd className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--text)' }}>
            {f.value}
          </dd>
          <dd className="ml-auto text-[length:var(--text-nano)]" style={{ color: FROM_INK[f.from] }}>
            {FROM_WORD[f.from]}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A CARD IS A STACK, NOT A SLIDE.
 *
 * Each kind hands down every candidate it ranked, best first, rather than only
 * its winner. That changes what a card IS: it is one kind's whole answer, with
 * the best of it face up and the rest behind, reachable.
 *
 * Two things follow that the old single-pick card could not do.
 *
 * Marking the face-up one no longer empties the kind. The next-best steps up
 * in its place, and the kind only leaves the deck when every candidate in it
 * has been dealt with. A deck of five that fell to two after a few taps now
 * stays five until there is genuinely nothing left of a kind.
 *
 * And the runners-up can be READ. They were being computed and deleted;
 * looking at the second-best sale is now a keypress, not a rebuild.
 */
function Card({
  chain,
  index,
  onMark,
  onMove,
  onCopy,
  copied,
  copyFailed,
}: {
  /** Every undealt candidate of this kind, best first. Never empty. */
  chain: readonly Pick[];
  index: number;
  onMark: (ref: string, state: StepState) => void;
  /** Move this card one place earlier (-1) or later (+1) in the deck. */
  onMove: (kind: string, delta: number) => void;
  onCopy: (text: string) => void;
  copied: string | null;
  copyFailed: string | null;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const from = useRef<number | null>(null);
  /*
   * WHERE IN THE STACK WE ARE, CLAMPED RATHER THAN RESET.
   *
   * The chain shortens under this component whenever a candidate is dealt with
   * or a price lands and the kind re-ranks. Storing a raw index would then read
   * off the end and render nothing; storing the ref would lose the place every
   * time the ranking moved. Clamping keeps the position meaningful through both
   * and can never point at a hole.
   */
  const [want, setWant] = useState(0);
  /*
   * WHICH WAY THE STACK LAST MOVED.
   *
   * Stepping used to swap the content with no motion whatsoever: the subject,
   * the figure and the requirement lines were simply different on the next
   * frame. That reads as a glitch rather than as a move, and it loses the one
   * fact the swap most needs to carry - whether you went FORWARD into the stack
   * or came back out of it. Two identical instant swaps are indistinguishable,
   * so a player who overshot had no way to see that the second press undid the
   * first.
   *
   * One number, written by the same call that moves the stack, so the direction
   * can never disagree with the move it describes.
   */
  const [dir, setDir] = useState(1);
  const at = Math.min(want, chain.length - 1);
  /*
   * `chain` is non-empty by construction - the deck drops a kind whose chain
   * has emptied - so this fallback is for the type system, not for a case that
   * happens. It deliberately does NOT return early here: the disclosure state
   * below is a hook, and a return above it would make that hook conditional.
   */
  const pick = chain[at] ?? chain[0];
  const behind = chain.length - 1 - at;
  const step = (by: number): void => {
    setDir(by);
    setWant(() => {
      const next = at + by;
      // Wraps, because a stack of four with no wrap makes the fourth a dead end
      // that has to be walked back out of.
      return next < 0 ? chain.length - 1 : next >= chain.length ? 0 : next;
    });
  };
  /*
   * THE LEAD SHOWS ITS WORKING WITHOUT BEING ASKED.
   *
   * It is twice as wide as its neighbours and lays its content in two columns,
   * and with only the requirement lines to put in the second one that column
   * sat almost empty - the same hole the two-row span made, moved sideways. The
   * subject of the picture is the card with room for the evidence, so it
   * carries the evidence. The other four still open on a press, where the room
   * has to be made rather than assumed.
   */
  const [open, setOpen] = useState(index === 0);

  /*
   * Every one of these writes a custom property and returns. No setState, so
   * no render, so the other four cards do not repaint while this one moves.
   */
  const set = (name: string, value: string): void => {
    el.current?.style.setProperty(name, value);
  };

  const track = (e: React.PointerEvent<HTMLDivElement>): void => {
    // Tracking and settling are mutually exclusive: while the pointer is here,
    // the card is wherever the pointer says, with nothing interpolating.
    el.current?.classList.remove('rf-settle');
    const box = el.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    set('--px', `${String(Math.round(x * 100))}%`);
    set('--py', `${String(Math.round(y * 100))}%`);
    if (from.current === null) {
      set('--tx', `${((x - 0.5) * 2 * TILT_DEG).toFixed(2)}deg`);
      set('--ty', `${((0.5 - y) * 2 * TILT_DEG).toFixed(2)}deg`);
    }
  };

  const rest = (): void => {
    /*
     * The drag ends here too, not only in `release`.
     *
     * `from` used to be cleared in exactly one place, so any path that reached
     * rest without it - a pointer leaving the card when capture had failed, a
     * cancelled gesture - left the ref set. The next plain hover was then read
     * as a continuing drag: the card jumped to wherever the cursor was and the
     * tilt stopped working, with no way back short of a reload.
     */
    from.current = null;
    el.current?.classList.add('rf-settle');
    set('--px', '50%');
    set('--py', '0%');
    set('--tx', '0deg');
    set('--ty', '0deg');
    set('--dx', '0px');
    set('--pull', '0');
    set('--take', '0');
    set('--drop', '0');
  };

  const grab = (e: React.PointerEvent<HTMLDivElement>): void => {
    /*
     * CLEAR FIRST, ALWAYS.
     *
     * Returning early on a press inside a control used to leave whatever was
     * in `from` alone, and `release` runs on the same pointerup because the
     * event bubbles - so a click on Copy, after any earlier gesture that had
     * not been released cleanly, computed a distance against a stale grab
     * position and marked the card done. The player pressed Copy and the card
     * vanished.
     *
     * Only a primary button starts a gesture, too: a right or middle press
     * produced a drag whose pointerup the element may never see.
     */
    from.current = null;
    if ((e.target as HTMLElement).closest('button') !== null) return;
    if (e.button !== 0 || !e.isPrimary) return;
    from.current = e.clientX;
    /*
     * Capture is an optimisation, not a requirement: it keeps the moves coming
     * when the pointer leaves the card mid-drag. It throws when the browser has
     * no active pointer of that id, and an unguarded throw here killed the
     * whole gesture - the card followed the pointer and then simply did not
     * commit, with nothing on screen to say why.
     */
    try {
      el.current?.setPointerCapture(e.pointerId);
    } catch {
      /* the drag still works, it just stops if the pointer leaves the card */
    }
    set('--tx', '0deg');
    set('--ty', '0deg');
  };

  const drag = (e: React.PointerEvent<HTMLDivElement>): void => {
    track(e);
    if (from.current === null) return;
    const dx = e.clientX - from.current;
    set('--dx', `${String(Math.round(dx))}px`);
    /*
     * 0 at rest, 1 at the point where letting go would commit - and split
     * across the two edges rather than carried as a signed number, because the
     * edge opacities then read straight off a property instead of out of a
     * calc that mixes a registered custom property with an unregistered one.
     * That calc silently resolved to zero, which is the worst way for a
     * threshold indicator to fail: the gesture worked and nothing showed it.
     */
    const pull = Math.min(1, Math.abs(dx) / MOVE_PX);
    set('--pull', pull.toFixed(3));
    set('--take', dx >= 0 ? pull.toFixed(3) : '0');
    set('--drop', dx < 0 ? pull.toFixed(3) : '0');
  };

  // Every hook above has run unconditionally by this point, so the guard is
  // safe here and nowhere earlier.
  if (pick === undefined) return null;

  const release = (e: React.PointerEvent<HTMLDivElement>): void => {
    const start = from.current;
    from.current = null;
    if (start === null) return;
    try {
      el.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* nothing to release, which is not a reason to drop the gesture */
    }
    const dx = e.clientX - start;
    rest();
    if (Math.abs(dx) >= MOVE_PX) {
      /*
       * A DRAG MOVES. IT DOES NOT DESTROY.
       *
       * This used to call onMark and the card was gone. Nothing about pulling
       * a card sideways says "discard": every deck a player has handled moves
       * a card when you drag it, and throws one away only when you put it
       * somewhere that means throwing away.
       *
       * `onMove` reorders, is persisted, and is its own undo - drag it back.
       */
      onMove(pick.kind, dx > 0 ? 1 : -1);
      return;
    }
    /*
     * A press that did not travel is a CLICK, and opens the working.
     *
     * The same surface carries both because they are the same gesture at
     * different lengths, which is how every card interface a player has used
     * behaves. The threshold is small enough that a hand resting on a mouse
     * does not turn a click into a nudge, and large enough that a deliberate
     * pull is never mistaken for a tap.
     */
    if (Math.abs(dx) < CLICK_PX) setOpen((v) => !v);
  };

  return (
    <div
      ref={el}
      /*
       * The card is a real target, not just a surface that happens to respond
       * to a pointer. The pull is an accelerator for people who have a mouse;
       * the same two outcomes are on the arrow keys for everybody else, and the
       * group role means a screen reader announces the card as one thing with a
       * name rather than as a heap of unrelated text.
       */
      role="group"
      aria-label={`${KIND_LABEL[pick.kind]}: ${pick.verb} ${pick.subject}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          onMove(pick.kind, 1);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onMove(pick.kind, -1);
        } else if (e.key === 'ArrowDown' && chain.length > 1) {
          e.preventDefault();
          step(1);
        } else if (e.key === 'ArrowUp' && chain.length > 1) {
          e.preventDefault();
          step(-1);
        } else if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          // Only when the card itself has focus: a press on a button inside it
          // is that button's, and stealing it would break Copy for a keyboard.
          e.preventDefault();
          setOpen((v) => !v);
        }
      }}
      className={`rf-card rf-clipped relative flex min-w-0 flex-col${index === 0 ? ' rf-lead' : ''}`}
      style={{ clipPath: CHAMFER, animationDelay: `${String(index * 70)}ms` }}
      onPointerMove={drag}
      onPointerLeave={rest}
      onPointerDown={grab}
      onPointerUp={release}
      onPointerCancel={release}
      /* Capture can be taken away - a browser gesture, a window losing focus,
         the overlay being hidden mid-drag. Without this the card stays where
         the pointer left it, translated, for ever. */
      onLostPointerCapture={rest}
    >
      {/* The edge the card is being pulled toward. Its brightness IS the
          threshold: full means letting go now will move it one place. Both
          edges are the same colour because both outcomes are the same KIND of
          outcome - one green and one amber said "keep" and "discard", which is
          what this gesture used to do and no longer does. */}
      <span aria-hidden className="rf-edge rf-edge-take" />
      <span aria-hidden className="rf-edge rf-edge-drop" />

      {/*
        THE DEPTH OF THE STACK, INSIDE THE CARD.

        The obvious move is ghost cards peeking out behind this one, and it
        cannot work here: the card carries a clip-path for its chamfer, and a
        clip-path clips everything the element paints - children, shadows, the
        lot. Layers offset beyond the edge are simply cut off, so the stack
        would have been invisible and the CSS would have looked correct.

        A rail of segments says the same thing from inside the clip: one per
        candidate in this kind, the one you are looking at lit. It also says
        WHICH you are on, which the peeking-cards idea never could.

        Decoration only - it is aria-hidden because the control underneath
        states the position in words, and two announcements of one fact is one
        too many.
      */}
      {chain.length > 1 && (
        <span aria-hidden className="rf-depth">
          {chain.map((c, i) => (
            <i key={c.ref} className={i === at ? 'rf-depth-on' : undefined} />
          ))}
        </span>
      )}

      {/* A standing rail for a card you are short for, so the deck can be read
          at a glance before any of the requirement lines are. */}
      {doableNow(pick) === false && (
        <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[2px]" style={{ background: 'var(--color-signal-warn)' }} />
      )}

      <div className="rf-body flex min-w-0 flex-1 flex-col px-4 py-4">
      {/*
        KEYED BY THE CANDIDATE, WHICH IS WHAT MAKES THE SWAP A MOVE.
        A CSS animation only restarts when the element does, and nothing else
        here would remount these two: the card is keyed by KIND on purpose, so
        that stepping keeps the reader's place. Keying the two blocks that
        actually change content - and only those - re-runs the swap while the
        controls underneath keep their focus, which a remount of the whole body
        would have stolen mid-keypress.
      */}
      {/*
        DISTINCT KEYS. THESE TWO ARE SIBLINGS.

        Both carried key={pick.ref}, which put two children of the same parent
        under one key. React says what happens then: children "may be
        duplicated and/or omitted - the behavior is unsupported". It filled the
        console with duplicate-key errors, and it is why pressing Taken broke
        the deck: removing a card re-runs reconciliation, and reconciliation
        against colliding sibling keys has no defined result.

        The key still changes with the pick, which is what re-runs the swap
        animation; it just no longer collides with its own sibling.
      */}
      <div key={`${pick.ref}:head`} className={`rf-head ${dir < 0 ? 'rf-swap-back' : 'rf-swap-fwd'} flex min-w-0 flex-col`}>
      <div className="flex items-baseline gap-2">
        <span className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
          {KIND_LABEL[pick.kind]}
        </span>
      </div>

      <p className="eyebrow mt-3" style={{ color: 'var(--text-faint)' }}>
        {pick.verb}
      </p>
      <h3
        className="rf-subject mt-1 font-[family-name:var(--font-title)] leading-tight tracking-[0.03em]"
        style={{ color: 'var(--color-orokin-200)' }}
      >
        {pick.subject}
      </h3>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-2">
        <span className="rf-figure numeric leading-none" style={{ color: 'var(--color-tenno-200)' }}>
          {pick.value.toLocaleString()}
        </span>
        <Meta>{pick.unit}</Meta>
      </div>

      <p className="wf-note mt-2">
        costs {pick.cost}
      </p>

      <p className="wf-prose mt-2">
        {pick.why}
      </p>
      </div>

      {/* Sixty milliseconds behind the head, so the card re-deals rather than
          jumping as one block. Any longer and the two halves read as two
          separate events instead of one card changing. */}
      <div
        key={`${pick.ref}:detail`}
        className={`rf-detail ${dir < 0 ? 'rf-swap-back' : 'rf-swap-fwd'} flex min-w-0 flex-col`}
        style={{ animationDelay: '60ms' }}
      >
        <Needs needs={pick.needs} />
        {open && <Working facts={pick.facts} />}
        {/* And under the working, the next "how do you know" - only for the
            kinds that name a tradeable item. A route has no market page, and a
            link to nothing is worse than no link. */}
        {open && pick.slug !== undefined && <Evidence slug={pick.slug} />}
        {open && pick.table !== undefined && <RewardTable rows={pick.table} />}
      </div>

      {pick.where !== null && (
        <p className="eyebrow mt-2" style={{ color: 'var(--color-signal-good)' }}>
          {pick.where}
        </p>
      )}

      <div className="rf-foot mt-auto pt-3">
        {pick.say !== null && (
          <div className="flex flex-wrap items-center gap-2">
            <code
              className="numeric min-w-0 flex-1 truncate px-2.5 py-1.5 text-[length:var(--text-nano)]"
              style={{ clipPath: CHAMFER, background: 'oklch(0 0 0 / 0.34)', color: 'var(--text)' }}
            >
              {pick.say}
            </code>
            <button
              type="button"
              onClick={() => {
                onCopy(pick.say ?? '');
              }}
              className="rf-act rf-clipped mo-field mo-lift mo-focusable eyebrow shrink-0 cursor-pointer px-2.5 py-1.5"
              style={{
                clipPath: CHAMFER,
                background:
                  copied === pick.say
                    ? 'oklch(0.30 0.09 150 / 0.4)'
                    : copyFailed === pick.say
                      ? 'oklch(0.32 0.10 60 / 0.4)'
                      : 'oklch(1 0 0 / 0.05)',
                color:
                  copied === pick.say
                    ? 'var(--color-signal-good)'
                    : copyFailed === pick.say
                      ? 'var(--color-signal-warn)'
                      : 'var(--text-muted)',
              }}
            >
              {copied === pick.say ? 'Copied' : copyFailed === pick.say ? 'Select it instead' : 'Copy'}
            </button>
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onMark(pick.ref, 'done');
            }}
            /* The one button on the card that gets the sheen. It is the commit,
               and a light that follows the cursor across exactly one control is
               a hierarchy; the same light on all five is a texture. */
            className="rf-act rf-clipped mo-field mo-lift mo-sheen mo-focusable cursor-pointer px-4 py-1.5 text-[length:var(--text-nano)] tracking-[0.18em] uppercase"
            style={{ clipPath: CHAMFER, background: 'oklch(0.34 0.07 235 / 0.55)', color: 'var(--text)' }}
          >
            Taken
          </button>
          <button
            type="button"
            onClick={() => {
              onMark(pick.ref, 'skipped');
            }}
            className="rf-act rf-clipped mo-field mo-lift mo-focusable eyebrow cursor-pointer px-2.5 py-1.5"
            style={{ clipPath: CHAMFER, background: 'oklch(1 0 0 / 0.04)', color: 'var(--text-muted)' }}
          >
            Not this
          </button>
          {/*
            THE DISCLOSURE IS A REAL CONTROL.
            `aria-expanded` was on the card's own `role="group"`, which does not
            support it - so the state was announced to nothing. A group is a
            container, not a thing that opens. The button below is the thing
            that opens, it carries the state, and it gives the keyboard a named
            control instead of a bare key binding nobody can discover.
          */}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              setOpen((v) => !v);
            }}
            className="rf-act rf-clipped mo-field mo-lift mo-focusable eyebrow cursor-pointer px-2.5 py-1.5"
            style={{ clipPath: CHAMFER, background: 'oklch(1 0 0 / 0.04)', color: 'var(--text-muted)' }}
          >
            {open ? 'Hide the working' : 'Show the working'}
          </button>
          {/*
            THE RUNNERS-UP, REACHABLE.
            This is the control that stopped the panel throwing its own work
            away. It is a real button with a real label saying what is behind
            and how far in you are, not an arrow nobody can interpret.
          */}
          {chain.length > 1 && (
            <button
              type="button"
              onClick={() => {
                step(1);
              }}
              /* mo-magnet rather than mo-lift, and the difference is the
                 point: this is the control that MOVES the stack, so it leans
                 toward the cursor instead of rising off the plate like the
                 buttons that only commit. Two responses, two meanings. */
              className="rf-act rf-clipped mo-field mo-magnet mo-focusable eyebrow cursor-pointer px-2.5 py-1.5"
              style={{ clipPath: CHAMFER, background: 'oklch(1 0 0 / 0.04)', color: 'var(--color-orokin-300)' }}
            >
              {behind > 0
                ? `${String(behind)} more of this kind`
                : `back to the best of ${String(chain.length)}`}
            </button>
          )}
          <Meta>
            {chain.length > 1
              ? `${String(at + 1)} of ${String(chain.length)} — pull it sideways to reorder, up and down for the rest`
              : 'pull it sideways to reorder'}
          </Meta>
        </div>
      </div>
      </div>
    </div>
  );
}

export function Dispatch({
  slots,
  progress,
  order,
  onReorder,
  onMark,
  onReset,
  tradesLeft,
  session,
  pricing,
}: {
  slots: readonly Slot[];
  progress: Progress;
  /**
   * The player's own arrangement of the deck, by kind.
   *
   * A PREFERENCE, not a layout: kinds named here keep the order the player put
   * them in, everything else keeps the app's. See `src/ui/ordering.ts` for why
   * storing positions instead would scramble on the next re-rank.
   */
  order: Order;
  onReorder: (next: Order) => void;
  onMark: (ref: string, state: StepState) => void;
  /** Bring back everything waved away today, or one thing by its ref. */
  onReset: (ref?: string) => void;
  tradesLeft: number | null;
  /** Where the session length came from, or null when never measured. */
  session: string | null;
  /**
   * How the pricing pass is going, or null when it has finished.
   *
   * Without it this surface said "nothing outstanding" while the quotes were
   * still arriving - a claim of completeness made in the middle of the work,
   * and the one moment a player is most likely to conclude the panel is
   * broken. An empty deck during a pass and an empty deck after one are
   * different facts.
   */
  pricing: { stage: string; done: number; total: number } | null;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  /**
   * A copy that did not happen has to say so.
   *
   * The failure path was a silent catch on the theory that the line is on
   * screen and can be selected by hand - but the button had already said
   * nothing, so the player's only signal was that the label did not change,
   * which is indistinguishable from not having clicked.
   */
  const [copyFailed, setCopyFailed] = useState<string | null>(null);

  const copy = (text: string): void => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopyFailed(null);
        setCopied(text);
      })
      .catch(() => {
        setCopied(null);
        setCopyFailed(text);
      });
  };

  /*
   * A KIND SURVIVES UNTIL EVERY CANDIDATE IN IT IS DEALT WITH.
   *
   * This used to read the lead alone: mark it, and the whole kind left the
   * deck, taking every ranked alternate behind it with it. Five cards became
   * two after a few taps and the panel looked like it had run out of ideas
   * while still holding a list it had just computed. The chain is what is left
   * of a kind, in order, and only an empty one drops out.
   */
  const chains = slots.flatMap((s) => {
    if (!('pick' in s)) return [];
    const left = [s.pick, ...s.alternates].filter((p) => progress[p.ref] === undefined);
    const lead = left[0];
    // Carrying the kind and the lead explicitly rather than reaching into
    // left[0] downstream: it is what the card is keyed by, and a key that falls
    // back to an array index would remount the whole stack on a re-rank.
    return lead === undefined ? [] : [{ kind: s.kind, lead, picks: left }];
  });

  /*
   * WHAT YOU CAN DO NOW COMES FIRST.
   *
   * The five kinds are otherwise in a fixed order, because ranking them against
   * each other would need an exchange rate between a trade, an hour, a day's
   * standing and a relic, and no such rate exists that is not invented. This is
   * not that: being short of the platinum a purchase needs is not a smaller
   * payoff, it is a thing you cannot do at all this minute, and it belongs
   * after the things you can. Within each group the kind order is untouched.
   */
  const rank = (p: Pick): number => {
    const d = doableNow(p);
    return d === true ? 0 : d === null ? 1 : 2;
  };
  /*
   * THE APP RANKS, THEN THE PLAYER REARRANGES.
   *
   * Two orderings, applied in that sequence and not merged. The app's is a
   * fact about what can be done now; the player's is a statement about what
   * they intend to do, and it has to win where the two disagree - otherwise
   * dragging a card would work until the next price landed and then quietly
   * undo itself.
   *
   * `arrange` only pins kinds the player actually moved. Everything untouched
   * keeps the app's order, so rearranging one card never scrambles the rest.
   */
  const ranked = [...chains].sort((a, b) => rank(a.lead) - rank(b.lead));
  const open = arrange(ranked, (c) => c.kind, order);

  const moveKind = (kind: string, delta: number): void => {
    onReorder(move(open.map((c) => c.kind), kind, delta));
  };
  const refusals = slots.flatMap((s) => ('refusal' in s ? [s.refusal] : []));

  /*
   * ONE REASON, SAID ONCE.
   * ————————————————————————————————————————————
   * Five kinds refusing for the same reason printed that reason five times.
   * With no account read the screen said "the quotes are arriving now; this
   * fills itself in" twice VERBATIM, and some version of "we have not read
   * your account" eight times in one viewport - every one of them individually
   * honest, and collectively a wall that says one thing.
   *
   * Grouping by `settles` rather than by `because`: what is missing differs per
   * kind and is worth keeping, but what would FIX it is the actionable half,
   * and when four kinds share one fix the player has one thing to do, not four.
   *
   * The kinds are still named, so nothing is hidden - a reader still learns
   * exactly which of the five are empty and why. They just stop being told the
   * remedy once per kind.
   */
  const refusalGroups = [...new Map(refusals.map((r) => [r.settles, r.settles])).keys()].map((settles) => ({
    settles,
    of: refusals.filter((r) => r.settles === settles),
  }));
  /*
   * The remedy that unblocks the most kinds, and whether there is anything at
   * all to recommend. `refusals.length === slots.length` is the deck's own
   * verdict - a slot carries either a pick or a refusal and never both.
   */
  const allRefused = refusals.length === slots.length && slots.length > 0;
  const lead = refusalGroups.reduce<{ settles: string; of: readonly Refusal[] } | null>(
    (best, g) => (best === null || g.of.length > best.of.length ? g : best),
    null,
  );

  const dealt = slots.reduce(
    (n, s) => (!('pick' in s) ? n : n + [s.pick, ...s.alternates].filter((p) => progress[p.ref] !== undefined).length),
    0,
  );
  /* Every suggestion still standing, not just the five face up. This is the
     number the header had no way to say before, and it is the honest size of
     what the panel is holding. */
  const standing = chains.reduce((n, c) => n + c.picks.length, 0);

  /*
   * WHAT THE FACE-UP CARDS TAKE FROM EACH OTHER.
   * ————————————————————————————————————————————
   * Computed over the LEADS only, because those are the five things being
   * proposed. Pooling the alternates too would report a conflict between two
   * suggestions that are not both on screen and that the player was never
   * asked to do together.
   */
  const contended = contention(open.map((c) => c.lead));

  /*
   * The ones taken off the deck, with enough to recognise them by. Read from
   * the slots rather than remembered separately, so a card restored by the
   * global reset cannot linger here as a ghost.
   */
  const dealtList = slots.flatMap((s) =>
    'pick' in s
      ? [s.pick, ...s.alternates].flatMap((p) => {
          const state = progress[p.ref];
          return state === undefined ? [] : [{ ref: p.ref, subject: p.subject, state }];
        })
      : [],
  );
  /*
   * Two totals, because one of them was a claim.
   *
   * "232 platinum across the trades here" counted cards the player is short
   * for - money they cannot collect today at all. The second figure is the part
   * that is actually within reach, and when the two differ the difference is
   * the most useful number on the header.
   */
  const tradeValue = (p: Pick): number => (p.kind === 'run' || p.kind === 'relic' ? 0 : p.value);
  /*
   * The totals count the FACE-UP card of each kind and no more.
   *
   * Summing the alternates too would be the same error the reachable/total
   * split exists to fix, one level up: the alternates of a kind are mutually
   * exclusive with its lead - a stack of four sales is four ways to spend the
   * same trade, not four trades - so adding them would invent platinum.
   */
  const total = open.reduce((n, c) => n + tradeValue(c.lead), 0);
  const reachable = open.reduce((n, c) => n + (doableNow(c.lead) === false ? 0 : tradeValue(c.lead)), 0);

  return (
    <section className="flex flex-col gap-3">
      <style>{`
        /*
          TYPED CUSTOM PROPERTIES.
          Without @property these are strings the engine cannot interpolate, so
          the light would jump between pointer events instead of gliding. They
          are also what lets the resting transition below animate at all.
        */
        /*
          THE STACK RAIL.
          Sits under the top edge, inset past the chamfer so it never crosses
          the cut corner. Segments are equal width so the rail reads as a
          measure of the whole kind rather than a progress bar - it is a
          position, not a completion.
        */
        .rf-depth {
          position: absolute;
          top: 7px;
          right: 14px;
          display: flex;
          gap: 3px;
          pointer-events: none;
        }
        .rf-depth i {
          width: 12px;
          height: 2px;
          background: oklch(1 0 0 / 0.16);
          transform-origin: center;
          /*
            THE RAIL IS WHERE THE STEP IS ACKNOWLEDGED FIRST.

            Which segment is lit was a hard cut: the class moved and the gold
            appeared somewhere else on the next frame, so nothing on screen
            connected the segment you left to the one you arrived at, and at
            twelve pixels wide a colour change alone is easy to miss entirely.

            The lit one now also swells, on the spring curve, which is the
            house move for something the player caused directly. It is a
            transition rather than a keyframe on purpose: a transition caught
            by a frozen timeline is stranded BETWEEN two states that are both
            perfectly visible, which is the one kind of interpolation this
            overlay can afford to leave halfway.
          */
          transition:
            transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1),
            background-color 160ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .rf-depth i.rf-depth-on { background: var(--color-orokin-300); transform: scaleY(2.5); }

        @property --px { syntax: '<percentage>'; inherits: false; initial-value: 50%; }
        @property --py { syntax: '<percentage>'; inherits: false; initial-value: 0%; }
        @property --tx { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
        @property --ty { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
        @property --dx { syntax: '<length>'; inherits: false; initial-value: 0px; }
        @property --pull { syntax: '<number>'; inherits: false; initial-value: 0; }
        /* These two are read by the edge elements INSIDE the card, so they
           have to inherit. Registered with inherits:false they resolved to
           their initial 0 on the children and the threshold never lit, while
           the gesture itself worked perfectly - a failure that is invisible
           in the source and obvious the moment the pixels are measured. */
        @property --take { syntax: '<number>'; inherits: true; initial-value: 0; }
        @property --drop { syntax: '<number>'; inherits: true; initial-value: 0; }

        /*
          A COMPOSITION, NOT A SEQUENCE.

          Five equal rectangles in an auto-fit grid is a list wearing cards. The
          eye has no reason to land anywhere, so it lands nowhere and reads all
          five - which is the work this surface exists to remove. It also made
          every card the same size regardless of how much it had to say, so the
          one with a full requirement breakdown and the one with a single line
          got identical boxes.

          The lead takes two columns and two rows. Not because it outranks the
          others - the five kinds answer different questions and cannot be
          ranked against each other - but because SOMETHING has to be the
          subject of a picture, and the sensible subject is the first thing you
          can actually act on. The other four are equal to each other, which is
          the arrangement the five kinds actually have.

          At one column the span collapses and the deck is a stack again, in the
          same order. Nothing is lost on a narrow overlay.
        */
        .rf-deck {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
          gap: 10px;
          /* The z axis is real: without perspective on the container the tilt
             below is an affine shear and reads as a glitch, not as an object. */
          perspective: 1100px;
        }
        @media (min-width: 62rem) {
          /*
            THREE COLUMNS, AND THE LEAD TAKES TWO OF THEM.

            A first attempt spanned two rows as well, and it was worse than the
            grid it replaced: a card twice as tall as its content is a hole with
            a border, and the lead ended up 1195px tall around 300px of text.
            Height has to come from what a card has to say, so nothing spans a
            row and align-items:start stops the row stretching them to match.

            Two of three columns, with five cards, fills exactly: the lead and
            one card on the first row, three on the second. Dense packing keeps that
            true as cards are dealt with and the count falls.
          */
          .rf-deck {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            grid-auto-flow: dense;
            align-items: start;
          }
          .rf-lead { grid-column: span 2; }
        }

        /*
          THE CARD RESPONDS TO ITS OWN WIDTH, NOT THE WINDOW'S.

          This is what makes the span above a composition instead of a stretched
          box. The lead card is twice as wide as its neighbours in the same
          viewport, so a media query cannot tell them apart - only the element
          itself knows how much room it got. Given the room, it sets its number
          at hero size and lets the supporting lines breathe; denied it, the
          same component stays compact. One card, correct in both places, with
          no variant to keep in sync.
        */
        .rf-card { container-type: inline-size; }
        /*
          The base sizes live HERE, not in a style attribute.

          They were inline, and an inline style beats every stylesheet rule
          including a container query - so the query below matched, computed,
          and lost silently. The lead card sat at the same size as its
          neighbours with the rule that was meant to enlarge it applying
          correctly and being overridden. Nothing in the source looked wrong.
        */
        .rf-figure { font-size: var(--text-title); }
        .rf-subject { font-size: var(--text-lead); }
        @container (min-width: 28rem) {
          .rf-figure { font-size: var(--text-hero); }
          .rf-subject { font-size: var(--text-title); }
          .rf-body { padding: 1.5rem 1.5rem 1.25rem; }

          /*
            GIVEN THE WIDTH, USE IT.

            A wide card laying its content in one narrow column left three
            hundred pixels of nothing down its right side - the same defect as
            the two-row span, turned ninety degrees. The instruction goes left,
            what it requires and what it rests on goes right, and the line you
            send plus the controls run full width underneath. Same component,
            same markup order, one rule.
          */
          /*
            A CONTAINER CANNOT STYLE ITSELF.

            rf-body was the same element as rf-card, which carries
            container-type - so this rule matched the nearest ANCESTOR container
            instead and never applied to the card at all. The descendants inside
            it (the figure, the subject) resized correctly, which made it look
            like the query was working. It was; it simply could not reach the
            one element that declared the container. The body is now the card's
            child, and the grid lands.
          */
          .rf-body {
            display: grid;
            grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
            grid-template-areas: 'head detail' 'foot foot';
            align-content: start;
            column-gap: 1.75rem;
          }
          .rf-head { grid-area: head; }
          .rf-detail { grid-area: detail; }
          .rf-foot { grid-area: foot; }
          /* The hairline stops being a horizontal rule and becomes the seam
             between the two columns, which is what it is at this width. */
          .rf-detail { border-left: 1px solid var(--hairline); padding-left: 1.5rem; }
        }

        .rf-card {
          --px: 50%; --py: 0%; --tx: 0deg; --ty: 0deg; --dx: 0px; --pull: 0; --take: 0; --drop: 0;
          touch-action: pan-y;
          cursor: grab;
          transform-style: preserve-3d;
          transform:
            translate3d(var(--dx), 0, 0)
            rotateY(var(--tx))
            rotateX(var(--ty));
          background:
            radial-gradient(
              42% 62% at var(--px) var(--py),
              oklch(from var(--color-orokin-300) l c h / calc(0.10 + var(--pull) * 0.14)),
              transparent 70%
            ),
            linear-gradient(168deg, oklch(0.17 0.026 268 / 0.94), oklch(0.11 0.022 275 / 0.96));
          box-shadow: inset 0 0 0 1px oklch(1 0 0 / 0.045);
        }
        .rf-card:active { cursor: grabbing; }

        /*
          THE SUBJECT IS MADE OF SOMETHING ELSE.

          Size alone was carrying the whole distinction: five plates of exactly
          the same material, one of them larger. That reads as a zoom, not as a
          hierarchy - and a picture whose subject is only bigger is a picture
          without a subject.

          One move, spent here and nowhere else: the lead is lit along its top
          edge in the app's gold, the colour derived from the token in oklch
          rather than pasted, so it follows the theme rather than freezing a hex
          beside it. The four supporting cards keep the plain plate. That is the
          whole of the difference in material, and it is enough because nothing
          else on the deck is competing for it.
        */
        .rf-lead {
          background:
            radial-gradient(
              42% 62% at var(--px) var(--py),
              oklch(from var(--color-orokin-300) l c h / calc(0.12 + var(--pull) * 0.14)),
              transparent 70%
            ),
            linear-gradient(
              to bottom,
              oklch(from var(--color-orokin-400) l c h / 0.09),
              transparent 38%
            ),
            linear-gradient(168deg, oklch(0.185 0.03 268 / 0.95), oklch(0.115 0.024 275 / 0.97));
          box-shadow:
            inset 0 1px 0 0 oklch(from var(--color-orokin-300) l c h / 0.35),
            inset 0 0 0 1px oklch(1 0 0 / 0.05);
        }

        /*
          TRACKING IS INSTANT. SETTLING IS THE ONLY TIMED THING HERE.

          A transition on the tracked properties would be a mistake twice over:
          it puts lag between the pointer and the light, which is exactly what
          makes a tilt feel like a video rather than an object; and it makes the
          motion time-based again, which is the thing this file is built to
          avoid. So there is no transition at all while a pointer is on the
          card - every frame is the pointer's current position, full stop.

          The settle class is added only as the pointer leaves, so the one timed
          animation in this file starts from a card that is already on screen
          and fully readable. A frozen timeline strands it a couple of degrees
          off level, which is a cosmetic difference and never a hidden card.
        */
        .rf-card.rf-settle {
          transition:
            --tx 260ms cubic-bezier(0.16, 1, 0.3, 1),
            --ty 260ms cubic-bezier(0.16, 1, 0.3, 1),
            --dx 260ms cubic-bezier(0.16, 1, 0.3, 1);
        }

        /* The two edges a card can be pulled toward. */
        .rf-edge { position: absolute; top: 0; bottom: 0; width: 3px; pointer-events: none; }
        .rf-edge-take { right: 0; background: var(--color-orokin-300); opacity: var(--take); }
        .rf-edge-drop { left: 0; background: var(--color-orokin-300); opacity: var(--drop); }

        /* TRANSFORM ONLY for the entrance, per this project's oldest rule: the
           document timeline can stop at frame zero and never advance, so an
           entrance that begins hidden stays hidden for ever. */
        @keyframes rf-deal { from { transform: translate3d(0, 10px, 0); } to { transform: none; } }
        @keyframes rf-open-in { from { transform: translate3d(-6px, 0, 0); } to { transform: none; } }
        .rf-open { animation: rf-open-in 240ms cubic-bezier(0.16, 1, 0.3, 1) backwards; }
        .rf-card { animation: rf-deal 420ms cubic-bezier(0.16, 1, 0.3, 1) backwards; }

        /*
          STEPPING THE STACK, WITH A DIRECTION.

          The one timed thing this file gained, and it is timed because there is
          nothing continuous to drive it from - a step is a discrete event, not
          a pointer position, so there is no input to read a frame off. That
          puts it under the entrance rule rather than the input-driven
          exemption, so it is TRANSFORM ONLY like everything else here: a frozen
          timeline leaves the new candidate fourteen pixels from home and
          entirely readable, which is exactly the failure mode this project
          insists on.

          Forward brings the next candidate up from under the one it replaced;
          back brings the previous one down from above it. The two directions
          are the whole point - without them a step in and a step out are the
          same event, and overshooting the stack has no visible undo.
        */
        @keyframes rf-swap-fwd { from { transform: translate3d(0, 14px, 0); } to { transform: none; } }
        @keyframes rf-swap-back { from { transform: translate3d(0, -14px, 0); } to { transform: none; } }
        .rf-swap-fwd { animation: rf-swap-fwd 300ms cubic-bezier(0.16, 1, 0.3, 1) backwards; }
        .rf-swap-back { animation: rf-swap-back 300ms cubic-bezier(0.16, 1, 0.3, 1) backwards; }

        /*
          THE TRANSITION LIST IS WHAT LETS THE SHARED VOCABULARY IN.

          These buttons wear mo-lift, mo-magnet and mo-sheen from the motion
          layer, and every one of those effects is driven by --mo-on, which
          motion.css transitions in a rule this one overrides: a class in a
          <style> tag in the body beats a class in an imported stylesheet on
          document order alone. Dropping --mo-on from the list does not break
          the effects, it makes them SNAP - the property jumps 0 to 1 on the
          first pointer event and the lift arrives with no travel at all, which
          looks like a rendering fault rather than a decision. Naming it here,
          faster than the layer's default because these are small controls,
          keeps the glide and keeps the local colours.
        */
        .rf-act {
          /*
           * A 24px FLOOR ON THE TARGET, not on the text.
           *
           * These sat at 21.2px tall - the label's own line box - so every
           * action under a suggestion was a control a thumb could miss. The
           * same floor was already applied to rf-disc-more for the same
           * reason; it simply never reached here. The text keeps its size and
           * the hit area grows underneath it.
           *
           * No backticks in here: this CSS lives inside a template literal, so
           * one would end the string. That is what the first attempt did.
           */
          min-height: 24px;
          transition:
            background-color 140ms ease-out,
            color 140ms ease-out,
            transform 140ms cubic-bezier(0.16, 1, 0.3, 1),
            --mo-on 140ms cubic-bezier(0.16, 1, 0.3, 1);
        }

        @media (prefers-reduced-motion: reduce) {
          /*
             The entrance, the tilt, the settle and the swap all go. The DRAG
             stays. Reduced motion is about movement the viewer did not ask for;
             a card that refuses to follow the finger dragging it is not calmer,
             it is broken, and it would leave the gesture with no feedback at
             all.

             The depth rail keeps its COLOUR and loses its swell: which segment
             is lit is information, and removing motion must never remove the
             only signal saying where in the stack you are.
          */
          .rf-open, .rf-swap-fwd, .rf-swap-back { animation: none; }
          .rf-card, .rf-card.rf-settle {
            animation: none;
            transition: none;
            transform: translate3d(var(--dx), 0, 0);
          }
          .rf-act { transition: none; }
          .rf-depth i { transition: none; transform: none; }
          .rf-depth i.rf-depth-on { transform: none; }
        }
      `}</style>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
          Do any of these now
        </span>
        <Meta>
          {open.length > 0
            ? standing > open.length
              ? `${String(open.length)} open, ${String(standing)} suggestions behind them`
              : `${String(open.length)} open`
            : pricing !== null
              ? 'still working out what is worth doing'
              : refusals.length === slots.length
                ? 'nothing can be recommended yet, and each line below says why'
                : 'nothing outstanding'}
          {dealt > 0 && `, ${String(dealt)} dealt with`}
        </Meta>
        {pricing !== null && (
          <span className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
            {pricing.stage} &mdash; {String(pricing.done)} of {String(pricing.total)}
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-baseline gap-x-4">
          {total > 0 && (
            <Meta>
              {reachable === total
                ? `${total.toLocaleString()} platinum across the trades here`
                : `${reachable.toLocaleString()} of ${total.toLocaleString()} platinum here is within what you hold`}
            </Meta>
          )}
          {tradesLeft !== null && (
            <Meta>
              {String(tradesLeft)} {tradesLeft === 1 ? 'trade' : 'trades'} left
            </Meta>
          )}
          {dealt > 0 && (
            <button
              type="button"
              /* Wrapped, not passed by reference: onReset takes an optional ref
                 now, and a bare handler would hand it a MouseEvent as the thing
                 to restore. TypeScript caught it; without types this would have
                 shipped as a reset that restored nothing. */
              onClick={() => {
                onReset();
              }}
              /* A bare word with no edges of its own, so it takes the rule that
                 draws itself from wherever the pointer entered - the one effect
                 in the layer built for text that is a control. */
              className="rf-act mo-field mo-underline mo-focusable eyebrow cursor-pointer"
              style={{ color: 'var(--text-ghost)' }}
            >
              bring them back
            </button>
          )}
        </span>
      </div>

      {open.length > 0 && (
        <div className="rf-deck">
          {open.map((c, i) => (
            <Card
              /* Keyed by KIND, not by the face-up ref: the card is the kind's
                 stack, and keying by the ref would tear it down and rebuild it
                 - losing the reader's place - every time a candidate was dealt
                 with or a price re-ranked the chain. */
              key={c.kind}
              chain={c.picks}
              index={i}
              onMark={onMark}
              onMove={moveKind}
              onCopy={copy}
              copied={copied}
              copyFailed={copyFailed}
            />
          ))}
        </div>
      )}

      {/*
        THE ONE THING NO CARD CAN SAY ABOUT ITSELF.

        Each card checks its requirements against the account and each check is
        right. The budgets are shared, though - selling and completing both
        spend trades, and the daily count is set by Mastery Rank - so two cards
        can each report "you have enough" while doing both is impossible.

        Stated once, above the deck, naming the budget and what it is short by.
        It is deliberately not repeated on the cards: the shortfall belongs to
        the COMBINATION, and putting it on either card would blame one of them
        for a fact about the pair.
      */}
      {contended.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {contended.map((c) => (
            <li
              key={c.what}
              className="rf-lit flex flex-wrap items-baseline gap-x-2 px-3 py-1.5"
              style={{ clipPath: CHAMFER, background: 'oklch(0.32 0.10 60 / 0.16)' }}
            >
              <span className="eyebrow shrink-0" style={{ color: 'var(--color-signal-warn)' }}>
                Not both
              </span>
              <span className="text-[length:var(--text-nano)]" style={{ color: 'var(--text)' }}>
                {`${c.claims.map((x) => KIND_LABEL[x.kind].toLowerCase()).join(' and ')} together want ${String(c.wanted)}`}
                {c.unit === '' ? '' : ` ${c.unit}`}
                {`, and you have ${String(c.have)}`}
              </span>
              {/*
                THE ANSWER, NOT JUST THE CONFLICT.

                Naming a clash and leaving the reader to work it out is the
                same failure as handing them a ranked list: the work moved, it
                did not get done. Where the claimants can be compared in the
                budget's own units the panel says which to do first; where they
                cannot - a route paying per hour competing for trades - it says
                so instead of inventing an exchange rate.
              */}
              {c.first !== null ? (
                <span className="text-[length:var(--text-nano)]" style={{ color: 'var(--color-signal-good)' }}>
                  {`do ${KIND_LABEL[c.first].toLowerCase()} first`}
                  {c.after.length > 0 &&
                    ` — ${c.after.map((k) => KIND_LABEL[k].toLowerCase()).join(' and ')} will not fit after it`}
                </span>
              ) : (
                <span className="text-[length:var(--text-nano)]" style={{ color: 'var(--text-faint)' }}>
                  each one fits on its own; which is worth more depends on a rate this app will not invent
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/*
        WHAT YOU DEALT WITH, AND HOW TO GET IT BACK.
        ————————————————————————————————————————————
        A card used to leave the deck and that was the whole story: the only
        way back was one button at the top that restored EVERYTHING, so undoing
        a single mistaken tap meant also undoing every deliberate one. A removal
        the player cannot reverse in place is a removal they have to be careful
        about, and being careful is not something a suggestion panel should ask
        for.

        Each one now leaves its name and its own undo where it went.
      */}
      {dealtList.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {dealtList.map((d) => (
            <li key={d.ref} className="flex flex-wrap items-baseline gap-x-2 px-1">
              <span className="eyebrow shrink-0" style={{ color: 'var(--text-ghost)' }}>
                {d.state === 'done' ? 'taken' : 'passed'}
              </span>
              <span className="text-[length:var(--text-nano)]" style={{ color: 'var(--text-faint)' }}>
                {d.subject}
              </span>
              <button
                type="button"
                onClick={() => {
                  onReset(d.ref);
                }}
                className="rf-act mo-underline mo-field eyebrow ml-auto shrink-0 cursor-pointer"
                style={{ color: 'var(--color-orokin-300)' }}
              >
                put it back
              </button>
            </li>
          ))}
        </ul>
      )}

      {/*
        The kinds with nothing to offer, kept and stated.
        A refusal is not an empty slot: "no set is within two parts" and "the
        quotes have not arrived" are different facts, and a player who cannot
        see which one applies will assume the panel simply has nothing.
      */}
      {/*
        NOTHING TO OFFER AT ALL IS ONE SENTENCE, NOT NINE.
        ————————————————————————————————————————————
        Grouping by `settles` was the right fix for the case it was written for
        - two or three kinds empty while the others carry the panel - and it is
        the wrong shape for the case that happens on EVERY launch before the
        game has been run once, which is all five refusing at the same time.
        Measured on that launch, this band emitted nine lines: five "what is
        missing" and four "what would fix it", every one of them honest, and
        collectively a wall that says one thing. The panel's own note on the
        subject already names the failure - "one fact wearing eight costumes".
        ————————————————————————————————————————————
        So when the deck has nothing at all, the band states the remedy that
        unblocks the MOST kinds, once, and puts the per-kind detail behind a
        door. Nothing is hidden: the door names how many are waiting and opens
        onto exactly the list that used to be printed. What changes is that a
        player who has not run the game yet reads one instruction instead of
        deciding which of four to follow first.
      */}
      {allRefused && lead !== null && (
        <div className="mo-in-left flex min-w-0 flex-col gap-1 px-1">
          <p className="wf-prose" style={{ color: 'var(--color-orokin-300)' }}>
            {lead.settles}
          </p>
          {refusals.length > lead.of.length ? (
            <Disclosure
              eyebrow="The rest of the deck"
              summary={`${String(refusals.length - lead.of.length)} more waiting on something else`}
            >
              <RefusalList groups={refusalGroups.filter((g) => g.settles !== lead.settles)} />
            </Disclosure>
          ) : (
            <span className="eyebrow" style={{ color: 'var(--text-ghost)' }}>
              {lead.of.map((r) => KIND_LABEL[r.kind]).join(' · ')}
            </span>
          )}
        </div>
      )}

      {!allRefused && refusalGroups.length > 0 && <RefusalList groups={refusalGroups} />}

      {session !== null && <Meta>{session}</Meta>}
    </section>
  );
}

/** The per-kind refusals, grouped by what would settle them. */
function RefusalList({ groups }: { groups: readonly { settles: string; of: readonly Refusal[] }[] }) {
  const refusalGroups = groups;
  return (
    <>
      {refusalGroups.length > 0 && (
        <ul className="mo-stagger flex flex-col gap-1.5">
          {refusalGroups.map((g, i) => (
            <li
              key={g.settles}
              /* Transform only, from the shared layer, so a frozen timeline
                 leaves a refusal sixteen pixels to the left and completely
                 readable. That matters more here than anywhere else on the
                 card: a refusal is the ONLY thing a player has to go on when a
                 kind is empty, so it is the last line in this panel that could
                 afford to depend on an animation having run. */
              className="mo-in-left flex min-w-0 flex-col gap-0.5 px-1"
              style={{ ['--i' as string]: String(i) }}
            >
              {g.of.map((r) => (
                <div key={r.kind} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="eyebrow shrink-0" style={{ color: 'var(--text-ghost)' }}>
                    {KIND_LABEL[r.kind]}
                  </span>
                  <span className="text-[length:var(--text-nano)]" style={{ color: 'var(--text-faint)' }}>
                    {r.because}
                  </span>
                </div>
              ))}
              {/* The remedy, once for the whole group. */}
              <span className="text-[length:var(--text-nano)]" style={{ color: 'var(--color-orokin-300)' }}>
                {g.settles}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
