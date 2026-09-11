/**
 * Guard: no fabricated account data may ship.
 *
 * This exists because it already happened. Agents building panels in parallel
 * produced demo pages that invented an account - a Kuva Lich with 143 thralls
 * killed, owned-weapon tallies, syndicate standings - and those pages took over
 * the dev server root. Every number on screen was made up.
 *
 * A screenshot of invented state is worse than no screenshot. It hides exactly
 * the bugs that only real input exposes, and it misrepresents what the app can
 * actually do. Real account data comes from ONE place: Overwolf's GEP
 * `match_info.inventory` while the game is running (plus EE.log for live
 * mission events). Anything else in the source tree that looks like an account
 * is a fabrication.
 *
 * Test fixtures are exempt: `scripts/check-*.ts` must construct small synthetic
 * accounts to assert behaviour, and those never reach a user.
 *
 * Run: node scripts/check-no-fabricated-data.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const SRC = join(repo, 'src');

/** Vendored game datasets are reference data about the game, not about a player. */
const EXEMPT_DIRS = [join('src', 'data', 'vendor')];

/**
 * Patterns that indicate an invented ACCOUNT, not game reference data.
 *
 * The distinction that matters: `SolNode167` appearing in the star-chart dataset
 * is a fact about the game. `{ Tag: 'SolNode167', Completes: 3 }` in a component
 * is a claim about a player who does not exist.
 */
const SIGNATURES: Array<{ re: RegExp; why: string }> = [
  { re: /Completes\s*:\s*\d+/, why: 'invented mission completion count' },
  { re: /PlayerLevel\s*:\s*\d+/, why: 'invented mastery rank' },
  { re: /ItemType\s*:\s*['"`]\/Lotus/, why: 'invented owned item' },
  { re: /XPInfo\s*:\s*\[/, why: 'invented mastery XP table' },
  { re: /QuestKeys\s*:\s*\[/, why: 'invented quest completion' },
  { re: /RegularCredits\s*:\s*\d+/, why: 'invented credit balance' },
  { re: /PremiumCredits\s*:\s*\d+/, why: 'invented platinum balance' },
  { re: /thralls?Killed\s*:\s*\d+/i, why: 'invented nemesis progress' },
  { re: /\bmock(?:Account|Inventory|Data)\b/i, why: 'mock account object' },
  { re: /\b(?:fake|dummy|sample|demo)(?:Account|Inventory|Player)\b/i, why: 'placeholder account object' },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (EXEMPT_DIRS.some((e) => relative(repo, full).startsWith(e))) continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const findings: string[] = [];
for (const file of walk(SRC)) {
  const rel = relative(repo, file).split(sep).join('/');
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    // A comment describing the rule is not a violation of it.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    /*
     * Narrow, deliberate escape hatch.
     *
     * Some lines legitimately build an account-shaped object out of REAL data -
     * mapping live EE.log node ids into the shape `derive()` expects, for
     * instance. Those are adapters, not inventions.
     *
     * It is a per-line opt-in requiring an explicit marker on the previous line,
     * so it cannot be applied wholesale, and every use is greppable. Loosening
     * the patterns instead would let genuine fabrications back through.
     */
    if (/real-data-adapter/.test(lines[i - 1] ?? '')) return;
    for (const sig of SIGNATURES) {
      if (sig.re.test(line)) {
        findings.push(`${rel}:${i + 1}  ${sig.why}\n      ${line.trim().slice(0, 110)}`);
      }
    }
  });
}

if (findings.length) {
  console.error('FABRICATED ACCOUNT DATA FOUND IN src/\n');
  for (const f of findings) console.error('  ' + f);
  console.error(
    `\n${findings.length} occurrence(s).` +
      '\nReal account data comes only from GEP match_info.inventory (game running)' +
      '\nor EE.log. If a panel needs something to render, render an honest empty' +
      '\nstate that says what is missing - never invent a plausible account.',
  );
  process.exitCode = 1;
} else {
  console.log('  ok    no fabricated account data in src/');
  console.log('\nonly real sources: GEP match_info.inventory, EE.log');
}
