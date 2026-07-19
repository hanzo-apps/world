// Panel drag + resize interaction.
//
// One module owns all pointer math and drag/resize visuals; callers own state
// (App persists panel order, Panel owns the row-span class ↔ storage mapping).
//
// The module is layout-mode aware (see services/grid-config.ts):
//   • "grid" mode — the original behaviour, untouched. Drag reorders panels with
//     a custom ghost + FLIP reflow; resize snaps to grid tracks / row-spans. A
//     faint track overlay is shown for the duration of the gesture.
//   • "free" mode — the grid is a positioned block and each panel is absolutely
//     placed. Drag moves the panel directly under the cursor; resize is
//     pixel-exact from the right edge, bottom edge, or bottom-right corner.
//     Nothing snaps; the new {x,y,w,h} is persisted via grid-config.
//
// Drag (grid): unified Pointer Events (mouse + touch + pen), a small press
// threshold so clicks and scrolls are never hijacked, a custom translucent ghost
// that follows the pointer, and a live gap that opens where the panel will land.
// Escape cancels and restores.
//
// Resize (grid): the same pointer plumbing drives the handles. Height maps to a
// discrete grid row-span on a clean rowPx grid; width maps to a column span on
// the live track grid, so the snap points line up with the cursor.

import {
  getLayoutMode,
  registerPanel,
  commitFreeRect,
  showSnapOverlay,
  hideSnapOverlay,
  freeSnap,
} from './grid-config';

const DRAG_THRESHOLD = 6; // px of pointer travel before a press becomes a drag
const FLIP_MS = 180; // sibling reflow duration
const DROP_SETTLE_MS = 160; // ghost easing into its final slot on release
const FLIP_EASE = 'cubic-bezier(0.2, 0, 0, 1)';

// Sane pixel floors for free-mode geometry — low so a panel can be dragged much
// narrower/smaller than the old grid track allowed ("constrained on min width").
// The map keeps a slightly larger floor so the globe never collapses to a sliver.
const FREE_MIN_W = 96;
const FREE_MIN_H = 40;
const MAP_MIN = 140;

const minWidthFor = (el: HTMLElement, opt?: number): number =>
  el.classList.contains('map-panel') ? MAP_MIN : opt ?? FREE_MIN_W;
const minHeightFor = (el: HTMLElement, opt?: number): number =>
  el.classList.contains('map-panel') ? MAP_MIN : opt ?? FREE_MIN_H;

// ── Logical-grid snapping (free mode) ────────────────────────────────────────
// Free mode aligns to the SAME grid grid mode uses (grid-config.freeSnap): {x,y}
// snap to grid-line origins, {w,h} to whole-cell multiples. This is what makes
// dragging feel logical instead of loose. Holding Alt bypasses it for fine px work.

/** Snap a free coordinate to the nearest grid line (origin k*pitch), clamped ≥0. */
function snapLine(v: number, pitch: number): number {
  return pitch > 0 ? Math.max(0, Math.round(v / pitch) * pitch) : Math.max(0, v);
}
/** Snap a free size to a whole number of cells (N cells + (N-1) gaps), never below min. */
function snapCells(v: number, unit: number, gap: number, min: number): number {
  const pitch = unit + gap;
  if (pitch <= 0) return Math.max(min, v);
  const n = Math.max(1, Math.round((v + gap) / pitch));
  return Math.max(min, n * unit + (n - 1) * gap);
}

// Which edges a resize gesture drives. The OPPOSITE edge stays pinned: e/s grow
// from a fixed top-left (the classic bottom-right drag), while w/n grow from a
// fixed bottom-right by shifting the panel's left/top as its size changes — so a
// panel can be resized from any edge or corner and the far side never moves.
interface ResizeEdges {
  n?: boolean;
  s?: boolean;
  e?: boolean;
  w?: boolean;
}

// Free-mode pixel resize, shared by every edge and corner handle. The panel is
// absolutely placed; startLeft/startTop are its offset origin so w/n resizes can
// hold the opposite edge by moving left/top in lock-step with the size.
interface FreeResizeState {
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  startW: number;
  startH: number;
  minW: number;
  minH: number;
}

