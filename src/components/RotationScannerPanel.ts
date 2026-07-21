import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { REFRESH_INTERVALS } from '@/config';
import {
  fetchRotation,
  QUADRANT_LABEL,
  type RotationSnapshot,
  type RotationTheme,
  type RotationSignal,
  type Quadrant,
} from '@/services/rotation';

// Sector-rotation scanner. Reads the server-side Relative Rotation Graph and
// visualizes where capital is rotating between themes — the AI buildout trade
// distributing at the top (Weakening quadrant) while the energy complex that
// powers it accumulates from a base (Improving quadrant). The quadrant plot is
// the hero; the signal chips name the thesis triggers; the leaderboard ranks
// every theme by forward relative momentum.

const QUAD_COLOR: Record<Quadrant, string> = {
  leading: '#44ff88',   // outperforming and accelerating
  weakening: '#f5a623', // outperforming but rolling over — distribution
  lagging: '#ff5c5c',   // underperforming and falling
  improving: '#4aa3ff', // underperforming but turning up — accumulation
};

const INFO = `
  <strong>Relative Rotation Graph.</strong> Each theme is scored against the S&amp;P 500 on two axes:
  <em>RS-Ratio</em> (relative strength — is it out- or under-performing) and <em>RS-Momentum</em>
  (is that relative strength accelerating or rolling over). The four quadrants name a theme's place
  in the rotation cycle: <b>Leading</b> → <b>Weakening</b> → <b>Lagging</b> → <b>Improving</b> →
  back to Leading. Capital distributes out of a hot theme through <b>Weakening</b> and accumulates an
  out-of-favour one through <b>Improving</b>. Faithful open approximation of JdK RS-Ratio/Momentum;
  6-month daily data, refreshed every few minutes.`;

