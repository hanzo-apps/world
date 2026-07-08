// Org + project scoping for Hanzo World. Active org/project are CLIENT-SIDE
// values (localStorage), stamped as X-Org-Id / X-Project-Id on scoped API calls
// to api.hanzo.ai/v1/world. The cloud gateway re-pins a normal bearer to its own
// `owner` server-side, so switching is safe: only a global admin may cross orgs.
//
// Org list = the user's home org (owner claim) plus any org-like groups. A
// normal IAM user belongs to exactly one org; the switcher still renders so the
// active org/project is always visible and projects are selectable.

import { getToken, getUser, type IamUser } from './iam';

const ORG_KEY = 'hanzo.world.org';       // active org (blank/absent => home org)
const PROJECT_KEY = 'hanzo.world.project'; // active project, per-org: `${org}:${project}`

export interface Project {
  id: string;
  name: string;
}

export interface OrgScope {
  orgs: string[];
  homeOrg: string;
  currentOrg: string;
  projects: Project[];
  currentProject: string;
  isScopedAway: boolean;
}

const DEFAULT_PROJECT: Project = { id: 'default', name: 'Default' };

/** Derive the org list from the token: home org (owner) + org-like groups. */
export function orgsFromUser(user: IamUser | null): { orgs: string[]; home: string } {
  if (!user) return { orgs: [], home: '' };
  const home = user.owner || user.sub?.split('/')[0] || '';
  const set = new Set<string>();
  if (home) set.add(home);
  // Casdoor group form is "org/group"; the leading segment is an org the user is in.
  for (const g of user.groups || []) {
    const org = g.includes('/') ? g.split('/')[0] : g;
    if (org && org !== 'admin') set.add(org);
  }
  return { orgs: [...set], home };
}

export function currentOrg(homeOrg: string): string {
  return localStorage.getItem(ORG_KEY) || homeOrg;
}

export function setCurrentOrg(org: string, homeOrg: string): void {
  if (!org || org === homeOrg) localStorage.removeItem(ORG_KEY);
  else localStorage.setItem(ORG_KEY, org);
}

export function isScopedAway(homeOrg: string): boolean {
  const cur = localStorage.getItem(ORG_KEY);
  return !!cur && cur !== homeOrg;
}

export function currentProject(org: string): string {
  return localStorage.getItem(`${PROJECT_KEY}:${org}`) || DEFAULT_PROJECT.id;
}

export function setCurrentProject(org: string, project: string): void {
  localStorage.setItem(`${PROJECT_KEY}:${org}`, project);
}

/**
 * Fetch the projects for an org from the cloud world backend. Degrades to the
 * single Default project when the backend is unreachable or returns nothing,
 * so the switcher is always usable (Task 3 backfills the real list).
 */
export async function listProjects(org: string): Promise<Project[]> {
  try {
    const tok = await getToken();
    if (!tok) return [DEFAULT_PROJECT];
    const r = await fetch(`${apiBase()}/v1/world/projects`, {
      headers: { Authorization: `Bearer ${tok}`, 'X-Org-Id': org },
    });
    if (!r.ok) return [DEFAULT_PROJECT];
    const data = await r.json();
    const list: Project[] = Array.isArray(data?.projects) ? data.projects : [];
    return list.length ? list : [DEFAULT_PROJECT];
  } catch {
    return [DEFAULT_PROJECT];
  }
}

/** Resolve the full scope for rendering the switcher. */
export async function resolveScope(): Promise<OrgScope | null> {
  const user = await getUser();
  if (!user) return null;
  const { orgs, home } = orgsFromUser(user);
  const cur = currentOrg(home);
  const projects = await listProjects(cur);
  const proj = currentProject(cur);
  const known = projects.some((p) => p.id === proj) ? proj : projects[0]?.id || DEFAULT_PROJECT.id;
  return {
    orgs,
    homeOrg: home,
    currentOrg: cur,
    projects,
    currentProject: known,
    isScopedAway: isScopedAway(home),
  };
}

// api.hanzo.ai for prod hosts; same-origin for local dev where a proxy fronts it.
export function apiBase(): string {
  const h = typeof location !== 'undefined' ? location.hostname : '';
  if (h === 'localhost' || h === '127.0.0.1') return '';
  return 'https://api.hanzo.ai';
}

/** Scoped headers for a /v1/world call: bearer + active org/project. */
export async function scopedHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const user = await getUser();
  const { home } = orgsFromUser(user);
  const org = currentOrg(home);
  const tok = await getToken();
  const h: Record<string, string> = { 'X-Org-Id': org, 'X-Project-Id': currentProject(org), ...extra };
  if (tok) h.Authorization = `Bearer ${tok}`;
  return h;
}
