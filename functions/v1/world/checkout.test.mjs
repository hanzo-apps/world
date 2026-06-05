import { strict as assert } from 'node:assert';
import test from 'node:test';

import * as handler from './checkout.js';

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
  const res = await handler.onRequestOptions({ request: makeRequest({ method: 'OPTIONS' }) });
  assert.equal(res.status, 200);
  const m = res.headers.get('Access-Control-Allow-Methods') || '';
  assert.match(m, /POST/);
});

test('invalid JSON body returns 400', async () => {
  const res = await handler.onRequestPost({ request: makeRequest({ body: '{not json' }) });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'invalid_json');
});

test('missing planId returns 400', async () => {
  const res = await handler.onRequestPost({ request: makeRequest({ body: {} }) });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'planId_required');
});

test('unknown planId returns 400', async () => {
  const res = await handler.onRequestPost({ request: makeRequest({ body: { planId: 'nonexistent-plan' } }) });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'unknown_plan');
});

test('accepts planKey alias for planId', async () => {
  const res = await handler.onRequestPost({ request: makeRequest({ body: { planKey: 'nonexistent-plan' } }) });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'unknown_plan');
});

test('missing auth returns 401', async () => {
  // Valid planId but no Authorization / Cookie → iamUserinfo returns null → 401
  const res = await handler.onRequestPost({ request: makeRequest({ body: { planId: 'world-pro' } }) });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'unauthenticated');
});

test('CORS allows world.hanzo.ai origin', async () => {
  const res = await handler.onRequestOptions({ request: makeRequest({ method: 'OPTIONS' }) });
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://world.hanzo.ai');
});

test('CORS falls back to world.hanzo.ai for disallowed origin', async () => {
  const res = await handler.onRequestOptions({ request: makeRequest({ method: 'OPTIONS', origin: 'https://evil.example' }) });
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://world.hanzo.ai');
});

test('CORS allows world-*.pages.dev preview origins', async () => {
  const res = await handler.onRequestOptions({
    request: makeRequest({ method: 'OPTIONS', origin: 'https://world-abc123.pages.dev' }),
  });
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://world-abc123.pages.dev');
});
