import { Panel } from './Panel';
import { getTrafficGlobe, type TrafficGlobeData } from '@/services/cloud-map';
import { fmtCompact, fmtInt, statTile } from '@/utils/cloud-format';

// Live request-geo throughput — the companion tile to the Hanzo-mode globe. Reads
// the native aggregate (/v1/world/cloud/traffic-globe → the ai backend's
// /v1/traffic/globe): headline request rates + the top origin countries. Aggregates
// only, no IPs. HONEST empty state: before any traffic is recorded (or before the ai
// release lands) it shows zeroes + a "no traffic yet" note, never fabricated data.
export class TrafficGlobePanel extends Panel {
  private data: TrafficGlobeData | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'traffic-globe', title: 'Live Traffic', showCount: false, className: 'panel-wide cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 12_000);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    const d = await getTrafficGlobe();
    if (d) this.data = d;
    this.render();
  }

  /** ISO-3166 alpha-2 → regional-indicator flag emoji (no asset needed). */
  private flag(cc: string): string {
    if (!/^[A-Za-z]{2}$/.test(cc)) return '';
    const base = 0x1f1e6;
    return String.fromCodePoint(base + cc.toUpperCase().charCodeAt(0) - 65, base + cc.toUpperCase().charCodeAt(1) - 65);
  }

  /** Rates read naturally: 2 decimals under 1k, compact above. */
  private fmtRate(n: number): string {
    return n >= 1000 ? fmtCompact(n) : (Math.round(n * 100) / 100).toString();
  }

  private render(): void {
    const d = this.data;
    if (!d) { this.showLoading('Loading traffic…'); return; }
    const live = d.live && d.points.length > 0;
    if (live) this.setDataBadge('live'); else this.clearDataBadge();

    const t = d.totals;
    const tiles = [
      statTile(this.fmtRate(t.rps_1m), 'requests / sec', '1m'),
      statTile(this.fmtRate(t.rpm_60m), 'requests / min', '60m avg'),
      statTile(fmtInt(d.points.length), 'active regions'),
    ].join('');

    // Only real ISO-3166 alpha-2 codes: upstream geo occasionally leaks malformed
    // tokens (`u=`, `ᐢN`, bare digits) — drop them rather than render garbage flags.
    const rows = (t.top_countries ?? [])
      .filter((c) => /^[A-Za-z]{2}$/.test(c.country))
      .slice(0, 8)
      .map((c) => `
      <div class="traffic-row">
        <span class="traffic-cc">${this.flag(c.country)} ${c.country.toUpperCase()}</span>
        <span class="traffic-cnt">${fmtInt(c.count)}</span>
      </div>`).join('');

    const body = live
      ? `<div class="traffic-top">${rows}</div>`
      : `<div class="cloud-empty">No live traffic yet — points light up as requests hit api.hanzo.ai.</div>`;

    this.setContent(`
      <div class="cloud-overview">
        <div class="cloud-overview-head"><span class="cloud-scope">api.hanzo.ai · last ${d.window.minutes || 60}m</span></div>
        <div class="cloud-stat-grid cloud-stat-grid-3">${tiles}</div>
        ${body}
      </div>
    `);
  }
}
