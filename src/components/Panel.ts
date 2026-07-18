import { escapeHtml } from '../utils/sanitize';
import { isDesktopRuntime, canConfigureKeys } from '../services/runtime';
import { invokeTauri } from '../services/tauri-bridge';
import { t } from '../services/i18n';
import {
  attachPanelResize,
  attachPanelColResize,
  attachPanelCornerResize,
  type CornerId,
} from '../services/panel-drag';
import { getGridCols, setGridCols } from '../services/grid-config';

export interface PanelOptions {
  id: string;
  title: string;
  showCount?: boolean;
  className?: string;
  trackActivity?: boolean;
  infoTooltip?: string;
}

const PANEL_SPANS_KEY = 'worldmonitor-panel-spans';

// Row-span (height) persistence + class mapping. Exported so non-Panel grid
// citizens (the map) can reuse the exact same height mechanism — one way to size
// any grid cell.
export function loadPanelSpans(): Record<string, number> {
  try {
    const stored = localStorage.getItem(PANEL_SPANS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function savePanelSpan(panelId: string, span: number): void {
  const spans = loadPanelSpans();
  spans[panelId] = span;
  localStorage.setItem(PANEL_SPANS_KEY, JSON.stringify(spans));
}

// Row-span tier heights (px), index === span. span-0 is the tiny tier (120px);
// span-1..4 keep the established 200/400/600/800 ladder. These are the snap
// targets the height-resize drag lands on, and they mirror the CSS min-heights.
export const PANEL_SPAN_HEIGHTS = [120, 200, 400, 600, 800];

const SPAN_CLASSES = ['span-0', 'span-1', 'span-2', 'span-3', 'span-4'];

export function currentSpan(element: HTMLElement): number {
  // The live span is the source of truth (covers the uncapped span>4 tiers that
  // have no CSS class); fall back to the class ladder for legacy/first paint.
  const d = parseInt(element.dataset.span ?? '', 10);
  if (Number.isFinite(d) && d >= 0) return d;
  if (element.classList.contains('span-4')) return 4;
  if (element.classList.contains('span-3')) return 3;
  if (element.classList.contains('span-2')) return 2;
  if (element.classList.contains('span-0')) return 0;
  return 1;
}

export function setSpanClass(element: HTMLElement, span: number): void {
  element.classList.remove(...SPAN_CLASSES);
  element.dataset.span = String(span);
  if (span >= 0 && span <= 4) {
    // The common tiers own their height via the .panel.span-N CSS (with !important);
    // clear any inline geometry a previous tall size left behind.
    element.classList.add(`span-${span}`);
    element.style.gridRow = '';
    element.style.minHeight = '';
  } else {
    // Fine grid (span >4): height is the grid-row span alone (each row = 16px).
    // No inline min-height floor, so the panel is exactly as tall as the drag and
    // can hug its content — no forced blank space, smooth ~16px steps.
    element.style.gridRow = `span ${span}`;
    element.style.minHeight = '';
  }
  element.classList.add('resized');
}

export class Panel {
  protected element: HTMLElement;
  protected content: HTMLElement;
  protected header: HTMLElement;
  protected countEl: HTMLElement | null = null;
  protected statusBadgeEl: HTMLElement | null = null;
  protected newBadgeEl: HTMLElement | null = null;
  protected panelId: string;
  private tooltipCloseHandler: (() => void) | null = null;
  private resizeHandle: HTMLElement | null = null;
  private colResizeHandle: HTMLElement | null = null;
  private cornerResizeHandle: HTMLElement | null = null;
  private cornerHandles: HTMLElement[] = [];
  private resizeCleanups: Array<() => void> = [];

  constructor(options: PanelOptions) {
    this.panelId = options.id;
    this.element = document.createElement('div');
    this.element.className = `panel ${options.className || ''}`;
    this.element.dataset.panel = options.id;

    this.header = document.createElement('div');
    this.header.className = 'panel-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'panel-header-left';

    const title = document.createElement('span');
    title.className = 'panel-title';
    title.textContent = options.title;
    headerLeft.appendChild(title);

    if (options.infoTooltip) {
      const infoBtn = document.createElement('button');
      infoBtn.className = 'panel-info-btn';
      infoBtn.innerHTML = '?';
      infoBtn.setAttribute('aria-label', 'Show methodology info');

      const tooltip = document.createElement('div');
      tooltip.className = 'panel-info-tooltip';
      tooltip.innerHTML = options.infoTooltip;

      infoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        tooltip.classList.toggle('visible');
      });

      this.tooltipCloseHandler = () => tooltip.classList.remove('visible');
      document.addEventListener('click', this.tooltipCloseHandler);

      const infoWrapper = document.createElement('div');
      infoWrapper.className = 'panel-info-wrapper';
      infoWrapper.appendChild(infoBtn);
      infoWrapper.appendChild(tooltip);
      headerLeft.appendChild(infoWrapper);
    }

    // Add "new" badge element (hidden by default)
    if (options.trackActivity !== false) {
      this.newBadgeEl = document.createElement('span');
      this.newBadgeEl.className = 'panel-new-badge';
      this.newBadgeEl.style.display = 'none';
      headerLeft.appendChild(this.newBadgeEl);
    }

    this.header.appendChild(headerLeft);

    this.statusBadgeEl = document.createElement('span');
    this.statusBadgeEl.className = 'panel-data-badge';
    this.statusBadgeEl.style.display = 'none';
    this.header.appendChild(this.statusBadgeEl);

    // Hover-revealed hide affordance. Clicking it asks the app to hide this panel
    // through the SAME path the AI analyst uses (App listens for the event and
    // calls setPanelEnabled(key,false)), so hidden state lives in one place and
    // the panel restores from the Panels menu exactly like an analyst-hidden one.
    // Absolutely positioned so revealing it never reflows the header.
    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-close-btn';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Hide panel');
    closeBtn.title = 'Hide panel';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.element.dispatchEvent(
        new CustomEvent('panel-close-request', { bubbles: true, detail: { id: this.panelId } }),
      );
    });
    this.header.appendChild(closeBtn);

    if (options.showCount) {
      this.countEl = document.createElement('span');
      this.countEl.className = 'panel-count';
      // Inline after the title (left side) so it never collides with the hover-✕
      // that lives top-right. Hidden until there's a real count — a "0" while the
      // feed is still loading reads as broken.
      this.countEl.textContent = '';
      this.countEl.style.display = 'none';
      headerLeft.appendChild(this.countEl);
    }

    this.content = document.createElement('div');
    this.content.className = 'panel-content';
    this.content.id = `${options.id}Content`;

    this.element.appendChild(this.header);
    this.element.appendChild(this.content);

    // Resize affordances: bottom edge (height), right edge (width), and the
    // bottom-right corner (both). Grips are subtle until the panel is hovered.
    this.resizeHandle = document.createElement('div');
    this.resizeHandle.className = 'panel-resize-handle';
    this.resizeHandle.title = 'Drag to resize height (double-click to reset)';
    this.resizeHandle.draggable = false; // Prevent parent's drag from capturing
    this.element.appendChild(this.resizeHandle);

    this.colResizeHandle = document.createElement('div');
    this.colResizeHandle.className = 'panel-col-resize-handle';
    this.colResizeHandle.title = 'Drag to resize width';
    this.colResizeHandle.draggable = false;
    this.element.appendChild(this.colResizeHandle);

    // Corner grips at all four corners. In free mode each resizes the panel while
    // pinning the opposite corner; grid mode shows only the bottom-right (top/left
    // resize has no meaning in grid flow — the others are hidden via CSS).
    const corners: CornerId[] = ['se', 'sw', 'ne', 'nw'];
    for (const corner of corners) {
      const h = document.createElement('div');
      h.className = `panel-corner-resize-handle ${corner}`;
      h.dataset.corner = corner;
      h.title = 'Drag to resize';
      h.draggable = false;
      this.element.appendChild(h);
      this.cornerHandles.push(h);
    }
    this.cornerResizeHandle = this.cornerHandles[0]!; // 'se' — the grid-mode grip

    this.setupResizeHandlers();

    // Restore saved span. Any saved tier other than the default span-1 is applied,
    // including the new span-0 tiny tier (value 0).
    const savedSpans = loadPanelSpans();
    const savedSpan = savedSpans[this.panelId];
    if (savedSpan !== undefined && savedSpan !== 1) {
      setSpanClass(this.element, savedSpan);
    }

    this.showLoading();
  }

  private setupResizeHandlers(): void {
    if (!this.resizeHandle || !this.colResizeHandle || !this.cornerResizeHandle) return;
    const el = this.element;
    const id = this.panelId;

    // Current grid column-span, read from the live inline style (grid-config
    // restores it on load) or the persisted store.
    const startCols = (): number => {
      const m = el.style.gridColumn.match(/span\s+(\d+)/);
      if (m && m[1]) return parseInt(m[1], 10);
      return getGridCols(id) ?? 1;
    };
    const previewCols = (cols: number): void => {
      el.style.gridColumn = cols > 1 ? `span ${cols}` : '';
    };

    // Bottom edge → height. SMOOTH fine snapping: ~20px steps (16px row + 4px gap)
    // with no coarse tier ladder, so a panel drags to hug its content. minSpan 5
    // (≈100px) keeps it out of the 0–4 tier classes; height is uncapped. Free mode
    // is pixel-exact. The module owns pointer math; Panel owns span→class + persist.
    this.resizeCleanups.push(
      attachPanelResize(el, this.resizeHandle, {
        minSpan: 5,
        maxSpan: 400,
        rowPx: 20,
        getStartSpan: () => currentSpan(el),
        onPreview: (span) => setSpanClass(el, span),
        onCommit: (span) => savePanelSpan(id, span),
      }),
    );

    // Right edge → width. Grid mode snaps to whole columns (persisted in
    // grid-config); free mode is pixel-exact.
    this.resizeCleanups.push(
      attachPanelColResize(el, this.colResizeHandle, {
        getGrid: () => document.getElementById('panelsGrid'),
        getStartCols: startCols,
        onPreview: (cols) => previewCols(cols),
        onCommit: (cols) => setGridCols(id, cols),
      }),
    );

    // Corner grips → width AND height together. Free mode resizes from any of the
    // four corners (opposite corner pinned); grid mode span/column snapping runs
    // only from the bottom-right (attachPanelCornerResize no-ops the rest in grid).
    for (const handle of this.cornerHandles) {
      this.resizeCleanups.push(
        attachPanelCornerResize(el, handle, {
          corner: (handle.dataset.corner as CornerId) ?? 'se',
          getGrid: () => document.getElementById('panelsGrid'),
          getStartSpan: () => currentSpan(el),
          getStartCols: startCols,
          minSpan: 5,
          maxSpan: 400,
          rowPx: 20,
          onPreviewSpan: (span) => setSpanClass(el, span),
          onPreviewCols: (cols) => previewCols(cols),
          onCommitSpan: (span) => savePanelSpan(id, span),
          onCommitCols: (cols) => setGridCols(id, cols),
        }),
      );
    }

    // Double-click either edge handle to reset to default size.
    this.resizeHandle.addEventListener('dblclick', () => this.resetHeight());
    this.colResizeHandle.addEventListener('dblclick', () => this.resetWidth());
  }


  protected setDataBadge(state: 'live' | 'cached' | 'unavailable', detail?: string): void {
    if (!this.statusBadgeEl) return;
    // The "LIVE" text chip is retired: everything here is live by default, and a
    // static "LIVE" badge is misleading while a feed is loading/empty. Live state
    // shows only a subtle pulsing dot (no text); cached/unavailable keep their
    // informative labels — those actually tell the user something.
    if (state === 'live') {
      this.statusBadgeEl.textContent = '';
      this.statusBadgeEl.className = 'panel-data-badge live';
      this.statusBadgeEl.style.display = 'inline-flex';
      return;
    }
    const labels = {
      cached: t('common.cached'),
      unavailable: t('common.unavailable'),
    } as const;
    this.statusBadgeEl.textContent = detail ? `${labels[state]} · ${detail}` : labels[state];
    this.statusBadgeEl.className = `panel-data-badge ${state}`;
    this.statusBadgeEl.style.display = 'inline-flex';
  }

  protected clearDataBadge(): void {
    if (!this.statusBadgeEl) return;
    this.statusBadgeEl.style.display = 'none';
  }
  public getElement(): HTMLElement {
    return this.element;
  }

  public showLoading(message = t('common.loading')): void {
    this.content.innerHTML = `
      <div class="panel-loading">
        <div class="panel-loading-radar">
          <div class="panel-radar-sweep"></div>
          <div class="panel-radar-dot"></div>
        </div>
        <div class="panel-loading-text">${escapeHtml(message)}</div>
      </div>
    `;
  }

  public showError(message = t('common.failedToLoad')): void {
    this.content.innerHTML = `<div class="error-message">${escapeHtml(message)}</div>`;
  }

  public showConfigError(message: string): void {
    // The raw message names a specific server-side *_API_KEY and says "add in
    // Settings" — actionable only in the desktop app / a dev build. To a public
    // web viewer that's noise that leaks internal config for a key they can't
    // set, so degrade to the same quiet "no data" line every other empty panel
    // shows. The specific, actionable copy stays for those who can act on it.
    if (!canConfigureKeys()) {
      this.showError(t('common.noDataAvailable'));
      return;
    }
    const settingsBtn = isDesktopRuntime()
      ? '<button type="button" class="config-error-settings-btn">Open Settings</button>'
      : '';
    this.content.innerHTML = `<div class="config-error-message">${escapeHtml(message)}${settingsBtn}</div>`;
    if (isDesktopRuntime()) {
      this.content.querySelector('.config-error-settings-btn')?.addEventListener('click', () => {
        void invokeTauri<void>('open_settings_window_command').catch(() => { });
      });
    }
  }

  public setCount(count: number): void {
    if (this.countEl) {
      // Only show a real count; a "0" (loading / empty) is hidden so it never
      // looks broken and never crowds the hover-✕.
      const show = Number.isFinite(count) && count > 0;
      this.countEl.textContent = show ? count.toString() : '';
      this.countEl.style.display = show ? '' : 'none';
    }
  }

  public setErrorState(hasError: boolean, tooltip?: string): void {
    this.header.classList.toggle('panel-header-error', hasError);
    if (tooltip) {
      this.header.title = tooltip;
    } else {
      this.header.removeAttribute('title');
    }
  }

  public setContent(html: string): void {
    this.content.innerHTML = html;
  }

  public show(): void {
    this.element.classList.remove('hidden');
  }

  public hide(): void {
    this.element.classList.add('hidden');
  }

  public toggle(visible: boolean): void {
    if (visible) this.show();
    else this.hide();
  }

  /**
   * Update the "new items" badge
   * @param count Number of new items (0 hides badge)
   * @param pulse Whether to pulse the badge (for important updates)
   */
  public setNewBadge(count: number, pulse = false): void {
    if (!this.newBadgeEl) return;

    if (count <= 0) {
      this.newBadgeEl.style.display = 'none';
      this.newBadgeEl.classList.remove('pulse');
      this.element.classList.remove('has-new');
      return;
    }

    this.newBadgeEl.textContent = count > 99 ? '99+' : `${count} ${t('common.new')}`;
    this.newBadgeEl.style.display = 'inline-flex';
    this.element.classList.add('has-new');

    if (pulse) {
      this.newBadgeEl.classList.add('pulse');
    } else {
      this.newBadgeEl.classList.remove('pulse');
    }
  }

  /**
   * Clear the new items badge
   */
  public clearNewBadge(): void {
    this.setNewBadge(0);
  }

  /**
   * Get the panel ID
   */
  public getId(): string {
    return this.panelId;
  }

  /**
   * Reset panel height to default
   */
  public resetHeight(): void {
    this.element.classList.remove('resized', ...SPAN_CLASSES);
    // Also drop the uncapped-span inline geometry + tracked span so a previously
    // very-tall panel returns to the default tier.
    delete this.element.dataset.span;
    this.element.style.gridRow = '';
    this.element.style.minHeight = '';
    const spans = loadPanelSpans();
    delete spans[this.panelId];
    localStorage.setItem(PANEL_SPANS_KEY, JSON.stringify(spans));
  }

  /**
   * Reset panel width (grid column-span) to default (single column).
   */
  public resetWidth(): void {
    this.element.style.gridColumn = '';
    setGridCols(this.panelId, 1);
  }

  /**
   * Clean up event listeners and resources
   */
  public destroy(): void {
    if (this.tooltipCloseHandler) {
      document.removeEventListener('click', this.tooltipCloseHandler);
      this.tooltipCloseHandler = null;
    }
    for (const cleanup of this.resizeCleanups) cleanup();
    this.resizeCleanups = [];
  }
}
