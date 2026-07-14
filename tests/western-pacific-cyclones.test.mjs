import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));

// cyclones.ts is pure (only `import type`, elided on transpile) so it evaluates
// standalone — same loader the gulf-fdi dataset test uses for a TS module.
function loadCyclones() {
  const sourcePath = resolve(__dirname, '../src/services/cyclones.ts');
  const source = readFileSync(sourcePath, 'utf-8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: sourcePath,
  });
  const module = { exports: {} };
  const evaluator = new Function('exports', 'module', transpiled.outputText);
  evaluator(module.exports, module);
  return module.exports;
}

const {
  canonicalizeWesternPacificCyclones,
  parseHkoWarningSummary,
  buildWesternPacificCyclones,
  isWesternPacificCyclone,
  toWesternPacificObservation,
} = loadCyclones();

const fixture = (name) => JSON.parse(readFileSync(resolve(__dirname, 'fixtures/natural', name), 'utf8'));
const NOW = Date.parse('2026-07-13T12:00:00.000Z');

function storm(overrides = {}) {
  return {
    agency: 'JMA',
    agencyId: '2605',
    basin: 'WP',
    season: 2026,
    aliases: ['Nari'],
    stormName: 'Nari',
    lat: 19.8,
    lon: 128.6,
    observedAt: NOW,
    windKt: 55,
    windAveragingPeriodMinutes: 10,
    sourceUrl: 'https://www.jma.go.jp/',
    sourceName: 'JMA',
    ...overrides,
  };
}

function gdacsRow(overrides = {}) {
  return {
    id: 'gdacs-TC-1000',
    eventType: 'TC',
    name: 'Typhoon Nari',
    description: 'Tropical Cyclone',
    alertLevel: 'Orange',
    country: 'Japan',
    coordinates: [128.6, 19.8],
    fromDate: new Date(NOW),
    severity: 'Maximum sustained wind of 120 km/h',
    url: 'https://www.gdacs.org/report',
    ...overrides,
  };
}

