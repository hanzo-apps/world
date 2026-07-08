import { expect, test, type Page } from '@playwright/test';

// Drives the real panel-drag module (pointer events, custom ghost, gap-opening
// FLIP reflow, snapping resize) through the deterministic harness.

const HARNESS = '/tests/panel-drag-harness.html';

interface PanelDragHarness {
  ready: boolean;
  reorderCount: number;
  lastCommittedSpan: number | null;
  order: () => string[];
}

declare global {
  interface Window {
    __panelDragHarness?: PanelDragHarness;
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
