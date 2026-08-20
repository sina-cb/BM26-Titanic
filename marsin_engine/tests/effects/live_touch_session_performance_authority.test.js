// Live Touch owner-scoped effects must obey the same Performance authority as
// the shared effect grid. This runs a real isolated engine: every mutable
// directory is temporary and sACN is black-holed to TEST-NET-1.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';

import '../helpers/setup_config_guard.mjs';
import { GLOBAL_EFFECT_LIBRARY } from '../../lib/global_effect_library.js';
import { LIVE_TOUCH_PERFORMANCE_SLOT_CONFIG } from '../../lib/live_touch_session_context.js';
import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const OWNER_ID = 'live_touch_performance_owner';
const PERFORMANCE_BINDINGS = [
  ['movementTrace', 'pulse_slow_fade'],
  ['movementTrace', 'every_other_repeat'],
  ['movementTrace', 'every_other_reverse'],
  ['movementTrace', 'every_other_two_tone'],
  ['movementTrace', 'one_per_color_repeat'],
  ['movementTrace', 'one_per_color_reverse'],
  ['movementTrace', 'one_per_color_double'],
  ['movementTrace', 'whole_group_repeat'],
  ['movementTrace', 'whole_group_reverse'],
  ['strobe', 'sync_4hz'],
  ['beatPump', 'soft'],
  ['breath', 'calm'],
  ['feedbackTrails', 'soft_afterimage'],
  ['feedbackTrails', 'ghost_ship'],
  ['waterlineSweep', 'shadow_pass'],
  ['freeze', 'hold'],
];
const OVERLAY_PALETTE = [
  { h: 0.00, s: 1, v: 1 },
  { h: 0.16, s: 1, v: 1 },
  { h: 0.33, s: 1, v: 1 },
  { h: 0.55, s: 1, v: 1 },
  { h: 0.78, s: 1, v: 1 },
];
const h = createEngineHarness({
  scene: 'test_bench',
  pattern: '13_sparkle',
  prefix: 'live-touch-session-performance-authority',
  portBase: 17720,
  portSpan: 50,
  extraArgs: ['--dest', '192.0.2.9'],
});

function openWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws/control`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitFor(ws, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', onMessage);
      reject(new Error('timed out waiting for Live Touch control acknowledgement'));
    }, timeoutMs);
    function onMessage(buf) {
      let message;
      try {
        message = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (!predicate(message)) return;
      clearTimeout(timer);
      ws.removeListener('message', onMessage);
      resolve(message);
    }
    ws.on('message', onMessage);
  });
}

async function armOwner(ws) {
  const hello = waitFor(ws, message => message.type === 'touchControlHelloAck'
    && message.ownerId === OWNER_ID);
  ws.send(JSON.stringify({ type: 'touchControlHello', ownerId: OWNER_ID }));
  await hello;

  const armed = waitFor(ws, message => message.type === 'touchControlArmedAck'
    && message.ownerId === OWNER_ID && message.armed === true);
  ws.send(JSON.stringify({ type: 'touchControlArmed', ownerId: OWNER_ID, armed: true }));
  await armed;
}

async function disarmOwner(ws) {
  const disarmed = waitFor(ws, message => message.type === 'touchControlArmedAck'
    && message.ownerId === OWNER_ID && message.armed === false);
  ws.send(JSON.stringify({ type: 'touchControlArmed', ownerId: OWNER_ID, armed: false }));
  await disarmed;
}

async function renewOwner(ws) {
  const renewed = waitFor(ws, message => message.type === 'touchControlArmedAck'
    && message.ownerId === OWNER_ID && message.armed === true);
  ws.send(JSON.stringify({ type: 'touchControlArmed', ownerId: OWNER_ID, armed: true }));
  return renewed;
}

before(async () => {
  h.spawnEngine();
  await h.waitForReady();
});

after(async () => {
  await h.teardown();
});

test('Performance blocks owner-scoped effect configuration but permits runtime actions', async () => {
  const ws = await openWs();
  const ownerHeaders = { 'X-Touch-Control-Owner': OWNER_ID };
  try {
    await armOwner(ws);

    const staged = await h.api('PUT', '/layers/live_touch/pattern', {
      pattern: '13_sparkle',
    }, ownerHeaders);
    assert.equal(staged.status, 200, JSON.stringify(staged.data));
    assert.ok(Number.isInteger(staged.data.sessionRevision));
    const editPreparedRevision = staged.data.sessionRevision;

    const ownerSlots = await h.api('GET', '/global-effect-slots', undefined, ownerHeaders);
    assert.equal(ownerSlots.status, 200, JSON.stringify(ownerSlots.data));
    const ownerSlot = ownerSlots.data.slots.find(slot => slot.slotId === 1);
    for (const key of ['slotId', 'enabled', 'label', 'effectId', 'presetId', 'behavior']) {
      assert.ok(Object.hasOwn(ownerSlot, key),
        `owner-scoped slot GET must expose '${key}' for the Performance action surface`);
    }

    const editConfig = await h.api('PATCH', '/global-effect-slots/1', {
      label: 'Live private edit label',
    }, ownerHeaders);
    assert.equal(editConfig.status, 200, JSON.stringify(editConfig.data));
    assert.equal(editConfig.data.slot.label, 'Live private edit label');

    const sharedBefore = await h.api('GET', '/global-effect-slots');
    assert.equal(sharedBefore.status, 200, JSON.stringify(sharedBefore.data));
    assert.equal(sharedBefore.data.slots.find(slot => slot.slotId === 1).label, '4 Hz Sync',
      'owner-scoped configuration must not mutate the durable shared grid');

    const retiredMovementRate = await h.api('POST', '/movement-rate', {
      active: true, mode: 'one_per_color', pixelsPerSecond: 6,
    }, ownerHeaders);
    assert.equal(retiredMovementRate.status, 409, JSON.stringify(retiredMovementRate.data));
    assert.equal(retiredMovementRate.data.code, 'LIVE_TOUCH_OVERLAY_ACTION_REQUIRED',
      'the legacy rate endpoint must not re-enter destructive movement rendering in Edit');

    const entered = await h.api('POST', '/performance-mode', { active: true }, ownerHeaders);
    assert.equal(entered.status, 200, JSON.stringify(entered.data));
    const performanceLayerState = await h.api('GET', '/layers/state');
    const performanceRevision = performanceLayerState.data.liveTouch.sessionRevision;
    assert.ok(performanceRevision > editPreparedRevision,
      'the mode transition must invalidate the prior private slot revision');

    const audioBefore = await h.api('GET', '/audio-bindings', undefined, ownerHeaders);
    assert.equal(audioBefore.status, 200, JSON.stringify(audioBefore.data));

    const blockedPatch = await h.api('PATCH', '/global-effect-slots/1', {
      label: 'must not land',
    }, ownerHeaders);
    assert.equal(blockedPatch.status, 409, JSON.stringify(blockedPatch.data));
    assert.equal(blockedPatch.data.code, 'PERFORMANCE_MODE');

    const blockedIntensity = await h.api('POST', '/global-effect-slots/1/intensity', {
      value: 0.25,
    }, ownerHeaders);
    assert.equal(blockedIntensity.status, 409, JSON.stringify(blockedIntensity.data));
    assert.equal(blockedIntensity.data.code, 'PERFORMANCE_MODE');

    const blockedMovementRate = await h.api('POST', '/movement-rate', {
      active: true, mode: 'one_per_color', pixelsPerSecond: 6,
    }, ownerHeaders);
    assert.equal(blockedMovementRate.status, 409, JSON.stringify(blockedMovementRate.data));
    assert.equal(blockedMovementRate.data.code, 'PERFORMANCE_MODE');

    const blockedAudioBinding = await h.api('PUT', '/audio-bindings/groups/ParLights', {
      source: 'bpmPulse', mode: 'level', depth: 0.4,
    }, ownerHeaders);
    assert.equal(blockedAudioBinding.status, 409, JSON.stringify(blockedAudioBinding.data));
    assert.equal(blockedAudioBinding.data.code, 'PERFORMANCE_MODE');

    const blockedAudioClear = await h.api('POST', '/audio-bindings/clear', {}, ownerHeaders);
    assert.equal(blockedAudioClear.status, 409, JSON.stringify(blockedAudioClear.data));
    assert.equal(blockedAudioClear.data.code, 'PERFORMANCE_MODE');

    const audioAfterDirectRefusals = await h.api('GET', '/audio-bindings', undefined, ownerHeaders);
    assert.deepEqual(audioAfterDirectRefusals.data, audioBefore.data,
      'direct Performance audio-binding refusals must leave the private session unchanged');

    const blockedSlotPrepare = await h.api('POST', '/layers/live_touch/prepare', {
      expectedSessionRevision: performanceRevision,
      operations: [{
        method: 'PATCH',
        path: '/global-effect-slots/1',
        body: { label: 'must not land through prepare' },
      }],
    }, ownerHeaders);
    assert.equal(blockedSlotPrepare.status, 409, JSON.stringify(blockedSlotPrepare.data));
    assert.equal(blockedSlotPrepare.data.code, 'PERFORMANCE_MODE');
    assert.equal(blockedSlotPrepare.data.operationIndex, 0);

    const blockedIntensityPrepare = await h.api('POST', '/layers/live_touch/prepare', {
      expectedSessionRevision: performanceRevision,
      operations: [{
        method: 'POST',
        path: '/global-effect-slots/1/intensity',
        body: { value: 0.25 },
      }],
    }, ownerHeaders);
    assert.equal(blockedIntensityPrepare.status, 409, JSON.stringify(blockedIntensityPrepare.data));
    assert.equal(blockedIntensityPrepare.data.code, 'PERFORMANCE_MODE');

    const blockedModePrepare = await h.api('POST', '/layers/live_touch/prepare', {
      expectedSessionRevision: performanceRevision,
      operations: [{
        method: 'POST',
        path: '/global-effect-slots/1/mode',
        body: { value: 'must_not_land' },
      }],
    }, ownerHeaders);
    assert.equal(blockedModePrepare.status, 409, JSON.stringify(blockedModePrepare.data));
    assert.equal(blockedModePrepare.data.code, 'PERFORMANCE_MODE');

    const blockedPrepare = await h.api('POST', '/layers/live_touch/prepare', {
      expectedSessionRevision: performanceRevision,
      operations: [{
        method: 'PUT',
        path: '/audio-bindings/groups/ParLights',
        body: { source: 'bpmPulse', mode: 'level', depth: 0.4 },
      }],
    }, ownerHeaders);
    assert.equal(blockedPrepare.status, 409, JSON.stringify(blockedPrepare.data));
    assert.equal(blockedPrepare.data.code, 'PERFORMANCE_MODE');
    assert.equal(blockedPrepare.data.operationIndex, 0);

    const blockedAudioClearPrepare = await h.api('POST', '/layers/live_touch/prepare', {
      expectedSessionRevision: performanceRevision,
      operations: [{ method: 'POST', path: '/audio-bindings/clear', body: {} }],
    }, ownerHeaders);
    assert.equal(blockedAudioClearPrepare.status, 409, JSON.stringify(blockedAudioClearPrepare.data));
    assert.equal(blockedAudioClearPrepare.data.code, 'PERFORMANCE_MODE');

    const audioAfterPrepareRefusal = await h.api('GET', '/audio-bindings', undefined, ownerHeaders);
    assert.deepEqual(audioAfterPrepareRefusal.data, audioBefore.data,
      'a refused atomic prepare must not commit a partial private audio binding');

    const slotsAfterPrepareRefusal = await h.api(
      'GET', '/global-effect-slots', undefined, ownerHeaders,
    );
    assert.equal(slotsAfterPrepareRefusal.data.slots.find(slot => slot.slotId === 1).label,
      '4 Hz Sync', 'a refused prepare must not mutate the canonical Performance seed');

    const runtimeAction = await h.api('POST', '/global-effect-slots/1/press', undefined,
      ownerHeaders);
    assert.equal(runtimeAction.status, 200, JSON.stringify(runtimeAction.data));
    assert.equal(runtimeAction.data.action, 'press');

    const ownerState = await h.api('GET', '/global-effect-slots', undefined, ownerHeaders);
    assert.equal(ownerState.status, 200, JSON.stringify(ownerState.data));
    assert.equal(ownerState.data.slots.find(slot => slot.slotId === 1).label,
      '4 Hz Sync', 'entering Performance must replace the prior Edit-only private slot config');

    const exited = await h.api('POST', '/performance-mode', {
      active: false,
      exitAction: 'keep',
    }, ownerHeaders);
    assert.equal(exited.status, 200, JSON.stringify(exited.data));

    const editAgain = await h.api('PATCH', '/global-effect-slots/1', {
      label: 'Live private edit restored',
    }, ownerHeaders);
    assert.equal(editAgain.status, 200, JSON.stringify(editAgain.data));
    assert.equal(editAgain.data.slot.label, 'Live private edit restored');
  } finally {
    const mode = await h.api('GET', '/performance-mode');
    if (mode.data.active) {
      await h.api('POST', '/performance-mode', { active: false, exitAction: 'restore' }, ownerHeaders);
    }
    await disarmOwner(ws);
    ws.close();
  }
});

test('same-owner Edit to Performance to Edit transition reseeds only on mode changes', async () => {
  const ws = await openWs();
  const ownerHeaders = { 'X-Touch-Control-Owner': OWNER_ID };
  const globalSlotFile = path.join(h.stateDir, 'global_effect_slots.yaml');
  const diskBefore = fs.existsSync(globalSlotFile) ? fs.readFileSync(globalSlotFile) : null;
  const sharedBefore = await h.api('GET', '/global-effect-slots');
  try {
    await armOwner(ws);
    const privateEdit = await h.api('PATCH', '/global-effect-slots/1', {
      label: 'Edit session marker',
    }, ownerHeaders);
    assert.equal(privateEdit.status, 200, JSON.stringify(privateEdit.data));
    const runningEdit = await h.api(
      'POST', '/global-effect-slots/1/activate', undefined, ownerHeaders,
    );
    assert.equal(runningEdit.status, 200, JSON.stringify(runningEdit.data));

    const beforeModeState = await h.api('GET', '/layers/state');
    const entered = await h.api(
      'POST', '/performance-mode', { active: true }, ownerHeaders,
    );
    assert.equal(entered.status, 200, JSON.stringify(entered.data));
    const performanceSlots = await h.api(
      'GET', '/global-effect-slots', undefined, ownerHeaders,
    );
    const projected = performanceSlots.data.slots
      .filter(slot => slot.slotId >= 9 && slot.slotId <= 24)
      .map(slot => [slot.slotId, slot.effectId, slot.presetId]);
    assert.deepEqual(projected, PERFORMANCE_BINDINGS.map(([effectId, presetId], index) => [
      index + 9, effectId, presetId,
    ]), 'the already-owned Edit session must immediately expose the canonical Performance bank');
    const afterEnterState = await h.api('GET', '/layers/state');
    assert.ok(afterEnterState.data.liveTouch.sessionRevision
      > beforeModeState.data.liveTouch.sessionRevision,
    'a real mode change must advance the private session revision');
    const editEffectStopped = await h.api(
      'GET', '/global-effect-slots/status', undefined, ownerHeaders,
    );
    assert.equal(editEffectStopped.data.controller.strobe.active, false,
      'entering Performance must stop an Edit effect before replacing its slot manager');

    const palette = await h.api('POST', '/layers/live_touch/palette', {
      colorPalette: OVERLAY_PALETTE,
    }, ownerHeaders);
    assert.equal(palette.status, 200, JSON.stringify(palette.data));
    const overlayOn = await h.api(
      'POST', '/global-effect-slots/9/activate', undefined, ownerHeaders,
    );
    assert.equal(overlayOn.status, 200, JSON.stringify(overlayOn.data));
    const tunedOverlay = await h.api(
      'POST',
      '/global-effect-slots/9/movement-rate',
      { active: true, pixelsPerSecond: 17.5 },
      ownerHeaders,
    );
    assert.equal(tunedOverlay.status, 200, JSON.stringify(tunedOverlay.data));
    assert.equal(tunedOverlay.data.active, true);
    assert.equal(tunedOverlay.data.pixelsPerSecond, 17.5,
      'the Effect Control WALK axis must tune the running private overlay in Performance');
    assert.equal(tunedOverlay.data.liveTouchOverlayPattern.slotId, 9);
    assert.equal(tunedOverlay.data.liveTouchOverlayPattern.requestedActive, true);
    const slotsAfterTune = await h.api(
      'GET', '/global-effect-slots', undefined, ownerHeaders,
    );
    assert.equal(slotsAfterTune.data.slots.find(slot => slot.slotId === 9)
      .paramsOverride?.pixelsPerSecond, undefined,
    'runtime WALK tuning must not reconfigure the private Performance slot');
    const revisionBeforeRenewal = afterEnterState.data.liveTouch.sessionRevision;
    const renewed = await renewOwner(ws);
    assert.equal(renewed.sessionRevision, revisionBeforeRenewal,
      'a same-mode lease renewal must not reseed or advance the session');
    const afterRenewal = await h.api(
      'GET', '/global-effect-slots/status', undefined, ownerHeaders,
    );
    assert.equal(afterRenewal.data.slots.find(slot => slot.slotId === 9).active, true,
      'a same-mode lease renewal must preserve the running Performance action');

    const exited = await h.api('POST', '/performance-mode', {
      active: false,
      exitAction: 'keep',
    }, ownerHeaders);
    assert.equal(exited.status, 200, JSON.stringify(exited.data));
    const editSlots = await h.api('GET', '/global-effect-slots', undefined, ownerHeaders);
    assert.equal(editSlots.data.slots.find(slot => slot.slotId === 1).label, '4 Hz Sync');
    assert.equal(editSlots.data.slots.find(slot => slot.slotId === 9).effectId, 'invert',
      'leaving Performance must restore the default private Edit bank');
    const overlayStopped = await h.api(
      'GET', '/global-effect-slots/status', undefined, ownerHeaders,
    );
    assert.equal(overlayStopped.data.liveTouchOverlayPattern.requestedActive, false,
      'leaving Performance must stop a running session overlay');
    const sharedAfter = await h.api('GET', '/global-effect-slots');
    assert.deepEqual(sharedAfter.data, sharedBefore.data,
      'mode transitions must never touch the shared slot manager');
    const diskAfter = fs.existsSync(globalSlotFile) ? fs.readFileSync(globalSlotFile) : null;
    assert.deepEqual(diskAfter, diskBefore,
      'mode transitions must never persist the transient Live Touch slot bank');
  } finally {
    const mode = await h.api('GET', '/performance-mode');
    if (mode.data.active) {
      await h.api('POST', '/performance-mode', {
        active: false,
        exitAction: 'restore',
      }, ownerHeaders);
    }
    await disarmOwner(ws);
    ws.close();
  }
});

test('a new Performance Live session exposes the canonical sixteen catalog-backed action slots', async () => {
  const globalSlotFile = path.join(h.stateDir, 'global_effect_slots.yaml');
  const diskBefore = fs.existsSync(globalSlotFile) ? fs.readFileSync(globalSlotFile, 'utf8') : null;
  const globalBefore = await h.api('GET', '/global-effect-slots');
  assert.equal(globalBefore.status, 200, JSON.stringify(globalBefore.data));

  const entered = await h.api('POST', '/performance-mode', { active: true });
  assert.equal(entered.status, 200, JSON.stringify(entered.data));

  const ws = await openWs();
  const ownerHeaders = { 'X-Touch-Control-Owner': OWNER_ID };
  try {
    await armOwner(ws);

    const expected = PERFORMANCE_BINDINGS.map(([effectId, presetId], index) => {
      const preset = GLOBAL_EFFECT_LIBRARY[effectId].presets[presetId];
      return {
        slotId: index + 9,
        enabled: true,
        effectId,
        presetId,
        label: preset.label,
        behavior: preset.defaultBehavior,
      };
    });
    const seedProjection = LIVE_TOUCH_PERFORMANCE_SLOT_CONFIG
      .filter(slot => slot.slotId >= 9 && slot.slotId <= 24)
      .map(slot => ({
        slotId: slot.slotId,
        enabled: slot.enabled,
        effectId: slot.effectId,
        presetId: slot.presetId,
        label: slot.label,
        behavior: slot.behavior,
      }));
    assert.deepEqual(seedProjection, expected,
      'the Performance session seed must mirror the executable catalog in exact Live Touch order');
    assert.equal(expected.at(-1).behavior, 'hold',
      'freeze|hold must retain its catalog-backed hold gesture');

    const projected = await h.api('GET', '/global-effect-slots', undefined, ownerHeaders);
    assert.equal(projected.status, 200, JSON.stringify(projected.data));
    const projectedLiveSlots = projected.data.slots
      .filter(slot => slot.slotId >= 9 && slot.slotId <= 24)
      .map(slot => ({
        slotId: slot.slotId,
        enabled: slot.enabled,
        effectId: slot.effectId,
        presetId: slot.presetId,
        label: slot.label,
        behavior: slot.behavior,
      }));
    assert.deepEqual(projectedLiveSlots, expected,
      'a cold Performance arm must expose all sixteen actual action slots, never a sparse projection');
    const configBeforeAction = JSON.parse(JSON.stringify(projectedLiveSlots));

    const missingPalette = await h.api('POST', '/global-effect-slots/13/press', undefined,
      ownerHeaders);
    assert.equal(missingPalette.status, 409, JSON.stringify(missingPalette.data));
    assert.equal(missingPalette.data.code, 'LIVE_TOUCH_OVERLAY_PALETTE_REQUIRED',
      'five-colour overlays must refuse loudly until exact session palette is staged');

    const directPalette = await h.api('POST', '/layers/live_touch/palette', {
      colorPalette: OVERLAY_PALETTE,
    }, ownerHeaders);
    assert.equal(directPalette.status, 200, JSON.stringify(directPalette.data));
    assert.deepEqual(directPalette.data.colorPalette, OVERLAY_PALETTE,
      'Performance Color-panel palette input remains owner-writable');

    const livePattern = await h.api('PUT', '/layers/live_touch/pattern', {
      pattern: '13_sparkle',
    }, ownerHeaders);
    assert.equal(livePattern.status, 200, JSON.stringify(livePattern.data));
    const stagedPalette = await h.api('POST', '/layers/live_touch/prepare', {
      expectedSessionRevision: livePattern.data.sessionRevision,
      operations: [{
        method: 'POST',
        path: '/layers/live_touch/palette',
        body: { colorPalette: OVERLAY_PALETTE },
      }],
    }, ownerHeaders);
    assert.equal(stagedPalette.status, 200, JSON.stringify(stagedPalette.data));
    const paletteReadback = await h.api('GET', '/layers/live_touch/palette', undefined, ownerHeaders);
    assert.deepEqual(paletteReadback.data.colorPalette, OVERLAY_PALETTE,
      'the overlay palette is a deep-copied owner-session input');

    const logicalOn = await h.api('POST', '/global-effect-slots/9/activate', undefined,
      ownerHeaders);
    assert.equal(logicalOn.status, 200, JSON.stringify(logicalOn.data));
    const onStatus = await h.api('GET', '/global-effect-slots/status', undefined, ownerHeaders);
    const pulseOn = onStatus.data.slots.find(slot => slot.slotId === 9);
    assert.equal(pulseOn.active, true,
      'slot readback is ON immediately at activation even while alpha begins at zero');
    assert.equal(onStatus.data.liveTouchOverlayPattern.requestedActive, true);

    const logicalOff = await h.api('POST', '/global-effect-slots/9/deactivate', undefined,
      ownerHeaders);
    assert.equal(logicalOff.status, 200, JSON.stringify(logicalOff.data));
    const offStatus = await h.api('GET', '/global-effect-slots/status', undefined, ownerHeaders);
    const pulseOff = offStatus.data.slots.find(slot => slot.slotId === 9);
    assert.equal(pulseOff.active, false,
      'slot readback is OFF immediately when fade-out starts, never after alpha reaches zero');
    assert.equal(offStatus.data.liveTouchOverlayPattern.requestedActive, false);
    assert.ok(offStatus.data.liveTouchOverlayPattern.alpha >= 0,
      'physical envelope telemetry remains available independently of logical slot truth');
    const repeatedOffStatus = await h.api('GET', '/global-effect-slots/status', undefined, ownerHeaders);
    assert.equal(repeatedOffStatus.data.slots.find(slot => slot.slotId === 9).active, false,
      'status reconciliation alone must not issue or imply a repeated toggle');

    let priorOverlaySlotId = null;
    for (const slot of expected) {
      const action = slot.behavior === 'hold' ? 'down' : 'press';
      const fired = await h.api('POST', `/global-effect-slots/${slot.slotId}/${action}`,
        undefined, ownerHeaders);
      assert.equal(fired.status, 200,
        `Performance action '${action}' must dispatch slot ${slot.slotId}: ${JSON.stringify(fired.data)}`);
      if (slot.effectId === 'movementTrace') {
        assert.equal(fired.data.controller.movement.enabled, false,
          'movement tiles must not re-enter the destructive GlobalEffectsController path');
        assert.equal(fired.data.liveTouchOverlayPattern.slotId, slot.slotId,
          'each movement action has one authoritative overlay selection');
        const status = await h.api('GET', '/global-effect-slots/status', undefined, ownerHeaders);
        assert.equal(status.status, 200, JSON.stringify(status.data));
        assert.equal(status.data.liveTouchOverlayPattern.slotId, slot.slotId,
          'status readback must name the currently selected overlay tile');
        const activeTiles = status.data.slots.filter(item => item.effectId === 'movementTrace'
          && item.active);
        assert.ok(activeTiles.length <= 1,
          'overlay status must never claim multiple movement generators are active');
        if (priorOverlaySlotId !== null) {
          assert.equal(status.data.slots.find(item => item.slotId === priorOverlaySlotId).active, false,
            'selecting a new overlay clears the previous tile truth atomically');
        }
        priorOverlaySlotId = slot.slotId;
      }
      if (slot.behavior === 'hold') {
        const released = await h.api('POST', `/global-effect-slots/${slot.slotId}/up`,
          undefined, ownerHeaders);
        assert.equal(released.status, 200, JSON.stringify(released.data));
      }
    }

    const refused = await h.api('PATCH', '/global-effect-slots/9', {
      label: 'must not mutate the Performance seed',
    }, ownerHeaders);
    assert.equal(refused.status, 409, JSON.stringify(refused.data));
    assert.equal(refused.data.code, 'PERFORMANCE_MODE');

    const afterRefusal = await h.api('GET', '/global-effect-slots', undefined, ownerHeaders);
    const configAfterRefusal = afterRefusal.data.slots
      .filter(slot => slot.slotId >= 9 && slot.slotId <= 24)
      .map(slot => ({
        slotId: slot.slotId,
        enabled: slot.enabled,
        effectId: slot.effectId,
        presetId: slot.presetId,
        label: slot.label,
        behavior: slot.behavior,
      }));
    assert.deepEqual(configAfterRefusal, configBeforeAction,
      'runtime actions and refused configuration must leave the Performance bindings unchanged');

    const overlayStatus = await h.api('GET', '/global-effect-slots/status', undefined, ownerHeaders);
    const activeOverlaySlots = overlayStatus.data.slots.filter(slot => slot.effectId === 'movementTrace'
      && slot.active);
    assert.ok(activeOverlaySlots.length <= 1,
      'a single Live overlay can never leave stale movement tiles active together');

    const globalAfter = await h.api('GET', '/global-effect-slots');
    assert.deepEqual(globalAfter.data, globalBefore.data,
      'the Performance session seed must never mutate the shared global effect grid');
    const diskAfter = fs.existsSync(globalSlotFile) ? fs.readFileSync(globalSlotFile, 'utf8') : null;
    assert.equal(diskAfter, diskBefore,
      'the Performance session seed must never persist a global effect-slot file');
  } finally {
    const mode = await h.api('GET', '/performance-mode');
    if (mode.data.active) {
      await h.api('POST', '/performance-mode', { active: false, exitAction: 'restore' }, ownerHeaders);
    }
    await disarmOwner(ws);
    ws.close();
  }
});

test('Live Touch palette is owner-private, deep-copied, and cleared on disarm', async () => {
  const ws = await openWs();
  const ownerHeaders = { 'X-Touch-Control-Owner': OWNER_ID };
  try {
    await armOwner(ws);
    const absent = await h.api('GET', '/layers/live_touch/palette', undefined, ownerHeaders);
    assert.equal(absent.status, 200, JSON.stringify(absent.data));
    assert.equal(absent.data.colorPalette, null);

    const input = OVERLAY_PALETTE.map(color => ({ ...color }));
    const written = await h.api('POST', '/layers/live_touch/palette', {
      colorPalette: input,
    }, ownerHeaders);
    assert.equal(written.status, 200, JSON.stringify(written.data));
    input[0].h = 0.99;
    const readback = await h.api('GET', '/layers/live_touch/palette', undefined, ownerHeaders);
    assert.deepEqual(readback.data.colorPalette, OVERLAY_PALETTE,
      'session palette readback must not alias caller-owned objects');

    await disarmOwner(ws);
    await armOwner(ws);
    const afterRearm = await h.api('GET', '/layers/live_touch/palette', undefined, ownerHeaders);
    assert.equal(afterRearm.data.colorPalette, null,
      'disarm must discard the owner-private overlay palette');
  } finally {
    const state = await h.api('GET', '/layers/live_touch/palette', undefined, ownerHeaders);
    if (state.status === 200) await disarmOwner(ws);
    ws.close();
  }
});
