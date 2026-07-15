import '@/styles/analyst-chat.css';
import { escapeHtml } from '@/utils/sanitize';
import { renderMarkdown } from '@/utils/markdown';
import { icon, zenLogo } from '@/utils/icons';
import { modelMark } from '@/utils/model-marks';
import { isAuthenticated, login } from '@/services/iam';
import { askAnalyst, collectContext, type AnalystMessage } from '@/services/analyst';
import type { AnalystTrace } from '@/services/analyst-transport';
import { dispatch, type AppHost, type CommandLogEntry } from '@/services/app-commands';
import { fetchRoster, selectedModel, rememberModel, type ModelRoster, type AnalystModel } from '@/services/analyst-models';

/**
 * AnalystChat — the analyst conversation surface, decoupled from where it lives.
 *
 * This is the ONE analyst code path. The floating copilot (AiAnalystDock), the
 * in-grid panel (AiAnalystPanel) and the country brief all render an AnalystChat
 * into their own root element; none reimplements the send loop. It talks to the
 * app only through the `AppHost` port and to the backend only through analyst.ts
 * (request composer) → analyst-transport.ts (the wire) and app-commands.ts (the
 * dispatcher). The chrome around it (FAB, header, resize, sidebar/split/fullscreen
 * modes) belongs to the host — AnalystChat is just the messages + composer.
 *
 * Rendering: assistant replies are Markdown, rendered by the tiny XSS-safe
 * renderer in utils/markdown.ts (bold/italic/lists/headings/code/links, with HTML
 * entities decoded once so an apostrophe never shows as `&#39;`). Live data-tool
 * results render as compact tables, not raw JSON. User text is plain (escaped).
 *
 * Auth + billing: every request forwards the caller's IAM token to Hanzo
 * inference, metered to their own org/project — never a shared key. Signed-out
 * users get the OIDC sign-in prompt (AI is per-user IAM billed).
 */

export interface AnalystChatOptions {
  chips?: string[];
  emptyTitle?: string;
  placeholder?: string;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  /** Human label of the model that produced an assistant reply (shown as a tag). */
  model?: string;
}

const DEFAULT_CHIPS = ['Top risk today', 'Market summary', 'Hide all panels, show news'];
const THINK_PHASES = ['is thinking…', 'reading live feeds…', 'grounding in market data…', 'composing…'];

