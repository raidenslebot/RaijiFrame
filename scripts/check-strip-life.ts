/**
 * Self-check for the modding strip's LIFECYCLE — the rules `src/app/background.ts`
 * relies on to decide whether the overlay is on the player's screen.
 *
 * WHY THIS EXISTS
 * ───────────────
 * A strip stuck reading ITEM UNKNOWN / SAVED, with the game long past that
 * screen and no way to be rid of it. Two claims were made about the fix, and
 * both are claims about the REDUCER, not about Overwolf:
 *
 *   1. "There is nothing to say." The strip appears when it has an ANSWER — a
 *      plan, or edits to reflect back. Every other state is silence. That
 *      predicate reads `automodState`; this file re-states it, and BINDS the
 *      re-statement to background.ts's own source so the two cannot drift.
 *
 *   2. "The watchdog is necessary." It is necessary only if the phase can park
 *      somewhere the log will not move it from. So this file drives every
 *      arsenal event the parser emits into a session in every phase and
 *      MEASURES which pairs reach `idle` — the transition background.ts:405
 *      hangs its `hideStrip()` on. If `saved` can only leave through a close
 *      line, that fact belongs in a gate, not in a comment.
 *
 * It also measures the other half of the watchdog's contract: which lines
 * produce a NEW session object at all. `observeArsenal` early-returns on
 * `next === session`, so a line that folds to the same object never reaches
 * `armWatchdog()`. The set of lines that do NOT re-arm is recorded here
 * exactly, because that set is what decides whether a strip can go dark while
 * the player is still looking at the screen.
 *
 * background.ts is not imported: it talks to Overwolf at module scope. Every
 * event below is a REAL log line run through the real parser, the same way
 * check-automod.ts does it.
 *
 * Run: node scripts/check-strip-life.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoLast } from '../src/core/memo.ts';
import { parseLine, type LogEvent } from '../src/core/eelog.ts';
import { IDLE, fold, step, type PendingSlot, type Phase, type Session } from '../src/data/automod-session.ts';
import { questionFor, type Plan, type Rung } from '../src/data/optimise.ts';
import { hasSomethingToSay, itemIdentity, ladderToShow, openPolicy, opensAScreen, publishDecision, SETTLE_WAIT_MS, stillToDo } from '../src/data/automod-publish.ts';

let checks = 0;
let failures = 0;
function ok(label: string, fn: () => void): void {
  checks++;
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${label}\n        ${(err as Error).message.split('\n')[0]}`);
  }
}

/** Real line shapes, same source as check-automod.ts. Timestamps exercise the machine's windows. */
const L = {
  pressSlot: '5958.259 Script [Info]: LoadOutRedux.lua: _T.upgradeItemSlot (_Mod): \t3',
  goTo: '5958.275 Script [Info]: LoadOutRedux.lua: Background::GoToScreen(screenName=UpgradeCards)',
  /*
   * 288 ms after the `GoToScreen` above, which is what the log really does -
   * measured over this machine's whole EE.log, the arsenal's two open lines are
   * 271 ms and 288 ms apart, and those are every pair in the file. This fixture
   * used to space them 20 ms and `SAME_OPEN_SECONDS` was commented with that
   * number, so nothing here ever exercised the distance the game actually logs.
   */
  created: '5958.563 Sys [Info]: Created /Lotus/Interface/DiegeticUpgradeCards.swf',
  visible: '5958.812 Script [Info]: DiegeticUpgradeCards.lua: DBG: HudVis 1',
  place: '5990.101 Script [Info]: DiegeticUpgradeCards.lua: mod: True Steel - installed: true (/Lotus/Upgrades/Mods/Melee/WeaponCritChanceMod)',
  lift: '5990.102 Script [Info]: DiegeticUpgradeCards.lua: mod: True Steel - installed: false (/Lotus/Upgrades/Mods/Melee/WeaponCritChanceMod)',
  owned: '5990.500 Script [Info]: DiegeticUpgradeCards.lua: Multiple cards of type /Lotus/Upgrades/Mods/Melee/WeaponFireDamageMod with the same ID.',
  fusion: 'Endo <FUSION_POINTS>15,330\rCredits <CREDITS>740,439',
  saved: '6020.864 Script [Info]: LoadOutRedux.lua: OnSaveLoadOutCompleteCommon',
  slots:
    '6695.781 Sys [Info]: Slots: AP_UNIVERSAL|AP_UNIVERSAL|AP_UNIVERSAL|AP_ATTACK|AP_UNIVERSAL|AP_UNIVERSAL|AP_TACTIC|AP_ATTACK|AP_ATTACK|AP_UNIVERSAL|AP_UNIVERSAL|',
  capacity: 'Initial Capacity: 30|IronPhoenixMeleeTree+4',
  mods: 'Modded Capacity: 34|WeaponMeleeStatusChanceSPMod-11|WeaponMeleeDamageModExpert-7\r',
  drain: 'Final Mod Drain: 4',
  closed: '6700.500 Script [Info]: DiegeticUpgradeCards.lua: Background::GoToPreviousScreen(skipScreens=nil)',
  /** The other entry path, 21 minutes later: a genuine second open, never a dedupe. */
  createdLater: '7234.809 Sys [Info]: Created /Lotus/Interface/DiegeticUpgradeCards.swf',
  /** Not the arsenal's business at all. */
  mission: '164.957 Script [Info]: EndOfMatch.lua: Mission Succeeded',
};

function one(line: string): LogEvent {
  const e = parseLine(line);
  assert.ok(e, `the parser no longer recognises: ${line}`);
  return e;
}

function events(...lines: string[]): LogEvent[] {
  return lines.map(one);
}

const freshPending = () => ({ slot: null, slotAt: null, unrecognised: null, lastInterface: null, lastInterfaceAt: null });

/*
 * HOW MANY CONDITIONAL RENDERS `Aside` HAS, and which axis of the enumeration
 * covers each. Pinned so that adding one is a decision rather than an
 * oversight - see the enumeration check below.
 *
 *   plan                        the plan / no-plan split; NoPlan is enumerated
 *                               on its own axes
 *   plan && showBuild           the view toggle - the whole cross product runs
 *                               twice, once per view
 *   figureNote !== null         figureNote
 *   !atCeiling            (x2)  destination
 *   nextReach !== null          ladder - it is `ladder[0]?.value`, so the
 *                               "no rungs at all" shape empties the bar segment
 *   atCeiling ?                 destination
 *   planAssumed.length > 0      assumed
 *   unscored > 0 || assumed     unscored, crossed with assumed
 *
 * TWO WENT WHEN THE COLUMN BECAME A TABLE, and neither removed a state.
 *
 *   forma.count > 0             moved INTO `CostLedger`, which is one row of a
 *                               `dl` that drops a row whose value is null. The
 *                               forma axis still produces both shapes - a
 *                               column with the row and a column without - and
 *                               the enumeration still crosses it; what changed
 *                               is that the branch is now a null in a row list
 *                               rather than a `&&` in the JSX.
 *   ideal.aura && !auraIsNext   the same, in the same component, including the
 *                               suppression that stops the row restating the
 *                               instruction two lines above it.
 *
 * `weakest` and the tally moved the same way but were never branches here: the
 * tally was unconditional and the matchup's guard is inside an IIFE that this
 * count has never seen. So the axes are unchanged and the number is two lower.
 * Re-run `__exhaustAll()` on the artboard after any change that is NOT of this
 * shape.
 */
const ASIDE_BRANCHES = 9;

/** What can continue an identifier or a property path, for the boundary test below. */
const NAME_CHAR = /[A-Za-z0-9_.]/;

/**
 * Does `text` name `name` - as that name, not as the front of a longer one?
 *
 * Three versions of the enumeration check passed while the branch they claimed
 * to cover had been renamed, every time for this reason: `includes` matches
 * `figureNote` inside `figureNoteX` and `plan.ideal.aura` inside
 * `plan.ideal.aura2`. A rename is the most likely way a branch stops being the
 * branch an axis varies, so a check that cannot see one is measuring nothing.
 */
function mentions(text: string, name: string): boolean {
  for (let i = text.indexOf(name); i !== -1; i = text.indexOf(name, i + 1)) {
    const next = text.charAt(i + name.length);
    if (next === '' || !NAME_CHAR.test(next)) return true;
  }
  return false;
}

/*
 * `plan` is only ever tested against null by the predicate, so a stand-in
 * object is an honest substitute for a real Plan and nothing is fabricated by
 * using one.
 *
 * THE PREDICATE ITSELF USED TO BE RE-STATED HERE, with a check comparing this
 * file's copy against `background.ts` byte for byte to stop the two drifting.
 * That was a workaround for the real one being unreachable - it lived in a file
 * no gate can import, because that file imports Overwolf. It lives in
 * `data/automod-publish.ts` now, so the copy and its drift check are both gone
 * and every check below runs the actual code.
 */
const A_PLAN = { itIsHere: true } as unknown as Plan;

console.log('\nthe controller runs the code these checks drive');

