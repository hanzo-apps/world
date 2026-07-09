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

const STYLE_ID = 'account-menu-styles';

export class AccountMenu {
  private element: HTMLElement;
  private user: IamUser | null = null;
  private scope: OrgScope | null = null;
  private open = false;
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
      return;
    }
    this.user = await getUser();
    if (!this.user) {
      this.renderSignedOut();
      return;
    }
    this.scope = await resolveScope();
    this.render();
  }

  private close(): void {
    this.open = false;
    const dd = this.element.querySelector('.am-dropdown');
    dd?.classList.add('hidden');
  }

  private renderSignedOut(): void {
    // Primary CTA (shared .hz-cta pill): signed-out users see one clear
    // "Try Hanzo World" action that runs the same OIDC login the account chip uses.
    this.element.innerHTML = `<button class="am-cta hz-cta" type="button">Try Hanzo World</button>`;
    this.element.querySelector('.am-cta')?.addEventListener('click', () => void login());
  }

  private render(): void {
    const u = this.user!;
    const s = this.scope;
    const label = s ? `${orgName(s)}${s.currentProject ? ` / ${projectName(s)}` : ''}` : (u.owner || 'account');

    this.element.innerHTML = `
      <button class="am-trigger" type="button" aria-haspopup="true">
        ${avatar(u)}
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
  const src = u.name || u.email || u.sub || '?';
  const initials = src
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?';
  return `<span class="am-avatar am-avatar-initials" style="width:${size}px;height:${size}px;line-height:${size}px;font-size:${Math.round(size * 0.42)}px">${initials}</span>`;
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
.am-scope { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.am-caret { opacity: 0.6; font-size: 10px; }
.am-avatar { border-radius: 50%; object-fit: cover; flex: none; background: var(--accent, #6366f1); }
.am-avatar-initials { display: inline-block; text-align: center; color: #fff; font-weight: 600; }
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
`;
  document.head.appendChild(style);
}