export class AnalystChat {
  private messages: ChatMsg[] = [];
  private listEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private modelBtnEl: HTMLButtonElement | null = null;
  private modelMenuEl: HTMLElement | null = null;
  private closeModelMenu: (() => void) | null = null;
  private sendBtnEl: HTMLButtonElement | null = null;
  private roster: ModelRoster | null = null;
  private model = '';
  private sending = false;
  private thinkTimer: ReturnType<typeof setInterval> | null = null;

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
      <div class="hzc-chat">
        <div class="hzc-messages"></div>
        <form class="hzc-composer" autocomplete="off">
          <textarea class="hzc-input" rows="1" placeholder="${escapeHtml(this.opts.placeholder || 'Ask anything. Update your world.')}"></textarea>
          <div class="hzc-composer-bar">
            <button class="hzc-model" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Model">
              <span class="hzc-model-mark"></span>
              <span class="hzc-model-name"></span>
              ${icon('chevron-down', 12, 'hzc-model-caret')}
            </button>
            <button class="hzc-send" type="submit" aria-label="Send">${icon('arrow-up', 17)}</button>
          </div>
        </form>
      </div>`;
    this.listEl = this.root.querySelector('.hzc-messages');
    this.inputEl = this.root.querySelector('.hzc-input');
    this.modelBtnEl = this.root.querySelector('.hzc-model');
    this.sendBtnEl = this.root.querySelector('.hzc-send');

    this.root.querySelector('.hzc-composer')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.send();
    });
    this.inputEl?.addEventListener('input', () => this.autoGrow());
    this.inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.send();
      }
    });
    this.modelBtnEl?.addEventListener('click', () => this.toggleModelMenu());

    if (this.roster) this.renderModelOptions(); // instant paint from cache
    void this.loadModels();
    this.renderAll();
  }

  /** Focus the composer (used when the copilot opens). */
  /** Ask a question programmatically — drives the SAME send path as typing. */
  public ask(text: string): void {
    if (!this.inputEl) return;
    this.inputEl.value = text;
    void this.send();
  }

  public focus(): void {
    this.inputEl?.focus();
  }

  // ── models ─────────────────────────────────────────────────────────────────

  private async loadModels(): Promise<void> {
    const roster = await fetchRoster();
    this.roster = roster;
    if (!this.model || !roster.models.some((m) => m.id === this.model)) {
      this.model = selectedModel(roster);
    }
    this.renderModelOptions();
  }

  private renderModelOptions(): void {
    const btn = this.modelBtnEl;
    if (!btn) return;
    const mark = btn.querySelector('.hzc-model-mark');
    const name = btn.querySelector('.hzc-model-name');
    if (mark) mark.innerHTML = modelMark(this.model, 13);
    if (name) name.textContent = this.modelLabel();
    if (this.modelMenuEl) this.renderModelMenu(); // repaint an open menu in place
  }

  /** The grouped model menu — a listbox popover above the pill (a native
   *  <select> can't render per-model marks). One row per model: mark, label,
   *  check on the active id. */
  private toggleModelMenu(): void {
    if (this.closeModelMenu) {
      this.closeModelMenu();
      return;
    }
    const btn = this.modelBtnEl;
    if (!btn || !this.roster) return;
    const menu = document.createElement('div');
    menu.className = 'hzc-model-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', 'Model');
    this.modelMenuEl = menu;
    this.renderModelMenu();
    // Fixed-position above the pill: panels clip overflow, so an absolutely
    // positioned child could never escape the composer. Anchored once on open;
    // any scroll/resize just closes it (outside-pointer handler).
    const r = btn.getBoundingClientRect();
    menu.style.left = `${Math.round(r.left)}px`;
    menu.style.bottom = `${Math.round(window.innerHeight - r.top + 6)}px`;
    document.body.appendChild(menu);
    btn.setAttribute('aria-expanded', 'true');

    const onDoc = (e: Event) => {
      if (e.target instanceof Node && (menu.contains(e.target) || btn.contains(e.target))) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const close = () => {
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey, true);
      menu.remove();
      this.modelMenuEl = null;
      this.closeModelMenu = null;
      btn.setAttribute('aria-expanded', 'false');
    };
    this.closeModelMenu = close;
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
  }

  private renderModelMenu(): void {
    const menu = this.modelMenuEl;
    if (!menu || !this.roster) return;
    const groups = new Map<string, AnalystModel[]>();
    for (const m of this.roster.models) {
      const g = groups.get(m.group) || [];
      g.push(m);
      groups.set(m.group, g);
    }
    menu.innerHTML = [...groups.entries()]
      .map(
        ([group, ms]) => `
          <div class="hzc-model-group">${escapeHtml(group)}</div>
          ${ms
            .map(
              (m) => `
            <button class="hzc-model-opt${m.id === this.model ? ' active' : ''}" type="button" role="option"
              aria-selected="${m.id === this.model}" data-id="${escapeHtml(m.id)}">
              <span class="hzc-model-opt-mark">${modelMark(m.id, 14)}</span>
              <span class="hzc-model-opt-label">${escapeHtml(m.label)}</span>
              ${m.id === this.model ? icon('check', 13, 'hzc-model-opt-check') : ''}
            </button>`,
            )
            .join('')}`,
      )
      .join('');
    menu.querySelectorAll<HTMLButtonElement>('.hzc-model-opt').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.id || '';
        if (id) {
          this.model = id;
          rememberModel(id);
          this.renderModelOptions();
        }
        this.closeModelMenu?.();
        this.inputEl?.focus();
      });
    });
  }

  /** Human label for a model id (falls back to the id itself). */
  private modelLabel(id?: string): string {
    const want = id || this.model;
    const hit = this.roster?.models.find((m) => m.id === want);
    return hit?.label || want || 'Best (auto)';
  }

  // ── auth / empty states ─────────────────────────────────────────────────────

  private renderSignedOut(): void {
    this.root.innerHTML = `
      <div class="hzc-signedout">
        <div class="hzc-signedout-mark">${zenLogo(30)}</div>
        <p class="hzc-signedout-title">Sign in to chat with the analyst</p>
        <p class="hzc-signedout-sub">Ask about your live world data, or tell the analyst to rearrange the dashboard.</p>
        <button class="hzc-signin" type="button">Sign in</button>
      </div>`;
    this.root.querySelector('.hzc-signin')?.addEventListener('click', () => void login());
  }

  private renderAll(): void {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';
    if (!this.messages.length) {
      this.renderEmpty();
      return;
    }
    for (const m of this.messages) this.appendMessageEl(m);
    this.scrollToEnd();
  }

  private renderEmpty(): void {
    if (!this.listEl) return;
    const chips = this.opts.chips || DEFAULT_CHIPS;
    const wrap = document.createElement('div');
    wrap.className = 'hzc-empty';
    wrap.innerHTML = `
      <div class="hzc-empty-mark">${zenLogo(34)}</div>
      <div class="hzc-empty-title">${escapeHtml(this.opts.emptyTitle || 'Chat with your live world data')}</div>
      <div class="hzc-chips">
        ${chips.map((c) => `<button class="hzc-chip" type="button">${escapeHtml(c)}</button>`).join('')}
      </div>`;
    wrap.querySelectorAll('.hzc-chip').forEach((b) => {
      b.addEventListener('click', () => {
        if (this.inputEl) this.inputEl.value = (b as HTMLElement).textContent?.trim() || '';
        void this.send();
      });
    });
    this.listEl.appendChild(wrap);
  }

  // ── message rows ────────────────────────────────────────────────────────────

  private appendMessageEl(m: ChatMsg): HTMLElement {
    const row = document.createElement('div');
    row.className = `hzc-row ${m.role}`;
    if (m.role === 'assistant') {
      const avatar = document.createElement('div');
      avatar.className = 'hzc-avatar';
      avatar.innerHTML = modelMark(m.model || this.model, 15); // the SERVING model's mark — never the Zen ring on a non-zen model
      const body = document.createElement('div');
      body.className = 'hzc-msg';
      const bubble = document.createElement('div');
      bubble.className = 'hzc-bubble hzc-md';
      bubble.innerHTML = renderMarkdown(m.content); // safe: markdown.ts escapes + sanitizes
      const meta = document.createElement('div');
      meta.className = 'hzc-meta';
      if (m.model) {
        const tag = document.createElement('span');
        tag.className = 'hzc-model-tag';
        tag.textContent = m.model;
        meta.appendChild(tag);
      }
      const copy = document.createElement('button');
      copy.className = 'hzc-copy';
      copy.type = 'button';
      copy.setAttribute('aria-label', 'Copy');
      copy.innerHTML = icon('copy', 13);
      copy.addEventListener('click', () => this.copyText(copy, m.content));
      meta.appendChild(copy);
      body.append(bubble, meta);
      row.append(avatar, body);
    } else {
      const bubble = document.createElement('div');
      bubble.className = 'hzc-bubble';
      bubble.textContent = m.content; // plain text, never markup
      row.appendChild(bubble);
    }
    this.listEl?.appendChild(row);
    return row;
  }

  private copyText(btn: HTMLButtonElement, text: string): void {
    void navigator.clipboard?.writeText(text).then(() => {
      btn.innerHTML = icon('check', 13);
      btn.classList.add('ok');
      setTimeout(() => {
        btn.innerHTML = icon('copy', 13);
        btn.classList.remove('ok');
      }, 1200);
    });
  }

  // ── send loop ───────────────────────────────────────────────────────────────

  private async send(): Promise<void> {
    if (this.sending || !this.inputEl) return;
    const text = this.inputEl.value.trim();
    if (!text) return;
    this.inputEl.value = '';
    this.autoGrow();

    if (!this.messages.length) this.listEl && (this.listEl.innerHTML = '');
    this.messages.push({ role: 'user', content: text });
    this.appendMessageEl({ role: 'user', content: text });
    this.scrollToEnd();

    this.sending = true;
    this.setBusy(true);
    this.showThinking();

    // Live streaming surface — built lazily on the FIRST event so the thinking
    // indicator covers the silent tool rounds. Purely cosmetic: the resolved
    // response below re-renders the final message through the normal path.
    const stream: { row: HTMLElement | null; text: HTMLElement | null; think: HTMLElement | null; tools: HTMLElement | null } = {
      row: null,
      text: null,
      think: null,
      tools: null,
    };
    const ensureStreamRow = () => {
      if (stream.row || !this.listEl) return;
      this.clearThinking();
      const row = document.createElement('div');
      row.className = 'hzc-row assistant hzc-streaming';
      row.innerHTML = `
        <div class="hzc-avatar hzc-avatar-live">${modelMark(this.model, 15)}</div>
        <div class="hzc-msg">
          <div class="hzc-live-tools"></div>
          <div class="hzc-stream-think"></div>
          <div class="hzc-bubble hzc-stream-text"></div>
        </div>`;
      stream.row = row;
      stream.text = row.querySelector('.hzc-stream-text');
      stream.think = row.querySelector('.hzc-stream-think');
      stream.tools = row.querySelector('.hzc-live-tools');
      this.listEl.appendChild(row);
    };

    try {
      const context = await collectContext(this.host);
      const res = await askAnalyst(
        this.messages.map((m) => ({ role: m.role, content: m.content }) as AnalystMessage),
        context,
        this.model,
        {
          onRound: () => {
            if (stream.text) stream.text.textContent = '';
            if (stream.think) stream.think.textContent = '';
          },
          onDelta: (t) => {
            ensureStreamRow();
            // Real answer text supersedes the thinking preamble.
            if (stream.think?.textContent) stream.think.textContent = '';
            if (stream.text) stream.text.textContent += t;
            this.scrollToEnd();
          },
          onThink: (t) => {
            ensureStreamRow();
            if (stream.think) stream.think.textContent += t;
            this.scrollToEnd();
          },
          onTool: (tr) => {
            ensureStreamRow();
            if (stream.tools) {
              const chip = document.createElement('span');
              chip.className = `hzc-live-tool${tr.ok ? '' : ' err'}`;
              chip.innerHTML = `${icon('database', 11)} ${escapeHtml(tr.label.split('(')[0] || tr.label)}`;
              stream.tools.appendChild(chip);
            }
            this.scrollToEnd();
          },
        },
      );
      this.clearThinking();
      stream.row?.remove(); // the final render below is the source of truth

      const usedModel = this.modelLabel(res.model);
      if (res.reply) {
        const msg: ChatMsg = { role: 'assistant', content: res.reply, model: usedModel };
        this.messages.push(msg);
        this.appendMessageEl(msg);
        this.scrollToEnd();
      }

      // Live data-tool traces the backend called to ground the answer — rendered
      // as compact tables (JSON) or text, appended as list siblings.
      if (res.traces.length) this.appendToolTraces(res.traces);

      // Execute any app commands through the ONE dispatcher; show a per-action log
      // so the dashboard re-aligns visibly with a receipt.
      if (res.actions.length) {
        const log = await dispatch(res.actions, this.host);
        if (log.length) this.appendActionLog(log);
      }

      // ALWAYS surface something — never a silent blank.
      if (!res.reply) {
        if (res.topup) this.appendTopupCTA(res);
        else if (res.reason) this.appendInline(res.reason);
        else if (res.error) this.appendError(`The analyst couldn't answer — ${res.error}.`);
        else if (res.fallback) this.appendError('The analyst is unavailable right now — please try again.');
        else if (!res.actions.length) this.appendInline('No response from the analyst.');
      } else if (res.error) {
        this.appendInline(`Note: ${res.error}`);
      }
    } catch (e) {
      this.clearThinking();
      stream.row?.remove();
      const detail = e instanceof Error && e.message ? e.message : 'network error';
      this.appendError(`The analyst is unavailable right now — ${detail}.`);
    } finally {
      this.sending = false;
      this.setBusy(false);
    }
  }

  private setBusy(busy: boolean): void {
    this.root.querySelector('.hzc-chat')?.classList.toggle('busy', busy);
    if (this.sendBtnEl) this.sendBtnEl.disabled = busy;
  }

  private autoGrow(): void {
    const el = this.inputEl;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }

  // ── streaming / thinking indicator (no SSE yet — a live, honest busy state) ──

  private showThinking(): void {
    if (!this.listEl) return;
    const el = document.createElement('div');
    el.className = 'hzc-row assistant hzc-thinking';
    el.innerHTML = `
      <div class="hzc-avatar hzc-avatar-live">${modelMark(this.model, 15)}</div>
      <div class="hzc-think"><span class="hzc-think-label"></span></div>`;
    this.listEl.appendChild(el);
    const label = el.querySelector('.hzc-think-label') as HTMLElement | null;
    const name = this.modelLabel();
    let i = 0;
    const paint = () => {
      if (label) label.textContent = `${name} ${THINK_PHASES[i % THINK_PHASES.length]}`;
      i++;
    };
    paint();
    this.thinkTimer = setInterval(paint, 2200);
    this.scrollToEnd();
  }

  private clearThinking(): void {
    if (this.thinkTimer) {
      clearInterval(this.thinkTimer);
      this.thinkTimer = null;
    }
    this.listEl?.querySelector('.hzc-thinking')?.remove();
  }

  // ── inline notices ──────────────────────────────────────────────────────────

  private appendInline(text: string): void {
    if (!this.listEl) return;
    const el = document.createElement('div');
    el.className = 'hzc-inline';
    el.textContent = text;
    this.listEl.appendChild(el);
    this.scrollToEnd();
  }

  private appendError(text: string): void {
    if (!this.listEl) return;
    const el = document.createElement('div');
    el.className = 'hzc-inline hzc-error';
    el.textContent = text;
    this.listEl.appendChild(el);
    this.scrollToEnd();
  }

  /** Out-of-credits prompt: the backend saw the ONE 402 insufficient_balance
   *  contract and set topup. Render a wallet CTA (Add credits → billing, and a
   *  usage link) in place of a dead bubble. Links carry the backend-provided
   *  URLs so the destination stays owned by one place (console.hanzo.ai/billing),
   *  never hardcoded per-surface. */
  private appendTopupCTA(res: { reason?: string; billingUrl?: string; usageUrl?: string }): void {
    if (!this.listEl) return;
    const wrap = document.createElement('div');
    wrap.className = 'hzc-inline hzc-topup';

    const msg = document.createElement('div');
    msg.className = 'hzc-topup-msg';
    msg.textContent = res.reason || "You're out of AI credits";
    wrap.appendChild(msg);

    const actions = document.createElement('div');
    actions.className = 'hzc-topup-actions';
    const add = document.createElement('a');
    add.className = 'hzc-topup-btn';
    add.textContent = 'Add credits';
    add.href = res.billingUrl || 'https://console.hanzo.ai/billing';
    add.target = '_blank';
    add.rel = 'noopener';
    actions.appendChild(add);
    if (res.usageUrl) {
      const usage = document.createElement('a');
      usage.className = 'hzc-topup-link';
      usage.textContent = 'View usage';
      usage.href = res.usageUrl;
      usage.target = '_blank';
      usage.rel = 'noopener';
      actions.appendChild(usage);
    }
    wrap.appendChild(actions);
    this.listEl.appendChild(wrap);
    this.scrollToEnd();
  }

  /** Render the backend's data-tool traces as collapsed rows; a JSON result
   *  becomes a compact table, everything else stays monospaced text. All server
   *  data is written via textContent — never trusted as markup. */
  private appendToolTraces(traces: AnalystTrace[]): void {
    if (!this.listEl) return;
    const wrap = document.createElement('div');
    wrap.className = 'hzc-tools';
    for (const tr of traces) {
      const d = document.createElement('details');
      d.className = `hzc-tool ${tr.ok ? 'ok' : 'err'}`;
      d.open = true; // data renders inline (a table), not hidden behind a click
      const summary = document.createElement('summary');
      summary.className = 'hzc-tool-summary';
      const mark = document.createElement('span');
      mark.className = 'hzc-tool-mark';
      mark.innerHTML = icon('database', 13);
      const lab = document.createElement('span');
      lab.className = 'hzc-tool-label';
      lab.textContent = tr.label;
      summary.append(mark, lab);
      d.appendChild(summary);
      d.appendChild(renderToolResult(tr));
      wrap.appendChild(d);
    }
    this.listEl.appendChild(wrap);
    this.scrollToEnd();
  }

  private appendActionLog(entries: CommandLogEntry[]): void {
    if (!this.listEl) return;
    const el = document.createElement('div');
    el.className = 'hzc-actionlog';
    for (const e of entries) {
      const row = document.createElement('div');
      row.className = `hzc-action ${e.ok ? 'ok' : 'err'}`;
      const mark = document.createElement('span');
      mark.className = 'hzc-action-mark';
      mark.innerHTML = icon(e.ok ? 'check' : 'x', 12);
      const msg = document.createElement('span');
      msg.textContent = e.message;
      row.append(mark, msg);
      el.appendChild(row);
    }
    this.listEl.appendChild(el);
    this.scrollToEnd();
  }

  private scrollToEnd(): void {
    if (this.listEl) this.listEl.scrollTop = this.listEl.scrollHeight;
  }
}

