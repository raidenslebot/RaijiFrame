/**
 * Thin promise wrappers over the Overwolf native API, plus game lifecycle.
 *
 * Overwolf's API is callback-first and pre-dates promises; wrapping it once here
 * keeps `await` at every call site instead of nested callbacks in feature code.
 */

/** Warframe's Overwolf game id (== RunningGameInfo.classId). Verified against
 *  game-events-status.overwolf.com/8954_prod.json and the local GamesList. */
export const WARFRAME_CLASS_ID = 8954;

/**
 * Overwolf injects its API as a bare global. Outside Overwolf - a plain browser
 * tab, the dev lab, a screenshot pass - that global simply does not exist, and
 * touching it throws a ReferenceError that takes the whole React root down with
 * it. Every wrapper below reads the API through this binding instead, so a panel
 * window still renders (with inert chrome) anywhere it is opened.
 */
export const ow: typeof overwolf | null = typeof overwolf === 'undefined' ? null : overwolf;

/** Window names, mirroring the keys under `data.windows` in manifest.json. */
export const WINDOW = {
  background: 'background',
  desktop: 'desktop',
  ingame: 'ingame',
  /**
   * The auto-modding strip: a second in-game window, sized to the empty right
   * column of the game's Upgrades screen. Deliberately NOT the `ingame` window,
   * which is the whole desktop shell with a WebGL backdrop and toggles as one.
   */
  automod: 'automod',
} as const;

export type WindowName = (typeof WINDOW)[keyof typeof WINDOW];

/** The hotkey declared in the manifest. Ctrl+K by default; the user can rebind. */
export const TOGGLE_HOTKEY = 'codex_toggle';

/**
 * The modding strip's own dismissal, Ctrl+Shift+M by default.
 *
 * THE COMMENT THAT WAS HERE WAS WRONG, and it is worth recording why.
 *
 * It claimed the strip "deliberately takes no mouse input", on the grounds that
 * an Overwolf in-game window only receives clicks if the app steals focus from
 * the game. That is not true. Checked against @overwolf/types: `clickthrough`
 * defaults to FALSE, so an in-game window receives the mouse by default, and
 * `focus_game_takeover` concerns mouse-less game states only - neither has
 * anything to do with it. The first version of the strip was unclickable
 * because it had no controls in it, not because the platform forbade them, and
 * the comment was an explanation invented after the fact for a limitation that
 * did not exist. A plausible reason for a defect is worse than no reason: it
 * stops anyone looking.
 *
 * The key still earns its place. It is the way out when the window is somewhere
 * the mouse cannot conveniently reach, and it is the toggle back. The strip's
 * own close control is the other way, and both route to the same mute.
 *
 * AND THE WINDOW BLOCKS NOTHING. It runs `InputPassThrough` (see
 * `setInputPassThrough` below), so every click and key reaches the game as
 * well - a player can move their frame, drag a mod and fire with the strip on
 * screen. Receiving input and STEALING it are different things, and the first
 * version of this file confused them in the other direction.
 */
export const AUTOMOD_HOTKEY = 'automod_toggle';

/**
 * Let the GAME keep every click and key while this window is up.
 *
 * `InputPassThrough` is Overwolf's own answer to the thing an overlay must
 * never do: sit on a rectangle of the screen and swallow input meant for the
 * game. The type declaration is explicit - "Mouse and keyboard input will pass
 * to the window AND to the game (no input blocking)" - so the strip keeps its
 * close control and its hover states while the player keeps moving their frame,
 * dragging mod cards and firing, straight through it.
 *
 * The window declares this in the manifest too. This call is deliberate
 * belt-and-braces: an overlay that eats input is the single failure this app
 * has already shipped twice, and a manifest flag that silently did not apply
 * would look exactly like the bug both previous times.
 */
