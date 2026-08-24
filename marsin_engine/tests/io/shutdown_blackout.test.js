/**
 * shutdown_blackout.test.js — the last frame the engine sends must zero EVERY
 * channel, including the DMX-only ones no pixel owns.
 *
 * WHY (report 20260823_361 §8). `shutdown()` built its blackout by zeroing
 * `model.pixels` and re-running `mapPixelsToSacn()`. That mapper writes only
 * the channel slots of PATCHED PIXELS, so a fogger / haze / horn / fire relay —
 * written as raw bytes by `GlobalEffectsController.applyDmx()` on the render
 * path, which shutdown never runs — kept its last value in the router buffer
 * and rode out on the final packet. A fogger caught mid-burst therefore stayed
 * ON, permanently, with nothing left transmitting to turn it back off. That is
 * a physical-safety failure, not a lighting glitch.
 *
 * The first test is the end-to-end proof against the REAL router, the REAL
 * pixel mapper and the REAL effects controller: it reproduces the latch, pins
 * that the old pixel-only approach does not clear it, and shows
 * `buildBlackoutFrames()` does.
 *
 * The wire tests use the same fake-`dgram` technique as
 * `sacn_output_wire.test.js` (patch `dgram.createSocket` BEFORE
 * `createSacnOutput()` builds its `Sender`s), so nothing here can transmit —
 * and the destination is the RFC 5737 black hole regardless.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { UniverseRouter } from '../../../simulation/src/dmx/universe_router.js';
import { mapPixelsToSacn } from '../../../simulation/src/dmx/sacn_mapper.js';
import { GlobalEffectsController } from '../../lib/global_effects_controller.js';
import {
  buildBlackoutFrames,
  verifyBlackoutFrames,
  assertBlackoutSenders,
  DMX_UNIVERSE_SIZE,
} from '../../lib/shutdown_blackout.js';
import { SACN_BLACK_HOLE_HOST } from '../helpers/sacn_black_hole.mjs';

const require = createRequire(import.meta.url);
const { Packet } = require('sacn/dist/packet.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_JS = path.resolve(__dirname, '..', '..', 'engine.js');

// ── DMX-only patch under test ───────────────────────────────────────────────
// Addresses well clear of the pixel block so a failure can only mean "the
// blackout skipped a channel no pixel owns".
const PIXEL_UNIVERSE = 3;
const FOG_ADDR = 100;      // single-channel fog relay
const HAZE_ADDR = 120;     // ChauvetHaze4D — TWO channels
const HORN_ADDR = 200;
const FIRE_ADDR = 300;

function makePixel(universe, addr) {
  return {
    patch: { universe, addr, footprint: 6 },
    channels: { r: 1, g: 2, b: 3, w: 4, a: 5, u: 6 },
    r: 1, g: 1, b: 1, w: 1, a: 1, u: 1,
  };
}

function specialEffectsModel() {
  return [
    { kind: 'fog', fixtureType: 'FogMachine', patch: { universe: PIXEL_UNIVERSE, addr: FOG_ADDR } },
    { kind: 'haze', fixtureType: 'ChauvetHaze4D', patch: { universe: PIXEL_UNIVERSE, addr: HAZE_ADDR } },
    { kind: 'horn', fixtureType: 'AirHorn', patch: { universe: PIXEL_UNIVERSE, addr: HORN_ADDR } },
    { kind: 'fire', fixtureType: 'FireRelay', patch: { universe: PIXEL_UNIVERSE, addr: FIRE_ADDR } },
  ];
}

// ── The safety proof ────────────────────────────────────────────────────────

test('DMX-only fixtures (fog/haze/horn/fire) are ZEROED by the shutdown blackout', () => {
  const router = new UniverseRouter();
  router.addUniverse(PIXEL_UNIVERSE);
  const pixels = [makePixel(PIXEL_UNIVERSE, 1), makePixel(PIXEL_UNIVERSE, 7)];

  const gec = new GlobalEffectsController({ engine: { fps: 40 }, modelPixelCount: pixels.length });
  gec.initFromModel(specialEffectsModel());
  gec.setEffect('fogger', true);
  gec.setEffect('horn', true);
  gec.setEffect('fire', true);

  // One live render frame: pixels lit, every DMX-only relay energized.
  mapPixelsToSacn(pixels, router);
  const frame = router.getFullFrame(PIXEL_UNIVERSE);
  gec.applyDmx({ [PIXEL_UNIVERSE]: frame }, { blackout: false });

  assert.equal(frame[FOG_ADDR - 1], 255, 'sanity: fog relay is energized');
  assert.equal(frame[HAZE_ADDR - 1], 255, 'sanity: haze ch1 is energized');
  assert.equal(frame[HAZE_ADDR], 255, 'sanity: haze ch2 is energized');
  assert.equal(frame[HORN_ADDR - 1], 255, 'sanity: horn is energized');
  assert.equal(frame[FIRE_ADDR - 1], 255, 'sanity: fire relay is energized');

  // THE BUG, pinned: the old shutdown blackout — zero the pixels, re-map —
  // does not reach a single one of those channels.
  for (const px of pixels) { px.r = 0; px.g = 0; px.b = 0; px.w = 0; px.a = 0; px.u = 0; }
  mapPixelsToSacn(pixels, router);
  assert.equal(frame[FOG_ADDR - 1], 255,
    'regression guard: a pixel-only blackout leaves the fog relay latched ON');
  assert.equal(frame[HORN_ADDR - 1], 255,
    'regression guard: a pixel-only blackout leaves the horn latched ON');
  assert.equal(frame[FIRE_ADDR - 1], 255,
    'regression guard: a pixel-only blackout leaves the fire relay latched ON');

  // THE FIX: every channel of the universe, whatever wrote it.
  const blackout = buildBlackoutFrames({ dmxRouter: router, universeIds: [PIXEL_UNIVERSE] });
  verifyBlackoutFrames(blackout);

  assert.deepEqual(blackout.universes, [PIXEL_UNIVERSE]);
  const black = blackout.frames[PIXEL_UNIVERSE];
  assert.equal(black.length, DMX_UNIVERSE_SIZE);
  for (const [name, addr] of [['fog', FOG_ADDR], ['haze', HAZE_ADDR], ['horn', HORN_ADDR],
    ['fire', FIRE_ADDR]]) {
    assert.equal(black[addr - 1], 0, `${name} relay must be 0 in the blackout frame`);
  }
  assert.equal(black[HAZE_ADDR], 0, 'haze ch2 must be 0 in the blackout frame');
  for (let ch = 0; ch < DMX_UNIVERSE_SIZE; ch++) {
    assert.equal(black[ch], 0, `channel ${ch + 1} must be 0 in the blackout frame`);
  }
});

test('a channel orphaned by a re-patch (no pixel, no effect owns it) is zeroed too', () => {
  const router = new UniverseRouter();
  router.addUniverse(1);
  // Stale latch: whatever wrote channel 400 is long gone from the model, so no
  // owner-driven blackout can ever clear it.
  router.getFullFrame(1)[399] = 190;

  const blackout = buildBlackoutFrames({ dmxRouter: router, universeIds: [1] });
  verifyBlackoutFrames(blackout);
  assert.equal(blackout.frames[1][399], 0);
});

test('universes pruned from the transmit list are still blacked out', () => {
  // A model reload drops a universe from `universeIds` but the router keeps its
  // buffer. The blackout covers the UNION so nothing we might still be driving
  // is skipped.
  const router = new UniverseRouter();
  router.addUniverse(1);
  router.addUniverse(4);
  router.getFullFrame(4)[10] = 255;

  const blackout = buildBlackoutFrames({ dmxRouter: router, universeIds: [1] });
  assert.deepEqual(blackout.universes, [1, 4]);
  assert.equal(blackout.frames[4][10], 0);
  verifyBlackoutFrames(blackout);
});

// ── Fail-loud paths (no silent best-effort) ─────────────────────────────────

test('a universe with no router buffer FAILS LOUDLY, naming it', () => {
  const router = new UniverseRouter();
  router.addUniverse(1);
  assert.throws(
    () => buildBlackoutFrames({ dmxRouter: router, universeIds: [1, 9] }),
    /universe 9 has no router buffer/,
  );
});

test('a short universe buffer FAILS LOUDLY rather than sending a partial blackout', () => {
  const stubRouter = {
    listUniverses: () => [2],
    getFullFrame: () => new Uint8Array(64),
  };
  assert.throws(
    () => buildBlackoutFrames({ dmxRouter: stubRouter, universeIds: [2] }),
    /universe 2 buffer is 64 channels, expected 512/,
  );
});

test('no universes at all FAILS LOUDLY instead of reporting a vacuous blackout', () => {
  const router = new UniverseRouter();
  assert.throws(
    () => buildBlackoutFrames({ dmxRouter: router, universeIds: [] }),
    /no universes to black out/,
  );
});

test('a missing router FAILS LOUDLY', () => {
  assert.throws(() => buildBlackoutFrames({ dmxRouter: null, universeIds: [1] }),
    /no DMX router with getFullFrame/);
});

test('verifyBlackoutFrames refuses a frame that is not dark, naming universe + channel', () => {
  const frame = new Uint8Array(DMX_UNIVERSE_SIZE);
  frame[FOG_ADDR - 1] = 255;   // a late writer re-lit the fog relay after zeroing
  assert.throws(
    () => verifyBlackoutFrames({ frames: { 3: frame }, universes: [3] }),
    /universe 3 is NOT dark: ch100=255/,
  );
});

test('verifyBlackoutFrames refuses a universe missing from the frame set', () => {
  assert.throws(
    () => verifyBlackoutFrames({ frames: {}, universes: [7] }),
    /universe 7 is missing from the blackout frame set/,
  );
});

test('assertBlackoutSenders refuses a universe with no sACN sender', () => {
  const sacnOut = { hasUniverse: (u) => u === 1 };
  assert.throws(
    () => assertBlackoutSenders({ universes: [1, 5] }, sacnOut),
    /no sACN sender for universe\(s\) 5/,
  );
  assert.doesNotThrow(() => assertBlackoutSenders({ universes: [1] }, sacnOut));
});

test('assertBlackoutSenders refuses an sACN output that cannot answer the question', () => {
  assert.throws(
    () => assertBlackoutSenders({ universes: [1] }, {}),
    /has no hasUniverse\(\)/,
  );
});

// ── Wire behaviour of the blackout send ─────────────────────────────────────

const realCreateSocket = dgram.createSocket;
/** @type {Array<{msg: Buffer}>} */
let captured = [];
/** Next send()'s error, consumed once — lets one datagram fail on demand. */
let sendError = null;

