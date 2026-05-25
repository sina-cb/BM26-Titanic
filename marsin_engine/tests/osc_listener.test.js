// Unit + integration tests for OscListener.
// See docs/24_osc_integration.md §14.2 and impl plan Phase 3.8.
//
// Run:  cd marsin_engine && node --test tests/osc_listener.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import * as osc from 'osc-min';

import {
  OscListener,
  normalizeIp,
  coerceArg,
} from '../lib/osc_listener.js';

// ── Test doubles ───────────────────────────────────────────────────────────

/**
 * Minimal CPC stand-in that records every setMany / set / setHsvField
 * and exposes a schema matching the live registry's shape closely
 * enough for binding construction to work. Real CPC behaviour
 * (clamping, source-lock) is covered by param_center.test.js.
 */
function makeMockParamCenter(extraEntries = []) {
  const baseSchema = [
    { key: 'speed', label: 'Speed', type: 'float', range: [0, 1], default: 0.5,
      oscAddress: '/marsin/param/speed', live: false, broadcastHz: 30, persist: true, portWatch: true },
    { key: 'rotate', label: 'Rotate', type: 'float', range: [0, 1], default: 0,
      oscAddress: '/marsin/param/rotate', live: false, broadcastHz: 30, persist: true, portWatch: true },
    { key: 'size', label: 'Size', type: 'float', range: [0, 1], default: 0.5,
      oscAddress: '/marsin/param/size', live: false, broadcastHz: 30, persist: true, portWatch: true },
    { key: 'colorPalette1', label: 'Color 1', type: 'hsv', range: [0, 1],
      default: { h: 0, s: 1, v: 1 },
      oscAddress: '/marsin/param/colorPalette1', live: false, broadcastHz: 30, persist: true, portWatch: true },
    { key: 'stemsVocals', label: 'Stems · Vocals', type: 'float', range: [0, 1], default: 0,
      oscAddress: '/marsin/stems/vocals', live: true, broadcastHz: 15, persist: false, portWatch: false },
    ...extraEntries,
  ];
  return {
    calls: [],
    getSchema() { return baseSchema; },
    setMany(writes, source, origin) {
      this.calls.push({ method: 'setMany', writes, source, origin });
      return { status: 'ok', changedKeys: writes.map(w => w.key), revision: this.calls.length };
    },
    set(key, value, source, origin) {
      this.calls.push({ method: 'set', key, value, source, origin });
      return { status: 'ok', revision: this.calls.length };
    },
    setHsvField(key, field, value, source, origin) {
      this.calls.push({ method: 'setHsvField', key, field, value, source, origin });
      return { status: 'ok', revision: this.calls.length };
    },
  };
}

function makePacket(address, args) {
  const buf = osc.toBuffer({ address, args });
  return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
}

function makeRinfo(address, port = 5000) {
  return { address, port, family: 'IPv4', size: 0 };
}

// ── normalizeIp ────────────────────────────────────────────────────────────

