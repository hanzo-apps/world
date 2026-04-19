import { YStack, XStack, H1, Text, Button } from '@hanzo/gui';
import { signInWithIam, getCurrentSession } from '../lib/iam-auth';

export function HeroSection() {
  const session = getCurrentSession();
  return (
    <YStack
      alignItems="center"
      justifyContent="center"
      paddingVertical="$10"
      paddingHorizontal="$6"
      gap="$5"
      maxWidth={920}
      marginHorizontal="auto"
    >
      <H1
        fontSize={44}
        $sm={{ fontSize: 56 }}
        $md={{ fontSize: 68 }}
        fontWeight="700"
        letterSpacing={-1.4}
        lineHeight={1.05}
        color="$color"
        textAlign="center"
      >
        Real-time streaming news, world events, and simulations.
      </H1>
      <Text
        fontSize={17}
        $sm={{ fontSize: 19 }}
        color="$colorPress"
        maxWidth={680}
        lineHeight={1.5}
        textAlign="center"
      >
        Palantir-grade intelligence — open and public. Conflicts, markets,
        cables, ships, satellites, weather, cyber, and Zen AI analysis on a
        live globe.
      </Text>
      <XStack gap="$3" marginTop="$3">
        {session ? (
          <Button size="$5" onPress={() => (window.location.href = '/')}>
            Open dashboard
          </Button>
        ) : (
          <Button
            size="$5"
            onPress={() => signInWithIam('/?onboard=1')}
          >
            Start free
          </Button>
        )}
        <a href="/pricing" style={{ textDecoration: 'none' }}>
          <Button size="$5" chromeless>
            See pricing
          </Button>
        </a>
      </XStack>
      <Text fontSize={12} color="$colorPress" marginTop="$3">
        No credit card. Free tier stays free.
      </Text>
    </YStack>
  );
}
