// Live-value flash — ONE place, zero coupling. A single MutationObserver watches
// the panel grid; when a short numeric leaf (price, count, score) changes value it
// gets a brief .value-bump class so the dashboard reads as alive. Panels stay
// ignorant of it.
//
// Panels re-render by wholesale innerHTML replacement (Panel.setContent), so the
// change almost never arrives as an in-place characterData edit — it arrives as a
// childList mutation that swaps the whole subtree. So we handle both: characterData
// bumps the edited leaf directly; a childList swap is diffed by snapshotting the
// numeric leaves of the removed subtree (keyed by a stable positional signature)
// and bumping the same-signature leaf in the added subtree whenever its numeric
// text changed. Cheap by construction: a per-mutation node-visit budget caps the
// work, and a first render (nothing numeric to match against) produces no bumps.

const NUMERIC = /[0-9]/;
const MAX_LEN = 24; // only short leaves: "$4,093", "-1.54%", "82", "15.57"
const FLASH_MS = 700;
const NODE_BUDGET = 800; // max element nodes visited per childList mutation

function bump(el: HTMLElement): void {
  el.classList.remove('value-bump'); // restart if mid-flash
  void el.offsetWidth; // reflow to re-trigger the animation
  el.classList.add('value-bump');
  setTimeout(() => el.classList.remove('value-bump'), FLASH_MS);
}

// A numeric leaf is a childless element whose text is short and contains a digit.
function isNumericLeaf(el: Element): el is HTMLElement {
  if (el.childElementCount > 0) return false;
  const text = el.textContent ?? '';
  return text.length > 0 && text.length <= MAX_LEN && NUMERIC.test(text);
}

function leafOf(node: Node): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : node.parentElement;
  if (!el || el.childElementCount > 0) return null;
  return isNumericLeaf(el) ? el : null;
}

// Depth-first walk of an element subtree emitting each numeric leaf with a stable
// positional signature (the child-index path). Shares a mutable budget so a single
// mutation can never walk more than NODE_BUDGET elements across all its nodes.
function eachNumericLeaf(
  root: Node,
  sigPrefix: string,
  budget: { n: number },
  emit: (sig: string, el: HTMLElement) => void
): void {
  if (budget.n <= 0 || !(root instanceof Element)) return;
  budget.n--;
  if (root.childElementCount === 0) {
    if (isNumericLeaf(root)) emit(sigPrefix, root);
    return;
  }
  const children = root.children;
  for (let i = 0; i < children.length; i++) {
    if (budget.n <= 0) break;
    eachNumericLeaf(children[i]!, `${sigPrefix}.${i}`, budget, emit);
  }
}

// Diff the numeric leaves of a swapped subtree: whatever leaf sits at the same
// positional signature and now shows different numeric text gets bumped. Fixed-order
// panels (markets/FX/crypto/commodities/yields) keep a stable row order across
// refreshes, so signatures line up and only genuinely-changed values flash.
function diffSwap(removed: NodeList, added: NodeList): void {
  const budget = { n: NODE_BUDGET };
  const before = new Map<string, string>();
  for (let i = 0; i < removed.length; i++) {
    eachNumericLeaf(removed[i]!, String(i), budget, (sig, el) => {
      before.set(sig, el.textContent ?? '');
    });
  }
  if (before.size === 0) return; // first render / no prior values — nothing to flash
  for (let i = 0; i < added.length; i++) {
    eachNumericLeaf(added[i]!, String(i), budget, (sig, el) => {
      const prev = before.get(sig);
      const text = el.textContent ?? '';
      if (prev !== undefined && prev !== text) bump(el);
    });
  }
}

export function installLiveFlash(root?: HTMLElement): void {
  const target = root ?? document.querySelector<HTMLElement>('.main-content') ?? document.body;
  const seen = new WeakMap<HTMLElement, string>();
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'characterData') {
        const el = leafOf(m.target);
        if (!el) continue;
        const text = el.textContent ?? '';
        const prev = seen.get(el);
        seen.set(el, text);
        if (prev !== undefined && prev !== text) bump(el);
        continue;
      }
      // childList: a wholesale subtree swap (the common panel-refresh path).
      if (m.addedNodes.length > 0 && m.removedNodes.length > 0) {
        diffSwap(m.removedNodes, m.addedNodes);
      }
    }
  });
  observer.observe(target, { subtree: true, characterData: true, childList: true });
}
