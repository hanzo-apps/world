import { isDesktopRuntime, toRuntimeUrl } from '../services/runtime';

const isDev = import.meta.env.DEV;

// In production browser deployments, routes are handled by Vercel serverless functions.
// In local dev, Vite proxy handles these routes.
// In Tauri desktop mode, route requests need an absolute remote host.
export function proxyUrl(localPath: string): string {
  if (isDesktopRuntime()) {
    return toRuntimeUrl(localPath);
  }

  if (isDev) {
    return localPath;
  }

  return localPath;
}

// Default network deadline. A stalled connection (server accepts but never
// answers, or a mid-body stall) must never hold a panel on an eternal spinner —
// every data fetch has a hard ceiling so a panel always resolves to data or an
// honest empty note.
export const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

// fetch with a hard timeout. Aborts the request (freeing the socket) when the
// deadline passes; callers see a rejected promise they can degrade on. If the
// caller supplies its own signal it wins — we only install ours when absent.
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  if (init.signal) return fetch(input, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWithProxy(
  url: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  return fetchWithTimeout(proxyUrl(url), init, timeoutMs);
}
