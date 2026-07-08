// Live-value flash — ONE place, zero coupling. A single MutationObserver
// watches the panel grid; when a short numeric leaf (price, count, score)
// changes text, it gets a brief .value-bump class so the dashboard reads as
// alive. Panels stay ignorant of it (independent reimplementation of the
// count-bump behavior seen in dense market dashboards; no upstream code).

const NUMERIC = /[0-9]/;
const MAX_LEN = 24; // only short leaves: "$4,093", "-1.54%", "82", "15.57"
const FLASH_MS = 700;

function bump(el: HTMLElement): void {
  el.classList.remove('value-bump'); // restart if mid-flash
  void el.offsetWidth; // reflow to re-trigger the animation
  el.classList.add('value-bump');
  setTimeout(() => el.classList.remove('value-bump'), FLASH_MS);
}

function leafOf(node: Node): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : node.parentElement;
  if (!el || el.children.length > 0) return null;
  const text = el.textContent ?? '';
  if (!text || text.length > MAX_LEN || !NUMERIC.test(text)) return null;
  return el;
}

export function installLiveFlash(root?: HTMLElement): void {
  const target = root ?? document.querySelector<HTMLElement>('.main-content') ?? document.body;
  const seen = new WeakMap<HTMLElement, string>();
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      const node = m.type === 'characterData' ? m.target : m.target;
      const el = leafOf(node);
      if (!el) continue;
      const text = el.textContent ?? '';
      const prev = seen.get(el);
      seen.set(el, text);
      if (prev !== undefined && prev !== text) bump(el);
    }
  });
  observer.observe(target, { subtree: true, characterData: true, childList: true });
}
