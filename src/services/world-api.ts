/**
 * Typed client for the /v1/world/* HTTP API.
 *
 * Auto-attaches the IAM bearer token, merges JSON headers, and decodes
 * structured error responses.
 */

import { getAccessToken } from './iam';

const WORLD_API_BASE = (typeof import.meta !== 'undefined'
  && import.meta.env?.VITE_WORLD_API_BASE) as string | undefined
  || '';

export interface Entitlements {
  planKey: string;
  features: {
    tier: number;
    apiAccess: boolean;
    apiRateLimit: number;
    maxDashboards: number;
    prioritySupport: boolean;
    exportFormats: string[];
  };
  validUntil: number;
}

export interface WorldMe {
  user: {
    id: string;
    email: string;
    name: string;
    plan: 'free' | 'pro';
  };
  entitlements: Entitlements | null;
  subscription: WorldSubscription | null;
}

export interface WorldSubscription {
  id: string;
  planKey: string;
  displayName: string;
  status: 'active' | 'on_hold' | 'cancelled' | 'expired';
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelledAt?: number;
}

export interface AlertRule {
  id: string;
  variant: string;
  enabled: boolean;
  eventTypes: string[];
  sensitivity: string;
  channels: string[];
  quietHoursEnabled?: boolean;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  quietHoursTimezone?: string;
  quietHoursOverride?: string;
  digestMode?: string;
  digestHour?: number;
  digestTimezone?: string;
  aiDigestEnabled?: boolean;
  updatedAt: number;
}

export interface WorldApiError extends Error {
  status: number;
  code?: string;
}

class ApiError extends Error implements WorldApiError {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'WorldApiError';
    this.status = status;
    this.code = code;
  }
}

function buildUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${WORLD_API_BASE}${normalized}`;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  init?: { requireAuth?: boolean; timeoutMs?: number },
): Promise<T> {
  const requireAuth = init?.requireAuth ?? true;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (requireAuth) {
    const token = getAccessToken();
    if (!token) throw new ApiError(401, 'Not signed in', 'UNAUTHENTICATED');
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const t = init?.timeoutMs ?? 20_000;
  const timer = setTimeout(() => controller.abort(), t);

  try {
    const res = await fetch(buildUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    const parsed = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = (parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string')
        ? (parsed as { error: string }).error
        : `HTTP ${res.status}`;
      const code = (parsed && typeof parsed === 'object' && 'code' in parsed && typeof (parsed as { code: unknown }).code === 'string')
        ? (parsed as { code: string }).code
        : undefined;
      throw new ApiError(res.status, msg, code);
    }
    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// -------- API surface ------------------------------------------------------

export async function getMe(): Promise<WorldMe> {
  return request<WorldMe>('GET', '/v1/world/me');
}

export async function listSubscriptions(): Promise<WorldSubscription[]> {
  const r = await request<{ subscriptions: WorldSubscription[] }>('GET', '/v1/world/subscriptions');
  return r.subscriptions;
}

export async function startCheckout(params: {
  planKey: string;
  returnUrl?: string;
  discountCode?: string;
  referralCode?: string;
}): Promise<{ checkoutUrl: string }> {
  return request<{ checkoutUrl: string }>('POST', '/v1/world/checkout', params);
}

export async function getPreferences(variant: string): Promise<{
  variant: string;
  data: unknown;
  schemaVersion: number;
  syncVersion: number;
  updatedAt: number;
} | null> {
  return request('GET', `/v1/world/preferences?variant=${encodeURIComponent(variant)}`);
}

export async function putPreferences(params: {
  variant: string;
  data: unknown;
  expectedSyncVersion: number;
  schemaVersion?: number;
}): Promise<{ syncVersion: number; updatedAt: number }> {
  return request('PUT', '/v1/world/preferences', params);
}

export async function listAlerts(): Promise<AlertRule[]> {
  const r = await request<{ rules: AlertRule[] }>('GET', '/v1/world/alerts');
  return r.rules;
}

export async function createAlert(rule: Omit<AlertRule, 'id' | 'updatedAt'>): Promise<AlertRule> {
  return request<AlertRule>('POST', '/v1/world/alerts', rule);
}

export async function updateAlert(id: string, rule: Partial<Omit<AlertRule, 'id' | 'updatedAt'>>): Promise<AlertRule> {
  return request<AlertRule>('PUT', `/v1/world/alerts/${encodeURIComponent(id)}`, rule);
}

export async function deleteAlert(id: string): Promise<void> {
  await request<void>('DELETE', `/v1/world/alerts/${encodeURIComponent(id)}`);
}

export interface RegisterInterestRequest {
  email: string;
  source?: string;
  appVersion?: string;
  referredBy?: string;
  turnstileToken?: string;
}

export interface RegisterInterestResponse {
  status: 'registered' | 'already_registered';
  referralCode: string;
  referralCount: number;
  position?: number;
  emailSuppressed?: boolean;
}

export async function registerInterest(body: RegisterInterestRequest): Promise<RegisterInterestResponse> {
  return request<RegisterInterestResponse>('POST', '/v1/world/register', body, { requireAuth: false });
}

export interface CreateApiKeyRequest {
  name: string;
  keyPrefix: string;
  keyHash: string;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

export async function createApiKey(body: CreateApiKeyRequest): Promise<ApiKeyRecord> {
  return request<ApiKeyRecord>('POST', '/v1/world/api-keys', body);
}

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  const r = await request<{ keys: ApiKeyRecord[] }>('GET', '/v1/world/api-keys');
  return r.keys;
}

export async function revokeApiKey(id: string): Promise<{ keyHash: string }> {
  return request<{ keyHash: string }>('DELETE', `/v1/world/api-keys/${encodeURIComponent(id)}`);
}

export { ApiError as WorldApiClientError };
