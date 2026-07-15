import '@/styles/analyst-chat.css';
import { AnalystChat } from './AnalystChat';
import { icon, zenLogo } from '@/utils/icons';
import type { AnalystHost } from '@/services/analyst-actions';

/**
 * AiAnalystDock — the always-available floating analyst copilot.
 *
 * Closed, it is a small Zen-mark FAB bottom-right. Opened, it becomes a real
 * copilot you keep chatting in while driving the dashboard, in one of four
 * layouts the header toggles:
 *   • dock       — a floating card in the bottom-right corner (FAB's spot).
 *   • sidebar    — a full-height right rail; the dashboard reflows to the left.
 *   • split      — chat takes the right half, the dashboard the left.
 *   • fullscreen — chat covers the viewport.
 * Sidebar/split shrink #app via `body.hzc-shift` + the `--hzc-width` var (see
 * analyst-chat.css) — the app grid is auto-fit full-width, so it reflows cleanly.
 * The left edge is a drag handle (dock + sidebar). Mode, width and open-state
 * persist, so a variant switch that reloads the page reopens the same rail.
 *
 * It hosts an AnalystChat — the SAME analyst code path as the in-grid panel and
 * the country brief. The only thing the dock owns is where the chat lives.
 */

type Mode = 'dock' | 'sidebar' | 'split' | 'fullscreen';

const LS = { open: 'hzc-open', mode: 'hzc-mode', width: 'hzc-width' } as const;
const MODE_ICON: Record<Mode, Parameters<typeof icon>[0]> = {
  dock: 'pip',
  sidebar: 'panel-right',
  split: 'columns-2',
  fullscreen: 'maximize',
};
const MODE_LABEL: Record<Mode, string> = {
  dock: 'Dock',
  sidebar: 'Sidebar',
  split: 'Split view',
  fullscreen: 'Fullscreen',
};
const MIN_W = 320;
const MAX_W = 760;
const DEFAULT_W = 408;

export class AiAnalystDock {
  private readonly el: HTMLElement;
  private readonly panelEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly chat: AnalystChat;
  private open = false;
  private mode: Mode = 'sidebar';
  private width = DEFAULT_W;

