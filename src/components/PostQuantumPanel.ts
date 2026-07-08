import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getPostQuantumData, type PostQuantumData } from '@/services/post-quantum';
import type { PQReadinessStatus } from '@/config/post-quantum';

const STATUS_SEV: Record<PQReadinessStatus, string> = {
  'pq-native': 'sev-info',
  deployed: 'sev-low',
  'in-progress': 'sev-elevated',
  planned: 'sev-high',
  lagging: 'sev-critical',
};

const STATUS_LABEL: Record<PQReadinessStatus, string> = {
  'pq-native': 'PQ-NATIVE',
  deployed: 'DEPLOYED',
  'in-progress': 'IN PROGRESS',
  planned: 'PLANNED',
  lagging: 'LAGGING',
};

export class PostQuantumPanel extends Panel {
  constructor() {
    super({
      id: 'post-quantum',
      title: 'Post-Quantum Readiness',
      showCount: true,
      infoTooltip: 'Hanzo World Model — Post-Quantum lens: NIST PQC standards (ML-KEM/ML-DSA/SLH-DSA), the NSA CNSA 2.0 timeline, and deployment status across governments, clouds and chains. Lux & Hanzo are PQ-native.',
    });
    this.render(getPostQuantumData());
  }

  public refresh(): void {
    this.render(getPostQuantumData());
  }

  private render(data: PostQuantumData): void {
    this.setCount(data.readiness.length);
    this.setDataBadge('cached', 'curated');

    const standardRows = data.standards.map((s) => `
      <div class="domain-item">
        <div class="domain-item-title">🔐 ${escapeHtml(s.id)} · ${escapeHtml(s.name)} <span class="domain-tag">${escapeHtml(s.status)}</span></div>
        <div class="domain-item-meta">${escapeHtml(s.basedOn)} · ${escapeHtml(s.kind)} · ${s.year} — ${escapeHtml(s.note)}</div>
      </div>`).join('');

    const readinessRows = data.readiness.map((r) => `
      <div class="domain-item">
        <div class="domain-item-title">${escapeHtml(r.org)} <span class="domain-tag ${STATUS_SEV[r.status]}">${STATUS_LABEL[r.status]}</span></div>
        <div class="domain-item-meta">${escapeHtml(r.algorithms.join(', '))} — ${escapeHtml(r.detail)}</div>
      </div>`).join('');

    const timelineRows = data.timeline.map((m) => `
      <div class="domain-item">
        <div class="domain-item-title">📅 CNSA 2.0 · ${m.year}</div>
        <div class="domain-item-meta">${escapeHtml(m.milestone)}</div>
      </div>`).join('');

    this.setContent(`
      <div class="domain-panel">
        <div class="domain-insight">${escapeHtml(data.insight)}</div>
        <div class="domain-warn">⚠️ ${escapeHtml(data.harvestNote)}</div>
        <div class="domain-section-title">NIST PQC standards</div>
        <div class="domain-list">${standardRows}</div>
        <div class="domain-section-title">Readiness tracker</div>
        <div class="domain-list">${readinessRows}</div>
        <div class="domain-section-title">CNSA 2.0 timeline</div>
        <div class="domain-list">${timelineRows}</div>
        <div class="domain-footer"><span>NIST FIPS 203/204/205 · NSA CNSA 2.0</span><span>curated</span></div>
      </div>
    `);
  }
}
