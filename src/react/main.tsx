import './theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GuiProvider } from '@hanzo/gui';
import guiConfig from './gui.config';
import { App } from './App';

/**
 * React 19 entry for the world.hanzo.ai rewrite. This is a SECOND, isolated entry
 * (index.react.html → here) that runs alongside the shipping vanilla app — the
 * vanilla surface at index.html stays intact and deployable while the React +
 * @hanzo/gui foundation is built out behind ?react / the dedicated build.
 *
 * GuiProvider is the Tamagui runtime provider (from @hanzo/gui) fed the ONE config
 * (gui.config.ts). Everything below it can use @hanzogui/* primitives and the
 * unified shell.
 */
const host = document.getElementById('react-root');
if (!host) throw new Error('[world/react] #react-root mount node missing');

createRoot(host).render(
  <StrictMode>
    <GuiProvider config={guiConfig} defaultTheme="dark">
      <App />
    </GuiProvider>
  </StrictMode>,
);
