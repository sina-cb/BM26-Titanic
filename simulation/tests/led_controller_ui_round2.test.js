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
import {
  pushAllLedControllers,
  persistAndNotifyAfterPush,
  describePushCompletion,
  computeSyncState,
  describeSyncChipTooltip,
  outputSelectorOptions,
  showPerOutputPushConfirm,
  startPushAll,
  renderDeviceBindingSection,
  FORCE_PUSH_WARNING,
  FORCE_PUSH_ALL_WARNING,
} from '../src/gui/led_discovery_panel.js';
import { renderGammaSection } from '../src/gui/led_gamma_ui.js';
import { buildForcedConfigBody } from '../src/dmx/led/marsinled_client.js';

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
    dmx: { enabled: false, protocol: 0, universe: 1, startAddress: 1, timeoutMs: 3000 },
    deviceName: 'Titanic-XXX', firmwareSHA: 'be2fcc1b5f6f',
  };
}

/**
 * A /api/status body. `perOutput` seeds runtime receiver status;
 * `perOutputDmx` false models firmware too old for per-output DMX.
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

/**
 * Mock per-output device I/O: getStatus / getConfig / pushForcedConfig /
 * awaitReboot. The forced push posts ONE body built from the plan + the same
 * snapshot the plan was derived from; the mock board applies it verbatim UNLESS
 * `verifyMismatch` tells it to keep its old mapping.
 */
