/**
 * output_dispatch.test.js — per-controller transport routing.
 *
 * Proves: a universe routes to the controller protocol it was declared
 * with (Art-Net datagrams land on :6454-class loopback, sACN universes stay
 * on the sACN path), undeclared universes keep the flat-destinations sACN
 * default unchanged, and a declared-but-broken controller throws loudly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';

import {
  normalizeControllerRouting,
  createOutputDispatch,
} from '../lib/output_dispatch.js';

// ── normalizeControllerRouting — validation ────────────────────────────────

test('normalizeControllerRouting — null/empty yields no routes', () => {
  assert.deepEqual(normalizeControllerRouting(null).controllers, []);
  assert.deepEqual(normalizeControllerRouting(undefined).controllers, []);
  assert.equal(normalizeControllerRouting([]).byUniverse.size, 0);
});

test('normalizeControllerRouting — maps each universe to its controller', () => {
  const { byUniverse } = normalizeControllerRouting([
    { name: 'A', host: '10.0.0.1', protocol: 'sACN', universes: [2, 3] },
    { name: 'B', host: '10.0.0.2', protocol: 'artnet', universes: [4] },
  ]);
  assert.equal(byUniverse.get(2).protocol, 'sACN');
  assert.equal(byUniverse.get(3).host, '10.0.0.1');
  assert.equal(byUniverse.get(4).protocol, 'artnet');
});

test('normalizeControllerRouting — missing protocol throws (codex P0)', () => {
  assert.throws(() => normalizeControllerRouting([{ name: 'A', host: '10.0.0.1', universes: [2] }]),
    /no protocol/);
});

test('normalizeControllerRouting — invalid protocol throws', () => {
  assert.throws(() => normalizeControllerRouting([
    { name: 'A', host: '10.0.0.1', protocol: 'ddp', universes: [2] },
  ]), /invalid protocol 'ddp'/);
});

test('normalizeControllerRouting — missing host throws', () => {
  assert.throws(() => normalizeControllerRouting([
    { name: 'A', protocol: 'artnet', universes: [2] },
  ]), /no host/);
});

test('normalizeControllerRouting — duplicate universe claim throws', () => {
  assert.throws(() => normalizeControllerRouting([
    { name: 'A', host: '10.0.0.1', protocol: 'sACN', universes: [2] },
    { name: 'B', host: '10.0.0.2', protocol: 'artnet', universes: [2] },
  ]), /claimed by two controllers/);
});

test('normalizeControllerRouting — non-positive universe throws', () => {
  assert.throws(() => normalizeControllerRouting([
    { name: 'A', host: '10.0.0.1', protocol: 'sACN', universes: [0] },
  ]), /universe 0 must be/);
});

// ── createOutputDispatch — routing partition ───────────────────────────────

test('createOutputDispatch — undeclared universes use the sACN default sender', () => {
  const d = createOutputDispatch({
    universes: [2, 3],
    controllers: null,
    destinations: ['127.0.0.1'],
  });
  // One sender (default sACN) owning both universes; no Art-Net.
  assert.equal(d._routing.senderCount, 1);
  assert.equal(d._routing.byUniverse.size, 0);
});

test('createOutputDispatch — mixed sACN + Art-Net builds separate senders', () => {
  const d = createOutputDispatch({
    universes: [2, 3, 4, 5],
    controllers: [
      { name: 'sacn-ctl', host: '10.0.0.1', protocol: 'sACN', universes: [3] },
      { name: 'art-ctl', host: '10.0.0.2', protocol: 'artnet', universes: [4, 5] },
    ],
    destinations: ['127.0.0.1'],
  });
  // Senders: default-sACN (U2), unicast-sACN (U3), Art-Net (U4,U5) = 3.
  assert.equal(d._routing.senderCount, 3);
  assert.equal(d._routing.byUniverse.get(4).protocol, 'artnet');
});

// ── createOutputDispatch — Art-Net universe lands on the wire ──────────────

test('createOutputDispatch — routes a declared Art-Net universe over Art-Net', async () => {
  const rx = dgram.createSocket('udp4');
  const received = new Promise((resolve) => rx.once('message', (msg) => resolve(msg)));
  await new Promise((resolve) => rx.bind(0, '127.0.0.1', resolve));
  const port = rx.address().port;

  const d = createOutputDispatch({
    universes: [4],
    controllers: [{ name: 'art', host: '127.0.0.1', protocol: 'artnet', universes: [4] }],
    destinations: ['127.0.0.1'],
    artnetPort: port,
  });
  d.start();

  const data = new Uint8Array(512);
  data[0] = 99;
  await d.sendFrame({ 4: data });

  const msg = await received;
  d.stop();
  rx.close();

  // It is a real ArtDMX packet for universe 4 with our channel data.
  assert.equal(msg.toString('latin1', 0, 8), 'Art-Net\0');
  assert.equal(msg[14], 4);
  assert.equal(msg[18], 99);
});

test('createOutputDispatch — declared bad controller throws at construction (fail loud)', () => {
  assert.throws(() => createOutputDispatch({
    universes: [4],
    controllers: [{ name: 'art', host: '127.0.0.1', protocol: 'wled', universes: [4] }],
  }), /invalid protocol 'wled'/);
});
