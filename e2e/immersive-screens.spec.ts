import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Capture the CTO-facing proof screenshots for the layout/style batch. These drive
// the REAL app (not a harness) so they show the shipped chrome + layout. They are
// deliverables, not assertions — kept lenient so a flaky data feed never fails them.

const OUT = join(process.cwd(), 'e2e', 'screens');
mkdirSync(OUT, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, name), fullPage: false });

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#panelsGrid')).toBeVisible({ timeout: 60000 });
  // The map + its chrome mount asynchronously; wait for the projection toggle.
  await expect(page.locator('.deckgl-projection-toggle')).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(1500); // let the first paint + a few panels settle
}

test.describe('layout/style batch — deliverable screenshots', () => {
  test.describe.configure({ timeout: 120000 });

  test('default panel sizes at 1440px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);
    // Panels should be ≥ 2 tracks wide (comfortable), not 160px slivers.
    await shot(page, 'default-sizes-1440.png');
  });

  test('immersive 3D background + floating panels, then video background', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);

    // Globe on.
    await page.locator('.deckgl-projection-toggle .proj-btn[data-mode="3d"]').click().catch(() => {});
    await page.waitForTimeout(1200);

    // Enter immersive.
    await page.locator('#immersiveToggle').click();
    await expect(page.locator('body')).toHaveClass(/immersive/);
    await page.waitForTimeout(2000); // globe reprojects + panels restyle
    await shot(page, 'immersive-3d-panels.png');

    // Switch the background slot to the live video.
    await page.locator('#immersiveBgSelect .ibg-btn[data-bg="video"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-immersive-bg', 'video');
    await page.waitForTimeout(2500); // give the YouTube embed a chance to paint
    await shot(page, 'immersive-video-bg.png');

    // Collapse-to-edge affordance — the globe/video breathes.
    await page.locator('#immersiveBgSelect .ibg-btn[data-bg="map"]').click();
    await page.locator('#immersiveCollapse').click();
    await expect(page.locator('body')).toHaveClass(/immersive-collapsed/);
    await page.waitForTimeout(900);
    await shot(page, 'immersive-collapsed.png');
  });

  test('basemap style switcher (dark / satellite / terrain)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await boot(page);
    await expect(page.locator('.deckgl-style-switcher')).toBeVisible();
    await shot(page, 'style-switcher-dark.png');

    // Satellite + terrain need a Mapbox token (VITE_MAPBOX_TOKEN); the buttons are
    // disabled without one. When a token is configured, actually switch and let the
    // relief render before capturing.
    const sat = page.locator('.deckgl-style-switcher .style-btn[data-style="satellite"]');
    if (!(await sat.isDisabled())) {
      await sat.click();
      await page.waitForTimeout(4000);
      await shot(page, 'style-switcher-satellite.png');
      const terrain = page.locator('.deckgl-style-switcher .style-btn[data-style="terrain"]');
      await terrain.click();
      await page.waitForTimeout(4000);
      await shot(page, 'style-switcher-terrain.png');
    }
  });

  test('layers panel dragged + entries reordered', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await boot(page);
    const panel = page.locator('.deckgl-layer-toggles');
    await expect(panel).toBeVisible();

    // Drag the panel by its header grip to a new spot over the map.
    const grip = panel.locator('.toggle-drag-grip');
    const g = (await grip.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + 260, g.y + 120, { steps: 12 });
    await page.mouse.up();

    // Reorder: drag the first row's grip below the third row.
    const rows = panel.locator('.layer-toggle');
    const firstGrip = rows.nth(0).locator('.layer-reorder-grip');
    const fg = (await firstGrip.boundingBox())!;
    const third = (await rows.nth(2).boundingBox())!;
    await page.mouse.move(fg.x + fg.width / 2, fg.y + fg.height / 2);
    await page.mouse.down();
    await page.mouse.move(fg.x, third.y + third.height, { steps: 14 });
    await page.mouse.up();

    await page.waitForTimeout(400);
    await shot(page, 'layers-panel-dragged-reordered.png');
  });
});
