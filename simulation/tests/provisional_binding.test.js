/**
 * provisional_binding.test.js — the PROVISIONAL → VERIFIED controller lifecycle
 * (operator ruling 2026-07-31: discovery is an OPTIONAL stage — "that allows me
 * to put the IP I want and not have to start the controller just yet, until
 * next boot; on first boot and recognition of the board you can get missing
 * data if anything from the board itself"). Report 20260725_96.
 *
 * Pure logic: no DOM, no network. Four things are pinned here —
 *   1. the schema (a provisional block may not carry hardware truth),
 *   2. the FULL CHAIN a provisional binding patches (identical to a verified
 *      one, which is the entire feature),
 *   3. first contact: promote on agreement, refuse loudly on contradiction,
 *   4. the `0.0.0.0` placeholder sentinel's interaction with the grade.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  createControllerRegistry,
  normalizeDeviceBlock,
  markControllerProvisional,
  promoteProvisionalBinding,
  bindControllerDevice,
  unbindControllerDevice,
  controllerBoundToDeviceId,
  recordDevicePush,
  recordDeviceGammaPush,
  isBoundLedController,
  isProvisionalLedController,
  isVerifiedLedController,
  ledBindingGrade,
  addController,
  CONTROLLER_TYPE_LED,
  CONTROLLER_TYPE_DMX,
  LED_BINDING_PROVISIONAL,
  LED_BINDING_VERIFIED,
  LED_DEVICE_VENDOR_MARSINLED,
} from '../src/dmx/controller_registry.js';
import { computeLedStrandPatches } from '../src/dmx/led/led_patch_projection.js';
import {
  reconcileProvisionalContact,
  describeProvisionalReconcile,
  provisionalCandidatesForDevice,
  PROVISIONAL_HARD_BLOCKERS,
} from '../src/dmx/led/provisional_binding.js';
import { canMarkProvisional, PLACEHOLDER_IP } from '../src/dmx/controller_status.js';
import { params } from '../src/core/state.js';
import { generatePixelMap } from '../src/dmx/pixelblaze_model_exporter.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const VERIFIED_IDENTITY = {
  vendor: LED_DEVICE_VENDOR_MARSINLED,
  controllerId: 'titanic_207',
  deviceName: 'Titanic-207',
  boardId: 'angio4',
};

/** A rope-controller-shaped LED card: two outputs, two strands, real universes. */
function ropeControllerTree({ device, ip = '10.9.9.207' } = {}) {
  return {
    nextControllerId: 2,
    controllers: [{
      id: 1,
      name: 'RightRightRopes',
      ip,
      type: CONTROLLER_TYPE_LED,
      protocol: 'sACN',
      led: { order: 'RGBW', startAddr: 1 },
      ports: [
        { port: 1, output: 1, universe: 36, chain: ['Right_Front_Right'] },
        { port: 2, output: 2, universe: 37, chain: ['Right_Back_Right'] },
      ],
      ...(device ? { device } : {}),
    }],
  };
}

const ROPE_COUNTS = new Map([['Right_Front_Right', 40], ['Right_Back_Right', 40]]);

/** The `/api/status` body of a board that agrees with the rope card above. */
function boardStatus(overrides = {}) {
  return {
    controllerId: 'titanic_207',
    boardId: 'angio4',
    deviceName: 'Titanic-207',
    mac: 'AA:BB:CC:DD:02:07',
    firmwareSHA: 'deadbeef',
    strands: [
      { type: 'WS281X_RGBW', count: 40, enabled: true },
      { type: 'WS281X_RGBW', count: 40, enabled: true },
      { type: 'WS281X_RGBW', count: 40, enabled: false },
      { type: 'WS281X_RGBW', count: 40, enabled: false },
    ],
    capabilitiesExt: { perOutputDmx: true },
    ...overrides,
  };
}

function discoveredDevice(overrides = {}) {
  const status = boardStatus(overrides.status || {});
  return {
    ip: '10.9.9.207',
    controllerId: status.controllerId,
    boardId: status.boardId,
    deviceName: status.deviceName,
    strands: status.strands,
    mac: status.mac,
    raw: status,
    ...(overrides.device || {}),
  };
}

