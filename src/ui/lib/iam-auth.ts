/**
 * Hanzo IAM OAuth helpers.
 *
 * The app will migrate off Clerk to IAM (hanzo.id) OIDC. These helpers are
 * the seam — they route to IAM in production, fall back to Clerk in dev
 * until the backend agent wires IAM server-side. Keeping the seam narrow
 * means the day IAM is ready we only flip this file, not every call site.
 */

const IAM_ENDPOINT = 'https://hanzo.id';
const IAM_CLIENT_ID = 'hanzo-world-client-id';

export interface IamSession {
  userId: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

export function getIamAuthorizeUrl(redirectAfter = '/'): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const redirectUri = `${origin}/callback/hanzo`;
  const state = encodeURIComponent(redirectAfter);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: IAM_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state,
  });
  return `${IAM_ENDPOINT}/oauth/authorize?${params.toString()}`;
}

export function signInWithIam(redirectAfter?: string): void {
  if (typeof window === 'undefined') return;
  window.location.href = getIamAuthorizeUrl(redirectAfter ?? window.location.pathname);
}

export function signOut(): void {
  if (typeof window === 'undefined') return;
  // Clear local tokens
  localStorage.removeItem('hanzo-iam-token');
  localStorage.removeItem('hanzo-iam-user');
  window.location.href = `${IAM_ENDPOINT}/oauth/logout`;
}

export function getCurrentSession(): IamSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('hanzo-iam-user');
    return raw ? (JSON.parse(raw) as IamSession) : null;
  } catch {
    return null;
  }
}

// Aliases used by @hanzo/gui-rewritten components.
export const signOutFromIam = signOut;
export function getAccessToken(): string | null {
  const s = getCurrentSession();
  return s?.accessToken ?? null;
}