export async function setInputPassThrough(name: WindowName): Promise<void> {
  /*
   * THE WINDOW ID, NOT THE DECLARED NAME - and this call spent its whole life
   * passing the wrong one.
   *
   * `setWindowStyle(windowId, ...)` wants the INSTANCE id that
   * `obtainDeclaredWindow` hands back, the way `restore`, `hide`, `close` and
   * `changeSize` in this file all do. It was being given `'automod'`, the
   * manifest key. The result was refused, and the only thing that happened was
   * a `console.warn` in a background page nobody has open - so the call that
   * exists SPECIFICALLY because "a manifest flag that silently did not apply
   * would look exactly like the bug" was itself silently not applying.
   *
   * The manifest declares the style as well, which is why the overlay does not
   * eat clicks in practice. That is the belt holding on its own with the braces
   * never fastened, on the one failure this app has already shipped twice.
   */
  if (!ow) return;
  const win = await obtainWindow(name).catch((err: unknown) => {
    console.warn('[ow] could not obtain', name, 'to set input pass-through', err);
    return null;
  });
  if (!win) return;
  return new Promise((resolve) => {
    // The literal, not the enum member: `WindowStyle` is an ambient `const enum`
    // and `verbatimModuleSyntax` forbids reading one at runtime. The enum's
    // value IS this string - overwolf.d.ts:1284.
    const style = 'InputPassThrough' as overwolf.windows.enums.WindowStyle;
    ow.windows.setWindowStyle(win.id, style, (res) => {
      if (!res.success) console.warn('[ow] input pass-through was refused for', name, res.error);
      resolve();
    });
  });
}

/** Overwolf results carry `success` rather than rejecting; normalise to a throw. */
function unwrap<T extends { success: boolean; error?: string }>(res: T, what: string): T {
  if (!res?.success) throw new Error(`${what} failed: ${res?.error ?? 'unknown error'}`);
  return res;
}

/** The game-info shape `getRunningGameInfo2` returns (differs from the v1 result). */
export type RunningGame = overwolf.games.GetRunningGameInfoResult2GameInfo;

export function getRunningGame(): Promise<RunningGame | null> {
  if (!ow) return Promise.resolve(null);
  return new Promise((resolve) => {
    ow.games.getRunningGameInfo2((res) => resolve(res?.gameInfo ?? null));
  });
}

/** True when the currently running game is Warframe. */
export function isWarframe(info?: { classId?: number; id?: number } | null): boolean {
  if (!info) return false;
  // classId is already the game id; `id` is the instance id (classId * 10 + n).
  return info.classId === WARFRAME_CLASS_ID || Math.floor((info.id ?? 0) / 10) === WARFRAME_CLASS_ID;
}

/**
 * THE WINDOW ID, ASKED FOR ONCE PER WINDOW AND THEN REMEMBERED.
 *
 * `obtainDeclaredWindow` is a round trip to Overwolf that answers the same
 * thing every time: a declared window's id does not change while the app runs.
 * Putting the overlay on screen made this call TWICE in the awaited path -
 * once inside `placeWindow` and once inside `restoreWindow` - so two of the
 * five round trips between the log line and a visible overlay were the same
 * question asked twice.
 *
 * Only the ID is cached, and only after a successful answer. `stateEx` is NOT:
 * `toggleWindow` reads it to decide which way to toggle, and a cached state is
 * a stale one the moment anything else moves the window. Every caller that
 * needs live state goes back to Overwolf; every caller that needs the id gets
 * it for free after the first ask.
 */
const windowIds = new Map<WindowName, string>();

