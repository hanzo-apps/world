import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { REFRESH_INTERVALS } from '@/config';
import { fetchRotation, computeBook, type BookPosition, type Stance } from '@/services/rotation';

// The Lux Book — the fund's top-10 allocation, derived live from the rotation
// engine and rebalanced every refresh. Each position is a theme the model is
// weighting, with its stance, momentum delta and the globe anchor it sits on.
// Emits `lux-book` on document with the ranked positions so the globe layer can
// plot the bets over their hubs.

const STANCE_COLOR: Record<Stance, string> = {
  accumulate: '#4aa3ff',
  core: '#35d07f',
  trim: '#f5a623',
  avoid: '#ff5d5d',
};
const STANCE_LABEL: Record<Stance, string> = {
  accumulate: 'Accumulate', core: 'Core', trim: 'Trim', avoid: 'Avoid',
};

function sign(v: number, d = 1): string {
  if (v == null || !isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;
}
function dirClass(v: number): string {
  return Math.abs(v) < 0.05 ? 'flat' : v > 0 ? 'up' : 'down';
}

export class LuxBookPanel extends Panel {
  private timer: ReturnType<typeof setInterval> | null = null;
  private controller: AbortController | null = null;

  constructor() {
    super({
      id: 'lux-book',
      title: 'Lux Book · Top 10',
      showCount: false,
      infoTooltip:
        'The fund’s model allocation, derived live from the rotation engine and rebalanced every refresh. ' +
        'Conviction weights the quadrant (accumulate Improving, hold Leading, trim Weakening, avoid Lagging) ' +
        'plus a momentum tilt and an oversold-base bonus, normalised to a 100% book. ' +
        'Model output for research, not investment advice.',
    });
    void this.fetchData();
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
    // A newer refresh (or destroy) aborted this one — drop it silently.
    if (controller.signal.aborted) return;
    if (!snap || snap.unavailable) {
      this.clearDataBadge();
      this.setContent('<div class="book"><div class="book-na">Book unavailable.</div></div>');
      return;
    }
    this.setDataBadge('live');
    const book = computeBook(snap, 10);
    // hand the positions to the globe layer (and anyone else) — one source of bets
    document.dispatchEvent(new CustomEvent('lux-book', { detail: { positions: book, asOf: snap.asOf } }));
    this.render(book, snap.narrative);
  }

  private render(book: BookPosition[], narrative: string): void {
    const rows = book
      .map((p, i) => {
        const sc = STANCE_COLOR[p.stance];
        return `<div class="book-row">
          <span class="book-rank">${i + 1}</span>
          <span class="book-name">${escapeHtml(p.label)}<span class="book-anchor">${escapeHtml(p.anchor.label)}</span></span>
          <span class="book-wt">
            <span class="book-wt-bar"><span style="width:${Math.min(100, p.weight * 2.4).toFixed(1)}%;background:${sc}"></span></span>
            <span class="book-wt-num">${p.weight.toFixed(1)}%</span>
          </span>
          <span class="book-stance" style="color:${sc}">${STANCE_LABEL[p.stance]}</span>
          <span class="book-mom ${dirClass(p.momentumDelta)}" title="RS-momentum vs benchmark">${sign(p.momentumDelta)}</span>
          <span class="book-ret ${dirClass(p.ret63)}" title="3-month return">${sign(p.ret63)}%</span>
        </div>`;
      })
      .join('');
    this.setContent(`<div class="book">
      <div class="book-head">
        <span>Bucket</span><span class="book-h-wt">Weight</span><span>Stance</span>
        <span class="book-h-mom">Δmom</span><span class="book-h-ret">3mo</span>
      </div>
      ${rows}
      <div class="book-note">${escapeHtml(narrative)}</div>
      <div class="book-foot">Model allocation · rebalances with the rotation read · not investment advice</div>
    </div>`);
  }
}
