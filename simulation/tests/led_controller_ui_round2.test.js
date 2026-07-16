/**
 * led_controller_ui_round2.test.js — the operator-UI seams behind the DOM.
 *
 *  R1 — the default tray lists unmapped LED strands, not just fixtures.
 *  R2 — strict type gating: LED controllers take only strands, DMX only fixtures.
 *  R5 — push-all: per-output, sequential, FORCE (writes even when in sync), binds
 *       an unbound card on success, skips no-IP, one failure does NOT abort the
 *       rest, firmware-too-old is a loud failure.
 *
 * No DOM, no three.js, no live device — the push orchestration runs against a
 * MOCK device store (the operator runs experiments on the real 10.1.1.20x;
 * nothing here touches it).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createControllerRegistry,
  addController,
  unmapFixture,
  controllerFixtureKind,
  controllerAcceptsKind,
  unmappedNamesByKind,
  isBoundLedController,
  CONTROLLER_TYPE_DMX,
  CONTROLLER_TYPE_LED,
} from '../src/dmx/controller_registry.js';
import { pushAllLedControllers } from '../src/gui/led_discovery_panel.js';

// ── R1 — default tray includes unmapped strands ──────────────────────────────

test('R1: unmappedNamesByKind returns unmapped fixtures AND strands', () => {
  const reg = createControllerRegistry({
    controllers: [{
      id: 1, name: 'DMX', ip: '10.0.0.1', type: CONTROLLER_TYPE_DMX,
      ports: [{ port: 1, universe: 2, chain: ['f1'] }],
    }],
  });
  const out = unmappedNamesByKind(reg, ['f1', 'f2'], ['s1', 's2']);
  assert.deepEqual(out.fixtures, ['f2']);          // f1 is mapped
  assert.deepEqual(out.strands, ['s1', 's2']);     // strands visible with no LED controller
});

test('R1: a mapped strand drops out of the tray list', () => {
  const reg = createControllerRegistry({
    controllers: [{
      id: 1, name: 'L', ip: '10.1.1.201', type: CONTROLLER_TYPE_LED,
      led: { order: 'RGBW', baseUniverse: 3, startAddr: 1 },
      ports: [{ port: 1, universe: 3, chain: ['s1'] }],
    }],
  });
  const out = unmappedNamesByKind(reg, [], ['s1', 's2']);
  assert.deepEqual(out.strands, ['s2']);
  // And after unmapping s1 it returns to the tray.
  unmapFixture(reg, 's1');
  assert.deepEqual(unmappedNamesByKind(reg, [], ['s1', 's2']).strands, ['s1', 's2']);
});

// ── R2 — strict type gating ──────────────────────────────────────────────────

test('R2: controllerFixtureKind splits LED (strand) vs DMX (fixture)', () => {
  const reg = createControllerRegistry({});
  const dmx = addController(reg, { name: 'D', ip: '10.0.0.1', type: CONTROLLER_TYPE_DMX });
  const led = addController(reg, { name: 'L', ip: '10.0.0.2', type: CONTROLLER_TYPE_LED });
  assert.equal(controllerFixtureKind(dmx), 'fixture');
  assert.equal(controllerFixtureKind(led), 'strand');
});

test('R2: controllerAcceptsKind refuses the cross-type name', () => {
  const reg = createControllerRegistry({});
  const dmx = addController(reg, { name: 'D', ip: '10.0.0.1', type: CONTROLLER_TYPE_DMX });
  const led = addController(reg, { name: 'L', ip: '10.0.0.2', type: CONTROLLER_TYPE_LED });
  assert.equal(controllerAcceptsKind(led, 'strand'), true);
  assert.equal(controllerAcceptsKind(led, 'fixture'), false);   // a moving head is not a pixel run
  assert.equal(controllerAcceptsKind(dmx, 'fixture'), true);
  assert.equal(controllerAcceptsKind(dmx, 'strand'), false);    // an LED strand has no DMX footprint
});

// ── Shared device fixtures (per-output MarsinLED, titanic_202 shape) ──────────

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function strandDev(enabled, count, pinData) {
  return {
    type: 'WS281X_RGBW', count, pinData, pinClock: 0, colorOrder: 'RGBW',
    rgbwMode: 'exact', enabled, deadPixels: 0, deadPixelIndices: [],
  };
}

/** A device /api/config snapshot: 2 outputs (out0 on, out1 off) + dmx. */
function deviceConfig() {
  return {
    strands: [strandDev(true, 40, 35), strandDev(false, 40, 36)],
    dmx: { enabled: true, protocol: 0, universe: 1, startAddress: 1, timeoutMs: 3000 },
    deviceName: 'Titanic-XXX', firmwareSHA: 'be2fcc1b5f6f',
  };
}

