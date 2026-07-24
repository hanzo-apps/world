import { YStack, XStack, SizableText } from '@hanzo/gui';
import { TIER1_COUNTRIES } from '@/services/country-instability';
import { Panel } from './Panel';
import type { PanelSlot } from './PanelGrid';
import { useCountryIntel } from '../hooks/useCountryIntel';

/**
 * CountryIntelPanel — the React companion surface for the vanilla
 * `CountryIntelController` (wired here through `useCountryIntel`).
 *
 * The controller owns the *primary* interaction: click a country on the globe and
 * its fullscreen `CountryBriefPage` overlay opens (vanilla DOM, unchanged). This
 * panel is the companion on the Panel chassis — it (1) reflects the current
 * selection truthfully (mirrored from the globe click via the hook's store, so it
 * never lies about which country is open), and (2) offers a Tier-1 quick-launch
 * so a brief can be opened without hunting for the country on the globe. Both
 * paths funnel through the SAME controller entry (`openCountryBriefByCode`) the
 * globe click uses — one and only one drill-down funnel.
 *
 * View-only + longhand @hanzo/gui primitives, per the chassis contract. No intel
 * logic lives here: the signals, timeline, brief text and story all belong to the
 * controller and its fullscreen page; this file owns only the launcher rows and
 * the "what's open" reflection.
 */

const TIER1_ENTRIES = Object.entries(TIER1_COUNTRIES);

function LaunchRow({
  code,
  name,
  active,
  onOpen,
}: {
  code: string;
  name: string;
  active: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <XStack
      role="button"
      tabIndex={0}
      cursor="pointer"
      alignItems="center"
      justifyContent="space-between"
      gap="$2"
      paddingHorizontal="$2"
      paddingVertical="$1.5"
      borderRadius="$3"
      backgroundColor={active ? 'rgba(255,255,255,0.14)' : 'transparent'}
      hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
      pressStyle={{ backgroundColor: 'rgba(255,255,255,0.18)' }}
      onPress={onOpen}
    >
      <SizableText size="$3" color={active ? '$color12' : '$color11'} numberOfLines={1} style={{ flex: 1 }}>
        {name}
      </SizableText>
      <SizableText size="$1" color="$color9" style={{ letterSpacing: 1 }}>
        {code}
      </SizableText>
    </XStack>
  );
}

export function CountryIntelPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const intel = useCountryIntel();

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Country Intel"
      state="ready"
      infoTooltip="Click a country on the globe — or pick one below — to open its intelligence brief."
    >
      <YStack gap="$3">
        {/* Current selection — mirrors the globe/brief truthfully. */}
        <YStack
          gap="$1"
          paddingHorizontal="$2"
          paddingVertical="$2"
          borderRadius="$3"
          borderWidth={1}
          borderColor="rgba(255,255,255,0.10)"
          backgroundColor="rgba(255,255,255,0.04)"
        >
          {intel.code ? (
            <>
              <XStack alignItems="center" justifyContent="space-between" gap="$2">
                <SizableText size="$4" color="$color12" numberOfLines={1} style={{ flex: 1 }}>
                  {intel.name ?? intel.code}
                </SizableText>
                <SizableText size="$1" color="$color9" style={{ letterSpacing: 1 }}>
                  {intel.code}
                </SizableText>
              </XStack>
              <XStack alignItems="center" gap="$2" justifyContent="space-between">
                <SizableText size="$1" color="$color9">
                  {intel.visible ? 'Brief open' : 'Selected'}
                </SizableText>
                <SizableText
                  role="button"
                  tabIndex={0}
                  cursor="pointer"
                  size="$2"
                  color="$color11"
                  hoverStyle={{ color: '$color12' }}
                  onPress={() => intel.openStory(intel.code!, intel.name ?? undefined)}
                >
                  Share story →
                </SizableText>
              </XStack>
            </>
          ) : (
            <SizableText size="$2" color="$color9">
              {intel.ready
                ? 'Click a country on the globe to open its intelligence brief.'
                : 'Waiting for the globe to load…'}
            </SizableText>
          )}
        </YStack>

        {/* Tier-1 quick launch — the same drill-down funnel, without the globe hunt. */}
        <YStack gap="$0.5">
          <SizableText size="$1" color="$color9" paddingHorizontal="$2" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
            Watchlist
          </SizableText>
          {TIER1_ENTRIES.map(([code, name]) => (
            <LaunchRow
              key={code}
              code={code}
              name={name}
              active={intel.code === code}
              onOpen={() => intel.openByCode(code, name)}
            />
          ))}
        </YStack>
      </YStack>
    </Panel>
  );
}
