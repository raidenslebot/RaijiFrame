import { Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { trackPointer } from '../ui/pointer';
import { m, MotionProvider } from './motion';
import {
  allGroups,
  defaultPanelId,
  getPanel,
  groupOf,
  leadPanelId,
  panelsInGroup,
} from '../panels/registry';
import { useAccount } from '../core/store';
import { describeAge } from '../core/snapshot';
import { Backdrop } from '../ui/Backdrop';
import { CommandPalette } from '../ui/CommandPalette';
import { NAVIGATE_EVENT, type NavigateDetail } from '../ui/navigation';
import { roomFor } from '../ui/rooms';
import { PanelIcon } from '../ui/PanelIcon';
import {
  currentWindowId,
  dragMove,
  TOGGLE_HOTKEY,
  getHotkeyBinding,
  hideWindow,
  type WindowName,
} from '../core/ow';

/**
 * The shell.
 *
 * WHAT WAS WRONG
 * ──────────────
 * The previous shell was a rounded grey rectangle floating in a 24px margin,
 * with a column of plain text labels down the left. That is a 2010 admin
 * dashboard, and no amount of palette work fixes it, because the problem is
 * structural: a window-inside-a-window with a flat ground.
 *
 * Warframe's UI has no window. Content floats directly on a living field of
 * space with a light source behind it, and the chrome is a few chamfered plates
 * at the edges. Three structural changes follow from that:
 *
 *   1. FULL BLEED. No outer container, no margin, no radius. The nebula runs
 *      edge to edge and the UI sits on it.
 *   2. CUT, NOT ROUNDED. Every plate is a clip-path chamfer. This is the single
 *      strongest "this is Warframe" signal available in CSS.
 *   3. TYPE IS THE HERO. Panel titles are set the way the game sets a planet
 *      name: inscriptional capitals, very wide tracking, large, quiet colour.
 *
 * The boldness is spent in exactly two places — the backdrop and the title — and
 * everything else is deliberately near-silent so those two land.
 */

const LAST_PANEL_KEY = 'codex.lastPanel';

/** Chamfer geometry, shared so the plate and its edge stay in register. */
const PLATE_CLIP = 'polygon(0 0, calc(100% - 11px) 0, 100% 11px, 100% 100%, 11px 100%, 0 calc(100% - 11px))';

function StatusDot() {
  const gep = useAccount((s) => s.gep);
  const running = useAccount((s) => s.gameRunning);

  const [tone, label] =
    gep === 'connected'
      ? (['var(--color-signal-good)', 'Linked'] as const)
      : gep === 'connecting'
        ? (['var(--color-signal-warn)', 'Linking'] as const)
        : gep === 'failed'
          ? (['var(--color-signal-bad)', 'No link'] as const)
          : running
            ? (['var(--color-void-400)', 'Idle'] as const)
            : (['var(--color-void-500)', 'Game closed'] as const);

  return (
    <div className="flex items-center gap-2" title={`Game events: ${label}`}>
      <span className="relative flex size-2">
        {gep === 'connected' && (
          // A slow pulse only while genuinely live — motion that means "connected".
          <m.span
            className="absolute inset-0 rounded-full"
            style={{ background: tone }}
            animate={{ opacity: [0.55, 0, 0.55], scale: [1, 2.4, 1] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <span className="relative size-2 rounded-full" style={{ background: tone }} />
      </span>
      <span className="eyebrow">{label}</span>
    </div>
  );
}

/**
 * How old the account reading is.
 *
 * Deliberately coarse and always present when there IS a reading. GEP only
 * pushes when the inventory changes, so "nothing has updated" is a normal and
 * correct state — but with nothing on screen saying WHEN the data was read, it
 * is indistinguishable from the app being broken. That ambiguity was a real
 * support question.
 *
 * The clock is an external store rather than state so render stays pure: no
 * `Date.now()` in the body, and the snapshot is quantised to the minute so it is
 * referentially stable between ticks.
 */
function useMinuteClock(): number {
  return useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, 30_000);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / 60_000) * 60_000,
    () => 0,
  );
}

function Freshness() {
  const inventoryAt = useAccount((s) => s.inventoryAt);
  const capturedAt = useAccount((s) => s.capturedAt);
  const durable = useAccount((s) => s.acquire.durable);
  const now = useMinuteClock();

  // The live push wins over the restored snapshot: it is the more recent fact.
  const at = inventoryAt ?? capturedAt;
  if (at === null || now === 0) return null;

  const mins = Math.max(0, Math.floor((now - at) / 60_000));
  // Amber past an hour. Not an error — old data is still correct data — but at
  // that age the player should know before acting on it.
  const stale = mins >= 60;

  /*
   * A read that never reached disk is a different kind of problem, and it used
   * to be silent: every panel correct, this line reporting a freshness the disk
   * did not have, and the loss discovered on the next launch when the app had
   * "forgotten everything". The account is the one thing here that cannot be
   * re-acquired without running the game, so a failed write is worth the space.
   */
  if (durable === false) {
    return (
      <span
        className="eyebrow"
        style={{ color: 'var(--color-signal-warn)' }}
        title="The account was read from the game but could not be written to this machine's storage, so it will not survive a restart. Storage may be disabled or full for this app."
      >
        read {describeAge(at, now)} · not saved
      </span>
    );
  }

  return (
    <span
      className="eyebrow"
      style={{ color: stale ? 'var(--color-signal-warn)' : 'var(--text-faint)' }}
      title={`Account last read ${new Date(at).toLocaleString()}`}
    >
      read {describeAge(at, now)}
    </span>
  );
}

function TitleBar({ windowId, windowName }: { windowId: string | null; windowName: WindowName }) {
  const username = useAccount((s) => s.username);
  const [binding, setBinding] = useState<string | null>(null);

  useEffect(() => {
    void getHotkeyBinding(TOGGLE_HOTKEY).then(setBinding);
  }, []);

  return (
    <header className="relative z-20 flex h-12 shrink-0 items-center gap-4 px-5">
      {/* Dedicated drag surface behind the controls. Dragging a window is
          inherently pointer-only, so it lives on its own inert layer rather than
          putting a mouse handler on a semantic element; every actual control in
          this bar stays a real, keyboard-reachable button. */}
      <div aria-hidden className="absolute inset-0" onMouseDown={() => windowId && dragMove(windowId)} />

      {/* A hairline that fades at both ends rather than a hard border. A full-
          width rule would re-draw the box this redesign exists to remove. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent, oklch(1 0 0 / 0.13) 12%, oklch(1 0 0 / 0.13) 88%, transparent)',
        }}
      />

      <div className="relative flex items-baseline gap-3">
        <span
          className="font-[family-name:var(--font-title)] text-[length:var(--text-small)] tracking-[0.34em] uppercase"
          style={{ color: 'var(--color-orokin-300)' }}
        >
          Raijiframe
        </span>
        {username && (
          <>
            <span aria-hidden className="size-[3px] rotate-45" style={{ background: 'var(--color-orokin-700)' }} />
            <span className="eyebrow">{username}</span>
          </>
        )}
      </div>

      <div className="relative ml-auto flex items-center gap-4">
        {/* A keyboard-only feature nobody can discover is not a feature. */}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true }))}
          // The title bar's two controls sit on a drag surface, so they need a
          // stronger "this one is a button" than a 6% wash: mo-lift rises on
          // approach and gives under the press. Chamfered, so no underline.
          className="mo-lift mo-focusable rf-clipped flex min-h-6 items-center gap-2 px-2 py-1 transition-colors hover:bg-white/6"
          style={{
            clipPath: 'polygon(0 0, calc(100% - 5px) 0, 100% 5px, 100% 100%, 5px 100%, 0 calc(100% - 5px))',
            color: 'var(--text-ghost)',
          }}
          title="Search everything"
        >
          <svg viewBox="0 0 16 16" className="size-3" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.6}>
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5 14 14" strokeLinecap="round" />
          </svg>
          <span className="eyebrow">Search</span>
        </button>
        <Freshness />
        <StatusDot />
        {binding && (
          <kbd
            className="numeric px-1.5 py-0.5 text-[length:var(--text-nano)]"
            style={{
              border: '1px solid var(--hairline)',
              color: 'var(--text-faint)',
              clipPath: 'polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 4px 100%, 0 calc(100% - 4px))',
            }}
          >
            {binding}
          </kbd>
        )}
        <button
          type="button"
          aria-label="Hide RaijiFrame"
          className="mo-lift mo-focusable grid size-7 min-w-6 place-items-center transition-colors hover:bg-white/8"
          style={{ color: 'var(--text-muted)' }}
          onClick={() => void hideWindow(windowName)}
        >
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </div>
    </header>
  );
}

