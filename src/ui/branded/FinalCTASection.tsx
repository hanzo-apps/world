import { useState } from 'react';
import { YStack, XStack, H2, Text, Button, Input } from '@hanzo/gui';

export function FinalCTASection() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');

  async function submit() {
    if (!email || !email.includes('@')) {
      setStatus('error');
      return;
    }
    setStatus('loading');
    try {
      const res = await fetch('/v1/world/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'cta-final' }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus('ok');
      setEmail('');
    } catch {
      setStatus('error');
    }
  }

  return (
    <YStack paddingHorizontal="$6" paddingVertical="$10" gap="$5" alignItems="center">
      <H2 fontSize={32} fontWeight="700" letterSpacing={-1} color="$color" textAlign="center">
        Subscribe for updates.
      </H2>
      <Text fontSize={15} color="$colorPress" maxWidth={520} textAlign="center">
        Weekly intelligence digest. Major-incident alerts. New feeds and
        capabilities. No spam.
      </Text>
      <XStack gap="$2" maxWidth={420} width="100%">
        <Input
          size="$4"
          flex={1}
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          onSubmitEditing={submit}
          disabled={status === 'loading'}
        />
        <Button
          size="$4"
          onPress={submit}
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

      <XStack gap="$2" marginTop="$4">
        <a href="https://discord.gg/re63kWKxaz" style={{ textDecoration: 'none' }}>
          <Button size="$3" chromeless>
            Join Discord
          </Button>
        </a>
        <a href="https://t.me/hanzoai" style={{ textDecoration: 'none' }}>
          <Button size="$3" chromeless>
            Telegram
          </Button>
        </a>
      </XStack>
    </YStack>
  );
}
