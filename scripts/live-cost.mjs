/*
 * WHAT THE OVERLAY COSTS THE MACHINE THAT IS RUNNING THE GAME.
 *
 * "i dont want a laggy, unresponsive... overlay" is in the brief and has never
 * been measured against the running app - only the optimiser's own timings,
 * which are wall-clock inside one function. This asks Chromium directly, on the
 * live pages, twice, and reports the DELTA per second: how much of a second the
 * page spends running tasks, running script, and doing layout, plus the heap it
 * holds.
 *
 * A CAVEAT THE NUMBERS THEMSELVES DO NOT CARRY: when two of the app's pages
 * share one renderer process, `JSHeapUsedSize`, `Nodes` and `JSEventListeners`
 * come back identical for both, because those are the process's. The DURATIONS
 * are per page and are what this is for.
 *
 * Both windows are sampled. The controller is up the whole session, so its idle
 * cost is the one that matters most: a background page that burns a core while
 * the player is in a mission is a tax on every frame of the game.
 */
const PORT = '54284';
const GAP_MS = 10_000;

async function pages() {
  let list;
  try {
    list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  } catch {
    // The app restarts; a measurement taken across a restart is not a
    // measurement, so say so rather than throwing a stack at the reader.
    console.log(`nothing is listening on 127.0.0.1:${PORT} - Overwolf is not running, or the app is restarting`);
    return [];
  }
  /*
   * OURS ONLY. The first run of this reported three pages and two of them were
   * called "controller": Overwolf hosts other apps, and one of them serves a
   * `web/background.html` of its own. Measuring somebody else's overlay and
   * printing it as this one's is worse than not measuring.
   */
  const UID = 'ikfhfmdbnccchjijlbldkneodacahjaaodbbhmdd';
  return list.filter((t) => t.type === 'page' && t.url.includes(UID) && /background\.html|automod\.html|ingame\.html/.test(t.url));
}

function metrics(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const want = new Map();
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Performance.enable' }));
      ws.send(JSON.stringify({ id: 2, method: 'Performance.getMetrics' }));
    });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== 2) return;
      for (const x of m.result.metrics) want.set(x.name, x.value);
      resolve(want);
      ws.close();
    });
    ws.addEventListener('error', () => reject(new Error('refused')));
  });
}

const list = await pages();
if (list.length === 0) {
  console.log('the app is not running');
  process.exit(0);
}

const first = new Map();
for (const t of list) {
  try {
    first.set(t.id, await metrics(t));
  } catch {
    console.log('a window went away while it was being measured; run it again once the app has settled');
    process.exit(0);
  }
}
await new Promise((r) => setTimeout(r, GAP_MS));

for (const t of list) {
  const a = first.get(t.id);
  if (a === undefined) continue;
  let b;
  try {
    b = await metrics(t);
  } catch {
    console.log('a window went away while it was being measured; run it again once the app has settled');
    break;
  }
  const d = (k) => (b.get(k) ?? 0) - (a.get(k) ?? 0);
  const seconds = d('Timestamp') || GAP_MS / 1000;
  const pct = (k) => ((100 * d(k)) / seconds).toFixed(2) + '%';
  const name = t.url.includes('background') ? 'controller' : t.url.includes('automod') ? 'strip' : 'ingame';
  if (a === undefined) continue;
  console.log(
    `${name.padEnd(10)} of one second: tasks ${pct('TaskDuration')} · script ${pct('ScriptDuration')} · layout ${pct('LayoutDuration')} · style ${pct('RecalcStyleDuration')}` +
      `  |  heap ${(((b.get('JSHeapUsedSize') ?? 0) / 1e6)).toFixed(1)} MB · nodes ${String(b.get('Nodes') ?? 0)} · listeners ${String(b.get('JSEventListeners') ?? 0)}` +
      `  |  layouts ${String(d('LayoutCount'))} · recalcs ${String(d('RecalcStyleCount'))} in ${seconds.toFixed(1)} s`,
  );
}