// ── tool result → table (safe, textContent only) ──────────────────────────────

function renderToolResult(tr: AnalystTrace): HTMLElement {
  const raw = tr.result || (tr.ok ? '' : 'tool call failed');
  const parsed = tryParse(raw);
  if (parsed !== undefined) {
    const table = renderJson(parsed);
    if (table) return table;
  }
  const pre = document.createElement('pre');
  pre.className = 'hzc-tool-pre';
  pre.textContent = raw || '(no data returned)';
  return pre;
}

function tryParse(s: string): unknown {
  const t = s.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/** Best-effort compact table for JSON tool output. Returns null when the shape
 *  isn't tabular so the caller falls back to text. */
function renderJson(v: unknown): HTMLElement | null {
  if (Array.isArray(v) && v.length && v.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    const rows = v as Array<Record<string, unknown>>;
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 6);
    const table = el('table', 'hzc-table');
    const thead = el('thead');
    const htr = el('tr');
    for (const c of cols) htr.appendChild(th(c));
    thead.appendChild(htr);
    const tbody = el('tbody');
    for (const r of rows.slice(0, 12)) {
      const tr = el('tr');
      for (const c of cols) tr.appendChild(td(cell(r[c])));
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    return wrapScroll(table);
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const entries = Object.entries(v as Record<string, unknown>).slice(0, 20);
    if (!entries.length) return null;
    const table = el('table', 'hzc-table hzc-table-kv');
    const tbody = el('tbody');
    for (const [k, val] of entries) {
      const tr = el('tr');
      tr.append(th(k), td(cell(val)));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return wrapScroll(table);
  }
  return null;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function el(tag: string, cls = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function th(text: string): HTMLElement {
  const e = el('th');
  e.textContent = text;
  return e;
}
function td(text: string): HTMLElement {
  const e = el('td');
  e.textContent = text;
  return e;
}
function wrapScroll(table: HTMLElement): HTMLElement {
  const w = el('div', 'hzc-table-wrap');
  w.appendChild(table);
  return w;
}
