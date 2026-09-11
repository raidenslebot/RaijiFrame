/**
 * Mirror the background controller's store into this window.
 *
 * Overwolf windows are independent browser contexts with independent module
 * instances, so importing the store in a panel window yields an *empty* store,
 * not the controller's. This subscribes to the controller's real store and
 * replays every change into the local one, which keeps panels as plain
 * `useAccount(...)` consumers with no cross-window plumbing of their own.
 *
 * WHY THIS RETRIES
 * ────────────────
 * The first version connected once, at module load, and if the controller was
 * not reachable in that instant it logged a warning and returned a no-op —
 * permanently. That is a race the app loses regularly: the panel window is
 * opened by a hotkey or the dock button and can finish evaluating its bundle
 * before the background window has published `codexStore`. The symptom is the
 * one that matters most — the panel renders, looks fine, and simply never
 * updates, no matter what happens in game.
 *
 * A panel that cannot see the account is not in a valid state to give up in, so
 * it now keeps trying until it connects.
 */

import { useAccount, backgroundStore } from '../core/store';

/** Poll interval while waiting for the controller. */
const RETRY_MS = 400;
/**
 * Give up after this long and say so.
 *
 * Not infinite: if the controller genuinely is not there — the panel opened
 * standalone, or the background window crashed — an endless silent poll hides a
 * real failure. Thirty seconds is far longer than any observed startup race.
 */
const GIVE_UP_MS = 30_000;

export function mirrorBackgroundStore(): () => void {
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  const startedAt = Date.now();

  const copy = (s: ReturnType<NonNullable<ReturnType<typeof backgroundStore>>['getState']>) => {
    useAccount.setState({
      username: s.username,
      inventory: s.inventory,
      inventoryAt: s.inventoryAt,
      answeredAt: s.answeredAt,
      highlighted: s.highlighted,
      gep: s.gep,
      gameRunning: s.gameRunning,
      liveClears: s.liveClears,
      capturedAt: s.capturedAt,
      hydrated: s.hydrated,
    });
  };

  const attempt = () => {
    if (cancelled) return;

    const remote = backgroundStore();
    if (remote) {
      // Copy the current state before subscribing: `subscribe` only fires on
      // CHANGE, so a panel that connects after the last push would otherwise
      // sit empty until the game happened to send something new.
      copy(remote.getState());
      unsubscribe = remote.subscribe(copy);
      return;
    }

    if (Date.now() - startedAt > GIVE_UP_MS) {
      console.warn(
        '[raijiframe] background controller unreachable after 30s; this window will not receive account updates',
      );
      return;
    }

    timer = setTimeout(attempt, RETRY_MS);
  };

  attempt();

  return () => {
    cancelled = true;
    if (timer !== null) clearTimeout(timer);
    if (unsubscribe !== null) unsubscribe();
  };
}
