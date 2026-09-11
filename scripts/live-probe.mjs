/*
 * ASK THE APP THAT IS ACTUALLY RUNNING, OVER THE GAME THAT IS ACTUALLY RUNNING.
 * ─────────────────────────────────────────────────────────────────────────────
 * Overwolf starts every renderer with `--remote-debugging-port=54284`, so the
 * live controller can be asked what it believes right now - no packaging step,
 * no screen capture, no OCR, and nothing typed into the game. Two questions it
 * answers that nothing else can:
 *
 *   1. IS THE PIPELINE ACTUALLY UP? The game's resolution as Overwolf reports
 *      it, which window states the app is holding, and what the log tail has
 *      made of the session so far.
 *
 *   2. WHICH `CurrentLoadOutIds` ENTRY BELONGS TO WHICH PRESET GROUP. `build.ts`
 *      carries one index per category and every category added past the four
 *      depends on it: read the wrong entry and the archwing's id is hunted
 *      inside the companion's presets and never found. It came from a document;
 *      this reads it off a real account.
 *
 * PRIVACY. Every expression below names the fields it returns, one at a time,
 * and the loadout match is computed INSIDE the page so that what crosses the
 * wire is a list of indices. No account object, no log line, no oid, and no
 * name that belongs to a person rather than to an item.
 *
 * READ-ONLY. Nothing here calls into the app or moves a window.
 *
 *   node scripts/live-probe.mjs            # or: npm run live
 */
const PORT = process.env.OW_DEBUG_PORT ?? '54284';

async function evaluate(expression, match = 'background.html') {
  let list;
  try {
    list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  } catch {
    throw new Error(`nothing is listening on 127.0.0.1:${PORT} - Overwolf is not running, or this app is not loaded in it`);
  }
  const t = list.find((x) => x.type === 'page' && x.url.includes(match) && (x.title ?? '').includes('RaijiFrame'));
  if (!t) throw new Error(`Overwolf is up but this app is not: no page matching ${match}`);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  return await new Promise((resolve, reject) => {
    ws.addEventListener('open', () =>
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })),
    );
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== 1) return;
      const d = m.result?.exceptionDetails;
      if (d) reject(new Error(d.exception?.description ?? d.text));
      else resolve(m.result.result.value);
      ws.close();
    });
    ws.addEventListener('error', () => {
      reject(new Error('the debug socket refused the connection'));
    });
  });
}

const STATE = `(async () => {
  const ow = window.overwolf;
  const one = (fn) => new Promise((res) => { try { fn(res); } catch (e) { res({ error: String(e) }); } });
  const running = await one(ow.games.getRunningGameInfo);
  const states = await one(ow.windows.getWindowsStates);
  const s = window.automodFeed ? window.automodFeed.get() : null;
  const st = window.codexStore ? window.codexStore.getState() : null;
  const inv = st && st.inventory;
  return JSON.stringify({
    game: running && running.isRunning
      ? { classId: running.classId, focused: running.isInFocus, area: running.logicalWidth + 'x' + running.logicalHeight }
      : null,
    windows: states && states.result ? states.result : null,
    session: s && { phase: s.session.phase, slot: s.session.slot, unreadSlot: s.session.unreadSlot, edits: s.session.edits.length },
    item: s && s.build ? { name: s.build.name, category: s.build.category, unknown: s.build.unknown } : null,
    plan: s && s.plan
      ? { question: s.plan.now.question, now: Math.round(s.plan.now.score.value), ideal: Math.round(s.plan.ideal.score.value), ceiling: Math.round(s.plan.ceiling.score.value), steps: s.plan.next.length, forma: s.plan.forma.count }
      : null,
    ladder: s ? { rungs: s.ladder.length, end: s.ladderEnd, first: s.ladder[0] ? { kind: s.ladder[0].kind, gain: Math.round(s.ladder[0].gain || 0) } : null } : null,
    account: inv
      ? {
          changed: st.inventoryAt ? new Date(st.inventoryAt).toISOString() : null,
          answered: st.answeredAt ? new Date(st.answeredAt).toISOString() : null,
          modRows: (inv.RawUpgrades || []).length,
          rankedMods: (inv.Upgrades || []).length,
        }
      : null,
    /*
     * HAS THE GAME EVER HANDED THIS SESSION AN ACCOUNT? The row above cannot
     * answer it: a full account is loaded from disk at startup, so the panel
     * looks identical whether GEP is feeding it or has never said a word.
     * accepted is the count of reads the store took; gep is the provider's own
     * connection state. (No backticks here - this whole block is a template
     * literal sent over the debug socket.)
     */
    reads: st ? { gep: st.gep, hydrated: st.hydrated, ...st.acquire } : null,
  });
})()`;

const LOADOUT = `(() => {
  const inv = window.codexStore.getState().inventory;
  if (!inv) return JSON.stringify(null);
  const oid = (v) => (v && typeof v === 'object' ? (v.$oid || null) : (typeof v === 'string' ? v : null));
  const ids = (inv.CurrentLoadOutIds || []).map(oid);
  const byGroup = {};
  for (const group of Object.keys(inv.LoadOutPresets || {})) {
    const presets = inv.LoadOutPresets[group];
    if (!Array.isArray(presets)) continue;
    for (const p of presets) {
      const i = ids.indexOf(oid(p.ItemId));
      if (i !== -1) { byGroup[group] = i; break; }
    }
  }
  return JSON.stringify({ entries: ids.length, filled: ids.filter(Boolean).length, byGroup });
})()`;

/*
 * WHAT `build.ts` BELIEVES, so the probe is a comparison rather than a reading.
 * A number printed beside no expectation is a number nobody checks.
 */
const EXPECTED = { NORMAL: 0, SENTINEL: 1, ARCHWING: 2, MECH: 8 };

const state = JSON.parse(await evaluate(STATE));
console.log(JSON.stringify(state, null, 1));

const loadout = JSON.parse(await evaluate(LOADOUT));
if (loadout === null) {
  console.log('\nno account is loaded in the live app, so the loadout index cannot be read');
} else {
  console.log(`\nCurrentLoadOutIds: ${String(loadout.entries)} entries, ${String(loadout.filled)} filled`);
  const rows = Object.entries(loadout.byGroup).sort((a, b) => a[1] - b[1]);
  for (const [group, i] of rows) {
    const want = EXPECTED[group];
    const mark = want === undefined ? '' : want === i ? '   as build.ts expects' : `   DISAGREES with build.ts, which reads ${String(want)}`;
    console.log(`  ${String(i).padStart(2)}  ${group}${mark}`);
  }
  const wrong = Object.entries(EXPECTED).filter(([g, i]) => loadout.byGroup[g] !== undefined && loadout.byGroup[g] !== i);
  console.log(wrong.length === 0 ? '\nevery index this app reads is the one the account uses' : `\n${String(wrong.length)} INDEX IS WRONG: ${wrong.map(([g]) => g).join(', ')}`);
}