ok('the controller asks the ARMOURED question of a weapon, not the unarmoured one', () => {
  /*
   * Q2 WAS WRITTEN, GATED, AND NEVER SELECTED - dead code in production for as
   * long as it existed, while the overlay answered Q1 on every weapon in the
   * game. Q1 is damage against UNARMOURED health: exact, and a description of
   * almost nothing anybody shoots. The two are not rewordings of one answer;
   * measured on the real catalogue the ideal build differs on three of four
   * weapons, and on the player's own Broken War five of six mods change.
   *
   * Nothing caught that, because "which question does the controller ask" was
   * a line of code no gate had an opinion about. This is that opinion. It reads
   * background.ts's own source rather than re-stating the rule, so a revert to
   * Q1 fails here instead of quietly halving the advice.
   */
  /*
   * ASKED OF THE DECISION, NOT OF ITS SPELLING. This pinned the exact text of
   * the expression - `item.type === 'Warframe' ? 'Q3' : 'Q2'` - and broke the
   * moment that decision moved into a named function which answers for
   * Sentinels, Kavats and Archwings as well. A gate that fails on an
   * improvement is measuring the wrong thing, so it now drives `questionFor`
   * and reads background.ts only to confirm the controller uses it.
   */
  for (const type of ['Rifle', 'Shotgun', 'Pistol', 'Melee', 'Arch-Gun', 'Arch-Melee', 'Companion Weapon']) {
    assert.equal(questionFor({ type }), 'Q2', `a ${type} is no longer asked the armoured question`);
  }
  for (const type of ['Warframe', 'Sentinel', 'Pets', 'Archwing']) {
    assert.equal(questionFor({ type }), 'Q3', `a ${type} is no longer asked how much it can take`);
  }

  const src = readFileSync(new URL('../src/app/background.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ');
  const m = /const question = ([^;]+);/.exec(src);
  assert.ok(m, 'background.ts no longer chooses a question in one expression');
  const expr = m[1]!.replace(/\s+/g, ' ').trim();
  assert.equal(expr, 'questionFor(item)', `the controller decides for itself instead of asking questionFor: ${expr}`);
  assert.ok(!/'Q1'/.test(src), 'background.ts names Q1 again, which is the unarmoured question no weapon should be asked');
});

ok('the companion panel key hides the overlay but never mutes it', () => {
  /*
   * Ctrl+K toggles the companion panel AND is the overlay's escape hatch. It
   * used to set `stripMuted = true` on the way past, so opening the panel while
   * modding killed the modding overlay and kept it dead until the player
   * toggled again - a connection nobody would make. Two unrelated jobs on one
   * key, and the quiet one destroyed the loud one's work.
   *
   * Hiding without muting keeps the escape hatch and costs nothing: a LIVE
   * overlay is one the log is still narrating, so `observeArsenal` shows it
   * again on the next arsenal line, while a STUCK one has no log behind it and
   * stays gone. That is the same signal the 90-second watchdog runs on.
   *
   * Read from the source, so restoring the mute fails here.
   */
  const src = readFileSync(new URL('../src/app/background.ts', import.meta.url), 'utf8');
  const m = /onHotkeyPressed\(TOGGLE_HOTKEY, \(\) => \{([\s\S]*?)\n\}\);/.exec(src);
  assert.ok(m, 'the Ctrl+K handler is gone from background.ts, or is no longer a single block');
  /*
   * COMMENTS STRIPPED FIRST, and this check failed on its own documentation
   * before it did anything else useful.
   *
   * It read the raw source and matched the phrase "stripMuted = true" inside
   * the comment directly above the fix - the comment that exists to say the
   * line is gone. A source-text gate that cannot tell code from prose reports
   * the explanation as the defect.
   */
  const body = (m[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*/g, ' ');
  assert.ok(body.includes('hideStrip()'), 'Ctrl+K no longer gets a stuck overlay off the screen');
  assert.ok(!/stripMuted\s*=\s*true/.test(body), 'Ctrl+K mutes the overlay again: opening the companion panel while modding will kill it');
  // And the strip's own key is still where deliberate muting lives.
  const own = /onHotkeyPressed\(AUTOMOD_HOTKEY, \(\) => \{([\s\S]*?)\n\}\);/.exec(src);
  assert.ok(own && /stripMuted\s*=\s*!stripMuted/.test(own[1] ?? ''), 'Ctrl+Shift+M no longer toggles the mute');
});

ok('every Overwolf window call addresses the window by ID, never by its manifest name', () => {
  /*
   * THE BUG THIS CATCHES SHIPPED, AND IT WAS INVISIBLE.
   *
   * `setInputPassThrough` passed the DECLARED NAME - 'automod' - to
   * `setWindowStyle`, which wants the instance id `obtainDeclaredWindow` hands
   * back. Every other call in `core/ow.ts` gets `win.id`; this one did not. The
   * call was refused, and the only consequence was a `console.warn` in a
   * background page nobody has open.
   *
   * What makes it worth a gate rather than a fix is WHICH call it was. It
   * exists specifically because "a manifest flag that silently did not apply
   * would look exactly like the bug" - the bug being an overlay that eats the
   * player's clicks, which this app has shipped twice and been shouted at for
   * twice. The belt was on and the braces were never fastened.
   *
   * Overwolf reports failures through a `success` flag rather than by throwing,
   * so nothing louder than a warning was ever going to happen. The only defence
   * is reading the source.
   */
  const src = readFileSync(new URL('../src/core/ow.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ');
  const calls = [...src.matchAll(/ow\??\.windows\.(\w+)\(\s*([^,)]+)/g)];
  assert.ok(calls.length >= 5, `only ${String(calls.length)} window calls found; the shape of ow.ts has changed`);
  /*
   * TWO APIS TAKE A NAME, and both are stated here rather than loosening the
   * rule, because each is a decision that can be checked against the type
   * declaration:
   *
   *   obtainDeclaredWindow(windowName, ...)  overwolf.d.ts:1468 - the whole
   *                                          point of it is the manifest key
   *   dragMove(windowId, ...)                overwolf.d.ts:1518 - the caller
   *                                          already holds an id and passes it
   *
   * Everything else takes an instance id. `getWindowsStates` takes only a
   * callback and returns every window keyed by name, which is why the startup
   * reconciliation uses it.
   */
  const TAKES_A_NAME = new Set(['obtainDeclaredWindow']);
  const wrong: string[] = [];
  for (const [, method, arg] of calls) {
    const a = (arg ?? '').trim();
    if (TAKES_A_NAME.has(String(method))) continue;
    // An id, an id already held by the caller, an options object carrying one,
    // or a callback-only API: all fine.
    if (a === 'win.id' || a === 'windowId' || a.startsWith('{') || a.startsWith('(') || a.startsWith('function')) continue;
    wrong.push(`${String(method)}(${a}`);
  }
  assert.deepEqual(wrong, [], `a window call is addressed by something other than win.id, and Overwolf will refuse it in silence:\n        ${wrong.join('\n        ')}`);
});

ok('the manifest still declares the two flags the player has already been burned by', () => {
  /*
   * THE MANIFEST HAS NO TYPES, NO LINT AND, UNTIL NOW, NO GATE - and it holds
   * the two settings whose failure the player has personally reported.
   *
   *   transparent  false, and the overlay paints an opaque rectangle over the
   *                game. That shipped once already, from a different cause
   *                (`color-scheme: dark` makes Chromium paint the canvas), and
   *                the reaction was "what is this crappy boxy GUI".
   *   style        not InputPassThrough, and the window eats the clicks meant
   *                for the game. That shipped twice. "the menu when open should
   *                not interfere with other buttons presses etc so i can still
   *                move my frame in the backround."
   *
   * Both are one word in a JSON file. Flipping either is invisible to `tsc`,
   * to eslint, to every other check here - verified by flipping them - and
   * visible to the player instantly.
   *
   * `in_game_only` is here for a duller reason: without it an in-game window
   * can be restored onto the desktop, where it has no game to sit on and
   * nothing to say.
   */
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8')) as {
    data: { windows: Record<string, Record<string, unknown>> };
  };
  const windows = manifest.data.windows;

  for (const name of ['automod', 'ingame'] as const) {
    const w = windows[name];
    assert.ok(w, `the ${name} window is gone from the manifest`);
    assert.equal(w.transparent, true, `${name} is not transparent: it will paint a rectangle over the game`);
    assert.equal(w.style, 'InputPassThrough', `${name} does not pass input through: it will eat the clicks meant for the game`);
    assert.equal(w.in_game_only, true, `${name} is not in-game only`);
    /*
     * And NOT `focus_game_takeover`, which is the flag that was there before
     * and is what "the menu ... should not interfere with other buttons
     * presses" was about: it grabs the cursor in any mouse-less game state and
     * keeps it until the window hides.
     */
    assert.equal(w.focus_game_takeover, undefined, `${name} takes the game's input focus again`);
  }

  // The overlay is sized by the app to the game's client area; a resizable
  // frame would let the player drag it off that and silently break the grid.
  assert.equal(windows.automod?.resizable, false, 'the overlay window became resizable');

  // The background page must NOT be a window the player can see or close.
  const bg = windows.background;
  assert.ok(bg, 'the background window is gone');
  assert.equal(bg.in_game_only, undefined, 'the background page became in-game only');
  assert.equal(bg.desktop_only, undefined, 'the background page became desktop only');
});

ok('the silence watchdog is long enough to read the recommendation, and the close outlasts it', () => {
  /*
   * THE ONE NUMBER THAT DECIDES WHETHER THE OVERLAY VANISHES WHILE YOU READ IT.
   *
   * The watchdog exists because a screen can be left without the log saying so,
   * and without it the strip stays up forever - that is the bug the player
   * photographed. But it fails the other way just as easily: the same file
   * records "a player who put a mod in and then read the recommendation for
   * ninety seconds had the overlay vanish while they were still looking at it",
   * which is what the arming rule in `observeArsenal` was changed to prevent.
   *
   * The deadline itself was unguarded. Set it to three seconds and every check
   * in this repository stays green while the overlay becomes unusable - it
   * would disappear between placing a mod and reading what to do next.
   *
   * A floor rather than the exact value: 90 s is a judgement and may be revised,
   * but anything under a minute is shorter than the reading it interrupts.
   */
  const src = readFileSync(new URL('../src/app/background.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ');

  const silence = /STRIP_SILENCE_MS = ([\d_]+)/.exec(src);
  assert.ok(silence, 'the silence watchdog deadline is gone from background.ts');
  const silenceMs = Number((silence[1] ?? '').replace(/_/g, ''));
  assert.ok(silenceMs >= 60_000, `the watchdog fires after ${String(Math.round(silenceMs / 1000))} s: it will take the overlay down while the player is still reading it`);

  /*
   * And the CLOSE has to outlast the hide. Hiding is instant and reversible;
   * closing destroys the page and costs a reload on the next open. Closing
   * first, or at the same moment, would mean every brief pause in the log
   * bought a full page load the next time the player looked at a mod.
   */
  const close = /STRIP_CLOSE_AFTER_MS = ([\d_ *+]+);/.exec(src);
  assert.ok(close, 'the close delay is gone from background.ts');
  const closeMs = Number(new Function(`return ${(close[1] ?? '0').replace(/_/g, '')}`)() as number);
  assert.ok(closeMs > silenceMs, `the page is destroyed after ${String(Math.round(closeMs / 1000))} s but hidden after ${String(Math.round(silenceMs / 1000))} s; the close must outlast the hide`);
});

ok('a show that was superseded while awaiting Overwolf abandons itself, however it was superseded', () => {
  /*
   * THE HOLE THAT OPENED WHEN Ctrl+K STOPPED MUTING.
   *
   * `showStrip` is asynchronous and `placeWindow` alone is two round-trips. The
   * re-check after that await used to read `stripMuted`, which worked because
   * every route out set it. Then Ctrl+K was changed to hide WITHOUT muting - so
   * that opening the companion panel no longer kills a live overlay - and the
   * re-check silently stopped covering the case it was written for: press the
   * key inside the place window and the overlay comes straight back up. That is
   * the same complaint the comment there records from the mute era, reopened by
   * a different route.
   *
   * A generation counter does not depend on WHY it was hidden, so the next
   * route out is covered without anybody remembering to add a flag. This reads
   * the source because the race needs two Overwolf round-trips to reproduce and
   * the shape is what matters: capture before the await, compare after each.
   */
  const src = readFileSync(new URL('../src/app/background.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ');

  assert.ok(/let stripGeneration = 0;/.test(src), 'the generation counter is gone; a hide during an await will be ignored again');

  const hide = /function hideStrip\(\)[\s\S]*?\n\}/.exec(src);
  assert.ok(hide, 'hideStrip is gone from background.ts');
  assert.ok(/stripGeneration\+\+/.test(hide[0]), 'hideStrip no longer bumps the generation, so no show can tell it happened');

  const show = /async function showStrip\(\)[\s\S]*?\n\}/.exec(src);
  assert.ok(show, 'showStrip is gone from background.ts');
  const body = show[0];
  assert.ok(/const generation = stripGeneration;/.test(body), 'showStrip no longer captures the generation before its awaits');
  const compares = (body.match(/generation !== stripGeneration/g) ?? []).length;
  assert.ok(
    compares >= 2,
    `showStrip compares the generation ${String(compares)} time(s); it awaits twice - placing the window and restoring it - and both need the check`,
  );
});

ok('the overlay is never shown before the game has said how big it is', () => {
  /*
   * The manifest declares the overlay 1440 x 900 - `placeWindow` is what makes
   * it the game's client area instead. A show that runs before Overwolf has
   * reported the dimensions restores a window at 1440 x 900 over whatever
   * resolution the game is really at, the page computes `--am-scale` from that,
   * and every mark lands on the wrong card. The window is narrow, because
   * `watchGame` queries an already-running game at registration, but the log
   * tail and the game feed are independent and an arsenal line can arrive first.
   *
   * The guard has to come BEFORE the placement rather than be folded into it:
   * `if (area) await placeWindow(...)` shows the window unplaced when `area` is
   * null, which is exactly the case it looks like it is handling.
   */
  const src = readFileSync(new URL('../src/app/background.ts', import.meta.url), 'utf8');
  const show = /async function showStrip\(\)[\s\S]*?\n\}/.exec(src);
  assert.ok(show, 'showStrip is gone from background.ts');
  const body = (show[0] ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*/g, ' ');

  assert.ok(/if \(!area\)[\s\S]{0,140}?return;/.test(body), 'showStrip no longer refuses to run without an area; it will show the overlay at the manifest size');
  const guardAt = body.indexOf('if (!area)');
  const placeAt = body.indexOf('placeWindow');
  assert.ok(guardAt >= 0 && placeAt >= 0 && guardAt < placeAt, 'the area guard must come before the placement, or the window is shown unplaced');
  assert.ok(!/if \(area\) await placeWindow/.test(body), 'the placement is conditional again, which shows an unplaced window instead of not showing one');

  // The declared size is what makes this matter, so it is asserted rather than assumed.
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8')) as {
    data: { windows: Record<string, { size?: { width: number; height: number } }> };
  };
  assert.ok(manifest.data.windows.automod?.size, 'the overlay has no declared size, so an unplaced show would be a different shape of wrong');
});

