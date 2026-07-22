import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { sparkline as baseSparkline } from '@/utils/market-format';

// Realtime news-sentiment panel — consumes /v1/world/sentiment (GDELT tone).
// Global gauge + per-topic tiles + per-region bars, all 0-100 sentiment index
// with 24h sparklines and velocity. Monochrome, Geist Mono numerics.

interface Reading {
  tone: number | null;
  index: number | null;
  label: string;
  velocity: number | null;
  sparkline: number[];
}

interface Region extends Reading {
  code: string;
  name: string;
}

interface SentimentData {
  timestamp: string;
  status?: string;
  global: Reading;
  topics: Record<string, Reading>;
  regions: Region[];
  coverage?: { queried: number; resolved: number };
}

const TOPIC_LABELS: Record<string, string> = {
  markets: 'Markets',
  conflict: 'Conflict',
  energy: 'Energy',
  tech: 'Tech',
};

function sentClass(index: number | null): string {
  if (index === null) return 'sent-unknown';
  if (index >= 60) return 'sent-positive';
  if (index >= 53) return 'sent-mild';
  if (index > 47) return 'sent-neutral';
  if (index >= 40) return 'sent-cautious';
  return 'sent-negative';
}

function velArrow(v: number | null): string {
  if (v === null || Math.abs(v) < 0.05) return '<span class="sent-vel flat">±0.0</span>';
  const up = v > 0;
  return `<span class="sent-vel ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(v).toFixed(2)}</span>`;
}

function sparkline(data: number[], w = 120, h = 28): string {
  return baseSparkline(data, { w, h, className: 'sent-spark', strokeWidth: 1.5, ariaHidden: false });
}

export class SentimentPanel extends Panel {
  private data: SentimentData | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'sentiment',
      title: t('panels.sentiment'),
      showCount: false,
      infoTooltip:
        'Realtime news-sentiment index from GDELT global article tone. Index = clamp(50 + tone·5, 0-100): 50 neutral, higher = more positive coverage. Velocity is the recent tone change. Updates ~2 min.',
    });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 2 * 60000);
  }

  public destroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    try {
      const res = await fetch('/v1/world/sentiment');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data = await res.json();
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
    } finally {
      this.loading = false;
      this.renderPanel();
    }
  }

  private renderPanel(): void {
    if (this.loading) {
      this.showLoading(t('common.loading'));
      return;
    }
    if (this.error || !this.data) {
      this.showError(this.error || t('common.noDataShort'));
      return;
    }

    const d = this.data;
    const g = d.global;
    const warming = d.status === 'warming' || g.index === null;

    this.setDataBadge(warming ? 'cached' : 'live', warming ? 'warming' : undefined);

    const gaugeVal = g.index === null ? '—' : String(g.index);
    const gauge = `
      <div class="sent-gauge ${sentClass(g.index)}">
        <div class="sent-gauge-main">
          <span class="sent-gauge-value">${gaugeVal}</span>
          <div class="sent-gauge-meta">
            <span class="sent-pill ${sentClass(g.index)}">${escapeHtml(g.label)}</span>
            ${velArrow(g.velocity)}
          </div>
        </div>
        <div class="sent-gauge-spark ${sentClass(g.index)}">${sparkline(g.sparkline, 160, 34)}</div>
      </div>`;

    const topics = Object.keys(TOPIC_LABELS)
      .map((k) => {
        const r = d.topics?.[k];
        if (!r) return '';
        return `
        <div class="sent-topic ${sentClass(r.index)}">
          <div class="sent-topic-head">
            <span class="sent-topic-name">${escapeHtml(TOPIC_LABELS[k] ?? k)}</span>
            <span class="sent-topic-idx">${r.index === null ? '—' : r.index}</span>
          </div>
          <div class="sent-topic-spark ${sentClass(r.index)}">${sparkline(r.sparkline, 90, 20)}</div>
          <div class="sent-topic-foot">
            <span class="sent-pill sm ${sentClass(r.index)}">${escapeHtml(r.label)}</span>
            ${velArrow(r.velocity)}
          </div>
        </div>`;
      })
      .join('');

    const regions = (d.regions ?? [])
      .slice()
      .sort((a, b) => (b.index ?? -1) - (a.index ?? -1))
      .map((r) => {
        const pct = r.index === null ? 0 : Math.max(0, Math.min(100, r.index));
        return `
        <div class="sent-region">
          <span class="sent-region-name">${escapeHtml(r.name)}</span>
          <div class="sent-region-bar">
            <div class="sent-region-fill ${sentClass(r.index)}" style="width:${pct}%"></div>
          </div>
          <span class="sent-region-idx ${sentClass(r.index)}">${r.index === null ? '—' : r.index}</span>
        </div>`;
      })
      .join('');

    const cov = d.coverage ? `${d.coverage.resolved}/${d.coverage.queried} sources` : '';

    this.setContent(`
      <div class="sentiment-container">
        <div class="sent-header-label">Global news sentiment</div>
        ${gauge}
        <div class="sent-section-title">Topics</div>
        <div class="sent-topics">${topics || '<div class="sent-empty">warming…</div>'}</div>
        <div class="sent-section-title">Regions</div>
        <div class="sent-regions">${regions || '<div class="sent-empty">warming…</div>'}</div>
        <div class="sent-foot">${warming ? 'Computing — GDELT paced fetch in progress' : 'GDELT tone · 24h'} ${cov ? '· ' + cov : ''}</div>
      </div>
    `);
  }
}
