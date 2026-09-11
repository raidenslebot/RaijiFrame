/**
 * One pointer tracker for the whole application.
 *
 * WHY THIS IS DELEGATED AND NOT A HOOK
 * ────────────────────────────────────
 * Several panels wanted a light that follows the cursor across a row, and each
 * had begun doing it the obvious way: an `onPointerMove` prop on every row,
 * measuring its own rectangle on every move. The catalog panels render eight
 * hundred rows at once, over a running game, so that is eight hundred React
 * handlers and eight hundred layout reads a second — and every panel that
 * wanted the effect had to remember to wire it.
 *
 * One listener on the document does the same job for every row that will ever
 * exist, including ones rendered later, and costs a `closest()` plus two custom
 * property writes per move.
 *
 * THE RECT IS CACHED, AND THAT IS THE WHOLE TRICK
 * ──────────────────────────────────────────────
 * Reading `getBoundingClientRect()` on every pointer move forces layout, which
 * is what makes the naive version expensive. The rectangle only changes when
 * the pointer moves to a DIFFERENT element, or when something scrolls, so it is
 * measured on those two events and reused for every move in between.
 *
 * FROZEN TIMELINE
 * ───────────────
 * Nothing here schedules a frame. A pointer move cannot happen while the
 * overlay is unpresented, and the properties this writes only feed effects that
 * decorate content already on screen — so when the timeline stops, the light
 * simply stops moving, and nothing is hidden.
 */

/**
 * Elements that want the field. `.rf-row` gets it everywhere, for free.
 *
 * `.mo-field` joins them: it is the opt-in for the motion layer's
 * pointer-driven effects, so any element can take a light, a tilt or a parallax
 * by adding one class and no JavaScript at all.
 */
const SELECTOR = '.rf-row, .rf-lit, .mo-field';

let current: HTMLElement | null = null;
let rect: DOMRect | null = null;
let attached = false;

/** Every property this writes, so leaving an element clears all of them. */
const FIELDS = ['--mx', '--my', '--mxp', '--myp', '--mdx', '--mdy'] as const;

function clear(el: HTMLElement): void {
  for (const f of FIELDS) el.style.removeProperty(f);
}

function forget(): void {
  current = null;
  rect = null;
}

function onMove(event: PointerEvent): void {
  const target = event.target;
  const el = target instanceof Element ? target.closest<HTMLElement>(SELECTOR) : null;

  if (el !== current) {
    // Clear the property on the element being left, so a stale highlight does
    // not sit frozen in the middle of a row nobody is pointing at.
    if (current) clear(current);
    current = el;
    rect = el ? el.getBoundingClientRect() : null;
  }

  if (!el || !rect) return;
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  el.style.setProperty('--mx', `${String(Math.round(x))}px`);
  el.style.setProperty('--my', `${String(Math.round(y))}px`);

  /*
   * THE SAME MEASUREMENT, IN THE THREE SHAPES EFFECTS ACTUALLY WANT.
   *
   * Pixels are the wrong unit for most of what this feeds. A light that follows
   * the cursor wants a PERCENTAGE, because a gradient stop is a percentage and
   * converting in CSS needs the element's width, which CSS cannot read. A tilt
   * or a parallax wants a SIGNED FRACTION from the centre, because that is what
   * multiplies cleanly into an angle or an offset.
   *
   * Deriving them here costs two divisions on a rectangle that is already
   * cached and in hand. Deriving them in each effect would mean every effect
   * needing the element's size, which is the layout read this file exists to
   * avoid.
   *
   * A zero-sized element is skipped rather than divided by: it would produce
   * Infinity, and an Infinity in a transform silently kills the whole rule.
   */
  if (rect.width === 0 || rect.height === 0) return;
  const fx = x / rect.width;
  const fy = y / rect.height;
  el.style.setProperty('--mxp', `${(fx * 100).toFixed(1)}%`);
  el.style.setProperty('--myp', `${(fy * 100).toFixed(1)}%`);
  el.style.setProperty('--mdx', (fx * 2 - 1).toFixed(3));
  el.style.setProperty('--mdy', (fy * 2 - 1).toFixed(3));
}

/**
 * Start tracking. Idempotent, so a re-mounting shell cannot stack listeners.
 *
 * Returns a teardown for the caller's effect. Scroll and resize drop the cached
 * rectangle rather than recomputing it: the next move will measure, and there
 * may not be a next move.
 */
export function trackPointer(): () => void {
  if (attached || typeof document === 'undefined') return () => undefined;
  attached = true;

  document.addEventListener('pointermove', onMove, { passive: true });
  // Capture, because the scroll that matters is usually an inner pane's.
  document.addEventListener('scroll', forget, { passive: true, capture: true });
  window.addEventListener('resize', forget, { passive: true });

  return () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('scroll', forget, { capture: true });
    window.removeEventListener('resize', forget);
    forget();
    attached = false;
  };
}
