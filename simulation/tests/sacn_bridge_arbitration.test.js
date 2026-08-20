/**
 * sacn_bridge_arbitration.test.js — the input-bridge RECEIVER priority
 * arbitration + lockout state machine (catalog 20260805_161 gap G1, rank 1).
 *
 * `server/sacn_bridge.js`'s `receiver.on('packet', ...)` (the branch that
 * decides which frames reach the hardware relay AND the browser) had ZERO
 * tests before this file: OVERRIDE entry, the total drop of low-priority
 * frames while a high-priority source holds the lock, the lockout release,
 * the fact that the lock is GLOBAL ACROSS UNIVERSES (`_157` D4, pinned
 * below), the `priority||100` / `universe||1` conflations (`_157` D12,
 * pinned below), and the once-per-universe "runtime-subscribed" log.
 *
 * Uses the H-A harness (tests/helpers/bridge_harness.mjs): the REAL
 * `server/sacn_bridge.js` + `server/sacn_output_bridge.js`, zero real ports,
 * zero real packets. The live threshold/lockout values are READ from
 * `scenes/common.yaml` — never hardcoded — so a config change updates this
 * file's expectations automatically instead of silently drifting from it.
 *
 * Tests in this file are ORDER-DEPENDENT by design: `highPriorityActive` /
 * `activeSource` / the lockout timer are bridge-global state for the whole
 * process, exactly the property under test, so each test's outcome is the
 * next test's starting condition (the same idiom `bench_mirror_arm.test.js`
 * uses for the live arm).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createBridgeHarness, SIM_ROOT, yaml } from './helpers/bridge_harness.mjs';

const H = createBridgeHarness();
const { connect, request, sends, senders } = H;
const receiver = H.receiver;

// ── Live config, never hardcoded ────────────────────────────────────────
const common = yaml.load(fs.readFileSync(path.join(SIM_ROOT, 'scenes', 'common.yaml'), 'utf8'));
const T = common.colorWave.sacn_high_priority.value;   // live: 100
const L = common.colorWave.sacn_lockout_ms.value;      // live: 1000
assert.equal(typeof T, 'number', 'sacn_high_priority must be a live numeric config value');
assert.equal(typeof L, 'number', 'sacn_lockout_ms must be a live numeric config value');

const observer = connect();

/**
 * The RAW 512-byte DMX slice a real `Packet` exposes as `payloadAsBuffer`.
 * Since report 20260805_170 the bridge reads that, never the `sacn` package's
 * PERCENT `payload` getter, so a fake packet must carry it.
 */
function dmxSlice(values) {
  const buf = Buffer.alloc(512);
  for (const ch in values) buf[Number(ch) - 1] = values[ch];
  return buf;
}

/** Inject a raw packet through the REAL receiver handler, console-quieted. */
function emitPacket(fields) {
  H.captureConsole();
  receiver.emit('packet',
    { sourceName: 'test', priority: 100, payloadAsBuffer: dmxSlice({ 1: 7 }), ...fields });
  H.releaseConsole();
}

const logsContaining = (needle) => observer.json('log').filter(m => m.msg.includes(needle));
const decode515 = (buf) => ({ universe: buf.readUInt16LE(0), priority: buf.readUInt8(2) });
const binaryFrames = () => observer.received.filter(d => Buffer.isBuffer(d) && d.length === 515);

let U;   // a universe the pinned (titanic) scene actually relays
let IP;  // its controller IP

test('G1 setup: the pinned scene has at least one live relayed (universe, ip) route', async () => {
  const reply = await request(observer, { type: 'getRoutes' }, 'g1-routes', 'routes');
  assert.ok(Array.isArray(reply.routes) && reply.routes.length > 0,
    'the boot recompute must have relayed at least one pair for the CLI-pinned scene');
  ({ universe: U, ip: IP } = reply.routes[0]);
  assert.equal(typeof U, 'number');
  assert.equal(typeof IP, 'string');
});

