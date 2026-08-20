/**
 * engine_bridge_contract.test.js — the engine<->bridge in-process contract
 * rig (catalog `.agent/reports/202608/20260805_162_engine_test_gap_catalog.md`
 * G-4, rank 3). Filed sim-side per the catalog's own placement (the bridge
 * module loads here); the SPEC is engine-scope, contributed by the engine
 * implementer (_164).
 *
 * COORDINATION: `simulation/tests/helpers/bridge_harness.mjs` already existed
 * (built by the sim-side implementer, _163, extracting `_158`'s fake-module
 * technique from `bench_mirror_arm.test.js`) by the time this file was
 * written — REUSED here, not reinvented, per this agent's instructions.
 * This file does not modify `bridge_harness.mjs` or any other sim-owned test
 * file; it only imports the harness and adds a NEW file.
 *
 * WHAT'S NEW HERE vs the existing bench-mirror suite: every existing bridge
 * test (bench_mirror*.test.js, bridge_routing.test.js) drives the bridge with
 * SYNTHETIC `inbound()`/`engineFrame()` payloads — plain `{ch: value}`
 * objects built by hand. Nothing before this file ran the ENGINE's REAL
 * `lib/sacn_output.js` `createSacnOutput` Sender, captured its REAL wire
 * bytes (via the same dgram-patch technique as `tests/io/sacn_output_wire.test.js`
 * in marsin_engine), parsed them with the REAL vendored `sacn` package's
 * `Packet` class, and fed the result into the bridge's REAL receiver path.
 * That is the actual engine<->bridge BYTE contract; this file is the first
 * proof of it end-to-end.
 *
 * TECHNIQUE NOTE: `bridge_harness.mjs` patches Node's CJS `Module._load` so
 * `require('sacn')` (used by the CJS bridge modules) returns fakes. The
 * ENGINE's `lib/sacn_output.js` is ESM (`import { Sender } from 'sacn'`) —
 * verified empirically at test-write time that Node's ESM-importing-a-CJS-
 * package path does NOT route through the patched `Module._load` in this
 * Node version, so the engine side gets the REAL `sacn` Sender (confirmed:
 * `dgram.createSocket` fires once per `sendFrame`) while the bridge side
 * stays fully faked. This is exactly the "real sender objects against the
 * real receiver path" the catalog asks for.
 *
 * SCOPE CUT vs the catalog's literal spec text, disclosed:
 *   - "bridge's per-universe monitor state shows source/priority/frame-count"
 *     — no such per-universe structure exists in `server/sacn_bridge.js`
 *     (grep-verified: `activeSource`/`packetCount` are single GLOBAL
 *     variables, a 5s log-rate stat, not a queryable per-universe monitor).
 *     Replaced with the real, queryable equivalent: the `{type:'getRoutes'}`
 *     WS introspection (`buildRouteTableSnapshot`, `lib/bridge_routing.cjs`),
 *     which is what a real client (the sim GUI's monitor panel) actually
 *     reads.
 *   - The bench-mirror ARM path (STRAND/GATEWAY) is NOT used for the core
 *     byte-fidelity tests below — `routeFrame()`'s "1. Relay to physical
 *     sACN devices directly" (`server/sacn_bridge.js:2383-2394`) is the
 *     ORDINARY per-universe relay, live from BOOT (no arm needed), and is
 *     the simpler, more general path the catalog's G-4 spec actually
 *     describes ("engine byte -> bridge relay byte identical"). Universe 30
 *     -> 10.1.1.60 is titanic's own real relay route (scene-data read, not
 *     invented) and is also one of the engine's real `ALL_SOURCES`
 *     universes, so it doubles as a live pacing/sequence test subject.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Packet } = require('sacn/dist/packet.js');

/**
 * Encode packet options into a real E1.31 datagram and read the DMX slots back
 * off it. `payloadAsBuffer` is only populated on a Packet PARSED from a buffer
 * (`packet.js:101-103`), so a round-trip through `.buffer` is the only honest
 * way to ask "what bytes would this actually put on the wire".
 */
