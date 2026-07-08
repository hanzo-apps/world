import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { isAuthenticated, login } from '@/services/iam';
import { askAnalyst, collectContext, type AnalystMessage } from '@/services/analyst';
import { applyActions, type AnalystHost } from '@/services/analyst-actions';

/**
 * AI Analyst panel — chat with your live world data.
 *
 * A dockable chat surface: the signed-in user asks questions ("what's driving oil
 * today?") and the analyst answers grounded in a client-composed snapshot of the
 * dashboard's live feeds. It is also the dashboard's control surface — when the
 * user asks to rearrange/add/toggle something, the backend returns typed actions
 * that `applyActions` dispatches through the `AnalystHost` port (show/hide/move
 * panels, toggle map layers, time range, variant, add an allowlisted feed panel).
 *
 * Auth + billing: every request forwards the caller's IAM token to Hanzo inference,
 * so usage meters to their own org/project — never a shared key. Signed-out users
 * get a "sign in" prompt that triggers the same OIDC login the account menu uses.
 *
 * FUTURE SCOPE (not built here — honest TODO): user-authored analyst "plugins" —
 * declaring new AnalystHost actions (custom panel types, saved layouts, alert
 * rules) that register into the action vocabulary on both sides of the wire. The
 * seam is deliberate: the backend prompt owns the vocabulary, `applyActions` owns
 * dispatch, and `AnalystHost` is the only coupling to the app — so a plugin would
 * extend those three points and nothing else.
 */

const CHIPS = ['Top risks today', 'Market summary', 'What changed in the last hour?'];

export class AiAnalystPanel extends Panel {
  private messages: AnalystMessage[] = [];
  private listEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sending = false;

  constructor(private readonly host: AnalystHost) {
    super({
      id: 'ai-analyst',
      title: 'AI analyst',
      trackActivity: false,
      infoTooltip: 'Chat with your live world data — ask a question, or tell the analyst to rearrange the dashboard.',
    });
    this.render();
  }

  private render(): void {
    if (!isAuthenticated()) {
      this.renderSignedOut();
      return;
    }
    this.setContent(`
      <div class="ai-analyst">
        <div class="ai-analyst-messages"></div>
        <div class="ai-analyst-composer">
          <textarea class="ai-analyst-input" rows="1" placeholder="Ask about the world…"></textarea>
          <button class="ai-analyst-send" type="button" aria-label="Send">↑</button>
        </div>
      </div>
    `);
    this.listEl = this.content.querySelector('.ai-analyst-messages');
    this.inputEl = this.content.querySelector('.ai-analyst-input');
    this.content.querySelector('.ai-analyst-send')?.addEventListener('click', () => void this.send());
    this.inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.send();
      }
    });
    this.renderMessages();
  }

  private renderSignedOut(): void {
    this.setContent(`
      <div class="ai-analyst-signedout">
        <p>Sign in to chat with the analyst.</p>
        <button class="ai-analyst-signin" type="button">Sign in</button>
      </div>
    `);
    this.content.querySelector('.ai-analyst-signin')?.addEventListener('click', () => void login());
  }

  private renderMessages(): void {
    if (!this.listEl) return;
    if (!this.messages.length) {
      this.listEl.innerHTML = `
        <div class="ai-analyst-empty">
          <div class="ai-analyst-empty-title">Chat with your live world data</div>
          <div class="ai-analyst-chips">
            ${CHIPS.map((c) => `<button class="ai-analyst-chip" type="button">${escapeHtml(c)}</button>`).join('')}
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
