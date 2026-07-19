import { Panel } from './Panel';
import { getRouterStats, type RouterStats } from '@/services/router-stats';
import { getCloudModels, type CloudModels } from '@/services/cloud-admin';
import { escapeHtml } from '@/utils/sanitize';
import { fmtCompact, fmtPct, fmtAgo, statTile, sparkline } from '@/utils/cloud-format';

// Enso Live Training — a live window into the learned router that Hanzo trains on
// its own routing decisions. The AGGREGATES are the PUBLIC platform telemetry
// (/v1/world/cloud/router-stats → ai /v1/router/stats?scope=platform): throughput,
// learned-engine share, a blended-price cost-saved proxy and the last retrain gate.
// The MODELS it serves and trains across are the REAL served catalog
// (/v1/world/cloud/models → ai /v1/models): real model names, tiers, context and
// pricing — never opaque "arm-N" labels or fabricated numbers (the platform relabels
// per-arm routing to opaque ids upstream, so we show the real catalog instead of a
// meaningless arm mix). An unreachable feed shows a muted "connecting…".

/** Normalize a metric that may arrive as a 0..1 fraction OR an already-scaled
 * percent into a 0..100 percent. engine_share/shadow_agreement are fractions;
 * being defensive keeps the display honest if the upstream units shift. */
function pctOf(v: number): number {
  return Math.abs(v) <= 1 ? v * 100 : v;
}

/** A gate number: keep a little precision for sub-1 metrics, trim otherwise. */
function fmtGate(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(2);
}

/** $/M-token price, compact but honest (0 = not priced). */
function fmtPrice(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '';
  return v < 10 ? v.toFixed(2) : v.toFixed(0);
}

export class EnsoTrainingPanel extends Panel {
  private stats: RouterStats | null = null;
  private models: CloudModels | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly hours = 24;

  constructor() {
    super({
      id: 'enso-training',
      title: 'Enso Live Training',
      showCount: false,
      className: 'cloud-panel',
      infoTooltip:
        'Hanzo Cloud — the learned router, live. Platform-wide aggregates from the router that continually retrains on its own routing decisions (throughput, learned-engine share, a blended-price cost-saved proxy, the latest retrain gate), plus the REAL model catalog it serves and trains across — real names, tiers, context and pricing from the public /v1/models. No fabricated numbers.',
    });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 30_000);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    // Router-stats throws on failure; the models catalog returns null. Fetch them
    // independently (allSettled) so one being down never blanks the other, and only
    // store real payloads — render() never sees fabricated numbers.
    const [statsRes, modelsRes] = await Promise.allSettled([
      getRouterStats(this.hours),
      getCloudModels(),
    ]);
    if (statsRes.status === 'fulfilled' && !statsRes.value.unavailable) {
      this.stats = statsRes.value;
    } else if (statsRes.status === 'rejected') {
      console.error('[EnsoTraining] router-stats refresh failed:', statsRes.reason);
    }
    if (modelsRes.status === 'fulfilled' && modelsRes.value && modelsRes.value.models.length) {
      this.models = modelsRes.value;
    }
    this.render();
  }

  /** The REAL served models — the catalog the router trains across. Real names,
   *  tiers, providers, context and pricing; never opaque arms or fake amounts. */
  private modelRows(): string {
    const m = this.models;
    if (!m) return '';
    return m.models.map((mod) => {
      const tier = mod.tier ? `<span class="cloud-tag">${escapeHtml(mod.tier)}</span>` : '';
      const parts: string[] = [];
      if (mod.provider) parts.push(escapeHtml(mod.provider));
      if (mod.context > 0) parts.push(`${fmtCompact(mod.context)} ctx`);
      const inP = fmtPrice(mod.inPrice);
      const outP = fmtPrice(mod.outPrice);
      if (inP && outP) parts.push(`$${inP} / $${outP} per M`);
      const sub = parts.join(' · ');
      return `<div class="cloud-model-row">
        <div class="cloud-model-head">
          <span class="cloud-model-name">${escapeHtml(mod.name)}${tier}</span>
        </div>
        ${sub ? `<div class="cloud-model-sub">${sub}</div>` : ''}
      </div>`;
    }).join('');
  }

  private modelsSection(): string {
    const m = this.models;
    if (!m || !m.models.length) {
      return `<div class="cloud-util-note">Loading the served-model catalog…</div>`;
    }
    const zen = m.zenModels > 0 ? ` · ${fmtCompact(m.zenModels)} Zen` : '';
    return `<div class="cloud-live-note">${fmtCompact(m.totalModels)} models served${zen}</div>
      <div class="cloud-model-list">${this.modelRows()}</div>`;
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

        <div class="cloud-subhead">Models served &amp; trained across</div>
        ${this.modelsSection()}

        <div class="cloud-subhead">Last retrain &amp; gate</div>
        ${this.retrainLine()}
      </div>
    `);
  }
}
