/**
 * Every market slug this app hardcodes must be a real warframe.market item.
 *
 * WHY THIS CAN GO WRONG SILENTLY
 * ──────────────────────────────
 * The data layer names 38 items by slug - `primed_continuity`, `archon_vitality`,
 * `ayatan_anasa_sculpture` - and those slugs are what the price reader asks for.
 * A slug with a typo, or one DE renamed in a patch, does not throw: the lookup
 * simply finds nothing, the price comes back null, and the honest-null discipline
 * everywhere else renders that as "no recent trades". The item looks unsellable
 * rather than misspelled, and a whole farming method quietly loses its numbers.
 *
 * That is the worst shape of bug this codebase has: a correctness failure
 * wearing the costume of an honest unknown. Nothing else can catch it, because
 * every layer downstream is behaving exactly as designed.
 *
 * OFFLINE IS A SKIP, NOT A FAILURE
 * ────────────────────────────────
 * This is the only check in the suite that needs the network. A developer on a
 * train must not be told their slugs are broken because a fetch timed out, so an
 * unreachable catalog reports SKIP and exits zero. The check is real whenever
 * there is a connection, which is every time it matters.
 *
 * Run: node scripts/check-slugs.ts
 */
import assert from 'node:assert/strict';
import { PLAT_ROUTES } from '../src/data/plat-routes.ts';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DATA = join(import.meta.dirname, '..', 'src', 'data');

/**
 * Literals that LOOK like slugs and are not.
 *
 * It was empty, and stayed empty for 38 real slugs. Two entries now, both from
 * `modstats.ts`, and both named here rather than excluded by loosening the
 * pattern - a wider regex would have stopped checking some real slug too, which
 * is the failure this whole file exists to prevent.
 *
 * `add_pct` and `add_flat` are the two arithmetic kinds a parsed mod effect can
 * have: a percentage of the base stat, or a flat quantity in the stat's own
 * unit. They are compared against in `modded.ts` and never sent anywhere near
 * warframe.market. Nothing else in that file is slug-shaped.
 */
const NOT_SLUGS = new Set<string>(['add_pct', 'add_flat']);

/**
 * Every string this app uses as a market slug.
 *
 * TWO PASSES, AND THE SECOND ONE EXISTS BECAUSE THE FIRST MISSED FOUR.
 * ————————————————————————————————————————————
 * The lower_snake pass below is the broad net, and it silently skipped every
 * single-word slug: the four Requiem mods are `oull`, `xata`, `jahu` and
 * `vome`, which carry no underscore and so never matched. They happen to be
 * real - checked - but they were correct by luck rather than by this file, and
 * a gate with a hole in exactly the shape of the shortest slugs is a gate that
 * would have passed a typo in any of them.
 *
 * So the second pass reads `slugs: [...]` arrays directly. Anything declared
 * there is a market slug BY CONSTRUCTION, whatever it looks like, which makes
 * that pass exact where the first is heuristic.
 */
function slugLiterals(): Map<string, string> {
  const found = new Map<string, string>();
  const note = (slug: string | undefined, file: string): void => {
    if (slug === undefined || NOT_SLUGS.has(slug) || found.has(slug)) return;
    found.set(slug, file);
  };

  for (const file of readdirSync(DATA).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join(DATA, file), 'utf8');

    // Broad: anything shaped like a slug, anywhere.
    for (const m of src.matchAll(/'([a-z0-9]+(?:_[a-z0-9]+){1,5})'/g)) note(m[1], file);

    // Exact: everything inside a `slugs: [ ... ]` array, regardless of shape.
    for (const arr of src.matchAll(/slugs:\s*\[([^\]]*)\]/g)) {
      for (const s of (arr[1] ?? '').matchAll(/'([^']+)'/g)) note(s[1], file);
    }
  }
  return found;
}

