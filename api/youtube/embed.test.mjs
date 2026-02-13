import { strict as assert } from 'node:assert';
import test from 'node:test';
import handler from './embed.js';

function makeRequest(query = '') {
  return new Request(`https://worldmonitor.app/api/youtube/embed${query}`);
}

test('rejects missing or invalid video ids', async () => {
  const missing = await handler(makeRequest());
  assert.equal(missing.status, 400);

  const invalid = await handler(makeRequest('?videoId=bad')); 
  assert.equal(invalid.status, 400);
});

test('returns embeddable html for valid video id', async () => {
  const response = await handler(makeRequest('?videoId=iEpJwprxDdk&autoplay=0&mute=1'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type')?.includes('text/html'), true);

  const html = await response.text();
  assert.equal(html.includes('https://www.youtube.com/embed/iEpJwprxDdk'), true);
  assert.equal(html.includes('autoplay=0'), true);
  assert.equal(html.includes('mute=1'), true);
  assert.equal(html.includes('origin=https%3A%2F%2Fworldmonitor.app'), true);
  assert.equal(html.includes('widget_referrer=https%3A%2F%2Fworldmonitor.app'), true);
});