test('normalizeIp strips IPv4-mapped IPv6', () => {
  assert.equal(normalizeIp('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeIp('::ffff:192.168.1.42'), '192.168.1.42');
  assert.equal(normalizeIp('::FFFF:10.0.0.1'), '10.0.0.1');
});

test('normalizeIp collapses ::1 to 127.0.0.1', () => {
  assert.equal(normalizeIp('::1'), '127.0.0.1');
});

test('normalizeIp lowercases v6 addresses', () => {
  assert.equal(normalizeIp('FE80::1'), 'fe80::1');
});

test('normalizeIp returns null for non-strings', () => {
  assert.equal(normalizeIp(null), null);
  assert.equal(normalizeIp(undefined), null);
  assert.equal(normalizeIp(42), null);
});

// ── coerceArg ──────────────────────────────────────────────────────────────

test('coerceArg accepts plain numbers', () => {
  assert.equal(coerceArg(0.42), 0.42);
  assert.equal(coerceArg(0), 0);
});

test('coerceArg accepts osc-min typed objects', () => {
  assert.equal(coerceArg({ type: 'float', value: 0.5 }), 0.5);
  assert.equal(coerceArg({ type: 'integer', value: 3 }), 3);
});

test('coerceArg accepts numeric strings via osc string args', () => {
  assert.equal(coerceArg({ type: 'string', value: '0.7' }), 0.7);
  assert.equal(coerceArg({ type: 'string', value: 'foo' }), null);
});

test('coerceArg returns null for unhandled shapes', () => {
  assert.equal(coerceArg(null), null);
  assert.equal(coerceArg({ type: 'blob' }), null);
  assert.equal(coerceArg(NaN), null);
});

// ── Constructor validation ─────────────────────────────────────────────────

test('throws when paramCenter is missing setMany', () => {
  assert.throws(() => new OscListener({ port: 6970, paramCenter: {} }));
});

test('throws on out-of-range port', () => {
  const pc = makeMockParamCenter();
  assert.throws(() => new OscListener({ port: 0, paramCenter: pc }));
  assert.throws(() => new OscListener({ port: 99999, paramCenter: pc }));
});

test('canonical address bindings built from schema', () => {
  const pc = makeMockParamCenter();
  const l = new OscListener({ port: 6970, paramCenter: pc });
  assert.equal(l._bindingsByAddr.get('/marsin/param/speed').length, 1);
  // HSV gets three sub-address bindings.
  assert.ok(l._bindingsByAddr.has('/marsin/param/colorPalette1/h'));
  assert.ok(l._bindingsByAddr.has('/marsin/param/colorPalette1/s'));
  assert.ok(l._bindingsByAddr.has('/marsin/param/colorPalette1/v'));
});

test('throws on custom binding referencing unknown CPC key', () => {
  const pc = makeMockParamCenter();
  assert.throws(() => new OscListener({
    port: 6970, paramCenter: pc,
    bindings: { '/x': 'nonexistent' },
  }), /unknown CPC key/);
});

test('throws on custom binding colliding with canonical address', () => {
  const pc = makeMockParamCenter();
  assert.throws(() => new OscListener({
    port: 6970, paramCenter: pc,
    bindings: { '/marsin/param/speed': 'rotate' },
  }), /collides with a canonical/);
});

test('throws on HSV shorthand', () => {
  const pc = makeMockParamCenter();
  assert.throws(() => new OscListener({
    port: 6970, paramCenter: pc,
    bindings: { '/c1': 'colorPalette1' },
  }), /HSV-typed/);
});

test('throws on negative or non-integer arg', () => {
  const pc = makeMockParamCenter();
  assert.throws(() => new OscListener({
    port: 6970, paramCenter: pc,
    bindings: { '/x': { key: 'speed', arg: -1 } },
  }));
  assert.throws(() => new OscListener({
    port: 6970, paramCenter: pc,
    bindings: { '/x': { key: 'speed', arg: 1.5 } },
  }));
  assert.throws(() => new OscListener({
    port: 6970, paramCenter: pc,
    bindings: { '/x': { key: 'speed', arg: 32 } },
  }));
});

test('throws on missing allowedSenders fields', () => {
  const pc = makeMockParamCenter();
  assert.throws(() => new OscListener({
    port: 6970, paramCenter: pc,
    allowedSenders: [{ name: 'a' }],
  }));
  assert.throws(() => new OscListener({
    port: 6970, paramCenter: pc,
    allowedSenders: [{ ip: '127.0.0.1' }],
  }));
});

test('throws on unparseable IP in allowedSenders', () => {
  const pc = makeMockParamCenter();
  assert.throws(() => new OscListener({
    port: 6970, paramCenter: pc,
    allowedSenders: [{ name: 'bad', ip: 'not-an-ip' }],
  }));
});

test('throws on duplicate sender name', () => {
  const pc = makeMockParamCenter();
  assert.throws(() => new OscListener({
    port: 6970, paramCenter: pc,
    allowedSenders: [
      { name: 'dup', ip: '127.0.0.1' },
      { name: 'dup', ip: '192.168.0.1' },
    ],
  }));
});

// ── Dispatch (against mock) ────────────────────────────────────────────────

function dispatchPacket(listener, address, args, rinfoAddr = '127.0.0.1') {
  const buf = makePacket(address, args);
  listener._onPacket(buf, makeRinfo(rinfoAddr));
}

// OSC 'float' is wire-encoded as IEEE-754 float32, so a JS number
// like 0.42 round-trips as 0.41999998... Tolerance comparisons.
const FLOAT_TOL = 1e-3;

test('canonical scalar dispatches via setMany', () => {
  const pc = makeMockParamCenter();
  const l = new OscListener({ port: 6970, paramCenter: pc });
  dispatchPacket(l, '/marsin/param/speed', [0.42]);
  assert.equal(pc.calls.length, 1);
  assert.equal(pc.calls[0].method, 'setMany');
  assert.equal(pc.calls[0].writes.length, 1);
  assert.equal(pc.calls[0].writes[0].kind, 'scalar');
  assert.equal(pc.calls[0].writes[0].key, 'speed');
  assert.ok(Math.abs(pc.calls[0].writes[0].value - 0.42) < FLOAT_TOL);
  assert.equal(pc.calls[0].source, 'osc');
});

test('canonical HSV sub-address dispatches via setMany with kind:hsv', () => {
  const pc = makeMockParamCenter();
  const l = new OscListener({ port: 6970, paramCenter: pc });
  dispatchPacket(l, '/marsin/param/colorPalette1/s', [0.25]);
  assert.equal(pc.calls.length, 1);
  assert.equal(pc.calls[0].writes[0].kind, 'hsv');
  assert.equal(pc.calls[0].writes[0].key, 'colorPalette1');
  assert.equal(pc.calls[0].writes[0].field, 's');
  assert.ok(Math.abs(pc.calls[0].writes[0].value - 0.25) < FLOAT_TOL);
});

test('object-form binding routes multiple writes into ONE setMany', () => {
  const pc = makeMockParamCenter();
  const l = new OscListener({
    port: 6970, paramCenter: pc,
    bindings: {
      '/touchosc/xy1': [
        { key: 'rotate', arg: 0 },
        { key: 'size',   arg: 1 },
      ],
    },
  });
  dispatchPacket(l, '/touchosc/xy1', [0.3, 0.7]);
  assert.equal(pc.calls.length, 1, 'exactly one setMany call');
  assert.equal(pc.calls[0].writes.length, 2);
  assert.equal(pc.calls[0].writes[0].key, 'rotate');
  assert.ok(Math.abs(pc.calls[0].writes[0].value - 0.3) < FLOAT_TOL);
  assert.equal(pc.calls[0].writes[1].key, 'size');
  assert.ok(Math.abs(pc.calls[0].writes[1].value - 0.7) < FLOAT_TOL);
});

test('unknown OSC address increments dropped, no setMany', () => {
  const pc = makeMockParamCenter();
  const l = new OscListener({ port: 6970, paramCenter: pc });
  dispatchPacket(l, '/totally/unknown', [0.5]);
  assert.equal(pc.calls.length, 0);
  assert.equal(l.getStatus().droppedMessagesPerSec, 1);
});

test('missing arg index increments invalid; sibling bindings still dispatch', () => {
  const pc = makeMockParamCenter();
  const l = new OscListener({
    port: 6970, paramCenter: pc,
    bindings: {
      '/touchosc/xy1': [
        { key: 'rotate', arg: 0 },
        { key: 'size',   arg: 1 },
      ],
    },
  });
  dispatchPacket(l, '/touchosc/xy1', [0.3]);   // only one arg present
  assert.equal(pc.calls.length, 1);
  assert.equal(pc.calls[0].writes.length, 1);
  assert.equal(pc.calls[0].writes[0].key, 'rotate');
  assert.ok(Math.abs(pc.calls[0].writes[0].value - 0.3) < FLOAT_TOL);
  assert.equal(l.getStatus().invalidMessagesPerSec, 1);
});

test('bad arg type increments invalid', () => {
  const pc = makeMockParamCenter();
  const l = new OscListener({ port: 6970, paramCenter: pc });
  // String "foo" can't coerce to a number.
  dispatchPacket(l, '/marsin/param/speed', [{ type: 'string', value: 'foo' }]);
  assert.equal(pc.calls.length, 0);
  assert.equal(l.getStatus().invalidMessagesPerSec, 1);
});

// ── Allowlist (with IP normalization) ──────────────────────────────────────

test('allowlist allows configured IP, drops unknown', () => {
  const pc = makeMockParamCenter();
  const l = new OscListener({
    port: 6970, paramCenter: pc,
    allowedSenders: [{ name: 'dev', ip: '127.0.0.1' }],
  });
  dispatchPacket(l, '/marsin/param/speed', [0.5], '127.0.0.1');
  dispatchPacket(l, '/marsin/param/speed', [0.6], '192.168.1.99');
  assert.equal(pc.calls.length, 1, 'only the allowlisted IP got through');
  assert.equal(pc.calls[0].origin, 'osc:dev');
  assert.equal(l.getStatus().droppedMessagesPerSec, 1);
});

test('allowlist: 127.0.0.1 accepts incoming ::ffff:127.0.0.1', () => {
  const pc = makeMockParamCenter();
  const l = new OscListener({
    port: 6970, paramCenter: pc,
    allowedSenders: [{ name: 'dev', ip: '127.0.0.1' }],
  });
  dispatchPacket(l, '/marsin/param/speed', [0.42], '::ffff:127.0.0.1');
  assert.equal(pc.calls.length, 1);
  assert.equal(pc.calls[0].origin, 'osc:dev');
});

test('allowlist: ::1 normalized to 127.0.0.1 matches v4 config', () => {
  const pc = makeMockParamCenter();
  const l = new OscListener({
    port: 6970, paramCenter: pc,
    allowedSenders: [{ name: 'dev', ip: '127.0.0.1' }],
  });
  dispatchPacket(l, '/marsin/param/speed', [0.42], '::1');
  assert.equal(pc.calls.length, 1);
  assert.equal(pc.calls[0].origin, 'osc:dev');
});

test('allowlist: ::1 config accepts incoming 127.0.0.1', () => {
  const pc = makeMockParamCenter();
  const l = new OscListener({
    port: 6970, paramCenter: pc,
    allowedSenders: [{ name: 'dev', ip: '::1' }],
  });
  dispatchPacket(l, '/marsin/param/speed', [0.42], '127.0.0.1');
  assert.equal(pc.calls.length, 1);
});

test('open mode (empty allowlist) accepts any IP and tags origin with addr', () => {
  const pc = makeMockParamCenter();
  const l = new OscListener({ port: 6970, paramCenter: pc, allowedSenders: [] });
  dispatchPacket(l, '/marsin/param/speed', [0.42], '203.0.113.5');
  assert.equal(pc.calls.length, 1);
  assert.ok(/^osc:203\.0\.113\.5:/.test(pc.calls[0].origin), `origin was ${pc.calls[0].origin}`);
});

// ── Malformed packet ───────────────────────────────────────────────────────

test('malformed packet increments invalid and does not crash', () => {
  const pc = makeMockParamCenter();
  const l = new OscListener({ port: 6970, paramCenter: pc });
  l._onPacket(Buffer.from('not a real osc packet'), makeRinfo('127.0.0.1'));
  assert.equal(pc.calls.length, 0);
  assert.equal(l.getStatus().invalidMessagesPerSec, 1);
});

// ── Status snapshot ────────────────────────────────────────────────────────

test('getStatus exposes counts before start()', () => {
  const pc = makeMockParamCenter();
  const l = new OscListener({
    port: 6970, paramCenter: pc,
    allowedSenders: [{ name: 'a', ip: '127.0.0.1' }, { name: 'b', ip: '10.0.0.1' }],
    bindings: { '/x': 'speed' },
  });
  const s = l.getStatus();
  assert.equal(s.enabled, false);
  assert.equal(s.port, 6970);
  assert.equal(s.allowedSendersCount, 2);
  // canonical (speed/rotate/size + 3 HSV + stemsVocals) + 1 custom
  assert.ok(s.bindingsCount >= 6);
  assert.equal(s.rxMessagesPerSec, 0);
  assert.ok(typeof s.now === 'number' && s.now > 0);
});

// ── Stats publish + counter reset ──────────────────────────────────────────

test('stats publish emits oscStats and resets counters', () => {
  const pc = makeMockParamCenter();
  const events = [];
  const l = new OscListener({
    port: 6970, paramCenter: pc,
    onStats: (s) => events.push(s),
  });
  dispatchPacket(l, '/marsin/param/speed', [0.5]);
  dispatchPacket(l, '/unknown', [0.5]);
  l._publishStats();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'oscStats');
  assert.equal(events[0].rxMessagesPerSec, 2);
  assert.equal(events[0].mappedMessagesPerSec, 1);
  assert.equal(events[0].droppedMessagesPerSec, 1);
  // Counters reset for the next interval.
  assert.equal(l.getStatus().rxMessagesPerSec, 0);
});

// ── Real-UDP integration test (expert review #12) ──────────────────────────
//
// This is the test that catches a mismatch between osc-min and our
// expected { address, args } shape. We spin a real UDP socket and
// send a real OSC packet to a real OscListener on an ephemeral
// loopback port — if the lib's wire shape changes, dispatch fails.

test('real-UDP integration: local sender → local listener → mock CPC', async () => {
  const pc = makeMockParamCenter();
  const sock = dgram.createSocket('udp4');
  // Bind sender to an ephemeral port so its rinfo has a real port.
  await new Promise(res => sock.bind(0, '127.0.0.1', res));

  // Bind listener on ephemeral port (port: 0 is also ephemeral
  // for dgram, but our constructor requires port >=1; pick a
  // throwaway in the high range).
  const listenerPort = 36000 + Math.floor(Math.random() * 2000);
  const listener = new OscListener({
    port: listenerPort, host: '127.0.0.1',
    paramCenter: pc,
  });
  listener.start();

  try {
    // Send a real OSC packet using osc-min's encoder. This is the
    // same library path the listener will decode through, so it
    // catches encoder/decoder drift if osc-min upgrades change
    // the shape.
    const buf = osc.toBuffer({
      address: '/marsin/stems/vocals',
      args: [{ type: 'float', value: 0.617 }],
    });
    const sendBuf = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    await new Promise((res, rej) => {
      sock.send(sendBuf, listenerPort, '127.0.0.1', (err) => err ? rej(err) : res());
    });

    // Wait for the receive callback to fire — up to 2 s, polling.
    const t0 = Date.now();
    while (pc.calls.length === 0 && (Date.now() - t0) < 2000) {
      await new Promise(r => setTimeout(r, 25));
    }
    assert.equal(pc.calls.length, 1, 'listener received the packet');
    assert.equal(pc.calls[0].method, 'setMany');
    assert.equal(pc.calls[0].writes[0].key, 'stemsVocals');
    // float32 round-trip can lose precision; check to ~4dp.
    assert.ok(
      Math.abs(pc.calls[0].writes[0].value - 0.617) < 1e-3,
      `value was ${pc.calls[0].writes[0].value}`
    );
    assert.equal(pc.calls[0].source, 'osc');
    assert.ok(/^osc:127\.0\.0\.1:/.test(pc.calls[0].origin), `origin was ${pc.calls[0].origin}`);
  } finally {
    listener.stop();
    await new Promise(res => sock.close(res));
  }
});
