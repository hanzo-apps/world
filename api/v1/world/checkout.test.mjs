import { strict as assert } from 'node:assert';
import test from 'node:test';

import handler from './checkout.js';

// Explicitly delete every env var that affects checkout.js, then let each
// test set what it needs. Don't snapshot+restore process.env wholesale —
// that re-applies shell-inherited STRIPE_SECRET_KEY between tests and
// blows the "missing key" / "unconfigured plan" assertions.
const MANAGED_ENV = [
  'STRIPE_SECRET_KEY',
  'STRIPE_API_VERSION',
  'STRIPE_PRICE_WORLD_PRO',
  'STRIPE_PRICE_WORLD_PRO_ANNUAL',
  'STRIPE_PRICE_WORLD_TEAM',
  'STRIPE_PRICE_WORLD_TEAM_ANNUAL',
  'IAM_ENDPOINT',
  'IAM_URL',
  'APP_BASE_URL',
];

function resetEnv() {
  for (const k of MANAGED_ENV) delete process.env[k];
}

function makeRequest({
  method = 'POST',
  body,
  headers = {},
  origin = 'https://world.hanzo.ai',
} = {}) {
  const h = new Headers(headers);
  if (origin) h.set('origin', origin);
  if (body !== undefined && !h.has('content-type')) h.set('content-type', 'application/json');
  return new Request('https://world.hanzo.ai/v1/world/checkout', {
    method,
    headers: h,
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

test('OPTIONS preflight returns CORS-only response', async () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  const res = await handler(makeRequest({ method: 'OPTIONS' }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Access-Control-Allow-Methods') || '', /POST/);
});

test('non-POST returns 405', async () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  const res = await handler(makeRequest({ method: 'GET' }));
  assert.equal(res.status, 405);
});

test('missing STRIPE_SECRET_KEY returns 503', async () => {
  resetEnv();
  delete process.env.STRIPE_SECRET_KEY;
  const res = await handler(makeRequest({ body: { planId: 'world-pro' } }));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'service_unavailable');
});

test('invalid JSON body returns 400', async () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  const res = await handler(makeRequest({ body: '{not json' }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'invalid_json');
});

test('missing planId returns 400', async () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  const res = await handler(makeRequest({ body: {} }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'planId_required');
});

test('unknown planId returns 400', async () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  const res = await handler(makeRequest({ body: { planId: 'nonexistent-plan' } }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'unknown_plan');
});

test('plan without configured price returns 503 plan_unconfigured', async () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  // Make sure no STRIPE_PRICE_WORLD_PRO is set
  delete process.env.STRIPE_PRICE_WORLD_PRO;
  const res = await handler(makeRequest({ body: { planId: 'world-pro' } }));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'plan_unconfigured');
});

test('missing auth headers returns 401', async () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.STRIPE_PRICE_WORLD_PRO = 'price_test_x';
  const res = await handler(makeRequest({ body: { planId: 'world-pro' } }));
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'unauthenticated');
});

test('accepts planKey as alias for planId', async () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  delete process.env.STRIPE_PRICE_WORLD_PRO;
  // Sending planKey only (typed-client shape) — must hit the same plan lookup as planId.
  const res = await handler(makeRequest({ body: { planKey: 'world-pro' } }));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'plan_unconfigured', 'planKey should be resolved like planId');
});

test('CORS allows world.hanzo.ai as the canonical origin', async () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  const res = await handler(makeRequest({ method: 'OPTIONS', origin: 'https://world.hanzo.ai' }));
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://world.hanzo.ai');
});

test('CORS falls back to world.hanzo.ai for disallowed origin', async () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  const res = await handler(makeRequest({ method: 'OPTIONS', origin: 'https://evil.example' }));
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://world.hanzo.ai');
});