describe('western Pacific cyclone identity', () => {
  it('uses the JMA agency identifier as canonical identity while preserving separate wind periods', () => {
    const [cyclone] = canonicalizeWesternPacificCyclones([
      storm(),
      storm({
        agency: 'JTWC', agencyId: '05W', aliases: ['Nari'], lat: 19.9, lon: 128.5,
        windKt: 65, windAveragingPeriodMinutes: 1, sourceName: 'JTWC',
        sourceUrl: 'https://www.metoc.navy.mil/',
      }),
    ]);

    assert.equal(cyclone.canonicalId, 'wp:2026:jma:2605');
    assert.equal(cyclone.matchingConfidence, 'alias-bounded');
    assert.equal(cyclone.windKt, 55);
    assert.equal(cyclone.windAveragingPeriodMinutes, 10);
    assert.deepEqual(
      cyclone.agencyObservations.map(({ agency, agencyId, windKt, windAveragingPeriodMinutes }) => ({ agency, agencyId, windKt, windAveragingPeriodMinutes })),
      [
        { agency: 'JMA', agencyId: '2605', windKt: 55, windAveragingPeriodMinutes: 10 },
        { agency: 'JTWC', agencyId: '05W', windKt: 65, windAveragingPeriodMinutes: 1 },
      ],
    );
  });

  it('uses the first reported wind and its matching averaging period when the primary agency omits wind', () => {
    const [cyclone] = canonicalizeWesternPacificCyclones([
      storm({ windKt: null, windAveragingPeriodMinutes: 10 }),
      storm({
        agency: 'JTWC', agencyId: '05W', aliases: ['Nari'], lat: 19.9, lon: 128.5,
        windKt: 65, windAveragingPeriodMinutes: 1, sourceName: 'JTWC',
        sourceUrl: 'https://www.metoc.navy.mil/',
      }),
    ]);

    assert.equal(cyclone.sourceName, 'JMA', 'the higher-priority agency remains the canonical source');
    assert.equal(cyclone.windKt, 65);
    assert.equal(cyclone.windAveragingPeriodMinutes, 1);
  });

  it('rejects missing or non-numeric coordinates instead of coercing them to zero', () => {
    assert.deepEqual(canonicalizeWesternPacificCyclones([storm({ lat: null })]), []);
    assert.deepEqual(canonicalizeWesternPacificCyclones([storm({ lon: false })]), []);
    assert.deepEqual(canonicalizeWesternPacificCyclones([storm({ lat: '' })]), []);
    assert.deepEqual(canonicalizeWesternPacificCyclones([storm({ lon: '  ' })]), []);
  });

  it('keeps wind null without crashing when no observation reports wind', () => {
    const [cyclone] = canonicalizeWesternPacificCyclones([
      storm({ windKt: null, windAveragingPeriodMinutes: null }),
    ]);

    assert.equal(cyclone.windKt, null);
    assert.equal(cyclone.windAveragingPeriodMinutes, undefined);
  });

  it('never takes wind from a cancelled observation while an active one exists', () => {
    const [cyclone] = canonicalizeWesternPacificCyclones([
      storm({ windKt: null, windAveragingPeriodMinutes: null }),
      storm({
        agency: 'JTWC', agencyId: '05W', aliases: ['Nari'], lat: 19.9, lon: 128.5,
        windKt: 65, windAveragingPeriodMinutes: 1, sourceName: 'JTWC',
        sourceUrl: 'https://www.metoc.navy.mil/', status: 'cancelled',
      }),
    ]);

    assert.equal(cyclone.sourceName, 'JMA');
    assert.equal(cyclone.windKt, null, 'a cancelled advisory must not supply the canonical wind');
    assert.equal(cyclone.windAveragingPeriodMinutes, undefined);
  });

  it('does not merge concurrent nearby storms with distinct aliases', () => {
    const cyclones = canonicalizeWesternPacificCyclones([
      storm({ agencyId: '2605', aliases: ['Nari'], stormName: 'Nari' }),
      storm({ agency: 'JTWC', agencyId: '06W', aliases: ['Wutip'], stormName: 'Wutip', lat: 20.1, lon: 128.9 }),
    ]);

    assert.equal(cyclones.length, 2);
  });

  it('merges unnamed source records only by bounded proximity', () => {
    const unnamed = (agencyId, lat, lon) => ({
      agency: 'GDACS', agencyId, basin: 'WP', aliases: [], stormName: '',
      lat, lon, observedAt: NOW, windKt: null, sourceName: 'GDACS',
    });

    // ~55 km apart, same time → one system via the proximity fallback.
    const near = canonicalizeWesternPacificCyclones([
      unnamed('gdacs-TC-1', 20.0, 130.0),
      unnamed('gdacs-TC-2', 20.5, 130.0),
    ]);
    assert.equal(near.length, 1);
    assert.equal(near[0].matchingConfidence, 'proximity-bounded');
    assert.equal(near[0].agencyObservations.length, 2);

    // ~555 km apart → distinct systems (proximity cap is 90 km).
    const far = canonicalizeWesternPacificCyclones([
      unnamed('gdacs-TC-1', 20.0, 130.0),
      unnamed('gdacs-TC-3', 25.0, 130.0),
    ]);
    assert.equal(far.length, 2);
  });

  it('replaces a cancelled observation only for its own agency identifier', () => {
    const [cyclone] = canonicalizeWesternPacificCyclones([
      storm({ agency: 'HKO', agencyId: 'WTCSGNL', aliases: ['Nari'], sourceName: 'HKO', status: 'active' }),
      storm({ agency: 'HKO', agencyId: 'WTCSGNL', aliases: ['Nari'], sourceName: 'HKO', status: 'cancelled', observedAt: NOW + 60_000 }),
      storm({ agency: 'JTWC', agencyId: '05W', aliases: ['Nari'], sourceName: 'JTWC', windAveragingPeriodMinutes: 1 }),
    ]);

    assert.equal(cyclone.agencyObservations.length, 2);
    assert.equal(cyclone.agencyObservations.find((item) => item.agency === 'HKO')?.status, 'cancelled');
    assert.equal(cyclone.agencyObservations.find((item) => item.agency === 'JTWC')?.status, 'active');
  });
});

