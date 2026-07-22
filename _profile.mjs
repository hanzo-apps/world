// Low-end laptop profiler for world.hanzo.ai
// Usage: node profile.mjs <url> <label> [cpuThrottle=6]
// Measures under Chrome DevTools CPU throttling via CDP.
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://world.hanzo.ai/';
const label = process.argv[3] || 'run';
const throttle = Number(process.argv[4] || 6);

const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// Track network transfer sizes by type
const transfer = { js: 0, css: 0, other: 0, jsCount: 0, eagerJs: 0 };
const seen = new Set();
page.on('response', async (resp) => {
  try {
    const u = resp.url();
    if (seen.has(u)) return; seen.add(u);
    const hdr = resp.headers();
    const enc = hdr['content-encoding'] || '';
    const len = Number(hdr['content-length'] || 0);
    const ct = hdr['content-type'] || '';
    let bytes = len;
    if (!bytes) { try { bytes = (await resp.body()).length; } catch { bytes = 0; } }
    if (/javascript/.test(ct) || u.endsWith('.js')) { transfer.js += bytes; transfer.jsCount++; }
    else if (/css/.test(ct) || u.endsWith('.css')) { transfer.css += bytes; }
    else transfer.other += bytes;
  } catch {}
});

const client = await context.newCDPSession(page);
await client.send('Emulation.setCPUThrottlingRate', { rate: throttle });

const t0 = Date.now();
await page.goto(url, { waitUntil: 'commit', timeout: 120000 });

// Inject longtask + paint observers ASAP
await page.addInitScript(() => {
  window.__lt = { total: 0, count: 0, max: 0 };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__lt.total += e.duration; window.__lt.count++; window.__lt.max = Math.max(window.__lt.max, e.duration); } }).observe({ entryTypes: ['longtask'] });
  } catch {}
});

// Wait for the app shell / map container to exist and network to settle a bit
let ttiApprox = null;
try {
  await page.waitForSelector('#app .header, #app .main-content, #mapContainer', { timeout: 60000 });
  ttiApprox = Date.now() - t0;
} catch {}

// Let it run to steady state under throttle
await page.waitForTimeout(9000);

// Paint + nav timings
const timings = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const fcp = (performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint') || {}).startTime || null;
  return {
    domContentLoaded: nav.domContentLoadedEventEnd || null,
    loadEvent: nav.loadEventEnd || null,
    fcp,
    longtasks: window.__lt || null,
    scripts: performance.getEntriesByType('resource').filter(r => r.initiatorType === 'script' || /\.js(\?|$)/.test(r.name)).length,
  };
});

// FPS sample over 4s (rAF frame deltas) — the idle/spin steady-state frame cost
const fps = await page.evaluate(() => new Promise((resolve) => {
  const deltas = []; let last = performance.now(); let frames = 0; const start = last;
  function tick(now) { deltas.push(now - last); last = now; frames++; if (now - start < 4000) requestAnimationFrame(tick); else {
    deltas.sort((a,b)=>a-b);
    const avg = deltas.reduce((a,b)=>a+b,0)/deltas.length;
    const p95 = deltas[Math.floor(deltas.length*0.95)] || avg;
    resolve({ fps: +(1000/avg).toFixed(1), avgFrameMs: +avg.toFixed(1), p95FrameMs: +p95.toFixed(1), frames });
  } }
  requestAnimationFrame(tick);
}));

const out = {
  label, url, cpuThrottle: throttle,
  transferKB: { js: Math.round(transfer.js/1024), css: Math.round(transfer.css/1024), jsFiles: transfer.jsCount },
  fcpMs: timings.fcp ? Math.round(timings.fcp) : null,
  domContentLoadedMs: timings.domContentLoaded ? Math.round(timings.domContentLoaded) : null,
  loadEventMs: timings.loadEvent ? Math.round(timings.loadEvent) : null,
  shellVisibleMs: ttiApprox,
  longTasks: timings.longtasks,
  steadyState: fps,
};
console.log('PROFILE_JSON ' + JSON.stringify(out));
console.log(JSON.stringify(out, null, 2));
await browser.close();
