import { expect, test, type Page } from '@playwright/test';

// Drives the real panel-drag module (pointer events, custom ghost, gap-opening
// FLIP reflow, snapping resize) through the deterministic harness.

const HARNESS = '/tests/panel-drag-harness.html';
const LAYOUT_HARNESS = '/tests/layout-harness.html';
// Screenshots land in a repo-relative artifacts dir (Playwright creates it).
const SHOTS = 'e2e/layout-shots';

interface PanelDragHarness {
  ready: boolean;
  reorderCount: number;
  lastCommittedSpan: number | null;
  order: () => string[];
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface LayoutHarness {
  ready: boolean;
  mode: () => 'grid' | 'free';
  setMode: (m: 'grid' | 'free') => void;
  toggle: () => 'grid' | 'free';
  cell: () => number;
  setCell: (px: number) => void;
  rect: (id: string) => Rect | null;
  colStep: () => { step: number; cols: number; padL: number };
  order: () => string[];
  overlayVisible: () => boolean;
  gridColumnOf: (id: string) => string;
}

declare global {
  interface Window {
    __panelDragHarness?: PanelDragHarness;
    __layoutHarness?: LayoutHarness;
  }
}

async function ready(page: Page): Promise<void> {
  await page.goto(HARNESS);
  await page.waitForFunction(() => window.__panelDragHarness?.ready === true);
}

async function order(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__panelDragHarness!.order());
}

test.describe('panel drag + resize', () => {
  test('pointer drag reorders panels and fires onReorder', async ({ page }) => {
    await ready(page);

    const before = await order(page);
    expect(before).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);

    const src = (await page.locator('[data-panel="p0"]').boundingBox())!;
    const last = (await page.locator('[data-panel="p5"]').boundingBox())!;

    // Grab p0 by its header, cross the 6px threshold, sweep to the right half of
    // the last panel (→ drop after it), release.
    await page.mouse.move(src.x + src.width / 2, src.y + 12);
    await page.mouse.down();
    await page.mouse.move(src.x + src.width / 2 + 24, src.y + 12, { steps: 4 });
    await page.mouse.move(last.x + last.width * 0.8, last.y + last.height / 2, { steps: 16 });
    await page.mouse.up();

    const after = await order(page);
    expect(after).not.toEqual(before);
    expect(after[after.length - 1]).toBe('p0'); // p0 dropped at the end
    expect(after[0]).toBe('p1');

    const reorders = await page.evaluate(() => window.__panelDragHarness!.reorderCount);
    expect(reorders).toBeGreaterThan(0);
  });

  test('a press without crossing the threshold does not reorder', async ({ page }) => {
    await ready(page);

    const before = await order(page);
    const box = (await page.locator('[data-panel="p1"]').boundingBox())!;

    await page.mouse.move(box.x + box.width / 2, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 3, box.y + 12); // under 6px threshold
    await page.mouse.up();

    expect(await order(page)).toEqual(before);
    const reorders = await page.evaluate(() => window.__panelDragHarness!.reorderCount);
    expect(reorders).toBe(0);
  });

  test('Escape cancels a drag and restores the original order', async ({ page }) => {
    await ready(page);

    const before = await order(page);
    const src = (await page.locator('[data-panel="p0"]').boundingBox())!;
    const mid = (await page.locator('[data-panel="p3"]').boundingBox())!;

    await page.mouse.move(src.x + src.width / 2, src.y + 12);
    await page.mouse.down();
    await page.mouse.move(mid.x + mid.width / 2, mid.y + mid.height / 2, { steps: 12 });
    await page.keyboard.press('Escape');
    await page.mouse.up();

    expect(await order(page)).toEqual(before);
  });

  test('resize handle snaps height to a grid row-span', async ({ page }) => {
    await ready(page);

    const p2 = page.locator('[data-panel="p2"]');
    const handle = p2.locator('.panel-resize-handle');
    const h = (await handle.boundingBox())!;

    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 230, { steps: 12 });
    await page.mouse.up();

    await expect(p2).toHaveClass(/span-2/);
    const span = await page.evaluate(() => window.__panelDragHarness!.lastCommittedSpan);
    expect(span).toBe(2);
  });
});