// ── 1. Schema: a provisional block may not carry hardware truth ─────────────

test('normalizeDeviceBlock: a PROVISIONAL block round-trips without a fingerprint', () => {
  const d = normalizeDeviceBlock({ vendor: 'marsinled', provisional: true }, 'C');
  assert.equal(d.vendor, 'marsinled');
  assert.equal(d.provisional, true);
  assert.equal('controllerId' in d, false,
    'a provisional block must not carry a controllerId key at all');
});

test('normalizeDeviceBlock: PROVISIONAL keeps the operator EXPECTATIONS it was given', () => {
  const d = normalizeDeviceBlock(
    { vendor: 'marsinled', provisional: true, deviceName: 'Titanic-207', boardId: 'angio4' }, 'C');
  assert.equal(d.deviceName, 'Titanic-207');
  assert.equal(d.boardId, 'angio4');
});

test('normalizeDeviceBlock: PROVISIONAL + controllerId THROWS (never claim a fingerprint)', () => {
  assert.throws(
    () => normalizeDeviceBlock({ vendor: 'marsinled', provisional: true, controllerId: 'x' }, 'C'),
    /PROVISIONAL device binding must not carry device\.controllerId/);
});

test('normalizeDeviceBlock: PROVISIONAL + lastPush / lastGammaPush THROW (receipts imply contact)', () => {
  assert.throws(() => normalizeDeviceBlock({
    vendor: 'marsinled', provisional: true,
    lastPush: { at: '2026-07-31T00:00:00Z', outcome: 'applied' },
  }, 'C'), /must not carry device\.lastPush/);
  assert.throws(() => normalizeDeviceBlock({
    vendor: 'marsinled', provisional: true,
    lastGammaPush: { at: '2026-07-31T00:00:00Z', outcome: 'applied' },
  }, 'C'), /must not carry device\.lastGammaPush/);
});

test('normalizeDeviceBlock: a non-boolean `provisional` THROWS', () => {
  assert.throws(() => normalizeDeviceBlock({ vendor: 'marsinled', provisional: 'yes' }, 'C'),
    /device\.provisional must be a boolean/);
});

test('normalizeDeviceBlock: provisional:false still REQUIRES a controllerId', () => {
  assert.throws(() => normalizeDeviceBlock({ vendor: 'marsinled', provisional: false }, 'C'),
    /device\.controllerId must be a non-empty string/);
});

test('createControllerRegistry: loads a provisional block off disk and grades it', () => {
  const reg = createControllerRegistry(
    ropeControllerTree({ device: { vendor: 'marsinled', provisional: true } }));
  const c = reg.controllers[0];
  assert.equal(ledBindingGrade(c), LED_BINDING_PROVISIONAL);
  assert.equal(isProvisionalLedController(c), true);
  assert.equal(isVerifiedLedController(c), false);
  assert.equal(isBoundLedController(c), true, 'provisional IS bound for the patch chain');
});

test('createControllerRegistry: a verified block still grades verified', () => {
  const reg = createControllerRegistry(ropeControllerTree({ device: VERIFIED_IDENTITY }));
  const c = reg.controllers[0];
  assert.equal(ledBindingGrade(c), LED_BINDING_VERIFIED);
  assert.equal(isProvisionalLedController(c), false);
  assert.equal(isVerifiedLedController(c), true);
});

// ── 2. Declaring a provisional binding ──────────────────────────────────────

test('markControllerProvisional: declares the binding with no network at all', () => {
  const reg = createControllerRegistry(ropeControllerTree());
  const c = reg.controllers[0];
  assert.equal(isBoundLedController(c), false, 'unbound — which no longer means unpatched');
  const dev = markControllerProvisional(c);
  assert.equal(dev.provisional, true);
  assert.equal(isProvisionalLedController(c), true);
});

test('markControllerProvisional: REFUSES to downgrade a VERIFIED binding', () => {
  const reg = createControllerRegistry(ropeControllerTree({ device: VERIFIED_IDENTITY }));
  assert.throws(() => markControllerProvisional(reg.controllers[0]),
    /already VERIFIED against device 'titanic_207'/);
});

