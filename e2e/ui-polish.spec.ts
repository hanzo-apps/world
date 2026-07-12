import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * UI/UX polish e2e — the four changes shipped together, each asserted against
 * the real DOM/CSS rather than by eye:
 *
 *   1. Right-click a headline → "Summarize with AI" is the FIRST item, and it
 *      opens the analyst dock with the story as the question.
 *   2. The app header carries no underline (border-bottom).
 *   3. The map's drag pill is gone, but the grip strip is still the drag target.
 *   4. "Try Hanzo" is an acquisition CTA: visible signed-out, hidden once
 *      identity resolves as signed-in.
 */

const SCREENS = 'e2e/screens';

async function stubWorldApi(page: Page): Promise<void> {
  await page.route('**/v1/world/**', (route: Route) => {
    const url = route.request().url();
    if (url.includes('/v1/world/analyst')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'Stubbed summary.',
          actions: [],
          model: 'zen5',
          tokens: 0,
          traces: [],
        }),
      });
    }
    if (url.includes('/v1/world/models')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ models: [{ id: 'zen5', name: 'Zen 5' }], default: 'zen5' }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

/** Sign in the way the analyst e2e does — the analyst only accepts a question
 *  when identity is present, so the summarize path needs a signed-in session. */
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

/** Inject a news-shaped item — the exact data-ctx-* convention NewsPanel emits. */
async function addNewsItem(page: Page): Promise<void> {
  await page.evaluate(() => {
    const grid = document.querySelector('#panelsGrid')!;
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.dataset.panel = 'e2e-ui-panel';
    panel.innerHTML =
      '<div class="panel-content"><div class="item" id="e2e-news-item" ' +
      'data-ctx-url="https://example.com/story" data-ctx-headline="Nvidia unveils new GPU" ' +
      'style="padding:12px;min-height:24px;">Nvidia unveils new GPU</div></div>';
    grid.appendChild(panel);
  });
}

test.describe('ui polish', () => {
  test('headline right-click leads with "Summarize with AI" and opens the analyst', async ({ page }) => {
    await stubWorldApi(page);
    await signIn(page); // the analyst answers only for a signed-in identity
    await appReady(page);
    await addNewsItem(page);

    await page.locator('#e2e-news-item').scrollIntoViewIfNeeded();
    await page.locator('#e2e-news-item').click({ button: 'right' });
    await expect(page.locator('#panelContextMenu')).toBeVisible();

    const labels = await page
      .locator('#panelContextMenu .panel-context-menu-item')
      .allTextContents();
    const trimmed = labels.map((l) => l.trim());
    // It is the action you want on a headline → it leads the menu.
    expect(trimmed[0]).toBe('Summarize with AI');
    // The copy/open actions are still there, below it.
    expect(trimmed).toEqual(expect.arrayContaining(['Open link', 'Copy link', 'Copy headline']));

    await page.screenshot({ path: `${SCREENS}/ctxmenu-summarize.png` });

    // Clicking it routes into the ONE analyst dock, pre-asked with the story.
    await page
      .locator('#panelContextMenu .panel-context-menu-item', { hasText: 'Summarize with AI' })
      .click();
    // .hzc is a 0x0 wrapper (children are position:fixed) — the panel is the
    // surface that actually opens.
    await expect(page.locator('.hzc-panel')).toBeVisible();
    // The question carries the headline (the analyst is asked, not just opened).
    await expect(page.locator('.hzc-row.user').first()).toContainText('Nvidia unveils new GPU');
  });

  test('app header has no underline', async ({ page }) => {
    await stubWorldApi(page);
    await appReady(page);
    const borderBottom = await page
      .locator('.header')
      .first()
      .evaluate((el) => getComputedStyle(el).borderBottomWidth);
    expect(borderBottom).toBe('0px');
  });

  test('map shows no drag pill, but the grip strip still drags', async ({ page }) => {
    await stubWorldApi(page);
    await appReady(page);
    const grip = page.locator('.map-panel .panel-header.map-drag-grip');
    await expect(grip).toHaveCount(1);

    // No visible indicator …
    const pill = await grip.evaluate((el) => getComputedStyle(el, '::after').content);
    expect(pill === 'none' || pill === 'normal').toBe(true);

    // … but it is still the drag target (that is what makes hiding it safe).
    await expect(grip).toHaveCSS('cursor', 'grab');
  });

  test('"Try Hanzo" hides once signed in', async ({ page }) => {
    await stubWorldApi(page);
    await appReady(page);

    const cta = page.locator('.try-hanzo');
    await expect(cta).toBeVisible(); // signed-out: the CTA is the point

    // The one signal identity resolution emits.
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('hanzo:auth', { detail: { authed: true } }));
    });
    await expect(cta).toBeHidden();

    // And it comes back on sign-out.
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('hanzo:auth', { detail: { authed: false } }));
    });
    await expect(cta).toBeVisible();
  });
});