describe('GDACS Western-Pacific box adapter', () => {
  it('accepts tropical cyclones inside 0–50°N / 100–180°E and rejects everything else', () => {
    assert.equal(isWesternPacificCyclone(gdacsRow()), true);
    assert.equal(isWesternPacificCyclone(gdacsRow({ coordinates: [100, 0] })), true, 'inclusive SW corner');
    assert.equal(isWesternPacificCyclone(gdacsRow({ coordinates: [180, 50] })), true, 'inclusive NE corner');
    assert.equal(isWesternPacificCyclone(gdacsRow({ coordinates: [99.9, 20] })), false, 'west of basin');
    assert.equal(isWesternPacificCyclone(gdacsRow({ coordinates: [180.1, 20] })), false, 'east of dateline');
    assert.equal(isWesternPacificCyclone(gdacsRow({ coordinates: [130, 50.1] })), false, 'north of basin');
    assert.equal(isWesternPacificCyclone(gdacsRow({ coordinates: [130, -0.1] })), false, 'south of equator');
    assert.equal(isWesternPacificCyclone(gdacsRow({ eventType: 'EQ' })), false, 'not a cyclone');
    assert.equal(isWesternPacificCyclone(gdacsRow({ coordinates: [-60, 20] })), false, 'Atlantic basin');
  });

  it('mines wind (km/h → kt), classification and storm name from a GDACS row', () => {
    const observation = toWesternPacificObservation(gdacsRow());
    assert.equal(observation.agency, 'GDACS');
    assert.equal(observation.basin, 'WP');
    assert.equal(observation.stormName, 'Nari');
    assert.equal(observation.windKt, 65); // 120 km/h → 64.79 → 65 kt
    assert.equal(observation.classification, 'Category 1');
    assert.equal(observation.observedAt, NOW);

    const [cyclone] = canonicalizeWesternPacificCyclones([observation]);
    assert.equal(cyclone.canonicalId, 'wp:2026:gdacs:gdacs-tc-1000');
    assert.equal(cyclone.windKt, 65);
    assert.equal(cyclone.agencyObservations.length, 1);
  });

  it('projects a GDACS storm into a severeStorms NaturalEvent carrying the attribution fields', () => {
    const [event] = buildWesternPacificCyclones({ storms: [toWesternPacificObservation(gdacsRow())] });
    assert.equal(event.category, 'severeStorms');
    assert.equal(event.magnitude, 65);
    assert.equal(event.magnitudeUnit, 'kt');
    assert.equal(event.canonicalId, 'wp:2026:gdacs:gdacs-tc-1000');
    assert.equal(event.matchingConfidence, 'single-source');
    assert.equal(event.agencyObservations.length, 1);
    assert.ok(event.date instanceof Date);
  });
});

describe('HKO warning adapter', () => {
  it('keeps a local tropical-cyclone warning useful even when no named storm is active', () => {
    const warnings = parseHkoWarningSummary(fixture('hko-warnsum-tropical-cyclone.json'), { now: NOW });
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].stormName, undefined);
    assert.equal(warnings[0].agency, 'HKO');
    assert.equal(warnings[0].status, 'active');

    const events = buildWesternPacificCyclones({ storms: [], hkoWarnings: warnings, now: NOW });
    assert.equal(events.length, 1);
    assert.equal(events[0].sourceName, 'HKO');
    assert.equal(events[0].category, 'severeStorms');
    assert.equal(events[0].agencyObservations.length, 1);
    assert.match(events[0].title, /Hong Kong Tropical Cyclone Warning Signal/);
  });

  it('publishes an HKO cancellation as a closed warning', () => {
    const warnings = parseHkoWarningSummary({
      WTCSGNL: {
        ...fixture('hko-warnsum-tropical-cyclone.json').WTCSGNL,
        actionCode: 'CANCEL',
        updateTime: '2026-07-13T11:00:00+08:00',
      },
    }, { now: NOW });

    assert.equal(warnings[0].agencyId, 'WTCSGNL');
    assert.equal(warnings[0].status, 'cancelled');
    assert.equal(
      buildWesternPacificCyclones({ storms: [], hkoWarnings: warnings, now: NOW })[0].closed,
      true,
    );
  });

  it('returns no warnings for an empty payload', () => {
    assert.deepEqual(parseHkoWarningSummary({}, { now: NOW }), []);
    assert.deepEqual(parseHkoWarningSummary(null, { now: NOW }), []);
  });
});
