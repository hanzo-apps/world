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
    // Primary render depends ONLY on pulse + models (both fast). The chain-scale
    // tiles come from getChainNodes, which can be slow on a cold cache while
    // unreachable L1 RPCs time out — so it is fetched independently and folded in
    // when ready. It must never gate the overview's first paint (that was the
    // "stuck on Loading" bug: awaiting all three blocked render on the slow one).
    try {
      const [pulse, models] = await Promise.all([getCloudPulse(), getCloudModels()]);
      this.pulse = pulse;
      this.realModels = models && models.totalModels > 0 ? models.totalModels : null;
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'failed';
    }
    this.render();
    void this.fetchChains();
  }

  private async fetchChains(): Promise<void> {
    const chains = await getChainNodes();
    if (chains) { this.chains = chains; this.render(); }
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

    // Live badge only when the volume is the exact MEASURED ledger. Real-but-partial
    // (public rate/throughput, no token volume) and empty both drop it — never a live
    // badge over a number that is not fully measured (keys on demo AND volumeModeled).
    const live = !p.demo && !p.volumeModeled;
    if (live) this.setDataBadge('live'); else this.clearDataBadge();

    const modelsServed = this.realModels ?? o.modelsServed;
    const fallback = !p.demo && p.volumeModeled; // real rate/throughput, tokens unmeasured
    const dash = '—';
    // Volume tiles show a real number or an honest "—": nothing when nothing is
    // measured (demo), and no token count on the public fallback (volumeModeled ⇒
    // tokens blank). Count/uptime tiles render only when they carry a real value
    // (>0) — an unmeasured metric is honestly omitted, never shown as a 0.
    const tiles = [
      statTile(p.demo ? dash : fmtCompact(o.requestsPerSec), 'requests / sec', fallback ? 'measured' : undefined),
      statTile(p.demo ? dash : fmtCompact(o.requests24h), `requests / ${p.window}`),
      statTile(p.volumeModeled ? dash : fmtCompact(o.tokens24h), `tokens / ${p.window}`, fallback ? 'ledger only' : undefined),
      modelsServed > 0 ? statTile(fmtInt(modelsServed), 'models served', this.realModels ? 'live' : undefined) : '',
      this.chainTiles(),
      o.nodesTotal > 0 ? statTile(`${fmtInt(o.nodesOnline)}/${fmtInt(o.nodesTotal)}`, 'nodes online') : '',
      o.gpusOnline > 0 ? statTile(fmtInt(o.gpusOnline), 'GPUs online') : '',
      o.regions > 0 ? statTile(fmtInt(o.regions), 'regions') : '',
      o.uptimePct > 0 ? statTile(fmtPct(o.uptimePct), 'uptime') : '',
      // Real platform users/signups/active — present only for a signed-in admin.
      p.users ? statTile(fmtCompact(p.users.total), 'users', p.users.signups24h > 0 ? `+${fmtInt(p.users.signups24h)} / 24h` : undefined) : '',
      p.users && p.users.activeNow > 0 ? statTile(fmtInt(p.users.activeNow), 'active now') : '',
    ].join('');

    // Sparklines only when there is a real series — never a flat line over empties.
    const sparkRow = p.requestSeries.length >= 2
      ? `<div class="cloud-spark-row">
          <span class="cloud-spark-label">requests · last ${p.requestSeries.length}h</span>
          <span class="cloud-spark-wrap">${sparkline(p.requestSeries, 220, 30)}</span>
        </div>`
      : '';
    const signupRow = p.users && p.users.signupSeries.some((v) => v > 0)
      ? `<div class="cloud-spark-row">
          <span class="cloud-spark-label">new users · last ${p.users.signupSeries.length}d</span>
          <span class="cloud-spark-wrap">${sparkline(p.users.signupSeries, 220, 30)}</span>
        </div>`
      : '';

    this.setContent(`
      <div class="cloud-overview">
        <div class="cloud-overview-head">
          <span class="cloud-scope">Global platform</span>
        </div>
        <div class="cloud-stat-grid cloud-stat-grid-8">${tiles}</div>
        ${sparkRow}
        ${signupRow}
      </div>
    `);
  }
}
