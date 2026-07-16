import { Panel } from './Panel';
import { streamAiPulse, getAiPulse, type AiUsage, type AiFleet } from '@/services/ai-pulse';
import { escapeHtml } from '@/utils/sanitize';
import { fmtCompact, fmtInt, fmtUsd, statTile, sparkline, shareBar } from '@/utils/cloud-format';

// AI Compute — Hanzo's live inference plane (AI variant). Consumes the
// /v1/world/ai-pulse SSE stream (tokens/s, req/s, spend, top models, fleet) and
// keeps a client-side rolling buffer so the headline rate visibly moves. Falls
// back to polling the same route's JSON snapshot if SSE is unavailable. Honest
// "connecting"/"unavailable" states — never a zero dressed up as live traffic.
export class AiComputePanel extends Panel {
  private usage: AiUsage | null = null;
  private fleet: AiFleet | null = null;
  private state: 'connecting' | 'live' | 'unavailable' = 'connecting';
  private reason: string | undefined;
  private buffer: number[] = [];
  private stop: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly BUF = 60;
  private static readonly POLL_MS = 15_000;

  constructor() {
    super({ id: 'ai-compute', title: 'AI Compute', showCount: false, className: 'panel-wide cloud-panel' });
    this.connect();
  }

  public destroy(): void {
    this.stop?.();
    this.stop = null;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    super.destroy();
  }

  // SSE first; a stream error drops us to polling the JSON snapshot (one transport
  // at a time — no double feed).
  private connect(): void {
    this.stop = streamAiPulse({
      onUsage: (u) => { this.usage = u; this.pushRate(u.requestsPerSec); this.state = 'live'; this.reason = undefined; this.render(); },
      onFleet: (f) => { this.fleet = f; this.render(); },
      onStatus: (state, reason) => {
        this.state = state === 'live' ? 'live' : state === 'unavailable' ? 'unavailable' : this.state;
        if (state === 'unavailable') { this.reason = reason; }
        this.render();
      },
      onError: () => this.startPolling(),
    });
  }

  private startPolling(): void {
    this.stop?.();
    this.stop = null;
    if (this.pollTimer) return;
    const tick = async () => {
      try {
        const p = await getAiPulse();
        this.state = p.state === 'live' ? 'live' : 'unavailable';
        this.reason = p.reason;
        if (p.usage) { this.usage = p.usage; this.pushRate(p.usage.requestsPerSec); }
        if (p.fleet) { this.fleet = p.fleet; }
      } catch {
        if (!this.usage && !this.fleet) { this.state = 'unavailable'; this.reason = 'telemetry unreachable'; }
      }
      this.render();
    };
    void tick();
    this.pollTimer = setInterval(() => void tick(), AiComputePanel.POLL_MS);
  }

  private pushRate(rps: number): void {
    this.buffer.push(rps);
    if (this.buffer.length > AiComputePanel.BUF) this.buffer.shift();
  }

  private render(): void {
    if (!this.usage && !this.fleet) {
      if (this.state === 'unavailable') {
        this.clearDataBadge();
        this.setContent(`<div class="cloud-admin-gate">
          <div class="cloud-admin-gate-title">Compute telemetry unavailable</div>
          <div class="cloud-admin-gate-body">${escapeHtml(this.reason || 'The inference plane is not reachable right now.')}</div>
        </div>`);
        return;
      }
      this.showLoading('Connecting…');
      return;
    }

    // Live dot only when truly live (no jewelry when degraded).
    if (this.state === 'live') this.setDataBadge('live', 'stream'); else this.clearDataBadge();

    const u = this.usage;
    const f = this.fleet;
    const win = u?.window || '24h';
    const tiles: string[] = [];
    if (u) {
      tiles.push(statTile(fmtCompact(u.tokensPerSec), 'tokens / sec'));
      tiles.push(statTile(fmtCompact(u.requestsPerSec), 'requests / sec'));
      tiles.push(statTile(fmtCompact(u.tokens24h), `tokens / ${win}`));
      tiles.push(statTile(fmtCompact(u.requests24h), `requests / ${win}`));
      tiles.push(statTile(fmtUsd(u.spendCents), `spend / ${win}`));
    }
    if (f) {
      tiles.push(statTile(fmtInt(f.gpus), 'GPUs'));
      tiles.push(statTile(`${fmtInt(f.machinesOnline)}/${fmtInt(f.machines)}`, 'machines online'));
      tiles.push(statTile(fmtInt(f.modelsServed), 'models served'));
    }

    const spark = this.buffer.length >= 2 ? sparkline(this.buffer, 240, 32) : '';
    const models = (u?.models ?? []).slice(0, 6);
    const maxReq = Math.max(...models.map((m) => m.requests24h), 1);
    const modelRows = models.map((m) => `
      <div class="cloud-model-row">
        <div class="cloud-model-head">
          <span class="cloud-model-name">${escapeHtml(m.name)}</span>
          <span class="cloud-model-req">${fmtCompact(m.requests24h)}<span class="cloud-unit">req</span></span>
        </div>
        ${shareBar(m.requests24h / maxReq)}
        <div class="cloud-model-sub">${fmtCompact(m.tokens24h)} tokens · ${(m.share * 100).toFixed(0)}% share</div>
      </div>`).join('');

    this.setContent(`
      <div class="cloud-overview">
        <div class="cloud-overview-head">
          <span class="cloud-scope">Hanzo inference plane${win ? ` · ${win}` : ''}</span>
          ${spark ? `<span class="cloud-spark-wrap">${spark}</span>` : ''}
        </div>
        <div class="cloud-stat-grid cloud-stat-grid-8">${tiles.join('')}</div>
        ${modelRows ? `<div class="cloud-subhead">Top models</div><div class="cloud-model-list">${modelRows}</div>` : ''}
      </div>
    `);
  }
}
