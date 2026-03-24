import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { describeFreshness } from '@/services/persistent-cache';
import type { MarketImplicationCard, MarketImplicationsData } from '@/services/market-implications';

const DISCLAIMER = 'AI-generated trade signals for informational purposes only. Not investment advice. Always do your own research.';

function directionStyle(dir: string): { color: string; label: string } {
  const d = dir.toUpperCase();
  if (d === 'LONG') return { color: '#8df0b2', label: 'LONG' };
  if (d === 'SHORT') return { color: '#ff8c8c', label: 'SHORT' };
  return { color: '#f4d06f', label: 'HEDGE' };
}

function confidenceColor(conf: string): string {
  const c = conf.toUpperCase();
  if (c === 'HIGH') return '#8df0b2';
  if (c === 'LOW') return '#ff8c8c';
  return '#f4d06f';
}

function renderCard(card: MarketImplicationCard): string {
  const dir = directionStyle(card.direction);
  const confColor = confidenceColor(card.confidence);
  return `
    <div style="border:1px solid var(--border);background:rgba(255,255,255,0.03);padding:14px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:12px;padding:3px 8px;border:1px solid ${dir.color};color:${dir.color};font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.08em;font-weight:700">${dir.label}</span>
        <strong style="font-size:15px;letter-spacing:-0.02em">${escapeHtml(card.ticker)}</strong>
        ${card.name ? `<span style="font-size:11px;color:var(--text-dim)">${escapeHtml(card.name)}</span>` : ''}
        ${card.timeframe ? `<span style="font-size:11px;padding:2px 6px;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font-mono)">${escapeHtml(card.timeframe)}</span>` : ''}
        ${card.confidence ? `<span style="font-size:11px;padding:2px 6px;border:1px solid ${confColor};color:${confColor};font-family:var(--font-mono);text-transform:uppercase">${escapeHtml(card.confidence)}</span>` : ''}
      </div>
      <div style="font-size:13px;font-weight:600;line-height:1.4">${escapeHtml(card.title)}</div>
      <div style="font-size:12px;line-height:1.55;color:var(--text)">${escapeHtml(card.narrative)}</div>
      ${card.driver ? `<div style="font-size:11px;color:var(--text-dim)"><span style="text-transform:uppercase;letter-spacing:0.06em">Driver:</span> ${escapeHtml(card.driver)}</div>` : ''}
      ${card.riskCaveat ? `<div style="font-size:11px;color:#f4d06f;padding:6px 8px;border:1px solid rgba(244,208,111,0.3);background:rgba(244,208,111,0.06)">${escapeHtml(card.riskCaveat)}</div>` : ''}
    </div>
  `;
}

export class MarketImplicationsPanel extends Panel {
  constructor() {
    super({
      id: 'market-implications',
      title: 'AI Market Implications',
      infoTooltip: t('components.marketImplications.infoTooltip'),
      premium: 'locked',
    });
  }

  public renderImplications(data: MarketImplicationsData, source: 'live' | 'cached' = 'live'): void {
    if (data.degraded || data.cards.length === 0) {
      this.showUnavailable();
      return;
    }

    const freshness = data.generatedAt ? describeFreshness(new Date(data.generatedAt).getTime()) : '';
    this.setDataBadge(source, freshness || `${data.cards.length} signals`);
    this.resetRetryBackoff();

    const html = `
      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="font-size:12px;color:var(--text-dim);line-height:1.5">
          LLM-generated trade signals derived from live geopolitical, commodity, and market state. Updated each forecast cycle.
        </div>
        ${data.cards.map(renderCard).join('')}
        <div style="font-size:10px;color:var(--text-dim);padding:8px;border-top:1px solid var(--border);line-height:1.5;text-align:center">${escapeHtml(DISCLAIMER)}</div>
      </div>
    `;

    this.setContent(html);
  }

  public showUnavailable(message = 'AI market implications are generated after each forecast run. Check back shortly.'): void {
    this.setDataBadge('unavailable');
    const html = `
      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="font-size:12px;color:var(--text-dim);line-height:1.5;padding:16px 0;text-align:center">${escapeHtml(message)}</div>
        <div style="font-size:10px;color:var(--text-dim);padding:8px;border-top:1px solid var(--border);line-height:1.5;text-align:center">${escapeHtml(DISCLAIMER)}</div>
      </div>
    `;
    this.setContent(html);
  }
}
