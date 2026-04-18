/**
 * Hanzo IAM (hanzo.id) OIDC/PKCE client for World Monitor.
 *
 * Replaces the previous Clerk integration. All auth flows terminate at
 * https://hanzo.id under the `app-world` Casdoor application.
 *
 * localStorage keys:
 *   hanzo_world_access_token
 *   hanzo_world_refresh_token
 *   hanzo_world_expires_at
 *   hanzo_world_code_verifier  (transient; cleared after callback)
 *   hanzo_world_state          (transient; cleared after callback)
 *   hanzo_world_user           (JSON blob of IamUser; refreshed on token exchange)
 */

const KEY_PREFIX = 'hanzo_world_';
const KEY_ACCESS_TOKEN = `${KEY_PREFIX}access_token`;
const KEY_REFRESH_TOKEN = `${KEY_PREFIX}refresh_token`;
const KEY_EXPIRES_AT = `${KEY_PREFIX}expires_at`;
const KEY_CODE_VERIFIER = `${KEY_PREFIX}code_verifier`;
const KEY_STATE = `${KEY_PREFIX}state`;
const KEY_USER = `${KEY_PREFIX}user`;
const KEY_RETURN_TO = `${KEY_PREFIX}return_to`;

const IAM_SERVER_URL = (typeof import.meta !== 'undefined'
  && import.meta.env?.VITE_IAM_SERVER_URL) as string | undefined
  || 'https://hanzo.id';
const IAM_CLIENT_ID = (typeof import.meta !== 'undefined'
  && import.meta.env?.VITE_IAM_CLIENT_ID) as string | undefined
  || 'hanzo-world-client-id';
const IAM_REDIRECT_URI_DEFAULT = `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`;

export interface IamUser {
  id: string;
  sub: string;
  email: string;
  name: string;
  displayName: string;
  avatar: string | null;
  owner: string;
  plan: 'free' | 'pro';
}

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // isolate listener errors
    }
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function generateRandom(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, length);
}

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
}

function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

function toIamUser(payload: Record<string, unknown>): IamUser {
  const owner = typeof payload.owner === 'string' ? payload.owner : 'hanzo';
  const name = typeof payload.name === 'string' ? payload.name : '';
  const id = typeof payload.sub === 'string' ? payload.sub : (name || 'anonymous');
  const plan = (payload.plan === 'pro' || payload.subscription === 'pro')
    ? 'pro'
    : 'free';
  return {
    id,
    sub: typeof payload.sub === 'string' ? payload.sub : id,
    email: typeof payload.email === 'string' ? payload.email : '',
    name,
    displayName: typeof payload.displayName === 'string'
      ? payload.displayName
      : name || (typeof payload.email === 'string' ? payload.email : ''),
    avatar: typeof payload.avatar === 'string' ? payload.avatar : null,
    owner,
    plan,
  };
}

/** Clear all transient OAuth state (code verifier + CSRF state). */
function clearTransient(): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  ls.removeItem(KEY_CODE_VERIFIER);
  ls.removeItem(KEY_STATE);
}

/** True if we have a non-expired access token. */
export function isLoggedIn(): boolean {
  const ls = safeLocalStorage();
  if (!ls) return false;
  const token = ls.getItem(KEY_ACCESS_TOKEN);
  const expiresAt = ls.getItem(KEY_EXPIRES_AT);
  if (!token) return false;
  if (expiresAt && Date.now() > Number(expiresAt)) return false;
  return true;
}

/** Return the current IAM bearer token, or null if absent/expired. */
export function getAccessToken(): string | null {
  if (!isLoggedIn()) return null;
  return safeLocalStorage()?.getItem(KEY_ACCESS_TOKEN) ?? null;
}

/** Parse the current JWT into an IamUser, or null if no valid session. */
export function getCurrentUser(): IamUser | null {
  const ls = safeLocalStorage();
  if (!ls) return null;
  const cached = ls.getItem(KEY_USER);
  if (cached) {
    try {
      return JSON.parse(cached) as IamUser;
    } catch {
      ls.removeItem(KEY_USER);
    }
  }
  const token = getAccessToken();
  if (!token) return null;
  const payload = parseJwtPayload(token);
  if (!payload) return null;
  const user = toIamUser(payload);
  ls.setItem(KEY_USER, JSON.stringify(user));
  return user;
}