function installFakeDgram() {
  captured = [];
  sendError = null;
  dgram.createSocket = function fakeCreateSocket() {
    return {
      send(msg, port, addr, cb) {
        captured.push({ msg: Buffer.from(msg) });
        const err = sendError;
        sendError = null;
        if (typeof cb === 'function') cb(err);
      },
      close() {},
      unref() {},
      setBroadcast() {},
      bind() {},
      setMulticastInterface() {},
    };
  };
}

installFakeDgram();
const { createSacnOutput } = await import('../../lib/sacn_output.js');
dgram.createSocket = realCreateSocket;

function withFakeDgram(fn) {
  return async () => {
    installFakeDgram();
    try {
      await fn();
    } finally {
      dgram.createSocket = realCreateSocket;
    }
  };
}

test('an all-zero blackout buffer lands as 512 explicit zeros on the wire',
  withFakeDgram(async () => {
    const out = createSacnOutput({
      universes: [PIXEL_UNIVERSE], destinations: [SACN_BLACK_HOLE_HOST],
    });
    out.start();
    const result = await out.sendFrameChecked({ [PIXEL_UNIVERSE]: new Uint8Array(512) });

    assert.deepEqual(result.failures, []);
    assert.equal(result.attempted, 1);
    assert.equal(result.delivered, 1);
    assert.equal(captured.length, 1);
    const wire = new Packet(captured[0].msg).payloadAsBuffer;
    // The sparse payload build omits zero channels, but the packet is always a
    // full 512-byte frame — so the fog relay's channel is an explicit 0 here.
    for (let ch = 0; ch < DMX_UNIVERSE_SIZE; ch++) {
      assert.equal(wire[ch], 0, `wire channel ${ch + 1} must be 0`);
    }
    out.stop();
  }));