const wireSlots = (options) => new Packet(new Packet(options).buffer).payloadAsBuffer;

// ── Patch dgram BEFORE the engine's real Sender is ever constructed ──────
// (Same technique/verification as marsin_engine/tests/io/sacn_output_wire.test.js.)
/** @type {Array<{msg: Buffer}>} every datagram the engine's REAL Sender tried to emit. */
let engineCaptured = [];
const realCreateSocket = dgram.createSocket;
dgram.createSocket = function fakeCreateSocket() {
  return {
    send(msg, port, addr, cb) { engineCaptured.push({ msg: Buffer.from(msg) }); if (cb) cb(null); },
    close() {}, unref() {}, setBroadcast() {}, bind() {}, setMulticastInterface() {},
  };
};

const { createBridgeHarness, ALL_SOURCES } = await import('./helpers/bridge_harness.mjs');
const { createSacnOutput } = await import('../../marsin_engine/lib/sacn_output.js');

const h = createBridgeHarness();

after(() => {
  h.restoreModuleLoad();
});

// Universe 30 is one of titanic's real, boot-time-live relay routes
// (10.1.1.60 — confirmed via `openSenders()` at harness boot) AND one of the
// engine's ALL_SOURCES universes — so one real engine sender covers both a
// route this suite can assert against and the shared-sequence semantics
// `engineFrame()` models.
const RELAY_UNIVERSE = 30;
const RELAY_HOST = '10.1.1.60';
assert.ok(ALL_SOURCES.includes(RELAY_UNIVERSE), 'sanity: U30 must be a real engine source universe');
assert.ok(h.openSenders().includes(h.routeKey(RELAY_UNIVERSE, RELAY_HOST)),
  `sanity: U${RELAY_UNIVERSE}->${RELAY_HOST} must be a live boot-time relay route`);

const engineOut = createSacnOutput({
  universes: ALL_SOURCES, destinations: ['127.0.0.1'], priority: 100, sourceName: 'MarsinEngine',
});
dgram.createSocket = realCreateSocket; // restore now that every Sender is constructed
engineOut.start();
after(() => engineOut.stop());

/** Send one REAL engine frame (all ALL_SOURCES universes, same byte value) and
 * feed every REAL captured+parsed datagram into the bridge's REAL receiver. */
async function realEngineFrame(byteValue) {
  engineCaptured.length = 0;
  const buffers = {};
  for (const u of ALL_SOURCES) {
    const b = new Uint8Array(512);
    b.fill(byteValue);
    buffers[u] = b;
  }
  await engineOut.sendFrame(buffers);
  assert.equal(engineCaptured.length, ALL_SOURCES.length, 'one real datagram per ALL_SOURCES universe');
  for (const { msg } of engineCaptured) {
    const packet = new Packet(msg);
    h.receiver.emit('packet', {
      universe: packet.universe,
      priority: packet.priority,
      sourceName: packet.sourceName,
      // The RAW wire slice, which is what the bridge reads since report
      // 20260805_170 — `packet.payload` is the package's PERCENT view and was
      // the whole of D1 on this lane.
      payloadAsBuffer: packet.payloadAsBuffer,
      sequence: packet.sequence,
    });
  }
}

// ── R-D1 FLIPPED (report 20260805_170, S-D1 landed) ──────────────────────
// These two tests used to pin the PERCENT wire: a full-on 255 arrived as the
// payload value 100, and an all-zero frame arrived as `{}` because `objectify`
// drops zero channels. Both were characterizations of `_157` D1 / `_153` F1b,
// and both named this fix as the thing that would change them. The engine's
// senders now declare `useRawDmxValues` and the bridge reads
// `packet.payloadAsBuffer`, so the unit on both sides of the receive path is
// RAW DMX and the identity is exact.

