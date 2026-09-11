/**
 * The syndicate tags this app hardcodes must be DE's own.
 *
 * WHY THIS EXISTS
 * ────────────────────────
 * `account.ts` lists the `Affiliations[].Tag` values seen in a real account and
 * says plainly: do not hardcode a tag until a primary source confirms it. That
 * rule kept the Conclave route unanswered for a long time, on the grounds that
 * nobody had ever observed a Conclave tag.
 *
 * DE publishes the whole namespace. `ExportSyndicates.json` is keyed by exactly
 * these tags, and every one of the fifteen verified from a live account appears
 * in it - a 15-of-15 correspondence. `ConclaveSyndicate` is a key in the same
 * export, so it is attested by the same evidence as the rest.
 *
 * THAT CORRESPONDENCE IS THE WHOLE ARGUMENT, so it is checked rather than
 * asserted. If a verified tag ever stopped appearing in the export, the export
 * would not be the tag namespace, and the Conclave inference drawn from it
 * would collapse - along with the binding that reads a player's standing.
 *
 * OFFLINE IS A SKIP, like the other live gates.
 *
 * Run: node scripts/check-syndicate-tags.ts
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const EXPORT = 'https://cdn.jsdelivr.net/npm/warframe-public-export-plus@latest/ExportSyndicates.json';

/**
 * The tags `account.ts` records as seen in a live `Affiliations` array.
 *
 * This list is the EVIDENCE, not the thing being tested: each of these was
 * observed independently of the export, which is what makes their presence in
 * it meaningful rather than circular.
 */
const VERIFIED_FROM_ACCOUNTS: readonly string[] = [
  'ArbitersSyndicate',
  'CephalonSudaSyndicate',
  'CetusSyndicate',
  'EntratiSyndicate',
  'EntratiLabSyndicate',
  'EventSyndicate',
  'HexSyndicate',
  'KahlSyndicate',
  'LibrarySyndicate',
  'NewLokaSyndicate',
  'PerrinSyndicate',
  'RedVeilSyndicate',
  'SolarisSyndicate',
  'SteelMeridianSyndicate',
  'ZarimanSyndicate',
];

/** Tags this app reads that were NOT observed directly, and why that is allowed. */
const INFERRED: ReadonlyArray<{ tag: string; why: string }> = [
  {
    tag: 'ConclaveSyndicate',
    why: 'the Conclave route reads a player’s standing with it',
  },
];

/*
 * WHAT THIS GATE USED TO CHECK, AND WHY THAT WAS NOT ITS OWN CLAIM.
 * ────────────────────────────────────────────────────────────────
 * It validated the two lists ABOVE against the export and then printed "every
 * syndicate tag the app reads is one DE publishes" - a claim about the source
 * that it never once looked at the source to make. Measured: the app reads five
 * tags that appear in neither list. VoxSyndicate, VentKidsSyndicate,
 * QuillsSyndicate, NightcapJournalSyndicate and NecraloidSyndicate were all
 * outside everything this file checked, and all five happen to be real - which
 * is exactly the problem, because a hand-kept list beside the code is right
 * until the day somebody adds a tag and does not also edit this file, and that
 * day looks like every other day.
 *
 * So the source is scanned instead. Every `'...Syndicate'` literal the app
 * contains has to be a key in DE's export, and the two lists above keep their
 * separate job: they are the EVIDENCE that the export is the account's own tag
 * namespace, which is what makes membership in it mean anything at all.
 */
const SRC = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TAG_LITERAL = /'([A-Za-z]+Syndicate)'/g;

/**
 * Identifiers ending in `Syndicate` that are INVENTORY FIELD NAMES, not tags.
 *
 * `SupportedSyndicate` is the account field holding the tag you have pledged to.
 * It is a key in DE's payload and could never be a key in the syndicate export.
 * The exclusion is self-correcting rather than a mute button: if DE ever ships a
 * syndicate under this name the gate reports that the exclusion has gone wrong,
 * instead of quietly going on skipping a tag that has become real.
 */
