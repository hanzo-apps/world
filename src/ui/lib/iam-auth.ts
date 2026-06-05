/**
 * Hanzo IAM auth helpers for the @hanzo/gui React island.
 *
 * Thin adapter over `src/services/iam` (the canonical PKCE/OIDC client) —
 * the React components consume the legacy `IamSession` shape, so this file
 * remaps `IamUser` → `IamSession` and forwards login/logout/token reads to
 * the real client. There's exactly one OAuth implementation; this is only
 * the shape adapter for the chrome surface.
 */

import {
  startLogin,
  logout as iamLogout,
  getCurrentUser,
  getAccessToken as iamGetAccessToken,
} from '@/services/iam';

export interface IamSession {
  userId: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

export function signInWithIam(redirectAfter?: string): void {
  startLogin(redirectAfter).catch((err) => {
    // PKCE prep can throw if localStorage is unavailable; surface to the
    // console so the user sees a click that did nothing has a reason.
    console.error('[iam] signInWithIam failed:', err);
  });
}

export function signOut(): void {
  iamLogout();
  // The canonical client doesn't redirect to IAM's logout endpoint (which
  // would clear the IAM session cookie too); call sites that want hard
  // logout can hit `${IAM_ENDPOINT}/oauth/logout` themselves.
}

export const signOutFromIam = signOut;

export function getCurrentSession(): IamSession | null {
  const u = getCurrentUser();
  if (!u) return null;
  return {
    userId: u.id,
    email: u.email || undefined,
    name: u.displayName || u.name || undefined,
    avatarUrl: u.avatar || undefined,
  };
}

export function getAccessToken(): string | null {
  return iamGetAccessToken();
}
