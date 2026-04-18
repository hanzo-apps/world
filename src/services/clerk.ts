/**
 * Backwards-compatible auth shim over Hanzo IAM.
 *
 * This module keeps the `clerk.ts` export surface that 14 callers depend on
 * (getClerkToken, getCurrentClerkUser, openSignIn, mountUserButton, etc.)
 * and redirects every call to the IAM (`hanzo.id`) implementation.
 *
 * No Clerk dependency. The file name is historical; new code should import
 * from `@/services/iam` directly.
 */

import {
  getAccessToken,
  getCurrentUser,
  startLogin,
  logout as iamLogout,
  subscribe as iamSubscribe,
  refreshUserInfo,
  isConfigured,
} from './iam';

/** Initialize IAM auth. No-op in IAM-world — kept for callers that expect async init. */
export async function initClerk(): Promise<void> {
  if (!isConfigured()) {
    console.warn('[auth] IAM not configured — VITE_IAM_SERVER_URL / VITE_IAM_CLIENT_ID missing');
    return;
  }
  // IAM state lives in localStorage; no async load needed.
  // Refresh the cached user record if we have a token (non-blocking).
  refreshUserInfo().catch(() => { /* best-effort */ });
}

/** Placeholder for legacy callers that treat Clerk as a handle. Always null now. */
export function getClerk(): null {
  return null;
}

/** Kick off the IAM login flow. */
export function openSignIn(): void {
  if (typeof window === 'undefined') return;
  startLogin().catch((err) => {
    console.error('[auth] startLogin failed:', err);
  });
}

/** Sign the user out and notify subscribers. */
export async function signOut(): Promise<void> {
  iamLogout();
}

/** No-op — kept for API compatibility; IAM tokens are read fresh from storage. */
export function clearClerkTokenCache(): void {
  // IAM tokens aren't cached in-memory by this shim; no cache to invalidate.
}

/** Return the current IAM access token, or null if signed out / expired. */
export async function getClerkToken(): Promise<string | null> {
  return getAccessToken();
}

export interface ClerkUserSnapshot {
  id: string;
  name: string;
  email: string;
  image: string | null;
  plan: 'free' | 'pro';
}

/** Snapshot of the current IAM user, shaped like the old Clerk return. */
export function getCurrentClerkUser(): ClerkUserSnapshot | null {
  const u = getCurrentUser();
  if (!u) return null;
  return {
    id: u.id,
    name: u.displayName || u.name || 'User',
    email: u.email,
    image: u.avatar,
    plan: u.plan,
  };
}

/** Subscribe to auth-state changes. Returns unsubscribe. */
export function subscribeClerk(callback: () => void): () => void {
  return iamSubscribe(callback);
}

/**
 * Mount a lightweight "user button" UI into the given element.
 *
 * The old Clerk UserButton was a rich modal; here we render a compact
 * button that displays the user name/email and on click offers Sign Out.
 * All DOM is self-contained (no Shadow DOM) and scoped by classnames.
 */
export function mountUserButton(el: HTMLDivElement): () => void {
  const snap = getCurrentClerkUser();
  if (!snap) {
    const btn = document.createElement('button');
    btn.className = 'auth-signin-btn';
    btn.textContent = 'Sign In';
    btn.addEventListener('click', () => openSignIn());
    el.innerHTML = '';
    el.appendChild(btn);
    return () => {
      el.innerHTML = '';
    };
  }

  const wrap = document.createElement('div');
  wrap.className = 'auth-user-button';
  wrap.style.cssText = 'position:relative;display:inline-block;';

  const trigger = document.createElement('button');
  trigger.className = 'auth-user-button-trigger';
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:8px',
    'padding:6px 10px',
    'border-radius:20px',
    'border:1px solid var(--border, #2a2a2a)',
    'background:var(--panel-bg, #141414)',
    'color:var(--text, #e8e8e8)',
    'cursor:pointer',
    "font-family:'SF Mono',Monaco,'Cascadia Code',monospace",
    'font-size:12px',
  ].join(';');

  const avatar = document.createElement('span');
  avatar.className = 'auth-user-avatar';
  avatar.style.cssText = [
    'width:24px',
    'height:24px',
    'border-radius:50%',
    'background:#2a2a2a',
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'overflow:hidden',
    'font-size:12px',
    'color:#fff',
  ].join(';');
  if (snap.image) {
    const img = document.createElement('img');
    img.src = snap.image;
    img.alt = snap.name;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    avatar.appendChild(img);
  } else {
    avatar.textContent = (snap.name?.charAt(0) || snap.email?.charAt(0) || 'U').toUpperCase();
  }

  const label = document.createElement('span');
  label.className = 'auth-user-label';
  label.textContent = snap.name || snap.email || 'User';

  trigger.appendChild(avatar);
  trigger.appendChild(label);

  const menu = document.createElement('div');
  menu.className = 'auth-user-menu';
  menu.style.cssText = [
    'position:absolute',
    'top:calc(100% + 6px)',
    'right:0',
    'min-width:220px',
    'border:1px solid var(--border, #2a2a2a)',
    'background:var(--panel-bg, #141414)',
    'color:var(--text, #e8e8e8)',
    'border-radius:6px',
    'box-shadow:0 8px 24px rgba(0,0,0,0.5)',
    'display:none',
    'z-index:10000',
    "font-family:'SF Mono',Monaco,'Cascadia Code',monospace",
    'font-size:12px',
    'overflow:hidden',
  ].join(';');

  const email = document.createElement('div');
  email.style.cssText = 'padding:10px 12px;border-bottom:1px solid var(--border, #2a2a2a);color:var(--muted, #aaa);word-break:break-all;';
  email.textContent = snap.email || snap.name;

  const signOutBtn = document.createElement('button');
  signOutBtn.type = 'button';
  signOutBtn.textContent = 'Sign out';
  signOutBtn.style.cssText = [
    'display:block',
    'width:100%',
    'padding:10px 12px',
    'background:transparent',
    'border:none',
    'color:inherit',
    'cursor:pointer',
    'text-align:left',
    "font-family:'SF Mono',Monaco,'Cascadia Code',monospace",
    'font-size:12px',
  ].join(';');
  signOutBtn.addEventListener('mouseenter', () => {
    signOutBtn.style.background = 'rgba(255,255,255,0.04)';
  });
  signOutBtn.addEventListener('mouseleave', () => {
    signOutBtn.style.background = 'transparent';
  });
  signOutBtn.addEventListener('click', () => {
    signOut().finally(() => {
      window.location.reload();
    });
  });

  menu.appendChild(email);
  menu.appendChild(signOutBtn);
  wrap.appendChild(trigger);
  wrap.appendChild(menu);

  const onDocClick = (ev: MouseEvent) => {
    if (!wrap.contains(ev.target as Node)) {
      menu.style.display = 'none';
      trigger.setAttribute('aria-expanded', 'false');
    }
  };
  trigger.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const open = menu.style.display === 'block';
    menu.style.display = open ? 'none' : 'block';
    trigger.setAttribute('aria-expanded', open ? 'false' : 'true');
  });
  document.addEventListener('click', onDocClick);

  el.innerHTML = '';
  el.appendChild(wrap);

  return () => {
    document.removeEventListener('click', onDocClick);
    el.innerHTML = '';
  };
}
