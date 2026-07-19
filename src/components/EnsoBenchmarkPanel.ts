import { Panel } from './Panel';
import { getEnsoBenchmarks, type EnsoBenchmarks, type BenchTable, type AblationTable, type AgenticTable } from '@/services/enso-benchmarks';
import { isAdmin } from '@/services/iam';
import { escapeHtml } from '@/utils/sanitize';
import { statTile, shareBar, adminOnlyState } from '@/utils/cloud-format';

// Enso benchmark suite — the ADMIN-ONLY head-to-head. Enso is a PRIVATE Hanzo
// product and this names competitor models + Enso, so the panel is admin-gated on
// BOTH sides: this component renders adminOnlyState for a non-admin, and the
// backing endpoint (/v1/world/enso-benchmarks) fail-closes 403 — the JSON never
// reaches a non-admin. Honest framing: enso MATCHES the best single SOTA arm at a
// fraction of the cost; it does NOT beat every SOTA, HLE is preflight-only, and we
// are below Enso's REPORTED numbers. The decisive wins are cost-efficiency, the
// verify-then-select ablation (better AND cheaper) and agentic step-routing. Those
// caveats ride in the payload (server-authored) and render as visible footnotes.

const usd = (n: number): string => (n > 0 ? `$${n.toFixed(2)}` : '—');
const acc = (n: number): string => `${n.toFixed(1)}`;

export class EnsoBenchmarkPanel extends Panel {
  private data: EnsoBenchmarks | null = null;
  private loaded = false;
  private notAdmin = false;

  constructor() {
    super({ id: 'enso-benchmarks', title: 'Enso Benchmark Suite', showCount: false, className: 'panel-wide cloud-panel' });
    void this.fetchData();
  }

  private async fetchData(): Promise<void> {
    // Client mirror of the server gate: a non-admin never even attempts the fetch.
    if (!(await isAdmin())) {
      this.notAdmin = true;
      this.loaded = true;
      this.render();
      return;
    }
    this.notAdmin = false;
    const d = await getEnsoBenchmarks();
    if (d) this.data = d; // keep last-good across a transient null
    this.loaded = true;
    this.render();
  }

  private render(): void {
    if (this.notAdmin) {
      this.clearDataBadge();
      this.setContent(adminOnlyState('Enso benchmark suite'));
      return;
    }
    if (!this.loaded) {
      this.showLoading('Loading benchmark suite…');
      return;
    }
    if (!this.data) {
      // Admin, but the (server-gated) fetch failed — stay honest, no fake data.
      this.clearDataBadge();
      this.setContent(adminOnlyState('Enso benchmark suite'));
      return;
    }
    const d = this.data;
    this.setDataBadge('live', d.source === 'live' ? 'live' : 'snapshot');

    const header = [
      statTile(`${d.benches.length}`, 'benches measured', d.source),
      statTile(usd(d.totalUsdEst), 'total spend', 'all runs'),
      statTile(`${d.pending.length}`, 'run pending', d.pending.join(' · ') || '—'),
    ].join('');

    this.setContent(`
      <div class="cloud-overview enso-bm">
        <div class="cloud-overview-head">
          <span class="cloud-scope">Enso vs SOTA · measured head-to-head</span>
          <span class="cloud-live-note">private · admin only</span>
        </div>
        <div class="cloud-stat-grid cloud-stat-grid-3">${header}</div>

        ${d.benches.map((b) => this.benchBlock(b)).join('')}
        ${this.ablationBlock(d.ablation)}
        ${d.agentic ? this.agenticBlock(d.agentic) : ''}
        ${this.ensoBlock(d)}
        ${this.caveatsBlock(d.caveats)}
      </div>
    `);
  }

  // ── block 1: per-bench measured head-to-head ──────────────────────────────
  private benchBlock(b: BenchTable): string {
    const maxAcc = Math.max(...b.systems.map((s) => s.accuracyPct), 1);
    const rows = b.systems.map((s) => {
      const isEnso = s.family === 'enso';
      const isBest = s.system === b.bestArm;
      const tag = isEnso
        ? '<span class="cloud-tag">enso</span>'
        : isBest
          ? '<span class="cloud-tag enso-bm-tag-arm">best arm</span>'
          : '';
      const accCell = s.preflight
        ? `<span class="enso-bm-pre">preflight</span>`
        : `${acc(s.accuracyPct)}<span class="enso-bm-se"> ± ${s.stderrPct.toFixed(1)}</span>`;
      const bar = s.preflight ? '' : shareBar(s.accuracyPct / maxAcc);
      return `<tr class="${isEnso ? 'enso-bm-row-enso' : ''}">
        <td class="enso-bm-sys">${escapeHtml(s.system)}${tag}</td>
        <td class="num">${accCell}<div class="enso-bm-bar">${bar}</div></td>
        <td class="num">n=${s.n}</td>
        <td class="num">${usd(s.usdEst)}</td>
      </tr>`;
    }).join('');

    const enso = (b.ensoReported || b.ensoUltraReported)
      ? `<div class="cloud-live-note">Reported (Table 1): ${b.ensoReported ? b.ensoReported.toFixed(1) : '—'} · Ultra ${b.ensoUltraReported ? b.ensoUltraReported.toFixed(1) : '—'} — reported by the competitor, not measured by us; we sit below their reported figures here.</div>`
      : '';
    const note = b.note ? `<div class="cloud-live-note">${escapeHtml(b.note)}</div>` : '';

    return `
      <div class="cloud-subhead">${escapeHtml(b.name)}</div>
      <div class="enso-bm-wrap">
        <table class="enso-bm-table">
          <thead><tr><th>system</th><th class="num">accuracy %</th><th class="num">n</th><th class="num">cost</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${note}
      ${enso}`;
  }

