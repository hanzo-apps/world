import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Analyst control-surface e2e: signed-out shows the sign-in prompt (unchanged
 * behaviour), and a signed-in command round-trip — a stubbed AI response carrying
 * a {type:"move_panel"} command flows transport → dispatcher → AppHost and the
 * panel visibly moves, with a ✓ action-log entry in the chat. No real inference:
 * the analyst + models routes are stubbed so the test is deterministic offline.
 */

const SCREENS = 'e2e/screens';

// Stub every /v1/world/* call the chat touches so the flow is deterministic.
async function stubWorldApi(page: Page): Promise<void> {
  await page.route('**/v1/world/**', (route: Route) => {
    const url = route.request().url();
    if (url.includes('/v1/world/analyst')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'Done — moved Markets to the top and switched to the light theme.',
          actions: [
            { type: 'move_panel', key: 'markets', position: 'top' },
            { type: 'set_theme', theme: 'light' },
          ],
          model: 'zen5',
          tokens: 42,
        }),
      });
    }
    if (url.includes('/v1/world/models')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'zen5', label: 'Zen 5', group: 'Zen' },
            { id: 'zen5-flash', label: 'Zen 5 Flash', group: 'Zen' },
            { id: 'zen3-omni', label: 'Zen 3 Omni', group: 'Zen' },
          ],
          default: 'zen5',
        }),
      });
    }
    // Everything else (context feeds) → empty, so collectContext degrades quietly.
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function signIn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('hanzo_iam_access_token', 'e2e-fake-token');
    localStorage.setItem('hanzo_iam_expires_at', String(Date.now() + 3_600_000));
    localStorage.setItem('hanzo_iam_owner', 'e2e-org');
  });
}

async function appReady(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('#panelsGrid', { timeout: 60_000 });
  await page.waitForSelector('[data-panel="markets"]', { timeout: 60_000 });
}

async function panelOrder(page: Page): Promise<string[]> {
  return page.$$eval('#panelsGrid [data-panel]', (els) =>
    els.map((e) => (e as HTMLElement).dataset.panel || ''),
  );
}

test.describe('AI analyst control surface', () => {
  test('signed-out: opening the dock shows the sign-in prompt (unchanged)', async ({ page }) => {
    await stubWorldApi(page);
    await appReady(page);

    await page.click('.hzc-fab');
    const prompt = page.locator('.hzc-body .hzc-signedout');
    await expect(prompt).toBeVisible();
    await expect(prompt.locator('.hzc-signin')).toHaveText(/sign in/i);
    // No chat composer for anonymous users.
    await expect(page.locator('.hzc-body .hzc-input')).toHaveCount(0);

    await page.screenshot({ path: `${SCREENS}/analyst-signedout.png` });
  });

  test('signed-in: a stubbed command round-trip moves a panel + logs the action', async ({ page }) => {
    await signIn(page);
    await stubWorldApi(page);
    await appReady(page);

    const before = await panelOrder(page);
    const beforeIdx = before.indexOf('markets');
    expect(beforeIdx).toBeGreaterThan(1); // markets starts well down the grid
    await page.screenshot({ path: `${SCREENS}/round-trip-before.png` });

    // Open the analyst dock and confirm the model picker populated.
    await page.click('.hzc-fab');
    const composer = page.locator('.hzc-body .hzc-input');
    await expect(composer).toBeVisible();
    // The model picker is now a pill that opens a popover listbox (portaled to
    // <body>), not a native <select>. Its label reflects the default (zen5)…
    const modelBtn = page.locator('.hzc-body .hzc-model');
    await expect(modelBtn).toBeVisible();
    await expect(modelBtn.locator('.hzc-model-name')).toHaveText('Zen 5');
    // …and opening it lists all three stubbed models.
    await modelBtn.click();
    await expect(page.locator('.hzc-model-menu .hzc-model-opt')).toHaveCount(3);
    await modelBtn.click(); // close the popover

    // Send a command-style message; the stub returns the move+theme commands.
    await composer.fill('Move markets to the top and go light');
    await page.click('.hzc-body .hzc-send');

    // The prose reply renders…
    await expect(page.locator('.hzc-body .hzc-row.assistant')).toContainText('moved Markets');
    // …and the per-command action log shows a ✓ for the executed move.
    const log = page.locator('.hzc-body .hzc-actionlog .hzc-action.ok');
    await expect(log.first()).toBeVisible();
    await expect(log.first()).toContainText(/moved markets/i);

    // The panel VISIBLY moved: markets is now near the top of the grid.
    await expect
      .poll(async () => (await panelOrder(page)).indexOf('markets'), { timeout: 15_000 })
      .toBeLessThan(beforeIdx);
    // And the theme command took effect (whole-app visible change).
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.screenshot({ path: `${SCREENS}/round-trip-after.png` });
  });
});