/**
 * A /api/status body. `perOutput` seeds the confirmed read-back; `perOutputDmx`
 * false models firmware too old for per-output DMX.
 */
function deviceStatus(controllerId, perOutput = [], perOutputDmx = true) {
  return {
    controllerId, boardId: 'angio4-old', mac: 'AA:BB:CC:DD:02:01',
    firmwareSHA: 'be2fcc1b5f6f', strands: deviceConfig().strands,
    capabilitiesExt: perOutputDmx ? { perOutputDmx: true } : {},
    sacn: { enabled: true, perOutput },
  };
}

/** An LED controller card (registry shape). `bound` toggles the device block. */
function ledCard(id, ip, universe, strandName, bound = true) {
  const card = {
    id, name: `T-${id}`, ip, type: CONTROLLER_TYPE_LED,
    led: { order: 'RGBW', baseUniverse: universe, startAddr: 1 },
    ports: [{ port: 1, universe, chain: [strandName] }],
  };
  if (bound) {
    card.device = { vendor: 'marsinled', controllerId: `titanic_${id}`, deviceName: `Titanic-${id}` };
  }
  return card;
}

/** Mock per-output device I/O: getStatus / getConfig / pushPerOutputUniverses / awaitReboot. */
function makeMockIo(devices, calls) {
  return {
    getStatus: async (ip) => {
      calls.push(`getStatus:${ip}`);
      const d = devices[ip];
      if (!d) throw new Error(`unreachable ${ip}`);
      return clone(d.status);
    },
    getConfig: async (ip) => { calls.push(`getConfig:${ip}`); return clone(devices[ip].config); },
    pushPerOutputUniverses: async (ip, { universeByOutputIndex }) => {
      calls.push(`push:${ip}`);
      const d = devices[ip];
      if (d.throwOnPush) throw new Error('device rejected: HTTP 400');
      d.pushed = universeByOutputIndex;
      // The device reports the plan back UNLESS configured to mismatch on verify.
      if (!d.verifyMismatch) {
        d.status.sacn.perOutput = Object.entries(universeByOutputIndex)
          .map(([index, universe]) => ({ index: Number(index), universe, startAddress: 1, enabled: true }));
      }
      return { outcome: 'needs-reboot', reboot: true };
    },
    awaitReboot: async (ip) => { calls.push(`awaitReboot:${ip}`); },
  };
}

function makeCtx(reg, counts) {
  return {
    registry: () => reg,
    strandLedCounts: () => counts,
    mutate: (_msg, fn) => fn(),
    refresh: () => {},
    showToast: () => {},
  };
}

// ── R5 — push-all: per-output, sequential, FORCE, bind unbound, continue ──────

