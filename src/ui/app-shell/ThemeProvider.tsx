import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

/**
 * Theme wrapper for Hanzo chrome. Uses `.dark` class on <html>.
 *
 * The existing worldmonitor map shell sets `data-theme="light|dark"` on
 * <html> via src/utils/theme-manager.ts. This provider mirrors that state
 * into `.dark` class so @hanzo/ui components pick up dark mode.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      storageKey="worldmonitor-theme"
    >
      {children}
    </NextThemesProvider>
  );
}