test('relay fidelity: a REAL engine ALL-255 frame relays as RAW DMX 255, byte for byte', async () => {
  h.sends.length = 0;
  await realEngineFrame(255);
  await h.settle();
  const relayed = h.sendsTo(RELAY_HOST, RELAY_UNIVERSE);
  assert.equal(relayed.length, 1, 'exactly one relayed datagram for this route from one engine frame');
  // `routeFrame()`'s payload passed VERBATIM to the outgoing sender
  // (server/sacn_bridge.js) — no re-encoding, and no rescaling at either end.
  assert.equal(relayed[0].payload[1], 255, 'channel 1 arrives as the raw DMX byte the engine rendered');
  assert.equal(relayed[0].payload[512], 255, 'channel 512 (last channel) round-trips identically');
  assert.equal(relayed[0].priority, 100);
  assert.equal(relayed[0].useRawDmxValues, true,
    'the relay sender must declare raw values, or the package would re-multiply this payload by 2.55');
});

test('relay fidelity: a REAL engine ALL-ZERO frame relays as an EMPTY payload (zero channels stay omitted)', async () => {
  h.sends.length = 0;
  await realEngineFrame(0);
  await h.settle();
  const relayed = h.sendsTo(RELAY_HOST, RELAY_UNIVERSE);
  assert.equal(relayed.length, 1);
  // UNCHANGED by S-D1 and deliberately so: `rawDmxPayload` keeps `objectify`'s
  // sparse shape and moves only the UNIT. The dark channels still reach the
  // fixture as explicit zeros because the packet builder zero-fills all 512
  // slots — pinned in marsin_engine/tests/io/sacn_output_wire.test.js.
  assert.deepEqual(relayed[0].payload, {}, 'a zero-value channel is omitted from the payload object');
});

test('R-D1 PROOF: all 256 DMX values survive engine -> wire -> bridge receive -> relay resend -> wire, exactly',
  async () => {
    // The full identity table `marsin_engine/tests/io/sacn_output_wire.test.js`
    // and `_155` A5 deferred until S-D1 landed (report 20260805_170). Every wire
    // byte here is produced and read by the vendored `sacn` package's OWN
    // `Packet` class; the resend leg is re-encoded through a real `Packet` with
    // the SAME options the relay's senders carry, so a regression in either the
    // sender flag or the receive-side unit shows up as an off-by-2.55 table.
    const CH = [1, 2, 101, 256, 512];
    const distortions = [];
    for (let v = 0; v <= 255; v += 1) {
      h.sends.length = 0;
      await realEngineFrame(v);
      await h.settle(4);
      const relayed = h.sendsTo(RELAY_HOST, RELAY_UNIVERSE);
      assert.equal(relayed.length, 1, `one relayed datagram at value ${v}`);
      const frame = relayed[0];
      // Leg 1+2: engine byte -> wire -> bridge receive -> relay payload. An
      // omitted channel means 0 (the sparse shape `rawDmxPayload` preserves);
      // the resend leg below re-checks it as a real wire byte either way.
      for (const ch of CH) {
        const got = frame.payload[ch] === undefined ? 0 : frame.payload[ch];
        if (got !== v) distortions.push({ v, ch, got, leg: 'receive' });
      }
      // Leg 3: relay payload -> wire, through the real packet encoder with the
      // relay sender's real options.
      const resent = wireSlots({
        payload: frame.payload, universe: frame.universe, priority: frame.priority,
        sequence: 0, sourceName: 'MarsinRelay Engine', useRawDmxValues: frame.useRawDmxValues,
      });
      for (const ch of CH) {
        if (resent[ch - 1] !== v) distortions.push({ v, ch, got: resent[ch - 1], leg: 'resend' });
      }
    }
    assert.deepEqual(distortions, [], 'every one of the 256 DMX values must round-trip exactly');
  });