// ── Layout engine: grid ⇄ free, corner resize, cell-size, overlay ──────────
// Drives the real Panel grips + grid-config against the true main.css, at
// 1440x900 (see playwright.layout.config.ts).

const lh = async (page: Page): Promise<void> => {
  await page.goto(LAYOUT_HARNESS);
  await page.waitForFunction(() => window.__layoutHarness?.ready === true);
  await page.waitForTimeout(60); // let the queued registerPanel microtasks settle
};

const rect = (page: Page, id: string): Promise<Rect> =>
  page.evaluate((pid) => window.__layoutHarness!.rect(pid)!, id);

const headerBox = async (page: Page, id: string) =>
  (await page.locator(`[data-panel="${id}"] .panel-header`).first().boundingBox())!;

test.describe('layout engine', () => {
  // Gate viewport: 1440x900 (independent of the base config's default size).
  test.use({ viewport: { width: 1440, height: 900 } });

  test('grid mode: a dropped panel lands on a cell boundary', async ({ page }) => {
    await lh(page);
    expect(await page.evaluate(() => window.__layoutHarness!.mode())).toBe('grid');

    const src = await headerBox(page, 'charlie');
    const dst = (await page.locator('[data-panel="echo"]').boundingBox())!;

    await page.mouse.move(src.x + 30, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(src.x + 60, src.y + src.height / 2, { steps: 4 });
    await page.mouse.move(dst.x + dst.width * 0.8, dst.y + dst.height / 2, { steps: 16 });
    await page.mouse.up();

    // Final resting position is snapped to a grid cell (multiple of the column step).
    const { step, padL } = await page.evaluate(() => window.__layoutHarness!.colStep());
    const r = await rect(page, 'charlie');
    const k = Math.round((r.left - padL) / step);
    expect(Math.abs(r.left - padL - k * step)).toBeLessThan(4);

    await page.screenshot({ path: `${SHOTS}/grid-snap.png` });
  });

  test('grid mode: bottom-right corner resizes width + height (snapped)', async ({ page }) => {
    await lh(page);
    const corner = (await page
      .locator('[data-panel="delta"] .panel-corner-resize-handle.se')
      .boundingBox())!;
    const { step } = await page.evaluate(() => window.__layoutHarness!.colStep());

    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
    await page.mouse.down();
    // Pull out ~1.5 columns wide and ~250px tall.
    await page.mouse.move(
      corner.x + corner.width / 2 + step * 1.5,
      corner.y + corner.height / 2 + 250,
      { steps: 16 },
    );
    await page.mouse.up();

    // Height grew (fine 16px row grid → a data-span well above the ~100px min) and
    // width snapped to multiple columns. Resize lands on the fine grid, not the
    // coarse span-N tier classes, so the panel carries `resized` + a data-span.
    await expect(page.locator('[data-panel="delta"]')).toHaveClass(/resized/);
    const span = await page.evaluate(() =>
      parseInt(document.querySelector<HTMLElement>('[data-panel="delta"]')!.dataset.span ?? '0', 10),
    );
    expect(span).toBeGreaterThan(5); // taller than its start via the fine row grid
    const gc = await page.evaluate(() => window.__layoutHarness!.gridColumnOf('delta'));
    expect(gc).toMatch(/span [2-9]/);

    await page.screenshot({ path: `${SHOTS}/resized-from-corner.png` });
  });

  test('grid mode: overlay appears only while dragging', async ({ page }) => {
    await lh(page);
    expect(await page.evaluate(() => window.__layoutHarness!.overlayVisible())).toBe(false);

    const src = await headerBox(page, 'bravo');
    await page.mouse.move(src.x + 30, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(src.x + 120, src.y + 40, { steps: 8 });

    // Mid-drag: the faint track overlay is shown.
    await expect
      .poll(() => page.evaluate(() => window.__layoutHarness!.overlayVisible()))
      .toBe(true);
    await page.screenshot({ path: `${SHOTS}/grid-overlay.png` });

    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.__layoutHarness!.overlayVisible()))
      .toBe(false);
  });

  test('grid mode: changing cell size re-snaps the grid', async ({ page }) => {
    await lh(page);
    const before = await page.evaluate(() => window.__layoutHarness!.colStep());

    await page.evaluate(() => window.__layoutHarness!.setCell(240));
    await page.waitForTimeout(50);

    const after = await page.evaluate(() => window.__layoutHarness!.colStep());
    // Wider cells ⇒ fewer, wider columns: the panels re-snap to a new track grid.
    expect(after.step).toBeGreaterThan(before.step + 20);
    expect(after.cols).toBeLessThanOrEqual(before.cols);
    expect(await page.evaluate(() => window.__layoutHarness!.cell())).toBe(240);
  });

  test('free mode: pixel drag + corner resize persist across reload', async ({ page }) => {
    await lh(page);
    await page.evaluate(() => window.__layoutHarness!.setMode('free'));
    await page.waitForTimeout(40);
    expect(await page.evaluate(() => window.__layoutHarness!.mode())).toBe('free');

    // Hold Alt to bypass grid snapping — this test asserts that exact arbitrary-pixel
    // geometry survives a reload (snapping has its own tests below).
    await page.keyboard.down('Alt');
    // Drag alpha by an arbitrary (non-cell) pixel delta.
    const start = await rect(page, 'alpha');
    const hdr = await headerBox(page, 'alpha');
    const DX = 223;
    const DY = -137;
    await page.mouse.move(hdr.x + 30, hdr.y + hdr.height / 2);
    await page.mouse.down();
    await page.mouse.move(hdr.x + 40, hdr.y + hdr.height / 2, { steps: 3 });
    await page.mouse.move(hdr.x + 30 + DX, hdr.y + hdr.height / 2 + DY, { steps: 16 });
    await page.mouse.up();

    const moved = await rect(page, 'alpha');
    expect(Math.abs(moved.left - (start.left + DX))).toBeLessThan(6);
    expect(Math.abs(moved.top - (start.top + DY))).toBeLessThan(6);
    // Arbitrary pixel position — not snapped to a cell.
    await page.screenshot({ path: `${SHOTS}/free-form.png` });

    // Resize from the corner to an arbitrary size.
    const corner = (await page
      .locator('[data-panel="alpha"] .panel-corner-resize-handle.se')
      .boundingBox())!;
    const WD = 118;
    const HD = 94;
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      corner.x + corner.width / 2 + WD,
      corner.y + corner.height / 2 + HD,
      { steps: 16 },
    );
    await page.mouse.up();

    const resized = await rect(page, 'alpha');
    expect(Math.abs(resized.width - (moved.width + WD))).toBeLessThan(6);
    expect(Math.abs(resized.height - (moved.height + HD))).toBeLessThan(6);

    await page.keyboard.up('Alt');
    // Reload: the mode + exact geometry are restored.
    await page.reload();
    await page.waitForFunction(() => window.__layoutHarness?.ready === true);
    await page.waitForTimeout(80);
    expect(await page.evaluate(() => window.__layoutHarness!.mode())).toBe('free');
    const restored = await rect(page, 'alpha');
    expect(Math.abs(restored.left - resized.left)).toBeLessThan(3);
    expect(Math.abs(restored.top - resized.top)).toBeLessThan(3);
    expect(Math.abs(restored.width - resized.width)).toBeLessThan(3);
    expect(Math.abs(restored.height - resized.height)).toBeLessThan(3);
  });

  test('free mode: all four corners resize and pin the opposite corner', async ({ page }) => {
    await lh(page);
    await page.evaluate(() => window.__layoutHarness!.setMode('free'));
    await page.waitForTimeout(40);
    expect(await page.evaluate(() => window.__layoutHarness!.mode())).toBe('free');

    // Alt bypasses snapping so the shrink is exactly the drag delta; this test is
    // about the anchor-pinning invariant, which holds with or without snapping.
    await page.keyboard.down('Alt');
    const D = 60; // drag each corner inward (toward the panel centre) — always in-bounds
    // corner → inward drag sign + which opposite corner must stay pinned.
    const cases = [
      { panel: 'alpha', corner: 'nw', sx: 1, sy: 1, fix: 'br' },
      { panel: 'bravo', corner: 'ne', sx: -1, sy: 1, fix: 'bl' },
      { panel: 'charlie', corner: 'sw', sx: 1, sy: -1, fix: 'tr' },
      { panel: 'delta', corner: 'se', sx: -1, sy: -1, fix: 'tl' },
    ] as const;

    for (const c of cases) {
      const b = await rect(page, c.panel);
      const h = (await page
        .locator(`[data-panel="${c.panel}"] .panel-corner-resize-handle.${c.corner}`)
        .boundingBox())!;
      const px = h.x + h.width / 2;
      const py = h.y + h.height / 2;
      await page.mouse.move(px, py);
      await page.mouse.down();
      await page.mouse.move(px + c.sx * D, py + c.sy * D, { steps: 12 });
      await page.mouse.up();
      const a = await rect(page, c.panel);

      // The grabbed corner pulled inward on both axes → the panel shrank.
      expect(a.width).toBeLessThan(b.width - 20);
      expect(a.height).toBeLessThan(b.height - 20);

      // The OPPOSITE corner never moved — proof the resize is anchor-aware
      // (nw/ne/sw shift left/top to hold the far edge, not just grow w/h).
      const bR = b.left + b.width;
      const bB = b.top + b.height;
      const aR = a.left + a.width;
      const aB = a.top + a.height;
      if (c.fix === 'br') {
        expect(Math.abs(aR - bR)).toBeLessThan(4);
        expect(Math.abs(aB - bB)).toBeLessThan(4);
      } else if (c.fix === 'bl') {
        expect(Math.abs(a.left - b.left)).toBeLessThan(4);
        expect(Math.abs(aB - bB)).toBeLessThan(4);
      } else if (c.fix === 'tr') {
        expect(Math.abs(aR - bR)).toBeLessThan(4);
        expect(Math.abs(a.top - b.top)).toBeLessThan(4);
      } else {
        expect(Math.abs(a.left - b.left)).toBeLessThan(4);
        expect(Math.abs(a.top - b.top)).toBeLessThan(4);
      }
    }
    await page.keyboard.up('Alt');
    await page.screenshot({ path: `${SHOTS}/free-all-corners.png` });
  });

  test('free mode: moving one panel never shifts its siblings (no reflow)', async ({ page }) => {
    // The owner's #1 complaint: dragging the map/one panel "shifts all other
    // components". In free mode each panel is independent — this proves a big drag
    // of one leaves every sibling byte-for-byte where it was.
    await lh(page);
    await page.evaluate(() => window.__layoutHarness!.setMode('free'));
    await page.waitForTimeout(40);

    const siblings = ['bravo', 'charlie', 'delta', 'echo'] as const;
    const before: Record<string, Rect> = {};
    for (const id of siblings) before[id] = await rect(page, id);

    const hdr = await headerBox(page, 'alpha');
    await page.mouse.move(hdr.x + 30, hdr.y + hdr.height / 2);
    await page.mouse.down();
    await page.mouse.move(hdr.x + 40, hdr.y + hdr.height / 2, { steps: 3 });
    await page.mouse.move(hdr.x + 300, hdr.y + hdr.height / 2 + 200, { steps: 18 });
    await page.mouse.up();

    for (const id of siblings) {
      const a = await rect(page, id);
      const b = before[id]!;
      expect(Math.abs(a.left - b.left)).toBeLessThan(2);
      expect(Math.abs(a.top - b.top)).toBeLessThan(2);
      expect(Math.abs(a.width - b.width)).toBeLessThan(2);
      expect(Math.abs(a.height - b.height)).toBeLessThan(2);
    }
  });

  test('free mode: a panel resizes narrower than the old 160px min width', async ({ page }) => {
    // The owner's #3 complaint: panels are "constrained on min width". Free mode's
    // floor is now ~96px, so a panel can be pulled well under the old 160px track.
    await lh(page);
    await page.evaluate(() => window.__layoutHarness!.setMode('free'));
    await page.waitForTimeout(40);

    const before = await rect(page, 'bravo');
    const corner = (await page
      .locator('[data-panel="bravo"] .panel-corner-resize-handle.se')
      .boundingBox())!;
    // Pull the SE corner far left → collapse width toward the low floor. Hold Alt for
    // fine (un-snapped) sizing — snapping would otherwise land on a whole cell (≥160).
    await page.keyboard.down('Alt');
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
    await page.mouse.down();
    await page.mouse.move(corner.x - before.width, corner.y + corner.height / 2, { steps: 18 });
    await page.mouse.up();
    await page.keyboard.up('Alt');

    const after = await rect(page, 'bravo');
    expect(after.width).toBeLessThan(150); // narrower than the old 160px floor
    expect(after.width).toBeGreaterThanOrEqual(90); // …but not past the new ~96px floor
  });

  test('free mode: the map participates with a 240px floor', async ({ page }) => {
    await lh(page);
    await page.evaluate(() => window.__layoutHarness!.setMode('free'));
    await page.waitForTimeout(40);
    const pos = await page.evaluate(
      () => getComputedStyle(document.querySelector('[data-panel="map"]')!).position,
    );
    expect(pos).toBe('absolute');
    const r = await rect(page, 'map');
    expect(r.width).toBeGreaterThanOrEqual(240);
    expect(r.height).toBeGreaterThanOrEqual(240);
  });

  test('free mode: dragging snaps to logical grid lines (panels align to shared tracks)', async ({ page }) => {
    // The owner's feedback: "the snap is not logical." Two panels dragged to targets
    // less than half a cell apart must land on the SAME grid line — proof placement is
    // quantised to the logical grid, not arbitrary px.
    await lh(page);
    await page.evaluate(() => window.__layoutHarness!.setMode('free'));
    await page.waitForTimeout(40);
    const cell = await page.evaluate(() => window.__layoutHarness!.cell());
    const colPitch = cell + 4; // + gap
    const rowPitch = 16 + 4; // ROW_UNIT + gap

    const dragTo = async (id: string, x: number, y: number) => {
      const hdr = await headerBox(page, id);
      await page.mouse.move(hdr.x + 20, hdr.y + hdr.height / 2);
      await page.mouse.down();
      await page.mouse.move(hdr.x + 30, hdr.y + hdr.height / 2, { steps: 3 });
      await page.mouse.move(x, y, { steps: 16 });
      await page.mouse.up();
    };

    const gridBox = (await page.locator('#panelsGrid').boundingBox())!;
    const tx = gridBox.x + colPitch * 2 + 20;
    const ty = gridBox.y + rowPitch * 8 + 30;
    await dragTo('alpha', tx, ty);
    await dragTo('bravo', tx + 30, ty + 8); // < half a cell/row from alpha's target

    const a = await rect(page, 'alpha');
    const b = await rect(page, 'bravo');
    // Both snapped to the SAME grid line instead of sitting 30/8px apart.
    expect(Math.abs(a.left - b.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.top - b.top)).toBeLessThanOrEqual(1);
  });

  test('free mode: resizing snaps width to whole cells and pins the opposite edge', async ({ page }) => {
    await lh(page);
    await page.evaluate(() => window.__layoutHarness!.setMode('free'));
    await page.waitForTimeout(40);
    const cell = await page.evaluate(() => window.__layoutHarness!.cell());
    const GAP = 4;

    const before = await rect(page, 'alpha');
    const corner = (await page
      .locator('[data-panel="alpha"] .panel-corner-resize-handle.se')
      .boundingBox())!;
    // Pull the SE corner out by a non-cell amount; width must land on a whole-cell size.
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
    await page.mouse.down();
    await page.mouse.move(corner.x + corner.width / 2 + 210, corner.y + corner.height / 2, { steps: 16 });
    await page.mouse.up();

    const after = await rect(page, 'alpha');
    // width == N*cell + (N-1)*gap for some integer N ≥ 1.
    const n = Math.round((after.width + GAP) / (cell + GAP));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(Math.abs(after.width - (n * cell + (n - 1) * GAP))).toBeLessThanOrEqual(2);
    // The SE resize pins the top-left corner — it must not have moved.
    expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
  });

  test('resize handles show no visible glyphs (owner request) but still resize', async ({ page }) => {
    await lh(page);
    await page.evaluate(() => window.__layoutHarness!.setMode('free'));
    await page.waitForTimeout(40);
    // The corner/edge resize glyphs are hidden (display:none on the ::after marks) —
    // no visible "< >" chevrons — while the handles stay live.
    const displays = await page.evaluate(() => {
      const d = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el, '::after').display : 'missing';
      };
      return {
        corner: d('[data-panel="alpha"] .panel-corner-resize-handle.se'),
        col: d('[data-panel="alpha"] .panel-col-resize-handle'),
        row: d('[data-panel="alpha"] .panel-resize-handle'),
      };
    });
    expect(displays.corner).toBe('none');
    expect(displays.col).toBe('none');
    expect(displays.row).toBe('none');
    // Functionality intact: the (now glyph-less) SE corner still resizes.
    const before = await rect(page, 'alpha');
    const corner = (await page.locator('[data-panel="alpha"] .panel-corner-resize-handle.se').boundingBox())!;
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
    await page.mouse.down();
    await page.mouse.move(corner.x + 180, corner.y + 120, { steps: 12 });
    await page.mouse.up();
    expect((await rect(page, 'alpha')).width).toBeGreaterThan(before.width + 40);
  });

  test('cell size can go down to the finer 80px floor', async ({ page }) => {
    await lh(page);
    await page.evaluate(() => window.__layoutHarness!.setCell(80));
    await page.waitForTimeout(30);
    expect(await page.evaluate(() => window.__layoutHarness!.cell())).toBe(80);
    // Clamped: a request below the floor snaps back up to 80, never lower.
    await page.evaluate(() => window.__layoutHarness!.setCell(40));
    await page.waitForTimeout(30);
    expect(await page.evaluate(() => window.__layoutHarness!.cell())).toBe(80);
  });

  test('toggle flips grid ⇄ free and back', async ({ page }) => {
    await lh(page);
    expect(await page.evaluate(() => window.__layoutHarness!.toggle())).toBe('free');
    expect(await page.evaluate(() => window.__layoutHarness!.mode())).toBe('free');
    expect(await page.evaluate(() => window.__layoutHarness!.toggle())).toBe('grid');
    // Back in grid mode the free inline geometry is stripped.
    const pos = await page.evaluate(
      () => document.querySelector<HTMLElement>('[data-panel="alpha"]')!.style.position,
    );
    expect(pos).toBe('');
  });
});

