// Layout engine: two modes for the panel grid, one mechanism, one config store.
//
//   • "grid"  (default) — the existing CSS-Grid reflow. Panels flow into cells;
//     drag reorders (FLIP), resize snaps to grid tracks. cellSize drives the
//     track floor (`--panel-col-min`), so changing it re-snaps every panel. A faint
//     overlay of the live tracks is shown only while dragging/resizing.
//   • "free" — pixel-perfect. The grid becomes a plain positioned block and each
//     panel is absolutely placed at its own {x,y,w,h}; drag follows the cursor,
//     resize is exact, nothing snaps, no overlay.
//
// This module owns ONLY the mode/config state, its persistence (per-variant),
// and the DOM application of a panel's saved geometry. All pointer math lives in
// panel-drag.ts, which reads getLayoutMode()/getCellSize() and calls back here to
// persist. Grid mode is left byte-for-byte untouched so it can never regress.

import { SITE_VARIANT } from '../config/variant';

export type LayoutMode = 'grid' | 'free';

export interface GridConfig {
  enabled: boolean;
  cellSize: number;
  gap: number;
}

export interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LayoutState {
  mode: LayoutMode;
  // True once the user has EXPLICITLY picked a mode (dock dropdown / analyst /
  // toggle). Until then the app defaults to FREE (see applyDefaultLayout) without
  // overwriting a deliberate choice. Absent in pre-migration state → false.
  userSet: boolean;
  cellSize: number;
  free: Record<string, FreeRect>;
  gridCols: Record<string, number>;
}

// Per-variant so the tech / finance / full dashboards each keep their own layout.
const STORAGE_KEY = `worldmonitor-layout:${SITE_VARIANT}`;

// px — the grid column-track floor, exposed to CSS as `--panel-col-min` (the
// variable the base .panels-grid rule and the footer dock already read). 160
// matches the pre-existing default exactly, so the grid is byte-identical until
// the slider moves it — fixed-span panels (the live-news video, .panel-wide) are
// never shrunk by default. Range mirrors the dock slider (140–360).
export const DEFAULT_CELL_SIZE = 160;
const DEFAULT_GAP = 4; // matches .panels-grid gap
// Column-track floor range for the widget-size slider. 120 (was 140) lets grid
// columns pack tighter so panels can be narrower — the "constrained on min width"
// complaint. Free mode has its own, lower px floor (panel-drag FREE_MIN_W).
const MIN_CELL_SIZE = 80;
const MAX_CELL_SIZE = 360;
// The CSS custom property that drives the grid column floor. Owned by the base
// .panels-grid rule (origin/main); the dock's fallback sets the same one — one
// variable, one way. grid-config is the source of truth when window.worldGrid is
// present.
const CELL_VAR = '--panel-col-min';

// Fired on document whenever the mode or cell size changes, so the toolbar can
// keep its toggle/slider in sync with programmatic (analyst / reset) changes.
export const LAYOUT_MODE_EVENT = 'layout-mode-change';
export const LAYOUT_CELL_EVENT = 'layout-cell-change';

const GRID_SELECTOR = '.panels-grid';

function readState(): LayoutState {
  const base: LayoutState = { mode: 'grid', userSet: false, cellSize: DEFAULT_CELL_SIZE, free: {}, gridCols: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<LayoutState>;
    return {
      mode: parsed.mode === 'free' ? 'free' : 'grid',
      userSet: parsed.userSet === true,
      cellSize:
        typeof parsed.cellSize === 'number'
          ? clampCell(parsed.cellSize)
          : DEFAULT_CELL_SIZE,
      free: parsed.free && typeof parsed.free === 'object' ? parsed.free : {},
      gridCols: parsed.gridCols && typeof parsed.gridCols === 'object' ? parsed.gridCols : {},
    };
  } catch {
    return base;
  }
}

function writeState(next: LayoutState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode — layout simply won't persist */
  }
}

function clampCell(px: number): number {
  return Math.min(MAX_CELL_SIZE, Math.max(MIN_CELL_SIZE, Math.round(px)));
}

let state = readState();

function grid(): HTMLElement | null {
  return document.querySelector<HTMLElement>(GRID_SELECTOR);
}