test('markControllerProvisional: REFUSES a DMX controller', () => {
  const reg = createControllerRegistry({ controllers: [] });
  const dmx = addController(reg, { name: 'D', ip: '10.9.9.5', type: CONTROLLER_TYPE_DMX });
  assert.throws(() => markControllerProvisional(dmx), /is not an LED controller/);
});

test('recordDevicePush / recordDeviceGammaPush REFUSE a provisional card', () => {
  const reg = createControllerRegistry(
    ropeControllerTree({ device: { vendor: 'marsinled', provisional: true } }));
  const c = reg.controllers[0];
  assert.throws(() => recordDevicePush(c, { at: '2026-07-31T00:00:00Z', outcome: 'applied' }),
    /still carries a PROVISIONAL binding/);
  assert.throws(() => recordDeviceGammaPush(c,
    { at: '2026-07-31T00:00:00Z', outcome: 'applied', gamma: { r: 2.2, g: 2.2, b: 2.2, w: 1 } }),
  /still carries a PROVISIONAL binding/);
});

// ── 3. The FULL CHAIN: provisional patches exactly like verified ────────────

test('THE FEATURE: a PROVISIONAL card projects the same strand patches as a VERIFIED one', () => {
  const provisional = createControllerRegistry(
    ropeControllerTree({ device: { vendor: 'marsinled', provisional: true } }));
  const verified = createControllerRegistry(ropeControllerTree({ device: VERIFIED_IDENTITY }));

  const provFields = computeLedStrandPatches(provisional, ROPE_COUNTS).fields;
  const verFields = computeLedStrandPatches(verified, ROPE_COUNTS).fields;

  assert.equal(provFields.size, 2, 'both rope strands are patched from a typed IP alone');
  assert.deepEqual([...provFields.keys()].sort(), [...verFields.keys()].sort());
  for (const [name, rec] of provFields) {
    assert.deepEqual(rec, verFields.get(name),
      `'${name}' must patch byte-for-byte identically at either binding grade`);
  }
  // And the addresses are the real per-output ones (docs/41): each output starts
  // at ITS universe, channel 1.
  assert.deepEqual(
    { u: provFields.get('Right_Front_Right').dmxUniverse, a: provFields.get('Right_Front_Right').dmxAddress },
    { u: 36, a: 1 });
  assert.deepEqual(
    { u: provFields.get('Right_Back_Right').dmxUniverse, a: provFields.get('Right_Back_Right').dmxAddress },
    { u: 37, a: 1 });
});

test('THE 2026-08-03 RULING: an UNBOUND card patches EXACTLY like a bound one', () => {
  // Operator ruling 2026-08-03 (report 20260725_123): *"unbound should not cause
  // the lights to go off or unpatched red."* Chaining is the patch; the typed IP
  // is the destination. This SUPERSEDES `_92` §4 and `_121`'s fix direction —
  // routing to an operator-typed but unverified address is his accepted risk,
  // which is the whole point of optional discovery.
  const unbound = createControllerRegistry(ropeControllerTree());
  const provisional = createControllerRegistry(
    ropeControllerTree({ device: { vendor: 'marsinled', provisional: true } }));

  const unboundResult = computeLedStrandPatches(unbound, ROPE_COUNTS);
  const provFields = computeLedStrandPatches(provisional, ROPE_COUNTS).fields;

  assert.equal(unboundResult.fields.size, 2);
  assert.deepEqual(unboundResult.violations, [], 'a chained card with an IP is not a defect');
  for (const [name, rec] of unboundResult.fields) {
    assert.deepEqual(rec, provFields.get(name),
      `'${name}' must patch byte-for-byte identically at ANY binding grade`);
  }
  assert.equal(unboundResult.fields.get('Right_Front_Right').controllerIp, '10.9.9.207',
    'the typed IP IS the routing destination — that is what makes the relay route exist');
});

