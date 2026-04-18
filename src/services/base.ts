/**
 * Hanzo Base (@hanzo/base) client for World Monitor.
 *
 * Single BaseClient instance wired to the Base deployment for world data.
 * Auth comes from the IAM JWT bearer token (no separate Base login).
 *
 * Default URL: https://world.hanzo.ai — a dedicated Base instance backing
 * the /v1/world/* server endpoints. Can be overridden with
 * VITE_BASE_URL env var for dev or self-hosted deployments.
 */

import { BaseClient, type AuthStore, type BaseRecord } from '@hanzo/base';
import { getAccessToken, subscribe as subscribeIam, getCurrentUser } from './iam';

const BASE_URL = (typeof import.meta !== 'undefined'
  && import.meta.env?.VITE_BASE_URL) as string | undefined
  || 'https://world.hanzo.ai';

/**
 * Auth store that proxies to IAM. Never manages its own tokens.
 * When IAM logs in/out, the Base client picks up the new token on next request.
 */
class IamAuthStore implements AuthStore {
  private _listeners = new Set<(token: string, record: BaseRecord | null) => void>();

  constructor() {
    subscribeIam(() => {
      const tok = this.token;
      const rec = this.record;
      for (const fn of this._listeners) {
        try {
          fn(tok, rec);
        } catch {
          // isolate
        }
      }
    });
  }

  get token(): string {
    return getAccessToken() ?? '';
  }

  get record(): BaseRecord | null {
    const u = getCurrentUser();
    if (!u) return null;
    return {
      id: u.id,
      collectionId: 'users',
      collectionName: 'users',
      created: '',
      updated: '',
      email: u.email,
      name: u.name,
      owner: u.owner,
      plan: u.plan,
    } satisfies BaseRecord;
  }

  get isValid(): boolean {
    return this.token.length > 0;
  }

  save(_token: string, _record: BaseRecord | null): void {
    // Base SDK calls save() after auth actions that we never trigger
    // (no password auth flow — IAM is the source of truth). Ignore.
  }

  clear(): void {
    // Don't trigger IAM logout from Base-level clear — would recurse.
  }

  onChange(callback: (token: string, record: BaseRecord | null) => void): () => void {
    this._listeners.add(callback);
    return () => {
      this._listeners.delete(callback);
    };
  }
}

let _client: BaseClient | null = null;

/** Returns the shared BaseClient instance, constructing it on first call. */
export function getBaseClient(): BaseClient {
  if (!_client) {
    _client = new BaseClient({
      url: BASE_URL,
      authStore: new IamAuthStore(),
    });
  }
  return _client;
}

/** Base URL in use (exposed for diagnostics). */
export const baseConfig = {
  url: BASE_URL,
};