function panelsIn(g: HTMLElement): HTMLElement[] {
  return Array.from(g.children).filter(
    (c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains('panel'),
  );
}

// ── public config API (also consumed by the toolbar agent) ──────────────────

export function getLayoutMode(): LayoutMode {
  return state.mode;
}

export function getGridConfig(): GridConfig {
  return { enabled: state.mode === 'grid', cellSize: state.cellSize, gap: DEFAULT_GAP };
}

export function getCellSize(): number {
  return state.cellSize;
}

export function getGap(): number {
  return DEFAULT_GAP;
}

// px — the logical row height of the grid (matches the CSS --panel-row that drives
// grid-auto-rows). Paired with cellSize + gap it defines ONE grid that both grid
// mode and free-mode snapping align to — no second magic number.
const ROW_UNIT = 16;

/** The logical snap grid shared by grid mode and free mode: a column is cellSize
 *  wide, a row is ROW_UNIT tall, both separated by gap. Free-mode drag/resize snaps
 *  {x,y} to these grid lines and {w,h} to whole-cell multiples, so free panels land
 *  on the SAME tracks grid mode uses. */
export function freeSnap(): { cell: number; row: number; gap: number } {
  return { cell: getCellSize(), row: ROW_UNIT, gap: DEFAULT_GAP };
}

/** Switch layout mode: persist, restyle the body, re-lay out every panel. The
 *  `user` flag records a deliberate pick so applyDefaultLayout never overrides it. */
function switchMode(mode: LayoutMode, user: boolean): void {
  if (mode !== 'grid' && mode !== 'free') return;
  if (mode === state.mode) {
    if (user && !state.userSet) {
      state = { ...state, userSet: true };
      writeState(state);
    }
    applyLayout();
    return;
  }
  const g = grid();
  // Entering free mode: snapshot the current GRID geometry BEFORE the body flips
  // to a block container. Otherwise the still-relative panels collapse to block
  // flow and we'd freeze the wrong positions (the map balloons to full-viewport).
  const frozen = mode === 'free' && g ? freezeAll(g) : null;
  state = { ...state, mode, userSet: state.userSet || user };
  writeState(state);
  applyBodyMode();
  applyCellVar();
  if (g) {
    for (const el of panelsIn(g)) applyPanelInMode(g, el, frozen?.get(el));
    updateContainerHeight(g);
  }
  document.dispatchEvent(new CustomEvent(LAYOUT_MODE_EVENT, { detail: { mode } }));
}

/** Switch layout mode (explicit user choice). */
export function setLayoutMode(mode: LayoutMode): void {
  switchMode(mode, true);
}

/**
 * The dashboard's DEFAULT layout. Unless the user has explicitly chosen a mode,
 * it defaults to FREE — every panel owns its own {x,y,w,h} so moving or resizing
 * one never reflows the others (the #1 complaint about the grid). The current grid
 * arrangement is FROZEN as the starting geometry, so the switch is visually
 * invisible: panels stay exactly where the grid put them, just independently
 * positioned from then on. Called once by App after the panels + map have laid
 * out. Idempotent, and a no-op override once the user picks a mode.
 */
export function applyDefaultLayout(): void {
  if (state.userSet) {
    applyLayout();
    return;
  }
  switchMode('free', false);
}

export function toggleLayoutMode(): LayoutMode {
  const next: LayoutMode = state.mode === 'grid' ? 'free' : 'grid';
  setLayoutMode(next);
  return next;
}

/** Set the grid cell size (px). Grid mode re-snaps as tracks resize. Persisted. */
export function setCellSize(px: number): void {
  const cell = clampCell(px);
  if (cell === state.cellSize) return;
  state = { ...state, cellSize: cell };
  writeState(state);
  applyCellVar();
  applyLayout();
  document.dispatchEvent(new CustomEvent(LAYOUT_CELL_EVENT, { detail: { cellSize: cell } }));
}

/** Clear every layout-engine customization (mode, cell size, free + grid geometry). */
export function resetLayout(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  state = { mode: 'grid', userSet: false, cellSize: DEFAULT_CELL_SIZE, free: {}, gridCols: {} };
}

// ── per-panel geometry persistence (used by panel-drag) ─────────────────────

export function getFreeRect(id: string): FreeRect | undefined {
  return state.free[id];
}

export function setFreeRect(id: string, rect: FreeRect): void {
  state = { ...state, free: { ...state.free, [id]: rect } };
  writeState(state);
}

export function getGridCols(id: string): number | undefined {
  return state.gridCols[id];
}

export function setGridCols(id: string, cols: number): void {
  const next = { ...state.gridCols };
  if (cols > 1) next[id] = cols;
  else delete next[id];
  state = { ...state, gridCols: next };
  writeState(state);
}

// ── DOM application ─────────────────────────────────────────────────────────

function applyBodyMode(): void {
  const b = document.body;
  if (!b) return;
  b.classList.toggle('layout-free', state.mode === 'free');
  b.classList.toggle('layout-grid', state.mode === 'grid');
}

function applyCellVar(): void {
  document.documentElement.style.setProperty(CELL_VAR, `${state.cellSize}px`);
}

/** Current geometry of a panel expressed relative to the grid's padding box. */
function measureRect(g: HTMLElement, el: HTMLElement): FreeRect {
  const gr = g.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  return {
    x: Math.max(0, Math.round(er.left - gr.left - g.clientLeft)),
    y: Math.max(0, Math.round(er.top - gr.top - g.clientTop)),
    w: Math.round(er.width),
    h: Math.round(er.height),
  };
}

function applyFreeRect(el: HTMLElement, rect: FreeRect): void {
  el.style.position = 'absolute';
  el.style.left = `${rect.x}px`;
  el.style.top = `${rect.y}px`;
  el.style.width = `${rect.w}px`;
  el.style.height = `${rect.h}px`;
}

function clearFreeInline(el: HTMLElement): void {
  el.style.position = '';
  el.style.left = '';
  el.style.top = '';
  el.style.width = '';
  el.style.height = '';
}

/**
 * A sensible free-mode rect for a panel that has no saved geometry yet (one shown
 * from the Panels menu / added via "+ Add widget", or an analyst-created feed).
 * A tidy ~480×260 card tucked below every currently-placed panel, so it appears
 * in a predictable spot without overlapping anything (never a full-width block
 * flowing under the absolute siblings).
 */
function defaultFreeRectFor(g: HTMLElement): FreeRect {
  const style = getComputedStyle(g);
  const padL = parseFloat(style.paddingLeft || '0') || 0;
  const padR = parseFloat(style.paddingRight || '0') || 0;
  const innerW = Math.max(0, g.clientWidth - padL - padR);
  let bottom = 0;
  for (const p of panelsIn(g)) {
    if (p.classList.contains('hidden')) continue;
    const r = getFreeRect(p.dataset.panel ?? '');
    if (r) bottom = Math.max(bottom, r.y + r.h);
  }
  return { x: 0, y: bottom + DEFAULT_GAP, w: Math.min(innerW || 480, 480), h: 260 };
}

/**
 * Apply the active mode to a single panel. In free mode: place it at its saved
 * rect, or — on the first-ever switch — freeze it exactly where the grid put it
 * (measured by the caller and passed in) so the transition never jumps. In grid
 * mode: strip any free inline geometry and re-apply a saved column span.
 */
function applyPanelInMode(g: HTMLElement, el: HTMLElement, frozen?: FreeRect): void {
  const id = el.dataset.panel;
  if (!id) return;
  if (state.mode === 'free') {
    // Never position a hidden panel — it would persist a 0×0 rect and come back
    // broken. It seeds a real rect when the user shows it (App re-applies layout).
    if (el.classList.contains('hidden')) return;
    let rect = getFreeRect(id);
    if (!rect) {
      // frozen = the exact grid geometry captured on a mode switch (invisible flip);
      // otherwise a tidy default slot for a freshly shown/added panel.
      rect = frozen ?? defaultFreeRectFor(g);
      setFreeRect(id, rect);
    }
    applyFreeRect(el, rect);
  } else {
    clearFreeInline(el);
    // The map owns its own gridColumn (full-width anchor / half-width) in App.
    if (id !== 'map') {
      const cols = getGridCols(id);
      if (cols && cols > 1) el.style.gridColumn = `span ${cols}`;
      else if (el.style.gridColumn) el.style.gridColumn = '';
    }
  }
}

/** Grow the block container in free mode to contain its absolutely-placed panels. */
function updateContainerHeight(g: HTMLElement): void {
  if (state.mode !== 'free') {
    g.style.height = '';
    return;
  }
  let bottom = 0;
  for (const el of panelsIn(g)) {
    if (el.classList.contains('hidden')) continue;
    bottom = Math.max(bottom, el.offsetTop + el.offsetHeight);
  }
  g.style.height = `${bottom + DEFAULT_GAP}px`;
}

/** Snapshot every VISIBLE panel's current geometry (measured in whatever layout is
 *  live). Hidden panels are skipped — they seed a real rect when first shown. */
function freezeAll(g: HTMLElement): Map<HTMLElement, FreeRect> {
  const m = new Map<HTMLElement, FreeRect>();
  for (const el of panelsIn(g)) {
    if (el.classList.contains('hidden')) continue;
    m.set(el, measureRect(g, el));
  }
  return m;
}

/** Re-apply the current mode to every panel using saved geometry (cell change,
 *  reset, same-mode refresh). Never re-measures — the mode switch owns freezing. */
export function applyLayout(): void {
  const g = grid();
  if (!g) return;
  applyCellVar();
  for (const el of panelsIn(g)) applyPanelInMode(g, el);
  updateContainerHeight(g);
}

/** Called by panel-drag when a panel mounts, so it self-applies its geometry. */
export function registerPanel(el: HTMLElement): void {
  // el is attached to the grid synchronously after this call; defer one microtask
  // so measureRect/position see the panel in the DOM.
  queueMicrotask(() => {
    const g = grid();
    if (!g || el.parentElement !== g) return;
    applyPanelInMode(g, el);
    scheduleHeight(g);
  });
}

/** Called by panel-drag after a free drag/resize commits new geometry. */
export function commitFreeRect(el: HTMLElement, rect: FreeRect): void {
  const id = el.dataset.panel;
  if (!id) return;
  setFreeRect(id, rect);
  const g = grid();
  if (g) scheduleHeight(g);
}

let heightRaf = 0;
function scheduleHeight(g: HTMLElement): void {
  if (heightRaf) return;
  heightRaf = requestAnimationFrame(() => {
    heightRaf = 0;
    updateContainerHeight(g);
  });
}

// ── snap overlay (grid mode only, transient during drag/resize) ─────────────

/** Show the faint track overlay. No-op in free mode. */
export function showSnapOverlay(): void {
  if (state.mode !== 'grid') return;
  const g = grid();
  if (!g) return;
  const cs = getComputedStyle(g);
  const cols = cs.gridTemplateColumns.split(' ').filter(Boolean);
  const gap = parseFloat(cs.columnGap || cs.gap || '0') || 0;
  const colW = cols.length ? parseFloat(cols[0]!) || state.cellSize : state.cellSize;
  const rowGap = parseFloat(cs.rowGap || cs.gap || '0') || 0;
  const rows = cs.gridAutoRows.split(' ').filter(Boolean);
  const rowH = rows.length ? parseFloat(rows[0]!) || state.cellSize : state.cellSize;
  const padLeft = parseFloat(cs.paddingLeft || '0') || 0;
  const padTop = parseFloat(cs.paddingTop || '0') || 0;
  g.style.setProperty('--grid-overlay-col', `${colW + gap}px`);
  g.style.setProperty('--grid-overlay-row', `${rowH + rowGap}px`);
  g.style.setProperty('--grid-overlay-x', `${padLeft}px`);
  g.style.setProperty('--grid-overlay-y', `${padTop}px`);
  document.body.classList.add('layout-snapping');
}

export function hideSnapOverlay(): void {
  document.body.classList.remove('layout-snapping');
}

// ── bootstrap ───────────────────────────────────────────────────────────────

function bootstrap(): void {
  applyBodyMode();
  applyCellVar();
  const g = grid();
  if (g && panelsIn(g).length) applyLayout();
}

// The footer dock's layout controls (App.gridApi) delegate to this global when
// present, so the Grid⇄Free toggle + cell-size slider drive the real engine
// rather than the dock's minimal CSS-var fallback. One way to do everything.
if (typeof window !== 'undefined') {
  (window as unknown as { worldGrid?: unknown }).worldGrid = {
    setLayoutMode, getLayoutMode, toggleLayoutMode, applyDefaultLayout, applyLayout,
    setCellSize, getCellSize, getGridConfig, resetLayout,
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }

  // Reset from the settings modal button / analyst request also clears our keys,
  // then App reloads. Both are synchronous, so removeItem lands before navigation.
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest('#resetLayoutBtn')) resetLayout();
  });
  document.addEventListener('panel-reset-layout-request', () => resetLayout());
}