/*
 * A "PAYS NOTHING" VERDICT IS THE STRONGEST CLAIM THIS APP MAKES.
 * ────────────────────────
 * Four routes carry a `paysNothing` note, and `routeState` turns it into a
 * verdict that tells the player not to bother. That is the one kind of error
 * nobody ever reports: a route wrongly marked unsellable is simply never
 * opened, so the mistake never surfaces as a complaint - it just quietly costs
 * somebody the best route on the list.
 *
 * Each note rests on the same factual claim: no item of that family exists on
 * warframe.market. That is checkable against the catalogue this file already
 * fetches, so it is checked.
 *
 * The terms live here rather than being parsed out of the prose, because a
 * regex over English would fail open - a reworded sentence would silently stop
 * being checked, which is the failure this exists to prevent.
 */
const PAYS_NOTHING_TERMS: Readonly<Record<string, readonly RegExp[]>> = {
  'riven-archon': [/archon_shard/],
  // The Circuit pays Incarnon adapters and Duviri resources; neither is listed.
  'riven-circuit': [/incarnon/],
  holokeys: [/^tenet_/, /holokey/],
  ephemera: [/ephemera/],
};

function checkPaysNothing(slugs: ReadonlySet<string>): string[] {
  const bad: string[] = [];

  /*
   * Every route making the claim must be listed. A new `paysNothing` added
   * without a term here would be an unchecked verdict, which is exactly the
   * state all four were in until now.
   */
  for (const route of PLAT_ROUTES) {
    if (route.paysNothing === undefined) continue;
    if (!(route.id in PAYS_NOTHING_TERMS)) {
      bad.push(`${route.id} says it pays nothing, but no term is listed here to verify that`);
    }
  }

  for (const [id, terms] of Object.entries(PAYS_NOTHING_TERMS)) {
    const route = PLAT_ROUTES.find((r) => r.id === id);
    if (route === undefined) {
      bad.push(`${id} is listed here but is no longer a route`);
      continue;
    }
    if (route.paysNothing === undefined) {
      bad.push(`${id} no longer claims to pay nothing - drop its terms from this list`);
      continue;
    }
    for (const term of terms) {
      const found = [...slugs].filter((n) => term.test(n));
      if (found.length > 0) {
        bad.push(
          `${id} says nothing of this kind is on the market, but ${String(found.length)} ` +
            `${found.length === 1 ? 'item matches' : 'items match'} ${String(term)}: ${found.slice(0, 4).join(', ')}`,
        );
      }
    }
  }
  return bad;
}

async function main(): Promise<void> {
  const literals = slugLiterals();

  let known: Set<string>;
  try {
    const res = await fetch('https://api.warframe.market/v2/items', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`catalog responded ${String(res.status)}`);
    const body: unknown = await res.json();
    const rows: unknown[] = Array.isArray(body) ? body : ((body as { data?: unknown[] }).data ?? []);
    known = new Set(rows.map((r) => (r as { slug?: unknown }).slug).filter((s): s is string => typeof s === 'string'));
    assert.ok(known.size > 1000, `the catalog returned only ${String(known.size)} items, which is not a catalog`);
  } catch (err) {
    console.log(`  SKIP  market catalog unreachable (${err instanceof Error ? err.message : String(err)})`);
    console.log(`\n${String(literals.size)} slugs left unverified; run again with a connection`);
    return;
  }

  const bad = [...literals].filter(([slug]) => !known.has(slug));
  for (const [slug, file] of bad) console.log(`  FAIL  ${slug} is not a warframe.market item (${file})`);

  assert.deepEqual(
    bad.map(([s]) => s),
    [],
    'a hardcoded slug does not exist, so its price will silently read as "no recent trades"',
  );

  console.log(`  ok    all ${String(literals.size)} hardcoded slugs exist in a catalog of ${String(known.size)}`);

  const unpaid = checkPaysNothing(known);
  for (const line of unpaid) console.log(`  FAIL  ${line}`);
  assert.deepEqual(unpaid, [], 'a route tells players not to bother with something the market does sell');
  console.log(
    `  ok    all ${String(Object.keys(PAYS_NOTHING_TERMS).length)} "pays nothing" verdicts still hold against the catalog`,
  );
  console.log('\nevery slug this app names is a real item');
}

await main();
