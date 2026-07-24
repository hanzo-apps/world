import type { MapContainer } from '@/components/MapContainer';

/**
 * globe-instance — the ONE React-side seam to reach the imperative globe.
 *
 * GlobeIsland owns the `MapContainer` instance behind its DOM host and keeps it
 * private (a WebGL engine is not React state). Sibling React surfaces that must
 * drive the globe imperatively (country drill-down, camera fly-to, …) can't read
 * that private ref — so GlobeIsland *publishes* the live instance here, exactly
 * the way `MapContainer` publishes its narrow capabilities to the right-click
 * menu via `registerMapContextPort`. This is that same registry pattern, one
 * level up: a module singleton that holds the current `MapContainer | null` and
 * notifies subscribers when it changes.
 *
 * One and only one way: React code never new's a MapContainer and never reaches
 * into GlobeIsland's ref — it reads `getGlobeInstance()` or `subscribeGlobeInstance`.
 *
 * Lifecycle: GlobeIsland calls `publishGlobeInstance(map)` once the engine is up
 * and `publishGlobeInstance(null)` on teardown. Under React StrictMode's dev
 * double-mount, GlobeIsland's own `cancelled` guard means exactly one instance is
 * ever created, so subscribers see a single non-null publish.
 */

let current: MapContainer | null = null;
const subscribers = new Set<(map: MapContainer | null) => void>();

/** Install (or clear) the live globe instance. The one wiring point GlobeIsland uses. */
export function publishGlobeInstance(map: MapContainer | null): void {
  current = map;
  for (const fn of subscribers) fn(current);
}

/** The live globe instance, or null before the engine mounts / after teardown. */
export function getGlobeInstance(): MapContainer | null {
  return current;
}

/**
 * Subscribe to globe availability. Fires immediately with the current value, then
 * on every change. Returns an unsubscribe.
 */
export function subscribeGlobeInstance(fn: (map: MapContainer | null) => void): () => void {
  subscribers.add(fn);
  fn(current);
  return () => {
    subscribers.delete(fn);
  };
}
