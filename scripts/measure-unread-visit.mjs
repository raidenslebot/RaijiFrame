/*
 * WHAT THE GAME SAID DURING A VISIT THIS APP COULD NOT READ.
 *
 * The account's log contains exactly one open on an arsenal row outside the
 * four (`_T.upgradeItemSlot (_Mod): 6`), and it is the whole of what stands
 * between this overlay and companions, archwings and necramechs. The app learns
 * such a row from the first mod touched on it - placed, or flagged as a
 * duplicate - and `npm run replay` reports that this visit touched nothing.
 *
 * "Nothing was touched" is a claim about the two lines the app looks at. This
 * asks the wider question: what did the game emit AT ALL between that open and
 * its close? If something in there identifies the item, the app is missing a
 * signal. If not, the log is exhausted and the answer has to come from a future
 * visit rather than from more reading.
 *
 * PRIVACY. No line is printed, stored or returned. What comes out is a count
 * per line SHAPE - the leading script or subsystem tag, with every number,
 * quoted string, path and identifier removed - plus the parser's own event
 * types. The two lines that carry a display name are not among the shapes that
 * can survive that reduction, and nothing is written to disk.
 */
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

const HOME = (process.env.LOCALAPPDATA ?? `${process.env.USERPROFILE ?? ''}/AppData/Local`).split('\\').join('/');
const LOG = `${HOME}/Warframe/EE.log`;

/** A line reduced to its shape: no numbers, no paths, no quoted text, no names. */
function shapeOf(line) {
  return line
    .replace(/^\d+\.\d+\s*/, '')
    .replace(/\/Lotus\/\S+/g, '<path>')
    .replace(/"[^"]*"/g, '<str>')
    .replace(/\b\d[\d,.]*\b/g, '<n>')
    .replace(/\b[0-9A-Fa-f]{16,}\b/g, '<id>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110);
}

if (!existsSync(LOG)) {
  console.log(`no EE.log at ${LOG}`);
} else {
  const UNREAD = new Set([4, 5, 6, 7, 8, 9, 10]);
  let inVisit = false;
  let row = null;
  let lines = 0;
  const shapes = new Map();
  let visits = 0;

  const rl = createInterface({ input: createReadStream(LOG, { encoding: 'latin1' }), crlfDelay: Infinity });
  for await (const line of rl) {
    lines++;

    const press = /_T\.upgradeItemSlot \(_Mod\):\s+(\d+)/.exec(line);
    if (press) {
      const n = Number(press[1]);
      inVisit = UNREAD.has(n);
      row = inVisit ? n : null;
      if (inVisit) visits++;
      continue;
    }

    if (!inVisit) continue;

    if (line.includes('Background::GoToPreviousScreen(')) {
      inVisit = false;
      row = null;
      continue;
    }

    const s = shapeOf(line);
    if (s.length > 0) shapes.set(s, (shapes.get(s) ?? 0) + 1);
  }

  console.log(`${lines.toLocaleString('en-US')} lines read`);
  console.log(`${String(visits)} visit(s) on an arsenal row this app does not read\n`);
  if (shapes.size === 0) {
    console.log('  the game emitted nothing at all between that open and its close');
  } else {
    console.log(`  ${String(shapes.size)} distinct line shapes were emitted during it:\n`);
    for (const [s, n] of [...shapes].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${s}`);
  }
}