test('a chained card with NO usable IP still patches, and says why nothing routes', () => {
  const reg = createControllerRegistry(ropeControllerTree({ ip: '' }));
  const { fields, violations } = computeLedStrandPatches(reg, ROPE_COUNTS);
  assert.equal(fields.size, 2, 'patches + model + sim are unaffected by a missing IP');
  assert.equal(fields.get('Right_Front_Right').controllerIp, '',
    'and the empty destination is honest — the bridge refuses to invent one');
  const v = violations.find((x) => x.code === 'led_no_destination_ip');
  assert.ok(v, 'no destination is the ONE loud LED state left');
  assert.equal(v.controllerId, reg.controllers[0].id);
  assert.match(v.message, /RightRightRopes/);
  assert.match(v.message, /2 chained fixture\(s\)/);
});

test('an EMPTY card with no IP is silent (nothing chained, nothing to route)', () => {
  const tree = ropeControllerTree({ ip: '' });
  for (const port of tree.controllers[0].ports) port.chain = [];
  const { fields, violations } = computeLedStrandPatches(createControllerRegistry(tree), ROPE_COUNTS);
  assert.equal(fields.size, 0);
  assert.deepEqual(violations, [], 'a blank card is a work-in-progress, not a defect');
});

test('the ⚑ path the operator actually used still works, and moves NO address', () => {
  // Operator addendum 2026-08-03: he pressed "⚑ Patch without the board" on his
  // five cards and it worked. Regression-protect that path: declaring the claim
  // must be address-neutral now that patching no longer depends on it.
  const reg = createControllerRegistry(ropeControllerTree());
  const before = computeLedStrandPatches(reg, ROPE_COUNTS).fields;
  assert.equal(canMarkProvisional(reg.controllers[0]).allowed, true);
  markControllerProvisional(reg.controllers[0]);
  assert.equal(isProvisionalLedController(reg.controllers[0]), true);
  const after = computeLedStrandPatches(reg, ROPE_COUNTS);
  assert.deepEqual(after.violations, []);
  assert.equal(after.fields.size, before.size);
  for (const [name, rec] of after.fields) {
    assert.deepEqual(rec, before.get(name), `'${name}' must not move when the board is claimed`);
  }
});

test('THE FEATURE: the engine model exports real addresses for a PROVISIONAL card', () => {
  // Same mocked-world harness as pixelblaze_model_exporter_local_index.test.js.
  globalThis.window = globalThis.window || {};
  window._isRebuildingFixtures = false;
  window.parFixtures = [];
  window.dmxSceneFixtures = [];
  window._missingFixtureWarnCount = 0;
  params.dmxFixtures = [];
  params.parLights = [];

  const strands = [
    { name: 'Right_Front_Right', ledCount: 2, startX: 1, startY: 0, startZ: 0, endX: 1, endY: 0, endZ: 1 },
    { name: 'Right_Back_Right', ledCount: 2, startX: 2, startY: 0, startZ: 0, endX: 2, endY: 0, endZ: 1 },
  ];
  params.ledStrands = strands;
  window.ledStrandFixtures = strands.map(() => {
    const g = new THREE.Group();
    g.updateMatrixWorld(true);
    return { group: g };
  });
  window.__controllerRegistry = createControllerRegistry(
    ropeControllerTree({ device: { vendor: 'marsinled', provisional: true } }));

  const { pixels } = generatePixelMap();
  const led = pixels.filter((p) => p.group !== undefined || true);
  assert.equal(led.length, 4);
  for (const px of led) {
    assert.notEqual(px.patch, null,
      'a provisional-bound strand must export a real patch — that IS the feature');
    assert.notEqual(px.unpatched, true,
      'and it must NOT carry the unpatched marker meant for truly unbound strands');
  }
  assert.deepEqual(led.map((p) => `U${p.patch.universe}:${p.patch.addr}`),
    ['U36:1', 'U36:5', 'U37:1', 'U37:5']);

  window.__controllerRegistry = null;
  params.ledStrands = [];
  window.ledStrandFixtures = [];
});

// ── 4. First contact: promote on agreement ──────────────────────────────────

