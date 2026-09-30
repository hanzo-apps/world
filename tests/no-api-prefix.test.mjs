import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// World's API is /v1/world/*. /api/ is the retired prefix: the server answers it
// 404 (cmd/world TestAPIPathsNeverServeTheShell) and nothing here may call it.
// A path is first-party when it has no host of its own — a relative path, or a
// template on a base the app owns. Third-party URLs (https://host/api/…) keep
// whatever path their owner chose, so any URL with a host is stripped first.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = ['src', 'api', 'src-tauri/sidecar', 'internal', 'cmd', 'vite.config.ts', 'index.html', 'settings.html'];
const EXT = /\.(ts|tsx|js|mjs|cjs|go|html)$/;
// Files whose job is to assert the retired prefix is refused.
const REFUSES = new Set(['cmd/world/static_test.go', 'src-tauri/sidecar/local-api-server.test.mjs']);

function* walk(p) {
  const st = statSync(p);
  if (st.isFile()) {
    if (EXT.test(p)) yield p;
    return;
  }
  for (const name of readdirSync(p)) {
    if (name === 'node_modules' || name === 'dist') continue;
    yield* walk(join(p, name));
  }
}

const HOSTED = /(https?:|wss?:)?\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:\d+)?\/[^\s'"`)]*/g;
const FIRST_PARTY_API = /['"`(]\/api(\/|['"`)?])/;

describe('no first-party /api/ path', () => {
  it('is served or called anywhere in the app, handlers or sidecar', () => {
    const hits = [];
    for (const top of SCAN) {
      for (const file of walk(join(root, top))) {
        const rel = relative(root, file);
        if (REFUSES.has(rel)) continue;
        readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
          if (FIRST_PARTY_API.test(line.replace(HOSTED, ''))) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    assert.deepEqual(hits, []);
  });
});
