import { useMemo, useState, useCallback } from 'react';
import { YStack, XStack } from '@hanzo/gui';
import { HanzoAppHeader } from '@hanzogui/shell';
import { getSiteVariant, setSiteVariantRuntime } from '@/config/variant';
import { GlobeIsland } from './components/GlobeIsland';
import { VariantTabs } from './components/VariantTabs';
import { PanelGrid, type PanelGridItem } from './components/PanelGrid';
import { MarketsPanel } from './components/MarketsPanel';
import { AccountControl } from './components/AccountControl';

/**
 * The React + @hanzo/gui foundation for world.hanzo.ai.
 *
 * Architecture proven end-to-end here:
 *   1. Unified signed-in shell — HanzoAppHeader(productId="world") from
 *      @hanzogui/shell, themed by @hanzo/brand tokens (monochrome, accent #fff).
 *   2. The deck.gl globe as a React island (GlobeIsland) wrapping the EXISTING
 *      MapContainer — not a rewrite.
 *   3. Variant tabs + the panel framework: PanelGrid (rail layout + drag-reorder +
 *      shared `panel-order` persistence) hosting panels built on the ONE Panel
 *      chassis. MarketsPanel is the wired proof; Stage-2 ports drop into `items`.
 *
 * Style props are LONGHAND-only (see gui.config.ts) — one explicit vocabulary.
 */
export function App(): React.JSX.Element {
  const [variant, setVariant] = useState<string>(() => getSiteVariant());

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

  // The rail's panels. One item today (the wired proof); the bulk Stage-2 ports
  // append here, each rendering through the same chassis + PanelGrid slot.
  const panels = useMemo<PanelGridItem[]>(
    () => [{ id: 'markets', render: (slot) => <MarketsPanel slot={slot} /> }],
    [],
  );

  return (
    <YStack flex={1} height="100%" backgroundColor="#000">
      <HanzoAppHeader
        productId="world"
        org={{ id: 'hanzo', label: 'Hanzo' }}
        search={{ placeholder: 'Search or ask Hanzo…' }}
        account={<AccountControl />}
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

      {/* Stage: the globe fills the viewport; the panel rail floats over it. */}
      <YStack flex={1} position="relative" overflow="hidden">
        <GlobeIsland variant={variant} />
        <YStack position="absolute" top="$3" right="$3" zIndex={20}>
          <PanelGrid items={panels} />
        </YStack>
      </YStack>
    </YStack>
  );
}
