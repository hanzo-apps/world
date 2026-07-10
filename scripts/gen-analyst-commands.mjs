#!/usr/bin/env node
/**
 * Generate the backend's static command manifest mirror from the ONE source of
 * truth — src/services/app-commands.ts (the client registry).
 *
 * The client always sends its live manifest with each analyst request, so the
 * runtime contract has zero drift by construction. This generated file is the
 * FALLBACK the Go backend embeds for callers that don't send one, and the Go
 * test (TestAnalystCommandManifest) verifies it stays structurally sound and
 * complete. Re-run after changing the registry:
 *
 *   node scripts/gen-analyst-commands.mjs
 *
 * app-commands.ts imports nothing, so esbuild transpiles it standalone.
 */
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = new URL('../src/services/app-commands.ts', import.meta.url).pathname;
const OUT = new URL('../internal/world/data/analyst_commands.json', import.meta.url).pathname;

const res = await build({
  entryPoints: [SRC],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
});

const tmp = join(mkdtempSync(join(tmpdir(), 'zap-cmds-')), 'app-commands.mjs');
writeFileSync(tmp, res.outputFiles[0].text);

const mod = await import(pathToFileURL(tmp).href);
const manifest = mod.commandManifest();

writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${manifest.length} commands → ${OUT}`);
