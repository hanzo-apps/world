import { expect, test } from '@playwright/test';

// News Wall — every live news channel at once, hover a tile for AUDIO FOCUS.
//
// The panel is opt-in (enabled:false, like Live Webcams), and its grid + N YouTube
// players build LAZILY the first time it scrolls into view. This test un-hides it and
// brings it into view to trigger that build, then asserts: one tile per channel, and
// that hovering a tile gives EXACTLY that tile audio focus (the .stations-audio-on ring
// + 🔊 badge) while muting the rest — the "hover to enable voice" behavior.
//
// The YouTube players themselves need real GL + network; the audio-FOCUS logic (class +
// badge toggling, and the mute()/unMute() calls it drives) runs regardless of whether a
// player finished loading, so the focus behavior is what we assert. We block the YT
// embed so the test stays hermetic and fast — the tiles + their hover handlers are built
// before (and independent of) the players.

test.describe('News Wall — all stations at once, hover for audio', () => {
  test('one tile per channel; hover moves single audio focus; leaving mutes all', async ({ page }) => {
    await page.route('**/*youtube*/**', (r) => r.abort());

    await page.goto('/?variant=full');

    // Un-hide the opt-in panel and scroll it into view → its IntersectionObserver fires
    // → the wall builds. (Toggling it on via the Panels menu is a separate trivial path.)
    await page.locator('.panel[data-panel="stations-wall"]').waitFor({ state: 'attached', timeout: 30000 });
    await page.evaluate(() => {
      const el = document.querySelector('.panel[data-panel="stations-wall"]') as HTMLElement | null;
      el?.classList.remove('hidden');
      el?.scrollIntoView();
    });

    // One tile per channel (full variant ships ≥ 4 news channels).
    const tiles = page.locator('.stations-tile');
    await expect(tiles.first()).toBeVisible({ timeout: 30000 });
    expect(await tiles.count()).toBeGreaterThanOrEqual(4);

    // Nothing focused initially → no tile is unmuted.
    await expect(page.locator('.stations-tile.stations-audio-on')).toHaveCount(0);

    // Hover the first tile → exactly it gets audio focus + the 🔊 badge.
    await tiles.nth(0).hover();
    await expect(page.locator('.stations-tile.stations-audio-on')).toHaveCount(1);
    await expect(tiles.nth(0)).toHaveClass(/stations-audio-on/);
    await expect(tiles.nth(0).locator('.stations-audio')).toHaveText('🔊');

    // Hover a second tile → focus MOVES (still exactly one); the first is muted again.
    await tiles.nth(1).hover();
    await expect(page.locator('.stations-tile.stations-audio-on')).toHaveCount(1);
    await expect(tiles.nth(1)).toHaveClass(/stations-audio-on/);
    await expect(tiles.nth(0)).not.toHaveClass(/stations-audio-on/);

    // Leaving the wall entirely mutes everything.
    await page.locator('.stations-grid').dispatchEvent('mouseleave');
    await expect(page.locator('.stations-tile.stations-audio-on')).toHaveCount(0);
  });
});
