// Wheel → horizontal scroll for wide, horizontally-overflowing rows (benchmark
// tables, fleet rows, wide stat strips) so a mouse-wheel user can move through them
// even though the scrollbar chrome is hidden (see .scroll-x / .enso-bm-wrap in
// main.css). One delegated listener, dashboard-wide — no per-container wiring.
//
// Trackpad two-finger gestures (which already emit deltaX) are left untouched, and
// at either horizontal edge the event falls through so the page keeps scrolling.

const H_SELECTOR = '.scroll-x, .enso-bm-wrap';

export function installHorizontalWheelScroll(): void {
  document.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      // Only translate a vertical-dominant wheel; native horizontal / trackpad wins.
      if (e.deltaY === 0 || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const el = (e.target as Element | null)?.closest?.(H_SELECTOR) as HTMLElement | null;
      if (!el) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1) return; // nothing overflowing horizontally
      const atStart = el.scrollLeft <= 0 && e.deltaY < 0;
      const atEnd = el.scrollLeft >= max - 1 && e.deltaY > 0;
      if (atStart || atEnd) return; // let the page take over past the ends
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false },
  );
}
