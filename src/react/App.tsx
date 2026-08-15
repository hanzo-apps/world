import { useState, useCallback } from 'react';
import { YStack, XStack } from '@hanzo/gui';
import { OrgHeader } from '@hanzogui/shell';
import { getSiteVariant, setSiteVariantRuntime } from '@/config/variant';
import { GlobeIsland } from './components/GlobeIsland';
import { VariantTabs } from './components/VariantTabs';
import { AccountControl } from './components/AccountControl';
import { FinanceTerminalLazy, AnalystDockLazy, PanelRailLazy } from './components/lazy';
import { useCountryIntel } from './hooks/useCountryIntel';
import { SearchProvider, useSearch } from './hooks/useSearch';
import { getGlobeInstance } from './hooks/globe-instance';

/**
 * The React + @hanzo/gui foundation for world.hanzo.ai.
 *
 * Architecture proven end-to-end here:
 *   1. Unified signed-in shell — OrgHeader(currentAppId="world") from
 *      @hanzogui/shell, themed by @hanzo/brand tokens (monochrome, accent #fff).
 *      THE one signed-in bar: it carries the cross-app launcher and the app
 *      breadcrumb the old HanzoAppHeader had no room for. The hard-refresh and
 *      settings controls are off — this surface greets anonymous visitors, and
 *      neither belongs in front of one. `account` keeps AccountControl, since
 *      the built-in org dropdown has no signed-out state.
 *   2. The deck.gl globe as a React island (GlobeIsland) wrapping the EXISTING
 *      MapContainer — not a rewrite.
 *   3. Variant tabs + the panel framework: the whole panel catalog + PanelGrid (rail
 *      layout + drag-reorder + shared `panel-order` persistence + per-variant filter)
 *      is code-split behind PanelRailLazy — one async chunk kept out of the entry
 *      parse (finance never even fetches it). FinanceTerminal + AnalystDock are split
 *      the same way (see components/lazy.tsx).
 *
 * Style props are LONGHAND-only (see gui.config.ts) — one explicit vocabulary.
 */
export function App(): React.JSX.Element {
  // SearchProvider is the ⌘K search boundary (mounts the vanilla SearchController
  // once, owns its modal host). Placed at the top so the header's search onClick
  // can consume the hook. `getMap` is wired through the globe-instance registry
  // GlobeIsland publishes into — so search result fly-to routes to the live globe
  // (all STATIC sources work immediately; DYNAMIC sources activate when a React
  // news/markets store lands).
  return (
    <SearchProvider deps={{ getMap: getGlobeInstance }}>
      <AppShell />
    </SearchProvider>
  );
}

function AppShell(): React.JSX.Element {
  const { open, updateSearchIndex } = useSearch();
  const [variant, setVariant] = useState<string>(() => getSiteVariant());

  // App-scoped country drill-down: the vanilla CountryIntelController wires itself
  // to the globe the moment it mounts (via the globe-instance registry) and owns
  // the fullscreen brief overlay; stays live even when the companion panel hides.
  useCountryIntel();

  // One switch path: canonicalize + persist through the config layer, then reflect
  // it in React state and the shareable URL. Mirrors the vanilla in-place switch.
  const handleSelect = useCallback((id: string) => {
    const applied = setSiteVariantRuntime(id);
    if (!applied) return;
    setVariant(applied);
    const url = new URL(window.location.href);
    url.searchParams.set('variant', applied);
    window.history.replaceState(null, '', url.toString());
  }, []);

  return (
    <YStack flex={1} height="100%" backgroundColor="#000">
      <OrgHeader
        currentApp="World"
        currentAppId="world"
        search={{
          placeholder: 'Search or ask Hanzo…',
          onClick: () => {
            updateSearchIndex();
            open();
          },
        }}
        account={<AccountControl />}
        hideHardRefresh
        hideSettings
      />

      <XStack
        paddingHorizontal="$3"
        paddingVertical="$2"
        alignItems="center"
        justifyContent="flex-start"
        gap="$3"
        zIndex={10}
      >
        <VariantTabs active={variant} onSelect={handleSelect} />
      </XStack>

      {/* Stage: the globe + floating panel rail, OR — in the finance variant —
          the full-viewport finance terminal (mirrors the vanilla mountMap
          early-return: the terminal is position:fixed z-index:40 and covers the
          globe, so the z-index:20 rail is intentionally not rendered there).
          The AnalystDock is the agentic copilot, available over every stage. */}
      <YStack flex={1} position="relative" overflow="hidden">
        {variant === 'finance' ? (
          <FinanceTerminalLazy />
        ) : (
          <>
            <GlobeIsland variant={variant} />
            <PanelRailLazy variant={variant} onVariantChange={handleSelect} />
          </>
        )}
        <AnalystDockLazy onVariantChange={handleSelect} />
      </YStack>
    </YStack>
  );
}
