import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './Shell';
import { mirrorBackgroundStore } from './mirror';
import { WINDOW } from '../core/ow';
import '../styles/theme.css';
import '../styles/motion.css';
// Wave 1 of UI-SPEC: the stroke-bearing frame, loaded on both surfaces so a
// panel adopting it renders the same in the overlay as on the desktop.
import '../styles/primitives.css';
import '../panels/panels';

mirrorBackgroundStore();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell windowName={WINDOW.ingame} />
  </StrictMode>,
);