test('R5: pushAllLedControllers force-pushes (even in sync), serializes, binds unbound, continues', async () => {
  // A = already in sync (device reports the plan), still FORCE-pushed.
  // B = push fails (device 400) → failed, does NOT abort the rest.
  // C = UNBOUND card → pushes AND binds on success.
  const reg = createControllerRegistry({
    controllers: [
      ledCard(1, '10.0.0.1', 3, 'sA', true),
      ledCard(2, '10.0.0.2', 4, 'sB', true),
      ledCard(3, '10.0.0.3', 5, 'sC', false),   // unbound
    ],
  });
  const counts = new Map([['sA', 40], ['sB', 40], ['sC', 40]]);
  const devices = {
    '10.0.0.1': {
      config: deviceConfig(),
      status: deviceStatus('titanic_1', [{ index: 0, universe: 3, startAddress: 1, enabled: true }]),
    },
    '10.0.0.2': { config: deviceConfig(), status: deviceStatus('titanic_2'), throwOnPush: true },
    '10.0.0.3': { config: deviceConfig(), status: deviceStatus('titanic_3') },
  };
  const calls = [];
  const results = await pushAllLedControllers(makeCtx(reg, counts), makeMockIo(devices, calls));

  assert.equal(results.length, 3);
  assert.equal(results[0].state, 'pushed');        // in-sync is STILL force-pushed
  assert.equal(results[1].state, 'failed');
  assert.match(results[1].detail, /400/);
  assert.equal(results[2].state, 'pushed');

  // Force: the in-sync controller WAS pushed (no in-sync short-circuit).
  assert.ok(calls.includes('push:10.0.0.1'), 'in-sync controller must be force-pushed');
  // The failure did NOT abort C.
  assert.ok(calls.includes('push:10.0.0.3'), 'C must still be pushed after B fails');
  assert.ok(calls.includes('awaitReboot:10.0.0.3'), 'C reboot must be awaited');

  // Unbound card C is now bound (adopted the device identity from status).
  const c = reg.controllers[2];
  assert.equal(isBoundLedController(c), true, 'pushing an unbound card binds it');
  assert.equal(c.device.controllerId, 'titanic_3');
  // The device status carries a mac (deviceStatus() fixture) — auto-bind-on-push
  // must NOT carry it into the persisted device block (public repo, gitleaks
  // bm26-mac-address rule).
  assert.equal('mac' in c.device, false);

  // Sequential: A processed before B before C (first getStatus proves order).
  const s1 = calls.indexOf('getStatus:10.0.0.1');
  const s2 = calls.indexOf('getStatus:10.0.0.2');
  const s3 = calls.indexOf('getStatus:10.0.0.3');
  assert.ok(s1 < s2 && s2 < s3, 'controllers processed in registry order');
  // C's push → reboot → verify happen in order.
  const p3 = calls.indexOf('push:10.0.0.3');
  const r3 = calls.indexOf('awaitReboot:10.0.0.3');
  const v3 = calls.lastIndexOf('getStatus:10.0.0.3');
  assert.ok(p3 < r3 && r3 < v3, 'push → awaitReboot → verify order');
});

test('R5: firmware without per-output DMX is a LOUD failure (no push, no legacy fallback)', async () => {
  const reg = createControllerRegistry({ controllers: [ledCard(1, '10.0.0.1', 3, 'sA', true)] });
  const counts = new Map([['sA', 40]]);
  const devices = {
    '10.0.0.1': { config: deviceConfig(), status: deviceStatus('titanic_1', [], false) },   // too old
  };
  const calls = [];
  const results = await pushAllLedControllers(makeCtx(reg, counts), makeMockIo(devices, calls));
  assert.equal(results[0].state, 'failed');
  assert.match(results[0].detail, /firmware too old/);
  assert.ok(!calls.includes('push:10.0.0.1'), 'a too-old device must NOT be pushed');
});

test('R5: a verify mismatch (device reports the wrong universe) is a failure', async () => {
  const reg = createControllerRegistry({ controllers: [ledCard(1, '10.0.0.1', 5, 'sA', true)] });
  const counts = new Map([['sA', 40]]);
  const devices = {
    '10.0.0.1': {
      config: deviceConfig(),
      // Device keeps reporting U99 (verifyMismatch: don't overwrite on push).
      status: deviceStatus('titanic_1', [{ index: 0, universe: 99, startAddress: 1, enabled: true }]),
      verifyMismatch: true,
    },
  };
  const calls = [];
  const results = await pushAllLedControllers(makeCtx(reg, counts), makeMockIo(devices, calls));
  assert.equal(results[0].state, 'failed');
  assert.match(results[0].detail, /mapping mismatch/);
  assert.ok(calls.includes('push:10.0.0.1'), 'the push was attempted then failed verify');
});

test('R5: a controller with no valid IP is SKIPPED (no device I/O)', async () => {
  const reg = createControllerRegistry({ controllers: [ledCard(1, '', 3, 'sA', true)] });
  const counts = new Map([['sA', 40]]);
  const calls = [];
  const results = await pushAllLedControllers(makeCtx(reg, counts), makeMockIo({}, calls));
  assert.equal(results.length, 1);
  assert.equal(results[0].state, 'skipped');
  assert.equal(calls.length, 0, 'no device I/O for a controller without a valid IP');
});
