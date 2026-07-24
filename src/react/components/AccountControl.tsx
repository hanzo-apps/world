import { useCallback, useEffect, useRef, useState, type ComponentRef, type Ref } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { UserAvatar } from '@hanzogui/shell';
import {
  getUser,
  login,
  logout,
  isAuthenticated,
  type IamUser,
} from '@/services/iam';
import { identifyUser } from '../telemetry';

/**
 * AccountControl — the far-right identity affordance handed to HanzoAppHeader's
 * `account` slot.
 *
 * Signed out: a "Sign in" pill that hands off to hanzo.id OIDC. Signed in: the
 * shell's generative `UserAvatar` (@hanzogui/shell — photo → Gravatar → beam
 * fallback) opening a small menu with the identity + sign out.
 *
 * The auth STATE is the app's ONE canonical identity port — the framework-free
 * `src/services/iam.ts` (hanzo.id OIDC Authorization-Code + PKCE, shared with the
 * vanilla surface, white-label host resolution for lux/zoo). This wraps that port
 * verbatim rather than re-deriving a session, so React and vanilla observe the
 * SAME sign-in. (The shell's `useTenantAuth` is intentionally NOT used: it reads
 * different localStorage keys and hardcodes iam.hanzo.ai, so it cannot see this
 * app's PKCE session nor honor the white-label issuer — it would be a second,
 * non-functional auth path.) On resolve, the identity is bound to the ONE
 * telemetry stream (identify + group), mirroring the vanilla boot.
 *
 * Style props are LONGHAND-only, per the repo's @hanzo/gui typecheck contract.
 */
export function AccountControl(): React.JSX.Element {
  const [user, setUser] = useState<IamUser | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Resolve the signed-in identity from the canonical port, then bind it to the
  // telemetry stream. Best-effort and non-blocking — anonymous stays anonymous.
  useEffect(() => {
    let alive = true;
    if (!isAuthenticated()) return;
    void getUser()
      .then((u) => {
        if (!alive || !u) return;
        setUser(u);
        identifyUser(u);
      })
      .catch(() => {
        /* best effort — never break paint */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Close the menu on any outside click, mirroring the vanilla AccountMenu.
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocPointer);
    return () => document.removeEventListener('mousedown', onDocPointer);
  }, [open]);

  const onSignIn = useCallback(() => {
    void login();
  }, []);
  const onSignOut = useCallback(() => {
    setOpen(false);
    void logout().finally(() => window.location.reload());
  }, []);

  // Signed out — a compact "Sign in" pill that hands off to hanzo.id.
  if (!user) {
    return (
      <XStack
        role="button"
        tabIndex={0}
        cursor="pointer"
        height={32}
        paddingHorizontal="$3"
        borderRadius={999}
        alignItems="center"
        justifyContent="center"
        borderWidth={1}
        borderColor="rgba(255,255,255,0.2)"
        backgroundColor="rgba(255,255,255,0.06)"
        hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
        pressStyle={{ backgroundColor: 'rgba(255,255,255,0.18)' }}
        onPress={onSignIn}
        aria-label="Sign in"
      >
        <SizableText size="$2" color="$color12" fontWeight="600">
          Sign in
        </SizableText>
      </XStack>
    );
  }

  // Signed in — the generative avatar trigger + an anchored identity menu.
  const label = user.name || user.email || 'Account';
  return (
    <YStack ref={ref as unknown as Ref<ComponentRef<typeof YStack>>} position="relative" alignItems="flex-end">
      <XStack
        role="button"
        tabIndex={0}
        cursor="pointer"
        width={32}
        height={32}
        borderRadius={999}
        overflow="hidden"
        alignItems="center"
        justifyContent="center"
        borderWidth={1}
        borderColor="rgba(255,255,255,0.2)"
        hoverStyle={{ borderColor: 'rgba(255,255,255,0.4)' }}
        onPress={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
      >
        <UserAvatar src={user.picture} email={user.email} name={user.name} size={32} />
      </XStack>

      {open ? (
        <YStack
          position="absolute"
          top={40}
          right={0}
          zIndex={1000}
          minWidth={220}
          borderRadius="$4"
          borderWidth={1}
          borderColor="rgba(255,255,255,0.12)"
          backgroundColor="rgba(10,12,14,0.98)"
          overflow="hidden"
          shadowColor="rgba(0,0,0,0.6)"
          shadowRadius={32}
          shadowOffset={{ width: 0, height: 16 }}
        >
          <YStack paddingHorizontal="$3" paddingVertical="$2.5" gap="$1">
            {user.name ? (
              <SizableText size="$3" color="$color12" fontWeight="600">
                {user.name}
              </SizableText>
            ) : null}
            {user.email ? (
              <SizableText size="$1" color="$color11">
                {user.email}
              </SizableText>
            ) : null}
          </YStack>

          <YStack height={1} backgroundColor="rgba(255,255,255,0.1)" />

          <XStack
            role="button"
            tabIndex={0}
            cursor="pointer"
            paddingHorizontal="$3"
            paddingVertical="$2.5"
            alignItems="center"
            hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
            pressStyle={{ backgroundColor: 'rgba(255,255,255,0.16)' }}
            onPress={onSignOut}
            aria-label="Sign out"
          >
            <SizableText size="$2" color="$color12">
              Sign out
            </SizableText>
          </XStack>
        </YStack>
      ) : null}
    </YStack>
  );
}
