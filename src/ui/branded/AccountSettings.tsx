import { useEffect, useState } from 'react';
import { Sheet, Tabs, YStack, XStack, Text, Button, Input, Label, Switch, Separator } from '@hanzo/gui';
import { getCurrentSession, signOutFromIam, getAccessToken } from '../lib/iam-auth';

interface AccountSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Entitlements {
  plan?: string;
  tier?: string;
  worldTrial?: string;
  zenTier?: string;
  balance?: number;
}

export function AccountSettings({ open, onOpenChange }: AccountSettingsProps) {
  const session = getCurrentSession();
  const [tab, setTab] = useState('profile');
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [prefs, setPrefs] = useState({ darkMode: true, dailyDigest: true, alertsViaWhatsApp: false, alertsViaSms: false });

  useEffect(() => {
    if (!open) return;
    const token = getAccessToken();
    if (!token) return;
    fetch('/v1/world/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setEnt(data.entitlements || null))
      .catch(() => {});
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} snapPoints={[85]} dismissOnSnapToBottom>
      <Sheet.Overlay />
      <Sheet.Frame
        padding="$4"
        gap="$4"
        backgroundColor="$background"
        borderTopWidth={1}
        borderTopColor="$borderColor"
      >
        <XStack justifyContent="space-between" alignItems="center">
          <Text fontSize={18} fontWeight="600" color="$color">
            Account
          </Text>
          <Button size="$2" chromeless onPress={() => onOpenChange(false)}>
            Close
          </Button>
        </XStack>

        <Tabs value={tab} onValueChange={setTab} orientation="horizontal" flexDirection="column">
          <Tabs.List borderBottomWidth={1} borderBottomColor="$borderColor">
            {[
              ['profile', 'Profile'],
              ['plan', 'Plan'],
              ['alerts', 'Alerts'],
              ['preferences', 'Preferences'],
            ].map(([k, label]) => (
              <Tabs.Tab key={k} value={k} chromeless padding="$3">
                <Text fontSize={13} color={tab === k ? '$color' : '$colorPress'}>
                  {label}
                </Text>
              </Tabs.Tab>
            ))}
          </Tabs.List>

          <Tabs.Content value="profile" padding="$4" gap="$3">
            {session ? (
              <YStack gap="$3">
                <XStack gap="$3" alignItems="center">
                  <YStack>
                    <Text fontSize={14} color="$color">
                      {session.user?.name || 'Hanzo user'}
                    </Text>
                    <Text fontSize={12} color="$colorPress">
                      {session.user?.email || ''}
                    </Text>
                  </YStack>
                </XStack>
                <Separator />
                <Button onPress={signOutFromIam}>Sign out</Button>
              </YStack>
            ) : (
              <Text fontSize={13} color="$colorPress">
                You're signed out.
              </Text>
            )}
          </Tabs.Content>

          <Tabs.Content value="plan" padding="$4" gap="$3">
            <YStack gap="$3">
              <XStack justifyContent="space-between">
                <Text fontSize={13} color="$colorPress">
                  Current plan
                </Text>
                <Text fontSize={13} color="$color" fontWeight="600">
                  {ent?.plan || 'world-free'}
                </Text>
              </XStack>
              <XStack justifyContent="space-between">
                <Text fontSize={13} color="$colorPress">
                  Tier
                </Text>
                <Text fontSize={13} color="$color">
                  {ent?.tier || 'free'}
                </Text>
              </XStack>
              <XStack justifyContent="space-between">
                <Text fontSize={13} color="$colorPress">
                  Zen AI tier
                </Text>
                <Text fontSize={13} color="$color">
                  {ent?.zenTier || 'tier_zen_free'}
                </Text>
              </XStack>
              {ent?.balance != null ? (
                <XStack justifyContent="space-between">
                  <Text fontSize={13} color="$colorPress">
                    Credit balance
                  </Text>
                  <Text fontSize={13} color="$color">
                    {ent.balance}
                  </Text>
                </XStack>
              ) : null}
              <Separator />
              <XStack gap="$2">
                <a href="/pricing" style={{ textDecoration: 'none', flex: 1 }}>
                  <Button width="100%">See plans</Button>
                </a>
                <Button
                  variant="outlined"
                  flex={1}
                  onPress={() => (window.location.href = '/v1/world/billing-portal')}
                >
                  Manage billing
                </Button>
              </XStack>
            </YStack>
          </Tabs.Content>

          <Tabs.Content value="alerts" padding="$4" gap="$3">
            <YStack gap="$3">
              <XStack justifyContent="space-between" alignItems="center">
                <Label htmlFor="alert-wa">WhatsApp alerts</Label>
                <Switch
                  id="alert-wa"
                  checked={prefs.alertsViaWhatsApp}
                  onCheckedChange={(v) => setPrefs((p) => ({ ...p, alertsViaWhatsApp: !!v }))}
                />
              </XStack>
              <XStack justifyContent="space-between" alignItems="center">
                <Label htmlFor="alert-sms">SMS alerts</Label>
                <Switch
                  id="alert-sms"
                  checked={prefs.alertsViaSms}
                  onCheckedChange={(v) => setPrefs((p) => ({ ...p, alertsViaSms: !!v }))}
                />
              </XStack>
              <XStack justifyContent="space-between" alignItems="center">
                <Label htmlFor="alert-digest">Daily email digest</Label>
                <Switch
                  id="alert-digest"
                  checked={prefs.dailyDigest}
                  onCheckedChange={(v) => setPrefs((p) => ({ ...p, dailyDigest: !!v }))}
                />
              </XStack>
              <Text fontSize={11} color="$colorPress">
                WhatsApp / SMS alerts require Pro. Daily digest is free.
              </Text>
            </YStack>
          </Tabs.Content>

          <Tabs.Content value="preferences" padding="$4" gap="$3">
            <YStack gap="$3">
              <XStack justifyContent="space-between" alignItems="center">
                <Label htmlFor="pref-dark">Dark mode</Label>
                <Switch
                  id="pref-dark"
                  checked={prefs.darkMode}
                  onCheckedChange={(v) => {
                    setPrefs((p) => ({ ...p, darkMode: !!v }));
                    document.documentElement.classList.toggle('dark', !!v);
                    try {
                      localStorage.setItem('worldmonitor-theme', v ? 'dark' : 'light');
                    } catch {}
                  }}
                />
              </XStack>
              <YStack gap="$2">
                <Label htmlFor="pref-region">Region</Label>
                <Input id="pref-region" placeholder="auto" />
              </YStack>
            </YStack>
          </Tabs.Content>
        </Tabs>
      </Sheet.Frame>
    </Sheet>
  );
}
