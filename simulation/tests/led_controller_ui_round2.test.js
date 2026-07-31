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
} from '../src/gui/led_discovery_panel.js';

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

/**
 * Mock per-output device I/O: getStatus / getConfig / pushPerOutputUniverses /
 * awaitReboot. The push takes the whole PLAN (report 20260725_70) — a bare
 * universe map cannot say which outputs the push must enable.
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
    pushPerOutputUniverses: async (ip, { plan }) => {
      calls.push(`push:${ip}`);
      const d = devices[ip];
      if (d.throwOnPush) throw new Error('device rejected: HTTP 400');
      const universeByOutputIndex = plan.universeByOutputIndex;
      d.pushed = universeByOutputIndex;
      d.pushedPlan = plan;
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

test('S1: the fleet completion saves once, THEN notifies, and reads as one sentence', async () => {
  const calls = [];
  const steps = await persistAndNotifyAfterPush({
    persistScene: async () => { calls.push('persistScene'); return { ok: true }; },
    notifyBridge: async () => { calls.push('notifyBridge'); return { ok: true }; },
  });
  assert.deepEqual(calls, ['persistScene', 'notifyBridge']);

  const outcome = describePushCompletion(steps, {
    lead: 'done — 2 pushed · 0 skipped · 0 failed',
    deviceNote: 'the device(s) WERE written (cannot be rolled back)',
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.text,
    'done — 2 pushed · 0 skipped · 0 failed · ✓ scene saved (patches projected) · ' +
    '✓ bridge notified — routes follow');
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

// ── _71: the chip measures the FULL output map, and the output selector ──────
// Report 20260725_70 §5: the sync chip compares device ≡ plan across the WHOLE
// post-push map — assigned, PARKED and pending-enable — using the same claims
// and the same derive as the push, so the chip and the push can never disagree.
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
    dmx: { enabled: true, protocol: 0, universe: 1, startAddress: 1, timeoutMs: 3000 },
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

function outputCard(ports, parkedOutputs) {
  const card = {
    id: 60, name: 'LeftLeftFront', ip: '10.0.0.60', type: CONTROLLER_TYPE_LED,
    led: { order: 'RGBW', startAddr: 1 },
    device: { vendor: 'marsinled', controllerId: 'titanic_60', deviceName: 'LeftLeftFront' },
    ports,
  };
  if (parkedOutputs) card.parkedOutputs = parkedOutputs;
  return createControllerRegistry({ controllers: [card] });
}

const OUT_COUNTS = new Map([['sA', 40], ['sB', 40]]);

async function syncOf(reg, enabledFlags, perOutput) {
  const card = reg.controllers[0];
  return withFetch(async (url) => {
    if (url === 'http://10.0.0.60/api/config') return jsonResponse(board(enabledFlags));
    if (url === 'http://10.0.0.60/api/status') return jsonResponse(boardStatus(enabledFlags, perOutput));
    throw new Error(`unexpected fetch ${url}`);
  }, () => computeSyncState(makeCtx(reg, OUT_COUNTS), card));
}

test('_71 (21): a PORTLESS enabled output on the wrong universe reads DRIFT (the .60 landmine)', async () => {
  // Two mapped ports; the board's third output is enabled with no port row and
  // still carries the stale U23. The card's stored park says U27.
  const reg = outputCard([
    { port: 1, output: 1, universe: 21, chain: ['sA'] },
    { port: 2, output: 2, universe: 22, chain: ['sB'] },
  ], [{ output: 3, universe: 27 }]);

  const drifted = await syncOf(reg, [true, true, true, false], [
    { index: 0, universe: 21, startAddress: 1, enabled: true },
    { index: 1, universe: 22, startAddress: 1, enabled: true },
    { index: 2, universe: 23, startAddress: 1, enabled: true },   // stale
  ]);
  assert.equal(drifted.state, 'drift');
  assert.deepEqual(drifted.changes, [{ path: 'output 2', from: 'U23', to: 'U27' }]);

  // One push re-parks it — and then the chip is quiet, because the park is
  // STICKY (a re-derived park would move and re-drift a card nobody touched).
  const clean = await syncOf(reg, [true, true, true, false], [
    { index: 0, universe: 21, startAddress: 1, enabled: true },
    { index: 1, universe: 22, startAddress: 1, enabled: true },
    { index: 2, universe: 27, startAddress: 1, enabled: true },
  ]);
  assert.deepEqual(clean, { state: 'in-sync' });
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
  assert.match(describeSyncChipTooltip(sync), /including the PARKED outputs no port drives/);
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
  assert.equal(model.options[1].label, '2 — enabled, 40 px, U24');
  assert.equal(model.options[3].label, '4 — disabled (push will enable it)');
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
