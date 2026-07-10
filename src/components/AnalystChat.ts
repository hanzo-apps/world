import { escapeHtml } from '@/utils/sanitize';
import { isAuthenticated, login } from '@/services/iam';
import { askAnalyst, collectContext, type AnalystMessage } from '@/services/analyst';
import type { AnalystTrace } from '@/services/analyst-transport';
import { dispatch, type AppHost, type CommandLogEntry } from '@/services/app-commands';
import { fetchRoster, selectedModel, rememberModel, type ModelRoster, type AnalystModel } from '@/services/analyst-models';

/**
 * AnalystChat — the analyst conversation surface, decoupled from where it lives.
 *
 * This is the ONE analyst code path. Both the dockable grid panel (AiAnalystPanel)
 * and the floating launcher (AiAnalystDock) render an AnalystChat into their own
 * root element; neither reimplements the send loop. It talks to the app only
 * through the `AppHost` port and to the backend only through analyst.ts (request
 * composer) → analyst-transport.ts (the wire) and app-commands.ts (the dispatcher).
 *
 * Model picker: a monochrome dropdown (Zen family first, then whatever the signed-in
 * user can serve) sits in the chat toolbar; the choice persists and rides every
 * request. Errors are ALWAYS surfaced — a failed/empty backend reply shows the
 * reason inline, never a silent blank.
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
  private modelSelectEl: HTMLSelectElement | null = null;
  private roster: ModelRoster | null = null;
  private model = '';
  private sending = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: AppHost,
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
        <div class="ai-analyst-toolbar">
          <label class="ai-analyst-model-wrap">
            <span class="ai-analyst-model-label">Model</span>
            <select class="ai-analyst-model" aria-label="Analyst model"></select>
          </label>
        </div>
        <div class="ai-analyst-messages"></div>
        <div class="ai-analyst-composer">
          <textarea class="ai-analyst-input" rows="1" placeholder="${escapeHtml(this.opts.placeholder || 'Ask about the world…')}"></textarea>
          <button class="ai-analyst-send" type="button" aria-label="Send">↑</button>
        </div>
      </div>
    `;
    this.listEl = this.root.querySelector('.ai-analyst-messages');
    this.inputEl = this.root.querySelector('.ai-analyst-input');
    this.modelSelectEl = this.root.querySelector('.ai-analyst-model');
    this.root.querySelector('.ai-analyst-send')?.addEventListener('click', () => void this.send());
    this.inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.send();
      }
    });
    this.modelSelectEl?.addEventListener('change', () => {
      const id = this.modelSelectEl?.value || '';
      if (id) {
        this.model = id;
        rememberModel(id);
      }
    });
    if (this.roster) this.renderModelOptions(); // instant paint from cache
    void this.loadModels();
    this.renderMessages();
  }

  /** Focus the composer (used when the floating dock opens). */
  public focus(): void {
    this.inputEl?.focus();
  }

  private async loadModels(): Promise<void> {
    const roster = await fetchRoster();
    this.roster = roster;
    if (!this.model || !roster.models.some((m) => m.id === this.model)) {
      this.model = selectedModel(roster);
    }
    this.renderModelOptions();
  }

  private renderModelOptions(): void {
    const sel = this.modelSelectEl;
    if (!sel || !this.roster) return;
    const groups = new Map<string, AnalystModel[]>();
    for (const m of this.roster.models) {
      const g = groups.get(m.group) || [];
      g.push(m);
      groups.set(m.group, g);
    }
    sel.innerHTML = [...groups.entries()]
      .map(
        ([group, ms]) =>
          `<optgroup label="${escapeHtml(group)}">${ms
            .map((m) => `<option value="${escapeHtml(m.id)}"${m.id === this.model ? ' selected' : ''}>${escapeHtml(m.label)}</option>`)
            .join('')}</optgroup>`,
      )
      .join('');
  }

  private renderSignedOut(): void {
    this.root.innerHTML = `
      <div class="ai-analyst-signedout">
        <p>Sign in to chat with the analyst.</p>
        <button class="ai-analyst-signin hz-cta hz-cta-lg" type="button">Sign in</button>
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
      const res = await askAnalyst(this.messages, context, this.model);
      this.clearTyping();

      // Render the prose reply when present.
      if (res.reply) {
        this.messages.push({ role: 'assistant', content: res.reply });
        this.renderMessages();
      }

      // Surface the live data tools the backend called to ground the answer —
      // collapsed "🔧 tool(...)" lines. Appended AFTER renderMessages (which
      // rebuilds the list from innerHTML) so they survive, exactly like the
      // action log below.
      if (res.traces.length) this.appendToolTraces(res.traces);

      // Execute any commands through the ONE dispatcher; show a per-action log.
      if (res.actions.length) {
        const log = await dispatch(res.actions, this.host);
        if (log.length) this.appendActionLog(log);
      }

      // ALWAYS surface something — never a silent blank (P0: prod 401 returned
      // {reply:"",error:"...",fallback:true} and the chat showed nothing).
      if (!res.reply) {
        if (res.reason) this.appendInline(res.reason);
        else if (res.error) this.appendError(`The analyst couldn't answer — ${res.error}.`);
        else if (res.fallback) this.appendError('The analyst is unavailable right now — please try again.');
        else if (!res.actions.length) this.appendInline('No response from the analyst.');
      } else if (res.error) {
        this.appendInline(`Note: ${res.error}`);
      }
    } catch (e) {
      this.clearTyping();
      const detail = e instanceof Error && e.message ? e.message : 'network error';
      this.appendError(`The analyst is unavailable right now — ${detail}.`);
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

  private appendError(text: string): void {
    if (!this.listEl) return;
    const el = document.createElement('div');
    el.className = 'ai-analyst-inline ai-analyst-error';
    el.textContent = text;
    this.listEl.appendChild(el);
    this.scrollToEnd();
  }

  /** Render the backend's data-tool traces as collapsed, monochrome detail lines.
   *  Server data is written via textContent (never innerHTML) — never trusted markup. */
  private appendToolTraces(traces: AnalystTrace[]): void {
    if (!this.listEl) return;
    const wrap = document.createElement('div');
    wrap.className = 'ai-analyst-tools';
    for (const tr of traces) {
      const d = document.createElement('details');
      d.className = `ai-analyst-tool ${tr.ok ? 'ok' : 'err'}`;
      const summary = document.createElement('summary');
      summary.className = 'ai-analyst-tool-summary';
      summary.textContent = `🔧 ${tr.label}`;
      const pre = document.createElement('pre');
      pre.className = 'ai-analyst-tool-result';
      pre.textContent = tr.result || (tr.ok ? '(no data returned)' : 'tool call failed');
      d.appendChild(summary);
      d.appendChild(pre);
      wrap.appendChild(d);
    }
    this.listEl.appendChild(wrap);
    this.scrollToEnd();
  }

  private appendActionLog(entries: CommandLogEntry[]): void {
    if (!this.listEl) return;
    const el = document.createElement('div');
    el.className = 'ai-analyst-actionlog';
    el.innerHTML = entries
      .map((e) => `<div class="ai-analyst-action ${e.ok ? 'ok' : 'err'}"><span class="ai-analyst-action-mark">${e.ok ? '✓' : '✗'}</span>${escapeHtml(e.message)}</div>`)
      .join('');
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
