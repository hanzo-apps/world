import { useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@hanzo/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@hanzo/ui/tabs';
import {  Button  } from '@hanzo/ui';
import {  Input  } from '@hanzo/ui';
import {  Label  } from '@hanzo/ui';
import { Switch } from '@hanzo/ui/switch';
import { getCurrentSession, signInWithIam, signOut } from '../lib/iam-auth';

export interface AccountSettingsProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function AccountSettings({ open, onOpenChange }: AccountSettingsProps) {
  const [session, setSession] = useState(getCurrentSession());
  useEffect(() => {
    if (open) setSession(getCurrentSession());
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="hanzo-chrome font-inter flex h-full w-full flex-col bg-background p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle className="text-base font-semibold text-foreground">Settings</SheetTitle>
        </SheetHeader>

        <Tabs defaultValue="profile" className="flex flex-1 flex-col">
          <TabsList className="grid w-full grid-cols-6 rounded-none border-b border-border bg-background p-0">
            {['profile', 'preferences', 'alerts', 'api-keys', 'billing', 'team'].map((t) => (
              <TabsTrigger
                key={t}
                value={t}
                className="rounded-none border-b-2 border-transparent py-3 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground"
              >
                {t === 'api-keys' ? 'API' : t.charAt(0).toUpperCase() + t.slice(1)}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex-1 overflow-y-auto p-6 text-sm">
            <TabsContent value="profile" className="m-0">
              {session ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground text-lg font-medium">
                      {(session.name ?? session.email ?? 'U').slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">{session.name ?? 'Account'}</div>
                      <div className="text-xs text-muted-foreground">{session.email ?? session.userId}</div>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="profile-name">Display name</Label>
                    <Input id="profile-name" defaultValue={session.name ?? ''} className="bg-secondary" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="profile-email">Email</Label>
                    <Input id="profile-email" type="email" disabled defaultValue={session.email ?? ''} className="bg-secondary" />
                  </div>
                  <div className="pt-2">
                    <Button variant="outline" onClick={() => signOut()}>Sign out</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 text-center">
                  <p className="text-muted-foreground">Sign in to manage your account.</p>
                  <Button
                    onClick={() => signInWithIam()}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    Sign in with Hanzo
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="preferences" className="m-0 space-y-4">
              <PreferenceRow label="Dark mode" storageKey="worldmonitor-theme" onValue="dark" offValue="light" />
              <PreferenceRow label="Reduced motion" storageKey="worldmonitor-reduced-motion" />
              <PreferenceRow label="Auto-refresh data" storageKey="worldmonitor-auto-refresh" defaultOn />
              <PreferenceRow label="Show breaking news banner" storageKey="worldmonitor-banner" defaultOn />
            </TabsContent>

            <TabsContent value="alerts" className="m-0 space-y-4">
              <p className="text-muted-foreground">Get notified when escalation, conflict, or market thresholds fire.</p>
              <PreferenceRow label="Email alerts" storageKey="worldmonitor-alert-email" />
              <PreferenceRow label="Browser notifications" storageKey="worldmonitor-alert-push" />
              <PreferenceRow label="Daily brief" storageKey="worldmonitor-alert-daily" />
            </TabsContent>

            <TabsContent value="api-keys" className="m-0 space-y-4">
              <div>
                <Label>Hanzo API key</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Grants access to api.world.hanzo.ai. Rotate from the Hanzo Console.
                </p>
                <Input
                  value={session ? 'hk-*************' : ''}
                  disabled
                  className="mt-2 bg-secondary font-mono"
                />
              </div>
              <div>
                <Label>BYOK providers</Label>
                <p className="mt-1 text-xs text-muted-foreground">Provide your own keys to run AI features on Free plan.</p>
                <div className="mt-2 space-y-2">
                  <Input placeholder="OPENAI_API_KEY (sk-...)" className="bg-secondary" />
                  <Input placeholder="ANTHROPIC_API_KEY (sk-ant-...)" className="bg-secondary" />
                </div>
                <Button className="mt-3 bg-primary text-primary-foreground hover:bg-primary/90">Save keys</Button>
              </div>
            </TabsContent>

            <TabsContent value="billing" className="m-0 space-y-4">
              <SubscriptionCard />
            </TabsContent>

            <TabsContent value="team" className="m-0 space-y-4">
              <div className="rounded-lg border border-border bg-card p-6 text-center">
                <p className="text-sm font-medium text-foreground">Team plan</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Multi-seat workspaces, SSO, and shared views are part of the Team tier.
                </p>
                <Button
                  className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => (window.location.href = 'mailto:hi@hanzo.ai?subject=Hanzo%20World%20Team')}
                >
                  Contact sales
                </Button>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function PreferenceRow({
  label,
  storageKey,
  defaultOn,
  onValue = 'true',
  offValue = 'false',
}: {
  label: string;
  storageKey: string;
  defaultOn?: boolean;
  onValue?: string;
  offValue?: string;
}) {
  const [on, setOn] = useState<boolean>(() => {
    if (typeof window === 'undefined') return Boolean(defaultOn);
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return Boolean(defaultOn);
    return raw === onValue;
  });

  function toggle(next: boolean) {
    setOn(next);
    try {
      localStorage.setItem(storageKey, next ? onValue : offValue);
    } catch {
      /* quota/private mode — ignore */
    }
  }

  return (
    <div className="flex items-center justify-between py-1">
      <Label htmlFor={storageKey} className="text-sm font-normal text-foreground">
        {label}
      </Label>
      <Switch id={storageKey} checked={on} onCheckedChange={toggle} />
    </div>
  );
}

function SubscriptionCard() {
  const session = getCurrentSession();
  const [plan, setPlan] = useState<'free' | 'pro' | 'team'>('free');

  useEffect(() => {
    if (!session) return;
    try {
      const cached = localStorage.getItem('worldmonitor-plan');
      if (cached === 'pro' || cached === 'team') setPlan(cached);
    } catch {
      /* ignore */
    }
  }, [session]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Current plan</p>
            <p className="mt-1 text-lg font-semibold capitalize text-foreground">{plan}</p>
          </div>
          {plan === 'free' ? (
            <Button
              onClick={() => (window.location.href = '/pricing')}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Upgrade
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => (window.location.href = 'https://commerce.hanzo.ai/billing')}
            >
              Manage
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Billing is handled by Hanzo Commerce. Invoices and payment methods live at{' '}
        <a href="https://commerce.hanzo.ai/billing" className="underline">
          commerce.hanzo.ai/billing
        </a>
        .
      </p>
    </div>
  );
}
