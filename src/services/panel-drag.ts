// Panel drag + resize interaction.
//
// One module owns all pointer math and drag/resize visuals; callers own state
// (App persists panel order, Panel owns the row-span class ↔ storage mapping).
//
// Drag: unified Pointer Events (mouse + touch + pen), a small press threshold so
// clicks and scrolls are never hijacked, a custom translucent ghost that follows
// the pointer, and a live gap that opens where the panel will land — sibling
// panels slide into their new positions with a transform-based FLIP animation
// (no layout jank, no OS drag image). Escape cancels and restores.
//
// Resize: the same pointer plumbing drives the bottom handle. Height maps to a
// discrete grid row-span on a clean rowPx grid, so the snap points line up with
// the cursor instead of the old mismatched thresholds.

const DRAG_THRESHOLD = 6; // px of pointer travel before a press becomes a drag
const FLIP_MS = 180; // sibling reflow duration
const DROP_SETTLE_MS = 160; // ghost easing into its final slot on release
const FLIP_EASE = 'cubic-bezier(0.2, 0, 0, 1)';

const isInteractive = (target: Element | null): boolean =>
  !!target?.closest('button, a, input, select, textarea, [contenteditable="true"]');

const isResizeHandle = (target: Element | null): boolean =>
  !!target?.closest('.panel-resize-handle, .panel-col-resize-handle');

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
  let onKeyDown: ((e: KeyboardEvent) => void) | null = null;

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
      .querySelectorAll('.panel-resize-handle, .panel-col-resize-handle')
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
    originalNext = el.nextSibling;
    ghost = makeGhost();
    el.classList.add('panel-drag-source');
    document.body.classList.add('panel-drag-active');
    onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelDrag();
    };
    document.addEventListener('keydown', onKeyDown, true);
  };

  const finishVisuals = () => {
    if (grid) clearFlip(grid);
    el.classList.remove('panel-drag-source');
    document.body.classList.remove('panel-drag-active');
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
    if (wasDragging && grid) {
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
  /** Height at drag start → the panel's current span. */
  getStartSpan: () => number;
  /** Live: apply the given span while dragging (Panel owns the span→class mapping). */
  onPreview: (span: number) => void;
  /** Persist the final span on release. */
  onCommit: (span: number) => void;
}

/**
 * Drive a panel's bottom resize handle with the same pointer plumbing as drag.
 * Height snaps to a discrete row-span on a clean rowPx grid, so snap points line
 * up with the cursor. Returns a cleanup fn.
 */
export function attachPanelResize(
  el: HTMLElement,
  handle: HTMLElement,
  opts: PanelResizeOptions,
): () => void {
  const minSpan = opts.minSpan ?? 1;
  const maxSpan = opts.maxSpan ?? 4;
  const rowPx = opts.rowPx ?? 200;

  let pointerId: number | null = null;
  let resizing = false;
  let startY = 0;
  let startHeight = 0;
  let lastSpan = minSpan;

  const spanFor = (height: number): number => {
    const span = Math.round(height / rowPx);
    return Math.min(maxSpan, Math.max(minSpan, span));
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!resizing || e.pointerId !== pointerId) return;
    e.preventDefault();
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
    opts.onCommit(lastSpan);
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
    startY = e.clientY;
    startHeight = el.getBoundingClientRect().height;
    lastSpan = opts.getStartSpan();
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
  /** Live preview: apply a span of `cols` out of `total` grid columns. */
  onPreview: (cols: number, total: number) => void;
  /** Persist the final span (cols out of total). */
  onCommit: (cols: number, total: number) => void;
}

/**
 * Horizontal sibling of attachPanelResize: drag a panel's right edge to set how
 * many grid COLUMNS it spans, snapping to the live `repeat(auto-fill, …)` track
 * so a panel (the map) can be pulled down to half width and let others flow in
 * beside it. The module owns pointer math + column snapping; the caller owns the
 * cols→style mapping and persistence.
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
  let gridLeft = 0;
  let lastCols = 1;

  // Read the live column geometry: track count + (track width + gap) as the step.
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
    gridLeft = rect.left + padLeft;
  };

  const colsFor = (clientX: number): number => {
    if (colStep <= 0) return total;
    const cols = Math.round((clientX - gridLeft) / colStep);
    return Math.min(total, Math.max(1, cols));
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!resizing || e.pointerId !== pointerId) return;
    e.preventDefault();
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
    opts.onCommit(lastCols, total);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    end();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const grid = opts.getGrid();
    if (!grid) return;
    e.preventDefault();
    e.stopPropagation();
    measure(grid);
    pointerId = e.pointerId;
    resizing = true;
    lastCols = opts.getStartCols();
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
