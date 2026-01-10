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

// HTTP server for health checks
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      clients: clients.size,
      messages: messageCount,
      connected: upstreamSocket?.readyState === WebSocket.OPEN
    }));
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
