import { isAuthenticated, orgHeaders } from '@/services/iam';
import { isDesktopRuntime, getRemoteApiBaseUrl } from '@/services/runtime';

// Model-improvement consent — the ONE client path to the opt-in that actually lives
// in ai's OrgSettings.TrainingContribution (the single source of truth the automated
// judge + the router trainer read). Served same-origin by world's Go proxy
// (/v1/world/training-contribution → ai get-/update-training-contribution), which
// forwards the caller's org-scoped bearer; ai self-scopes to the caller's OWN org.
//
// Privacy-safe by construction: a signed-out caller, an org that never opted in, or
// ANY error all read `false` (OFF). Turning it on only lets an automated judge score
// response QUALITY into a scalar reward — prompts/outputs are never stored.

function base(): string {
  return isDesktopRuntime() ? getRemoteApiBaseUrl() : '';
}

/** The caller's own-org opt-in. Returns false when signed out or on any failure —
 *  the privacy-safe default OFF, so a broken read never implies consent. */
export async function getTrainingContribution(): Promise<boolean> {
  if (!isAuthenticated()) return false;
  try {
    const res = await fetch(`${base()}/v1/world/training-contribution`, { headers: await orgHeaders() });
    if (!res.ok) return false;
    const data = (await res.json()) as { enabled?: boolean };
    return data.enabled === true;
  } catch {
    return false;
  }
}

/** Set the caller's own-org opt-in and return the RESOLVED state. Throws on failure
 *  so the toggle can revert and surface an error rather than silently claiming a
 *  state the server never accepted. */
export async function setTrainingContribution(enabled: boolean): Promise<boolean> {
  const res = await fetch(`${base()}/v1/world/training-contribution`, {
    method: 'POST',
    headers: await orgHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(`training-contribution ${res.status}`);
  const data = (await res.json()) as { enabled?: boolean };
  return data.enabled === true;
}
