/**
 * DEEP NAVIGATION.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The app is thirteen panels that barely reference each other. Switching to a
 * panel is possible; arriving AT something inside it is not. So a quest that
 * names a star-chart node, a mastery row that names an item, a fissure that
 * names a mission — all of them dead ends, because there was no way to say
 * "go to the star chart AND select Gradivus".
 *
 * That single missing verb is most of why the app feels shallow: every screen is
 * a terminus. This makes every named thing in the app a place you can go.
 *
 * WHY AN EVENT AND NOT A ROUTER OR A CONTEXT
 * ──────────────────────────────────────────
 * The panels are lazily-loaded leaves that know nothing about the shell and have
 * no business knowing. A context would force every one of them to be wrapped and
 * re-rendered on navigation; a router would be a large dependency for an overlay
 * with no URLs. An event is one line at each end, costs nothing when unused, and
 * lets a panel opt in to exactly the focus kinds it can honour.
 *
 * THE CONTRACT
 * ────────────
 * The shell listens for `raijiframe:navigate` and switches panels. The target
 * panel — which may not have been mounted when the event fired — reads the
 * PENDING focus on mount and clears it. That handoff is the whole subtlety here:
 * a lazily-loaded panel cannot receive an event sent before its chunk resolved,
 * so the request has to outlive the event.
 */

export type FocusKind =
  /** A star chart node id, e.g. `SolNode30`. */
  | 'node'
  /** A planet name, e.g. `Mars`. */
  | 'planet'
  /** A quest id from the quest log. */
  | 'quest'
  /** An item's display name, as the catalogs key it. */
  | 'item'
  /** A resource's display name. */
  | 'resource';

export interface FocusRequest {
  kind: FocusKind;
  id: string;
  /** For display while the target panel loads. */
  label?: string;
}

export interface NavigateDetail {
  panel: string;
  focus?: FocusRequest;
}

export const NAVIGATE_EVENT = 'raijiframe:navigate';

/**
 * The focus request waiting to be claimed.
 *
 * Module-level rather than passed through the event, because the panel that
 * needs it usually does not exist yet: the shell switches to it, React suspends
 * on its chunk, and by the time it mounts the event is long gone. Whoever claims
 * it clears it, so a request is honoured exactly once and a later remount of the
 * same panel does not re-trigger a stale jump.
 */
let pending: FocusRequest | null = null;

/** Navigate to a panel, optionally asking it to focus something. */
export function navigate(panel: string, focus?: FocusRequest): void {
  pending = focus ?? null;
  window.dispatchEvent(new CustomEvent<NavigateDetail>(NAVIGATE_EVENT, { detail: { panel, ...(focus ? { focus } : {}) } }));

  /*
   * Deliver to any listener already mounted, after the shell has committed.
   *
   * Deferred rather than synchronous so the panel switch has landed first — a
   * listener that scrolls to a row needs that row to exist. If a listener takes
   * it, `pending` is consumed and the panel's own mount-time subscription will
   * correctly find nothing left to do.
   *
   * A TIMER, NOT requestAnimationFrame. This used rAF, and rAF does not fire
   * while the overlay is not presented - the same frozen timeline every
   * entrance in this app is built around. Measured: a deep link to a quest
   * while Progression was already open did nothing at all, while the identical
   * link from another panel (delivered on mount, synchronously) worked. The
   * timer fires whether or not a frame ever will.
   */
  if (focus === undefined) return;
  setTimeout(() => {
    for (const l of listeners) {
      if (!l.kinds.includes(focus.kind)) continue;
      const req = claimFocus(...l.kinds);
      if (req === null) return;
      l.fn(req);
      return;
    }
  }, 0);
}

/**
 * Claim the pending focus request, if it is one this panel can honour.
 *
 * Returns null when there is nothing pending or the pending request is for a
 * different kind — so two panels that both listen cannot steal each other's.
 */
export function claimFocus(...kinds: FocusKind[]): FocusRequest | null {
  if (pending === null) return null;
  if (!kinds.includes(pending.kind)) return null;
  const req = pending;
  pending = null;
  return req;
}

/* ------------------------------------------------------------- subscription */

type FocusListener = (req: FocusRequest) => void;
const listeners = new Set<{ kinds: FocusKind[]; fn: FocusListener }>();

/**
 * Subscribe to focus requests this panel can honour.
 *
 * Preferred over calling `claimFocus` in an effect body, for two reasons.
 *
 * CORRECTNESS: a one-shot claim on mount only works when the panel was NOT
 * already mounted. Search for a star chart node while already looking at the
 * star chart and the panel never re-mounts, so the request is never claimed and
 * the jump silently does nothing. A subscription is delivered either way.
 *
 * SHAPE: it puts the resulting setState inside a subscription callback, which is
 * what an effect is actually for — synchronising React with an external system —
 * rather than a synchronous cascade in the effect body.
 *
 * Fires immediately for a request that is already pending, so a panel that
 * mounts after the navigation still receives it. Either path consumes it.
 */
export function subscribeFocus(kinds: FocusKind[], fn: FocusListener): () => void {
  const entry = { kinds, fn };
  listeners.add(entry);

  // Deliver a request that arrived before this panel existed.
  const req = claimFocus(...kinds);
  if (req !== null) fn(req);

  return () => {
    listeners.delete(entry);
  };
}

/**
 * Which panel owns a given kind of thing.
 *
 * One place, so a caller only has to know WHAT it is pointing at, never where
 * that lives. Adding a panel does not mean auditing every call site.
 */
export const PANEL_FOR: Readonly<Record<FocusKind, string>> = {
  node: 'starchart',
  planet: 'starchart',
  quest: 'progression',
  item: 'collection',
  resource: 'resources',
};

/** Go to whatever owns this thing, and focus it. */
export function goTo(kind: FocusKind, id: string, label?: string): void {
  navigate(PANEL_FOR[kind], { kind, id, ...(label !== undefined ? { label } : {}) });
}
