import { useEffect, useMemo, useState } from 'react';
import { YStack, SizableText } from '@hanzo/gui';
import { sanitizeUrl } from '@/utils/sanitize';
import { Panel, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * CustomFeedPanel — the vanilla `CustomFeedPanel` (src/components/CustomFeedPanel.ts)
 * ported onto the React Panel chassis. It is the analyst-created RSS/Atom panel, the
 * on-demand product of the `add_feed_panel` action, backed by the SAME
 * host-allowlisted `/v1/world/rss-proxy` the built-in feeds use — so the server
 * allowlist is the one SSRF boundary and a blocked domain surfaces here as a quiet
 * empty/error state rather than a crash.
 *
 * The data layer is REUSED verbatim, not re-authored: the feed fetch (rss-proxy, with
 * the 403→"not allowlisted" branch), `parseFeedItems` (the DOMParser walk that dedups
 * to `item` XOR `entry`, KEEPS the `.slice(0, 20)` cap and the `title`-required
 * filter), `relTime`, and `@/utils/sanitize`'s `sanitizeUrl` are carried over
 * unchanged. The port is purely the view: the HTML-string rows become @hanzo/gui
 * LONGHAND primitives against the chassis, which owns the frame plus the honest
 * loading / empty / error states. If created with `initialXml` (the caller already
 * fetched + allowlist-validated), it renders immediately without a fetch.
 */

interface FeedItem {
  title: string;
  link: string;
  date: string;
}

export function CustomFeedPanel({
  slot,
  title,
  feedUrl,
  initialXml,
}: {
  slot: PanelSlot;
  title: string;
  feedUrl: string;
  initialXml?: string;
}): React.JSX.Element {
  // Seed synchronously from initialXml so a pre-fetched feed paints on first frame.
  const seed = useMemo(() => (initialXml ? parseFeedItems(initialXml) : null), [initialXml]);
  const [items, setItems] = useState<FeedItem[]>(seed ?? []);
  const [state, setState] = useState<PanelState>(seed ? (seed.length ? 'ready' : 'empty') : 'loading');
  const [emptyText, setEmptyText] = useState<string | undefined>(seed && !seed.length ? 'No items' : undefined);
  const [errorText, setErrorText] = useState<string | undefined>();

  useEffect(() => {
    // Pre-seeded panels render from initialXml and skip the fetch, mirroring the
    // vanilla constructor's `if (initialXml) renderXml(...) else load()`.
    if (initialXml) return;
    let cancelled = false;

    const load = async (): Promise<void> => {
      setState('loading');
      try {
        const res = await fetch(`/v1/world/rss-proxy?url=${encodeURIComponent(feedUrl)}`);
        if (cancelled) return;
        if (res.status === 403) {
          setErrorText('Domain not in the allowlist');
          setState('error');
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parseFeedItems(await res.text());
        if (cancelled) return;
        if (!parsed.length) {
          setEmptyText('No items');
          setState('empty');
          return;
        }
        setItems(parsed);
        setState('ready');
      } catch {
        if (cancelled) return;
        setErrorText('Failed to load feed');
        setState('error');
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [feedUrl, initialXml]);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={title}
      state={state}
      emptyText={emptyText}
      errorText={errorText}
      actions={
        state === 'ready' ? (
          <SizableText size="$1" color="$color9">
            {items.length}
          </SizableText>
        ) : undefined
      }
    >
      <YStack>
        {items.map((item, i) => (
          <FeedRow key={`${item.link || item.title}-${i}`} item={item} />
        ))}
      </YStack>
    </Panel>
  );
}

function FeedRow({ item }: { item: FeedItem }): React.JSX.Element {
  const when = item.date ? new Date(item.date) : null;
  const ago = when && !Number.isNaN(when.getTime()) ? relTime(when) : '';
  const href = item.link ? sanitizeUrl(item.link) : '';

  const body = (
    <YStack
      paddingVertical="$2"
      paddingHorizontal="$1"
      borderBottomWidth={1}
      borderColor="rgba(255,255,255,0.06)"
      gap="$1"
    >
      <SizableText size="$2" color="$color11">
        {item.title}
      </SizableText>
      {ago ? (
        <SizableText size="$1" color="$color9" fontFamily="$mono">
          {ago}
        </SizableText>
      ) : null}
    </YStack>
  );

  // The `data-ctx-*` attributes keep the analyst's right-click context wiring intact;
  // sanitizeUrl gates the href to http(s)/relative just as the vanilla panel does.
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      data-ctx-url={href}
      data-ctx-headline={item.title}
      style={{ textDecoration: 'none' }}
    >
      {body}
    </a>
  ) : (
    <div data-ctx-headline={item.title}>{body}</div>
  );
}

// ─── data logic, carried over verbatim from the vanilla CustomFeedPanel ───

function parseFeedItems(xml: string): FeedItem[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) return [];
  let nodes = doc.querySelectorAll('item');
  const isAtom = nodes.length === 0;
  if (isAtom) nodes = doc.querySelectorAll('entry');
  return Array.from(nodes)
    .slice(0, 20)
    .map((n) => {
      const title = n.querySelector('title')?.textContent?.trim() || '';
      const link = isAtom
        ? n.querySelector('link[href]')?.getAttribute('href') || ''
        : n.querySelector('link')?.textContent?.trim() || '';
      const date =
        n.querySelector('pubDate')?.textContent?.trim() ||
        n.querySelector('updated')?.textContent?.trim() ||
        n.querySelector('published')?.textContent?.trim() ||
        '';
      return { title, link, date };
    })
    .filter((i) => i.title);
}

function relTime(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
