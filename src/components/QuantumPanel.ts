import { Panel } from './Panel';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { getQuantumData, type QuantumData } from '@/services/quantum';

const MODALITY_ICON: Record<string, string> = {
  superconducting: '❄️',
  'trapped-ion': '⚛️',
  'neutral-atom': '🔵',
  photonic: '💡',
  'silicon-spin': '🔶',
  annealing: '🌀',
  topological: '🪢',
};

export class QuantumPanel extends Panel {
  private loading = false;
  private lastFetch = 0;
  private readonly REFRESH_MS = 60 * 60 * 1000;

  constructor() {
    super({
      id: 'quantum',
      title: 'Quantum Computing',
      showCount: true,
      infoTooltip: 'Hanzo World Model — Quantum lens: live arXiv quant-ph research plus a curated registry of hardware players and their best publicly-announced scale (snapshot, with year).',
    });
    void this.refresh();
  }

  public async refresh(): Promise<void> {
    if (this.loading) return;
    if (this.lastFetch > 0 && Date.now() - this.lastFetch < this.REFRESH_MS) return;
    this.loading = true;
    try {
      const data = await getQuantumData();
      this.lastFetch = Date.now();
      this.setCount(data.papers.length + data.players.length);
      this.setDataBadge(data.papers.length > 0 ? 'live' : 'cached');
      this.render(data);
    } catch (e) {
      console.error('[Quantum] refresh failed:', e);
      this.showError();
    } finally {
      this.loading = false;
    }
  }

  private render(data: QuantumData): void {
    const papers = data.papers.slice(0, 8);
    const players = [...data.players].sort((a, b) => (b.qubits ?? -1) - (a.qubits ?? -1));

    const paperRows = papers.map((p) => {
      const url = sanitizeUrl(p.link);
      const date = p.published.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `<a class="domain-item" href="${url}" target="_blank" rel="noopener">
        <div class="domain-item-title">${escapeHtml(p.title)}</div>
        <div class="domain-item-meta">🔬 quant-ph · ${date}</div>
      </a>`;
    }).join('');

    const playerRows = players.map((p) => {
      const icon = MODALITY_ICON[p.modality] || '⚛️';
      const link = p.url ? ` · <a href="${sanitizeUrl(p.url)}" target="_blank" rel="noopener">site ↗</a>` : '';
      return `<div class="domain-item">
        <div class="domain-item-title">${icon} ${escapeHtml(p.name)} <span class="domain-tag">${escapeHtml(p.metric)}</span></div>
        <div class="domain-item-meta">${escapeHtml(p.modality)} · ${escapeHtml(p.city)}, ${escapeHtml(p.country)} · as of ${p.asOf}${link}</div>
      </div>`;
    }).join('');

    this.setContent(`
      <div class="domain-panel">
        <div class="domain-insight">${escapeHtml(data.insight)}</div>
        <div class="domain-section-title">Latest research (arXiv quant-ph)</div>
        <div class="domain-list">${paperRows || '<div class="domain-empty">Research feed unavailable</div>'}</div>
        <div class="domain-section-title">Hardware players &amp; scale</div>
        <div class="domain-list">${playerRows}</div>
        <div class="domain-footer"><span>arXiv quant-ph + curated registry</span><span>${new Date(this.lastFetch).toLocaleTimeString()}</span></div>
      </div>
    `);
  }
}
