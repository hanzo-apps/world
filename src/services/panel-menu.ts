// Right-click context menu for dashboard panels — ONE small monochrome menu,
// installed once. It is a thin trigger surface: menu items dispatch the same
// DOM events the hover ✕ and reset-layout button use, so panel visibility and
// layout state stay owned in one place (App). This module only decides WHEN a
// custom menu is appropriate and renders it; it never mutates dashboard state.
//
// Native-menu contract (never a dead no-op anywhere):
//   • Inside text inputs / textareas / contenteditable → bail, native menu shows.
//   • On the map canvas / container → bail WITHOUT preventDefault, so maplibre
//     keeps right-drag-to-rotate (its own contextmenu suppression stays intact).
//   • Over a panel → our menu (preventDefault only here).
//   • Everywhere else → untouched, native menu shows.

const MENU_ID = 'panelContextMenu';

interface MenuItem {
  label: string;
  run: () => void;
}

function isTextEntry(el: Element | null): boolean {
  const node = el?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');
  return !!node;
}

function isMapSurface(el: Element | null): boolean {
  // Map canvas / deck.gl overlay / maplibre container — leave right-click to the map.
  return !!el?.closest('.map-container, .maplibregl-map, .mapboxgl-map, canvas');
}

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

  const open = (x: number, y: number, items: MenuItem[]): void => {
    close();
    const el = document.createElement('div');
    el.id = MENU_ID;
    el.className = 'panel-context-menu';
    el.setAttribute('role', 'menu');
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'panel-context-menu-item';
      btn.setAttribute('role', 'menuitem');
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        close();
        item.run();
      });
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

  document.addEventListener('contextmenu', (e: MouseEvent) => {
    const target = e.target as Element | null;
    // Never hijack the native menu for text entry or the interactive map surface.
    if (isTextEntry(target) || isMapSurface(target)) {
      close();
      return;
    }
    const panel = target?.closest('.panel, .map-section') as HTMLElement | null;
    if (!panel) {
      close();
      return; // not on a panel → leave the native menu alone
    }

    e.preventDefault();
    const key = panel.dataset.panel;
    const items: MenuItem[] = [];
    if (key) {
      items.push({
        label: 'Hide panel',
        run: () =>
          panel.dispatchEvent(
            new CustomEvent('panel-close-request', { bubbles: true, detail: { id: key } }),
          ),
      });
    }
    items.push({
      label: 'Reset layout',
      run: () =>
        panel.dispatchEvent(new CustomEvent('panel-reset-layout-request', { bubbles: true })),
    });
    open(e.clientX, e.clientY, items);
  });
}