test('sendFrameChecked REPORTS a failed datagram instead of swallowing it',
  withFakeDgram(async () => {
    const out = createSacnOutput({ universes: [1], destinations: [SACN_BLACK_HOLE_HOST] });
    out.start();
    sendError = new Error('ENETUNREACH');
    const result = await out.sendFrameChecked({ 1: new Uint8Array(512) });

    assert.equal(result.delivered, 0);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].universe, 1);
    assert.equal(result.failures[0].destination, SACN_BLACK_HOLE_HOST);
    assert.match(result.failures[0].error, /ENETUNREACH/);
    out.stop();
  }));

test('sendFrameChecked REPORTS a universe that has no sender',
  withFakeDgram(async () => {
    const out = createSacnOutput({ universes: [1], destinations: [SACN_BLACK_HOLE_HOST] });
    out.start();
    assert.equal(out.hasUniverse(1), true);
    assert.equal(out.hasUniverse(2), false);

    const result = await out.sendFrameChecked({ 1: new Uint8Array(512), 2: new Uint8Array(512) });
    assert.equal(result.attempted, 1, 'only U1 had a transport');
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].universe, 2);
    assert.match(result.failures[0].error, /no sender/);
    out.stop();
  }));

test('sendFrameChecked on a stopped sender THROWS rather than dropping the blackout',
  withFakeDgram(async () => {
    const out = createSacnOutput({ universes: [1], destinations: [SACN_BLACK_HOLE_HOST] });
    await assert.rejects(() => out.sendFrameChecked({ 1: new Uint8Array(512) }),
      /called on a stopped sender/);
    assert.equal(captured.length, 0);
  }));

