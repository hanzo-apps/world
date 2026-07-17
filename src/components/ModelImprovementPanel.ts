import { Panel } from './Panel';
import { getRouterHistory, type RouterHistory, type RouterRetrain } from '@/services/router-history';
import { fmtCompact, fmtInt, fmtPct, sparkline, statTile } from '@/utils/cloud-format';

// Model Improvement — the flywheel getting verifiably smarter over time. Reads the
// public router-history aggregate (/v1/world/cloud/router-history): a reward-rate
// line climbing with retrain-version markers, a ticking cumulative cost-saved hero
// (routing vs always-premium), and an adoption sparkline. HONEST EMPTY: the ledger is
// barely lit today, so the chart starts flat and GROWS with real data — never a
// fabricated curve. Every number here is measured from the routing ledger + the
// append-only retrain log; nothing is seeded.
export class ModelImprovementPanel extends Panel {
  private data: RouterHistory | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private shownSaved = 0; // last-rendered hero value, for the count-up
  private countRaf: number | null = null;

  constructor() {
    super({ id: 'model-improvement', title: 'Model Improvement', showCount: false, className: 'panel-wide cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 60_000);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.countRaf) { cancelAnimationFrame(this.countRaf); this.countRaf = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    const d = await getRouterHistory(30);
    if (d) this.data = d;
    this.render();
  }

  // Reward-rate line (0..1) over the window with an area fill and retrain-version
  // markers (vertical ticks). Honest empty: a flat dotted baseline when there is no
  // scored reward yet, never an invented climb.
  private chart(daily: RouterHistory['daily'], retrains: RouterRetrain[]): string {
    const W = 300, H = 96, padB = 14, padT = 8;
    const n = daily.length;
    const plotH = H - padB - padT;
    const dates = daily.map((d) => d.date);
    const x = (i: number): number => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
    const y = (v: number): number => padT + (1 - Math.max(0, Math.min(1, v))) * plotH;
    const rewards = daily.map((d) => d.reward_rate);
    const hasSignal = rewards.some((r) => r > 0);

    // Retrain markers positioned by date index (nearest day column).
    const dateIdx = new Map(dates.map((d, i) => [d, i]));
    const markers = retrains.map((rt) => {
      const i = dateIdx.get(rt.date) ?? (rt.date < (dates[0] ?? '') ? 0 : n - 1);
      const mx = x(Math.max(0, i));
      const acc = rt.holdout_accuracy;
      const tip = `${rt.version || 'retrain'}${acc != null ? ` · acc ${fmtPct(acc * 100, 1)}` : ''}${rt.gate_pass ? ' · gate ✓' : ' · gate ✗'}`;
      const dotY = acc != null ? y(acc) : padT + 2;
      return `<line x1="${mx.toFixed(1)}" y1="${padT}" x2="${mx.toFixed(1)}" y2="${(H - padB).toFixed(1)}" class="fw-retrain-tick"/>
        <circle cx="${mx.toFixed(1)}" cy="${dotY.toFixed(1)}" r="2.4" class="fw-retrain-dot ${rt.gate_pass ? 'pass' : 'fail'}"><title>${tip}</title></circle>`;
    }).join('');

    if (n < 2 || !hasSignal) {
      return `<svg class="fw-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Model reward rate — awaiting scored data">
        <line x1="0" y1="${y(0).toFixed(1)}" x2="${W}" y2="${y(0).toFixed(1)}" class="fw-baseline"/>
        ${markers}
      </svg>
      <div class="fw-empty-note">Flywheel warming up — the reward curve climbs as requests are routed and scored.</div>`;
    }

    const line = rewards.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `0,${(H - padB).toFixed(1)} ${line} ${W},${(H - padB).toFixed(1)}`;
    const first = rewards.find((r) => r > 0) ?? 0;
    const last = rewards[rewards.length - 1] ?? 0;
    const trend = last >= first ? 'climbing' : 'settling';
    return `<svg class="fw-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Model reward rate ${trend}: ${fmtPct(first * 100, 0)} to ${fmtPct(last * 100, 0)} over ${n} days">
      <line x1="0" y1="${y(0.5).toFixed(1)}" x2="${W}" y2="${y(0.5).toFixed(1)}" class="fw-grid"/>
      <polygon points="${area}" class="fw-area"/>
      <polyline points="${line}" class="fw-line"/>
      ${markers}
    </svg>`;
  }

  // Count the hero from its last shown value to the new target (the "ticking" feel).
  private countUp(el: HTMLElement, to: number): void {
    if (this.countRaf) cancelAnimationFrame(this.countRaf);
    const from = this.shownSaved;
    if (from === to) { el.textContent = fmtCompact(to); return; }
    const start = performance.now(), dur = 800;
    const step = (ts: number): void => {
      const p = Math.min(1, (ts - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmtCompact(from + (to - from) * eased);
      if (p < 1) { this.countRaf = requestAnimationFrame(step); } else { this.shownSaved = to; this.countRaf = null; }
    };
    this.countRaf = requestAnimationFrame(step);
  }

  private render(): void {
    const d = this.data;
    if (!d) { this.showLoading('Loading flywheel…'); return; }
    const live = !d.unavailable && d.totals.events > 0;
    if (live) this.setDataBadge('live'); else this.clearDataBadge();

    const t = d.totals;
    const events = t.events || 0;
    const daysActive = t.days_active || 0;
    const rewardPct = fmtPct((t.reward_rate || 0) * 100, 1);
    const adoption = d.daily.map((x) => x.events);
    const latest = d.retrains[d.retrains.length - 1];

    // Cost-saved hero: cumulative routing savings vs an always-premium baseline. It
    // is a proportional $/MTok index summed over routed requests (the public ledger
    // carries no token counts), so it is labeled as an index — honest, not fake $.
    const heroLabel = 'cost saved · routing vs premium';
    const retrainLine = latest
      ? `<div class="fw-retrain-latest">Last spark <b>${latest.version || '—'}</b>${latest.holdout_accuracy != null ? ` · holdout ${fmtPct(latest.holdout_accuracy * 100, 1)}` : latest.gate_metric ? ` · ${latest.gate_metric} ${latest.gate_value.toFixed(3)}` : ''} · gate ${latest.gate_pass ? 'passed' : 'held incumbent'}</div>`
      : `<div class="fw-retrain-latest muted">No retrain logged yet — the 4:20 spark records each fit here.</div>`;

    this.setContent(`
      <div class="cloud-overview fw-panel">
        <div class="fw-hero">
          <div class="fw-hero-value" id="fwHero">0</div>
          <div class="fw-hero-label">${heroLabel}</div>
        </div>
        <div class="cloud-stat-grid cloud-stat-grid-3">
          ${statTile(rewardPct, 'reward rate', `${fmtInt(events)} scored`)}
          ${statTile(fmtInt(daysActive), 'active days')}
          ${statTile(fmtInt(d.retrains.length), 'retrains')}
        </div>
        <div class="fw-chart-wrap">
          <div class="fw-chart-head"><span>reward rate · ${d.window.days || 30}d</span><span class="fw-legend"><i class="fw-dot pass"></i>retrain (gate ✓)</span></div>
          ${this.chart(d.daily, d.retrains)}
        </div>
        ${retrainLine}
        <div class="cloud-spark-row">
          <span class="cloud-spark-label">requests / day · adoption</span>
          <span class="cloud-spark-wrap">${adoption.length >= 2 ? sparkline(adoption, 220, 28) : '<span class="muted">—</span>'}</span>
        </div>
      </div>
    `);

    const hero = this.getElement().querySelector<HTMLElement>('#fwHero');
    if (hero) this.countUp(hero, t.cumulative_cost_saved || 0);
  }
}
