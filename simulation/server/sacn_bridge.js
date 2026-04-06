/**
 * sacn_bridge.js — sACN Receiver → WebSocket bridge.
 *
 * Receives sACN (E1.31) packets on the local network and forwards
 * the DMX frame data to the browser simulation via WebSocket.
 *
 * Uses the same `sacn` npm package as the existing smart_router.
 *
 * Protocol (WS messages, binary):
 *   Byte 0-1:  Universe number (uint16 LE)
 *   Byte 2:    Priority (uint8)
 *   Byte 3-514: DMX data (512 bytes)
 *
 * Usage:
 *   Called from save-server.js (or launched standalone):
 *     const { startSacnBridge } = require('./sacn_bridge');
 *     startSacnBridge(httpServer, { universes: [1], port: 5555 });
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
 * Start the sACN → WebSocket bridge.
 * @param {object} options
 * @param {number[]} options.universes - sACN universes to listen on (default: [1])
 * @param {number} options.wsPort - WebSocket server port (default: 5555)
 * @param {boolean} options.enabled - Whether to start (default: false)
 */
function startSacnBridge(options = {}) {
  const universes = options.universes || [1];
  const wsPort = options.wsPort || 5555;
  const enabled = options.enabled !== undefined ? options.enabled : false;

  if (!enabled) {
    console.log('[sACN Bridge] Disabled in config. Set sacn.enabled: true to activate.');
    return null;
  }

  if (!Receiver || !WebSocketServer) {
    console.error('[sACN Bridge] Missing dependencies (sacn, ws). Bridge not started.');
    return null;
  }

  // ── WebSocket Server ─────────────────────────────────────────────
  const wss = new WebSocketServer({ port: wsPort });
  let clientCount = 0;

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

  // Track active sources (like the smart router)
  let activeSource = null;
  let highPriorityActive = false;
  let highPriorityTimer = null;
  const LOCKOUT_MS = 10000;
  let packetCount = 0;
  let lastLogTime = 0;

  receiver.on('packet', (packet) => {
    const priority = packet.priority || 100;
    const sourceKey = packet.sourceName || 'Unknown';
    const universe = packet.universe || 1;

    // Priority routing (same logic as sacn_smart_router.js)
    if (priority >= 150) {
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
        console.log(`[sACN Bridge] ${packetCount} packets/5s from '${activeSource || 'none'}'`);
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
      // sACN packet.payload is an object: { 1: value, 2: value, ... }
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
  console.log(`  sACN Universes : ${universes.join(', ')}`);
  console.log(`  WebSocket Port : ${wsPort}`);
  console.log(`  Priority Rule  : ≥150 locks out lower for ${LOCKOUT_MS / 1000}s`);
  console.log('═'.repeat(56));

  return { wss, receiver };
}

module.exports = { startSacnBridge };
