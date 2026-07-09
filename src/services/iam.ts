// Hanzo IAM login — hanzo.id OIDC Authorization-Code + PKCE (S256), public
// client, no secret. Framework-free (Web Crypto + fetch + localStorage), ported
// from the canonical @hanzo/iam SDK so Hanzo World shares one identity provider
// with studio/chat/app. See docs: IAM serves a 200 SPA for unknown paths, so we
// hit the exact OIDC paths below (a wrong path returns HTML, never 404).
//
// The PKCE transaction (state + verifier) is forced to localStorage so it
// survives the cross-site redirect / Safari ITP / SSO bounce — the classic
// "Missing PKCE code verifier" failure when sessionStorage is used.

// Brand issuer by host: world.hanzo.ai + variants → hanzo.id. lux/zoo variants
// resolve to their own IAM so the white-label stays honest.
function resolveIssuer(): string {
  const h = typeof location !== 'undefined' ? location.hostname : '';
  if (h.endsWith('lux.network') || h.endsWith('lux.id')) return 'https://lux.id';
  if (h.endsWith('zoo.ngo') || h.endsWith('zoo.network') || h.endsWith('zoo.id')) return 'https://zoo.id';
  return 'https://hanzo.id';
}

// <org>-<app> per convention. hanzo-world is a public PKCE client registered in
// IAM with redirect https://world.hanzo.ai/auth/callback (+ localhost for dev).
const CLIENT_ID = 'hanzo-world';
const REDIRECT_PATH = '/auth/callback';
const SCOPE = 'openid profile email';

const ISSUER = resolveIssuer();
const REDIRECT_URI = typeof location !== 'undefined' ? `${location.origin}${REDIRECT_PATH}` : '';

const OIDC = {
  authorize: '/v1/iam/oauth/authorize',
  token: '/v1/iam/oauth/token',
  userinfo: '/v1/iam/oauth/userinfo',
  logout: '/v1/iam/oauth/logout',
} as const;

// localStorage keys. Tokens live in localStorage so the session survives reload
// / new tab (sessionStorage was the cause of dropping back to "Sign in").
const K = {
  state: 'hanzo_iam_state',
  verifier: 'hanzo_iam_code_verifier',
  access: 'hanzo_iam_access_token',
  refresh: 'hanzo_iam_refresh_token',
  id: 'hanzo_iam_id_token',
  exp: 'hanzo_iam_expires_at',
  returnTo: 'hanzo_iam_return_to',
  owner: 'hanzo_iam_owner', // cached owner claim for instant admin-gate paint
} as const;

// The one org that may see the platform-wide Cloud console. Server-side gates
// enforce this too (fail-closed 403); the client value is UX only.
export const ADMIN_ORG = 'admin';

export interface IamUser {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  owner?: string;   // the org (owner claim)
  groups?: string[];
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

const b64url = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const rand = (n = 32): string => b64url(crypto.getRandomValues(new Uint8Array(n)).buffer as ArrayBuffer);
const sha256 = (s: string): Promise<ArrayBuffer> =>
  crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));

/** Build the authorize URL, persisting the PKCE state + verifier. */
export async function buildAuthUrl(provider?: string): Promise<string> {
  const verifier = rand();
  const state = rand();
  const challenge = b64url(await sha256(verifier));
  localStorage.setItem(K.state, state);
  localStorage.setItem(K.verifier, verifier);

  const u = new URL(ISSUER + OIDC.authorize);
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', REDIRECT_URI);
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (provider) u.searchParams.set('provider', provider); // social/web3 upstream hop
  return u.toString();
}

/** Redirect the browser to the IAM login. Stashes the current URL to return to. */
export async function login(provider?: string): Promise<void> {
  try {
    localStorage.setItem(K.returnTo, location.pathname + location.search);
  } catch { /* private mode */ }
  location.href = await buildAuthUrl(provider);
}

/** True when the current URL is the OIDC redirect landing. */
export function isCallback(): boolean {
  return typeof location !== 'undefined' && location.pathname === REDIRECT_PATH;
}

