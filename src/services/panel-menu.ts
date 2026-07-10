// Right-click context-menu system for the dashboard — ONE installed listener,
// per-context items, rendered as one monochrome menu. It is a thin trigger
// surface: items dispatch the SAME DOM events / call the SAME state owners the
// rest of the app already uses (panel visibility, layout, span persistence, map
// camera), so this module decides WHEN a custom menu is appropriate and renders
// it; it never owns dashboard state.
//
// Layers, most-specific first (a right-click gathers items down the stack):
//   1. Text entry (input / textarea / contenteditable) → native menu (bail).
//   2. A component item, declared with data-ctx-* attributes (news item, market
//      row, chart) → its Open/Copy actions. Panels only ANNOTATE their DOM; the
//      menu logic lives here once. This is the ONE way a component adds entries.
//   3. The map surface → Copy coordinates / Fly here / Toggle 2D-3D, via a small
//      capability port a map component registers (registerMapContextPort). A
//      right-DRAG (maplibre rotate) still bails so the gesture is preserved; only
//      a stationary right-click opens the menu.
//   4. The enclosing panel → baseline: Hide, Move to top, Size presets, Reset.
//   5. Nothing matched → native menu (untouched).

import { setSpanClass, savePanelSpan, currentSpan } from '@/components/Panel';

const MENU_ID = 'panelContextMenu';

// A menu is a flat list of entries: actionable items, separators, and quiet
// group labels. One renderer handles all three.
type MenuEntry =
  | { kind?: 'item'; label: string; run: () => void; disabled?: boolean }
  | { kind: 'sep' }
  | { kind: 'label'; label: string };

// ── Map capability port (registered by the map component) ────────────────────

/** The narrow map capabilities the map context menu drives. A map component
 *  registers ONE of these; the menu never reaches into map internals. */
export interface MapContextPort {
  getProjectionMode(): '2d' | '3d';
  setProjectionMode(mode: '2d' | '3d'): void;
  getCenter(): { lat: number; lon: number } | null;
  /** Viewport point → geographic coords; null when unsupported (SVG fallback). */
  screenToLngLat(clientX: number, clientY: number): { lat: number; lon: number } | null;
  /** Fly the camera to centre on lat/lon. */
  flyTo(lat: number, lon: number): void;
}

let mapPort: MapContextPort | null = null;

/** Install (or clear) the map capability port. The one wiring point the map uses. */
export function registerMapContextPort(port: MapContextPort | null): void {
  mapPort = port;
}

// ── Size presets (the five real span tiers, friendly-named) ──────────────────

// Maps 1:1 onto Panel's span tiers (PANEL_SPAN_HEIGHTS = 120/200/400/600/800px).
const SIZE_PRESETS: Array<{ label: string; span: number }> = [
  { label: 'Tiny', span: 0 },
  { label: 'Normal', span: 1 },
  { label: 'Tall', span: 2 },
  { label: 'Wide', span: 3 },
  { label: 'Full', span: 4 },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function isTextEntry(el: Element | null): boolean {
  return !!el?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');
}

function isMapSurface(el: Element | null): boolean {
  // Map canvas / deck.gl overlay / maplibre container — the interactive surface.
  return !!el?.closest('.map-container, .maplibregl-map, .mapboxgl-map, canvas');
}

/** Copy to clipboard with an execCommand fallback for insecure/legacy contexts. */
function copyText(text: string): void {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    return;
  }
  fallbackCopy(text);
}

function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch {
    /* best effort */
  }
  ta.remove();
}

function dispatchPanel(panel: HTMLElement, type: string, detail: Record<string, unknown>): void {
  panel.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
}

// ── Item builders (one per context) ──────────────────────────────────────────

// Component items, driven by the data-ctx-* convention. A panel annotates a news
// item / market row / chart with these attributes; the menu builds the entries.
const CTX_SELECTOR =
  '[data-ctx-url],[data-ctx-symbol],[data-ctx-value],[data-ctx-headline],[data-ctx-latest]';

function componentItems(el: HTMLElement): MenuEntry[] {
  const d = el.dataset;
  const items: MenuEntry[] = [];
  if (d.ctxUrl) {
    const url = d.ctxUrl;
    items.push({ label: 'Open link', run: () => window.open(url, '_blank', 'noopener') });
    items.push({ label: 'Copy link', run: () => copyText(url) });
  }
  if (d.ctxHeadline) items.push({ label: 'Copy headline', run: () => copyText(d.ctxHeadline!) });
  if (d.ctxValue) items.push({ label: 'Copy value', run: () => copyText(d.ctxValue!) });
  if (d.ctxSymbol) items.push({ label: 'Copy symbol', run: () => copyText(d.ctxSymbol!) });
  if (d.ctxLatest) items.push({ label: 'Copy latest value', run: () => copyText(d.ctxLatest!) });
  return items;
}

function mapItems(event: MouseEvent): MenuEntry[] {
  const port = mapPort;
  if (!port) return [];
  const items: MenuEntry[] = [];
  const at = port.screenToLngLat(event.clientX, event.clientY) ?? port.getCenter();
  if (at) {
    const coord = `${at.lat.toFixed(4)}, ${at.lon.toFixed(4)}`;
    items.push({ label: 'Copy coordinates', run: () => copyText(coord) });
    items.push({ label: 'Fly here', run: () => port.flyTo(at.lat, at.lon) });
  }
  const mode = port.getProjectionMode();
  items.push({
    label: mode === '3d' ? 'Switch to 2D map' : 'Switch to 3D globe',
    run: () => port.setProjectionMode(mode === '3d' ? '2d' : '3d'),
  });
  return items;
}

