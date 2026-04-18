import { useState } from 'react';
import { Button } from '@hanzo/ui/button';
import { Check, Sparkles } from 'lucide-react';
import { signInWithIam, getCurrentSession } from '../lib/iam-auth';
import { cn } from '../lib/cn';

interface Tier {
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  features: string[];
  cta: string;
  ctaVariant: 'primary' | 'secondary';
  popular?: boolean;
  action: () => void;
}

async function startCheckout() {
  const session = getCurrentSession();
  if (!session) {
    signInWithIam('/pricing?upgrade=pro');
    return;
  }
  try {
    const res = await fetch('/v1/world/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro', return_url: window.location.origin }),
    });
    if (!res.ok) throw new Error(`Checkout failed (${res.status})`);
    const data: { url?: string } = await res.json();
    if (data.url) window.location.href = data.url;
  } catch (err) {
    console.error('[pricing] checkout error', err);
    alert('Checkout unavailable. Please try again shortly.');
  }
}

const TIERS: Tier[] = [
  {
    name: 'Free',
    price: '$0',
    cadence: 'forever',
    tagline: 'Full dashboard, open source.',
    features: [
      '435+ live data sources',
      '45 map layers including conflicts, AIS, ADS-B',
      'Country intelligence briefs',
      '21 languages',
      'BYOK: use your own OpenAI/Anthropic key',
      'Desktop app (macOS, Windows, Linux)',
    ],
    cta: 'Open dashboard',
    ctaVariant: 'secondary',
    action: () => {
      window.location.href = '/';
    },
  },
  {
    name: 'Pro',
    price: '$20',
    cadence: '/month',
    tagline: 'AI synthesis on the house.',
    features: [
      'Everything in Free',
      'Zen AI briefings &mdash; no API key required',
      'Unlimited country & regional briefs',
      'Predictive alerts &amp; anomaly detection',
      'Priority data refresh (real-time)',
      'Export to PDF, CSV, JSON',
      'Email + Discord support',
    ],
    cta: 'Upgrade to Pro',
    ctaVariant: 'primary',
    popular: true,
    action: startCheckout,
  },
  {
    name: 'Team',
    price: 'Custom',
    cadence: '',
    tagline: 'Multi-seat, SSO, dedicated support.',
    features: [
      'Everything in Pro',
      'SSO via Hanzo IAM (SAML/OIDC)',
      'Shared workspaces &amp; saved views',
      'Private data connectors',
      'Custom model routing',
      'SLA &amp; uptime guarantees',
      'Dedicated CSM',
    ],
    cta: 'Contact sales',
    ctaVariant: 'secondary',
    action: () => {
      window.location.href = 'mailto:hi@hanzo.ai?subject=Hanzo%20World%20Team';
    },
  },
];

export function PricingSection() {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');

  return (
    <section id="pricing" className="hanzo-chrome font-inter w-full bg-background">
      <div className="mx-auto w-full max-w-[1400px] px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
            Simple pricing.
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            Free forever. Go Pro when you want Zen to brief you. Talk to us when you bring a team.
          </p>
          <div className="mt-6 inline-flex rounded-full border border-border bg-secondary p-1 text-xs font-medium">
            <button
              onClick={() => setBilling('monthly')}
              className={cn(
                'rounded-full px-4 py-1.5 transition-colors',
                billing === 'monthly' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              Monthly
            </button>
            <button
              onClick={() => setBilling('annual')}
              className={cn(
                'rounded-full px-4 py-1.5 transition-colors',
                billing === 'annual' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              Annual <span className="ml-1 text-[10px] opacity-70">&minus;20%</span>
            </button>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={cn(
                'relative flex flex-col rounded-2xl border bg-card p-8 transition-colors',
                tier.popular ? 'border-foreground/40 shadow-lg' : 'border-border',
              )}
            >
              {tier.popular && (
                <div className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-primary-foreground">
                  <Sparkles className="h-3 w-3" /> Most popular
                </div>
              )}
              <div className="flex items-baseline gap-2">
                <h3 className="text-lg font-semibold text-foreground">{tier.name}</h3>
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight text-foreground">
                  {tier.name === 'Pro' && billing === 'annual' ? '$16' : tier.price}
                </span>
                {tier.cadence && (
                  <span className="text-sm text-muted-foreground">{tier.cadence}</span>
                )}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{tier.tagline}</p>

              <ul className="mt-6 space-y-3 text-sm">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-muted-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                    <span dangerouslySetInnerHTML={{ __html: f }} />
                  </li>
                ))}
              </ul>

              <div className="flex-1" />

              <Button
                size="lg"
                onClick={tier.action}
                className={cn(
                  'mt-8 w-full',
                  tier.ctaVariant === 'primary'
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'border border-border bg-transparent text-foreground hover:bg-secondary',
                )}
              >
                {tier.cta}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
