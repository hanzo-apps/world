// CORS helpers for Cloudflare Pages Functions.
//
// Allowed origins:
//   - https://world.hanzo.ai            (canonical production)
//   - https://*.world.hanzo.ai          (legacy variant subdomains during DNS cutover)
//   - https://world-*.pages.dev          (Cloudflare Pages preview deploys)
//   - tauri://localhost, asset://localhost, tauri.localhost  (desktop shell)
//   - http://localhost:*, http://127.0.0.1:*  (dev only)

const STATIC_ALLOWED = [
  /^https:\/\/world\.hanzo\.ai$/,
  /^https:\/\/(.*\.)?world\.hanzo\.ai$/,
  /^https:\/\/world-[a-z0-9-]+\.pages\.dev$/,
  /^https?:\/\/tauri\.localhost(:\d+)?$/,
  /^https?:\/\/[a-z0-9-]+\.tauri\.localhost(:\d+)?$/i,
  /^tauri:\/\/localhost$/,
  /^asset:\/\/localhost$/,
];

const DEV_ALLOWED = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

function isProd(env) {
  return (env && env.WM_ENV === 'production') || globalThis.WM_ENV === 'production';
}

export function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  const patterns = isProd(env) ? STATIC_ALLOWED : [...STATIC_ALLOWED, ...DEV_ALLOWED];
  return patterns.some((re) => re.test(origin));
}

export function corsHeaders(request, methods = 'GET, OPTIONS', env = null) {
  const origin = request.headers.get('origin') || '';
  const allow = isAllowedOrigin(origin, env) ? origin : 'https://world.hanzo.ai';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id, X-WorldMonitor-Key, X-Api-Key',
    'Access-Control-Max-Age': '3600',
    Vary: 'Origin',
  };
}
