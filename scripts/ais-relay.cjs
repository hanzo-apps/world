#!/usr/bin/env node
/**
 * AIS WebSocket Relay Server
 * Proxies aisstream.io data to browsers via WebSocket
 *
 * Deploy on Railway with:
 *   AISSTREAM_API_KEY=your_key
 *
 * Local: node scripts/ais-relay.cjs
 */

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const API_KEY = process.env.AISSTREAM_API_KEY || process.env.VITE_AISSTREAM_API_KEY;
const PORT = process.env.PORT || 3004;

if (!API_KEY) {
  console.error('[Relay] Error: AISSTREAM_API_KEY environment variable not set');
  console.error('[Relay] Get a free key at https://aisstream.io');
  process.exit(1);
}

let upstreamSocket = null;
let clients = new Set();
let messageCount = 0;

// AIS aggregate state for snapshot API (server-side fanout)
const GRID_SIZE = 2;
const DENSITY_WINDOW = 30 * 60 * 1000; // 30 minutes
const GAP_THRESHOLD = 60 * 60 * 1000; // 1 hour
const SNAPSHOT_INTERVAL_MS = Math.max(2000, Number(process.env.AIS_SNAPSHOT_INTERVAL_MS || 5000));
const CANDIDATE_RETENTION_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_DENSITY_ZONES = 200;
const MAX_CANDIDATE_REPORTS = 1500;

const vessels = new Map();
const vesselHistory = new Map();
const densityGrid = new Map();
const candidateReports = new Map();

let snapshotSequence = 0;
let lastSnapshot = null;
let lastSnapshotAt = 0;

const CHOKEPOINTS = [
  { name: 'Strait of Hormuz', lat: 26.5, lon: 56.5, radius: 2 },
  { name: 'Suez Canal', lat: 30.0, lon: 32.5, radius: 1 },
  { name: 'Strait of Malacca', lat: 2.5, lon: 101.5, radius: 2 },
  { name: 'Bab el-Mandeb', lat: 12.5, lon: 43.5, radius: 1.5 },
  { name: 'Panama Canal', lat: 9.0, lon: -79.5, radius: 1 },
  { name: 'Taiwan Strait', lat: 24.5, lon: 119.5, radius: 2 },
  { name: 'South China Sea', lat: 15.0, lon: 115.0, radius: 5 },
  { name: 'Black Sea', lat: 43.5, lon: 34.0, radius: 3 },
];

const NAVAL_PREFIX_RE = /^(USS|USNS|HMS|HMAS|HMCS|INS|JS|ROKS|TCG|FS|BNS|RFS|PLAN|PLA|CGC|PNS|KRI|ITS|SNS|MMSI)/i;

function getGridKey(lat, lon) {
  const gridLat = Math.floor(lat / GRID_SIZE) * GRID_SIZE;
  const gridLon = Math.floor(lon / GRID_SIZE) * GRID_SIZE;
  return `${gridLat},${gridLon}`;
}

function isLikelyMilitaryCandidate(meta) {
  const mmsi = String(meta?.MMSI || '');
  const shipType = Number(meta?.ShipType);
  const name = (meta?.ShipName || '').trim().toUpperCase();

  if (Number.isFinite(shipType) && (shipType === 35 || shipType === 55 || (shipType >= 50 && shipType <= 59))) {
    return true;
  }

  if (name && NAVAL_PREFIX_RE.test(name)) return true;

  if (mmsi.length >= 9) {
    const suffix = mmsi.substring(3);
    if (suffix.startsWith('00') || suffix.startsWith('99')) return true;
  }

  return false;
}