function applyFreeResize(
  el: HTMLElement,
  edges: ResizeEdges,
  s: FreeResizeState,
  clientX: number,
  clientY: number,
  snap: boolean,
): void {
  const dx = clientX - s.startX;
  const dy = clientY - s.startY;
  const g = snap ? freeSnap() : null;
  if (edges.e) {
    let w = Math.max(s.minW, s.startW + dx);
    if (g) w = snapCells(w, g.cell, g.gap, s.minW);
    el.style.width = `${Math.round(w)}px`;
  } else if (edges.w) {
    let w = Math.max(s.minW, s.startW - dx);
    if (g) w = snapCells(w, g.cell, g.gap, s.minW);
    el.style.width = `${Math.round(w)}px`;
    el.style.left = `${Math.round(s.startLeft + (s.startW - w))}px`; // pin the right edge
  }
  if (edges.s) {
    let h = Math.max(s.minH, s.startH + dy);
    if (g) h = snapCells(h, g.row, g.gap, s.minH);
    el.style.height = `${Math.round(h)}px`;
  } else if (edges.n) {
    let h = Math.max(s.minH, s.startH - dy);
    if (g) h = snapCells(h, g.row, g.gap, s.minH);
    el.style.height = `${Math.round(h)}px`;
    el.style.top = `${Math.round(s.startTop + (s.startH - h))}px`; // pin the bottom edge
  }
}

// A corner handle drives its two adjacent edges. Free-mode resize supports all
// four; grid-mode span/column snapping is only meaningful from the bottom-right.
export type CornerId = 'nw' | 'ne' | 'sw' | 'se';
const EDGES_FOR_CORNER: Record<CornerId, ResizeEdges> = {
  se: { e: true, s: true },
  sw: { w: true, s: true },
  ne: { e: true, n: true },
  nw: { w: true, n: true },
};

// Build the free-resize start state from the panel's live geometry.
function freeStateFor(el: HTMLElement, e: PointerEvent, minW: number, minH: number): FreeResizeState {
  const rect = el.getBoundingClientRect();
  return {
    startX: e.clientX,
    startY: e.clientY,
    startLeft: el.offsetLeft,
    startTop: el.offsetTop,
    startW: rect.width,
    startH: rect.height,
    minW,
    minH,
  };
}

function commitFreeGeometry(el: HTMLElement): void {
  commitFreeRect(el, {
    x: el.offsetLeft,
    y: el.offsetTop,
    w: el.offsetWidth,
    h: el.offsetHeight,
  });
}

// Height (px) → grid row-span. Snaps to the fine tier ladder (snapHeights) up to
// its top tier for precise small sizes, then grows CONTINUOUSLY with NO upper cap:
// dragging the bottom edge past the top tier keeps adding whole rows, so a panel
// can be made arbitrarily tall. minSpan is the only floor. One way, both handles.
function spanForHeight(
  height: number,
  minSpan: number,
  maxSpan: number,
  rowPx: number,
  snapHeights?: number[],
): number {
  if (snapHeights && snapHeights.length > 0) {
    const topIdx = Math.min(maxSpan, snapHeights.length - 1);
    const top = snapHeights[topIdx]!;
    // Within the fine ladder → snap to the nearest tier.
    if (height <= top + rowPx * 0.5) {
      let best = minSpan;
      let bestDist = Infinity;
      for (let span = minSpan; span <= topIdx; span++) {
        const dist = Math.abs(height - snapHeights[span]!);
        if (dist < bestDist) {
          bestDist = dist;
          best = span;
        }
      }
      return best;
    }
    // Beyond the ladder → continuous whole-row growth, uncapped.
    return Math.max(topIdx, Math.round(height / rowPx));
  }
  // No ladder → continuous, floored at minSpan, uncapped.
  return Math.max(minSpan, Math.round(height / rowPx));
}

const isInteractive = (target: Element | null): boolean =>
  !!target?.closest('button, a, input, select, textarea, [contenteditable="true"]');

const isResizeHandle = (target: Element | null): boolean =>
  !!target?.closest('.panel-resize-handle, .panel-col-resize-handle, .panel-corner-resize-handle');

// ── Window-manager snap zones (free mode) ────────────────────────────────────
// Dragging a free panel near an EDGE previews a half; near a CORNER previews a
// quadrant; the centre is free placement. A translucent overlay shows the target
// as the cursor moves between zones; on drop the panel resizes + positions to it.
// One mechanism: the zone rect (viewport coords) → the panel's grid-relative free
// geometry on commit. Escape cancels via the drag's own key handler.
type SnapZoneId =
  | 'left' | 'right' | 'top' | 'bottom'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
interface SnapZone { id: SnapZoneId; left: number; top: number; width: number; height: number; }

const SNAP_EDGE_FRAC = 0.14; // how deep from an edge counts as that half
const SNAP_EDGE_MIN = 48;    // …but at least this many px, for small workspaces
const SNAP_GAP = 6;          // inset so tiled panels keep a clean gutter

// Visible workspace = the grid's box intersected with its scroll viewport.
function workspaceRect(grid: HTMLElement): { left: number; top: number; width: number; height: number } {
  const g = grid.getBoundingClientRect();
  const scroller = (grid.closest('.main-content') as HTMLElement | null) ?? grid.parentElement;
  const s = scroller ? scroller.getBoundingClientRect() : g;
  const top = Math.max(g.top, s.top);
  const bottom = Math.min(g.bottom, s.bottom);
  return { left: g.left, top, width: g.width, height: Math.max(0, bottom - top) };
}