test('first contact, clean: reconcile PASSES and promotion records the fingerprint', () => {
  const reg = createControllerRegistry(
    ropeControllerTree({ device: { vendor: 'marsinled', provisional: true } }));
  const c = reg.controllers[0];
  const result = reconcileProvisionalContact(c, discoveredDevice(), { registry: reg });
  assert.equal(result.ok, true, JSON.stringify(result.mismatches));
  assert.equal(result.checkedClaims, true);
  assert.equal(result.identity.controllerId, 'titanic_207');

  promoteProvisionalBinding(c, result.identity, { registry: reg });
  assert.equal(isVerifiedLedController(c), true);
  assert.equal(c.device.controllerId, 'titanic_207');
  assert.equal(c.device.boardId, 'angio4');
  assert.equal(c.device.provisional, undefined, 'the grade flag is gone once verified');
  assert.match(describeProvisionalReconcile(c, result), /promoted to VERIFIED/);
});

test('promotion only FILLS what the operator left empty — a stated expectation survives', () => {
  const reg = createControllerRegistry(ropeControllerTree({
    device: { vendor: 'marsinled', provisional: true, deviceName: 'Right Ropes (starboard)' },
  }));
  const c = reg.controllers[0];
  // Board reports no deviceName at all in this contact.
  const device = discoveredDevice({ status: { deviceName: undefined } });
  device.deviceName = undefined;
  const result = reconcileProvisionalContact(c, device, { registry: reg });
  assert.equal(result.ok, true);
  promoteProvisionalBinding(c, result.identity, { registry: reg });
  assert.equal(c.device.deviceName, 'Right Ropes (starboard)',
    'a name the board never contradicted must not be silently erased');
});

test('promoteProvisionalBinding REFUSES a card that is not provisional', () => {
  const reg = createControllerRegistry(ropeControllerTree({ device: VERIFIED_IDENTITY }));
  assert.throws(() => promoteProvisionalBinding(reg.controllers[0], VERIFIED_IDENTITY, { registry: reg }),
    /does not carry a PROVISIONAL binding/);
});

test('the patch chain is UNCHANGED by promotion (the point: nothing moves on first boot)', () => {
  const reg = createControllerRegistry(
    ropeControllerTree({ device: { vendor: 'marsinled', provisional: true } }));
  const c = reg.controllers[0];
  const before = computeLedStrandPatches(reg, ROPE_COUNTS).fields;
  const snapshot = new Map([...before].map(([k, v]) => [k, JSON.stringify(v)]));
  promoteProvisionalBinding(c, discoveredDevice(), { registry: reg });
  const after = computeLedStrandPatches(reg, ROPE_COUNTS).fields;
  for (const [name, rec] of after) {
    assert.equal(JSON.stringify(rec), snapshot.get(name),
      `'${name}' must not move when the binding is promoted`);
  }
});

// ── 5. First contact: contradiction is LOUD and changes nothing ─────────────

test('contradiction — the board fingerprint already belongs to another card (HARD BLOCKER)', () => {
  const reg = createControllerRegistry({
    nextControllerId: 3,
    controllers: [
      {
        id: 1, name: 'RightRightRopes', ip: '10.9.9.207', type: CONTROLLER_TYPE_LED,
        led: { order: 'RGBW' }, ports: [{ port: 1, output: 1, universe: 36, chain: [] }],
        device: { vendor: 'marsinled', provisional: true },
      },
      {
        id: 2, name: 'LeftLeftRopes', ip: '10.9.9.201', type: CONTROLLER_TYPE_LED,
        led: { order: 'RGBW' }, ports: [{ port: 1, output: 1, universe: 30, chain: [] }],
        device: VERIFIED_IDENTITY,
      },
    ],
  });
  const c = reg.controllers[0];
  const result = reconcileProvisionalContact(c, discoveredDevice(), { registry: reg });
  assert.equal(result.ok, false);
  assert.equal(result.hardBlocked, true);
  const codes = result.mismatches.map((m) => m.code);
  assert.ok(codes.includes('controller_id_claimed'));
  assert.ok(PROVISIONAL_HARD_BLOCKERS.includes('controller_id_claimed'));
  // And nothing was written: the card is untouched.
  assert.equal(isProvisionalLedController(c), true);
  // The mutation itself refuses too, so no caller can slip past the verdict.
  assert.throws(() => promoteProvisionalBinding(c, result.identity, { registry: reg }),
    /already bound to controller 'LeftLeftRopes'/);
  assert.equal(controllerBoundToDeviceId(reg, 'titanic_207', c).name, 'LeftLeftRopes');
});