/** Begin the OIDC/PKCE login flow. Stores returnTo for callback. */
export async function startLogin(returnTo?: string): Promise<void> {
  const ls = safeLocalStorage();
  if (!ls) throw new Error('localStorage unavailable');

  const state = generateRandom(32);
  const codeVerifier = generateRandom(64);
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier));

  ls.setItem(KEY_STATE, state);
  ls.setItem(KEY_CODE_VERIFIER, codeVerifier);
  if (returnTo) {
    ls.setItem(KEY_RETURN_TO, returnTo);
  } else {
    ls.setItem(KEY_RETURN_TO, window.location.pathname + window.location.search + window.location.hash);
  }

  const base = IAM_SERVER_URL.replace(/\/+$/, '');
  const params = new URLSearchParams({
    client_id: IAM_CLIENT_ID,
    response_type: 'code',
    redirect_uri: IAM_REDIRECT_URI_DEFAULT,
    scope: 'openid profile email',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  window.location.href = `${base}/oauth/authorize?${params}`;
}

/** Process the OAuth callback — exchanges the code for tokens. */
export async function handleCallback(): Promise<IamUser | null> {
  const ls = safeLocalStorage();
  if (!ls) throw new Error('localStorage unavailable');

  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');

  if (err) {
    clearTransient();
    throw new Error(`IAM OAuth error: ${url.searchParams.get('error_description') ?? err}`);
  }

  // Accept implicit grant (access_token in query or hash) as a fallback.
  const implicitToken =
    url.searchParams.get('access_token') ||
    new URLSearchParams(url.hash.replace(/^#/, '')).get('access_token');

  if (implicitToken && !code) {
    const expiresIn = Number(url.searchParams.get('expires_in') ?? '3600');
    ls.setItem(KEY_ACCESS_TOKEN, implicitToken);
    ls.setItem(KEY_EXPIRES_AT, String(Date.now() + expiresIn * 1000));
    clearTransient();
    const user = getCurrentUser();
    notify();
    return user;
  }

  if (!code) throw new Error('No authorization code in callback');

  const savedState = ls.getItem(KEY_STATE);
  if (!savedState || savedState !== state) {
    clearTransient();
    throw new Error('OAuth state mismatch — possible CSRF');
  }

  const codeVerifier = ls.getItem(KEY_CODE_VERIFIER);
  if (!codeVerifier) {
    clearTransient();
    throw new Error('Missing code verifier');
  }

  clearTransient();

  const base = IAM_SERVER_URL.replace(/\/+$/, '');
  const tokenRes = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: IAM_CLIENT_ID,
      code,
      redirect_uri: IAM_REDIRECT_URI_DEFAULT,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`IAM token exchange failed: ${await tokenRes.text()}`);
  }
  const data = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) throw new Error('No access token in IAM response');

  ls.setItem(KEY_ACCESS_TOKEN, data.access_token);
  if (data.refresh_token) ls.setItem(KEY_REFRESH_TOKEN, data.refresh_token);
  ls.setItem(KEY_EXPIRES_AT, String(Date.now() + (data.expires_in ?? 3600) * 1000));
  // Invalidate cached user so getCurrentUser() re-parses from the new token.
  ls.removeItem(KEY_USER);

  const user = getCurrentUser();
  notify();
  return user;
}

/** Sign out — drops tokens, notifies listeners. */
export function logout(): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  ls.removeItem(KEY_ACCESS_TOKEN);
  ls.removeItem(KEY_REFRESH_TOKEN);
  ls.removeItem(KEY_EXPIRES_AT);
  ls.removeItem(KEY_USER);
  clearTransient();
  notify();
}

/** Consume the stored returnTo URL (cleared after read). */
export function consumeReturnTo(): string | null {
  const ls = safeLocalStorage();
  if (!ls) return null;
  const v = ls.getItem(KEY_RETURN_TO);
  ls.removeItem(KEY_RETURN_TO);
  return v;
}

/**
 * Subscribe to auth-state changes. Fires on login, logout, token refresh.
 * Returns an unsubscribe function.
 */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Fetch the current user from IAM userinfo — refreshes cached plan claim.
 * Used when the JWT might be stale (e.g. after subscription upgrade).
 */
export async function refreshUserInfo(): Promise<IamUser | null> {
  const token = getAccessToken();
  if (!token) return null;
  const base = IAM_SERVER_URL.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return getCurrentUser();
    const data = await res.json();
    const merged = toIamUser({ ...parseJwtPayload(token), ...data });
    safeLocalStorage()?.setItem(KEY_USER, JSON.stringify(merged));
    notify();
    return merged;
  } catch {
    return getCurrentUser();
  }
}

/** True when IAM server + client are configured. */
export function isConfigured(): boolean {
  return Boolean(IAM_SERVER_URL && IAM_CLIENT_ID);
}

/** Config constants exported for diagnostic / manual token fetches. */
export const iamConfig = {
  serverUrl: IAM_SERVER_URL,
  clientId: IAM_CLIENT_ID,
  redirectUri: IAM_REDIRECT_URI_DEFAULT,
};
