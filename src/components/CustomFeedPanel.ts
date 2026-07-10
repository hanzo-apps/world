import { Panel } from './Panel';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

/**
 * A user-added RSS/Atom feed panel — created on demand by the AI analyst's
 * add_feed_panel action. It is backed by the SAME host-allowlisted
 * /v1/world/rss-proxy the built-in feeds use, so the server allowlist is the one
 * SSRF boundary; a blocked domain surfaces here as a quiet inline note rather than
 * a crash. If created with `initialXml`, it renders immediately (the caller has
 * already fetched + allowlist-validated the feed).
 */
export class CustomFeedPanel extends Panel {
  constructor(feedKey: string, title: string, private readonly feedUrl: string, initialXml?: string) {
    super({ id: feedKey, title, showCount: true, trackActivity: false });
    if (initialXml) this.renderXml(initialXml);
    else void this.load();
  }

  public async refresh(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.showLoading();
    try {
      const res = await fetch(`/v1/world/rss-proxy?url=${encodeURIComponent(this.feedUrl)}`);
      if (res.status === 403) {
        this.showError('Domain not in the allowlist');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.renderXml(await res.text());
    } catch {
      this.showError('Failed to load feed');
    }
  }

  private renderXml(xml: string): void {
    const items = parseFeedItems(xml);
    if (!items.length) {
      this.setContent('<div class="empty-state">No items</div>');
      this.setCount(0);
      return;
    }
    this.setContent(`<div class="custom-feed-list">${items.map(renderItem).join('')}</div>`);
    this.setCount(items.length);
  }
}

interface FeedItem {
  title: string;
  link: string;
  date: string;
}

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

function renderItem(i: FeedItem): string {
  const when = i.date ? new Date(i.date) : null;
  const ago = when && !Number.isNaN(when.getTime()) ? relTime(when) : '';
  const inner =
    `<div class="custom-feed-title">${escapeHtml(i.title)}</div>` +
    (ago ? `<div class="custom-feed-time">${escapeHtml(ago)}</div>` : '');
  return i.link
    ? `<a class="custom-feed-item" href="${sanitizeUrl(i.link)}" target="_blank" rel="noopener" data-ctx-url="${sanitizeUrl(i.link)}" data-ctx-headline="${escapeHtml(i.title)}">${inner}</a>`
    : `<div class="custom-feed-item" data-ctx-headline="${escapeHtml(i.title)}">${inner}</div>`;
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