  private readonly onDocClick = (e: MouseEvent) => {
    // Only the small floating card auto-closes on an outside click; the persistent
    // rails stay open so you can keep chatting while using the dashboard.
    if (this.open && this.mode === 'dock' && !this.el.contains(e.target as Node)) this.close();
  };
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.open && (this.mode === 'dock' || this.mode === 'fullscreen')) this.close();
  };

  constructor(host: AnalystHost) {
    this.mode = this.readMode();
    this.width = this.readWidth();

    this.el = document.createElement('div');
    this.el.className = 'hzc';
    this.el.innerHTML = `
      <section class="hzc-panel" role="dialog" aria-label="AI analyst" hidden>
        <div class="hzc-resize" aria-hidden="true"></div>
        <header class="hzc-head">
          <span class="hzc-head-brand">${zenLogo(16)}<span class="hzc-head-title">Analyst</span></span>
          <div class="hzc-modes" role="group" aria-label="Chat layout">
            ${(Object.keys(MODE_ICON) as Mode[])
              .map((m) => `<button class="hzc-mode-btn" type="button" data-mode="${m}" aria-label="${MODE_LABEL[m]}" title="${MODE_LABEL[m]}">${icon(MODE_ICON[m], 15)}</button>`)
              .join('')}
          </div>
          <button class="hzc-close" type="button" aria-label="Close">${icon('x', 16)}</button>
        </header>
        <div class="hzc-body"></div>
      </section>
      <button class="hzc-fab" type="button" aria-label="Open AI analyst" aria-expanded="false">${zenLogo(22)}</button>`;

    this.panelEl = this.el.querySelector('.hzc-panel') as HTMLElement;
    this.bodyEl = this.el.querySelector('.hzc-body') as HTMLElement;
    this.chat = new AnalystChat(this.bodyEl, host, {
      emptyTitle: 'Ask about this dashboard — or tell me to change it',
      placeholder: 'Ask anything. Update your world.',
    });

    this.el.querySelector('.hzc-fab')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    this.el.querySelector('.hzc-close')?.addEventListener('click', () => this.close());
    this.el.querySelectorAll<HTMLButtonElement>('.hzc-mode-btn').forEach((b) => {
      b.addEventListener('click', () => this.setMode(b.dataset.mode as Mode));
    });
    this.wireResize();
  }

  /** Attach the copilot to the page (call once from App). Reopens the saved rail. */
  public attach(parent: HTMLElement = document.body): void {
    parent.appendChild(this.el);
    document.addEventListener('click', this.onDocClick);
    document.addEventListener('keydown', this.onKey);
    this.applyWidthVar();
    if (this.readOpen()) this.openDock();
  }

  private toggle(): void {
    this.open ? this.close() : this.openDock();
  }

  private openDock(): void {
    // Re-mount every open so the surface reflects the CURRENT auth state; the
    // chat keeps its history across re-mounts, so the conversation survives.
    this.chat.mount();
    this.panelEl.hidden = false;
    this.open = true;
    this.applyMode();
    this.el.querySelector('.hzc-fab')?.setAttribute('aria-expanded', 'true');
    try {
      localStorage.setItem(LS.open, '1');
    } catch {
      /* private mode */
    }
    requestAnimationFrame(() => this.chat.focus());
  }

  private close(): void {
    this.panelEl.hidden = true;
    this.open = false;
    document.body.classList.remove('hzc-open', 'hzc-shift', 'hzc-mode-dock', 'hzc-mode-sidebar', 'hzc-mode-split', 'hzc-mode-fullscreen');
    this.el.querySelector('.hzc-fab')?.setAttribute('aria-expanded', 'false');
    try {
      localStorage.setItem(LS.open, '0');
    } catch {
      /* private mode */
    }
    this.reflowMap();
  }

  private setMode(mode: Mode): void {
    if (!MODE_LABEL[mode]) return;
    this.mode = mode;
    try {
      localStorage.setItem(LS.mode, mode);
    } catch {
      /* private mode */
    }
    if (this.open) this.applyMode();
    else this.applyWidthVar();
  }

  /** Push the layout state onto <body> so the CSS drives panel + #app reflow. */
  private applyMode(): void {
    const body = document.body;
    body.classList.add('hzc-open');
    body.classList.remove('hzc-mode-dock', 'hzc-mode-sidebar', 'hzc-mode-split', 'hzc-mode-fullscreen');
    body.classList.add(`hzc-mode-${this.mode}`);
    body.classList.toggle('hzc-shift', this.mode === 'sidebar' || this.mode === 'split');
    this.applyWidthVar();
    this.el.querySelectorAll<HTMLButtonElement>('.hzc-mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === this.mode);
      b.setAttribute('aria-pressed', String(b.dataset.mode === this.mode));
    });
    this.reflowMap();
  }

  private applyWidthVar(): void {
    document.documentElement.style.setProperty('--hzc-width', `${this.width}px`);
  }

  // ── edge resize (dock + sidebar) ─────────────────────────────────────────────

  private wireResize(): void {
    const handle = this.el.querySelector('.hzc-resize') as HTMLElement;
    let dragging = false;
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const w = Math.max(MIN_W, Math.min(MAX_W, window.innerWidth - e.clientX));
      this.width = Math.round(w);
      this.applyWidthVar();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('hzc-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      try {
        localStorage.setItem(LS.width, String(this.width));
      } catch {
        /* private mode */
      }
      this.reflowMap();
    };
    handle.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'dock' && this.mode !== 'sidebar') return;
      dragging = true;
      document.body.classList.add('hzc-resizing');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      e.preventDefault();
    });
  }

  /** Nudge map/canvas widgets to re-fit after the app area reflows. */
  private reflowMap(): void {
    // Let the CSS width transition settle, then fire the resize the map listens for.
    setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 320);
  }

  // ── persistence ──────────────────────────────────────────────────────────────

  private readOpen(): boolean {
    try {
      return localStorage.getItem(LS.open) === '1';
    } catch {
      return false;
    }
  }
  private readMode(): Mode {
    try {
      const m = localStorage.getItem(LS.mode) as Mode | null;
      return m && MODE_LABEL[m] ? m : 'sidebar';
    } catch {
      return 'sidebar';
    }
  }
  private readWidth(): number {
    try {
      const w = Number(localStorage.getItem(LS.width));
      return Number.isFinite(w) && w >= MIN_W && w <= MAX_W ? w : DEFAULT_W;
    } catch {
      return DEFAULT_W;
    }
  }

  /** Open the dock and ask the analyst a question (used by the Summarize menu). */
  public askInDock(text: string): void {
    if (!this.open) this.openDock();
    this.chat.ask(text);
  }

  public destroy(): void {
    document.removeEventListener('click', this.onDocClick);
    document.removeEventListener('keydown', this.onKey);
    document.body.classList.remove('hzc-open', 'hzc-shift', 'hzc-mode-dock', 'hzc-mode-sidebar', 'hzc-mode-split', 'hzc-mode-fullscreen');
    this.el.remove();
  }
}
