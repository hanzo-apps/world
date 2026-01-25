import { Panel } from './Panel';
import { mlWorker } from '@/services/ml-worker';
import { isMobileDevice } from '@/utils';
import { escapeHtml } from '@/utils/sanitize';
import type { ClusteredEvent } from '@/types';

export class InsightsPanel extends Panel {
  private isHidden = false;
  private lastBriefUpdate = 0;
  private cachedBrief: string | null = null;
  private static readonly BRIEF_COOLDOWN_MS = 60000; // 1 min cooldown for brief generation

  constructor() {
    super({
      id: 'insights',
      title: 'AI INSIGHTS',
      showCount: false,
      infoTooltip: `
        <strong>AI-Powered Analysis</strong><br>
        Uses local ML models for:<br>
        • <strong>World Brief</strong>: AI summary of top stories<br>
        • <strong>Sentiment</strong>: News tone analysis<br>
        • <strong>Velocity</strong>: Fast-moving stories<br>
        <em>Desktop only • Models run in browser</em>
      `,
    });

    if (isMobileDevice()) {
      this.hide();
      this.isHidden = true;
    }
  }

  private setStatus(message: string, showSpinner = true): void {
    const spinnerHtml = showSpinner ? '<span class="insights-spinner"></span>' : '';
    this.setContent(`
      <div class="insights-status">
        ${spinnerHtml}
        <span class="insights-status-text">${message}</span>
      </div>
    `);
  }

  public async updateInsights(clusters: ClusteredEvent[]): Promise<void> {
    if (this.isHidden) return;

    if (!mlWorker.isAvailable) {
      this.setStatus('Initializing ML models...', true);
      return;
    }

    if (clusters.length === 0) {
      this.setContent('<div class="insights-empty">Waiting for news data...</div>');
      return;
    }

    try {
      // Filter to only important stories: multi-source OR fast-moving OR alerts
      const importantStories = clusters.filter(c =>
        c.sourceCount >= 2 ||
        (c.velocity && c.velocity.level !== 'normal') ||
        c.isAlert
      );

      // Sort by importance: multi-source first, then velocity
      const sortedClusters = importantStories.sort((a, b) => {
        // Alerts first
        if (a.isAlert !== b.isAlert) return a.isAlert ? -1 : 1;
        // Then multi-source
        if (a.sourceCount !== b.sourceCount) return b.sourceCount - a.sourceCount;
        // Then by velocity
        const velA = a.velocity?.sourcesPerHour ?? 0;
        const velB = b.velocity?.sourcesPerHour ?? 0;
        return velB - velA;
      });

      // Take top 8 for analysis
      const importantClusters = sortedClusters.slice(0, 8);

      if (importantClusters.length === 0) {
        this.setContent('<div class="insights-empty">No breaking or multi-source stories yet</div>');
        return;
      }

      const titles = importantClusters.map(c => c.primaryTitle);

      // Show status: analyzing sentiment
      this.setStatus('Analyzing sentiment...');
      const sentiments = await mlWorker.classifySentiment(titles).catch(() => null);

      // Generate World Brief (with cooldown to avoid excessive model calls)
      let worldBrief = this.cachedBrief;
      const now = Date.now();
      if (!worldBrief || now - this.lastBriefUpdate > InsightsPanel.BRIEF_COOLDOWN_MS) {
        this.setStatus('Generating world brief...');
        worldBrief = await this.generateWorldBrief(importantClusters);
        if (worldBrief) {
          this.cachedBrief = worldBrief;
          this.lastBriefUpdate = now;
        }
      }

      this.renderInsights(importantClusters, sentiments, worldBrief);
    } catch (error) {
      console.error('[InsightsPanel] Error:', error);
      this.setContent('<div class="insights-error">Analysis failed - retrying...</div>');
    }
  }

  private async generateWorldBrief(clusters: ClusteredEvent[]): Promise<string | null> {
    if (clusters.length < 2) return null;

    try {
      // Combine top headlines into a single prompt for Flan-T5
      // Format: "Summarize the key themes from these news headlines: ..."
      const headlines = clusters
        .slice(0, 6) // Take top 6 for brief
        .map(c => c.primaryTitle.slice(0, 80)) // Truncate long titles
        .join('. ');

      const prompt = `Summarize the main themes from these news headlines in 2 sentences: ${headlines}`;

      const [summary] = await mlWorker.summarize([prompt]);

      // Clean up the summary - Flan-T5 may return empty or echo input
      if (!summary || summary.length < 20 || summary.toLowerCase().includes('summarize')) {
        return null;
      }

      return summary;
    } catch (error) {
      console.error('[InsightsPanel] Brief generation failed:', error);
      return null;
    }
  }

