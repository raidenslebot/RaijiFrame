/*
 * NO SOURCE FILE CARRIES A CONTROL CHARACTER.
 *
 * This trap has now bitten this project twice, and the second time it reached
 * SHIPPED code and stayed green.
 *
 * Escape-bearing edits are written from a script, and in a plain Python string
 * literal `\b` is a BACKSPACE (0x08), not a word boundary. So
 * `/\bmoa\b/i` was written into `src/data/optimise.ts` as `/<BS>moa<BS>/i` - a
 * regex that matches nothing. Every Moa companion therefore fell through to the
 * beast branch and was planned with a kubrow's mods. The gate meant to catch
 * exactly that was written from the same script and carried the same two bytes,
 * so it looked for the same impossible string and passed. The first time it was
 * a NUL, which additionally made the file invisible to ripgrep.
 *
 * What makes it dangerous is that everything else is happy: the file is valid
 * UTF-8, `tsc` compiles it, eslint passes, the regex is syntactically fine, and
 * the only symptom is a match that never happens. Nothing else here can see it,
 * so this looks for the bytes themselves.
 *
 * TAB and the line endings are excluded - those are legitimate. Everything else
 * below 0x20, plus DEL, is not something anybody types on purpose in this
 * codebase, and a real need for one would be written as an escape (`\u0000`)
 * rather than as the byte.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\//, '');
const LOOK_IN = ['src', 'scripts', 'docs'];
const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.css', '.json', '.md', '.html'];

/** Everything under 0x20 except tab, newline and carriage return, plus DEL. */
const FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === 'node_modules' || name === 'vendor' || name.startsWith('.')) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

const files: string[] = [];
for (const dir of LOOK_IN) {
  try {
    walk(join(ROOT, dir), files);
  } catch {
    // A directory that is not there is not a failure; the others still count.
  }
}

const bad: string[] = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (!FORBIDDEN.test(text)) continue;
  text.split('\n').forEach((line, i) => {
    const at = line.search(FORBIDDEN);
    if (at === -1) return;
    const code = line.charCodeAt(at).toString(16).padStart(4, '0');
    bad.push(`${file.slice(ROOT.length)}:${String(i + 1)} holds U+${code.toUpperCase()} at column ${String(at + 1)}`);
  });
}

assert.deepEqual(
  bad,
  [],
  `a control character reached a source file - almost certainly a \\b, \\a or \\0 written from a plain string literal instead of a raw one:\n        ${bad.join('\n        ')}`,
);

console.log(`\n  ok    ${String(files.length)} source files, not one control character\n`);
