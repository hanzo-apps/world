import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

// Guards the end-to-end wiring of the Western-Pacific cyclone attribution stream:
// Go proxy → cyclones.ts canonicalization → eonet.ts merge → NaturalEvent type →
// MapPopup detail surface. Pure logic is covered in western-pacific-cyclones.test.mjs.
describe('natural cyclone attribution contract', () => {
  it('extends the NaturalEvent type with per-agency attribution fields', () => {
    const types = read('src/types/index.ts');
    assert.match(types, /export interface CycloneAgencyObservation/);
    assert.match(types, /windAveragingPeriodMinutes\?: number/);
    assert.match(types, /canonicalId\?: string/);
    assert.match(types, /matchingConfidence\?: string/);
    assert.match(types, /canonicalAliases\?: string\[\]/);
    assert.match(types, /agencyObservations\?: CycloneAgencyObservation\[\]/);
  });

  it('folds GDACS WP rows and HKO warnings into the natural-event stream', () => {
    const adapter = read('src/services/eonet.ts');
    assert.match(adapter, /from '\.\/cyclones'/);
    assert.match(adapter, /isWesternPacificCyclone/);
    assert.match(adapter, /buildWesternPacificCyclones/);
    assert.match(adapter, /\/v1\/world\/hko-warnings/);
    assert.match(adapter, /parseHkoWarningSummary/);
  });

  it('proxies the HKO warning summary through a Go /v1/world route', () => {
    const handler = read('internal/world/handlers_natural.go');
    assert.match(handler, /func \(s \*Server\) handleHKOWarnings/);
    assert.match(handler, /data\.weather\.gov\.hk/);
    assert.match(handler, /s\.passthrough\(/);
    assert.match(read('internal/world/routes.go'), /\/v1\/world\/hko-warnings", s\.handleHKOWarnings/);
  });

  it('renders source attribution, confidence, and wind averaging periods in the detail surface', () => {
    const popup = read('src/components/MapPopup.ts');
    assert.match(popup, /Canonical match/);
    assert.match(popup, /Wind average/);
    assert.match(popup, /Agency observations/);
    assert.match(popup, /event\.agencyObservations\?\.length \? this\.renderTcDetails/);
    assert.match(popup, /minute mean/);
  });
});
