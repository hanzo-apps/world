import { Panel } from './Panel';
import { mlWorker } from '@/services/ml-worker';
import { isMobileDevice } from '@/utils';
import { escapeHtml } from '@/utils/sanitize';
import type { ClusteredEvent } from '@/types';

interface NEREntity {
  text: string;
  type: string;
  confidence: number;
}

export class InsightsPanel extends Panel {
  private isHidden = false;

  constructor() {
    super({
      id: 'insights',
      title: 'AI INSIGHTS',
      showCount: false,
      infoTooltip: `
        <strong>AI-Powered Analysis</strong><br>
        Uses local ML models for:<br>
        • <strong>Themes</strong>: Top story clusters<br>
        • <strong>Entities</strong>: People, orgs, locations<br>
        • <strong>Sentiment</strong>: News tone analysis<br>
        <em>Desktop only • Models run in browser</em>
      `,
    });

    if (isMobileDevice()) {
      this.hide();
      this.isHidden = true;
    }
  }

  public async updateInsights(clusters: ClusteredEvent[]): Promise<void> {
    if (this.isHidden || !mlWorker.isAvailable || clusters.length === 0) {
      this.setContent('<div class="insights-unavailable">ML features unavailable</div>');
      return;
    }

    this.showLoading();

    try {
      const topClusters = clusters.slice(0, 5);
      const titles = topClusters.map(c => c.primaryTitle);

      const [summaries, sentiments] = await Promise.all([
        mlWorker.summarize(titles).catch(() => null),
        mlWorker.classifySentiment(titles).catch(() => null),
      ]);

      const allTitles = clusters.slice(0, 20).map(c => c.primaryTitle).join('. ');
      const entitiesResult = await mlWorker.extractEntities([allTitles]).catch(() => null);
      const entities = entitiesResult?.[0] ?? [];

      this.renderInsights(topClusters, summaries, sentiments, entities);
    } catch (error) {
      console.error('[InsightsPanel] Error:', error);
      this.setContent('<div class="insights-error">Analysis failed</div>');
    }
  }

  private renderInsights(
    clusters: ClusteredEvent[],
    summaries: string[] | null,
    sentiments: Array<{ label: string; score: number }> | null,
    entities: NEREntity[]
  ): void {
    const themesHtml = this.renderThemes(clusters, summaries, sentiments);
    const entitiesHtml = this.renderEntities(entities);
    const sentimentOverview = this.renderSentimentOverview(sentiments);

    this.setContent(`
      ${sentimentOverview}
      <div class="insights-section">
        <div class="insights-section-title">TOP THEMES</div>
        ${themesHtml}
      </div>
      <div class="insights-section">
        <div class="insights-section-title">KEY ENTITIES</div>
        ${entitiesHtml}
      </div>
    `);
  }

  private renderThemes(
    clusters: ClusteredEvent[],
    summaries: string[] | null,
    sentiments: Array<{ label: string; score: number }> | null
  ): string {
    return clusters.map((cluster, i) => {
      const summary = summaries?.[i];
      const sentiment = sentiments?.[i];
      const sentimentClass = sentiment?.label === 'negative' ? 'negative' :
        sentiment?.label === 'positive' ? 'positive' : 'neutral';

      return `
        <div class="insight-theme">
          <div class="insight-theme-title">
            <span class="insight-sentiment-dot ${sentimentClass}"></span>
            ${escapeHtml(cluster.primaryTitle.slice(0, 80))}${cluster.primaryTitle.length > 80 ? '...' : ''}
          </div>
          ${summary ? `<div class="insight-summary">${escapeHtml(summary)}</div>` : ''}
          <div class="insight-meta">${cluster.sourceCount} sources</div>
        </div>
      `;
    }).join('');
  }

  private renderEntities(entities: NEREntity[]): string {
    if (!entities.length) {
      return '<div class="insights-empty">No entities detected</div>';
    }

    const grouped = this.groupEntities(entities);
    const sections: string[] = [];

    if (grouped.PER.length > 0) {
      sections.push(`
        <div class="entity-group">
          <span class="entity-group-label">People:</span>
          ${grouped.PER.slice(0, 5).map(e =>
            `<span class="entity-pill person">${escapeHtml(e.text)}</span>`
          ).join('')}
        </div>
      `);
    }

    if (grouped.ORG.length > 0) {
      sections.push(`
        <div class="entity-group">
          <span class="entity-group-label">Organizations:</span>
          ${grouped.ORG.slice(0, 5).map(e =>
            `<span class="entity-pill organization">${escapeHtml(e.text)}</span>`
          ).join('')}
        </div>
      `);
    }

    if (grouped.LOC.length > 0) {
      sections.push(`
        <div class="entity-group">
          <span class="entity-group-label">Locations:</span>
          ${grouped.LOC.slice(0, 5).map(e =>
            `<span class="entity-pill location">${escapeHtml(e.text)}</span>`
          ).join('')}
        </div>
      `);
    }

    return sections.join('') || '<div class="insights-empty">No entities detected</div>';
  }

  private groupEntities(entities: NEREntity[]): { PER: NEREntity[]; ORG: NEREntity[]; LOC: NEREntity[]; MISC: NEREntity[] } {
    const grouped = { PER: [] as NEREntity[], ORG: [] as NEREntity[], LOC: [] as NEREntity[], MISC: [] as NEREntity[] };
    const seen = new Set<string>();

    for (const entity of entities) {
      if (!entity.type || !entity.text || entity.confidence < 0.7) continue;
      const key = `${entity.type}:${entity.text.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const type = entity.type.toUpperCase() as keyof typeof grouped;
      if (type in grouped) {
        grouped[type].push(entity);
      } else {
        grouped.MISC.push(entity);
      }
    }

    return grouped;
  }

  private renderSentimentOverview(sentiments: Array<{ label: string; score: number }> | null): string {
    if (!sentiments?.length) return '';

    const counts = { positive: 0, neutral: 0, negative: 0 };
    for (const s of sentiments) {
      if (s.label === 'positive') counts.positive++;
      else if (s.label === 'negative') counts.negative++;
      else counts.neutral++;
    }

    const total = sentiments.length;
    const dominant = counts.negative > counts.positive ? 'negative' :
      counts.positive > counts.negative ? 'positive' : 'neutral';

    return `
      <div class="insights-sentiment-overview ${dominant}">
        <div class="sentiment-bar">
          <div class="sentiment-segment negative" style="width: ${(counts.negative / total) * 100}%"></div>
          <div class="sentiment-segment neutral" style="width: ${(counts.neutral / total) * 100}%"></div>
          <div class="sentiment-segment positive" style="width: ${(counts.positive / total) * 100}%"></div>
        </div>
        <div class="sentiment-labels">
          <span class="negative">${counts.negative}</span>
          <span class="neutral">${counts.neutral}</span>
          <span class="positive">${counts.positive}</span>
        </div>
      </div>
    `;
  }
}
