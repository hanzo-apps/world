// Device capability tiering for graceful degradation on low-end hardware.
//
// One place decides "how much machine is this?" so every heavy subsystem (the
// deck.gl/maplibre globe, the real-time refresh cadence, the finance terminal's
// live widgets, the globe flow arcs) can dial itself down without each
// re-implementing the same navigator sniffing. Values, not places: callers ask
// for the knob they need (maxDevicePixelRatio, refreshScale, maxFlowArcs), not
// for raw core counts.
//
// Signals: navigator.hardwareConcurrency (logical cores) + navigator.deviceMemory
// (GB, Chromium-only) + prefers-reduced-motion. Override with ?tier=low|mid|high
// or localStorage('worldmonitor-device-tier') for testing on capable hardware.

export type DeviceTier = 'low' | 'mid' | 'high';

const OVERRIDE_KEY = 'worldmonitor-device-tier';

function readOverride(): DeviceTier | null {
  if (typeof window === 'undefined') return null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('tier');
    if (fromUrl === 'low' || fromUrl === 'mid' || fromUrl === 'high') {
      localStorage.setItem(OVERRIDE_KEY, fromUrl);
      return fromUrl;
    }
    const stored = localStorage.getItem(OVERRIDE_KEY);
    if (stored === 'low' || stored === 'mid' || stored === 'high') return stored;
  } catch {
    /* private mode / disabled storage — fall through to detection */
  }
  return null;
}

function detectTier(): DeviceTier {
  const override = readOverride();
  if (override) return override;

  if (typeof navigator === 'undefined') return 'high';

  const cores = navigator.hardwareConcurrency || 0;
  // deviceMemory is Chromium-only and coarsely bucketed (0.25..8). Absent ⇒ 0.
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0;

  // Low: a genuinely underpowered laptop/Chromebook — few cores or little RAM.
  // The globe (two GL contexts + WebGL fill) is the tax we most need to cut here.
  if ((cores && cores <= 4) || (mem && mem <= 4)) return 'low';

  // High: clearly capable (8+ cores AND 8GB+, or 8+ cores with memory unknown).
  if (cores >= 8 && (mem === 0 || mem >= 8)) return 'high';

  return 'mid';
}

let cached: DeviceTier | null = null;

/** The device tier, detected once and memoized for the session. */
export function getDeviceTier(): DeviceTier {
  if (cached === null) cached = detectTier();
  return cached;
}

export function isLowEndDevice(): boolean {
  return getDeviceTier() === 'low';
}

/** Honour the OS "reduce motion" setting — treated like low-end for animations. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * DPR cap for the deck.gl overlay canvas. Retina globes are fill-rate bound;
 * dropping a low-end machine to DPR 1 is the single biggest per-frame GPU win.
 */
export function maxDevicePixelRatio(): number {
  switch (getDeviceTier()) {
    case 'low': return 1;
    case 'mid': return 1.5;
    default: return 2;
  }
}

/**
 * Multiplier applied to every real-time refresh interval. Low-end machines poll
 * less often so background fetch+parse+re-render churn doesn't starve the UI.
 */
export function refreshIntervalScale(): number {
  switch (getDeviceTier()) {
    case 'low': return 2;
    case 'mid': return 1.35;
    default: return 1;
  }
}

/**
 * Max number of animated flow arcs to draw on the globe. Each arc is an
 * instanced draw with a per-frame uniform; density is the knob that keeps the
 * flow overlay from tanking FPS on weak GPUs.
 */
export function maxFlowArcs(): number {
  switch (getDeviceTier()) {
    case 'low': return 40;
    case 'mid': return 120;
    default: return 300;
  }
}

/**
 * Max number of concurrently-live embedded widgets (e.g. TradingView iframes in
 * the finance terminal). Each live widget is its own socket + rAF loop; capping
 * concurrency keeps the terminal responsive on low-end machines.
 */
export function maxLiveWidgets(): number {
  switch (getDeviceTier()) {
    case 'low': return 3;
    case 'mid': return 8;
    default: return 24;
  }
}