// ── Wiring: engine.js shutdown() actually uses all of the above ─────────────

test('structural: shutdown() builds, proves and checked-sends the whole-universe blackout', () => {
  const src = fs.readFileSync(ENGINE_JS, 'utf8');
  const start = src.indexOf('function shutdown(afterClose = null)');
  assert.ok(start > 0, 'shutdown() not found — has it moved/renamed?');
  const end = src.indexOf('\n  process.on(\'SIGINT\'', start);
  assert.ok(end > start, 'could not find the end of shutdown()');
  const body = src.slice(start, end);

  for (const needle of ['buildBlackoutFrames({ dmxRouter, universeIds })',
    'assertBlackoutSenders(blackout, sacnOut)', 'verifyBlackoutFrames(blackout)',
    'sacnOut.sendFrameChecked(', 'reportBlackoutFailure(']) {
    assert.ok(body.includes(needle), `shutdown() must call ${needle}`);
  }
  // The blackout must NOT be derived from the pixel mapper any more — that is
  // exactly the path that skipped every DMX-only fixture.
  assert.ok(!body.includes('mapPixelsToSacn('),
    'shutdown() must not build its blackout from mapPixelsToSacn — it only writes pixel channels');
  // An unconfirmed blackout must change the exit code, both on the normal path
  // and on the 2s watchdog.
  assert.ok(body.includes('process.exitCode = 1'),
    'a failed/unconfirmed blackout must set a non-zero exit code');
  assert.ok(!/process\.exit\(0\)/.test(body),
    'no exit path may hardcode 0 — an unconfirmed blackout must not report success');
});