function fmtPct(v: number | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function dirClass(v: number | undefined): string {
  if (v == null || !isFinite(v) || Math.abs(v) < 1e-9) return 'flat';
  return v > 0 ? 'up' : 'down';
}

// Symmetric plot domain around 100 so the benchmark cross sits dead-centre; the
// half-range adapts to the widest point so tails never clip.
function plotDomain(themes: RotationTheme[]): number {
  let dev = 4;
  for (const th of themes) {
    dev = Math.max(dev, Math.abs(th.rsRatio - 100), Math.abs(th.rsMomentum - 100));
    for (const p of th.tail) {
      dev = Math.max(dev, Math.abs(p.rsRatio - 100), Math.abs(p.rsMomentum - 100));
    }
  }
  return Math.ceil(dev * 1.12);
}

export class RotationScannerPanel extends Panel {
  private timer: ReturnType<typeof setInterval> | null = null;
  private controller: AbortController | null = null;

  constructor() {
    super({
      id: 'rotation',
      title: 'Rotation scanner',
      showCount: false,
      infoTooltip: INFO,
    });
    void this.fetchData();
    // Rotation is a multi-week read; the 6mo server cache is 15min, so polling on
    // the markets cadence just picks up the shared refresh without new upstream load.
    this.timer = setInterval(() => void this.fetchData(), REFRESH_INTERVALS.markets);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.controller?.abort();
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const snap = await fetchRotation(controller.signal);
    // A newer refresh (or destroy) aborted this one — drop it silently rather than
    // flashing "unavailable" over the still-valid current render.
    if (controller.signal.aborted) return;
    if (!snap || snap.unavailable) {
      this.clearDataBadge();
      this.setContent('<div class="rot"><div class="rot-na">Rotation data unavailable.</div></div>');
      return;
    }
    this.setDataBadge('live');
    this.render(snap);
  }

  private render(snap: RotationSnapshot): void {
    const leads = snap.themes.filter((t) => t.lead);
    const html = `
      <div class="rot">
        ${this.renderSignals(snap.signals)}
        <div class="rot-narrative">${escapeHtml(snap.narrative)}</div>
        ${this.renderRRG(leads)}
        ${this.renderBoard(snap.themes)}
        <div class="rot-foot">vs ${escapeHtml(snap.benchmark)} · ${escapeHtml(snap.window || '6mo')} daily · ${escapeHtml(snap.marketSession || '')}</div>
      </div>`;
    this.setContent(html);
  }

  private renderSignals(signals: RotationSignal[]): string {
    if (!signals?.length) return '';
    const chips = signals
      .map((s) => {
        const pct = Math.round((s.score ?? 0) * 100);
        return `<div class="rot-sig rot-sig-${s.state}" title="${escapeHtml(s.note)}">
          <div class="rot-sig-top">
            <span class="rot-sig-dot"></span>
            <span class="rot-sig-label">${escapeHtml(s.label)}</span>
            <span class="rot-sig-state">${escapeHtml(s.state)}</span>
          </div>
          <div class="rot-sig-bar"><span style="width:${pct}%"></span></div>
        </div>`;
      })
      .join('');
    return `<div class="rot-signals">${chips}</div>`;
  }

  // The RRG quadrant plot. Each lead theme is drawn as its tail (the path it took
  // through the quadrants) plus a labelled head dot coloured by its current
  // quadrant — the visible proof of a rotation in progress.
  private renderRRG(themes: RotationTheme[]): string {
    if (!themes.length) return '';
    const size = 260, pad = 18, plot = size - pad * 2;
    const R = plotDomain(themes);
    const sx = (r: number) => pad + ((r - (100 - R)) / (2 * R)) * plot;
    const sy = (m: number) => pad + (1 - (m - (100 - R)) / (2 * R)) * plot; // momentum up = smaller y
    const cx = sx(100), cy = sy(100);

    // Quadrant tints — Improving (top-left) and Weakening (bottom-right) are the
    // two the thesis lives in, so they read a touch stronger.
    const quad = (x: number, y: number, w: number, h: number, color: string, op: number) =>
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" opacity="${op}"/>`;
    const bg = `
      ${quad(cx, pad, size - pad - cx, cy - pad, QUAD_COLOR.leading, 0.05)}
      ${quad(cx, cy, size - pad - cx, size - pad - cy, QUAD_COLOR.weakening, 0.08)}
      ${quad(pad, cy, cx - pad, size - pad - cy, QUAD_COLOR.lagging, 0.05)}
      ${quad(pad, pad, cx - pad, cy - pad, QUAD_COLOR.improving, 0.08)}`;

    const axes = `
      <line x1="${cx}" y1="${pad}" x2="${cx}" y2="${size - pad}" stroke="var(--border-strong)" stroke-width="1" stroke-dasharray="2 3"/>
      <line x1="${pad}" y1="${cy}" x2="${size - pad}" y2="${cy}" stroke="var(--border-strong)" stroke-width="1" stroke-dasharray="2 3"/>`;

    const corners = `
      <text x="${size - pad - 2}" y="${pad + 10}" text-anchor="end" class="rot-quad-lbl" fill="${QUAD_COLOR.leading}">LEADING</text>
      <text x="${size - pad - 2}" y="${size - pad - 3}" text-anchor="end" class="rot-quad-lbl" fill="${QUAD_COLOR.weakening}">WEAKENING</text>
      <text x="${pad + 2}" y="${size - pad - 3}" text-anchor="start" class="rot-quad-lbl" fill="${QUAD_COLOR.lagging}">LAGGING</text>
      <text x="${pad + 2}" y="${pad + 10}" text-anchor="start" class="rot-quad-lbl" fill="${QUAD_COLOR.improving}">IMPROVING</text>`;

    const tracks = themes
      .map((th) => {
        const color = QUAD_COLOR[th.quadrant];
        const pts = [...th.tail, { rsRatio: th.rsRatio, rsMomentum: th.rsMomentum }];
        const poly = pts.map((p) => `${sx(p.rsRatio).toFixed(1)},${sy(p.rsMomentum).toFixed(1)}`).join(' ');
        const hx = sx(th.rsRatio), hy = sy(th.rsMomentum);
        const short = escapeHtml(th.label);
        return `<g class="rot-track">
          <polyline points="${poly}" fill="none" stroke="${color}" stroke-width="1.2" opacity="0.5" stroke-linejoin="round"/>
          <circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="3.4" fill="${color}"/>
          <text x="${(hx + 5).toFixed(1)}" y="${(hy + 3).toFixed(1)}" class="rot-dot-lbl">${short}</text>
        </g>`;
      })
      .join('');

    return `<svg class="rot-rrg" viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Relative rotation graph">
      ${bg}${axes}${corners}${tracks}</svg>`;
  }

  private renderBoard(themes: RotationTheme[]): string {
    const rows = themes
      .map((th) => {
        const color = QUAD_COLOR[th.quadrant];
        return `<div class="rot-row" title="${escapeHtml(th.group)} · RS ${th.rsRatio.toFixed(1)} / Mom ${th.rsMomentum.toFixed(1)}">
          <span class="rot-quad-dot" style="background:${color}"></span>
          <span class="rot-row-name">${escapeHtml(th.label)}</span>
          <span class="rot-row-quad" style="color:${color}">${escapeHtml(QUADRANT_LABEL[th.quadrant])}</span>
          <span class="rot-row-ret ${dirClass(th.ret21)}">${fmtPct(th.ret21)}</span>
        </div>`;
      })
      .join('');
    return `<div class="rot-board">
      <div class="rot-board-head"><span>Theme</span><span>Quadrant</span><span>1mo</span></div>
      ${rows}
    </div>`;
  }
}