test('G1: a high-priority frame OVERRIDEs — logged once, relayed, and broadcast', () => {
  const sendsBefore = sends.length;
  const binBefore = binaryFrames().length;

  emitPacket({ universe: U, priority: T, sourceName: 'ROGUE' });

  // This is the very first packet the receiver has ever seen in this process,
  // so the (unrelated) "N packets/5s" heartbeat ALSO fires on it — its
  // `lastLogTime` starts at epoch 0, so `now - lastLogTime > 5000` is true on
  // frame one regardless of arbitration. Match on the OVERRIDE line by name,
  // not merely on the sourceName substring, so that heartbeat is not
  // mistaken for a second OVERRIDE announcement.
  const overrideLogs = logsContaining('ROGUE').filter(m => /OVERRIDE/.test(m.msg));
  assert.equal(overrideLogs.length, 1, 'exactly one OVERRIDE log must reach the client');
  assert.match(overrideLogs[0].msg, /OVERRIDE/);

  const newSends = sends.slice(sendsBefore);
  assert.ok(newSends.length >= 1, 'the OVERRIDE frame must be relayed');
  assert.ok(newSends.some(s => s.universe === U && s.ip === IP && s.priority === T),
    'the relayed frame must carry the OVERRIDE priority to the live pair');

  const newBin = binaryFrames().length - binBefore;
  assert.equal(newBin, 1, 'exactly one 515-byte frame must be broadcast to the browser client');
  const decoded = decode515(binaryFrames()[binaryFrames().length - 1]);
  assert.equal(decoded.universe, U);
  assert.equal(decoded.priority, T);
});

test('G1: a low-priority frame on the SAME universe is dropped ENTIRELY while OVERRIDE holds', () => {
  const sendsBefore = sends.length;
  const binBefore = binaryFrames().length;

  emitPacket({ universe: U, priority: T - 1, sourceName: 'Engine-samepair' });

  assert.equal(sends.length, sendsBefore, 'no relay send for a suppressed low-priority frame');
  assert.equal(binaryFrames().length, binBefore, 'no browser broadcast for a suppressed frame');
  assert.equal(logsContaining('Engine-samepair').length, 0,
    'a dropped frame does not even get an ACTIVE log — it is silently suppressed by design');
});

test('G1 [D4-pin]: the lockout is GLOBAL ACROSS UNIVERSES, not scoped to the OVERRIDE universe',
  () => {
    // `_157` D4: high-priority on U silences low-priority on every OTHER
    // universe too — there is one `highPriorityActive` flag for the whole
    // receiver, not one per universe. Pinning CURRENT behavior; when D4's
    // per-universe scoping lands this assertion flips to "routed".
    const otherUniverse = 55555; // not U, not a BOOT_UNIVERSES member — the fake
    // receiver has no multicast-membership layer to filter it, so this proves
    // the drop is a property of the ARBITRATION state, not of route absence.
    const binBefore = binaryFrames().length;

    emitPacket({ universe: otherUniverse, priority: T - 1, sourceName: 'Engine-otheruniverse' });

    assert.equal(binaryFrames().length, binBefore,
      '[D4-pin] a low-priority frame on an UNRELATED universe is also dropped while any ' +
      'universe holds the OVERRIDE lock — the lockout has no per-universe scope today');
  });

test('G1: lockout release after LOCKOUT_MS of silence — one RELEASED log, then low-priority resumes',
  async () => {
    H.captureConsole();
    try {
      await new Promise((resolve) => setTimeout(resolve, L + 250));
    } finally {
      H.releaseConsole();
    }
    const released = logsContaining('RELEASED');
    assert.equal(released.length, 1, 'exactly one RELEASED log on lockout expiry');
    assert.match(released[0].msg, /ROGUE/, 'it must name the source that went silent');

    const sendsBefore = sends.length;
    const binBefore = binaryFrames().length;
    emitPacket({ universe: U, priority: T - 1, sourceName: 'Engine-postrelease' });

    assert.ok(sends.slice(sendsBefore).some(s => s.universe === U && s.ip === IP),
      'low-priority traffic must route again once the lockout has expired');
    assert.equal(binaryFrames().length - binBefore, 1,
      'and it must reach the browser client too');
  });

