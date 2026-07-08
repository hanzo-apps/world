import { Panel } from './Panel';
import { isAuthenticated, login } from '@/services/iam';
import { getMyBilling, CONSOLE_BILLING_URL, type MyBilling } from '@/services/cloud-pulse';
import { escapeHtml } from '@/utils/sanitize';
import { fmtUsd, statTile } from '@/utils/cloud-format';

// The caller's own usage + bill drill-down. REAL, org-scoped: billing balance +
// last-30d usage ledger from api.hanzo.ai with the caller's bearer (org pinned
// server-side). Signed out, it is a sign-in call to action — never demo billing
// (a fake bill would be dishonest). The full invoice lives on console.hanzo.ai.
export class MyUsagePanel extends Panel {
  private billing: MyBilling | null = null;
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'my-usage', title: 'My Usage & Bill', showCount: false, className: 'cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 60_000);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    if (!isAuthenticated()) { this.loaded = true; this.renderSignedOut(); return; }
    this.billing = await getMyBilling();
    this.loaded = true;
    this.render();
  }

  private renderSignedOut(): void {
    this.clearDataBadge();
    this.setContent(`
      <div class="cloud-signin">
        <div class="cloud-signin-title">Your usage & bill</div>
        <div class="cloud-signin-body">Sign in to see your org's real spend, balance and usage — metered to your account, no shared keys.</div>
        <button type="button" class="cloud-signin-btn" id="cloudSigninBtn">Sign in</button>
      </div>
    `);
    this.content.querySelector('#cloudSigninBtn')?.addEventListener('click', () => void login());
  }

  private render(): void {
    if (!this.loaded) { this.showLoading('Loading your usage…'); return; }
    const b = this.billing;
    if (!b) {
      this.setDataBadge('unavailable');
      this.setContent(`<div class="cloud-empty">Billing is not available for this account yet. <a href="${CONSOLE_BILLING_URL}" target="_blank" rel="noopener">Open billing console →</a></div>`);
      return;
    }
    this.setDataBadge('live', 'your org');

    const availableCents = b.balance?.available ?? b.balance?.balance ?? 0;
    const tiles = [
      statTile(fmtUsd(b.spend30dCents), 'spend · 30d'),
      statTile(fmtUsd(availableCents), 'available balance'),
      statTile(String(b.usage.length), 'billable events · 30d'),
    ].join('');

    const recent = b.usage
      .slice()
      .sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''))
      .slice(0, 8)
      .map((u) => {
        const label = typeof u.metadata?.product === 'string' ? u.metadata.product
          : typeof u.metadata?.description === 'string' ? u.metadata.description
            : 'usage';
        const when = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '';
        return `<div class="cloud-usage-row">
          <span class="cloud-usage-label">${escapeHtml(String(label))}</span>
          <span class="cloud-usage-when">${escapeHtml(when)}</span>
          <span class="cloud-usage-amt">${fmtUsd(u.amount)}</span>
        </div>`;
      }).join('');

    this.setContent(`
      <div class="cloud-usage">
        <div class="cloud-stat-grid cloud-stat-grid-3">${tiles}</div>
        <div class="cloud-usage-list">${recent || '<div class="cloud-empty">No usage in the last 30 days.</div>'}</div>
        <a class="cloud-bill-link" href="${CONSOLE_BILLING_URL}" target="_blank" rel="noopener">View full bill on console.hanzo.ai →</a>
      </div>
    `);
  }
}
