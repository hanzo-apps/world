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
      .locator('[data-panel="delta"] .panel-corner-resize-handle')
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

    // Height grew to a taller row-span and width snapped to multiple columns.
    await expect(page.locator('[data-panel="delta"]')).toHaveClass(/span-2/);
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
      .locator('[data-panel="alpha"] .panel-corner-resize-handle')
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
