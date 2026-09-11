/**
 * Motion, loaded lazily.
 *
 * Importing `motion/react` directly pulls the whole animation engine into the
 * first chunk. This overlay paints on top of a running game, so the entry bundle
 * is worth keeping small: `LazyMotion` ships a tiny proxy up front and fetches
 * the feature bundle as a separate chunk once React has mounted.
 *
 * `domMax` rather than `domAnimation` because the tab rail uses shared-layout
 * animation (`layoutId`), which only the max feature set provides.
 *
 * Components import `m` from here instead of `motion` from the library.
 */

import type { ReactNode } from 'react';
import { LazyMotion } from 'motion/react';

export { m, AnimatePresence } from 'motion/react';

const features = () => import('motion/react').then((mod) => mod.domMax);

export function MotionProvider({ children }: { children: ReactNode }) {
  // `strict` makes the bare `motion.*` components throw, which keeps the lazy
  // path from being quietly bypassed by a future import.
  return (
    <LazyMotion features={features} strict>
      {children}
    </LazyMotion>
  );
}
