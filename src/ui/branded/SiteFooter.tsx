import { useState } from 'react';
import { XStack, YStack, Text, H4, Button, Input, Separator } from '@hanzo/gui';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Overview', href: '/' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Pro', href: '/pricing?upgrade=pro' },
      { label: 'Desktop app', href: 'https://github.com/hanzoai/world/releases' },
      { label: 'Status', href: 'https://status.hanzo.ai' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Docs', href: 'https://docs.world.hanzo.ai' },
      { label: 'MCP server', href: 'https://mcp.world.hanzo.ai' },
      { label: 'ZAP API', href: 'https://zap.world.hanzo.ai' },
      { label: 'GitHub', href: 'https://github.com/hanzoai/world' },
      { label: 'Hanzo Base', href: 'https://base.hanzo.ai' },
    ],
  },
  {
    title: 'Hanzo',
    links: [
      { label: 'Hanzo AI', href: 'https://hanzo.ai' },
      { label: 'Console', href: 'https://console.hanzo.ai' },
      { label: 'Chat', href: 'https://hanzo.chat' },
      { label: 'Blog', href: 'https://blog.hanzo.ai' },
    ],
  },
  {
    title: 'Community',
    links: [
      { label: 'Discord', href: 'https://discord.gg/re63kWKxaz' },
      { label: 'X / Twitter', href: 'https://x.com/hanzoai' },
      { label: 'Telegram', href: 'https://t.me/hanzoai' },
    ],
  },
];

export function SiteFooter() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');

  async function subscribe() {
    if (!email || !email.includes('@')) {
      setStatus('error');
      return;
    }
    setStatus('loading');
    try {
      const res = await fetch('/v1/world/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'footer' }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus('ok');
      setEmail('');
    } catch {
      setStatus('error');
    }
  }

  return (
    <YStack
      tag="footer"
      borderTopWidth={1}
      borderTopColor="$borderColor"
      backgroundColor="$background"
      paddingHorizontal="$6"
      paddingVertical="$8"
      gap="$8"
    >
      <XStack flexWrap="wrap" gap="$8" justifyContent="space-between">
        <YStack maxWidth={320} gap="$3">
          <H4 fontSize={18} fontWeight="600" color="$color">
            Hanzo World
          </H4>
          <Text fontSize={13} color="$colorPress" lineHeight={20}>
            Real-time streaming news, world events, and simulations. Palantir-grade
            intelligence — open and public.
          </Text>
          <YStack gap="$2" marginTop="$2">
            <XStack gap="$2">
              <Input
                size="$3"
                flex={1}
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={subscribe}
                disabled={status === 'loading'}
              />
              <Button
                size="$3"
                onPress={subscribe}
                disabled={status === 'loading' || status === 'ok'}
              >
                {status === 'ok' ? 'Subscribed' : status === 'loading' ? '...' : 'Subscribe'}
              </Button>
            </XStack>
            {status === 'error' ? (
              <Text fontSize={11} color="$red10">
                Try again with a valid email.
              </Text>
            ) : null}
          </YStack>
        </YStack>

        {COLUMNS.map((col) => (
          <YStack key={col.title} minWidth={140} gap="$2">
            <Text fontSize={11} fontWeight="600" textTransform="uppercase" color="$colorPress" letterSpacing={1}>
              {col.title}
            </Text>
            {col.links.map((l) => (
              <a key={l.href} href={l.href} style={{ textDecoration: 'none' }}>
                <Text fontSize={13} color="$color" hoverStyle={{ color: '$colorPress' }}>
                  {l.label}
                </Text>
              </a>
            ))}
          </YStack>
        ))}
      </XStack>

      <Separator />

      <XStack justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="$4">
        <Text fontSize={11} color="$colorPress">
          © 2026 Hanzo AI · AGPL-3.0
        </Text>
        <Text fontSize={11} color="$colorPress">
          hanzo.ai · hanzo.id · base.hanzo.ai
        </Text>
      </XStack>
    </YStack>
  );
}
