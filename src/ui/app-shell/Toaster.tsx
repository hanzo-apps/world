import { Toaster as Sonner } from 'sonner';

/**
 * Wraps Sonner with Hanzo brand tokens. Dark/light follows CSS variables.
 */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        className: 'hanzo-chrome font-inter',
        style: {
          background: 'var(--card)',
          color: 'var(--foreground)',
          border: '1px solid var(--border)',
        },
      }}
      closeButton
    />
  );
}
