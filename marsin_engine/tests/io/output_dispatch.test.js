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
} from '../../lib/output_dispatch.js';

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

// ── normalizeControllerRouting — alsoFlat (dual-send opt-in) ────────────────

test('normalizeControllerRouting — alsoFlat defaults false when absent', () => {
  const { byUniverse, controllers } = normalizeControllerRouting([
    { name: 'A', host: '10.0.0.1', protocol: 'sACN', universes: [2] },
  ]);
  assert.equal(byUniverse.get(2).alsoFlat, false);
  assert.equal(controllers[0].alsoFlat, false);
});

test('normalizeControllerRouting — alsoFlat:true is recorded', () => {
  const { byUniverse, controllers } = normalizeControllerRouting([
    { name: 'A', host: '10.0.0.1', protocol: 'sACN', universes: [2], alsoFlat: true },
  ]);
  assert.equal(byUniverse.get(2).alsoFlat, true);
  assert.equal(controllers[0].alsoFlat, true);
});

test('normalizeControllerRouting — non-boolean alsoFlat throws (fail loud)', () => {
  assert.throws(() => normalizeControllerRouting([
    { name: 'A', host: '10.0.0.1', protocol: 'sACN', universes: [2], alsoFlat: 'yes' },
  ]), /alsoFlat must be a boolean/);
  assert.throws(() => normalizeControllerRouting([
    { name: 'A', host: '10.0.0.1', protocol: 'sACN', universes: [2], alsoFlat: 1 },
  ]), /alsoFlat must be a boolean/);
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

// ── createOutputDispatch — alsoFlat dual-send ──────────────────────────────

test('createOutputDispatch — alsoFlat false keeps exclusive routing (no flat)', () => {
  const d = createOutputDispatch({
    universes: [4],
    controllers: [{ name: 'led', host: '10.1.1.201', protocol: 'sACN', universes: [4] }],
    destinations: ['127.0.0.1'],
  });
  // Only the per-controller sACN sender; U4 does NOT reach flat destinations.
  assert.equal(d._routing.senderCount, 1);
  assert.deepEqual(d._routing.flatUniverses, []);
});

test('createOutputDispatch — alsoFlat absent keeps exclusive routing (today\'s default)', () => {
  const d = createOutputDispatch({
    universes: [4],
    controllers: [{ name: 'led', host: '10.1.1.201', protocol: 'sACN', universes: [4] }],
    destinations: ['127.0.0.1'],
  });
  assert.deepEqual(d._routing.flatUniverses, []);
});

test('createOutputDispatch — alsoFlat:true sends the universe to controller AND flat', () => {
  const d = createOutputDispatch({
    universes: [4],
    controllers: [{
      name: 'led', host: '10.1.1.201', protocol: 'sACN', universes: [4], alsoFlat: true,
    }],
    destinations: ['127.0.0.1'],
  });
  // Two senders: the per-controller sACN unicast (→ 10.1.1.201) AND the flat
  // default sACN (→ 127.0.0.1). U4 is owned by both — dual-send parity.
  assert.equal(d._routing.senderCount, 2);
  assert.deepEqual(d._routing.flatUniverses, [4]);
});

test('createOutputDispatch — alsoFlat:true reaches the per-controller wire (Art-Net) and flat', async () => {
  // Prove the controller path still lands on the wire while the universe is
  // ALSO carried by the flat sender (introspection). Art-Net makes the
  // per-controller datagram observable on an ephemeral loopback port.
  const rx = dgram.createSocket('udp4');
  const received = new Promise((resolve) => rx.once('message', (msg) => resolve(msg)));
  await new Promise((resolve) => rx.bind(0, '127.0.0.1', resolve));
  const port = rx.address().port;

  const d = createOutputDispatch({
    universes: [4],
    controllers: [{
      name: 'led', host: '127.0.0.1', protocol: 'artnet', universes: [4], alsoFlat: true,
    }],
    destinations: ['127.0.0.1'],
    artnetPort: port,
  });
  // The flat sACN default sender also owns U4.
  assert.deepEqual(d._routing.flatUniverses, [4]);
  assert.equal(d._routing.senderCount, 2);

  d.start();
  const data = new Uint8Array(512);
  data[0] = 77;
  await d.sendFrame({ 4: data });

  const msg = await received;
  d.stop();
  rx.close();

  // The per-controller Art-Net path delivered universe 4 with our data.
  assert.equal(msg.toString('latin1', 0, 8), 'Art-Net\0');
  assert.equal(msg[14], 4);
  assert.equal(msg[18], 77);
});

// ── addUniverse — hot-reload / live re-patch (G10 regression) ───────────────
//
// The playa bug: boot the engine with universe set A, re-patch fixtures onto a
// universe declared for a controller in config.yaml but NOT patched at boot,
// regenerate the model → the hot-reload path calls dispatch.addUniverse(uid).
// Before the fix that universe had no sender (its controller's sender was never
// built) and addUniverse fell through to `return` — the controller stayed dark
// until a full engine restart. These prove the universe is now routed live.

test('addUniverse — declared-but-unpatched-at-boot universe transmits after add (Art-Net wire, G10)', async () => {
  const rx = dgram.createSocket('udp4');
  const received = new Promise((resolve) => rx.once('message', (msg) => resolve(msg)));
  await new Promise((resolve) => rx.bind(0, '127.0.0.1', resolve));
  const port = rx.address().port;

  // Boot: only undeclared U2 is patched (→ flat sACN). The Art-Net controller
  // for U4 is declared in config but U4 is NOT in the boot universe list, so no
  // Art-Net sender exists at boot. This is the exact playa 0-patched scenario.
  const d = createOutputDispatch({
    universes: [2],
    controllers: [{ name: 'led', host: '127.0.0.1', protocol: 'artnet', universes: [4] }],
    destinations: ['127.0.0.1'],
    artnetPort: port,
  });
  d.start();
  // Boot state: just the flat sACN default sender; U4 unrouted.
  assert.equal(d._routing.senderCount, 1);

  // Live re-patch: the hot-reload path adds U4.
  d.addUniverse(4);
  // A dedicated Art-Net sender was created for the controller.
  assert.equal(d._routing.senderCount, 2);

  const data = new Uint8Array(512);
  data[0] = 88;
  await d.sendFrame({ 4: data });

  const msg = await received;
  d.stop();
  rx.close();

  // Universe 4 reached the controller over Art-Net — no engine restart needed.
  assert.equal(msg.toString('latin1', 0, 8), 'Art-Net\0');
  assert.equal(msg[14], 4);
  assert.equal(msg[18], 88);
});

test('addUniverse — declared sACN universe unpatched at boot gets a per-controller sender', () => {
  const d = createOutputDispatch({
    universes: [2], // only U2 (undeclared → flat)
    controllers: [{ name: 'led', host: '10.1.1.201', protocol: 'sACN', universes: [10] }],
    destinations: ['127.0.0.1'],
  });
  d.start();
  assert.equal(d._routing.senderCount, 1); // flat only

  d.addUniverse(10);
  // New per-controller sACN unicast sender; U10 does NOT leak to the flat set
  // (which still carries only the boot-time undeclared U2).
  assert.equal(d._routing.senderCount, 2);
  assert.deepEqual(d._routing.flatUniverses, [2]);
});

test('addUniverse — reuses the controller sender when it already had a boot universe', () => {
  // Controller declares U4+U5 but only U4 is patched at boot. Adding U5 must
  // reuse the same Art-Net sender, not spawn a second one for the same host.
  const d = createOutputDispatch({
    universes: [4],
    controllers: [{ name: 'art', host: '10.0.0.9', protocol: 'artnet', universes: [4, 5] }],
    destinations: ['127.0.0.1'],
  });
  d.start();
  assert.equal(d._routing.senderCount, 1); // one Art-Net sender (no undeclared → no flat)

  d.addUniverse(5);
  assert.equal(d._routing.senderCount, 1); // reused, not duplicated
});

test('addUniverse — alsoFlat declared universe added live reaches controller AND flat', async () => {
  const rx = dgram.createSocket('udp4');
  const received = new Promise((resolve) => rx.once('message', (msg) => resolve(msg)));
  await new Promise((resolve) => rx.bind(0, '127.0.0.1', resolve));
  const port = rx.address().port;

  // No universe patched at boot: no flat sender, no controller sender exist.
  const d = createOutputDispatch({
    universes: [],
    controllers: [{
      name: 'led', host: '127.0.0.1', protocol: 'artnet', universes: [4], alsoFlat: true,
    }],
    destinations: ['127.0.0.1'],
    artnetPort: port,
  });
  d.start();
  assert.equal(d._routing.senderCount, 0);

  d.addUniverse(4);
  // Both a controller Art-Net sender AND the flat sACN default were created.
  assert.equal(d._routing.senderCount, 2);
  assert.deepEqual(d._routing.flatUniverses, [4]); // dual-send parity

  const data = new Uint8Array(512);
  data[0] = 55;
  await d.sendFrame({ 4: data });

  const msg = await received;
  d.stop();
  rx.close();

  assert.equal(msg.toString('latin1', 0, 8), 'Art-Net\0');
  assert.equal(msg[14], 4);
  assert.equal(msg[18], 55);
});

test('addUniverse — undeclared universe creates the flat sender if the rig had none', () => {
  // Boot with only a declared Art-Net universe → no flat sender exists.
  const d = createOutputDispatch({
    universes: [4],
    controllers: [{ name: 'art', host: '10.0.0.9', protocol: 'artnet', universes: [4] }],
    destinations: ['127.0.0.1'],
  });
  d.start();
  assert.equal(d._routing.senderCount, 1); // Art-Net only
  assert.deepEqual(d._routing.flatUniverses, []);

  d.addUniverse(7); // undeclared → flat default
  assert.equal(d._routing.senderCount, 2);
  assert.deepEqual(d._routing.flatUniverses, [7]);
});

test('addUniverse — idempotent: repeat adds do not duplicate senders or flat entries', () => {
  const d = createOutputDispatch({
    universes: [2],
    controllers: [{
      name: 'led', host: '10.1.1.201', protocol: 'sACN', universes: [10], alsoFlat: true,
    }],
    destinations: ['127.0.0.1'],
  });
  d.start();

  d.addUniverse(10);
  const countAfterFirst = d._routing.senderCount;
  d.addUniverse(10);
  d.addUniverse(10);
  assert.equal(d._routing.senderCount, countAfterFirst); // no new senders
  // Flat carries boot-time undeclared U2 plus the alsoFlat U10 — each once,
  // not duplicated by the repeat adds.
  assert.deepEqual(d._routing.flatUniverses, [2, 10]);
});