function panelBaseline(panel: HTMLElement): MenuEntry[] {
  const key = panel.dataset.panel;
  const items: MenuEntry[] = [];
  if (key) {
    items.push({ label: 'Hide panel', run: () => dispatchPanel(panel, 'panel-close-request', { id: key }) });
    // live-news spans two columns and is pinned first; the map has its own anchor
    // — neither participates in move-to-top.
    if (key !== 'live-news' && key !== 'map') {
      items.push({
        label: 'Move to top',
        run: () => dispatchPanel(panel, 'panel-move-request', { id: key, position: 'top' }),
      });
    }
  }
  items.push({ kind: 'label', label: 'Size' });
  const cur = currentSpan(panel);
  for (const preset of SIZE_PRESETS) {
    items.push({
      label: preset.label,
      disabled: preset.span === cur,
      run: () => applySize(panel, preset.span),
    });
  }
  items.push({ label: 'Reset layout', run: () => dispatchPanel(panel, 'panel-reset-layout-request', {}) });
  return items;
}

// Apply a span tier the SAME way App.resizePanelInGrid does — setSpanClass +
// savePanelSpan — so a size chosen from the menu persists identically.
function applySize(panel: HTMLElement, span: number): void {
  setSpanClass(panel, span);
  const key = panel.dataset.panel;
  if (key) savePanelSpan(key, span);
}

// ── Right-button drag tracking (keep maplibre rotate) ────────────────────────

let rightDownAt: { x: number; y: number } | null = null;
let rightDragged = false;
const DRAG_THRESHOLD = 5; // px — beyond this a right-press is a rotate-drag, not a click

// ── Install ──────────────────────────────────────────────────────────────────

export function installPanelContextMenu(): void {
  if ((window as unknown as Record<string, boolean>).__panelMenuInstalled) return;
  (window as unknown as Record<string, boolean>).__panelMenuInstalled = true;

  let menuEl: HTMLElement | null = null;

  const close = (): void => {
    if (!menuEl) return;
    menuEl.remove();
    menuEl = null;
    document.removeEventListener('pointerdown', onDocPointer, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close, true);
    window.removeEventListener('blur', close);
  };

  const onDocPointer = (e: PointerEvent): void => {
    if (menuEl && !menuEl.contains(e.target as Node)) close();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };

  const open = (x: number, y: number, entries: MenuEntry[]): void => {
    close();
    const el = document.createElement('div');
    el.id = MENU_ID;
    el.className = 'panel-context-menu';
    el.setAttribute('role', 'menu');
    for (const entry of entries) {
      if (entry.kind === 'sep') {
        const sep = document.createElement('div');
        sep.className = 'panel-context-menu-sep';
        el.appendChild(sep);
        continue;
      }
      if (entry.kind === 'label') {
        const lbl = document.createElement('div');
        lbl.className = 'panel-context-menu-label';
        lbl.textContent = entry.label;
        el.appendChild(lbl);
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'panel-context-menu-item';
      btn.setAttribute('role', 'menuitem');
      btn.textContent = entry.label;
      if (entry.disabled) {
        btn.disabled = true;
      } else {
        btn.addEventListener('click', () => {
          close();
          entry.run();
        });
      }
      el.appendChild(btn);
    }
    // Off-screen measure, then clamp inside the viewport.
    el.style.visibility = 'hidden';
    document.body.appendChild(el);
    const rect = el.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - rect.width - 6);
    const py = Math.min(y, window.innerHeight - rect.height - 6);
    el.style.left = `${Math.max(6, px)}px`;
    el.style.top = `${Math.max(6, py)}px`;
    el.style.visibility = 'visible';
    menuEl = el;

    document.addEventListener('pointerdown', onDocPointer, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close, true);
    window.addEventListener('blur', close);
  };

  // Track right-button movement so a rotate-drag on the map is distinguished from
  // a stationary right-click. Read in the contextmenu handler, reset on next press.
  document.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      if (e.button === 2) {
        rightDownAt = { x: e.clientX, y: e.clientY };
        rightDragged = false;
      }
    },
    true,
  );
  document.addEventListener(
    'pointermove',
    (e: PointerEvent) => {
      if (rightDownAt && (e.buttons & 2) === 2) {
        if (Math.hypot(e.clientX - rightDownAt.x, e.clientY - rightDownAt.y) > DRAG_THRESHOLD) {
          rightDragged = true;
        }
      }
    },
    true,
  );

  document.addEventListener('contextmenu', (e: MouseEvent) => {
    const target = e.target as Element | null;
    // Never hijack the native menu for text entry.
    if (isTextEntry(target)) {
      close();
      return;
    }

    const entries: MenuEntry[] = [];

    // 1. Component items (data-ctx-*) — most specific.
    const ctxEl = target?.closest(CTX_SELECTOR) as HTMLElement | null;
    if (ctxEl) entries.push(...componentItems(ctxEl));

    // 2. Map surface — but a rotate-drag keeps the maplibre gesture (bail, native
    //    menu already suppressed by the map).
    if (isMapSurface(target)) {
      if (rightDragged) {
        close();
        return;
      }
      const mi = mapItems(e);
      if (mi.length) {
        if (entries.length) entries.push({ kind: 'sep' });
        entries.push(...mi);
      }
    }

    // 3. Enclosing panel baseline (the map section is also a .panel grid citizen).
    const panel = target?.closest('.panel, .map-section') as HTMLElement | null;
    if (panel) {
      if (entries.length) entries.push({ kind: 'sep' });
      entries.push(...panelBaseline(panel));
    }

    // Nothing matched → leave the native menu alone.
    if (!entries.length) {
      close();
      return;
    }

    e.preventDefault();
    open(e.clientX, e.clientY, entries);
  });
}
