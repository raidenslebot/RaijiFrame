/**
 * The resource catalog.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The Resources panel refused to render anything without an account, on the
 * grounds that a resource stock is by definition yours. That reasoning was
 * wrong in the same way it was wrong for Mastery, Collection, Focus, Intrinsics,
 * Syndicates, Nemesis and Daily: WHICH resources exist, what they are, and what
 * they look like are all game data. Only how many you hold is yours.
 *
 * WFCD publishes them with names, types, descriptions and artwork, across
 * Resources.json and the resource rows of Misc.json, from the same source the
 * item catalog already uses. Nothing new had to be invented
 * to make this panel useful before the game has ever run.
 *
 * Kept separate from `itemdb.ts` deliberately: that module's `ITEM_CATEGORIES`
 * are the MASTERABLE equipment categories and its whole shape — `masterable`
 * counts, ownership reports, mastery denominators — is about equipment. Resources
 * are a different kind of thing and folding them in would have meant special-
 * casing them out of every one of those calculations.
 */

const WFCD = 'https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/';

export interface ResourceEntry {
  uniqueName: string;
  name: string;
  /** WFCD's display type, e.g. `Resource`, `Gem`, `Fish`. */
  type: string | null;
  description: string | null;
  imageName: string | null;
  tradable: boolean;
}

export interface ResourceDb {
  /** Keyed by `uniqueName` so an inventory row joins directly. */
  byType: ReadonlyMap<string, ResourceEntry>;
  all: readonly ResourceEntry[];
  /** True when the fetch failed. The count is then UNKNOWN, never zero. */
  failed: boolean;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/**
 * The classic planet drops - Ferrite, Neurodes, Nano Spores, Morphics, Oxium -
 * are NOT in WFCD's Resources.json. They sit in Misc.json, typed `Resource` or
 * `Misc`, under the same `/Lotus/Types/Items/MiscItems/` path the account's
 * `MiscItems[]` rows use. Without them the most common resources a player
 * holds joined nothing and every one of them read "not in the catalog".
 */
const MISC_ITEMS = '/Lotus/Types/Items/MiscItems/';
export function isMiscResource(row: { uniqueName: string; type: string | null }): boolean {
  return row.uniqueName.startsWith(MISC_ITEMS) && (row.type === 'Resource' || row.type === 'Misc');
}

export function parseResources(body: string, keep: (row: ResourceEntry) => boolean = () => true): ResourceEntry[] {
  const raw: unknown = JSON.parse(body);
  if (!Array.isArray(raw)) return [];

  const out: ResourceEntry[] = [];
  for (const r of raw) {
    const row = r as Record<string, unknown> | null;
    const uniqueName = str(row?.['uniqueName']);
    const name = str(row?.['name']);
    // A row without both is unusable as a catalog entry; dropping it is correct
    // and is not the same as inventing one.
    if (uniqueName === null || name === null) continue;
    if (!keep({ uniqueName, name, type: str(row?.['type']), description: null, imageName: null, tradable: false })) continue;

    out.push({
      uniqueName,
      name,
      type: str(row?.['type']),
      // WFCD keeps the game's inline tokens ("sold for <CREDITS>Credits"); they are markup, not words.
      description: str(row?.['description'])?.replace(/<[A-Z_]+>/g, '') ?? null,
      imageName: str(row?.['imageName']),
      tradable: row?.['tradable'] === true,
    });
  }
  // Stable order so the panel does not reshuffle between loads.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

const EMPTY: ResourceDb = { byType: new Map(), all: [], failed: true };

/**
 * Fetch and index the resource catalog.
 *
 * Goes through the same gentle read as the item catalog — 24h TTL, 6h floor,
 * persisted, conditional revalidation — so a repeat launch costs one 304.
 */
export async function loadResourceDb(): Promise<ResourceDb> {
  try {
    const { gentle, httpLoader, POLICY } = await import('../core/gentle');
    // Two reads, both conditional on a repeat launch. Misc.json is the one the
    // item catalog already pulls; it is read here under its own key because the
    // cache stores the PARSED value per key and the item catalog's parse keeps
    // only the nine masterable rows.
    const [res, misc] = await Promise.all([
      gentle.read('resourcedb', POLICY.staticData, httpLoader(`${WFCD}Resources.json`), parseResources),
      gentle.read('resourcedb:misc', POLICY.staticData, httpLoader(`${WFCD}Misc.json`), (body: string) => parseResources(body, isMiscResource)),
    ]);
    const all = [...(res.value ?? []), ...(misc.value ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    if (all.length === 0) return EMPTY;
    // Either half missing means the total is unknown; what did arrive still joins.
    return { byType: new Map(all.map((e) => [e.uniqueName, e])), all, failed: (res.value?.length ?? 0) === 0 || (misc.value?.length ?? 0) === 0 };
  } catch (err) {
    // A failed catalog means the totals are unknown. It must never present as
    // "there are no resources".
    console.warn('[resourcedb] unavailable', err);
    return EMPTY;
  }
}
