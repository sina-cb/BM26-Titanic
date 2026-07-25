/**
 * led_discovery_scene_liveness.test.js — the two async-correctness fixes in the
 * LED discovery/push panel (glitch sweep slice 5):
 *
 *  G7 — the sync-chip / live-MAC caches are SCENE-SCOPED. nextControllerId
 *       restarts at 1 per scene, so a bare controller.id key could serve one
 *       scene's chip for another's same-id controller. The scene namespace makes
 *       a cross-scene read a miss.
 *  G8 — the up-to-30 s reboot wait is guarded: if the controller is deleted (or
 *       the scene changes) during the wait, the push result is DISCARDED loudly
 *       instead of mutating a detached / wrong-scene registry object.
 *
 * No DOM, no live device — the push orchestration runs against a MOCK device I/O
 * (the same seam pushAllLedControllers takes for the real client).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createControllerRegistry,
  CONTROLLER_TYPE_LED,
} from '../src/dmx/controller_registry.js';
import {
  pushAllLedControllers,
  getSyncState,
} from '../src/gui/led_discovery_panel.js';

// ── Mock device (per-output MarsinLED) ───────────────────────────────────────

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function strandDev(enabled, count, pinData) {
  return {
    type: 'WS281X_RGBW', count, pinData, pinClock: 0, colorOrder: 'RGBW',
    rgbwMode: 'exact', enabled, deadPixels: 0, deadPixelIndices: [],
  };
}

function deviceConfig() {
  return {
    strands: [strandDev(true, 40, 35), strandDev(false, 40, 36)],
    dmx: { enabled: true, protocol: 0, universe: 1, startAddress: 1, timeoutMs: 3000 },
    deviceName: 'Titanic-XXX', firmwareSHA: 'be2fcc1b5f6f',
  };
}

function deviceStatus(controllerId, perOutput = []) {
  return {
    controllerId, boardId: 'angio4-old', mac: 'AA:BB:CC:DD:02:01',
    firmwareSHA: 'be2fcc1b5f6f', strands: deviceConfig().strands,
    capabilitiesExt: { perOutputDmx: true },
    sacn: { enabled: true, perOutput },
  };
}

/** A per-output mock I/O; `onAwaitReboot(ip)` lets a test mutate the world mid-wait. */
function makeMockIo(devices, { onAwaitReboot } = {}) {
  return {
    getStatus: async (ip) => clone(devices[ip].status),
    getConfig: async (ip) => clone(devices[ip].config),
    pushPerOutputUniverses: async (ip, { universeByOutputIndex }) => {
      // Device confirms the plan back on verify (start=1, enabled).
      devices[ip].status.sacn.perOutput = Object.entries(universeByOutputIndex)
        .map(([index, universe]) => ({ index: Number(index), universe, startAddress: 1, enabled: true }));
      return { outcome: 'needs-reboot', reboot: true };
    },
    awaitReboot: async (ip) => { if (onAwaitReboot) onAwaitReboot(ip); },
  };
}

function ledCard(id, ip, universe, strandName, bound = true) {
  const card = {
    id, name: `T-${id}`, ip, type: CONTROLLER_TYPE_LED,
    led: { order: 'RGBW', startAddr: 1 },
    ports: [{ port: 1, universe, chain: [strandName] }],
  };
  if (bound) card.device = { vendor: 'marsinled', controllerId: `titanic_${id}`, deviceName: `Titanic-${id}` };
  return card;
}

/** ctx whose active scene is a mutable closure var (models a scene switch). */
function makeCtx(reg, counts, sceneRef) {
  return {
    registry: () => reg,
    strandLedCounts: () => counts,
    mutate: (_msg, fn) => fn(),
    refresh: () => {},
    showToast: () => {},
    activeScene: () => sceneRef.name,
  };
}

// ── G7 — the sync cache is scene-scoped ──────────────────────────────────────

test('G7: a sync-chip entry set in one scene is NOT served in another scene', async () => {
  const reg = createControllerRegistry({ controllers: [ledCard(1, '10.0.0.1', 3, 'sA', true)] });
  const counts = new Map([['sA', 40]]);
  const sceneRef = { name: 'sweep_scene_alpha' };
  const ctx = makeCtx(reg, counts, sceneRef);
  const io = makeMockIo({
    '10.0.0.1': { config: deviceConfig(), status: deviceStatus('titanic_1') },
  });

  const results = await pushAllLedControllers(ctx, io);
  assert.equal(results[0].state, 'pushed');

  // Under the scene it was pushed in, the chip is in-sync.
  assert.deepEqual(getSyncState(ctx, 1), { state: 'in-sync' });

  // Switch scenes (same controller id 1) — the previous scene's chip must NOT leak.
  sceneRef.name = 'sweep_scene_beta';
  assert.equal(getSyncState(ctx, 1), null);

  // Back to the original scene — the entry is still there under its own key.
  sceneRef.name = 'sweep_scene_alpha';
  assert.deepEqual(getSyncState(ctx, 1), { state: 'in-sync' });
});

// ── G8 — the reboot wait is guarded against a mid-flight delete ───────────────

test('G8: deleting the controller during the reboot wait discards the push (no blind mutate)', async () => {
  const reg = createControllerRegistry({ controllers: [ledCard(1, '10.0.0.1', 3, 'sA', true)] });
  const counts = new Map([['sA', 40]]);
  const sceneRef = { name: 'sweep_scene_g8' };
  const ctx = makeCtx(reg, counts, sceneRef);
  const controller = reg.controllers[0];

  // The device reboots; WHILE we await it, the operator deletes the controller.
  const io = makeMockIo(
    { '10.0.0.1': { config: deviceConfig(), status: deviceStatus('titanic_1') } },
    { onAwaitReboot: () => { reg.controllers.length = 0; } },
  );

  const results = await pushAllLedControllers(ctx, io);

  // Loud, per-controller failure — NOT a thrown-through crash, NOT a silent success.
  assert.equal(results[0].state, 'failed');
  assert.match(results[0].detail, /removed .* during the reboot/i);

  // The stale continuation did NOT record provenance onto the (now-detached) object.
  assert.equal(controller.device.lastPush, undefined);
});

// ── G8 — the happy path still records when the controller stays live ─────────

test('G8: an untouched controller still records the push (guard is a no-op when live)', async () => {
  const reg = createControllerRegistry({ controllers: [ledCard(1, '10.0.0.1', 3, 'sA', true)] });
  const counts = new Map([['sA', 40]]);
  const sceneRef = { name: 'sweep_scene_g8_ok' };
  const ctx = makeCtx(reg, counts, sceneRef);
  const controller = reg.controllers[0];

  const io = makeMockIo({ '10.0.0.1': { config: deviceConfig(), status: deviceStatus('titanic_1') } });
  const results = await pushAllLedControllers(ctx, io);

  assert.equal(results[0].state, 'pushed');
  assert.ok(controller.device.lastPush, 'a live controller records push provenance');
  assert.equal(controller.device.lastPush.outcome, 'needs-reboot');
});
