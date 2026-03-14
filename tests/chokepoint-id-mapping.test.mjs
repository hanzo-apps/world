import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_CHOKEPOINTS,
  relayNameToId,
  portwatchNameToId,
  corridorRiskNameToId,
} from '../server/worldmonitor/supply-chain/v1/_chokepoint-ids.ts';

describe('CANONICAL_CHOKEPOINTS registry', () => {
  it('contains exactly 10 canonical chokepoints', () => {
    assert.equal(CANONICAL_CHOKEPOINTS.length, 10);
  });

  it('has no duplicate IDs', () => {
    const ids = CANONICAL_CHOKEPOINTS.map(c => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('has no duplicate relay names', () => {
    const names = CANONICAL_CHOKEPOINTS.map(c => c.relayName);
    assert.equal(new Set(names).size, names.length);
  });

  it('has no duplicate portwatch names', () => {
    const names = CANONICAL_CHOKEPOINTS.map(c => c.portwatchName);
    assert.equal(new Set(names).size, names.length);
  });
});

describe('relayNameToId', () => {
  it('maps "Strait of Hormuz" to hormuz_strait', () => {
    assert.equal(relayNameToId('Strait of Hormuz'), 'hormuz_strait');
  });

  it('returns undefined for unknown relay name', () => {
    assert.equal(relayNameToId('unknown'), undefined);
  });
});

describe('portwatchNameToId', () => {
  it('maps "Suez Canal" to suez', () => {
    assert.equal(portwatchNameToId('Suez Canal'), 'suez');
  });

  it('is case-insensitive', () => {
    assert.equal(portwatchNameToId('suez canal'), 'suez');
    assert.equal(portwatchNameToId('SUEZ CANAL'), 'suez');
    assert.equal(portwatchNameToId('SuEz CaNaL'), 'suez');
  });
});

describe('corridorRiskNameToId', () => {
  it('maps "Hormuz" to hormuz_strait', () => {
    assert.equal(corridorRiskNameToId('Hormuz'), 'hormuz_strait');
  });

  it('returns undefined for unmapped names', () => {
    assert.equal(corridorRiskNameToId('Nonexistent'), undefined);
  });

  it('Gibraltar has null corridorRiskName', () => {
    const gib = CANONICAL_CHOKEPOINTS.find(c => c.id === 'gibraltar');
    assert.equal(gib.corridorRiskName, null);
  });

  it('Bosphorus has null corridorRiskName', () => {
    const bos = CANONICAL_CHOKEPOINTS.find(c => c.id === 'bosphorus');
    assert.equal(bos.corridorRiskName, null);
  });

  it('Dardanelles has null corridorRiskName', () => {
    const dar = CANONICAL_CHOKEPOINTS.find(c => c.id === 'dardanelles');
    assert.equal(dar.corridorRiskName, null);
  });
});
