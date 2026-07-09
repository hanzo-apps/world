// Shared formatting + tiny SVG helpers for the SaaS/cloud panels. One place for
// number formatting, stat tiles and sparklines so every cloud panel reads as one
// system (Geist Mono numerics, black monochrome — styled in main.css).
import { escapeHtml } from './sanitize';

/** Compact number: 1_234_567 → "1.23M", 3_400 → "3.4k". */
export function fmtCompact(n: number): string {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

/** Grouped integer: 1234567 → "1,234,567". */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** USD from cents: 123456 → "$1,234.56". */
export function fmtUsd(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** One decimal with a sign is not needed here; percent helper. */
export function fmtPct(n: number, digits = 2): string {
  return `${n.toFixed(digits)}%`;
}

/** A dense stat tile: big mono value + label, optional sub. */
export function statTile(value: string, label: string, sub?: string): string {
  return `<div class="cloud-stat">
    <div class="cloud-stat-value">${escapeHtml(value)}</div>
    <div class="cloud-stat-label">${escapeHtml(label)}</div>
    ${sub ? `<div class="cloud-stat-sub">${escapeHtml(sub)}</div>` : ''}
  </div>`;
}

/** Minimal monochrome sparkline. currentColor so it inherits the theme. */
export function sparkline(data: number[], width = 120, height = 28): string {
  if (!data || data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = data[data.length - 1] ?? min;
  const lx = width;
  const ly = height - ((last - min) / range) * (height - 2) - 1;
  return `<svg class="cloud-spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="1.8" fill="currentColor"/>
  </svg>`;
}

/** A horizontal share bar (0..1). */
export function shareBar(fraction: number): string {
  const pct = Math.max(0, Math.min(100, fraction * 100));
  return `<div class="cloud-bar"><div class="cloud-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>`;
}

/**
 * Demo/data-source flags stay honest in the payload but are no longer rendered
 * as a pill chip on widgets (product decision — no jewelry). Kept as a no-op so
 * the honesty contract has a single, obvious lever if we ever surface it as a
 * quiet text line instead.
 */
export function demoNote(_text = 'demo data'): string {
  return '';
}

/** Milliseconds, compactly: 1234 → "1.2s", 84 → "84ms". */
export function fmtMs(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return '—';
  if (ms >= 1000) return (ms / 1000).toFixed(ms >= 10000 ? 0 : 1) + 's';
  return Math.round(ms) + 'ms';
}

/** The clean "admin only" body for a gated Cloud panel (server enforces too). */
export function adminOnlyState(what: string): string {
  return `<div class="cloud-admin-gate">
    <div class="cloud-admin-gate-title">Admin only</div>
    <div class="cloud-admin-gate-body">${escapeHtml(what)} is available to the platform admin org. Sign in with an admin account to view it.</div>
  </div>`;
}
