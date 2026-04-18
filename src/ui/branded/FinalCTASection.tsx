import { useState, type FormEvent } from 'react';
import { Button } from '@hanzo/ui/primitives/button';
import { Input } from '@hanzo/ui/primitives/input';

export function FinalCTASection({ endpoint = '/v1/world/register' }: { endpoint?: string }) {
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
        body: JSON.stringify({ email, source: 'world-final-cta' }),
      });
      if (!res.ok) throw new Error(`Subscribe failed (${res.status})`);
      setStatus('success');
      setMessage('Subscribed. Thanks &mdash; we will send sparingly.');
      setEmail('');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Subscription failed.');
    }
  }

  return (
    <section className="hanzo-chrome font-inter w-full border-t border-border bg-secondary/30">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col items-center gap-6 px-4 py-20 text-center sm:px-6 lg:px-8">
        <h2 className="text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          Subscribe for updates.
        </h2>
        <p className="max-w-xl text-sm text-muted-foreground">
          New sources, model upgrades, major feature releases. Low volume. Unsubscribe any time.
        </p>

        <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col items-center gap-3 sm:flex-row">
          <Input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 bg-background"
          />
          <Button
            type="submit"
            disabled={status === 'loading'}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {status === 'loading' ? 'Subscribing...' : 'Subscribe'}
          </Button>
        </form>

        {message && (
          <p
            className={`text-xs ${status === 'error' ? 'text-destructive-foreground' : 'text-muted-foreground'}`}
            dangerouslySetInnerHTML={{ __html: message }}
          />
        )}

        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <a
            href="https://discord.gg/hanzo"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-transparent px-4 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
          >
            Join Discord
          </a>
          <a
            href="https://t.me/hanzoai"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-transparent px-4 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
          >
            Join Telegram
          </a>
        </div>
      </div>
    </section>
  );
}