function makeMockIo(devices, calls) {
  return {
    getStatus: async (ip) => {
      calls.push(`getStatus:${ip}`);
      const d = devices[ip];
      if (!d) throw new Error(`unreachable ${ip}`);
      return clone(d.status);
    },
    getConfig: async (ip) => { calls.push(`getConfig:${ip}`); return clone(devices[ip].config); },
    pushForcedConfig: async (ip, body) => {
      calls.push(`push:${ip}`);
      const d = devices[ip];
      if (d.throwOnPush) throw new Error('device rejected: HTTP 400');
      d.pushedBody = body;
      // The saved config reads the body back UNLESS configured to mismatch.
      if (!d.verifyMismatch) {
        d.config.strands = body.strands.map((strand) => ({ ...strand }));
        d.config.dmx = { ...body.dmx };
        if (body.swarm) d.config.swarm = { ...body.swarm };
      } else {
        // A board that ignored the mode write too — the verify must catch it.
        d.config.dmx = { ...body.dmx };
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
    // Registry-wide universe claims for the per-output plan gate (slice S2).
    // These cards sit on distinct universes with nothing else in the rig, so the
    // index is empty here; the gate itself is covered in per_output_push.test.js.
    claimedUniverses: () => new Map(),
    mutate: (_msg, fn) => fn(),
    refresh: () => {},
    showToast: () => {},
    activeScene: () => 'test',   // sync/MAC caches are scene-scoped (G7)
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
  assert.match(results[0].detail, /config mismatch/);
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

// ── S1 — push-all completes the loop ONCE, after the sequence ────────────────
// Same principle as the single push (report 20260725_58 §5.4): the fleet's
// device writes move only the device layer; the scene save + bridge notify run
// exactly once at the end, in startPushAll. A save per controller would rewrite
// the same files N times and notify the bridge against a half-updated registry.

test('S1: pushAllLedControllers is DEVICE-LAYER ONLY — it never saves or notifies', async () => {
  const reg = createControllerRegistry({
    controllers: [ledCard(1, '10.0.0.1', 3, 'sA', true), ledCard(2, '10.0.0.2', 4, 'sB', true)],
  });
  const counts = new Map([['sA', 40], ['sB', 40]]);
  const devices = {
    '10.0.0.1': { config: deviceConfig(), status: deviceStatus('titanic_1') },
    '10.0.0.2': { config: deviceConfig(), status: deviceStatus('titanic_2') },
  };
  const calls = [];
  const io = makeMockIo(devices, calls);
  io.persistScene = async () => { calls.push('persistScene'); return { ok: true }; };
  io.notifyBridge = async () => { calls.push('notifyBridge'); return { ok: true }; };

  const results = await pushAllLedControllers(makeCtx(reg, counts), io);
  assert.deepEqual(results.map((r) => r.state), ['pushed', 'pushed']);
  assert.equal(calls.includes('persistScene'), false, 'the fleet loop must not save per controller');
  assert.equal(calls.includes('notifyBridge'), false);
});

test('S1: the fleet completion saves once, notifies, then READS the routes back — one sentence', async () => {
  const calls = [];
  let seenExpectations = null;
  const steps = await persistAndNotifyAfterPush({
    persistScene: async () => { calls.push('persistScene'); return { ok: true }; },
    notifyBridge: async () => { calls.push('notifyBridge'); return { ok: true }; },
    confirmBridgeRoutes: async (expectations) => {
      calls.push('confirmRoutes');
      seenExpectations = expectations;
      return { ok: true, detail: 'U3→10.0.0.1, U4→10.0.0.2' };
    },
  }, [
    { ip: '10.0.0.1', controllerName: 'a', expected: [3] },
    { ip: '10.0.0.2', controllerName: 'b', expected: [4] },
  ]);
  assert.deepEqual(calls, ['persistScene', 'notifyBridge', 'confirmRoutes']);
  assert.equal(seenExpectations.length, 2, 'the read-back covers the WHOLE fleet');

  const outcome = describePushCompletion(steps, {
    lead: 'done — 2 pushed · 0 skipped · 0 failed',
    deviceNote: 'the device(s) WERE written (cannot be rolled back)',
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.text,
    'done — 2 pushed · 0 skipped · 0 failed · ✓ scene saved (patches projected) · ' +
    '✓ bridge routes confirmed (U3→10.0.0.1, U4→10.0.0.2)');
});

test('_127: a fleet where NOTHING pushed confirms nothing — explicitly, not silently', async () => {
  const calls = [];
  const steps = await persistAndNotifyAfterPush({
    persistScene: async () => ({ ok: true }),
    notifyBridge: async () => ({ ok: true }),
    confirmBridgeRoutes: async () => { calls.push('confirmRoutes'); return { ok: true, detail: 'x' }; },
  }, []);
  assert.equal(calls.length, 0, 'no expectation — the bridge is not queried');
  const outcome = describePushCompletion(steps, { lead: 'done — 0 pushed · 2 skipped · 0 failed' });
  assert.equal(outcome.ok, true);
  assert.match(outcome.text, /✓ bridge notified — nothing was pushed, no routes to confirm/);
});

test('_127: pushed fleet results CARRY their route expectation for the one completion', async () => {
  const reg = createControllerRegistry({
    controllers: [ledCard(1, '10.0.0.1', 3, 'sA', true), ledCard(2, '10.0.0.2', 4, 'sB', true)],
  });
  const counts = new Map([['sA', 40], ['sB', 40]]);
  const devices = {
    '10.0.0.1': { config: deviceConfig(), status: deviceStatus('titanic_1') },
    '10.0.0.2': { config: deviceConfig(), status: deviceStatus('titanic_2') },
  };
  const results = await pushAllLedControllers(makeCtx(reg, counts), makeMockIo(devices, []));
  assert.deepEqual(results.map((r) => r.state), ['pushed', 'pushed']);
  assert.deepEqual(results[0].expectation.expected, [3]);
  assert.equal(results[0].expectation.ip, '10.0.0.1');
  assert.deepEqual(results[1].expectation.expected, [4]);
  assert.equal(results[1].expectation.ip, '10.0.0.2');
});

test('S1: a fleet whose save fails says the devices WERE written and never notifies', async () => {
  const calls = [];
  const steps = await persistAndNotifyAfterPush({
    persistScene: async () => { calls.push('persistScene'); return { ok: false, reason: 'save server responded 500' }; },
    notifyBridge: async () => { calls.push('notifyBridge'); return { ok: true }; },
  });
  assert.deepEqual(calls, ['persistScene']);
  const outcome = describePushCompletion(steps, {
    lead: 'done — 2 pushed · 0 skipped · 0 failed',
    deviceNote: 'the device(s) WERE written (cannot be rolled back)',
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failedStep, 'scene save');
  assert.match(outcome.text, /the device\(s\) WERE written \(cannot be rolled back\)/);
  assert.match(outcome.text, /LEDs will not follow until a successful save\./);
});

// ── _71/_362: the chip measures the FULL forced array, and the output selector ─
// The sync chip compares device ≡ plan across the WHOLE forced array — every
// output the push would enable, every one it would DISABLE, every count it would
// rewrite, and whether the board is DMX-driven at all — using the same claims and
// the same derive as the push, so the chip and the push can never disagree.
// No DOM, no device: `computeSyncState` reads through a stubbed global fetch.

function jsonResponse(body, { ok = true, status = 200, statusText = 'OK' } = {}) {
  return { ok, status, statusText, json: async () => body };
}

async function withFetch(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

/** A 4-output board; `enabledFlags` says which outputs the hardware has ON. */
function board(enabledFlags) {
  return {
    strands: enabledFlags.map((on, i) => strandDev(on, 40, 35 + i)),
    dmx: { enabled: false, protocol: 0, universe: 1, startAddress: 1, timeoutMs: 3000 },
    deviceName: 'LeftLeftFront',
  };
}

function boardStatus(enabledFlags, perOutput) {
  return {
    controllerId: 'titanic_60', boardId: 'angio4', mac: 'AA:BB:CC:DD:00:60',
    firmwareSHA: 'aa11bb22cc33', strands: board(enabledFlags).strands,
    capabilitiesExt: { perOutputDmx: true },
    sacn: { enabled: true, perOutput },
  };
}

function outputCard(ports) {
  const card = {
    id: 60, name: 'LeftLeftFront', ip: '10.0.0.60', type: CONTROLLER_TYPE_LED,
    led: { order: 'RGBW', startAddr: 1 },
    device: { vendor: 'marsinled', controllerId: 'titanic_60', deviceName: 'LeftLeftFront' },
    ports,
  };
  return createControllerRegistry({ controllers: [card] });
}

const OUT_COUNTS = new Map([['sA', 40], ['sB', 40]]);

async function syncOf(reg, enabledFlags, perOutput, { dmxEnabled = true } = {}) {
  const card = reg.controllers[0];
  const config = board(enabledFlags);
  config.dmx = { enabled: dmxEnabled, protocol: 0, timeoutMs: 3000 };
  for (const output of perOutput) {
    config.strands[output.index].dmxUniverse = output.universe;
    config.strands[output.index].dmxStartAddress = output.startAddress;
  }
  return withFetch(async (url) => {
    if (url === 'http://10.0.0.60/api/config') return jsonResponse(config);
    if (url === 'http://10.0.0.60/api/status') return jsonResponse(boardStatus(enabledFlags, perOutput));
    throw new Error(`unexpected fetch ${url}`);
  }, () => computeSyncState(makeCtx(reg, OUT_COUNTS), card));
}

test('_362: a PORTLESS enabled output reads DRIFT — the push will DARKEN it', async () => {
  // Two mapped ports; the board's third output is enabled with no port row and
  // still carries the stale U23. Under force semantics that output goes dark.
  const reg = outputCard([
    { port: 1, output: 1, universe: 21, chain: ['sA'] },
    { port: 2, output: 2, universe: 22, chain: ['sB'] },
  ]);

  const drifted = await syncOf(reg, [true, true, true, false], [
    { index: 0, universe: 21, startAddress: 1, enabled: true },
    { index: 1, universe: 22, startAddress: 1, enabled: true },
    { index: 2, universe: 23, startAddress: 1, enabled: true },   // stale
  ]);
  assert.equal(drifted.state, 'drift');
  assert.deepEqual(drifted.changes, [{ path: 'output 2', from: 'enabled · U23', to: 'disabled' }]);

  // One push darkens it — and then the chip is quiet.
  const clean = await syncOf(reg, [true, true, false, false], [
    { index: 0, universe: 21, startAddress: 1, enabled: true },
    { index: 1, universe: 22, startAddress: 1, enabled: true },
  ]);
  assert.deepEqual(clean, { state: 'in-sync' });
});

test('_362: a board that is not DMX-driven reads DRIFT, whatever its mapping says', async () => {
  const reg = outputCard([
    { port: 1, output: 1, universe: 21, chain: ['sA'] },
    { port: 2, output: 2, universe: 22, chain: ['sB'] },
  ]);
  const sync = await syncOf(reg, [true, true, false, false], [
    { index: 0, universe: 21, startAddress: 1, enabled: true },
    { index: 1, universe: 22, startAddress: 1, enabled: true },
  ], { dmxEnabled: false });
  assert.equal(sync.state, 'drift');
  assert.match(sync.detail, /board is not DMX-driven — push will force DMX/);
});

test('_71 (22): a port pointed at a DISABLED output reads drift naming the pending ENABLE', async () => {
  const reg = outputCard([
    { port: 1, output: 1, universe: 21, chain: ['sA'] },
    { port: 2, output: 4, universe: 22, chain: ['sB'] },   // output 4 is OFF today
  ]);
  const sync = await syncOf(reg, [true, false, false, false], [
    { index: 0, universe: 21, startAddress: 1, enabled: true },
  ]);
  assert.equal(sync.state, 'drift');
  assert.deepEqual(sync.changes, [{ path: 'output 3', from: 'disabled', to: 'enabled · U22' }]);
  // The chip states what it now measures, so green never over-promises.
  assert.match(describeSyncChipTooltip(sync), /which would be DISABLED/);
});

test('_71 (23): the output selector offers the BOARD\'s outputs and disables the taken ones', () => {
  const reg = outputCard([
    { port: 1, output: 1, universe: 21, chain: ['sA'] },
    { port: 2, output: 3, universe: 22, chain: ['sB'] },
  ]);
  const card = reg.controllers[0];
  const devOutputs = [
    { enabled: true, count: 40, universe: 21 },
    { enabled: true, count: 40, universe: 24 },
    { enabled: true, count: 40, universe: 22 },
    { enabled: false, count: 40, universe: null },
  ];

  const model = outputSelectorOptions(card, card.ports[0], devOutputs);
  assert.equal(model.verified, true);
  assert.equal(model.max, 4, 'the device\'s reported output count bounds the range');
  assert.deepEqual(model.options.map((o) => o.value), [1, 2, 3, 4]);
  // Option 3 belongs to P2 — UNSELECTABLE, and it says whose it is. The UI
  // simply cannot express a duplicate association.
  const taken = model.options[2];
  assert.equal(taken.disabled, true);
  assert.equal(taken.takenBy, 2);
  assert.equal(taken.label, '3 — taken by P2');
  // Free options carry what the board is doing on them today.
  assert.equal(model.options[1].disabled, false);
  // FORCE labels: this row's own output reads plainly; every other one says what
  // the next push will DO to it.
  assert.equal(model.options[1].label, '2 — enabled, 40 px, U24 · push will DISABLE it');
  assert.equal(model.options[0].label, '1 — enabled, 40 px, U21');
  assert.equal(model.options[3].label, '4 — disabled');
  // This row's OWN output is selected and never reads as taken by itself.
  assert.equal(model.options[0].selected, true);
  assert.equal(model.options[0].disabled, false);

  // With no device snapshot the range is the 16-output ceiling, flagged unverified.
  const blind = outputSelectorOptions(card, card.ports[0], null);
  assert.equal(blind.verified, false);
  assert.equal(blind.max, 16);
  assert.equal(blind.options[1].label, '2');
  assert.equal(blind.options[2].disabled, true, 'uniqueness holds without a snapshot');
});

// ── _363 / S3: the operator-facing COPY of the push dialogs + the ⏻ control ───
// These render the REAL dialog / card DOM against a minimal fake document (the
// same technique touch_control_passcode.test.js uses), so the narrowed warning
// and the payload preview are asserted as the operator reads them — not as a
// paraphrase. No browser, no device: the dialogs are built and inspected, never
// confirmed.

function fakeElement(doc, tagName) {
  const node = {
    tagName,
    className: '',
    textContent: '',
    title: '',
    value: '',
    checked: false,
    innerHTML: '',
    disabled: false,
    children: [],
    style: {},
    dataset: {},
    attributes: {},
    ownerDocument: doc,
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren() { this.children = []; },
    remove() {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    focus() {},
  };
  // The gamma section's preset chips are the only user of classList.
  node.classList = {
    add: (name) => {
      if (!node.className.split(' ').includes(name)) {
        node.className = node.className ? `${node.className} ${name}` : name;
      }
    },
  };
  return node;
}

function fakeDocument() {
  const doc = { created: [] };
  doc.createElement = (tagName) => {
    const node = fakeElement(doc, tagName);
    doc.created.push(node);
    return node;
  };
  doc.body = fakeElement(doc, 'body');
  return doc;
}

/** Every node under `root`, depth-first (the dialog is a tree of divs). */
function descendants(root) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children) { out.push(child); walk(child); }
  };
  walk(root);
  return out;
}

async function withFakeDocument(fn) {
  const original = globalThis.document;
  const doc = fakeDocument();
  globalThis.document = doc;
  try { return await fn(doc); } finally { globalThis.document = original; }
}

/** The plan shape every push consumer requires (derivePerOutputPlan's result). */
function copyPlan() {
  return {
    controllerName: 'LeftLeftFront',
    universeByOutputIndex: { 0: 21 },
    assignments: [{ outputIndex: 0, portNum: 1, universe: 21, pixelCount: 40 }],
    disables: [],
    countChanges: [],
    warnings: [],
    collisions: [],
    sharedUniverses: [],
  };
}

/** A board that ALSO carries swarm + gamma — neither may appear in the preview. */
function copySnapshot() {
  return {
    ...deviceConfig(),
    deviceName: 'LeftLeftFront',
    swarm: { enabled: true, isLeader: false, groupId: 'ropes' },
    gamma: { r: 2.2, g: 2.2, b: 2.2, w: 2.2 },
  };
}

test('_363: the single-push dialog leads with the NARROWED force warning', async () => {
  const reg = createControllerRegistry({ controllers: [ledCard(60, '10.0.0.60', 21, 'sA', true)] });
  const card = reg.controllers[0];
  const plan = copyPlan();
  const body = buildForcedConfigBody({ snapshot: copySnapshot(), plan, ip: card.ip });

  await withFakeDocument(async (doc) => {
    showPerOutputPushConfirm(makeCtx(reg, new Map([['sA', 40]])), card, plan, body,
      deviceStatus('titanic_60'), null);
    const overlay = doc.body.children[0];
    const warn = descendants(overlay).find((n) => n.className === 'led-push-warn');

    assert.equal(warn.textContent, FORCE_PUSH_WARNING);
    // The narrowed truth, clause by clause (report `_363` §2.3-2, binding copy).
    assert.match(warn.textContent, /⚠ FORCE push — the sim panel is the source of truth for the mapping\./);
    assert.match(warn.textContent,
      /overwrites the board's strand counts, enables and per-output DMX universes/);
    assert.match(warn.textContent, /every other output is DISABLED/);
    assert.match(warn.textContent, /DMX input \(sACN\) is switched ON/);
    assert.match(warn.textContent,
      /Strand type, color order, swarm and gamma settings are NOT touched\./);
    assert.match(warn.textContent, /The device reboots \(~11 s\); the push waits up to 45 s/);
    // The `_362` swarm-switching promise is GONE — the push no longer does it.
    assert.equal(/leaves SWARM/.test(warn.textContent), false);
  });
});

test('_363: the dialog PAYLOAD preview is the posted body — strands + dmx, no swarm, no gamma',
  async () => {
    const reg = createControllerRegistry({ controllers: [ledCard(60, '10.0.0.60', 21, 'sA', true)] });
    const card = reg.controllers[0];
    const plan = copyPlan();
    const body = buildForcedConfigBody({ snapshot: copySnapshot(), plan, ip: card.ip });

    await withFakeDocument(async (doc) => {
      showPerOutputPushConfirm(makeCtx(reg, new Map([['sA', 40]])), card, plan, body,
        deviceStatus('titanic_60'), null);
      const overlay = doc.body.children[0];
      const pre = descendants(overlay).find((n) => n.tagName === 'pre');
      const previewed = JSON.parse(pre.textContent);

      // The preview IS the object that gets posted, not a rendering of it.
      assert.deepEqual(previewed, body);
      assert.deepEqual(Object.keys(previewed).sort(), ['dmx', 'strands']);
      assert.equal('swarm' in previewed, false, 'the board carries swarm — the push does not');
      assert.equal('gamma' in previewed, false, 'gamma is operator-manual, never pushed');
      assert.equal(previewed.dmx.enabled, true);
      assert.equal(previewed.dmx.protocol, 0);
      // Strand type / colour order ride through from the board, untouched.
      assert.equal(previewed.strands[0].type, 'WS281X_RGBW');
      assert.equal(previewed.strands[0].colorOrder, 'RGBW');
      // And the section header names the endpoint the operator can check by hand.
      assert.ok(descendants(overlay).some(
        (n) => n.textContent === 'Payload (POST /api/config)'));
    });
  });

test('_363: the push-all dialog carries the same narrowed warning, pluralized', async () => {
  const reg = createControllerRegistry({
    controllers: [ledCard(1, '10.0.0.1', 3, 'sA', true), ledCard(2, '10.0.0.2', 4, 'sB', true)],
  });
  await withFakeDocument(async (doc) => {
    startPushAll(makeCtx(reg, new Map([['sA', 40], ['sB', 40]])));
    const overlay = doc.body.children[0];
    const warn = descendants(overlay).find((n) => n.className === 'led-push-warn');

    assert.ok(warn.textContent.startsWith(FORCE_PUSH_ALL_WARNING));
    assert.match(warn.textContent, /overwrites each board's strand counts, enables and per-output DMX universes/);
    assert.match(warn.textContent,
      /Strand type, color order, swarm and gamma settings are NOT touched\./);
    assert.match(warn.textContent, /waits up to 45 s per board/);
    assert.equal(/leaves SWARM/.test(warn.textContent), false);
    // …and the sequencing sentence the fleet dialog appends stays put.
    assert.match(warn.textContent, /written SEQUENTIALLY/);
    assert.match(warn.textContent, /one failure never aborts the rest/);
  });
});

test('_363: every LED card renders the DMX ⏻ control next to ⬆ Push', async () => {
  const reg = createControllerRegistry({ controllers: [ledCard(60, '10.0.0.60', 21, 'sA', true)] });
  const card = reg.controllers[0];
  // Its OWN scene: the ⏻ label store is scene-scoped like the sync/MAC caches
  // (G7), and this case is about the COLD label — no read has happened here.
  const ctx = { ...makeCtx(reg, new Map([['sA', 40]])), activeScene: () => 'dmx_card_render' };
  await withFakeDocument(async () => {
    const section = renderDeviceBindingSection(ctx, card);
    const buttons = section.children.filter((n) => n.tagName === 'button');
    const labels = buttons.map((b) => b.textContent);
    assert.deepEqual(labels, ['⬆ Push to controller', '⏻ DMX: ?', 'Re-bind…'],
      'the toggle sits between Push and Re-bind, labelled from the last observation');

    const toggle = buttons[1];
    assert.equal(toggle.disabled, false);
    assert.match(toggle.className, /led-device-dmx-toggle/);
    assert.match(toggle.className, /led-dmx-unknown/);
    assert.match(toggle.title, /writes the board's DMX flag and reboots it \(~11 s\)/);
    assert.match(toggle.title, /strands, swarm and gamma are untouched/);
    assert.equal(typeof toggle.onclick, 'function', 'one click, no confirm dialog');
  });

  // No usable IP → the control is disabled with the same hint the Push button uses.
  const noIp = createControllerRegistry({ controllers: [ledCard(61, '', 21, 'sA', true)] });
  await withFakeDocument(async () => {
    const section = renderDeviceBindingSection(
      { ...makeCtx(noIp, new Map([['sA', 40]])), activeScene: () => 'dmx_card_render_no_ip' },
      noIp.controllers[0]);
    const toggle = section.children.filter((n) => n.tagName === 'button')[1];
    assert.equal(toggle.disabled, true);
    assert.equal(toggle.title, 'set the device IP first');
    assert.equal(toggle.onclick, undefined);
  });
});

// ── The gamma section, RENDERED (report `_363` §11 re-enable) ───────────────
//
// `_364` asserted this section was inert. The operator re-enabled the PUSH side
// after the config push was validated on real boards, so these assert the new
// truth on the REAL rendered DOM: the sliders and presets are live and are the
// curve source, ⬆ Push gamma is live, and no pull control exists anywhere.

test('_363 §11: the rendered gamma section is LIVE — sliders, presets and ⬆ Push gamma', async () => {
  const reg = createControllerRegistry({ controllers: [ledCard(60, '10.0.0.60', 21, 'sA', true)] });
  const card = reg.controllers[0];
  await withFakeDocument(async () => {
    const section = renderGammaSection(makeCtx(reg, new Map([['sA', 40]])), card);
    const nodes = [section, ...descendants(section)];

    const pushBtn = nodes.find((n) => n.className.includes('cm-led-gamma-push'));
    assert.equal(pushBtn.textContent, '⬆ Push gamma');
    assert.equal(pushBtn.disabled, false, 'the push button is LIVE again');
    assert.equal(typeof pushBtn.onclick, 'function');
    assert.match(pushBtn.title, /read it back to confirm/);
    assert.match(pushBtn.title, /applies LIVE — the board does not reboot/);
    assert.match(pushBtn.title, /universes, DMX input and swarm are all untouched/);

    const sliders = nodes.filter((n) => n.className === 'cm-led-gamma-slider');
    assert.equal(sliders.length, 4, 'R, G, B and W');
    for (const slider of sliders) {
      assert.equal(slider.disabled, false);
      assert.equal(typeof slider.onchange, 'function', 'the sliders are the curve SOURCE');
    }

    const chips = nodes.filter((n) => n.className.includes('cm-led-gamma-preset'));
    assert.deepEqual(chips.map((c) => c.textContent), ['Off', '2.2 sRGB', 'Punchy']);
    for (const chip of chips) {
      assert.equal(chip.disabled, false);
      assert.equal(typeof chip.onclick, 'function');
    }

    // NO pull control of any kind — this is the permanent half of the ruling.
    const labels = nodes.map((n) => n.textContent).join(' | ');
    assert.doesNotMatch(labels, /Refresh/i);
    assert.doesNotMatch(labels, /Read gamma/i);
    // The section says what it is: a push source, never a mirror of the device.
    const note = nodes.find((n) => n.className === 'cm-led-gamma-note');
    assert.match(note.textContent, /these sliders are the source of the curve/);
    assert.match(note.textContent, /never reads gamma back off a device/);
    // The section is no longer flagged disabled.
    assert.equal(section.attributes['aria-disabled'], undefined);
    assert.equal(section.className.includes('cm-led-gamma-off'), false);
  });
});

test('_363 §11: a card with no device IP renders the gamma push INERT, and says why', async () => {
  const reg = createControllerRegistry({ controllers: [ledCard(61, '', 22, 'sA', false)] });
  const card = reg.controllers[0];
  await withFakeDocument(async () => {
    const section = renderGammaSection(makeCtx(reg, new Map([['sA', 40]])), card);
    const nodes = [section, ...descendants(section)];
    const pushBtn = nodes.find((n) => n.className.includes('cm-led-gamma-push'));
    assert.equal(pushBtn.disabled, true);
    assert.equal(pushBtn.onclick, undefined, 'an unpushable card gets no handler at all');
    assert.equal(pushBtn.title, 'set the device IP first');
    // The sliders still work: the curve is a SCENE value, editable before a
    // board exists to receive it.
    const sliders = nodes.filter((n) => n.className === 'cm-led-gamma-slider');
    assert.equal(sliders.every((s) => typeof s.onchange === 'function'), true);
  });
});

test('_363 §11: renderGammaSection refuses to render without the panel ctx', async () => {
  const reg = createControllerRegistry({ controllers: [ledCard(60, '10.0.0.60', 21, 'sA', true)] });
  await withFakeDocument(async () => {
    assert.throws(() => renderGammaSection(null, reg.controllers[0]),
      /needs the LED panel ctx/);
    // A non-LED card gets nothing, ctx or no ctx.
    assert.equal(renderGammaSection(makeCtx(reg, new Map()), { id: 9, name: 'DMX', ports: [] }),
      null);
  });
});