test('contradiction — the box is not a MarsinLED at all (HARD BLOCKER, nothing else evaluated)', () => {
  const reg = createControllerRegistry(
    ropeControllerTree({ device: { vendor: 'marsinled', provisional: true } }));
  const result = reconcileProvisionalContact(reg.controllers[0],
    { ip: '10.9.9.207', raw: { server: 'some printer' } }, { registry: reg });
  assert.equal(result.ok, false);
  assert.equal(result.hardBlocked, true);
  assert.deepEqual(result.mismatches.map((m) => m.code), ['device_not_recognized']);
  assert.equal(result.identity, null);
});

test('contradiction — firmware predates per-output DMX', () => {
  const reg = createControllerRegistry(
    ropeControllerTree({ device: { vendor: 'marsinled', provisional: true } }));
  const device = discoveredDevice({ status: { capabilitiesExt: {} } });
  const result = reconcileProvisionalContact(reg.controllers[0], device, { registry: reg });
  assert.equal(result.ok, false);
  assert.equal(result.hardBlocked, false, 'old firmware is a real choice, not an impossibility');
  assert.ok(result.mismatches.some((m) => m.code === 'per_output_unsupported'));
});

test('contradiction — a port drives an output the board does not have', () => {
  const tree = ropeControllerTree({ device: { vendor: 'marsinled', provisional: true } });
  tree.controllers[0].ports.push({ port: 3, output: 6, universe: 38, chain: [] });
  const reg = createControllerRegistry(tree);
  const result = reconcileProvisionalContact(reg.controllers[0], discoveredDevice(), { registry: reg });
  assert.equal(result.ok, false);
  const m = result.mismatches.find((x) => x.code === 'board_output_count');
  assert.ok(m, 'the overshoot must be named');
  assert.match(m.message, /4 output\(s\)/);
  assert.match(m.actual, /P3→output 6/);
});

test('contradiction — the board answers at a different IP than the one typed', () => {
  const reg = createControllerRegistry(
    ropeControllerTree({ device: { vendor: 'marsinled', provisional: true } }));
  const device = discoveredDevice({ device: { ip: '10.9.9.208' } });
  const result = reconcileProvisionalContact(reg.controllers[0], device, { registry: reg });
  assert.ok(result.mismatches.some((m) => m.code === 'ip_mismatch'));
});

test('contradiction — the board disagrees with a STATED expectation', () => {
  const reg = createControllerRegistry(ropeControllerTree({
    device: { vendor: 'marsinled', provisional: true, boardId: 'angio4-old', deviceName: 'Old-207' },
  }));
  const result = reconcileProvisionalContact(reg.controllers[0], discoveredDevice(), { registry: reg });
  assert.equal(result.ok, false);
  const codes = result.mismatches.map((m) => m.code);
  assert.ok(codes.includes('board_id_mismatch'));
  assert.ok(codes.includes('device_name_mismatch'));
  assert.equal(result.hardBlocked, false);
  assert.match(describeProvisionalReconcile(reg.controllers[0], result), /stays PROVISIONAL/);
});

test('reconcile REFUSES to run on a card that is not provisional (no silent no-op)', () => {
  const reg = createControllerRegistry(ropeControllerTree({ device: VERIFIED_IDENTITY }));
  assert.throws(() => reconcileProvisionalContact(reg.controllers[0], discoveredDevice(), { registry: reg }),
    /does not carry a PROVISIONAL binding/);
});

test('reconcile without a registry SAYS the claim check was skipped', () => {
  const reg = createControllerRegistry(
    ropeControllerTree({ device: { vendor: 'marsinled', provisional: true } }));
  const result = reconcileProvisionalContact(reg.controllers[0], discoveredDevice());
  assert.equal(result.checkedClaims, false);
});

