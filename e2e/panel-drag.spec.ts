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
      .locator('[data-panel="delta"] .panel-corner-resize-handle.se')
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
      .locator('[data-panel="alpha"] .panel-corner-resize-handle.se')
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

  test('free mode: all four corners resize and pin the opposite corner', async ({ page }) => {
    await lh(page);
    await page.evaluate(() => window.__layoutHarness!.setMode('free'));
    await page.waitForTimeout(40);
    expect(await page.evaluate(() => window.__layoutHarness!.mode())).toBe('free');

    const D = 60; // drag each corner inward (toward the panel centre) — always in-bounds
    // corner → inward drag sign + which opposite corner must stay pinned.
    const cases = [
      { panel: 'alpha', corner: 'nw', sx: 1, sy: 1, fix: 'br' },
      { panel: 'bravo', corner: 'ne', sx: -1, sy: 1, fix: 'bl' },
      { panel: 'charlie', corner: 'sw', sx: 1, sy: -1, fix: 'tr' },
      { panel: 'delta', corner: 'se', sx: -1, sy: -1, fix: 'tl' },
    ] as const;

    for (const c of cases) {
      const b = await rect(page, c.panel);
      const h = (await page
        .locator(`[data-panel="${c.panel}"] .panel-corner-resize-handle.${c.corner}`)
        .boundingBox())!;
      const px = h.x + h.width / 2;
      const py = h.y + h.height / 2;
      await page.mouse.move(px, py);
      await page.mouse.down();
      await page.mouse.move(px + c.sx * D, py + c.sy * D, { steps: 12 });
      await page.mouse.up();
      const a = await rect(page, c.panel);

      // The grabbed corner pulled inward on both axes → the panel shrank.
      expect(a.width).toBeLessThan(b.width - 20);
      expect(a.height).toBeLessThan(b.height - 20);

      // The OPPOSITE corner never moved — proof the resize is anchor-aware
      // (nw/ne/sw shift left/top to hold the far edge, not just grow w/h).
      const bR = b.left + b.width;
      const bB = b.top + b.height;
      const aR = a.left + a.width;
      const aB = a.top + a.height;
      if (c.fix === 'br') {
        expect(Math.abs(aR - bR)).toBeLessThan(4);
        expect(Math.abs(aB - bB)).toBeLessThan(4);
      } else if (c.fix === 'bl') {
        expect(Math.abs(a.left - b.left)).toBeLessThan(4);
        expect(Math.abs(aB - bB)).toBeLessThan(4);
      } else if (c.fix === 'tr') {
        expect(Math.abs(aR - bR)).toBeLessThan(4);
        expect(Math.abs(a.top - b.top)).toBeLessThan(4);
      } else {
        expect(Math.abs(a.left - b.left)).toBeLessThan(4);
        expect(Math.abs(a.top - b.top)).toBeLessThan(4);
      }
    }
    await page.screenshot({ path: `${SHOTS}/free-all-corners.png` });
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

// ── Live News (video) resizes freely; the video fills the panel at any size ──
// Real app: proves the CTO requirement — Live News can grow to 2-3 cols / full
// width (grid) or any pixel size (free), and the 16:9 video (`.live-news-player`,
// width-driven) scales to fill, never capped small. NOTE: in the offline e2e
// runtime the YouTube embed eventually errors and replaces `.live-news-player`
// with a message, so the video-fill invariant is asserted where it's reliably
// present (default size) and the resize is proved via the player's containing
// block (`.panel-content`, always present), which the player fills 1:1.

const rectW = (page: Page, sel: string): Promise<number> =>
  page.evaluate((s) => {
    const el = document.querySelector<HTMLElement>(s);
    return el ? Math.round(el.getBoundingClientRect().width) : -1;
  }, sel);

const LN = '[data-panel="live-news"]';
const LN_CONTENT = `${LN} .panel-content`;
const LN_PLAYER = `${LN} .live-news-player`;

test.describe('live news video resize (real app)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('grid: default → 3 cols → full-width; the video fills at every width', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(LN, { timeout: 45000 });
    await page.waitForTimeout(500);

    const grid = (await page.locator('#panelsGrid').boundingBox())!;
    const ln = page.locator(LN);
    const colHandle = ln.locator('.panel-col-resize-handle');

    // The fill setup is active: the panel-content is a full-bleed flex column
    // (padding 0) so the width-driven 16:9 `.live-news-player` fills it edge-to-edge
    // at any width. (Keyed on #live-news — dead until the id fix in LiveNewsPanel.)
    const setup = await page.evaluate((sel) => {
      const c = document.querySelector<HTMLElement>(sel);
      if (!c) return null;
      const s = getComputedStyle(c);
      return { display: s.display, dir: s.flexDirection, padLeft: s.paddingLeft };
    }, LN_CONTENT);
    expect(setup).toEqual({ display: 'flex', dir: 'column', padLeft: '0px' });

    // The video, while present (offline embed errors after a beat), fills the
    // container 1:1 at the default width.
    const startContent = await rectW(page, LN_CONTENT);
    const startVideo = await rectW(page, LN_PLAYER);
    if (startVideo > 0) expect(Math.abs(startVideo - startContent)).toBeLessThan(4);

    // Drag the right edge out to ~3 columns.
    const h1 = (await colHandle.boundingBox())!;
    await page.mouse.move(h1.x + h1.width / 2, h1.y + h1.height / 2);
    await page.mouse.down();
    await page.mouse.move(grid.x + grid.width * 0.42, h1.y + h1.height / 2, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const midContent = await rectW(page, LN_CONTENT);
    expect(midContent).toBeGreaterThan(startContent + 40); // genuinely wider

    // Drag the right edge all the way out → full width. No column cap.
    const h2 = (await colHandle.boundingBox())!;
    await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
    await page.mouse.down();
    await page.mouse.move(grid.x + grid.width + 200, h2.y + h2.height / 2, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const fullContent = await rectW(page, LN_CONTENT);
    expect(fullContent).toBeGreaterThan(midContent);
    expect(fullContent).toBeGreaterThan(grid.width * 0.9); // ~full grid width
    // The video (when present) fills the now-full-width container 1:1.
    const fullVideo = await rectW(page, LN_PLAYER);
    if (fullVideo > 0) expect(Math.abs(fullVideo - fullContent)).toBeLessThan(6);

    // Make it tall too (drag the bottom edge down) so the 16:9 video is large.
    const bottom = ln.locator('.panel-resize-handle');
    const b = (await bottom.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + 520, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    await page.evaluate(() => document.querySelector('[data-panel="live-news"]')?.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'e2e/layout-shots/live-news-fullwidth.png' });

    // Container is now full-width AND tall → a large video area.
    expect(await rectW(page, LN_CONTENT)).toBeGreaterThan(900);
  });

  test('free: Live News resizes to an arbitrary pixel size; video fills', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(LN_PLAYER, { timeout: 45000 });
    await page.waitForTimeout(600);
    const startContent = await rectW(page, LN_CONTENT);
    await page.evaluate(() => (window as unknown as { worldGrid?: { setLayoutMode(m: string): void } }).worldGrid?.setLayoutMode('free'));
    await page.waitForTimeout(200);

    const corner = page.locator(`${LN} .panel-corner-resize-handle.se`);
    const c = (await corner.boundingBox())!;
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await page.mouse.down();
    await page.mouse.move(c.x + 240, c.y + 260, { steps: 18 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const content = await rectW(page, LN_CONTENT);
    expect(content).toBeGreaterThan(startContent + 120); // grew to an arbitrary pixel width
    const video = await rectW(page, LN_PLAYER);
    if (video > 0) expect(Math.abs(video - content)).toBeLessThan(6); // fills at that size
    await page.evaluate(() => (window as unknown as { worldGrid?: { setLayoutMode(m: string): void } }).worldGrid?.setLayoutMode('grid'));
  });
});
