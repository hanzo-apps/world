import { lazy, Suspense } from 'react';

/**
 * Lazy-import wrappers for the React surface's heavy / off-variant islands.
 *
 * Every heavy surface that does NOT need to be in the first parse is code-split
 * here behind `React.lazy`, so the entry chunk carries only the shell (header +
 * variant tabs + globe island bootstrap) and hands the rest off as async chunks.
 * Each wrapper owns its OWN `Suspense` boundary with a null fallback, so it is a
 * true drop-in for the eager component it replaces — App swaps the JSX name and
 * nothing else changes. This is the ONE place the split points are declared.
 *
 *   • FinanceTerminalLazy — only the `finance` variant mounts it, so its chunk
 *     (the React island + the vanilla TradingView terminal graph it pulls) is
 *     never fetched in any globe variant.
 *   • AnalystDockLazy — the agentic copilot. Its graph (AnalystChatSurface + the
 *     vanilla AnalystChat send loop + useAnalyst host) is heavy and needed only
 *     once the app is interactive, so it loads after first paint, not in entry.
 *   • PanelRailLazy — the whole 41-panel rail as one async chunk. Globe variants
 *     load it after first paint; the finance variant (rail not rendered) never
 *     fetches it at all — lazy-by-variant for free.
 *
 * react-native-web renders nothing meaningful for a one-frame fallback, so null
 * is correct here (the globe/terminal paint underneath while the chunk streams).
 */

const FinanceTerminalInner = lazy(() =>
  import('./FinanceTerminal').then((m) => ({ default: m.FinanceTerminal })),
);

const AnalystDockInner = lazy(() =>
  import('./AnalystDock').then((m) => ({ default: m.AnalystDock })),
);

const PanelRailInner = lazy(() => import('./PanelRail'));

export function FinanceTerminalLazy(): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <FinanceTerminalInner />
    </Suspense>
  );
}

export function AnalystDockLazy({
  onVariantChange,
}: {
  onVariantChange: (id: string) => void;
}): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <AnalystDockInner onVariantChange={onVariantChange} />
    </Suspense>
  );
}

export function PanelRailLazy({
  variant,
  onVariantChange,
}: {
  variant: string;
  onVariantChange: (id: string) => void;
}): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <PanelRailInner variant={variant} onVariantChange={onVariantChange} />
    </Suspense>
  );
}
