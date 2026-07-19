import { Panel } from './Panel';
import { getRouterPreference, setRouterPreference, type RouterPreference } from '@/services/router-preference';
import { getJudgePanel, type JudgePanel } from '@/services/judge-panel';
import { escapeHtml } from '@/utils/sanitize';
import { fmtInt, fmtPct, statTile, shareBar } from '@/utils/cloud-format';

// Enso Router — the user-facing routing control + the judge panel that trains it.
//
// Section A: a Savings ↔ Quality slider (bias 0..1) wired to the org preference
// proxy (/v1/world/cloud/router-preference). Reads on load, debounced-PUTs on
// change, shows a tiny "saved" confirmation. When the endpoint isn't live it
// degrades to a read-only control with an honest note — never an error.
//
// Section B: the Mean-Field Judge Panel (/v1/world/cloud/judge-panel) — a diverse
// set of judge models, each with a reliability weight, a calibrated mean and n
// scores seen — plus the published rank-corr-with-ground-truth benchmark (mean-
// field consensus ≫ any single judge, which an adversary can wreck). Honest empty
// ("warming up") when unavailable; never fabricated calibration.

const COPY =
  'Tune Enso for your product: slide toward Savings to route to the cheapest model ' +
  'that clears your quality bar, or Quality to always pick the best. Enso learns ' +
  'your preferred models over time.';

const INFO =
  'Enso Router — set your org\'s cost↔quality bias and watch the diverse judge panel ' +
  'that scores routing quality. Savings routes to the cheapest model that clears your ' +
  'quality bar; Quality always picks the best. The mean-field judge panel weights each ' +
  'judge by reliability; its consensus tracks ground truth far better than any single ' +
  'judge (published rank-corr benchmark). Preference is org-scoped; the panel aggregate ' +
  'is platform-wide.';

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Human label for a bias knob (0 = savings … 1 = quality). */
function biasLabel(b: number): string {
  if (b <= 0.12) return 'max savings';
  if (b < 0.42) return 'savings-leaning';
  if (b <= 0.58) return 'balanced';
  if (b < 0.88) return 'quality-leaning';
  return 'max quality';
}

/** sampleRate may arrive as a 0..1 fraction OR an already-scaled percent → 0..100. */
function ratePct(v: number): number {
  return v > 0 && v <= 1 ? v * 100 : v;
}

export class EnsoRouterPanel extends Panel {
  private pref: RouterPreference | null = null;
  private judge: JudgePanel | null = null;
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private savedTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly POLL_MS = 30_000;

