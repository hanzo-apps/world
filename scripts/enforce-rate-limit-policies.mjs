#!/usr/bin/env node
/**
 * Validates every key in ENDPOINT_RATE_POLICIES (server/_shared/rate-limit.ts)
 * is a real gateway route by checking the OpenAPI specs generated from protos.
 * Catches rename-drift that causes policies to become dead code (the
 * sanctions-entity-search review finding — the policy key was
 * `/api/sanctions/v1/lookup-entity` but the proto RPC generates path
 * `/api/sanctions/v1/lookup-sanction-entity`, so the 30/min limit never
 * applied and the endpoint fell through to the 600/min global limiter).
 *
 * Runs in the same pre-push + CI context as lint:api-contract.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OPENAPI_DIR = join(ROOT, 'docs/api');
const RATE_LIMIT_SRC = join(ROOT, 'server/_shared/rate-limit.ts');

function extractPolicyKeys() {
  const src = readFileSync(RATE_LIMIT_SRC, 'utf8');
  const match = src.match(/ENDPOINT_RATE_POLICIES:\s*Record<[^>]+>\s*=\s*\{([\s\S]*?)\n\};/);
  if (!match) {
    throw new Error('Could not locate ENDPOINT_RATE_POLICIES in rate-limit.ts');
  }
  const block = match[1];
  const keys = [];
  // Match quoted keys: '/api/...' or "/api/..."
  const keyRe = /['"](\/api\/[^'"]+)['"]\s*:/g;
  let m;
  while ((m = keyRe.exec(block)) !== null) {
    keys.push(m[1]);
  }
  return keys;
}

function extractRoutesFromOpenApi() {
  const routes = new Set();
  const files = readdirSync(OPENAPI_DIR).filter((f) => f.endsWith('.openapi.yaml'));
  for (const file of files) {
    const yaml = readFileSync(join(OPENAPI_DIR, file), 'utf8');
    // OpenAPI paths section — each route is a top-level key under `paths:`
    // indented 4 spaces. Strip trailing colon.
    const pathRe = /^\s{4}(\/api\/[^\s:]+):/gm;
    let m;
    while ((m = pathRe.exec(yaml)) !== null) {
      routes.add(m[1]);
    }
  }
  return routes;
}

function main() {
  const keys = extractPolicyKeys();
  const routes = extractRoutesFromOpenApi();
  const missing = keys.filter((k) => !routes.has(k));

  if (missing.length > 0) {
    console.error('✗ ENDPOINT_RATE_POLICIES key(s) do not match any generated gateway route:\n');
    for (const key of missing) {
      console.error(`  - ${key}`);
    }
    console.error('\nEach key must be a proto-generated RPC path. Check that:');
    console.error('  1. The key matches the path in docs/api/<Service>.openapi.yaml exactly.');
    console.error('  2. If you renamed the RPC in proto, update the policy key to match.');
    console.error('  3. If the policy is for a non-proto legacy route, remove it once that route is migrated.\n');
    console.error('Similar issues in history: review of #3242 flagged the sanctions-entity-search');
    console.error('policy under `/api/sanctions/v1/lookup-entity` when the generated path was');
    console.error('`/api/sanctions/v1/lookup-sanction-entity` — the policy was dead code.');
    process.exit(1);
  }

  console.log(`✓ rate-limit policies clean: ${keys.length} policies validated against ${routes.size} gateway routes.`);
}

main();