// Cursor (viewport x,y) → the snap zone under it, or null for free placement.
function computeSnapZone(grid: HTMLElement, x: number, y: number): SnapZone | null {
  const w = workspaceRect(grid);
  if (w.width < 220 || w.height < 180) return null; // too small to tile
  if (x < w.left || x > w.left + w.width || y < w.top || y > w.top + w.height) return null;
  const ex = Math.max(SNAP_EDGE_MIN, w.width * SNAP_EDGE_FRAC);
  const ey = Math.max(SNAP_EDGE_MIN, w.height * SNAP_EDGE_FRAC);
  const nearL = x < w.left + ex, nearR = x > w.left + w.width - ex;
  const nearT = y < w.top + ey, nearB = y > w.top + w.height - ey;
  const halfW = Math.round(w.width / 2), halfH = Math.round(w.height / 2);
  const z = (id: SnapZoneId, left: number, top: number, width: number, height: number): SnapZone =>
    ({ id, left, top, width, height });
  if (nearT && nearL) return z('top-left', w.left, w.top, halfW, halfH);
  if (nearT && nearR) return z('top-right', w.left + halfW, w.top, w.width - halfW, halfH);
  if (nearB && nearL) return z('bottom-left', w.left, w.top + halfH, halfW, w.height - halfH);
  if (nearB && nearR) return z('bottom-right', w.left + halfW, w.top + halfH, w.width - halfW, w.height - halfH);
  if (nearL) return z('left', w.left, w.top, halfW, w.height);
  if (nearR) return z('right', w.left + halfW, w.top, w.width - halfW, w.height);
  if (nearT) return z('top', w.left, w.top, w.width, halfH);
  if (nearB) return z('bottom', w.left, w.top + halfH, w.width, w.height - halfH);
  return null;
}

// One translucent preview overlay (viewport-fixed), reused across every drag.
let snapPreviewEl: HTMLElement | null = null;
function showSnapPreview(z: SnapZone): void {
  if (!snapPreviewEl) {
    snapPreviewEl = document.createElement('div');
    snapPreviewEl.className = 'panel-snap-preview';
    document.body.appendChild(snapPreviewEl);
  }
  snapPreviewEl.style.left = `${z.left}px`;
  snapPreviewEl.style.top = `${z.top}px`;
  snapPreviewEl.style.width = `${z.width}px`;
  snapPreviewEl.style.height = `${z.height}px`;
  snapPreviewEl.classList.add('visible');
}
function hideSnapPreview(): void {
  snapPreviewEl?.classList.remove('visible');
}

/** Panels that participate in reflow — everything in the grid that is a visible panel. */
function livePanels(grid: HTMLElement, except?: HTMLElement): HTMLElement[] {
  return Array.from(grid.children).filter(
    (c): c is HTMLElement =>
      c instanceof HTMLElement &&
      c !== except &&
      c.classList.contains('panel') &&
      !c.classList.contains('hidden'),
  );
}

export interface PanelDragOptions {
  /** Resolve the live grid at drag time — panels re-mount, so never cache it. */
  getGrid: () => HTMLElement | null;
  /** Fired once after a committed reorder; the host persists the new order. */
  onReorder: () => void;
  /**
   * Optional leading-anchor guard. When it returns true for a panel, a drop is
   * never allowed to land BEFORE that panel — the ref is redirected to the
   * panel's nextSibling instead. Used to keep the full-width map pinned as the
   * first grid child (a stray panel wrapping into row 1 shoves the map into a
   * black void). A no-op when unset.
   */
  blockInsertBefore?: (panel: HTMLElement) => boolean;
}

/**
 * Make a panel draggable-to-reorder within its grid. Returns a cleanup fn.
 * Owns pointer math + visuals only; ordering is read back from the live DOM by
 * the host's onReorder (which reads each child's data-panel).
 */
