// Dotted-land basemap — the abstract "cybermap" globe surface. Land is shown
// ONLY as a lattice of evenly-spaced glowing dots (one per land sample), over a
// black ocean sphere — no country fills, no borders, no imagery. It reads the
// SAME /data/countries.geojson the monochrome basemap + country hit-testing use,
// samples a uniform lat/long lattice, keeps only the points that fall on land,
// and caches the resulting dot cloud once per session (the lattice never changes,
// so a per-frame rebuild would be pure waste).
//
// Decomplected from both renderers: GlobeNative (3D sphere) and DeckGLMap (2D
// mercator) both call `getLandDots()` and drop the result into a ScatterplotLayer
// with their own coordinate system. The lattice is a pure value — generate once,
// consume anywhere.

import { getCountriesGeoJson } from '@/services/country-geometry';
import { getCountryAtCoordinates } from '@/services/country-geometry';

export interface LandDot {
  lon: number;
  lat: number;
}

// Shared cybermap dot palette — the VALUE lives in one home; both renderers
// (GlobeNative 3D sphere, DeckGLMap 2D mercator) import it so the lattice reads
// as one surface. A bright cool ice-blue (near/front) over a dim back-lattice
// gives the translucent "glowing dot-globe" look: front dots vivid, the far side
// showing faintly through the sphere. RGBA 0-255.
export const LAND_DOT_NEAR: [number, number, number, number] = [182, 218, 252, 248];
export const LAND_DOT_FAR: [number, number, number, number] = [104, 140, 192, 74];

// Lattice step in degrees. 1.6° balances density vs. cost: ~25k candidate points
// over the sphere, of which roughly 7–9k land — enough to read every continent
// at globe zoom without dissolving into a solid mass or a sparse scatter.
const LATTICE_STEP_DEG = 1.6;

// One cached lattice per (step) — in practice exactly one. Regenerated only if
// the geometry fetch lands after the first request.
let cached: LandDot[] | null = null;
let pending: Promise<LandDot[]> | null = null;

/**
 * Resolve the land-dot lattice, generating + caching it on first call. Safe to
 * call before geometry has loaded — resolves to an empty array (rendered as no
 * dots) and re-generates once the geojson is available. Never rejects.
 */
export async function getLandDots(step = LATTICE_STEP_DEG): Promise<LandDot[]> {
  if (cached) return cached;
  if (pending) return pending;
  pending = (async (): Promise<LandDot[]> => {
    const geo = await getCountriesGeoJson();
    if (!geo) {
      pending = null;
      return (cached = []);
    }
    const dots: LandDot[] = [];
    // Sample a uniform lat/long grid. Near the poles the meridians converge, so a
    // fixed step over-represents the poles; we thin by latitude band to keep the
    // dot density visually even across the sphere (closer to a geodesic lattice
    // than a raw lng/lat grid, without the cost of computing one).
    for (let lat = -88; lat <= 88; lat += step) {
      const cosLat = Math.cos((lat * Math.PI) / 180);
      // Longitude step widens toward the poles so dot spacing stays ~constant in
      // km. floor(1) keeps at least every-`step`-degrees sampling at the equator.
      const lngStep = step / Math.max(0.18, cosLat);
      for (let lon = -180; lon < 180; lon += lngStep) {
        if (getCountryAtCoordinates(lat, lon)) dots.push({ lon, lat });
      }
    }
    cached = dots;
    pending = null;
    return dots;
  })();
  return pending;
}

/** Drop the cache — only useful if the underlying geojson source changes. */
export function invalidateLandDots(): void {
  cached = null;
  pending = null;
}