function Rail({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  // The rail addresses GROUPS; `active` stays a panel id so every deep link in
  // the app keeps working. See the manifest comment in panels/panels.ts.
  const here = groupOf(active);
  return (
    <nav className="relative z-20 flex w-[184px] shrink-0 flex-col gap-[3px] p-3" aria-label="Sections">
      {allGroups().map((p, i) => {
        const on = p.id === here;
        return (
          <button
            key={p.id}
            type="button"
            title={p.hint}
            aria-current={on ? 'page' : undefined}
            onClick={() => onSelect(leadPanelId(p.id))}
            /*
             * THE MOST-USED CONTROL IN THE APP, AND IT DID NOT MOVE.
             *
             * The rail assembled itself once on mount and was then completely
             * inert: a hover wash at 4.5% white and nothing else. Every other
             * surface in this app answers the pointer, and the one the player
             * touches most did not.
             *
             * mo-magnet leans the item toward the cursor - three pixels, driven
             * by the signed distance from its own centre, so the whole column
             * bends slightly toward wherever you are, which is the thing that
             * makes a rail read as a physical set of switches rather than a list
             * of links. mo-field is what feeds it: the document-level tracker in
             * ui/pointer.ts writes the field, so thirteen rail items cost one
             * closest() per pointer move and no React handlers at all.
             *
             * mo-focusable blooms the ring on keyboard focus. Alt+Arrow and
             * Alt+1..9 drive this rail (see the key handler in Shell below), and
             * until now a keyboard user got the same static gold outline whether
             * focus had just landed or had been sitting there.
             *
             * All hover/focus, so none of it can be stranded by the frozen
             * timeline. The entrance stays the transform-only anim-slide-in it
             * already was; once that animation ends its fill is dropped and the
             * magnet's transform takes over cleanly.
             */
            className="anim-slide-in rf-clipped group mo-host mo-field mo-magnet mo-focusable relative flex items-center gap-3 px-3 py-[9px] text-left"
            // Staggered materialise on mount — the rail assembling itself is the
            // app's first impression. Deliberately CSS and not Motion: this is
            // navigation, and it must reach full opacity even if rAF never runs
            // (hidden window, throttled renderer). See theme.css.
            style={{ clipPath: PLATE_CLIP, animationDelay: `${40 + i * 28}ms` }}
          >
            {/*
             * The active plate and its energy edge are rendered directly on the
             * selected item — NOT as a shared-layout element sliding between
             * items.
             *
             * The sliding version was prettier and wrong. Motion's `layoutId`
             * animates via the document timeline, and when that timeline is
             * frozen (hidden window, unpresented renderer) the plate is stranded
             * on the PREVIOUS item: the rail then shows two items looking
             * selected, one of which is not. An indicator that can point at the
             * wrong thing is worse than one that does not slide.
             *
             * These are plain styled spans, so the indicator is always exactly
             * where selection is.
             */}
            {on && (
              <span
                aria-hidden
                className="absolute inset-0"
                style={{
                  clipPath: PLATE_CLIP,
                  background:
                    'linear-gradient(90deg, oklch(0.78 0.115 228 / 0.16), oklch(0.78 0.115 228 / 0.03) 65%, transparent)',
                }}
              />
            )}
            {on && (
              // Tenno cyan, not gold: in the game gold is Orokin material and
              // cyan is active energy, and the selected thing is the live one.
              <span
                aria-hidden
                className="absolute top-0 bottom-0 left-0 w-[2px]"
                style={{
                  background: 'var(--color-tenno-400)',
                  boxShadow: '0 0 10px oklch(0.78 0.115 228 / 0.75), 0 0 22px oklch(0.78 0.115 228 / 0.35)',
                }}
              />
            )}

            {/* Hover only on the inactive ones — a hover state on the already
                selected item is feedback for something that will not happen. */}
            {!on && (
              <span
                aria-hidden
                className="absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                style={{ clipPath: PLATE_CLIP, background: 'oklch(1 0 0 / 0.045)' }}
              />
            )}

            {/*
             * NO `transition-colors` ON THESE TWO. The plate above already
             * explains why the indicator does not slide; the same reasoning
             * applies to the colour and was missed the first time.
             *
             * A colour transition on a frozen document timeline holds its FROM
             * value indefinitely, so switching panels left the OUTGOING item
             * still painted `--text` and the incoming one still `--text-faint`.
             * Measured across a switch: the two labels' computed colours did not
             * change at all. The rail showed the plate on one item and the bright
             * label on another - two items looking selected, in the control the
             * player uses most.
             */}
            {/* The group wears its lead panel's icon: no new art, and the mark
                the player already associates with the section. */}
            {/* The icon leads the lean by two pixels, so the item does not slide
                as one rigid slab - the mark reaches the cursor slightly before
                its label does, which is the whole difference between a control
                that moves and one that is being moved. */}
            <span
              className="mo-icon relative flex"
              style={{ color: on ? 'var(--color-tenno-300)' : 'var(--text-ghost)' }}
            >
              <PanelIcon id={leadPanelId(p.id)} />
            </span>
            {/*
             * The underline is on the LABEL because the button wears PLATE_CLIP,
             * and a clip-path eats a pseudo-element drawn below the border box.
             * mo-host on the button is what makes it answer a pointer anywhere on
             * the item rather than only over the four words of the title.
             *
             * NOT ON THE SELECTED ITEM, and that is the same rule the hover wash
             * above already follows: the selected item carries a cyan edge and a
             * cyan plate as STATE, and a gold rule drawing under it on hover
             * would be a second signal competing with the one that says which
             * panel you are actually in. Gold is the pointer, cyan is the
             * selection - the two never wear the same colour, so they can never
             * be confused for each other.
             */}
            <span
              className={
                (on ? '' : 'mo-underline ') +
                'relative font-[family-name:var(--font-display)] text-[length:var(--text-micro)] font-semibold tracking-[0.15em] whitespace-nowrap uppercase'
              }
              style={{ color: on ? 'var(--text)' : 'var(--text-faint)' }}
            >
              {p.title}
            </span>
            {i < 9 && (
              // The Alt+N shortcut, shown on the row it belongs to. A keyboard
              // affordance nobody can discover is not an affordance.
              <span
                aria-hidden
                className="numeric relative ml-auto text-[length:var(--text-micro)] opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: 'var(--text-ghost)' }}
              >
                {i + 1}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

function PanelFallback() {
  return (
    <div className="grid h-full place-items-center">
      {/* A rotating chamfered ring rather than a circle: even the spinner should
          be cut rather than round. */}
      <m.div
        className="size-7"
        style={{
          border: '1.5px solid var(--hairline-strong)',
          borderTopColor: 'var(--color-tenno-400)',
          clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))',
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
      />
    </div>
  );
}

/**
 * The panels inside the open group.
 *
 * Only drawn when the group holds more than one, so Star Chart - which is a
 * whole screen on its own - gains no chrome it has no use for.
 *
 * The selected marker does NOT slide between tabs, for the same reason the rail
 * plate does not: a shared-layout transition runs on the document timeline, and
 * an overlay whose timeline is frozen strands the marker under the PREVIOUS tab
 * while the new panel is already mounted. It is drawn on the selected tab.
 */
function SubRail({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  const group = groupOf(active);
  const siblings = group ? panelsInGroup(group) : [];
  if (siblings.length < 2) return null;

  return (
    <div
      className="relative z-10 flex shrink-0 items-stretch gap-[3px] px-5 pt-3"
      role="tablist"
      aria-label="Views in this section"
    >
      {siblings.map((p, i) => {
        const on = p.id === active;
        return (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={on}
            title={p.hint}
            onClick={() => onSelect(p.id)}
            /* Transform-only entrance. A frozen timeline holds an opacity
               animation at its FROM value, and a tab bar that never appears is
               worse than one that never animates. */
            /*
             * The same treatment as the rail above, and it has to be the same or
             * the two bars stop looking like one system: the sub-rail sits
             * directly under a rail that now leans toward the cursor, and a row
             * of inert buttons next to a responsive one reads as broken rather
             * than as restrained.
             *
             * The underline can live on the BUTTON here - unlike the rail and the
             * tabs, this button carries no clip-path of its own (the chamfer is
             * on the selected-state span inside it), so nothing eats an ::after
             * two pixels below the box. That is also why there is no mo-host.
             */
            className={
              (on ? '' : 'mo-underline ') +
              'anim-slide-in group mo-field mo-magnet mo-focusable relative px-3.5 py-1.5'
            }
            style={{ animationDelay: `${String(30 + i * 26)}ms` }}
          >
            {on && (
              <>
                <span
                  aria-hidden
                  className="absolute inset-0"
                  style={{
                    background: 'linear-gradient(180deg, oklch(1 0 0 / 0.07), oklch(1 0 0 / 0.02))',
                    clipPath: 'polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 7px 100%, 0 calc(100% - 7px))',
                  }}
                />
                {/* The lit edge under the open view — the one bright thing in
                    the bar, so the eye lands on it without reading. */}
                <span
                  aria-hidden
                  className="absolute right-0 bottom-0 left-0 h-px"
                  style={{ background: 'var(--color-tenno-300)' }}
                />
              </>
            )}
            {!on && (
              <span
                aria-hidden
                className="absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                style={{ background: 'oklch(1 0 0 / 0.04)' }}
              />
            )}
            <span
              className="relative font-[family-name:var(--font-display)] text-[length:var(--text-nano)] font-semibold tracking-[0.18em] uppercase"
              style={{ color: on ? 'var(--text)' : 'var(--text-faint)' }}
            >
              {p.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Shell({ windowName }: { windowName: WindowName }) {
  /*
   * One pointer tracker for every row in every panel.
   *
   * Feeds --mx/--my to whatever is under the cursor so the specular highlight
   * in the console layer has somewhere to sit. Delegated rather than per-row:
   * the catalog panels carry hundreds of rows at once, over a running game.
   */
  useEffect(() => trackPointer(), []);

  const [windowId, setWindowId] = useState<string | null>(null);
  const [active, setActive] = useState(() => {
    const saved = localStorage.getItem(LAST_PANEL_KEY);
    return saved && getPanel(saved) ? saved : defaultPanelId();
  });

  useEffect(() => {
    void currentWindowId().then(setWindowId);
  }, []);

  useEffect(() => {
    localStorage.setItem(LAST_PANEL_KEY, active);
  }, [active]);

  /**
   * Cross-panel navigation, by event.
   *
   * Panels reference each other constantly - "tracked in detail on the star
   * chart", "this is blocked by a quest", "opens Ceres" - and every one of those
   * was dead text. A reader reasonably expects to click it and be taken there.
   *
   * An event rather than threading a setter through every panel: the panels are
   * lazily-loaded leaves that know nothing about the shell, and giving thirteen
   * of them a navigation prop to pass down would couple them to routing they
   * otherwise have no interest in.
   */
  useEffect(() => {
    // The older single-purpose event, kept because several panels already emit
    // it to switch panels with no deeper target.
    const onPanel = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id === 'string' && getPanel(id)) setActive(id);
    };
    // The richer contract: go to a panel AND ask it to focus something. The
    // focus request itself travels out of band (see ui/navigation.ts) because
    // the destination panel is usually not mounted yet when this fires.
    const onNavigate = (e: Event) => {
      const detail = (e as CustomEvent<NavigateDetail>).detail;
      if (detail && typeof detail.panel === 'string' && getPanel(detail.panel)) setActive(detail.panel);
    };
    window.addEventListener('raijiframe:panel', onPanel);
    window.addEventListener(NAVIGATE_EVENT, onNavigate);
    return () => {
      window.removeEventListener('raijiframe:panel', onPanel);
      window.removeEventListener(NAVIGATE_EVENT, onNavigate);
    };
  }, []);

  /**
   * Keyboard navigation between panels.
   *
   * The overlay is opened BY a keyboard shortcut, so reaching for the mouse to
   * change panel breaks the one interaction model it establishes. Alt+Arrow
   * steps through the rail in order; Alt+1..9 jumps directly.
   *
   * Alt rather than a bare key or Ctrl: bare arrows must keep working inside the
   * star chart and any text field, and Ctrl+1..9 is claimed by the browser's own
   * tab switching. Alt is free and unambiguous.
   *
   * The handler bails out whenever focus is in a text input, so typing in the
   * pursuit filter never navigates away mid-word.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;

      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (typing) return;

      // Up/down walk the rail's GROUPS; left/right walk the views inside the
      // open one. The two axes match the two bars on screen.
      const groups = allGroups();
      const here = groupOf(active);
      const at = groups.findIndex((g) => g.id === here);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        // Wraps: a rail that dead-ends makes the user reverse direction to reach
        // the item one step past the end.
        setActive(leadPanelId(groups[(at + 1) % groups.length]!.id));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(leadPanelId(groups[(at - 1 + groups.length) % groups.length]!.id));
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const siblings = here ? panelsInGroup(here) : [];
        if (siblings.length < 2) return;
        e.preventDefault();
        const i = siblings.findIndex((p) => p.id === active);
        const step = e.key === 'ArrowRight' ? 1 : -1;
        setActive(siblings[(i + step + siblings.length) % siblings.length]!.id);
        return;
      }

      const digit = Number(e.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        const target = groups[digit - 1];
        if (target) {
          e.preventDefault();
          setActive(leadPanelId(target.id));
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const panel = getPanel(active);
  const Panel = panel?.component;

  return (
    <MotionProvider>
      <div className="relative grid h-full grid-rows-[auto_1fr] overflow-hidden">
        <style>{`
/* ---------------------------------------------------------------------------
 * MO-HOST - a control lends its hover state to its own parts.
 *
 * WHAT WAS WRONG
 * ──────────────
 * The motion layer drives every input-driven effect from one inherited custom
 * property, --mo-on, which each mo- class sets to 0 on itself and to 1 on its
 * own :hover. That is exactly right while the effect sits on the element the
 * pointer is actually over, and it falls apart the moment the effect has to
 * live on a CHILD - which the chamfer forces here.
 *
 * mo-underline draws its rule on an ::after two pixels BELOW the border box,
 * and every plate in this app wears a clip-path, which deletes any pseudo
 * element outside that box. So the rule has to move onto the label inside the
 * button. Do that alone and the underline only fires while the pointer is over
 * the label text itself: the rail item has 12px of horizontal padding and the
 * tab has 16px, and crossing that padding flickered the line on and off.
 *
 * A control marked mo-host therefore hands --mo-on down to everything inside
 * it. One rule for the whole chrome rather than a variant per part.
 *
 * WHY THIS IS A STYLE BLOCK AND NOT A TAILWIND GROUP VARIANT
 * ─────────────────────────────────────────────────────────
 * group-hover:[--mo-on:1] is the obvious way to write this and it does
 * nothing. Tailwind emits utilities into @layer utilities; motion.css is
 * unlayered; and an unlayered declaration beats a layered one however specific
 * the layered one is. The Tailwind version compiles, ships, and never wins.
 *
 * This sets a custom property and nothing else, so reduced motion needs no
 * handling here - motion.css already forces transform and transition off for
 * every mo- class under prefers-reduced-motion, which leaves the underline
 * appearing instead of drawing. That is a state change, which is what is
 * wanted: the effect is removed, not shortened.
 * ------------------------------------------------------------------------- */
.mo-host:hover *,
.mo-host:focus-visible * {
  --mo-on: 1;
}
`}</style>
        {/* The ground. Behind everything, ignoring pointer events entirely. */}
        {/*
         * The ground, and it changes with the panel.
         *
         * One shader, thirteen rooms: the star chart keeps the sampled teal, the
         * Foundry is a forge lit from below, a lich's territory is red and lit
         * from behind, Focus is Void violet. Switching panels cross-fades between
         * them over ~0.6s rather than cutting, so the app reads as moving
         * BETWEEN places instead of repainting one.
         *
         * This is the cheapest possible way to give thirteen screens their own
         * identity — seven colours and a light position each, no extra geometry,
         * no extra draw calls.
         */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <Backdrop intensity={0.92} palette={roomFor(active)} />
        </div>

        {/*
         * A single dark wash over the field.
         *
         * The nebula at full strength is beautiful and completely unreadable
         * under body text. Rather than dimming the shader — which would flatten
         * the gas and waste it — one gradient scrim sits between the field and
         * the content: heaviest on the left where the rail's small type lives,
         * lightest on the right where panels put their large elements.
         */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            // Neutral-dark and slightly lighter than before: the scrim exists to
            // keep body text readable, and a heavy blue-black one flattened every
            // room back toward the same colour, which defeated the point.
            background:
              'linear-gradient(100deg, oklch(0.05 0.006 260 / 0.68) 0%, oklch(0.05 0.006 260 / 0.38) 32%, oklch(0.05 0.006 260 / 0.14) 100%)',
          }}
        />

        {/* Above every panel and the backdrop, inside the shell's own stacking
            context so it cannot be clipped by a panel's overflow. */}
        <CommandPalette />

        <TitleBar windowId={windowId} windowName={windowName} />

        {/*
          minmax(0,1fr), NEVER a bare 1fr.

          A 1fr track has an automatic minimum size, so it refuses to shrink
          below its content and the grid simply grows past its container. That
          is what pushed the whole shell to 947px inside a 900px window: the
          rail took its 184, the content track took its min-content, and the
          sum overflowed the viewport with no scrollbar to show for it.

          The same trap as min-width: auto on a flex item, which is why main
          also carries min-w-0 below - both were needed, and fixing only the
          flex item left the grid still overflowing.
        */}
        <div className="relative grid min-h-0 grid-cols-[auto_minmax(0,1fr)]">
          <Rail active={active} onSelect={setActive} />

          {/* A vertical hairline that fades out top and bottom, in place of the
              old hard border. Structure without a box. */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 left-[184px] w-px"
            style={{
              background:
                'linear-gradient(180deg, transparent, oklch(1 0 0 / 0.11) 14%, oklch(1 0 0 / 0.11) 86%, transparent)',
            }}
          />

          {/*
           * Panel swap: a keyed remount with a CSS entrance. No AnimatePresence.
           *
           * `AnimatePresence mode="wait"` holds the OUTGOING panel mounted until
           * its exit animation reports completion — and that animation is driven
           * by rAF. When rAF is throttled or stopped (hidden window, background
           * renderer, a throttled compositor), the exit never completes and the
           * swap deadlocks: the rail moves, the panel does not. It is
           * reproducible, and it is the same failure that stranded the rail
           * items at partial opacity.
           *
           * Navigation must never depend on an animation finishing. Keying the
           * container remounts synchronously, and the entrance is a CSS
           * animation the compositor will settle regardless. The exit animation
           * is simply dropped — the game materialises a new screen rather than
           * fading the old one out, so there was nothing to lose.
           *
           * Suspense sits inside the keyed element so a lazy panel's suspension
           * swaps only the panel body, not the animated wrapper.
           */}
          {/*
           * The sub-rail sits OUTSIDE the keyed element on purpose. Inside it,
           * every sub-tab click would remount the bar and replay its staggered
           * entrance - the control the player just used flickering under their
           * cursor. Out here the buttons keep their identity while the panel
           * below them swaps, and they only materialise when the GROUP changes
           * and the buttons genuinely become different ones.
           */}
          <div className="relative z-10 flex min-h-0 flex-col">
            <SubRail active={active} onSelect={setActive} />
            {/*
              min-w-0 IS LOAD-BEARING, NOT TIDINESS.

              A flex item defaults to min-width: auto, which forbids it
              shrinking below its content's intrinsic width. This is flex-1
              beside a fixed 184px rail, so at a narrow window it stopped
              shrinking and simply overflowed: measured at a 900px viewport,
              184 + 763 = 947, pushing 47px of EVERY panel off the right edge.
              Nothing revealed it - overflow-y-auto scrolls vertically only, so
              there was no scrollbar and no clipping outline, just content that
              was not there.

              This overlay is composited over a game and is routinely narrower
              than a browser window, so the narrow case is the normal case.
            */}
            <main key={active} className="anim-rise rf-stage relative min-h-0 min-w-0 flex-1 overflow-y-auto">
              <Suspense fallback={<PanelFallback />}>
                {Panel ? <Panel /> : <div className="p-8">No panels registered.</div>}
              </Suspense>
            </main>
          </div>
        </div>
      </div>
    </MotionProvider>
  );
}