  private renderInsights(
    clusters: ClusteredEvent[],
    sentiments: Array<{ label: string; score: number }> | null,
    worldBrief: string | null
  ): void {
    const briefHtml = worldBrief ? this.renderWorldBrief(worldBrief) : '';
    const sentimentOverview = this.renderSentimentOverview(sentiments);
    const breakingHtml = this.renderBreakingStories(clusters, sentiments);
    const statsHtml = this.renderStats(clusters);

    this.setContent(`
      ${briefHtml}
      ${sentimentOverview}
      ${statsHtml}
      <div class="insights-section">
        <div class="insights-section-title">BREAKING & CONFIRMED</div>
        ${breakingHtml}
      </div>
    `);
  }

  private renderWorldBrief(brief: string): string {
    return `
      <div class="insights-brief">
        <div class="insights-section-title">🌍 WORLD BRIEF</div>
        <div class="insights-brief-text">${escapeHtml(brief)}</div>
      </div>
    `;
  }

  private renderBreakingStories(
    clusters: ClusteredEvent[],
    sentiments: Array<{ label: string; score: number }> | null
  ): string {
    // Show multi-source and fast-moving stories
    return clusters.map((cluster, i) => {
      const sentiment = sentiments?.[i];
      const sentimentClass = sentiment?.label === 'negative' ? 'negative' :
        sentiment?.label === 'positive' ? 'positive' : 'neutral';

      const badges: string[] = [];

      // Multi-source badge
      if (cluster.sourceCount >= 3) {
        badges.push(`<span class="insight-badge confirmed">✓ ${cluster.sourceCount} sources</span>`);
      } else if (cluster.sourceCount >= 2) {
        badges.push(`<span class="insight-badge multi">${cluster.sourceCount} sources</span>`);
      }

      // Velocity badge
      if (cluster.velocity && cluster.velocity.level !== 'normal') {
        const velIcon = cluster.velocity.trend === 'rising' ? '↑' : '';
        badges.push(`<span class="insight-badge velocity ${cluster.velocity.level}">${velIcon}+${cluster.velocity.sourcesPerHour}/hr</span>`);
      }

      // Alert badge
      if (cluster.isAlert) {
        badges.push('<span class="insight-badge alert">⚠ ALERT</span>');
      }

      return `
        <div class="insight-story">
          <div class="insight-story-header">
            <span class="insight-sentiment-dot ${sentimentClass}"></span>
            <span class="insight-story-title">${escapeHtml(cluster.primaryTitle.slice(0, 100))}${cluster.primaryTitle.length > 100 ? '...' : ''}</span>
          </div>
          ${badges.length > 0 ? `<div class="insight-badges">${badges.join('')}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  private renderSentimentOverview(sentiments: Array<{ label: string; score: number }> | null): string {
    if (!sentiments || sentiments.length === 0) {
      return '';
    }

    const negative = sentiments.filter(s => s.label === 'negative').length;
    const positive = sentiments.filter(s => s.label === 'positive').length;
    const neutral = sentiments.length - negative - positive;

    const total = sentiments.length;
    const negPct = Math.round((negative / total) * 100);
    const neuPct = Math.round((neutral / total) * 100);
    const posPct = 100 - negPct - neuPct;

    // Determine overall tone
    let toneLabel = 'Mixed';
    let toneClass = 'neutral';
    if (negative > positive + neutral) {
      toneLabel = 'Negative';
      toneClass = 'negative';
    } else if (positive > negative + neutral) {
      toneLabel = 'Positive';
      toneClass = 'positive';
    }

    return `
      <div class="insights-sentiment-bar">
        <div class="sentiment-bar-track">
          <div class="sentiment-bar-negative" style="width: ${negPct}%"></div>
          <div class="sentiment-bar-neutral" style="width: ${neuPct}%"></div>
          <div class="sentiment-bar-positive" style="width: ${posPct}%"></div>
        </div>
        <div class="sentiment-bar-labels">
          <span class="sentiment-label negative">${negative}</span>
          <span class="sentiment-label neutral">${neutral}</span>
          <span class="sentiment-label positive">${positive}</span>
        </div>
        <div class="sentiment-tone ${toneClass}">Overall: ${toneLabel}</div>
      </div>
    `;
  }

  private renderStats(clusters: ClusteredEvent[]): string {
    const multiSource = clusters.filter(c => c.sourceCount >= 2).length;
    const fastMoving = clusters.filter(c => c.velocity && c.velocity.level !== 'normal').length;
    const alerts = clusters.filter(c => c.isAlert).length;

    return `
      <div class="insights-stats">
        <div class="insight-stat">
          <span class="insight-stat-value">${multiSource}</span>
          <span class="insight-stat-label">Multi-source</span>
        </div>
        <div class="insight-stat">
          <span class="insight-stat-value">${fastMoving}</span>
          <span class="insight-stat-label">Fast-moving</span>
        </div>
        ${alerts > 0 ? `
        <div class="insight-stat alert">
          <span class="insight-stat-value">${alerts}</span>
          <span class="insight-stat-label">Alerts</span>
        </div>
        ` : ''}
      </div>
    `;
  }
}
