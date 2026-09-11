import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { allPanels } from '../panels/registry';
import { goTo, navigate, type FocusKind } from './navigation';
import { CHAMFER_MD as CHAMFER } from './geometry';

/**
 * THE COMMAND PALETTE.
 *
 * WHY
 * ───
 * The app knows about roughly 1,400 distinct things — 355 star chart nodes, 165
 * quests and junctions, 882 catalog items, the resource catalog, 22 syndicates — and
 * the only way to reach any of them was to guess which of thirteen panels owned
 * it, go there, and scroll. Nothing was addressable.
 *
 * That is most of what "there could be way more but there isn't" means in
 * practice: the depth exists, and there is no way in. One keystroke now reaches
 * any of it.
 *
 * DESIGN
 * ──────
 *   - Opens on Ctrl+P or "/" (Ctrl+K is taken: it toggles the whole overlay).
 *   - Fully keyboard driven. Arrows move, Enter goes, Escape closes, and the
 *     highlighted row scrolls itself into view.
 *   - Results are GROUPED by kind, because "Mars" is a planet, a set of nodes
 *     and part of several quest names, and a flat list makes the player
 *     disambiguate by reading rather than by looking.
 *   - Indexes load lazily on first open and are cached. Nothing is fetched for a
 *     palette that is never used, and the item catalog is the same gently-cached
 *     read every other panel already makes.
 *
 * SCORING
 * ───────
 * Deliberately simple and predictable rather than fuzzy: exact, then prefix,
 * then word-prefix, then substring. A player typing "gra" wants Gradivus at the
 * top, and a clever matcher that surfaces "Sanctuary Onslaught" because it
 * shares letters is worse than no matcher. Ties break on shorter name, which
 * favours the thing the query most nearly IS.
 */

export interface PaletteEntry {
  kind: FocusKind | 'panel';
  id: string;
  label: string;
  /** Right-aligned context: planet, category, mission type. */
  hint?: string;
}

const KIND_LABEL: Record<PaletteEntry['kind'], string> = {
  panel: 'Panel',
  node: 'Mission',
  planet: 'Planet',
  quest: 'Quest',
  item: 'Item',
  resource: 'Resource',
};

/** Group order. Panels first because they are the coarsest destination. */
const KIND_ORDER: PaletteEntry['kind'][] = ['panel', 'planet', 'node', 'quest', 'item', 'resource'];


/** Per-group cap. The palette is for finding, not for browsing. */
const PER_GROUP = 6;

/* -------------------------------------------------------------------- index */

/**
 * Build the searchable index.
 *
 * Every source is already loaded and cached by some panel, so this costs one
 * gentle read at most and usually nothing. A source that fails to load is simply
 * absent from the index — a palette missing the item catalog is still useful,
 * and blocking the whole thing on one fetch would not be.
 */
async function buildIndex(): Promise<PaletteEntry[]> {
  const out: PaletteEntry[] = [];

  for (const p of allPanels()) {
    out.push({ kind: 'panel', id: p.id, label: p.title, hint: p.hint });
  }

  try {
    const { loadCatalog } = await import('../data/datasets');
    const loaded = await loadCatalog();
    const planets = new Set<string>();

    // Junctions are node rows too; they are listed once, below, as junctions.
    const junctionIds = new Set(loaded.catalog.junctions.map((j) => j.id));
    for (const n of loaded.catalog.nodeById.values()) {
      if (n.planet !== null && n.planet !== undefined) planets.add(n.planet);
      if (junctionIds.has(n.id)) continue;
      out.push({
        kind: 'node',
        id: n.id,
        label: n.name,
        hint: [n.planet, n.type].filter(Boolean).join(' · ') || undefined,
      });
    }
    for (const planet of planets) {
      out.push({ kind: 'planet', id: planet, label: planet, hint: 'star chart' });
    }
    for (const q of loaded.catalog.questByKey.values()) {
      out.push({
        kind: 'quest',
        id: q.id ?? `quest:${q.name}`,
        label: q.name,
        hint: q.mainline === true ? 'mainline' : 'side quest',
      });
    }
    for (const j of loaded.catalog.junctions) {
      out.push({ kind: 'quest', id: j.id, label: j.name, hint: `${j.from} to ${j.to}` });
    }
  } catch {
    /* star chart unavailable; the rest of the index still works */
  }

  try {
    const { loadItemDb } = await import('../data/itemdb');
    const db = await loadItemDb();
    for (const e of db.byType.values()) {
      if (!e.masterable) continue;
      out.push({ kind: 'item', id: e.name, label: e.name, hint: e.category });
    }
  } catch {
    /* item catalog unavailable */
  }

  try {
    const { loadResourceDb } = await import('../data/resourcedb');
    const db = await loadResourceDb();
    for (const r of db.all) {
      out.push({ kind: 'resource', id: r.name, label: r.name, hint: r.type ?? undefined });
    }
  } catch {
    /* resource catalog unavailable */
  }

  return out;
}

