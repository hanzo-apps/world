/**
 * Frontend service for managing user API keys.
 *
 * Client generates the plaintext key + SHA-256 hash locally so the raw key
 * never touches the server logs. Then calls /v1/world/api-keys which stores
 * only the hash + prefix in @hanzo/base.
 *
 * Public surface is unchanged: createApiKey / listApiKeys / revokeApiKey.
 */

import {
  createApiKey as apiCreate,
  listApiKeys as apiList,
  revokeApiKey as apiRevoke,
  type ApiKeyRecord,
} from './world-api';

export interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

export interface CreateApiKeyResult {
  id: string;
  name: string;
  keyPrefix: string;
  /** Plaintext key — shown to the user ONCE and never persisted. */
  key: string;
}

function generateKey(): string {
  const raw = new Uint8Array(20);
  crypto.getRandomValues(raw);
  const hex = Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('');
  return `wm_${hex}`;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function toInfo(r: ApiKeyRecord): ApiKeyInfo {
  const info: ApiKeyInfo = {
    id: r.id,
    name: r.name,
    keyPrefix: r.keyPrefix,
    createdAt: r.createdAt,
  };
  if (r.lastUsedAt !== undefined) info.lastUsedAt = r.lastUsedAt;
  if (r.revokedAt !== undefined) info.revokedAt = r.revokedAt;
  return info;
}

/** Create a new API key for the current user. Returns plaintext once. */
export async function createApiKey(name: string): Promise<CreateApiKeyResult> {
  const plaintext = generateKey();
  const keyPrefix = plaintext.slice(0, 8);
  const keyHash = await sha256Hex(plaintext);

  const record = await apiCreate({ name: name.trim(), keyPrefix, keyHash });
  return {
    id: record.id,
    name: record.name,
    keyPrefix: record.keyPrefix,
    key: plaintext,
  };
}

/** List all API keys for the current user. */
export async function listApiKeys(): Promise<ApiKeyInfo[]> {
  try {
    const records = await apiList();
    return records.map(toInfo);
  } catch (err) {
    console.warn('[api-keys] list failed:', (err as Error).message);
    return [];
  }
}

/** Revoke an API key by ID. The server handles cache invalidation. */
export async function revokeApiKey(keyId: string): Promise<void> {
  await apiRevoke(keyId);
}
