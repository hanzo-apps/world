import { useEffect, useRef } from 'react';
import { variantConfig } from '@/config';
import type { MapContainer as MapContainerType } from '@/components/MapContainer';

/**
 * GlobeIsland — the deck.gl globe as a React island.
 *
 * This does NOT rewrite the globe. It owns a plain DOM host <div> and, on mount,
 * instantiates the EXISTING `MapContainer` (which delegates to DeckGLMap on
 * desktop / the D3-SVG fallback on mobile, exactly as the vanilla app does). React
 * owns the lifecycle (mount / variant-driven layer swap / unmount); the globe
 * engine stays imperative and untouched behind that host node. With no mapbox
 * token locally it renders the dotted-fallback "cybermap" globe — expected.
 *
 * The heavy map chunk (~2.7 MB mapbox-gl + deck.gl) is dynamically imported, so
 * it never blocks first paint — mirroring the vanilla `App.mountMap()`.
 */
export function GlobeIsland({ variant }: { variant: string }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapContainerType | null>(null);

  // Mount the globe once. React StrictMode double-invokes effects in dev; the
  // `cancelled` guard + teardown makes the instantiate/destroy pair idempotent so
  // we never leak two WebGL contexts.
  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    void (async () => {
      const { MapContainer } = await import('@/components/MapContainer');
      if (cancelled || mapRef.current) return;
      mapRef.current = new MapContainer(host, {
        zoom: 1.35,
        pan: { x: 0, y: 0 },
        view: 'global',
        // Reuse the canonical per-variant layer defaults — one source of truth in
        // the config layer, no hand-rolled layer object here.
        layers: variantConfig(variant).DEFAULT_MAP_LAYERS,
        timeRange: '7d',
        mode: '3d',
      });
    })();

    return () => {
      cancelled = true;
      mapRef.current?.destroy();
      mapRef.current = null;
    };
    // Mount-only: the variant-driven layer swap is handled by the effect below so
    // switching a tab never tears down / cold-starts the WebGL context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Variant change → swap layers in place (keep-alive), the same decomplected
  // `setLayers` path the vanilla in-place switch uses.
  useEffect(() => {
    mapRef.current?.setLayers(variantConfig(variant).DEFAULT_MAP_LAYERS);
  }, [variant]);

  return (
    <div
      ref={hostRef}
      id="mapContainer"
      aria-label="Interactive world globe"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  );
}