test('G1 [D12-pin]: a universe-0 packet is inflated to universe 1, not refused', () => {
  // `packet.universe || 1` (`_157` D12): a genuinely-zero universe field
  // (falsy) silently becomes universe 1 rather than being refused as
  // malformed. Pinning CURRENT behavior; the post-fix expectation is a named
  // refusal, not a silent remap.
  const binBefore = binaryFrames().length;
  emitPacket({ universe: 0, priority: T - 1, sourceName: 'ZeroUnivSrc' });
  assert.equal(binaryFrames().length - binBefore, 1,
    '[D12-pin] a universe:0 packet is NOT dropped — it is silently remapped to universe 1');
  const decoded = decode515(binaryFrames()[binaryFrames().length - 1]);
  assert.equal(decoded.universe, 1, '[D12-pin] universe 0 rides the wire as universe 1');
});

test('G1 [D12-pin]: a priority-0 packet is inflated to 100 — which EQUALS the live OVERRIDE ' +
  'threshold, so it OVERRIDEs rather than merely "routing as low"', () => {
  // `packet.priority || 100` (`_157` D12). The catalog spec for this gap
  // (report 20260805_161) assumed the inflated value would fall BELOW the
  // high-priority threshold ("treated as 100, routed as low"). On the LIVE
  // config that assumption is wrong: `sacn_high_priority` is ALSO 100
  // (`scenes/common.yaml`), and the arbitration test is `priority >=
  // HIGH_PRIORITY` — 100 >= 100 is true. So a priority-0 packet (the
  // sACN-legal "lowest priority" value, e.g. from a naive test source) is
  // arbitrated as an OVERRIDE, the OPPOSITE of "low priority", which is a
  // sharper defect than the catalog described. Pinning the REAL behavior;
  // the post-fix expectation is that a literal 0 is either preserved as 0
  // (never inflated) or refused, but never promoted to the OVERRIDE class.
  assert.equal(T, 100, 'this pin is written against the live threshold value; if ' +
    'sacn_high_priority in scenes/common.yaml ever moves off 100 this assertion (and the ' +
    'prose above) must be re-derived, not just re-run');
  const binBefore = binaryFrames().length;
  emitPacket({ universe: U, priority: 0, sourceName: 'ZeroPrioSrc' });

  const overrideLogs = logsContaining('ZeroPrioSrc');
  assert.equal(overrideLogs.length, 1,
    '[D12-pin] a priority:0 packet triggers an OVERRIDE log, not a quiet low-priority route');
  assert.match(overrideLogs[0].msg, /OVERRIDE/);
  assert.equal(binaryFrames().length - binBefore, 1);
  const decoded = decode515(binaryFrames()[binaryFrames().length - 1]);
  assert.equal(decoded.priority, 100,
    '[D12-pin] the wire carries the INFLATED priority (100), not the original 0');
});

test('G1: first frame on a runtime-subscribed universe is named once, never twice', () => {
  const freshUniverse = 45001; // never emitted anywhere else in this file; must fit a uint16
  emitPacket({ universe: freshUniverse, priority: T, sourceName: 'RuntimeUnivSrc' });
  const first = logsContaining(`First frame on U${freshUniverse}`);
  assert.equal(first.length, 1, 'the runtime-subscribe announcement fires exactly once');
  assert.match(first[0].msg, /runtime-subscribed/);

  emitPacket({ universe: freshUniverse, priority: T, sourceName: 'RuntimeUnivSrc' });
  assert.equal(logsContaining(`First frame on U${freshUniverse}`).length, 1,
    'a second frame on the same universe must NOT re-announce it');
});

test('G1 teardown: restore the real module loader', () => {
  H.restoreModuleLoad();
  for (const s of senders) assert.ok(s instanceof H.FakeSender);
});
