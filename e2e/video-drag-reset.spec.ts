import { expect, test, type Page } from '@playwright/test';

// Drives the REAL app module graph (via the vite dev server) to prove, on the
// live dashboard, that:
//   1. the live-news VIDEO panel is grabbable by its header and drags even
//      though it hosts a YouTube iframe (iframes go pointer-events:none while a
//      drag is in flight, so drop hit-testing stays accurate);
//   2. a normal content panel can be reordered and the new order sticks;
//   3. the bottom resize handle snaps a panel to a taller row-span;
//   4. the Panels-menu "Reset layout" control returns the grid to its default.
//
// Complements panel-drag.spec.ts (which unit-tests the drag module in isolation).

async function appReady(page: Page): Promise<void> {
  await page.goto('/?variant=full');
  await page.waitForSelector('#panelsGrid .panel[data-panel="live-news"]', { timeout: 45000 });
  await page.waitForFunction(
    () => document.querySelectorAll('#panelsGrid .panel').length > 4,
    undefined,
    { timeout: 45000 },
  );
  // The app now DEFAULTS to free layout (independent, non-reflowing panels). These
  // specs exercise the GRID reorder/ghost/row-span/reset machinery specifically, so
  // pin grid mode (still a first-class, dropdown-selectable mode). setLayoutMode
  // marks the choice explicit, so the deferred default-to-free never re-flips it.
  await page.evaluate(() =>
    (window as unknown as { worldGrid?: { setLayoutMode(m: string): void } }).worldGrid?.setLayoutMode('grid'),
  );
  await page.waitForTimeout(80);
}

function gridOrder(page: Page): Promise<(string | undefined)[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#panelsGrid .panel')).map(
      (p) => (p as HTMLElement).dataset.panel,
    ),
  );
}

// Reorder by dragging a LATER on-screen content panel UP onto an EARLIER one, and
// return the moved panel's key. The grid is far taller than the viewport, so a drop
// at the grid's geometric bottom lands in empty space with no panel to reorder
// against; the reorder needs a real panel under the pointer. Dragging up (later →
// earlier) guarantees the DOM order changes — dragging an earlier panel down onto
// its adjacent neighbour would re-drop it exactly where it already sits.
async function dragReorderOnScreen(page: Page): Promise<string> {
  const onscreen = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#panelsGrid .panel'))
      .map((p) => {
        const r = (p as HTMLElement).getBoundingClientRect();
        return { k: (p as HTMLElement).dataset.panel, y: r.y, cy: r.y + r.height / 2 };
      })
      // grabbable header + droppable centre inside the viewport; the map + live-news
      // are pinned anchors, never reorder subjects.
      .filter((b) => b.k && b.k !== 'map' && b.k !== 'live-news' && b.y > 60 && b.cy < 680)
      .map((b) => b.k as string),
  );
  expect(onscreen.length).toBeGreaterThan(1);
  const target = onscreen[0];
  const movable = onscreen[onscreen.length - 1];

  const sb = (await page.locator(`#panelsGrid .panel[data-panel="${movable}"] .panel-header`).first().boundingBox())!;
  const tb = (await page.locator(`#panelsGrid .panel[data-panel="${target}"]`).boundingBox())!;
  await page.mouse.move(sb.x + 40, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + 60, sb.y + sb.height / 2 + 20, { steps: 6 }); // cross the 6px press threshold
  // The reorder decides insert-before vs -after purely by X (panel-drag.ts: a drop
  // on the target's LEFT half inserts before it). Aim well inside the left quarter,
  // not the centre, so the drop is unambiguously "before" and doesn't oscillate on
  // the gap-opening FLIP reflow; after inserting, the pointer rests over the moved
  // (excluded) source, so no further reorder fires.
  await page.mouse.move(tb.x + tb.width * 0.25, tb.y + tb.height / 2, { steps: 18 });
  await page.mouse.up();
  return movable;
}

test.describe('video panel drag + reset (live app)', () => {
  test('the live-news video panel is grabbable by its header and its iframe yields during drag', async ({ page }) => {
    await appReady(page);

    const header = page.locator('#panelsGrid .panel[data-panel="live-news"] .panel-header').first();
    const hb = (await header.boundingBox())!;

    // Grab the header away from its buttons, cross the 6px press threshold, and
    // sweep down into the grid.
    await page.mouse.move(hb.x + 50, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 70, hb.y + hb.height / 2 + 30, { steps: 6 });
    await page.mouse.move(hb.x + 90, hb.y + hb.height / 2 + 220, { steps: 12 });

    // Mid-drag invariants: a ghost exists, the body is flagged, and any iframe is
    // pointer-events:none so it can't swallow the drop hit-test.
    expect(await page.locator('.panel-drag-ghost').count()).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.body.classList.contains('panel-drag-active'))).toBe(true);
    const iframePE = await page.evaluate(() => {
      const f = document.querySelector('#panelsGrid .panel[data-panel="live-news"] iframe') as HTMLElement | null;
      return f ? getComputedStyle(f).pointerEvents : 'none-or-absent';
    });
    expect(['none', 'none-or-absent']).toContain(iframePE);

    await page.mouse.up();
    // Ghost is cleaned up after release.
    await expect(page.locator('.panel-drag-ghost')).toHaveCount(0);
  });

  test('a content panel can be dragged to a new slot and the order changes', async ({ page }) => {
    await appReady(page);
    const before = await gridOrder(page);

    const movable = await dragReorderOnScreen(page);

    const after = await gridOrder(page);
    expect(after).not.toEqual(before);
    // The moved panel is no longer where it started.
    expect(after.indexOf(movable)).not.toBe(before.indexOf(movable));
  });

  test('the resize handle snaps a panel to a taller span', async ({ page }) => {
    await appReady(page);
    const before = await gridOrder(page);
    const key = before.find((k) => k && k !== 'live-news' && k !== 'map')!;
    const panel = page.locator(`#panelsGrid .panel[data-panel="${key}"]`);
    const handle = panel.locator('.panel-resize-handle');
    const h = (await handle.boundingBox())!;

    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 230, { steps: 14 });
    await page.mouse.up();

    // Height resize lands on the fine 16px row grid (smooth ~20px steps), so the
    // panel carries `resized` + a data-span well above the ~100px minSpan — not the
    // coarse span-2 tier class the old assertion expected.
    await expect(panel).toHaveClass(/resized/);
    const span = await panel.evaluate((el) => parseInt((el as HTMLElement).dataset.span ?? '0', 10));
    expect(span).toBeGreaterThan(5);
  });

  test('Reset layout returns the grid to the default order', async ({ page }) => {
    await appReady(page);
    const original = await gridOrder(page);

    // Reorder a panel so the layout is dirty.
    await dragReorderOnScreen(page);
    expect(await gridOrder(page)).not.toEqual(original);

    // Open the Panels menu and hit Reset layout (this reloads the app).
    await page.click('#settingsBtn');
    await page.waitForSelector('#resetLayoutBtn', { state: 'visible' });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('#resetLayoutBtn'),
    ]);

    // After reset+reload the grid rebuilds from DEFAULT_PANELS: the full-width map
    // is the leading anchor, and the order matches a fresh session.
    await appReady(page);
    const reset = await gridOrder(page);
    expect(reset[0]).toBe('map');
    expect(reset).toEqual(original);
  });
});
