/*
 * EVERY STATE THE PANEL CAN BE IN, ENUMERATED - AND VERSION CONTROLLED.
 * ---------------------------------------------------------------------------
 * This lived inside `composite.html`, which is GITIGNORED. The artboard is
 * scratch by design; this is not. It is the instrument that measures the claim
 * "all possible ui states", it has found five defects the hand-written sweep of
 * 34 could not - a crushed aura line, a footer counting caveats nobody could
 * read, two overflows after the type grew, and a route wrapping to a second
 * line - and losing the artboard would have taken it with it.
 *
 * A plain browser script, loaded before the artboard's module. The fixtures are
 * the artboard's own (the app's captured output, pasted there), so they are
 * handed in rather than imported:
 *
 *   <script src="/scripts/panel-states.js"></script>
 *   ...
 *   window.__installPanelStates({ IDEAL, DEMO, FRAME_LADDER });
 *
 * It needs an iframe with id `strip` running `automod.html`, and the `stage`
 * element the artboard sizes. Then:
 *
 *   window.__exhaust({ from, to })   the cross product at the current size
 *   window.__exhaustAll()            the whole thing at five resolutions
 *
 * Progress lands in `window.__exN` and `window.__exAll` as it runs, because a
 * run takes minutes and one nobody can watch is one nobody finishes.
 */
