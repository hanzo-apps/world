import { expect, test } from '@playwright/test';

type HarnessWindow = Window & {
  __mapHarness?: {
    ready: boolean;
    setProtestsScenario: (scenario: 'alpha' | 'beta') => void;
    getClusterStateSize: () => number;
  };
};

test.describe('DeckGL map harness', () => {
  test('boots without deck assertions or page crashes', async ({ page }) => {
    const pageErrors: string[] = [];
    const deckAssertionErrors: string[] = [];
    const ignorablePageErrorPatterns = [
      /could not compile fragment shader/i,
      /shader/i,
    ];

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (text.includes('deck.gl: assertion failed')) {
        deckAssertionErrors.push(text);
      }
    });

    await page.goto('/map-harness.html');
    await expect(page.locator('.deckgl-map-wrapper')).toBeVisible();
    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const w = window as HarnessWindow;
          return Boolean(w.__mapHarness?.ready);
        });
      })
      .toBe(true);

    await page.waitForTimeout(1000);

    const unexpectedPageErrors = pageErrors.filter(
      (error) =>
        !ignorablePageErrorPatterns.some((pattern) => pattern.test(error))
    );

    expect(unexpectedPageErrors).toEqual([]);
    expect(deckAssertionErrors).toEqual([]);
  });

  test('updates protest marker click payload after data refresh', async ({ page }) => {
    await page.goto('/map-harness.html');
    await expect(page.locator('.deckgl-map-wrapper')).toBeVisible();
    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const w = window as HarnessWindow;
          return Boolean(w.__mapHarness?.ready);
        });
      })
      .toBe(true);

    const protestMarker = page.locator('.protest-marker').first();
    await expect(protestMarker).toBeVisible({ timeout: 15000 });

    await protestMarker.click({ force: true });
    await expect(page.locator('.map-popup .popup-description')).toContainText(
      'Scenario Alpha Protest'
    );
    await page.locator('.map-popup .popup-close').click();

    await page.evaluate(() => {
      const w = window as HarnessWindow;
      w.__mapHarness?.setProtestsScenario('beta');
    });

    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const w = window as HarnessWindow;
          return w.__mapHarness?.getClusterStateSize() ?? -1;
        });
      })
      .toBeGreaterThan(0);

    await expect(protestMarker).toBeVisible({ timeout: 15000 });
    await protestMarker.click({ force: true });
    await expect(page.locator('.map-popup .popup-description')).toContainText(
      'Scenario Beta Protest'
    );
  });
});