function processPositionReportForSnapshot(data) {
  const meta = data?.MetaData;
  const pos = data?.Message?.PositionReport;
  if (!meta || !pos) return;

  const mmsi = String(meta.MMSI || '');
  if (!mmsi) return;

  const lat = Number.isFinite(pos.Latitude) ? pos.Latitude : meta.latitude;
  const lon = Number.isFinite(pos.Longitude) ? pos.Longitude : meta.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  const now = Date.now();

  vessels.set(mmsi, {
    mmsi,
    name: meta.ShipName || '',
    lat,
    lon,
    timestamp: now,
    shipType: meta.ShipType,
    heading: pos.TrueHeading,
    speed: pos.Sog,
    course: pos.Cog,
  });

  const history = vesselHistory.get(mmsi) || [];
  history.push(now);
  if (history.length > 10) history.shift();
  vesselHistory.set(mmsi, history);

  const gridKey = getGridKey(lat, lon);
  let cell = densityGrid.get(gridKey);
  if (!cell) {
    cell = {
      lat: Math.floor(lat / GRID_SIZE) * GRID_SIZE + GRID_SIZE / 2,
      lon: Math.floor(lon / GRID_SIZE) * GRID_SIZE + GRID_SIZE / 2,
      vessels: new Set(),
      lastUpdate: now,
      previousCount: 0,
    };
    densityGrid.set(gridKey, cell);
  }
  cell.vessels.add(mmsi);
  cell.lastUpdate = now;

  if (isLikelyMilitaryCandidate(meta)) {
    candidateReports.set(mmsi, {
      mmsi,
      name: meta.ShipName || '',
      lat,
      lon,
      shipType: meta.ShipType,
      heading: pos.TrueHeading,
      speed: pos.Sog,
      course: pos.Cog,
      timestamp: now,
    });
  }
}

function cleanupAggregates() {
  const now = Date.now();
  const cutoff = now - DENSITY_WINDOW;

  for (const [mmsi, vessel] of vessels) {
    if (vessel.timestamp < cutoff) {
      vessels.delete(mmsi);
    }
  }

  for (const [mmsi, history] of vesselHistory) {
    const filtered = history.filter((ts) => ts >= cutoff);
    if (filtered.length === 0) {
      vesselHistory.delete(mmsi);
    } else {
      vesselHistory.set(mmsi, filtered);
    }
  }

  for (const [key, cell] of densityGrid) {
    cell.previousCount = cell.vessels.size;

    for (const mmsi of cell.vessels) {
      const vessel = vessels.get(mmsi);
      if (!vessel || vessel.timestamp < cutoff) {
        cell.vessels.delete(mmsi);
      }
    }

    if (cell.vessels.size === 0 && now - cell.lastUpdate > DENSITY_WINDOW * 2) {
      densityGrid.delete(key);
    }
  }

  for (const [mmsi, report] of candidateReports) {
    if (report.timestamp < now - CANDIDATE_RETENTION_MS) {
      candidateReports.delete(mmsi);
    }
  }
}

function detectDisruptions() {
  const disruptions = [];
  const now = Date.now();

  for (const chokepoint of CHOKEPOINTS) {
    let vesselCount = 0;

    for (const vessel of vessels.values()) {
      const distance = Math.sqrt(
        Math.pow(vessel.lat - chokepoint.lat, 2) +
        Math.pow(vessel.lon - chokepoint.lon, 2)
      );
      if (distance <= chokepoint.radius) {
        vesselCount++;
      }
    }

    if (vesselCount >= 5) {
      const normalTraffic = chokepoint.radius * 10;
      const severity = vesselCount > normalTraffic * 1.5
        ? 'high'
        : vesselCount > normalTraffic
          ? 'elevated'
          : 'low';

      disruptions.push({
        id: `chokepoint-${chokepoint.name.toLowerCase().replace(/\s+/g, '-')}`,
        name: chokepoint.name,
        type: 'chokepoint_congestion',
        lat: chokepoint.lat,
        lon: chokepoint.lon,
        severity,
        changePct: normalTraffic > 0 ? Math.round((vesselCount / normalTraffic - 1) * 100) : 0,
        windowHours: 1,
        vesselCount,
        region: chokepoint.name,
        description: `${vesselCount} vessels in ${chokepoint.name}`,
      });
    }
  }

  let darkShipCount = 0;
  for (const history of vesselHistory.values()) {
    if (history.length >= 2) {
      const lastSeen = history[history.length - 1];
      const secondLast = history[history.length - 2];
      if (lastSeen - secondLast > GAP_THRESHOLD && now - lastSeen < 10 * 60 * 1000) {
        darkShipCount++;
      }
    }
  }

  if (darkShipCount >= 1) {
    disruptions.push({
      id: 'global-gap-spike',
      name: 'AIS Gap Spike Detected',
      type: 'gap_spike',
      lat: 0,
      lon: 0,
      severity: darkShipCount > 20 ? 'high' : darkShipCount > 10 ? 'elevated' : 'low',
      changePct: darkShipCount * 10,
      windowHours: 1,
      darkShips: darkShipCount,
      description: `${darkShipCount} vessels returned after extended AIS silence`,
    });
  }

  return disruptions;
}

