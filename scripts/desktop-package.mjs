#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);

const getArg = (name) => {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return args[index + 1];
};

const hasFlag = (name) => args.includes(`--${name}`);

const os = getArg('os');
const variant = getArg('variant') ?? 'full';
const sign = hasFlag('sign');

const validOs = new Set(['macos', 'windows']);
const validVariants = new Set(['full', 'tech']);

if (!validOs.has(os)) {
  console.error('Usage: npm run desktop:package -- --os <macos|windows> --variant <full|tech> [--sign]');
  process.exit(1);
}

if (!validVariants.has(variant)) {
  console.error('Invalid variant. Use --variant full or --variant tech.');
  process.exit(1);
}

const bundles = os === 'macos' ? 'app,dmg' : 'nsis,msi';
const env = { ...process.env, VITE_VARIANT: variant };
const cliArgs = ['@tauri-apps/cli', 'build', '--bundles', bundles];

if (variant === 'tech') {
  cliArgs.push('--config', 'src-tauri/tauri.tech.conf.json');
}

if (sign) {
  const requiredVars =
    os === 'macos'
      ? ['TAURI_BUNDLE_MACOS_SIGNING_IDENTITY', 'TAURI_BUNDLE_MACOS_PROVIDER_SHORT_NAME']
      : ['TAURI_BUNDLE_WINDOWS_CERTIFICATE_THUMBPRINT'];

  const missing = requiredVars.filter((name) => !env[name]);
  if (missing.length > 0) {
    console.error(`Signing requested (--sign) but missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

console.log(`[desktop-package] OS=${os} VARIANT=${variant} BUNDLES=${bundles} SIGN=${sign ? 'on' : 'off'}`);

const result = spawnSync('npx', cliArgs, {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
