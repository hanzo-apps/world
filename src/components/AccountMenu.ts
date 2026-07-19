// Account menu for the Hanzo World header: shows the logged-in user and an
// org / project switcher, or a "Sign in" button when signed out. One Hanzo
// identity (hanzo.id OIDC PKCE) shared with studio/chat/app.
//
// Self-contained: renders its own DOM node (getElement()) that App inserts into
// .header-right, and injects its styles once using the app's theme CSS vars so
// it tracks dark/light automatically.

import { getUser, login, logout, isAuthenticated, setActiveOrg, type IamUser } from '../services/iam';
import {
  resolveScope,
  setCurrentProject,
  type OrgScope,
} from '../services/org-scope';
import { getTrainingContribution, setTrainingContribution } from '../services/training-contribution';

const STYLE_ID = 'account-menu-styles';

export class AccountMenu {
  private element: HTMLElement;
  private user: IamUser | null = null;
  private scope: OrgScope | null = null;
  private open = false;
  // Model-improvement consent, mirrored from ai's OrgSettings via its GEO-AWARE
  // effective default (opt-in / default-OFF in the EU, UK & EEA; opt-out /
  // default-ON, disclosed at signup, elsewhere). null = not yet loaded; painted OFF
  // until the async read lands so we never flash a false "on", then reconciled to
  // whatever ai reports — including an ON default for a non-EU org. We never
  // hardcode the default; the toggle is a mirror of ai's answer.
  private trainingOptIn: boolean | null = null;
  private onDocClick = (e: MouseEvent) => {
    if (this.open && !this.element.contains(e.target as Node)) this.close();
  };

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'account-menu';
    injectStyles();
    this.renderSignedOut(); // instant paint; refresh() fills identity async
    document.addEventListener('click', this.onDocClick);
    void this.refresh();
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public async refresh(): Promise<void> {
    if (!isAuthenticated()) {
      this.user = null;
      this.scope = null;
      this.renderSignedOut();
      this.announce(false);
      return;
    }
    this.user = await getUser();
    if (!this.user) {
      this.renderSignedOut();
      this.announce(false);
      return;
    }
    this.scope = await resolveScope();
    this.render();
    void this.loadConsent(); // fills the opt-in toggle in place once ai answers
    this.announce(true);
  }

  // The ONE signal that identity resolved. Anything that depends on signed-in
  // state (e.g. hiding the "Try Hanzo" acquisition CTA) listens for this rather
  // than polling isAuthenticated().
  private announce(authed: boolean): void {
    document.dispatchEvent(new CustomEvent('hanzo:auth', { detail: { authed } }));
  }

  private close(): void {
    this.open = false;
    const dd = this.element.querySelector('.am-dropdown');
    dd?.classList.add('hidden');
  }

  private renderSignedOut(): void {
    // Secondary identity control: a "Sign in" button. The primary header CTA is now
    // the "Try Hanzo" product switcher, so this stays understated and runs the same
    // hanzo.id OIDC login the account chip uses.
    this.element.innerHTML = `<button class="am-signin" type="button">Sign in</button>`;
    this.element.querySelector('.am-signin')?.addEventListener('click', () => void login());
  }

