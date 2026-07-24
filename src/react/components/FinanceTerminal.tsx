import { useEffect, useRef } from 'react';
import type { FinanceTerminal as FinanceTerminalEngine } from '@/components/finance/FinanceTerminal';

/**
 * FinanceTerminal — the Bloomberg-style finance terminal as a React island.
 *
 * This does NOT rewrite the terminal. It owns a plain DOM host <div> and, on
 * mount, instantiates the EXISTING vanilla `FinanceTerminal` class (the dense
 * dark grid of live TradingView charts + Lux DEX card + alt-asset feeds, exactly
 * as the vanilla app does). React owns the lifecycle (mount / unmount); the
 * TradingView embed engine (createChart / createTvWidget, IntersectionObserver
 * lazy-mount, device-tier degradation) stays imperative and untouched behind the
 * host node — mirroring how GlobeIsland wraps MapContainer.
 *
 * The heavy terminal chunk (TradingView embeds + finance-terminal.css) is
 * dynamically imported, so it never ships in the entry bundle — mirroring the
 * vanilla `App.syncFinanceTerminal()`.
 *
 * This is the finance variant's full-viewport stage: the vanilla `.fin-terminal`
 * is `position: fixed; inset: var(--header-h) 0 0 0; z-index: 40`, so it pins
 * itself below the shell header and scrolls internally — the host node only
 * anchors the mount point. App renders this in place of the globe stage when the
 * finance variant is active.
 */
export function FinanceTerminal(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<FinanceTerminalEngine | null>(null);

  // Mount the terminal once. React StrictMode double-invokes effects in dev; the
  // `cancelled` guard + destroy teardown makes the instantiate/destroy pair
  // idempotent so we never leave two terminal DOM trees (or duplicate embeds).
  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    void (async () => {
      const { FinanceTerminal: Engine } = await import(
        '@/components/finance/FinanceTerminal'
      );
      if (cancelled || engineRef.current) return;
      engineRef.current = new Engine();
      engineRef.current.mount(host);
    })();

    return () => {
      cancelled = true;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  // A minimal anchor node (plain host div, mirroring GlobeIsland). `.fin-terminal`
  // is position:fixed, so it sizes itself off the viewport; this host only
  // provides the mount point React controls.
  return (
    <div
      ref={hostRef}
      aria-label="Finance terminal"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  );
}
