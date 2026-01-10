#!/usr/bin/env node
/**
 * AIS WebSocket Relay Server
 * Proxies aisstream.io data to the browser via a local WebSocket
 * Run: node scripts/ais-relay.js
 */

const { WebSocketServer, WebSocket } = require('ws');

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const API_KEY = process.env.VITE_AISSTREAM_API_KEY;

if (!API_KEY) {
  console.error('[Relay] Error: VITE_AISSTREAM_API_KEY environment variable not set');
  console.error('[Relay] Get a free key at https://aisstream.io');
  process.exit(1);
}
const LOCAL_PORT = 3004;

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

// Start local WebSocket server for browser clients
const wss = new WebSocketServer({ port: LOCAL_PORT });

wss.on('listening', () => {
  console.log(`[Relay] Server listening on ws://localhost:${LOCAL_PORT}`);
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

console.log(`[Relay] Starting AIS relay on port ${LOCAL_PORT}...`);
