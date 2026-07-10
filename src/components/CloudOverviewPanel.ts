import { Panel } from './Panel';
import { getCloudPulse, type CloudPulse } from '@/services/cloud-pulse';
import { getCloudModels } from '@/services/cloud-admin';
import { getChainNodes, type ChainNodesData } from '@/services/cloud-map';
import { fmtCompact, fmtInt, fmtPct, statTile, sparkline } from '@/utils/cloud-format';

// Platform-wide overview — the investor/customer hero tile. Renders the public
// aggregate (/v1/world/cloud-pulse): demo-flagged unless a service token is wired
// server-side. Where a REAL public source exists it overrides the demo number:
// the served-model count comes from the real public /v1/models catalog
// (getCloudModels), so "models served" is never demo when the gateway is up.
// Two further tiles are always-real: chains live and total block height, summed
// from the live chain-nodes telemetry (Lux/Zoo/Hanzo + Ethereum + Bitcoin). The
// org's own real numbers live in the Fleet / Model Usage / My Usage panels.
export class CloudOverviewPanel extends Panel {
  private pulse: CloudPulse | null = null;
  private realModels: number | null = null;
  private chains: ChainNodesData | null = null;
  private error: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'cloud-overview', title: 'Cloud Overview', showCount: false, className: 'panel-wide cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 30_000);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    try {
      const [pulse, models, chains] = await Promise.all([getCloudPulse(), getCloudModels(), getChainNodes()]);
      this.pulse = pulse;
      this.realModels = models && models.totalModels > 0 ? models.totalModels : null;
      if (chains) this.chains = chains;
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'failed';
    }
    this.render();
  }

  /** Real chain-scale tiles from the live chain-nodes feed: chains live (of
   * tracked) + summed block height across every live chain. Empty when the feed
   * is unavailable so the grid degrades honestly rather than showing a zero. */
  private chainTiles(): string {
    const nets = this.chains?.networks ?? [];
    if (nets.length === 0) return '';
    const live = nets.filter((n) => n.live);
    const totalHeight = live.reduce((sum, n) => sum + (n.blockHeight || 0), 0);
    const tiles = [statTile(fmtInt(live.length), 'chains live', `${nets.length} tracked`)];
    if (totalHeight > 0) tiles.push(statTile(fmtCompact(totalHeight), 'total block height', 'live'));
    return tiles.join('');
  }

  private render(): void {
    if (!this.pulse && this.error) { this.showError(this.error); return; }
    if (!this.pulse) { this.showLoading('Loading cloud metrics…'); return; }
    const p = this.pulse;
    const o = p.overview;

    // No demo/source pill jewelry — a plain live badge only when the feed is live.
    if (!p.demo) this.setDataBadge('live'); else this.clearDataBadge();

    const modelsServed = this.realModels ?? o.modelsServed;
    const tiles = [
      statTile(fmtCompact(o.requestsPerSec), 'requests / sec', p.volumeModeled ? 'modeled' : undefined),
      statTile(fmtCompact(o.requests24h), `requests / ${p.window}`),
      statTile(fmtCompact(o.tokens24h), `tokens / ${p.window}`),
      statTile(fmtInt(modelsServed), 'models served', this.realModels ? 'live' : undefined),
      statTile(`${fmtInt(o.nodesOnline)}/${fmtInt(o.nodesTotal)}`, 'nodes online'),
      statTile(fmtInt(o.gpusOnline), 'GPUs online'),
      statTile(fmtInt(o.regions), 'regions'),
      statTile(fmtPct(o.uptimePct), 'uptime'),
      this.chainTiles(),
    ].join('');

    this.setContent(`
      <div class="cloud-overview">
        <div class="cloud-overview-head">
          <span class="cloud-scope">Global platform</span>
        </div>
        <div class="cloud-stat-grid cloud-stat-grid-8">${tiles}</div>
        <div class="cloud-spark-row">
          <span class="cloud-spark-label">requests · last ${p.requestSeries.length}h</span>
          <span class="cloud-spark-wrap">${sparkline(p.requestSeries, 220, 30)}</span>
        </div>
      </div>
    `);
  }
}
