import { Panel } from './Panel';
import { getRouterStats, type RouterStats } from '@/services/router-stats';
import { escapeHtml } from '@/utils/sanitize';
import { fmtCompact, fmtPct, fmtAgo, statTile, sparkline, shareBar } from '@/utils/cloud-format';

// Enso Live Training — a live window into the learned router that Hanzo trains on
// its own routing decisions. Data is the PUBLIC platform aggregate
// (/v1/world/cloud/router-stats → ai /v1/router/stats?scope=platform): throughput,
// learned-engine share, per-arm routing mix, cost-saved proxy and the last retrain
// gate. Enso is a PRIVATE closed family — the arms arrive already opaque ("arm-N"),
// so this surface only ever labels them "Enso arm N"; no vendor name is shown or
// inferred. Never fabricates: an unreachable feed shows a muted "connecting…".

/** Normalize a metric that may arrive as a 0..1 fraction OR an already-scaled
 * percent into a 0..100 percent. engine_share/shadow_agreement are fractions;
 * being defensive keeps the display honest if the upstream units shift. */
function pctOf(v: number): number {
  return Math.abs(v) <= 1 ? v * 100 : v;
}

/** "arm-1" → 1; anything without a trailing index sorts last. */
function armIndex(key: string): number {
  const m = key.match(/(\d+)\s*$/);
  return m ? parseInt(m[1]!, 10) : Number.MAX_SAFE_INTEGER;
}

/** A gate number: keep a little precision for sub-1 metrics, trim otherwise. */
function fmtGate(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(2);
}

export class EnsoTrainingPanel extends Panel {
  private stats: RouterStats | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly hours = 24;

  constructor() {
    super({
      id: 'enso-training',
      title: 'Enso Live Training',
      showCount: false,
      className: 'cloud-panel',
      infoTooltip:
        'Hanzo Cloud — the learned router, live. Platform-wide aggregates from the router that continually retrains on its own routing decisions: throughput, learned-engine share, per-arm routing mix, a blended-price cost-saved proxy, and the latest retrain gate. Enso is a private model family — arms are shown opaquely as "Enso arm N".',
    });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 30_000);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    try {
      const next = await getRouterStats(this.hours);
      // Keep last-good data across a transient outage (the proxy flags an
      // unreachable upstream with unavailable:true). Only real payloads are
      // stored, so render() never sees fabricated zeros.
      if (!next.unavailable) this.stats = next;
    } catch (e) {
      // Live ticker: log and keep last-good data; render() holds the muted
      // "connecting…" state when nothing has landed yet. Never fabricate.
      console.error('[EnsoTraining] refresh failed:', e);
    }
    this.render();
  }

  private armRows(): string {
    const s = this.stats!;
    const arms = Object.entries(s.by_model)
      .map(([k, n]) => ({ idx: armIndex(k), n: Number(n) || 0 }))
      .sort((a, b) => a.idx - b.idx);
    const total = arms.reduce((sum, a) => sum + a.n, 0) || 1;
    return arms.map((a) => {
      const label = a.idx === Number.MAX_SAFE_INTEGER ? 'Enso arm' : `Enso arm ${a.idx}`;
      const premium = a.idx === 1 ? '<span class="cloud-tag">premium</span>' : '';
      return `<div class="cloud-model-row">
        <div class="cloud-model-head">
          <span class="cloud-model-name">${escapeHtml(label)}${premium}</span>
          <span class="cloud-model-req">${fmtPct((a.n / total) * 100, 1)}<span class="cloud-unit">share</span></span>
        </div>
        ${shareBar(a.n / total)}
        <div class="cloud-model-sub">${fmtCompact(a.n)} routed</div>
      </div>`;
    }).join('');
  }

  private retrainLine(): string {
    const r = this.stats!.retrain;
    if (!r) return `<div class="cloud-util-note">Awaiting first retrain — the router is still gathering routing events.</div>`;
    const verdict = r.gate_passed ? 'passed' : 'kept incumbent';
    const note = r.note ? ` · ${escapeHtml(r.note)}` : '';
    return `<div class="cloud-util-note">Last retrained ${escapeHtml(fmtAgo(r.trained_time))} ago · ${escapeHtml(r.version)} · gate ${escapeHtml(r.gate_kind)}:${escapeHtml(r.gate_metric)} ${fmtGate(r.gate_value)} vs ${fmtGate(r.gate_base)} → ${verdict}${note}</div>`;
  }

  private render(): void {
    // Never fabricate: until the first real payload lands, hold a muted connecting
    // state rather than render zeros (fetchData drops unavailable payloads, so a
    // transient outage keeps the last-good render instead of blanking).
    if (!this.stats) {
      this.clearDataBadge();
      this.showLoading('Connecting to the Enso router…');
      return;
    }
    this.setDataBadge('live');
    const s = this.stats;
    const q = s.quality;

    const tiles = [
      statTile(fmtPct(s.cost.saved_pct, 1), 'cost saved', `last ${this.hours}h`),
      statTile(fmtPct(pctOf(q.engine_share), 0), 'learned-engine share', 'vs heuristic'),
      statTile(fmtCompact(s.window.events), `events · ${this.hours}h`),
    ].join('');

    const shadow = q.shadow_agreement === null || q.shadow_agreement === undefined
      ? '—'
      : fmtPct(pctOf(q.shadow_agreement), 0);

    this.setContent(`
      <div class="cloud-models">
        <div class="cloud-overview-head">
          <span class="cloud-scope">Learned routing · platform</span>
        </div>
        <div class="cloud-stat-grid cloud-stat-grid-3">${tiles}</div>
        <div class="cloud-live-note">Cumulative saved index ${fmtCompact(s.cost.cumulative_saved_index)} · blended-price proxy (not billed $)</div>
        <div class="cloud-live-note">Shadow-vs-served agreement: ${shadow}</div>

        <div class="cloud-subhead">Routing throughput</div>
        <div class="cloud-spark-row">
          <span class="cloud-spark-label">last ${s.throughput.per_hour.length}h · ${fmtCompact(s.throughput.total_window)} total</span>
          <span class="cloud-spark-wrap">${sparkline(s.throughput.per_hour, 220, 30)}</span>
        </div>

        <div class="cloud-subhead">Per-arm routing share</div>
        <div class="cloud-model-list">${this.armRows()}</div>

        <div class="cloud-subhead">Last retrain &amp; gate</div>
        ${this.retrainLine()}
      </div>
    `);
  }
}