ok('the game area is tracked by comparing dimensions, not by trusting the resolution flag', () => {
  /*
   * `area` is what every rectangle the overlay draws is computed from, and it
   * used to be refreshed only when `onGameInfoUpdated` set `resolutionChanged`.
   * That makes the whole geometry depend on one boolean being right about every
   * way a game window can change size - windowed resize, borderless toggle,
   * monitor change, DPI change - and if it is ever wrong the marks sit on the
   * wrong cards with nothing anywhere to say why.
   *
   * Comparing the dimensions costs a comparison and removes the dependency. The
   * PLACEMENT still only happens when they moved, which is what keeps alt-tab
   * from causing Overwolf round-trips, so both halves are asserted: the handler
   * must not filter, and the placement must.
   */
  const src = readFileSync(new URL('../src/app/background.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ');

  const onChange = /onChange: \(([\s\S]*?)\n {2}\},/.exec(src);
  assert.ok(onChange, 'the game-change handler is gone from background.ts');
  assert.ok(/observeGame\(info\)/.test(onChange[0]), 'the change handler no longer refreshes the area');
  assert.ok(
    !/why\.resolutionChanged/.test(onChange[0]),
    'the change handler filters on resolutionChanged again: the area will go stale whenever that flag is wrong about a resize',
  );

  const observe = /function observeGame\([\s\S]*?\n\}/.exec(src);
  assert.ok(observe, 'observeGame is gone from background.ts');
  assert.ok(/moved/.test(observe[0]), 'observeGame no longer compares the dimensions, so it cannot tell a resize from a focus change');
  assert.ok(
    /if \(stripShown && area && moved\)/.test(observe[0]),
    'the placement no longer waits for a real move: every alt-tab will cost two Overwolf round-trips',
  );

  /*
   * AND THE PRODUCER, WHICH IS WHERE THE FIRST VERSION OF THIS CHECK STOPPED.
   *
   * Everything above asserts the CONSUMER: that background.ts does not filter
   * on the flag. It was written, and passed, while `settle()` in ow.ts still
   * only CALLED `onChange` when `resolutionChanged || focusChanged` was set - so
   * an update carrying neither never reached the handler at all, and the
   * comment above it claiming the geometry no longer depends on that flag was
   * false one function further down. A gate that asserts only the half of a
   * path it happens to be reading is worth less than no gate, because it reads
   * as coverage.
   *
   * The delivery is what is asserted here, not the absence of a filter: any
   * future filter has to make `onChange` conditional on something, and this
   * pins the condition to being nothing but "the game is up".
   */
  const ow = readFileSync(new URL('../src/core/ow.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ');

  const settle = /const settle = \([\s\S]*?\n {2}\};/.exec(ow);
  assert.ok(settle, 'settle() is gone from ow.ts');
  assert.ok(
    /else if \(up && running && info\) \{\s*cb\.onChange\?\.\(info\);/.test(settle[0]),
    'settle() no longer delivers every update while the game is up: whatever it filters on, an update it drops can never reach the dimension comparison in background.ts',
  );
  assert.ok(
    !/onChange\?\.\(info, /.test(settle[0]),
    'onChange is being handed the flags again, which is the invitation to filter on them that this pair of checks exists to remove',
  );
});

ok('the overlay page notices when the background it is bound to has restarted', () => {
  /*
   * THE PAGE'S HALF OF A BUG THE CONTROLLER ALREADY HAD.
   *
   * `FEED` in automod.tsx is resolved ONCE, at module scope, from
   * `getMainWindow().automodFeed`. An Overwolf window outlives its background
   * page - a crash, an extension reload, an auto-refresh in development - and
   * this page is reloaded only when the window is CLOSED, never when it is
   * merely hidden. So after a background restart the overlay can come back up
   * still holding the dead page's feed: `get()` returns the last state it ever
   * saw and `subscribe()` registers on a Set nothing will iterate again. The
   * player looks at a plan for a weapon they put away, and every control still
   * works, so nothing looks broken from the controller's side.
   *
   * That is the same mistake `stripShown` made in the other direction - a
   * reference held across a lifetime it does not control - and the controller's
   * half was fixed with a startup reconciliation. This is the page's half.
   *
   * Two halves are asserted because each fails differently: without the compare
   * the page never notices, and without the `FEED.live` guard the artboard - a
   * plain browser page with a LOCAL feed and no Overwolf - would reload itself
   * every time it was shown, which would make the design lab unusable.
   */
  const src = readFileSync(new URL('../src/app/automod.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ');

  const fn = /function rebindIfTheBackgroundRestarted\(\)[\s\S]*?\n\}/.exec(src);
  assert.ok(fn, 'the overlay no longer checks whether its background page restarted');
  const body = fn[0];
  assert.ok(/if \(!FEED\.live\) return;/.test(body), 'the check no longer exempts the local feed: the design artboard will reload itself on every show');
  assert.ok(/now !== FEED\.feed/.test(body), 'the check no longer compares the feed identity, so a restarted background goes unnoticed');
  assert.ok(/location\.reload\(\)/.test(body), 'nothing happens when the background has restarted');

  // And it has to be wired to the window becoming visible, or it never runs.
  const gate = /function useHiddenGate\(\)[\s\S]*?\n\}/.exec(src);
  assert.ok(gate, 'useHiddenGate is gone from automod.tsx');
  assert.ok(/rebindIfTheBackgroundRestarted\(\)/.test(gate[0]), 'the check is never called: it only matters when the window comes back up');
});

ok('the plan is recomputed when it can change, not every time anything is published', () => {
  /*
   * THE OVERLAY'S ONE MEASURABLE LAG.
   *
   * `scripts/bench-plan.ts` measures the plan at 293-621 ms on the real
   * catalogue, and `publishAutomod` was calling it on every session change -
   * every mod placed, every screen line, every hud line - plus every inventory
   * push while the screen is open. So the controller stalled for half a second
   * each time the player touched a card, and `planFor`'s own comment said it
   * ran "once per open".
   *
   * The memo is checked by BEHAVIOUR, and the key by reading, because they fail
   * differently: a memo that never hits is slow, and a key missing an input is
   * WRONG - it serves a stale plan for a changed account, which looks exactly
   * like a correct plan.
   */
  let made = 0;
  const memo = memoLast<number>();
  const produce = () => {
    made++;
    return made;
  };

  const account = { a: 1 };
  assert.equal(memo.get(['Braton', account, 60, '', 'Q2'], produce), 1);
  assert.equal(memo.get(['Braton', account, 60, '', 'Q2'], produce), 1, 'an identical key recomputed the plan');
  assert.equal(memo.hits, 1);
  assert.equal(memo.misses, 1);

  // Identity, not equality: an account object that merged to something new is a
  // different account as far as this is concerned, and must recompute.
  assert.equal(memo.get(['Braton', { a: 1 }, 60, '', 'Q2'], produce), 2, 'a new account object was served the old plan');
  assert.equal(memo.get(['Braton', account, 61, '', 'Q2'], produce), 3, 'a capacity change was served the old plan');
  assert.equal(memo.get(['Braton', account, 61, 'madurai', 'Q2'], produce), 4, 'a grid change was served the old plan');
  assert.equal(memo.get(['Braton', account, 61, 'madurai', 'Q3'], produce), 5, 'a question change was served the old plan');
  assert.equal(memo.get(['Braton', account, 61, 'madurai'], produce), 6, 'a shorter key matched a longer one');

  // A throw must not replace the standing answer with a broken one.
  const good = memo.get(['x'], produce);
  assert.throws(() =>
    memo.get(['y'], () => {
      throw new Error('catalogue vanished');
    }),
  );
  assert.equal(memo.get(['x'], produce), good, 'a failed computation evicted the good answer');

  /*
   * And the key itself. Everything the plan depends on has to be in it; the
   * purse deliberately is NOT, because it changes on every fusion and does not
   * enter the search - reading it per publish is the whole reason the plan can
   * be cached at all.
   */
  const src = readFileSync(new URL('../src/app/background.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ');

  const key = /const key = \[([^\]]*)\]/.exec(src);
  assert.ok(key, 'the plan cache key is gone from background.ts');
  /*
   * `starChart` joined this list after a review found it missing: `canReach`
   * and `unlockPath` both close over it, it arrives asynchronously, and a plan
   * computed before it landed was served reachability-blind for the rest of the
   * visit because nothing in the key had changed.
   */
  for (const part of ['item', 'mods', 'starChart', 'account', 'slots.plan.capacity', 'slots.plan.grid', 'question', 'assumed']) {
    assert.ok(key[1]?.includes(part), `the plan cache key no longer carries ${part}, so a change to it will be served a stale plan`);
  }
  assert.ok(!/\bpurse\b/.test(key[1] ?? ''), 'the purse is in the key, which recomputes the whole search on every fusion');
  /*
   * BOTH ENDS OF THE CACHE, because the plan is no longer computed inside a
   * `get`.
   *
   * It used to be `planCache.get(key, produce)` and this pinned that call. The
   * plan is about 1.2 seconds of beam search and it ran straight through on the
   * controller - measured with a zero-delay timer beside it, ZERO ticks fired
   * for the whole of it, so the log tail, the watchdog and the two Overwolf
   * round trips that put the overlay up were all stalled behind it. It is now
   * driven a search at a time, and a sliced producer cannot RETURN a value: the
   * controller `peek`s, starts a pump on a miss, and the pump `set`s the answer
   * when it lands.
   *
   * So both ends are asserted, and that is a stronger statement than the one
   * call was. A `peek` with no `set` never fills the cache and every publish
   * starts the search again - the exact waste this gate exists to prevent,
   * wearing a different shape.
   */
  assert.ok(/planCache\.peek\(key\)/.test(src), 'nothing reads the plan cache, so every publish recomputes the search');
  assert.ok(/planCache\.set\(key,/.test(src), 'nothing writes the plan cache, so the answer is thrown away and recomputed on the next publish');

  /*
   * AND THE PUMP IS GUARDED. A plan being built for a screen the player has
   * left must stop, or it seeds the cache and republishes under a key nobody
   * wants - the same class of bug as `ladderFor` and `stripGeneration`, and it
   * fails just as quietly.
   */
  assert.ok(/planningKey !== key/.test(src), 'the sliced plan has no generation guard, so a superseded search still publishes');
});

ok('an arsenal slot this app does not recognise is recorded rather than discarded', () => {
  /*
   * THE ONE THING THAT WOULD TELL US WHAT THIS OVERLAY DOES NOT COVER.
   *
   * Four slots are handled - warframe, primary, secondary, melee - and that is
   * not a design decision so much as the extent of what anybody has seen: the
   * capture behind `docs/research/eelog-upgrade-screen.md` observed indices 0
   * and 3 and INFERRED 1 and 2 from the arsenal's layout. Whether a companion,
   * an archwing or a necramech screen emits a fifth index is unknown, and the
   * catalogue already carries Sentinels, SentinelWeapons, Pets, Archwing,
   * Arch-Gun and Arch-Melee, so the question is not academic.
   *
   * The reducer clamped anything outside 0-3 to null and dropped the number, so
   * a player could open a companion's mods every evening for a year and nothing
   * would ever learn from it. Clamping is still right - the app must not guess
   * that slot 4 is a sentinel - but the INDEX is evidence and is now kept, and
   * the controller traces it by name. One such visit settles the question.
   *
   * Both halves are asserted because each fails silently: without the record
   * the number is gone, and without the trace nobody ever sees it.
   */
  const pending: PendingSlot = { slot: null, slotAt: null, unrecognised: null, lastInterface: null, lastInterfaceAt: null };
  const at = (n: number): LogEvent => ({ at: 1, type: 'upgradeSlot', slot: n });

  for (const known of [0, 1, 2, 3]) {
    step(IDLE, at(known), pending);
    assert.equal(pending.slot, known, `slot ${String(known)} is one of the four this app handles`);
    assert.equal(pending.unrecognised, null, `slot ${String(known)} was reported as unrecognised`);
  }

  step(IDLE, at(4), pending);
  assert.equal(pending.slot, null, 'an index outside the four was guessed at instead of refused');
  assert.equal(pending.unrecognised, 4, 'AN UNRECOGNISED SLOT INDEX WAS DISCARDED, so what this overlay does not cover can never be measured');

  // And the next recognised press clears it, or one companion visit would make
  // every later weapon look like a discovery.
  step(IDLE, at(3), pending);
  assert.equal(pending.unrecognised, null, 'the record outlived the press it belonged to');

  const src = readFileSync(new URL('../src/app/background.ts', import.meta.url), 'utf8');
  assert.ok(
    /pending\.unrecognised !== null/.test(src) && /an upgrade slot this app does not recognise/.test(src),
    'the controller never says it saw one, so the record reaches nobody',
  );

  /*
   * AND THE PLAYER IS TOLD, which is a separate failure from the trace.
   *
   * A slot the app does not read means `resolveBuild` is never called, so
   * `build` is null and every explanatory line in the overlay is skipped: the
   * panel showed a title reading "item unknown" and nothing underneath. A blank
   * overlay on a screen the app KNOWS it cannot read is indistinguishable from
   * a broken overlay on one it should be able to.
   */
  const opened = fold([
    { at: 1, type: 'upgradeSlot', slot: 7 },
    { at: 1.2, type: 'screen', name: 'UpgradeCards', open: true },
  ]);
  assert.equal(opened.slot, null, 'an index outside the four was taken as one of them');
  assert.equal(opened.unreadSlot, 7, 'the session forgot which screen it could not read');

  const arsenal = fold([
    { at: 1, type: 'upgradeSlot', slot: 3 },
    { at: 1.2, type: 'screen', name: 'UpgradeCards', open: true },
  ]);
  assert.equal(arsenal.slot, 3, 'a melee open stopped resolving');
  assert.equal(arsenal.unreadSlot, null, 'a slot the app DOES read was reported as unreadable');

  // The other reason `slot` is null: the Mods segment, which emits no slot line
  // at all. That is a different sentence and must not borrow this one.
  const mods = fold([{ at: 1.2, type: 'screen', name: 'UpgradeCards', open: true }]);
  assert.equal(mods.slot, null);
  assert.equal(mods.unreadSlot, null, 'an open with no slot line at all was blamed on an unreadable slot');

  /*
   * And a press too old to belong to this open must not be borrowed by it. The
   * slot itself has always been held to that (SLOT_LEADS_OPEN_SECONDS), and an
   * unrecognised index inherits the same test - otherwise one companion press
   * would label every later Mods-segment open as unreadable.
   */
  const stale = fold([
    { at: 1, type: 'upgradeSlot', slot: 7 },
    { at: 9, type: 'screen', name: 'UpgradeCards', open: true },
  ]);
  assert.equal(stale.unreadSlot, null, 'a slot press eight seconds earlier was borrowed by an unrelated open');

  const ui = readFileSync(new URL('../src/app/automod.tsx', import.meta.url), 'utf8');
  assert.ok(
    /not one of the four arsenal slots the overlay reads yet/.test(ui),
    'the overlay never says it, so the player sees a blank panel on a screen the app knows it cannot read',
  );
  assert.ok(/'another slot'/.test(ui), 'the title still calls it an unknown ITEM, which sends the reader looking for a missing weapon');
  /*
   * AND WHAT UNBLOCKS IT, which is the difference between a wall and a door.
   *
   * "This is not one of the four arsenal slots the overlay reads yet" is true,
   * unhelpful on its own, and indistinguishable from "this will never work".
   * One mod moved on that screen teaches the app what the row is - permanently,
   * on this account and every session after - and the player has no way to know
   * that unless it is said.
   */
  assert.ok(
    /Move any mod on it once and it will be recognised from then on/.test(ui),
    'the overlay names the wall without the door: it never tells the player the one thing that would make this screen work',
  );
});

ok('the controller wires the ladder to the CATEGORY, not to the slot index', () => {
  /*
   * THREE DEFECTS AN ADVERSARIAL REVIEW FOUND AND EVERY GATE HERE MISSED.
   * All three are wiring in `background.ts`, which cannot be driven from a gate
   * - it imports Overwolf - so these are read from the source. That is a weaker
   * instrument than driving the code, and it is stated rather than hidden: each
   * assertion names the shape that was WRONG as well as the one that is right,
   * because a check that only looks for the fix passes on a revert that keeps
   * the words and changes the meaning.
   *
   * 1. THE LADDER WAS DEAD ON EVERY ROW IT WAS BUILT FOR. The clear branch
   *    tested `session.slot === null`, and for a LEARNED arsenal row that is
   *    always true - the reducer clamps anything outside 0-3 to null and keeps
   *    the index in `unreadSlot`. So every publish wiped the rungs, the pump's
   *    generation guard abandoned its generator, and `ladderEnd` sat at
   *    'complete' with nothing in it: the overlay's "nothing left to do".
   *
   * 2. TWO LADDERS COULD SHARE ONE BUFFER. The generation token was built from
   *    the memo key, and `item`, `mods` and `account` - the three parts that
   *    distinguish one plan from another - are objects that stringify to ''.
   *    Any inventory push while the screen was open started a second ladder
   *    with an identical token; both appended to one array with independent
   *    step counters, and whichever finished first declared the other done.
   *
   * 3. A LESSON REACHED NOBODY. `step` returns the same object for `modOwned`,
   *    so the identity early-return fired before `publishAutomod` and the screen
   *    never heard that the row had just been identified - defeating the whole
   *    point of the signal, which is the player who looks and does not touch.
   */
  const src = readFileSync(new URL('../src/app/background.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ');

  /*
   * The decision moved into `data/automod-publish.ts`, where the check above
   * DRIVES it. All that is left to assert here is that the controller asks
   * rather than deciding for itself - an inlined condition is how it went wrong
   * the first time.
   */
  /*
   * BY THE ASK, NOT BY THE ARGUMENT COUNT. The call gained `observed` - the
   * category deduced from the mod the player placed on a screen the log never
   * named - and pinning the exact two-argument form made this fail on an
   * addition it has no opinion about. What it is FOR is that the controller
   * asks rather than deciding for itself, and that it still hands over the two
   * things the decision is made from.
   */
  const decide = /publishDecision\(\{([^}]*)\}\)/.exec(src);
  assert.ok(decide, 'the controller decides for itself again instead of asking publishDecision');
  for (const arg of ['session', 'learned']) {
    assert.ok(new RegExp(`\\b${arg}\\b`).test(decide[1] ?? ''), `the controller stopped handing publishDecision its ${arg}`);
  }
  /*
   * AND NOTHING THROWS THE RUNGS AWAY ON A PUBLISH. There WAS a clear branch
   * here, keyed to the decision - and review found that it could not be undone:
   * the plan is memoised, so a reopen is a cache HIT, and `startLadder` runs
   * only inside the cache's producer. The staircase was gone for good and the
   * panel said "at the ceiling" over unspent Forma. The rungs are emptied in
   * exactly one place now - where a new ladder starts - and which rungs are
   * PUBLISHED is decided by plan identity.
   */
  assert.ok(/const showing = ladderToShow\(plan, ladderPlan/.test(src), 'the controller decides for itself which rungs to show instead of asking');
  assert.equal(
    (src.match(/ladderRungs = \[\];/g) ?? []).length,
    1,
    'the rungs are emptied somewhere other than the start of a new ladder, which a memoised plan can never rebuild',
  );
  assert.ok(/function startLadder[\s\S]{0,400}ladderRungs = \[\];/.test(src), 'the one place that empties the rungs is no longer the start of a ladder');
  /*
   * THE BUILD AND THE LADDER OPEN ON THE SAME BRANCH, and there is only one
   * condition in the file that can spell it. The pair disagreeing is the whole
   * defect: the build resolved for a learned row while the ladder was thrown
   * away, so the strip showed a plan with an empty staircase under it and
   * `ladderEnd: 'complete'` - "nothing left to do" - beneath it.
   */
  const resolve = /if \(([^)]*)\) \{\s*const resolved = resolveIn\(/.exec(src);
  assert.ok(resolve, 'the build no longer resolves inside a branch of its own');
  assert.equal(
    resolve[1]?.trim(),
    'nameable',
    `the build opens on "${String(resolve[1]?.trim())}" - the condition is spelled at the branch again rather than named once, which is how it and the ladder came to disagree`,
  );
  /*
   * And `nameable` is the two terms it claims to be: a screen open with a
   * category, AND a loadout the player has not changed under us.
   */
  const named = /const nameable = ([^;]+);/.exec(src);
  assert.ok(named, 'nameable is gone, so the branch above is naming something else');
  assert.equal(
    named[1]?.trim(),
    "ladderAction.kind === 'keep' && settled",
    `nameable is "${String(named[1]?.trim())}" - it must be BOTH the open screen and the settled loadout, or the panel can name a weapon the player has taken off`,
  );
  assert.ok(
    !/session\.slot\s*[!=]==\s*null/.test(src),
    'the controller compares session.slot against null again, which is true for every learned arsenal row',
  );

  const token = /const token = ([^;]+);/.exec(src);
  assert.ok(token, 'the ladder generation token is gone');
  assert.ok(
    /ladderGeneration/.test(token[1] ?? ''),
    `the token is built from "${String(token[1]?.trim())}" - if it is derived from the memo key it cannot tell two plans apart, because the parts that differ are objects`,
  );
  assert.ok(!/\bkey\b/.test(token[1] ?? ''), 'the token is derived from the cache key again');

  const bail = /if \(next === session\) \{([\s\S]*?)\}/.exec(src);
  assert.ok(bail, 'the identity early-return is no longer a block, so nothing can happen before it returns');
  assert.ok(
    /publishAutomod\(\)/.test(bail[1] ?? ''),
    'a lesson learned from a screen the player is looking at never reaches that screen: modOwned changes no session object, so the early return skips the publish',
  );
});

ok('the publish decision is DRIVEN, including the case that was dead in production', () => {
  /*
   * THE HOLE THIS SESSION'S GATES ACTUALLY HAD.
   *
   * Forty-odd checks drive the optimiser - beam search, ceilings, ladders,
   * routes, reachability - and not one could drive the CONTROLLER, because
   * `app/background.ts` imports Overwolf. So the algorithm was verified to
   * death and the wiring not at all, and the wiring is where the ladder was
   * broken: cleared whenever `session.slot` was null, which is ALWAYS true for
   * a learned arsenal row. The staircase published zero rungs with
   * `ladderEnd: 'complete'` on all six categories it had just been extended to
   * cover, and every gate passed.
   *
   * `data/automod-publish.ts` exists so that can be driven. Below is the exact
   * state that was broken - phase 'visible', slot null, unreadSlot 6, index 6
   * learned as a companion - and the ladder must survive it.
   */
  const open = (over: Partial<Session>): Session => ({ ...IDLE, phase: 'visible', openedAt: 1, ...over });

  // The four arsenal rows, unchanged.
  for (const [slot, category] of [
    [0, 'warframe'],
    [1, 'primary'],
    [2, 'secondary'],
    [3, 'melee'],
  ] as const) {
    const d = publishDecision({ session: open({ slot }), learned: {} });
    assert.equal(d.kind === 'keep' ? d.category : null, category, `slot ${String(slot)} no longer resolves`);
  }

  /*
   * THE ONE THAT WAS DEAD. A learned row: slot null, the index in `unreadSlot`,
   * and the app knows what it is. If this says 'reset' the staircase is gone on
   * every companion, archwing, arch-gun, arch-melee and necramech screen.
   */
  const learnedRow = publishDecision({ session: open({ slot: null, unreadSlot: 6 }), learned: { '6': 'companion' } });
  assert.equal(
    learnedRow.kind,
    'keep',
    'THE LADDER IS RESET ON A LEARNED ROW - the staircase publishes zero rungs marked complete on every category past the four',
  );
  assert.equal(learnedRow.kind === 'keep' && learnedRow.category, 'companion', 'a learned row no longer resolves to its category');

  // A row it has NOT learned has nothing to climb, and must reset.
  const unknownRow = publishDecision({ session: open({ slot: null, unreadSlot: 7 }), learned: { '6': 'companion' } });
  assert.equal(unknownRow.kind, 'reset', 'a ladder is kept for a screen the app cannot identify');

  // The Mods-segment open: no slot line at all, so nothing to resolve.
  const mods = publishDecision({ session: open({ slot: null, unreadSlot: null }), learned: {} });
  assert.equal(mods.kind, 'reset');

  // And idle drops it whatever the category says.
  const idle = publishDecision({ session: { ...IDLE, slot: 3 }, learned: {} });
  assert.equal(idle.kind, 'reset', 'the ladder outlives the screen that produced it');

  /*
   * WHAT MAKES THE STRIP APPEAR, driven for the same reason. "The screen is
   * open" was never the test: a screen the app can say nothing about is a blank
   * panel, and the overlay is unobtrusive by not appearing at all.
   */
  const noPlan = { plan: null, session: open({ slot: 3 }) };
  assert.equal(hasSomethingToSay(noPlan), false, 'the strip shows with nothing to say');
  assert.equal(
    hasSomethingToSay({ ...noPlan, session: open({ slot: 3, edits: [{ at: 1, name: 'Serration', itemType: '/x', installed: true }] }) }),
    true,
    'an edit to reflect is something to say, and the strip stays down',
  );
});

ok('a screen the app HAS identified is never called "another slot"', () => {
  /*
   * "another slot" is what the overlay says when it cannot read the screen at
   * all, and it was being said about screens the app had just worked out. The
   * title falls back through `SLOT_CATEGORY[session.slot]`, which answers for
   * the four arsenal rows and nothing else - and a learned row's slot is always
   * null, because the reducer clamps anything outside 0-3 into `unreadSlot`.
   *
   * This is the third place the same assumption was found: the ladder was
   * cleared on it, the build was resolved on it, and the title was written from
   * it. The other two are gated in `the controller wires the ladder to the
   * CATEGORY`; this is the one the player actually reads.
   */
  const ui = readFileSync(new URL('../src/app/automod.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ');
  const line = /const category = ([^;]+);/.exec(ui);
  assert.ok(line, 'the aside no longer works out which category is open');
  assert.ok(
    line[1]!.trimStart().startsWith('build?.category'),
    `the title reads "${String(line[1]?.trim())}" - the resolved build carries the category it was resolved FOR, and the slot table answers for four rows out of ten`,
  );

  // And the fallback still exists, for the state that has a slot and no build.
  assert.ok(line[1]!.includes('SLOT_CATEGORY[session.slot]'), 'the slot fallback is gone, so a build-less arsenal state is now nameless');
});

ok('only the rows that can SAY they clipped are allowed to clip', () => {
  /*
   * FOUND BY ENUMERATING THE PANEL RATHER THAN CHOOSING ITS STATES.
   *
   * `__exhaust` in the artboard builds the cross product of the aside's own
   * conditionals - 5,136 states - and feeds every one of them through the real
   * component. 192 of the first 1,300 clipped the AURA line: a column flex
   * item's default is `flex: 0 1 auto`, so when the panel ran long the browser
   * took the height out of whichever row it liked, and the row it liked was the
   * one line that says where the eight slots' extra capacity came from.
   *
   * Three rows are written to clip - `.am-missing`, `.am-queue`, `.am-assumed`.
   * Each is a list, each has `min-height: 0; overflow: hidden`, and each is
   * paired with a marker that states what was cut ("3 of 5 assumed", "and 4
   * more"). A row that clips without one is a panel lying about its own
   * contents, which is worse than a panel that says less.
   *
   * The stylesheet is the whole fix, so the stylesheet is what is checked.
   */
  const css = readFileSync(new URL('../src/styles/automod.css', import.meta.url), 'utf8');
  const blanket = /\.am-aside > \*\s*\{[^}]*flex:\s*0 0 auto/.test(css);
  assert.ok(blanket, 'the aside no longer pins its rows, so the browser decides which one gets crushed when the panel runs long');

  const shrinkers = [...css.matchAll(/(\.[a-z-]+)\s*\{[^}]*flex:\s*0 1 auto/g)].map((m) => m[1]);
  /*
   * `.am-queue` WAS ON THIS LIST AND RENDERS NOWHERE.
   *
   * The queue was the panel's old answer - a list of the next few steps - and
   * it was replaced by the ladder's single instruction. The markup went and the
   * rule stayed, so this gate has been asserting that a class nothing draws is
   * allowed to shrink. The stylesheet's own note two hundred lines down already
   * said as much: "two names in it (`.am-hero`, `.am-queue li`) match nothing
   * at all any more." Three rows can clip because three rows exist.
   */
  assert.deepEqual(
    [...shrinkers].sort(),
    ['.am-assumed', '.am-build', '.am-missing'],
    `a row that is not a self-reporting list is allowed to shrink: ${shrinkers.join(', ')}`,
  );
  for (const cls of shrinkers) {
    const rule = new RegExp(`\\${cls}\\s*\\{[^}]*\\}`).exec(css)?.[0] ?? '';
    assert.ok(/min-height:\s*0/.test(rule), `${cls} shrinks without min-height: 0, so it will not actually clip - it will squash its rows`);
    assert.ok(/overflow:\s*hidden/.test(rule), `${cls} shrinks without hiding the overflow`);
  }

  /*
   * AND THE MARKER, which is the reason the clip is allowed at all. The footer
   * counts what FITS, not what exists - a measured number, not the length of
   * the array.
   */
  const ui = readFileSync(new URL('../src/app/automod.tsx', import.meta.url), 'utf8');
  /*
   * WHAT FITS AGAINST WHAT EXISTS - and with no floor under it. This asked for
   * `assumedShown > 0 && ...`, which is the guard that made the panel lie:
   * enumerating every state found 720 at 1680x1050 and 2,340 at 1366x768 where
   * the column squeezes the caveat list to nothing and the footer then printed a
   * flat "1 assumed" for something the player could not read a word of. Zero
   * shown is a reading, not an exception.
   */
  assert.ok(
    /assumedShown < planAssumed\.length/.test(ui),
    'the footer stopped comparing what fits against what exists, so a clipped list is reported as a whole one',
  );
  assert.ok(
    // Comments stripped: the note above the fix quotes the shape it replaced.
    !/assumedShown > 0/.test(ui.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*/g, ' ')),
    'the footer floors the shown count at one again, so a caveat list with no room at all is reported as fully shown',
  );
});

ok('the account is re-read when a screen OPENS, not when it closes', () => {
  /*
   * MY OWN FIX, DOING THE OPPOSITE OF WHAT IT CLAIMED.
   *
   * The trigger was `was === 'idle' && next.phase !== 'idle'`. The game emits a
   * trailing `HudVis 1` about 200 ms AFTER `GoToPreviousScreen`, and the reducer
   * turns a `hudVisible` arriving at idle into `visible`. Driven over this
   * machine's whole EE.log - 697,130 lines - there are 16 idle-to-non-idle
   * transitions and FIFTEEN are that phantom. So the refresh fired as the player
   * left the screen, the session then sat non-idle for as long as they kept
   * playing, and every real open after the first was skipped: exactly the stale
   * weapon the fix was written to stop.
   *
   * `openedAt` is set by the reducer only on an open the log narrates.
   */
  const closeThenHud = fold([
    { at: 240.0, type: 'screen', name: 'UpgradeCards', open: true },
    { at: 241.0, type: 'screen', name: 'UpgradeCards', open: false },
    { at: 241.206, type: 'hudVisible', screen: 'UpgradeCards', level: 1 },
  ]);
  /*
   * The reducer now refuses the phantom outright (the check below this one), so
   * the session stays idle. What matters HERE is the other half: whichever way
   * the reducer treats it, the trailing line must never be read as an open, and
   * `openedAt` is what that question is asked of.
   */
  assert.equal(closeThenHud.openedAt, null, 'the phantom carries an openedAt, which would make it look like a real open');
  assert.equal(
    opensAScreen({ openedAt: null }, closeThenHud),
    false,
    'THE ACCOUNT IS RE-READ AS THE PLAYER LEAVES: a HudVis 200 ms after the close is counted as an open',
  );

  // And a real open, arriving from the phase that phantom leaves behind.
  const real = step(closeThenHud, { at: 242.0, type: 'screen', name: 'UpgradeCards', open: true }, freshPending());
  assert.notEqual(real.openedAt, null, 'a real open no longer records when it happened');
  assert.equal(
    opensAScreen(closeThenHud, real),
    true,
    'a real open arriving from a non-idle phase is not counted, which is every open but the first of a session',
  );

  // Two publishes for one open must not ask twice.
  assert.equal(opensAScreen(real, real), false, 'the same open asks for the account again on every publish');
});

ok('the staircase belongs to the PLAN, so a close cannot lose it', () => {
  /*
   * A REGRESSION THIS SESSION INTRODUCED, found by review.
   *
   * Clearing the rungs when the screen closes looks right and is not: the plan
   * is MEMOISED, so reopening an unchanged item returns the same `Plan` object
   * on a cache HIT - and `startLadder` runs only inside the cache's producer,
   * which a hit never runs. The staircase was gone for good, and the panel then
   * published `ladder: []` with `ladderEnd: 'complete'`, which `automod.tsx`
   * reads as nothing left to do: it printed AT THE CEILING over a build with
   * six Forma of work in front of it.
   */
  const plan = { itIsHere: true };
  const rungs = [{ step: 1, kind: 'mod', path: '/M/X', name: 'X', value: 1, gain: 1 }] as unknown as Rung[];

  const mine = ladderToShow(plan, plan, { rungs, end: 'horizon' });
  assert.equal(mine.rungs.length, 1, 'the rungs are dropped for the very plan they were built for');
  assert.equal(mine.end, 'horizon', 'the ending is rewritten for a ladder that is genuinely this plan\'s');

  // Another plan's rungs are not this plan's, and the empty state must not lie.
  for (const other of [{ different: true }, null]) {
    const shown = ladderToShow(other, plan, { rungs, end: 'horizon' });
    assert.deepEqual(shown.rungs, [], 'rungs from a different plan are published');
    assert.equal(
      shown.end,
      'working',
      'AN EMPTY LADDER IS REPORTED AS COMPLETE - the panel reads that as "nothing left to do" and says so over a build that has work left',
    );
  }

  // The state that started it: a plan on screen with no ladder for it yet.
  const none = ladderToShow(plan, null, { rungs: [], end: 'complete' });
  assert.equal(none.end, 'working', 'a plan whose ladder has not started yet is reported as finished');
});

ok('nothing is named from a loadout the app has not confirmed for THIS screen', () => {
  /*
   * WHAT THE PLAYER SAW, TWICE, IN BOTH DIRECTIONS: "BROKEN WAR" titled over an
   * unranked Ankyros, and "ANKYROS" titled over Broken War, each with a full
   * plan for a weapon that was not on the screen. The item comes from the
   * account's loadout presets and the account is a SNAPSHOT.
   *
   * THE FIRST FIX KEYED THIS TO THE WRONG LINE, and review caught it against a
   * real session: `OnSaveLoadOutCompleteCommon` fires 7 ms before the arsenal
   * screen closes, whether or not anything was equipped. So every arsenal exit
   * marked the loadout stale, the panel carried a false caveat that nothing
   * could clear - an unchanged read is deduped before the store sees it - and
   * the session parked at `saved`, which made the detector deaf to a real equip.
   *
   * The SCREEN OPENING is the honest trigger: the only moment the answer
   * matters, a few times an hour, and never a false positive.
   */
  const t = 1_000_000;

  // No screen open: nothing to confirm, nothing withheld.
  assert.deepEqual(openPolicy({ opened: false, openedAtWall: null, changedAt: null, answeredAt: null, now: t }), {
    refresh: false,
    nameable: true,
    stale: false,
  });

  // The open asks for a read, and says nothing until it lands.
  const onOpen = openPolicy({ opened: true, openedAtWall: t, changedAt: t - 1, answeredAt: null, now: t + 1 });
  assert.equal(onOpen.refresh, true, 'an open no longer asks the game for a fresh account');
  assert.equal(onOpen.nameable, false, 'THE PANEL NAMES THE PREVIOUS WEAPON: the read for this screen has not landed');
  assert.equal(onOpen.stale, false, 'a panel that is still waiting is reported as stale rather than silent');

  // The read lands and the account had changed: named, no caveat.
  const landed = openPolicy({ opened: false, openedAtWall: t, changedAt: t + 10, answeredAt: null, now: t + 20 });
  assert.equal(landed.nameable, true, 'a read newer than the open still does not let the panel speak');
  assert.equal(landed.stale, false, 'a confirmed loadout is reported as unconfirmed');

  /*
   * AND THE ORDINARY CASE, which is the one that was broken: the player opens a
   * modding screen and NOTHING about the account has changed since the last
   * read. The store stamps `inventoryAt` only on a real difference - a
   * byte-identical payload is dropped before it gets there, on purpose, because
   * that is what keeps a repeated read cheap - so the answer the panel was
   * waiting for moved no clock it was watching. It sat silent for the whole
   * settle window and then printed "the loadout could not be re-read for this
   * screen" over a loadout the game had just confirmed. Every visit.
   */
  const unchanged = openPolicy({ opened: false, openedAtWall: t, changedAt: t - 90_000, answeredAt: t + 10, now: t + 20 });
  assert.equal(unchanged.nameable, true, 'AN UNCHANGED ACCOUNT NEVER CONFIRMS: the panel waits out its window on the ordinary visit');
  assert.equal(unchanged.stale, false, 'a read that answered "nothing is different" is reported to the player as a failure to read');

  // And the older of the two never speaks for the newer.
  const onlyOld = openPolicy({ opened: false, openedAtWall: t, changedAt: t - 1, answeredAt: t - 1, now: t + 20 });
  assert.equal(onlyOld.nameable, false, 'two clocks that both predate the open are read as a confirmation');

  /*
   * AND THE WAIT ENDS. The read can simply never arrive - GEP reads the game's
   * memory and `ingest` drops a byte-identical payload before the store sees it,
   * so a refusal and "nothing changed" are the same thing from here. Measured on
   * the live app after a restart, `inventoryAt` was null with a full account
   * loaded from disk. A panel that never comes back is a broken overlay.
   */
  const waiting = openPolicy({ opened: false, openedAtWall: t, changedAt: null, answeredAt: null, now: t + SETTLE_WAIT_MS - 1 });
  assert.equal(waiting.nameable, false, 'the panel gives up waiting early and names a weapon it has not confirmed');
  const gaveUp = openPolicy({ opened: false, openedAtWall: t, changedAt: null, answeredAt: null, now: t + SETTLE_WAIT_MS });
  assert.equal(gaveUp.nameable, true, 'THE PANEL STAYS BLANK FOR THE WHOLE VISIT when the read never lands');
  assert.equal(gaveUp.stale, true, 'it names an unconfirmed item and does not say so');
  assert.ok(SETTLE_WAIT_MS >= 2_000 && SETTLE_WAIT_MS <= 10_000, `the wait is ${String(SETTLE_WAIT_MS)} ms, which is either a flicker or an outage`);

  const src = readFileSync(new URL('../src/app/background.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ');

  /*
   * THE DEADLINE IS SCHEDULED, and this is the half that had no way to fire.
   * Every other publish needs an event, and the event being waited for is the
   * one that may never come - so without a timer the "give up after four
   * seconds" never happened and the panel stayed blank for the whole visit. A
   * real visit in the log ran 88 seconds with no arsenal line at all.
   */
  assert.ok(/settleTimer = setTimeout\(/.test(src), 'nothing schedules the end of the wait, so giving up never happens');
  assert.ok(/SETTLE_WAIT_MS \+ 50/.test(src), 'the timer does not outlast the deadline it exists to reach');
  assert.ok(/openedAtWall = Date\.now\(\);/.test(src), 'the wait no longer starts when the screen opens');

  /*
   * AND THE ARSENAL'S EXIT SAVE IS NOT TREATED AS AN EQUIP. It may still earn a
   * READ - the account may have moved - but a gentle one, behind the floor.
   */
  const saveBranch = /event\.type === 'loadoutSaved' && session\.phase === 'idle'\) ([^;]+);/.exec(src);
  assert.ok(saveBranch, 'the arsenal write is no longer handled at all');
  assert.ok(
    /gep\.refresh\('the arsenal wrote a loadout'\)/.test(saveBranch[1] ?? ''),
    `the exit save does "${String(saveBranch[1]).trim()}" - it fires 7 ms before the arsenal closes whether or not anything changed, so it must not mark anything stale or bypass the floor`,
  );
  assert.ok(!/loadoutChangedAt/.test(src), 'the controller still keys staleness to the arsenal write, which is a false positive on every exit');

  /*
   * AND THE CONTROLLER HANDS OVER BOTH CLOCKS. Passing only `inventoryAt` is
   * the defect above, and it type-checks.
   */
  assert.ok(
    /openPolicy\(\{ opened: false, openedAtWall, changedAt: account\.inventoryAt, answeredAt: account\.answeredAt \}\)/.test(src),
    'the publish no longer asks with both clocks, so an unchanged account reads as an unread one',
  );
  const gepSrc = readFileSync(new URL('../src/core/gep.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ');
  assert.ok(
    /private answer\(\): void \{\s*this\.answeredAt = Date\.now\(\);\s*this\.emit\('answered', this\.answeredAt\);\s*\}/.test(gepSrc),
    'nothing stamps the moment the game answered and passes it on, so the second clock never moves',
  );
  const answered = /gep\.on\('answered', \(at\) => \{[\s\S]*?\n\}\);/.exec(src);
  assert.ok(answered, 'the controller does not handle the answer at all, so the store and the live probe cannot see it');
  assert.ok(/store\.setAnswered\(at\);/.test(answered[0]), 'the answer never reaches the store');
  /*
   * AND IT ENDS THE WAIT. An unchanged read emits no `inventory` - that is the
   * whole point of the dedupe - so without this the panel sits out its full
   * four seconds on every visit where the player changed nothing, which is most
   * of them. The timer is also the guard against publishing twice: a read that
   * DID change something has already been published by the `inventory` handler,
   * which cleared it.
   */
  assert.ok(
    !/if \(settleTimer === null\) return;/.test(answered[0]),
    'THE CAVEAT STICKS FOR THE VISIT: the timer nulls itself when it fires, so an answer arriving even slightly late publishes nothing at all',
  );
  /*
   * COMMENTS STRIPPED BEFORE MEASURING THE DISTANCE. The window is there to
   * stop the publish drifting away from the clear into some other branch, and a
   * paragraph of explanation between the two is not drift - but it counts
   * against a character budget just the same, so this gate failed on a comment
   * being added. What it measures is CODE distance.
   *
   * And it is `publishAndShow` now, not `publishAutomod`. That is the fix for
   * the bug this gate's own sibling describes: the answer arriving published
   * the new state to a window nobody had put on the screen, so the overlay did
   * not appear until the player next placed a mod. Publishing without showing
   * on this path is the defect, so the bare form is what must fail here.
   */
  const code = (answered[0] ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*/g, ' ');
  assert.ok(
    /clearTimeout\(settleTimer\);[\s\S]{0,120}publishAndShow\(\);/.test(code),
    'THE PANEL STILL WAITS FOUR SECONDS ON AN ORDINARY VISIT: the answer arrives and nothing publishes it',
  );
  assert.ok(/if \(session\.phase !== 'idle'\) publishAndShow\(\);/.test(code), 'the answer publishes with no screen open');

  /*
   * AND THE CLOCK STOPS WITH THE GAME. It is a wall time, it is printed - by
   * `npm run live` and by every panel that shows when the account was read -
   * and nothing has answered since the game exited. Left set, the app reports
   * "answered at 14:02" for a process that is not running.
   */
  const disconnect = /disconnect\(\): void \{[\s\S]*?\n {2}\}/.exec(gepSrc);
  assert.ok(disconnect, 'disconnect() is gone from gep.ts');
  assert.ok(/this\.answeredAt = null;/.test(disconnect[0]), 'the answer clock survives the game exiting, so the app reports a read from a process that is gone');
  const stop = /onStop: \(\) => \{[\s\S]*?\n {2}\}/.exec(src);
  assert.ok(stop, 'the game-stop handler is gone from background.ts');
  assert.ok(/setAnswered\(null\)/.test(stop[0]), 'the store keeps the answer clock after the game exits, and the panels print it');
  assert.ok(
    /=== 'nothing'\) \{[\s\S]{0,200}?return;\s*\}\s*this\.answer\(\);/.test(gepSrc),
    'A FAILED READ CONFIRMS THE LOADOUT: the refresh answers before it has checked what came back',
  );
  /*
   * AND THE SEED ANSWERS TOO, because the seed is a read. At startup the
   * account comes off disk and the seed reads the same account out of the game,
   * so the merge returns the object it was given and `inventoryAt` never moves -
   * measured on the live app, a full account with 316 mod rows and both clocks
   * null. Leaving the seed out makes the FIRST modding screen of every session
   * the broken case, which is the most common one there is.
   */
  assert.equal(
    (gepSrc.match(/this\.answer\(\);/g) ?? []).length,
    3,
    'the seed, the refresh and a pushed update are not all counted as the game answering',
  );
  /*
   * AND A PUSH IS ONE OF THEM. It is now the single place a pushed account
   * announces itself, which is what lets the controller publish from ONE
   * handler: publishing from `inventory` as well meant a read that changed
   * something published twice, while a read that changed nothing had to be
   * caught by a timer - and an answer arriving after that timer had fired
   * published nothing at all and left its caveat up for the rest of the visit.
   */
  assert.ok(
    /if \(refreshOutcome\(this\.ingest\(e\.info as InfoBag\)\.inventory\) !== 'nothing'\) this\.answer\(\);/.test(gepSrc),
    'a pushed account is not an answer, so the panel waits for a read it has already had',
  );
  assert.ok(!/if \(session\.phase !== 'idle'\) publishAutomod\(\);\s*\}\);\s*\/\*[\s\S]{0,40}THE GAME ANSWERED/.test(src), 'the inventory handler publishes as well, so a changed read publishes twice');
});

ok('the instruction advances as the player follows it', () => {
  /*
   * MEASURED LIVE, on four real visits to a Grimoire: the panel held
   * `now=628 ideal=1451 steps=4` across eleven consecutive publishes while the
   * player placed eleven mods, and the top instruction never moved. Place the
   * mod it asks for and it asks again - which is the overlay failing at the one
   * thing the brief calls its first job.
   *
   * The plan comes from `build.installed`, the ACCOUNT's saved config, and the
   * account does not move until the arsenal writes. The log does: `modInstalled`
   * carries the mod's FULL path on every placement, so `netEdits` says exactly
   * which steps are already done - no leaf ambiguity, no rank guess.
   */
  const steps = [
    { path: '/Lotus/Upgrades/Mods/A', name: 'A' },
    { path: '/Lotus/Upgrades/Mods/B', name: 'B' },
    { path: '/Lotus/Upgrades/Mods/C', name: 'C' },
  ];

  assert.deepEqual(stillToDo(steps, []), steps, 'a visit with no placements is filtered anyway');
  assert.deepEqual(
    stillToDo(steps, ['/Lotus/Upgrades/Mods/A']).map((x) => x.name),
    ['B', 'C'],
    'THE INSTRUCTION REPEATS ITSELF: the mod the player just placed is still the top of the list',
  );
  assert.deepEqual(
    stillToDo(steps, ['/Lotus/Upgrades/Mods/C', '/Lotus/Upgrades/Mods/A']).map((x) => x.name),
    ['B'],
    'placements are matched by position rather than by path',
  );
  assert.deepEqual(stillToDo(steps, ['/Lotus/Upgrades/Mods/Z']).map((x) => x.name), ['A', 'B', 'C'], 'a mod that is on no step drops one anyway');

  /*
   * A RUNG WITH NO PATH SURVIVES, ALWAYS, and the type checker found this
   * rather than a reader: `Rung`'s `forma` variant carries no `path`, and
   * neither does `unlock`. Neither is a mod placement, so no placement can
   * satisfy one - dropping it because the player put a mod on would delete an
   * instruction they still have to follow.
   */
  const withForma = [{ kind: 'forma', step: 1 }, { kind: 'mod', step: 2, path: '/Lotus/Upgrades/Mods/A' }];
  assert.deepEqual(
    stillToDo(withForma, ['/Lotus/Upgrades/Mods/A']).map((x) => x.kind),
    ['forma'],
    'A FORMA RUNG IS DELETED BY A MOD PLACEMENT: it carries no path, so nothing the player places can have satisfied it',
  );
  assert.equal(stillToDo([{ kind: 'forma' }], ['/Lotus/Upgrades/Mods/A']).length, 1, 'a pathless rung is dropped');

  /*
   * AND THE PANEL NEVER ANNOUNCES A FINISHED BUILD BECAUSE OF THIS.
   * `atCeiling` is derived from the ladder's length, so filtering the list to
   * empty would declare the build complete the moment the player placed the
   * last suggestion - before the arsenal has written anything, and while the
   * account still says otherwise. The component falls back to the unfiltered
   * list rather than showing nothing.
   */
  const tsx = readFileSync(new URL('../src/app/automod.tsx', import.meta.url), 'utf8');
  assert.ok(/const shownLadder = /.test(tsx), 'the column no longer separates what it SHOWS from the ladder it reasons about');
  assert.ok(/return ahead\.length > 0 \? ahead : ladder;/.test(tsx), 'an all-placed visit leaves the column with nothing to show');
  assert.ok(
    /const ladderIdle = ladderEnd === 'complete' && ladder\.length === 0;/.test(tsx),
    'THE PANEL CALLS THE BUILD FINISHED THE MOMENT THE LAST MOD IS PLACED: `ladderIdle` is reading the filtered list',
  );
  assert.ok(/<WhatNext rungs=\{shownLadder\}/.test(tsx), 'the panel still shows steps the player has already done');
});

ok('the enumeration is measured against the panel it claims to enumerate', () => {
  /*
   * "IT MUST TAKE INTO ACCOUNT ALL POSSIBLE UI STATES" is the brief, and
   * `scripts/panel-states.js` is the instrument that answers it: 5,136 states
   * built from the Aside's own conditionals, at five resolutions. It has found
   * five defects a hand-written sweep of 34 could not.
   *
   * NOTHING CONNECTED IT TO THE PANEL. Its axes were read off the component by
   * hand, once. Add a conditional row to `Aside` and the enumeration keeps
   * reporting 5,136 states with complete confidence while the new row is in
   * none of them - the instrument going stale exactly the way the artboard did
   * when the app moved from Q1 to Q2 and it kept feeding Q1.
   *
   * This is the connection, in both directions. It cannot prove coverage; it
   * makes losing coverage a thing somebody has to do on purpose.
   */
  const tsx = readFileSync(new URL('../src/app/automod.tsx', import.meta.url), 'utf8');
  const states = readFileSync(new URL('./panel-states.js', import.meta.url), 'utf8');

  /*
   * DIRECTION TWO FIRST, because everything else is measured against it: the
   * conditional renders inside `Aside`'s body. Every `{x && (` and `{x ? (`
   * that decides whether something appears at all.
   */
  const start = tsx.indexOf('function Aside({');
  assert.ok(start > 0, 'the Aside component has been renamed, and the enumeration is built entirely from its conditionals');
  const bodyEnd = tsx.indexOf('\nfunction ', start + 10);
  const body = tsx.slice(start, bodyEnd === -1 ? tsx.length : bodyEnd);
  const branches = [...body.matchAll(/\{[^{}\n]{1,80}(?:&&|\?)\s*\(?\s*\n?\s*</g)].map((m) => m[0]);

  /*
   * THE COLUMN IS NOT ALL IN `Aside`, AND DIRECTION ONE ASSUMED IT WAS.
   *
   * Two of its axes - forma and aura - now vary a ROW of `CostLedger`, which
   * `Aside` renders. Neither the condition nor the state disappeared: a
   * `Ledger` row whose value is null is dropped, so a build with no Forma still
   * produces a column one row shorter, exactly as the `&&` did. What changed is
   * which FUNCTION the condition is written in.
   *
   * The branch COUNT stays scoped to `Aside`, because that is what it is for -
   * noticing that somebody added a row nobody enumerated. Direction one, which
   * asks whether an axis still varies something real, has to follow a condition
   * into the small components `Aside` composes, or splitting a long render
   * function out is by itself enough to make this report a false loss of
   * coverage. Splitting one out is a thing this file's own neighbours do on
   * purpose, and `Aside` is itself the result of one.
   *
   * They are NAMED rather than searched for: the whole point of matching
   * against condition text instead of the file is that `plan.ideal.aura`
   * appears five times in `Aside` and only one of them is the row the axis
   * varies. A list keeps that precision while letting the code move.
   */
  const ROW_COMPONENTS = ['function StateLedger(', 'function CostLedger(', 'function Ledger('];
  const conditions: string[] = [...branches];
  for (const fn of ROW_COMPONENTS) {
    const at = tsx.indexOf(fn);
    assert.ok(at > 0, `${fn} is gone, and two of the enumeration's axes live in it`);
    const end = tsx.indexOf('\nfunction ', at + 10);
    conditions.push(tsx.slice(at, end === -1 ? tsx.length : end));
  }
  assert.equal(
    branches.length,
    ASIDE_BRANCHES,
    `Aside now has ${String(branches.length)} conditional renders, not ${String(ASIDE_BRANCHES)}. If the new one changes what the column shows, give it an axis in scripts/panel-states.js and re-run the enumeration; if it cannot change the layout, say why beside ASIDE_BRANCHES and move the number`,
  );

  /*
   * DIRECTION ONE: every axis still varies a branch that exists.
   *
   * Matched against the CONDITION TEXT of those branches, not against the file.
   * Two weaker versions of this check passed while the branch they claimed to
   * cover had been renamed: `includes` matched `plan.ideal.aura` inside
   * `plan.ideal.aura2`, and searching the whole component matched the same name
   * where it is used for something else - `plan.ideal.aura` appears five times
   * in Aside and only one of them is the row this axis varies. A check that
   * cannot tell those apart is the stale instrument it exists to prevent.
   */
  const AXIS_CONDITIONS: Array<[string, string]> = [
    ['destination', 'atCeiling'],
    ['figureNote', 'figureNote'],
    /*
     * Named as the ROW component spells them. `Aside` passes `plan.forma` and
     * `plan.ideal.aura` down as `forma` and `aura`, so the condition text moved
     * with the code. `showAura` is a better anchor than the old
     * `plan.ideal.aura` was: that name appears five times in `Aside` and only
     * one of them was the row this axis varies, which is the ambiguity the note
     * above records fixing once already. `showAura` names the suppression and
     * nothing else.
     */
    ['forma', 'forma.count'],
    ['aura', 'showAura'],
    ['assumed', 'planAssumed.length'],
    ['unscored', 'unscored'],
    ['view', 'showBuild'],
    ['ladder', 'nextReach'],
  ];
  for (const [axis, condition] of AXIS_CONDITIONS) {
    assert.ok(
      conditions.some((b) => mentions(b, condition)),
      `nothing the column renders tests \`${condition}\`, so the enumeration's "${axis}" axis varies a branch that is gone - and whatever replaced it is in no state at all`,
    );
  }

  /*
   * And the axes whose branch lives in a child component: the column hands the
   * whole decision over, and the enumeration varies the child's own shapes.
   */
  for (const [axis, child] of [
    /*
     * `<Price>` was a component and is now two rows of `CostLedger`, which
     * takes the purse and decides the shortfall with the same `afford` call.
     * The axis varies the same thing; it is handed over one level lower.
     */
    ['purse', '<CostLedger'],
    ['ladder', '<WhatNext'],
    ['no-plan', '<NoPlan'],
    ['ideal', 'ideal.length'],
  ] as Array<[string, string]>) {
    assert.ok(mentions(body, child), `Aside no longer renders \`${child}\`, which the enumeration's "${axis}" axis is built from`);
  }

  // And the enumeration still declares the resolutions it sweeps.
  assert.ok(/__exhaustAll/.test(states), 'the enumeration no longer offers the all-resolutions run, which is where four of its five findings came from');
  assert.ok(/const AXES = \{/.test(states), 'the enumeration no longer builds a cross product, so its state count means nothing');
});

ok('the column stays on the question the player asked, and only for the item they asked it about', () => {
  /*
   * The toggle used to carry a comment saying it "resets with the item, not
   * with the publish" and the component was never remounted or keyed, so it did
   * neither: one press of `build` and every weapon after it opened on the build
   * view of a question nobody had asked about it.
   */
  const a = { instanceId: 'aaa', itemType: '/Lotus/Weapons/Tenno/Melee/Ankyros' };
  const b = { instanceId: 'bbb', itemType: '/Lotus/Weapons/Tenno/Melee/BrokenWar' };

  assert.equal(itemIdentity(100, a), itemIdentity(100, a), 'the same item on the same visit re-publishes as a different item, closing the view under the player');
  assert.notEqual(itemIdentity(100, a), itemIdentity(100, b), 'TWO WEAPONS READ AS ONE: the build view stays open across a screen change');
  assert.notEqual(itemIdentity(100, a), itemIdentity(200, a), 'a fresh visit to the same weapon does not start on the next thing to do');

  // An unresolved build is still a screen, and two of them are still one visit.
  assert.equal(itemIdentity(100, null), itemIdentity(100, null), 'a screen with no build yet changes identity on every publish');
  assert.notEqual(itemIdentity(100, null), itemIdentity(100, a), 'the build arriving mid-visit does not count as the item becoming known');

  // Instance before type: two copies of one weapon are two different builds.
  assert.notEqual(
    itemIdentity(100, { instanceId: 'aaa', itemType: '/Lotus/X' }),
    itemIdentity(100, { instanceId: 'ccc', itemType: '/Lotus/X' }),
    'two copies of the same weapon are one item, so the view carries between them',
  );

  const tsx = readFileSync(new URL('../src/app/automod.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ');
  assert.ok(/const itemKey = itemIdentity\(session\.openedAt, build\);/.test(tsx), 'the column no longer derives an identity for what it is showing');
  assert.ok(
    /if \(shownFor !== itemKey\) \{\s*setShownFor\(itemKey\);\s*setShowBuild\(false\);\s*\}/.test(tsx),
    'nothing resets the view when the item changes, so the toggle is sticky across weapons',
  );
  assert.ok(!/<Aside[^>]*\skey=/.test(tsx), 'the reset is done by remounting, which replays the arrival animation in a window whose document is frozen between visits');
});

ok('the trailing line of a close does not invent a session', () => {
  /*
   * MEASURED ON THE REAL LOG, and it is the most common transition in the file:
   *
   *   6693.032  DiegeticUpgradeCards.lua: Background::GoToPreviousScreen  <- close
   *   6693.238  DiegeticUpgradeCards.lua: DBG: HudVis 1                   <- 206 ms later
   *
   * Read plainly, the second line is a screen becoming visible with no open on
   * record - which is exactly the shape of the app being launched while the
   * player is already modding. So the reducer produced a `visible` session with
   * `seenWithoutOpen: true` fifteen times in 697,130 lines, each one an artefact
   * of the player LEAVING, and each one able to put "Joined late: this is
   * everything since the tail started" on the screen of a player the app had
   * been following the whole time.
   */
  const visit = fold([
    { at: 6600.0, type: 'screen', name: 'UpgradeCards', open: true },
    { at: 6600.5, type: 'hudVisible', screen: 'UpgradeCards', level: 1 },
    { at: 6693.032, type: 'screen', name: 'UpgradeCards', open: false },
    { at: 6693.238, type: 'hudVisible', screen: 'UpgradeCards', level: 1 },
  ]);
  assert.equal(visit.phase, 'idle', 'the trailing HudVis still opens a session out of a close');
  assert.equal(
    visit.seenWithoutOpen,
    false,
    'a visit the app watched from the open still ends up flagged as a late join, which puts "Joined late" on the panel',
  );

  /*
   * AND A GENUINE LATE JOIN IS UNTOUCHED. The app launched with the screen
   * already open sees a HudVis with no close before it at all - the case rule 2
   * of this module exists for - and that must still report itself.
   */
  const lateJoin = fold([{ at: 12.5, type: 'hudVisible', screen: 'UpgradeCards', level: 1 }]);
  assert.equal(lateJoin.phase, 'visible', 'a real late join no longer reports the screen as drawn');
  assert.equal(lateJoin.seenWithoutOpen, true, 'a real late join no longer says so');

  /*
   * And a HudVis a long way after a close is a new visit, not an artefact: the
   * player closed the screen, played, and came back through a path that emits no
   * open line. One second is the measured gap; a minute is a visit.
   */
  const laterVisit = fold([
    { at: 90, type: 'screen', name: 'UpgradeCards', open: true },
    { at: 100, type: 'screen', name: 'UpgradeCards', open: false },
    { at: 160, type: 'hudVisible', screen: 'UpgradeCards', level: 1 },
  ]);
  assert.equal(laterVisit.phase, 'visible', 'a HudVis a minute after a close is swallowed as an artefact');
  assert.equal(laterVisit.seenWithoutOpen, true, 'a visit that begins with no open of its own no longer says so');

  /*
   * AND THE WINDOW CANNOT RUN BACKWARDS, which is what a game restart does to
   * it. `at` is seconds since the game launched, so the first screen of a new
   * run is timestamped in the tens while the close we remember still holds the
   * six thousand of the last one. That difference is hugely NEGATIVE, and it
   * passed `<= 1` - so every `HudVis` at idle was swallowed as somebody else's
   * trailing line and the overlay never came up again until a close was seen in
   * the new run. `SLOT_LEADS_OPEN_SECONDS` has carried the same guard all along.
   */
  const afterRestart = fold([
    { at: 6693.032, type: 'screen', name: 'UpgradeCards', open: false },
    { at: 41.9, type: 'hudVisible', screen: 'UpgradeCards', level: 1 },
  ]);
  assert.equal(afterRestart.phase, 'visible', 'A RESTART SILENCES THE OVERLAY FOR THE WHOLE RUN: the log clock went back, so every HudVis reads as a trailing line');

  /*
   * AND THE CLOSE IS REMEMBERED ACROSS THE LINES THAT FOLLOW IT. The three
   * events that can arrive at idle rebuild the session from `IDLE`, which zeroes
   * `closedAt` - so anything landing between a close and its own trailing
   * `HudVis` took the suppression window with it and handed the player the
   * "Joined late" flag this check exists to prevent.
   */
  for (const between of [
    { at: 6693.1, type: 'modInstalled', name: 'True Steel', itemType: '/Lotus/Upgrades/Mods/Melee/WeaponCritChanceMod', installed: true },
    { at: 6693.1, type: 'fusionCost', endo: 15_330, credits: 740_439 },
    { at: 6693.1, type: 'loadoutSaved' },
  ] as LogEvent[]) {
    const interrupted = fold([
      { at: 6600.0, type: 'screen', name: 'UpgradeCards', open: true },
      { at: 6693.032, type: 'screen', name: 'UpgradeCards', open: false },
      between,
      { at: 6693.238, type: 'hudVisible', screen: 'UpgradeCards', level: 1 },
    ]);
    /*
     * THE ASSERTION IS THE BEHAVIOUR, NOT THE FIELD. The first version of this
     * checked `closedAt === 6693.032` and passed with the entire suppression
     * deleted - it proved a number was carried and nothing about what the
     * carrying is for.
     *
     * And the behaviour is one-sided: only `fusionCost` leaves the session at
     * `idle`, which is the only phase the suppression consults. `modInstalled`
     * leaves `editing` and `loadoutSaved` leaves `saved`, and a `HudVis` in
     * either of those is already ignored - so their carries are belt to
     * `fusionCost`'s braces, and a reader tidying away a "redundant" line has
     * to be able to see which one is not.
     */
    assert.notEqual(interrupted.phase, 'visible', `a ${between.type} at idle lets the close's own trailing line open a session the player never did`);
    assert.equal(interrupted.closedAt, 6693.032, `a ${between.type} at idle drops the close it should be carrying past`);
  }

  /*
   * AND THE CARRY IS ONLY LOAD-BEARING ON ONE OF THE THREE. `modInstalled`
   * leaves `editing` and `loadoutSaved` leaves `saved`; the suppression only
   * ever consults the idle branch, so those two are belt to `fusionCost`'s
   * braces. Stated here because a reader who deletes the "redundant" carries
   * has to see which one is not.
   */
  const fusionKeepsIdle = fold([
    { at: 6693.032, type: 'screen', name: 'UpgradeCards', open: false },
    { at: 6693.1, type: 'fusionCost', endo: 1, credits: 1 },
  ] as LogEvent[]);
  assert.equal(fusionKeepsIdle.phase, 'idle', 'a fusion at idle no longer stays idle, so the carry it needs is somewhere else now');
});

console.log('\nnothing to say');

ok('the reported screenshot: a save with no open on record has no edits and no plan, so it says nothing', () => {
  const s = fold(events(L.saved));
  assert.equal(s.phase, 'saved');
  assert.equal(s.seenWithoutOpen, true);
  assert.equal(s.edits.length, 0, 'a save fabricated an edit');
  assert.equal(hasSomethingToSay({ plan: null, session: s }), false);
});

ok('the tail joined late on a drawn screen: visible, flagged, nothing placed - it says nothing', () => {
  const s = fold(events(L.visible));
  assert.equal(s.phase, 'visible');
  assert.equal(s.seenWithoutOpen, true);
  assert.equal(s.edits.length, 0);
  assert.equal(hasSomethingToSay({ plan: null, session: s }), false);
});

ok('a clean open with the catalogue not in yet says nothing: opened and visible are both silent', () => {
  const opened = fold(events(L.pressSlot, L.goTo));
  const shown = fold(events(L.pressSlot, L.goTo, L.created, L.visible));
  assert.equal(opened.phase, 'opened');
  assert.equal(shown.phase, 'visible');
  assert.equal(hasSomethingToSay({ plan: null, session: opened }), false);
  assert.equal(hasSomethingToSay({ plan: null, session: shown }), false);
});

ok('the next open empties the trail, so the strip must come down between two visits', () => {
  const s = fold(events(L.pressSlot, L.goTo, L.place, L.closed, L.createdLater));
  assert.equal(s.phase, 'opened');
  assert.equal(s.edits.length, 0, 'the previous visit\'s edits leaked into the next');
  assert.equal(hasSomethingToSay({ plan: null, session: s }), false);
});

console.log('\nsomething to say');

ok('one placement is something to say, with no plan at all', () => {
  const s = fold(events(L.pressSlot, L.goTo, L.visible, L.place));
  assert.equal(s.phase, 'editing');
  assert.equal(s.edits.length, 1);
  assert.equal(hasSomethingToSay({ plan: null, session: s }), true);
});

ok('a plan alone is something to say, with no edits at all', () => {
  const s = fold(events(L.pressSlot, L.goTo, L.created, L.visible));
  assert.equal(s.edits.length, 0);
  assert.equal(hasSomethingToSay({ plan: A_PLAN, session: s }), true, 'the predicate stopped being an OR');
});

ok('a place then a lift still says something: two edits, a net of nothing, one row to show', () => {
  const s = fold(events(L.pressSlot, L.goTo, L.visible, L.place, L.lift));
  assert.equal(s.edits.length, 2, 'the trail is the raw stream, not the net');
  assert.equal(hasSomethingToSay({ plan: null, session: s }), true);
});

ok('a save that FOLLOWED an open keeps its edits, so a real save is never silenced', () => {
  const s = fold(events(L.pressSlot, L.goTo, L.visible, L.place, L.saved, L.slots, L.capacity, L.mods));
  assert.equal(s.phase, 'saved');
  assert.equal(s.edits.length, 1);
  assert.equal(hasSomethingToSay({ plan: null, session: s }), true);
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TRANSITION MATRIX
 *
 * Every phase the machine has, crossed with every arsenal line the parser
 * emits. Two things are measured per cell and both are load-bearing in
 * background.ts:
 *
 *   result.phase === 'idle'  → observeArsenal calls hideStrip()
 *   result === session       → observeArsenal returns EARLY, so armWatchdog()
 *                              is never reached and the 90 s deadline stands
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PHASES: Phase[] = ['idle', 'opened', 'visible', 'editing', 'saved'];

/** A session in each phase, reached by folding real lines rather than by hand-building one. */
const IN_PHASE: Record<Phase, Session> = {
  idle: IDLE,
  opened: fold(events(L.pressSlot, L.goTo)),
  visible: fold(events(L.pressSlot, L.goTo, L.created, L.visible)),
  editing: fold(events(L.pressSlot, L.goTo, L.visible, L.place)),
  saved: fold(events(L.pressSlot, L.goTo, L.visible, L.saved)),
};

/** One probe per distinct reducer behaviour. `screen` has three, so it gets three. */
const PROBES: ReadonlyArray<{ label: string; line: string }> = [
  { label: 'upgradeSlot', line: L.pressSlot },
  { label: 'screen open (a genuine second open)', line: L.createdLater },
  { label: 'screen open (the repeat line 20 ms later)', line: L.created },
  { label: 'screen close', line: L.closed },
  { label: 'hudVisible', line: L.visible },
  { label: 'modInstalled', line: L.place },
  { label: 'modOwned', line: L.owned },
  { label: 'fusionCost', line: L.fusion },
  { label: 'loadoutSaved', line: L.saved },
  { label: 'buildSlots', line: L.slots },
  { label: 'buildCapacity', line: L.capacity },
  { label: 'buildMods', line: L.mods },
  { label: 'buildDrain', line: L.drain },
  { label: 'a mission line (not the arsenal\'s)', line: L.mission },
];

console.log('\nthe matrix is built on the phases it claims');

ok('each base session really is in the phase the matrix files it under', () => {
  for (const p of PHASES) assert.equal(IN_PHASE[p]!.phase, p, `the ${p} base session folded to ${IN_PHASE[p]!.phase}`);
  assert.equal(PHASES.length, 5, 'a Phase was added or removed; the matrix below no longer covers the type');
  assert.equal(PROBES.length, 14);
});

const reachesIdle: string[] = [];
const silentFromVisible: string[] = [];
for (const from of PHASES) {
  for (const probe of PROBES) {
    const base = IN_PHASE[from]!;
    const next = step(base, one(probe.line), freshPending());
    if (from !== 'idle' && next.phase === 'idle') reachesIdle.push(`${from} + ${probe.label}`);
    if (from === 'visible' && next === base) silentFromVisible.push(probe.label);
  }
}

console.log('\nwhat can take the strip down by itself');

ok('EXACTLY one line reaches idle, from every phase: the UpgradeCards close', () => {
  assert.deepEqual(reachesIdle, [
    'opened + screen close',
    'visible + screen close',
    'editing + screen close',
    'saved + screen close',
  ]);
  assert.equal(reachesIdle.length, 4);
});

ok('THE WATCHDOG\'S REASON: nothing but a close moves `saved` off `saved` - 13 lines tried, 13 refused', () => {
  const base = IN_PHASE.saved!;
  const tried = PROBES.filter((p) => p.label !== 'screen close');
  assert.equal(tried.length, 13);
  const escaped = tried.filter((p) => step(base, one(p.line), freshPending()).phase === 'idle').map((p) => p.label);
  assert.deepEqual(escaped, [], 'a second route off `saved` appeared; the watchdog may no longer be the only way down');
  // Alt-tab, a crash, or an app started with the screen already open all deliver
  // no close line at all. In those the reducer NEVER leaves `saved`, so nothing
  // in the log takes the overlay off the screen and only a timer can.
  assert.equal(step(base, one(L.closed), freshPending()).phase, 'idle', 'the close no longer closes');
});

/*
 * WHY THE WATCHDOG IS FED BEFORE THE REDUCER, NOT AFTER.
 *
 * Six of the fourteen arsenal lines fold to the SAME session object, so a
 * controller that armed the watchdog only on a state change was fed solely by
 * lines the player has to cause - placing a mod, a fusion quote, a save. A
 * player who placed one mod and then read the recommendation for ninety
 * seconds lost the strip while the screen was still in front of them.
 *
 * These checks pin that reducer fact and then assert the placement in
 * background.ts that depends on it: proof of life is taken from the LINE, above
 * the identity early-return, because a line arriving at all is what proves the
 * screen is still being narrated - whatever the line happens to say.
 */
console.log('\nwhat proves the screen is still open');

ok('exactly 6 of 14 arsenal lines fold to the same session object, so a state change cannot be the keep-alive', () => {
  assert.deepEqual(silentFromVisible, [
    'upgradeSlot',
    'screen open (the repeat line 20 ms later)',
    'hudVisible',
    'modOwned',
    'buildDrain',
    'a mission line (not the arsenal\'s)',
  ]);
  assert.equal(silentFromVisible.length, 6);
  assert.equal(PROBES.length - silentFromVisible.length, 8);
});

ok('hudVisible proves the screen is drawn and changes no state, so the watchdog is fed above the identity check', () => {
  const base = IN_PHASE.visible!;
  assert.equal(step(base, one(L.visible), freshPending()), base, 'a repeat visibility line no longer folds; re-measure what feeds the watchdog');
  /*
   * The placement assertion, and the reason this check exists at all: the
   * verifier's sabotage pass showed the gate could not see a controller defect,
   * only a reducer one. armWatchdog() must sit ABOVE the identity early-return
   * inside observeArsenal, or hudVisible and the five other folding lines stop
   * counting as proof of life and the strip dies at 90 s under a player who is
   * still reading it.
   */
  const src = readFileSync(new URL('../src/app/background.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function observeArsenal('));
  /*
   * By the CALL, not by its arguments. `armWatchdog(false)` is the same feed -
   * the argument says whether this is a fresh arsenal line or a re-show
   * inheriting the deadline - and pinning the no-argument form made this fail
   * on a change that kept the ordering it exists to protect. The same lesson
   * the note below records about the early return.
   */
  const arm = body.indexOf('armWatchdog(');
  /*
   * Found by its CONDITION, not by the exact statement. The early return grew a
   * body - a lesson learned from `modOwned` changes no session object and still
   * has to reach the screen - and pinning the one-line form made this fail on a
   * change that kept the ordering it exists to protect.
   */
  const bail = body.indexOf('if (next === session)');
  assert.notEqual(arm, -1, 'observeArsenal no longer feeds the watchdog at all');
  assert.notEqual(bail, -1, 'the identity early-return moved; re-measure what feeds the watchdog');
  assert.ok(arm < bail, 'armWatchdog() fell below the identity early-return: the six folding lines stop proving the screen is open');
});

/*
 * THE REPORTED BUG, PINNED.
 *
 * A player photographed a strip stuck on screen reading ITEM UNKNOWN / SAVED,
 * running a page from an older build, with no key and no button able to reach
 * it. The cause was not the state machine: `stripShown` is a claim this page
 * makes about a window it does not own, and an Overwolf window outlives the
 * background page that opened it. A page that restarts comes up believing
 * nothing is shown, and every route out - the hotkey, the panic key, the
 * strip's own close button - ran through one guard that then declined to act.
 *
 * These two assertions are source-level because the controller cannot be
 * imported: it talks to Overwolf at module scope. They are the difference
 * between a fix and a comment claiming one.
 */
console.log('\nthe window outlives the page that opened it');

ok('hideStrip never declines on its own bookkeeping - the guard that made the reported strip unreachable', () => {
  const src = readFileSync(new URL('../src/app/background.ts', import.meta.url), 'utf8');
  const start = src.indexOf('function hideStrip(');
  assert.notEqual(start, -1, 'hideStrip is gone; the strip has no way down at all');
  const body = src.slice(start, src.indexOf('\n}', start));
  assert.ok(
    !/if \(!stripShown\) return;/.test(body),
    'hideStrip early-returns on !stripShown again: a window left up by a previous background page is unreachable forever',
  );
  assert.match(body, /hideWindow\(WINDOW\.automod\)/, 'hideStrip no longer hides the window');
});

ok('startup reconciles the strip against the real window state instead of trusting a fresh flag', () => {
  const src = readFileSync(new URL('../src/app/background.ts', import.meta.url), 'utf8');
  assert.match(
    src,
    /getWindowState\(WINDOW\.automod\)/,
    'nothing asks Overwolf whether the strip is already up, so a stale window from a previous page is never taken down',
  );
});

ok('only 7 of 14 lines change state at all - which is why a state change is the wrong keep-alive signal', () => {
  const base = IN_PHASE.visible!;
  const causedByThePlayer = ['modInstalled', 'fusionCost', 'loadoutSaved'];
  const dumpLines = ['buildSlots', 'buildCapacity', 'buildMods'];
  const rearming = PROBES.filter((p) => {
    const next = step(base, one(p.line), freshPending());
    return next !== base && next.phase !== 'idle';
  }).map((p) => p.label);
  assert.deepEqual(rearming, ['screen open (a genuine second open)', ...causedByThePlayer, ...dumpLines]);
  assert.equal(rearming.length, 7);
});


/*
 * -----------------------------------------------------------------------------
 * THE OVERLAY HAS TO APPEAR WHEN THE ANSWER DOES.
 *
 * The reported symptom was "the modding overlay took forever to appear", and
 * the cause was not a slow computation. There were four callers of `showStrip`
 * - the catalogue load, an arsenal SESSION-STATE change, and the two hotkeys -
 * and not one of them was on the path where the plan actually becomes
 * available.
 *
 * The ordinary open goes: the log names the slot; the app asks GEP for the
 * account and refuses to name the item until it answers; `showStrip` fires on
 * the HudVis line about half a second later, finds no plan and correctly
 * declines. Then GEP answers and the plan appears - and the two handlers that
 * learn about it each published the new state to a window nobody had put on the
 * screen. Every arsenal line after that folds to the same session object and
 * returns early, so nothing asked again. The overlay appeared when the player
 * next PLACED A MOD, which is an unbounded wait.
 *
 * Every other cost on that path is bounded and sums to under two seconds. This
 * one had no bound at all, and no gate: this file asserted the generation
 * checks and the `!area` refusal, and never once asserted that a plan arriving
 * produces a show.
 * -----------------------------------------------------------------------------
 */

/**
 * The body of a named handler or function in a source file, by brace matching.
 *
 * FINDING THE BODY'S OWN BRACE IS THE WHOLE DIFFICULTY, and three shapes have
 * to work:
 *
 *   function placeWindow(name: WindowName, box: { left: number, ... }): P {
 *   async function idFor(name: WindowName): Promise<string> {
 *   gep.on('answered', (at) => {
 *
 * Taking the first `{` after the signature grabs a parameter TYPE in the first.
 * Counting parens works for the first two and breaks on the third, whose
 * parameter list closes while the enclosing CALL's parens are still open.
 * Preferring an arrow token breaks on the second, because the next `=> {`
 * anywhere below it is closer than the parameter list's closing paren is to
 * anything - which is exactly what happened: this read the body of the wrong
 * function and reported a cache that is there as missing.
 *
 * So both candidates are computed and the EARLIER one wins. A declaration's
 * body brace always precedes any arrow below it; an arrow's own brace always
 * precedes the enclosing call's closing paren. Anything that yields neither
 * throws rather than guessing, because a gate that silently reads the wrong
 * block is worth less than no gate.
 */
function bodyOf(src: string, opener: string): string {
  const at = src.indexOf(opener);
  assert.ok(at >= 0, `the source no longer contains ${opener}`);

  let byParen = -1;
  let depth = 0;
  for (let p = src.indexOf('(', at); p >= 0 && p < src.length; p++) {
    if (src[p] === '(') depth++;
    else if (src[p] === ')') {
      depth--;
      if (depth === 0) {
        byParen = src.indexOf('{', p);
        break;
      }
    }
  }
  const arrow = src.indexOf('=> {', at);
  const byArrow = arrow < 0 ? -1 : arrow + 3;

  const i = byParen < 0 ? byArrow : byArrow < 0 ? byParen : Math.min(byParen, byArrow);
  assert.ok(i >= 0, `no block after ${opener}`);
  assert.equal(src[i], '{', `the body of ${opener} could not be located`);

  let d = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') {
      d--;
      if (d === 0) return src.slice(i, j + 1);
    }
  }
  throw new Error(`unbalanced braces after ${opener}`);
}

const BG = readFileSync(new URL('../src/app/background.ts', import.meta.url), 'utf8');
const OW = readFileSync(new URL('../src/core/ow.ts', import.meta.url), 'utf8');

ok('publishing and showing are ONE call, so one cannot exist without the other', () => {
  const body = bodyOf(BG, 'function publishAndShow()');
  assert.match(body, /publishAutomod\(\)/, 'publishAndShow does not publish');
  assert.match(body, /showStrip\(\)/, 'publishAndShow does not show - then the name is a lie and the bug is back');
  /*
   * And it keeps the guard the arsenal path uses. 'opened' is the slot press
   * with nothing read yet: the strip has no answer for it, and showing on it
   * would put an empty overlay on screen for the half second before the account
   * lands - the opposite failure, and just as visible.
   */
  assert.match(body, /phase !== 'idle'/, 'publishAndShow shows on an idle session');
  assert.match(body, /phase !== 'opened'/, 'publishAndShow shows on a bare open, before anything is readable');

  /*
   * AND THE SHOW HAS TO BE REACHABLE, which asserting that the call EXISTS does
   * not establish. Found while sabotaging this gate: putting `return;` between
   * the publish and the show left every assertion above green, because a text
   * gate reads names and not control flow. A source-text check cannot prove
   * reachability in general - what it can do is refuse the one shape that
   * breaks it here, which is an early exit on the only path to the show.
   */
  const showAt = body.indexOf('showStrip(');
  assert.ok(showAt > 0, 'publishAndShow does not call showStrip at all');
  const beforeShow = body.slice(0, showAt).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*/g, ' ');
  assert.ok(
    !/(^|[^.\w])return\b/.test(beforeShow),
    'publishAndShow can return before it shows, so the publish happens and the window does not',
  );
});

ok('BOTH paths that can produce a plan show it: GEP answering, and the settle deadline', () => {
  /*
   * These are the only two moments a plan first exists on an ordinary open, and
   * they are asserted separately because they FAIL separately: GEP answering is
   * the common case and the settle deadline is the fallback for a read that
   * never lands. Fixing one and not the other leaves half the visits hanging -
   * exactly what one loose regex over the whole file would miss.
   */
  const answered = bodyOf(BG, "gep.on('answered'");
  assert.match(answered, /publishAndShow\(\)/, 'GEP answering publishes to a window nobody has shown');
  assert.doesNotMatch(
    answered.replace(/publishAndShow\(\)/g, ''),
    /publishAutomod\(\)/,
    'the answered path still has a publish that does not show',
  );

  const from = BG.indexOf('settleTimer = setTimeout(');
  assert.ok(from >= 0, 'the settle deadline is gone');
  const settle = BG.slice(from, BG.indexOf('SETTLE_WAIT_MS + 50', from));
  assert.match(settle, /publishAndShow\(\)/, 'the settle deadline publishes to a window nobody has shown');
});

ok('the panic key gives back the overlay it took, and only while the log still narrates the screen', () => {
  const key = bodyOf(BG, 'onHotkeyPressed(TOGGLE_HOTKEY');
  /*
   * THE REPORTED BUG: pressed Ctrl+K, it disappeared, it did not come back.
   * The key opens the companion panel and hid the strip so the two would not
   * overlap, on the argument that a LIVE overlay "comes straight back on the
   * next arsenal line". The log narrates what the PLAYER does - opening a slot,
   * moving a mod, saving - so a player who opens the panel and closes it again
   * without touching the grid emits nothing at all, and nothing ever called
   * `showStrip`. Pressing the key a second time could not fix it either: by
   * then `stripShown` was false and the hide was a no-op.
   */
  assert.match(key, /hideStrip\(\)/, 'the key no longer takes the overlay down for the panel it opens');
  assert.match(key, /showStrip\(\)/, 'the key takes the overlay away and never gives it back');
  assert.match(key, /stripIsLive\(\)/, 'the key brings a STUCK strip back too, which re-opens the bug the panic key exists for');
  assert.match(key, /=== 'hidden'/, 'the re-show is not conditioned on the panel having CLOSED, so it fights the hide on the same press');
});

ok('the liveness stamp survives the strip being hidden - or it can never be brought back', () => {
  const observe = bodyOf(BG, 'function observeArsenal(');
  /*
   * The stamp and the timer are deliberately different. A strip that is DOWN
   * for a reason of its own - the companion panel is up over it - still has a
   * screen behind it that the log is narrating, and something has to remember
   * that. Put the stamp back behind `if (stripShown)` and the panic key's
   * re-show works for ninety seconds after the last line the strip was up for,
   * and then silently stops.
   */
  const stamp = observe.indexOf('stripLiveAt = Date.now()');
  assert.ok(stamp >= 0, 'nothing records that the log is still narrating the screen');
  const guard = observe.lastIndexOf('if (stripShown)', stamp);
  assert.ok(
    guard < 0 || observe.slice(guard, stamp).includes('\n'),
    'the liveness stamp is inside `if (stripShown)`, so a hidden strip stops being live and can never come back',
  );

  const arm = bodyOf(BG, 'function armWatchdog(');
  assert.match(
    arm,
    /STRIP_SILENCE_MS - \(Date\.now\(\) - stripLiveAt\)/,
    'a re-show restarts the full silence deadline, handing a screen the player left ninety more seconds of overlay',
  );
});

ok('the ladder stands aside while the overlay is coming up', () => {
  /*
   * Both live on this page. The ladder works in slices between timeouts, and
   * `showStrip`'s Overwolf calls come back as tasks too - so every round trip
   * it makes queues BEHIND whatever slice is running, and the ladder is at its
   * busiest exactly when the overlay is trying to appear, because one publish
   * starts both. Measured, a slice runs about 63 ms and the show needs two
   * round trips.
   */
  const start = bodyOf(BG, 'function startLadder(');
  assert.match(start, /showInFlight\(\)/, 'the ladder no longer yields to the show, so its slices queue in front of the window');
  const at = BG.indexOf('const showInFlight');
  assert.ok(at >= 0, 'there is no in-flight test at all');
  assert.match(
    BG.slice(at, at + 240),
    /SHOW_GRACE_MS/,
    'the in-flight test is unbounded, so an Overwolf call that never calls back stops the ladder for the rest of the session',
  );
});

ok('putting the overlay up costs TWO awaited Overwolf round trips, not five', () => {
  /*
   * `obtainDeclaredWindow` answers the same thing every time - a declared
   * window's id does not change while the app runs - and it was called twice in
   * the awaited path, once inside `placeWindow` and once inside `restoreWindow`.
   * `changeSize` and `changePosition` are independent of each other and were
   * awaited in series. Five round trips between the log line and a visible
   * overlay, three of them avoidable.
   */
  assert.match(OW, /const windowIds = new Map<WindowName, string>\(\)/, 'the window id is not cached, so the same question is asked twice per show');
  /*
   * The MAP EXISTING is not the saving; reading it is. Found while sabotaging
   * this gate: a declaration nothing consults passed every assertion here while
   * both round trips came back. So `idFor` - the only reader - has to be seen
   * consulting it before asking Overwolf.
   */
  const idFor = bodyOf(OW, 'async function idFor(');
  assert.match(idFor, /windowIds\.get\(name\)/, 'the id helper never reads the cache, so every call is still a round trip');
  assert.ok(
    idFor.indexOf('windowIds.get(name)') < idFor.indexOf('obtainWindow('),
    'the id helper asks Overwolf before consulting the cache, which is the same cost it was meant to remove',
  );
  const place = bodyOf(OW, 'export async function placeWindow(');
  assert.match(place, /await Promise\.all\(\[/, 'the size and the position are awaited one after the other again');
  assert.doesNotMatch(place, /await obtainWindow\(/, 'placeWindow is back to a full obtainDeclaredWindow round trip');
  const restore = bodyOf(OW, 'export async function restoreWindow(');
  assert.doesNotMatch(restore, /await obtainWindow\(/, 'restoreWindow is back to a full obtainDeclaredWindow round trip');

  /*
   * The cache holds the ID and must NOT hold `stateEx`: `toggleWindow` reads
   * that to decide which way to toggle, and a cached state is a stale one the
   * moment anything else moves the window - which would make the companion
   * panel toggle the wrong way after any hide the app did itself.
   */
  const toggle = bodyOf(OW, 'export async function toggleWindow(');
  assert.match(toggle, /await obtainWindow\(name\)/, 'toggleWindow reads a cached window state, which goes stale the moment anything else moves the window');
});


ok('the sliced plan actually slices, and stands aside for the window', () => {
  const src = readFileSync(new URL('../src/app/background.ts', import.meta.url), 'utf8');
  const body = bodyOf(src, 'function startPlan(');

  /*
   * ONE SEARCH PER SLICE, and the failure this forbids is the easiest one to
   * write by accident: a `while (!step.done) step = steps.next()` inside the
   * pump drains the generator in a single turn, which is the 1.2-second freeze
   * back again with a generator in front of it. Every assertion about the cache
   * still passes in that state - the plan is computed, cached and published -
   * so nothing else here would notice.
   */
  assert.match(body, /steps\.next\(\)/, 'the pump no longer advances the plan at all');
  assert.doesNotMatch(
    body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*/g, ' '),
    /while\s*\([^)]*done/,
    'the pump drains the generator in one turn, which is the whole freeze back with a generator in front of it',
  );
  assert.match(body, /setTimeout\(pump, 0\)/, 'the pump never reschedules itself, so the plan stops after one search');

  /*
   * AND IT YIELDS TO THE WINDOW. Both long jobs on this page - the plan and the
   * ladder - have to stand aside while `showStrip` is making its Overwolf round
   * trips, or a slice lands in front of the thing the player is waiting for.
   */
  /*
   * THE GUARD, NOT THE NAME. The first version matched `/showInFlight\(\)/`,
   * which a call whose `return` had been deleted still satisfies - sabotaged
   * exactly that way, this assertion passed and the sweep only went red because
   * an unrelated gate counted differently. What must hold is that the call
   * GATES the slice: tested, and returning without advancing when it is true.
   */
  const guard = /if \(showInFlight\(\)\) \{[^}]*return;[^}]*\}/.exec(body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*/g, ' '));
  assert.ok(
    guard,
    'the plan pump calls showInFlight but does not return on it, so a search still runs in front of the window coming up',
  );
});

ok('memoLast answers only for the key it holds, and can be filled from outside', () => {
  /*
   * `peek` and `set` were added so the controller could drive the plan in
   * slices: a sliced producer cannot RETURN a value, so the caller asks whether
   * the answer is ready and the pump puts it in when it lands. Neither had a
   * check, and `peek` returning the last value REGARDLESS of the key is both
   * the easiest mistake to make and the worst one - it would serve one weapon's
   * plan under another weapon's name, which is precisely the failure
   * `openPolicy` exists to prevent at the other end of the app.
   */
  const m = memoLast<string>();
  const a = ['item-a', 1];
  const b = ['item-b', 1];

  assert.equal(m.peek(a), undefined, 'an empty memo answered for a key it has never seen');

  m.set(a, 'plan-a');
  assert.equal(m.peek(a), 'plan-a', 'set did not fill the memo');
  assert.equal(m.peek(b), undefined, 'peek answered for a DIFFERENT key - one weapon\u2019s plan under another weapon\u2019s name');

  // One slot: a second key replaces the first rather than joining it.
  m.set(b, 'plan-b');
  assert.equal(m.peek(b), 'plan-b');
  assert.equal(m.peek(a), undefined, 'the memo is holding two entries, and it is documented as holding exactly one');

  /*
   * Neither counts as a hit or a miss. Those two numbers are how "is it
   * memoised" is measured rather than assumed, and a peek that scored would
   * count the same computation twice - once when it is asked for and once when
   * it is seeded.
   */
  assert.equal(m.hits, 0, 'peek is counted as a cache hit, which double-counts every sliced computation');
  assert.equal(m.misses, 0, 'set or peek is counted as a miss, so the memo reports work it never did');

  // And `get` still behaves: a hit after a set, without recomputing.
  let produced = 0;
  const got = m.get(b, () => {
    produced++;
    return 'recomputed';
  });
  assert.equal(got, 'plan-b', 'get ignored a value that set had already put in');
  assert.equal(produced, 0, 'get recomputed a value the memo was already holding');
});

console.log(`\n${checks} checks, ${failures} failures\n`);
process.exit(failures === 0 ? 0 : 1);
