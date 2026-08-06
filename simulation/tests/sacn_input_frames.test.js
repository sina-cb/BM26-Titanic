/**
 * sacn_input_frames.test.js — the browser-side `SacnInputSource` frame path
 * (catalog 20260805_161 gap G6, rank 5): `_handleMessage`/`_handleTextMessage`
 * /`_handleDmxFrame` (`src/dmx/sacn_input_source.js:349-447`), `disable()`'s
 * waiter rejection, and (G15 fold-in) the static-host enable() refusal.
 *
 * `bridge_route_readback.test.js` already covers `queryRoutes`'s waiter
 * machinery and the arm suite covers the bench-mirror waiters + banner/census
 * dispatch; the DMX frame path itself, the binary/text dispatch, and
 * `disable()` had no test before this file.
 *
 * Constructs `new SacnInputSource('ws://x')` directly and calls its
 * (unexported but perfectly callable) `_handle*` methods — never touches the
 * singleton (`getSacnInput`) and never opens a real socket.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// sacn_input_source.js reads `window.*` lazily inside its methods — the
// object must exist under Node for those reads to evaluate at all.
globalThis.window = globalThis.window || {};

import { SacnInputSource } from '../src/dmx/sacn_input_source.js';

const SIM_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function freshWindow() {
  const known = new Set();
  const calls = { addUniverse: [], submitFrame: [], removeSource: [] };
  window.dmxRouter = {
    getUniverse: (u) => (known.has(u) ? {} : undefined),
    addUniverse: (u) => { known.add(u); calls.addUniverse.push(u); },
    submitFrame: (...args) => calls.submitFrame.push(args),
    removeSource: (id) => calls.removeSource.push(id),
  };
  const sacnLogCalls = [];
  window.sacnLog = (msg, level) => sacnLogCalls.push({ msg, level });
  return { calls, sacnLogCalls, known };
}

/** A 515-byte DMX frame: universe LE @0, priority @2, 512 dmx bytes @3. */
function buildDmxFrame(universe, priority, ramp) {
  const buf = new ArrayBuffer(515);
  const view = new DataView(buf);
  view.setUint16(0, universe, true);
  view.setUint8(2, priority);
  const bytes = new Uint8Array(buf, 3, 512);
  for (let i = 0; i < 512; i += 1) bytes[i] = ramp(i);
  return buf;
}

test('G6: a 515-byte DMX frame is parsed and forwarded with full byte parity; stats update', () => {
  const { calls } = freshWindow();
  const src = new SacnInputSource('ws://x');
  src._handleMessage(buildDmxFrame(9, 100, (i) => i % 256));

  assert.deepEqual(calls.addUniverse, [9], 'an unknown universe is auto-added exactly once');
  assert.equal(calls.submitFrame.length, 1);
  const [sourceId, priority, universe, dmx] = calls.submitFrame[0];
  assert.equal(sourceId, 'sacn_in');
  assert.equal(priority, 100);
  assert.equal(universe, 9);
  assert.equal(dmx.length, 512);
  for (let i = 0; i < 512; i += 1) assert.equal(dmx[i], i % 256);

  assert.equal(src.stats.framesReceived, 1);
  assert.equal(src.stats.lastUniverse, 9);
  assert.equal(src.stats.lastPriority, 100);
  assert.ok(src.stats.lastFrameAt > 0);
  assert.ok(src.stats.activeUniverses.has(9));

  // A second frame on the SAME (now-known) universe must not re-add it.
  src._handleMessage(buildDmxFrame(9, 100, (i) => i % 256));
  assert.deepEqual(calls.addUniverse, [9]);
  assert.equal(src.stats.framesReceived, 2);
});

test('G6 [D12-pin]: a priority byte of 0 is inflated to 200, not preserved as 0', () => {
  const { calls } = freshWindow();
  const src = new SacnInputSource('ws://x');
  src._handleMessage(buildDmxFrame(11, 0, () => 0));
  const [, priority] = calls.submitFrame[0];
  // `_157` D12: `priority || SACN_DEFAULT_PRIORITY` treats a legal priority-0
  // frame as absent and promotes it to 200 — the HIGHEST class this source
  // can hold (above pixelblaze's 100). Pinning current behavior; the
  // post-fix expectation is a preserved 0.
  assert.equal(priority, 200,
    '[D12-pin] the router receives 200 (SACN_DEFAULT_PRIORITY), never the wire\'s literal 0');
});

