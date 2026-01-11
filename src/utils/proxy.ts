const isDev = import.meta.env.DEV;

// In production, use Vercel serverless proxies
// In dev, use Vite proxy (configured in vite.config.ts)

export function proxyUrl(localPath: string): string {
  // In dev mode, return local path as-is (Vite proxy handles it)
  if (isDev) {
    return localPath;
  }

  // In production, paths are handled by Vercel serverless functions
  // No need for external CORS proxy
  return localPath;
}

export async function fetchWithProxy(url: string): Promise<Response> {
  return fetch(url);
}