window.__installPanelStates = ({ IDEAL, DEMO, FRAME_LADDER }) => {
      /*
       * EVERY STATE THE ASIDE CAN BE IN, ENUMERATED RATHER THAN CHOSEN.
       *
       * `__sweep` is a hand-written list. It is worth having - each entry is a
       * state somebody decided was worth looking AT - but a list cannot promise
       * coverage, and "all possible ui states" is the brief. Thirty-four chosen
       * states passed while the strip was crushing its own rows at four of five
       * resolutions, and again while a learned row was titled "another slot".
       *
       * So the axes below are read off `Aside`'s own conditionals, one axis per
       * branch that decides whether a row renders at all, and the cross product
       * is enumerated. Every state is measured the way the sweep measures its
       * own - what the column needs against what it has, and any child whose
       * content is taller than the box it was given - and every state's text is
       * scanned for the four ways a broken value reaches the screen.
       *
       * THE AXES, and the line each one comes from:
       *   destination   `atCeiling` / `reachedIdeal` - three outcomes, and the
       *                 two ceiling ones hide the whole middle of the panel
       *   figureNote    `plan.now.score.figureNote !== null` - the quiet mark
       *   forma         `plan.forma.count > 0`
       *   aura          `plan.ideal.aura`
       *   assumed       `planAssumed.length > 0`, and the fold at three
       *   unscored      `plan.now.unscored > 0`
       *   purse         `Price` - endo and credits, or neither
       *   ladder        `WhatNext` - the seven shapes its four rung kinds and
       *                 three end states can take, including none at all
       *   ideal         `ideal.length` - eight slots, or a plan with no build
       *   title         a name, a very long name, or a learned category
       *
       * The no-plan branch is enumerated the same way from `NoPlan`: every
       * resolution rung the app can stop at, with and without an unread row,
       * with and without an edit trail, in each phase it can be seen in.
       */
      window.__exhaust = async (opts = {}) => {
        const frame = document.getElementById('strip');
        const f = frame.contentWindow.automodFeed;
        const doc = frame.contentDocument;

        const part = (v, u, placed, aura, note) => ({
          question: 'Q2',
          placed,
          aura: aura ?? null,
          capacity: 80,
          drain: 74,
          fits: true,
          score: { value: v, verdict: 'approx', figureNote: note ?? null },
          unscored: u,
          assumptions: [],
        });
        const CEILING = 8033;
        const AURA = { path: '/M/Physique', name: 'Physique', rank: 5, maxRank: 5, polarity: 'vazarin', slotPolarity: 'none', drain: -7, rarity: 'Uncommon', ownedRank: 5 };
        /* The app's own assumption strings, at their real length. */
        const SAYS = [
          'catalyst unknown: capacity computed without one',
          'the mod grid is planned as 8 slots for every moddable thing: no source this app has states the true count - the catalogue carries none, and the account normalises its slot array to eleven entries for every item alike - so a companion, an archwing or a Necramech that holds more is planned for 8 of them',
          'polarity assignment is greedy (largest drain to the matching slot first), not an exact matching',
          'melee damage per second is HALF the figure the game prints, uniformly and for reasons unknown',
        ];
        const UNLOCK = { step: 1, kind: 'unlock', planet: 'Ceres', nodes: 3, node: 'SolNode31', nodeName: 'Draco', value: 3979, gain: 0 };
        const GROUNDWORK = { step: 1, kind: 'forma', polarity: 'madurai', value: 4151.23, gain: 0, groundwork: true };

        const AXES = {
          destination: [
            ['climbing', (s) => s],
            ['at the ceiling', (s) => ({ ...s, plan: { ...s.plan, next: [], now: { ...s.plan.now, score: { ...s.plan.now.score, value: CEILING } } }, ladder: [], ladderEnd: 'complete' })],
            ['ceiling, over-ranked', (s) => ({ ...s, plan: { ...s.plan, next: [] }, ladder: [], ladderEnd: 'complete' })],
          ],
          figure: [
            ['plain', (s) => s],
            ['questioned', (s) => ({ ...s, plan: { ...s.plan, now: { ...s.plan.now, score: { ...s.plan.now.score, figureNote: 'one captured build disagreed with the game by a factor of two' } } } })],
          ],
          forma: [
            ['no forma', (s) => ({ ...s, plan: { ...s.plan, forma: { count: 0, to: [], alreadyMatched: 8, spare: 0 } } })],
            ['two forma', (s) => s],
          ],
          aura: [
            ['no aura', (s) => s],
            ['an aura', (s) => ({ ...s, plan: { ...s.plan, ideal: { ...s.plan.ideal, aura: AURA } } })],
          ],
          assumed: [
            ['nothing assumed', (s) => ({ ...s, planAssumed: [] })],
            ['one assumed', (s) => ({ ...s, planAssumed: SAYS.slice(0, 1) })],
            ['four assumed', (s) => ({ ...s, planAssumed: SAYS })],
          ],
          unscored: [
            ['all scored', (s) => ({ ...s, plan: { ...s.plan, now: { ...s.plan.now, unscored: 0 } } })],
            ['two unscored', (s) => s],
          ],
          purse: [
            ['purse known', (s) => s],
            ['purse unknown', (s) => ({ ...s, purse: { endo: null, credits: null } })],
          ],
          ladder: [
            ['no rung yet', (s) => ({ ...s, ladder: [], ladderEnd: 'complete' })],
            ['one mod, finished', (s) => ({ ...s, ladder: FRAME_LADDER.slice(0, 1), ladderEnd: 'complete' })],
            ['two, still working', (s) => ({ ...s, ladder: FRAME_LADDER.slice(0, 2), ladderEnd: 'working' })],
            ['the whole staircase, cut at the horizon', (s) => ({ ...s, ladder: FRAME_LADDER, ladderEnd: 'horizon' })],
            ['an aura next', (s) => ({ ...s, ladder: FRAME_LADDER.slice(2), ladderEnd: 'complete' })],
            ['a forma next', (s) => ({ ...s, ladder: FRAME_LADDER.slice(5), ladderEnd: 'complete' })],
            ['groundwork forma next', (s) => ({ ...s, ladder: [GROUNDWORK], ladderEnd: 'complete' })],
            ['a star-chart node next', (s) => ({ ...s, ladder: [UNLOCK], ladderEnd: 'complete' })],
          ],
          ideal: [
            ['eight slots', (s) => s],
            ['no ideal build at all', (s) => ({ ...s, plan: { ...s.plan, ideal: { ...s.plan.ideal, placed: [] } } })],
          ],
          title: [
            ['named', (s) => s],
            ['a very long name', (s) => ({ ...s, build: { ...s.build, name: 'Kuva Kohmak Incarnon Genesis' } })],
            ['a learned row, unnamed', (s) => ({ ...s, build: { name: null, unknown: null, category: 'companion-weapon' }, session: { ...s.session, slot: null, unreadSlot: 6 } })],
          ],
        };

        const base = () => ({
          session: { phase: 'visible', openedAt: 0, slot: 3, unreadSlot: null, edits: [], dump: null, fusions: [], seenWithoutOpen: false },
          build: { name: 'Broken War', unknown: null, category: 'melee' },
          plan: {
            now: part(5960, 2, IDEAL),
            ideal: part(CEILING, 0, IDEAL),
            ceiling: part(CEILING, 0, IDEAL),
            next: DEMO.owned,
            forma: { count: 2, to: [{ polarity: 'madurai', count: 2 }], alreadyMatched: 5, spare: 1 },
            candidates: { eligible: 404, scored: 402, owned: 138 },
          },
          planAssumed: SAYS.slice(0, 1),
          purse: { endo: 4_200, credits: 1_893_292 },
          ladder: [],
          ladderEnd: 'working',
        });

        /*
         * THE CEILING BRANCHES DROP FOUR AXES, because the rows those axes
         * decide are not rendered at all when the panel says "at the ceiling" -
         * enumerating them there would be 1,344 states that differ in nothing.
         */
        const HIDDEN_AT_CEILING = ['forma', 'aura', 'purse', 'ladder'];
        const names = Object.keys(AXES);
        const combos = [];
        for (const [dLabel, dApply] of AXES.destination) {
          const used = names.filter((n) => n !== 'destination' && !(dLabel !== 'climbing' && HIDDEN_AT_CEILING.includes(n)));
          const walk = (i, chosen) => {
            if (i === used.length) {
              combos.push([[['destination', dLabel]].concat(chosen), [dApply].concat(chosen.map(([n, l]) => AXES[n].find((x) => x[0] === l)[1]))]);
              return;
            }
            for (const [label] of AXES[used[i]]) walk(i + 1, chosen.concat([[used[i], label]]));
          };
          walk(0, []);
        }

        /*
         * THE OTHER BRANCH. `NoPlan` renders whenever there is no plan, which
         * is every state before the catalogue is in, every resolution failure,
         * and every screen the app cannot read - and it is the branch the
         * player sees when something has gone wrong, so it is the one that must
         * not be a blank panel.
         */
        const RUNGS = [null, 'account', 'loadout-ids', 'presets', 'selection', 'instance', 'config', 'upgrades'];
        const EDITS = [
          [],
          [{ at: 1, itemType: '/M/PressurePoint', name: 'Pressure Point', installed: true, slot: 0 }],
          [
            { at: 1, itemType: '/M/PressurePoint', name: 'Pressure Point', installed: true, slot: 0 },
            { at: 2, itemType: '/M/Reach', name: 'Reach', installed: false, slot: 3 },
            { at: 3, itemType: '/M/Reach', name: 'Reach', installed: true, slot: 3 },
          ],
        ];
        const noPlan = [];
        for (const rung of RUNGS) {
          for (const unread of [null, 6]) {
            for (let e = 0; e < EDITS.length; e++) {
              for (const phase of ['opened', 'visible', 'editing', 'saved']) {
                for (const live of [true, false]) {
                  noPlan.push([
                    [['branch', 'no plan'], ['stopped at', String(rung)], ['unread row', String(unread)], ['edits', String(EDITS[e].length)], ['phase', phase], ['live', String(live)]],
                    [(s) => ({
                      ...s,
                      plan: null,
                      ladder: [],
                      ladderEnd: 'complete',
                      build: rung === null ? null : { name: null, unknown: rung, category: 'melee' },
                      live,
                      session: { ...s.session, phase, unreadSlot: unread, slot: unread === null ? 3 : null, edits: EDITS[e] },
                    })],
                  ]);
                }
              }
            }
          }
        }

        const all = combos.concat(noPlan).slice(opts.from ?? 0, opts.to ?? undefined);
        if (opts.count) return combos.length + noPlan.length;

        /*
         * THE SECOND VIEW. The panel has two: the one instruction, and the whole
         * build behind the header's toggle. "All possible ui states" stopped
         * being true the moment the second one existed, so the enumeration takes
         * a `view` and runs the same cross product in it.
         *
         * The toggle is a real button in the strip - the overlay takes no input
         * anywhere else - so this clicks it exactly as a player would, once,
         * before the pass, and reads the header back to be sure it took.
         */
        const wantBuild = opts.view === 'build';
        const viewNow = () => (doc.querySelector('.am-view')?.textContent === 'next' ? 'build' : 'instruction');
        if (wantBuild) {
          f.set(base());
          await new Promise((res) => requestAnimationFrame(() => { requestAnimationFrame(res); }));
          const toggle = doc.querySelector('.am-view');
          if (!toggle) return { states: 0, failures: 1, bad: [{ state: 'the build view', dishonest: 'the header carries no view toggle, so the second view cannot be reached at all' }], tallest: [] };
          if (viewNow() !== 'build') toggle.click();
          await new Promise((res) => requestAnimationFrame(() => { requestAnimationFrame(res); }));
          if (viewNow() !== 'build') return { states: 0, failures: 1, bad: [{ state: 'the build view', dishonest: 'the toggle did not switch the view' }], tallest: [] };
        }

        /* The four ways a broken value reaches the screen. */
        const BROKEN = /NaN|undefined|Infinity|\[object|\bnull\b/;
        const bad = [];
        const heights = [];
        let n = 0;
        for (const [vector, applies] of all) {
          let s = base();
          for (const apply of applies) s = apply(s);
          f.set(s);
          await new Promise((res) => requestAnimationFrame(() => { requestAnimationFrame(res); }));
          n += 1;
          window.__exN = (opts.from ?? 0) + n;
          const box = doc.querySelector('.am-aside');
          const top = box.getBoundingClientRect().top;
          let need = 0;
          const crushed = [];
          for (const el of box.children) {
            const cs = frame.contentWindow.getComputedStyle(el);
            const r = el.getBoundingClientRect();
            need += Math.max(el.scrollHeight, r.height) + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
            /*
             * THE ASSUMPTION LIST IS THE ONE THING ALLOWED TO CLIP, and it was
             * the first thing this instrument reported: 384 states with
             * `am-assumed` taller than its box. That is not a defect - it is
             * `flex: 0 1 auto; overflow: hidden` doing exactly what it was
             * written to do, because a four-line caveat cannot share a 263 px
             * column with the plan and the staircase.
             *
             * What MUST hold is the honesty marker, so that is what is checked
             * instead of the pixel: whenever the list is clipped the footer has
             * to say "n of m assumed", and n has to be the number of lines a
             * player can actually read. A panel that hides two caveats and
             * reports "4 assumed" is the failure this replaces.
             */
            if (el.classList.contains('am-assumed') || el.classList.contains('am-build')) continue;
            if (el.scrollHeight > Math.ceil(r.height) + 1) crushed.push(el.className);
          }
          const last = box.lastElementChild;
          const height = last ? Math.ceil(last.getBoundingClientRect().bottom - top) : 0;
          const text = box.innerText.replace(/\s+/g, ' ').trim();
          const label = vector.map(([, v]) => v).join(' · ');
          heights.push([height, label]);
          const over = height > box.getBoundingClientRect().height + 1;
          const broken = BROKEN.exec(text);
          let dishonest = null;
          /*
           * THE BUILD LIST MAKES THE SAME PROMISE THE CAVEAT LIST DOES: it clips,
           * so it has to say how many slots the player can actually read. A build
           * list that quietly drops slots 7 and 8 is a lie about the build.
           */
          const build = box.querySelector('.am-build');
          if (build) {
            const bottom = build.getBoundingClientRect().bottom + 0.5;
            let shown = 0;
            for (const li of build.children) if (li.getBoundingClientRect().bottom <= bottom) shown += 1;
            const total = build.children.length;
            if (shown < total && !text.includes(shown + ' of ' + total + ' shown')) {
              dishonest = 'the build list shows ' + String(shown) + ' of ' + String(total) + ' slots and does not say so';
            }
          }
          const list = box.querySelector('.am-assumed');
          if (list) {
            const bottom = list.getBoundingClientRect().bottom + 0.5;
            let shown = 0;
            for (const li of list.children) if (li.getBoundingClientRect().bottom <= bottom) shown += 1;
            const total = list.children.length;
            const said = shown < total ? shown + ' of ' + total + ' assumed' : total + ' assumed';
            if (!text.includes(said)) dishonest = 'the footer does not say "' + said + '"';
          }
          if (crushed.length || over || broken || dishonest) {
            bad.push({ state: label, height, crushed, over, broken: broken ? broken[0] : null, dishonest, text: text.slice(0, 240) });
          }
        }
        heights.sort((a, b) => b[0] - a[0]);
        return { states: n, failures: bad.length, bad: bad.slice(0, 12), tallest: heights.slice(0, 5) };
      };

      /*
       * THE WHOLE CROSS PRODUCT AT EVERY PANEL SIZE.
       *
       * The column's height is what the states are measured against, and it is
       * the one thing that changes with the screen: 263 px at the design size,
       * less on a laptop. So a state that fits here is not a state that fits,
       * and the enumeration has to be run at each of the five sizes the sweep
       * already uses - the design capture, a 1440p panel, and the three
       * commonest laptop ones.
       *
       * It reports into `window.__exAll` as it goes, because it takes minutes
       * and a run nobody can watch is a run nobody will finish.
       */
      window.__exhaustAll = async () => {
        const st = document.getElementById('stage');
        const frame = document.getElementById('strip');
        const sizes = [[1680, 1050], [2560, 1440], [1440, 900], [1366, 768], [1280, 720]];
        const out = [];
        window.__exAll = { done: false, sizes: out };
        for (const [w, h] of sizes) {
          st.style.width = `${w}px`;
          st.style.height = `${h}px`;
          frame.style.width = `${w}px`;
          frame.style.height = `${h}px`;
          frame.contentWindow.dispatchEvent(new Event('resize'));
          await new Promise((r) => setTimeout(r, 250));
          for (const view of ['instruction', 'build']) {
            window.__exAll.at = `${w}x${h} ${view}`;
            const r = await window.__exhaust({ view });
            out.push({ size: `${w}x${h}`, view, states: r.states, failures: r.failures, bad: r.bad.slice(0, 6), tallest: r.tallest[0] });
          }
        }
        st.style.width = '1680px';
        st.style.height = '1050px';
        frame.style.width = '1680px';
        frame.style.height = '1050px';
        frame.contentWindow.dispatchEvent(new Event('resize'));
        window.__exAll = { done: true, sizes: out };
        return out;
      };
};
