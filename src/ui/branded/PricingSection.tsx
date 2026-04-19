import { useState } from 'react';
import { YStack, XStack, H2, H3, Text, Button, Card, Separator } from '@hanzo/gui';
import { signInWithIam, getCurrentSession } from '../lib/iam-auth';

interface Tier {
  id: string;
  name: string;
  monthly: string;
  annual: string;
  cadence: string;
  tagline: string;
  features: string[];
  cta: string;
  popular?: boolean;
  action: () => void;
}

async function startCheckout(planId: string) {
  const session = getCurrentSession();
  if (!session) {
    signInWithIam(`/pricing?upgrade=${planId}`);
    return;
  }
  try {
    const res = await fetch('/v1/world/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId, return_url: window.location.origin }),
    });
    if (!res.ok) throw new Error(`Checkout failed (${res.status})`);
    const data: { url?: string; checkoutUrl?: string } = await res.json();
    const url = data.checkoutUrl || data.url;
    if (url) window.location.href = url;
  } catch (err) {
    console.error('[pricing] checkout error', err);
    alert('Checkout unavailable. Please try again shortly.');
  }
}

const TIERS: Tier[] = [
  {
    id: 'world-free',
    name: 'Free',
    monthly: '$0',
    annual: '$0',
    cadence: 'forever',
    tagline: 'Full dashboard, open source.',
    features: [
      '435+ live data sources',
      '45 map layers (conflicts, AIS, ADS-B, FIRMS)',
      'Country intelligence briefs',
      '21 languages',
      'BYOK: your own OpenAI/Anthropic key',
      'Desktop app (macOS, Windows, Linux)',
    ],
    cta: 'Open dashboard',
    action: () => (window.location.href = '/'),
  },
  {
    id: 'world-pro',
    name: 'Pro',
    monthly: '$29',
    annual: '$24',
    cadence: '/month',
    tagline: 'Zen AI analyst, ZAP + MCP API, priority feeds.',
    features: [
      'Everything in Free',
      'Zen AI analyst chat (zen4-thinking, unlimited)',
      'ZAP + MCP real-time API',
      'WhatsApp / Telegram / SMS alerts',
      'Priority feeds (AIS, FIRMS, GDELT, ACLED CAST)',
      'Unlimited custom alerts',
      'Data export (CSV, JSON, parquet)',
    ],
    cta: 'Upgrade to Pro',
    popular: true,
    action: () => startCheckout('world-pro'),
  },
  {
    id: 'world-team',
    name: 'Team',
    monthly: '$99',
    annual: '$82',
    cadence: '/month',
    tagline: '5 seats, shared workspace, SSO.',
    features: [
      'Everything in Pro',
      '5 team seats included',
      'Shared alert rules + saved views',
      'SSO via Hanzo IAM (SAML/OIDC)',
      'Org-level API keys',
      'Audit log',
      'Higher rate limits (15k MCP/min)',
    ],
    cta: 'Get Team',
    action: () => startCheckout('world-team'),
  },
];

export function PricingSection() {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');

  return (
    <YStack paddingHorizontal="$4" paddingVertical="$10" gap="$8" maxWidth={1100} marginHorizontal="auto">
      <YStack alignItems="center" gap="$3" textAlign="center">
        <H2 fontSize={36} fontWeight="700" letterSpacing={-1} color="$color">
          Simple pricing
        </H2>
        <Text fontSize={15} color="$colorPress" maxWidth={560}>
          Free tier stays free forever. Pro adds Zen AI analysis + real-time API
          access. Team adds seats and SSO.
        </Text>

        <XStack
          marginTop="$3"
          padding="$1"
          borderWidth={1}
          borderColor="$borderColor"
          borderRadius="$10"
          backgroundColor="$backgroundPress"
        >
          {(['monthly', 'annual'] as const).map((m) => (
            <Button
              key={m}
              size="$2"
              chromeless={billing !== m}
              backgroundColor={billing === m ? '$color' : 'transparent'}
              color={billing === m ? '$background' : '$colorPress'}
              onPress={() => setBilling(m)}
            >
              {m === 'monthly' ? 'Monthly' : 'Annual −20%'}
            </Button>
          ))}
        </XStack>
      </YStack>

      <XStack flexWrap="wrap" gap="$4" justifyContent="center">
        {TIERS.map((t) => (
          <Card
            key={t.id}
            elevate
            bordered
            padding="$5"
            gap="$4"
            width={320}
            borderColor={t.popular ? '$color' : '$borderColor'}
            backgroundColor="$background"
          >
            <YStack gap="$2">
              <XStack justifyContent="space-between" alignItems="center">
                <H3 fontSize={20} fontWeight="600" color="$color">
                  {t.name}
                </H3>
                {t.popular ? (
                  <Text fontSize={10} fontWeight="600" letterSpacing={1.5} textTransform="uppercase" color="$color">
                    Most popular
                  </Text>
                ) : null}
              </XStack>
              <Text fontSize={13} color="$colorPress" lineHeight={1.5}>
                {t.tagline}
              </Text>
            </YStack>

            <XStack alignItems="baseline" gap="$2">
              <Text fontSize={36} fontWeight="700" color="$color" letterSpacing={-1.5}>
                {billing === 'annual' ? t.annual : t.monthly}
              </Text>
              {t.cadence ? (
                <Text fontSize={13} color="$colorPress">
                  {t.cadence}
                </Text>
              ) : null}
            </XStack>

            <Button
              size="$4"
              backgroundColor={t.popular ? '$color' : 'transparent'}
              color={t.popular ? '$background' : '$color'}
              borderWidth={1}
              borderColor={t.popular ? '$color' : '$borderColor'}
              onPress={t.action}
            >
              {t.cta}
            </Button>

            <Separator />

            <YStack gap="$2">
              {t.features.map((f) => (
                <XStack key={f} gap="$2" alignItems="flex-start">
                  <Text fontSize={12} color="$color">
                    ✓
                  </Text>
                  <Text fontSize={13} color="$color" flex={1}>
                    {f}
                  </Text>
                </XStack>
              ))}
            </YStack>
          </Card>
        ))}
      </XStack>
    </YStack>
  );
}