export function attachPanelDrag(el: HTMLElement, opts: PanelDragOptions): () => void {
  let pointerId: number | null = null;
  let pressing = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let offsetX = 0;
  let offsetY = 0;
  let ghost: HTMLElement | null = null;
  let grid: HTMLElement | null = null;
  let originalNext: ChildNode | null = null;
  let rafId = 0;
  let lastX = 0;
  let lastY = 0;
  let lastAlt = false; // Alt held on the last pointer move → bypass grid snapping
  let onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  // Free-mode drag bookkeeping: the panel is already position:absolute, so a drag
  // just tracks its top-left under the cursor (no ghost, no reflow).
  let freeGesture = false; // this gesture started in free mode
  let freeStartLeft = 0;
  let freeStartTop = 0;
  let currentZone: SnapZone | null = null; // active window-manager snap zone (free mode)

  const clearFlip = (g: HTMLElement) => {
    for (const p of livePanels(g)) {
      p.style.transition = '';
      p.style.transform = '';
    }
  };

  // FLIP: `first` holds pre-mutation rects; the DOM has already been reordered,
  // so read the new positions, invert to the old, then release to zero.
  const flip = (g: HTMLElement, first: Map<HTMLElement, DOMRect>) => {
    const moved: HTMLElement[] = [];
    for (const p of livePanels(g, el)) {
      const before = first.get(p);
      if (!before) continue;
      const after = p.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      p.style.transition = 'none';
      p.style.transform = `translate(${dx}px, ${dy}px)`;
      moved.push(p);
    }
    if (moved.length === 0) return;
    // One reflow, then release every element together on the next frame.
    void g.getBoundingClientRect();
    requestAnimationFrame(() => {
      for (const p of moved) {
        p.style.transition = `transform ${FLIP_MS}ms ${FLIP_EASE}`;
        p.style.transform = '';
      }
    });
  };

  const captureRects = (g: HTMLElement): Map<HTMLElement, DOMRect> => {
    const rects = new Map<HTMLElement, DOMRect>();
    for (const p of livePanels(g, el)) rects.set(p, p.getBoundingClientRect());
    return rects;
  };

  const makeGhost = (): HTMLElement => {
    const rect = el.getBoundingClientRect();
    const clone = el.cloneNode(true) as HTMLElement;
    // Visual-only: kill live embeds, id collisions, and interaction surfaces.
    clone.querySelectorAll('iframe, video, canvas, script').forEach((n) => n.remove());
    clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    clone
      .querySelectorAll('.panel-resize-handle, .panel-col-resize-handle, .panel-corner-resize-handle')
      .forEach((n) => n.remove());
    clone.classList.remove('panel-drag-source', 'dragging');
    clone.classList.add('panel-drag-ghost');
    clone.style.position = 'fixed';
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.margin = '0';
    clone.style.pointerEvents = 'none';
    clone.style.zIndex = '10000';
    document.body.appendChild(clone);
    return clone;
  };

  // Where would a drop at (x,y) land? Returns the node to insertBefore
  // (null = append to end, undefined = not a valid target → leave order alone).
  const referenceNodeAt = (g: HTMLElement, x: number, y: number): ChildNode | null | undefined => {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null; // ghost is pointer-events:none
    if (!hit) return undefined;
    const over = hit.closest('.panel') as HTMLElement | null;
    if (over && over !== el && over.parentElement === g && !over.classList.contains('hidden')) {
      const r = over.getBoundingClientRect();
      const after = x > r.left + r.width / 2; // right half of the hovered panel → drop after it
      // A leading-anchor panel (the full-width map) can never be preceded — a
      // drop on its left half lands AFTER it instead of before it.
      if (!after && opts.blockInsertBefore?.(over)) return over.nextSibling;
      return after ? over.nextSibling : over;
    }
    // Empty region of the grid, below the last panel → append.
    if (hit === g || hit.classList.contains('panels-grid')) {
      const panels = livePanels(g, el);
      const lastBottom = panels.reduce((m, p) => Math.max(m, p.getBoundingClientRect().bottom), 0);
      if (panels.length === 0 || y > lastBottom) return null;
    }
    return undefined;
  };

  const reorderTo = (g: HTMLElement, ref: ChildNode | null) => {
    if (ref === el) return; // dropping onto self
    if (ref === el.nextSibling) return; // already sitting right before ref → no-op
    if (ref === null && el === g.lastElementChild) return; // already last
    const first = captureRects(g);
    g.insertBefore(el, ref); // ref === null appends
    flip(g, first);
  };

  const moveGhost = (x: number, y: number) => {
    if (ghost) {
      ghost.style.left = `${x - offsetX}px`;
      ghost.style.top = `${y - offsetY}px`;
    }
  };

  const startDrag = () => {
    grid = opts.getGrid();
    if (!grid) return;
    dragging = true;
    onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelDrag();
    };
    document.addEventListener('keydown', onKeyDown, true);

    if (freeGesture) {
      // Pixel-follow drag: lift the panel above its siblings, no ghost/FLIP.
      freeStartLeft = el.offsetLeft;
      freeStartTop = el.offsetTop;
      el.classList.add('panel-free-dragging');
      document.body.classList.add('panel-drag-active');
      return;
    }

    originalNext = el.nextSibling;
    ghost = makeGhost();
    el.classList.add('panel-drag-source');
    document.body.classList.add('panel-drag-active');
    showSnapOverlay();
  };

  // Free-mode: place the panel's top-left under the pointer, clamped into the
  // grid, then persist. Grid origin is re-read each frame so page scroll during
  // a drag never introduces drift.
  const moveFree = (x: number, y: number, snap: boolean) => {
    if (!grid) return;
    const gr = grid.getBoundingClientRect();
    let left = Math.max(0, x - offsetX - gr.left - grid.clientLeft);
    let top = Math.max(0, y - offsetY - gr.top - grid.clientTop);
    if (snap) {
      const g = freeSnap();
      left = snapLine(left, g.cell + g.gap);
      top = snapLine(top, g.row + g.gap);
    }
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  };

  // Snap the panel into a window-manager zone: convert the zone's viewport rect to
  // the grid-relative free geometry (with a small gutter) and apply it inline.
  const placeInZone = (z: SnapZone) => {
    if (!grid) return;
    const g = grid.getBoundingClientRect();
    const left = Math.max(0, Math.round(z.left - g.left - grid.clientLeft) + SNAP_GAP);
    const top = Math.max(0, Math.round(z.top - g.top - grid.clientTop) + SNAP_GAP);
    const width = Math.max(minWidthFor(el), Math.round(z.width) - 2 * SNAP_GAP);
    const height = Math.max(minHeightFor(el), Math.round(z.height) - 2 * SNAP_GAP);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
  };

  const commitFree = () => {
    commitFreeRect(el, {
      x: el.offsetLeft,
      y: el.offsetTop,
      w: el.offsetWidth,
      h: el.offsetHeight,
    });
  };

  const finishVisuals = () => {
    if (grid) clearFlip(grid);
    el.classList.remove('panel-drag-source', 'panel-free-dragging');
    document.body.classList.remove('panel-drag-active');
    hideSnapOverlay();
    if (onKeyDown) {
      document.removeEventListener('keydown', onKeyDown, true);
      onKeyDown = null;
    }
  };

  const removeGhost = (settleTo?: DOMRect) => {
    const g = ghost;
    ghost = null;
    if (!g) return;
    if (settleTo) {
      g.style.transition = `left ${DROP_SETTLE_MS}ms ${FLIP_EASE}, top ${DROP_SETTLE_MS}ms ${FLIP_EASE}, opacity ${DROP_SETTLE_MS}ms ease`;
      requestAnimationFrame(() => {
        g.style.left = `${settleTo.left}px`;
        g.style.top = `${settleTo.top}px`;
        g.style.opacity = '0';
      });
      window.setTimeout(() => g.remove(), DROP_SETTLE_MS + 20);
    } else {
      g.remove();
    }
  };

  const cancelDrag = () => {
    if (!dragging) return;
    dragging = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (freeGesture) {
      el.style.left = `${freeStartLeft}px`; // restore original position
      el.style.top = `${freeStartTop}px`;
      hideSnapPreview();
      currentZone = null;
      finishVisuals();
      releasePointer();
      return;
    }
    if (grid) grid.insertBefore(el, originalNext); // restore original slot
    finishVisuals();
    removeGhost();
    releasePointer();
  };

  const releasePointer = () => {
    if (pointerId !== null) {
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        /* not captured */
      }
    }
    pointerId = null;
    pressing = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onCancel);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!pressing || e.pointerId !== pointerId) return;
    lastX = e.clientX;
    lastY = e.clientY;
    lastAlt = e.altKey;

    if (!dragging) {
      if (Math.abs(e.clientX - startX) < DRAG_THRESHOLD && Math.abs(e.clientY - startY) < DRAG_THRESHOLD) {
        return;
      }
      startDrag();
      if (!dragging) return; // no grid
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }

    e.preventDefault();
    if (rafId) cancelAnimationFrame(rafId);
    const x = e.clientX;
    const y = e.clientY;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (!dragging || !grid) return;
      if (freeGesture) {
        moveFree(x, y, !lastAlt);
        // Window-manager tiling: preview the zone under the cursor (halves/quadrants),
        // or clear it in the free centre.
        currentZone = grid ? computeSnapZone(grid, x, y) : null;
        if (currentZone) showSnapPreview(currentZone);
        else hideSnapPreview();
        return;
      }
      moveGhost(x, y);
      const ref = referenceNodeAt(grid, x, y);
      if (ref !== undefined) reorderTo(grid, ref);
    });
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const wasDragging = dragging;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (wasDragging && freeGesture) {
      // Drop into the previewed snap zone if one is active, else free-place.
      if (currentZone) placeInZone(currentZone);
      else moveFree(lastX, lastY, !lastAlt);
      hideSnapPreview();
      currentZone = null;
      dragging = false;
      finishVisuals();
      commitFree();
    } else if (wasDragging && grid) {
      const ref = referenceNodeAt(grid, lastX, lastY);
      if (ref !== undefined) reorderTo(grid, ref);
      const slot = el.getBoundingClientRect();
      dragging = false;
      finishVisuals();
      removeGhost(slot);
      opts.onReorder();
    } else {
      dragging = false;
    }
    releasePointer();
  };

  const onCancel = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    cancelDrag();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (pressing) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (el.dataset.resizing === 'true') return;
    if (isResizeHandle(target) || isInteractive(target)) return;
    // Never hijack a drag on the interactive map surface — pointer-pan/right-drag
    // rotate must win there; the map panel is reordered from its header instead.
    if (target?.closest('canvas, .map-container')) return;
    // On touch/pen only the header grabs, so panel-content stays scrollable.
    if (e.pointerType !== 'mouse' && !target?.closest('.panel-header')) return;

    pointerId = e.pointerId;
    pressing = true;
    dragging = false;
    freeGesture = getLayoutMode() === 'free';
    startX = e.clientX;
    startY = e.clientY;
    const rect = el.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onCancel);
  };

  el.addEventListener('pointerdown', onPointerDown);

  // Self-apply this panel's saved geometry for the active mode once it mounts.
  registerPanel(el);

  return () => {
    if (dragging) cancelDrag();
    else releasePointer();
    el.removeEventListener('pointerdown', onPointerDown);
    removeGhost();
  };
}

