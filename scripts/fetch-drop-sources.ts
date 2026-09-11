/**
 * Vendor the drop SOURCES for cosmetics, and nothing else.
 *
 * WHY VENDOR RATHER THAN FETCH
 * ────────────────────────────
 * Two steps ask where a cosmetic comes from - "find which mission or boss drops
 * the scene you want" and "pick a specific ephemera and find its source" - and
 * the answer lives in `drops.warframestat.us`, which is 4.3 MB of 44,016 rows.
 * Pulling that at runtime would be the opposite of gentle: it exceeds a typical
 * `localStorage` quota, so `gentle` would fail to persist it and re-fetch the
 * whole thing every session, for 79 rows.
 *
 * So the 79 rows are extracted here and written to `vendor/`, the same way the
 * node, quest and junction tables already are. The app then answers from a few
 * kilobytes on disk with no network call at all, and
 * `check-drop-sources.ts` re-checks the file against the live table.
 *
 * WHY THIS IS NOT THE JOIN THAT WAS REMOVED
 * ────────────────────────────
 * `plat-value.ts` records that the drop tables were dropped as a source because
 * their rows name rewards only by DISPLAY NAME, so joining them to market
 * prices was a string guess that failed silently and under-reported value.
 * That objection is about the PRICE join, and there is no price join here: the
 * question is "where does this drop", the answer is the row's own `place`
 * field, and the item name is the label rather than a key into anything.
 *
 * Run: node scripts/fetch-drop-sources.ts
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SOURCE = 'https://drops.warframestat.us/data/all.slim.json';

/** A row as the drop table publishes it. */
interface DropRow {
  place?: unknown;
  item?: unknown;
  rarity?: unknown;
  chance?: unknown;
}

/** What gets vendored. */
interface Source {
  item: string;
  place: string;
  rarity: string | null;
  /** Per cent. The table gives this as a number OR a string; normalised here. */
  chance: number | null;
}

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'src', 'data', 'vendor', 'drop-sources.json');

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  // The table is inconsistent: ephemera chances arrive as strings, scenes as numbers.
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`the drop table responded ${String(res.status)}`);
const body: unknown = await res.json();
const rows: unknown[] = Array.isArray(body) ? body : Object.values(body as object);
if (rows.length < 10_000) throw new Error(`the drop table returned only ${String(rows.length)} rows`);

const kept: Source[] = [];
for (const raw of rows) {
  const r = raw as DropRow;
  const item = typeof r.item === 'string' ? r.item : null;
  const place = typeof r.place === 'string' ? r.place : null;
  if (item === null || place === null) continue;
  /*
   * The families the guide asks about, and no others: a targeted extract,
   * not a second copy of the drop table.
   *
   * The Duviri riven rows are here for a different reason from the cosmetics.
   * The guide QUOTES their percentages - "Melee at 11.9 per cent, Pistol and
   * Rifle at 8.5 each" - and a quoted number is a claim that rots silently
   * when DE retunes a table. Vendoring them lets `check-drop-sources.ts` hold
   * the prose to the figures.
   */
  const cosmetic = /\bscene\b/i.test(item) || /\bephemera\b/i.test(item);
  const duviriRiven = /riven/i.test(item) && /Duviri\/Endless/i.test(place);
  if (!cosmetic && !duviriRiven) continue;
  kept.push({
    item,
    // The table marks difficulty with HTML: "Tier 6 (<b>Hard</b>)".
    place: place.replace(/<[^>]+>/g, ''),
    rarity: typeof r.rarity === 'string' ? r.rarity : null,
    chance: num(r.chance),
  });
}

kept.sort((a, b) => a.item.localeCompare(b.item) || a.place.localeCompare(b.place));

const file = {
  /** Where this came from, so a refresh needs no archaeology. */
  source: SOURCE,
  note: 'Scene and ephemera sources, plus the Duviri riven rows the guide quotes. Regenerate with scripts/fetch-drop-sources.ts',
  sources: kept,
};

writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`, 'utf8');

const items = new Set(kept.map((k) => k.item));
console.log(`wrote ${String(kept.length)} rows for ${String(items.size)} cosmetics to vendor/drop-sources.json`);
