import { Panel } from './Panel';
import { getEnsoTraining, type EnsoTraining } from '@/services/enso-training';
import { escapeHtml } from '@/utils/sanitize';
import { fmtInt, fmtPct, statTile, shareBar } from '@/utils/cloud-format';

// Enso flywheel — the router's self-improvement loop for the AI variant. Polls
// /v1/world/enso-training and renders: routing-ledger growth + engine-vs-heuristic
// mix + confidence histogram (live only, needs a service token), and the latest
// enso-bench eval scores (always present). Honest state: when the ledger is
// unreachable the eval scores still render with a quiet note — never a faked mix.
export class EnsoFlywheelPanel extends Panel {
  private data: EnsoTraining | null = null;
  private error: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private static readonly POLL_MS = 30_000;

  constructor() {
    super({ id: 'enso-flywheel', title: 'Enso Flywheel', showCount: false, className: 'panel-wide cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), EnsoFlywheelPanel.POLL_MS);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    try {
      this.data = await getEnsoTraining();
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'failed';
    }
    this.render();
  }

  private render(): void {
    if (!this.data && this.error) { this.showError(this.error); return; }
    if (!this.data) { this.showLoading('Loading router telemetry…'); return; }
    const d = this.data;
    const l = d.ledger;

    // Live dot only when the ledger is actually folding (state live).
    if (d.state === 'live') this.setDataBadge('live', 'polled'); else this.clearDataBadge();

    // ── ledger: growth + mix + confidence (live only) ──
    let ledgerSection = '';
    if (l.available) {
      const tiles = [
        statTile(fmtInt(l.total), 'routing decisions', d.window),
        statTile(fmtPct(l.enginePct, 0), 'engine-routed', `${fmtInt(l.heuristic)} heuristic`),
        statTile(fmtInt(l.rewarded), 'rewarded', l.rewarded > 0 ? `avg ${l.avgReward.toFixed(2)}` : undefined),
        statTile(l.avgConfidence.toFixed(2), 'avg confidence'),
      ].join('');
      const maxBucket = Math.max(...l.confidence.map((b) => b.count), 1);
      const hist = l.confidence.map((b) => `
        <div class="cloud-model-row">
          <div class="cloud-model-head">
            <span class="cloud-model-name">${escapeHtml(b.label)}</span>
            <span class="cloud-model-req">${fmtInt(b.count)}</span>
          </div>
          ${shareBar(b.count / maxBucket)}
        </div>`).join('');
      ledgerSection = `
        <div class="cloud-stat-grid cloud-stat-grid-4">${tiles}</div>
        <div class="cloud-subhead">Routing confidence · ${d.window}</div>
        <div class="cloud-model-list">${hist}</div>`;
    } else {
      ledgerSection = `<div class="cloud-live-note">Routing telemetry needs a service token — showing eval scores only.</div>`;
    }

    // ── evals: latest enso-bench scores (always present) ──
    let evalSection = '';
    if (d.evals.systems.length > 0) {
      const rows = d.evals.systems.map((sysRow) => {
        const isEnso = sysRow.system.includes('enso');
        return `<div class="cloud-model-row">
          <div class="cloud-model-head">
            <span class="cloud-model-name">${escapeHtml(sysRow.system)}${isEnso ? '<span class="cloud-tag">enso</span>' : ''}</span>
            <span class="cloud-model-req">${sysRow.accuracyPct.toFixed(1)}<span class="cloud-unit">%</span></span>
          </div>
          ${shareBar(sysRow.accuracyPct / 100)}
          <div class="cloud-model-sub">± ${sysRow.stderrPct.toFixed(1)}% · n=${fmtInt(sysRow.n)}${sysRow.usdEst > 0 ? ` · $${sysRow.usdEst.toFixed(2)}` : ''}</div>
        </div>`;
      }).join('');
      const src = d.evals.source === 'live' ? 'live' : 'snapshot';
      evalSection = `
        <div class="cloud-subhead">Eval · ${escapeHtml(d.evals.bench)} <span class="cloud-live-note">${src}</span></div>
        <div class="cloud-model-list">${rows}</div>`;
    }

    this.setContent(`
      <div class="cloud-overview">
        <div class="cloud-overview-head">
          <span class="cloud-scope">Enso router flywheel</span>
        </div>
        ${ledgerSection}
        ${evalSection}
      </div>
    `);
  }
}