/** Higher is better. 0 means no match. */
function score(label: string, q: string): number {
  const l = label.toLowerCase();
  if (l === q) return 1000;
  if (l.startsWith(q)) return 500 - l.length;
  // Word-prefix: "sanctuary" should find "Elite Sanctuary Onslaught".
  if (l.includes(` ${q}`)) return 300 - l.length;
  if (l.includes(q)) return 100 - l.length;
  return 0;
}

/* ----------------------------------------------------------------- component */

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [index, setIndex] = useState<PaletteEntry[] | null>(null);
  // Stable root for the listbox and its option ids (defect: the results list
  // had no listbox semantics at all - see the combobox wiring below).
  const listboxId = useId();
  /*
   * `loading` is DERIVED, not stored.
   *
   * It is exactly "we have opened, and the index has not arrived" — a fact
   * already implied by the two values above. Storing it separately meant an
   * effect had to keep it in sync, which is both a cascading render and, as this
   * component proved, an opportunity for the effect to fight itself.
   */

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /*
   * Whatever had focus at the moment the palette opened.
   *
   * The palette used to close by unmounting its whole tree with nothing
   * putting focus anywhere afterward, so the browser fell back to <body> and
   * a keyboard user lost their place in the page behind it. Captured here,
   * at the instant that causes the open, and consumed by the restore effect
   * below on every path back to closed - Escape, the backdrop click, and
   * picking a result all just flip `open` to false.
   */
  const previousFocusRef = useRef<HTMLElement | null>(null);
  /*
   * The pointer position a row was last entered at.
   *
   * `onPointerEnter` also fires when a row moves under a STATIONARY pointer -
   * which is exactly what happens after the cursor-follows-scroll effect
   * below runs: the list scrolls, a new row ends up under the mouse, that
   * row's pointerenter fires, the cursor moves onto it, which scrolls again.
   * Comparing the event's coordinates against the last ones seen tells a real
   * pointer move apart from the list moving under a still pointer.
   */
  const lastPointerPos = useRef<{ x: number; y: number } | null>(null);

  /* ---- open / close ------------------------------------------------------ */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);

      // "/" is the fastest possible opener, but only when not already typing.
      const slash = e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey;
      // Ctrl+P is the convention. Ctrl+K belongs to the overlay toggle.
      const ctrlP = e.key.toLowerCase() === 'p' && (e.ctrlKey || e.metaKey) && !e.shiftKey;

      if (slash || ctrlP) {
        e.preventDefault();
        // Reset here, in the event that causes the open. Doing it in an effect
        // keyed on `open` is a state sync: an extra render, and one that fires
        // on every re-open for values the opener already knows.
        setQuery('');
        setCursor(0);
        setOpen(true);
        previousFocusRef.current = el instanceof HTMLElement ? el : null;
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  /**
   * Build the index on first open only.
   *
   * The guard is a REF, not the `loading` state, and that distinction is the
   * whole bug this replaces. With `loading` in the dependency array the effect
   * re-ran the moment it set it, and re-running fires the previous run's
   * cleanup — which flipped `alive` to false and discarded the in-flight build.
   * The palette then said "Indexing the catalogs…" forever while every source
   * had actually loaded fine.
   *
   * A ref cannot retrigger the effect, so the request survives to completion.
   */
  const startedRef = useRef(false);

  useEffect(() => {
    if (!open || startedRef.current) return;
    startedRef.current = true;

    void buildIndex()
      .then(setIndex)
      .catch((err: unknown) => {
        // Never leave the palette stuck on its loading state: an index that
        // failed to build is still a working panel switcher.
        console.warn('[palette] index failed', err);
        setIndex([]);
      });
  }, [open]);

  const loading = index === null;

  // Focusing the DOM is exactly what an effect is for - it synchronises React
  // with an external system - and it sets no state.
  useEffect(() => {
    if (!open) return;
    // A timer, not rAF: a frame is not guaranteed to come while the overlay
    // is not presented, and focus must not wait on one.
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  /* ---- results ----------------------------------------------------------- */

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (index === null) return [];

    // With no query, offer the panels: a palette that opens empty teaches
    // nothing about what it can do.
    if (q.length === 0) {
      return [{ kind: 'panel' as const, rows: index.filter((e) => e.kind === 'panel').slice(0, 13) }];
    }

    const scored = new Map<PaletteEntry['kind'], Array<{ e: PaletteEntry; s: number }>>();
    for (const e of index) {
      const s = score(e.label, q);
      if (s <= 0) continue;
      const list = scored.get(e.kind);
      if (list) list.push({ e, s });
      else scored.set(e.kind, [{ e, s }]);
    }

    return KIND_ORDER.filter((k) => scored.has(k)).map((k) => ({
      kind: k,
      rows: scored
        .get(k)!
        .sort((a, b) => b.s - a.s || a.e.label.length - b.e.label.length)
        .slice(0, PER_GROUP)
        .map((x) => x.e),
    }));
  }, [index, query]);

  /**
   * Flattened, with each row's global position precomputed.
   *
   * The cursor walks every result regardless of grouping, so each row needs to
   * know its index in that flat order. Deriving it here rather than incrementing
   * a counter inside the render's `.map()` keeps render pure — a callback that
   * mutates a variable captured from its enclosing scope is exactly what the
   * React Compiler lint objects to, and it silently depends on the callback
   * running once per element in order.
   */
  const { flat, offsets } = useMemo(() => {
    const rows: PaletteEntry[] = [];
    const starts: number[] = [];
    for (const g of groups) {
      starts.push(rows.length);
      rows.push(...g.rows);
    }
    return { flat: rows, offsets: starts };
  }, [groups]);

  /*
   * The cursor is CLAMPED during render rather than reset by an effect.
   *
   * Typing shrinks the result list, and a stored cursor can end up past the end
   * of it. Correcting that with an effect means rendering one frame with an
   * out-of-range highlight and then re-rendering — the "derive, do not sync"
   * rule. Clamping is the derivation.
   */
  const active = flat.length === 0 ? 0 : Math.min(cursor, flat.length - 1);


  const run = useCallback((entry: PaletteEntry) => {
    setOpen(false);
    if (entry.kind === 'panel') navigate(entry.id);
    else goTo(entry.kind, entry.id, entry.label);
  }, []);

  /* ---- keyboard ---------------------------------------------------------- */

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(flat.length === 0 ? 0 : (active + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(flat.length === 0 ? 0 : (active - 1 + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = flat[active];
      if (entry) run(entry);
    }
  };

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  // Restore focus to whatever opened the palette. Every close path - Escape,
  // clicking the backdrop, and picking a result in `run` - just sets `open`
  // to false, so one effect keyed on it covers all three rather than
  // duplicating the restore at each call site.
  useEffect(() => {
    if (open) return;
    const el = previousFocusRef.current;
    previousFocusRef.current = null;
    if (el !== null && document.contains(el)) el.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center pt-[12vh]"
      style={{ background: 'oklch(0.04 0.01 260 / 0.72)' }}
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="anim-rise w-[min(620px,90%)] overflow-hidden"
        style={{ clipPath: CHAMFER, padding: 1, background: 'linear-gradient(150deg, var(--color-tenno-400), oklch(0.78 0.115 228 / 0.15) 45%, transparent 80%)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search everything"
      >
        <div style={{ clipPath: CHAMFER, background: 'linear-gradient(168deg, oklch(0.13 0.024 268 / 0.99), oklch(0.09 0.02 275 / 0.99))' }}>
          <div className="flex items-center gap-3 border-b px-5 py-3.5" style={{ borderColor: 'var(--hairline)' }}>
            <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.5} style={{ color: 'var(--color-tenno-300)' }}>
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 14 14" strokeLinecap="round" />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={onInputKey}
              placeholder="Search missions, quests, items, resources"
              aria-label="Search everything"
              /*
               * The palette IS fully keyboard driven - arrows move a cursor,
               * Enter goes - but none of that was ever said to a screen
               * reader: the results were a plain <ul>, the rows were plain
               * buttons, and nothing tied "the row the cursor is on" to
               * anything AT-visible. This is the standard combobox/listbox
               * pairing for it: the input owns the box below via
               * `aria-controls`, and `aria-activedescendant` names the row
               * the arrow keys currently have selected without moving real
               * DOM focus off the input (which is what lets typing keep
               * working while arrowing through results).
               */
              role="combobox"
              aria-expanded
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={flat.length > 0 ? `${listboxId}-option-${String(active)}` : undefined}
              className="min-w-0 flex-1 bg-transparent text-[length:var(--text-body)] outline-none"
              style={{ color: 'var(--text)' }}
            />
            <kbd className="numeric px-1.5 py-0.5 text-[length:var(--text-micro)]" style={{ border: '1px solid var(--hairline)', color: 'var(--text-ghost)' }}>
              esc
            </kbd>
          </div>

          <ul ref={listRef} id={listboxId} role="listbox" aria-label="Search results" className="max-h-[46vh] overflow-y-auto py-1.5">
            {loading && (
              <li role="presentation" className="px-5 py-3 text-[length:var(--text-small)]" style={{ color: 'var(--text-faint)' }}>
                Indexing the catalogs…
              </li>
            )}

            {!loading && flat.length === 0 && query.trim().length > 0 && (
              <li role="presentation" className="px-5 py-3 text-[length:var(--text-small)]" style={{ color: 'var(--text-faint)' }}>
                Nothing matches “{query.trim()}”.
              </li>
            )}

            {groups.map((g, gi) => (
              <li key={g.kind} role="group" aria-label={KIND_LABEL[g.kind]}>
                <div className="eyebrow px-5 pt-2.5 pb-1">{KIND_LABEL[g.kind]}</div>
                <ul role="presentation">
                  {g.rows.map((e, ri) => {
                    const at = (offsets[gi] ?? 0) + ri;
                    const isActive = at === active;
                    /*
                     * THE OPTION IS THE THING YOU CLICK.
                     *
                     * Not a button, and not a div nested inside the option
                     * either. A real focusable button here would be a control
                     * inside an ARIA widget role, and it would let Tab walk
                     * into the list and strand focus away from the input the
                     * arrow keys and typing depend on - in an
                     * aria-activedescendant listbox an option's selection is
                     * virtual and options are never tab stops.
                     *
                     * But the handlers belonged ON the option rather than on a
                     * plain div inside it: a static element carrying a click
                     * is a static element carrying a click, however correct
                     * the surrounding pattern. Keyboard activation is the
                     * input's, where it has always been - `onInputKey` runs
                     * the active row on Enter.
                     */
                    return (
                      <li
                        key={`${e.kind}:${e.id}`}
                        id={`${listboxId}-option-${String(at)}`}
                        role="option"
                        aria-selected={isActive}
                        data-active={isActive}
                        onClick={() => run(e)}
                          onPointerEnter={(ev) => {
                            const last = lastPointerPos.current;
                            lastPointerPos.current = { x: ev.clientX, y: ev.clientY };
                            // A pointerenter at the SAME coordinates as last time is
                            // the list moving under a still pointer - see
                            // `lastPointerPos` above - not the pointer moving onto
                            // this row, so it must not steal the keyboard cursor.
                            if (last !== null && last.x === ev.clientX && last.y === ev.clientY) return;
                            setCursor(at);
                          }}
                          // No `transition-colors`. This background IS the
                          // keyboard cursor, and a stranded colour transition
                          // means arrowing through results does not visibly move
                          // the highlight - the one thing the palette must do.
                          // `cursor-pointer`: a real `<button>` got this for
                          // free from the UA stylesheet; a plain div does not.
                          //
                          // `mo-field mo-sheen` is the HOVER half, and it is a
                          // separate channel from the selection above on purpose.
                          // A palette has two cursors at once - the keyboard's,
                          // which Enter acts on, and the mouse's, which merely
                          // points - and painting both as "the row is coloured
                          // in" made them indistinguishable whenever they were on
                          // different rows. Selection stays a flat cyan wash plus
                          // the lit leading edge below; pointing is a gold light
                          // that follows the cursor across the row and is gone
                          // when it leaves. Both are input-driven, so neither can
                          // be stranded by the frozen timeline.
                          className="mo-field mo-sheen flex w-full cursor-pointer items-baseline gap-3 px-5 py-2 text-left"
                          style={{
                            background: isActive ? 'oklch(0.78 0.115 228 / 0.16)' : 'transparent',
                            // The lit leading edge, drawn as an inset shadow and
                            // applied instantly rather than transitioned - it is
                            // state, and the whole point is that arrowing moves
                            // it on the very next paint. A wash alone was hard to
                            // place at a glance in a list of six near-identical
                            // rows; an edge is a position, not a tint.
                            boxShadow: isActive ? 'inset 2px 0 0 0 var(--color-tenno-300)' : undefined,
                          }}
                        >
                          <span
                            aria-hidden
                            className="size-[5px] shrink-0 rotate-45"
                            style={{ background: isActive ? 'var(--color-tenno-300)' : 'var(--text-ghost)' }}
                          />
                          <span
                            className="min-w-0 flex-1 truncate font-[family-name:var(--font-display)] text-[length:var(--text-small)]"
                            style={{ color: isActive ? 'var(--text)' : 'var(--text-muted)' }}
                          >
                            {e.label}
                          </span>
                          {e.hint !== undefined && (
                            <span className="shrink-0 text-[length:var(--text-micro)] tracking-[0.08em]" style={{ color: 'var(--text-ghost)' }}>
                              {e.hint}
                            </span>
                          )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-4 border-t px-5 py-2" style={{ borderColor: 'var(--hairline)' }}>
            <span className="eyebrow">↑↓ move</span>
            <span className="eyebrow">enter go</span>
            {index !== null && (
              <span className="eyebrow ml-auto">{index.length.toLocaleString()} places to go</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
