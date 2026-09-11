import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './Shell';
import { mirrorBackgroundStore } from './mirror';
import { WINDOW } from '../core/ow';
import '../styles/theme.css';
import '../styles/motion.css';
// Wave 1 of UI-SPEC: the stroke-bearing frame. Nothing wears it yet; loading it
// here is what lets Wave 2 adopt it panel by panel without a second entry.
import '../styles/primitives.css';
import '../panels/panels';

mirrorBackgroundStore();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell windowName={WINDOW.desktop} />
  </StrictMode>,
);