function calculateDensityZones() {
  const zones = [];
  const allCells = Array.from(densityGrid.values()).filter((c) => c.vessels.size >= 2);
  if (allCells.length === 0) return zones;

  const vesselCounts = allCells.map((c) => c.vessels.size);
  const maxVessels = Math.max(...vesselCounts);
  const minVessels = Math.min(...vesselCounts);

  for (const [key, cell] of densityGrid) {
    if (cell.vessels.size < 2) continue;

    const logMax = Math.log(maxVessels + 1);
    const logMin = Math.log(minVessels + 1);
    const logCurrent = Math.log(cell.vessels.size + 1);

    const intensity = logMax > logMin
      ? 0.2 + (0.8 * (logCurrent - logMin) / (logMax - logMin))
      : 0.5;

    const deltaPct = cell.previousCount > 0
      ? Math.round(((cell.vessels.size - cell.previousCount) / cell.previousCount) * 100)
      : 0;

    zones.push({
      id: `density-${key}`,
      name: `Zone ${key}`,
      lat: cell.lat,
      lon: cell.lon,
      intensity,
      deltaPct,
      shipsPerDay: cell.vessels.size * 48,
      note: cell.vessels.size >= 10 ? 'High traffic area' : undefined,
    });
  }

  return zones
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, MAX_DENSITY_ZONES);
}

function getCandidateReportsSnapshot() {
  return Array.from(candidateReports.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_CANDIDATE_REPORTS);
}

function buildSnapshot() {
  const now = Date.now();
  if (lastSnapshot && now - lastSnapshotAt < Math.floor(SNAPSHOT_INTERVAL_MS / 2)) {
    return lastSnapshot;
  }

  cleanupAggregates();
  snapshotSequence++;

  lastSnapshot = {
    sequence: snapshotSequence,
    timestamp: new Date(now).toISOString(),
    status: {
      connected: upstreamSocket?.readyState === WebSocket.OPEN,
      vessels: vessels.size,
      messages: messageCount,
      clients: clients.size,
    },
    disruptions: detectDisruptions(),
    density: calculateDensityZones(),
  };
  lastSnapshotAt = now;
  return lastSnapshot;
}

setInterval(() => {
  if (upstreamSocket?.readyState === WebSocket.OPEN || vessels.size > 0) {
    buildSnapshot();
  }
}, SNAPSHOT_INTERVAL_MS);

// OpenSky OAuth2 token cache
let openskyToken = null;
let openskyTokenExpiry = 0;