// ── Live News (video) resizes freely; the video fills the panel at any size ──
// Real app: proves the CTO requirement — Live News can grow to 2-3 cols / full
// width (grid) or any pixel size (free), and the 16:9 video (`.live-news-player`,
// width-driven) scales to fill, never capped small. NOTE: in the offline e2e
// runtime the YouTube embed eventually errors and replaces `.live-news-player`
// with a message, so the video-fill invariant is asserted where it's reliably
// present (default size) and the resize is proved via the player's containing
// block (`.panel-content`, always present), which the player fills 1:1.

const rectW = (page: Page, sel: string): Promise<number> =>
  page.evaluate((s) => {
    const el = document.querySelector<HTMLElement>(s);
    return el ? Math.round(el.getBoundingClientRect().width) : -1;
  }, sel);

const LN = '[data-panel="live-news"]';
const LN_CONTENT = `${LN} .panel-content`;
const LN_PLAYER = `${LN} .live-news-player`;

test.describe('live news video resize (real app)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('grid: default → 3 cols → full-width; the video fills at every width', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(LN, { timeout: 45000 });
    await page.waitForTimeout(500);
    // The app defaults to free layout now; this test asserts GRID column-span
    // semantics, so pin grid explicitly (setLayoutMode marks it an explicit choice
    // so the deferred default-to-free won't re-flip it).
    await page.evaluate(() => (window as unknown as { worldGrid?: { setLayoutMode(m: string): void } }).worldGrid?.setLayoutMode('grid'));
    await page.waitForTimeout(80);

    const grid = (await page.locator('#panelsGrid').boundingBox())!;
    const ln = page.locator(LN);
    const colHandle = ln.locator('.panel-col-resize-handle');

    // The fill setup is active: the panel-content is a full-bleed flex column
    // (padding 0) so the width-driven 16:9 `.live-news-player` fills it edge-to-edge
    // at any width. (Keyed on #live-news — dead until the id fix in LiveNewsPanel.)
    const setup = await page.evaluate((sel) => {
      const c = document.querySelector<HTMLElement>(sel);
      if (!c) return null;
      const s = getComputedStyle(c);
      return { display: s.display, dir: s.flexDirection, padLeft: s.paddingLeft };
    }, LN_CONTENT);
    expect(setup).toEqual({ display: 'flex', dir: 'column', padLeft: '0px' });

    // The video, while present (offline embed errors after a beat), fills the
    // container 1:1 at the default width.
    const startContent = await rectW(page, LN_CONTENT);
    const startVideo = await rectW(page, LN_PLAYER);
    if (startVideo > 0) expect(Math.abs(startVideo - startContent)).toBeLessThan(4);

    // Drag the right edge out to ~3 columns.
    const h1 = (await colHandle.boundingBox())!;
    await page.mouse.move(h1.x + h1.width / 2, h1.y + h1.height / 2);
    await page.mouse.down();
    await page.mouse.move(grid.x + grid.width * 0.42, h1.y + h1.height / 2, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const midContent = await rectW(page, LN_CONTENT);
    expect(midContent).toBeGreaterThan(startContent + 40); // genuinely wider

    // Drag the right edge all the way out → full width. No column cap.
    const h2 = (await colHandle.boundingBox())!;
    await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
    await page.mouse.down();
    await page.mouse.move(grid.x + grid.width + 200, h2.y + h2.height / 2, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const fullContent = await rectW(page, LN_CONTENT);
    expect(fullContent).toBeGreaterThan(midContent);
    expect(fullContent).toBeGreaterThan(grid.width * 0.9); // ~full grid width
    // The video (when present) fills the now-full-width container 1:1.
    const fullVideo = await rectW(page, LN_PLAYER);
    if (fullVideo > 0) expect(Math.abs(fullVideo - fullContent)).toBeLessThan(6);

    // Make it tall too (drag the bottom edge down) so the 16:9 video is large.
    const bottom = ln.locator('.panel-resize-handle');
    const b = (await bottom.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + 520, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    await page.evaluate(() => document.querySelector('[data-panel="live-news"]')?.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'e2e/layout-shots/live-news-fullwidth.png' });

    // Container is now full-width AND tall → a large video area.
    expect(await rectW(page, LN_CONTENT)).toBeGreaterThan(900);
  });

  test('free: Live News resizes to an arbitrary pixel size; video fills', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(LN_PLAYER, { timeout: 45000 });
    await page.waitForTimeout(600);
    const startContent = await rectW(page, LN_CONTENT);
    await page.evaluate(() => (window as unknown as { worldGrid?: { setLayoutMode(m: string): void } }).worldGrid?.setLayoutMode('free'));
    await page.waitForTimeout(200);

    const corner = page.locator(`${LN} .panel-corner-resize-handle.se`);
    const c = (await corner.boundingBox())!;
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await page.mouse.down();
    await page.mouse.move(c.x + 240, c.y + 260, { steps: 18 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const content = await rectW(page, LN_CONTENT);
    expect(content).toBeGreaterThan(startContent + 120); // grew to an arbitrary pixel width
    const video = await rectW(page, LN_PLAYER);
    if (video > 0) expect(Math.abs(video - content)).toBeLessThan(6); // fills at that size
    await page.evaluate(() => (window as unknown as { worldGrid?: { setLayoutMode(m: string): void } }).worldGrid?.setLayoutMode('grid'));
  });
});

// Text size / UI scale (accessibility) — real app.
test.describe('text size control (real app)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('the dock text-size slider scales panel content and persists across reload', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-panel="live-news"]', { timeout: 45000 });
    // Drive the dock "Text size" slider to 1.4.
    await page.evaluate(() => {
      const el = document.getElementById('dockFontSize') as HTMLInputElement;
      el.value = '1.4';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim()))
      .toBe('1.4');
    expect(await page.evaluate(() => localStorage.getItem('hanzo-world-ui-scale'))).toBe('1.4');
    const zoom = await page.evaluate(() => {
      const c = document.querySelector('.panel-content');
      return c ? getComputedStyle(c).zoom : '';
    });
    expect(parseFloat(zoom)).toBeCloseTo(1.4, 1);
    // Persists across reload (applyStoredUiScale runs at boot).
    await page.reload();
    await page.waitForSelector('[data-panel="live-news"]', { timeout: 45000 });
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim())).toBe('1.4');
  });
});
