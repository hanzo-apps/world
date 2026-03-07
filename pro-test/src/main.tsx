import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App, { renderTurnstileWidgets } from './App.tsx';
import { initI18n } from './i18n';
import './index.css';

const TURNSTILE_SCRIPT_SELECTOR = 'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]';

initI18n().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // Render widgets once React has mounted and the async Turnstile script is ready.
  let initialized = false;
  const initWidgets = () => {
    if (initialized || !window.turnstile) return false;
    const rendered = renderTurnstileWidgets();
    if (rendered === 0) return false;
    initialized = true;
    return true;
  };

  const turnstileScript = document.querySelector<HTMLScriptElement>(TURNSTILE_SCRIPT_SELECTOR);
  turnstileScript?.addEventListener('load', () => {
    initWidgets();
  }, { once: true });

  if (!initWidgets()) {
    let attempts = 0;
    const retryInterval = window.setInterval(() => {
      if (initWidgets() || ++attempts >= 20) window.clearInterval(retryInterval);
    }, 500);
  }
});