  private render(): void {
    const u = this.user!;
    const s = this.scope;
    const label = s ? `${orgName(s)}${s.currentProject ? ` / ${projectName(s)}` : ''}` : (u.owner || 'account');

    this.element.innerHTML = `
      <button class="am-trigger" type="button" aria-haspopup="true">
        ${orgAvatar(s, u)}
        <span class="am-scope" title="${label}">${label}</span>
        <span class="am-caret">▾</span>
      </button>
      <div class="am-dropdown hidden" role="menu">
        <div class="am-user">
          ${avatar(u, 32)}
          <div class="am-user-meta">
            <div class="am-name">${esc(u.name || u.email || u.sub)}</div>
            ${u.email ? `<div class="am-email">${esc(u.email)}</div>` : ''}
          </div>
        </div>
        ${this.orgSection()}
        ${this.projectSection()}
        ${this.consentSection()}
        <button class="am-signout" type="button">Sign out</button>
      </div>
    `;

    this.element.querySelector('.am-trigger')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.open = !this.open;
      this.element.querySelector('.am-dropdown')?.classList.toggle('hidden', !this.open);
    });
    this.element.querySelector('.am-signout')?.addEventListener('click', async () => {
      await logout();
      location.reload();
    });
    this.element.querySelectorAll<HTMLElement>('.am-org').forEach((el) => {
      el.addEventListener('click', () => {
        const org = el.dataset.org!;
        if (org !== this.scope?.currentOrg) {
          setActiveOrg(org);
          location.reload();
        }
      });
    });
    this.element.querySelectorAll<HTMLElement>('.am-project').forEach((el) => {
      el.addEventListener('click', () => {
        const proj = el.dataset.project!;
        if (proj !== this.scope?.currentProject) {
          setCurrentProject(this.scope!.currentOrg, proj);
          location.reload();
        }
      });
    });

    const toggle = this.element.querySelector<HTMLInputElement>('.am-consent-toggle');
    toggle?.addEventListener('change', async () => {
      // Explicit user action only — no pre-checking, no nagging. Optimistic flip,
      // reverted if the server refuses, so the toggle never claims a state ai didn't
      // accept.
      const want = toggle.checked;
      const prev = this.trainingOptIn === true;
      toggle.disabled = true;
      this.setConsentStatus('Saving…');
      try {
        const now = await setTrainingContribution(want);
        this.trainingOptIn = now;
        toggle.checked = now;
        this.setConsentStatus(now ? 'On — thanks for helping improve routing.' : 'Off.');
      } catch {
        this.trainingOptIn = prev;
        toggle.checked = prev;
        this.setConsentStatus('Could not save — please try again.');
      } finally {
        toggle.disabled = false;
      }
    });
  }

  // "Help improve Hanzo AI" — the model-improvement consent surface. Reflects ai's
  // geo-aware effective state (never a hardcoded default); honest, state-neutral
  // microcopy, no dark patterns: rating keeps only a numeric score, never prompts or
  // outputs, and runs confidentially/anonymously. The app is identical when OFF, and
  // it can be turned off (or on) anytime.
  private consentSection(): string {
    const on = this.trainingOptIn === true;
    return `<div class="am-section am-consent">
      <div class="am-section-title">Data &amp; privacy</div>
      <div class="am-consent-row">
        <span class="am-consent-title">Help improve Hanzo AI <span class="am-consent-opt">(optional)</span></span>
        <label class="am-switch" title="Optional — you're always in control. Turn it off (or on) anytime.">
          <input type="checkbox" class="am-consent-toggle" ${on ? 'checked' : ''} aria-label="Help improve Hanzo AI" />
          <span class="am-switch-track"><span class="am-switch-thumb"></span></span>
        </label>
      </div>
      <div class="am-consent-body">When on, Hanzo uses your AI usage to improve routing quality. An automated judge rates how good each response was and keeps only a numeric score — we never store your prompts or outputs, and rating runs in a confidential, anonymous way. You're always in control: turning it off changes nothing else about how Hanzo works for you.</div>
      <div class="am-consent-status" role="status" aria-live="polite"></div>
    </div>`;
  }

  // Load the current EFFECTIVE consent from ai (its geo-aware default when the org
  // never set one explicitly) and reflect it in the already-painted toggle without a
  // full re-render, so an open dropdown / its handlers survive. An ON effective
  // default (non-EU) therefore shows checked once ai answers. Failure leaves the
  // privacy-safe OFF in place — a broken read never implies consent.
  private async loadConsent(): Promise<void> {
    let on = false;
    try {
      on = await getTrainingContribution();
    } catch {
      on = false;
    }
    this.trainingOptIn = on;
    const toggle = this.element.querySelector<HTMLInputElement>('.am-consent-toggle');
    if (toggle && !toggle.disabled) toggle.checked = on;
  }

  private setConsentStatus(msg: string): void {
    const el = this.element.querySelector<HTMLElement>('.am-consent-status');
    if (el) el.textContent = msg;
  }

  private orgSection(): string {
    const s = this.scope;
    if (!s || s.orgs.length <= 1) {
      // Single-org user: show it as context, not a menu.
      return `<div class="am-section"><div class="am-section-title">Organization</div>
        <div class="am-row am-static">${esc(orgName(s))}${s?.isScopedAway ? ' <span class="am-badge">scoped</span>' : ''}</div></div>`;
    }
    return `<div class="am-section"><div class="am-section-title">Organization</div>
      ${s.orgs
        .map(
          (o) => `<button class="am-row am-org ${o.id === s.currentOrg ? 'active' : ''}" data-org="${esc(o.id)}" type="button">
            <span>${esc(o.name)}${o.id === s.homeOrg ? ' <span class="am-tag">home</span>' : ''}</span>
            ${o.id === s.currentOrg ? '<span class="am-check">✓</span>' : ''}
          </button>`,
        )
        .join('')}</div>`;
  }

  private projectSection(): string {
    const s = this.scope;
    if (!s) return '';
    return `<div class="am-section"><div class="am-section-title">Project</div>
      ${s.projects
        .map(
          (p) => `<button class="am-row am-project ${p.id === s.currentProject ? 'active' : ''}" data-project="${esc(p.id)}" type="button">
            <span>${esc(p.name)}</span>
            ${p.id === s.currentProject ? '<span class="am-check">✓</span>' : ''}
          </button>`,
        )
        .join('')}</div>`;
  }

  public destroy(): void {
    document.removeEventListener('click', this.onDocClick);
  }
}

