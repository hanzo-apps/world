import { useState, useCallback } from 'react';
import { YStack, XStack } from '@hanzo/gui';
import { HanzoAppHeader } from '@hanzogui/shell';
import { getSiteVariant, setSiteVariantRuntime } from '@/config/variant';
import { GlobeIsland } from './components/GlobeIsland';
import { VariantTabs } from './components/VariantTabs';
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
 *   3. Variant tabs + one real ported panel (MarketsPanel, reusing the live
 *      markets service) as proof the panel pattern moves cleanly onto @hanzo/gui.
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

  return (
    <YStack flex={1} height="100%" backgroundColor="#000">
      <HanzoAppHeader
        productId="world"
        org={{ id: 'hanzo', label: 'Hanzo' }}
        search={{ placeholder: 'Search or ask Hanzo…' }}
        account={<AccountControl />}
      />

      <XStack px="$3" py="$2" ai="center" jc="flex-start" gap="$3" zIndex={10}>
        <VariantTabs active={variant} onSelect={handleSelect} />
      </XStack>

      {/* Stage: the globe fills the viewport; panels float over it. */}
      <YStack flex={1} position="relative" overflow="hidden">
        <GlobeIsland variant={variant} />
        <YStack position="absolute" top="$3" right="$3" gap="$3" zIndex={20}>
          <MarketsPanel />
        </YStack>
      </YStack>
    </YStack>
  );
}
