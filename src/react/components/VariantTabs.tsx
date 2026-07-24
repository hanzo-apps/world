import { XStack, SizableText } from '@hanzo/gui';
import { VARIANT_TABS } from '../variants';

/**
 * VariantTabs — the header view switcher (Cloud · AI · Crypto · Finance · Tech ·
 * World), ported to React. Presentation only: it renders the canonical
 * `VARIANT_TABS` and reports the picked id upward; the actual switch (canonical
 * aliasing + persistence) stays owned by `@/config/variant`
 * (setSiteVariantRuntime), called once by the parent — one switch path.
 */
export function VariantTabs({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <XStack
      gap="$1"
      ai="center"
      role="tablist"
      aria-label="View switcher"
      borderRadius="$10"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.12)"
      p="$1"
    >
      {VARIANT_TABS.map((tab) => {
        const on = tab.id === active;
        return (
          <XStack
            key={tab.id}
            role="tab"
            aria-selected={on}
            tag="button"
            focusable
            cursor="pointer"
            ai="center"
            gap="$1.5"
            px="$2.5"
            py="$1.5"
            borderRadius="$8"
            backgroundColor={on ? 'rgba(255,255,255,0.14)' : 'transparent'}
            hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
            pressStyle={{ backgroundColor: 'rgba(255,255,255,0.18)' }}
            onPress={() => onSelect(tab.id)}
          >
            <SizableText size="$2" aria-hidden>
              {tab.icon}
            </SizableText>
            <SizableText size="$2" color={on ? '$color12' : '$color10'}>
              {tab.label}
            </SizableText>
          </XStack>
        );
      })}
    </XStack>
  );
}
