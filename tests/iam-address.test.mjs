import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(__dirname, p), 'utf-8');

const iam = read('../src/services/iam.ts');
const orgScope = read('../src/services/org-scope.ts');

// IAM serves its organizations and projects as typed collections. The verb-noun
// spellings that used to reach them answer 410 with the successor in the body,
// and both call sites degrade to a usable default on failure — so a call left at
// a retired address renders a plausible screen (one org, one project) and nothing
// says otherwise. The address is therefore worth pinning on its own.
const RETIRED = [
  '/v1/iam/get-organizations',
  '/v1/iam/get-organization-projects',
  '/v1/iam/get-organization',
  '/v1/iam/get-user',
  '/v1/iam/update-user',
];

describe('IAM addresses', () => {
  it('reads organizations from the collection', () => {
    assert.match(iam, /organizations: '\/v1\/iam\/organizations'/);
  });

  it('reads projects from the collection', () => {
    assert.match(orgScope, /const IAM_PROJECTS = '\/v1\/iam\/projects'/);
  });

  it('names no retired address', () => {
    for (const path of RETIRED) {
      for (const [name, src] of [['iam.ts', iam], ['org-scope.ts', orgScope]]) {
        assert.equal(src.includes(path), false, `${name} still names ${path}`);
      }
    }
  });

  // A typed collection answers the list under its own key. Reading `data` or a
  // bare array yields [] against the real response, which both callers turn into
  // the default — the same shape a genuine empty answer has.
  it('reads each list from the key its collection answers under', () => {
    assert.match(iam, /Array\.isArray\(data\?\.organizations\)/);
    assert.match(orgScope, /Array\.isArray\(data\?\.projects\)/);
  });

  // Both lists fall back to a default the user cannot tell from a real answer,
  // so the fallback has to say it happened.
  it('reports a degraded list rather than only degrading', () => {
    assert.match(iam, /console\.warn\([^)]*showing the home org only/);
    assert.match(orgScope, /console\.warn\([^)]*showing Default only/);
  });
});