const FIELD_NAMES: ReadonlyArray<{ name: string; why: string }> = [
  { name: 'SupportedSyndicate', why: 'an Inventory field carrying the pledged tag, never a tag itself' },
];

/** Every source file under `src/`, as a path relative to it. */
function sourceFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = prefix === '' ? entry : `${prefix}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, rel));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

/** Every distinct `'<name>Syndicate'` literal in the app, and where it was found. */
function tagsInSource(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const rel of sourceFiles(SRC)) {
    for (const m of readFileSync(join(SRC, rel), 'utf8').matchAll(TAG_LITERAL)) {
      const tag = m[1];
      if (tag === undefined) continue;
      const at = found.get(tag);
      if (at === undefined) found.set(tag, [rel]);
      else if (!at.includes(rel)) at.push(rel);
    }
  }
  return found;
}

async function main(): Promise<void> {
  let keys: Set<string>;
  try {
    const res = await fetch(EXPORT);
    if (!res.ok) throw new Error(`the export responded ${String(res.status)}`);
    const body: unknown = await res.json();
    assert.ok(body !== null && typeof body === 'object' && !Array.isArray(body), 'the export was not an object');
    keys = new Set(Object.keys(body as object));
    assert.ok(keys.size > 20, `the export returned only ${String(keys.size)} syndicates`);
  } catch (err) {
    console.log(`  SKIP  syndicate export unreachable (${err instanceof Error ? err.message : String(err)})`);
    console.log(`\n${String(INFERRED.length)} inferred tags left unverified; run again with a connection`);
    return;
  }

  const bad: string[] = [];

  /*
   * THE CORRESPONDENCE. Every independently-observed tag must be a key here.
   * A single miss means the export is keyed by something else, and every tag
   * taken from it on that basis is unsupported.
   */
  const absent = VERIFIED_FROM_ACCOUNTS.filter((t) => !keys.has(t));
  if (absent.length > 0) {
    bad.push(
      `the export is NOT the account tag namespace: ${absent.join(', ')} ` +
        `${absent.length === 1 ? 'was' : 'were'} seen in a real account but ${absent.length === 1 ? 'is' : 'are'} not a key. ` +
        'Every tag inferred from this export is now unsupported.',
    );
  }

  // And each inferred tag must actually be in it.
  for (const { tag, why } of INFERRED) {
    if (!keys.has(tag)) bad.push(`${tag} is not in the export, but ${why}`);
  }

  // The exclusions have to stay exclusions. A field name that became a real
  // syndicate would otherwise be skipped forever with nobody the wiser.
  const excluded = new Set(FIELD_NAMES.map((f) => f.name));
  for (const { name, why } of FIELD_NAMES) {
    if (keys.has(name)) {
      bad.push(`${name} is excluded as ${why}, but DE now publishes a syndicate under that name - the exclusion is wrong`);
    }
  }

  // AND THE CLAIM THIS FILE ACTUALLY MAKES: the source, not a list beside it.
  const inSource = tagsInSource();
  assert.ok(
    inSource.size > 10,
    `the source scan found only ${String(inSource.size)} syndicate literals - the scanner is broken, not the code`,
  );
  for (const [tag, files] of inSource) {
    if (excluded.has(tag)) continue;
    if (!keys.has(tag)) bad.push(`${tag} is read by ${files.join(', ')} but is not a key in DE's export - nothing attests it`);
  }

  for (const line of bad) console.log(`  FAIL  ${line}`);
  assert.deepEqual(bad, [], 'a hardcoded syndicate tag is not attested by DE’s own export');

  console.log(
    `  ok    all ${String(VERIFIED_FROM_ACCOUNTS.length)} observed tags are keys in the export, so the ${String(INFERRED.length)} inferred from it stand`,
  );
  console.log(
    `  ok    all ${String(inSource.size - excluded.size)} syndicate tags the source actually contains are keys in it too`,
  );
  console.log('\nevery syndicate tag the app reads is one DE publishes');
}

await main();
