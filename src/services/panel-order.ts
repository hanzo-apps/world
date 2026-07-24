// Canonical panel-order persistence — the ONE reader/writer for the saved grid
// order, keyed and formatted IDENTICALLY to what the vanilla `App` writes today
// (localStorage key `panel-order`, value `string[]` of panel ids in grid order).
// The vanilla App owns the same key inline (getSavedPanelOrder / savePanelOrder);
// this module is the shared, importable form so the React surface reads and writes
// the EXACT same layout — no second format, no second key. React and vanilla stay
// interoperable through this one store.

export const PANEL_ORDER_KEY = 'panel-order';

/** The full saved order (all panel ids the user has arranged), or [] if none. */
export function loadPanelOrder(): string[] {
  try {
    const raw = localStorage.getItem(PANEL_ORDER_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Persist the new relative order of the `managed` panel ids WITHOUT disturbing any
 * other ids already saved (e.g. the vanilla dashboard's full panel set). Managed ids
 * are re-slotted in place — their occupied positions in the saved list stay put while
 * their order among themselves becomes `managed`; genuinely-new managed ids append.
 * A React grid holding only a subset can therefore save its order into the shared
 * key without clobbering vanilla's arrangement.
 */
export function savePanelOrder(managed: string[]): void {
  const existing = loadPanelOrder();
  const managedSet = new Set(managed);
  const queue = [...managed];
  const merged = existing.map((id) => (managedSet.has(id) ? queue.shift() ?? id : id));
  for (const id of managed) if (!existing.includes(id)) merged.push(id);
  try {
    localStorage.setItem(PANEL_ORDER_KEY, JSON.stringify(merged));
  } catch {
    /* private mode — order simply won't persist */
  }
}

/**
 * Order `items` by the saved layout: ids present in the saved order sort by their
 * saved index; ids not yet saved keep their given order and fall after. Stable.
 */
export function orderBySaved<T>(items: readonly T[], getId: (item: T) => string): T[] {
  const order = loadPanelOrder();
  const rank = new Map(order.map((id, i) => [id, i] as const));
  return items
    .map((item, i) => ({ item, i, r: rank.get(getId(item)) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r - b.r))
    .map((x) => x.item);
}
