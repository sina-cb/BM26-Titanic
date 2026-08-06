#!/usr/bin/env node
/**
 * sacn_output_bridge.js — the port a browser used to transmit DMX through,
 * kept ONLY to refuse it.
 *
 * ── WHAT THIS PROCESS NO LONGER DOES (report 20260805_171) ──────────────────
 *
 * It used to accept 519-byte frames from the sim and unicast them to real sACN
 * controllers. Operator ruling 2026-08-05: **engine → sim SERVER → controllers;
 * the browser is never the router.** A browser writing to hardware was a second
 * writer on every patched controller at a hard-coded priority 150 under the
 * shared default CID (`_160` T4, `_157` P4 measured 98/100 packets dropped),
 * and it ran on the browser's clock — so background-tab throttling froze the rig
 * on one stale frame while the show looked alive (`_160` T5). That is the freeze
 * the operator hit by switching tabs.
 *
 * So the forwarding is GONE, not disabled: this file imports no sACN sender,
 * holds no sender pool and has no code path that can reach a controller.
 * Refusal is by construction rather than by configuration — there is no flag to
 * flip back, and nothing to resurrect from.
 *
 * ── WHY THE PROCESS STILL EXISTS ───────────────────────────────────────────
 *
 * A browser serving a STALE CACHED BUNDLE still opens this socket and still
 * sends frames. Left unbound, that would fail silently and look like "the sim
 * just isn't driving anything". Bound and refusing loudly, it names itself the
 * first time it happens. That is this process's entire remaining job.
 *
 * ── THE BENCH-MIRROR GATE IS GONE TOO ──────────────────────────────────────
 *
 * `benchMirrorGate` / R-23 existed only to silence this stream while the bench
 * mirror was armed. With the stream structurally absent there is nothing to
 * gate, so the input bridge no longer asks and this process no longer answers.
 * A structural absence is a stronger guarantee than a gated stream.
 *
 * Usage:
 *   node sacn_output_bridge.js
 */

'use strict';

const { WebSocketServer } = require('ws');
const path = require('path');

// ── Config (fail-loud: no silent port guessing) ──────────────────────────────
const { loadSimPorts } = require('../lib/load_ports.cjs');
const _simPorts = loadSimPorts(path.join(__dirname, '..', 'config.yaml'));
const port = _simPorts.sacn_output_port;

// One line per client, then silence: a stale bundle sends at frame rate, and a
// log line per frame would bury the very message the operator needs to read.
const REFUSAL_REPEAT_MS = 30000;

const wss = new WebSocketServer({ port });

wss.on('listening', () => {
  console.log('═'.repeat(56));
  console.log('  📡 sACN Output Bridge — REFUSING BY CONSTRUCTION');
  console.log('─'.repeat(56));
  console.log(`  WebSocket   : ws://localhost:${port}`);
  console.log('  Forwarding  : NONE. This process holds no sACN sender and');
  console.log('                cannot reach a controller. The engine renders,');
  console.log('                the sACN input bridge routes, the browser looks.');
  console.log('═'.repeat(56));
  console.log('  A client sending DMX here is running a stale bundle.\n');
});

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  let refusedFrames = 0;
  let lastRefusalLoggedAt = 0;

  console.log(`[Bridge] 🔗 Client connected from ${clientIp} — nothing it sends will be forwarded.`);

  ws.on('message', (data) => {
    // The only thing worth reacting to is the shape that used to be a DMX frame.
    if (!(data instanceof Buffer) || data.length !== 519) return;

    refusedFrames += 1;
    const now = Date.now();
    if (refusedFrames === 1 || now - lastRefusalLoggedAt >= REFUSAL_REPEAT_MS) {
      lastRefusalLoggedAt = now;
      console.error(
        `[Bridge] ⛔ REFUSED a DMX frame from ${clientIp} (${refusedFrames} so far). ` +
        'The browser is NOT the router: the engine renders and the sACN INPUT bridge ' +
        '(:6971) is the only thing that writes to a controller. This client is running a ' +
        'STALE BUNDLE — hard-reload the sim (Ctrl-Shift-R). Nothing was sent to any ' +
        'controller, and nothing can be: this process holds no sACN sender.');
    }
  });

  ws.on('close', () => {
    if (refusedFrames > 0) {
      console.error(`[Bridge] 🔌 Client from ${clientIp} disconnected after ` +
        `${refusedFrames} refused DMX frame(s) — it was running a stale bundle.`);
    } else {
      console.log('[Bridge] 🔌 Client disconnected');
    }
  });

  ws.on('error', (err) => {
    console.error(`[Bridge] WS error: ${err.message}`);
  });
});

// ── Graceful Shutdown ────────────────────────────────────────────────────────
function shutdown() {
  console.log('\n[Bridge] Shutting down...');
  wss.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
