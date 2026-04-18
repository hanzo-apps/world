import { createRoot } from 'react-dom/client';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import '../styles/globals.css';
import { ThemeProvider } from './ThemeProvider';
import { Toaster } from './Toaster';
import { SiteHeader } from '../branded/SiteHeader';
import { AccountSettings } from '../branded/AccountSettings';
import { ZenChatWidget } from '../branded/ZenChatWidget';

/**
 * Mount Hanzo chrome as three React islands into the existing vanilla map shell.
 *
 *   #hanzo-header-mount   - top nav (fixed, sticky)
 *   #hanzo-chat-mount     - floating chat bubble
 *   #hanzo-settings-mount - invisible; renders the on-demand sheet
 *
 * The map shell (src/main.ts) manages its own DOM under <div id="app">. This
 * module is imported from main.ts and must not touch the map container. It
 * appends its mount points to <body> directly.
 */

interface ChromeShellProps {
  onFocusMap: () => void;
}

function ChromeShell({ onFocusMap }: ChromeShellProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Listen for custom events from the legacy app to open settings.
  useEffect(() => {
    const handler = () => setSettingsOpen(true);
    window.addEventListener('hanzo:open-settings', handler);
    return () => window.removeEventListener('hanzo:open-settings', handler);
  }, []);

  const onOpenSettings = useCallback(() => setSettingsOpen(true), []);

  return (
    <ThemeProvider>
      <SiteHeader onOpenSettings={onOpenSettings} />
      <AccountSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ZenChatWidget />
      <Toaster />
      {/* Hidden focus toggle for map — future work, currently unused. */}
      <button
        hidden
        onClick={onFocusMap}
        aria-label="Focus map"
      />
    </ThemeProvider>
  );
}

function ensureMount(id: string, position: 'top' | 'bottom'): HTMLElement {
  const existing = document.getElementById(id);
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = id;
  if (position === 'top') document.body.insertBefore(el, document.body.firstChild);
  else document.body.appendChild(el);
  return el;
}

export function mountHanzoChrome(): void {
  const root = ensureMount('hanzo-chrome-root', 'top');

  createRoot(root).render(
    <StrictMode>
      <ChromeShell
        onFocusMap={() => {
          document.body.dataset.mapFocus = document.body.dataset.mapFocus === 'true' ? 'false' : 'true';
        }}
      />
    </StrictMode>,
  );
}
