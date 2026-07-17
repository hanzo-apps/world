import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { fmtCompact, fmtInt, statTile, shareBar } from '@/utils/cloud-format';
import {
  getDefiOverview, getDefiChains, getDefiProtocols,
  type DefiOverview, type DefiChainsData, type DefiChainRow, type DefiProtocolsData,
} from '@/services/defi';

type SortKey = 'name' | 'blockHeight' | 'txns' | 'tps' | 'tvlUsd' | 'addresses';
type FilterMode = 'all' | 'live' | 'native';

// DeFi board — the DefiLlama-shaped centerpiece of the crypto→DeFi variant. One
// wide panel: a hero of real aggregates (chains, live, transactions, TPS, TVL), a
// sortable + searchable 200-row chain table (Lux-ecosystem chains with live
// metrics leading, then the full bridge-supported universe), and a top-AMM-pools
// strip. Every USD figure the explorer does not populate renders as "—", never a
// fabricated number (the provenance line says which). Rows use content-visibility
// so 190+ rows stay smooth without a bespoke virtual scroller.
export class DefiBoardPanel extends Panel {
  private overview: DefiOverview | null = null;
  private chains: DefiChainRow[] = [];
  private chainsMeta: DefiChainsData | null = null;
  private protocols: DefiProtocolsData | null = null;
  private loaded = false;
  private built = false;

