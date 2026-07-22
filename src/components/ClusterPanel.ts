import { Panel } from './Panel';
import { getCloudClusters, type CloudClusters, type ClusterGroup, type ClusterNode } from '@/services/cloud-admin';
import { escapeHtml } from '@/utils/sanitize';
import { fmtInt, statTile, adminOnlyState } from '@/utils/cloud-format';
import { icon } from '@/utils/icons';

// Clusters — the SuperAdmin fleet view of every DOKS + BYO Kubernetes cluster the
// platform runs (hanzo-k8s, adnexus-k8s, …), each grouped with its node pools and
// per-node status. Real, live: /v1/world/cloud/clusters aggregates visor's unified
// k8s noun (server enforces owner==admin, fail-closed 403). Refreshes every 30s so
// nodes coming up / draining track live. Honest "admin only" / "unavailable" states
// — never fabricated nodes.
const readyState = (s: string): boolean =>
  ['active', 'running', 'online', 'ready', 'healthy', ''].includes(s);

export class ClusterPanel extends Panel {
  private data: CloudClusters | null = null;
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'cloud-clusters', title: 'Clusters & Nodes', showCount: true, className: 'panel-wide cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 30_000);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    this.data = await getCloudClusters();
    this.loaded = true;
    this.render();
  }

  private render(): void {
    if (!this.loaded) { this.showLoading('Loading clusters…'); return; }
    const d = this.data;
    if (!d) { this.clearDataBadge(); this.setCount(0); this.setContent(adminOnlyState('The Kubernetes cluster fleet')); return; }
    if (!d.available) {
      this.clearDataBadge();
      this.setCount(0);
      this.setContent(`<div class="cloud-empty">${escapeHtml(d.note || 'Cluster inventory is unavailable right now.')}</div>`);
      return;
    }
    this.setCount(d.totals.clusters);
    const allReady = d.totals.nodes > 0 && d.totals.nodesReady === d.totals.nodes;
    this.setDataBadge(allReady ? 'live' : 'cached', `${d.totals.nodesReady}/${d.totals.nodes} nodes`);
    this.setContent(`
      <div class="cloud-clusters">
        <div class="cloud-overview-head">
          <span class="cloud-scope">${icon('network', 13)} ${fmtInt(d.totals.clusters)} clusters · ${fmtInt(d.totals.nodes)} nodes · ${fmtInt(d.totals.gpus)} GPU</span>
          <span class="cloud-live-note">live · visor</span>
        </div>
        <div class="cloud-stat-grid cloud-stat-grid-4">${this.tiles(d)}</div>
        ${d.clusters.map((c) => this.clusterHtml(c)).join('')}
      </div>
    `);
  }

  private tiles(d: CloudClusters): string {
    return [
      statTile(fmtInt(d.totals.clusters), 'clusters'),
      statTile(`${fmtInt(d.totals.nodesReady)}/${fmtInt(d.totals.nodes)}`, 'nodes ready'),
      statTile(fmtInt(d.totals.gpus), 'GPUs'),
      statTile(fmtInt(d.clusters.reduce((s, c) => s + c.pools.length, 0)), 'node pools'),
    ].join('');
  }

  private clusterHtml(c: ClusterGroup): string {
    const dot = c.nodes > 0 && c.nodesReady === c.nodes ? 'online' : c.nodesReady > 0 ? 'degraded' : 'offline';
    const pools = c.pools.length
      ? `<div class="cloud-cluster-pools">${icon('layers', 10)} ${c.pools.map((p) =>
          `${escapeHtml(p.name || p.size || 'pool')} · ${fmtInt(p.count)}×${escapeHtml(p.size || '—')}${p.autoScale ? ` · auto ${fmtInt(p.minNodes)}–${fmtInt(p.maxNodes)}` : ''}`).join('  ·  ')}</div>`
      : '';
    const nodes = c.nodeList.length
      ? c.nodeList.map((n) => this.nodeHtml(n)).join('')
      : '';
    return `<div class="cloud-cluster-group">
      <div class="cloud-cluster-head">
        <span class="cloud-status-dot ${dot}"></span>
        <span class="cloud-cluster-name">${escapeHtml(c.name)}<span class="cloud-cluster-kind">${escapeHtml(c.kind)}</span></span>
        <span class="cloud-cluster-meta">${escapeHtml(c.region || '—')} · ${fmtInt(c.nodesReady)}/${fmtInt(c.nodes)} ready · ${fmtInt(c.gpus)} GPU</span>
      </div>
      ${pools}
      ${nodes}
    </div>`;
  }

  private nodeHtml(n: ClusterNode): string {
    const spec = [n.type, n.gpu ? `${n.gpu} GPU` : ''].filter(Boolean).map(escapeHtml).join(' · ');
    return `<div class="cloud-machine-row">
      <span class="cloud-status-dot ${readyState(n.status) ? 'online' : 'degraded'}"></span>
      <span class="cloud-machine-name">${escapeHtml(n.name)}<span class="cloud-machine-type">${escapeHtml(n.status || '')}</span></span>
      <span class="cloud-machine-gpu">${spec || '—'}</span>
    </div>`;
  }
}