export function obtainWindow(name: WindowName): Promise<overwolf.windows.WindowInfo> {
  if (!ow) return Promise.reject(new Error(`obtainDeclaredWindow(${name}): not running inside Overwolf`));
  return new Promise((resolve, reject) => {
    ow.windows.obtainDeclaredWindow(name, (res) => {
      try {
        const win = unwrap(res, `obtainDeclaredWindow(${name})`).window;
        windowIds.set(name, win.id);
        resolve(win);
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * The id alone, from the cache when there is one. For the calls that need
 * nothing but an id - restore, changeSize, changePosition, hide - which is all
 * of them except `toggleWindow`.
 */
async function idFor(name: WindowName): Promise<string> {
  const known = windowIds.get(name);
  if (known !== undefined) return known;
  return (await obtainWindow(name)).id;
}

export async function restoreWindow(name: WindowName): Promise<string> {
  const windowId = await idFor(name);
  return new Promise((resolve, reject) => {
    ow?.windows.restore(windowId, (res) => {
      try {
        unwrap(res, `restore(${name})`);
        resolve(windowId);
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Hide a window, and SAY SO IF IT DID NOT HIDE.
 *
 * This threw the result away - `hide(win.id, () => resolve())` - and a failed
 * hide is the exact state the player photographed: an overlay on screen while
 * the code that put it there believes it is gone. `hideStrip` lowers
 * `stripShown` and calls this; if the call fails, the flag says hidden, the
 * window says otherwise, and nothing looks again until the next app start.
 *
 * Overwolf answers with a `success` flag rather than by throwing, so ignoring
 * the callback's argument is indistinguishable from success at every level
 * above. It resolves either way - a caller cannot do anything more useful than
 * the retry below - but it now resolves with the truth, and the one caller that
 * can act on it does.
 */
export async function hideWindow(name: WindowName): Promise<boolean> {
  if (!ow) return true;
  const win = await obtainWindow(name);
  return new Promise((resolve) => {
    ow.windows.hide(win.id, (res) => {
      if (!res?.success) console.warn('[ow] hide was refused for', name, res?.error);
      resolve(res?.success === true);
    });
  });
}

/**
 * Close, not hide. A hidden Overwolf window's idle cost is undocumented -
 * nothing states whether CEF throttles its timers - so the only way to make
 * an in-game window provably cost nothing is to destroy its page. The price
 * is a reload on the next restore.
 */
export async function closeWindow(name: WindowName): Promise<void> {
  if (!ow) return;
  const win = await obtainWindow(name);
  return new Promise((resolve) => ow.windows.close(win.id, () => resolve()));
}

/** Show or hide, based on the window's own current state. Backs the Ctrl+K toggle. */
export async function toggleWindow(name: WindowName): Promise<'shown' | 'hidden'> {
  const win = await obtainWindow(name);
  const hidden = win.stateEx === 'closed' || win.stateEx === 'minimized' || win.stateEx === 'hidden';
  if (hidden) {
    await restoreWindow(name);
    return 'shown';
  }
  await hideWindow(name);
  return 'hidden';
}

/**
 * Move and size a window, in LOGICAL pixels.
 *
 * `changePosition` and the object form of `changeSize` do the DPI arithmetic
 * themselves (Overwolf's own docs: "calculates DPI, so you don't need to"), so
 * the caller passes coordinates derived from `logicalWidth`/`logicalHeight` and
 * never multiplies by a scale. The deprecated positional `changeSize` does NOT
 * do that arithmetic and is not used here.
 */
export async function placeWindow(
  name: WindowName,
  box: { left: number; top: number; width: number; height: number },
): Promise<void> {
  if (!ow) return;
  const windowId = await idFor(name);
  /*
   * THE TWO ARE INDEPENDENT, SO THEY GO TOGETHER.
   *
   * A size and a position are separate Overwolf calls about the same window and
   * neither reads the other's result; they were awaited one after the other, so
   * putting the overlay up paid for both round trips end to end. Nothing about
   * the order was load-bearing - the reason the SIZE must land before the
   * RESTORE (a window restored at the manifest's 1440x900 over a different
   * resolution) is about `placeWindow` against `restoreWindow`, which is still
   * sequenced, and is unaffected by these two overlapping with each other.
   */
  await Promise.all([
    new Promise<void>((resolve, reject) => {
      ow.windows.changeSize({ window_id: windowId, width: Math.round(box.width), height: Math.round(box.height) }, (res) => {
        try {
          unwrap(res, `changeSize(${name})`);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    }),
    new Promise<void>((resolve, reject) => {
      ow.windows.changePosition(windowId, Math.round(box.left), Math.round(box.top), (res) => {
        try {
          unwrap(res, `changePosition(${name})`);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    }),
  ]);
}

/*
 * Not here on purpose: `setWindowStyle(InputPassThrough)`. It is dual delivery
 * (window and game both receive the mouse), not the manifest's static
 * `clickthrough`, and a strip placed over EMPTY game UI (`data/automod-place`)
 * needs neither. Add it only for a placement that is measured to overlap a
 * control - and note the value is a const enum, unreadable under
 * verbatimModuleSyntax; pass the string cast to its type.
 */

export type WindowState = 'closed' | 'hidden' | 'maximized' | 'minimized' | 'normal';

export function getWindowState(name: WindowName): Promise<WindowState | null> {
  if (!ow) return Promise.resolve(null);
  /*
   * `getWindowsStates`, PLURAL - and the singular was being called with the
   * wrong argument, which made the fix for the reported bug inert.
   *
   * `getWindowState(windowId, ...)` takes the INSTANCE id (overwolf.d.ts:1695).
   * This passed the declared name, so the call failed, `success` came back
   * false, this resolved `null` - and the one caller guards on
   * `state !== null`. The startup reconciliation that exists to take down an
   * overlay left on screen by a background page that restarted has therefore
   * never done anything. That is the exact failure the player photographed:
   * a strip running an older build with no route out.
   *
   * The plural returns every declared window's state keyed BY NAME, which is
   * what this function has: no id to resolve, and - the reason it is the right
   * call rather than just a working one - no window created as a side effect.
   * `obtainDeclaredWindow` would CREATE the automod window merely to ask
   * whether it was up, which is a strange thing for a reconciliation whose
   * whole job is deciding whether it already exists.
   */
  return new Promise((resolve) => {
    ow.windows.getWindowsStates((res) => {
      if (!res.success) {
        console.warn('[ow] could not read the window states', res.error);
        resolve(null);
        return;
      }
      const byName = (res.resultV2 ?? res.result) as Record<string, string> | undefined;
      const state = byName?.[name];
      resolve(state === undefined ? null : (state as WindowState));
    });
  });
}

/**
 * Fires for EVERY declared window; the listener filters on the name. This is
 * the only signal a page has that its window was hidden or closed - `document
 * .hidden` is the browser's idea, not Overwolf's, and the two do not agree.
 */
export function onWindowStateChanged(name: WindowName, fn: (state: WindowState) => void): () => void {
  if (!ow) return () => void 0;
  const handler = (e: overwolf.windows.WindowStateChangedEvent) => {
    if (e.window_name === name) fn(e.window_state_ex as WindowState);
  };
  ow.windows.onStateChanged.removeListener(handler);
  ow.windows.onStateChanged.addListener(handler);
  return () => ow.windows.onStateChanged.removeListener(handler);
}

/** This window's own id, needed for dragMove. Null outside Overwolf. */
export function currentWindowId(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!ow) return resolve(null);
    ow.windows.getCurrentWindow((res) => resolve(res.success ? res.window.id : null));
  });
}

/** Drag the frameless window by its custom title bar. */
export function dragMove(windowId: string): void {
  // A click with no movement rejects with "Left mouse released" - expected, ignore.
  ow?.windows.dragMove(windowId, () => void 0);
}

export function onHotkeyPressed(name: string, fn: () => void): () => void {
  const handler = (e: { name: string }) => {
    if (e.name === name) fn();
  };
  if (!ow) return () => void 0;
  // Docs: remove before adding, so a re-init can't stack duplicate listeners.
  ow.settings.hotkeys.onPressed.removeListener(handler);
  ow.settings.hotkeys.onPressed.addListener(handler);
  return () => ow.settings.hotkeys.onPressed.removeListener(handler);
}

/** The user's current binding for a hotkey, for display in the UI. */
export function getHotkeyBinding(name: string): Promise<string | null> {
  if (!ow) return Promise.resolve(null);
  return new Promise((resolve) => {
    ow.settings.hotkeys.get((res) => {
      const all = [...(res?.globals ?? []), ...Object.values(res?.games ?? {}).flat()];
      resolve(all.find((h) => h.name === name)?.binding ?? null);
    });
  });
}

/** Fields both `getRunningGameInfo2` and `onGameInfoUpdated` agree on. */
export interface GameSnapshot {
  classId?: number;
  id?: number;
  isRunning?: boolean;
  isInFocus?: boolean;
  title?: string;
  /**
   * The game window, in PIXELS and in LOGICAL pixels. Overwolf: "work with
   * logical sizes if your screen is scaled by a DPI factor" - a window placed
   * from `width` on a 150% display lands off-screen. Absent until the game
   * reports them, which is a different thing from zero.
   */
  width?: number;
  height?: number;
  logicalWidth?: number;
  logicalHeight?: number;
}

/** The game's client area in logical pixels, or null while unreported. */
export function gameArea(info: GameSnapshot | null | undefined): { width: number; height: number } | null {
  const w = info?.logicalWidth ?? info?.width;
  const h = info?.logicalHeight ?? info?.height;
  return typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 ? { width: w, height: h } : null;
}

export interface GameLifecycle {
  /** Warframe started, or was already running when the app launched. */
  onStart: (info: GameSnapshot) => void;
  onStop: () => void;
  /**
   * The game's window or focus changed while running. Delivered on EVERY
   * update while the game is up: the flags Overwolf attaches are not reliable
   * enough to filter on, and the consumer can compare what it cares about. The
   * old signature passed them and invited exactly that filtering.
   *
   * Historic note, kept because it is the reason the argument is gone: `resolutionChanged` is
   * the one a positioned overlay must act on; the first version of this
   * watcher discarded it, so a window sized at launch stayed that size after
   * the player changed resolution.
   */
  onChange?: (info: GameSnapshot) => void;
}

/**
 * Watch Warframe's process lifecycle. Fires `onStart` immediately if the game is
 * already up, so the caller doesn't need a separate "check on boot" path.
 */
export function watchGame(cb: GameLifecycle): () => void {
  let running = false;

  const settle = (info: GameSnapshot | null | undefined) => {
    const up = !!info && isWarframe(info) && !!info.isRunning;
    if (up && !running) {
      running = true;
      cb.onStart(info);
    } else if (!up && running) {
      running = false;
      cb.onStop();
    } else if (up && running && info) {
      /*
       * DELIVERED ON EVERY UPDATE, NOT ONLY THE ONES OVERWOLF LABELS.
       *
       * This used to fire only when `resolutionChanged || focusChanged`, which
       * made the overlay's geometry depend on those flags being right about
       * every way a game window can change size. `observeGame` was changed to
       * compare the dimensions itself - and that fix was useless while the
       * event that carries them was still being filtered HERE. A resize
       * reported with both flags false never reached the consumer at all.
       *
       * The consumer places the window only when the box actually moved, so
       * delivering everything costs one comparison per update and nothing else.
       */
      cb.onChange?.(info);
    }
  };

  if (!ow) return () => void 0;
  /*
   * The event's `resolutionChanged` and `focusChanged` are deliberately NOT
   * read. They are Overwolf's opinion about why the update happened, and the
   * overlay's geometry used to depend on that opinion being right about every
   * way a game window can change size. `observeGame` compares the dimensions
   * instead, so the flags have no reader left and passing them on would only
   * invite one back.
   */
  const handler = (e: overwolf.games.GameInfoUpdatedEvent) => settle(e.gameInfo as GameSnapshot | null);
  ow.games.onGameInfoUpdated.removeListener(handler);
  ow.games.onGameInfoUpdated.addListener(handler);

  void getRunningGame().then((info) => settle(info));

  return () => ow.games.onGameInfoUpdated.removeListener(handler);
}
