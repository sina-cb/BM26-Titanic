/**
 * led_device_binding.test.js — device-binding schema + provenance contract for
 * LED controllers (plan 20260709_0 P4). Pure logic: no DOM, no three.js, no
 * network. Covers normalizeDeviceBlock, load-time validation in
 * createControllerRegistry, and the bind / record-push / create-from-device
 * mutations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createControllerRegistry,
  normalizeDeviceBlock,
  bindControllerDevice,
  unbindControllerDevice,
  recordDevicePush,
  addLedControllerFromDevice,
  isBoundLedController,
  addController,
  CONTROLLER_TYPE_LED,
  CONTROLLER_TYPE_DMX,
  LED_DEVICE_VENDOR_MARSINLED,
} from '../src/dmx/controller_registry.js';

const IDENTITY = {
  vendor: 'marsinled',
  controllerId: 'titanic_201',
  deviceName: 'Titanic-201',
  boardId: 'angio4-old',
  mac: 'AA:BB:CC:DD:02:01',
};

function ledControllerTree(extra = {}) {
  return {
    controllers: [{
      id: 1, name: 'T201', ip: '10.1.1.201', type: CONTROLLER_TYPE_LED,
      led: { order: 'RGBW', baseUniverse: 3, startAddr: 1 },
      ports: [{ port: 1, universe: 3, chain: [] }],
      ...extra,
    }],
  };
}

// ── normalizeDeviceBlock ─────────────────────────────────────────────────────

test('normalizeDeviceBlock: undefined/null → undefined (unbound is fine)', () => {
  assert.equal(normalizeDeviceBlock(undefined, 'C'), undefined);
  assert.equal(normalizeDeviceBlock(null, 'C'), undefined);
});

test('normalizeDeviceBlock: full valid block round-trips', () => {
  const d = normalizeDeviceBlock({
    ...IDENTITY,
    lastPush: { at: '2026-07-10T00:00:00Z', outcome: 'needs-reboot', firmwareSHA: 'abc', configHash: 'def' },
  }, 'C');
  assert.equal(d.vendor, 'marsinled');
  assert.equal(d.controllerId, 'titanic_201');
  assert.equal(d.deviceName, 'Titanic-201');
  assert.equal(d.lastPush.outcome, 'needs-reboot');
  assert.equal(d.lastPush.configHash, 'def');
});

test('normalizeDeviceBlock: unknown vendor THROWS (no silent migration)', () => {
  assert.throws(() => normalizeDeviceBlock({ vendor: 'wled', controllerId: 'x' }, 'C'), /not a recognized/);
});

test('normalizeDeviceBlock: missing controllerId THROWS', () => {
  assert.throws(() => normalizeDeviceBlock({ vendor: 'marsinled' }, 'C'), /controllerId/);
});

test('normalizeDeviceBlock: bad lastPush.outcome THROWS', () => {
  assert.throws(() => normalizeDeviceBlock(
    { ...IDENTITY, lastPush: { at: 't', outcome: 'exploded' } }, 'C'), /outcome/);
});

test('normalizeDeviceBlock: lastPush without at THROWS', () => {
  assert.throws(() => normalizeDeviceBlock(
    { ...IDENTITY, lastPush: { outcome: 'applied' } }, 'C'), /lastPush\.at/);
});

test('normalizeDeviceBlock: array/non-object THROWS', () => {
  assert.throws(() => normalizeDeviceBlock([1, 2], 'C'), /must be a mapping/);
});

// ── createControllerRegistry load-time validation ────────────────────────────

test('createControllerRegistry: LED controller with a valid device loads bound', () => {
  const reg = createControllerRegistry(ledControllerTree({ device: IDENTITY }));
  const c = reg.controllers[0];
  assert.equal(c.device.controllerId, 'titanic_201');
  assert.equal(isBoundLedController(c), true);
});

test('createControllerRegistry: absent device block = unbound (fine)', () => {
  const reg = createControllerRegistry(ledControllerTree());
  assert.equal(reg.controllers[0].device, undefined);
  assert.equal(isBoundLedController(reg.controllers[0]), false);
});

test('createControllerRegistry: unknown vendor hard-stops the boot', () => {
  assert.throws(
    () => createControllerRegistry(ledControllerTree({ device: { vendor: 'nope', controllerId: 'x' } })),
    /not a recognized/);
});

test('createControllerRegistry: device block on a DMX controller THROWS', () => {
  assert.throws(() => createControllerRegistry({
    controllers: [{ id: 1, name: 'D', ip: '10.0.0.1', type: CONTROLLER_TYPE_DMX, device: IDENTITY,
      ports: [{ port: 1, universe: 2, chain: [] }] }],
  }), /only valid on an LED controller/);
});

// ── bind / unbind / record-push mutations ────────────────────────────────────

test('bindControllerDevice binds an LED controller and preserves prior push', () => {
  const reg = createControllerRegistry(ledControllerTree({
    device: { ...IDENTITY, lastPush: { at: 't0', outcome: 'applied' } },
  }));
  const c = reg.controllers[0];
  bindControllerDevice(c, { vendor: 'marsinled', controllerId: 'titanic_201', deviceName: 'Renamed' });
  assert.equal(c.device.deviceName, 'Renamed');
  assert.equal(c.device.lastPush.at, 't0'); // provenance preserved across a re-bind
});

test('bindControllerDevice on a DMX controller THROWS', () => {
  const reg = createControllerRegistry({
    controllers: [{ id: 1, name: 'D', ip: '10.0.0.1', type: CONTROLLER_TYPE_DMX,
      ports: [{ port: 1, universe: 2, chain: [] }] }],
  });
  assert.throws(() => bindControllerDevice(reg.controllers[0], IDENTITY), /not an LED controller/);
});

test('unbindControllerDevice returns the controller to unbound', () => {
  const reg = createControllerRegistry(ledControllerTree({ device: IDENTITY }));
  const c = reg.controllers[0];
  unbindControllerDevice(c);
  assert.equal(c.device, undefined);
});

test('recordDevicePush stamps provenance and validates outcome', () => {
  const reg = createControllerRegistry(ledControllerTree({ device: IDENTITY }));
  const c = reg.controllers[0];
  recordDevicePush(c, { at: '2026-07-10T01:02:03Z', outcome: 'needs-reboot', firmwareSHA: 'be2f', configHash: 'sha' });
  assert.equal(c.device.lastPush.outcome, 'needs-reboot');
  assert.equal(c.device.lastPush.configHash, 'sha');
  assert.throws(() => recordDevicePush(c, { at: 't', outcome: 'boom' }), /outcome/);
});

test('recordDevicePush on an unbound controller THROWS', () => {
  const reg = createControllerRegistry(ledControllerTree());
  assert.throws(() => recordDevicePush(reg.controllers[0], { at: 't', outcome: 'applied' }),
    /not bound to a device/);
});

// ── addLedControllerFromDevice ───────────────────────────────────────────────

test('addLedControllerFromDevice creates N ports, RGBW, and the binding', () => {
  const reg = createControllerRegistry({});
  const c = addLedControllerFromDevice(reg, {
    name: 'Titanic-201', ip: '10.1.1.201', portCount: 4, order: 'RGBW', device: IDENTITY,
  });
  assert.equal(c.type, CONTROLLER_TYPE_LED);
  assert.equal(c.ports.length, 4);
  assert.equal(c.led.order, 'RGBW');
  assert.equal(c.device.vendor, LED_DEVICE_VENDOR_MARSINLED);
  assert.equal(reg.controllers.length, 1);
});

// ── Persistence round-trip: a bound registry re-loads cleanly ────────────────

test('a bound controller survives a save/load round-trip', () => {
  const reg = createControllerRegistry({});
  const c = addController(reg, { name: 'L', ip: '10.1.1.201', type: CONTROLLER_TYPE_LED });
  bindControllerDevice(c, IDENTITY);
  recordDevicePush(c, { at: '2026-07-10T00:00:00Z', outcome: 'applied', configHash: 'h' });
  // Serialize exactly like the save-server writes controllers.yaml, then reload.
  const serialized = JSON.parse(JSON.stringify({
    nextControllerId: reg.nextControllerId,
    nextUniverse: reg.nextUniverse,
    controllers: reg.controllers,
  }));
  const reloaded = createControllerRegistry(serialized);
  const rc = reloaded.controllers[0];
  assert.equal(rc.device.controllerId, 'titanic_201');
  assert.equal(rc.device.lastPush.configHash, 'h');
  assert.equal(isBoundLedController(rc), true);
});