test('R-D1 PITFALL GUARD: handing a raw Buffer back as `payload` would be 2.55x DARK', () => {
  // `_157` §1's documented trap, kept executable so nobody "simplifies" the
  // bridge's `rawDmxPayload` into a straight `payload: packet.payloadAsBuffer`.
  // `Packet`'s getter objectifies a Buffer payload to PERCENT, and
  // `useRawDmxValues` then writes that percent number as the wire byte.
  const wire = new Uint8Array(512); wire.fill(255);
  const wrong = wireSlots({
    payload: Buffer.from(wire), universe: 1, priority: 100, sequence: 0,
    sourceName: 'trap', useRawDmxValues: true,
  });
  assert.equal(wrong[0], 100, 'a full-on byte would leave as 100 — the 2.55x darkening _157 warned about');
});

test('pacing contract: N real engine frames -> the relay emits exactly N frames for this route (no drop, no dup)', async () => {
  h.sends.length = 0;
  const N = 5;
  for (let i = 0; i < N; i += 1) {
    await realEngineFrame(i % 2 === 0 ? 255 : 0); // alternate so consecutive frames are never byte-identical
    await h.settle();
  }
  assert.equal(h.sendsTo(RELAY_HOST, RELAY_UNIVERSE).length, N);
});

test('sequence: 300 real engine frames are all accepted by the real Receiver (no PacketOutOfOrder)', async () => {
  h.sends.length = 0;
  let outOfOrderCount = 0;
  const onOOO = () => { outOfOrderCount += 1; };
  h.receiver.on('PacketOutOfOrder', onOOO);
  for (let i = 0; i < 300; i += 1) {
    await realEngineFrame(i % 2 === 0 ? 255 : 0);
    await h.settle(2);
  }
  assert.equal(outOfOrderCount, 0, 'a real, monotonically-advancing engine sequence must never desync the receiver');
  assert.equal(h.sendsTo(RELAY_HOST, RELAY_UNIVERSE).length, 300, 'all 300 frames routed (relay does not drop on the hot path)');
});

test('engineOwnedPairs exclusion: a pair the engine claims to own is NOT relayed, per the getRoutes introspection', async () => {
  // engineOwnedPairs is unit-pinned directly against synthetic /status shapes
  // in simulation/tests/bridge_routing.test.js — this proves the LIVE join:
  // the bridge's periodic engine poll (ENGINE_POLL_MS=3000, real wall-clock
  // interval, not fake-timer-controllable) picks up a NEW /status shape and
  // excludes the claimed pair from the NEXT recompute.
  h.setEngineStatus({
    service: 'marsin-engine', activeScene: 'titanic',
    outputRouting: { controllers: [{ host: RELAY_HOST, universes: [RELAY_UNIVERSE] }] },
  });
  await h.waitMs(() => !h.openSenders().includes(h.routeKey(RELAY_UNIVERSE, RELAY_HOST)),
    `U${RELAY_UNIVERSE}->${RELAY_HOST} to drop from the live relay senders after the next engine poll`,
    8000);

  h.sends.length = 0;
  await realEngineFrame(255);
  await h.settle();
  assert.equal(h.sendsTo(RELAY_HOST, RELAY_UNIVERSE).length, 0,
    'an engine-owned pair must receive ZERO relay datagrams from the bridge');

  const ws = h.connect();
  const reply = await h.request(ws, { type: 'getRoutes' }, 'g4-owned-check', 'routes');
  assert.ok(reply.engineOwned.some((p) => p.universe === RELAY_UNIVERSE && p.ip === RELAY_HOST),
    `getRoutes must report U${RELAY_UNIVERSE}->${RELAY_HOST} under engineOwned`);
  assert.ok(!reply.routes.some((p) => p.universe === RELAY_UNIVERSE && p.ip === RELAY_HOST),
    'the same pair must NOT appear in the live routes list');

  // Restore for hygiene (harness-local state; no shared/global effect either way).
  h.setEngineStatus({ service: 'marsin-engine', activeScene: 'titanic', outputRouting: { controllers: [] } });
  await h.waitMs(() => h.openSenders().includes(h.routeKey(RELAY_UNIVERSE, RELAY_HOST)),
    'the relay route to be restored after the exclusion is lifted', 8000);
});
