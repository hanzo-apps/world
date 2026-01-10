#!/usr/bin/env node
/**
 * AIS WebSocket Relay Server + Static File Server
 * Serves frontend and proxies aisstream.io data via WebSocket
 *
 * Deploy on Railway with:
 *   AISSTREAM_API_KEY=your_key
 *
 * Local: node scripts/ais-relay.cjs
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const API_KEY = process.env.AISSTREAM_API_KEY || process.env.VITE_AISSTREAM_API_KEY;
const PORT = process.env.PORT || 3004;
const DIST_DIR = path.join(__dirname, '..', 'dist');

if (!API_KEY) {
  console.error('[Relay] Error: AISSTREAM_API_KEY environment variable not set');
  console.error('[Relay] Get a free key at https://aisstream.io');
  process.exit(1);
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// HTTP server for static files + health check
const server = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      clients: clients.size,
      messages: messageCount,
      connected: upstreamSocket?.readyState === WebSocket.OPEN
    }));
    return;
  }

  // Serve static files from dist/
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(DIST_DIR, filePath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: serve index.html for client-side routing
      fs.readFile(path.join(DIST_DIR, 'index.html'), (err2, indexData) => {
        if (err2) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(indexData);
      });
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

let upstreamSocket = null;
let clients = new Set();
let messageCount = 0;

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
    if (messageCount % 100 === 0) {
      console.log(`[Relay] Received ${messageCount} messages, ${clients.size} clients connected`);
    }
    // Broadcast to all connected browser clients
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  });

  upstreamSocket.on('close', () => {
    console.log('[Relay] Disconnected from aisstream.io, reconnecting in 5s...');
    setTimeout(connectUpstream, 5000);
  });

  upstreamSocket.on('error', (err) => {
    console.error('[Relay] Upstream error:', err.message);
  });
}

// Start WebSocket server attached to HTTP server
const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log(`[Relay] Server listening on port ${PORT}`);
});

wss.on('error', (err) => {
  console.error('[Relay] Server error:', err.message);
});

wss.on('connection', (ws, req) => {
  console.log('[Relay] Client connected from:', req.socket.remoteAddress);
  clients.add(ws);

  // Connect to upstream if not already connected
  connectUpstream();

  ws.on('close', () => {
    console.log('[Relay] Client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('[Relay] Client error:', err.message);
  });
});

console.log(`[Relay] Starting AIS relay on port ${PORT}...`);
