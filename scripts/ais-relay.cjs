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
      connected: upstreamSocket?.readyState === WebSocket.OPEN
    }));
  } else if (req.url.startsWith('/rss')) {
    // Proxy RSS feeds that block Vercel IPs
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const feedUrl = url.searchParams.get('url');

      if (!feedUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Missing url parameter' }));
      }

      // Only allow specific blocked domains
      const allowedDomains = [
        'rss.cnn.com',
        'www.defensenews.com',
        'layoffs.fyi',
        'news.un.org',
        'www.cisa.gov',
      ];
      const parsed = new URL(feedUrl);
      if (!allowedDomains.includes(parsed.hostname)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Domain not allowed on Railway proxy' }));
      }

      console.log('[Relay] RSS request:', feedUrl);

      const https = require('https');
      const request = https.get(feedUrl, {
        headers: {
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 15000
      }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          res.writeHead(response.statusCode, {
            'Content-Type': 'application/xml',
            'Cache-Control': 'public, max-age=300'
          });
          res.end(data);
        });
      });

      request.on('error', (err) => {
        console.error('[Relay] RSS error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });

      request.on('timeout', () => {
        request.destroy();
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request timeout' }));
      });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (req.url.startsWith('/opensky')) {
    // Proxy OpenSky API requests (Vercel is blocked, Railway isn't)
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const params = url.searchParams;

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
          'User-Agent': 'WorldMonitor/1.0'
        },
        timeout: 15000
      }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
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
  } else {
    res.writeHead(404);
    res.end();
  }
});

function connectUpstream() {
  if (upstreamSocket?.readyState === WebSocket.OPEN) return;

  console.log('[Relay] Connecting to aisstream.io...');
  upstreamSocket = new WebSocket(AISSTREAM_URL);

  upstreamSocket.on('open', () => {
    console.log('[Relay] Connected to aisstream.io');
    upstreamSocket.send(JSON.stringify({
      APIKey: API_KEY,
      BoundingBoxes: [[[-90, -180], [90, 180]]],
      FilterMessageTypes: ['PositionReport'],
    }));
  });

  upstreamSocket.on('message', (data) => {
    messageCount++;
    if (messageCount % 1000 === 0) {
      console.log(`[Relay] ${messageCount} messages, ${clients.size} clients`);
    }
    const message = data.toString();
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  });

  upstreamSocket.on('close', () => {
    console.log('[Relay] Disconnected, reconnecting in 5s...');
    setTimeout(connectUpstream, 5000);
  });

  upstreamSocket.on('error', (err) => {
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
