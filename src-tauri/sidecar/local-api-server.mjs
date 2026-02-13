#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const port = Number(process.env.LOCAL_API_PORT || 46123);
const remoteBase = (process.env.LOCAL_API_REMOTE_BASE || 'https://worldmonitor.app').replace(/\/$/, '');
const resourceDir = process.env.LOCAL_API_RESOURCE_DIR || process.cwd();
const apiDir = path.join(resourceDir, 'api');
const mode = process.env.LOCAL_API_MODE || 'desktop-sidecar';

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function toHeaders(nodeHeaders) {
  const headers = new Headers();
  Object.entries(nodeHeaders).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach(v => headers.append(key, v));
    } else if (typeof value === 'string') {
      headers.set(key, value);
    }
  });
  return headers;
}

function endpointFromPath(pathname) {
  return pathname.replace(/^\/api\//, '').replace(/\/$/, '') || 'index';
}

async function handleServiceStatus() {
  return json({
    success: true,
    timestamp: new Date().toISOString(),
    summary: { operational: 2, degraded: 0, outage: 0, unknown: 0 },
    services: [
      { id: 'local-api', name: 'Local Desktop API', category: 'dev', status: 'operational', description: `Running on 127.0.0.1:${port}` },
      { id: 'cloud-pass-through', name: 'Cloud pass-through', category: 'cloud', status: 'operational', description: `Fallback target ${remoteBase}` },
    ],
    local: { enabled: true, mode, port, remoteBase },
  });
}

async function proxyToCloud(requestUrl, req) {
  const target = `${remoteBase}${requestUrl.pathname}${requestUrl.search}`;
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
  const upstream = await fetch(target, {
    method: req.method,
    headers: toHeaders(req.headers),
    body,
  });
  return upstream;
}

async function dispatch(requestUrl, req) {
  if (requestUrl.pathname === '/api/service-status') {
    return handleServiceStatus();
  }
  if (requestUrl.pathname === '/api/local-status') {
    return json({ success: true, mode, port, apiDir, remoteBase });
  }

  const endpoint = endpointFromPath(requestUrl.pathname);
  const modulePath = path.join(apiDir, `${endpoint}.js`);

  if (!existsSync(modulePath)) {
    return proxyToCloud(requestUrl, req);
  }

  try {
    const mod = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);
    if (typeof mod.default !== 'function') {
      return json({ error: `Invalid handler for ${endpoint}` }, 500);
    }

    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
    const request = new Request(requestUrl.toString(), {
      method: req.method,
      headers: toHeaders(req.headers),
      body,
    });

    return await mod.default(request);
  } catch (error) {
    console.error('[local-api] handler failed, using cloud fallback', endpoint, error);
    try {
      return await proxyToCloud(requestUrl, req);
    } catch {
      return json({ error: 'Local handler failed and cloud fallback unavailable' }, 502);
    }
  }
}

createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);

  if (!requestUrl.pathname.startsWith('/api/')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  try {
    const response = await dispatch(requestUrl, req);
    const body = Buffer.from(await response.arrayBuffer());
    const headers = Object.fromEntries(response.headers.entries());
    res.writeHead(response.status, headers);
    res.end(body);
  } catch (error) {
    console.error('[local-api] fatal', error);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`[local-api] listening on http://127.0.0.1:${port} (apiDir=${apiDir})`);
});
