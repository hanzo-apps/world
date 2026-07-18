import type { Page, Locator } from '@playwright/test';

// The map's projection / basemap / time-range controls collapsed into dropdowns:
// each option button (.proj-btn / .style-btn / .time-btn) lives in a popover that a
// trigger opens. Tests that click an option must open its dropdown first. This helper
// opens the button's parent .deckgl-dd (if it's in one) and clicks the option — a
// no-op open when the button isn't inside a dropdown, so it's safe everywhere.
export async function clickMapControl(page: Page, buttonSelector: string): Promise<void> {
  const btn: Locator = page.locator(buttonSelector).first();
  const dd = btn.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " deckgl-dd ")][1]');
  if (await dd.count()) {
    const trigger = dd.locator('.dd-trigger').first();
    if (!(await dd.evaluate((el) => el.classList.contains('open')).catch(() => false))) {
      await trigger.click();
    }
  }
  await btn.click();
}
