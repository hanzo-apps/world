// Keyboard-operability helpers for non-native clickable rows.
//
// A clickable <tr>/<div> row is invisible to keyboard and screen-reader users
// unless it declares a role and joins the tab order. `makeActivatable` upgrades
// one to behave like a native button: it fires `activate` on click AND on
// Enter/Space, so mouse and keyboard reach the exact same action. The global
// :focus-visible ring styles the focused row, so there's no visual change until
// a keyboard user tabs to it. One canonical way to make a row operable.

export function makeActivatable(el: HTMLElement, activate: () => void): void {
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.addEventListener('click', activate);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate();
    }
  });
}

// A row whose only affordance is the shared right-click context menu (the
// data-ctx-* convention services/panel-menu.ts listens for) — e.g. a market
// quote's "Copy symbol / Copy value". Keyboard users can't right-click, so put
// the row in the tab order, announce it as a menu button, and open the SAME menu
// on Enter/Space via a synthesized contextmenu event at the row's position.
export function makeContextMenuActivatable(el: HTMLElement): void {
  el.setAttribute('role', 'button');
  el.setAttribute('aria-haspopup', 'menu');
  el.setAttribute('tabindex', '0');
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(r.left + Math.min(24, r.width / 2)),
      clientY: Math.round(r.top + Math.min(24, r.height / 2)),
    }));
  });
}
