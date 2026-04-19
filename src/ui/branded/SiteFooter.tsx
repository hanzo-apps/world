import { useState, type FormEvent } from 'react';
import {  Button  } from '@hanzo/gui';
import {  Input  } from '@hanzo/gui';
import { HanzoLogo } from './HanzoLogo';

const SECTIONS = [
  {
    title: 'Product',
    links: [
      { label: 'Overview', href: '/' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Changelog', href: '/blog/' },
      { label: 'Desktop app', href: '/download' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Docs', href: 'https://docs.hanzo.ai', external: true },
      { label: 'API', href: 'https://api.world.hanzo.ai', external: true },
      { label: 'GitHub', href: 'https://github.com/hanzoai/world', external: true },
      { label: 'Status', href: 'https://status.hanzo.ai', external: true },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About Hanzo', href: 'https://hanzo.ai', external: true },
      { label: 'Blog', href: '/blog/' },
      { label: 'Careers', href: 'https://hanzo.ai/careers', external: true },
      { label: 'Contact', href: 'mailto:hi@hanzo.ai' },
    ],
  },
  {
    title: 'Community',
    links: [
      { label: 'Discord', href: 'https://discord.gg/hanzo', external: true },
      { label: 'X / Twitter', href: 'https://x.com/hanzoai', external: true },
      { label: 'Telegram', href: 'https://t.me/hanzoai', external: true },
      { label: 'YouTube', href: 'https://youtube.com/@hanzoai', external: true },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', href: 'https://hanzo.ai/privacy', external: true },
      { label: 'Terms', href: 'https://hanzo.ai/terms', external: true },
      { label: 'Security', href: 'https://hanzo.ai/security', external: true },
      { label: 'License', href: 'https://github.com/hanzoai/world/blob/main/LICENSE', external: true },
    ],
  },
];

const SOCIAL_ICONS = [
  {
    name: 'X',
    href: 'https://x.com/hanzoai',
    path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  },
  {
    name: 'GitHub',
    href: 'https://github.com/hanzoai',
    path: 'M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.38 7.86 10.9.58.1.79-.25.79-.56v-2.02c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.97.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.27-5.23-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.17.92-.26 1.91-.39 2.9-.39.99 0 1.98.13 2.9.39 2.2-1.48 3.17-1.17 3.17-1.17.62 1.58.23 2.75.11 3.04.73.8 1.18 1.83 1.18 3.08 0 4.42-2.69 5.39-5.25 5.67.41.35.77 1.05.77 2.12v3.14c0 .31.21.66.79.55C20.21 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z',
  },
  {
    name: 'Discord',
    href: 'https://discord.gg/hanzo',
    path: 'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.037c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276c-.598.3428-1.2205.6447-1.8733.8914a.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z',
  },
  {
    name: 'Telegram',
    href: 'https://t.me/hanzoai',
    path: 'M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.295-.6.295-.002 0-.003 0-.005 0l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.643.135-.953l11.566-4.458c.538-.196 1.006.128.832.941z',
  },
];

export interface SiteFooterProps {
  /** Endpoint to submit newsletter to. Defaults to /v1/world/register. */
  endpoint?: string;
}

export function SiteFooter({ endpoint = '/v1/world/register' }: SiteFooterProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('loading');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'world-footer' }),
      });
      if (!res.ok) throw new Error(`Subscribe failed (${res.status})`);
      setStatus('success');
      setMessage('Subscribed. We will send updates sparingly.');
      setEmail('');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Subscription failed.');
    }
  }

  return (
    <footer className="hanzo-site-footer hanzo-chrome font-inter relative w-full border-t border-border bg-background">
      <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-8">
          <div className="space-y-5 lg:col-span-4">
            <a href="/" aria-label="Hanzo World home" className="inline-block">
              <HanzoLogo />
            </a>
            <p className="max-w-sm text-sm text-muted-foreground">
              Real-time global intelligence. 435+ sources. 45 map layers. Built on the open Hanzo AI stack.
            </p>

            <form onSubmit={handleSubmit} className="max-w-sm space-y-2">
              <label htmlFor="newsletter-email" className="text-xs font-medium text-foreground">
                Subscribe for updates
              </label>
              <div className="flex gap-2">
                <Input
                  id="newsletter-email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex-1 bg-secondary"
                />
                <Button
                  type="submit"
                  disabled={status === 'loading'}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {status === 'loading' ? '...' : 'Subscribe'}
                </Button>
              </div>
              {message && (
                <p
                  className={`text-xs ${
                    status === 'error' ? 'text-destructive-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {message}
                </p>
              )}
            </form>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-5 lg:col-span-8 lg:grid-cols-5">
            {SECTIONS.map((s) => (
              <div key={s.title}>
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {s.title}
                </h3>
                <ul className="space-y-2">
                  {s.links.map((l) => (
                    <li key={l.label}>
                      <a
                        href={l.href}
                        target={l.external ? '_blank' : undefined}
                        rel={l.external ? 'noopener noreferrer' : undefined}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="uppercase tracking-wider font-light">By Hanzo Industries</span>
            <span className="text-muted-foreground/40">&bull;</span>
            <span>&copy; 2016&ndash;{new Date().getFullYear()} Hanzo AI, Inc.</span>
          </div>
          <div className="flex items-center gap-4">
            {SOCIAL_ICONS.map((s) => (
              <a
                key={s.name}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.name}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d={s.path} />
                </svg>
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
