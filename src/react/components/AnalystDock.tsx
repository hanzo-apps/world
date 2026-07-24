import { useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { useAnalyst } from '../hooks/useAnalyst';
import { AnalystChatSurface } from './AnalystChatSurface';

/**
 * AnalystDock — the React chrome for the agentic analyst copilot.
 *
 * Closed, it is a small round FAB bottom-right. Open, it is a right-anchored
 * card holding the live chat. This component owns ONLY the chrome (where the
 * chat lives + open/close); the conversation, streaming, tool traces and agentic
 * action dispatch all belong to the vanilla `AnalystChat` mounted by
 * `AnalystChatSurface`. The host is built by `useAnalyst`, whose `set_variant`
 * capability drives the SAME one-switch variant path App already owns (passed in
 * as `onVariantChange`) — so telling the analyst "switch to the crypto view"
 * moves the same tabs a click would.
 *
 * Style props are LONGHAND-only, per the repo's @hanzo/gui typecheck contract.
 */
export function AnalystDock({
  onVariantChange,
}: {
  /** App's `handleSelect` — the ONE React variant switch the agent routes through. */
  onVariantChange: (id: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { host } = useAnalyst({ onVariantChange });

  return (
    <YStack position="absolute" bottom="$4" right="$4" zIndex={1000} alignItems="flex-end" gap="$3">
      {open ? (
        <YStack
          width={408}
          height={560}
          maxWidth="calc(100vw - 32px)"
          maxHeight="calc(100vh - 120px)"
          borderRadius="$6"
          borderWidth={1}
          borderColor="rgba(255,255,255,0.12)"
          backgroundColor="rgba(10,12,14,0.96)"
          overflow="hidden"
          shadowColor="rgba(0,0,0,0.6)"
          shadowRadius={40}
          shadowOffset={{ width: 0, height: 20 }}
        >
          <XStack
            alignItems="center"
            justifyContent="space-between"
            paddingHorizontal="$3"
            paddingVertical="$2.5"
            borderBottomWidth={1}
            borderBottomColor="rgba(255,255,255,0.1)"
          >
            <SizableText size="$3" color="$color12" fontWeight="600">
              Analyst
            </SizableText>
            <XStack
              role="button"
              tabIndex={0}
              cursor="pointer"
              width={28}
              height={28}
              borderRadius={999}
              alignItems="center"
              justifyContent="center"
              hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
              pressStyle={{ backgroundColor: 'rgba(255,255,255,0.16)' }}
              onPress={() => setOpen(false)}
              aria-label="Close analyst"
            >
              <SizableText size="$4" color="$color11">
                ×
              </SizableText>
            </XStack>
          </XStack>

          <YStack flex={1} minHeight={0}>
            <AnalystChatSurface
              host={host}
              options={{
                emptyTitle: 'Ask about this dashboard — or tell me to change it',
                placeholder: 'Ask anything. Update your world.',
              }}
            />
          </YStack>
        </YStack>
      ) : null}

      <XStack
        role="button"
        tabIndex={0}
        cursor="pointer"
        width={52}
        height={52}
        borderRadius={999}
        alignItems="center"
        justifyContent="center"
        borderWidth={1}
        borderColor="rgba(255,255,255,0.18)"
        backgroundColor="rgba(255,255,255,0.08)"
        hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.16)' }}
        pressStyle={{ backgroundColor: 'rgba(255,255,255,0.22)' }}
        onPress={() => setOpen((v) => !v)}
        aria-label={open ? 'Close AI analyst' : 'Open AI analyst'}
        aria-expanded={open}
      >
        <SizableText size="$5" color="$color12">
          ✦
        </SizableText>
      </XStack>
    </YStack>
  );
}