  private query = '';
  private filter: FilterMode = 'all';
  private sortKey: SortKey = 'txns';
  private sortDir: 'asc' | 'desc' = 'desc';

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'defi-board',
      title: 'DeFi',
      showCount: true,
      className: 'panel-wide cloud-panel defi-panel',
      infoTooltip:
        'Live Lux-ecosystem chain metrics from explorer.lux.network (block height, ' +
        'transactions, addresses, computed TPS) merged with the bridge-supported chain ' +
        'universe. USD TVL/prices show "—" until on-chain USD indexing is populated — ' +
        'no figures are fabricated.',
    });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 30_000);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    const [ov, ch, pr] = await Promise.all([getDefiOverview(), getDefiChains(), getDefiProtocols()]);
    if (ov) this.overview = ov;
    if (ch) { this.chains = ch.chains ?? []; this.chainsMeta = ch; }
    if (pr) this.protocols = pr;
    this.loaded = true;
    this.render();
  }

  // ── view model ───────────────────────────────────────────────────────────
  private viewRows(): DefiChainRow[] {
    const q = this.query.trim().toLowerCase();
    let rows = this.chains;
    if (this.filter === 'live') rows = rows.filter((r) => r.live);
    else if (this.filter === 'native') rows = rows.filter((r) => r.native);
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.symbol.toLowerCase().includes(q) || r.slug.includes(q));
    const dir = this.sortDir === 'asc' ? 1 : -1;
    const key = this.sortKey;
    return [...rows].sort((a, b) => {
      if (key === 'name') return dir * a.name.localeCompare(b.name);
      const av = a[key] as number | null;
      const bv = b[key] as number | null;
      // Nulls always sort last regardless of direction (unknown ≠ smallest).
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * (av - bv);
    });
  }

  // ── render ────────────────────────────────────────────────────────────────
  private render(): void {
    if (!this.overview && this.chains.length === 0) {
      if (this.loaded) {
        this.built = false;
        this.setContent('<div class="defi-empty">DeFi data unavailable — the Lux explorer is unreachable right now.</div>');
      } else {
        this.showLoading('Loading DeFi board…');
      }
      return;
    }
    this.setDataBadge('live');
    this.setCount(this.chainsMeta?.chainCount ?? this.chains.length);
    if (!this.built) this.buildShell();
    this.renderHero();
    this.renderTable();
    this.renderPools();
  }

  private buildShell(): void {
    this.setContent(`
      <div class="defi-board">
        <div class="defi-hero" data-defi-hero></div>
        <div class="defi-toolbar">
          <input type="search" class="defi-search" data-defi-search placeholder="Filter 190+ chains…" aria-label="Filter chains" />
          <div class="defi-filters" data-defi-filters>
            <button type="button" class="defi-chip" data-filter="all">All</button>
            <button type="button" class="defi-chip" data-filter="live">Live</button>
            <button type="button" class="defi-chip" data-filter="native">Lux</button>
          </div>
        </div>
        <div class="defi-table" role="table">
          <div class="defi-thead" data-defi-head role="row"></div>
          <div class="defi-tbody" data-defi-body></div>
        </div>
        <div class="defi-pools" data-defi-pools></div>
      </div>`);

    const search = this.content.querySelector<HTMLInputElement>('[data-defi-search]');
    search?.addEventListener('input', () => { this.query = search.value; this.renderTable(); });

    this.content.querySelector('[data-defi-filters]')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.defi-chip');
      if (!btn) return;
      this.filter = (btn.dataset.filter as FilterMode) || 'all';
      this.renderFilters();
      this.renderTable();
    });

    this.content.querySelector('[data-defi-head]')?.addEventListener('click', (e) => {
      const col = (e.target as HTMLElement).closest<HTMLElement>('[data-sort]');
      if (!col) return;
      const key = col.dataset.sort as SortKey;
      if (this.sortKey === key) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      else { this.sortKey = key; this.sortDir = key === 'name' ? 'asc' : 'desc'; }
      this.renderHead();
      this.renderTable();
    });

    this.renderHead();
    this.renderFilters();
    this.built = true;
  }

  private renderHero(): void {
    const el = this.content.querySelector('[data-defi-hero]');
    if (!el) return;
    const o = this.overview;
    const tiles: string[] = [];
    tiles.push(statTile(usd(o?.totalTvlUsd ?? null), 'total TVL'));
    tiles.push(statTile(usd(o?.volume24hUsd ?? null), '24h volume'));
    tiles.push(statTile(fmtInt(o?.chainCount ?? this.chains.length), 'chains'));
    tiles.push(statTile(fmtInt(o?.liveCount ?? 0), 'live chains'));
    tiles.push(statTile(num(o?.totalTxns ?? null), 'transactions'));
    tiles.push(statTile(o?.aggregateTps == null ? '—' : o.aggregateTps.toFixed(2), 'aggregate TPS'));

    const prov = (o?.tvlProvenance ?? this.chainsMeta?.tvlProvenance) === 'explorer-amm'
      ? 'USD TVL from the Lux AMM subgraph.'
      : 'USD TVL/prices show “—” until on-chain USD indexing is populated — nothing is fabricated.';
    const src = o?.metricsSource ?? this.chainsMeta?.metricsSource ?? 'explorer.lux.network';

    el.innerHTML = `
      <div class="cloud-stat-grid cloud-stat-grid-8 defi-stat-grid">${tiles.join('')}</div>
      <div class="defi-provenance">Live metrics from ${escapeHtml(hostOf(src))} · ${escapeHtml(prov)}</div>`;
  }

  private renderFilters(): void {
    this.content.querySelectorAll<HTMLElement>('.defi-chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.filter === this.filter);
    });
  }

  private renderHead(): void {
    const el = this.content.querySelector('[data-defi-head]');
    if (!el) return;
    const cols: Array<{ key: SortKey; label: string; cls: string }> = [
      { key: 'name', label: 'Chain', cls: 'defi-c-name' },
      { key: 'blockHeight', label: 'Block', cls: 'defi-c-num' },
      { key: 'txns', label: 'Txns', cls: 'defi-c-num' },
      { key: 'tps', label: 'TPS', cls: 'defi-c-num' },
      { key: 'addresses', label: 'Addrs', cls: 'defi-c-num' },
      { key: 'tvlUsd', label: 'TVL', cls: 'defi-c-num' },
    ];
    el.innerHTML = cols.map((c) => {
      const arrow = this.sortKey === c.key ? (this.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      const active = this.sortKey === c.key ? ' active' : '';
      return `<span class="defi-th ${c.cls}${active}" data-sort="${c.key}">${escapeHtml(c.label)}${arrow}</span>`;
    }).join('');
  }

  private renderTable(): void {
    const el = this.content.querySelector('[data-defi-body]');
    if (!el) return;
    const rows = this.viewRows();
    if (rows.length === 0) {
      el.innerHTML = '<div class="defi-empty-row">No chains match your filter.</div>';
      return;
    }
    el.innerHTML = rows.map((r) => this.rowHTML(r)).join('');
  }

  private rowHTML(r: DefiChainRow): string {
    const badge = r.native
      ? '<span class="defi-badge defi-badge-native">L1</span>'
      : '<span class="defi-badge defi-badge-bridge">bridge</span>';
    const dot = r.live ? '<span class="defi-dot live"></span>' : '<span class="defi-dot"></span>';
    return `
      <div class="defi-row" role="row">
        <span class="defi-c-name">
          ${dot}${logoChip(r)}
          <span class="defi-row-name">${escapeHtml(r.name)}</span>
          <span class="defi-row-sym">${escapeHtml(r.symbol)}</span>
          ${badge}
        </span>
        <span class="defi-c-num defi-mono">${num(r.blockHeight)}</span>
        <span class="defi-c-num defi-mono">${num(r.txns)}</span>
        <span class="defi-c-num defi-mono">${r.tps == null ? '—' : r.tps.toFixed(2)}</span>
        <span class="defi-c-num defi-mono">${num(r.addresses)}</span>
        <span class="defi-c-num defi-mono">${usd(r.tvlUsd)}</span>
      </div>`;
  }

  private renderPools(): void {
    const el = this.content.querySelector('[data-defi-pools]');
    if (!el) return;
    const pools = this.protocols?.pools ?? [];
    if (pools.length === 0) {
      el.innerHTML = '<div class="defi-subhead">Top AMM pools</div><div class="defi-empty-row">Pool indexing in progress.</div>';
      return;
    }
    const maxTvl = Math.max(1, ...pools.map((p) => p.tvlUsd ?? 0));
    const rows = pools.slice(0, 8).map((p) => `
      <div class="defi-pool-row">
        <span class="defi-pool-pair">${escapeHtml(p.pair)}</span>
        <span class="defi-pool-chain">${escapeHtml(p.chain)}</span>
        <span class="defi-pool-tvl defi-mono">${usd(p.tvlUsd)}</span>
        ${p.tvlUsd != null ? shareBar((p.tvlUsd ?? 0) / maxTvl) : ''}
      </div>`).join('');
    el.innerHTML = `<div class="defi-subhead">Top AMM pools · ${this.protocols?.poolCount ?? pools.length}</div>${rows}`;
  }
}

// ── formatting + logo helpers ────────────────────────────────────────────────

/** Compact USD; '—' when unknown (null). Dollars in (not cents). */
function usd(n: number | null): string {
  if (n == null) return '—';
  return '$' + fmtCompact(n);
}

/** Compact integer; '—' when unknown (null). */
function num(n: number | null): string {
  if (n == null) return '—';
  return fmtCompact(n);
}

function hostOf(url: string): string {
  try { return new URL(url).host || url; } catch { return url; }
}

/**
 * A logo chip, CSP-safe (no inline JS): bridge chains carry a reliable Lux-CDN
 * logo painted as a cover background; our own chains have no CDN entry, so they
 * render a cyan symbol initial-chip. A rare 404 degrades to an empty dark circle,
 * never a broken-image icon.
 */
function logoChip(r: DefiChainRow): string {
  if (r.logo) {
    return `<span class="defi-logo" style="background-image:url('${encodeURI(r.logo)}')"></span>`;
  }
  const initial = escapeHtml((r.symbol || r.name || '?').slice(0, 1).toUpperCase());
  return `<span class="defi-logo defi-logo-initial">${initial}</span>`;
}
