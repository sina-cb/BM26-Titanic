#!/usr/bin/env node
/**
 * sacn_output_bridge.js — sACN Output Bridge
 *
 * WebSocket server that accepts DMX frames from the browser simulation
 * and forwards them as sACN (E1.31) UDP packets to real DMX controllers.
 *
 * Binary protocol (from browser):
 *   Byte 0-1:   Universe number (uint16 LE)
 *   Byte 2-5:   Controller IPv4 (4 bytes, e.g. 10.1.1.10)
 *   Byte 6:     Priority (uint8)
 *   Byte 7-518: DMX data (512 bytes)
 *   Total: 519 bytes
 *
 * Usage:
 *   node sacn_output_bridge.js
 *   node sacn_output_bridge.js --port 6972
 */

'use strict';

const { WebSocketServer } = require('ws');
const { Sender } = require('sacn');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// ── Config (fail-loud: no silent port guessing) ──────────────────────────────
const args = process.argv.slice(2);
const { loadSimPorts } = require('../lib/load_ports.cjs');
const _simPorts = loadSimPorts(path.join(__dirname, '..', 'config.yaml'));
const port = _simPorts.sacn_output_port;
const udpPort = _simPorts.sacn_udp_port;

const STALE_SENDER_MS = 15000; // Close senders after 15s of no data
const SOURCE_NAME = 'BM26-Simulation';
const ERROR_LOG_INTERVAL_MS = 30000; // Re-log a still-failing sender at most this often

// ── Sender Pool ──────────────────────────────────────────────────────────────
// Key: "universe:ip" → {
//   sender,
//   lastUsed,
//   lastErrorMsg,        // null when healthy, string of last err.message when failing
//   lastErrorLoggedAt,   // ms timestamp of the most recent log line for this error
//   errorsSinceLog,      // count of identical errors suppressed since lastErrorLoggedAt
// }
const senderPool = new Map();

function getSender(universe, ip) {
  const key = `${universe}:${ip}`;
  let entry = senderPool.get(key);
  if (!entry) {
    const sender = new Sender({
      universe,
      // Destination port only — reuseAddr would bind this sender to *:5568
      // and steal datagrams from the input bridge's Receiver (task 010).
      port: udpPort,
      useUnicastDestination: ip,
      defaultPacketOptions: {
        sourceName: SOURCE_NAME,
        priority: 100,
      },
    });
    entry = {
      sender,
      lastUsed: Date.now(),
      lastErrorMsg: null,
      lastErrorLoggedAt: 0,
      errorsSinceLog: 0,
    };
    senderPool.set(key, entry);
    console.log(`[Bridge] ✨ New sender: U${universe} → ${ip}`);
  }
  entry.lastUsed = Date.now();
  return entry;
}

// Clean up stale senders periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of senderPool) {
    if (now - entry.lastUsed > STALE_SENDER_MS) {
      try { entry.sender.close(); } catch (_) {}
      senderPool.delete(key);
      console.log(`[Bridge] 🗑  Closed stale sender: ${key}`);
    }
  }
}, 5000);

// ── Parse IPv4 from 4 bytes ──────────────────────────────────────────────────
function bytesToIp(view, offset) {
  return `${view.getUint8(offset)}.${view.getUint8(offset + 1)}.${view.getUint8(offset + 2)}.${view.getUint8(offset + 3)}`;
}

// ── WebSocket Server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ port });

let frameCount = 0;
let lastStatsTime = Date.now();

