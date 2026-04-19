import { useState } from 'react';
import { XStack, YStack, Text, Button, Popover, Separator } from '@hanzo/gui';
import { HanzoLogo } from './HanzoLogo';
import { signInWithIam, signOutFromIam, getCurrentSession } from '../lib/iam-auth';

interface SiteHeaderProps {
  onOpenSettings?: () => void;
}

const NAV_LINKS = [
  { label: 'Overview', href: '/' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Docs', href: 'https://docs.world.hanzo.ai' },
  { label: 'Status', href: 'https://status.hanzo.ai' },
  { label: 'GitHub', href: 'https://github.com/hanzoai/world' },
];

export function SiteHeader({ onOpenSettings }: SiteHeaderProps) {
  const session = getCurrentSession();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <XStack
      tag="header"
      position="fixed"
      top={0}
      left={0}
      right={0}
      height={48}
      paddingHorizontal="$4"
      alignItems="center"
      justifyContent="space-between"
      borderBottomWidth={1}
      borderBottomColor="$borderColor"
      backgroundColor="$background"
      zIndex={100}
    >
      <XStack alignItems="center" gap="$3">
        <a href="https://hanzo.ai" target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>
          <HanzoLogo />
        </a>
        <Text fontSize={14} fontWeight="300" color="$colorPress" letterSpacing={0.5}>
          World
        </Text>
      </XStack>

      <XStack alignItems="center" gap="$5" display="none" $gtSm={{ display: 'flex' }}>
        {NAV_LINKS.map((l) => (
          <a key={l.href} href={l.href} style={{ textDecoration: 'none' }}>
            <Text fontSize={13} color="$colorPress" hoverStyle={{ color: '$color' }}>
              {l.label}
            </Text>
          </a>
        ))}
      </XStack>

      <XStack alignItems="center" gap="$2">
        {session ? (
          <Popover open={menuOpen} onOpenChange={setMenuOpen} placement="bottom-end">
            <Popover.Trigger asChild>
              <Button size="$2" chromeless>
                {session.user?.name || session.user?.email || 'Account'}
              </Button>
            </Popover.Trigger>
            <Popover.Content
              backgroundColor="$background"
              borderColor="$borderColor"
              borderWidth={1}
              padding="$2"
              minWidth={180}
            >
              <YStack gap="$1">
                <Button
                  size="$2"
                  chromeless
                  justifyContent="flex-start"
                  onPress={() => {
                    setMenuOpen(false);
                    onOpenSettings?.();
                  }}
                >
                  Settings
                </Button>
                <a
                  href="/pricing"
                  style={{ textDecoration: 'none', display: 'block' }}
                  onClick={() => setMenuOpen(false)}
                >
                  <Button size="$2" chromeless justifyContent="flex-start" width="100%">
                    Plans
                  </Button>
                </a>
                <Separator />
                <Button
                  size="$2"
                  chromeless
                  justifyContent="flex-start"
                  onPress={() => {
                    signOutFromIam();
                    setMenuOpen(false);
                  }}
                >
                  Sign out
                </Button>
              </YStack>
            </Popover.Content>
          </Popover>
        ) : (
          <Button size="$2" onPress={() => signInWithIam(window.location.pathname)}>
            Sign in
          </Button>
        )}
      </XStack>
    </XStack>
  );
}
