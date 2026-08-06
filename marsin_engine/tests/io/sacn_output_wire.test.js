/**
 * sacn_output_wire.test.js — wire-level pin for `lib/sacn_output.js`, the
 * engine's ONLY sACN output path (catalog `.agent/reports/202608/
 * 20260805_162_engine_test_gap_catalog.md` G-1, rank 1).
 *
 * Before this file, `lib/sacn_output.js` had ZERO tests: nothing pinned
 * one-datagram-per-(universe,destination)-per-frame, packet field placement,
 * start/stop gating, 1-indexing, zero-channel wire truth, sequence, or
 * `stop()` socket cleanup. `send_error_throttle.test.js` covers the error
 * throttle in isolation and `output_config_guard.test.js` greps engine.js for
 * the call site — neither ever sends a frame.
 *
 * TECHNIQUE (per the catalog): the vendored `sacn@4.6.2` package is CJS and
 * calls `dgram.createSocket` inside the `Sender` CONSTRUCTOR (not at module
 * import time — see node_modules/sacn/dist/sender.js:41). So patching the
 * shared `node:dgram` module's `createSocket` export before calling
 * `createSacnOutput(...)` (which builds `Sender`s synchronously) is enough to
 * intercept every datagram in-process — import order between this file and
 * `sacn_output.js` doesn't matter, only call order does. Verified empirically
 * against this exact repo's sacn version before writing the assertions below.
 *
 * Every captured buffer is parsed with the vendored package's OWN `Packet`
 * class (never hardcoded byte offsets) via `payloadAsBuffer` — the raw wire
 * bytes after the sacn lib's internal packing.
 *
 * QUIRK, NOW FIXED (G-1 case 8 / R-D1, report 20260805_170). The sacn
 * package's `Packet.buffer` getter treats `payload[ch]` as a 0..100-scale
 * PERCENTAGE and multiplies by 2.55 before quantizing (`packet.js:138`) unless
 * `useRawDmxValues` is set. It never was, so a raw DMX byte of 200 arrived on
 * the wire as `inRange(200*2.55)=255` — every value the engine rendered above
 * DMX 100 left as full, on every controller. `sacn_output.js` now passes
 * `useRawDmxValues: true` in `defaultPacketOptions`, so the payload field means
 * what this whole file already assumed it meant. The {0,255}-only restriction
 * the catalog and `_155` A5 imposed is RETIRED here: the last test in this file
 * is the full 0..255 identity table R-D1 asked for.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Packet } = require('sacn/dist/packet.js');

const realCreateSocket = dgram.createSocket;
/** @type {Array<{msg: Buffer, port: number, addr: string, socket: object}>} */
let captured;
/** @type {Array<object>} every fake socket handed out, for close()-tracking assertions */
let sockets;

function installFakeDgram() {
  captured = [];
  sockets = [];
  dgram.createSocket = function fakeCreateSocket() {
    const fake = {
      closed: false,
      send(msg, port, addr, cb) {
        captured.push({ msg: Buffer.from(msg), port, addr, socket: fake });
        if (typeof cb === 'function') cb(null);
      },
      close() { fake.closed = true; },
      unref() {},
      setBroadcast() {},
      bind() {},
      setMulticastInterface() {},
    };
    sockets.push(fake);
    return fake;
  };
}

function restoreRealDgram() {
  dgram.createSocket = realCreateSocket;
}

// Patch BEFORE the dynamic import triggers `new Sender()` construction inside
// createSacnOutput — the call site is what matters, not module load order
// (see the file-header note).
installFakeDgram();
const { createSacnOutput } = await import('../../lib/sacn_output.js');
restoreRealDgram();

/** Re-installs the fake for the duration of a single test, always via `dgram`
 * directly (never a captured local reference) so it patches the SAME shared
 * builtin module object `sacn_output.js`'s `Sender`s call into. */
before(() => {});
after(() => { restoreRealDgram(); });

function withFakeDgram(fn) {
  return async () => {
    installFakeDgram();
    try {
      await fn();
    } finally {
      restoreRealDgram();
    }
  };
}