  constructor() {
    super({
      id: 'enso-router',
      title: 'Enso Router',
      showCount: false,
      className: 'panel-wide cloud-panel',
      infoTooltip: INFO,
    });
    void this.init();
    // Only the judge panel polls — the preference is user-driven, set once.
    this.timer = setInterval(() => void this.refreshJudge(), EnsoRouterPanel.POLL_MS);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.savedTimer) { clearTimeout(this.savedTimer); this.savedTimer = null; }
    super.destroy();
  }

  private async init(): Promise<void> {
    // Both services degrade to honest empty shapes (never throw), so a missing
    // backend simply yields disabled/warming states rather than an error.
    const [pref, judge] = await Promise.all([getRouterPreference(), getJudgePanel()]);
    this.pref = pref;
    this.judge = judge;
    this.loaded = true;
    this.render();
  }

  private async refreshJudge(): Promise<void> {
    const j = await getJudgePanel();
    this.judge = j;
    // Update ONLY the judge subtree so a mid-drag slider is never disturbed.
    const host = this.getElement().querySelector('[data-enso-judge]');
    if (host) host.innerHTML = this.judgeInner();
    else if (this.loaded) this.render();
    if (this.judge?.enabled) this.setDataBadge('live'); else this.clearDataBadge();
  }

  private render(): void {
    if (!this.loaded) { this.showLoading('Loading Enso router…'); return; }
    if (this.judge?.enabled) this.setDataBadge('live'); else this.clearDataBadge();
    this.setContent(`
      <div class="cloud-overview enso-router">
        <div class="cloud-overview-head">
          <span class="cloud-scope">Enso router · cost ↔ quality</span>
          ${this.pref?.available ? '<span class="cloud-live-note">org preference</span>' : ''}
        </div>
        ${this.prefSection()}
        <div class="enso-router-judge" data-enso-judge>${this.judgeInner()}</div>
      </div>
    `);
    this.wireSlider();
  }

  // ── Section A: the Savings ↔ Quality slider ────────────────────────────────
  private prefSection(): string {
    const p = this.pref!;
    const bias = clamp01(p.bias);
    const pct = Math.round(bias * 100);
    // The control stays interactive even when the endpoint is not yet live — the
    // user can preview the bias; an honest note says it won't persist until the
    // gateway route ships, and a failed save reports "couldn't save".
    const note = p.available
      ? ''
      : 'Preview only — the router-preference API isn\'t deployed yet, so changes won\'t be saved. The control goes live once the gateway route ships.';
    return `
      <div class="enso-router-pref">
        <div class="cloud-subhead">Cost / quality preference</div>
        <p class="enso-router-copy">${escapeHtml(COPY)}</p>
        <div class="enso-slider-row">
          <span class="enso-slider-end">Savings</span>
          <input type="range" class="enso-slider" min="0" max="1" step="0.01"
                 value="${bias}" style="--val:${pct}%"
                 aria-label="Cost versus quality preference"
                 aria-valuemin="0" aria-valuemax="1" aria-valuenow="${bias.toFixed(2)}" />
          <span class="enso-slider-end">Quality</span>
        </div>
        <div class="enso-slider-meta">
          <span class="enso-slider-val" data-enso-val>${escapeHtml(biasLabel(bias))} · ${bias.toFixed(2)}</span>
          <span class="enso-slider-saved" data-enso-saved></span>
        </div>
        <div class="enso-router-note" data-enso-note>${escapeHtml(note)}</div>
      </div>`;
  }

  private wireSlider(): void {
    const el = this.getElement();
    const slider = el.querySelector('.enso-slider') as HTMLInputElement | null;
    const val = el.querySelector('[data-enso-val]') as HTMLElement | null;
    if (!slider || !val) return;
    slider.addEventListener('input', () => {
      const b = clamp01(parseFloat(slider.value));
      slider.style.setProperty('--val', `${Math.round(b * 100)}%`);
      slider.setAttribute('aria-valuenow', b.toFixed(2));
      val.textContent = `${biasLabel(b)} · ${b.toFixed(2)}`;
      if (this.pref) this.pref.bias = b;
      this.scheduleSave(b);
    });
  }

  private scheduleSave(bias: number): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(bias), 450);
  }

  private async save(bias: number): Promise<void> {
    const res = await setRouterPreference(bias);
    const savedEl = this.getElement().querySelector('[data-enso-saved]') as HTMLElement | null;
    if (!savedEl) return;
    if (res.available) {
      savedEl.textContent = 'saved';
      savedEl.className = 'enso-slider-saved show ok';
    } else {
      savedEl.textContent = 'couldn\'t save';
      savedEl.className = 'enso-slider-saved show warn';
    }
    if (this.savedTimer) clearTimeout(this.savedTimer);
    this.savedTimer = setTimeout(() => { savedEl.className = 'enso-slider-saved'; }, 1800);
  }

  // ── Section B: the mean-field judge panel ──────────────────────────────────
  private judgeInner(): string {
    const j = this.judge;
    if (!j || !j.available) {
      return `
        <div class="cloud-subhead">Mean-field judge panel</div>
        <div class="cloud-util-note">Judge panel warming up — diverse judges calibrate as traffic is scored.</div>`;
    }
    const rate = ratePct(j.sampleRate);
    const count = j.judges.length || j.models.length || 0;
    const tiles = [
      statTile(String(count), 'diverse judges', 'consensus panel'),
      statTile(rate > 0 ? fmtPct(rate, rate < 10 ? 1 : 0) : '—', 'of traffic scored', 'sample rate'),
      statTile(j.enabled ? 'on' : 'idle', 'panel scoring'),
    ].join('');

    let judgeRows: string;
    if (j.judges.length > 0) {
      const rows = j.judges.map((jd) => `
        <div class="cloud-model-row">
          <div class="cloud-model-head">
            <span class="cloud-model-name">${escapeHtml(jd.model)}</span>
            <span class="cloud-model-req">${clamp01(jd.weight).toFixed(2)}<span class="cloud-unit">weight</span></span>
          </div>
          ${shareBar(clamp01(jd.weight))}
          <div class="cloud-model-sub">calibrated mean ${jd.mean.toFixed(3)} · n=${fmtInt(jd.n)}</div>
        </div>`).join('');
      judgeRows = `
        <div class="cloud-subhead">Judges · reliability weight</div>
        <div class="cloud-model-list">${rows}</div>`;
    } else {
      judgeRows = `<div class="cloud-util-note">Diverse judges calibrate as traffic is scored — weights appear as scores accumulate.</div>`;
    }

    let bench = '';
    if (j.benchmark) {
      const b = j.benchmark;
      bench = `
        <div class="cloud-subhead">Published benchmark · rank-corr w/ ground truth</div>
        <div class="cloud-stat-grid cloud-stat-grid-4">
          ${statTile(b.mfjp.toFixed(3), 'mean-field panel', 'MFJP')}
          ${statTile(b.naiveMean.toFixed(3), 'naive mean')}
          ${statTile(b.singleNoisy.toFixed(3), 'single noisy judge')}
          ${statTile(b.singleAdversary.toFixed(3), 'single adversary')}
        </div>
        <div class="cloud-live-note">Mean-Field panel ${b.mfjp.toFixed(3)} vs single-judge ${b.singleAdversary.toFixed(3)} — published rank-corr w/ ground truth.</div>`;
    }

    return `
      <div class="cloud-subhead">Mean-field judge panel${j.enabled ? '' : ' · idle'}</div>
      <div class="cloud-stat-grid cloud-stat-grid-3">${tiles}</div>
      ${judgeRows}
      ${bench}`;
  }
}
