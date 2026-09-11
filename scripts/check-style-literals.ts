/**
 * A backtick inside a <style> template literal ends the literal.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Every panel in this app carries its keyframes in a JSX `<style>{`...`}</style>`
 * block, and every one of those blocks is commented in this project's house
 * style - long comments that name what was wrong before. Those comments refer to
 * selectors and properties, and the natural way to write a selector in prose is
 * to put it in backticks.
 *
 * A backtick inside a template literal closes the template literal. The CSS
 * after it becomes JavaScript, and the error TypeScript reports is somewhere
 * else entirely: a property access on a string, an undefined identifier, a
 * missing brace forty lines down. Nothing in the message mentions the backtick.
 * It happened three times in one sitting, each time costing a diagnosis, which
 * is exactly the shape of defect a gate is for: cheap to detect, expensive to
 * find by hand, and certain to recur.
 *
 * WHAT IS CHECKED
 * ───────────────
 * Inside any `<style>{` ... `}</style>` block, no backtick and no `${`. The
 * second is the same class of mistake: an unintended interpolation in what was
 * meant to be literal CSS.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

let checked = 0;
let blocks = 0;
const failures: string[] = [];

for (const file of walk(join(root, 'src'))) {
  const src = readFileSync(file, 'utf8');
  checked += 1;

  /*
   * Walk the file rather than regex the whole thing: a lazy match would stop at
   * the first `}` inside the CSS and report nothing useful.
   */
  let from = 0;
  for (;;) {
    const open = src.indexOf('<style>{`', from);
    if (open === -1) break;
    const start = open + '<style>{`'.length;
    const close = src.indexOf('`}</style>', start);
    if (close === -1) {
      failures.push(`${file.slice(root.length)}: a <style> block is never closed`);
      break;
    }
    blocks += 1;
    const body = src.slice(start, close);
    const line = src.slice(0, start).split('\n').length;

    if (body.includes('`')) {
      const at = line + body.slice(0, body.indexOf('`')).split('\n').length - 1;
      failures.push(
        `${file.slice(root.length)}:${String(at)} a backtick inside a <style> literal ends it — ` +
          'write the selector without backticks',
      );
    }
    if (body.includes('${')) {
      const at = line + body.slice(0, body.indexOf('${')).split('\n').length - 1;
      failures.push(`${file.slice(root.length)}:${String(at)} an interpolation inside a <style> literal`);
    }
    from = close;
  }
}

assert.equal(failures.length, 0, `\n  ${failures.join('\n  ')}\n`);

console.log(`  ok    no <style> literal is broken by a backtick or an interpolation`);
console.log(`\n${String(blocks)} style blocks across ${String(checked)} components hold together\n`);
