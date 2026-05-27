#!/usr/bin/env node
/**
 * Live OSC listener probe for cross-machine validation.
 *
 * Starts a real OscListener on port 10000 (the user's remote
 * analyser sends `/marsin/stems/vocals` here) and prints every
 * recognized write the listener routes into the CPC, plus a
 * per-second stats snapshot.
 *
 * Usage:
 *   node tests/osc_live_listener.mjs            # default port 10000
 *   node tests/osc_live_listener.mjs --port 6970
 *
 * Exits cleanly on SIGINT. NOT a unit test — it's a real-network
 * harness, kept under `tests/` so the impl plan's Phase 8 live
 * validation has a single command to run. See
 * .agent/02_reports/202605/20260524_1_osc_impl.md §8.2.
 */

import { ParamCenter } from '../lib/param_center.js';
import { OscListener } from '../lib/osc_listener.js';

function parseArgs() {
  let port = 10000;
  let host = '0.0.0.0';
  let durationS = 0;          // 0 = run until SIGINT
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--port')        port = parseInt(process.argv[++i], 10);
    else if (a === '--host')   host = process.argv[++i];
    else if (a === '--duration') durationS = parseInt(process.argv[++i], 10);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node tests/osc_live_listener.mjs [--port N] [--host H] [--duration S]');
      process.exit(0);
    }
  }
  return { port, host, durationS };
}

const { port, host, durationS } = parseArgs();
const paramCenter = new ParamCenter(null);

// Mirror the api_server fan-out path so we can print every CPC
// write the listener triggers — but stay lightweight (no API
// server, no WASM).
paramCenter.onChange = ({ changedKeys, state }) => {
  for (const k of changedKeys) {
    const slot = state.params[k];
    console.log(
      `[CPC]  ${new Date().toISOString()}  ${k.padEnd(14)} = ${
        typeof slot.value === 'number' ? slot.value.toFixed(4) : JSON.stringify(slot.value)
      }   origin=${slot.lastOrigin}`
    );
  }
};

const listener = new OscListener({
  port, host,
  paramCenter,
  onStats: (s) => {
    console.log(
      `[stat] rx=${s.rxMessagesPerSec} mapped=${s.mappedMessagesPerSec} ` +
      `dropped=${s.droppedMessagesPerSec} invalid=${s.invalidMessagesPerSec} ` +
      `lastSender=${s.lastSender || '-'}`
    );
  },
});
listener.start();
console.log(
  `\n📡 OSC live probe listening on ${host}:${port}\n` +
  `   Canonical CPC bindings: ${listener._bindingsCount}\n` +
  `   Mode: ${listener._allowedCount > 0 ? 'allowlist' : 'open (any sender)'}\n` +
  `   Waiting for packets… (Ctrl-C to stop)\n`
);

function shutdown(reason) {
  console.log(`\n⏹  Stopping (${reason})…`);
  listener.stop();
  process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
if (durationS > 0) {
  setTimeout(() => shutdown(`${durationS}s timeout`), durationS * 1000);
}