wss.on('listening', () => {
  console.log('═'.repeat(56));
  console.log('  📡 sACN Output Bridge');
  console.log('─'.repeat(56));
  console.log(`  WebSocket   : ws://localhost:${port}`);
  console.log(`  Source Name : ${SOURCE_NAME}`);
  console.log(`  Protocol    : [universe(2B)][ip(4B)][priority(1B)][dmx(512B)]`);
  console.log('═'.repeat(56));
  console.log('  Waiting for connections...\n');
});

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[Bridge] 🔗 Client connected from ${clientIp}`);

  ws.on('message', (data) => {
    if (!(data instanceof Buffer) || data.length !== 519) {
      // Ignore non-conforming messages
      return;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const universe = view.getUint16(0, true); // LE
    const ip = bytesToIp(view, 2);
    const priority = view.getUint8(6);
    const dmx = data.subarray(7, 519);

    // Build sACN payload (1-indexed)
    const payload = {};
    for (let ch = 0; ch < 512; ch++) {
      payload[ch + 1] = dmx[ch];
    }

    const entry = getSender(universe, ip);
    entry.sender.send({
      payload,
      sourceName: SOURCE_NAME,
      priority,
    }).then(() => {
      // First success after a streak of failures: surface the recovery once
      // and reset the dedupe state so future failures will log immediately.
      if (entry.lastErrorMsg) {
        const burst = entry.errorsSinceLog;
        const tail = burst > 0 ? ` (after ${burst} suppressed errors)` : '';
        console.log(`[Bridge] ✅ Recovered U${universe}→${ip}${tail}`);
        entry.lastErrorMsg = null;
        entry.lastErrorLoggedAt = 0;
        entry.errorsSinceLog = 0;
      }
    }).catch(err => {
      // Per-(universe,ip,err.message) cooldown so a downed controller doesn't
      // flood the terminal at sACN frame rate. Real failures still surface,
      // they just don't repeat 30+ times per second.
      const now = Date.now();
      const msg = err.message;
      if (msg !== entry.lastErrorMsg) {
        // New error class (or first-ever failure) — log it immediately.
        const transition = entry.lastErrorMsg
          ? ` (was: ${entry.lastErrorMsg})`
          : '';
        console.error(`[Bridge] ⚠ Send error U${universe}→${ip}: ${msg}${transition}`);
        entry.lastErrorMsg = msg;
        entry.lastErrorLoggedAt = now;
        entry.errorsSinceLog = 0;
      } else if (now - entry.lastErrorLoggedAt >= ERROR_LOG_INTERVAL_MS) {
        // Same error class still happening — periodic heartbeat with the
        // count we suppressed in this window.
        const suppressed = entry.errorsSinceLog;
        console.error(`[Bridge] ⚠ Still failing U${universe}→${ip}: ${msg} (${suppressed} suppressed in last ${Math.round((now - entry.lastErrorLoggedAt) / 1000)}s)`);
        entry.lastErrorLoggedAt = now;
        entry.errorsSinceLog = 0;
      } else {
        entry.errorsSinceLog++;
      }
    });

    frameCount++;

    // Stats logging every 5 seconds
    const now = Date.now();
    if (now - lastStatsTime > 5000) {
      const fps = Math.round(frameCount / ((now - lastStatsTime) / 1000));
      const targets = Array.from(senderPool.keys()); // e.g. ["1:10.0.0.1", "2:10.0.0.2"]
      const displayTargets = targets.length > 4 ? targets.slice(0, 4).join(', ') + ` (+${targets.length - 4} more)` : targets.join(', ');
      const msgStr = JSON.stringify({ type: 'log', msg: `[Bridge] ⚡ ${fps} fps → Routing to: [${displayTargets || 'None'}]` });
      ws.send(msgStr);
      frameCount = 0;
      lastStatsTime = now;
    }
  });

  ws.on('close', () => {
    console.log(`[Bridge] 🔌 Client disconnected`);
  });

  ws.on('error', (err) => {
    console.error(`[Bridge] WS error: ${err.message}`);
  });
});

// ── Graceful Shutdown ────────────────────────────────────────────────────────
function shutdown() {
  console.log('\n[Bridge] Shutting down...');
  for (const [key, entry] of senderPool) {
    try { entry.sender.close(); } catch (_) {}
  }
  senderPool.clear();
  wss.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
