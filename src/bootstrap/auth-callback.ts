/**
 * OAuth callback handler. Runs when the user lands on /auth/callback
 * after IAM login. Exchanges the `code` for tokens, then redirects to
 * the stored returnTo URL (or `/` if none).
 *
 * Call isOnAuthCallback() early in main.ts / settings-main.ts. If true,
 * await handleAuthCallback() and skip the rest of app startup.
 */

import { handleCallback, consumeReturnTo } from '@/services/iam';

const CALLBACK_PATH = '/auth/callback';

/** True if the current URL is the OAuth callback path. */
export function isOnAuthCallback(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.pathname === CALLBACK_PATH;
}

/**
 * Finish the IAM OAuth flow and redirect to the originally requested page.
 * Renders a minimal "Signing you in…" screen while the code exchange runs.
 */
export async function handleAuthCallback(): Promise<void> {
  const root = document.body;
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
                background:#0a0a0a;color:#e8e8e8;
                font-family:'SF Mono',Monaco,'Cascadia Code',monospace;">
      <div style="text-align:center;max-width:420px;padding:24px;">
        <div id="wm-auth-status" style="font-size:14px;color:#aaa;margin-bottom:12px;">
          Signing you in...
        </div>
        <div id="wm-auth-error" style="font-size:12px;color:#ff5a5a;white-space:pre-wrap;"></div>
      </div>
    </div>
  `;

  const status = document.getElementById('wm-auth-status');
  const errorBox = document.getElementById('wm-auth-error');

  try {
    const user = await handleCallback();
    if (status) status.textContent = user
      ? `Welcome, ${user.displayName || user.email}. Redirecting...`
      : 'Signed in. Redirecting...';

    const returnTo = consumeReturnTo() || '/';
    // Only redirect to same-origin paths.
    const target = safeReturnTo(returnTo);
    window.location.replace(target);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (status) status.textContent = 'Sign-in failed.';
    if (errorBox) errorBox.textContent = msg;
    console.error('[auth-callback]', err);
    // Give the user a way out.
    setTimeout(() => {
      window.location.replace('/');
    }, 5_000);
  }
}

function safeReturnTo(raw: string): string {
  // Only allow same-origin path-or-path-plus-query-or-hash strings.
  try {
    if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin) return '/';
    return u.pathname + u.search + u.hash;
  } catch {
    return '/';
  }
}
