// Alternative-asset feed panel (art auctions, luxury real estate).
//
// High-end auction results and luxury real-estate listings have no CORS-open
// public API, so the live data is served by the world backend (world-gw =
// cmd/world) which scrapes + caches the real public source hourly, server-side.
// Auctions come from Christie's public "results" (realized sale totals) —
// Sotheby's gates realized prices behind a login, so the public major house is
// the honest source. Luxury real estate comes from LuxuryEstate.com — JamesEdition
// sits behind a Cloudflare challenge that blocks datacenter egress, so it can't
// be fetched from the pod. This panel fetches the endpoint and renders real
// items; if the backend hasn't been provisioned yet (or is unreachable) it shows
// an honest "live feed connecting" state rather than any fabricated listing.
// One component, configured per feed — DRY.

import { escapeHtml } from '@/utils/sanitize';

export interface AltFeedItem {
  title: string;
  subtitle?: string;
  price?: string;
  href?: string;
  imageUrl?: string;
  meta?: string;
}

export interface AltFeedConfig {
  title: string;
  /** Backend endpoint returning { items: AltFeedItem[] }. */
  endpoint: string;
  /** External "see all" link. */
  sourceUrl: string;
  sourceLabel: string;
  emptyHint: string;
}

export class AltFeedPanel {
  private el: HTMLElement;
  constructor(private cfg: AltFeedConfig) {
    this.el = document.createElement('div');
    this.el.className = 'fin-card fin-altfeed';
    this.el.innerHTML = `
      <div class="fin-card-head">
        <span>${escapeHtml(cfg.title)}</span>
        <a class="fin-altfeed-src" href="${cfg.sourceUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(cfg.sourceLabel)} ↗</a>
      </div>
      <div class="fin-altfeed-body" data-state="loading">
        <div class="fin-altfeed-status">Connecting to live feed…</div>
      </div>`;
    void this.load();
  }

  getElement(): HTMLElement { return this.el; }

  private body(): HTMLElement { return this.el.querySelector('.fin-altfeed-body') as HTMLElement; }

  private async load(): Promise<void> {
    try {
      const res = await fetch(this.cfg.endpoint, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { items?: AltFeedItem[] };
      const items = Array.isArray(data.items) ? data.items : [];
      if (items.length === 0) { this.renderPending(); return; }
      this.renderItems(items.slice(0, 12));
    } catch {
      this.renderPending();
    }
  }

  private renderPending(): void {
    const b = this.body();
    b.dataset.state = 'pending';
    b.innerHTML = `
      <div class="fin-altfeed-status">
        <span class="fin-dot"></span> Live feed pending
        <div class="fin-altfeed-hint">${escapeHtml(this.cfg.emptyHint)}</div>
      </div>`;
  }

  private renderItems(items: AltFeedItem[]): void {
    const b = this.body();
    b.dataset.state = 'ready';
    b.innerHTML = items.map((it) => `
      <a class="fin-altfeed-item" ${it.href ? `href="${encodeURI(it.href)}" target="_blank" rel="noopener noreferrer"` : ''}>
        ${it.imageUrl ? `<img class="fin-altfeed-img" loading="lazy" src="${encodeURI(it.imageUrl)}" alt="">` : ''}
        <div class="fin-altfeed-txt">
          <div class="fin-altfeed-title">${escapeHtml(it.title)}</div>
          ${it.subtitle ? `<div class="fin-altfeed-sub">${escapeHtml(it.subtitle)}</div>` : ''}
          <div class="fin-altfeed-row">
            ${it.price ? `<span class="fin-altfeed-price">${escapeHtml(it.price)}</span>` : ''}
            ${it.meta ? `<span class="fin-altfeed-meta">${escapeHtml(it.meta)}</span>` : ''}
          </div>
        </div>
      </a>`).join('');
  }
}

export class AuctionsPanel {
  private p = new AltFeedPanel({
    title: 'Art & Collectibles — Auctions',
    endpoint: '/v1/world/auctions',
    sourceUrl: 'https://www.christies.com/en/results',
    sourceLabel: "Christie's",
    emptyHint: 'Recent Christie’s / major-house realized results stream in here once the world auctions feed is live.',
  });
  getElement(): HTMLElement { return this.p.getElement(); }
}

export class LuxuryRealEstatePanel {
  private p = new AltFeedPanel({
    title: 'Luxury Real Estate',
    endpoint: '/v1/world/luxury-realestate',
    sourceUrl: 'https://www.luxuryestate.com/',
    sourceLabel: 'LuxuryEstate',
    emptyHint: 'Featured LuxuryEstate luxury listings stream in here once the world real-estate feed is live.',
  });
  getElement(): HTMLElement { return this.p.getElement(); }
}
