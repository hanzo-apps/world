// Cloudflare Workers entry for world.hanzo.ai.
//
// Routes API paths to handlers under ./functions/v1/world/*.js. Anything
// that isn't an API route falls through to the static SPA bundle, served
// by the [assets] binding (configured in wrangler.toml).

import * as checkout from '../functions/v1/world/checkout.js';
import * as me from '../functions/v1/world/me.js';
import * as login from '../functions/v1/world/login.js';
import * as chat from '../functions/v1/world/chat.js';

const ROUTES = {
  '/v1/world/checkout': checkout,
  '/v1/world/me': me,
  '/v1/world/login': login,
  '/v1/world/chat': chat,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const handlerModule = ROUTES[url.pathname];
    if (handlerModule) {
      const fn = pickHandler(handlerModule, request.method);
      if (!fn) {
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return fn({ request, env, ctx, params: {} });
    }

    // /v1/world/* with no matching route → 404 JSON.
    if (url.pathname.startsWith('/v1/world/')) {
      return new Response(JSON.stringify({ error: 'not_found', path: url.pathname }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Everything else → the SPA bundle (assets binding serves index.html
    // for unknown routes per `not_found_handling: single-page-application`).
    return env.ASSETS.fetch(request);
  },
};

function pickHandler(module, method) {
  // Pages Functions convention: onRequest, onRequestGet, onRequestPost, ...
  const upper = method.toUpperCase();
  const specific = module[`onRequest${pascal(upper)}`];
  if (typeof specific === 'function') return specific;
  if (typeof module.onRequest === 'function') return module.onRequest;
  return null;
}

function pascal(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
