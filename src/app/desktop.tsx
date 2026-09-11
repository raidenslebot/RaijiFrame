import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './Shell';
import { mirrorBackgroundStore } from './mirror';
import { WINDOW } from '../core/ow';
import { useAccount } from '../core/store';
import '../styles/theme.css';
import '../styles/motion.css';
// Wave 1 of UI-SPEC: the stroke-bearing frame. Nothing wears it yet; loading it
// here is what lets Wave 2 adopt it panel by panel without a second entry.
import '../styles/primitives.css';
import '../panels/panels';

mirrorBackgroundStore();

/*
 * A DEV-ONLY HANDLE ONTO THE ACCOUNT STORE, AND WHY ITS ABSENCE WAS EXPENSIVE.
 *
 * Every panel in this app has two shapes: the one with an account read and the
 * one without. The second is what a launch before the game has ever run looks
 * like, and the first is what the owner actually uses - and there was no way to
 * reach the first in a browser at all. So every measurement, every screenshot
 * and every design judgement made outside Overwolf has been about the EMPTY
 * shape, and the one that matters has never been looked at.
 *
 * `public/__review-acct.json` is a real anonymised capture - MR16, 312
 * platinum, 6 trades left, 62 frames, 118 melee, 185 missions, 8 syndicates -
 * already used by `scripts/check-build.ts`. This is the two lines that let a
 * browser feed it in:
 *
 *     await __rf.account(await (await fetch('/__review-acct.json')).json())
 *
 * `import.meta.env.DEV` is statically false in the Overwolf build, so Rollup
 * removes the whole block: nothing here reaches a packaged app, and the handle
 * cannot become a way for anything to write a fabricated account into the
 * shipped product.
 */
if (import.meta.env.DEV) {
  (window as unknown as { __rf: Record<string, unknown> }).__rf = {
    store: useAccount,
    account: (raw: unknown) => useAccount.getState().setInventory(raw as never),
    clear: () => {
      useAccount.setState({ inventory: null, inventoryAt: null, capturedAt: null });
    },
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell windowName={WINDOW.desktop} />
  </StrictMode>,
);
