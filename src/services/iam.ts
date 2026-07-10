// Hanzo IAM login — hanzo.id OIDC Authorization-Code + PKCE (S256), public
// client, no secret. Framework-free (Web Crypto + fetch + localStorage), ported
// from the canonical @hanzo/iam SDK so Hanzo World shares one identity provider
// with studio/chat/app. See docs: IAM serves a 200 SPA for unknown paths, so we
// hit the exact OIDC paths below (a wrong path returns HTML, never 404).
//
// The PKCE transaction (state + verifier) is forced to localStorage so it
// survives the cross-site redirect / Safari ITP / SSO bounce — the classic
// "Missing PKCE code verifier" failure when sessionStorage is used.

import { isDesktopRuntime } from './runtime';

// Brand issuer by host: world.hanzo.ai + variants → hanzo.id. lux/zoo variants
// resolve to their own IAM so the white-label stays honest.
function resolveIssuer(): string {
  const h = typeof location !== 'undefined' ? location.hostname : '';
  if (h.endsWith('lux.network') || h.endsWith('lux.id')) return 'https://lux.id';
  if (h.endsWith('zoo.ngo') || h.endsWith('zoo.network') || h.endsWith('zoo.id')) return 'https://zoo.id';
  return 'https://hanzo.id';
}

// <org>-<app> per convention. hanzo-world is a public PKCE client registered in
// IAM with redirect https://world.hanzo.ai/auth/callback (+ localhost for dev)
// and the desktop loopback below.
const CLIENT_ID = 'hanzo-world';
const REDIRECT_PATH = '/auth/callback';
const SCOPE = 'openid profile email';

const ISSUER = resolveIssuer();

// The Tauri desktop shell runs on an app-scheme origin (tauri://localhost) that
// no OIDC provider can redirect back to, so the desktop build sends the OIDC
// flow to a fixed loopback the app captures (registered in the hanzo-world
// client allowlist alongside the web origins). The WEB build ALWAYS uses its own
// site origin — never a hardcoded host — so world.hanzo.ai and every *.hanzo.app
// fork are self-consistent. Evaluated per call (not at import) so it reflects the
// live runtime, including the callback page itself.
const DESKTOP_REDIRECT_URI = 'http://127.0.0.1:5219/auth/callback';

function redirectUri(): string {
  if (typeof location === 'undefined') return '';
  if (isDesktopRuntime()) return DESKTOP_REDIRECT_URI;
  return `${location.origin}${REDIRECT_PATH}`;
}

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
  org: 'hanzo_iam_org',     // active tenant org (blank/absent => home org)
} as const;

// IAM (Casdoor) API — verb paths, served from the same issuer as OIDC. Used to
// list the orgs a user belongs to (self-scoped for a normal token; all orgs for
// a global admin). Projects live under org-scope, one call away.
const IAM_API = {
  organizations: '/v1/iam/get-organizations',
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
  u.searchParams.set('redirect_uri', redirectUri());
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
    redirect_uri: redirectUri(),
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
  const idTok = localStorage.getItem(K.id);
  // Sign-out clears the local session FIRST — it must never be blocked by, or
  // depend on, the network. Once the tokens are gone the app is signed out on
  // the next paint regardless of what the IdP does.
  cachedUser = null;
  cachedOrgs = null;
  Object.values(K).forEach((k) => localStorage.removeItem(k));
  localStorage.removeItem('hanzo_iam_org');
  // Best-effort IdP session end, hard-bounded so it can never hang the reload
  // (the old unbounded await was the bug: a slow/blocked logout call left the
  // UI stuck "signed in"). RP-initiated logout with id_token_hint ends the SSO
  // session so a later sign-in isn't silently re-authenticated from the cookie.
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const u = new URL(ISSUER + OIDC.logout);
    if (idTok) u.searchParams.set('id_token_hint', idTok);
    await fetch(u.toString(), {
      method: 'POST',
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      signal: ctrl.signal,
      keepalive: true,
    }).catch(() => { /* best effort */ });
    clearTimeout(timer);
  } catch { /* best effort */ }
}

// ── tenant context (org selection) ──────────────────────────────────────────
//
// The active org is a single client-side value (localStorage `hanzo_iam_org`).
// It scopes bearer-authenticated calls world makes via the `X-Org-Id` header —
// the ONE tenant header the cloud gateway reads (hanzo/cloud/middleware_identity.go
// pins X-Org-Id from the validated JWT owner for a normal token, and honors a
// requested X-Org-Id only for a global admin). So switching is safe: a normal
// user always resolves to their own org; only a global admin crosses orgs.

export interface OrgInfo {
  name: string;        // canonical org id (Casdoor org name)
  displayName: string; // human label
}

let cachedOrgs: OrgInfo[] | null = null;

/** The user's home org — the cached IAM `owner` claim. */
export function homeOrg(): string {
  return cachedOwner();
}

/** The active org: the explicit selection, else the home org. Sync, for paint. */
export function getActiveOrg(): string {
  try {
    return localStorage.getItem(K.org) || cachedOwner();
  } catch {
    return cachedOwner();
  }
}

/** Select the active org. Clearing to the home org removes the override. */
export function setActiveOrg(org: string): void {
  try {
    if (!org || org === cachedOwner()) localStorage.removeItem(K.org);
    else localStorage.setItem(K.org, org);
  } catch { /* private mode */ }
}

/** True when the user is acting in an org other than their home org. */
export function isOrgScopedAway(): boolean {
  let cur = '';
  try { cur = localStorage.getItem(K.org) || ''; } catch { /* private mode */ }
  return !!cur && cur !== cachedOwner();
}

/**
 * The orgs the signed-in user belongs to, from IAM get-organizations. A normal
 * token is server-side scoped to its own org; a global admin sees all. Degrades
 * to the single home org on any failure so the switcher is always usable.
 */
export async function listOrgs(force = false): Promise<OrgInfo[]> {
  if (cachedOrgs && !force) return cachedOrgs;
  const home = cachedOwner();
  const fallback: OrgInfo[] = home ? [{ name: home, displayName: home }] : [];
  const tok = await getToken();
  if (!tok) return fallback;
  try {
    const u = new URL(ISSUER + IAM_API.organizations);
    if (home) u.searchParams.set('owner', home);
    const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) return fallback;
    const data = await r.json();
    const arr: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    const orgs = arr
      .map((o) => {
        const rec = o as { name?: unknown; displayName?: unknown };
        const name = String(rec?.name ?? '');
        return { name, displayName: String(rec?.displayName ?? name) };
      })
      .filter((o) => o.name && o.name !== 'built-in');
    // Home org first, then the rest, deduped by name.
    const merged = [...(home ? [{ name: home, displayName: home }] : []), ...orgs];
    const seen = new Set<string>();
    cachedOrgs = merged.filter((o) => (seen.has(o.name) ? false : (seen.add(o.name), true)));
    return cachedOrgs.length ? cachedOrgs : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Headers for a bearer-authenticated call world makes to api.hanzo.ai: the token
 * plus the active-org selector. The org header is omitted when there is no org
 * (signed out), so callers can use this unconditionally.
 */
export async function orgHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const tok = await getToken();
  const org = getActiveOrg();
  const h: Record<string, string> = { ...extra };
  if (org) h['X-Org-Id'] = org;
  if (tok) h.Authorization = `Bearer ${tok}`;
  return h;
}

export const iamIssuer = ISSUER;
