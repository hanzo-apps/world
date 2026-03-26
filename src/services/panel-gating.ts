import type { AuthSession } from './auth-state';
import { isDesktopRuntime } from './runtime';
import { getSecretState } from './runtime-config';

export enum PanelGateReason {
  NONE = 'none',           // show content (pro user, or desktop with API key, or non-premium panel)
  ANONYMOUS = 'anonymous', // "Sign In to Unlock"
  FREE_TIER = 'free_tier', // "Upgrade to Pro"
}

/**
 * Determine gating reason for a premium panel given current auth state.
 * Desktop with valid API key always bypasses auth gating (backward compat).
 * Non-premium panels always return NONE.
 */
export function getPanelGateReason(
  authState: AuthSession,
  isPremium: boolean,
): PanelGateReason {
  // Non-premium panels are never gated
  if (!isPremium) return PanelGateReason.NONE;

  // Desktop with API key: always unlocked (backward compat)
  if (isDesktopRuntime() && getSecretState('WORLDMONITOR_API_KEY').present) {
    return PanelGateReason.NONE;
  }

  // Web gating based on auth state
  if (!authState.user) return PanelGateReason.ANONYMOUS;
  if (authState.user.role !== 'pro') return PanelGateReason.FREE_TIER;
  return PanelGateReason.NONE;
}