function projectName(s: OrgScope): string {
  return s.projects.find((p) => p.id === s.currentProject)?.name || s.currentProject;
}

function orgName(s: OrgScope | null): string {
  if (!s) return '';
  return s.orgs.find((o) => o.id === s.currentOrg)?.name || s.currentOrg;
}

function esc(v: string): string {
  return String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

function avatar(u: IamUser, size = 22): string {
  if (u.picture) {
    return `<img class="am-avatar" src="${esc(u.picture)}" width="${size}" height="${size}" alt="" referrerpolicy="no-referrer" />`;
  }
  return initialsAvatar(u.name || u.email || u.sub || '?', size);
}

// The trigger's leading glyph is the ORG (the label is org / project), so it shows
// the active org's logo when IAM provides one — the "hanzo org image" — and falls
// back to org initials. The dropdown's user row keeps the user avatar. Square-ish
// radius distinguishes an org from the round user avatar.
function orgAvatar(s: OrgScope | null, u: IamUser, size = 22): string {
  const org = s?.orgs.find((o) => o.id === s.currentOrg);
  if (org?.logo) {
    return `<img class="am-avatar am-avatar-org" src="${esc(org.logo)}" width="${size}" height="${size}" alt="" referrerpolicy="no-referrer" />`;
  }
  // No org logo → org initials if we have an org, else the user avatar (signed-out/no-scope).
  return org ? initialsAvatar(org.name || org.id, size, true) : avatar(u, size);
}

function initialsAvatar(src: string, size: number, org = false): string {
  const initials = src
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?';
  return `<span class="am-avatar am-avatar-initials${org ? ' am-avatar-org' : ''}" style="width:${size}px;height:${size}px;line-height:${size}px;font-size:${Math.round(size * 0.42)}px">${initials}</span>`;
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.account-menu { position: relative; display: inline-flex; }
.account-menu button { font: inherit; cursor: pointer; }
.am-trigger {
  display: inline-flex; align-items: center; gap: 7px;
  height: 30px; padding: 0 10px; font-size: 13px; font-weight: 500;
  color: inherit; background: var(--surface, rgba(255,255,255,0.04));
  border: 1px solid var(--border, rgba(255,255,255,0.14)); border-radius: 6px;
  cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.am-trigger:hover { border-color: var(--border-strong, rgba(255,255,255,0.24)); background: var(--surface-hover, rgba(255,255,255,0.08)); }
.am-signin {
  display: inline-flex; align-items: center;
  height: 30px; padding: 0 14px; font-size: 13px; font-weight: 500;
  color: inherit; background: var(--surface, rgba(255,255,255,0.04));
  border: 1px solid var(--border, rgba(255,255,255,0.14)); border-radius: 6px;
  transition: border-color 0.15s, background 0.15s;
}
.am-signin:hover { border-color: var(--border-strong, rgba(255,255,255,0.24)); background: var(--surface-hover, rgba(255,255,255,0.08)); }
.am-scope { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.am-caret { opacity: 0.6; font-size: 10px; }
.am-avatar { border-radius: 50%; object-fit: cover; flex: none; background: var(--accent, #6366f1); }
.am-avatar-initials { display: inline-block; text-align: center; color: #fff; font-weight: 600; }
/* Org avatar (logo or org initials) reads as an org, not a person: rounded-square. */
.am-avatar-org { border-radius: 6px; background: var(--surface, #1a1a1a); }
.am-dropdown {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 1000; min-width: 240px;
  background: var(--bg-secondary, var(--panel-bg, #16181d));
  border: 1px solid var(--border-strong, var(--border, rgba(255,255,255,0.16)));
  border-radius: 10px; padding: 6px; box-shadow: 0 12px 32px rgba(0,0,0,0.4);
}
.am-dropdown.hidden { display: none; }
.am-user { display: flex; align-items: center; gap: 10px; padding: 8px 8px 10px; }
.am-user-meta { min-width: 0; }
.am-name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.am-email { font-size: 11px; opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.am-section { border-top: 1px solid var(--border-subtle, var(--border, rgba(255,255,255,0.08))); padding: 6px 0 4px; }
.am-section-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.5; padding: 2px 8px 4px; }
.am-row {
  display: flex; align-items: center; justify-content: space-between; width: 100%;
  padding: 7px 8px; font-size: 13px; color: inherit; background: transparent;
  border: 0; border-radius: 6px; text-align: left;
}
button.am-row:hover { background: var(--overlay-medium, rgba(255,255,255,0.08)); }
.am-row.active { color: var(--accent, #818cf8); }
.am-static { opacity: 0.85; cursor: default; }
.am-check { color: var(--accent, #818cf8); }
.am-tag { font-size: 10px; opacity: 0.55; font-weight: 500; }
.am-badge { font-size: 10px; color: #f59e0b; border: 1px solid #f59e0b55; border-radius: 4px; padding: 0 4px; margin-left: 6px; }
.am-signout {
  display: block; width: 100%; margin-top: 4px; padding: 8px; font-size: 13px;
  color: inherit; background: transparent; border: 0; border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 0 0 6px 6px; text-align: left;
}
.am-signout:hover { background: var(--overlay-medium, rgba(255,255,255,0.08)); color: var(--red, #ef4444); }
.am-consent { max-width: 280px; }
.am-consent-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 2px 8px; }
.am-consent-title { font-size: 13px; font-weight: 600; }
.am-consent-opt { font-size: 11px; font-weight: 400; opacity: 0.55; }
.am-consent-body { padding: 4px 8px 2px; font-size: 11px; line-height: 1.45; opacity: 0.62; }
.am-consent-status { padding: 0 8px; font-size: 11px; min-height: 14px; color: var(--accent, #818cf8); }
.am-consent-status:empty { display: none; }
/* Accessible switch: a real checkbox drives the styled track/thumb. */
.am-switch { position: relative; display: inline-flex; flex: none; cursor: pointer; }
.am-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.am-switch-track {
  width: 34px; height: 20px; border-radius: 999px; background: var(--overlay-medium, rgba(255,255,255,0.16));
  transition: background 0.15s; display: inline-flex; align-items: center; padding: 2px; box-sizing: border-box;
}
.am-switch-thumb {
  width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 0.15s;
  box-shadow: 0 1px 2px rgba(0,0,0,0.35);
}
.am-switch input:checked + .am-switch-track { background: var(--accent, #6366f1); }
.am-switch input:checked + .am-switch-track .am-switch-thumb { transform: translateX(14px); }
.am-switch input:disabled + .am-switch-track { opacity: 0.5; }
.am-switch input:focus-visible + .am-switch-track { outline: 2px solid var(--accent, #818cf8); outline-offset: 2px; }
`;
  document.head.appendChild(style);
}