  // ── block 2: v1 blind-synthesis → v2 verify-then-select ablation ───────────
  private ablationBlock(rows: AblationTable[]): string {
    if (!rows.length) return '';
    const blocks = rows.map((a) => {
      const better = a.deltaPts > 0;
      const cheaper = a.costDropPct > 0;
      return `
        <div class="enso-bm-abl">
          <div class="enso-bm-abl-name">${escapeHtml(a.name)}</div>
          <div class="enso-bm-wrap">
            <table class="enso-bm-table">
              <thead><tr><th>logic</th><th class="num">accuracy %</th><th class="num">cost</th></tr></thead>
              <tbody>
                <tr><td>${escapeHtml(a.v1.label)}</td><td class="num">${acc(a.v1.accuracyPct)}</td><td class="num">${usd(a.v1.usdEst)}</td></tr>
                <tr class="enso-bm-row-enso"><td>${escapeHtml(a.v2.label)}</td><td class="num">${acc(a.v2.accuracyPct)}</td><td class="num">${usd(a.v2.usdEst)}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="enso-bm-delta">
            <span class="${better ? 'enso-bm-up' : 'enso-bm-down'}">${better ? '+' : ''}${a.deltaPts.toFixed(1)} pts</span>
            <span class="${cheaper ? 'enso-bm-up' : 'enso-bm-down'}">${cheaper ? '−' : '+'}${Math.abs(a.costDropPct).toFixed(1)}% cost</span>
          </div>
        </div>`;
    }).join('');
    return `
      <div class="cloud-subhead">enso-ultra logic ablation</div>
      <div class="cloud-live-note">Better AND cheaper: the shipped selector beats the v1 baseline on the open-ended bench.</div>
      ${blocks}`;
  }

  // ── block 3: agentic SWE-Bench Pro pilot ──────────────────────────────────
  private agenticBlock(a: AgenticTable): string {
    const row = (label: string, r: AgenticTable['stepRouted'], enso: boolean) => `
      <tr class="${enso ? 'enso-bm-row-enso' : ''}">
        <td class="enso-bm-sys">${escapeHtml(label)}</td>
        <td class="num">${(r.resolvedRate * 100).toFixed(1)}<span class="enso-bm-se"> (${r.resolved}/${r.n})</span></td>
        <td class="num">${usd(r.usdEst)}</td>
        <td class="num">${r.calls}</td>
      </tr>`;
    return `
      <div class="cloud-subhead">${escapeHtml(a.bench)} · agentic (step-routed)</div>
      <div class="enso-bm-wrap">
        <table class="enso-bm-table">
          <thead><tr><th>system</th><th class="num">% resolved</th><th class="num">cost</th><th class="num">calls</th></tr></thead>
          <tbody>
            ${row(a.stepRouted.label, a.stepRouted, true)}
            ${row(a.singleOpus.label, a.singleOpus, false)}
          </tbody>
        </table>
      </div>
      <div class="cloud-live-note">${escapeHtml(a.note)}</div>`;
  }

  // Enso full reported table — reference context, clearly labelled reported-not-measured.
  // Columns are derived from the (server-gated) payload, never hardcoded, so no
  // competitor name is ever baked into the public SPA bundle.
  private ensoBlock(d: EnsoBenchmarks): string {
    if (!d.enso.length) return '';
    const cols = Array.from(new Set(d.enso.flatMap((f) => Object.keys(f.scores)))).sort();
    if (!cols.length) return '';
    const head = `<tr><th>benchmark</th>${cols.map((c) => `<th class="num">${escapeHtml(c)}</th>`).join('')}</tr>`;
    const rows = d.enso.map((f) => `<tr>
      <td>${escapeHtml(f.bench)}</td>
      ${cols.map((c) => `<td class="num">${f.scores[c] != null ? f.scores[c]!.toFixed(1) : '—'}</td>`).join('')}
    </tr>`).join('');
    return `
      <div class="cloud-subhead">Competitor reported figures · Table 1 (not measured by us)</div>
      <div class="enso-bm-wrap">
        <table class="enso-bm-table"><thead>${head}</thead><tbody>${rows}</tbody></table>
      </div>`;
  }

  private caveatsBlock(caveats: string[]): string {
    if (!caveats.length) return '';
    const items = caveats.map((c) => `<li>${escapeHtml(c)}</li>`).join('');
    return `
      <div class="cloud-subhead">Honest framing</div>
      <ul class="enso-bm-foot">${items}</ul>`;
  }
}