async function getOpenSkyToken() {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  // Return cached token if still valid (with 60s buffer)
  if (openskyToken && Date.now() < openskyTokenExpiry - 60000) {
    return openskyToken;
  }

  try {
    console.log('[Relay] Fetching new OpenSky OAuth2 token...');
    const https = require('https');

    return new Promise((resolve, reject) => {
      const postData = `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;

      const req = https.request({
        hostname: 'auth.opensky-network.org',
        port: 443,
        path: '/auth/realms/opensky-network/protocol/openid-connect/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 10000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.access_token) {
              openskyToken = json.access_token;
              // Token valid for 30 min, cache with expiry
              openskyTokenExpiry = Date.now() + (json.expires_in || 1800) * 1000;
              console.log('[Relay] OpenSky token acquired, expires in', json.expires_in, 'seconds');
              resolve(openskyToken);
            } else {
              console.error('[Relay] OpenSky token error:', json.error || 'Unknown');
              resolve(null);
            }
          } catch (e) {
            console.error('[Relay] OpenSky token parse error:', e.message);
            resolve(null);
          }
        });
      });

      req.on('error', (err) => {
        console.error('[Relay] OpenSky token request error:', err.message);
        resolve(null);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.write(postData);
      req.end();
    });
  } catch (err) {
    console.error('[Relay] OpenSky token error:', err.message);
    return null;
  }
}

async function handleOpenSkyRequest(req, res, PORT) {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const params = url.searchParams;

    const token = await getOpenSkyToken();
    if (!token) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'OpenSky not configured or auth failed', time: Date.now(), states: [] }));
      return;
    }

    let openskyUrl = 'https://opensky-network.org/api/states/all';
    const queryParams = [];
    for (const key of ['lamin', 'lomin', 'lamax', 'lomax']) {
      if (params.has(key)) queryParams.push(`${key}=${params.get(key)}`);
    }
    if (queryParams.length > 0) {
      openskyUrl += '?' + queryParams.join('&');
    }

    console.log('[Relay] OpenSky request:', openskyUrl);

    const https = require('https');
    const request = https.get(openskyUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'WorldMonitor/1.0',
        'Authorization': `Bearer ${token}`,
      },
      timeout: 15000
    }, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        // If 401, invalidate token cache
        if (response.statusCode === 401) {
          console.log('[Relay] OpenSky 401, invalidating token cache');
          openskyToken = null;
          openskyTokenExpiry = 0;
        }
        res.writeHead(response.statusCode, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=30'
        });
        res.end(data);
      });
    });

    request.on('error', (err) => {
      console.error('[Relay] OpenSky error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, time: Date.now(), states: null }));
    });

    request.on('timeout', () => {
      request.destroy();
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request timeout', time: Date.now(), states: null }));
    });
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message, time: Date.now(), states: null }));
  }
}

// HTTP server for health checks and OpenSky proxy
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      clients: clients.size,
      messages: messageCount,
      connected: upstreamSocket?.readyState === WebSocket.OPEN,
      vessels: vessels.size,
      densityZones: Array.from(densityGrid.values()).filter(c => c.vessels.size >= 2).length,
    }));
  } else if (req.url.startsWith('/ais/snapshot')) {
    // Aggregated AIS snapshot for server-side fanout
    connectUpstream();
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const includeCandidates = url.searchParams.get('candidates') === 'true';
    const snapshot = buildSnapshot();
    const payload = includeCandidates
      ? { ...snapshot, candidateReports: getCandidateReportsSnapshot() }
      : { ...snapshot, candidateReports: [] };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=2'
    });
    res.end(JSON.stringify(payload));
  } else if (req.url.startsWith('/rss')) {
    // Proxy RSS feeds that block Vercel IPs
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const feedUrl = url.searchParams.get('url');

      if (!feedUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Missing url parameter' }));
      }

      // Allow domains that block Vercel IPs (must match feeds.ts railwayRss usage)
      const allowedDomains = [
        // Original
        'rss.cnn.com',
        'www.defensenews.com',
        'layoffs.fyi',
        // International Organizations
        'news.un.org',
        'www.cisa.gov',
        'www.iaea.org',
        'www.who.int',
        'www.crisisgroup.org',
        // Middle East & Regional News
        'english.alarabiya.net',
        'www.arabnews.com',
        'www.timesofisrael.com',
        'www.scmp.com',
        'kyivindependent.com',
        'www.themoscowtimes.com',
        // Africa
        'feeds.24.com',
        'feeds.capi24.com',  // News24 redirect destination
      ];
      const parsed = new URL(feedUrl);
      if (!allowedDomains.includes(parsed.hostname)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Domain not allowed on Railway proxy' }));
      }

      console.log('[Relay] RSS request:', feedUrl);

      const https = require('https');
      const http = require('http');

      // Helper to fetch with redirect following (max 3 redirects)
      let responseHandled = false;

      const sendError = (statusCode, message) => {
        if (responseHandled || res.headersSent) return;
        responseHandled = true;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
      };

      const fetchWithRedirects = (url, redirectCount = 0) => {
        if (redirectCount > 3) {
          return sendError(502, 'Too many redirects');
        }

        const protocol = url.startsWith('https') ? https : http;
        const request = protocol.get(url, {
          headers: {
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          timeout: 15000
        }, (response) => {
          // Handle redirects
          if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
            const redirectUrl = response.headers.location.startsWith('http')
              ? response.headers.location
              : new URL(response.headers.location, url).href;
            console.log(`[Relay] Following redirect to: ${redirectUrl}`);
            return fetchWithRedirects(redirectUrl, redirectCount + 1);
          }

          // Handle gzip/deflate compressed responses from upstream
          const encoding = response.headers['content-encoding'];
          let stream = response;
          if (encoding === 'gzip' || encoding === 'deflate') {
            const zlib = require('zlib');
            stream = encoding === 'gzip' ? response.pipe(zlib.createGunzip()) : response.pipe(zlib.createInflate());
          }

          const chunks = [];
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => {
            if (responseHandled || res.headersSent) return;
            responseHandled = true;
            const data = Buffer.concat(chunks);
            res.writeHead(response.statusCode, {
              'Content-Type': 'application/xml',
              'Cache-Control': 'public, max-age=300'
            });
            res.end(data);
          });
          stream.on('error', (err) => {
            console.error('[Relay] Decompression error:', err.message);
            sendError(502, 'Decompression failed: ' + err.message);
          });
        });

        request.on('error', (err) => {
          console.error('[Relay] RSS error:', err.message);
          sendError(502, err.message);
        });

        request.on('timeout', () => {
          request.destroy();
          sendError(504, 'Request timeout');
        });
      };

      fetchWithRedirects(feedUrl);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  } else if (req.url.startsWith('/opensky')) {
    // Proxy OpenSky API requests with OAuth2 authentication
    // OpenSky requires OAuth2 client credentials flow for cloud IPs
    handleOpenSkyRequest(req, res, PORT);
  } else {
    res.writeHead(404);
    res.end();
  }
});

function connectUpstream() {
  // Skip if already connected or connecting
  if (upstreamSocket?.readyState === WebSocket.OPEN ||
      upstreamSocket?.readyState === WebSocket.CONNECTING) return;

  console.log('[Relay] Connecting to aisstream.io...');
  const socket = new WebSocket(AISSTREAM_URL);
  upstreamSocket = socket;

  socket.on('open', () => {
    // Verify this socket is still the current one (race condition guard)
    if (upstreamSocket !== socket) {
      console.log('[Relay] Stale socket open event, closing');
      socket.close();
      return;
    }
    console.log('[Relay] Connected to aisstream.io');
    socket.send(JSON.stringify({
      APIKey: API_KEY,
      BoundingBoxes: [[[-90, -180], [90, 180]]],
      FilterMessageTypes: ['PositionReport'],
    }));
  });

  socket.on('message', (data) => {
    if (upstreamSocket !== socket) return; // Stale socket
    messageCount++;
    if (messageCount % 1000 === 0) {
      console.log(`[Relay] ${messageCount} messages, ${clients.size} clients`);
    }
    const message = data.toString();
    try {
      const parsed = JSON.parse(message);
      if (parsed?.MessageType === 'PositionReport') {
        processPositionReportForSnapshot(parsed);
      }
    } catch {
      // Ignore malformed upstream payloads
    }

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  });

  socket.on('close', () => {
    if (upstreamSocket === socket) {
      upstreamSocket = null;
      console.log('[Relay] Disconnected, reconnecting in 5s...');
      setTimeout(connectUpstream, 5000);
    }
  });

  socket.on('error', (err) => {
    console.error('[Relay] Upstream error:', err.message);
  });
}

const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log(`[Relay] WebSocket relay on port ${PORT}`);
});

wss.on('connection', (ws, req) => {
  console.log('[Relay] Client connected');
  clients.add(ws);
  connectUpstream();

  ws.on('close', () => {
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('[Relay] Client error:', err.message);
  });
});