test('one datagram per (universe, destination) per frame; parsed fields correct',
  withFakeDgram(async () => {
    const out = createSacnOutput({
      universes: [1, 2], destinations: ['127.0.0.1', '127.0.0.2'],
      priority: 100, sourceName: 'MarsinEngine',
    });
    out.start();
    const u1 = new Uint8Array(512);
    const u2 = new Uint8Array(512);
    await out.sendFrame({ 1: u1, 2: u2 });

    assert.equal(captured.length, 4, '2 universes x 2 destinations = 4 datagrams');
    for (const { msg } of captured) {
      const p = new Packet(msg);
      assert.ok(p.universe === 1 || p.universe === 2, `unexpected universe ${p.universe}`);
      assert.equal(p.priority, 100);
      assert.equal(p.sourceName, 'MarsinEngine');
    }
    const universes = captured.map(({ msg }) => new Packet(msg).universe).sort();
    assert.deepEqual(universes, [1, 1, 2, 2]);
    out.stop();
  }));

test('sendFrame before start() sends nothing; sendFrame after stop() sends nothing and does not throw',
  withFakeDgram(async () => {
    const out = createSacnOutput({ universes: [1], destinations: ['127.0.0.1'] });
    const buf = new Uint8Array(512);

    await out.sendFrame({ 1: buf });
    assert.equal(captured.length, 0, 'no datagram before start()');

    out.start();
    await out.sendFrame({ 1: buf });
    assert.equal(captured.length, 1, 'one datagram once started');

    out.stop();
    await assert.doesNotReject(() => out.sendFrame({ 1: buf }));
    assert.equal(captured.length, 1, 'no additional datagram after stop()');
  }));

test('addUniverse is idempotent: calling it twice does not double the sender count',
  withFakeDgram(async () => {
    const out = createSacnOutput({ universes: [], destinations: ['127.0.0.1', '127.0.0.2'] });
    out.addUniverse(3);
    out.addUniverse(3); // second call must be a no-op (sacn_output.js:41)
    out.start();
    await out.sendFrame({ 3: new Uint8Array(512) });
    assert.equal(captured.length, 2, 'exactly destinations.length datagrams for U3, not 4');
    out.stop();
  }));

test('zero-channel wire truth: a value dropping to 0 is carried as 0 on the wire, not omitted',
  withFakeDgram(async () => {
    const out = createSacnOutput({ universes: [1], destinations: ['127.0.0.1'], priority: 100 });
    out.start();

    const frameA = new Uint8Array(512);
    frameA[9] = 200; // channel 10 (1-indexed) lit
    await out.sendFrame({ 1: frameA });
    const pA = new Packet(captured[0].msg);
    assert.notEqual(pA.payloadAsBuffer[9], 0, 'sanity: channel 10 is non-zero while lit');

    captured.length = 0;
    const frameB = new Uint8Array(512);
    frameB[9] = 0; // same channel turned OFF
    await out.sendFrame({ 1: frameB });
    assert.equal(captured.length, 1);
    const pB = new Packet(captured[0].msg);
    // The sparse payload build (sacn_output.js:75-79) omits zero channels from
    // the `payload` object it hands to the sacn lib, but the lib always emits
    // a full 512-byte frame (packet.js:131 `empty(512)`) — so an omitted key
    // must still land as an explicit 0 on the wire. This is the pin that a
    // pixel turning OFF actually reaches the fixture as OFF, not "unchanged".
    assert.equal(pB.payloadAsBuffer[9], 0, 'channel 10 must be 0 on the wire, not left stale');
    out.stop();
  }));

test('1-indexing: buffer byte 0 lands on parsed DMX channel 1 (index 0), not channel 0',
  withFakeDgram(async () => {
    const out = createSacnOutput({ universes: [1], destinations: ['127.0.0.1'] });
    out.start();
    const buf = new Uint8Array(512);
    buf[0] = 42;
    await out.sendFrame({ 1: buf });
    const p = new Packet(captured[0].msg);
    // Exact since report 20260805_170 — this used to assert only `!== 0`,
    // because the percent scale turned 42 into 107 on the wire.
    assert.equal(p.payloadAsBuffer[0], 42, 'channel 1 (byte index 0) carries the value');
    out.stop();
  }));