/**
 * Complete the code exchange on the callback landing. Returns the path to
 * return the user to (defaults to '/'). Throws on CSRF/exchange failure.
 */
export async function handleCallback(): Promise<string> {
  const q = new URLSearchParams(location.search);
  const err = q.get('error');
  if (err) throw new Error(q.get('error_description') || err);

  const state = q.get('state');
  const code = q.get('code');
  if (!state || state !== localStorage.getItem(K.state)) throw new Error('state mismatch (CSRF)');
  const verifier = localStorage.getItem(K.verifier);
  if (!code || !verifier) throw new Error('missing code/verifier');
  localStorage.removeItem(K.state);
  localStorage.removeItem(K.verifier);

  const t = await exchangeCode(code, verifier);
  storeTokens(t);

  const returnTo = localStorage.getItem(K.returnTo) || '/';
  localStorage.removeItem(K.returnTo);
  return returnTo.startsWith('/') ? returnTo : '/';
}

function storeTokens(t: TokenResponse): void {
  localStorage.setItem(K.access, t.access_token);
  if (t.refresh_token) localStorage.setItem(K.refresh, t.refresh_token);
  if (t.id_token) localStorage.setItem(K.id, t.id_token);
  if (t.expires_in) localStorage.setItem(K.exp, String(Date.now() + t.expires_in * 1000));
}

async function exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  const r = await fetch(ISSUER + OIDC.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error(`token exchange ${r.status}: ${await r.text()}`);
  return r.json() as Promise<TokenResponse>;
}

async function refresh(): Promise<string | null> {
  const rt = localStorage.getItem(K.refresh);
  if (!rt) return null;
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: rt });
  const r = await fetch(ISSUER + OIDC.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) return null;
  const t = (await r.json()) as TokenResponse;
  storeTokens(t);
  return t.access_token;
}

/** A valid (non-expired) access token, refreshing on demand. null if signed out. */
export async function getToken(): Promise<string | null> {
  const tok = localStorage.getItem(K.access);
  const exp = Number(localStorage.getItem(K.exp) || 0);
  // 30s skew so we never send a token that expires mid-flight.
  if (tok && Date.now() < exp - 30_000) return tok;
  return refresh();
}

export function isAuthenticated(): boolean {
  return !!localStorage.getItem(K.access);
}

let cachedUser: IamUser | null = null;

/** Fetch the OIDC userinfo (cached for the session). null if signed out. */
export async function getUser(force = false): Promise<IamUser | null> {
  if (cachedUser && !force) return cachedUser;
  const tok = await getToken();
  if (!tok) return null;
  const r = await fetch(ISSUER + OIDC.userinfo, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) return null;
  const u = await r.json();
  cachedUser = {
    sub: u.sub,
    email: u.email,
    name: u.name || u.preferred_username || u.displayName,
    picture: u.picture || u.avatar,
    owner: u.owner,
    groups: Array.isArray(u.groups) ? u.groups : [],
  };
  try { localStorage.setItem(K.owner, cachedUser.owner || ''); } catch { /* private mode */ }
  return cachedUser;
}

/** The owner (org) claim cached from the last userinfo — sync, for instant paint. */
export function cachedOwner(): string {
  try { return localStorage.getItem(K.owner) || ''; } catch { return ''; }
}

/** Instant, best-effort admin check from the cached owner (UX only). */
export function cachedIsAdmin(): boolean {
  return cachedOwner() === ADMIN_ORG;
}

/** Authoritative admin check: owner claim from userinfo === the admin org.
 *  The server independently enforces this (fail-closed 403); this is the client
 *  gate that hides admin-only Cloud panels. */
export async function isAdmin(): Promise<boolean> {
  const u = await getUser();
  return (u?.owner || '') === ADMIN_ORG;
}

export async function logout(): Promise<void> {
  const tok = localStorage.getItem(K.access);
  try {
    await fetch(ISSUER + OIDC.logout, {
      method: 'POST',
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
  } catch { /* best effort */ }
  cachedUser = null;
  Object.values(K).forEach((k) => localStorage.removeItem(k));
}

export const iamIssuer = ISSUER;
