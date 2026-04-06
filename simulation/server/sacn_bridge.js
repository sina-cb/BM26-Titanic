/**
 * sacn_bridge.js — sACN Receiver → WebSocket bridge.
 *
 * Attaches to the save-server's HTTP instance via WebSocket upgrade.
 * Receives sACN (E1.31) packets on the local network and forwards
 * the DMX frame data to browser clients on the '/sacn' WS path.
 *
 * Config is read from scene_config.yaml 'sacn' section:
 *   enabled, universes, lockout_ms, high_priority_threshold, source_stale_ms
 *
 * Protocol (WS messages, binary):
 *   Byte 0-1:  Universe number (uint16 LE)
 *   Byte 2:    Priority (uint8)
 *   Byte 3-514: DMX data (512 bytes)
 */
'use strict';

let Receiver, WebSocketServer;

try {
  ({ Receiver } = require('sacn'));
} catch (e) {
  console.warn('[sACN Bridge] sacn package not installed — bridge disabled.');
  console.warn('              Run: cd simulation && npm install sacn');
}

try {
  WebSocketServer = require('ws').Server;
} catch (e) {
  console.warn('[sACN Bridge] ws package not installed — bridge disabled.');
  console.warn('              Run: cd simulation && npm install ws');
}

/**
 * Attach sACN bridge WebSocket to an existing HTTP server.
 * @param {http.Server} httpServer — the save-server's HTTP instance
 * @param {object} options
 * @param {boolean} options.enabled — whether to start
 * @param {number[]} options.universes — sACN universes to listen on
 * @param {number} options.lockoutMs — high-priority lockout duration
 * @param {number} options.highPriorityThreshold — priority level that triggers lockout
 * @param {number} options.sourceStaleMs — source considered dead after this
 */
function attachSacnBridge(httpServer, options = {}) {
  const enabled = options.enabled !== undefined ? options.enabled : false;
  const universes = options.universes || [1, 2, 3, 4];
  const LOCKOUT_MS = options.lockoutMs || 10000;
  const HIGH_PRIORITY = options.highPriorityThreshold || 150;
  const SOURCE_STALE_MS = options.sourceStaleMs || 2000;

  if (!enabled) {
    console.log('[sACN Bridge] Disabled in config.');
    return null;
  }

  if (!Receiver || !WebSocketServer) {
    console.error('[sACN Bridge] Missing dependencies (sacn, ws). Bridge not started.');
    return null;
  }

  // ── WebSocket Server — attached to save-server's HTTP via path '/sacn' ──
  const wss = new WebSocketServer({ noServer: true });
  let clientCount = 0;

  // Handle upgrade requests on '/sacn' path
  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/sacn') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
    // Other upgrade paths are ignored (not destroyed — other WS handlers may exist)
  });

  wss.on('connection', (ws) => {
    clientCount++;
    console.log(`[sACN Bridge] Browser connected (${clientCount} client(s))`);

    ws.on('close', () => {
      clientCount--;
      console.log(`[sACN Bridge] Browser disconnected (${clientCount} client(s))`);
    });

    ws.on('error', (err) => {
      console.error('[sACN Bridge] WebSocket error:', err.message);
    });
  });

  // ── sACN Receiver ────────────────────────────────────────────────
  const receiver = new Receiver({
    universes: universes,
    reuseAddr: true,
  });

  // State — priority routing (same logic as sacn_smart_router.js)
  let activeSource = null;
  let highPriorityActive = false;
  let highPriorityTimer = null;
  let packetCount = 0;
  let lastLogTime = 0;

  receiver.on('packet', (packet) => {
    const priority = packet.priority || 100;
    const sourceKey = packet.sourceName || 'Unknown';
    const universe = packet.universe || 1;

    // High-priority source override
    if (priority >= HIGH_PRIORITY) {
      if (!highPriorityActive || activeSource !== sourceKey) {
        console.log(`[sACN Bridge] 🔴 OVERRIDE — '${sourceKey}' (Priority ${priority}) in control.`);
        highPriorityActive = true;
        activeSource = sourceKey;
      }
      clearTimeout(highPriorityTimer);
      highPriorityTimer = setTimeout(() => {
        console.log(`[sACN Bridge] 🟢 RELEASED — '${activeSource}' went silent for ${LOCKOUT_MS / 1000}s.`);
        highPriorityActive = false;
        activeSource = null;
      }, LOCKOUT_MS);

      broadcastFrame(universe, priority, packet.payload);
    } else {
      // Low-priority source — only forward if no high-priority lock
      if (!highPriorityActive) {
        if (activeSource !== sourceKey) {
          console.log(`[sACN Bridge] 🟡 ACTIVE — '${sourceKey}' (Priority ${priority}) forwarding.`);
          activeSource = sourceKey;
        }
        broadcastFrame(universe, priority, packet.payload);
      }
    }

    // Periodic stats
    packetCount++;
    const now = Date.now();
    if (now - lastLogTime > 5000) {
      if (packetCount > 0) {
        console.log(`[sACN Bridge] ${packetCount} packets/5s from '${activeSource || 'none'}', ${clientCount} client(s)`);
      }
      packetCount = 0;
      lastLogTime = now;
    }
  });

  /**
   * Broadcast a DMX frame to all connected WebSocket clients.
   * Binary format: [universe(2)] [priority(1)] [dmx(512)] = 515 bytes
   */
  function broadcastFrame(universe, priority, payload) {
    if (wss.clients.size === 0) return;

    // Convert sACN payload object { channel: value } to 512-byte array
    const dmx = new Uint8Array(512);
    if (payload) {
      for (const ch in payload) {
        const idx = parseInt(ch, 10) - 1;
        if (idx >= 0 && idx < 512) {
          dmx[idx] = payload[ch];
        }
      }
    }

    // Build binary message: 2 bytes universe + 1 byte priority + 512 bytes DMX
    const msg = Buffer.alloc(515);
    msg.writeUInt16LE(universe, 0);
    msg.writeUInt8(priority, 2);
    dmx.forEach((v, i) => { msg[3 + i] = v; });

    wss.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(msg);
      }
    });
  }

  console.log('═'.repeat(56));
  console.log('  📡 sACN → WebSocket Bridge');
  console.log('─'.repeat(56));
  console.log(`  sACN Universes      : ${universes.join(', ')}`);
  console.log(`  WebSocket Path      : ws://localhost:${httpServer.address()?.port || '?'}/sacn`);
  console.log(`  Priority Threshold  : ≥${HIGH_PRIORITY}`);
  console.log(`  Lockout Duration    : ${LOCKOUT_MS / 1000}s`);
  console.log(`  Source Stale        : ${SOURCE_STALE_MS}ms`);
  console.log('═'.repeat(56));

  return { wss, receiver };
}

module.exports = { attachSacnBridge };
