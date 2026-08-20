/**
 * sacn_output_bridge_datapath.test.js — the :6972 output bridge has NO data
 * path any more, and this file pins that (report 20260805_171).
 *
 * ── WHAT THIS FILE USED TO BE ──────────────────────────────────────────────
 *
 * Catalog gap G2 (`20260805_161`) covered the bridge's real forwarding: the
 * `getSender` pool keying and reuse, the 519-byte frame parse, priority
 * passthrough, the error-log dedup/heartbeat/recovery ladder, the 15 s stale
 * reap and burst behaviour. Every one of those specs described machinery that
 * unicast browser-generated DMX to real controllers.
 *
 * ── WHY IT IS NOW A REFUSAL SPEC ───────────────────────────────────────────
 *
 * Operator ruling 2026-08-05: engine → sim SERVER → controllers; the browser is
 * never the router. The forwarding was deleted rather than disabled — the file
 * imports no sACN sender and holds no pool — so there is no sender to key, no
 * priority to pass through and no error ladder to exercise. Testing them would
 * mean re-adding them.
 *
 * The coverage is not dropped; it is INVERTED. What used to be "a well-formed
 * frame produces exactly one send" is now "a well-formed frame produces NO send,
 * and says so out loud", which is the property the rest of the system now leans
 * on. The structural half lives in `browser_transmit_absence.test.js`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeHarness } from './helpers/bridge_harness.mjs';

const H = createBridgeHarness();
const { senders, logs } = H;

function buildFrame({ universe = 7, ip = '10.0.0.42', priority = 100, dmx = null } = {}) {
  const buf = Buffer.alloc(519);
  buf.writeUInt16LE(universe, 0);
  ip.split('.').map(Number).forEach((b, i) => buf.writeUInt8(b, 2 + i));
  buf.writeUInt8(priority, 6);
  if (dmx) Buffer.from(dmx).copy(buf, 7);
  return buf;
}

test('_171: a well-formed 519-byte frame produces NO sender and NO send', async () => {
  const ws = H.outputWss.connect();
  const before = senders.length;
  H.captureConsole();
  ws.emit('message', buildFrame({ universe: 11, ip: '10.9.9.11' }));
  await H.settle(4);
  H.releaseConsole();
  assert.equal(senders.length, before,
    'the shape that used to be forwarded must now create nothing at all');
});

test('_171: a burst is refused as a burst — 500 frames, still zero senders', async () => {
  // A stale browser bundle sends at frame rate; the refusal must not depend on
  // volume, and must not fall over under it either.
  const ws = H.outputWss.connect();
  const before = senders.length;
  H.captureConsole();
  for (let i = 0; i < 500; i += 1) ws.emit('message', buildFrame({ universe: 12 }));
  await H.settle(4);
  H.releaseConsole();
  assert.equal(senders.length, before);
});

test('_171: the refusal is LOUD once, then rate-limited — a stale bundle must not bury the log',
  async () => {
    const ws = H.outputWss.connect();
    logs.length = 0;
    H.captureConsole();
    for (let i = 0; i < 50; i += 1) ws.emit('message', buildFrame({ universe: 13 }));
    await H.settle(4);
    H.releaseConsole();
    const refusals = logs.filter(l => /REFUSED a DMX frame/.test(l));
    assert.equal(refusals.length, 1,
      'exactly one line for a burst: the first. A line per frame would bury the message ' +
      'the operator actually needs to read');
    assert.match(refusals[0], /STALE BUNDLE/, 'and it must name the likely cause');
    assert.match(refusals[0], /hard-reload/i, 'and the remedy');
  });

test('_171: a malformed frame is still ignored silently, as it always was', async () => {
  const ws = H.outputWss.connect();
  const before = senders.length;
  logs.length = 0;
  H.captureConsole();
  ws.emit('message', Buffer.alloc(64));         // not 519 bytes
  ws.emit('message', 'not a frame at all');
  await H.settle(3);
  H.releaseConsole();
  assert.equal(senders.length, before);
  assert.equal(logs.filter(l => /REFUSED a DMX frame/.test(l)).length, 0,
    'only the DMX shape is worth shouting about — noise on the socket is not news');
});

test('_171 teardown: restore the real module loader', () => {
  H.restoreModuleLoad();
});
