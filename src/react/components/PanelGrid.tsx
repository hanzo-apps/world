import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { SizableText } from '@hanzo/gui';
import { attachPanelDrag } from '@/services/panel-drag';
import { loadPanelOrder, orderBySaved, savePanelOrder } from '@/services/panel-order';

/**
 * PanelGrid — owns the React surface's panel rail: layout, drag-to-reorder, and
 * order persistence. It is the React analogue of the layout the vanilla `App`
 * owns today, and it deliberately reuses the vanilla machinery rather than
 * re-authoring it — ONE way to drag, ONE place the order is stored:
 *
 *   • drag/reorder  → the vanilla pointer engine `attachPanelDrag` (ghost, FLIP
 *     reflow, touch support, Escape-to-cancel), attached to each panel's `.panel`
 *     card. Grid-reorder is its default mode (`getLayoutMode()` ⇒ "grid").
 *   • persistence   → `@/services/panel-order` writes the SAME `panel-order`
 *     localStorage key, in the SAME `string[]` format, that the vanilla App reads
 *     and writes. React and vanilla therefore share one saved layout; the merge in
 *     `savePanelOrder` re-slots only the ids this rail manages, never clobbering the
 *     vanilla dashboard's arrangement.
 *
 * Panels are supplied as `{ id, render }` items; `render` receives a slot the panel
 * threads into the chassis: `ref` (→ the `.panel` card, the drag target + grid
 * child) and `dragHandle` (the header grip affordance). One panel or fifty — the
 * bulk Stage-2 ports drop straight into `items`.
 */

export interface PanelSlot {
  /** Forward onto the chassis `<Panel ref={…}>` — the drag target + grid child. */
  ref: React.Ref<HTMLDivElement>;
  /** Render inside the chassis header as the grab affordance. */
  dragHandle: ReactNode;
  /** The panel's stable id (also written as `data-panel`). */
  id: string;
}

export interface PanelGridItem {
  id: string;
  render: (slot: PanelSlot) => ReactNode;
}

export interface PanelGridProps {
  items: readonly PanelGridItem[];
}

function DragGrip(): React.JSX.Element {
  // Non-interactive glyph (not a button/a/input) so the drag engine starts a drag
  // on it rather than treating it as an interactive target.
  return (
    <SizableText size="$2" color="$color8" style={{ cursor: 'grab', userSelect: 'none' }} aria-hidden>
      ⠿
    </SizableText>
  );
}

/**
 * One draggable grid cell. Owns the `.panel` card's DOM node (via the ref it hands
 * the panel), stamps `data-panel`, and wires the vanilla drag engine to it. The
 * card renders as a DIRECT child of the grid container (no wrapper DOM), which is
 * what `attachPanelDrag`/`livePanels` require to read and reorder the row.
 */
function PanelGridCell({
  item,
  getGrid,
  onReorder,
}: {
  item: PanelGridItem;
  getGrid: () => HTMLElement | null;
  onReorder: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.dataset.panel = item.id;
    const detach = attachPanelDrag(el, { getGrid, onReorder });
    return detach;
  }, [item.id, getGrid, onReorder]);

  return <>{item.render({ ref, dragHandle: <DragGrip />, id: item.id })}</>;
}

export function PanelGrid({ items }: PanelGridProps): React.JSX.Element {
  const gridRef = useRef<HTMLDivElement>(null);

  // Local order = the saved layout applied to the current items. Ids the user has
  // never arranged fall after, in given order (stable).
  const [order, setOrder] = useState<string[]>(() =>
    orderBySaved(items, (i) => i.id).map((i) => i.id),
  );

  // Keep order in sync when the item SET changes (panels added/removed in Stage 2),
  // re-honouring the saved layout for the new set.
  useEffect(() => {
    setOrder(orderBySaved(items, (i) => i.id).map((i) => i.id));
  }, [items]);

  const ordered = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i] as const));
    const seen = new Set<string>();
    const out: PanelGridItem[] = [];
    for (const id of order) {
      const it = byId.get(id);
      if (it && !seen.has(id)) {
        out.push(it);
        seen.add(id);
      }
    }
    for (const it of items) if (!seen.has(it.id)) out.push(it); // any not covered by order
    return out;
  }, [items, order]);

  const getGrid = useCallback(() => gridRef.current, []);

  // After a committed drag the engine has already reordered the DOM; read that back
  // as the truth, persist it (shared key), and reconcile React state so the keyed
  // children match the DOM exactly.
  const onReorder = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const next = Array.from(grid.children)
      .map((c) => (c as HTMLElement).dataset.panel)
      .filter((id): id is string => !!id);
    savePanelOrder(next);
    setOrder(next);
  }, []);

  // Re-honour an order saved by the OTHER surface (vanilla) when this tab regains
  // focus, so the shared layout stays in sync without a reload.
  useEffect(() => {
    const sync = (): void => {
      if (loadPanelOrder().length) setOrder(orderBySaved(items, (i) => i.id).map((i) => i.id));
    };
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, [items]);

  return (
    <div
      ref={gridRef}
      className="panels-grid"
      style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-end' }}
    >
      {ordered.map((item) => (
        <PanelGridCell key={item.id} item={item} getGrid={getGrid} onReorder={onReorder} />
      ))}
    </div>
  );
}