export interface PanelResizeOptions {
  minSpan?: number; // default 1
  maxSpan?: number; // default 4
  rowPx?: number; // px per row-span unit for snapping (default 200, matches CSS min-heights)
  /**
   * Optional per-span target heights (index === span). When present, the drag
   * snaps to whichever tier is closest to the live height instead of a uniform
   * rowPx grid — this is how a panel reaches the finer, irregular ladder
   * (span-0 = 120px tiny … span-4 = 800px) with a ~100px feel at the small end.
   */
  snapHeights?: number[];
  /** Pixel floor for free-mode height (default 120). */
  minH?: number;
  /** Height at drag start → the panel's current span. */
  getStartSpan: () => number;
  /** Live: apply the given span while dragging (Panel owns the span→class mapping). */
  onPreview: (span: number) => void;
  /** Persist the final span on release. */
  onCommit: (span: number) => void;
}

/**
 * Drive a panel's bottom resize handle with the same pointer plumbing as drag.
 * In grid mode height snaps to a discrete row-span on a clean rowPx grid; in free
 * mode it is pixel-exact and persisted via grid-config. Returns a cleanup fn.
 */
export function attachPanelResize(
  el: HTMLElement,
  handle: HTMLElement,
  opts: PanelResizeOptions,
): () => void {
  const minSpan = opts.minSpan ?? 1;
  const maxSpan = opts.maxSpan ?? 4;
  const rowPx = opts.rowPx ?? 200;
  const snapHeights = opts.snapHeights;

  let pointerId: number | null = null;
  let resizing = false;
  let startY = 0;
  let startHeight = 0;
  let lastSpan = minSpan;
  let freeGesture = false;
  let free: FreeResizeState | null = null;

  const spanFor = (height: number): number =>
    spanForHeight(height, minSpan, maxSpan, rowPx, snapHeights);

  const onPointerMove = (e: PointerEvent) => {
    if (!resizing || e.pointerId !== pointerId) return;
    e.preventDefault();
    if (freeGesture && free) {
      applyFreeResize(el, { s: true }, free, e.clientX, e.clientY, !e.altKey);
      return;
    }
    const height = startHeight + (e.clientY - startY);
    const span = spanFor(height);
    if (span !== lastSpan) {
      lastSpan = span;
      opts.onPreview(span);
    }
  };

  const end = () => {
    if (!resizing) return;
    resizing = false;
    el.classList.remove('resizing');
    handle.classList.remove('active');
    delete el.dataset.resizing;
    if (pointerId !== null) {
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
    }
    pointerId = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    if (freeGesture) {
      commitFreeGeometry(el);
    } else {
      hideSnapOverlay();
      opts.onCommit(lastSpan);
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    end();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    pointerId = e.pointerId;
    resizing = true;
    freeGesture = getLayoutMode() === 'free';
    const rect = el.getBoundingClientRect();
    startY = e.clientY;
    startHeight = rect.height;
    lastSpan = opts.getStartSpan();
    if (freeGesture) {
      free = freeStateFor(el, e, minWidthFor(el), minHeightFor(el, opts.minH));
    } else {
      showSnapOverlay();
    }
    el.classList.add('resizing');
    el.dataset.resizing = 'true';
    handle.classList.add('active');
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  handle.addEventListener('pointerdown', onPointerDown);

  return () => {
    end();
    handle.removeEventListener('pointerdown', onPointerDown);
  };
}

export interface PanelColResizeOptions {
  /** Resolve the live grid (its computed columns drive the snap). */
  getGrid: () => HTMLElement | null;
  /** Column span at drag start. */
  getStartCols: () => number;
  /** Pixel floor for free-mode width (default 160). */
  minW?: number;
  /** Live preview: apply a span of `cols` out of `total` grid columns. */
  onPreview: (cols: number, total: number) => void;
  /** Persist the final span (cols out of total). */
  onCommit: (cols: number, total: number) => void;
}

/**
 * Horizontal sibling of attachPanelResize: drag a panel's right edge. In grid
 * mode it sets how many grid COLUMNS the panel spans, snapping to the live
 * `repeat(auto-fill, …)` track. In free mode it sets a pixel width, persisted via
 * grid-config. The module owns pointer math; the caller owns the cols→style map.
 */
export function attachPanelColResize(
  el: HTMLElement,
  handle: HTMLElement,
  opts: PanelColResizeOptions,
): () => void {
  let pointerId: number | null = null;
  let resizing = false;
  let total = 1;
  let colStep = 1;
  let originLeft = 0; // the panel's own left edge — span is measured from here
  let lastCols = 1;
  let freeGesture = false;
  let free: FreeResizeState | null = null;

  // Read the live column geometry: track count + (track width + gap) as the step.
  // The span origin is the panel's own left edge, so a mid-grid panel snaps to the
  // right number of columns (for the col-0 map this equals the grid's left edge).
  const measure = (grid: HTMLElement): void => {
    const style = getComputedStyle(grid);
    const tracks = style.gridTemplateColumns.split(' ').filter(Boolean);
    total = Math.max(1, tracks.length);
    const gap = parseFloat(style.columnGap || '0') || 0;
    const rect = grid.getBoundingClientRect();
    const padLeft = parseFloat(style.paddingLeft || '0') || 0;
    const padRight = parseFloat(style.paddingRight || '0') || 0;
    const inner = rect.width - padLeft - padRight;
    const colW = (inner - gap * (total - 1)) / total;
    colStep = colW + gap;
    originLeft = el.getBoundingClientRect().left;
  };

  const colsFor = (clientX: number): number => {
    if (colStep <= 0) return total;
    const cols = Math.round((clientX - originLeft) / colStep);
    return Math.min(total, Math.max(1, cols));
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!resizing || e.pointerId !== pointerId) return;
    e.preventDefault();
    if (freeGesture && free) {
      applyFreeResize(el, { e: true }, free, e.clientX, e.clientY, !e.altKey);
      return;
    }
    const cols = colsFor(e.clientX);
    if (cols !== lastCols) {
      lastCols = cols;
      opts.onPreview(cols, total);
    }
  };

  const end = () => {
    if (!resizing) return;
    resizing = false;
    el.classList.remove('resizing-col');
    handle.classList.remove('active');
    delete el.dataset.resizing;
    if (pointerId !== null) {
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
    }
    pointerId = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    if (freeGesture) {
      commitFreeGeometry(el);
    } else {
      hideSnapOverlay();
      opts.onCommit(lastCols, total);
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    end();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const grid = opts.getGrid();
    e.preventDefault();
    e.stopPropagation();
    pointerId = e.pointerId;
    resizing = true;
    freeGesture = getLayoutMode() === 'free';
    if (freeGesture) {
      free = freeStateFor(el, e, minWidthFor(el, opts.minW), minHeightFor(el));
    } else {
      if (!grid) {
        resizing = false;
        return;
      }
      measure(grid);
      lastCols = opts.getStartCols();
      showSnapOverlay();
    }
    el.classList.add('resizing-col');
    el.dataset.resizing = 'true';
    handle.classList.add('active');
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  handle.addEventListener('pointerdown', onPointerDown);

  return () => {
    end();
    handle.removeEventListener('pointerdown', onPointerDown);
  };
}

export interface PanelCornerResizeOptions {
  /**
   * Which corner this handle sits at (default 'se'). All four resize freely in
   * free mode (the opposite corner stays pinned); only 'se' also drives grid-mode
   * span/column snapping — top/left grid resize has no meaning in grid flow.
   */
  corner?: CornerId;
  /** Resolve the live grid (grid mode: its tracks drive the column snap). */
  getGrid: () => HTMLElement | null;
  /** Row-span at drag start. */
  getStartSpan: () => number;
  /** Column-span at drag start. */
  getStartCols: () => number;
  /** Per-span target heights (index === span) for the vertical snap. */
  snapHeights?: number[];
  rowPx?: number; // px per row-span for the vertical snap (default 200)
  minSpan?: number; // default 0
  maxSpan?: number; // default 4
  minW?: number; // free-mode width floor (default 160)
  minH?: number; // free-mode height floor (default 120)
  /** Grid preview: apply row-span. */
  onPreviewSpan: (span: number) => void;
  /** Grid preview: apply column-span (cols out of total). */
  onPreviewCols: (cols: number, total: number) => void;
  /** Grid commit: persist row-span. */
  onCommitSpan: (span: number) => void;
  /** Grid commit: persist column-span (cols out of total). */
  onCommitCols: (cols: number, total: number) => void;
}

/**
 * Bottom-right corner handle: resizes width AND height at once. In grid mode it
 * drives both the column-span and row-span snaps (reusing the exact track /
 * tier math of the edge handles); in free mode it is a pixel resize on both
 * axes. One gesture, both dimensions.
 */
export function attachPanelCornerResize(
  el: HTMLElement,
  handle: HTMLElement,
  opts: PanelCornerResizeOptions,
): () => void {
  const minSpan = opts.minSpan ?? 0;
  const maxSpan = opts.maxSpan ?? 4;
  const rowPx = opts.rowPx ?? 200;
  const snapHeights = opts.snapHeights;
  const corner = opts.corner ?? 'se';
  const edges = EDGES_FOR_CORNER[corner];

  let pointerId: number | null = null;
  let resizing = false;
  let freeGesture = false;
  let free: FreeResizeState | null = null;
  // Grid geometry.
  let total = 1;
  let colStep = 1;
  let originLeft = 0; // the panel's own left edge — span origin
  let startTop = 0;
  let lastCols = 1;
  let lastSpan = minSpan;

  const measure = (grid: HTMLElement): void => {
    const style = getComputedStyle(grid);
    const tracks = style.gridTemplateColumns.split(' ').filter(Boolean);
    total = Math.max(1, tracks.length);
    const gap = parseFloat(style.columnGap || '0') || 0;
    const rect = grid.getBoundingClientRect();
    const padLeft = parseFloat(style.paddingLeft || '0') || 0;
    const padRight = parseFloat(style.paddingRight || '0') || 0;
    const inner = rect.width - padLeft - padRight;
    const colW = (inner - gap * (total - 1)) / total;
    colStep = colW + gap;
    originLeft = el.getBoundingClientRect().left;
  };

  const colsFor = (clientX: number): number => {
    if (colStep <= 0) return total;
    return Math.min(total, Math.max(1, Math.round((clientX - originLeft) / colStep)));
  };

  const spanFor = (height: number): number =>
    spanForHeight(height, minSpan, maxSpan, rowPx, snapHeights);

  const onPointerMove = (e: PointerEvent) => {
    if (!resizing || e.pointerId !== pointerId) return;
    e.preventDefault();
    if (freeGesture && free) {
      applyFreeResize(el, edges, free, e.clientX, e.clientY, !e.altKey);
      return;
    }
    const cols = colsFor(e.clientX);
    if (cols !== lastCols) {
      lastCols = cols;
      opts.onPreviewCols(cols, total);
    }
    const span = spanFor(e.clientY - startTop);
    if (span !== lastSpan) {
      lastSpan = span;
      opts.onPreviewSpan(span);
    }
  };

  const end = () => {
    if (!resizing) return;
    resizing = false;
    el.classList.remove('resizing', 'resizing-col');
    handle.classList.remove('active');
    delete el.dataset.resizing;
    if (pointerId !== null) {
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
    }
    pointerId = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    if (freeGesture) {
      commitFreeGeometry(el);
    } else {
      hideSnapOverlay();
      opts.onCommitCols(lastCols, total);
      opts.onCommitSpan(lastSpan);
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    end();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const grid = opts.getGrid();
    e.preventDefault();
    e.stopPropagation();
    pointerId = e.pointerId;
    resizing = true;
    freeGesture = getLayoutMode() === 'free';
    if (freeGesture) {
      free = freeStateFor(el, e, minWidthFor(el, opts.minW), minHeightFor(el, opts.minH));
    } else {
      // Grid-mode span/column snapping only makes sense from the bottom-right; the
      // other three corners are free-mode-only (and hidden in grid mode by CSS).
      if (!grid || corner !== 'se') {
        resizing = false;
        return;
      }
      measure(grid);
      startTop = el.getBoundingClientRect().top;
      lastCols = opts.getStartCols();
      lastSpan = opts.getStartSpan();
      showSnapOverlay();
    }
    el.classList.add('resizing', 'resizing-col');
    el.dataset.resizing = 'true';
    handle.classList.add('active');
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  handle.addEventListener('pointerdown', onPointerDown);

  return () => {
    end();
    handle.removeEventListener('pointerdown', onPointerDown);
  };
}
