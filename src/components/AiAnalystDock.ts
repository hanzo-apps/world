import { AnalystChat } from './AnalystChat';
import { icon } from '@/utils/icons';
import type { AnalystHost } from '@/services/analyst-actions';

/**
 * AiAnalystDock — the always-available floating analyst launcher.
 *
 * A subtle round button, bottom-right, on every variant. Clicking opens an overlay
 * chat dock (a floating card, not a grid panel) so the analyst is reachable even
 * when the in-grid AiAnalystPanel is hidden or absent. It hosts an AnalystChat —
 * the SAME analyst code path as the panel (same action executor, same backend
 * client), so there is no forked logic: the only difference is where the chat is
 * mounted.
 *
 * Signed-out users still see the launcher; opening it shows AnalystChat's sign-in
 * prompt (AI is per-user IAM billed — no shared key).
 */
export class AiAnalystDock {
  private readonly el: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly chat: AnalystChat;
  private open = false;
  private readonly onDocClick = (e: MouseEvent) => {
    if (this.open && !this.el.contains(e.target as Node)) this.close();
  };
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.open) this.close();
  };

  constructor(host: AnalystHost) {
    this.el = document.createElement('div');
    this.el.className = 'ai-dock';
    this.el.innerHTML = `
      <div class="ai-dock-panel" role="dialog" aria-label="AI analyst" hidden>
        <div class="ai-dock-head">
          <span class="ai-dock-title">${icon('zen', 15)}<span>AI analyst</span></span>
          <button class="ai-dock-close" type="button" aria-label="Close">✕</button>
        </div>
        <div class="ai-dock-body"></div>
      </div>
      <button class="ai-dock-fab" type="button" aria-label="Open AI analyst" aria-expanded="false">
        ${icon('zen', 20)}
      </button>
    `;
    this.bodyEl = this.el.querySelector('.ai-dock-body') as HTMLElement;
    this.chat = new AnalystChat(this.bodyEl, host, {
      emptyTitle: 'Ask about this dashboard — or tell me to change it',
      placeholder: 'Ask the analyst…',
    });

    this.el.querySelector('.ai-dock-fab')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    this.el.querySelector('.ai-dock-close')?.addEventListener('click', () => this.close());
  }

  /** Attach the launcher to the page (call once from App). */
  public attach(parent: HTMLElement = document.body): void {
    parent.appendChild(this.el);
    document.addEventListener('click', this.onDocClick);
    document.addEventListener('keydown', this.onKey);
  }

  private toggle(): void {
    this.open ? this.close() : this.openDock();
  }

  private openDock(): void {
    // Re-mount every open so the surface reflects the CURRENT auth state (e.g. a
    // sign-in that happened since last open). AnalystChat keeps its message
    // history across re-mounts, so the conversation is preserved.
    this.chat.mount();
    const panel = this.el.querySelector('.ai-dock-panel') as HTMLElement;
    const fab = this.el.querySelector('.ai-dock-fab') as HTMLElement;
    panel.hidden = false;
    this.el.classList.add('open');
    fab.setAttribute('aria-expanded', 'true');
    this.open = true;
    requestAnimationFrame(() => this.chat.focus());
  }

  private close(): void {
    const panel = this.el.querySelector('.ai-dock-panel') as HTMLElement;
    const fab = this.el.querySelector('.ai-dock-fab') as HTMLElement;
    panel.hidden = true;
    this.el.classList.remove('open');
    fab.setAttribute('aria-expanded', 'false');
    this.open = false;
  }

  public destroy(): void {
    document.removeEventListener('click', this.onDocClick);
    document.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }
}
