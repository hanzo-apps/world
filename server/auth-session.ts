/**
 * Server-side IAM session validation for the Vercel edge gateway.
 *
 * Validates hanzo.id-issued bearer tokens with jose + cached JWKS.
 * Replaces the earlier Clerk integration — no Clerk-specific env, no
 * publishable-key audience, no custom templates. IAM tokens are plain
 * OIDC JWTs.
 *
 * Env:
 *   IAM_ENDPOINT / IAM_URL / HANZO_IAM_URL — base URL of hanzo.id (default https://hanzo.id)
 *   IAM_JWKS_URL — override JWKS location (default <IAM_ENDPOINT>/.well-known/jwks.json)
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

function iamBaseUrl(): string {
  return (
    process.env.IAM_ENDPOINT
    ?? process.env.IAM_URL
    ?? process.env.HANZO_IAM_URL
    ?? 'https://hanzo.id'
  ).replace(/\/+$/, '');
}

function iamJwksUrl(): string {
  const override = process.env.IAM_JWKS_URL;
  if (override) return override;
  return `${iamBaseUrl()}/.well-known/jwks.json`;
}

// Module-scope JWKS resolver — jose handles key rotation + caching.
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
export function getJWKS() {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(new URL(iamJwksUrl()));
  }
  return _jwks;
}

export interface SessionResult {
  valid: boolean;
  userId?: string;
  role?: 'free' | 'pro';
  email?: string;
  name?: string;
  owner?: string;
}

function parsePlan(payload: Record<string, unknown>): 'free' | 'pro' {
  const plan = (payload.plan ?? payload.subscription) as unknown;
  if (plan === 'pro') return 'pro';
  const tier = payload.tier;
  if (typeof tier === 'number' && tier >= 1) return 'pro';
  return 'free';
}

export function getIamJwtVerifyOptions() {
  return {
    issuer: iamBaseUrl(),
    algorithms: ['RS256'],
  };
}

/**
 * Validate an IAM-issued bearer token.
 * Returns { valid: false } for invalid/expired/unverifiable tokens.
 */
export async function validateBearerToken(token: string): Promise<SessionResult> {
  const jwks = getJWKS();
  try {
    const { payload } = await jwtVerify(token, jwks, getIamJwtVerifyOptions());
    const userId = typeof payload.sub === 'string' && payload.sub
      ? payload.sub
      : (typeof payload.name === 'string' ? payload.name : undefined);
    if (!userId) return { valid: false };

    const result: SessionResult = {
      valid: true,
      userId,
      role: parsePlan(payload as Record<string, unknown>),
    };
    if (typeof payload.email === 'string') result.email = payload.email;
    if (typeof payload.owner === 'string') result.owner = payload.owner;
    const given = typeof payload.given_name === 'string' ? payload.given_name : undefined;
    const family = typeof payload.family_name === 'string' ? payload.family_name : undefined;
    const nameClaim = typeof payload.name === 'string' ? payload.name : undefined;
    const name = [given, family].filter(Boolean).join(' ') || nameClaim || undefined;
    if (name) result.name = name;
    return result;
  } catch {
    return { valid: false };
  }
}