test('provisionalCandidatesForDevice matches provisional cards BY IP (the only thing declared)', () => {
  const reg = createControllerRegistry(
    ropeControllerTree({ device: { vendor: 'marsinled', provisional: true } }));
  assert.deepEqual(
    provisionalCandidatesForDevice(reg, { ip: '10.9.9.207' }).map((c) => c.name),
    ['RightRightRopes']);
  assert.deepEqual(provisionalCandidatesForDevice(reg, { ip: '10.9.9.99' }), []);
  // A VERIFIED card is never an IP candidate — it matches on controllerId.
  const verified = createControllerRegistry(ropeControllerTree({ device: VERIFIED_IDENTITY }));
  assert.deepEqual(provisionalCandidatesForDevice(verified, { ip: '10.9.9.207' }), []);
});

// ── 6. The placeholder sentinel ─────────────────────────────────────────────

test('placeholder: 0.0.0.0 CANNOT be declared provisional (it is a reservation, not an address)', () => {
  const reg = createControllerRegistry(ropeControllerTree({ ip: PLACEHOLDER_IP }));
  const gate = canMarkProvisional(reg.controllers[0]);
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /placeholder sentinel/);
});

test('placeholder: typing the real IP over 0.0.0.0 converts it cleanly to provisional', () => {
  const reg = createControllerRegistry(ropeControllerTree({ ip: PLACEHOLDER_IP }));
  const c = reg.controllers[0];
  assert.equal(canMarkProvisional(c).allowed, false);
  c.ip = '10.9.9.207';                       // exactly what the operator types in the pane
  assert.equal(canMarkProvisional(c).allowed, true);
  markControllerProvisional(c);
  const { fields } = computeLedStrandPatches(reg, ROPE_COUNTS);
  assert.equal(fields.size, 2);
  assert.equal(fields.get('Right_Front_Right').controllerIp, '10.9.9.207');
});

test('placeholder + provisional COMPOSE: a hand-written 0.0.0.0 card still patches, honestly', () => {
  // The TE-sign case from report 20260725_92: the sign controller reserves its
  // universes on the sentinel while the wiring is assembled. If that card is
  // ALSO declared provisional the strands patch — with the sentinel showing
  // through into every record, which is exactly the loud "no address yet" the
  // parity gate's `placeholder_controller` finding is built to catch.
  const reg = createControllerRegistry(ropeControllerTree({
    ip: PLACEHOLDER_IP, device: { vendor: 'marsinled', provisional: true },
  }));
  const { fields } = computeLedStrandPatches(reg, ROPE_COUNTS);
  assert.equal(fields.size, 2);
  assert.equal(fields.get('Right_Front_Right').controllerIp, PLACEHOLDER_IP);
  assert.equal(fields.get('Right_Front_Right').dmxUniverse, 36);
});

// ── 7. Unbinding returns to the honest dark state ───────────────────────────

test('dropping a provisional binding withdraws the CLAIM, never the patches', () => {
  // Ruling 2026-08-03: binding governs hardware claims, not addresses.
  const reg = createControllerRegistry(
    ropeControllerTree({ device: { vendor: 'marsinled', provisional: true } }));
  const c = reg.controllers[0];
  const before = computeLedStrandPatches(reg, ROPE_COUNTS).fields;
  assert.equal(before.size, 2);
  unbindControllerDevice(c);
  const after = computeLedStrandPatches(reg, ROPE_COUNTS).fields;
  assert.equal(ledBindingGrade(c), null, 'the grade is gone');
  assert.equal(after.size, 2, 'the patches are not');
  for (const [name, rec] of after) assert.deepEqual(rec, before.get(name));
});

test('bindControllerDevice on a provisional card promotes it (the push path)', () => {
  const reg = createControllerRegistry(
    ropeControllerTree({ device: { vendor: 'marsinled', provisional: true } }));
  const c = reg.controllers[0];
  bindControllerDevice(c, VERIFIED_IDENTITY);
  assert.equal(isVerifiedLedController(c), true);
  assert.equal(c.device.provisional, undefined);
  // …and the receipt it could not hold before is now recordable.
  recordDevicePush(c, { at: '2026-07-31T12:00:00Z', outcome: 'needs-reboot' });
  assert.equal(c.device.lastPush.outcome, 'needs-reboot');
});
