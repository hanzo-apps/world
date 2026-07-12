import { isAuthenticated, orgHeaders } from '@/services/iam';
import { isDesktopRuntime, getRemoteApiBaseUrl } from '@/services/runtime';
import { saveToStorage, loadFromStorage } from '@/utils';
import { STORAGE_KEYS } from '@/config';
import type { Monitor } from '@/types';

// Monitor sync — the ONE path between the monitor list and where it lives.
//
// Signed in, the Go backend owns monitors: the list is persisted per identity
// (so it follows you across devices) and matching runs against the LAKE — every
// item the backend ingested, not just the headlines this tab happened to load.
// Signed out, everything stays in localStorage exactly as before.
//
// localStorage is written in BOTH cases: it is the offline mirror, so a reload
// paints instantly and a dropped network never loses your monitors.

export interface MonitorMatch {
  monitorId: string;
  color?: string;
  keyword: string;
  title: string;
  link: string;
  source: string;
  ts: string;
}

function base(): string {
  return isDesktopRuntime() ? getRemoteApiBaseUrl() : '';
}

/** Monitors for this user: the server's list when signed in, else the local one. */
export async function loadMonitors(): Promise<Monitor[]> {
  const local = loadFromStorage<Monitor[]>(STORAGE_KEYS.monitors, []);
  if (!isAuthenticated()) return local;
  try {
    const res = await fetch(`${base()}/v1/world/monitors`, { headers: await orgHeaders() });
    if (!res.ok) return local;
    const data = (await res.json()) as { monitors?: Monitor[] };
    const server = data.monitors ?? [];
    // First sign-in with local monitors and an empty server list: adopt the local
    // ones rather than silently dropping them.
    if (server.length === 0 && local.length > 0) {
      void saveMonitors(local);
      return local;
    }
    saveToStorage(STORAGE_KEYS.monitors, server);
    return server;
  } catch {
    return local;
  }
}

/** Persist the list. Always local; also server-side when signed in. */
export async function saveMonitors(monitors: Monitor[]): Promise<void> {
  saveToStorage(STORAGE_KEYS.monitors, monitors);
  if (!isAuthenticated()) return;
  try {
    await fetch(`${base()}/v1/world/monitors`, {
      method: 'PUT',
      headers: await orgHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ monitors }),
    });
  } catch {
    /* offline — localStorage already has it; the next save re-syncs */
  }
}

/**
 * Matches from the backend, across the whole lake. Returns null when the caller
 * is signed out (or the server is unreachable) so the caller can fall back to
 * matching over the headlines it has loaded.
 */
export async function fetchMonitorMatches(): Promise<MonitorMatch[] | null> {
  if (!isAuthenticated()) return null;
  try {
    const res = await fetch(`${base()}/v1/world/monitors/matches`, { headers: await orgHeaders() });
    if (!res.ok) return null;
    const data = (await res.json()) as { matches?: MonitorMatch[] };
    return data.matches ?? [];
  } catch {
    return null;
  }
}