test('sequence increments by 1 per packet per universe and wraps mod 256',
  withFakeDgram(async () => {
    const out = createSacnOutput({ universes: [1], destinations: ['127.0.0.1'] });
    out.start();
    const buf = new Uint8Array(512);
    const seqs = [];
    for (let i = 0; i < 258; i++) {
      captured.length = 0;
      await out.sendFrame({ 1: buf });
      seqs.push(new Packet(captured[0].msg).sequence);
    }
    assert.deepEqual(seqs.slice(0, 5), [0, 1, 2, 3, 4]);
    assert.equal(seqs[255], 255);
    assert.equal(seqs[256], 0, 'wraps mod 256');
    assert.equal(seqs[257], 1);
    out.stop();
  }));

test('stop() closes every fake socket exactly once; a second stop() does not throw',
  withFakeDgram(async () => {
    const out = createSacnOutput({ universes: [1, 2], destinations: ['127.0.0.1', '127.0.0.2'] });
    out.start();
    out.stop();
    assert.equal(sockets.length, 4, '2 universes x 2 destinations = 4 sockets created');
    assert.ok(sockets.every((s) => s.closed), 'every socket was closed');
    assert.doesNotThrow(() => out.stop());
  }));

test('value bytes: 0 stays 0 and 255 stays 255 on the wire',
  withFakeDgram(async () => {
    const out = createSacnOutput({ universes: [1], destinations: ['127.0.0.1'] });
    out.start();

    const zeroFrame = new Uint8Array(512); // all zero
    await out.sendFrame({ 1: zeroFrame });
    const pZero = new Packet(captured[0].msg);
    assert.equal(pZero.payloadAsBuffer[0], 0);

    captured.length = 0;
    const fullFrame = new Uint8Array(512).fill(255);
    await out.sendFrame({ 1: fullFrame });
    const pFull = new Packet(captured[0].msg);
    for (let i = 0; i < 512; i++) {
      assert.equal(pFull.payloadAsBuffer[i], 255, `channel ${i + 1} must be 255`);
    }
    out.stop();
  }));

test('R-D1: EVERY DMX value 0..255 reaches the wire unchanged — the full identity table',
  withFakeDgram(async () => {
    // The table this file deferred until S-D1 landed (report 20260805_170,
    // `_157` D1 / `_153` F1b). Before the fix this read
    // `0 1 2 50 99 100 101 128 200 255 -> 0 3 5 127 252 255 255 255 255 255`:
    // a ×2.55 percent scale that saturated everything above DMX 100 to full and
    // crushed colour toward white on every controller on the ship.
    const out = createSacnOutput({ universes: [1], destinations: ['127.0.0.1'] });
    out.start();
    const distortions = [];
    for (let v = 0; v <= 255; v++) {
      captured.length = 0;
      const frame = new Uint8Array(512);
      // First, middle and last channel — the value must not depend on position.
      frame[0] = v; frame[255] = v; frame[511] = v;
      await out.sendFrame({ 1: frame });
      const slots = new Packet(captured[0].msg).payloadAsBuffer;
      for (const i of [0, 255, 511]) {
        if (slots[i] !== v) distortions.push({ value: v, channel: i + 1, wire: slots[i] });
      }
    }
    assert.deepEqual(distortions, [],
      'the engine\'s DMX value and the byte on the wire must be the same number, always');
    out.stop();
  }));

test('R-D1: the raw-DMX declaration is on the SENDER, not just the frame',
  withFakeDgram(async () => {
    // Guards the actual mechanism: `useRawDmxValues` lives in
    // `defaultPacketOptions`, which `Sender.send()` spreads FIRST
    // (sender.js:56). Moving it to the per-send object (or dropping it) would
    // silently restore the ×2.55 scale on some path — e.g. a resend — while the
    // table above still passed on the ordinary one.
    const src = await readFile(new URL('../../lib/sacn_output.js', import.meta.url), 'utf8');
    assert.match(src, /defaultPacketOptions: \{[^}]*useRawDmxValues: true/s,
      'sacn_output.js must declare useRawDmxValues in defaultPacketOptions');
  }));

test('createSacnOutput always creates udp4 sockets (never udp6 or a real bind)',
  withFakeDgram(async () => {
    let seenType = null;
    dgram.createSocket = function (opts) {
      seenType = opts && opts.type;
      return { send(msg, port, addr, cb) { cb(null); }, close() {}, unref() {}, setBroadcast() {}, bind() {}, setMulticastInterface() {} };
    };
    const out = createSacnOutput({ universes: [1], destinations: ['127.0.0.1'] });
    out.start();
    assert.equal(seenType, 'udp4');
    out.stop();
  }));