test('G6: round-trip byte-layout parity with the server\'s writer, plus a source guard on the format',
  () => {
    // Replicate `routeFrame`'s writer (`server/sacn_bridge.js`) as a fixture
    // builder — this is the wire-format half no test previously made explicit.
    const universe = 42;
    const priority = 77;
    const dmx = Array.from({ length: 512 }, (_, i) => (i * 3) % 256);
    const msg = Buffer.alloc(515);
    msg.writeUInt16LE(universe, 0);
    msg.writeUInt8(priority, 2);
    dmx.forEach((v, i) => { msg[3 + i] = v; });
    const ab = msg.buffer.slice(msg.byteOffset, msg.byteOffset + msg.byteLength);

    const { calls } = freshWindow();
    const src = new SacnInputSource('ws://x');
    src._handleMessage(ab);
    const [, gotPriority, gotUniverse, gotDmx] = calls.submitFrame[0];
    assert.equal(gotUniverse, universe);
    assert.equal(gotPriority, priority);
    assert.deepEqual(Array.from(gotDmx), dmx);

    // A server-side format change should break THIS test by name.
    const serverSrc = fs.readFileSync(path.join(SIM_ROOT, 'server', 'sacn_bridge.js'), 'utf8');
    assert.match(serverSrc, /Buffer\.alloc\(515\)/);
    assert.match(serverSrc, /writeUInt16LE\(universe,\s*0\)/);
    assert.match(serverSrc, /writeUInt8\(priority,\s*2\)/);
  });

test('G6: a non-515-byte ArrayBuffer carrying JSON is decoded and forwarded as a log', () => {
  const { sacnLogCalls } = freshWindow();
  const src = new SacnInputSource('ws://x');
  const text = JSON.stringify({ type: 'log', msg: 'hello from the bridge', level: 'warn' });
  const ab = new TextEncoder().encode(text).buffer;
  src._handleMessage(ab);
  assert.deepEqual(sacnLogCalls, [{ msg: 'hello from the bridge', level: 'warn' }]);
});

test('G6: a non-515-byte ArrayBuffer of garbage bytes never throws and logs nothing', () => {
  const { sacnLogCalls } = freshWindow();
  const src = new SacnInputSource('ws://x');
  const garbage = new Uint8Array([0xff, 0x00, 0x13, 0x99, 0x22]).buffer;
  assert.doesNotThrow(() => src._handleMessage(garbage));
  assert.deepEqual(sacnLogCalls, []);
});

test('G6: a string census message and an unknown string type never throw', () => {
  freshWindow();
  const src = new SacnInputSource('ws://x');
  assert.doesNotThrow(() => src._handleMessage(JSON.stringify({ type: 'clients', count: 2 })));
  assert.doesNotThrow(() => src._handleMessage(JSON.stringify({ type: 'somethingTotallyUnknown' })));
  assert.doesNotThrow(() => src._handleMessage('not json at all {{{'));
});

test('G6: disable() removes the router source and rejects every pending waiter', async () => {
  const { calls } = freshWindow();
  const src = new SacnInputSource('ws://x');
  src.stats.connected = true;

  const p1 = new Promise((resolve, reject) => {
    src._routeWaiters.set('r1', { resolve, reject, timer: setTimeout(() => {}, 0) });
  });
  const p2 = new Promise((resolve, reject) => {
    src._benchMirrorWaiters.set('b1', { resolve, reject, timer: setTimeout(() => {}, 0) });
  });
  const p3 = new Promise((resolve, reject) => {
    src._benchMirrorOptionWaiters.set('o1', { resolve, reject, timer: setTimeout(() => {}, 0) });
  });

  src.disable();

  assert.deepEqual(calls.removeSource, ['sacn_in']);
  assert.equal(src.stats.connected, false);
  await assert.rejects(p1, /closed before the route-table reply/);
  await assert.rejects(p2, /closed before the bench-mirror reply/);
  await assert.rejects(p3, /closed before the bench-mirror options/);
});

test('G15 (fold-in): enable() on a static host never connects — no WebSocket is even constructed',
  () => {
    freshWindow();
    window.location = { protocol: 'https:' };
    const realWebSocket = globalThis.WebSocket;
    let constructed = false;
    globalThis.WebSocket = function StubWebSocket() {
      constructed = true;
      throw new Error('a static host must never construct a WebSocket');
    };
    try {
      const src = new SacnInputSource('ws://x');
      src.enable();
      assert.equal(src._enabled, false, 'enable() must refuse on a static host');
      assert.equal(constructed, false);
    } finally {
      globalThis.WebSocket = realWebSocket;
      delete window.location;
    }
  });
