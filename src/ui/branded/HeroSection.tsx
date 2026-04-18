import {  Button  } from '@hanzo/ui';
import { ArrowRight, Play } from 'lucide-react';
import { signInWithIam } from '../lib/iam-auth';

const PROOF_CHIPS = [
  '435+ sources',
  '45 map layers',
  'BYOK AI',
  '21 languages',
  'Self-host',
];

/**
 * Hero section for the /pricing (and future landing) page.
 *
 * This is NOT the root index.html — the main app lives at `/` and renders the
 * live map directly. The hero is for marketing surfaces and for users arriving
 * at `/pricing`.
 */
export function HeroSection() {
  return (
    <section className="hanzo-chrome font-inter relative overflow-hidden bg-background">
      <div className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-col items-center gap-10 px-4 py-24 text-center sm:px-6 lg:px-8 lg:py-32">
        <span className="inline-flex rounded-full border border-border/60 bg-secondary/60 px-4 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Hanzo World — Real-Time Global Intelligence
        </span>

        <h1 className="max-w-4xl text-5xl font-medium tracking-tight leading-[1.05] text-foreground sm:text-6xl lg:text-7xl">
          See the world <span className="text-muted-foreground">in real time.</span>
        </h1>

        <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
          Live conflicts, markets, military movements, infrastructure, cyber, and climate &mdash;
          aggregated from 435+ sources, synthesized by Zen, one dashboard.
        </p>

        <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          <Button
            size="lg"
            onClick={() => signInWithIam('/pricing?upgrade=pro')}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Start free
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-border bg-transparent px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <Play className="mr-2 h-4 w-4" />
            See it live
          </a>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {PROOF_CHIPS.map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-border bg-secondary/60 px-3 py-1.5 text-xs text-muted-foreground"
            >
              {chip}
            </span>
          ))}
        </div>
      </div>

      {/* Background grid pattern — subtle, matches hanzo.ai hero */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        aria-hidden
        style={{
          backgroundImage:
            'linear-gradient(var(--foreground) 1px, transparent 1px), linear-gradient(90deg, var(--foreground) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 20%, black, transparent 75%)',
        }}
      />
    </section>
  );
}
