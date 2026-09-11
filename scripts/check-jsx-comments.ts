/**
 * A comment in JSX child position is not a comment. It is text.
 *
 * WHY THIS EXISTS
 * ───────────────
 * In JSX, a comment between elements must be wrapped in braces:
 *
 *     {/* like this *\/}
 *
 * Written bare, the same characters are CHILDREN, and React renders them. The
 * slash-star and every word after it appear on screen, in the middle of a
 * panel, in the player's face. There is no error, no warning, no type failure:
 * a string is a perfectly legal JSX child, so TypeScript is satisfied, ESLint
 * is satisfied, the build succeeds and the app ships with a code comment
 * printed in the interface.
 *
 * It happened during the nesting pass, in a file full of long house-style
 * comments, and it was caught by a linter looking for something else entirely.
 * The house style here is long explanatory comments and a lot of JSX, which is
 * exactly the combination that makes this recur, so it is a check now.
 *
 * WHAT IS CHECKED
 * ───────────────
 * A line whose first non-space characters open a block comment, where the
 * PREVIOUS non-blank line ended in a way that means we are inside JSX children:
 * a closing tag, a self-closing tag, or an opening tag's `>`.
 *
 * The check is deliberately conservative. It cannot parse JSX and does not try;
 * it looks for the exact shape the mistake takes and accepts that a cleverer
 * arrangement could slip past. A check that catches the way this actually
 * happens is worth more than no check at all.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * Does this line leave us inside JSX children?
 *
 * `>` or `/>` at the end covers an opening tag and a self-closing one;
 * `</Thing>` covers a sibling that just closed. A line ending in `(`, `{`, `,`
 * or `=>` is code, not children, and is where a legitimate block comment sits.
 */
function opensChildren(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  if (!t.endsWith('>')) return false;
  // An arrow function's `=>` also ends in `>` and is emphatically not JSX.
  if (t.endsWith('=>')) return false;
  // A generic type argument list, e.g. `useState<Record<string, X>>(`.
  if (/[),;]\s*$/.test(t)) return false;
  return true;
}

let checked = 0;
const failures: string[] = [];

for (const file of walk(join(root, 'src'))) {
  const lines = readFileSync(file, 'utf8').split('\n');
  checked += 1;

  let prev = '';
  let inBlock = false;
  for (const [i, raw] of lines.entries()) {
    const line = raw ?? '';
    const t = line.trim();

    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      continue;
    }

    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      if (opensChildren(prev)) {
        failures.push(
          `${file.slice(root.length)}:${String(i + 1)} a block comment in JSX child position renders as TEXT — wrap it in braces`,
        );
      }
    }

    if (t.length > 0) prev = line;
  }
}

/*
 * `aria-controls` MUST NAME AN ELEMENT THAT EXISTS.
 * ────────────────────────
 * The attribute is a promise that the element is there, and a screen reader
 * following it to nothing is worse off than with the plain button it would
 * otherwise have announced.
 *
 * SCOPE: only the unambiguous case - an id nothing in the file renders at all.
 *
 * The first version of this check also tried to catch the subtler fault, where
 * the region exists but sits inside `{open && ...}` so the reference dangles
 * while closed. That is a real bug and `Disclosure.tsx` had it. But deciding
 * whether a particular `id={x}` is inside a conditional needs a JSX parse, and
 * the file-wide approximation flagged two components that are perfectly correct
 * - `Clamp`, whose region is unconditional, and the command palette, whose
 * listbox is a sibling of its input. Zero true positives, two false alarms: a
 * check like that teaches its reader to ignore it.
 */
{
  let checkedAria = 0;
  const dangling: string[] = [];
  for (const file of walk(join(root, 'src'))) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('aria-controls')) continue;
    checkedAria += 1;
    for (const m of src.matchAll(/aria-controls=\{(?:[^{}]*\?\s*)?([A-Za-z_$][\w$]*)/g)) {
      const name = m[1];
      if (name === undefined) continue;
      /*
       * Plain string tests, built by concatenation. There is no regex here on
       * purpose: three patch scripts in this repo have lost a backslash on the
       * way to disk, and a pattern that quietly stops matching is exactly the
       * failure this gate exists to catch.
       *
       * Two spellings count as rendering the id: `id={name}` directly, and
       * `id={`${name}-...`}` where it is a prefix of a composed id.
       */
      const direct = 'id={' + name;
      const composed = 'id={' + String.fromCharCode(96) + '${' + name + '}';
      const renders = src.includes(direct) || src.includes(composed);
      if (!renders) {
        dangling.push(`${basename(file)}: aria-controls={${name}} but nothing renders id={${name}}`);
      }
    }
  }
  failures.push(...dangling);
  console.log(`  ok    every aria-controls in ${String(checkedAria)} components names an id that exists`);
}

/*
 * A CHAMFERED CONTROL MUST CARRY `rf-clipped`, OR ITS FOCUS RING IS CUT OFF.
 * ────────────────────────
 * `clip-path` clips an element's entire painting, and an outline is part of
 * that painting. So the global `:focus-visible { outline: 2px solid }` draws a
 * ring on a chamfered button and the chamfer immediately cuts it away - a
 * keyboard user tabbing through sees nothing move.
 *
 * `theme.css` already knows this: `.rf-clipped:focus-visible` swaps the outline
 * for an INSET box-shadow, which is inside the clip and survives. The comment
 * there says a keyboard user "could not see where they were on any of the
 * buttons that matter".
 *
 * That fix was applied per element, and 42 of the 78 focusable controls on the
 * platinum panel never received it - including every disclosure summary, so
 * every bound step, and the whole panel navigation. The fix was right and its
 * COVERAGE was the bug, which is invisible to any check that only asks whether
 * the mechanism exists.
 *
 * The rule: a focusable element whose own JSX sets a clip-path has to carry
 * `rf-clipped`. Checked on the source rather than the DOM, so it fails at build
 * rather than on somebody's screen.
 */
{
  let chamfered = 0;
  for (const file of walk(join(root, 'src'))) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('clipPath')) continue;

    /*
     * Element by element: split on the tag opener so a clipPath in one element
     * cannot excuse a missing class on another. Only `<button`, since that is
     * what focus rings are for - a clipped `<div>` has nothing to lose.
     */
    for (const chunk of src.split('<button').slice(1)) {
      /*
       * The opening tag ends at the first `>` that is NOT inside braces.
       *
       * Slicing at the first `>` outright - which is what this did - stops at
       * the arrow in `onClick={() => ...}`, so everything after it, including
       * the `style={{ clipPath }}`, was never examined. The gate reported four
       * chamfered buttons and passed while the disclosure summary, the control
       * behind every bound step, was invisible to it. A check that certifies
       * what it did not read is worse than no check.
       */
      let depth = 0;
      let end = -1;
      for (let i = 0; i < chunk.length; i += 1) {
        const c = chunk[i];
        if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        else if (c === '>' && depth === 0) {
          end = i;
          break;
        }
      }
      if (end === -1) continue;
      const open = chunk.slice(0, end + 1);
      if (!open.includes('clipPath')) continue;
      chamfered += 1;
      if (!open.includes('rf-clipped')) {
        failures.push(
          `${basename(file)}: a <button> sets clipPath without rf-clipped, so its focus ring is clipped away`,
        );
      }
    }
  }
  console.log(`  ok    all ${String(chamfered)} chamfered buttons keep a focus ring the clip cannot cut`);
}

assert.equal(failures.length, 0, `\n  ${failures.join('\n  ')}\n`);

console.log('  ok    no block comment sits in JSX child position where it would render as text');
console.log(`\n${String(checked)} components carry their comments as comments\n`);
