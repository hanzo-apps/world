import { XStack, SizableText } from '@hanzo/gui';

/**
 * AccountControl — the far-right account affordance handed to HanzoAppHeader's
 * `account` slot. A minimal monogram for the foundation slice; the real IAM-bound
 * avatar (shell `UserAvatar` / `useTenantAuth` against hanzo.id) lands in a later
 * round when auth is wired into the React surface.
 */
export function AccountControl(): React.JSX.Element {
  return (
    <XStack
      role="button"
      tabIndex={0}
      cursor="pointer"
      width={32}
      height={32}
      borderRadius={999}
      alignItems="center"
      justifyContent="center"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.2)"
      backgroundColor="rgba(255,255,255,0.06)"
      hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
      aria-label="Account"
    >
      <SizableText size="$2" color="$color12">
        H
      </SizableText>
    </XStack>
  );
}
