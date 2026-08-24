// Org + project scoping for Hanzo World.
//
// The active ORG is owned by iam.ts (the single tenant-context source of truth:
// localStorage `hanzo_iam_org`, stamped as `X-Org-Id`). This module layers the
// per-org PROJECT selection on top and composes the scoped headers world sends to
// api.hanzo.ai — `X-Org-Id` + `X-Project-Id`, exactly what the cloud gateway
// reads (hanzo/cloud/middleware_identity.go). Org/project LISTS come from IAM's
// organization and project collections; the gateway re-pins a normal bearer to
// its own owner, so switching is safe — only a global admin crosses orgs.

import {
  getToken,
  getActiveOrg,
  homeOrg,
  isOrgScopedAway,
  listOrgs,
  orgHeaders,
  iamIssuer,
} from './iam';

const PROJECT_KEY = 'hanzo_iam_project'; // active project, per-org: `${org}:${project}`

// IAM's project collection. The listing is owner-scoped by IAM itself: `owner`
// names which org to read and IAM refuses one the caller does not belong to, so
// an omitted owner reads the caller's own.
const IAM_PROJECTS = '/v1/iam/projects';

export interface Project {
  id: string;   // canonical project id (IAM project name)
  name: string; // human label
}

export interface OrgOption {
  id: string;    // canonical org id (IAM org name)
  name: string;  // human label (displayName)
  logo?: string; // org logo URL (IAM `logo`); undefined when unset
}

export interface OrgScope {
  orgs: OrgOption[];
  homeOrg: string;
  currentOrg: string;
  projects: Project[];
  currentProject: string;
  isScopedAway: boolean;
}

const DEFAULT_PROJECT: Project = { id: 'default', name: 'Default' };

export function currentProject(org: string): string {
  try {
    return localStorage.getItem(`${PROJECT_KEY}:${org}`) || DEFAULT_PROJECT.id;
  } catch {
    return DEFAULT_PROJECT.id;
  }
}

export function setCurrentProject(org: string, project: string): void {
  try {
    localStorage.setItem(`${PROJECT_KEY}:${org}`, project);
  } catch { /* private mode */ }
}

// api.hanzo.ai for prod hosts; same-origin for local dev where a proxy fronts it.
export function apiBase(): string {
  const h = typeof location !== 'undefined' ? location.hostname : '';
  if (h === 'localhost' || h === '127.0.0.1') return '';
  return 'https://api.hanzo.ai';
}

/**
 * Projects for an org from IAM's project collection. Degrades to a single Default
 * project when the endpoint is unreachable/empty, so the switcher is always
 * usable — and says so, because a lone "Default" is what a real one-project org
 * looks like too.
 */
export async function listProjects(org: string): Promise<Project[]> {
  if (!org) return [DEFAULT_PROJECT];
  try {
    const tok = await getToken();
    if (!tok) return [DEFAULT_PROJECT];
    const u = new URL(`${iamIssuer}${IAM_PROJECTS}`);
    u.searchParams.set('owner', org);
    const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) {
      console.warn(`[org-scope] ${IAM_PROJECTS} answered ${r.status} for ${org}; showing Default only`);
      return [DEFAULT_PROJECT];
    }
    const data = await r.json();
    const arr: unknown[] = Array.isArray(data?.projects) ? data.projects : [];
    const list: Project[] = arr
      .map((p) => {
        const rec = p as { name?: unknown; displayName?: unknown };
        const id = String(rec?.name ?? '');
        return { id, name: String(rec?.displayName ?? id) };
      })
      .filter((p) => p.id);
    return list.length ? list : [DEFAULT_PROJECT];
  } catch (err) {
    console.warn(`[org-scope] ${IAM_PROJECTS} unreachable for ${org}; showing Default only:`, err);
    return [DEFAULT_PROJECT];
  }
}

/** Resolve the full scope for rendering the switcher. Null when signed out. */
export async function resolveScope(): Promise<OrgScope | null> {
  const orgInfos = await listOrgs();
  const home = homeOrg();
  if (!home && orgInfos.length === 0) return null;
  const orgs: OrgOption[] = orgInfos.map((o) => ({ id: o.name, name: o.displayName || o.name, logo: o.logo }));
  const cur = getActiveOrg() || home || orgs[0]?.id || '';
  const projects = await listProjects(cur);
  const proj = currentProject(cur);
  const known = projects.some((p) => p.id === proj) ? proj : projects[0]?.id || DEFAULT_PROJECT.id;
  return {
    orgs,
    homeOrg: home,
    currentOrg: cur,
    projects,
    currentProject: known,
    isScopedAway: isOrgScopedAway(),
  };
}

/** Scoped headers for an api.hanzo.ai /v1 call: bearer + active org + project. */
export async function scopedHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const org = getActiveOrg();
  return orgHeaders({ 'X-Project-Id': currentProject(org), ...extra });
}
