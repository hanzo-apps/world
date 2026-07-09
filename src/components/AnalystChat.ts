import { escapeHtml } from '@/utils/sanitize';
import { isAuthenticated, login } from '@/services/iam';
import { askAnalyst, collectContext, type AnalystMessage } from '@/services/analyst';
import { applyActions, type AnalystHost } from '@/services/analyst-actions';

/**
 * AnalystChat — the analyst conversation surface, decoupled from where it lives.
 *
 * This is the ONE analyst code path. Both the dockable grid panel (AiAnalystPanel)
 * and the floating launcher (AiAnalystDock) render an AnalystChat into their own
 * root element; neither reimplements the send loop. It talks to the app only
 * through the `AnalystHost` port and to the backend only through analyst.ts /
 * analyst-actions.ts — exactly like before, just hoisted out of the Panel so a
 * second surface can reuse it verbatim.
 *
 * Auth + billing: every request forwards the caller's IAM token to Hanzo inference,
 * metered to their own org/project — never a shared key. Signed-out users get the
 * same OIDC sign-in prompt the account menu uses (AI is per-user IAM billed).
 */

export interface AnalystChatOptions {
  chips?: string[];
  emptyTitle?: string;
  placeholder?: string;
}

const DEFAULT_CHIPS = ['Top risks today', 'Market summary', 'What changed in the last hour?'];

export class AnalystChat {
  private messages: AnalystMessage[] = [];
  private listEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sending = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: AnalystHost,
    private readonly opts: AnalystChatOptions = {},
  ) {}

  /** (Re)render the surface for the current auth state. Call after sign-in too. */
  public mount(): void {
    if (!isAuthenticated()) {
      this.renderSignedOut();
      return;
    }
    this.root.innerHTML = `
      <div class="ai-analyst">
        <div class="ai-analyst-messages"></div>
        <div class="ai-analyst-composer">
          <textarea class="ai-analyst-input" rows="1" placeholder="${escapeHtml(this.opts.placeholder || 'Ask about the world…')}"></textarea>
          <button class="ai-analyst-send" type="button" aria-label="Send">↑</button>
        </div>
      </div>
    `;
    this.listEl = this.root.querySelector('.ai-analyst-messages');
    this.inputEl = this.root.querySelector('.ai-analyst-input');
    this.root.querySelector('.ai-analyst-send')?.addEventListener('click', () => void this.send());
    this.inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.send();
      }
    });
    this.renderMessages();
  }

  /** Focus the composer (used when the floating dock opens). */
  public focus(): void {
    this.inputEl?.focus();
  }

  private renderSignedOut(): void {
    this.root.innerHTML = `
      <div class="ai-analyst-signedout">
        <p>Sign in to chat with the analyst.</p>
        <button class="ai-analyst-signin" type="button">Sign in</button>
      </div>
    `;
    this.root.querySelector('.ai-analyst-signin')?.addEventListener('click', () => void login());
  }

  private renderMessages(): void {
    if (!this.listEl) return;
    if (!this.messages.length) {
      const chips = this.opts.chips || DEFAULT_CHIPS;
      this.listEl.innerHTML = `
        <div class="ai-analyst-empty">
          <div class="ai-analyst-empty-title">${escapeHtml(this.opts.emptyTitle || 'Chat with your live world data')}</div>
          <div class="ai-analyst-chips">
            ${chips.map((c) => `<button class="ai-analyst-chip" type="button">${escapeHtml(c)}</button>`).join('')}
          </div>
        </div>`;
      this.listEl.querySelectorAll('.ai-analyst-chip').forEach((b) => {
        b.addEventListener('click', () => {
          if (this.inputEl) this.inputEl.value = (b as HTMLElement).textContent?.trim() || '';
          void this.send();
        });
      });
      return;
    }
    this.listEl.innerHTML = this.messages
      .map((m) => `<div class="ai-analyst-msg ${m.role}">${formatReply(m.content)}</div>`)
      .join('');
    this.scrollToEnd();
  }

  private async send(): Promise<void> {
    if (this.sending || !this.inputEl) return;
    const text = this.inputEl.value.trim();
    if (!text) return;
    this.inputEl.value = '';
    this.messages.push({ role: 'user', content: text });
    this.renderMessages();
    this.sending = true;
    this.showTyping();

    try {
      const context = await collectContext(this.host);
      const res = await askAnalyst(this.messages, context);
      this.clearTyping();

      if (res.fallback && res.reason) {
        this.appendInline(res.reason);
        return;
      }

      const reply = res.reply || '…';
      this.messages.push({ role: 'assistant', content: reply });
      this.renderMessages();

      if (res.actions.length) {
        const echoes = await applyActions(res.actions, this.host);
        if (echoes.length) this.appendInline(echoes.join('  ·  '));
      }
    } catch {
      this.clearTyping();
      this.appendInline('The analyst is unavailable right now.');
    } finally {
      this.sending = false;
    }
  }

  private showTyping(): void {
    if (!this.listEl) return;
    const el = document.createElement('div');
    el.className = 'ai-analyst-msg assistant ai-analyst-typing';
    el.innerHTML = '<span></span><span></span><span></span>';
    this.listEl.appendChild(el);
    this.scrollToEnd();
  }

  private clearTyping(): void {
    this.listEl?.querySelector('.ai-analyst-typing')?.remove();
  }

  private appendInline(text: string): void {
    if (!this.listEl) return;
    const el = document.createElement('div');
    el.className = 'ai-analyst-inline';
    el.textContent = text;
    this.listEl.appendChild(el);
    this.scrollToEnd();
  }

  private scrollToEnd(): void {
    if (this.listEl) this.listEl.scrollTop = this.listEl.scrollHeight;
  }
}

/** Escape, wrap standalone numbers in Geist Mono, and keep line breaks. */
function formatReply(text: string): string {
  return escapeHtml(text)
    .replace(/(\$?\b\d[\d,]*\.?\d*%?)/g, '<span class="ai-analyst-num">$1</span>')
    .replace(/\n/g, '<br>');
}
