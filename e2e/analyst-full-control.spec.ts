import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Full app control from the chat widget.
 *
 * The analyst's control surface is the app-command registry (services/app-commands.ts)
 * driven through the AppHost port. Until now it could show/hide/move panels and
 * touch the map, but it could NOT change the layout mode, add a topic to monitor,
 * or drive the Watch Queue — so "reconfigure the layout and all widgets from the
 * chat" was not actually true.
 *
 * Each test stubs the analyst to return ONE command and asserts the app really
 * changed — the command is dispatched through the same path a real model reply
 * takes. No mocked host, no unit-test stand-in for the DOM.
 */

const SCREENS = 'e2e/screens';

async function stubAnalyst(page: Page, actions: unknown[], reply = 'Done.'): Promise<void> {
  await page.route('**/v1/world/**', (route: Route) => {
    const url = route.request().url();
    if (url.includes('/v1/world/analyst')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reply, actions, model: 'zen5', tokens: 0, traces: [] }),
      });
    }
    if (url.includes('/v1/world/models')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ models: [{ id: 'zen5', name: 'Zen 5' }], default: 'zen5' }),
      });
    }
    // Monitors: signed-in sync endpoints. Keep them empty + accepting.
    if (url.includes('/v1/world/monitors')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ monitors: [], matches: [], ok: true }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
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
  await page.waitForSelector('.panel', { timeout: 30_000 });
}

/** Send any message; the stub decides which command comes back. */
// Two AnalystChats exist (the in-grid panel and the dock) — they share the SAME
// code path, so drive the dock's explicitly rather than matching both.
async function ask(page: Page, text: string): Promise<void> {
  await page.click('.hzc-fab');
  const dock = page.locator('.hzc-panel');
  await expect(dock).toBeVisible();
  const composer = dock.locator('.hzc-input');
  await expect(composer).toBeVisible();
  await composer.fill(text);
  await dock.locator('.hzc-send').click();
}

test.describe('analyst full app control', () => {
  test('set_layout_mode switches the app into immersive', async ({ page }) => {
    await signIn(page);
    await stubAnalyst(page, [{ type: 'set_layout_mode', mode: 'immersive' }]);
    await appReady(page);

    await expect(page.locator('body')).not.toHaveClass(/immersive/);
    await ask(page, 'go immersive');

    // The app really entered immersive (body class is the mode's source of truth)…
    await expect(page.locator('body')).toHaveClass(/immersive/);
    // …and the dock select agrees — the AI and the UI cannot disagree about mode.
    await expect(page.locator('#dockModeSelect')).toHaveValue('immersive');
    await page.screenshot({ path: `${SCREENS}/analyst-immersive.png` });
  });

  test('add_monitor makes the analyst able to watch a new topic', async ({ page }) => {
    await signIn(page);
    await stubAnalyst(page, [{ type: 'add_monitor', keywords: 'nvidia, gpu' }]);
    await appReady(page);

    await ask(page, 'watch for nvidia and gpu');

    // The monitor list really gained the topic (the panel renders it).
    const monitors = page.locator('#monitorsList');
    await expect(monitors).toContainText(/nvidia/i);
    await expect(monitors).toContainText(/gpu/i);

    // And it persisted through the ONE monitor path (localStorage mirror).
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('worldmonitor-monitors') || '[]'),
    );
    expect(JSON.stringify(stored)).toContain('nvidia');
  });

  test('queue_next advances the Watch Queue', async ({ page }) => {
    await signIn(page);
    await stubAnalyst(page, [{ type: 'queue_next' }]);
    await appReady(page);

    // Seed two items straight into the queue's own store, then let the analyst advance it.
    await page.evaluate(() => {
      localStorage.setItem(
        'hanzo-world-watch-queue',
        JSON.stringify({
          items: [
            { id: 'a', kind: 'video', title: 'First talk', source: 'X', ref: 'aaaaaaaaaaa', addedAt: 1, status: 'queued' },
            { id: 'b', kind: 'video', title: 'Second talk', source: 'X', ref: 'bbbbbbbbbbb', addedAt: 2, status: 'queued' },
          ],
          currentId: 'a',
        }),
      );
    });
    await page.reload();
    await page.waitForSelector('.panel', { timeout: 30_000 });

    await ask(page, 'next video');

    // 'a' is finished and 'b' is now current — tracked consumption, driven by the AI.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const q = JSON.parse(localStorage.getItem('hanzo-world-watch-queue') || '{}');
          return q.currentId;
        }),
      )
      .toBe('b');
    const statusOfA = await page.evaluate(() => {
      const q = JSON.parse(localStorage.getItem('hanzo-world-watch-queue') || '{}');
      return (q.items || []).find((i: { id: string }) => i.id === 'a')?.status;
    });
    expect(statusOfA).toBe('watched');
  });
});
