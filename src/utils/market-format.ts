// Shared presentation for the dense market data panels (commodities / FX /
// yields). One place for the monochrome sparkline + quote row + grouped block so
// every finance data panel reads as one Bloomberg-terminal system. Strictly
// monochrome per design canon: bright text for an up move, dim for a down move —
// never red/green (that lives only in the legacy MarketPanel heatmap).
import { escapeHtml } from './sanitize';

export type Dir = 'up' | 'down' | 'flat';

export function changeDir(change: number | null | undefined): Dir {
  if (change == null || !isFinite(change) || Math.abs(change) < 1e-9) return 'flat';
  return change > 0 ? 'up' : 'down';
}

/** Minimal monochrome sparkline — stroke inherits currentColor so the row tints it. */
export function monoSparkline(data: number[] | undefined, w = 54, h = 16): string {
  if (!data || data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return `<svg class="mkt-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export interface QuoteRow {
  name: string; // primary label, e.g. "Gold"
  sub?: string; // secondary, e.g. "GC=F" or "offshore"
  valueText?: string; // formatted price / yield; empty → unavailable
  changeText?: string; // formatted change (abs + pct); empty when no value
  dir?: Dir;
  sparkline?: number[];
}

/** A single dense quote row. Renders a quiet "—" state when valueText is empty. */
export function quoteRow(r: QuoteRow): string {
  const dir = r.dir ?? 'flat';
  if (!r.valueText) {
    return `<div class="mkt-row mkt-row-na">
      <span class="mkt-name">${escapeHtml(r.name)}${r.sub ? `<span class="mkt-sub">${escapeHtml(r.sub)}</span>` : ''}</span>
      <span class="mkt-na">unavailable</span>
    </div>`;
  }
  // data-ctx-* annotations drive the right-click menu (Copy value / Copy symbol) —
  // the menu logic lives once in panel-menu.ts; the row only declares its data.
  return `<div class="mkt-row" data-ctx-symbol="${escapeHtml(r.sub || r.name)}" data-ctx-value="${escapeHtml(r.valueText)}">
    <span class="mkt-name">${escapeHtml(r.name)}${r.sub ? `<span class="mkt-sub">${escapeHtml(r.sub)}</span>` : ''}</span>
    <span class="mkt-spark-wrap ${dir}">${monoSparkline(r.sparkline)}</span>
    <span class="mkt-val">${escapeHtml(r.valueText)}</span>
    <span class="mkt-chg ${dir}">${r.changeText ? escapeHtml(r.changeText) : ''}</span>
  </div>`;
}

/** A labelled group of rows (e.g. "Metals"). */
export function groupBlock(label: string, rowsHtml: string): string {
  return `<div class="mkt-group">
    <div class="mkt-group-label">${escapeHtml(label)}</div>
    ${rowsHtml}
  </div>`;
}

/** Absolute change derived from a price and its percent move (Yahoo gives pct). */
export function absFromPct(price: number, changePct: number): number {
  const prev = price / (1 + changePct / 100);
  return price - prev;
}
