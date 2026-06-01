/**
 * Theme bridge — wraps the React island in a @hanzo/gui provider so all
 * @hanzo/gui components inherit tokens. The `dark` theme is the default, with
 * a `light` opt-in mirroring the legacy `worldmonitor-theme` localStorage key.
 */

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { GuiProvider, Theme } from '@hanzo/gui';
import { config as guiConfig } from '../gui-config';

function getInitialTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem('worldmonitor-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  return 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    try {
      window.localStorage.setItem('worldmonitor-theme', theme);
    } catch {}
  }, [theme]);

  // Keep React state in sync if other code flips the legacy `.dark` class.
  useEffect(() => {
    const obs = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains('dark');
      setTheme(isDark ? 'dark' : 'light');
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  return (
    <GuiProvider config={guiConfig} defaultTheme={theme}>
      <Theme name={theme}>{children}</Theme>
    </GuiProvider>
  );
}
