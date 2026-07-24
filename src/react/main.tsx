import './theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GuiProvider } from '@hanzo/gui';
import { initI18n } from '@/services/i18n';
import { isCallback, handleCallback } from '@/services/iam';
import guiConfig from './gui.config';
import { initTelemetry } from './telemetry';
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
// Wire the ONE @hanzo/event telemetry client (reused verbatim from the vanilla
// bootstrap) into the React root before first paint, so pageviews + errors are
// captured from boot. Idempotent, IAM-decoupled, and inert off the deployed site.
initTelemetry();

async function boot(): Promise<void> {
  const host = document.getElementById('react-root');
  if (!host) throw new Error('[world/react] #react-root mount node missing');


  // Complete the hanzo.id OIDC PKCE redirect before the app renders, then
  // restore a clean URL. The SPA server returns index.html for /auth/callback,
  // so when the React entry is served there this is what finishes the code
  // exchange — without it, sign-in silently breaks. Mirrors the vanilla entry.
  if (isCallback()) {
    try {
      const returnTo = await handleCallback();
      history.replaceState({}, '', returnTo);
    } catch (err) {
      console.error('[iam] login callback failed', err);
      history.replaceState({}, '', '/');
    }
  }

  // Init the SHARED i18n layer before first paint so the panel chassis' default
  // loading / empty / error copy (the same common.* keys the vanilla base uses)
  // resolves to real strings rather than raw keys. Reuse, not re-author.
  await initI18n().catch(() => { /* best-effort — never block first paint */ });

  createRoot(host).render(
    <StrictMode>
      <GuiProvider config={guiConfig} defaultTheme="dark">
        <App />
      </GuiProvider>
    </StrictMode>,
  );
}

void boot().catch(console.error);
