import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vercelConfig = JSON.parse(readFileSync(resolve(__dirname, '../vercel.json'), 'utf-8'));
const viteConfigSource = readFileSync(resolve(__dirname, '../vite.config.ts'), 'utf-8');

const getCacheHeaderValue = (sourcePath) => {
  const rule = vercelConfig.headers.find((entry) => entry.source === sourcePath);
  const header = rule?.headers?.find((item) => item.key.toLowerCase() === 'cache-control');
  return header?.value ?? null;
};

describe('deploy/cache configuration guardrails', () => {
  it('disables caching for HTML entry routes on Vercel', () => {
    assert.equal(getCacheHeaderValue('/'), 'no-cache, no-store, must-revalidate');
    assert.equal(getCacheHeaderValue('/index.html'), 'no-cache, no-store, must-revalidate');
  });

  it('keeps immutable caching for hashed static assets', () => {
    assert.equal(
      getCacheHeaderValue('/assets/(.*)'),
      'public, max-age=31536000, immutable'
    );
  });

  it('precaches offline.html but never the app shells', () => {
    // html stays in the glob so offline.html is precached; the shells are
    // excluded via globIgnores so a stale index/settings can never be served.
    assert.match(
      viteConfigSource,
      /globPatterns:\s*\['\*\*\/\*\.\{js,css,html,ico,png,svg,woff2\}'\]/
    );
    assert.match(viteConfigSource, /globIgnores:\s*\[[^\]]*'index\.html'/);
    assert.match(viteConfigSource, /globIgnores:\s*\[[^\]]*'settings\.html'/);
  });

  it('uses network-first runtime caching for navigation requests', () => {
    assert.match(viteConfigSource, /request\.mode === 'navigate'/);
    assert.match(viteConfigSource, /handler:\s*'NetworkFirst'/);
    assert.match(viteConfigSource, /cacheName:\s*'html-navigation'/);
  });

  it('contains variant-specific metadata fields used by html replacement and manifest', () => {
    assert.match(viteConfigSource, /shortName:\s*'/);
    assert.match(viteConfigSource, /subject:\s*'/);
    assert.match(viteConfigSource, /classification:\s*'/);
    assert.match(viteConfigSource, /categories:\s*\[/);
    assert.match(
      viteConfigSource,
      /\.replace\(\/<meta name="subject" content="\.\*\?" \\\/>\/,\s*`<meta name="subject"/
    );
    assert.match(
      viteConfigSource,
      /\.replace\(\/<meta name="classification" content="\.\*\?" \\\/>\/,\s*`<meta name="classification"/
    );
  });
});
